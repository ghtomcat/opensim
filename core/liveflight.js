/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/liveflight.js
   Look up a live flight by registration (HB-JMD) or callsign (LX038).

   - Nearby flights: OpenSky Network (CORS-enabled, free, bounding box)
   - Specific lookup: adsb.fi via corsproxy.io (registration & callsign)
   ═══════════════════════════════════════════════════════════════ */

const ADSB_FI  = 'https://api.adsb.fi/v1';
const OPENSKY  = 'https://opensky-network.org/api';
const PROXY    = 'https://corsproxy.io/?';

/* adsb.fi: try direct first, proxy as fallback */
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
 * trackFlight({icao24, callsign})
 * Lightweight poll for continuous tracking — one adsb.fi call by ICAO24 hex.
 * Falls back to callsign if ICAO24 not available.
 * Does NOT fall through to OpenSky to avoid 429s.
 */
export async function trackFlight({ icao24, callsign }) {
  if (icao24) {
    try {
      const ac = await fetchAdsbFi(`${ADSB_FI}/icao?icao=${encodeURIComponent(icao24)}`);
      return normaliseAdsbFi(ac);
    } catch { /* fall through to callsign */ }
  }
  if (callsign) {
    const cs = callsign.trim().replace(/\s+/g, '');
    try {
      const ac = await fetchAdsbFi(`${ADSB_FI}/callsign?callsign=${encodeURIComponent(cs)}`);
      return normaliseAdsbFi(ac);
    } catch { /* fall through to OpenSky */ }
  }

  /* OpenSky fallback — uses 15s cache so rate-limit safe */
  if (icao24) {
    try {
      const r = await fetch(`${OPENSKY}/states/all?icao24=${encodeURIComponent(icao24)}`);
      if (r.ok) {
        const d = await r.json();
        if (d.states?.length) return normaliseOpenSky(d.states[0]);
      }
    } catch { /* not found */ }
  }

  throw new Error('not found');
}

/**
 * lookupFlight(query)
 * query: registration ("HB-JMD") or callsign/flight number ("LX038")
 * Returns normalised flight state or throws.
 */
export async function lookupFlight(query) {
  const q    = query.trim().toUpperCase().replace(/\s+/g, '');
  const bare = q.replace(/-/g, '');   // strip hyphens for API calls
  if (!q) throw new Error('empty query');

  // 1. Try adsb.fi registration lookup (best data: type, reg, vs)
  const looksLikeReg = /^[A-Z]{1,2}-?[A-Z0-9]{2,5}$/.test(q);
  if (looksLikeReg) {
    try {
      const ac = await fetchAdsbFi(`${ADSB_FI}/registration?reg=${encodeURIComponent(bare)}`);
      return normaliseAdsbFi(ac);
    } catch { /* fall through */ }
  }

  // 2. Try adsb.fi callsign lookup
  try {
    const ac = await fetchAdsbFi(`${ADSB_FI}/callsign?callsign=${encodeURIComponent(bare)}`);
    return normaliseAdsbFi(ac);
  } catch { /* fall through */ }

  // 3. OpenSky callsign search (CORS-native, no proxy needed)
  try {
    const r = await fetch(`${OPENSKY}/states/all?callsign=${encodeURIComponent(bare)}`);
    if (r.ok) {
      const d = await r.json();
      if (d.states && d.states.length > 0) {
        const state = d.states.find(s => (s[1] ?? '').trim().replace(/-/g,'') === bare)
                   ?? d.states[0];
        return { ...normaliseOpenSky(state), reg: q };
      }
    }
  } catch { /* fall through */ }

  // 4. Geo fallback — if browser has location, scan nearby and match
  if (navigator.geolocation) {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
    ).catch(() => null);

    if (pos) {
      const { latitude: lat, longitude: lon } = pos.coords;
      const nearby = await nearbyFlights(lat, lon, 150);
      const match  = nearby.find(f =>
        f.callsign.replace(/-/g,'') === bare || f.reg.replace(/-/g,'') === bare
      );
      if (match) return match;
    }
  }

  throw new Error('not found — aircraft may be outside ADS-B coverage');
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

/* OpenSky bounding box cache — avoid 429 on rapid re-fetches */
const _nearbyCache = new Map();   // key → { ts, data }
const NEARBY_TTL_MS = 15_000;     // 15s: OpenSky updates every ~10-15s anyway

/**
 * nearbyFlights(lat, lon, distNm)
 * Uses OpenSky Network bounding box — CORS-enabled, no auth required.
 * Returns up to `limit` airborne aircraft sorted by distance.
 * Results are cached for 15s to respect OpenSky rate limits.
 */
export async function nearbyFlights(lat, lon, distNm = 100, limit = 20) {
  // 1° lat ≈ 60nm; 1° lon ≈ 60nm·cos(lat)
  const dLat = distNm / 60;
  const dLon = distNm / (60 * Math.cos(lat * Math.PI / 180));
  const url = `${OPENSKY}/states/all`
    + `?lamin=${(lat-dLat).toFixed(3)}&lomin=${(lon-dLon).toFixed(3)}`
    + `&lamax=${(lat+dLat).toFixed(3)}&lomax=${(lon+dLon).toFixed(3)}`;

  /* Return cached result if still fresh */
  const cached = _nearbyCache.get(url);
  if (cached && Date.now() - cached.ts < NEARBY_TTL_MS) {
    return cached.data
      .map(f => ({ ...f, _dist: haversine(lat, lon, f.lat, f.lon) }))
      .sort((a, b) => a._dist - b._dist)
      .slice(0, limit);
  }

  const r = await fetch(url);
  if (!r.ok) {
    /* On 429 return stale cache if available, otherwise throw */
    if (r.status === 429 && cached) return cached.data.slice(0, limit);
    throw new Error(`OpenSky HTTP ${r.status}`);
  }
  const d = await r.json();
  if (!d.states || d.states.length === 0) return [];

  const results = d.states
    .filter(s => s[6] != null && s[5] != null   // has position
              && !s[8]                           // not on ground
              && s[7] != null && s[7] > 150)     // has altitude > 150m
    .map(s => normaliseOpenSky(s));

  _nearbyCache.set(url, { ts: Date.now(), data: results });

  return results
    .map(f => ({ ...f, _dist: haversine(lat, lon, f.lat, f.lon) }))
    .sort((a, b) => a._dist - b._dist)
    .slice(0, limit);
}

/* OpenSky state vector indices per API spec.
   s[0]  icao24 hex
   s[1]  callsign (may be empty or registration for GA)
   s[5]  longitude
   s[6]  latitude
   s[7]  baro_altitude metres (null = unknown)
   s[9]  velocity m/s (null = unknown)
   s[10] true_track degrees (null = unknown)
   s[11] vertical_rate m/s (null = unknown)              */
function normaliseOpenSky(s) {
  const callsign = (s[1] ?? '').trim();
  return {
    reg:      s[0] ?? '—',                           // icao24 hex as identifier
    callsign: callsign || s[0] || '—',
    icaoType: '—',
    lat:  s[6],
    lon:  s[5],
    alt:  s[7]  != null ? s[7]  * 3.28084  : 0,     // metres → feet
    spd:  s[9]  != null ? s[9]  * 1.94384  : 0,     // m/s → kt
    hdg:  s[10] != null ? s[10]            : 0,
    vs:   s[11] != null ? s[11] * 196.85   : 0,     // m/s → fpm
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
