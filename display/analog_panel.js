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

   The instrument registry (INSTRUMENTS) says what each instrument shows: `read` takes the value from
   the sim, the draw functions only draw the value they are given (tests/analog-registry.test.mjs).
   Values the sim does not have yet are stand-ins (SIMPLE VALUES), each marked with what replaces it.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { getRpmValue, getCurrentRpm } from '../core/sound.js';
import { drawAnalogClock } from './clock.js';
import { ballDeflection } from '../core/yaw.js';
import { flowLayout, SIZES } from './panel_flow.js';

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
    L: {
      asi: 'Air Speed', asiUnit: 'M.P.H.', ai: 'Horizon', alt: 'Altimeter', altUnit: '×1000 ft',
      turn: 'Turn Indicator', turnL: 'L', turnR: 'R', compass: 'Compass', cards: ['N', 'E', 'S', 'W'],
      vsi: 'Rate of Climb', vsiUnit: '×1000 ft/min', rpm: 'Revolutions', rpmUnit: '×100 R.P.M.',
      oilT: 'Oil Temp', cht: 'Cyl. Head', tempUnit: '°F', oilP: 'Oil Pressure', oilPUnit: 'lb/sq in',
    },
  },
};
/** Each style's unit system — the registry draws an instrument per unit system (tests/analog-registry.test.mjs) */
export const STYLE_UNITS = Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.units]));

let ST = STYLES.luftwaffe, P = ST.P, L = ST.L;   // the active style — set by each render

/* ── Fonts ── */
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ── Angle helper: degrees from 12-o'clock, clockwise → canvas radians ── */
const _r = d => (d - 90) * Math.PI / 180;

/* ════════════════════════════════════════════════════════════
   SIMPLE VALUES — stand-ins until the sim has the real ones (issues.md, "The analog panels draw a
   borrowed fighter panel", step 6). They live here, not in the drawing code; each says what replaces it.
   ════════════════════════════════════════════════════════════ */
const _throttle = () => Math.max(0, Math.min(1, (S.spdT ?? 0) / (S.aircraft?.envelope?.maxSpd ?? 335)));

/** rpm — from the throttle while running (engine.idleRpm…maxRpm, scaled by engine health), else the sound
    code's start/stop curve → S.engines[i].rpm from core/engine.js */
function _simpleRpm() {
  const st = S.engineState;
  if (st === 'running') {
    const e = S.aircraft?.engine ?? {}, rIdle = e.idleRpm ?? 400, rMax = e.maxRpm ?? 2800;
    return Math.round((rIdle + (rMax - rIdle) * _throttle()) * (S.enginePower ?? 1));
  }
  return (st === 'starting' || st === 'shutdown') ? (getRpmValue() ?? 0) : 0;
}

/** N1 % — parsed from the sound code's readout → S.engines[i].n1 */
function _simpleN1() {
  const str = getCurrentRpm();
  return str && str.startsWith('N1 ') ? (parseInt(str.slice(3), 10) || 0) : 0;
}

/** oil pressure, kg/cm² — builds with rpm on the start, decays on the stop → "The oil system" */
function _simpleOilPress() {
  const st = S.engineState, dyn = getRpmValue() ?? 0;
  return st === 'running'  ? 1.5 + _throttle() * 6.0
       : st === 'starting' ? Math.min(1.5, dyn / 400 * 1.5)
       : st === 'shutdown' ? Math.max(0, dyn / 2800 * 7.5)
       : 0;
}

/** manifold pressure, in.Hg — idle ~12, full throttle ~52 → "The supercharger" */
function _simpleManifold() {
  return (S.wow || (S.spdT ?? 0) === 0) ? 12 : 12 + _throttle() * 40;
}

/* ════════════════════════════════════════════════════════════
   INSTRUMENT REGISTRY — what each instrument shows and how it is drawn.
   `read` takes the value from the sim (never the drawing code); `value` names it; `simple` marks a
   stand-in and what replaces it. `draw` per unit system gets (ctx, x, y, r, sc, value).
   ════════════════════════════════════════════════════════════ */
export const INSTRUMENTS = {
  asi:     { value: 'S.spd (kt)',                         read: () => S.spd ?? 0,
             draw: { metric: _drawFahrtmesser, imperial: _drawAirspeed } },
  ai:      { value: 'S.pitch, S.roll (°)',                 read: () => ({ pitch: S.pitch ?? 0, roll: S.roll ?? 0 }),
             draw: { metric: _drawHorizont, imperial: _drawHorizon } },
  alt:     { value: 'S.alt (ft)',                         read: () => S.alt ?? 0,
             draw: { metric: _drawHoehenmesser, imperial: _drawAltimeter } },
  turn:    { value: 'turn rate, ball (S.latAccel)',         read: () => ({ rate: (S.roll ?? 0) / 20, ball: ballDeflection(S.latAccel) }),
             simple: 'the turn rate from the bank angle → the rate of heading change',
             draw: { metric: _drawWendezeiger, imperial: _drawTurnSlip } },
  compass: { value: 'S.hdg (°)',                          read: () => S.hdg ?? 0,
             draw: { metric: _drawKompass, imperial: _drawCompass } },
  vsi:     { value: 'S.vs (fpm)',                         read: () => S.vs ?? 0,
             draw: { metric: _drawVariometer, imperial: _drawVSI } },
  rpm:     { value: 'rpm',                                read: _simpleRpm, simple: 'S.engines[i].rpm (core/engine.js)',
             draw: { metric: _drawDrehzahl, imperial: _drawDrehzahl } },
  n1:      { value: 'N1 (%)',                             read: _simpleN1, simple: 'S.engines[i].n1 (core/engine.js)',
             draw: { metric: _drawN1Messer } },
  map:     { value: 'manifold pressure (in.Hg)',          read: _simpleManifold, simple: 'The supercharger (issues.md)',
             draw: { imperial: _drawManifold } },
  oilT:    { value: 'S.oilTempC (°C)',                    read: () => S.oilTempC ?? 15,
             draw: { metric: _drawOelTemp, imperial: _drawOilTemp } },
  coolant: { value: 'S.coolantTemp (°C) — coolant, or CHT on an air-cooled engine', read: () => S.coolantTemp ?? 15,
             draw: { metric: _drawKuehlstoffTemp, imperial: _drawCHT } },
  oilP:    { value: 'oil pressure (kg/cm²)',              read: _simpleOilPress, simple: 'The oil system (issues.md)',
             draw: { metric: _drawOelDruck, imperial: _drawOilPressure } },
  clock:   { value: 'the clock time (display/clock.js)',  read: () => null,
             draw: { metric: (ctx, x, y, r) => drawAnalogClock(ctx, x, y, r), imperial: (ctx, x, y, r) => drawAnalogClock(ctx, x, y, r) } },
};

/** Draw one instrument of the registry in the active style's unit system */
function _inst(id, ctx, x, y, r, sc, scale) {
  const def = INSTRUMENTS[id], draw = def?.draw[ST.units ?? 'metric'];
  if (!draw) { _warnOnce(`analog panel: no ${ST.units} drawing of "${id}"`); return; }
  draw(ctx, x, y, r, sc, def.read(), scale);
}
const _warned = new Set();
function _warnOnce(msg) { if (!_warned.has(msg)) { _warned.add(msg); console.warn(msg); } }

/** A large (L) dial at most this many CSS px — a bigger screen gets more room, not bigger dials */
const MAX_L = 200;

/* The HTML overlays at the panel's top corners — the map (top right), the mission title, timer and the
   KEYS button (top left). The layout keeps clear of those over the canvas, the same on both sides so
   the panel stays centred. Measured at most every 250 ms (getBoundingClientRect, not every frame). */
const OVERLAYS = ['minimap', 'mission-title', 'mission-clock', 'sim-flags'];
let _inset = { at: -1, canvas: null, px: 0 };
function _overlayInset(canvas) {
  const now = performance.now();
  if (_inset.canvas === canvas && now - _inset.at < 250) return _inset.px;
  const c = canvas.getBoundingClientRect();
  let left = 0, right = 0;
  for (const id of OVERLAYS) {
    const el = document.getElementById(id);
    if (!el || getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom <= c.top || r.top >= c.bottom) continue;          // not over this canvas
    if (r.left + r.width / 2 < c.left + c.width / 2) left = Math.max(left, r.right - c.left);
    else right = Math.max(right, c.right - r.left);
  }
  _inset = { at: now, canvas, px: Math.max(left, right) };
  return _inset.px;
}

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

  /* The instruments and where they go: the aircraft's groups (analogPanel), laid out by the flowing
     layout for the view (display/panel_flow.js). The status bar
     (#panel, 80 px) covers the bottom of both views; a large dial is at most MAX_L CSS px. */
  const dpr  = devicePixelRatio;
  const view = canvas.classList.contains('combined') ? 'combined' : 'panel';
  const side = _overlayInset(canvas) * dpr;          // keep clear of the map and the mission title / timer
  const area = { w: W - 2 * side, h: H - 80 * dpr };
  const groups = S.aircraft?.analogPanel?.groups ?? [];   // the aircraft's instruments (core/schema/aircraft.js)
  const lay  = flowLayout(groups, area, { view, engines: S.aircraft?.engine?.count ?? 1, maxL: MAX_L * dpr });
  const sc   = (SIZES.L * lay.scale / 2) / 90;        // the text scale: 1 at a large dial of radius 90 px
  for (const it of lay.items) _inst(it.id, ctx, side + it.x, it.y, it.d / 2, sc, it.item?.scale);

  if (ST.frost) _drawFrost(ctx, W, H);              // frost vignette — Arctic, -22 °C
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
/* ════════════════════════════════════════════════════════════
   SCALE — a dial's arcs, ticks and numerals, from the instrument's `scale` in the aircraft data over the
   dial's defaults. Returns value → angle (degrees from 12 o'clock, clockwise).
     min, max     the scale's ends (in the dial's unit)       step   numerals every …   tick  major ticks every …
     minor        minor ticks per major                        div    numeral = value ÷ div (rpm × 100)
     sweep        degrees the scale runs round the dial (default 280)
     start        where the scale (min) begins, degrees from 12 o'clock — default: the sweep centred on the bottom
     zero         a 0 mark before min — an airspeed dial reads nothing useful below the stall
     red          from → max, or [a, b];   yellow, green   [a, b];   redLine  a red radial mark at a value (or several)
   An aircraft's scale brings its own arcs: the dial's default arcs apply only without one.
   ════════════════════════════════════════════════════════════ */
function _scale(ctx, x, y, r, sc, scale, def) {
  const arcs = scale ? {} : { red: def.red, yellow: def.yellow, green: def.green };
  const A = { min: 0, minor: 5, div: 1, sweep: 280, ...def, red: undefined, yellow: undefined, green: undefined, ...arcs, ...scale };
  const tick = A.tick ?? A.step, zeroGap = A.zero ? 24 : 0;
  const sMin = A.start ?? 180 + (360 - A.sweep) / 2 + zeroGap, s0 = sMin - zeroGap, sw = A.sweep - (A.start == null ? zeroGap : 0);
  const ang = v => (A.zero && v < A.min) ? s0 + Math.max(0, v / A.min) * zeroGap
                 : sMin + Math.min(1, A.noClampLow ? (v - A.min) / (A.max - A.min) : Math.max(0, (v - A.min) / (A.max - A.min))) * sw;

  const band = ([a, b], col, lw) => {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * 0.96, _r(ang(a)), _r(ang(b)));
    ctx.strokeStyle = col; ctx.lineWidth = lw * sc; ctx.stroke(); ctx.restore();
  };
  if (A.red != null)  band(Array.isArray(A.red) ? A.red : [A.red, A.max], A.redCol ?? '#a02200', 5);
  if (A.yellow)       band(A.yellow, '#cc9900', 4);
  if (A.green)        band(A.green,  '#3a7a3a', 4);
  for (const v of [A.redLine ?? []].flat()) {                          // a red radial line — a limit mark
    const a = _r(ang(v));
    ctx.save(); ctx.strokeStyle = A.redCol ?? '#a02200'; ctx.lineWidth = 3 * sc; ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.99, y + Math.sin(a) * r * 0.99);
    ctx.lineTo(x + Math.cos(a) * r * 0.80, y + Math.sin(a) * r * 0.80); ctx.stroke(); ctx.restore();
  }

  _ticks(ctx, x, y, r, sMin, sw, (A.max - A.min) / tick, A.minor, sc);
  ctx.textBaseline = 'middle';
  const marks = [A.min];
  for (let v = Math.floor(A.min / A.step) * A.step + A.step; v <= A.max + 1e-9; v += A.step)
    if (v - A.min >= A.step / 2) marks.push(v);                     // a figure too close to the start would collide with it
  if (A.zero) { _ticks(ctx, x, y, r, s0, 0, 1, 1, sc); marks.unshift(0); }
  for (const v of marks) _num(ctx, x, y, r, ang(v), v === 0 ? '0' : String(+(v / A.div).toFixed(2)), A.numSize ?? 8.5, sc);
  ctx.textBaseline = 'alphabetic';
  return ang;
}
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
function _drawFahrtmesser(ctx, x, y, r, sc, kt, scale) {
  _drawAsi(ctx, x, y, r, sc, kt, scale, { unit: 'km/h', max: 800, step: 100, red: 620, redCol: '#882200' });
}

/* ════════════════════════════════════════════════════════════
   KÜNSTLICHER HORIZONT — Artificial Horizon
   ════════════════════════════════════════════════════════════ */
function _drawHorizont(ctx, x, y, r, sc, att) {
  _base(ctx, x, y, r);

  const pitch = att.pitch;
  const roll  = att.roll;

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
function _drawHoehenmesser(ctx, x, y, r, sc, alt) {
  const altM = alt * 0.3048;
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
function _drawWendezeiger(ctx, x, y, r, sc, turn) {
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
  const deflect = Math.max(-1, Math.min(1, turn.rate));
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
  ctx.beginPath(); ctx.arc(x + turn.ball * 13.5 * sc, ballY, 6.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.strokeStyle = P.mark; ctx.lineWidth = 0.8 * sc; ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  _label(ctx, x, y, r, L.turn, sc);
}

/* ════════════════════════════════════════════════════════════
   KOMPASS — rotating rose, fixed lubber line
   Labels: N O S W (German cardinal directions)
   ════════════════════════════════════════════════════════════ */
function _drawKompass(ctx, x, y, r, sc, hdg) {
  _base(ctx, x, y, r);


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
function _drawVariometer(ctx, x, y, r, sc, vs) {
  const vsMs = vs * 0.00508;
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
function _drawDrehzahl(ctx, x, y, r, sc, rpm, scale) {
  _base(ctx, x, y, r);
  const ang = _scale(ctx, x, y, r, sc, scale, { max: 2800, step: 400, tick: 200, minor: 2, div: 100, numSize: 7.5, noClampLow: true });
  _sublabel(ctx, x, y, r, L.rpmUnit, sc);
  _needle(ctx, x, y, r, ang(rpm), 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.rpm, sc);
}

/* N1 Verdichter — turbojet N1 % (replaces Drehzahlmesser when engine is jet) */
function _drawN1Messer(ctx, x, y, r, sc, n1) {
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
function _drawOelTemp(ctx, x, y, r, sc, oilC) {
  const oilT = Math.max(0, Math.min(130, oilC));
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
function _drawKuehlstoffTemp(ctx, x, y, r, sc, coolC) {
  const maxT = 130;
  const cT   = Math.max(0, Math.min(maxT, coolC));
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
function _drawOelDruck(ctx, x, y, r, sc, oilP) {                 // kg/cm² (atü)
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
function _drawAirspeed(ctx, x, y, r, sc, kt, scale) {
  _drawAsi(ctx, x, y, r, sc, kt, scale, { unit: 'kt', max: 400, step: 50, red: 362, yellow: [200, 250], redCol: '#cc2200' });
}

/** The airspeed dial — metric and imperial alike; the scale (unit, range, arcs) from the aircraft's data,
    else the dial's defaults (today's: the Bf 109's 0–800 km/h, the F4U's 0–400 kt) */
const ASI_FACTOR = { kt: 1, 'km/h': 1.852, mph: 1.15078 };
function _drawAsi(ctx, x, y, r, sc, kt, scale, def) {
  _base(ctx, x, y, r);
  const unit = scale?.unit ?? def.unit;
  const ang  = _scale(ctx, x, y, r, sc, scale, { ...def, numSize: 8.5 });
  _sublabel(ctx, x, y, r, L.asiUnit, sc);
  _needle(ctx, x, y, r, ang(kt * ASI_FACTOR[unit]), 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, L.asi, sc);
}

/* ════════════════════════════════════════════════════════════
   ARTIFICIAL HORIZON — Pacific atmosphere
   ════════════════════════════════════════════════════════════ */
function _drawHorizon(ctx, x, y, r, sc, att) {
  _base(ctx, x, y, r);

  const pitch = att.pitch;
  const roll  = att.roll;

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
function _drawAltimeter(ctx, x, y, r, sc, alt) {
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
function _drawTurnSlip(ctx, x, y, r, sc, turn) {
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

  const deflect = Math.max(-1, Math.min(1, turn.rate));
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
  ctx.beginPath(); ctx.arc(x + turn.ball * 13.5 * sc, ballY, 6.5 * sc, 0, Math.PI * 2);
  ctx.fillStyle = P.ndlBack; ctx.fill();
  ctx.strokeStyle = P.mark; ctx.lineWidth = 0.8 * sc; ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  _label(ctx, x, y, r, L.turn, sc);
}

/* ════════════════════════════════════════════════════════════
   COMPASS — rotating rose, English cardinals
   ════════════════════════════════════════════════════════════ */
function _drawCompass(ctx, x, y, r, sc, hdg) {
  _base(ctx, x, y, r);


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
function _drawVSI(ctx, x, y, r, sc, vs) {
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
function _drawManifold(ctx, x, y, r, sc, mp) {                  // in.Hg
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
function _drawOilTemp(ctx, x, y, r, sc, oilC) {
  /* Convert oilTempC (°C) to °F */
  const oilF = Math.max(0, Math.min(300, (oilC * 9/5) + 32));
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
function _drawCHT(ctx, x, y, r, sc, coolC) {
  const maxT = 500;
  const chtF = Math.max(0, Math.min(maxT, (coolC * 9/5) + 32));
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
function _drawOilPressure(ctx, x, y, r, sc, oilKg) {
  const oilP = oilKg * 14.223;                                   // kg/cm² → PSI
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
