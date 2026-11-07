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

/* Real audio runs on its own thread and on the wall clock: wait until the sound gets where it
   should, never a fixed time — on a loaded machine the same change takes longer to be heard. */
const AUDIO = { timeout: 10_000 };

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
  await page.waitForFunction(() => window.simReady === true);
  await page.evaluate(() => window.simSetState({ masterBat: true }));   // electric starter
  await page.keyboard.press('e');
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);  // the starter is turning (real audio time)
  await page.evaluate(() => window.simStep(180, 1 / 60));             // 3 s of sim time — past the 2.8 s start
  expect((await page.evaluate(() => window.simGetState())).engineState).toBe('running');
  await page.waitForTimeout(1500);                                    // past the worklet hand-off …
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);  // … the running engine sounds
});

test('X silences a running engine and brings it back, also on an aircraft with a start sequence', async ({ page }) => {
  await tapDestination(page);
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await page.evaluate(() => window.simSetState({ masterBat: true }));
  await page.keyboard.press('e');
  await page.evaluate(() => window.simStep(180, 1 / 60));
  await page.waitForTimeout(1500);                                    // past the worklet hand-off
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);
  await page.keyboard.press('x');
  await expect.poll(() => level(page), AUDIO).toBeLessThan(0.001);    // once the analyser's window has emptied
  expect((await page.evaluate(() => window.simGetState())).engineState).toBe('running');
  await page.keyboard.press('x');
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);
});

test('X reaches everything: any Web Audio voice, and clips playing or started later', async ({ page }) => {
  await tapDestination(page);
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await page.keyboard.press('x');
  await page.evaluate(async () => {
    const { audioContext, audioOutput, audioElement } = await import('/core/audio.js');
    const ctx = audioContext(); await ctx.resume();
    const o = ctx.createOscillator(); o.connect(audioOutput()); o.start();   // a voice that isn't the engine
    window.__clip = audioElement('assets/gpws/pull_up.mp3');
  });
  await expect.poll(() => level(page), AUDIO).toBeLessThan(0.001);
  expect(await page.evaluate(() => window.__clip.muted)).toBe(true);
  await page.keyboard.press('x');
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);
});

test("a mission's transmission stops when the mission is left", async ({ page }) => {
  // Demo-2's 250 s webcast plays through playRadio. Since the AudioContext stays open across
  // missions (a53f750), nothing stopped it: it ran on into the next mission (2026-11-07).
  await tapDestination(page);
  await page.goto('/?mission=crew-demo2&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await page.keyboard.press('Shift');                                  // a gesture: the context runs
  await page.evaluate(() => window.simStep(1, 1));                     // t=0 → the webcast entry fires
  await expect.poll(() => level(page), { timeout: 60_000 }).toBeGreaterThan(0.01);   // fetch + decode of 250 s: >10 s under full-suite load, more on a busy machine
  await page.evaluate(() => window.simLoad('lszf-pattern'));          // cold and dark: nothing should sound
  await page.waitForFunction(() => window.simGetState().mission?.id === 'lszf-pattern');
  await expect.poll(() => level(page), AUDIO).toBeLessThan(0.001);    // after the radio chain's squelch tail
});

test('pause holds every sound with the clock, and unpausing plays it on from where it stood', async ({ page }) => {
  // A recording on the clock ran on through P and the key map, and was ahead afterwards (2026-11-07).
  // A suspended context's analyser keeps its last frame, so the hold is read from the context's clock.
  await tapDestination(page);
  await page.goto('/?mission=lszf-pattern&test=1');
  await page.waitForFunction(() => window.simReady === true);
  await page.evaluate(() => window.simSetState({ masterBat: true }));
  await page.keyboard.press('e');
  await page.evaluate(() => window.simStep(180, 1 / 60));
  await page.evaluate(async () => {
    const { audioElement } = await import('/core/audio.js');
    window.__clip = audioElement('assets/apollo8/day1.mp3');
    await window.__clip.play();
  });
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);

  await page.evaluate(() => window.simSetState({ paused: true }));
  await expect.poll(() => page.evaluate(() => window.__ctxs[0].state), AUDIO).toBe('suspended');   // the next frame applies it
  const held = await page.evaluate(() => ({ ctx: window.__ctxs[0].currentTime, clip: window.__clip.currentTime }));
  await page.waitForTimeout(700);                                     // a while on the wall clock: nothing may move in it
  const after = await page.evaluate(() => ({ state: window.__ctxs[0].state, ctx: window.__ctxs[0].currentTime, clip: window.__clip.currentTime, paused: window.__clip.paused }));
  expect(after.state).toBe('suspended');
  expect(after.ctx).toBe(held.ctx);                                   // Web Audio stands
  expect(after.paused).toBe(true);
  expect(after.clip).toBe(held.clip);                                 // the clip stands

  await page.keyboard.press('Shift');                                 // a key during a pause doesn't wake the sound
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__ctxs[0].state)).toBe('suspended');

  await page.evaluate(() => window.simSetState({ paused: false }));
  const playing = () => page.evaluate(() => ({ state: window.__ctxs[0].state, paused: window.__clip.paused, clip: window.__clip.currentTime }));
  await expect.poll(async () => { const p = await playing(); return p.state === 'running' && !p.paused && p.clip > held.clip; }, AUDIO).toBe(true);   // on from where it stood
  expect((await playing()).clip).toBeLessThan(held.clip + 1.5);      // not from where it would have been
  await expect.poll(() => level(page), AUDIO).toBeGreaterThan(0.01);
});
