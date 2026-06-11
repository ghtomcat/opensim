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

/* Great-circle distance, nm. */
function gcNm(aLat, aLon, bLat, bLon) {
  const D = Math.PI / 180;
  const p1 = aLat*D, p2 = bLat*D, dp = (bLat-aLat)*D, dl = (bLon-aLon)*D;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
 * by published flight-plan speed constraints — but only once within a deceleration window of
 * the constrained fix, so a ≤210 approach restriction doesn't slow the aircraft at cruise.
 */
export function managedSpeed() {
  const ac = S.aircraft;
  if (ac?.engine?.type !== 'turbofan') return null;
  const profile = ac.envelope?.spdProfile;
  if (!profile) return null;

  let tgt = scheduleSpeed(profile, S.alt ?? 0);

  /* Honour each upcoming speed constraint only when close enough to act on it (≈0.5 nm per kt
     to bleed off, min 12 nm). Far constraints — including the whole approach seen from cruise —
     don't bind; the tightest one within range wins. */
  const { legs, idx } = lnavActive() ?? {};
  if (legs && S.lat != null && S.lon != null) {
    for (let j = Math.max(0, idx ?? 0); j < legs.length; j++) {
      const c = spdParse(legs[j].spd);
      if (!c) continue;
      const dist = gcNm(S.lat, S.lon, legs[j].lat, legs[j].lon);
      const lookahead = Math.max(12, ((S.spd ?? tgt) - c.kt) * 0.5);
      if (dist <= lookahead) tgt = (c.kind === 'above') ? Math.max(tgt, c.kt) : Math.min(tgt, c.kt);
    }
  }
  return Math.round(tgt);
}
