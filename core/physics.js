/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/physics.js
   Flight model. Reads aircraft envelope from S.aircraft.
   Writes back to S via setState(). Called each frame by loop.js.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { bbEvent } from './blackbox.js';

const DEG = Math.PI / 180;

/* ── ILS approach tracking ── */
let _approachInit  = false;
let _dmeNm         = 0;        // estimated distance to threshold (nm)

const APPROACH_FLOOR = 4800;   // ft — activate ILS tracking below this

/* ── Crash thresholds ── */
const CRASH_VS_FPM   = -800;    // hard landing: touchdown VS below this → crash
const CRASH_OVERSPD  = 1.15;    // overspeed: above maxSpd × this factor → structural failure

export function tickPhysics(dt) {
  const ac = S.aircraft;
  if (!ac || S.paused || S.crashed) return;
  if (!ac.envelope) return;  // non-flight vehicles (robot-arm, robot-dog, etc.)

  const prevAlt = S.alt;

  /* ── Speed limit from envelope profile ── */
  const profile = ac.envelope.spdProfile;
  let spdLimit = ac.envelope.maxSpd;
  for (const [altKey, maxSpd] of Object.entries(profile).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (S.alt >= Number(altKey)) { spdLimit = maxSpd; break; }
  }
  const spdTarget = Math.min(S.spdT, spdLimit);

  let newAlt, newSpd, newHdg, newPitch, newRoll, vs;
  let newWow = S.wow ?? false;
  let newTouchdownVS = S.touchdownVS ?? 0;

  /* ── Turbofan N1 dynamics ─────────────────────────────────────────────
     Runs for all turbofan aircraft before the main physics block.
     N1 ramps toward its target (idle floor + throttle contribution) with
     asymmetric time constants: 8 s spool-up, 15 s spool-down.
     State transitions driven here so thrust sees the correct N1 immediately.
     ────────────────────────────────────────────────────────────────────── */
  if (ac.engine?.type === 'turbofan' && !S.crashed) {
    const IDLE_N1 = ac.engine?.idleN1 ?? 22;
    const state   = S.engineState ?? 'off';
    const n1Now   = S.n1 ?? 0;
    const spdNorm = Math.min(1, Math.max(0, (S.spdT ?? 0) / (ac.envelope.maxSpd ?? 340)));

    const n1Target = (state === 'running') ? IDLE_N1 + (100 - IDLE_N1) * spdNorm
                   : (state === 'starting') ? IDLE_N1
                   : 0;   // 'off' or 'shutdown'

    const tau  = (state === 'starting') ? 25 : (n1Target > n1Now ? 8 : 15);
    const newN1 = n1Now + (n1Target - n1Now) * (1 - Math.exp(-dt / tau));

    const n1Up = { n1: Math.max(0, Math.min(100, newN1)) };
    if (state === 'starting' && newN1 >= IDLE_N1 * 0.95) n1Up.engineState = 'running';
    if (state === 'shutdown' && newN1 < 0.5) n1Up.engineState = 'off';
    setState(n1Up);
  }

  if (ac.manualControl) {
    /* ── Shared setup ── */
    const perf = ac.performance ?? {};

    /* Ground elevation from mission */
    const groundFt = S.mission?.departure?.elevation ?? S.mission?.arrival?.elevation ?? 0;
    const onGround = S.alt <= groundFt + 0.5;

    /* ISA density */
    const alt_m  = S.alt * 0.3048;
    const rho    = 1.225 * Math.pow(Math.max(0, 1 - 2.2558e-5 * alt_m), 4.2559);

    /* Airspeed and dynamic pressure */
    const spd_ms = Math.max(1, S.spd) * 0.5144;
    const q      = 0.5 * rho * spd_ms * spd_ms;

    /* Throttle — turbofan uses N1-derived fraction; piston/prop uses spdT directly */
    const isTurbofan = ac.engine?.type === 'turbofan';
    const throttle   = isTurbofan
      ? Math.pow(Math.max(0, (S.n1 ?? 0) / 100), 1.8)   // N1^1.8 → 22% N1 ≈ 5% T_max
      : Math.min(1, Math.max(0, S.spdT / (ac.envelope.cruiseSpd ?? 122)));

    /* Aircraft constants */
    const S_wing   = perf.wingArea  ?? 16.2;
    const mass     = perf.mass      ?? 1157;
    const T_max    = perf.thrustMax ?? 1800;
    const CL_0     = perf.CL_0     ?? 0.2;
    const CL_alpha = perf.CL_alpha ?? 5.0;
    const CL_max   = perf.CL_max   ?? 1.9;
    const CD_0     = perf.CD_0     ?? 0.028;
    const k_ind    = perf.inducedK ?? 0.055;
    const Vr       = perf.Vr ?? 55;

    /* ── Angular inertia — roll and pitch rates have momentum ── */
    const maxRollRate  = ac.handling?.rollRate  ?? 30;   // deg/s
    const maxPitchRate = ac.handling?.pitchRate ?? 5;    // deg/s

    /* On ground: snap back to level; in flight: fight inertia */
    const rollTarget  = onGround ? 0 : S.rollT;
    const pitchTarget = (onGround && S.spd < Vr) ? 0 : S.pitchT;
    const maxBank     = ac.handling?.maxBank  ?? 60;
    const maxPitch    = ac.handling?.maxPitch ?? 30;

    /* PD controller — proportional (attitude error) + derivative (damps oscillation)
       Without the D term the rate overshoots and the aircraft jitters.            */
    const curRollRate  = S.rollRate  ?? 0;
    const curPitchRate = S.pitchRate ?? 0;
    const desiredRollRate  = Math.max(-maxRollRate,  Math.min(maxRollRate,
      4.0 * (rollTarget  - S.roll)  - 0.7 * curRollRate));
    const desiredPitchRate = Math.max(-maxPitchRate, Math.min(maxPitchRate,
      2.5 * (pitchTarget - S.pitch) - 0.8 * curPitchRate));

    const tauRoll  = onGround ? 0.05 : 0.18;
    const tauPitch = onGround ? 0.05 : 0.30;
    const newRollRateVal  = curRollRate  + ((desiredRollRate  - curRollRate)  / tauRoll)  * dt;
    const newPitchRateVal = curPitchRate + ((desiredPitchRate - curPitchRate) / tauPitch) * dt;

    newRoll  = Math.max(-maxBank,  Math.min(maxBank,  S.roll  + newRollRateVal  * dt));
    newPitch = Math.max(-maxPitch, Math.min(maxPitch, S.pitch + newPitchRateVal * dt));

    /* Flap effects */
    const flapCfg  = (ac.flaps ?? [])[S.flaps] ?? {};
    const CL_max_e = CL_max + (flapCfg.dCL_max ?? 0);
    const CD_0_e   = CD_0   + (flapCfg.dCD_0   ?? 0);

    /* Gear drag — retractable aircraft only; fixed-gear drag is baked into CD_0 */
    const gearDrag = (!ac.fixedGear && S.gear) ? (perf.gearDrag ?? 0) : 0;

    /* Prop/damage drag — seized propeller + battle damage as engine dies */
    const ePow     = S.enginePower ?? 1.0;
    const propDrag = (1 - ePow) * 0.022;
    const CD_0_eff = CD_0_e + propDrag + gearDrag;

    /* Aerodynamics */
    const alpha = newPitch * DEG;
    const CL    = Math.min(CL_max_e, Math.max(-0.5, CL_0 + CL_alpha * alpha));
    const CD    = CD_0_eff + k_ind * CL * CL;
    const L     = q * S_wing * CL;
    const D     = q * S_wing * CD;
    const engineLive = S.engineState === 'running';
    const T     = engineLive ? throttle * T_max * (rho / 1.225) * (S.enginePower ?? 1.0) : 0;
    const W     = mass * 9.81;

    const wowLatch = S.wow && (S.vs ?? 0) < -50;  // latch only when landing (descending), not takeoff
    if (onGround && (L < W || wowLatch)) {  // wow latch: stay on ground once down
      /* ── Ground roll ──
         Forces: thrust, aerodynamic drag, rolling friction, brakes.
         Heading via nose wheel steering.                              */
      const muRoll  = perf.muRoll  ?? 0.05;   // grass ≈ 0.05, tarmac ≈ 0.02
      const muBrake = perf.muBrake ?? 0.35;
      const engineDead = (S.enginePower ?? 1.0) < 0.05;
      /* Use actual (unclamped) speed for ground dynamics — spd_ms is clamped to 1 kt
         for the flight model only (prevents division-by-zero in gamma calculation). */
      const spd_ms_gnd = S.spd * 0.5144;
      const braking = ((S.spdT === 0 || engineDead || S.braking) && spd_ms_gnd > 0.5) ? 1 : 0;

      const F_net     = T - D - (muRoll + braking * muBrake) * W;
      const newSpd_ms = Math.max(0, spd_ms_gnd + F_net / mass * dt);

      newSpd = newSpd_ms / 0.5144;
      newAlt = groundFt;
      vs     = 0;
      if (S.aircraft?.manualControl) {
        /* Nose-wheel steering: yaw rate ∝ steer angle × ground speed, so it only
           turns while rolling (can't pivot a stationary aircraft). Capped at 30°/s. */
        const yawRate = Math.max(-30, Math.min(30, (S.steer ?? 0) * newSpd * 1.1));  // °/s
        newHdg = (((S.hdg + yawRate * dt) % 360) + 360) % 360;
      } else {
        newHdg = convergeHdg(S.hdg, S.hdgT, 30 * dt);  // AP heading-bug steering
      }

    } else {
      /* ── Flight model ──
         Point-mass wind axes. VS integrated across frames via S.vs.  */
      const vz_ms  = (S.vs ?? 0) / 196.85;
      const gamma  = Math.asin(Math.max(-0.5, Math.min(0.5, vz_ms / spd_ms)));

      const a_long = (T * Math.cos(alpha) - D - W * Math.sin(gamma)) / mass;
      const dGamma = (L - W * Math.cos(gamma)) / (mass * Math.max(10, spd_ms))
                   - 0.4 * gamma                        // pitch damping — horizontal stab
                   + (S.trim ?? 0) * 0.0015;            // trim — shifts pitch equilibrium

      const newSpd_ms = Math.max(0, spd_ms + a_long * dt);
      const newGamma  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, gamma + dGamma * dt));

      newSpd = newSpd_ms / 0.5144;
      vs     = newSpd_ms * Math.sin(newGamma) * 196.85;

      /* High-alpha stall: CL hits CL_max — sudden snap, nose drops */
      if (CL > CL_max_e * 0.95) {
        const sf = Math.min(1, (CL / CL_max_e - 0.95) / 0.05);
        vs      -= sf * 800;
        newPitch = Math.max(newPitch - 3 * sf * dt, -15);
      }

      /* Energy stall: L < W at low speed — gentle progressive sink, no snap */
      const liftDeficit = Math.max(0, W - L) / W;              // 0 = flying, 1 = no lift
      if (liftDeficit > 0.05) {
        vs -= liftDeficit * 120;                                // gentle fpm nudge per frame
      }

      /* Liftoff: bump clear of ground to release WoW next frame */
      newAlt = Math.max(onGround ? groundFt + 1 : groundFt, S.alt + vs * dt / 60);

      /* Coordinated turn */
      const turnRate = 9.81 * Math.tan(newRoll * DEG) / Math.max(10, newSpd_ms);
      newHdg = (S.hdg + turnRate * dt * 180 / Math.PI + 360) % 360;

      /* ── Rotary engine gyroscopic precession ──
         Le Rhône spins clockwise seen from pilot.
         Pitch-up → yaw right. Left bank → pitch-down assist. Right bank → pitch-up resistance.
         All effects scale with throttle (engine spin speed).                                  */
      if (ac.rotaryEngine?.gyroscopicTorque) {
        const gyro = throttle * 0.6;                          // strength scales with power
        newHdg  = (newHdg  + newPitchRateVal * gyro * dt * 1.5 + 360) % 360;  // pitch → yaw
        newPitch = Math.max(-maxPitch, Math.min(maxPitch,
          newPitch - newRollRateVal * gyro * dt * 0.4));       // roll → pitch couple
      }
    }

    /* WoW — weight on wheels (squat switch) */
    newWow = newAlt <= groundFt + 0.5;
    if (!S.wow && newWow) newTouchdownVS = vs;   // record VS on touchdown

  } else {
    /* ── Autopilot convergence ── */
    const apGround = S.mission?.departure?.elevation ?? S.mission?.arrival?.elevation
                  ?? ac.situations?.[0]?.alt ?? 0;
    const apOnGnd  = S.alt <= apGround + 0.5;
    const agl      = S.alt - apGround;

    /* Cap descent rate by AGL: full 2400 fpm above 500 ft,
       700 fpm on final (< 500 ft), 250 fpm flare (< 50 ft) */
    const maxDescentFpm = agl < 50 ? 250 : agl < 500 ? 700 : 2400;
    const descentFpm    = S.altT < S.alt ? maxDescentFpm : 2400;
    const altRate   = Math.min(Math.abs(S.altT - S.alt), descentFpm * dt / 60);
    const spdRate   = 8  * dt;
    const hdgRate   = 3  * dt;
    const pitchRate = 1.5 * dt;
    const rollRate  = 3  * dt;

    /* Don't climb while on the ground — altitude target is a preselect only.
       Aircraft leaves the ground only when it's already airborne (alt > apGround). */
    newAlt   = apOnGnd ? apGround : Math.max(apGround, converge(S.alt, S.altT, altRate));
    newSpd   = converge(S.spd,   spdTarget, spdRate);
    newHdg   = convergeHdg(S.hdg, S.hdgT,  hdgRate);
    newPitch = converge(S.pitch, S.pitchT,  pitchRate);
    newRoll  = converge(S.roll,  S.rollT,   rollRate);
    vs       = (newAlt - prevAlt) / dt * 60;
    newWow   = apOnGnd;
  }

  /* ── ILS tracking ── */
  let ilsLoc = S.ilsLoc;
  let ilsGs  = S.ilsGs;

  if (S.mission && S.mission.arrival) {
    /* Initialise DME estimate when we enter approach zone */
    if (!_approachInit && newAlt < APPROACH_FLOOR) {
      _approachInit = true;
      _dmeNm = Math.max(2, newAlt / 318);   // 3° slope: alt_ft ≈ dme_nm × 318
    }

    if (_approachInit && newAlt > 10) {
      /* Decrease DME at groundspeed rate along approach track */
      const gsKts = newSpd;
      _dmeNm = Math.max(0, _dmeNm - (gsKts / 3600) * dt);

      /* LOC: 2 dots per degree off course — only if ILS exists */
      if (S.mission.arrival.ils) {
        const course = S.mission.arrival.ils.course;
        let hdgDiff = ((newHdg - course + 540) % 360) - 180;
        ilsLoc = Math.max(-2.5, Math.min(2.5, hdgDiff * -2));

        /* GS: expected alt on 3° slope = dme × 318 ft */
        const altExpected = _dmeNm * 318;
        const gsErr = newAlt - altExpected;
        ilsGs = Math.max(-2.5, Math.min(2.5, gsErr / 80));
      }
    }
  }

  /* ── FMA phase from aircraft config ── */
  let fma = S.fma;
  if (ac.fmaPhases) {
    const phase = ac.fmaPhases.find(p => newAlt >= p.minAlt);
    if (phase) {
      fma = phase.vals.map((val, i) => ({
        sub:   S.fma[i]?.sub ?? '',
        val,
        col:   phase.cols[i] ?? 'white',
        flash: 0,
      }));
    }
  }

  /* ── Wind ── */
  const wx = _getWind();
  const windSpd_ms  = wx.spd * 0.5144;
  const windDir_rad = wx.dir * DEG;
  // Wind FROM → air moves in opposite direction
  const windN_ms = windSpd_ms * Math.cos(windDir_rad + Math.PI);
  const windE_ms = windSpd_ms * Math.sin(windDir_rad + Math.PI);

  /* ── Turbulence — vertical buffeting only; roll noise causes terrain jitter ── */
  const turb = wx.turbulence ?? 0;
  if (turb > 0 && !newWow) {
    vs += (Math.random() - 0.5) * turb * 300;
  }

  /* ── Dead reckoning — ground velocity = TAS vector + wind ── */
  const hdgRad = newHdg * DEG;
  const cosLat = Math.cos(S.lat * DEG);
  const acN_ms = newSpd * 0.5144 * Math.cos(hdgRad);
  const acE_ms = newSpd * 0.5144 * Math.sin(hdgRad);
  const gndN_ms = acN_ms + windN_ms;
  const gndE_ms = acE_ms + windE_ms;
  const newLat  = S.lat + gndN_ms / 1852 / 60 * dt;
  const newLon  = S.lon + gndE_ms / 1852 / 60 / cosLat * dt;

  const newRollRate  = ac?.manualControl ? (typeof newRollRateVal  !== 'undefined' ? newRollRateVal  : S.rollRate)  : 0;
  const newPitchRate = ac?.manualControl ? (typeof newPitchRateVal !== 'undefined' ? newPitchRateVal : S.pitchRate) : 0;

  /* ── Bounds checker — crash detection ── */
  if (ac.manualControl) {
    // Hard landing: just touched down (WoW just went true) with excessive VS
    const justTouched = !S.wow && newWow;
    if (justTouched && vs < CRASH_VS_FPM) {
      setState({ crashed: true, crashReason: `HARD LANDING  ${Math.round(vs)} fpm`,
                 enginePower: 0, spdT: 0 });
      bbEvent({ type: 'crash', reason: `HARD LANDING ${Math.round(vs)} fpm` });
      return;
    }
    // Overspeed: structural failure above VNE × 1.15
    const vne = ac.envelope.maxSpd ?? 999;
    if (newSpd > vne * CRASH_OVERSPD) {
      setState({ crashed: true, crashReason: `OVERSPEED  ${Math.round(newSpd)} kt  (VNE ${Math.round(vne)} kt)`,
                 enginePower: 0, spdT: 0 });
      bbEvent({ type: 'crash', reason: `OVERSPEED ${Math.round(newSpd)} kt` });
      return;
    }
  }

  /* ── Oil temperature — first-order lag toward throttle-dependent target ── */
  const _running  = S.engineState === 'running';
  const _throttle = Math.max(0, Math.min(1, (S.spdT ?? 0) / (ac.envelope.maxSpd ?? 335)));
  const _oilTarget = _running ? 40 + _throttle * 75 : 15;   // °C: 40 idle → 115 full
  const _tau       = _running ? 180 : 600;                   // s: 3 min warm-up, 10 min cool-down
  const _oilNow    = S.oilTempC ?? 15;
  const newOilTempC = _oilNow + (_oilTarget - _oilNow) * (dt / _tau);

  /* Thrust reverser: auto-deploy on rollout above 60 kt, auto-stow below */
  const _trCapable = !!(ac.engine?.thrustReverser);
  const _trOn = _trCapable && newWow && newSpd > 60 && (S.spdT === 0 || S.braking);
  const _trPatch = _trCapable ? { thrustReverser: _trOn } : {};

  /* Ground spoilers: auto-deploy on touchdown when armed (lever at 1) + idle thrust */
  const justTouched = !S.wow && newWow;
  const _sbPatch = (justTouched && (S.speedBrake ?? 0) === 1 && (S.spdT ?? 0) === 0)
    ? { speedBrake: 2 } : {};

  /* Gear animation — 12-second transit (not for fixed-gear aircraft) */
  const GEAR_TIME = 12;
  const gearTarget = S.gear ? 1 : 0;
  const gearCur    = S.gearAnim ?? gearTarget;
  const gearDelta  = dt / GEAR_TIME;
  const newGearAnim = gearTarget > gearCur
    ? Math.min(1, gearCur + gearDelta)
    : Math.max(0, gearCur - gearDelta);
  const _gearPatch = !ac.fixedGear ? { gearAnim: newGearAnim } : {};

  setState({ alt: newAlt, spd: newSpd, hdg: newHdg, pitch: newPitch, roll: newRoll,
             rollRate: newRollRate, pitchRate: newPitchRate,
             vs, ilsLoc, ilsGs, fma, lat: newLat, lon: newLon,
             prevAlt: S.alt, time: S.time + dt,
             wow: newWow, touchdownVS: newTouchdownVS,
             oilTempC: newOilTempC, ..._trPatch, ..._gearPatch, ..._sbPatch });
}

export function resetApproach() {
  _approachInit = false;
  _dmeNm = 0;
}

/* ── Helpers ── */
function _getWind() {
  const w = S.mission?.weather;
  if (!w) return { dir: 0, spd: 0, turbulence: 0 };
  const src = w.source === 'manual' ? w.manual
            : w.source === 'live'   ? S.metar
            : w.fallback;
  if (!src) return { dir: 0, spd: 0, turbulence: 0 };
  return {
    dir:        src.wdir  ?? src.wind  ?? 0,
    spd:        src.wspd  ?? 0,
    turbulence: src.turbulence ?? 0,
  };
}

function converge(cur, tgt, rate) {
  const d = tgt - cur;
  return Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate;
}

function convergeHdg(cur, tgt, rate) {
  let diff = ((tgt - cur + 540) % 360) - 180;
  if (Math.abs(diff) <= rate) return tgt;
  return (cur + Math.sign(diff) * rate + 360) % 360;
}
