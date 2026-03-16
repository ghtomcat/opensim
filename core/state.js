/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/state.js
   Single source of truth. All modules read from here.
   Never write to S directly from display modules — only from
   physics.js, input.js, and mission.js.
   ═══════════════════════════════════════════════════════════════ */

export const S = {

  /* ── Flight state ── */
  alt:   35000,   altT:  35000,   // ft
  spd:   312,     spdT:  312,     // knots
  hdg:   360,     hdgT:  360,     // degrees
  vs:    0,                       // ft/min
  pitch: 2,       pitchT: 2,      // degrees
  roll:  0,       rollT:  0,      // degrees

  /* ── Systems ── */
  flaps:    0,    prevFlaps: 0,   // 0-3 (config)
  gear:     false, prevGear: false,
  ap:       true,                 // autopilot engaged
  athr:     true,                 // autothrust

  /* ── ILS ── */
  ilsLoc:   1.2,  ilsLocT: 1.2,  // deviation dots
  ilsGs:   -0.8,  ilsGsT: -0.8,

  /* ── FMA — 5 boxes ── */
  fma: [
    { sub: 'SPEED',     val: 'A/THR', col: 'white', flash: 0 },
    { sub: 'AUTOPILOT', val: 'AP1',   col: 'green', flash: 0 },
    { sub: 'LATERAL',   val: 'NAV',   col: 'green', flash: 0 },
    { sub: 'VERTICAL',  val: 'CRZ',   col: 'cyan',  flash: 0 },
    { sub: 'ALTITUDE',  val: 'ALT',   col: 'white', flash: 0 },
  ],

  /* ── Display mode ── */
  mode:  'PFD',   // 'PFD' | 'ND' | 'ECAM'

  /* ── Timing ── */
  time:    0,     // accumulated seconds
  prevAlt: 35000,
  calloutTimer: 0,

  /* ── Sim meta ── */
  role:    'PF',  // 'PF' | 'PM' | 'INSTRUCTOR'
  paused:  false,
  roomId:  null,  // WebSocket room

  /* ── Aircraft config (loaded from aircraft/*.json) ── */
  aircraft: null,

  /* ── Mission config (loaded from missions/*.json) ── */
  mission: null,

  /* ── Weather (from METAR API) ── */
  metar: null,
};

/* Patch state — safe external write point */
export function setState(patch) {
  Object.assign(S, patch);
}
