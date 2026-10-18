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
import { startEngine, stopEngine, engineQuit, tickEngine, initialEngine, hasStartSequence, setEngineFactor,
         apuMaster, apuStart, apuFire, engineMaster, adoptEngineFields } from '../core/engine.js';
import { startRecording, apuStartRecording } from '../core/sound.js';
import { tickThrust } from '../core/thrust.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));
const AIRCRAFT = readdirSync(join(here, '..', 'aircraft')).filter(f => f.endsWith('.json')).map(f => load(f.slice(0, -5)));

/** Set single engine fields the way the test API does (simSetState): into every engine too */
const set = (patch) => { setState(patch); adoptEngineFields(patch); };

/** Fresh cold engine on `aircraft`; returns a stepper that runs tickEngine for `s` seconds. */
function cold(aircraft, extra = {}) {
  const patch = { aircraft, engineState: 'off', engineStartT: null, engineStopT: null, enginePower: 0, n1: 0,
                  coolantState: null, fuelShutoff: false, fuelLeft: null, magnetos: 'BOTH', engineTemp: 0, switches: {},
                  masterBat: true, engineFactors: { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 }, ...extra };
  setState({ engines: [], ...patch });
  adoptEngineFields(patch);   // one engine entry per engine.count, from the single fields
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

test('an electric starter needs BAT on — a refused start springs the key back to BOTH', () => {
  const ac = load('c172');
  const step = cold(ac, { masterBat: false, magnetos: 'START' });
  startEngine(); step(3);
  assert.equal(S.engineState, 'off');
  assert.equal(S.magnetos, 'BOTH');
  setState({ masterBat: true, magnetos: 'START' });
  startEngine();
  assert.equal(S.engineState, 'starting');
  /* no starter declared → no battery condition (the Bf 109's inertia starter) */
  cold(load('bf109'), { masterBat: false });
  startEngine();
  assert.equal(S.engineState, 'starting');
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
  set({ n1: 22 });
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
  set({ n1: 22 });
  stopEngine();
  step(5);
  assert.equal(S.engineState, 'shutdown');   // the fan is still turning (N1 comes from physics)
  set({ n1: 0.3 });
  step(0.1);
  assert.equal(S.engineState, 'off');
});

test('a turbofan start also ends once the fan reaches idle', () => {
  const step = cold(load('a350'));
  startEngine(); step(10);
  set({ n1: 22 * 0.96 });
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

test('power is the lifecycle share × the causes — off 0, starting 0.01, running 1', () => {
  const step = cold(load('c172'));
  assert.equal(S.enginePower, 0);
  startEngine();
  assert.equal(S.enginePower, 0.01);
  step(3);
  assert.equal(S.enginePower, 1);
  stopEngine();
  assert.equal(S.enginePower, 1);                // the run-down keeps it until off
  step(4);
  assert.equal(S.engineState, 'off');
  assert.equal(S.enginePower, 0);                // off makes no power — no fuel burn after a shutdown
});

test('causes combine instead of overwriting each other (failure ramp × carb ice)', () => {
  const step = cold(load('c172'));
  startEngine(); step(3);
  setEngineFactor('failure', 0.5);
  setEngineFactor('ice', 0.8);
  assert.ok(Math.abs(S.enginePower - 0.4) < 1e-9);
  setEngineFactor('ice', 1);                     // carb heat clears the ice — the failure stays
  assert.equal(S.enginePower, 0.5);
});

test('a restart does not heal a partial failure; a crash makes no power', () => {
  const step = cold(load('c172'));
  startEngine(); step(3);
  setEngineFactor('failure', 0.6);
  engineQuit();
  assert.equal(S.enginePower, 0);
  startEngine(); step(3);
  assert.equal(S.enginePower, 0.6);
  setEngineFactor('crash', 0);
  assert.equal(S.enginePower, 0);
});

test('a cold aircraft loads with no power, an airborne one with full power and no factors', () => {
  const c = initialEngine(load('a350'), { onGround: true, spd: 0 });
  assert.equal(c.enginePower, 0);
  const a = initialEngine(load('a350'), { onGround: false, spd: 250 });
  assert.equal(a.enginePower, 1);
  assert.deepEqual(a.engineFactors, { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 });
});

test('a misspelled cause throws', () => {
  assert.throws(() => setEngineFactor('icing', 0.5), /unknown power factor/);
});

test('every APU start time matches the APU start-up recording', () => {
  const SR = 8000, len = apuStartRecording(SR).length / SR;
  for (const a of AIRCRAFT.filter(a => a.apu))
    assert.ok(Math.abs(len - a.apu.startTime) < 0.05, `${a.id}: apu.startTime ${a.apu.startTime} s, recording ${len.toFixed(2)} s`);
});

test('APU: MASTER + battery power, START, running after apu.startTime; MASTER off or fire stops it', () => {
  const ac = load('a350');
  const step = cold(ac, { essentialBusPowered: false, apuMasterOn: false, apuState: 'off', apuFireArmed: false });
  apuStart();
  assert.equal(S.apuState, 'off');                    // no MASTER
  apuMaster(true);
  apuStart();
  assert.equal(S.apuState, 'off');                    // no battery power on the essential bus
  setState({ essentialBusPowered: true });
  apuStart();
  assert.equal(S.apuState, 'starting');
  step(ac.apu.startTime - 0.2);
  assert.equal(S.apuState, 'starting');
  step(0.3);
  assert.equal(S.apuState, 'running');
  assert.equal(S.apuRunning, true);
  apuMaster(false);
  assert.equal(S.apuState, 'off');
  apuMaster(true); apuStart(); step(ac.apu.startTime + 0.1);
  apuFire();
  assert.equal(S.apuState, 'off');
  assert.equal(S.apuMasterOn, false);
  assert.equal(S.apuFireArmed, true);
});

test('no APU in the data → START does nothing', () => {
  cold(load('tu95ms'), { apuMasterOn: true, essentialBusPowered: true, apuState: 'off' });
  apuStart();
  assert.equal(S.apuState, 'off');
});

test('ENG MASTER: IGN/START + AC power starts, no AC power drops it back, NORM only latches', () => {
  const step = cold(load('a340'), { engMasters: [false, false, false, false], engMode: 'IGN+START', acBusPowered: false });
  engineMaster(0, true);
  assert.deepEqual(S.engMasters, [false, false, false, false]);   // no AC power — the switch drops back
  assert.equal(S.engineState, 'off');
  setState({ acBusPowered: true });
  engineMaster(0, true);
  assert.deepEqual(S.engMasters, [true, false, false, false]);
  assert.equal(S.engineState, 'starting');
  setState({ engMode: 'NORM' });
  engineMaster(1, true);                                         // NORM: latches, no start of its own
  assert.deepEqual(S.engMasters, [true, true, false, false]);
  step(60);
  engineMaster(1, false);                                        // another master still on — the shared engine keeps running
  assert.equal(S.engineState, 'running');
  engineMaster(0, false);                                        // the last one off — fuel cut
  assert.equal(S.engineState, 'shutdown');
});

test('Q on a turbofan (stopEngine) sets the ENG MASTER switches to OFF — they are the fuel cutoff', () => {
  const step = cold(load('a350'), { engMasters: [true, true], engineState: 'running', n1: 22 });
  stopEngine();
  assert.deepEqual(S.engMasters, [false, false]);
});

test('mission load: one ENG MASTER per engine — off when cold, on when the engines run', () => {
  assert.deepEqual(initialEngine(load('a340'), { onGround: true,  spd: 0 }).engMasters,   [false, false, false, false]);
  assert.deepEqual(initialEngine(load('a340'), { onGround: false, spd: 250 }).engMasters, [true, true, true, true]);
});

test('S.engines holds one entry per engine — the A340 has four, the C172 one', () => {
  setState({ engines: [], ...initialEngine(load('a340'), { onGround: true, spd: 0 }) });
  assert.equal(S.engines.length, 4);
  setState({ engines: [], ...initialEngine(load('c172'), { onGround: true, spd: 0 }) });
  assert.equal(S.engines.length, 1);
});

test('stage 1: every engine goes through the same start and spool; the single fields match them', () => {
  const ac = load('a340');
  const patch = initialEngine(ac, { onGround: true, spd: 0 });
  setState({ aircraft: ac, paused: false, crashed: false, n1Cmd: 22, thrustLever: 0, wow: true, thrustReverser: false, ...patch });
  startEngine();
  for (let t = 0; t < 30; t += 0.1) tickEngine(0.1);
  const n1s = S.engines.map(e => e.n1);
  assert.ok(n1s.every(n => n === n1s[0]), `N1 ${n1s}`);                    // identical, to the last bit
  assert.ok(S.engines.every(e => e.state === 'starting'));
  assert.equal(S.n1, n1s[0]);
  assert.equal(S.engineState, 'starting');
  assert.equal(S.engineStartT, S.engines[0].startT);
  for (let t = 0; t < 30; t += 0.1) tickEngine(0.1);
  assert.ok(S.engines.every(e => e.state === 'running'));
  assert.equal(S.enginePower, 1);
});

test('the single fields are derived: the highest state, the largest N1 and power', () => {
  const ac = load('a340');
  setState({ aircraft: ac, ...initialEngine(ac, { onGround: true, spd: 0 }) });
  /* differing engines don't happen in stage 1 yet — build the array by hand */
  const e = (state, n1, power) => ({ state, startT: state === 'starting' ? 3 : null, stopT: null, n1, factors: S.engineFactors, power });
  setState({ engines: [e('off', 0, 0), e('starting', 5, 0.01), e('running', 40, 1), e('off', 0, 0)] });
  setEngineFactor('crash', 1);   // any change publishes the single fields from the array
  assert.equal(S.engineState, 'running');
  assert.equal(S.n1, 40);
  assert.equal(S.enginePower, 1);
  assert.equal(S.engineStartT, 3);
});
