/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/fuel-system.js
   Turbofan fuel system — a generic solver over the aircraft's fuel
   layout (aircraft.fuelSystem). Display-only: it moves fuel, nothing
   else — an empty tank doesn't stop an engine and the burn doesn't
   change the mass (issues.md "Airliner fuel system").

   The layout:
     tanks    id, label, capacityKg (usable)
     pumps    id, label, tank, feeds ('left' | 'right' — the engine
              manifold it supplies), bus (an AC bus of the electrical
              layout; none — any AC power), role main | override (the
              centre tank's pumps: their higher pressure feeds first)
     engines  { eng1: 'left', … } — the manifold each engine draws from
     valves   id, label, type crossfeed — joins the two manifolds
     load     the default load, a fraction of each tank's capacity
   Each engine draws its fuel flow (S.engines[i].ff, kg/h): from a
   running override pump on its side, else a running main pump on its
   side, else through an open crossfeed from the other side; with no
   pump running it is still fed from its own side's tanks (flagged —
   suction feed isn't modelled). A pump runs when it is switched on,
   its bus is powered and its tank has fuel.
   Without a layout in the aircraft file a turbofan gets the default:
   a wing tank each side and a centre tank, two pumps each.

   State: S.fuelSys = { tanks: {id: {kg}}, pumps: {id: {running}},
   valves: {id: {open}}, feeds: {eng1: [tank ids]}, suction: {eng1},
   fob }; the switches in S.fuelCtl (by element: true = on / open),
   changed only through fuelPump() / fuelValve(). Units: kg.
   Light aircraft keep core/fuel.js.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { onMissionReset } from './lifecycle.js';

const DEFAULT_LOAD = 0.6;   // until missions or weight and balance set the fuel load

/* ── The layout ── */
export function fuelLayout(ac = S.aircraft) {
  return ac?.fuelSystem?.tanks ? ac.fuelSystem : defaultFuelLayout(ac);
}

/** A wing tank each side and a centre tank, two pumps each, the engines fed by side, one crossfeed.
    Capacity estimated at 30 % of the aircraft's mass (a typical long-range airliner's usable fuel
    over its weight), split 30 / 40 / 30 — a placeholder until the aircraft has its own layout. */
export function defaultFuelLayout(ac) {
  const n = ac?.engine?.count ?? 2, total = 0.3 * (ac?.performance?.mass ?? 0);
  const engines = {};
  for (let i = 1; i <= n; i++) engines[`eng${i}`] = i <= n / 2 ? 'left' : 'right';
  return {
    tanks: [
      { id: 'left',   label: 'L',   capacityKg: Math.round(0.3 * total) },
      { id: 'center', label: 'CTR', capacityKg: Math.round(0.4 * total) },
      { id: 'right',  label: 'R',   capacityKg: Math.round(0.3 * total) },
    ],
    pumps: [
      { id: 'lFwd', label: 'L FWD', tank: 'left',   feeds: 'left',  role: 'main' },
      { id: 'lAft', label: 'L AFT', tank: 'left',   feeds: 'left',  role: 'main' },
      { id: 'cL',   label: 'CTR L', tank: 'center', feeds: 'left',  role: 'override' },
      { id: 'cR',   label: 'CTR R', tank: 'center', feeds: 'right', role: 'override' },
      { id: 'rFwd', label: 'R FWD', tank: 'right',  feeds: 'right', role: 'main' },
      { id: 'rAft', label: 'R AFT', tank: 'right',  feeds: 'right', role: 'main' },
    ],
    engines,
    valves: [{ id: 'xfeed', label: 'X FEED', type: 'crossfeed' }],
    load: DEFAULT_LOAD,
  };
}

/* ── Controls — by element: pumps on, valves closed by default ── */
export function fuelCtl(id, layout = fuelLayout()) {
  const set = S.fuelCtl?.[id];
  if (set !== undefined) return set;
  return layout.pumps.some(p => p.id === id);                 // a pump: on; a valve: closed
}
export function fuelPump(id, on)    { setState({ fuelCtl: { ...(S.fuelCtl ?? {}), [id]: !!on } }); }
export function fuelValve(id, open) { setState({ fuelCtl: { ...(S.fuelCtl ?? {}), [id]: !!open } }); }

/* ── Reset on mission load: every tank at the layout's load ── */
export function resetFuelSystem() {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan') { setState({ fuelSys: null, fuelCtl: {} }); return; }
  const layout = fuelLayout(ac), load = layout.load ?? DEFAULT_LOAD;
  const tanks = Object.fromEntries(layout.tanks.map(t => [t.id, { kg: t.capacityKg * load }]));
  setState({ fuelCtl: {}, fuelSys: _state(layout, tanks, {}, {}, {}) });
}
onMissionReset(resetFuelSystem);

function _state(layout, tanks, pumps, feeds, suction) {
  const valves = Object.fromEntries((layout.valves ?? []).map(v => [v.id, { open: fuelCtl(v.id, layout) }]));
  const fob = Object.values(tanks).reduce((a, t) => a + t.kg, 0);
  return { tanks, pumps, valves, feeds, suction, fob };
}

/** Which pumps run: switched on, their bus powered, their tank not empty. */
export function solveFuelPumps(layout = fuelLayout(), tanks = S.fuelSys?.tanks ?? {}) {
  const running = {};
  for (const p of layout.pumps) {
    const powered = p.bus ? !!S.elec?.buses?.[p.bus]?.powered : !!S.acBusPowered;
    running[p.id] = fuelCtl(p.id, layout) && powered && (tanks[p.tank]?.kg ?? 0) > 0;
  }
  return running;
}

/** The tanks an engine on `side` draws from, in order — override, main, then through an open crossfeed. */
function _sources(layout, running, side) {
  const other = side === 'left' ? 'right' : 'left';
  const xfeed = (layout.valves ?? []).some(v => v.type === 'crossfeed' && fuelCtl(v.id, layout));
  const by = (feeds, role) => layout.pumps.filter(p => p.feeds === feeds && p.role === role && running[p.id]).map(p => p.tank);
  const order = [...by(side, 'override'), ...by(side, 'main')];
  if (xfeed) order.push(...by(other, 'override'), ...by(other, 'main'));
  return [...new Set(order)];
}

export function tickFuelSystem(dt) {
  const ac = S.aircraft;
  if (!ac || ac.engine?.type !== 'turbofan' || !S.fuelSys) return;
  const layout  = fuelLayout(ac);
  const tanks   = Object.fromEntries(Object.entries(S.fuelSys.tanks).map(([id, t]) => [id, { kg: t.kg }]));
  const running = solveFuelPumps(layout, tanks);
  const feeds = {}, suction = {};
  (S.engines ?? []).forEach((e, i) => {
    const eng = `eng${i + 1}`, side = layout.engines?.[eng];
    let need = (e.ff ?? 0) * dt / 3600;                        // kg this tick
    if (!side || need <= 0) return;
    let src = _sources(layout, running, side);
    if (!src.length) {                                          // no pump delivers — fed from its own side anyway (flagged)
      src = [...new Set(layout.pumps.filter(p => p.feeds === side).map(p => p.tank))];
      suction[eng] = true;
    }
    feeds[eng] = [];
    for (const id of src) {
      if (need <= 0) break;
      const t = tanks[id];
      if (!t || t.kg <= 0) continue;
      const take = Math.min(t.kg, need);
      t.kg -= take; need -= take;
      feeds[eng].push(id);
    }
  });
  setState({ fuelSys: _state(layout, tanks, Object.fromEntries(Object.entries(running).map(([id, r]) => [id, { running: r }])), feeds, suction) });
}
