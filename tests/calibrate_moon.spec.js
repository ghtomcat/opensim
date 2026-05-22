/**
 * Moon ref-angle calibration — Apollo 8
 *
 * Steps to just past TLI, captures orbitVec, then sweeps moonRefAngle
 * from 0–360° entirely inside the browser. Reports which angle(s) give
 * periapsis ≤ MCC_TARGET (1850 km from Moon centre) and when the
 * spacecraft reaches that periapsis (use that time to set loiT).
 *
 * Run:  npx playwright test tests/calibrate_moon.spec.js --reporter=line
 */

import { test, expect } from '@playwright/test';

const MOON_SMA   = 384_400_000;
const MOON_T_S   = 27.32166 * 86400;
const MOON_R     = 1_737_000;
const MOON_R_MIN = MOON_R + 100_000;
const GM         = 3.986004418e14;
const GM_MOON    = 4.9048695e12;
const MCC_TARGET = MOON_R + 113_000;   // 1 850 000 m — Apollo 8 periapsis target

test('calibrate moonRefAngle for Apollo 8 TLI trajectory', async ({ page }) => {
  /* Load apollo8 in test mode */
  await page.goto('/?mission=apollo8&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  /* Fast-forward past TLI.  tliT=11991 → step to t=12200 (TLI+~200s safety margin).
     Use dt=1 for the launch phase (attitude control needs fine steps) then
     dt=10 for the orbital coast after SECO. */
  await page.evaluate(() => window.simStep(2000, 1));    // t=2000 — past SECO
  await page.evaluate(() => window.simStep(1022, 10));   // t=12220 — past TLI

  /* Confirm TLI has fired */
  const s0 = await page.evaluate(() => window.simGetState());
  if (!s0.rocketTLI) {
    console.warn('TLI has not fired yet at t=12200 — check tliT');
  }

  const postTLI = {
    mT:       s0.time,
    orbitVec: s0.orbitVec,
    loiT:     s0.mission?.loiT ?? 305000,
  };
  console.log(`[calibrate] TLI captured at mT=${postTLI.mT?.toFixed(0)}s  rocketTLI=${s0.rocketTLI}`);
  console.log(`[calibrate] orbitVec = ${JSON.stringify({
    rx: Math.round(postTLI.orbitVec?.rx),
    ry: Math.round(postTLI.orbitVec?.ry),
    rz: Math.round(postTLI.orbitVec?.rz ?? 0),
    vx: postTLI.orbitVec?.vx?.toFixed(1),
    vy: postTLI.orbitVec?.vy?.toFixed(1),
    vz: (postTLI.orbitVec?.vz ?? 0).toFixed(1),
  })}`);

  /* Run the full scan inside the browser (avoids per-step page.evaluate overhead) */
  const results = await page.evaluate(({ mT, ov, loiT }) => {
    const MOON_SMA   = 384_400_000;
    const MOON_T_S   = 27.32166 * 86400;
    const MOON_R     = 1_737_000;
    const MOON_R_MIN = MOON_R + 100_000;
    const GM         = 3.986004418e14;
    const GM_MOON    = 4.9048695e12;
    const MCC_TARGET = MOON_R + 113_000;

    function moonXY(t, refDeg) {
      const ang = refDeg * Math.PI / 180 + t * (2 * Math.PI / MOON_T_S);
      return { mx: MOON_SMA * Math.cos(ang), my: MOON_SMA * Math.sin(ang) };
    }

    /* Same Velocity Verlet as _propagateMinDist in rocket.js, DT=600s.
       Returns { minDist, tPeri } — minimum distance from Moon centre and the
       mission-time (seconds) at which it occurs. */
    function propagate(rx0, ry0, rz0, vx0, vy0, vz0, tof, t0, refDeg) {
      let rx = rx0, ry = ry0, rz = rz0;
      let vx = vx0, vy = vy0, vz = vz0;
      let minDist = Infinity, tPeri = t0;
      const DT = 600;
      let t = t0, rem = tof;

      while (rem > 0) {
        const step = Math.min(DT, rem);
        rem -= step;

        const { mx, my } = moonXY(t, refDeg);
        const r2  = rx*rx + ry*ry + rz*rz;
        const r3  = r2 * Math.sqrt(r2);
        const ke  = -GM / r3;
        const dmx = rx - mx, dmy = ry - my;
        const mr_raw = Math.sqrt(dmx*dmx + dmy*dmy + rz*rz);
        if (mr_raw < minDist) { minDist = mr_raw; tPeri = t; }
        if (mr_raw < MOON_R_MIN) return { minDist, tPeri };

        const mr3 = Math.pow(mr_raw, 3);
        const km  = -GM_MOON / mr3;
        const ax  = ke*rx + km*dmx, ay = ke*ry + km*dmy, az = ke*rz + km*rz;

        const s2  = step * step;
        const nrx = rx + vx*step + 0.5*ax*s2;
        const nry = ry + vy*step + 0.5*ay*s2;
        const nrz = rz + vz*step + 0.5*az*s2;

        t += step;
        const { mx: nmx, my: nmy } = moonXY(t, refDeg);
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
      return { minDist, tPeri };
    }

    const { rx, ry, rz = 0, vx, vy, vz = 0 } = ov;
    /* Propagate for loiT + 12h to make sure we capture periapsis even if late */
    const tof = (loiT + 12 * 3600) - mT;

    const out = [];
    /* Coarse scan 0-359° at 1° resolution */
    for (let refDeg = 0; refDeg <= 359; refDeg += 1) {
      const { minDist, tPeri } = propagate(rx, ry, rz, vx, vy, vz, tof, mT, refDeg);
      out.push({ refDeg, periKm: Math.round(minDist / 1000), tPeri: Math.round(tPeri) });
    }
    /* Fine scan 113-119° at 0.1° resolution to find periapsis ≈ 1850 km */
    for (let rdeg10 = 1130; rdeg10 <= 1190; rdeg10++) {
      const refDeg = rdeg10 / 10;
      const { minDist, tPeri } = propagate(rx, ry, rz, vx, vy, vz, tof, mT, refDeg);
      out.push({ refDeg, periKm: Math.round(minDist / 1000), tPeri: Math.round(tPeri) });
    }
    return out;
  }, { mT: postTLI.mT, ov: postTLI.orbitVec, loiT: postTLI.loiT });

  /* Find best angle (closest to MCC_TARGET) */
  const MCC_TARGET_KM = Math.round(MCC_TARGET / 1000);
  results.sort((a, b) => Math.abs(a.periKm - MCC_TARGET_KM) - Math.abs(b.periKm - MCC_TARGET_KM));
  const best3 = results.slice(0, 3);

  console.log('\n=== moonRefAngle calibration results ===');
  console.log(`Target periapsis: ${MCC_TARGET_KM} km from Moon centre (alt ${MCC_TARGET_KM - Math.round(MOON_R/1000)} km)`);
  console.log('Top 3 candidates closest to target:');
  for (const r of best3) {
    const altKm = r.periKm - Math.round(MOON_R / 1000);
    console.log(`  moonRefAngle=${r.refDeg}°  periapsis=${r.periKm} km  (alt=${altKm} km)  tPeri=${r.tPeri}s (${(r.tPeri/3600).toFixed(1)}h)`);
  }

  /* Fine scan results — show all near MCC_TARGET */
  const fineNear = results
    .filter(r => typeof r.refDeg === 'number' && r.refDeg % 1 !== 0 && Math.abs(r.periKm - MCC_TARGET_KM) < 200)
    .sort((a, b) => a.refDeg - b.refDeg);
  if (fineNear.length > 0) {
    console.log('\nFine scan (0.1° steps) near MCC_TARGET ±200 km:');
    for (const r of fineNear) {
      const altKm = r.periKm - Math.round(MOON_R / 1000);
      const err = r.periKm - MCC_TARGET_KM;
      console.log(`  moonRefAngle=${r.refDeg.toFixed(1)}°  periapsis=${r.periKm} km  (alt=${altKm} km, err=${err>0?'+':''}${err}km)  loiT=${r.tPeri}s`);
    }
  }

  /* Print all integer-degree angles with periapsis within 2× MCC_TARGET */
  const good = results
    .filter(r => r.refDeg % 1 === 0 && r.periKm < Math.round(MCC_TARGET * 2 / 1000))
    .sort((a, b) => a.refDeg - b.refDeg);
  if (good.length > 0) {
    console.log(`\nInteger angles achieving periapsis < ${Math.round(MCC_TARGET * 2 / 1000)} km:`);
    for (const r of good) {
      const altKm = r.periKm - Math.round(MOON_R / 1000);
      console.log(`  moonRefAngle=${r.refDeg}°  periapsis=${r.periKm} km  (alt=${altKm} km)  loiT should be: ${r.tPeri}s`);
    }
  } else {
    console.log('\nNo integer angle achieves target periapsis.');
  }

  /* The test just needs to not crash — result is in the console */
  expect(results.length).toBeGreaterThanOrEqual(360);
});
