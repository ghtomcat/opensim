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
    // Daimler-Benz DB 605 — impulse-based synthesis
    // Calibrated from Audacity spectrum of D-FEML ground run (Hangelar)
    // Fundamental idle: ~110 Hz · power: ~210 Hz
    // Supercharger: 663 Hz idle, 740 Hz power, 2nd at 1097 Hz
    impulse:         true,          // use impulse engine, not oscillators
    rpmIdle:         400,
    rpmMax:          2800,
    cylinders:       12,            // V12 — 6 firings per revolution
    impulseDecay:    8,             // very slow decay — long exhaust puff
    impulseVariance: 0.22,          // cylinder-to-cylinder variation
    exhaustResonance: 110,          // matches measured fundamental ~110 Hz
    exhaustQ:        8.0,           // high Q = strong resonance, exhaust "rings"
    masterGain:      0.80,
    // Supercharger
    supercharger:          true,
    superchargerFreqIdle:  663,
    superchargerFreqMax:   1100,
    superchargerGain:      0.45,
    supercharger2:         true,
    supercharger2FreqIdle: 1097,
    supercharger2FreqMax:  1400,
    supercharger2Gain:     0.18,
  },
};

export const ENGINE_TYPES = Object.keys(ENGINES);

export function getCurrentRpm() {
  if (!_cfg) return null;
  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 350;
  const throttle = Math.max(0, Math.min(1, S.spdT / maxSpd));
  if (_cfg.impulse) {
    const rpm = Math.round(_cfg.rpmIdle + (_cfg.rpmMax - _cfg.rpmIdle) * throttle);
    return rpm + ' RPM';
  } else {
    const n1 = Math.round(20 + 80 * throttle);
    return 'N1 ' + n1 + '%';
  }
}

/* ── Internal state — oscillator path ── */
let _ctx          = null;
let _master       = null;
let _oscs         = [];
let _noise        = null;
let _noiseGain    = null;
let _lader        = null;
let _laderGain    = null;
let _lader2       = null;
let _lader2Gain   = null;
let _started      = false;
let _cfg          = null;
let _inStartup    = false;

/* ── Internal state — AudioWorklet path (V12) ── */
let _workletNode  = null;   // AudioWorkletNode
let _workletReady = false;

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

  if (_cfg.impulse) {
    _startWorkletEngine();   /* async — sets _started when ready */
  } else {
    _startOscEngine();
    _started = true;
    _inStartup = false;
    _master.gain.setTargetAtTime(_cfg.masterGain, _ctx.currentTime, 0.4);
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
  if (!_ctx || !_started || !_cfg) return;

  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 350;
  const throttle = Math.max(0, Math.min(1, S.spdT / maxSpd));
  const now      = _ctx.currentTime;

  if (_cfg.impulse && _workletNode && _workletReady) {
    const rpm   = _cfg.rpmIdle + (_cfg.rpmMax - _cfg.rpmIdle) * throttle;
    const gain  = _cfg.masterGain * (0.4 + 0.6 * throttle);

    /* Supercharger — mechanically coupled, linear with RPM */
    const lFreq = _cfg.superchargerFreqIdle + (_cfg.superchargerFreqMax - _cfg.superchargerFreqIdle) * throttle;
    const lGain = _cfg.superchargerGain * (0.15 + 0.85 * throttle);

    _workletNode.port.postMessage({ rpm, masterGain: gain, laderGain: lGain, laderFreq: lFreq });
  } else if (!_cfg.impulse) {
    const freq = _cfg.fundamentalIdle + (_cfg.fundamentalMax - _cfg.fundamentalIdle) * throttle;
    _oscs.forEach(({ osc, mult }) => osc.frequency.setTargetAtTime(freq * mult, now, 0.12));
    const gain = _cfg.masterGain * (0.35 + 0.65 * throttle);
    _master.gain.setTargetAtTime(gain, now, 0.15);
    _noiseGain?.gain.setTargetAtTime(_cfg.noiseGain * throttle, now, 0.2);
  }

  /* Supercharger — shared by both paths */
  if (_cfg.supercharger && _lader && _laderGain) {
    const lFreq = _cfg.superchargerFreqIdle + (_cfg.superchargerFreqMax - _cfg.superchargerFreqIdle) * throttle;
    const lGain = _cfg.superchargerGain * (0.15 + 0.85 * throttle);
    _lader.frequency.setTargetAtTime(lFreq, now, 0.3);
    _laderGain.gain.setTargetAtTime(lGain, now, 0.5);

    if (_cfg.supercharger2 && _lader2 && _lader2Gain) {
      const l2Freq = _cfg.supercharger2FreqIdle + (_cfg.supercharger2FreqMax - _cfg.supercharger2FreqIdle) * throttle;
      const l2Gain = _cfg.supercharger2Gain * (0.12 + 0.88 * throttle * throttle);
      _lader2.frequency.setTargetAtTime(l2Freq, now, 0.3);
      _lader2Gain.gain.setTargetAtTime(l2Gain, now, 0.5);
    }
  }
}

/* ══════════════════════════════════════════════════
   AUDIOWORKLET ENGINE — DB 605 V12 physical model
   Karplus-Strong exhaust resonator, sample-by-sample
   ══════════════════════════════════════════════════ */

async function _startWorkletEngine() {
  try {
    await _ctx.audioWorklet.addModule('./core/db605-processor.js');

    _workletNode = new AudioWorkletNode(_ctx, 'db605-processor');
    _workletNode.connect(_master);

    _master.gain.setValueAtTime(0, _ctx.currentTime);
    _master.gain.setTargetAtTime(_cfg.masterGain * 0.4, _ctx.currentTime, 0.5);

    /* Send initial parameters */
    _workletNode.port.postMessage({
      rpm:        _cfg.rpmIdle,
      masterGain: _cfg.masterGain * 0.4,
      laderGain:  0,
      laderFreq:  _cfg.superchargerFreqIdle,
    });

    _buildSupercharger();

    _started      = true;
    _workletReady = true;
    _inStartup    = false;
  } catch (err) {
    console.warn('AudioWorklet failed, falling back to oscillator:', err);
    _startOscEngine();
    _started   = true;
    _inStartup = false;
    _master.gain.setTargetAtTime(_cfg.masterGain * 0.4, _ctx.currentTime, 0.4);
  }
}

/* ══════════════════════════════════════════════════
   OSCILLATOR ENGINE — turbofan / turbine
   ══════════════════════════════════════════════════ */

function _startOscEngine() {
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

  _buildSupercharger();
}

function _buildSupercharger() {
  if (!_cfg.supercharger) return;

  _lader = _ctx.createOscillator();
  _lader.type            = 'sine';
  _lader.frequency.value = _cfg.superchargerFreqIdle;

  const lFilt = _ctx.createBiquadFilter();
  lFilt.type             = 'bandpass';
  lFilt.frequency.value  = _cfg.superchargerFreqIdle;
  lFilt.Q.value          = 5.0;

  _laderGain = _ctx.createGain();
  _laderGain.gain.value = 0;

  _lader.connect(lFilt);
  lFilt.connect(_laderGain);
  _laderGain.connect(_master);
  _lader.start();

  if (_cfg.supercharger2) {
    _lader2 = _ctx.createOscillator();
    _lader2.type            = 'sine';
    _lader2.frequency.value = _cfg.supercharger2FreqIdle;

    const l2Filt = _ctx.createBiquadFilter();
    l2Filt.type             = 'bandpass';
    l2Filt.frequency.value  = _cfg.supercharger2FreqIdle;
    l2Filt.Q.value          = 6.0;

    _lader2Gain = _ctx.createGain();
    _lader2Gain.gain.value = 0;

    _lader2.connect(l2Filt);
    l2Filt.connect(_lader2Gain);
    _lader2Gain.connect(_master);
    _lader2.start();
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Teardown ── */
function _teardown() {
  if (!_ctx) return;
  _inStartup = false;
  _workletReady = false;
  try { _workletNode?.disconnect(); } catch {}
  _oscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
  try { _noise?.stop();  } catch {}
  try { _lader?.stop();  } catch {}
  try { _lader2?.stop(); } catch {}
  _ctx.close();
  _ctx = null; _master = null; _oscs = [];
  _noise = null; _noiseGain = null;
  _lader = null; _laderGain = null;
  _lader2 = null; _lader2Gain = null;
  _workletNode = null;
  _started = false;
}
