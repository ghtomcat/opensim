/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/takeoff-perf.js
   Takeoff speeds for the takeoff about to be flown.

   Stage 1 (2026-11-24): VR and V2 from the aircraft's own lift, so the
   speeds, the physics and the callouts agree:
     VS    1-g stall speed in the takeoff flaps (CL_max + the flap's dCL_max)
     VLOF  where the lift at the liftoff attitude (LIFTOFF_PITCH_DEG, the
           flap's dCL_0 included) carries the weight — the speed the
           physics lifts off at (probed: the 777 rotated at 130/140/150 kt
           lifted off at 146/152/160)
     VR    VLOF − ROTATION_KT: the rotation takes ~10 kt of the run
     V2    the higher of 1.13 · VS (CS/FAR 25.107) and VLOF + 5
     V1    = VR until stage 2 works out the balanced field from the
           physics (issues.md "Takeoff performance: V1, VR, V2 per takeoff")
   Weight is the fixed performance.mass — the jets carry no fuel or load yet.
   Computed for the transport-category aircraft — those that declare their
   takeoff flaps (performance.takeoffFlaps). A light aircraft or a warbird
   rotates at the fixed speed of its handbook: performance.Vr, as before.

   Readers ask this module (the physics' rotation gate, the crew's
   callouts, the "at V1" failure, the PFD), so they don't change when the
   calculation does.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { RUNWAYS } from '../data/runways-data.js';

export const LIFTOFF_PITCH_DEG = 10;   // the attitude at liftoff — airliners lift off at ~8–11° (tail-strike margin)
export const ROTATION_KT       = 10;   // VR → VLOF in the sim's rotation
const RHO0 = 1.225, G = 9.81, KT = 0.5144;

/** The takeoff flap setting: an index into `flaps` (performance.takeoffFlaps), or null when not declared. */
export function takeoffFlapIndex(ac = S.aircraft) {
  const fi = ac?.performance?.takeoffFlaps;
  if (fi == null) return null;
  return Math.max(0, Math.min((ac.flaps?.length ?? 1) - 1, fi));
}

/** VS, VLOF, VR, V2, V1 in kt IAS for the aircraft's takeoff (computed, or the fixed Vr) — or null without either. */
export function takeoffSpeeds(ac = S.aircraft) {
  const p = ac?.performance;
  if (!p) return null;
  const fi = takeoffFlapIndex(ac);
  if (fi == null || !(p.wingArea > 0 && p.mass > 0)) {           // the handbook's fixed VR
    const vr = p.Vr ?? null;
    return vr == null ? null : { flaps: null, vs: null, vlof: null, vr, v2: null, v1: vr };
  }
  const flap = ac.flaps?.[fi] ?? {};
  const W    = p.mass * G;
  const vAt  = cl => Math.sqrt(2 * W / (RHO0 * p.wingArea * cl)) / KT;     // kt at which CL carries the weight (ρ₀ → IAS)
  const vs   = vAt((p.CL_max ?? 1.9) + (flap.dCL_max ?? 0));
  const clLo = (p.CL_0 ?? 0.2) + (flap.dCL_0 ?? 0) + (p.CL_alpha ?? 5.0) * LIFTOFF_PITCH_DEG * Math.PI / 180;
  const vlof = vAt(Math.min(clLo, (p.CL_max ?? 1.9) + (flap.dCL_max ?? 0)));
  const vr   = vlof - ROTATION_KT;
  const v2   = Math.max(1.13 * vs, vlof + 5);
  return { flaps: fi, vs, vlof, vr, v2, v1: vr };
}

/** V1 in kt IAS, or null when the aircraft has no takeoff speeds. Stage 1: V1 = VR. */
export function v1(ac = S.aircraft) { return takeoffSpeeds(ac)?.v1 ?? null; }

/** VR in kt IAS, or null. */
export function vr(ac = S.aircraft) { return takeoffSpeeds(ac)?.vr ?? null; }

/**
 * The runway ahead from the lineup, in metres — an input for stage 2's takeoff distances (it changes no
 * speed while V1 = VR). An intersection departure's route carries it (`remainingM`, core/taxi-graph.js);
 * otherwise the departure runway's full length.
 */
export function runwayAvailableM(mission = S.mission, route = S.taxiRoute) {
  if (route?.remainingM != null) return route.remainingM;
  const icao = mission?.start?.icao || mission?.departure?.icao;
  const want = String(mission?.start?.runway ?? mission?.departure?.runway ?? '').toUpperCase();
  const r = (RUNWAYS[icao] || []).find(x => (x.leId || '').toUpperCase() === want || (x.heId || '').toUpperCase() === want);
  if (!r) return null;
  const [a, b] = [r.a, r.b];
  return Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
}

/**
 * The takeoff speeds for the PFD's speed tape, or null when they don't show: on the ground of a mission that
 * starts on the ground (a takeoff) and for an aircraft with computed speeds. Not on a landing rollout of an
 * approach mission; on the ground again after a takeoff they would show — a later stage's flight phase hides them.
 */
export function takeoffMarks(ac = S.aircraft, s = S) {
  if (!s.wow || s.mission?.initialState?.spd !== 0) return null;
  const t = takeoffSpeeds(ac);
  return t?.flaps == null ? null : t;
}
