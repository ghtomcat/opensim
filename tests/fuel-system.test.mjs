/**
 * The airliner fuel system (core/fuel-system.js): a generic solver over the fuel layout.
 * The default layout (a wing tank each side, a centre tank), the load, the feed order — the centre
 * first while its override pumps run, then the engine's own side, the other side through an open
 * crossfeed — the burn equal to the engines' fuel flow, pumps that stop without power or fuel, the
 * engines fed from their own side when no pump runs (flagged), and light aircraft and the electric
 * Velis left alone.
 *
 * Run:  node --test tests/fuel-system.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { fuelLayout, defaultFuelLayout, resetFuelSystem, tickFuelSystem, fuelPump, fuelValve, fuelCtl,
         solveFuelPumps, fuelView, fuelCautions } from '../core/fuel-system.js';
import { check } from '../core/schema/check.js';
import { aircraft as aircraftSchema } from '../core/schema/aircraft.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

/* an airliner with its engines at a given fuel flow (kg/h), the fuel system reset */
function start(id, ff = [6000, 6000], over = {}) {
  setState({ aircraft: load(id), acBusPowered: true, elec: null, fuelCtl: {},
             engines: ff.map(f => ({ state: 'running', ff: f })), ...over });
  resetFuelSystem();
}
const kg = (id) => S.fuelSys.tanks[id].kg;
const hour = (n = 3600) => { for (let i = 0; i < n; i++) tickFuelSystem(1); };

test('the default layout: wing tanks and a centre tank, 30 % of the mass, the engines by side', () => {
  const a350 = load('a350'), l = defaultFuelLayout(a350), m = a350.performance.mass;
  assert.deepEqual(l.tanks.map(t => t.id), ['left', 'center', 'right']);
  near(l.tanks.reduce((s, t) => s + t.capacityKg, 0), 0.3 * m, 2, 'capacity');
  assert.deepEqual(l.engines, { eng1: 'left', eng2: 'right' });
  assert.deepEqual(defaultFuelLayout(load('a340')).engines, { eng1: 'left', eng2: 'left', eng3: 'right', eng4: 'right' });
  assert.equal(l.load, 0.6);
});

test('at reset every tank holds 60 % of its capacity; pumps on, the crossfeed closed', () => {
  start('a350');
  for (const t of fuelLayout().tanks) near(kg(t.id), 0.6 * t.capacityKg, 1e-9, t.id);
  near(S.fuelSys.fob, 0.6 * fuelLayout().tanks.reduce((s, t) => s + t.capacityKg, 0), 1e-6, 'fob');
  assert.equal(fuelCtl('lFwd'), true);
  assert.equal(fuelCtl('xfeed'), false);
  assert.equal(S.fuelSys.valves.xfeed.open, false);
});

test('the burn equals the engines\' fuel flow — the centre tank first', () => {
  start('a350', [6000, 4000]);
  const c0 = kg('center'), l0 = kg('left'), r0 = kg('right'), fob0 = S.fuelSys.fob;
  hour();
  near(fob0 - S.fuelSys.fob, 10000, 1e-6, 'one hour at 6000 + 4000 kg/h');
  near(c0 - kg('center'), 10000, 1e-6, 'all from the centre');
  assert.equal(kg('left'), l0);
  assert.equal(kg('right'), r0);
  assert.deepEqual(S.fuelSys.feeds, { eng1: ['center'], eng2: ['center'] });
});

test('the centre empty: each engine from its own side; its pumps stop', () => {
  start('a350', [6000, 4000]);
  setState({ fuelSys: { ...S.fuelSys, tanks: { ...S.fuelSys.tanks, center: { kg: 0 } } } });
  const l0 = kg('left'), r0 = kg('right');
  hour();
  near(l0 - kg('left'), 6000, 1e-6, 'left');
  near(r0 - kg('right'), 4000, 1e-6, 'right');
  assert.equal(S.fuelSys.pumps.cL.running, false);
  assert.equal(S.fuelSys.pumps.lFwd.running, true);
});

test('the left pumps off, the crossfeed open: ENG 1 draws from the right', () => {
  start('a350', [6000, 0]);
  setState({ fuelSys: { ...S.fuelSys, tanks: { ...S.fuelSys.tanks, center: { kg: 0 } } } });
  fuelPump('lFwd', false); fuelPump('lAft', false); fuelValve('xfeed', true);
  const l0 = kg('left'), r0 = kg('right');
  hour(600);
  assert.equal(kg('left'), l0);
  near(r0 - kg('right'), 1000, 1e-6, '10 min at 6000 kg/h');
  assert.deepEqual(S.fuelSys.feeds.eng1, ['right']);
  assert.equal(S.fuelSys.suction.eng1, undefined);
});

test('no pump running (no AC power): fed from its own side anyway — flagged', () => {
  start('a350', [6000, 6000], { acBusPowered: false });
  const l0 = kg('left'), c0 = kg('center');
  hour(600);
  assert.ok(kg('left') < l0 || kg('center') < c0, 'it still burns');
  assert.equal(S.fuelSys.suction.eng1, true);
  assert.deepEqual(solveFuelPumps(), { lFwd: false, lAft: false, cL: false, cR: false, rFwd: false, rAft: false });
});

test('every tank empty: nothing more to take, no negative fuel (an engine is not starved — out of physics)', () => {
  start('a350', [6000, 6000]);
  setState({ fuelSys: { ...S.fuelSys, tanks: { left: { kg: 1 }, center: { kg: 0 }, right: { kg: 0 } } } });
  hour(60);
  assert.equal(S.fuelSys.fob, 0);
  assert.ok(Object.values(S.fuelSys.tanks).every(t => t.kg === 0));
});

test('light aircraft are left to core/fuel.js, the Velis to its battery (core/battery.js)', () => {
  for (const id of ['c172', 'velis-hb-syc']) {
    setState({ aircraft: load(id), engines: [{ state: 'running', ff: 30 }] });
    resetFuelSystem();
    assert.equal(S.fuelSys, null, id);
    tickFuelSystem(1);
    assert.equal(S.fuelSys, null, id);
  }
});

test('the schema catches a pump in an unknown tank, an engine that does not exist, a load above 1', () => {
  const a = load('a350');
  a.fuelSystem = { ...defaultFuelLayout(a), load: 1.5 };
  a.fuelSystem.pumps[0].tank = 'nowhere';
  a.fuelSystem.engines = { ...a.fuelSystem.engines, eng5: 'left' };
  const errs = check(a, aircraftSchema);
  assert.ok(errs.some(e => e.includes('unknown tank "nowhere"')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('"eng5" is not an engine')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('load must be between 0 and 1')), errs.join('\n'));
});

/* ── What the displays read: the view and the cautions ── */
const setTanks = (t) => setState({ fuelSys: { ...S.fuelSys, tanks: { ...S.fuelSys.tanks, ...t } } });
/* the given pumps on a bus that is down — the rest of the aircraft powered (S.acBusPowered) */
function busDown(...ids) {
  const l = structuredClone(fuelLayout());
  for (const p of l.pumps) if (ids.includes(p.id)) p.bus = 'down';
  setState({ aircraft: { ...S.aircraft, fuelSystem: l }, elec: { buses: { down: { powered: false } } } });
}

test('the view: pump states — running, off, LO PR (on, no power, fuel in the tank), empty', () => {
  start('a350', [6000, 6000]);
  fuelPump('lFwd', false);
  tickFuelSystem(1);
  const st = () => Object.fromEntries(fuelView().pumps.map(p => [p.id, p.state]));
  assert.equal(st().lFwd, 'off');
  assert.equal(st().lAft, 'run');
  setTanks({ center: { kg: 0 } }); tickFuelSystem(1);
  assert.equal(st().cL, 'empty');
  setState({ acBusPowered: false }); tickFuelSystem(1);
  assert.equal(st().lAft, 'fault');
  assert.equal(st().lFwd, 'off');
  assert.equal(fuelView().engines.find(e => e.eng === 'eng1').suction, true);
});

test('the cautions: pump LO PR, a feed tank LO LEVEL below 5 %, IMBALANCE beyond 2 % of the total', () => {
  start('a350', [0, 0]);
  tickFuelSystem(1);
  assert.deepEqual(fuelCautions(), {}, 'normal: none');
  const l = fuelLayout(), cap = (id) => l.tanks.find(t => t.id === id).capacityKg, total = l.tanks.reduce((a, t) => a + t.capacityKg, 0);
  setTanks({ left: { kg: 0.04 * cap('left') }, right: { kg: 0.04 * cap('left') } }); tickFuelSystem(1);
  assert.deepEqual(Object.keys(fuelCautions()).sort(), ['FUEL_L_LO_LEVEL', 'FUEL_R_LO_LEVEL']);
  setTanks({ left: { kg: 0.5 * cap('left') }, right: { kg: 0.5 * cap('left') - 0.03 * total } }); tickFuelSystem(1);
  assert.deepEqual(Object.keys(fuelCautions()), ['FUEL_IMBALANCE']);
  setTanks({ right: { kg: 0.5 * cap('left') } });
  busDown('lFwd', 'cR'); tickFuelSystem(1);
  assert.deepEqual(Object.keys(fuelCautions()).sort(), ['FUEL_CTR_R_LO_PR', 'FUEL_L_FWD_LO_PR']);
});

test('the cautions reach S.warnings — this module\'s keys only, replaced each tick', () => {
  start('a350', [0, 0]);
  setState({ warnings: { OIL_PRESS: true } });
  busDown('lFwd'); tickFuelSystem(1);
  assert.equal(S.warnings.OIL_PRESS, true);
  assert.equal(S.warnings.FUEL_L_FWD_LO_PR, true);
  setState({ elec: { buses: { down: { powered: true } } } }); tickFuelSystem(1);
  assert.equal(S.warnings.FUEL_L_FWD_LO_PR, undefined, 'gone once the pump runs');
  assert.equal(S.warnings.OIL_PRESS, true, 'the others\' keys kept');
});

test('no fuel cautions cold and dark — no AC power on the aircraft at all', () => {
  start('a340', [0, 0, 0, 0], { acBusPowered: false, warnings: {} });
  tickFuelSystem(1);
  assert.deepEqual(fuelCautions(), {});
  assert.deepEqual(Object.keys(S.warnings).filter(k => k.startsWith('FUEL_')), []);
});

test('a mission reset removes the last mission\'s fuel cautions — the others\' keys stay', () => {
  start('a350', [0, 0], { warnings: { OIL_PRESS: true } });
  busDown('lFwd');
  tickFuelSystem(1);
  assert.equal(S.warnings.FUEL_L_FWD_LO_PR, true);
  setState({ aircraft: load('a350') });
  resetFuelSystem();
  assert.equal(S.warnings.FUEL_L_FWD_LO_PR, undefined, 'gone with the reset');
  assert.equal(S.warnings.OIL_PRESS, true);
});
