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

function _route(dep, arr) {
  try { return buildFullRoute(dep, arr); } catch { return null; }
}

/* Rebuild from the current inputs. keep: hold the active waypoint (by id) if it survives. */
function _build(keep) {
  _procs = getProcedures();
  const r = _route(_dep, _arr);
  if (!r?.legs?.length) { setState({ flightPlan: null }); return; }
  let idx = 1;                                             // first fix, not the departure airport
  const prev = keep && S.flightPlan;
  if (prev) {
    const id = prev.legs[prev.activeIdx]?.id;
    const j  = id ? r.legs.findIndex((l, k) => k >= 1 && l.id === id) : -1;
    if (j >= 1) idx = j;
  }
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
