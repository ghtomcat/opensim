/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/velis_epsi.js
   Pipistrel Velis Electro instrument panel.

   Inspired by the EPSI 570 energy management display and the
   Kanardia digital AHRS in HB-SYC.

   Layout:
     Top:    Attitude indicator (full-width, large)
     Middle: IAS · HDG · ALT · VS digital readouts
     Bottom: Battery SOC bar (full-width) + kW draw
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

/* ── Palette ── */
const P = {
  bg:       '#0d1117',   // near black
  panel:    '#12181f',   // panel dark
  sky:      '#1a3a5c',   // horizon sky
  ground:   '#3d2a14',   // horizon ground
  horizon:  '#d4a843',   // horizon line
  white:    '#e8edf2',
  dim:      'rgba(232,237,242,0.4)',
  cyan:     '#00c8e0',   // Pipistrel electric blue
  green:    '#5dd47e',
  amber:    '#ffb74d',
  red:      '#ff4444',
  grid:     'rgba(255,255,255,0.07)',
};

const MONO = '"IBM Plex Mono","Courier New",monospace';
const SANS = '"Syne","Helvetica Neue",Arial,sans-serif';

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderVelisEpsi(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  /* Panel background */
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  const sc = Math.min(W, H) / 700;

  /* Layout zones */
  const battH  = 72 * sc;    // battery bar height at bottom
  const dataH  = 90 * sc;    // digital readout strip above battery
  const ahH    = H - battH - dataH;  // attitude indicator zone

  _drawAttitude(ctx, W, ahH, sc);
  _drawDataStrip(ctx, W, ahH, dataH, sc);
  _drawBatteryBar(ctx, W, H, battH, sc);

  ctx.restore();
}

/* ── Attitude indicator ── */
function _drawAttitude(ctx, W, ahH, sc) {
  const cx   = W / 2;
  const cy   = ahH / 2;
  const roll = (S.roll  ?? 0) * Math.PI / 180;
  const pitch = S.pitch ?? 0;
  const pxPerDeg = ahH / 40;   // 40° pitch = full height

  ctx.save();

  /* Clip to AH zone */
  ctx.beginPath();
  ctx.rect(0, 0, W, ahH);
  ctx.clip();

  /* Rotate around centre for roll */
  ctx.translate(cx, cy);
  ctx.rotate(-roll);

  /* Sky / ground split */
  const pitchOff = pitch * pxPerDeg;
  const splitY   = pitchOff;   // positive pitch → split below centre

  ctx.fillStyle = P.sky;
  ctx.fillRect(-W, -ahH, W * 2, ahH + splitY);

  ctx.fillStyle = P.ground;
  ctx.fillRect(-W, splitY, W * 2, ahH * 2);

  /* Horizon line */
  ctx.strokeStyle = P.horizon;
  ctx.lineWidth   = 2.5 * sc;
  ctx.beginPath();
  ctx.moveTo(-W, splitY);
  ctx.lineTo(W,  splitY);
  ctx.stroke();

  /* Pitch ladder — every 5° */
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.fillStyle   = P.white;
  ctx.font        = `${11 * sc}px ${MONO}`;
  ctx.textAlign   = 'center';
  for (let deg = -30; deg <= 30; deg += 5) {
    if (deg === 0) continue;
    const y   = splitY - deg * pxPerDeg;
    const len = (deg % 10 === 0) ? 50 * sc : 28 * sc;
    ctx.lineWidth = (deg % 10 === 0) ? 1.8 * sc : 1.2 * sc;
    ctx.beginPath();
    ctx.moveTo(-len, y);
    ctx.lineTo(len,  y);
    ctx.stroke();
    if (deg % 10 === 0) {
      ctx.fillText(Math.abs(deg), len + 14 * sc, y + 4 * sc);
      ctx.fillText(Math.abs(deg), -len - 14 * sc, y + 4 * sc);
    }
  }

  ctx.restore();

  /* ── Fixed overlays (not rotated) ── */

  /* Aircraft symbol */
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = P.white;
  ctx.lineWidth   = 3 * sc;
  ctx.beginPath();
  // Left wing
  ctx.moveTo(-60 * sc, 0);
  ctx.lineTo(-18 * sc, 0);
  // Centre dot
  ctx.moveTo(-18 * sc, 0);
  ctx.lineTo(18 * sc,  0);
  // Right wing
  ctx.moveTo(18 * sc, 0);
  ctx.lineTo(60 * sc, 0);
  // Vertical
  ctx.moveTo(0, -10 * sc);
  ctx.lineTo(0,  10 * sc);
  ctx.stroke();
  ctx.restore();

  /* Roll arc */
  _drawRollArc(ctx, cx, cy, sc);

  /* Vignette over AH */
  const vg = ctx.createRadialGradient(cx, cy, ahH * 0.2, cx, cy, ahH * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, ahH);
}

function _drawRollArc(ctx, cx, cy, sc) {
  const r    = cy * 0.75;
  const roll = (S.roll ?? 0) * Math.PI / 180;

  ctx.save();
  ctx.translate(cx, cy);

  /* Arc marks at 0, ±10, ±20, ±30, ±45, ±60 */
  const marks = [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60];
  marks.forEach(deg => {
    const a   = (deg - 90) * Math.PI / 180;
    const len = (deg === 0 || Math.abs(deg) === 30 || Math.abs(deg) === 60) ? 12 * sc : 7 * sc;
    ctx.strokeStyle = P.dim;
    ctx.lineWidth   = 1.5 * sc;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(a) * (r - len), Math.sin(a) * (r - len));
    ctx.stroke();
  });

  /* Roll pointer (rotates with aircraft) */
  ctx.rotate(-roll);
  ctx.strokeStyle = P.white;
  ctx.lineWidth   = 2.5 * sc;
  ctx.beginPath();
  ctx.moveTo(0, -r + 14 * sc);
  ctx.lineTo(-7 * sc, -r + 1 * sc);
  ctx.lineTo(7 * sc,  -r + 1 * sc);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/* ── Digital readout strip ── */
function _drawDataStrip(ctx, W, y0, stripH, sc) {
  /* Dark separator bar */
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, y0, W, stripH);

  ctx.save();
  ctx.translate(0, y0);

  const col = W / 4;
  const mid = stripH / 2;

  const items = [
    { label: 'IAS',  value: Math.round(S.spd ?? 0) + ' kt',              x: col * 0.5 },
    { label: 'HDG',  value: String(Math.round(S.hdg ?? 0)).padStart(3,'0') + '°', x: col * 1.5 },
    { label: 'ALT',  value: Math.round(S.alt ?? 0).toLocaleString() + ' ft', x: col * 2.5 },
    { label: 'V/S',  value: (S.vs >= 0 ? '+' : '') + Math.round((S.vs ?? 0) / 10) * 10 + ' fpm', x: col * 3.5 },
  ];

  items.forEach(({ label, value, x }) => {
    /* Label */
    ctx.fillStyle   = P.dim;
    ctx.font        = `${10 * sc}px ${SANS}`;
    ctx.textAlign   = 'center';
    ctx.fillText(label, x, mid - 14 * sc);

    /* Value */
    ctx.fillStyle   = P.white;
    ctx.font        = `bold ${22 * sc}px ${MONO}`;
    ctx.fillText(value, x, mid + 10 * sc);
  });

  /* Dividers */
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  [col, col * 2, col * 3].forEach(x => {
    ctx.beginPath();
    ctx.moveTo(x, 8 * sc);
    ctx.lineTo(x, stripH - 8 * sc);
    ctx.stroke();
  });

  ctx.restore();
}

/* ── Battery SOC bar ── */
function _drawBatteryBar(ctx, W, H, battH, sc) {
  const y0    = H - battH;
  const soc   = S.batteryCharge ?? 0;
  const kw    = ((S.aircraft?.battery?.powerDrawKw ?? 25) * (S.enginePower ?? 0));
  const barW  = W * 0.62;
  const barH  = 22 * sc;
  const barX  = (W - barW) / 2;
  const barY  = y0 + (battH - barH) / 2;

  /* Background */
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, y0, W, battH);

  /* SOC colour */
  const socColor = soc > 27 ? P.green : soc > 20 ? P.amber : soc > 10 ? '#ff8800' : P.red;

  /* Bar track */
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  _roundRect(ctx, barX, barY, barW, barH, 4 * sc);
  ctx.fill();

  /* Bar fill */
  const fillW = barW * Math.max(0, soc / 100);
  ctx.fillStyle = socColor;
  _roundRect(ctx, barX, barY, fillW, barH, 4 * sc);
  ctx.fill();

  /* SOC % label */
  ctx.fillStyle = P.white;
  ctx.font      = `bold ${20 * sc}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(soc) + '%', barX - 12 * sc, barY + barH * 0.72);

  /* kW label */
  ctx.font      = `bold ${20 * sc}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = soc <= 0 ? P.red : P.cyan;
  ctx.fillText(Math.round(kw) + ' kW', barX + barW + 12 * sc, barY + barH * 0.72);

  /* BATT label */
  ctx.fillStyle = P.dim;
  ctx.font      = `${9 * sc}px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText('BATT', barX - 12 * sc, barY + barH * 0.72 - 14 * sc);
  ctx.textAlign = 'left';
  ctx.fillText('POWER', barX + barW + 12 * sc, barY + barH * 0.72 - 14 * sc);

  /* 27% marker — go-around threshold */
  const m27x = barX + barW * 0.27;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth   = 1.5 * sc;
  ctx.setLineDash([3 * sc, 3 * sc]);
  ctx.beginPath();
  ctx.moveTo(m27x, barY - 4 * sc);
  ctx.lineTo(m27x, barY + barH + 4 * sc);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle   = 'rgba(255,255,255,0.3)';
  ctx.font        = `${8 * sc}px ${SANS}`;
  ctx.textAlign   = 'center';
  ctx.fillText('27%', m27x, barY - 7 * sc);
}

/* ── Helpers ── */
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
