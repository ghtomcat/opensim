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
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

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
