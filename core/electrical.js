/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/electrical.js
   Turbofan electrical system — a generic solver over the aircraft's
   electrical layout (aircraft.electrical: sources, buses).

   The layout is a graph:
     sources  gen (driver eng1 … / apu), ext (plug A / B), bat (battery 1 …)
     buses    ac / dc; feeds in priority order — sources, or buses
              (a TR, the static inverter, a contactor); ties — buses it
              may borrow from while BUS TIE is AUTO; role 'main' (an AC
              main bus) or 'battery' (the battery bus)
   A source is online when its driver delivers; a bus is powered by its
   first live feed (fedBy), or through a tie. Without a layout in the
   aircraft file the default is built from the engine count — the A340's
   structure (AC BUS 1-1 / 1-2 / 2-3 / 2-4, AC ESS, DC 1 / 2 / ESS, BAT).

   State: S.elec = { sources: {id: {on}}, buses: {id: {powered, fedBy}} }.
   The single fields the displays and core/ read today (acBus11 …,
   engGenOn, acBusPowered, essentialBusPowered …) are derived from it.
   issues.md "One engine per aircraft", stage 2d.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { onMissionReset } from './lifecycle.js';

const BAT_DRAIN_PCT_S  = 0.30 / 60;
const BAT_CHARGE_PCT_S = 3.0  / 60;

/* The APU itself (MASTER, START, fire handle, the start sequence) is core/engine.js's —
   this module only reads apuState for the APU GEN. */

/* ── Reset on mission load ── */
export function resetElectrical() {
  const n = S.aircraft?.engine?.count ?? 2;
  setState({
    bat1On: false, bat2On: false, bat3On: false,
    bat1Charge: 100, bat2Charge: 100, bat3Charge: 100,
    extPwrOn: false, extPwrBOn: false,
    apuBleedOn: false, apuGenSwitch: true, apuGenOn: false,   // the APU's own state: core/engine.js
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
onMissionReset(resetElectrical);

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

/* ── The layout ─────────────────────────────────────────────── */

/** The aircraft's electrical layout — its own, or the default built from the engine count. */
export function electricalLayout(ac = S.aircraft) {
  return ac?.electrical?.buses ? ac.electrical : defaultLayout(ac);
}

/**
 * The default layout — the A340's structure, scaled by the engine count: a generator per
 * engine, the APU GEN, EXT A (and EXT B with extPwrB), BAT 1 … batCount; AC BUS 1-1 / 1-2
 * (2-3, 2-4 with 3 and 4 engines) tied while BUS TIE is AUTO; AC ESS from 1-1 / 2-4 or the
 * battery (static inverter); DC 1 from 1-1, DC 2 from 2-4 (1-2 on a twin), DC ESS from either
 * or the battery.
 */
export function defaultLayout(ac) {
  const n = ac?.engine?.count ?? 2;
  const cfg = ac?.electrical ?? {};
  const extPwrB  = cfg.extPwrB  ?? (n >= 4);
  const batCount = cfg.batCount ?? (n >= 4 ? 3 : 2);
  const gens = Array.from({ length: n }, (_, i) => ({ id: `gen${i + 1}`, type: 'gen', driver: `eng${i + 1}`, label: `GEN ${i + 1}` }));
  const bats = Array.from({ length: batCount }, (_, i) => ({ id: `bat${i + 1}`, type: 'bat', battery: i + 1, label: i === 2 ? 'APU BAT' : `BAT ${i + 1}`,
                                                            chargedBy: i === 2 ? ['acEss'] : ['ac11', 'ac12', 'ac23', 'ac24'] }));
  const sources = [...gens, { id: 'apugen', type: 'gen', driver: 'apu', label: 'APU GEN' },
                   { id: 'extA', type: 'ext', plug: 'A', label: 'EXT A' },
                   ...(extPwrB ? [{ id: 'extB', type: 'ext', plug: 'B', label: 'EXT B' }] : []), ...bats];
  const mains = ['ac11', 'ac12', ...(n >= 3 ? ['ac23'] : []), ...(n >= 4 ? ['ac24'] : [])];
  const main = (id, gen, ext, label) => ({ id, type: 'ac', role: 'main', label,
    feeds: [...(gen <= n ? [`gen${gen}`] : []), 'apugen', ...(ext === 'B' && !extPwrB ? [] : [ext === 'A' ? 'extA' : 'extB'])],
    ties: mains.filter(m => m !== id) });
  const buses = [
    main('ac11', 1, 'A', 'AC BUS 1-1'), main('ac12', 2, 'A', 'AC BUS 1-2'),
    ...(n >= 3 ? [main('ac23', 3, 'B', 'AC BUS 2-3')] : []), ...(n >= 4 ? [main('ac24', 4, 'B', 'AC BUS 2-4')] : []),
    { id: 'batBus', type: 'dc', role: 'battery', label: 'DC BAT', feeds: bats.map(b => b.id) },
    { id: 'acEss', type: 'ac', label: 'AC ESS', feeds: ['ac11', ...(n >= 4 ? ['ac24'] : []), 'batBus'] },   // static inverter from the battery
    { id: 'dc1',   type: 'dc', label: 'DC BUS 1', feeds: ['ac11'] },                                       // TR 1
    { id: 'dc2',   type: 'dc', label: 'DC BUS 2', feeds: [n >= 4 ? 'ac24' : 'ac12'] },                     // TR 2
    { id: 'dcEss', type: 'dc', label: 'DC ESS', feeds: ['dc1', 'dc2', 'batBus'] },
  ];
  return { sources, buses };
}

/* ── The solver ─────────────────────────────────────────────── */

/* Is a source delivering? Its switches are today's fields (the overhead writes them) — they move to
   the elements with the overhead built from the layout (stage 2d, part 3). */
function _sourceOnline(src) {
  if (src.type === 'gen') {
    if (src.driver === 'apu') return (S.apuState ?? 'off') === 'running' && (S.apuGenSwitch ?? true);
    const i = parseInt(String(src.driver).replace('eng', ''), 10) - 1;           // eng1 → engine 0
    const genMin = 0.9 * (S.aircraft?.engine?.coreIdle ?? 60);                   // the gearbox: its engine's core at idle or above
    return (S.idgConnected?.[i] ?? true) && (S.engGenSwitch?.[i] ?? true) && (S.engines?.[i]?.core ?? 0) >= genMin;
  }
  if (src.type === 'ext') return !!(src.plug === 'B' ? S.extPwrBOn : S.extPwrOn) && !!S.wow;   // a ground cart — on the ground only
  if (src.type === 'bat') return !!S[`bat${src.battery}On`] && (S[`bat${src.battery}Charge`] ?? 0) > 2;
  return false;
}

/**
 * Solve a layout: which sources are online, which buses powered and by what. A bus is powered by
 * its first live feed, or — BUS TIE AUTO — by a powered bus it is tied to; repeated until nothing
 * changes, so power reaches every bus it can.
 */
export function solveElectrical(layout = electricalLayout()) {
  const sources = Object.fromEntries(layout.sources.map(s => [s.id, { on: _sourceOnline(s) }]));
  const tie = S.busTieAuto ?? true;
  let buses = Object.fromEntries(layout.buses.map(b => [b.id, { powered: false, fedBy: null }]));
  for (let pass = 0; pass <= layout.buses.length; pass++) {
    const live = (id) => sources[id]?.on || buses[id]?.powered;
    const next = Object.fromEntries(layout.buses.map(b => {
      const feed = (b.feeds ?? []).find(live) ?? (tie ? (b.ties ?? []).find(t => buses[t]?.powered) : undefined);
      return [b.id, { powered: feed != null, fedBy: feed ?? null }];
    }));
    const same = layout.buses.every(b => next[b.id].powered === buses[b.id].powered && next[b.id].fedBy === buses[b.id].fedBy);
    buses = next;
    if (same) break;
  }
  return { sources, buses };
}

/* The single fields of the default (A340) structure, by bus id — derived until the readers move to S.elec */
const _BUS_FIELD = { ac11: 'acBus11', ac12: 'acBus12', ac23: 'acBus23', ac24: 'acBus24', acEss: 'acEssBus',
                     dc1: 'dcBus1', dc2: 'dcBus2', dcEss: 'dcEssBus' };

/* ── Tick — called each frame ── */
export function tickElectrical(dt) {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan') return;

  const layout = electricalLayout(ac);
  const elec   = solveElectrical(layout);
  const on     = (id) => !!elec.sources[id]?.on;
  const pow    = (id) => !!elec.buses[id]?.powered;
  const n      = ac.engine?.count ?? 2;

  /* The single fields, derived */
  const genOf    = (i) => layout.sources.find(s => s.type === 'gen' && s.driver === `eng${i + 1}`);
  const engGenOn = Array.from({ length: n }, (_, i) => { const g = genOf(i); return g ? on(g.id) : false; });
  const apuGenOn = layout.sources.some(s => s.type === 'gen' && s.driver === 'apu' && on(s.id));
  const busFields = Object.fromEntries(Object.values(_BUS_FIELD).map(f => [f, false]));
  for (const b of layout.buses) if (_BUS_FIELD[b.id]) busFields[_BUS_FIELD[b.id]] = pow(b.id);
  const essentialBusPowered = layout.buses.some(b => b.role === 'battery' && pow(b.id));
  const acBusPowered        = layout.buses.some(b => b.type === 'ac' && b.role === 'main' && pow(b.id));
  const dcBusPowered        = layout.buses.some(b => b.type === 'dc' && b.role !== 'battery' && pow(b.id));

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
    elec, apuGenOn, engGenOn, ...busFields,
    essentialBusPowered, acBusPowered, dcBusPowered,
    genVoltage, genFreq, genLoad,
  });

  /* Batteries charge from their buses (chargedBy — any of them powered), drain without */
  const upd = {};
  for (const src of layout.sources.filter(s => s.type === 'bat')) {
    const k = `bat${src.battery}`;
    if (!(S[`${k}On`] ?? false)) continue;
    const charging = (src.chargedBy ?? []).some(pow);
    const c = S[`${k}Charge`] ?? 100;
    let next = c;
    if (charging && c < 100) next = Math.min(100, c + BAT_CHARGE_PCT_S * dt);
    else if (!charging)      next = Math.max(0,   c - BAT_DRAIN_PCT_S  * dt);
    if (Math.abs(next - c) > 0.001) upd[`${k}Charge`] = next;
  }
  if (Object.keys(upd).length) setState(upd);
}
