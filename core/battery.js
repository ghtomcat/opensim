/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/battery.js
   Electric aircraft battery system.

   Aircraft JSON:
     "battery": {
       "capacityKwh": 21.8,   — usable capacity
       "powerDrawKw":  25     — draw at full power (cruise)
     }

   State:
     batteryCharge  — 0–100 %
   Warnings (index.html updatePanel):
     BATT_LOW  amber ≤ 20%
     BATT_CRIT red   ≤ 10%
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';

export function initBattery() {
  if (!S.aircraft?.battery) {
    setState({ batteryCharge: null });
    return;
  }
  setState({ batteryCharge: 100 });
}

export function resetBattery() {
  initBattery();
}

export function tickBattery(dt) {
  const bat = S.aircraft?.battery;
  if (!bat || S.batteryCharge === null) return;
  if (S.crashed) return;

  const power = S.enginePower ?? 0;

  /* Drain — kW × enginePower fraction → % of capacity per second */
  if (power > 0.01) {
    const drainPct = (bat.powerDrawKw * power) / (bat.capacityKwh * 3600) * 100 * dt;
    const charge   = Math.max(0, S.batteryCharge - drainPct);
    setState({ batteryCharge: charge });

    /* Motor cuts when battery is flat — cannot recover */
    if (charge <= 0 && power > 0) {
      setState({ enginePower: 0 });
    }
  }

  /* Keep motor dead once battery is depleted */
  if ((S.batteryCharge ?? 0) <= 0 && power > 0) {
    setState({ enginePower: 0 });
  }
}
