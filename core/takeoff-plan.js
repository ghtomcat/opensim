/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/takeoff-plan.js
   The takeoff plan of a mission — one source for the briefing page's
   Departure block and the kneeboard's TAKEOFF page, so the two never
   disagree (and no speed is typed by hand into a kneeboard).

   The speeds from core/takeoff-perf.js, the lineup (an intersection, the
   runway ahead) from core/taxi.js. Thrust: TOGA — the sim has no FLEX yet.
   ═══════════════════════════════════════════════════════════════ */

import { takeoffSpeeds } from './takeoff-perf.js';
import { departureLineup } from './taxi.js';

/**
 * The plan for a takeoff mission (it starts on the ground, `initialState.spd === 0`) of an aircraft with
 * computed speeds — or null. `{ rwy, at, aheadM, lengthM, massT, flaps, thrust, v1, vr, v2 }`, speeds in kt
 * rounded; the lineup fields are null where the airport has no runway data (the runway then the mission's).
 */
export function takeoffPlan(mission, aircraft) {
  if (mission?.initialState?.spd !== 0) return null;
  const sp = takeoffSpeeds(aircraft);
  if (sp?.flaps == null) return null;
  let lu = null;
  try { lu = departureLineup(mission, aircraft); } catch (e) { console.warn('[takeoff-plan] lineup', e); }
  const f = aircraft.flaps?.[sp.flaps];
  return {
    rwy:     lu?.rwy ?? mission.start?.runway ?? mission.departure?.runway ?? null,
    at:      lu?.at ?? null,
    aheadM:  lu?.aheadM ?? null,
    lengthM: lu?.lengthM ?? null,
    massT:   aircraft.performance?.mass != null ? aircraft.performance.mass / 1000 : null,
    flaps:   String(f?.label ?? f?.deg ?? sp.flaps),
    thrust:  'TOGA',
    v1: Math.round(sp.v1), vr: Math.round(sp.vr), v2: Math.round(sp.v2),
  };
}
