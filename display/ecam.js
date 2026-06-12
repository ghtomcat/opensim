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
import { elecCfg }    from '../core/electrical.js';

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
    handleECAMClick(
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top)  / rect.height,
      true,   // has upper half (standalone ecamCanvas)
    );
  });
}

/* Exported so ndCanvas can also route clicks here when showing airbus-ecam */
export function handleECAMClick(x, y, hasUpperHalf = false) {
  if (hasUpperHalf && y < 0.5) return;   // upper ECAM area — ignore
  const page = S.ecamPage ?? 'status';
  /* Bottom strip: 5 equal columns FUEL=0, HYD=1, ELEC=2, PRESS=3, PACK=4 */
  if (y > 0.88) {
    const col = Math.floor(x * 5);
    if      (col === 1) setState({ ecamPage: page === 'hyd'  ? 'status' : 'hyd'  });
    else if (col === 2) setState({ ecamPage: page === 'elec' ? 'status' : 'elec' });
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
             w.level === 'WARNING' ? C.red : w.level === 'MEMO' ? C.green : C.amber, 11 * s);
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
   LOWER ECAM — ELEC synoptic  (full A340 bus architecture)

   Layout (top → bottom in lower half):
     Row 1  Generators  GEN1  GEN2  APU  EXT  GEN3  GEN4
     Row 2  AC buses    1-1   1-2  ESS  2-3   2-4
     Row 3  TRs / bats  TR1  BAT1 BAT3 BAT2  TR2
     Row 4  DC buses    DC1       ESS       DC2
   ════════════════════════════════════════════════════════════ */
function _drawElecPage(ctx, W, top, H, s) {
  const n    = S.aircraft?.engine?.count ?? 2;
  const cfg  = elecCfg();
  const rowH = H - top;
  const pad  = 14 * s;

  _label(ctx, 'ELEC', W / 2, top + 11 * s, C.cyan, 9 * s);

  /* State */
  const engGenOn = S.engGenOn  ?? [];
  const genV     = S.genVoltage ?? [];
  const genF     = S.genFreq    ?? [];
  const genL     = S.genLoad    ?? [];
  const apuGenOn = S.apuGenOn ?? false;
  const wow      = S.wow ?? false;
  const extA     = (S.extPwrOn  ?? false) && wow;
  const extB     = cfg.extPwrB && (S.extPwrBOn ?? false) && wow;
  const tieAuto  = S.busTieAuto ?? true;
  const bus11    = S.acBus11   ?? false;
  const bus12    = S.acBus12   ?? false;
  const bus23    = S.acBus23   ?? false;
  const bus24    = S.acBus24   ?? false;
  const acEss    = S.acEssBus  ?? false;
  const dc1      = S.dcBus1    ?? false;
  const dc2      = S.dcBus2    ?? false;
  const dcEss    = S.dcEssBus  ?? false;
  const essBus   = S.essentialBusPowered ?? false;

  /* X columns — distribute evenly across 5 slots */
  /* For 4-engine: GEN1 GEN2 | APU+EXT | GEN3 GEN4 */
  const xs = n >= 4
    ? { g1: W*0.09, g2: W*0.25, apu: W*0.50, g3: W*0.75, g4: W*0.91 }
    : { g1: W*0.20, g2: W*0.45, apu: W*0.55, g3: null,   g4: null   };
  const xBus11 = xs.g1, xBus12 = xs.g2, xApu = xs.apu;
  const xBus23 = xs.g3 ?? xs.apu, xBus24 = xs.g4 ?? xs.apu;
  const xEss   = W * 0.50;
  const xDC1   = xBus11, xDC2 = n >= 4 ? xBus24 : xBus12;
  const xBat1  = W * 0.33, xBat2 = W * 0.67, xBat3 = xEss;

  /* Y rows */
  const genY  = top + rowH * 0.13;
  const acY   = top + rowH * 0.30;
  const trY   = top + rowH * 0.51;
  const batY  = top + rowH * 0.67;
  const dcY   = top + rowH * 0.83;

  /* ── Helper: draw a generator box with values ── */
  const _gen = (x, label, on, v, f, load) => {
    const col = on ? C.green : C.dim;
    _box(ctx, x, genY, 50*s, 30*s, col, s);
    _label(ctx, label, x, genY - 8*s,  col, 6*s);
    _label(ctx, on ? v.toFixed(0)+'V' : '---', x, genY - 1*s, col, 8*s);
    _label(ctx, on ? f.toFixed(0)+'Hz': '',    x, genY + 8*s, col, 6*s);
    _label(ctx, on ? load+'%' : '',            x, genY +15*s, col, 6*s);
  };

  /* ── Helper: draw AC bus bar ── */
  const _acBus = (x, label, powered) => {
    const col = powered ? C.green : C.dim;
    ctx.strokeStyle = col; ctx.lineWidth = 3*s;
    ctx.beginPath(); ctx.moveTo(x - 18*s, acY); ctx.lineTo(x + 18*s, acY); ctx.stroke();
    _label(ctx, label, x, acY + 9*s, col, 6*s);
  };

  /* ── Helper: vertical line with optional midpoint label ── */
  const _vline = (x, y1, y2, powered, midLabel = '') => {
    const col = powered ? C.green : C.dim;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5*s;
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
    if (midLabel) _label(ctx, midLabel, x + 7*s, (y1 + y2)/2, col, 6*s);
  };

  /* ── Helper: horizontal line (bus tie) ── */
  const _hline = (x1, x2, y, powered) => {
    const col = powered ? C.green : C.dim;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5*s;
    ctx.setLineDash(tieAuto ? [] : [4*s, 3*s]);
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.setLineDash([]);
  };

  /* ── Generators ── */
  _gen(xs.g1, 'GEN 1', engGenOn[0]??false, genV[0]??0, genF[0]??0, genL[0]??0);
  _gen(xs.g2, 'GEN 2', engGenOn[1]??false, genV[1]??0, genF[1]??0, genL[1]??0);
  if (n >= 3) _gen(xs.g3, 'GEN 3', engGenOn[2]??false, genV[2]??0, genF[2]??0, genL[2]??0);
  if (n >= 4) _gen(xs.g4, 'GEN 4', engGenOn[3]??false, genV[3]??0, genF[3]??0, genL[3]??0);

  /* APU GEN source box */
  const apuCol = apuGenOn ? C.green : C.dim;
  _box(ctx, xApu, genY - 4*s, 42*s, 20*s, apuCol, s);
  _label(ctx, 'APU', xApu, genY - 8*s,  apuCol, 6*s);
  _label(ctx, apuGenOn ? '115V' : '---', xApu, genY + 2*s, apuCol, 8*s);

  /* EXT A (always) / EXT B (only if aircraft has dual external power) */
  const extAcol = extA ? C.green : C.dim;
  _box(ctx, xApu - 28*s, genY, 22*s, 14*s, extAcol, s);
  _label(ctx, 'EXT A', xApu - 28*s, genY, extAcol, 5.5*s);
  if (cfg.extPwrB) {
    const extBcol = extB ? C.green : C.dim;
    _box(ctx, xApu + 28*s, genY, 22*s, 14*s, extBcol, s);
    _label(ctx, 'EXT B', xApu + 28*s, genY, extBcol, 5.5*s);
  }

  /* ── Gen → AC bus vertical lines ── */
  _vline(xBus11, genY + 15*s, acY, bus11);
  _vline(xBus12, genY + 15*s, acY, bus12);
  _vline(xApu,   genY + 8*s,  acY, acEss, '');
  if (n >= 3) _vline(xBus23, genY + 15*s, acY, bus23);
  if (n >= 4) _vline(xBus24, genY + 15*s, acY, bus24);

  /* ── AC buses ── */
  _acBus(xBus11, '1-1', bus11);
  _acBus(xBus12, '1-2', bus12);
  if (n >= 3) _acBus(xBus23, '2-3', bus23);
  if (n >= 4) _acBus(xBus24, '2-4', bus24);

  /* AC ESS BUS (center, slightly below) */
  const acEssY = acY + 10*s;
  const essCol = acEss ? C.green : C.amber;
  _box(ctx, xEss, acEssY + 4*s, 46*s, 14*s, essCol, s);
  _label(ctx, 'AC ESS', xEss, acEssY + 4*s, essCol, 6*s);

  /* Bus tie horizontal — between 1-2 and 2-3 */
  if (n >= 4) {
    const tieCol = (bus12 || bus23) ? C.green : C.dim;
    _hline(xBus12 + 18*s, xBus23 - 18*s, acY, tieCol);
    const tieMidX = (xBus12 + xBus23) / 2;
    _label(ctx, tieAuto ? 'TIE' : 'TIE MAN', tieMidX, acY - 7*s,
           tieAuto ? (tieCol === C.green ? C.green : C.dim) : C.amber, 5.5*s);
  }

  /* AC ESS feed lines from bus11 and bus24 */
  _vline(xEss, acY, acEssY - 3*s, acEss);

  /* ── TRs ── */
  const tr1col = dc1  ? C.green : C.dim;
  const tr2col = dc2  ? C.green : C.dim;
  _vline(xDC1, acY,      trY - 8*s, dc1);
  _box(ctx, xDC1, trY, 28*s, 14*s, tr1col, s);
  _label(ctx, 'TR 1', xDC1, trY, tr1col, 6*s);

  _vline(xDC2, acY,      trY - 8*s, dc2);
  _box(ctx, xDC2, trY, 28*s, 14*s, tr2col, s);
  _label(ctx, 'TR 2', xDC2, trY, tr2col, 6*s);

  /* ── Batteries ── */
  const _bat = (x, key, label) => {
    const on  = S[`${key}On`]     ?? false;
    const pct = Math.round(S[`${key}Charge`] ?? 100);
    const v   = (20 + pct / 100 * 8.5).toFixed(1);
    const col = on ? (pct > 20 ? C.green : pct > 10 ? C.amber : C.red) : C.dim;
    _vline(x, trY + 8*s, batY - 10*s, on && dcEss);
    _box(ctx, x, batY, 46*s, 28*s, col, s);
    _label(ctx, label,    x, batY - 8*s,  col, 5.5*s);
    _label(ctx, v + 'V', x, batY + 1*s,  col, 8*s);
    _label(ctx, pct+'%', x, batY + 11*s, col, 6*s);
  };
  _bat(xBat1, 'bat1', 'BAT 1');
  _bat(xBat2, 'bat2', 'BAT 2');
  if (cfg.batCount >= 3) _bat(xBat3, 'bat3', 'APU BAT');

  /* ── DC buses ── */
  _vline(xDC1, trY + 8*s, dcY, dc1);
  _vline(xDC2, trY + 8*s, dcY, dc2);

  const dc1col = dc1  ? C.green : C.dim;
  const dc2col = dc2  ? C.green : C.dim;
  _box(ctx, xDC1, dcY + 7*s, 38*s, 14*s, dc1col, s);
  _label(ctx, 'DC BUS 1', xDC1, dcY + 7*s, dc1col, 6*s);
  _box(ctx, xDC2, dcY + 7*s, 38*s, 14*s, dc2col, s);
  _label(ctx, 'DC BUS 2', xDC2, dcY + 7*s, dc2col, 6*s);

  /* DC ESS BUS at center */
  const dcEssCol = dcEss ? C.green : C.amber;
  _box(ctx, xEss, dcY + 7*s, 50*s, 14*s, dcEssCol, s);
  _label(ctx, 'DC ESS', xEss, dcY + 7*s, dcEssCol, 6*s);

  /* Horizontal DC bus tie from DC1/DC2 to ESS */
  ctx.strokeStyle = dcEss ? C.green : C.dim; ctx.lineWidth = 1.5*s;
  ctx.beginPath();
  ctx.moveTo(xDC1 + 19*s, dcY + 7*s);
  ctx.lineTo(xEss - 25*s, dcY + 7*s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xDC2 - 19*s, dcY + 7*s);
  ctx.lineTo(xEss + 25*s, dcY + 7*s);
  ctx.stroke();

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
  /* Autobrake memo (green): armed level, or DECEL while it's actively braking */
  if (S.aircraft?.autobrake && (S.autobrake ?? 'OFF') !== 'OFF')
    w.push({ level: 'MEMO', text: S.autobrakeActive ? `AUTO BRK ${S.autobrake} — DECEL` : `AUTO BRK ${S.autobrake}` });
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
