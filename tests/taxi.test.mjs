/**
 * Taxi route — core/taxi.js owns the active taxi route and clearance, so they exist with the
 * map hidden (no display module involved). Uses the bundled Zürich (LSZH) taxiway graph.
 *
 * Run:  node --test tests/taxi.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState } from '../core/state.js';
import { tickTaxi, resetTaxi, clearTaxiIn } from '../core/taxi.js';
import { STANDS } from '../data/stands-data.js';

const stand = STANDS.LSZH.find(s => s.ref === '101');

function atStand(mission) {
  setState({ mission, lat: stand.lat, lon: stand.lon, wow: true, taxiCleared: false, arrivalGate: null });
  resetTaxi();
}

test('departure: route from the stand to the mission runway, and a clearance naming it', () => {
  atStand({ departure: { icao: 'LSZH', runway: '28' }, arrival: { icao: 'LSGG' } });
  tickTaxi();
  assert.ok(S.taxiRoute?.pts?.length > 1, 'route has points');
  assert.equal(S.taxiClearance.rwy, '28');
  assert.equal(S.taxiClearance.arr, false);
  assert.deepEqual(S.taxiClearance.via, S.taxiRoute.seq, 'clearance and green line are one route');
});

test('the route is reused until the aircraft has moved 80 m', () => {
  atStand({ departure: { icao: 'LSZH', runway: '28' }, arrival: { icao: 'LSGG' } });
  tickTaxi();
  const first = S.taxiRoute;
  setState({ lat: stand.lat + 30 / 111120 });            // 30 m north
  tickTaxi();
  assert.equal(S.taxiRoute, first);
  setState({ lat: stand.lat + 200 / 111120 });           // 200 m north
  tickTaxi();
  assert.notEqual(S.taxiRoute, first);
});

test('airborne → no taxi route', () => {
  atStand({ departure: { icao: 'LSZH', runway: '28' }, arrival: { icao: 'LSGG' } });
  tickTaxi();
  setState({ wow: false });
  tickTaxi();
  assert.equal(S.taxiRoute, null);
});

test('arrival: no route until Ground clears the taxi-in, then the cleared route is drawn', () => {
  atStand({ departure: { icao: 'LSGG' }, arrival: { icao: 'LSZH', runway: '14' } });
  tickTaxi();
  assert.equal(S.taxiRoute, null, 'nothing before the clearance');

  const gate = STANDS.LSZH.find(s => s.ref !== '101');
  clearTaxiIn(gate);
  assert.equal(S.taxiClearance.arr, true);
  assert.equal(S.taxiClearance.gate, gate.ref);
  tickTaxi();
  assert.equal(S.taxiRoute, null, 'still hidden until S.taxiCleared');

  setState({ taxiCleared: true, arrivalGate: gate });
  tickTaxi();
  assert.ok(S.taxiRoute?.pts?.length > 1);
  assert.deepEqual(S.taxiClearance.via, S.taxiRoute.seq, 'spoken via = drawn route');
});
