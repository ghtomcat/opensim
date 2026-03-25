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
  'rotary-9': {
    // Le Rhône 9J — 9-cylinder rotary, 110hp, WWI
    // Physical model via AudioWorklet — lerh9-processor.js
    impulse:          true,
    workletFile:      './core/lerh9-processor.js',
    workletName:      'lerh9-processor',
    rpmIdle:          400,
    rpmMax:           1200,
    masterGain:       3.5,
    supercharger:     false,
  },
  'lycoming-o360': {
    // Lycoming IO-360 — 4-cylinder, 180hp, C172 engine
    // Same impulse model as DB 605, 4 cylinders, no supercharger
    impulse:          true,
    workletFile:      './core/lycoming-processor.js',
    workletName:      'lycoming-processor',
    rpmIdle:          700,
    rpmMax:           2700,
    cylinders:        4,
    exhaustResonance: 95,
    exhaustQ:         5.0,
    masterGain:       0.70,
    supercharger:     false,
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
  const ePow     = Math.max(0.05, S.enginePower ?? 1.0);
  if (_cfg.impulse || _cfg.showRpm) {
    const rpm = Math.round((_cfg.rpmIdle + (_cfg.rpmMax - _cfg.rpmIdle) * throttle) * ePow);
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

/* ── Internal state — wind / airframe noise ── */
let _windNoise    = null;
let _windFilt     = null;
let _windGain     = null;
let _flapNoise    = null;
let _flapFilt     = null;
let _flapGain     = null;
let _groundNoise  = null;
let _groundFilt   = null;
let _groundGain   = null;
let _hissNoise    = null;
let _hissFilt     = null;
let _hissGain     = null;

/* ── Knacken — cooling metal ticks, dead engine in arctic air ── */
let _knackenActive  = false;
let _knackenTimeout = null;

/* ── Hiss decay — steam dies after coolant fully bleeds off ── */
let _hissDeadAt = null;   /* S.time when engine first reached full death */

/* ── Heartbeat — Friedrich's pulse slowing in the arctic cold ── */
let _heartActive    = false;
let _heartTimeout   = null;
let _heartStartedAt = null;   /* Date.now() when heartbeat first started */

/* ── Public API ── */

export function initSound(engineType) {
  _cfg = ENGINES[engineType] ?? ENGINES['geared-turbofan'];
}

export function engineGunfire() {
  if (!_ctx) return;
  /* Rapid impacts — enemy burst hitting the airframe */
  const rounds = 5;
  for (let i = 0; i < rounds; i++) {
    setTimeout(() => {
      if (!_ctx) return;
      const dur  = Math.floor(_ctx.sampleRate * 0.04);
      const buf  = _ctx.createBuffer(1, dur, _ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < dur; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (dur * 0.2));
      }
      const src  = _ctx.createBufferSource();
      src.buffer = buf;
      const filt = _ctx.createBiquadFilter();
      filt.type            = 'bandpass';
      filt.frequency.value = 400;
      filt.Q.value         = 0.8;
      const gain = _ctx.createGain();
      gain.gain.value = 3.5 + Math.random() * 1.5;
      src.connect(filt); filt.connect(gain); gain.connect(_ctx.destination);
      src.start();
    }, i * 90 + Math.random() * 30);   // irregular ~90ms spacing
  }
}

export function engineBang() {
  if (!_ctx) return;
  /* Sharp impulse — white noise burst, low-passed, rapid decay */
  const dur  = _ctx.sampleRate * 0.08;   // 80ms
  const buf  = _ctx.createBuffer(1, dur, _ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < dur; i++) {
    const env = Math.exp(-i / (dur * 0.15));   // fast decay envelope
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const src  = _ctx.createBufferSource();
  src.buffer = buf;

  const filt = _ctx.createBiquadFilter();
  filt.type            = 'lowpass';
  filt.frequency.value = 180;
  filt.Q.value         = 2.0;

  const gain = _ctx.createGain();
  gain.gain.value = 2.5;

  src.connect(filt);
  filt.connect(gain);
  gain.connect(_ctx.destination);
  src.start();
}

function _scheduleKnacken() {
  if (!_knackenActive || !_ctx) return;
  const interval = 400 + Math.random() * 1800;   // 0.4–2.2s between ticks
  _knackenTimeout = setTimeout(() => {
    if (!_knackenActive || !_ctx) return;
    /* Single metal tick — short noise, lowpass ~250Hz */
    const dur  = Math.floor(_ctx.sampleRate * 0.012);   // 12ms
    const buf  = _ctx.createBuffer(1, dur, _ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < dur; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (dur * 0.3));
    }
    const src  = _ctx.createBufferSource();
    src.buffer = buf;
    const filt = _ctx.createBiquadFilter();
    filt.type            = 'lowpass';
    filt.frequency.value = 250;
    filt.Q.value         = 2.5;
    const gain = _ctx.createGain();
    gain.gain.value = 0.55 + Math.random() * 0.25;
    src.connect(filt); filt.connect(gain); gain.connect(_ctx.destination);
    src.start();
    _scheduleKnacken();   // chain next tick
  }, interval);
}

function _playHeartbeat() {
  if (!_ctx) return;
  const now     = _ctx.currentTime;
  const elapsed = _heartStartedAt ? (Date.now() - _heartStartedAt) / 1000 : 0;
  /* Gain fades gently — starts at 0.20, gone after ~120s */
  const gain    = Math.max(0, 0.20 - elapsed * 0.0014);
  if (gain <= 0) return;

  /* Single low thump — 80ms noise burst through bandpass ~65Hz */
  const dur  = Math.floor(_ctx.sampleRate * 0.08);
  const buf  = _ctx.createBuffer(1, dur, _ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < dur; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (dur * 0.25));
  }
  const src   = _ctx.createBufferSource();
  src.buffer  = buf;
  const filt  = _ctx.createBiquadFilter();
  filt.type            = 'bandpass';
  filt.frequency.value = 65;
  filt.Q.value         = 1.2;
  const gNode = _ctx.createGain();
  gNode.gain.setValueAtTime(gain, now);
  gNode.gain.setTargetAtTime(0, now + 0.04, 0.02);
  src.connect(filt); filt.connect(gNode); gNode.connect(_ctx.destination);
  src.start(now);
}

function _scheduleHeartbeat() {
  if (!_heartActive || !_ctx) return;
  const elapsed  = _heartStartedAt ? (Date.now() - _heartStartedAt) / 1000 : 0;
  /* Slows from 75bpm (800ms) to 45bpm (1333ms) over 90s */
  const interval = Math.min(1333, 800 + elapsed * 5.9);
  _heartTimeout  = setTimeout(() => {
    if (!_heartActive || !_ctx) return;
    _playHeartbeat();
    _scheduleHeartbeat();
  }, interval);
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

export function silenceAll() {
  if (!_ctx) return;
  const now = _ctx.currentTime;
  _master?.gain.setTargetAtTime(0, now, 0.5);
  _windGain?.gain.setTargetAtTime(0, now, 0.5);
  _flapGain?.gain.setTargetAtTime(0, now, 0.5);
  _groundGain?.gain.setTargetAtTime(0, now, 0.5);
  _hissGain?.gain.setTargetAtTime(0, now, 0.5);
  _knackenActive = false;
  clearTimeout(_knackenTimeout);
  _knackenTimeout = null;
  _heartActive  = false;
  clearTimeout(_heartTimeout);
  _heartTimeout = null;
}

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
    const ePow  = S.enginePower ?? 1.0;
    const rpm   = _cfg.rpmIdle + (_cfg.rpmMax - _cfg.rpmIdle) * throttle * ePow;
    const gain  = _cfg.masterGain * (0.4 + 0.6 * throttle) * Math.max(0.05, ePow);

    /* Supercharger — mechanically coupled, linear with RPM */
    const lFreq = _cfg.superchargerFreqIdle + (_cfg.superchargerFreqMax - _cfg.superchargerFreqIdle) * throttle;
    const lGain = _cfg.superchargerGain * (0.15 + 0.85 * throttle);

    _workletNode.port.postMessage({ rpm, masterGain: gain, laderGain: lGain, laderFreq: lFreq, throttle });
  } else if (!_cfg.impulse) {
    const freq = _cfg.fundamentalIdle + (_cfg.fundamentalMax - _cfg.fundamentalIdle) * throttle;
    _oscs.forEach(({ osc, mult }) => osc.frequency.setTargetAtTime(freq * mult, now, 0.12));
    const gain = _cfg.masterGain * (0.35 + 0.65 * throttle);
    _master.gain.setTargetAtTime(gain, now, 0.15);
    _noiseGain?.gain.setTargetAtTime(_cfg.noiseGain * throttle, now, 0.2);
  }

  /* Wind / airframe noise — speed² × flap character */
  if (_windGain && _flapGain) {
    const spd   = S.spd ?? 0;
    const sf    = Math.min(1, spd / 120);          // linear — full at 120kt
    const flaps = (S.flaps ?? 0) / 3;             // 0 → 1

    _windGain.gain.setTargetAtTime(0.32 * sf, now, 0.3);
    _windFilt.frequency.setTargetAtTime(300 - 100 * flaps, now, 0.3);  // 300Hz clean → 200Hz full flaps
    _windFilt.Q.setTargetAtTime(0.7 - 0.3 * flaps, now, 0.3);          // broader with flaps

    _flapGain.gain.setTargetAtTime(0.20 * flaps * sf, now, 0.4);       // rumble: flaps × speed
  }

  /* Coolant hiss — rises as engine dies, then fades as steam bleeds off */
  if (_hissGain) {
    const ePow   = S.enginePower ?? 1.0;
    const damage = Math.max(0, 1 - ePow);
    /* Track when engine first fully died */
    if (ePow < 0.05) {
      if (_hissDeadAt === null) _hissDeadAt = S.time ?? 0;
    } else {
      _hissDeadAt = null;
    }
    /* Decay: steam gone after ~90s of dead engine */
    const deadSec = _hissDeadAt !== null ? Math.max(0, (S.time ?? 0) - _hissDeadAt) : 0;
    const decay   = Math.max(0, 1 - deadSec / 90);
    const hissG   = damage > 0.1 ? 0.18 * damage * decay : 0;
    _hissGain.gain.setTargetAtTime(hissG, now, 0.8);
  }

  /* Knacken — cooling metal ticks, severely damaged or dead engine */
  const ePowK = S.enginePower ?? 1.0;
  if (ePowK < 0.15 && !_knackenActive) {
    _knackenActive = true;
    _scheduleKnacken();
  } else if (ePowK >= 0.15 && _knackenActive) {
    _knackenActive = false;
    clearTimeout(_knackenTimeout);
    _knackenTimeout = null;
  }

  /* Heartbeat — Friedrich's pulse, only Wolfskopf, starts when engine fully dead */
  const isWolfskopf = S.mission?.id === 'wolfskopf-1942';
  const ePowH = S.enginePower ?? 1.0;
  if (isWolfskopf && ePowH < 0.05 && !_heartActive) {
    _heartActive    = true;
    _heartStartedAt = Date.now();
    _scheduleHeartbeat();
  } else if ((!isWolfskopf || ePowH >= 0.05) && _heartActive) {
    _heartActive  = false;
    clearTimeout(_heartTimeout);
    _heartTimeout = null;
  }

  /* Ground roll — creak and gear rumble, only while WoW */
  if (_groundGain) {
    const wow  = S.wow ?? false;
    const spd  = S.spd ?? 0;
    const gsf  = wow ? Math.min(1, spd / 40) : 0;   // rises 0→40kt on ground
    _groundGain.gain.setTargetAtTime(0.25 * gsf, now, 0.15);
    _groundFilt.frequency.setTargetAtTime(80 + 60 * gsf, now, 0.2);  // pitch rises with speed
  }

  /* Supercharger — dies with the engine */
  if (_cfg.supercharger && _lader && _laderGain) {
    const ePow  = S.enginePower ?? 1.0;
    const lFreq = _cfg.superchargerFreqIdle + (_cfg.superchargerFreqMax - _cfg.superchargerFreqIdle) * throttle;
    const lGain = _cfg.superchargerGain * (0.15 + 0.85 * throttle) * ePow;
    _lader.frequency.setTargetAtTime(lFreq, now, 0.3);
    _laderGain.gain.setTargetAtTime(lGain, now, 0.5);

    if (_cfg.supercharger2 && _lader2 && _lader2Gain) {
      const l2Freq = _cfg.supercharger2FreqIdle + (_cfg.supercharger2FreqMax - _cfg.supercharger2FreqIdle) * throttle;
      const l2Gain = _cfg.supercharger2Gain * (0.12 + 0.88 * throttle * throttle) * ePow;
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
  const workletFile = _cfg.workletFile ?? './core/db605-processor.js';
  const workletName = _cfg.workletName ?? 'db605-processor';
  try {
    await _ctx.audioWorklet.addModule(workletFile);

    _workletNode = new AudioWorkletNode(_ctx, workletName);
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
    _buildWindLayer();

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
  _buildWindLayer();
}

function _buildWindLayer() {
  /* Wind — broadband rush, shaped by airspeed */
  const wBuf  = _ctx.createBuffer(1, _ctx.sampleRate * 2, _ctx.sampleRate);
  const wData = wBuf.getChannelData(0);
  for (let i = 0; i < wData.length; i++) wData[i] = Math.random() * 2 - 1;

  _windNoise        = _ctx.createBufferSource();
  _windNoise.buffer = wBuf;
  _windNoise.loop   = true;

  _windFilt              = _ctx.createBiquadFilter();
  _windFilt.type         = 'bandpass';
  _windFilt.frequency.value = 800;
  _windFilt.Q.value      = 0.8;

  _windGain             = _ctx.createGain();
  _windGain.gain.value  = 0;

  _windNoise.connect(_windFilt);
  _windFilt.connect(_windGain);
  _windGain.connect(_ctx.destination);
  _windNoise.start();

  /* Flap rumble — low-frequency turbulence from separated flow */
  const fBuf  = _ctx.createBuffer(1, _ctx.sampleRate * 2, _ctx.sampleRate);
  const fData = fBuf.getChannelData(0);
  for (let i = 0; i < fData.length; i++) fData[i] = Math.random() * 2 - 1;

  _flapNoise        = _ctx.createBufferSource();
  _flapNoise.buffer = fBuf;
  _flapNoise.loop   = true;

  _flapFilt              = _ctx.createBiquadFilter();
  _flapFilt.type         = 'bandpass';
  _flapFilt.frequency.value = 200;
  _flapFilt.Q.value      = 0.6;

  _flapGain             = _ctx.createGain();
  _flapGain.gain.value  = 0;

  _flapNoise.connect(_flapFilt);
  _flapFilt.connect(_flapGain);
  _flapGain.connect(_ctx.destination);
  _flapNoise.start();

  /* Ground roll — airframe creak and gear rumble on grass */
  const gBuf  = _ctx.createBuffer(1, _ctx.sampleRate * 2, _ctx.sampleRate);
  const gData = gBuf.getChannelData(0);
  for (let i = 0; i < gData.length; i++) gData[i] = Math.random() * 2 - 1;

  _groundNoise        = _ctx.createBufferSource();
  _groundNoise.buffer = gBuf;
  _groundNoise.loop   = true;

  _groundFilt              = _ctx.createBiquadFilter();
  _groundFilt.type         = 'lowpass';
  _groundFilt.frequency.value = 120;
  _groundFilt.Q.value      = 1.2;

  _groundGain             = _ctx.createGain();
  _groundGain.gain.value  = 0;

  _groundNoise.connect(_groundFilt);
  _groundFilt.connect(_groundGain);
  _groundGain.connect(_ctx.destination);
  _groundNoise.start();

  /* Coolant hiss — high-pitched steam, rises as engine dies */
  const hBuf  = _ctx.createBuffer(1, _ctx.sampleRate * 2, _ctx.sampleRate);
  const hData = hBuf.getChannelData(0);
  for (let i = 0; i < hData.length; i++) hData[i] = Math.random() * 2 - 1;

  _hissNoise        = _ctx.createBufferSource();
  _hissNoise.buffer = hBuf;
  _hissNoise.loop   = true;

  _hissFilt              = _ctx.createBiquadFilter();
  _hissFilt.type         = 'highpass';
  _hissFilt.frequency.value = 3000;
  _hissFilt.Q.value      = 1.5;

  _hissGain             = _ctx.createGain();
  _hissGain.gain.value  = 0;

  _hissNoise.connect(_hissFilt);
  _hissFilt.connect(_hissGain);
  _hissGain.connect(_ctx.destination);
  _hissNoise.start();
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
  try { _noise?.stop();      } catch {}
  try { _lader?.stop();      } catch {}
  try { _lader2?.stop();     } catch {}
  try { _windNoise?.stop();  } catch {}
  try { _flapNoise?.stop();  } catch {}
  _ctx.close();
  _ctx = null; _master = null; _oscs = [];
  _noise = null; _noiseGain = null;
  _lader = null; _laderGain = null;
  _lader2 = null; _lader2Gain = null;
  _workletNode = null;
  _windNoise = null; _windFilt = null; _windGain = null;
  _flapNoise = null; _flapFilt = null; _flapGain = null;
  try { _groundNoise?.stop(); } catch {}
  _groundNoise = null; _groundFilt = null; _groundGain = null;
  try { _hissNoise?.stop(); } catch {}
  _hissNoise = null; _hissFilt = null; _hissGain = null;
  _knackenActive = false;
  clearTimeout(_knackenTimeout);
  _knackenTimeout = null;
  _heartActive  = false;
  clearTimeout(_heartTimeout);
  _heartTimeout   = null;
  _heartStartedAt = null;
  _hissDeadAt = null;
  _started = false;
}
