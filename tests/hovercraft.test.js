// OpenSim — hovercraft.test.js
// Hovercraft physics tests — lift, pressure, hover, autonomy, node failures.

import { test, expect } from '@playwright/test';

async function loadSim(page, missionId) {
  await page.goto(`/?mission=${missionId}&test=1`);
  await page.waitForFunction(() => window.simReady === true, { timeout: 15_000 });
}

const get  = (page)        => page.evaluate(() => window.simGetState());
const set  = (page, patch) => page.evaluate(p  => window.simSetState(p), patch);
const step = (page, secs)  => page.evaluate(n  => window.simStep(n), Math.round(secs * 60));

// ── Aircraft loads correctly ──────────────────────────────────────────────────

test('Markus mission loads hovercraft_markus', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  const s = await get(page);
  expect(s.aircraft.id).toBe('hovercraft_markus');
  expect(s.aircraft.type).toBe('hovercraft');
  expect(s.hcActive).toBe('markus');
  expect(s.crashed).toBe(false);
});

// ── Lift throttle builds pressure ────────────────────────────────────────────

test('lift throttle builds plenum pressure', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 0.5 });
  await step(page, 0.5);
  const s = await get(page);
  expect(s.hcMPressure).toBeGreaterThan(0);
});

// ── Full throttle achieves hover ──────────────────────────────────────────────

test('full lift throttle achieves hover', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 0.8 });
  await step(page, 0.5);
  const s = await get(page);
  expect(s.hcMHovering).toBe(true);
  expect(s.hcMPressure).toBeGreaterThanOrEqual(
    s.aircraft.envelope.min_hover_pressure_pa - 2
  );
});

// ── Zero lift stays grounded ──────────────────────────────────────────────────

test('zero lift throttle — craft stays grounded', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 0, hcMAutonomy: 'MANUAL' });
  await step(page, 0.5);
  const s = await get(page);
  expect(s.hcMHovering).toBe(false);
  expect(s.hcMPressure).toBeCloseTo(0, 0);
});

// ── ESC clamp ─────────────────────────────────────────────────────────────────

test('ESC clamp prevents lift above max_lift_throttle', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 1.0 });
  await step(page, 0.2);
  const s = await get(page);
  expect(s.hcMLiftAct).toBeLessThanOrEqual(
    s.aircraft.envelope.max_lift_throttle + 0.001
  );
});

// ── Thrust only effective when hovering ──────────────────────────────────────

test('thrust produces speed when hovering', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 0.8, hcMThrustT: 0.5 });
  await step(page, 2);
  const s = await get(page);
  expect(s.hcMSpeed).toBeGreaterThan(0);
});

test('thrust produces no speed without hover', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 0, hcMThrustT: 0.8, hcMAutonomy: 'MANUAL' });
  await step(page, 1);
  const s = await get(page);
  expect(s.hcMSpeed).toBeCloseTo(0, 1);
});

// ── HOVER autonomy ────────────────────────────────────────────────────────────

test('HOVER autonomy commands max lift without slider', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMAutonomy: 'HOVER', hcMLiftT: 0 });
  await step(page, 0.5);
  const s = await get(page);
  expect(s.hcMLiftAct).toBeCloseTo(s.aircraft.envelope.max_lift_throttle, 2);
  expect(s.hcMHovering).toBe(true);
});

// ── TRACK autonomy steers ─────────────────────────────────────────────────────

test('TRACK autonomy applies yaw rate toward target heading', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMLiftT: 0.8, hcMAutonomy: 'TRACK', hcMTargetHdg: 90, hcMHeading: 0 });
  await step(page, 1);
  const s = await get(page);
  expect(Math.abs(s.hcMYawRate)).toBeGreaterThan(0);
});

// ── Node failure modes ────────────────────────────────────────────────────────

test('one node failure → DEGRADED mode', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMNodes: [1, 0, 1] });
  await step(page, 0.1);
  const s = await get(page);
  expect(s.hcMMode).toBe('DEGRADED');
});

test('two node failures → DIRECT mode', async ({ page }) => {
  await loadSim(page, 'hovercraft-markus');
  await set(page, { hcMNodes: [0, 0, 1] });
  await step(page, 0.1);
  const s = await get(page);
  expect(s.hcMMode).toBe('DIRECT');
});
