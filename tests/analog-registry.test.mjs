/**
 * The analog panel's instrument registry (display/analog_panel.js, INSTRUMENTS).
 *
 * The rule (issues.md, "The analog panels draw a borrowed fighter panel"): every drawn instrument
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
import { INSTRUMENTS } from '../display/analog_panel.js';

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

test('the stand-ins are marked: rpm, N1, manifold and oil pressure say what replaces them', () => {
  for (const id of ['rpm', 'n1', 'map', 'oilP']) assert.match(INSTRUMENTS[id].simple ?? '', /\S/, id);
});
