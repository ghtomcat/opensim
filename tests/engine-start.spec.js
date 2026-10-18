/**
 * Airliner engine start — from the cockpit, not the keyboard.
 * On an airliner E does nothing: the start needs power, ENG MODE IGN/START and the ENG MASTER
 * on the pedestal, which a key press can't check. Uses the E190 at Geneva (cold, on the ground).
 */
import { test, expect } from '@playwright/test';

async function load(page) {
  await page.goto('/?mission=lsgg-takeoff&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}
const state = (page) => page.evaluate(() => window.simGetState());
const step  = (page, s) => page.evaluate((n) => window.simStep(n, 1 / 60), Math.round(s * 60));

test('E does not start an airliner engine', async ({ page }) => {
  await load(page);
  expect((await state(page)).engineState).toBe('off');
  await page.keyboard.press('e');
  await step(page, 2);
  expect((await state(page)).engineState).toBe('off');
});

test('ENG MASTER on the pedestal starts it — with AC power and ENG MODE IGN/START', async ({ page }) => {
  await load(page);
  await page.keyboard.press('d');                                   // pedestal
  await page.evaluate(() => window.simSetState({ acBusPowered: false, engMode: 'IGN+START' }));
  await page.locator('#ped-master-1').dispatchEvent('click');
  expect((await state(page)).engineState).toBe('off');              // no AC power — no start (the master drops back to OFF)
  await page.evaluate(() => window.simSetState({ acBusPowered: true }));
  await page.locator('#ped-master-1').dispatchEvent('click');
  expect((await state(page)).engineState).toBe('starting');
});
