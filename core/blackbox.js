/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/blackbox.js
   Mandatory flight recorder. Every input, every failure, every
   decision. Persistent across session close. Tamper-evident.

   Format: JSONL — one JSON object per line.
   Line 1:   session_start header
   ...       snapshot (every 5s) + event records
   Last:     session_end footer
   +1 line:  { type: 'sha256', hash: '...' }  fingerprint
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

const SNAPSHOT_INTERVAL = 5.0;   // seconds between state snapshots
const MAX_SESSIONS      = 5;     // localStorage sessions to keep
const LS_PREFIX         = 'opensim_bb_';

let _sessionId = null;
let _records   = [];
let _tickAccum = 0;

/* ── Init — call once per mission load ── */
export function initBlackbox() {
  const now      = new Date();
  _sessionId     = now.toISOString().replace(/[:.]/g, '-');
  _records       = [];
  _tickAccum     = 0;

  _push({
    type:     'session_start',
    wallTime: now.toISOString(),
    mission:  S.mission?.id  ?? 'unknown',
    aircraft: S.aircraft?.id ?? 'unknown',
  });
}

/* ── Discrete event — call from anywhere ── */
export function bbEvent(event) {
  if (!_sessionId) return;
  _push({ simTime: +(S.time ?? 0).toFixed(1), ...event });
}

/* ── Periodic snapshot — called from loop.js ── */
export function bbTick(dt) {
  if (!_sessionId) return;
  _tickAccum += dt;
  if (_tickAccum < SNAPSHOT_INTERVAL) return;
  _tickAccum = 0;

  _push({
    type:         'snapshot',
    simTime:      +(S.time ?? 0).toFixed(1),
    alt:          Math.round(S.alt  ?? 0),
    spd:          Math.round(S.spd  ?? 0),
    hdg:          Math.round(S.hdg  ?? 0),
    vs:           Math.round(S.vs   ?? 0),
    pitch:        +(S.pitch ?? 0).toFixed(1),
    roll:         +(S.roll  ?? 0).toFixed(1),
    enginePower:  +(S.enginePower ?? 1).toFixed(2),
    engineState:  S.engineState  ?? 'off',
    fuelLeft:     S.fuelLeft  !== null ? +(S.fuelLeft  ?? 0).toFixed(1) : null,
    fuelRight:    S.fuelRight !== null ? +(S.fuelRight ?? 0).toFixed(1) : null,
    fuelSelector: S.fuelSelector ?? null,
    flaps:        S.flaps ?? 0,
    gear:         S.gear  ?? false,
    ap:           S.ap    ?? false,
    crashed:      S.crashed ?? false,
    lat:          +(S.lat ?? 0).toFixed(5),
    lon:          +(S.lon ?? 0).toFixed(5),
  });

  _persist();
}

/* ── Download — async, SHA-256 fingerprinted ── */
export async function downloadBlackbox() {
  if (!_records.length) return;

  const footer = {
    type:        'session_end',
    simTime:     +(S.time ?? 0).toFixed(1),
    wallTime:    new Date().toISOString(),
    crashed:     S.crashed ?? false,
    recordCount: _records.length + 1,
  };

  const allRecords = [..._records, footer];
  const content    = allRecords.map(r => JSON.stringify(r)).join('\n');

  const buf  = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex  = Array.from(new Uint8Array(hash))
                    .map(b => b.toString(16).padStart(2, '0')).join('');

  const signed = content + '\n' + JSON.stringify({ type: 'sha256', hash: hex });
  const blob   = new Blob([signed], { type: 'application/x-ndjson' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `opensim-blackbox-${_sessionId}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Internal ── */
function _push(record) {
  _records.push(record);
}

function _persist() {
  try {
    localStorage.setItem(
      LS_PREFIX + _sessionId,
      _records.map(r => JSON.stringify(r)).join('\n'),
    );
    _pruneOldSessions();
  } catch (_) { /* localStorage full — fail silently */ }
}

function _pruneOldSessions() {
  const keys = Object.keys(localStorage)
    .filter(k => k.startsWith(LS_PREFIX))
    .sort();
  while (keys.length > MAX_SESSIONS) {
    localStorage.removeItem(keys.shift());
  }
}
