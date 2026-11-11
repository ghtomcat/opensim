/**
 * The light aircraft's electrical switches as one command (core/electrical.js, `elec`): one id per switch —
 * bat, alt, avionics — whatever the aircraft; today's fields written as a stand-in.
 *
 * Run:  node --test tests/light-switches.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S, setState } from '../core/state.js';
import { command } from '../core/commands.js';
import { lightSwitches } from '../core/electrical.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../aircraft/${id}.json`, import.meta.url), 'utf8'));

test('which aircraft have which switches — from the data (electric starter / electric motor), not the panel', () => {
  assert.deepEqual(lightSwitches(load('c172')), ['bat', 'alt', 'avionics']);
  assert.deepEqual(lightSwitches(load('robin-dr400')), ['bat', 'alt', 'avionics']);
  assert.deepEqual(lightSwitches(load('velis-hb-syc')), ['bat', 'battEn', 'pwrEn', 'avionics']);
  assert.equal(lightSwitches(load('bf109')), null);
});

test('the C172: bat, alt, avionics set masterBat, masterAlt, avionicsOn; toggle without `on`', () => {
  setState({ aircraft: load('c172'), masterBat: false, masterAlt: false, avionicsOn: false });
  assert.equal(command('elec', { id: 'bat', on: true }, { source: 'test' }), true);  assert.equal(S.masterBat, true);
  assert.equal(command('elec', { id: 'bat', on: true }), false);                     // already on
  assert.equal(command('elec', { id: 'alt' }), true);                                assert.equal(S.masterAlt, true);
  assert.equal(command('elec', { id: 'avionics' }), true);                           assert.equal(S.avionicsOn, true);
  assert.equal(command('elec', { id: 'pwrEn' }), false);                             // a Velis switch
});

test('the Velis: the MASTER key is bat; BATT EN, PWR EN, AVNCS — a new S.switches each time, not changed in place', () => {
  setState({ aircraft: load('velis-hb-syc'), switches: { master: false, battEn: false, pwrEn: false, avionics: false } });
  const before = S.switches;
  for (const id of ['bat', 'battEn', 'pwrEn', 'avionics']) assert.equal(command('elec', { id }), true, id);
  assert.deepEqual(S.switches, { master: true, battEn: true, pwrEn: true, avionics: true });
  assert.notEqual(S.switches, before);
  assert.equal(before.master, false);
  assert.equal(command('elec', { id: 'alt' }), false);                               // no alternator
});

test('an aircraft without these switches refuses them (the Bf 109)', () => {
  setState({ aircraft: load('bf109'), masterBat: false });
  assert.equal(command('elec', { id: 'bat', on: true }), false);
  assert.equal(S.masterBat, false);
});
