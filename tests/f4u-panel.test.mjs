/**
 * The F4U-1A's panel values (display/analog_panel.js INSTRUMENTS, step 8): the remote compass's course setter (the
 * mission's course, else its start heading), the fuel gauge on the main tank only, the engine gauge in psi.
 *
 * Run:  node --test tests/f4u-panel.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setState } from '../core/state.js';
import { INSTRUMENTS } from '../display/analog_panel.js';

const here = dirname(fileURLToPath(import.meta.url));
const F4U = JSON.parse(readFileSync(join(here, '..', 'aircraft', 'f4u1a.json'), 'utf8'));

test('the course setter: the mission\'s course, else its start heading; the arrow the heading', () => {
  setState({ aircraft: F4U, hdg: 300, mission: { initialState: { hdg: 310 } } });
  assert.deepEqual(INSTRUMENTS.compass.read(0, { variant: 'remote' }), { hdg: 300, course: 310 });
  setState({ mission: { course: 285, initialState: { hdg: 310 } } });
  assert.equal(INSTRUMENTS.compass.read(0, { variant: 'remote' }).course, 285);
  assert.equal(INSTRUMENTS.compass.read(0, {}), 300, 'the other compasses: the heading alone');
});

test('the fuel gauge reads the main tank only (tank: left); without it the total', () => {
  setState({ fuelLeft: 897, fuelRight: 460 });
  assert.equal(INSTRUMENTS.fuel.read(0, { tank: 'left' }), 897);
  assert.equal(INSTRUMENTS.fuel.read(0, {}), 1357);
});

test('the engine gauge: oil and fuel pressure in psi (the stand-ins\' kg/cm² × 14.223), oil temperature in °C', () => {
  setState({ aircraft: F4U, engines: [{ state: 'running', power: 1 }], engineState: 'running', spdT: 0, oilTempC: 70,
             fuelShutoff: false, fuelLeft: 897, fuelRight: 460, fuelStarveT: null });
  const v = INSTRUMENTS.engGauge.read(0);
  assert.equal(v.oilT, 70);
  assert.ok(Math.abs(v.oil - 1.5 * 14.223) < 0.01, `${v.oil}`);
  assert.ok(Math.abs(v.fuel - 1.3 * 14.223) < 0.01, `${v.fuel}`);
});

test('the F4U panel names its left-out instruments with the reason', () => {
  assert.equal(F4U.analogPanel.decorative.length, 3);
  assert.ok(F4U.analogPanel.decorative.every(d => /\(.+\)/.test(d)));
});
