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
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
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
  test('active frequency is LSZK AFIS 120.350', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    const active = await getActiveFreq(page);
    expect(active.trim()).toBe('120.350');
  });

  test('standby frequency is LSZH Info 124.700', async ({ page }) => {
    await loadMission(page, 'lszf-pattern');
    const standby = await getStandbyFreq(page);
    expect(standby.trim()).toBe('124.700');
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
    expect(freqs).toEqual(['120.350', '121.500', '124.700'].sort());
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
    const activeBefore  = (await getActiveFreq(page)).trim();
    const standbyBefore = (await getStandbyFreq(page)).trim();

    /* T key triggers transfer via window keydown listener */
    await page.keyboard.press('t');

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
    expect(freqLszf).toBe('120.350');
  });
});
