/**
 * The overhead's HYDRAULICS section is built from the aircraft's hydraulic layout (display/overhead.js,
 * core/hydraulics.js): a control per pump (not the RAT), each sending its pump's command to
 * core/hydraulics.js (S.hydCtl). FAULT lights when a pump is switched on but not delivering.
 */
import { test, expect } from '@playwright/test';

async function overhead(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.keyboard.press('o');
}
const ids = (page) => page.locator('.gpb[id^="pb-hyd-"]').evaluateAll(els => els.map(e => e.id));
const click = (page, id) => page.locator(`#${id}`).dispatchEvent('click');
const ctl = (page) => page.evaluate(() => window.simGetState().hydCtl);

test('the A340: a control for each pump of its layout', async ({ page }) => {
  await overhead(page, 'fimp-takeoff');
  expect(await ids(page)).toEqual(['pb-hyd-greenEdp', 'pb-hyd-greenElec', 'pb-hyd-blueElec', 'pb-hyd-yellowEdp', 'pb-hyd-yellowElec']);
});

test('the controls send their commands: BLUE ELEC on pressurises BLUE; an engine pump off is lit off', async ({ page }) => {
  await overhead(page, 'lszh-approach');                          // airborne, engines running
  await click(page, 'pb-hyd-blueElec');
  expect((await ctl(page)).blueElec).toBe('on');
  await page.evaluate(() => { window.simSetState({ paused: false }); window.simStep(6 * 60, 1 / 60); });
  expect((await page.evaluate(() => window.simGetState().hyd.systems.blue.psi))).toBe(3000);
  await expect(page.locator('#pb-hyd-blueElec-lower')).toHaveClass(/lit/);
  await click(page, 'pb-hyd-greenEdp');
  expect((await ctl(page)).greenEdp).toBe('off');
  await expect(page.locator('#pb-hyd-greenEdp-lower')).not.toHaveClass(/lit/);
});

test('FAULT: an engine pump switched on with its engine stopped', async ({ page }) => {
  await overhead(page, 'fimp-takeoff');                           // cold on the stand
  await page.evaluate(() => window.simStep(2, 1 / 60));
  await page.keyboard.press('o'); await page.keyboard.press('o');  // redraw
  await expect(page.locator('#pb-hyd-greenEdp-upper')).toHaveClass(/lit/);
  await expect(page.locator('#pb-hyd-greenElec-upper')).not.toHaveClass(/lit/);   // off — no fault
});
