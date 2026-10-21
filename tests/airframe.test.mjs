/**
 * Airframe geometry for the physics (core/airframe.js), from the aircraft's `dimensions`.
 *
 * The 777-300ER is measured (DWG × 500.7, cross-checked against Boeing's ACAP D6-58329-2 Rev G):
 * its engines, its vertical tail and rudder, and the nominal CG from the ACAP's gear loads.
 * Aircraft without those measurements get null, so the physics can tell "not measured" from zero.
 *
 * Run:  node --test tests/airframe.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nominalCg, engineY, vstab, DEFAULT_NOSE_GEAR_SHARE } from '../core/airframe.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (id) => JSON.parse(readFileSync(join(root, 'aircraft', `${id}.json`), 'utf8'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} ± ${tol}`);

const b777 = load('b777-300er');

test('777: the nominal CG sits 7.57 % of the wheelbase ahead of the main gear (ACAP §7.3)', () => {
  near(nominalCg(b777), 36.699 - 0.0757 * (36.699 - 5.900), 1e-9, 'CG');
  near(nominalCg(b777), 34.37, 0.01, 'CG');
});

test('777: the engines 9.69 m either side, ENG 1 on the left — ACAP 9.61 m within 1 %', () => {
  assert.deepEqual(engineY(b777), [-9.69, 9.69]);
  near(engineY(b777)[1], 9.61, 0.01 * 9.61, 'engine vs ACAP');
});

test('777: the vertical tail — 54 m², 37.8° sweep, its aerodynamic centre ~31.5 m behind the CG', () => {
  const v = vstab(b777);
  near(v.area, 54.03, 0.01, 'area');
  near(v.area, 53.2, 0.02 * 53.2, 'area vs the published ≈ 53.2 m²');
  near(v.taper, 0.313, 0.001, 'taper');
  near(v.sweepLE * 180 / Math.PI, 37.8, 0.05, 'LE sweep');
  near(v.mac, 5.715, 0.001, 'MAC');
  near(v.macHeight, 4.259, 0.001, 'MAC height');
  near(v.xQuarterMac, 65.89, 0.01, 'quarter-MAC station');
  near(v.arm, 31.52, 0.01, 'arm');
});

test('777: the rudder — a third of the chord at both ends, a third of the tail', () => {
  const r = vstab(b777).rudder;
  near(r.chordRatio.root, 0.334, 0.001, 'root chord ratio');
  near(r.chordRatio.top, 0.334, 0.001, 'top chord ratio');
  near(r.areaRatio, 0.330, 0.001, 'area ratio');
  near(r.spanRatio, 10.038 / 10.318, 1e-9, 'span ratio');
});

test('not measured → null; no balance block → the default nose-gear share', () => {
  const a350 = load('a350');
  assert.equal(engineY(a350), null);
  assert.equal(vstab(a350), null);
  const d = a350.dimensions;
  near(nominalCg(a350), (d.noseTipToMainGear - DEFAULT_NOSE_GEAR_SHARE * (d.noseTipToMainGear - d.noseTipToNoseGear)) / 1000, 1e-9, 'A350 CG');
  assert.equal(nominalCg({}), null);
  assert.equal(engineY(load('a340')), null);                    // four engines: not measured yet
});
