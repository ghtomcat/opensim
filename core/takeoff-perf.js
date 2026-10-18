/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/takeoff-perf.js
   Takeoff speeds for the takeoff about to be flown.

   Interim: V1 = VR from the aircraft data (performance.Vr). In real
   operations V1 is worked out for every takeoff (weight, runway, wind,
   temperature, flaps, thrust) — the balanced field. That calculation
   comes here: issues.md "Takeoff performance: V1, VR, V2 per takeoff".
   Readers ask this module, so they don't change when it does.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

/** V1 in kt IAS, or null when the aircraft has no VR. */
export function v1(ac = S.aircraft) {
  return ac?.performance?.Vr ?? null;
}
