/**
 * The yaw axis on the ground (core/yaw.js groundYawStep, core/physics.js ground roll): the 777 on
 * singapore-london (WSSS 20C) loses ENG 1 on the takeoff roll at 150 kt. Without rudder the
 * nosewheel can't hold the thrust moment and the aircraft swings left off the centreline; a pilot
 * on the rudder pedals (a simple heading-hold in the test) keeps it on the centreline. Both engines
 * running: the roll stays straight.
 */
import { test, expect } from '@playwright/test';

async function takeoffRoll(page, { fail, pilot = false, after = 4 }) {
  await page.goto('/?mission=singapore-london&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  return page.evaluate(async ({ fail, pilot, after }) => {
    const S = () => window.simGetState();
    window.simSetState({ paused: false, thrustLever: 1, parkBrake: false });
    for (let i = 0; i < 120 && S().spd < 150; i++) window.simStep(30, 1 / 60);
    const s0 = S(), h0 = s0.hdg * Math.PI / 180, cosLat = Math.cos(s0.lat * Math.PI / 180);
    if (fail) (await import('/core/engine.js')).setEngineFactor('failure', 0, 0);
    let maxRudder = 0;
    for (let i = 0; i < after * 10; i++) {                         // 0.1-s steps
      if (pilot) {                                                 // the pilot: rudder against the heading change and the yaw rate
        const d = ((S().hdg - s0.hdg + 540) % 360) - 180;
        const rudder = Math.max(-1, Math.min(1, -0.5 * d - 0.5 * S().yawDev));
        maxRudder = Math.max(maxRudder, Math.abs(rudder));
        window.simSetState({ rudder });
      }
      window.simStep(6, 1 / 60);
    }
    const s = S();
    /* metres left (−) / right (+) of the line the aircraft was rolling along at the failure */
    const dN = (s.lat - s0.lat) * 60 * 1852, dE = (s.lon - s0.lon) * 60 * 1852 * cosLat;
    return { dHdg: ((s.hdg - s0.hdg + 540) % 360) - 180, offset: dE * Math.cos(h0) - dN * Math.sin(h0),
             spd0: s0.spd, wow: s.wow, maxRudder };
  }, { fail, pilot, after });
}

test('both engines: the takeoff roll stays straight', async ({ page }) => {
  const r = await takeoffRoll(page, { fail: false });
  expect(r.spd0).toBeGreaterThanOrEqual(150);
  expect(Math.abs(r.dHdg)).toBeLessThan(1e-9);
  expect(Math.abs(r.offset)).toBeLessThan(0.5);
});

test('ENG 1 fails at 150 kt, no rudder: the 777 swings left off the centreline', async ({ page }) => {
  const r = await takeoffRoll(page, { fail: true, after: 3 });
  expect(r.wow).toBe(true);
  expect(r.dHdg).toBeLessThan(-3);                                 // the nose toward the dead engine
  expect(r.offset).toBeLessThan(-5);                               // metres left of the line
});

test('ENG 1 fails at 150 kt, the pilot on the rudder: it stays on the centreline', async ({ page }) => {
  const r = await takeoffRoll(page, { fail: true, pilot: true, after: 3 });
  expect(r.wow).toBe(true);
  expect(Math.abs(r.dHdg)).toBeLessThan(2);
  expect(Math.abs(r.offset)).toBeLessThan(3);
  expect(r.maxRudder).toBeGreaterThan(0.3);                         // it took real rudder
});
