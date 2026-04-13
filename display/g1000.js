/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/g1000.js
   Garmin G1000 glass cockpit — C172 / piston aircraft.
   PFD (left 62%): attitude · tapes · HSI · ILS
   MFD (right 38%): engine strip · moving map
   ═══════════════════════════════════════════════════════════════ */

import { S }                  from '../core/state.js';
import { renderEmbeddedMap }  from './map.js';

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

  const pfdW = Math.round(W * 0.62);
  _pfd(ctx, 0, 0, pfdW, H);
  _mfd(ctx, pfdW + 3, 0, W - pfdW - 3, H);

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
  /* no background fill — renderG1000 handles it */

  const fs = Math.round(h * 0.34);
  const my = y + h / 2;

  /* COM1 */
  ctx.fillStyle = G.dim;
  ctx.font = `${fs * 0.8}px ${MONO}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('COM1', x + w * 0.02, my - h * 0.16);
  ctx.fillStyle = G.white;
  ctx.font = `bold ${fs}px ${MONO}`;
  ctx.fillText('121.750', x + w * 0.02, my + h * 0.14);

  ctx.fillStyle = G.cyan;
  ctx.font = `${fs * 0.8}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('⇌', x + w * 0.17, my);
  ctx.fillStyle = G.dim;
  ctx.fillText('121.900', x + w * 0.24, my + h * 0.1);

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
}

/* ══════════════════════════════════════════
   MFD
   ══════════════════════════════════════════ */

function _mfd(ctx, x, y, w, h) {
  const engW = Math.round(w * 0.38);
  _engineStrip(ctx, x, y, engW, h);

  /* Moving map */
  renderEmbeddedMap(ctx, x + engW, y, w - engW, h);
}

function _engineStrip(ctx, x, y, w, h) {
  /* no background fill */

  /* RPM */
  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 163;
  const throttle = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  const ePow     = Math.max(0.05, S.enginePower ?? 1.0);
  const rpm      = Math.round((700 + 2000 * throttle) * ePow);

  const arcCx = x + w / 2;
  const arcCy = y + h * 0.18;
  const arcR  = w * 0.36;
  _arcGauge(ctx, arcCx, arcCy, arcR, rpm, 0, 2700, 'RPM', rpm.toString(), [
    [0,    1700, G.green],
    [1700, 2500, G.green],
    [2500, 2700, G.amber],
  ]);

  /* Bar gauges */
  const bx = x + w * 0.08;
  const bw = w * 0.84;
  const bh = h * 0.048;
  const gap = h * 0.075;
  let gy = y + h * 0.38;

  const oil_t = Math.min(230, 60 + Math.min(1, (S.time ?? 0) / 240) * 160);
  _barGauge(ctx, bx, gy, bw, bh, oil_t, 50, 260, 'OIL °F', Math.round(oil_t), [
    [50, 100, G.amber], [100, 220, G.green], [220, 260, G.red],
  ]); gy += gap;

  const oil_p = 68 + throttle * 12;
  _barGauge(ctx, bx, gy, bw, bh, oil_p, 0, 100, 'OIL PSI', Math.round(oil_p), [
    [0, 25, G.red], [25, 55, G.amber], [55, 90, G.green], [90, 100, G.red],
  ]); gy += gap;

  const burn  = (S.time ?? 0) / 3600 * 8;   /* 8 gph */
  const fuelL = Math.max(0, 20 - burn / 2);
  const fuelR = Math.max(0, 20 - burn / 2);
  _barGauge(ctx, bx, gy, bw, bh, fuelL, 0, 25, 'FUEL L', fuelL.toFixed(1), [
    [0, 4, G.red], [4, 8, G.amber], [8, 25, G.green],
  ]); gy += gap;
  _barGauge(ctx, bx, gy, bw, bh, fuelR, 0, 25, 'FUEL R', fuelR.toFixed(1), [
    [0, 4, G.red], [4, 8, G.amber], [8, 25, G.green],
  ]); gy += gap;

  const egt = 900 + throttle * 500;
  _barGauge(ctx, bx, gy, bw, bh, egt, 0, 1600, 'EGT °F', Math.round(egt), [
    [0, 800, G.dim], [800, 1450, G.green], [1450, 1600, G.red],
  ]); gy += gap;

  const cht = 250 + throttle * 160;
  _barGauge(ctx, bx, gy, bw, bh, cht, 0, 500, 'CHT °F', Math.round(cht), [
    [0, 100, G.dim], [100, 400, G.green], [400, 500, G.red],
  ]);
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
function _barGauge(ctx, x, y, w, h, val, min, max, label, text, bands) {
  const fs = Math.round(h * 0.88);
  const lw = w * 0.42;

  ctx.fillStyle = G.dim;
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
