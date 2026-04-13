/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/mission.js
   Loads aircraft + mission JSON. Sets initial state.
   Fetches live METAR if mission.weather.source === 'live'.
   ═══════════════════════════════════════════════════════════════ */

import { setState }      from './state.js';
import { resetFailures }  from './failures.js';
import { resetFuel }      from './fuel.js';
import { resetBattery }   from './battery.js';
import { setCrewLang }    from './crew.js';

/**
 * loadMission(missionPath, aircraftPath)
 * Returns the loaded { mission, aircraft } objects after patching state.
 */
export async function loadMission(missionPath, aircraftPath) {
  const _fetch = (p) => fetch(p, { cache: 'no-cache' }).then(r => r.json());
  const [mission, aircraft] = await Promise.all([
    typeof missionPath  === 'object' ? missionPath  : _fetch(missionPath),
    typeof aircraftPath === 'object' ? aircraftPath : _fetch(aircraftPath),
  ]);

  /* Apply initial state from mission */
  const { alt, spd, hdg, pitch, roll, lat, lon } = mission.initialState;

  /* Weight-on-wheels: true when starting at or below departure/arrival elevation */
  const groundElev = mission.departure?.elevation ?? mission.arrival?.elevation ?? 0;
  const startOnGround = spd === 0 && alt <= groundElev + 2;
  const startAirborne = !startOnGround && spd > 0;

  /* Oil temperature: cold on ground, warm if already airborne (engine running since before mission start) */
  const startOilTempC = startAirborne ? 75 : 15;

  /* Engine state: v12 starts 'off' on ground (manual startup sequence via E key).
     All other manualControl aircraft start 'running' — no startup procedure. */
  const isV12 = ['v12-supercharged', 'radial-2000hp'].includes(aircraft.sound?.engineType);
  const startEngineState = (startOnGround && isV12) ? 'off' : 'running';

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
    engineState: startEngineState,
    oilTempC:    startOilTempC,
    ilsLoc: 1.2, ilsLocT: 1.2,
    ilsGs: -0.8, ilsGsT: -0.8,
    time:  0,
    warpFactor: 1,
    metar: null,
    crashed: false,
    crashReason: null,
  });

  /* Live METAR */
  if (mission.weather?.source === 'live' && mission.weather.icao) {
    fetchMetar(mission.weather.icao).catch(() => {});
  }

  /* Rocket-specific state init */
  if (aircraft.vehicleType === 'rocket') {
    setState({
      rocketMass:   aircraft.performance?.massWet ?? 28000,
      rocketStage:  1,
      rocketCoast:  false,
      rocketCoastT: 0,
      rocketSECO:   false,
      rocketG:            0,
      rocketDynQ:         0,
      rocketActiveEngines: aircraft.performance?.stages?.[0]?.engineCount ?? 1,
      rocketFailedEngines: [],
      rocketCECO:          false,
      rocketCECOEngines:   [],
      booster:             null,
      dragonSep:           false,
      s2Vec:               null,
      s2Lat:               0,
      s2Lon:               0,
      s2Alt:               0,
      dragonDeorbit:       false,
      dragonReentry:       false,
      dragonBlackout:      false,
      dragonSignal:        false,
      dragonDrogue:        false,
      dragonMains:         false,
      dragonSplashdown:    false,
    });
  }

  resetFailures();
  resetFuel();
  resetBattery();
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
