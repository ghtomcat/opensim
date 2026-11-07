/**
 * The pedestal's flaps and speed brake follow the aircraft data: the flap buttons are named by
 * flapLabel() (core/airframe.js), and SPD BRK — the button, the S key and the spoilers in the
 * physics — exists only where the aircraft has `spoilers`. Found 2026-11-07 (Markus): the
 * Velis's flaps read "undefined", and it had a speed brake.
 */
import { test, expect } from '@playwright/test';
import { frames } from './frames.js';

async function pedestal(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true);
  await page.keyboard.press('d');
  await frames(page);
}
const flaps = (page) => page.locator('.ped-flap-pos').allTextContents();

for (const [what, mission, names, spdBrk] of [
  ['Velis', 'lszg-velis', ['UP', '15°'], false],
  ['DR400', 'grenchen-circuit', ['UP', '15°', '30°'], false],
  ['A350', 'lszh-approach', ['0', '1+F', '2', '3'], true],
]) {
  test(`${what}: the flaps are named ${names.join(' · ')}, ${spdBrk ? 'with' : 'no'} SPD BRK`, async ({ page }) => {
    await pedestal(page, mission);
    expect((await flaps(page)).map(s => s.trim())).toEqual(names);
    await expect(page.locator('.ped-spdbk-block')).toHaveCount(spdBrk ? 1 : 0);
  });
}

test('S works only with spoilers: nothing on the Velis, RET → ARM on the A350', async ({ page }) => {
  const sb = () => page.evaluate(() => window.simGetState().speedBrake ?? 0);
  await page.goto('/?mission=lszg-velis&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await page.keyboard.press('s');
  expect(await sb()).toBe(0);
  await page.goto('/?mission=lszh-approach&test=1');                   // starts armed (initialState.speedBrake 1)
  await page.waitForFunction(() => window.simReady === true);
  const before = await sb();
  await page.keyboard.press('s');
  expect(await sb()).toBe((before + 1) % 3);
});
