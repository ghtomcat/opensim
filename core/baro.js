/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/baro.js
   Barometric altimeter model. One source for the QNH/STD subscale and
   the true ↔ indicated altitude conversion.

   The sim integrates TRUE MSL altitude in S.alt (physics, terrain, GPWS,
   radio altitude all stay true). The altimeter/PFD and the autopilot
   target work in INDICATED altitude, which depends on the subscale the
   pilot has set vs the actual field pressure:

       indicatedAlt = trueAlt + (subscale_set − QNH_actual) × 27.3 ft/hPa

   Set the subscale above the actual pressure → the altimeter over-reads
   (indicated higher than true) — "from high to low, look out below".
   ═══════════════════════════════════════════════════════════════ */

import { S } from './state.js';

export const BARO_FT_PER_HPA = 27.3;     // ISA near MSL: 1 hPa ≈ 27.3 ft
export const STD_HPA         = 1013.25;  // standard pressure setting

/* Actual field / sea-level pressure (hPa) — live METAR first, then mission weather. */
export function qnhField() {
  return S.mission?.weather?.manual?.altim
      ?? S.metar?.altim
      ?? S.mission?.weather?.fallback?.altim
      ?? 1013;
}

/* The altimeter subscale the pilot has set (STD = 1013, else the QNH knob value). */
export function baroSubscale() {
  return S.baroStd ? STD_HPA : (S.baroSet ?? qnhField());
}

/* Altimeter error (ft): subscale above actual → reads high (indicated > true). */
export function baroError() {
  return (baroSubscale() - qnhField()) * BARO_FT_PER_HPA;
}

/* Indicated (baro) altitude from a true MSL altitude — what the altimeter shows. */
export function indicatedAlt(trueAlt) {
  return trueAlt + baroError();
}
