/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/liveflight.js
   Look up a live flight by registration (HB-JMD) or callsign (LX038).

   - Nearby flights: OpenSky Network (CORS-enabled, free, bounding box)
   - Specific lookup: adsb.fi via corsproxy.io (registration & callsign)
   ═══════════════════════════════════════════════════════════════ */

const ADSB_FI  = 'https://api.adsb.fi/v1';
const OPENSKY  = 'https://opensky-network.org/api';
const PROXY    = 'https://corsproxy.io/?';

/* adsb.fi: always needs proxy */
async function fetchAdsbFi(url) {
  for (const u of [url, PROXY + encodeURIComponent(url)]) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.ac && d.ac.length > 0) return d.ac[0];
    } catch { /* try next */ }
  }
  throw new Error('not found');
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

  // Heuristic: looks like registration if it matches XX-XXX / XXXXX pattern
  const looksLikeReg = /^[A-Z]{1,2}-?[A-Z0-9]{2,5}$/.test(q);

  if (looksLikeReg) {
    const reg = q.replace(/-/g, '');
    try {
      ac = await fetchAdsbFi(`${ADSB_FI}/registration?reg=${encodeURIComponent(reg)}`);
    } catch { /* fall through to callsign */ }
  }

  if (!ac) {
    ac = await fetchAdsbFi(`${ADSB_FI}/callsign?callsign=${encodeURIComponent(q)}`);
  }

  return normaliseAdsbFi(ac);
}

function normaliseAdsbFi(ac) {
  const alt = typeof ac.alt_baro === 'number' ? ac.alt_baro
            : typeof ac.alt_geom === 'number' ? ac.alt_geom : 0;
  return {
    reg:      (ac.r ?? ac.reg ?? '—').trim(),
    callsign: (ac.flight ?? ac.callsign ?? '—').trim(),
    icaoType: (ac.t ?? ac.type ?? '—').trim(),
    lat: ac.lat ?? 0, lon: ac.lon ?? 0,
    alt, spd: ac.gs ?? 0,
    hdg: ac.track ?? ac.true_heading ?? 0,
    vs:  ac.baro_rate ?? 0,
  };
}

/**
 * nearbyFlights(lat, lon, distNm)
 * Uses OpenSky Network bounding box — CORS-enabled, no auth required.
 * Returns up to 20 airborne aircraft sorted by distance.
 */
export async function nearbyFlights(lat, lon, distNm = 100) {
  // 1° lat ≈ 60nm; 1° lon ≈ 60nm·cos(lat)
  const dLat = distNm / 60;
  const dLon = distNm / (60 * Math.cos(lat * Math.PI / 180));
  const url = `${OPENSKY}/states/all`
    + `?lamin=${(lat-dLat).toFixed(3)}&lomin=${(lon-dLon).toFixed(3)}`
    + `&lamax=${(lat+dLat).toFixed(3)}&lomax=${(lon+dLon).toFixed(3)}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
  const d = await r.json();
  if (!d.states || d.states.length === 0) return [];

  return d.states
    .filter(s => s[6] && s[5] && !s[8] && s[7] > 150)   // lat, lon, not on ground, alt > 150m
    .map(s => normaliseOpenSky(s))
    .map(f => ({ ...f, _dist: haversine(lat, lon, f.lat, f.lon) }))
    .sort((a, b) => a._dist - b._dist)
    .slice(0, 20);
}

/* OpenSky state vector: indices per API spec */
function normaliseOpenSky(s) {
  return {
    reg:      '—',
    callsign: (s[1] ?? '').trim() || '—',
    icaoType: '—',
    lat:  s[6]  ?? 0,
    lon:  s[5]  ?? 0,
    alt:  (s[7]  ?? 0) * 3.28084,          // metres → feet
    spd:  (s[9]  ?? 0) * 1.94384,          // m/s → kt
    hdg:  s[10] ?? 0,
    vs:   (s[11] ?? 0) * 196.85,           // m/s → fpm
  };
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
