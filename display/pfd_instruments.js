/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/pfd_instruments.js
   Reusable PFD instrument drawing primitives.
   Signature: draw___(ctx, box, style, config?)
     box   = { x, y, w, h }  canvas pixels (DPR-scaled)
     style = { colors:{...}, font: "mono"|"ui" }
   All functions read from S (global state) — no state params.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { smooth, smoothAngle } from './smooth.js';

const _MONO = '"IBM Plex Mono","Courier New",monospace';
const _UI   = '"Syne","Helvetica Neue",sans-serif';

function _f(style)      { return style.font === 'ui' ? _UI : _MONO; }
function _c(style, key) { return style.colors[key] ?? key; }

function _fmaCol(col, style) {
  switch (col) {
    case 'green':   return _c(style, 'engaged');
    case 'cyan':    return _c(style, 'selected');
    case 'amber':   return _c(style, 'managed');
    case 'white':   return _c(style, 'white');
    case 'magenta': return '#d47bcc';
    default:        return col;
  }
}

/* ════════════════════════════════════════════════════════════
   FMA — Flight Mode Annunciator
   ════════════════════════════════════════════════════════════ */
/* Manufacturer seam: Boeing reads 3 fields (A/T | roll | pitch), everyone else the
   Airbus 5 columns. Both consume S.fma, populated by the shared phase model. */
export function drawFMA(ctx, box, style) {
  return (S.aircraft?.manufacturer === 'boeing' ? _fmaBoeing : _fmaAirbus)(ctx, box, style);
}

/* Airbus — five unlabeled columns with thin separators; column position is the meaning. */
function _fmaAirbus(ctx, box, style) {
  const { x, y, w, h } = box;
  const f  = _f(style);
  const cw = w / 5;

  ctx.save();
  ctx.fillStyle = _c(style, 'bg');
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * cw, y + h * 0.12);
    ctx.lineTo(x + i * cw, y + h * 0.88);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 5; i++) {
    const fma = S.fma[i];
    if (!fma || !fma.val) continue;
    const cx = x + i * cw + cw / 2;

    let fs = h * 0.5;
    ctx.font = `bold ${fs}px ${f}`;
    const tw = ctx.measureText(fma.val).width;
    if (tw > cw * 0.9) { fs *= (cw * 0.9) / tw; ctx.font = `bold ${fs}px ${f}`; }   // fit long modes
    ctx.fillStyle = _fmaCol(fma.col ?? 'white', style);
    ctx.fillText(fma.val, cx, y + h * 0.52);
  }

  ctx.restore();
}

/* Boeing — three fields (A/T | roll | pitch), no separators (spacing carries it), green
   active modes. */
function _fmaBoeing(ctx, box, style) {
  const { x, y, w, h } = box;
  const f  = _f(style);
  const cw = w / 3;

  ctx.save();
  ctx.fillStyle = _c(style, 'bg');
  ctx.fillRect(x, y, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const fma = S.fma[i];
    if (!fma || !fma.val) continue;
    const cx = x + i * cw + cw / 2;

    let fs = h * 0.5;
    ctx.font = `bold ${fs}px ${f}`;
    const tw = ctx.measureText(fma.val).width;
    if (tw > cw * 0.86) { fs *= (cw * 0.86) / tw; ctx.font = `bold ${fs}px ${f}`; }
    ctx.fillStyle = _fmaCol(fma.col ?? 'green', style);
    ctx.fillText(fma.val, cx, y + h * 0.52);
  }

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   ATTITUDE INDICATOR
   ════════════════════════════════════════════════════════════ */
export function drawAI(ctx, box, style, config = {}) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;

  const pxPerDeg = h * 0.013;
  const pitchPx  = S.pitch * pxPerDeg;
  const rollRad  = S.roll  * Math.PI / 180;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate(-rollRad);

  ctx.fillStyle = _c(style, 'sky');
  ctx.fillRect(-w * 2, -h * 2, w * 4, h * 2 + pitchPx);

  ctx.fillStyle = _c(style, 'ground');
  ctx.fillRect(-w * 2, pitchPx, w * 4, h * 2);

  ctx.strokeStyle = _c(style, 'horizon');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w * 2, pitchPx);
  ctx.lineTo(w * 2, pitchPx);
  ctx.stroke();

  _pitchLadder(ctx, pitchPx, pxPerDeg, style, w, h);

  ctx.restore();

  _aircraftRef(ctx, box, style);
  if (config.fpv)      _fpv(ctx, box, style);
  if (config.ils)      _ils(ctx, box, style);
  if (config.bank_arc) _bankArc(ctx, box, style);
}

function _pitchLadder(ctx, pitchPx, pxPerDeg, style, bw, bh) {
  const white = _c(style, 'white');
  const warn  = _c(style, 'caution');
  const full  = Math.min(bw * 0.48, bh * 0.18);
  const half  = full * 0.5;
  const fs    = bh * 0.022;

  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';

  for (let deg = -30; deg <= 30; deg += 5) {
    if (deg === 0) continue;
    const py  = pitchPx - deg * pxPerDeg;
    const w2  = deg % 10 === 0 ? full : half;
    const col = deg > 0 ? white : warn;

    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w2 / 2, py);
    ctx.lineTo( w2 / 2, py);
    ctx.stroke();

    if (deg % 10 === 0) {
      ctx.font      = `${fs}px ${_MONO}`;
      ctx.fillStyle = col;
      ctx.fillText(Math.abs(deg), -w2 / 2 - fs * 1.2, py);
      ctx.fillText(Math.abs(deg),  w2 / 2 + fs * 1.2, py);
    }
  }

  ctx.textBaseline = 'alphabetic';
}

function _aircraftRef(ctx, box, style) {
  const cx  = box.x + box.w / 2;
  const cy  = box.y + box.h / 2;
  const arm = box.h * 0.038;
  const col = style.colors.refSymbol ?? '#e8c91e';   // Airbus aircraft reference symbol — yellow

  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;
  ctx.lineWidth   = 3;

  /* Two yellow wings with a square hub + a stub below — the fixed aircraft reference. */
  ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);

  ctx.beginPath();
  ctx.moveTo(cx - arm * 3, cy);
  ctx.lineTo(cx - arm,     cy);
  ctx.moveTo(cx + arm,     cy);
  ctx.lineTo(cx + arm * 3, cy);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - arm * 1.6);
  ctx.stroke();

  ctx.restore();
}

function _fpv(ctx, box, style) {
  const cx    = box.x + box.w / 2;
  const cy    = box.y + box.h / 2;
  const sc    = box.h / 800;
  const fpvY  = cy - S.vs * 0.004 * sc;
  const fpvX  = cx + S.roll * 0.5 * sc;
  const r     = 10 * sc;

  ctx.save();
  ctx.strokeStyle = _c(style, 'engaged');
  ctx.lineWidth   = 2;

  ctx.beginPath();
  ctx.arc(fpvX, fpvY, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(fpvX + r,            fpvY);
  ctx.lineTo(fpvX + r + 18 * sc, fpvY);
  ctx.moveTo(fpvX - r,            fpvY);
  ctx.lineTo(fpvX - r - 18 * sc, fpvY);
  ctx.moveTo(fpvX,                fpvY - r);
  ctx.lineTo(fpvX,                fpvY - r - 10 * sc);
  ctx.stroke();

  ctx.restore();
}

function _ils(ctx, box, style) {
  const cx    = box.x + box.w / 2;
  const cy    = box.y + box.h / 2;
  const sp    = box.h * 0.05;
  const dotR  = Math.max(3, box.h * 0.005);
  const sel   = _c(style, 'selected');
  const dim   = _c(style, 'dim');

  ctx.save();
  ctx.globalAlpha = 0.85;

  const locY = cy + box.h * 0.15;
  ctx.strokeStyle = dim;
  ctx.lineWidth   = 1.5;
  for (const d of [-2, -1, 1, 2]) {
    ctx.beginPath();
    ctx.arc(cx + d * sp, locY, dotR, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = sel;
  ctx.beginPath();
  ctx.arc(cx + S.ilsLoc * sp, locY, dotR + 2, 0, Math.PI * 2);
  ctx.fill();

  const gsX = cx + box.w * 0.22;
  for (const d of [-2, -1, 1, 2]) {
    ctx.beginPath();
    ctx.arc(gsX, cy + d * sp, dotR, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = sel;
  ctx.beginPath();
  ctx.arc(gsX, cy - S.ilsGs * sp, dotR + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function _bankArc(ctx, box, style) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r  = Math.min(box.w, box.h) * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.strokeStyle = _c(style, 'white');
  ctx.lineWidth   = 1.5;

  for (const deg of [10, 20, 30, 45, 60, -10, -20, -30, -45, -60]) {
    const rad = (deg - 90) * Math.PI / 180;
    const len = Math.abs(deg) % 30 === 0 ? 14 : 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * r,         Math.sin(rad) * r);
    ctx.lineTo(Math.cos(rad) * (r - len), Math.sin(rad) * (r - len));
    ctx.stroke();
  }

  /* Fixed roll reference index at the top (0°) — a small triangle the moving pointer
     sits under at wings level. */
  ctx.fillStyle = _c(style, 'white');
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(-5, -r - 9);
  ctx.lineTo( 5, -r - 9);
  ctx.closePath();
  ctx.fill();

  /* Moving bank pointer — sweeps the scale with roll. */
  const ptr = (-S.roll - 90) * Math.PI / 180;
  const px  = Math.cos(ptr) * (r - 2);
  const py  = Math.sin(ptr) * (r - 2);

  ctx.beginPath();
  ctx.moveTo(px - Math.sin(ptr) * 8, py + Math.cos(ptr) * 8);
  ctx.lineTo(px + Math.sin(ptr) * 8, py - Math.cos(ptr) * 8);
  ctx.lineTo(Math.cos(ptr) * (r - 18), Math.sin(ptr) * (r - 18));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   SPEED TAPE
   ════════════════════════════════════════════════════════════ */
export function drawSpeedTape(ctx, box, style) {
  const { x, y, w, h } = box;
  const cy   = y + h / 2;
  const spd  = smooth('pfd.spd', S.spd, 0.35);   // gliding airspeed, AP bug stays snappy
  const spdT = S.spdT;
  const f    = _f(style);

  ctx.fillStyle = _c(style, 'tape');
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const pxPerKt = h / 80;
  const tw1     = w * 0.28;
  const tw2     = w * 0.44;

  ctx.strokeStyle = _c(style, 'dim');
  ctx.lineWidth   = 1;
  ctx.fillStyle   = _c(style, 'white');
  ctx.font        = `${h * 0.020}px ${f}`;
  ctx.textAlign   = 'right';

  const vMin = Math.floor((spd - 42) / 5) * 5;
  const vMax = Math.ceil((spd + 42) / 5) * 5;

  for (let v = vMin; v <= vMax; v += 5) {
    if (v < 0) continue;
    const vy = cy + (spd - v) * pxPerKt;
    const tw = v % 10 === 0 ? tw2 : tw1;
    ctx.beginPath();
    ctx.moveTo(x + w - tw, vy);
    ctx.lineTo(x + w,      vy);
    ctx.stroke();
    if (v % 20 === 0) {
      ctx.fillText(v, x + w - tw2 - w * 0.06, vy + h * 0.010);
    }
  }

  ctx.restore();

  // target speed bug — notch on right edge
  const tgtY = cy + (spd - spdT) * pxPerKt;
  if (tgtY >= y && tgtY <= y + h) {
    const bh = h * 0.025;
    const bw = w * 0.22;
    ctx.fillStyle = _c(style, 'selected');
    ctx.beginPath();
    ctx.moveTo(x + w,      tgtY);
    ctx.lineTo(x + w - bw, tgtY - bh);
    ctx.lineTo(x + w - bw, tgtY + bh);
    ctx.closePath();
    ctx.fill();
  }

  // current speed readout box
  const rh = h * 0.075;
  const ry = cy - rh / 2;

  ctx.fillStyle = 'rgba(6,10,16,0.88)';
  ctx.fillRect(x, ry, w, rh);
  ctx.strokeStyle = _c(style, 'white');
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, ry, w, rh);

  ctx.font      = `bold ${rh * 0.68}px ${f}`;
  ctx.fillStyle = _c(style, 'white');
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(spd), x + w / 2, ry + rh * 0.75);
}

/* ════════════════════════════════════════════════════════════
   ALTITUDE TAPE
   ════════════════════════════════════════════════════════════ */
export function drawAltTape(ctx, box, style) {
  const { x, y, w, h } = box;
  const cy  = y + h / 2;
  const alt = smooth('pfd.alt', S.alt, 0.30);    // gliding altitude
  const altT = S.altT;
  const f   = _f(style);

  ctx.fillStyle = _c(style, 'tape');
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const pxPerFt = h / 1600;
  const tw1     = w * 0.25;
  const tw2     = w * 0.42;

  ctx.strokeStyle = _c(style, 'dim');
  ctx.lineWidth   = 1;
  ctx.fillStyle   = _c(style, 'white');
  ctx.font        = `${h * 0.020}px ${f}`;
  ctx.textAlign   = 'right';

  const vMin = Math.floor((alt - 850) / 100) * 100;
  const vMax = Math.ceil((alt + 850) / 100) * 100;

  for (let v = vMin; v <= vMax; v += 100) {
    if (v < 0) continue;
    const vy = cy + (alt - v) * pxPerFt;
    const tw = v % 200 === 0 ? tw2 : tw1;
    ctx.beginPath();
    ctx.moveTo(x,      vy);
    ctx.lineTo(x + tw, vy);
    ctx.stroke();
    if (v % 200 === 0) {
      ctx.fillText(Math.round(v / 100), x + w - w * 0.06, vy + h * 0.010);
    }
  }

  ctx.restore();

  // target alt bug — notch on left edge
  const tgtY = cy + (alt - altT) * pxPerFt;
  if (tgtY >= y && tgtY <= y + h) {
    const bh = h * 0.02;
    const bw = w * 0.22;
    ctx.fillStyle = _c(style, 'selected');
    ctx.beginPath();
    ctx.moveTo(x,      tgtY);
    ctx.lineTo(x + bw, tgtY - bh);
    ctx.lineTo(x + bw, tgtY + bh);
    ctx.closePath();
    ctx.fill();
  }

  // current alt readout box
  const rh = h * 0.065;
  const ry = cy - rh / 2;

  ctx.fillStyle = 'rgba(6,10,16,0.88)';
  ctx.fillRect(x, ry, w, rh);
  ctx.strokeStyle = _c(style, 'white');
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, ry, w, rh);

  ctx.font      = `bold ${rh * 0.66}px ${f}`;
  ctx.fillStyle = _c(style, 'white');
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(alt), x + w / 2, ry + rh * 0.75);

  /* ── Radio altitude — shown below 2500 ft AGL ── */
  const fieldElev = S.mission?.arrival?.elevation
                 ?? S.mission?.departure?.elevation
                 ?? S.aircraft?.situations?.[0]?.alt
                 ?? 0;
  const ra = Math.round(alt - fieldElev);
  if (ra < 2500) {
    const raH = rh * 0.85;
    const raY = y + h - raH * 1.1;
    ctx.font      = `bold ${raH * 0.7}px ${f}`;
    ctx.fillStyle = ra < 200 ? _c(style, 'caution') : _c(style, 'engaged');
    ctx.textAlign = 'right';
    ctx.fillText(`RA  ${Math.max(0, ra)}`, x + w - w * 0.06, raY + raH * 0.78);
  }
}

/* ════════════════════════════════════════════════════════════
   VSI — Vertical Speed Indicator
   ════════════════════════════════════════════════════════════ */
export function drawVSI(ctx, box, style) {
  const { x, y, w, h } = box;
  const cy   = y + h / 2;
  const maxV = 4000;
  const halfH = h * 0.44;
  const barW  = w * 0.45;
  const bx    = x + (w - barW) / 2;

  ctx.fillStyle = _c(style, 'tape');
  ctx.fillRect(x, y, w, h);

  const vsCap = Math.max(-maxV, Math.min(maxV, smooth('pfd.vs', S.vs, 0.5)));
  const barH  = (vsCap / maxV) * halfH;

  ctx.fillStyle = vsCap >= 0 ? _c(style, 'engaged') : _c(style, 'caution');
  if (barH >= 0) ctx.fillRect(bx, cy - barH, barW, barH);
  else           ctx.fillRect(bx, cy,          barW, -barH);

  ctx.strokeStyle = _c(style, 'dim');
  ctx.lineWidth   = 1;
  for (const v of [1000, 2000, 4000, -1000, -2000, -4000]) {
    const my = cy - (v / maxV) * halfH;
    ctx.beginPath();
    ctx.moveTo(x,     my);
    ctx.lineTo(x + w, my);
    ctx.stroke();
  }
}

/* ════════════════════════════════════════════════════════════
   HEADING TAPE
   ════════════════════════════════════════════════════════════ */
export function drawHdgTape(ctx, box, style) {
  const { x, y, w, h } = box;
  const cx   = x + w / 2;
  const hdg  = smoothAngle('pfd.hdg', S.hdg, 0.30);   // gliding heading (shortest-arc)
  const hdgT = S.hdgT;
  const f    = _f(style);

  ctx.fillStyle = _c(style, 'tape');
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const pxPerDeg = w / 60;
  const th1      = h * 0.26;
  const th2      = h * 0.40;

  ctx.strokeStyle = _c(style, 'dim');
  ctx.lineWidth   = 1;
  ctx.fillStyle   = _c(style, 'white');
  ctx.font        = `${h * 0.33}px ${f}`;
  ctx.textAlign   = 'center';

  for (let d = -32; d <= 32; d += 5) {
    const deg = ((hdg + d) % 360 + 360) % 360;
    const px  = cx + d * pxPerDeg;
    const th  = d % 10 === 0 ? th2 : th1;

    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + th);
    ctx.stroke();

    if (d % 10 === 0) {
      const lbl = deg === 0   ? 'N'
                : deg === 90  ? 'E'
                : deg === 180 ? 'S'
                : deg === 270 ? 'W'
                : String(Math.round(deg / 10));
      ctx.fillText(lbl, px, y + h * 0.84);
    }
  }

  ctx.restore();

  // current heading triangle (top center)
  const tw = w * 0.022;
  const tt = h * 0.30;
  ctx.fillStyle = _c(style, 'white');
  ctx.beginPath();
  ctx.moveTo(cx,      y);
  ctx.lineTo(cx - tw, y + tt);
  ctx.lineTo(cx + tw, y + tt);
  ctx.closePath();
  ctx.fill();

  // heading readout (bottom center of tape)
  ctx.font      = `bold ${h * 0.38}px ${f}`;
  ctx.fillStyle = _c(style, 'white');
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', cx, y + h * 0.60);

  // target heading bug
  const dDiff = ((hdgT - hdg + 540) % 360) - 180;
  const bugX  = cx + dDiff * pxPerDeg;
  if (bugX >= x && bugX <= x + w) {
    const bw = w * 0.018;
    const bh = h * 0.26;
    ctx.fillStyle = _c(style, 'selected');
    ctx.beginPath();
    ctx.moveTo(bugX,      y + bh);
    ctx.lineTo(bugX - bw, y);
    ctx.lineTo(bugX + bw, y);
    ctx.closePath();
    ctx.fill();
  }
}

/* ════════════════════════════════════════════════════════════
   ND MAP — Navigation Display (heading-up compass rose)
   ════════════════════════════════════════════════════════════ */
export function drawNDMap(ctx, box, style, config = {}) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const f  = _f(style);
  const r  = Math.min(w, h) * 0.38;
  const rangeNm   = config.range_nm ?? 20;
  const pxPerNm   = r / rangeNm;
  const hdgRad    = S.hdg * Math.PI / 180;
  const cosH      = Math.cos(hdgRad);
  const sinH      = Math.sin(hdgRad);
  const acLat     = S.lat ?? 0;
  const acLon     = S.lon ?? 0;
  const cosAcLat  = Math.cos(acLat * Math.PI / 180);

  ctx.fillStyle = '#030609';
  ctx.fillRect(x, y, w, h);

  /* Compass rose */
  ctx.strokeStyle = 'rgba(180,210,225,0.35)';
  ctx.lineWidth   = 1;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font         = `${h * 0.025}px ${f}`;
  ctx.fillStyle    = 'rgba(200,220,230,0.65)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  const LBLS = ['N','3','6','E','12','15','S','21','24','W','30','33'];
  for (let d = 0; d < 360; d += 10) {
    /* Rose ticks rotate with heading (heading-up: aircraft hdg points up) */
    const rel = (d - S.hdg + 360) % 360;
    const rad = (rel - 90) * Math.PI / 180;
    const len = d % 30 === 0 ? 16 : 7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r,       cy + Math.sin(rad) * r);
    ctx.lineTo(cx + Math.cos(rad) * (r-len), cy + Math.sin(rad) * (r-len));
    ctx.stroke();
    if (d % 30 === 0) {
      const lr = r - len - h * 0.025;
      ctx.fillText(LBLS[d / 30], cx + Math.cos(rad) * lr, cy + Math.sin(rad) * lr);
    }
  }

  ctx.textBaseline = 'alphabetic';

  /* Helper: geo → screen (heading-up, aircraft at centre) */
  function _wptScreen(lat, lon) {
    const dN = (lat - acLat) * 60;
    const dE = (lon - acLon) * 60 * cosAcLat;
    const fwd =  dN * cosH + dE * sinH;
    const rgt = -dN * sinH + dE * cosH;
    return [cx + rgt * pxPerNm, cy - fwd * pxPerNm];
  }

  /* Waypoint route */
  const wpts = S.mission?.waypoints;
  if (wpts?.length) {
    /* Route line */
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    let started = false;
    for (const w of wpts) {
      const [sx, sy] = _wptScreen(w.lat, w.lon);
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else            ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    /* Waypoint symbols + labels */
    for (const wp of wpts) {
      const [sx, sy] = _wptScreen(wp.lat, wp.lon);
      const inside = sx >= x && sx <= x+w && sy >= y && sy <= y+h;
      if (!inside) continue;

      const isFAF = wp.type === 'FAF';
      const isMAP = wp.type === 'MAP';
      const sz    = h * 0.018;

      ctx.strokeStyle = isFAF ? _c(style, 'selected') : isMAP ? _c(style, 'caution') : _c(style, 'white');
      ctx.lineWidth   = 1.5;
      ctx.fillStyle   = 'transparent';

      /* Triangle symbol */
      ctx.beginPath();
      ctx.moveTo(sx,        sy - sz * 1.3);
      ctx.lineTo(sx + sz,   sy + sz * 0.7);
      ctx.lineTo(sx - sz,   sy + sz * 0.7);
      ctx.closePath();
      ctx.stroke();

      /* Name label */
      ctx.font      = `${h * 0.024}px ${f}`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'left';
      ctx.fillText(wp.name, sx + sz + 3, sy + sz * 0.4);

      /* Altitude constraint */
      if (wp.alt) {
        ctx.font      = `${h * 0.019}px ${f}`;
        ctx.fillStyle = 'rgba(200,220,230,0.45)';
        ctx.fillText(Math.round(wp.alt / 100) * 100, sx + sz + 3, sy + sz * 0.4 + h * 0.025);
      }
    }
  }

  /* Heading vector (aircraft → 6 NM ahead) */
  const [hx, hy] = _wptScreen(acLat + cosH * 6 / 60, acLon + sinH * 6 / (60 * cosAcLat));
  ctx.strokeStyle = 'rgba(0,200,100,0.65)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(hx, hy);
  ctx.stroke();

  /* Aircraft symbol */
  ctx.fillStyle = '#e8ecf0';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  /* Data tags */
  ctx.font      = `${h * 0.028}px ${f}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,200,100,0.8)';
  ctx.fillText(`${Math.round(S.spd)}KT`, x + w * 0.04, y + h * 0.06);
  ctx.fillText(`FL${String(Math.round(S.alt / 100)).padStart(3, '0')}`, x + w * 0.04, y + h * 0.10);
  ctx.fillStyle = 'rgba(180,210,225,0.6)';
  ctx.fillText(`HDG ${String(Math.round(S.hdg)).padStart(3, '0')}`, x + w * 0.04, y + h * 0.14);

  /* Range ring label */
  ctx.font      = `${h * 0.022}px ${f}`;
  ctx.fillStyle = 'rgba(180,210,225,0.35)';
  ctx.textAlign = 'center';
  ctx.fillText(`${rangeNm}NM`, cx + r + w * 0.01, cy + h * 0.025);
}

/* ════════════════════════════════════════════════════════════
   FCU — Flight Control Unit (glareshield)
   Called with raw canvas W/H (not a box) — fills the canvas.
   ════════════════════════════════════════════════════════════ */
export function drawFCU(ctx, W, H, style) {
  const f = _MONO;

  ctx.fillStyle = '#181c24';
  ctx.fillRect(0, 0, W, H);

  // Bottom edge separator
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, H - 1, W, 1);

  // Section geometry
  const padX  = W * 0.028;
  const inner = W - padX * 2;

  const spdW  = inner * 0.130;
  const hdgW  = inner * 0.130;
  const gapAP = inner * 0.030;
  const apW   = inner * 0.320;
  const gapAL = inner * 0.030;
  const altW  = inner * 0.200;
  const vsW   = inner * 0.160;

  const spdX = padX;
  const hdgX = spdX + spdW;
  const apX  = hdgX + hdgW + gapAP;
  const altX = apX  + apW  + gapAL;
  const vsX  = altX + altW;

  // Vertical separators between major sections
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  for (const sx of [hdgX + hdgW + gapAP * 0.5, apX + apW + gapAL * 0.5]) {
    ctx.beginPath();
    ctx.moveTo(sx, H * 0.08);
    ctx.lineTo(sx, H * 0.92);
    ctx.stroke();
  }

  function _sec(label, value, x, sw) {
    const cx  = x + sw / 2;
    const bh  = H * 0.44;
    const bw  = sw * 0.82;
    const bx  = x + (sw - bw) / 2;
    const by  = H * 0.50;

    // Knob arc above the display window
    const kr  = Math.min(sw, H) * 0.130;
    const kcy = by - kr * 0.55;
    ctx.strokeStyle = 'rgba(200,215,228,0.28)';
    ctx.lineWidth   = Math.max(1, H * 0.018);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(cx, kcy, kr, Math.PI * 0.72, Math.PI * 0.28, false);
    ctx.stroke();
    // Pointer tick at top
    const tickLen = kr * 0.28;
    ctx.strokeStyle = 'rgba(200,215,228,0.55)';
    ctx.lineWidth   = Math.max(1, H * 0.016);
    ctx.beginPath();
    ctx.moveTo(cx, kcy - kr + tickLen * 0.2);
    ctx.lineTo(cx, kcy - kr + tickLen);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Label (below knob, above window)
    ctx.font      = `${H * 0.130}px ${f}`;
    ctx.fillStyle = 'rgba(175,188,205,0.32)';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, by - H * 0.03);

    // Display window
    ctx.fillStyle = '#090d14';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(200,212,228,0.11)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.font      = `bold ${H * 0.340}px ${f}`;
    ctx.fillStyle = '#d4cba4';
    ctx.textAlign = 'center';
    ctx.fillText(value, cx, by + bh * 0.78);
  }

  // ── Speed ──
  _sec('SPD  MACH', Math.round(S.spdT).toString(), spdX, spdW);

  // ── Heading ──
  const hdgDisp = String(Math.round(S.hdgT) % 360 || 360).padStart(3, '0');
  _sec('HDG  TRK', hdgDisp, hdgX, hdgW);

  // ── Altitude ──
  _sec('ALT', String(Math.round(S.altT)).padStart(5, '0'), altX, altW);

  // ── Vertical speed ──
  const vsRaw  = Math.round(S.vs / 100) * 100;
  const vsDisp = vsRaw === 0 ? '+0000' : (vsRaw > 0 ? '+' : '') + vsRaw;
  _sec('V/S  FPA', vsDisp, vsX, vsW);

  // ── AP / A-THR button cluster ──
  const btns = [
    { label: 'AP 1',  lit: S.ap,   litCol: '#3ec55a' },
    { label: 'APPR',  lit: false,  litCol: '#4dc5dc' },
    { label: 'AP 2',  lit: false,  litCol: '#3ec55a' },
    { label: 'A/THR', lit: S.athr, litCol: '#3ec55a' },
  ];

  const btnW   = apW / btns.length;
  const btnH   = H * 0.60;
  const btnY   = (H - btnH) / 2;
  const btnPad = btnW * 0.09;

  for (let i = 0; i < btns.length; i++) {
    const { label, lit, litCol } = btns[i];
    const bx  = apX + i * btnW + btnPad;
    const bwi = btnW - btnPad * 2;
    const bcx = bx + bwi / 2;

    ctx.fillStyle   = lit ? `${litCol}1a` : 'rgba(255,255,255,0.025)';
    ctx.fillRect(bx, btnY, bwi, btnH);
    ctx.strokeStyle = lit ? litCol : 'rgba(255,255,255,0.16)';
    ctx.lineWidth   = lit ? 1.5 : 0.8;
    ctx.strokeRect(bx, btnY, bwi, btnH);

    const dotR = H * 0.038;
    const dotY = btnY + btnH * 0.26;
    ctx.fillStyle = lit ? litCol : 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.arc(bcx, dotY, dotR, 0, Math.PI * 2);
    ctx.fill();

    ctx.font      = `bold ${H * 0.178}px ${f}`;
    ctx.fillStyle = lit ? litCol : 'rgba(195,210,225,0.40)';
    ctx.textAlign = 'center';
    ctx.fillText(label, bcx, btnY + btnH * 0.75);
  }
}

/* ════════════════════════════════════════════════════════════
   ECAM EWD — Engine / Warning Display
   ════════════════════════════════════════════════════════════ */
/* Per-engine signature so the displays never read identical (the biggest "fake" tell):
   a persistent seeded offset + a slow two-sine wander. Cosmetic — the commanded N1 stays
   single; each gauge just reads slightly off it. */
function _ewdOffset(eng, amp) {
  const hh = Math.sin(eng * 12.9898) * 43758.5453;
  return ((hh - Math.floor(hh)) - 0.5) * 2 * amp;        // ∈ [-amp, +amp]
}
function _ewdScatter(eng, t, amp) {
  const ph = eng * 1.7;
  const wander = (Math.sin(t * 0.00023 + ph) * 0.55 + Math.sin(t * 0.00009 + ph * 2.3) * 0.45) * amp * 0.7;
  return _ewdOffset(eng, amp) + wander;
}

/* Airbus EWD round engine gauge: a 270° scale arc with graduation ticks, amber/red
   radial limit ticks, a red band past the redline, a green needle, and the digital value
   in a box inside the dial. opts: { max, amber, red, ticks:[…], dec }. Line widths scale
   with r so it reads at any gauge size. */
function _ewdGauge(ctx, cx, cy, r, val, opts, grn, amb, red, f) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, sweep = a1 - a0;
  const ang = v => a0 + Math.max(0, Math.min(1, v / opts.max)) * sweep;
  const P = (a, rr) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];

  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(232,237,242,0.26)'; ctx.lineWidth = Math.max(1, r * 0.05);   // scale arc
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();

  if (opts.red != null) {                                                              // red band past redline
    ctx.strokeStyle = red; ctx.lineWidth = Math.max(1.2, r * 0.06);
    ctx.beginPath(); ctx.arc(cx, cy, r, ang(opts.red), a1); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(232,237,242,0.5)'; ctx.lineWidth = Math.max(1, r * 0.035);   // graduation ticks
  for (const g of (opts.ticks ?? [0, opts.max / 2, opts.max])) {
    const a = ang(g), p0 = P(a, r - r * 0.18), p1 = P(a, r);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  }

  for (const [thr, col] of [[opts.amber, amb], [opts.red, red]]) {                     // amber/red limit ticks
    if (thr == null) continue;
    const a = ang(thr), p0 = P(a, r - r * 0.22), p1 = P(a, r + r * 0.16);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.4, r * 0.06);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  }

  const over = opts.red != null && val >= opts.red, col = over ? red : grn;            // green needle + hub
  const na = ang(val), tip = P(na, r - r * 0.08);
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.4, r * 0.055); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.4, r * 0.07), 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'butt';

  const bw = r * 1.18, bh = r * 0.46, bx = cx - bw / 2, by = cy + r * 0.22;            // boxed digital value
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, r * 0.03); ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = col; ctx.textBaseline = 'middle';
  const v = Math.max(0, val);
  if ((opts.dec ?? 0) > 0) {
    const iv = Math.floor(v), dv = Math.round((v - iv) * 10);
    ctx.textAlign = 'right'; ctx.font = `bold ${(bh * 0.82).toFixed(1)}px ${f}`;
    ctx.fillText(String(iv), cx + bw * 0.06, by + bh / 2);
    ctx.textAlign = 'left';  ctx.font = `bold ${(bh * 0.55).toFixed(1)}px ${f}`;
    ctx.fillText('.' + dv, cx + bw * 0.08, by + bh * 0.58);
  } else {
    ctx.textAlign = 'center'; ctx.font = `bold ${(bh * 0.72).toFixed(1)}px ${f}`;
    ctx.fillText(String(Math.round(v)), cx, by + bh / 2);
  }
}

/* Engine/Warning Display page. The warning + memo zones are shared; the engine zone is
   family-specific — Airbus EWD (drawECAM) vs Boeing EICAS (drawEICAS). */
function _ewdPage(ctx, box, style, engineZone) {
  const { x, y, w, h } = box;
  const f   = _MONO;
  const col = {
    grn: _c(style, 'engaged'), amb: _c(style, 'managed'), red: '#ff3b3b',
    wht: _c(style, 'white'),   dim: 'rgba(200,215,225,0.35)', cyn: '#4dc5dc',
  };

  ctx.fillStyle = '#030609';
  ctx.fillRect(x, y, w, h);

  const page = S.ecamPage ?? 'status';
  if (page === 'elec') { _ecamElec(ctx, x, y, w, h, f, col.grn, col.amb, col.dim, col.cyn); return; }
  if (page === 'hyd')  { _ecamHyd (ctx, x, y, w, h, f, col.grn, col.amb, col.dim, col.cyn); return; }

  /* ── STATUS / ENGINE page ─────────────────────────────────── */
  const warnH = h * 0.28, engH = h * 0.48;
  const warnY = y, engY = warnY + warnH, memoY = engY + engH;

  _ecamWarnZone(ctx, x, w, h, warnY, warnH, engY, f, col);
  engineZone   (ctx, x, w, h, engY, engH, col, f);
  _ecamMemoZone(ctx, x, w, h, memoY, f, col);
}

export function drawECAM (ctx, box, style) { _ewdPage(ctx, box, style, _engineZoneAirbus); }
export function drawEICAS(ctx, box, style) { _ewdPage(ctx, box, style, _engineZoneBoeing); }

/* Shared warning zone + the divider above the engines. */
function _ecamWarnZone(ctx, x, w, h, warnY, warnH, engY, f, col) {
  ctx.textBaseline = 'alphabetic';
  const hasWarn = Object.values(S.warnings ?? {}).some(Boolean);
  if (hasWarn) {
    let wy = warnY + h * 0.06;
    for (const [key, active] of Object.entries(S.warnings ?? {})) {
      if (!active) continue;
      ctx.font      = `bold ${h * 0.055}px ${f}`;
      ctx.fillStyle = key.startsWith('LOW') || key.startsWith('FUEL') ? col.amb : col.red;
      ctx.textAlign = 'left';
      ctx.fillText(key.replace(/_/g, ' '), x + w * 0.04, wy);
      wy += h * 0.065;
    }
  } else {
    ctx.font = `${h * 0.042}px ${f}`; ctx.fillStyle = col.dim; ctx.textAlign = 'center';
    ctx.fillText('NORMAL', x + w * 0.5, warnY + warnH * 0.52);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, engY); ctx.lineTo(x + w, engY); ctx.stroke();
}

/* Shared memo zone — gear / flaps / belts / lights. */
function _ecamMemoZone(ctx, x, w, h, memoY, f, col) {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(x, memoY); ctx.lineTo(x + w, memoY); ctx.stroke();

  const flapsLabel = ['CLEAN', 'CONF 1', 'CONF 2', 'CONF 3'][Math.min(S.flaps ?? 0, 3)];
  const gearLabel  = S.gear ? 'DN' : 'UP';
  const memos = [
    { lbl: 'GEAR',       val: gearLabel,  col: S.gear ? col.grn : col.wht },
    { lbl: 'FLAPS',      val: flapsLabel, col: S.flaps > 0 ? col.amb : col.grn },
    { lbl: 'SEAT BELTS', val: 'ON',       col: col.wht },
    { lbl: 'LDG LTS',    val: 'ON',       col: col.wht },
  ];
  const memoFs = h * 0.038, mCols = 2, memoW = w / mCols;
  ctx.textBaseline = 'alphabetic';
  memos.forEach((m, i) => {
    const mx = x + (i % mCols) * memoW + memoW * 0.04;
    const my = memoY + h * 0.060 + Math.floor(i / mCols) * h * 0.068;
    ctx.font = `${memoFs}px ${f}`; ctx.fillStyle = col.dim; ctx.textAlign = 'left';
    ctx.fillText(m.lbl, mx, my);
    ctx.font = `bold ${memoFs}px ${f}`; ctx.fillStyle = m.col;
    ctx.fillText(m.val, mx + memoW * 0.42, my);
  });
}

/* Per-engine running values (shared scatter), given the single commanded N1. */
function _ewdEngineVals(eng, cmd, tNow) {
  const live  = cmd > 1;
  const n1raw = live ? Math.max(0, cmd + _ewdScatter(eng, tNow, 0.35)) : cmd;
  const n2raw = live ? Math.max(0, 48 + 0.55 * n1raw + _ewdScatter(eng, tNow, 0.5)) : 0;  // CFM56: ~60% N2 idle
  const egtR  = 350 + Math.pow(Math.max(0, n1raw) / 100, 1.5) * 500 + _ewdOffset(eng, 6);
  const ffR   = 200 + Math.pow(Math.max(0, n1raw) / 100, 2) * 3000;
  /* Per-quantity display lag — each parameter has its own inertia: FF responds first,
     then N2, N1 trails it, EGT (thermal mass) lags most. */
  return {
    live,
    n1:  smooth(`ewd.n1.${eng}`,  n1raw, 0.9),
    n2:  smooth(`ewd.n2.${eng}`,  n2raw, 0.6),
    egt: smooth(`ewd.egt.${eng}`, egtR,  1.3),
    ff:  Math.round(smooth(`ewd.ff.${eng}`, ffR, 0.3)),
  };
}

/* Airbus EWD engine zone — N1 hero gauge + EGT below, digital N2/FF, value boxed low. */
function _engineZoneAirbus(ctx, x, w, h, engY, engH, col, f) {
  const { grn, amb, red, dim } = col;
  const n    = S.aircraft?.engine?.count ?? 2;
  const engW = w / n;
  const cmd  = +(S.n1 ?? S.enginePower * 80);
  const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const r1   = Math.min(0.42 * engW, 0.17 * engH);
  const r2   = r1 * 0.64;

  for (let i = 0; i < n; i++) {
    const ex = x + engW * i, cx = ex + engW / 2, eng = i + 1;
    const { n1, n2, egt, ff } = _ewdEngineVals(eng, cmd, tNow);

    ctx.font = `${h * 0.034}px ${f}`; ctx.fillStyle = dim; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`ENG ${eng}`, cx, engY + engH * 0.06);

    _ewdGauge(ctx, cx, engY + engH * 0.30, r1, n1,
              { max: 110,  red: 104,             ticks: [0, 55, 110],   dec: 1 }, grn, amb, red, f);
    _ewdGauge(ctx, cx, engY + engH * 0.66, r2, egt,
              { max: 1000, amber: 850, red: 950, ticks: [0, 500, 1000], dec: 0 }, grn, amb, red, f);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = grn;
    ctx.font = `bold ${h * 0.038}px ${f}`;
    ctx.fillText('N2 ' + n2.toFixed(1), cx, engY + engH * 0.86);
    ctx.fillText('FF ' + ff,            cx, engY + engH * 0.95);

    if (i < n - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(ex + engW, engY + h * 0.02);
      ctx.lineTo(ex + engW, engY + engH - h * 0.02);
      ctx.stroke();
    }
  }
}

/* Boeing EICAS engine zone — round gauges with the digital value in the CENTRE of the
   dial, a white pointer, and a green commanded-N1 bug on the rim (the Boeing tell). */
function _engineZoneBoeing(ctx, x, w, h, engY, engH, col, f) {
  const { wht, grn, amb, red, dim } = col;
  const n    = S.aircraft?.engine?.count ?? 2;
  const engW = w / n;
  const cmd  = +(S.n1 ?? S.enginePower * 80);
  const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const r1   = Math.min(0.44 * engW, 0.19 * engH);
  const r2   = r1 * 0.62;

  for (let i = 0; i < n; i++) {
    const ex = x + engW * i, cx = ex + engW / 2, eng = i + 1;
    const { live, n1, n2, egt, ff } = _ewdEngineVals(eng, cmd, tNow);

    _eicasGauge(ctx, cx, engY + engH * 0.30, r1, n1, live ? cmd : null,
                { max: 110,  amber: 100, red: 104, ticks: [0, 20, 40, 60, 80, 100], dec: 1, lbl: 'N1' },  wht, grn, amb, red, f);
    _eicasGauge(ctx, cx, engY + engH * 0.70, r2, egt, null,
                { max: 1000, amber: 850, red: 950, ticks: [0, 500, 1000],           dec: 0, lbl: 'EGT' }, wht, grn, amb, red, f);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = wht;
    ctx.font = `bold ${h * 0.036}px ${f}`;
    ctx.fillText('N2 ' + n2.toFixed(1), cx, engY + engH * 0.90);
    ctx.fillText('FF ' + ff,            cx, engY + engH * 0.985);

    if (i < n - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(ex + engW, engY + h * 0.02);
      ctx.lineTo(ex + engW, engY + engH - h * 0.02);
      ctx.stroke();
    }
  }
}

/* Boeing round engine gauge: white scale arc + ticks, amber/red bands near the top, a
   green commanded-value bug on the rim (if cmd given), a white pointer, and the digital
   value boxed in the CENTRE of the dial. opts: { max, amber, red, ticks, dec, lbl }. */
function _eicasGauge(ctx, cx, cy, r, val, cmd, opts, wht, grn, amb, red, f) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, sweep = a1 - a0;
  const ang = v => a0 + Math.max(0, Math.min(1, v / opts.max)) * sweep;
  const P = (a, rr) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];

  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(232,237,242,0.5)'; ctx.lineWidth = Math.max(1.2, r * 0.055);   // scale arc
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();

  if (opts.amber != null) {                                                              // amber caution band
    ctx.strokeStyle = amb; ctx.lineWidth = Math.max(1.2, r * 0.055);
    ctx.beginPath(); ctx.arc(cx, cy, r, ang(opts.amber), ang(opts.red ?? opts.max)); ctx.stroke();
  }
  if (opts.red != null) {                                                                // red band past redline
    ctx.strokeStyle = red; ctx.lineWidth = Math.max(1.2, r * 0.055);
    ctx.beginPath(); ctx.arc(cx, cy, r, ang(opts.red), a1); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(232,237,242,0.6)'; ctx.lineWidth = Math.max(1, r * 0.03);      // ticks
  for (const g of (opts.ticks ?? [0, opts.max / 2, opts.max])) {
    const a = ang(g), p0 = P(a, r - r * 0.15), p1 = P(a, r);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
  }

  if (cmd != null) {                                                                     // commanded-N1 bug
    const a = ang(cmd), tip = P(a, r), o1 = P(a + 0.05, r + r * 0.17), o2 = P(a - 0.05, r + r * 0.17);
    ctx.fillStyle = grn;
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(o1[0], o1[1]); ctx.lineTo(o2[0], o2[1]); ctx.closePath(); ctx.fill();
  }

  const over = opts.red != null && val >= opts.red;                                      // white pointer
  const na = ang(val), pt0 = P(na, r * 0.30), pt1 = P(na, r - r * 0.06);
  ctx.strokeStyle = over ? red : wht; ctx.lineWidth = Math.max(1.4, r * 0.05); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pt0[0], pt0[1]); ctx.lineTo(pt1[0], pt1[1]); ctx.stroke();
  ctx.lineCap = 'butt';

  const bw = r * 1.3, bh = r * 0.52, bx = cx - bw / 2, by = cy - bh * 0.2;               // centred digital box
  ctx.strokeStyle = 'rgba(232,237,242,0.7)'; ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.fillStyle = '#030609'; ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = over ? red : wht; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${(bh * 0.74).toFixed(1)}px ${f}`;
  ctx.fillText((opts.dec ?? 0) > 0 ? Math.max(0, val).toFixed(1) : String(Math.round(Math.max(0, val))), cx, by + bh / 2);

  if (opts.lbl) {                                                                        // label above the dial
    ctx.fillStyle = 'rgba(200,215,225,0.5)'; ctx.font = `${(r * 0.32).toFixed(1)}px ${f}`;
    ctx.fillText(opts.lbl, cx, cy - r - r * 0.20);
  }
}

/* ── ECAM ELEC synoptic ─────────────────────────────────────── */
function _ecamElec(ctx, x, y, w, h, f, grn, amb, dim, cyn) {
  ctx.font = `bold ${h * 0.055}px ${f}`; ctx.fillStyle = cyn; ctx.textAlign = 'center';
  ctx.fillText('ELEC', x + w / 2, y + h * 0.06);

  const acPwr  = S.acBusPowered  ?? false;
  const dcPwr  = S.dcBusPowered  ?? false;
  const essPwr = S.essentialBusPowered ?? false;

  /* AC bus bar */
  const busY  = y + h * 0.22;
  const barX0 = x + w * 0.08;
  const barX1 = x + w * 0.92;
  ctx.strokeStyle = acPwr ? grn : dim; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(barX0, busY); ctx.lineTo(barX1, busY); ctx.stroke();
  ctx.font = `${h * 0.038}px ${f}`; ctx.fillStyle = acPwr ? grn : amb; ctx.textAlign = 'center';
  ctx.fillText('AC BUS', x + w / 2, busY - h * 0.04);

  /* Generators above bar */
  const n        = S.aircraft?.engine?.count ?? 2;
  const engGenOn = S.engGenOn ?? [];
  const apuGen   = S.apuGenOn  ?? false;
  const extPwr   = S.extPwrOn  ?? false;
  const genLabels = ['GEN 1', 'APU', n === 4 ? 'GEN 4' : 'GEN 2', 'EXT'];
  const genOn     = [engGenOn[0] ?? false, apuGen, engGenOn[n - 1] ?? false, extPwr];
  const genXs     = [0.15, 0.38, 0.62, 0.85].map(r => x + w * r);
  const genY      = y + h * 0.14;

  genLabels.forEach((lbl, i) => {
    const gx = genXs[i]; const on = genOn[i];
    ctx.strokeStyle = on ? grn : dim; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(gx, genY); ctx.lineTo(gx, busY); ctx.stroke();
    ctx.strokeRect(gx - w * 0.055, genY - h * 0.04, w * 0.11, h * 0.04);
    ctx.font = `${h * 0.030}px ${f}`; ctx.fillStyle = on ? grn : dim; ctx.textAlign = 'center';
    ctx.fillText(lbl, gx, genY - h * 0.015);
  });

  /* TR → DC bus */
  const trY  = busY + h * 0.12;
  const dcY  = trY  + h * 0.12;
  ctx.strokeStyle = dcPwr ? grn : dim; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + w / 2, busY); ctx.lineTo(x + w / 2, dcY); ctx.stroke();
  ctx.font = `${h * 0.030}px ${f}`; ctx.fillStyle = dcPwr ? grn : dim; ctx.textAlign = 'center';
  ctx.fillText('TR', x + w / 2, trY);

  ctx.strokeStyle = dcPwr ? grn : dim; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(barX0, dcY); ctx.lineTo(barX1, dcY); ctx.stroke();
  ctx.font = `${h * 0.038}px ${f}`; ctx.fillStyle = dcPwr ? grn : amb; ctx.textAlign = 'center';
  ctx.fillText('DC BUS', x + w / 2, dcY - h * 0.04);

  /* Batteries */
  const bats = [
    { key: 'bat1', lbl: 'BAT 1', bx: x + w * 0.25 },
    { key: 'bat2', lbl: 'BAT 2', bx: x + w * 0.75 },
  ];
  bats.forEach(({ key, lbl, bx }) => {
    const on  = S[`${key}On`] ?? false;
    const pct = Math.round(S[`${key}Charge`] ?? 100);
    const v   = (20 + pct / 100 * 8.5).toFixed(1);
    const col = on ? (pct > 20 ? grn : pct > 10 ? amb : '#ff4444') : dim;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, dcY); ctx.lineTo(bx, dcY + h * 0.08); ctx.stroke();
    ctx.strokeRect(bx - w * 0.08, dcY + h * 0.08, w * 0.16, h * 0.09);
    ctx.font = `${h * 0.028}px ${f}`; ctx.fillStyle = col; ctx.textAlign = 'center';
    ctx.fillText(lbl,     bx, dcY + h * 0.115);
    ctx.fillText(v + 'V', bx, dcY + h * 0.148);
    ctx.fillText(pct + '%', bx, dcY + h * 0.176);
  });

  /* Essential bus */
  const essY = dcY + h * 0.10;
  ctx.strokeStyle = essPwr ? grn : amb; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + w / 2, dcY); ctx.lineTo(x + w / 2, essY); ctx.stroke();
  ctx.strokeRect(x + w / 2 - w * 0.08, essY, w * 0.16, h * 0.05);
  ctx.font = `${h * 0.028}px ${f}`; ctx.fillStyle = essPwr ? grn : amb; ctx.textAlign = 'center';
  ctx.fillText('ESS BUS', x + w / 2, essY + h * 0.032);
}

/* ── ECAM HYD synoptic ──────────────────────────────────────── */
function _ecamHyd(ctx, x, y, w, h, f, grn, amb, dim, cyn) {
  ctx.font = `bold ${h * 0.055}px ${f}`; ctx.fillStyle = cyn; ctx.textAlign = 'center';
  ctx.fillText('HYD', x + w / 2, y + h * 0.06);

  const systems = [
    { lbl: 'GREEN',  psi: S.hydGreenPsi  ?? 0, edp: S.hydGreenEdp  ?? false, elec: S.hydGreenElecOn  ?? false, col: '#5dd47e', bx: x + w * 0.20 },
    { lbl: 'BLUE',   psi: S.hydBluePsi   ?? 0, edp: false,                   elec: S.hydBlueElecOn   ?? false, col: '#4dc5dc', bx: x + w * 0.50 },
    { lbl: 'YELLOW', psi: S.hydYellowPsi ?? 0, edp: S.hydYellowEdp ?? false, elec: S.hydYellowElecOn ?? false, col: '#ffb74d', bx: x + w * 0.80 },
  ];

  const barBot  = y + h * 0.82;
  const barTop  = y + h * 0.18;
  const barH    = barBot - barTop;
  const nomY    = barTop + barH * (1 - 2500 / 3000);
  const barW    = w * 0.10;

  /* Nominal pressure dashed line */
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(x + w * 0.08, nomY); ctx.lineTo(x + w * 0.92, nomY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `${h * 0.028}px ${f}`; ctx.fillStyle = dim; ctx.textAlign = 'left';
  ctx.fillText('2500', x + w * 0.02, nomY + h * 0.014);

  systems.forEach(({ lbl, psi, edp, elec, col, bx }) => {
    const norm   = Math.min(1, psi / 3000);
    const fillH  = barH * norm;
    const isLo   = psi < 2500;

    /* Background bar */
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(bx - barW / 2, barTop, barW, barH);

    /* Filled bar */
    ctx.fillStyle = isLo ? amb : col;
    ctx.fillRect(bx - barW / 2, barBot - fillH, barW, fillH);

    /* PSI label */
    ctx.font = `bold ${h * 0.040}px ${f}`; ctx.fillStyle = isLo ? amb : col; ctx.textAlign = 'center';
    ctx.fillText(Math.round(psi), bx, barBot + h * 0.055);

    /* System label */
    ctx.font = `${h * 0.032}px ${f}`; ctx.fillStyle = col;
    ctx.fillText(lbl, bx, barBot + h * 0.090);

    /* Source labels */
    ctx.font = `${h * 0.026}px ${f}`;
    if (edp)  { ctx.fillStyle = grn; ctx.fillText('EDP', bx, barTop - h * 0.045); }
    if (elec) { ctx.fillStyle = grn; ctx.fillText('ELEC', bx, barTop - h * 0.015); }
    if (!edp && !elec) { ctx.fillStyle = amb; ctx.fillText('OFF', bx, barTop - h * 0.028); }
  });
}
