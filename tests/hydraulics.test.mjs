/**
 * Hydraulics — the generic solver over the layout (core/hydraulics.js) against the logic it replaced.
 *
 * oracle() is the old tickHydraulics() (until 2026-11-04: the A340's three systems hard-coded for
 * every turbofan, the electric pump switches in single fields), kept here as a pure function. For
 * the A340 (its layout in aircraft/a340.json, and the default built from the engine count), the
 * A220, the 737 and the A350, random engine / AC power / switch / pressure states go through both;
 * every pressure and engine-pump state the old code wrote must come out the same in S.hyd. Then the
 * controls and the roles, and the 777's layout against its source.
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
  ['A340 — its layout in aircraft/a340.json', () => load('a340')],
  ['A340 — the default from the engine count', () => { const a = load('a340'); delete a.hydraulics; return a; }],
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

test('the A340 layout in its file is the default for four engines', () => {
  const a = load('a340');
  const strip = (l) => JSON.parse(JSON.stringify(l, (k, v) => k.startsWith('_') ? undefined : v));
  assert.deepEqual(strip(a.hydraulics), strip(defaultLayout(a)));
});

test('the controls: defaults by role, changed through hydPump', () => {
  setState({ aircraft: load('a340'), hydCtl: {} });
  assert.equal(hydCtl('greenEdp'), 'on');                          // primary
  assert.equal(hydCtl('blueElec'), 'off');                         // standby
  hydPump('blueElec', 'on');
  assert.equal(hydCtl('blueElec'), 'on');
  assert.equal(S.hydCtl.blueElec, 'on');
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
  a.hydraulics.systems[2].pumps[1].id = 'greenElec';
  const errs = check(a, aircraftSchema);
  assert.ok(errs.some(e => e.includes('driver "eng7" is not an engine')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('unknown bus "nowhere"')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('"greenElec" used twice')), errs.join('\n'));
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
