/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/outside.js
   Outside view shell — delegates to terrain.js renderer.
   ═══════════════════════════════════════════════════════════════ */

import { renderTerrain } from './terrain.js';

let _canvas = null;

export function initOutside() {
  _canvas = document.getElementById('outside-canvas');
}

export function outsideInvalidate() { /* no-op — canvas redraws every frame */ }

export function tickOutside() {
  if (!_canvas || !_canvas.offsetWidth || !_canvas.offsetHeight) return;
  renderTerrain(_canvas);
}
