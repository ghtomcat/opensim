/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/crew.js
   All voice output: PF, PM, ATC, GPWS.
   Data-driven from aircraft.json + mission.json via S.aircraft / S.mission.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

/* ── Voice handles ── */
let _pfVoice  = null;
let _pmVoice  = null;
let _atcVoice = null;
let _crewLang = null;   // e.g. 'ru-RU' — null = browser default

/* ── State ── */
const _atcFired       = new Set();  // indices of fired ATC clearances
let _briefFired       = false;
let _briefLock        = false;
let _checklistLock    = false;
let _prevFlaps        = 0;
let _prevGear         = false;
let _prevSpd          = 0;
let _prevWow          = false;
const _pmFired        = new Set();   // altitude callout thresholds already fired
const _gpwsFired      = new Set();   // GPWS callout altitudes already fired
const _takeoffFired   = new Set();   // takeoff speed callouts already fired

/* ── Rocket event tracking ── */
let _prevVelMs        = 0;
let _prevDynQ         = 0;
let _prevRocketCoast  = false;
let _prevRocketStage  = 1;
let _prevRocketSECO   = false;
let _prevOrbit        = false;
let _secoTime          = -1;         // mission time when SECO occurred, -1 = not yet
let _prevActiveEngines = null;       // track engine count drops
let _prevCECO          = false;      // track G-triggered CECO
const _rocketFired    = new Set();   // named rocket events already fired

/* ── Audio file map — override TTS for key phrases ── */
const AUDIO_FILES = {
  'grüezi':      'audio/grüezi.mp3',
  'good night':  'audio/good-night.mp3',
  'guete morge': 'audio/guete-morge.mp3',
};

/* ═══ Public API ══════════════════════════════════════════════ */

export function initCrew() {
  _loadVoices();
}

/** Switch crew language — call after aircraft JSON loads */
export function setCrewLang(lang) {
  _crewLang = lang || null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) {
    setTimeout(() => setCrewLang(_crewLang), 300);
    return;
  }

  if (_crewLang) {
    const prefix = _crewLang.slice(0, 2).toLowerCase();
    const langVoices = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
    if (langVoices.length) {
      _pfVoice  = langVoices[0];
      _pmVoice  = langVoices[1] ?? langVoices[0];
      _atcVoice = langVoices[2] ?? langVoices[0];
      return;
    }
  }
  _loadVoices();   // revert to English voices
}

/** Called every frame by loop.js */
export function tickCrew(prevAlt, currAlt) {
  const ac = S.aircraft;
  const ms = S.mission;
  if (!ac || !ms) return;

  _checkPMCallouts(prevAlt, currAlt, ac);
  _checkGPWS(prevAlt, currAlt, ac);
  _checkChecklist(prevAlt, currAlt, ac);
  _checkATC(prevAlt, currAlt, ms);
  _checkApproachBrief(prevAlt, currAlt, ms);
  _checkTakeoffCallouts(ac);

  _prevSpd = S.spd ?? 0;
  _prevWow = S.wow ?? false;

  /* Advance rocket prev-state for event edge detection */
  if (ac.vehicleType === 'rocket') {
    const alt_m  = (S.alt ?? 0) * 0.3048;
    const vel_ms = (S.spd ?? 0) * 0.5144;
    const rho    = _rhoSimple(alt_m);
    _prevVelMs        = vel_ms;
    _prevDynQ         = 0.5 * rho * vel_ms * vel_ms;
    _prevRocketCoast  = S.rocketCoast  ?? false;
    _prevRocketStage  = S.rocketStage  ?? 1;
    if (!_prevRocketSECO && (S.rocketSECO ?? false)) _secoTime = S.time ?? 0;
    _prevRocketSECO    = S.rocketSECO   ?? false;
    _prevOrbit         = _isInOrbit();
    _prevActiveEngines = S.rocketActiveEngines ?? null;
    _prevCECO          = S.rocketCECO          ?? false;
  }
}

export function resetCrew() {
  _atcFired.clear();
  _briefFired = false;
  _briefLock  = false;
  _checklistLock = false;
  _prevFlaps  = 0;
  _prevGear   = false;
  _prevSpd    = 0;
  _prevWow    = false;
  _pmFired.clear();
  _gpwsFired.clear();
  _takeoffFired.clear();
  _rocketFired.clear();
  _prevVelMs = 0; _prevDynQ = 0;
  _prevRocketCoast = false; _prevRocketStage = 1;
  _prevRocketSECO = false; _prevOrbit = false;
  _secoTime = -1;
  _prevActiveEngines = null;
  _prevCECO = false;
}

/* ── Direct speech ── */
export function speakPF(text, opts = {})  { _speak(text, _pfVoice,  { rate: 0.92, pitch: 0.88, ...opts }); }
export function speakPM(text, opts = {})  { _speak(text, _pmVoice,  { rate: 0.92, pitch: 1.18, ...opts }); }
export function speakATC(text, opts = {}) { _speak(text, _atcVoice, { rate: 1.00, pitch: 1.00, volume: 1.0, ...opts }); }

/** Challenge / response: PF speaks, then PM confirms after a pause */
export function sndCrew(pfText, pmText, delayMs = 750) {
  const u = _makeUtt(pfText, _pfVoice, { rate: 0.92, pitch: 0.88 });
  u.onend = () => setTimeout(() => speakPM(pmText), delayMs);
  _safeSpeak(u);
}

/* ═══ Private ════════════════════════════════════════════════ */

function _checkTakeoffCallouts(ac) {
  const currSpd = S.spd ?? 0;
  const currWow = S.wow ?? false;

  /* Reset when stopped on ground — allows multiple takeoffs per session */
  if (currWow && currSpd < 5 && _takeoffFired.size > 0) {
    _takeoffFired.clear();
    return;
  }

  /* Speed-based callouts (ascending) */
  if (ac.takeoffCallouts) {
    for (const { spd, speech, voice } of ac.takeoffCallouts) {
      if (_prevSpd < spd && currSpd >= spd && !_takeoffFired.has(spd)) {
        _takeoffFired.add(spd);
        const speak = voice === 'pf' ? speakPF : speakPM;
        setTimeout(() => speak(speech), 200);
      }
    }
  }

  /* Positive rate: WoW releases with climbing VS */
  if (_prevWow && !currWow && (S.vs ?? 0) > 50 && !_takeoffFired.has('positive_rate')) {
    _takeoffFired.add('positive_rate');
    setTimeout(() => speakPM('positive rate'), 400);
  }
}

function _checkPMCallouts(prev, curr, ac) {
  if (!ac.pmCallouts) return;
  if (curr >= prev) return;   // only on descent
  for (const { alt, speech } of ac.pmCallouts) {
    if (prev > alt && curr <= alt && !_pmFired.has(alt)) {
      _pmFired.add(alt);
      setTimeout(() => speakPM(speech), 600);
    }
  }
}

function _checkGPWS(prev, curr, ac) {
  if (!ac.gpws) return;
  if (curr >= prev) return;
  for (const { alt, speech, red } of ac.gpws) {
    if (prev > alt && curr <= alt && !_gpwsFired.has(alt)) {
      _gpwsFired.add(alt);
      const pitch = red ? 1.4 : 1.2;
      setTimeout(() => _speak(speech, null, { rate: 1.0, pitch, volume: 1.0 }), 200);
    }
  }
}

function _checkChecklist(prev, curr, ac) {
  if (!ac.checklist || _checklistLock) return;
  if (curr >= prev) return;

  const { flaps, gear } = ac.checklist;

  /* Gear down */
  if (gear && prev > gear.alt && curr <= gear.alt && !S.gear && S.prevGear === false) {
    _checklistLock = true;
    sndCrew(gear.pf, gear.pm, 800);
    setTimeout(() => { _checklistLock = false; }, 4000);
    return;
  }

  /* Flaps — find next config not yet set */
  if (flaps) {
    for (const step of flaps) {
      if (prev > step.alt && curr <= step.alt && S.flaps < step.config) {
        _checklistLock = true;
        sndCrew(step.pf, step.pm, 800);
        setTimeout(() => { _checklistLock = false; }, 4000);
        return;
      }
    }
  }
}

function _checkATC(prev, curr, ms) {
  if (!ms.atcClearances) return;

  ms.atcClearances.forEach((clr, idx) => {
    if (_atcFired.has(idx)) return;

    /* Determine trigger */
    let fire = false;
    if (clr.t !== undefined) {
      fire = (S.time >= clr.t);
    } else if (clr.alt !== undefined) {
      fire = (curr < prev && prev > clr.alt && curr <= clr.alt);
    } else if (clr.event !== undefined) {
      fire = _checkRocketEvent(clr.event, clr);
    }
    if (!fire) return;
    _atcFired.add(idx);

    const delay = clr.delay ?? 200;

    /* Single-voice format: { text, voice } */
    if (clr.text !== undefined) {
      const speak = clr.voice === 'pm' ? speakPM : speakATC;
      setTimeout(() => speak(clr.text), delay);
      return;
    }

    /* Call-response format: { pm, atc } — PM requests, ATC responds */
    const pmText  = clr.pm  ?? '';
    const atcText = clr.atc ?? '';

    const pmU = _makeUtt(pmText, _pmVoice, { rate: 0.92, pitch: 1.18 });
    pmU.onend = () => {
      setTimeout(() => {
        const lower = atcText.toLowerCase();
        const fileKey = Object.keys(AUDIO_FILES).find(k => lower.includes(k));
        if (fileKey) {
          const i    = lower.indexOf(fileKey);
          const pre  = atcText.slice(0, i).trim();
          const post = atcText.slice(i + fileKey.length).trim();
          const chain = post ? () => setTimeout(() => speakATC(post), 400) : () => {};
          const atcU = _makeUtt(pre || '.', _atcVoice, { rate: 1.08, pitch: 0.78 });
          atcU.onend = () => setTimeout(() => _playFile(AUDIO_FILES[fileKey], chain), 300);
          _safeSpeak(atcU);
        } else {
          speakATC(atcText);
        }
      }, 1200);
    };
    _safeSpeak(pmU);
  });
}

/* ── Rocket event detection ── */

function _rhoSimple(alt_m) {
  if (alt_m <= 11000)  return 1.225 * Math.pow((288.15 - 6.5e-3 * alt_m) / 288.15, 4.2559);
  if (alt_m <= 25000)  return 0.3639 * Math.exp(-(alt_m - 11000) / 6341.6);
  if (alt_m <= 86000)  return 0.01   * Math.exp(-(alt_m - 25000) / 7200);
  return 0;
}

function _isInOrbit() {
  const alt_m  = (S.alt ?? 0) * 0.3048;
  const vel_ms = (S.spd ?? 0) * 0.5144;
  const vOrb   = Math.sqrt(3.986004418e14 / (6371000 + alt_m));
  return vel_ms >= vOrb * 0.99 && Math.abs(S.pitch ?? 90) < 8;
}

function _checkRocketEvent(event, clr) {
  /* Each named event fires at most once per mission.
     For events reused with different delays (e.g. two 'stagesep' entries),
     use clr._uid as a tie-breaker set by the caller. */
  const uid = clr._uid ?? event;
  if (_rocketFired.has(uid)) return false;

  const alt_m  = (S.alt ?? 0) * 0.3048;
  const vel_ms = (S.spd ?? 0) * 0.5144;
  const rho    = _rhoSimple(alt_m);
  const dynQ   = 0.5 * rho * vel_ms * vel_ms;

  switch (event) {
    case 'supersonic':
      if (vel_ms > 340 && _prevVelMs <= 340) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'maxq':
      /* Q has peaked: currently falling and was above 10 kPa (well past transonic) */
      if (_prevDynQ > 10000 && dynQ < _prevDynQ * 0.985) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'stage1_nominal': {
      /* Fires when stage 1 has burned ~40% of its propellant */
      if ((S.rocketStage ?? 1) !== 1) break;
      const perf  = S.aircraft?.performance ?? {};
      const s1    = perf.stages?.[0] ?? {};
      const s2    = perf.stages?.[1] ?? {};
      const mWet  = perf.massWet ?? 28000;
      const b1    = (s1.massDry ?? 0) + (s2.massWet ?? 0) + (perf.payload ?? 0) + 5;
      const prop1 = mWet - b1;
      if ((S.rocketMass ?? mWet) <= mWet - prop1 * 0.4) {
        _rocketFired.add(uid); return true;
      }
      break;
    }

    case 'meco':
      /* Stage 1 just started coasting (burnout) */
      if ((S.rocketCoast ?? false) && !_prevRocketCoast && (S.rocketStage ?? 1) === 1) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'stagesep':
      /* Coast just ended, stage 2 active — unique per callout using index */
      if (!(S.rocketCoast ?? false) && _prevRocketCoast && (S.rocketStage ?? 1) === 2) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'seco':
      if ((S.rocketSECO ?? false) && !_prevRocketSECO) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'orbit':
      if (_isInOrbit() && !_prevOrbit) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'engine_out': {
      /* Unplanned engine loss — active count dropped, NOT triggered by auto-CECO */
      const stgCfg  = (S.aircraft?.performance?.stages ?? [])[(S.rocketStage ?? 1) - 1] ?? {};
      const total   = stgCfg.engineCount ?? 1;
      const active  = S.rocketActiveEngines ?? total;
      const prevAct = _prevActiveEngines ?? total;
      if (active < prevAct && !S.rocketCECO && !_prevCECO) {
        _rocketFired.add(uid); return true;
      }
      break;
    }

    case 'ceco':
      /* G-triggered center engine cutoff — planned, not a failure */
      if ((S.rocketCECO ?? false) && !_prevCECO) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'engine_failure_ascent':
      /* Stage 1 engine failure at low altitude — vehicle falling back (F1 Flight 1: T+25s fire) */
      if ((S.rocketStage ?? 1) === 1
          && !(S.rocketCoast ?? false)
          && !(S.rocketSECO ?? false)
          && (S.time ?? 0) > 65
          && (S.alt ?? 0) < 164000   /* below 50 km */
          && (S.vs  ?? 0) < -2000) { /* descending > 10 m/s */
        _rocketFired.add(uid); return true;
      }
      break;

    case 'stage2_anomaly':
      /* Stage 2 vehicle tumbling / separation collision — strong nose-down (F1 Flight 3) */
      if ((S.rocketStage ?? 1) >= 2
          && !(S.rocketCoast ?? false)
          && !(S.rocketSECO ?? false)
          && (S.pitch ?? 90) < -25) { /* FPA < -25°: clearly falling away */
        _rocketFired.add(uid); return true;
      }
      break;

    case 'structural_failure': {
      /* G-load or dynamic pressure exceeds design limit */
      const gLim = S.aircraft?.performance?.gLimit ?? 8;
      const qLim = S.aircraft?.performance?.qLimit ?? 50000;
      if ((S.rocketG ?? 0) > gLim || (S.rocketDynQ ?? 0) > qLim) {
        _rocketFired.add(uid); return true;
      }
      break;
    }

    case 'orbit_anomaly':
      /* Fires if SECO occurred but orbital velocity was never achieved after 60 s */
      if (_secoTime >= 0
          && !_rocketFired.has('orbit')
          && !_isInOrbit()
          && (S.time ?? 0) - _secoTime > 60) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'alt': {
      const altKm = alt_m / 1000;
      const tgt   = clr.alt_km ?? 0;
      if (altKm >= tgt && (alt_m - vel_ms * 0.1) / 1000 < tgt) {
        /* Only fire on the ascending pass through the threshold */
        _rocketFired.add(uid); return true;
      }
      break;
    }
  }
  return false;
}

function _checkApproachBrief(prev, curr, ms) {
  if (!ms.approachBrief || _briefFired || _briefLock) return;
  if (!ms.approachBriefAlt) return;
  if (curr >= prev) return;

  if (prev > ms.approachBriefAlt && curr <= ms.approachBriefAlt) {
    _briefFired = true;
    /* Small delay — let PM callout finish first */
    setTimeout(() => _runBrief(ms.approachBrief, 0), 1800);
  }
}

function _runBrief(steps, i) {
  if (i >= steps.length) return;
  const { v, t } = steps[i];
  const voice = v === 'pf' ? _pfVoice : _pmVoice;
  const opts  = v === 'pf'
    ? { rate: 0.92, pitch: 0.88 }
    : { rate: 0.92, pitch: 1.18 };
  const u = _makeUtt(t, voice, opts);
  u.onend = () => setTimeout(() => _runBrief(steps, i + 1), 600);
  _safeSpeak(u);
}

/* ── Voice loader ── */
function _loadVoices() {
  const assign = () => {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;

    const pref = (names) => voices.find(v =>
      names.some(n => v.name.toLowerCase().includes(n.toLowerCase()))
    ) || null;

    _pfVoice  = pref(['Daniel', 'Alex', 'Tom', 'David'])   || voices.find(v => !v.name.includes('Google')) || voices[0];
    _pmVoice  = pref(['Samantha', 'Karen', 'Moira', 'Fiona']) || voices.find(v => v.name !== _pfVoice?.name) || voices[0];
    _atcVoice = pref(['Gordon', 'Tom', 'Oliver', 'Lee', 'Malcolm', 'Alex'])
              || voices.find(v => v.name !== _pfVoice?.name && v.name !== _pmVoice?.name
                               && v.lang.startsWith('en') && !v.name.match(/Fred|Ralph|Albert|Bruce/i))
              || _pfVoice;
  };

  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = assign;
  }
  assign();
}

/* ── Speech helpers ── */
function _speak(text, voice, { rate = 1, pitch = 1, volume = 0.9 } = {}) {
  const u = _makeUtt(text, voice, { rate, pitch, volume });
  _safeSpeak(u);
}

function _makeUtt(text, voice, { rate = 1, pitch = 1, volume = 0.9 } = {}) {
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  else if (_crewLang) u.lang = _crewLang;  // only hint language when using browser default voice
  u.rate   = rate;
  u.pitch  = pitch;
  u.volume = volume;
  return u;
}

function _safeSpeak(utt) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.speak(utt);
}

function _playFile(src, onended) {
  const a = new Audio(src);
  a.volume = 0.9;
  a.onended = onended ?? null;
  a.play().catch(() => { if (onended) onended(); });
}
