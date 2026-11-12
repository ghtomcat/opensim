/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/panel_renderer.js
   Data-driven PFD/ND compositor + universal cockpit renderer.

   renderPanel(canvas, screenIdx, specOverride?) — Airbus PFD/ND
   renderFCU(canvas)                            — Airbus FCU
   renderCockpit(canvas)                        — DR-400 & future GA
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';
import {
  drawFMA, drawAI, drawSpeedTape, drawAltTape,
  drawVSI, drawHdgTape, drawNDMap, drawFCU, drawECAM, drawEICAS, fcuKnobZones, fcuButtonRegions, qnhHitRegion } from './pfd_instruments.js';
import { drawG1000PFD, drawG1000MFD, drawG1000Bezel } from './g1000.js';
import { drawToggle, drawRocker, drawMagneto, drawSelector } from './controls-canvas.js';
import { hideG1000Map } from './map.js';
import { drawInstrument } from './analog_panel.js';
import { avionicsPowered } from '../core/electrical.js';
import { drawVelisEfis, drawVelisEpsi, drawVelisMap } from './velis_epsi.js';
import { operate, controlState, guardOpen, push, turn, turned } from './controls.js';
import { beginHits, addHit } from './hit.js';

let _currentCanvas = null;   // the canvas being drawn — the click areas are registered on it (display/hit.js)

/* ── Default style fallback for cockpit specs ── */
const _DEFAULT_STYLE = {
  colors: { bg: '#0e1014', white: '#e8edf4', dim: 'rgba(220,230,240,0.38)' },
};

/* ═══════════════════════════════════════════════════════════════
   WIDGET REGISTRY
   ═══════════════════════════════════════════════════════════════ */

const MONO = '"IBM Plex Mono", "Courier New", monospace';

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x,     y + h, x,     y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}


/* ── rocker_strip — large illuminated annunciator pads (the look: display/controls-canvas.js) ── */
function _drawRockerStrip(ctx, box, style, cfg) {
  const switches = cfg.switches ?? [];
  if (!switches.length) return;

  /* strip background */
  ctx.fillStyle = '#0c0d11';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const sw   = box.w / switches.length;
  const padX = sw * 0.035;
  const padY = box.h * 0.10;

  switches.forEach((s, i) => {
    const on         = !!controlState(s.control);
    const guarded    = !!s.guarded;
    const guardIsOpen = guarded && guardOpen(s.control);

    const rx = box.x + i * sw + padX;
    const ry = box.y + padY;
    const rw = sw - padX * 2;
    const rh = box.h - padY * 2;
    drawRocker(ctx, rx, ry, rw, rh, { on, label: s.label, color: s.color, guarded, guardIsOpen });

    addHit(_currentCanvas, { name: s.control, x: rx, y: ry, w: rw, h: rh,
      action: () => operate(s.control, { guarded }) });   // a guarded switch lifts its guard first (display/controls.js)
  });
}

/* ── bottom_switches (bat-handle toggles — display/controls-canvas.js) ── */
function _drawBottomSwitches(ctx, box, style, cfg) {
  const switches = cfg.switches ?? [];
  if (!switches.length) return;
  const sw = box.w / switches.length;
  const padX = sw * 0.15;
  const padY = box.h * 0.06;

  switches.forEach((s, i) => {
    const on  = !!controlState(s.control);
    const rx  = box.x + i * sw + padX;
    const ry  = box.y + padY;
    const rw  = sw - padX * 2;
    const rh  = box.h - padY * 2;

    drawToggle(ctx, rx + rw / 2, ry, Math.min(rw, rh * 1.2), rh, on, s.label);   // the one toggle design (display/controls-canvas.js) — its proportions kept in a wide cell

    /* hit region */
    addHit(_currentCanvas, { name: s.control, x: rx, y: ry, w: rw, h: rh, action: () => operate(s.control) });
  });
}

/* ── g1000_screen (dual PFD | placard | MFD, C172) ── */
function _drawG1000Screen(ctx, box, style, cfg) {
  const powered = avionicsPowered();   // the avionics bus — core/electrical.js
  const { x, y, w, h } = box;

  const centerW = Math.round(w * 0.055);          /* avionics-stack placard */
  const scrTot  = w - centerW;
  const pfdW = Math.round(scrTot * 0.52);
  const mfdW = scrTot - pfdW;
  const cenX = x + pfdW;
  const mfdX = cenX + centerW;
  const bzP  = Math.round(w * 0.004);
  const bzT  = Math.round(h * 0.03);

  drawG1000Bezel(ctx, x,    y, pfdW, h);
  drawG1000Bezel(ctx, mfdX, y, mfdW, h);

  if (powered) {
    drawG1000PFD(ctx, x + bzP,        y + bzT, pfdW - bzP*2, h - bzT*2);
    drawG1000MFD(ctx, _currentCanvas, mfdX + bzP, y + bzT, mfdW - bzP*2, h - bzT*2);
    /* The MFD map (an HTML overlay) hides itself outside the forward panel — _updatePanelMap() in map.js */
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(x + bzP,    y + bzT, pfdW - bzP*2, h - bzT*2);
    ctx.fillRect(mfdX + bzP, y + bzT, mfdW - bzP*2, h - bzT*2);
    hideG1000Map();
  }

  _drawCenterPlacard(ctx, cenX, y, centerW, h);
}

/* Centre placard — aircraft name + registration, between the two screens */
function _drawCenterPlacard(ctx, x, y, w, h) {
  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#08090c'; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  const name = S.aircraft?.name ?? '';
  const reg  = S.aircraft?.registration ?? S.aircraft?.callsign ?? '';

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-Math.PI / 2);                       /* read bottom-to-top */
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(232,240,248,0.82)';       /* registration — bold, bright */
  ctx.font = `bold ${Math.round(w * 0.30)}px ${MONO}`;
  ctx.fillText(reg, 0, -w * 0.16);

  ctx.fillStyle = 'rgba(232,240,248,0.30)';        /* name — smaller, dim */
  ctx.font = `${Math.round(w * 0.17)}px ${MONO}`;
  ctx.fillText(name, 0, w * 0.24);

  ctx.restore();
}

/* ── garmin_gtn (single-screen GTN/G5xx, DR-400) ── */
function _drawGarminGTN(ctx, box, style, cfg) {
  const powered = avionicsPowered();   // the avionics bus — core/electrical.js
  const { x, y, w, h } = box;

  /* outer bezel */
  const bezelGrad = ctx.createLinearGradient(x, y, x, y + h);
  bezelGrad.addColorStop(0, '#2a2c32');
  bezelGrad.addColorStop(1, '#18191e');
  _roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = bezelGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

  /* Garmin label top-left of bezel */
  const lfs = Math.max(6, Math.round(h * 0.028));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = `bold ${lfs}px ${MONO}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('GARMIN', x + 8, y + 4);

  /* screen inset */
  const bzX = Math.round(w * 0.03);
  const bzY = Math.round(h * 0.055);
  const sx = x + bzX;
  const sy = y + bzY;
  const sw = w - bzX * 2;
  const sh = h - bzY * 2;

  if (!powered) {
    ctx.fillStyle = '#000';
    ctx.fillRect(sx, sy, sw, sh);
    hideG1000Map();
    return;
  }

  /* use the MFD content for the single screen (map + engine sidebar) */
  drawG1000MFD(ctx, _currentCanvas, sx, sy, sw, sh);
}

/* ── magneto_knob ── */
function _drawMagnetoKnob(ctx, box, style, cfg) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r  = Math.min(box.w, box.h) * 0.28;

  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  drawMagneto(ctx, cx, cy, r, controlState('magnetos'));

  addHit(_currentCanvas, { name: 'magnetos', ...box, action: () => operate('magnetos') });   // a sweep — display/controls.js
}

/* ── fuel_selector ── */

function _drawFuelSelector(ctx, box, style, cfg) {
  drawSelector(ctx, box.x, box.y, box.w, box.h, controlState('fuelSelector'));

  addHit(_currentCanvas, { name: 'fuelSelector', ...box, action: () => operate('fuelSelector') });
}

/* ── grid (recursive sub-layout) ── */
function _drawGrid(ctx, box, style, cfg) {
  let rowY = box.y;
  for (const row of (cfg.layout ?? [])) {
    const rowH = row.h * box.h;
    let colX   = box.x;
    for (const col of row.cols) {
      const colW = col.w * box.w;
      const sub  = { x: colX, y: rowY, w: colW, h: rowH };
      const fn   = _WIDGETS[col.widget];
      if (fn) fn(ctx, sub, style, col.config ?? {});
      colX += colW;
    }
    rowY += rowH;
  }
}

/* ── aircraft_tag — type / callsign plate ── */
function _drawAircraftTag(ctx, box, style, cfg) {
  const aircraft = S.aircraft ?? {};
  const type     = aircraft.icaoType  ?? '';
  const name     = aircraft.name      ?? '';
  const callsign = aircraft.callsign  ?? '';

  /* dark plate */
  const { x, y, w, h } = box;
  ctx.fillStyle = '#0a0b0e';
  _roundRect(ctx, x + 4, y + h * 0.15, w - 8, h * 0.70, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 0.8; ctx.stroke();

  /* type line */
  const fsT = Math.max(7, Math.round(h * 0.30));
  ctx.fillStyle   = 'rgba(220,225,235,0.75)';
  ctx.font        = `bold ${fsT}px ${MONO}`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(callsign, x + w / 2, y + h * 0.38);

  /* name/type sub-line */
  const fsN = Math.max(6, Math.round(h * 0.20));
  ctx.fillStyle = 'rgba(160,170,185,0.50)';
  ctx.font      = `${fsN}px ${MONO}`;
  /* shorten name to fit: use icaoType + short model fragment */
  const shortName = name.length > 22 ? name.slice(0, 22) : name;
  ctx.fillText(shortName, x + w / 2, y + h * 0.66);
}

/* ═══════════════════════════════════════════════════════════════
   WIDGET MAP
   ═══════════════════════════════════════════════════════════════ */

const _WIDGETS = {
  /* Airbus PFD/ND widgets */
  fma:        (ctx, box, style, cfg) => drawFMA(ctx, box, style),
  ai:         (ctx, box, style, cfg) => drawAI(ctx, box, style, cfg),
  speed_tape: (ctx, box, style, cfg) => drawSpeedTape(ctx, box, style),
  alt_tape:   (ctx, box, style, cfg) => drawAltTape(ctx, box, style),
  vsi:        (ctx, box, style, cfg) => drawVSI(ctx, box, style),
  hdg_tape:   (ctx, box, style, cfg) => drawHdgTape(ctx, box, style),
  nd_map:     (ctx, box, style, cfg) => drawNDMap(ctx, box, style, cfg),
  ecam_ewd:   (ctx, box, style, cfg) =>            // manufacturer seam: Boeing → EICAS, else Airbus ECAM
    (S.aircraft?.manufacturer === 'boeing' ? drawEICAS : drawECAM)(ctx, box, style),
  spacer:     () => {},

  /* GA cockpit widgets */
  grid:            _drawGrid,
  /* a round gauge from the analog panel's registry (display/analog_panel.js) — config: an analogPanel entry
     ({ id, scale, variant }); the look is the cockpit style's `analogStyle` (default 'ga') */
  analog:          (ctx, box, style, cfg) => drawInstrument(ctx, box, cfg, style?.analogStyle ?? 'ga', cfg.key ?? cfg.id),
  /* the Velis's own displays (display/velis_epsi.js) */
  velis_efis:      (ctx, box) => drawVelisEfis(ctx, box),
  velis_epsi:      (ctx, box) => drawVelisEpsi(ctx, box),
  velis_map:       (ctx, box) => drawVelisMap(ctx, box),
  rocker_strip:    _drawRockerStrip,
  bottom_switches: _drawBottomSwitches,
  g1000_screen:    _drawG1000Screen,
  garmin_gtn:      _drawGarminGTN,
  magneto_knob:    _drawMagnetoKnob,
  fuel_selector:   _drawFuelSelector,
  aircraft_tag:    _drawAircraftTag,
};

/* ═══════════════════════════════════════════════════════════════
   AIRBUS CACHE (keyed by aircraft id)
   ═══════════════════════════════════════════════════════════════ */

const _cache = {
  aircraftId: null,
  style:      null,
  specs:      {},
  loading:    false,
};

/* ═══════════════════════════════════════════════════════════════
   COCKPIT CACHE (DR-400 etc.)
   ═══════════════════════════════════════════════════════════════ */

const _cpCache = {
  aircraftId: null,
  spec:       null,
  style:      null,
  loading:    false,
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════ */

export function renderPanel(canvas, screenIdx = 0, specOverride = null) {
  const aircraft = S.aircraft;
  if (!aircraft?.displays?.length) return;

  const aid = aircraft.id;

  if (_cache.aircraftId !== aid) {
    if (!_cache.loading) {
      _cache.loading    = true;
      _cache.aircraftId = aid;
      _cache.specs      = {};
      _cache.style      = null;

      const names = [...new Set(
        aircraft.displays
          .flatMap(d => d.pages ?? [d.spec])
          .filter(Boolean)
      )];
      Promise.all([
        fetch(`panels/styles/${aircraft.panel}.json?v=${Date.now()}`).then(r => r.json()),
        ...names.map(n => fetch(`panels/${n}.json?v=${Date.now()}`).then(r => r.json())),
      ]).then(([style, ...loaded]) => {
        _cache.style = style;
        names.forEach((n, i) => { _cache.specs[n] = loaded[i]; });
        _cache.loading = false;
      }).catch(() => { _cache.loading = false; });
    }
    _blank(canvas);
    return;
  }

  if (!_cache.style) return;

  const display = aircraft.displays.find(d => d.screen === screenIdx);
  if (!display) return;

  const specName = specOverride ?? display.spec;
  const spec = _cache.specs[specName];
  if (!spec) return;

  _render(canvas, spec, _cache.style, true);   // PFD/ND screens: boost fonts when squished (outside view)
  /* the PFD's QNH window — a knob of its own (display/hit.js): a click toggles STD, a drag or the wheel sets it */
  beginHits(canvas);
  const q = screenIdx === 0 ? qnhHitRegion() : null;
  if (q) addHit(canvas, { name: 'pfdQnh', ...q, action: () => push('fcuQnh'),
    turn: (steps, { record }) => turn('baroKnob', steps, { record }), turned: () => turned('baroKnob') });
}

export function renderFCU(canvas) {
  if (!_cache.style) return;
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();
  drawFCU(ctx, W, H, _cache.style);
  ctx.restore();
  /* its knobs and buttons, where drawFCU put them (display/hit.js): a knob turns (drag, wheel) and pushes (click) */
  beginHits(canvas);
  const z = fcuKnobZones();
  if (z) for (const [k, id] of [['qnh', 'fcuQnh'], ['spd', 'fcuSpd'], ['hdg', 'fcuHdg'], ['alt', 'fcuAlt'], ['vs', 'fcuVs']]) {
    const [x, w] = z[k];
    addHit(canvas, { name: id, x, y: 0, w, h: z.h, action: () => push(id),
      turn: (steps, { record }) => turn(id, steps, { record }), turned: () => turned(id) });
  }
  for (const b of fcuButtonRegions()) {
    const id = b.idx === 0 ? 'ap1' : b.idx === 3 ? 'athr' : null;   // AP2 and APPR: drawn, no function yet
    if (id) addHit(canvas, { name: id, x: b.x, y: b.y, w: b.w, h: b.h, action: () => operate(id) });
  }
}

export function renderCockpit(canvas) {
  const aircraft = S.aircraft;
  if (!aircraft?.panel) return;

  const aid = aircraft.id;

  if (_cpCache.aircraftId !== aid) {
    if (!_cpCache.loading) {
      _cpCache.loading    = true;
      _cpCache.aircraftId = aid;
      _cpCache.spec       = null;
      _cpCache.style      = null;

      const panel = aircraft.panel;
      Promise.all([
        fetch(`panels/${panel}.json?v=${Date.now()}`).then(r => r.json()),
        fetch(`panels/styles/${panel}.json?v=${Date.now()}`).then(r => r.json()).catch(() => _DEFAULT_STYLE),
      ]).then(([spec, style]) => {
        _cpCache.spec  = spec;
        _cpCache.style = style;
        _cpCache.loading = false;
      }).catch(() => { _cpCache.loading = false; });
    }
    _blank(canvas);
    return;
  }

  if (!_cpCache.spec) return;

  beginHits(canvas);
  _currentCanvas = canvas;
  _render(canvas, _cpCache.spec, _cpCache.style ?? _DEFAULT_STYLE);
}

/* ═══════════════════════════════════════════════════════════════
   INTERNAL HELPERS
   ═══════════════════════════════════════════════════════════════ */

function _blank(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  canvas.getContext('2d').fillStyle = '#020408';
  canvas.getContext('2d').fillRect(0, 0, W, H);
}

/* Run fn with every `ctx.font` px size multiplied by fk — one place to keep panel text legible
   when the display is squished (the outside view halves the height; the width stays). Intercepts
   the font setter on the instance, then restores the prototype accessor. */
const _FONT_DESC = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
function _scaledFont(ctx, fk, fn) {
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return _FONT_DESC.get.call(ctx); },
    set(v) { _FONT_DESC.set.call(ctx, String(v).replace(/(\d*\.?\d+)px/, (_, n) => (parseFloat(n) * fk) + 'px')); },
  });
  try { fn(); } finally { delete ctx.font; }
}

function _render(canvas, spec, style, squish = false) {
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');

  /* portrait-design displays squished into a short box → boost the fonts (geometry stays) */
  const fk = squish ? Math.max(1, Math.min(W, H * 1.7) / H) : 1;

  ctx.save();
  ctx.fillStyle = style.colors?.bg ?? '#0e1014';
  ctx.fillRect(0, 0, W, H);

  let rowY = 0;
  for (const row of spec.layout) {
    const rowH = row.h * H;
    let colX   = 0;
    for (const col of row.cols) {
      const colW = col.w * W;
      const box  = { x: colX, y: rowY, w: colW, h: rowH, fk };   // fk: widgets scale text-boxes to match the font
      const fn   = _WIDGETS[col.widget];
      if (fn) {
        if (fk !== 1 && col.widget === 'ecam_ewd') {
          /* The ECAM/EWD is a connected schematic (boxes + lines + labels). Don't font-boost it
             piecemeal — scale it as a whole: draw into a taller box (h·fk, a fuller aspect that
             uses the wide outside-view width), vertically centred and clipped to the real box,
             so text + boxes + lines grow together. */
          ctx.save();
          ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
          /* the schematic spans ~0.10–0.78 of its height (GENs at the top, ESS bus at the
             bottom), so cap the stretch at 1.4 to keep it all on-screen, and align its content
             centre (~0.44) on the box centre. Text + boxes + lines still grow ~1.4×. */
          const hB = box.h * Math.min(fk, 1.4);
          fn(ctx, { x: box.x, y: box.y + box.h * 0.5 - hB * 0.44, w: box.w, h: hB }, style, col.config ?? {});
          ctx.restore();
        } else if (fk !== 1 && col.widget !== 'nd_map') {   // isolated text → boost fonts; the ND scales its own
          _scaledFont(ctx, fk, () => fn(ctx, box, style, col.config ?? {}));
        } else {
          fn(ctx, box, style, col.config ?? {});
        }
      }
      colX += colW;
    }
    rowY += rowH;
  }

  ctx.restore();
}
