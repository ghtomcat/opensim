/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/loop.js
   Animation loop. Ticks physics, then all renders.
   Call startLoop(renderers) once after init.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { tickPhysics }     from './physics.js';
import { tickHovercraft }  from './hovercraft_physics.js';
import { tickRocket, tickBooster } from './rocket.js';
import { tickCrew }        from './crew.js';
import { tickGamepad, tickControls } from './input.js';
import { tickFailures }              from './failures.js';
import { tickFuel }                  from './fuel.js';
import { tickBattery }               from './battery.js';
import { tickTelemetry }            from './telemetry.js';
import { bbTick }                   from './blackbox.js';
import { tickHIL }                  from './hil.js';

let _prevTime = null;
let _renderers = [];
let _running   = false;

/**
 * renderers: array of functions called each frame with no arguments.
 * They should read directly from S.
 */
export function startLoop(renderers = []) {
  _renderers = renderers;
  if (_running) return;   // already ticking — just swap renderers
  _running = true;
  requestAnimationFrame(_tick);
}

function _tick(now) {
  requestAnimationFrame(_tick);

  if (!_prevTime) { _prevTime = now; return; }
  const dt = Math.min((now - _prevTime) / 1000, 0.1);   // cap at 100ms
  _prevTime = now;

  tickGamepad();
  tickHIL();
  if (!S.paused) tickControls(dt);

  if (!S.paused) {
    const isRocket = S.aircraft?.vehicleType === 'rocket' || S.aircraft?.panel;
    const warp     = isRocket ? (S.warpFactor ?? 1) : 1;
    const warpDt   = dt * warp;
    const prevAlt  = S.alt;
    tickFailures(warpDt);
    tickFuel(dt);
    tickBattery(dt);
    if (isRocket) {
      /* Sub-step rocket physics so Velocity Verlet never sees a step > 10 s.
         Without this, at 200 000× warp a single step is ~3 200 s — larger
         than the 5 280 s parking-orbit period — and destroys the integration.
         Each sub-step also re-checks event triggers (TLI, LOI, MCC-1) so
         they fire at the correct orbital phase regardless of warp factor.   */
      const MAX_STEP = 10;
      const nSteps   = Math.max(1, Math.round(warpDt / MAX_STEP));
      const stepDt   = warpDt / nSteps;
      for (let i = 0; i < nSteps; i++) {
        tickRocket(stepDt);
        tickBooster(stepDt);
      }
    } else if (S.aircraft?.type       === 'hovercraft') {
      tickHovercraft(warpDt);
    } else if (S.aircraft?.vehicleType === 'robot-arm') {
      /* arm kinematics — no physics tick */
    } else {
      tickPhysics(warpDt);
    }
    tickCrew(prevAlt, S.alt);
    tickTelemetry(warpDt);
    bbTick(dt);

    /* Warp target: auto-drop when we reach the target time */
    const wT = S.warpTarget;
    if (wT != null && (S.time ?? 0) >= wT) {
      setState({ warpFactor: 1, warpTarget: null, warpTargetLabel: null });
    }
  }

  for (const render of _renderers) render();
}
