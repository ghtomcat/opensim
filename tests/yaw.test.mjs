/**
 * The yaw axis (core/yaw.js): sideslip and the nose's yaw from the moments about the CG.
 *
 * The signs (a dead engine yaws the nose toward it, right rudder yaws it right, the fin turns the
 * nose into the air), the balance (symmetric thrust and no rudder give exactly nothing — the
 * seeded flights stay as they were), and V_MC emerging from the 777's measured geometry: full
 * rudder against one engine holds above it and not below.
 *
 * Run:  node --test tests/yaw.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { yawModel, yawForces, yawStep, vmcQ, windmillDrag, rudderTravel } from '../core/yaw.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (id) => JSON.parse(readFileSync(join(root, 'aircraft', `${id}.json`), 'utf8'));
const b777 = load('b777-300er');
const M = yawModel(b777);
const MASS = b777.performance.mass;
const T1 = b777.performance.thrustMax / 2;                     // one engine, sea level
const qOf = (kt) => 0.5 * 1.225 * (kt * 0.5144) ** 2;

/* fly s for t seconds at a fixed speed and inputs */
function fly(kt, { thrust, dead = [], rudder = 0 }, t = 60, dt = 1 / 60) {
  let s = { beta: 0, yawDev: 0 }, hdg = 0;
  const q = qOf(kt), tas = kt * 0.5144;
  for (let i = 0; i < t / dt; i++) {
    const n = yawStep(M, { ...s, q, tas, thrust, dead, rudder }, dt, MASS);
    s = { beta: n.beta, yawDev: n.yawDev };
    hdg += n.yawDev * dt;
  }
  return { ...s, hdg: hdg * 180 / Math.PI, betaDeg: s.beta * 180 / Math.PI };
}

test('no model without a measured tail — the other aircraft stay as they were', () => {
  for (const id of ['a350', 'a340', 'c172', 'b737max9']) assert.equal(yawModel(load(id)), null, id);
  assert.equal(windmillDrag(null, 5000, [true]), 0);
});

test('symmetric thrust, no rudder: exactly nothing', () => {
  const f = yawForces(M, { beta: 0, yawDev: 0, q: qOf(250), tas: 250 * 0.5144, thrust: [T1, T1], dead: [false, false] });
  assert.ok(f.N === 0 && f.Y === 0, `N ${f.N}, Y ${f.Y}`);       // === : -0 counts as nothing too
  const r = fly(250, { thrust: [T1, T1] });
  assert.ok(r.hdg === 0 && r.beta === 0, `heading ${r.hdg}, β ${r.beta}`);
});

test('ENG 1 dead: the nose yaws left, toward the dead engine, and the air comes from the right', () => {
  const r = fly(160, { thrust: [0, T1], dead: [true, false] }, 10);
  assert.ok(r.hdg < -2, `heading ${r.hdg}°`);
  assert.ok(r.betaDeg > 0, `β ${r.betaDeg}°`);
  const r2 = fly(160, { thrust: [T1, 0], dead: [false, true] }, 10);   // ENG 2: the mirror image
  assert.ok(Math.abs(r2.hdg + r.hdg) < 1e-9 && Math.abs(r2.betaDeg + r.betaDeg) < 1e-9);
});

test('right rudder yaws the nose right; the fin turns it back into the air', () => {
  assert.ok(fly(200, { thrust: [T1, T1], rudder: 0.3 }, 5).hdg > 0);
  const f = yawForces(M, { beta: 0.05, yawDev: 0, q: qOf(200), tas: 200 * 0.5144, thrust: [T1, T1] });
  assert.ok(f.N > 0, 'air from the right → nose right (weathercock)');
});

test('without rudder the engine-out sideslip settles — the fin holds it, it does not diverge', () => {
  const a = fly(200, { thrust: [0, T1], dead: [true, false] }, 60);
  const b = fly(200, { thrust: [0, T1], dead: [true, false] }, 120);
  assert.ok(Math.abs(a.betaDeg - b.betaDeg) < 0.1, `β ${a.betaDeg}° → ${b.betaDeg}°`);
  assert.ok(b.betaDeg > 1 && b.betaDeg < 15, `steady β ${b.betaDeg}°`);
});

test('V_MC emerges from the geometry: ~130 kt for the 777 at the sim\'s thrust', () => {
  const v = Math.sqrt(2 * vmcQ(M, T1) / 1.225) / 0.5144;
  assert.ok(v > 115 && v < 145, `V_MC ${v} kt`);
});

test('full rudder holds ENG 1 out above V_MC, not below (β = 0, the definition)', () => {
  const vmc = Math.sqrt(2 * vmcQ(M, T1) / 1.225) / 0.5144;
  const N = (kt) => yawForces(M, { beta: 0, yawDev: 0, q: qOf(kt), tas: kt * 0.5144,
                                   thrust: [0, T1], dead: [true, false], rudder: 1 }).N;
  assert.ok(N(vmc + 5) > 0, `above V_MC the rudder wins: ${N(vmc + 5)} N·m`);
  assert.ok(N(vmc - 5) < 0, `below V_MC the engine wins: ${N(vmc - 5)} N·m`);
  assert.ok(Math.abs(N(vmc)) < 1e-6 * T1 * 9.69, `at V_MC they balance: ${N(vmc)} N·m`);
});

test('the rudder limiter: full travel below 160 kt, then the moment held', () => {
  assert.equal(rudderTravel(M, qOf(120)), M.rudderMax);
  const n = (kt) => yawForces(M, { beta: 0, yawDev: 0, q: qOf(kt), tas: kt * 0.5144, rudder: 1 }).N;
  assert.ok(Math.abs(n(250) / n(160) - 1) < 1e-9, 'the same full-rudder moment at 160 and 250 kt');
  assert.ok(rudderTravel(M, qOf(320)) * 180 / Math.PI < 7.5, 'a few degrees at 320 kt');
});

test('a dead engine windmills: drag only when an engine is dead', () => {
  assert.equal(windmillDrag(M, qOf(160), [false, false]), 0);
  const d = windmillDrag(M, qOf(160), [true, false]);
  assert.ok(d > 3000 && d < 15000, `windmilling drag ${d} N at 160 kt`);   // ~1–4 % of one engine's thrust
});
