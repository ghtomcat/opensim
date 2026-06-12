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
  speedBrake: 0,                  // 0=RET, 1=ARM, 2=FULL
  autobrake: 'OFF',               // OFF | LO | MED | MAX — armed level; engages on touchdown with ground spoilers
  trim:     0,                    // pitch trim (-10 nose down … +10 nose up)
  gear:     false, prevGear: false,
  gearAnim: 0,    // 0 = fully retracted, 1 = fully extended
  braking:  false,                   // ground brakes held (momentary, B key)
  parkBrake: false,                  // parking brake (latched, pedestal switch)
  steer:    0,                       // nose-wheel steering, -1 (full left) … +1 (full right)
  enginePower: 1.0,               // 0 = dead engine, 1 = full power
  engineState: 'off',             // 'off' | 'starting' | 'running' | 'shutdown'
  engineTemp:  0.0,               // 0=cold, 1=warm — increases after each start
  n1:          0,                 // turbofan N1 % (0-100); idle ~22%, TOGA 100%
  oilTempC:    15,                // °C — thermally lagged oil temperature (first-order)
  ambientTemp: 15,                // °C — controls cooling rate when off
  ap:       true,                 // autopilot engaged
  athr:     true,                 // autothrust
  navManaged: false,              // lateral managed NAV (LNAV) — follow the flight plan vs hold the FCU heading
  fmsActive:  0,                  // active waypoint index in the flight-plan legs (LNAV sequencer)
  altManaged: false,              // vertical managed VNAV — fly the altitude profile vs hold the FCU altitude
  spdManaged: false,              // managed speed — A/THR flies the phase speed schedule vs hold the FCU speed
  athrN1:     55,                 // A/THR commanded N1 (the autothrust speed-loop integrator state)
  athrMode:   null,               // active A/THR thrust mode: 'SPEED' | 'MACH' | 'THR' (null when A/THR off) — FMA column 0
  athrDetent: null,               // thrust-lever detent the A/THR is rated to: IDLE/CLB/MCT/TOGA
  thrustLever: 0,                 // manual thrust-lever position 0=idle…1=TOGA — drives N1 when A/THR is off (spdT then is only the selected speed)
  wow:      false,                // weight on wheels (squat switch)
  touchdownVS: 0,                 // VS at last touchdown (fpm, negative)
  crashed:  false,                // bounds exceeded — physics frozen

  /* ── ILS ── */
  ilsLoc:   1.2,  ilsLocT: 1.2,  // deviation dots
  ilsGs:   -0.8,  ilsGsT: -0.8,
  locCaptured: false,            // APP mode — localizer captured (AP banks to track it)
  gsCaptured:  false,            // APP mode — glideslope captured (AP pitches to fly it)
  vacated:  false,               // landing runway left (slow + laterally clear) — unlocks the taxi-to-gate request
  vacateAt: null,                // {lat,lon} where the runway was vacated — start point for the gate routing

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
  cockpitView: 'forward',  // 'forward' | 'overhead' | 'pedestal'

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

  /* ── C172 switches ── */
  magnetos:    'OFF',    // 'OFF' | 'R' | 'L' | 'BOTH' | 'START'
  avionicsOn:  false,
  masterBat:   false,
  masterAlt:   false,
  fuelPump:    false,
  lights: { nav: false, beacon: false, strobe: false, landing: false },

  /* ── Fuel system ── */
  fuelSelector: 'BOTH',  // 'LEFT' | 'RIGHT' | 'BOTH' | 'OFF'
  fuelLeft:  null,        // litres — null = no fuel system on this aircraft
  fuelRight: null,

  /* ── Battery (electric aircraft) ── */
  batteryCharge: null,   // 0–100 % — null = not an electric aircraft

  /* ── Electrical system (turbofan aircraft) ── */
  bat1On:     false,     // BAT 1 master switch
  bat2On:     false,     // BAT 2 master switch
  bat3On:     false,     // APU BAT master switch
  bat1Charge: 100,       // 0–100 %
  bat2Charge: 100,
  bat3Charge: 100,
  extPwrOn:   false,     // EXT PWR A (ground only)
  extPwrBOn:  false,     // EXT PWR B (ground only)
  apuMasterOn: false,    // APU MASTER switch (latching)
  apuState:   'off',     // 'off' | 'starting' | 'running'
  apuBleedOn: false,     // APU bleed valve
  apuGenSwitch: true,    // APU GEN switch (true = ON)
  apuFireArmed: false,   // fire handle pulled — extinguisher armed
  apuRunning: false,     // derived from apuState
  apuGenOn:   false,     // derived — APU feeding AC bus
  idgConnected: [],      // bool[] per engine — IDG mechanical coupling (false = disconnected, irreversible)
  engGenSwitch: [],      // bool[] per engine — GEN switch ON/OFF
  engGenOn:   [],        // derived bool[] — one per engine
  engFireArmed: [],      // bool[] — fire handle pulled per engine
  engAgents:   [],       // bool[] — flat: [eng1_a1, eng1_a2, eng2_a1, eng2_a2, ...]
  apuAgent:    false,    // APU extinguisher agent discharged
  engMasters: [],        // bool[] — ENG MASTER switch per engine (pedestal)
  engMode:    'NORM',    // engine mode selector: 'NORM' | 'IGN+START' | 'CRANK'
  busTieAuto: true,      // bus tie mode: true=AUTO, false=MANUAL (open)
  galleyOn:   true,      // galley power enabled
  /* Per-AC-bus derived power states */
  acBus11:    false,     // AC BUS 1-1 (ENG 1 generator)
  acBus12:    false,     // AC BUS 1-2 (ENG 2 generator)
  acBus23:    false,     // AC BUS 2-3 (ENG 3 generator)
  acBus24:    false,     // AC BUS 2-4 (ENG 4 generator)
  acEssBus:   false,     // AC ESSENTIAL BUS
  dcBus1:     false,     // DC BUS 1 (TR1 from AC BUS 1-1)
  dcBus2:     false,     // DC BUS 2 (TR2 from AC BUS 2-4)
  dcEssBus:   false,     // DC ESSENTIAL BUS
  /* Generator display values (synthesized, updated each tick) */
  genVoltage: [],        // V per engine (115 VAC nominal)
  genFreq:    [],        // Hz per engine (400 Hz nominal)
  genLoad:    [],        // % per engine
  /* Backward-compat aggregate flags */
  essentialBusPowered: false,
  acBusPowered:        false,
  dcBusPowered:        false,

  /* ── Hydraulic system (turbofan aircraft) ── */
  hydGreenPsi:     0,     // 0–3000 psi
  hydBluePsi:      0,
  hydYellowPsi:    0,
  hydGreenElecOn:  false, // electric pump switches (overhead)
  hydBlueElecOn:   false,
  hydYellowElecOn: false,
  hydGreenEdp:     false, // derived — engine-driven pump running
  hydBlueEdp:      false,
  hydYellowEdp:    false,

  /* ── ECAM lower page ── */
  ecamPage: 'status',    // 'status' | 'elec' | 'hyd'

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

  /* ── Robot arm (SO-101) ── */
  armJoints:    null,   // [j1,j2,j3,j4,j5,j6] degrees — null = not a robot arm mission
  armGripper:   0,      // 0=open, 1=closed
  armTargetIdx: 0,      // index into mission.arm.targets

  /* ── Yertle quadruped dog ── */
  dogJoints:    null,   // [lf_sho,lf_thi,lf_shi, rf_..., lb_..., rb_...] degrees × 12

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

  /* ── G1000 overlay visibility ── */
  comPanelVisible: false,
};

/* Patch state — safe external write point */
export function setState(patch) {
  Object.assign(S, patch);
}
