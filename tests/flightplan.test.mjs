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
import { resetFlightPlan, tickFlightPlan, setActiveLeg, setArrivalRunway, planFor } from '../core/flightplan.js';
import { buildFullRoute, getProcedures } from '../core/route.js';

const DEP = { icao: 'LSZH', runway: '28' };
const ARR = { icao: 'LSGG', runway: '04' };

function load(departure = DEP, arrival = ARR) {
  setState({ mission: { departure, arrival } });
  resetFlightPlan();
}

test('built from the mission on load, targeting the first fix', () => {
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
  load();
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
