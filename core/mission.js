/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/mission.js
   Loads aircraft + mission JSON. Sets initial state.
   Fetches live METAR if mission.weather.source === 'live'.
   ═══════════════════════════════════════════════════════════════ */

import { setState }    from './state.js';
import { resetFailures } from './failures.js';
import { setCrewLang }   from './crew.js';

/**
 * loadMission(missionPath, aircraftPath)
 * Returns the loaded { mission, aircraft } objects after patching state.
 */
export async function loadMission(missionPath, aircraftPath) {
  const [mission, aircraft] = await Promise.all([
    typeof missionPath  === 'object' ? missionPath  : fetch(missionPath).then(r => r.json()),
    typeof aircraftPath === 'object' ? aircraftPath : fetch(aircraftPath).then(r => r.json()),
  ]);

  /* Apply initial state from mission */
  const { alt, spd, hdg, pitch, roll, lat, lon } = mission.initialState;

  /* Weight-on-wheels: true when starting at or below departure/arrival elevation */
  const groundElev = mission.departure?.elevation ?? mission.arrival?.elevation ?? 0;
  const startOnGround = spd === 0 && alt <= groundElev + 2;

  setState({
    aircraft,
    mission,
    alt,   altT:  alt,
    spd,   spdT:  spd,
    hdg,   hdgT:  hdg,
    pitch, pitchT: pitch,
    roll,  rollT:  roll,
    rollRate: 0, pitchRate: 0,
    vs:    0,
    lat:   lat ?? 48.13,
    lon:   lon ?? 8.55,
    flaps: 0, prevFlaps: 0,
    gear:  aircraft.fixedGear ? true : startOnGround,
    prevGear: aircraft.fixedGear ? true : startOnGround,
    ap:    !aircraft.manualControl,
    athr:  !aircraft.manualControl,
    wow:   startOnGround,
    trim:  0,
    enginePower: 1.0,
    ilsLoc: 1.2, ilsLocT: 1.2,
    ilsGs: -0.8, ilsGsT: -0.8,
    time:  0,
    metar: null,
  });

  /* Live METAR */
  if (mission.weather?.source === 'live' && mission.weather.icao) {
    fetchMetar(mission.weather.icao).catch(() => {});
  }

  resetFailures();
  setCrewLang(aircraft.crewLang ?? null);
  return { mission, aircraft };
}

export async function fetchMetar(icao) {
  /* Try direct first, fall back to CORS proxy for static hosting (e.g. GitHub Pages) */
  const direct = `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`;
  const proxy  = `https://corsproxy.io/?${encodeURIComponent(direct)}`;

  for (const url of [direct, proxy]) {
    try {
      const res  = await fetch(url);
      const data = await res.json();
      if (data && data[0]) { setState({ metar: data[0] }); return; }
    } catch { /* try next */ }
  }
}
