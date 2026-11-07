/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/analog_panel.js
   The analog instrument panel: six flight instruments and an engine row, in a style per
   aircraft — the look, the language and the unit system:
     luftwaffe  feldgrau, ivory faces, red needles; German, metric   — Bf 109, MiG-15
     soviet     turquoise, black faces, white needles; Russian, metric — Tu-95, An-225 (stop-gap)
     usn        flat black, white faces; English, US units             — F4U
     wood       wooden board, brass bezels, black faces; English, mph  — Avro 504 (stop-gap)
   Merged 2026-11-07 from display/bf109.js and display/f4u1a.js, which were copies of each other
   (issues.md: "Gauge helpers copied between the hand-drawn panels").

   Sim state is knots / feet / fpm. Metric gauges convert: km/h (× 1.852), m (× 0.3048),
   m/s (× 0.00508). Imperial gauges read it as it is.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { getRpmValue, getCurrentRpm } from '../core/sound.js';
import { drawAnalogClock } from './clock.js';
import { ballDeflection } from '../core/yaw.js';

/* ── Styles — the look and the language of the panel. luftwaffe: the Bf 109 (and the MiG-15, which
   borrows this panel). soviet: a stop-gap for the Tu-95 and the An-225 until each has its own
   sourced panel (issues.md, "The Avro 504, Tu-95 and An-225 fly on a leftover glass PFD") — black
   faces with white markings on the turquoise Soviet cockpit paint, Russian labels; metric like the
   German instruments, so the scales stay. ── */
const STYLES = {
  luftwaffe: {
    P: {
      panel:    '#22261d',   // feldgrau — dark olive-grey Luftwaffe panel
      rim:      '#141610',   // bezel ring — blackened steel
      faceHi:   '#f8f2e0',   // dial face highlight
      face0:    '#f0e9d4',   // dial face centre — warm ivory
      face1:    '#d8cead',   // dial face edge shadow
      capIn:    '#3c3a2e',   // centre cap, inner
      needle:   '#c41e00',   // Luftwaffe red
      ndlBack:  '#28261e',   // needle counterweight — dark
      mark:     '#1c1914',   // index marks & numerals — near-black
      subdued:  '#80745a',   // secondary label — aged ink
      shadowEdge: 'rgba(0,0,0,0.72)', ring: '#2a2c24', glintA: 0.55, glint0: 'rgba(210,230,255,0.22)', glint1: 'rgba(210,230,255,0.05)',
      capOut: '#141610', label: '#1c1914', vignette: 'rgba(0,0,0,0.52)',
      shadow:   'rgba(0,0,0,0.65)',
    },
    sky: ['#3a5468', '#5878a0'],                 // Arctic sky — cold pale blue
    ground: ['#4a3c28', '#3c3020', '#c8c4b8'],   // tundra, snow on flat ground
    frost: true,                                 // Wolfskopf 1942, Petsamo, -22 °C
    units: 'metric',
    L: {
      asi: 'Fahrtmesser', asiUnit: 'km/h', ai: 'Künstl. Horizont', alt: 'Höhenmesser', altUnit: '×100 m',
      turn: 'Wendezeiger', turnL: 'L', turnR: 'R', compass: 'Kompass', cards: ['N', 'O', 'S', 'W'],
      vsi: 'Variometer', vsiUnit: 'm/s', rpm: 'Drehzahlmesser', rpmUnit: '×100 U/min', n1: 'Verdichter', n1Unit: 'N1 %',
      oilT: 'Öltemperatur', coolant: 'Kühlstoff', oilP: 'Öldruck', oilPUnit: 'atü',
    },
  },
  soviet: {
    P: {
      panel:    '#2e6a72',   // Soviet cockpit turquoise
      rim:      '#121416',   // black bezel
      faceHi:   '#2a2e33',
      face0:    '#16191c',   // black face
      face1:    '#0c0e10',
      capIn:    '#4a4e52',
      needle:   '#f2efe4',   // white needle
      ndlBack:  '#2a2d30',
      mark:     '#e8e6dc',   // white markings
      subdued:  '#9aa3a6',
      shadowEdge: 'rgba(0,0,0,0.72)', ring: '#2a2c24', glintA: 0.55, glint0: 'rgba(210,230,255,0.22)', glint1: 'rgba(210,230,255,0.05)',
      capOut: '#121416', label: '#e8e6dc', vignette: 'rgba(0,0,0,0.52)',
      shadow:   'rgba(0,0,0,0.65)',
    },
    sky: ['#2c5a8a', '#4a80b8'],
    ground: ['#6a4a2a', '#5a3c22', '#4a3018'],
    frost: false,
    units: 'metric',
    L: {
      asi: 'Скорость', asiUnit: 'км/ч', ai: 'Авиагоризонт', alt: 'Высотомер', altUnit: '×100 м',
      turn: 'Указатель поворота', turnL: 'Л', turnR: 'П', compass: 'Компас', cards: ['С', 'В', 'Ю', 'З'],
      vsi: 'Вариометр', vsiUnit: 'м/с', rpm: 'Тахометр', rpmUnit: '×100 об/мин', n1: 'Обороты', n1Unit: 'N1 %',
      oilT: 'Темп. масла', coolant: 'Темп. охл. жидк.', oilP: 'Давл. масла', oilPUnit: 'кгс/см²',
    },
  },
  usn: {   // the F4U: flat black US Navy panel, white faces, white needles; English labels, US units
    P: {
      panel:   '#111314', rim: '#0a0b0c', faceHi: '#ffffff', face0: '#f8f8f8', face1: '#dcdcdc', capIn: '#3a3a3a',
      needle:  '#f0f0e8', ndlBack: '#1e2020', mark: '#1a1a1a', subdued: '#666666', shadow: 'rgba(0,0,0,0.72)',
      shadowEdge: 'rgba(0,0,0,0.80)', ring: '#222', glintA: 0.4, glint0: 'rgba(255,255,255,0.18)', glint1: 'rgba(255,255,255,0.04)',
      capOut: '#222', label: '#cccccc', vignette: 'rgba(0,0,0,0.55)',
    },
    frost: false,
    units: 'imperial',
    L: {
      asi: 'Airspeed', asiUnit: 'kt', ai: 'Artificial Horizon', alt: 'Altimeter', altUnit: '×1000 ft',
      turn: 'Turn & Slip', turnL: 'L', turnR: 'R', compass: 'Compass', cards: ['N', 'E', 'S', 'W'],
      vsi: 'Rate of Climb', vsiUnit: '×1000 fpm', map: 'Manifold Press.', mapUnit: 'in.Hg',
      oilT: 'Oil Temp', cht: 'Cyl. Head', tempUnit: '°F', oilP: 'Oil Pressure', oilPUnit: 'PSI',
    },
  },
  wood: {   // the Avro 504K (1918), a stop-gap: a varnished wooden board, brass bezels, black faces with
            // white figures; English labels, mph and feet — no coloured arcs on the dials of the time
    P: {
      panel:   '#5a3a1e', rim: '#8a6a32', faceHi: '#2a2622', face0: '#171512', face1: '#0d0c0a', capIn: '#b08a40',
      needle:  '#efe6cc', ndlBack: '#2a2420', mark: '#ece2c8', subdued: '#a89a7c', shadow: 'rgba(0,0,0,0.72)',
      shadowEdge: 'rgba(0,0,0,0.75)', ring: '#5a4420', glintA: 0.45, glint0: 'rgba(255,240,210,0.16)', glint1: 'rgba(255,240,210,0.04)',
      capOut: '#8a6a32', label: '#f0e2c0', vignette: 'rgba(0,0,0,0.50)',
    },
    woodGrain: true,
    sky: ['#4a74a0', '#8aaccc'],                 // a hazy summer sky over the Marne
    ground: ['#5e5030', '#4c4028', '#3a3020'],   // fields and earth
    frost: false,
    units: 'imperial',
    engineGauge: 'rpm',                                            // a rotary: revolutions, no manifold pressure
    asi: { factor: 1.15078, max: 120, step: 20, arcs: false },     // knots → mph
    rpm: { idle: 500, max: 1200, dial: 1600, step: 200 },          // Le Rhône 9J: 110 hp at 1,200 rpm
    L: {
      asi: 'Air Speed', asiUnit: 'M.P.H.', ai: 'Horizon', alt: 'Altimeter', altUnit: '×1000 ft',
      turn: 'Turn Indicator', turnL: 'L', turnR: 'R', compass: 'Compass', cards: ['N', 'E', 'S', 'W'],
      vsi: 'Rate of Climb', vsiUnit: '×1000 ft/min', rpm: 'Revolutions', rpmUnit: '×100 R.P.M.',
      oilT: 'Oil Temp', cht: 'Cyl. Head', tempUnit: '°F', oilP: 'Oil Pressure', oilPUnit: 'lb/sq in',
    },
  },
};
let ST = STYLES.luftwaffe, P = ST.P, L = ST.L;   // the active style — set by each render

/* ── Fonts ── */
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ── Angle helper: degrees from 12-o'clock, clockwise → canvas radians ── */
const _r = d => (d - 90) * Math.PI / 180;

/* ════════════════════════════════════════════════════════════
   MAIN ENTRY
   ════════════════════════════════════════════════════════════ */
export function renderAnalogPanel(canvas, style = 'luftwaffe') {
  ST = STYLES[style] ?? STYLES.luftwaffe; P = ST.P; L = ST.L;
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();

  /* Panel */
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, 0, W, H);
  if (ST.woodGrain) _drawWoodGrain(ctx, W, H);

  /* Vignette */
  const vg = ctx.createRadialGradient(W/2, H/2, H*0.18, W/2, H/2, H*0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, P.vignette);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  /* The gauge set: metric (German, Soviet) or imperial (US) — the layout is the same */
  const _isJet = S.aircraft?.sound?.engineType === 'turbojet-vk1';
  const G = ST.units === 'imperial'
    ? { asi: _drawAirspeed, ai: _drawHorizon, alt: _drawAltimeter, turn: _drawTurnSlip, compass: _drawCompass, vsi: _drawVSI,
        eng: ST.engineGauge === 'rpm' ? _drawDrehzahl : _drawManifold, temp2: _drawCHT, oilT: _drawOilTemp, oilP: _drawOilPressure }
    : { asi: _drawFahrtmesser, ai: _drawHorizont, alt: _drawHoehenmesser, turn: _drawWendezeiger, compass: _drawKompass, vsi: _drawVariometer,
        eng: _isJet ? _drawN1Messer : _drawDrehzahl, temp2: _drawKuehlstoffTemp, oilT: _drawOelTemp, oilP: _drawOelDruck };

  /* In the combined "cockpit + outside" view the panel is flat & wide — spread
     the gauges across the free side-space (2 flight rows left, engine block
     right) instead of squashing 3 rows. Full cockpit keeps the 3-row layout. */
  const wide = (W / H) > 2.0;

  if (wide) {
    const barH = 80 * devicePixelRatio;       // #panel bottom bar — keep gauges/labels above it
    const Hu   = H - barH;                     // usable height above the bar
    const sc   = Hu / 480;
    const r1 = 90 * sc, r2 = 66 * sc;
    const yTop = Hu * 0.30, yBot = Hu * 0.70;

    /* Flight instruments — left / centre, 2×3 */
    const cxL = W * 0.33, cwL = W * 0.135;
    G.asi(ctx, cxL - cwL, yTop, r1, sc);
    G.ai(ctx, cxL,       yTop, r1, sc);
    G.alt(ctx, cxL + cwL, yTop, r1, sc);
    G.turn(ctx, cxL - cwL, yBot, r1 * 0.85, sc);
    G.compass(ctx, cxL,       yBot, r1 * 0.85, sc);
    G.vsi(ctx, cxL + cwL, yBot, r1 * 0.85, sc);

    /* Engine / temperature block — right */
    const cxR = W * 0.80, dxR = W * 0.085;
    if (S.aircraft?.cooling) {
      G.eng(ctx, cxR - dxR, yTop, r2, sc);
      G.temp2(ctx, cxR + dxR, yTop, r2, sc);
      G.oilT(ctx, cxR - dxR, yBot, r2, sc);
      G.oilP(ctx, cxR + dxR, yBot, r2, sc);
    } else {
      G.eng(ctx, cxR,       yTop, r2, sc);
      G.oilT(ctx, cxR - dxR, yBot, r2, sc);
      G.oilP(ctx, cxR + dxR, yBot, r2, sc);
    }

    drawAnalogClock(ctx, W * 0.06, Hu * 0.28, 44 * sc);   // clock — top-left

    if (ST.frost) _drawFrost(ctx, W, H);

  } else {
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

    G.asi(ctx, cx - cw, y1, r1, sc);
    G.ai(ctx, cx,      y1, r1, sc);
    G.alt(ctx, cx + cw, y1, r1, sc);

    G.turn(ctx, cx - cw, y2, r1 * 0.85, sc);
    G.compass(ctx, cx,      y2, r1 * 0.85, sc);
    G.vsi(ctx, cx + cw, y2, r1 * 0.85, sc);

    if (S.aircraft?.cooling) {   /* liquid-cooled → 4-gauge strip with Kühlstofftemp */
      G.eng(ctx, cx - cw * 0.93, y3, r2, sc);
      G.temp2(ctx, cx - cw * 0.31, y3, r2, sc);
      G.oilT(ctx, cx + cw * 0.31, y3, r2, sc);
      G.oilP(ctx, cx + cw * 0.93, y3, r2, sc);
    } else {
      G.eng(ctx, cx - cw * 0.62, y3, r2, sc);
      G.oilT(ctx, cx,             y3, r2, sc);
      G.oilP(ctx, cx + cw * 0.62, y3, r2, sc);
    }

    drawAnalogClock(ctx, W * 0.11, H * 0.14, 48 * sc);   // clock — top-left

    /* Frost vignette — Arctic, -22°C */
    if (ST.frost) _drawFrost(ctx, W, H);

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
  sh.addColorStop(1, P.shadowEdge);
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.arc(x, y, r * 1.18, 0, Math.PI*2); ctx.fill();

  /* Bezel */
  ctx.beginPath(); ctx.arc(x, y, r * 1.04, 0, Math.PI*2);
  ctx.fillStyle = P.rim; ctx.fill();

  /* Inner ring — slight lighter ring inside bezel */
  ctx.beginPath(); ctx.arc(x, y, r * 1.0, 0, Math.PI*2);
  ctx.strokeStyle = P.ring; ctx.lineWidth = 1.5; ctx.stroke();

  /* Cream face */
  const face = ctx.createRadialGradient(x - r*0.08, y - r*0.10, r*0.04, x, y, r);
  face.addColorStop(0,    P.faceHi);
  face.addColorStop(0.72, P.face0);
  face.addColorStop(1,    P.face1);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = face; ctx.fill();

  /* Glass glint — cold, top-left quadrant */
  ctx.save();
  ctx.globalAlpha = P.glintA;
  const gl = ctx.createRadialGradient(x - r*0.32, y - r*0.38, r*0.04, x - r*0.18, y - r*0.22, r*0.7);
  gl.addColorStop(0,   P.glint0);
  gl.addColorStop(0.5, P.glint1);
  gl.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/* Centre cap */
function _cap(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r,       0, Math.PI*2); ctx.fillStyle = P.capOut; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI*2); ctx.fillStyle = P.capIn; ctx.fill();
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
  ctx.fillStyle    = P.label;
  ctx.font         = `${9.5 * sc}px ${SANS}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, x, y + r * 1.28);
}

/* A varnished wooden board: darker grain lines and a few knots, the same every frame */
function _drawWoodGrain(ctx, W, H) {
  ctx.save();
  const lines = 46;
  for (let i = 0; i < lines; i++) {
    const y0 = (i + 0.5) * H / lines;
    const a  = 0.05 + 0.07 * ((i * 37) % 11) / 10;           // varying darkness, no randomness
    ctx.strokeStyle = `rgba(30,16,6,${a.toFixed(3)})`;
    ctx.lineWidth   = (1 + (i * 13) % 3) * devicePixelRatio;
    ctx.beginPath();
    for (let x = 0; x <= W; x += W / 60) {
      const y = y0 + Math.sin(x / W * 6.3 + i * 1.7) * H * 0.006 + Math.sin(x / W * 17 + i) * H * 0.002;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  /* Varnish sheen from the top */
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,220,170,0.10)'); g.addColorStop(0.5, 'rgba(255,220,170,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* Medium pictograms on the dial face — distinguish the two temp gauges at a glance.
   Drawn with canvas paths (matches the hand-drawn instruments; no raster/SVG). */
function _symOil(ctx, x, y, s, sc) {        /* oil-can */
  ctx.save();
  ctx.strokeStyle = P.subdued; ctx.fillStyle = P.subdued;
  ctx.lineWidth = 1.1 * sc; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();                          /* can body with a short filler neck */
  ctx.moveTo(x - s,        y + s * 0.55);
  ctx.lineTo(x + s,        y + s * 0.55);
  ctx.lineTo(x + s,        y - s * 0.10);
  ctx.lineTo(x + s * 0.25, y - s * 0.10);
  ctx.lineTo(x + s * 0.25, y - s * 0.45);
  ctx.lineTo(x - s * 0.25, y - s * 0.45);
  ctx.lineTo(x - s * 0.25, y - s * 0.10);
  ctx.lineTo(x - s,        y - s * 0.10);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath();                          /* spout */
  ctx.moveTo(x + s, y + s * 0.05);
  ctx.lineTo(x + s * 1.75, y - s * 0.15);
  ctx.stroke();
  ctx.beginPath();                          /* falling drop */
  ctx.arc(x + s * 1.75, y + s * 0.30, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function _symCoolant(ctx, x, y, s, sc) {    /* thermometer over waves */
  ctx.save();
  ctx.strokeStyle = P.subdued; ctx.fillStyle = P.subdued;
  ctx.lineWidth = 1.1 * sc; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();                          /* stem */
  ctx.moveTo(x, y - s * 0.75); ctx.lineTo(x, y + s * 0.10); ctx.stroke();
  ctx.beginPath();                          /* bulb */
  ctx.arc(x, y + s * 0.32, s * 0.27, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();                          /* two waves */
  for (const dy of [s * 0.85, s * 1.20]) {
    ctx.moveTo(x - s, y + dy);
    ctx.quadraticCurveTo(x - s * 0.5, y + dy - s * 0.28, x, y + dy);
    ctx.quadraticCurveTo(x + s * 0.5, y + dy + s * 0.28, x + s, y + dy);
  }
  ctx.stroke();
  ctx.restore();
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

  _sublabel(ctx, x, y, r, L.asiUnit, sc);

  const ang = s0 + Math.min(1, Math.max(0, kmh / maxV)) * sw;
  _needle(ctx, x, y, r, ang, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, L.asi, sc);
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
  skyG.addColorStop(0,   ST.sky[0]);
  skyG.addColorStop(1,   ST.sky[1]);
  ctx.fillStyle = skyG;
  ctx.fillRect(-r, -r * 1.2, r * 2, r * 1.2 + pitchPx);

  /* Tundra / ice below */
  const gndG = ctx.createLinearGradient(0, pitchPx, 0, r);
  gndG.addColorStop(0,   ST.ground[0]);
  gndG.addColorStop(0.5, ST.ground[1]);
  gndG.addColorStop(1,   ST.ground[2]);   /* luftwaffe: snow on flat ground */
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
  _label(ctx, x, y, r, L.ai, sc);
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

  _sublabel(ctx, x, y, r, L.altUnit, sc);

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
  _label(ctx, x, y, r, L.alt, sc);
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
  ctx.fillText(L.turnL, x - r * 0.52, y - r * 0.48);
  ctx.fillText(L.turnR, x + r * 0.52, y - r * 0.48);

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
  /* Ball — from the lateral acceleration (core/yaw.js); centred while the aircraft has no yaw model */
  ctx.beginPath(); ctx.arc(x + ballDeflection(S.latAccel) * 13.5 * sc, ballY, 6.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.strokeStyle = P.mark; ctx.lineWidth = 0.8 * sc; ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  _label(ctx, x, y, r, L.turn, sc);
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
  const cards = L.cards;
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
  _label(ctx, x, y, r, L.compass, sc);
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

  _sublabel(ctx, x, y, r, L.vsiUnit, sc);

  const vsC   = Math.max(-20, Math.min(20, vsMs));
  const angN  = mid + (vsC / 20) * 135;
  _needle(ctx, x, y, r, angN, 0.78, 0.22, sc);
  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, L.vsi, sc);
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
  /* Scale by engine health — a seizing/damaged engine loses RPM even with the throttle up */
  const R = ST.rpm ?? {};                                      // the style's range — default the DB 601's
  const rIdle = R.idle ?? 400, rMax = R.max ?? 2800;
  const rpm       = running ? Math.round((rIdle + (rMax - rIdle) * throttle) * (S.enginePower ?? 1)) : liveRpm;
  const maxR = R.dial ?? 2800;
  const step = R.step ?? 400;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, maxR / 200, 2, sc);   /* 200 rpm per major, 100 minor */

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxR; v += step) {
    _num(ctx, x, y, r, s0 + (v / maxR) * sw, v === 0 ? '0' : String(v / 100), 7.5, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, L.rpmUnit, sc);

  const ang = s0 + Math.min(1, rpm / maxR) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.rpm, sc);
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
  _sublabel(ctx, x, y, r, L.n1Unit, sc);
  const ang = s0 + Math.min(1, n1 / maxN1) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.n1, sc);
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
  _symOil(ctx, x, y - r * 0.34, r * 0.15, sc);

  const ang = s0 + Math.min(1, oilT / maxT) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.oilT, sc);
}

/* Kühlstofftemperatur — coolant temp (DB605); heat-balance state from physics.js.
   Green band from aircraft.cooling.normal, red from redline up. */
function _drawKuehlstoffTemp(ctx, x, y, r, sc) {
  const maxT = 130;
  const cT   = Math.max(0, Math.min(maxT, S.coolantTemp ?? 15));
  const s0   = 220, sw = 280;
  const norm = S.aircraft?.cooling?.normal  ?? [80, 100];
  const red  = S.aircraft?.cooling?.redline ?? 115;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 13, 2, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxT; v += 20) _num(ctx, x, y, r, s0 + (v / maxT) * sw, String(v), 7, sc);
  ctx.textBaseline = 'alphabetic';

  ctx.save();
  /* Green arc — normal band */
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, _r(s0 + (norm[0] / maxT) * sw), _r(s0 + (norm[1] / maxT) * sw));
  ctx.strokeStyle = '#3a7a3a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  /* Red arc — redline to max */
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, _r(s0 + (red / maxT) * sw), _r(s0 + sw));
  ctx.strokeStyle = '#9a2a2a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, '°C', sc);
  _symCoolant(ctx, x, y - r * 0.34, r * 0.15, sc);

  const ang = s0 + Math.min(1, cT / maxT) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.coolant, sc);
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

  _sublabel(ctx, x, y, r, L.oilPUnit, sc);

  const ang = s0 + Math.min(1, oilP / maxP) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.oilP, sc);
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

/* ═════════════ IMPERIAL GAUGES (from the F4U panel) ═════════════ */

/* ════════════════════════════════════════════════════════════
   AIRSPEED — 0–400 kt
   ════════════════════════════════════════════════════════════ */
function _drawAirspeed(ctx, x, y, r, sc) {
  const A    = ST.asi ?? {};                                   // the style's scale — default the F4U's (kt, 0–400, arcs)
  const spd  = (S.spd ?? 0) * (A.factor ?? 1);
  const maxV = A.max ?? 400;
  const step = A.step ?? 50;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  if (A.arcs !== false) {

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
  }

  _ticks(ctx, x, y, r, s0, sw, maxV / step, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxV; v += step) _num(ctx, x, y, r, s0 + (v / maxV) * sw, String(v), 8.5, sc);
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, L.asiUnit, sc);

  const ang = s0 + Math.min(1, Math.max(0, spd / maxV)) * sw;
  _needle(ctx, x, y, r, ang, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, L.asi, sc);
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
  const sky = ST.sky ?? ['#2a6090', '#5090c8'];               // the style's — default the F4U's Pacific
  skyG.addColorStop(0, sky[0]);
  skyG.addColorStop(1, sky[1]);
  ctx.fillStyle = skyG;
  ctx.fillRect(-r, -r * 1.2, r * 2, r * 1.2 + pitchPx);

  /* Pacific ocean */
  const seaG = ctx.createLinearGradient(0, pitchPx, 0, r);
  const gnd = ST.ground ?? ['#1a5070', '#164060', '#0a2030'];   // the Pacific ocean, or the style's ground
  seaG.addColorStop(0,   gnd[0]);
  seaG.addColorStop(0.5, gnd[1]);
  seaG.addColorStop(1,   gnd[2]);
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
  _label(ctx, x, y, r, L.ai, sc);
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

  _sublabel(ctx, x, y, r, L.altUnit, sc);

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
  _label(ctx, x, y, r, L.alt, sc);
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
  ctx.fillText(L.turnL, x - r * 0.52, y - r * 0.48);
  ctx.fillText(L.turnR, x + r * 0.52, y - r * 0.48);

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
  /* Ball — from the lateral acceleration (core/yaw.js); centred while the aircraft has no yaw model */
  ctx.beginPath(); ctx.arc(x + ballDeflection(S.latAccel) * 13.5 * sc, ballY, 6.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.strokeStyle = P.mark; ctx.lineWidth = 0.8 * sc; ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  _label(ctx, x, y, r, L.turn, sc);
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
  const cards = L.cards;
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
  _label(ctx, x, y, r, L.compass, sc);
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

  _sublabel(ctx, x, y, r, L.vsiUnit, sc);

  const vsC  = Math.max(-maxV, Math.min(maxV, vs));
  const angN = mid + (vsC / maxV) * 135;
  _needle(ctx, x, y, r, angN, 0.78, 0.22, sc);
  _cap(ctx, x, y, 4.5 * sc);
  _label(ctx, x, y, r, L.vsi, sc);
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

  _sublabel(ctx, x, y, r, L.mapUnit, sc);

  const ang = s0 + Math.min(1, mp / maxP) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.map, sc);
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

  _sublabel(ctx, x, y, r, L.tempUnit, sc);

  const ang = s0 + Math.min(1, oilF / maxT) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.oilT, sc);
}

/* ════════════════════════════════════════════════════════════
   CYLINDER HEAD TEMP — R-2800 air-cooled, coolantTemp state (°C) in °F
   ════════════════════════════════════════════════════════════ */
function _drawCHT(ctx, x, y, r, sc) {
  const maxT = 500;
  const chtF = Math.max(0, Math.min(maxT, ((S.coolantTemp ?? 15) * 9/5) + 32));
  const cF   = c => c * 9/5 + 32;
  const norm = S.aircraft?.cooling?.normal  ?? [180, 230];
  const redC = S.aircraft?.cooling?.redline ?? 232;
  const s0   = 220, sw = 280;

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 6, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxT; v += 100) _num(ctx, x, y, r, s0 + (v / maxT) * sw, String(v), 7, sc);
  ctx.textBaseline = 'alphabetic';

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, _r(s0 + (cF(norm[0]) / maxT) * sw), _r(s0 + (cF(norm[1]) / maxT) * sw));
  ctx.strokeStyle = '#2a7a2a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * 0.95, _r(s0 + (cF(redC) / maxT) * sw), _r(s0 + sw));
  ctx.strokeStyle = '#9a2a2a'; ctx.lineWidth = 4 * sc; ctx.stroke();
  ctx.restore();

  _sublabel(ctx, x, y, r, L.tempUnit, sc);

  const ang = s0 + Math.min(1, chtF / maxT) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.cht, sc);
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

  _sublabel(ctx, x, y, r, L.oilPUnit, sc);

  const ang = s0 + Math.min(1, oilP / maxP) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.oilP, sc);
}
