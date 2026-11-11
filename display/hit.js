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

/** A control's click area, in canvas pixels; `action` runs on a click inside it */
export function addHit(canvas, { name, x, y, w, h, action }) {
  if (!_areas.has(canvas)) _areas.set(canvas, []);
  _areas.get(canvas).push({ name, x, y, w, h, action });
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

/** A click on the canvas: run the control under it. True when one was hit. */
export function dispatchClick(canvas, evt) {
  const a = hitAt(canvas, evt);
  if (!a) return false;
  a.action();
  return true;
}

/** The areas drawn last on this canvas — name and rectangle, for tests */
export const hitAreas = (canvas) => (_areas.get(canvas) ?? []).map(({ name, x, y, w, h }) => ({ name, x, y, w, h }));
