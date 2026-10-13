/**
 * Flight plan — core/flightplan.js owns the active plan (S.flightPlan): built from the mission,
 * rebuilt when the mission's departure/arrival change, amended in flight, reset on mission load.
 * Works with or without the (gitignored) CIFP procedure bundle: expectations are stated against
 * buildFullRoute() for the same inputs.
 *
 * Run:  node --test tests/flightplan.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState } from '../core/state.js';
import { resetFlightPlan, tickFlightPlan, setActiveLeg, setArrivalRunway, planFor, legAt } from '../core/flightplan.js';
import { buildFullRoute, getProcedures } from '../core/route.js';

const DEP = { icao: 'LSZH', runway: '28' };
const ARR = { icao: 'LSGG', runway: '04' };

/* Loads on the ground at the departure (the first fix is active), unless a pose is given. */
function load(departure = DEP, arrival = ARR, pose = { wow: true, lat: 47.46, lon: 8.55, hdg: 280 }) {
  setState({ mission: { departure, arrival }, ...pose });
  resetFlightPlan();
}

test('built from the mission on load; on the ground the first fix is active', () => {
  load();
  const fp = S.flightPlan, r = buildFullRoute(DEP, ARR);
  assert.ok(fp?.legs?.length >= 2, 'plan has legs');
  assert.deepEqual(fp.legs, r.legs);
  assert.equal(fp.legs[0].seg, 'dep');
  assert.equal(fp.legs.at(-1).seg, 'arr');
  assert.equal(fp.activeIdx, 1);
  assert.deepEqual(fp.arr, ARR);
});

test('no plan without a departure and arrival', () => {
  load(null, null);
  assert.equal(S.flightPlan, null);
});

test('setActiveLeg moves the active waypoint, clamped to the plan', () => {
  load();
  setActiveLeg(2);
  assert.equal(S.flightPlan.activeIdx, 2);
  setActiveLeg(999);
  assert.equal(S.flightPlan.activeIdx, S.flightPlan.legs.length - 1);
});

test('a changed mission departure/arrival rebuilds the plan on the next tick', () => {
  load();                                                  // still on the ground
  setState({ mission: { departure: DEP, arrival: { icao: 'EDDM', runway: '26R' } } });
  tickFlightPlan();
  assert.equal(S.flightPlan.legs.at(-1).id, 'EDDM');
  assert.equal(S.flightPlan.activeIdx, 1);
});

test('setArrivalRunway amends the plan: new runway, same route as building it fresh', () => {
  load();
  setArrivalRunway('22');
  assert.equal(S.flightPlan.arr.runway, '22');
  assert.deepEqual(S.flightPlan.legs, buildFullRoute(DEP, { ...ARR, runway: '22' }).legs);
  tickFlightPlan();                                        // the amendment survives the tick
  assert.equal(S.flightPlan.arr.runway, '22');
  assert.equal(S.mission.arrival.runway, '04', 'the mission itself is not changed');
});

test('an amendment keeps the active waypoint if the new plan still has it', () => {
  load();
  const i = 1, id = S.flightPlan.legs[i].id;               // the first fix after departure
  setActiveLeg(i);
  setArrivalRunway('22');
  assert.equal(S.flightPlan.legs[S.flightPlan.activeIdx].id, id);
});

test('mission load drops amendments', () => {
  load();
  setArrivalRunway('22');
  resetFlightPlan();
  assert.equal(S.flightPlan.arr.runway, '04');
});

test('planFor gives the same route for a mission that is not loaded', () => {
  load();
  const other = { icao: 'EDDM', runway: '26R' };
  assert.deepEqual(planFor(DEP, other).legs, buildFullRoute(DEP, other).legs);
  assert.equal(planFor(DEP, other), planFor(DEP, other), 'cached');
  assert.equal(S.flightPlan.legs.at(-1).id, 'LSGG', 'the active plan is untouched');
});

/* With the CIFP bundle (gitignored, local only): a runway change re-routes the approach.
   Skipped without the bundle. */
test('with the procedures, a new arrival runway re-routes the approach', async (t) => {
  load();
  const t0 = Date.now();
  while (!getProcedures().LSGG && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 25));
  if (!getProcedures().LSGG) { t.skip('CIFP procedure bundle not present'); return; }
  tickFlightPlan();
  assert.equal(S.flightPlan.appr, 'I04');
  const end04 = S.flightPlan.legs.at(-1);
  setArrivalRunway('22');
  assert.equal(S.flightPlan.appr, 'I22');
  assert.notDeepEqual(S.flightPlan.legs.at(-1), end04, 'ends at the other threshold');
});

/* ── Airborne start: the leg being flown (legAt) ──
   A synthetic route along the equator, east then back west a little north:
     0 (0,0) → 1 (0,1) → 2 (0,2) → 3 (0.1,2) → 4 (0.1,1) → 5 (0.1,0)
   Legs 1–2 (eastbound) and 4–5 (westbound) run 6 nm apart, flown in opposite directions. */
const P = [[0, 0], [0, 1], [0, 2], [0.1, 2], [0.1, 1], [0.1, 0]].map(([lat, lon], i) => ({ lat, lon, id: 'F' + i }));

test('legAt: mid-leg, heading along it → the end of that leg', () => {
  assert.equal(legAt(P, 0.0, 0.5, 90), 1);
  assert.equal(legAt(P, 0.0, 1.5, 90), 2);
});

test('legAt: between two legs flown opposite ways, the heading decides', () => {
  assert.equal(legAt(P, 0.05, 0.5, 90), 1, 'eastbound → the eastbound leg');
  assert.equal(legAt(P, 0.05, 0.5, 270), 5, 'westbound → the westbound leg');
});

test('legAt: just before a leg starts, that leg', () => {
  assert.equal(legAt(P, 0.0, -0.05, 90), 1);              // 3 nm before F0, heading east
});

test('legAt: off every leg → the nearest fix ahead', () => {
  assert.equal(legAt(P, 1.0, 1.9, 180), 3);                // ~54 nm north of F3, heading south: F3 is the nearest fix ahead
  assert.equal(legAt(P, 1.0, 1.9, 0), 1, 'nothing ahead → the first fix');
});

test('airborne mission start: the plan begins at the leg being flown', () => {
  const fp0 = (load(), S.flightPlan);                      // reference plan on the ground
  const k = Math.floor(fp0.legs.length / 2), a = fp0.legs[k - 1], b = fp0.legs[k];
  const lat = (a.lat + b.lat) / 2, lon = (a.lon + b.lon) / 2;
  const hdg = (Math.atan2((b.lon - a.lon) * Math.cos(lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
  load(DEP, ARR, { wow: false, lat, lon, hdg });
  assert.equal(S.flightPlan.activeIdx, k);
});
