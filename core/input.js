/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/input.js
   Keyboard, mouse, and (future) gamepad input.
   Writes to S via setState(). Never reads displays.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { bbEvent } from './blackbox.js';

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
  const rollRate  = (h.rollRate  ?? 30) * dt;
  const pitchRate = (h.pitchRate ?? 5)  * dt;
  const rollRelax = (h.rollRelax ?? 20) * dt;  // spring-back rate when stick released

  const aileronIn  = (_held.has('ArrowRight') ? 1 : 0) - (_held.has('ArrowLeft')  ? 1 : 0);
  const elevatorIn = (_held.has('ArrowUp')    ? 1 : 0) - (_held.has('ArrowDown')  ? 1 : 0);

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
  const throttleRaw = ax[GP.THROTTLE] ?? 0;  // -1 = full fwd, +1 = full back

  /* Roll → bankT, Pitch → pitchT (disable AP for manual flight) */
  if (Math.abs(roll) > 0 || Math.abs(pitch) > 0) {
    setState({
      ap:     false,
      rollT:  roll  * 30,           // ±30°
      pitchT: -pitch * 15,          // ±15° (invert Y)
    });
  }

  /* Throttle slider: -1=full fwd → full thrust, +1=full back → idle. Turbofans drive the
     thrust lever (the FCU speed is the A/THR target, not the throttle); others use spdT. */
  const frac = (1 - throttleRaw) / 2;
  if (S.aircraft?.engine?.type === 'turbofan')
    setState({ thrustLever: Math.max(0, Math.min(1, frac)) });
  else
    setState({ spdT: Math.round(frac * (S.aircraft?.envelope.maxSpd ?? 350)) });

  /* PTT — trigger */
  const trigNow = btn[GP.TRIGGER]?.pressed ?? false;
  if (trigNow !== (_gpPrevButtons[GP.TRIGGER] ?? false)) {
    _pttActive = trigNow;
    document.dispatchEvent(new CustomEvent('ptt', { detail: { active: trigNow } }));
  }

  /* Flaps — button 1 */
  if (_btnPressed(btn, GP.BTN_FLAP)) {
    const next = Math.min(3, S.flaps + 1);
    setState({ prevFlaps: S.flaps, flaps: next });
    bbEvent({ type: 'flaps', flaps: next });
  }

  /* Gear — button 2.  Weight-on-wheels squat lock: can't raise the gear on the ground. */
  if (_btnPressed(btn, GP.BTN_GEAR) && !S.aircraft?.fixedGear) {
    const next = !S.gear;
    if (next || !S.wow) {
      setState({ prevGear: S.gear, gear: next });
      bbEvent({ type: 'gear', gear: next ? 'down' : 'up' });
    }
  }

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

  /* Time warp — w steps forward, W steps backward through 1×→2×→5×→10×→100×→next event */
  if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && (S.aircraft?.vehicleType === 'rocket' || S.aircraft?.panel)) {
    const ev = _nextEvent();
    if (ev) {
      const dist = ev.t - 60 - (S.time ?? 0);
      /* Scale warp so the skip takes ~5 s real time; min 1000×, max 200000× */
      const warpFactor = dist > 86_400 ? 200_000 : dist > 3_600 ? 10_000 : 1_000;
      setState({ warpFactor, warpTarget: ev.t - 60, warpTargetLabel: ev.label });
    } else if (S.warpTarget != null) {
      setState({ warpFactor: 1, warpTarget: null, warpTargetLabel: null });
    }
    return;
  }
  if ((e.key === 'w' || e.key === 'W') && (S.aircraft?.vehicleType === 'rocket' || S.aircraft?.panel)) {
    const steps = [1, 2, 5, 10, 100];
    const cur   = S.warpFactor ?? 1;
    const idx   = steps.indexOf(cur);
    if (e.key === 'w') {
      if (S.warpTarget != null) {
        setState({ warpFactor: 1, warpTarget: null, warpTargetLabel: null });
      } else if (idx === steps.length - 1) {
        const ev = _nextEvent();
        if (ev) setState({ warpFactor: 1000, warpTarget: ev.t - 60, warpTargetLabel: ev.label });
        else    setState({ warpFactor: 1, warpTarget: null });
      } else {
        setState({ warpFactor: steps[Math.max(0, idx + 1)], warpTarget: null });
      }
    } else {
      /* Shift+W — step back; if in next-event mode, drop to 100× */
      if (S.warpTarget != null) {
        setState({ warpFactor: 100, warpTarget: null, warpTargetLabel: null });
      } else {
        setState({ warpFactor: steps[Math.max(0, idx - 1)], warpTarget: null });
      }
    }
    return;
  }

  /* Brakes — hold B */
  if (e.key === 'b' || e.key === 'B') { setState({ braking: true }); return; }

  /* Cycle display mode: Tab — panel aircraft handle this in index.html */
  if (e.key === 'Tab') {
    e.preventDefault();
    const panel = S.aircraft?.panel;
    if (panel === 'airbus' || panel === 'e190') return;
    const modes = ['PFD', 'ECAM'];
    const i = modes.indexOf(S.mode);
    setState({ mode: modes[(i + 1) % modes.length] });
    return;
  }

  /* Throttle / speed. Turbofans drive the thrust lever (manual thrust); others set spdT,
     which is the throttle for props and the AP speed target otherwise. */
  const _tf = S.aircraft?.engine?.type === 'turbofan';
  const _up = e.key === '=' || e.key === '+', _dn = e.key === '-' || e.key === '_';
  if (_up || _dn) {
    if (_tf) setState({ thrustLever: Math.max(0, Math.min(1, (S.thrustLever ?? 0) + (_up ? 0.1 : -0.1))) });
    else {
      const _spdStep = S.aircraft?.manualControl ? 20 : 5;
      setState({ spdT: Math.max(0, Math.min(S.aircraft?.envelope.maxSpd ?? 350, S.spdT + (_up ? _spdStep : -_spdStep))) });
    }
  }

  /* Thrust detents — aircraft-specific profiles or hardcoded fallback */
  const _fi = ['F1','F2','F3','F4'].indexOf(e.key);
  if (_fi >= 0) {
    e.preventDefault();
    const profiles = S.aircraft?.thrustProfiles;
    const spdTv = profiles ? (profiles[Math.min(_fi, profiles.length - 1)]?.spdT ?? 0) : [0, 180, 280, 350][_fi];
    if (_tf) {
      const maxSpdT = profiles ? (Math.max(...profiles.map(p => p.spdT)) || 1) : 350;
      setState({ thrustLever: Math.max(0, Math.min(1, spdTv / maxSpdT)) });
    } else {
      setState({ spdT: spdTv });
    }
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
  if (e.key === 'f') { const next = Math.min(3, S.flaps + 1); setState({ prevFlaps: S.flaps, flaps: next }); bbEvent({ type: 'flaps', flaps: next }); }
  if (e.key === 'F') { const next = Math.max(0, S.flaps - 1); setState({ prevFlaps: S.flaps, flaps: next }); bbEvent({ type: 'flaps', flaps: next }); }
  if (e.key === 'g' && !S.aircraft?.fixedGear) { const next = !S.gear; if (next || !S.wow) { setState({ prevGear: S.gear, gear: next }); bbEvent({ type: 'gear', gear: next ? 'down' : 'up' }); } }   // squat lock: no gear-up on the ground

  /* Speed brake / spoilers — s cycles RET → ARM → FULL → RET */
  if (e.key === 's' || e.key === 'S') {
    setState({ speedBrake: ((S.speedBrake ?? 0) + 1) % 3 });
  }

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
  const mp = {};
  if (!S.wow) mp.rollT  = Math.max(-maxBank,  Math.min(maxBank,  S.rollT  + dx * 0.15));
  mp.pitchT = Math.max(-maxPitch, Math.min(maxPitch, S.pitchT - dy * 0.08));
  setState(mp);
}
