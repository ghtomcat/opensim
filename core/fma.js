/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/fma.js
   Flight Mode Annunciator state — a shared phase model.

   Autoflight modes mean the same thing across manufacturers; only the words and the
   column/field layout differ. This computes the phase → modes model once; the renderers
   (Airbus 5 columns now, Boeing 3 fields later) decompress it into their own vocabulary.

   computeAirbusFMA returns 5 cells { val, col, flash } in Airbus reading order:
     0 A/THR·thrust · 1 vertical · 2 lateral · 3 approach-capability · 4 AP/FD/A-THR
   col is a name resolved by the renderer: green=engaged, cyan=armed(blue), white, amber.
   ═══════════════════════════════════════════════════════════════ */

const cell  = (val, col) => ({ val, col, flash: 0 });
const BLANK = cell('', 'white');

export function computeAirbusFMA(p) {
  const { wow, n1 = 0, vs = 0, alt = 0, altT = alt,
          gear = false, ap = false, athr = false, fieldElev = 0 } = p;
  const agl      = alt - fieldElev;
  const toThrust = n1 > 80;                                   // TOGA / FLX set
  const apfd     = ap ? cell('AP1', 'white') : cell('1FD2', 'white');

  // Parked / taxi — below takeoff thrust on the ground → FMA blank (the correct rest state).
  if (wow && !toThrust) return [BLANK, BLANK, BLANK, BLANK, BLANK];

  // Takeoff roll / initial rotation — TOGA set, on or just off the ground.
  if (wow || agl < 30) {
    return [cell('MAN TO/GA', 'white'), cell('SRS', 'green'), cell('RWY', 'green'),
            BLANK, cell('A/THR', 'cyan')];                    // A/THR armed (blue) once thrust is set
  }

  const nearCruise = Math.abs(alt - altT) < 250 && Math.abs(vs) < 350;

  // Climb — SRS until clean/accel, then CLB; MAN TO/GA until thrust is reduced to CLB.
  if (vs > 350 && !nearCruise) {
    return [n1 > 90 ? cell('MAN TO/GA', 'white') : cell('THR CLB', 'green'),
            agl < 1500 ? cell('SRS', 'green') : cell('CLB', 'green'),
            cell('NAV', 'green'), BLANK, apfd];
  }

  // Approach — gear down and low.
  if (gear && agl < 2500) {
    return [cell('SPEED', 'green'), cell('G/S', 'green'), cell('LOC', 'green'),
            cell('CAT 3', 'green'), apfd];
  }

  // Descent.
  if (vs < -350 && !nearCruise) {
    return [cell('SPEED', 'green'), cell('DES', 'green'), cell('NAV', 'green'), BLANK, apfd];
  }

  // Cruise / level.
  return [cell('SPEED', 'green'), cell('ALT CRZ', 'green'), cell('NAV', 'green'), BLANK, apfd];
}
