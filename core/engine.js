/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/engine.js
   The engine lifecycle: off → starting → running → shutdown → off.

   The one owner of the engine state (S.engineState, S.engineStartT,
   S.engineStopT, and a turbofan's S.n1). Everything that starts or stops the engine — keys,
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

   Still one engine per aircraft — the array comes in stage 1 of
   issues.md "One engine per aircraft".
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const ENGINE_OFF = { engineState: 'off', engineStartT: null, engineStopT: null };

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

/** Set one cause's factor (0–1) — the only way to change engine power from outside. */
export function setEngineFactor(cause, value) {
  if (!(cause in FACTORS_NONE)) throw new Error(`engine: unknown power factor "${cause}"`);
  const v = Math.max(0, Math.min(1, value));
  const factors = { ...(S.engineFactors ?? FACTORS_NONE), [cause]: v };
  setState({ engineFactors: factors, enginePower: _power(S.engineState ?? 'off', factors) });
}

/** A lifecycle step: the new state plus the power it gives with the current factors. */
function _toState(patch) {
  setState({ ...patch, enginePower: _power(patch.engineState ?? S.engineState ?? 'off', S.engineFactors ?? FACTORS_NONE) });
}

const _eng       = () => S.aircraft?.engine ?? {};
const _turbofan  = () => _eng().type === 'turbofan';
const _idleN1    = () => _eng().idleN1 ?? 22;

/** Has this engine a start sequence (E key, magnetos START, ENG MASTER)? */
export function hasStartSequence(engine = _eng()) {
  return engine.startTime != null;
}

/**
 * The engine part of the mission's initial state — written by loadMission() in its one
 * setState. Ground starts of engines with a start sequence (and the switch-driven electric
 * motor) begin cold; everything else, and every airborne start, begins running.
 */
export function initialEngine(aircraft, { onGround, spd }) {
  const eng  = aircraft.engine ?? {};
  const cold = onGround && (hasStartSequence(eng) || eng.type === 'electric');
  const idle = eng.idleN1 ?? 22;
  /* Turbofan N1 matches the cruise throttle when airborne, 0 when off */
  const n1 = (eng.type !== 'turbofan' || cold) ? 0
           : idle + (100 - idle) * Math.min(1, Math.max(0, spd / (aircraft.envelope?.maxSpd ?? 340)));
  const engineState = cold ? 'off' : 'running';
  const count = Math.max(1, eng.count ?? 1);
  return { engineState, engineFactors: FACTORS_NONE, enginePower: _power(engineState, FACTORS_NONE), n1,
           engineStartT: null, engineStopT: null,
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

/** Start the engine (E key, magnetos START, ENG MASTER). Ignored while it starts or runs, and —
    except a turbofan, which can be restarted while the fan spools down — until it has run down. */
export function startEngine() {
  if (!hasStartSequence()) return;
  const st = S.engineState ?? 'off';
  if (st === 'starting' || st === 'running') return;
  if (!_turbofan()) {
    const refused = st === 'shutdown'                                // still running down — no starter on a turning engine
                 || S.coolantState === 'failed'                      // seized — it won't turn over
                 || (S.fuelShutoff && S.fuelLeft !== null)           // fuel shutoff closed — no start
                 || (_eng().starter === 'electric' && !S.masterBat); // electric starter, battery off — nothing turns
    if (refused) {
      if (S.magnetos === 'START') setState({ magnetos: 'BOTH' });   // the key springs back from START
      return;
    }
  }
  _toState({ engineState: 'starting', engineStartT: 0, engineStopT: null });
}

/** Normal shutdown (Q, magnetos OFF, ENG MASTER off, fire handle): the engine runs down.
    On a turbofan the ENG MASTER switches are the fuel cutoff — they go to OFF. */
export function stopEngine() {
  if (!hasStartSequence()) return;
  const st = S.engineState ?? 'off';
  if (st === 'off' || st === 'shutdown') return;
  const patch = { engineState: 'shutdown', engineStartT: null, engineStopT: 0 };
  if (_turbofan()) patch.engMasters = Array(Math.max(1, _eng().count ?? 1)).fill(false);
  _toState(patch);
}

/**
 * ENG MASTER switch i (pedestal). ON with ENG MODE at IGN/START starts the engine — and needs
 * AC power, or the switch drops back to OFF; in NORM it only latches. OFF stops the engine once
 * every master is off (one shared engine until stage 1/2 of issues.md "One engine per aircraft").
 */
export function engineMaster(i, on) {
  const n = Math.max(1, _eng().count ?? 1);
  const masters = Array.from({ length: n }, (_, k) => !!S.engMasters?.[k]);
  if (on && (S.engMode ?? 'NORM') === 'IGN+START' && !(S.acBusPowered ?? false)) return;   // no AC power — no start, the switch drops back
  masters[i] = on;
  setState({ engMasters: masters });
  if (on && (S.engMode ?? 'NORM') === 'IGN+START') startEngine();
  else if (!on && masters.every(m => !m)) stopEngine();
}

/** The engine quits at once — fuel starvation, a seized engine. Restartable unless seized. */
export function engineQuit() {
  if ((S.engineState ?? 'off') === 'off') return;
  _toState(ENGINE_OFF);
}

/* Turbofan N1 — the fan eases toward its target with asymmetric time constants: 8 s
   spool-up, 15 s spool-down (4 s at ground idle), 25 s while starting, 12 s coasting down
   after a fuel cutoff. A running engine follows the thrust command (core/thrust.js). */
function _spoolN1(dt) {
  const st    = S.engineState ?? 'off';
  const idle  = _idleN1();
  const n1Now = S.n1 ?? 0;
  const target = st === 'running'  ? (S.n1Cmd ?? idle)
               : st === 'starting' ? idle
               : 0;                                              // 'off' or 'shutdown'
  const idleLever = (S.thrustLever ?? 0) < 0.05;
  const tau = st === 'starting' ? 25
            : st === 'shutdown' ? 12                             // fuel cutoff — the fan coasts down by inertia, a slow ~30 s wind-down (not the ground-idle fast case)
            : target > n1Now ? 8
            : (S.wow && idleLever && !S.thrustReverser) ? 4      // ground idle (e.g. after the reverser stows) — spool down fast, no lingering roar
            : 15;
  const n1 = n1Now + (target - n1Now) * (1 - Math.exp(-dt / tau));
  setState({ n1: Math.max(0, Math.min(100, n1)) });
}

/** One sim step — called from tickSim() right before physics: the turbofan spool, then the lifecycle. */
export function tickEngine(dt) {
  const eng = _eng();
  _tickApu(dt);
  if (_turbofan() && !S.paused && !S.crashed) _spoolN1(dt);   // same guards as tickPhysics
  const st  = S.engineState ?? 'off';

  /* Electric motor: no start sequence, it follows the power switches */
  if (eng.type === 'electric') {
    const sw    = S.switches ?? {};
    const ready = !!(sw.master && sw.battEn && sw.pwrEn);
    if (ready && st !== 'running')       _toState({ engineState: 'running' });
    else if (!ready && st === 'running') _toState({ engineState: 'off' });
    return;
  }

  if (st === 'starting') {
    const t    = (S.engineStartT ?? 0) + dt;
    const done = t >= (eng.startTime ?? 0)
              || (_turbofan() && (S.n1 ?? 0) >= _idleN1() * 0.95);   // fan at idle — the start is complete
    if (!done) { setState({ engineStartT: t }); return; }
    const up = { engineState: 'running', engineStartT: null };
    if (!_turbofan()) {
      up.engineTemp = Math.min(1, (S.engineTemp ?? 0) + 0.8);
      if (S.magnetos === 'START') up.magnetos = 'BOTH';       // key springs back from START
    }
    _toState(up);
    return;
  }

  if (st === 'shutdown') {
    const t    = (S.engineStopT ?? 0) + dt;
    const done = _turbofan() ? (S.n1 ?? 0) < 0.5               // fan has run down
                             : t >= (eng.stopTime ?? 0);
    if (done) _toState(ENGINE_OFF);
    else setState({ engineStopT: t });
  }
}
