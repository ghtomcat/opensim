/**
 * The overhead's ELECTRICAL section is built from the aircraft's electrical layout
 * (display/overhead.js, core/electrical.js): one control per element, and every control sends its
 * element's command to core/electrical.js (S.elecCtl) — the A340 its four generators, three
 * batteries and two ground-power plugs, a twin its two generators.
 */
import { test, expect } from '@playwright/test';

async function overhead(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.keyboard.press('o');
}
const ids = (page, sel) => page.locator(sel).evaluateAll(els => els.map(e => e.id));
const click = (page, id) => page.locator(`#${id}`).dispatchEvent('click');
const ctl = (page) => page.evaluate(() => window.simGetState().elecCtl);

test('the A340: a control for each of its elements', async ({ page }) => {
  await overhead(page, 'fimp-takeoff');
  expect(await ids(page, '.gpb[id^="pb-el-gen"]')).toEqual(['pb-el-gen1', 'pb-el-gen2', 'pb-el-gen3', 'pb-el-gen4']);
  expect(await ids(page, '.ohp-idg-btn')).toEqual(['ohp-idg-gen1', 'ohp-idg-gen2', 'ohp-idg-gen3', 'ohp-idg-gen4']);
  expect(await ids(page, '.ohp-pb[id^="ohp-el-bat"]')).toEqual(['ohp-el-bat1', 'ohp-el-bat2', 'ohp-el-bat3']);
  expect(await ids(page, '.gpb[id^="pb-el-ext"]')).toEqual(['pb-el-extA', 'pb-el-extB']);
  await expect(page.locator('#pb-el-apugen')).toHaveCount(1);
  await expect(page.locator('#pb-el-busTie')).toHaveCount(1);
  await expect(page.locator('#pb-el-galley')).toHaveCount(1);
});

test('a twin: two generators, the default two batteries, one ground-power plug', async ({ page }) => {
  await overhead(page, 'lszh-approach');                          // A350 — no layout in its file: the default
  expect(await ids(page, '.gpb[id^="pb-el-gen"]')).toEqual(['pb-el-gen1', 'pb-el-gen2']);
  expect(await ids(page, '.ohp-pb[id^="ohp-el-bat"]')).toEqual(['ohp-el-bat1', 'ohp-el-bat2']);
  expect(await ids(page, '.gpb[id^="pb-el-ext"]')).toEqual(['pb-el-extA']);
});

test('the controls send their commands: BAT on powers the battery bus; GEN off takes the generator off line', async ({ page }) => {
  await overhead(page, 'fimp-takeoff');
  await click(page, 'ohp-el-bat1');
  expect((await ctl(page)).bat1).toEqual({ on: true });
  await page.evaluate(() => window.simStep(2, 1 / 60));
  expect((await page.evaluate(() => window.simGetState())).essentialBusPowered).toBe(true);
  await click(page, 'pb-el-gen2');
  expect((await ctl(page)).gen2).toEqual({ on: false, idg: true });
  await click(page, 'pb-el-busTie');
  expect((await ctl(page)).busTie).toEqual({ on: false });
});

test('the IDG disconnect needs its guard lifted; external power needs the ground', async ({ page }) => {
  await overhead(page, 'fimp-takeoff');
  await click(page, 'ohp-idg-gen1');
  expect((await ctl(page)).gen1).toBeUndefined();                 // guard down — nothing happens
  await click(page, 'ohp-idg-guard-gen1');
  await click(page, 'ohp-idg-gen1');
  expect((await ctl(page)).gen1).toEqual({ on: true, idg: false });
  await overhead(page, 'lszh-approach');                          // airborne
  await click(page, 'pb-el-extA');
  expect((await ctl(page)).extA).toBeUndefined();
});
