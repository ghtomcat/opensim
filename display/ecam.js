/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/ecam.js
   Engine / Warning Display (upper ECAM) + Systems Display (lower).
   Call renderECAM(canvas) each frame; reads from S.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const C = {
  bg:      '#030609',
  green:   '#5dd47e',
  cyan:    '#4dc5dc',
  amber:   '#ffb74d',
  red:     '#ff4444',
  white:   '#e8edf2',
  dim:     'rgba(232,237,242,0.35)',
  magenta: '#d96ec8',
};

const FONT = '"IBM Plex Mono", "Courier New", monospace';

export function renderECAM(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const s = Math.min(W, H) / 500;
  const half = H / 2;

  /* ── Upper ECAM — Engine Display ── */
  _drawUpperECAM(ctx, W, half, s);

  /* ── Divider ── */
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, half);
  ctx.lineTo(W, half);
  ctx.stroke();

  /* ── Lower ECAM — Systems / Warnings ── */
  _drawLowerECAM(ctx, W, half, H, s);

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   UPPER ECAM — Engine parameters
   ════════════════════════════════════════════════════════════ */
function _drawUpperECAM(ctx, W, H, s) {
  const cx = W / 2;

  _label(ctx, 'ENGINE',  cx, 18 * s, C.dim, 9 * s);

  /* Two engine columns */
  _drawEngine(ctx, cx * 0.5, H, s, 1);
  _drawEngine(ctx, cx * 1.5, H, s, 2);

  /* N1 / N2 labels */
  _label(ctx, 'N1 %',   cx * 0.5, 32 * s, C.dim, 8 * s);
  _label(ctx, 'N1 %',   cx * 1.5, 32 * s, C.dim, 8 * s);
}

function _drawEngine(ctx, cx, H, s, eng) {
  /* Derive N1 from speed — simplified: N1 ≈ 20% idle + throttle factor */
  const throttleFactor = S.spd / (S.aircraft?.envelope.maxSpd ?? 350);
  const n1 = Math.round(20 + throttleFactor * 75);
  const egt = Math.round(400 + throttleFactor * 280);
  const ff  = Math.round(1800 + throttleFactor * 6200);

  /* N1 arc gauge */
  _arcGauge(ctx, cx, H * 0.38, 55 * s, n1, 100, C.green, s);
  _label(ctx, n1 + '%', cx, H * 0.38 + 6 * s, C.green, 16 * s);

  /* EGT */
  _label(ctx, 'EGT', cx, H * 0.62, C.dim, 8 * s);
  const egtColor = egt > 620 ? C.amber : C.green;
  _label(ctx, egt + '°', cx, H * 0.72, egtColor, 13 * s);

  /* FF */
  _label(ctx, 'FF  ' + ff + ' KG/H', cx, H * 0.83, C.dim, 8 * s);

  /* ENG label */
  _label(ctx, 'ENG ' + eng, cx, H * 0.93, C.dim, 8 * s);
}

function _arcGauge(ctx, cx, cy, r, val, max, color, s) {
  const startAngle = Math.PI * 0.75;
  const endAngle   = Math.PI * 2.25;
  const valAngle   = startAngle + (val / max) * (endAngle - startAngle);

  /* Background arc */
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth   = 5 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.stroke();

  /* Value arc */
  ctx.strokeStyle = color;
  ctx.lineWidth   = 5 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, valAngle);
  ctx.stroke();

  /* Redline at 95% */
  const redAngle = startAngle + 0.95 * (endAngle - startAngle);
  ctx.strokeStyle = C.red;
  ctx.lineWidth   = 3 * s;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(redAngle) * (r - 8 * s), cy + Math.sin(redAngle) * (r - 8 * s));
  ctx.lineTo(cx + Math.cos(redAngle) * (r + 4 * s), cy + Math.sin(redAngle) * (r + 4 * s));
  ctx.stroke();
}

/* ════════════════════════════════════════════════════════════
   LOWER ECAM — Systems + Warnings
   ════════════════════════════════════════════════════════════ */
function _drawLowerECAM(ctx, W, top, H, s) {
  const cy = top + (H - top) / 2;
  const pad = 20 * s;

  /* ── Warnings ── */
  const warnings = _getWarnings();

  if (warnings.length === 0) {
    _label(ctx, 'NORMAL', W / 2, cy, C.green, 14 * s);
  } else {
    warnings.forEach((w, i) => {
      const color = w.level === 'WARNING' ? C.red : C.amber;
      _label(ctx, w.text, W / 2, top + pad + i * 22 * s, color, 11 * s);
    });
  }

  /* ── Systems status (bottom row) ── */
  const systems = [
    { label: 'FUEL',  val: _fuelPct() + '%',   col: C.green  },
    { label: 'HYD',   val: 'NORM',             col: C.green  },
    { label: 'ELEC',  val: 'NORM',             col: C.green  },
    { label: 'PRESS', val: 'NORM',             col: C.green  },
    { label: 'PACK',  val: S.alt > 10000 ? 'ON' : 'OFF', col: C.green },
  ];

  const colW = W / systems.length;
  systems.forEach((sys, i) => {
    const x = colW * i + colW / 2;
    _label(ctx, sys.label, x, H - 24 * s, C.dim,   8  * s);
    _label(ctx, sys.val,   x, H - 12 * s, sys.col, 10 * s);
  });

  /* ── Protection law ── */
  const law = _protectionLaw();
  ctx.fillStyle = law === 'NORMAL LAW' ? C.green : C.amber;
  ctx.font = `bold ${9 * s}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(law, pad, top + 14 * s);
}

/* ── Warning logic ── */
function _getWarnings() {
  const w = [];
  if (S.gear && S.spd > 200)
    w.push({ level: 'WARNING', text: 'GEAR — OVERSPEED' });
  if (S.flaps > 0 && S.spd > 250)
    w.push({ level: 'CAUTION', text: 'FLAPS — SPD LIMIT' });
  if (S.alt < 200 && S.gear === false && S.spd < 180)
    w.push({ level: 'WARNING', text: 'GEAR NOT DOWN' });
  if (S.vs < -3000 && S.alt < 5000)
    w.push({ level: 'WARNING', text: 'SINK RATE' });
  return w;
}

function _protectionLaw() {
  /* Degrade if failures present — placeholder */
  return 'NORMAL LAW';
}

function _fuelPct() {
  /* Approximate fuel burn over time — starts at 100%, burns slowly */
  const burned = (S.time / 43200) * 40;   // 40% over 12 hours
  return Math.max(10, Math.round(100 - burned));
}

/* ── Helpers ── */
function _label(ctx, text, x, y, color, size) {
  ctx.fillStyle   = color;
  ctx.font        = `${size}px ${FONT}`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
