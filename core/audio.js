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
const _worklets = new Map();   // module URL → addModule promise

/** The session's AudioContext, created on first call. */
export function audioContext() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
    _worklets.clear();
  }
  return _ctx;
}

/** Add an AudioWorklet module once; later calls return the same promise. A failed load is retried next time. */
export function loadWorklet(url) {
  const ctx = audioContext();
  if (!_worklets.has(url)) {
    _worklets.set(url, ctx.audioWorklet.addModule(url).catch(err => { _worklets.delete(url); throw err; }));
  }
  return _worklets.get(url);
}

/* A context created before any user gesture starts suspended (browser autoplay rule).
   It used to be replaced on every engine start; now it lives on, so resume it on the
   next key or click instead. */
if (typeof document !== 'undefined') {
  const _resume = () => { if (_ctx?.state === 'suspended') _ctx.resume().catch(() => {}); };
  document.addEventListener('keydown',     _resume, { capture: true });
  document.addEventListener('pointerdown', _resume, { capture: true });
}
