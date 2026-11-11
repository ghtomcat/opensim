/**
 * The fuel selector: its command (core/fuel.js — the positions the aircraft's own, in the real switch's order)
 * and the click's sweep (display/controls.js). One order for the key, the C172 pedestal and the DR400 panel.
 *
 * Run:  node --test tests/fuel-selector.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S, setState } from '../core/state.js';
import { command } from '../core/commands.js';
import { fuelSelectorPositions } from '../core/fuel.js';
import { sweep } from '../display/controls.js';
import { runMissionResets } from '../core/lifecycle.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../aircraft/${id}.json`, import.meta.url), 'utf8'));
const click = () => command('fuelSelector', sweep('fuelSelector', fuelSelectorPositions(), S.fuelSelector), { source: 'test' });

test('two tanks: LEFT / BOTH / RIGHT, BOTH in the middle (the C172); one tank: no selector', () => {
  assert.deepEqual(fuelSelectorPositions(load('c172')), ['LEFT', 'BOTH', 'RIGHT']);
  assert.deepEqual(fuelSelectorPositions(load('bf109')), []);
  assert.deepEqual(fuelSelectorPositions(load('mig15bis')), []);
  assert.deepEqual(fuelSelectorPositions({ tanks: { left: 110, right: 50, selector: ['MAIN', 'OFF', 'AUX'] } }), ['MAIN', 'OFF', 'AUX']);
});

test('clicks sweep from BOTH: RIGHT, BOTH, LEFT, BOTH, RIGHT — no jump from one end to the other', () => {
  runMissionResets();
  setState({ aircraft: load('c172'), fuelSelector: 'BOTH' });
  const seen = []; for (let i = 0; i < 5; i++) { click(); seen.push(S.fuelSelector); }
  assert.deepEqual(seen, ['RIGHT', 'BOTH', 'LEFT', 'BOTH', 'RIGHT']);
});

test('a position the aircraft has not, the one it is at, or a one-tank aircraft: refused', () => {
  setState({ aircraft: load('c172'), fuelSelector: 'BOTH' });
  assert.equal(command('fuelSelector', 'BOTH'), false);
  assert.equal(command('fuelSelector', 'OFF'), false);
  setState({ aircraft: load('bf109'), fuelSelector: 'BOTH' });
  assert.equal(command('fuelSelector', 'LEFT'), false);
  assert.equal(S.fuelSelector, 'BOTH');
});
