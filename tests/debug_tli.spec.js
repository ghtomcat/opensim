import { test, expect } from '@playwright/test';

test('trace orbit state around TLI', async ({ page }) => {
  await page.goto('/?mission=apollo8&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  const snap = async (label) => {
    const s = await page.evaluate(() => window.simGetState());
    const ov = s.orbitVec;
    const r = ov ? (Math.sqrt(ov.rx**2 + ov.ry**2 + (ov.rz||0)**2) / 1000).toFixed(0) : 'null';
    const v = ov ? (Math.sqrt(ov.vx**2 + ov.vy**2 + (ov.vz||0)**2)).toFixed(0) : 'null';
    const altKm = (s.alt * 0.3048 / 1000).toFixed(1);
    const spdMs = (s.spd * 0.5144).toFixed(0);
    console.log(`${label}: t=${s.time?.toFixed(0)} alt=${altKm}km spd=${spdMs}m/s SECO=${s.rocketSECO} TLI=${s.rocketTLI} r=${r}km v=${v}m/s`);
    return s;
  };

  // Use dt=1 for launch phase (attitude control needs fine steps)
  await page.evaluate(() => window.simStep(200, 1));     // t=200 — ignition
  await snap('T+200s');

  await page.evaluate(() => window.simStep(800, 1));     // t=1000 — around SECO
  await snap('T+1000s');

  await page.evaluate(() => window.simStep(1000, 1));    // t=2000
  await snap('T+2000s');

  // Switch to dt=10 for orbital coast (fine attitude control no longer needed)
  await page.evaluate(() => window.simStep(900, 10));    // t=11000 — pre-TLI
  await snap('T+11000s');

  await page.evaluate(() => window.simStep(100, 10));    // t=12000 — TLI should fire
  await snap('T+12000s');

  await page.evaluate(() => window.simStep(20, 10));     // t=12200
  const s = await snap('T+12200s');

  expect(s.rocketTLI).toBe(true);
});
