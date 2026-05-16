/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/telemetry.js
   Records flight state at ~2Hz.
   Ctrl+Shift+L → CSV (rockets) or JSONL (aircraft).
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { moonECI } from './rocket.js';

const INTERVAL = 0.5;   // seconds between samples
let _buf = [];
let _acc = 0;
let _recording = false;

function _soundAt(alt_m) {
  const T = alt_m < 11000 ? 288.15 - 6.5e-3 * alt_m : 216.65;
  return Math.sqrt(1.4 * 287 * T);
}

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
  const isHover = S.aircraft?.type === 'hovercraft';
  const row = {
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
  };
  const isRocket = S.aircraft?.vehicleType === 'rocket';

  if (isRocket) {
    const alt_m  = (S.alt ?? 0) * 0.3048;
    const vel_ms = (S.spd ?? 0) * 0.5144;
    const sound  = _soundAt(alt_m);
    const ignT   = S.aircraft?.ignitionTime ?? 0;
    const tLO    = (S.time ?? 0) - ignT;
    const launch = S.mission?.initialState ?? {};
    const dLat   = ((S.lat ?? 0) - (launch.lat ?? 0)) * 111.32;
    const dLon   = ((S.lon ?? 0) - (launch.lon ?? 0)) * 111.32 * Math.cos((launch.lat ?? 0) * Math.PI / 180);
    row.t_liftoff    = +Math.max(0, tLO).toFixed(1);
    row.alt_km       = +(alt_m / 1000).toFixed(2);
    row.vel_ms       = +vel_ms.toFixed(1);
    row.vel_kmh      = +Math.round(vel_ms * 3.6);
    row.mach         = +(vel_ms / sound).toFixed(3);
    row.fpa_deg      = +(S.pitch ?? 90).toFixed(2);
    row.vs_ms        = +((S.vs ?? 0) / 196.85).toFixed(2);
    row.downrange_km = +Math.sqrt(dLat * dLat + dLon * dLon).toFixed(2);
    row.stage        = S.rocketStage  ?? 1;
    row.mass_kg      = +(S.rocketMass ?? 0).toFixed(0);
    row.g_axial      = +(S.rocketG    ?? 0).toFixed(3);
    row.dynq_pa      = +(S.rocketDynQ ?? 0).toFixed(0);
    row.active_eng   = S.rocketActiveEngines ?? null;
    row.coast        = (S.rocketCoast ?? false) ? 1 : 0;
    row.seco         = (S.rocketSECO  ?? false) ? 1 : 0;
    row.loi          = (S.rocketLOI   ?? false) ? 1 : 0;
    /* Moon-relative telemetry */
    const ov = S.orbitVec;
    if (ov) {
      const { mx, my } = moonECI(S.time ?? 0);
      const MOON_T_S = 27.32166 * 86400;
      const MOON_SMA = 384_400_000;
      const omega    = 2 * Math.PI / MOON_T_S;
      const refAngle = ((S.mission?.moonRefAngle ?? 0) * Math.PI / 180);
      const angle    = refAngle + (S.time ?? 0) * omega;
      const vmx = -MOON_SMA * omega * Math.sin(angle);
      const vmy =  MOON_SMA * omega * Math.cos(angle);
      const dx  = ov.rx - mx, dy = ov.ry - my, dz = ov.rz ?? 0;
      const rvx = ov.vx - vmx, rvy = ov.vy - vmy, rvz = ov.vz ?? 0;
      row.moon_dist_km  = +(Math.sqrt(dx*dx + dy*dy + dz*dz) / 1000).toFixed(0);
      row.moon_relspd   = +(Math.sqrt(rvx*rvx + rvy*rvy + rvz*rvz)).toFixed(1);
    }
  } else if (isHover) {
    const pfx = S.hcActive === 'markus' ? 'hcM' : 'hc';
    row.hcLiftAct  = +(S[pfx+'LiftAct']  ?? 0).toFixed(3);
    row.hcPressure = +(S[pfx+'Pressure'] ?? 0).toFixed(1);
    row.hcSpeed    = +(S[pfx+'Speed']    ?? 0).toFixed(2);
    row.hcHeading  = +(S[pfx+'Heading']  ?? 0).toFixed(1);
    row.hcHovering = S[pfx+'Hovering'] ? 1 : 0;
    row.hcAutonomy = S.hcMAutonomy ?? 'MANUAL';
  }
  _buf.push(row);
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

export function downloadTelemetryCSV() {
  if (!_buf.length) { console.warn('No telemetry recorded.'); return; }
  /* Union all row keys — columns like moon_dist_km only appear post-SECO */
  const keySet = new Set();
  for (const r of _buf) for (const k of Object.keys(r)) keySet.add(k);
  const keys   = [...keySet];
  const header = keys.join(',');
  const rows   = _buf.map(r => keys.map(k => r[k] ?? '').join(','));
  const csv    = [header, ...rows].join('\n');
  const blob   = new Blob([csv], { type: 'text/csv' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  const mission = S.mission?.id ?? 'opensim';
  a.href     = url;
  a.download = `${mission}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
