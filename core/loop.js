/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/loop.js
   Animation loop. Ticks physics, then all renders.
   Call startLoop(renderers) once after init.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { tickPhysics }     from './physics.js';
import { tickHovercraft }  from './hovercraft_physics.js';
import { tickRocket, tickBooster } from './rocket.js';
import { tickCrew }        from './crew.js';
import { tickGamepad, tickControls } from './input.js';
import { tickFailures }              from './failures.js';
import { tickTelemetry }            from './telemetry.js';

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
    const warp    = (S.aircraft?.vehicleType === 'rocket') ? (S.warpFactor ?? 1) : 1;
    const warpDt  = dt * warp;
    const prevAlt = S.alt;
    tickFailures(warpDt);
    if      (S.aircraft?.vehicleType === 'rocket')    { tickRocket(warpDt); tickBooster(warpDt); }
    else if (S.aircraft?.type       === 'hovercraft') tickHovercraft(warpDt);
    else                                              tickPhysics(dt);
    tickCrew(prevAlt, S.alt);
    tickTelemetry(warpDt);
  }

  for (const render of _renderers) render();
}
