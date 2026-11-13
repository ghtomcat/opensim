/**
 * The turbojet's fuel flow (core/engine.js, S.engines[i].ff) and its burn from the tank (core/fuel.js): the MiG-15bis's
 * VK-1 burns ffMax (2 890 kg/h, 26.5 kN × 109.1 kg/(kN·h)) at full rpm, far less at idle and in thin air, nothing when
 * stopped — the tank (1 400 l, 0.83 kg/l) empties with the throttle, not at a fixed rate.
 *
 * Run:  node --test tests/turbojet-fuel.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { S, setState } from '../core/state.js';
import { adoptEngineFields, tickEngine, fuelFlowKgH } from '../core/engine.js';
import { initFuel, tickFuel } from '../core/fuel.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIG = JSON.parse(readFileSync(join(here, '..', 'aircraft', 'mig15bis.json'), 'utf8'));

/** The MiG with its engine in `state`, the throttle at `thr` (0–1), at `alt` ft, a full tank */
function mig(state, thr, alt = 0) {
  const patch = { aircraft: MIG, engineState: state, engineStartT: null, engineStopT: null, enginePower: state === 'running' ? 1 : 0,
                  n1: 0, engineFactors: { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 },
                  lever: thr, alt, crashed: false, paused: false };
  setState({ engines: [], ...patch });
  adoptEngineFields(patch);
  initFuel();
  tickEngine(0.01);
}

test('full thrust at sea level: ffMax, 2 890 kg/h', () => {
  mig('running', 1);
  assert.ok(Math.abs(fuelFlowKgH() - 2890) < 5, `${fuelFlowKgH()}`);
  assert.equal(Math.round(S.engines[0].ff), Math.round(fuelFlowKgH()));
});

test('idle burns far less; thin air less again; a stopped engine nothing', () => {
  mig('running', 0);
  assert.ok(fuelFlowKgH() < 0.1 * 2890, `idle: ${fuelFlowKgH()}`);
  mig('running', 1, 33000);
  assert.ok(fuelFlowKgH() < 0.7 * 2890 && fuelFlowKgH() > 0.4 * 2890, `full at 10 km: ${fuelFlowKgH()}`);
  mig('off', 0);
  assert.equal(fuelFlowKgH(), 0);
});

test('the tank empties with the flow: a minute at full thrust ≈ 2 890 / 60 / 0.83 ≈ 58 l', () => {
  mig('running', 1);
  assert.equal(S.fuelLeft, 1400);
  for (let i = 0; i < 600; i++) tickFuel(0.1);
  const used = 1400 - S.fuelLeft;
  assert.ok(Math.abs(used - 2890 / 60 / 0.83) < 1, `used ${used.toFixed(1)} l`);
});

test('a minute at idle uses a fraction of that', () => {
  mig('running', 0);
  for (let i = 0; i < 600; i++) tickFuel(0.1);
  assert.ok(1400 - S.fuelLeft < 6, `used ${(1400 - S.fuelLeft).toFixed(1)} l`);
});

/* The pistons: the same curve on their rpm, ffMax = fuelBurn (l/h at full power) × the fuel's density — so the tank
   empties by fuelBurn × (rpm / maxRpm)^2.2 litres an hour (issues.md, "The light aircraft's fuel burn ignores the throttle") */
function piston(id, state, lever) {
  const ac = JSON.parse(readFileSync(join(here, '..', 'aircraft', `${id}.json`), 'utf8'));
  const patch = { aircraft: ac, engineState: state, engineStartT: null, engineStopT: null, enginePower: state === 'running' ? 1 : 0,
                  n1: 0, engineFactors: { failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 },
                  lever, alt: 0, crashed: false, paused: false, fuelShutoff: false };
  setState({ engines: [], ...patch });
  adoptEngineFields(patch);
  initFuel();
  tickEngine(0.01);
  return ac;
}
const litresPerHour = () => { const before = (S.fuelLeft ?? 0) + (S.fuelRight ?? 0); tickFuel(60); return ((before - S.fuelLeft - S.fuelRight) * 60); };

test('a piston burns with its lever: full lever its fuelBurn, idle a fraction — the C172, the DR400, the Bf 109, the F4U', () => {
  for (const id of ['c172', 'robin-dr400', 'bf109', 'f4u1a']) {
    const ac = piston(id, 'running', 1);
    assert.ok(Math.abs(litresPerHour() - ac.fuelBurn) < 0.01 * ac.fuelBurn, `${id}: full lever burns fuelBurn ${ac.fuelBurn} l/h`);
    piston(id, 'running', 0);
    const idle = litresPerHour(), expect = ac.fuelBurn * Math.pow(ac.engine.idleRpm / ac.engine.maxRpm, 2.2);
    assert.ok(Math.abs(idle - expect) < 0.02 * ac.fuelBurn, `${id}: idle ${idle.toFixed(2)} l/h, expected ≈ ${expect.toFixed(2)}`);
    assert.ok(idle < 0.1 * ac.fuelBurn, `${id}: idle a fraction of take-off`);
    piston(id, 'off', 1);
    assert.equal(fuelFlowKgH(), 0, `${id}: a stopped engine burns nothing`);
  }
});
