/**
 * Air data (core/airdata.js) and the MiG-15bis's new panel values (display/analog_panel.js INSTRUMENTS): Mach from the
 * indicated airspeed and altitude, the height above the ground, and the lamps — the 300 l reserve from the entry's
 * `below`, the gear warning, the flaps lamp.
 *
 * Run:  node --test tests/airdata.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { tasKt, machOf, soundSpeedKt, heightAboveGroundFt } from '../core/airdata.js';
import { INSTRUMENTS } from '../display/analog_panel.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIG = JSON.parse(readFileSync(join(here, '..', 'aircraft', 'mig15bis.json'), 'utf8'));

test('ISA: the speed of sound 661 kt at sea level, 573 kt from 11 km; TAS = IAS at sea level', () => {
  assert.ok(Math.abs(soundSpeedKt(0) - 661.5) < 0.5);
  assert.ok(Math.abs(soundSpeedKt(40000) - 573.6) < 0.5);
  assert.equal(tasKt(300, 0), 300);
});

test('Mach: 0.45 at 300 kt at sea level; higher for the same IAS up high (the MiG at 10 km, 350 km/h IAS ≈ M 0.55)', () => {
  assert.ok(Math.abs(machOf(300, 0) - 0.4535) < 0.002);
  const m = machOf(350 / 1.852, 32800);
  assert.ok(m > 0.5 && m < 0.6, `${m}`);
});

test('the height above the ground: over the terrain, else over the departure field', () => {
  setState({ alt: 1361, terrainElevFt: 361 });
  assert.equal(heightAboveGroundFt(), 1000);
  setState({ terrainElevFt: null, mission: { departure: { elevation: 361 } } });
  assert.equal(heightAboveGroundFt(), 1000);
});

test('the MiG\'s lamps: the 300 l reserve (`below`), the gear warning with the throttle back, the flaps fully down', () => {
  setState({ aircraft: MIG, engineState: 'running', fuelLeft: 299, fuelRight: 0 });
  assert.equal(INSTRUMENTS.fuelLow.read(0, { below: 300 }), true);
  assert.equal(INSTRUMENTS.fuelLow.read(0, {}), false, 'without `below`: the old 40 l');
  setState({ gearAnim: 0, spdT: 0 });
  assert.equal(INSTRUMENTS.gearWarn.read(0), true, 'gear up, throttle back');
  setState({ spdT: MIG.envelope.maxSpd });
  assert.equal(INSTRUMENTS.gearWarn.read(0), false, 'gear up at full throttle');
  setState({ flaps: MIG.flaps.length - 1 });
  assert.equal(INSTRUMENTS.flapsOut.read(0), true);
  setState({ flaps: 0 });
  assert.equal(INSTRUMENTS.flapsOut.read(0), false);
});

test('the КУС-1200 reads the true airspeed too; the plain airspeed dial just the IAS', () => {
  setState({ spd: 300, alt: 32800 });
  const v = INSTRUMENTS.asi.read(0, { variant: 'kus' });
  assert.equal(v.kt, 300);
  assert.ok(v.tas > 480, `${v.tas}`);
  assert.equal(INSTRUMENTS.asi.read(0, {}), 300);
});
