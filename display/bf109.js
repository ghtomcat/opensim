/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/bf109.js
   Bf 109 E-4 vintage instrument panel.

   Aesthetic: feldgrau panel · aged cream/ivory dials · red needles
   Arctic atmosphere — Wolfskopf 1942, Petsamo, -22°C, overcast.
   German instrument labels, period-accurate (Luftwaffe 1942).

   Unit conversions from sim (knots / feet / fpm):
     speed    → km/h  (× 1.852)
     altitude → m     (× 0.3048)
     vs       → m/s   (× 0.00508)
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { getRpmValue, getCurrentRpm } from '../core/sound.js';

/* ── Palette ── */
const P = {
  panel:    '#22261d',   // feldgrau — dark olive-grey Luftwaffe panel
  rim:      '#141610',   // bezel ring — blackened steel
  face0:    '#f0e9d4',   // dial face centre — warm ivory
  face1:    '#d8cead',   // dial face edge shadow
  needle:   '#c41e00',   // Luftwaffe red
  ndlBack:  '#28261e',   // needle counterweight — dark
  mark:     '#1c1914',   // index marks & numerals — near-black
  subdued:  '#80745a',   // secondary label — aged ink
  shadow:   'rgba(0,0,0,0.65)',
};

/* ── Fonts ── */
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ── Angle helper: degrees from 12-o'clock, clockwise → canvas radians ── */
const _r = d => (d - 90) * Math.PI / 180;

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderBf109(canvas) {
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
  vg.addColorStop(1, 'rgba(0,0,0,0.52)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const sc = Math.min(W, H) / 860;
  const cx = W / 2;
  const cy = H / 2;

  /* Layout: 3 rows, 3 columns */
  const cw = 195 * sc;   /* column width   */
  const rh = 205 * sc;   /* row height     */
  const r1 = 90  * sc;   /* main instruments (top 2 rows) */
  const r2 = 60  * sc;   /* engine strip (bottom row)     */

  /* Row y-positions (centred in panel) */
  const y1 = cy - rh * 0.85;   /* top row    */
  const y2 = cy + rh * 0.15;   /* middle row */
  const y3 = cy + rh * 1.05;   /* engine strip */

  _drawFahrtmesser(ctx, cx - cw, y1, r1, sc);
  _drawHorizont(   ctx, cx,      y1, r1, sc);
  _drawHoehenmesser(ctx, cx + cw, y1, r1, sc);

  _drawWendezeiger(ctx, cx - cw, y2, r1 * 0.85, sc);
  _drawKompass(    ctx, cx,      y2, r1 * 0.85, sc);
  _drawVariometer( ctx, cx + cw, y2, r1 * 0.85, sc);

  const _isJet = S.aircraft?.sound?.engineType === 'turbojet-vk1';
  if (_isJet) _drawN1Messer(ctx, cx - cw * 0.62, y3, r2, sc);
  else        _drawDrehzahl(ctx, cx - cw * 0.62, y3, r2, sc);
  _drawOelTemp( ctx, cx,             y3, r2, sc);
  _drawOelDruck(ctx, cx + cw * 0.62, y3, r2, sc);

  /* Frost vignette — Arctic, -22°C */
  _drawFrost(ctx, W, H);

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
   INSTRUMENT BASE — bezel ring + aged cream face
   ════════════════════════════════════════════════════════════ */
function _base(ctx, x, y, r) {
  /* Drop shadow */
  const sh = ctx.createRadialGradient(x + r*0.06, y + r*0.06, r*0.6, x, y, r*1.2);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.arc(x, y, r * 1.18, 0, Math.PI*2); ctx.fill();

  /* Bezel */
  ctx.beginPath(); ctx.arc(x, y, r * 1.04, 0, Math.PI*2);
  ctx.fillStyle = P.rim; ctx.fill();

  /* Inner ring — slight lighter ring inside bezel */
  ctx.beginPath(); ctx.arc(x, y, r * 1.0, 0, Math.PI*2);
  ctx.strokeStyle = '#2a2c24'; ctx.lineWidth = 1.5; ctx.stroke();

  /* Cream face */
  const face = ctx.createRadialGradient(x - r*0.08, y - r*0.10, r*0.04, x, y, r);
  face.addColorStop(0,    '#f8f2e0');
  face.addColorStop(0.72, P.face0);
  face.addColorStop(1,    P.face1);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = face; ctx.fill();

  /* Glass glint — cold, top-left quadrant */
  ctx.save();
  ctx.globalAlpha = 0.55;
  const gl = ctx.createRadialGradient(x - r*0.32, y - r*0.38, r*0.04, x - r*0.18, y - r*0.22, r*0.7);
  gl.addColorStop(0,   'rgba(210,230,255,0.22)');
  gl.addColorStop(0.5, 'rgba(210,230,255,0.05)');
  gl.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/* Centre cap */
function _cap(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r,       0, Math.PI*2); ctx.fillStyle = P.rim;    ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI*2); ctx.fillStyle = '#3c3a2e'; ctx.fill();
}

/* Needle — tapered red body + dark counterweight */
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

  /* Counterweight */
  ctx.beginPath();
  ctx.moveTo(x + px*2.4, y + py*2.4);
  ctx.lineTo(bx + px*1.6, by + py*1.6);
  ctx.lineTo(bx - px*1.6, by - py*1.6);
  ctx.lineTo(x - px*2.4, y - py*2.4);
  ctx.closePath();
  ctx.fillStyle = P.ndlBack; ctx.fill();

  /* Needle */
  ctx.beginPath();
  ctx.moveTo(x + px, y + py);
  ctx.lineTo(tx, ty);
  ctx.lineTo(x - px, y - py);
  ctx.closePath();
  ctx.fillStyle = P.needle; ctx.fill();
}

/* Tick marks along the arc, from startDeg sweeping sweep° */
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
  ctx.fillStyle    = P.mark;
  ctx.font         = `${9.5 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, x, y + r * 1.28);
}

/* ════════════════════════════════════════════════════════════
   FAHRTMESSER — Airspeed · 0–800 km/h
   7 o'clock (220°) to 5 o'clock (220°+280°)
   ════════════════════════════════════════════════════════════ */
function _drawFahrtmesser(ctx, x, y, r, sc) {
  const kmh  = S.spd * 1.852;
  const maxV = 800;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);

  /* Danger arc ≥ 620 km/h — thin red stripe on rim */
  const a620 = _r(s0 + (620 / maxV) * sw);
  const aMax = _r(s0 + sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.96, a620, aMax);
  ctx.strokeStyle = '#882200'; ctx.lineWidth = 5 * sc; ctx.stroke();
  ctx.restore();

  _ticks(ctx, x, y, r, s0, sw, 8, 5, sc);   /* major every 100, minor every 20 */

  /* Numerals 0 100 … 800 */
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxV; v += 100) _num(ctx, x, y, r, s0 + (v / maxV) * sw, v === 0 ? '0' : String(v), 8.5, sc);
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, 'km/h', sc);

  const ang = s0 + Math.min(1, Math.max(0, kmh / maxV)) * sw;
  _needle(ctx, x, y, r, ang, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, 'Fahrtmesser', sc);
}

/* ════════════════════════════════════════════════════════════
   KÜNSTLICHER HORIZONT — Artificial Horizon
   ════════════════════════════════════════════════════════════ */
function _drawHorizont(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);

  const pitch = S.pitch;
  const roll  = S.roll;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll * Math.PI / 180);

  /* Clip to face */
  ctx.beginPath(); ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2); ctx.clip();

  const pitchPx = pitch * 2.6 * sc;

  /* Arctic sky — cold pale blue */
  const skyG = ctx.createLinearGradient(0, -r, 0, pitchPx);
  skyG.addColorStop(0,   '#3a5468');
  skyG.addColorStop(1,   '#5878a0');
  ctx.fillStyle = skyG;
  ctx.fillRect(-r, -r * 1.2, r * 2, r * 1.2 + pitchPx);

  /* Tundra / ice below */
  const gndG = ctx.createLinearGradient(0, pitchPx, 0, r);
  gndG.addColorStop(0,   '#4a3c28');
  gndG.addColorStop(0.5, '#3c3020');
  gndG.addColorStop(1,   '#c8c4b8');   /* snow on flat ground */
  ctx.fillStyle = gndG;
  ctx.fillRect(-r, pitchPx, r * 2, r * 1.2);

  /* Horizon line */
  ctx.strokeStyle = '#ddc870'; ctx.lineWidth = 1.8 * sc;
  ctx.beginPath(); ctx.moveTo(-r, pitchPx); ctx.lineTo(r, pitchPx); ctx.stroke();

  /* Pitch ladder ±5°, ±10°, ±15° */
  ctx.strokeStyle = 'rgba(220,200,100,0.65)'; ctx.lineWidth = 1.0 * sc;
  for (let d = -15; d <= 15; d += 5) {
    if (d === 0) continue;
    const py  = pitchPx - d * 2.6 * sc;
    const hw  = (Math.abs(d) % 10 === 0 ? 0.38 : 0.22) * r;
    ctx.beginPath(); ctx.moveTo(-hw, py); ctx.lineTo(hw, py); ctx.stroke();
  }

  ctx.restore();

  /* Fixed aircraft symbol — stays level */
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ddc870'; ctx.lineWidth = 2.8 * sc; ctx.lineCap = 'round';
  /* Left wing */
  ctx.beginPath();
  ctx.moveTo(-r * 0.56, 0);
  ctx.lineTo(-r * 0.20, 0);
  ctx.lineTo(-r * 0.10, r * 0.09);
  ctx.stroke();
  /* Right wing */
  ctx.beginPath();
  ctx.moveTo(r * 0.56, 0);
  ctx.lineTo(r * 0.20, 0);
  ctx.lineTo(r * 0.10, r * 0.09);
  ctx.stroke();
  /* Centre dot */
  ctx.beginPath(); ctx.arc(0, 0, 2.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = '#ddc870'; ctx.fill();
  ctx.restore();

  /* Roll scale arc — tick marks at 10/20/30/45° */
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
  /* Roll pointer (rotates with aircraft) */
  ctx.rotate(-roll * Math.PI / 180);
  ctx.strokeStyle = P.needle; ctx.lineWidth = 2 * sc;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.87);
  ctx.lineTo(-5 * sc, -r * 0.97);
  ctx.lineTo( 5 * sc, -r * 0.97);
  ctx.closePath();
  ctx.strokeStyle = P.needle; ctx.stroke();
  ctx.restore();

  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, 'Künstl. Horizont', sc);
}

/* ════════════════════════════════════════════════════════════
   HÖHENMESSER — Altimeter · 0–1000 m (×100 numerals)
   Fine needle: 1-revolution per 1000 m
   Coarse stub: 1-revolution per 10 000 m
   ════════════════════════════════════════════════════════════ */
function _drawHoehenmesser(ctx, x, y, r, sc) {
  const altM = S.alt * 0.3048;
  const s0   = 220, sw = 300;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 5, sc);   /* major every 100m, minor every 20m */

  /* Numerals 0–9 (represent ×100 m) */
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 9; v++) {
    _num(ctx, x, y, r, s0 + (v / 10) * sw, String(v), 9, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, '×100 m', sc);

  /* Coarse 10 000 m stub — short, dark */
  const angCoarse = s0 + ((altM / 10000) % 1) * sw;
  const ac = _r(angCoarse);
  ctx.strokeStyle = P.ndlBack; ctx.lineWidth = 2 * sc;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(ac) * r * 0.44, y + Math.sin(ac) * r * 0.44);
  ctx.stroke();

  /* Fine 1 000 m needle */
  const angFine = s0 + ((altM % 1000) / 1000) * sw;
  _needle(ctx, x, y, r, angFine, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, 'Höhenmesser', sc);
}

/* ════════════════════════════════════════════════════════════
   WENDEZEIGER — Turn & Slip
   ════════════════════════════════════════════════════════════ */
function _drawWendezeiger(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);

  /* Turn arc — upper half */
  const arcR = r * 0.72;
  ctx.strokeStyle = P.mark; ctx.lineWidth = 1.0 * sc;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.12, arcR, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  /* Rate marks — centre, ±1 (standard rate = 3°/s) */
  for (const d of [-38, 0, 38]) {
    const dx = d * sc;
    ctx.beginPath();
    ctx.moveTo(x + dx, y - r * 0.78);
    ctx.lineTo(x + dx, y - r * 0.66);
    ctx.strokeStyle = P.mark; ctx.lineWidth = 1.2 * sc;
    ctx.stroke();
  }

  /* L / R labels */
  ctx.fillStyle = P.mark; ctx.font = `bold ${9 * sc}px ${SANS}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('L', x - r * 0.52, y - r * 0.48);
  ctx.fillText('R', x + r * 0.52, y - r * 0.48);

  /* Turn needle — vertical bar shifted by roll proxy */
  const deflect = Math.max(-1, Math.min(1, S.roll / 20));
  const nx = x + deflect * 38 * sc;
  ctx.strokeStyle = P.needle; ctx.lineWidth = 3 * sc; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(nx, y - r * 0.78);
  ctx.lineTo(nx, y + r * 0.05);
  ctx.stroke();

  /* Slip ball track */
  const ballY = y + r * 0.58;
  ctx.strokeStyle = P.mark; ctx.lineWidth = 1.2 * sc;
  ctx.beginPath(); ctx.arc(x, ballY, 20 * sc, Math.PI, Math.PI * 2); ctx.stroke();
  /* Ball — centred (no lateral acc model) */
  ctx.beginPath(); ctx.arc(x, ballY, 6.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.strokeStyle = P.mark; ctx.lineWidth = 0.8 * sc; ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  _label(ctx, x, y, r, 'Wendezeiger', sc);
}

/* ════════════════════════════════════════════════════════════
   KOMPASS — rotating rose, fixed lubber line
   Labels: N O S W (German cardinal directions)
   ════════════════════════════════════════════════════════════ */
function _drawKompass(ctx, x, y, r, sc) {
  _base(ctx, x, y, r);

  const hdg = S.hdg;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-hdg * Math.PI / 180);   /* rose rotates opposite to heading */

  /* Rose ticks — every 5°, major every 10° */
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

  /* Cardinal directions */
  const cards = ['N', 'O', 'S', 'W'];
  for (let i = 0; i < 4; i++) {
    const a  = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const nr = r * 0.66;
    ctx.fillStyle    = i === 0 ? P.needle : P.mark;
    ctx.font         = `bold ${11 * sc}px ${SANS}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cards[i], Math.cos(a) * nr, Math.sin(a) * nr);
  }

  /* Numeric labels every 30° (shown as tens: 3, 6, 9 …) */
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) continue;   /* skip cardinals */
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

  /* Fixed lubber line */
  ctx.strokeStyle = P.needle; ctx.lineWidth = 2.2 * sc;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.93);
  ctx.lineTo(x, y - r * 0.78);
  ctx.stroke();

  /* HDG readout */
  ctx.fillStyle    = P.subdued;
  ctx.font         = `${8 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', x, y + r * 0.42);

  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, 'Kompass', sc);
}

/* ════════════════════════════════════════════════════════════
   VARIOMETER — vertical speed · ±20 m/s
   0 m/s = 12 o'clock; +20 = 5 o'clock (135°); -20 = 7 o'clock (225°)
   ════════════════════════════════════════════════════════════ */
function _drawVariometer(ctx, x, y, r, sc) {
  const vsMs = S.vs * 0.00508;
  /* sweep: 0° (top) ± 135° = total 270° */
  const s0   = 225;   /* -20 m/s at 225° (7 o'clock) */
  const sw   = 270;   /* total sweep */
  const mid  = 360;   /* 0 m/s at 360° = 12 o'clock */

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 8, 5, sc);

  /* Numerals at ±20, ±10, 0 */
  ctx.textBaseline = 'middle';
  for (const v of [-20, -10, 0, 10, 20]) {
    const deg = mid + (v / 20) * 135;
    _num(ctx, x, y, r, deg, v === 0 ? '0' : (v > 0 ? '+' : '') + v, 8.5, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, 'm/s', sc);

  const vsC   = Math.max(-20, Math.min(20, vsMs));
  const angN  = mid + (vsC / 20) * 135;
  _needle(ctx, x, y, r, angN, 0.78, 0.22, sc);
  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, 'Variometer', sc);
}

/* ════════════════════════════════════════════════════════════
   ENGINE GAUGES (small)
   ════════════════════════════════════════════════════════════ */

/* Drehzahlmesser — DB 601 max ~2600 U/min */
function _drawDrehzahl(ctx, x, y, r, sc) {
  const running   = S.engineState === 'running';
  const starting  = S.engineState === 'starting';
  const shuttingDown = S.engineState === 'shutdown';
  const maxSpd    = S.aircraft?.envelope?.maxSpd ?? 335;
  const throttle  = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  const liveRpm   = (running || starting || shuttingDown) ? (getRpmValue() ?? 0) : 0;
  const rpm       = running ? Math.round(400 + (2800 - 400) * throttle) : liveRpm;
  const maxR = 2800;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 14, 2, sc);   /* 200 U/min per major, 100 minor */

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxR; v += 400) {
    _num(ctx, x, y, r, s0 + (v / maxR) * sw, v === 0 ? '0' : String(v / 100), 7.5, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, '×100 U/min', sc);

  const ang = s0 + Math.min(1, rpm / maxR) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Drehzahlmesser', sc);
}

/* N1 Verdichter — turbojet N1 % (replaces Drehzahlmesser when engine is jet) */
function _drawN1Messer(ctx, x, y, r, sc) {
  const rpmStr = getCurrentRpm();
  let n1 = 0;
  if (rpmStr && rpmStr.startsWith('N1 ')) n1 = parseInt(rpmStr.slice(3), 10) || 0;
  const maxN1 = 100, s0 = 220, sw = 280;
  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 4, sc);   /* 10% per major, 2.5% minor */
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxN1; v += 20)
    _num(ctx, x, y, r, s0 + (v / maxN1) * sw, String(v), 7.5, sc);
  ctx.textBaseline = 'alphabetic';
  _sublabel(ctx, x, y, r, 'N1 %', sc);
  const ang = s0 + Math.min(1, n1 / maxN1) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Verdichter', sc);
}

/* Öltemperatur — 0–130°C. Thermally lagged state from physics.js. */
function _drawOelTemp(ctx, x, y, r, sc) {
  const oilT = Math.max(0, Math.min(130, S.oilTempC ?? 15));
  const maxT = 130;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 13, 2, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxT; v += 20) _num(ctx, x, y, r, s0 + (v / maxT) * sw, String(v), 7, sc);
  ctx.textBaseline = 'alphabetic';

  /* Green arc 50–100°C */
  const a50  = _r(s0 + (50  / maxT) * sw);
  const a100 = _r(s0 + (100 / maxT) * sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, a50, a100);
  ctx.strokeStyle = '#3a7a3a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, '°C', sc);

  const ang = s0 + Math.min(1, oilT / maxT) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Öltemperatur', sc);
}

/* Öldruck — 0–10 atü */
function _drawOelDruck(ctx, x, y, r, sc) {
  const running      = S.engineState === 'running';
  const starting     = S.engineState === 'starting';
  const shuttingDown = S.engineState === 'shutdown';
  const maxSpd       = S.aircraft?.envelope?.maxSpd ?? 335;
  const throttle     = Math.max(0, Math.min(1, (S.spdT ?? 0) / maxSpd));
  const dynRpm       = (starting || shuttingDown) ? (getRpmValue() ?? 0) : 0;
  /* Builds with RPM during startup, decays during shutdown */
  const oilP = running     ? 1.5 + throttle * 6.0
             : starting    ? Math.min(1.5, dynRpm / 400 * 1.5)
             : shuttingDown ? Math.max(0, dynRpm / 2800 * 7.5)
             : 0;
  const maxP = 10;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxP; v += 2) _num(ctx, x, y, r, s0 + (v / maxP) * sw, String(v), 7.5, sc);
  ctx.textBaseline = 'alphabetic';

  /* Green arc 4–8 atü */
  const a4 = _r(s0 + (4 / maxP) * sw);
  const a8 = _r(s0 + (8 / maxP) * sw);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, a4, a8);
  ctx.strokeStyle = '#3a7a3a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, 'atü', sc);

  const ang = s0 + Math.min(1, oilP / maxP) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, 'Öldruck', sc);
}

/* ════════════════════════════════════════════════════════════
   FROST VIGNETTE — Arctic atmosphere, -22°C
   ════════════════════════════════════════════════════════════ */
function _drawFrost(ctx, W, H) {
  ctx.save();

  /* Edge glow — cold blue-white creeping inward */
  const fr = ctx.createRadialGradient(W/2, H/2, H * 0.25, W/2, H/2, H * 0.72);
  fr.addColorStop(0.0, 'rgba(0,0,0,0)');
  fr.addColorStop(0.6, 'rgba(200,225,255,0.0)');
  fr.addColorStop(1.0, 'rgba(200,225,255,0.18)');
  ctx.fillStyle = fr;
  ctx.fillRect(0, 0, W, H);

  /* Corner ice crystals */
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#ddeeff';
  const spots = [[0, 0], [W, 0], [0, H], [W, H]];
  for (const [cx, cy] of spots) {
    ctx.beginPath(); ctx.arc(cx, cy, W * 0.20, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  ctx.restore();
}
