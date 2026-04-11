/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/f4u1a.js
   Vought F4U-1A Corsair instrument panel.

   Aesthetic: flat black US Navy panel · white dials · white needles
   Pacific atmosphere — Bougainville 1943, 15,000 ft, clear.
   English labels, US units (kt, ft, fpm, °F, PSI, in.Hg).

   Units — sim state is always knots / feet / fpm:
     speed    → kt    (no conversion)
     altitude → ft    (no conversion)
     vs       → fpm   (no conversion)
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';

/* ── Palette ── */
const P = {
  panel:   '#111314',    // flat black — US Navy instrument panel
  rim:     '#0a0b0c',    // bezel — blackened steel
  face0:   '#f8f8f8',    // dial face centre — bright white
  face1:   '#dcdcdc',    // dial face edge
  needle:  '#f0f0e8',    // white needle
  ndlBack: '#1e2020',    // counterweight — dark
  mark:    '#1a1a1a',    // index marks & numerals — near-black
  subdued: '#666666',    // secondary label — grey
  shadow:  'rgba(0,0,0,0.72)',
};

/* ── Fonts ── */
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ── Angle helper ── */
const _r = d => (d - 90) * Math.PI / 180;

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderF4U1A(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  /* Panel */
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, 0, W, H);

  /* Vignette */
  const vg = ctx.createRadialGradient(W/2, H/2, H*0.18, W/2, H/2, H*0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const sc = Math.min(W, H) / 860;
  const cx = W / 2;
  const cy = H / 2;

  const cw = 195 * sc;
  const rh = 205 * sc;
  const r1 = 90  * sc;
  const r2 = 60  * sc;

  const y1 = cy - rh * 0.85;
  const y2 = cy + rh * 0.15;
  const y3 = cy + rh * 1.05;

  _drawAirspeed(   ctx, cx - cw, y1, r1, sc);
  _drawHorizon(    ctx, cx,      y1, r1, sc);
  _drawAltimeter(  ctx, cx + cw, y1, r1, sc);

  _drawTurnSlip(   ctx, cx - cw, y2, r1 * 0.85, sc);
  _drawCompass(    ctx, cx,      y2, r1 * 0.85, sc);
  _drawVSI(        ctx, cx + cw, y2, r1 * 0.85, sc);

  _drawManifold(   ctx, cx - cw * 0.62, y3, r2, sc);
  _drawOilTemp(    ctx, cx,             y3, r2, sc);
  _drawOilPressure(ctx, cx + cw * 0.62, y3, r2, sc);

  /* Paused */
  if (S.paused) {
    ctx.fillStyle = 'rgba(240,200,80,0.92)';
    ctx.font = `bold ${14 * sc}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('PAUSE  [P]', cx, cy + rh * 1.68);
  }

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   INSTRUMENT BASE — black bezel + white face
   ════════════════════════════════════════════════════════════ */
function _base(ctx, x, y, r) {
  /* Drop shadow */
  const sh = ctx.createRadialGradient(x + r*0.06, y + r*0.06, r*0.6, x, y, r*1.2);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.80)');
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.arc(x, y, r * 1.18, 0, Math.PI*2); ctx.fill();

  /* Bezel */
  ctx.beginPath(); ctx.arc(x, y, r * 1.04, 0, Math.PI*2);
  ctx.fillStyle = P.rim; ctx.fill();

  /* Inner ring */
  ctx.beginPath(); ctx.arc(x, y, r * 1.0, 0, Math.PI*2);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke();

  /* White face */
  const face = ctx.createRadialGradient(x - r*0.08, y - r*0.10, r*0.04, x, y, r);
  face.addColorStop(0,    '#ffffff');
  face.addColorStop(0.72, P.face0);
  face.addColorStop(1,    P.face1);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = face; ctx.fill();

  /* Glass glint */
  ctx.save();
  ctx.globalAlpha = 0.4;
  const gl = ctx.createRadialGradient(x - r*0.32, y - r*0.38, r*0.04, x - r*0.18, y - r*0.22, r*0.7);
  gl.addColorStop(0,   'rgba(255,255,255,0.18)');
  gl.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  gl.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/* Centre cap */
function _cap(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r,       0, Math.PI*2); ctx.fillStyle = '#222';    ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI*2); ctx.fillStyle = '#3a3a3a'; ctx.fill();
}

/* Needle — white body + dark counterweight */
function _needle(ctx, x, y, r, deg, fwd = 0.80, bck = 0.22, sc) {
  const a  = _r(deg);
  const aB = a + Math.PI;
  const w  = 2.0 * sc;
  const px = -Math.sin(a) * w;
  const py =  Math.cos(a) * w;
  const tx = x + Math.cos(a)  * r * fwd;
  const ty = y + Math.sin(a)  * r * fwd;
  const bx = x + Math.cos(aB) * r * bck;
  const by = y + Math.sin(aB) * r * bck;

  ctx.beginPath();
  ctx.moveTo(x + px*2.4, y + py*2.4);
  ctx.lineTo(bx + px*1.6, by + py*1.6);
  ctx.lineTo(bx - px*1.6, by - py*1.6);
  ctx.lineTo(x - px*2.4, y - py*2.4);
  ctx.closePath();
  ctx.fillStyle = P.ndlBack; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + px, y + py);
  ctx.lineTo(tx, ty);
  ctx.lineTo(x - px, y - py);
  ctx.closePath();
  ctx.fillStyle = P.needle; ctx.fill();
}

/* Tick marks */
function _ticks(ctx, x, y, r, startDeg, sweep, majCount, minPerMaj, sc) {
  const total = majCount * minPerMaj;
  for (let i = 0; i <= total; i++) {
    const deg  = startDeg + (i / total) * sweep;
    const a    = _r(deg);
    const maj  = i % minPerMaj === 0;
    const len  = maj ? r * 0.14 : r * 0.07;
    ctx.strokeStyle = P.mark;
    ctx.lineWidth   = maj ? 1.4 * sc : 0.75 * sc;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) *  r,       y + Math.sin(a) *  r);
    ctx.lineTo(x + Math.cos(a) * (r - len), y + Math.sin(a) * (r - len));
    ctx.stroke();
  }
}

/* Numeral at angle */
function _num(ctx, x, y, r, deg, text, sz, sc) {
  const a  = _r(deg);
  const nr = r * 0.70;
  ctx.font         = `bold ${sz * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = P.mark;
  ctx.fillText(text, x + Math.cos(a) * nr, y + Math.sin(a) * nr);
}

/* Sub-label inside dial */
function _sublabel(ctx, x, y, r, text, sc) {
  ctx.fillStyle    = P.subdued;
  ctx.font         = `${7.5 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y + r * 0.42);
}

/* Label below instrument */
function _label(ctx, x, y, r, name, sc) {
  ctx.fillStyle    = '#cccccc';
  ctx.font         = `${9.5 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, x, y + r * 1.28);
}

/* ════════════════════════════════════════════════════════════
   AIRSPEED — 0–400 kt
   ════════════════════════════════════════════════════════════ */
function _drawAirspeed(ctx, x, y, r, sc) {
  const spd  = S.spd ?? 0;
  const maxV = 400;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);

  /* Red arc ≥ 362 kt (VNE) */
  const aVne = _r(s0 + (362 / maxV) * sw);
  const aMax = _r(s0 + sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.96, aVne, aMax);
  ctx.strokeStyle = '#cc2200'; ctx.lineWidth = 5 * sc; ctx.stroke();
  ctx.restore();

  /* Yellow arc 200–250 kt (manoeuvre speed warning) */
  const aY0 = _r(s0 + (200 / maxV) * sw);
  const aY1 = _r(s0 + (250 / maxV) * sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.96, aY0, aY1);
  ctx.strokeStyle = '#cc9900'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _ticks(ctx, x, y, r, s0, sw, 8, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxV; v += 50) _num(ctx, x, y, r, s0 + (v / maxV) * sw, String(v), 8.5, sc);
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, 'kt', sc);

  const ang = s0 + Math.min(1, Math.max(0, spd / maxV)) * sw;
  _needle(ctx, x, y, r, ang, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, 'Airspeed', sc);
}

/* ════════════════════════════════════════════════════════════
   ARTIFICIAL HORIZON — Pacific atmosphere
   ════════════════════════════════════════════════════════════ */
function _drawHorizon(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);

  const pitch = S.pitch ?? 0;
  const roll  = S.roll  ?? 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll * Math.PI / 180);

  ctx.beginPath(); ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2); ctx.clip();

  const pitchPx = pitch * 2.6 * sc;

  /* Pacific sky — bright tropical blue */
  const skyG = ctx.createLinearGradient(0, -r, 0, pitchPx);
  skyG.addColorStop(0, '#2a6090');
  skyG.addColorStop(1, '#5090c8');
  ctx.fillStyle = skyG;
  ctx.fillRect(-r, -r * 1.2, r * 2, r * 1.2 + pitchPx);

  /* Pacific ocean */
  const seaG = ctx.createLinearGradient(0, pitchPx, 0, r);
  seaG.addColorStop(0,   '#1a5070');
  seaG.addColorStop(0.5, '#164060');
  seaG.addColorStop(1,   '#0a2030');
  ctx.fillStyle = seaG;
  ctx.fillRect(-r, pitchPx, r * 2, r * 1.2);

  /* Horizon line */
  ctx.strokeStyle = '#ffe080'; ctx.lineWidth = 1.8 * sc;
  ctx.beginPath(); ctx.moveTo(-r, pitchPx); ctx.lineTo(r, pitchPx); ctx.stroke();

  /* Pitch ladder */
  ctx.strokeStyle = 'rgba(255,220,80,0.65)'; ctx.lineWidth = 1.0 * sc;
  for (let d = -15; d <= 15; d += 5) {
    if (d === 0) continue;
    const py  = pitchPx - d * 2.6 * sc;
    const hw  = (Math.abs(d) % 10 === 0 ? 0.38 : 0.22) * r;
    ctx.beginPath(); ctx.moveTo(-hw, py); ctx.lineTo(hw, py); ctx.stroke();
  }

  ctx.restore();

  /* Fixed aircraft symbol */
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ffe080'; ctx.lineWidth = 2.8 * sc; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.56, 0); ctx.lineTo(-r * 0.20, 0); ctx.lineTo(-r * 0.10, r * 0.09);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r * 0.56, 0); ctx.lineTo(r * 0.20, 0); ctx.lineTo(r * 0.10, r * 0.09);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 2.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe080'; ctx.fill();
  ctx.restore();

  /* Roll scale */
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = P.mark; ctx.lineWidth = 1.0 * sc;
  for (const d of [-45, -30, -20, -10, 10, 20, 30, 45]) {
    const rad = _r(d);
    const len = (Math.abs(d) === 30 || Math.abs(d) === 45) ? r * 0.10 : r * 0.06;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * r * 0.97, Math.sin(rad) * r * 0.97);
    ctx.lineTo(Math.cos(rad) * (r * 0.97 - len), Math.sin(rad) * (r * 0.97 - len));
    ctx.stroke();
  }
  ctx.rotate(-roll * Math.PI / 180);
  ctx.strokeStyle = '#ffe080'; ctx.lineWidth = 2 * sc;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.87);
  ctx.lineTo(-5 * sc, -r * 0.97);
  ctx.lineTo( 5 * sc, -r * 0.97);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, 'Artificial Horizon', sc);
}

/* ════════════════════════════════════════════════════════════
   ALTIMETER — 0–35,000 ft
   Fine needle: 1 rev per 10,000 ft
   Coarse stub: 1 rev per 100,000 ft
   ════════════════════════════════════════════════════════════ */
function _drawAltimeter(ctx, x, y, r, sc) {
  const alt  = S.alt ?? 0;
  const s0   = 220, sw = 300;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 9; v++) {
    _num(ctx, x, y, r, s0 + (v / 10) * sw, String(v), 9, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, '×1000 ft', sc);

  /* Coarse stub — 10,000 ft revolutions */
  const angCoarse = s0 + ((alt / 100000) % 1) * sw;
  const ac = _r(angCoarse);
  ctx.strokeStyle = P.ndlBack; ctx.lineWidth = 2 * sc;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(ac) * r * 0.44, y + Math.sin(ac) * r * 0.44);
  ctx.stroke();

  /* Fine needle — 10,000 ft per revolution */
  const angFine = s0 + ((alt % 10000) / 10000) * sw;
  _needle(ctx, x, y, r, angFine, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, 'Altimeter', sc);
}

/* ════════════════════════════════════════════════════════════
   TURN & SLIP
   ════════════════════════════════════════════════════════════ */
function _drawTurnSlip(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);

  const arcR = r * 0.72;
  ctx.strokeStyle = P.mark; ctx.lineWidth = 1.0 * sc;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.12, arcR, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  for (const d of [-38, 0, 38]) {
    const dx = d * sc;
    ctx.beginPath();
    ctx.moveTo(x + dx, y - r * 0.78);
    ctx.lineTo(x + dx, y - r * 0.66);
    ctx.strokeStyle = P.mark; ctx.lineWidth = 1.2 * sc;
    ctx.stroke();
  }

  ctx.fillStyle = P.mark; ctx.font = `bold ${9 * sc}px ${SANS}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('L', x - r * 0.52, y - r * 0.48);
  ctx.fillText('R', x + r * 0.52, y - r * 0.48);

  const deflect = Math.max(-1, Math.min(1, (S.roll ?? 0) / 20));
  const nx = x + deflect * 38 * sc;
  ctx.strokeStyle = P.needle; ctx.lineWidth = 3 * sc; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(nx, y - r * 0.78);
  ctx.lineTo(nx, y + r * 0.05);
  ctx.stroke();

  const ballY = y + r * 0.58;
  ctx.strokeStyle = P.mark; ctx.lineWidth = 1.2 * sc;
  ctx.beginPath(); ctx.arc(x, ballY, 20 * sc, Math.PI, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, ballY, 6.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.strokeStyle = P.mark; ctx.lineWidth = 0.8 * sc; ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  _label(ctx, x, y, r, 'Turn & Slip', sc);
}

/* ════════════════════════════════════════════════════════════
   COMPASS — rotating rose, English cardinals
   ════════════════════════════════════════════════════════════ */
function _drawCompass(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);

  const hdg = S.hdg ?? 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-hdg * Math.PI / 180);

  for (let i = 0; i < 72; i++) {
    const a   = (i / 72) * Math.PI * 2 - Math.PI / 2;
    const maj = i % 2 === 0;
    const len = maj ? r * 0.12 : r * 0.06;
    ctx.strokeStyle = P.mark;
    ctx.lineWidth   = maj ? 1.3 * sc : 0.7 * sc;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    ctx.lineTo(Math.cos(a) * (r * 0.92 - len), Math.sin(a) * (r * 0.92 - len));
    ctx.stroke();
  }

  /* English cardinals — N red, E/S/W black */
  const cards = ['N', 'E', 'S', 'W'];
  for (let i = 0; i < 4; i++) {
    const a  = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const nr = r * 0.66;
    ctx.fillStyle    = i === 0 ? '#cc2200' : P.mark;
    ctx.font         = `bold ${11 * sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cards[i], Math.cos(a) * nr, Math.sin(a) * nr);
  }

  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) continue;
    const deg = i * 30;
    const a   = (deg / 360) * Math.PI * 2 - Math.PI / 2;
    const nr  = r * 0.66;
    ctx.fillStyle    = P.subdued;
    ctx.font         = `${8 * sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(deg / 10), Math.cos(a) * nr, Math.sin(a) * nr);
  }

  ctx.restore();

  /* Lubber line */
  ctx.strokeStyle = '#cc2200'; ctx.lineWidth = 2.2 * sc;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.93);
  ctx.lineTo(x, y - r * 0.78);
  ctx.stroke();

  ctx.fillStyle    = P.subdued;
  ctx.font         = `${8 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', x, y + r * 0.42);

  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, 'Compass', sc);
}

/* ════════════════════════════════════════════════════════════
   RATE OF CLIMB — ±2000 fpm
   ════════════════════════════════════════════════════════════ */
function _drawVSI(ctx, x, y, r, sc) {
  const vs   = S.vs ?? 0;
  const maxV = 2000;
  const s0   = 225, sw = 270, mid = 360;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 8, 5, sc);

  ctx.textBaseline = 'middle';
  for (const v of [-2000, -1000, 0, 1000, 2000]) {
    const deg = mid + (v / maxV) * 135;
    _num(ctx, x, y, r, deg, v === 0 ? '0' : String(Math.abs(v) / 1000), 8.5, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, '×1000 fpm', sc);

  const vsC  = Math.max(-maxV, Math.min(maxV, vs));
  const angN = mid + (vsC / maxV) * 135;
  _needle(ctx, x, y, r, angN, 0.78, 0.22, sc);
  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, 'Rate of Climb', sc);
}

/* ════════════════════════════════════════════════════════════
   MANIFOLD PRESSURE — 0–60 in.Hg
   ════════════════════════════════════════════════════════════ */
function _drawManifold(ctx, x, y, r, sc) {
  const maxSpd  = S.aircraft?.envelope?.maxSpd ?? 362;
  const throttle = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  /* R-2800 at idle ~12 in.Hg, full throttle ~52 in.Hg */
  const mp   = (S.wow || (S.spdT ?? 0) === 0) ? 12 : 12 + throttle * 40;
  const maxP = 60;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 6, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxP; v += 10) _num(ctx, x, y, r, s0 + (v / maxP) * sw, String(v), 7.5, sc);
  ctx.textBaseline = 'alphabetic';

  /* Green arc 30–52 in.Hg */
  const aG0 = _r(s0 + (30 / maxP) * sw);
  const aG1 = _r(s0 + (52 / maxP) * sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, aG0, aG1);
  ctx.strokeStyle = '#2a7a2a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, 'in.Hg', sc);

  const ang = s0 + Math.min(1, mp / maxP) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Manifold Press.', sc);
}

/* ════════════════════════════════════════════════════════════
   OIL TEMPERATURE — 0–300°F
   ════════════════════════════════════════════════════════════ */
function _drawOilTemp(ctx, x, y, r, sc) {
  /* Convert oilTempC (°C) to °F */
  const oilF = Math.max(0, Math.min(300, ((S.oilTempC ?? 15) * 9/5) + 32));
  const maxT = 300;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 6, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxT; v += 50) _num(ctx, x, y, r, s0 + (v / maxT) * sw, String(v), 7, sc);
  ctx.textBaseline = 'alphabetic';

  /* Green arc 140–230°F */
  const aG0 = _r(s0 + (140 / maxT) * sw);
  const aG1 = _r(s0 + (230 / maxT) * sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, aG0, aG1);
  ctx.strokeStyle = '#2a7a2a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, '°F', sc);

  const ang = s0 + Math.min(1, oilF / maxT) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Oil Temp', sc);
}

/* ════════════════════════════════════════════════════════════
   OIL PRESSURE — 0–100 PSI
   ════════════════════════════════════════════════════════════ */
function _drawOilPressure(ctx, x, y, r, sc) {
  const maxSpd  = S.aircraft?.envelope?.maxSpd ?? 362;
  const throttle = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  const oilP = (S.enginePower ?? 1) > 0.1 ? 40 + throttle * 35 : 0;
  const maxP = 100;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxP; v += 20) _num(ctx, x, y, r, s0 + (v / maxP) * sw, String(v), 7.5, sc);
  ctx.textBaseline = 'alphabetic';

  /* Green arc 50–85 PSI */
  const aG0 = _r(s0 + (50 / maxP) * sw);
  const aG1 = _r(s0 + (85 / maxP) * sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, aG0, aG1);
  ctx.strokeStyle = '#2a7a2a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, 'PSI', sc);

  const ang = s0 + Math.min(1, oilP / maxP) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Oil Pressure', sc);
}
