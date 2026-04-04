#!/usr/bin/env node
/* Renders the DB 605 startup synthesis offline → WAV
   Usage: node scripts/render-startup.mjs [output.wav]
   Requires: Node.js 18+, no extra dependencies */

import { writeFileSync } from 'fs';

const OUT = process.argv[2] ?? 'startup.wav';
const SR  = 44100;

/* ── BF109 config (mirrors sound.js v12-supercharged) ── */
const _cfg = {
  rpmIdle:              400,
  rpmMax:               2800,
  masterGain:           0.80,
  superchargerFreqIdle: 700,
  superchargerFreqMax:  2500,
  superchargerGain:     0.45,
};

/* ── Synthesis functions (mirrored from sound.js) ── */

function _synthFlywheel(sr, duration = 26.0) {
  const N = Math.floor(sr * duration);
  const buf = new Float32Array(N);
  let lfsr = 0xBEEF, motorPhase = 0;
  const af1C = Math.cos(2*Math.PI*350/sr), af1S = Math.sin(2*Math.PI*350/sr);
  let af1X = 0, af1Y = 0;
  const toothDecay = Math.exp(-300/sr);
  let tooth1Phase = 0, tooth1NextInt = 1, tooth1Env = 0;
  let tooth2Phase = 0, tooth2NextInt = 1, tooth2Env = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const meshFreq = Math.min(310, 47 * Math.exp(0.1143 * t));
    const motorFreq = 1590 + 28 * Math.sin(2*Math.PI*3.7*t);
    motorPhase += motorFreq / sr;
    const motorFade = Math.min(1, Math.max(0, (duration - t) / 5.0));
    const motorEnv = Math.min(1, t/2.5) * 0.08 * motorFade;
    const motorSig = (Math.sin(2*Math.PI*motorPhase)*0.65 + Math.sin(4*Math.PI*motorPhase)*0.22 + Math.sin(6*Math.PI*motorPhase)*0.08) * motorEnv;
    tooth1Phase += meshFreq / sr;
    if (tooth1Phase >= tooth1NextInt) { tooth1Env += 0.60*(0.5+Math.random()); tooth1NextInt = Math.floor(tooth1Phase)+1+(Math.random()-0.5)*0.16; }
    tooth1Env *= toothDecay;
    tooth2Phase += meshFreq * 1.633 / sr;
    if (tooth2Phase >= tooth2NextInt) { tooth2Env += 0.28*(0.5+Math.random()); tooth2NextInt = Math.floor(tooth2Phase)+1+(Math.random()-0.5)*0.16; }
    tooth2Env *= toothDecay;
    lfsr ^= lfsr<<13; lfsr ^= lfsr>>17; lfsr ^= lfsr<<5;
    const noise = (lfsr & 0xFFFF)/32768 - 1;
    const raspScale = 0.04 + 0.08*(meshFreq/310);
    const ampEnv = Math.min(1, t/8) * (0.5 + 0.5*Math.min(1, t/20));
    const excitation = (tooth1Env + tooth2Env + noise*raspScale) * ampEnv;
    let nx, ny;
    nx = 0.960*(af1X*af1C - af1Y*af1S) + excitation*0.6; ny = 0.960*(af1X*af1S + af1Y*af1C); af1X=nx; af1Y=ny;
    buf[i] = (af1X*0.30 + excitation*0.55 + motorSig) * 0.20;
  }
  return buf;
}

function _synthKlonk(sr) {
  const N = Math.floor(sr * 0.18), buf = new Float32Array(N);
  const tD = Math.exp(-200/sr), bD = Math.exp(-60/sr);
  let t = 1.4, b = 1.0;
  const rc = Math.cos(2*Math.PI*180/sr), rs = Math.sin(2*Math.PI*180/sr), r = 0.88;
  let rx = 0, ry = 0, lfsr = 0xDEAD;
  for (let i = 0; i < N; i++) {
    t *= tD; b *= bD;
    lfsr ^= lfsr<<13; lfsr ^= lfsr>>17; lfsr ^= lfsr<<5;
    const noise = (lfsr & 0xFFFF)/32768 - 1;
    const raw = t*0.5 + b*noise*0.4;
    const nx = r*(rx*rc - ry*rs) + raw, ny = r*(rx*rs + ry*rc); rx=nx; ry=ny;
    buf[i] = (raw*0.2 + nx*0.8) * 1.8;
  }
  return buf;
}

function _synthMotoring(sr, duration = 2.8) {
  const N = Math.floor(sr * duration), buf = new Float32Array(N);
  let lfsr = 0xF00D;
  const rc = Math.cos(2*Math.PI*32/sr), rs = Math.sin(2*Math.PI*32/sr), r = 0.93;
  let rx = 0, ry = 0, trans = 0, body = 0;
  const tD = Math.exp(-150/sr), bD = Math.exp(-40/sr);
  let nextComp = Math.floor(sr * 0.12);
  let motorPhase = 0;
  const toothDecay = Math.exp(-300/sr);
  let toothPhase = 0, toothNextInt = 1, toothEnv = 0;
  const af1C = Math.cos(2*Math.PI*350/sr), af1S = Math.sin(2*Math.PI*350/sr);
  let af1X = 0, af1Y = 0;
  for (let i = 0; i < N; i++) {
    const t = i/sr, progress = t/duration;
    const rpm = 65 - progress*18;
    const compInterval = sr*2*60/(rpm*12);
    if (i >= nextComp) { const amp = 0.7+Math.random()*0.5; trans += amp; body += amp*0.55; nextComp = i + compInterval*(0.95+Math.random()*0.1); }
    trans *= tD; body *= bD;
    lfsr ^= lfsr<<13; lfsr ^= lfsr>>17; lfsr ^= lfsr<<5;
    const noise = (lfsr & 0xFFFF)/32768 - 1;
    const raw = trans*0.4 + body*noise*0.22;
    const nx = r*(rx*rc - ry*rs) + raw, ny = r*(rx*rs + ry*rc); rx=nx; ry=ny;
    const compSig = (raw*0.1 + nx*0.9) * 1.05;
    const loadSag = 170*progress, compFlut = trans*60;
    const motorFreq = 1590 - loadSag - compFlut + (Math.random()-0.5)*20;
    motorPhase += motorFreq/sr;
    const motorGain = 0.08*(1-progress*0.4);
    const motorSig = (Math.sin(2*Math.PI*motorPhase)*0.65 + Math.sin(4*Math.PI*motorPhase)*0.22 + Math.sin(6*Math.PI*motorPhase)*0.08) * motorGain;
    const meshFreq = 310 - progress*70;
    toothPhase += meshFreq/sr;
    if (toothPhase >= toothNextInt) { toothEnv += 0.45*(0.5+Math.random()); toothNextInt = Math.floor(toothPhase)+1+(Math.random()-0.5)*0.16; }
    toothEnv *= toothDecay;
    const gearSig = (toothEnv + noise*(0.04+0.04*(meshFreq/310))) * (0.8-progress*0.5);
    let cnx, cny;
    cnx = 0.960*(af1X*af1C - af1Y*af1S) + (compSig+gearSig)*0.5; cny = 0.960*(af1X*af1S + af1Y*af1C); af1X=cnx; af1Y=cny;
    buf[i] = (af1X*0.25 + compSig*0.45 + gearSig*0.15 + motorSig) * 0.90;
  }
  return buf;
}

function _synthRunup(sr, duration = 42.0, targetRpm = 1000) {
  const N = Math.floor(sr*duration), buf = new Float32Array(N);
  let lfsr = 0xACE1;
  const resCos = Math.cos(2*Math.PI*45/sr), resSin = Math.sin(2*Math.PI*45/sr), resR = 0.96;
  let resX = 0, resY = 0;
  const transDecay = Math.exp(-300/sr);
  let bodyDecay = Math.exp(-55/sr), noiseScale = 0.2, transient = 0, body = 0;
  const firingAngles = [0,60,120,180,240,300].map(a => (a+(Math.random()-0.5)*16)%360);
  const cylinderGains = Array.from({length:6}, () => 0.4+Math.random()*1.2);
  let crankAngle = 0, knallAt = Math.floor(sr*0.04), knallDone = false, laderPhase = 0;
  const lFIdle = _cfg.superchargerFreqIdle, rIdle = _cfg.rpmIdle;
  const gearTailDecay = Math.exp(-1 / (3.0 * sr));
  let gearTailEnv = 0.30;
  const gearToothDecay = Math.exp(-300/sr);
  let gearToothPhase = 0, gearToothNextInt = 1, gearToothEnv = 0;
  for (let i = 0; i < N; i++) {
    const t = i/sr, progress = Math.min(t/duration, 1);
    const rpm = 80 + (targetRpm-80)*Math.pow(progress, 0.55);
    if (i%128===0) { const fi=sr*10/rpm, tau=Math.max(fi/3,sr*0.003); bodyDecay=Math.exp(-1/tau); noiseScale=0.2*(1-Math.exp(-fi/tau)); }
    if (!knallDone && i>=knallAt) { transient+=2.8; body+=2.8*0.7; knallDone=true; }
    const degPerSample = rpm/60/sr*360, prev = crankAngle;
    crankAngle = (crankAngle+degPerSample)%360;
    for (let c=0; c<firingAngles.length; c++) {
      const target=firingAngles[c];
      const crossed = crankAngle>=prev ? (prev<=target&&crankAngle>target) : (prev<=target||crankAngle>target);
      if (crossed) { const mfp=Math.max(0,0.55-rpm/250*0.55); if (Math.random()>mfp) { const amp=cylinderGains[c]; transient+=amp; body+=amp*0.7; } }
    }
    transient*=transDecay; body*=bodyDecay;
    lfsr ^= lfsr<<13; lfsr ^= lfsr>>17; lfsr ^= lfsr<<5;
    const noise=(lfsr&0xFFFF)/32768-1;
    gearTailEnv *= gearTailDecay;
    const gearMeshFreq = Math.max(60, 240 - t * 6);
    gearToothPhase += gearMeshFreq / sr;
    if (gearToothPhase >= gearToothNextInt) { gearToothEnv += 0.35*(0.5+Math.random()); gearToothNextInt = Math.floor(gearToothPhase)+1+(Math.random()-0.5)*0.16; }
    gearToothEnv *= gearToothDecay;
    const gearSig = (gearToothEnv + noise * 0.06) * gearTailEnv;
    const raw=transient*0.3+body*noise*noiseScale;
    const nx=resR*(resX*resCos-resY*resSin)+raw, ny=resR*(resX*resSin+resY*resCos); resX=nx; resY=ny;
    const laderFreq=lFIdle*rpm/rIdle; laderPhase+=laderFreq/sr;
    const lader=(Math.sin(2*Math.PI*laderPhase)+Math.sin(4*Math.PI*laderPhase)*0.4)*Math.max(0,(progress-0.28)/0.72)*0.10;
    buf[i] = ((raw*0.05+nx*0.95)*0.8 + gearSig*0.15 + lader)*Math.min(1,t/0.06);
  }
  return buf;
}

function _assemble(sr) {
  const fw=_synthFlywheel(sr), kl=_synthKlonk(sr), mot=_synthMotoring(sr), run=_synthRunup(sr, 42.0, _cfg.rpmIdle);
  const gap=Math.floor(sr*0.06);
  const total=fw.length+gap+kl.length+gap+mot.length+gap+run.length;
  const full=new Float32Array(total);
  let off=0; full.set(fw,off); off+=fw.length+gap; full.set(kl,off); off+=kl.length+gap; full.set(mot,off); off+=mot.length+gap; full.set(run,off);
  const scale=(_cfg.masterGain*0.4)/0.8;
  for (let i=0; i<full.length; i++) full[i]*=scale;
  return full;
}

/* ── WAV writer ── */
function writeWav(path, samples, sr) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr*2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i*2);
  }
  writeFileSync(path, buf);
}

/* ── Main ── */
console.log('Rendering DB 605 startup synthesis…');
console.log(`  Sample rate : ${SR} Hz`);
const t0 = Date.now();
const buf = _assemble(SR);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  Duration    : ${(buf.length/SR).toFixed(1)}s  (rendered in ${elapsed}s)`);
writeWav(OUT, buf, SR);
console.log(`  Saved       : ${OUT}`);
