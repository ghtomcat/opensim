/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/loop.js
   Animation loop. Ticks physics, then all renders.
   Call startLoop(renderers) once after init.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { tickPhysics } from './physics.js';
import { tickCrew }    from './crew.js';
import { tickGamepad, tickControls } from './input.js';

let _prevTime = null;
let _renderers = [];

/**
 * renderers: array of functions called each frame with no arguments.
 * They should read directly from S.
 */
export function startLoop(renderers = []) {
  _renderers = renderers;
  requestAnimationFrame(_tick);
}

function _tick(now) {
  requestAnimationFrame(_tick);

  if (!_prevTime) { _prevTime = now; return; }
  const dt = Math.min((now - _prevTime) / 1000, 0.1);   // cap at 100ms
  _prevTime = now;

  tickGamepad();
  if (!S.paused) tickControls(dt);

  if (!S.paused) {
    const prevAlt = S.alt;
    tickPhysics(dt);
    tickCrew(prevAlt, S.alt);
  }

  for (const render of _renderers) render();
}
