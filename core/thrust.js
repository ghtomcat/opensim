/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/thrust.js
   Thrust-lever detents as N1 limits (the Airbus thrust-rating model).

   The thrust lever sits in detents (IDLE · CLB · MCT/FLX · TOGA). Each detent
   is a flat-rated N1 ceiling — the maximum the A/THR may command. With A/THR
   engaged the autothrust modulates N1 between idle and that ceiling to hold the
   target speed; when the ceiling isn't enough it pins there (THR <detent>).

   Detent geometry comes from each aircraft's thrustProfiles ({label, lever}): the lever
   position of each detent, 0 idle … 1 the lever's end. An explicit `n1` on a profile
   overrides the default ceiling for that label.

   tickThrust(dt) is the thrust command: the A/THR speed loop, or the manual
   levers. It publishes S.n1Cmd — the N1 asked of each running engine, one per engine
   (the A/THR the same for all; manual thrust each engine's own lever) — and the
   A/THR mode for the FMA. The engine (core/engine.js) spools N1 toward it.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { managedSpeedTarget } from './managed-speed.js';
import { selectedSpeedKt } from './fcu.js';
import { throttle } from './engine.js';
import { onMissionReset } from './lifecycle.js';

/* Flat-rated N1 ceiling per detent label (sea-level ISA, % N1). */
const DETENT_N1 = { CLB: 84, MCT: 93, FLX: 93, TOGA: 100 };

/**
 * activeDetent(ac, lever) → { label, n1Limit, idx } | null
 * The detent nearest the current lever position — same nearest-match the
 * pedestal and the "Thrust" status line use, so all three agree.
 */
export function activeDetent(ac = S.aircraft, lever = S.lever ?? 0) {
  const profiles = ac?.thrustProfiles;
  if (!profiles?.length) return null;
  let best = 0, bestD = Infinity;
  profiles.forEach((p, i) => {
    const d = Math.abs(lever - p.lever);
    if (d < bestD) { bestD = d; best = i; }
  });
  const p    = profiles[best];
  const idle = ac?.engine?.idleN1 ?? 22;
  const n1Limit = (p.label === 'IDLE') ? idle
                : (p.n1 ?? DETENT_N1[p.label] ?? (idle + (100 - idle) * p.lever));
  return { label: p.label, n1Limit, idx: best };
}

/* The A/THR speed loop's gains: N1 % per kt of speed error (P), per kt·s (I), per kt/s of speed trend (D) */
const ATHR_KP = 6, ATHR_KI = 0.12, ATHR_KD = 3.5;

let _athrSpdPrev = null;   // previous airspeed for the A/THR damping (speed-rate) term

/* A new mission starts the speed loop afresh: the integrator from the engines' N1 (null → tickThrust takes S.n1 on
   its first active step) and no previous airspeed — not the last flight's values or state.js's default. */
onMissionReset(() => { _athrSpdPrev = null; setState({ athrN1: null }); });

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
  const vmo     = ac.envelope.vmo ?? ac.envelope.maxSpd ?? 340;   // the sourced VMO; until then maxSpd

  const athrActive = S.engineState === 'running' && S.athr && !S.wow;   // A/THR is independent of the AP — holds speed while you hand-fly
  let n1Cmd, athrI = S.athrN1 ?? n1Now;
  let athrMode = null, athrDetent = null, retardLever = false;
  if (athrActive) {
    /* The thrust-lever detent is a flat-rated N1 ceiling — the A/THR may modulate up to
       it, no further. Pinned at the ceiling → THR <detent>; below it → SPEED/MACH. */
    const det     = activeDetent(ac, S.lever ?? 0);
    const ceiling = det ? det.n1Limit : 100;
    athrDetent    = det?.label ?? null;
    const mg      = S.spdManaged ? managedSpeedTarget() : null;                // managed → phase speed schedule / cruise Mach
    const mgSpd   = mg?.kt ?? null;
    const spdTgt  = (mgSpd != null) ? Math.min(mgSpd, vmo)                      // (already capped 250<FL100 inside)
                                    : Math.min(selectedSpeedKt() ?? vmo, S.alt < 10000 ? 250 : 1e4, vmo);  // selected FCU speed (a Mach's IAS — SPD/MACH)
    const holdsMach = mgSpd != null ? (mg.mach != null && mgSpd <= vmo)          // managed: the cruise Mach binds
                                    : (!!S.spdMach && spdTgt === selectedSpeedKt());   // selected: a Mach the pilot set, not capped
    const spdErr  = spdTgt - (S.spd ?? 0);
    const spdRate = _athrSpdPrev != null ? ((S.spd ?? 0) - _athrSpdPrev) / dt : 0;    // kt/s — damps overshoot
    /* Anti-windup (conditional integration): the integral — the N1 the speed needs once on target — holds while the
       command is pinned at idle or at the ceiling in the error's direction; otherwise a big speed change runs it down
       to idle (or up to the ceiling), far from that N1, and the speed overshoots the target once the error turns. */
    const uRaw    = athrI + spdErr * ATHR_KP - spdRate * ATHR_KD;
    const pinned  = (uRaw <= IDLE_N1 && spdErr < 0) || (uRaw >= ceiling && spdErr > 0);
    if (!pinned) athrI = Math.max(IDLE_N1, Math.min(ceiling, athrI + spdErr * ATHR_KI * dt));   // integral
    const speedN1 = Math.max(IDLE_N1, Math.min(100, athrI + spdErr * ATHR_KP - spdRate * ATHR_KD)); // + proportional − derivative
    n1Cmd    = Math.min(speedN1, ceiling);                                            // detent caps the command
    athrMode = (speedN1 >= ceiling - 0.5) ? 'THR'                                     // demand pinned at the limit
             : (holdsMach ? 'MACH' : 'SPEED');                                        // modulating to hold the Mach / the speed
    /* RETARD — in the flare (low on the captured glideslope) close the thrust to idle so the
       speed bleeds and the jet settles, instead of the A/THR holding speed and floating it. */
    if (S.gsCaptured && (S.alt - (S.mission?.arrival?.elevation ?? 0)) < 30) {
      n1Cmd = IDLE_N1; athrMode = 'IDLE';
      retardLever = true;   // pull the thrust levers back so they're at idle by touchdown
    }
  }
  /* One command per engine. A/THR: the same for all. A/THR off → manual thrust: each engine's N1 follows its own
     lever, not the FCU selected speed (turning the SPD knob doesn't change thrust). Thrust reverser deployed → the
     engines spool up to reverse thrust (the landing roar), ramped with the reverser; below 60 kt it stows and N1 falls
     back to the lever. */
  const engines = S.engines?.length ? S.engines : [{ lever: S.lever ?? 0 }];
  const _revN1  = IDLE_N1 + (78 - IDLE_N1) * Math.min(1, (S.groundRollT ?? 0) / 2.5);
  const n1Cmds  = engines.map(e => athrActive ? n1Cmd
                                 : S.thrustReverser ? _revN1
                                 : IDLE_N1 + (100 - IDLE_N1) * Math.max(0, Math.min(1, e.lever ?? 0)));
  _athrSpdPrev = athrActive ? (S.spd ?? 0) : null;

  setState({ n1Cmd: n1Cmds, athrN1: athrActive ? athrI : null,   // the A/THR integral; null when off → it starts from N1 on engagement
             athrMode, athrDetent });                            // thrust mode for the FMA (null when A/THR off)
  if (retardLever) throttle(0);                                  // RETARD — levers to idle, so on the ground N1 stays at idle
}
