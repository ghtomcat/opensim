/**
 * Tab pages the glass airliners' screens and does nothing anywhere else. It used to swap the
 * cockpit for an Airbus ECAM: blank on the hand-drawn panels, false alarms on the default one.
 */
import { test, expect } from '@playwright/test';

for (const [what, mission] of [['Bf 109', 'wolfskopf-1942'], ['C172', 'lszf-pattern'], ['Avro 504', 'melun-1918'], ['An-225', 'hostomel-2022']]) {
  test(`${what}: Tab leaves the cockpit in place, and the focus`, async ({ page }) => {
    await page.goto(`/?mission=${mission}&test=1`);
    await page.waitForFunction(() => window.simReady === true, null, { timeout: 15_000 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);                                   // rendered frames
    await expect(page.locator('#pfd')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
}

test('an airliner: Tab pages the right screen through the ECAM and back to the ND', async ({ page }) => {
  await page.goto('/?mission=lszh-approach&test=1');
  await page.waitForFunction(() => window.simReady === true, null, { timeout: 15_000 });
  const pages = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    pages.push(await page.evaluate(() => window.simGetState().ecamPage));
  }
  expect(pages).toEqual(['status', 'elec', 'hyd', 'fuel', 'status']);   // ND → ECAM status → ELEC → HYD → FUEL → ND
  await expect(page.locator('#pfd')).toBeVisible();
});
