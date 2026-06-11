/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/vnav.js
   Vertical navigation (managed) — Phase 1: the autopilot flies the altitude profile.

   The vertical twin of LNAV. Where LNAV gives the heading to the active waypoint, VNAV gives
   the target altitude: climb to the cleared altitude, hold it, and in the descent step down
   through the flight-plan constraints we already parse (≥FL260, ≤15000, 8000, … → field).
   physics.js turns that target into a commanded pitch (the manual-control jets had no pitch
   autopilot, just like they had no roll one before LNAV).

   Phase 1 is a *stepped* profile (level segments + descents to each constraint), bounded by
   the FCU cleared altitude (S.altT) — pull it down to open the descent, exactly like the real
   thing. Phase 2 will add the smooth idle path (top-of-descent, VNAV PTH).
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { lnavActive } from './lnav.js';
import { altParse }   from './route.js';

/* Managed vertical target altitude (ft). The FCU altitude (S.altT) is the cleared altitude:
   above us → climb/hold to it (any at-or-above floors are met on the way up); at or below us
   → the descent is open, so step down to the next flight-plan constraint, never below cleared. */
export function vnavTargetAlt() {
  const cleared = S.altT ?? 35000;
  if (cleared >= S.alt - 50) return cleared;            // climb or hold to the cleared altitude

  /* descending: the next constraint below us, from the active waypoint onward */
  const { legs, idx } = lnavActive();
  let con = null;
  if (legs) {
    for (let j = Math.max(0, idx); j < legs.length; j++) {
      const a = altParse(legs[j].alt);
      if (a && a.ft < S.alt - 50) { con = a.ft; break; }
    }
  }
  return con != null ? Math.max(con, cleared) : cleared; // step to it, but not below the cleared altitude
}
