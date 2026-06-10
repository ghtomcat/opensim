/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/smooth.js
   First-order display lag, shared across every panel.

   Needles, arcs and rolling digits should glide toward their target, not snap —
   instruments that move like they have inertia read as real even when the art is
   simple. One smoother, keyed by an arbitrary string id, so any display site can
   ease a quantity without wiring its own persistent state.

   Frame-rate independent: each call eases the stored value toward `target` by
   (1 - exp(-dt/tau)), tau being the time constant in seconds (bigger = laggier).
   Cosmetic ONLY — never feed these values back into physics.
   ═══════════════════════════════════════════════════════════════ */

const _vals = new Map();   // key → { v, t(seconds) }
const _now  = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/* Ease a scalar toward target. First call (or after a long gap, e.g. a hidden tab or an
   aircraft change) snaps so a fresh panel shows the real value instead of sweeping in. */
export function smooth(key, target, tau = 0.3) {
  if (!Number.isFinite(target)) return target;
  const now = _now();
  let s = _vals.get(key);
  if (!s) { _vals.set(key, { v: target, t: now }); return target; }
  const dt = now - s.t; s.t = now;
  if (dt <= 0)  return s.v;
  if (dt > 0.5) { s.v = target; return target; }              // long gap → snap, don't drift
  s.v += (target - s.v) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
  if (Math.abs(target - s.v) < 1e-4) s.v = target;
  return s.v;
}

/* Ease an angle (degrees) toward target along the shortest arc, so it doesn't unwind the
   long way round the 360/0 seam. Returns a value normalised to [0, 360). */
export function smoothAngle(key, target, tau = 0.3) {
  if (!Number.isFinite(target)) return target;
  const now = _now();
  let s = _vals.get(key);
  if (!s) { _vals.set(key, { v: target, t: now }); return target; }
  const dt = now - s.t; s.t = now;
  if (dt <= 0)  return s.v;
  if (dt > 0.5) { s.v = target; return target; }
  const d = ((target - s.v + 540) % 360) - 180;               // shortest signed delta
  s.v = (((s.v + d * (1 - Math.exp(-dt / Math.max(1e-3, tau)))) % 360) + 360) % 360;
  return s.v;
}

/* Drop one key, or all of them — call on mission load / aircraft change so the next panel
   snaps to its real values instead of gliding from the previous flight. */
export function resetSmooth(key) {
  if (key == null) _vals.clear(); else _vals.delete(key);
}
