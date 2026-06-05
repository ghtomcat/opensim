/* ── Named mission start positions ──────────────────────────────────────────────────
   Instead of hand-typed lat/lon/hdg (error-prone — see the Grenchen "26"@260° vs the
   real 06/24, or the Hahnweide spawn 6 nm off its own field), a mission can name where
   it starts and we derive the exact position + heading from the bundled OurAirports data:

     "start": { "runway": "24", "at": "lineup" }      // at | lineup | backtrack | threshold
     "start": { "runway": "12" }                       // default at = lineup

   (stand / holdShort would need OSM and are not resolved here yet.) Returns
   { lat, lon, hdg } or null — the caller falls back to initialState. */

import { RUNWAYS } from '../display/runways-data.js';

const _bearing = (a, b) =>
  ((Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI) + 360) % 360;
const _lenM = (a, b) =>
  Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));

export function resolveStart(mission) {
  const s = mission?.start;
  if (!s) return null;
  const icao = s.icao || mission.departure?.icao || mission.arrival?.icao;
  const rws  = icao && RUNWAYS[icao];
  if (!rws) return null;

  if (s.runway != null) {
    const want = String(s.runway).toUpperCase();
    for (const r of rws) {
      let thr, far;
      if      ((r.leId || '').toUpperCase() === want) { thr = r.a; far = r.b; }
      else if ((r.heId || '').toUpperCase() === want) { thr = r.b; far = r.a; }
      else continue;
      const hdg   = _bearing(thr, far);
      const intoM = s.at === 'threshold' ? 0 : s.at === 'backtrack' ? 150 : 35;   // default: lineup
      const f     = Math.min(0.45, intoM / (_lenM(thr, far) || 1));
      return { lat: thr[0] + (far[0] - thr[0]) * f, lon: thr[1] + (far[1] - thr[1]) * f, hdg };
    }
  }
  return null;
}
