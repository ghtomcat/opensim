/**
 * Data schema — every mission, catalog entry and aircraft against its schema (core/schema/).
 * Pure JSON checks, no browser. A misspelled key or an unknown enum value fails here instead of
 * being silently ignored by the sim.
 *
 * KNOWN (core/schema/known.js) lists the violations that are logged in docs/issues.md and not fixed
 * yet — the same list the load-time check in core/mission.js lets through. The test fails on any
 * other error — and on a KNOWN entry that no longer occurs, so the list can't go stale.
 *
 * Run:  node --test tests/data-schema.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { check } from '../core/schema/check.js';
import { mission } from '../core/schema/mission.js';
import { catalog } from '../core/schema/catalog.js';
import { aircraft } from '../core/schema/aircraft.js';
import { KNOWN, unknownErrors } from '../core/schema/known.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const jsonIn = (dir) => readdirSync(join(root, dir)).filter(f => f.endsWith('.json') && f !== 'catalog.json').sort();

function expectValid(file, schema) {
  const errors = check(load(file), schema);
  const unexpected = unknownErrors(file, errors);
  const gone = (KNOWN[file] ?? []).filter(k => !errors.some(e => e.startsWith(k.error)));
  assert.deepEqual(unexpected, [], `${file}:\n  ${unexpected.join('\n  ')}`);
  assert.deepEqual(gone.map(k => k.error), [], `${file}: fixed — remove from KNOWN (and close "${gone[0]?.issue}")`);
}

for (const f of jsonIn('missions')) test(`missions/${f}`, () => expectValid(`missions/${f}`, mission));
test('missions/catalog.json', () => expectValid('missions/catalog.json', catalog));
for (const f of jsonIn('aircraft')) test(`aircraft/${f}`, () => expectValid(`aircraft/${f}`, aircraft));

/* ── Catalog ↔ mission files ── The card's labels may differ from the mission (short vs full title);
   the facts may not. */
const NOT_IN_PICKER = {
  'live-flight': 'built at runtime from an ADS-B position (flyWithFlight() in index.html)',
};
const KNOWN_AIRCRAFT_MISMATCH = {
  'egll-approach': 'egll-approach is temporarily the 737 MAX 9 into Madrid',
};
const acId = (s) => String(s).replace(/^aircraft\//, '').replace(/\.json$/, '');
const missionIds = jsonIn('missions').map(f => f.replace(/\.json$/, ''));
const cards = load('missions/catalog.json');

test('every catalog card has a mission file', () => {
  assert.deepEqual(cards.map(c => c.id).filter(id => !missionIds.includes(id)), []);
});
test('every mission is in the catalog, or explained in NOT_IN_PICKER', () => {
  assert.deepEqual(missionIds.filter(id => !cards.some(c => c.id === id) && !NOT_IN_PICKER[id]), []);
});
test('every mission flies an aircraft that exists', () => {
  const have = jsonIn('aircraft').map(f => f.replace(/\.json$/, ''));
  assert.deepEqual(missionIds.filter(id => !have.includes(acId(load(`missions/${id}.json`).aircraft))), []);
});
test("the catalog's aircraft is the mission's aircraft", () => {
  const mismatch = cards.filter(c => acId(load(`missions/${c.id}.json`).aircraft) !== c.aircraft).map(c => c.id);
  assert.deepEqual(mismatch.filter(id => !KNOWN_AIRCRAFT_MISMATCH[id]), [], 'card and mission name different aircraft');
  const fixed = Object.keys(KNOWN_AIRCRAFT_MISMATCH).filter(id => !mismatch.includes(id));
  assert.deepEqual(fixed, [], `fixed — remove from KNOWN_AIRCRAFT_MISMATCH (and close "${KNOWN_AIRCRAFT_MISMATCH[fixed[0]]}")`);
});

/* ── The schemas catch what they're for: typical mistakes injected into real files ── */
const errorsAfter = (file, schema, edit) => { const j = load(file); edit(j); return check(j, schema); };

test('schema catches a misspelled key', () => {
  const errs = errorsAfter('aircraft/c172.json', aircraft, a => { a.vehicletype = a.vehicleType; });
  assert.ok(errs.some(e => e === 'vehicletype: unknown key'), errs.join('\n'));
});
test('schema catches an unknown engine sound', () => {
  const errs = errorsAfter('aircraft/c172.json', aircraft, a => { a.sound.engineType = 'lycoming-0360'; });
  assert.ok(errs.some(e => e.startsWith('sound.engineType: "lycoming-0360" is not one of')), errs.join('\n'));
});
test('schema catches an unknown trigger type', () => {
  const errs = errorsAfter('missions/inspiration5.json', mission, m => { m.atcClearances[0].trigger.type = 'tmie'; });
  assert.ok(errs.some(e => e.startsWith('atcClearances[0].trigger.type: "tmie"')), errs.join('\n'));
});
test('schema catches an "after" trigger pointing nowhere', () => {
  const errs = errorsAfter('missions/inspiration5.json', mission, m => {
    m.atcClearances[13].trigger.idx = m.atcClearances.length;
  });
  assert.ok(errs.some(e => e.includes('atcClearances[13]: "after" trigger needs idx')), errs.join('\n'));
});
test('schema catches a misspelled documentation key', () => {
  const errs = errorsAfter('missions/wolfskopf-1942.json', mission, m => { m.narative = m.narrative; });
  assert.ok(errs.some(e => e === 'narative: unknown key'), errs.join('\n'));
});
test('schema catches a misspelled weather field', () => {
  const errs = errorsAfter('missions/nordmeer-1956.json', mission, m => { m.weather.fallback.visibility = 6000; });
  assert.ok(errs.some(e => e === 'weather.fallback.visibility: unknown key'), errs.join('\n'));
});
test('schema catches a misspelled catalog briefing field', () => {
  const errs = errorsAfter('missions/catalog.json', catalog, c => { c[0].briefing.oders = 'x'; });
  assert.ok(errs.some(e => e === '[0].briefing.oders: unknown key'), errs.join('\n'));
});
test('comment keys (_note) are allowed anywhere', () => {
  const errs = errorsAfter('aircraft/c172.json', aircraft, a => { a._note = 'x'; a.handling._note = 'y'; });
  assert.deepEqual(errs, []);
});
test('glass jets still need a turbofan (rule from the old aircraft-data lint)', () => {
  const errs = errorsAfter('aircraft/a350.json', aircraft, a => { delete a.engine.type; });
  assert.ok(errs.some(e => e.includes('needs engine.type "turbofan"')), errs.join('\n'));
});
test('engine is an object — the old description string fails', () => {
  const errs = errorsAfter('aircraft/c172.json', aircraft, a => { a.engine = 'Lycoming IO-360, 180hp'; });
  assert.ok(errs.some(e => e.startsWith('engine:')), errs.join('\n'));
});
test('the measurements the physics reads are checked (core/airframe.js)', () => {
  const big = errorsAfter('aircraft/b777-300er.json', aircraft, a => { a.dimensions.vstabRudderRootChord = 9000; });
  assert.ok(big.some(e => e.endsWith('the rudder must fit inside the vertical tail')), big.join('\n'));
  const neg = errorsAfter('aircraft/b777-300er.json', aircraft, a => { a.dimensions.engineCenterlineToAircraftCenterline = -9690; });
  assert.ok(neg.some(e => e.endsWith('engineCenterlineToAircraftCenterline must be a positive number (mm)')), neg.join('\n'));
  const share = errorsAfter('aircraft/b777-300er.json', aircraft, a => { a.balance.noseGearLoadShare = 7.57; });
  assert.ok(share.some(e => e.endsWith('noseGearLoadShare must be between 0 and 0.5')), share.join('\n'));
});
test('every winged aircraft declares its engines, with an integer count', () => {
  const none = errorsAfter('aircraft/bf109.json', aircraft, a => { delete a.engine; });
  assert.ok(none.some(e => e.endsWith('an aircraft needs an engine block')), none.join('\n'));
  const half = errorsAfter('aircraft/a340.json', aircraft, a => { a.engine.count = 2.5; });
  assert.ok(half.some(e => e.endsWith('engine.count must be an integer >= 1')), half.join('\n'));
  const kind = errorsAfter('aircraft/c172.json', aircraft, a => { a.engine.type = 'diesel'; });
  assert.ok(kind.some(e => e.startsWith('engine.type: "diesel" is not one of')), kind.join('\n'));
});
