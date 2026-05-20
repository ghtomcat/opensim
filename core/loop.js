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
import { tickElectrical }           from './electrical.js';
import { tickTelemetry }            from './telemetry.js';
import { bbTick }                   from './blackbox.js';
import { tickHIL }                  from './hil.js';

/* Fixed physics timestep for rocket simulation.
   At any warp level ≥ PHYS_DT, the accumulator ensures every
   tickRocket/tickBooster call sees exactly this dt — so the
   trajectory is identical at warp=100 and warp=1000, including
   across the automatic Moon-proximity warp cap. */
const PHYS_DT = 1.0;   // seconds

let _prevTime  = null;
let _renderers = [];
let _running   = false;
let _physAccum = 0;   // fractional physics time not yet consumed

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
    const isRocket = S.aircraft?.vehicleType === 'rocket';
    const warp     = isRocket ? (S.warpFactor ?? 1) : 1;
    const warpDt   = dt * warp;
    const prevAlt  = S.alt;
    tickFailures(warpDt);
    tickFuel(dt);
    tickBattery(dt);
    tickElectrical(dt);
    if (isRocket) {
      /* Fixed-dt rocket physics.
         When warpDt < PHYS_DT (real-time / low warp): one step with the
         actual frame dt so the launch display stays smooth.
         When warpDt >= PHYS_DT (high warp): accumulate and drain in
         exact PHYS_DT increments — every tickRocket call sees the same
         dt regardless of warp factor.  This decouples trajectory from
         warp setting: the Moon-proximity cap (1000x→100x) no longer
         changes the physics dt and cannot shift the cislunar trajectory. */
      let nSteps, stepDt;
      if (warpDt < PHYS_DT) {
        nSteps     = 1;
        stepDt     = warpDt;
        _physAccum = 0;
      } else {
        _physAccum += warpDt;
        nSteps      = Math.floor(_physAccum / PHYS_DT);
        _physAccum -= nSteps * PHYS_DT;
        stepDt      = PHYS_DT;
      }
      const warpBefore = S.warpFactor ?? 1;
      for (let i = 0; i < nSteps; i++) {
        tickRocket(stepDt);
        tickBooster(stepDt);
        if ((S.warpFactor ?? 1) < warpBefore) { _physAccum = 0; break; }
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
