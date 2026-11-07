/**
 * The FUEL page is drawn from each airliner's fuel layout (display/pfd_instruments.js drawFuelPage,
 * core/fuel-system.js fuelView) — every airliner draws it without an error; in the centre view Tab
 * steps the lower ECAM through ELEC → HYD → FUEL; the fuel on board falls as the engines burn.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

const AIRLINER_MISSIONS = ['fimp-takeoff', 'lsgg-takeoff', 'singapore-london', 'lszh-approach', 'egll-approach', 'evra-approach'];

for (const id of AIRLINER_MISSIONS) {
  test(`the FUEL page draws from the layout — ${id}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?mission=${id}&test=1`);
    await page.waitForFunction(() => window.simReady === true);
    await page.evaluate(() => { window.simSetState({ ecamPage: 'fuel' }); window.simStep(2, 1 / 60); });
    await page.keyboard.press('m');
    await frames(page);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.simGetState().fuelSys.fob)).toBeGreaterThan(0);
  });
}

test('centre view: Tab steps the lower ECAM ELEC → HYD → FUEL → ELEC', async ({ page }) => {
  await page.goto('/?mission=lszh-approach&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await page.evaluate(() => window.simSetState({ ecamPage: 'elec' }));
  await page.keyboard.press('m');
  const pages = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); pages.push(await page.evaluate(() => window.simGetState().ecamPage)); }
  expect(pages).toEqual(['hyd', 'fuel', 'elec']);
});

test('the fuel on board falls by the engines\' fuel flow', async ({ page }) => {
  await page.goto('/?mission=lszh-approach&test=1');
  await page.waitForFunction(() => window.simReady === true);
  const r = await page.evaluate(() => {
    const s0 = window.simGetState();
    window.simSetState({ paused: false });
    window.simStep(60 * 60, 1 / 60);
    const s1 = window.simGetState();
    return { burned: s0.fuelSys.fob - s1.fuelSys.fob, ff: s1.engines.reduce((a, e) => a + e.ff, 0) };
  });
  expect(r.burned).toBeGreaterThan(0);
  expect(r.burned).toBeLessThan(r.ff);                               // one minute of at most this flow (kg/h) — far less than an hour's
});

test('no fuel cautions on the cold A340, none carried over when switching to the A350', async ({ page }) => {
  const fuelKeys = () => page.evaluate(() => { window.simStep(2, 1 / 60); const w = window.simGetState().warnings;
                                               return Object.keys(w).filter(k => k.startsWith('FUEL_') && w[k]); });
  await page.goto('/?mission=fimp-takeoff&test=1');                 // the A340 cold on the stand
  await page.waitForFunction(() => window.simReady === true);
  expect(await fuelKeys()).toEqual([]);
  await page.evaluate(() => window.simLoad('lszh-approach'));       // → the A350 in flight
  await page.waitForFunction(() => window.simReady === true);
  expect(await fuelKeys()).toEqual([]);
});
