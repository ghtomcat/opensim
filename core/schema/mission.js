/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/schema/mission.js
   Schema for missions/<id>.json. See core/schema/check.js for the rules.
   The names come from core/vocab.js — the same lists the code checks
   its dispatch tables against.
   ═══════════════════════════════════════════════════════════════ */

import { str, num, bool, open, oneOf, arrayOf, mapOf, anyOf, nullable, object } from './check.js';
import { TRIGGER, ROCKET_EVENT, FAILURE, FAILURE_TRIGGER, COMM_PROFILE, valuesOf } from '../vocab.js';

const commProfile = oneOf(...valuesOf(COMM_PROFILE));

/* ── Weather: manual block, and the fallback METAR (same field names as a live METAR) ── */
const cloud = object({ cover: str, base: num });
const weatherManual = object(
  { wdir: num, wspd: num, altim: num, temp: num, turbulence: num },
  { planned: { visib: str, snow: bool } },   // no ATIS for manual weather, no fog/snow drawing yet
);
const weatherFallback = object({
  wdir: num, wspd: num, altim: num, temp: num, dewp: num, visib: str, clouds: arrayOf(cloud), turbulence: num,
});
const weather = object(
  { source: oneOf('manual', 'live'), icao: str, manual: weatherManual, fallback: weatherFallback },
  { required: ['source'] },
);

/* ── Airports ── */
const departure = object({ name: str, icao: str, runway: str, elevation: num });
const arrival = object({
  name: str, icao: str, runway: str, elevation: num, dock: str, surface: str,
  ils: nullable(object({ course: num, freq: str })),
  rwyHdg: num, rwyLat: num, rwyLon: num, rwyLengthM: num, rwyWidthM: num,
});

const initialState = object(
  { alt: num, spd: num, hdg: num, pitch: num, roll: num, lat: num, lon: num,
    ap: bool, athr: bool, gear: bool, autobrake: str, spdManaged: bool, speedBrake: num },
  { required: ['alt', 'spd', 'pitch', 'roll'] },
);

/* ── Radio ── */
const frequency = object({
  label: str, afis: bool, atis: bool, squawk: bool, checkin: str,
  stream: str, streamPage: str, audio: nullable(str),
});
export const com = object({
  title: str, active: str, standby: str, xpdrLabel: str,
  freqs: mapOf(frequency),
  loops: arrayOf(object({ id: str, label: str, audio: str })),
});

/* ── Mission script (atcClearances) ── */
const trigger = object(
  { type: oneOf(...valuesOf(TRIGGER)), t: num, min: num, idx: num, delay: num },
  { required: ['type'] },
);
const clearance = object({
  /* when */   t: num, trigger, event: oneOf(...valuesOf(ROCKET_EVENT)), uid: str, delay: num,
               alt: num, alt_ft: num, alt_km: num,
  /* who */    voice: str, speaker: str, commProfile,
  /* what */   text: str, audio: str, volume: num, startTime: num, duration: num,
  /* call-response */ pm: str, atc: str, ack: str, pmAudio: str, atcAudio: str, ackAudio: str,
});

/* ── Failures: scripted (core/failures.js) or a rocket anomaly (core/rocket.js) ── */
const scriptedFailure = object(
  { type: oneOf(...valuesOf(FAILURE)), value: num,
    trigger: object({ type: oneOf(...valuesOf(FAILURE_TRIGGER)), t: num, alt: num }, { required: ['type'] }) },
  { required: ['type', 'trigger'] },
);
const rocketFailure = object(
  { id: str, label: str, t: num, affects: arrayOf(str), masterAlarm: bool },
  { required: ['id', 't'] },
);

/* ── Kneeboard pages ── */
const dskyItem = object({ step: str, desc: str, registers: arrayOf(str), dsky: open });
const kneeboardPage = object(
  { type: oneOf('briefing', 'checklist', 'dsky', 'scratch'), title: str, items: arrayOf(anyOf(str, dskyItem)) },
  { required: ['type'] },
);

export const mission = object(
  {
    id: str, title: str, phase: oneOf('ground', 'departure', 'cruise', 'approach', 'circuit', 'launch'),
    aircraft: str,
    initialState, start: object({ runway: str, at: str, stand: str }),
    departure: nullable(departure), arrival: nullable(arrival),
    weather, timeOfDay: num, water: bool,
    com, commProfile, characters: mapOf(object({ commProfile })),
    atcClearances: arrayOf(clearance),
    approachBrief: arrayOf(object({ t: str, v: str })), approachBriefAlt: num,
    failures: arrayOf(anyOf(scriptedFailure, rocketFailure)),
    debrief: arrayOf(anyOf(str, object({ q: str }))),
    kneeboard: arrayOf(kneeboardPage),
    waypoints: arrayOf(object({ name: str, type: str, lat: num, lon: num, alt: num })),
    events: arrayOf(object({ t: num, label: str })),
    /* rockets */
    crew: mapOf(str), dragonSeats: arrayOf(str), dragonSepT: num, targetOrbitKm: num,
    engineFailures: arrayOf(object({ t: num, stageIdx: num, failedEngines: arrayOf(num),
                                     activeEngines: num, burnExtension: num })),
    hasLM: bool, noLOI: bool, moonRefAngle: num, sivbSepT: num,
    tliT: num, tliDv: num, tliDuration: num, loiT: num, loiDv: num, teiT: num, teiDv: num,
    mcc1T: num, mcc2T: num, mcc4T: num, pc2T: num, pc2Dv: num, deorbitT: num, deorbitDv: num,
    reentryGuidance: object({ bankGain: num, bankMax: num, ldRatio: num, targetLat: num, targetLon: num }),
    /* robot arm */
    arm: object(
      { targets: arrayOf(object({ id: str, label: str, joints: arrayOf(num), color: str })) },
      { planned: { toleranceDeg: num, safeWorkspace: object({ maxReachMm: num, heightLimitMm: num }) } },
    ),
  },
  {
    required: ['id', 'title', 'initialState', 'weather'],
    doc: { author: str, description: str, narrative: arrayOf(str), fiction_note: str, book: str },
    planned: { scoring: object({ timeLimit: num, penaltyPerViolation: num }) },
    check: (m) => {
      const errs = [];
      const n = m.atcClearances?.length ?? 0;
      (m.atcClearances ?? []).forEach((c, i) => {
        if (c.trigger?.type === 'after' && !(Number.isInteger(c.trigger.idx) && c.trigger.idx >= 0 && c.trigger.idx < n && c.trigger.idx !== i))
          errs.push(`atcClearances[${i}]: "after" trigger needs idx of another clearance (0…${n - 1})`);
      });
      return errs;
    },
  },
);
