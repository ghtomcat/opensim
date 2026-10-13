/**
 * Elevation — core/elevation.js owns the DEM tile cache, so core/ no longer depends on display/.
 * No browser: tiles can't be fetched in Node, so every sample is null — what matters here is that
 * the simulation modules load without browser globals and that the tick writes the null through.
 *
 * Run:  node --test tests/elevation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { S, setState } from '../core/state.js';
import { elevM, tickElevation } from '../core/elevation.js';

test('core/ imports nothing from display/', () => {
  for (const f of readdirSync(new URL('../core/', import.meta.url)).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(new URL(`../core/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /(from|import\()\s*['"][^'"]*display\//, `core/${f} imports from display/`);
  }
});

test('core/crew.js (EGPWS) loads in Node', async () => {
  await import('../core/crew.js');
});

test('elevM is null without a browser, and stays null', () => {
  assert.equal(elevM(47.46, 8.55), null);
  assert.equal(elevM(47.46, 8.55), null);
  assert.equal(elevM(89.9, 0), null);   // off the tile grid
});

test('tickElevation writes the sample under the aircraft to S.terrainElevFt', () => {
  setState({ lat: 46.5, lon: 7.9, terrainElevFt: 1234 });
  tickElevation();
  assert.equal(S.terrainElevFt, null);
});
