/**
 * Kneeboard — the generated TAKEOFF DATA page: the calculated plan (core/takeoff-plan.js), the same numbers
 * the briefing page shows, and the flight plan's SID. Only on a takeoff of an aircraft with computed speeds.
 */

import { test, expect } from '@playwright/test';

async function load(page, id) {
  await page.goto(`/?test=1&mission=${id}`);
  await page.waitForFunction(id => window.simReady === true && window.simGetState().mission?.id === id, id);
}

/** The kneeboard's page titles, paging through with ▶ (opened with K). */
async function titles(page) {
  await page.keyboard.press('k');
  await expect(page.locator('#kneeboard .kb-title')).toBeVisible();
  const out = [];
  for (;;) {
    out.push(await page.locator('#kneeboard .kb-title').textContent());
    const next = page.locator('#kb-next');
    if (await next.isDisabled()) break;
    await next.click();
  }
  return out;
}

async function goTo(page, title) {
  while ((await page.locator('#kneeboard .kb-title').textContent()) !== title) await page.click('#kb-prev');
}

test('FIMP: TAKEOFF DATA — runway 14 at A, the runway ahead, flaps 2, the speeds the briefing shows, the SID', async ({ page }) => {
  await load(page, 'fimp-takeoff');
  expect(await titles(page)).toContain('TAKEOFF DATA');
  await goTo(page, 'TAKEOFF DATA');
  const kb = page.locator('#kneeboard');
  await expect(kb).toContainText('RWY 14');
  await expect(kb).toContainText('RWY 14 · INT A');
  await expect(kb).toContainText('2,675 m of 3,367');
  await expect(kb).toContainText('FLAPS 2 · THRUST TOGA');
  await expect(kb).toContainText('V1 135 · VR 135 · V2 150');
  await expect(kb).toContainText('SID DUPN1A');
  await expect(kb).not.toContainText('162');                     // the A340's old typed V1
});

test('an approach has no TAKEOFF DATA page', async ({ page }) => {
  await load(page, 'lszh-approach');
  expect(await titles(page)).not.toContain('TAKEOFF DATA');
});
