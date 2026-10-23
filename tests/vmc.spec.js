/**
 * V_MCA emerges from the model (core/yaw.js) — it is not a parameter. The 777 on singapore-london,
 * airborne, ENG 1 failed, ENG 2 at full thrust, full right rudder and 5° of bank toward the live
 * engine (the CS/FAR 25.149 definition), speed and altitude held every frame. Above ~112 kt the
 * sideslip settles and the heading holds; below it the fin stalls, the sideslip runs away and the
 * aircraft yaws off toward the dead engine.
 */
import { test, expect } from '@playwright/test';

test('V_MCA: the 777 is held on one engine at 125 kt, departs at 105 kt', async ({ page }) => {
  await page.goto('/?mission=singapore-london&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  const r = await page.evaluate(async () => {
    window.simSetState({ paused: false, thrustLever: 1, parkBrake: false });
    window.simStep(40 * 60, 1 / 60);
    window.simSetState({ pitchT: 8 });
    window.simStep(30 * 60, 1 / 60);
    (await import('/core/engine.js')).setEngineFactor('failure', 0, 0);
    const out = {};
    for (const kt of [125, 105]) {
      const hold = { spd: kt, alt: 3000, vs: 0, rudder: 1, roll: 5, rollT: 5, pitchT: 4 };
      window.simSetState({ ...hold, beta: 0, yawDev: 0 });
      let turn = 0, prev = window.simGetState().hdg, beta = 0;
      for (let f = 0; f < 40 * 60; f++) {                          // 40 s, held every frame
        window.simSetState(hold);
        window.simStep(1, 1 / 60);
        const s = window.simGetState();
        if (f >= 20 * 60) turn += ((s.hdg - prev + 540) % 360) - 180;   // the last 20 s, unwrapped
        prev = s.hdg; beta = Math.max(beta, Math.abs(s.beta));
      }
      out[kt] = { rate: turn / 20, beta };
    }
    return out;
  });
  expect(r[125].beta).toBeLessThan(10);                            // held: a few degrees of sideslip
  expect(Math.abs(r[125].rate)).toBeLessThan(1);
  expect(r[105].beta).toBeGreaterThan(25);                         // the fin stalled, the sideslip ran away
  expect(r[105].rate).toBeLessThan(-10);                           // yawing off toward the dead engine
});
