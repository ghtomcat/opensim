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

  if (ac.manualControl) {
    /* ── Aerodynamic force-balance flight model ──
       Point-mass, wind axes. Forces in SI, converted at output.
       State: spd (kt), vs (fpm) — both integrated across frames.     */
    const perf     = ac.performance ?? {};
    const rollRate  = (ac.handling?.rollRate  ?? 30) * dt;
    const pitchRate = (ac.handling?.pitchRate ?? 5)  * dt;

    newRoll  = converge(S.roll,  S.rollT,  rollRate);
    newPitch = converge(S.pitch, S.pitchT, pitchRate);

    /* ISA density: ρ drops with altitude */
    const alt_m = S.alt * 0.3048;
    const rho   = 1.225 * Math.pow(Math.max(0, 1 - 2.2558e-5 * alt_m), 4.2559);

    /* Dynamic pressure */
    const spd_ms = Math.max(1, S.spd) * 0.5144;       // kt → m/s
    const q      = 0.5 * rho * spd_ms * spd_ms;       // Pa

    /* Throttle 0–1 from thrust profile */
    const throttle = Math.min(1, Math.max(0, S.spdT / (ac.envelope.cruiseSpd ?? 122)));

    /* Aircraft constants (all in SI) */
    const S_wing   = perf.wingArea  ?? 16.2;    // m²
    const mass     = perf.mass      ?? 1157;    // kg
    const T_max    = perf.thrustMax ?? 1800;    // N (sea level)
    const CL_0     = perf.CL_0     ?? 0.2;     // lift at zero AoA
    const CL_alpha = perf.CL_alpha ?? 5.0;     // lift slope, rad⁻¹
    const CL_max   = perf.CL_max   ?? 1.9;     // stall
    const CD_0     = perf.CD_0     ?? 0.028;   // parasite drag
    const k_ind    = perf.inducedK ?? 0.055;   // induced drag factor

    /* Angle of attack (simplified: α ≈ pitch attitude) */
    const alpha = newPitch * DEG;

    /* Lift and drag */
    const CL = Math.min(CL_max, Math.max(-0.5, CL_0 + CL_alpha * alpha));
    const CD = CD_0 + k_ind * CL * CL;
    const L  = q * S_wing * CL;
    const D  = q * S_wing * CD;

    /* Thrust drops proportionally with density (normally-aspirated engine) */
    const T = throttle * T_max * (rho / 1.225);
    const W = mass * 9.81;

    /* Current flight path angle γ from previous frame's VS */
    const vz_ms = (S.vs ?? 0) / 196.85;       // fpm → m/s
    const gamma  = Math.asin(Math.max(-0.5, Math.min(0.5, vz_ms / spd_ms)));

    /* Equations of motion (point-mass, wind axes)
         dv/dt  = (T·cos(α) − D − W·sin(γ)) / m
         dγ/dt  = (L − W·cos(γ))             / (m·v)              */
    const a_long = (T * Math.cos(alpha) - D - W * Math.sin(gamma)) / mass;
    const dGamma = (L - W * Math.cos(gamma)) / (mass * Math.max(10, spd_ms));

    /* Integrate */
    const newSpd_ms = Math.max(0, spd_ms + a_long * dt);
    const newGamma  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, gamma + dGamma * dt));

    newSpd = newSpd_ms / 0.5144;                        // m/s → kt
    vs     = newSpd_ms * Math.sin(newGamma) * 196.85;   // m/s → fpm

    /* Stall: CL near CL_max → buffet, nose drops */
    if (CL > CL_max * 0.95) {
      const sf = Math.min(1, (CL / CL_max - 0.95) / 0.05);
      vs      -= sf * 800;
      newPitch = Math.max(newPitch - 3 * sf * dt, -15);
    }

    const groundFt = S.mission?.arrival?.elevation ?? S.mission?.departure?.elevation ?? 0;
    newAlt = Math.max(groundFt, S.alt + vs * dt / 60);

    /* Coordinated turn: ω = g·tan(φ) / TAS */
    const turnRate = 9.81 * Math.tan(newRoll * DEG) / Math.max(10, newSpd_ms);
    newHdg = (S.hdg + turnRate * dt * 180 / Math.PI + 360) % 360;

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
             prevAlt: S.alt, time: S.time + dt });
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
