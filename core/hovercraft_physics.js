/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/hovercraft_physics.js
   Plenum chamber physics for hovercraft vehicles.

   Called every tick by loop.js when S.aircraft.type === 'hovercraft'.
   Supports two vehicles simultaneously (Timo + Markus).

   State prefix pattern:
     Timo   → pfx = 'hc'   → S.hcLiftT, S.hcPressure, …
     Markus → pfx = 'hcM'  → S.hcMLiftT, S.hcMPressure, …

   ── Physics model ──────────────────────────────────────────────

   Fan curve (simplified):
     P_raw(t) = t × P_ref × (1 − 0.30 × t)
     ↑ back-pressure term: at high throttle the EDF works against
       the plenum pressure it creates, reducing net flow.

   Plenum pressure after skirt leakage:
     P_plenum = P_raw × (1 − leakage_coeff)

   P_ref is self-calibrated so that at max_lift_throttle the craft
   exactly hovers at nominal mass:
     P_ref = P_target / (t_max × (1 − 0.3 × t_max) × (1 − leak))

   Hover condition:
     F_hover = P_plenum × plenum_area  ≥  mass × g
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const G = 9.81;

/* ── Calibrate P_ref from aircraft spec ── */
function _pmaxRef(ac) {
  const t    = ac.envelope.max_lift_throttle;
  const leak = ac.specs.skirt.leakage_coefficient;
  const P_t  = ac.envelope.min_hover_pressure_pa;
  return P_t / (t * (1 - 0.3 * t) * (1 - leak));
}

/* ── Tick one vehicle ── */
function _tickVehicle(ac, pfx, dt) {
  const spec = ac.specs;
  const env  = ac.envelope;
  const area = spec.plenum_area_m2;
  const mass = S[pfx + 'Mass']    ?? spec.mass_kg;
  const leak = S[pfx + 'Leakage'] ?? spec.skirt.leakage_coefficient;

  /* ── Autonomy (Markus GPS flight computer) ── */
  let liftT  = S[pfx + 'LiftT']   ?? 0;
  let thrT   = S[pfx + 'ThrustT'] ?? 0;
  let rudder = S[pfx + 'Rudder']  ?? 0;

  if (pfx !== 'hc') {
    const autonomy = S[pfx + 'Autonomy'] ?? 'MANUAL';
    if (autonomy === 'HOVER') {
      liftT  = env.max_lift_throttle;
      thrT   = 0;
      rudder = 0;
    } else if (autonomy === 'TRACK') {
      liftT = env.max_lift_throttle;
      thrT  = 0.45;
      const curHdg = S[pfx + 'Heading'] ?? 0;
      const tgtHdg = S[pfx + 'TargetHdg'] ?? 0;
      const hdgErr = ((tgtHdg - curHdg + 540) % 360) - 180;
      rudder = Math.max(-1, Math.min(1, hdgErr / 45));
    }
  }

  /* ── Emergency landing — overrides everything, ramps lift to 0 ── */
  if (S[pfx + 'Emergency']) {
    thrT  = 0;
    liftT = Math.max(0, liftT - 0.4 * dt);   // ~2.5 s to full deflate
    setState({ [pfx + 'LiftT']: liftT });
  }

  /* ── Voting triad — node health determines mode ── */
  const nodes  = S[pfx + 'Nodes'] ?? [1, 1, 1];
  const nFail  = nodes.filter(n => n < 0.5).length;
  const mode   = nFail >= 2 ? 'DIRECT' : nFail >= 1 ? 'DEGRADED' : 'NORMAL';

  /* ── ESC temperature model ── */
  const T_AMB       = 25;
  const K_HEAT_LIFT = 2.5;   // °C/s at throttle²=1 — small EDF ESC
  const K_HEAT_THR  = 1.8;
  const K_COOL      = 0.07;  // Newton's cooling (per °C above ambient, per s)
  const TEMP_WARN   = 70;    // °C — yellow
  const TEMP_DERATE = 85;    // °C — output limited, orange
  const TEMP_CUT    = 100;   // °C — full shutdown, red

  let liftEscTemp = S[pfx + 'LiftEscTemp'] ?? T_AMB;
  let thrEscTemp  = S[pfx + 'ThrEscTemp']  ?? T_AMB;
  liftEscTemp += (liftT ** 2 * K_HEAT_LIFT - (liftEscTemp - T_AMB) * K_COOL) * dt;
  thrEscTemp  += (thrT   ** 2 * K_HEAT_THR  - (thrEscTemp  - T_AMB) * K_COOL) * dt;
  liftEscTemp  = Math.max(T_AMB, liftEscTemp);
  thrEscTemp   = Math.max(T_AMB, thrEscTemp);

  /* Thermal derating — reduce output when hot */
  const _derate = (t) => t >= TEMP_CUT ? 0
    : t >= TEMP_DERATE ? 1 - (t - TEMP_DERATE) / (TEMP_CUT - TEMP_DERATE) * 0.6
    : 1;
  const liftThermal = _derate(liftEscTemp);
  const thrThermal  = _derate(thrEscTemp);

  /* Auto-clear emergency flag once settled */
  if (S[pfx + 'Emergency'] && liftT === 0 && !S[pfx + 'Hovering']) {
    setState({ [pfx + 'Emergency']: false });
  }

  /* ── ESC lift limit — hard clamp + thermal derate ── */
  const maxLift = env.max_lift_throttle * liftThermal;
  const liftAct = Math.min(liftT, maxLift);
  const thrActLimited = thrT * thrThermal;

  /* ── Plenum pressure ── */
  const P_ref = _pmaxRef(ac);
  const P_raw = liftAct * P_ref * (1 - 0.3 * liftAct);
  const P_plm = P_raw * (1 - leak);

  /* Required pressure for current mass */
  const P_req = (mass * G) / area;

  /* ── Lift force ── */
  const F_lift    = P_plm * area;
  const weight    = mass * G;
  const hovering  = F_lift >= weight;
  const liftRatio = F_lift / weight;

  /* ── EDF operating point — back-pressure efficiency ── */
  const P_stall = P_ref * maxLift;
  const edfOp   = 1 - 0.28 * Math.min(1, P_plm / P_stall);

  /* ── Thrust ── */
  let thrActN = thrActLimited * spec.thrust_edf.max_thrust_g * 0.00981;
  const maxThrAcc = env.max_thrust_accel_g * G;
  if (mode === 'NORMAL' && thrActN / mass > maxThrAcc) {
    thrActN = maxThrAcc * mass;
  }

  /* ── Motion (only when hovering) ── */
  let speed = S[pfx + 'Speed'] ?? 0;
  if (hovering) {
    const friction = 0.04;
    const acc = thrActN / mass;
    speed = Math.max(0, speed + (acc - friction * speed) * dt);
  } else {
    speed *= 0.80;
  }

  /* ── Yaw rate ── */
  const maxYaw  = env.max_yaw_rate_dps;
  const yawAuth = mode === 'DEGRADED' ? 0.6 : 1.0;
  let yawRate = S[pfx + 'YawRate'] ?? 0;
  if (hovering) {
    yawRate += rudder * maxYaw * yawAuth * dt;
    yawRate -= yawRate * 2.0 * dt;
    yawRate  = Math.max(-maxYaw, Math.min(maxYaw, yawRate));
  } else {
    yawRate *= 0.7;
  }

  const heading = ((S[pfx + 'Heading'] ?? 0) + yawRate * dt + 360) % 360;

  const patch = {};
  patch[pfx + 'LiftAct']   = liftAct;
  patch[pfx + 'ThrActPct'] = thrActLimited;
  patch[pfx + 'LiftEscTemp'] = +liftEscTemp.toFixed(1);
  patch[pfx + 'ThrEscTemp']  = +thrEscTemp.toFixed(1);
  patch[pfx + 'Pressure']  = Math.round(P_plm * 10) / 10;
  patch[pfx + 'PReq']      = Math.round(P_req);
  patch[pfx + 'Force']     = Math.round(F_lift * 10) / 10;
  patch[pfx + 'Hovering']  = hovering;
  patch[pfx + 'LiftRatio'] = liftRatio;
  patch[pfx + 'EdfOp']     = edfOp;
  patch[pfx + 'Mode']      = mode;
  patch[pfx + 'YawRate']   = yawRate;
  patch[pfx + 'Heading']   = heading;
  patch[pfx + 'Speed']     = speed;
  patch[pfx + 'ThrActN']   = thrActN;
  setState(patch);
}

export function tickHovercraft(dt) {
  if (S.paused) return;

  const active = S.hcActive ?? 'timo';

  if (active === 'markus' && !S.hcVehicles) {
    /* Single Markus mission — S.aircraft is Markus, use hcM prefix */
    if (S.aircraft?.type === 'hovercraft') _tickVehicle(S.aircraft, 'hcM', dt);
    return;
  }

  /* Timo (primary vehicle) */
  const timoAc = S.hcVehicles?.timo ?? S.aircraft;
  if (timoAc?.type === 'hovercraft') _tickVehicle(timoAc, 'hc', dt);

  /* Markus (when dual vehicles loaded and active) */
  const markusAc = S.hcVehicles?.markus;
  if (markusAc && (active === 'both' || active === 'markus')) {
    _tickVehicle(markusAc, 'hcM', dt);
  }
}
