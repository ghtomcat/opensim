/**
 * DB 601 synthesis — pure math tests (no browser, no Web Audio)
 *
 * Tests the invariants that keep startup ↔ live-engine gain continuity
 * correct and the key synthesis parameters in range.
 *
 * Run:  node --test tests/db601-synth.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ── Config mirrors aircraft/bf109.json + sound.js ENGINES['v12-supercharged'] ── */
const CFG = {
  masterGain:           0.80,
  rpmIdle:              400,
  rpmMax:               2800,
  superchargerFreqIdle: 700,
  superchargerFreqMax:  2500,
  superchargerGain:     0.45,
};
const SR = 44100;

/* ── Synthesis helpers (mirrored from sound.js / render-startup.mjs) ── */

function synthRunupGearTailEnvAt(t_seconds) {
  /* Returns gearTailEnv at time t seconds into the runup */
  const decay = Math.exp(-1 / (3.0 * SR));
  let env = 0.30;
  const steps = Math.floor(t_seconds * SR);
  for (let i = 0; i < steps; i++) env *= decay;
  return env;
}

function startupScale(masterGain = CFG.masterGain) {
  return (masterGain * 0.4) / 0.8;
}

function workletIdleGain(masterGain = CFG.masterGain) {
  /* _master.gain value after handoff — worklet output × this = signal level */
  return masterGain * 0.4;
}

function synthEndSignalFactor(masterGain = CFG.masterGain) {
  /* Synthesis end-of-runup level factor (the ×0.8 in _synthRunup × scale) */
  return 0.8 * startupScale(masterGain);
}

function laderFreq(rpm, lFIdle = CFG.superchargerFreqIdle, rIdle = CFG.rpmIdle) {
  return lFIdle * rpm / rIdle;
}

function throttleRpm(throttle, ePow = 1.0) {
  return CFG.rpmIdle + (CFG.rpmMax - CFG.rpmIdle) * throttle * ePow;
}

function masterGainAtThrottle(throttle, ePow = 1.0) {
  return CFG.masterGain * (0.4 + 0.6 * throttle) * Math.max(0.05, ePow);
}

/* ── Tests ── */

test('gain chain continuity — synthesis end matches worklet idle', () => {
  /* This is the critical invariant. If it breaks, there will be a volume jump at handoff.
     synthEndSignalFactor = 0.8 × scale
     workletIdleGain      = masterGain × 0.4
     Both must equal masterGain × 0.4 */
  const synthEnd = synthEndSignalFactor();
  const wkltIdle = workletIdleGain();
  assert.ok(
    Math.abs(synthEnd - wkltIdle) < 1e-9,
    `synthesis end (${synthEnd}) must equal worklet idle (${wkltIdle})`
  );
});

test('scale factor formula — (masterGain × 0.4) / 0.8', () => {
  assert.ok(Math.abs(startupScale(0.80) - 0.40) < 1e-9);
  assert.ok(Math.abs(startupScale(0.60) - 0.30) < 1e-9);
  assert.ok(Math.abs(startupScale(1.00) - 0.50) < 1e-9);
});

test('gear tail envelope — starts at 0.30', () => {
  const env = synthRunupGearTailEnvAt(0);
  assert.equal(env, 0.30);
});

test('gear tail envelope — decays to ~1/e at τ = 3 s', () => {
  const env3 = synthRunupGearTailEnvAt(3.0);
  const expected = 0.30 * Math.exp(-1);
  assert.ok(
    Math.abs(env3 - expected) / expected < 0.01,
    `envelope at 3s (${env3.toFixed(4)}) should be ~${expected.toFixed(4)}`
  );
});

test('gear tail envelope — at 9 s (3τ) is ~e⁻³ ≈ 5% of start', () => {
  const env9 = synthRunupGearTailEnvAt(9.0);
  const expected = 0.30 * Math.exp(-3);   // ~0.01494
  assert.ok(
    Math.abs(env9 - expected) / expected < 0.01,
    `gear tail at 9s (${env9.toFixed(5)}) should be ~${expected.toFixed(5)}`
  );
});

test('lader frequency — proportional to RPM', () => {
  /* At idle: lFIdle * rpmIdle / rpmIdle = lFIdle */
  assert.equal(laderFreq(CFG.rpmIdle), CFG.superchargerFreqIdle);
  /* Doubles when RPM doubles */
  assert.equal(laderFreq(CFG.rpmIdle * 2), CFG.superchargerFreqIdle * 2);
});

test('lader frequency — rises with RPM (not constant)', () => {
  const f400  = laderFreq(400);
  const f800  = laderFreq(800);
  const f1200 = laderFreq(1200);
  assert.ok(f400 < f800, 'laderFreq must rise with RPM');
  assert.ok(f800 < f1200);
  assert.equal(f400, 700);
  assert.equal(f800, 1400);
  assert.equal(f1200, 2100);
});

test('throttle → rpm mapping covers full range', () => {
  assert.equal(throttleRpm(0),   CFG.rpmIdle);
  assert.equal(throttleRpm(1),   CFG.rpmMax);
  assert.ok(throttleRpm(0.5) > CFG.rpmIdle);
  assert.ok(throttleRpm(0.5) < CFG.rpmMax);
});

test('master gain increases monotonically with throttle', () => {
  const g0   = masterGainAtThrottle(0);
  const g0_5 = masterGainAtThrottle(0.5);
  const g1   = masterGainAtThrottle(1);
  assert.ok(g0 < g0_5, 'gain must rise with throttle');
  assert.ok(g0_5 < g1);
  assert.ok(g0   > 0, 'never silent at idle');
  assert.ok(g1  <= 1, 'never clips at full throttle');
});

test('master gain at idle = masterGain × 0.4', () => {
  assert.equal(masterGainAtThrottle(0), CFG.masterGain * 0.4);
});

test('startup total duration — flywheel + klonk + motoring + runup + gaps', () => {
  const FW_DUR  = 26.0;
  const KL_DUR  = 0.18;
  const MOT_DUR = 2.8;
  const RUN_DUR = 42.0;
  const GAP     = 0.06;
  const total = FW_DUR + GAP + KL_DUR + GAP + MOT_DUR + GAP + RUN_DUR;
  assert.ok(Math.abs(total - 71.16) < 0.01, `total duration ${total}s should be ~71.16s`);
});

test('worklet resonator tracks firing frequency — different at idle vs cruise', () => {
  const firingFreqAtRpm = (rpm) => Math.min(480, rpm / 60 * 6);
  const fIdle  = firingFreqAtRpm(400);
  const fCruise = firingFreqAtRpm(2000);
  assert.ok(fIdle < fCruise, 'resonator frequency must rise with RPM');
  assert.equal(fIdle,   40);    // 400/60*6 = 40 Hz
  assert.equal(fCruise, 200);   // 2000/60*6 = 200 Hz
});

test('worklet resonator caps at 480 Hz (above 4800 RPM)', () => {
  const firingFreqAtRpm = (rpm) => Math.min(480, rpm / 60 * 6);
  assert.equal(firingFreqAtRpm(4800), 480);
  assert.equal(firingFreqAtRpm(9999), 480);
});
