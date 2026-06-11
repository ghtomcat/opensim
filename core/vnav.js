/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/vnav.js
   Vertical navigation (managed).

   Phase 1 was a stepped profile (level → descend to each constraint). Phase 2 builds the
   real descent path: a ~3° geometric line drawn backward from the runway up through the
   flight-plan altitude constraints, giving a predicted altitude at every fix and a
   Top-of-Descent. vnavTargetAlt() then follows that path (VNAV PTH) instead of stepping —
   still bounded by the FCU cleared altitude (S.altT), so the pilot opens the descent by
   pulling it down, exactly like managed DES on the real aircraft.

   The profile (predicted alt per leg + TOD) is the data the MCDU predictions, the briefing
   profile chart, and the ATC descent loop all read.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { lnavActive } from './lnav.js';
import { altParse }   from './route.js';

const FT_PER_NM = 318;   // ~3° descent gradient (tan 3° × 6076)

function gcNm(aLat, aLon, bLat, bLon) {
  const D = Math.PI / 180;
  const p1 = aLat*D, p2 = bLat*D, dp = (bLat-aLat)*D, dl = (bLon-aLon)*D;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * buildDescentPath(legs, cruiseAlt, fieldElevFt) — pure path geometry.
 * Returns { distToEnd[], predAlt[], todDist } where distToEnd[i] is the along-track distance
 * (nm) from leg i to the destination, predAlt[i] the path altitude there, and todDist the
 * distance-to-go at which the descent begins (the path meets cruise).
 */
export function buildDescentPath(legs, cruiseAlt, fieldElevFt) {
  const n = legs.length;
  if (n < 2) return null;

  const distToEnd = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--)
    distToEnd[i] = distToEnd[i + 1] + gcNm(legs[i].lat, legs[i].lon, legs[i + 1].lat, legs[i + 1].lon);

  /* Walk backward from the runway, climbing at the gradient, clamped by each constraint. */
  const predAlt = new Array(n).fill(0);
  let pathAlt = fieldElevFt;
  predAlt[n - 1] = pathAlt;
  for (let i = n - 2; i >= 0; i--) {
    pathAlt += (distToEnd[i] - distToEnd[i + 1]) * FT_PER_NM;
    const c = altParse(legs[i].alt);
    if (c) {
      if      (c.kind === 'above') pathAlt = Math.max(pathAlt, c.ft);   // floor — at or above
      else if (c.kind === 'below') pathAlt = Math.min(pathAlt, c.ft);   // ceiling — at or below
      else                         pathAlt = c.ft;                      // at
    }
    pathAlt = Math.max(pathAlt, predAlt[i + 1]);   // monotonic — never below a fix closer to the runway
    pathAlt = Math.min(pathAlt, cruiseAlt);        // never above cruise
    predAlt[i] = pathAlt;
  }

  /* TOD = the distance-to-go where the path reaches cruise (interpolated on the gradient). */
  let todDist = distToEnd[0];
  for (let i = n - 1; i >= 0; i--) {
    if (predAlt[i] >= cruiseAlt - 1) {
      if (i < n - 1 && predAlt[i + 1] < cruiseAlt) {
        const frac = (cruiseAlt - predAlt[i + 1]) / ((predAlt[i] - predAlt[i + 1]) || 1);
        todDist = distToEnd[i + 1] + frac * (distToEnd[i] - distToEnd[i + 1]);
      } else todDist = distToEnd[i];
      break;
    }
  }
  return { distToEnd, predAlt, todDist };
}

/** descentProfile() — the live profile for the active route (predicted alt per leg + TOD). */
export function descentProfile() {
  const { legs } = lnavActive() ?? {};
  if (!legs || legs.length < 2) return null;
  const fieldElev = S.mission?.arrival?.elevation ?? 0;                 // mission elevations are in feet
  const cruiseAlt = Math.max(S.alt ?? 0, S.altT ?? 0, S.aircraft?.envelope?.cruiseAlt ?? 0);
  const path = buildDescentPath(legs, cruiseAlt, fieldElev);
  return path && { legs, cruiseAlt, fieldElev, ...path };
}

/* Interpolate the path altitude at a distance-to-go (distToEnd decreases as i increases). */
function pathAltAt(prof, dToGo) {
  const { distToEnd, predAlt } = prof;
  if (dToGo >= distToEnd[0]) return predAlt[0];
  if (dToGo <= 0)            return predAlt[predAlt.length - 1];
  for (let i = 0; i < distToEnd.length - 1; i++) {
    if (dToGo <= distToEnd[i] && dToGo >= distToEnd[i + 1]) {
      const span = (distToEnd[i] - distToEnd[i + 1]) || 1;
      const frac = (dToGo - distToEnd[i + 1]) / span;
      return predAlt[i + 1] + frac * (predAlt[i] - predAlt[i + 1]);
    }
  }
  return predAlt[predAlt.length - 1];
}

/**
 * vnavTargetAlt() → managed target altitude (ft).
 * Climb/hold: the cleared altitude (S.altT). Descent (cleared pulled below us): follow the
 * VNAV PTH path altitude at the aircraft's distance-to-go, never below the cleared altitude.
 */
export function vnavTargetAlt() {
  const cleared = S.altT ?? 35000;
  if (cleared >= (S.alt ?? 0) - 50) return cleared;          // climb or hold to the cleared altitude

  const prof = descentProfile();
  const { legs, idx } = lnavActive() ?? {};
  if (!prof || !legs) return cleared;

  const i = Math.min(Math.max(0, idx ?? 0), legs.length - 1);
  const dToGo = prof.distToEnd[i] + (S.lat != null ? gcNm(S.lat, S.lon, legs[i].lat, legs[i].lon) : 0);
  return Math.max(pathAltAt(prof, dToGo), cleared);          // on the path, but not below cleared
}
