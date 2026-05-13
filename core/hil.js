/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/hil.js
   Hardware-In-the-Loop bridge to VotingTriad ESP32.

   Protocol (via hub.js WebSocket relay):
     Browser  → hub → ESP32 : STATE_PATCH with sim state (hdg, pitch, roll, alt, vs, spd)
     ESP32    → hub → Browser: STATE_PATCH with controls  (rollT, pitchT, spdT, ap: false)

   Call hilInit(hubUrl, room) once. Call tickHIL() every frame.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

let _ws       = null;
let _room     = 'hil-corsair';
let _connected = false;
let _lastSend  = 0;
const SEND_INTERVAL_MS = 20;   // 50Hz sim-state push to ESP32

export function hilInit(hubUrl = 'ws://localhost:3000', room = 'hil-corsair') {
  _room = room;
  _ws   = new WebSocket(hubUrl);

  _ws.addEventListener('open', () => {
    _connected = true;
    _ws.send(JSON.stringify({ type: 'JOIN', room: _room, role: 'SIM' }));
    console.log(`[HIL] Connected to hub. Joined room '${_room}' as SIM.`);
  });

  _ws.addEventListener('close', () => {
    _connected = false;
    console.warn('[HIL] Disconnected from hub.');
  });

  _ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type !== 'STATE_PATCH') return;
    const p = msg.patch;
    if (!p) return;

    // Apply control inputs from hardware to sim state.
    // Aircraft controls:
    const update = {};
    if (p.rollT  !== undefined) update.rollT  = p.rollT;
    if (p.pitchT !== undefined) update.pitchT = p.pitchT;
    if (p.spdT   !== undefined) update.spdT   = p.spdT;
    if (p.ap     !== undefined) update.ap     = p.ap;
    // Robot arm — actual joint positions reported by ESP32 telemetry:
    if (p.armJoints  !== undefined) update.armJoints  = p.armJoints;
    if (p.armGripper !== undefined) update.armGripper = p.armGripper;
    if (p.armTemp    !== undefined) update.armTemp    = p.armTemp;
    if (p.armLoad    !== undefined) update.armLoad    = p.armLoad;
    if (p.armVolt    !== undefined) update.armVolt    = p.armVolt;
    if (p.armAlert   !== undefined) update.armAlert   = p.armAlert;
    if (Object.keys(update).length) {
      setState(update);
      console.log('[HIL] rx:', update);
    }
  });

  _ws.addEventListener('error', (e) => {
    console.error('[HIL] WebSocket error', e);
  });
}

export function tickHIL() {
  if (!_connected || _ws?.readyState !== WebSocket.OPEN) return;

  const now = performance.now();
  if (now - _lastSend < SEND_INTERVAL_MS) return;
  _lastSend = now;

  // Build patch for whatever vehicle type is active.
  const patch = {
    hdg:   S.hdg,
    pitch: S.pitch,
    roll:  S.roll,
    alt:   S.alt,   // feet
    vs:    S.vs,    // ft/min
    spd:   S.spd,   // knots
  };

  // Robot arm: forward commanded joint angles to robot_bridge.js → ESP32.
  if (S.armJoints !== null && S.armJoints !== undefined) {
    patch.armJoints  = S.armJoints;
    patch.armGripper = S.armGripper ?? 0;
  }

  _ws.send(JSON.stringify({ type: 'STATE_PATCH', room: _room, patch }));
}

export function hilIsConnected() { return _connected; }
