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

function _fetchOSMAero(lat, lon) {
  const key = `${Math.floor(lat * 10)}_${Math.floor(lon * 10)}`;
  if (_osmAero.has(key) || _osmPending.has(key)) return;
  _osmPending.add(key);
  /* Bounding box: 0.14° × 0.14° (~9 nm) centred on the 0.1° grid cell */
  const b0l = (Math.floor(lat * 10) / 10 - 0.02).toFixed(4);
  const b1l = (Math.floor(lat * 10) / 10 + 0.12).toFixed(4);
  const b0o = (Math.floor(lon * 10) / 10 - 0.02).toFixed(4);
  const b1o = (Math.floor(lon * 10) / 10 + 0.12).toFixed(4);
  const _bb = `${b0l},${b0o},${b1l},${b1o}`;
  const q = `[out:json][timeout:25];(way["aeroway"~"runway|taxiway|apron|helipad"](${_bb});node["aeroway"="holding_position"](${_bb}););out geom;`;
  fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`)
    .then(r => r.ok ? r.json() : { elements: [] })
    .then(d => { _osmAero.set(key, d.elements ?? []); _osmPending.delete(key); })
    .catch(() => { _osmAero.set(key, []); _osmPending.delete(key); });
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
  if (!closed) return { a: g[0], b: g[g.length-1], widthM: wTag || 45, ref };
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
  return { a: toLL(pmin), b: toLL(pmax), widthM: wTag || (qmax-qmin)*1852, ref };
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
        return { dLat: g[i].lat - g[j].lat, dLon: g[i].lon - g[j].lon };
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
};

/* Designation a holding sign protects: the node's own ref, else the nearest runway's
   two ends as "XX-YY" (derived from the runway bearing). */
function _nearestRwyDes(node, els) {
  let best = null, bestD = Infinity;
  for (const w of els) {
    if (w.type === 'node' || w.tags?.aeroway !== 'runway' || !w.geometry) continue;
    const rg = _runwayGeom(w); if (!rg) continue;
    const mLat=(rg.a.lat+rg.b.lat)/2, mLon=(rg.a.lon+rg.b.lon)/2;
    const d=(mLat-node.lat)**2 + (mLon-node.lon)**2;
    if (d < bestD) { bestD = d; best = rg; }
  }
  if (!best) return null;
  if (best.ref) return best.ref.replace(/\//g, '-');
  const brg=(Math.atan2(best.b.lon-best.a.lon, best.b.lat-best.a.lat)*180/Math.PI+360)%360;
  const num=(b)=>{const n=Math.round((((b%360)+360)%360)/10);return n===0?36:n;};
  const f=(b)=>('0'+num(b)).slice(-2);
  return f(brg)+'-'+f(brg+180);
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

  /* ── Runway geometry for quad-loop override ── */
  const _rwyDefs = [];
  for (const src of [S.mission?.arrival, S.mission?.departure]) {
    if (!src?.rwyLat || !hasTerrain) continue;
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
      ctx.fillStyle = _terrainColor(refM, dayFrac, 0, 1);
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

        let quadColor = null;
        if (_rwyDefs.length) {
          const d_c     = (ROW_DIST[r] + ROW_DIST[r + 1]) * 0.5;
          const right_c = ((c + 0.5) / COLS - 0.5) * 2 * d_c * 1.5;
          const dN_c = d_c * cosH - right_c * sinH;
          const dE_c = d_c * sinH + right_c * cosH;
          const lat_c = acLat + dN_c / 60;
          const lon_c = acLon + dE_c / (60 * cosAcLat);
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
        ctx.fillStyle = quadColor ?? _terrainColor(avgElev, dayFrac, depth, shade);
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

  /* ── OSM aeroway overlay — runways, taxiways, aprons (all mission types) ── */
  if (!isWater) {
    _fetchOSMAero(acLat, acLon);
    const _osmKey  = `${Math.floor(acLat * 10)}_${Math.floor(acLon * 10)}`;
    const _osmWays = _osmAero.get(_osmKey);
    if (_osmWays?.length) {
      /* Brightness scales with day/night (same formula as _rwyColor) */
      const _f   = dayFrac * 0.78 + 0.22;
      const _rB  = 62  * _f | 0;   // runway  (asphalt ~62)
      const _tB  = 52  * _f | 0;   // taxiway (slightly darker)
      const _aB  = 72  * _f | 0;   // apron   (concrete ~72)
      ctx.save();
      for (const way of _osmWays) {
        if (!way.geometry?.length) continue;
        const _at = way.tags?.aeroway;
        const _bv = _at === 'runway' ? _rB : _at === 'taxiway' ? _tB : _at === 'apron' ? _aB : null;
        if (_bv === null) continue;
        /* Sample terrain elevation at the first node so the overlay sits on the actual
           terrain mesh rather than floating at the declared mission field elevation.     */
        const _n0  = way.geometry[0];
        const _eM  = _sampleElev(_n0.lat, _n0.lon);
        const _eNm = _eM !== null ? (_eM - refM) * M_NM : 0;
        ctx.fillStyle = `rgb(${_bv},${_bv},${_bv})`;
        ctx.beginPath();
        let _go = false;
        for (const { lat: _nL, lon: _nO } of way.geometry) {
          const _dN = (_nL - acLat) * 60;
          const _dE = (_nO - acLon) * 60 * cosAcLat;
          const _sp = proj(_dN * cosH + _dE * sinH, _dE * cosH - _dN * sinH, _eNm);
          if (!_sp) continue;
          if (!_go) { ctx.moveTo(_sp[0], _sp[1]); _go = true; }
          else         ctx.lineTo(_sp[0], _sp[1]);
        }
        if (_go) { ctx.closePath(); ctx.fill(); }
      }
      ctx.restore();

      /* ── Runway lighting (dusk/night) — white edge lights + green threshold bars,
         derived from the runway centerline. ICAO-standard layout, so every runway with
         OSM geometry lights itself; brightness rises into the night. */
      const _night = 1 - dayFrac;
      if (_night > 0.12) {
        const _DPR = devicePixelRatio || 1;
        const _alpha = (0.35 + 0.55 * _night).toFixed(2);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'runway' || !way.geometry?.length) continue;
          const rg = _runwayGeom(way); if (!rg) continue;
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
          const _txM = _sampleElev(g[0].lat, g[0].lon), _txNm = _txM!==null?(_txM-refM)*M_NM:0;
          const _tx=(N,E)=>{ const f=N*cosH+E*sinH, r=E*cosH-N*sinH; const sp=proj(f,r,_txNm);
            if(sp) ctx.rect(sp[0]-_tw, sp[1]-_tw, 2*_tw, 2*_tw); };
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
        ctx.restore();
      }

      /* ── Painted runway designators (day + night) — the number on each threshold,
         projected onto the surface so it foreshortens and reads on approach. The digit
         for an end is the one whose outbound bearing matches (round(bearing/10)). */
      {
        const _digH = 0.0108, _digW = 0.0049, _gap = 0.0022, _uStart = 0.022;   // nm (~20/9/4/40 m)
        ctx.save();
        ctx.strokeStyle = 'rgba(236,239,243,0.85)';   // off-white paint
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'runway' || !way.geometry?.length) continue;
          const rg = _runwayGeom(way); if (!rg) continue;
          const parts = (rg.ref || '').split('/').map(s => s.trim()).filter(Boolean);
          const _eM = _sampleElev(rg.a.lat, rg.a.lon);
          const _eNm = _eM !== null ? (_eM - refM) * M_NM : 0;
          const aN=(rg.a.lat-acLat)*60, aE=(rg.a.lon-acLon)*60*cosAcLat;
          const bN=(rg.b.lat-acLat)*60, bE=(rg.b.lon-acLon)*60*cosAcLat;
          const dN=bN-aN, dE=bE-aE, L=Math.hypot(dN,dE) || 1e-6;
          const uN=dN/L, uE=dE/L;
          const brgAB = (Math.atan2(dE, dN) * 180/Math.PI + 360) % 360;
          const numAt = (b) => { const n = Math.round((((b%360)+360)%360)/10); return n===0?36:n; };
          const pick  = (n) => parts.find(p => parseInt(p,10) === n) ?? null;
          const _fb  = (b) => ('0'+numAt(b)).slice(-2);   // derive "02" from bearing if no ref match
          const ends = [
            { T:[aN,aE], iN: uN, iE: uE,  des: pick(numAt(brgAB))     ?? _fb(brgAB)     },
            { T:[bN,bE], iN:-uN, iE:-uE,  des: pick(numAt(brgAB+180)) ?? _fb(brgAB+180) },
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
            ctx.lineWidth = Math.max(1, hpx*0.13);
            for (let ci=0; ci<chars.length; ci++) {
              const glyph = _RW_FONT[chars[ci]]; if (!glyph) continue;
              const cV = -totalW/2 + ci*(_digW+_gap) + _digW/2;
              for (const stroke of glyph) {
                ctx.beginPath(); let go=false;
                for (const [gx,gy] of stroke) {
                  const sp = _wp(_uStart + gy*_digH, cV + (gx-0.5)*_digW);
                  if (!sp) { go=false; continue; }
                  if (!go) { ctx.moveTo(sp[0],sp[1]); go=true; } else ctx.lineTo(sp[0],sp[1]);
                }
                ctx.stroke();
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
        for (const way of _osmWays) {
          if (way.tags?.aeroway !== 'runway' || !way.geometry?.length) continue;
          const rg = _runwayGeom(way); if (!rg) continue;
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

      /* ── Runway guard lights (wig-wag) at holding positions — a flashing yellow pair,
         one each side of the taxiway hold-short, alternating ~0.9 s. Day + night. */
      {
        const _DPR = devicePixelRatio || 1;
        const _on = (performance.now() % 900) < 450;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const el of _osmWays) {
          if (el.type !== 'node' || el.tags?.aeroway !== 'holding_position') continue;
          const nN=(el.lat-acLat)*60, nE=(el.lon-acLon)*60*cosAcLat;
          if (nN*nN+nE*nE > 9) continue;            // >3 nm
          const _eM=_sampleElev(el.lat,el.lon), _eNm=_eM!==null?(_eM-refM)*M_NM:0;
          const dir=_holdDir(el,_osmWays);
          let pN=0,pE=1;
          if (dir){ const dN=dir.dLat*60, dE=dir.dLon*60*cosAcLat, dl=Math.hypot(dN,dE)||1; pN=-dE/dl; pE=dN/dl; }
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
          const nN=(el.lat-acLat)*60, nE=(el.lon-acLon)*60*cosAcLat;
          if (nN*nN+nE*nE > 6.25) continue;          // >2.5 nm (signs only read close)
          const dir=_holdDir(el,_osmWays); if (!dir) continue;
          const tN=dir.dLat*60, tE=dir.dLon*60*cosAcLat, tl=Math.hypot(tN,tE)||1;
          let uN=tN/tl, uE=tE/tl;
          const txt = el.tags?.ref ? el.tags.ref.replace(/\//g,'-') : _nearestRwyDes(el, _osmWays);
          if (!txt) continue;
          /* orient the taxiway dir toward the nearest runway, so the sign front faces
             the taxiing pilot (away from the runway) and the text never mirrors. */
          let rwN=0,rwE=0,bd=Infinity;
          for (const w of _osmWays){ if(w.type==='node'||w.tags?.aeroway!=='runway'||!w.geometry)continue;
            const rg=_runwayGeom(w); if(!rg)continue;
            const mN=((rg.a.lat+rg.b.lat)/2-el.lat)*60, mE=((rg.a.lon+rg.b.lon)/2-el.lon)*60*cosAcLat, d=mN*mN+mE*mE;
            if(d<bd){bd=d; const l=Math.hypot(mN,mE)||1; rwN=mN/l; rwE=mE/l;} }
          if (uN*rwN+uE*rwE < 0){ uN=-uN; uE=-uE; }     // uHat → toward the runway
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
          if (inFront){
            ctx.strokeStyle='rgba(245,247,250,0.95)'; ctx.lineWidth=Math.max(1,hpx*0.07);
            const _cH=(h1-h0)*0.6, _cY=h0+(h1-h0)*0.2;
            for (let ci=0;ci<chars.length;ci++){
              const gl=_RW_FONT[chars[ci]]; if(!gl) continue;
              const cx=-totalW/2+ci*(_cW+_gp)+_cW/2;
              for (const st of gl){ ctx.beginPath(); let go=false;
                for (const [gx,gy] of st){ const sp=_bp(cx+(gx-0.5)*_cW, _cY+gy*_cH);
                  if(!sp){go=false;continue;} if(!go){ctx.moveTo(sp[0],sp[1]);go=true;}else ctx.lineTo(sp[0],sp[1]); }
                ctx.stroke(); }
            }
          }
        }
        ctx.restore();
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

  /* ── Runway ── */
  const arr = S.mission?.arrival;
  if (arr?.rwyLat != null) {
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
