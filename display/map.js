/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/map.js
   Moving map — two modes:

   Aircraft  : local mini-map, North-up, heading + track vectors
   Rocket    : equirectangular world map, ground track, bigger panel
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const DEG = Math.PI / 180;

/* Sizes */
const LOCAL_SIZE = 180;        /* px — aircraft mini-map */
const ROCKET_W   = 340;        /* px — rocket world map */
const ROCKET_H   = 210;        /* px */

let _el      = null;
let _canvas  = null;
let _visible = true;
let _mode    = 'local';        /* 'local' | 'rocket' */

/* Ground track history for rocket missions */
let _track          = [];
let _trackMissionId = null;

export function initMap() {
  _el = document.createElement('div');
  _el.id = 'minimap';
  _applySize('local');
  _canvas = document.createElement('canvas');
  _canvas.style.cssText = 'display:block;width:100%;height:100%;';
  _el.appendChild(_canvas);
  document.body.appendChild(_el);
}

function _applySize(mode) {
  const w = mode === 'rocket' ? ROCKET_W : LOCAL_SIZE;
  const h = mode === 'rocket' ? ROCKET_H : LOCAL_SIZE;
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
  `;
}

export function toggleMap() {
  _visible = !_visible;
  _el.style.display = _visible ? '' : 'none';
}

export function renderMap() {
  if (!_el || !_visible) return;

  const isRocket = S.aircraft?.vehicleType === 'rocket';

  /* Switch container size if mode changed */
  const newMode = isRocket ? 'rocket' : 'local';
  if (newMode !== _mode) {
    _mode = newMode;
    _applySize(_mode);
  }

  const dpr = window.devicePixelRatio || 1;
  const W   = (isRocket ? ROCKET_W : LOCAL_SIZE) * dpr;
  const H   = (isRocket ? ROCKET_H : LOCAL_SIZE) * dpr;
  _canvas.width  = W;
  _canvas.height = H;
  const ctx = _canvas.getContext('2d');

  if (isRocket) {
    _updateTrack();
    _renderWorldMap(ctx, W, H, dpr);
  } else {
    _renderLocalMap(ctx, W, H, dpr);
  }
}

/* ── Track history ── */
function _updateTrack() {
  const missionId = S.mission?.id;
  if (missionId !== _trackMissionId) {
    _track          = [];
    _trackMissionId = missionId;
  }

  const mT   = S.time ?? 0;
  const ignT = S.aircraft?.ignitionTime ?? 0;
  if (mT < ignT) return;   /* don't track during countdown */

  const lat = S.lat ?? 0;
  const lon = S.lon ?? 0;
  const last = _track[_track.length - 1];
  if (!last || Math.abs(lat - last.lat) + Math.abs(lon - last.lon) > 0.005) {
    _track.push({ lat, lon });
  }
}

/* ── Rocket world map ── */
function _renderWorldMap(ctx, W, H, dpr) {
  const launch   = S.mission?.initialState ?? {};
  const launchLat = launch.lat ?? 0;
  const launchLon = launch.lon ?? 0;
  const curLat    = S.lat  ?? launchLat;
  const curLon    = S.lon  ?? launchLon;

  /* Compute extent from track + launch + current */
  const allLats = [launchLat, curLat, ..._track.map(p => p.lat)];
  const allLons = [launchLon, curLon, ..._track.map(p => p.lon)];

  const rawMinLat = Math.min(...allLats);
  const rawMaxLat = Math.max(...allLats);
  const rawMinLon = Math.min(...allLons);
  const rawMaxLon = Math.max(...allLons);

  /* Minimum window: 18° lat × 40° lon */
  const cLat   = (rawMinLat + rawMaxLat) / 2;
  const cLon   = (rawMinLon + rawMaxLon) / 2;
  const latSpan = Math.max(rawMaxLat - rawMinLat + 8,  18);
  const lonSpan = Math.max(rawMaxLon - rawMinLon + 8,  40);

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

  /* Ground track */
  if (_track.length > 1) {
    ctx.save();
    const grad = ctx.createLinearGradient(
      proj(_track[0].lat, _track[0].lon).x,
      proj(_track[0].lat, _track[0].lon).y,
      proj(curLat, curLon).x,
      proj(curLat, curLon).y,
    );
    grad.addColorStop(0, 'rgba(77,197,220,0.4)');
    grad.addColorStop(1, '#4dc5dc');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2 * dpr;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    _track.forEach((p, i) => {
      const { x, y } = proj(p.lat, p.lon);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

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
}

/* ── Aircraft local mini-map (unchanged) ── */
function _renderLocalMap(ctx, W, H, dpr) {
  const RANGE_NM = 8;

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
