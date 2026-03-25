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

/* ── State ── */
let _atcStep          = 0;
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
}

export function resetCrew() {
  _atcStep    = 0;
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
}

/* ── Direct speech ── */
export function speakPF(text, opts = {})  { _speak(text, _pfVoice,  { rate: 0.92, pitch: 0.88, ...opts }); }
export function speakPM(text, opts = {})  { _speak(text, _pmVoice,  { rate: 0.92, pitch: 1.18, ...opts }); }
export function speakATC(text, opts = {}) { _speak(text, _atcVoice, { rate: 1.08, pitch: 0.78, volume: 1.0, ...opts }); }

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
  const clearances = ms.atcClearances;
  if (_atcStep >= clearances.length) return;
  if (curr >= prev) return;

  const clr = clearances[_atcStep];
  if (prev > clr.alt && curr <= clr.alt) {
    _atcStep++;
    const pmText  = clr.pm;
    const atcText = clr.atc;

    /* PM requests, then ATC responds after brief pause */
    const pmU = _makeUtt(pmText, _pmVoice, { rate: 0.92, pitch: 1.18 });
    pmU.onend = () => {
      setTimeout(() => {
        /* Check for audio file (e.g. grüezi) */
        const lower = atcText.toLowerCase();
        const fileKey = Object.keys(AUDIO_FILES).find(k => lower.includes(k));
        if (fileKey) {
          /* Speak the part before the file key, play file for the keyword */
          const idx  = lower.indexOf(fileKey);
          const pre  = atcText.slice(0, idx).trim();
          const post = atcText.slice(idx + fileKey.length).trim();
          let chain = () => {};
          if (post) chain = () => setTimeout(() => speakATC(post), 400);
          const afterFile = chain;

          const atcU = _makeUtt(pre || '.', _atcVoice, { rate: 1.08, pitch: 0.78 });
          atcU.onend = () => {
            setTimeout(() => {
              _playFile(AUDIO_FILES[fileKey], afterFile);
            }, 300);
          };
          _safeSpeak(atcU);
        } else {
          speakATC(atcText);
        }
      }, 1200);
    };
    _safeSpeak(pmU);
  }
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
    _atcVoice = pref(['Fred', 'Ralph', 'Albert', 'Bruce'])  || voices[0];
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
