/**
 * The panel maps — HTML floating above the cockpit canvas (the Velis EPSI's, the G1000 MFD's and
 * the DR400 GTN's) — show only on the forward panel. On the pedestal they hung over it: the
 * Velis's and the DR400's did (2026-11-07, Markus), the C172's had its own guard.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

for (const [what, mission, map] of [['Velis', 'lszg-velis', '#velis-map-overlay'], ['C172', 'lszf-pattern', '#g1000-map-overlay'],
  ['DR400', 'grenchen-circuit', '#g1000-map-overlay']]) {
  test(`${what}: the panel map shows on the forward panel, not over the pedestal`, async ({ page }) => {
    await page.goto(`/?mission=${mission}&test=1`);
    await page.waitForFunction(() => window.simReady === true);
    await page.evaluate(async () => {                                     // the avionics on — the map has power
      const { S } = await import('/core/state.js');
      Object.assign(S.switches, { master: true, avionics: true });        // Velis
      window.simSetState({ masterBat: true, avionicsOn: true });          // C172, DR400
    });
    await frames(page);
    await expect(page.locator(map)).toBeVisible();
    await page.keyboard.press('d');                                       // the pedestal
    await frames(page);
    await expect(page.locator(map)).toBeHidden();
    await page.keyboard.press('d');                                       // back to the panel
    await frames(page);
    await expect(page.locator(map)).toBeVisible();
  });
}
