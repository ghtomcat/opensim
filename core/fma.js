/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/fma.js
   Flight Mode Annunciator state — a shared phase model.

   Autoflight modes mean the same thing across manufacturers; only the words and the
   column/field layout differ. _phase() decides the flight phase once; each manufacturer's
   mapper decompresses it into its own vocabulary — Airbus (5 columns) and Boeing (3 fields).

   col is a name the renderer resolves: green=engaged, cyan=armed(blue), white, amber.
   ═══════════════════════════════════════════════════════════════ */

const cell  = (val, col) => ({ val, col, flash: 0 });
const BLANK = cell('', 'white');

/* Flight phase from the raw state — shared by both mappers. */
function _phase(p) {
  const { wow, n1 = 0, vs = 0, alt = 0, altT = alt, gear = false, fieldElev = 0 } = p;
  const agl = alt - fieldElev;
  if (wow && n1 <= 80)  return 'parked';                       // on the ground, below takeoff thrust
  if (wow || agl < 30)  return 'takeoff';                      // TOGA set, on or just off the ground
  const nearCruise = Math.abs(alt - altT) < 250 && Math.abs(vs) < 350;
  if (vs > 350 && !nearCruise)  return 'climb';
  if (gear && agl < 2500)       return 'approach';
  if (vs < -350 && !nearCruise) return 'descent';
  return 'cruise';
}

/* Airbus — 5 columns: A/THR·thrust | vertical | lateral | approach-cap | AP/FD·A-THR. */
export function computeAirbusFMA(p) {
  const { n1 = 0, alt = 0, fieldElev = 0, ap = false, navManaged = false } = p;
  const agl  = alt - fieldElev;
  const apfd = ap ? cell('AP1', 'white') : cell('1FD2', 'white');
  /* lateral: managed NAV (green) when LNAV follows the plan, else selected HDG (cyan) */
  const lat  = navManaged ? cell('NAV', 'green') : cell('HDG', 'cyan');
  switch (_phase(p)) {
    case 'parked':   return [BLANK, BLANK, BLANK, BLANK, BLANK];
    case 'takeoff':  return [cell('MAN TO/GA', 'white'), cell('SRS', 'green'), cell('RWY', 'green'),
                             BLANK, cell('A/THR', 'cyan')];               // A/THR armed (blue) once set
    case 'climb':    return [n1 > 90 ? cell('MAN TO/GA', 'white') : cell('THR CLB', 'green'),
                             agl < 1500 ? cell('SRS', 'green') : cell('CLB', 'green'),
                             lat, BLANK, apfd];
    case 'approach': return [cell('SPEED', 'green'), cell('G/S', 'green'), cell('LOC', 'green'),
                             cell('CAT 3', 'green'), apfd];
    case 'descent':  return [cell('SPEED', 'green'), cell('DES', 'green'), lat, BLANK, apfd];
    default:         return [cell('SPEED', 'green'), cell('ALT CRZ', 'green'), lat, BLANK, apfd];
  }
}

/* Boeing — 3 fields: A/T | roll | pitch. Active modes in green (armed would be white). */
export function computeBoeingFMA(p) {
  const { n1 = 0, navManaged = false } = p, G = 'green';
  const roll = navManaged ? cell('LNAV', G) : cell('HDG SEL', G);   // managed plan vs selected heading
  switch (_phase(p)) {
    case 'parked':   return [BLANK, BLANK, BLANK];
    case 'takeoff':  return [cell('N1', G),                          cell('TO/GA', G), cell('TO/GA', G)];
    case 'climb':    return [cell(n1 > 90 ? 'N1' : 'THR REF', G),    roll,  cell('VNAV SPD', G)];
    case 'approach': return [cell('SPD', G),                         cell('LOC', G),   cell('G/S', G)];
    case 'descent':  return [cell('SPD', G),                         roll,  cell('VNAV PTH', G)];
    default:         return [cell('SPD', G),                         roll,  cell('VNAV PTH', G)];  // cruise
  }
}
