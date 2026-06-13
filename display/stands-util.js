/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/stands-util.js
   Helpers over the bundled STANDS data (which is generated, so logic
   lives here, not in stands-data.js).
   ═══════════════════════════════════════════════════════════════ */

import { STANDS } from './stands-data.js';

const _cache = new Map();

/* The gates a mission can actually use / that get a bridge + VDGS.
   Drops a bare-numeric MARS parent (e.g. "218" or "301") when its split sub-stands
   ("218A"/"218B") exist — those are the same ramp (Multiple Aircraft Ramp System),
   so rendering and assigning all three triples the gate. The sub-stands carry their
   own nose-in heading, so each gets a correctly-oriented bridge. */
export function gatesFor(icao) {
  if (!icao) return [];
  if (_cache.has(icao)) return _cache.get(icao);
  const stands = STANDS[icao] || [];
  const refs = new Set(stands.map(s => String(s.ref)));
  const usable = stands.filter(s => {
    const r = String(s.ref);
    if (!/^\d+$/.test(r)) return true;                     // only a bare-numeric ref can be a MARS parent
    return ![...refs].some(o => o.length === r.length + 1 && o.startsWith(r) && /^[A-Z]$/.test(o[r.length]));
  });
  _cache.set(icao, usable);
  return usable;
}
