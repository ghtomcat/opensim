/**
 * The takeoff callouts (core/crew.js, takeoffCalloutsCrossed): spoken when the indicated airspeed passes their
 * speed; one at or below Vr — "rotate" — only with the wheels on the ground. An aircraft that lifted off below
 * Vr heard "rotate" in the air (the An-225, 2026-11-09, Markus).
 *
 * Run:  node --test tests/takeoff-callouts.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeoffCalloutsCrossed } from '../core/crew.js';

const AN225 = [{ spd: 175, speech: 'rotate', voice: 'pm' }, { spd: 195, speech: 'positive climb', voice: 'pm' }];
const said = (...a) => takeoffCalloutsCrossed(AN225, ...a).filter(c => c.speak).map(c => c.speech);

test('"rotate" when the airspeed passes Vr on the takeoff roll', () => {
  assert.deepEqual(said(174.6, 175.1, true, 175), ['rotate']);
});

test('lifted off below Vr: passing it in the air says nothing — but counts as fired', () => {
  const crossed = takeoffCalloutsCrossed(AN225, 174.6, 175.1, false, 175);
  assert.deepEqual(crossed.map(c => [c.speech, c.speak]), [['rotate', false]]);
});

test('a callout above Vr still comes in the air ("positive climb", "best rate")', () => {
  assert.deepEqual(said(194.8, 195.2, false, 175), ['positive climb']);
});

test('once fired, not again; not on the way down', () => {
  assert.deepEqual(said(174.6, 175.1, true, 175, new Set([175])), []);
  assert.deepEqual(said(176, 174, true, 175), []);
});

test('an aircraft without Vr in its data keeps the speed alone', () => {
  assert.deepEqual(said(174.6, 175.1, false, undefined), ['rotate']);
});
