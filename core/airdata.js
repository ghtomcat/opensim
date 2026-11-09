/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/airdata.js
   Air data from the sim's state, for the instruments that show more than the indicated airspeed and altitude:
   true airspeed, Mach and the height above the ground. The same ISA conversions as core/physics.js
   (density ratio from the altitude; IAS → TAS by √(ρ₀/ρ)) — physics.js integrates TAS and shows IAS (S.spd).

     tasKt(iasKt, altFt)   the true airspeed
     machOf(iasKt, altFt)  Mach — TAS ÷ the speed of sound at that altitude (ISA: 15 °C at sea level,
                           −6.5 °C per km, −56.5 °C from 11 km)
     heightAboveGroundFt() S.alt over the terrain under the aircraft (S.terrainElevFt), or over the mission's field
                           where the terrain is not known — what a radar altimeter measures
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

const KT_PER_MS = 1 / 0.5144;

/** ρ/ρ₀ at altFt (ISA troposphere, as physics.js) */
export const densityRatio = (altFt) => Math.pow(Math.max(0, 1 - 2.2558e-5 * altFt * 0.3048), 4.2559);

/** The true airspeed, kt, from the indicated airspeed at altFt */
export const tasKt = (iasKt, altFt) => iasKt / Math.sqrt(Math.max(0.05, densityRatio(altFt)));

/** The speed of sound at altFt, kt (ISA temperature; isothermal above 11 km) */
export function soundSpeedKt(altFt) {
  const h = altFt * 0.3048, T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  return Math.sqrt(1.4 * 287.05 * T) * KT_PER_MS;
}

/** Mach from the indicated airspeed at altFt */
export const machOf = (iasKt, altFt) => tasKt(iasKt, altFt) / soundSpeedKt(altFt);

/** The height above the ground, ft — over the terrain (S.terrainElevFt), else over the mission's departure field */
export function heightAboveGroundFt() {
  const ground = S.terrainElevFt ?? S.mission?.departure?.elevation ?? 0;
  return Math.max(0, (S.alt ?? 0) - ground);
}
