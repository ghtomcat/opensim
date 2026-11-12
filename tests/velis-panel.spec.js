/**
 * The Velis cockpit: its four switches are on the centre console (the pedestal view, D) in HB-SYQ's
 * order — MASTER, AVIONICS, BATT EN, PWR EN (Markus's photo, 2026-11-12) — and the instruments (NESIS,
 * EPSI and its map, COM) are dark until MASTER and AVIONICS are on (BATT EN is the traction batteries —
 * the checklist reads the charge on the EPSI before it, POH 4-9).
 * Found 2026-11-07 (Markus): the EPSI showed altitude, V/S and the map with everything off.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

async function load(page) {
  await page.goto('/?mission=lszg-velis&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await frames(page);
}
const switches = (page) => page.evaluate(async () => ({ ...(await import('/core/state.js')).S.switches }));
const pedestalOpen = (page) => page.evaluate(async () => (await import('/core/state.js')).S.cockpitView === 'pedestal');

/** Flip a console switch as a pilot would: open the pedestal (D), click the toggle, close it again */
async function click(page, control) {
  if (!(await pedestalOpen(page))) await page.keyboard.press('d');
  await frames(page);
  await page.locator(`#pedestal .ctl-toggle[data-control="${control}"], .ctl-toggle[data-control="${control}"]`).first().click();
  await frames(page);
  await page.keyboard.press('d');
  await frames(page);
}

test('the console switches: MASTER, AVIONICS, BATT EN, PWR EN on the pedestal, in that order; no key, nothing on the panel', async ({ page }) => {
  await load(page);
  await page.keyboard.press('d'); await frames(page);
  const labels = await page.locator('.ctl-toggle .ctl-toggle-lbl').allTextContents();
  expect(labels).toEqual(['MASTER', 'AVIONICS', 'BATT EN', 'PWR EN']);
  await page.keyboard.press('d'); await frames(page);
  const areas = await page.evaluate(async () => {
    const { hitAreas } = await import('/display/hit.js');
    return [...document.querySelectorAll('canvas')].flatMap(c => hitAreas(c)).map(a => a.name);
  });
  expect(areas.filter(n => !n.startsWith('baroKnob'))).toEqual([]);        // no switches on the panel — only the altimeter's knob
  for (const c of ['bat', 'avionics', 'battEn', 'pwrEn']) await click(page, c);
  expect(await switches(page)).toMatchObject({ master: true, battEn: true, pwrEn: true, avionics: true });
});

test('the EPSI and its map are dark until the avionics have power', async ({ page }) => {
  await load(page);
  const map = page.locator('#velis-map-overlay');
  await expect(map).toBeHidden();                                         // cold and dark
  await click(page, 'avionics');
  await expect(map).toBeHidden();                                         // AVIONICS without MASTER: no power
  await click(page, 'bat');
  await expect(map).toBeVisible();                                        // on the 14 V battery, BATT EN still off
  await click(page, 'bat');
  await expect(map).toBeHidden();
});

test('the radio is the COM panel on the pedestal: dark until MASTER and AVIONICS are on', async ({ page }) => {
  // The Velis drew a second COM on its cockpit canvas — a leftover, removed 2026-11-07 (Markus)
  await load(page);
  await page.keyboard.press('d');                                         // the pedestal
  const com = page.locator('#com-container');
  await expect(com).toBeVisible();
  await expect(com).toHaveClass(/com-off/);
  await page.keyboard.press('d');                                         // back to the cockpit
  await click(page, 'bat'); await click(page, 'avionics');
  await page.keyboard.press('d');
  await expect(com).not.toHaveClass(/com-off/);
});
