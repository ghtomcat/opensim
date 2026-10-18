/**
 * Sound output — does the engine sound actually reach the speakers?
 *
 * An analyser is put in front of every AudioDestinationNode (init script), and the test
 * measures the signal there. Guards the wiring, not the timbre: a sound.js graph that
 * renders but is cut off from the destination (2026-10-18: its output gain was connected
 * to itself) passes every state test and is silent.
 */
import { test, expect } from '@playwright/test';

async function tapDestination(page) {
  await page.addInitScript(() => {
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const ctx = target.context;
        if (!ctx.__tap) { ctx.__tap = ctx.createAnalyser(); ctx.__tap.fftSize = 8192; orig.call(ctx.__tap, target); (window.__ctxs ??= []).push(ctx); }
        return orig.call(this, ctx.__tap, ...rest);
      }
      return orig.call(this, target, ...rest);
    };
  });
}

/** RMS at the speakers, summed over all contexts */
function level(page) {
  return page.evaluate(() => (window.__ctxs ?? []).reduce((sum, c) => {
    const a = new Float32Array(c.__tap.fftSize); c.__tap.getFloatTimeDomainData(a);
    let r = 0; for (const v of a) r += v * v;
    return sum + Math.sqrt(r / a.length);
  }, 0));
}

test('C172 cold start: the start-up and the running engine are audible', async ({ page }) => {
  await tapDestination(page);
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.keyboard.press('e');
  await page.waitForTimeout(800);                                     // the starter is turning (real audio time)
  expect(await level(page)).toBeGreaterThan(0.01);
  await page.evaluate(() => window.simStep(180, 1 / 60));             // 3 s of sim time — past the 2.8 s start
  expect((await page.evaluate(() => window.simGetState())).engineState).toBe('running');
  await page.waitForTimeout(1500);                                    // worklet hand-off
  expect(await level(page)).toBeGreaterThan(0.01);
});
