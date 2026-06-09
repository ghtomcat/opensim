/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/terrain.js
   3D terrain renderer. Flat-earth pinhole projection, canvas 2D.

   Aircraft body frame (fwd/right/up), relative to aircraft:
     fwd   = nm along heading
     right = nm to starboard
     up    = nm above aircraft (ground = -altNm)

   Projection verified:
     pitch rotates in fwd/up plane (nose up → ground drops on screen)
     roll  rotates in right/up plane (right bank → right side drops)
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { RUNWAYS } from './runways-data.js';
import { TOWERS } from './towers-data.js';
import { nightDensity } from './night-lights.js';
import { landColor }    from './terrain-color.js';
import { WINDSOCKS }    from './windsocks-data.js';
import { STANDS }       from './stands-data.js';

/* Soft radial-gradient sprite, reused (additively) for the night city-light glow. */
let _glowSprite = null, _coreSprite = null;
function _makeGlowSprite(c0, c1, c2) {
  const s = document.createElement('canvas'); s.width = s.height = 64;
  const g = s.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, c0); grd.addColorStop(0.45, c1); grd.addColorStop(1, c2);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return s;
}

const DEG   = Math.PI / 180;
const FT_NM = 1 / 6076.12;
const M_NM  = 1 / 1852;
const FOV_H = 70;     /* horizontal field of view, degrees */

const ROWS = 30;      /* depth slices */
const COLS = 26;      /* lateral divisions */

/* Forward distances per row — log-spaced 0.1 to ~18 nm */
const ROW_DIST = Array.from({ length: ROWS + 1 }, (_, i) => 0.1 * Math.pow(1.32, i));

/* ── FPS counter ── */
let _fpsLast = 0, _fpsCount = 0, _fpsDisplay = 0;

/* ── Lunar phase constants ── */
const _MOON_REF_MS    = new Date('2000-01-06T18:14:00Z').getTime();  // reference new moon
const _MOON_SYNODIC   = 29.530589 * 86400000;                        // ms per synodic month

/* ── Mapbox Terrain-RGB elevation tiles ── */
const _TK = localStorage.getItem('mapboxToken') ?? '';  // set once: localStorage.setItem('mapboxToken','pk.eyJ1...')
const _TZ = 12;
const _tcache = new Map();  /* 'x/y' → ImageData | 'loading' | 'error' */

function _fetchTile(x, y) {
  const k = `${x}/${y}`;
  if (_tcache.has(k)) return;
  _tcache.set(k, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const tc = c.getContext('2d');
    tc.drawImage(img, 0, 0);
    _tcache.set(k, tc.getImageData(0, 0, 256, 256));
  };
  img.onerror = () => _tcache.set(k, 'error');
  img.src = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${_TZ}/${x}/${y}.pngraw?access_token=${_TK}`;
}

function _sampleElev(lat, lon) {
  const n  = 1 << _TZ;
  const lr = lat * DEG;
  const tx = (lon + 180) / 360 * n;
  const ty = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
  const xi = tx | 0, yi = ty | 0;
  if (xi < 0 || xi >= n || yi < 0 || yi >= n) return null;
  _fetchTile(xi, yi);
  const t = _tcache.get(`${xi}/${yi}`);
  if (!t || typeof t === 'string') return null;
  const px = Math.min(255, (tx - xi) * 256 | 0);
  const py = Math.min(255, (ty - yi) * 256 | 0);
  const i  = (py * 256 + px) * 4;
  return -10000 + (t.data[i] * 65536 + t.data[i + 1] * 256 + t.data[i + 2]) * 0.1;
}

function _terrainColor(elevM, dayFrac, depth, shade) {
  let r, g, b;
  if      (elevM <    0) { r = 22;  g = 58;  b = 100 }
  else if (elevM <  500) { r = 38;  g = 82;  b = 24  }
  else if (elevM < 1000) { r = 52;  g = 100; b = 32  }
  else if (elevM < 1600) { r = 70;  g = 98;  b = 54  }
  else if (elevM < 2200) { r = 108; g = 106; b = 82  }
  else if (elevM < 3000) { r = 136; g = 132; b = 118 }
  else                   { r = 208; g = 206; b = 198 }
  const f = (dayFrac * 0.82 + 0.18) * (1 - depth * 0.32) * (shade ?? 1);
  return `rgb(${r * f | 0},${g * f | 0},${b * f | 0})`;
}

/* Value noise (2-octave, world-anchored) for terrain shade variation. */
function _tnoise(x, y) {
  const h = (a, b) => { let n = (a | 0) * 374761393 + (b | 0) * 668265263;
    n = (n ^ (n >> 13)); n = Math.imul(n, 1274126177); return ((n ^ (n >> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v)
       + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

/* Ground colour from the real Blue Marble sample at (lat,lon) + procedural shade
   variation; falls back to the hypsometric tint until the map loads or over water. */
function _terrainColorAt(lat, lon, elevM, dayFrac, depth, shade) {
  const c = elevM >= 0 ? landColor(lat, lon) : null;
  /* small islands wash into ocean at 19 km/pixel — if a "land" sample is blue-dominant,
     trust the elevation data and fall back to the hypsometric green instead. */
  const oceanish = c && c[2] > c[0] + 8 && c[2] > c[1] + 8;
  let r, g, b;
  if (c && !oceanish) { r = c[0]; g = c[1]; b = c[2]; }
  else if (elevM <  500) { r = 38;  g = 82;  b = 24;  }
  else if (elevM < 1000) { r = 52;  g = 100; b = 32;  }
  else if (elevM < 1600) { r = 70;  g = 98;  b = 54;  }
  else if (elevM < 2200) { r = 108; g = 106; b = 82;  }
  else if (elevM < 3000) { r = 136; g = 132; b = 118; }
  else                   { r = 208; g = 206; b = 198; }
  const n  = 0.6 * _tnoise(lat * 55, lon * 55) + 0.4 * _tnoise(lat * 13, lon * 13);
  const vm = 0.84 + 0.32 * n;                              // 0.84–1.16 mottle (different shades)
  const f  = (dayFrac * 0.82 + 0.18) * (1 - depth * 0.32) * (shade ?? 1) * vm;
  return `rgb(${r * f | 0},${g * f | 0},${b * f | 0})`;
}

/* Unpaved (grass/turf) runway — rendered as a mowed strip, no paint / numbers / lights. */
const _isGrass = (s) => /gras|grs|turf|sod|soil|earth|dirt/i.test(s || '');

/* Current wind {dir (met, FROM), spd (kt)} — mirrors physics._getWind for the windsock. */
function _windNow() {
  const w = S.mission?.weather;
  const src = !w ? null : w.source === 'manual' ? w.manual : w.source === 'live' ? S.metar : w.fallback;
  return src ? { dir: src.wdir ?? src.wind ?? 0, spd: src.wspd ?? 0 } : { dir: 0, spd: 0 };
}

function _rwyColor(surface, shade, dayFrac) {
  const f = (dayFrac * 0.78 + 0.22) * (shade ?? 1);
  if (surface === 'grass') {
    return `rgb(${58 * f | 0},${72 * f | 0},${34 * f | 0})`;
  }
  const base = surface === 'concrete' ? 105 : surface === 'gravel' ? 88 : 62; /* asphalt */
  const v = base * f | 0;
  return `rgb(${v},${v},${v})`;
}

/* ── OSM aeroway overlay — runways, taxiways, aprons ── */
/* Cache key: "floor(lat*10)_floor(lon*10)" → array of OSM way objects with inline geometry */
const _osmAero    = new Map();
const _osmPending = new Set();
const _aeroRetry  = new Map();   // key → earliest retry time after a failed fetch (no poisoning)

function _fetchOSMAero(lat, lon) {
  const key = `${Math.floor(lat * 10)}_${Math.floor(lon * 10)}`;
  if (_osmAero.has(key) || _osmPending.has(key)) return;
  const _ra = _aeroRetry.get(key);
  if (_ra && performance.now() < _ra) return;          // back off after a transient failure
  _osmPending.add(key);
  /* Bounding box: 0.14° × 0.14° (~9 nm) centred on the 0.1° grid cell */
  const b0l = (Math.floor(lat * 10) / 10 - 0.02).toFixed(4);
  const b1l = (Math.floor(lat * 10) / 10 + 0.12).toFixed(4);
  const b0o = (Math.floor(lon * 10) / 10 - 0.02).toFixed(4);
  const b1o = (Math.floor(lon * 10) / 10 + 0.12).toFixed(4);
  const _bb = `${b0l},${b0o},${b1l},${b1o}`;
  const q = `[out:json][timeout:25];(way["aeroway"~"runway|taxiway|apron|helipad|parking_position"](${_bb});node["aeroway"="holding_position"](${_bb});node["aeroway"="windsock"](${_bb}););out geom;`;
  fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`)
    .then(r => { if (!r.ok) throw 0; return r.json(); })
    .then(d => { _osmAero.set(key, d.elements ?? []); _osmPending.delete(key); })
    .catch(() => { _osmPending.delete(key); _aeroRetry.set(key, performance.now() + 6000); });
}

/* ── OSM major-road overlay — the bright night-time arteries (motorway/trunk/primary).
   Fetched over a much larger box than the aeroway tile (~55 nm) on a coarse 0.3° grid,
   so the road network around a city is available well before you reach it. */
const _osmRoads    = new Map();
const _roadsPending = new Set();
const _roadsRetry   = new Map();   // key → earliest retry time after a failed fetch

function _fetchOSMRoads(lat, lon) {
  const key = `${Math.floor(lat / 0.3)}_${Math.floor(lon / 0.3)}`;
  if (_osmRoads.has(key) || _roadsPending.has(key)) return;
  const _ra = _roadsRetry.get(key);
  if (_ra && performance.now() < _ra) return;          // back off after a transient failure
  _roadsPending.add(key);
  /* keep the box small enough that Overpass reliably serves it (a big SE-England box of
     major roads errors out); ~24 nm still covers an approach and recenters as we descend */
  const latM = 24 / 60;
  const lonM = 24 / (60 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  const _bb = `${(lat - latM).toFixed(3)},${(lon - lonM).toFixed(3)},${(lat + latM).toFixed(3)},${(lon + lonM).toFixed(3)}`;
  const q = `[out:json][timeout:30];(way["highway"~"^(motorway|trunk|primary)$"](${_bb}););out geom;`;
  fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`)
    .then(r => { if (!r.ok) throw 0; return r.json(); })
    .then(d => { _osmRoads.set(key, d.elements ?? []); _roadsPending.delete(key); })
    .catch(() => { _roadsPending.delete(key); _roadsRetry.set(key, performance.now() + 6000); });
}

/* Runway centerline (threshold a→b), width (m) and designator from an OSM runway way.
   Handles line-mapped runways (centerline) and area-mapped runways (polygon → long axis
   via 2-D covariance). ICAO-standard lighting is then derived from this geometry. */
function _runwayGeom(way) {
  const g = way.geometry; if (!g || g.length < 2) return null;
  const ref  = way.tags?.ref ?? '';
  const wTag = parseFloat(way.tags?.width);
  const closed = g.length > 3 &&
    Math.abs(g[0].lat - g[g.length-1].lat) < 1e-9 && Math.abs(g[0].lon - g[g.length-1].lon) < 1e-9;
  if (!closed) return { a: g[0], b: g[g.length-1], widthM: wTag || 45, ref, surface: way.tags?.surface };
  /* area → principal (long) axis in local metres */
  const pts  = g.slice(0, -1);
  const lat0 = pts.reduce((s,p)=>s+p.lat,0)/pts.length;
  const lon0 = pts.reduce((s,p)=>s+p.lon,0)/pts.length;
  const cl   = Math.cos(lat0 * Math.PI/180);
  const xy   = pts.map(p => [ (p.lon-lon0)*60*cl, (p.lat-lat0)*60 ]);  // [E,N] nm
  let sxx=0,sxy=0,syy=0; for (const [x,y] of xy){ sxx+=x*x; sxy+=x*y; syy+=y*y; }
  const th = 0.5*Math.atan2(2*sxy, sxx-syy);
  const ax = [Math.cos(th), Math.sin(th)], pp = [-Math.sin(th), Math.cos(th)];
  let pmin=1e9,pmax=-1e9,qmin=1e9,qmax=-1e9;
  for (const [x,y] of xy){ const p=x*ax[0]+y*ax[1], q=x*pp[0]+y*pp[1];
    if(p<pmin)pmin=p; if(p>pmax)pmax=p; if(q<qmin)qmin=q; if(q>qmax)qmax=q; }
  const midq=(qmin+qmax)/2;
  const toLL=(p)=>({ lat: lat0 + (ax[1]*p+pp[1]*midq)/60, lon: lon0 + (ax[0]*p+pp[0]*midq)/(60*cl) });
  return { a: toLL(pmin), b: toLL(pmax), widthM: wTag || (qmax-qmin)*1852, ref, surface: way.tags?.surface };
}

/* Bundled OurAirports runways for the current mission's airports, in the same
   {a:{lat,lon}, b:{lat,lon}, widthM, ref} shape _runwayGeom returns (+ bundled flag so
   the surface draws a rectangle rather than an OSM polygon). [] if none bundled. */
function _missionRunways() {
  const m = S.mission; if (!m) return [];
  const out = [];
  for (const k of ['departure', 'arrival']) {
    const ic = m[k]?.icao, rws = ic && RUNWAYS[ic];
    if (!rws) continue;
    for (const r of rws) out.push({
      a: { lat: r.a[0], lon: r.a[1] }, b: { lat: r.b[0], lon: r.b[1] },
      widthM: r.widthM, ref: r.ref, surface: r.surface,
      leId: r.leId, heId: r.heId, lit: r.lit, bundled: true,
    });
  }
  return out;
}

/* Memoised _runwayGeom — cached on the OSM way object (static geometry, computed once
   instead of every frame by every runway-feature pass). */
function _rwGeomC(w) {
  if (w._rg === undefined) w._rg = _runwayGeom(w) || null;
  return w._rg;
}

/* Taxiway heading at a holding-position node, so guard lights / hold markings sit
   across the taxiway. Finds a taxiway passing through the node, returns its local dir. */
function _holdDir(node, els) {
  for (const w of els) {
    if (w.type === 'node' || w.tags?.aeroway !== 'taxiway' || !w.geometry) continue;
    const g = w.geometry;
    for (let i = 0; i < g.length; i++) {
      if (Math.abs(g[i].lat - node.lat) < 1e-7 && Math.abs(g[i].lon - node.lon) < 1e-7) {
        const j = i > 0 ? i - 1 : i + 1;
        if (!g[j]) return null;
        return { dLat: g[i].lat - g[j].lat, dLon: g[i].lon - g[j].lon, width: parseFloat(w.tags?.width) || 23 };
      }
    }
  }
  return null;
}

/* Stroke font for painted runway designators. Each glyph = polylines on a unit cell,
   x 0..1 across the runway, y 0..1 along it (y=0 = base near the threshold, y=1 = top
   farther down the runway, so it reads upright on approach). */
const _RW_FONT = {
  '0': [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
  '1': [[[0.5,0],[0.5,1]]],
  '2': [[[0,1],[1,1],[1,0.5],[0,0.5],[0,0],[1,0]]],
  '3': [[[0,1],[1,1],[1,0],[0,0]],[[0,0.5],[1,0.5]]],
  '4': [[[0,1],[0,0.5],[1,0.5]],[[1,1],[1,0]]],
  '5': [[[1,1],[0,1],[0,0.5],[1,0.5],[1,0],[0,0]]],
  '6': [[[1,1],[0,1],[0,0],[1,0],[1,0.5],[0,0.5]]],
  '7': [[[0,1],[1,1],[1,0]]],
  '8': [[[0,0],[1,0],[1,1],[0,1],[0,0]],[[0,0.5],[1,0.5]]],
  '9': [[[1,0],[1,1],[0,1],[0,0.5],[1,0.5]]],
  'L': [[[0,1],[0,0],[1,0]]],
  'C': [[[1,1],[0,1],[0,0],[1,0]]],
  'R': [[[0,0],[0,1],[1,1],[1,0.5],[0,0.5]],[[0.45,0.5],[1,0]]],
  '-': [[[0.1,0.5],[0.9,0.5]]],
  /* full A–Z for taxiway designators (Y4, A, B…) — simple block strokes */
  'A': [[[0,0],[0.5,1],[1,0]],[[0.2,0.4],[0.8,0.4]]],
  'B': [[[0,0],[0,1],[0.7,1],[0.7,0.5],[0,0.5]],[[0,0.5],[0.8,0.5],[0.8,0],[0,0]]],
  'D': [[[0,0],[0,1],[0.6,1],[1,0.65],[1,0.35],[0.6,0],[0,0]]],
  'E': [[[1,1],[0,1],[0,0],[1,0]],[[0,0.5],[0.7,0.5]]],
  'F': [[[1,1],[0,1],[0,0]],[[0,0.5],[0.7,0.5]]],
  'G': [[[1,1],[0,1],[0,0],[1,0],[1,0.45],[0.55,0.45]]],
  'H': [[[0,0],[0,1]],[[1,0],[1,1]],[[0,0.5],[1,0.5]]],
  'I': [[[0.5,0],[0.5,1]],[[0.2,1],[0.8,1]],[[0.2,0],[0.8,0]]],
  'J': [[[1,1],[1,0.25],[0.7,0],[0.3,0],[0,0.25]]],
  'K': [[[0,0],[0,1]],[[1,1],[0,0.5],[1,0]]],
  'M': [[[0,0],[0,1],[0.5,0.45],[1,1],[1,0]]],
  'N': [[[0,0],[0,1],[1,0],[1,1]]],
  'O': [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
  'P': [[[0,0],[0,1],[0.75,1],[0.75,0.5],[0,0.5]]],
  'Q': [[[0,0],[1,0],[1,1],[0,1],[0,0]],[[0.6,0.35],[1,0]]],
  'S': [[[1,1],[0,1],[0,0.5],[1,0.5],[1,0],[0,0]]],
  'T': [[[0,1],[1,1]],[[0.5,1],[0.5,0]]],
  'U': [[[0,1],[0,0.25],[0.3,0],[0.7,0],[1,0.25],[1,1]]],
  'V': [[[0,1],[0.5,0],[1,1]]],
  'W': [[[0,1],[0.25,0],[0.5,0.5],[0.75,0],[1,1]]],
  'X': [[[0,0],[1,1]],[[0,1],[1,0]]],
  'Y': [[[0,1],[0.5,0.5],[1,1]],[[0.5,0.5],[0.5,0]]],
  'Z': [[[0,1],[1,1],[0,0],[1,0]]],
};

/* Designation of a runway (rg): its ref, else derived "XX-YY" from the bearing. */
function _rwDes(rg) {
  if (rg.ref) return rg.ref.replace(/\//g, '-');
  const brg=(Math.atan2(rg.b.lon-rg.a.lon, rg.b.lat-rg.a.lat)*180/Math.PI+360)%360;
  const num=(b)=>{const n=Math.round((((b%360)+360)%360)/10);return n===0?36:n;};
  const f=(b)=>('0'+num(b)).slice(-2);
  return f(brg)+'-'+f(brg+180);
}

/* Per holding-position node: taxiway direction oriented toward the nearest runway, the
   taxiway width, and the protected designation — computed once and cached on the node,
   so the per-frame ladder/sign/guard-light passes are just project + draw. `runways` is
   the unified runway list (OurAirports bundle or OSM). */
function _holdInfo(el, els, runways) {
  if (el._hold !== undefined) return el._hold;
  const dir = _holdDir(el, els);
  if (!dir) return (el._hold = null);
  let uLat = dir.dLat, uLon = dir.dLon;
  const cl = Math.cos(el.lat * DEG);
  /* Pick the runway whose CENTERLINE is nearest the hold (perpendicular distance to the
     segment), not whose midpoint is nearest — long runways (e.g. KBZN 12/30 at 2.7 km)
     have a distant midpoint, so a hold near their threshold would otherwise snap to a
     shorter neighbouring runway. */
  let bd = Infinity, best = null, cLat = el.lat, cLon = el.lon;
  const px = el.lon*cl, py = el.lat;
  for (const rg of runways) {
    const ax = rg.a.lon*cl, ay = rg.a.lat, bx = rg.b.lon*cl, by = rg.b.lat;
    const vx = bx-ax, vy = by-ay, L2 = vx*vx + vy*vy || 1e-12;
    let t = ((px-ax)*vx + (py-ay)*vy) / L2; t = Math.max(0, Math.min(1, t));
    const qx = ax + t*vx, qy = ay + t*vy;
    const d = (px-qx)*(px-qx) + (py-qy)*(py-qy);
    if (d < bd) { bd = d; best = rg; cLat = qy; cLon = qx/cl; }
  }
  const rwLat = cLat - el.lat, rwLon = cLon - el.lon;   // toward the nearest point on the runway
  if (uLat*rwLat + (uLon*cl)*(rwLon*cl) < 0) { uLat = -uLat; uLon = -uLon; }  // toward runway
  const des = el.tags?.ref ? el.tags.ref.replace(/\//g, '-') : (best ? _rwDes(best) : null);
  return (el._hold = { uLat, uLon, width: dir.width, des });
}

/* ── Water polygon tiles — Mapbox Streets v8, zoom 11 ── */
const _WZ    = 11;
const _wcache = new Map();
const _td    = new TextDecoder();

function _fetchWaterTile(x, y) {
  const k = `${x}/${y}`;
  if (_wcache.has(k)) return;
  _wcache.set(k, 'loading');
  fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${_WZ}/${x}/${y}.vector.pbf?access_token=${_TK}`)
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
    .then(ab => _wcache.set(k, _mvtWater(new Uint8Array(ab), x, y)))
    .catch(() => _wcache.set(k, 'error'));
}

/* Protobuf varint — returns [value, nextPos] */
function _vi(b, p) {
  let v = 0, s = 0;
  while (b[p] & 128) { v |= (b[p++] & 127) << s; s += 7; }
  return [v | (b[p] << s), p + 1];
}

/* Skip one field value, pos is AFTER the tag */
function _pbSkip(b, p, w) {
  if (w === 0) { while (b[p++] & 128); return p; }
  if (w === 1) return p + 8;
  if (w === 2) { const [l, n] = _vi(b, p); return n + l; }
  if (w === 5) return p + 4;
  return p + 1;
}

/* Parse one MVT feature blob, append polygon rings to rings[] */
function _mvtFeat(b, extent, rings) {
  let p = 0, type = 0;
  const geom = [];
  while (p < b.length) {
    const [tag, np] = _vi(b, p); p = np;
    const f = tag >> 3, w = tag & 7;
    if (w === 0) {
      const [v, np2] = _vi(b, p); p = np2;
      if (f === 3) type = v;
    } else if (w === 2) {
      const [len, lp] = _vi(b, p); p = lp;
      if (f === 4) {           /* geometry — packed repeated uint32 */
        const e = p + len;
        while (p < e) { const [v, np2] = _vi(b, p); geom.push(v); p = np2; }
      } else { p += len; }    /* skip tags + other fields */
    } else { p = _pbSkip(b, p, w); }
  }
  if (type !== 3 || !geom.length) return;  /* polygons only */

  /* Decode MoveTo / LineTo / ClosePath command stream */
  let x = 0, y = 0, cur = [], i = 0;
  while (i < geom.length) {
    const cmd = geom[i++], id = cmd & 7, cnt = cmd >> 3;
    if (id === 7) {                          /* ClosePath — no params */
      if (cur.length > 2) rings.push(cur);
      cur = [];
    } else {
      for (let j = 0; j < cnt; j++) {
        x += (geom[i] >> 1) ^ -(geom[i] & 1); i++;
        y += (geom[i] >> 1) ^ -(geom[i] & 1); i++;
        if      (id === 1) { if (cur.length > 2) rings.push(cur); cur = [[x / extent, y / extent]]; }
        else if (id === 2) cur.push([x / extent, y / extent]);
      }
    }
  }
  if (cur.length > 2) rings.push(cur);
}

/* Parse one MVT layer blob → rings[] if name==='water', else null */
function _mvtLayer(b) {
  let p = 0, name = '', extent = 4096;
  const feats = [];
  while (p < b.length) {
    const [tag, np] = _vi(b, p); p = np;
    const f = tag >> 3, w = tag & 7;
    if (w === 2) {
      const [len, lp] = _vi(b, p); p = lp;
      if      (f === 1) name = _td.decode(b.slice(p, p + len));
      else if (f === 2) feats.push(b.slice(p, p + len));
      p += len;
    } else if (w === 0) {
      const [v, np2] = _vi(b, p); p = np2;
      if (f === 5) extent = v;
    } else { p = _pbSkip(b, p, w); }
  }
  if (name !== 'water') return null;
  const rings = [];
  for (const fb of feats) _mvtFeat(fb, extent, rings);
  return rings.length ? rings : null;
}

/* Parse full MVT tile binary → [{xi, yi, rings}] */
function _mvtWater(buf, xi, yi) {
  let p = 0;
  const out = [];
  while (p < buf.length) {
    const [tag, np] = _vi(buf, p); p = np;
    const f = tag >> 3, w = tag & 7;
    if (w === 2) {
      const [len, lp] = _vi(buf, p); p = lp;
      if (f === 3) {
        const rings = _mvtLayer(buf.slice(p, p + len));
        if (rings) out.push({ xi, yi, rings });
      }
      p += len;
    } else { p = _pbSkip(buf, p, w); }
  }
  return out;
}

/* ── Earth radius (nm) and continent outlines for globe view ── */
const _R_E = 3438.19;
const _LAND = [
  /* Africa */
  [[37,10],[37,37],[22,38],[12,44],[11,42],[-1,42],[-12,40],[-26,33],[-35,27],[-35,18],[-17,12],[0,9],[5,-2],[5,-8],[15,-17],[30,-9]],
  /* Europe */
  [[71,28],[70,15],[57,8],[47,2],[37,-9],[37,9],[38,26],[42,28],[45,12],[48,8],[54,8],[60,10],[65,15]],
  /* W Russia + Central Asia */
  [[71,28],[65,35],[55,35],[42,28],[37,38],[37,58],[45,58],[55,58],[65,60],[70,60]],
  /* Siberia + Far East */
  [[70,60],[70,90],[70,140],[68,180],[60,168],[55,140],[45,135],[55,85],[65,85]],
  /* China + E Asia */
  [[52,132],[45,132],[40,122],[30,122],[22,115],[15,108],[10,104],[5,103],[5,100],[22,108],[30,120],[45,135]],
  /* India */
  [[28,67],[28,88],[21,88],[8,80],[8,77],[21,75]],
  /* North America — Florida traced for KSC area */
  [[70,-140],[70,-80],[50,-55],[45,-65],[42,-70],[40,-73],[35,-75.5],[30,-81],[28.5,-80.5],[27,-80],[25,-80],[25,-90],[15,-83],[8,-77],[8,-83],[15,-90],[22,-105],[30,-118],[50,-125],[60,-140]],
  /* South America */
  [[12,-72],[12,-60],[0,-50],[-10,-37],[-20,-40],[-33,-52],[-55,-65],[-55,-68],[-30,-68],[-18,-70],[-5,-80],[8,-77]],
  /* Australia */
  [[-17,122],[-15,136],[-12,136],[-12,145],[-20,148],[-38,147],[-38,140],[-35,135],[-32,115],[-22,114]],
  /* Greenland */
  [[60,-44],[70,-25],[83,-25],[83,-55],[76,-68],[68,-53]],
];

/* Ray-casting point-in-polygon for lat/lon arrays */
function _ptInPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function _isOcean(lat, lon) {
  for (const poly of _LAND) { if (_ptInPoly(lat, lon, poly)) return false; }
  return true;
}

export function renderTerrain(canvas, { outsideView = false, cxOverride = null, focalScale = 1 } = {}) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');

  const pitch = (S.pitch ?? 0) * DEG;
  const roll  = (S.roll  ?? 0) * DEG;
  const hdg   = (S.hdg   ?? 0) * DEG;
  /* Ground reference: sample the actual Mapbox elevation at the aircraft's position
     so the terrain mesh sits at the camera's horizon regardless of which airport
     (departure or arrival) defines the mission.  Fall back to departure elevation
     before tiles have loaded.                                                      */
  const _acSampM  = _sampleElev(S.lat ?? 47, S.lon ?? 8);
  const elevFt    = _acSampM !== null
    ? _acSampM / 0.3048
    : (S.mission?.departure?.elevation ?? S.mission?.arrival?.elevation ?? 0);
  const agl    = Math.max(1, (S.alt ?? 1000) - elevFt);
  const altNm  = agl * FT_NM;

  const focal = (W / 2) / Math.tan(FOV_H / 2 * DEG) * focalScale;
  const cosP  = Math.cos(pitch), sinP = Math.sin(pitch);
  const cosR  = Math.cos(roll),  sinR = Math.sin(roll);
  const cosH  = Math.cos(hdg),   sinH = Math.sin(hdg);
  const cx = cxOverride ?? W / 2, cy = H / 2;

  /* ── Project (fwd, right) aircraft-frame nm to screen pixels ──
     up = 0 means ground level; aircraft is at +altNm above ground.
     Returns [sx, sy] or null if behind camera.                   */
  function proj(fwd, right, upAdd) {
    const up = (upAdd ?? 0) - altNm;
    const cf = fwd * cosP + up * sinP;
    const cu = up  * cosP - fwd * sinP;
    if (cf < 1e-4) return null;
    const cr2 = right * cosR + cu * sinR;
    const cu2 = cu    * cosR - right * sinR;
    return [cx + cr2 / cf * focal, cy - cu2 / cf * focal];
  }

  /* ── Project world NE offset (nm from aircraft) to screen ── */
  function projNE(dN, dE, upAdd) {
    return proj(dN * cosH + dE * sinH, dE * cosH - dN * sinH, upAdd);
  }

  /* ── Mission flags ── */
  const isArctic = S.mission?.id === 'wolfskopf-1942';
  const isWater  = S.mission?.water === true;

  /* ── Time of day / sun ── */
  /* Rocket missions store timeOfDay as 0-1 fraction; GA missions use hours 0-24. */
  const _msnTOD = S.mission?.timeOfDay ?? 12;
  const _todH   = _msnTOD < 1 ? _msnTOD * 24 : _msnTOD;  // normalise to hours 0-24
  /* Subsolar longitude advances westward as Earth rotates (15°/h). */
  const _simH     = (S.time ?? 0) / 3600;
  const _sunLonCur = (12 - _todH) * 15 - _simH * 15;  // subsolar lon, advancing
  /* In orbit: solar time at the spacecraft's current sub-point.
     On the ground: use the fixed (corrected) mission time of day.           */
  let timeOfDay;
  if (S.rocketOrbit) {
    const _raw = 12 + (((S.lon ?? 0) - _sunLonCur + 540) % 360 - 180) / 15;
    timeOfDay = ((_raw % 24) + 24) % 24;
  } else {
    timeOfDay = _todH;
  }
  const sunAlt      = Math.sin((timeOfDay - 6) / 12 * Math.PI);   // -1 midnight … +1 noon
  const sunAzDeg    = (180 + (timeOfDay - 12) * 15 + 360) % 360;  // south at noon (NH)
  const sunAltRad   = Math.asin(Math.max(-1, Math.min(1, sunAlt)));
  const sunRelAzRad = ((sunAzDeg - (S.hdg ?? 0) + 540) % 360 - 180) * DEG;
  const dayFrac     = Math.max(0, Math.min(1, (sunAlt + 0.15) / 0.25));  // 0=night 1=day
  const goldenFrac  = Math.max(0, 1 - Math.abs(sunAlt) / 0.18);          // peak at sunrise/set

  /* ── Terrain elevation setup ── */
  const acLat    = S.lat ?? 47;
  const acLon    = S.lon ?? 8;
  const cosAcLat = Math.cos(acLat * DEG);
  const refM     = _acSampM ?? elevFt * 0.3048;   // meters; same source as elevFt above

  /* ── Sky gradient ── */
  const isRocket   = S.aircraft?.vehicleType === 'rocket';
  const hasTerrain = !isArctic && !isWater && !isRocket;
  const globeAlpha = isRocket ? Math.min(1, Math.max(0, (altNm - 32) / 22)) : 0;

  /* ── Clip all terrain/sky to the cockpit window (skip for outside cams) ── */
  ctx.save();
  if (!outsideView) _clipCockpitWindow(ctx, W, H, S.aircraft?.id ?? '', isRocket);
  const altScale   = isRocket ? 500_000 : 35_000;   // ft: rockets reach space, aircraft don't
  const spaceFrac  = isRocket ? Math.min(1, (S.alt ?? 0) / 350_000) : 0;  // 0=atmo 1=space
  const t = Math.min(1, (S.alt ?? 1000) / altScale);  // altitude tint 0=low 1=high

  let skyTopR, skyTopG, skyTopB;
  let skyBotR, skyBotG, skyBotB;

  if (isArctic) {
    /* Arctic overcast — grey, dimmed at night */
    skyTopR = Math.round(_lerp(25, _c(70,120,t), dayFrac));
    skyTopG = Math.round(_lerp(30, _c(80,130,t), dayFrac));
    skyTopB = Math.round(_lerp(40, _c(90,140,t), dayFrac));
    skyBotR = Math.round(_lerp(40, _c(140,170,t), dayFrac));
    skyBotG = Math.round(_lerp(45, _c(150,180,t), dayFrac));
    skyBotB = Math.round(_lerp(55, _c(160,190,t), dayFrac));
  } else {
    /* Day sky (altitude-tinted blue) */
    const dayTopR = _c(8,  100, t), dayTopG = _c(18, 180, t), dayTopB = _c(38, 230, t);
    const dayBotR = _c(32, 165, t), dayBotG = _c(90, 210, t), dayBotB = _c(145,245, t);
    /* Night sky */
    const nightTopR = 3,  nightTopG = 5,  nightTopB = 18;
    const nightBotR = 8,  nightBotG = 12, nightBotB = 35;
    /* Golden hour horizon */
    const goldR = 255, goldG = 130, goldB = 40;

    skyTopR = Math.round(_lerp(nightTopR, dayTopR, dayFrac));
    skyTopG = Math.round(_lerp(nightTopG, dayTopG, dayFrac));
    skyTopB = Math.round(_lerp(nightTopB, dayTopB, dayFrac));

    const baseR = Math.round(_lerp(nightBotR, dayBotR, dayFrac));
    const baseG = Math.round(_lerp(nightBotG, dayBotG, dayFrac));
    const baseB = Math.round(_lerp(nightBotB, dayBotB, dayFrac));
    skyBotR = Math.round(_lerp(baseR, goldR, goldenFrac));
    skyBotG = Math.round(_lerp(baseG, goldG, goldenFrac));
    skyBotB = Math.round(_lerp(baseB, goldB, goldenFrac));
  }

  /* In space, collapse the horizon gradient so the sky is uniformly dark */
  if (globeAlpha > 0) {
    skyBotR = Math.round(_lerp(skyBotR, skyTopR, globeAlpha));
    skyBotG = Math.round(_lerp(skyBotG, skyTopG, globeAlpha));
    skyBotB = Math.round(_lerp(skyBotB, skyTopB, globeAlpha));
  }

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `rgb(${skyTopR},${skyTopG},${skyTopB})`);
  sky.addColorStop(1, `rgb(${skyBotR},${skyBotG},${skyBotB})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  /* ── Lunar phase (real-world synodic cycle) ── */
  const moonPhase = ((Date.now() - _MOON_REF_MS) % _MOON_SYNODIC + _MOON_SYNODIC) % _MOON_SYNODIC / _MOON_SYNODIC;

  /* ── Stars (night or space) ── */
  const effectiveDayFrac = dayFrac * (1 - spaceFrac);  // space overrides time of day
  if (effectiveDayFrac < 0.95 && !isArctic) {
    const starAlpha = Math.max(0, 1 - effectiveDayFrac) * 0.85;
    ctx.save();
    /* In atmosphere: clip stars above flat horizon. In space: fill whole sky. */
    const horizonY = globeAlpha > 0 ? H : cy + Math.tan(pitch) * focal;
    if (globeAlpha === 0) {
      ctx.beginPath();
      ctx.rect(0, 0, W, horizonY);
      ctx.clip();
    }

    ctx.fillStyle = `rgba(255,255,255,${starAlpha})`;
    /* Deterministic star field — fixed seed via simple LCG */
    let rx = 0x12345678;
    const _rand = () => { rx = (rx * 1664525 + 1013904223) & 0xffffffff; return (rx >>> 0) / 0xffffffff; };
    const STAR_COUNT = 180;
    for (let i = 0; i < STAR_COUNT; i++) {
      const sx = _rand() * W;
      const sy = _rand() * H;
      const sr = (_rand() * 1.2 + 0.3) * devicePixelRatio;
      /* Twinkle: vary alpha slightly per star */
      const tw = 0.7 + _rand() * 0.3;
      ctx.globalAlpha = starAlpha * tw;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ── Twilight afterglow — a warm directional bloom on the horizon toward the sun's
     azimuth during civil/nautical twilight (sun just below the horizon, where the disc
     itself is gone). Same soft additive-glow primitive as the city lights, generalised
     to the sky: bright orange where the sun set, fading to blue away from it. */
  if (!isRocket && !isArctic && globeAlpha === 0) {
    const belowGlow = Math.max(0, Math.min(1, (sunAlt + 0.30) / 0.30));   // rises toward the horizon
    const aboveFade = Math.max(0, Math.min(1, (0.15 - sunAlt) / 0.15));   // gone in full daylight
    const twi = belowGlow * aboveFade;                                    // peaks at/just below set
    const fwd0 = Math.cos(sunRelAzRad), rgt0 = Math.sin(sunRelAzRad);     // sun dir at the horizon
    const scf  = fwd0 * cosP, scu = -fwd0 * sinP;
    if (twi > 0.01 && scf > 0.01) {                                       // skip if sun set behind us
      const scr2 = rgt0 * cosR + scu * sinR, scu2 = scu * cosR - rgt0 * sinR;
      const gx = cx + scr2 / scf * focal;
      const gy = cy - scu2 / scf * focal;        // horizon point at the sun's azimuth
      const rad = Math.max(W, H) * 0.75;
      const wr = Math.round(_lerp(150, 255, belowGlow));   // deeper = pinker, shallower = orange
      const wg = Math.round(_lerp(58, 148, belowGlow));
      const wb = Math.round(_lerp(98, 66, belowGlow));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(gx, gy); ctx.scale(1, 0.42);           // hug the horizon (wide, short)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0,    `rgba(${wr},${wg},${wb},${(0.55 * twi).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(${wr},${Math.round(wg * 0.78)},${wb},${(0.22 * twi).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${wr},${wg},${wb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /* ── Sun disc ── */
  if (sunAlt > -0.05) {
    const sunFwd    = Math.cos(sunAltRad) * Math.cos(sunRelAzRad);
    const sunRight  = Math.cos(sunAltRad) * Math.sin(sunRelAzRad);
    const sunUp     = Math.sin(sunAltRad);
    const scf  = sunFwd  * cosP + sunUp   * sinP;
    const scu  = sunUp   * cosP - sunFwd  * sinP;
    const scr2 = sunRight * cosR + scu * sinR;
    const scu2 = scu      * cosR - sunRight * sinR;

    if (scf > 0.01) {
      const sx = cx + scr2 / scf * focal;
      const sy = cy - scu2 / scf * focal;
      if (sx > -200 && sx < W + 200 && sy > -200 && sy < H + 200) {
        const isLow   = sunAlt < 0.15;
        const sunR    = isLow ? 255 : 255;
        const sunG    = isLow ? 150 :  220;
        const sunB    = isLow ?  40 :  120;
        const radius  = 18 * devicePixelRatio;

        /* Glow */
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 4);
        glow.addColorStop(0,   `rgba(${sunR},${sunG},${sunB},0.30)`);
        glow.addColorStop(0.4, `rgba(${sunR},${sunG},${sunB},0.12)`);
        glow.addColorStop(1,   `rgba(${sunR},${sunG},${sunB},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, radius * 4, 0, Math.PI * 2);
        ctx.fill();

        /* Disc */
        ctx.fillStyle = `rgb(${sunR},${sunG},${sunB})`;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ── Moon disc ── */
  if (effectiveDayFrac < 0.9 && !isArctic) {
    /* Position: moon's effective local time is offset from sun by phase angle.
       New moon (0) = same time as sun; full moon (0.5) = 12 h opposite. */
    const moonTOD      = ((timeOfDay + moonPhase * 24) % 24 + 24) % 24;
    const moonAlt      = Math.sin((moonTOD - 6) / 12 * Math.PI);
    const moonAzDeg    = (180 + (moonTOD - 12) * 15 + 360) % 360;
    const moonAltRad   = Math.asin(Math.max(-1, Math.min(1, moonAlt)));
    const moonRelAzRad = ((moonAzDeg - (S.hdg ?? 0) + 540) % 360 - 180) * DEG;

    if (moonAlt > -0.05) {
      const mFwd  = Math.cos(moonAltRad) * Math.cos(moonRelAzRad);
      const mRgt  = Math.cos(moonAltRad) * Math.sin(moonRelAzRad);
      const mUp   = Math.sin(moonAltRad);
      const mcf   = mFwd * cosP + mUp  * sinP;
      const mcu   = mUp  * cosP - mFwd * sinP;
      const mcr2  = mRgt * cosR + mcu  * sinR;
      const mcu2  = mcu  * cosR - mRgt * sinR;

      if (mcf > 0.01) {
        const mx = cx + mcr2 / mcf * focal;
        const my = cy - mcu2 / mcf * focal;
        if (mx > -200 && mx < W + 200 && my > -200 && my < H + 200) {
          const moonAlpha  = Math.min(1, (1 - effectiveDayFrac) * 3) * 0.92;
          const illuminated = (1 - Math.cos(moonPhase * 2 * Math.PI)) / 2;
          const R = 14 * devicePixelRatio;

          ctx.save();
          ctx.globalAlpha = moonAlpha;

          /* Glow — brighter at full moon */
          const glowStr = 0.07 + illuminated * 0.16;
          const mglow = ctx.createRadialGradient(mx, my, 0, mx, my, R * 3.5);
          mglow.addColorStop(0,   `rgba(200,210,180,${glowStr})`);
          mglow.addColorStop(0.5, `rgba(180,195,160,${glowStr * 0.4})`);
          mglow.addColorStop(1,   'rgba(180,195,160,0)');
          ctx.fillStyle = mglow;
          ctx.beginPath();
          ctx.arc(mx, my, R * 3.5, 0, Math.PI * 2);
          ctx.fill();

          /* Phase disc — clip, fill lit surface, draw shadow */
          ctx.save();
          ctx.translate(mx, my);
          ctx.beginPath();
          ctx.arc(0, 0, R, 0, Math.PI * 2);
          ctx.clip();

          ctx.fillStyle = 'rgb(215, 210, 180)';
          ctx.fillRect(-R, -R, 2*R, 2*R);

          const tx    = Math.cos(moonPhase * 2 * Math.PI) * R;
          const absTx = Math.abs(tx);
          ctx.fillStyle = 'rgba(0, 3, 20, 0.97)';

          if (moonPhase < 0.01 || moonPhase > 0.99) {
            /* New moon — fill disc dark */
            ctx.fillRect(-R, -R, 2*R, 2*R);
          } else if (moonPhase < 0.5) {
            /* Waxing: shadow on left */
            ctx.beginPath();
            if (tx >= 0) {
              /* Crescent — shadow covers left + big right portion */
              ctx.arc(0, 0, R, -Math.PI/2, Math.PI/2, true);
              ctx.ellipse(0, 0, tx, R, 0, Math.PI/2, -Math.PI/2, true);
            } else {
              /* Gibbous — thin sliver on left */
              ctx.ellipse(0, 0, absTx, R, 0, -Math.PI/2, Math.PI/2, true);
              ctx.arc(0, 0, R, Math.PI/2, -Math.PI/2, false);
            }
            ctx.closePath();
            ctx.fill();
          } else if (moonPhase > 0.51) {
            /* Waning: shadow on right */
            ctx.beginPath();
            if (tx <= 0) {
              /* Gibbous — thin sliver on right */
              ctx.ellipse(0, 0, absTx, R, 0, -Math.PI/2, Math.PI/2, false);
              ctx.arc(0, 0, R, Math.PI/2, -Math.PI/2, true);
            } else {
              /* Crescent — shadow covers right + big left portion */
              ctx.arc(0, 0, R, -Math.PI/2, Math.PI/2, false);
              ctx.ellipse(0, 0, tx, R, 0, Math.PI/2, -Math.PI/2, false);
            }
            ctx.closePath();
            ctx.fill();
          }
          /* Full moon (0.49–0.51): no shadow drawn */

          ctx.restore();  // pop translate + clip
          ctx.restore();  // pop globalAlpha
        }
      }
    }
  }

  /* ── Earth globe (high altitude) ── */
  if (isRocket && globeAlpha > 0) {
    const R_ac    = _R_E + altNm;
    const acLatR  = acLat * DEG, acLonR = acLon * DEG;
    const sinAcLat = Math.sin(acLatR);
    const cosAcLon = Math.cos(acLonR), sinAcLon = Math.sin(acLonR);
    /* ECEF unit vectors: up = nadir-to-aircraft, n = north, e = east */
    const upEx = cosAcLat * cosAcLon, upEy = cosAcLat * sinAcLon, upEz = sinAcLat;
    const nEx  = -sinAcLat * cosAcLon, nEy = -sinAcLat * sinAcLon, nEz = cosAcLat;
    const eEx  = -sinAcLon, eEy = cosAcLon, eEz = 0;
    /* Body fwd/right rotated by heading from local N/E */
    const fEx = nEx*cosH+eEx*sinH, fEy = nEy*cosH+eEy*sinH, fEz = nEz*cosH+eEz*sinH;
    const rEx = eEx*cosH-nEx*sinH, rEy = eEy*cosH-nEy*sinH, rEz = eEz*cosH-nEz*sinH;
    const acX = R_ac*upEx, acY = R_ac*upEy, acZ = R_ac*upEz;

    const projGlobe = (lat, lon) => {
      const lr = lat*DEG, lnr = lon*DEG;
      const cLat = Math.cos(lr), sLat = Math.sin(lr);
      const cLon = Math.cos(lnr), sLon = Math.sin(lnr);
      /* skip points on far hemisphere */
      if (cLat*cLon*upEx + cLat*sLon*upEy + sLat*upEz < 0) return null;
      const px = _R_E*cLat*cLon - acX;
      const py = _R_E*cLat*sLon - acY;
      const pz = _R_E*sLat      - acZ;
      return proj(px*fEx+py*fEy+pz*fEz,
                  px*rEx+py*rEy+pz*rEz,
                  px*upEx+py*upEy+pz*upEz + altNm);
    };

    /* Limb circle: angular radius θ where cos(θ) = R_E / R_ac */
    const limbCos = _R_E / R_ac;
    const limbSin = Math.sqrt(1 - limbCos*limbCos);
    const limbPts = [];
    for (let i = 0; i < 90; i++) {
      const β = (i / 90) * 2 * Math.PI;
      const sL = sinAcLat*limbCos + cosAcLat*limbSin*Math.cos(β);
      const lr = Math.asin(Math.max(-1, Math.min(1, sL)));
      const dl = Math.atan2(Math.sin(β)*limbSin*cosAcLat, limbCos - sinAcLat*sL);
      limbPts.push(projGlobe(lr/DEG, (acLonR+dl)/DEG));
    }

    const validLimb = limbPts.filter(Boolean);
    if (validLimb.length > 10) {
      /* Ocean disc + clip region */
      ctx.save();
      ctx.globalAlpha = globeAlpha;
      ctx.beginPath();
      let f = true;
      for (const p of limbPts) {
        if (!p) continue;
        if (f) { ctx.moveTo(p[0], p[1]); f = false; } else ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fillStyle = '#1a3a5c';
      ctx.fill();
      ctx.clip();

      /* Continents */
      ctx.fillStyle = '#2d5c2e';
      for (const poly of _LAND) {
        ctx.beginPath();
        let mv = false;
        for (const [lat, lon] of poly) {
          const p = projGlobe(lat, lon);
          if (!p) { mv = false; continue; }
          if (!mv) { ctx.moveTo(p[0], p[1]); mv = true; } else ctx.lineTo(p[0], p[1]);
        }
        if (mv) { ctx.closePath(); ctx.fill(); }
      }

      /* Night-side overlay — darkens the globe when spacecraft is in/near shadow.
         Canvas is still clipped to the globe limb disc, so fillRect stays inside it.
         dayFrac is orbital-time-aware (computed from longitude vs advancing sunLon). */
      const _nightFrac = 1 - dayFrac;
      if (_nightFrac > 0.02) {
        ctx.fillStyle = `rgba(0,5,25,${(_nightFrac * 0.80).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();

      /* Atmosphere glow ring (outside clip) */
      let sx = 0, sy = 0, mr = 0;
      for (const p of validLimb) { sx += p[0]; sy += p[1]; }
      const gcx = sx/validLimb.length, gcy = sy/validLimb.length;
      for (const p of validLimb) { const d = Math.hypot(p[0]-gcx,p[1]-gcy); if (d>mr) mr=d; }
      const atmo = ctx.createRadialGradient(gcx, gcy, mr*0.9, gcx, gcy, mr*1.18);
      atmo.addColorStop(0,   `rgba(80,160,255,${(0.35*globeAlpha).toFixed(3)})`);
      atmo.addColorStop(0.4, `rgba(80,160,255,${(0.10*globeAlpha).toFixed(3)})`);
      atmo.addColorStop(1,   'rgba(80,160,255,0)');
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(gcx, gcy, mr*1.18, 0, Math.PI*2);
      ctx.fill();
    }
  }

  /* ── Ground grid — pre-project all vertices ── */
  const pts   = [];
  const elevs = [];
  for (let r = 0; r <= ROWS; r++) {
    const d    = ROW_DIST[r];
    const half = d * 1.5;
    const prow = [], erow = [];
    for (let c = 0; c <= COLS; c++) {
      const right = (c / COLS - 0.5) * 2 * half;
      let elevNm = 0, elevM = refM;
      if (hasTerrain) {
        const dN   = d * cosH - right * sinH;
        const dE   = d * sinH + right * cosH;
        const lat2 = acLat + dN / 60;
        const lon2 = acLon + dE / (60 * Math.cos(acLat * DEG));
        const e    = _sampleElev(lat2, lon2);
        if (e !== null) { elevM = e; elevNm = (e - refM) * M_NM; }
      }
      prow.push(proj(d, right, elevNm));
      erow.push(elevM);
    }
    pts.push(prow);
    elevs.push(erow);
  }

  /* ── Runway geometry for quad-loop override ──
     Skipped entirely when OurAirports runways are bundled for this mission: the bundled
     geometry is accurate and drawn separately, so the hand-authored rwyLat/rwyHdg (which
     can be a wrong heading/designation, e.g. Grenchen "26"@260° vs the real 06/24) must
     NOT also paint a crossing runway into the terrain mesh. */
  const _rwyDefs = [];
  const _meshRwyOK = _missionRunways().length === 0;
  for (const src of [S.mission?.arrival, S.mission?.departure]) {
    if (!src?.rwyLat || !hasTerrain || !_meshRwyOK) continue;
    const hRad = (src.rwyHdg ?? 0) * DEG;
    const aN = Math.cos(hRad), aE = Math.sin(hRad);
    _rwyDefs.push({
      lat: src.rwyLat, lon: src.rwyLon,
      aN, aE, xN: -aE, xE: aN,
      lenNm:  (src.rwyLengthM ?? 800) * M_NM,
      halfW:  (src.rwyWidthM  ?? 30)  * M_NM * 0.5,
      surface: src.surface ?? 'asphalt',
    });
  }

  /* Terrain / water fill */
  if (hasTerrain) {
    /* Base fill — covers below-horizon area so no sky shows through gaps */
    const horizonY = cy + Math.tan(pitch) * focal;
    if (horizonY < H) {
      ctx.fillStyle = _terrainColorAt(acLat, acLon, refM, dayFrac, 0, 1);
      ctx.fillRect(0, horizonY, W, H - horizonY);
    }

    /* Sun direction in aircraft frame for slope shading */
    const sunFwd = Math.cos(sunAltRad) * Math.cos(sunRelAzRad);
    const sunRgt = Math.cos(sunAltRad) * Math.sin(sunRelAzRad);
    const sunUp  = Math.sin(sunAltRad);

    for (let r = 0; r < ROWS; r++) {
      const depth = r / ROWS;
      const dr_m  = (ROW_DIST[r + 1] - ROW_DIST[r]) * 1852;
      for (let c = 0; c < COLS; c++) {
        const tl = pts[r][c],   tr = pts[r][c + 1];
        const bl = pts[r+1][c], br = pts[r+1][c + 1];
        if (!tl || !tr || !bl || !br) continue;
        const avgElev = (elevs[r][c] + elevs[r][c+1] + elevs[r+1][c] + elevs[r+1][c+1]) * 0.25;

        /* Surface normal from elevation gradient, dot with sun */
        const dc_m       = ROW_DIST[r] * 3.0 / COLS * 1852;
        const slopeFwd   = (elevs[r+1][c] + elevs[r+1][c+1] - elevs[r][c]   - elevs[r][c+1])  * 0.5;
        const slopeRight = (elevs[r][c+1]  + elevs[r+1][c+1] - elevs[r][c]  - elevs[r+1][c]) * 0.5;
        const nx   = -slopeFwd  / dr_m;
        const ny   = -slopeRight / dc_m;
        const nmag = Math.sqrt(nx * nx + ny * ny + 1);
        const dot  = Math.max(0, (nx * sunFwd + ny * sunRgt + sunUp) / nmag);
        const shade = 0.55 + 0.65 * dot;

        /* quad-centre lat/lon — used for both the land-cover sample and the runway test */
        const d_c     = (ROW_DIST[r] + ROW_DIST[r + 1]) * 0.5;
        const right_c = ((c + 0.5) / COLS - 0.5) * 2 * d_c * 1.5;
        const lat_c   = acLat + (d_c * cosH - right_c * sinH) / 60;
        const lon_c   = acLon + (d_c * sinH + right_c * cosH) / (60 * cosAcLat);

        let quadColor = null;
        if (_rwyDefs.length) {
          for (const rw of _rwyDefs) {
            const dnT = (lat_c - rw.lat) * 60;
            const deT = (lon_c - rw.lon) * 60 * cosAcLat;
            const along  = dnT * rw.aN + deT * rw.aE;
            const across = dnT * rw.xN + deT * rw.xE;
            if (along >= 0 && along <= rw.lenNm && Math.abs(across) <= rw.halfW) {
              quadColor = _rwyColor(rw.surface, shade, dayFrac);
              break;
            }
          }
        }
        ctx.fillStyle = quadColor ?? _terrainColorAt(lat_c, lon_c, avgElev, dayFrac, depth, shade);
        ctx.beginPath();
        ctx.moveTo(tl[0], tl[1]);
        ctx.lineTo(tr[0], tr[1]);
        ctx.lineTo(br[0], br[1]);
        ctx.lineTo(bl[0], bl[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else if (isRocket) {
    /* Flat ground only while globe hasn't fully taken over */
    if (globeAlpha < 1) {
      /* Base fill — prevents sky gradient bleeding through near-plane terrain gaps */
      const _baseHY = cy + Math.tan(pitch) * focal;
      if (_baseHY < H) {
        const _baseAlpha = globeAlpha > 0 ? 1 - globeAlpha : 1;
        ctx.save();
        ctx.globalAlpha = _baseAlpha;
        ctx.fillStyle = _isOcean(acLat, acLon) ? '#1a4a78' : '#3d6e30';
        ctx.fillRect(0, Math.max(0, _baseHY), W, H - Math.max(0, _baseHY));
        ctx.restore();
      }

      ctx.save();
      if (globeAlpha > 0) ctx.globalAlpha = 1 - globeAlpha;
      const landPath = new Path2D(), oceanPath = new Path2D();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const tl = pts[r][c],   tr = pts[r][c + 1];
          const bl = pts[r+1][c], br = pts[r+1][c + 1];
          if (!tl || !tr || !bl || !br) continue;
          const d_c     = (ROW_DIST[r] + ROW_DIST[r + 1]) * 0.5;
          const right_c = ((c + 0.5) / COLS - 0.5) * 2 * d_c * 1.5;
          const lat_c   = acLat + (d_c * cosH - right_c * sinH) / 60;
          const lon_c   = acLon + (d_c * sinH + right_c * cosH) / (60 * cosAcLat);
          const p = _isOcean(lat_c, lon_c) ? oceanPath : landPath;
          p.moveTo(tl[0], tl[1]); p.lineTo(tr[0], tr[1]);
          p.lineTo(br[0], br[1]); p.lineTo(bl[0], bl[1]);
          p.closePath();
        }
      }
      const frontPt = pts[0][Math.floor(COLS / 2)];
      const backPt  = pts[ROWS][Math.floor(COLS / 2)];
      const _rGrad = (near, far) => {
        if (!frontPt || !backPt) return near;
        const g = ctx.createLinearGradient(0, frontPt[1], 0, backPt[1]);
        g.addColorStop(0, near); g.addColorStop(1, far); return g;
      };
      ctx.fillStyle = _rGrad('#3d6e30', '#2d5a22'); ctx.fill(landPath);
      ctx.fillStyle = _rGrad('#1a4a78', '#122f50'); ctx.fill(oceanPath);
      ctx.restore();
    }
  } else {
    const terrainNear = isArctic ? '#cdd4d8' : isWater ? '#1a3f66' : '#3d6e30';
    const terrainFar  = isArctic ? '#b8c2c8' : isWater ? '#162f50' : '#2d5a22';
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tl = pts[r][c],   tr = pts[r][c + 1];
        const bl = pts[r+1][c], br = pts[r+1][c + 1];
        if (!tl || !tr || !bl || !br) continue;
        ctx.moveTo(tl[0], tl[1]);
        ctx.lineTo(tr[0], tr[1]);
        ctx.lineTo(br[0], br[1]);
        ctx.lineTo(bl[0], bl[1]);
        ctx.closePath();
      }
    }
    const frontPt = pts[0][Math.floor(COLS / 2)];
    const backPt  = pts[ROWS][Math.floor(COLS / 2)];
    if (frontPt && backPt) {
      const tg = ctx.createLinearGradient(0, frontPt[1], 0, backPt[1]);
      tg.addColorStop(0, terrainNear);
      tg.addColorStop(1, terrainFar);
      ctx.fillStyle = tg;
    } else {
      ctx.fillStyle = terrainNear;
    }
    ctx.fill();
  }

  /* ── Water bodies (Streets v8 vector polygons) ── */
  if (hasTerrain) {
    const nw   = 1 << _WZ;
    const lrAc = acLat * DEG;
    const acTX = (acLon + 180) / 360 * nw | 0;
    const acTY = (1 - Math.log(Math.tan(lrAc) + 1 / Math.cos(lrAc)) / Math.PI) / 2 * nw | 0;
    const wR   = dayFrac * 52 + 12 | 0;
    const wG   = dayFrac * 88 + 22 | 0;
    const wB   = dayFrac * 148 + 38 | 0;
    ctx.fillStyle = `rgba(${wR},${wG},${wB},0.88)`;

    /* Batch all water rings into one path — single fill() call instead of one per ring */
    ctx.beginPath();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = acTX + dx, ty = acTY + dy;
        _fetchWaterTile(tx, ty);
        const cached = _wcache.get(`${tx}/${ty}`);
        if (!Array.isArray(cached)) continue;

        for (const { xi, yi, rings } of cached) {
          const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 *  yi      / nw))) / DEG;
          const latS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / nw))) / DEG;
          const lonW = xi       / nw * 360 - 180;
          const lonE = (xi + 1) / nw * 360 - 180;
          const dLat = latS - latN, dLon = lonE - lonW;

          for (const ring of rings) {
            /* Cull ring by distance — skip if centre is more than 22 NM away */
            const [fx0, fy0] = ring[0];
            const rlat = latN + dLat * fy0, rlon = lonW + dLon * fx0;
            const rdN  = (rlat - acLat) * 60, rdE = (rlon - acLon) * 60 * cosAcLat;
            if (rdN * rdN + rdE * rdE > 22 * 22) continue;
            /* Cull rings well behind the view direction before projecting their points
               (proj() would reject each one anyway, but per-point). 5 NM margin keeps
               rings that straddle the camera plane. */
            if (rdN * cosH + rdE * sinH < -5) continue;

            const eNm = ((_sampleElev(rlat, rlon) ?? refM) - refM) * M_NM;

            let started = false;
            for (const [fx, fy] of ring) {
              const dN = (latN + dLat * fy - acLat) * 60;
              const dE = (lonW + dLon * fx - acLon) * 60 * cosAcLat;
              const sp = proj(dN * cosH + dE * sinH, dE * cosH - dN * sinH, eNm);
              if (!sp) continue;
              if (!started) { ctx.moveTo(sp[0], sp[1]); started = true; }
              else            ctx.lineTo(sp[0], sp[1]);
            }
            if (started) ctx.closePath();
          }
        }
      }
    }
    ctx.fill();
  }

  /* ── City lights at night — the VIIRS radiance field itself, projected onto the ground
     as a soft additive glow (NOT random points). Each lit world cell becomes a glow sprite
     sized by perspective and brightened by its real density, so cities show their true
     shape: bright core → fading suburbs → dark countryside and water. */
  if (!isWater && !isRocket) {
    const _carpetA = Math.min(1, Math.max(0, (1 - dayFrac - 0.18) / 0.5));  // fade in at dusk
    if (_carpetA > 0.01) {
      if (!_glowSprite) {
        _glowSprite = _makeGlowSprite('rgba(255,210,150,0.95)', 'rgba(255,168,92,0.40)', 'rgba(255,150,80,0)');
        _coreSprite = _makeGlowSprite('rgba(255,246,228,0.95)', 'rgba(255,222,176,0.40)', 'rgba(255,210,150,0)');
      }
      const _DPR  = devicePixelRatio || 1;
      const altFt = Math.max(0, altNm * 6076.12);
      const maxR  = Math.min(160, Math.max(6, 2 + 1.17 * Math.sqrt(altFt)));   // ~horizon (nm)
      const clat  = cosAcLat || 1e-3;
      const _hash = (x, y) => { let n = (x | 0) * 374761393 + (y | 0) * 668265263;
        n = (n ^ (n >> 13)); n = Math.imul(n, 1274126177); return ((n ^ (n >> 16)) >>> 0) / 4294967296; };
      /* coarser cells farther out — perspective merges the glows anyway */
      const bands = [
        { r0: 0.0, r1: Math.min(maxR, 14), cell: 0.5 },
        { r0: 14,  r1: Math.min(maxR, 45), cell: 1.4 },
        { r0: 45,  r1: maxR,               cell: 4.0 },
      ];
      let budget = 3000;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bands) {
        if (b.r0 >= b.r1 || budget <= 0) continue;
        const dLat = b.cell / 60, dLon = b.cell / (60 * clat);
        const iy0 = Math.floor((acLat - b.r1 / 60) / dLat),          iy1 = Math.ceil((acLat + b.r1 / 60) / dLat);
        const ix0 = Math.floor((acLon - b.r1 / (60 * clat)) / dLon), ix1 = Math.ceil((acLon + b.r1 / (60 * clat)) / dLon);
        for (let iy = iy0; iy <= iy1 && budget > 0; iy++) {
          const cLat = iy * dLat, dN = (cLat - acLat) * 60;
          for (let ix = ix0; ix <= ix1; ix++) {
            const cLon = ix * dLon, dE = (cLon - acLon) * 60 * clat;
            const dist = Math.hypot(dN, dE);
            if (dist < b.r0 || dist >= b.r1) continue;
            const fwd = dN * cosH + dE * sinH;
            if (fwd < -1) continue;                          // behind camera
            if (Math.abs(dE * cosH - dN * sinH) > fwd * 1.6 + 6) continue;   // outside view fan
            const d = nightDensity(cLat, cLon);
            if (d < 0.05) continue;
            /* jitter the glow off the regular lat/lon lattice (hash = stable per world cell) */
            const jN = dN + (_hash(ix, iy) - 0.5) * b.cell;
            const jE = dE + (_hash(iy * 3 + 7, ix * 5 + 1) - 0.5) * b.cell;
            const q = proj(jN * cosH + jE * sinH, jE * cosH - jN * sinH, 0);
            if (!q) continue;
            const dist3D = Math.hypot(dist, altNm);
            let r = focal * (b.cell * 0.85) / (dist3D > 0.05 ? dist3D : 0.05);
            if (r < 1.2) r = 1.2; else if (r > 200) r = 200;
            if (q[0] < -r || q[0] > W + r || q[1] < -r || q[1] > H + r) continue;
            ctx.globalAlpha = Math.min(0.20, d * 0.28) * _carpetA;   // faint underglow, not cloud
            ctx.drawImage(_glowSprite, q[0] - r, q[1] - r, 2 * r, 2 * r);
            if (d > 0.4) {                                    // white-hot city cores
              const rc = r * 0.5;
              ctx.globalAlpha = Math.min(0.48, (d - 0.4) * 1.3) * _carpetA;
              ctx.drawImage(_coreSprite, q[0] - rc, q[1] - rc, 2 * rc, 2 * rc);
            }
            if (--budget <= 0) break;
          }
          if (budget <= 0) break;
        }
      }
      ctx.globalAlpha = 1;

      /* ── Major roads as bright sodium arteries (real OSM geometry). This is the sharp
         structure that reads as a city rather than as fog — motorways the brightest and
         longest-range, primary roads only close in. */
      _fetchOSMRoads(acLat, acLon);
      const _roads = _osmRoads.get(`${Math.floor(acLat / 0.3)}_${Math.floor(acLon / 0.3)}`) || [];
      if (_roads.length) {
        const _classes = [
          { hw: 'primary',  col: '255,172,98',  w: 1.4, a: 0.42, max: Math.min(maxR, 30) },
          { hw: 'trunk',    col: '255,184,110', w: 2.0, a: 0.60, max: Math.min(maxR, 50) },
          { hw: 'motorway', col: '255,202,128', w: 2.8, a: 0.82, max: maxR },
        ];
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const cl of _classes) {
          ctx.strokeStyle = `rgb(${cl.col})`;
          ctx.lineWidth = cl.w * _DPR;
          for (const w of _roads) {                       // per-road stroke so we can fade by distance
            if (w.tags?.highway !== cl.hw || !w.geometry) continue;
            let near = Infinity;
            for (const nd of w.geometry) {
              const dd = Math.hypot((nd.lat - acLat) * 60, (nd.lon - acLon) * 60 * clat);
              if (dd < near) near = dd;
            }
            if (near > cl.max) continue;
            ctx.globalAlpha = cl.a * _carpetA * Math.max(0.16, 1 - near / cl.max);   // distance fade
            ctx.beginPath();
            let pen = false;
            for (const nd of w.geometry) {
              const dN = (nd.lat - acLat) * 60, dE = (nd.lon - acLon) * 60 * clat;
              const fwd = dN * cosH + dE * sinH;
              if (Math.hypot(dN, dE) > cl.max || fwd < -1) { pen = false; continue; }
              const sp = proj(dN * cosH + dE * sinH, dE * cosH - dN * sinH, 0);
              if (!sp) { pen = false; continue; }
              if (!pen) { ctx.moveTo(sp[0], sp[1]); pen = true; } else ctx.lineTo(sp[0], sp[1]);
            }
            ctx.stroke();
          }
        }
        /* ── Streetlight sparkle — dots stepped along the big roads (motorway/trunk),
           close in only, fading with distance, for texture on the foreground arteries. */
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(255,226,172,${(0.5 * _carpetA).toFixed(3)})`;
        const _spMax = Math.min(maxR, 14);
        let _spB = 1500;
        ctx.beginPath();
        for (const w of _roads) {
          const hw = w.tags?.highway;
          if ((hw !== 'motorway' && hw !== 'trunk') || !w.geometry || _spB <= 0) continue;
          const g = w.geometry; let carry = 0;
          for (let i = 0; i < g.length - 1 && _spB > 0; i++) {
            const aN = (g[i].lat - acLat) * 60,     aE = (g[i].lon - acLon) * 60 * clat;
            const bN = (g[i + 1].lat - acLat) * 60, bE = (g[i + 1].lon - acLon) * 60 * clat;
            const sN = bN - aN, sE = bE - aE, L = Math.hypot(sN, sE);
            if (L < 1e-6) continue;
            let t = carry;
            while (t < L && _spB > 0) {
              const f = t / L, pN = aN + sN * f, pE = aE + sE * f;
              const dist = Math.hypot(pN, pE), fwd = pN * cosH + pE * sinH;
              if (dist <= _spMax && fwd > -0.5) {
                const sp = proj(pN * cosH + pE * sinH, pE * cosH - pN * sinH, 0);
                if (sp) {
                  const rr = Math.max(0.5, (1 - dist / _spMax) * 1.5) * _DPR;
                  ctx.moveTo(sp[0] + rr, sp[1]); ctx.arc(sp[0], sp[1], rr, 0, Math.PI * 2);
                  _spB--;
                }
              }
              t += 0.1;                                   // ~185 m between lights
            }
            carry = t - L;
          }
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  /* ── OSM aeroway overlay — runways, taxiways, aprons (all mission types) ── */
  if (!isWater) {
    _fetchOSMAero(acLat, acLon);
    const _osmKey  = `${Math.floor(acLat * 10)}_${Math.floor(acLon * 10)}`;
    const _osmWays = _osmAero.get(_osmKey) || [];
    /* Runways: OurAirports bundle (primary) at mission airports, else OSM geometry —
       so the runway draws even where OSM has nothing mapped. */
    const _bundledRw = _missionRunways();
    const _runways = _bundledRw.length
      ? _bundledRw
      : _osmWays.filter(w => w.tags?.aeroway === 'runway').map(_rwGeomC).filter(Boolean);
    /* One flat airport ground plane: where bundled runways exist, sample elevation once at
       the runway threshold and co-plane the taxiways/aprons to it — a real airport is
       graded flat, so they should sit at the runway's height rather than each following the
       terrain mesh (which floats them where the field slopes). null = per-node fallback. */
    let _apElevNm = null;
    if (_bundledRw.length) {
      const _aeM = _sampleElev(_bundledRw[0].a.lat, _bundledRw[0].a.lon);
      if (_aeM !== null) _apElevNm = (_aeM - refM) * M_NM;
    }
    if (_osmWays.length || _runways.length) {
      /* Brighter + faintly cool at night: the apron/taxiway surface is lit by all the
         surface lights, so it reads as a lit apron, not flat-dim grey. */
      const _f   = dayFrac * 0.64 + 0.36;
      const _nf  = 1 - dayFrac;                      // 0 day → 1 night
      const _ngl = _nf * 3 | 0, _nbl = _nf * 9 | 0;  // night green / blue lift
      const _rB  = 62  * _f | 0;   // runway  (asphalt ~62)
      const _tB  = 52  * _f | 0;   // taxiway (slightly darker)
      const _aB  = 72  * _f | 0;   // apron   (concrete ~72)
      ctx.save();
      for (const way of _osmWays) {
        if (!way.geometry?.length) continue;
        const _at = way.tags?.aeroway;
        if (_at !== 'runway' && _at !== 'taxiway' && _at !== 'apron') continue;
        if (_at === 'runway' && _bundledRw.length) continue;   // bundled runways drawn below
        /* Surface-aware: grass/unpaved taxiways & aprons render green, not grey concrete. */
        const _sfc = way.tags?.surface;
        const _ovGrass = _isGrass(_sfc) || _sfc === 'unpaved' || _sfc === 'ground';
        const _bv = _at === 'taxiway' ? _tB : _at === 'apron' ? _aB : _rB;
        /* Co-plane with the runway (flat airport) where bundled; else sample at the first
           node so the overlay sits on the terrain mesh. */
        const _n0  = way.geometry[0];
        const _eM  = _apElevNm !== null ? null : _sampleElev(_n0.lat, _n0.lon);
        const _eNm = _apElevNm !== null ? _apElevNm : (_eM !== null ? (_eM - refM) * M_NM : 0);
        ctx.fillStyle = _ovGrass ? `rgb(${96*_f|0},${134*_f|0},${56*_f|0})`
                                 : `rgb(${_bv},${_bv+_ngl},${_bv+_nbl})`;
        /* Areas (aprons) fill their polygon as-is; lines (taxiways/runways) are centerlines,
           so buffer them to a width strip — filling an open line makes a spurious polygon. */
        const _g = way.geometry;
        const _area = _g.length > 3 && Math.abs(_g[0].lat - _g[_g.length-1].lat) < 1e-9
                                    && Math.abs(_g[0].lon - _g[_g.length-1].lon) < 1e-9;
        const _ne = _g.map(p => [(p.lat - acLat) * 60, (p.lon - acLon) * 60 * cosAcLat]);
        let _ring;
        if (_area) {
          _ring = _ne;
        } else {
          const _hw = ((parseFloat(way.tags?.width) || (_at === 'taxiway' ? 15 : _at === 'runway' ? 30 : 23)) / 1852) / 2;
          const _Ls = [], _Rs = [];
          for (let i = 0; i < _ne.length; i++) {
            const a = _ne[Math.max(0, i-1)], b = _ne[Math.min(_ne.length-1, i+1)];
            let dN = b[0]-a[0], dE = b[1]-a[1]; const l = Math.hypot(dN, dE) || 1e-9; dN /= l; dE /= l;
            _Ls.push([_ne[i][0] - dE*_hw, _ne[i][1] + dN*_hw]);
            _Rs.push([_ne[i][0] + dE*_hw, _ne[i][1] - dN*_hw]);
          }
          _ring = _Ls.concat(_Rs.reverse());
        }
        ctx.beginPath();
        let _go = false;
        for (const [_N, _E] of _ring) {
          const _sp = proj(_N * cosH + _E * sinH, _E * cosH - _N * sinH, _eNm);
          if (!_sp) continue;
          if (!_go) { ctx.moveTo(_sp[0], _sp[1]); _go = true; }
          else         ctx.lineTo(_sp[0], _sp[1]);
        }
        if (_go) { ctx.closePath(); ctx.fill(); }
      }
      /* Bundled (OurAirports) runway surfaces — rectangles from the thresholds + width. */
      if (_bundledRw.length) {
        for (const rg of _bundledRw) {
          ctx.fillStyle = _isGrass(rg.surface)
            ? `rgb(${96*_f|0},${134*_f|0},${56*_f|0})`           // mowed-grass strip (clearly green)
            : `rgb(${_rB},${_rB+_ngl},${_rB+_nbl})`;             // paved
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE)||1e-6, pN=-dE/L, pE=dN/L, hw=(rg.widthM/1852)/2;
          const _eM=_sampleElev(rg.a.lat,rg.a.lon), _eNm=_eM!==null?(_eM-refM)*M_NM:0;
          /* Draw the long runway as segments along its length: a single behind-camera
             corner then only drops one short segment instead of the whole runway (which
             made the grey vanish on orbit). */
          const _SEG = 40;
          for (let s=0; s<_SEG; s++) {
            const _t0=s/_SEG, _t1=(s+1)/_SEG;
            const _q0N=aN+dN*_t0, _q0E=aE+dE*_t0, _q1N=aN+dN*_t1, _q1E=aE+dE*_t1;
            const c=[[_q0N+pN*hw,_q0E+pE*hw],[_q0N-pN*hw,_q0E-pE*hw],[_q1N-pN*hw,_q1E-pE*hw],[_q1N+pN*hw,_q1E+pE*hw]];
            const sps=c.map(([N,E])=>proj(N*cosH+E*sinH,E*cosH-N*sinH,_eNm));
            if(sps.some(s=>!s))continue;
            ctx.beginPath(); ctx.moveTo(sps[0][0],sps[0][1]);
            for(let i=1;i<4;i++)ctx.lineTo(sps[i][0],sps[i][1]); ctx.closePath(); ctx.fill();
          }
        }
      }
      ctx.restore();

      /* ── Runway markings (paint, day + night) — centreline dashes, threshold "piano
         keys", and aiming-point blocks, derived from each runway's geometry. */
      {
        const _M = 1/1852;
        ctx.save();
        ctx.fillStyle = 'rgba(226,229,234,0.82)';
        for (const rg of _runways) {
          if (_isGrass(rg.surface)) continue;                    // grass strips have no paint
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE)||1e-6;
          if (((aN+bN)/2)**2 + ((aE+bE)/2)**2 > 25) continue;     // >5 nm
          const uN=dN/L, uE=dE/L, pN=-uE, pE=uN, hw=(rg.widthM/1852)/2;
          const _eM=_sampleElev(rg.a.lat,rg.a.lon), _eNm=_eM!==null?(_eM-refM)*M_NM:0;
          const _quad=(al0,al1,ac0,ac1)=>{
            const q=[[al0,ac0],[al1,ac0],[al1,ac1],[al0,ac1]].map(([al,ac])=>{
              const N=aN+uN*al+pN*ac, E=aE+uE*al+pE*ac;
              return proj(N*cosH+E*sinH,E*cosH-N*sinH,_eNm); });
            if(q.some(p=>!p))return;
            ctx.beginPath();ctx.moveTo(q[0][0],q[0][1]);
            for(let i=1;i<4;i++)ctx.lineTo(q[i][0],q[i][1]);ctx.closePath();ctx.fill(); };
          const clw=0.45*_M;
          for (let al=60*_M; al<L-60*_M; al+=50*_M)                // centreline: 30 m / 20 m
            _quad(al, Math.min(L-60*_M, al+30*_M), -clw, clw);
          const sw=1.25*_M, pitch=3.6*_M, n=Math.floor(hw/pitch);
          for (const end of [{o:0,s:1},{o:L,s:-1}]) {
            const _al=(d)=>end.o+end.s*d;
            for (let i=-n;i<=n;i++){ if(i===0)continue; const ac=i*pitch;
              if (Math.abs(ac)+sw>hw) continue;
              _quad(_al(6*_M), _al(36*_M), ac-sw, ac+sw); }          // piano keys
            _quad(_al(300*_M), _al(345*_M),  7*_M, 13*_M);           // aiming point (two blocks)
            _quad(_al(300*_M), _al(345*_M), -13*_M, -7*_M);
          }
        }
        ctx.restore();
      }

      /* ── Taxiway centrelines (yellow paint) — the defining taxiway marking, on paved
         taxiways. The OSM taxiway way IS the centreline, so we just stroke it. */
      {
        const _DPRt = devicePixelRatio || 1;
        ctx.save();
        ctx.strokeStyle = `rgba(214,196,72,${(0.45 + 0.35 * dayFrac).toFixed(2)})`;
        ctx.lineWidth = 1.5 * _DPRt; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();                                        // batch all centrelines → one stroke
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'taxiway' || !way.geometry || way.geometry.length < 2) continue;
          if (_isGrass(way.tags?.surface)) continue;            // grass taxiways aren't painted
          const g = way.geometry;
          const _0n = (g[0].lat-acLat)*60, _0e = (g[0].lon-acLon)*60*cosAcLat;
          if (_0n*_0n + _0e*_0e > 16) continue;                 // > 4 nm
          const _yM = _apElevNm !== null ? null : _sampleElev(g[0].lat, g[0].lon);
          const _yNm = _apElevNm !== null ? _apElevNm : (_yM !== null ? (_yM-refM)*M_NM : 0);
          let pen = false;
          for (const nd of g) {
            const dN = (nd.lat-acLat)*60, dE = (nd.lon-acLon)*60*cosAcLat;
            if (Math.hypot(dN, dE) > 4 || dN*cosH+dE*sinH < -0.3) { pen = false; continue; }
            const sp = proj(dN*cosH+dE*sinH, dE*cosH-dN*sinH, _yNm);
            if (!sp) { pen = false; continue; }
            if (!pen) { ctx.moveTo(sp[0], sp[1]); pen = true; } else ctx.lineTo(sp[0], sp[1]);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      /* ── Taxiway designators (yellow ref painted along the centreline, e.g. "A", "Y4") —
         the apron/taxiway "street signs"; OSM gives the taxiway ref. */
      {
        const _M = 1/1852;
        ctx.save();
        ctx.strokeStyle = `rgba(224,204,72,${(0.55 + 0.3 * dayFrac).toFixed(2)})`;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'taxiway' || !way.geometry || way.geometry.length < 2) continue;
          if (_isGrass(way.tags?.surface)) continue;
          const ref = (way.tags?.ref || '').trim().toUpperCase();
          if (!ref || ref.length > 3) continue;                  // short designators only
          const g = way.geometry, mi = Math.max(1, Math.floor(g.length / 2));
          const m0 = g[mi-1], m1 = g[mi];
          const cLat = (m0.lat+m1.lat)/2, cLon = (m0.lon+m1.lon)/2;
          const nN = (cLat-acLat)*60, nE = (cLon-acLon)*60*cosAcLat;
          if (nN*nN + nE*nE > 6.25) continue;                    // > 2.5 nm
          const dN = (m1.lat-m0.lat)*60, dE = (m1.lon-m0.lon)*60*cosAcLat;
          const L = Math.hypot(dN,dE)||1, uN = dN/L, uE = dE/L, pN = -uE, pE = uN;
          const _eM = _apElevNm !== null ? null : _sampleElev(cLat,cLon);
          const _eNm = _apElevNm !== null ? _apElevNm : (_eM!==null?(_eM-refM)*_M:0);
          const chars = [...ref];
          const digH = 4.5*_M, digW = 2.6*_M, gap = 1.2*_M, totalH = chars.length*digH + (chars.length-1)*gap;
          const _wp = (al, ac) => { const N = nN+uN*al+pN*ac, E = nE+uE*al+pE*ac;
            return proj(N*cosH+E*sinH, E*cosH-N*sinH, _eNm); };
          const t0 = _wp(-totalH/2, 0), t1 = _wp(-totalH/2 + digH, 0);
          if (!t0 || !t1) continue;
          const hpx = Math.hypot(t1[0]-t0[0], t1[1]-t0[1]); if (hpx < 4) continue;
          /* black background box (ICAO taxiway location sign — yellow letter on black) */
          const _bw = digW*0.9, _bo = digH*0.35;
          const _bc = [_wp(-totalH/2-_bo,-_bw), _wp(totalH/2+_bo,-_bw), _wp(totalH/2+_bo,_bw), _wp(-totalH/2-_bo,_bw)];
          if (_bc.every(Boolean)) { ctx.fillStyle = 'rgba(12,12,12,0.82)';
            ctx.beginPath(); ctx.moveTo(_bc[0][0],_bc[0][1]);
            for (let i=1;i<4;i++) ctx.lineTo(_bc[i][0],_bc[i][1]); ctx.closePath(); ctx.fill(); }
          ctx.lineWidth = Math.max(1.4, hpx*0.18);
          for (let ci=0; ci<chars.length; ci++) {
            const glyph = _RW_FONT[chars[ci]]; if (!glyph) continue;
            const base = -totalH/2 + ci*(digH+gap);
            for (const st of glyph) { ctx.beginPath(); let go=false;
              for (const [gx,gy] of st) { const sp = _wp(base + gy*digH, (gx-0.5)*digW);
                if(!sp){go=false;continue;} if(!go){ctx.moveTo(sp[0],sp[1]);go=true;} else ctx.lineTo(sp[0],sp[1]); }
              ctx.stroke(); }
          }
        }
        ctx.restore();
      }

      /* ── Apron stand lead-in lines + stand numbers (OSM aeroway=parking_position) — the
         yellow guidance line into each stand, with its number. Lead-in lines are batched
         into a single stroke (Changi has ~300); the stroke-font numbers only draw very
         close in (you only read the number of the stand you're at). */
      {
        const _M = 1/1852, _DPRp = devicePixelRatio || 1;
        const _leadCol = `rgba(224,204,72,${(0.5 + 0.32 * dayFrac).toFixed(2)})`;
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        /* pass 1 — all lead-in lines, one batched stroke */
        ctx.strokeStyle = _leadCol; ctx.lineWidth = Math.max(1, 1.3*_DPRp);
        ctx.beginPath();
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'parking_position' || !way.geometry || way.geometry.length < 2) continue;
          const g = way.geometry;
          const _0n = (g[0].lat-acLat)*60, _0e = (g[0].lon-acLon)*60*cosAcLat;
          if (_0n*_0n + _0e*_0e > 6.25) continue;                // > 2.5 nm
          const _eM = _apElevNm !== null ? null : _sampleElev(g[0].lat, g[0].lon);
          const _eNm = _apElevNm !== null ? _apElevNm : (_eM!==null?(_eM-refM)*_M:0);
          let pen = false;
          for (const nd of g) {
            const dN = (nd.lat-acLat)*60, dE = (nd.lon-acLon)*60*cosAcLat;
            if (Math.hypot(dN,dE) > 2.5 || dN*cosH+dE*sinH < -0.3) { pen = false; continue; }
            const sp = proj(dN*cosH+dE*sinH, dE*cosH-dN*sinH, _eNm);
            if (!sp) { pen = false; continue; }
            if (!pen) { ctx.moveTo(sp[0],sp[1]); pen = true; } else ctx.lineTo(sp[0],sp[1]);
          }
        }
        ctx.stroke();
        /* pass 2 — stand numbers, only the handful within ~0.6 nm */
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'parking_position' || !way.geometry || way.geometry.length < 2) continue;
          const ref = (way.tags?.ref || '').trim().toUpperCase();
          if (!ref || ref.length > 4) continue;
          const g = way.geometry, e0 = g[g.length-1], e1 = g[g.length-2];
          const sN = (e0.lat-acLat)*60, sE = (e0.lon-acLon)*60*cosAcLat;
          if (sN*sN + sE*sE > 0.36) continue;                    // > 0.6 nm: skip numbers
          const _eM = _apElevNm !== null ? null : _sampleElev(e0.lat, e0.lon);
          const _eNm = _apElevNm !== null ? _apElevNm : (_eM!==null?(_eM-refM)*_M:0);
          const dN = (e1.lat-e0.lat)*60, dE = (e1.lon-e0.lon)*60*cosAcLat;   // inward along the line
          const L = Math.hypot(dN,dE)||1, uN = dN/L, uE = dE/L, pN = -uE, pE = uN;
          const chars = [...ref];
          const digH = 3.2*_M, digW = 1.9*_M, gap = 0.9*_M;
          const _wp = (al, ac) => { const N = sN+uN*al+pN*ac, E = sE+uE*al+pE*ac;
            return proj(N*cosH+E*sinH, E*cosH-N*sinH, _eNm); };
          const q0 = _wp(digH*0.6, 0), q1 = _wp(digH*1.6, 0);
          if (!q0 || !q1) continue;
          const hpx = Math.hypot(q1[0]-q0[0], q1[1]-q0[1]); if (hpx < 3) continue;
          ctx.lineWidth = Math.max(1.2, hpx*0.16);
          ctx.beginPath();                                       // one stroke for this stand's glyphs
          for (let ci=0; ci<chars.length; ci++) {
            const glyph = _RW_FONT[chars[ci]]; if (!glyph) continue;
            const base = digH*0.6 + ci*(digH+gap);
            for (const st of glyph) { let go=false;
              for (const [gx,gy] of st) { const sp = _wp(base + gy*digH, (gx-0.5)*digW);
                if(!sp){go=false;continue;} if(!go){ctx.moveTo(sp[0],sp[1]);go=true;} else ctx.lineTo(sp[0],sp[1]); } }
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      /* ── Grass-runway edge markers — a grass strip can't be painted, so its boundary is
         marked with low white boards/cones along both edges. Day-visible (not lights). */
      {
        const _DPRg = devicePixelRatio || 1;
        ctx.fillStyle = `rgb(${228 * _f | 0},${230 * _f | 0},${222 * _f | 0})`;
        for (const rg of _runways) {
          if (!_isGrass(rg.surface)) continue;
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE)||1e-6;
          if (((aN+bN)/2)**2 + ((aE+bE)/2)**2 > 16) continue;     // >4 nm
          const uN=dN/L, uE=dE/L, pN=-uE, pE=uN, hw=(rg.widthM/1852)/2;
          const _eM=_sampleElev(rg.a.lat,rg.a.lon), _eNm=_eM!==null?(_eM-refM)*M_NM:0;
          const _mk=(N,E)=>{ const sp=proj(N*cosH+E*sinH,E*cosH-N*sinH,_eNm);
            if(sp){ ctx.beginPath(); ctx.arc(sp[0],sp[1],1.4*_DPRg,0,7); ctx.fill(); } };
          for (let t=0.019; t<L; t+=0.0378) {                     // ~70 m spacing, both edges
            _mk(aN+uN*t+pN*hw, aE+uE*t+pE*hw);
            _mk(aN+uN*t-pN*hw, aE+uE*t-pE*hw);
          }
        }
      }

      /* ── Runway lighting (dusk/night) — white edge lights + green threshold bars,
         derived from the runway centerline. ICAO-standard layout, so every runway with
         OSM geometry lights itself; brightness rises into the night. */
      const _night = 1 - dayFrac;
      if (_night > 0.12) {
        const _DPR = devicePixelRatio || 1;
        const _alpha = (0.35 + 0.55 * _night).toFixed(2);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const rg of _runways) {
          const _lit = rg.bundled ? !!rg.lit : !_isGrass(rg.surface);
          if (!_lit) continue;                                   // only light runways that are lit
          const _eM  = _sampleElev(rg.a.lat, rg.a.lon);
          const _eNm = _eM !== null ? (_eM - refM) * M_NM : 0;
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE) || 1e-6;
          const uN=dN/L, uE=dE/L, pN=-uE, pE=uN, half=(rg.widthM/1852)/2;
          const _dot=(N,E,col,sz)=>{ const f=N*cosH+E*sinH, r=E*cosH-N*sinH;
            const sp=proj(f,r,_eNm); if(!sp)return;
            ctx.fillStyle=col; ctx.beginPath(); ctx.arc(sp[0],sp[1],sz,0,Math.PI*2); ctx.fill(); };
          for (let t=0; t<=L; t+=0.0324) {            // edge lights ~60 m both sides
            _dot(aN+uN*t+pN*half, aE+uE*t+pE*half, `rgba(255,248,228,${_alpha})`, 1.5*_DPR);
            _dot(aN+uN*t-pN*half, aE+uE*t-pE*half, `rgba(255,248,228,${_alpha})`, 1.5*_DPR);
          }
          for (const e of [0, L]) for (let s=-half; s<=half+1e-9; s+=half/3)   // green threshold bars
            _dot(aN+uN*e+pN*s, aE+uE*e+pE*s, `rgba(70,255,110,${_alpha})`, 1.8*_DPR);
        }
        /* Taxiway edge lights (blue) — both sides of each taxiway centerline. Batched:
           one fillStyle, all dots as rects in a single path, one fill() (Changi's taxi
           network is enormous). Tight distance + behind culls. */
        ctx.fillStyle = `rgba(70,130,255,${_alpha})`;
        ctx.beginPath();
        const _tw = 1.3*_DPR;
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'taxiway' || !way.geometry || way.geometry.length < 2) continue;
          const _hw = ((parseFloat(way.tags?.width)||15)/1852)/2, g = way.geometry;
          const _txM = _apElevNm !== null ? null : _sampleElev(g[0].lat, g[0].lon);
          const _txNm = _apElevNm !== null ? _apElevNm : (_txM!==null?(_txM-refM)*M_NM:0);
          const _tx=(N,E)=>{ const f=N*cosH+E*sinH, r=E*cosH-N*sinH; const sp=proj(f,r,_txNm);
            if(sp){ ctx.moveTo(sp[0]+_tw, sp[1]); ctx.arc(sp[0], sp[1], _tw, 0, 7); } };
          for (let s=0;s<g.length-1;s++){
            const n0=(g[s].lat-acLat)*60, e0=(g[s].lon-acLon)*60*cosAcLat;
            const n1=(g[s+1].lat-acLat)*60, e1=(g[s+1].lon-acLon)*60*cosAcLat;
            const mN=(n0+n1)/2, mE=(e0+e1)/2;
            if (mN*mN+mE*mE > 9) continue;           // >3 nm away
            if (mN*cosH+mE*sinH < -0.4) continue;     // behind the camera
            const dN=n1-n0, dE=e1-e0, segL=Math.hypot(dN,dE)||1e-6;
            const uN=dN/segL, uE=dE/segL, pN=-uE, pE=uN;
            for (let t=0;t<segL;t+=0.022){ const cN=n0+uN*t, cE=e0+uE*t;
              _tx(cN+pN*_hw, cE+pE*_hw); _tx(cN-pN*_hw, cE-pE*_hw); }
          }
        }
        ctx.fill();
        /* Green taxiway centreline lights (paved taxiways) — additive dots along the centreline */
        ctx.fillStyle = `rgba(60,235,95,${_alpha})`;
        ctx.beginPath();
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'taxiway' || !way.geometry || way.geometry.length < 2) continue;
          if (_isGrass(way.tags?.surface)) continue;
          const g = way.geometry;
          const _cM = _apElevNm !== null ? null : _sampleElev(g[0].lat, g[0].lon);
          const _cNm = _apElevNm !== null ? _apElevNm : (_cM !== null ? (_cM - refM) * M_NM : 0);
          for (let s = 0; s < g.length - 1; s++) {
            const n0 = (g[s].lat-acLat)*60,   e0 = (g[s].lon-acLon)*60*cosAcLat;
            const n1 = (g[s+1].lat-acLat)*60, e1 = (g[s+1].lon-acLon)*60*cosAcLat;
            const mN = (n0+n1)/2, mE = (e0+e1)/2;
            if (mN*mN+mE*mE > 9 || mN*cosH+mE*sinH < -0.4) continue;
            const dN = n1-n0, dE = e1-e0, segL = Math.hypot(dN,dE)||1e-6, uN = dN/segL, uE = dE/segL;
            for (let t = 0; t < segL; t += 0.016) { const cN = n0+uN*t, cE = e0+uE*t;
              const sp = proj(cN*cosH+cE*sinH, cE*cosH-cN*sinH, _cNm);
              if (sp) { ctx.moveTo(sp[0]+_tw, sp[1]); ctx.arc(sp[0], sp[1], _tw, 0, 7); } }
          }
        }
        ctx.fill();
        ctx.restore();
      }

      /* ── Painted runway designators (day + night) — the number on each threshold,
         projected onto the surface so it foreshortens and reads on approach. The digit
         for an end is the one whose outbound bearing matches (round(bearing/10)). */
      {
        const _digH = 0.0108, _digW = 0.0049, _gap = 0.0022, _uStart = 0.022;   // nm (~20/9/4/40 m)
        ctx.save();
        ctx.fillStyle = 'rgba(236,239,243,0.85)';   // off-white paint — FILLED ribbons so the
        ctx.lineJoin = 'miter';                      // strokes foreshorten with the surface (flat), like the piano keys
        for (const rg of _runways) {
          if (_isGrass(rg.surface)) continue;                   // grass strips aren't numbered
          const parts = (rg.ref || '').split('/').map(s => s.trim()).filter(Boolean);
          const _eM = _sampleElev(rg.a.lat, rg.a.lon);
          const _eNm = _eM !== null ? (_eM - refM) * M_NM : 0;
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE) || 1e-6;
          const uN=dN/L, uE=dE/L;
          const brgAB = (Math.atan2(dE, dN) * 180/Math.PI + 360) % 360;
          const numAt = (b) => { const n = Math.round((((b%360)+360)%360)/10); return n===0?36:n; };
          const _fb  = (b) => ('0'+numAt(b)).slice(-2);   // bearing-derived "07" when no ref
          /* Prefer the official ref (e.g. "06/24"): runways are named by MAGNETIC heading, so
             the true bearing can round one off (65.6° → 07 vs the correct 06). Assign each ref
             part to the end whose bearing is closest to it (circular distance over 36). */
          const _desAt = (b) => {
            if (!parts.length) return _fb(b);
            const t = numAt(b); let best = parts[0], bd = 99;
            for (const p of parts) { const n = parseInt(p,10); let d = Math.abs(n-t); d = Math.min(d, 36-d); if (d < bd) { bd = d; best = p; } }
            return best;
          };
          /* official per-end designator (le at threshold a, he at b); fall back to ref/bearing */
          const ends = [
            { T:[aN,aE], iN: uN, iE: uE,  des: rg.leId || _desAt(brgAB)     },
            { T:[bN,bE], iN:-uN, iE:-uE,  des: rg.heId || _desAt(brgAB+180) },
          ];
          for (const e of ends) {
            if (!e.des) continue;
            const chars = e.des.split('');
            const perpN = -e.iE, perpE = e.iN;
            const totalW = chars.length*_digW + (chars.length-1)*_gap;
            const _wp = (al, ac) => { const N=e.T[0]+e.iN*al+perpN*ac, E=e.T[1]+e.iE*al+perpE*ac;
              return proj(N*cosH+E*sinH, E*cosH-N*sinH, _eNm); };
            const p0 = _wp(_uStart, 0), p1 = _wp(_uStart+_digH, 0);
            if (!p0 || !p1) continue;
            const hpx = Math.hypot(p1[0]-p0[0], p1[1]-p0[1]);
            if (hpx < 3) continue;            // too small/distant to read
            const _sw = _digW * 0.12;          // stroke half-width in surface NM → foreshortens with the runway
            for (let ci=0; ci<chars.length; ci++) {
              const glyph = _RW_FONT[chars[ci]]; if (!glyph) continue;
              const cV = -totalW/2 + ci*(_digW+_gap) + _digW/2;
              for (const stroke of glyph) {
                /* Buffer the glyph polyline to a filled ribbon in (along, across) surface
                   coords, then project — so the paint lies flat on the runway like the piano
                   keys, instead of a constant-screen-width stroke that reads as a tube. */
                const _pts = stroke.map(([gx,gy]) => [_uStart + gy*_digH, cV + (gx-0.5)*_digW]);
                const _Ls=[], _Rs=[];
                for (let i=0;i<_pts.length;i++){
                  const a=_pts[Math.max(0,i-1)], b=_pts[Math.min(_pts.length-1,i+1)];
                  let dA=b[0]-a[0], dC=b[1]-a[1]; const ln=Math.hypot(dA,dC)||1e-9; dA/=ln; dC/=ln;
                  _Ls.push([_pts[i][0]-dC*_sw, _pts[i][1]+dA*_sw]);
                  _Rs.push([_pts[i][0]+dC*_sw, _pts[i][1]-dA*_sw]);
                }
                const _ring=_Ls.concat(_Rs.reverse());
                ctx.beginPath(); let go=false;
                for (const [al,ac] of _ring){ const sp=_wp(al,ac);
                  if(!sp){go=false;continue;} if(!go){ctx.moveTo(sp[0],sp[1]);go=true;}else ctx.lineTo(sp[0],sp[1]); }
                if(go){ctx.closePath(); ctx.fill();}
              }
            }
          }
        }
        ctx.restore();
      }

      /* ── PAPI (day + night) — 4-light glideslope bar to the left of each runway,
         abeam the aiming point. Each unit shows white if the viewer's elevation angle
         is above its set angle, red if below (2.5/2.83/3.17/3.5° from the runway out),
         so a 3° approach reads two-white-two-red. Derived from threshold + viewer. */
      {
        const _DPR = devicePixelRatio || 1;
        const _SET = [2.5, 2.83, 3.17, 3.5];   // unit angles, nearest runway → farthest
        const _aim = 0.162, _sp = 0.0049;      // ~300 m along to the bar, ~9 m unit spacing (nm)
        const _vAGLnm = ((S.alt ?? 0) - elevFt) / 6076.12;   // viewer height above the field
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const rg of _runways) {
          if (!(rg.bundled ? !!rg.lit : !_isGrass(rg.surface))) continue;   // PAPI only where lit
          const _eM = _sampleElev(rg.a.lat, rg.a.lon);
          const _eNm = _eM !== null ? (_eM - refM) * M_NM : 0;
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE) || 1e-6;
          const uN=dN/L, uE=dE/L, edge=(rg.widthM/1852)/2 + 0.008;   // half-width + ~15 m left
          for (const e of [ {iN:uN,iE:uE,T:[aN,aE]}, {iN:-uN,iE:-uE,T:[bN,bE]} ]) {
            const lN=e.iE, lE=-e.iN;   // approach pilot's left
            for (let i=0;i<4;i++){
              const ac = edge + i*_sp;
              const N = e.T[0] + e.iN*_aim + lN*ac, E = e.T[1] + e.iE*_aim + lE*ac;
              const ang = Math.atan2(_vAGLnm, Math.hypot(N,E)||1e-6) * 180/Math.PI;
              const sp = proj(N*cosH+E*sinH, E*cosH-N*sinH, _eNm); if (!sp) continue;
              ctx.fillStyle = ang >= _SET[i] ? 'rgba(255,255,255,0.95)' : 'rgba(255,45,45,0.95)';
              ctx.beginPath(); ctx.arc(sp[0], sp[1], 1.9*_DPR, 0, 7); ctx.fill();
            }
          }
        }
        ctx.restore();
      }

      /* ── Hold-short markings (ICAO pattern A) — two solid + two dashed yellow lines
         across the taxiway at each holding position; solid on the holding side, dashed
         toward the runway. Painted, so day + night. */
      {
        const _M = 1/1852;
        ctx.save();
        ctx.strokeStyle = 'rgba(230,196,40,0.9)'; ctx.lineCap = 'butt';
        for (const el of _osmWays) {
          if (el.type !== 'node' || el.tags?.aeroway !== 'holding_position') continue;
          { const _ht = el.tags?.['holding_position:type']; if (_ht && _ht !== 'runway' && _ht !== 'ILS') continue; }   // runway holds only (skip intermediate/movement)
          const nN=(el.lat-acLat)*60, nE=(el.lon-acLon)*60*cosAcLat;
          if (nN*nN+nE*nE > 9) continue;
          const hi=_holdInfo(el,_osmWays,_runways); if(!hi) continue;
          const _un=hi.uLat*60, _ue=hi.uLon*60*cosAcLat, ul=Math.hypot(_un,_ue)||1;
          const uN=_un/ul, uE=_ue/ul, pN=-uE, pE=uN, hw=(hi.width/1852)/2;
          const _eM=_sampleElev(el.lat,el.lon), _e0=(_eM!==null?(_eM-refM)*_M:0);
          const _pt=(al,ac)=>{ const N=nN+uN*al+pN*ac, E=nE+uE*al+pE*ac;
            return proj(N*cosH+E*sinH,E*cosH-N*sinH,_e0); };
          const _q0=_pt(0,0), _q1=_pt(0.3*_M,0); if(!_q0||!_q1) continue;
          ctx.lineWidth = Math.max(1.5, Math.hypot(_q1[0]-_q0[0],_q1[1]-_q0[1]));
          const _line=(al,dash)=>{
            if(!dash){ const a=_pt(al,-hw), b=_pt(al,hw); if(a&&b){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();} }
            else { const s=0.9*_M, g=0.9*_M; for(let c=-hw;c<hw-1e-9;c+=s+g){ const a=_pt(al,c), b=_pt(al,Math.min(hw,c+s)); if(a&&b){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();} } }
          };
          if (el.tags?.['holding_position:type'] === 'ILS') {
            /* ILS / CAT II-III critical-area hold: the "ladder" marking — two solid rails
               across the taxiway joined by perpendicular rungs (distinct from pattern A). */
            _line(-0.5*_M,false); _line(0.5*_M,false);
            for(let c=-hw;c<=hw+1e-9;c+=1.1*_M){ const a=_pt(-0.5*_M,c), b=_pt(0.5*_M,c);
              if(a&&b){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();} }
          } else {
            _line(-0.6*_M,false); _line(-0.2*_M,false); _line(0.2*_M,true); _line(0.6*_M,true);
          }
        }
        ctx.restore();
      }

      /* ── Runway guard lights (wig-wag) at holding positions — a flashing yellow pair,
         one each side of the taxiway hold-short, alternating ~0.9 s. Day + night. */
      {
        const _DPR = devicePixelRatio || 1;
        const _on = (performance.now() % 900) < 450;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const el of _osmWays) {
          if (el.type !== 'node' || el.tags?.aeroway !== 'holding_position') continue;
          { const _ht = el.tags?.['holding_position:type']; if (_ht && _ht !== 'runway' && _ht !== 'ILS') continue; }   // runway holds only (skip intermediate/movement)
          const nN=(el.lat-acLat)*60, nE=(el.lon-acLon)*60*cosAcLat;
          if (nN*nN+nE*nE > 9) continue;            // >3 nm
          const _eM=_sampleElev(el.lat,el.lon), _eNm=_eM!==null?(_eM-refM)*M_NM:0;
          const hi=_holdInfo(el,_osmWays,_runways);
          let pN=0,pE=1;
          if (hi){ const dN=hi.uLat*60, dE=hi.uLon*60*cosAcLat, dl=Math.hypot(dN,dE)||1; pN=-dE/dl; pE=dN/dl; }
          const half=0.0095;                         // ~17 m to each side
          const _gl=(N,E,lit)=>{ const f=N*cosH+E*sinH, r=E*cosH-N*sinH; const sp=proj(f,r,_eNm); if(!sp)return;
            ctx.fillStyle = lit ? 'rgba(255,205,30,0.98)' : 'rgba(90,65,8,0.6)';
            ctx.beginPath(); ctx.arc(sp[0],sp[1],2.0*_DPR,0,7); ctx.fill(); };
          _gl(nN+pN*half, nE+pE*half, _on);
          _gl(nN-pN*half, nE-pE*half, !_on);
        }
        ctx.restore();
      }

      /* ── Red runway-holding sign at each holding position — white runway designation
         on red, on a post beside the taxiway, facing the taxiing aircraft. The text is
         the stroke font projected onto the (vertical) sign face. */
      {
        const _DPR = devicePixelRatio || 1, _M = 1/1852;
        const h0 = 1.0*_M, h1 = 2.7*_M;             // board bottom / top elevation (nm)
        const _cW = 1.3*_M, _gp = 0.5*_M, _side = 0.009;   // char width, gap, side offset (~17 m)
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const el of _osmWays) {
          if (el.type !== 'node' || el.tags?.aeroway !== 'holding_position') continue;
          { const _ht = el.tags?.['holding_position:type']; if (_ht && _ht !== 'runway' && _ht !== 'ILS') continue; }   // runway holds only (skip intermediate/movement)
          const nN=(el.lat-acLat)*60, nE=(el.lon-acLon)*60*cosAcLat;
          if (nN*nN+nE*nE > 6.25) continue;          // >2.5 nm (signs only read close)
          const hi=_holdInfo(el,_osmWays,_runways); if (!hi) continue;
          const _un=hi.uLat*60, _ue=hi.uLon*60*cosAcLat, ul=Math.hypot(_un,_ue)||1;
          const uN=_un/ul, uE=_ue/ul;                    // taxiway dir, toward the runway
          const txt = el.tags?.['holding_position:type'] === 'ILS' ? 'ILS' : hi.des;
          if (!txt) continue;
          const aN=uE, aE=-uN;                           // across = front-viewer's right
          const _eM=_sampleElev(el.lat,el.lon), _e0=(_eM!==null?(_eM-refM)*_M:0);
          const sN=nN+aN*_side, sE=nE+aE*_side;          // sign centre, beside the taxiway
          const inFront = ((-uN)*(-sN) + (-uE)*(-sE)) > 0;   // camera on the front (pilot) side
          const _bp=(across,up)=>{ const N=sN+aN*across, E=sE+aE*across;
            return proj(N*cosH+E*sinH, E*cosH-N*sinH, _e0+up); };
          const chars=[...txt];
          const totalW=chars.length*_cW+(chars.length-1)*_gp;
          const q0=_bp(0,h0), q1=_bp(0,h1); if(!q0||!q1) continue;
          const hpx=Math.hypot(q1[0]-q0[0],q1[1]-q0[1]); if(hpx<5) continue;
          /* red board (solid both sides — text only on the front, so the back stays red) */
          const mW=totalW/2+_cW*0.4;
          const c0=_bp(-mW,h0), c1=_bp(mW,h0), c2=_bp(mW,h1), c3=_bp(-mW,h1);
          if (c0&&c1&&c2&&c3){
            ctx.fillStyle='rgba(176,28,28,0.96)';
            ctx.beginPath(); ctx.moveTo(c0[0],c0[1]); ctx.lineTo(c1[0],c1[1]);
            ctx.lineTo(c2[0],c2[1]); ctx.lineTo(c3[0],c3[1]); ctx.closePath(); ctx.fill();
            const pb=_bp(0,0), pt=_bp(0,h0);
            if(pb&&pt){ ctx.strokeStyle='rgba(70,74,80,0.9)'; ctx.lineWidth=Math.max(1,hpx*0.08);
              ctx.beginPath(); ctx.moveTo(pb[0],pb[1]); ctx.lineTo(pt[0],pt[1]); ctx.stroke(); }
          }
          {
            /* Readable from whichever side the camera is on — mirror the glyphs for the
               far side so the text never reads backwards (you view it from the runway when
               lined up, from the taxiway when taxiing in). */
            const _mir = inFront ? -1 : 1;
            ctx.strokeStyle='rgba(245,247,250,0.95)'; ctx.lineWidth=Math.max(1,hpx*0.07);
            const _cH=(h1-h0)*0.6, _cY=h0+(h1-h0)*0.2;
            for (let ci=0;ci<chars.length;ci++){
              const gl=_RW_FONT[chars[ci]]; if(!gl) continue;
              const cx=-totalW/2+ci*(_cW+_gp)+_cW/2;
              for (const st of gl){ ctx.beginPath(); let go=false;
                for (const [gx,gy] of st){ const sp=_bp(_mir*(cx+(gx-0.5)*_cW), _cY+gy*_cH);
                  if(!sp){go=false;continue;} if(!go){ctx.moveTo(sp[0],sp[1]);go=true;}else ctx.lineTo(sp[0],sp[1]); }
                ctx.stroke(); }
            }
          }
        }
        ctx.restore();
      }

      /* ── Windsock (OSM aeroway=windsock, plus hand-added WINDSOCKS for fields OSM hasn't
         mapped) — points downwind from the live METAR wind and inflates with wind speed.
         The iconic small-field marker and a real airmanship cue — high ROI for training. */
      {
        const _wind = _windNow();
        const _tInf = Math.max(0, Math.min(1, _wind.spd / 14));   // 0 calm … 1 fully streamed
        const _toBrg = (_wind.dir + 180) * DEG;                   // bearing the sock points to
        const hN = Math.cos(_toBrg), hE = Math.sin(_toBrg);       // downwind horizontal unit (N,E)
        const aN = hE, aE = -hN;                                  // across-wind (cone width axis)
        const _wBr = 0.4 + 0.6 * dayFrac;                         // day↔night dim
        const _BAND = [[232, 116, 24], [238, 238, 238]];          // orange / white
        const M = M_NM, poleH = 6, sockLen = 4.2, mouthR = 0.55, tailR = 0.22, NS = 6;
        const _socks = [];
        for (const el of _osmWays)
          if (el.type === 'node' && el.tags?.aeroway === 'windsock') _socks.push(el);
        for (const _ic of [S.mission?.departure?.icao, S.mission?.arrival?.icao])
          if (_ic && WINDSOCKS[_ic]) for (const w of WINDSOCKS[_ic]) _socks.push(w);
        for (const el of _socks) {
          const nN = (el.lat - acLat) * 60, nE = (el.lon - acLon) * 60 * cosAcLat;
          if (nN * nN + nE * nE > 9) continue;                    // > 3 nm
          const _eM = _sampleElev(el.lat, el.lon), e0 = _eM !== null ? (_eM - refM) * M_NM : 0;
          const _P = (dn, de, up) => proj((nN + dn) * cosH + (nE + de) * sinH,
                                          (nE + de) * cosH - (nN + dn) * sinH, e0 + up);
          const pb = _P(0, 0, 0), pt = _P(0, 0, poleH * M);
          if (!pb || !pt) continue;
          ctx.strokeStyle = `rgb(${120 * _wBr | 0},${122 * _wBr | 0},${128 * _wBr | 0})`;
          ctx.lineWidth = Math.max(1, Math.hypot(pt[0] - pb[0], pt[1] - pb[1]) * 0.06);
          ctx.beginPath(); ctx.moveTo(pb[0], pb[1]); ctx.lineTo(pt[0], pt[1]); ctx.stroke();
          /* sock axis: from pole top, downwind reach + droop both driven by wind speed */
          const reach = sockLen * (0.28 + 0.72 * _tInf);
          const tipUp = poleH - sockLen * (0.85 - 0.78 * _tInf);
          const cen = [], edg = [];
          for (let i = 0; i < NS; i++) {
            const s = i / (NS - 1), r = mouthR + (tailR - mouthR) * s;
            const dn = hN * reach * s * M, de = hE * reach * s * M, up = (poleH + (tipUp - poleH) * s) * M;
            cen.push(_P(dn, de, up));
            edg.push(_P(dn + aN * r * M, de + aE * r * M, up));   // r in metres → × M (nm)
          }
          for (let i = 0; i < NS - 1; i++) {
            const c0 = cen[i], c1 = cen[i + 1], o0 = edg[i], o1 = edg[i + 1];
            if (!c0 || !c1 || !o0 || !o1) continue;
            const c = _BAND[i % 2];
            ctx.fillStyle = `rgb(${c[0] * _wBr | 0},${c[1] * _wBr | 0},${c[2] * _wBr | 0})`;
            ctx.beginPath();
            ctx.moveTo(2 * c0[0] - o0[0], 2 * c0[1] - o0[1]);     // c0 - (edge-c0) = mirror
            ctx.lineTo(o0[0], o0[1]);
            ctx.lineTo(o1[0], o1[1]);
            ctx.lineTo(2 * c1[0] - o1[0], 2 * c1[1] - o1[1]);
            ctx.closePath(); ctx.fill();
          }
        }
      }
    }
  }

  /* ── Control tower — bundled OSM position + height, hand-curated silhouette.
     Built as a stack of polygonal rings (real depth-sorted faces): tapered shaft,
     flared cab with outward-canted glass, roof, beacon. Style picks the proportions. */
  if (!isWater && !isRocket) {
    const TAU = Math.PI * 2, M = M_NM, _DPR = devicePixelRatio || 1;
    const LN = 0.45, LE = 0.62;                       // fixed key-light azimuth (world N/E)
    const _gBr = 0.42 + 0.58 * dayFrac;               // overall day↔night brightness
    const _nightF = 1 - dayFrac;

    const _drawTower = (cN, cE, e0, style, heightM) => {
      let H, sides, base, neck, cabBot, cabTop, shaftTop, cabH, mast, baseBldg;
      if (style === 'modern') {
        H = heightM || 60; sides = 14;
        base = Math.min(5, H * 0.05); neck = H * 0.034; cabBot = H * 0.05; cabTop = H * 0.064;
        shaftTop = H * 0.80; cabH = H * 0.12; mast = H * 0.14; baseBldg = 0;
      } else if (style === 'regional') {
        H = heightM || 18; sides = 8;
        base = H * 0.12; neck = H * 0.095; cabBot = H * 0.15; cabTop = H * 0.185;
        shaftTop = H * 0.62; cabH = H * 0.24; mast = H * 0.06; baseBldg = H * 0.24;
      } else {                                          // classic — tall slender shaft + flared cab
        H = heightM || 38; sides = 8;
        base = Math.min(6, H * 0.085); neck = H * 0.072; cabBot = H * 0.088; cabTop = H * 0.125;
        shaftTop = H * 0.74; cabH = H * 0.15; mast = H * 0.08; baseBldg = 0;
      }
      const galH = H * 0.022, galR = cabTop * 1.14;     // catwalk gallery — overhangs the shaft
      const roofH = H * 0.03,  roofR = cabTop * 1.2;    // roof — overhangs the cab
      const cabBaseY = shaftTop + galH;
      const roofY    = cabBaseY + cabH + roofH;
      /* profile rings bottom→top; glassIdx = cab-wall (canted glass) strip, dark = the
         catwalk + roof overhang strips (charcoal metal — the control-tower signature). */
      const rings = []; const dark = new Set();
      if (baseBldg > 0) rings.push({ y: 0, r: base * 1.6 }, { y: baseBldg, r: base * 1.6 }, { y: baseBldg, r: base });
      else rings.push({ y: 0, r: base });
      rings.push({ y: shaftTop, r: neck });
      dark.add(rings.length - 1); rings.push({ y: shaftTop, r: galR });   // catwalk underside (overhang)
      dark.add(rings.length - 1); rings.push({ y: cabBaseY, r: galR });   // catwalk outer edge
      rings.push({ y: cabBaseY, r: cabBot });                             // catwalk top → cab base
      const glassIdx = rings.length - 1;
      rings.push({ y: cabBaseY + cabH, r: cabTop });                      // flared canted glass
      dark.add(rings.length - 1); rings.push({ y: cabBaseY + cabH, r: roofR }); // roof underside (overhang)
      dark.add(rings.length - 1); rings.push({ y: roofY, r: roofR });     // roof outer edge
      dark.add(rings.length - 1); rings.push({ y: roofY, r: roofR * 0.5 }); // roof slope → cap

      const P = (a, r, y) => [cN + Math.cos(a) * r * M, cE + Math.sin(a) * r * M, e0 + y * M];
      const faces = [];
      for (let i = 0; i < rings.length - 1; i++) {
        const r0 = rings[i], r1 = rings[i + 1];
        for (let k = 0; k < sides; k++) {
          const a0 = k / sides * TAU, a1 = (k + 1) / sides * TAU, mid = (a0 + a1) / 2;
          faces.push({ p: [P(a0, r0.r, r0.y), P(a1, r0.r, r0.y), P(a1, r1.r, r1.y), P(a0, r1.r, r1.y)],
                       glass: i === glassIdx, dark: dark.has(i), nr: Math.cos(mid) * LN + Math.sin(mid) * LE });
        }
      }
      const top = rings[rings.length - 1], cap = [];     // roof cap polygon
      for (let k = 0; k < sides; k++) { const a = k / sides * TAU; cap.push(P(a, top.r, top.y)); }
      faces.push({ p: cap, cap: true, nr: 1 });

      for (const f of faces) { let s = 0; for (const v of f.p) s += v[0] * cosH + v[1] * sinH; f.fwd = s; }
      faces.sort((a, b) => b.fwd - a.fwd);               // painter: far → near

      for (const f of faces) {
        const sp = []; let ok = true;
        for (const v of f.p) { const q = proj(v[0] * cosH + v[1] * sinH, v[1] * cosH - v[0] * sinH, v[2]); if (!q) { ok = false; break; } sp.push(q); }
        if (!ok) continue;
        const sh = 0.55 + 0.45 * Math.max(0, f.nr);
        if (f.glass) {
          const r = 66 + (150 - 66) * _nightF, g = 86 + (205 - 86) * _nightF, b = 116 + (235 - 116) * _nightF;
          ctx.fillStyle = `rgb(${r * (_nightF ? 1 : _gBr) | 0},${g * (_nightF ? 1 : _gBr) | 0},${b * (_nightF ? 1 : _gBr) | 0})`;
        } else if (f.cap) {
          const b = 0.72 * _gBr; ctx.fillStyle = `rgb(${70 * b | 0},${74 * b | 0},${80 * b | 0})`;
        } else if (f.dark) {                              // catwalk + roof overhang (charcoal metal)
          const b = (0.5 + 0.4 * Math.max(0, f.nr)) * _gBr; ctx.fillStyle = `rgb(${56 * b | 0},${58 * b | 0},${66 * b | 0})`;
        } else {
          const b = sh * _gBr; ctx.fillStyle = `rgb(${172 * b | 0},${174 * b | 0},${180 * b | 0})`;
        }
        ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
        ctx.closePath(); ctx.fill();
      }

      /* mast (modern) + flashing red obstruction beacon at the very top */
      const beaconY = roofY + mast;
      if (mast > 0) {
        const a = proj(cN * cosH + cE * sinH, cE * cosH - cN * sinH, e0 + roofY * M);
        const b = proj(cN * cosH + cE * sinH, cE * cosH - cN * sinH, e0 + beaconY * M);
        if (a && b) { ctx.strokeStyle = `rgb(${150 * _gBr | 0},${152 * _gBr | 0},${158 * _gBr | 0})`;
          ctx.lineWidth = 1.6 * _DPR;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      }
      const bp = proj(cN * cosH + cE * sinH, cE * cosH - cN * sinH, e0 + (beaconY + 0.6) * M);
      if (bp) {
        const on = performance.now() % 1800 < 160;
        ctx.save();
        if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,40,30,0.95)';
          ctx.beginPath(); ctx.arc(bp[0], bp[1], 3.2 * _DPR, 0, TAU); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = on ? 'rgba(255,90,80,1)' : 'rgba(120,20,16,0.9)';
        ctx.beginPath(); ctx.arc(bp[0], bp[1], 1.6 * _DPR, 0, TAU); ctx.fill();
        ctx.restore();
      }
    };

    for (const ic of [S.mission?.departure?.icao, S.mission?.arrival?.icao]) {
      const tw = ic && TOWERS[ic];
      if (!tw) continue;
      const tN = (tw.lat - acLat) * 60, tE = (tw.lon - acLon) * 60 * cosAcLat;
      if (tN * tN + tE * tE > 144) continue;            // >12 nm: skip
      const _eM = _sampleElev(tw.lat, tw.lon);
      const e0 = _eM !== null ? (_eM - refM) * M_NM : 0;
      _drawTower(tN, tE, e0, tw.style || 'classic', tw.heightM);
    }

    /* ── Terminal massing — derived, not modelled. Cluster the bundled gates by their
       ref-prefix (each letter = a concourse) and draw a low wireframe block landside of
       the gate line. The gates nose IN toward the building, so the frontage runs ⟂ to
       the nose-in heading and the mass sits just past where the noses stop. */
    for (const ic of [S.mission?.departure?.icao, S.mission?.arrival?.icao]) {
      const gates = ic && STANDS[ic];
      if (!gates || gates.length < 2) continue;
      const groups = {};
      for (const g of gates) { const k = (g.ref.match(/^[A-Za-z]+/) || ['?'])[0].toUpperCase();
        (groups[k] = groups[k] || []).push(g); }
      for (const grp of Object.values(groups)) {
        if (grp.length < 2) continue;
        const cLat = grp.reduce((s,g)=>s+g.lat,0)/grp.length;
        const cLon = grp.reduce((s,g)=>s+g.lon,0)/grp.length;
        const cosC = Math.cos(cLat*DEG);
        /* Frontage axis from the gate POSITIONS (PCA) — robust to angled/fanned stands,
           where the nose-in headings splay and their average misleads. The headings are
           used only to choose which side (landside) the building sits on. */
        let Sxx=0,Syy=0,Sxy=0, hE=0,hN=0;
        for (const g of grp){ const x=(g.lon-cLon)*111320*cosC, y=(g.lat-cLat)*111320;
          Sxx+=x*x; Syy+=y*y; Sxy+=x*y; hE+=Math.sin(g.hdg*DEG); hN+=Math.cos(g.hdg*DEG); }
        const th=0.5*Math.atan2(2*Sxy, Sxx-Syy);        // principal axis of the gate line
        const e1E=Math.cos(th), e1N=Math.sin(th);       // frontage direction (East,North)
        let nE=-e1N, nN=e1E;                            // ⟂ frontage
        if (nE*hE+nN*hN < 0){ nE=-nE; nN=-nN; }         // point toward the building (landside)
        let amin=1e9, amax=-1e9;
        for (const g of grp){ const dE=(g.lon-cLon)*111320*cosC, dN=(g.lat-cLat)*111320;
          const a=dE*e1E+dN*e1N; if(a<amin)amin=a; if(a>amax)amax=a; }
        if ((amax-amin) > 1200) continue;               // sanity: not one giant block
        const FRONT=12, DEPTH=42, MARGIN=14, H=11;      // metres
        const corner=(a,b)=>{ const dE=a*e1E+b*nE, dN=a*e1N+b*nN;
          return [cLat+dN/111320, cLon+dE/(111320*cosC)]; };
        const foot=[corner(amin-MARGIN,FRONT), corner(amax+MARGIN,FRONT),
                    corner(amax+MARGIN,FRONT+DEPTH), corner(amin-MARGIN,FRONT+DEPTH)];
        const f0N=(foot[0][0]-acLat)*60, f0E=(foot[0][1]-acLon)*60*cosAcLat;
        if (f0N*f0N+f0E*f0E > 25) continue;             // >5 nm: skip
        const _emT=_sampleElev(cLat,cLon), e0=_emT!==null?(_emT-refM)*M_NM:0, up=e0+H*M_NM;
        const P=(ll,u)=>{ const N=(ll[0]-acLat)*60, E=(ll[1]-acLon)*60*cosAcLat;
          return proj(N*cosH+E*sinH, E*cosH-N*sinH, u); };
        const bot=foot.map(ll=>P(ll,e0)), top=foot.map(ll=>P(ll,up));
        if (top.every(p=>p)){ ctx.fillStyle='rgba(70,82,96,0.22)'; ctx.beginPath();
          ctx.moveTo(top[0][0],top[0][1]); for(let i=1;i<4;i++)ctx.lineTo(top[i][0],top[i][1]);
          ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle='rgba(150,170,190,0.7)'; ctx.lineWidth=1.2*(devicePixelRatio||1);
        ctx.beginPath();
        for(let i=0;i<4;i++){ const a=bot[i],b=bot[(i+1)%4],c=top[i],d=top[(i+1)%4];
          if(a&&b){ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);}
          if(c&&d){ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);}
          if(a&&c){ctx.moveTo(a[0],a[1]);ctx.lineTo(c[0],c[1]);}
        }
        ctx.stroke();
      }
    }

    /* ── Jet bridges + apron flood lamps — derived per gate (not modelled). Each bridge
       follows its OWN gate's nose-in heading (robust where stands fan out, like BZN),
       running a short elevated tube from the terminal frontage out toward the aircraft's
       forward-left door. One flood-lamp pole stands beside each bridge — faint by day,
       glowing at dusk/night to add apron detail. */
    for (const ic of [S.mission?.departure?.icao, S.mission?.arrival?.icao]) {
      const gates = ic && STANDS[ic];
      if (!gates) continue;
      const _nightF = 1 - dayFrac, _dpr = devicePixelRatio || 1;
      for (const g of gates) {
        const gN = (g.lat - acLat) * 60, gE = (g.lon - acLon) * 60 * cosAcLat;
        if (gN * gN + gE * gE > 25) continue;             // >5 nm: skip
        const gCos = Math.cos(g.lat * DEG);
        const hE = Math.sin(g.hdg * DEG), hN = Math.cos(g.hdg * DEG); // nose-in (toward terminal)
        const lE = -hN, lN = hE;                          // aircraft-left
        const _emG = _sampleElev(g.lat, g.lon);
        const e0 = _emG !== null ? (_emG - refM) * M_NM : 0;
        /* (fwd along nose, side to left) metres + height(m) → projected screen point */
        const GP = (fwd, side, hM) => {
          const dE = fwd * hE + side * lE, dN = fwd * hN + side * lN;
          const la = g.lat + dN / 111320, lo = g.lon + dE / (111320 * gCos);
          const N = (la - acLat) * 60, E = (lo - acLon) * 60 * cosAcLat;
          return proj(N * cosH + E * sinH, E * cosH - N * sinH, e0 + hM * M_NM);
        };

        /* Articulated bridge: a round rotunda fixed at the terminal (the swivel pivot)
           with a long two-section telescoping arm reaching out to the aircraft door. The
           whole arm pivots slowly about the rotunda; its wheeled drive bogie traces the
           arc on the apron. */
        const BR_W = 3, LEFT = 4, FLOOR = 3.6, THK = 2.4, ROOF = FLOOR + THK;
        const fT = 13, fDoor = -8, LEN = fT - fDoor;      // rotunda(terminal) → door reach (~21 m / 69 ft)
        /* Swivel + lift animation off — bridges rest docked; the slow sweeps will be
           driven on demand (docking sequence) later. */
        const _phi = 0, _lift = 3.4;                      // _phi: arm angle · _lift: cab height
        const R = [fT, LEFT];                             // rotunda / pivot
        const dx = -Math.cos(_phi), dy = Math.sin(_phi);  // arm dir in (fwd,side): door at phi=0
        const armPt = (t) => [R[0] + LEN * t * dx, R[1] + LEN * t * dy]; // t:0=rotunda 1=cab

        /* Box along centreline p0→p1 ([fwd,side]); floor h0 at p0, h1 at p1 (the arm
           slopes — level at the rotunda, raised/lowered at the cab). */
        const _segBox = (p0, p1, w, h0, h1) => {
          const aF = p1[0]-p0[0], aS = p1[1]-p0[1], L = Math.hypot(aF,aS) || 1;
          const px = -aS/L * (w/2), py = aF/L * (w/2);
          const cn = (p, s, h) => GP(p[0] + s*px, p[1] + s*py, h);
          const bt = [cn(p0,1,h0), cn(p0,-1,h0), cn(p1,-1,h1), cn(p1,1,h1)];
          const tp = [cn(p0,1,h0+THK), cn(p0,-1,h0+THK), cn(p1,-1,h1+THK), cn(p1,1,h1+THK)];
          if (tp.every(p => p)) { ctx.fillStyle = 'rgba(120,134,150,0.30)'; ctx.beginPath();
            ctx.moveTo(tp[0][0],tp[0][1]); for (let i=1;i<4;i++) ctx.lineTo(tp[i][0],tp[i][1]);
            ctx.closePath(); ctx.fill(); }
          ctx.strokeStyle = 'rgba(170,186,202,0.78)'; ctx.lineWidth = 1.1 * _dpr; ctx.beginPath();
          for (let i=0;i<4;i++){ const a=bt[i],b=bt[(i+1)%4],c=tp[i],d=tp[(i+1)%4];
            if(a&&b){ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);}
            if(c&&d){ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);}
            if(a&&c){ctx.moveTo(a[0],a[1]);ctx.lineTo(c[0],c[1]);} }
          ctx.stroke();
        };
        _segBox(armPt(0), armPt(1), BR_W, FLOOR, _lift);  // single arm: level → lifted at cab

        /* Round rotunda drum at the terminal (bridge level), sitting on a slimmer round
           support column down to the ground. */
        const RR = 1.9, RN = 8;
        const _cyl = (rad, h0, h1) => {
          const b=[], t=[];
          for (let k=0;k<RN;k++){ const a=k/RN*Math.PI*2, cx=Math.cos(a)*rad, sy=Math.sin(a)*rad;
            b.push(GP(fT+cx, LEFT+sy, h0)); t.push(GP(fT+cx, LEFT+sy, h1)); }
          ctx.beginPath();
          for (let k=0;k<RN;k++){ const p=b[k],q=b[(k+1)%RN],c=t[k],d=t[(k+1)%RN];
            if(p&&q){ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}
            if(c&&d){ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);}
            if(p&&c){ctx.moveTo(p[0],p[1]);ctx.lineTo(c[0],c[1]);} }
          ctx.stroke();
        };
        ctx.strokeStyle = 'rgba(182,198,212,0.82)'; ctx.lineWidth = 1.1 * _dpr;
        _cyl(0.9, 0, FLOOR + 0.3);          // support column (ground → bridge floor)
        _cyl(RR, FLOOR - 0.3, ROOF + 0.5);  // rotunda drum at bridge level

        /* Lift column + steerable drive bogie under the cab: two vertical struts joined
           by a top beam and a bottom bar; below a central pivot, a lower bar carries the
           four tyres and pivots to steer the bridge. */
        const Bp = armPt(0.88), qx = -dy, qy = dx, hw = BR_W/2;
        const STR_TOP = 8, H_CH = 1.3, WR = 0.55, AX = WR + 0.25, SB = 0.9, WT = 0.45;
        const sLx = Bp[0]+qx*hw, sLy = Bp[1]+qy*hw, sRx = Bp[0]-qx*hw, sRy = Bp[1]-qy*hw;
        const tL=GP(sLx,sLy,STR_TOP), tR=GP(sRx,sRy,STR_TOP), bL=GP(sLx,sLy,H_CH), bR=GP(sRx,sRy,H_CH);
        ctx.strokeStyle = 'rgba(150,160,170,0.82)'; ctx.lineWidth = 1.4 * _dpr; ctx.beginPath();
        if(tL&&bL){ctx.moveTo(tL[0],tL[1]);ctx.lineTo(bL[0],bL[1]);}          // strut L
        if(tR&&bR){ctx.moveTo(tR[0],tR[1]);ctx.lineTo(bR[0],bR[1]);}          // strut R
        if(tL&&tR){ctx.moveTo(tL[0],tL[1]);ctx.lineTo(tR[0],tR[1]);}          // top beam
        if(bL&&bR){ctx.moveTo(bL[0],bL[1]);ctx.lineTo(bR[0],bR[1]);}          // bottom bar
        ctx.stroke();
        /* Central pivot pin + lower steering bar (along arm), carrying the 4 tyres. */
        const pvT=GP(Bp[0],Bp[1],H_CH), pvB=GP(Bp[0],Bp[1],AX);
        const eA=[Bp[0]+dx*SB,Bp[1]+dy*SB], eB=[Bp[0]-dx*SB,Bp[1]-dy*SB];
        const ax0=GP(eA[0],eA[1],AX), ax1=GP(eB[0],eB[1],AX);
        ctx.lineWidth = 1.6 * _dpr; ctx.beginPath();
        if(pvT&&pvB){ctx.moveTo(pvT[0],pvT[1]);ctx.lineTo(pvB[0],pvB[1]);}    // pivot pin
        if(ax0&&ax1){ctx.moveTo(ax0[0],ax0[1]);ctx.lineTo(ax1[0],ax1[1]);}    // steering bar
        ctx.stroke();
        ctx.fillStyle = 'rgba(40,44,50,0.90)';
        for (const ep of [eA, eB]) for (const s of [-1, 1]) {                 // 2 tyres per bar end
          const wx = ep[0] + qx*WT*s, wy = ep[1] + qy*WT*s;
          const c0 = GP(wx, wy, 0), c1 = GP(wx, wy, 2*WR);
          if (c0 && c1) { const r = Math.max(1.2*_dpr, Math.hypot(c1[0]-c0[0], c1[1]-c0[1])/2);
            ctx.beginPath(); ctx.arc((c0[0]+c1[0])/2, (c0[1]+c1[1])/2, r, 0, Math.PI*2); ctx.fill(); } }

        /* Cab at the aircraft end: a full-circle rotunda (the cab swivels here) ending in
           a small cab box that carries a side service door, with the bellows seal on the
           cab's end face against the fuselage. */
        const CC = armPt(1), CR = 1.3, CABL = 2.2, CABW = 2.6, _lo = _lift, _hi = _lift + THK;
        ctx.strokeStyle = 'rgba(182,198,212,0.82)'; ctx.lineWidth = 1.1 * _dpr;
        { const b=[], t=[];                                       // (a) full rotunda cylinder
          for (let k=0;k<8;k++){ const a=k/8*Math.PI*2, cx=Math.cos(a)*CR, sy=Math.sin(a)*CR;
            b.push(GP(CC[0]+cx, CC[1]+sy, _lo)); t.push(GP(CC[0]+cx, CC[1]+sy, _hi)); }
          ctx.beginPath();
          for (let k=0;k<8;k++){ const p=b[k],q=b[(k+1)%8],c=t[k],d=t[(k+1)%8];
            if(p&&q){ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);}
            if(c&&d){ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);}
            if(p&&c){ctx.moveTo(p[0],p[1]);ctx.lineTo(c[0],c[1]);} }
          ctx.stroke(); }
        /* (b) small cab box reaching from the rotunda toward the fuselage (-side). */
        const csN = CC[1] - CR*0.5, csF = CC[1] - CR*0.5 - CABL, cf0 = CC[0]-CABW/2, cf1 = CC[0]+CABW/2;
        const _box = (h) => [GP(cf0,csN,h), GP(cf1,csN,h), GP(cf1,csF,h), GP(cf0,csF,h)];
        const cbot = _box(_lo), ctop = _box(_hi);
        if (ctop.every(p=>p)) { ctx.fillStyle = 'rgba(120,134,150,0.30)'; ctx.beginPath();
          ctx.moveTo(ctop[0][0],ctop[0][1]); for(let i=1;i<4;i++)ctx.lineTo(ctop[i][0],ctop[i][1]);
          ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle = 'rgba(170,186,202,0.78)'; ctx.lineWidth = 1.1 * _dpr; ctx.beginPath();
        for (let i=0;i<4;i++){ const a=cbot[i],b=cbot[(i+1)%4],c=ctop[i],d=ctop[(i+1)%4];
          if(a&&b){ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);}
          if(c&&d){ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);}
          if(a&&c){ctx.moveTo(a[0],a[1]);ctx.lineTo(c[0],c[1]);} }
        ctx.stroke();
        /* (c) side service door on the cab's +fwd wall. */
        const dm = (csN + csF) / 2, dd = [GP(cf1, dm+0.45, _lo), GP(cf1, dm-0.45, _lo),
              GP(cf1, dm-0.45, _lo+2.0), GP(cf1, dm+0.45, _lo+2.0)];
        if (dd.every(p=>p)) { ctx.strokeStyle = 'rgba(95,105,116,0.85)'; ctx.lineWidth = 1 * _dpr;
          ctx.beginPath(); ctx.moveTo(dd[0][0],dd[0][1]); for(let i=1;i<4;i++)ctx.lineTo(dd[i][0],dd[i][1]);
          ctx.closePath(); ctx.stroke(); }
        /* (d) bellows seal on the cab end face, against the fuselage. */
        const be = [GP(cf0,csF,_lo), GP(cf1,csF,_lo), GP(cf1,csF,_hi), GP(cf0,csF,_hi)];
        if (be.every(p=>p)) { ctx.beginPath(); ctx.moveTo(be[0][0],be[0][1]);
          for(let i=1;i<4;i++)ctx.lineTo(be[i][0],be[i][1]); ctx.closePath();
          ctx.fillStyle='rgba(18,20,24,0.55)'; ctx.fill();
          ctx.strokeStyle='rgba(8,8,10,0.94)'; ctx.lineWidth=3.4*_dpr; ctx.stroke(); }

        /* Flood-lamp pole on the apron, near the rotunda, clear of the swing arc. */
        const LH = 11, base = GP(fT - 2, LEFT + 5, 0), head = GP(fT - 2, LEFT + 5, LH);
        if (base && head) {
          ctx.strokeStyle = 'rgba(150,160,170,0.70)'; ctx.lineWidth = 1.2 * _dpr;
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(head[0], head[1]); ctx.stroke();
          if (_nightF > 0.03) {                            // warm glow grows toward night
            const glowR = (9 + 26 * _nightF) * _dpr;
            const grd = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], glowR);
            grd.addColorStop(0,   `rgba(255,244,214,${(0.55 * _nightF).toFixed(3)})`);
            grd.addColorStop(0.5, `rgba(255,236,190,${(0.22 * _nightF).toFixed(3)})`);
            grd.addColorStop(1,   'rgba(255,230,180,0)');
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(head[0], head[1], glowR, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = _nightF > 0.3 ? 'rgba(255,248,224,0.95)' : 'rgba(210,220,230,0.85)';
          ctx.beginPath(); ctx.arc(head[0], head[1], 1.7 * _dpr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  /* ── World-fixed ground grid (flat missions only, not rockets) ── */
  const GRID_RANGE_FWD  = 18;
  const GRID_RANGE_SIDE = 20;
  const GRID_RANGE_BACK =  3;
  if (!hasTerrain && !isRocket) {
    const GRID_NM = 0.5;

    const acLatNm = (S.lat ?? 0) * 60;
    const acLonNm = (S.lon ?? 0) * 60 * Math.cos((S.lat ?? 0) * DEG);

    const gridColor = isArctic ? '#b0bcc4' : isWater ? '#1e4a78' : '#2d5a22';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = 1 * devicePixelRatio;
    ctx.setLineDash([]);

    const firstLatNm = Math.ceil((acLatNm  - GRID_RANGE_BACK) / GRID_NM) * GRID_NM;
    const lastLatNm  = Math.floor((acLatNm + GRID_RANGE_FWD)  / GRID_NM) * GRID_NM;
    ctx.beginPath();
    for (let lnm = firstLatNm; lnm <= lastLatNm; lnm += GRID_NM) {
      const dN = lnm - acLatNm;
      const p1 = projNE(dN, -GRID_RANGE_SIDE);
      const p2 = projNE(dN,  GRID_RANGE_SIDE);
      if (p1 && p2) { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
    }
    ctx.stroke();

    const firstLonNm = Math.ceil((acLonNm  - GRID_RANGE_SIDE) / GRID_NM) * GRID_NM;
    const lastLonNm  = Math.floor((acLonNm + GRID_RANGE_SIDE) / GRID_NM) * GRID_NM;
    ctx.beginPath();
    for (let lnm = firstLonNm; lnm <= lastLonNm; lnm += GRID_NM) {
      const dE = lnm - acLonNm;
      const p1 = projNE(-GRID_RANGE_BACK, dE);
      const p2 = projNE( GRID_RANGE_FWD,  dE);
      if (p1 && p2) { ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
    }
    ctx.stroke();
  }

  /* ── Procedural cloud layer from METAR ── */
  if (!isRocket) {
    const cloudLayers = S.weather?.clouds ?? [];
    const acLatNm = acLat * 60;
    const acLonNm = acLon * 60 * cosAcLat;
    const SPACING = 1.6;  /* NM between cloud anchors */

    for (const layer of cloudLayers) {
      const coverFrac = { FEW: 0.18, SCT: 0.40, BKN: 0.68, OVC: 0.92 }[layer.cover] ?? 0;
      if (coverFrac <= 0) continue;
      const upAdd = ((layer.base ?? 5000) - elevFt) * FT_NM;
      if (upAdd < altNm - 0.08) continue;  /* aircraft well above this layer */

      const gi0 = Math.floor(acLatNm / SPACING) - 11;
      const gj0 = Math.floor(acLonNm / SPACING) - 11;

      for (let gi = gi0; gi <= gi0 + 22; gi++) {
        for (let gj = gj0; gj <= gj0 + 22; gj++) {
          const h = ((gi * 2654435761) ^ (gj * 2246822519)) >>> 0;
          if (h / 0xFFFFFFFF > coverFrac) continue;

          const dN  = gi * SPACING - acLatNm;
          const dE  = gj * SPACING - acLonNm;
          const fwd = dN * cosH + dE * sinH;
          if (fwd < 0.4 || fwd > 20) continue;
          const rgt = dE * cosH - dN * sinH;

          const cp = proj(fwd, rgt, upAdd);
          if (!cp || cp[1] > H * 1.1) continue;

          const sizeNm  = 0.22 + ((h >> 8) & 0xFF) / 255 * 0.52;
          const screenR = Math.max(5 * devicePixelRatio, sizeNm / fwd * focal);
          const alpha   = (0.48 + ((h >> 24) & 0xFF) / 255 * 0.32) * (dayFrac * 0.75 + 0.25);

          const grd = ctx.createRadialGradient(cp[0], cp[1], 0, cp[0], cp[1], screenR);
          grd.addColorStop(0,    `rgba(255,255,255,${alpha.toFixed(2)})`);
          grd.addColorStop(0.55, `rgba(245,250,255,${(alpha * 0.55).toFixed(2)})`);
          grd.addColorStop(1,    'rgba(230,240,250,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(cp[0], cp[1], screenR * 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /* ── Atmospheric haze at horizon (suppress in space — globe has its own limb) ── */
  if (globeAlpha === 0) {
    const horizonY = cy + Math.tan(pitch) * focal;
    const hazeTop  = Math.max(0, horizonY - 8 * devicePixelRatio);
    const hazeH    = Math.min(70 * devicePixelRatio, H - hazeTop);
    if (hazeH > 0) {
      const hazeGrad = ctx.createLinearGradient(0, hazeTop, 0, hazeTop + hazeH);
      hazeGrad.addColorStop(0, `rgba(${skyBotR},${skyBotG},${skyBotB},0.72)`);
      hazeGrad.addColorStop(1, `rgba(${skyBotR},${skyBotG},${skyBotB},0)`);
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, hazeTop, W, hazeH);
    }
  }

  /* ── Water specular shimmer (horizontal bands near horizon) ── */
  if (isWater && agl > 200) {
    const shimmerAlpha = Math.min(0.18, agl / 8000 * 0.18);
    ctx.save();
    ctx.globalAlpha = shimmerAlpha;
    ctx.strokeStyle = `rgb(${Math.min(255, skyBotR + 60)},${Math.min(255, skyBotG + 60)},${Math.min(255, skyBotB + 40)})`;
    ctx.lineWidth = devicePixelRatio;
    for (let i = 0; i < 6; i++) {
      const frac = 0.3 + i * 0.12;
      const wDist = frac * GRID_RANGE_FWD;
      const p1 = projNE(wDist, -GRID_RANGE_SIDE * 0.6);
      const p2 = projNE(wDist,  GRID_RANGE_SIDE * 0.6);
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ── Runway (legacy hand-authored quad) — suppressed when OurAirports runways are
     bundled; they're drawn accurately on the terrain mesh, whereas this draws a flat grey
     quad with a centreline at the declared elevation (wrong heading + floating in Z). ── */
  const arr = S.mission?.arrival;
  if (arr?.rwyLat != null && _missionRunways().length === 0) {
    const dN = (arr.rwyLat - (S.lat ?? 0)) * 60;
    const dE = (arr.rwyLon - (S.lon ?? 0)) * 60 * Math.cos((S.lat ?? 0) * DEG);

    const rh  = arr.rwyHdg * DEG;
    const hl  = (arr.rwyLengthM ?? 600) / 2 * M_NM;
    const hw  = (arr.rwyWidthM  ?? 20)  / 2 * M_NM;

    const axN =  Math.cos(rh) * hl,  axE = Math.sin(rh) * hl;
    const wpN = -Math.sin(rh) * hw,  wpE = Math.cos(rh) * hw;

    const c4 = [
      projNE(dN + axN + wpN, dE + axE + wpE),
      projNE(dN + axN - wpN, dE + axE - wpE),
      projNE(dN - axN - wpN, dE - axE - wpE),
      projNE(dN - axN + wpN, dE - axE + wpE),
    ].filter(Boolean);

    if (c4.length === 4) {
      ctx.fillStyle = '#b8b8b8';
      ctx.beginPath();
      ctx.moveTo(c4[0][0], c4[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(c4[i][0], c4[i][1]);
      ctx.closePath();
      ctx.fill();

      const p1 = projNE(dN + axN * 0.9, dE + axE * 0.9);
      const p2 = projNE(dN - axN * 0.9, dE - axE * 0.9);
      if (p1 && p2) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2 * devicePixelRatio);
        ctx.setLineDash([20 * devicePixelRatio, 20 * devicePixelRatio]);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /* ── NIFLHEIM — das Tiefenwesen, Wolfskopf T+108 to T+124 ── */
  if (isArctic) {
    const mT = S.time ?? 0;
    if (mT >= 108 && mT < 124) {
      const phase = (mT - 108) / 16;

      let alpha;
      if      (phase < 0.25) alpha = phase / 0.25;
      else if (phase < 0.65) alpha = 1.0;
      else                   alpha = 1 - (phase - 0.65) / 0.35;

      const rise    = Math.min(1, phase / 0.5);
      const maxH    = 380 * FT_NM;
      const dist    = 1.8;
      const offR    = 0.18;

      const b1 = projNE(dist - 0.12, offR - 0.08);
      const b2 = projNE(dist + 0.10, offR + 0.16);
      const m1 = projNE(dist - 0.06, offR - 0.02, maxH * rise * 0.45);
      const m2 = projNE(dist + 0.08, offR + 0.12, maxH * rise * 0.60);
      const t1 = projNE(dist + 0.02, offR + 0.04, maxH * rise);
      const t2 = projNE(dist - 0.04, offR - 0.01, maxH * rise * 0.85);

      if (b1 && b2 && t1) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.82;

        ctx.fillStyle = 'rgba(6, 14, 20, 0.95)';
        ctx.beginPath();
        ctx.moveTo(b1[0], b1[1]);
        if (m1)  ctx.bezierCurveTo(b1[0], b1[1] - 10, m1[0] - 8, m1[1] + 6, m1[0], m1[1]);
        if (t2)  ctx.bezierCurveTo(m1[0] + 4, m1[1] - 8, t2[0] - 6, t2[1] + 4, t2[0], t2[1]);
        ctx.bezierCurveTo(t2 ? t2[0] + 5 : t1[0] - 5, (t2 ? t2[1] : t1[1]) - 4, t1[0] - 4, t1[1] + 3, t1[0], t1[1]);
        if (m2)  ctx.bezierCurveTo(t1[0] + 6, t1[1] + 5, m2[0] + 4, m2[1] - 6, m2[0], m2[1]);
        ctx.bezierCurveTo(m2 ? m2[0] + 2 : b2[0], (m2 ? m2[1] : b2[1]) + 8, b2[0] + 4, b2[1] - 4, b2[0], b2[1]);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = alpha * 0.18;
        ctx.strokeStyle = 'rgba(40, 200, 180, 1.0)';
        ctx.lineWidth   = 1.5 * devicePixelRatio;
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  /* ── Vehicle silhouette HUD (rocket missions only) — rendered by map.js ── */

  /* ── Cockpit border + heading tape ── */
  ctx.restore();   /* end cockpit window clip */
  if (!outsideView) _drawCockpitBorder(ctx, W, H, devicePixelRatio, S.aircraft?.id ?? '', dayFrac, S.hdg ?? 0);

  /* ── FPS counter ── */
  const now = performance.now();
  _fpsCount++;
  if (now - _fpsLast >= 1000) {
    _fpsDisplay = _fpsCount;
    _fpsCount   = 0;
    _fpsLast    = now;
  }
  ctx.save();
  ctx.font        = `${11 * devicePixelRatio}px 'IBM Plex Mono', monospace`;
  ctx.fillStyle   = 'rgba(255,255,255,0.5)';
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${_fpsDisplay} fps`, W - 8 * devicePixelRatio, 8 * devicePixelRatio);
  ctx.restore();

  /* ── Clock + moon phase — top-centre overlay ── */
  {
    const _clockTotal = ((_todH + _simH) % 24 + 24) % 24;
    const DPR         = devicePixelRatio;
    const clockType   = S.aircraft?.clock;
    let   _clockBottomY = 0;

    if (clockType === 'digital') {
      const _hh = String(Math.floor(_clockTotal)).padStart(2, '0');
      const _mm = String(Math.floor((_clockTotal % 1) * 60)).padStart(2, '0');
      const _ss = String(Math.floor(((_clockTotal * 60) % 1) * 60)).padStart(2, '0');
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.font         = `${13 * DPR}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle    = 'rgba(255,240,200,0.72)';
      ctx.fillText(`${_hh}:${_mm}:${_ss} UTC`, W / 2, 8 * DPR);
      ctx.restore();
      _clockBottomY = 24 * DPR;
    } else if (clockType === 'met') {
      const ignT  = S.aircraft?.ignitionTime ?? 0;
      const met   = (S.time ?? 0) - ignT;
      const sign  = met < 0 ? 'T-' : 'T+';
      const abs   = Math.abs(met);
      const mm    = String(Math.floor(abs / 60)).padStart(2, '0');
      const ss    = String(Math.floor(abs % 60)).padStart(2, '0');
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.font         = `${13 * DPR}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle    = 'rgba(255,240,200,0.72)';
      ctx.fillText(`MET  ${sign}${mm}:${ss}`, W / 2, 8 * DPR);
      ctx.restore();
      _clockBottomY = 24 * DPR;
    } else if (clockType === 'analog') {
      const _h   = _clockTotal % 12;
      const _m   = (_clockTotal * 60) % 60;
      const _s   = (_clockTotal * 3600) % 60;
      const hAng = (_h / 12) * Math.PI * 2 - Math.PI / 2;
      const mAng = (_m / 60) * Math.PI * 2 - Math.PI / 2;
      const sAng = (_s / 60) * Math.PI * 2 - Math.PI / 2;
      const R    = 18 * DPR;
      const cx   = W / 2, cy = 26 * DPR;

      ctx.save();
      ctx.globalAlpha = 0.82;

      /* Face */
      ctx.fillStyle = 'rgba(18,18,22,0.88)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      /* Bezel */
      ctx.strokeStyle = 'rgba(160,155,140,0.7)';
      ctx.lineWidth   = 1.5 * DPR;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      /* Tick marks */
      ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const major = i % 3 === 0;
        ctx.strokeStyle = major ? 'rgba(220,215,200,0.9)' : 'rgba(150,145,130,0.7)';
        ctx.lineWidth   = (major ? 1.5 : 1.0) * DPR;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * (major ? 0.72 : 0.82), cy + Math.sin(a) * R * (major ? 0.72 : 0.82));
        ctx.lineTo(cx + Math.cos(a) * (R - 1.5 * DPR),           cy + Math.sin(a) * (R - 1.5 * DPR));
        ctx.stroke();
      }

      /* Hour hand */
      ctx.strokeStyle = 'rgba(235,228,210,0.95)';
      ctx.lineWidth   = 2.5 * DPR;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(hAng) * R * 0.12, cy - Math.sin(hAng) * R * 0.12);
      ctx.lineTo(cx + Math.cos(hAng) * R * 0.55, cy + Math.sin(hAng) * R * 0.55);
      ctx.stroke();

      /* Minute hand */
      ctx.lineWidth = 1.8 * DPR;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(mAng) * R * 0.12, cy - Math.sin(mAng) * R * 0.12);
      ctx.lineTo(cx + Math.cos(mAng) * R * 0.78, cy + Math.sin(mAng) * R * 0.78);
      ctx.stroke();

      /* Second hand */
      ctx.strokeStyle = 'rgba(220,60,40,0.9)';
      ctx.lineWidth   = 1.0 * DPR;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(sAng) * R * 0.25, cy - Math.sin(sAng) * R * 0.25);
      ctx.lineTo(cx + Math.cos(sAng) * R * 0.88, cy + Math.sin(sAng) * R * 0.88);
      ctx.stroke();

      /* Centre dot */
      ctx.fillStyle = 'rgba(220,60,40,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 2 * DPR, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
      _clockBottomY = (cy + R + 6 * DPR);
    }

  }
}

/* Lerp colour channel: low-alt value a, high-alt value b */
function _c(a, b, t) { return Math.round(a + (b - a) * (1 - t)); }

/* Linear interpolation */
function _lerp(a, b, t) { return a + (b - a) * t; }

/* ── Cockpit border helpers ── */

function _clipCockpitWindow(ctx, W, H, acId, isRocket) {
  /* Only clip for rocket porthole — normal aircraft use a gradient vignette instead */
  if (!(isRocket || acId.startsWith('falcon9') || acId.startsWith('dragon'))) return;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.46, W * 0.38, H * 0.44, 0, 0, Math.PI * 2);
  ctx.clip();
}

function _drawHeadingTape(ctx, W, tapeTop, tapeBot, hdgDeg, DPR, dayFrac) {
  const tapeH   = tapeBot - tapeTop;
  const bright  = Math.round(200 + 30 * dayFrac);
  const amber   = `rgba(255,${bright},80,${0.72 + 0.18 * dayFrac})`;
  const dimAmb  = `rgba(255,${Math.round(bright * 0.78)},55,${0.42 + 0.13 * dayFrac})`;
  const range   = 80;                           /* degrees shown left-to-right */
  const pxPerDeg = W / range;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, tapeTop, W, tapeH);
  ctx.clip();

  const startDeg = Math.ceil((hdgDeg - range / 2) / 5) * 5;
  for (let d = startDeg; d <= hdgDeg + range / 2 + 5; d += 5) {
    const x = W / 2 + (d - hdgDeg) * pxPerDeg;
    if (x < -2 || x > W + 2) continue;
    const major  = d % 10 === 0;
    const tickH  = major ? tapeH * 0.34 : tapeH * 0.19;
    ctx.strokeStyle = major ? amber : dimAmb;
    ctx.lineWidth   = (major ? 1.5 : 1.0) * DPR;
    ctx.beginPath();
    ctx.moveTo(x, tapeTop + 2 * DPR);
    ctx.lineTo(x, tapeTop + 2 * DPR + tickH);
    ctx.stroke();

    if (major) {
      const norm = ((d % 360) + 360) % 360;
      let label;
      if      (norm === 0)   label = 'N';
      else if (norm === 90)  label = 'E';
      else if (norm === 180) label = 'S';
      else if (norm === 270) label = 'W';
      else                   label = String(norm / 10).padStart(2, '0');
      ctx.fillStyle    = label.length === 1 ? amber : dimAmb;
      ctx.font         = `${Math.round(10 * DPR)}px 'IBM Plex Mono', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x, tapeTop + 2 * DPR + tickH + 2 * DPR);
    }
  }

  /* Centre marker — downward triangle */
  const triW = 5.5 * DPR, triH = 8 * DPR;
  ctx.fillStyle = amber;
  ctx.beginPath();
  ctx.moveTo(W / 2 - triW, tapeTop);
  ctx.lineTo(W / 2 + triW, tapeTop);
  ctx.lineTo(W / 2, tapeTop + triH);
  ctx.closePath();
  ctx.fill();

  /* Heading readout box */
  const hdgNorm = Math.round(((hdgDeg % 360) + 360) % 360);
  const hdgStr  = String(hdgNorm).padStart(3, '0') + '°';
  const boxW = 46 * DPR, boxH = 17 * DPR;
  const boxX = W / 2 - boxW / 2, boxY = tapeBot - boxH - 2 * DPR;
  ctx.fillStyle   = 'rgba(0,0,0,0.68)';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = amber;
  ctx.lineWidth   = 1 * DPR;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle    = amber;
  ctx.font         = `bold ${Math.round(11 * DPR)}px 'IBM Plex Mono', monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hdgStr, W / 2, boxY + boxH / 2);

  ctx.restore();
}

function _drawPorthole(ctx, W, H, DPR, dayFrac) {
  const base  = Math.round(10 * (0.55 + 0.45 * dayFrac));
  const rx = W * 0.38, ry = H * 0.44;
  const cx = W / 2, cy = H * 0.46;

  ctx.save();
  ctx.fillStyle = `rgb(${base},${base},${base + 4})`;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill('evenodd');

  const ringV = Math.round(90 + 40 * dayFrac);
  ctx.strokeStyle = `rgba(${ringV},${ringV - 5},${ringV - 10},0.9)`;
  ctx.lineWidth   = 5 * DPR;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = `rgba(${ringV - 10},${ringV - 15},${ringV - 20},0.88)`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + (rx + 9 * DPR) * Math.cos(a), cy + (ry + 9 * DPR) * Math.sin(a), 3.5 * DPR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function _drawCockpitBorder(ctx, W, H, DPR, acId, dayFrac, hdgDeg) {
  if (acId.startsWith('falcon9') || acId.startsWith('dragon')) {
    _drawPorthole(ctx, W, H, DPR, dayFrac);
    return;
  }

  /* Window insets: fraction of canvas W / H per edge */
  let iL, iR, iT, iB, hasPost = false;
  if (acId === 'a350') {
    iL = 0.04; iR = 0.04; iT = 0.06; iB = 0.03;
  } else if (acId === 'bf109' || acId === 'f4u1a') {
    iL = 0.13; iR = 0.13; iT = 0.11; iB = 0.05; hasPost = true;
  } else if (acId === 'tu95ms' || acId === 'an225') {
    iL = 0.09; iR = 0.09; iT = 0.09; iB = 0.04; hasPost = true;
  } else if (acId === 'avro504') {
    iL = 0.15; iR = 0.15; iT = 0.13; iB = 0.05;
  } else {
    iL = 0.07; iR = 0.07; iT = 0.09; iB = 0.04;
  }

  const wx = iL * W, wy = iT * H;
  const ww = W - (iL + iR) * W, wh = H - (iT + iB) * H;

  const lv = Math.round(18 + 6 * dayFrac);   /* panel lightness — slightly warmer at day */
  const panelCol = `rgb(${lv},${lv - 1},${lv - 1})`;

  ctx.save();

  /* Cockpit surround — opaque, even-odd cuts the window opening */
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(wx, wy, ww, wh);
  ctx.fillStyle = panelCol;
  ctx.fill('evenodd');

  /* Hard window edge — thin dark line */
  ctx.strokeStyle = `rgba(6,6,6,0.95)`;
  ctx.lineWidth   = 2 * DPR;
  ctx.strokeRect(wx, wy, ww, wh);

  /* Centre post for multi-pane canopies */
  if (hasPost) {
    const pw = 0.013 * W;
    ctx.fillStyle   = panelCol;
    ctx.fillRect(W / 2 - pw / 2, wy, pw, wh);
    ctx.strokeStyle = `rgba(6,6,6,0.95)`;
    ctx.lineWidth   = 1.5 * DPR;
    ctx.beginPath();
    ctx.moveTo(W / 2 - pw / 2, wy);  ctx.lineTo(W / 2 - pw / 2, wy + wh);
    ctx.moveTo(W / 2 + pw / 2, wy);  ctx.lineTo(W / 2 + pw / 2, wy + wh);
    ctx.stroke();
  }

  ctx.restore();

  /* Heading tape — inside the window, at its bottom edge */
  _drawHeadingTape(ctx, W, wy + wh - 38 * DPR, wy + wh - 4 * DPR, hdgDeg, DPR, dayFrac);
}
