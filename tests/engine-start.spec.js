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

test('the pedestal shows the real N1 under the levers — 0 % with the engines off', async ({ page }) => {
  await load(page);
  await page.keyboard.press('d');
  await expect(page.locator('#ped-n1-0')).toHaveText('0.0%');
  await page.evaluate(() => window.simSetState({ acBusPowered: true, engMode: 'IGN+START' }));
  await page.locator('#ped-master-1').dispatchEvent('click');
  await step(page, 60);
  const n1 = (await state(page)).n1;
  await expect(page.locator('#ped-n1-0')).toHaveText(`${n1.toFixed(1)}%`);
});

test('ENG MASTER positions do not carry over to the next mission, and match its engine count', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.simSetState({ engMasters: [true, true] }));
  await page.evaluate(() => window.simLoad('fimp-takeoff'));           // cold A340, same page
  await page.waitForFunction(() => window.simGetState().aircraft?.id === 'a340', { timeout: 15_000 });
  expect((await state(page)).engMasters).toEqual([false, false, false, false]);
});

test('a running engine does not show the other ENG MASTER as ON', async ({ page }) => {
  await load(page);
  await page.keyboard.press('d');
  await page.evaluate(() => window.simSetState({ acBusPowered: true, engMode: 'IGN+START' }));
  await page.locator('#ped-master-1').dispatchEvent('click');
  await step(page, 60);
  expect((await state(page)).engineState).toBe('running');
  await expect(page.locator('#ped-master-1')).toHaveClass(/flip-on/);
  await expect(page.locator('#ped-master-2')).not.toHaveClass(/flip-on/);
});
