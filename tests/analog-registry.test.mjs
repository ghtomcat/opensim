/**
 * The analog panel's instrument registry (display/analog_panel.js, INSTRUMENTS).
 *
 * The rule (docs/architecture.md §5.2): every drawn instrument
 * reads a sim value, and the value comes from the registry's `read` — never from the drawing code.
 * So no `_draw…` function may read the sim state (`S.…`, except the aircraft's data `S.aircraft`)
 * or the sound code, and every registry entry names its value.
 *
 * Run:  node --test tests/analog-registry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INSTRUMENTS, STYLE_UNITS } from '../display/analog_panel.js';
import { readdirSync } from 'node:fs';
import { INSTRUMENT, valuesOf } from '../core/vocab.js';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'display', 'analog_panel.js'), 'utf8');

/** The body of every top-level `function _draw…`, up to the next top-level function or section */
function drawBodies() {
  const out = {};
  for (const m of src.matchAll(/^function (_draw\w+)\([^)]*\)\s*\{/gm)) {
    const rest = src.slice(m.index + m[0].length);
    const end = rest.search(/^(function |\/\* ═)/m);
    out[m[1]] = end < 0 ? rest : rest.slice(0, end);
  }
  return out;
}

test('no draw function reads the sim state or the sound code — the value comes in as a parameter', () => {
  const bodies = drawBodies();
  assert.ok(Object.keys(bodies).length > 20, 'found the draw functions');
  const bad = [];
  for (const [name, body] of Object.entries(bodies)) {
    if (/\bS\.(?!aircraft\b)/.test(body)) bad.push(`${name}: reads S.…`);
    if (/getRpmValue|getCurrentRpm|ballDeflection/.test(body)) bad.push(`${name}: reads the sound code or yaw.js`);
  }
  assert.deepEqual(bad, []);
});

test('every registry entry names its value, reads it, and draws in at least one unit system', () => {
  for (const [id, def] of Object.entries(INSTRUMENTS)) {
    assert.equal(typeof def.value, 'string', `${id}: value`);
    assert.equal(typeof def.read, 'function', `${id}: read`);
    const units = Object.keys(def.draw ?? {});
    assert.ok(units.length && units.every(u => ['metric', 'imperial'].includes(u)), `${id}: draw per unit system`);
    assert.ok(units.every(u => typeof def.draw[u] === 'function'), `${id}: draw functions`);
  }
});

test('the registry draws exactly the instruments the aircraft data may name (core/vocab.js INSTRUMENT)', () => {
  assert.deepEqual(Object.keys(INSTRUMENTS).sort(), valuesOf(INSTRUMENT).sort());
});

test('every analog aircraft names only instruments its style can draw (a manifold gauge has no metric dial)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'aircraft');
  const bad = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const a = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (a.panel !== 'analog') continue;
    const units = STYLE_UNITS[a.panelStyle];
    for (const g of a.analogPanel.groups) for (const e of [...(g.rows ?? []).flat(), ...(g.perEngine ?? [])])
      if (!INSTRUMENTS[e.id]?.draw[units]) bad.push(`${f}: ${e.id} in ${units}`);
  }
  assert.deepEqual(bad, []);
});

test('the stand-ins are marked and say what replaces them; rpm and N1 are the engine model\'s, no stand-in', () => {
  for (const id of ['map', 'oilP', 'amps', 'fuelOilP', 'pitch', 'airP', 'pulsator']) assert.match(INSTRUMENTS[id].simple ?? '', /\S/, id);
  for (const id of ['rpm', 'n1']) assert.equal(INSTRUMENTS[id].simple, undefined, id);
});

test('the two sourced panels keep to their sources: D-FEML (Bf 109 E-4) and G-EBHB (Avro 504K)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'aircraft');
  const ids = f => JSON.parse(readFileSync(join(dir, f), 'utf8')).analogPanel.groups.flatMap(g => [...(g.rows ?? []).flat(), ...(g.perEngine ?? [])]).map(e => e.id);
  const bf = ids('bf109.json'), avro = ids('avro504.json');
  for (const id of ['ai', 'vsi']) assert.ok(!bf.includes(id), `D-FEML has no ${id} (sources/bf109-panel-notes.md)`);
  for (const id of ['amps', 'fuelOilP', 'gear', 'fuelLow', 'fuel', 'oilT', 'coolant', 'map', 'pitch', 'turn']) assert.ok(bf.includes(id), `D-FEML: ${id}`);
  for (const id of ['ai', 'vsi', 'turn']) assert.ok(!avro.includes(id), `G-EBHB has no ${id} (sources/avro-504k-panel-notes.md)`);
  for (const id of ['airP', 'level', 'pulsator', 'clock', 'rpm']) assert.ok(avro.includes(id), `G-EBHB: ${id}`);
});

test('a variant in the data is one its instrument knows (INSTRUMENTS[id].variants)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'aircraft');
  const bad = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const a = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const g of a.analogPanel?.groups ?? []) for (const e of [...(g.rows ?? []).flat(), ...(g.perEngine ?? [])])
      if (e.variant && !(INSTRUMENTS[e.id].variants ?? []).includes(e.variant)) bad.push(`${f}: ${e.id} has no variant "${e.variant}"`);
  }
  assert.deepEqual(bad, []);
});
