/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/gear.js
   The landing gear's owner — the gear lever's command. Today the selected position
   only (S.gear; core/physics.js moves S.gearAnim toward it); later the gear system
   (hydraulics, the up and down locks, the emergency extension) comes here.

   The parking brake is the wheels' too: parkBrake(on) — set or released (physics.js reads it).

   gear('up' | 'down' | 'toggle'):
     refused on an aircraft with a fixed gear;
     squat lock — refused 'up' with weight on the wheels;
     refused when the gear is already there (nothing to record).
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { registerCommand } from './commands.js';

export function gear(arg = 'toggle') {
  if (S.aircraft?.fixedGear) return false;
  const down = arg === 'toggle' ? !S.gear : arg === 'down';
  if (arg !== 'toggle' && arg !== 'up' && arg !== 'down') { console.warn(`[gear] unknown position "${arg}"`); return false; }
  if (down === !!S.gear) return false;
  if (!down && S.wow) return false;                    // squat lock: no gear-up on the ground
  setState({ prevGear: !!S.gear, gear: down });
  return true;
}

registerCommand('gear', gear);

export function parkBrake(on) {
  if (!!on === !!S.parkBrake) return false;
  setState({ parkBrake: !!on });
  return true;
}
registerCommand('parkBrake', (on) => parkBrake(on));
