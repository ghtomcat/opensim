/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/taxi.js
   The active taxi route — one owner for the green map line, the ATC
   taxi clearance and the pushback path.

   On the ground at a mission airport:
     departure → route to the mission's runway (else the nearest threshold)
     arrival   → route to the assigned gate, once Ground clears the taxi-in
   Recomputed when the aircraft has moved > 80 m, the airport or the goal
   changes. Publishes S.taxiRoute ({ pts, seq, distM }) and S.taxiClearance.

   display/map.js draws S.taxiRoute; display/com.js phrases S.taxiClearance
   (and calls clearTaxiIn() for the arrival); physics captures the pushback
   path from S.taxiRoute.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { RUNWAYS } from '../data/runways-data.js';
import { getTaxiGraph, routeTaxi, routeTaxiToRunway, nearestStand } from './taxi-graph.js';
import { onMissionReset } from './lifecycle.js';
import { resolveStart } from './mission-start.js';

let _from = null, _key = null, _route = null;   // last route: start point, 'ICAO|goal' key

const _nmd = (la1, lo1, la2, lo2) => {
  const dN = (la1 - la2) * 60, dE = (lo1 - lo2) * 60 * Math.cos(la1 * Math.PI / 180);
  return Math.hypot(dN, dE);
};

export function resetTaxi() {
  _from = null; _key = null; _route = null;
  setState({ taxiRoute: null, taxiClearance: null });
}
onMissionReset(resetTaxi);

/* The mission airport the aircraft is at (within 6 NM of its runway centre), or null. */
function _airportHere(lat, lon) {
  const m = S.mission;
  let icao = null, ctr = null, bd = 1e9;
  for (const ic of [m?.departure?.icao, m?.arrival?.icao]) {
    const rw = ic && RUNWAYS[ic]; if (!rw) continue;
    const pts = rw.flatMap(r => [r.a, r.b]);
    const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const d = _nmd(lat, lon, c[0], c[1]); if (d < bd) { bd = d; icao = ic; ctr = c; }
  }
  return icao && bd <= 6 ? { icao, ctr } : null;
}

/* Departure goal: the mission's runway threshold, else the nearest one — with the
   runway's far end (`end`), the direction of the takeoff run. */
function _departureGoal(icao, lat, lon, mission = S.mission) {
  const goal = (e, f, id) => ({ lat: e[0], lon: e[1], rwy: id, end: { lat: f[0], lon: f[1] } });
  const want = String(mission?.departure?.runway || '').toUpperCase();
  if (want) for (const r of RUNWAYS[icao]) {
    if ((r.leId || '').toUpperCase() === want) return goal(r.a, r.b, r.leId);
    if ((r.heId || '').toUpperCase() === want) return goal(r.b, r.a, r.heId);
  }
  let best = null, bdd = 1e9;
  for (const r of RUNWAYS[icao]) for (const [e, f, id] of [[r.a, r.b, r.leId], [r.b, r.a, r.heId]]) {
    const d = _nmd(lat, lon, e[0], e[1]); if (d < bdd) { bdd = d; best = goal(e, f, id); }
  }
  return best;
}

/**
 * The takeoff's lineup before the flight — for the briefing (no S): the runway, its length, where the aircraft
 * lines up and the runway ahead of it. From a stand: the departure route's end — the threshold, or an
 * intersection where the taxiways don't reach it (`at`: the taxiway, FIMP 14 at A). A mission that starts on
 * its runway (`start.runway`) lines up there, the full length ahead. null without the runway in the data.
 *   → { icao, rwy, lengthM, aheadM, at }
 */
export function departureLineup(mission, aircraft) {
  const icao = mission?.start?.icao || mission?.departure?.icao;
  if (!icao || !RUNWAYS[icao]) return null;
  const pos = resolveStart(mission, aircraft)
           ?? (mission.initialState?.lat != null ? { lat: mission.initialState.lat, lon: mission.initialState.lon } : null);
  if (!pos) return null;
  const onRwy = mission.start?.runway != null;                           // lined up already — on that runway
  const g = _departureGoal(icao, pos.lat, pos.lon, onRwy ? { departure: { runway: mission.start.runway } } : mission);
  if (!g) return null;
  const lengthM = _nmd(g.lat, g.lon, g.end.lat, g.end.lon) * 1852;
  if (onRwy) return { icao, rwy: g.rwy, lengthM, aheadM: lengthM, at: null };
  const graph = getTaxiGraph(icao, pos.lat, pos.lon);
  const rt = graph ? routeTaxiToRunway(graph, pos, g, g.end) : null;
  return { icao, rwy: g.rwy, lengthM, aheadM: rt?.remainingM ?? lengthM, at: rt?.remainingM != null ? rt.intersection : null };
}

/* Route from the aircraft to goal, reusing the last one unless it's stale. */
function _routeTo(icao, graph, lat, lon, goal) {
  const key = `${icao}|${goal.lat},${goal.lon}`;
  const moved = !_from || _nmd(lat, lon, _from[0], _from[1]) * 1852 > 80;
  if (moved || key !== _key) {
    _route = goal.end ? routeTaxiToRunway(graph, { lat, lon }, goal, goal.end)   // departure: threshold, else an intersection
                      : routeTaxi(graph, { lat, lon }, goal);
    _from = [lat, lon]; _key = key;
    return true;
  }
  return false;
}

/* Arrival: Ground clears the taxi-in to gate g — route to it now, so the clearance
   names the taxiways; the same route is drawn once S.taxiCleared is set. */
export function clearTaxiIn(g) {
  const icao = S.mission?.arrival?.icao;
  if (!g || !icao) return;
  const graph = getTaxiGraph(icao, S.lat, S.lon);
  if (graph) _routeTo(icao, graph, S.lat, S.lon, { lat: g.lat, lon: g.lon });
  const rt = graph ? _route : null;
  setState({ taxiClearance: { icao, arr: true, gate: g.ref, via: rt?.seq ?? [], distM: rt?.distM } });
}

/* Once per sim tick. */
export function tickTaxi() {
  if (!S.wow) { if (S.taxiRoute) setState({ taxiRoute: null }); _key = null; return; }   // airborne → no taxi routing
  const here = _airportHere(S.lat, S.lon);
  if (!here) { if (S.taxiRoute) setState({ taxiRoute: null }); _key = null; return; }
  const { icao, ctr } = here;
  const graph = getTaxiGraph(icao, ctr[0], ctr[1]);
  if (!graph) return;                                    // still loading

  const m = S.mission;
  const isArr = m?.arrival?.icao === icao && m?.departure?.icao !== icao;
  if (isArr && !S.taxiCleared) { if (S.taxiRoute) setState({ taxiRoute: null }); return; }   // no route until Ground clears the taxi-in

  let goal = null;
  if (isArr) { const g = S.arrivalGate || nearestStand(graph, S.lat, S.lon); if (g) goal = { lat: g.lat, lon: g.lon }; }
  if (!goal) goal = _departureGoal(icao, S.lat, S.lon);
  if (!goal) { if (S.taxiRoute) setState({ taxiRoute: null }); return; }

  if (_routeTo(icao, graph, S.lat, S.lon, goal) && _route?.seq?.length) {
    setState({ taxiClearance: { icao, via: _route.seq, distM: _route.distM, arr: isArr,
                                rwy: isArr ? null : goal.rwy, at: _route.intersection ?? null, gate: isArr ? (S.arrivalGate?.ref ?? null) : null } });
  }
  if (S.taxiRoute !== _route) setState({ taxiRoute: _route });
}
