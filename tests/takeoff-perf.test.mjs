/**
 * Takeoff speeds (core/takeoff-perf.js, stage 1): VR and V2 from the aircraft's own lift for the
 * transport-category aircraft (performance.takeoffFlaps), the handbook's fixed Vr for the rest; and the
 * crew's callouts at those speeds (core/crew.js, resolveTakeoffCallouts).
 *
 * Run:  node --test tests/takeoff-perf.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { takeoffSpeeds, takeoffFlapIndex, takeoffMarks, runwayAvailableM, v1, vr } from '../core/takeoff-perf.js';
import { resolveTakeoffCallouts, takeoffCalloutsCrossed } from '../core/crew.js';

const ac = id => JSON.parse(fs.readFileSync(new URL(`../aircraft/${id}.json`, import.meta.url)));
const JETS = ['a220', 'a340', 'a350', 'b737', 'b737max9', 'b777-300er', 'e190', 'an225', 'tu95'];

test('every transport-category aircraft declares its takeoff flaps — and has no fixed Vr left', () => {
  for (const id of JETS) {
    const a = ac(id);
    assert.ok(takeoffFlapIndex(a) > 0, `${id}: takeoffFlaps`);
    assert.equal(a.performance.Vr, undefined, `${id}: Vr is computed now`);
  }
});

test('the speeds are in order: VS < VR < VLOF < V2, and V2 ≥ 1.13 VS', () => {
  for (const id of JETS) {
    const s = takeoffSpeeds(ac(id));
    assert.ok(s.vs < s.vr && s.vr < s.vlof && s.vlof < s.v2, `${id}: ${JSON.stringify(s)}`);
    assert.ok(s.v2 >= 1.13 * s.vs - 1e-9, id);
    assert.equal(s.v1, s.vr, `${id}: stage 1 — V1 = VR`);
  }
});

test('the 777 at 220 t, flaps 5: VR in the 140s — the speed its physics lifts off from (probed 2026-11-24)', () => {
  const s = takeoffSpeeds(ac('b777-300er'));
  assert.ok(s.vr > 138 && s.vr < 150, `VR ${s.vr}`);
  assert.ok(s.v2 > 150 && s.v2 < 165, `V2 ${s.v2}`);
});

test('the A340 at 200 t, CONF 2: VR near the crews\' 130 kt (PPRuNe, 2010) — within 6 kt', () => {
  const a = ac('a340');
  assert.equal(a.flaps[takeoffFlapIndex(a)].label, '2');
  assert.ok(Math.abs(vr(a) - 130) <= 6, `VR ${vr(a)}`);
});

test('heavier → faster; more flap → slower', () => {
  const a = ac('b777-300er');
  const heavy = { ...a, performance: { ...a.performance, mass: a.performance.mass * 1.2 } };
  const flap20 = { ...a, performance: { ...a.performance, takeoffFlaps: 2 } };
  assert.ok(vr(heavy) > vr(a));
  assert.ok(Math.abs(takeoffSpeeds(heavy).vlof / takeoffSpeeds(a).vlof - Math.sqrt(1.2)) < 1e-9, 'VLOF goes with √mass');
  assert.ok(vr(flap20) < vr(a));
});

test('a light aircraft and a warbird keep their handbook Vr', () => {
  assert.equal(vr(ac('c172')), 55);
  assert.equal(v1(ac('c172')), 55);
  assert.equal(vr(ac('bf109')), 120);
  assert.equal(takeoffSpeeds(ac('c172')).v2, null);
});

test('the PFD marks: on the ground of a takeoff mission only, and only for computed speeds', () => {
  const a = ac('b777-300er');
  const takeoff = { mission: { initialState: { spd: 0 } } };
  assert.ok(takeoffMarks(a, { ...takeoff, wow: true }));
  assert.equal(takeoffMarks(a, { ...takeoff, wow: false }), null);                                 // airborne
  assert.equal(takeoffMarks(a, { mission: { initialState: { spd: 160 } }, wow: true }), null);    // an approach's rollout
  assert.equal(takeoffMarks(ac('c172'), { ...takeoff, wow: true }), null);
});

test('the runway ahead: an intersection route\'s remaining length, else the runway\'s', () => {
  assert.equal(runwayAvailableM({}, { remainingM: 2675 }), 2675);
  const lszh = runwayAvailableM({ departure: { icao: 'LSZH', runway: '16' } }, null);
  assert.ok(lszh > 3500 && lszh < 3800, `LSZH 16: ${lszh} m`);        // 3,700 m
});

/* ── The callouts ── */
const AIRBUS = [{ spd: 100, speech: 'one hundred knots', voice: 'pm' },
                { at: 'v1', speech: 'V one', voice: 'pm' }, { at: 'vr', speech: 'rotate', voice: 'pm' }];

test('callouts at the computed speeds; V1 = VR is one call, "V one, rotate"', () => {
  const r = resolveTakeoffCallouts(AIRBUS, { v1: 144.2, vr: 144.2, v2: 159 });
  assert.deepEqual(r.map(c => [c.spd, c.speech, c.key]), [[100, 'one hundred knots', 100], [144.2, 'V one, rotate', 'v1']]);
});

test('V1 below VR: two calls', () => {
  const r = resolveTakeoffCallouts(AIRBUS, { v1: 138, vr: 144, v2: 159 });
  assert.deepEqual(r.map(c => c.speech), ['one hundred knots', 'V one', 'rotate']);
});

test('a takeoff speed the aircraft doesn\'t have is skipped', () => {
  assert.deepEqual(resolveTakeoffCallouts([{ at: 'v2', speech: 'V two' }], { v1: 55, vr: 55, v2: null }), []);
});

test('the roll: passing the computed V1 says "V one, rotate" once', () => {
  const r = resolveTakeoffCallouts(AIRBUS, { v1: 144.2, vr: 144.2 });
  const said = takeoffCalloutsCrossed(r, 143.9, 144.5, true, 144.2).filter(c => c.speak).map(c => c.speech);
  assert.deepEqual(said, ['V one, rotate']);
  assert.deepEqual(takeoffCalloutsCrossed(r, 143.9, 144.5, true, 144.2, new Set(['v1'])), []);
});

/* ── The lineup for the briefing (core/taxi.js, departureLineup) ── */
import { departureLineup } from '../core/taxi.js';
const mission = id => JSON.parse(fs.readFileSync(new URL(`../missions/${id}.json`, import.meta.url)));

test('FIMP from stand 10: an intersection departure at A, 2,675 m of 3,367 ahead', () => {
  const l = departureLineup(mission('fimp-takeoff'), ac('a340'));
  assert.equal(l.rwy, '14');
  assert.equal(l.at, 'A');
  assert.ok(Math.abs(l.aheadM - 2675) < 15, `ahead ${l.aheadM}`);
  assert.ok(Math.abs(l.lengthM - 3367) < 15, `length ${l.lengthM}`);
});

test('LSGG from a stand reaches the threshold: the full length; a runway start lines up where it stands', () => {
  const g = departureLineup(mission('lsgg-takeoff'), ac('e190'));
  assert.equal(g.at, null);
  assert.equal(g.aheadM, g.lengthM);
  const h = departureLineup(mission('hostomel-2022'), ac('an225'));
  assert.equal(h.rwy, '15');
  assert.equal(h.at, null);
});

/* ── The takeoff plan (core/takeoff-plan.js) — the briefing's Departure block and the kneeboard's TAKEOFF DATA ── */
import { takeoffPlan } from '../core/takeoff-plan.js';

test('the plan: FIMP — runway 14 at A, 200 t, flaps 2, TOGA, V1 = VR, V2 above', () => {
  const p = takeoffPlan(mission('fimp-takeoff'), ac('a340'));
  assert.equal(p.rwy, '14');
  assert.equal(p.at, 'A');
  assert.equal(p.massT, 200);
  assert.equal(p.flaps, '2');
  assert.equal(p.thrust, 'TOGA');
  assert.equal(p.v1, p.vr);
  assert.ok(p.v2 > p.vr);
});

test('the plan without runway data: the speeds, the mission\'s runway, no lineup (Olenya, the Tu-95)', () => {
  const p = takeoffPlan(mission('nordmeer-1956'), ac('tu95'));
  assert.equal(p.rwy, '01');
  assert.equal(p.aheadM, null);
  assert.ok(p.vr > 150);
});

test('no plan for an approach, or for an aircraft with the handbook\'s Vr', () => {
  assert.equal(takeoffPlan(mission('lszh-approach'), ac('a350')), null);
  assert.equal(takeoffPlan({ initialState: { spd: 0 }, departure: { icao: 'LSZF', runway: '08' } }, ac('c172')), null);
});
