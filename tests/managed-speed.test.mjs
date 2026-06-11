/**
 * Managed speed — pure tests for core/managed-speed.js (no browser).
 * Verifies the A/THR managed target interpolates the aircraft's envelope.spdProfile.
 *
 * Run:  node --test tests/managed-speed.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S } from '../core/state.js';
import { managedSpeed } from '../core/managed-speed.js';

const here = dirname(fileURLToPath(import.meta.url));
const a220 = JSON.parse(readFileSync(join(here, '..', 'aircraft', 'a220.json'), 'utf8'));

test('hits the spdProfile keys exactly', () => {
  S.aircraft = a220;
  S.alt = 39000; assert.equal(managedSpeed(), 288);
  S.alt = 10000; assert.equal(managedSpeed(), 250);
  S.alt = 3000;  assert.equal(managedSpeed(), 165);
  S.alt = 0;     assert.equal(managedSpeed(), 128);
});

test('interpolates between keys', () => {
  S.aircraft = a220;
  S.alt = 20000;                       // between 10000 (250) and 39000 (288)
  const v = managedSpeed();
  assert.ok(v > 250 && v < 288, `expected 250<v<288, got ${v}`);
});

test('clamps below the lowest / above the highest key', () => {
  S.aircraft = a220;
  S.alt = -500;  assert.equal(managedSpeed(), 128);
  S.alt = 50000; assert.equal(managedSpeed(), 288);
});

test('null for non-turbofan or no profile', () => {
  S.aircraft = { engine: { type: 'lycoming-o360' }, envelope: { spdProfile: { 0: 100 } } };
  assert.equal(managedSpeed(), null);
  S.aircraft = { engine: { type: 'turbofan' }, envelope: {} };
  assert.equal(managedSpeed(), null);
});
