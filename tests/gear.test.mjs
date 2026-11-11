/**
 * The gear command (core/gear.js) through the command registry (core/commands.js): the rules live once —
 * fixed gear, squat lock — and every caller (key, joystick, lever, crew) gets them.
 *
 * Run:  node --test tests/gear.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState } from '../core/state.js';
import { command, commandNames } from '../core/commands.js';
import '../core/gear.js';

const retractable = { id: 'test-jet' }, fixed = { id: 'test-c172', fixedGear: true };
const at = (aircraft, gear, wow) => setState({ aircraft, gear, wow, prevGear: gear });

test('the gear command is registered', () => {
  assert.ok(commandNames().includes('gear'));
});

test('toggle: up in the air, down again; prevGear follows', () => {
  at(retractable, true, false);
  assert.equal(command('gear', 'toggle', { source: 'test' }), true);
  assert.equal(S.gear, false); assert.equal(S.prevGear, true);
  assert.equal(command('gear', 'toggle'), true);
  assert.equal(S.gear, true); assert.equal(S.prevGear, false);
});

test('squat lock: no gear-up with weight on the wheels — by any caller', () => {
  for (const source of ['key', 'joystick', 'click', 'crew']) {
    at(retractable, true, true);
    assert.equal(command('gear', 'toggle', { source }), false, source);
    assert.equal(command('gear', 'up', { source }), false, source);
    assert.equal(S.gear, true, source);
  }
});

test('a fixed gear refuses every command', () => {
  at(fixed, true, false);
  assert.equal(command('gear', 'up'), false);
  assert.equal(command('gear', 'toggle'), false);
  assert.equal(S.gear, true);
});

test('down / up to where the gear already is: refused, nothing changes', () => {
  at(retractable, true, false);
  assert.equal(command('gear', 'down'), false);
  at(retractable, false, false);
  assert.equal(command('gear', 'up'), false);
  assert.equal(S.gear, false);
});

test('down on the ground is allowed (gear-down is never locked)', () => {
  at(retractable, false, true);
  assert.equal(command('gear', 'down', { source: 'crew' }), true);
  assert.equal(S.gear, true);
});

test('an unknown position or command is refused', () => {
  at(retractable, true, false);
  assert.equal(command('gear', 'sideways'), false);
  assert.equal(command('no-such-command'), false);
  assert.equal(S.gear, true);
});
