/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/hit.js
   The canvas click areas — one registry, per canvas. A canvas panel registers its
   controls' areas as it draws them (beginHits, then addHit per control); one click
   handler (index.html) dispatches a click to the area under it. Replaces the panels'
   own _hitRegions lists and the routing by panel name (docs/issues.md, *Instruments,
   controls and mixed panels — the plan*, step 2b).

   Areas are in canvas pixels (device pixels), as drawn. They are cleared on every
   mission load, so a click never reaches a switch of the previous aircraft.
   ═══════════════════════════════════════════════════════════════ */

import { onMissionReset } from '../core/lifecycle.js';

const _areas = new Map();   // canvas → [{ name, x, y, w, h, action }]
onMissionReset(() => _areas.clear());

/** A panel starts drawing on this canvas — its areas from the last frame go */
export function beginHits(canvas) { _areas.set(canvas, []); }

/** A control's area, in canvas pixels. `action` runs on a click inside it; a knob gives `turn(steps, { record })` — a drag
    up / down (3 px a step) or the wheel (a step a notch) turns it, Shift ten steps — and `turned()` when a drag ends. */
export function addHit(canvas, { name, x, y, w, h, action, turn, turned }) {
  if (!_areas.has(canvas)) _areas.set(canvas, []);
  _areas.get(canvas).push({ name, x, y, w, h, action, turn, turned });
}

/** The area under a pointer event, or null — the last drawn on top wins */
export function hitAt(canvas, evt) {
  const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const x = (evt.clientX - r.left) * dpr, y = (evt.clientY - r.top) * dpr;
  const list = _areas.get(canvas) ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a;
  }
  return null;
}

/** A click on the canvas: run the control under it. True when one was hit. A drag that just turned a knob is no click. */
export function dispatchClick(canvas, evt) {
  if (_dragged) { _dragged = false; return true; }
  const a = hitAt(canvas, evt);
  if (!a?.action) return !!a;
  a.action();
  return true;
}

/* ── Knobs: the FCU's two gestures (Markus, 2026-11-11) — drag up / down to turn, the wheel a step a notch; Shift coarse.
   A drag's steps are not recorded one by one: turn(…, { record: false }), then turned() once where it ends. ── */
const PX_PER_STEP = 3;
let _drag = null, _dragged = false;

/** A mouse button pressed on the canvas: on a knob, its drag starts (and the mouse stick doesn't fly). True when it did. */
export function dispatchDragStart(canvas, evt) {
  const a = hitAt(canvas, evt);
  if (!a?.turn) return false;
  _drag = { a, y0: evt.clientY, done: 0 };
  _dragged = false;
  evt.preventDefault(); evt.stopPropagation();
  return true;
}
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    if (!_drag) return;
    const steps = Math.trunc((_drag.y0 - e.clientY) / PX_PER_STEP) * (e.shiftKey ? 10 : 1);
    if (steps !== _drag.done) { _drag.a.turn(steps - _drag.done, { record: false }); _drag.done = steps; _dragged = true; }
  });
  window.addEventListener('mouseup', () => {
    if (!_drag) return;
    if (_drag.done !== 0) _drag.a.turned?.();
    _drag = null;
    setTimeout(() => { _dragged = false; }, 0);   // after the click this mouseup may cause — none if it ended off the canvas
  });
}

/** The wheel over the canvas: on a knob, a step a notch (Shift ten). True when a knob took it. */
export function dispatchWheel(canvas, evt) {
  const a = hitAt(canvas, evt);
  if (!a?.turn) return false;
  evt.preventDefault();
  a.turn((evt.deltaY < 0 ? 1 : -1) * (evt.shiftKey ? 10 : 1), { record: true });
  return true;
}

/** The cursor over the canvas: ↕ on a knob, the hand on a button, else none */
export function cursorAt(canvas, evt) {
  const a = hitAt(canvas, evt);
  return a?.turn ? 'ns-resize' : a?.action ? 'pointer' : 'default';
}

/** The areas drawn last on this canvas — name and rectangle, for tests */
export const hitAreas = (canvas) => (_areas.get(canvas) ?? []).map(({ name, x, y, w, h }) => ({ name, x, y, w, h }));
