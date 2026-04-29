#!/usr/bin/env node
/* Renders three R-2800 idle segments side-by-side for gap analysis.
   Segment 0 (t=0–3s):  startup SYNTHESIS at settled 750 RPM (the reference — sounds good)
   Segment 1 (t=4–7s):  live WORKLET — OLD params (before fix — muddy)
   Segment 2 (t=8–11s): live WORKLET — NEW params (after fix)
   Usage: node scripts/render-r2800-compare.mjs [output.wav] */

import { writeFileSync } from 'fs';

const OUT = process.argv[2] ?? 'audio/r2800_compare.wav';
const SR  = 44100;
const SEG = 3.0;  // seconds per segment
const GAP = 1.0;  // silence between segments

/* ─────────────────────────────────────────────────────────────────────────────
   SEGMENT 0 — Startup synthesis at settled 750 RPM
   Exact port of _synthR2800Runup() from sound.js, run at stable RPM=750.
   resR=0.96, noise LP 900 Hz, output LP 2 kHz, raw*0.05+res*0.95, no crack.
───────────────────────────────────────────────────────────────────────────── */
function renderStartupSynth(rpm = 750) {
  const N = Math.floor(SR * SEG);
  const buf = new Float32Array(N);

  const firingAnglesA = Array.from({ length: 9 }, (_, i) => ((i * 80) + (Math.random() - 0.5) * 10) % 720);
  const firingAnglesB = Array.from({ length: 9 }, (_, i) => ((i * 80 + 20) + (Math.random() - 0.5) * 10) % 720);
  const gainA = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);
  const gainB = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);

  const bangDecayA  = Math.exp(-5500 / SR);
  const bangDecayB  = Math.exp(-4800 / SR);
  const bangAmpA    = new Float32Array(9);
  const bangAmpB    = new Float32Array(9);
  const exhaustAmpA = new Float32Array(9);
  const exhaustAmpB = new Float32Array(9);

  /* Compute stable-RPM filter params */
  const cyclesPerSec   = rpm / 120;
  const firingInterval = SR / (cyclesPerSec * 9);
  const tau            = Math.min(firingInterval * 0.50, SR * 0.022);
  const exhaustDecay   = Math.exp(-1 / tau);
  const overlap        = Math.exp(-firingInterval / tau);
  const noiseScale     = 0.22 * (1 - overlap);

  const omega  = 2 * Math.PI * cyclesPerSec * 9 / SR;
  const resCos = Math.cos(omega);
  const resSin = Math.sin(omega);
  const resR   = 0.96;
  let resX = 0, resY = 0;

  let lfsr = 0xACE1;
  let noiseLp = 0;
  const noiseLpCoeff = Math.exp(-2 * Math.PI * 900 / SR);
  let lpState = 0;
  const lpCoeff = Math.exp(-2 * Math.PI * 2000 / SR);
  let angle = 0;

  /* Warm up 0.5s */
  const warmN = Math.floor(SR * 0.5);
  for (let i = 0; i < warmN; i++) {
    const prev = angle;
    angle = (angle + rpm * 360 / 60 / SR) % 720;
    for (let c = 0; c < 9; c++) {
      const fa = firingAnglesA[c];
      if ((prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle))) {
        bangAmpA[c]    = gainA[c] * 0.10;
        exhaustAmpA[c] = gainA[c] * 0.55;
      }
      bangAmpA[c] *= bangDecayA; exhaustAmpA[c] *= exhaustDecay;
    }
    for (let c = 0; c < 9; c++) {
      const fb = firingAnglesB[c];
      if ((prev < fb && angle >= fb) || (prev > angle && (fb >= prev || fb < angle))) {
        bangAmpB[c]    = gainB[c] * 0.09;
        exhaustAmpB[c] = gainB[c] * 0.52;
      }
      bangAmpB[c] *= bangDecayB; exhaustAmpB[c] *= exhaustDecay;
    }
    lfsr ^= lfsr << 13; lfsr ^= lfsr >> 17; lfsr ^= lfsr << 5;
    noiseLp = noiseLpCoeff * noiseLp + (1 - noiseLpCoeff) * ((lfsr & 0xFFFF) / 0x8000 - 1);
  }

  for (let i = 0; i < N; i++) {
    const prev = angle;
    angle = (angle + rpm * 360 / 60 / SR) % 720;

    for (let c = 0; c < 9; c++) {
      const fa = firingAnglesA[c];
      if ((prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle))) {
        bangAmpA[c]    = gainA[c] * 0.10;
        exhaustAmpA[c] = gainA[c] * 0.55;
      }
      bangAmpA[c] *= bangDecayA; exhaustAmpA[c] *= exhaustDecay;
    }
    for (let c = 0; c < 9; c++) {
      const fb = firingAnglesB[c];
      if ((prev < fb && angle >= fb) || (prev > angle && (fb >= prev || fb < angle))) {
        bangAmpB[c]    = gainB[c] * 0.09;
        exhaustAmpB[c] = gainB[c] * 0.52;
      }
      bangAmpB[c] *= bangDecayB; exhaustAmpB[c] *= exhaustDecay;
    }

    lfsr ^= lfsr << 13; lfsr ^= lfsr >> 17; lfsr ^= lfsr << 5;
    noiseLp = noiseLpCoeff * noiseLp + (1 - noiseLpCoeff) * ((lfsr & 0xFFFF) / 0x8000 - 1);

    let bang = 0, exhaust = 0;
    for (let c = 0; c < 9; c++) { bang += bangAmpA[c] + bangAmpB[c]; exhaust += exhaustAmpA[c] + exhaustAmpB[c]; }

    const raw = bang * 0.40 + exhaust * noiseLp * noiseScale;
    const nx  = resR * (resX * resCos - resY * resSin) + raw;
    const ny  = resR * (resX * resSin + resY * resCos);
    resX = nx; resY = ny;

    const mixed = raw * 0.05 + nx * 0.95;
    lpState = lpCoeff * lpState + (1 - lpCoeff) * mixed;
    buf[i]  = lpState;
  }
  return buf;
}

/* ─────────────────────────────────────────────────────────────────────────────
   WORKLET engine factory — shared structure, parameterised by config object.
   throttle=0 for idle (crack is throttle-scaled in new params).
───────────────────────────────────────────────────────────────────────────── */
function renderWorklet(cfg, rpm = 750, throttle = 0) {
  const N = Math.floor(SR * SEG);
  const buf = new Float32Array(N);

  const firingAnglesA = Array.from({ length: 9 }, (_, i) => ((i * 80) + (Math.random() - 0.5) * 10) % 720);
  const firingAnglesB = Array.from({ length: 9 }, (_, i) => ((i * 80 + 20) + (Math.random() - 0.5) * 10) % 720);
  const gainA = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);
  const gainB = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);

  const bangBaseA   = cfg.bangBaseA   ?? 0.50;
  const bangBaseB   = cfg.bangBaseB   ?? 0.44;
  const exhaustBaseA = cfg.exhaustBaseA ?? 0.75;
  const exhaustBaseB = cfg.exhaustBaseB ?? 0.68;
  const rawBangW    = cfg.rawBangW    ?? 0.28;
  const rawExhDirW  = cfg.rawExhDirW  ?? 0.32;
  const bangDecayA  = Math.exp(-(cfg.bangKA ?? 4500) / SR);
  const bangDecayB  = Math.exp(-(cfg.bangKB ?? 3800) / SR);
  const bangAmpA    = new Float32Array(9);
  const bangAmpB    = new Float32Array(9);
  const crackDecayA = Math.exp(-10000 / SR);
  const crackDecayB = Math.exp(-8500 / SR);
  const crackAmpA   = new Float32Array(9);
  const crackAmpB   = new Float32Array(9);
  const exhaustAmpA = new Float32Array(9);
  const exhaustAmpB = new Float32Array(9);

  const cyclesPerSec   = rpm / 120;
  const firingInterval = SR / (cyclesPerSec * 9);
  const tau            = Math.min(firingInterval * 0.50, SR * 0.022);
  const exhaustDecay   = Math.exp(-1 / tau);
  const overlap        = Math.exp(-firingInterval / tau);
  const noiseScale     = 0.55 * (1 - overlap);

  /* Resonator 1 */
  const res1Freq = cyclesPerSec * 9 * cfg.res1Harmonic;
  const omega1   = 2 * Math.PI * res1Freq / SR;
  const res1Cos  = Math.cos(omega1), res1Sin = Math.sin(omega1);
  let res1X = 0, res1Y = 0;

  /* Resonator 2 — 9th harmonic always */
  const omega2  = 2 * Math.PI * (cyclesPerSec * 9 * 9) / SR;
  const res2Cos = Math.cos(omega2), res2Sin = Math.sin(omega2);
  let res2X = 0, res2Y = 0;

  let lfsr = 0xACE1;
  let noiseLp = 0;
  const noiseLpCoeff = Math.exp(-2 * Math.PI * cfg.noiseLpHz / SR);
  let lpState = 0;
  const lpCoeff = Math.exp(-2 * Math.PI * cfg.outputLpHz / SR);
  let angle = 0;

  /* Warm up 0.5s */
  const warmN = Math.floor(SR * 0.5);
  for (let i = 0; i < warmN; i++) {
    const prev = angle;
    angle = (angle + rpm * 360 / 60 / SR) % 720;
    for (let c = 0; c < 9; c++) {
      const fa = firingAnglesA[c];
      if ((prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle))) {
        bangAmpA[c] = gainA[c] * bangBaseA; crackAmpA[c] = gainA[c] * 0.38; exhaustAmpA[c] = gainA[c] * exhaustBaseA;
      }
      bangAmpA[c] *= bangDecayA; crackAmpA[c] *= crackDecayA; exhaustAmpA[c] *= exhaustDecay;
    }
    for (let c = 0; c < 9; c++) {
      const fb = firingAnglesB[c];
      if ((prev < fb && angle >= fb) || (prev > angle && (fb >= prev || fb < angle))) {
        bangAmpB[c] = gainB[c] * bangBaseB; crackAmpB[c] = gainB[c] * 0.34; exhaustAmpB[c] = gainB[c] * exhaustBaseB;
      }
      bangAmpB[c] *= bangDecayB; crackAmpB[c] *= crackDecayB; exhaustAmpB[c] *= exhaustDecay;
    }
    lfsr ^= lfsr << 13; lfsr ^= lfsr >> 17; lfsr ^= lfsr << 5;
    noiseLp = noiseLpCoeff * noiseLp + (1 - noiseLpCoeff) * ((lfsr & 0xFFFF) / 0x8000 - 1);
  }

  for (let i = 0; i < N; i++) {
    const prev = angle;
    angle = (angle + rpm * 360 / 60 / SR) % 720;

    for (let c = 0; c < 9; c++) {
      const fa = firingAnglesA[c];
      if ((prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle))) {
        bangAmpA[c] = gainA[c] * bangBaseA; crackAmpA[c] = gainA[c] * 0.38; exhaustAmpA[c] = gainA[c] * exhaustBaseA;
      }
      bangAmpA[c] *= bangDecayA; crackAmpA[c] *= crackDecayA; exhaustAmpA[c] *= exhaustDecay;
    }
    for (let c = 0; c < 9; c++) {
      const fb = firingAnglesB[c];
      if ((prev < fb && angle >= fb) || (prev > angle && (fb >= prev || fb < angle))) {
        bangAmpB[c] = gainB[c] * bangBaseB; crackAmpB[c] = gainB[c] * 0.34; exhaustAmpB[c] = gainB[c] * exhaustBaseB;
      }
      bangAmpB[c] *= bangDecayB; crackAmpB[c] *= crackDecayB; exhaustAmpB[c] *= exhaustDecay;
    }

    lfsr ^= lfsr << 13; lfsr ^= lfsr >> 17; lfsr ^= lfsr << 5;
    noiseLp = noiseLpCoeff * noiseLp + (1 - noiseLpCoeff) * ((lfsr & 0xFFFF) / 0x8000 - 1);

    let bang = 0, crack = 0, exhaust = 0;
    for (let c = 0; c < 9; c++) {
      bang    += bangAmpA[c]  + bangAmpB[c];
      crack   += crackAmpA[c] + crackAmpB[c];
      exhaust += exhaustAmpA[c] + exhaustAmpB[c];
    }

    const crackMix = cfg.crackWeight * throttle;
    const raw = (bang * rawBangW + crack * crackMix + exhaust * rawExhDirW + exhaust * noiseLp * noiseScale) * 0.78;

    const nx1 = cfg.res1R * (res1X * res1Cos - res1Y * res1Sin) + raw;
    const ny1 = cfg.res1R * (res1X * res1Sin + res1Y * res1Cos);
    res1X = nx1; res1Y = ny1;

    const nx2 = 0.80 * (res2X * res2Cos - res2Y * res2Sin) + raw;
    const ny2 = 0.80 * (res2X * res2Sin + res2Y * res2Cos);
    res2X = nx2; res2Y = ny2;

    const mixed  = raw * cfg.rawW + nx1 * cfg.res1W + nx2 * cfg.res2W;
    lpState = lpCoeff * lpState + (1 - lpCoeff) * mixed;
    buf[i]  = lpState;
  }
  return buf;
}

/* ── Configs ── */
// Note: bangBaseA/B and bangKA/KB default to old values; new params override them.
const OLD_PARAMS = {
  res1Harmonic: 3,      // 3rd harmonic (168 Hz at idle)
  res1R:        0.86,
  noiseLpHz:    2200,
  outputLpHz:   3500,
  crackWeight:  0.18,   // always on
  rawW: 0.50, res1W: 0.32, res2W: 0.18,
};

/* New = synthesis-matched at idle (throttle=0):
   bang 0.10, decay exp(-5500), rawBangW 0.40, no direct exhaust,
   res1R 0.96, rawW 0.05, res1W 0.95, res2W 0.00, noiseLp 900, outputLp 2000 */
const NEW_PARAMS = {
  res1Harmonic: 1,
  res1R:        0.96,
  noiseLpHz:    900,
  outputLpHz:   2000,
  crackWeight:  0.00,
  rawW: 0.05, res1W: 0.95, res2W: 0.00,
  bangBaseA: 0.10, bangBaseB: 0.09,
  bangKA: 5500,    bangKB: 4800,
  exhaustBaseA: 0.55, exhaustBaseB: 0.52,
  rawBangW: 0.40, rawExhDirW: 0.00,
};

/* ── Render ── */
console.log('Rendering startup synthesis at idle (750 RPM)...');
const synthSeg  = renderStartupSynth(750);

console.log('Rendering old worklet params at idle (750 RPM)...');
const oldSeg    = renderWorklet(OLD_PARAMS, 750, 0);

console.log('Rendering new worklet params at idle (750 RPM)...');
const newSeg    = renderWorklet(NEW_PARAMS, 750, 0);

/* ── Assemble with silence gaps ── */
const gapN  = Math.floor(SR * GAP);
const total = synthSeg.length + gapN + oldSeg.length + gapN + newSeg.length;
const full  = new Float32Array(total);

let off = 0;
full.set(synthSeg, off);  off += synthSeg.length + gapN;
full.set(oldSeg,   off);  off += oldSeg.length   + gapN;
full.set(newSeg,   off);

/* ── Normalize each segment independently ── */
function normSeg(buf, start, len) {
  let pk = 0;
  for (let i = start; i < start + len; i++) if (Math.abs(buf[i]) > pk) pk = Math.abs(buf[i]);
  if (pk > 0) for (let i = start; i < start + len; i++) buf[i] /= pk * 1.1;
}
normSeg(full, 0, synthSeg.length);
normSeg(full, synthSeg.length + gapN, oldSeg.length);
normSeg(full, synthSeg.length + gapN + oldSeg.length + gapN, newSeg.length);

/* ── Write WAV ── */
const dataBytes = full.length * 2;
const buf16     = new Int16Array(full.length);
for (let i = 0; i < full.length; i++) buf16[i] = Math.max(-32768, Math.min(32767, Math.round(full[i] * 32767)));

const header = Buffer.alloc(44);
header.write('RIFF', 0);             header.writeUInt32LE(36 + dataBytes, 4);
header.write('WAVE', 8);             header.write('fmt ', 12);
header.writeUInt32LE(16, 16);        header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);         header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);    header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);        header.write('data', 36);
header.writeUInt32LE(dataBytes, 40);

writeFileSync(OUT, Buffer.concat([header, Buffer.from(buf16.buffer)]));

const t0 = 0, t1 = SEG + GAP, t2 = 2 * SEG + 2 * GAP;
console.log(`\nWritten: ${OUT}`);
console.log(`  t=${t0.toFixed(1)}s  startup synthesis  (${SEG}s)`);
console.log(`  t=${t1.toFixed(1)}s  old worklet        (${SEG}s)`);
console.log(`  t=${t2.toFixed(1)}s  new worklet        (${SEG}s)`);
