/**
 * The yaw axis (core/yaw.js): sideslip and the nose's yaw from the moments about the CG.
 *
 * The signs (a dead engine yaws the nose toward it, right rudder yaws it right, the fin turns the
 * nose into the air), the balance (symmetric thrust and no rudder give exactly nothing — the
 * seeded flights stay as they were), and V_MC emerging from the 777's measured geometry: full
 * rudder against one engine holds above it and not below.
 *
 * On the ground the nosewheel holds the nose up to its side-friction limit; beyond it the aircraft
 * pivots — with full rudder an engine failure is held from about 80 kt up, without rudder never.
 *
 * Run:  node --test tests/yaw.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { yawModel, yawForces, yawStep, vmcQ, windmillDrag, rudderTravel,
         groundYawStep, tyreLimit, pedalYawRate, ballDeflection, finAngle } from '../core/yaw.js';

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

/* ── On the ground ── */
const W = MASS * 9.81;
function roll(kt, { thrust, dead = [], rudder = 0 }, t = 5, dt = 1 / 60) {
  let r = 0, hdg = 0, skid = false;
  const v = kt * 0.5144, q = qOf(kt), L = q * b777.performance.wingArea * b777.performance.CL_0;
  for (let i = 0; i < t / dt; i++) {
    const g = groundYawStep(M, { yawDev: r, q, tas: v, thrust, dead, rudder, weightOnWheels: W - L,
                                 pedalRate: pedalYawRate(M, rudder, v, MASS, W - L) }, dt);
    r = g.yawDev; hdg += r * dt; skid ||= g.skidding;
  }
  return { hdg: hdg * 180 / Math.PI, skid };
}

test('on the ground, symmetric thrust and no rudder: exactly nothing', () => {
  const g = groundYawStep(M, { yawDev: 0, q: qOf(120), tas: 120 * 0.5144, thrust: [T1, T1], dead: [false, false], weightOnWheels: W }, 1 / 60);
  assert.ok(g.yawDev === 0 && !g.skidding, `yaw ${g.yawDev}`);
});

test('ENG 1 dead on the takeoff roll, no rudder: the nosewheel skids, the nose swings left', () => {
  for (const kt of [60, 120, 150]) {
    const r = roll(kt, { thrust: [0, T1], dead: [true, false] }, 3);
    assert.ok(r.skid && r.hdg < -2, `${kt} kt: ${r.hdg}° in 3 s`);
  }
});

test('with full rudder it is held from ~80 kt up, not below', () => {
  /* held = the swing to the left is stopped (full right pedal may turn it right — the pilot eases off) */
  const held = (kt) => roll(kt, { thrust: [0, T1], dead: [true, false], rudder: 1 }, 3).hdg > -1;
  assert.ok(held(100) && held(150), 'held at 100 and 150 kt');
  assert.ok(!held(60), 'not at 60 kt');
});

test('the pedals steer the nosewheel: right pedal, nose right, more with speed', () => {
  assert.ok(pedalYawRate(M, 1, 10) > 0 && pedalYawRate(M, -1, 10) < 0);
  const v = 150 * 0.5144;
  assert.ok(pedalYawRate(M, 1, v, MASS, W * 0.8) < pedalYawRate(M, 1, v) / 3, 'at 150 kt the tyres, not the geometry, limit the turn');
  assert.equal(pedalYawRate(M, 0.5, 0), 0);                       // no pivot at a standstill
  assert.ok(tyreLimit(M, W) > tyreLimit(M, W / 2), 'less nosewheel grip as the wing lifts');
});

test('the slip indicator: ENG 1 out without rudder puts the ball right — step on it, right rudder', () => {
  const s = fly(250, { thrust: [0, T1], dead: [true, false] }, 10);
  const ay = yawStep(M, { ...s, q: qOf(250), tas: 250 * 0.5144, thrust: [0, T1], dead: [true, false] }, 1 / 60, MASS).latAccel;
  assert.ok(ballDeflection(ay) > 0.3, `ball ${ballDeflection(ay)} (a_y ${ay} m/s²)`);
  assert.equal(ballDeflection(0), 0);
  assert.equal(ballDeflection(-100), 1);                             // pinned at full deflection
});

test('the fin stalls: linear up to 25°, then the side force falls away', () => {
  const d = Math.PI / 180;
  assert.equal(finAngle(20 * d), 20 * d);
  assert.equal(finAngle(-25 * d), -25 * d);
  assert.ok(Math.abs(finAngle(40 * d) - 15 * d) < 1e-12, '40 % lost 10° past the stall');
  assert.ok(finAngle(30 * d) < 25 * d && finAngle(30 * d) > 15 * d);
});

test('V_MCA: with full rudder ENG 1 out is held at 125 kt — below ~112 kt the fin stalls and the yaw diverges', () => {
  const held = fly(125, { thrust: [0, T1], dead: [true, false], rudder: 1 }, 60);
  assert.ok(held.betaDeg > 0 && held.betaDeg < 10, `125 kt: β ${held.betaDeg}°`);
  const gone = fly(105, { thrust: [0, T1], dead: [true, false], rudder: 1 }, 60);
  assert.ok(gone.betaDeg > 40 && gone.hdg < -90, `105 kt: β ${gone.betaDeg}°, heading ${gone.hdg}°`);
});
