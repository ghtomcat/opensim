/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/fma.js
   Flight Mode Annunciator state — a shared phase model.

   Autoflight modes mean the same thing across manufacturers; only the words and the
   column/field layout differ. _phase() decides the flight phase once; each manufacturer's
   mapper decompresses it into its own vocabulary — Airbus (5 columns) and Boeing (3 fields).

   col is a name the renderer resolves: green=engaged, cyan=armed(blue), white, amber.
   ═══════════════════════════════════════════════════════════════ */

const cell  = (val, col, val2 = '', col2 = 'white') => ({ val, col, flash: 0, val2, col2 });
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
  const { n1 = 0, alt = 0, fieldElev = 0, ap = false, athr = false,
          athrMode = null, athrDetent = null, navManaged = false, altManaged = false,
          locCap = false, gsCap = false } = p;
  const agl  = alt - fieldElev;
  /* Column 5 — AP/FD on top, A/THR below (cyan when active). One AP modelled → AP1 / 1FD2. */
  const apfd = ap ? cell('AP1',  'white', athr ? 'A/THR' : '', 'cyan')
                  : cell('1FD2', 'white', athr ? 'A/THR' : '', 'cyan');
  /* lateral: managed NAV (green) when LNAV follows the plan, else selected HDG (cyan) */
  const lat  = navManaged ? cell('NAV', 'green') : cell('HDG', 'cyan');
  /* vertical: managed mode (green) when VNAV flies the profile, else selected ALT hold (cyan) */
  const vert = (label) => altManaged ? cell(label, 'green') : cell('ALT', 'cyan');
  /* thrust column: A/THR pinned at the detent ceiling → THR <detent> (green); modulating to
     hold speed → SPEED/MACH (green); A/THR off → MAN, from the lever detent (white). */
  const thr = !athr        ? cell(athrDetent === 'TOGA' ? 'MAN TO/GA' : 'MAN THR', 'white')
            : athrMode === 'THR' ? cell('THR ' + (athrDetent ?? 'CLB'), 'green')
            : cell(athrMode === 'MACH' ? 'MACH' : 'SPEED', 'green');
  switch (_phase(p)) {
    case 'parked':   return [BLANK, BLANK, BLANK, BLANK, BLANK];
    case 'takeoff':  return [cell('MAN TO/GA', 'white'), cell('SRS', 'green'), cell('RWY', 'green'),
                             BLANK, athr ? cell('A/THR', 'cyan') : BLANK];   // A/THR armed (blue) once set
    case 'climb':    return [thr, agl < 1500 ? cell('SRS', 'green') : vert('CLB'), lat, BLANK, apfd];
    case 'approach': return [thr, cell('G/S', gsCap ? 'green' : 'cyan'),     // green = captured, cyan = armed
                                  cell('LOC', locCap ? 'green' : 'cyan'),
                                  cell('CAT 3 SINGLE', 'green', 'DH 50', 'white'),   // single AP → SINGLE + decision height
                                  apfd];
    case 'descent':  return [thr, vert('DES'), lat, BLANK, apfd];
    default:         return [thr, vert('ALT CRZ'), lat, BLANK, apfd];
  }
}

/* Boeing — 3 fields: A/T | roll | pitch. Active modes in green (armed would be white). */
export function computeBoeingFMA(p) {
  const { n1 = 0, navManaged = false, altManaged = false } = p, G = 'green';
  const roll = navManaged ? cell('LNAV', G) : cell('HDG SEL', G);   // managed plan vs selected heading
  const pit  = (label) => altManaged ? cell(label, G) : cell('ALT HOLD', G);   // managed VNAV vs selected ALT
  switch (_phase(p)) {
    case 'parked':   return [BLANK, BLANK, BLANK];
    case 'takeoff':  return [cell('N1', G),                          cell('TO/GA', G), cell('TO/GA', G)];
    case 'climb':    return [cell(n1 > 90 ? 'N1' : 'THR REF', G),    roll,  pit('VNAV SPD')];
    case 'approach': return [cell('SPD', G),                         cell('LOC', G),   cell('G/S', G)];
    case 'descent':  return [cell('SPD', G),                         roll,  pit('VNAV PTH')];
    default:         return [cell('SPD', G),                         roll,  pit('VNAV PTH')];  // cruise
  }
}
