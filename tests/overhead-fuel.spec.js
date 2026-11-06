/**
 * The overhead's FUEL section is built from the aircraft's fuel layout (display/overhead.js,
 * core/fuel-system.js): a group per tank with its pumps, then the crossfeed; each control sends its
 * element's command (S.fuelCtl). FAULT when a pump is on without pressure. No section on an aircraft
 * without the airliner fuel system.
 */
import { test, expect } from '@playwright/test';

async function overhead(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.keyboard.press('o');
}
const ids = (page) => page.locator('.gpb[id^="pb-fuel"]').evaluateAll(els => els.map(e => e.id));
const click = (page, id) => page.locator(`#${id}`).dispatchEvent('click');
const ctl = (page) => page.evaluate(() => window.simGetState().fuelCtl);

test('the 777: a control per pump of its layout, then the crossfeed', async ({ page }) => {
  await overhead(page, 'singapore-london');
  expect(await ids(page)).toEqual(['pb-fuel-lFwd', 'pb-fuel-lAft', 'pb-fuel-cL', 'pb-fuel-cR', 'pb-fuel-rFwd', 'pb-fuel-rAft', 'pb-fuelv-xfeed']);
  await expect(page.locator('#pb-fuel-lFwd-lower')).toHaveClass(/lit/);                  // on
  await expect(page.locator('#pb-fuelv-xfeed-lower')).not.toHaveClass(/lit/);            // closed
});

test('the controls send their commands: L pumps off and X FEED open — ENG 1 draws from the right', async ({ page }) => {
  await overhead(page, 'singapore-london');
  for (const id of ['pb-fuel-lFwd', 'pb-fuel-lAft', 'pb-fuel-cL', 'pb-fuel-cR']) await click(page, id);
  await click(page, 'pb-fuelv-xfeed');
  expect(await ctl(page)).toEqual({ lFwd: false, lAft: false, cL: false, cR: false, xfeed: true });
  await page.evaluate(() => { window.simSetState({ paused: false }); window.simStep(60, 1 / 60); });
  expect(await page.evaluate(() => window.simGetState().fuelSys.feeds.eng1)).toEqual(['right']);
  await expect(page.locator('#pb-fuelv-xfeed-lower')).toHaveClass(/lit/);
  await expect(page.locator('#pb-fuel-lFwd-lower')).not.toHaveClass(/lit/);
});

test('FAULT: a pump on without pressure (no power); none on the running 777', async ({ page }) => {
  await overhead(page, 'singapore-london');
  await page.evaluate(() => window.simStep(2, 1 / 60));          // the electrical and fuel systems solved once
  await page.keyboard.press('o'); await page.keyboard.press('o');
  await expect(page.locator('#pb-fuel-lFwd-upper')).not.toHaveClass(/lit/);
  await overhead(page, 'fimp-takeoff');                           // the A340 cold — no AC power
  await page.evaluate(() => window.simStep(2, 1 / 60));
  await page.keyboard.press('o'); await page.keyboard.press('o');
  await expect(page.locator('#pb-fuel-lFwd-upper')).toHaveClass(/lit/);
});

test('no FUEL section without the airliner fuel system (the Robin)', async ({ page }) => {
  await overhead(page, 'lszf-pattern');
  expect(await ids(page)).toEqual([]);
});
