/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/lm_display.js
   Lunar Module instrument panel.  Three tabs:
     CDR — LM window (LPD marks) + DSKY + engine / abort status
     LMP — ECS + power + RCS + landing radar
     CB  — circuit breakers + C&W + stage indicator
   Switch CM ↔ LM:  setState({ inLM: !S.inLM })  —  'L' key in index.html
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';
import { drawDSKY, drawDSKYKeyboard } from './dsky.js';

/* ── Tab state ── */
const LM_ROLES  = ['CDR', 'LMP', 'CB'];
let _lmRole     = 'CDR';
let _lmTabRects = [];

/* ── DSKY state (separate from CM) ── */
let _dskyMode    = null;
let _dskyDigits  = '';
let _dskyVerbOv  = null;
let _dskyNounOv  = null;
let _dskyKeyRects = [];

export function loadLMDSKYProgram(verb, noun) {
  _dskyVerbOv = verb; _dskyNounOv = noun; _dskyMode = null; _dskyDigits = '';
}
export function setLMRole(r) { if (LM_ROLES.includes(r)) _lmRole = r; }
export function getLMRole()  { return _lmRole; }

/* ── Text/bar helpers ── */
function _txt(ctx, text, x, y, { font='14px "IBM Plex Mono",monospace', color='#a0aab8', align='left', base='alphabetic' } = {}) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(text, x, y);
}
function _bar(ctx, x, y, w, h, frac, col, bg='#1a2030') {
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
}

/* ── DSKY key handler ── */
function _dskyKeyPress(key) {
  if (key === 'VERB')    { _dskyMode = 'verb'; _dskyDigits = ''; return; }
  if (key === 'NOUN')    { _dskyMode = 'noun'; _dskyDigits = ''; return; }
  if (key === 'CLR')     { _dskyMode = null; _dskyDigits = ''; _dskyVerbOv = null; _dskyNounOv = null; return; }
  if (key === 'KEY REL') { _dskyMode = null; _dskyDigits = ''; return; }
  if (key === 'RSET')    { _dskyMode = null; _dskyDigits = ''; return; }
  if (key === 'PRO')     { _dskyVerbOv = null; _dskyNounOv = null; _dskyMode = null; _dskyDigits = ''; return; }
  if (key === 'ENTR') {
    if (_dskyMode === 'verb' && _dskyDigits.length > 0) _dskyVerbOv = _dskyDigits.padStart(2,'0');
    if (_dskyMode === 'noun' && _dskyDigits.length > 0) _dskyNounOv = _dskyDigits.padStart(2,'0');
    _dskyMode = null; _dskyDigits = ''; return;
  }
  if ('0123456789'.includes(key) && _dskyMode && _dskyDigits.length < 2) {
    _dskyDigits += key;
    if (_dskyDigits.length === 2) {
      if (_dskyMode === 'verb') _dskyVerbOv = _dskyDigits;
      if (_dskyMode === 'noun') _dskyNounOv = _dskyDigits;
      _dskyMode = null; _dskyDigits = '';
    }
  }
}

/* ── LM DSKY program state ── */
function _getDSKYState() {
  const mT    = S.time ?? 0;
  const msn   = S.mission;
  const altM  = (S.alt ?? 0) * 0.3048;
  const velMs = (S.spd ?? 0) * 0.5144;
  const f5    = n => String(Math.abs(Math.round(n))).padStart(5,'0').slice(-5);
  const fmt   = n => (n < 0 ? '-' : ' ') + f5(n);

  /* Manual V/N override */
  if (_dskyVerbOv !== null && _dskyNounOv !== null && _dskyMode === null) {
    const vn = _dskyVerbOv + _dskyNounOv;
    if (vn === '1668') {
      return { prog:'40', verb:'16', noun:'68',
        r1: fmt(Math.round((S.enginePower ?? 0) * 10000)),
        r2: ' 00000', r3: ' 00000', compActy: false };
    }
    if (vn === '1660') {
      return { prog:'63', verb:'16', noun:'60',
        r1: fmt(Math.round(altM * 3.28084)),
        r2: fmt(-Math.round(Math.abs((S.vs ?? 0) / 60))),
        r3: ' 00000', compActy: false };
    }
    if (vn === '1644') {
      return { prog:'00', verb:'16', noun:'44',
        r1: ' ' + f5(Math.round(altM / 1852)),
        r2: fmt(Math.round(velMs * 3.28084)), r3: ' 00000', compActy: false };
    }
    return { prog:'00', verb: _dskyVerbOv, noun: _dskyNounOv,
      r1:' 00000', r2:' 00000', r3:' 00000', compActy: false };
  }

  /* Apollo 13 — PC+2 burn */
  if (msn?.id === 'apollo13' && S.smDamaged) {
    const pc2T  = msn.pc2T  ?? 287859;
    const pc2Dv = msn.pc2Dv ?? 262;
    if (mT >= pc2T && mT < pc2T + 270) {
      const dVLeft = Math.max(0, pc2Dv * 3.28084 * (1 - (mT - pc2T) / 263));
      return { prog:'40', verb:'16', noun:'40',
        r1: ' ' + f5(Math.round(dVLeft)),
        r2: fmt(Math.round(velMs * 3.28084)), r3: ' 00000', compActy: true };
    }
    return { prog:'00', verb:'06', noun:'22',
      r1: fmt(Math.round(altM / 1852)), r2: ' 00000', r3: ' 00000', compActy: false };
  }

  return { prog:'00', verb:'06', noun:'22',
    r1: fmt(Math.round(altM / 1852)), r2: ' 00000', r3: ' 00000', compActy: false };
}

/* ── LM window — the iconic trapezoidal viewport with LPD marks ── */
function _drawLMWindow(ctx, x, y, w, h, dpr) {
  const pad   = Math.round(w * 0.06);
  const bPad  = Math.round(w * 0.16);

  /* Frame */
  ctx.fillStyle = '#22262e';
  ctx.fillRect(x, y, w, h);

  /* Glass area — trapezoid (wider at top, converging at bottom) */
  const gx1 = x + pad,  gy1 = y + pad;
  const gx2 = x + w - pad, gy2 = y + h - pad;
  const gx3 = x + w - bPad, gx4 = x + bPad;

  /* Subtle lunar surface at bottom third during orbit/cislunar */
  ctx.beginPath();
  ctx.moveTo(gx1, gy1); ctx.lineTo(gx2, gy1);
  ctx.lineTo(gx3, gy2); ctx.lineTo(gx4, gy2);
  ctx.closePath();
  const spaceGrad = ctx.createLinearGradient(gx1, gy1, gx4, gy2);
  spaceGrad.addColorStop(0,   '#04070d');
  spaceGrad.addColorStop(0.6, '#030509');
  spaceGrad.addColorStop(1,   '#090c0f');
  ctx.fillStyle = spaceGrad;
  ctx.fill();

  /* Frame edge highlight */
  ctx.strokeStyle = '#3a3e48';
  ctx.lineWidth   = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(gx1, gy1); ctx.lineTo(gx2, gy1);
  ctx.lineTo(gx3, gy2); ctx.lineTo(gx4, gy2);
  ctx.closePath();
  ctx.stroke();

  /* ── LPD angle marks ── */
  const glassH = gy2 - gy1;
  const lpd    = [10, 20, 30, 40, 50, 60];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(gx1, gy1); ctx.lineTo(gx2, gy1); ctx.lineTo(gx3, gy2); ctx.lineTo(gx4, gy2);
  ctx.closePath(); ctx.clip();  /* clip marks to glass area */

  for (const ang of lpd) {
    const yFrac = (ang - 8) / 58;               /* 10° near top, 60° near bottom */
    const lineY = gy1 + glassH * yFrac;
    const t     = (lineY - gy1) / glassH;
    const lx    = gx1  + (gx4  - gx1)  * t;    /* left edge of trapezoid at lineY */
    const rx    = gx2  + (gx3  - gx2)  * t;    /* right edge */

    const major = ang % 20 === 0;
    const alpha = major ? 0.88 : 0.50;
    ctx.strokeStyle = major ? `rgba(180,210,160,${alpha})` : `rgba(140,180,130,${alpha})`;
    ctx.lineWidth   = major ? Math.max(1, 1.1 * dpr) : Math.max(0.5, 0.6 * dpr);
    ctx.setLineDash(major ? [] : [4*dpr, 5*dpr]);
    ctx.beginPath(); ctx.moveTo(lx, lineY); ctx.lineTo(rx, lineY); ctx.stroke();

    /* Degree label — left side */
    ctx.setLineDash([]);
    ctx.font         = `${Math.max(8, Math.round(h * 0.06))}px "IBM Plex Mono",monospace`;
    ctx.fillStyle    = `rgba(160,200,140,${alpha})`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${ang}°`, lx - Math.round(3 * dpr), lineY);
  }
  ctx.restore();

  /* Crosshair reticle — center of window */
  const cx = (gx1 + gx2) / 2, cy = (gy1 + gy2) / 2;
  const rl = Math.round(h * 0.04);
  ctx.strokeStyle = 'rgba(180,210,160,0.35)';
  ctx.lineWidth   = Math.max(0.5, 0.7 * dpr);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(cx - rl, cy); ctx.lineTo(cx + rl, cy);
  ctx.moveTo(cx, cy - rl); ctx.lineTo(cx, cy + rl);
  ctx.stroke();

  /* Title label */
  ctx.font      = `${Math.max(8, Math.round(h * 0.065))}px "IBM Plex Mono",monospace`;
  ctx.fillStyle = '#3a4838';
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('LPD', x + w - pad - Math.round(2*dpr), y + pad + Math.round(2*dpr));
}

/* ── DSKY thin wrappers (shared rendering from dsky.js) ── */
function _callDSKY(ctx, cx, cy, w, h) {
  const st    = _getDSKYState();
  const flash = Math.floor((S.time ?? 0) * 2) % 2 === 0;
  if (_dskyMode === 'verb')       st.verb = flash ? _dskyDigits.padEnd(2, ' ') : '  ';
  else if (_dskyVerbOv !== null)  st.verb = _dskyVerbOv;
  if (_dskyMode === 'noun')       st.noun = flash ? _dskyDigits.padEnd(2, ' ') : '  ';
  else if (_dskyNounOv !== null)  st.noun = _dskyNounOv;
  drawDSKY(ctx, cx, cy, w, h, st);
}
function _callDSKYKeyboard(ctx, x, y, w, h) {
  drawDSKYKeyboard(ctx, x, y, w, h, _dskyMode, _dskyKeyRects);
}

/* ── Tab row ── */
function _drawLMTabs(ctx, W, H, crew) {
  _lmTabRects = [];
  const tabH = Math.round(H*0.072), tabY = H - tabH, tabW = W / LM_ROLES.length;
  for (let i = 0; i < LM_ROLES.length; i++) {
    const r    = LM_ROLES[i];
    const x    = i * tabW;
    const act  = r === _lmRole;
    const name = (crew?.[r]) ? `${r}  ${crew[r].toUpperCase()}` : r;
    ctx.fillStyle = act ? '#1a2818' : '#0c1008';
    ctx.fillRect(x, tabY, tabW-2, tabH);
    ctx.font      = `${Math.round(tabH*0.42)}px "IBM Plex Mono",monospace`;
    ctx.fillStyle = act ? '#b0d890' : '#4a6040';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, x + tabW/2, tabY + tabH/2);
    _lmTabRects.push({role:r, x, y:tabY, w:tabW-2, h:tabH});
  }
  ctx.strokeStyle = '#2a3828'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, tabY); ctx.lineTo(W, tabY); ctx.stroke();
}

/* ══════════════════════════════════════════════════════════════
   CDR tab — window + DSKY
   ══════════════════════════════════════════════════════════════ */
function _drawCDR(ctx, x, y, w, h, dpr, data) {
  const { lSz, sml } = data;
  const mid   = Math.round(w * 0.55);
  const pad   = Math.round(w * 0.025);

  /* Left: LM window */
  const winH  = Math.round(h * 0.60);
  _drawLMWindow(ctx, x, y, mid - pad, winH, dpr);

  /* Left below window: engine arm + abort status */
  const stY   = y + winH + Math.round(h * 0.025);
  const rows  = [
    ['DESCENT ENG', S.smDamaged ? 'ARMED' : 'SAFE',   S.smDamaged ? '#5dd47e' : '#506060'],
    ['ABORT STAGE', 'SAFE',   '#506060'],
    ['ASCENT ENG',  'SAFE',   '#506060'],
    ['LM STAGE',    (S.sivbSep || S.smDamaged) ? 'DESCENT' : '---', '#a0aab8'],
  ];
  let ry = stY;
  const rowStep = Math.round(h * 0.082);
  for (const [lbl, val, col] of rows) {
    _txt(ctx, lbl, x + pad, ry, { font: sml, color: '#4a6040' });
    _txt(ctx, val, x + mid - pad*2, ry, { font: sml, color: col, align: 'right' });
    ry += rowStep;
  }

  /* Right: DSKY */
  const dskyX    = x + mid + pad;
  const dskyW    = w - mid - pad*2;
  const dskyH    = Math.round(h * 0.55);
  const kbdH     = Math.round(h * 0.38);
  _callDSKY(ctx, dskyX + dskyW/2, y + dskyH/2, dskyW, dskyH);
  _callDSKYKeyboard(ctx, dskyX, y + dskyH + Math.round(h*0.02), dskyW, kbdH);
}

/* ══════════════════════════════════════════════════════════════
   LMP tab — ECS + power + RCS + radar
   ══════════════════════════════════════════════════════════════ */
function _drawLMP(ctx, x, y, w, h, dpr, data) {
  const { lSz, sml } = data;
  const pad     = Math.round(w * 0.05);
  const colW    = Math.round(w * 0.46);
  const barH    = Math.round(h * 0.018);
  const rowStep = Math.round(h * 0.058);
  const altM    = (S.alt ?? 0) * 0.3048;
  const velMs   = (S.spd ?? 0) * 0.5144;

  function section(label, sx, sy) {
    _txt(ctx, label, sx, sy, { font: lSz, color: '#4a6a38' });
    ctx.fillStyle = '#1e2c1a'; ctx.fillRect(sx, sy + Math.round(rowStep*0.7), colW, 1);
    return sy + rowStep;
  }
  function row(label, value, col, sx, sy, bar) {
    _txt(ctx, label, sx, sy, { font: sml, color: '#3a5030' });
    _txt(ctx, value, sx + colW, sy, { font: sml, color: col, align: 'right' });
    if (bar !== undefined) _bar(ctx, sx, sy + Math.round(rowStep*0.75), colW, barH, bar, col);
    return sy + rowStep;
  }

  /* ── Left column: ECS + Power ── */
  let ly = y + pad;
  ly = section('ECS', x + pad, ly);
  const o2Frac = S.smDamaged ? 0.38 : 0.92;
  ly = row('O₂ QTY',    `${Math.round(o2Frac*100)} %`, o2Frac > 0.5 ? '#5dd47e' : '#f0a030', x+pad, ly, o2Frac);
  ly = row('CABIN PRES', '5.0 psi', '#a0aab8', x+pad, ly);
  ly = row('SUIT TEMP',  '72 °F',   '#a0aab8', x+pad, ly);
  ly += Math.round(rowStep * 0.3);

  ly = section('POWER', x + pad, ly);
  const batFrac = S.smDamaged ? 0.82 : 0.96;
  ly = row('DESCENT BATT', `${Math.round(batFrac*100)} %`, '#5dd47e', x+pad, ly, batFrac);
  ly = row('ASCENT BATT',  '100 %', '#5dd47e', x+pad, ly, 1.0);
  ly = row('LM BUS',       '29.0 V', '#a0aab8', x+pad, ly);

  /* ── Right column: RCS + Radar ── */
  const rx = x + pad + colW + Math.round(w * 0.08);
  let ry = y + pad;
  ry = section('RCS QUADS', rx, ry);
  const quads = ['A','B','C','D'];
  const qFrac = S.smDamaged ? [0.78, 0.78, 0.78, 0.78] : [0.95, 0.95, 0.95, 0.95];
  for (let q = 0; q < 4; q++) {
    ry = row(`QUAD ${quads[q]}`, `${Math.round(qFrac[q]*100)} %`,
             qFrac[q] > 0.6 ? '#5dd47e' : '#f0a030', rx, ry, qFrac[q]);
  }
  ry += Math.round(rowStep * 0.3);

  ry = section('LANDING RADAR', rx, ry);
  const radarAlt = altM < 15000 ? `${Math.round(altM)} m` : '----';
  const radarDot = altM < 15000 ? '#5dd47e' : '#3a5030';
  ry = row('ALT',       radarAlt, radarDot, rx, ry);
  ry = row('VEL HORIZ', altM < 15000 ? `${Math.round(velMs)} m/s` : '----', radarDot, rx, ry);
  ry = row('VEL VERT',  altM < 15000 ? `${Math.round(Math.abs((S.vs??0)/196.85))} m/s` : '----', radarDot, rx, ry);
}

/* ══════════════════════════════════════════════════════════════
   CB tab — circuit breakers + C&W + stage
   ══════════════════════════════════════════════════════════════ */
function _drawCB(ctx, x, y, w, h, dpr, data) {
  const { lSz, sml } = data;
  const pad = Math.round(w * 0.04);

  /* ── Stage indicator ── */
  const stgY = y + pad;
  const stgH = Math.round(h * 0.06);
  const stage = (S.smDamaged || S.sivbSep) ? 'DESCENT' : 'STOWED';
  _txt(ctx, 'LM STAGE', x + pad, stgY + stgH/2, { font: lSz, color: '#4a6a38', base: 'middle' });
  const boxW = Math.round(w * 0.30);
  ctx.fillStyle = stage === 'DESCENT' ? '#1a3020' : '#0e1a10';
  ctx.strokeStyle = '#2a4828'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x + w - pad - boxW, stgY, boxW, stgH, 4); ctx.fill(); ctx.stroke();
  _txt(ctx, stage, x + w - pad - boxW/2, stgY + stgH/2,
       { font: lSz, color: stage === 'DESCENT' ? '#5dd47e' : '#3a5030', align: 'center', base: 'middle' });

  /* ── C&W cells — LM-specific ── */
  const cwY  = stgY + stgH + Math.round(h * 0.03);
  const cwH  = Math.round(h * 0.30);
  const warnings = new Set(S.activeWarnings ?? []);

  const cells = [
    ['LM_BUS_1_UNDERVOLT', 'BUS 1 UNDER'],  ['LM_BUS_2_UNDERVOLT', 'BUS 2 UNDER'],
    ['O2_PRESS_1',          'O₂ PRESS 1'],   ['CO2_PARTIAL_PRESS',   'CO₂ PRESS'],
    ['PGNCS_FAIL',          'PGNCS FAIL'],   ['AGS_FAIL',            'AGS FAIL'],
    ['DESCENT_QTY',         'DESC QTY'],     ['MASTER_ALARM',        'MASTER ALM'],
  ];
  const COLS = 2, ROWS = Math.ceil(cells.length / COLS);
  const cw = (w - pad*3) / COLS, ch = cwH / ROWS;
  const masterAlarm = !!(S.masterAlarm);

  ctx.font = `${Math.max(8, Math.round(ch*0.36))}px "IBM Plex Mono",monospace`;
  for (let i = 0; i < cells.length; i++) {
    const [id, lbl] = cells[i];
    const col = i % COLS, row = Math.floor(i / COLS);
    const cx_ = x + pad + col * (cw + pad), cy_ = cwY + row * ch;
    const lit  = id && (warnings.has(id) || (id === 'MASTER_ALARM' && masterAlarm));
    if (!lbl) continue;
    ctx.fillStyle = lit ? '#4a2008' : '#0e1208';
    ctx.strokeStyle = lit ? '#c04010' : '#1c2818';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(cx_, cy_+2, cw-2, ch-4, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = lit ? '#f08040' : '#2a3a28';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, cx_ + (cw-2)/2, cy_ + ch/2);
  }

  /* Master alarm header */
  if (masterAlarm) {
    const maY = cwY - Math.round(h*0.025);
    _txt(ctx, '▶  MASTER ALARM  ◀', x + w/2, maY, { font: lSz, color: '#f04020', align: 'center', base: 'bottom' });
  }

  /* ── Circuit breaker grid (key breakers) ── */
  const cbY  = cwY + cwH + Math.round(h * 0.04);
  const cbH  = h - (cbY - y) - pad;
  _txt(ctx, 'CIRCUIT BREAKERS — PANEL 16 (partial)', x + pad, cbY, { font: sml, color: '#2a4028' });

  const breakers = [
    ['EPS',  ['MAIN SOL A','MAIN SOL B','BATT FEED A','BATT FEED B']],
    ['ECS',  ['O2 PRESS REG','SUIT CIRC FAN','WATER SEP A','CO2 ABSORB']],
    ['PGNCS',['IMU PWR','CDU PWR','DISP PWR','DSKY']],
    ['COMM', ['RCVR A','XMIT A','VHF A','VHF B']],
  ];
  const bRowH  = Math.round(cbH / (breakers.length + 0.5));
  const bCellW = Math.round((w - pad*2) / 4);
  let bry = cbY + bRowH * 0.6;
  for (const [group, names] of breakers) {
    _txt(ctx, group, x + pad, bry, { font: sml, color: '#3a5030' });
    for (let j = 0; j < names.length; j++) {
      const bx = x + pad + j * bCellW, by2 = bry + Math.round(bRowH * 0.05);
      const bw2 = bCellW - Math.round(w*0.012), bh2 = Math.round(bRowH * 0.52);
      ctx.fillStyle = '#0e1810'; ctx.strokeStyle = '#2a3828'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by2, bw2, bh2, 2); ctx.fill(); ctx.stroke();
      /* Breaker cap (small circle = closed) */
      const capR = Math.round(bh2 * 0.22);
      ctx.fillStyle = '#2a4a28';
      ctx.beginPath(); ctx.arc(bx + bw2/2, by2 + capR + 2, capR, 0, Math.PI*2); ctx.fill();
      ctx.font = `${Math.max(7, Math.round(bh2*0.30))}px "IBM Plex Mono",monospace`;
      ctx.fillStyle = '#3a5030'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(names[j], bx + bw2/2, by2 + capR*2 + 4);
    }
    bry += bRowH;
  }
}

/* ══════════════════════════════════════════════════════════════
   Main render
   ══════════════════════════════════════════════════════════════ */
export function renderLM(canvas) {
  const DPR = devicePixelRatio || 1;
  const W   = canvas.width  = canvas.offsetWidth  * DPR;
  const H   = canvas.height = canvas.offsetHeight * DPR;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#03060a'; ctx.fillRect(0, 0, W, H);

  const ac  = S.aircraft;
  const msn = S.mission;
  if (!ac) return;

  const crew   = msn?.crew ?? {};
  const tabH   = Math.round(H * 0.072);
  const hdH    = Math.round(H * 0.10);
  const pad    = Math.round(W * 0.025);
  const mainT  = hdH + Math.round(H * 0.015);
  const mainH  = H - tabH - mainT;

  const mT   = S.time ?? 0;
  const ignT = ac.ignitionTime ?? 0;
  const absT = Math.abs(mT - ignT);
  const hh = Math.floor(absT/3600), mm = Math.floor((absT%3600)/60), ss = Math.floor(absT%60);
  const met = `T+ ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;

  const lSz = `${Math.round(H*0.030)}px "IBM Plex Mono",monospace`;
  const sml = `${Math.round(H*0.022)}px "IBM Plex Mono",monospace`;

  /* ── Header ── */
  ctx.fillStyle = '#040a06';
  ctx.fillRect(0, 0, W, hdH);
  ctx.strokeStyle = '#1a2e18'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, hdH); ctx.lineTo(W, hdH); ctx.stroke();

  const callsign = (msn?.id === 'apollo13') ? 'AQUARIUS' : 'LM';
  _txt(ctx, callsign, pad, Math.round(hdH*0.6),
       { font: `${Math.round(H*0.042)}px "IBM Plex Mono",monospace`, color: '#b0d890', base: 'middle' });
  _txt(ctx, 'LM  CDR ' + (crew.CDR?.toUpperCase()??(msn?.crew?.CDR?.toUpperCase()??'')),
       W/2, Math.round(hdH*0.6),
       { font: lSz, color: '#6a8a60', align: 'center', base: 'middle' });
  _txt(ctx, met, W-pad, Math.round(hdH*0.52),
       { font: `${Math.round(H*0.038)}px "IBM Plex Mono",monospace`, color: '#5dd47e', align: 'right', base: 'middle' });

  /* ── CM link button ── */
  const btnW = Math.round(W * 0.12), btnH = Math.round(hdH * 0.42);
  const btnX = W - pad - btnW - Math.round(W*0.12), btnY = Math.round(hdH*0.30);
  ctx.fillStyle   = '#0e1a0e'; ctx.strokeStyle = '#2a4028'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(btnX, btnY, btnW, btnH, 3); ctx.fill(); ctx.stroke();
  _txt(ctx, '← CM', btnX + btnW/2, btnY + btnH/2,
       { font: sml, color: '#4a6a40', align: 'center', base: 'middle' });

  /* ── Main content ── */
  const data = { lSz, sml };
  const role = _lmRole;
  if      (role === 'CDR') _drawCDR(ctx, pad, mainT, W-pad*2, mainH, DPR, data);
  else if (role === 'LMP') _drawLMP(ctx, pad, mainT, W-pad*2, mainH, DPR, data);
  else if (role === 'CB')  _drawCB (ctx, pad, mainT, W-pad*2, mainH, DPR, data);

  /* ── Tabs ── */
  _drawLMTabs(ctx, W, H, crew);
}

/* ── Click handler ── */
export function handleLMClick(canvas, evt) {
  const DPR  = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const mx   = (evt.clientX - rect.left)  * DPR;
  const my   = (evt.clientY - rect.top)   * DPR;

  /* Tab selection */
  for (const t of _lmTabRects) {
    if (mx >= t.x && mx <= t.x+t.w && my >= t.y && my <= t.y+t.h) {
      _lmRole = t.role; return;
    }
  }

  /* DSKY keyboard (CDR only) */
  if (_lmRole === 'CDR') {
    for (const k of _dskyKeyRects) {
      if (mx >= k.x && mx <= k.x+k.w && my >= k.y && my <= k.y+k.h) {
        _dskyKeyPress(k.key); return;
      }
    }
  }

  /* CM link button */
  const W   = canvas.width;
  const hdH = Math.round(canvas.height * 0.10);
  const pad = Math.round(W * 0.025);
  const btnW = Math.round(W * 0.12), btnH = Math.round(hdH * 0.42);
  const btnX = W - pad - btnW - Math.round(W*0.12), btnY = Math.round(hdH * 0.30);
  if (mx >= btnX && mx <= btnX+btnW && my >= btnY && my <= btnY+btnH) {
    setState({ inLM: false });
  }
}
