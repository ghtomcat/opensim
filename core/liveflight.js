/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/liveflight.js
   Look up a live flight by registration (HB-JMD) or callsign (LX038).
   Uses adsb.fi — free, no auth, CORS-open.
   ═══════════════════════════════════════════════════════════════ */

const BASE  = 'https://api.adsb.fi/v1';
const PROXY = 'https://corsproxy.io/?';

async function fetchAc(url) {
  for (const u of [url, PROXY + encodeURIComponent(url)]) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.ac && d.ac.length > 0) return d.ac[0];
    } catch { /* try proxy */ }
  }
  throw new Error('not found');
}

async function fetchList(url) {
  for (const u of [url, PROXY + encodeURIComponent(url)]) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.ac) return d.ac;
    } catch { /* try proxy */ }
  }
  throw new Error('fetch failed');
}

/**
 * lookupFlight(query)
 * query: registration ("HB-JMD") or callsign/flight number ("LX038")
 * Returns normalised flight state or throws.
 */
export async function lookupFlight(query) {
  const q = query.trim().toUpperCase().replace(/\s+/g, '');
  if (!q) throw new Error('empty query');

  let ac = null;

  // Heuristic: if query contains only letters and hyphens → try as registration
  const looksLikeReg = /^[A-Z]{1,2}-?[A-Z0-9]{2,5}$/.test(q);

  if (looksLikeReg) {
    const reg = q.replace(/-/g, '');
    try {
      ac = await fetchAc(`${BASE}/registration?reg=${encodeURIComponent(reg)}`);
    } catch {
      // fall through to callsign
    }
  }

  if (!ac) {
    ac = await fetchAc(`${BASE}/callsign?callsign=${encodeURIComponent(q)}`);
  }

  return normalise(ac);
}

function normalise(ac) {
  const alt = typeof ac.alt_baro === 'number' ? ac.alt_baro
            : typeof ac.alt_geom === 'number' ? ac.alt_geom
            : 0;
  return {
    reg:      (ac.r   ?? ac.reg    ?? '—').trim(),
    callsign: (ac.flight ?? ac.callsign ?? '—').trim(),
    icaoType: (ac.t   ?? ac.type   ?? '—').trim(),
    lat:  ac.lat   ?? 0,
    lon:  ac.lon   ?? 0,
    alt:  alt,
    spd:  ac.gs    ?? 0,
    hdg:  ac.track ?? ac.true_heading ?? 0,
    vs:   ac.baro_rate ?? 0,
  };
}

/**
 * nearbyFlights(lat, lon, distNm)
 * Returns up to 20 airborne aircraft within distNm nautical miles,
 * sorted by distance, normalised.
 */
export async function nearbyFlights(lat, lon, distNm = 50) {
  const url = `${BASE}/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${distNm}`;
  const acs = await fetchList(url);
  if (!acs || acs.length === 0) return [];

  return acs
    .filter(ac => ac.lat && ac.lon && ac.alt_baro > 500)   // airborne only
    .map(ac => ({ ...normalise(ac), _dist: haversine(lat, lon, ac.lat, ac.lon) }))
    .sort((a, b) => a._dist - b._dist)
    .slice(0, 20);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440;   // nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * pickAircraft(icaoType) → aircraft id string
 * Maps ICAO type designator to an available sim aircraft.
 */
export function pickAircraft(icaoType) {
  const t = (icaoType || '').toUpperCase();
  if (/^C172/.test(t))            return 'c172';
  if (/^DR4/.test(t))             return 'robin-dr400';
  if (/^(PA28|PA2[0-9])/.test(t)) return 'c172';  // closest we have
  return 'a350';                                   // default: airliner
}
