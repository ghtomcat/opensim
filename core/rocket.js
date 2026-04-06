/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/rocket.js
   Point-mass rocket physics. Gravity turn, staging, fuel burn.

   State conventions (rockets):
     S.pitch        — flight path angle, degrees. 90 = straight up, 0 = horizontal.
     S.spd          — total velocity magnitude, knots.
     S.vs           — vertical speed, ft/min.
     S.alt          — altitude MSL, feet. Can reach ~800,000 ft (240 km).
     S.rocketMass   — current total wet mass, kg.
     S.rocketStage  — active stage index (1-based).
     S.rocketCoast  — true during stage separation coast.
     S.rocketCoastT — mission time when coast started.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const DEG     = Math.PI / 180;
const R_EARTH = 6_371_000;   // m
const G0      = 9.80665;     // m/s²

/* ── Extended atmosphere — sea level through low Earth orbit ──
   Returns air density kg/m³ at altitude in metres.             */
export function rhoAtAlt(alt_m) {
  if (alt_m <= 11_000) {
    const T = 288.15 - 6.5e-3 * alt_m;
    return 1.225 * Math.pow(T / 288.15, 4.2559);
  }
  if (alt_m <= 25_000) {
    return 0.3639 * Math.exp(-(alt_m - 11_000) / 6341.6);
  }
  if (alt_m <= 86_000) {
    return 0.01 * Math.exp(-(alt_m - 25_000) / 7200);
  }
  return 0;   // above Kármán line
}

/* ── Programmed flight path angle (degrees, 90=vertical) ──
   Linearly interpolates over [[t_s, fpa_deg], ...] waypoints.  */
function _programmedFPA(t, profile) {
  if (!profile?.length) return 90;
  if (t <= profile[0][0])                      return profile[0][1];
  if (t >= profile[profile.length - 1][0])     return profile[profile.length - 1][1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [t0, f0] = profile[i];
    const [t1, f1] = profile[i + 1];
    if (t >= t0 && t < t1)
      return f0 + (f1 - f0) * (t - t0) / (t1 - t0);
  }
  return 90;
}

/* ── Main tick ── */
export function tickRocket(dt) {
  const ac    = S.aircraft;
  const perf  = ac?.performance ?? {};
  const mT    = S.time ?? 0;
  const stages = perf.stages ?? [];

  /* ── Pre-ignition hold — sit on pad until engine start time ── */
  const ignitionTime = ac.ignitionTime ?? 0;
  if (mT < ignitionTime) {
    setState({ time: mT + dt });
    return;
  }

  /* ── Stage bookkeeping ── */
  let stage    = S.rocketStage   ?? 1;
  let coasting = S.rocketCoast   ?? false;
  let coastT   = S.rocketCoastT  ?? 0;
  let mass     = S.rocketMass    ?? perf.massWet ?? 28000;

  const stg = stages[stage - 1] ?? {};

  /* Mass that will remain after this stage burns out:
     dry mass of current stage + all upper stages (wet) + payload */
  let massAbove = perf.payload ?? 0;
  for (let i = stage; i < stages.length; i++) massAbove += stages[i].massWet ?? 0;
  const burnoutThreshold = (stg.massDry ?? 0) + massAbove + 5;   // 5 kg margin

  /* ── Altitude & atmosphere ── */
  const padElev  = S.mission?.departure?.elevation ?? 0;
  const alt_ft   = S.alt ?? padElev;
  const alt_m    = alt_ft * 0.3048;
  const rho      = rhoAtAlt(alt_m);
  const atmFrac  = Math.min(1, rho / 1.225);

  /* ── Gravity (inverse-square) ── */
  const g = G0 * Math.pow(R_EARTH / (R_EARTH + alt_m), 2);

  /* ── Thrust & fuel burn ── */
  let T = 0, mdot = 0;

  /* ── Engine count — apply mission failures first ── */
  const totalEngines  = stg.engineCount ?? 1;
  let   activeEngines = S.rocketActiveEngines ?? totalEngines;

  const failures = S.mission?.engineFailures ?? [];
  for (const f of failures) {
    if (mT >= f.t && mT < f.t + dt && (f.stageIdx ?? 0) === stage - 1) {
      activeEngines = f.activeEngines ?? activeEngines;
      setState({ rocketActiveEngines: activeEngines, rocketFailedEngines: f.failedEngines ?? [] });
    }
  }

  const engineFrac = totalEngines > 0 ? activeEngines / totalEngines : 1;

  if (coasting) {
    /* Stage separation coast — no thrust, count 6 s */
    if (mT - coastT >= 6 && stage < stages.length) {
      /* Jettison spent stage dry mass, advance to next stage */
      mass  -= stg.massDry ?? 0;
      stage += 1;
      coasting = false;
      /* Reset engine state for new stage */
      const nextStg = stages[stage - 1] ?? {};
      setState({ rocketActiveEngines: nextStg.engineCount ?? 1, rocketFailedEngines: [], rocketCECO: false });
    }
  } else if (mass > burnoutThreshold && S.engineState === 'running') {
    /* Thrusting — scale thrust by active engine fraction */
    const thrustSL  = stg.thrustSL  ?? 0;
    const thrustVac = stg.thrustVac ?? stg.thrustSL ?? 0;
    T    = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * engineFrac;
    mdot = T / ((stg.isp ?? 300) * G0);
  } else if (mass <= burnoutThreshold && !coasting && stage < stages.length) {
    /* Burnout — start coast */
    coasting = true;
    coastT   = mT;
  } else if (mass <= burnoutThreshold && !coasting && stage >= stages.length) {
    /* Last stage burnout — SECO */
    if (!S.rocketSECO) setState({ rocketSECO: true });
  }
  /* After SECO: ballistic coast toward orbit or reentry */

  /* Burn fuel */
  mass = Math.max(massAbove, mass - mdot * dt);

  /* ── Velocity decomposition ── */
  const spd_ms  = (S.spd ?? 0) * 0.5144;
  const fpa     = S.pitch ?? 90;             // current flight path angle
  const fpa_rad = fpa * DEG;
  const vVert   = spd_ms * Math.sin(fpa_rad);
  const vHoriz  = spd_ms * Math.cos(fpa_rad);

  /* ── On-pad hold — wait for T > W before releasing ── */
  const onPad = alt_ft <= padElev + 1 && spd_ms < 1;
  if (onPad && T < mass * g) {
    setState({ rocketMass: mass, rocketStage: stage, rocketCoast: coasting, rocketCoastT: coastT });
    return;
  }

  /* ── Drag ── */
  const dynQ = 0.5 * rho * spd_ms * spd_ms;
  const D    = dynQ * (perf.Cd ?? 0.3) * (perf.area ?? 1.73);

  /* ── Net accelerations ── */
  const aNet  = (T - (spd_ms > 0.1 ? D : 0)) / Math.max(1, mass);
  /* Centrifugal acceleration from horizontal motion (orbital mechanics):
     at orbital velocity, centrifugal = g and the rocket naturally orbits. */
  const centrifugal = vHoriz * vHoriz / (R_EARTH + alt_m);
  const aVert  = aNet * Math.sin(fpa_rad) - g + centrifugal;
  const aHoriz = aNet * Math.cos(fpa_rad);

  /* ── Axial G-load (positive = forward thrust, felt by vehicle) ── */
  const axialG = aNet / G0;

  /* ── G-triggered center-engine cutoff (CECO) ──
     When axial G exceeds cegCutoffG on stage 1 with a multi-engine vehicle
     and the center engine hasn't been cut yet, drop to (N-1) engines.       */
  const cegCutoff = perf.cegCutoffG;
  if (cegCutoff && !S.rocketCECO && stage === 1
      && activeEngines === totalEngines && totalEngines > 1
      && axialG > cegCutoff) {
    setState({ rocketActiveEngines: totalEngines - 1, rocketCECO: true });
  }

  /* ── Integrate velocity ── */
  const newVVert  = vVert  + aVert  * dt;
  const newVHoriz = Math.max(0, vHoriz + aHoriz * dt);
  const newSpd_ms = Math.sqrt(newVVert * newVVert + newVHoriz * newVHoriz);

  /* ── Guidance: steer toward programmed FPA ── */
  const fpaTarget  = _programmedFPA(mT, perf.fpaProfile);
  const fpaActual  = newSpd_ms > 5
    ? Math.atan2(newVVert, Math.max(0.01, newVHoriz)) / DEG
    : 90;
  /* Blend: follow programmed FPA early on, then follow velocity vector */
  const timeSinceLiftoff = mT - ignitionTime;
  /* How long to follow the programmed FPA profile before handing off to
     pure gravity-turn (velocity vector tracking). Tunable per vehicle. */
  const guidanceDur  = perf.guidanceDuration ?? 120;
  const guidanceFrac = Math.max(0, 1 - timeSinceLiftoff / guidanceDur);
  const fpaCmd     = fpaTarget * guidanceFrac + fpaActual * (1 - guidanceFrac);
  /* Attitude rate limited — rocket can't spin instantly */
  const dFPA = Math.max(-3, Math.min(3, (fpaCmd - fpa) * 0.5)) * dt;
  /* Allow negative FPA for ballistic descent — clamp at ±85° */
  const newFPA = Math.max(-85, Math.min(90, fpa + dFPA));

  /* ── Position update ── */
  const newAlt_m  = Math.max(padElev * 0.3048, alt_m + newVVert * dt);
  const newAlt_ft = newAlt_m / 0.3048;
  const vs_fpm    = newVVert * 196.85;

  const hdg_rad = (S.hdg ?? 0) * DEG;
  const dHoriz  = newVHoriz * dt;
  const dLat    = (dHoriz * Math.cos(hdg_rad)) / (R_EARTH * DEG);
  const dLon    = (dHoriz * Math.sin(hdg_rad)) / (R_EARTH * Math.cos((S.lat ?? 0) * DEG) * DEG);

  setState({
    spd:   newSpd_ms / 0.5144,
    spdT:  newSpd_ms / 0.5144,
    alt:   newAlt_ft,
    altT:  newAlt_ft,
    pitch: newFPA,
    vs:    vs_fpm,
    lat:   (S.lat ?? 0) + dLat,
    lon:   (S.lon ?? 0) + dLon,
    rocketMass:   mass,
    rocketStage:  stage,
    rocketCoast:  coasting,
    rocketCoastT: coastT,
    rocketG:      axialG,
    rocketDynQ:   dynQ,
    time:  mT + dt,
  });
}
