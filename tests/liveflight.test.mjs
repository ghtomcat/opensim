/**
 * Live flight (core/liveflight.js): a tracked flight's speeds — gs, its ground speed as ADS-B reports it, and ias, the
 * indicated airspeed the sim flies: the ground speed taken as the true airspeed (no wind is known) at its altitude.
 * Was: the ground speed loaded as the indicated airspeed — 480 kt at FL350, about M 1.4.
 *
 * Run:  node --test tests/liveflight.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAdsbFi, normaliseOpenSky } from '../core/liveflight.js';
import { iasOfTas, tasKt, machOf } from '../core/airdata.js';

test('iasOfTas is tasKt\'s inverse — 480 kt true at FL350 is ~267 kt indicated; equal at sea level', () => {
  for (const alt of [0, 10000, 35000, 41000]) assert.ok(Math.abs(tasKt(iasOfTas(480, alt), alt) - 480) < 1e-9);
  assert.ok(Math.abs(iasOfTas(480, 35000) - 267.2) < 0.5);
  assert.equal(iasOfTas(150, 0), 150);
});

test('adsb.fi: gs as reported, ias from it at the altitude — an airliner at FL350 near M .84, not M 1.4', () => {
  const f = normaliseAdsbFi({ r: 'HB-JMD', flight: 'SWR38 ', t: 'A343', lat: 47, lon: 8, alt_baro: 35000, gs: 480, track: 270, baro_rate: 0 });
  assert.equal(f.gs, 480);
  assert.ok(Math.abs(f.ias - iasOfTas(480, 35000)) < 1e-9);
  const m = machOf(f.ias, 35000);
  assert.ok(m > 0.8 && m < 0.86, `${m}`);
  assert.equal(f.spd, undefined);   // no ambiguous speed left
});

test('OpenSky: velocity m/s → gs kt, altitude m → ft, ias from them', () => {
  const s = ['4b1a2b', 'SWR38', 'CH', 0, 0, 8, 47, 10668, false, 246.9, 270, 0];
  const f = normaliseOpenSky(s);
  assert.ok(Math.abs(f.gs - 246.9 * 1.94384) < 1e-9);
  assert.ok(Math.abs(f.ias - iasOfTas(246.9 * 1.94384, 10668 * 3.28084)) < 1e-9);
});
