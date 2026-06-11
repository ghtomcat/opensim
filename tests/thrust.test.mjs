/**
 * Thrust detents — pure tests for core/thrust.js activeDetent (no browser).
 * The A/THR clamps N1 to the detent the lever sits in; this locks the lever→detent→ceiling
 * mapping the autothrust and the FMA both depend on.
 *
 * Run:  node --test tests/thrust.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { activeDetent } from '../core/thrust.js';

const here = dirname(fileURLToPath(import.meta.url));

/* Airbus-style aircraft (a220 detent fractions: Vmo 335). */
const AC = {
  engine: { type: 'turbofan', idleN1: 22 },
  thrustProfiles: [
    { label: 'IDLE', spdT: 0 },
    { label: 'CLB',  spdT: 165 },
    { label: 'MCT',  spdT: 288 },
    { label: 'TOGA', spdT: 335 },
  ],
};
const frac = (label) => AC.thrustProfiles.find(p => p.label === label).spdT / 335;

test('each detent → matching label + flat-rated N1 ceiling', () => {
  assert.equal(activeDetent(AC, 0).label, 'IDLE');
  assert.equal(activeDetent(AC, 0).n1Limit, 22);             // IDLE = engine.idleN1
  assert.equal(activeDetent(AC, frac('CLB')).label, 'CLB');
  assert.equal(activeDetent(AC, frac('CLB')).n1Limit, 84);   // default CLB ceiling
  assert.equal(activeDetent(AC, frac('MCT')).label, 'MCT');
  assert.equal(activeDetent(AC, frac('MCT')).n1Limit, 93);
  assert.equal(activeDetent(AC, 1.0).label, 'TOGA');
  assert.equal(activeDetent(AC, 1.0).n1Limit, 100);
});

test('nearest-match snaps to the closest detent across the boundary', () => {
  const mid = (frac('CLB') + frac('MCT')) / 2;
  assert.equal(activeDetent(AC, mid - 0.02).label, 'CLB');
  assert.equal(activeDetent(AC, mid + 0.02).label, 'MCT');
});

test('explicit profile.n1 overrides the default ceiling', () => {
  const ac = { engine: { type: 'turbofan', idleN1: 20 },
               thrustProfiles: [{ label: 'IDLE', spdT: 0 }, { label: 'CLB', spdT: 165, n1: 88 }, { label: 'TOGA', spdT: 335 }] };
  assert.equal(activeDetent(ac, 165 / 335).n1Limit, 88);
});

test('no thrustProfiles → null', () => {
  assert.equal(activeDetent({ engine: { type: 'turbofan' } }, 0.5), null);
  assert.equal(activeDetent({}, 0.5), null);
});

test('real a220.json profiles resolve to IDLE…TOGA', () => {
  const a220 = JSON.parse(readFileSync(join(here, '..', 'aircraft', 'a220.json'), 'utf8'));
  assert.equal(activeDetent(a220, 0).label, 'IDLE');
  assert.equal(activeDetent(a220, 1).label, 'TOGA');
  assert.equal(activeDetent(a220, 1).n1Limit, 100);
});
