/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/dragon.js
   Dragon crew seat displays — four roles, one canvas.

   Roles: CDR · PLT · MO · MS
   Click a role tab (bottom row) to switch seats.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

const ROLES   = ['CDR', 'PLT', 'MO', 'MS', 'TELEM'];
const G0      = 9.80665;
const R_EARTH = 6_371_000;
const GM      = 3.986004418e14;

let _role     = 'CDR';
let _tabRects = [];

export function setDragonRole(r) { if (ROLES.includes(r)) _role = r; }
export function isDragonTelemetry() { return _role === 'TELEM'; }

export function handleDragonClick(canvas, evt) {
  const DPR  = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const x    = (evt.clientX - rect.left) * DPR;
  const y    = (evt.clientY - rect.top)  * DPR;
  for (const t of _tabRects) {
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
      _role = t.role;
      return true;
    }
  }
  return false;
}

/* ── Helpers ── */

function _abortMode(altKm, stage, meco, seco, inOrbit) {
  if (inOrbit || seco)  return { label: '2-ECHO',    color: '#5dd47e' };
  if (stage >= 2 || meco) {
    if (altKm >= 560)   return { label: '2-ECHO',    color: '#5dd47e' };
    if (altKm >= 450)   return { label: '2-DELTA',   color: '#5dd47e' };
    if (altKm >= 300)   return { label: '2-CHARLIE', color: '#4dc5dc' };
    if (altKm >= 150)   return { label: '2-BRAVO',   color: '#4dc5dc' };
                        return { label: '2-ALPHA',   color: '#ffb74d' };
  }
  if (altKm >= 45)      return { label: '1-BRAVO',   color: '#4dc5dc' };
                        return { label: '1-ALPHA',   color: '#ffb74d' };
}

function _phase(altKm, tLO, stage, meco, seco, inOrbit, coast) {
  if (tLO < 0)              return 'TERMINAL COUNT';
  if (inOrbit)              return 'ORBIT';
  if (seco)                 return 'ORBIT INSERTION';
  if (coast || (meco && !seco)) return 'STAGE SEPARATION';
  if (stage >= 2)           return 'ASCENT · STAGE 2';
  if (altKm >= 10 && altKm <= 16) return 'MAX-Q';
  if (altKm >= 6  && altKm <  10) return 'THROTTLE BUCKET';
  return 'ASCENT · STAGE 1';
}

function _timer(tLO) {
  const abs  = Math.abs(tLO);
  const sign = tLO >= 0 ? 'T+' : 'T−';
  const mm   = Math.floor(abs / 60);
  const ss   = Math.floor(abs % 60);
  return `${sign} ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function _fmt(n, dec = 1) { return Number(n).toFixed(dec); }

/* ── Role tabs ── */
function _drawTabs(ctx, W, H) {
  _tabRects = [];
  const tabH  = H * 0.072;
  const tabY  = H - tabH;
  const tabW  = W / ROLES.length;

  ROLES.forEach((r, i) => {
    const x      = i * tabW;
    const active = r === _role;
    const isTelem = r === 'TELEM';
    ctx.fillStyle   = active ? '#1a2a3a' : '#080f16';
    ctx.fillRect(x, tabY, tabW - 2, tabH);
    ctx.fillStyle   = active ? (isTelem ? '#ffb74d' : '#e8edf2') : (isTelem ? '#2a1a00' : '#3a4a5a');
    ctx.font        = `bold ${Math.round(H * 0.030)}px "IBM Plex Mono", monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r, x + tabW / 2, tabY + tabH / 2);
    _tabRects.push({ role: r, x, y: tabY, w: tabW - 2, h: tabH });
  });

  // divider above tabs
  ctx.strokeStyle = '#1a2a3a';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, tabY);
  ctx.lineTo(W, tabY);
  ctx.stroke();
}

/* ── Metric cell ── */
function _metric(ctx, cx, y, label, value, unit, H, color = '#e8edf2') {
  const labelSz = Math.round(H * 0.028);
  const valSz   = Math.round(H * 0.068);
  const unitSz  = Math.round(H * 0.030);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#4a6070';
  ctx.font         = `${labelSz}px "IBM Plex Mono", monospace`;
  ctx.fillText(label, cx, y);

  ctx.fillStyle = color;
  ctx.font      = `bold ${valSz}px "IBM Plex Mono", monospace`;
  ctx.fillText(value, cx, y + H * 0.058);

  ctx.fillStyle = '#4a6070';
  ctx.font      = `${unitSz}px "IBM Plex Mono", monospace`;
  ctx.fillText(unit, cx, y + H * 0.105);
}

/* ── Horizontal bar ── */
function _bar(ctx, x, y, w, h, frac, colorFill, colorBg = '#0e1c28') {
  ctx.fillStyle = colorBg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colorFill;
  ctx.fillRect(x, y, w * Math.min(1, Math.max(0, frac)), h);
}

/* ══════════════════════════════════════════════════════════
   CDR — Abort mode + mission status
   ══════════════════════════════════════════════════════════ */
function _drawCDR(ctx, W, H, tLO, altKm, velKms, gLoad, stage, meco, seco, inOrbit, coast, ac) {
  const content = H * 0.92;
  const abort   = _abortMode(altKm, stage, meco, seco, inOrbit);

  /* Role label */
  ctx.fillStyle    = '#2a3a4a';
  ctx.font         = `bold ${Math.round(H * 0.030)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('CDR', W * 0.05, H * 0.055);

  /* Timer */
  const timerColor = inOrbit ? '#5dd47e' : (tLO >= 0 ? '#e8edf2' : '#ffb74d');
  ctx.fillStyle    = timerColor;
  ctx.font         = `bold ${Math.round(H * 0.13)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(_timer(tLO), W / 2, content * 0.16);

  /* Abort mode box */
  const boxW = W * 0.72, boxH = content * 0.22;
  const boxX = (W - boxW) / 2, boxY = content * 0.28;
  ctx.strokeStyle = abort.color;
  ctx.lineWidth   = 2;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = abort.color + '14'; // faint fill
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle    = '#4a6070';
  ctx.font         = `${Math.round(H * 0.030)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ABORT MODE', W / 2, boxY + boxH * 0.28);

  ctx.fillStyle    = abort.color;
  ctx.font         = `bold ${Math.round(H * 0.088)}px "IBM Plex Mono", monospace`;
  if (inOrbit || seco) ctx.shadowColor = abort.color, ctx.shadowBlur = 10;
  ctx.fillText(abort.label, W / 2, boxY + boxH * 0.70);
  ctx.shadowBlur   = 0;

  /* Metrics row */
  const mY = content * 0.60;
  _metric(ctx, W * 0.20, mY, 'ALT',    _fmt(altKm), 'km',    H);
  _metric(ctx, W * 0.50, mY, 'VEL',    _fmt(velKms), 'km/s', H);
  _metric(ctx, W * 0.80, mY, 'G-LOAD', _fmt(gLoad), 'G',    H,
          gLoad >= 3.5 ? '#ffb74d' : '#e8edf2');

  /* Stage label */
  const stageLabel = meco || stage >= 2 ? 'STAGE 2 · MVac' : 'STAGE 1 · 9× Merlin 1D+';
  const stageColor = (meco || stage >= 2) ? '#5dd47e' : '#4dc5dc';
  ctx.fillStyle    = stageColor;
  ctx.font         = `${Math.round(H * 0.032)}px "Syne", sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stageLabel, W / 2, content * 0.84);
}

/* ══════════════════════════════════════════════════════════
   PLT — Engine status + propellant
   ══════════════════════════════════════════════════════════ */
function _drawPLT(ctx, W, H, tLO, altKm, velKms, gLoad, stage, meco, seco, inOrbit, coast, ac) {
  const content = H * 0.92;
  const abort   = _abortMode(altKm, stage, meco, seco, inOrbit);
  const perf    = ac?.performance ?? {};
  const stages  = perf.stages ?? [];
  const s1      = stages[0] ?? {};
  const s2      = stages[1] ?? {};

  /* Role label */
  ctx.fillStyle    = '#2a3a4a';
  ctx.font         = `bold ${Math.round(H * 0.030)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLT', W * 0.05, H * 0.055);

  /* Timer (smaller) */
  ctx.fillStyle    = inOrbit ? '#5dd47e' : (tLO >= 0 ? '#e8edf2' : '#ffb74d');
  ctx.font         = `bold ${Math.round(H * 0.075)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(_timer(tLO), W / 2, content * 0.10);

  /* Engine grid */
  const activeStg  = meco ? 2 : stage;
  const engCount   = activeStg === 1 ? (s1.engineCount ?? 9) : (s2.engineCount ?? 1);
  const isS2       = activeStg >= 2 || meco;
  const dotColor   = isS2 ? '#5dd47e' : '#4dc5dc';
  const dotOff     = '#1a2530';

  const gridCols   = isS2 ? 1 : Math.ceil(Math.sqrt(engCount));
  const gridRows   = isS2 ? 1 : Math.ceil(engCount / gridCols);
  const dotR       = Math.min(W, content) * (isS2 ? 0.075 : 0.042);
  const gapX       = dotR * 2.8;
  const gapY       = dotR * 2.8;
  const gridW      = (gridCols - 1) * gapX;
  const gridH      = (gridRows - 1) * gapY;
  const gridStartX = W / 2 - gridW / 2;
  const gridStartY = content * 0.27 - gridH / 2;

  for (let i = 0; i < (isS2 ? 1 : s1.engineCount ?? 9); i++) {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const cx  = gridStartX + col * gapX;
    const cy  = gridStartY + row * gapY;
    const on  = !meco; // all engines on during burn, off after MECO for S1
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = on ? dotColor : dotOff;
    if (on) { ctx.shadowColor = dotColor; ctx.shadowBlur = dotR * 0.8; }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* Engine label */
  const engLabel = isS2 ? 'MERLIN VACUUM' : `${s1.engineCount ?? 9}× MERLIN 1D+`;
  ctx.fillStyle    = isS2 ? '#5dd47e' : '#4dc5dc';
  ctx.font         = `${Math.round(H * 0.032)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(engLabel, W / 2, content * 0.44);

  /* Propellant bar */
  const mass    = S.rocketMass ?? perf.massWet ?? 1;
  const payload = perf.payload ?? 0;
  const stgObj  = isS2 ? s2 : s1;
  const massAbove = isS2 ? payload : (s2.massWet ?? 0) + payload;
  const dryTotal  = (stgObj.massDry ?? 0) + massAbove;
  const wetTotal  = (stgObj.massWet ?? 0) + massAbove;
  const propFrac  = wetTotal > dryTotal
    ? Math.max(0, (mass - dryTotal) / (wetTotal - dryTotal))
    : 1;
  const propColor = propFrac > 0.3 ? '#4dc5dc' : '#ffb74d';

  const barX = W * 0.12, barW = W * 0.76, barH = H * 0.040, barY = content * 0.535;
  ctx.fillStyle    = '#4a6070';
  ctx.font         = `${Math.round(H * 0.028)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PROPELLANT', barX, barY - H * 0.022);
  _bar(ctx, barX, barY, barW, barH, propFrac, propColor);
  ctx.fillStyle    = propColor;
  ctx.font         = `bold ${Math.round(H * 0.032)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'right';
  ctx.fillText(`${Math.round(propFrac * 100)}%`, barX + barW, barY - H * 0.022);

  /* G-load bar */
  const gLimit  = perf.gLimit ?? 6;
  const gFrac   = gLoad / gLimit;
  const gColor  = gLoad >= gLimit * 0.9 ? '#ff6b4a' : gLoad >= gLimit * 0.7 ? '#ffb74d' : '#5dd47e';
  const gbY     = content * 0.680;
  ctx.fillStyle = '#4a6070';
  ctx.font      = `${Math.round(H * 0.028)}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('G-LOAD', barX, gbY - H * 0.022);
  _bar(ctx, barX, gbY, barW, H * 0.040, gFrac, gColor);
  ctx.fillStyle = gColor;
  ctx.font      = `bold ${Math.round(H * 0.032)}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(`${_fmt(gLoad)} G`, barX + barW, gbY - H * 0.022);

  /* Abort mode (small) */
  ctx.fillStyle    = '#2a3a4a';
  ctx.font         = `${Math.round(H * 0.026)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ABORT', W / 2, content * 0.82);
  ctx.fillStyle = abort.color;
  ctx.font      = `bold ${Math.round(H * 0.038)}px "IBM Plex Mono", monospace`;
  ctx.fillText(abort.label, W / 2, content * 0.87);
}

/* ── Mission timeline milestones ── */
const MILESTONES = [
  { label: 'LIFTOFF',           check: s => s.tLO >= 0 },
  { label: 'MACH 1',            check: s => s.velMs >= 340 },
  { label: 'THROTTLE BUCKET',   check: s => s.altKm >= 7 },
  { label: 'MAX-Q',             check: s => s.altKm >= 12 },
  { label: 'THROTTLE UP',       check: s => s.altKm >= 15 },
  { label: 'ABORT  1-BRAVO',    check: s => s.altKm >= 45 },
  { label: 'GO FOR STAGING',    check: s => s.altKm >= 65 },
  { label: 'MECO',              check: s => s.meco },
  { label: 'STAGE SEPARATION',  check: s => s.stage >= 2 || s.coast },
  { label: 'ABORT  2-BRAVO',    check: s => (s.stage >= 2 || s.meco) && s.altKm >= 150 },
  { label: 'ABORT  2-CHARLIE',  check: s => (s.stage >= 2 || s.meco) && s.altKm >= 300 },
  { label: 'ABORT  2-DELTA',    check: s => (s.stage >= 2 || s.meco) && s.altKm >= 450 },
  { label: 'GO FOR ORBIT INS.', check: s => (s.stage >= 2 || s.meco) && s.altKm >= 560 },
  { label: 'SECO',              check: s => s.seco },
  { label: 'ORBIT',             check: s => s.inOrbit },
];

/* ══════════════════════════════════════════════════════════
   MO — Timeline + crew status
   ══════════════════════════════════════════════════════════ */
function _drawMO(ctx, W, H, tLO, altKm, velKms, gLoad, stage, meco, seco, inOrbit, coast) {
  const content = H * 0.92;
  const abort   = _abortMode(altKm, stage, meco, seco, inOrbit);
  const velMs   = velKms * 1000;
  const snap    = { tLO, altKm, velMs, stage, meco, seco, inOrbit, coast };

  /* Find current milestone index — last one whose check passes */
  let cur = -1;
  for (let i = 0; i < MILESTONES.length; i++) {
    if (MILESTONES[i].check(snap)) cur = i;
  }

  /* Role label */
  ctx.fillStyle    = '#2a3a4a';
  ctx.font         = `bold ${Math.round(H * 0.030)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MO', W * 0.05, H * 0.055);

  /* Timer */
  ctx.fillStyle    = inOrbit ? '#5dd47e' : (tLO >= 0 ? '#e8edf2' : '#ffb74d');
  ctx.font         = `bold ${Math.round(H * 0.075)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(_timer(tLO), W / 2, content * 0.10);

  /* Timeline strip — show cur-2 … cur … cur+2 */
  const SHOW     = 5;
  const rowH     = content * 0.118;
  const stripTop = content * 0.19;
  const padX     = W * 0.08;
  const labelSz  = Math.round(H * 0.033);
  const dotR     = H * 0.016;
  const lineX    = padX + dotR;

  /* vertical connector line */
  ctx.strokeStyle = '#1a2a3a';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(lineX, stripTop);
  ctx.lineTo(lineX, stripTop + rowH * SHOW);
  ctx.stroke();

  for (let offset = -2; offset <= 2; offset++) {
    const idx   = cur + offset;
    const rowY  = stripTop + (offset + 2) * rowH + rowH / 2;
    const past  = offset < 0;
    const isCur = offset === 0;
    const future = offset > 0;

    if (idx < 0 || idx >= MILESTONES.length) continue;
    const m = MILESTONES[idx];

    /* dot */
    ctx.beginPath();
    ctx.arc(lineX, rowY, isCur ? dotR * 1.5 : dotR, 0, Math.PI * 2);
    ctx.fillStyle = isCur
      ? (inOrbit ? '#5dd47e' : '#e8edf2')
      : past ? '#1e3040' : '#162030';
    if (isCur) { ctx.shadowColor = inOrbit ? '#5dd47e' : '#4dc5dc'; ctx.shadowBlur = 8; }
    ctx.fill();
    ctx.shadowBlur = 0;

    /* label */
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = isCur
      ? `bold ${labelSz}px "IBM Plex Mono", monospace`
      : `${Math.round(labelSz * 0.85)}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = isCur
      ? (inOrbit ? '#5dd47e' : '#e8edf2')
      : past ? '#2a4050' : '#1e3040';
    ctx.fillText(m.label, lineX + dotR * 2.5, rowY);

    /* current indicator arrow */
    if (isCur) {
      ctx.fillStyle    = inOrbit ? '#5dd47e' : '#4dc5dc';
      ctx.font         = `bold ${Math.round(H * 0.028)}px "IBM Plex Mono", monospace`;
      ctx.textAlign    = 'right';
      ctx.fillText('◄', W - padX, rowY);
    }
  }

  /* Metrics row */
  const mY = content * 0.82;
  _metric(ctx, W * 0.20, mY, 'ALT',    _fmt(altKm), 'km',   H * 0.85);
  _metric(ctx, W * 0.50, mY, 'VEL',    _fmt(velKms), 'km/s', H * 0.85);
  _metric(ctx, W * 0.80, mY, 'ABORT',  abort.label, '',    H * 0.85, abort.color);
}

/* ══════════════════════════════════════════════════════════
   MS — Orbital insertion progress
   ══════════════════════════════════════════════════════════ */
function _drawMS(ctx, W, H, tLO, altKm, velKms, stage, meco, seco, inOrbit, ac) {
  const content = H * 0.92;
  const perf    = ac?.performance ?? {};
  const targetKm = (perf.stages?.[1] ? 590 : 200); // rough fallback
  const missionTarget = S.mission?.targetOrbitKm ?? targetKm;

  const alt_m   = altKm * 1000;
  const vOrbKms = Math.sqrt(GM / (R_EARTH + alt_m)) / 1000;
  const orbitFrac = Math.min(1, velKms / vOrbKms);

  /* Role label */
  ctx.fillStyle    = '#2a3a4a';
  ctx.font         = `bold ${Math.round(H * 0.030)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MS', W * 0.05, H * 0.055);

  /* Timer */
  ctx.fillStyle    = inOrbit ? '#5dd47e' : (tLO >= 0 ? '#e8edf2' : '#ffb74d');
  ctx.font         = `bold ${Math.round(H * 0.075)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(_timer(tLO), W / 2, content * 0.10);

  /* Target orbit label */
  ctx.fillStyle    = '#4a6070';
  ctx.font         = `${Math.round(H * 0.028)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`TARGET ORBIT: ${missionTarget} km`, W / 2, content * 0.225);

  /* Orbit progress bar */
  const barX = W * 0.08, barW = W * 0.84;
  const barH = H * 0.055, barY = content * 0.27;
  const barColor = inOrbit ? '#5dd47e' : orbitFrac > 0.8 ? '#4dc5dc' : '#4dc5dc';
  _bar(ctx, barX, barY, barW, barH, orbitFrac, barColor);

  /* Progress label */
  ctx.fillStyle    = inOrbit ? '#5dd47e' : '#e8edf2';
  ctx.font         = `bold ${Math.round(H * 0.040)}px "IBM Plex Mono", monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(inOrbit ? 'ORBIT ACHIEVED' : `${Math.round(orbitFrac * 100)}%  TO ORBIT`, W / 2, barY + barH + H * 0.038);

  /* Metrics */
  const mY = content * 0.52;
  _metric(ctx, W * 0.25, mY, 'CURRENT',  _fmt(altKm), 'km',    H);
  _metric(ctx, W * 0.75, mY, 'TARGET',   _fmt(missionTarget), 'km', H,
          inOrbit ? '#5dd47e' : '#4a6070');

  const mY2 = content * 0.69;
  _metric(ctx, W * 0.25, mY2, 'VELOCITY', _fmt(velKms), 'km/s', H);
  _metric(ctx, W * 0.75, mY2, 'ORBITAL',  _fmt(vOrbKms), 'km/s', H,
          inOrbit ? '#5dd47e' : '#4a6070');

  /* Stage note */
  const stageNote = inOrbit ? 'ORBIT CONFIRMED' : seco ? 'SECO — COASTING' : (meco || stage >= 2) ? 'STAGE 2 BURNING' : 'STAGE 1 BURNING';
  const noteColor = inOrbit || seco ? '#5dd47e' : (meco || stage >= 2) ? '#5dd47e' : '#4dc5dc';
  ctx.fillStyle    = noteColor;
  ctx.font         = `${Math.round(H * 0.032)}px "Syne", sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stageNote, W / 2, content * 0.84);
}

/* ── Main render ── */
export function renderDragon(canvas) {
  const DPR = devicePixelRatio || 1;
  const telem = _role === 'TELEM';

  /* In TELEM mode, rocket_display already set canvas dimensions — don't reset */
  if (!telem) {
    canvas.width  = canvas.offsetWidth  * DPR;
    canvas.height = canvas.offsetHeight * DPR;
  }

  const W   = canvas.width;
  const H   = canvas.height;
  const ctx = canvas.getContext('2d');

  if (!telem) {
    ctx.fillStyle = '#03060a';
    ctx.fillRect(0, 0, W, H);
  }

  const ac = S.aircraft;
  if (!ac) { _drawTabs(ctx, W, H); return; }

  if (!telem) {
    const mT      = S.time ?? 0;
    const ignT    = ac.ignitionTime ?? 0;
    const tLO     = mT - ignT;
    const stage   = S.rocketStage ?? 1;
    const coast   = S.rocketCoast ?? false;
    const meco    = !!(S.rocketMECO);
    const seco    = !!(S.rocketSECO);
    const inOrbit = !!(S.rocketOrbit);
    const altKm   = (S.alt ?? 0) * 0.3048 / 1000;
    const velMs   = (S.spd ?? 0) * 0.5144;
    const velKms  = velMs / 1000;
    const gLoad   = Math.abs(S.rocketG ?? 0);

    switch (_role) {
      case 'CDR': _drawCDR(ctx, W, H, tLO, altKm, velKms, gLoad, stage, meco, seco, inOrbit, coast, ac); break;
      case 'PLT': _drawPLT(ctx, W, H, tLO, altKm, velKms, gLoad, stage, meco, seco, inOrbit, coast, ac); break;
      case 'MO':  _drawMO (ctx, W, H, tLO, altKm, velKms, gLoad, stage, meco, seco, inOrbit, coast);     break;
      case 'MS':  _drawMS (ctx, W, H, tLO, altKm, velKms, stage, meco, seco, inOrbit, ac);               break;
    }
  }

  _drawTabs(ctx, W, H);
}
