/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/g1000.js
   Garmin G1000 glass cockpit — C172 / piston aircraft.
   PFD (left 52%): attitude · tapes · HSI · ILS
   MFD (right 48%): horizontal engine strip (top 17%) · Leaflet topo map
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }                           from '../core/state.js';
import { updateG1000MapOverlay, hideG1000Map }   from './map.js';
import { startEngineLifecycle, stopEngineLifecycle, startFuelPump, stopFuelPump } from '../core/sound.js';
import { getCOMState, comTransfer }              from './com.js';

/* Hit regions rebuilt each frame by _switchPanel */
let _swHits = [];

export function handleG1000Click(canvas, evt) {
  const DPR  = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const x    = (evt.clientX - rect.left) * DPR;
  const y    = (evt.clientY - rect.top)  * DPR;
  for (const h of _swHits) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      h.action();
      return;
    }
  }
}

const G = {
  bg:      'rgba(18,20,26,0.65)',
  panel:   'rgba(12,14,18,0.65)',
  sky:     '#3a6cb0',
  ground:  '#7a4e28',
  white:   '#e8f0f8',
  cyan:    '#4dc5dc',
  green:   '#44dd66',
  amber:   '#ffb74d',
  red:     '#ff3333',
  magenta: '#e040fb',
  dim:     'rgba(232,240,248,0.38)',
  tape:    'rgba(8,10,16,0.88)',
  bezel:   '#060809',
};

const MONO = '"IBM Plex Mono", "Courier New", monospace';

/* C172 speed limits (kt) */
const V = { Vs0: 44, Vs1: 53, Vfe: 85, Vno: 128, Vne: 163 };

/* ── Public ── */
export function renderG1000(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  ctx.fillStyle = G.bezel;
  ctx.fillRect(0, 0, W, H);

  /* Three-zone layout: switch panel | PFD bezel | MFD bezel */
  const swW   = Math.round(W * 0.14);
  const gap   = Math.round(W * 0.004);
  const scrW  = Math.round((W - swW - gap) / 2);
  const pfdX  = swW;
  const mfdX  = pfdX + scrW + gap;

  /* Bezel insets */
  const bzT   = Math.round(H * 0.045);   /* top  — GARMIN label */
  const bzB   = Math.round(H * 0.025);   /* bottom */
  const bzP   = Math.round(W * 0.007);   /* side padding */
  const bkpH  = Math.round(H * 0.18);    /* backup instruments strip */
  const scrH  = H - bkpH - bzT - bzB;    /* usable screen height */

  /* ── Switch panel (left column) ── */
  _switchPanel(ctx, 0, 0, swW, H);

  const powered = S.masterBat !== false && S.avionicsOn !== false;

  /* ── PFD ── */
  _screenBezel(ctx, pfdX, 0, scrW, H - bkpH);
  if (powered) {
    _pfd(ctx, pfdX + bzP, bzT, scrW - bzP * 2, scrH);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(pfdX + bzP, bzT, scrW - bzP * 2, scrH);
  }

  /* ── MFD ── */
  _screenBezel(ctx, mfdX, 0, scrW, H - bkpH);
  if (powered) {
    _mfd(ctx, canvas, mfdX + bzP, bzT, scrW - bzP * 2, scrH);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(mfdX + bzP, bzT, scrW - bzP * 2, scrH);
    hideG1000Map();
  }

  /* ── Analog backup instruments (always powered — vacuum/standby) ── */
  _backupGauges(ctx, pfdX, H - bkpH, W - swW, bkpH);

  ctx.restore();
}

/* ══════════════════════════════════════════
   PFD
   ══════════════════════════════════════════ */

function _pfd(ctx, x, y, w, h) {
  const topH = Math.round(h * 0.09);
  const hsiH = Math.round(h * 0.28);
  const aiH  = h - topH - hsiH;
  const tapW = Math.round(w * 0.14);
  const aiX  = x + tapW;
  const aiY  = y + topH;
  const aiW  = w - tapW * 2;

  _topBar(ctx, x, y, w, topH);
  _ai(ctx, aiX, aiY, aiW, aiH);
  _speedTape(ctx, x, aiY, tapW, aiH);
  _altTape(ctx, x + w - tapW, aiY, tapW, aiH);
  _ils(ctx, aiX, aiY, aiW, aiH);
  _hsi(ctx, x, y + topH + aiH, w, hsiH);

  /* Dividers */
  ctx.strokeStyle = G.bezel;
  ctx.lineWidth = 2;
  _line(ctx, aiX,       y, aiX,       y + topH + aiH);
  _line(ctx, aiX + aiW, y, aiX + aiW, y + topH + aiH);
  _line(ctx, x, y + topH + aiH, x + w, y + topH + aiH);
}

function _topBar(ctx, x, y, w, h) {
  const fs  = Math.round(h * 0.34);
  const my  = y + h / 2;
  const com = getCOMState();
  const comOpen = S.comPanelVisible;

  /* COM1 click region — opens/closes the COM panel overlay */
  const comW = w * 0.28;
  if (comOpen) {
    ctx.fillStyle = 'rgba(100,160,255,0.10)';
    ctx.fillRect(x, y, comW, h);
  }
  _swHits.push({ x, y, w: comW, h, action: () => setState({ comPanelVisible: !S.comPanelVisible }) });

  ctx.fillStyle = G.dim;
  ctx.font = `${fs * 0.8}px ${MONO}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(com.title ?? 'COM1', x + w * 0.02, my - h * 0.16);
  ctx.fillStyle = comOpen ? G.cyan : G.white;
  ctx.font = `bold ${fs}px ${MONO}`;
  ctx.fillText(com.active ?? '---', x + w * 0.02, my + h * 0.14);

  ctx.fillStyle = G.cyan;
  ctx.font = `${fs * 0.8}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('⇌', x + w * 0.17, my);
  ctx.fillStyle = G.dim;
  ctx.fillText(com.standby ?? '---', x + w * 0.24, my + h * 0.1);

  /* Centre — elapsed time */
  const mm = String(Math.floor((S.time ?? 0) / 60)).padStart(2, '0');
  const ss = String(Math.floor((S.time ?? 0) % 60)).padStart(2, '0');
  ctx.fillStyle = G.white;
  ctx.font = `${fs}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${mm}:${ss}`, x + w * 0.5, my);

  /* NAV1 */
  ctx.fillStyle = G.dim;
  ctx.font = `${fs * 0.8}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText('NAV1', x + w * 0.98, my - h * 0.16);
  ctx.fillStyle = G.white;
  ctx.font = `bold ${fs}px ${MONO}`;
  ctx.fillText('109.90', x + w * 0.98, my + h * 0.14);

  /* bottom rule */
  ctx.strokeStyle = '#2a2e3a'; ctx.lineWidth = 1;
  _line(ctx, x, y + h - 1, x + w, y + h - 1);
}

function _ai(ctx, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pitch = S.pitch ?? 0;
  const roll  = S.roll  ?? 0;
  const pxPD  = h / 44;   /* pixels per degree — 22° visible each side */

  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate(-roll * Math.PI / 180);
  ctx.translate(-cx, -cy);

  const hy = cy + pitch * pxPD;

  /* Sky */
  const skyG = ctx.createLinearGradient(0, hy - h * 0.5, 0, hy);
  skyG.addColorStop(0, '#1a3e80'); skyG.addColorStop(1, '#4a80c8');
  ctx.fillStyle = skyG;
  ctx.fillRect(x - w, y - h, w * 3, (hy - (y - h)) + 1);

  /* Ground */
  const gndG = ctx.createLinearGradient(0, hy, 0, hy + h * 0.6);
  gndG.addColorStop(0, '#7a4e28'); gndG.addColorStop(1, '#3e2208');
  ctx.fillStyle = gndG;
  ctx.fillRect(x - w, hy, w * 3, h * 2);

  /* Horizon line */
  ctx.strokeStyle = G.white; ctx.lineWidth = 2;
  _line(ctx, x - w, hy, x + w * 2, hy);

  /* Pitch ladder */
  ctx.font = `${Math.round(w * 0.042)}px ${MONO}`;
  ctx.textBaseline = 'middle';
  for (let p = -30; p <= 30; p += 5) {
    if (p === 0) continue;
    const py = hy - p * pxPD;
    if (py < y - 10 || py > y + h + 10) continue;
    const major = p % 10 === 0;
    const len   = major ? w * 0.22 : w * 0.10;
    ctx.strokeStyle = G.white;
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(cx - len, py); ctx.lineTo(cx + len, py); ctx.stroke();
    if (major) {
      ctx.fillStyle = G.white;
      ctx.textAlign = 'right';
      ctx.fillText(Math.abs(p), cx - len - 6, py);
      ctx.textAlign = 'left';
      ctx.fillText(Math.abs(p), cx + len + 6, py);
    }
  }

  ctx.restore();

  /* Bank arc (outside clip) */
  _bankArc(ctx, cx, y + h * 0.07, w * 0.42, roll);

  /* Aircraft symbol */
  const wl = w * 0.14;
  ctx.strokeStyle = G.amber; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - wl * 2.2, cy); ctx.lineTo(cx - wl * 0.5, cy);
  ctx.lineTo(cx - wl * 0.5, cy + wl * 0.32); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + wl * 2.2, cy); ctx.lineTo(cx + wl * 0.5, cy);
  ctx.lineTo(cx + wl * 0.5, cy + wl * 0.32); ctx.stroke();
  ctx.fillStyle = G.amber;
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
}

function _bankArc(ctx, cx, ay, r, roll) {
  ctx.strokeStyle = G.white; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, ay, r, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();

  [10, 20, 30, 45, 60].forEach(deg => {
    [-deg, deg].forEach(d => {
      const a   = (d - 90) * Math.PI / 180;
      const len = [30, 60].includes(Math.abs(d)) ? r * 0.10 : r * 0.06;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + r * Math.cos(a), ay + r * Math.sin(a));
      ctx.lineTo(cx + (r - len) * Math.cos(a), ay + (r - len) * Math.sin(a));
      ctx.stroke();
    });
  });

  /* Roll pointer */
  const pa = (-roll - 90) * Math.PI / 180;
  ctx.fillStyle = G.white;
  ctx.save();
  ctx.translate(cx + r * Math.cos(pa), ay + r * Math.sin(pa));
  ctx.rotate(pa + Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-5, -11); ctx.lineTo(5, -11);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function _speedTape(ctx, x, y, w, h) {
  const spd  = S.spd  ?? 0;
  const spdT = S.spdT ?? 0;
  const pxPK = h / 80;   /* pixels per knot — 80kt window */

  ctx.fillStyle = G.tape;
  ctx.fillRect(x, y, w, h);

  const cy = y + h / 2;

  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

  /* Speed bands (coloured stripe on left edge) */
  [
    [0,       V.Vs0, 'rgba(200,40,40,0.5)'],
    [V.Vs0,   V.Vs1, 'rgba(220,220,220,0.3)'],
    [V.Vs1,   V.Vno, 'rgba(40,200,70,0.35)'],
    [V.Vno,   V.Vne, 'rgba(255,200,0,0.35)'],
  ].forEach(([lo, hi, col]) => {
    const y1 = cy - (hi - spd) * pxPK;
    const y2 = cy - (lo - spd) * pxPK;
    if (y2 < y || y1 > y + h) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, Math.max(y, y1), w * 0.1, Math.min(y + h, y2) - Math.max(y, y1));
  });

  /* Major ticks + labels (every 10kt) */
  ctx.strokeStyle = G.white; ctx.fillStyle = G.white;
  ctx.font = `${Math.round(w * 0.21)}px ${MONO}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let s = Math.max(0, Math.floor((spd - 40) / 10) * 10); s <= spd + 40; s += 10) {
    const ty = cy - (s - spd) * pxPK;
    if (ty < y || ty > y + h) continue;
    ctx.lineWidth = 1.5;
    _line(ctx, x + w * 0.55, ty, x + w * 0.78, ty);
    ctx.fillText(s, x + w * 0.5, ty);
  }
  /* Minor ticks (5kt) */
  for (let s = Math.max(0, Math.floor((spd - 40) / 5) * 5); s <= spd + 40; s += 5) {
    if (s % 10 === 0) continue;
    const ty = cy - (s - spd) * pxPK;
    if (ty < y || ty > y + h) continue;
    ctx.lineWidth = 1;
    _line(ctx, x + w * 0.65, ty, x + w * 0.78, ty);
  }

  /* Vne red bar */
  const vneY = cy - (V.Vne - spd) * pxPK;
  if (vneY > y && vneY < y + h) {
    ctx.strokeStyle = G.red; ctx.lineWidth = 3;
    _line(ctx, x, vneY, x + w, vneY);
  }

  /* Speed bug */
  const bugY = cy - (spdT - spd) * pxPK;
  if (bugY > y && bugY < y + h) {
    ctx.fillStyle = G.magenta;
    ctx.beginPath();
    ctx.moveTo(x + w, bugY);
    ctx.lineTo(x + w * 0.68, bugY - 8);
    ctx.lineTo(x + w * 0.68, bugY + 8);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();

  /* Readout box */
  const bh = Math.round(h * 0.09);
  ctx.fillStyle = G.bg;
  ctx.fillRect(x, cy - bh / 2, w, bh);
  ctx.strokeStyle = G.white; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, cy - bh / 2, w, bh);
  ctx.fillStyle = G.white;
  ctx.font = `bold ${Math.round(bh * 0.62)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(spd), x + w / 2, cy);
  ctx.fillStyle = G.dim;
  ctx.font = `${Math.round(w * 0.17)}px ${MONO}`;
  ctx.fillText('KT', x + w / 2, y + h * 0.035);
}

function _altTape(ctx, x, y, w, h) {
  const alt  = S.alt  ?? 0;
  const altT = S.altT ?? 0;
  const vs   = S.vs   ?? 0;
  const pxPF = h / 1200;   /* pixels per foot — 1200ft window */

  ctx.fillStyle = G.tape;
  ctx.fillRect(x, y, w, h);

  const cy = y + h / 2;

  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

  /* Ticks every 100ft */
  ctx.strokeStyle = G.white; ctx.fillStyle = G.white;
  ctx.font = `${Math.round(w * 0.18)}px ${MONO}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let a = Math.floor((alt - 600) / 100) * 100; a <= alt + 600; a += 100) {
    const ty = cy - (a - alt) * pxPF;
    if (ty < y || ty > y + h || a < 0) continue;
    ctx.lineWidth = 1.5;
    _line(ctx, x + w * 0.22, ty, x + w * 0.45, ty);
    ctx.fillText(a, x + w * 0.48, ty);
  }
  /* Minor ticks 20ft */
  for (let a = Math.floor((alt - 600) / 20) * 20; a <= alt + 600; a += 20) {
    if (a % 100 === 0) continue;
    const ty = cy - (a - alt) * pxPF;
    if (ty < y || ty > y + h) continue;
    ctx.lineWidth = 1;
    _line(ctx, x + w * 0.22, ty, x + w * 0.33, ty);
  }

  /* Alt bug */
  const bugY = cy - (altT - alt) * pxPF;
  if (bugY > y && bugY < y + h) {
    ctx.fillStyle = G.magenta;
    ctx.beginPath();
    ctx.moveTo(x, bugY);
    ctx.lineTo(x + w * 0.3, bugY - 8);
    ctx.lineTo(x + w * 0.3, bugY + 8);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();

  /* Readout box */
  const bh = Math.round(h * 0.09);
  ctx.fillStyle = G.bg;
  ctx.fillRect(x, cy - bh / 2, w, bh);
  ctx.strokeStyle = G.white; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, cy - bh / 2, w, bh);
  ctx.fillStyle = G.white;
  ctx.font = `bold ${Math.round(bh * 0.55)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(alt), x + w / 2, cy);

  /* VSI */
  ctx.fillStyle = vs > 50 ? G.green : vs < -200 ? G.amber : G.dim;
  ctx.font = `${Math.round(w * 0.17)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText((vs >= 0 ? '+' : '') + Math.round(vs / 10) * 10, x + w / 2, y + h * 0.964);
  ctx.fillStyle = G.dim;
  ctx.font = `${Math.round(w * 0.17)}px ${MONO}`;
  ctx.fillText('FT', x + w / 2, y + h * 0.035);
}

function _ils(ctx, x, y, w, h) {
  if (!S.mission?.arrival?.ils) return;
  const loc = S.ilsLoc ?? 0;
  const gs  = S.ilsGs  ?? 0;
  const cx  = x + w / 2;
  const cy  = y + h / 2;
  const ds  = w * 0.055;   /* dot spacing */

  /* LOC dots */
  ctx.strokeStyle = 'rgba(232,240,248,0.28)'; ctx.lineWidth = 1;
  [-2, -1, 1, 2].forEach(d => {
    ctx.beginPath();
    ctx.arc(cx + d * ds * 2, cy + h * 0.3, 4, 0, Math.PI * 2);
    ctx.stroke();
  });
  /* LOC needle */
  const lx = cx + Math.max(-4, Math.min(4, -loc)) * ds * 2;
  ctx.strokeStyle = G.magenta; ctx.lineWidth = 3;
  _line(ctx, lx, cy + h * 0.3 - 14, lx, cy + h * 0.3 + 14);

  /* GS dots */
  ctx.strokeStyle = 'rgba(232,240,248,0.28)'; ctx.lineWidth = 1;
  [-2, -1, 1, 2].forEach(d => {
    ctx.beginPath();
    ctx.arc(cx + w * 0.36, cy + d * ds * 2, 4, 0, Math.PI * 2);
    ctx.stroke();
  });
  /* GS needle */
  const gy = cy + Math.max(-4, Math.min(4, -gs)) * ds * 2;
  ctx.strokeStyle = G.magenta; ctx.lineWidth = 3;
  _line(ctx, cx + w * 0.36 - 14, gy, cx + w * 0.36 + 14, gy);
}

function _hsi(ctx, x, y, w, h) {
  const hdg  = S.hdg  ?? 0;
  const hdgT = S.hdgT ?? 0;

  /* no background fill — renderG1000 handles it */

  const cx = x + w / 2;
  const cy = y + h * 0.54;
  const r  = Math.min(w * 0.27, h * 0.44);

  /* Compass rose */
  ctx.strokeStyle = G.white; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  for (let d = 0; d < 360; d += 5) {
    const a     = (d - hdg - 90) * Math.PI / 180;
    const major = d % 30 === 0;
    const len   = major ? r * 0.12 : r * 0.06;
    ctx.lineWidth = major ? 1.5 : 1;
    _line(ctx,
      cx + r * Math.cos(a), cy + r * Math.sin(a),
      cx + (r - len) * Math.cos(a), cy + (r - len) * Math.sin(a));
  }

  /* Cardinals */
  ctx.fillStyle = G.white;
  ctx.font = `bold ${Math.round(r * 0.18)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([lbl, deg]) => {
    const a  = (deg - hdg - 90) * Math.PI / 180;
    const lr = r * 0.78;
    ctx.fillText(lbl, cx + lr * Math.cos(a), cy + lr * Math.sin(a));
  });

  /* Heading bug */
  const ba = (hdgT - hdg - 90) * Math.PI / 180;
  ctx.fillStyle = G.magenta;
  ctx.save();
  ctx.translate(cx + r * Math.cos(ba), cy + r * Math.sin(ba));
  ctx.rotate(ba + Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, -14); ctx.lineTo(6, -14);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  /* Heading readout */
  const bw = r * 0.6; const bh = r * 0.22;
  ctx.fillStyle = G.bg;
  ctx.fillRect(cx - bw / 2, y + h * 0.04, bw, bh);
  ctx.strokeStyle = G.magenta; ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - bw / 2, y + h * 0.04, bw, bh);
  ctx.fillStyle = G.magenta;
  ctx.font = `bold ${Math.round(bh * 0.65)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(hdg) % 360).padStart(3, '0') + '°', cx, y + h * 0.04 + bh / 2);

  /* Centre plane symbol */
  ctx.strokeStyle = G.white; ctx.lineWidth = 2;
  _line(ctx, cx, cy - r * 0.15, cx, cy + r * 0.15);
  _line(ctx, cx - r * 0.15, cy, cx + r * 0.15, cy);

  /* Flap indicator — bottom-right of HSI, outside compass rose */
  const flaps_arr = S.aircraft?.flaps ?? [];
  if (flaps_arr.length > 1) {
    const fi  = S.flaps ?? 0;
    const fp  = flaps_arr[fi];
    const lbl = fi === 0 ? 'UP' : (fp?.deg !== undefined ? fp.deg + '°' : fp?.label ?? 'DN');
    const dep = fi > 0;
    const bw  = r * 0.62;
    const bh  = r * 0.32;
    const bx  = x + w - bw - r * 0.06;
    const by  = y + h - bh - h * 0.04;
    ctx.fillStyle = dep ? 'rgba(255,183,77,0.12)' : 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = dep ? G.amber : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = G.dim;
    ctx.font = `${Math.round(bh * 0.30)}px ${MONO}`;
    ctx.fillText('FLPS', bx + bw / 2, by + bh * 0.30);
    ctx.fillStyle = dep ? G.amber : G.white;
    ctx.font = `bold ${Math.round(bh * 0.56)}px ${MONO}`;
    ctx.fillText(lbl, bx + bw / 2, by + bh * 0.72);
  }
}

/* ══════════════════════════════════════════
   MFD
   ══════════════════════════════════════════ */

function _mfd(ctx, canvas, x, y, w, h) {
  const eisW = Math.round(w * 0.22);   /* EIS strip left, map right — matches real G1000 */
  _engineStrip(ctx, x, y, eisW, h);

  /* Divider */
  ctx.fillStyle = G.bezel;
  ctx.fillRect(x + eisW, y, 2, h);

  updateG1000MapOverlay(canvas, x + eisW + 2, y, w - eisW - 2, h);
}

function _engineStrip(ctx, x, y, w, h) {
  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 163;
  const throttle = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  const _engOff  = S.engineState === 'off' || S.engineState === 'shutdown';
  const ePow     = _engOff ? 0 : (S.enginePower ?? 1.0);
  const rpm      = ePow <= 0 ? 0 : Math.round((700 + 2000 * throttle) * ePow);
  const rpmText  = ePow <= 0 ? '---' : rpm.toString();
  const warns    = S.warnings ?? {};

  ctx.fillStyle = G.panel;
  ctx.fillRect(x, y, w, h);

  /* ── RPM arc (top ~22% of strip height) ── */
  const arcR  = Math.min(w * 0.32, h * 0.10);
  const arcCx = x + w / 2;
  const arcCy = y + h * 0.11;
  _arcGauge(ctx, arcCx, arcCy, arcR, rpm, 0, 2700, 'RPM', rpmText, [
    [0,    2500, G.green],
    [2500, 2700, G.amber],
  ]);

  /* ── 6 bar gauges (middle ~44%) ── */
  const oil_t    = Math.min(230, 60 + Math.min(1, (S.time ?? 0) / 240) * 160);
  const oil_p    = ePow < 0.3 ? 0 : 68 + throttle * 12;
  const tanks    = S.aircraft?.tanks;
  const maxGal   = (tanks?.left ?? 95) / 3.785;
  const fuelLgal = (S.fuelLeft  ?? 0) / 3.785;
  const fuelRgal = (S.fuelRight ?? 0) / 3.785;
  const lowL     = fuelLgal < maxGal * 0.08;
  const lowR     = fuelRgal < maxGal * 0.08;
  const egt      = 900 + throttle * 500;
  const cht      = 250 + throttle * 160;

  const gauges = [
    { label: 'OIL °F',  val: oil_t,    min: 50,       max: 260,    text: String(Math.round(oil_t)),  bands: [[50,100,G.amber],[100,220,G.green],[220,260,G.red]],                                    alert: null },
    { label: 'OIL PSI', val: oil_p,    min: 0,        max: 100,    text: String(Math.round(oil_p)),  bands: [[0,25,G.red],[25,55,G.amber],[55,90,G.green],[90,100,G.red]],                           alert: null },
    { label: 'FUEL L',  val: fuelLgal, min: 0,        max: maxGal, text: fuelLgal.toFixed(1),        bands: [[0,maxGal*0.08,G.red],[maxGal*0.08,maxGal*0.16,G.amber],[maxGal*0.16,maxGal,G.green]], alert: lowL ? G.red : null },
    { label: 'FUEL R',  val: fuelRgal, min: 0,        max: maxGal, text: fuelRgal.toFixed(1),        bands: [[0,maxGal*0.08,G.red],[maxGal*0.08,maxGal*0.16,G.amber],[maxGal*0.16,maxGal,G.green]], alert: lowR ? G.red : null },
    { label: 'EGT °F',  val: egt,      min: 0,        max: 1600,   text: String(Math.round(egt)),    bands: [[0,800,G.dim],[800,1450,G.green],[1450,1600,G.red]],                                    alert: null },
    { label: 'CHT °F',  val: cht,      min: 0,        max: 500,    text: String(Math.round(cht)),    bands: [[0,100,G.dim],[100,400,G.green],[400,500,G.red]],                                        alert: null },
  ];

  const gaugeTop = y + h * 0.23;
  const gaugeH   = h * 0.43;
  const rowH     = gaugeH / gauges.length;
  const gbx      = x + 4;
  const gbw      = w - 8;

  gauges.forEach((g, i) => {
    _barGauge(ctx, gbx, gaugeTop + i * rowH + rowH * 0.08, gbw, rowH * 0.84,
              g.val, g.min, g.max, g.label, g.text, g.bands, g.alert);
  });

  /* ── Fuel selector (compact, lower quarter) ── */
  _fuelSelectorCompact(ctx, x, y + h * 0.68, w, h * 0.16);

  /* ── Caution annunciators (bottom strip) ── */
  const cautY    = y + h * 0.85;
  const cautH    = h * 0.14;
  const cautions = [
    { label: 'LOW FUEL',  active: warns.LOW_FUEL,                  color: G.amber },
    { label: 'OIL PRESS', active: warns.OIL_PRESS,                 color: G.red   },
    { label: 'FUEL SEL',  active: warns.FUEL_SEL_OFF,              color: G.amber },
    { label: 'CARB ICE',  active: (S.carbIceLevel ?? 0) > 0.15,    color: G.amber },
  ];
  const cw = (gbw - 4) / 2;
  const ch = cautH / 2 - 2;
  cautions.forEach((c, i) => {
    const cx = gbx + (i % 2) * (cw + 4);
    const cy = cautY + Math.floor(i / 2) * (ch + 2);
    ctx.fillStyle    = c.active ? c.color : 'rgba(255,255,255,0.08)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle    = c.active ? '#000' : 'rgba(255,255,255,0.25)';
    ctx.font         = `bold ${Math.round(ch * 0.52)}px ${MONO}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.label, cx + cw / 2, cy + ch / 2);
  });
}

function _fuelSelectorCompact(ctx, x, y, w, h) {
  const sel    = S.fuelSelector ?? 'BOTH';
  const angles = { LEFT: -60, BOTH: 0, RIGHT: 60, OFF: 180 };

  const kR  = Math.min(w * 0.28, h * 0.28);
  const kCx = x + w / 2;
  const kCy = y + h * 0.46;

  ctx.fillStyle    = G.dim;
  ctx.font         = `${Math.round(h * 0.13)}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('FUEL SEL', kCx, y + h * 0.03);

  ctx.beginPath();
  ctx.arc(kCx, kCy, kR, 0, Math.PI * 2);
  ctx.fillStyle   = '#1a1e26';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  const pAng = (angles[sel] - 90) * Math.PI / 180;
  ctx.strokeStyle = sel === 'OFF' ? G.red : G.green;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(kCx, kCy);
  ctx.lineTo(kCx + Math.cos(pAng) * kR * 0.78, kCy + Math.sin(pAng) * kR * 0.78);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(kCx, kCy, kR * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = G.white;
  ctx.fill();

  ctx.fillStyle    = sel === 'OFF' ? G.red : G.white;
  ctx.font         = `bold ${Math.round(h * 0.15)}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sel, kCx, y + h * 0.82);

  ctx.fillStyle    = 'rgba(255,255,255,0.15)';
  ctx.font         = `${Math.round(h * 0.10)}px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('[Q]', kCx, y + h * 0.98);
}

/* ══════════════════════════════════════════
   Switch panel
   ══════════════════════════════════════════ */

const _MAG_CYCLE = ['OFF', 'R', 'L', 'BOTH', 'START'];

function _switchPanel(ctx, x, y, w, h) {
  _swHits = [];

  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1e2028'; ctx.lineWidth = 2;
  _line(ctx, x + w - 1, y, x + w - 1, y + h);   /* right edge separator */

  const li   = S.lights ?? {};
  const swW  = Math.round(w * 0.40);   /* toggle width — fits two per row */
  const swH  = Math.round(h * 0.070);  /* toggle height */
  const cx1  = x + w * 0.28;
  const cx2  = x + w * 0.72;
  const rg   = h * 0.010;              /* row gap */

  const reg2 = (cx, sy, action) =>
    _swHits.push({ x: cx - swW / 2, y: sy, w: swW, h: swH, action });

  const secLabel = (text, ly) => {
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.font         = `${Math.round(h * 0.022)}px ${MONO}`;
    ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(text, x + w / 2, ly);
  };

  /* Start below MET clock (fixed at ~top:90px + ~80px height in CSS).
     h * 0.24 clears the clock on 768p–1440p at DPR 1–2. */
  let sy = y + h * 0.24;

  /* ── MASTER ── */
  secLabel('MASTER', sy); sy += h * 0.032;
  _toggleSwitch(ctx, cx1, sy, swW, swH, S.masterBat, 'BAT');
  reg2(cx1, sy, () => setState({ masterBat: !S.masterBat }));
  _toggleSwitch(ctx, cx2, sy, swW, swH, S.masterAlt, 'ALT');
  reg2(cx2, sy, () => setState({ masterAlt: !S.masterAlt }));
  sy += swH + rg * 2;

  /* ── AVIONICS ── */
  secLabel('AVIONICS', sy); sy += h * 0.032;
  _toggleSwitch(ctx, x + w / 2, sy, swW, swH, S.avionicsOn, 'AVNCS');
  _swHits.push({ x: x + w / 2 - swW / 2, y: sy, w: swW, h: swH,
                 action: () => setState({ avionicsOn: !S.avionicsOn }) });
  sy += swH + rg * 2;

  /* ── FUEL PUMP ── */
  secLabel('FUEL PUMP', sy); sy += h * 0.032;
  _toggleSwitch(ctx, x + w / 2, sy, swW, swH, S.fuelPump, 'PUMP');
  _swHits.push({ x: x + w / 2 - swW / 2, y: sy, w: swW, h: swH,
    action: () => {
      const next = !S.fuelPump;
      setState({ fuelPump: next });
      if (next) startFuelPump(); else stopFuelPump();
    }
  });
  sy += swH + rg * 2;

  /* ── MAGNETO ── */
  secLabel('MAGNETO', sy); sy += h * 0.032;
  const magR  = Math.min(w * 0.26, (h - sy) * 0.11);
  const magCx = x + w / 2;
  const magCy = sy + magR * 1.55;
  _magRotary(ctx, magCx, magCy, magR, S.magnetos ?? 'BOTH');
  _swHits.push({ x: magCx - magR * 1.6, y: sy, w: magR * 3.2, h: magR * 3.4,
    action: () => {
      const cur  = S.magnetos ?? 'OFF';
      const next = _MAG_CYCLE[(_MAG_CYCLE.indexOf(cur) + 1) % _MAG_CYCLE.length];
      setState({ magnetos: next });
      if (next === 'START') startEngineLifecycle();
      if (next === 'OFF')   stopEngineLifecycle();
    }
  });
  sy = magCy + magR * 1.55 + rg * 2;

  /* ── LIGHTS ── */
  secLabel('LIGHTS', sy); sy += h * 0.032;
  _toggleSwitch(ctx, cx1, sy, swW, swH, li.nav,    'NAV');
  reg2(cx1, sy, () => setState({ lights: { ...S.lights, nav:    !li.nav    } }));
  _toggleSwitch(ctx, cx2, sy, swW, swH, li.beacon, 'BCN');
  reg2(cx2, sy, () => setState({ lights: { ...S.lights, beacon: !li.beacon } }));
  sy += swH + rg;
  _toggleSwitch(ctx, cx1, sy, swW, swH, li.strobe,  'STRB');
  reg2(cx1, sy, () => setState({ lights: { ...S.lights, strobe:  !li.strobe  } }));
  _toggleSwitch(ctx, cx2, sy, swW, swH, li.landing, 'LAND');
  reg2(cx2, sy, () => setState({ lights: { ...S.lights, landing: !li.landing } }));
}

function _toggleSwitch(ctx, cx, y, w, h, on, label) {
  /* Housing (recessed dark plate) */
  const hw = w * 0.60, hh = h * 0.38;
  const hx = cx - hw / 2, hy = y + h * 0.18;
  _roundRect(ctx, hx, hy, hw, hh, hw * 0.14);
  ctx.fillStyle = '#0c1018'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.8; ctx.stroke();

  /* Lever — thin bat-handle: UP = ON, DOWN = OFF */
  const lw = hw * 0.30, lh = h * 0.44;
  const pvY = hy + hh * 0.50;
  const levY = on ? pvY - lh : pvY;
  _roundRect(ctx, cx - lw / 2, levY, lw, lh, lw * 0.30);
  ctx.fillStyle = on ? '#9eaabf' : '#2c3038'; ctx.fill();

  /* Lever highlight */
  ctx.fillStyle = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.04)';
  ctx.fillRect(cx - lw / 2 + lw * 0.14, levY + lh * 0.12, lw * 0.26, lh * 0.76);

  /* LED indicator dot below housing */
  const dotR = Math.min(hw, hh) * 0.12;
  const dotY = hy + hh + dotR * 2.0;
  ctx.beginPath(); ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#38d060' : '#101810'; ctx.fill();
  if (on) {
    ctx.beginPath(); ctx.arc(cx, dotY, dotR * 1.9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56,208,96,0.22)'; ctx.lineWidth = dotR * 0.8; ctx.stroke();
  }

  /* Label */
  ctx.fillStyle    = on ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.24)';
  ctx.font         = `${Math.round(Math.min(w * 0.46, h * 0.115))}px ${MONO}`;
  ctx.textAlign    = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(label, cx, y + h);
}

function _magRotary(ctx, cx, cy, r, state) {
  const pos = { OFF: -120, R: -60, L: 0, BOTH: 60, START: 120 };

  /* outer plate */
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1016'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();

  /* position labels */
  Object.entries(pos).forEach(([p, deg]) => {
    const a  = (deg - 90) * Math.PI / 180;
    const mr = r * 1.28;
    ctx.fillStyle    = p === state ? G.white : 'rgba(255,255,255,0.30)';
    ctx.font         = `${Math.round(r * 0.30)}px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p, cx + Math.cos(a) * mr, cy + Math.sin(a) * mr);
  });

  /* knob */
  const kg = ctx.createRadialGradient(cx - r * 0.24, cy - r * 0.24, r * 0.06, cx, cy, r);
  kg.addColorStop(0, '#2c3040');
  kg.addColorStop(1, '#141820');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = kg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();

  /* knurling */
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
  }

  /* pointer */
  const pAng = ((pos[state] ?? 0) - 90) * Math.PI / 180;
  ctx.strokeStyle = state === 'OFF' ? G.red : state === 'START' ? G.amber : G.white;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(pAng) * r * 0.76, cy + Math.sin(pAng) * r * 0.76);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = G.white; ctx.fill();

  /* label */
  ctx.fillStyle = G.dim; ctx.font = `${Math.round(r * 0.30)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('MAG', cx, cy + r * 1.62);
}

/* ── Screen bezel frame ── */
function _screenBezel(ctx, x, y, w, h) {
  ctx.fillStyle = '#1c1e26';
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font      = `bold ${Math.round(h * 0.026)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('GARMIN', x + w / 2, y + h * 0.023);

  ctx.strokeStyle = '#08090c'; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

/* ── Backup instruments strip ── */
function _backupGauges(ctx, x, y, w, h) {
  ctx.fillStyle = '#0e1018';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#282c38'; ctx.lineWidth = 1;
  _line(ctx, x, y, x + w, y);

  const r   = h * 0.40;
  const cy  = y + h / 2;
  _analogASI(ctx,   x + w * 0.20, cy, r);
  _analogAI(ctx,    x + w * 0.50, cy, r);
  _analogALT(ctx,   x + w * 0.80, cy, r);
}

function _analogASI(ctx, cx, cy, r) {
  const spd = S.spd ?? 0;
  const s0  = Math.PI * (4 / 3);
  const rng = Math.PI * 1.5;
  const ang = v => s0 + (Math.max(0, Math.min(200, v)) / 200) * rng;

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0c12'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = r * 0.04; ctx.stroke();

  /* coloured arcs */
  const arcs = [
    [V.Vs0, V.Vfe, '#d8d8d8'],
    [V.Vs1, V.Vno, G.green],
    [V.Vno, V.Vne, G.amber],
  ];
  ctx.lineWidth = r * 0.09;
  arcs.forEach(([lo, hi, col]) => {
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, ang(lo), ang(hi)); ctx.stroke();
  });
  const vneA = ang(V.Vne);
  ctx.strokeStyle = G.red; ctx.lineWidth = r * 0.04;
  _line(ctx, cx + r*0.73*Math.cos(vneA), cy + r*0.73*Math.sin(vneA),
             cx + r*0.90*Math.cos(vneA), cy + r*0.90*Math.sin(vneA));

  /* ticks */
  for (let v = 0; v <= 200; v += 20) {
    const a = ang(v); const major = v % 40 === 0;
    ctx.strokeStyle = G.white; ctx.lineWidth = major ? r * 0.025 : r * 0.015;
    _line(ctx, cx+(major?r*0.66:r*0.74)*Math.cos(a), cy+(major?r*0.66:r*0.74)*Math.sin(a),
               cx+r*0.88*Math.cos(a),                cy+r*0.88*Math.sin(a));
    if (major && v > 0) {
      ctx.fillStyle = G.white; ctx.font = `${Math.round(r*0.14)}px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v, cx + r*0.54*Math.cos(a), cy + r*0.54*Math.sin(a));
    }
  }

  /* needle */
  const na = ang(spd);
  ctx.strokeStyle = G.white; ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx - r*0.14*Math.cos(na), cy - r*0.14*Math.sin(na));
  ctx.lineTo(cx + r*0.78*Math.cos(na), cy + r*0.78*Math.sin(na));
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r*0.08, 0, Math.PI*2);
  ctx.fillStyle = '#b0b4be'; ctx.fill();

  ctx.fillStyle = G.dim; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('KIAS', cx, cy + r * 0.40);
}

function _analogAI(ctx, cx, cy, r) {
  const pitch = S.pitch ?? 0;
  const roll  = S.roll  ?? 0;
  const pxPD  = r / 22;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2); ctx.clip();

  ctx.translate(cx, cy); ctx.rotate(-roll * Math.PI / 180); ctx.translate(-cx, -cy);

  const hy = cy + pitch * pxPD;
  const skyG = ctx.createLinearGradient(0, hy - r, 0, hy);
  skyG.addColorStop(0, '#1a3e80'); skyG.addColorStop(1, '#4a80c8');
  ctx.fillStyle = skyG; ctx.fillRect(cx - r, cy - r, r*2, hy-(cy-r)+1);
  const gndG = ctx.createLinearGradient(0, hy, 0, hy + r);
  gndG.addColorStop(0, '#7a4e28'); gndG.addColorStop(1, '#3e2208');
  ctx.fillStyle = gndG; ctx.fillRect(cx - r, hy, r*2, r*2);
  ctx.strokeStyle = G.white; ctx.lineWidth = r * 0.025;
  _line(ctx, cx - r, hy, cx + r, hy);

  for (let p of [-20, -10, 10, 20]) {
    const py = hy - p * pxPD; if (py < cy-r || py > cy+r) continue;
    const len = r * (Math.abs(p) === 20 ? 0.24 : 0.16);
    ctx.lineWidth = r * 0.018;
    _line(ctx, cx - len, py, cx + len, py);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = r * 0.04;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2); ctx.stroke();

  const wl = r * 0.20;
  ctx.strokeStyle = G.amber; ctx.lineWidth = r * 0.035;
  ctx.beginPath(); ctx.moveTo(cx-wl*1.8,cy); ctx.lineTo(cx-wl*0.4,cy);
  ctx.lineTo(cx-wl*0.4, cy+wl*0.28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+wl*1.8,cy); ctx.lineTo(cx+wl*0.4,cy);
  ctx.lineTo(cx+wl*0.4, cy+wl*0.28); ctx.stroke();

  ctx.fillStyle = G.dim; ctx.font = `${Math.round(r*0.16)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('ATT', cx, cy + r * 0.94);
}

function _analogALT(ctx, cx, cy, r) {
  const alt = S.alt ?? 0;
  const s0  = Math.PI * (4 / 3);
  const rng = Math.PI * 1.5;

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0c12'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = r * 0.04; ctx.stroke();

  /* 10 major ticks (each = 1000ft per rev) */
  for (let i = 0; i <= 50; i++) {
    const a = s0 + (i / 50) * rng; const major = i % 5 === 0;
    ctx.strokeStyle = G.white; ctx.lineWidth = major ? r * 0.025 : r * 0.015;
    _line(ctx, cx+(major?r*0.66:r*0.76)*Math.cos(a), cy+(major?r*0.66:r*0.76)*Math.sin(a),
               cx+r*0.88*Math.cos(a),                cy+r*0.88*Math.sin(a));
    if (major) {
      ctx.fillStyle = G.white; ctx.font = `${Math.round(r*0.14)}px ${MONO}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((i / 5) % 10, cx + r*0.54*Math.cos(a), cy + r*0.54*Math.sin(a));
    }
  }

  /* thousands needle (1 rev = 10 000 ft) */
  const bigA = s0 + ((alt % 10000) / 10000) * rng;
  ctx.strokeStyle = G.white; ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx - r*0.12*Math.cos(bigA), cy - r*0.12*Math.sin(bigA));
  ctx.lineTo(cx + r*0.68*Math.cos(bigA), cy + r*0.68*Math.sin(bigA)); ctx.stroke();

  /* hundreds needle (1 rev = 1 000 ft) */
  const smlA = s0 + ((alt % 1000) / 1000) * rng;
  ctx.strokeStyle = G.white; ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx - r*0.14*Math.cos(smlA), cy - r*0.14*Math.sin(smlA));
  ctx.lineTo(cx + r*0.82*Math.cos(smlA), cy + r*0.82*Math.sin(smlA)); ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, cy, r*0.08, 0, Math.PI*2);
  ctx.fillStyle = '#b0b4be'; ctx.fill();

  ctx.fillStyle = G.dim; ctx.font = `${Math.round(r*0.15)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ALT  FT', cx, cy + r * 0.40);
}

/* ── Arc gauge (RPM) ── */
function _arcGauge(ctx, cx, cy, r, val, min, max, label, text, bands) {
  const s0 = Math.PI * 0.75;
  const s1 = Math.PI * 2.25;
  const rng = s1 - s0;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = r * 0.18;
  ctx.beginPath(); ctx.arc(cx, cy, r, s0, s1); ctx.stroke();

  bands.forEach(([lo, hi, col]) => {
    const a0 = s0 + (lo - min) / (max - min) * rng;
    const a1 = s0 + (hi - min) / (max - min) * rng;
    ctx.strokeStyle = col; ctx.lineWidth = r * 0.14;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  });

  const va = s0 + (Math.max(min, Math.min(max, val)) - min) / (max - min) * rng;
  ctx.strokeStyle = G.white; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.82 * Math.cos(va), cy + r * 0.82 * Math.sin(va));
  ctx.stroke();
  ctx.fillStyle = G.white;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.07, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = G.white;
  ctx.font = `bold ${Math.round(r * 0.28)}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + r * 0.32);
  ctx.fillStyle = G.dim;
  ctx.font = `${Math.round(r * 0.21)}px ${MONO}`;
  ctx.fillText(label, cx, cy + r * 0.6);
}

/* ── Bar gauge ── */
function _barGauge(ctx, x, y, w, h, val, min, max, label, text, bands, labelColor) {
  const fs = Math.round(h * 0.88);
  const lw = w * 0.42;

  ctx.fillStyle = labelColor ?? G.dim;
  ctx.font = `${fs * 0.72}px ${MONO}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + h / 2);

  const bx = x + lw + 4;
  const bw = w - lw - 36;
  const bh = h * 0.55;
  const by = y + (h - bh) / 2;

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(bx, by, bw, bh);

  const frac = Math.max(0, Math.min(1, (val - min) / (max - min)));
  let col = G.green;
  for (const [lo, hi, c] of bands) { if (val >= lo && val < hi) { col = c; break; } }
  ctx.fillStyle = col;
  ctx.fillRect(bx, by, bw * frac, bh);

  ctx.fillStyle = G.white;
  ctx.font = `bold ${fs * 0.82}px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(text, x + w, y + h / 2);
}

/* ── Util ── */
function _line(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x,     y + h, x,     y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
