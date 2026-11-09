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
import { indicatedAlt, baroSubscale } from '../core/baro.js';
import { flowLayout, SIZES } from './panel_flow.js';

/* ── Styles — the look and the language of the panel. luftwaffe: the Bf 109 E-4 D-FEML's black faces with
   white figures and needles (and the MiG-15, which borrows it until its own step). soviet: a stop-gap for the Tu-95 and the An-225 until each has its own
   sourced panel (issues.md, "The Avro 504, Tu-95 and An-225 fly on a leftover glass PFD") — black
   faces with white markings on the turquoise Soviet cockpit paint, Russian labels; metric like the
   German instruments, so the scales stay. ── */
const STYLES = {
  luftwaffe: {
    P: {
      panel:    '#22261d',   // feldgrau — dark olive-grey Luftwaffe panel
      rim:      '#141610',   // bezel ring — blackened steel
      faceHi:   '#2c2c2a',   // dial face highlight — D-FEML's faces are black (photo, 2026-11-09)
      face0:    '#191918',   // dial face centre
      face1:    '#0b0b0a',   // dial face edge shadow
      capIn:    '#3c3a36',   // centre cap, inner
      needle:   '#ece6d4',   // white needles, as the figures
      ndlBack:  '#222220',   // needle counterweight — dark
      mark:     '#ece6d6',   // index marks & numerals — white
      subdued:  '#9a9488',   // secondary label
      shadowEdge: 'rgba(0,0,0,0.72)', ring: '#2a2c24', glintA: 0.35, glint0: 'rgba(210,230,255,0.16)', glint1: 'rgba(210,230,255,0.04)',
      capOut: '#141410', label: '#c8c0a4', vignette: 'rgba(0,0,0,0.52)',
      shadow:   'rgba(0,0,0,0.65)',
    },
    sky: ['#3a5468', '#5878a0'],                 // Arctic sky — cold pale blue
    ground: ['#4a3c28', '#3c3020', '#c8c4b8'],   // tundra, snow on flat ground
    frost: true,                                 // Wolfskopf 1942, Petsamo, -22 °C
    rings: { fuel: '#d8b030', oil: '#9a5a28', oilPress: '#b02a18', coolant: '#3a8a6a' },   // the German colour code by medium (D-FEML)
    units: 'metric',
    L: {
      asi: 'Fahrtmesser', asiUnit: 'km/h', ai: 'Künstl. Horizont', alt: 'Höhenmesser', altUnit: '×100 m',
      turn: 'Wendezeiger', turnL: 'L', turnR: 'R', turnTop: 'DREHT', turnBottom: 'HÄNGT', compass: 'Kompass', cards: ['N', 'O', 'S', 'W'],
      vsi: 'Variometer', vsiUnit: 'm/s', rpm: 'Drehzahlmesser', rpmUnit: '×100 U/min', n1: 'Verdichter', n1Unit: 'N1 %',
      oilT: 'Öltemperatur', coolant: 'Kühlstoff', oilP: 'Öldruck', oilPUnit: 'atü',
      map: 'Ladedruck', amps: 'Strommesser', fuel: 'Kraftstoffvorrat', fuelOilP: 'Kraftstoff- u. Öldruck', pitch: 'Luftschraube',
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
      airP: 'Air Pressure', pulsator: 'Oil Pulsator', watch: 'Watch',
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
/* ── The fractional part, also below zero (an altimeter below sea level turns back, not into a gap) ── */
const _frac = v => ((v % 1) + 1) % 1;

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

const _fuelLitres = () => (S.fuelLeft ?? 0) + (S.fuelRight ?? 0);
const _fuelFlows  = () => !S.fuelShutoff && _fuelLitres() > 0;

/** fuel pressure, kg/cm² — the engine-driven pump: normal while running with fuel (1.3, unconfirmed), building on the
    start, falling over the starvation run-down once the cock is closed or the tank empty → "The fuel system" */
function _simpleFuelPress() {
  const st = S.engineState, normal = 1.3;
  if (st === 'starting') return Math.min(normal, (getRpmValue() ?? 0) / 400 * normal);
  if (st !== 'running') return 0;
  if (_fuelFlows() && S.fuelStarveT == null) return normal;
  return normal * Math.max(0, Math.min(1, (S.fuelStarveT ?? 0) / 10));
}

/** generator current, A — charging while the engine runs, nothing at rest → an electrical model for the warbirds */
function _simpleAmps() { return S.engineState === 'running' ? 18 : 0; }

/** the propeller pitch in "clock hours" from 12:00 — S.propPitch 1 fine … 0 coarse; the hours per degree are not
    known (sources/bf109-panel-notes.md) → the propeller's blade angle */
function _simplePitchHours() { return (1 - (S.propPitch ?? 1)) * 6; }

/** the fuel tank's air pressure, lb/sq in — the Avro's hand-pumped tank, kept at about 3 while there is fuel → "The fuel system" */
function _simpleTankPress() { return _fuelFlows() ? 3.0 : 0; }

/* ════════════════════════════════════════════════════════════
   INSTRUMENT REGISTRY — what each instrument shows and how it is drawn.
   `read` takes the value from the sim (never the drawing code); `value` names it; `simple` marks a
   stand-in and what replaces it. `draw` per unit system gets (ctx, x, y, r, sc, value).
   ════════════════════════════════════════════════════════════ */
/** the same drawing in both unit systems — the kinds whose scale is the instrument's own, not the style's */
function _both(fn) { return { metric: fn, imperial: fn }; }

export const INSTRUMENTS = {
  asi:     { value: 'S.spd (kt)',                         read: () => S.spd ?? 0,
             draw: { metric: _drawFahrtmesser, imperial: _drawAirspeed } },
  ai:      { value: 'S.pitch, S.roll (°)',                 read: () => ({ pitch: S.pitch ?? 0, roll: S.roll ?? 0 }),
             draw: { metric: _drawHorizont, imperial: _drawHorizon } },
  alt:     { value: 'indicated altitude (ft) and the subscale (hPa) — core/baro.js', variants: ['standard', 'kmWindow'],
             read: () => ({ ft: indicatedAlt(S.alt ?? 0), hpa: baroSubscale() }),
             draw: { metric: (ctx, x, y, r, sc, v, scale, variant) => variant === 'kmWindow' ? _drawKmWindowAlt(ctx, x, y, r, sc, v) : _drawHoehenmesser(ctx, x, y, r, sc, v.ft),
                     imperial: (ctx, x, y, r, sc, v, scale, variant) => variant === 'kmWindow' ? _drawKmWindowAlt(ctx, x, y, r, sc, v) : _drawAltimeter(ctx, x, y, r, sc, v.ft) } },
  turn:    { value: 'turn rate, ball (S.latAccel)',         read: () => ({ rate: (S.roll ?? 0) / 20, ball: ballDeflection(S.latAccel) }),
             simple: 'the turn rate from the bank angle → the rate of heading change',
             draw: { metric: _drawWendezeiger, imperial: _drawTurnSlip } },
  compass: { value: 'S.hdg (°)',                          read: () => S.hdg ?? 0, variants: ['card', 'bubble'],
             draw: { metric: (ctx, x, y, r, sc, v, scale, variant) => (variant === 'bubble' ? _drawBubbleCompass : _drawKompass)(ctx, x, y, r, sc, v),
                     imperial: (ctx, x, y, r, sc, v, scale, variant) => (variant === 'bubble' ? _drawBubbleCompass : _drawCompass)(ctx, x, y, r, sc, v) } },
  vsi:     { value: 'S.vs (fpm)',                         read: () => S.vs ?? 0,
             draw: { metric: _drawVariometer, imperial: _drawVSI } },
  rpm:     { value: 'rpm',                                read: _simpleRpm, simple: 'S.engines[i].rpm (core/engine.js)',
             draw: { metric: _drawDrehzahl, imperial: _drawDrehzahl } },
  n1:      { value: 'N1 (%)',                             read: _simpleN1, simple: 'S.engines[i].n1 (core/engine.js)',
             draw: { metric: _drawN1Messer } },
  oilT:    { value: 'S.oilTempC (°C)',                    read: () => S.oilTempC ?? 15,
             draw: { metric: (ctx, x, y, r, sc, v, scale) => scale ? _drawGauge(ctx, x, y, r, sc, v, scale, { max: 130, step: 20, ring: 'oil', big: '°C', name: 'oilT' })
                                                                    : _drawOelTemp(ctx, x, y, r, sc, v),
                     imperial: _drawOilTemp } },
  coolant: { value: 'S.coolantTemp (°C) — coolant, or CHT on an air-cooled engine', read: () => S.coolantTemp ?? 15,
             draw: { metric: (ctx, x, y, r, sc, v, scale) => scale ? _drawGauge(ctx, x, y, r, sc, v, scale, { max: 130, step: 20, ring: 'coolant', big: '°C', name: 'coolant' })
                                                                    : _drawKuehlstoffTemp(ctx, x, y, r, sc, v),
                     imperial: _drawCHT } },
  oilP:    { value: 'oil pressure (kg/cm²)',              read: _simpleOilPress, simple: 'The oil system (issues.md)',
             draw: { metric: _drawOelDruck, imperial: _drawOilPressure } },
  map:     { value: 'manifold pressure (in.Hg)',          read: _simpleManifold, simple: 'The supercharger (issues.md)',
             draw: { imperial: _drawManifold, metric: _drawLadedruck } },
  amps:    { value: 'generator current (A)',              read: _simpleAmps, simple: 'an electrical model for the warbirds',
             draw: _both((ctx, x, y, r, sc, v, scale) => _drawGauge(ctx, x, y, r, sc, v, scale, { min: -40, max: 60, step: 20, start: 310, sweep: 100, big: 'A', name: 'amps' })) },
  fuel:    { value: 'fuel on board (l): S.fuelLeft + S.fuelRight', read: _fuelLitres,
             draw: _both((ctx, x, y, r, sc, v, scale) => _drawGauge(ctx, x, y, r, sc, v, scale, { max: 400, step: 100, div: 100, start: 290, sweep: 140, ring: 'fuel', big: 'L', sub: '×100', name: 'fuel' })) },
  fuelLow: { value: 'the fuel below the reserve (40 l, unconfirmed)', read: () => S.engineState !== 'off' && _fuelLitres() < 40, kind: 'lamp',
             draw: _both((ctx, x, y, r, sc, on) => _drawLamp(ctx, x, y, r, on, LAMP.red)) },
  gear:    { value: 'S.gearAnim — EIN lit retracted, AUS lit extended', read: () => S.gearAnim ?? (S.gear ? 1 : 0),
             draw: _both(_drawGearLamps) },
  fuelOilP:{ value: 'fuel and oil pressure (kg/cm²)',     read: () => ({ fuel: _simpleFuelPress(), oil: _simpleOilPress() }),
             simple: 'The fuel system, The oil system (issues.md)', draw: _both(_drawDoppeldruck) },
  pitch:   { value: 'propeller pitch in clock hours',     read: _simplePitchHours, simple: 'the propeller\'s blade angle',
             draw: _both(_drawPitchClock) },
  airP:    { value: 'fuel tank air pressure (lb/sq in)',  read: _simpleTankPress, simple: 'The fuel system (issues.md)',
             draw: _both((ctx, x, y, r, sc, v, scale) => _drawGauge(ctx, x, y, r, sc, v, scale, { max: 5, step: 1, start: 310, sweep: 100, big: 'lb/sq in', name: 'airP' })) },
  pulsator:{ value: 'oil flowing — the rotary running (rpm)', read: () => S.engineState === 'running' ? _simpleRpm() : 0,
             simple: 'The oil system (issues.md)', kind: 'glass', draw: _both(_drawPulsator) },
  level:   { value: 'the ball (S.latAccel)',              read: () => ballDeflection(S.latAccel), kind: 'level',
             draw: _both(_drawLevel) },
  clock:   { value: 'the clock time (display/clock.js)',  read: () => null,
             draw: { metric: (ctx, x, y, r) => drawAnalogClock(ctx, x, y, r), imperial: (ctx, x, y, r) => drawAnalogClock(ctx, x, y, r) } },
};

/** Draw one instrument of the registry in the active style's unit system */
function _inst(id, ctx, x, y, r, sc, scale, variant) {
  const def = INSTRUMENTS[id], draw = def?.draw[ST.units ?? 'metric'];
  if (!draw) { _warnOnce(`analog panel: no ${ST.units} drawing of "${id}"`); return; }
  draw(ctx, x, y, r, sc, def.read(), scale, variant);
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
  const groups = (S.aircraft?.analogPanel?.groups ?? []).map(g => {   // the aircraft's instruments, each with its kind's footprint
    const k = e => ({ ...e, kind: INSTRUMENTS[e.id]?.kind });
    return g.rows ? { ...g, rows: g.rows.map(r => r.map(k)) } : { ...g, perEngine: g.perEngine.map(k) };
  });
  const lay  = flowLayout(groups, area, { view, engines: S.aircraft?.engine?.count ?? 1, maxL: MAX_L * dpr });
  const sc   = (SIZES.L * lay.scale / 2) / 90;        // the text scale: 1 at a large dial of radius 90 px
  for (const it of lay.items) _inst(it.id, ctx, side + it.x, it.y, it.d / 2, sc, it.item?.scale, it.item?.variant);

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
function _num(ctx, x, y, r, deg, text, sz, sc, rr = 0.70) {
  const a  = _r(deg);
  const nr = r * rr;
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
     red          from → max, or [a, b];   yellow, green   [a, b];   redLine / yellowLine  a radial mark at a value (or several)
     figuresTo    the last figure (the scale may run on past it);   endMark  a small triangle at the end of the scale
   An aircraft's scale brings its own arcs: the dial's default arcs apply only without one.
   ════════════════════════════════════════════════════════════ */
function _scale(ctx, x, y, r, sc, scale, def) {
  const arcs = scale ? {} : { red: def.red, yellow: def.yellow, green: def.green };
  const A = { min: 0, minor: 5, div: 1, sweep: 280, ...def, red: undefined, yellow: undefined, green: undefined, ...arcs, ...scale };
  const tick = A.tick ?? A.step, zeroGap = A.zero ? 24 : 0;
  const sMin = A.start ?? 180 + (360 - A.sweep) / 2 + zeroGap, s0 = sMin - zeroGap, sw = A.sweep - (A.start == null ? zeroGap : 0);
  /* below the scale's start the needle rests at the start — on its stop pin — unless the dial has a 0 mark */
  const ang = v => (A.zero && v < A.min) ? s0 + Math.max(0, v / A.min) * zeroGap
                 : sMin + Math.min(1, Math.max(0, (v - A.min) / (A.max - A.min))) * sw;

  const band = ([a, b], col, lw) => {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * 0.96, _r(ang(a)), _r(ang(b)));
    ctx.strokeStyle = col; ctx.lineWidth = lw * sc; ctx.stroke(); ctx.restore();
  };
  if (A.red != null)  band(Array.isArray(A.red) ? A.red : [A.red, A.max], A.redCol ?? '#a02200', 5);
  if (A.yellow)       band(A.yellow, '#cc9900', 4);
  if (A.green)        band(A.green,  '#3a7a3a', 4);
  const radial = (v, col) => {                                          // a radial line — a limit or caution mark
    const a = _r(ang(v));
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 3 * sc; ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.99, y + Math.sin(a) * r * 0.99);
    ctx.lineTo(x + Math.cos(a) * r * 0.80, y + Math.sin(a) * r * 0.80); ctx.stroke(); ctx.restore();
  };
  for (const v of [A.yellowLine ?? []].flat()) radial(v, '#d8b030');
  for (const v of [A.redLine ?? []].flat())    radial(v, A.redCol ?? '#a02200');
  if (A.endMark) {                                                      // a small triangle at the end of the scale
    const a = _r(ang(A.max)), n = a + Math.PI / 2, tx = x + Math.cos(a) * r * 0.9, ty = y + Math.sin(a) * r * 0.9;
    ctx.save(); ctx.fillStyle = P.mark; ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.76, y + Math.sin(a) * r * 0.76);
    ctx.lineTo(tx + Math.cos(n) * r * 0.06, ty + Math.sin(n) * r * 0.06); ctx.lineTo(tx - Math.cos(n) * r * 0.06, ty - Math.sin(n) * r * 0.06);
    ctx.fill(); ctx.restore();
  }

  _ticks(ctx, x, y, r, sMin, sw, (A.max - A.min) / tick, A.minor, sc);
  ctx.textBaseline = 'middle';
  const marks = [A.min];
  for (let v = Math.floor(A.min / A.step) * A.step + A.step; v <= (A.figuresTo ?? A.max) + 1e-9; v += A.step)
    if (v - A.min >= A.step / 2) marks.push(v);                     // a figure too close to the start would collide with it
  if (A.zero) { _ticks(ctx, x, y, r, s0, 0, 1, 1, sc); marks.unshift(0); }
  for (const v of marks) _num(ctx, x, y, r, ang(v), v === 0 ? '0' : String(+(v / A.div).toFixed(2)), A.numSize ?? 8.5, sc, A.numR);
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
  const s0   = 0, sw = 360;                 // a full circle, 0 at the top — no gap, no jump at each turn

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
  const angCoarse = s0 + _frac(altM / 10000) * sw;
  const ac = _r(angCoarse);
  ctx.strokeStyle = P.subdued; ctx.lineWidth = 2.4 * sc;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(ac) * r * 0.44, y + Math.sin(ac) * r * 0.44);
  ctx.stroke();

  /* Fine 1 000 m needle */
  const angFine = s0 + _frac(altM / 1000) * sw;
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
  /* D-FEML: "DREHT" over the turn needle, "HÄNGT" under the ball */
  ctx.font = `bold ${7 * sc}px ${SANS}`;
  if (L.turnTop)    ctx.fillText(L.turnTop, x, y - r * 0.9);
  if (L.turnBottom) ctx.fillText(L.turnBottom, x, y + r * 0.84);

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
  const ang = _scale(ctx, x, y, r, sc, scale, { max: 2800, step: 400, tick: 200, minor: 2, div: 100, numSize: 7.5 });
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
  const ang = s0 + Math.max(0, Math.min(1, n1 / maxN1)) * sw;
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

  const ang = s0 + Math.max(0, Math.min(1, oilP / maxP)) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.oilP, sc);
}

/* ════════════════════════════════════════════════════════════
   THE KINDS FROM THE SOURCES (step 5) — D-FEML's lower panel, the Avro's board
   (sources/bf109-panel-notes.md, sources/avro-504k-panel-notes.md; tried in docs/mockups/analog-instrument-kinds.html)
   ════════════════════════════════════════════════════════════ */

/** The bezel ring in the German colour code by medium — fuel yellow, oil brown, oil pressure red, coolant green
    (D-FEML); only where the style has one (ST.rings) */
function _ring(ctx, x, y, r, medium, a0 = 0, a1 = Math.PI * 2) {
  const col = ST.rings?.[medium];
  if (!col) return;
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = r * 0.07;
  ctx.beginPath(); ctx.arc(x, y, r * 1.0, a0, a1); ctx.stroke(); ctx.restore();
}

/** A needle from a pivot below the centre to a point on the scale — the dials whose scale is an arc across the top
    (D-FEML's ammeter, fuel, oil and coolant; the Avro's air pressure) */
function _lowNeedle(ctx, x, y, r, deg, sc) {
  const py = y + r * 0.2, a = _r(deg), tx = x + Math.cos(a) * r * 0.8, ty = y + Math.sin(a) * r * 0.8;
  const len = Math.hypot(tx - x, ty - py), d = Math.atan2(ty - py, tx - x) * 180 / Math.PI + 90;
  _needle(ctx, x, py, len, d, 1, 0.18, sc);
  _cap(ctx, x, py, 4 * sc);
}

/** A dial drawn from its scale — the default (`def`) under the aircraft's `scale`. An arc of up to a half circle
    across the top gets the low pivot. `big`: the unit in large letters (A, L, °C); `ring`: the medium's colour. */
function _drawGauge(ctx, x, y, r, sc, v, scale, def) {
  _base(ctx, x, y, r);
  if (def.ring) _ring(ctx, x, y, r, def.ring);
  const sweep = scale?.sweep ?? def.sweep ?? 280, low = sweep <= 180;
  const ang = _scale(ctx, x, y, r, sc, scale, { numSize: 7.5, minor: 4, ...def, numR: low ? 0.66 : 0.70 });
  if (def.sub) _sublabel(ctx, x, y - r * (low ? 0.0 : 0.85), r, def.sub, sc);
  if (def.big) {
    ctx.fillStyle = P.mark; ctx.font = `bold ${(def.big.length > 2 ? 8 : 15) * sc}px ${SANS}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(def.big, x, y + r * 0.6);
  }
  if (low) _lowNeedle(ctx, x, y, r, ang(v), sc);
  else { _needle(ctx, x, y, r, ang(v), 0.76, 0.20, sc); _cap(ctx, x, y, 4 * sc); }
  if (def.name && L[def.name]) _label(ctx, x, y, r, L[def.name], sc);
}

/** Boost (Ladedruck) in ata — the metric twin of the manifold gauge; the value comes in in.Hg */
function _drawLadedruck(ctx, x, y, r, sc, inHg, scale) {
  _drawGauge(ctx, x, y, r, sc, inHg / 28.959, scale, { min: 0.6, max: 1.8, step: 0.2, minor: 4, sub: 'ata', name: 'map' });
}

/** Fuel and oil pressure on one face (D-FEML, Fl 20512-2): two half dials, two hands from the centre; 0 at the
    bottom, fuel 0–2 up the left (yellow), oil 0–10 up the right (red), kg/cm² */
function _drawDoppeldruck(ctx, x, y, r, sc, p) {
  _base(ctx, x, y, r);
  _ring(ctx, x, y, r, 'fuel', Math.PI / 2, Math.PI * 1.5);
  _ring(ctx, x, y, r, 'oilPress', -Math.PI / 2, Math.PI / 2);
  const fuelA = v => 180 + Math.max(0, Math.min(1, v / 2)) * 150, oilA = v => 180 - Math.max(0, Math.min(1, v / 10)) * 150;
  _ticks(ctx, x, y, r, 180, 150, 4, 5, sc);
  _ticks(ctx, x, y, r, 30, 150, 5, 4, sc);
  ctx.textBaseline = 'middle';
  for (const v of [0.5, 1, 1.5, 2]) _num(ctx, x, y, r, fuelA(v), String(v), 7, sc);
  for (const v of [2, 4, 6, 8, 10]) _num(ctx, x, y, r, oilA(v), String(v), 7, sc);
  _num(ctx, x, y, r, 180, '0', 7.5, sc);
  ctx.textBaseline = 'alphabetic';
  _sublabel(ctx, x, y - r * 0.75, r, 'kg/cm²', sc);
  _needle(ctx, x, y, r, fuelA(p.fuel), 0.74, 0.16, sc);
  _needle(ctx, x, y, r, oilA(p.oil), 0.74, 0.16, sc);
  _cap(ctx, x, y, 4 * sc);
  if (L.fuelOilP) _label(ctx, x, y, r, L.fuelOilP, sc);
}

/** The propeller pitch indicator (Fl 18503-2): a clock face, two hands, from 12:00 */
function _drawPitchClock(ctx, x, y, r, sc, hours) {
  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, 0, 360, 12, 5, sc);
  ctx.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) _num(ctx, x, y, r, h * 30, String(h), 7, sc);
  ctx.textBaseline = 'alphabetic';
  const t = ((hours % 12) + 12) % 12;
  _needle(ctx, x, y, r, t * 30, 0.5, 0.14, sc);
  _needle(ctx, x, y, r, (t * 60 % 60) * 6, 0.78, 0.18, sc);
  _cap(ctx, x, y, 4 * sc);
  if (L.pitch) _label(ctx, x, y, r, L.pitch, sc);
}

const LAMP = { red: { on: ['#ff5a3a', '#a01808'], off: ['#4a1a12', '#200806'] },
               green: { on: ['#6aff7a', '#108a20'], off: ['#173a1c', '#08160a'] } };
function _drawLamp(ctx, x, y, r, on, col) {
  ctx.fillStyle = '#0c0c0c'; ctx.beginPath(); ctx.arc(x, y, r * 1.0, 0, Math.PI * 2); ctx.fill();
  const c = on ? col.on : col.off, g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.08, x, y, r * 0.8);
  g.addColorStop(0, on ? '#ffffff' : c[0]); g.addColorStop(0.35, c[0]); g.addColorStop(1, c[1]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
  if (on) { ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
}

/** The gear indicator (D-FEML, "Fahrgestell"): EIN red (retracted) and AUS green (extended), left and right;
    dark while the gear travels */
function _drawGearLamps(ctx, x, y, r, sc, anim) {
  const w = r * 1.9, h = r * 1.7;
  ctx.save();
  ctx.fillStyle = '#121312'; ctx.strokeStyle = P.rim; ctx.lineWidth = 2 * sc;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, r * 0.1); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c8c0a8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${7 * sc}px ${SANS}`; ctx.fillText(L.gear ?? 'Fahrgestell', x, y - h * 0.38);
  const up = anim <= 0.01, dn = anim >= 0.99, lr = r * 0.22;
  for (const dx of [-0.45, 0.45]) {
    _drawLamp(ctx, x + dx * r, y - h * 0.1, lr, up, LAMP.red);
    _drawLamp(ctx, x + dx * r, y + h * 0.27, lr, dn, LAMP.green);
    ctx.fillStyle = '#c8c0a8'; ctx.font = `bold ${5.5 * sc}px ${SANS}`;
    ctx.fillText('EIN', x + dx * r, y - h * 0.1 + lr * 1.45); ctx.fillText('AUS', x + dx * r, y + h * 0.27 + lr * 1.45);
  }
  ctx.restore();
}

/** The Avro's oil pulsator: castor oil pulsing through a sight glass with each pump stroke while the rotary runs */
function _drawPulsator(ctx, x, y, r, sc, rpm) {
  ctx.save();
  ctx.fillStyle = P.rim; ctx.beginPath(); ctx.arc(x, y, r * 1.04, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r * 0.95);
  g.addColorStop(0, 'rgba(255,248,225,0.55)'); g.addColorStop(0.4, 'rgba(160,130,60,0.45)'); g.addColorStop(1, 'rgba(30,20,4,0.95)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.fill();
  if (rpm > 0) {
    const beat = (performance.now() / 1000 * (rpm / 600)) % 1;           // a pulse per pump stroke, faster with rpm
    const lvl = 0.25 + 0.5 * Math.pow(Math.sin(beat * Math.PI), 2);
    ctx.beginPath(); ctx.arc(x, y, r * 0.88, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(200,140,30,0.85)'; ctx.fillRect(x - r, y + r * (0.88 - lvl * 1.76), r * 2, r * 2);
  }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = r * 0.05;
  ctx.beginPath(); ctx.arc(x, y, r * 0.66, _r(-60), _r(-10)); ctx.stroke(); ctx.restore();
  if (L.pulsator) _label(ctx, x, y, r, L.pulsator, sc);
}

/** The Avro's bubble level: a curved glass tube; the bubble moves opposite to a ball */
function _drawLevel(ctx, x, y, r, sc, ball) {
  const R = r * 2.6, cy = y + R - r * 0.25, a0 = -Math.PI / 2 - 0.36, a1 = -Math.PI / 2 + 0.36;
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = P.rim; ctx.lineWidth = r * 0.42; ctx.beginPath(); ctx.arc(x, cy, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = 'rgba(200,215,170,0.9)'; ctx.lineWidth = r * 0.26; ctx.beginPath(); ctx.arc(x, cy, R, a0, a1); ctx.stroke();
  for (const d of [-0.07, 0.07]) {
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5 * sc; ctx.beginPath();
    ctx.moveTo(x + Math.cos(-Math.PI / 2 + d) * (R - r * 0.13), cy + Math.sin(-Math.PI / 2 + d) * (R - r * 0.13));
    ctx.lineTo(x + Math.cos(-Math.PI / 2 + d) * (R + r * 0.13), cy + Math.sin(-Math.PI / 2 + d) * (R + r * 0.13)); ctx.stroke();
  }
  const b = -Math.PI / 2 - Math.max(-1, Math.min(1, ball)) * 0.3;
  ctx.fillStyle = 'rgba(255,255,240,0.95)'; ctx.beginPath();
  ctx.ellipse(x + Math.cos(b) * R, cy + Math.sin(b) * R, r * 0.17, r * 0.1, b + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** The Fein- und Grobhöhenmesser (Fl 22320, D-FEML — variant "kmWindow"): a full circle, one needle turn per
    kilometre (figures every 100 m, 0.0–1.0 km); the whole kilometres on a turning disc behind a cutout in the lower
    face — black, one big figure; the pressure setting (930–1050 mbar) behind a cutout at the top
    (deutscheluftwaffe.de, "Funktionsweise Höhenmesser Fl.22320"; Markus, from photos) */
function _drawKmWindowAlt(ctx, x, y, r, sc, v) {
  const km = Math.max(0, v.ft * 0.0003048), s0 = 180;          // 0 and 1 together at the bottom (D-FEML)
  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, 360, 10, 5, sc);
  ctx.textBaseline = 'middle';
  for (let k = 1; k <= 9; k++) _num(ctx, x, y, r, s0 + k * 36, (k / 10).toFixed(1), 7, sc);
  _num(ctx, x, y, r, s0, '0-1', 7.5, sc);
  /* the pressure window at the top: white, the subscale in mbar */
  const pw = r * 0.42, ph = r * 0.18, py = y - r * 0.4;
  ctx.fillStyle = '#e8e4d8'; ctx.fillRect(x - pw / 2, py - ph / 2, pw, ph);
  ctx.fillStyle = '#111'; ctx.font = `bold ${7 * sc}px ${SANS}`; ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(v.hpa)), x, py);
  ctx.strokeStyle = P.rim; ctx.lineWidth = 1.2 * sc; ctx.strokeRect(x - pw / 2, py - ph / 2, pw, ph);
  /* the kilometre window in the lower face: black, one big figure, rolling on over the last 100 m of each km */
  const ww = r * 0.3, wh = r * 0.32, wy = y + r * 0.36;
  ctx.save();
  ctx.fillStyle = '#060606'; ctx.fillRect(x - ww / 2, wy - wh / 2, ww, wh);
  ctx.beginPath(); ctx.rect(x - ww / 2, wy - wh / 2, ww, wh); ctx.clip();
  const whole = Math.floor(km), roll = Math.max(0, (_frac(km) - 0.9) / 0.1);
  ctx.fillStyle = P.mark; ctx.font = `bold ${14 * sc}px ${SANS}`;
  ctx.fillText(String(whole), x, wy - roll * wh);
  ctx.fillText(String(whole + 1), x, wy + (1 - roll) * wh);
  ctx.restore();
  ctx.strokeStyle = P.rim; ctx.lineWidth = 1.2 * sc; ctx.strokeRect(x - ww / 2, wy - wh / 2, ww, wh);
  ctx.textBaseline = 'alphabetic';
  _needle(ctx, x, y, r, s0 + _frac(km) * 360, 0.78, 0.22, sc);
  _cap(ctx, x, y, 5.5 * sc);
  _label(ctx, x, y, r, L.alt, sc);
}

/** The Führerkompass (Fl 23211, D-FEML — variant "bubble"): the older magnetic compass — a domed window with a plain
    compass strip behind a lubber line, read straight ahead */
function _drawBubbleCompass(ctx, x, y, r, sc, hdg) {
  _base(ctx, x, y, r);
  const ww = r * 1.5, wh = r * 0.5;
  ctx.save();
  ctx.fillStyle = '#d8d0b8';
  ctx.beginPath(); ctx.ellipse(x, y, ww / 2, wh / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.clip();
  /* the strip: 10° per tick, figures every 30°, cardinals in bold; 60° visible across the window */
  const pxPerDeg = ww / 60;
  ctx.fillStyle = '#141414'; ctx.strokeStyle = '#141414'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let d = Math.floor((hdg - 40) / 5) * 5; d <= hdg + 40; d += 5) {
    const px = x + (d - hdg) * pxPerDeg, n = ((d % 360) + 360) % 360;
    ctx.lineWidth = (n % 10 === 0 ? 1.4 : 0.7) * sc;
    ctx.beginPath(); ctx.moveTo(px, y + wh * 0.5); ctx.lineTo(px, y + wh * (n % 10 === 0 ? 0.18 : 0.32)); ctx.stroke();
    if (n % 30 === 0) {
      const c = { 0: L.cards[0], 90: L.cards[1], 180: L.cards[2], 270: L.cards[3] }[n];
      ctx.font = `${c ? 'bold ' : ''}${(c ? 10 : 8) * sc}px ${SANS}`;
      ctx.fillText(c ?? String(n / 10), px, y - wh * 0.12);
    }
  }
  /* the dome's glint */
  const g = ctx.createLinearGradient(x, y - wh / 2, x, y + wh / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.4, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g; ctx.fillRect(x - ww / 2, y - wh / 2, ww, wh);
  ctx.restore();
  ctx.strokeStyle = P.rim; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.ellipse(x, y, ww / 2, wh / 2, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#b02a18'; ctx.lineWidth = 2 * sc;                     // the lubber line
  ctx.beginPath(); ctx.moveTo(x, y - wh * 0.62); ctx.lineTo(x, y + wh * 0.62); ctx.stroke();
  _label(ctx, x, y, r, L.compass, sc);
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
  const s0   = 0, sw = 360;                 // a full circle, 0 at the top — no gap, no jump at each turn

  _base(ctx, x, y, r);
  _ticks(ctx, x, y, r, s0, sw, 10, 5, sc);

  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 9; v++) {
    _num(ctx, x, y, r, s0 + (v / 10) * sw, String(v), 9, sc);
  }
  ctx.textBaseline = 'alphabetic';

  _sublabel(ctx, x, y, r, L.altUnit, sc);

  /* Coarse stub — 10,000 ft revolutions */
  const angCoarse = s0 + _frac(alt / 100000) * sw;
  const ac = _r(angCoarse);
  ctx.strokeStyle = P.subdued; ctx.lineWidth = 2.4 * sc;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(ac) * r * 0.44, y + Math.sin(ac) * r * 0.44);
  ctx.stroke();

  /* Fine needle — 10,000 ft per revolution */
  const angFine = s0 + _frac(alt / 10000) * sw;
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

  const ang = s0 + Math.max(0, Math.min(1, mp / maxP)) * sw;
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

  const ang = s0 + Math.max(0, Math.min(1, oilP / maxP)) * sw;
  _needle(ctx, x, y, r, ang, 0.76, 0.20, sc);
  _cap(ctx, x, y, 4 * sc);
  _label(ctx, x, y, r, L.oilP, sc);
}
