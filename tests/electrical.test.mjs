/**
 * Electrical — the generic solver over the layout (core/electrical.js) against the logic it replaced.
 *
 * oracle() is the old tickElectrical() (until 2026-10-21: the A340's structure hard-coded for every
 * turbofan), kept here as a pure function. For the A340 (its layout in aircraft/a340.json, and the
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
import { tickElectrical, solveElectrical, electricalLayout, defaultLayout } from '../core/electrical.js';
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
      setState({ ...st, elec: null });
      tickElectrical(0.5);
      for (const f of FIELDS) assert.deepEqual(S[f], want[f], `${name}, state ${k}: ${f}`);
      for (const b of [1, 2, 3]) if (want[`bat${b}Charge`] !== undefined)
        assert.equal(S[`bat${b}Charge`], want[`bat${b}Charge`], `${name}, state ${k}: bat${b}Charge`);
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
  setState({ aircraft: a, wow: true, busTieAuto: true, apuState: 'off', extPwrOn: false, extPwrBOn: false,
             idgConnected: [true, true, true, true], engGenSwitch: [true, true, true, true],
             engines: [{ core: 60 }, { core: 0 }, { core: 0 }, { core: 0 }], bat1On: false, bat2On: false, bat3On: false });
  const e = solveElectrical(electricalLayout(a));
  assert.equal(e.buses.ac11.fedBy, 'gen1');
  assert.equal(e.buses.ac12.fedBy, 'ac11');                        // through the bus tie
  assert.equal(e.buses.dc2.fedBy, 'ac24');
  setState({ busTieAuto: false });
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
