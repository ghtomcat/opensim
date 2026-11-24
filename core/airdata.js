/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/airdata.js
   The air and air data from the sim's state — the one atmosphere the physics, the engines, the cooling and the
   instruments read: the outside air temperature, the density, the speed of sound; and from them the true
   airspeed, Mach and the height above the ground. physics.js integrates TAS and shows IAS (S.spd).

   The day's air: the weather's surface temperature (the mission's manual weather, else S.metar — the live METAR
   or the mission's recorded fallback) at its station's elevation, as a deviation from ISA held at every
   altitude (ISA + dev: −1.98 °C per 1,000 ft, −56.5 °C + dev above 11 km); the pressure from the QNH. No
   weather → ISA exactly (15 °C, 1013.25 hPa), so a test without weather sees the standard atmosphere.

     oatC(altFt)           the outside air temperature, °C
     isaDevC()             the day's deviation from ISA, °C
     densityRatio(altFt)   ρ/ρ₀ — pressure ratio ÷ temperature ratio

     tasKt(iasKt, altFt)   the true airspeed
     machOf(iasKt, altFt)  Mach — TAS ÷ the speed of sound at that altitude (ISA: 15 °C at sea level,
                           −6.5 °C per km, −56.5 °C from 11 km)
     iasOfMach(mach, altFt) the inverse — the indicated airspeed of a Mach at that altitude (a cruise Mach as the
                           A/THR's speed target, core/managed-speed.js)
     iasOfTas(tasKt, altFt) tasKt's inverse — the indicated airspeed of a true airspeed (a tracked flight's ground
                           speed taken as its true airspeed, no wind — core/liveflight.js)
     heightAboveGroundFt() S.alt over the terrain under the aircraft (S.terrainElevFt), or over the mission's field
                           where the terrain is not known — what a radar altimeter measures
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

const KT_PER_MS = 1 / 0.5144;

const STD_HPA = 1013.25;
const _isaC = (altFt) => { const h = altFt * 0.3048; return h < 11000 ? 15 - 0.0065 * h : -56.5; };   // −1.98 °C per 1,000 ft

/* The weather's surface report: temperature, QNH and the station's elevation (ft) — the weather's own airport
   among the departure / arrival, else the departure's, else the arrival's. */
function _surface(s) {
  const w = s?.mission?.weather, m = s?.metar;
  const tempC = w?.manual?.temp ?? m?.temp ?? w?.fallback?.temp ?? null;
  const qnh   = w?.manual?.altim ?? m?.altim ?? w?.fallback?.altim ?? null;
  const dep = s?.mission?.departure, arr = s?.mission?.arrival, st = w?.icao;
  const stationFt = (st && dep?.icao === st ? dep.elevation : st && arr?.icao === st ? arr.elevation : null)
                 ?? dep?.elevation ?? arr?.elevation ?? 0;
  return { tempC, qnh, stationFt };
}

/** The day's deviation from ISA, °C (0 without weather). `fallbackC`: a surface temperature to assume when the
 *  weather has none (an aircraft's own `cooling.ambient`). */
export function isaDevC(s = S, fallbackC = null) {
  const { tempC, stationFt } = _surface(s);
  const t = tempC ?? fallbackC;
  return t == null ? 0 : t - _isaC(stationFt);
}

/** The outside air temperature at altFt, °C */
export const oatC = (altFt, s = S, fallbackC = null) => _isaC(altFt) + isaDevC(s, fallbackC);

/** ρ/ρ₀ at altFt: the ISA pressure ratio scaled by the QNH, over the temperature ratio (ISA + the day's deviation).
 *  ISA exactly without weather — (1 − 2.2558e-5·h)^4.2559, as before (the troposphere's formula, also above 11 km). */
export function densityRatio(altFt, s = S) {
  const base = Math.max(0, 1 - 2.2558e-5 * altFt * 0.3048);
  const { qnh } = _surface(s), dev = isaDevC(s);
  const tIsaK = 288.15 * base;
  return Math.pow(base, 4.2559) * ((qnh ?? STD_HPA) / STD_HPA) * (tIsaK > 0 ? tIsaK / (tIsaK + dev) : 1);
}

/** The true airspeed, kt, from the indicated airspeed at altFt */
export const tasKt = (iasKt, altFt) => iasKt / Math.sqrt(Math.max(0.05, densityRatio(altFt)));

/** The speed of sound at altFt, kt — the day's temperature (ISA + dev; isothermal above 11 km) */
export function soundSpeedKt(altFt, s = S) {
  const h = altFt * 0.3048, T = (h < 11000 ? 288.15 - 0.0065 * h : 216.65) + isaDevC(s);
  return Math.sqrt(1.4 * 287.05 * T) * KT_PER_MS;
}

/** Mach from the indicated airspeed at altFt */
export const machOf = (iasKt, altFt) => tasKt(iasKt, altFt) / soundSpeedKt(altFt);

/** The indicated airspeed, kt, of a true airspeed at altFt — tasKt's inverse */
export const iasOfTas = (tasKt, altFt) => tasKt * Math.sqrt(Math.max(0.05, densityRatio(altFt)));

/** The indicated airspeed, kt, of a Mach at altFt — machOf's inverse */
export const iasOfMach = (mach, altFt) => mach * soundSpeedKt(altFt) * Math.sqrt(Math.max(0.05, densityRatio(altFt)));

/** The height above the ground, ft — over the terrain (S.terrainElevFt), else over the mission's departure field */
export function heightAboveGroundFt() {
  const ground = S.terrainElevFt ?? S.mission?.departure?.elevation ?? 0;
  return Math.max(0, (S.alt ?? 0) - ground);
}
