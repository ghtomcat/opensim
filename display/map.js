/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/map.js
   Moving map — dead reckoning position, heading, track made good.
   Canvas overlay, top-right corner.
   Friedrich's knee map: heading ≠ track in crosswind.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const DEG = Math.PI / 180;
const SIZE = 180;          // px (CSS), retina scaled in draw
const RANGE_NM = 8;        // nm radius shown

let _el     = null;   // container div
let _canvas = null;
let _ctx    = null;
let _visible = true;

export function initMap() {
  _el = document.createElement('div');
  _el.id = 'minimap';
  _el.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    width: ${SIZE}px;
    height: ${SIZE}px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 2px 12px rgba(0,0,0,0.6);
    z-index: 8000;
    pointer-events: none;
  `;

  _canvas = document.createElement('canvas');
  _canvas.style.cssText = 'display:block;width:100%;height:100%;';
  _el.appendChild(_canvas);
  document.body.appendChild(_el);
}

export function toggleMap() {
  _visible = !_visible;
  _el.style.display = _visible ? '' : 'none';
}

export function renderMap() {
  if (!_el || !_visible) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = SIZE * dpr;
  const H   = SIZE * dpr;
  _canvas.width  = W;
  _canvas.height = H;
  const ctx = _canvas.getContext('2d');
  _ctx = ctx;

  /* ── Background ── */
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  const lat  = S.lat ?? 0;
  const lon  = S.lon ?? 0;
  const hdg  = (S.hdg ?? 0) * DEG;
  const spd  = (S.spd ?? 0) * 0.5144;   // m/s

  /* nm per pixel */
  const scale = W / 2 / (RANGE_NM * 1852);   // px per metre

  /* ── Convert lat/lon offset to screen xy (North-up) ── */
  const cosLat = Math.cos(lat * DEG);
  function toXY(dlat, dlon) {
    const dN = dlat * 60 * 1852;   // metres north
    const dE = dlon * 60 * 1852 * cosLat;
    return [W / 2 + dE * scale, H / 2 - dN * scale];
  }

  /* ── Grid — 0.5nm lat/lon lines ── */
  const GRID_DEG_LAT = (0.5 / 60);
  const GRID_DEG_LON = (0.5 / 60) / cosLat;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 0.5 * dpr;

  const latMin = lat - RANGE_NM / 60;
  const latMax = lat + RANGE_NM / 60;
  const lonMin = lon - RANGE_NM / 60 / cosLat;
  const lonMax = lon + RANGE_NM / 60 / cosLat;

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

  /* ── Wind ── */
  const wind = _getWind();
  const windSpd_ms  = wind.spd * 0.5144;
  const windDir_rad = wind.dir * DEG;
  const windN_ms    = windSpd_ms * Math.cos(windDir_rad + Math.PI);
  const windE_ms    = windSpd_ms * Math.sin(windDir_rad + Math.PI);

  /* ── Track made good ── */
  const acN_ms  = spd * Math.cos(hdg);
  const acE_ms  = spd * Math.sin(hdg);
  const gndN_ms = acN_ms + windN_ms;
  const gndE_ms = acE_ms + windE_ms;
  const track   = Math.atan2(gndE_ms, gndN_ms);
  const gndSpd  = Math.sqrt(gndN_ms * gndN_ms + gndE_ms * gndE_ms);

  /* ── Heading vector (white) ── */
  const headLen = 40 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth   = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(W / 2, H / 2);
  ctx.lineTo(W / 2 + Math.sin(hdg) * headLen, H / 2 - Math.cos(hdg) * headLen);
  ctx.stroke();

  /* ── Track vector (amber dashed) ── */
  const trackLen = 40 * dpr * (gndSpd / Math.max(1, spd));
  ctx.strokeStyle = 'rgba(255,180,0,0.85)';
  ctx.lineWidth   = 1.5 * dpr;
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.beginPath();
  ctx.moveTo(W / 2, H / 2);
  ctx.lineTo(W / 2 + Math.sin(track) * trackLen, H / 2 - Math.cos(track) * trackLen);
  ctx.stroke();
  ctx.setLineDash([]);

  /* ── Aircraft symbol ── */
  _drawAircraft(ctx, W / 2, H / 2, hdg, dpr);

  /* ── Wind arrow (bottom-left) ── */
  if (wind.spd > 0) {
    const wx = 22 * dpr, wy = H - 22 * dpr;
    const wLen = 14 * dpr;
    const wFrom = windDir_rad;   // FROM direction
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

  /* ── Compass ring ── */
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 0.8 * dpr;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, W / 2 - 2 * dpr, 0, Math.PI * 2);
  ctx.stroke();

  /* N label */
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font      = `${8 * dpr}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('N', W / 2, 10 * dpr);

  /* ── Scale bar ── */
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

  /* ── Stopwatch ── */
  const t   = S.time ?? 0;
  const mm  = String(Math.floor(t / 60)).padStart(2, '0');
  const ss  = String(Math.floor(t % 60)).padStart(2, '0');
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font      = `${9 * dpr}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(`${mm}:${ss}`, 6 * dpr, 10 * dpr);

  /* ── HDG / TRK readout ── */
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font      = `${8 * dpr}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('HDG ' + String(Math.round(S.hdg ?? 0)).padStart(3,'0'), 6 * dpr, 22 * dpr);
  const trkDeg = ((track / DEG) + 360) % 360;
  ctx.fillStyle = 'rgba(255,180,0,0.85)';
  ctx.fillText('TRK ' + String(Math.round(trkDeg)).padStart(3,'0'), 6 * dpr, 32 * dpr);
}

function _drawAircraft(ctx, cx, cy, hdg, dpr) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(hdg);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle   = '#ffffff';
  ctx.lineWidth   = 1.5 * dpr;

  /* Fuselage */
  ctx.beginPath();
  ctx.moveTo(0, -8 * dpr);
  ctx.lineTo(0,  7 * dpr);
  ctx.stroke();

  /* Wings */
  ctx.beginPath();
  ctx.moveTo(-9 * dpr, 0);
  ctx.lineTo( 9 * dpr, 0);
  ctx.stroke();

  /* Tail */
  ctx.beginPath();
  ctx.moveTo(-5 * dpr, 5 * dpr);
  ctx.lineTo( 5 * dpr, 5 * dpr);
  ctx.stroke();

  /* Nose dot */
  ctx.beginPath();
  ctx.arc(0, -8 * dpr, 1.5 * dpr, 0, Math.PI * 2);
  ctx.fill();

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
