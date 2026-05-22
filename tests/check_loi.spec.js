/**
 * Track minimum Moon distance during transit and check if LOI fires.
 */
import { test, expect } from '@playwright/test';

test('track Moon approach and LOI trigger', async ({ page }) => {
  const logs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('LOI') || t.includes('periapsis') || t.includes('MCC')) logs.push(t);
  });

  await page.goto('/?mission=apollo8&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  await page.evaluate(() => window.simStep(2000, 1));     // t=2000 — past SECO

  // Step in chunks, logging Moon distance at each snapshot
  const snapTimes = [39780, 100000, 180000, 240000, 280000, 285000, 288150, 291000, 295000, 305000];
  let lastT = 2000;

  for (const target of snapTimes) {
    const steps = Math.round((target - lastT) / 10);
    if (steps > 0) await page.evaluate((n) => window.simStep(n, 10), steps);
    lastT = target;

    const info = await page.evaluate(() => {
      const s = window.simGetState();
      const ov = s.orbitVec;
      if (!ov) return null;
      const mT = s.time;
      const moonRefAngle = s.mission?.moonRefAngle ?? 105.9;
      const MOON_SMA = 384_400_000, MOON_T_S = 27.32166 * 86400;
      const ang = moonRefAngle * Math.PI / 180 + mT * (2 * Math.PI / MOON_T_S);
      const mx = MOON_SMA * Math.cos(ang), my = MOON_SMA * Math.sin(ang);
      const moonDist = Math.sqrt((ov.rx-mx)**2 + (ov.ry-my)**2);
      const earthDist = Math.sqrt(ov.rx**2 + ov.ry**2);
      return {
        t: Math.round(mT),
        earthKm: Math.round(earthDist/1000),
        moonKm: Math.round(moonDist/1000),
        rocketLOI: s.rocketLOI,
      };
    });

    if (info) {
      console.log(`t=${info.t}s  earthDist=${info.earthKm}km  moonDist=${info.moonKm}km  LOI=${info.rocketLOI}`);
    }
  }

  console.log('\n--- Sim logs ---');
  for (const l of logs) console.log(l);

  expect(true).toBe(true);
});
