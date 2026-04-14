/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/map.js
   Moving map — two modes:

   Aircraft  : local mini-map, North-up, heading + track vectors
   Rocket    : equirectangular world map, ground track, bigger panel
   ═══════════════════════════════════════════════════════════════ */

import { S }     from '../core/state.js';
import { COAST, SPACE_SITES } from './coastlines.js';

const DEG = Math.PI / 180;

/* Sizes */
const LOCAL_SIZE = 300;        /* px — aircraft mini-map */
const PROFILE_W  =  70;        /* px — altitude profile strip (left of map) */
const MAP_W      = 560;        /* px — world map */
const ROCKET_W   = PROFILE_W + MAP_W;   /* total rocket panel width */
const ROCKET_H   = 340;        /* px — rocket panel height */

let _el      = null;
let _canvas  = null;
let _visible = false;
let _mode    = 'local';        /* 'local' | 'rocket' */

/* ── Leaflet (local aircraft map) ── */
let _lmap       = null;   /* L.map instance */
let _lmarker    = null;   /* aircraft marker */
let _lhdgLine   = null;   /* heading vector polyline */
let _ltrkLine   = null;   /* track vector polyline */
let _lwptLayer  = null;   /* L.layerGroup for waypoints */
let _lrouteLine = null;   /* route polyline connecting waypoints */
let _lLastMission = null; /* detect mission change for waypoint refresh */

/* ── Vehicle silhouette panels (rocket mode, left of map) ── */
const SIL_W = 130;            /* px — each silhouette panel width */
let _silEl     = null;        /* main vehicle (S2+Trunk+Dragon or Trunk+Dragon) */
let _silCanvas = null;
let _silEl2    = null;        /* Stage 1 booster — shown only during RTLS */
let _silCanvas2 = null;

/* SVG silhouettes */
const _svg = {};
['dragon', 'trunk', 'stage2', 'stage1'].forEach(name => {
  const img = new Image();
  img.src = `display/svg/${name}.svg`;
  _svg[name] = img;
});

/* Ground track history for rocket missions */
let _track          = [];
let _boosterTrack   = [];
let _s2Track        = [];   /* Stage 2 track after Dragon separation */
let _trackMissionId = null;

/* Smooth zoom state — current displayed extent, lerped toward target */
let _dispCLat = null;
let _dispCLon = null;
let _dispLatSpan = 12;
let _dispLonSpan = 20;

export function initMap() {
  _el = document.createElement('div');
  _el.id = 'minimap';
  _applySize('local');
  document.body.appendChild(_el);

  /* ── Leaflet local map ── */
  _lmap = L.map(_el, {
    zoomControl:       false,
    attributionControl: false,
    dragging:          false,
    touchZoom:         false,
    doubleClickZoom:   false,
    scrollWheelZoom:   false,
    keyboard:          false,
    animate:           false,
  });

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18 }
  ).addTo(_lmap);

  /* Aircraft marker — inner div rotates with heading */
  _lmarker = L.marker([47, 8], {
    icon: L.divIcon({
      className: '',
      html: `<div class="lmap-ac">
               <svg viewBox="0 0 20 24" width="20" height="24">
                 <polygon points="10,1 18,22 10,17 2,22"
                          fill="white" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
               </svg>
             </div>`,
      iconSize:   [20, 24],
      iconAnchor: [10, 12],
    }),
    zIndexOffset: 1000,
  }).addTo(_lmap);

  /* Heading and track vectors */
  _lhdgLine  = L.polyline([], { color: '#ffffff', weight: 2, opacity: 0.9 }).addTo(_lmap);
  _ltrkLine  = L.polyline([], { color: '#ffb400', weight: 2, opacity: 0.85, dashArray: '5 4' }).addTo(_lmap);

  /* Waypoint layer */
  _lwptLayer  = L.layerGroup().addTo(_lmap);
  _lrouteLine = L.polyline([], { color: '#00c8e0', weight: 1.5, opacity: 0.6, dashArray: '6 4' }).addTo(_lmap);

  _lmap.setView([47, 8], 14);

  /* Leaflet can't measure a hidden container — briefly show, measure, hide */
  _el.style.display = '';
  _lmap.invalidateSize();
  if (!_visible) _el.style.display = 'none';

  /* Canvas only used for rocket mode */
  _canvas = document.createElement('canvas');
  _canvas.style.cssText = 'display:none;width:100%;height:100%;';
  _el.appendChild(_canvas);

  /* Main vehicle silhouette — hidden until rocket mode */
  _silEl = document.createElement('div');
  _silEl.id = 'vehicle-silhouette';
  _silEl.style.cssText = 'display:none;';
  _silCanvas = document.createElement('canvas');
  _silCanvas.style.cssText = 'display:block;width:100%;height:100%;';
  _silEl.appendChild(_silCanvas);
  document.body.appendChild(_silEl);

  /* Booster silhouette — shown only during RTLS */
  _silEl2 = document.createElement('div');
  _silEl2.id = 'booster-silhouette';
  _silEl2.style.cssText = 'display:none;';
  _silCanvas2 = document.createElement('canvas');
  _silCanvas2.style.cssText = 'display:block;width:100%;height:100%;';
  _silEl2.appendChild(_silCanvas2);
  document.body.appendChild(_silEl2);
}

function _applySize(mode) {
  const w = mode === 'rocket' ? ROCKET_W : LOCAL_SIZE;
  const h = mode === 'rocket' ? ROCKET_H  : LOCAL_SIZE;
  _el.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    width: ${w}px;
    height: ${h}px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 2px 16px rgba(0,0,0,0.7);
    z-index: 8000;
    pointer-events: none;
    display: ${_visible ? '' : 'none'};
  `;
  /* Silhouette panels: same height as map, stacked left of it */
  const silCSS = (rightPx) => `
    position: fixed;
    top: 12px;
    right: ${rightPx}px;
    width: ${SIL_W}px;
    height: ${h}px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 2px 16px rgba(0,0,0,0.7);
    background: rgba(3,6,10,0.75);
    z-index: 8000;
    pointer-events: none;
  `;
  if (mode === 'rocket') {
    /* Main vehicle: directly left of map */
    if (_silEl)  _silEl.style.cssText  = silCSS(12 + w + 8);
    /* Booster: left of main vehicle (position managed in _renderSilhouette) */
    if (_silEl2) _silEl2.style.cssText = silCSS(12 + w + 8 + SIL_W + 6);
  } else {
    if (_silEl)  _silEl.style.display  = 'none';
    if (_silEl2) _silEl2.style.display = 'none';
  }
}

export function toggleMap() {
  _visible = !_visible;
  _el.style.display  = _visible ? '' : 'none';
  if (_silEl)  _silEl.style.display  = _visible ? '' : 'none';
  if (_silEl2) _silEl2.style.display = _visible ? '' : 'none';
}

export function showMap() {
  _visible = true;
  if (_el)     _el.style.display     = '';
  if (_silEl)  _silEl.style.display  = '';
  if (_silEl2) _silEl2.style.display = '';
  if (_lmap)   _lmap.invalidateSize();
}

export function hideMap() {
  _visible = false;
  if (_el)     _el.style.display     = 'none';
  if (_silEl)  _silEl.style.display  = 'none';
  if (_silEl2) _silEl2.style.display = 'none';
}

/* ── Embedded map — render local map directly onto any canvas ctx ──
   x, y, w, h are in the parent canvas's coordinate space (device px).
   Used by G1000 MFD and Velis EPSI canvas panels. */
export function renderEmbeddedMap(ctx, x, y, w, h) {
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  _renderLocalMap(ctx, w, h, dpr);
  ctx.restore();
}

export function renderMap() {
  if (!_el || !_visible) return;

  const isRocket = S.aircraft?.vehicleType === 'rocket';

  /* Switch container size if mode changed */
  const newMode = isRocket ? 'rocket' : 'local';
  if (newMode !== _mode) {
    _mode = newMode;
    _applySize(_mode);
    _canvas.style.display = isRocket ? 'block' : 'none';
    if (_lmap) {
      if (isRocket) _lmap.getContainer().style.display = 'none';
      else          { _lmap.getContainer().style.display = ''; _lmap.invalidateSize(); }
    }
  }

  if (!isRocket) {
    _renderLeafletLocal();
    return;
  }

  /* Rocket mode — canvas */
  const dpr = window.devicePixelRatio || 1;
  const W   = ROCKET_W * dpr;
  const H   = ROCKET_H * dpr;
  _canvas.width  = W;
  _canvas.height = H;
  const ctx = _canvas.getContext('2d');
  _updateTrack();
  const pW = PROFILE_W * dpr;
  _renderSideProfile(ctx, pW, H, dpr);
  ctx.save();
  ctx.translate(pW, 0);
  _renderWorldMap(ctx, MAP_W * dpr, H, dpr);
  ctx.restore();
  _renderSilhouette(dpr);
}

/* ── Update Leaflet local map each frame ── */
function _renderLeafletLocal() {
  if (!_lmap || !_lmarker) return;

  const lat  = S.lat ?? 47;
  const lon  = S.lon ?? 8;
  const hdg  = S.hdg ?? 0;
  const spd  = (S.spd ?? 0) * 0.5144;   /* kt → m/s */

  /* Pan map to aircraft position */
  _lmap.setView([lat, lon], 14, { animate: false });

  /* Rotate aircraft icon */
  const iconEl = _lmarker.getElement()?.querySelector('.lmap-ac');
  if (iconEl) iconEl.style.transform = `rotate(${hdg}deg)`;
  _lmarker.setLatLng([lat, lon]);

  /* Heading vector — 0.5 NM forward */
  const VEC_NM  = 0.5;
  const hdgRad  = hdg * DEG;
  const dLatHdg = VEC_NM / 60 * Math.cos(hdgRad);
  const dLonHdg = VEC_NM / 60 / Math.cos(lat * DEG) * Math.sin(hdgRad);
  _lhdgLine.setLatLngs([[lat, lon], [lat + dLatHdg, lon + dLonHdg]]);

  /* Track vector — accounts for wind */
  const wind      = _getWind();
  const wSpd      = wind.spd * 0.5144;
  const wRad      = wind.dir * DEG;
  const gndN      = spd * Math.cos(hdgRad) + wSpd * Math.cos(wRad + Math.PI);
  const gndE      = spd * Math.sin(hdgRad) + wSpd * Math.sin(wRad + Math.PI);
  const gndSpd    = Math.sqrt(gndN * gndN + gndE * gndE);
  const trkRad    = Math.atan2(gndE, gndN);
  const vecScale  = gndSpd > 1 ? gndSpd / Math.max(1, spd) : 1;
  const dLatTrk   = VEC_NM * vecScale / 60 * Math.cos(trkRad);
  const dLonTrk   = VEC_NM * vecScale / 60 / Math.cos(lat * DEG) * Math.sin(trkRad);
  _ltrkLine.setLatLngs([[lat, lon], [lat + dLatTrk, lon + dLonTrk]]);

  /* Waypoints — refresh when mission changes */
  const missionId = S.mission?.id ?? null;
  if (missionId !== _lLastMission) {
    _lLastMission = missionId;
    _updateWaypoints();
  }
}

/* ── Draw mission waypoints on Leaflet map ── */
function _updateWaypoints() {
  if (!_lwptLayer || !_lrouteLine) return;
  _lwptLayer.clearLayers();

  const waypoints = S.mission?.waypoints ?? [];
  if (!waypoints.length) { _lrouteLine.setLatLngs([]); return; }

  const routeLL = [];
  waypoints.forEach((wpt, i) => {
    routeLL.push([wpt.lat, wpt.lon]);

    /* Waypoint circle */
    L.circleMarker([wpt.lat, wpt.lon], {
      radius: 6, color: '#00c8e0', weight: 2,
      fillColor: 'rgba(0,200,224,0.15)', fillOpacity: 1,
    }).addTo(_lwptLayer);

    /* Label */
    L.marker([wpt.lat, wpt.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="
          color:#00c8e0; font:bold 10px 'IBM Plex Mono',monospace;
          white-space:nowrap; text-shadow:0 0 4px #000,0 0 4px #000;
          margin-left:10px; margin-top:-6px;
        ">${wpt.label ?? (i + 1)}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    }).addTo(_lwptLayer);
  });

  _lrouteLine.setLatLngs(routeLL);
}

/* ── Vehicle silhouette panel ── */
function _renderSilhouette(dpr) {
  const b         = S.booster;
  const boosterOn = !!(b?.active && !b?.landed);

  /* Show/hide booster panel */
  if (_silEl2) _silEl2.style.display = boosterOn ? '' : 'none';

  /* ── Main vehicle panel ── */
  _drawSilPanel(_silCanvas, dpr, _mainShape(), S.pitch ?? 90, false);

  /* ── Booster panel (Stage 1 RTLS) ── */
  if (boosterOn) {
    const bFpa = (b.vVert !== 0 || (b.vDown ?? 0) !== 0)
      ? Math.atan2(b.vVert, Math.abs(b.vDown ?? 0)) / (Math.PI / 180)
      : 90;
    _drawSilPanel(_silCanvas2, dpr, 'stage1', bFpa, true);
  }
}

function _mainShape() {
  const stage = S.rocketStage ?? 1;
  const coast = S.rocketCoast ?? false;
  const seco  = S.rocketSECO  ?? false;
  if (stage === 1 || coast)      return 'fullstack';
  if (seco || S.dragonSep)       return 'capsule';
  return 's2stack';
}

function _drawSilPanel(canvas, dpr, shape, fpa, isBooster) {
  if (!canvas) return;
  const W = SIL_W * dpr;
  const H = ROCKET_H * dpr;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const labelColor = isBooster ? 'rgba(255,140,50,0.70)' : 'rgba(232,237,242,0.60)';

  /* FPA label */
  ctx.save();
  ctx.font         = `bold ${Math.round(11 * dpr)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = labelColor;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(fpa)}°`, W / 2, 4 * dpr);

  /* Panel label */
  ctx.font         = `${Math.round(9 * dpr)}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = isBooster ? 'rgba(255,140,50,0.35)' : 'rgba(232,237,242,0.25)';
  ctx.textBaseline = 'bottom';
  ctx.fillText(isBooster ? 'STAGE 1' : 'ATTITUDE', W / 2, H - 3 * dpr);
  ctx.restore();

  /* Drawing area */
  const drawH  = H - 26 * dpr;
  const drawCX = W / 2;
  const drawCY = 16 * dpr + drawH / 2;
  const tiltRad = (90 - fpa) * (Math.PI / 180);

  const DIM = { s1: 42, s2: 15, trunk: 3.7, dragon: 6 };
  const BODY_W = W * 0.62;
  const CAPS_W = W * 0.70;
  const TRNK_W = W * 0.96;
  const PART_W = { stage1: BODY_W, stage2: BODY_W, dragon: CAPS_W, trunk: TRNK_W };

  function drawSvg(key, yTop, partH) {
    const img = _svg[key];
    if (!img?.complete) return;
    ctx.drawImage(img, -PART_W[key] / 2, yTop, PART_W[key], partH);
  }

  const usableH = drawH * 0.88;

  /* Joint fractions — where each SVG's connection points are within its own height */
  const J = {
    dragon_bot: 0.88,   /* heat shield bottom in dragon.svg */
    trunk_bot:  1.00,   /* trunk full height */
    s2_bot:     0.93,   /* MVac nozzle exit in stage2.svg */
    s1_inter:   0.041,  /* interstage bottom in stage1.svg (14/340) */
  };

  /* Compute part heights from real dimensions */
  function heights(keys) {
    const total = keys.reduce((s, k) => s + DIM[k], 0);
    const h = {};
    keys.forEach(k => { h[k] = usableH * (DIM[k] / total); });
    return h;
  }

  /* Compute joint-based positions (nose = top = −y), no drawing yet */
  let dragonTop, trunkTop, s2Top, s1Top, h;

  if (shape === 'fullstack') {
    h = heights(['dragon', 'trunk', 's2', 's1']);
    dragonTop = -usableH / 2;
    trunkTop  = dragonTop + h.dragon * J.dragon_bot;
    s2Top     = trunkTop  + h.trunk  * J.trunk_bot;
    s1Top     = s2Top     + h.s2     * J.s2_bot - h.s1 * J.s1_inter;
  } else if (shape === 's2stack') {
    h = heights(['dragon', 'trunk', 's2']);
    dragonTop = -usableH / 2;
    trunkTop  = dragonTop + h.dragon * J.dragon_bot;
    s2Top     = trunkTop  + h.trunk  * J.trunk_bot;
  } else if (shape === 'capsule') {
    h = heights(['dragon', 'trunk']);
    dragonTop = -usableH / 2;
    trunkTop  = dragonTop + h.dragon * J.dragon_bot;
  }

  /* Scale to fit: ensure rotated silhouette stays within panel bounds */
  const maxW    = shape === 'stage1' ? BODY_W : TRNK_W;
  const tiltAbs = Math.abs(tiltRad);
  const bboxW   = maxW * Math.cos(tiltAbs) + usableH * Math.sin(tiltAbs);
  const bboxH   = maxW * Math.sin(tiltAbs) + usableH * Math.cos(tiltAbs);
  const fitScale = Math.min(1, W / bboxW, drawH / bboxH);

  ctx.save();
  ctx.translate(drawCX, drawCY);
  ctx.rotate(tiltRad);
  ctx.scale(fitScale, fitScale);

  if (shape === 'fullstack') {
    drawSvg('dragon', dragonTop, h.dragon);
    drawSvg('trunk',  trunkTop,  h.trunk);
    drawSvg('stage2', s2Top,     h.s2);
    drawSvg('stage1', s1Top,     h.s1);
  } else if (shape === 's2stack') {
    drawSvg('dragon', dragonTop, h.dragon);
    drawSvg('trunk',  trunkTop,  h.trunk);
    drawSvg('stage2', s2Top,     h.s2);
  } else if (shape === 'capsule') {
    drawSvg('dragon', dragonTop, h.dragon);
    drawSvg('trunk',  trunkTop,  h.trunk);
  } else {
    /* stage1 only (booster panel) */
    drawSvg('stage1', -usableH / 2, usableH);
  }

  ctx.restore();
}

/* ── Track history ── */
function _updateTrack() {
  const missionId = S.mission?.id;
  if (missionId !== _trackMissionId) {
    _track          = [];
    _boosterTrack   = [];
    _s2Track        = [];
    _trackMissionId = missionId;
    _dispCLat = null;   /* reset zoom on new mission */
  }

  const mT   = S.time ?? 0;
  const ignT = S.aircraft?.ignitionTime ?? 0;
  if (mT < ignT) return;   /* don't track during countdown */

  const lat = S.lat ?? 0;
  const lon = S.lon ?? 0;
  const alt = (S.alt ?? 0) * 0.3048 / 1000;   /* km */
  const t   = mT - (S.aircraft?.ignitionTime ?? 0);
  const last = _track[_track.length - 1];
  /* In orbit the spacecraft moves fast — use a coarser threshold to keep
     the track manageable (~1 point per ~40 km, ≤ 2000 points total).   */
  const threshold = S.rocketOrbit ? 0.35 : 0.005;
  if (!last || Math.abs(lat - last.lat) + Math.abs(lon - last.lon) > threshold) {
    _track.push({ lat, lon, alt, t, stg: S.rocketStage ?? 1 });
    if (_track.length > 2000) _track.shift();   /* rolling window — drop oldest */
  }

  /* Booster track */
  const b = S.booster;
  if (b?.active || b?.landed) {
    const bLat = b.lat ?? 0, bLon = b.lon ?? 0;
    const lastB = _boosterTrack[_boosterTrack.length - 1];
    if (!lastB || Math.abs(bLat - lastB.lat) + Math.abs(bLon - lastB.lon) > 0.005) {
      _boosterTrack.push({ lat: bLat, lon: bLon, alt: (b.alt ?? 0) * 0.3048 / 1000 });
    }
  }

  /* Stage 2 track after Dragon separation */
  if (S.dragonSep && S.s2Vec) {
    const s2Lat = S.s2Lat ?? 0, s2Lon = S.s2Lon ?? 0;
    const lastS2 = _s2Track[_s2Track.length - 1];
    if (!lastS2 || Math.abs(s2Lat - lastS2.lat) + Math.abs(s2Lon - lastS2.lon) > 0.35) {
      _s2Track.push({ lat: s2Lat, lon: s2Lon });
      if (_s2Track.length > 2000) _s2Track.shift();
    }
  }
}

/* ── Rocket world map ── */
function _renderWorldMap(ctx, W, H, dpr) {
  /* Clip everything to the map canvas — prevents tracks from escaping the panel */
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();

  const launch   = S.mission?.initialState ?? {};
  const launchLat = launch.lat ?? 0;
  const launchLon = launch.lon ?? 0;
  const curLat    = S.lat  ?? launchLat;
  const curLon    = S.lon  ?? launchLon;

  /* In Keplerian orbit: always show the full globe */
  const inOrbit = !!(S.rocketOrbit);

  /* Compute target extent from track + launch + current */
  const allLats = [launchLat, curLat, ..._track.map(p => p.lat), ..._boosterTrack.map(p => p.lat)];
  const allLons = [launchLon, curLon, ..._track.map(p => p.lon), ..._boosterTrack.map(p => p.lon)];

  const rawMinLat = Math.min(...allLats);
  const rawMaxLat = Math.max(...allLats);
  const rawMinLon = Math.min(...allLons);
  const rawMaxLon = Math.max(...allLons);

  /* Target window: fit the track with padding, minimum 10° lat × 16° lon.
     When in orbit, show the full globe centred on 0°,0°.                 */
  const tgtCLat    = inOrbit ? 0  : (rawMinLat + rawMaxLat) / 2;
  const tgtCLon    = inOrbit ? 0  : (rawMinLon + rawMaxLon) / 2;
  const tgtLatSpan = inOrbit ? 180 : Math.min(180, Math.max(rawMaxLat - rawMinLat + 6, 10));
  const tgtLonSpan = inOrbit ? 360 : Math.min(360, Math.max(rawMaxLon - rawMinLon + 8, 16));

  /* Reset on mission change */
  if (_dispCLat === null) { _dispCLat = tgtCLat; _dispCLon = tgtCLon;
                            _dispLatSpan = tgtLatSpan; _dispLonSpan = tgtLonSpan; }

  /* Smooth lerp toward target — zoom out fast, zoom in slow */
  const k = tgtLonSpan > _dispLonSpan ? 0.06 : 0.02;
  _dispCLat    += (tgtCLat    - _dispCLat)    * k;
  _dispCLon    += (tgtCLon    - _dispCLon)    * k;
  _dispLatSpan += (tgtLatSpan - _dispLatSpan) * k;
  _dispLonSpan += (tgtLonSpan - _dispLonSpan) * k;

  const cLat    = _dispCLat;
  const cLon    = _dispCLon;
  const latSpan = _dispLatSpan;
  const lonSpan = _dispLonSpan;

  const minLat = cLat - latSpan / 2;
  const maxLat = cLat + latSpan / 2;
  const minLon = cLon - lonSpan / 2;
  const maxLon = cLon + lonSpan / 2;

  /* Equirectangular projection */
  const proj = (lat, lon) => ({
    x: (lon - minLon) / (maxLon - minLon) * W,
    y: (maxLat - lat) / (maxLat - minLat) * H,
  });

  /* Background */
  ctx.fillStyle = '#060c16';
  ctx.fillRect(0, 0, W, H);

  /* Continent fills + outlines */
  ctx.save();
  ctx.lineJoin = 'round';
  for (const poly of COAST) {
    ctx.beginPath();
    let first = true;
    for (const [rawLon, lat] of poly) {
      let lon = rawLon;
      if (lon < minLon - 10) lon += 360;
      if (lon > maxLon + 10) lon -= 360;
      const { x, y } = proj(lat, lon);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle   = '#0d1f2d';
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = 0.7 * dpr;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  /* Grid */
  const gridStep = lonSpan > 50 ? 10 : 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 0.5 * dpr;
  for (let la = Math.ceil(minLat / gridStep) * gridStep; la <= maxLat; la += gridStep) {
    const p1 = proj(la, minLon), p2 = proj(la, maxLon);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  for (let lo = Math.ceil(minLon / gridStep) * gridStep; lo <= maxLon; lo += gridStep) {
    const p1 = proj(minLat, lo), p2 = proj(maxLat, lo);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }

  /* Equator */
  if (minLat < 0 && maxLat > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 0.8 * dpr;
    const p1 = proj(0, minLon), p2 = proj(0, maxLon);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.font         = `${7 * dpr}px "IBM Plex Mono", monospace`;
    ctx.fillStyle    = 'rgba(255,255,255,0.2)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('EQ', p2.x - 2 * dpr, p2.y - 2 * dpr);
  }

  /* Nominal ground track — great circle from launch heading.
     Hidden once in orbit — the actual track tells the full story. */
  const nomHdg = S.mission?.initialState?.hdg ?? S.hdg ?? 0;
  if (!inOrbit) {
    const lat1 = launchLat * DEG;
    const lon1 = launchLon * DEG;
    const az   = nomHdg * DEG;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 1.2 * dpr;
    ctx.setLineDash([4 * dpr, 5 * dpr]);
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    proj(launchLat, launchLon);
    const { x: nx0, y: ny0 } = proj(launchLat, launchLon);
    ctx.moveTo(nx0, ny0);
    for (let i = 1; i <= 50; i++) {
      const d    = i * 0.8 * DEG;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d)
                   + Math.cos(lat1) * Math.sin(d) * Math.cos(az));
      const lon2 = lon1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(lat1),
                   Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      let lon2deg = lon2 / DEG;
      if (lon2deg < minLon - 10) lon2deg += 360;
      if (lon2deg > maxLon + 10) lon2deg -= 360;
      const { x: nx, y: ny } = proj(lat2 / DEG, lon2deg);
      ctx.lineTo(nx, ny);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }   /* end nominal track */

  /* Ground track — fading tail: recent segment bright, older dim.
     Break path at anti-meridian jumps (> 120° lon diff).          */
  if (_track.length > 1) {
    ctx.save();
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin  = 'round';

    if (inOrbit) {
      /* In orbit: draw entire history dim, then last ~15% bright */
      const splitIdx = Math.floor(_track.length * 0.85);

      /* Old track — dim */
      ctx.strokeStyle = 'rgba(77,197,220,0.25)';
      ctx.beginPath();
      let move = true;
      for (let i = 0; i <= splitIdx; i++) {
        const p = _track[i];
        if (i > 0 && Math.abs(p.lon - _track[i - 1].lon) > 120) move = true;
        const { x, y } = proj(p.lat, p.lon);
        move ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        move = false;
      }
      ctx.stroke();

      /* Recent tail — bright */
      ctx.strokeStyle = '#4dc5dc';
      ctx.lineWidth   = 2.5 * dpr;
      ctx.beginPath();
      move = true;
      for (let i = splitIdx; i < _track.length; i++) {
        const p = _track[i];
        if (i > splitIdx && Math.abs(p.lon - _track[i - 1].lon) > 120) move = true;
        const { x, y } = proj(p.lat, p.lon);
        move ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        move = false;
      }
      ctx.stroke();
    } else {
      /* Ascent: gradient from dim to bright */
      const p0 = proj(_track[0].lat, _track[0].lon);
      const pN = proj(curLat, curLon);
      const grad = ctx.createLinearGradient(p0.x, p0.y, pN.x, pN.y);
      grad.addColorStop(0, 'rgba(77,197,220,0.35)');
      grad.addColorStop(1, '#4dc5dc');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      let move = true;
      for (let i = 0; i < _track.length; i++) {
        const p = _track[i];
        if (i > 0 && Math.abs(p.lon - _track[i - 1].lon) > 120) move = true;
        const { x, y } = proj(p.lat, p.lon);
        move ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        move = false;
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /* Booster ground track — orange dashed */
  if (_boosterTrack.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,140,50,0.75)';
    ctx.lineWidth   = 1.5 * dpr;
    ctx.lineJoin    = 'round';
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    _boosterTrack.forEach((p, i) => {
      const { x, y } = proj(p.lat, p.lon);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* Booster current position dot */
  const booster = S.booster;
  if (booster?.active || booster?.landed) {
    const bp = proj(booster.lat ?? 0, booster.lon ?? 0);
    ctx.save();
    ctx.fillStyle   = booster.landed ? '#ff6600' : '#ff8c32';
    ctx.shadowColor = '#ff8c32';
    ctx.shadowBlur  = 5 * dpr;
    ctx.beginPath(); ctx.arc(bp.x, bp.y, 3 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur  = 0;
    if (!booster.landed && booster.phase) {
      ctx.font         = `${6 * dpr}px "IBM Plex Mono", monospace`;
      ctx.fillStyle    = 'rgba(255,160,80,0.8)';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(booster.phase.toUpperCase(), bp.x + 4 * dpr, bp.y - 2 * dpr);
    }
    ctx.restore();
  }

  /* Stage 2 ground track after Dragon separation — dim white dashed */
  if (_s2Track.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth   = 1 * dpr;
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.beginPath();
    _s2Track.forEach((p, i) => {
      if (i > 0 && Math.abs(p.lon - _s2Track[i-1].lon) > 120) {
        ctx.stroke(); ctx.beginPath();
      }
      const { x, y } = proj(p.lat, p.lon);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* Stage 2 current position dot */
  if (S.dragonSep && S.s2Vec) {
    const sp = proj(S.s2Lat ?? 0, S.s2Lon ?? 0);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 2 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.font      = `${6 * dpr}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('S2', sp.x + 3 * dpr, sp.y - 2 * dpr);
    ctx.restore();
  }

  /* Space facility markers */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.fillStyle   = 'rgba(255,255,255,0.55)';
  ctx.font        = `${6.5 * dpr}px "IBM Plex Mono", monospace`;
  ctx.lineWidth   = 1 * dpr;
  for (const [sLon, sLat, label] of SPACE_SITES) {
    if (sLat < minLat || sLat > maxLat) continue;
    let lon = sLon;
    if (lon < minLon - 5) lon += 360;
    if (lon > maxLon + 5) lon -= 360;
    if (lon < minLon || lon > maxLon) continue;
    const { x, y } = proj(sLat, lon);
    const r = 2.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x + 3 * dpr, y - 2 * dpr);
  }
  ctx.restore();

  /* Launch site — amber diamond */
  const lp = proj(launchLat, launchLon);
  ctx.save();
  ctx.fillStyle = '#ffb74d';
  ctx.translate(lp.x, lp.y);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-3 * dpr, -3 * dpr, 6 * dpr, 6 * dpr);
  ctx.restore();

  /* Current position — white dot + outer ring */
  const cp = proj(curLat, curLon);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur  = 6 * dpr;
  ctx.beginPath(); ctx.arc(cp.x, cp.y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 1 * dpr;
  ctx.beginPath(); ctx.arc(cp.x, cp.y, 9 * dpr, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  /* Lat/lon axis labels */
  ctx.save();
  ctx.font         = `${7 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(255,255,255,0.22)';
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';
  for (let la = Math.ceil(minLat / gridStep) * gridStep; la <= maxLat; la += gridStep) {
    const p = proj(la, minLon);
    ctx.fillText(`${la}°`, 2 * dpr, p.y + 1 * dpr);
  }
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'center';
  for (let lo = Math.ceil(minLon / gridStep) * gridStep; lo <= maxLon; lo += gridStep) {
    const p     = proj(minLat, lo);
    const label = lo > 180 ? `${(lo - 360).toFixed(0)}°W` : `${lo.toFixed(0)}°E`;
    ctx.fillText(label, p.x, H - 1 * dpr);
  }
  ctx.restore();

  /* Title */
  ctx.save();
  ctx.font         = `bold ${8 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(77,197,220,0.55)';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('GROUND TRACK', W - 4 * dpr, 4 * dpr);
  ctx.restore();

  /* T+ timer top-left */
  const mT   = S.time ?? 0;
  const ignT = S.aircraft?.ignitionTime ?? 0;
  const tLO  = mT - ignT;
  const absT = Math.abs(tLO);
  const sign = tLO >= 0 ? 'T+' : 'T\u2212';
  const mm   = String(Math.floor(absT / 60)).padStart(2, '0');
  const ss   = String(Math.floor(absT % 60)).padStart(2, '0');
  ctx.save();
  ctx.font         = `${9 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = tLO >= 0 ? 'rgba(232,237,242,0.65)' : 'rgba(255,183,77,0.8)';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${sign} ${mm}:${ss}`, 4 * dpr, 4 * dpr);
  ctx.restore();

  /* End clip region */
  ctx.restore();
}

/* ── Side altitude profile strip (left of map) ── */
function _renderSideProfile(ctx, W, H, dpr) {
  /* Background */
  ctx.fillStyle = '#040a12';
  ctx.fillRect(0, 0, W, H);

  /* Right divider */
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(W - 1 * dpr, 0, 1 * dpr, H);

  const ignT  = S.aircraft?.ignitionTime ?? 0;
  const curT  = Math.max(0, (S.time ?? 0) - ignT);
  const altKm = (S.alt ?? 0) * 0.3048 / 1000;
  const maxAlt = Math.max(10, ...(_track.map(p => p.alt ?? 0)), altKm) * 1.1;
  const maxT   = Math.max(curT, 60);

  const pad  = { l: 4 * dpr, r: 14 * dpr, t: 6 * dpr, b: 6 * dpr };
  const pw   = W - pad.l - pad.r;
  const ph   = H - pad.t - pad.b;

  /* altitude → y,  time → x */
  const ay = a => pad.t + ph - (a / maxAlt) * ph;
  const tx = t => pad.l + (t / maxT) * pw;

  /* Altitude grid lines */
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 0.5 * dpr;
  const altStep = maxAlt > 80 ? 50 : maxAlt > 40 ? 25 : 10;
  for (let a = altStep; a < maxAlt; a += altStep) {
    const y = ay(a);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
  }

  /* Stage boundary — horizontal dashed line at staging altitude */
  ctx.setLineDash([2 * dpr, 3 * dpr]);
  ctx.strokeStyle = 'rgba(255,200,80,0.4)';
  ctx.lineWidth   = 0.8 * dpr;
  for (let i = 1; i < _track.length; i++) {
    if ((_track[i].stg ?? 1) > (_track[i-1].stg ?? 1)) {
      const y = ay(_track[i].alt ?? 0);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  /* Altitude curve */
  if (_track.length > 1) {
    ctx.save();
    ctx.beginPath();
    _track.forEach((p, i) => {
      const x = tx(p.t ?? 0);
      const y = ay(p.alt ?? 0);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(tx(curT), ay(altKm));
    ctx.strokeStyle = '#4dc5dc';
    ctx.lineWidth   = 1.5 * dpr;
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.restore();
  }

  /* Current dot */
  ctx.beginPath();
  ctx.arc(tx(curT), ay(altKm), 2.5 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  /* Altitude labels (right side) */
  ctx.save();
  ctx.font         = `${6 * dpr}px "IBM Plex Mono", monospace`;
  ctx.fillStyle    = 'rgba(255,255,255,0.35)';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let a = 0; a <= maxAlt; a += altStep) {
    ctx.fillText(`${a}`, W - 2 * dpr, ay(a));
  }
  /* "km" unit top-left */
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = 'rgba(255,255,255,0.2)';
  ctx.fillText('km', pad.l, 1 * dpr);
  ctx.restore();
}

/* ── Aircraft local mini-map (unchanged) ── */
function _renderLocalMap(ctx, W, H, dpr) {
  const RANGE_NM = 2.7;   /* ~5 km radius → 10×10 km view */

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  const lat  = S.lat ?? 0;
  const lon  = S.lon ?? 0;
  const hdg  = (S.hdg ?? 0) * DEG;
  const spd  = (S.spd ?? 0) * 0.5144;

  const scale  = W / 2 / (RANGE_NM * 1852);
  const cosLat = Math.cos(lat * DEG);

  function toXY(dlat, dlon) {
    const dN = dlat * 60 * 1852;
    const dE = dlon * 60 * 1852 * cosLat;
    return [W / 2 + dE * scale, H / 2 - dN * scale];
  }

  /* Grid */
  const GRID_DEG_LAT = 0.5 / 60;
  const GRID_DEG_LON = GRID_DEG_LAT / cosLat;
  const latMin = lat - RANGE_NM / 60, latMax = lat + RANGE_NM / 60;
  const lonMin = lon - RANGE_NM / 60 / cosLat, lonMax = lon + RANGE_NM / 60 / cosLat;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 0.5 * dpr;
  for (let la = Math.floor(latMin / GRID_DEG_LAT) * GRID_DEG_LAT; la <= latMax; la += GRID_DEG_LAT) {
    const [x0, y0] = toXY(la - lat, lonMin - lon);
    const [x1, y1] = toXY(la - lat, lonMax - lon);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  for (let lo = Math.floor(lonMin / GRID_DEG_LON) * GRID_DEG_LON; lo <= lonMax; lo += GRID_DEG_LON) {
    const [x0, y0] = toXY(latMin - lat, lo - lon);
    const [x1, y1] = toXY(latMax - lat, lo - lon);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  /* Wind */
  const wind = _getWind();
  const windSpd_ms  = wind.spd * 0.5144;
  const windDir_rad = wind.dir * DEG;
  const windN_ms    = windSpd_ms * Math.cos(windDir_rad + Math.PI);
  const windE_ms    = windSpd_ms * Math.sin(windDir_rad + Math.PI);

  /* Track made good */
  const acN_ms  = spd * Math.cos(hdg);
  const acE_ms  = spd * Math.sin(hdg);
  const gndN_ms = acN_ms + windN_ms;
  const gndE_ms = acE_ms + windE_ms;
  const track   = Math.atan2(gndE_ms, gndN_ms);
  const gndSpd  = Math.sqrt(gndN_ms * gndN_ms + gndE_ms * gndE_ms);

  /* Heading vector */
  const headLen = 40 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth   = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(W / 2, H / 2);
  ctx.lineTo(W / 2 + Math.sin(hdg) * headLen, H / 2 - Math.cos(hdg) * headLen);
  ctx.stroke();

  /* Track vector */
  const trackLen = 40 * dpr * (gndSpd / Math.max(1, spd));
  ctx.strokeStyle = 'rgba(255,180,0,0.85)';
  ctx.lineWidth   = 1.5 * dpr;
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.beginPath();
  ctx.moveTo(W / 2, H / 2);
  ctx.lineTo(W / 2 + Math.sin(track) * trackLen, H / 2 - Math.cos(track) * trackLen);
  ctx.stroke();
  ctx.setLineDash([]);

  /* Aircraft symbol */
  _drawAircraft(ctx, W / 2, H / 2, hdg, dpr);

  /* Wind arrow */
  if (wind.spd > 0) {
    const wx = 22 * dpr, wy = H - 22 * dpr;
    const wLen = 14 * dpr;
    const wFrom = windDir_rad;
    ctx.strokeStyle = 'rgba(100,180,255,0.7)';
    ctx.lineWidth   = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(wx + Math.sin(wFrom) * wLen, wy - Math.cos(wFrom) * wLen);
    ctx.lineTo(wx - Math.sin(wFrom) * wLen, wy + Math.cos(wFrom) * wLen);
    ctx.stroke();
    ctx.fillStyle = 'rgba(100,180,255,0.7)';
    ctx.font = `${8 * dpr}px monospace`;
    ctx.fillText(Math.round(wind.spd) + 'kt', wx + 10 * dpr, wy + 4 * dpr);
  }

  /* Compass ring */
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 0.8 * dpr;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, W / 2 - 2 * dpr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font      = `${8 * dpr}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('N', W / 2, 10 * dpr);

  /* Scale bar */
  const scaleNm = 2;
  const scalePx = scaleNm * 1852 * scale;
  const sx = W - 8 * dpr - scalePx, sy = H - 8 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth   = 1 * dpr;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + scalePx, sy); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font      = `${7 * dpr}px monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(scaleNm + 'nm', sx + scalePx, sy - 3 * dpr);

  /* Stopwatch */
  const t  = S.time ?? 0;
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(Math.floor(t % 60)).padStart(2, '0');
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font      = `${9 * dpr}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(`${mm}:${ss}`, 6 * dpr, 10 * dpr);

  /* HDG / TRK */
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font      = `${8 * dpr}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('HDG ' + String(Math.round(S.hdg ?? 0)).padStart(3, '0'), 6 * dpr, 22 * dpr);
  const trkDeg = ((track / DEG) + 360) % 360;
  ctx.fillStyle = 'rgba(255,180,0,0.85)';
  ctx.fillText('TRK ' + String(Math.round(trkDeg)).padStart(3, '0'), 6 * dpr, 32 * dpr);
}

function _drawAircraft(ctx, cx, cy, hdg, dpr) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(hdg);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle   = '#ffffff';
  ctx.lineWidth   = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(0, -8 * dpr); ctx.lineTo(0,  7 * dpr); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9 * dpr, 0); ctx.lineTo( 9 * dpr, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5 * dpr, 5 * dpr); ctx.lineTo( 5 * dpr, 5 * dpr); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -8 * dpr, 1.5 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function _getWind() {
  const w = S.mission?.weather;
  if (!w) return { dir: 0, spd: 0 };
  const src = w.source === 'manual' ? w.manual
            : w.source === 'live'   ? S.metar
            : w.fallback;
  if (!src) return { dir: 0, spd: 0 };
  return { dir: src.wdir ?? src.wind ?? 0, spd: src.wspd ?? 0 };
}
