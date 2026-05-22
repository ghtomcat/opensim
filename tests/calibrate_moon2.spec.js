/**
 * Moon ref-angle calibration — Apollo 8 (v2)
 *
 * Starts from the spacecraft's actual cislunar position (t≈39770, pre-MCC-1)
 * rather than from TLI, so the 600 s propagation step avoids the high-curvature
 * near-Earth phase where coarse steps introduce large errors.
 *
 * Run:  npx playwright test tests/calibrate_moon2.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';

test('calibrate moonRefAngle from cislunar position', async ({ page }) => {
  await page.goto('/?mission=apollo8&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  /* Step to just before MCC-1 fires (mcc1T=39780) */
  await page.evaluate(() => window.simStep(2000, 1));    // t=2000 — past SECO
  await page.evaluate(() => window.simStep(2755, 10));   // t=39770 — just before MCC-1

  const s0 = await page.evaluate(() => window.simGetState());
  const ov = s0.orbitVec;
  console.log(`[calibrate2] t=${s0.time?.toFixed(0)}s  rocketMCC1=${s0.rocketMCC1} (should be false)`);
  console.log(`[calibrate2] pos: rx=${Math.round(ov?.rx)}  ry=${Math.round(ov?.ry)}  earthDist=${Math.round(Math.sqrt(ov?.rx**2 + ov?.ry**2)/1000)}km`);
  console.log(`[calibrate2] vel: vx=${ov?.vx?.toFixed(1)}  vy=${ov?.vy?.toFixed(1)}  spd=${Math.sqrt(ov?.vx**2+ov?.vy**2).toFixed(0)}m/s`);

  const loiT = s0.mission?.loiT ?? 148000;
  const mT   = s0.time;

  if (s0.rocketMCC1) {
    console.warn('MCC-1 already fired — step earlier');
    return;
  }

  /* Run the full scan inside the browser */
  const results = await page.evaluate(({ mT, ov, loiT }) => {
    const MOON_SMA   = 384_400_000;
    const MOON_T_S   = 27.32166 * 86400;
    const MOON_R     = 1_737_000;
    const MOON_R_MIN = MOON_R + 100_000;
    const GM         = 3.986004418e14;
    const GM_MOON    = 4.9048695e12;
    const MCC_TARGET = MOON_R + 113_000;   // 1 850 000 m

    function moonXY(t, refDeg) {
      const ang = refDeg * Math.PI / 180 + t * (2 * Math.PI / MOON_T_S);
      return { mx: MOON_SMA * Math.cos(ang), my: MOON_SMA * Math.sin(ang) };
    }

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
    /* Propagate for loiT + 12h to capture periapsis even if late */
    /* Use a long window: spacecraft reaches Moon's distance ~300 ks from launch.
       Propagate 400 ks from start time to ensure we capture the flyby. */
    const tof = 400_000;

    const out = [];
    /* Coarse scan 0–359° at 1° resolution */
    for (let refDeg = 0; refDeg <= 359; refDeg += 1) {
      const { minDist, tPeri } = propagate(rx, ry, rz, vx, vy, vz, tof, mT, refDeg);
      out.push({ refDeg, periKm: Math.round(minDist / 1000), tPeri: Math.round(tPeri) });
    }

    /* Sort to find best coarse candidates, then fine-scan ±2° around top 3 */
    const MCC_KM = Math.round(MCC_TARGET / 1000);
    const coarseSorted = [...out].sort((a, b) => Math.abs(a.periKm - MCC_KM) - Math.abs(b.periKm - MCC_KM));
    const fineCenters = new Set(coarseSorted.slice(0, 3).map(r => r.refDeg));

    for (const center of fineCenters) {
      for (let rdeg10 = Math.round((center - 2) * 10); rdeg10 <= Math.round((center + 2) * 10); rdeg10++) {
        const refDeg = rdeg10 / 10;
        if (Math.abs(refDeg % 1) < 0.001) continue;  // skip integer degrees (already scanned)
        const { minDist, tPeri } = propagate(rx, ry, rz, vx, vy, vz, tof, mT, refDeg);
        out.push({ refDeg, periKm: Math.round(minDist / 1000), tPeri: Math.round(tPeri) });
      }
    }

    return out;
  }, { mT, ov, loiT });

  const MOON_R     = 1_737_000;
  const MCC_TARGET = MOON_R + 113_000;
  const MCC_KM     = Math.round(MCC_TARGET / 1000);
  const MOON_R_KM  = Math.round(MOON_R / 1000);

  results.sort((a, b) => Math.abs(a.periKm - MCC_KM) - Math.abs(b.periKm - MCC_KM));
  const best5 = results.slice(0, 5);

  console.log('\n=== moonRefAngle calibration v2 (from cislunar pos) ===');
  console.log(`Target: ${MCC_KM} km from Moon centre (alt ${MCC_KM - MOON_R_KM} km)`);
  console.log('Top 5 candidates:');
  for (const r of best5) {
    const alt = r.periKm - MOON_R_KM;
    console.log(`  moonRefAngle=${r.refDeg.toFixed ? r.refDeg.toFixed(1) : r.refDeg}°  peri=${r.periKm}km  alt=${alt}km  tPeri=${r.tPeri}s (${(r.tPeri/3600).toFixed(1)}h)`);
  }

  /* All angles achieving alt < 300 km (close to target), sorted by angle */
  const good = results.filter(r => {
    const alt = r.periKm - MOON_R_KM;
    return alt >= -50 && alt < 300;
  }).sort((a, b) => a.refDeg - b.refDeg);

  if (good.length > 0) {
    console.log(`\nAngles with periapsis alt between -50 and +300 km:`);
    for (const r of good) {
      const alt = r.periKm - MOON_R_KM;
      const err = r.periKm - MCC_KM;
      console.log(`  moonRefAngle=${r.refDeg.toFixed ? r.refDeg.toFixed(1) : r.refDeg}°  peri=${r.periKm}km  alt=${alt}km  err=${err>0?'+':''}${err}km  loiT=${r.tPeri}s`);
    }
  } else {
    console.log('\nNo angle achieves close periapsis. Showing all coarse results < 5000 km:');
    results.filter(r => r.refDeg % 1 === 0 && r.periKm < 5000).sort((a, b) => a.refDeg - b.refDeg).forEach(r => {
      const alt = r.periKm - MOON_R_KM;
      console.log(`  moonRefAngle=${r.refDeg}°  peri=${r.periKm}km  alt=${alt}km  loiT=${r.tPeri}s`);
    });
  }

  expect(results.length).toBeGreaterThan(359);
});
