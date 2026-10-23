/**
 * The rudder controls (core/input.js): held `,` / `.` push the pedals left / right and they spring
 * back when released; `<` / `>` step the rudder trim. On the 777 (measured tail, core/yaw.js) the
 * rudder yaws it in the air and holds ENG 1 out on the takeoff roll; on an aircraft without a
 * measured tail it steers the nosewheel on the ground.
 */
import { test, expect } from '@playwright/test';

async function load(page, mission) {
  await page.goto(`/?mission=${mission}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.evaluate(() => window.simSetState({ paused: false }));
}
const st = (page) => page.evaluate(() => window.simGetState());
const step = (page, s) => page.evaluate((s) => window.simStep(Math.round(s * 60), 1 / 60), s);

test('held . pushes the right pedal, released it springs back; , the left', async ({ page }) => {
  await load(page, 'singapore-london');
  await page.keyboard.down('.');
  await step(page, 1);
  expect((await st(page)).rudder).toBe(1);                       // full in ~0.7 s
  await page.keyboard.up('.');
  await step(page, 1);
  expect((await st(page)).rudder).toBe(0);                       // back to centre
  await page.keyboard.down(',');
  await step(page, 0.3);
  const r = (await st(page)).rudder;
  expect(r).toBeLessThan(-0.3);
  expect(r).toBeGreaterThan(-0.6);                                // ramps, doesn't jump
  await page.keyboard.up(',');
});

test('< and > step the rudder trim, which stays — within its limit', async ({ page }) => {
  await load(page, 'singapore-london');
  for (let i = 0; i < 5; i++) await page.keyboard.press('>');
  expect((await st(page)).rudderTrim).toBeCloseTo(0.10, 6);
  await page.keyboard.press('<');
  await step(page, 2);
  expect((await st(page)).rudderTrim).toBeCloseTo(0.08, 6);       // trim doesn't spring back
  for (let i = 0; i < 40; i++) await page.keyboard.press('<');
  expect((await st(page)).rudderTrim).toBeCloseTo(-0.5, 6);
});

test('the 777 in the air: holding . yaws the nose right', async ({ page }) => {
  await load(page, 'singapore-london');
  await page.evaluate(() => {
    window.simSetState({ thrustLever: 1, parkBrake: false });
    window.simStep(40 * 60, 1 / 60);
    window.simSetState({ pitchT: 8 });
    window.simStep(40 * 60, 1 / 60);
  });
  const s0 = await st(page);
  expect(s0.wow).toBe(false);
  await page.keyboard.down('.');
  await step(page, 3);
  await page.keyboard.up('.');
  const s = await st(page);
  expect(((s.hdg - s0.hdg + 540) % 360) - 180).toBeGreaterThan(1);
  expect(s.beta).toBeLessThan(0);                                 // the nose right of the path: the air from the left
});

test('an aircraft without a measured tail: the pedals steer the nosewheel', async ({ page }) => {
  await load(page, 'lszf-pattern');
  const s0 = await st(page);
  expect(s0.wow).toBe(true);
  await page.evaluate(() => window.simSetState({ spd: 15, parkBrake: false }));   // rolling slowly
  await page.keyboard.down(',');
  await step(page, 2);
  await page.keyboard.up(',');
  const s = await st(page);
  expect(((s.hdg - s0.hdg + 540) % 360) - 180).toBeLessThan(-2);
  expect(s.beta).toBe(0);
});
