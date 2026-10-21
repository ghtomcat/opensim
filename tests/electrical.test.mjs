/**
 * Electrical — the generic solver over the layout (core/electrical.js) against the logic it replaced.
 *
 * oracle() is the old tickElectrical() (until 2026-10-21: the A340's structure hard-coded for every
 * turbofan, its switches in single fields), kept here as a pure function; asControls() hands the same
 * state to the solver as it reads it now (S.elecCtl by element, S.elecCharge). For the A340 (its layout in aircraft/a340.json, and the
 * default built from the engine count), the A220, the 737 and the A350, random switch / engine /
 * battery states go through both; every field the old code wrote must come out the same.
 *
 * Run:  node --test tests/electrical.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { tickElectrical, solveElectrical, electricalLayout, defaultLayout,
         elecCtl, elecSwitch, elecIdgDisconnect, elecBusTie, elecBusTieAuto } from '../core/electrical.js';
import { check } from '../core/schema/check.js';
import { aircraft as aircraftSchema } from '../core/schema/aircraft.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));

/* ── The old logic, as it was (pure: state in, fields out) ── */
function oracle(st, dt) {
  const ac = st.aircraft;
  const n = ac.engine?.count ?? 2;
  const cfgIn = ac.electrical ?? {};
  const cfg = { extPwrB: cfgIn.extPwrB ?? (n >= 4), batCount: cfgIn.batCount ?? (n >= 4 ? 3 : 2) };
  const idgConn = st.idgConnected?.length === n ? st.idgConnected : Array(n).fill(true);
  const genSw   = st.engGenSwitch?.length === n ? st.engGenSwitch : Array(n).fill(true);
  const genMin  = 0.9 * (ac.engine?.coreIdle ?? 60);
  const coreOf  = (i) => st.engines?.[i]?.core ?? 0;
  const engGenOn = Array.from({ length: n }, (_, i) => (idgConn[i] ?? true) && (genSw[i] ?? true) && coreOf(i) >= genMin);
  const apuGenOn = (st.apuState ?? 'off') === 'running' && (st.apuGenSwitch ?? true);
  const wow  = st.wow ?? false;
  const extA = (st.extPwrOn ?? false) && wow;
  const extB = cfg.extPwrB && (st.extPwrBOn ?? false) && wow;
  const tie  = st.busTieAuto ?? true;
  const bat1Live = (st.bat1On ?? false) && (st.bat1Charge ?? 0) > 2;
  const bat2Live = (st.bat2On ?? false) && (st.bat2Charge ?? 0) > 2;
  const bat3Live = (st.bat3On ?? false) && (st.bat3Charge ?? 0) > 2;
  const essentialBusPowered = bat1Live || bat2Live || bat3Live;
  const g1 = engGenOn[0] ?? false, g2 = n >= 2 ? (engGenOn[1] ?? false) : false;
  const g3 = n >= 3 ? (engGenOn[2] ?? false) : false, g4 = n >= 4 ? (engGenOn[3] ?? false) : false;
  const loc11 = g1 || apuGenOn || extA, loc12 = g2 || apuGenOn || extA;
  const loc23 = g3 || apuGenOn || extB, loc24 = g4 || apuGenOn || extB;
  const anyAc = loc11 || loc12 || loc23 || loc24;
  const acBus11 = loc11 || (tie && anyAc), acBus12 = loc12 || (tie && anyAc);
  const acBus23 = (n >= 3) && (loc23 || (tie && anyAc)), acBus24 = (n >= 4) && (loc24 || (tie && anyAc));
  const acEssBus = acBus11 || acBus24 || essentialBusPowered;
  const dcBus1 = acBus11, dcBus2 = (n >= 4) ? acBus24 : acBus12;
  const dcEssBus = dcBus1 || dcBus2 || essentialBusPowered;
  const acBusPowered = acBus11 || acBus12 || acBus23 || acBus24;
  const dcBusPowered = dcBus1 || dcBus2 || dcEssBus;
  const t = st.time ?? 0;
  const genVoltage = Array.from({ length: n }, (_, i) => engGenOn[i] ? +(115 + Math.sin(t * 0.07 + i * 1.7) * 0.3).toFixed(1) : 0);
  const genFreq    = Array.from({ length: n }, (_, i) => engGenOn[i] ? +(400 + Math.sin(t * 0.05 + i * 2.1) * 0.5).toFixed(1) : 0);
  const genLoad    = Array.from({ length: n }, (_, i) => engGenOn[i] ? Math.round(42 + Math.sin(t * 0.03 + i * 0.9) * 8) : 0);
  const out = { apuGenOn, engGenOn, acBus11, acBus12, acBus23, acBus24, acEssBus, dcBus1, dcBus2, dcEssBus,
                essentialBusPowered, acBusPowered, dcBusPowered, genVoltage, genFreq, genLoad };
  for (const [k, src] of [['bat1', acBusPowered], ['bat2', acBusPowered], ['bat3', acEssBus]].slice(0, cfg.batCount)) {
    out[`${k}Charge`] = st[`${k}Charge`];
    if (!(st[`${k}On`] ?? false)) continue;
    const c = st[`${k}Charge`] ?? 100;
    let next = c;
    if (src && c < 100) next = Math.min(100, c + (3.0 / 60) * dt);
    else if (!src)      next = Math.max(0,   c - (0.30 / 60) * dt);
    if (Math.abs(next - c) > 0.001) out[`${k}Charge`] = next;
  }
  return out;
}

/* A seeded random state the cockpit can reach */
function randomState(ac, rnd) {
  const n = ac.engine.count, cfg = { extPwrB: ac.electrical?.extPwrB ?? (n >= 4), batCount: ac.electrical?.batCount ?? (n >= 4 ? 3 : 2) };
  const pick = (p) => rnd() < p;
  const st = {
    aircraft: ac, time: rnd() * 1000, wow: pick(0.5), busTieAuto: pick(0.8),
    apuState: ['off', 'starting', 'running'][Math.floor(rnd() * 3)], apuGenSwitch: pick(0.8),
    idgConnected: Array.from({ length: n }, () => pick(0.9)), engGenSwitch: Array.from({ length: n }, () => pick(0.85)),
    engines: Array.from({ length: n }, () => ({ core: [0, 11, 53.9, 54, 60, 95][Math.floor(rnd() * 6)] })),
    extPwrOn: pick(0.3), extPwrBOn: cfg.extPwrB ? pick(0.3) : false,
  };
  for (let k = 1; k <= 3; k++) {
    st[`bat${k}On`]     = k <= cfg.batCount ? pick(0.6) : false;
    st[`bat${k}Charge`] = [0, 1.5, 2, 2.5, 50, 99.99, 100][Math.floor(rnd() * 7)];
  }
  return st;
}

/* The same state as the solver sees it today: the switches by element (S.elecCtl), the charges (S.elecCharge) */
function asControls(st) {
  const n = st.aircraft.engine.count;
  const elecCtl = { apugen: { on: st.apuGenSwitch }, extA: { on: st.extPwrOn }, extB: { on: st.extPwrBOn },
                    busTie: { on: st.busTieAuto } };
  for (let i = 0; i < n; i++) elecCtl[`gen${i + 1}`] = { on: st.engGenSwitch[i], idg: st.idgConnected[i] };
  const elecCharge = {};
  for (let k = 1; k <= 3; k++) { elecCtl[`bat${k}`] = { on: st[`bat${k}On`] }; elecCharge[`bat${k}`] = st[`bat${k}Charge`]; }
  return { aircraft: st.aircraft, time: st.time, wow: st.wow, apuState: st.apuState, engines: st.engines, elecCtl, elecCharge };
}

function seeded(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

const FIELDS = ['apuGenOn', 'engGenOn', 'acBus11', 'acBus12', 'acBus23', 'acBus24', 'acEssBus', 'dcBus1', 'dcBus2', 'dcEssBus',
                'essentialBusPowered', 'acBusPowered', 'dcBusPowered', 'genVoltage', 'genFreq', 'genLoad'];

for (const [name, make] of [
  ['A340 — its layout in aircraft/a340.json', () => load('a340')],
  ['A340 — the default from the engine count', () => { const a = load('a340'); a.electrical = { extPwrB: true, batCount: 3 }; return a; }],
  ['A220 (twin, 3 batteries)', () => load('a220')],
  ['737 (twin, 2 batteries)', () => load('b737')],
  ['A350 (no electrical block)', () => load('a350')],
]) {
  test(`the solver gives the old fields for every state — ${name}`, () => {
    const ac = make(), rnd = seeded(name.length * 7919);
    for (let k = 0; k < 400; k++) {
      const st = randomState(ac, rnd);
      const want = oracle(st, 0.5);
      setState({ ...asControls(st), elec: null });
      tickElectrical(0.5);
      for (const f of FIELDS) assert.deepEqual(S[f], want[f], `${name}, state ${k}: ${f}`);
      for (const b of [1, 2, 3]) if (want[`bat${b}Charge`] !== undefined)
        assert.equal(S.elecCharge[`bat${b}`], want[`bat${b}Charge`], `${name}, state ${k}: bat${b}Charge`);
    }
  });
}

test('the A340 layout in its file is the default for four engines', () => {
  const a = load('a340');
  const { sources, buses } = defaultLayout({ ...a, electrical: { extPwrB: true, batCount: 3 } });
  assert.deepEqual(a.electrical.sources, sources);
  assert.deepEqual(a.electrical.buses, buses);
});

test('a bus records what feeds it: its own generator, the APU, or a tie', () => {
  const a = load('a340');
  setState({ aircraft: a, wow: true, apuState: 'off', elecCtl: {}, elecCharge: {},       // every switch at its default
             engines: [{ core: 60 }, { core: 0 }, { core: 0 }, { core: 0 }] });
  const e = solveElectrical(electricalLayout(a));
  assert.equal(e.buses.ac11.fedBy, 'gen1');
  assert.equal(e.buses.ac12.fedBy, 'ac11');                        // through the bus tie
  assert.equal(e.buses.dc2.fedBy, 'ac24');
  setState({ elecCtl: { busTie: { on: false } } });
  assert.equal(solveElectrical(electricalLayout(a)).buses.ac12.powered, false);   // tie open — GEN 2 off, no power
});

test('the schema catches a layout that names an element that does not exist', () => {
  const a = load('a340');
  a.electrical.buses[0].feeds.push('gen9');
  a.electrical.sources[0].driver = 'eng7';
  const errs = check(a, aircraftSchema).map(e => String(e));
  assert.ok(errs.some(e => e.includes('feeds from unknown "gen9"')), errs.join('\n'));
  assert.ok(errs.some(e => e.includes('driver "eng7" is not an engine')), errs.join('\n'));
});

/* ── The controls belong to the elements (stage 2d, part 3) ── */

test('the controls: defaults by element type, toggled through the owner', () => {
  setState({ aircraft: load('a340'), wow: true, elecCtl: {}, elecCharge: {} });
  assert.deepEqual(elecCtl('gen1'), { on: true, idg: true });
  assert.deepEqual(elecCtl('apugen'), { on: true });
  assert.deepEqual(elecCtl('bat1'), { on: false });
  assert.deepEqual(elecCtl('extA'), { on: false });
  assert.deepEqual(elecCtl('galley'), { on: true });
  assert.equal(elecBusTieAuto(), true);
  elecSwitch('bat1');
  assert.equal(elecCtl('bat1').on, true);
  elecSwitch('gen2');
  assert.deepEqual(elecCtl('gen2'), { on: false, idg: true });
  elecBusTie();
  assert.equal(elecBusTieAuto(), false);
});

test('external power plugs in on the ground only; an IDG, once disconnected, stays so', () => {
  setState({ aircraft: load('a340'), wow: false, elecCtl: {}, elecCharge: {} });
  elecSwitch('extA');
  assert.equal(elecCtl('extA').on, false);
  setState({ wow: true });
  elecSwitch('extA');
  assert.equal(elecCtl('extA').on, true);
  elecIdgDisconnect('gen3');
  assert.equal(elecCtl('gen3').idg, false);
  elecIdgDisconnect('gen3');
  assert.equal(elecCtl('gen3').idg, false);
  setState({ engines: [{ core: 60 }, { core: 60 }, { core: 60 }, { core: 60 }] });
  assert.equal(solveElectrical(electricalLayout()).sources.gen3.on, false);   // its engine runs — the generator doesn't
});

/* ── The 777's own layout (stage 2d, part 4) — each case from the sources in its file:
   [S1] Andrade & Tenning, IEEE AES Magazine 1992; [S2] Boeing B777 Systems Summary [Electrical] ── */

function b777(patch = {}) {
  const ac = load('b777-300er');
  setState({ aircraft: ac, wow: false, spd: 250, apuState: 'off', elecCtl: {}, elecCharge: {}, ratDeployed: false,
             engines: [{ core: 95 }, { core: 95 }], ...patch });
  return () => solveElectrical(electricalLayout(ac)).buses;
}

test('777: each IDG feeds its main bus, each main its transfer bus, the TRUs the DC buses', () => {
  const b = b777()();
  assert.equal(b.lMain.fedBy, 'genL'); assert.equal(b.rMain.fedBy, 'genR');           // [S2] respective IDG
  assert.equal(b.lXfr.fedBy, 'lMain'); assert.equal(b.rXfr.fedBy, 'rMain');           // [S1] transfer from its main
  assert.equal(b.lMainDc.fedBy, 'lXfr'); assert.equal(b.captFlt.fedBy, 'lXfr');       // [S2] L / C1 TRU on the L XFR
  assert.equal(b.foFlt.fedBy, 'rXfr'); assert.equal(b.acStby.fedBy, 'lXfr');          // [S2] C2 TRU; AC STBY from L XFR
  assert.equal(b.gndSvc.fedBy, 'rMain');                                               // [S2] ground service from R MAIN
});

test('777: ENG 1 lost — the bus ties feed L MAIN from the right IDG, the converter runs on the right backup generator', () => {
  const b = b777({ engines: [{ core: 11 }, { core: 95 }] })();
  assert.equal(b.lMain.fedBy, 'rMain');                                                // [S1] BTBs close: one IDG, both mains
  assert.equal(b.conv.fedBy, 'bkupR');                                                 // [S1] either backup generator to the converter
});

test('777: L BUS TIE in ISLN with ENG 1 lost — L MAIN dead, the backup system feeds the left transfer bus', () => {
  const b = b777({ engines: [{ core: 11 }, { core: 95 }], elecCtl: { lMain: { tie: false } } })();
  assert.equal(b.lMain.powered, false);
  assert.equal(b.lXfr.fedBy, 'conv');                                                  // [S1] main bus lost → backup powers the transfer bus
  assert.equal(b.captFlt.fedBy, 'lXfr');
});

test('777 on the ground: primary external power on R MAIN while the APU feeds L MAIN', () => {
  const b = b777({ wow: true, spd: 0, apuState: 'running', engines: [{ core: 0 }, { core: 0 }],
                   elecCtl: { extPri: { on: true } } })();
  assert.equal(b.rMain.fedBy, 'extPri');                                               // [S1] [S2] primary ext → right main
  assert.equal(b.lMain.fedBy, 'apugen');                                               // [S1] APU and external power at the same time
});

test('777: both transfer buses lost in flight — the RAT deploys and powers the instrument and battery buses', () => {
  b777({ engines: [{ core: 0 }, { core: 0 }], elecCtl: { mainBat: { on: true } } });
  tickElectrical(0.1);
  assert.equal(S.ratDeployed, true);                                                   // [S2] deploys if both AC transfer buses lose power
  tickElectrical(0.1);
  const b = S.elec.buses;
  assert.equal(b.captFlt.fedBy, 'rat'); assert.equal(b.foFlt.fedBy, 'rat');            // [S2] RAT GEN → C1 and C2 TRUs
  assert.equal(b.batBus.fedBy, 'rat');
  b777({ wow: true, spd: 0, engines: [{ core: 0 }, { core: 0 }] });
  tickElectrical(0.1);
  assert.equal(S.ratDeployed, false);                                                  // not on the ground
});

test('777: the APU battery has no switch — its bus is powered from the battery alone', () => {
  const b = b777({ wow: true, spd: 0, engines: [{ core: 0 }, { core: 0 }] })();
  assert.equal(b.apuBatBus.fedBy, 'apuBat');                                           // [S2] APU battery → APU battery bus
  assert.equal(b.hotBat.powered, false);   // BATTERY off — no APU start ([S2]: ON "allows the APU to be started"). Simplified:
                                           // the model routes the main battery through the switch; the real hot battery bus stays connected
});
