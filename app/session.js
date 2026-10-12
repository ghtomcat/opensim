/* ═══════════════════════════════════════════════════════════════
   OpenSim — app/session.js
   Mission session: everything one mission registers with the page
   (listeners, timers, cleanup) goes through it, and stop() removes
   it all. init() stops the old session before starting the next.
   ═══════════════════════════════════════════════════════════════ */

export function newSession() {
  const _cleanups = [];
  return {
    /** addEventListener, removed on stop(). */
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      _cleanups.push(() => target.removeEventListener(type, fn, opts));
    },
    /** setTimeout, cleared on stop(). */
    timeout(fn, ms) {
      const id = setTimeout(fn, ms);
      _cleanups.push(() => clearTimeout(id));
      return id;
    },
    /** setInterval, cleared on stop(). */
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      _cleanups.push(() => clearInterval(id));
      return id;
    },
    /** Any other cleanup to run on stop(). */
    onStop(fn) { _cleanups.push(fn); },
    /** Undo everything registered, newest first. */
    stop() { while (_cleanups.length) _cleanups.pop()(); },
  };
}
