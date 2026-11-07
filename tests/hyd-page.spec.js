/**
 * The HYD page is drawn from each aircraft's hydraulic layout (display/pfd_instruments.js
 * drawHydPage, core/hydraulics.js hydView). Every airliner draws it without an error, and the page
 * follows the solver: on the A350 with ENG 1 failed, GREEN loses its engine pump and its pressure.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

const AIRLINER_MISSIONS = ['fimp-takeoff', 'lsgg-takeoff', 'singapore-london', 'lszh-approach', 'egll-approach', 'evra-approach'];

for (const id of AIRLINER_MISSIONS) {
  test(`the HYD page draws from the layout — ${id}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?mission=${id}&test=1`);
    await page.waitForFunction(() => window.simReady === true);
    await page.evaluate(() => { window.simSetState({ ecamPage: 'hyd' }); window.simStep(2, 1 / 60); });
    await page.keyboard.press('m');                               // the centre view: E/WD + HYD
    await frames(page);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => Object.keys(window.simGetState().hyd?.systems ?? {}).length)).toBeGreaterThan(0);
  });
}

test('the A350 with ENG 1 failed: GREEN loses its engine pump and its pressure', async ({ page }) => {
  await page.goto('/?mission=lszh-approach&test=1');
  await page.waitForFunction(() => window.simReady === true);
  const v = await page.evaluate(async () => {
    window.simSetState({ paused: false });
    (await import('/core/engine.js')).setEngineFactor('failure', 0, 0);
    window.simStep(60 * 60, 1 / 60);
    return (await import('/core/hydraulics.js')).hydView();
  });
  const green = v.find(s => s.id === 'green'), yellow = v.find(s => s.id === 'yellow');
  expect(green.pumps.find(p => p.type === 'edp').state).toBe('fault');
  expect(green.lost).toBe(true);
  expect(yellow.pumps.find(p => p.type === 'edp').state).toBe('run');
  expect(yellow.lo).toBe(false);
});
