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

   Still one engine per aircraft — the array comes in stage 1 of
   issues.md "One engine per aircraft".
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

const ENGINE_OFF = { engineState: 'off', engineStartT: null, engineStopT: null };

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
  return { engineState: cold ? 'off' : 'running', enginePower: cold ? 0 : 1.0, n1,
           engineStartT: null, engineStopT: null };
}

/** Start the engine (E key, magnetos START, ENG MASTER). Ignored while it starts or runs, and —
    except a turbofan, which can be restarted while the fan spools down — until it has run down. */
export function startEngine() {
  if (!hasStartSequence()) return;
  const st = S.engineState ?? 'off';
  if (st === 'starting' || st === 'running') return;
  if (!_turbofan()) {
    if (st === 'shutdown') return;                           // still running down — no starter on a turning engine
    if (S.coolantState === 'failed') return;                 // seized — it won't turn over
    if (S.fuelShutoff && S.fuelLeft !== null) return;        // fuel shutoff closed — no start
  }
  setState({ engineState: 'starting', engineStartT: 0, engineStopT: null, enginePower: 0.01 });
}

/** Normal shutdown (Q, magnetos OFF, ENG MASTER off, fire handle): the engine runs down. */
export function stopEngine() {
  if (!hasStartSequence()) return;
  const st = S.engineState ?? 'off';
  if (st === 'off' || st === 'shutdown') return;
  setState({ engineState: 'shutdown', engineStartT: null, engineStopT: 0 });
}

/** The engine quits at once — fuel starvation, a seized engine. Restartable unless seized. */
export function engineQuit() {
  if ((S.engineState ?? 'off') === 'off') return;
  setState(ENGINE_OFF);
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
  if (_turbofan() && !S.paused && !S.crashed) _spoolN1(dt);   // same guards as tickPhysics
  const st  = S.engineState ?? 'off';

  /* Electric motor: no start sequence, it follows the power switches */
  if (eng.type === 'electric') {
    const sw    = S.switches ?? {};
    const ready = !!(sw.master && sw.battEn && sw.pwrEn);
    if (ready && st !== 'running')      setState({ engineState: 'running', enginePower: 1.0 });
    else if (!ready && st === 'running') setState({ engineState: 'off', enginePower: 0 });
    return;
  }

  if (st === 'starting') {
    const t    = (S.engineStartT ?? 0) + dt;
    const done = t >= (eng.startTime ?? 0)
              || (_turbofan() && (S.n1 ?? 0) >= _idleN1() * 0.95);   // fan at idle — the start is complete
    if (!done) { setState({ engineStartT: t }); return; }
    const up = { engineState: 'running', engineStartT: null, enginePower: 1.0 };
    if (!_turbofan()) {
      up.engineTemp = Math.min(1, (S.engineTemp ?? 0) + 0.8);
      if (S.magnetos === 'START') up.magnetos = 'BOTH';       // key springs back from START
    }
    setState(up);
    return;
  }

  if (st === 'shutdown') {
    const t    = (S.engineStopT ?? 0) + dt;
    const done = _turbofan() ? (S.n1 ?? 0) < 0.5               // fan has run down
                             : t >= (eng.stopTime ?? 0);
    setState(done ? ENGINE_OFF : { engineStopT: t });
  }
}
