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

test('the throttle: a turbofan\'s thrust lever, a prop\'s spdT stand-in; the C172 knobs sweep their set points', () => {
  runMissionResets();
  setState({ aircraft: load('a340'), thrustLever: 0 });
  assert.equal(setControl('throttle', 0.6), true);  assert.equal(S.thrustLever, 0.6);
  setState({ aircraft: load('c172'), spdT: 0, mixture: 1 });
  assert.equal(setControl('throttle', 1), true);    assert.equal(S.spdT, load('c172').envelope.maxSpd);
  const mix = []; for (let i = 0; i < 4; i++) { operate('mixtureKnob'); mix.push(S.mixture); }
  assert.deepEqual(mix, [0.5, 0, 0.5, 1]);                                        // RICH → LEAN → ICO → LEAN → RICH: no jump
  setState({ spdT: 0 });
  operate('throttleKnob'); assert.equal(S.spdT, Math.round(0.7 * load('c172').envelope.maxSpd));
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
