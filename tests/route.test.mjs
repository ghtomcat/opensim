/**
 * Route constraints — pure tests for core/route.js speed-constraint parsing (no browser).
 * spd is the ARINC 424 speed-limit field: "-220" = at/below, "+250" = at/above, "@210"/"210" = at.
 *
 * Run:  node --test tests/route.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spdParse, spdLabel } from '../core/route.js';

test('spdParse — descriptor + knots', () => {
  assert.deepEqual(spdParse('-220'), { kt: 220, kind: 'below' });
  assert.deepEqual(spdParse('+250'), { kt: 250, kind: 'above' });
  assert.deepEqual(spdParse('@210'), { kt: 210, kind: 'at' });
  assert.deepEqual(spdParse('180'),  { kt: 180, kind: 'at' });
});

test('spdParse — empty / invalid → null', () => {
  assert.equal(spdParse(''), null);
  assert.equal(spdParse(null), null);
  assert.equal(spdParse(undefined), null);
  assert.equal(spdParse('-'), null);
});

test('spdLabel — ≤ / ≥ / bare', () => {
  assert.equal(spdLabel('-220'), '≤220');
  assert.equal(spdLabel('+250'), '≥250');
  assert.equal(spdLabel('210'),  '210');
  assert.equal(spdLabel(''),     '');
  assert.equal(spdLabel({ kt: 230, kind: 'below' }), '≤230');   // accepts a parsed object too
});
