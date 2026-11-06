/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/audio.js
   The one AudioContext for the page session.

   Created on first use and never closed: engines, APU, fuel pump,
   radio, GPWS and effects all play on it. A module that stops its
   sounds disconnects its own nodes (sound.js: its output gain) —
   it never closes the context, so a transmission or a callout playing
   while an engine (re)starts keeps playing. (issues.md: "The
   AudioContext is recreated on every engine (re)start".)

   AudioWorklet modules are added once per context (loadWorklet):
   adding a module twice re-runs registerProcessor, which throws.
   ═══════════════════════════════════════════════════════════════ */

let _ctx = null;
let _output = null;            // every Web Audio sound ends here → the speakers
const _worklets = new Map();   // module URL → addModule promise

/** The session's AudioContext, created on first call. */
export function audioContext() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
    _output = _ctx.createGain();
    _output.gain.value = _muted ? 0 : 1;
    _output.connect(_ctx.destination);   // the only connection to the speakers
    _worklets.clear();
  }
  return _ctx;
}

/** Where Web Audio sounds connect, instead of ctx.destination — so the audio switch reaches them. */
export function audioOutput() {
  audioContext();
  return _output;
}

/* ── The audio switch (X): everything the sim plays, on three different paths ──
   Web Audio through audioOutput(); clips through audioElement(); speech through speak().
   Muted sounds keep running silently: a transmission's end still fires, so what the mission
   script chains on it follows on time, and nothing is out of step when the sound comes back. */
let _muted = false;
const _elements = new Set();   // the playing clips
let _speech = [];              // the utterances spoken or waiting, oldest first

export const audioMuted = () => _muted;

export function setAudioMuted(muted) {
  if (muted === _muted) return;
  _muted = muted;
  if (_output) _output.gain.setTargetAtTime(muted ? 0 : 1, _output.context.currentTime, 0.01);
  for (const a of _elements) a.muted = muted;
  _respeak();
}

/** A clip (recording, looped radio) that follows the audio switch. */
export function audioElement(src) {
  const a = new Audio(src);
  a.muted = _muted;
  a.addEventListener('play',  () => { a.muted = _muted; _elements.add(a); });
  a.addEventListener('pause', () => _elements.delete(a));   // also fires when it ends
  return a;
}

/** Speak an utterance, following the audio switch. */
export function speak(utt) {
  if (typeof speechSynthesis === 'undefined') return;
  utt.__volume = utt.volume;
  if (_muted) utt.volume = 0;
  const done = () => { _speech = _speech.filter(u => u !== utt); };
  utt.addEventListener('end',   done);
  utt.addEventListener('error', done);
  _speech.push(utt);
  speechSynthesis.speak(utt);
}

/** Drop all speech, spoken and waiting (a new mission). */
export function cancelSpeech() {
  _speech = [];
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/* A running utterance's volume can't change, and a cancelled one would never reach its onend, which
   the next line of the script may be waiting for. So the switch replaces them: the same lines, the
   same handlers, at the new volume. The current line starts over — heard from its start when the
   sound comes back. */
function _respeak() {
  if (!_speech.length || typeof speechSynthesis === 'undefined') return;
  const lines = _speech;
  _speech = [];
  const again = lines.map(u => {
    const n = new SpeechSynthesisUtterance(u.text);
    n.voice = u.voice; n.lang = u.lang; n.rate = u.rate; n.pitch = u.pitch; n.volume = u.__volume;
    n.onend = u.onend; n.onerror = u.onerror;
    u.onend = null; u.onerror = null;
    return n;
  });
  speechSynthesis.cancel();
  again.forEach(speak);
}

/** Add an AudioWorklet module once; later calls return the same promise. A failed load is retried next time. */
export function loadWorklet(url) {
  const ctx = audioContext();
  if (!_worklets.has(url)) {
    _worklets.set(url, ctx.audioWorklet.addModule(url).catch(err => { _worklets.delete(url); throw err; }));
  }
  return _worklets.get(url);
}

/* Browsers only let a context run when it is created or resumed inside a user gesture
   (autoplay rule; Safari is strict about it). Sounds start a frame after the key press
   that caused them — the engine sound follows S.engineState in tickSound() — so the
   context is created (or resumed) here, in the capture phase of every key and click,
   before any handler runs. A context created outside a gesture would stay suspended
   until some later sound happened to resume it. */
if (typeof document !== 'undefined') {
  const _wake = () => {
    try {
      const ctx = audioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {}   // no Web Audio in this browser — the sim runs silent
  };
  document.addEventListener('keydown',     _wake, { capture: true });
  document.addEventListener('pointerdown', _wake, { capture: true });
}
