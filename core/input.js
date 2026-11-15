/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/input.js
   Keyboard, mouse, and (future) gamepad input.
   Writes to S via setState(). Never reads displays.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { command, commandContinuous } from './commands.js';
import { throttle } from './engine.js';
import { levelTrim } from './trim.js';
import './gear.js';                         // registers the gear command
import './flaps.js';                        // registers the flaps command
import { initKeys, registerActions, isKeyHeld } from './keymap.js';

/* Next upcoming timed event for any aircraft type */
function _nextEvent() {
  const mT   = S.time ?? 0;
  const ac   = S.aircraft;
  const evs  = [];
  if (ac?.vehicleType === 'rocket') {
    const perf = ac?.performance ?? {};
    const ignT = ac?.ignitionTime ?? 0;
    const COAST = 6;
    let t = ignT;
    evs.push({ t, label: 'IGNITION' });
    const stages = perf.stages ?? [];
    for (let i = 0; i < stages.length; i++) {
      const dur = stages[i]?.burnDuration;
      if (!dur) break;
      t += dur;
      const isLast = i === stages.length - 1;
      evs.push({ t, label: isLast ? 'SECO' : `MECO S-${i + 1}` });
      if (!isLast) { t += COAST; evs.push({ t, label: `S-${i + 2} IGN` }); }
    }
    const tliT = S.mission?.tliT;
    if (tliT) evs.push({ t: tliT, label: 'TLI' });
  }
  for (const e of (S.mission?.events ?? [])) evs.push({ t: e.t, label: e.label });
  return evs.filter(e => e.t > mT + 90).sort((a, b) => a.t - b.t)[0] ?? null;
}

let _mouseLast  = null;
let _mouseDown  = false;
let _pttActive  = false;

/* ── Gamepad config — Logitech Extreme 3D Pro ── */
const GP = {
  ROLL:     0,   // axes[0]  left/right
  PITCH:    1,   // axes[1]  forward/back
  RUDDER:   2,   // axes[2]  twist
  THROTTLE: 5,   // axes[5]  slider
  TRIGGER:  0,   // buttons[0]
  BTN_FLAP: 1,   // buttons[1]  flaps up
  BTN_GEAR: 2,   // buttons[2]  gear toggle
  DEADZONE: 0.08,
};

/* ── Rudder ── held `,` / `.` push the pedals toward full left / right and they spring back to
   centre when released; `<` / `>` step the rudder trim (Swiss keyboard: one key, Shift for `>`);
   the gamepad's twist axis sets the pedals directly. S.rudder + S.rudderTrim → core/yaw.js. */
const RUDDER_RATE      = 1.5;    // /s — full pedal in ~0.7 s
const RUDDER_RELAX     = 2.5;    // /s — spring back to centre
const RUDDER_TRIM_STEP = 0.02;   // per press (auto-repeat while held)
const RUDDER_TRIM_MAX  = 0.5;    // trim authority, a share of full rudder (assumed — airliner rudder trim is roughly half the travel)
let _gpRudder = 0;               // the gamepad twist axis, after the deadzone

let _gpPrevButtons = [];
let _gpPrevThrottle = null;   // last applied throttle-axis value — only re-assert thrust on real movement

let _inputBound = false;
export function initInput() {
  if (_inputBound) return;   // window listeners — bind once per page
  _inputBound = true;
  initKeys();
  registerActions(_keyActions);
  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mousedown', () => { _mouseDown = true;  _mouseLast = null; });
  window.addEventListener('mouseup',   () => { _mouseDown = false; _mouseLast = null; });
}

/* Called every physics frame — continuous control input for manual aircraft */
export function tickControls(dt) {
  if (!S.aircraft?.manualControl) return;

  const h = S.aircraft.handling ?? {};
  const maxBank  = h.maxBank  ?? 60;
  const maxPitch = h.maxPitch ?? 20;
  const rollRate  = (h.rollRate  ?? 30) * dt;
  const pitchRate = (h.pitchRate ?? 5)  * dt;
  const rollRelax = (h.rollRelax ?? 20) * dt;  // spring-back rate when stick released

  const aileronIn  = (isKeyHeld('ArrowRight') ? 1 : 0) - (isKeyHeld('ArrowLeft')  ? 1 : 0);
  const elevatorIn = (isKeyHeld('ArrowUp')    ? 1 : 0) - (isKeyHeld('ArrowDown')  ? 1 : 0);

  /* On ground the same left/right keys drive nose-wheel steering (the tiller), not
     ailerons — ramp `steer` toward ±1 while held, self-centre when released. Roll is
     snapped to 0 so accumulated ground inputs don't cause a post-takeoff spiral. */
  const patch = {};
  if (S.wow) {
    if (S.rollT !== 0) patch.rollT = 0;
    const steerRate  = (h.steerRate  ?? 1.6) * dt;   // deflect to full in ~0.6 s
    const steerRelax = (h.steerRelax ?? 2.2) * dt;   // self-centre when released
    let steer = S.steer ?? 0;
    if (aileronIn !== 0) {
      steer = Math.max(-1, Math.min(1, steer + aileronIn * steerRate));
    } else if (steer !== 0) {
      const step = Math.min(Math.abs(steer), steerRelax);
      const next = steer - Math.sign(steer) * step;
      steer = Math.abs(next) < 0.02 ? 0 : next;
    }
    if (steer !== (S.steer ?? 0)) patch.steer = steer;
  } else {
    if (aileronIn !== 0) {
      patch.rollT = Math.max(-maxBank, Math.min(maxBank, S.rollT + aileronIn * rollRate));
    } else if (S.rollT !== 0) {
      /* No input in flight: spring back toward wings level */
      const step = Math.min(Math.abs(S.rollT), rollRelax);
      const next = S.rollT - Math.sign(S.rollT) * step;
      patch.rollT = Math.abs(next) < 0.1 ? 0 : next;
    }
    if ((S.steer ?? 0) !== 0) patch.steer = 0;   // centre the nose wheel once airborne
  }
  if (elevatorIn !== 0) {
    patch.pitchT = Math.max(-maxPitch, Math.min(maxPitch, S.pitchT + elevatorIn * pitchRate));
  }

  /* Rudder pedals — on the ground and in flight: keys, else the gamepad, else spring back */
  const rudderIn = (isKeyHeld('.') ? 1 : 0) - (isKeyHeld(',') ? 1 : 0);
  const rudder = S.rudder ?? 0;
  let nextRudder = rudder;
  if (rudderIn !== 0)      nextRudder = Math.max(-1, Math.min(1, rudder + rudderIn * RUDDER_RATE * dt));
  else if (_gpRudder !== 0) nextRudder = _gpRudder;
  else if (rudder !== 0) {
    const next = rudder - Math.sign(rudder) * Math.min(Math.abs(rudder), RUDDER_RELAX * dt);
    nextRudder = Math.abs(next) < 0.01 ? 0 : next;
  }
  if (nextRudder !== rudder) patch.rudder = nextRudder;
  if (Object.keys(patch).length) setState(patch);
}

export function isPTTActive() { return _pttActive; }

/* Called every frame by loop.js */
export function tickGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp   = pads[0];
  if (!gp) return;

  const ax = gp.axes;
  const btn = gp.buttons;

  /* Axes with deadzone */
  const roll     = _dz(ax[GP.ROLL]);
  const pitch    = _dz(ax[GP.PITCH]);
  _gpRudder      = _dz(ax[GP.RUDDER] ?? 0);   // twist → the pedals (tickControls applies it)
  const throttleRaw = ax[GP.THROTTLE] ?? 0;  // -1 = full fwd, +1 = full back

  /* Roll → bankT, Pitch → pitchT (disable AP for manual flight) */
  if (Math.abs(roll) > 0 || Math.abs(pitch) > 0) {
    setState({
      ap:     false,
      rollT:  roll  * 30,           // ±30°
      pitchT: -pitch * 15,          // ±15° (invert Y)
    });
  }

  /* Throttle slider: -1=full fwd → full thrust, +1=full back → idle — the throttle command (core/engine.js: a
     turbofan's thrust lever, the others' engine levers), recorded once the axis rests (core/commands.js).
     Only apply on real axis movement — otherwise a resting/centred axis re-asserts the lever
     every frame and overrides the pedestal detent (so the A/THR ceiling kept climbing back up). */
  const frac = (1 - throttleRaw) / 2;
  if (_gpPrevThrottle === null) {
    _gpPrevThrottle = throttleRaw;                 // seed silently — keep the mission's initial thrust
  } else if (Math.abs(throttleRaw - _gpPrevThrottle) > 0.01) {
    _gpPrevThrottle = throttleRaw;                 // physical throttle actually moved → it takes over
    commandContinuous('throttle', Math.max(0, Math.min(1, frac)), { source: 'joystick' });
  }

  /* PTT — trigger */
  const trigNow = btn[GP.TRIGGER]?.pressed ?? false;
  if (trigNow !== (_gpPrevButtons[GP.TRIGGER] ?? false)) {
    _pttActive = trigNow;
    document.dispatchEvent(new CustomEvent('ptt', { detail: { active: trigNow } }));
  }

  /* Flaps — button 1: one stage further (the aircraft's own stages — core/flaps.js) */
  if (_btnPressed(btn, GP.BTN_FLAP)) command('flaps', 'extend', { source: 'joystick' });

  /* Gear — button 2 (the rules — fixed gear, squat lock — are the command's: core/gear.js) */
  if (_btnPressed(btn, GP.BTN_GEAR)) command('gear', 'toggle', { source: 'joystick' });

  _gpPrevButtons = btn.map(b => b.pressed);
}

function _dz(v) {
  return Math.abs(v) < GP.DEADZONE ? 0 : v;
}

function _btnPressed(buttons, idx) {
  return (buttons[idx]?.pressed ?? false) && !(_gpPrevButtons[idx] ?? false);
}

/* ── Keyboard: what the keys do. Which key, and on which vehicle: core/keymap.js ── */
const _view  = (view) => setState({ cockpitView: S.cockpitView === view ? 'forward' : view });
const _ptt   = (active) => { _pttActive = active; document.dispatchEvent(new CustomEvent('ptt', { detail: { active } })); };

const _keyActions = {
  ptt: { down: () => _ptt(true), up: () => _ptt(false) },
  pause: () => setState({ paused: !S.paused }),

  /* Time warp, rockets only (core/loop.js) — w steps forward through 1×→2×→5×→10×→100×→next event, W back */
  'warp-up': () => {
    const steps = WARP_STEPS, idx = steps.indexOf(S.warpFactor ?? 1);
    if (S.warpTarget != null) setState({ warpFactor: 1, warpTarget: null, warpTargetLabel: null });
    else if (idx === steps.length - 1) {
      const ev = _nextEvent();
      if (ev) setState({ warpFactor: 1000, warpTarget: ev.t - 60, warpTargetLabel: ev.label });
      else    setState({ warpFactor: 1, warpTarget: null });
    } else setState({ warpFactor: steps[Math.max(0, idx + 1)], warpTarget: null });
  },
  'warp-down': () => {   // from next-event mode, drop to 100×
    if (S.warpTarget != null) setState({ warpFactor: 100, warpTarget: null, warpTargetLabel: null });
    else setState({ warpFactor: WARP_STEPS[Math.max(0, WARP_STEPS.indexOf(S.warpFactor ?? 1) - 1)], warpTarget: null });
  },
  'warp-jump': () => {   // straight to the next mission event (again: cancel)
    const ev = _nextEvent();
    if (ev) {
      const dist = ev.t - 60 - (S.time ?? 0);
      /* Scale warp so the skip takes ~5 s real time; min 1000×, max 200000× */
      const warpFactor = dist > 86_400 ? 200_000 : dist > 3_600 ? 10_000 : 1_000;
      setState({ warpFactor, warpTarget: ev.t - 60, warpTargetLabel: ev.label });
    } else if (S.warpTarget != null) setState({ warpFactor: 1, warpTarget: null, warpTargetLabel: null });
  },

  brakes: { down: () => setState({ braking: true }), up: () => setState({ braking: false }) },

  /* The throttle command (core/engine.js): a turbofan's thrust lever ±10 %; the others' lever by 20 kt's worth of
     envelope.maxSpd, the step the old spdT throttle had. A held key repeats — recorded once it rests. */
  thrust: (e) => {
    const up = e.key === '=' || e.key === '+';
    const turbofan = S.aircraft?.engine?.type === 'turbofan';
    const step = turbofan ? 0.1 : 20 / (S.aircraft?.envelope?.maxSpd ?? 350);
    const now  = S.lever ?? 0;
    commandContinuous('throttle', Math.max(0, Math.min(1, now + (up ? step : -step))), { source: 'key' });
  },
  /* A turbofan's detents (its thrustProfiles, or a fallback). A propeller's throttle has no detents: F1 idle, F4 full
     (the key map offers only those two) — no invented positions (Markus, 2026-11-13); a real gate comes from the data. */
  'thrust-detent': (e) => {
    const i = ['F1', 'F2', 'F3', 'F4'].indexOf(e.key);
    if (S.aircraft?.engine?.type !== 'turbofan') {
      if (i === 0 || i === 3) command('throttle', i === 0 ? 0 : 1, { source: 'key' });
      return;
    }
    const profiles = S.aircraft?.thrustProfiles;
    const lever = profiles ? (profiles[Math.min(i, profiles.length - 1)]?.lever ?? 0) : [0, 180 / 350, 280 / 350, 1][i];   // the fallback detents (the dc8)
    command('throttle', Math.max(0, Math.min(1, lever)), { source: 'key' });
  },
  /* A situation (the aircraft's data) puts the aircraft somewhere: its spdT is the speed; a propeller's lever is set to
     hold it in level flight there (the trim — core/trim.js), as at the mission load. */
  situation: (e) => {
    const sit = S.aircraft?.situations?.[parseInt(e.key) - 1];
    if (!sit) return;
    setState({ alt: sit.alt, spd: sit.spd, hdg: sit.hdg, altT: sit.altT, spdT: sit.spdT });
    if (S.aircraft?.engine?.type !== 'turbofan')
      throttle(levelTrim(S.aircraft, { iasKt: sit.spdT, altFt: sit.alt, flaps: S.flaps ?? 0, gear: !!S.gear }).lever);
  },
  /* The kinematic model's targets; manual aircraft hold the keys (tickControls) */
  'alt-target': (e) => setState({ altT: e.key === 'ArrowUp' ? Math.min(43000, S.altT + 500) : Math.max(0, S.altT - 500) }),
  'hdg-target': (e) => setState({ hdgT: (S.hdgT + (e.key === 'ArrowRight' ? 5 : 355)) % 360 }),
  'rudder-trim': (e) => {
    const t = (S.rudderTrim ?? 0) + (e.key === '>' ? 1 : -1) * RUDDER_TRIM_STEP;
    setState({ rudderTrim: Math.round(Math.max(-RUDDER_TRIM_MAX, Math.min(RUDDER_TRIM_MAX, t)) * 100) / 100 });
  },
  'trim-up':   () => setState({ trim: Math.min(10, (S.trim ?? 0) + 0.5) }),
  'trim-down': () => setState({ trim: Math.max(-10, (S.trim ?? 0) - 0.5) }),
  'flaps-extend':  () => command('flaps', 'extend',  { source: 'key' }),   // the aircraft's own stages: core/flaps.js
  'flaps-retract': () => command('flaps', 'retract', { source: 'key' }),
  gear: () => command('gear', 'toggle', { source: 'key' }),   // the rules (squat lock) are core/gear.js's
  'right-console': () => _view('right'),
  role: () => {
    const roles = ['PF', 'PM', 'INSTRUCTOR'];
    setState({ role: roles[(roles.indexOf(S.role) + 1) % roles.length] });
  },
};
const WARP_STEPS = [1, 2, 5, 10, 100];

/* ── Mouse — controls bank and pitch only while button held ── */
function _onMouseMove(e) {
  if (!_mouseDown || !S.aircraft?.manualControl) return;
  if (!_mouseLast) { _mouseLast = { x: e.clientX, y: e.clientY }; return; }

  const dx = e.clientX - _mouseLast.x;
  const dy = e.clientY - _mouseLast.y;
  _mouseLast = { x: e.clientX, y: e.clientY };

  const h = S.aircraft?.handling ?? {};
  const maxBank  = h.maxBank  ?? 60;
  const maxPitch = h.maxPitch ?? 20;
  const mp = {};
  if (!S.wow) mp.rollT  = Math.max(-maxBank,  Math.min(maxBank,  S.rollT  + dx * 0.15));
  mp.pitchT = Math.max(-maxPitch, Math.min(maxPitch, S.pitchT - dy * 0.08));
  setState(mp);
}
