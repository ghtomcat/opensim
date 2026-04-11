#!/usr/bin/env node
/* Renders R-2800 synthesis offline → WAV for spectrum analysis.
   Usage: node scripts/render-r2800.mjs [output.wav]
   Mirrors r2800-processor.js exactly — edit both in sync. */

import { writeFileSync } from 'fs';

const OUT = process.argv[2] ?? 'audio/r2800_synth.wav';
const SR  = 44100;

/* ── R-2800 config (mirrors sound.js radial-2000hp) ── */
const RPM_IDLE = 750;
const RPM_MAX  = 2700;
const MASTER   = 0.78;

/* ── Port of r2800-processor.js ── */
function makeR2800(rpm) {
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

  const resR = 0.93;
  let resCos, resSin, resX = 0, resY = 0;
  let exhaustDecay, noiseScale = 0.18;
  let lfsr = 0xACE1;
  let noiseLp = 0;
  const noiseLpCoeff = Math.exp(-2 * Math.PI * 900 / SR);
  let lpState = 0;
  const lpCoeff = Math.exp(-2 * Math.PI * 2000 / SR);
  let angle = 0;

  function updateDecay(r) {
    const cyclesPerSec   = r / 120;
    const firingInterval = SR / (cyclesPerSec * 9);
    const tau = Math.min(firingInterval * 0.50, SR * 0.022);
    exhaustDecay = Math.exp(-1 / tau);
    const overlap = Math.exp(-firingInterval / tau);
    noiseScale = 0.22 * (1 - overlap);
    const firingFreq = cyclesPerSec * 9;
    const omega = 2 * Math.PI * firingFreq / SR;
    resCos = Math.cos(omega);
    resSin = Math.sin(omega);
  }

  updateDecay(rpm);

  function process(out) {
    const degsPerSample = rpm * 360 / 60 / SR;
    for (let i = 0; i < out.length; i++) {
      const prev = angle;
      angle = (angle + degsPerSample) % 720;

      for (let c = 0; c < 9; c++) {
        const fa = firingAnglesA[c];
        const crossed = (prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle));
        if (crossed) { bangAmpA[c] = gainA[c] * 0.10; exhaustAmpA[c] = gainA[c] * 0.55; }
        bangAmpA[c]    *= bangDecayA;
        exhaustAmpA[c] *= exhaustDecay;
      }
      for (let c = 0; c < 9; c++) {
        const fb = firingAnglesB[c];
        const crossed = (prev < fb && angle >= fb) || (prev > angle && (fb >= prev || fb < angle));
        if (crossed) { bangAmpB[c] = gainB[c] * 0.09; exhaustAmpB[c] = gainB[c] * 0.52; }
        bangAmpB[c]    *= bangDecayB;
        exhaustAmpB[c] *= exhaustDecay;
      }

      lfsr ^= lfsr << 13; lfsr ^= lfsr >> 17; lfsr ^= lfsr << 5;
      const raw_noise = (lfsr & 0xFFFF) / 0x8000 - 1;
      noiseLp = noiseLpCoeff * noiseLp + (1 - noiseLpCoeff) * raw_noise;

      let bang = 0, exhaust = 0;
      for (let c = 0; c < 9; c++) {
        bang    += bangAmpA[c] + bangAmpB[c];
        exhaust += exhaustAmpA[c] + exhaustAmpB[c];
      }

      const raw = (bang * 0.40 + exhaust * noiseLp * noiseScale) * MASTER;
      const nx  = resR * (resX * resCos - resY * resSin) + raw;
      const ny  = resR * (resX * resSin + resY * resCos);
      resX = nx; resY = ny;

      const mixed  = raw * 0.35 + nx * 0.65;
      lpState = lpCoeff * lpState + (1 - lpCoeff) * mixed;
      out[i]  = lpState;
    }
  }

  return { process, setRpm: r => { rpm = r; updateDecay(r); } };
}

/* ── Render segments ── */
const SEG_SECS  = 4;     // seconds per RPM segment
const RAMP_SECS = 0.5;   // crossfade ramp between segments
const RPMS      = [RPM_IDLE, 1200, 1800, 2700];  // idle → combat
const LABELS    = ['Idle 750', 'Mid 1200', 'High 1800', 'Combat 2700'];

const totalSecs = RPMS.length * SEG_SECS + 1;
const totalN    = Math.floor(SR * totalSecs);
const full      = new Float32Array(totalN);

let offset = 0;
for (let s = 0; s < RPMS.length; s++) {
  const rpm = RPMS[s];
  const N   = Math.floor(SR * SEG_SECS);
  const buf = new Float32Array(N);
  const engine = makeR2800(rpm);

  // Warm up (discard 0.5s to let filters settle)
  const warmup = new Float32Array(Math.floor(SR * 0.5));
  engine.process(warmup);

  engine.process(buf);

  // Copy with short fade in/out
  const fadeLen = Math.floor(SR * 0.1);
  for (let i = 0; i < N && offset + i < totalN; i++) {
    let env = 1;
    if (i < fadeLen)     env = i / fadeLen;
    if (i > N - fadeLen) env = (N - i) / fadeLen;
    full[offset + i] += buf[i] * env;
  }
  offset += N;
  console.log(`  ${LABELS[s]} RPM: rendered ${SEG_SECS}s`);
}

/* ── Peak normalize ── */
let peak = 0;
for (let i = 0; i < full.length; i++) if (Math.abs(full[i]) > peak) peak = Math.abs(full[i]);
if (peak > 0) for (let i = 0; i < full.length; i++) full[i] /= peak * 1.1;

/* ── Write WAV ── */
const numSamples = full.length;
const dataBytes  = numSamples * 2;
const buf16      = new Int16Array(numSamples);
for (let i = 0; i < numSamples; i++) buf16[i] = Math.max(-32768, Math.min(32767, Math.round(full[i] * 32767)));

const header = Buffer.alloc(44);
header.write('RIFF', 0);             header.writeUInt32LE(36 + dataBytes, 4);
header.write('WAVE', 8);             header.write('fmt ', 12);
header.writeUInt32LE(16, 16);        header.writeUInt16LE(1, 20);   // PCM
header.writeUInt16LE(1, 22);         header.writeUInt32LE(SR, 24);  // mono
header.writeUInt32LE(SR * 2, 28);    header.writeUInt16LE(2, 32);   // block align
header.writeUInt16LE(16, 34);        header.write('data', 36);
header.writeUInt32LE(dataBytes, 40);

writeFileSync(OUT, Buffer.concat([header, Buffer.from(buf16.buffer)]));
console.log(`\nWritten: ${OUT}  (${(totalSecs).toFixed(1)}s, ${(dataBytes/1024).toFixed(0)} KB)`);
console.log('Segments: idle(750) → mid(1200) → high(1800) → combat(2700) RPM, 4s each');
