/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/yaw.js
   The yaw axis: sideslip β and the nose's yaw away from a
   coordinated turn, from the moments about the CG — thrust
   asymmetry, a dead engine's windmilling drag, the vertical tail
   (weathercock stability, rudder, damping) and the fuselage.

   Only for aircraft whose vertical tail is measured (core/airframe.js);
   for the others yawModel() is null and the physics stays as it was:
   the nose on the flight path, turns coordinated by bank.

   Yaw only in this version: no roll from sideslip, no Dutch roll.
   The fin stalls: its angle (sideslip + the rudder's share) is linear up
   to FIN_STALL_DEG, then the side force falls away. Below the speed where
   the fin, stalled, can't hold the engine any more, there is no balance
   and the yaw diverges — V_MC is where that starts.
   The damping acts on the yaw away from the coordinated turn, so a
   normal turn stays coordinated (as with the yaw damper on).

   On the ground (groundYawStep) the tyres hold the nose to the rate
   the nosewheel steers — tiller and pedals — up to what the nosewheel
   can take sideways before it skids (side friction × its load × the
   wheelbase). Beyond that the aircraft pivots on the main gear; the
   path follows the nose (β = 0 on the wheels; no crosswind yet).

   Conventions: β > 0 = the air from the right (the nose left of the
   flight path); yaw rate and N > 0 = nose right; y > 0 = right of the
   centreline; rudder > 0 = right pedal (nose right). Units SI, angles
   in rad inside this module.
   ═══════════════════════════════════════════════════════════════ */

import { nominalCg, engineY, vstab, DEFAULT_NOSE_GEAR_SHARE } from './airframe.js';

/* Estimates — each a published method or a typical value, none tuned to a result. */
const FIN_AR_EFFECT   = 1.55;   // fuselage + tailplane as end plates: effective aspect ratio of a fin (DATCOM)
const FIN_STALL_DEG   = 25;     // the fin's stall angle (sideslip + rudder): low aspect ratio, swept — typically 25–30°
const FIN_POST_STALL  = 0.4;    // side force lost past the stall, reached 10° beyond it (a gentle, low-AR stall)
const RUDDER_LARGE_K  = 0.75;   // a plain flap loses effectiveness at large deflection (DATCOM, ~25°)
const FUSELAGE_KN     = 0.0018; // DATCOM 5.2.3.1 body yaw factor K_N·K_Rl, typical airliner value
const FUSELAGE_SIDE_K = 0.80;   // body side area ≈ 0.8 × diameter × length
const RZ_BAR          = 0.46;   // Roskam radius of gyration about z; Izz = m·(R̄z·(b+L)/4)² — the 747's ≈ 15 m
const WINDMILL_CD     = 0.10;   // a dead turbofan's windmilling + spillage drag on the nacelle's frontal area
const RUDDER_MAX_DEG  = 25;     // when the aircraft gives none
const MU_SIDE         = 0.5;    // the nosewheel's side friction on a dry runway, before it skids — when the aircraft gives none
const PEDAL_STEER_DEG = 7;      // nosewheel travel from the rudder pedals (the tiller does the rest) — when the aircraft gives none
const TYRE_TAU        = 0.2;    // s — how fast the tyres take out a yaw rate they can hold
const RUDDER_LIMIT_KT = 160;    // the rudder limiter: full travel below this IAS, then ∝ 1/V² (the moment held) — when the aircraft gives none

const _cache = new WeakMap();

/** The aircraft's yaw coefficients, or null when its vertical tail isn't measured. */
export function yawModel(ac) {
  if (!ac || typeof ac !== 'object') return null;
  if (_cache.has(ac)) return _cache.get(ac);
  const m = _build(ac);
  _cache.set(ac, m);
  return m;
}

function _build(ac) {
  const v = vstab(ac), cg = nominalCg(ac), d = ac.dimensions ?? {};
  if (!v || v.arm === null || !v.rudder) return null;
  const L = (d.length ?? 0) / 1000, b = (d.wingSpan ?? 0) / 1000, dia = (d.fuselageDiameter ?? 0) / 1000;
  if (!(L > 0 && b > 0 && dia > 0)) return null;

  /* fin lift slope (Helmbold / DATCOM, low Mach), from the half-chord sweep */
  const A = FIN_AR_EFFECT * v.aspectRatio;
  const tanHalf = ((d.noseTipToVstabTipLE / 1000 + v.tipChord / 2) - (d.noseTipToVstabRootLE / 1000 + v.rootChord / 2)) / v.height;
  const finSlope = 2 * Math.PI * A / (2 + Math.sqrt(A * A * (1 + tanHalf * tanHalf) + 4));   // per rad

  /* rudder effectiveness τ from its chord share (thin-aerofoil flap theory), over its span */
  const cf = v.rudder.areaRatio / v.rudder.spanRatio;                                       // mean chord share
  const th = Math.acos(2 * cf - 1);
  const tau = (1 - (th - Math.sin(th)) / Math.PI) * RUDDER_LARGE_K * v.rudder.spanRatio;

  const finK = v.area * finSlope;                       // fin side force per rad per Pa
  const sideArea = FUSELAGE_SIDE_K * dia * L;
  const mass = ac.performance?.mass ?? 0;
  const ys = engineY(ac);
  const cowl = (d.fanCowlDiameter ?? 0) / 1000;

  return {
    arm: v.arm,                                         // CG → the fin's aerodynamic centre, m
    finK, tau,
    fuselageN: 57.3 * FUSELAGE_KN * sideArea * L,       // destabilising N per rad per Pa
    fuselageY: 2 * Math.PI / 4 * dia * dia,             // slender-body side force per rad per Pa
    rudderMax: (ac.handling?.rudderMaxDeg ?? RUDDER_MAX_DEG) * Math.PI / 180,
    rudderLimitQ: 0.5 * 1.225 * ((ac.handling?.rudderLimitKt ?? RUDDER_LIMIT_KT) * 0.5144) ** 2,   // Pa
    Izz: ac.inertia?.Izz ?? mass * (RZ_BAR * (b + L) / 4) ** 2,
    engineY: ys,                                        // null → no thrust moment (not measured)
    windmillArea: WINDMILL_CD * Math.PI / 4 * cowl * cowl,
    cg,
    wheelbase: (d.noseTipToMainGear - d.noseTipToNoseGear) / 1000,
    noseShare: ac.balance?.noseGearLoadShare ?? DEFAULT_NOSE_GEAR_SHARE,
    muSide: ac.performance?.muSide ?? MU_SIDE,
    pedalSteer: (ac.handling?.pedalSteerDeg ?? PEDAL_STEER_DEG) * Math.PI / 180,
    tac: ac.handling?.tac ?? null,                      // thrust asymmetry compensation (the 777) — tacRudder()
  };
}

/** The fin's effective angle (rad) after the stall: linear up to the stall angle, then the
    side force falls by FIN_POST_STALL over the next 10° and stays there. */
export function finAngle(a) {
  const st = FIN_STALL_DEG * Math.PI / 180, m = Math.abs(a);
  if (m <= st) return a;
  const k = Math.min(1, (m - st) / (10 * Math.PI / 180));
  return Math.sign(a) * st * (1 - FIN_POST_STALL * k);
}

/** Rudder travel (rad) at this dynamic pressure: full below the limit speed, then the moment held. */
export function rudderTravel(model, q) {
  return model.rudderMax * Math.min(1, model.rudderLimitQ / Math.max(1, q));
}

/** Yaw moment (N·m) and side force (N) for the state and inputs. */
export function yawForces(model, { beta, yawDev, q, tas, thrust = [], dead = [], rudder = 0 }) {
  const dr = Math.max(-1, Math.min(1, rudder)) * rudderTravel(model, q);
  const finY = -q * model.finK * finAngle(beta + model.tau * dr);  // the fin's side force (air from the right → left), stalls
  let N = -model.arm * finY                                         // the fin: weathercock + rudder
        - q * model.fuselageN * beta                                // the fuselage: destabilising
        - q * model.finK * model.arm * model.arm / Math.max(10, tas) * yawDev;   // the fin's damping
  if (model.engineY) {
    for (let i = 0; i < model.engineY.length; i++) {
      N -= (thrust[i] ?? 0) * model.engineY[i];                     // thrust right of the CG → nose left
      if (dead[i]) N += q * model.windmillArea * model.engineY[i];  // drag right of the CG → nose right
    }
  }
  const Y = finY - q * model.fuselageY * beta;
  return { N, Y };
}

/** One step: β (rad) and the yaw rate away from the coordinated turn (rad/s). */
export function yawStep(model, s, dt, mass) {
  const { N, Y } = yawForces(model, s);
  const yawDev = s.yawDev + N / model.Izz * dt;
  const beta   = s.beta + (Y / (mass * Math.max(10, s.tas)) - yawDev) * dt;   // the path bends with Y, the nose with r
  return { beta, yawDev, N, Y, latAccel: Y / mass };
}

/** The windmilling drag of the dead engines (N), for the longitudinal balance. */
export function windmillDrag(model, q, dead = []) {
  return model?.engineY ? q * model.windmillArea * dead.filter(Boolean).length : 0;
}

/** V_MC estimate (dynamic pressure, Pa): full rudder against one engine's thrust, β = 0 —
    with full travel (V_MC lies below the rudder limiter's speed; null if it doesn't). */
export function vmcQ(model, thrustOneEngine) {
  if (!model?.engineY) return null;
  const y = Math.max(...model.engineY.map(Math.abs));
  /* full rudder: N = q·finK·τ·δmax·arm; the engine: T·y; the dead engine's drag q·A·y */
  const q = thrustOneEngine * y / (model.finK * model.tau * model.rudderMax * model.arm - model.windmillArea * y);
  return q > 0 && q <= model.rudderLimitQ ? q : null;
}

/** The yaw rate (rad/s) the pedals steer through the nosewheel at ground speed v (m/s) — the
    geometry (v·tan δ / wheelbase), capped at what the tyres' side grip can turn the path at
    (μ·weight on the wheels / (m·v)) when the mass and that weight are given. */
export function pedalYawRate(model, rudder, v, mass, weightOnWheels) {
  const geo = v * Math.tan(Math.max(-1, Math.min(1, rudder)) * model.pedalSteer) / model.wheelbase;
  if (!(mass > 0) || weightOnWheels === undefined) return geo;
  const grip = model.muSide * Math.max(0, weightOnWheels) / (mass * Math.max(1, v));
  return Math.max(-grip, Math.min(grip, geo));
}

/** The nosewheel's yaw-moment limit (N·m) with the weight not yet carried by the wing (N). */
export function tyreLimit(model, weightOnWheels) {
  return model.muSide * model.noseShare * Math.max(0, weightOnWheels) * model.wheelbase;
}

/** One step on the wheels: the yaw rate beyond the tiller's (rad/s). The tyres cancel the aero
    and thrust moments and steer it to the pedals' rate (s.pedalRate), up to their limit. */
export function groundYawStep(model, s, dt) {
  const { N } = yawForces(model, { ...s, beta: 0 });
  const cap = tyreLimit(model, s.weightOnWheels);
  const want = model.Izz * ((s.pedalRate ?? 0) - s.yawDev) / TYRE_TAU - N;
  const Nt = Math.max(-cap, Math.min(cap, want));
  return { yawDev: s.yawDev + (N + Nt) / model.Izz * dt, N, skidding: Nt !== want };
}

/** The slip indicator's deflection, −1 … +1 (+ = the ball / index to the right), from the lateral
    acceleration (m/s²): the ball moves opposite to it — "step on the ball". Full deflection at
    0.15 g (a display scale, assumed). Every slip indicator reads this. */
export const BALL_FULL_G = 0.15;
export function ballDeflection(latAccel = 0) {
  return Math.max(-1, Math.min(1, (0 - latAccel) / (BALL_FULL_G * 9.81)));   // 0 − x: no −0
}

/** Thrust asymmetry compensation (TAC, the 777): the rudder share (−1 … +1) that cancels the
    engines' thrust moment, once their thrust differs by more than tac.thresholdFrac of one
    engine's rated thrust, above tac.minKt (also on the takeoff roll), not with the reversers out
    and not switched off. From the engines' thrust, not the yaw — a dead engine's windmilling
    drag stays for the pilot. The physics lags it by tac.lagS (the cue to the pilot).
    Bartley, "Boeing B-777: Fly-By-Wire Flight Controls", The Avionics Handbook, CRC Press 2001. */
export function tacRudder(model, { thrust = [], rated, q, ias, reverser = false, off = false }) {
  const t = model?.tac;
  if (!t || off || reverser || !model.engineY || !(ias >= (t.minKt ?? 80)) || !(rated > 0)) return 0;
  if (Math.max(...thrust) - Math.min(...thrust) <= (t.thresholdFrac ?? 0.1) * rated) return 0;
  let Nt = 0;
  for (let i = 0; i < model.engineY.length; i++) Nt -= (thrust[i] ?? 0) * model.engineY[i];
  const perUnit = q * model.finK * model.tau * rudderTravel(model, q) * model.arm;   // full rudder's moment
  return perUnit > 0 ? Math.max(-1, Math.min(1, -Nt / perUnit)) : 0;
}
