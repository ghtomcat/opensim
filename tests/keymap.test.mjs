/**
 * The key map — core/keymap.js: one table, one dispatcher, and everything said about the keys is
 * generated from it. Browser side (every action really registered, real key events): keymap.spec.js.
 *
 * Run:  node --test tests/keymap.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { KEYS, keyList, registerActions, setKeyContext, onFirstKey, observeKeys, isKeyHeld, dispatchKeyDown, dispatchKeyUp } from '../core/keymap.js';
import { S } from '../core/state.js';
import { allAircraft, withTables } from '../tools/keybindings.mjs';

const AC = Object.fromEntries(allAircraft().map(a => [a.id, a]));
const row = (id, key) => keyList(AC[id]).find(k => k.key === key)?.desc;
const key = (k, o = {}) => ({ key: k, target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; }, ...o });

test('the default mistakes are gone: what the map says, the keys do', () => {
  for (const id of ['a340', 'b777-300er', 'c172', 'robin-dr400', 'avro504']) {
    const rows = keyList(AC[id]);
    assert.ok(!rows.some(r => /Altitude target|Heading target/.test(r.desc)), `${id}: the arrows are the stick`);
    assert.match(rows[0].desc, /Stick/);
  }
  assert.match(row('dc8', '↑ ↓'), /Altitude target/);               // the one kinematic aircraft
  assert.match(row('a340', '+ −'), /Thrust lever/);
  assert.match(row('c172', '+ −'), /Throttle/);
});

test('each aircraft is told how it starts and how it stops', () => {
  assert.match(row('a340', 'D'), /pedestal/);                        // no start key on an airliner
  assert.equal(row('a340', 'E'), undefined);
  assert.match(row('a340', 'Q'), /Fuel cutoff/);
  assert.match(row('c172', 'E'), /battery/);
  assert.match(row('c172', 'Q'), /Fuel selector/);
  assert.match(row('f4u1a', 'E'), /Engine start/);
  assert.match(row('mig15bis', 'Q'), /cutoff/);
  assert.match(row('velis-hb-syc', 'Panel'), /PWR EN/);
  assert.equal(row('avro504', 'E'), undefined);                      // no start sequence
  assert.equal(row('avro504', 'Q'), undefined);
});

test('a key that does nothing here is not offered', () => {
  assert.equal(row('c172', 'Tab'), undefined);
  assert.match(row('a340', 'Tab'), /ECAM/);
  assert.equal(row('a340', 'w'), undefined);                         // time warp: rockets
  assert.match(row('falcon1', 'w'), /Time warp/);
  assert.equal(row('c172', 'O'), undefined);
  assert.equal(row('bf109', 'M'), undefined);                        // its own list used to say M stops the engine
  assert.equal(row('avro504', 'H') !== undefined, !!AC.avro504.hasCarbHeat);
});

test('the Bf 109 keeps its German, by action', () => {
  assert.match(row('bf109', 'E'), /Anlasser/);
  assert.match(row('bf109', 'Q'), /Kraftstoffhahn/);
  assert.match(row('bf109', 'G'), /Fahrwerk/);
});

test('every keyLabels entry names a real action', () => {
  const ids = new Set(KEYS.map(k => k.id));
  for (const a of Object.values(AC)) for (const id of Object.keys(a.keyLabels ?? {})) assert.ok(ids.has(id), `${a.id}: ${id}`);
});

test('rockets and robots have their keys listed too, for the popup', () => {
  assert.match(row('falcon1', 'J'), /next event/);
  assert.match(row('so101', 'Space'), /Gripper/);
  assert.match(row('yertle', 'H'), /Home/);
  for (const a of Object.values(AC)) assert.ok(keyList(a).some(k => k.key === '?'), a.id);
});

test('on no aircraft do two listed bindings claim one key', () => {
  for (const a of Object.values(AC)) {
    if (a.vehicleType?.startsWith('robot')) continue;                // their jog keys depend on a mode
    const seen = new Map();
    for (const b of KEYS) {
      if (!b.show || b.info || b.mod || (b.when && !b.when(a, null)) || (b.listed && !b.listed(a))) continue;
      for (const k of b.keys) {
        assert.ok(!seen.has(k), `${a.id}: ${JSON.stringify(k)} is both ${seen.get(k)} and ${b.id}`);
        seen.set(k, b.id);
      }
    }
  }
});

test('docs/keybindings.md is what the table generates', () => {
  const doc = readFileSync(new URL('../docs/keybindings.md', import.meta.url), 'utf8');
  assert.equal(doc, withTables(doc, Object.values(AC)), 'run: node tools/keybindings.mjs');
});

test('one keydown listener: nothing else binds a key', () => {
  const files = [
    ...['core', 'display', 'app'].flatMap(d => readdirSync(new URL(`../${d}/`, import.meta.url))
      .filter(f => f.endsWith('.js') && !f.endsWith('-processor.js')).map(f => `${d}/${f}`)),
    'index.html',
  ];
  const found = files.flatMap(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n')
    .filter(l => /addEventListener\(\s*'key(down|up)'/.test(l)).map(l => `${f}: ${l.trim().slice(0, 60)}`));
  assert.deepEqual(found.map(f => f.split(':')[0]).sort(),
    ['core/audio.js', 'core/keymap.js', 'core/keymap.js', 'index.html'], found.join('\n'));   // the wake-up, down + up, the search box
  assert.ok(found.some(f => f.includes('ms-live-input')));
});

/* ── The dispatcher ── */
let ran;
beforeEach(() => {
  ran = [];
  S.aircraft = { id: 't', manualControl: true, views: [], engine: { type: 'piston' }, sound: { engineType: 'rotary-9' } };
  S.mission = { id: 'm' };
  S.paused = false;
  setKeyContext('flight');
  onFirstKey(null);
  for (const b of KEYS) if (!b.hold && !b.noop && !b.info) registerActions({ [b.id]: () => ran.push(b.id) });
});

test('a key runs one action: the first binding that applies', () => {
  dispatchKeyDown(key('p'));
  assert.deepEqual(ran, ['pause']);
  ran.length = 0;
  S.aircraft = { ...S.aircraft, vehicleType: 'robot-arm' };
  dispatchKeyDown(key('x'));
  assert.deepEqual(ran, ['arm-keys']);                               // not the audio switch as well
});

test('a condition decides', () => {
  dispatchKeyDown(key('w'));
  assert.deepEqual(ran, []);
  S.aircraft = { ...S.aircraft, vehicleType: 'rocket' };
  dispatchKeyDown(key('w'));
  assert.deepEqual(ran, ['warp-up']);
});

test('Caps Lock: letter keys work in both cases, unless case is the meaning', () => {
  dispatchKeyDown(key('G')); dispatchKeyDown(key('R'));
  assert.deepEqual(ran, ['gear', 'role']);
  ran.length = 0;
  dispatchKeyDown(key('f')); dispatchKeyDown(key('F'));
  assert.deepEqual(ran, ['flaps-extend', 'flaps-retract']);
});

test("browser shortcuts stay the browser's", () => {
  dispatchKeyDown(key('r', { metaKey: true }));                      // Cmd+R
  dispatchKeyDown(key('l', { ctrlKey: true }));                      // Ctrl+L
  assert.deepEqual(ran, []);
  dispatchKeyDown(key('L', { ctrlKey: true, shiftKey: true }));
  assert.deepEqual(ran, ['telemetry']);
});

test('keys belong to a text field while typing, except Esc', () => {
  const t = { target: { tagName: 'TEXTAREA' } };
  dispatchKeyDown(key('k', t)); dispatchKeyDown(key('p', t)); dispatchKeyDown(key('ArrowUp', t));
  assert.deepEqual(ran, []);
  assert.equal(isKeyHeld('ArrowUp'), false);
  dispatchKeyDown(key('Escape', t));
  assert.deepEqual(ran, ['back']);
});

test('each screen has its own keys', () => {
  setKeyContext('none');
  dispatchKeyDown(key('p')); dispatchKeyDown(key('Escape'));
  assert.deepEqual(ran, []);
  setKeyContext('briefing');
  dispatchKeyDown(key('p')); dispatchKeyDown(key('Enter')); dispatchKeyDown(key('Escape'));
  assert.deepEqual(ran, ['briefing-fly', 'briefing-back']);
});

test('the first key: swallowed under the key map, passed on without one', () => {
  let first = 0;
  onFirstKey(() => first++, { swallow: true });
  dispatchKeyDown(key('p'));
  assert.equal(first, 1);
  assert.deepEqual(ran, []);                                         // it only closed the key map
  dispatchKeyDown(key('p'));
  assert.deepEqual(ran, ['pause']);
  ran.length = 0;
  onFirstKey(() => first++);
  dispatchKeyDown(key('p'));                                         // no key map: this P pauses
  assert.equal(first, 2);
  assert.deepEqual(ran, ['pause']);
});

test('held keys, the up half of an action, and observers', () => {
  const e = key('b');
  let up = 0, seen = [];
  registerActions({ brakes: { down: () => ran.push('down'), up: () => up++ } });
  const stop = observeKeys(k => seen.push(k.key));
  dispatchKeyDown(e);
  assert.equal(isKeyHeld('b'), true);
  dispatchKeyUp(e);
  assert.equal(isKeyHeld('b'), false);
  assert.deepEqual([ran, up, seen], [['down'], 1, ['b']]);
  stop();
});

test('PTT ignores auto-repeat; Tab never moves the focus', () => {
  const r = key(' ', { repeat: true });
  dispatchKeyDown(r);
  assert.deepEqual(ran, []);
  assert.equal(r.prevented, true);                                    // and the page doesn't scroll
  const t = key('Tab');
  dispatchKeyDown(t);
  assert.equal(t.prevented, true);
});
