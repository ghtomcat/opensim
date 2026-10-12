/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/random.js
   Random numbers for simulation code (not audio).
   Unseeded: Math.random. Seeded (test mode): mulberry32, so a test
   run draws the same sequence every time.
   ═══════════════════════════════════════════════════════════════ */

let _next = Math.random;

/** A number in [0, 1), like Math.random(). */
export function random() {
  return _next();
}

/** Seed the generator (mulberry32). Call per mission load in test mode. */
export function seedRandom(seed) {
  let a = seed >>> 0;
  _next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
