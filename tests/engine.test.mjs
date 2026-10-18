/**
 * Engine lifecycle — pure tests for core/engine.js (no browser, no audio).
 * The start and the shutdown run on sim time: a cold start completes by stepping tickEngine,
 * with no AudioContext anywhere. Also locks each aircraft's engine.startTime to the length of
 * the start-up recording core/sound.js plays for it, so the sound and the engine finish together.
 *
 * Run:  node --test tests/engine.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { startEngine, stopEngine, engineQuit, tickEngine, initialEngine, hasStartSequence } from '../core/engine.js';
import { startRecording } from '../core/sound.js';
import { tickThrust } from '../core/thrust.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));
const AIRCRAFT = readdirSync(join(here, '..', 'aircraft')).filter(f => f.endsWith('.json')).map(f => load(f.slice(0, -5)));

/** Fresh cold engine on `aircraft`; returns a stepper that runs tickEngine for `s` seconds. */
function cold(aircraft, extra = {}) {
  setState({ aircraft, engineState: 'off', engineStartT: null, engineStopT: null, enginePower: 0, n1: 0,
             coolantState: null, fuelShutoff: false, fuelLeft: null, magnetos: 'BOTH', engineTemp: 0, switches: {}, ...extra });
  return (s, dt = 0.1) => { for (let t = 0; t < s - 1e-9; t += dt) tickEngine(dt); };
}

test('every start time matches the length of the start-up recording that plays for it', () => {
  const SR = 8000;
  for (const a of AIRCRAFT.filter(a => hasStartSequence(a.engine ?? {}))) {
    const sound = a.sound?.engineType ?? 'geared-turbofan';   // the default index.html gives sound.js
    const len   = startRecording(sound, SR).length / SR;
    assert.ok(Math.abs(len - a.engine.startTime) < 0.05, `${a.id}: engine.startTime ${a.engine.startTime} s, recording ${len.toFixed(2)} s`);
  }
});

test('a piston cold start completes on sim time, without audio', () => {
  const step = cold(load('c172'), { magnetos: 'START' });
  startEngine();
  assert.equal(S.engineState, 'starting');
  assert.equal(S.enginePower, 0.01);
  step(2.7);
  assert.equal(S.engineState, 'starting');
  step(0.2);
  assert.equal(S.engineState, 'running');
  assert.equal(S.enginePower, 1.0);
  assert.equal(S.magnetos, 'BOTH');          // the key springs back from START
  assert.equal(S.engineStartT, null);
});

test('no start with the fuel shutoff closed or a seized engine; none while running', () => {
  cold(load('c172'), { fuelShutoff: true, fuelLeft: 90 });
  startEngine();
  assert.equal(S.engineState, 'off');
  cold(load('bf109'), { coolantState: 'failed' });
  startEngine();
  assert.equal(S.engineState, 'off');
  const step = cold(load('c172'));
  startEngine(); step(3);
  startEngine();
  assert.equal(S.engineState, 'running');
});

test('a piston shutdown runs down for engine.stopTime, then the engine is off', () => {
  const ac = load('robin-dr400');
  const step = cold(ac);
  startEngine(); step(3);
  stopEngine();
  assert.equal(S.engineState, 'shutdown');
  step(ac.engine.stopTime - 0.2);
  assert.equal(S.engineState, 'shutdown');
  step(0.3);
  assert.equal(S.engineState, 'off');
  assert.equal(S.engineStopT, null);
});

test('a piston engine cannot be started while it runs down — only once it is off', () => {
  const ac = load('bf109');
  const step = cold(ac);
  startEngine(); step(ac.engine.startTime + 0.2);
  stopEngine(); step(1);
  startEngine();
  assert.equal(S.engineState, 'shutdown');
  step(ac.engine.stopTime);
  assert.equal(S.engineState, 'off');
  startEngine();
  assert.equal(S.engineState, 'starting');
});

test('a turbofan can be restarted while the fan spools down', () => {
  const step = cold(load('a350'));
  startEngine(); step(60);
  setState({ n1: 22 });
  stopEngine(); step(2);
  startEngine();
  assert.equal(S.engineState, 'starting');
});

test('a turbofan start ends at engine.startTime, its shutdown when the fan has run down', () => {
  const ac = load('a350');
  const step = cold(ac);
  startEngine();
  step(ac.engine.startTime - 0.2);
  assert.equal(S.engineState, 'starting');
  step(0.3);
  assert.equal(S.engineState, 'running');
  setState({ n1: 22 });
  stopEngine();
  step(5);
  assert.equal(S.engineState, 'shutdown');   // the fan is still turning (N1 comes from physics)
  setState({ n1: 0.3 });
  step(0.1);
  assert.equal(S.engineState, 'off');
});

test('a turbofan start also ends once the fan reaches idle', () => {
  const step = cold(load('a350'));
  startEngine(); step(10);
  setState({ n1: 22 * 0.96 });
  step(0.1);
  assert.equal(S.engineState, 'running');
});

test('fuel starvation or a seizure stops the engine at once', () => {
  const step = cold(load('c172'));
  startEngine(); step(3);
  engineQuit();
  assert.equal(S.engineState, 'off');
});

test('the electric motor follows MASTER + BATT EN + PWR EN', () => {
  const step = cold(load('velis-hb-syc'), { switches: { master: true, battEn: true, pwrEn: false } });
  step(0.1);
  assert.equal(S.engineState, 'off');
  setState({ switches: { master: true, battEn: true, pwrEn: true } });
  step(0.1);
  assert.equal(S.engineState, 'running');
  assert.equal(S.enginePower, 1.0);
  setState({ switches: { master: true, battEn: false, pwrEn: true } });
  step(0.1);
  assert.equal(S.engineState, 'off');
});

test('engines without a start sequence ignore start and stop', () => {
  cold(load('tu95ms'), { engineState: 'running', enginePower: 1 });
  stopEngine();
  assert.equal(S.engineState, 'running');
});

test('initial state: cold on the ground with a start sequence, running otherwise', () => {
  assert.equal(initialEngine(load('c172'), { onGround: true,  spd: 0 }).engineState, 'off');
  assert.equal(initialEngine(load('c172'), { onGround: false, spd: 100 }).engineState, 'running');
  assert.equal(initialEngine(load('velis-hb-syc'), { onGround: true, spd: 0 }).engineState, 'off');
  assert.equal(initialEngine(load('tu95ms'), { onGround: true, spd: 0 }).engineState, 'running');
  const a350 = load('a350');
  const air  = initialEngine(a350, { onGround: false, spd: 250 });
  assert.equal(air.engineState, 'running');
  assert.ok(air.n1 > (a350.engine.idleN1 ?? 22));
  assert.equal(initialEngine(a350, { onGround: true, spd: 0 }).n1, 0);
});

test('turbofan: the thrust lever sets the command, the engine spools N1 toward it (8 s up)', () => {
  const ac = load('a350');
  cold(ac, { engineState: 'running', n1: 22, athr: false, wow: true, thrustLever: 1, crashed: false, paused: false, envelope: undefined });
  tickThrust(0.1);
  assert.equal(S.n1Cmd, 100);                                  // full lever → 100 % (A/THR off)
  for (let t = 0; t < 8 - 1e-9; t += 0.1) { tickThrust(0.1); tickEngine(0.1); }
  const expect = 22 + (100 - 22) * (1 - Math.exp(-1));         // one time constant
  assert.ok(Math.abs(S.n1 - expect) < 0.5, `N1 ${S.n1.toFixed(2)} after 8 s, expected ≈ ${expect.toFixed(2)}`);
});

test('turbofan: after a fuel cutoff the fan coasts down and the engine reaches off by itself', () => {
  const step = cold(load('a350'), { engineState: 'running', n1: 22, n1Cmd: 22 });
  stopEngine();
  step(40);
  assert.equal(S.engineState, 'shutdown');                     // 22 · e^(−40/12) ≈ 0.8 % — still turning
  step(8);
  assert.equal(S.engineState, 'off');                          // < 0.5 % after ≈ 45 s
});
