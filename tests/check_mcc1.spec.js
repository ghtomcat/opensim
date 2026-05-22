import { test, expect } from '@playwright/test';

test('MCC-1 ΔV should be small for correctly targeted trajectory', async ({ page }) => {
  await page.goto('/?mission=apollo8&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  // Use dt=1 for launch (attitude control), dt=10 for orbital coast
  await page.evaluate(() => window.simStep(2000, 1));    // t=2000 — past SECO
  await page.evaluate(() => window.simStep(3780, 10));   // t=39800 — past MCC-1 (mcc1T=39780)

  const s = await page.evaluate(() => window.simGetState());
  const dv = s.mcc1DvMag ?? 0;
  console.log(`MCC-1 ΔV: ${dv.toFixed(1)} m/s  (rocketMCC1=${s.rocketMCC1})`);

  // Check periapsis at current time
  const ov = s.orbitVec;
  if (ov) {
    const r = Math.sqrt(ov.rx**2 + ov.ry**2) / 1000;
    const v = Math.sqrt(ov.vx**2 + ov.vy**2);
    console.log(`Post-MCC-1: r=${r.toFixed(0)}km v=${v.toFixed(0)}m/s`);
  }

  expect(s.rocketMCC1).toBe(true);
  expect(dv).toBeLessThan(100);  // should be < 100 m/s (historically ~9 m/s, sim gives ~37 m/s)
});
