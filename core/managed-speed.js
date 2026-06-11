/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/managed-speed.js
   Managed speed — the A/THR target when the SPD knob is pushed in (managed),
   the same way navManaged/altManaged drive LNAV/VNAV.

   Reuses each aircraft's envelope.spdProfile (the altitude → speed schedule
   already defined for the envelope limit): a single data-driven curve that
   encodes the climb/cruise speeds and the approach decel (e.g. a220:
   39000→288, 10000→250, 3000→165, 0→128). Interpolated for a smooth target,
   symmetric for climb and descent. Turbofans only (props keep spdT).
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { lnavActive } from './lnav.js';
import { spdParse }   from './route.js';

/* Interpolate envelope.spdProfile (altitude → speed) at the current altitude. */
function scheduleSpeed(profile, alt) {
  const pts = Object.entries(profile).map(([a, v]) => [Number(a), Number(v)]).sort((p, q) => p[0] - q[0]);
  if (alt <= pts[0][0])     return pts[0][1];
  if (alt >= pts.at(-1)[0]) return pts.at(-1)[1];
  for (let i = 1; i < pts.length; i++) {
    if (alt <= pts[i][0]) {
      const [a0, v0] = pts[i - 1], [a1, v1] = pts[i];
      return v0 + (v1 - v0) * (alt - a0) / (a1 - a0);   // linear between the bracketing keys
    }
  }
  return pts.at(-1)[1];
}

/**
 * managedSpeed() → target IAS (kt), or null when no managed target applies.
 * The A/THR speed loop uses it when S.spdManaged is set. The phase schedule is then bounded
 * by the nearest upcoming flight-plan speed constraint (e.g. ≤220 over a STAR fix).
 */
export function managedSpeed() {
  const ac = S.aircraft;
  if (ac?.engine?.type !== 'turbofan') return null;
  const profile = ac.envelope?.spdProfile;
  if (!profile) return null;

  let tgt = scheduleSpeed(profile, S.alt ?? 0);

  /* Honour the nearest published speed constraint ahead (the one we cross next). */
  const { legs, idx } = lnavActive() ?? {};
  if (legs) {
    for (let j = Math.max(0, idx ?? 0); j < legs.length; j++) {
      const c = spdParse(legs[j].spd);
      if (c) { tgt = (c.kind === 'above') ? Math.max(tgt, c.kt) : Math.min(tgt, c.kt); break; }
    }
  }
  return Math.round(tgt);
}
