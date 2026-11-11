/**
 * The flaps command (core/flaps.js): the stages are the aircraft's own (`flaps` in its data), for every caller —
 * key, joystick, the pedestal's lever, the crew's call.
 *
 * Run:  node --test tests/flaps.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState } from '../core/state.js';
import { command, commandNames } from '../core/commands.js';
import { maxFlapStage } from '../core/flaps.js';

const ac = (n) => ({ id: `test-${n}`, flaps: Array.from({ length: n }, (_, i) => ({ deg: i * 10 })) });
const at = (aircraft, flaps) => setState({ aircraft, flaps, prevFlaps: flaps });

test('the flaps command is registered', () => assert.ok(commandNames().includes('flaps')));

test('extend and retract step one stage; prevFlaps follows', () => {
  at(ac(4), 0);
  assert.equal(command('flaps', 'extend'), true);  assert.equal(S.flaps, 1); assert.equal(S.prevFlaps, 0);
  assert.equal(command('flaps', 'extend'), true);  assert.equal(S.flaps, 2);
  assert.equal(command('flaps', 'retract'), true); assert.equal(S.flaps, 1); assert.equal(S.prevFlaps, 2);
});

test('the stages stop at the aircraft\'s own — a two-setting aircraft (Tu-95, Velis) goes to 1, not 3', () => {
  at(ac(2), 0);
  assert.equal(command('flaps', 'extend'), true);  assert.equal(S.flaps, 1);
  assert.equal(command('flaps', 'extend'), false); assert.equal(S.flaps, 1);
  assert.equal(command('flaps', 3), false);        assert.equal(S.flaps, 1);
  assert.equal(command('flaps', 'retract'), true); assert.equal(command('flaps', 'retract'), false); assert.equal(S.flaps, 0);
});

test('an aircraft with one setting only (the Avro: no flaps) refuses every command', () => {
  at(ac(1), 0);
  assert.equal(maxFlapStage(), 0);
  assert.equal(command('flaps', 'extend'), false);
  assert.equal(S.flaps, 0);
});

test('a detent straight away (the lever, the crew\'s call); the same stage again is refused', () => {
  at(ac(4), 0);
  assert.equal(command('flaps', 3, { source: 'click' }), true); assert.equal(S.flaps, 3);
  assert.equal(command('flaps', 3, { source: 'crew' }), false);
  assert.equal(command('flaps', 'full'), false); assert.equal(S.flaps, 3);
});

test('an aircraft that lists no flaps keeps the old limit (3)', () => {
  at({ id: 'test-none' }, 0);
  assert.equal(maxFlapStage(), 3);
});
