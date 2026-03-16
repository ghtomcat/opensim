/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/mission.js
   Loads aircraft + mission JSON. Sets initial state.
   Fetches live METAR if mission.weather.source === 'live'.
   ═══════════════════════════════════════════════════════════════ */

import { setState } from './state.js';

/**
 * loadMission(missionPath, aircraftPath)
 * Returns the loaded { mission, aircraft } objects after patching state.
 */
export async function loadMission(missionPath, aircraftPath) {
  const [mission, aircraft] = await Promise.all([
    fetch(missionPath).then(r => r.json()),
    fetch(aircraftPath).then(r => r.json()),
  ]);

  /* Apply initial state from mission */
  const { alt, spd, hdg, pitch, roll } = mission.initialState;

  setState({
    aircraft,
    mission,
    alt,   altT:  alt,
    spd,   spdT:  spd,
    hdg,   hdgT:  hdg,
    pitch, pitchT: pitch,
    roll,  rollT:  roll,
    vs:    0,
    flaps: 0, prevFlaps: 0,
    gear:  false, prevGear: false,
    ap:    true,
    athr:  true,
    ilsLoc: 1.2, ilsLocT: 1.2,
    ilsGs: -0.8, ilsGsT: -0.8,
    time:  0,
    metar: null,
  });

  /* Live METAR */
  if (mission.weather?.source === 'live' && mission.weather.icao) {
    fetchMetar(mission.weather.icao).catch(() => {});
  }

  return { mission, aircraft };
}

export async function fetchMetar(icao) {
  const url = `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data && data[0]) {
    setState({ metar: data[0] });
  }
}
