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
const GM      = 3.986004418e14;  // m³/s² — Earth's gravitational parameter

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
  if (alt_m <= 140_000) {
    return 5.6e-6 * Math.exp(-(alt_m - 86_000) / 6150);  // mesosphere/thermosphere
  }
  return 0;
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

/* ── Dragon reentry constants ────────────────────────────────── */
const REENTRY_CD    = 1.4;    // blunt-body heat shield
const REENTRY_AREA  = 10.2;   // m²  (3.6 m diameter)
const REENTRY_MASS  = 9500;   // kg  (capsule + crew, no trunk)
const DROGUE_CDA    = 79.2;   // m²  2× 5.8 m drogues
const MAINS_CDA     = 996;    // m²  4× 21.3 m mains
const DROGUE_ALT    = 5_500;  // m
const MAINS_ALT     = 1_800;  // m
const BLACKOUT_ALT  = 80_000; // m  comms blackout entry
const BLACKOUT_EXIT = 35_000; // m  signal reacquired

/* ── TLI burn — apply prograde ΔV to escape Earth orbit ─────── */
function _applyTLIBurn(dv_ms) {
  const v   = S.orbitVec;
  const spd = Math.sqrt(v.vx*v.vx + v.vy*v.vy + v.vz*v.vz);
  const f   = dv_ms / spd;
  setState({
    rocketTLI: true,
    orbitVec: { ...v, vx: v.vx*(1+f), vy: v.vy*(1+f), vz: v.vz*(1+f) },
  });
}

/* ── Deorbit burn — apply retrograde ΔV to orbitVec ─────────── */
function _applyDeorbitBurn(dv_ms) {
  const v   = S.orbitVec;
  const spd = Math.sqrt(v.vx*v.vx + v.vy*v.vy + v.vz*v.vz);
  const f   = dv_ms / spd;                // fraction to subtract
  setState({
    dragonDeorbit: true,
    orbitVec: {
      ...v,
      vx: v.vx * (1 - f),
      vy: v.vy * (1 - f),
      vz: v.vz * (1 - f),
    },
  });
}

/* ── Keplerian orbital propagation ──────────────────────────────
   Activated once after SECO. Replaces flat-Earth dead reckoning
   with a 3D ECEF point-mass gravity integrator (RK1 / Euler step).
   State vector S.orbitVec = { rx,ry,rz, vx,vy,vz } in metres/m·s⁻¹.
   ─────────────────────────────────────────────────────────────── */

function _captureOrbitVec() {
  const lat_r  = (S.lat  ?? 0) * DEG;
  const lon_r  = (S.lon  ?? 0) * DEG;
  const alt_m  = (S.alt  ?? 0) * 0.3048;
  const spd_ms = (S.spd  ?? 0) * 0.5144;
  const fpa_r  = (S.pitch ?? 0) * DEG;
  const hdg_r  = (S.hdg  ?? 0) * DEG;

  const r      = R_EARTH + alt_m;
  const vHoriz = spd_ms * Math.cos(fpa_r);
  const vVert  = spd_ms * Math.sin(fpa_r);

  /* Local ENU velocity */
  const vEast  = vHoriz * Math.sin(hdg_r);
  const vNorth = vHoriz * Math.cos(hdg_r);
  const vUp    = vVert;

  /* ENU → ECEF rotation */
  const slat = Math.sin(lat_r), clat = Math.cos(lat_r);
  const slon = Math.sin(lon_r), clon = Math.cos(lon_r);
  const vx =  -slon * vEast  - slat * clon * vNorth  + clat * clon * vUp;
  const vy =   clon * vEast  - slat * slon * vNorth  + clat * slon * vUp;
  const vz =   clat * vNorth + slat * vUp;

  /* Position in ECEF */
  const rx = r * clat * clon;
  const ry = r * clat * slon;
  const rz = r * slat;

  setState({
    rocketOrbit:   true,
    orbitVec:      { rx, ry, rz, vx, vy, vz },
    orbitPass:     0,
    _orbitPrevLat: S.lat ?? 0,
  });
}

function _tickOrbit(dt) {
  const { rx, ry, rz, vx, vy, vz } = S.orbitVec;

  /* Velocity Verlet — symplectic, conserves orbital energy.
     Step 1: accelerate current position */
  const r2  = rx*rx + ry*ry + rz*rz;
  const r3  = r2 * Math.sqrt(r2);
  const k   = -GM / r3;
  const ax = k * rx, ay = k * ry, az = k * rz;

  /* Step 2: advance position with current v + half-kick */
  const dt2 = dt * dt;
  const nrx = rx + vx * dt + 0.5 * ax * dt2;
  const nry = ry + vy * dt + 0.5 * ay * dt2;
  const nrz = rz + vz * dt + 0.5 * az * dt2;

  /* Step 3: new acceleration at new position */
  const nr2 = nrx*nrx + nry*nry + nrz*nrz;
  const nr3 = nr2 * Math.sqrt(nr2);
  const nk  = -GM / nr3;
  const nax = nk * nrx, nay = nk * nry, naz = nk * nrz;

  /* Step 4: full velocity kick using average acceleration */
  let nvx = vx + 0.5 * (ax + nax) * dt;
  let nvy = vy + 0.5 * (ay + nay) * dt;
  let nvz = vz + 0.5 * (az + naz) * dt;

  /* ECEF → geodetic */
  const nr     = Math.sqrt(nrx*nrx + nry*nry + nrz*nrz);
  const newAlt = nr - R_EARTH;                                   // m
  const newLat = Math.atan2(nrz, Math.sqrt(nrx*nrx + nry*nry)) / DEG;
  const newLon = Math.atan2(nry, nrx) / DEG;

  /* ── Reentry drag — active when deorbit burn done and descending ── */
  let reentryG = 0;
  if (S.dragonDeorbit && newAlt < 140_000) {
    const rho  = rhoAtAlt(newAlt);
    const spd  = Math.sqrt(nvx*nvx + nvy*nvy + nvz*nvz);

    /* Effective CdA: heat shield baseline, then drogues, then mains */
    let cdA = REENTRY_CD * REENTRY_AREA;
    if (S.dragonMains)  cdA = MAINS_CDA;
    else if (S.dragonDrogue) cdA = REENTRY_CD * REENTRY_AREA + DROGUE_CDA;

    const dragAcc = 0.5 * rho * cdA * spd * spd / REENTRY_MASS;
    reentryG = dragAcc / G0;

    /* Apply drag — decelerate along velocity vector */
    const df = Math.min(dragAcc * dt / spd, 1);
    nvx -= nvx * df;
    nvy -= nvy * df;
    nvz -= nvz * df;

    /* Parachute deployment events */
    if (newAlt < DROGUE_ALT && !S.dragonDrogue)  setState({ dragonDrogue: true });
    if (newAlt < MAINS_ALT  && !S.dragonMains)   setState({ dragonMains:  true });

    /* Blackout */
    if (newAlt < BLACKOUT_ALT && !S.dragonBlackout)           setState({ dragonBlackout: true  });
    if (newAlt < BLACKOUT_EXIT && S.dragonBlackout && !S.dragonSignal) setState({ dragonSignal: true });

    /* Splashdown */
    if (newAlt <= 0 && !S.dragonSplashdown) setState({ dragonSplashdown: true });
  }

  /* Speed */
  const newSpd = Math.sqrt(nvx*nvx + nvy*nvy + nvz*nvz);

  /* FPA = arcsin(v · r̂ / |v|) */
  const rHx  = nrx / nr, rHy = nry / nr, rHz = nrz / nr;
  const vRad = nvx * rHx + nvy * rHy + nvz * rHz;
  const newFPA = Math.asin(Math.max(-1, Math.min(1, vRad / newSpd))) / DEG;

  /* Heading from local ENU tangential velocity */
  const slat = Math.sin(newLat * DEG), clat = Math.cos(newLat * DEG);
  const slon = Math.sin(newLon * DEG), clon = Math.cos(newLon * DEG);
  const vE   = -slon * nvx + clon * nvy;
  const vN   = -slat * clon * nvx - slat * slon * nvy + clat * nvz;
  const newHdg = (Math.atan2(vE, vN) / DEG + 360) % 360;

  /* Orbit pass counter — ascending equator crossing */
  const prevLat   = S._orbitPrevLat ?? 0;
  const orbitPass = (S.orbitPass ?? 0) + (prevLat < 0 && newLat >= 0 ? 1 : 0);

  /* Orbital period — T = 2π√(a³/GM), a ≈ r for near-circular orbit */
  const T_orb = 2 * Math.PI * Math.sqrt(Math.pow(nr, 3) / GM);

  setState({
    spd:   newSpd / 0.5144,
    spdT:  newSpd / 0.5144,
    alt:   newAlt / 0.3048,
    altT:  newAlt / 0.3048,
    pitch: newFPA,
    vs:    vRad * 196.85,
    lat:   newLat,
    lon:   newLon,
    hdg:   newHdg,
    rocketG:    reentryG,
    rocketDynQ: 0,
    orbitVec:   { rx: nrx, ry: nry, rz: nrz, vx: nvx, vy: nvy, vz: nvz },
    orbitPass,
    orbitPeriod:    T_orb,
    _orbitPrevLat:  newLat,
    time: (S.time ?? 0) + dt,
  });
}

/* ── Dragon / Stage 2 separation ────────────────────────────────
   At dragonSepT, Dragon and Stage 2 become independent objects.
   Dragon continues on S.orbitVec (primary vehicle).
   Stage 2 gets its own S.s2Vec and propagates separately.        */

function _captureDragonSep() {
  const v = S.orbitVec;
  if (!v) return;
  setState({
    dragonSep: true,
    s2Vec:     { ...v },
    s2Lat:     S.lat ?? 0,
    s2Lon:     S.lon ?? 0,
    s2Alt:     S.alt ?? 0,
  });
}

function _tickS2(dt) {
  const v = S.s2Vec;
  if (!v) return;
  const { rx, ry, rz, vx, vy, vz } = v;

  const r2  = rx*rx + ry*ry + rz*rz;
  const r3  = r2 * Math.sqrt(r2);
  const k   = -GM / r3;
  const ax = k * rx, ay = k * ry, az = k * rz;

  const dt2 = dt * dt;
  const nrx = rx + vx * dt + 0.5 * ax * dt2;
  const nry = ry + vy * dt + 0.5 * ay * dt2;
  const nrz = rz + vz * dt + 0.5 * az * dt2;

  const nr2 = nrx*nrx + nry*nry + nrz*nrz;
  const nr3 = nr2 * Math.sqrt(nr2);
  const nk  = -GM / nr3;
  const nax = nk * nrx, nay = nk * nry, naz = nk * nrz;

  const nvx = vx + 0.5 * (ax + nax) * dt;
  const nvy = vy + 0.5 * (ay + nay) * dt;
  const nvz = vz + 0.5 * (az + naz) * dt;

  const nr    = Math.sqrt(nrx*nrx + nry*nry + nrz*nrz);
  const s2Lat = Math.atan2(nrz, Math.sqrt(nrx*nrx + nry*nry)) / DEG;
  const s2Lon = Math.atan2(nry, nrx) / DEG;
  const s2Alt = (nr - R_EARTH) / 0.3048;   // ft

  setState({
    s2Vec: { rx: nrx, ry: nry, rz: nrz, vx: nvx, vy: nvy, vz: nvz },
    s2Lat,
    s2Lon,
    s2Alt,
  });
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

  /* ── Orbital propagation — takes over after SECO ── */
  if (S.rocketSECO && !S.rocketOrbit) {
    _captureOrbitVec();   // first tick after SECO: freeze orbit vector
  }
  if (S.rocketOrbit && S.orbitVec) {
    /* Dragon / Stage 2 separation */
    const sepT = S.mission?.dragonSepT;
    if (sepT && !S.dragonSep && mT >= sepT) _captureDragonSep();
    if (S.dragonSep && S.s2Vec) _tickS2(dt);

    /* TLI burn — S-IVB re-ignition for trans-lunar injection */
    const tliT  = S.mission?.tliT;
    const tliDv = S.mission?.tliDv ?? 3147;
    if (tliT && !S.rocketTLI && mT >= tliT) _applyTLIBurn(tliDv);

    /* Deorbit burn */
    const deorbitT = S.mission?.deorbitT;
    const deorbitDv = S.mission?.deorbitDv ?? 170;
    if (deorbitT && !S.dragonDeorbit && mT >= deorbitT) _applyDeorbitBurn(deorbitDv);

    /* Stop propagation after splashdown — drop warp */
    if (S.dragonSplashdown) { setState({ warpFactor: 1 }); return; }

    _tickOrbit(dt);       // Keplerian propagation — replaces flat-Earth update
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
      /* Capture booster state for RTLS recovery */
      if (!S.booster?.active && !S.booster?.landed && perf.recovery?.rtls) {
        const spd_ms  = (S.spd ?? 0) * 0.5144;
        const fpa_rad = (S.pitch ?? 0) * DEG;
        setState({ booster: {
          active:      true,
          landed:      false,
          phase:       'flip',
          phaseStartT: mT,
          alt:         S.alt ?? 0,
          vVert:       spd_ms * Math.sin(fpa_rad),
          vDown:       spd_ms * Math.cos(fpa_rad),
          lat:         S.lat ?? 0,
          lon:         S.lon ?? 0,
          hdg:         S.hdg ?? 0,
          mass:        stg.massDry ?? 22000,
        }});
      }
      /* Jettison spent stage dry mass, advance to next stage */
      mass  -= stg.massDry ?? 0;
      stage += 1;
      coasting = false;
      /* Reset engine state for new stage */
      const nextStg = stages[stage - 1] ?? {};
      setState({ rocketActiveEngines: nextStg.engineCount ?? 1, rocketFailedEngines: [], rocketCECO: false, rocketCECOEngines: [],
                 rocketStageIgnitionT: mT });
    }
  } else if (mass > burnoutThreshold && S.engineState === 'running') {
    /* Check time-based burnout — caps burn to historical duration */
    const stgIgnT    = S.rocketStageIgnitionT ?? ignitionTime;
    const burnDur    = stg.burnDuration;
    const timeCutoff = burnDur && (mT - stgIgnT) >= burnDur;

    if (timeCutoff) {
      /* Force burnout at the historical time */
      if (stage < stages.length) {
        coasting = true; coastT = mT;
        if (!S.rocketMECO) setState({ rocketMECO: true });
      } else {
        if (!S.rocketSECO) setState({ rocketSECO: true });
      }
    } else {
      /* Thrusting — scale thrust by active engine fraction */
      const thrustSL  = stg.thrustSL  ?? 0;
      const thrustVac = stg.thrustVac ?? stg.thrustSL ?? 0;
      T    = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * engineFrac;
      mdot = T / ((stg.isp ?? 300) * G0);
    }
  } else if (mass <= burnoutThreshold && !coasting && stage < stages.length) {
    /* Burnout — start coast */
    coasting = true;
    coastT   = mT;
    if (!S.rocketMECO) setState({ rocketMECO: true });
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
  let aNet  = (T - (spd_ms > 0.1 ? D : 0)) / Math.max(1, mass);
  /* Centrifugal acceleration from horizontal motion (orbital mechanics):
     at orbital velocity, centrifugal = g and the rocket naturally orbits. */
  const centrifugal = vHoriz * vHoriz / (R_EARTH + alt_m);
  const aVert  = aNet * Math.sin(fpa_rad) - g + centrifugal;
  const aHoriz = aNet * Math.cos(fpa_rad);

  /* ── Axial G-load (positive = forward thrust, felt by vehicle) ── */
  let axialG = aNet / G0;

  /* ── G-triggered center-engine cutoff (CECO) ──
     When axial G exceeds cegCutoffG on stage 1 with a multi-engine vehicle
     and the center engine hasn't been cut yet, drop to (N-1) engines.       */
  const cegCutoff = perf.cegCutoffG;
  if (cegCutoff && !S.rocketCECO && stage === 1
      && activeEngines === totalEngines && totalEngines > 1
      && axialG > cegCutoff) {
    /* Center engine is last in the position array (index totalEngines-1) */
    setState({ rocketActiveEngines: totalEngines - 1, rocketCECO: true,
               rocketCECOEngines: [totalEngines - 1] });
  }

  /* ── G-load limiter — throttle thrust to keep axial g ≤ gLimit ── */
  const gLimit = perf.gLimit;
  if (gLimit && T > 0 && axialG > gLimit) {
    T     = Math.max(0, gLimit * G0 * mass + (spd_ms > 0.1 ? D : 0));
    mdot  = T / ((stg.isp ?? 300) * G0);
    aNet  = (T - (spd_ms > 0.1 ? D : 0)) / Math.max(1, mass);
    axialG = aNet / G0;
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

  /* ── LES jettison ── */
  const lesT = perf.lesJettisonT;
  if (lesT && !S.lesJettisoned && mT >= ignitionTime + lesT) {
    setState({ lesJettisoned: true });
  }

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

/* ── Booster recovery tick ─────────────────────────────────────
   Runs alongside tickRocket after stage separation.
   Phases: flip → boostback → coast → entry → glide → landing → landed
   ─────────────────────────────────────────────────────────────── */
export function tickBooster(dt) {
  const b = S.booster;
  if (!b?.active || b.landed) return;

  const mT       = S.time ?? 0;
  const phaseAge = mT - (b.phaseStartT ?? mT);
  const ac       = S.aircraft;
  const perf     = ac?.performance ?? {};
  const stg1     = perf.stages?.[0] ?? {};
  const rec      = perf.recovery   ?? {};

  const alt_m   = (b.alt ?? 0) * 0.3048;
  const rho     = rhoAtAlt(alt_m);
  const g       = G0 * Math.pow(R_EARTH / (R_EARTH + alt_m), 2);
  const atmFrac = Math.min(1, rho / 1.225);

  const mass  = b.mass  ?? (stg1.massDry ?? 22000);
  const vVert = b.vVert ?? 0;
  const vDown = b.vDown ?? 0;
  const spd   = Math.sqrt(vVert * vVert + vDown * vDown);

  const thrustSL  = stg1.thrustSL  ?? 0;
  const thrustVac = stg1.thrustVac ?? 0;
  const isp       = stg1.isp ?? 282;
  const nEng      = stg1.engineCount ?? 9;

  /* Grid fins multiply drag during glide */
  const dragMult = b.phase === 'glide' ? 8 : 1;
  const dynQ     = 0.5 * rho * spd * spd;
  const dragAcc  = spd > 0.5
    ? dynQ * (perf.Cd ?? 0.27) * (perf.area ?? 10.75) * dragMult / Math.max(1, mass)
    : 0;

  let thrustVert = 0, thrustDown = 0, mdot = 0;
  let newPhase = b.phase, newPhaseStartT = b.phaseStartT;

  if (b.phase === 'flip') {
    /* Cold-gas flip — no thrust, just coast */
    if (phaseAge >= (rec.flipDuration ?? 20)) {
      newPhase = 'boostback'; newPhaseStartT = mT;
    }

  } else if (b.phase === 'boostback') {
    const nB = rec.boostbackEngines  ?? 3;
    const th = rec.boostbackThrottle ?? 1.0;
    const T  = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * (nB / nEng) * th;
    const tA = T / Math.max(1, mass);
    mdot = T / (isp * G0);
    /* Retrograde burn — oppose full velocity vector to reverse downrange motion
       and reduce apogee. Real RTLS apogee ~100-130 km. */
    const vMag = Math.sqrt(vVert * vVert + vDown * vDown);
    if (vMag > 0.5) {
      thrustVert = -tA * (vVert / vMag);
      thrustDown = -tA * (vDown / vMag);
    }
    if (vDown < -50 || phaseAge >= (rec.boostbackDuration ?? 60)) {
      newPhase = 'coast'; newPhaseStartT = mT;
    }

  } else if (b.phase === 'coast') {
    /* No dedicated entry burn — grid fins handle atmospheric deceleration.
       Transition to glide when descending below 50 km. */
    if (alt_m <= 50_000 && vVert < 0) {
      newPhase = 'glide'; newPhaseStartT = mT;
    }

  } else if (b.phase === 'glide') {
    if (alt_m <= (rec.landingBurnAlt_m ?? 600) && vVert < 0) {
      newPhase = 'landing'; newPhaseStartT = mT;
    }

  } else if (b.phase === 'landing') {
    /* Single engine — proportional throttle to reach vVert=0 at surface */
    const T1max = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) / nEng;
    const tAMax = T1max / Math.max(1, mass);
    /* Required decel: v² / 2h, capped at max engine thrust */
    const reqDecel  = vVert < 0 ? Math.min(tAMax, vVert * vVert / (2 * Math.max(1, alt_m))) : 0;
    const tA        = Math.min(tAMax, reqDecel + g);
    const T         = tA * mass;
    mdot            = T / (isp * G0);
    thrustVert      = tA;   /* purely vertical — legs down, no horizontal thrust */
  }

  /* Drag components (opposing velocity) */
  const dragVert = spd > 0.5 ? -dragAcc * (vVert / spd) : 0;
  const dragDown = spd > 0.5 ? -dragAcc * (vDown / spd) : 0;

  /* Integrate */
  const newMass  = Math.max(stg1.massDry ?? 22000, mass - mdot * dt);
  const newVVert = vVert + (thrustVert + dragVert - g) * dt;
  const newVDown = vDown + (thrustDown + dragDown)      * dt;

  /* Position */
  const newAlt_m  = alt_m + newVVert * dt;
  const newAlt_ft = Math.max(0, newAlt_m / 0.3048);

  const hdg_rad = (b.hdg ?? 0) * DEG;
  const bLat    = b.lat ?? 0;
  const dDown   = newVDown * dt;
  const newLat  = bLat + (dDown * Math.cos(hdg_rad)) / (R_EARTH * DEG);
  const newLon  = (b.lon ?? 0) + (dDown * Math.sin(hdg_rad)) / (R_EARTH * Math.cos(bLat * DEG) * DEG);

  /* Touchdown */
  const padElev_m = (S.mission?.departure?.elevation ?? 0) * 0.3048;
  if (newAlt_m <= padElev_m + 3 && (newVVert < 0 || b.phase === 'landing')) {
    setState({ booster: { ...b,
      alt: (padElev_m + 2) / 0.3048, vVert: 0, vDown: 0,
      mass: newMass, lat: newLat, lon: newLon,
      phase: 'landed', landed: true, active: false,
    }});
    return;
  }

  setState({ booster: { ...b,
    alt: newAlt_ft, vVert: newVVert, vDown: newVDown,
    lat: newLat, lon: newLon, mass: newMass,
    phase: newPhase, phaseStartT: newPhaseStartT,
  }});
}
