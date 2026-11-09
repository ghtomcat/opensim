/**
 * The engine stand-ins — core/engine-gauges.js (issues.md, "The analog panels draw a borrowed fighter
 * panel", step 6 part 2): the values the analog panels show before their systems exist, per engine,
 * in the sim and not in the drawing code.
 *
 * Run:  node --test tests/engine-gauges.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { adoptEngineFields, tickEngine, stopEngine } from '../core/engine.js';
import { oilPressure, manifoldPressure, fuelPressure, generatorAmps, oilFlowing, propPitchHours, tankAirPressure,
         fuelLitres, STAND_INS } from '../core/engine-gauges.js';
import { INSTRUMENTS } from '../display/analog_panel.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));

/** `aircraft` with every engine in `state`, the throttle at `thr` (0–1) */
function on(aircraft, state, thr = 0, extra = {}) {
  const patch = { aircraft, engineState: state, engineStartT: state === 'starting' ? 0 : null, engineStopT: null, enginePower: state === 'running' ? 1 : 0,
                  n1: 0, engineFactors: { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 },
                  spdT: thr * aircraft.envelope.maxSpd, wow: false, fuelShutoff: false, fuelLeft: 200, fuelRight: 0, fuelStarveT: null,
                  propPitch: 1, ...extra };
  setState({ engines: [], ...patch });
  adoptEngineFields(patch);
}

test('running: the values the panel showed before the move (oil 1.5–7.5 kg/cm², boost 12–52 in.Hg, fuel 1.3, 18 A)', () => {
  const bf = load('bf109');
  on(bf, 'running', 0);
  assert.equal(oilPressure(0), 1.5);
  assert.equal(fuelPressure(0), 1.3);
  assert.equal(generatorAmps(0), 18);
  on(bf, 'running', 1);
  assert.equal(oilPressure(0), 7.5);
  assert.equal(manifoldPressure(0), 52);
  assert.equal(propPitchHours(), 0, 'fine pitch: 12 o\'clock');
  setState({ propPitch: 0 });
  assert.equal(propPitchHours(), 6, 'coarse: 6 hours');
});

test('off: no oil, no fuel pressure, no charge, no flow', () => {
  on(load('bf109'), 'off');
  assert.equal(oilPressure(0), 0);
  assert.equal(fuelPressure(0), 0);
  assert.equal(generatorAmps(0), 0);
  assert.equal(oilFlowing(0), 0);
});

test('the start: oil and fuel pressure build with the rpm and reach their idle value at idle rpm', () => {
  const bf = load('bf109');
  on(bf, 'starting');
  for (let t = 0; t < bf.engine.startTime - 0.3; t += 0.1) tickEngine(0.1);
  assert.equal(S.engines[0].state, 'starting');
  assert.ok(oilPressure(0) > 1.3 && oilPressure(0) <= 1.5, `near idle: ${oilPressure(0)}`);
  assert.ok(fuelPressure(0) > 1.1 && fuelPressure(0) <= 1.3, `near idle: ${fuelPressure(0)}`);
});

test('the run-down: the oil pressure falls with the rpm', () => {
  on(load('bf109'), 'running', 1);
  stopEngine();
  const p0 = oilPressure(0);
  tickEngine(1.2);
  assert.ok(oilPressure(0) < p0 * 0.5, `${p0} → ${oilPressure(0)}`);
});

test('fuel: the pressure falls over the starvation run-down once the cock is shut; the Avro\'s tank pressure goes with it', () => {
  on(load('bf109'), 'running', 0.5, { fuelShutoff: true, fuelStarveT: 5 });
  assert.equal(fuelPressure(0), 0.65);
  on(load('avro504'), 'running', 0.5);
  assert.equal(tankAirPressure(), 3);
  assert.equal(fuelLitres(), 200);
  setState({ fuelShutoff: true });
  assert.equal(tankAirPressure(), 0);
});

test('per engine: a stopped engine beside a running one shows its own values (the Tu-95, engine 3 off)', () => {
  on(load('tu95ms'), 'running', 0.5);
  setState({ engines: S.engines.map((e, k) => k === 2 ? { ...e, state: 'off', power: 0 } : e) });
  assert.ok(oilPressure(0) > 1.5);
  assert.equal(oilPressure(2), 0);
  assert.equal(fuelPressure(2), 0);
  assert.equal(generatorAmps(2), 0);
  assert.equal(INSTRUMENTS.oilP.read(2), 0, 'the panel reads the engine it is given');
  assert.ok(INSTRUMENTS.oilP.read(0) > 1.5);
});

test('the panel\'s stand-ins come from here, marked with what replaces them; the drawing code computes none', () => {
  const marks = { oilP: STAND_INS.oilPressure, map: STAND_INS.manifoldPressure, amps: STAND_INS.generatorAmps,
                  pitch: STAND_INS.propPitchHours, airP: STAND_INS.tankAirPressure, pulsator: STAND_INS.oilFlowing };
  for (const [id, mark] of Object.entries(marks)) assert.equal(INSTRUMENTS[id].simple, mark, id);
  const src = readFileSync(join(here, '..', 'display', 'analog_panel.js'), 'utf8');
  assert.doesNotMatch(src, /function _simple\w+|SIMPLE VALUES/, 'no stand-in left in display/analog_panel.js');
});
