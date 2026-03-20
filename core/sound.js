/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/sound.js
   Procedural engine sound via Web Audio API.
   Engine type defined in aircraft JSON → sound.engineType.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

/* ── Engine type presets ── */
const ENGINES = {
  'geared-turbofan': {
    fundamentalIdle: 52,
    fundamentalMax:  105,
    harmonics:       [1, 2, 4, 8],
    harmonicGains:   [1.0, 0.25, 0.08, 0.03],
    oscType:         'sawtooth',
    filterType:      'lowpass',
    filterFreq:      260,
    filterQ:         0.6,
    noiseGain:       0.06,
    noiseFilterFreq: 600,
    masterGain:      0.14,
    attackTime:      1.2,
  },
  'high-bypass': {
    fundamentalIdle: 68,
    fundamentalMax:  155,
    harmonics:       [1, 2, 3, 4, 6],
    harmonicGains:   [1.0, 0.45, 0.22, 0.12, 0.06],
    oscType:         'sawtooth',
    filterType:      'lowpass',
    filterFreq:      500,
    filterQ:         1.0,
    noiseGain:       0.09,
    noiseFilterFreq: 1000,
    masterGain:      0.16,
    attackTime:      0.8,
  },
  'low-bypass-military': {
    fundamentalIdle: 88,
    fundamentalMax:  260,
    harmonics:       [1, 2, 3, 4, 5, 6, 8],
    harmonicGains:   [1.0, 0.55, 0.35, 0.22, 0.16, 0.10, 0.05],
    oscType:         'sawtooth',
    filterType:      'bandpass',
    filterFreq:      900,
    filterQ:         1.8,
    noiseGain:       0.18,
    noiseFilterFreq: 2200,
    masterGain:      0.20,
    attackTime:      0.4,
  },
  'v12-supercharged': {
    // Daimler-Benz DB 605 — V12, 4-stroke, 6 power strokes per revolution
    // Idle ~600 RPM → 60 Hz · Max ~2800 RPM → 280 Hz
    // Strong odd harmonics, rough character, supercharger whine overlay
    fundamentalIdle: 58,
    fundamentalMax:  270,
    harmonics:       [1, 2, 3, 4, 5, 6, 7],
    harmonicGains:   [1.0, 0.35, 0.65, 0.20, 0.45, 0.15, 0.30], // odd stronger
    oscType:         'sawtooth',
    filterType:      'lowpass',
    filterFreq:      700,
    filterQ:         2.5,
    noiseGain:       0.04,
    noiseFilterFreq: 350,
    masterGain:      0.18,
    attackTime:      0.3,
    // DB 605 specific
    hasStartup:            true,
    supercharger:          true,
    superchargerOnset:     0.0,    // mechanically coupled — always spinning
    superchargerFreqIdle:  900,
    superchargerFreqMax:   3400,
    superchargerGain:      0.032,
  },
};

export const ENGINE_TYPES = Object.keys(ENGINES);

/* ── Internal state ── */
let _ctx          = null;
let _master       = null;
let _oscs         = [];
let _noise        = null;
let _noiseGain    = null;
let _lader        = null;   // supercharger oscillator
let _laderGain    = null;
let _started      = false;
let _cfg          = null;
let _inStartup    = false;

/* ── Public API ── */

export function initSound(engineType) {
  _cfg = ENGINES[engineType] ?? ENGINES['geared-turbofan'];
}

export function startSound(engineType) {
  if (engineType) _cfg = ENGINES[engineType] ?? ENGINES['geared-turbofan'];
  if (!_cfg) _cfg = ENGINES['geared-turbofan'];
  if (_started) _teardown();

  _ctx    = new AudioContext();
  _master = _ctx.createGain();
  _master.gain.value = 0;
  _master.connect(_ctx.destination);

  /* Harmonic oscillators */
  _cfg.harmonics.forEach((mult, i) => {
    const osc  = _ctx.createOscillator();
    const gain = _ctx.createGain();
    const filt = _ctx.createBiquadFilter();

    osc.type             = _cfg.oscType;
    osc.frequency.value  = _cfg.fundamentalIdle * mult;
    gain.gain.value      = _cfg.harmonicGains[i] ?? 0.05;
    filt.type            = _cfg.filterType;
    filt.frequency.value = _cfg.filterFreq;
    filt.Q.value         = _cfg.filterQ;

    osc.connect(gain);
    gain.connect(filt);
    filt.connect(_master);
    osc.start();
    _oscs.push({ osc, gain, mult });
  });

  /* Noise layer */
  const buf  = _ctx.createBuffer(1, _ctx.sampleRate * 2, _ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  _noise = _ctx.createBufferSource();
  _noise.buffer = buf;
  _noise.loop   = true;

  const nFilt = _ctx.createBiquadFilter();
  nFilt.type             = 'bandpass';
  nFilt.frequency.value  = _cfg.noiseFilterFreq;
  nFilt.Q.value          = 0.5;

  _noiseGain = _ctx.createGain();
  _noiseGain.gain.value = 0;

  _noise.connect(nFilt);
  nFilt.connect(_noiseGain);
  _noiseGain.connect(_master);
  _noise.start();

  /* Supercharger (DB 605 Lader) */
  if (_cfg.supercharger) {
    _lader = _ctx.createOscillator();
    _lader.type            = 'sine';
    _lader.frequency.value = _cfg.superchargerFreqIdle;

    const lFilt = _ctx.createBiquadFilter();
    lFilt.type             = 'bandpass';
    lFilt.frequency.value  = _cfg.superchargerFreqIdle;
    lFilt.Q.value          = 4.0;   // narrow → pure whine

    _laderGain = _ctx.createGain();
    _laderGain.gain.value = 0;

    _lader.connect(lFilt);
    lFilt.connect(_laderGain);
    _laderGain.connect(_master);
    _lader.start();
  }

  _started = true;

  if (_cfg.hasStartup) {
    _db605Startup();
  } else {
    _master.gain.setTargetAtTime(_cfg.masterGain * 0.4, _ctx.currentTime, _cfg.attackTime);
  }
}

export function stopSound()  { _teardown(); }

export function switchEngine(type) {
  const wasRunning = _started;
  _teardown();
  _cfg = ENGINES[type] ?? ENGINES['geared-turbofan'];
  if (wasRunning) startSound();
}

export function tickSound() {
  if (!_ctx || !_started || !_cfg || _inStartup) return;

  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 350;
  const throttle = Math.max(0, Math.min(1, S.spdT / maxSpd));
  const now      = _ctx.currentTime;

  const freq = _cfg.fundamentalIdle + (_cfg.fundamentalMax - _cfg.fundamentalIdle) * throttle;
  _oscs.forEach(({ osc, mult }) => {
    osc.frequency.setTargetAtTime(freq * mult, now, 0.12);
  });

  const gain = _cfg.masterGain * (0.35 + 0.65 * throttle);
  _master.gain.setTargetAtTime(gain, now, 0.15);
  _noiseGain.gain.setTargetAtTime(_cfg.noiseGain * throttle, now, 0.2);

  /* Supercharger: onset above threshold, rises with throttle squared */
  if (_cfg.supercharger && _lader && _laderGain) {
    const onset   = _cfg.superchargerOnset;
    const laderT  = Math.max(0, (throttle - onset) / Math.max(0.01, 1 - onset));
    const lFreq   = _cfg.superchargerFreqIdle + (_cfg.superchargerFreqMax - _cfg.superchargerFreqIdle) * throttle;
    const lGain   = _cfg.superchargerGain * (0.08 + 0.92 * laderT * laderT);  // whisper at idle
    _lader.frequency.setTargetAtTime(lFreq, now, 0.2);
    _laderGain.gain.setTargetAtTime(lGain, now, 0.6);
  }
}

/* ── DB 605 Startup Sequence ── */
async function _db605Startup() {
  _inStartup = true;
  const ctx  = _ctx;
  const now  = ctx.currentTime;

  /* 1. Inertia starter — rising whine 100→520 Hz over 7s */
  const starter     = ctx.createOscillator();
  const starterGain = ctx.createGain();
  const starterFilt = ctx.createBiquadFilter();

  starter.type            = 'sine';
  starter.frequency.value = 100;
  starterGain.gain.value  = 0.12;
  starterFilt.type        = 'bandpass';
  starterFilt.frequency.value = 300;
  starterFilt.Q.value     = 3.0;

  starter.connect(starterFilt);
  starterFilt.connect(starterGain);
  starterGain.connect(_master);
  starter.start(now);

  /* Master low during startup — only starter audible */
  _master.gain.setTargetAtTime(0.04, now, 0.3);
  /* Keep harmonic oscs silent */
  _oscs.forEach(({ gain }) => gain.gain.setValueAtTime(0, now));

  /* Flywheel accelerates */
  starter.frequency.linearRampToValueAtTime(520, now + 7);
  starterFilt.frequency.linearRampToValueAtTime(520, now + 7);

  await _sleep(7000);
  if (!_started) return;

  /* 2. Engagement — brief noise burst (clunk) */
  const clunkBuf  = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
  const clunkData = clunkBuf.getChannelData(0);
  for (let i = 0; i < clunkData.length; i++) clunkData[i] = (Math.random() * 2 - 1) * (1 - i / clunkData.length);
  const clunk     = ctx.createBufferSource();
  clunk.buffer    = clunkBuf;
  const clunkGain = ctx.createGain();
  clunkGain.gain.value = 0.3;
  clunk.connect(clunkGain);
  clunkGain.connect(_master);
  clunk.start();

  /* Starter fades */
  starterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  setTimeout(() => { try { starter.stop(); } catch {} }, 1500);

  await _sleep(300);
  if (!_started) return;

  /* 3. Rough start — fundamental sweeps 4→58 Hz over 3.5s (cylinders catching) */
  _oscs.forEach(({ osc, mult }) => osc.frequency.setValueAtTime(4 * mult, ctx.currentTime));
  /* Now bring harmonics back in — engine firing */
  _oscs.forEach(({ gain }, i) => gain.gain.setTargetAtTime(_cfg.harmonicGains[i] ?? 0.05, ctx.currentTime, 0.3));
  _master.gain.setTargetAtTime(_cfg.masterGain * 0.5, ctx.currentTime, 0.2);

  const rampEnd = ctx.currentTime + 3.5;
  _oscs.forEach(({ osc, mult }) => {
    osc.frequency.linearRampToValueAtTime(_cfg.fundamentalIdle * mult, rampEnd);
  });

  /* Add a low-frequency AM tremolo during rough idle (firing rhythm) */
  const tremolo     = ctx.createOscillator();
  const tremoloGain = ctx.createGain();
  tremolo.frequency.value = 4;   // ~4 Hz = rough cylinder rhythm
  tremolo.type            = 'sine';
  tremoloGain.gain.value  = 0.3;
  tremolo.connect(tremoloGain);
  tremoloGain.connect(_master.gain); // modulate master gain directly...
  // Actually connect to a separate gain node
  const amGain = ctx.createGain();
  amGain.gain.value = 0;
  tremolo.connect(amGain);  // dummy connect to keep it running
  tremolo.start();

  /* Sweep tremolo frequency up as engine catches (4→0 Hz as it smooths out) */
  tremolo.frequency.linearRampToValueAtTime(0.3, rampEnd);
  tremoloGain.gain.linearRampToValueAtTime(0, rampEnd);

  await _sleep(3500);
  if (!_started) return;

  try { tremolo.stop(); } catch {}

  /* 4. Settle to idle — smooth */
  _oscs.forEach(({ osc, mult }) => {
    osc.frequency.setTargetAtTime(_cfg.fundamentalIdle * mult, ctx.currentTime, 0.5);
  });
  _master.gain.setTargetAtTime(_cfg.masterGain * 0.4, ctx.currentTime, 0.8);
  _noiseGain.gain.setTargetAtTime(_cfg.noiseGain * 0.3, ctx.currentTime, 1.0);

  await _sleep(1000);
  _inStartup = false;   /* Hand off to tickSound() */
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Internal ── */
function _teardown() {
  if (!_ctx) return;
  _inStartup = false;
  _oscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
  try { _noise?.stop();  } catch {}
  try { _lader?.stop();  } catch {}
  _ctx.close();
  _ctx = null; _master = null; _oscs = [];
  _noise = null; _noiseGain = null;
  _lader = null; _laderGain = null;
  _started = false;
}
