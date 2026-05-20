/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/electrical.js
   Electrical system for turbofan aircraft (A340, A220, E190).

   Bus hierarchy:
     Essential bus  ← BAT 1 or BAT 2 (switch ON + charge > 2 %)
     AC bus         ← APU gen | engine gens | external power (ground only)
     DC bus         ← AC bus (via TR) | essential bus

   State keys managed here:
     bat1On / bat2On          battery master switches
     bat1Charge / bat2Charge  0–100 %
     extPwrOn                 external power switch (ground only)
     apuState                 'off' | 'starting' | 'running'
     apuBleedOn               APU bleed valve switch
     apuRunning               derived bool (backward compat)
     apuGenOn                 derived — APU contribution to AC bus
     engGenOn                 derived bool[] per engine
     essentialBusPowered      derived
     acBusPowered             derived
     dcBusPowered             derived
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const BAT_DRAIN_PCT_S  = 0.30 / 60;   // ~0.30 %/min at rest on essential bus
const BAT_CHARGE_PCT_S = 3.0  / 60;   // ~3 %/min when AC bus live
const APU_START_SECS   = 35;          // seconds from MASTER ON → AVAIL/RUNNING

let _apuStartT = null;   // S.time when APU start was commanded

/* ── Called from overhead.js when APU MASTER is pressed ── */
export function apuMasterToggle() {
  const state = S.apuState ?? 'off';
  if (state !== 'off') {
    /* Shutdown */
    _apuStartT = null;
    setState({ apuState: 'off', apuGenOn: false, apuBleedOn: false, apuRunning: false });
    return;
  }
  /* Start — needs essential bus (battery power) */
  if (!(S.essentialBusPowered ?? false)) return;
  _apuStartT = S.time ?? 0;
  setState({ apuState: 'starting' });
}

/* ── Reset on mission load ── */
export function resetElectrical() {
  _apuStartT = null;
  setState({
    bat1On:     false,
    bat2On:     false,
    bat1Charge: 100,
    bat2Charge: 100,
    extPwrOn:   false,
    apuState:   'off',
    apuBleedOn: false,
    apuRunning: false,
    apuGenOn:   false,
    engGenOn:   [],
    essentialBusPowered: false,
    acBusPowered:        false,
    dcBusPowered:        false,
  });
}

/* ── Tick — called each frame from loop.js ── */
export function tickElectrical(dt) {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan') return;

  /* APU state machine */
  let apuState = S.apuState ?? 'off';
  if (apuState === 'starting') {
    if ((S.time ?? 0) - (_apuStartT ?? 0) >= APU_START_SECS) {
      apuState = 'running';
      setState({ apuState: 'running', apuRunning: true });
    }
  }

  /* Engine generators — one per engine, online when N1 > 56 % */
  const n = ac.engine?.count ?? 2;
  const engGenOn = Array.from({ length: n }, () => (S.n1 ?? 0) > 56);

  const apuGenOn = apuState === 'running';

  /* Derived bus states */
  const essentialBusPowered =
    ((S.bat1On ?? false) && (S.bat1Charge ?? 0) > 2) ||
    ((S.bat2On ?? false) && (S.bat2Charge ?? 0) > 2);

  const acBusPowered =
    ((S.extPwrOn ?? false) && (S.wow ?? false)) ||
    apuGenOn ||
    engGenOn.some(Boolean);

  const dcBusPowered = acBusPowered || essentialBusPowered;

  setState({ apuGenOn, engGenOn, essentialBusPowered, acBusPowered, dcBusPowered });

  /* Battery charge / drain */
  const upd = {};
  for (const k of ['bat1', 'bat2']) {
    if (!(S[`${k}On`] ?? false)) continue;
    const c = S[`${k}Charge`] ?? 100;
    let next = c;
    if (acBusPowered && c < 100) next = Math.min(100, c + BAT_CHARGE_PCT_S * dt);
    else if (!acBusPowered)      next = Math.max(0,   c - BAT_DRAIN_PCT_S  * dt);
    if (Math.abs(next - c) > 0.001) upd[`${k}Charge`] = next;
  }
  if (Object.keys(upd).length) setState(upd);
}
