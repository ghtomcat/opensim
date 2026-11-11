/**
 * The magneto switch: its command (core/engine.js — START starts and springs back, OFF stops) and the click's
 * sweep (display/controls.js — end to end and back, no wrap-around; Markus, 2026-11-11).
 *
 * Run:  node --test tests/magnetos.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S, setState } from '../core/state.js';
import { command } from '../core/commands.js';
import { MAGNETO_POSITIONS, adoptEngineFields, tickEngine } from '../core/engine.js';
import { sweep } from '../display/controls.js';
import { runMissionResets } from '../core/lifecycle.js';

const c172 = JSON.parse(readFileSync(new URL('../aircraft/c172.json', import.meta.url), 'utf8'));
function cold(extra = {}) {
  const patch = { aircraft: c172, engineState: 'off', engineStartT: null, engineStopT: null, enginePower: 0, n1: 0,
                  coolantState: null, fuelShutoff: false, fuelLeft: null, magnetos: 'OFF', engineTemp: 0, switches: {},
                  masterBat: true, engineFactors: { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 }, wow: true, spd: 0, ...extra };
  setState({ engines: [], ...patch }); adoptEngineFields(patch);
}
const step = (s, dt = 0.1) => { for (let t = 0; t < s - 1e-9; t += dt) tickEngine(dt); };
const click = () => command('magnetos', sweep('magnetos', MAGNETO_POSITIONS, S.magnetos), { source: 'test' });

test('the sweep: end to end and back, no wrap-around', () => {
  runMissionResets();
  const P = ['A', 'B', 'C'], seen = [];
  let cur = 'A';
  for (let i = 0; i < 6; i++) { cur = sweep('t', P, cur); seen.push(cur); }
  assert.deepEqual(seen, ['B', 'C', 'B', 'A', 'B', 'C']);
});

test('a mission load clears the direction', () => {
  runMissionResets();
  assert.equal(sweep('t2', ['A', 'B', 'C'], 'B'), 'C');
  runMissionResets();
  assert.equal(sweep('t2', ['A', 'B', 'C'], 'B'), 'C');
});

test('clicking the C172 magnetos: OFF → R → L → BOTH → START starts; it springs back; then back to OFF stops', () => {
  runMissionResets(); cold();
  const seen = [];
  for (let i = 0; i < 4; i++) { click(); seen.push(S.magnetos); }
  assert.deepEqual(seen, ['R', 'L', 'BOTH', 'START']);
  assert.equal(S.engineState, 'starting');
  step(3);
  assert.equal(S.engineState, 'running');
  assert.equal(S.magnetos, 'BOTH');                         // sprang back
  for (const want of ['L', 'R']) { click(); assert.equal(S.magnetos, want); assert.equal(S.engineState, 'running'); }
  click();
  assert.equal(S.magnetos, 'OFF');
  assert.equal(S.engineState, 'shutdown');                  // runs down
});

test('START with the engine already running springs straight back to BOTH — no stuck START', () => {
  runMissionResets(); cold({ magnetos: 'BOTH' });
  command('magnetos', 'START'); step(3);
  assert.equal(S.engineState, 'running');
  assert.equal(S.magnetos, 'BOTH');
  assert.equal(command('magnetos', 'START'), true);
  assert.equal(S.magnetos, 'BOTH');
  assert.equal(S.engineState, 'running');
});

test('a refused start (battery off) springs back too', () => {
  runMissionResets(); cold({ masterBat: false, magnetos: 'BOTH' });
  command('magnetos', 'START');
  assert.equal(S.magnetos, 'BOTH');
  assert.equal(S.engineState, 'off');
});

test('an unknown position, or the one it is at, is refused', () => {
  runMissionResets(); cold({ magnetos: 'BOTH' });
  assert.equal(command('magnetos', 'BOTH'), false);
  assert.equal(command('magnetos', 'LEFT'), false);
  assert.equal(S.magnetos, 'BOTH');
});
