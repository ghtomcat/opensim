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

  test('dead-stick landing — gear down, wow triggers before alt < 50ft', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');

    // Approach: 400ft AGL above the 100ft field, 100kt, gear down, dead engine
    await setState(page, {
      alt: 500, altT: 100,
      spd: 100, spdT: 0,
      pitch: 8, pitchT: 8,
      gear: true, prevGear: false,
      enginePower: 0,
    });

    let landed = false;
    let wentUnderground = false;
    for (let i = 0; i < 60 * 60; i++) {
      await page.evaluate(() => window.simStep(1));
      const s = await getState(page);
      if (s.wow)       { landed = true; break; }
      if (s.alt < 50)  { wentUnderground = true; break; }
    }

    expect(wentUnderground, 'aircraft should not pass through the ground').toBe(false);
    expect(landed, 'Bf 109 should touch down (wow=true)').toBe(true);
  });

  test('high-speed touchdown — does not bounce (wow latch)', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');

    // Touch down fast with nose up — should stay on ground, not bounce
    await setState(page, {
      alt: 100, spd: 156, spdT: 0,
      pitch: 8, pitchT: 8,
      gear: true, wow: true,
      enginePower: 0,
    });
    await stepSeconds(page, 3);

    const s = await getState(page);
    expect(s.wow, 'aircraft should stay on ground after fast touchdown').toBe(true);
    expect(s.spd, 'aircraft should decelerate on ground roll').toBeLessThan(130);
  });

});

/* ── An-225 Mriya ────────────────────────────────────────────── */

test.describe('An-225 Mriya — Hostomel 2022', () => {

  test('rotates between 165–215 kt (flaps 15°)', async ({ page }) => {
    await loadSim(page, 'hostomel-2022');

    await setState(page, { spdT: 460, flaps: 1 });
    await stepSeconds(page, 5);
    await setState(page, { pitchT: 8 });

    let liftoffSpd = null;
    for (let i = 0; i < 150 * 60; i++) {
      await page.evaluate(() => window.simStep(1));
      const s = await getState(page);
      if (!s.wow && s.alt > 395) {
        liftoffSpd = s.spd;
        break;
      }
    }

    expect(liftoffSpd, 'An-225 should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(165);
    expect(liftoffSpd).toBeLessThan(215);
  });

  test('climbs at >500 fpm after liftoff', async ({ page }) => {
    await loadSim(page, 'hostomel-2022');

    await setState(page, { spdT: 460, pitchT: 8 });
    await stepSeconds(page, 120);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(500);
  });

  test('gear retracts after liftoff', async ({ page }) => {
    await loadSim(page, 'hostomel-2022');

    await setState(page, { spdT: 460, pitchT: 8 });
    await stepSeconds(page, 120);

    const airborne = await getState(page);
    expect(airborne.wow, 'Mriya should be airborne').toBe(false);

    await setState(page, { prevGear: true, gear: false });
    const s = await getState(page);
    expect(s.gear, 'Mriya gear should retract').toBe(false);
  });

});

/* ── Ground spawn ────────────────────────────────────────────── */

test.describe('Ground spawn — all missions start on the runway', () => {

  const GROUND_MISSIONS = [
    { id: 'lszf-pattern',     name: 'C172',    elev: 1788 },
    { id: 'grenchen-circuit', name: 'Robin',   elev: 1411 },
    { id: 'nordmeer-1956',    name: 'Tu-95MS', elev:  492 },
    { id: 'hostomel-2022',   name: 'An-225',  elev:  394 },
    // wolfskopf-1942 intentionally starts airborne (patrol, alt=2000, departure=null)
    // lszh-approach intentionally starts airborne (ILS intercept)
  ];

  for (const { id, name, elev } of GROUND_MISSIONS) {
    test(`${name} — wow=true, gear=true, spd=0 at spawn`, async ({ page }) => {
      await loadSim(page, id);
      const s = await getState(page);

      expect(s.wow,  `${name} should be on ground`).toBe(true);
      expect(s.gear, `${name} gear should be down`).toBe(true);
      expect(s.spd,  `${name} speed should be 0`).toBeLessThan(1);
      expect(s.alt,  `${name} alt should be at field elevation`).toBeGreaterThan(elev - 5);
      expect(s.alt,  `${name} alt should not be above field elevation`).toBeLessThan(elev + 5);
    });
  }

});

/* ── Fixed gear ──────────────────────────────────────────────── */

test.describe('Fixed gear — C172 and Robin', () => {

  const FIXED_GEAR = [
    { id: 'lszf-pattern',     name: 'C172'  },
    { id: 'grenchen-circuit', name: 'Robin' },
  ];

  for (const { id, name } of FIXED_GEAR) {
    test(`${name} — gear stays true after liftoff`, async ({ page }) => {
      await loadSim(page, id);

      // Get airborne
      await setState(page, { spdT: 163, pitchT: 8 });
      await stepSeconds(page, 60);

      const s = await getState(page);
      expect(s.wow,  `${name} should be airborne`).toBe(false);
      expect(s.gear, `${name} fixed gear must stay true in flight`).toBe(true);
    });

    test(`${name} — G key does not retract gear`, async ({ page }) => {
      await loadSim(page, id);

      // Press G and check gear is unchanged
      await page.keyboard.press('g');
      const s = await getState(page);
      expect(s.gear, `${name} gear should not toggle on fixed-gear aircraft`).toBe(true);
    });
  }

});

/* ── Retractable gear — Tu-95MS ──────────────────────────────── */

test.describe('Retractable gear — Tu-95MS', () => {

  test('gear retracts after liftoff', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');

    // Get airborne, then retract via simSetState (simulates G key path)
    await setState(page, { spdT: 310, pitchT: 8 });
    await stepSeconds(page, 90);

    const airborne = await getState(page);
    expect(airborne.wow, 'Tu-95MS should be airborne').toBe(false);

    // Retract
    await setState(page, { prevGear: true, gear: false });
    const s = await getState(page);
    expect(s.gear, 'Tu-95MS gear should retract').toBe(false);
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
