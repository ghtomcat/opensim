/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/fuel.js
   Fuel system: tanks, selector, burn, depletion, warnings.

   Aircraft JSON:
     "tanks": { "left": 95, "right": 95, "unit": "L" }
     "fuelBurn": 28   — litres/hour at full power (defaults by engine type)

   Selector states: 'BOTH' | 'LEFT' | 'RIGHT' | 'OFF'
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { bbEvent } from './blackbox.js';
import { stopEngineLifecycle } from './sound.js';

/* Default fuel burn rates litres/hour at full power */
const BURN_DEFAULTS = {
  'lycoming-o360':  28,   // C172 — IO-360, 180hp
  'lycoming-o320':  24,   // DR400 — O-320, 160hp
  'v12-supercharged': 120, // Bf 109 DB 601
  'r-2800':         160,  // F4U Corsair R-2800
  'default':         30,
};

export function initFuel() {
  const tanks = S.aircraft?.tanks;
  if (!tanks) {
    setState({ fuelLeft: null, fuelRight: null });
    return;
  }
  setState({
    fuelLeft:     tanks.left  ?? 0,
    fuelRight:    tanks.right ?? 0,
    fuelSelector: 'BOTH',
    fuelShutoff:  false,
    fuelStarveT:  null,
  });
}

export function resetFuel() {
  initFuel();
}

export function cycleFuelSelector() {
  const order = ['BOTH', 'LEFT', 'RIGHT'];
  const cur   = S.fuelSelector ?? 'BOTH';
  const next  = order[(order.indexOf(cur) + 1) % order.length];
  setState({ fuelSelector: next });
}

export function tickFuel(dt) {
  /* Oil pressure warning fires for all aircraft, even without a fuel system */
  if (S.fuelLeft === null) {
    const warnings = { ...(S.warnings ?? {}), OIL_PRESS: (S.enginePower ?? 1) < 0.3 };
    setState({ warnings });
    return;
  }
  if (S.crashed) return;

  const sel      = S.fuelSelector ?? 'BOTH';
  const power    = S.enginePower  ?? 1.0;
  const running  = power > 0.05;

  /* Fuel shutoff valve closed — no burn; engine runs on residual fuel, then quits */
  if (S.fuelShutoff) {
    _starveRunDown(dt, 'fuel_shutoff');
    _updateWarnings();
    return;
  }

  if (!running) {
    _clearStarve();
    _updateWarnings();
    return;
  }

  /* Burn rate — litres/hour → litres/second */
  const engineType = S.aircraft?.sound?.engineType ?? 'default';
  const burnLph    = S.aircraft?.fuelBurn ?? BURN_DEFAULTS[engineType] ?? BURN_DEFAULTS.default;
  const burnRate   = (burnLph / 3600) * power * dt;

  let left  = S.fuelLeft;
  let right = S.fuelRight;

  if (sel === 'BOTH') {
    /* Burn equally from both tanks; if one is empty, drain the other at full rate */
    if (left <= 0) {
      right = Math.max(0, right - burnRate);
    } else if (right <= 0) {
      left  = Math.max(0, left  - burnRate);
    } else {
      const half = burnRate / 2;
      left  = Math.max(0, left  - half);
      right = Math.max(0, right - half);
    }
  } else if (sel === 'LEFT') {
    left  = Math.max(0, left  - burnRate);
  } else if (sel === 'RIGHT') {
    right = Math.max(0, right - burnRate);
  }

  setState({ fuelLeft: left, fuelRight: right });

  /* Selected tank(s) empty → fuel starvation (same run-down as a shutoff) */
  const selectedEmpty =
    (sel === 'BOTH'  && left  <= 0 && right <= 0) ||
    (sel === 'LEFT'  && left  <= 0) ||
    (sel === 'RIGHT' && right <= 0);

  if (selectedEmpty) _starveRunDown(dt, 'fuel_exhausted');
  else               _clearStarve();

  _updateWarnings();
}

/* Fuel cut (shutoff or empty tank): the engine keeps running on the fuel left in
   the lines/carburettor for a few seconds, then quits with the normal shutdown sound. */
const STARVE_RUNDOWN_S = 4;
function _starveRunDown(dt, kind) {
  if ((S.enginePower ?? 0) <= 0.05) { _clearStarve(); return; }   // already stopped
  const t = (S.fuelStarveT ?? STARVE_RUNDOWN_S) - dt;
  if (t <= 0) {
    setState({ enginePower: 0, engineState: 'off', fuelStarveT: null });
    stopEngineLifecycle();                                         // same as engine shutdown
    if (S.emergLog) S.emergLog.push({ t: S.time, type: 'failure', failureType: 'fuel_starvation', value: 0 });
    bbEvent({ type: kind, selector: S.fuelSelector ?? null, shutoff: !!S.fuelShutoff });
  } else {
    setState({ fuelStarveT: t });
  }
}
function _clearStarve() {
  if (S.fuelStarveT != null) setState({ fuelStarveT: null });      // fuel restored → cancel run-down
}

function _updateWarnings() {
  const tanks    = S.aircraft?.tanks;
  if (!tanks) return;

  const left      = S.fuelLeft  ?? 0;
  const right     = S.fuelRight ?? 0;
  const total     = (tanks.left ?? 0) + (tanks.right ?? 0);
  const remaining = left + right;
  const sel       = S.fuelSelector ?? 'BOTH';

  const warnings = { ...(S.warnings ?? {}) };

  /* OIL PRESSURE — red if engine dying */
  warnings.OIL_PRESS = (S.enginePower ?? 1) < 0.3;

  /* LOW FUEL — amber below 10% total or selected tank < 5L */
  const lowFuel =
    remaining / total < 0.10 ||
    (sel === 'LEFT'  && left  < 5) ||
    (sel === 'RIGHT' && right < 5);
  warnings.LOW_FUEL = lowFuel;

  /* FUEL SHUTOFF closed — amber */
  warnings.FUEL_SHUTOFF = !!S.fuelShutoff;

  setState({ warnings });
}
