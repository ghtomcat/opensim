/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/flightplan.js
   The active flight plan — one owner for LNAV, VNAV, managed speed,
   the ND and the MCDU.

   Built from the mission's departure / arrival on mission load, and
   rebuilt when the lazy CIFP procedures land or the mission's
   departure / arrival change. Publishes S.flightPlan:
     { legs, distNm, sid, star, appr, missed, dep, arr, activeIdx }
   (the buildFullRoute result + the inputs it was built from + the
   active waypoint the LNAV sequencer flies to).

   Amendments (setArrivalRunway) rebuild the plan from amended inputs;
   the active waypoint is kept if the new plan still has it.

   The active waypoint on a fresh plan: on the ground, the first fix;
   airborne (a mission that starts mid-route or on approach), the end
   of the leg the aircraft is flying (legAt).

   planFor(dep, arr) is the same route for a mission that isn't loaded
   (the pre-flight briefing). This module is the only caller of
   buildFullRoute().
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { buildFullRoute, getProcedures } from './route.js';
import { onMissionReset } from './lifecycle.js';

let _dep = null, _arr = null;   // plan inputs (the mission's, possibly amended)
let _procs = null;              // procedure bundle the plan was built with
let _srcKey = null;             // mission departure/arrival the inputs came from

const _key = (dep, arr) =>
  `${dep?.icao}/${dep?.runway}/${dep?.sid}|${arr?.icao}/${arr?.runway}/${arr?.star}`;

const DEG = Math.PI / 180;
const BEFORE_NM   = 5;    // a leg can be joined up to this far before its start fix
const MAX_OFF_NM  = 15;   // … and up to this far off its line; further off, the aircraft isn't on it
const NM_PER_DEG  = 1/3;  // heading penalty: 30° off the leg's track counts like 10 nm off its line

/** The active waypoint for an aircraft at lat/lon on heading hdg (true °): the end fix of the
    leg it is flying — along the leg (or just before it), near and closest to its line, heading most
    nearly along it (so a leg flown the other way nearby doesn't win). Off every leg: the
    nearest fix ahead; else 1. Flat-earth around the aircraft, nm. */
export function legAt(legs, lat, lon, hdg) {
  if (!legs || legs.length < 2) return 0;
  const cos = Math.cos(lat * DEG);
  const xy  = (l) => [(l.lon - lon) * 60 * cos, (l.lat - lat) * 60];   // east, north of the aircraft
  const dHdg = (trk) => Math.abs(((hdg - trk + 540) % 360) - 180);
  let best = null;
  for (let i = 1; i < legs.length; i++) {
    const [ax, ay] = xy(legs[i - 1]), [bx, by] = xy(legs[i]);
    const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey);
    if (len < 0.01) continue;
    const along = (-ax * ex - ay * ey) / len;                // aircraft's position along the leg from its start
    if (along < -BEFORE_NM || along > len) continue;
    const off = Math.abs(-ax * ey + ay * ex) / len;          // distance off the leg's line
    if (off > MAX_OFF_NM) continue;
    const trk = (Math.atan2(ex, ey) / DEG + 360) % 360;
    const score = off + dHdg(trk) * NM_PER_DEG;
    if (!best || score < best.score) best = { i, score };
  }
  if (best) return best.i;
  let ahead = null;
  for (let i = 1; i < legs.length; i++) {
    const [x, y] = xy(legs[i]), d = Math.hypot(x, y);
    const brg = (Math.atan2(x, y) / DEG + 360) % 360;
    if (dHdg(brg) < 90 && (!ahead || d < ahead.d)) ahead = { i, d };
  }
  return ahead ? ahead.i : 1;
}

function _route(dep, arr) {
  try { return buildFullRoute(dep, arr); } catch { return null; }
}

/* Rebuild from the current inputs. keep: hold the active waypoint (by id) if it survives. */
function _build(keep) {
  _procs = getProcedures();
  const r = _route(_dep, _arr);
  if (!r?.legs?.length) { setState({ flightPlan: null }); return; }
  let idx = -1;
  const prev = keep && S.flightPlan;
  if (prev) {                                              // keep the active waypoint if it survives
    const id = prev.legs[prev.activeIdx]?.id;
    if (id) idx = r.legs.findIndex((l, k) => k >= 1 && l.id === id);
  }
  if (idx < 1) idx = (S.wow || S.lat == null || S.lon == null)
    ? 1                                                    // on the ground: the first fix
    : legAt(r.legs, S.lat, S.lon, S.hdg ?? 0);              // airborne: the leg being flown
  setState({ flightPlan: { ...r, dep: _dep, arr: _arr, activeIdx: Math.min(idx, r.legs.length - 1) } });
}

/* Inputs from the mission; amendments are dropped. */
function _fromMission() {
  const m = S.mission;
  _dep = m?.departure ? { ...m.departure } : null;
  _arr = m?.arrival   ? { ...m.arrival }   : null;
  _srcKey = _key(m?.departure, m?.arrival);
  _build(false);
}

export function resetFlightPlan() { _fromMission(); }
onMissionReset(resetFlightPlan);

/** Per tick: rebuild when the procedures land or the mission's departure/arrival change. */
export function tickFlightPlan() {
  if (_key(S.mission?.departure, S.mission?.arrival) !== _srcKey) _fromMission();
  else if (getProcedures() !== _procs) _build(true);
}

/** The LNAV sequencer moved to waypoint i. */
export function setActiveLeg(i) {
  const fp = S.flightPlan;
  if (!fp || i === fp.activeIdx) return;
  setState({ flightPlan: { ...fp, activeIdx: Math.max(0, Math.min(i, fp.legs.length - 1)) } });
}

/** Amendment: a new arrival runway (ATC re-clearance). The STAR/approach follow it. */
export function setArrivalRunway(rwy) {
  if (!_arr) return;
  _arr = { ..._arr, runway: String(rwy) };
  _build(true);
}

/* Briefing: the route for a mission that may not be loaded. One-entry cache. */
let _preview = { key: null, procs: null, r: null };
export function planFor(dep, arr) {
  const key = _key(dep, arr), procs = getProcedures();
  if (key !== _preview.key || procs !== _preview.procs) _preview = { key, procs, r: _route(dep, arr) };
  return _preview.r;
}
