/**
 * FMA mappers — pure tests for core/fma.js (no browser).
 * Verifies the phase model and the thrust column: detent-limited A/THR shows THR <detent>,
 * modulating shows SPEED/MACH, A/THR off shows MAN, and managed lateral/vertical flip
 * green↔cyan. Locks the words and columns the PFD annunciator renders.
 *
 * Run:  node --test tests/fma.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAirbusFMA, computeBoeingFMA } from '../core/fma.js';

const val = (cell) => cell.val;
const col = (cell) => cell.col;

/* ── Airbus — 5 columns: [thrust, vertical, lateral, approach, AP/FD] ── */

test('parked → all columns blank', () => {
  const f = computeAirbusFMA({ wow: true, n1: 20 });
  assert.deepEqual(f.map(val), ['', '', '', '', '']);
});

test('takeoff → MAN TO/GA · SRS · RWY, A/THR armed', () => {
  const f = computeAirbusFMA({ wow: true, n1: 95, athr: true });
  assert.equal(val(f[0]), 'MAN TO/GA');
  assert.equal(val(f[1]), 'SRS');
  assert.equal(val(f[2]), 'RWY');
  assert.equal(val(f[4]), 'A/THR');
});

const CLIMB = { alt: 10000, altT: 35000, fieldElev: 0, vs: 2000, gear: false, ap: true, athr: true };

test('climb, A/THR pinned at the detent → THR <detent> (green)', () => {
  const f = computeAirbusFMA({ ...CLIMB, athrMode: 'THR', athrDetent: 'CLB' });
  assert.equal(val(f[0]), 'THR CLB');
  assert.equal(col(f[0]), 'green');
});

test('climb, A/THR modulating → SPEED / MACH (green)', () => {
  assert.equal(val(computeAirbusFMA({ ...CLIMB, athrMode: 'SPEED' })[0]), 'SPEED');
  assert.equal(val(computeAirbusFMA({ ...CLIMB, athrMode: 'MACH' })[0]), 'MACH');
});

test('A/THR off → MAN thrust from the lever detent (white)', () => {
  assert.equal(val(computeAirbusFMA({ ...CLIMB, athr: false, athrDetent: 'CLB' })[0]), 'MAN THR');
  assert.equal(val(computeAirbusFMA({ ...CLIMB, athr: false, athrDetent: 'TOGA' })[0]), 'MAN TO/GA');
  assert.equal(col(computeAirbusFMA({ ...CLIMB, athr: false })[0]), 'white');
});

test('lateral: managed NAV (green) vs selected HDG (cyan)', () => {
  assert.deepEqual([val, col].map(fn => fn(computeAirbusFMA({ ...CLIMB, navManaged: true })[2])),  ['NAV', 'green']);
  assert.deepEqual([val, col].map(fn => fn(computeAirbusFMA({ ...CLIMB, navManaged: false })[2])), ['HDG', 'cyan']);
});

test('vertical: managed (green) vs selected ALT (cyan)', () => {
  assert.equal(col(computeAirbusFMA({ ...CLIMB, altManaged: true })[1]),  'green');
  assert.deepEqual([val, col].map(fn => fn(computeAirbusFMA({ ...CLIMB, altManaged: false })[1])), ['ALT', 'cyan']);
});

test('cruise → ALT CRZ, MACH thrust, AP1 in the last column', () => {
  const f = computeAirbusFMA({ alt: 35000, altT: 35000, vs: 0, gear: false, ap: true, athr: true,
                               athrMode: 'MACH', altManaged: true });
  assert.equal(val(f[1]), 'ALT CRZ');
  assert.equal(val(f[0]), 'MACH');
  assert.equal(val(f[4]), 'AP1');
});

/* ── Boeing — 3 fields: [A/T, roll, pitch] ── */

test('Boeing climb → THR REF / LNAV / VNAV SPD; N1 above 90 → N1', () => {
  const f = computeBoeingFMA({ alt: 10000, altT: 35000, vs: 2000, n1: 85, navManaged: true, altManaged: true });
  assert.deepEqual(f.map(val), ['THR REF', 'LNAV', 'VNAV SPD']);
  assert.equal(val(computeBoeingFMA({ alt: 10000, altT: 35000, vs: 2000, n1: 95 })[0]), 'N1');
});
