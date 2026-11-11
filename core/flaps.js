/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/flaps.js
   The flaps' owner — the flap lever's command. The selected stage only (S.flaps, an
   index into the aircraft's `flaps` settings); core/physics.js ramps the surfaces to it.

   flaps('extend' | 'retract' | n):
     one stage down or up, or straight to stage n (a lever with detents, the crew's call);
     the stages are the aircraft's own — `flaps` in its data (0 … length − 1);
     refused beyond them, on an aircraft without flaps, and when already there.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { registerCommand } from './commands.js';

/** The highest flap stage of the aircraft — from its `flaps` settings; 3 for an aircraft that lists none */
export const maxFlapStage = (ac = S.aircraft) => Array.isArray(ac?.flaps) ? ac.flaps.length - 1 : 3;

export function flaps(arg) {
  const cur = S.flaps ?? 0, max = maxFlapStage();
  const next = arg === 'extend' ? cur + 1 : arg === 'retract' ? cur - 1 : Number.isInteger(arg) ? arg : NaN;
  if (Number.isNaN(next)) { console.warn(`[flaps] unknown setting "${arg}"`); return false; }
  if (next < 0 || next > max || next === cur) return false;
  setState({ prevFlaps: cur, flaps: next });
  return true;
}

registerCommand('flaps', flaps);

/* ── The speed brake lever — RET 0, ARM 1, FULL 2 (core/physics.js: the ground spoilers, auto-deploy on touchdown).
   Only on an aircraft with spoilers. ── */
export const SPEED_BRAKE_POSITIONS = [0, 1, 2];
export function speedBrake(pos) {
  if (!S.aircraft?.spoilers || !SPEED_BRAKE_POSITIONS.includes(pos) || pos === (S.speedBrake ?? 0)) return false;
  setState({ speedBrake: pos });
  return true;
}
registerCommand('speedBrake', (pos) => speedBrake(pos));

/* ── The pitch trim (the Bf 109's Höhentrimmrad, the t / T keys) — −10 nose down … +10 nose up. With the wing's
   surfaces here until the flight controls have an owner of their own. ── */
export function trim(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const t = Math.max(-10, Math.min(10, v));
  if (t === (S.trim ?? 0)) return false;
  setState({ trim: t });
  return true;
}
registerCommand('trim', (v) => trim(v));
