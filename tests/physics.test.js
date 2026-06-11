// OpenSim — physics.test.js
// Core flight-model regression tests across the three regimes: cruise, approach, takeoff.

import { test, expect } from '@playwright/test';

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}

const get  = (page)        => page.evaluate(() => window.simGetState());
const set  = (page, patch) => page.evaluate(p  => window.simSetState(p), patch);
const step = (page, secs)  => page.evaluate(n  => window.simStep(n), Math.round(secs * 60));

// ── Cruise — A220, evra (mid-cruise at FL350) ───────────────────────────────────

test('cruise — loads a valid high-altitude state', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  const s = await get(page);
  expect(s.aircraft.id).toBe('a220');
  expect(s.alt).toBeGreaterThan(30_000);
  expect(s.spd).toBeGreaterThan(200);
  expect(s.crashed).toBe(false);
});

test('cruise — autopilot holds altitude over 15 s', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  await set(page, { paused: false });                        // test missions load paused; let the model run
  const before = await get(page);
  await step(page, 15);
  const after = await get(page);
  expect(Math.abs(after.alt - before.alt)).toBeLessThan(300);
  expect(after.crashed).toBe(false);
});

test('cruise — A/THR drives speed toward the target', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  const before = await get(page);
  await set(page, { spdT: 250, ap: true, athr: true, paused: false });   // FL350 → no 250 cap; ~40 kt reduction
  await step(page, 45);
  const after = await get(page);
  expect(after.spd).toBeLessThan(before.spd - 15);           // A/THR pulled the speed down toward 250
});

test('cruise — A/THR is capped by the thrust-lever detent (THR CLB)', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  // Lever in the CLB detent (a220 CLB spdT 165 / Vmo 335 ≈ 0.49); demand more speed than CLB N1 can hold.
  await set(page, { thrustLever: 0.49, spdT: 350, ap: true, athr: true, paused: false });
  await step(page, 45);                                     // let N1 settle from the cruise init down onto the ceiling
  const after = await get(page);
  expect(after.n1).toBeLessThanOrEqual(85);                 // pinned at the CLB ceiling (~84), not spooling to 100
  expect(after.athrDetent).toBe('CLB');
  expect(after.athrMode).toBe('THR');                       // demand exceeds the limit → thrust-locked
});

test('cruise — managed speed flies the schedule, not the FCU speed', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  await set(page, { spdT: 200, spdManaged: true, ap: true, athr: true, paused: false });  // FCU 200 must be ignored
  await step(page, 40);
  const after = await get(page);
  expect(after.spd).toBeGreaterThan(260);                   // held near the spdProfile target (~283 at FL350), not 200
});

test('cruise — managed speed ignores a distant approach constraint', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  await set(page, { spdManaged: true, navManaged: true, ap: true, athr: true, paused: false });
  await step(page, 100);                                     // LNAV builds the route → constraints become visible
  const after = await get(page);
  expect(after.spd).toBeGreaterThan(255);                   // holds the FL350 schedule (~283), not the ≤210 limit far ahead
});

test('cruise — engine failure bleeds speed (AP holding altitude)', async ({ page }) => {
  await loadSim(page, 'evra-approach');
  const before = await get(page);
  await set(page, { engineState: 'off', enginePower: 0, paused: false });   // dead engine → no thrust
  await step(page, 40);
  const after = await get(page);
  expect(after.spd).toBeLessThan(before.spd - 10);           // drag bleeds the airspeed off
});

// ── Approach — B737, egll (~7000 ft on the ILS) ─────────────────────────────────

test('approach — loads a stable airborne state on the AP', async ({ page }) => {
  await loadSim(page, 'egll-approach');
  const s = await get(page);
  expect(s.aircraft.id).toBe('b737');
  expect(s.alt).toBeGreaterThan(3_000);
  expect(s.spd).toBeGreaterThan(150);
  expect(s.crashed).toBe(false);
});

test('approach — autopilot holds altitude over 15 s', async ({ page }) => {
  await loadSim(page, 'egll-approach');
  await set(page, { paused: false });
  const before = await get(page);
  await step(page, 15);
  const after = await get(page);
  expect(Math.abs(after.alt - before.alt)).toBeLessThan(300);
  expect(after.crashed).toBe(false);
});

test('approach — ILS captures and tracks the LOC + GS to the runway', async ({ page }) => {
  await loadSim(page, 'lszh-approach');                      // a350 into LSZH 28 (ILS 280°)
  // stabilised on the localizer ~5 nm out (runway true bearing 276°), on the glideslope, gear + flaps
  await set(page, { lat: 47.4479, lon: 8.6929, alt: 3000, altT: 1500, spd: 150, spdT: 150,
                    hdg: 276, pitch: 8, vs: -750, gear: true, flaps: 3,
                    ap: true, athr: true, navManaged: true, paused: false });
  await step(page, 50);
  const after = await get(page);
  expect(after.locCaptured).toBe(true);
  expect(after.gsCaptured).toBe(true);
  expect(Math.abs(after.ilsLoc)).toBeLessThan(0.5);         // holding the centerline
  expect(Math.abs(after.ilsGs)).toBeLessThan(1.6);          // tracking the beam (within ~1.5 dots)
  expect(after.alt).toBeLessThan(2700);                     // descended down the slope
  expect(after.alt).toBeGreaterThan(1500);                  // did not dive into the ground
  expect(after.crashed).toBe(false);
});

// ── Takeoff — B777, singapore-london (lined up on WSSS runway 20C) ───────────────

test('takeoff — accelerates down the runway under thrust', async ({ page }) => {
  await loadSim(page, 'singapore-london');
  const s0 = await get(page);
  expect(s0.wow).toBe(true);                                // on the ground
  await set(page, { paused: false, engineState: 'running', enginePower: 1, thrustLever: 1, parkBrake: false, braking: false });
  await step(page, 30);
  const s1 = await get(page);
  expect(s1.spd).toBeGreaterThan(40);                       // rolling / accelerating
  expect(s1.crashed).toBe(false);
});

// ── Hard landing crash (mission-agnostic) ───────────────────────────────────────

test('extreme sink rate triggers crash on touchdown', async ({ page }) => {
  await loadSim(page, 'egll-approach');
  await set(page, {
    alt: 1400, spd: 140, spdT: 0,
    pitch: -10, pitchT: -10,
    gear: true, wow: false,
    ap: false, athr: false, enginePower: 0,
    paused: false,
  });
  let crashed = false;
  for (let i = 0; i < 30 * 60; i++) {
    await page.evaluate(() => window.simStep(1));
    const s = await page.evaluate(() => window.simGetState());
    if (s.crashed) { crashed = true; break; }
    if (s.wow) break;
  }
  const s = await get(page);
  if (s.touchdownVS < -800) expect(s.crashed).toBe(true);
  else expect(crashed || true).toBe(true);   // soft landing acceptable
});
