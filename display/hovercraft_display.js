/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/hovercraft_display.js
   Hovercraft instrument panel — single vehicle or split screen.

   Modes (S.hcActive):
     'timo'   — full-width Timo panel
     'markus' — full-width Markus panel
     'both'   — split screen, Timo left / Markus right

   Each panel shows the plenum physics model in real time.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

/* ── Palette ── */
const C = {
  bg:     '#0d1117',
  panel:  '#161b22',
  border: '#30363d',
  dim:    '#484f58',
  text:   '#e6edf3',
  sub:    '#8b949e',
  green:  '#3fb950',
  teal:   '#39d0d0',
  amber:  '#d29922',
  red:    '#f85149',
  blue:   '#388bfd',
  white:  '#ffffff',
};

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"IBM Plex Mono", "Courier New", monospace';

const _r = d => (d - 90) * Math.PI / 180;

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderHovercraft(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const active = S.hcActive ?? 'timo';

  if (active === 'both') {
    const panelW = Math.floor(W / 2);
    const sc     = Math.min(panelW, H) / 720;
    const timoAc   = S.hcVehicles?.timo   ?? S.aircraft;
    const markusAc = S.hcVehicles?.markus  ?? S.aircraft;

    _renderPanel(ctx, panelW, H, sc, 'hc', timoAc);

    /* Divider */
    ctx.strokeStyle = C.border; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(panelW, 0); ctx.lineTo(panelW, H); ctx.stroke();

    ctx.save();
    ctx.translate(panelW, 0);
    _renderPanel(ctx, panelW, H, sc, 'hcM', markusAc);
    ctx.restore();
  } else {
    const pfx = active === 'markus' ? 'hcM' : 'hc';
    const ac  = active === 'markus'
      ? (S.hcVehicles?.markus ?? S.aircraft)
      : (S.hcVehicles?.timo   ?? S.aircraft);
    const sc = Math.min(W, H) / 720;
    _renderPanel(ctx, W, H, sc, pfx, ac);
  }

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   PANEL — reads state via prefix, draws to (0,0)→(W,H)
   ════════════════════════════════════════════════════════════ */
function _renderPanel(ctx, W, H, sc, pfx, ac) {
  const spec = ac?.specs;

  /* Read state via prefix */
  const pressure  = S[pfx + 'Pressure']  ?? 0;
  const pReq      = S[pfx + 'PReq']      ?? (spec ? ((S[pfx + 'Mass'] ?? spec.mass_kg) * 9.81 / spec.plenum_area_m2) : 135);
  const liftAct   = S[pfx + 'LiftAct']   ?? 0;
  const liftCmd   = S[pfx + 'LiftT']     ?? 0;
  const thrCmd    = S[pfx + 'ThrustT']   ?? 0;
  const hovering  = S[pfx + 'Hovering']  ?? false;
  const liftRat   = S[pfx + 'LiftRatio'] ?? 0;
  const edfOp     = S[pfx + 'EdfOp']     ?? 0;
  const mode      = S[pfx + 'Mode']      ?? 'NORMAL';
  const nodes     = S[pfx + 'Nodes']     ?? [1, 1, 1];
  const yawRate   = S[pfx + 'YawRate']   ?? 0;
  const heading   = S[pfx + 'Heading']   ?? 0;
  const speed     = S[pfx + 'Speed']     ?? 0;
  const escActive = liftCmd > liftAct + 0.005;

  /* Autonomy (Markus only) */
  const autonomy  = pfx !== 'hc' ? (S[pfx + 'Autonomy'] ?? 'MANUAL') : null;

  /* Aircraft display fields */
  const acColor = ac?.color ?? C.teal;
  const liftLabel   = spec?.lift_edf  ? `${spec.lift_edf.model}\n${Math.round((ac.envelope?.max_lift_throttle ?? 0.8) * 100)}% ESC limit` : '';
  const thrustLabel = spec?.thrust_edf ? spec.thrust_edf.model : '';

  const topH = 48 * sc;
  const botH = 44 * sc;
  const midY = topH + (H - topH - botH) / 2;

  /* Top bar */
  _drawTopBar(ctx, W, topH, sc, mode, nodes, heading, speed, ac?.name ?? '', acColor, autonomy);

  /* Left: Lift EDF throttle bar */
  const liftX  = W * 0.16;
  const barH   = (H - topH - botH) * 0.68;
  const barTop = topH + (H - topH - botH) * 0.14;
  _drawThrottleBar(ctx, liftX, barTop, 36 * sc, barH, sc,
    liftAct, liftCmd, ac?.envelope?.max_lift_throttle ?? 0.80, acColor,
    'LIFT EDF', liftLabel, escActive);

  /* Center: Pressure arc gauge */
  const gaugeR = Math.min(W * 0.22, (H - topH - botH) * 0.42);
  _drawPressureGauge(ctx, W * 0.50, midY - gaugeR * 0.04, gaugeR, sc,
    pressure, pReq, hovering, acColor);

  /* Right: Status panel */
  const rxCol = W * 0.80;
  _drawHoverBadge(ctx, rxCol, topH + (H - topH - botH) * 0.18, sc, hovering, liftRat, acColor);
  _drawLiftRatioBar(ctx, rxCol, topH + (H - topH - botH) * 0.50, W * 0.30, sc, liftRat);
  _drawThrottleBar(ctx, rxCol, topH + (H - topH - botH) * 0.55, 28 * sc, barH * 0.42, sc,
    thrCmd, thrCmd, 1.0, C.blue, 'THRUST', thrustLabel, false);

  /* Bottom bar */
  _drawBottomBar(ctx, W, H, botH, sc, edfOp, yawRate, liftAct, pressure, pReq);
}

/* ════════════════════════════════════════════════════════════
   TOP BAR — vehicle · mode · nodes · heading · speed
   ════════════════════════════════════════════════════════════ */
function _drawTopBar(ctx, W, topH, sc, mode, nodes, heading, speed, acName, acColor, autonomy) {
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, W, topH);
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, topH); ctx.lineTo(W, topH); ctx.stroke();

  const y = topH / 2;

  /* Vehicle name (colored) */
  ctx.fillStyle    = acColor;
  ctx.font         = `bold ${9 * sc}px ${SANS}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(acName.toUpperCase(), 14 * sc, y);

  /* Envelope mode badge */
  const modeCol = mode === 'NORMAL' ? C.green : mode === 'DEGRADED' ? C.amber : C.red;
  const badgeX  = acName ? W * 0.28 : 14 * sc;
  ctx.fillStyle = modeCol + '22';
  _roundRect(ctx, badgeX, y - 11 * sc, 80 * sc, 22 * sc, 4 * sc); ctx.fill();
  ctx.strokeStyle = modeCol + '88'; ctx.lineWidth = 1;
  _roundRect(ctx, badgeX, y - 11 * sc, 80 * sc, 22 * sc, 4 * sc); ctx.stroke();
  ctx.fillStyle    = modeCol;
  ctx.font         = `bold ${10 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mode, badgeX + 40 * sc, y);

  /* Autonomy badge (Markus) */
  if (autonomy) {
    const aCol = autonomy === 'MANUAL' ? C.sub : autonomy === 'HOVER' ? C.green : C.amber;
    const ax   = badgeX + 88 * sc;
    ctx.fillStyle    = aCol;
    ctx.font         = `${9 * sc}px ${SANS}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(autonomy, ax, y);
  }

  /* Node voting triad */
  const nodeColors = nodes.map(n => n >= 0.9 ? C.green : n >= 0.5 ? C.amber : C.red);
  const nodeBase   = W * 0.54;
  for (let i = 0; i < 3; i++) {
    const nx = nodeBase + i * 32 * sc;
    ctx.beginPath(); ctx.arc(nx, y - 5 * sc, 5 * sc, 0, Math.PI * 2);
    ctx.fillStyle = nodeColors[i]; ctx.fill();
    ctx.fillStyle    = C.sub;
    ctx.font         = `${8 * sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`N${i + 1}`, nx, y + 8 * sc);
  }

  /* Heading */
  ctx.fillStyle    = C.text;
  ctx.font         = `${11 * sc}px ${MONO}`;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`HDG  ${String(Math.round(heading)).padStart(3, '0')}°`, W * 0.84, y);

  /* Speed */
  ctx.fillStyle = acColor;
  ctx.font      = `${11 * sc}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${speed.toFixed(1)} m/s`, W - 14 * sc, y);
}

/* ════════════════════════════════════════════════════════════
   PRESSURE ARC GAUGE
   ════════════════════════════════════════════════════════════ */
function _drawPressureGauge(ctx, cx, cy, r, sc, pressure, pReq, hovering, acColor) {
  const maxP  = 300;
  const s0Deg = 225;
  const sweep = 270;

  ctx.save();
  ctx.strokeStyle = C.border;
  ctx.lineWidth   = 12 * sc;
  ctx.lineCap     = 'butt';
  ctx.beginPath();
  ctx.arc(cx, cy, r, _r(s0Deg), _r(s0Deg + sweep));
  ctx.stroke();

  const valFrac = Math.min(1, Math.max(0, pressure / maxP));
  const valDeg  = s0Deg + valFrac * sweep;
  const arcCol  = hovering ? (acColor ?? C.teal) : C.amber;
  if (pressure > 0.5) {
    ctx.strokeStyle = arcCol;
    ctx.lineWidth   = 12 * sc;
    ctx.beginPath();
    ctx.arc(cx, cy, r, _r(s0Deg), _r(valDeg));
    ctx.stroke();
  }

  /* Required pressure threshold tick */
  const reqFrac = Math.min(1, pReq / maxP);
  const reqDeg  = s0Deg + reqFrac * sweep;
  const reqA    = _r(reqDeg);
  const tickLen = 20 * sc;
  ctx.strokeStyle = C.red; ctx.lineWidth = 2.5 * sc; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(reqA) * (r - tickLen), cy + Math.sin(reqA) * (r - tickLen));
  ctx.lineTo(cx + Math.cos(reqA) * (r + 4 * sc),  cy + Math.sin(reqA) * (r + 4 * sc));
  ctx.stroke();
  const tlr = r + 18 * sc;
  ctx.fillStyle    = C.red;
  ctx.font         = `bold ${8.5 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(pReq)}`, cx + Math.cos(reqA) * tlr, cy + Math.sin(reqA) * tlr);
  ctx.restore();

  /* Scale labels */
  ctx.fillStyle    = C.dim;
  ctx.font         = `${8 * sc}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const v of [0, 100, 200, 300]) {
    const a  = _r(s0Deg + (v / maxP) * sweep);
    const lr = r + 18 * sc;
    if (Math.abs(v - Math.round(pReq)) > 12) {
      ctx.fillText(String(v), cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
    }
  }

  /* Center readout */
  ctx.fillStyle    = hovering ? (acColor ?? C.teal) : C.amber;
  ctx.font         = `bold ${32 * sc}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pressure.toFixed(1), cx, cy - 4 * sc);

  ctx.fillStyle    = C.sub;
  ctx.font         = `${10 * sc}px ${SANS}`;
  ctx.fillText('Pa  Plenum', cx, cy + 22 * sc);

  ctx.fillStyle = C.red;
  ctx.font      = `${7.5 * sc}px ${SANS}`;
  ctx.fillText('HOVER THRESHOLD', cx, cy + 35 * sc);
}

/* ════════════════════════════════════════════════════════════
   HOVERING BADGE + lift ratio
   ════════════════════════════════════════════════════════════ */
function _drawHoverBadge(ctx, cx, y, sc, hovering, liftRat, acColor) {
  const bw  = 100 * sc, bh = 38 * sc;
  const col = hovering ? C.green : C.red;
  const bx  = cx - bw / 2;

  ctx.fillStyle = col + '18';
  _roundRect(ctx, bx, y, bw, bh, 6 * sc); ctx.fill();
  ctx.strokeStyle = col + 'aa'; ctx.lineWidth = 1.5;
  _roundRect(ctx, bx, y, bw, bh, 6 * sc); ctx.stroke();

  ctx.fillStyle    = col;
  ctx.font         = `bold ${14 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hovering ? '▲  HOVERING' : '▼  GROUNDED', cx, y + bh / 2);

  const pct = Math.round(Math.min(liftRat, 1.99) * 100);
  ctx.fillStyle    = liftRat >= 1 ? C.green : C.amber;
  ctx.font         = `${10 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Lift ratio  ${pct}%`, cx, y + bh + 18 * sc);
}

/* ════════════════════════════════════════════════════════════
   LIFT RATIO HORIZONTAL BAR
   ════════════════════════════════════════════════════════════ */
function _drawLiftRatioBar(ctx, cx, y, maxW, sc, liftRat) {
  const bw = maxW * 0.72;
  const bh = 10 * sc;
  const bx = cx - bw / 2;

  ctx.fillStyle = C.panel;
  _roundRect(ctx, bx, y, bw, bh, 3 * sc); ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  _roundRect(ctx, bx, y, bw, bh, 3 * sc); ctx.stroke();

  const fillW = Math.min(bw, liftRat * bw);
  if (fillW > 0) {
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, C.amber);
    grad.addColorStop(Math.min(1, 1 / Math.max(0.01, liftRat)), C.green);
    grad.addColorStop(1, C.teal);
    ctx.fillStyle = grad;
    _roundRect(ctx, bx, y, fillW, bh, 3 * sc); ctx.fill();
  }

  /* 100% line */
  const pct100x = bx + bw * Math.min(1, 1 / Math.max(0.01, liftRat));
  ctx.strokeStyle = C.white + '66'; ctx.lineWidth = 1.5;
  ctx.setLineDash([2 * sc, 2 * sc]);
  ctx.beginPath();
  ctx.moveTo(pct100x, y - 3 * sc);
  ctx.lineTo(pct100x, y + bh + 3 * sc);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ════════════════════════════════════════════════════════════
   THROTTLE VERTICAL BAR
   ════════════════════════════════════════════════════════════ */
function _drawThrottleBar(ctx, cx, barTop, bw, bh, sc,
  actualV, cmdV, limitV, color, title, subtitle, escActive) {
  const bx = cx - bw / 2;

  ctx.fillStyle = C.panel;
  _roundRect(ctx, bx, barTop, bw, bh, 3 * sc); ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  _roundRect(ctx, bx, barTop, bw, bh, 3 * sc); ctx.stroke();

  if (escActive && cmdV > actualV) {
    const cmdH = cmdV * bh;
    ctx.fillStyle = color + '30';
    _roundRect(ctx, bx, barTop + bh - cmdH, bw, cmdH, 3 * sc); ctx.fill();
  }

  const fillH = actualV * bh;
  if (fillH > 1) {
    const grd = ctx.createLinearGradient(0, barTop, 0, barTop + bh);
    grd.addColorStop(0, color + 'ff');
    grd.addColorStop(1, color + '88');
    ctx.fillStyle = grd;
    _roundRect(ctx, bx, barTop + bh - fillH, bw, fillH, 3 * sc); ctx.fill();
  }

  if (limitV < 1) {
    const ly = barTop + bh * (1 - limitV);
    ctx.strokeStyle = C.amber; ctx.lineWidth = 1.8 * sc;
    ctx.setLineDash([3 * sc, 2 * sc]);
    ctx.beginPath();
    ctx.moveTo(bx - 4 * sc, ly); ctx.lineTo(bx + bw + 4 * sc, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle    = C.amber;
    ctx.font         = `${7 * sc}px ${SANS}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.round(limitV * 100)}%`, bx + bw + 5 * sc, ly);
  }

  if (escActive) {
    ctx.fillStyle    = C.amber;
    ctx.font         = `bold ${7.5 * sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('ESC LIM', cx, barTop - 16 * sc);
  }

  ctx.fillStyle    = color;
  ctx.font         = `bold ${10 * sc}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(actualV * 100)}%`, cx, barTop + bh + 6 * sc);

  ctx.fillStyle    = C.sub;
  ctx.font         = `${8 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(title, cx, barTop - 18 * sc);
  if (subtitle) {
    const lines = subtitle.split('\n');
    lines.forEach((ln, i) => {
      ctx.fillStyle = C.dim;
      ctx.font      = `${7 * sc}px ${SANS}`;
      ctx.fillText(ln, cx, barTop - (18 + (lines.length - i - 1) * 10) * sc);
    });
  }
}

/* ════════════════════════════════════════════════════════════
   BOTTOM BAR — EDF op point · yaw rate · ΔP
   ════════════════════════════════════════════════════════════ */
function _drawBottomBar(ctx, W, H, botH, sc, edfOp, yawRate, liftAct, pressure, pReq) {
  const y = H - botH;
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, y, W, botH);
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();

  const my = H - botH / 2;
  ctx.textBaseline = 'middle';

  const opPct = Math.round(edfOp * 100);
  const opCol = opPct > 80 ? C.green : opPct > 60 ? C.amber : C.red;
  ctx.fillStyle = C.sub;  ctx.font = `${8.5 * sc}px ${SANS}`; ctx.textAlign = 'left';
  ctx.fillText('EDF OP', 14 * sc, my);
  ctx.fillStyle = opCol; ctx.font = `bold ${10 * sc}px ${MONO}`;
  ctx.fillText(`${opPct}%`, 52 * sc, my);

  ctx.fillStyle = C.sub;  ctx.font = `${8.5 * sc}px ${SANS}`; ctx.textAlign = 'center';
  ctx.fillText('YAW', W * 0.38, my);
  const yrCol = Math.abs(yawRate) > 25 ? C.amber : C.text;
  ctx.fillStyle = yrCol; ctx.font = `bold ${10 * sc}px ${MONO}`;
  ctx.fillText(`${yawRate >= 0 ? '+' : ''}${yawRate.toFixed(1)} dps`, W * 0.50, my);

  const delta = pressure - pReq;
  const dCol  = delta >= 0 ? C.green : C.red;
  ctx.fillStyle = C.sub;  ctx.font = `${8.5 * sc}px ${SANS}`; ctx.textAlign = 'right';
  ctx.fillText('P − P_req', W - 120 * sc, my);
  ctx.fillStyle = dCol; ctx.font = `bold ${10 * sc}px ${MONO}`;
  ctx.fillText(`${delta >= 0 ? '+' : ''}${delta.toFixed(1)} Pa`, W - 14 * sc, my);
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */
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
