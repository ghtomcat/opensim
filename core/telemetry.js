/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/telemetry.js
   Records flight state at ~2Hz. Download as JSONL with Ctrl+Shift+T.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

const INTERVAL = 0.5;   // seconds between samples
let _buf = [];
let _acc = 0;
let _recording = false;

export function startTelemetry() {
  _buf = [];
  _acc = 0;
  _recording = true;
}

export function stopTelemetry() {
  _recording = false;
}

export function tickTelemetry(dt) {
  if (!_recording) return;
  _acc += dt;
  if (_acc < INTERVAL) return;
  _acc = 0;
  _buf.push({
    t:           +S.time.toFixed(1),
    alt:         +S.alt.toFixed(0),
    spd:         +S.spd.toFixed(1),
    vs:          +(S.vs ?? 0).toFixed(0),
    pitch:       +(S.pitch ?? 0).toFixed(2),
    roll:        +(S.roll  ?? 0).toFixed(2),
    hdg:         +(S.hdg   ?? 0).toFixed(1),
    enginePower: +(S.enginePower ?? 1).toFixed(3),
    flaps:       S.flaps ?? 0,
    lat:         +(S.lat ?? 0).toFixed(5),
    lon:         +(S.lon ?? 0).toFixed(5),
    pitchT:      +(S.pitchT ?? 0).toFixed(2),
    rollT:       +(S.rollT  ?? 0).toFixed(2),
    spdT:        +(S.spdT   ?? 0).toFixed(0),
    braking:     S.braking ? 1 : 0,
  });
}

export function downloadTelemetry() {
  if (!_buf.length) { console.warn('No telemetry recorded.'); return; }
  const jsonl = _buf.map(r => JSON.stringify(r)).join('\n');
  const blob  = new Blob([jsonl], { type: 'application/jsonl' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  const mission = S.mission?.id ?? 'opensim';
  a.href     = url;
  a.download = `${mission}-${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}
