/**
 * VNAV Phase 2 — pure tests for the descent-path geometry (core/vnav.js buildDescentPath).
 * The 3° path is drawn backward from the runway through the altitude constraints.
 *
 * Run:  node --test tests/vnav.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDescentPath } from '../core/vnav.js';

/* Five fixes along the equator, ~30 nm apart; dest (last) at sea level.
   Constraints: ≥10000 at 60 nm to go, ≤6000 at 30 nm to go. */
const legs = [
  { lat: 0, lon: 0.0, alt: '' },
  { lat: 0, lon: 0.5, alt: '' },
  { lat: 0, lon: 1.0, alt: '+10000' },
  { lat: 0, lon: 1.5, alt: '-6000' },
  { lat: 0, lon: 2.0, alt: '' },
];

test('path descends monotonically toward the runway', () => {
  const p = buildDescentPath(legs, 35000, 0);
  assert.equal(p.predAlt[4], 0);                                   // dest at field elevation
  for (let i = 0; i < 4; i++) assert.ok(p.predAlt[i] > p.predAlt[i + 1], `leg ${i} should be higher than ${i + 1}`);
  // distToEnd ~30 nm per 0.5° at the equator
  assert.ok(Math.abs(p.distToEnd[0] - 120) < 2, `distToEnd[0]=${p.distToEnd[0]}`);
});

test('honours the ≥ floor and ≤ ceiling constraints', () => {
  const p = buildDescentPath(legs, 35000, 0);
  assert.ok(p.predAlt[2] >= 10000, `≥10000 floor: ${p.predAlt[2]}`);
  assert.ok(p.predAlt[3] <= 6000,  `≤6000 ceiling: ${p.predAlt[3]}`);
  assert.ok(Math.abs(p.predAlt[3] - 6000) < 1, 'sits on the 6000 ceiling');
});

test('TOD falls back to route start when cruise is never reached', () => {
  const p = buildDescentPath(legs, 35000, 0);          // 120 nm route can't climb to FL350 at 3°
  assert.ok(Math.abs(p.todDist - p.distToEnd[0]) < 1);
});

test('TOD is interpolated where the path meets a lower cruise', () => {
  const p = buildDescentPath(legs, 20000, 0);
  // path reaches 20000 at the 90 nm fix (predAlt there = cruise) → TOD ≈ that fix's distance
  assert.ok(Math.abs(p.todDist - p.distToEnd[1]) < 1, `todDist=${p.todDist} vs ${p.distToEnd[1]}`);
  assert.ok(p.todDist > 60, `todDist=${p.todDist}`);
  assert.ok(p.predAlt[0] <= 20000 && p.predAlt[1] <= 20000, 'capped at cruise');
});
