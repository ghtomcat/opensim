/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/physics.js
   Flight model. Reads aircraft envelope from S.aircraft.
   Writes back to S via setState(). Called each frame by loop.js.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const DEG = Math.PI / 180;

/* ── ILS approach tracking ── */
let _approachInit  = false;
let _dmeNm         = 0;        // estimated distance to threshold (nm)

const APPROACH_FLOOR = 4800;   // ft — activate ILS tracking below this

export function tickPhysics(dt) {
  const ac = S.aircraft;
  if (!ac || S.paused) return;

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

  if (ac.manualControl) {
    /* ── Shared setup ── */
    const perf      = ac.performance ?? {};
    const rollRate  = (ac.handling?.rollRate  ?? 30) * dt;
    const pitchRate = (ac.handling?.pitchRate ?? 5)  * dt;

    /* Ground elevation from mission */
    const groundFt = S.mission?.arrival?.elevation ?? S.mission?.departure?.elevation ?? 0;
    const onGround = S.alt <= groundFt + 0.5;   // within oleo strut travel

    /* ISA density */
    const alt_m  = S.alt * 0.3048;
    const rho    = 1.225 * Math.pow(Math.max(0, 1 - 2.2558e-5 * alt_m), 4.2559);

    /* Airspeed and dynamic pressure */
    const spd_ms = Math.max(1, S.spd) * 0.5144;
    const q      = 0.5 * rho * spd_ms * spd_ms;

    /* Throttle */
    const throttle = Math.min(1, Math.max(0, S.spdT / (ac.envelope.cruiseSpd ?? 122)));

    /* Aircraft constants */
    const S_wing   = perf.wingArea  ?? 16.2;   // m²
    const mass     = perf.mass      ?? 1157;   // kg
    const T_max    = perf.thrustMax ?? 1800;   // N
    const CL_0     = perf.CL_0     ?? 0.2;
    const CL_alpha = perf.CL_alpha ?? 5.0;    // rad⁻¹
    const CL_max   = perf.CL_max   ?? 1.9;
    const CD_0     = perf.CD_0     ?? 0.028;
    const k_ind    = perf.inducedK ?? 0.055;

    /* Pitch: locked at 0 below rotation speed on ground */
    const Vr = perf.Vr ?? 55;
    newPitch = converge(S.pitch, (onGround && S.spd < Vr) ? 0 : S.pitchT, pitchRate);
    newRoll  = converge(S.roll,  onGround ? 0 : S.rollT,  rollRate);

    /* Aerodynamics — computed always for both ground and flight */
    const alpha = newPitch * DEG;
    const CL    = Math.min(CL_max, Math.max(-0.5, CL_0 + CL_alpha * alpha));
    const CD    = CD_0 + k_ind * CL * CL;
    const L     = q * S_wing * CL;
    const D     = q * S_wing * CD;
    const T     = throttle * T_max * (rho / 1.225);  // thrust falls with density
    const W     = mass * 9.81;

    if (onGround && L < W) {
      /* ── Ground roll ──
         Forces: thrust, aerodynamic drag, rolling friction, brakes.
         Heading via nose wheel steering.                              */
      const muRoll  = perf.muRoll  ?? 0.05;   // grass ≈ 0.05, tarmac ≈ 0.02
      const muBrake = perf.muBrake ?? 0.35;
      const braking = (S.spdT === 0 && spd_ms > 0.5) ? 1 : 0;

      const F_net     = T - D - (muRoll + braking * muBrake) * W;
      const newSpd_ms = Math.max(0, spd_ms + F_net / mass * dt);

      newSpd = newSpd_ms / 0.5144;
      newAlt = groundFt;
      vs     = 0;
      newHdg = convergeHdg(S.hdg, S.hdgT, 30 * dt);  // nose wheel steering

    } else {
      /* ── Flight model ──
         Point-mass wind axes. VS integrated across frames via S.vs.  */
      const vz_ms  = (S.vs ?? 0) / 196.85;
      const gamma  = Math.asin(Math.max(-0.5, Math.min(0.5, vz_ms / spd_ms)));

      const a_long = (T * Math.cos(alpha) - D - W * Math.sin(gamma)) / mass;
      const dGamma = (L - W * Math.cos(gamma)) / (mass * Math.max(10, spd_ms));

      const newSpd_ms = Math.max(0, spd_ms + a_long * dt);
      const newGamma  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, gamma + dGamma * dt));

      newSpd = newSpd_ms / 0.5144;
      vs     = newSpd_ms * Math.sin(newGamma) * 196.85;

      /* Stall: CL → CL_max, lift collapses, nose drops */
      if (CL > CL_max * 0.95) {
        const sf = Math.min(1, (CL / CL_max - 0.95) / 0.05);
        vs      -= sf * 800;
        newPitch = Math.max(newPitch - 3 * sf * dt, -15);
      }

      /* Liftoff: bump clear of ground to release WoW next frame */
      newAlt = Math.max(onGround ? groundFt + 1 : groundFt, S.alt + vs * dt / 60);

      /* Coordinated turn */
      const turnRate = 9.81 * Math.tan(newRoll * DEG) / Math.max(10, newSpd_ms);
      newHdg = (S.hdg + turnRate * dt * 180 / Math.PI + 360) % 360;
    }

    /* WoW — weight on wheels (squat switch) */
    newWow = newAlt <= groundFt + 0.5;
    if (!S.wow && newWow) newTouchdownVS = vs;   // record VS on touchdown

  } else {
    /* ── Autopilot convergence ── */
    const altRate   = Math.min(Math.abs(S.altT - S.alt), 2400 * dt / 60);
    const spdRate   = 8  * dt;
    const hdgRate   = 3  * dt;
    const pitchRate = 1.5 * dt;
    const rollRate  = 3  * dt;

    newAlt   = converge(S.alt,   S.altT,    altRate);
    newSpd   = converge(S.spd,   spdTarget, spdRate);
    newHdg   = convergeHdg(S.hdg, S.hdgT,  hdgRate);
    newPitch = converge(S.pitch, S.pitchT,  pitchRate);
    newRoll  = converge(S.roll,  S.rollT,   rollRate);
    vs       = (newAlt - prevAlt) / dt * 60;
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
    const phase = [...ac.fmaPhases].reverse().find(p => newAlt >= p.minAlt);
    if (phase) {
      fma = phase.vals.map((val, i) => ({
        sub:   S.fma[i]?.sub ?? '',
        val,
        col:   phase.cols[i] ?? 'white',
        flash: 0,
      }));
    }
  }

  /* ── Dead reckoning — geographic position ── */
  const distNm = newSpd * (dt / 3600);
  const hdgRad = newHdg * Math.PI / 180;
  const cosLat = Math.cos(S.lat * Math.PI / 180);
  const newLat = S.lat + distNm / 60 * Math.cos(hdgRad);
  const newLon = S.lon + distNm / 60 * Math.sin(hdgRad) / cosLat;

  setState({ alt: newAlt, spd: newSpd, hdg: newHdg, pitch: newPitch, roll: newRoll,
             vs, ilsLoc, ilsGs, fma, lat: newLat, lon: newLon,
             prevAlt: S.alt, time: S.time + dt,
             wow: newWow, touchdownVS: newTouchdownVS });
}

export function resetApproach() {
  _approachInit = false;
  _dmeNm = 0;
}

/* ── Helpers ── */
function converge(cur, tgt, rate) {
  const d = tgt - cur;
  return Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate;
}

function convergeHdg(cur, tgt, rate) {
  let diff = ((tgt - cur + 540) % 360) - 180;
  if (Math.abs(diff) <= rate) return tgt;
  return (cur + Math.sign(diff) * rate + 360) % 360;
}
