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
import { commandNames, command as command2 } from '../core/commands.js';
import { CONTROLS, operate, controlState, guardOpen } from '../display/controls.js';
import { runMissionResets } from '../core/lifecycle.js';
import '../core/gear.js';
import '../core/failures.js';
import '../core/baro.js';
import '../core/fcu.js';
import '../core/gyro.js';

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

/* Step 2c — the HTML zones' controls */
import { adoptEngineFields } from '../core/engine.js';
import { setControl, toggleGuard, guardOpen as guardIsOpen } from '../display/controls.js';

test('ENG FIRE: under a guard; pulling it stops THAT engine only, once; its agents only after', () => {
  runMissionResets();
  const ac = load('a340');
  setState({ aircraft: ac, engines: [], engFireArmed: [false, false, false, false], engAgents: [], engMasters: [true, true, true, true] });
  adoptEngineFields({ engineState: 'running' });
  setState({ engines: S.engines.map(e => ({ ...e, state: 'running' })) });
  assert.equal(command2('fireAgent', { engine: 1, agent: 1 }), false);          // no agent before the handle
  toggleGuard('engFire.2'); assert.equal(guardIsOpen('engFire.2'), true);
  assert.equal(setControl('engFire.2', true), true);
  assert.deepEqual(S.engines.map(e => e.state), ['running', 'shutdown', 'running', 'running']);
  assert.equal(setControl('engFire.2', true), false);                           // pulled already
  assert.equal(command2('fireAgent', { engine: 1, agent: 1 }), true);
  assert.equal(command2('fireAgent', { engine: 1, agent: 1 }), false);          // fired already
});

test('ENG MODE sweeps CRANK ↔ NORM ↔ IGN+START, no wrap-around', () => {
  runMissionResets();
  setState({ aircraft: load('a340'), engMode: 'NORM' });
  const seen = []; for (let i = 0; i < 4; i++) { operate('engMode'); seen.push(S.engMode); }
  assert.deepEqual(seen, ['IGN+START', 'NORM', 'CRANK', 'NORM']);
});

test('speed brake, autobrake, cooling flaps: set to a position; refused without the system', () => {
  setState({ aircraft: load('a340'), speedBrake: 0, autobrake: 'OFF' });
  assert.equal(setControl('speedBrake', 1), true);   assert.equal(S.speedBrake, 1);
  assert.equal(setControl('autobrake', 'MED'), true); assert.equal(S.autobrake, 'MED');
  assert.equal(setControl('autobrake', 'HIGH'), false);
  setState({ aircraft: load('c172'), speedBrake: 0 });
  assert.equal(setControl('speedBrake', 2), false);                             // no spoilers
  setState({ aircraft: load('bf109'), coolFlap: 1 });
  assert.equal(setControl('coolFlap', 0.5), true);   assert.equal(S.coolFlap, 0.5);
});

/* The levers — and a drag recorded once, at its end */
import { recordCommand } from '../core/commands.js';

test('the throttle: the engines\' levers, a turbofan\'s as a prop\'s; the C172 knobs sweep their set points', () => {
  runMissionResets();
  setState({ aircraft: load('a340'), engines: [], lever: 0 });
  assert.equal(setControl('throttle', 0.6), true);  assert.equal(S.lever, 0.6);
  setState({ aircraft: load('c172'), engines: [], lever: 0, mixture: 1 });
  assert.equal(setControl('throttle', 1), true);    assert.equal(S.lever, 1);  assert.equal(S.engines[0].lever, 1);
  const mix = []; for (let i = 0; i < 4; i++) { operate('mixtureKnob'); mix.push(S.mixture); }
  assert.deepEqual(mix, [0.5, 0, 0.5, 1]);                                        // RICH → LEAN → ICO → LEAN → RICH: no jump
  setState({ engines: [], lever: 0 });
  operate('throttleKnob'); assert.equal(S.lever, 0.7);
});

test('trim and the levers clamp to their range; the same value again is refused', () => {
  setState({ aircraft: load('bf109'), trim: 9.8, propPitch: 1 });
  assert.equal(setControl('trim', 12), true);   assert.equal(S.trim, 10);
  assert.equal(setControl('trim', 10), false);
  assert.equal(setControl('propPitch', -1), true); assert.equal(S.propPitch, 0);
});

test('a drag: its steps unrecorded, its end recorded once; a click recorded at once', async () => {
  const { initBlackbox, bbRecords } = await import('../core/blackbox.js');
  setState({ aircraft: load('bf109'), propPitch: 1 });
  initBlackbox();
  for (const v of [0.9, 0.8, 0.7]) assert.equal(command2('propPitch', v, { source: 'drag', record: false }), true);
  recordCommand('propPitch', 0.7, { source: 'drag' });
  setControl('propPitch', 0.4);
  const rec = bbRecords().filter(r => r.type === 'command' && r.command === 'propPitch');
  assert.deepEqual(rec.map(r => [r.arg, r.source]), [[0.7, 'drag'], [0.4, 'click']]);
  assert.equal(S.propPitch, 0.4);
});

test('a continuous input (joystick axis, held key, the hub): every step done, recorded once it rests (0.5 s)', async () => {
  const { initBlackbox, bbRecords } = await import('../core/blackbox.js');
  const { commandContinuous } = await import('../core/commands.js');
  setState({ aircraft: load('bf109'), engines: [], lever: 0 });
  initBlackbox();
  for (const v of [0.2, 0.4, 0.6]) assert.equal(commandContinuous('throttle', v, { source: 'joystick' }), true);
  assert.equal(S.lever, 0.6, 'each step done at once');
  const rec = () => bbRecords().filter(r => r.type === 'command' && r.command === 'throttle').map(r => [r.arg, r.source]);
  assert.deepEqual(rec(), [], 'nothing recorded while it moves');
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(rec(), [[0.6, 'joystick']], 'recorded once, where it rested');
});

/* The altimeter setting knob (core/baro.js) — a step in the dial's own unit; turning leaves STD */
import { turn } from '../display/controls.js';
test('the setting knob turns the subscale in its dial\'s unit, leaves STD, and stays inside 940 … 1050 hPa', () => {
  setState({ baroStd: true, baroSet: 1013 });
  assert.equal(turn('baroKnob', 2), true);                                     // 1 hPa a step
  assert.equal(S.baroStd, false); assert.equal(S.baroSet, 1015.25);            // from STD 1013.25
  turn('baroKnob', 10, { stepHpa: 0.338639 });                                // an in. Hg dial: 0.10 in. Hg
  assert.ok(Math.abs(S.baroSet - (1015.25 + 3.38639)) < 0.01);
  turn('baroKnob', 1000);
  assert.equal(S.baroSet, 1050);
  assert.equal(turn('baroKnob', 1), false);                                    // at the stop: refused
  assert.equal(command2('baroStd', 'toggle'), true); assert.equal(S.baroStd, true);
});

/* The FCU (core/fcu.js) — its knobs turn and push, AP1 engages holding the present state */
import { push } from '../display/controls.js';
test('the FCU: SPD / HDG / ALT / V/S turn and push; AP1 holds the present heading and altitude when it engages', () => {
  setState({ spdT: 250, spdManaged: true, hdgT: 359, navManaged: true, altT: 5000, altManaged: true, vsT: 0, ap: false, athr: false, hdg: 92.4, alt: 7000, baroStd: true });
  turn('fcuSpd', 3);   assert.equal(S.spdT, 253); assert.equal(S.spdManaged, false);
  turn('fcuHdg', 3);   assert.equal(S.hdgT, 2);   assert.equal(S.navManaged, false);       // 359 + 3 → 2 (wraps)
  turn('fcuAlt', 10);  assert.equal(S.altT, 6000);
  turn('fcuVs', -5);   assert.equal(S.vsT, -500); assert.equal(S.vsSelected, true);
  push('fcuVs');       assert.equal(S.vsT, 0);                                              // level off
  push('fcuSpd');      assert.equal(S.spdManaged, true);
  operate('ap1');      assert.equal(S.ap, true); assert.equal(S.hdgT, 92);                // selected HDG → the present heading (92.4°)
  operate('athr');     assert.equal(S.athr, true);
  push('fcuQnh');      assert.equal(S.baroStd, false);
});

/* The heading instruments' knobs (core/gyro.js) — the course setter from the mission's course, the DG's card offset */
test('the course setter starts at the mission\'s course and turns 1° a step; the DG knob sets its card, wrapping round', async () => {
  const { courseSetting, dgHeading } = await import('../core/gyro.js');
  runMissionResets();
  setState({ mission: { course: 355 }, hdg: 10 });
  assert.equal(courseSetting(), 355);
  turn('courseKnob', 10);  assert.equal(courseSetting(), 5);                   // 355 + 10 → 5
  turn('dgKnob', -15);     assert.equal(dgHeading(), 355);                     // 10 − 15 → 355
  runMissionResets();
  assert.equal(courseSetting(), 355); assert.equal(dgHeading(), 10);           // a new mission: back to the course, no offset
});

/* Step 5 — the controls in the data: the vocabulary is CONTROLS; every zone token the zones know; each aircraft's controls */
test('the control vocabulary (core/vocab.js CONTROL) is exactly CONTROLS; every zone token holds known controls', async () => {
  const { CONTROL, ZONE_TOKEN, valuesOf } = await import('../core/vocab.js');
  assert.deepEqual(valuesOf(CONTROL).sort(), Object.keys(CONTROLS).sort());
  for (const [zone, toks] of Object.entries(ZONE_TOKEN))
    for (const [tok, cs] of Object.entries(toks)) for (const c of cs) assert.ok(CONTROLS[c], `${zone}.${tok} → ${c}`);
});

test('which controls an aircraft has — from its zones and its panel spec', async () => {
  const { aircraftControls } = await import('../core/cockpit.js');
  const spec = (f) => JSON.parse(readFileSync(new URL(`../panels/${f}.json`, import.meta.url), 'utf8'));
  const c172 = aircraftControls(load('c172'));
  for (const c of ['magnetos', 'fuelSelector', 'bat', 'alt', 'fuelPump', 'lights.nav', 'carbHeat']) assert.ok(c172.has(c), `c172 ${c}`);
  assert.ok(!c172.has('battEn'));                                                   // a Velis switch
  const velis = aircraftControls(load('velis-hb-syq'));
  for (const c of ['bat', 'avionics', 'battEn', 'pwrEn']) assert.ok(velis.has(c), `velis ${c}`);
  assert.ok(!velis.has('fuelPump') && !velis.has('magnetos'));
  const dr = aircraftControls(load('robin-dr400'), spec('dr400'));
  for (const c of ['magnetos', 'fuelSelector', 'bat', 'carbHeat', 'lights.landing']) assert.ok(dr.has(c), `dr400 ${c}`);
  assert.ok(aircraftControls(load('bf109')).has('fuelShutoff'));                    // the Brandhahn
  assert.ok(aircraftControls(load('a340')).has('engMode'));                          // derived: a turbofan's pedestal
});
