// OpenSim — stall.spec.js
// The high-alpha stall's push is per second (core/physics.js — a stand-in until the stall is modelled, issues.md
// *Stall handling*): a Bf 109 held nose-up with the engine dead stalls and mushes down — not −8,000 ft/min, faster
// and faster, as 800 ft/min per frame gave. hahnweide-1944: no scripted failures (wolfskopf's start at 115 s).

import { test, expect } from '@playwright/test';

test('a held stall mushes down — the Bf 109 at 16°, engine dead: below 2,500 ft/min, slowing, not diving', async ({ page }) => {
  await page.goto('/?mission=hahnweide-1944&test=1');
  await page.waitForFunction(() => window.simReady === true);
  const r = await page.evaluate(() => {
    window.simSetState({ wow: false, parkBrake: false, alt: 6312, altT: 6312, spd: 110, pitch: 16, pitchT: 16, vs: 0,
                         lever: 0, enginePower: 0, ap: false, paused: false });
    let minVs = 0, maxSpd = 0;
    for (let i = 1; i <= 20 * 60; i++) {
      window.simStep(1);
      const s = window.simGetState();
      minVs = Math.min(minVs, s.vs);
      if (i > 5 * 60) maxSpd = Math.max(maxSpd, s.spd);   // after the zoom
    }
    return { minVs, maxSpd, crashed: window.simGetState().crashed };
  });
  expect(r.crashed).toBe(false);
  expect(r.minVs).toBeGreaterThan(-2500);   // was −8,269 at 800 ft/min per frame
  expect(r.maxSpd).toBeLessThan(110);       // a stall slows it — the old push dived it to 150 kt
});
