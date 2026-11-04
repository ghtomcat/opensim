/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/hydraulics.js
   Turbofan hydraulic system — a generic solver over the aircraft's
   hydraulic layout (aircraft.hydraulics: systems with their pumps).

   The layout:
     systems  id, label, psi (nominal pressure), pumps
     pumps    type edp  — engine-driven, on its engine's core (driver: eng1 …)
                   acmp — an AC motor pump, on an electrical bus (bus: an id
                          of the electrical layout; none — any AC power)
                   adp  — air-driven, on bleed air (an engine or the APU running)
                   rat  — the ram air turbine's pump, once the RAT is deployed
              role primary — normally on; demand — AUTO: runs when its
              system's primary pumps don't deliver; standby — off until
              switched on
   A pump runs when its driver delivers and its switch allows it; a
   system's pressure rises while a pump runs and falls without one.
   Without a layout in the aircraft file the default is built from the
   engine count — the A340's structure (GREEN: ENG 1's EDP + an electric
   pump; BLUE: electric; YELLOW: the last engine's EDP + an electric pump).

   State: S.hyd = { systems: {id: {psi, pumps: {id: {running}}}} }, the
   switches in S.hydCtl (by pump: 'on' | 'off' | 'auto'), changed only
   through hydPump(). The single fields the displays read today
   (hydGreenPsi, hydGreenElecOn, hydGreenEdp …) are derived from it.
   Display only — nothing in the sim depends on the pressures yet.
   issues.md "One engine per aircraft", stage 4.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { onMissionReset } from './lifecycle.js';

const PSI_REF   = 3000;    // the rates below are for a 3000-psi system; scaled to the system's own
const RISE_RATE = 600;     // psi/s while a pump runs
const FALL_RATE = 80;      // psi/s with none (leakage/consumption)

/* ── The layout ── */
export function hydraulicsLayout(ac = S.aircraft) {
  return ac?.hydraulics?.systems ? ac.hydraulics : defaultLayout(ac);
}

/** The A340's structure, from the engine count — for turbofans without a layout of their own. */
export function defaultLayout(ac) {
  const n = ac?.engine?.count ?? 2;
  return { systems: [
    { id: 'green',  label: 'GREEN',  psi: 3000, pumps: [
      { id: 'greenEdp',   type: 'edp',  driver: 'eng1', role: 'primary' },
      { id: 'greenElec',  type: 'acmp', role: 'standby' } ] },
    { id: 'blue',   label: 'BLUE',   psi: 3000, pumps: [
      { id: 'blueElec',   type: 'acmp', role: 'standby' } ] },
    { id: 'yellow', label: 'YELLOW', psi: 3000, pumps: [
      { id: 'yellowEdp',  type: 'edp',  driver: `eng${n}`, role: 'primary' },
      { id: 'yellowElec', type: 'acmp', role: 'standby' } ] },
  ] };
}

/* ── Controls — by pump ── */
const _ctlDefault = (p) => p.role === 'demand' ? 'auto' : p.role === 'standby' ? 'off' : 'on';

/** A pump's switch: 'on' | 'off' | 'auto' (its default until changed). */
export function hydCtl(id, layout = hydraulicsLayout()) {
  const set = S.hydCtl?.[id];
  if (set) return set;
  for (const sys of layout.systems) for (const p of sys.pumps) if (p.id === id) return _ctlDefault(p);
  return 'off';
}

/** Set a pump's switch. */
export function hydPump(id, mode) {
  setState({ hydCtl: { ...(S.hydCtl ?? {}), [id]: mode } });
}

/* ── Drivers ── */
function _driverDelivers(p, ac) {
  const edpMin = 0.9 * (ac?.engine?.coreIdle ?? 60);                       // 90 % of core idle — the gearbox turns fast enough
  const coreOf = (i) => S.engines?.[i]?.core ?? 0;
  switch (p.type) {
    case 'edp': {
      const m = /^eng(\d+)$/.exec(p.driver ?? '');
      return !!m && coreOf(+m[1] - 1) >= edpMin;
    }
    case 'acmp': return p.bus ? !!S.elec?.buses?.[p.bus]?.powered : !!S.acBusPowered;
    case 'adp':  return (S.engines ?? []).some(e => (e.core ?? 0) >= edpMin) || S.apuState === 'running';   // bleed air — pneumatics not modelled
    case 'rat':  return !!S.ratDeployed;
    default:     return false;
  }
}

/** Which pumps run: primaries and standbys by their switch, demand pumps in AUTO when no primary delivers. */
export function solvePumps(layout = hydraulicsLayout(), ac = S.aircraft) {
  const running = {};
  for (const sys of layout.systems) {
    const runs = (p) => {
      if (p.type === 'rat') return _driverDelivers(p, ac);
      const mode = hydCtl(p.id, layout);
      return mode !== 'off' && _driverDelivers(p, ac);
    };
    for (const p of sys.pumps) if (p.role !== 'demand') running[p.id] = runs(p);
    const primaryOk = sys.pumps.some(p => p.role === 'primary' && running[p.id]);
    for (const p of sys.pumps) if (p.role === 'demand')
      running[p.id] = runs(p) && (hydCtl(p.id, layout) === 'on' || !primaryOk);
  }
  return running;
}

/* ── Reset on mission load ── */
export function resetHydraulics() {
  const layout = hydraulicsLayout();
  const engRunning = S.engineState === 'running';                            // airborne starts: pre-pressurised where an engine pump is
  const systems = {};
  for (const sys of layout.systems) {
    const psi = engRunning && sys.pumps.some(p => p.type === 'edp') ? sys.psi : 0;
    systems[sys.id] = { psi, pumps: Object.fromEntries(sys.pumps.map(p => [p.id, { running: false }])) };
  }
  setState({ hydCtl: {}, hyd: { systems }, ..._singleFields(layout, systems, {}) });
}
onMissionReset(resetHydraulics);

/* ── The single fields (hydGreenPsi …) for the systems the displays still read by name ── */
const _NAMED = { green: 'Green', blue: 'Blue', yellow: 'Yellow' };
function _singleFields(layout, systems, running) {
  const out = {};
  for (const sys of layout.systems) {
    const N = _NAMED[sys.id];
    if (!N) continue;
    out[`hyd${N}Psi`]    = systems[sys.id].psi;
    out[`hyd${N}Edp`]    = sys.pumps.some(p => p.type === 'edp' && running[p.id]);
    out[`hyd${N}ElecOn`] = sys.pumps.some(p => p.type === 'acmp' && hydCtl(p.id, layout) === 'on');
  }
  return out;
}

export function tickHydraulics(dt) {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan') return;

  const layout  = hydraulicsLayout(ac);
  const running = solvePumps(layout, ac);
  const systems = {};
  for (const sys of layout.systems) {
    const k   = (sys.psi ?? PSI_REF) / PSI_REF;
    const cur = S.hyd?.systems?.[sys.id]?.psi ?? 0;
    const src = sys.pumps.some(p => running[p.id]);
    const nxt = src ? Math.min(sys.psi, cur + RISE_RATE * k * dt) : Math.max(0, cur - FALL_RATE * k * dt);
    systems[sys.id] = {
      psi: Math.abs(nxt - cur) > 0.5 ? nxt : cur,                             // settle — no sub-psi updates
      pumps: Object.fromEntries(sys.pumps.map(p => [p.id, { running: running[p.id] }])),
    };
  }
  setState({ hyd: { systems }, ..._singleFields(layout, systems, running) });
}
