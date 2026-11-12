/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/epsi.js
   What the Velis's EPSI 570C shows on its FLIGHT page (display/velis_epsi.js draws it) —
   the values from the sim, and STAND-INS where the sim has no model yet, each marked
   with what replaces it (as core/engine-gauges.js does for the analog panels).
   The page, from Markus's photo of HB-SYQ (sources/velis-panel-notes.md): TACHOMETER (rpm),
   the flight batteries F / R (%), POWER (kW), hh:mm, four temperatures (motor, controller,
   battery F, battery R — °C), AUX BATTERY (V), HOBBS.
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';
import { throttleFrac } from './engine.js';
import { onMissionReset } from './lifecycle.js';

/** What replaces each stand-in */
export const EPSI_STAND_INS = {
  power:       'the motor model — the power from the throttle and the motor (today the throttle × the E-811\'s maximum)',
  rpm:         'the motor model — the rpm (today the throttle × 2500, the E-811\'s maximum — to confirm from the POH)',
  batteries:   'the Velis\'s electrical graph with its two flight batteries (issues.md, "The Velis as a graph") — both show the one charge',
  endurance:   'what the EPSI counts there, from the POH — today the time left at cruise power',
  temperatures:'a thermal model of the motor, the controller and the batteries — fixed, as on Markus\'s photo',
  auxVolts:    'the electrical graph (the DC/DC converter charging the 12 V battery)',
  hobbs:       'a hobbs meter per aircraft — 210:32 as on Markus\'s photo, plus the time the motor runs',
};

const MAX_KW = 57.6, CONT_KW = 47.8, MAX_RPM = 2500;   // the E-811 (the aircraft's engine description; the rpm to confirm)
let _runSeconds = 0, _lastT = null;

/** The EPSI's FLIGHT page values */
export function epsiValues() {
  const running = S.engineState === 'running';
  const thr = running ? throttleFrac() : 0;
  /* the hobbs runs with the motor (sim time) */
  const t = S.time ?? 0;
  if (_lastT !== null && running && t > _lastT) _runSeconds += t - _lastT;
  _lastT = t;
  const soc = S.batteryCharge ?? 0;
  const bat = S.aircraft?.battery ?? {};
  const hoursLeft = (soc / 100) * (bat.capacityKwh ?? 21.8) / (bat.powerDrawKw ?? 25);
  const hobbs = 210 + 32 / 60 + _runSeconds / 3600;
  return {
    rpm: thr * MAX_RPM, maxRpm: MAX_RPM,
    kw: thr * MAX_KW, maxKw: MAX_KW, contKw: CONT_KW,
    batF: soc, batR: soc, reserve: 27,
    endurance: hoursLeft,
    temps: [ { what: 'motor', c: 34 }, { what: 'controller', c: 37 }, { what: 'F', c: 29 }, { what: 'R', c: 29 } ],
    auxV: S.switches?.battEn ? 13.7 : 12.6,
    hobbs,
  };
}

/** A new mission: the hobbs counts from its photo value again */
export function resetEpsi() { _runSeconds = 0; _lastT = null; }
onMissionReset(resetEpsi);
