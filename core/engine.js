/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/engine.js
   The engine lifecycle: off → starting → running → shutdown → off.

   The one owner of the engine state: S.engines[], and the single fields
   derived from it (S.engineState, S.engineStartT, S.engineStopT,
   S.enginePower, S.engineFactors, a turbofan's S.n1). Everything that starts or stops the engine — keys,
   cockpit switches, fuel starvation, a seized engine — calls in here;
   core/sound.js only follows the state and plays the matching sound.
   The lifecycle runs on sim time (tickEngine, from the frame loop), so
   it pauses with the sim, steps with simStep, and doesn't need audio.

   Turbofans: tickEngine also spools N1 toward the thrust command
   (S.n1Cmd, core/thrust.js) — physics.js reads S.n1 for the thrust.

   Data (aircraft.engine):
     type       'turbofan' — the start ends when N1 reaches idle, the
                shutdown when the fan has run down;
                'electric' — the motor follows MASTER + BATT EN + PWR EN.
     startTime  s from 'starting' to 'running' (the start-up recording's
                length — tests/engine.test.mjs keeps the two equal).
                Absent → the engine has no start sequence (it just runs).
     stopTime   s from 'shutdown' to 'off' (non-turbofans).
     starter    'electric' — the starter needs the battery: no start with
                BAT off (masterBat). Absent → no power condition (the
                Bf 109's inertia starter, the airliners' pedestal start).

   Power: S.enginePower (0–1, scales thrust) is computed here and only here,
   as the lifecycle's share × the product of the causes' factors
   (S.engineFactors). Each cause owns its factor and sets it through
   setEngineFactor(): a failure ramp, carb ice, a seizure, a flat battery,
   a crash. So causes combine instead of overwriting each other.

   The APU is an engine too (aircraft.apu): MASTER, START and the fire
   handle call apuMaster() / apuStart() / apuFire(); the start runs on sim
   time for apu.startTime s (the APU start-up recording's length). Owned
   here: apuMasterOn, apuState, apuStartT, apuRunning, apuFireArmed.
   core/electrical.js reads apuState for the APU GEN.

   S.engines[] holds one entry per engine. The commands take an engine index
   (0-based) — ENG MASTER i, a failure on one engine — or act on all engines
   when it is absent (E, Q, the light aircraft).
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

/* The causes that limit power, each 0–1, owned by its module (failures.js, battery.js, physics.js) */
const FACTORS_NONE = Object.freeze({ failure: 1, ice: 1, seizure: 1, battery: 1, crash: 1 });

/* The lifecycle's share: nothing when off, a trickle while the starter turns, all of it when
   running. A shutdown keeps it until the engine is off (the run-down sounds follow RPM/N1). */
const LIFECYCLE_POWER = { off: 0, starting: 0.01, running: 1, shutdown: 1 };

function _power(state, factors) {
  let p = LIFECYCLE_POWER[state] ?? 0;
  for (const v of Object.values(factors)) p *= v;
  return p;
}

const _eng       = () => S.aircraft?.engine ?? {};
const _turbofan  = () => _eng().type === 'turbofan';
const _idleN1    = () => _eng().idleN1 ?? 22;
const _count     = (eng = _eng()) => Math.max(1, eng.count ?? 1);

/* ── The engines ─────────────────────────────────────────────────
   S.engines[i] = { state, startT, stopT, n1, factors, power } — one per engine.
   The single fields the rest of the sim still reads (engineState, enginePower, n1,
   engineStartT, engineStopT, engineFactors) are derived from the array on every change;
   what must tell the engines apart (thrust, generators, pumps, the engine displays) reads
   the array. */

function _newEngine(state, n1 = 0) {
  return { state, startT: null, stopT: null, n1, factors: FACTORS_NONE, power: _power(state, FACTORS_NONE) };
}

/** The engine array (before the first mission load: one engine from the single fields) */
function _engines() {
  return S.engines?.length ? S.engines : [_newEngine(S.engineState ?? 'off', S.n1 ?? 0)];
}

/** An engine in a new lifecycle state, with the power that state gives with its factors */
function _withState(e, patch) {
  return { ...e, ...patch, power: _power(patch.state ?? e.state, e.factors) };
}

/* The single fields, derived: the "highest" state (running > starting > shutdown > off), and the
   largest N1 and power — exact while the engines are identical (a mean of four would round). */
const _STATE_ORDER = ['running', 'starting', 'shutdown', 'off'];
function _aggregate(engines) {
  return {
    engines,
    engineState:   _STATE_ORDER.find(st => engines.some(e => e.state === st)) ?? 'off',
    engineStartT:  engines.find(e => e.state === 'starting')?.startT ?? null,
    engineStopT:   engines.find(e => e.state === 'shutdown')?.stopT ?? null,
    n1:            Math.max(...engines.map(e => e.n1)),
    enginePower:   Math.max(...engines.map(e => e.power)),
    engineFactors: engines[0].factors,
  };
}
function _publish(engines, extra = {}) { setState({ ..._aggregate(engines), ...extra }); }

/* single field → engine field, for adoptEngineFields() */
const _LEGACY = { engineState: 'state', engineStartT: 'startT', engineStopT: 'stopT', n1: 'n1', enginePower: 'power', engineFactors: 'factors' };

/**
 * A patch that sets the single engine fields directly (the test API's simSetState) — carry the
 * values into every engine, so the array and the fields agree. Not for sim code: that calls
 * the commands below.
 */
export function adoptEngineFields(patch) {
  const keys = Object.keys(patch).filter(k => k in _LEGACY);
  if (!keys.length) return;
  const base = _engines();
  const engines = Array.from({ length: _count() }, (_, k) => {
    const e = { ...(base[k] ?? base[0]) };
    for (const key of keys) e[_LEGACY[key]] = patch[key];
    return e;
  });
  setState({ engines });
}

/* Which engines a command reaches: engine index i (0-based), or all of them when i is absent */
const _hits = (i) => (k) => i == null || k === i;

/** An engine's available power — the product of its causes' factors (0 = flamed out, failed). */
export function engineAvailable(e) {
  let p = 1;
  for (const v of Object.values(e.factors ?? FACTORS_NONE)) p *= v;
  return p;
}

/** Set one cause's factor (0–1) on engine i, or on all engines — the only way to change engine power from outside. */
export function setEngineFactor(cause, value, i) {
  if (!(cause in FACTORS_NONE)) throw new Error(`engine: unknown power factor "${cause}"`);
  const v = Math.max(0, Math.min(1, value));
  const hit = _hits(i);
  _publish(_engines().map((e, k) => {
    if (!hit(k)) return e;
    const factors = { ...e.factors, [cause]: v };
    return { ...e, factors, power: _power(e.state, factors) };
  }));
}

/** Has this engine a start sequence (E key, magnetos START, ENG MASTER)? */
export function hasStartSequence(engine = _eng()) {
  return engine.startTime != null;
}

/**
 * The engine part of the mission's initial state — written by loadMission() in its one
 * setState. Ground starts of engines with a start sequence (and the switch-driven electric
 * motor) begin cold; everything else, and every airborne start, begins running. An airliner
 * lined up on the runway has its engines running (onRunway — mission.start.runway); at a stand
 * it is cold. Light aircraft start cold on the runway too: their missions teach the start.
 */
export function initialEngine(aircraft, { onGround, spd, onRunway = false }) {
  const eng  = aircraft.engine ?? {};
  const cold = onGround && (hasStartSequence(eng) || eng.type === 'electric')
            && !(eng.type === 'turbofan' && onRunway);
  const idle = eng.idleN1 ?? 22;
  /* Turbofan N1 matches the cruise throttle when airborne, 0 when off */
  const n1 = (eng.type !== 'turbofan' || cold) ? 0
           : idle + (100 - idle) * Math.min(1, Math.max(0, spd / (aircraft.envelope?.maxSpd ?? 340)));
  const count   = _count(eng);
  const engines = Array.from({ length: count }, () => _newEngine(cold ? 'off' : 'running', n1));
  return { ..._aggregate(engines),
           engMasters: Array(count).fill(!cold),                   // ENG MASTER switches: on when the engines run
           apuMasterOn: false, ...APU_OFF, apuFireArmed: false };   // the APU is off at every mission start
}

/* ── APU ─────────────────────────────────────────────────────── */

const APU_OFF = { apuState: 'off', apuStartT: null, apuRunning: false };

/** APU MASTER switch. Off shuts the APU down at once (and closes its bleed valve). */
export function apuMaster(on) {
  if (on) setState({ apuMasterOn: true });
  else    setState({ apuMasterOn: false, ...APU_OFF, apuBleedOn: false });
}

/** APU START (momentary): needs the MASTER on and battery power on the essential bus. */
export function apuStart() {
  if (!S.aircraft?.apu) return;
  if (!(S.apuMasterOn ?? false)) return;
  if (!(S.essentialBusPowered ?? false)) return;
  if ((S.apuState ?? 'off') !== 'off') return;
  setState({ apuState: 'starting', apuStartT: 0 });
}

/** APU FIRE handle: shuts the APU down and arms the extinguisher. */
export function apuFire() {
  setState({ apuMasterOn: false, ...APU_OFF, apuBleedOn: false, apuFireArmed: true });
}

function _tickApu(dt) {
  if (S.apuState !== 'starting') return;
  const t = (S.apuStartT ?? 0) + dt;
  if (t >= (S.aircraft?.apu?.startTime ?? 0)) setState({ apuState: 'running', apuStartT: null, apuRunning: true });
  else setState({ apuStartT: t });
}

/** Start engine i, or all engines (E key, magnetos START, ENG MASTER). Ignored while it starts or
    runs, and — except a turbofan, which can be restarted while the fan spools down — until it has run down. */
export function startEngine(i) {
  if (!hasStartSequence()) return;
  const engines = _engines();
  const hit  = _hits(i);
  const idle = (e) => e.state !== 'starting' && e.state !== 'running';
  if (!engines.some((e, k) => hit(k) && idle(e))) return;
  const turbofan = _turbofan();
  const refusedAll = !turbofan && (S.coolantState === 'failed'                      // seized — it won't turn over
                                || (S.fuelShutoff && S.fuelLeft !== null)           // fuel shutoff closed — no start
                                || (_eng().starter === 'electric' && !S.masterBat)); // electric starter, battery off — nothing turns
  const next = engines.map((e, k) => (!hit(k) || !idle(e) || refusedAll || (!turbofan && e.state === 'shutdown'))   // still running down — no starter on a turning engine
                                   ? e : _withState(e, { state: 'starting', startT: 0, stopT: null }));
  if (next.every((e, k) => e === engines[k])) {
    if (S.magnetos === 'START') setState({ magnetos: 'BOTH' });   // refused — the key springs back from START
    return;
  }
  _publish(next);
}

/** Normal shutdown of engine i, or all engines (Q, magnetos OFF, ENG MASTER off, fire handle): it runs
    down. On a turbofan the ENG MASTER switches are the fuel cutoff — the stopped engines' go to OFF. */
export function stopEngine(i) {
  if (!hasStartSequence()) return;
  const engines = _engines();
  const hit  = _hits(i);
  const next = engines.map((e, k) => (!hit(k) || e.state === 'off' || e.state === 'shutdown')
                                   ? e : _withState(e, { state: 'shutdown', startT: null, stopT: 0 }));
  if (next.every((e, k) => e === engines[k])) return;
  const extra = {};
  if (_turbofan()) extra.engMasters = Array.from({ length: _count() }, (_, k) => hit(k) ? false : !!S.engMasters?.[k]);
  _publish(next, extra);
}

/**
 * ENG MASTER switch i (pedestal) — engine i. ON with ENG MODE at IGN/START starts it — and needs
 * AC power, or the switch drops back to OFF; in NORM it only latches. OFF cuts its fuel: it runs down.
 */
export function engineMaster(i, on) {
  const n = Math.max(1, _eng().count ?? 1);
  const masters = Array.from({ length: n }, (_, k) => !!S.engMasters?.[k]);
  if (on && (S.engMode ?? 'NORM') === 'IGN+START' && !(S.acBusPowered ?? false)) return;   // no AC power — no start, the switch drops back
  masters[i] = on;
  setState({ engMasters: masters });
  if (on && (S.engMode ?? 'NORM') === 'IGN+START') startEngine(i);
  else if (!on) stopEngine(i);
}

/** Engine i, or all engines, quit at once — fuel starvation, a seized engine. Restartable unless seized. */
export function engineQuit(i) {
  const engines = _engines();
  const hit = _hits(i);
  if (engines.every((e, k) => !hit(k) || e.state === 'off')) return;
  _publish(engines.map((e, k) => (!hit(k) || e.state === 'off') ? e : _withState(e, { state: 'off', startT: null, stopT: null })));
}

/* Turbofan N1 — the fan eases toward its target with asymmetric time constants: 8 s
   spool-up, 15 s spool-down (4 s at ground idle), 25 s while starting, 12 s coasting down
   after a fuel cutoff. A running engine follows the thrust command (core/thrust.js), up to what its
   available power allows: idle + (100 − idle) · power. With no power left it has flamed out and the
   fan runs down. (A turbofan's power acts through its N1 — physics.js takes the thrust from N1 alone.) */
function _spoolN1(e, dt) {
  const idle  = _idleN1();
  const avail = engineAvailable(e);
  const target = e.state === 'running'  ? (avail <= 0 ? 0 : Math.min(S.n1Cmd ?? idle, idle + (100 - idle) * avail))
               : e.state === 'starting' ? idle
               : 0;                                              // 'off' or 'shutdown'
  const idleLever = (S.thrustLever ?? 0) < 0.05;
  const tau = e.state === 'starting' ? 25
            : e.state === 'shutdown' ? 12                        // fuel cutoff — the fan coasts down by inertia, a slow ~30 s wind-down (not the ground-idle fast case)
            : target > e.n1 ? 8
            : (S.wow && idleLever && !S.thrustReverser) ? 4      // ground idle (e.g. after the reverser stows) — spool down fast, no lingering roar
            : 15;
  const n1 = e.n1 + (target - e.n1) * (1 - Math.exp(-dt / tau));
  return { ...e, n1: Math.max(0, Math.min(100, n1)) };
}

/* One engine's lifecycle step (after the spool, so it sees the new N1) */
function _stepLifecycle(e, dt, eng) {
  if (e.state === 'starting') {
    const t    = (e.startT ?? 0) + dt;
    const done = t >= (eng.startTime ?? 0)
              || (eng.type === 'turbofan' && e.n1 >= _idleN1() * 0.95);   // fan at idle — the start is complete
    return done ? _withState(e, { state: 'running', startT: null }) : { ...e, startT: t };
  }
  if (e.state === 'shutdown') {
    const t    = (e.stopT ?? 0) + dt;
    const done = eng.type === 'turbofan' ? e.n1 < 0.5             // fan has run down
                                         : t >= (eng.stopTime ?? 0);
    return done ? _withState(e, { state: 'off', startT: null, stopT: null }) : { ...e, stopT: t };
  }
  return e;
}

/** One sim step — called from tickSim() right before physics: the turbofan spool, then the lifecycle. */
export function tickEngine(dt) {
  const eng = _eng();
  _tickApu(dt);
  const before = _engines();
  let engines = before;
  if (_turbofan() && !S.paused && !S.crashed) engines = engines.map(e => _spoolN1(e, dt));   // same guards as tickPhysics

  /* Electric motor: no start sequence, it follows the power switches */
  if (eng.type === 'electric') {
    const sw    = S.switches ?? {};
    const ready = !!(sw.master && sw.battEn && sw.pwrEn);
    engines = engines.map(e => ready && e.state !== 'running'  ? _withState(e, { state: 'running' })
                             : !ready && e.state === 'running' ? _withState(e, { state: 'off' })
                             : e);
  } else {
    engines = engines.map(e => _stepLifecycle(e, dt, eng));
  }
  if (engines.every((e, k) => e === before[k])) return;

  const extra = {};
  if (eng.type !== 'turbofan' && engines.some((e, k) => e.state === 'running' && before[k].state === 'starting')) {
    extra.engineTemp = Math.min(1, (S.engineTemp ?? 0) + 0.8);
    if (S.magnetos === 'START') extra.magnetos = 'BOTH';       // key springs back from START
  }
  _publish(engines, extra);
}
