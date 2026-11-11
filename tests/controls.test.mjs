/**
 * The control definitions (display/controls.js): one definition per control, `operate(id)` is what a click does —
 * a toggle flips, a guarded one lifts its guard first, a rotary sweeps, a lever goes to the other position.
 *
 * Run:  node --test tests/controls.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S, setState } from '../core/state.js';
import { commandNames } from '../core/commands.js';
import { CONTROLS, operate, controlState, guardOpen } from '../display/controls.js';
import { runMissionResets } from '../core/lifecycle.js';
import '../core/gear.js';
import '../core/failures.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../aircraft/${id}.json`, import.meta.url), 'utf8'));

test('every control sends a registered command', () => {
  for (const [id, c] of Object.entries(CONTROLS)) assert.ok(commandNames().includes(c.command), `${id} → ${c.command}`);
});

test('a toggle flips through its command', () => {
  runMissionResets();
  setState({ aircraft: load('c172'), masterBat: false, fuelShutoff: false, fuelLeft: 95 });
  assert.equal(operate('bat'), true);          assert.equal(S.masterBat, true);  assert.equal(controlState('bat'), true);
  assert.equal(operate('fuelShutoff'), true);  assert.equal(S.fuelShutoff, true);
});

test('a guarded toggle: the first click lifts the guard, the second throws it; off closes the guard', () => {
  runMissionResets();
  setState({ aircraft: load('robin-dr400'), masterBat: false });
  operate('bat', { guarded: true });
  assert.equal(S.masterBat, false); assert.equal(guardOpen('bat'), true);
  operate('bat', { guarded: true });
  assert.equal(S.masterBat, true);  assert.equal(guardOpen('bat'), false);
  operate('bat', { guarded: true });
  assert.equal(S.masterBat, false); assert.equal(guardOpen('bat'), false);   // off at once — no guard on the way down
});

test('a rotary sweeps; a lever goes to the other position', () => {
  runMissionResets();
  setState({ aircraft: load('c172'), fuelSelector: 'BOTH', gear: true, wow: false });
  operate('fuelSelector'); operate('fuelSelector');
  assert.equal(S.fuelSelector, 'BOTH');                                     // RIGHT, then back
  setState({ aircraft: { id: 'jet' } });
  operate('gear');
  assert.equal(S.gear, false);
});

test('a mission load closes every guard', () => {
  setState({ aircraft: load('robin-dr400'), masterBat: false });
  operate('bat', { guarded: true });
  runMissionResets();
  assert.equal(guardOpen('bat'), false);
});

test('an unknown control is refused', () => assert.equal(operate('warp-drive'), false));
