/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/mission.js
   Loads aircraft + mission JSON. Sets initial state.
   Fetches live METAR if mission.weather.source === 'live'.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }   from './state.js';
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

  /* Engine state: piston/electric ground starts begin 'off' (manual startup via E key).
     Turbofan ground starts also begin 'off' — crew must run through start sequence.
     All airborne starts (cruise/approach missions) begin 'running'. */
  const hasColdStart =
    ['v12-supercharged', 'radial-2000hp', 'lycoming-o360', 'electric'].includes(aircraft.sound?.engineType) ||
    (aircraft.engine?.type === 'turbofan' && startOnGround);
  const startEngineState = (startOnGround && hasColdStart) ? 'off' : 'running';

  /* Initial N1 for turbofan — set to match cruise throttle when airborne, 0 when off */
  const initN1 = (() => {
    if (aircraft.engine?.type !== 'turbofan') return 0;
    if (startEngineState === 'off') return 0;
    const IDLE_N1 = aircraft.engine?.idleN1 ?? 22;
    const spdNorm = Math.min(1, Math.max(0, spd / (aircraft.envelope?.maxSpd ?? 340)));
    return IDLE_N1 + (100 - IDLE_N1) * spdNorm;
  })();

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
    gear:     aircraft.fixedGear ? true : startOnGround,
    prevGear: aircraft.fixedGear ? true : startOnGround,
    gearAnim: aircraft.fixedGear ? 1 : (startOnGround ? 1 : 0),
    ap:    !aircraft.manualControl,
    athr:  !aircraft.manualControl,
    wow:   startOnGround,
    trim:  0,
    enginePower: startEngineState === 'off' ? 0 : 1.0,
    engineState: startEngineState,
    n1:          initN1,
    oilTempC:    startOilTempC,
    ilsLoc: 1.2, ilsLocT: 1.2,
    ilsGs: -0.8, ilsGsT: -0.8,
    time:  0,
    paused: false,
    warpFactor: 1,
    metar: null,
    crashed: false,
    crashReason: null,
    comPanelVisible: false,
  });

  /* G1000 (C172) cockpit switches — cold and dark */
  if (aircraft.panel === 'g1000') {
    setState({
      magnetos:   'OFF',
      masterBat:  false,
      masterAlt:  false,
      avionicsOn: false,
      fuelPump:   false,
      lights:     { nav: false, beacon: false, strobe: false, landing: false },
    });
  } else if (aircraft.panel === 'airbus' || aircraft.panel === 'e190') {
    setState({ lights: { nav: true, beacon: true, strobe: true, landing: false } });
  }

  /* Live METAR */
  if (mission.weather?.source === 'live' && mission.weather.icao) {
    fetchMetar(mission.weather.icao).catch(() => {});
  }

  /* Rocket-specific state init */
  if (aircraft.vehicleType === 'rocket') {
    setState({
      rocketMass:          aircraft.performance?.massWet ?? 28000,
      rocketStage:         1,
      rocketCoast:         false,
      rocketCoastT:        0,
      rocketStageIgnitionT: aircraft.ignitionTime ?? 0,
      rocketSECO:   false,
      rocketG:            0,
      rocketDynQ:         0,
      rocketActiveEngines: aircraft.performance?.stages?.[0]?.engineCount ?? 1,
      rocketFailedEngines: [],
      rocketCECO:          false,
      rocketCECOEngines:   [],
      rocketRoll:          0,
      rocketTLI:           false,
      rocketTLIBurnEnd:    0,
      rocketMCC1:          false,
      mcc1DvX:             0,
      mcc1DvY:             0,
      mcc1DvMag:           0,
      rocketLOI:           false,
      loiActualT:          0,
      rocketTEI:           false,
      sivbSep:             false,
      lesJettisoned:       false,
      cislunarTrail:       [],
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

  /* Reset cockpit switches — all off at mission start */
  S.switches.master   = false;
  S.switches.battEn   = false;
  S.switches.pwrEn    = false;
  S.switches.avionics = false;
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
