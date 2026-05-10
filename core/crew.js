/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/crew.js
   All voice output: PF, PM, ATC, GPWS.
   Data-driven from aircraft.json + mission.json via S.aircraft / S.mission.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { playThroughChain, createRadioChain } from './radio.js';
import { getAudioContext, getEngineBleedNode } from './sound.js';

/* ── Voice handles ── */
let _pfVoice        = null;
let _pmVoice        = null;
let _atcVoice       = null;
let _narratorVoice  = null;   // deep cinematic narrator
let _narrator2Voice = null;   // second narrator (female)
let _crewLang = null;   // e.g. 'ru-RU' — null = browser default

/* ── State ── */
const _atcFired       = new Set();  // indices of fired ATC clearances
const _atcEndedAt     = {};         // idx → S.time when that clearance's audio ended
let _briefFired       = false;
let _briefLock        = false;
let _checklistLock    = false;
let _prevFlaps        = 0;
let _prevGear         = false;
let _prevSpd          = 0;
let _prevWow          = false;
let _prevComPowered   = false;
let _radioAtmosphere  = null;   // active radio chain while ATC speaks (TTS path)
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
let _prevBoosterPhase   = null;   // track booster phase transitions
let _prevBoosterLanded  = false;
let _prevDragonDeorbit  = false;
let _prevDragonBlackout = false;
let _prevDragonSignal   = false;
let _prevDragonDrogue   = false;
let _prevDragonMains    = false;
let _prevDragonSplashdown = false;
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
  window._testGPWS = (speech = 'minimums', red = false) => _playGPWS(speech, red);
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
      const pref = (names) => langVoices.find(v =>
        names.some(n => v.name.toLowerCase().includes(n.toLowerCase()))
      ) || null;
      _pfVoice  = pref(['Daniel', 'Alex', 'Tom', 'David']) || langVoices[0];
      _pmVoice  = pref(['Samantha', 'Karen', 'Moira', 'Fiona', 'Victoria', 'Allison', 'Ava', 'Susan', 'Zoe', 'Tessa', 'Veena', 'Serena', 'Kate'])
                || langVoices.find(v => v.name !== _pfVoice?.name && /samantha|karen|moira|fiona|victoria|allison|ava|susan|zoe|tessa|female|woman/i.test(v.name))
                || langVoices.find(v => v.name !== _pfVoice?.name)
                || langVoices[0];
      _atcVoice = pref(['Gordon', 'Tom', 'Oliver', 'Lee', 'Malcolm'])
                || langVoices.find(v => v.name !== _pfVoice?.name && v.name !== _pmVoice?.name)
                || langVoices[0];
      if (speechSynthesis.onvoiceschanged !== undefined)
        speechSynthesis.onvoiceschanged = () => setCrewLang(_crewLang);
      console.log('[crew] lang voices:', langVoices.map(v => v.name));
      console.log('[crew] PF:', _pfVoice?.name, '| PM:', _pmVoice?.name, '| ATC:', _atcVoice?.name);
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

  _prevSpd        = S.spd ?? 0;
  _prevWow        = S.wow ?? false;
  _prevComPowered = _isComPowered();

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
    _prevActiveEngines    = S.rocketActiveEngines ?? null;
    _prevCECO             = S.rocketCECO          ?? false;
    _prevBoosterPhase     = S.booster?.phase   ?? null;
    _prevBoosterLanded    = S.booster?.landed  ?? false;
    _prevDragonDeorbit    = S.dragonDeorbit   ?? false;
    _prevDragonBlackout   = S.dragonBlackout  ?? false;
    _prevDragonSignal     = S.dragonSignal    ?? false;
    _prevDragonDrogue     = S.dragonDrogue    ?? false;
    _prevDragonMains      = S.dragonMains     ?? false;
    _prevDragonSplashdown = S.dragonSplashdown ?? false;
  }
}

export function resetCrew() {
  _atcFired.clear();
  for (const k in _atcEndedAt) delete _atcEndedAt[k];
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
  _prevComPowered = false;
  _prevVelMs = 0; _prevDynQ = 0;
  _prevRocketCoast = false; _prevRocketStage = 1;
  _prevRocketSECO = false; _prevOrbit = false;
  _secoTime = -1;
  _prevActiveEngines = null;
  _prevCECO = false;
  _prevBoosterPhase = null; _prevBoosterLanded = false;
  _prevDragonDeorbit = false; _prevDragonBlackout = false;
  _prevDragonSignal  = false; _prevDragonDrogue   = false;
  _prevDragonMains   = false; _prevDragonSplashdown = false;
}

/* ── Direct speech ── */
export function speakPF(text, opts = {})        { _speak(text, _pfVoice,        { rate: 0.92, pitch: 0.88, ...opts }); }
export function speakPM(text, opts = {})        { _speak(text, _pmVoice,        { rate: 0.92, pitch: 1.18, ...opts }); }
export function speakATC(text, opts = {})       { _speak(text, _atcVoice,       { rate: 1.00, pitch: 1.00, volume: 1.0, ...opts }); }
export function speakNarrator(text, opts = {})  { _speak(text, _narratorVoice,  { rate: 0.95, pitch: 0.88, volume: 1.0, ...opts }); }
export function speakNarrator2(text, opts = {}) { _speak(text, _narrator2Voice, { rate: 0.95, pitch: 1.08, volume: 1.0, ...opts }); }

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
  const fieldElev = S.mission?.arrival?.elevation ?? S.mission?.departure?.elevation ?? 0;
  for (const { alt, speech } of ac.pmCallouts) {
    const abs = alt + fieldElev;
    if (prev > abs && curr <= abs && !_pmFired.has(alt)) {
      _pmFired.add(alt);
      setTimeout(() => speakPM(speech), 600);
    }
  }
}

function _checkGPWS(prev, curr, ac) {
  if (!ac.gpws) return;
  if (curr >= prev) return;
  const fieldElev = S.mission?.arrival?.elevation ?? S.mission?.departure?.elevation ?? 0;
  for (const { alt, speech, red } of ac.gpws) {
    const abs = alt + fieldElev;
    if (prev > abs && curr <= abs && !_gpwsFired.has(alt)) {
      _gpwsFired.add(alt);
      setTimeout(() => _playGPWS(speech, red), 200);
    }
  }
}

/* ── GPWS audio chain ───────────────────────────────────────────
   Tries assets/gpws/<slug>.mp3 first; falls back to TTS.
   Chain: highpass(300) → lowpass(3400) → compressor → soft-clip → gain
   ─────────────────────────────────────────────────────────────── */
const _gpwsCache = new Map();   // slug → AudioBuffer | 'missing'

function _gpwsSlug(speech) {
  return speech.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
}

function _buildGPWSCurve() {
  const n = 512, k = 60;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
  }
  return c;
}

async function _playGPWS(speech, red = false) {
  const slug = _gpwsSlug(speech);
  const ctx  = getAudioContext();

  let buf = _gpwsCache.get(slug);

  if (!buf) {
    try {
      const resp = await fetch(`assets/gpws/${slug}.mp3`);
      if (!resp.ok) throw new Error('not found');
      const ab  = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(ab);
      _gpwsCache.set(slug, buf);
    } catch {
      _gpwsCache.set(slug, 'missing');
      buf = 'missing';
    }
  }

  if (buf === 'missing' || !ctx) {
    const pitch = red ? 1.4 : 1.2;
    _speak(speech, null, { rate: 1.0, pitch, volume: 1.0 });
    return;
  }

  const src  = ctx.createBufferSource();
  src.buffer = buf;

  const hp   = ctx.createBiquadFilter();
  hp.type    = 'highpass';
  hp.frequency.value = 300;

  const lp   = ctx.createBiquadFilter();
  lp.type    = 'lowpass';
  lp.frequency.value = 3400;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value      = 3;
  comp.ratio.value     = 14;
  comp.attack.value    = 0.003;
  comp.release.value   = 0.10;

  const shaper  = ctx.createWaveShaper();
  shaper.curve  = _buildGPWSCurve();

  const gain    = ctx.createGain();
  gain.gain.value = red ? 1.6 : 1.4;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(comp);
  comp.connect(shaper);
  shaper.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

function _checkChecklist(prev, curr, ac) {
  if (!ac.checklist || _checklistLock) return;
  if (curr >= prev) return;

  const { flaps, gear } = ac.checklist;
  const fieldElev = S.mission?.arrival?.elevation ?? S.mission?.departure?.elevation ?? 0;

  /* Gear down */
  if (gear) {
    const gearAbs = gear.alt + fieldElev;
    if (prev > gearAbs && curr <= gearAbs && !S.gear && S.prevGear === false) {
      _checklistLock = true;
      setState({ gear: true });
      sndCrew(gear.pf, gear.pm, 800);
      setTimeout(() => { _checklistLock = false; }, 4000);
      return;
    }
  }

  /* Flaps — find next config not yet set */
  if (flaps) {
    for (const step of flaps) {
      const stepAbs = step.alt + fieldElev;
      if (prev > stepAbs && curr <= stepAbs && S.flaps < step.config) {
        _checklistLock = true;
        setState({ flaps: step.config });
        sndCrew(step.pf, step.pm, 800);
        setTimeout(() => { _checklistLock = false; }, 4000);
        return;
      }
    }
  }
}

/* ── Resolve voice params for a clearance voice name ── */
function _voiceFor(voiceName) {
  const female = S.mission?.crewVoice === 'female';
  switch (voiceName) {
    case 'pm':        return { voice: _pmVoice,                          rate: 0.92, pitch: 1.18, volume: 0.9  };
    case 'crew':      return { voice: female ? _pmVoice : _pfVoice,      rate: 0.92, pitch: 0.88, volume: 0.9  };
    case 'narrator':  return { voice: _narratorVoice,                    rate: 0.95, pitch: 0.88, volume: 1.0  };
    case 'narrator2': return { voice: _narrator2Voice,                   rate: 0.95, pitch: 1.08, volume: 1.0  };
    default:          return { voice: _atcVoice,                         rate: 1.00, pitch: 1.00, volume: 1.0  };
  }
}

/* ── PTT click — short filtered noise transient, heard in cockpit ── */
function _pttClick() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const dur  = 0.009;
  const buf  = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.4);
  const src  = ctx.createBufferSource();
  const hpf  = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = buf;
  hpf.type   = 'highpass'; hpf.frequency.value = 700;
  gain.gain.value = 0.28;
  src.connect(hpf); hpf.connect(gain); gain.connect(ctx.destination);
  src.start();
}

/* ── Radio atmosphere for TTS ATC voice (TTS can't be filtered directly) ── */
async function _startRadioAtmosphere(profileName) {
  _stopRadioAtmosphere();
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const chain  = await createRadioChain(ctx, profileName);
    const silence = ctx.createGain();
    silence.gain.value = 0;   // no voice source — only noise/crackle generators run
    silence.connect(chain.input);
    chain.output.connect(ctx.destination);
    _radioAtmosphere = chain;
  } catch (e) {
    console.warn('[crew] radio atmosphere:', e.message);
  }
}

function _stopRadioAtmosphere() {
  if (!_radioAtmosphere) return;
  const chain = _radioAtmosphere;
  _radioAtmosphere = null;
  chain.squelchTail();
  setTimeout(() => chain.destroy(), 500);
}

/* ── COM power state — panel-aware ── */
function _isComPowered() {
  const ac = S.aircraft;
  if (!ac) return true;
  if (ac.panel === 'velis') {
    const sw = S.switches;
    return !!(sw?.master && sw?.battEn && sw?.avionics);
  }
  if (ac.panel === 'g1000') {
    return S.masterBat !== false && S.avionicsOn !== false;
  }
  return true;   // rockets, autopilot aircraft — COM always available
}

/* ── Evaluate a structured trigger object ── */
function _evalTrigger(tr) {
  switch (tr.type) {
    case 'time':
      return (S.time ?? 0) >= tr.t;
    case 'airborne':
      return !(S.wow ?? false)
          && (S.alt ?? 0) > ((S.mission?.departure?.elevation ?? 0) + 150);
    case 'alt_ft':
      return (S.alt ?? 0) >= tr.min;
    case 'alt_km':
      return (S.alt ?? 0) * 0.0003048 >= tr.min;
    case 'gload':
      return (S.rocketG ?? 0) >= tr.min;
    case 'meco':
      return !!(S.rocketMECO);
    case 'com_active':
      return _isComPowered() && !_prevComPowered;
    case 'after': {
      const endT = _atcEndedAt[tr.idx];
      return endT !== undefined && (S.time ?? 0) >= endT + (tr.delay ?? 1);
    }
    default:
      return false;
  }
}

function _checkATC(prev, curr, ms) {
  if (!ms.atcClearances) return;

  ms.atcClearances.forEach((clr, idx) => {
    if (_atcFired.has(idx)) return;

    let fire = false;
    if (clr.trigger) {
      fire = _evalTrigger(clr.trigger);
    } else if (clr.t !== undefined) {
      fire = (S.time >= clr.t);
    } else if (clr.alt !== undefined) {
      fire = (curr < prev && prev > clr.alt && curr <= clr.alt);
    } else if (clr.event !== undefined) {
      fire = _checkRocketEvent(clr.event, clr, prev, curr);
    }
    if (!fire) return;
    _atcFired.add(idx);

    const capturedIdx = idx;
    const delay = clr.delay ?? 200;

    /* Ambient background audio — no radio filter, non-blocking */
    if (clr.audio !== undefined && clr.voice === 'ambient') {
      setTimeout(async () => {
        const exists = await fetch(clr.audio, { method: 'HEAD' })
          .then(r => r.ok).catch(() => false);
        if (exists) {
          const a = new Audio(clr.audio);
          a.volume = clr.volume ?? 0.2;
          const _schedFade = () => {
            if (!clr.duration) return;
            const fadeStart = (clr.duration - 2) * 1000;
            setTimeout(() => {
              const vol0 = a.volume;
              let t = 0;
              const iv = setInterval(() => {
                t += 100;
                a.volume = Math.max(0, vol0 * (1 - t / 2000));
                if (t >= 2000) { clearInterval(iv); a.pause(); }
              }, 100);
            }, Math.max(0, fadeStart));
          };
          if (clr.startTime) {
            /* Seek only after metadata is loaded — setting currentTime earlier is ignored */
            a.addEventListener('loadedmetadata', () => {
              a.currentTime = clr.startTime;
              a.play().catch(() => {});
              _schedFade();
            }, { once: true });
            a.load();
          } else {
            a.play().catch(() => {});
            _schedFade();
          }
        }
        _atcEndedAt[capturedIdx] = S.time;
      }, clr.delay ?? 0);
      return;
    }

    /* Pre-recorded audio — route through radio chain; fall back to TTS if missing */
    if (clr.audio !== undefined) {
      const charKey = clr.speaker ?? clr.voice;
      const char    = charKey ? S.mission?.characters?.[charKey] : null;
      const profile = clr.commProfile ?? char?.commProfile ?? S.mission?.commProfile ?? 'vhf-aviation';
      setTimeout(async () => {
        const exists = await fetch(clr.audio, { method: 'HEAD' })
          .then(r => r.ok).catch(() => false);
        if (exists) {
          playRadio(clr.audio, { profile, onEnded: () => { _atcEndedAt[capturedIdx] = S.time; } });
        } else if (clr.text) {
          const vp = _voiceFor(charKey);
          const u  = _makeUtt(clr.text, vp.voice, { rate: vp.rate, pitch: vp.pitch, volume: vp.volume });
          u.onend = () => { _atcEndedAt[capturedIdx] = S.time; };
          _safeSpeak(u);
        } else {
          _atcEndedAt[capturedIdx] = S.time;
        }
      }, delay);
      return;
    }

    /* TTS single-voice */
    if (clr.text !== undefined) {
      const vp = _voiceFor(clr.voice);
      const u  = _makeUtt(clr.text, vp.voice, { rate: vp.rate, pitch: vp.pitch, volume: vp.volume });
      u.onend = () => { _atcEndedAt[capturedIdx] = S.time; };
      setTimeout(() => _safeSpeak(u), delay);
      return;
    }

    /* TTS call-response: { pm, atc, ack } — PM calls, ATC responds, PM acknowledges.
       pmAudio / atcAudio / ackAudio override TTS with pre-recorded files.
       PM + ack: in-cockpit (direct, PTT click). ATC: radio chain + engine bleed. */
    const pmText   = clr.pm  ?? '';
    const atcText  = clr.atc ?? '';
    const ackText  = clr.ack ?? '';
    const pmAudio  = clr.pmAudio  ?? null;
    const atcAudio = clr.atcAudio ?? null;
    const ackAudio = clr.ackAudio ?? null;
    const profile  = clr.commProfile ?? S.mission?.commProfile ?? 'vhf-aviation';

    if (!_isComPowered()) return;

    const _head = url => fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false);

    /* Step 3 — PM acknowledges (in-cockpit, direct) */
    const _doAck = () => {
      const done = () => { _atcEndedAt[capturedIdx] = S.time; };
      if (!ackText && !ackAudio) { done(); return; }
      setTimeout(() => {
        _pttClick();
        setTimeout(async () => {
          if (ackAudio && await _head(ackAudio)) {
            _playFile(ackAudio, () => { _pttClick(); done(); });
          } else if (ackText) {
            const u = _makeUtt(ackText, _pmVoice, { rate: 0.92, pitch: 1.18 });
            u.onend = () => { _pttClick(); done(); };
            _safeSpeak(u);
          } else { done(); }
        }, 80);
      }, 600);
    };

    /* Step 2 — ATC responds (over radio chain, variable delay) */
    const _doAtc = () => {
      const delay = Math.floor(800 + Math.random() * 600);   // 0.8–1.4 s
      setTimeout(async () => {
        const afterAtc = () => { _stopRadioAtmosphere(); _doAck(); };

        if (atcAudio && await _head(atcAudio)) {
          /* Pre-recorded file — playRadio builds its own chain + engine bleed */
          playRadio(atcAudio, { profile, onEnded: afterAtc });
          return;
        }

        /* TTS fallback — atmosphere opens, brief pause, then voice */
        _startRadioAtmosphere(profile);
        await new Promise(r => setTimeout(r, 150));
        const lower   = atcText.toLowerCase();
        const fileKey = Object.keys(AUDIO_FILES).find(k => lower.includes(k));
        if (fileKey) {
          const i = lower.indexOf(fileKey);
          const pre  = atcText.slice(0, i).trim();
          const post = atcText.slice(i + fileKey.length).trim();
          const chain = post
            ? () => setTimeout(() => { const u = _makeUtt(post, _atcVoice, { rate: 1.08, pitch: 0.78 }); u.onend = afterAtc; _safeSpeak(u); }, 400)
            : afterAtc;
          const atcU = _makeUtt(pre || '.', _atcVoice, { rate: 1.08, pitch: 0.78 });
          atcU.onend = () => setTimeout(() => _playFile(AUDIO_FILES[fileKey], chain), 300);
          _safeSpeak(atcU);
        } else {
          const atcU = _makeUtt(atcText, _atcVoice, { rate: 1.00, pitch: 1.00, volume: 1.0 });
          atcU.onend = afterAtc;
          _safeSpeak(atcU);
        }
      }, delay);
    };

    /* Step 1 — PM calls (in-cockpit, direct) — PTT click, 80 ms, voice */
    _pttClick();
    setTimeout(async () => {
      const afterPM = () => { _pttClick(); _doAtc(); };
      if (pmAudio && await _head(pmAudio)) {
        _playFile(pmAudio, afterPM);
      } else {
        const pmU = _makeUtt(pmText, _pmVoice, { rate: 0.92, pitch: 1.18 });
        pmU.onend = afterPM;
        _safeSpeak(pmU);
      }
    }, 80);
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
  return (S.rocketSECO ?? false) && vel_ms >= vOrb * 0.99 && Math.abs(S.pitch ?? 90) < 8;
}

function _checkRocketEvent(event, clr, prevAlt = 0, currAlt = 0) {
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
      /* Coast just started (booster falls away) — same tick as meco, separate uid tracking */
      if ((S.rocketCoast ?? false) && !_prevRocketCoast && (S.rocketStage ?? 1) === 1) {
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

    case 'alt_desc': {
      /* Fires on the descending pass through a threshold (ft) */
      const tgt_ft = clr.alt_ft ?? 0;
      if (currAlt <= tgt_ft && prevAlt > tgt_ft) {
        _rocketFired.add(uid); return true;
      }
      break;
    }

    case 'booster_flip':
      if (S.booster?.active && S.booster?.phase === 'flip' && _prevBoosterPhase === null) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'booster_boostback':
      if (S.booster?.phase === 'boostback' && _prevBoosterPhase === 'flip') {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'booster_coast':
      if (S.booster?.phase === 'coast' && _prevBoosterPhase === 'boostback') {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'booster_entry':
      /* 'glide' phase = grid fins deployed, entering atmosphere */
      if (S.booster?.phase === 'glide' && _prevBoosterPhase === 'coast') {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'booster_landing_burn':
      if (S.booster?.phase === 'landing' && _prevBoosterPhase === 'glide') {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'booster_landing':
      if ((S.booster?.landed ?? false) && !_prevBoosterLanded) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'deorbit':
      if ((S.dragonDeorbit ?? false) && !_prevDragonDeorbit) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'blackout':
      if ((S.dragonBlackout ?? false) && !_prevDragonBlackout) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'signal':
      if ((S.dragonSignal ?? false) && !_prevDragonSignal) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'drogue':
      if ((S.dragonDrogue ?? false) && !_prevDragonDrogue) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'mains':
      if ((S.dragonMains ?? false) && !_prevDragonMains) {
        _rocketFired.add(uid); return true;
      }
      break;

    case 'splashdown':
      if ((S.dragonSplashdown ?? false) && !_prevDragonSplashdown) {
        _rocketFired.add(uid); return true;
      }
      break;
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
    _pmVoice  = pref(['Samantha', 'Karen', 'Moira', 'Fiona', 'Victoria', 'Allison', 'Ava', 'Susan', 'Zoe', 'Tessa', 'Veena', 'Serena', 'Kate'])
              || voices.find(v => v.name !== _pfVoice?.name && /samantha|karen|moira|fiona|victoria|allison|ava|susan|zoe|tessa|female|woman/i.test(v.name))
              || voices.find(v => v.name !== _pfVoice?.name) || voices[0];
    _atcVoice = pref(['Gordon', 'Tom', 'Oliver', 'Lee', 'Malcolm', 'Alex'])
              || voices.find(v => v.name !== _pfVoice?.name && v.name !== _pmVoice?.name
                               && v.lang.startsWith('en') && !v.name.match(/Fred|Ralph|Albert|Bruce/i))
              || _pfVoice;
    /* Narrator (SpaceX webcast host — male, "John") — professional, clear, slightly warm */
    _narratorVoice  = pref(['Oliver', 'Lee', 'Malcolm', 'Fred', 'Ralph', 'Bruce', 'Albert'])
                    || voices.find(v => v.name !== _pfVoice?.name && v.name !== _atcVoice?.name
                                     && v.lang.startsWith('en'))
                    || _pfVoice;
    /* Narrator 2 (SpaceX webcast host — female, "Lauren") — professional, clear, enthusiastic */
    _narrator2Voice = pref(['Serena', 'Kate', 'Martha', 'Helena', 'Veena', 'Tessa'])
                    || voices.find(v => v.name !== _pmVoice?.name && v.name !== _pfVoice?.name
                                     && v.lang.startsWith('en') && /female|woman|serena|kate|martha|helena/i.test(v.name))
                    || _pmVoice;
    console.log('[crew] _loadVoices — en voices:', voices.filter(v=>v.lang.startsWith('en')).map(v=>v.name));
    console.log('[crew] PF:', _pfVoice?.name, '| PM:', _pmVoice?.name, '| ATC:', _atcVoice?.name, '| NAR:', _narratorVoice?.name, '| NAR2:', _narrator2Voice?.name);
  };

  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => setCrewLang(_crewLang);
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

/* ── Radio chain playback ───────────────────────────────────────
   Plays an MP3 through the mission's commProfile radio chain.
   Falls back to plain Audio if Web Audio isn't available.
   ─────────────────────────────────────────────────────────────── */
/* Cockpit environments that blend engine noise into received comms */
const COCKPIT_PROFILES = {
  'vhf-aviation':    { bleedLevel: 0.025 }, // subtle engine under received ATC voice
  'cockpit-bf109':   { bleedLevel: 0.04 },
  'cockpit-c172':    { bleedLevel: 0.05 },
  'capsule-dragon':  { bleedLevel: 0.04 },
  'ip-spacex-crew':  { bleedLevel: 0.035 }, // Dragon life-support fan + thruster bleed
  'arc-5':           { bleedLevel: 0.09 },
};

export async function playRadio(src, { profile, onEnded } = {}) {
  const profileName = profile
    ?? S.mission?.commProfile
    ?? 'vhf-aviation';

  try {
    /* Always use sound.js AudioContext so engine bleed nodes can be shared */
    const ctx          = getAudioContext() ?? new AudioContext();
    const bleedCfg     = COCKPIT_PROFILES[profileName];
    const envBleedNode = bleedCfg ? getEngineBleedNode() : null;

    if (!ctx) throw new Error('no AudioContext');

    await playThroughChain(ctx, src, {
      profileName,
      destination:  ctx.destination,
      envBleedNode,
      bleedLevel:   bleedCfg?.bleedLevel ?? 0.08,
      onEnded,
    });
  } catch (e) {
    console.warn('[crew] radio chain failed, falling back:', e.message);
    _playFile(src, onEnded);
  }
}
