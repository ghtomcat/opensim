/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/physics.js
   Flight model. Reads aircraft envelope from S.aircraft.
   Writes back to S via setState(). Called each frame by loop.js.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

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
    /* ── Manual flight model ── */
    const rollRate  = (ac.handling?.rollRate  ?? 30) * dt;
    const pitchRate = (ac.handling?.pitchRate ?? 5)  * dt;
    const spdRate   = (ac.handling?.spdRate   ?? 2)  * dt;

    newRoll  = converge(S.roll,  S.rollT,  rollRate);
    newPitch = converge(S.pitch, S.pitchT, pitchRate);
    newSpd   = converge(S.spd,   spdTarget, spdRate);

    /* Coordinated turn: ω = g·tan(φ) / TAS */
    const tasMs     = Math.max(10, newSpd) * 0.5144;    // kt → m/s
    const turnRate  = 9.81 * Math.tan(newRoll * Math.PI / 180) / tasMs;  // rad/s
    newHdg = (S.hdg + turnRate * dt * 180 / Math.PI + 360) % 360;

    /* Climb rate: VS = TAS · sin(pitch) */
    vs     = newSpd * Math.sin(newPitch * Math.PI / 180) * 101.27;   // fpm
    newAlt = Math.max(0, S.alt + vs * dt / 60);

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
