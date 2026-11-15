/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/trim.js
   The trim: the angle of attack and the thrust that hold a speed in level flight — the same
   force model as core/physics.js, solved for the balance instead of integrated:

     lift = weight   CL = W / (q·S) = CL_0 + flap camber dCL_0 + CL_α·α         → α
     thrust = drag   share · T_max · ρ/ρ₀ · cos α = q·S·(CD_0 + flap dCD_0 + gear + cooling + k·CL²)
                     a turbofan's share is (N1/100)^1.8, a propeller's the lever × its power  → N1 / the lever

     trimAoADeg(ac, q, dCL0)   the angle of attack (°) for lift = weight at dynamic pressure q (Pa) with
                               the flaps' camber lift dCL0 — clamped 0 … 14° (the AP's pitch law reads it)
     levelTrim(ac, { iasKt, altFt, flaps, gear })
                               an airborne start's trim: { aoaDeg, pitchDeg, n1, lever } — level, so the pitch is the
                               angle of attack (α = θ − γ, γ = 0); n1 for a turbofan, lever its thrust lever's
                               position (or a propeller's)
     glideTrim(ac, { altFt, flaps, gear })
                               the best glide with the engine dead: { iasKt, gammaDeg, vsFpm, aoaDeg, pitchDeg } —
                               the lift coefficient of the best lift / drag, CL* = √(CD₀/k); lift = W·cos γ, drag =
                               W·sin|γ| (no thrust; the dead propeller's drag, the cooling flaps open)
   ═══════════════════════════════════════════════════════════════ */

import { densityRatio, tasKt } from './airdata.js';

const DEG = Math.PI / 180;
const KT  = 0.5144;   // m/s per kt

/** The angle of attack, °, for lift = weight at dynamic pressure q with the flaps' camber lift dCL0 — 0 … 14° */
export function trimAoADeg(ac, q, dCL0 = 0) {
  const p = ac?.performance ?? {};
  const clNeed = ((p.mass ?? 1157) * 9.81) / Math.max(1, q * (p.wingArea ?? 16.2));
  return Math.max(0, Math.min(14, (clNeed - (p.CL_0 ?? 0.2) - dCL0) / (p.CL_alpha ?? 5.0) / DEG));
}

/**
 * levelTrim(ac, { iasKt, altFt, flaps, gear }) → { aoaDeg, pitchDeg, n1, lever }
 * Level flight at the speed and altitude, the flap stage and gear as given (the start's configuration),
 * engines running at full power, no spoilers, no ground effect — physics.js's coefficients at a settled flap stage.
 */
export function levelTrim(ac, { iasKt, altFt, flaps = 0, gear = false }) {
  const p     = ac?.performance ?? {};
  const sigma = Math.max(0.05, densityRatio(altFt));
  const rho   = 1.225 * sigma;
  const v     = tasKt(iasKt, altFt) * KT;
  const q     = 0.5 * rho * v * v;
  const S     = p.wingArea ?? 16.2;
  const fs    = (ac?.flaps ?? [])[flaps] ?? {};

  const aoaDeg = trimAoADeg(ac, q, fs.dCL_0 ?? 0);
  const CL     = (p.CL_0 ?? 0.2) + (fs.dCL_0 ?? 0) + (p.CL_alpha ?? 5.0) * aoaDeg * DEG;
  const CD     = (p.CD_0 ?? 0.028) + (fs.dCD_0 ?? 0)
               + (gear && !ac.fixedGear ? (p.gearDrag ?? 0) : 0)
               + (p.coolFlapDrag ?? 0)                                  // the cooling flaps open (the load's coolFlap 1)
               + (p.inducedK ?? 0.055) * CL * CL;
  const share  = Math.max(0, Math.min(1, (q * S * CD) / ((p.thrustMax ?? 1800) * sigma * Math.cos(aoaDeg * DEG))));

  if (ac?.engine?.type === 'turbofan') {
    const idle = ac.engine.idleN1 ?? 22;
    const n1   = Math.max(idle, 100 * Math.pow(share, 1 / 1.8));
    return { aoaDeg, pitchDeg: aoaDeg, n1, lever: (n1 - idle) / (100 - idle) };   // manual thrust: N1 = idle + (100 − idle) · lever
  }
  return { aoaDeg, pitchDeg: aoaDeg, n1: null, lever: share };
}

/** The best glide with the engine dead, at altFt — { iasKt, gammaDeg, vsFpm, aoaDeg, pitchDeg }; pitch = α + γ */
export function glideTrim(ac, { altFt, flaps = 0, gear = false }) {
  const p   = ac?.performance ?? {};
  const fs  = (ac?.flaps ?? [])[flaps] ?? {};
  const CD0 = (p.CD_0 ?? 0.028) + (fs.dCD_0 ?? 0)
            + (gear && !ac.fixedGear ? (p.gearDrag ?? 0) : 0)
            + 0.022                                                   // the dead engine's propeller drag (physics.js: (1 − power) · 0.022)
            + (p.coolFlapDrag ?? 0);                                  // the cooling flaps open (the load's coolFlap 1)
  const k   = p.inducedK ?? 0.055;
  const CL  = Math.sqrt(CD0 / k), CD = CD0 + k * CL * CL;
  const gamma = -Math.atan(CD / CL);
  const sigma = Math.max(0.05, densityRatio(altFt));
  const q     = (p.mass ?? 1157) * 9.81 * Math.cos(gamma) / ((p.wingArea ?? 16.2) * CL);
  const tas   = Math.sqrt(2 * q / (1.225 * sigma));                       // m/s
  const aoaDeg = (CL - (p.CL_0 ?? 0.2) - (fs.dCL_0 ?? 0)) / (p.CL_alpha ?? 5.0) / DEG;
  return { iasKt: tas * Math.sqrt(sigma) / KT, gammaDeg: gamma / DEG, vsFpm: tas * Math.sin(gamma) * 196.85,
           aoaDeg, pitchDeg: aoaDeg + gamma / DEG };
}
