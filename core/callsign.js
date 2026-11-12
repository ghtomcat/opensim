/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/callsign.js
   The aircraft's registration as it is spoken on the radio — the phonetic alphabet,
   in full on first contact, then shortened (Markus, 2026-11-12, as flown at Grenchen):
     "HB-SYQ" → "Hotel Bravo Sierra Yankee Quebec" the first time it is spoken in a
     mission, then "Sierra Yankee Quebec" (the letters after the nationality prefix).
   The mission texts keep writing "HB-SYQ" (readable in subtitles and on the kneeboard);
   only the speech converts it (core/crew.js, every spoken line). Only the aircraft's own
   registration, as written with its dash — other text with a dash ("IO-360") is untouched.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { onMissionReset } from './lifecycle.js';

const ALPHA = { A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
                J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
                S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
                0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'niner' };
const _spell = (s) => [...s.toUpperCase()].map(c => ALPHA[c] ?? c).join(' ');

/** A registration (prefix-letters, e.g. HB-SYQ, D-FEML) — or null for anything else (an airline callsign) */
const _parse = (cs) => { const m = /^([A-Z0-9]{1,2})-([A-Z0-9]{2,5})$/i.exec(cs ?? ''); return m ? { prefix: m[1], rest: m[2] } : null; };

/** The registration spoken: in full ("Hotel Bravo Sierra Yankee Quebec") or short ("Sierra Yankee Quebec") */
export function spokenCallsign(cs, { full = true } = {}) {
  const r = _parse(cs);
  if (!r) return cs;
  return full ? `${_spell(r.prefix)} ${_spell(r.rest)}` : _spell(r.rest);
}

let _contacted = false;   // the full form has been spoken once in this mission
onMissionReset(() => { _contacted = false; });

/** A line to be spoken, with the aircraft's own registration in radio form — full the first time, short after */
export function radioSpeech(text, cs = S.aircraft?.callsign) {
  if (!text || !_parse(cs)) return text;
  const re = new RegExp(`\\b${cs.replace('-', '-?')}\\b`, 'gi');
  return text.replace(re, () => { const s = spokenCallsign(cs, { full: !_contacted }); _contacted = true; return s; });
}
