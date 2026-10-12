/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/lifecycle.js
   Mission reset registry. A module with per-mission state registers
   its reset once (onMissionReset); loadMission runs them all after
   the new aircraft and mission are in S. Resets must not depend on
   each other's order.
   ═══════════════════════════════════════════════════════════════ */

const _resets = [];

/** Register fn to run on every mission load (after S.aircraft / S.mission are set). */
export function onMissionReset(fn) {
  _resets.push(fn);
}

/** Run every registered reset — called by loadMission. */
export function runMissionResets() {
  for (const fn of _resets) fn();
}
