/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/ecam.js
   Engine / Warning Display (upper) + Systems Display (lower).

   Lower ECAM pages (S.ecamPage):
     'status'  — warnings + system status row  (default)
     'elec'    — electrical synoptic
     'hyd'     — hydraulic synoptic

   Click the system labels (ELEC, HYD) in status view to switch pages.
   Click the active page header to return to status.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';

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

/* ── Init — attach click handler for page switching ── */
export function initECAM(canvas) {
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top)  / rect.height;
    if (y < 0.5) return;   // upper ECAM — ignore
    _handleLowerClick(x, y);
  });
}

function _handleLowerClick(x, y) {
  const page = S.ecamPage ?? 'status';
  /* Bottom strip (y > 0.88) — system labels */
  if (y > 0.88) {
    if      (x > 0.55 && x < 0.72) setState({ ecamPage: page === 'hyd'  ? 'status' : 'hyd'  });
    else if (x > 0.72 && x < 0.88) setState({ ecamPage: page === 'elec' ? 'status' : 'elec' });
    return;
  }
  /* Page header click → back to status */
  if (y > 0.50 && y < 0.60 && page !== 'status') setState({ ecamPage: 'status' });
}

/* ── Main render ── */
export function renderECAM(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const s    = Math.min(W, H) / 500;
  const half = H / 2;

  _drawUpperECAM(ctx, W, half, s);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, half); ctx.lineTo(W, half); ctx.stroke();

  const page = S.ecamPage ?? 'status';
  if      (page === 'elec') _drawElecPage(ctx, W, half, H, s);
  else if (page === 'hyd')  _drawHydPage(ctx, W, half, H, s);
  else                      _drawStatusPage(ctx, W, half, H, s);

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   UPPER ECAM — Engine parameters
   ════════════════════════════════════════════════════════════ */
function _drawUpperECAM(ctx, W, H, s) {
  const cx = W / 2;
  const n  = S.aircraft?.engine?.count ?? 2;

  _label(ctx, 'ENGINE', cx, 18 * s, C.dim, 9 * s);

  const cols = Array.from({ length: n }, (_, i) => (W / n) * (i + 0.5));
  cols.forEach((x, i) => _drawEngine(ctx, x, H, s, i + 1));
}

function _drawEngine(ctx, cx, H, s, eng) {
  const n1  = Math.round(S.n1 ?? 0);
  const egt = Math.round(350 + (n1 / 100) * 340);
  const ff  = Math.round(200 + (n1 / 100) * 7800);

  _arcGauge(ctx, cx, H * 0.38, 48 * s, n1, 100, n1 > 95 ? C.red : C.green, s);
  _label(ctx, n1 + '%',      cx, H * 0.38 + 5 * s, n1 > 95 ? C.red : C.green, 14 * s);
  _label(ctx, 'EGT',         cx, H * 0.62, C.dim, 8 * s);
  _label(ctx, egt + '°',     cx, H * 0.72, egt > 640 ? C.amber : C.green, 12 * s);
  _label(ctx, ff + ' KG/H',  cx, H * 0.83, C.dim, 8 * s);
  _label(ctx, 'ENG ' + eng,  cx, H * 0.93, C.dim, 8 * s);
}

function _arcGauge(ctx, cx, cy, r, val, max, color, s) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth   = 5 * s;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (val / max) * (a1 - a0)); ctx.stroke();
  const ra = a0 + 0.95 * (a1 - a0);
  ctx.strokeStyle = C.red; ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ra)*(r-8*s), cy + Math.sin(ra)*(r-8*s));
  ctx.lineTo(cx + Math.cos(ra)*(r+4*s), cy + Math.sin(ra)*(r+4*s));
  ctx.stroke();
}

/* ════════════════════════════════════════════════════════════
   LOWER ECAM — STATUS page
   ════════════════════════════════════════════════════════════ */
function _drawStatusPage(ctx, W, top, H, s) {
  const cy  = top + (H - top) / 2;
  const pad = 20 * s;

  const warnings = _getWarnings();
  if (warnings.length === 0) {
    _label(ctx, 'NORMAL', W / 2, cy, C.green, 14 * s);
  } else {
    warnings.forEach((w, i) => {
      _label(ctx, w.text, W / 2, top + pad + i * 22 * s,
             w.level === 'WARNING' ? C.red : C.amber, 11 * s);
    });
  }

  _drawSystemsRow(ctx, W, H, s);

  const law = 'NORMAL LAW';
  ctx.fillStyle  = C.green;
  ctx.font       = `bold ${9*s}px ${FONT}`;
  ctx.textAlign  = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(law, pad, top + 14 * s);
}

function _drawSystemsRow(ctx, W, H, s) {
  const hydOk  = (S.hydGreenPsi ?? 0) > 2500 && (S.hydYellowPsi ?? 0) > 2500;
  const elecOk = S.acBusPowered ?? false;

  const systems = [
    { label: 'FUEL',  val: _fuelPct() + '%',      col: C.green },
    { label: 'HYD',   val: hydOk  ? 'NORM' : 'LO', col: hydOk  ? C.green : C.amber },
    { label: 'ELEC',  val: elecOk ? 'NORM' : 'OFF', col: elecOk ? C.green : C.amber },
    { label: 'PRESS', val: 'NORM',                  col: C.green },
    { label: 'PACK',  val: S.alt > 10000 ? 'ON' : 'OFF', col: C.green },
  ];

  const colW = W / systems.length;
  systems.forEach((sys, i) => {
    const x = colW * i + colW / 2;
    _label(ctx, sys.label, x, H - 24 * s, C.dim,   8  * s);
    _label(ctx, sys.val,   x, H - 12 * s, sys.col, 10 * s);
  });
}

/* ════════════════════════════════════════════════════════════
   LOWER ECAM — ELEC synoptic
   ════════════════════════════════════════════════════════════ */
function _drawElecPage(ctx, W, top, H, s) {
  const mid  = top + (H - top) * 0.5;
  const pad  = 18 * s;

  _label(ctx, 'ELEC', W / 2, top + 14 * s, C.cyan, 10 * s);

  /* ── AC section ── */
  const acY   = top + 50 * s;
  const acPow = S.acBusPowered ?? false;
  const apuGen = S.apuGenOn ?? false;
  const engGen = (S.engGenOn ?? []).some(Boolean);
  const extPwr = (S.extPwrOn ?? false) && (S.wow ?? false);

  /* Source labels */
  const srcX = [W*0.18, W*0.38, W*0.62, W*0.82];
  const srcN = S.aircraft?.engine?.count ?? 4;
  const engGenOn = S.engGenOn ?? [];

  /* AC BUS bar */
  const busY = acY + 30 * s;
  ctx.strokeStyle = acPow ? C.green : C.dim;
  ctx.lineWidth   = 3 * s;
  ctx.beginPath(); ctx.moveTo(pad, busY); ctx.lineTo(W - pad, busY); ctx.stroke();
  _label(ctx, 'AC BUS', W/2, busY - 10*s, acPow ? C.green : C.amber, 8*s);

  /* Generators */
  const genLabels = srcN === 4
    ? ['GEN 1', 'APU GEN', 'GEN 3/4', 'EXT PWR']
    : ['GEN 1', 'APU GEN', 'GEN 2',   'EXT PWR'];
  const genOn = [
    engGenOn[0] ?? false,
    apuGen,
    srcN === 4 ? ((engGenOn[2] || engGenOn[3]) ?? false) : (engGenOn[1] ?? false),
    extPwr,
  ];

  genLabels.forEach((lbl, i) => {
    const x = srcX[i];
    const on = genOn[i];
    ctx.strokeStyle = on ? C.green : C.dim;
    ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, acY - 10*s); ctx.lineTo(x, busY); ctx.stroke();
    _box(ctx, x, acY - 22*s, 44*s, 18*s, on ? C.green : C.dim, s);
    _label(ctx, lbl, x, acY - 22*s, on ? C.green : C.dim, 7*s);
  });

  /* ── DC section ── */
  const dcY    = busY + 50 * s;
  const essBus = S.essentialBusPowered ?? false;
  const dcBus  = S.dcBusPowered ?? false;

  ctx.strokeStyle = dcBus ? C.green : C.dim;
  ctx.lineWidth   = 3 * s;
  ctx.beginPath(); ctx.moveTo(pad, dcY); ctx.lineTo(W - pad, dcY); ctx.stroke();
  _label(ctx, 'DC BUS', W/2, dcY - 10*s, dcBus ? C.green : C.amber, 8*s);

  /* Vertical line from AC to DC bus */
  ctx.strokeStyle = dcBus ? C.green : C.dim;
  ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(W/2, busY); ctx.lineTo(W/2, dcY); ctx.stroke();
  _label(ctx, 'TR', W/2, busY + 18*s, dcBus ? C.green : C.dim, 7*s);

  /* Batteries */
  const bats = [
    { key: 'bat1', x: W * 0.28, label: 'BAT 1' },
    { key: 'bat2', x: W * 0.72, label: 'BAT 2' },
  ];
  bats.forEach(({ key, x, label }) => {
    const on  = S[`${key}On`] ?? false;
    const pct = Math.round(S[`${key}Charge`] ?? 100);
    const v   = (20 + pct / 100 * 8.5).toFixed(1);
    const col = on ? (pct > 20 ? C.green : pct > 10 ? C.amber : C.red) : C.dim;

    ctx.strokeStyle = col; ctx.lineWidth = 2*s;
    ctx.beginPath(); ctx.moveTo(x, dcY); ctx.lineTo(x, dcY + 22*s); ctx.stroke();
    _box(ctx, x, dcY + 30*s, 52*s, 28*s, col, s);
    _label(ctx, label, x, dcY + 26*s, col, 7*s);
    _label(ctx, v + 'V',     x, dcY + 36*s, col, 8*s);
    _label(ctx, pct + '%',   x, dcY + 46*s, col, 7*s);
  });

  /* Essential bus */
  const essX = W / 2;
  const essY = dcY + 28 * s;
  ctx.strokeStyle = essBus ? C.green : C.amber;
  ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(essX, dcY); ctx.lineTo(essX, essY); ctx.stroke();
  _box(ctx, essX, essY + 8*s, 52*s, 16*s, essBus ? C.green : C.amber, s);
  _label(ctx, 'ESS BUS', essX, essY + 8*s, essBus ? C.green : C.amber, 7*s);

  _drawSystemsRow(ctx, W, H, s);
}

/* ════════════════════════════════════════════════════════════
   LOWER ECAM — HYD synoptic
   ════════════════════════════════════════════════════════════ */
function _drawHydPage(ctx, W, top, H, s) {
  const rowH = H - top;
  const pad  = 18 * s;

  _label(ctx, 'HYD', W / 2, top + 14 * s, C.cyan, 10 * s);

  const systems = [
    {
      name: 'GREEN', x: W * 0.20,
      psi:  S.hydGreenPsi  ?? 0,
      edp:  S.hydGreenEdp  ?? false,
      elec: S.hydGreenElecOn ?? false,
      col:  '#5dd47e',
    },
    {
      name: 'BLUE',  x: W * 0.50,
      psi:  S.hydBluePsi   ?? 0,
      edp:  false,
      elec: S.hydBlueElecOn  ?? false,
      col:  '#4dc5dc',
    },
    {
      name: 'YELLOW', x: W * 0.80,
      psi:  S.hydYellowPsi ?? 0,
      edp:  S.hydYellowEdp ?? false,
      elec: S.hydYellowElecOn ?? false,
      col:  '#ffb74d',
    },
  ];

  const barTop = top + 35 * s;
  const barBot = top + rowH * 0.72;
  const barH   = barBot - barTop;
  const barW   = 28 * s;

  systems.forEach(({ name, x, psi, edp, elec, col }) => {
    const pct  = Math.min(1, psi / 3000);
    const ok   = psi > 2500;
    const lo   = psi > 500 && psi <= 2500;
    const color = ok ? col : lo ? C.amber : C.red;

    /* System name */
    _label(ctx, name, x, top + 24 * s, color, 9 * s);

    /* Pressure bar background */
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x - barW/2, barTop, barW, barH);

    /* Pressure bar fill */
    const fillH = barH * pct;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - barW/2, barTop + barH - fillH, barW, fillH);
    ctx.globalAlpha = 1.0;

    /* PSI readout */
    _label(ctx, Math.round(psi) + ' PSI', x, barBot + 14 * s,
           psi < 100 ? C.dim : color, 10 * s);

    /* Source labels */
    const srcY = barBot + 30 * s;
    if (edp) {
      _label(ctx, 'EDP', x, srcY,          color, 7 * s);
    }
    const elecCol = elec ? color : C.dim;
    _label(ctx, 'ELEC ' + (elec ? 'ON' : 'OFF'), x, srcY + 14 * s, elecCol, 7 * s);
  });

  /* Nominal line */
  const nomY = barTop + barH * (1 - 2500/3000);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(systems[0].x - barW/2 - 8*s, nomY);
  ctx.lineTo(systems[2].x + barW/2 + 8*s, nomY);
  ctx.stroke();
  ctx.setLineDash([]);
  _label(ctx, '2500', systems[0].x - barW/2 - 16*s, nomY, C.dim, 6*s);

  _drawSystemsRow(ctx, W, H, s);
}

/* ── Shared helpers ── */
function _box(ctx, cx, cy, w, h, color, s) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5 * s;
  ctx.strokeRect(cx - w/2, cy - h/2, w, h);
}

function _getWarnings() {
  const w = [];
  if (S.gear && S.spd > 200)              w.push({ level: 'WARNING', text: 'GEAR — OVERSPEED' });
  if (S.flaps > 0 && S.spd > 250)         w.push({ level: 'CAUTION', text: 'FLAPS — SPD LIMIT' });
  if (S.alt < 200 && !S.gear && S.spd < 180) w.push({ level: 'WARNING', text: 'GEAR NOT DOWN' });
  if (S.vs < -3000 && S.alt < 5000)       w.push({ level: 'WARNING', text: 'SINK RATE' });
  if ((S.hydGreenPsi ?? 0) < 500)         w.push({ level: 'CAUTION', text: 'HYD GREEN LO' });
  if ((S.hydBluePsi  ?? 0) < 500)         w.push({ level: 'CAUTION', text: 'HYD BLUE LO' });
  if ((S.hydYellowPsi?? 0) < 500)         w.push({ level: 'CAUTION', text: 'HYD YELLOW LO' });
  if (!(S.essentialBusPowered ?? true))   w.push({ level: 'WARNING', text: 'ELEC — ESS BUS OFF' });
  return w;
}

function _fuelPct() {
  const burned = (S.time / 43200) * 40;
  return Math.max(10, Math.round(100 - burned));
}

function _label(ctx, text, x, y, color, size) {
  ctx.fillStyle    = color;
  ctx.font         = `${size}px ${FONT}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
