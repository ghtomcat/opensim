/**
 * Shared vocabulary (core/vocab.js) — the guards that keep data names and code names in step.
 * The dispatch tables in core/radio.js, core/sound.js and core/failures.js check themselves on import;
 * core/crew.js (triggers, rocket events) can't load in Node and is checked on every Playwright page load.
 *
 * Run:  node --test tests/vocab.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { names, assertCovers, PANEL, COMM_PROFILE } from '../core/vocab.js';

test('a known name reads its value', () => {
  assert.equal(PANEL.VELIS, 'velis-epsi');
  assert.equal(COMM_PROFILE.VHF_AVIATION, 'vhf-aviation');
});

test('a misspelled name throws instead of reading undefined', () => {
  assert.throws(() => PANEL.VELLIS, /unknown name "VELLIS"/);
});

test('a names() set is frozen', () => {
  assert.throws(() => { 'use strict'; PANEL.NEW = 'x'; });
});

test('assertCovers catches a name missing from the code table, and one missing from the vocabulary', () => {
  const SET = names({ A: 'a', B: 'b' });
  assert.doesNotThrow(() => assertCovers({ a: 1, b: 1 }, SET, 'test'));
  assert.throws(() => assertCovers({ a: 1 }, SET, 'test'), /missing: \[b\]/);
  assert.throws(() => assertCovers({ a: 1, b: 1, c: 1 }, SET, 'test'), /not in core\/vocab\.js: \[c\]/);
  assert.doesNotThrow(() => assertCovers({ a: 1 }, SET, 'test', { except: ['b'] }));
});

test('radio, sound and failure tables cover the vocabulary (checked on import)', async () => {
  await import('../core/radio.js');
  await import('../core/sound.js');
  await import('../core/failures.js');
});
