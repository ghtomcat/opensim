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
  rollRate:  0,   pitchRate: 0,   // deg/s — angular momentum

  /* ── Systems ── */
  flaps:    0,    prevFlaps: 0,   // 0-3 (config)
  trim:     0,                    // pitch trim (-10 nose down … +10 nose up)
  gear:     false, prevGear: false,
  braking:  false,                   // ground brakes held
  enginePower: 1.0,               // 0 = dead engine, 1 = full power
  engineState: 'off',             // 'off' | 'starting' | 'idle' | 'running' | 'shutdown'
  engineTemp:  0.0,               // 0=cold, 1=warm — increases after each start
  oilTempC:    15,                // °C — thermally lagged oil temperature (first-order)
  ambientTemp: 15,                // °C — controls cooling rate when off
  ap:       true,                 // autopilot engaged
  athr:     true,                 // autothrust
  wow:      false,                // weight on wheels (squat switch)
  touchdownVS: 0,                 // VS at last touchdown (fpm, negative)
  crashed:  false,                // bounds exceeded — physics frozen

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

  /* ── Geographic position (dead reckoning from mission start) ── */
  lat:   48.13,   lon:   8.55,    // degrees

  /* ── Timing ── */
  time:    0,     // accumulated seconds
  prevAlt: 35000,
  calloutTimer: 0,

  /* ── Scripted events ── */
  niflheimVisible: false,              // T+112–116, Wolfskopf only

  /* ── Hovercraft state (S.aircraft.type === 'hovercraft') ── */
  hcLiftT:     0,       // commanded lift throttle 0–1 (slider input)
  hcThrustT:   0,       // commanded thrust throttle 0–1
  hcRudder:    0,       // yaw input -1…+1
  hcLiftAct:   0,       // actual lift throttle after ESC clamp
  hcPressure:  0,       // plenum pressure Pa
  hcPReq:      135,     // required hover pressure for current mass Pa
  hcForce:     0,       // lift force N
  hcHovering:  false,
  hcLiftRatio: 0,       // F_lift / (mass × g)
  hcEdfOp:     0,       // EDF operating-point efficiency 0–1
  hcMode:      'NORMAL', // NORMAL / DEGRADED / DIRECT
  hcYawRate:   0,       // deg/s
  hcHeading:   0,       // degrees
  hcSpeed:     0,       // m/s ground speed
  hcThrActN:   0,       // actual thrust force N
  hcMass:      3.4,     // kg — measured hover limit at 80% ESC
  hcLeakage:   0.15,    // skirt leakage coefficient — adjustable
  hcNodes:     [1, 1, 1], // voting triad health (1=OK 0.5=degraded 0=fail)
  hcLiftEscTemp: 25,    // °C — lift ESC temperature
  hcThrEscTemp:  25,    // °C — thrust ESC temperature
  hcEmergency:   false, // emergency landing in progress

  /* ── Hovercraft — multi-vehicle ── */
  hcActive:    'timo',   // 'timo' | 'markus' | 'both'
  hcVehicles:  null,     // { timo: acJson, markus: acJson } — loaded post-mission

  /* ── Markus vehicle state (prefix hcM) ── */
  hcMLiftT:    0,        // commanded lift throttle 0–1
  hcMThrustT:  0,        // commanded thrust throttle 0–1
  hcMRudder:   0,        // yaw input -1…+1
  hcMLiftAct:  0,        // actual lift after ESC clamp
  hcMPressure: 0,        // plenum pressure Pa
  hcMPReq:     88,       // required hover pressure (0.8 kg at 0.0896 m²)
  hcMForce:    0,        // lift force N
  hcMHovering: false,
  hcMLiftRatio: 0,
  hcMEdfOp:    0,
  hcMMode:     'NORMAL',
  hcMYawRate:  0,
  hcMHeading:  0,
  hcMSpeed:    0,
  hcMThrActN:  0,
  hcMMass:     0.8,      // kg
  hcMLeakage:  0.12,
  hcMNodes:    [1, 1, 1],
  hcMAutonomy: 'MANUAL', // 'MANUAL' | 'HOVER' | 'TRACK'
  hcMTargetHdg: 0,       // heading to track in TRACK mode
  hcMLiftEscTemp: 25,    // °C — lift ESC temperature
  hcMThrEscTemp:  25,    // °C — thrust ESC temperature
  hcMEmergency:   false, // emergency landing in progress

  /* ── Fuel system ── */
  fuelSelector: 'BOTH',  // 'LEFT' | 'RIGHT' | 'BOTH' | 'OFF'
  fuelLeft:  null,        // litres — null = no fuel system on this aircraft
  fuelRight: null,

  /* ── Battery (electric aircraft) ── */
  batteryCharge: null,   // 0–100 % — null = not an electric aircraft

  /* ── Carburettor heat ── */
  carbHeat:     false,   // true = carb heat lever ON
  carbIceLevel: 0,       // 0=clear, 1=fully iced
  carbIceActive: false,  // carb_ice failure has been triggered

  /* ── Cooling system ── */
  coolantState: 'ok',    // 'ok' | 'leaking' | 'failed' — liquid-cooled aircraft only

  /* ── Cockpit switches (electric aircraft) ── */
  switches: {
    master:   false,   // MASTER — gates all electrical
    battEn:   false,   // BATT EN — enables battery
    pwrEn:    false,   // PWR EN — enables motor output
    avionics: false,   // AVIONICS — gates NESIS display
  },

  /* ── Warning lights ── */
  warnings: {},           // { OIL_PRESS: bool, LOW_FUEL: bool, FUEL_SEL_OFF: bool }

  /* ── Emergency log (scored at debrief) ── */
  emergLog: [],   // { t, type: 'failure'|'tune'|'squawk7700'|'ptt', ... }

  /* ── Sim meta ── */
  role:    'PF',  // 'PF' | 'PM' | 'INSTRUCTOR'
  paused:      false,
  warpFactor:  1,    // time warp multiplier: 1 | 10 | 100 | 1000
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
