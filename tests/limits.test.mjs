/**
 * The jets' sourced limits (core/limits.js, envelope.vmo / mmo / limitsSource): VMO by altitude, MMO's IAS up high, the
 * lower of the two — read by the A/THR's cap, the PFD's barber pole and the overspeed crash.
 *
 * Run:  node --test tests/limits.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { vmoAt, maxOperatingSpeed } from '../core/limits.js';
import { iasOfMach } from '../core/airdata.js';
import { S, setState } from '../core/state.js';
import { tickThrust } from '../core/thrust.js';
import { runMissionResets } from '../core/lifecycle.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));

test('VMO by altitude: the E190-E2\'s data sheet — 300 kt to 8,000 ft, linearly to 320 at 10,000 ft, then 320', () => {
  const env = load('e190').envelope;
  assert.equal(vmoAt(env, 0), 300);
  assert.equal(vmoAt(env, 8000), 300);
  assert.equal(vmoAt(env, 9000), 310);
  assert.equal(vmoAt(env, 10000), 320);
  assert.equal(vmoAt(env, 25000), 320);
  assert.equal(vmoAt({ vmo: 330 }, 39000), 330);   // one value: at every altitude
  assert.equal(vmoAt({}, 0), null);
});

test('the maximum operating speed: VMO low, MMO\'s IAS up high — the 777 at FL350 is limited by M .89', () => {
  const b777 = load('b777-300er');
  assert.deepEqual(maxOperatingSpeed(b777, 10000), { kt: 330, by: 'VMO' });
  const hi = maxOperatingSpeed(b777, 35000);
  assert.equal(hi.by, 'MMO');
  assert.ok(Math.abs(hi.kt - iasOfMach(0.89, 35000)) < 1e-9);
  assert.equal(maxOperatingSpeed(load('an225'), 30000), null);   // no sourced limit
});

test('every jet with a cruise Mach cruises below its MMO; every limit names its source', () => {
  for (const id of ['a220', 'a340', 'a350', 'b737', 'b737max9', 'b777-300er', 'e190']) {
    const env = load(id).envelope;
    assert.ok(env.cruiseMach < env.mmo, `${id}: M${env.cruiseMach} vs MMO ${env.mmo}`);
    assert.ok(env.limitsSource?.length > 20, `${id}: limitsSource`);
  }
});

test('the A/THR caps a selected speed above the limit — at the MMO a Mach (MACH), at the VMO a speed (SPEED)', () => {
  const a220 = load('a220');
  const run = (alt, spdT) => {   // on the limit — the loop modulates there (far below it, it pins at the lever's ceiling: THR)
    setState({ aircraft: a220, engineState: 'running', athr: true, wow: false, lever: 0.493, alt, spd: maxOperatingSpeed(a220, alt).kt, spdT,
               spdManaged: false, spdMach: false, machT: null, n1: 70, paused: false, crashed: false, gsCaptured: false });
    runMissionResets();
    tickThrust(0.1);
    return S.athrMode;
  };
  assert.equal(run(35000, 300), 'MACH');    // 300 kt selected at FL350 — above M .82 (263 kt): held at the MMO
  assert.equal(run(20000, 345), 'SPEED');   // 345 kt at FL200 — above VMO 330: held at the VMO
});
