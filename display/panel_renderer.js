/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/panel_renderer.js
   Data-driven PFD/ND compositor.
   renderPanel(canvas, screenIdx, specOverride?) — finds the spec
   for that screen from S.aircraft.displays[], loads all specs
   (including pages[]) once per aircraft.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import {
  drawFMA, drawAI, drawSpeedTape, drawAltTape,
  drawVSI, drawHdgTape, drawNDMap, drawFCU, drawECAM,
} from './pfd_instruments.js';

const _WIDGETS = {
  fma:        (ctx, box, style, cfg) => drawFMA(ctx, box, style),
  ai:         (ctx, box, style, cfg) => drawAI(ctx, box, style, cfg),
  speed_tape: (ctx, box, style, cfg) => drawSpeedTape(ctx, box, style),
  alt_tape:   (ctx, box, style, cfg) => drawAltTape(ctx, box, style),
  vsi:        (ctx, box, style, cfg) => drawVSI(ctx, box, style),
  hdg_tape:   (ctx, box, style, cfg) => drawHdgTape(ctx, box, style),
  nd_map:     (ctx, box, style, cfg) => drawNDMap(ctx, box, style, cfg),
  ecam_ewd:   (ctx, box, style, cfg) => drawECAM(ctx, box, style),
  spacer:     () => {},
};

/* Cache keyed by aircraft id — survives aircraft changes cleanly. */
const _cache = {
  aircraftId: null,
  style:      null,
  specs:      {},    // specName → loaded JSON object
  loading:    false,
};

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

      /* Collect all spec names — default spec + any pages[] entries */
      const names = [...new Set(
        aircraft.displays
          .flatMap(d => d.pages ?? [d.spec])
          .filter(Boolean)
      )];
      Promise.all([
        fetch(`panels/styles/${aircraft.panel}.json`).then(r => r.json()),
        ...names.map(n => fetch(`panels/${n}.json`).then(r => r.json())),
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

  _render(canvas, spec, _cache.style);
}

export function renderFCU(canvas) {
  if (!_cache.style) return;
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.save();
  drawFCU(ctx, W, H, _cache.style);
  ctx.restore();
}

function _blank(canvas) {
  const W = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  canvas.getContext('2d').fillStyle = '#020408';
  canvas.getContext('2d').fillRect(0, 0, W, H);
}

function _render(canvas, spec, style) {
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.fillStyle = style.colors.bg;
  ctx.fillRect(0, 0, W, H);

  let rowY = 0;
  for (const row of spec.layout) {
    const rowH = row.h * H;
    let colX   = 0;
    for (const col of row.cols) {
      const colW = col.w * W;
      const box  = { x: colX, y: rowY, w: colW, h: rowH };
      const fn   = _WIDGETS[col.widget];
      if (fn) fn(ctx, box, style, col.config ?? {});
      colX += colW;
    }
    rowY += rowH;
  }

  ctx.restore();
}
