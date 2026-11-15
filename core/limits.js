/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/limits.js
   A jet's maximum operating speed from its sourced limits (envelope.vmo, envelope.mmo,
   envelope.limitsSource): VMO in kt IAS — one value, or by altitude ({ "0": 300, "8000": 300,
   "10000": 330 }, linear between the keys, the ends held) — and MMO, a Mach.

     vmoAt(env, altFt)                 VMO at the altitude, kt IAS, or null without one
     maxOperatingSpeed(ac, altFt)      { kt, by: 'VMO' | 'MMO' } — the lower of VMO there and the IAS of
                                       MMO there (MMO binds up high, where its IAS falls below VMO);
                                       null without a sourced limit

   Read by the A/THR's cap (core/thrust.js), the PFD's barber pole and master warning
   (display/pfd_instruments.js); the overspeed crash reads vmoAt (core/physics.js).
   ═══════════════════════════════════════════════════════════════ */

import { iasOfMach } from './airdata.js';

/** VMO at altFt, kt IAS — a number, or an altitude schedule interpolated linearly; null without one */
export function vmoAt(env, altFt) {
  const v = env?.vmo;
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const pts = Object.entries(v).map(([a, k]) => [Number(a), Number(k)]).sort((p, q) => p[0] - q[0]);
  if (!pts.length) return null;
  if (altFt <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (altFt <= pts[i][0]) {
      const [a0, k0] = pts[i - 1], [a1, k1] = pts[i];
      return k0 + (k1 - k0) * (altFt - a0) / (a1 - a0);
    }
  }
  return pts.at(-1)[1];
}

/** The maximum operating speed at altFt: { kt, by } — the lower of VMO and the IAS of MMO; null without a limit */
export function maxOperatingSpeed(ac, altFt) {
  const env = ac?.envelope;
  const vmo = vmoAt(env, altFt);
  const mmoKt = env?.mmo != null ? iasOfMach(env.mmo, altFt) : null;
  if (vmo == null && mmoKt == null) return null;
  if (mmoKt != null && (vmo == null || mmoKt < vmo)) return { kt: mmoKt, by: 'MMO' };
  return { kt: vmo, by: 'VMO' };
}
