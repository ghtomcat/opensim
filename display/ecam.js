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
import { drawElecPage, drawHydPage, drawFuelPage } from './pfd_instruments.js';
import { hydView } from '../core/hydraulics.js';
import { fuelView, fuelCautions } from '../core/fuel-system.js';
import { engineAvailable, engineOilLow } from '../core/engine.js';

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
let _ecamBound = false;
export function initECAM(canvas) {
  if (_ecamBound) return;   // the canvas outlives missions — bind once
  _ecamBound = true;
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
    if      (col === 0) setState({ ecamPage: page === 'fuel' ? 'status' : 'fuel' });
    else if (col === 1) setState({ ecamPage: page === 'hyd'  ? 'status' : 'hyd'  });
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
  else if (page === 'fuel') _drawFuelPage(ctx, W, half, H, s);
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
  const e   = S.engines?.[eng - 1];
  const n1  = Math.round(e?.n1 ?? S.n1 ?? 0);
  const failed = !!e && e.state === 'running' && engineAvailable(e) < 1;
  const egt = Math.round(e?.egt ?? 350 + (n1 / 100) * 340);       // the engine's own values (core/engine.js)
  const ff  = Math.round(e?.ff  ?? 200 + (n1 / 100) * 7800);
  const oil = e?.oil != null ? Math.round(e.oil) : null;
  const oilLow = !!e && engineOilLow(e);

  _arcGauge(ctx, cx, H * 0.38, 48 * s, n1, 100, n1 > 95 ? C.red : C.green, s);
  _label(ctx, n1 + '%',      cx, H * 0.38 + 5 * s, n1 > 95 ? C.red : C.green, 14 * s);
  _label(ctx, 'EGT',         cx, H * 0.62, C.dim, 8 * s);
  _label(ctx, egt + '°',     cx, H * 0.72, egt > 640 ? C.amber : C.green, 12 * s);
  _label(ctx, ff + ' KG/H',  cx, H * 0.83, C.dim, 8 * s);
  if (oil != null) _label(ctx, 'OIL ' + oil + ' PSI', cx, H * 0.88, oilLow ? C.amber : C.dim, 8 * s);
  _label(ctx, failed ? 'ENG ' + eng + ' FAIL' : 'ENG ' + eng, cx, H * 0.93, failed ? C.amber : C.dim, 8 * s);
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
  const hydOk  = hydView().every(sys => !sys.lo || sys.pumps.every(p => p.state === 'off'));   // every system up — or deliberately unpowered (the A340's BLUE until switched on)
  const elecOk = S.acBusPowered ?? false;

  const systems = [
    { label: 'FUEL',  val: _fob(),                col: C.green },
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
   LOWER ECAM — ELEC: the shared ELEC page, drawn from the aircraft's electrical layout
   (drawElecPage in display/pfd_instruments.js — one drawer for every display)
   ════════════════════════════════════════════════════════════ */
function _drawElecPage(ctx, W, top, H, s) {
  drawElecPage(ctx, 0, top, W, H - top, FONT, { grn: C.green, amb: C.amber, dim: C.dim, cyn: C.cyan });
}

/* ════════════════════════════════════════════════════════════
   LOWER ECAM — HYD: the shared HYD page, drawn from the aircraft's hydraulic layout
   (drawHydPage in display/pfd_instruments.js — one drawer for every display)
   ════════════════════════════════════════════════════════════ */
function _drawHydPage(ctx, W, top, H, s) {
  drawHydPage(ctx, 0, top, W, H - top - 30 * s, FONT, { grn: C.green, amb: C.amber, dim: C.dim, cyn: C.cyan });
  _drawSystemsRow(ctx, W, H, s);
}

/* ════════════════════════════════════════════════════════════
   LOWER ECAM — FUEL: the shared FUEL page, drawn from the aircraft's fuel layout
   (drawFuelPage in display/pfd_instruments.js — one drawer for every display)
   ════════════════════════════════════════════════════════════ */
function _drawFuelPage(ctx, W, top, H, s) {
  drawFuelPage(ctx, 0, top, W, H - top - 30 * s, FONT, { grn: C.green, amb: C.amber, dim: C.dim, cyn: C.cyan });
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
  for (const sys of hydView()) if (sys.lost) w.push({ level: 'CAUTION', text: `HYD ${sys.label} LO` });   // from the layout
  for (const k of Object.keys(fuelCautions())) w.push({ level: 'CAUTION', text: k.replace(/_/g, ' ') });   // from the fuel layout
  if (!(S.essentialBusPowered ?? true))   w.push({ level: 'WARNING', text: 'ELEC — ESS BUS OFF' });
  /* Autobrake memo (green): armed level, or DECEL while it's actively braking */
  if (S.aircraft?.autobrake && (S.autobrake ?? 'OFF') !== 'OFF')
    w.push({ level: 'MEMO', text: S.autobrakeActive ? `AUTO BRK ${S.autobrake} — DECEL` : `AUTO BRK ${S.autobrake}` });
  return w;
}

/* The fuel on board for the systems row — the airliner fuel system's (core/fuel-system.js), in tonnes; '—' without one */
function _fob() {
  const v = fuelView();
  return v ? `${(v.fob / 1000).toFixed(1)} T` : '—';
}

function _label(ctx, text, x, y, color, size) {
  ctx.fillStyle    = color;
  ctx.font         = `${size}px ${FONT}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
