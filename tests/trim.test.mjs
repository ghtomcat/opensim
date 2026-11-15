/**
 * The trim (core/trim.js): the angle of attack and the thrust that hold a speed in level flight — checked against
 * the force balance computed here independently, against what the sim settles at, and its limits.
 *
 * Run:  node --test tests/trim.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { levelTrim, trimAoADeg } from '../core/trim.js';
import { densityRatio, tasKt } from '../core/airdata.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));

/* The forces at the trim, computed as core/physics.js does (level flight, no ground effect, no spoilers) */
function forces(ac, { iasKt, altFt, flaps = 0, gear = false }, t) {
  const p = ac.performance, sigma = densityRatio(altFt), v = tasKt(iasKt, altFt) * 0.5144, q = 0.5 * 1.225 * sigma * v * v;
  const fs = (ac.flaps ?? [])[flaps] ?? {}, a = t.aoaDeg * Math.PI / 180;
  const CL = p.CL_0 + (fs.dCL_0 ?? 0) + p.CL_alpha * a;
  const CD = p.CD_0 + (fs.dCD_0 ?? 0) + (gear && !ac.fixedGear ? (p.gearDrag ?? 0) : 0) + (p.coolFlapDrag ?? 0) + p.inducedK * CL * CL;
  const share = ac.engine?.type === 'turbofan' ? Math.pow(t.n1 / 100, 1.8) : t.lever;
  return { L: q * p.wingArea * CL, W: p.mass * 9.81, D: q * p.wingArea * CD, T: share * p.thrustMax * sigma * Math.cos(a) };
}

test('lift = weight and thrust = drag at the trim — jets and propellers, clean and configured', () => {
  const cases = [
    ['a220', { iasKt: 250, altFt: 35000 }],
    ['a350', { iasKt: 180, altFt: 3980, flaps: 1 }],
    ['a350', { iasKt: 140, altFt: 2000, flaps: 3, gear: true }],
    ['b737max9', { iasKt: 180, altFt: 4018 }],
    ['bf109', { iasKt: 180, altFt: 2000 }],
    ['avro504', { iasKt: 60, altFt: 3000, gear: true }],
  ];
  for (const [id, c] of cases) {
    const ac = load(id), f = forces(ac, c, levelTrim(ac, c));
    assert.ok(Math.abs(f.L / f.W - 1) < 1e-6, `${id} ${c.iasKt} kt: L/W ${f.L / f.W}`);
    assert.ok(Math.abs(f.T / f.D - 1) < 1e-6, `${id} ${c.iasKt} kt: T/D ${f.T / f.D}`);
  }
});

test('the A220 at FL350, 250 kt: 4.0° and N1 73 % — where the sim\'s AP and A/THR settle (measured 3.9–4.0°, 70–75 %)', () => {
  const t = levelTrim(load('a220'), { iasKt: 250, altFt: 35000 });
  assert.ok(Math.abs(t.aoaDeg - 4.0) < 0.1, `${t.aoaDeg}`);
  assert.ok(Math.abs(t.n1 - 73) < 1, `${t.n1}`);
  assert.equal(t.pitchDeg, t.aoaDeg);   // lift reads the pitch (issues.md: Angle of attack = pitch attitude)
});

test('slower or less configured needs more angle of attack; the gear adds thrust, not angle', () => {
  const a = load('a350');
  const fl1 = levelTrim(a, { iasKt: 150, altFt: 3980, flaps: 1 }), fl3 = levelTrim(a, { iasKt: 150, altFt: 3980, flaps: 3 });
  assert.ok(fl1.aoaDeg > fl3.aoaDeg + 5, `${fl1.aoaDeg} vs ${fl3.aoaDeg}`);
  const up = levelTrim(a, { iasKt: 180, altFt: 3980, flaps: 1 }), down = levelTrim(a, { iasKt: 180, altFt: 3980, flaps: 1, gear: true });
  assert.equal(up.aoaDeg, down.aoaDeg);
  assert.ok(down.n1 > up.n1);
});

test('a turbofan\'s lever is its manual-thrust position for the N1; a propeller\'s lever is the thrust share', () => {
  const a = load('a350'), t = levelTrim(a, { iasKt: 180, altFt: 3980, flaps: 1 }), idle = a.engine.idleN1 ?? 22;
  assert.ok(Math.abs(idle + (100 - idle) * t.lever - t.n1) < 1e-9);
  const bf = levelTrim(load('bf109'), { iasKt: 180, altFt: 2000 });
  assert.equal(bf.n1, null);
  assert.ok(bf.lever > 0 && bf.lever < 1);
});

test('the limits: the angle 0 … 14° (the AP\'s clamp), the thrust share 0 … 1', () => {
  const a = load('a350');
  assert.equal(trimAoADeg(a, 1e9), 0);              // very fast — no negative angle
  assert.equal(trimAoADeg(a, 100), 14);             // far too slow — clamped
  assert.ok(levelTrim(load('avro504'), { iasKt: 300, altFt: 0, gear: true }).lever <= 1);
});
