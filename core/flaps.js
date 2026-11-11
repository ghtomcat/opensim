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
