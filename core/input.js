/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/input.js
   Keyboard, mouse, and (future) gamepad input.
   Writes to S via setState(). Never reads displays.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

let _mouseLast  = null;
let _mouseDown  = false;
let _pttActive  = false;
const _held    = new Set();   /* currently held keys (for continuous manual input) */

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

let _gpPrevButtons = [];

export function initInput() {
  window.addEventListener('keydown',   _onKeyDown);
  window.addEventListener('keyup',     _onKeyUp);
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
  const rollRate = (h.rollRate  ?? 30) * dt;
  const pitchRate= (h.pitchRate ?? 5)  * dt;

  const aileronIn  = (_held.has('ArrowRight') ? 1 : 0) - (_held.has('ArrowLeft')  ? 1 : 0);
  const elevatorIn = (_held.has('ArrowUp')    ? 1 : 0) - (_held.has('ArrowDown')  ? 1 : 0);

  if (aileronIn !== 0 || elevatorIn !== 0) {
    setState({
      rollT:  Math.max(-maxBank,  Math.min(maxBank,  S.rollT  + aileronIn  * rollRate)),
      pitchT: Math.max(-maxPitch, Math.min(maxPitch, S.pitchT + elevatorIn * pitchRate)),
    });
  }
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
  const throttleRaw = ax[GP.THROTTLE] ?? 0;  // -1 = full fwd, +1 = full back

  /* Roll → bankT, Pitch → pitchT (disable AP for manual flight) */
  if (Math.abs(roll) > 0 || Math.abs(pitch) > 0) {
    setState({
      ap:     false,
      rollT:  roll  * 30,           // ±30°
      pitchT: -pitch * 15,          // ±15° (invert Y)
    });
  }

  /* Throttle slider: -1=full fwd → max speed, +1=full back → idle */
  const spdT = Math.round(((1 - throttleRaw) / 2) * (S.aircraft?.envelope.maxSpd ?? 350));
  setState({ spdT });

  /* PTT — trigger */
  const trigNow = btn[GP.TRIGGER]?.pressed ?? false;
  if (trigNow !== (_gpPrevButtons[GP.TRIGGER] ?? false)) {
    _pttActive = trigNow;
    document.dispatchEvent(new CustomEvent('ptt', { detail: { active: trigNow } }));
  }

  /* Flaps — button 1 */
  if (_btnPressed(btn, GP.BTN_FLAP))
    setState({ prevFlaps: S.flaps, flaps: Math.min(3, S.flaps + 1) });

  /* Gear — button 2 */
  if (_btnPressed(btn, GP.BTN_GEAR) && !S.aircraft?.fixedGear)
    setState({ prevGear: S.gear, gear: !S.gear });

  _gpPrevButtons = btn.map(b => b.pressed);
}

function _dz(v) {
  return Math.abs(v) < GP.DEADZONE ? 0 : v;
}

function _btnPressed(buttons, idx) {
  return (buttons[idx]?.pressed ?? false) && !(_gpPrevButtons[idx] ?? false);
}

/* ── Keyboard ── */
function _onKeyDown(e) {
  /* Don't steal input from text fields */
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  _held.add(e.key);

  /* PTT */
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    _pttActive = true;
    document.dispatchEvent(new CustomEvent('ptt', { detail: { active: true } }));
    return;
  }

  /* Pause */
  if (e.key === 'p' || e.key === 'P') {
    setState({ paused: !S.paused });
    return;
  }

  /* Brakes — hold B */
  if (e.key === 'b' || e.key === 'B') { setState({ braking: true }); return; }

  /* Cycle display mode: Tab */
  if (e.key === 'Tab') {
    e.preventDefault();
    const modes = ['PFD', 'ECAM'];
    const i = modes.indexOf(S.mode);
    setState({ mode: modes[(i + 1) % modes.length] });
    return;
  }

  /* Throttle / speed */
  /* Step size: larger for manual-control aircraft (throttle lever) vs AP (speed target) */
  const _spdStep = S.aircraft?.manualControl ? 20 : 5;
  if (e.key === '=' || e.key === '+') setState({ spdT: Math.min(S.aircraft?.envelope.maxSpd ?? 350, S.spdT + _spdStep) });
  if (e.key === '-' || e.key === '_') setState({ spdT: Math.max(0, S.spdT - _spdStep) });

  /* Thrust detents — aircraft-specific profiles or hardcoded fallback */
  const _fi = ['F1','F2','F3','F4'].indexOf(e.key);
  if (_fi >= 0) {
    e.preventDefault();
    const profiles = S.aircraft?.thrustProfiles;
    const spdT = profiles ? (profiles[Math.min(_fi, profiles.length - 1)]?.spdT ?? 0) : [0, 180, 280, 350][_fi];
    setState({ spdT });
  }

  /* Situation presets — number keys 1–5 (disabled when a mission is active) */
  if (!S.mission) {
    const _si = parseInt(e.key) - 1;
    if (!isNaN(_si) && _si >= 0 && _si <= 4) {
      const sit = S.aircraft?.situations?.[_si];
      if (sit) setState({ alt: sit.alt, spd: sit.spd, hdg: sit.hdg, altT: sit.altT, spdT: sit.spdT });
    }
  }

  /* Altitude / heading — AP mode only (manual mode uses held keys in tickControls) */
  if (!S.aircraft?.manualControl) {
    if (e.key === 'ArrowUp')    setState({ altT: Math.min(43000, S.altT + 500) });
    if (e.key === 'ArrowDown')  setState({ altT: Math.max(0,     S.altT - 500) });
    if (e.key === 'ArrowLeft')  setState({ hdgT: (S.hdgT - 5 + 360) % 360 });
    if (e.key === 'ArrowRight') setState({ hdgT: (S.hdgT + 5) % 360 });
  }

  /* Trim — t nose up, T nose down */
  if (e.key === 't') setState({ trim: Math.min(10, (S.trim ?? 0) + 0.5) });
  if (e.key === 'T') setState({ trim: Math.max(-10, (S.trim ?? 0) - 0.5) });

  /* Flaps — f extend, F retract */
  if (e.key === 'f') setState({ prevFlaps: S.flaps, flaps: Math.min(3, S.flaps + 1) });
  if (e.key === 'F') setState({ prevFlaps: S.flaps, flaps: Math.max(0, S.flaps - 1) });
  if (e.key === 'g' && !S.aircraft?.fixedGear) setState({ prevGear: S.gear, gear: !S.gear });

  /* Role toggle (for solo sim) */
  if (e.key === 'r') {
    const roles = ['PF', 'PM', 'INSTRUCTOR'];
    const i = roles.indexOf(S.role);
    setState({ role: roles[(i + 1) % roles.length] });
  }
}

function _onKeyUp(e) {
  _held.delete(e.key);
  if (e.code === 'Space') {
    _pttActive = false;
    document.dispatchEvent(new CustomEvent('ptt', { detail: { active: false } }));
  }
  if (e.key === 'b' || e.key === 'B') setState({ braking: false });
}

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
  setState({
    rollT:  Math.max(-maxBank,  Math.min(maxBank,  S.rollT  + dx * 0.15)),
    pitchT: Math.max(-maxPitch, Math.min(maxPitch, S.pitchT - dy * 0.08)),
  });
}
