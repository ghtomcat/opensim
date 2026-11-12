/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/fcu.js
   The FCU's targets — their owner and commands (the airliners' glareshield: the SPD, HDG,
   ALT and V/S knobs, AP1, A/THR; the QNH knob is core/baro.js's). A small owner until the
   autopilot has one of its own (issues.md, "tickPhysics() is one 680-line function" — then
   these fold into it). The rules moved here unchanged from index.html (2026-11-12):

     turn SPD   ±1 kt (100 … 350), selected speed     push SPD   managed ↔ selected
     turn HDG   ±1° (1 … 360), HDG mode                push HDG   managed NAV ↔ HDG
     turn ALT   ±100 ft a step (0 … 43 000), ALT       push ALT   managed VNAV ↔ ALT
     turn V/S   ±100 fpm a step (±6 000), V/S mode     push V/S   level off (V/S 0)
     AP1        engage / disengage — engaging holds the present state: a selected heading
                becomes the present one, a selected altitude the present indicated one
     A/THR      engage / disengage
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { registerCommand } from './commands.js';
import { indicatedAlt } from './baro.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fcuSpeed({ step = 0 } = {})    { setState({ spdT: clamp((S.spdT ?? 0) + step, 100, 350), spdManaged: false }); return true; }
export function fcuHeading({ step = 0 } = {})  { setState({ hdgT: (((Math.round(S.hdgT ?? 360) + step - 1) % 360) + 360) % 360 + 1, navManaged: false }); return true; }
export function fcuAltitude({ step = 0 } = {}) {
  setState({ altT: clamp(Math.round((S.altT ?? 0) / 100) * 100 + step * 100, 0, 43000), altManaged: false });
  return true;
}
export function fcuVs({ step = 0 } = {})       { setState({ vsSelected: true, altManaged: false, vsT: clamp(Math.round((S.vsT ?? 0) / 100) * 100 + step * 100, -6000, 6000) }); return true; }

export function autopilot(on = 'toggle') {
  const next = on === 'toggle' ? !S.ap : !!on;
  if (next === !!S.ap) return false;
  const sync = next ? {                                                    // engaging → hold the present state
    ...(S.navManaged ? {} : { hdgT: ((Math.round(S.hdg ?? 0) + 359) % 360) + 1 }),
    ...(S.altManaged ? {} : { altT: Math.round(indicatedAlt(S.alt ?? 0) / 100) * 100 }),
  } : {};
  setState({ ap: next, ...sync });
  return true;
}
export function autothrust(on = 'toggle') {
  const next = on === 'toggle' ? !S.athr : !!on;
  if (next === !!S.athr) return false;
  setState({ athr: next });
  return true;
}

registerCommand('fcuSpeed',        (a) => fcuSpeed(a));
registerCommand('fcuSpeedPush',    () => { setState({ spdManaged: !S.spdManaged }); return true; });
registerCommand('fcuHeading',      (a) => fcuHeading(a));
registerCommand('fcuHeadingPush',  () => { setState({ navManaged: !S.navManaged }); return true; });
registerCommand('fcuAltitude',     (a) => fcuAltitude(a));
registerCommand('fcuAltitudePush', () => { setState({ altManaged: !S.altManaged }); return true; });
registerCommand('fcuVs',           (a) => fcuVs(a));
registerCommand('fcuVsPush',       () => { setState({ vsSelected: true, altManaged: false, vsT: 0 }); return true; });   // level off
registerCommand('autopilot',       (on) => autopilot(on));
registerCommand('autothrust',      (on) => autothrust(on));
