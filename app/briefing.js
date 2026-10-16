/* ═══════════════════════════════════════════════════════════════
   OpenSim — app/briefing.js
   The briefing page without the screen: which layout a mission gets,
   which choices it offers (weather, crew, failure) and how the
   pilot's picks become the setup that loadMission() applies
   (core/mission.js).
   Pure — no DOM, no S.
     m   = the catalog entry, md = the mission file, acd = the aircraft file
   ═══════════════════════════════════════════════════════════════ */

import { FAILURE } from '../core/vocab.js';

/** The page's main content: the scanned orders, the airliner's charts, or the story text. */
export function briefingLayout(m, acd = {}) {
  if (m.briefing?.document && m.briefing?.image) return 'doc';
  if (acd.panel === 'airbus' || acd.panel === 'e190') return 'chart';   // WB/NB glass airliners
  return 'text';
}

/**
 * The choices a mission offers. Fixed-story missions script their weather and failures;
 * launches, rockets and robot labs have no weather or engine failure to pick. The phase is
 * in the mission file, not the catalog.
 *   → { weather: bool, failure: bool, crew: [crew or roles] }
 */
export function setupChoices(m, md = {}, acd = {}) {
  if (m.fixedScenario || m.id === 'live-flight') return { weather: false, failure: false, crew: [] };
  const vt = acd.vehicleType ?? '';
  const flies = md.phase !== 'launch' && vt !== 'rocket' && !vt.startsWith('robot');
  return { weather: flies, failure: flies, crew: crewPresets(m) };
}

/** What "keep the mission's weather" means here: live METAR, or the weather it was written with. */
export const ownWeatherLabel = (md = {}) => md.weather?.source === 'live' ? 'Live METAR' : 'As briefed';

/* ── Weather ── */
const _wx = (clouds) => ({
  source: 'manual',
  manual: { wdir: 270, wspd: 8, altim: 1013, temp: 12, dewp: 5, visib: '10+', clouds },
});

/** override null = keep the mission's own weather (live METAR). */
export const WEATHER_PRESETS = [
  { id: 'LIVE',     label: 'Live METAR',      override: null },
  { id: 'CLEAR',    label: 'Clear · VFR',      override: _wx([]) },
  { id: 'FEW 5K',   label: 'Few clouds 5000',  override: _wx([{ cover: 'FEW', base: 5000 }]) },
  { id: 'SCT 3K',   label: 'Scattered 3000',   override: _wx([{ cover: 'SCT', base: 3000 }]) },
  { id: 'BKN 2K',   label: 'Broken 2000',      override: { source: 'manual', manual: { wdir: 250, wspd: 12, altim: 1010, temp: 9, dewp: 7, visib: '6+', clouds: [{ cover: 'BKN', base: 2000 }] } } },
  { id: 'OVC 1500', label: 'Overcast 1500',    override: { source: 'manual', manual: { wdir: 240, wspd: 15, altim: 1008, temp: 8, dewp: 7, visib: '5',   clouds: [{ cover: 'OVC', base: 1500 }] } } },
];

/* ── Crew ── */
/** Named crew if the mission has them, else its roles; [] = no crew choice. */
export function crewPresets(m) {
  return m.crew?.length > 0 ? m.crew
       : m.roles?.length > 0 ? m.roles
       : [];
}

/* ── Failures ── */
/** Carb icing only where the aircraft has carb heat to recover with. */
export function failurePresets({ hasCarbHeat = false } = {}) {
  return [
    { id: 'CLEAN',   label: 'No failure',       failures: [] },
    ...(hasCarbHeat ? [{ id: 'CARB ICE', label: 'Carb icing · descent', carbIce: true }] : []),
    { id: 'PARTIAL', label: '50% power · 30s',  severity: 0.5, ramp: 30, bang: false },
    { id: 'ROUGH',   label: '30% power · bang', severity: 0.3, ramp: 20, bang: true  },
    { id: 'FAILURE', label: 'Full failure',      severity: 0.0, ramp: 15, bang: true  },
  ];
}

/** When the failure comes: random 60–300 s, or the pilot's fixed time (min 10 s, blank = 120 s). */
export function failureTime(timing, rand = Math.random) {
  return timing.random
    ? Math.floor(60 + rand() * 240)
    : Math.max(10, parseInt(timing.fixedT) || 120);
}

/** A failure preset at time T → the failure entries core/failures.js runs. */
export function failureEntries(preset, T) {
  if (!preset || preset.id === 'CLEAN') return [];
  if (preset.carbIce) return [{ trigger: { type: 'time', t: T }, type: FAILURE.CARB_ICE }];
  const out = [];
  if (preset.bang) {
    out.push({ trigger: { type: 'time', t: T     }, type: FAILURE.ENGINE_GUNFIRE });
    out.push({ trigger: { type: 'time', t: T + 1 }, type: FAILURE.ENGINE_BANG });
  }
  out.push({ trigger: { type: 'time', t: T + (preset.bang ? 1 : 0) }, type: FAILURE.ENGINE_POWER,
             value: preset.severity, rampTime: preset.ramp });
  return out;
}

/* ── The setup ── */
/**
 * The pilot's picks → the setup for loadMission(…, setup).
 *   picks: { weather: preset id, failure: preset id, timing: { random } | { fixedT }, crew: crew/role id }
 *   opts:  { hasCarbHeat } (offers carb icing), rand (tests)
 */
export function buildSetup(m, picks, { hasCarbHeat = false, rand = Math.random } = {}) {
  const wx     = WEATHER_PRESETS.find(p => p.id === picks.weather);
  const fail   = failurePresets({ hasCarbHeat }).find(p => p.id === picks.failure);
  const member = crewPresets(m).find(p => p.id === picks.crew);
  const T      = fail && fail.id !== 'CLEAN' ? failureTime(picks.timing ?? { random: true }, rand) : 0;
  return {
    weather:  wx?.override ?? null,
    failures: failureEntries(fail, T),
    crew: picks.crew == null ? null : {   // no crew choice → the mission's own role stays
      role:          member?.role ?? picks.crew,
      pilotId:       picks.crew,
      pilotName:     member?.name     ?? null,
      pilotCallsign: member?.callsign ?? null,
    },
  };
}
