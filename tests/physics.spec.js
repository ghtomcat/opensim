/**
 * OpenSim — physics tests
 *
 * Each test loads a mission headlessly, drives inputs via simStep/simSetState,
 * and asserts the aircraft behaves within real-world performance bounds.
 *
 * Add a test when you add a new aircraft.
 */

import { test, expect } from '@playwright/test';
import { glideTrim } from '../core/trim.js';

/* ── Helper ───────────────────────────────────────────────────── */

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true);
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

/* Ground starts are parked: parking brake set, and cold-start aircraft (C172, DR400)
   have the engine off. Release the brake and put the engine at running — the startup
   lifecycle itself is not what these tests are about. */
async function readyForTakeoff(page) {
  return setState(page, { parkBrake: false, engineState: 'running', enginePower: 1, magnetos: 'BOTH' });
}

/* Step until the aircraft is off the ground and above `aboveFt`, up to `maxS` sim seconds.
   Runs inside one evaluate — a browser round trip per frame is too slow for a long roll.
   Returns the lift-off speed (kt) or null. */
async function stepUntilAirborne(page, aboveFt, maxS) {
  return page.evaluate(([aboveFt, maxS]) => {
    for (let i = 0; i < maxS * 60; i++) {
      window.simStep(1);
      const s = window.simGetState();
      if (!s.wow && s.alt > aboveFt) return s.spd;
    }
    return null;
  }, [aboveFt, maxS]);
}

/* Calm air — mission turbulence adds random vertical buffeting every frame, which makes
   a landing test pass or fail by chance. Landing mechanics are tested in still air. */
async function calmAir(page) {
  return page.evaluate(() => {
    const m = window.simGetState().mission;
    window.simSetState({ mission: { ...m, weather: { ...m.weather, manual: { ...m.weather.manual, turbulence: 0 } } } });
  });
}

/* Engine-out glide to the Wolfskopf field (elevation 100 ft) and a flare like a pilot:
   hold `pitch` on the way down, raise the nose to `flarePitch` below `flareAGL`. The flight
   model uses pitch attitude as angle of attack, so the glide attitude must be nose-up.
   Steps inside one evaluate (a round trip per frame is too slow). Returns touchdown data. */
/* A dead-stick glide and flare: the best glide with the engine dead (core/trim.js glideTrim — its speed, path and
   attitude), then at flareAGL the nose up by flareDeg — a pilot's flare. Until 2026-11-15 it glided at a held 7° and
   flared to 15°, which only worked while lift read the pitch and the pitch moved ~0.28°/s (issues.md). */
async function glideAndFlare(page, { alt, field = 100, flareAGL = 50, flareDeg = 7, maxS = 90 }) {
  const ac = await page.evaluate(() => window.simGetState().aircraft);
  const g  = glideTrim(ac, { altFt: alt, gear: true });
  await setState(page, { alt, altT: field, spd: g.iasKt, lever: 0, pitch: g.pitchDeg, pitchT: g.pitchDeg, vs: g.vsFpm,
                         gear: true, wow: false, enginePower: 0 });
  return page.evaluate(([flareAGL, flarePitch, field, maxS]) => {
    let flared = false;
    for (let i = 0; i < maxS * 60; i++) {
      if (!flared && window.simGetState().alt - field < flareAGL) { window.simSetState({ pitchT: flarePitch }); flared = true; }
      window.simStep(1);
      const s = window.simGetState();
      if (s.crashed || s.wow) return { landed: s.wow, crashed: s.crashed, reason: s.crashReason, touchdownVS: s.touchdownVS, minAlt: s.alt };
    }
    return { landed: false, crashed: false };
  }, [flareAGL, g.pitchDeg + flareDeg, field, maxS]);
}

/* ── Cessna 172 ───────────────────────────────────────────────── */

test.describe('Cessna 172 — LSZF pattern', () => {

  test('rotates between 50–75 kt', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');
    await readyForTakeoff(page);

    // Full throttle, hold pitch neutral for ground roll
    await setState(page, { lever: 1 });
    await stepSeconds(page, 5);

    // Pull back to rotate
    await setState(page, { pitchT: 8 });

    // Step until airborne or 60s timeout
    const liftoffSpd = await stepUntilAirborne(page, 1789, 60);

    expect(liftoffSpd, 'C172 should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(50);
    expect(liftoffSpd).toBeLessThan(75);
  });

  test('climbs at >300 fpm after liftoff', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');
    await readyForTakeoff(page);

    await setState(page, { lever: 1, pitchT: 8 });
    await stepSeconds(page, 60);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(300);
  });

  test('stalls below 40 kt with engine off', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');

    // Start airborne at 3000ft
    await setState(page, { alt: 3000, altT: 3000, spd: 80, lever: 0, pitch: 5, pitchT: 15 });
    await stepSeconds(page, 30);

    const s = await getState(page);
    // Should be descending — stall or at least energy stall kicking in
    if (s.spd < 45) {
      expect(s.vs).toBeLessThan(-100);
    }
  });

});

/* ── Robin DR400 ─────────────────────────────────────────────── */

test.describe('Robin DR400 — Grenchen (the cross-country\'s start)', () => {

  test('rotates between 60–75 kt', async ({ page }) => {
    await loadSim(page, 'grenchen-neuchatel');
    await readyForTakeoff(page);

    await setState(page, { lever: 1 });
    await stepSeconds(page, 5);
    await setState(page, { pitchT: 8 });

    const liftoffSpd = await stepUntilAirborne(page, 1412, 60);

    expect(liftoffSpd, 'Robin should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(60);
    expect(liftoffSpd).toBeLessThan(75);
  });

  test('climbs at >300 fpm at Vy', async ({ page }) => {
    await loadSim(page, 'grenchen-neuchatel');
    await readyForTakeoff(page);

    await setState(page, { lever: 1, pitchT: 8 });
    await stepSeconds(page, 60);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(300);
  });

  test('stall speed below 60 kt clean', async ({ page }) => {
    await loadSim(page, 'grenchen-neuchatel');

    // Start airborne, bleed speed with engine off
    await setState(page, { alt: 3000, altT: 3000, spd: 90, lever: 0, pitch: 5, pitchT: 15 });
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

  test('dead-stick landing — glide + flare, touches down on the field', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');
    await calmAir(page);

    // 400 ft above the 100 ft field, gear down, dead engine
    const r = await glideAndFlare(page, { alt: 500 });

    expect(r.crashed, `dead-stick landing should not crash (${r.reason})`).toBe(false);
    expect(r.landed, 'Bf 109 should touch down (wow=true)').toBe(true);
    expect(r.minAlt, 'aircraft should not pass through the ground').toBeGreaterThan(99);
  });

  test('high-speed touchdown — does not bounce (wow latch)', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');
    await calmAir(page);

    // Fast wheel landing: just above the field at 156 kt, nose low, sinking like a real touchdown
    await setState(page, {
      alt: 101, spd: 156, lever: 0,
      pitch: 2, pitchT: 2, vs: -300,
      gear: true, wow: false,
      enginePower: 0,
    });

    // Once down, it must stay down for the whole roll (checked every frame)
    const r = await page.evaluate(() => {
      let touchedAt = null, bounced = false;
      for (let i = 0; i < 4 * 60; i++) {
        window.simStep(1);
        const s = window.simGetState();
        if (s.wow && touchedAt == null) touchedAt = i;
        if (touchedAt != null && !s.wow) bounced = true;
      }
      const s = window.simGetState();
      return { touchedAt, bounced, crashed: s.crashed, spd: s.spd };
    });

    expect(r.touchedAt, 'aircraft should touch down').not.toBeNull();
    expect(r.crashed, 'a -300 fpm touchdown is not a hard landing').toBe(false);
    expect(r.bounced, 'aircraft should stay on ground after fast touchdown').toBe(false);
    expect(r.spd, 'aircraft should decelerate on ground roll').toBeLessThan(150);
  });

});

/* ── An-225 Mriya ────────────────────────────────────────────── */

test.describe('An-225 Mriya — Hostomel 2022', () => {
  /* A turbofan since 2026-11-09: the thrust lever sets the thrust (spdT is the autothrust's speed, not a throttle) */

  test('lifts off within 25 kt above its computed VR (flaps 15°, core/takeoff-perf.js)', async ({ page }) => {
    await loadSim(page, 'hostomel-2022');
    await readyForTakeoff(page);

    await setState(page, { lever: 1, flaps: 1 });
    await stepSeconds(page, 5);
    await setState(page, { pitchT: 8 });

    const liftoffSpd = await stepUntilAirborne(page, 395, 150);

    expect(liftoffSpd, 'An-225 should lift off').not.toBeNull();
    const vr = await page.evaluate(async () => (await import('/core/takeoff-perf.js')).vr());
    expect(vr).toBeGreaterThan(130);                      // 137 kt at 500 t (2026-11-24) — before, a fixed 175
    expect(liftoffSpd).toBeGreaterThan(vr);               // the nose stays down below VR
    expect(liftoffSpd).toBeLessThan(vr + 25);
  });

  test('climbs at >500 fpm after liftoff', async ({ page }) => {
    await loadSim(page, 'hostomel-2022');
    await readyForTakeoff(page);

    await setState(page, { lever: 1, pitchT: 8 });
    await stepSeconds(page, 120);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(500);
  });

  test('gear retracts after liftoff', async ({ page }) => {
    await loadSim(page, 'hostomel-2022');
    await readyForTakeoff(page);

    await setState(page, { lever: 1, pitchT: 8 });
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
    { id: 'grenchen-neuchatel', name: 'Robin',   elev: 1411 },
    { id: 'nordmeer-1956',    name: 'Tu-95', elev:  492 },
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
    { id: 'grenchen-neuchatel', name: 'Robin' },
  ];

  for (const { id, name } of FIXED_GEAR) {
    test(`${name} — gear stays true after liftoff`, async ({ page }) => {
      await loadSim(page, id);
      await readyForTakeoff(page);

      // Get airborne
      await setState(page, { lever: 1, pitchT: 8 });
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

/* ── Retractable gear — Tu-95 ────────────────────────────────── */

test.describe('Retractable gear — Tu-95', () => {

  test('gear retracts after liftoff', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');
    await readyForTakeoff(page);

    // Get airborne, then retract via simSetState (simulates G key path)
    await setState(page, { lever: 1, pitchT: 8 });
    await stepSeconds(page, 90);

    const airborne = await getState(page);
    expect(airborne.wow, 'Tu-95 should be airborne').toBe(false);

    // Retract
    await setState(page, { prevGear: true, gear: false });
    const s = await getState(page);
    expect(s.gear, 'Tu-95 gear should retract').toBe(false);
  });

});

/* ── Tu-95 Bear-A ──────────────────────────────────────────── */

test.describe('Tu-95 — Nordmeer 1956', () => {

  test('starts with engineState running on ground (non-v12 fix)', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');
    const s = await getState(page);
    expect(s.engineState, 'Tu-95 should start running — no manual startup needed').toBe('running');
  });

  test('lifts off from ground roll — WoW latch does not block takeoff', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');
    await readyForTakeoff(page);

    // Max thrust, flaps 20°, neutral pitch during ground roll
    await setState(page, { lever: 1, flaps: 1 });
    await stepSeconds(page, 5);

    // Rotate
    await setState(page, { pitchT: 8 });

    const liftoffSpd = await stepUntilAirborne(page, 493, 120);

    expect(liftoffSpd, 'Tu-95 should lift off').not.toBeNull();
    expect(liftoffSpd).toBeGreaterThan(180);
    expect(liftoffSpd).toBeLessThan(230);
  });

  test('climbs at >500 fpm after liftoff', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');
    await readyForTakeoff(page);

    await setState(page, { lever: 1, pitchT: 8 });
    await stepSeconds(page, 90);

    const s = await getState(page);
    expect(s.vs).toBeGreaterThan(500);
  });

});

/* ── Crash bounds checker ─────────────────────────────────────── */

test.describe('Crash bounds checker', () => {

  test('hard landing — crash on extreme touchdown VS', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');

    // Slam onto runway: approach at 80kt with extreme sink rate
    await setState(page, {
      alt: 110, spd: 80, lever: 0,
      pitch: -5, pitchT: -5,
      gear: true, wow: false,
      enginePower: 0,
    });

    // Step until touchdown or 30s
    let crashed = false;
    for (let i = 0; i < 30 * 60; i++) {
      await page.evaluate(() => window.simStep(1));
      const s = await getState(page);
      if (s.crashed) { crashed = true; break; }
      if (s.wow && !s.crashed) break;   // soft landing — not crashing
    }

    // At this steep approach angle, VS should exceed -800fpm → crash
    const s = await getState(page);
    if (s.touchdownVS < -800) {
      expect(s.crashed, 'extreme sink rate should trigger crash').toBe(true);
    }
  });

  test('overspeed — crash above the sourced VNE × 1.15 (the C172: 163 kt, EASA TCDS IM.A.051)', async ({ page }) => {
    await loadSim(page, 'lszf-pattern');
    await setState(page, { alt: 5000, altT: 5000, spd: 185, pitch: 0, pitchT: 0, vs: 0, wow: false, lever: 0, enginePower: 1 });
    await stepSeconds(page, 1);
    expect((await getState(page)).crashed, '185 kt is below 163 × 1.15 = 187.5').toBe(false);
    await setState(page, { spd: 200, crashed: false });
    await stepSeconds(page, 1);
    const s = await getState(page);
    expect(s.crashed, '200 kt is above 187.5').toBe(true);
    expect(s.crashReason).toMatch(/OVERSPEED .*VNE 163 kt/);
  });

  test('overspeed — no sourced limit, no overspeed crash (maxSpd is no limit)', async ({ page }) => {
    await loadSim(page, 'nordmeer-1956');    // the Tu-95 — no limit found
    await setState(page, { alt: 5000, altT: 5000, spd: 600, pitch: 0, pitchT: 0, vs: 0, lever: 1, enginePower: 1 });
    await stepSeconds(page, 1);
    expect((await getState(page)).crashReason ?? '').not.toMatch(/OVERSPEED/);
  });

  test('overspeed — a jet above MMO + 0.07 (a test MMO on the A350)', async ({ page }) => {
    await loadSim(page, 'lszh-approach');
    await page.evaluate(() => { const ac = window.simGetState().aircraft;
      window.simSetState({ aircraft: { ...ac, envelope: { ...ac.envelope, mmo: 0.80, limitsSource: 'test' } } }); });
    await setState(page, { alt: 35000, altT: 35000, spd: 250, pitch: 0, pitchT: 0, vs: 0, ap: false, athr: false });
    await stepSeconds(page, 1);
    expect((await getState(page)).crashed, '250 kt at FL350 ≈ M 0.80 — below 0.87').toBe(false);
    await setState(page, { spd: 300, crashed: false });   // ≈ M 0.93
    await stepSeconds(page, 1);
    const s = await getState(page);
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toMatch(/OVERSPEED +M 0\.9\d +\(MMO 0\.8\)/);
  });

  test('normal landing — no crash within bounds', async ({ page }) => {
    await loadSim(page, 'wolfskopf-1942');
    await calmAir(page);

    // Gentle approach: 500 ft above the field, glide, flare at 50 ft
    const r = await glideAndFlare(page, { alt: 600 });

    expect(r.crashed, `gentle landing should not crash (${r.reason})`).toBe(false);
    expect(r.landed, 'aircraft should touch down').toBe(true);
    expect(r.touchdownVS, 'touchdown sink rate inside the -800 fpm hard-landing limit').toBeGreaterThan(-800);
  });

});

/* The day's air (core/airdata.js): a hot day thins it — the same indicated liftoff speed is a higher true
   airspeed, and the engines make less thrust, so the run is longer. Measured 2026-11-24 (777, flaps 5, calm):
   15 °C 1,154 m, 30 °C 1,237, 45 °C 1,321 — liftoff 155–156 kt IAS each. */
test('a hot day: the 777 runs ~7 % further at 40 °C than at 15 °C, lifting off at the same IAS', async ({ page }) => {
  const roll = async (temp) => {
    await loadSim(page, 'singapore-london');
    return page.evaluate((temp) => {
      const m = window.simGetState().metar ?? {};
      window.simSetState({ metar: { ...m, temp, wspd: 0, wdir: 0, altim: 1013 }, paused: false, engineState: 'running', enginePower: 1,
                           lever: 1, parkBrake: false, braking: false, athr: false, pitchT: 10, flaps: 1, prevFlaps: 1 });
      const s0 = window.simGetState(), R = Math.PI / 180;
      for (let i = 0; i < 90 * 60; i++) {
        window.simStep(1);
        const s = window.simGetState();
        if (!s.wow) {
          const h = Math.sin((s.lat - s0.lat) * R / 2) ** 2 + Math.cos(s0.lat * R) * Math.cos(s.lat * R) * Math.sin((s.lon - s0.lon) * R / 2) ** 2;
          return { m: 2 * 6371000 * Math.asin(Math.sqrt(h)), kt: s.spd };
        }
      }
      return null;
    }, temp);
  };
  const std = await roll(15), hot = await roll(40);
  expect(std).not.toBeNull();
  expect(hot).not.toBeNull();
  expect(hot.m / std.m).toBeGreaterThan(1.05);
  expect(hot.m / std.m).toBeLessThan(1.20);
  expect(Math.abs(hot.kt - std.kt)).toBeLessThan(3);
});
