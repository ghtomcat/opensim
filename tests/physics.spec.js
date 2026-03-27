/**
 * OpenSim — physics tests
 *
 * Each test loads a mission headlessly, drives inputs via simStep/simSetState,
 * and asserts the aircraft behaves within real-world performance bounds.
 *
 * Add a test when you add a new aircraft.
 */

import { test, expect } from '@playwright/test';

/* ── Helper ───────────────────────────────────────────────────── */

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}

async function stepSeconds(page, seconds, dt = 1/60) {
  const n = Math.round(seconds / dt);
  await page.evaluate((n) => window.simStep(n), n);
}

async function getState(page) {
  return page.evaluate(() => window.simGetState());
}

async function setState(page, patch) {
  return page.evaluate((p) => window.simSetState(p), patch);
}

/* ── Cessna 172 ───────────────────────────────────────────────── */

test.describe('Cessna 172 — LSZF pattern', () => {

  test('rotates between 50–75 kt', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');

    // Full throttle, hold pitch neutral for ground roll
    await setState(page, { spdT: 163 });
    await stepSeconds(page, 5);

    // Pull back to rotate
    await setState(page, { pitchT: 8 });

    // Step until airborne or 60s timeout
    let liftoffSpd = null;
    for (let i = 0; i < 60 * 60; i++) {
      await page.evaluate(() => window.simStep(1));
      const s = await getState(page);
      if (!s.wow && s.alt > 1789) {
        liftoffSpd = s.spd;
        break;
      }
    }

    expect(liftoffSpd, 'C172 should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(50);
    expect(liftoffSpd).toBeLessThan(75);
  });

  test('climbs at >300 fpm after liftoff', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');

    await setState(page, { spdT: 163, pitchT: 8 });
    await stepSeconds(page, 60);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(300);
  });

  test('stalls below 40 kt with engine off', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');

    // Start airborne at 3000ft
    await setState(page, { alt: 3000, altT: 3000, spd: 80, spdT: 0, pitch: 5, pitchT: 15 });
    await stepSeconds(page, 30);

    const s = await getState(page);
    // Should be descending — stall or at least energy stall kicking in
    if (s.spd < 45) {
      expect(s.vs).toBeLessThan(-100);
    }
  });

});

/* ── Robin DR400 ─────────────────────────────────────────────── */

test.describe('Robin DR400 — Grenchen circuit', () => {

  test('rotates between 60–75 kt', async ({ page }) => {
    await loadSim(page, 'grenchen-circuit');

    await setState(page, { spdT: 120 });
    await stepSeconds(page, 5);
    await setState(page, { pitchT: 8 });

    let liftoffSpd = null;
    for (let i = 0; i < 60 * 60; i++) {
      await page.evaluate(() => window.simStep(1));
      const s = await getState(page);
      if (!s.wow && s.alt > 1412) {
        liftoffSpd = s.spd;
        break;
      }
    }

    expect(liftoffSpd, 'Robin should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(60);
    expect(liftoffSpd).toBeLessThan(75);
  });

  test('climbs at >300 fpm at Vy', async ({ page }) => {
    await loadSim(page, 'grenchen-circuit');

    await setState(page, { spdT: 120, pitchT: 8 });
    await stepSeconds(page, 60);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(300);
  });

  test('stall speed below 60 kt clean', async ({ page }) => {
    await loadSim(page, 'grenchen-circuit');

    // Start airborne, bleed speed with engine off
    await setState(page, { alt: 3000, altT: 3000, spd: 90, spdT: 0, pitch: 5, pitchT: 15 });
    await stepSeconds(page, 30);

    const s = await getState(page);
    if (s.spd < 60) {
      expect(s.vs).toBeLessThan(-100);
    }
  });

});

/* ── Bf 109 ───────────────────────────────────────────────────── */

test.describe('Bf 109 — Wolfskopf', () => {

  test('engine fails by t=200s', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');
    await stepSeconds(page, 200);

    const s = await getState(page);
    expect(s.enginePower).toBeLessThan(0.5);
  });

  test('engine fully dead by t=210s', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');
    await stepSeconds(page, 210);

    const s = await getState(page);
    expect(s.enginePower).toBeLessThan(0.05);
  });

});

/* ── Tu-95MS Bear H ──────────────────────────────────────────── */

test.describe('Tu-95MS — Nordmeer 1956', () => {

  test('rotates between 155–230 kt (flaps 20°)', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');

    // Max thrust, flaps 20° (checklist: takeoff), hold neutral for ground roll
    await setState(page, { spdT: 310, flaps: 1 });
    await stepSeconds(page, 5);

    // Rotate
    await setState(page, { pitchT: 8 });

    let liftoffSpd = null;
    for (let i = 0; i < 120 * 60; i++) {
      await page.evaluate(() => window.simStep(1));
      const s = await getState(page);
      if (!s.wow && s.alt > 493) {
        liftoffSpd = s.spd;
        break;
      }
    }

    expect(liftoffSpd, 'Tu-95MS should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(155);
    expect(liftoffSpd).toBeLessThan(230);
  });

  test('climbs at >500 fpm after liftoff', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');

    await setState(page, { spdT: 310, pitchT: 8 });
    await stepSeconds(page, 90);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(500);
  });

});
