/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/engine-gauges.js
   The engine values the analog panels show that the sim has no system for yet — STAND-INS, per
   engine (index i, 0-based), each marked with the system that replaces it (issues.md, "The analog
   panels draw a borrowed fighter panel", step 6 part 2). They moved here from the drawing code
   (display/analog_panel.js) so the panel only reads; when a system exists, its value replaces the
   function here and the panel does not change.

   They read the engine model (core/engine.js: the lifecycle state, the rpm, the throttle) and the
   fuel state; they own no state and change nothing.

     oilPressure(i)       kg/cm²    a turbofan's own (e.oil); else → "The oil system"
     manifoldPressure(i)  in.Hg     → "The supercharger"
     fuelPressure(i)      kg/cm²    → "The fuel system" (the low / supply pressure)
     fuelPressureHigh(i)  kg/cm²    → "The fuel system" (a jet's injector pressure)
     generatorAmps(i)     A         → an electrical model for the warbirds
     oilFlowing(i)        rpm       → "The oil system" (the Avro's pulsator)
     propPitchHours()     h from 12 → the propeller's blade angle (one lever for the aircraft)
     tankAirPressure()    lb/sq in  → "The fuel system" (the Avro's hand-pumped tank)
     gasTemp(i)           °C        a turbofan's own EGT; else → a turboprop / turbojet engine model
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { engineRpm, rpmRange, throttleFrac } from './engine.js';

/** The marks: what each stand-in is and what replaces it — the panel's registry shows them (`simple`) */
export const STAND_INS = {
  oilPressure:      'The oil system (issues.md)',
  manifoldPressure: 'The supercharger (issues.md)',
  fuelPressure:     'The fuel system (issues.md)',
  fuelPressureHigh: 'The fuel system (issues.md)',
  generatorAmps:    'an electrical model for the warbirds',
  oilFlowing:       'The oil system (issues.md)',
  propPitchHours:   'the propeller\'s blade angle',
  tankAirPressure:  'The fuel system (issues.md)',
  gasTemp:          'a gas temperature from the turboprop\'s / turbojet\'s fuel flow (a turbofan has its own)',
};

/** Engine i's lifecycle state ('off' before the first mission load) */
const _state = (i) => S.engines?.[i]?.state ?? (i === 0 ? S.engineState : null) ?? 'off';
const _rpm   = (i) => engineRpm(i) ?? 0;

/** The fuel on board (l) and whether it can reach the engines (the cock open, a tank not empty) */
export const fuelLitres = () => (S.fuelLeft ?? 0) + (S.fuelRight ?? 0);
const _fuelFlows = () => !S.fuelShutoff && fuelLitres() > 0;

/** Oil pressure, kg/cm² — a turbofan's own (S.engines[i].oil, psi, from its core — core/engine.js); the others a
    stand-in: 1.5 at idle to 7.5 at full throttle while running; building with the rpm to idle on the start,
    falling with it on the run-down → "The oil system" */
const PSI_PER_KGCM2 = 14.223;
export function oilPressure(i = 0) {
  if (S.aircraft?.engine?.type === 'turbofan') return (S.engines?.[i]?.oil ?? 0) / PSI_PER_KGCM2;
  const st = _state(i), rpm = _rpm(i), r = rpmRange();
  return st === 'running'  ? 1.5 + throttleFrac() * 6.0
       : st === 'starting' ? Math.min(1.5, rpm / r.idle * 1.5)
       : st === 'shutdown' ? Math.max(0, rpm / r.max * 7.5)
       : 0;
}

/** Manifold pressure, in.Hg — idle ~12, full throttle ~52 → "The supercharger".
    (Kept as it was: 12 also with the engine stopped, where a real gauge shows the outside air.) */
export function manifoldPressure(i = 0) {
  return (S.wow || (S.spdT ?? 0) === 0) ? 12 : 12 + throttleFrac() * 40;
}

/** Fuel pressure, kg/cm² — the engine-driven pump: normal while running with fuel (1.3, unconfirmed),
    building to it on the start, falling over the starvation run-down once the cock is closed or the
    tank empty (so the pressure drops before the engine quits) → "The fuel system" */
export function fuelPressure(i = 0) {
  const st = _state(i), normal = S.aircraft?.engine?.fuelPressure?.low ?? 1.3;
  if (st === 'starting') return Math.min(normal, _rpm(i) / rpmRange().idle * normal);
  if (st !== 'running') return 0;
  if (_fuelFlows() && S.fuelStarveT == null) return normal;
  return normal * Math.max(0, Math.min(1, (S.fuelStarveT ?? 0) / 10));
}

/** Generator current, A — charging while the engine runs, nothing at rest → an electrical model for the warbirds */
export function generatorAmps(i = 0) { return _state(i) === 'running' ? 18 : 0; }

/** Oil flowing — the rotary's rpm while it runs, else 0 (the pulsator pulses with it) → "The oil system" */
export function oilFlowing(i = 0) { return _state(i) === 'running' ? _rpm(i) : 0; }

/** The propeller pitch in "clock hours" from 12:00 — S.propPitch 1 fine … 0 coarse; the hours per degree
    are not known (sources/bf109-panel-notes.md) → the propeller's blade angle */
export function propPitchHours() { return (1 - (S.propPitch ?? 1)) * 6; }

/** The fuel tank's air pressure, lb/sq in — the Avro's hand-pumped tank, kept at about 3 while there is fuel → "The fuel system" */
export function tankAirPressure() { return _fuelFlows() ? 3.0 : 0; }

/** The exhaust gas temperature, °C — a turbofan's own (S.engines[i].egt, core/engine.js); for the other turbines a
    stand-in: the outside air at rest, rising with the rpm to engine.egtIdle on the start, egtIdle → egtTakeoff with
    the throttle while running, falling with the rpm on the run-down. Defaults 400 / 650 °C — not sourced (the NK-12's
    2ТВГ-366 scale and limits not found, sources/tu95-panel-notes.md) → a gas temperature from the fuel flow */
export function gasTemp(i = 0) {
  const e = S.engines?.[i], eng = S.aircraft?.engine ?? {};
  if (eng.type === 'turbofan') return e?.egt ?? 15;
  const cold = 15, idle = eng.egtIdle ?? 400, top = eng.egtTakeoff ?? 650, st = _state(i), r = rpmRange();
  const toward = (t) => cold + (t - cold) * Math.max(0, Math.min(1, _rpm(i) / r.idle));
  return st === 'running'  ? idle + (top - idle) * throttleFrac()
       : st === 'starting' || st === 'shutdown' ? toward(idle)
       : cold;
}

/** A jet's high (injector) fuel pressure, kg/cm² — rising with the square of the rpm to engine.fuelPressure.high at full
    rpm (60 if absent — not sourced), falling with the supply on a starvation run-down → "The fuel system" */
export function fuelPressureHigh(i = 0) {
  const top = S.aircraft?.engine?.fuelPressure?.high ?? 60, max = S.aircraft?.engine?.maxRpm ?? 1;
  const low = S.aircraft?.engine?.fuelPressure?.low ?? 1.3;
  return top * Math.pow(Math.min(1, _rpm(i) / max), 2) * (low > 0 ? fuelPressure(i) / low : 0);
}
