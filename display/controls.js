/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/controls.js
   The controls: what you click. Each defined ONCE — its kind, what it reads, which
   command it sends — whether it is drawn on a canvas or built in HTML (the technique is
   only its look; Markus, 2026-11-11). `operate(id)` is what a click does. The commands
   and their rules are the owners' (core/commands.js). docs/issues.md, *Instruments,
   controls and mixed panels — the plan*, step 2.

   Kinds and their click:
     toggle   flips — a guarded one lifts its guard on the first click, then flips;
              turning it off closes the guard again
     rotary   with detents, SWEEPS: the next position in the current direction, turning
              round at either end — no wrap-around; a spring-loaded end (START) counts as
              reached, so after it springs back the next click goes the other way:
                OFF → R → L → BOTH → START ⟲ BOTH → L → R → OFF → R …
     lever    two positions (the gear): the other one
     select   a row of buttons or a gate (the autobrake, the cooling flaps): set to the one clicked — setControl
     knob     turns freely (the altimeter setting): a drag or the wheel — turn(), and turned() when a drag ends
   The sweep's direction and a guard's state belong to the control, not to the aircraft:
   kept here per control id, cleared on every mission load.
   ═══════════════════════════════════════════════════════════════ */

import { S } from '../core/state.js';
import { command, recordCommand } from '../core/commands.js';
import { onMissionReset } from '../core/lifecycle.js';
import { MAGNETO_POSITIONS, ENG_MODE_POSITIONS } from '../core/engine.js';
import { SPEED_BRAKE_POSITIONS } from '../core/flaps.js';
import { fuelSelectorPositions } from '../core/fuel.js';
import { lightSwitchOn } from '../core/electrical.js';

/** The set point nearest to a lever's value — where a stepped knob stands */
const _nearest = (pts, v) => pts.reduce((b, p) => Math.abs(p - v) < Math.abs(b - v) ? p : b, pts[0]);

const _dir = new Map();          // control id → +1 | −1 (a rotary's sweep)
const _guardOpen = new Set();    // control ids whose guard is lifted
onMissionReset(() => { _dir.clear(); _guardOpen.clear(); });

/** The position a click on a sweeping rotary switch goes to — from `current`, among `positions` */
export function sweep(id, positions, current) {
  const n = positions.length, i = Math.max(0, positions.indexOf(current));
  if (n < 2) return positions[0];
  let d = _dir.get(id) ?? (i === n - 1 ? -1 : 1);
  let next = i + d;
  if (next < 0 || next >= n) { d = -d; next = i + d; }      // at an end: turn round
  if (next === 0 || next === n - 1) d = -d;                  // reaching an end: the next click goes back
  _dir.set(id, d);
  return positions[next];
}

/* ── The definitions. A toggle: read() → on?, arg(on) → the command's argument. A rotary: positions(), read(). ── */
const elec  = (id) => ({ kind: 'toggle', read: () => lightSwitchOn(id), command: 'elec', arg: (on) => ({ id, on }) });
const light = (id) => ({ kind: 'toggle', read: () => !!S.lights?.[id], command: 'lights', arg: (on) => ({ light: id, on }) });

export const CONTROLS = {
  bat: elec('bat'), alt: elec('alt'), avionics: elec('avionics'), battEn: elec('battEn'), pwrEn: elec('pwrEn'),
  'lights.nav': light('nav'), 'lights.beacon': light('beacon'), 'lights.strobe': light('strobe'), 'lights.landing': light('landing'),
  fuelPump:    { kind: 'toggle', read: () => !!S.fuelPump,    command: 'auxFuelPump', arg: (on) => on },
  fuelShutoff: { kind: 'toggle', read: () => !!S.fuelShutoff, command: 'fuelShutoff', arg: (on) => on ? 'closed' : 'open' },   // on = pulled / ZU
  carbHeat:    { kind: 'toggle', read: () => !!S.carbHeat,    command: 'carbHeat',    arg: (on) => on },
  parkBrake:   { kind: 'toggle', read: () => !!S.parkBrake,   command: 'parkBrake',   arg: (on) => on },
  magnetos:     { kind: 'rotary', positions: () => MAGNETO_POSITIONS,       read: () => S.magnetos,     command: 'magnetos' },
  fuelSelector: { kind: 'rotary', positions: () => fuelSelectorPositions(), read: () => S.fuelSelector, command: 'fuelSelector' },
  gear: { kind: 'lever', read: () => S.gear ? 'down' : 'up', command: 'gear' },
  engMode:    { kind: 'rotary', positions: () => ENG_MODE_POSITIONS,    read: () => S.engMode ?? 'NORM', command: 'engineMode' },
  speedBrake: { kind: 'rotary', positions: () => SPEED_BRAKE_POSITIONS, read: () => S.speedBrake ?? 0,  command: 'speedBrake' },   // a lever with detents: RET, ARM, FULL
  flaps:      { kind: 'select', read: () => S.flaps ?? 0, command: 'flaps' },               // the lever's detents as buttons: setControl
  autobrake:  { kind: 'select', read: () => S.autobrake ?? 'OFF', command: 'autobrake' },     // a row of buttons: setControl
  coolFlap:   { kind: 'select', read: () => S.coolFlap ?? 1,      command: 'coolFlap' },      // a gate: setControl
  /* levers, 0 … 1 — set where clicked (setControl), later dragged (steps unrecorded, the end recorded — core/commands.js) */
  throttle:  { kind: 'lever-continuous', read: () => S.aircraft?.engine?.type === 'turbofan' ? (S.thrustLever ?? 0) : (S.spdT ?? 0) / (S.aircraft?.envelope?.maxSpd ?? 350), command: 'throttle' },
  propPitch: { kind: 'lever-continuous', read: () => S.propPitch ?? 1, command: 'propPitch' },
  mixture:   { kind: 'lever-continuous', read: () => S.mixture ?? 1,   command: 'mixture' },
  trim:      { kind: 'lever-continuous', read: () => S.trim ?? 0,      command: 'trim' },      // −10 … +10
  /* the C172's push-pull knobs, stepped by a click through set points — a sweep, no wrap-around */
  throttleKnob: { kind: 'rotary', positions: () => [0, 0.7, 1],   read: () => _nearest([0, 0.7, 1], CONTROLS.throttle.read()), command: 'throttle' },   // IDLE, CRUISE, FULL
  mixtureKnob:  { kind: 'rotary', positions: () => [1, 0.5, 0],   read: () => _nearest([1, 0.5, 0], S.mixture ?? 1),            command: 'mixture' },    // RICH, LEAN, ICO
  apuMaster:  { kind: 'toggle', read: () => !!S.apuMasterOn, command: 'apuMaster', arg: (on) => on },
  apuBleed:   { kind: 'toggle', read: () => !!S.apuBleedOn,  command: 'apuBleed',  arg: (on) => on },
  apuFire:    { kind: 'toggle', read: () => !!S.apuFireArmed, command: 'apuFire', arg: () => undefined },   // a handle: pulled once, under a guard
};
/* ENG FIRE handle per engine — `engFire.1` …, under a guard; pulled once */
for (let i = 0; i < 8; i++)
  CONTROLS[`engFire.${i + 1}`] = { kind: 'toggle', read: () => !!S.engFireArmed?.[i], command: 'engineFire', arg: () => ({ engine: i }) };

/* the altimeter's setting knob — a free-turning knob; a step is the dial's own unit (stepHpa: 1 hPa, 0.01 in. Hg, 1 mm Hg) */
CONTROLS.baroKnob = { kind: 'knob', read: () => S.baroSet, command: 'baroSet', arg: (steps, { stepHpa = 1 } = {}) => ({ step: steps * stepHpa }) };
/* the heading instruments' knobs (core/gyro.js) — 1° a step */
CONTROLS.courseKnob = { kind: 'knob', read: () => S.courseSet, command: 'courseSet', arg: (steps) => ({ step: steps }) };
CONTROLS.dgKnob     = { kind: 'knob', read: () => S.dgOffset,  command: 'dgSet',     arg: (steps) => ({ step: steps }) };

/* the FCU's knobs — turn and push (core/fcu.js, core/baro.js) — and its buttons */
const fcuKnob = (cmd, push) => ({ kind: 'knob', read: () => null, command: cmd, push, arg: (steps) => ({ step: steps }) });
Object.assign(CONTROLS, {
  fcuQnh: { kind: 'knob', read: () => S.baroSet, command: 'baroSet', push: 'baroStd', pushArg: 'toggle', arg: (steps) => ({ step: steps }) },
  fcuSpd: fcuKnob('fcuSpeed', 'fcuSpeedPush'), fcuHdg: fcuKnob('fcuHeading', 'fcuHeadingPush'),
  fcuAlt: fcuKnob('fcuAltitude', 'fcuAltitudePush'), fcuVs: fcuKnob('fcuVs', 'fcuVsPush'),
  ap1:  { kind: 'toggle', read: () => !!S.ap,   command: 'autopilot',  arg: () => 'toggle' },
  athr: { kind: 'toggle', read: () => !!S.athr, command: 'autothrust', arg: () => 'toggle' },
});

/** A knob pushed (a click on it) — its push command, where it has one */
export function push(id, { source = 'click' } = {}) {
  const c = CONTROLS[id];
  return c?.push ? command(c.push, c.pushArg, { source }) : false;
}

/** A knob turned by `steps` (a drag's step or a wheel's notch) — opts go to its argument (a step's size); `record: false`
    for a drag's steps, recorded once at the end with turned() */
export function turn(id, steps, { source = 'click', record = true, ...opts } = {}) {
  const c = CONTROLS[id];
  if (c?.kind !== 'knob') { console.warn(`[controls] not a knob: "${id}"`); return false; }
  return command(c.command, c.arg(steps, opts), { source, record });
}
/** A knob's drag ended — recorded once, with where it ended */
export function turned(id, { source = 'click' } = {}) {
  const c = CONTROLS[id];
  if (c?.kind === 'knob') recordCommand(c.command, { value: c.read() }, { source });
}

/** A control's state as drawn: a toggle's on, a rotary's or a lever's position */
export const controlState = (id) => CONTROLS[id]?.read();

/** Is a guarded switch's guard lifted? */
export const guardOpen = (id) => _guardOpen.has(id);

/** Lift or close a guard by itself (a guard drawn apart from its switch — the overhead's fire handles) */
export function toggleGuard(id) { if (_guardOpen.has(id)) _guardOpen.delete(id); else _guardOpen.add(id); }

/** A control set straight to a position — a detent button, a gate, a row of buttons (`select`) */
export function setControl(id, value, { source = 'click' } = {}) {
  const c = CONTROLS[id];
  if (!c) { console.warn(`[controls] unknown control "${id}"`); return false; }
  return command(c.command, c.arg ? c.arg(value) : value, { source });
}

/** A click on control `id` — the command it sends, through its owner. `opts.guarded`: the switch on this panel has a
    guard. `opts.source`: who asked (default 'click'). True when something changed (a guard lifted counts). */
export function operate(id, { guarded = false, source = 'click' } = {}) {
  const c = CONTROLS[id];
  if (!c) { console.warn(`[controls] unknown control "${id}"`); return false; }
  if (c.kind === 'toggle') {
    const on = !!c.read();
    if (guarded && !on && !_guardOpen.has(id)) { _guardOpen.add(id); return true; }   // first click: lift the guard
    _guardOpen.delete(id);                                                            // thrown, or turned off: it closes
    return command(c.command, c.arg(!on), { source });
  }
  if (c.kind === 'rotary') return command(c.command, sweep(id, c.positions(), c.read()), { source });
  if (c.kind === 'lever')  return command(c.command, 'toggle', { source });
  return false;
}
