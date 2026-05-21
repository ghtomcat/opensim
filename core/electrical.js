/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/electrical.js
   Turbofan electrical system — architecture scales with engine count.
   Per-aircraft overrides via aircraft.electrical in the JSON.

   Bus architecture (4-engine example — A340):
     ENG 1-4 IDGs → GEN 1-4 → AC BUS 1-1 / 1-2 / 2-3 / 2-4
     APU GEN       → any AC bus (via bus tie)
     EXT A         → AC BUS 1-x  (ground only)
     EXT B         → AC BUS 2-x  (ground only, if extPwrB: true)
     BUS TIE AUTO: unpowered bus borrows from any powered bus
     TR 1          → DC BUS 1  (from AC BUS 1-1)
     TR 2          → DC BUS 2  (from AC BUS 2-4 or 1-2 for 2-eng)
     BAT 1/2[/3]   → ESS BUS / DC ESS BUS
     AC ESS BUS ← AC BUS 1-1 | AC BUS 2-4 | static inverter (bat)
     DC ESS BUS ← DC BUS 1 | DC BUS 2 | BAT

   2-engine aircraft (A220/B737/E190): AC BUS 1-1 and 1-2 only.
     DC BUS 2 fed from AC BUS 1-2 (not 2-4 which doesn't exist).
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const BAT_DRAIN_PCT_S  = 0.30 / 60;
const BAT_CHARGE_PCT_S = 3.0  / 60;
const APU_START_SECS   = 35;

let _apuStartT = null;

/* ── APU MASTER switch ── */
export function apuMasterSet(on) {
  if (on) {
    setState({ apuMasterOn: true });
  } else {
    _apuStartT = null;
    setState({ apuMasterOn: false, apuState: 'off', apuGenOn: false,
               apuBleedOn: false, apuRunning: false });
  }
}

/* ── APU START (momentary) ── */
export function apuStartPress() {
  if (!(S.apuMasterOn ?? false)) return;
  if (!(S.essentialBusPowered ?? false)) return;
  if ((S.apuState ?? 'off') !== 'off') return;
  _apuStartT = S.time ?? 0;
  setState({ apuState: 'starting' });
}

/* ── APU FIRE handle ── */
export function apuFirePull() {
  _apuStartT = null;
  setState({ apuMasterOn: false, apuState: 'off', apuGenOn: false,
             apuBleedOn: false, apuRunning: false, apuFireArmed: true });
}

/* ── Reset on mission load ── */
export function resetElectrical() {
  const n = S.aircraft?.engine?.count ?? 2;
  _apuStartT = null;
  setState({
    bat1On: false, bat2On: false, bat3On: false,
    bat1Charge: 100, bat2Charge: 100, bat3Charge: 100,
    extPwrOn: false, extPwrBOn: false,
    apuMasterOn: false, apuState: 'off', apuBleedOn: false,
    apuGenSwitch: true, apuFireArmed: false, apuRunning: false, apuGenOn: false,
    idgConnected: Array(n).fill(true),
    engGenSwitch: Array(n).fill(true),
    engGenOn: [],
    busTieAuto: true, galleyOn: true,
    acBus11: false, acBus12: false, acBus23: false, acBus24: false,
    acEssBus: false, dcBus1: false, dcBus2: false, dcEssBus: false,
    genVoltage: [], genFreq: [], genLoad: [],
    essentialBusPowered: false, acBusPowered: false, dcBusPowered: false,
  });
}

/* ── Read electrical config from aircraft JSON, with engine-count defaults ── */
export function elecCfg() {
  const ac  = S.aircraft;
  const n   = ac?.engine?.count ?? 2;
  const cfg = ac?.electrical ?? {};
  return {
    extPwrB:  cfg.extPwrB  ?? (n >= 4),   // second EXT PWR port
    batCount: cfg.batCount ?? (n >= 4 ? 3 : 2), // number of batteries (2 or 3)
  };
}

/* ── Tick — called each frame ── */
export function tickElectrical(dt) {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan') return;

  /* APU state machine */
  let apuState = S.apuState ?? 'off';
  if (apuState === 'starting' && (S.time ?? 0) - (_apuStartT ?? 0) >= APU_START_SECS) {
    apuState = 'running';
    setState({ apuState: 'running', apuRunning: true });
  }

  const n = ac.engine?.count ?? 2;
  const idgConn = S.idgConnected?.length === n ? S.idgConnected : Array(n).fill(true);
  const genSw   = S.engGenSwitch?.length === n ? S.engGenSwitch : Array(n).fill(true);
  const n1      = S.n1 ?? 0;

  /* Per-engine generator online: IDG connected + GEN switch ON + N1 > 56% */
  const engGenOn = Array.from({ length: n }, (_, i) =>
    (idgConn[i] ?? true) && (genSw[i] ?? true) && n1 > 56
  );

  const cfg      = elecCfg();
  const apuGenOn = apuState === 'running' && (S.apuGenSwitch ?? true);
  const wow      = S.wow ?? false;
  const extA     = (S.extPwrOn  ?? false) && wow;
  const extB     = cfg.extPwrB && (S.extPwrBOn ?? false) && wow;
  const tie      = S.busTieAuto ?? true;

  /* Battery essential bus */
  const bat1Live = (S.bat1On ?? false) && (S.bat1Charge ?? 0) > 2;
  const bat2Live = (S.bat2On ?? false) && (S.bat2Charge ?? 0) > 2;
  const bat3Live = (S.bat3On ?? false) && (S.bat3Charge ?? 0) > 2;
  const essentialBusPowered = bat1Live || bat2Live || bat3Live;

  /* Per-bus local sources (before bus tie) */
  const g1 = engGenOn[0] ?? false;
  const g2 = n >= 2 ? (engGenOn[1] ?? false) : false;
  const g3 = n >= 3 ? (engGenOn[2] ?? false) : false;
  const g4 = n >= 4 ? (engGenOn[3] ?? false) : false;

  const loc11 = g1 || apuGenOn || extA;
  const loc12 = g2 || apuGenOn || extA;
  const loc23 = g3 || apuGenOn || extB;
  const loc24 = g4 || apuGenOn || extB;

  /* Bus tie: if AUTO, an unpowered bus borrows from any powered bus */
  const anyAc = loc11 || loc12 || loc23 || loc24;
  const acBus11 = loc11 || (tie && anyAc);
  const acBus12 = loc12 || (tie && anyAc);
  const acBus23 = (n >= 3) && (loc23 || (tie && anyAc));
  const acBus24 = (n >= 4) && (loc24 || (tie && anyAc));

  /* AC essential bus: fed from AC BUS 1-1 | AC BUS 2-4 | static inverter (bat) */
  const acEssBus = acBus11 || acBus24 || essentialBusPowered;

  /* DC buses via transformer-rectifiers */
  const dcBus1   = acBus11;
  const dcBus2   = (n >= 4) ? acBus24 : acBus12;
  const dcEssBus = dcBus1 || dcBus2 || essentialBusPowered;

  /* Aggregate compat flags */
  const acBusPowered = acBus11 || acBus12 || acBus23 || acBus24;
  const dcBusPowered = dcBus1  || dcBus2  || dcEssBus;

  /* Generator display values — slow sine variation so ECAM doesn't flicker */
  const t = S.time ?? 0;
  const genVoltage = Array.from({ length: n }, (_, i) =>
    engGenOn[i] ? +(115 + Math.sin(t * 0.07 + i * 1.7) * 0.3).toFixed(1) : 0
  );
  const genFreq = Array.from({ length: n }, (_, i) =>
    engGenOn[i] ? +(400 + Math.sin(t * 0.05 + i * 2.1) * 0.5).toFixed(1) : 0
  );
  const genLoad = Array.from({ length: n }, (_, i) =>
    engGenOn[i] ? Math.round(42 + Math.sin(t * 0.03 + i * 0.9) * 8) : 0
  );

  setState({
    apuGenOn, engGenOn,
    acBus11, acBus12, acBus23, acBus24, acEssBus,
    dcBus1, dcBus2, dcEssBus,
    essentialBusPowered, acBusPowered, dcBusPowered,
    genVoltage, genFreq, genLoad,
  });

  /* Battery charge / drain — only iterate batteries the aircraft actually has */
  const upd = {};
  const allChargePairs = [
    ['bat1', acBusPowered],
    ['bat2', acBusPowered],
    ['bat3', acEssBus],
  ];
  const chargePairs = allChargePairs.slice(0, cfg.batCount);
  for (const [k, chargeSource] of chargePairs) {
    if (!(S[`${k}On`] ?? false)) continue;
    const c = S[`${k}Charge`] ?? 100;
    let next = c;
    if (chargeSource && c < 100) next = Math.min(100, c + BAT_CHARGE_PCT_S * dt);
    else if (!chargeSource)      next = Math.max(0,   c - BAT_DRAIN_PCT_S  * dt);
    if (Math.abs(next - c) > 0.001) upd[`${k}Charge`] = next;
  }
  if (Object.keys(upd).length) setState(upd);
}
