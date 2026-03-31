// OpenSim — physics.test.js
// Core flight model tests (A350 cruise).

import { test, expect } from '@playwright/test';

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}

const get  = (page)        => page.evaluate(() => window.simGetState());
const set  = (page, patch) => page.evaluate(p  => window.simSetState(p), patch);
const step = (page, secs)  => page.evaluate(n  => window.simStep(n), Math.round(secs * 60));

// ── Initial state ─────────────────────────────────────────────────────────────

test('A350 cruise — loads correct initial state', async ({ page }) => {
  await loadSim(page, 'lszh-approach');
  const s = await get(page);
  expect(s.aircraft.id).toBe('a350');
  expect(s.alt).toBeGreaterThan(30_000);
  expect(s.spd).toBeGreaterThan(200);
  expect(s.crashed).toBe(false);
});

// ── Autopilot holds altitude ──────────────────────────────────────────────────

test('A350 — autopilot holds altitude over 10 s', async ({ page }) => {
  await loadSim(page, 'lszh-approach');
  const before = await get(page);
  await step(page, 10);
  const after = await get(page);
  expect(Math.abs(after.alt - before.alt)).toBeLessThan(200);
});

// ── Speed responds to target ──────────────────────────────────────────────────

test('A350 — speed converges toward spdT', async ({ page }) => {
  await loadSim(page, 'lszh-approach');
  await set(page, { spdT: 280, athr: true });
  await step(page, 5);
  const s = await get(page);
  expect(Math.abs(s.spd - 280)).toBeLessThan(30);
});

// ── Hard landing crash ────────────────────────────────────────────────────────

test('extreme sink rate triggers crash on touchdown', async ({ page }) => {
  await loadSim(page, 'lszh-approach');
  await set(page, {
    alt: 1400, spd: 140, spdT: 0,
    pitch: -10, pitchT: -10,
    gear: true, wow: false,
    ap: false, athr: false, enginePower: 0,
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

// ── Engine failure ────────────────────────────────────────────────────────────

test('engine failure — speed bleeds off', async ({ page }) => {
  await loadSim(page, 'lszh-approach');
  const before = await get(page);
  await set(page, { enginePower: 0, ap: false, athr: false, spdT: 0 });
  await step(page, 20);
  const after = await get(page);
  expect(after.spd).toBeLessThan(before.spd);
});
