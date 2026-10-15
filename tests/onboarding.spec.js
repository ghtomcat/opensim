/**
 * Key map (onboarding overlay) — shown and dismissed on every mission, not only the first one
 * in a page. Runs in normal mode: test mode (?test=1) skips the overlay.
 *
 * Second load in the same page: Back to the selector, Forward to the mission again (popstate →
 * init()). The overlay pauses the sim while it's up, so an invisible overlay = a frozen sim.
 */

import { test, expect } from '@playwright/test';

const paused = (page) => page.evaluate(async () => (await import('/core/state.js')).S.paused);

test('the key map shows again on the next mission, and a click dismisses it', async ({ page }) => {
  const ob = page.locator('#onboarding');

  await page.goto('/?mission=lszf-pattern');
  await expect(ob).toHaveClass(/visible/, { timeout: 15_000 });
  await expect(ob).toBeVisible();
  expect(await paused(page)).toBe(true);
  await page.keyboard.press('Shift');                       // any key dismisses
  await expect(ob).toBeHidden();                            // faded out, then display:none
  expect(await paused(page)).toBe(false);

  await page.goBack();                                      // selector
  await page.goForward();                                   // the same mission, loaded again
  await expect(ob).toHaveClass(/visible/, { timeout: 15_000 });
  await expect(ob).toBeVisible();
  expect(await paused(page)).toBe(true);
  await ob.click();
  await expect(ob).toBeHidden();
  expect(await paused(page)).toBe(false);
});
