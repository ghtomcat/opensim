/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/thrust.js
   Thrust-lever detents as N1 limits (the Airbus thrust-rating model).

   The thrust lever sits in detents (IDLE · CLB · MCT/FLX · TOGA). Each detent
   is a flat-rated N1 ceiling — the maximum the A/THR may command. With A/THR
   engaged the autothrust modulates N1 between idle and that ceiling to hold the
   target speed; when the ceiling isn't enough it pins there (THR <detent>).

   Detent geometry comes from each aircraft's thrustProfiles ({label, spdT});
   spdT doubles as the lever fraction (spdT / maxSpdT). An explicit `n1` on a
   profile overrides the default ceiling for that label.

   tickThrust(dt) is the thrust command: the A/THR speed loop, or the manual
   lever. It publishes S.n1Cmd — the N1 asked of a running engine — and the
   A/THR mode for the FMA. The engine (core/engine.js) spools N1 toward it.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { managedSpeed } from './managed-speed.js';

/* Flat-rated N1 ceiling per detent label (sea-level ISA, % N1). */
const DETENT_N1 = { CLB: 84, MCT: 93, FLX: 93, TOGA: 100 };

/**
 * activeDetent(ac, lever) → { label, n1Limit, idx } | null
 * The detent nearest the current lever position — same nearest-match the
 * pedestal and the "Thrust" status line use, so all three agree.
 */
export function activeDetent(ac = S.aircraft, lever = S.thrustLever ?? 0) {
  const profiles = ac?.thrustProfiles;
  if (!profiles?.length) return null;
  const maxSpdT = Math.max(...profiles.map(p => p.spdT)) || 1;
  let best = 0, bestD = Infinity;
  profiles.forEach((p, i) => {
    const d = Math.abs(lever - p.spdT / maxSpdT);
    if (d < bestD) { bestD = d; best = i; }
  });
  const p    = profiles[best];
  const idle = ac?.engine?.idleN1 ?? 22;
  const n1Limit = (p.label === 'IDLE') ? idle
                : (p.n1 ?? DETENT_N1[p.label] ?? (idle + (100 - idle) * (p.spdT / maxSpdT)));
  return { label: p.label, n1Limit, idx: best };
}

let _athrSpdPrev = null;   // previous airspeed for the A/THR damping (speed-rate) term

/**
 * tickThrust(dt) — the thrust command for a turbofan, once per sim step before the engine.
 * A/THR engaged in flight: a speed loop (integrator on the speed error) holds the target
 * speed, capped by the lever detent. One loop gives the right phase behaviour: level → holds,
 * climb → spools up, descent → idles. Target = the FCU/managed speed, capped by 250 < FL100 and Vmo.
 * A/THR off: N1 follows the thrust lever (or the reverser, deployed on the ground).
 * Writes n1Cmd, athrN1 (the integrator), athrMode, athrDetent; RETARD pulls the lever to idle.
 */
export function tickThrust(dt) {
  const ac = S.aircraft;
  if (ac?.engine?.type !== 'turbofan' || S.paused || S.crashed || !ac.envelope) return;   // same guards as tickPhysics
  const IDLE_N1 = ac.engine.idleN1 ?? 22;
  const n1Now   = S.n1 ?? 0;
  const vmo     = ac.envelope.maxSpd ?? 340;

  const athrActive = S.engineState === 'running' && S.athr && !S.wow;   // A/THR is independent of the AP — holds speed while you hand-fly
  let n1Cmd, athrI = S.athrN1 ?? n1Now;
  let athrMode = null, athrDetent = null, retardLever = false;
  if (athrActive) {
    /* The thrust-lever detent is a flat-rated N1 ceiling — the A/THR may modulate up to
       it, no further. Pinned at the ceiling → THR <detent>; below it → SPEED/MACH. */
    const det     = activeDetent(ac, S.thrustLever ?? 0);
    const ceiling = det ? det.n1Limit : 100;
    athrDetent    = det?.label ?? null;
    const mgSpd   = S.spdManaged ? managedSpeed() : null;                      // managed → phase speed schedule
    const spdTgt  = (mgSpd != null) ? Math.min(mgSpd, vmo)                      // (already capped 250<FL100 inside)
                                    : Math.min(S.spdT ?? vmo, S.alt < 10000 ? 250 : 1e4, vmo);  // selected FCU speed
    const spdErr  = spdTgt - (S.spd ?? 0);
    const spdRate = _athrSpdPrev != null ? ((S.spd ?? 0) - _athrSpdPrev) / dt : 0;    // kt/s — damps overshoot
    athrI    = Math.max(IDLE_N1, Math.min(ceiling, athrI + spdErr * 0.10 * dt));      // integral (anti-windup at ceiling)
    const speedN1 = Math.max(IDLE_N1, Math.min(100, athrI + spdErr * 1.0 - spdRate * 3.5)); // + proportional − derivative
    n1Cmd    = Math.min(speedN1, ceiling);                                            // detent caps the command
    athrMode = (speedN1 >= ceiling - 0.5) ? 'THR'                                     // demand pinned at the limit
             : (S.alt > 28000 ? 'MACH' : 'SPEED');                                    // modulating to hold speed
    /* RETARD — in the flare (low on the captured glideslope) close the thrust to idle so the
       speed bleeds and the jet settles, instead of the A/THR holding speed and floating it. */
    if (S.gsCaptured && (S.alt - (S.mission?.arrival?.elevation ?? 0)) < 30) {
      n1Cmd = IDLE_N1; athrMode = 'IDLE';
      retardLever = true;   // pull the thrust levers back so they're at idle by touchdown
    }
  } else {
    /* A/THR off → manual thrust: N1 follows the thrust lever, not the FCU selected speed
       (turning the SPD knob no longer changes thrust). Falls back to spdT for old state. */
    const lever = S.thrustLever ?? Math.min(1, Math.max(0, (S.spdT ?? 0) / vmo));
    /* Thrust reverser deployed → engines spool up to reverse thrust (the landing roar),
       ramped with the reverser; below 60 kt it stows and N1 falls back to the lever. */
    const _revN1 = IDLE_N1 + (78 - IDLE_N1) * Math.min(1, (S.groundRollT ?? 0) / 2.5);
    n1Cmd = S.thrustReverser ? _revN1 : IDLE_N1 + (100 - IDLE_N1) * lever;
  }
  _athrSpdPrev = athrActive ? (S.spd ?? 0) : null;

  const up = { n1Cmd, athrN1: athrActive ? athrI : null,    // the A/THR integral; null when off → it starts from N1 on engagement
               athrMode, athrDetent };                       // thrust mode for the FMA (null when A/THR off)
  if (retardLever) up.thrustLever = 0;                       // RETARD — levers to idle, so on the ground N1 stays at idle
  setState(up);
}
