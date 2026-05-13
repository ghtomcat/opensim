/* ═══════════════════════════════════════════════════════════════
   OpenSim — server/robot_bridge.js
   Hardware-In-the-Loop bridge: hub.js ↔ SO-101 ESP32

   Run alongside hub.js:
     node server/robot_bridge.js

   Environment variables:
     HUB_URL   ws://localhost:3000          (hub.js address)
     ESP_URL   ws://192.168.1.100/ws        (ESP32 WebSocket address)
     ROOM      so101-hil                    (hub room name)
     SPEED     200                          (default servo speed, steps/s)

   Protocol:
     Browser/OpenSim → hub → this bridge → ESP32   : sync_move commands
     ESP32 → this bridge → hub → Browser/OpenSim   : telemetry state patches
   ═══════════════════════════════════════════════════════════════ */

'use strict';

import { WebSocket } from 'ws';

const HUB_URL  = process.env.HUB_URL  || 'ws://localhost:3000';
const ESP_URL  = process.env.ESP_URL  || 'ws://192.168.1.100/ws';
const ROOM     = process.env.ROOM     || 'so101-hil';
const SPEED    = parseInt(process.env.SPEED || '200');
const TICK_HZ  = 50;  // command rate to ESP32 (must be ≤ ESP32 telemetry rate)

let hub = null;
let esp = null;

let pendingAngles = null;  // latest armJoints from sim, consumed each tick

// ---------------------------------------------------------------------------
// Hub connection
// ---------------------------------------------------------------------------

function connectHub() {
  hub = new WebSocket(HUB_URL);

  hub.on('open', () => {
    console.log(`[hub] connected — joining room '${ROOM}' as ROBOT`);
    hub.send(JSON.stringify({ type: 'JOIN', room: ROOM, role: 'ROBOT' }));
  });

  hub.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'STATE_PATCH' && msg.patch?.armJoints) {
      // SIM → hardware: latest joint angle commands
      pendingAngles = msg.patch.armJoints;
    }
  });

  hub.on('close', () => {
    console.warn('[hub] disconnected — reconnecting in 2 s');
    hub = null;
    setTimeout(connectHub, 2000);
  });

  hub.on('error', () => {});
}

// ---------------------------------------------------------------------------
// ESP32 connection
// ---------------------------------------------------------------------------

function connectEsp() {
  esp = new WebSocket(ESP_URL);

  esp.on('open', () => {
    console.log(`[esp] connected to ${ESP_URL}`);
  });

  esp.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!hub || hub.readyState !== WebSocket.OPEN) return;

    if (msg.type === 'telemetry' && Array.isArray(msg.servos)) {
      // hardware → SIM: actual joint positions and diagnostics
      const angles = msg.servos.map(s => parseFloat(s.angle) || 0);
      hub.send(JSON.stringify({
        type:  'STATE_PATCH',
        room:  ROOM,
        patch: {
          armJoints:  angles.slice(0, 5),
          armGripper: angles[5] > 45 ? 1 : 0,
          armTemp:    msg.servos.map(s => s.temp  ?? 0),
          armLoad:    msg.servos.map(s => s.load  ?? 0),
          armVolt:    msg.servos.map(s => s.volt  ?? 0),
        },
      }));
    }

    if (msg.type === 'alert') {
      // Forward alerts so the sim can show them in the HUD.
      hub.send(JSON.stringify({
        type:  'STATE_PATCH',
        room:  ROOM,
        patch: { armAlert: { id: msg.id, reason: msg.reason, value: msg.value } },
      }));
    }
  });

  esp.on('close', () => {
    console.warn('[esp] disconnected — reconnecting in 2 s');
    esp = null;
    setTimeout(connectEsp, 2000);
  });

  esp.on('error', () => {});
}

// ---------------------------------------------------------------------------
// 50 Hz command tick: consume pendingAngles and send sync_move to ESP32
// ---------------------------------------------------------------------------

setInterval(() => {
  if (!pendingAngles) return;
  if (!esp || esp.readyState !== WebSocket.OPEN) return;

  const angles = pendingAngles;
  pendingAngles = null;

  esp.send(JSON.stringify({
    cmd:    'sync_move',
    speed:  SPEED,
    acc:    50,
    servos: [1, 2, 3, 4, 5, 6].map((id, i) => ({
      id,
      angle: +((angles[i] ?? 0).toFixed(2)),
    })),
  }));
}, 1000 / TICK_HZ);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(`[robot-bridge] hub=${HUB_URL}  esp=${ESP_URL}  room=${ROOM}  speed=${SPEED}`);
connectHub();
connectEsp();
