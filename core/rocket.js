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
const GM_MOON = 4.9048695e12;    // m³/s²
const MOON_SMA = 384_400_000;    // m — mean Earth-Moon distance
const MOON_T_S = 27.32166 * 86400; // s — sidereal period

let _lastTrailT   = -1e9;
let _prevMoonDist = Infinity;

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

/* ── Osculating orbit from a vertical-plane state (apoapsis/periapsis altitudes, m) ──
   Used by the orbit-targeting upper-stage guidance: steer to raise the apoapsis to the target,
   cut off (SECO) when the periapsis reaches it. The closed-loop insertion guidance of every
   crewed program (Saturn V's IGM, Mercury/Vostok radio guidance) in one simple law. */
function _oscOrbit(alt_m, vH, vV) {
  const r = R_EARTH + alt_m, v2 = vH * vH + vV * vV;
  const energy = v2 / 2 - GM / r, sma = -GM / (2 * energy);
  const L = r * vH;                                          // angular momentum (tangential = horizontal)
  const e = Math.sqrt(Math.max(0, 1 + 2 * energy * L * L / (GM * GM)));
  return energy < 0 ? { apo: sma * (1 + e) - R_EARTH, peri: sma * (1 - e) - R_EARTH }
                    : { apo: Infinity, peri: -Infinity };
}
/* Target orbit altitude (m) for the active guidance — mission overrides aircraft. */
function _orbitTargetM() {
  return (S.mission?.targetOrbitKm ?? S.aircraft?.targetOrbitKm ?? 200) * 1000;
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

/* ── Dragon / Stage 2 separation ΔV (Draco departure + pushers) ── */
const DRACO_SEP_DV  = 1.5;    // m/s  Dragon prograde departure (pusher + Draco)
const S2_SEP_DV     = 0.3;    // m/s  Stage 2 retrograde (pusher reaction)

/* ── Moon position in ECI (XY plane, z=0) ───────────────────── */
export function moonECI(mT) {
  const refAngle = (S.mission?.moonRefAngle ?? 0) * DEG;
  const angle    = refAngle + mT * (2 * Math.PI / MOON_T_S);
  return { mx: MOON_SMA * Math.cos(angle), my: MOON_SMA * Math.sin(angle) };
}

/* ── TLI burn — apply prograde ΔV to escape Earth orbit ─────── */
function _applyTLIBurn(dv_ms) {
  const v = S.orbitVec;
  /* Project to equatorial (XY) plane at TLI so the 2D Moon model works.
     Two corrections needed:
     1. Position: scale rx/ry outward so sqrt(rx²+ry²) = original r (no
        altitude jump from zeroing rz at non-zero latitude).
     2. Velocity: use vtot + dv_ms as the target XY speed so the full
        prograde ΔV is credited even though vz was non-zero (otherwise the
        spacecraft arrives short of the Moon by ~1600 m/s). */
  const rtot = Math.sqrt(v.rx*v.rx + v.ry*v.ry + v.rz*v.rz);
  const rxy  = Math.sqrt(v.rx*v.rx + v.ry*v.ry);
  const rScale = rxy > 0 ? rtot / rxy : 1;   // = 1 / cos(lat)

  const vxy  = Math.sqrt(v.vx*v.vx + v.vy*v.vy);
  const vtot = Math.sqrt(v.vx*v.vx + v.vy*v.vy + v.vz*v.vz);
  const vf   = vxy > 0 ? (vtot + dv_ms) / vxy : 1;

  const dur = S.mission?.tliDuration ?? Math.round(dv_ms / 7.5);
  const mT  = S.time ?? 0;
  const { mx, my } = moonECI(mT);
  const vDir = Math.atan2(v.vy, v.vx) * (180 / Math.PI);
  const moonAngle = Math.atan2(my, mx) * (180 / Math.PI);
  console.log(`[TLI] t=${mT}s  vDir=${vDir.toFixed(1)}°  moonAngle=${moonAngle.toFixed(1)}°  Δangle=${((moonAngle - vDir + 540) % 360 - 180).toFixed(1)}°`);
  console.log(`[TLI] pre:  alt=${((Math.sqrt(v.rx**2+v.ry**2+v.rz**2)-R_EARTH)/1000).toFixed(0)}km  spd=${vtot.toFixed(0)}m/s`);
  console.log(`[TLI] post: alt=${((rxy*rScale-R_EARTH)/1000).toFixed(0)}km  spd=${(vtot+dv_ms).toFixed(0)}m/s  rScale=${rScale.toFixed(4)}`);
  setState({
    rocketTLI:        true,
    rocketTLIBurnEnd: mT + dur,
    orbitVec: { ...v,
      rx: v.rx * rScale,
      ry: v.ry * rScale,
      rz: 0,
      vx: v.vx * vf,
      vy: v.vy * vf,
      vz: 0,
    },
  });
}

/* ── Moon velocity in ECI frame at mission time mT ────────────── */
function _moonVelECI(mT) {
  const omega = 2 * Math.PI / MOON_T_S;
  const angle = ((S.mission?.moonRefAngle ?? 0) * DEG) + mT * omega;
  return { vmx: -MOON_SMA * omega * Math.sin(angle),
           vmy:  MOON_SMA * omega * Math.cos(angle) };
}

/* ── LOI burn — retrograde ΔV in Moon-relative frame ────────── */
function _applyLOIBurn(dv_ms) {
  const v   = S.orbitVec;
  const mT  = S.time ?? 0;
  const { vmx, vmy } = _moonVelECI(mT);
  /* Velocity relative to Moon (Moon-centric frame) */
  const rvx = v.vx - vmx;
  const rvy = v.vy - vmy;
  const rvz = v.vz ?? 0;
  const spd = Math.sqrt(rvx*rvx + rvy*rvy + rvz*rvz);

  /* Safety cap: post-LOI Moon-relative speed must stay above v_circular so
     the burn point remains periapsis (not apoapsis) of the capture orbit.
     20 m/s margin prevents numerical edge-cases; at historical approach
     speeds (≥ 2502 m/s) the cap is never reached and full loiDv applies. */
  const { rx, ry } = v;
  const { mx, my } = moonECI(mT);
  const moonR  = Math.sqrt((rx - mx) ** 2 + (ry - my) ** 2);
  const vCirc  = Math.sqrt(GM_MOON / moonR);
  const maxDv  = Math.max(0, spd - (vCirc + 20));
  const burn   = Math.min(dv_ms, maxDv);

  /* Retrograde: subtract ΔV along Moon-relative velocity unit vector */
  const f = burn / spd;
  console.log(`[LOI] t=${Math.round(mT)}s  moonR=${(moonR/1000).toFixed(0)}km  v_rel=${spd.toFixed(0)}m/s  v_circ=${vCirc.toFixed(0)}m/s  dv_actual=${burn.toFixed(0)}m/s`);
  setState({
    rocketLOI:  true,
    loiActualT: mT,
    loiMoonR:   moonR,
    orbitVec: { ...v,
      vx: v.vx - f * rvx,
      vy: v.vy - f * rvy,
      vz: (v.vz ?? 0) - f * rvz,
    },
  });
}

/* ── TEI burn — prograde ΔV in Moon-relative frame ──────────── */
function _applyTEIBurn(dv_ms) {
  const v   = S.orbitVec;
  const mT  = S.time ?? 0;
  const { vmx, vmy } = _moonVelECI(mT);
  const rvx = v.vx - vmx;
  const rvy = v.vy - vmy;
  const rvz = v.vz ?? 0;
  const spd = Math.sqrt(rvx*rvx + rvy*rvy + rvz*rvz);
  const f = dv_ms / spd;
  setState({
    rocketTEI: true,
    orbitVec: { ...v,
      vx: v.vx + f * rvx,
      vy: v.vy + f * rvy,
      vz: (v.vz ?? 0) + f * rvz,
    },
  });
}

const MOON_R      = 1_737_000;    // Moon radius, m
const MOON_R_MIN  = MOON_R + 100_000; // minimum safe propagation distance, m
const MOON_SOI    = 66_000_000;   // Moon sphere of influence, m
const MCC_TARGET  = MOON_R + 113_000; // Apollo 8 target periapsis: 113 km altitude

/* ── Propagate trajectory, return minimum Moon distance ─────── */
function _propagateMinDist(pos, vel, tof, t0) {
  let { rx, ry, rz } = pos;
  let { vx, vy, vz } = vel;
  let minDist = Infinity;
  let t = t0, rem = tof;

  while (rem > 0) {
    const { mx, my } = moonECI(t);
    const moonR_now = Math.sqrt((rx-mx)**2 + (ry-my)**2);
    /* Fine steps near Moon for periapsis accuracy; coarser far away. */
    const DT = moonR_now < 10_000_000 ? 30 : 120;
    const step = Math.min(DT, rem);
    rem -= step;

    const r2  = rx*rx + ry*ry + rz*rz;
    const r3  = r2 * Math.sqrt(r2);
    const ke  = -GM / r3;
    const dmx = rx - mx, dmy = ry - my;
    const mr_raw = Math.sqrt(dmx*dmx + dmy*dmy + rz*rz);
    if (mr_raw < minDist) minDist = mr_raw;
    if (mr_raw < MOON_R_MIN) return minDist;   // below safe altitude — stop

    const mr3 = Math.pow(mr_raw, 3);
    const km  = -GM_MOON / mr3;
    const ax  = ke*rx + km*dmx, ay = ke*ry + km*dmy, az = ke*rz + km*rz;

    const s2  = step * step;
    const nrx = rx + vx*step + 0.5*ax*s2;
    const nry = ry + vy*step + 0.5*ay*s2;
    const nrz = rz + vz*step + 0.5*az*s2;

    t += step;
    const { mx: nmx, my: nmy } = moonECI(t);
    const nr2  = nrx*nrx + nry*nry + nrz*nrz;
    const nr3  = nr2 * Math.sqrt(nr2);
    const nke  = -GM / nr3;
    const ndmx = nrx - nmx, ndmy = nry - nmy;
    const nmr  = Math.max(Math.sqrt(ndmx*ndmx + ndmy*ndmy + nrz*nrz), MOON_R_MIN);
    if (nmr < minDist) minDist = nmr;
    const nmr3 = Math.pow(nmr, 3);
    const nkm  = -GM_MOON / nmr3;
    const nax  = nke*nrx + nkm*ndmx;
    const nay  = nke*nry + nkm*ndmy;
    const naz  = nke*nrz + nkm*nrz;

    vx += 0.5*(ax+nax)*step; vy += 0.5*(ay+nay)*step; vz += 0.5*(az+naz)*step;
    rx = nrx; ry = nry; rz = nrz;
  }
  return minDist;
}

/* ── Propagate trajectory, return final position ─────────────── */
function _propagatePos(pos, vel, tof, t0) {
  let { rx, ry, rz } = pos;
  let { vx, vy, vz } = vel;
  const DT = 3600;   // 1-hour steps — fast enough for Newton Jacobians
  let t = t0, rem = tof;

  while (rem > 0) {
    const step = Math.min(DT, rem);
    rem -= step;

    const { mx, my } = moonECI(t);
    const r2  = rx*rx + ry*ry + rz*rz;
    const r3  = r2 * Math.sqrt(r2);
    const ke  = -GM / r3;
    const dmx = rx - mx, dmy = ry - my;
    const mr  = Math.max(Math.sqrt(dmx*dmx + dmy*dmy + rz*rz), MOON_R_MIN);
    const mr3 = Math.pow(mr, 3);
    const km  = -GM_MOON / mr3;
    const ax  = ke*rx + km*dmx, ay = ke*ry + km*dmy, az = ke*rz + km*rz;

    const s2  = step * step;
    const nrx = rx + vx*step + 0.5*ax*s2;
    const nry = ry + vy*step + 0.5*ay*s2;
    const nrz = rz + vz*step + 0.5*az*s2;

    t += step;
    const { mx: nmx, my: nmy } = moonECI(t);
    const nr2  = nrx*nrx + nry*nry + nrz*nrz;
    const nr3  = nr2 * Math.sqrt(nr2);
    const nke  = -GM / nr3;
    const ndmx = nrx - nmx, ndmy = nry - nmy;
    const nmr  = Math.max(Math.sqrt(ndmx*ndmx + ndmy*ndmy + nrz*nrz), MOON_R_MIN);
    const nmr3 = Math.pow(nmr, 3);
    const nkm  = -GM_MOON / nmr3;
    const nax  = nke*nrx + nkm*ndmx;
    const nay  = nke*nry + nkm*ndmy;
    const naz  = nke*nrz + nkm*nrz;

    vx += 0.5*(ax+nax)*step; vy += 0.5*(ay+nay)*step; vz += 0.5*(az+naz)*step;
    rx = nrx; ry = nry; rz = nrz;
  }
  return { rx, ry, rz };
}

/* ── Phase 1: Newton solver — aim into Moon's SOI at loiT ───── */
function _newtonToSOI(mT, pos, vx0, vy0, vz0, loiT) {
  const tof    = loiT - mT;
  const PERTURB = 1.0;   // m/s for Jacobian finite difference
  const MAX_STEP = 500;  // m/s cap per Newton step

  let vx = vx0, vy = vy0;

  for (let iter = 0; iter < 50; iter++) {
    const p0 = _propagatePos(pos, { vx, vy, vz: vz0 }, tof, mT);
    const { mx: mxT, my: myT } = moonECI(mT + tof);
    const ex = p0.rx - mxT, ey = p0.ry - myT;
    const dist = Math.sqrt(ex*ex + ey*ey);
    if (dist < MOON_SOI) {
      console.log(`[Newton] SOI in ${iter} iters — dist ${(dist/1e6).toFixed(0)} km`);
      return { vx, vy, success: true };
    }

    const px = _propagatePos(pos, { vx: vx + PERTURB, vy,             vz: vz0 }, tof, mT);
    const py = _propagatePos(pos, { vx,               vy: vy + PERTURB, vz: vz0 }, tof, mT);
    const J00 = (px.rx - p0.rx) / PERTURB, J10 = (px.ry - p0.ry) / PERTURB;
    const J01 = (py.rx - p0.rx) / PERTURB, J11 = (py.ry - p0.ry) / PERTURB;
    const det = J00*J11 - J01*J10;
    if (Math.abs(det) < 1e-12) break;

    const dvx = -(J11*ex - J01*ey) / det;
    const dvy = -(-J10*ex + J00*ey) / det;
    const dvMag = Math.sqrt(dvx*dvx + dvy*dvy);
    const scale = dvMag > MAX_STEP ? MAX_STEP / dvMag : 1;
    vx += dvx * scale;
    vy += dvy * scale;
  }

  const pF = _propagatePos(pos, { vx, vy, vz: vz0 }, tof, mT);
  const { mx: mxF, my: myF } = moonECI(mT + tof);
  const dF = Math.sqrt((pF.rx - mxF)**2 + (pF.ry - myF)**2);
  console.warn(`[Newton] done — dist ${(dF/1e6).toFixed(0)} km`);
  return { vx, vy, success: dF < MOON_SOI };
}

/* ── Phase 2: bisect periapsis to MCC_TARGET ─────────────────── */
function _bisectPeriapsis(mT, pos, vx0, vy0, vz0, tof, label) {
  const spd = Math.sqrt(vx0*vx0 + vy0*vy0);
  const px = -vy0 / spd, py = vx0 / spd;   // perpendicular unit vector

  /* Coarse scan to bracket — wide range handles post-Newton high-energy trajectories */
  let lo = null, hi = null;
  for (let c = -5000; c <= 5000; c += 250) {
    const d = _propagateMinDist(pos, { vx: vx0 + c*px, vy: vy0 + c*py, vz: vz0 }, tof, mT);
    if (d < MCC_TARGET) { if (lo === null) lo = c; }
    else                { if (lo !== null && hi === null) { hi = c; break; } }
  }
  if (lo === null || hi === null) {
    const peri = _propagateMinDist(pos, { vx: vx0, vy: vy0, vz: vz0 }, tof, mT);
    console.warn(`[${label}] bisect: no bracket (periapsis ${(peri/1000).toFixed(0)} km)`);
    return { vx: vx0, vy: vy0, dvMag: 0 };
  }

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const d = _propagateMinDist(pos, { vx: vx0 + mid*px, vy: vy0 + mid*py, vz: vz0 }, tof, mT);
    if (d < MCC_TARGET) lo = mid; else hi = mid;
    if (Math.abs(hi - lo) < 0.5) break;
  }

  const c = (lo + hi) / 2;
  const vx = vx0 + c * px, vy = vy0 + c * py;
  console.log(`[${label}] bisect: ${c.toFixed(1)} m/s perp → ${(MCC_TARGET/1000).toFixed(0)} km peri`);
  return { vx, vy, dvMag: Math.abs(c) };
}

/* ── Combined MCC burn: Newton to SOI → bisect periapsis ─────── */
function _applyMCC(mT, label, stateKey) {
  const loiT = S.mission?.loiT ?? 305000;
  const tofNominal = loiT - mT;
  /* Periapsis can occur up to ~6h after loiT (trajectory geometry).
     Extend window so _propagateMinDist captures the actual closest approach. */
  const tofBisect  = tofNominal + 6 * 3600;
  const pos  = { rx: S.orbitVec.rx, ry: S.orbitVec.ry, rz: S.orbitVec.rz ?? 0 };
  const vx0  = S.orbitVec.vx, vy0 = S.orbitVec.vy, vz0 = S.orbitVec.vz ?? 0;
  if (Math.sqrt(vx0*vx0 + vy0*vy0) < 1) { setState({ [stateKey]: true }); return; }
  { const { mx, my } = moonECI(mT);
    const earthDist = Math.sqrt(pos.rx**2 + pos.ry**2 + pos.rz**2);
    const moonDist  = Math.sqrt((pos.rx-mx)**2 + (pos.ry-my)**2);
    const spd       = Math.sqrt(vx0**2 + vy0**2 + vz0**2);
    const vDir      = Math.atan2(vy0, vx0) * (180/Math.PI);
    const moonAngle = Math.atan2(my, mx) * (180/Math.PI);
    console.log(`[${label}] t=${mT}s  earthDist=${(earthDist/1000).toFixed(0)}km  moonDist=${(moonDist/1e6).toFixed(2)}Mm  spd=${spd.toFixed(0)}m/s  vDir=${vDir.toFixed(1)}°  moonAngle=${moonAngle.toFixed(1)}°`);
  }

  /* Already on target? (impact trajectories with periNow≤MOON_R always need correction) */
  const periNow = _propagateMinDist(pos, { vx: vx0, vy: vy0, vz: vz0 }, tofBisect, mT);
  if (periNow > MOON_R && Math.abs(periNow - MCC_TARGET) < 50_000) {
    console.log(`[${label}] on target (${(periNow/1000).toFixed(0)} km) — no burn`);
    setState({ [stateKey]: true, [`${stateKey.replace('rocket','').toLowerCase()}DvMag`]: 0 });
    return;
  }

  let vx = vx0, vy = vy0;

  /* Phase 1: steer into Moon SOI only if the trajectory misses it entirely.
     Use periNow (already computed with 600 s steps) — the coarse _propagatePos
     (3600 s) can show a large miss when the spacecraft actually flies past the Moon
     before loiT, causing Phase 1 to fire incorrectly. */
  if (periNow > MOON_SOI) {
    console.log(`[${label}] Phase1 Newton: periapsis ${(periNow/1e6).toFixed(0)} Mm — steering into SOI`);
    const nr = _newtonToSOI(mT, pos, vx0, vy0, vz0, loiT);
    if (!nr.success) {
      console.warn(`[${label}] Newton failed — marking done without burn`);
      setState({ [stateKey]: true });
      return;
    }
    vx = nr.vx; vy = nr.vy;
  }

  /* Phase 2: bisect periapsis altitude to target (extended window) */
  const r2 = _bisectPeriapsis(mT, pos, vx, vy, vz0, tofBisect, label);
  const dvTotal = Math.sqrt((r2.vx - vx0)**2 + (r2.vy - vy0)**2);
  const dvLabel = stateKey === 'rocketMCC1' ? 'mcc1' : stateKey === 'rocketMCC2' ? 'mcc2' : 'mcc4';
  console.log(`[${label}] total ΔV ${dvTotal.toFixed(1)} m/s`);
  setState({
    [stateKey]:            true,
    [`${dvLabel}DvMag`]:   dvTotal,
    [`${dvLabel}DvX`]:     r2.vx - vx0,
    [`${dvLabel}DvY`]:     r2.vy - vy0,
    orbitVec: { ...S.orbitVec, vx: r2.vx, vy: r2.vy },
  });
}

function _applyMCC1Burn(mT) { _applyMCC(mT, 'MCC-1', 'rocketMCC1'); }
function _applyMCC2Burn(mT) { _applyMCC(mT, 'MCC-2', 'rocketMCC2'); }
function _applyMCC4Burn(mT) { _applyMCC(mT, 'MCC-4', 'rocketMCC4'); }

/* ── Draco RCS impulse — shared primitive ────────────────────────
   Apply a ΔV (m/s) to an orbital state vector along a named direction.
   One mechanism for every Draco use: separation, deorbit, and (later) the
   ISS-approach phasing burns. Position is unchanged; only velocity is nudged.
   dir: 'prograde' | 'retrograde' | 'radial-out' | 'radial-in'.               */
function _applyDracoImpulse(vec, dir, dV) {
  const { rx, ry, rz, vx, vy, vz } = vec;
  let ux, uy, uz;
  if (dir === 'radial-out' || dir === 'radial-in') {
    const rm = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1;
    ux = rx / rm; uy = ry / rm; uz = rz / rm;
    if (dir === 'radial-in') { ux = -ux; uy = -uy; uz = -uz; }
  } else {
    const sm = Math.sqrt(vx*vx + vy*vy + vz*vz) || 1;
    ux = vx / sm; uy = vy / sm; uz = vz / sm;
    if (dir === 'retrograde') { ux = -ux; uy = -uy; uz = -uz; }
  }
  return { rx, ry, rz, vx: vx + ux*dV, vy: vy + uy*dV, vz: vz + uz*dV };
}

/* ── Deorbit burn — retrograde Draco ΔV on the Dragon's orbitVec ── */
function _applyDeorbitBurn(dv_ms) {
  setState({
    dragonDeorbit: true,
    orbitVec: _applyDracoImpulse(S.orbitVec, 'retrograde', dv_ms),
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
  _prevMoonDist = Infinity;
}

function _tickOrbit(dt) {
  const { rx, ry, rz, vx, vy, vz } = S.orbitVec;
  const mT = S.time ?? 0;

  /* Moon position in ECI at current time */
  const { mx, my } = moonECI(mT);

  /* ── Velocity Verlet — Earth + Moon gravity ─────────────────
     Step 1: acceleration at current position */
  const r2  = rx*rx + ry*ry + rz*rz;
  const r3  = r2 * Math.sqrt(r2);
  const k   = -GM / r3;
  const dmx = rx - mx, dmy = ry - my;                         // spacecraft → Moon vector
  const mr2_raw = dmx*dmx + dmy*dmy + rz*rz;
  /* Clamp Moon distance for gravity — prevents blowup if integrator
     steps through lunar surface (point-mass model has no floor). */
  const mr2 = Math.max(mr2_raw, MOON_R_MIN * MOON_R_MIN);
  const mr3 = mr2 * Math.sqrt(mr2);
  const mk  = -GM_MOON / mr3;
  const ax  = k * rx + mk * dmx;
  const ay  = k * ry + mk * dmy;
  const az  = k * rz + mk * rz;                               // mz = 0

  /* Step 2: advance position */
  const dt2 = dt * dt;
  const nrx = rx + vx * dt + 0.5 * ax * dt2;
  const nry = ry + vy * dt + 0.5 * ay * dt2;
  const nrz = rz + vz * dt + 0.5 * az * dt2;

  /* Step 3: Moon position and acceleration at new position */
  const { mx: nmx, my: nmy } = moonECI(mT + dt);
  const nr2  = nrx*nrx + nry*nry + nrz*nrz;
  const nr3  = nr2 * Math.sqrt(nr2);
  const nk   = -GM / nr3;
  const ndmx = nrx - nmx, ndmy = nry - nmy;
  const nmr2_raw = ndmx*ndmx + ndmy*ndmy + nrz*nrz;
  const nmr2 = Math.max(nmr2_raw, MOON_R_MIN * MOON_R_MIN);
  const nmr3 = nmr2 * Math.sqrt(nmr2);
  const nmk  = -GM_MOON / nmr3;
  const nax  = nk * nrx + nmk * ndmx;
  const nay  = nk * nry + nmk * ndmy;
  const naz  = nk * nrz + nmk * nrz;

  /* Step 4: full velocity kick */
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
    if (newAlt <= 0 && !S.dragonSplashdown) {
      setState({ dragonSplashdown: true });
    }
  }

  /* ── Starship reentry — drag + lift + bank-angle guidance ───────
     Active for vehicleType='starship' on descending ballistic arc.
     Lift is perpendicular to velocity, rotated by a bank angle that
     a proportional controller drives toward the target bearing.
     mission.reentryGuidance = { targetLat, targetLon, ldRatio,
                                  bankGain, bankMax }
     Without reentryGuidance (or ldRatio = 0) behaviour is unchanged. */
  if (S.aircraft?.id === 'starship' && !S.starshipSplashdown) {
    if (newAlt < 80_000 && (S.pitch ?? 0) < 0) {
      const rho = rhoAtAlt(newAlt);
      const spd = Math.sqrt(nvx*nvx + nvy*nvy + nvz*nvz);
      if (spd > 1) {
        const SS_CDA  = 400;
        const SS_MASS = 120_000;
        const dragAcc = 0.5 * rho * SS_CDA * spd * spd / SS_MASS;
        reentryG = dragAcc / G0;

        /* Drag — retrograde */
        const df = Math.min(dragAcc * dt / spd, 0.5);
        nvx -= nvx * df; nvy -= nvy * df; nvz -= nvz * df;

        /* Lift + steering */
        const rg  = S.mission?.reentryGuidance;
        const LD  = rg?.ldRatio ?? 0;
        if (LD > 0) {
          const liftAcc = dragAcc * LD;

          /* Unit vectors */
          const vHx = nvx/spd, vHy = nvy/spd, vHz = nvz/spd;
          const rHx = nrx/nr,  rHy = nry/nr,  rHz = nrz/nr;

          /* Lift-up: component of r̂ perpendicular to v̂ */
          const vDotR = vHx*rHx + vHy*rHy + vHz*rHz;
          let luX = rHx - vDotR*vHx, luY = rHy - vDotR*vHy, luZ = rHz - vDotR*vHz;
          const luMag = Math.sqrt(luX*luX + luY*luY + luZ*luZ);
          if (luMag > 1e-6) { luX /= luMag; luY /= luMag; luZ /= luMag; }

          /* "Right": v̂ × lift-up */
          const lrX = vHy*luZ - vHz*luY;
          const lrY = vHz*luX - vHx*luZ;
          const lrZ = vHx*luY - vHy*luX;

          /* Current velocity heading (newHdg not yet in scope — compute inline) */
          const _slat = Math.sin(newLat * DEG), _clat = Math.cos(newLat * DEG);
          const _slon = Math.sin(newLon * DEG), _clon = Math.cos(newLon * DEG);
          const _vE   = -_slon * nvx + _clon * nvy;
          const _vN   = -_slat * _clon * nvx - _slat * _slon * nvy + _clat * nvz;
          const curHdg = (Math.atan2(_vE, _vN) / DEG + 360) % 360;

          /* Bearing to target → heading error → bank command */
          const tLat = (rg.targetLat ?? 0) * DEG;
          const tLon = (rg.targetLon ?? 0) * DEG;
          const cLat = newLat * DEG, cLon = newLon * DEG;
          const dLon = tLon - cLon;
          const bearing = Math.atan2(
            Math.sin(dLon) * Math.cos(tLat),
            Math.cos(cLat) * Math.sin(tLat) - Math.sin(cLat) * Math.cos(tLat) * Math.cos(dLon)
          ) / DEG;
          const headingErr = ((bearing - curHdg + 540) % 360) - 180;
          const bankMax  = rg.bankMax  ?? 75;
          const bankGain = rg.bankGain ?? 0.8;
          const bankCmd  = Math.max(-bankMax, Math.min(bankMax, bankGain * headingErr));

          /* Rate-limit bank angle (~15°/s, matching real body-flap actuation) */
          const prevBank = S.starshipBankAngle ?? 0;
          const maxRate  = 15 * dt;
          const bank     = prevBank + Math.max(-maxRate, Math.min(maxRate, bankCmd - prevBank));

          /* Lift vector rotated by bank */
          const bRad = bank * DEG;
          const ldX = Math.cos(bRad)*luX + Math.sin(bRad)*lrX;
          const ldY = Math.cos(bRad)*luY + Math.sin(bRad)*lrY;
          const ldZ = Math.cos(bRad)*luZ + Math.sin(bRad)*lrZ;

          nvx += ldX * liftAcc * dt;
          nvy += ldY * liftAcc * dt;
          nvz += ldZ * liftAcc * dt;

          setState({ starshipBankAngle: bank });
        }

        if (newAlt < 5_000 && !S.starshipReentry) setState({ starshipReentry: true });
      }
    }
    if (newAlt <= 0) {
      setState({ starshipSplashdown: true, warpFactor: 1 });
    }
  }
  const clampedAlt = Math.max(0, newAlt);

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

  /* ── Starship belly-flop visual attitude ────────────────────────
     Purely visual: drives outside.js rendering, not physics.
     Post-SECO: body pitch converges toward 0° (belly-first, max drag).
     Near landing: rapid flip to -90° (engines-down) over flipDuration. */
  let starshipBodyPitch = S.starshipBodyPitch ?? newFPA;
  if (S.aircraft?.id === 'starship' && !S.starshipSplashdown) {
    const _rec  = S.aircraft?.performance?.recovery ?? {};
    const _fDur = _rec.flipDuration ?? 18;
    const _fAlt = (_rec.landingBurnAlt_m ?? 800) + 2000;  // start flip with enough time to complete

    if (!S.starshipFlipStartT && newAlt <= _fAlt && vRad < 0) {
      setState({ starshipFlipStartT: mT });
    }

    if (S.starshipFlipStartT) {
      const elapsed = mT - (S.starshipFlipStartT ?? mT);
      const frac    = Math.max(0, Math.min(1, elapsed / _fDur));
      const eased   = 1 - (1 - frac) * (1 - frac);   // ease-out: fast start, slow finish
      starshipBodyPitch = eased * 90;
    } else {
      /* Belly-flop: exponential convergence to 0° — ~60 s time constant */
      starshipBodyPitch += (0 - starshipBodyPitch) * (1 - Math.exp(-dt / 60));
    }
  }

  /* Cislunar trail — only after TLI (parking orbit triangles are noise on this map) */
  if (S.rocketTLI && ((S.cislunarTrail?.length === 0) || mT - _lastTrailT >= 1800)) {
    _lastTrailT = mT;
    const trail = S.cislunarTrail ?? [];
    trail.push({ rx: nrx, ry: nry });
    setState({ cislunarTrail: trail });
  }

  setState({
    spd:   newSpd / 0.5144,
    spdT:  newSpd / 0.5144,
    alt:   clampedAlt / 0.3048,
    altT:  clampedAlt / 0.3048,
    pitch: newFPA,
    vs:    vRad * 196.85,
    lat:   newLat,
    lon:   newLon,
    hdg:   newHdg,
    rocketG:    reentryG,
    rocketDynQ: 0,
    orbitVec:   { rx: nrx, ry: nry, rz: nrz, vx: nvx, vy: nvy, vz: nvz },
    orbitPass,
    orbitPeriod:      T_orb,
    _orbitPrevLat:    newLat,
    starshipBodyPitch,
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
  /* Mechanical pushers + Dragon Draco departure burn: the Dragon gets a small prograde
     nudge (rises, pulls ahead), Stage 2 the retrograde pusher reaction (falls behind,
     lower). ~1.8 m/s relative → the two visibly drift apart over the following minutes. */
  setState({
    dragonSep: true,
    orbitVec:  _applyDracoImpulse(v, 'prograde',   DRACO_SEP_DV),
    s2Vec:     _applyDracoImpulse(v, 'retrograde', S2_SEP_DV),
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

    /* TLI burn — S-IVB re-ignition for trans-lunar injection.
       Split-step: rewind spacecraft to exactly tliT before applying the impulse
       so the TLI direction is dt-independent (same result at any warp / step size). */
    const tliT  = S.mission?.tliT;
    const tliDv = S.mission?.tliDv ?? 3147;
    if (tliT && !S.rocketTLI && mT >= tliT) {
      const excess = mT - tliT;
      if (excess > 0.05 && excess < 60) {
        const v = S.orbitVec;
        const r3d = Math.sqrt(v.rx*v.rx + v.ry*v.ry + v.rz*v.rz);
        const omega = Math.sqrt(GM / (r3d * r3d * r3d));
        const dtheta = -omega * excess;
        const cos_dt = Math.cos(dtheta), sin_dt = Math.sin(dtheta);
        setState({
          time: tliT,
          orbitVec: { ...v,
            rx: v.rx * cos_dt - v.ry * sin_dt,
            ry: v.rx * sin_dt + v.ry * cos_dt,
            vx: v.vx * cos_dt - v.vy * sin_dt,
            vy: v.vx * sin_dt + v.vy * cos_dt,
          },
        });
      }
      _applyTLIBurn(tliDv);
    }

    /* MCC-1/2/4 — periapsis bisection corrections during trans-lunar coast */
    const mcc1T = S.mission?.mcc1T;
    if (mcc1T && !S.rocketMCC1 && S.rocketTLI && mT >= mcc1T) _applyMCC1Burn(mT);

    const mcc2T = S.mission?.mcc2T;
    if (mcc2T && !S.rocketMCC2 && S.rocketMCC1 && mT >= mcc2T) _applyMCC2Burn(mT);

    /* MCC-4 fires only before LOI warp-cap zone (< 2h to loiT is handled by warp) */
    const mcc4T = S.mission?.mcc4T;
    const loiT_mcc = S.mission?.loiT;
    if (mcc4T && !S.rocketMCC4 && S.rocketMCC1 && mT >= mcc4T
        && !(loiT_mcc && (loiT_mcc - mT) < 7_200)) _applyMCC4Burn(mT);

    /* S-IVB separation — CSM pulls away from spent stage in parking orbit */
    const sivbSepT = S.mission?.sivbSepT;
    if (sivbSepT && !S.sivbSep && mT >= sivbSepT)
      setState({ sivbSep: true, rocketMass: perf.payload ?? 29000 });

    /* LOI — proximity-based: fires at Moon periapsis (closing → receding).
       Fallback: fires at loiT if proximity hasn't triggered (MCC-1 miss).
       Drop warp on approach so the periapsis tick is never skipped. */
    const loiT_sched = S.mission?.loiT;
    const loiDv = S.mission?.loiDv ?? 1067;
    if (!S.rocketLOI && S.rocketTLI && S.mission?.loiDv != null) {
      const { mx, my } = moonECI(mT);
      const { rx, ry, rz } = S.orbitVec;
      const moonDist = Math.sqrt((rx - mx) ** 2 + (ry - my) ** 2);
      /* Tiered warp cap: drop warp when near Moon OR within 2 h of loiT */
      const wf = S.warpFactor ?? 1;
      const nearLoiT = loiT_sched && (loiT_sched - mT) < 7_200;
      if      (moonDist < 50_000_000  || (nearLoiT && moonDist < 200_000_000)) {
        if (wf > 100)   setState({ warpFactor: 100 });
      } else if (moonDist < 100_000_000 && wf > 1_000) {
        setState({ warpFactor: 1_000 });
      }
      /* Primary: periapsis detection inside 66 Mm (Moon SOI).
         Use Moon-relative radial velocity (not ECI delta) — the Moon moves at
         ~1 km/s, so ECI distance can increase while spacecraft is still
         approaching, triggering LOI prematurely. */
      if (moonDist < 66_000_000) {
        const { vx, vy } = S.orbitVec;
        const { vmx, vmy } = _moonVelECI(mT);
        const ux = (rx - mx) / moonDist, uy = (ry - my) / moonDist;
        const vRel = (vx - vmx) * ux + (vy - vmy) * uy; // >0 = receding
        if (!S.mission?.noLOI && vRel > 0) _applyLOIBurn(loiDv);
      }
      /* Fallback: time-based trigger at loiT when within 200 Mm */
      if (!S.mission?.noLOI && !S.rocketLOI && loiT_sched && mT >= loiT_sched && moonDist < 200_000_000) {
        _applyLOIBurn(loiDv);
      }
      _prevMoonDist = moonDist;
    }

    /* TEI — relative to actual LOI time
       Drop warp when approaching TEI window so the burn isn't skipped. */
    const teiDv = S.mission?.teiDv ?? 1070;
    if (S.rocketLOI && !S.rocketTEI) {
      const loiActual = S.loiActualT ?? 0;
      const teiOffset = (S.mission?.teiT ?? 0) - (S.mission?.loiT ?? 0);
      const teiTarget = loiActual + teiOffset;
      if (loiActual && teiTarget - mT < 3600 && (S.warpFactor ?? 1) > 100) {
        setState({ warpFactor: 100 });
      }
      if (loiActual && mT >= teiTarget) _applyTEIBurn(teiDv);
    }

    /* PC+2 — prograde burn for free-return trajectories that skip LOI (Apollo 13).
       Fires at pc2T regardless of LOI state; reuses rocketTEI flag to prevent re-trigger. */
    const pc2T  = S.mission?.pc2T;
    const pc2Dv = S.mission?.pc2Dv;
    if (pc2T && pc2Dv && !S.rocketTEI) {
      if (pc2T - mT < 3_600 && (S.warpFactor ?? 1) > 100) setState({ warpFactor: 100 });
      if (mT >= pc2T) _applyTEIBurn(pc2Dv);
    }

    /* T&D — Transposition and Docking (hasLM missions, post-TLI-cutoff → sivbSepT)
       Drives S.tdProgress 0→1 over the T&D window; drops warp to 10× so the
       cinematic sequence is watchable. */
    if (S.mission?.hasLM && !S.sivbSep && S.rocketTLI) {
      const tliCutoff = (S.mission.tliT ?? 0) + (S.mission.tliDuration ?? 0);
      const svSepT    = S.mission.sivbSepT ?? 0;
      const tdStart   = tliCutoff + 300;              // 5 min after TLI cutoff
      const tdWindow  = Math.max(1, svSepT - 120 - tdStart);
      if (mT >= tdStart && svSepT > 0) {
        const tdP = Math.min(1, (mT - tdStart) / tdWindow);
        if (Math.abs((S.tdProgress ?? -1) - tdP) > 0.001) setState({ tdProgress: tdP });
      }
      if (mT >= tdStart - 30 && mT < svSepT && (S.warpFactor ?? 1) > 10) {
        setState({ warpFactor: 10 });
      }
    }

    /* Failure injection — process failures[] defined in the mission.
       Each failure: { t, id, affects: string[], masterAlarm?: bool }
       Builds S.activeWarnings (flat list of active C&W cell IDs) and
       S.masterAlarm.  Only calls setState when the active set changes. */
    {
      const failures = S.mission?.failures ?? [];
      if (failures.length > 0) {
        const triggered = failures.filter(f => f.t != null && mT >= f.t);
        const newWarnings = [...new Set(triggered.flatMap(f => f.affects ?? []))];
        const newMaster   = triggered.some(f => f.masterAlarm);
        const curWarnings = S.activeWarnings ?? [];
        if (newWarnings.length !== curWarnings.length || newMaster !== !!S.masterAlarm) {
          setState({ activeWarnings: newWarnings, masterAlarm: newMaster });
        }
        if (!S.smDamaged && triggered.some(f => f.id === 'o2_tank_explosion')) {
          setState({
            smDamaged:    true,
            smExplosionT: mT,
            ...(S.mission?.hasLM && !S.inLM ? { inLM: true } : {}),
          });
        }
      }
    }

    /* Deorbit burn */
    const deorbitT = S.mission?.deorbitT;
    const deorbitDv = S.mission?.deorbitDv ?? 170;
    if (deorbitT && !S.dragonDeorbit && mT >= deorbitT) _applyDeorbitBurn(deorbitDv);

    /* Stop propagation after splashdown — drop warp */
    if (S.dragonSplashdown || S.starshipSplashdown) { setState({ warpFactor: 1 }); return; }

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
  let totalBurnExt = 0;
  for (const f of failures) {
    if (mT >= f.t && mT < f.t + dt && (f.stageIdx ?? 0) === stage - 1) {
      activeEngines = f.activeEngines ?? activeEngines;
      setState({ rocketActiveEngines: activeEngines, rocketFailedEngines: f.failedEngines ?? [] });
    }
    if (mT >= f.t && (f.stageIdx ?? 0) === stage - 1) {
      totalBurnExt += f.burnExtension ?? 0;
    }
  }

  const engineFrac = totalEngines > 0 ? activeEngines / totalEngines : 1;

  if (coasting) {
    /* Stage separation coast — no thrust, count 6 s */
    if (mT - coastT >= 6 && stage < stages.length) {
      /* Capture booster state for RTLS / ASDS (droneship) / catch recovery */
      if (!S.booster?.active && !S.booster?.landed && (perf.recovery?.rtls || perf.recovery?.asds || perf.recovery?.catch)) {
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
          att:         Math.atan2(spd_ms * Math.cos(fpa_rad), spd_ms * Math.sin(fpa_rad)) / DEG,  // nose along velocity
          entryV0:     0,
          lat:         S.lat ?? 0,
          lon:         S.lon ?? 0,
          hdg:         S.hdg ?? 0,
          mass:        stg.massDry ?? 22000,
        }});
      }
      /* Jettison entire spent stage — discard unburned propellant too.
         massAbove = all remaining stages wet + payload = correct post-sep mass. */
      mass  = massAbove;
      stage += 1;
      coasting = false;
      /* Reset engine state for new stage; record per-stage ignition flag */
      const nextStg = stages[stage - 1] ?? {};
      const ignFlags = stage === 2 ? { rocketS2Ignition: true }
                     : stage === 3 ? { rocketS3Ignition: true } : {};
      setState({ rocketActiveEngines: nextStg.engineCount ?? 1, rocketFailedEngines: [], rocketCECO: false, rocketCECOEngines: [],
                 rocketStageIgnitionT: mT, ...ignFlags });
    }
  } else if (mass > burnoutThreshold && S.engineState === 'running') {
    /* Check time-based burnout — caps burn to historical duration */
    const stgIgnT    = S.rocketStageIgnitionT ?? ignitionTime;
    const burnDur    = stg.burnDuration;
    const timeCutoff = burnDur && (mT - stgIgnT) >= burnDur + totalBurnExt;

    if (timeCutoff) {
      /* Force burnout at the historical time */
      if (stage < stages.length) {
        coasting = true; coastT = mT;
        const mecoFlag = stage === 2 ? { rocketMECO2: true } : {};
        if (!S.rocketMECO) setState({ rocketMECO: true, ...mecoFlag });
      } else {
        if (!S.rocketSECO) setState({ rocketSECO: true });
      }
    } else {
      /* Velocity gate: last-stage orbital insertion — cut engines at circular
         velocity regardless of FPA.  Works at any dt. */
      if (stg.velocityGateSECO && stage >= stages.length) {
        const r_m   = R_EARTH + alt_m;
        const vCirc = Math.sqrt(GM / r_m);
        const vNow  = (S.spd ?? 0) * 0.5144;
        if (vNow >= vCirc) {
          if (!S.rocketSECO) setState({ rocketSECO: true });
        } else {
          const thrustSL  = stg.thrustSL  ?? 0;
          const thrustVac = stg.thrustVac ?? stg.thrustSL ?? 0;
          T    = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * engineFrac;
          mdot = T / ((stg.isp ?? 300) * G0);
        }
      } else if (stg.orbitTargetSECO && stage >= stages.length) {
        /* Orbit-targeting insertion — cut off when the osculating periapsis reaches the target
           orbit (the apoapsis is steered there by the guidance below). IGM/PEG-style. */
        const spd_ms = (S.spd ?? 0) * 0.5144, fr = (S.pitch ?? 90) * DEG;
        const ob = _oscOrbit(alt_m, spd_ms * Math.cos(fr), spd_ms * Math.sin(fr));
        if (ob.peri >= _orbitTargetM() - 5000) {
          if (!S.rocketSECO) setState({ rocketSECO: true });
        } else {
          const thrustSL  = stg.thrustSL  ?? 0;
          const thrustVac = stg.thrustVac ?? stg.thrustSL ?? 0;
          T    = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * engineFrac;
          mdot = T / ((stg.isp ?? 300) * G0);
        }
      } else {
        /* Standard — scale thrust by active engine fraction */
        const thrustSL  = stg.thrustSL  ?? 0;
        const thrustVac = stg.thrustVac ?? stg.thrustSL ?? 0;
        T    = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * engineFrac;
        mdot = T / ((stg.isp ?? 300) * G0);
      }
    }
  } else if (mass <= burnoutThreshold && !coasting && stage < stages.length) {
    /* Burnout — start coast */
    coasting = true;
    coastT   = mT;
    const mecoFlag2 = stage === 2 ? { rocketMECO2: true } : {};
    if (!S.rocketMECO) setState({ rocketMECO: true, ...mecoFlag2 });
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
  let   fpaCmd     = fpaTarget * guidanceFrac + fpaActual * (1 - guidanceFrac);
  /* Orbit-targeting override (last stage, powered): steer the pitch to raise the apoapsis to the
     target orbit — pitch up when below, down when above so it converges instead of overshooting.
     SECO (above) cuts when the periapsis arrives. Replaces the fpaProfile for the insertion. */
  if (stg.orbitTargetSECO && stage >= stages.length && !coasting && S.engineState === 'running') {
    const ob  = _oscOrbit(alt_m, newVHoriz, newVVert);
    const tgt = _orbitTargetM();
    const apo = ob.apo > 0 && isFinite(ob.apo) ? ob.apo : 1e12;
    fpaCmd = Math.max(-30, Math.min(35, 90 * (tgt - apo) / tgt));
  }
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

  /* ── Roll program — rotate vehicle around longitudinal axis ── */
  const rp = perf.rollProgram;
  let rocketRoll = S.rocketRoll ?? 0;
  if (rp) {
    const tSinceLiftoff = mT - ignitionTime;
    const rpStart = rp.startT   ?? 13;
    const rpDur   = rp.duration ?? 13;
    const rpAngle = rp.angle    ?? 0;
    if (tSinceLiftoff >= rpStart) {
      const t = Math.min(1, (tSinceLiftoff - rpStart) / rpDur);
      const ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      rocketRoll = rpAngle * ease;
    }
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
    rocketRoll,
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
  const _asds    = !!rec.asds;   // droneship: no boostback — the booster lands downrange under the launch track

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
  let newPhase = b.phase, newPhaseStartT = b.phaseStartT, newEntryV0 = b.entryV0;

  /* Downrange offset from the landing target, measured along the booster heading. RTLS target =
     the landing zone (recovery.landingLat/Lon) or, lacking that, the launch site. + = the booster
     is still downrange of the target and must fly back. */
  const _dep    = S.mission?.departure ?? {};
  const tgtLat  = rec.landingLat ?? _dep.lat ?? (b.lat ?? 0);
  const tgtLon  = rec.landingLon ?? _dep.lon ?? (b.lon ?? 0);
  const _hdgR   = (b.hdg ?? 0) * DEG;
  const _dN     = ((b.lat ?? 0) - tgtLat) * 60 * 1852;
  const _dE     = ((b.lon ?? 0) - tgtLon) * 60 * 1852 * Math.cos(tgtLat * DEG);
  const downrange = _dN * Math.cos(_hdgR) + _dE * Math.sin(_hdgR);   // m along heading from target

  if (b.phase === 'flip') {
    /* Cold-gas flip — no thrust. RTLS: hold until rotated into the boostback attitude (engines
       toward launch), only then light the burn. ASDS: no boostback — just complete the flip to
       engine-first and coast on downrange to the droneship. flipDuration is the floor. */
    if (_asds) {
      if (phaseAge >= (rec.flipDuration ?? 20)) { newPhase = 'coast'; newPhaseStartT = mT; }
    } else {
      const _bbA = Math.atan2(-Math.sign(downrange || 1) * Math.cos(12 * DEG), Math.sin(12 * DEG)) / DEG;
      const _err = Math.abs(((_bbA - (b.att ?? 0) + 540) % 360) - 180);
      if (phaseAge >= (rec.flipDuration ?? 20) && _err < 12) {
        newPhase = 'boostback'; newPhaseStartT = mT;
      }
    }

  } else if (b.phase === 'boostback') {
    const nB = rec.boostbackEngines  ?? 3;
    const th = rec.boostbackThrottle ?? 1.0;
    const T  = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * (nB / nEng) * th;
    const tA = T / Math.max(1, mass);
    mdot = T / (isp * G0);
    /* Closed-loop RTLS: thrust TOWARD the target (engines downrange) to build reverse velocity —
       not just null it — until the predicted landing reaches the launch site. Pure-retrograde
       (the old code) only cancels velocity and the booster never flies back. */
    const tUp     = Math.max(0, vVert / g);
    const apAlt   = alt_m + (vVert > 0 ? vVert * vVert / (2 * g) : 0);
    const tToLand = tUp + Math.sqrt(2 * Math.max(0, apAlt) / g);
    const predDownrange = downrange + vDown * tToLand;
    if (predDownrange > 2000 && phaseAge < (rec.boostbackDuration ?? 70)) {
      const bbP = 12 * DEG;                 // shallow climb — don't loft the apogee
      thrustDown = -tA * Math.cos(bbP);     // toward launch (reduce downrange)
      thrustVert =  tA * Math.sin(bbP);
    } else {
      newPhase = 'coast'; newPhaseStartT = mT;
    }

  } else if (b.phase === 'coast') {
    /* Ballistic up to apogee and back down; the entry burn lights as it re-enters the
       denser air near entryBurnAlt_m (descending). */
    if (alt_m <= (rec.entryBurnAlt_m ?? 70_000) && vVert < 0) {
      newPhase = 'entry'; newPhaseStartT = mT; newEntryV0 = spd;
    }

  } else if (b.phase === 'entry') {
    /* Entry burn — 3 engines retrograde to shed the bulk of the re-entry velocity before
       the dense atmosphere. Cut once ~45% is gone or the max duration is reached. */
    const nE = rec.entryBurnEngines  ?? 3;
    const th = rec.entryBurnThrottle ?? 0.4;
    const T  = (thrustSL * atmFrac + thrustVac * (1 - atmFrac)) * (nE / nEng) * th;
    const tA = T / Math.max(1, mass);
    mdot = T / (isp * G0);
    if (spd > 0.5) { thrustVert = -tA * (vVert / spd); thrustDown = -tA * (vDown / spd); }
    const v0 = b.entryV0 ?? spd;
    if (spd <= v0 * 0.55 || phaseAge >= (rec.entryBurnDuration ?? 22)) {
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
    thrustVert      = tA;   /* vertical hoverslam; lateral handled by the guidance below */
  }

  /* Lateral guidance — grid fins (glide) + engine gimbal (landing) null the downrange position +
     velocity error to the target, so the booster homes onto the pad instead of drifting. */
  if (b.phase === 'glide' || b.phase === 'landing') {
    const aMax = b.phase === 'landing' ? 6 : 2.5;
    thrustDown += Math.max(-aMax, Math.min(aMax, -0.0008 * downrange - 0.20 * vDown));
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

  /* ── Attitude (nose angle φ, degrees, from local-up toward downrange) ──
     The booster flies engine-first / retrograde: engines point along the velocity vector so
     thrust is retrograde. During the post-boostback coast it reorients toward nose-up (engines
     down) while still climbing, so it re-enters and lands UPRIGHT (φ≈0). Slew rate is grid-fin/
     aero limited in the atmosphere, cold-gas-ACS limited above it. Validated in the descent sim. */
  const _angOf = (x, z) => Math.atan2(x, z) / DEG;
  const _retro = _angOf(-newVDown, -newVVert);
  /* Boostback points the engines toward the launch (thrust toward the target, ~12° above
     horizontal) — not retrograde-to-velocity, which would swing the nose downrange once the
     downrange velocity reverses. */
  const _bbAtt = _angOf(-Math.sign(downrange || 1) * Math.cos(12 * DEG), Math.sin(12 * DEG));
  let _attTgt;
  if (newPhase === 'flip')                                  _attTgt = _asds ? (newVVert < 0 ? _retro : 0) : _bbAtt;
  else if (newPhase === 'boostback')                        _attTgt = _bbAtt;
  else if (newPhase === 'landing')                          _attTgt = 0;   // pitch vertical → upright touchdown
  else if (newPhase === 'coast' || newPhase === 'entry' ||
           newPhase === 'glide')                            _attTgt = newVVert < 0 ? _retro : 0;
  else                                                       _attTgt = _angOf(newVDown, newVVert);
  /* Flip is an active cold-gas maneuver — fast enough to complete the ~180° within flipDuration,
     so the boostback isn't delayed (which would otherwise raise the apogee). Else aero/ACS limited. */
  const _slew   = (b.phase === 'flip' ? 12 : (atmFrac > 0.02 ? 12 : 4)) * dt;
  const _curAtt = b.att ?? _angOf(vDown, vVert);
  const _dAtt   = ((_attTgt - _curAtt + 540) % 360) - 180;
  const newAtt  = _curAtt + Math.sign(_dAtt) * Math.min(Math.abs(_dAtt), _slew);

  /* Touchdown */
  const padElev_m = (S.mission?.departure?.elevation ?? 0) * 0.3048;
  if (newAlt_m <= padElev_m + 3 && (newVVert < 0 || b.phase === 'landing')) {
    setState({ booster: { ...b,
      alt: (padElev_m + 2) / 0.3048, vVert: 0, vDown: 0,
      mass: newMass, lat: newLat, lon: newLon, att: 0,
      phase: 'landed', landed: true, active: false, phaseStartT: mT,
    }});
    return;
  }

  setState({ booster: { ...b,
    alt: newAlt_ft, vVert: newVVert, vDown: newVDown,
    lat: newLat, lon: newLon, mass: newMass, att: newAtt, entryV0: newEntryV0,
    phase: newPhase, phaseStartT: newPhaseStartT,
  }});
}
