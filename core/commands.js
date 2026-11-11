/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/commands.js
   The one door into the aircraft: named commands, each owned by the module that owns
   the state it changes. A key, a click on a lever, a joystick button, the crew and
   (later) the hub all call the same command — so a rule (the gear's squat lock, a
   guarded switch, a spring-loaded position) lives once, in its owner.

     owner:   registerCommand('gear', (arg) => { …; return false when refused })
     caller:  command('gear', 'down', { source: 'key' })   → true when it was done

   Every command that is done is recorded in the black box once, here:
   { type: 'command', command, arg, source }.

   The key map's actions (core/keymap.js) are not commands: an action receives the
   keyboard event; it calls a command. (docs/issues.md, *Instruments, controls and
   mixed panels — the plan*, step 2a.)
   ═══════════════════════════════════════════════════════════════ */

import { bbEvent } from './blackbox.js';

const _commands = new Map();

/** An owner registers what a command does: fn(arg) — return false when the command is refused */
export function registerCommand(name, fn) {
  if (_commands.has(name)) console.warn(`[commands] "${name}" registered twice — the last one wins`);
  _commands.set(name, fn);
}

/** Run a command: true when it was done, false when refused (or unknown). `source` says who asked — key, joystick,
    click, crew, hub — for the black box. `record: false` — a step of a drag: done, not recorded; the drag's end is
    recorded once with recordCommand (only where a lever ends matters — Markus, 2026-11-11). */
export function command(name, arg, { source = 'unknown', record = true } = {}) {
  const fn = _commands.get(name);
  if (!fn) { console.warn(`[commands] unknown command "${name}"`); return false; }
  const done = fn(arg) !== false;
  if (done && record) bbEvent({ type: 'command', command: name, arg: arg ?? null, source });
  return done;
}

/** Record where a drag ended — once, after its steps ran with `record: false` */
export function recordCommand(name, arg, { source = 'unknown' } = {}) {
  bbEvent({ type: 'command', command: name, arg: arg ?? null, source });
}

/** The registered command names — for tests and the controls' schema check */
export const commandNames = () => [..._commands.keys()];
