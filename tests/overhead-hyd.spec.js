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

test('the A340: a control for each pump of its layout — no RAT button', async ({ page }) => {
  await overhead(page, 'fimp-takeoff');
  expect(await ids(page)).toEqual(['pb-hyd-gEdp1', 'pb-hyd-gEdp4', 'pb-hyd-gElec', 'pb-hyd-bEdp2', 'pb-hyd-bElec',
                                   'pb-hyd-yEdp3', 'pb-hyd-yElec']);
  await expect(page.locator('#pb-hyd-gElec-lower')).toHaveText('AUTO');
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
  await expect(page.locator('#pb-hyd-gEdp1-upper')).toHaveClass(/lit/);
  await expect(page.locator('#pb-hyd-gElec-upper')).not.toHaveClass(/lit/);       // AUTO, standing by — no fault
});

test('the 777: its own panel — L ENG, L ELEC, C1 / C2 ELEC, C1 / C2 AIR, R ENG, R ELEC; no RAT button', async ({ page }) => {
  await overhead(page, 'singapore-london');
  expect(await ids(page)).toEqual(['pb-hyd-lEdp', 'pb-hyd-lAcmp', 'pb-hyd-c1Acmp', 'pb-hyd-c2Acmp', 'pb-hyd-c1Adp', 'pb-hyd-c2Adp',
                                   'pb-hyd-rEdp', 'pb-hyd-rAcmp']);
  await expect(page.locator('#pb-hyd-lAcmp-lower')).toHaveText('AUTO');                  // a demand pump
  await click(page, 'pb-hyd-lAcmp');
  expect((await ctl(page)).lAcmp).toBe('on');
  await expect(page.locator('#pb-hyd-lAcmp-lower')).toHaveText('ON');
  await click(page, 'pb-hyd-lAcmp');
  await click(page, 'pb-hyd-lAcmp');
  expect((await ctl(page)).lAcmp).toBe('auto');                                         // AUTO → ON → OFF → AUTO
});

test('the 777 loses ENG 1: only the L engine pump stops, L ELEC takes over, L keeps its pressure', async ({ page }) => {
  await overhead(page, 'singapore-london');                                              // engines running on the runway
  await page.evaluate(async () => {
    window.simSetState({ paused: false });
    (await import('/core/engine.js')).setEngineFactor('failure', 0, 0);
    window.simStep(60 * 60, 1 / 60);
  });
  const h = await page.evaluate(() => window.simGetState().hyd.systems);
  expect(h.L.pumps.lEdp.running).toBe(false);
  expect(h.L.pumps.lAcmp.running).toBe(true);
  expect(h.L.psi).toBe(3000);
  expect(h.R.pumps.rEdp.running).toBe(true);
  expect(h.R.pumps.rAcmp.running).toBe(false);
  expect(h.C.pumps.c1Acmp.running && h.C.pumps.c2Acmp.running).toBe(true);
  await expect(page.locator('#pb-hyd-lEdp-upper')).toHaveClass(/lit/);                  // L ENG: FAULT
  await expect(page.locator('#pb-hyd-rEdp-upper')).not.toHaveClass(/lit/);
});
