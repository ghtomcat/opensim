/**
 * The G1000's oil gauges: they read the engine (core/engine.js), and their bands are the aircraft's own from its
 * flight manual (aircraft engine.oil — the C172S's POH, Figure 2-3), as a real G1000 is configured.
 */
import { test, expect } from '@playwright/test';

async function load(page) {
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true);
}

test('the C172S\'s oil bands are its POH\'s: pressure red 0–20, green 50–90, red from 115 PSI; temperature green 100–245, red from 245 °F', async ({ page }) => {
  await load(page);
  const b = await page.evaluate(async () => {
    const { oilBands } = await import('/display/g1000.js');
    const r = oilBands();
    return { press: r.press.map(([a, z]) => [a, z]), temp: r.temp.map(([a, z]) => [a, z]), pMax: r.pMax, tMax: r.tMax };
  });
  expect(b.press).toEqual([[0, 20], [50, 90], [115, 120]]);
  expect(b.temp).toEqual([[100, 245], [245, 260]]);
});

test('the oil gauges read the engine — 50 psi at idle, 90 at full rpm', async ({ page }) => {
  await load(page);
  const psi = await page.evaluate(() => {
    const out = [];
    for (const lever of [0, 1]) {
      window.simSetState({ engineState: 'running', enginePower: 1, lever, parkBrake: true, paused: false });
      window.simStep(20, 0.1);
      out.push(Math.round(window.simGetState().engines[0].oil));
    }
    return out;
  });
  expect(psi).toEqual([50, 90]);
});
