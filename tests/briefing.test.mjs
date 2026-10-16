/**
 * Scenario setup — app/briefing.js: which choices a mission offers, and the setup the pilot's
 * picks build for loadMission(…, setup). The browser side (the setup reaching the sim) is in
 * tests/scenario-setup.spec.js.
 *
 * Run:  node --test tests/briefing.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { briefingLayout, setupChoices, ownWeatherLabel, WEATHER_PRESETS, crewPresets, failurePresets, failureTime, failureEntries, buildSetup }
  from '../app/briefing.js';
import { check } from '../core/schema/check.js';
import { mission as missionSchema } from '../core/schema/mission.js';

const preset = (id, opts) => failurePresets(opts).find(p => p.id === id);

test('layout: scanned orders, airliner charts, or the story text', () => {
  assert.equal(briefingLayout({ briefing: { document: 'a.png', image: 'b.png' } }, { panel: 'bf109' }), 'doc');
  assert.equal(briefingLayout({ briefing: {} }, { panel: 'airbus' }), 'chart');
  assert.equal(briefingLayout({ briefing: {} }, { panel: 'e190' }), 'chart');
  assert.equal(briefingLayout({ briefing: { image: 'b.png' } }, { panel: 'g1000' }), 'text');
  assert.equal(briefingLayout({}), 'text');
});

test('choices: weather and failure for flying missions; none for launches, rockets, labs, fixed stories', () => {
  const roles = [{ id: 'PF', label: 'Pilot flying' }];
  assert.deepEqual(setupChoices({ id: 'lszh-approach', roles }, { phase: 'approach' }, { panel: 'airbus' }),
    { weather: true, failure: true, crew: roles });
  const demo2 = setupChoices({ id: 'crew-demo2', roles }, { phase: 'launch' }, { vehicleType: 'rocket' });
  assert.equal(demo2.weather, false); assert.equal(demo2.failure, false); assert.deepEqual(demo2.crew, roles);
  assert.equal(setupChoices({ id: 'x' }, { phase: 'ground' }, { vehicleType: 'rocket' }).weather, false);
  assert.equal(setupChoices({ id: 'yertle-lab' }, { phase: 'ground' }, { vehicleType: 'robot-dog' }).failure, false);
  assert.deepEqual(setupChoices({ id: 'wolfskopf-1942', fixedScenario: true }, { phase: 'cruise' }),
    { weather: false, failure: false, crew: [] });
  assert.equal(setupChoices({ id: 'live-flight' }).weather, false);
});

test('the mission\'s own weather: live METAR, or as briefed', () => {
  assert.equal(ownWeatherLabel({ weather: { source: 'live', icao: 'LSZH' } }), 'Live METAR');
  assert.equal(ownWeatherLabel({ weather: { source: 'manual', manual: {} } }), 'As briefed');
  assert.equal(ownWeatherLabel({}), 'As briefed');
});

test('crew choice: named crew over roles, none when the mission has neither', () => {
  const crew  = [{ id: 'FO', name: 'Anna', role: 'PM' }];
  const roles = [{ id: 'PF', label: 'Pilot flying' }];
  assert.deepEqual(crewPresets({ crew, roles }), crew);
  assert.deepEqual(crewPresets({ roles }), roles);
  assert.deepEqual(crewPresets({}), []);
});

test('carb icing is offered only with carb heat', () => {
  assert.equal(preset('CARB ICE', { hasCarbHeat: true })?.carbIce, true);
  assert.equal(preset('CARB ICE', { hasCarbHeat: false }), undefined);
  assert.equal(preset('CARB ICE'), undefined);
});

test('failure time: random 60–300 s, or the fixed time (min 10 s, blank = 120 s)', () => {
  assert.equal(failureTime({ random: true }, () => 0), 60);
  assert.equal(failureTime({ random: true }, () => 0.9999), 299);
  assert.equal(failureTime({ fixedT: '45' }), 45);
  assert.equal(failureTime({ fixedT: '5' }), 10);
  assert.equal(failureTime({ fixedT: '' }), 120);
});

test('failure entries: a bang is gunfire, then bang and power loss one second later', () => {
  assert.deepEqual(failureEntries(preset('ROUGH'), 100), [
    { trigger: { type: 'time', t: 100 }, type: 'engine_gunfire' },
    { trigger: { type: 'time', t: 101 }, type: 'engine_bang' },
    { trigger: { type: 'time', t: 101 }, type: 'engine_power', value: 0.3, rampTime: 20 },
  ]);
  assert.deepEqual(failureEntries(preset('PARTIAL'), 90), [
    { trigger: { type: 'time', t: 90 }, type: 'engine_power', value: 0.5, rampTime: 30 },
  ]);
  assert.deepEqual(failureEntries(preset('CARB ICE', { hasCarbHeat: true }), 200), [
    { trigger: { type: 'time', t: 200 }, type: 'carb_ice' },
  ]);
  assert.deepEqual(failureEntries(preset('CLEAN'), 100), []);
});

test('failure entries are valid mission failures (core/schema/)', () => {
  const m = JSON.parse(readFileSync(new URL('../missions/lszf-pattern.json', import.meta.url)));
  const before = check(m, missionSchema).length;
  m.failures = [...(m.failures ?? []),
    ...failurePresets({ hasCarbHeat: true }).flatMap(p => failureEntries(p, 120))];
  assert.equal(check(m, missionSchema).length, before);
});

test('buildSetup: live weather keeps the mission\'s, a preset replaces it; no failure → none', () => {
  const m = { id: 'lszh-approach' };
  const live = buildSetup(m, { weather: 'LIVE', failure: 'CLEAN', crew: null });
  assert.equal(live.weather, null);
  assert.deepEqual(live.failures, []);
  const ovc = buildSetup(m, { weather: 'OVC 1500', failure: 'CLEAN', crew: null });
  assert.deepEqual(ovc.weather, WEATHER_PRESETS.find(p => p.id === 'OVC 1500').override);
});

test('buildSetup: the failure comes at the chosen time', () => {
  const s = buildSetup({ id: 'lszf-pattern' },
    { weather: 'LIVE', failure: 'FAILURE', timing: { fixedT: '150' }, crew: null });
  assert.deepEqual(s.failures.map(f => f.trigger.t), [150, 151, 151]);
  assert.equal(s.failures.at(-1).value, 0);
});

test('buildSetup: no crew choice → no crew in the setup (the mission\'s role stays)', () => {
  assert.equal(buildSetup({ id: 'lszf-pattern' }, { weather: 'LIVE', failure: 'CLEAN', crew: null }).crew, null);
});

test('buildSetup: a named crew member sets role, name and callsign; a plain role sets the role', () => {
  const crew = [{ id: 'FO', name: 'Anna Keller', role: 'PM', callsign: 'Swiss 12' }];
  assert.deepEqual(buildSetup({ crew }, { weather: 'LIVE', failure: 'CLEAN', crew: 'FO' }).crew,
    { role: 'PM', pilotId: 'FO', pilotName: 'Anna Keller', pilotCallsign: 'Swiss 12' });
  const roles = [{ id: 'PF', label: 'Pilot flying' }, { id: 'PM', label: 'Pilot monitoring' }];
  assert.deepEqual(buildSetup({ roles }, { weather: 'LIVE', failure: 'CLEAN', crew: 'PM' }).crew,
    { role: 'PM', pilotId: 'PM', pilotName: null, pilotCallsign: null });
});
