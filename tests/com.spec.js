/**
 * COM panel — frequency initialization and interaction tests
 *
 * Covers:
 *  - Mission-specific frequencies loaded after mission load (not before)
 *  - LSZF pattern: 120.350 active, 124.700 standby, 121.500 guard present
 *  - Default fallback to LSZH frequencies when mission has no com field
 *  - Transfer button swaps active and standby
 *  - Preset list matches mission frequencies
 *  - Switching missions resets COM to new mission's frequencies
 */

import { test, expect } from '@playwright/test';

async function loadMission(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true);
}

async function getActiveFreq(page) {
  return page.locator('#com-active').textContent();
}

async function getStandbyFreq(page) {
  return page.locator('#com-standby').textContent();
}

async function getPresetFreqs(page) {
  return page.locator('.preset-freq').allTextContents();
}

/* ── LSZF mission-specific frequencies ── */

test.describe('LSZF pattern — mission COM', () => {
  test('active frequency is LSZH Approach 119.700', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    const active = await getActiveFreq(page);
    expect(active.trim()).toBe('119.700');
  });

  test('standby frequency is LSZK AFIS 120.350', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    const standby = await getStandbyFreq(page);
    expect(standby.trim()).toBe('120.350');
  });

  test('guard 121.500 is present in presets', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    const presets = await getPresetFreqs(page);
    expect(presets.map(f => f.trim())).toContain('121.500');
  });

  test('preset list matches mission freqs exactly', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    const presets = await getPresetFreqs(page);
    const freqs = presets.map(f => f.trim()).sort();
    expect(freqs).toEqual(['119.700', '120.350', '121.500', '124.700'].sort());
  });
});

/* ── Default fallback when mission has no com field ── */

test.describe('Default COM fallback', () => {
  test('loads LSZH ground 121.750 when mission has no com field', async ({ page }) => {
    await loadMission(page, 'lszh-approach');
    const active = await getActiveFreq(page);
    expect(active.trim()).toBe('121.750');
  });
});

/* ── Transfer button ── */

test.describe('COM transfer', () => {
  test('transfer swaps active and standby', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    await page.evaluate(() => window.simSetState({ masterBat: true, avionicsOn: true }));   // the C172 starts cold and dark
    const activeBefore  = (await getActiveFreq(page)).trim();
    const standbyBefore = (await getStandbyFreq(page)).trim();

    /* Z key triggers transfer via window keydown listener */
    await page.keyboard.press('z');

    const activeAfter  = (await getActiveFreq(page)).trim();
    const standbyAfter = (await getStandbyFreq(page)).trim();

    expect(activeAfter).toBe(standbyBefore);
    expect(standbyAfter).toBe(activeBefore);
  });
});

/* ── Mission switch resets COM ── */

test.describe('COM resets on mission switch', () => {
  test('switching from LSZH approach to LSZF pattern updates active freq', async ({ page }) => {
    await loadMission(page, 'lszh-approach');
    const freqLszh = (await getActiveFreq(page)).trim();

    await loadMission(page, 'lszf-pattern');
    const freqLszf = (await getActiveFreq(page)).trim();

    expect(freqLszh).not.toBe(freqLszf);
    expect(freqLszf).toBe('119.700');
  });
});

/* ── COM power: the Velis radio needs MASTER and AVIONICS — not BATT EN (POH 4-9) ── */

test.describe('COM power — Velis', () => {
  test('the radio is silent until MASTER and AVIONICS are on — BATT EN not needed', async ({ page }) => {
    // lszg-velis's first call waits for the COM to come on (com_active). The check compared the
    // panel against 'velis' — the Velis is 'velis-epsi' — so the radio was always on (2026-11-07).
    const fired = [];
    page.on('console', m => { const r = /\[crew\] ATC fire idx=(\d+)/.exec(m.text()); if (r) fired.push(+r[1]); });
    await loadMission(page, 'lszg-velis');
    const sw = (patch) => page.evaluate(async (p) => Object.assign((await import('/core/state.js')).S.switches, p), patch);
    const step = () => page.evaluate(() => window.simStep(120, 1 / 60));

    await step();
    expect(fired).not.toContain(0);                                     // cold and dark: no call
    await sw({ avionics: true });
    await step();
    expect(fired).not.toContain(0);                                     // AVIONICS without MASTER: no power
    await sw({ master: true });
    await step();
    await expect.poll(() => fired).toContain(0);                        // on the 14 V battery, BATT EN still off: the first call goes out
  });
});

/* ── COM power: the radio panel is dark without power, and its controls do nothing ── */

for (const [what, mission] of [['C172', 'lszf-pattern'], ['DR400', 'grenchen-circuit']]) {
  test(`${what}: the COM panel is dark and Z does nothing until BAT and AVIONICS are on`, async ({ page }) => {
    await loadMission(page, mission);
    const off = () => page.evaluate(() => document.getElementById('com-container').classList.contains('com-off'));
    const active = async () => (await getActiveFreq(page)).trim();
    await expect.poll(off).toBe(true);                                  // cold and dark
    const before = await active();
    await page.keyboard.press('z');
    expect(await active()).toBe(before);                                // no swap without power
    await page.evaluate(() => window.simSetState({ masterBat: true }));
    await page.keyboard.press('z');
    expect(await active()).toBe(before);                                // BAT alone: the avionics are off
    await page.evaluate(() => window.simSetState({ avionicsOn: true }));
    await expect.poll(off).toBe(false);
    await page.keyboard.press('z');
    expect(await active()).not.toBe(before);                            // powered: Z swaps
  });
}
