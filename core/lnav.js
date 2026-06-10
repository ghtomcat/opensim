/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/lnav.js
   Lateral navigation (managed NAV / LNAV): steer the aircraft down the flight plan.

   The same buildFullRoute route the briefing studies, the ND draws, and the MCDU lists —
   now flown. lnavTargetHeading() gives the heading to the active waypoint and sequences to
   the next as each is passed; the AP (physics.js) turns that into a commanded bank.

   This is the first *managed* autopilot axis: when S.navManaged is set the lateral channel
   follows the route; otherwise the AP holds the selected FCU heading (S.hdgT).
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { buildFullRoute, getProcedures } from './route.js';

const DEG = Math.PI / 180;
const _gc = (a, b, c, d) => {                              // great-circle nm
  const p1 = a*DEG, p2 = c*DEG, dp = (c-a)*DEG, dl = (d-b)*DEG;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const _brg = (a, b, c, d) => {                             // initial bearing °
  const p1 = a*DEG, p2 = c*DEG, dl = (d-b)*DEG;
  const y = Math.sin(dl)*Math.cos(p2), x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y, x)/DEG + 360) % 360;
};

/* Route legs (coordinate-bearing), cached per mission; the procedure-count is in the key so
   the plan refreshes once the lazy CIFP import lands. Resets the active waypoint on change. */
let _rt = { key: null, legs: null };
function _legs() {
  const dep = S.mission?.departure, arr = S.mission?.arrival;
  const np  = Object.keys(getProcedures()).length;
  const key = `${np}|${dep?.icao}/${dep?.runway}/${dep?.sid}|${arr?.icao}/${arr?.runway}/${arr?.star}`;
  if (key !== _rt.key) {
    _rt.key = key;
    let r = null; try { r = buildFullRoute(dep, arr); } catch {}
    _rt.legs = (r?.legs ?? []).filter(l => l.lat != null);
    if (!_rt.legs.length) _rt.legs = null;
    S.fmsActive = _rt.legs ? 1 : 0;                       // target the first fix, not the departure airport
  }
  return _rt.legs;
}

/* For the displays (ND / MCDU): the cached legs + current active index. */
export function lnavActive() { return { legs: _rt.legs, idx: S.fmsActive ?? 0 }; }

/* Managed-NAV guidance: the heading to fly the flight plan, advancing the active waypoint as
   it is passed (along-track) or reached (turn-anticipation lead). null if no route to fly. */
export function lnavTargetHeading() {
  const legs = _legs();
  if (!legs || legs.length < 2) return null;
  const lat = S.lat, lon = S.lon;
  if (lat == null || lon == null) return null;
  const cos = Math.cos(lat * DEG);
  let i = Math.min(Math.max(1, S.fmsActive ?? 1), legs.length - 1);

  /* lead ≈ 0.35 min of travel — start the turn before the fix, and sequence once passed */
  const lead = Math.max(0.6, Math.min(8, (S.spd ?? 0) / 60 * 0.35));
  while (i < legs.length - 1) {
    const wp = legs[i], pv = legs[i - 1];
    const dist = _gc(lat, lon, wp.lat, wp.lon);
    const toN = lat - wp.lat,     toE = (lon - wp.lon) * cos;    // aircraft relative to the fix
    const inN = wp.lat - pv.lat,  inE = (wp.lon - pv.lon) * cos; // the inbound leg we are flying
    const passed = (toN * inN + toE * inE) > 0;                  // gone beyond the fix along that leg
    if (passed || dist < lead) i++; else break;                 // (don't use the onward leg — sharp turns false-trigger)
  }
  S.fmsActive = i;
  return _brg(lat, lon, legs[i].lat, legs[i].lon);
}
