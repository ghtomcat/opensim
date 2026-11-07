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
  await page.evaluate(() => window.simSetState({ masterBat: true }));   // electric starter
  await page.keyboard.press('e');
  await page.waitForTimeout(800);                                     // the starter is turning (real audio time)
  expect(await level(page)).toBeGreaterThan(0.01);
  await page.evaluate(() => window.simStep(180, 1 / 60));             // 3 s of sim time — past the 2.8 s start
  expect((await page.evaluate(() => window.simGetState())).engineState).toBe('running');
  await page.waitForTimeout(1500);                                    // worklet hand-off
  expect(await level(page)).toBeGreaterThan(0.01);
});

test('X silences a running engine and brings it back, also on an aircraft with a start sequence', async ({ page }) => {
  await tapDestination(page);
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.evaluate(() => window.simSetState({ masterBat: true }));
  await page.keyboard.press('e');
  await page.evaluate(() => window.simStep(180, 1 / 60));
  await page.waitForTimeout(1500);
  expect(await level(page)).toBeGreaterThan(0.01);
  await page.keyboard.press('x');
  await page.waitForTimeout(300);                                     // the analyser's window empties
  expect(await level(page)).toBeLessThan(0.001);
  expect((await page.evaluate(() => window.simGetState())).engineState).toBe('running');
  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  expect(await level(page)).toBeGreaterThan(0.01);
});

test('X reaches everything: any Web Audio voice, and clips playing or started later', async ({ page }) => {
  await tapDestination(page);
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.keyboard.press('x');
  await page.evaluate(async () => {
    const { audioContext, audioOutput, audioElement } = await import('/core/audio.js');
    const ctx = audioContext(); await ctx.resume();
    const o = ctx.createOscillator(); o.connect(audioOutput()); o.start();   // a voice that isn't the engine
    window.__clip = audioElement('assets/gpws/pull_up.mp3');
  });
  await page.waitForTimeout(300);
  expect(await level(page)).toBeLessThan(0.001);
  expect(await page.evaluate(() => window.__clip.muted)).toBe(true);
  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  expect(await level(page)).toBeGreaterThan(0.01);
});

test("a mission's transmission stops when the mission is left", async ({ page }) => {
  // Demo-2's 250 s webcast plays through playRadio. Since the AudioContext stays open across
  // missions (a53f750), nothing stopped it: it ran on into the next mission (2026-11-07).
  await tapDestination(page);
  await page.goto('/?mission=crew-demo2&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
  await page.keyboard.press('Shift');                                  // a gesture: the context runs
  await page.evaluate(() => window.simStep(1, 1));                     // t=0 → the webcast entry fires
  await expect.poll(() => level(page), { timeout: 10_000 }).toBeGreaterThan(0.01);
  await page.evaluate(() => window.simLoad('lszf-pattern'));          // cold and dark: nothing should sound
  await page.waitForFunction(() => window.simGetState().mission?.id === 'lszf-pattern', null, { timeout: 15_000 });
  await page.waitForTimeout(600);                                      // the radio chain's squelch tail
  expect(await level(page)).toBeLessThan(0.001);
});
