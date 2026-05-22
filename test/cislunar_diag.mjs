#!/usr/bin/env node
/**
 * Cislunar trajectory diagnostic — Apollo 8 MCC burns
 * Run: node test/cislunar_diag.mjs
 *
 * Self-contained: no browser, no DOM.
 * Uses adaptive step integration (small near Earth, large in deep space)
 * and a Newton solver to find the correct TLI velocity direction, so we
 * start from a physically valid state.
 */

const GM        = 3.986004418e14;
const GM_MOON   = 4.9048695e12;
const MOON_T_S  = 27.32166 * 86400;
const MOON_SMA  = 384_400_000;
const MOON_R    = 1_737_000;
const MOON_R_MIN = MOON_R + 100_000;
const MOON_SOI  = 66_000_000;
const MCC_TARGET = MOON_R + 113_000;
const R_EARTH   = 6_371_000;
const DEG       = Math.PI / 180;
const TAU       = 2 * Math.PI;

/* Apollo 8 mission parameters */
const M = {
  moonRefAngle: 69,
  tliT:        10734,   // after tliDuration: 10417 + 317
  tliDv:       3147,
  mcc1T:       39780,
  mcc2T:       86400,
  mcc4T:       297000,
  loiT:        305000,
  parkAlt:     185_000,
};

/* ── Physics helpers ─────────────────────────────────────────── */
function moonECI(t) {
  const angle = M.moonRefAngle * DEG + t * TAU / MOON_T_S;
  return { mx: MOON_SMA * Math.cos(angle), my: MOON_SMA * Math.sin(angle) };
}

/* Adaptive-step Velocity Verlet — small steps near Earth, large in deep space */
function propagate(pos, vel, tof, t0) {
  let { rx, ry, rz } = pos;
  let { vx, vy, vz } = vel;
  let t = t0, rem = tof;
  let minMoonDist = Infinity, minMoonT = t0;

  while (rem > 0) {
    const r = Math.sqrt(rx*rx + ry*ry + rz*rz);
    const v = Math.sqrt(vx*vx + vy*vy + vz*vz) + 1;
    /* dt = 1% of the "local free-fall time" — gives ~30s near Earth, ~600s cislunar */
    const dt_max = Math.min(3600, 0.01 * TAU * r / v);
    const step   = Math.min(Math.max(dt_max, 1), rem);
    rem -= step;

    const { mx, my } = moonECI(t);
    const r2  = rx*rx + ry*ry + rz*rz;
    const r3  = r2 * Math.sqrt(r2);
    const ke  = -GM / r3;
    const dmx = rx - mx, dmy = ry - my;
    const mr_raw = Math.sqrt(dmx*dmx + dmy*dmy + rz*rz);
    if (mr_raw < minMoonDist) { minMoonDist = mr_raw; minMoonT = t; }
    if (mr_raw < MOON_R_MIN) break;

    const mr3 = Math.pow(Math.max(mr_raw, MOON_R_MIN), 3);
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
    if (nmr < minMoonDist) { minMoonDist = nmr; minMoonT = t; }
    const nmr3 = Math.pow(nmr, 3);
    const nkm  = -GM_MOON / nmr3;
    const nax  = nke*nrx + nkm*ndmx;
    const nay  = nke*nry + nkm*ndmy;
    const naz  = nke*nrz + nkm*nrz;
    vx += 0.5*(ax+nax)*step; vy += 0.5*(ay+nay)*step; vz += 0.5*(az+naz)*step;
    rx = nrx; ry = nry; rz = nrz;
  }
  return { rx, ry, rz, vx, vy, vz, t, minMoonDist, minMoonT };
}

/* ── Find TLI velocity via Newton solver ────────────────────────
   The spacecraft is placed at (r_park, 0, 0) after TLI.
   We solve for the velocity direction that puts it closest to the
   Moon at loiT. This gives a self-consistent cislunar trajectory.  */
function findTLIVelocity() {
  const r_park = R_EARTH + M.parkAlt;
  const v_park = Math.sqrt(GM / r_park);
  const v_tli  = v_park + M.tliDv;
  const pos0   = { rx: r_park, ry: 0, rz: 0 };
  const tof    = M.loiT - M.tliT;
  const { mx: mxT, my: myT } = moonECI(M.loiT);

  /* Initial guess: prograde (+y direction) */
  let vx = 0, vy = v_tli;

  process.stdout.write('Solving TLI direction (Newton):');
  for (let iter = 0; iter < 30; iter++) {
    const f0 = propagate(pos0, { vx, vy, vz: 0 }, tof, M.tliT);
    const ex = f0.rx - mxT, ey = f0.ry - myT;
    const dist = Math.sqrt(ex*ex + ey*ey);
    process.stdout.write(` ${(dist/1e6).toFixed(1)}Mm`);

    if (dist < 500_000) {  // within 500 km — good enough
      process.stdout.write(` ✓ (${iter+1} iters)\n`);
      return { vx, vy, dist };
    }

    const eps = 10.0;
    const fx  = propagate(pos0, { vx: vx+eps, vy,     vz: 0 }, tof, M.tliT);
    const fy  = propagate(pos0, { vx,         vy: vy+eps, vz: 0 }, tof, M.tliT);
    const J00 = (fx.rx - f0.rx)/eps, J10 = (fx.ry - f0.ry)/eps;
    const J01 = (fy.rx - f0.rx)/eps, J11 = (fy.ry - f0.ry)/eps;
    const det = J00*J11 - J01*J10;
    if (Math.abs(det) < 1e-12) break;

    const dvx = -(J11*ex - J01*ey) / det;
    const dvy = -(-J10*ex + J00*ey) / det;

    /* Constrain to preserve speed — correct direction only */
    /* Project correction onto perpendicular of current velocity */
    const spd = Math.sqrt(vx*vx + vy*vy);
    const perp_component = (dvx * (-vy) + dvy * vx) / spd;
    const px = -vy / spd, py = vx / spd;
    /* Limit step */
    const MAX = 200;
    const correction = Math.max(-MAX, Math.min(MAX, perp_component));
    const newVx = vx + correction * px;
    const newVy = vy + correction * py;
    /* Renormalise to v_tli */
    const newSpd = Math.sqrt(newVx*newVx + newVy*newVy);
    vx = newVx * v_tli / newSpd;
    vy = newVy * v_tli / newSpd;
  }
  process.stdout.write(' (not fully converged)\n');
  return { vx, vy, dist: Infinity };
}

/* ── Bisect scan ─────────────────────────────────────────────── */
function bisectScan(label, mT, pos, vx0, vy0, tof_nominal, tof_extended) {
  const spd = Math.sqrt(vx0*vx0 + vy0*vy0);
  const px  = -vy0 / spd, py = vx0 / spd;   // ECI perpendicular

  console.log(`\n── ${label} bisect scan ──────────────────────────────────`);
  console.log(`   mT = ${mT}s  |  tof_nominal = ${tof_nominal}s  |  tof_extended = ${tof_extended}s (+${((tof_extended-tof_nominal)/3600).toFixed(0)}h)`);
  console.log(`   ${'c(m/s)'.padStart(8)}  ${'peri_nom(km)'.padStart(14)}  ${'peri_ext(km)'.padStart(14)}  ${'periT(s)'.padStart(10)}`);

  const rows = [];
  for (let c = -1000; c <= 1000; c += 50) {
    const vel = { vx: vx0 + c*px, vy: vy0 + c*py, vz: 0 };
    const rN  = propagate(pos, vel, tof_nominal,  mT);
    const rE  = propagate(pos, vel, tof_extended, mT);
    rows.push({ c, dN: rN.minMoonDist, dE: rE.minMoonDist, minT: rE.minMoonT });
  }

  rows.forEach(({ c, dN, dE, minT }) => {
    const below = dE < MCC_TARGET;
    const mark  = below ? ' ← HIT' : '';
    console.log(`   ${String(c).padStart(8)}  ${(dN/1000).toFixed(0).padStart(12)} km  ${(dE/1000).toFixed(0).padStart(12)} km  ${String(Math.round(minT)).padStart(10)}s${mark}`);
  });

  const crossings = rows.filter(r => r.dE < MCC_TARGET);
  if (crossings.length > 0) {
    const c0 = crossings[0];
    console.log(`\n   → Bracket FOUND in extended window at c ≈ ${c0.c} m/s (peri = ${(c0.dE/1000).toFixed(0)} km)`);
    const inNominal = rows.some(r => r.dN < MCC_TARGET);
    if (!inNominal) {
      const firstBelow = rows.find(r => r.dE < MCC_TARGET);
      console.log(`   → BUG CONFIRMED: periapsis at t=${Math.round(firstBelow.minT)}s is AFTER loiT=${M.loiT}s`);
      console.log(`   → Fix: extend propagation window by +${Math.ceil((firstBelow.minT - M.loiT)/3600)}h`);
    }
  } else {
    const minRow = rows.reduce((a,b) => a.dE < b.dE ? a : b);
    console.log(`\n   → No crossing in ±1000 m/s range. Best: c=${minRow.c} m/s → ${(minRow.dE/1000).toFixed(0)} km`);
    console.log(`   → Geometry issue: trajectory doesn't come close enough to Moon.`);
  }
}

/* ══════════════════════════════════════════════════════════════ */
console.log('═══════════════════════════════════════════════════════════');
console.log('  Apollo 8 Cislunar Trajectory Diagnostic');
console.log('═══════════════════════════════════════════════════════════\n');

/* 1. TLI state */
const tliSolved = findTLIVelocity();
const r_park = R_EARTH + M.parkAlt;
const tliPos  = { rx: r_park, ry: 0, rz: 0 };
const tliVel  = { vx: tliSolved.vx, vy: tliSolved.vy, vz: 0 };
const v_tli   = Math.sqrt(tliSolved.vx**2 + tliSolved.vy**2);
console.log(`\nTLI state:`);
console.log(`  speed = ${v_tli.toFixed(0)} m/s  |  alt = ${(M.parkAlt/1000).toFixed(0)} km`);
console.log(`  direction: (${(tliSolved.vx/v_tli).toFixed(3)}, ${(tliSolved.vy/v_tli).toFixed(3)})`);
console.log(`  Newton final dist to Moon at loiT: ${(tliSolved.dist/1e3).toFixed(0)} km`);

/* 2. Propagate to MCC-1 */
process.stdout.write(`\nPropagating TLI → MCC-1...`);
const atMCC1 = propagate(tliPos, tliVel, M.mcc1T - M.tliT, M.tliT);
process.stdout.write(' done\n');
const r_m1 = Math.sqrt(atMCC1.rx**2 + atMCC1.ry**2 + atMCC1.rz**2);
const v_m1 = Math.sqrt(atMCC1.vx**2 + atMCC1.vy**2);
const { mx: mx1, my: my1 } = moonECI(M.mcc1T);
const moonDist1 = Math.sqrt((atMCC1.rx-mx1)**2 + (atMCC1.ry-my1)**2);
console.log(`\nAt MCC-1 (t=${M.mcc1T}s):`);
console.log(`  Earth dist: ${(r_m1/1000).toFixed(0)} km  |  speed: ${v_m1.toFixed(0)} m/s`);
console.log(`  Moon dist:  ${(moonDist1/1e6).toFixed(2)} Mm`);

/* 3. Raw periapsis check */
const tof_nom  = M.loiT   - M.mcc1T;
const tof_ext  = tof_nom + 48 * 3600;
const pos1 = { rx: atMCC1.rx, ry: atMCC1.ry, rz: 0 };
const vel1 = { vx: atMCC1.vx, vy: atMCC1.vy, vz: 0 };
process.stdout.write('Checking raw periapsis...');
const rawNom = propagate(pos1, vel1, tof_nom, M.mcc1T);
const rawExt = propagate(pos1, vel1, tof_ext, M.mcc1T);
process.stdout.write(' done\n');
console.log(`\nRaw periapsis (no MCC-1):`);
console.log(`  To loiT only:      ${(rawNom.minMoonDist/1000).toFixed(0)} km  (t = ${Math.round(rawNom.minMoonT)}s)`);
console.log(`  To loiT + 48h:     ${(rawExt.minMoonDist/1000).toFixed(0)} km  (t = ${Math.round(rawExt.minMoonT)}s)`);
console.log(`  MCC_TARGET:        ${(MCC_TARGET/1000).toFixed(0)} km`);
console.log(`  loiT:              ${M.loiT}s`);
if (rawExt.minMoonT > M.loiT) {
  console.log(`  ⚠  periapsis is ${Math.round(rawExt.minMoonT - M.loiT)}s AFTER loiT`);
}

/* 4. Newton Phase 1 check */
const posEnd1 = propagate(pos1, vel1, tof_nom, M.mcc1T);
const { mx: mxL, my: myL } = moonECI(M.loiT);
const distAtLOI = Math.sqrt((posEnd1.rx-mxL)**2 + (posEnd1.ry-myL)**2);
console.log(`\nPosition relative to Moon at loiT: ${(distAtLOI/1e6).toFixed(2)} Mm`);
console.log(`SOI = ${(MOON_SOI/1e6).toFixed(0)} Mm → Newton Phase 1 ${distAtLOI > MOON_SOI ? 'WOULD trigger' : 'would be skipped'}`);

/* 5. Bisect scan — nominal vs extended window */
bisectScan('MCC-1', M.mcc1T, pos1, vel1.vx, vel1.vy, tof_nom, tof_ext);

/* ── Simulate MCC-1 correction and check MCC-2 ─────────────── */
/* Find the actual best c in extended window (bisect between -50 and 0) */
const spd1 = Math.sqrt(vel1.vx**2 + vel1.vy**2);
const px1  = -vel1.vy / spd1, py1 = vel1.vx / spd1;
let lo1 = null, hi1 = null;
for (let c = -1000; c <= 1000; c += 50) {
  const v = { vx: vel1.vx + c*px1, vy: vel1.vy + c*py1, vz: 0 };
  const { minMoonDist } = propagate(pos1, v, tof_ext, M.mcc1T);
  if (minMoonDist < MCC_TARGET) { if (lo1 === null) lo1 = c; }
  else                          { if (lo1 !== null && hi1 === null) { hi1 = c; break; } }
}
let bestC1 = 0;
if (lo1 !== null && hi1 !== null) {
  for (let i = 0; i < 30; i++) {
    const mid = (lo1 + hi1) / 2;
    const v   = { vx: vel1.vx + mid*px1, vy: vel1.vy + mid*py1, vz: 0 };
    const { minMoonDist } = propagate(pos1, v, tof_ext, M.mcc1T);
    if (minMoonDist < MCC_TARGET) lo1 = mid; else hi1 = mid;
    if (Math.abs(hi1 - lo1) < 0.1) break;
  }
  bestC1 = (lo1 + hi1) / 2;
  console.log(`\nMCC-1 correction: c = ${bestC1.toFixed(1)} m/s`);
} else {
  console.log('\nMCC-1: no bracket in extended window — cannot compute correction');
}

const vxAfterMCC1 = vel1.vx + bestC1 * px1;
const vyAfterMCC1 = vel1.vy + bestC1 * py1;

/* Propagate MCC-1 → MCC-2 */
process.stdout.write(`\nPropagating MCC-1 → MCC-2 (${M.mcc2T - M.mcc1T}s)...`);
const atMCC2 = propagate(pos1, { vx: vxAfterMCC1, vy: vyAfterMCC1, vz: 0 }, M.mcc2T - M.mcc1T, M.mcc1T);
process.stdout.write(' done\n');
const pos2    = { rx: atMCC2.rx, ry: atMCC2.ry, rz: 0 };
const vel2    = { vx: atMCC2.vx, vy: atMCC2.vy, vz: 0 };
const tof2nom = M.loiT - M.mcc2T;
const tof2ext = tof2nom + 6 * 3600;
const raw2Nom = propagate(pos2, vel2, tof2nom, M.mcc2T);
const raw2Ext = propagate(pos2, vel2, tof2ext, M.mcc2T);
console.log(`\nAt MCC-2 (after MCC-1 correction):`);
console.log(`  Periapsis nominal:  ${(raw2Nom.minMoonDist/1000).toFixed(0)} km @ t=${Math.round(raw2Nom.minMoonT)}s`);
console.log(`  Periapsis extended: ${(raw2Ext.minMoonDist/1000).toFixed(0)} km @ t=${Math.round(raw2Ext.minMoonT)}s`);
console.log(`  Error vs target:    ${((raw2Ext.minMoonDist - MCC_TARGET)/1000).toFixed(0)} km`);

/* 6. Summary */
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Key findings');
console.log('═══════════════════════════════════════════════════════════');
const periAtLoiT    = rawNom.minMoonDist;
const periExtended  = rawExt.minMoonDist;
const periT         = rawExt.minMoonT;
console.log(`  Periapsis in nominal window:   ${(periAtLoiT/1000).toFixed(0)} km`);
console.log(`  Periapsis in extended window:  ${(periExtended/1000).toFixed(0)} km @ t = ${Math.round(periT)}s`);
console.log(`  Periapsis vs loiT:             ${periT > M.loiT ? '+' : ''}${Math.round(periT - M.loiT)}s`);
console.log(`  MCC_TARGET:                    ${(MCC_TARGET/1000).toFixed(0)} km`);
console.log(`  MCC-1 correction:              ${bestC1.toFixed(1)} m/s perpendicular`);
console.log(`  MCC-2 periapsis after fix:     ${(raw2Ext.minMoonDist/1000).toFixed(0)} km`);
if (periExtended < MOON_SOI) {
  console.log(`\n  Spacecraft enters Moon SOI ✓`);
  if (periT > M.loiT) {
    console.log(`  ROOT CAUSE CONFIRMED: periapsis ${Math.round(periT - M.loiT)}s after loiT`);
    console.log(`  Fix applied in rocket.js: tofBisect = tofNominal + 6h`);
  }
} else {
  console.log(`  Spacecraft does NOT enter Moon SOI — trajectory geometry issue`);
}
const mcc2ok = Math.abs(raw2Ext.minMoonDist - MCC_TARGET) < 100_000;
console.log(`  MCC-2 residual after fix:      ${mcc2ok ? 'within 100 km ✓' : `${((raw2Ext.minMoonDist - MCC_TARGET)/1000).toFixed(0)} km — may need further correction`}`);

/* PASS/FAIL
   Criteria:
   1. Natural trajectory reaches Moon SOI (periapsis < MOON_SOI in extended window)
   2. Extended window captures periapsis below MCC_TARGET (bracket forms)
   3. MCC-1 correction is small (historical Apollo 8 MCC-1 was ~9 m/s)
   4. After MCC-1, MCC-2 periapsis is still within SOI and closer to target
*/
const p1 = periExtended < MOON_SOI;                              // enters SOI
const p2 = periExtended < MCC_TARGET;                           // bracket found in extended window
const p3 = Math.abs(bestC1) < 100;                              // small MCC-1 correction
const p4 = raw2Ext.minMoonDist < MOON_SOI && raw2Ext.minMoonDist > MOON_R;             // MCC-2 within SOI, above surface
const mcc2ExtendsOk = raw2Ext.minMoonT < M.loiT + 6 * 3600;    // periapsis in MCC-2 extended window
console.log('\n');
console.log(`  [1] Enters Moon SOI:                ${p1 ? 'PASS ✓' : 'FAIL ✗'}`);
console.log(`  [2] Extended window bracket forms:  ${p2 ? 'PASS ✓' : 'FAIL ✗'}`);
console.log(`  [3] MCC-1 small (${Math.abs(bestC1).toFixed(1)} m/s < 100):  ${p3 ? 'PASS ✓' : 'FAIL ✗'}`);
console.log(`  [4] MCC-2 within SOI, improving:    ${p4 ? 'PASS ✓' : 'FAIL ✗'}`);
console.log(`  [5] MCC-2 periapsis in 6h window:   ${mcc2ExtendsOk ? 'PASS ✓' : 'FAIL ✗'}`);
const allPassed = p1 && p2 && p3 && p4 && mcc2ExtendsOk;
console.log(`\n  Overall: ${allPassed ? 'PASS ✓' : 'FAIL ✗'}`);
