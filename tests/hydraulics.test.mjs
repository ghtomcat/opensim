/**
 * Hydraulics — the generic solver over the layout (core/hydraulics.js) against the logic it replaced.
 *
 * oracle() is the old tickHydraulics() (until 2026-11-04: the A340's three systems hard-coded for
 * every turbofan, the electric pump switches in single fields), kept here as a pure function. The
 * default layout (built from the engine count — still that structure) on a four-engine aircraft, the
 * A220, the 737 and the A350: random engine / AC power / switch / pressure states go through both;
 * every pressure and engine-pump state the old code wrote must come out the same in S.hyd. Then the
 * controls and the roles, and the 777's and the A340's layouts against their sources.
 *
 * Run:  node --test tests/hydraulics.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { tickHydraulics, hydraulicsLayout, defaultLayout, hydCtl, hydPump, solvePumps, hydView } from '../core/hydraulics.js';
import { check } from '../core/schema/check.js';
import { aircraft as aircraftSchema } from '../core/schema/aircraft.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));

/* ── The old logic, as it was (pure: state in, fields out) ── */
function oracle(st, dt) {
  const ac = st.aircraft;
  const coreOf = (i) => st.engines?.[i]?.core ?? 0;
  const edpMin = 0.9 * (ac.engine?.coreIdle ?? 60);
  const acPowered = st.acBusPowered ?? false;
  const hydGreenEdp  = coreOf(0) >= edpMin;
  const hydYellowEdp = coreOf((ac.engine?.count ?? 2) - 1) >= edpMin;
  const greenSrc  = hydGreenEdp  || ((st.hydGreenElecOn  ?? false) && acPowered);
  const blueSrc   =                  ((st.hydBlueElecOn   ?? false) && acPowered);
  const yellowSrc = hydYellowEdp || ((st.hydYellowElecOn ?? false) && acPowered);
  const tick = (cur, src) => src ? Math.min(3000, cur + 600 * dt) : Math.max(0, cur - 80 * dt);
  const upd = { hydGreenEdp, hydYellowEdp, hydBlueEdp: false,
                hydGreenPsi: st.hydGreenPsi, hydBluePsi: st.hydBluePsi, hydYellowPsi: st.hydYellowPsi };
  const g = tick(st.hydGreenPsi, greenSrc), b = tick(st.hydBluePsi, blueSrc), y = tick(st.hydYellowPsi, yellowSrc);
  if (Math.abs(g - st.hydGreenPsi)  > 0.5) upd.hydGreenPsi  = g;
  if (Math.abs(b - st.hydBluePsi)   > 0.5) upd.hydBluePsi   = b;
  if (Math.abs(y - st.hydYellowPsi) > 0.5) upd.hydYellowPsi = y;
  return upd;
}

function seeded(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
const PSI = [0, 0.3, 100, 1499.6, 2999.8, 3000];

function randomState(ac, rnd) {
  const n = ac.engine.count, pick = (p) => rnd() < p;
  return {
    aircraft: ac, acBusPowered: pick(0.6),
    engines: Array.from({ length: n }, () => ({ core: [0, 11, 53.9, 54, 60, 95][Math.floor(rnd() * 6)] })),
    hydGreenElecOn: pick(0.4), hydBlueElecOn: pick(0.4), hydYellowElecOn: pick(0.4),
    hydGreenPsi: PSI[Math.floor(rnd() * 6)], hydBluePsi: PSI[Math.floor(rnd() * 6)], hydYellowPsi: PSI[Math.floor(rnd() * 6)],
  };
}

/* The same state as the solver sees it: the switches by pump (S.hydCtl), the pressures in S.hyd */
const asSolver = (st) => ({
  aircraft: st.aircraft, acBusPowered: st.acBusPowered, engines: st.engines,
  hydCtl: { greenElec: st.hydGreenElecOn ? 'on' : 'off', blueElec: st.hydBlueElecOn ? 'on' : 'off',
            yellowElec: st.hydYellowElecOn ? 'on' : 'off' },
  hyd: { systems: { green: { psi: st.hydGreenPsi }, blue: { psi: st.hydBluePsi }, yellow: { psi: st.hydYellowPsi } } },
});

/* The old fields, read from S.hyd */
const fromHyd = () => {
  const sy = S.hyd.systems, edp = (id) => Object.entries(sy[id].pumps).some(([k, p]) => k.endsWith('Edp') && p.running);
  return { hydGreenPsi: sy.green.psi, hydBluePsi: sy.blue.psi, hydYellowPsi: sy.yellow.psi,
           hydGreenEdp: edp('green'), hydBlueEdp: edp('blue'), hydYellowEdp: edp('yellow') };
};
const FIELDS = ['hydGreenPsi', 'hydBluePsi', 'hydYellowPsi', 'hydGreenEdp', 'hydBlueEdp', 'hydYellowEdp'];

for (const [name, make] of [
  ['four engines — the default from the engine count', () => { const a = load('a340'); delete a.hydraulics; return a; }],
  ['A220', () => load('a220')],
  ['737', () => load('b737')],
  ['A350', () => load('a350')],
]) {
  test(`the solver gives the old fields for every state — ${name}`, () => {
    const ac = make(), rnd = seeded(name.length * 7919);
    for (let k = 0; k < 400; k++) {
      const st = randomState(ac, rnd);
      for (const dt of [1 / 60, 0.5]) {
        const want = oracle(st, dt);
        setState(asSolver(st));
        tickHydraulics(dt);
        const got = fromHyd();
        for (const f of FIELDS) assert.equal(got[f], want[f], `${name}, state ${k}, dt ${dt}: ${f}`);
      }
    }
  });
}

test('the controls: defaults by role, changed through hydPump', () => {
  setState({ aircraft: load('a350'), hydCtl: {} });                // the default layout
  assert.equal(hydCtl('greenEdp'), 'on');                          // primary
  assert.equal(hydCtl('blueElec'), 'off');                         // standby
  hydPump('blueElec', 'on');
  assert.equal(hydCtl('blueElec'), 'on');
  assert.equal(S.hydCtl.blueElec, 'on');
  setState({ aircraft: load('a340'), hydCtl: {} });
  assert.equal(hydCtl('gElec'), 'auto');                           // demand
});

test('a demand pump in AUTO runs only while its system\'s primary pumps deliver nothing', () => {
  const layout = { systems: [{ id: 'L', psi: 3000, pumps: [
    { id: 'edp', type: 'edp', driver: 'eng1', role: 'primary' }, { id: 'dem', type: 'acmp', role: 'demand' } ] }] };
  const ac = { engine: { type: 'turbofan', count: 2 }, hydraulics: layout };
  setState({ aircraft: ac, hydCtl: {}, acBusPowered: true, engines: [{ core: 95 }, { core: 95 }] });
  assert.deepEqual(solvePumps(), { edp: true, dem: false });
  setState({ engines: [{ core: 0 }, { core: 95 }] });              // ENG 1 lost
  assert.deepEqual(solvePumps(), { edp: false, dem: true });
  hydPump('dem', 'off');
  assert.deepEqual(solvePumps(), { edp: false, dem: false });
  hydPump('dem', 'on');
  setState({ engines: [{ core: 95 }, { core: 95 }] });
  assert.deepEqual(solvePumps(), { edp: true, dem: true });        // ON: runs with the primary too
});

test('the schema catches a layout that names an engine or a bus that does not exist, or a pump twice', () => {
  const a = load('a340');
  a.hydraulics.systems[0].pumps[0].driver = 'eng7';
  a.hydraulics.systems[1].pumps[0].bus = 'nowhere';
  a.hydraulics.systems[2].pumps[1].id = 'gElec';
  const errs = check(a, aircraftSchema);
  assert.ok(errs.some(e => e.includes('driver "eng7" is not an engine')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('unknown bus "nowhere"')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('"gElec" used twice')), errs.join('\n'));
});

test('without a layout in the file a turbofan gets the default', () => {
  assert.equal(hydraulicsLayout(load('a350')).systems.map(s => s.id).join(), 'green,blue,yellow');
});

test('the view the pages read: pump states and labels, LO below 5/6 of nominal, the caution below 1/6', () => {
  const layout = { systems: [
    { id: 'C', label: 'C', psi: 3000, pumps: [
      { id: 'c1', type: 'acmp', role: 'primary' }, { id: 'c2', type: 'acmp', role: 'primary' },
      { id: 'a1', type: 'adp', role: 'demand' }, { id: 'rat', type: 'rat' } ] },
    { id: 'X', psi: 5000, pumps: [{ id: 'x', type: 'acmp', role: 'standby' }] } ] };
  const ac = { engine: { type: 'turbofan', count: 2 }, hydraulics: layout };
  setState({ aircraft: ac, hydCtl: { c2: 'on' }, acBusPowered: true, engines: [{ core: 95 }, { core: 95 }],
             ratDeployed: false, hyd: null });
  tickHydraulics(1 / 60);
  setState({ hyd: { systems: { C: { ...S.hyd.systems.C, psi: 2400 }, X: { ...S.hyd.systems.X, psi: 800 } } } });
  const [c, x] = hydView();
  assert.deepEqual(c.pumps.map(p => [p.label, p.state]), [['ELEC 1', 'run'], ['ELEC 2', 'run'], ['AIR', 'avail'], ['RAT', 'off']]);
  assert.equal(x.label, 'X');                                      // the id when no label
  assert.deepEqual(x.pumps.map(p => p.state), ['off']);
  assert.ok(c.lo && !c.lost, 'C: 2400 of 3000 — amber, no caution');
  assert.ok(x.lo && x.lost, 'X: 800 of 5000 — below 1/6, the caution');
  setState({ acBusPowered: false });
  tickHydraulics(1 / 60);
  assert.equal(hydView()[0].pumps[0].state, 'fault', 'switched on, no AC power');
});

/* ── The 777's layout against its source ([H1] FAA-H-8083-31B ch. 12, in the layout's sources_doc) ── */
const b777 = load('b777-300er');
const elecUp = (l = true, r = true) => ({ buses: { lMain: { powered: l }, rMain: { powered: r } } });
const run777 = (over = {}) => {
  setState({ aircraft: b777, hydCtl: {}, ratDeployed: false, apuState: 'off', elec: elecUp(),
             engines: [{ core: 95 }, { core: 95 }], hyd: null, ...over });
  return solvePumps();
};

test('777 [H1]: three systems L, C, R at 3000 psi — 2 EDP, 4 ACMP, 2 ADP, 1 RAT', () => {
  const l = hydraulicsLayout(b777);
  assert.deepEqual(l.systems.map(s => [s.id, s.psi]), [['L', 3000], ['C', 3000], ['R', 3000]]);
  const all = l.systems.flatMap(s => s.pumps.map(p => p.type)), n = (t) => all.filter(x => x === t).length;
  assert.deepEqual([n('edp'), n('acmp'), n('adp'), n('rat')], [2, 4, 2, 1]);
  assert.ok(l.sources_doc[0].includes('FAA-H-8083-31B'));
});

test('777 [H1]: normally the EDPs drive L and R, C1 and C2 drive C; the demand pumps stand by', () => {
  assert.deepEqual(run777(), { lEdp: true, lAcmp: false, c1Acmp: true, c2Acmp: true, c1Adp: false, c2Adp: false, rat: false,
                               rEdp: true, rAcmp: false });
});

test('777: ENG 1 lost — only the L EDP stops, the L ELEC demand pump takes over', () => {
  const r = run777({ engines: [{ core: 0 }, { core: 95 }] });
  assert.equal(r.lEdp, false);
  assert.equal(r.lAcmp, true);
  assert.equal(r.rEdp, true);
  assert.equal(r.rAcmp, false);
  assert.ok(r.c1Acmp && r.c2Acmp && !r.c1Adp && !r.c2Adp, 'C unaffected');
});

test('777: no AC on the mains — C1 / C2 stop, the air-driven pumps take over on bleed air', () => {
  const r = run777({ elec: elecUp(false, false) });
  assert.ok(!r.c1Acmp && !r.c2Acmp && r.c1Adp && r.c2Adp);
  const cold = run777({ elec: elecUp(false, false), engines: [{ core: 0 }, { core: 0 }] });
  assert.ok(!cold.c1Adp && !cold.c2Adp, 'no engine, no APU — no bleed air');
  assert.ok(run777({ elec: elecUp(false, false), engines: [{ core: 0 }, { core: 0 }], apuState: 'running' }).c1Adp, 'the APU\'s bleed');
});

test('777 [H1]: the RAT\'s pump runs once the RAT is deployed', () => {
  assert.equal(run777({ ratDeployed: true, engines: [{ core: 0 }, { core: 0 }], elec: elecUp(false, false) }).rat, true);
});

/* ── The A340's layout against its source ([A1] AAIB report 4/2000, G-VSKY, §1.6.5.1) ── */
const a340 = load('a340');
const run340 = (cores, over = {}) => {
  setState({ aircraft: a340, hydCtl: {}, ratDeployed: false, acBusPowered: true,
             engines: cores.map(core => ({ core })), hyd: null, ...over });
  return solvePumps();
};

test('A340 [A1]: GREEN on ENG 1 and 4, BLUE on ENG 2, YELLOW on ENG 3; an electric pump each; the RAT on GREEN; 1450 psi', () => {
  const l = hydraulicsLayout(a340);
  const edps = Object.fromEntries(l.systems.map(s => [s.id, s.pumps.filter(p => p.type === 'edp').map(p => p.driver)]));
  assert.deepEqual(edps, { green: ['eng1', 'eng4'], blue: ['eng2'], yellow: ['eng3'] });
  for (const s of l.systems) {
    assert.equal(s.psi, 3000); assert.equal(s.loPsi, 1450);
    assert.equal(s.pumps.filter(p => p.type === 'acmp').length, 1, `${s.id}: one electric pump`);
  }
  assert.deepEqual(l.systems.filter(s => s.pumps.some(p => p.type === 'rat')).map(s => s.id), ['green']);
  assert.ok(l.sources_doc[0].includes('4/2000'));
});

test('A340: all engines running — the engine pumps; the electric pumps stand by', () => {
  assert.deepEqual(run340([95, 95, 95, 95]), { gEdp1: true, gEdp4: true, gElec: false, rat: false, bEdp2: true, bElec: false,
                                               yEdp3: true, yElec: false });
});

test('A340: one GREEN engine lost — the other keeps GREEN; ENG 1 and 4 lost — G ELEC takes over [A1]', () => {
  const one = run340([0, 95, 95, 95]);
  assert.ok(!one.gEdp1 && one.gEdp4 && !one.gElec);
  const both = run340([0, 95, 95, 0]);
  assert.ok(!both.gEdp1 && !both.gEdp4 && both.gElec, 'braking and steering with ENG 1 and 4 shut down');
  assert.ok(both.bEdp2 && both.yEdp3);
});

test('A340: ENG 2 lost — B ELEC, the only other way to pressurise BLUE [A1]; ENG 3 lost — Y ELEC', () => {
  assert.ok(run340([95, 0, 95, 95]).bElec);
  assert.ok(run340([95, 95, 0, 95]).yElec);
});

test('A340: the LO caution below 1450 psi, not 1/6 of nominal', () => {
  setState({ aircraft: a340, hydCtl: {}, hyd: { systems: { green: { psi: 1400 }, blue: { psi: 1500 }, yellow: { psi: 3000 } } } });
  assert.deepEqual(hydView().map(s => [s.id, s.lost]), [['green', true], ['blue', false], ['yellow', false]]);
});
