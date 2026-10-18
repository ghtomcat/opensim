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
         apuMaster, apuStart, apuFire, engineMaster, adoptEngineFields, engineAvailable, coreAtN1, engineOilLow } from '../core/engine.js';
import { startRecording, apuStartRecording } from '../core/sound.js';
import { tickThrust } from '../core/thrust.js';
import { tickElectrical } from '../core/electrical.js';
import { tickFuel } from '../core/fuel.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));
const AIRCRAFT = readdirSync(join(here, '..', 'aircraft')).filter(f => f.endsWith('.json')).map(f => load(f.slice(0, -5)));

/** Set single engine fields the way the test API does (simSetState): into every engine too */
const set = (patch) => { setState(patch); adoptEngineFields(patch); };

/** Fresh cold engine on `aircraft`; returns a stepper that runs tickEngine for `s` seconds. */
function cold(aircraft, extra = {}) {
  const patch = { aircraft, engineState: 'off', engineStartT: null, engineStopT: null, enginePower: 0, n1: 0,
                  coolantState: null, fuelShutoff: false, fuelLeft: null, magnetos: 'BOTH', engineTemp: 0, switches: {},
                  masterBat: true, engineFactors: { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 },
                  wow: true, spd: 0, ...extra };   // cold — on the ground, standing (S's defaults are airborne)
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
  assert.equal(S.engines[1].state, 'off');                       // ENG 2 didn't start
  step(60);
  engineMaster(1, false);                                        // ENG 2 off — ENG 1 keeps running
  assert.equal(S.engines[0].state, 'running');
  engineMaster(0, false);                                        // ENG 1 off — its fuel cut
  assert.equal(S.engines[0].state, 'shutdown');
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

/* ── Stage 2: the engines differ ── */

function runningTwin(id = 'b777-300er', n1 = 90) {
  const ac = load(id);
  setState({ aircraft: ac, paused: false, crashed: false, wow: false, spd: 250, thrustLever: 1, thrustReverser: false,
             n1Cmd: n1, engMode: 'IGN+START', acBusPowered: true,
             ...initialEngine(ac, { onGround: false, spd: 250 }) });
  setState({ engines: S.engines.map(e => ({ ...e, n1 })) });
  return ac;
}

test('ENG MASTER i starts and stops engine i only', () => {
  const ac = load('a350');
  setState({ aircraft: ac, paused: false, crashed: false, n1Cmd: 22, engMode: 'IGN+START', acBusPowered: true,
             ...initialEngine(ac, { onGround: true, spd: 0 }) });
  engineMaster(1, true);                                         // ENG 2 first
  assert.deepEqual(S.engines.map(e => e.state), ['off', 'starting']);
  for (let t = 0; t < 60; t += 0.1) tickEngine(0.1);
  assert.deepEqual(S.engines.map(e => e.state), ['off', 'running']);
  assert.equal(S.engineState, 'running');                         // the single field: the highest state
  engineMaster(1, false);
  assert.deepEqual(S.engines.map(e => e.state), ['off', 'shutdown']);
  assert.deepEqual(S.engMasters, [false, false]);
});

test('a power failure on ENG 1 caps its N1 — at 0 it flames out and windmills; ENG 2 is untouched', () => {
  runningTwin();
  setEngineFactor('failure', 0.5, 0);
  assert.equal(engineAvailable(S.engines[0]), 0.5);
  assert.equal(engineAvailable(S.engines[1]), 1);
  for (let t = 0; t < 90; t += 0.1) tickEngine(0.1);           // spool-down τ 15 s — settled after 90 s
  const cap = 22 + 78 * 0.5;                                       // idle + (100 − idle) · power
  assert.ok(Math.abs(S.engines[0].n1 - cap) < 0.5, `ENG 1 N1 ${S.engines[0].n1.toFixed(1)}, cap ${cap}`);
  assert.ok(Math.abs(S.engines[1].n1 - 90) < 0.1);
  setEngineFactor('failure', 0, 0);
  for (let t = 0; t < 90; t += 0.1) tickEngine(0.1);
  const wm = (250 - 60) * 0.12;                                      // the airflow turns the fan: 22.8 % at 250 kt
  assert.ok(Math.abs(S.engines[0].n1 - wm) < 0.5, `ENG 1 N1 ${S.engines[0].n1.toFixed(2)} windmilling, expected ≈ ${wm}`);
  assert.ok(Math.abs(S.engines[0].core - wm / 2) < 0.5, `ENG 1 core ${S.engines[0].core.toFixed(2)}`);
  assert.equal(S.engines[0].state, 'running');                     // still selected on — but no power (ENG FAIL)
  assert.equal(S.n1, S.engines[1].n1);                             // the single field: the larger N1
});

test('Q stops all engines; a stop on one engine leaves the others', () => {
  runningTwin('a340');
  stopEngine(2);
  assert.deepEqual(S.engines.map(e => e.state), ['running', 'running', 'shutdown', 'running']);
  assert.deepEqual(S.engMasters, [true, true, false, true]);
  stopEngine();
  assert.ok(S.engines.every(e => e.state === 'shutdown'));
});

test('an airliner lined up on the runway has its engines running; at a stand it is cold; light aircraft stay cold', () => {
  const b777 = load('b777-300er');
  const lined = initialEngine(b777, { onGround: true, spd: 0, onRunway: true });
  assert.equal(lined.engineState, 'running');
  assert.deepEqual(lined.engMasters, [true, true]);
  assert.equal(lined.n1, b777.engine.idleN1 ?? 22);                 // at idle
  assert.equal(initialEngine(b777, { onGround: true, spd: 0, onRunway: false }).engineState, 'off');
  assert.equal(initialEngine(load('c172'), { onGround: true, spd: 0, onRunway: true }).engineState, 'off');
});

/* ── Stage 2c: the core ── */

test('core: idle N1 gives core idle (60 %), full N1 gives 100 %', () => {
  const eng = load('b777-300er').engine;
  assert.equal(coreAtN1(eng.idleN1 ?? 22, eng), 60);
  assert.equal(coreAtN1(100, eng), 100);
});

test('the generators run off the core: online at idle on the runway', () => {
  const ac = load('b777-300er');
  setState({ aircraft: ac, wow: true, spd: 0, paused: false, crashed: false, n1Cmd: 22, thrustLever: 0,
             idgConnected: [true, true], engGenSwitch: [true, true],
             ...initialEngine(ac, { onGround: true, spd: 0, onRunway: true }) });
  for (let t = 0; t < 2; t += 0.1) tickEngine(0.1);
  assert.ok(Math.abs(S.engines[0].core - 60) < 0.1, `core ${S.engines[0].core}`);
  tickElectrical(0.1);
  assert.deepEqual(S.engGenOn, [true, true]);                     // N1 22 % — the old N1 > 56 % rule had them off
});

test('the start: the core follows the start profile — ~25 % at light-off, idle at the end', () => {
  const ac = load('b777-300er');
  setState({ aircraft: ac, wow: true, spd: 0, paused: false, crashed: false, n1Cmd: 22, thrustLever: 0,
             ...initialEngine(ac, { onGround: true, spd: 0 }) });
  startEngine();
  const T = ac.engine.startTime;
  for (let t = 0; t < T * 0.35 - 1e-9; t += 0.1) tickEngine(0.1);
  assert.ok(Math.abs(S.engines[0].core - 25) < 1, `core ${S.engines[0].core.toFixed(1)} at light-off`);
  for (let t = 0; t < T * 0.65; t += 0.1) tickEngine(0.1);
  assert.equal(S.engines[0].state, 'running');
  assert.ok(S.engines[0].core > 55, `core ${S.engines[0].core.toFixed(1)} at the end of the start`);
});

test('in flight a flamed-out engine windmills: its core is too slow for the generator', () => {
  runningTwin();
  setState({ idgConnected: [true, true], engGenSwitch: [true, true] });
  setEngineFactor('failure', 0, 0);
  for (let t = 0; t < 90; t += 0.1) tickEngine(0.1);
  tickElectrical(0.1);
  assert.deepEqual(S.engGenOn, [false, true]);
});

test('a shutdown in flight ends when the fan has run down to its windmill speed', () => {
  runningTwin();
  stopEngine(0);
  for (let t = 0; t < 120; t += 0.1) tickEngine(0.1);
  assert.equal(S.engines[0].state, 'off');
  assert.ok(S.engines[0].n1 > 20, `windmilling at ${S.engines[0].n1.toFixed(1)} %`);
});

/* ── Stage 2c part 2: EGT, fuel flow, oil pressure ── */

function idleOnRunway() {
  const ac = load('b777-300er');
  setState({ aircraft: ac, wow: true, spd: 0, alt: 22, paused: false, crashed: false, n1Cmd: 22, thrustLever: 0,
             thrustReverser: false, fuelLeft: null, warnings: {}, metar: { temp: 15 }, mission: {},
             ...initialEngine(ac, { onGround: true, spd: 0, onRunway: true }) });
  return ac;
}

test('at idle: EGT ≈ 400 °C, oil ≈ 37 psi, fuel flow a few hundred kg/h; at takeoff thrust they rise', () => {
  idleOnRunway();
  for (let t = 0; t < 30; t += 0.1) tickEngine(0.1);
  const e = S.engines[0];
  assert.ok(Math.abs(e.egt - 400) < 5, `EGT ${e.egt.toFixed(0)}`);
  assert.ok(Math.abs(e.oil - 37.2) < 1, `oil ${e.oil.toFixed(1)}`);
  assert.ok(e.ff > 200 && e.ff < 600, `FF ${e.ff.toFixed(0)}`);
  setState({ n1Cmd: 100 });
  for (let t = 0; t < 60; t += 0.1) tickEngine(0.1);
  const t1 = S.engines[0];
  assert.ok(t1.egt > 800, `EGT ${t1.egt.toFixed(0)} at takeoff thrust`);
  assert.ok(t1.oil > 75, `oil ${t1.oil.toFixed(0)}`);
  assert.ok(t1.ff > 10000, `FF ${t1.ff.toFixed(0)} — the GE90 at takeoff`);
});

test('the start: EGT rises at light-off toward the start peak, oil comes up with the core', () => {
  const ac = load('b777-300er');
  setState({ aircraft: ac, wow: true, spd: 0, alt: 22, paused: false, crashed: false, n1Cmd: 22, thrustLever: 0, metar: { temp: 15 }, mission: {},
             ...initialEngine(ac, { onGround: true, spd: 0 }) });
  startEngine();
  const T = ac.engine.startTime;
  for (let t = 0; t < T * 0.3; t += 0.1) tickEngine(0.1);
  assert.ok(S.engines[0].egt < 30, `EGT ${S.engines[0].egt.toFixed(0)} before light-off`);
  for (let t = 0; t < T * 0.2; t += 0.1) tickEngine(0.1);
  assert.ok(S.engines[0].egt > 500, `EGT ${S.engines[0].egt.toFixed(0)} after light-off`);
  for (let t = 0; t < T * 0.6; t += 0.1) tickEngine(0.1);
  assert.equal(S.engines[0].state, 'running');
  assert.ok(S.engines[0].oil > 25, `oil ${S.engines[0].oil.toFixed(0)}`);
});

test('a failed engine in flight: oil pressure low → OIL_PRESS; one shut down (master off) does not warn', () => {
  runningTwin();
  setState({ fuelLeft: null, warnings: {} });
  for (let t = 0; t < 5; t += 0.1) tickEngine(0.1);
  tickFuel(0.1);
  assert.equal(S.warnings.OIL_PRESS, false);
  setEngineFactor('failure', 0, 0);
  for (let t = 0; t < 90; t += 0.1) tickEngine(0.1);
  assert.ok(engineOilLow(S.engines[0]), `oil ${S.engines[0].oil.toFixed(1)} windmilling`);
  assert.equal(S.engines[0].ff, 0);
  tickFuel(0.1);
  assert.equal(S.warnings.OIL_PRESS, true);
  stopEngine(0);                                                   // master off — the ECAM inhibits it
  for (let t = 0; t < 120; t += 0.1) tickEngine(0.1);
  tickFuel(0.1);
  assert.equal(S.warnings.OIL_PRESS, false);
});
