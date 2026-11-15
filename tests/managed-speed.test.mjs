/**
 * Managed speed — pure tests for core/managed-speed.js (no browser).
 * Verifies the A/THR managed target interpolates the aircraft's envelope.spdProfile, and the crossover:
 * the lower of the profile's IAS and the IAS of the cruise Mach at the altitude.
 *
 * Run:  node --test tests/managed-speed.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S } from '../core/state.js';
import { managedSpeed, managedSpeedTarget } from '../core/managed-speed.js';
import { iasOfMach } from '../core/airdata.js';

const here = dirname(fileURLToPath(import.meta.url));
const a220 = JSON.parse(readFileSync(join(here, '..', 'aircraft', 'a220.json'), 'utf8'));
/* The profile alone — the a220 without its cruise Mach */
const { cruiseMach: _m, ...envNoMach } = a220.envelope;
const a220Profile = { ...a220, envelope: envNoMach };

test('the profile alone: hits the spdProfile keys exactly', () => {
  S.aircraft = a220Profile;
  S.alt = 39000; assert.equal(managedSpeed(), 288);
  S.alt = 10000; assert.equal(managedSpeed(), 250);
  S.alt = 3000;  assert.equal(managedSpeed(), 165);
  S.alt = 0;     assert.equal(managedSpeed(), 128);
});

test('the profile alone: interpolates between keys', () => {
  S.aircraft = a220Profile;
  S.alt = 20000;                       // between 10000 (250) and 39000 (288)
  const v = managedSpeed();
  assert.ok(v > 250 && v < 288, `expected 250<v<288, got ${v}`);
});

test('the profile alone: clamps below the lowest / above the highest key', () => {
  S.aircraft = a220Profile;
  S.alt = -500;  assert.equal(managedSpeed(), 128);
  S.alt = 50000; assert.equal(managedSpeed(), 288);
});

test('the crossover: below it the profile\'s IAS (SPEED), above it the cruise Mach\'s IAS (MACH)', () => {
  S.aircraft = a220;                   // cruiseMach 0.78
  S.alt = 10000; assert.deepEqual(managedSpeedTarget(), { kt: 250, mach: null });   // 250 at FL100 — the profile
  S.alt = 25000;
  let t = managedSpeedTarget();
  assert.equal(t.mach, null);          // M .78 is ~314 kt at FL250 — the profile's ~270 binds
  S.alt = 35000;
  t = managedSpeedTarget();
  assert.equal(t.mach, 0.78);
  assert.equal(t.kt, Math.round(iasOfMach(0.78, 35000)));   // ~250 kt
  S.alt = 39000;
  assert.equal(managedSpeed(), Math.round(iasOfMach(0.78, 39000)));   // ~230 kt, not the profile's 288
});

test('the crossover altitude is about FL300–FL320 for the A220 (the profile\'s ~276 kt meets M .78)', () => {
  S.aircraft = a220;
  S.alt = 30000; assert.equal(managedSpeedTarget().mach, null);
  S.alt = 32000; assert.equal(managedSpeedTarget().mach, 0.78);
});

test('null for non-turbofan or no profile', () => {
  S.aircraft = { engine: { type: 'lycoming-o360' }, envelope: { spdProfile: { 0: 100 } } };
  assert.equal(managedSpeed(), null);
  assert.equal(managedSpeedTarget(), null);
  S.aircraft = { engine: { type: 'turbofan' }, envelope: {} };
  assert.equal(managedSpeed(), null);
});
