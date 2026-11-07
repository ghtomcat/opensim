/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/keymap.js
   The one key map: which key does what, on which vehicle, and what it
   is called. One table, one dispatcher. The key map on screen and
   docs/keybindings.md are both generated from the table,
   so they can't say anything the keys don't do.

   A module doesn't listen for keys. It registers what an action does
   (registerActions), and the table says when that action's keys apply.

   A key runs the FIRST binding that matches, so two modules can't both
   react to one press: put the more specific binding first.

   A binding:
     id     the action; registerActions({ [id]: fn }), or { down, up }
     keys   e.key values, both cases where case doesn't matter
     when   (ac, S) → does it apply to this vehicle right now. For the
            generated lists it is asked about the aircraft alone (S is
            null), before anything is loaded: read S only behind `S &&`.
     show   the key as written in the lists. Absent: not listed.
     desc   what it does (string, or (ac) → string)
     group  the section in docs/keybindings.md
   Options:
     mod: 'ctrl+shift' (a key without it ignores Ctrl and Cmd presses, so
     browser shortcuts stay the browser's); hold: tracked for isKeyHeld(),
     no action needed; noop: does nothing but take the key; prevent:
     preventDefault(); noRepeat: ignore auto-repeat; inText: also from a
     text field; ctx: 'briefing' (default 'flight'); inMap: false: in the
     docs but not on the key map; info: a row that isn't a key at all.

   Two other keydown listeners exist, and neither binds a key: the audio
   wake-up in core/audio.js (capture phase, any key is the gesture) and
   the live-flight search box's own Enter.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { VEHICLE, PANEL, ENGINE, ENGINE_TYPE } from './vocab.js';

/* ── What the conditions read ── */
const sound    = (ac) => ac?.sound?.engineType ?? ENGINE.GEARED_TURBOFAN;
const vehicle  = (ac) => ac?.vehicleType;
const rocket   = (ac) => vehicle(ac) === VEHICLE.ROCKET;
const arm      = (ac) => vehicle(ac) === VEHICLE.ROBOT_ARM;
const dog      = (ac) => vehicle(ac) === VEHICLE.ROBOT_DOG;
const manual   = (ac) => !!ac?.manualControl;
const turbofan = (ac) => ac?.engine?.type === ENGINE_TYPE.TURBOFAN;
const glass    = (ac) => ac?.panel === PANEL.AIRBUS || ac?.panel === PANEL.E190;
const hasView  = (view) => (ac) => !!ac?.views?.includes(view);
const flown    = (ac) => !!ac && !rocket(ac) && !arm(ac) && !dog(ac);
const stick    = (ac) => flown(ac) && manual(ac);

/** Does this aircraft's engine sound have a start sequence: it waits for the engine on a ground start. */
export const hasStartSequence = (ac) => [ENGINE.V12_SUPERCHARGED, ENGINE.RADIAL_2000HP, ENGINE.LYCOMING_O360,
  ENGINE.ELECTRIC, ENGINE.GEARED_TURBOFAN, ENGINE.TURBOJET_VK1].includes(sound(ac));
const keyStart = (ac) => !turbofan(ac) && hasStartSequence(ac);   // an airliner's start belongs to the whole aircraft: the pedestal
const keyCutoff = (ac) => [ENGINE.V12_SUPERCHARGED, ENGINE.RADIAL_2000HP, ENGINE.GEARED_TURBOFAN, ENGINE.TURBOJET_VK1].includes(sound(ac));

export const KEYS = [
  /* ── The robots' own keys come first: their X, C, H, L and Space mean something else ── */
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: '[ ]', desc: 'Select a joint or part',
    keys: ['[', ']'], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: '1–6', desc: 'Jump to joint J1–J6',
    keys: ['1', '2', '3', '4', '5', '6'], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: 'X Y Z', desc: 'Edit axis',
    keys: ['x', 'X', 'y', 'Y', 'z', 'Z'], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: 'L', desc: 'Log the mesh transforms to the console',
    keys: ['l', 'L'], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: 'C', desc: 'Cartesian jog mode on / off',
    keys: ['c', 'C'], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: 'W S A D R F', desc: 'Cartesian jog (in jog mode)',
    keys: ['w', 'W', 's', 'S', 'a', 'A', 'd', 'D', 'r', 'R', 'f', 'F'], when: (ac, s) => arm(ac) && (!s || !!s.armCartMode) },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: 'H', desc: 'Home position',
    keys: ['h', 'H'], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: 'Space', desc: 'Gripper open / close',
    keys: [' '], when: arm },
  { id: 'arm-keys', group: 'Robot arm (SO-101)', show: '↑ ↓ ← →', desc: 'Move the selected joint or part (Shift: bigger steps); in jog mode ↑ ↓ set the step',
    keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], when: arm },

  { id: 'dog-keys', group: 'Robot dog (Yertle)', show: '[ ]', desc: 'Select a joint',
    keys: ['[', ']'], when: dog },
  { id: 'dog-keys', group: 'Robot dog (Yertle)', show: '1–9 0 - =', desc: 'Jump to a joint',
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], when: dog },
  { id: 'dog-keys', group: 'Robot dog (Yertle)', show: '← →', desc: 'Move the selected joint (Shift: bigger steps)',
    keys: ['ArrowLeft', 'ArrowRight'], when: dog },
  { id: 'dog-keys', group: 'Robot dog (Yertle)', show: 'H', desc: 'Home position',
    keys: ['h', 'H'], when: dog },
  { id: 'dog-keys', group: 'Robot dog (Yertle)', show: 'L', desc: 'Log the mesh transforms to the console',
    keys: ['l', 'L'], when: dog },

  /* ── Flight controls ── */
  { id: 'stick', group: 'Flight controls', show: 'Mouse (hold) / ↑ ↓ ← →',
    desc: 'Stick (wings level when released) · on the ground ← → steer',
    keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], when: stick, hold: true },
  { id: 'alt-target', group: 'Flight controls', show: '↑ ↓', desc: 'Altitude target ±500 ft',
    keys: ['ArrowUp', 'ArrowDown'], when: (ac) => flown(ac) && !manual(ac) },
  { id: 'hdg-target', group: 'Flight controls', show: '← →', desc: 'Heading target ±5°',
    keys: ['ArrowLeft', 'ArrowRight'], when: (ac) => flown(ac) && !manual(ac) },
  { id: 'rudder', group: 'Flight controls', show: ', . (hold)', desc: 'Rudder left / right (springs back) · steers on the ground',
    keys: [',', '.'], when: stick, hold: true },
  { id: 'rudder-trim', group: 'Flight controls', show: '< >', desc: 'Rudder trim left / right',
    keys: ['<', '>'], when: stick },
  { id: 'trim-up', group: 'Flight controls', show: 't', desc: 'Pitch trim nose up', keys: ['t'], when: flown },
  { id: 'trim-down', group: 'Flight controls', show: 'T', desc: 'Pitch trim nose down', keys: ['T'], when: flown },
  { id: 'brakes', group: 'Flight controls', show: 'B (hold)', desc: 'Brakes (disarm the autobrake)', keys: ['b', 'B'], when: flown },

  /* ── Engine and systems ── */
  { id: 'thrust', group: 'Engine and systems', show: '+ −',
    desc: (ac) => turbofan(ac) ? 'Thrust lever ±10 %' : manual(ac) ? 'Throttle ±' : 'Speed target ±5 kt',
    keys: ['=', '+', '-', '_'], when: flown },
  { id: 'thrust-detent', group: 'Engine and systems', show: 'F1–F4',
    docDesc: 'Thrust detents: the aircraft\'s `thrustProfiles`',
    desc: (ac) => ac?.thrustProfiles ? `Thrust: ${ac.thrustProfiles.map(p => p.label).join(' · ')}` : 'Thrust detents',
    keys: ['F1', 'F2', 'F3', 'F4'], when: flown, prevent: true },
  { id: 'flaps-extend', group: 'Engine and systems', show: 'f', desc: 'Flaps: extend one stage', keys: ['f'], when: flown },
  { id: 'flaps-retract', group: 'Engine and systems', show: 'F', desc: 'Flaps: retract one stage', keys: ['F'], when: flown },
  { id: 'gear', group: 'Engine and systems', show: 'G', desc: 'Gear up / down (not on the ground)',
    keys: ['g', 'G'], when: (ac) => flown(ac) && !ac.fixedGear },
  { id: 'speed-brake', group: 'Engine and systems', show: 'S', desc: 'Speed brake: RET → ARM → FULL',
    keys: ['s', 'S'], when: (ac) => flown(ac) && !!ac?.spoilers },   // the aircraft data has spoilers
  { id: 'start-pedestal', group: 'Engine and systems', info: true, show: 'D',
    desc: 'Engine start on the pedestal: power, ENG MODE IGN/START, ENG MASTERs', when: turbofan },
  { id: 'start-panel', group: 'Engine and systems', info: true, show: 'Panel',
    desc: 'Motor on: MASTER → BATT EN → PWR EN', when: (ac) => sound(ac) === ENGINE.ELECTRIC },
  { id: 'engine-start', group: 'Engine and systems', show: 'E',
    desc: (ac) => ac?.engine?.starter === 'electric' ? 'Engine start (battery on first)' : 'Engine start',
    keys: ['e', 'E'], when: keyStart, listed: (ac) => sound(ac) !== ENGINE.ELECTRIC },
  { id: 'engine-cutoff', group: 'Engine and systems', show: 'Q',
    desc: (ac) => turbofan(ac) ? 'Fuel cutoff, all engines' : 'Engine cutoff',
    keys: ['q', 'Q'], when: keyCutoff },
  { id: 'fuel-selector', group: 'Engine and systems', show: 'Q', desc: 'Fuel selector: BOTH → LEFT → RIGHT → OFF',
    keys: ['q', 'Q'], when: (ac) => !keyCutoff(ac) && manual(ac) && !!ac.tanks },
  { id: 'carb-heat', group: 'Engine and systems', show: 'H', desc: 'Carburettor heat',
    keys: ['h', 'H'], when: (ac) => !!ac?.hasCarbHeat },
  { id: 'situation', group: 'Engine and systems', show: '1–5', desc: 'Situation presets (no mission loaded)', inMap: false,
    keys: ['1', '2', '3', '4', '5'], when: (ac, s) => !!ac?.situations && (!s || !s.mission) },

  /* ── Cockpit, views and screens ── */
  { id: 'screen-page', group: 'Views and screens', show: 'Tab', desc: 'Right screen: ND, then the ECAM pages (Shift+Tab: left screen; centre view: ELEC → HYD → FUEL)',
    keys: ['Tab'], when: glass, prevent: true },
  { id: 'tab-none', keys: ['Tab'], noop: true, prevent: true },   // never moves the browser's focus
  { id: 'view-mode', group: 'Views and screens', show: 'V', desc: 'View: instruments → combined → outside', keys: ['v', 'V'] },
  { id: 'camera', group: 'Views and screens', show: 'C', desc: 'Outside camera', keys: ['c', 'C'] },
  { id: 'orbit-reset', group: 'Views and screens', show: '0', desc: 'While paused: reset the outside camera', keys: ['0'], when: (ac, s) => !s || !!s.paused, inMap: false },
  { id: 'overhead', group: 'Views and screens', show: 'O', desc: 'Overhead panel', keys: ['o', 'O'], when: hasView('overhead') },
  { id: 'pedestal', group: 'Views and screens', show: 'D', desc: 'Pedestal', keys: ['d', 'D'], when: hasView('pedestal') },
  { id: 'center-view', group: 'Views and screens', show: 'M', desc: 'Centre panel', keys: ['m', 'M'], when: hasView('center') },
  { id: 'left-console', group: 'Views and screens', show: 'L', desc: 'Left console', keys: ['l', 'L'], when: hasView('left') },
  { id: 'lm-panel', group: 'Views and screens', show: 'L', desc: 'CM ↔ LM panel (after S-IVB separation)',
    keys: ['l', 'L'], when: (ac, s) => ac?.id === 'saturn-v' && (!s || (!!s.mission?.hasLM && !!s.sivbSep)), inMap: false },
  { id: 'right-console', group: 'Views and screens', show: 'R', desc: 'Right console', keys: ['r', 'R'], when: hasView('right') },
  { id: 'role', group: 'Views and screens', show: 'R', desc: 'Role: PF → PM → INSTRUCTOR', keys: ['r', 'R'], when: (ac) => !hasView('right')(ac) },
  { id: 'key-map', group: 'The sim', show: '?', desc: 'This key map (also the KEYS button under the clock)', keys: ['?'] },
  { id: 'kneeboard', group: 'Views and screens', show: 'K', desc: 'Kneeboard (briefings, checklists, scratchpad)', keys: ['k', 'K'] },
  { id: 'map', group: 'Views and screens', show: 'N', desc: 'Map', keys: ['n', 'N'], when: (ac) => ac?.map !== false },

  /* ── The sim ── */
  { id: 'pause', group: 'The sim', show: 'P', desc: 'Pause / resume', keys: ['p', 'P'] },
  { id: 'audio', group: 'The sim', show: 'X', desc: 'Audio on / off', keys: ['x', 'X'] },
  { id: 'ptt', group: 'The sim', show: 'Space', desc: 'PTT: push to talk', keys: [' '], prevent: true, noRepeat: true },
  { id: 'com-swap', group: 'The sim', show: 'Z', desc: 'COM: swap active ↔ standby', keys: ['z', 'Z'], when: flown },
  { id: 'warp-up', group: 'The sim', show: 'w', desc: 'Time warp: 1× → 2× → 5× → 10× → 100× → next event', keys: ['w'], when: rocket },
  { id: 'warp-down', group: 'The sim', show: 'W', desc: 'Time warp: step back', keys: ['W'], when: rocket },
  { id: 'warp-jump', group: 'The sim', show: 'J', desc: 'Time warp: jump to 60 s before the next event (again: cancel)', keys: ['j', 'J'], when: rocket },
  { id: 'back', group: 'The sim', show: 'Esc', desc: 'Back to the mission selector', keys: ['Escape'], inText: true, inMap: false },
  { id: 'telemetry', group: 'The sim', show: 'Ctrl+Shift+L', desc: 'Download the flight telemetry (JSONL; CSV on rockets)', keys: ['l', 'L'], mod: 'ctrl+shift', prevent: true, inMap: false },
  { id: 'blackbox', group: 'The sim', show: 'Ctrl+Shift+B', desc: 'Download the black box', keys: ['b', 'B'], mod: 'ctrl+shift', prevent: true, inMap: false },

  /* ── The briefing page ── */
  { id: 'briefing-back', ctx: 'briefing', keys: ['Escape'], inText: true },
  { id: 'briefing-fly',  ctx: 'briefing', keys: ['Enter'] },
];

/* ── Dispatcher ── */
const _actions = {};
const _held = new Set();
const _observers = new Set();
let _context = 'none';
let _firstKey = null;
let _bound = false;

/** Attach the one listener. Once per page. */
export function initKeys() {
  if (_bound) return;
  _bound = true;
  window.addEventListener('keydown', dispatchKeyDown);
  window.addEventListener('keyup', dispatchKeyUp);
}

/** What actions do. Registering an id again replaces it: a mission's closures replace the last one's. */
export function registerActions(actions) { Object.assign(_actions, actions); }

/** Which keys apply: 'flight', 'briefing', or 'none' (the mission picker). */
export function setKeyContext(context) { _context = context; }

/** Is this key down now (continuous input: the stick, the pedals) */
export const isKeyHeld = (key) => _held.has(key);

/** Run fn on the next key. With swallow, that key does nothing else ("press any key"). */
export function onFirstKey(fn, { swallow = false } = {}) { _firstKey = fn ? { fn, swallow } : null; }

/** See every key without binding one (live tracking's "the pilot took over", the dev profiler). */
export function observeKeys(fn) { _observers.add(fn); return () => _observers.delete(fn); }

const _inText = (e) => {
  const t = e.target;
  return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || !!t?.isContentEditable;
};

function _applies(b, e) {
  if ((b.ctx ?? 'flight') !== _context) return false;
  if (!b.keys?.includes(e.key)) return false;
  const chord = e.ctrlKey || e.metaKey;
  if (b.mod === 'ctrl+shift' ? !(e.ctrlKey && e.shiftKey) : chord) return false;
  if (b.when && !b.when(S.aircraft, S)) return false;
  return !!(b.hold || b.noop || _actions[b.id]);   // a module not loaded yet (a robot's display) leaves the key to the next binding
}

export function dispatchKeyDown(e) {
  const text = _inText(e);
  if (!text) _held.add(e.key);
  if (_firstKey && !text) {
    const { fn, swallow } = _firstKey;
    _firstKey = null;
    fn(e);
    if (swallow) return;
  }
  if (!text) for (const fn of _observers) fn(e);
  const b = KEYS.find(k => _applies(k, e) && (!text || k.inText));
  if (!b) return;
  if (b.prevent) e.preventDefault();
  if (b.noRepeat && e.repeat) return;
  const a = _actions[b.id];
  (typeof a === 'function' ? a : a?.down)?.(e);
}

export function dispatchKeyUp(e) {
  _held.delete(e.key);
  for (const b of KEYS) {
    if (!b.keys?.includes(e.key) || b.mod) continue;
    const up = _actions[b.id]?.up;
    if (up) { up(e); return; }
  }
}

/** The ids of the actions a binding needs and nothing has registered (a test keeps this empty). */
export const unregisteredActions = (ac) => [...new Set(KEYS
  .filter(b => !b.info && !b.hold && !b.noop && !b.ctx && (!b.when || b.when(ac, null)) && !_actions[b.id])
  .map(b => b.id))];

/* ── Everything said about the keys is generated from here ── */
const _text = (v, ac) => typeof v === 'function' ? v(ac) : v;
const _listed = (b, ac) => !!b.show && (!b.when || b.when(ac, null)) && (!b.listed || b.listed(ac));

/** The aircraft's key map: every key that does something on it. `keyLabels` in the file replaces a text. */
export function keyList(ac = {}) {
  return KEYS.filter(b => b.inMap !== false && _listed(b, ac))
    .map(b => ({ key: b.show, desc: ac.keyLabels?.[b.id] ?? _text(b.desc, ac) }));
}

/** The tables of docs/keybindings.md, for these aircraft files. */
export function keyDocTables(aircraft) {
  const flownIds = aircraft.filter(flown).map(a => a.id);
  const groups = new Map();
  for (const b of KEYS) {
    if (!b.show || !b.group) continue;
    const on = aircraft.filter(a => _listed(b, a));
    if (!on.length) continue;
    const ids = on.map(a => a.id);
    const who = ids.length === aircraft.length ? 'every vehicle'
      : flownIds.every(id => ids.includes(id)) && ids.length === flownIds.length ? 'every aircraft'
      : on.every(rocket) && on.length === aircraft.filter(rocket).length ? 'rockets'
      : ids.join(', ');
    const desc = b.docDesc ?? (typeof b.desc === 'function' ? [...new Set(on.map(a => b.desc(a)))].join(' · ') : b.desc);
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push(`| \`${b.show}\` | ${desc} | ${who} |`);
  }
  const out = [];
  const order = [...groups].sort(([a], [b]) => a.startsWith('Robot') - b.startsWith('Robot'));   // the robots last
  for (const [group, rows] of order) out.push(`### ${group}\n\n| Key | Action | On |\n|-----|--------|----|\n${rows.join('\n')}`);
  return out.join('\n\n');
}
