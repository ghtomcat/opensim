/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/sound.js
   Procedural engine sound via Web Audio API.
   Engine type defined in aircraft JSON → sound.engineType.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

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
  'nk12-turboprop': {
    // Kuznetsov NK-12MV — contra-rotating turboprop, Tu-95 Bear
    // Four engines × 15,000hp. Audible at 800km. NATO submarines tracked by sound alone.
    // Contra-rotating prop banks (6+6 blades) create a ~3.8Hz beat — the Bear heartbeat.
    // Four engines never perfectly in sync → second LFO at 3.5Hz creates the warbling
    // acoustic signature that made the Bear unmistakeable on sonar.
    fundamentalIdle: 38,            // Hz — subsonic chest rumble at idle
    fundamentalMax:  96,            // Hz — full power
    harmonics:       [1, 2, 3, 4, 5, 6, 8, 10],
    harmonicGains:   [1.0, 0.72, 0.55, 0.35, 0.20, 0.12, 0.06, 0.02],
    oscType:         'sawtooth',
    filterType:      'lowpass',
    filterFreq:      340,           // let the harmonic rasp breathe
    filterQ:         3.0,           // hard resonance peak — nasal, aggressive
    noiseGain:       0.40,          // massive prop wash — four 8-blade disks
    noiseFilterFreq: 280,           // body in the prop noise
    masterGain:      0.36,
    attackTime:      3.5,
    slewTime:        1.8,
    lfoFreq:         3.8,           // Hz — primary contra-rotation beat
    lfoDepth:        0.58,          // nearly cuts to silence at the trough
    lfoFreq2:        3.5,           // Hz — second engine pair, slightly out of sync
    lfoDepth2:       0.32,          // inter-engine warble: 0.3Hz envelope, ~3s period
    saturation:      2.8,           // tanh overdrive — prop disk grit, not a jet
    resonanceFreq:   19,            // Hz — wing/fuel-tank structural resonance
    resonanceQ:      10,            // tight bandpass — specific to this airframe geometry
    resonanceGain:   0.45,          // felt before it's heard; harmonics push into 40–80Hz
    resonanceDrift:  2.2,           // Hz — resonance shifts ±2.2Hz as fuel burns off
    resonanceDriftHz: 0.038,        // LFO freq — one full drift cycle every ~26s
    supercharger:    false,
  },
  'edf-hovercraft': {
    // Two independent EDF banks, each with sawtooth tone + duct air noise.
    // Lift EDF: Freewing DF-80-12B (Timo) / HobbyKing 64mm (Markus)
    // Thrust EDF: FMS 90mm (Timo) / FMS 50mm (Markus)
    // Plenum skirt: sub-bass pressure rumble when hovering (~50 Hz).
    edf: true,

    liftFundIdle:  620,    // Hz — low throttle spool
    liftFundMax:   5400,   // Hz — full throttle
    liftHarmonics: [1, 2, 3],
    liftHarmGains: [1.0, 0.38, 0.10],
    liftFilterFreq: 1364,  // initial value (620 Hz × 2.2) — tickSound tracks pitch dynamically
    liftFilterQ:    1.4,
    liftNoiseFreq:  3200,  // highpass — air rushing in duct
    liftNoiseGain:  0.22,
    liftGain:       0.35,

    thrFundIdle:  420,     // larger-diameter fan → lower pitch
    thrFundMax:   3600,
    thrHarmonics: [1, 2, 3],
    thrHarmGains: [1.0, 0.42, 0.12],
    thrFilterFreq: 924,    // initial value — tickSound will track pitch × 2.2
    thrFilterQ:    1.0,
    thrNoiseFreq:  2200,
    thrNoiseGain:  0.18,
    thrGain:       0.24,

    skirtFreq:   50,       // Hz — plenum air cushion, felt before heard
    skirtGain:   0.10,

    rushFreqLo:  180,      // Hz — broadband duct rush, lower shelf
    rushFreqHi:  1100,     // Hz — upper shelf
    rushGain:    0.28,     // rises with throttle — air pushed through hull + skirt gap

    slewTime:    0.04,     // 40 ms — electric motors spool almost instantly
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
    superchargerFreqIdle:   700,  /* measured: ~650 Hz at true idle ~750 RPM, Hahnenweide */
    superchargerFreqMax:   2500,  /* measured: ~2270 Hz at throttle blip ~2450 RPM */
    superchargerGain:      0.45,
    supercharger2:         true,
    supercharger2FreqIdle: 1097,
    supercharger2FreqMax:  1400,
    supercharger2Gain:     0.18,
  },
  'radial-2000hp': {
    // Pratt & Whitney R-2800-8 Double Wasp — impulse-based synthesis
    // 18 cylinders, twin-row (9 front + 9 rear), single-stage two-speed supercharger
    // Calibration target: https://www.youtube.com/watch?v=P1cTOLemXLA
    // Measured warm idle: ~750 RPM (56.5 Hz fundamental × 120/9)
    // Harmonic series extends to 8-9× fundamental (~450-500 Hz at idle)
    // Throttle push at 2:36 → ~860-1077 RPM max in ground recording
    // See docs/sound-calibration.md for methodology
    impulse:          true,
    workletFile:      './core/r2800-processor.js',
    workletName:      'r2800-processor',
    rpmIdle:          750,
    rpmMax:           2700,
    masterGain:       0.78,
    // Single-stage supercharger — lower, thicker whine than DB 605
    // Supercharger: 479-584 Hz peaks in reference are 8-9th harmonics of firing,
    // not the supercharger. Real impeller frequency (7.5:1 gear, ~16 blades):
    //   750 RPM × 7.5 × 16/60 ≈ 1500 Hz idle → 4050 Hz at 2700 RPM
    // Largely masked by cowling in outside recording — subtle in synthesis.
    supercharger:          true,
    superchargerFreqIdle: 1500,     // Hz — impeller fundamental at ~750 RPM idle
    superchargerFreqMax:  4050,     // Hz — at 2700 RPM combat power
    superchargerGain:     0.018,    // barely-there — 1500 Hz sits in hearing sensitivity peak; must be very low
  },
};

export const ENGINE_TYPES = Object.keys(ENGINES);

export function getCurrentRpm() {
  if (!_cfg) return null;

  /* During engine startup: compute RPM from elapsed time, matching synthesis curves */
  if (_lifecycleStartedAt !== null && _ctx) {
    const elapsed = _ctx.currentTime - _lifecycleStartedAt;
    if (_engineType === 'radial-2000hp') {
      /* R-2800: flywheel(cold26s/warm12s/hot0s) → klonk(0.18s) → motoring(2.8s) → runup(35s) */
      const oilC       = S.oilTempC ?? 15;
      const flywheelDur = oilC >= 60 ? 0 : oilC >= 30 ? 12.0 : 26.0;
      const motorStart  = oilC >= 60 ? 0 : flywheelDur + 0.06 + 0.18 + 0.06;
      const runStart    = motorStart + 2.8 + 0.06;
      if (elapsed < motorStart) return '--- RPM';                    // flywheel phase
      if (elapsed < runStart) {
        const p = Math.min(1, (elapsed - motorStart) / 2.8);
        return Math.round(65 - p * 18) + ' RPM';                    // motoring 65→47
      }
      const p = Math.min(1, (elapsed - runStart) / 35.0);
      const idleRpm = _cfg?.rpmIdle ?? 750;
      return Math.round(65 + (idleRpm - 65) * Math.pow(p, 0.6)) + ' RPM';  // runup 65→idle
    }
    /* v12-supercharged: flywheel(cold26s) → klonk → motoring(2.8s) → runup(42s) */
    const runStart = 26.0 + 0.06 + 0.18 + 0.06 + 2.8 + 0.06;   // 29.16s
    if (elapsed < 26.0) return '--- RPM';                          // flywheel only
    if (elapsed < runStart) {
      const p = Math.min(1, (elapsed - 26.0 - 0.06 - 0.18 - 0.06) / 2.8);
      return Math.round(65 - p * 18) + ' RPM';                     // motoring 65→47
    }
    const p = Math.min(1, (elapsed - runStart) / 42.0);
    const idleRpm = _cfg?.rpmIdle ?? 1000;
    return Math.round(80 + (idleRpm - 80) * Math.pow(p, 0.55)) + ' RPM';  // runup 80→idle
  }

  /* During shutdown: exponential decay from _shutdownRpm */
  if (S.engineState === 'shutdown' && _shutdownAt !== null && _ctx) {
    const elapsed = _ctx.currentTime - _shutdownAt;
    const rpm = Math.max(0, _shutdownRpm * Math.exp(-elapsed / 1.2));
    if (rpm < 5) return '--- RPM';
    return Math.round(rpm) + ' RPM';
  }

  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 350;
  const throttle = Math.max(0, Math.min(1, S.spdT / maxSpd));
  const ePow     = S.enginePower ?? 1.0;
  if (ePow <= 0) return '---';
  if (_cfg.impulse || _cfg.showRpm) {
    const rpm = Math.round((_cfg.rpmIdle + (_cfg.rpmMax - _cfg.rpmIdle) * throttle) * Math.max(0.05, ePow));
    return rpm + ' RPM';
  } else {
    const n1 = Math.round(20 + 80 * throttle);
    return 'N1 ' + n1 + '%';
  }
}

/* Numeric RPM for gauges — null if engine off or non-RPM display */
export function getRpmValue() {
  const str = getCurrentRpm();
  if (!str || str.startsWith('---') || str.startsWith('N1')) return null;
  return parseInt(str, 10) || null;
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
let _workletMute  = null;   // GainNode between worklet and _master — 0 during startup, 1 after
let _workletReady = false;

/* ── Engine lifecycle (v12-supercharged only) ── */
let _lastRpm         = 1000;   // last computed RPM — used by shutdown synth
let _shutdownRpm     = 0;      // RPM at moment of shutdown — for gauge decay
let _shutdownAt      = null;   // _ctx.currentTime when shutdown began
let _engineType      = null;   // current engine type string
let _lifecycleSrc    = null;   // BufferSource playing startup sequence
let _lifecycleStartedAt = null; // _ctx.currentTime when startup began
let _workletLoadDone = false;  // flag: worklet loaded during startup

/* ── Internal state — saturation stage ── */
let _waveshaper   = null;

/* ── Internal state — contra-rotation LFOs (NK-12) ── */
let _lfoOsc       = null;
let _lfoGain      = null;
let _lfoOsc2      = null;   // second engine pair — slightly offset freq
let _lfoGain2     = null;

/* ── Internal state — airframe structural resonance (NK-12) ── */
let _resOsc       = null;   // sub-bass standing wave (~19Hz)
let _resFilt      = null;
let _resGain      = null;
let _resDriftOsc  = null;   // very slow LFO — resonance drifts as fuel burns
let _resDriftGain = null;

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

/* ── EDF hovercraft nodes ── */
let _edfLiftOscs     = [];    // [{ osc, mult }]
let _edfLiftGain     = null;
let _edfLiftFilt     = null;
let _edfLiftNoiseSrc = null;
let _edfLiftNoiseFilt= null;
let _edfLiftNoiseGain= null;

let _edfThrOscs      = [];
let _edfThrGain      = null;
let _edfThrFilt      = null;
let _edfThrNoiseSrc  = null;
let _edfThrNoiseFilt = null;
let _edfThrNoiseGain = null;

let _edfSkirtSrc  = null;
let _edfSkirtFilt = null;
let _edfSkirtGain = null;

let _edfRushSrc   = null;
let _edfRushFiltLo= null;
let _edfRushFiltHi= null;
let _edfRushGain  = null;

/* ── Flap motor — whirr while travelling, thunk at stop ── */
let _flapStep       = null;   // last flap position processed by sound
let _flapMotorTimer = null;

/* ── Knacken — cooling metal ticks, dead engine in arctic air ── */
let _knackenActive  = false;
let _knackenTimeout = null;

/* ── Hiss decay — steam dies after coolant fully bleeds off ── */
let _hissDeadAt = null;   /* S.time when engine first reached full death */

/* ── Heartbeat — Friedrich's pulse slowing in the arctic cold ── */
let _heartActive    = false;
let _heartTimeout   = null;
let _heartStartedAt = null;   /* Date.now() when heartbeat first started */

/* ── NIFLHEIM presence sound — three inharmonic drones, vast and deep ── */
let _niflheimOscs = [];   /* { osc, gain } */
let _niflheimGain = null;
let _niflheimOn   = false;

/* ── Public API ── */

export function initSound(engineType) {
  _engineType = engineType ?? 'geared-turbofan';
  _cfg = ENGINES[_engineType] ?? ENGINES['geared-turbofan'];
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

export function coolantHiss() {
  if (!_ctx) return;
  /* Sustained steam hiss — coolant escaping under pressure, 2.5s fade */
  const dur  = _ctx.sampleRate * 2.5;
  const buf  = _ctx.createBuffer(1, dur, _ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < dur; i++) {
    const env = Math.exp(-i / (dur * 0.5));   // slow exponential fade
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const src  = _ctx.createBufferSource();
  src.buffer = buf;

  const hp = _ctx.createBiquadFilter();
  hp.type            = 'highpass';
  hp.frequency.value = 1200;   // steam — high, breathy

  const lp = _ctx.createBiquadFilter();
  lp.type            = 'lowpass';
  lp.frequency.value = 5000;

  const gain = _ctx.createGain();
  gain.gain.value = 1.2;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(gain);
  gain.connect(_ctx.destination);
  src.start();
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

/* ── Flap motor ── */
function _flapMotorWhirr() {
  if (!_ctx) return;
  clearTimeout(_flapMotorTimer);

  const now = _ctx.currentTime;
  const dur = 2.2;                          // seconds of actuator travel

  /* ── Noise layer — bandpass, frequency envelope: spool up → hold → spool down ── */
  const nBuf  = _ctx.createBuffer(1, Math.ceil(_ctx.sampleRate * dur), _ctx.sampleRate);
  const nData = nBuf.getChannelData(0);
  for (let i = 0; i < nData.length; i++) nData[i] = Math.random() * 2 - 1;

  const nSrc  = _ctx.createBufferSource();
  nSrc.buffer = nBuf;

  const nFilt = _ctx.createBiquadFilter();
  nFilt.type  = 'bandpass';
  nFilt.Q.value = 3.2;
  nFilt.frequency.setValueAtTime(260,  now);
  nFilt.frequency.linearRampToValueAtTime(440, now + 0.25);   // spool up
  nFilt.frequency.setValueAtTime(440,  now + dur - 0.35);
  nFilt.frequency.linearRampToValueAtTime(260, now + dur);    // spool down

  const nGain = _ctx.createGain();
  nGain.gain.setValueAtTime(0, now);
  nGain.gain.linearRampToValueAtTime(0.28, now + 0.08);       // fast attack
  nGain.gain.setValueAtTime(0.28, now + dur - 0.12);
  nGain.gain.linearRampToValueAtTime(0, now + dur);

  nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(_ctx.destination);
  nSrc.start(now); nSrc.stop(now + dur);

  /* ── Oscillator layer — gearbox fundamental ~72Hz, sawtooth ── */
  const mOsc  = _ctx.createOscillator();
  mOsc.type   = 'sawtooth';
  mOsc.frequency.setValueAtTime(58,  now);
  mOsc.frequency.linearRampToValueAtTime(74, now + 0.25);
  mOsc.frequency.setValueAtTime(74,  now + dur - 0.35);
  mOsc.frequency.linearRampToValueAtTime(58, now + dur);

  const mFilt = _ctx.createBiquadFilter();
  mFilt.type  = 'lowpass';
  mFilt.frequency.value = 180;
  mFilt.Q.value = 1.5;

  const mGain = _ctx.createGain();
  mGain.gain.setValueAtTime(0, now);
  mGain.gain.linearRampToValueAtTime(0.14, now + 0.1);
  mGain.gain.setValueAtTime(0.14, now + dur - 0.15);
  mGain.gain.linearRampToValueAtTime(0, now + dur);

  mOsc.connect(mFilt); mFilt.connect(mGain); mGain.connect(_ctx.destination);
  mOsc.start(now); mOsc.stop(now + dur);

  /* ── Thunk at end of travel ── */
  _flapMotorTimer = setTimeout(() => {
    if (!_ctx) return;
    const t    = _ctx.currentTime;
    const tDur = Math.floor(_ctx.sampleRate * 0.055);
    const tBuf = _ctx.createBuffer(1, tDur, _ctx.sampleRate);
    const tData = tBuf.getChannelData(0);
    for (let i = 0; i < tDur; i++)
      tData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (tDur * 0.18));
    const tSrc  = _ctx.createBufferSource();  tSrc.buffer = tBuf;
    const tFilt = _ctx.createBiquadFilter();
    tFilt.type = 'lowpass'; tFilt.frequency.value = 220; tFilt.Q.value = 1.8;
    const tGain = _ctx.createGain(); tGain.gain.value = 0.9;
    tSrc.connect(tFilt); tFilt.connect(tGain); tGain.connect(_ctx.destination);
    tSrc.start(t);
    _flapMotorTimer = null;
  }, (dur - 0.05) * 1000);
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

function _niflheimStart() {
  if (!_ctx || _niflheimOn) return;
  _niflheimOn = true;
  const now = _ctx.currentTime;

  _niflheimGain = _ctx.createGain();
  _niflheimGain.gain.setValueAtTime(0, now);
  _niflheimGain.gain.setValueAtTime(0, now);
  _niflheimGain.gain.setTargetAtTime(0.45, now, 3.0);
  _niflheimGain.connect(_ctx.destination);

  /* 4Hz LFO — tremolo that reads as something breathing, something wrong */
  const lfo     = _ctx.createOscillator();
  const lfoGain = _ctx.createGain();
  lfo.frequency.value  = 4.1;
  lfoGain.gain.value   = 0.18;
  lfo.connect(lfoGain);
  lfoGain.connect(_niflheimGain.gain);
  lfo.start(now);
  _niflheimOscs.push({ osc: lfo, g: lfoGain });

  /* Low beating pair — 5Hz beat between them, heard as slow pulse in the chest */
  [{ f: 83, gv: 0.55 }, { f: 88, gv: 0.50 }].forEach(({ f, gv }, i) => {
    const osc = _ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.setTargetAtTime(f * 1.004, now + 4 + i * 2, 6);
    const g = _ctx.createGain(); g.gain.value = gv;
    osc.connect(g); g.connect(_niflheimGain); osc.start(now);
    _niflheimOscs.push({ osc, g });
  });

  /* High rising tone — starts low, climbs toward something unbearable */
  const highOsc = _ctx.createOscillator();
  highOsc.type = 'sine';
  highOsc.frequency.setValueAtTime(520, now);
  highOsc.frequency.setTargetAtTime(980, now + 2, 8);   /* rises over 8s */
  const highG = _ctx.createGain(); highG.gain.value = 0.22;
  highOsc.connect(highG); highG.connect(_niflheimGain); highOsc.start(now);
  _niflheimOscs.push({ osc: highOsc, g: highG });

  /* Very high thin tone — 2300Hz, barely there, like something ancient resonating */
  const shrillOsc = _ctx.createOscillator();
  shrillOsc.type = 'sine';
  shrillOsc.frequency.setValueAtTime(2310, now);
  shrillOsc.frequency.setTargetAtTime(2290, now + 5, 4);
  const shrillG = _ctx.createGain(); shrillG.gain.value = 0.08;
  shrillOsc.connect(shrillG); shrillG.connect(_niflheimGain); shrillOsc.start(now);
  _niflheimOscs.push({ osc: shrillOsc, g: shrillG });
}

function _niflheimStop() {
  if (!_ctx || !_niflheimOn) return;
  _niflheimOn = false;
  const now = _ctx.currentTime;
  _niflheimGain?.gain.setTargetAtTime(0, now, 2.0);   /* slow fade — it descends */
  setTimeout(() => {
    _niflheimOscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
    _niflheimOscs = [];
    try { _niflheimGain?.disconnect(); } catch {}
    _niflheimGain = null;
  }, 8000);
}

export function startSound(engineType) {
  if (engineType) _cfg = ENGINES[engineType] ?? ENGINES['geared-turbofan'];
  if (!_cfg) _cfg = ENGINES['geared-turbofan'];
  if (_started) _teardown();

  _ctx    = new AudioContext();
  _master = _ctx.createGain();
  _master.gain.value = 0;

  /* Saturation (waveshaper) — tanh overdrive for engines that need grit */
  if (_cfg.saturation) {
    _waveshaper = _ctx.createWaveShaper();
    const k     = _cfg.saturation;
    const N     = 512;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x    = (i * 2 / (N - 1)) - 1;         // -1…+1
      curve[i]   = (1 + k) * x / (1 + k * Math.abs(x));   // soft-knee overdrive
    }
    _waveshaper.curve     = curve;
    _waveshaper.oversample = '4x';
    _master.connect(_waveshaper);
    _waveshaper.connect(_ctx.destination);
  } else {
    _master.connect(_ctx.destination);
  }

  if (_cfg.impulse) {
    _startWorkletEngine();   /* async — sets _started when ready */
  } else if (_cfg.edf) {
    _startEdfEngine();
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
  _niflheimStop();
}

export function switchEngine(type) {
  const wasRunning = _started;
  _teardown();
  _cfg = ENGINES[type] ?? ENGINES['geared-turbofan'];
  if (wasRunning) startSound();
}

export function tickSound() {
  if (!_ctx || !_cfg) return;

  /* Wind survives engine shutdown — update it whenever AudioContext is alive */
  if (!_started) {
    if (_windGain && _flapGain) {
      const now   = _ctx.currentTime;
      const spd   = S.spd ?? 0;
      const sf    = Math.min(1, spd / 120);
      const flaps = (S.flaps ?? 0) / 3;
      const propTurb = 1 + (1 - (S.enginePower ?? 1.0)) * 0.5;
      _windGain.gain.setTargetAtTime(0.32 * sf * propTurb, now, 0.3);
      _windFilt.frequency.setTargetAtTime(300 - 100 * flaps, now, 0.3);
      _windFilt.Q.setTargetAtTime(0.7 - 0.3 * flaps, now, 0.3);
      _flapGain.gain.setTargetAtTime(0.18 * flaps * sf, now, 0.3);
    }
    return;
  }

  const maxSpd   = S.aircraft?.envelope?.maxSpd ?? 350;
  const throttle = Math.max(0, Math.min(1, S.spdT / maxSpd));
  const now      = _ctx.currentTime;

  if (_cfg.impulse && _workletNode && _workletReady) {
    const ePow  = S.enginePower ?? 1.0;
    const dead  = ePow <= 0;
    const rpm   = dead ? _cfg.rpmIdle * 0.3
                       : _cfg.rpmIdle + (_cfg.rpmMax - _cfg.rpmIdle) * throttle * ePow;
    _lastRpm    = rpm;
    const gain  = dead ? 0
                       : _cfg.masterGain * (0.4 + 0.6 * throttle) * Math.max(0.05, ePow);

    /* Drive _master.gain — spool down over 1.5s when engine dies */
    _master.gain.setTargetAtTime(gain, now, dead ? 1.5 : 0.08);

    /* Supercharger — mechanically coupled, linear with RPM */
    const lFreq = _cfg.superchargerFreqIdle + (_cfg.superchargerFreqMax - _cfg.superchargerFreqIdle) * throttle;
    const lGain = _cfg.superchargerGain * (0.15 + 0.85 * throttle);

    _workletNode.port.postMessage({ rpm, laderGain: lGain, laderFreq: lFreq, throttle });
  } else if (_cfg.edf) {
    /* ── EDF hovercraft — two independent fan banks ── */
    /* Read commanded throttle directly — immediate slider response */
    const pfx = S.hcActive === 'markus' ? 'hcM' : 'hc';
    const liftT    = Math.max(0, Math.min(1, S[pfx + 'LiftAct']   ?? 0));  // post-autonomy
    const thrT     = Math.max(0, Math.min(1, S[pfx + 'ThrActPct'] ?? 0));  // post-autonomy
    const pressure = S[pfx + 'Pressure'] ?? 0;
    const slew     = _cfg.slewTime;

    /* Lift EDF — frequency and gain follow commanded lift throttle */
    const liftFreq = _cfg.liftFundIdle + (_cfg.liftFundMax - _cfg.liftFundIdle) * liftT;
    _edfLiftOscs.forEach(({ osc, mult }) =>
      osc.frequency.setTargetAtTime(liftFreq * mult, now, slew));
    _edfLiftFilt?.frequency.setTargetAtTime(liftFreq * 2.2, now, slew);  // bandpass tracks pitch
    _edfLiftGain?.gain.setTargetAtTime(_cfg.liftGain * liftT, now, slew);
    _edfLiftNoiseGain?.gain.setTargetAtTime(_cfg.liftNoiseGain * liftT, now, slew * 2);

    /* Thrust EDF */
    const thrFreq = _cfg.thrFundIdle + (_cfg.thrFundMax - _cfg.thrFundIdle) * thrT;
    _edfThrOscs.forEach(({ osc, mult }) =>
      osc.frequency.setTargetAtTime(thrFreq * mult, now, slew));
    _edfThrFilt?.frequency.setTargetAtTime(thrFreq * 2.2, now, slew);    // bandpass tracks pitch
    _edfThrGain?.gain.setTargetAtTime(_cfg.thrGain * thrT, now, slew);
    _edfThrNoiseGain?.gain.setTargetAtTime(_cfg.thrNoiseGain * thrT, now, slew * 2);

    /* Skirt rumble — rises as plenum pressurizes, peaks when hovering */
    const skirtLevel = Math.min(1, pressure / 200) * _cfg.skirtGain;
    _edfSkirtGain?.gain.setTargetAtTime(skirtLevel, now, 0.25);

    /* Duct rush — broadband air noise, follows dominant throttle */
    const rushLevel = Math.max(liftT, thrT) * _cfg.rushGain;
    _edfRushGain?.gain.setTargetAtTime(rushLevel, now, 0.08);

  } else if (!_cfg.impulse) {
    const slew  = _cfg.slewTime ?? 0.12;
    const ePow2 = S.enginePower ?? 1.0;
    const dead2 = ePow2 <= 0;
    const freq  = _cfg.fundamentalIdle + (_cfg.fundamentalMax - _cfg.fundamentalIdle) * throttle;
    _oscs.forEach(({ osc, mult }) => osc.frequency.setTargetAtTime(freq * mult, now, slew));
    const gain  = dead2 ? 0 : _cfg.masterGain * (0.35 + 0.65 * throttle);
    _master.gain.setTargetAtTime(gain, now, dead2 ? 1.5 : slew);
    _noiseGain?.gain.setTargetAtTime(_cfg.noiseGain * throttle, now, slew * 1.5);
  }

  /* Flap motor — detect step change, trigger whirr + thunk */
  if (_flapStep === null) _flapStep = S.flaps ?? 0;
  if ((S.flaps ?? 0) !== _flapStep) {
    _flapStep = S.flaps ?? 0;
    _flapMotorWhirr();
  }

  /* Wind / airframe noise — speed² × flap character */
  if (_windGain && _flapGain) {
    const spd   = S.spd ?? 0;
    const sf    = Math.min(1, spd / 120);          // linear — full at 120kt
    const flaps = (S.flaps ?? 0) / 3;             // 0 → 1

    /* Prop drag adds airframe turbulence noise as engine dies */
    const propTurb = 1 + (1 - (S.enginePower ?? 1.0)) * 0.5;
    _windGain.gain.setTargetAtTime(0.32 * sf * propTurb, now, 0.3);
    _windFilt.frequency.setTargetAtTime(300 - 100 * flaps, now, 0.3);  // 300Hz clean → 200Hz full flaps
    _windFilt.Q.setTargetAtTime(0.7 - 0.3 * flaps, now, 0.3);          // broader with flaps

    _flapGain.gain.setTargetAtTime(0.20 * flaps * sf, now, 0.4);       // rumble: flaps × speed
  }

  /* Coolant hiss — only when cooling system has actually failed */
  if (_hissGain) {
    const failed = S.coolantState === 'failed';
    if (failed) {
      const ePow  = S.enginePower ?? 1.0;
      if (ePow < 0.05) {
        if (_hissDeadAt === null) _hissDeadAt = S.time ?? 0;
      } else {
        _hissDeadAt = null;
      }
      const deadSec = _hissDeadAt !== null ? Math.max(0, (S.time ?? 0) - _hissDeadAt) : 0;
      const decay   = Math.max(0, 1 - deadSec / 90);
      _hissGain.gain.setTargetAtTime(0.18 * decay, now, 0.8);
    } else {
      _hissDeadAt = null;
      _hissGain.gain.setTargetAtTime(0, now, 0.5);
    }
  }

  /* Knacken — hot metal cooling in cold rushing air after coolant failure */
  const ePowK  = S.enginePower ?? 1.0;
  const spdK   = S.spd ?? 0;
  const knackenOn = S.coolantState === 'failed' && ePowK < 0.15 && spdK > 40;
  if (knackenOn && !_knackenActive) {
    _knackenActive = true;
    _scheduleKnacken();
  } else if (!knackenOn && _knackenActive) {
    _knackenActive = false;
    clearTimeout(_knackenTimeout);
    _knackenTimeout = null;
  }

  /* NIFLHEIM presence — inharmonic drones while creature is visible */
  const niflheimNow = S.niflheimVisible ?? false;
  if (niflheimNow && !_niflheimOn) _niflheimStart();
  else if (!niflheimNow && _niflheimOn) _niflheimStop();

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
    const lGain = _cfg.superchargerGain * (0.28 + 0.72 * throttle) * ePow;  // 0.28 matches synthesis handoff at idle
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
    _workletMute = _ctx.createGain();
    _workletMute.gain.value = 1.0;   // no startup silence needed on this path
    _workletNode.connect(_workletMute);
    _workletMute.connect(_master);

    _master.gain.setValueAtTime(0, _ctx.currentTime);
    _master.gain.setTargetAtTime(_cfg.masterGain * 0.4, _ctx.currentTime, 0.5);

    /* Send initial parameters — worklet no longer applies masterGain internally */
    _workletNode.port.postMessage({
      rpm:       _cfg.rpmIdle,
      laderGain: 0,
      laderFreq: _cfg.superchargerFreqIdle,
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

  /* Contra-rotation LFOs — NK-12 beat frequencies */
  if (_cfg.lfoFreq && _cfg.lfoDepth) {
    _lfoOsc  = _ctx.createOscillator();
    _lfoGain = _ctx.createGain();
    _lfoOsc.type = 'sine';
    _lfoOsc.frequency.value = _cfg.lfoFreq;
    _lfoGain.gain.value = _cfg.lfoDepth * _cfg.masterGain;
    _lfoOsc.connect(_lfoGain);
    _lfoGain.connect(_master.gain);
    _lfoOsc.start();
  }
  /* Second LFO — second engine pair, slightly offset → inter-engine warble */
  if (_cfg.lfoFreq2 && _cfg.lfoDepth2) {
    _lfoOsc2  = _ctx.createOscillator();
    _lfoGain2 = _ctx.createGain();
    _lfoOsc2.type = 'sine';
    _lfoOsc2.frequency.value = _cfg.lfoFreq2;
    _lfoGain2.gain.value = _cfg.lfoDepth2 * _cfg.masterGain;
    _lfoOsc2.connect(_lfoGain2);
    _lfoGain2.connect(_master.gain);
    _lfoOsc2.start();
  }

  /* Airframe structural resonance — wing/fuel-tank standing wave.
     The Bear's aluminium wings packed with 87,000L of kerosene act as
     resonating chambers driven by the prop wash. Heard as a continuous
     sub-bass that shifts frequency as the fuel burns off.
     Routes directly to destination — independent of engine power beat. */
  if (_cfg.resonanceFreq) {
    _resOsc  = _ctx.createOscillator();
    _resFilt = _ctx.createBiquadFilter();
    _resGain = _ctx.createGain();

    _resOsc.type = 'sine';
    _resOsc.frequency.value = _cfg.resonanceFreq;

    /* Very slow drift LFO — fuel burn shifts the resonance over minutes */
    _resDriftOsc  = _ctx.createOscillator();
    _resDriftGain = _ctx.createGain();
    _resDriftOsc.type = 'sine';
    _resDriftOsc.frequency.value = _cfg.resonanceDriftHz ?? 0.038;
    _resDriftGain.gain.value     = _cfg.resonanceDrift   ?? 2;
    _resDriftOsc.connect(_resDriftGain);
    _resDriftGain.connect(_resOsc.frequency);
    _resDriftOsc.start();

    _resFilt.type            = 'bandpass';
    _resFilt.frequency.value = _cfg.resonanceFreq;
    _resFilt.Q.value         = _cfg.resonanceQ ?? 10;

    _resGain.gain.value = _cfg.resonanceGain ?? 0.35;

    _resOsc.connect(_resFilt);
    _resFilt.connect(_resGain);
    /* Bypass _master — this resonance is structural, not engine-power-dependent.
       Goes through waveshaper if present (saturation pushes 19Hz into felt 38/57Hz). */
    _resGain.connect(_waveshaper ?? _ctx.destination);
    _resOsc.start();
  }

  _buildSupercharger();
  _buildWindLayer();
}

/* ══════════════════════════════════════════════════
   EDF ENGINE — dual-fan hovercraft
   Lift EDF: sawtooth harmonics + duct air noise
   Thrust EDF: same model, lower frequency range
   Skirt rumble: plenum pressure → sub-bass noise
   ══════════════════════════════════════════════════ */

function _startEdfEngine() {
  const cfg = _cfg;

  _master.gain.value = 1.0;  // EDF banks control their own gain

  function _makeNoiseSrc() {
    const buf  = _ctx.createBuffer(1, _ctx.sampleRate * 2, _ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src  = _ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  }

  /* ── Lift EDF ── */
  _edfLiftGain = _ctx.createGain();
  _edfLiftGain.gain.value = 0;

  _edfLiftFilt = _ctx.createBiquadFilter();
  _edfLiftFilt.type = 'bandpass';
  _edfLiftFilt.frequency.value = cfg.liftFilterFreq;
  _edfLiftFilt.Q.value         = cfg.liftFilterQ;
  _edfLiftFilt.connect(_edfLiftGain);

  cfg.liftHarmonics.forEach((mult, i) => {
    const osc = _ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = cfg.liftFundIdle * mult;
    const g = _ctx.createGain();
    g.gain.value = cfg.liftHarmGains[i];
    osc.connect(g); g.connect(_edfLiftFilt);
    osc.start();
    _edfLiftOscs.push({ osc, mult });
  });

  _edfLiftNoiseSrc  = _makeNoiseSrc();
  _edfLiftNoiseFilt = _ctx.createBiquadFilter();
  _edfLiftNoiseFilt.type = 'highpass';
  _edfLiftNoiseFilt.frequency.value = cfg.liftNoiseFreq;
  _edfLiftNoiseGain = _ctx.createGain();
  _edfLiftNoiseGain.gain.value = 0;
  _edfLiftNoiseSrc.connect(_edfLiftNoiseFilt);
  _edfLiftNoiseFilt.connect(_edfLiftNoiseGain);
  _edfLiftNoiseGain.connect(_edfLiftGain);

  _edfLiftGain.connect(_master);

  /* ── Thrust EDF ── */
  _edfThrGain = _ctx.createGain();
  _edfThrGain.gain.value = 0;

  _edfThrFilt = _ctx.createBiquadFilter();
  _edfThrFilt.type = 'bandpass';
  _edfThrFilt.frequency.value = cfg.thrFilterFreq;
  _edfThrFilt.Q.value         = cfg.thrFilterQ;
  _edfThrFilt.connect(_edfThrGain);

  cfg.thrHarmonics.forEach((mult, i) => {
    const osc = _ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = cfg.thrFundIdle * mult;
    const g = _ctx.createGain();
    g.gain.value = cfg.thrHarmGains[i];
    osc.connect(g); g.connect(_edfThrFilt);
    osc.start();
    _edfThrOscs.push({ osc, mult });
  });

  _edfThrNoiseSrc  = _makeNoiseSrc();
  _edfThrNoiseFilt = _ctx.createBiquadFilter();
  _edfThrNoiseFilt.type = 'highpass';
  _edfThrNoiseFilt.frequency.value = cfg.thrNoiseFreq;
  _edfThrNoiseGain = _ctx.createGain();
  _edfThrNoiseGain.gain.value = 0;
  _edfThrNoiseSrc.connect(_edfThrNoiseFilt);
  _edfThrNoiseFilt.connect(_edfThrNoiseGain);
  _edfThrNoiseGain.connect(_edfThrGain);

  _edfThrGain.connect(_master);

  /* ── Plenum skirt rumble — bypasses master, always present when pressurized ── */
  _edfSkirtSrc  = _makeNoiseSrc();
  _edfSkirtFilt = _ctx.createBiquadFilter();
  _edfSkirtFilt.type = 'lowpass';
  _edfSkirtFilt.frequency.value = cfg.skirtFreq;
  _edfSkirtFilt.Q.value = 2.5;
  _edfSkirtGain = _ctx.createGain();
  _edfSkirtGain.gain.value = 0;
  _edfSkirtSrc.connect(_edfSkirtFilt);
  _edfSkirtFilt.connect(_edfSkirtGain);
  _edfSkirtGain.connect(_ctx.destination);

  /* ── Duct rush — broadband air noise through hull + skirt gap ── */
  _edfRushSrc   = _makeNoiseSrc();
  _edfRushFiltLo = _ctx.createBiquadFilter();
  _edfRushFiltLo.type = 'highpass';
  _edfRushFiltLo.frequency.value = cfg.rushFreqLo;
  _edfRushFiltLo.Q.value = 0.5;
  _edfRushFiltHi = _ctx.createBiquadFilter();
  _edfRushFiltHi.type = 'lowpass';
  _edfRushFiltHi.frequency.value = cfg.rushFreqHi;
  _edfRushFiltHi.Q.value = 0.5;
  _edfRushGain = _ctx.createGain();
  _edfRushGain.gain.value = 0;
  _edfRushSrc.connect(_edfRushFiltLo);
  _edfRushFiltLo.connect(_edfRushFiltHi);
  _edfRushFiltHi.connect(_edfRushGain);
  _edfRushGain.connect(_ctx.destination);

  _started   = true;
  _inStartup = false;
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

/* ══════════════════════════════════════════════════
   DB 601 ENGINE LIFECYCLE
   Synthesis functions — ported from db601-startup.html
   Only active for 'v12-supercharged' engine type.
   ══════════════════════════════════════════════════ */

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
    const motorFade = Math.min(1, Math.max(0, (duration - t) / 5.0));  // fade out over last 5s
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
  // Gear mesh tail — flywheel disengaging as first cylinders fire (~3s decay)
  const gearTailDecay = Math.exp(-1 / (3.0 * sr));
  let gearTailEnv = 0.30;                           // matches end-of-motoring level
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
    // Gear mesh tail — decays as flywheel disengages
    gearTailEnv *= gearTailDecay;
    const gearMeshFreq = Math.max(60, 240 - t * 6);   // slides down from 240 Hz as flywheel spins down
    gearToothPhase += gearMeshFreq / sr;
    if (gearToothPhase >= gearToothNextInt) { gearToothEnv += 0.35*(0.5+Math.random()); gearToothNextInt = Math.floor(gearToothPhase)+1+(Math.random()-0.5)*0.16; }
    gearToothEnv *= gearToothDecay;
    const gearSig = (gearToothEnv + noise * 0.06) * gearTailEnv;
    const raw=transient*0.3+body*noise*noiseScale;
    const nx=resR*(resX*resCos-resY*resSin)+raw, ny=resR*(resX*resSin+resY*resCos); resX=nx; resY=ny;
    const lFIdle=_cfg?.superchargerFreqIdle??700, rIdle=_cfg?.rpmIdle??400;
    const laderFreq=lFIdle*rpm/rIdle; laderPhase+=laderFreq/sr;
    const lader=(Math.sin(2*Math.PI*laderPhase)+Math.sin(4*Math.PI*laderPhase)*0.4)*Math.max(0,(progress-0.28)/0.72)*0.10;
    buf[i] = ((raw*0.05+nx*0.95)*0.8 + gearSig*0.15 + lader)*Math.min(1,t/0.06);
  }
  return buf;
}

function _synthShutdown(sr, startRpm = 1000) {
  const duration = 5.0, N = Math.floor(sr*duration), buf = new Float32Array(N);
  let lfsr = 0xACE1;
  const resCos = Math.cos(2*Math.PI*45/sr), resSin = Math.sin(2*Math.PI*45/sr), resR = 0.96;
  let resX = 0, resY = 0;
  const transDecay = Math.exp(-300/sr);
  let bodyDecay = Math.exp(-55/sr), noiseScale = 0.2, transient = 0, body = 0;
  const firingAngles = [0,60,120,180,240,300].map(a => (a+(Math.random()-0.5)*16)%360);
  const cylinderGains = Array.from({length:6}, () => 0.4+Math.random()*1.2);
  let crankAngle = 0, laderPhase = 0;
  for (let i = 0; i < N; i++) {
    const t = i/sr;
    const rpm = Math.max(0, startRpm * Math.exp(-t/1.2));
    if (rpm < 5) break;
    if (i%128===0) { const fi=sr*10/Math.max(rpm,1), tau=Math.max(fi/3,sr*0.003); bodyDecay=Math.exp(-1/tau); noiseScale=0.2*(1-Math.exp(-fi/tau)); }
    const degPerSample = rpm/60/sr*360, prev = crankAngle;
    crankAngle = (crankAngle+degPerSample)%360;
    for (let c=0; c<firingAngles.length; c++) {
      const target=firingAngles[c];
      const crossed = crankAngle>=prev ? (prev<=target&&crankAngle>target) : (prev<=target||crankAngle>target);
      if (crossed) { const amp=cylinderGains[c]; transient+=amp; body+=amp*0.7; }
    }
    transient*=transDecay; body*=bodyDecay;
    lfsr ^= lfsr<<13; lfsr ^= lfsr>>17; lfsr ^= lfsr<<5;
    const noise=(lfsr&0xFFFF)/32768-1;
    const raw=transient*0.3+body*noise*noiseScale;
    const nx=resR*(resX*resCos-resY*resSin)+raw, ny=resR*(resX*resSin+resY*resCos); resX=nx; resY=ny;
    const lFIdle=_cfg?.superchargerFreqIdle??700, rIdle=_cfg?.rpmIdle??400;
    const laderFreq=lFIdle*rpm/rIdle; laderPhase+=laderFreq/sr;
    const lader=(Math.sin(2*Math.PI*laderPhase)+Math.sin(4*Math.PI*laderPhase)*0.4)*Math.exp(-t/0.4)*0.10;
    buf[i] = ((raw*0.05+nx*0.95)*0.8+lader)*(rpm/startRpm);
  }
  return buf;
}

function _assembleStartup(sr) {
  const oilC = S.oilTempC ?? 15;
  const gap   = Math.floor(sr * 0.06);

  let parts;
  if (oilC >= 60) {
    /* Hot engine — skip flywheel and Klonk entirely */
    const mot = _synthMotoring(sr);
    const run = _synthRunup(sr, 42.0, _cfg?.rpmIdle ?? 1000);
    parts = [mot, run];
  } else if (oilC >= 30) {
    /* Warm engine — shortened flywheel (~12 s) */
    const fw  = _synthFlywheel(sr, 12.0);
    const kl  = _synthKlonk(sr);
    const mot = _synthMotoring(sr);
    const run = _synthRunup(sr, 42.0, _cfg?.rpmIdle ?? 1000);
    parts = [fw, kl, mot, run];
  } else {
    /* Cold engine — full 26 s flywheel */
    const fw  = _synthFlywheel(sr, 26.0);
    const kl  = _synthKlonk(sr);
    const mot = _synthMotoring(sr);
    const run = _synthRunup(sr, 42.0, _cfg?.rpmIdle ?? 1000);
    parts = [fw, kl, mot, run];
  }

  const total = parts.reduce((s, p) => s + p.length + gap, 0) - gap;
  const full  = new Float32Array(total);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    full.set(parts[i], off);
    off += parts[i].length + (i < parts.length - 1 ? gap : 0);
  }
  /* Scale entire buffer so the runup endpoint (×0.8) matches worklet idle level (masterGain×0.4) */
  const scale = ((_cfg?.masterGain ?? 0.8) * 0.4) / 0.8;
  for (let i = 0; i < full.length; i++) full[i] *= scale;
  return full;
}

/* ══════════════════════════════════════════════════
   R-2800 PRE-IGNITION MOTORING
   Engine turned over by inertial starter, no combustion.
   18-cylinder twin-row compression thuds, 720° cycle.
   ══════════════════════════════════════════════════ */

function _synthR2800Motoring(sr, duration = 2.8) {
  const N = Math.floor(sr * duration);
  const buf = new Float32Array(N);

  /* 18 compression angles in 720° cycle */
  const anglesA = Array.from({ length: 9 }, (_, i) => ((i * 80) + (Math.random() - 0.5) * 8) % 720);
  const anglesB = Array.from({ length: 9 }, (_, i) => ((i * 80 + 20) + (Math.random() - 0.5) * 8) % 720);
  const compGain = Array.from({ length: 18 }, () => 0.6 + Math.random() * 0.8);

  /* Low-frequency compression resonator ~55 Hz (near R-2800 idle fundamental) */
  const resR = 0.91;
  const resCos = Math.cos(2 * Math.PI * 55 / sr);
  const resSin = Math.sin(2 * Math.PI * 55 / sr);
  let resX = 0, resY = 0;

  const transDecay = Math.exp(-180 / sr);   // ~5ms thud
  const bodyDecay  = Math.exp(-35  / sr);   // ~30ms rumble
  let trans = 0, body = 0;
  let lfsr = 0xBEEF;
  let angle = 0;

  for (let i = 0; i < N; i++) {
    const t = i / sr, progress = t / duration;
    /* RPM climbs from 20→65 as inertial starter engages — magnetos on at ~60 RPM */
    const rpm = 20 + (65 - 20) * Math.pow(progress, 0.4);
    const degs = rpm * 360 / 60 / sr;
    const prev = angle;
    angle = (angle + degs) % 720;

    /* Compression thuds — soft, no bang (no ignition) */
    for (let c = 0; c < 9; c++) {
      if ((prev < anglesA[c] && angle >= anglesA[c]) || (prev > angle && (anglesA[c] >= prev || anglesA[c] < angle))) {
        const amp = compGain[c] * 0.28;
        trans += amp; body += amp * 0.6;
      }
      if ((prev < anglesB[c] && angle >= anglesB[c]) || (prev > angle && (anglesB[c] >= prev || anglesB[c] < angle))) {
        const amp = compGain[9 + c] * 0.25;
        trans += amp; body += amp * 0.6;
      }
    }
    trans *= transDecay;
    body  *= bodyDecay;

    lfsr ^= lfsr << 13; lfsr ^= lfsr >> 17; lfsr ^= lfsr << 5;
    const noise = (lfsr & 0xFFFF) / 32768 - 1;
    const raw = trans * 0.5 + body * noise * 0.25;

    const nx = resR * (resX * resCos - resY * resSin) + raw;
    const ny = resR * (resX * resSin + resY * resCos);
    resX = nx; resY = ny;

    buf[i] = (raw * 0.20 + nx * 0.80) * Math.min(1, t / 0.04) * 1.2;
  }
  return buf;
}

/* ══════════════════════════════════════════════════
   R-2800 ENGINE LIFECYCLE
   Twin-row 18-cylinder model — matches r2800-processor.js exactly.
   Per-cylinder engagement thresholds give the characteristic
   "unrund" (rough running) as cylinders catch one by one.
   ══════════════════════════════════════════════════ */

function _synthR2800Runup(sr, duration = 35.0, targetRpm = 750) {
  const N = Math.floor(sr * duration);
  const buf = new Float32Array(N);

  /* Twin-row 18-cylinder model */
  const firingAnglesA = Array.from({ length: 9 }, (_, i) => ((i * 80) + (Math.random() - 0.5) * 10) % 720);
  const firingAnglesB = Array.from({ length: 9 }, (_, i) => ((i * 80 + 20) + (Math.random() - 0.5) * 10) % 720);
  const gainA = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);
  const gainB = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);

  /* Per-cylinder engagement thresholds — each cylinder catches at its own RPM.
     This produces the organic "unrund" as cylinders engage one by one 15→120 RPM. */
  const engRpmA = Array.from({ length: 9 }, () => 15 + Math.random() * 105);  // 15–120 RPM
  const engRpmB = Array.from({ length: 9 }, () => 15 + Math.random() * 105);

  const bangDecayA  = Math.exp(-5500 / sr);
  const bangDecayB  = Math.exp(-4800 / sr);
  const bangAmpA    = new Float32Array(9);
  const bangAmpB    = new Float32Array(9);
  const exhaustAmpA = new Float32Array(9);
  const exhaustAmpB = new Float32Array(9);

  let exhaustDecay = Math.exp(-60 / sr);
  let noiseScale = 0.18;
  let resCos = 1, resSin = 0, resX = 0, resY = 0;
  /* resR 0.96 for startup synthesis — higher Q boosts fundamental for good volume.
     The running worklet uses 0.93 (different tone target).
     masterGain is NOT applied here — assembly handles it via scale factor. */
  const resR = 0.96;
  let lfsr = 0xACE1;
  let noiseLp = 0;
  const noiseLpCoeff = Math.exp(-2 * Math.PI * 900 / sr);
  let lpState = 0;
  const lpCoeff    = Math.exp(-2 * Math.PI * 2000 / sr);
  let angle = 0;

  for (let i = 0; i < N; i++) {
    const t        = i / sr;
    const progress = Math.min(t / duration, 1);
    const rpm      = 65 + (targetRpm - 65) * Math.pow(progress, 0.6);

    if (i % 128 === 0) {
      const cyclesPerSec   = rpm / 120;
      const firingInterval = sr / (cyclesPerSec * 9);
      const tau            = Math.min(firingInterval * 0.50, sr * 0.022);
      exhaustDecay = Math.exp(-1 / tau);
      const overlap = Math.exp(-firingInterval / tau);
      noiseScale    = 0.22 * (1 - overlap);
      const omega   = 2 * Math.PI * cyclesPerSec * 9 / sr;
      resCos = Math.cos(omega);
      resSin = Math.sin(omega);
    }

    const degsPerSample = rpm * 360 / 60 / sr;
    const prev = angle;
    angle = (angle + degsPerSample) % 720;

    for (let c = 0; c < 9; c++) {
      const fa      = firingAnglesA[c];
      const crossed = (prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle));
      /* Fire only when RPM exceeds this cylinder's engagement threshold.
         Add small random flutter near threshold for organic roughness. */
      if (crossed && rpm > engRpmA[c] * (0.8 + Math.random() * 0.4)) {
        bangAmpA[c]    = gainA[c] * 0.10;
        exhaustAmpA[c] = gainA[c] * 0.55;
      }
      bangAmpA[c]    *= bangDecayA;
      exhaustAmpA[c] *= exhaustDecay;
    }
    for (let c = 0; c < 9; c++) {
      const fb      = firingAnglesB[c];
      const crossed = (prev < fb && angle >= fb) || (prev > angle && (fb >= prev || fb < angle));
      if (crossed && rpm > engRpmB[c] * (0.8 + Math.random() * 0.4)) {
        bangAmpB[c]    = gainB[c] * 0.09;
        exhaustAmpB[c] = gainB[c] * 0.52;
      }
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

    const raw = bang * 0.40 + exhaust * noiseLp * noiseScale;
    const nx  = resR * (resX * resCos - resY * resSin) + raw;
    const ny  = resR * (resX * resSin + resY * resCos);
    resX = nx; resY = ny;

    const mixed  = raw * 0.05 + nx * 0.95;
    lpState = lpCoeff * lpState + (1 - lpCoeff) * mixed;
    buf[i]  = lpState * Math.min(1, t / 0.06);
  }
  return buf;
}

function _synthR2800Shutdown(sr, startRpm = 750) {
  const duration = 4.5;
  const N = Math.floor(sr * duration);
  const buf = new Float32Array(N);

  const firingAnglesA = Array.from({ length: 9 }, (_, i) => ((i * 80) + (Math.random() - 0.5) * 10) % 720);
  const firingAnglesB = Array.from({ length: 9 }, (_, i) => ((i * 80 + 20) + (Math.random() - 0.5) * 10) % 720);
  const gainA = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);
  const gainB = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);

  const bangDecayA  = Math.exp(-5500 / sr);
  const bangDecayB  = Math.exp(-4800 / sr);
  const bangAmpA    = new Float32Array(9);
  const bangAmpB    = new Float32Array(9);
  const exhaustAmpA = new Float32Array(9);
  const exhaustAmpB = new Float32Array(9);

  let exhaustDecay = Math.exp(-60 / sr);
  let noiseScale = 0.18;
  let resCos = 1, resSin = 0, resX = 0, resY = 0;
  const resR = 0.93;
  let lfsr = 0xD00F;
  let noiseLp = 0;
  const noiseLpCoeff = Math.exp(-2 * Math.PI * 900 / sr);
  let lpState = 0;
  const lpCoeff    = Math.exp(-2 * Math.PI * 2000 / sr);
  let angle = 0;

  for (let i = 0; i < N; i++) {
    const t   = i / sr;
    const rpm = Math.max(0, startRpm * Math.exp(-t / 1.5));
    if (rpm < 5) break;

    if (i % 128 === 0) {
      const cyclesPerSec   = rpm / 120;
      const firingInterval = sr / (cyclesPerSec * 9);
      const tau            = Math.min(firingInterval * 0.50, sr * 0.022);
      exhaustDecay = Math.exp(-1 / tau);
      const overlap = Math.exp(-firingInterval / tau);
      noiseScale    = 0.22 * (1 - overlap);
      const omega   = 2 * Math.PI * cyclesPerSec * 9 / sr;
      resCos = Math.cos(omega);
      resSin = Math.sin(omega);
    }

    const degsPerSample = rpm * 360 / 60 / sr;
    const prev = angle;
    angle = (angle + degsPerSample) % 720;

    for (let c = 0; c < 9; c++) {
      const fa      = firingAnglesA[c];
      const crossed = (prev < fa && angle >= fa) || (prev > angle && (fa >= prev || fa < angle));
      if (crossed) { bangAmpA[c] = gainA[c] * 0.10; exhaustAmpA[c] = gainA[c] * 0.55; }
      bangAmpA[c]    *= bangDecayA;
      exhaustAmpA[c] *= exhaustDecay;
    }
    for (let c = 0; c < 9; c++) {
      const fb      = firingAnglesB[c];
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

    const raw = (bang * 0.40 + exhaust * noiseLp * noiseScale);
    const nx  = resR * (resX * resCos - resY * resSin) + raw;
    const ny  = resR * (resX * resSin + resY * resCos);
    resX = nx; resY = ny;

    const mixed  = raw * 0.35 + nx * 0.65;
    lpState = lpCoeff * lpState + (1 - lpCoeff) * mixed;
    buf[i]  = lpState * (rpm / startRpm);
  }
  return buf;
}

function _assembleR2800Startup(sr) {
  const oilC   = S.oilTempC ?? 15;
  const gap    = Math.floor(sr * 0.06);    // gap between flywheel/klonk segments
  const motGap = 0;                         // no gap before runup — motoring fades into first puff
  const rpmIdle = _cfg?.rpmIdle ?? 750;

  let parts;
  if (oilC >= 60) {
    /* Hot — R-2800 motoring + runup only (~38 s) */
    const mot = _synthR2800Motoring(sr);
    const run = _synthR2800Runup(sr, 35.0, rpmIdle);
    parts = [mot, run];
  } else if (oilC >= 30) {
    /* Warm — shortened flywheel (~50 s) */
    const fw  = _synthFlywheel(sr, 12.0);
    const kl  = _synthKlonk(sr);
    const mot = _synthR2800Motoring(sr);
    const run = _synthR2800Runup(sr, 35.0, rpmIdle);
    parts = [fw, kl, mot, run];
  } else {
    /* Cold — full flywheel (~64 s) */
    const fw  = _synthFlywheel(sr, 26.0);
    const kl  = _synthKlonk(sr);
    const mot = _synthR2800Motoring(sr);
    const run = _synthR2800Runup(sr, 35.0, rpmIdle);
    parts = [fw, kl, mot, run];
  }

  /* Fade out each pre-runup segment's last 80ms — smooth blend into runup's own fade-in */
  const fadeLen = Math.floor(sr * 0.08);
  for (let p = 0; p < parts.length - 1; p++) {
    const seg = parts[p];
    for (let i = 0; i < fadeLen && i < seg.length; i++) {
      seg[seg.length - 1 - i] *= i / fadeLen;
    }
  }

  /* Normal gap between flywheel/klonk; zero gap into runup — motoring fades directly in */
  const lastIdx = parts.length - 1;
  let r2800Total = 0;
  for (let i = 0; i < parts.length; i++) {
    r2800Total += parts[i].length;
    if (i < lastIdx) r2800Total += (i === lastIdx - 1) ? motGap : gap;
  }
  const full  = new Float32Array(r2800Total);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    full.set(parts[i], off);
    if (i < lastIdx) off += parts[i].length + ((i === lastIdx - 1) ? motGap : gap);
  }
  /* Scale so runup endpoint matches worklet idle level: masterGain × 0.4.
     _synthR2800Runup does NOT apply masterGain internally (consistent with DB605). */
  const scale = ((_cfg?.masterGain ?? 0.78) * 0.4) / 0.8;
  for (let i = 0; i < full.length; i++) full[i] *= scale;
  return full;
}

async function _loadWorkletSilently() {
  _workletLoadDone = false;
  const workletFile = _cfg.workletFile ?? './core/db605-processor.js';
  const workletName = _cfg.workletName ?? 'db605-processor';
  try {
    await _ctx.audioWorklet.addModule(workletFile);
    _workletNode = new AudioWorkletNode(_ctx, workletName);
    _workletMute = _ctx.createGain();
    _workletMute.gain.value = 0;   // silent during startup — unmuted at handoff
    _workletNode.connect(_workletMute);
    _workletMute.connect(_master);
    _workletNode.port.postMessage({ rpm: _cfg.rpmIdle, laderGain: 0, laderFreq: _cfg.superchargerFreqIdle });
    _buildSupercharger();
    _buildWindLayer();
  } catch (err) {
    console.warn('DB 601 worklet pre-load failed:', err);
  }
  _workletLoadDone = true;
}

/* ══════════════════════════════════════════════════
   LYCOMING IO-360 STARTUP
   Electric starter whirr (~1.2s) → prop catch → idle
   ══════════════════════════════════════════════════ */
function _assembleLycomingStartup(sr) {
  const dur  = 2.8;   // total seconds: 1.2s starter + 0.4s catch + 1.2s settle
  const N    = Math.floor(sr * dur);
  const buf  = new Float32Array(N);

  const starterDur = 1.2;   // electric starter
  const catchAt    = 1.2;   // first combustion
  const catchDur   = 0.4;   // rough run-up

  for (let i = 0; i < N; i++) {
    const t = i / sr;
    let s = 0;

    /* ── Electric starter — rising DC motor whirr ── */
    if (t < starterDur + 0.05) {
      const p    = Math.min(1, t / starterDur);
      const freq = 60 + 180 * p;            // 60→240 Hz as motor spools
      const env  = Math.min(1, t * 8) * (t < starterDur ? 1 : Math.max(0, 1 - (t - starterDur) * 10));

      /* Motor fundamental + harmonics */
      s += 0.30 * env * Math.sin(2 * Math.PI * freq * t);
      s += 0.15 * env * Math.sin(2 * Math.PI * freq * 2 * t);
      s += 0.08 * env * Math.sin(2 * Math.PI * freq * 3 * t);

      /* Gear rattle — broadband buzz */
      const lfsr_t = Math.sin(2 * Math.PI * 380 * t) * Math.sin(2 * Math.PI * 7.3 * t);
      s += 0.06 * env * lfsr_t;
    }

    /* ── Prop catch — first cylinders firing, rough ── */
    if (t >= catchAt && t < catchAt + catchDur) {
      const p   = (t - catchAt) / catchDur;
      const rpm = 400 + 500 * p;            // 400→900 RPM rough
      const cyc = sr * 60 / (rpm * 2);     // samples per 4-stroke cycle (2 rev/firing)
      const pos = (i - Math.floor(catchAt * sr)) % Math.max(1, Math.floor(cyc));
      if (pos < 3) {                         // impulse at TDC
        const bang = (1 - p * 0.3) * 0.9;
        buf[i] += bang;
      }
      /* Rough idle noise */
      s += 0.12 * (Math.random() * 2 - 1) * (0.3 + 0.7 * p);
    }

    /* ── Settle to idle — 4-cylinder impulses ── */
    if (t >= catchAt + catchDur) {
      const p    = Math.min(1, (t - catchAt - catchDur) / 1.0);
      const rpm  = 900 + 500 * p * p;       // 900→1400 RPM settling
      const cyc  = sr * 60 / (rpm * 2);
      const pos  = (i - Math.floor((catchAt + catchDur) * sr)) % Math.max(1, Math.floor(cyc));
      if (pos < 3) {
        buf[i] += 0.6 + 0.3 * p;
      }
      /* Exhaust resonance — 95Hz (IO-360 exhaust note) */
      s += 0.18 * p * Math.sin(2 * Math.PI * 95 * t);
      s += 0.08 * p * Math.sin(2 * Math.PI * 190 * t);
      /* Settling noise fades */
      s += 0.08 * (1 - p) * (Math.random() * 2 - 1);
    }

    buf[i] = Math.max(-1, Math.min(1, buf[i] + s));
  }

  /* Gentle fade out at end — worklet takes over */
  const fadeLen = Math.floor(sr * 0.15);
  for (let i = 0; i < fadeLen; i++) {
    buf[N - 1 - i] *= i / fadeLen;
  }

  return buf;
}

export async function startEngineLifecycle() {
  if (_engineType !== 'v12-supercharged' && _engineType !== 'radial-2000hp' && _engineType !== 'lycoming-o360') { startSound(); return; }
  if (S.engineState === 'starting' || S.engineState === 'running' || S.engineState === 'idle') return;
  if (S.coolantState === 'failed') return;   // coolant gone — engine seizes on start attempt

  if (!_ctx) {
    _ctx    = new AudioContext();
    _master = _ctx.createGain();
    _master.gain.value = 0;
    _master.connect(_ctx.destination);
  }
  if (_ctx.state === 'suspended') await _ctx.resume();

  /* Reset engine power so fuel system re-engages after starvation restart */
  setState({ engineState: 'starting', enginePower: 0.01 });

  const startupBuf = _engineType === 'radial-2800hp'
    ? _assembleR2800Startup(_ctx.sampleRate)
    : _engineType === 'lycoming-o360'
    ? _assembleLycomingStartup(_ctx.sampleRate)
    : _assembleStartup(_ctx.sampleRate);
  const ab  = _ctx.createBuffer(1, startupBuf.length, _ctx.sampleRate);
  ab.copyToChannel(startupBuf, 0);
  const src = _ctx.createBufferSource();
  src.buffer = ab;
  /* Route through _master so gain chain is consistent with live worklet.
     Buffer already has scale baked in — set _master to 1.0 so it passes through unchanged. */
  _master.gain.value = 1.0;
  src.connect(_master);
  _lifecycleSrc = src;
  _lifecycleStartedAt = _ctx.currentTime;
  src.start();

  _loadWorkletSilently();   /* runs concurrently — worklet ready long before 71s startup ends */

  src.onended = () => {
    _lifecycleSrc = null;
    _lifecycleStartedAt = null;
    if (S.engineState !== 'starting') return;   // aborted (M pressed) — don't activate
    if (!_workletNode) { setState({ engineState: 'off' }); return; }
    console.log('[OpenSim] Engine started — worklet active, spdT:', S.spdT);
    setState({ engineState: 'running', engineTemp: Math.min(1, (S.engineTemp ?? 0) + 0.8) });

    const now = _ctx.currentTime;
    /* Unmute worklet — _workletMute fades from 0→1 over 0.3s.
       Do NOT touch _master.gain or _laderGain here: tickSound runs every frame
       and will ramp both smoothly (τ=0.08s and τ=0.5s respectively), avoiding
       the gain-product overshoot that caused a ping at handoff. */
    _workletMute?.gain.setTargetAtTime(1.0, now, 0.3);
    _workletNode.port.postMessage({ rpm: _cfg.rpmIdle, laderFreq: _cfg.superchargerFreqIdle });

    _started = true; _workletReady = true; _inStartup = false;
  };
}

export function stopEngineLifecycle() {
  if (_engineType !== 'v12-supercharged' && _engineType !== 'radial-2000hp') { stopSound(); return; }
  if (S.engineState === 'off' || S.engineState === 'shutdown') return;

  _workletReady = false;
  _started      = false;

  if (_lifecycleSrc) { _lifecycleSrc.onended = null; try { _lifecycleSrc.stop(); } catch {} _lifecycleSrc = null; }
  _lifecycleStartedAt = null;

  setState({ engineState: 'shutdown' });
  _shutdownRpm = _lastRpm;
  _shutdownAt  = _ctx?.currentTime ?? 0;

  if (_ctx) {
    const shutBuf = _engineType === 'radial-2000hp'
      ? _synthR2800Shutdown(_ctx.sampleRate, _lastRpm)
      : _synthShutdown(_ctx.sampleRate, _lastRpm);
    const ab  = _ctx.createBuffer(1, shutBuf.length, _ctx.sampleRate);
    ab.copyToChannel(shutBuf, 0);
    const src = _ctx.createBufferSource();
    src.buffer = ab;
    const shutGain = _ctx.createGain();
    shutGain.gain.value = _master?.gain.value ?? ((_cfg?.masterGain ?? 0.8) * 0.4 / 0.8);
    src.connect(shutGain); shutGain.connect(_ctx.destination);
    src.start();
    _master?.gain.setTargetAtTime(0, _ctx.currentTime, 0.3);
  }

  setTimeout(() => { _teardownEngine(); setState({ engineState: 'off' }); }, 5500);
}

/* ── Engine bleed tap — for radio chain environment mixing ── */
export function getAudioContext()    { return _ctx ?? null; }
export function getEngineBleedNode() { return (_ctx && _master) ? _master : null; }

/* ── Engine-only teardown — leaves AudioContext + wind + flap alive ── */
function _teardownEngine() {
  _inStartup = false;
  _workletReady = false;
  try { _workletNode?.disconnect(); } catch {}
  try { _workletMute?.disconnect(); } catch {}
  _workletNode = null; _workletMute = null;
  _edfLiftOscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
  _edfThrOscs.forEach(({ osc })  => { try { osc.stop(); } catch {} });
  try { _edfLiftNoiseSrc?.stop(); } catch {}
  try { _edfThrNoiseSrc?.stop();  } catch {}
  try { _edfSkirtSrc?.stop();     } catch {}
  _edfLiftOscs = []; _edfThrOscs = [];
  _edfLiftGain = null; _edfLiftFilt = null;
  _edfLiftNoiseSrc = null; _edfLiftNoiseFilt = null; _edfLiftNoiseGain = null;
  _edfThrGain  = null; _edfThrFilt  = null;
  _edfThrNoiseSrc  = null; _edfThrNoiseFilt  = null; _edfThrNoiseGain  = null;
  _edfSkirtSrc = null; _edfSkirtFilt = null; _edfSkirtGain = null;
  try { _edfRushSrc?.stop(); } catch {}
  _edfRushSrc = null; _edfRushFiltLo = null; _edfRushFiltHi = null; _edfRushGain = null;
  _oscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
  try { _noise?.stop();      } catch {}
  try { _lader?.stop();      } catch {}
  try { _lader2?.stop();     } catch {}
  try { _lfoOsc?.stop();     } catch {}
  try { _lfoOsc2?.stop();    } catch {}
  try { _resOsc?.stop();     } catch {}
  try { _resDriftOsc?.stop();} catch {}
  _master = null; _waveshaper = null; _oscs = [];
  _noise = null; _noiseGain = null;
  _lader = null; _laderGain = null;
  _lader2 = null; _lader2Gain = null;
  _lfoOsc = null; _lfoGain = null;
  _lfoOsc2 = null; _lfoGain2 = null;
  _resOsc = null; _resFilt = null; _resGain = null;
  _resDriftOsc = null; _resDriftGain = null;
  _started = false;
}

/* ── Full teardown — kills everything including wind ── */
function _teardown() {
  if (!_ctx) return;
  _teardownEngine();
  try { _windNoise?.stop();  } catch {}
  try { _flapNoise?.stop();  } catch {}
  _ctx.close();
  clearTimeout(_flapMotorTimer); _flapMotorTimer = null; _flapStep = null;
  _ctx = null; _master = null; _waveshaper = null; _oscs = [];
  _noise = null; _noiseGain = null;
  _lader = null; _laderGain = null;
  _lader2 = null; _lader2Gain = null;
  _lfoOsc = null; _lfoGain = null;
  _lfoOsc2 = null; _lfoGain2 = null;
  _resOsc = null; _resFilt = null; _resGain = null;
  _resDriftOsc = null; _resDriftGain = null;
  _workletNode = null; _workletMute = null;
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
  _niflheimOscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
  _niflheimOscs = [];
  try { _niflheimGain?.disconnect(); } catch {}
  _niflheimGain = null;
  _niflheimOn   = false;
  _hissDeadAt = null;
  _started = false;
}
