/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/physics.js
   Flight model. Reads aircraft envelope from S.aircraft.
   Writes back to S via setState(). Called each frame by loop.js.
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from './state.js';
import { bbEvent } from './blackbox.js';
import { capturePushback, pushbackPose } from './pushback.js';
import { computeAirbusFMA, computeBoeingFMA } from './fma.js';
import { lnavTargetHeading } from './lnav.js';
import { vnavTargetAlt } from './vnav.js';
import { activeDetent } from './thrust.js';
import { managedSpeed } from './managed-speed.js';
import { runwayThreshold } from './mission-start.js';

const _DEG = Math.PI / 180;
const _gcNm = (aLat, aLon, bLat, bLon) => {
  const p1 = aLat*_DEG, p2 = bLat*_DEG, dp = (bLat-aLat)*_DEG, dl = (bLon-aLon)*_DEG;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const _brgDeg = (aLat, aLon, bLat, bLon) =>
  ((Math.atan2((bLon-aLon)*Math.cos(aLat*_DEG), bLat-aLat) * 180/Math.PI) + 360) % 360;

let _athrSpdPrev = null;   // previous airspeed for the A/THR damping (speed-rate) term
let _apVsCmd     = null;   // rate-limited AP vertical-speed command — eases the descent in (no step → no VS spike)

const DEG = Math.PI / 180;

/* ── ILS approach tracking ── */
let _approachInit  = false;
let _dmeNm         = 0;        // estimated distance to threshold (nm)

const APPROACH_FLOOR = 4800;   // ft — activate ILS tracking below this

/* ── Crash thresholds ── */
const CRASH_VS_FPM   = -800;    // hard landing: touchdown VS below this → crash
const CRASH_OVERSPD  = 1.15;    // overspeed: above maxSpd × this factor → structural failure

export function tickPhysics(dt) {
  const ac = S.aircraft;
  if (!ac || S.paused || S.crashed) return;
  if (!ac.envelope) return;  // non-flight vehicles (robot-arm, robot-dog, etc.)

  const prevAlt = S.alt;

  /* Throttle-at-idle: turbofans key off the thrust lever (spdT is the A/THR selected speed,
     not the throttle); props/others key off spdT. Used for auto-brake / reverser / speedbrake. */
  const _idleThr = (ac.engine?.type === 'turbofan') ? (S.thrustLever ?? 0) < 0.05 : (S.spdT ?? 0) === 0;

  /* ── Speed limit from envelope profile ── */
  const profile = ac.envelope.spdProfile;
  let spdLimit = ac.envelope.maxSpd;
  for (const [altKey, maxSpd] of Object.entries(profile).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (S.alt >= Number(altKey)) { spdLimit = maxSpd; break; }
  }
  const spdTarget = Math.min(S.spdT, spdLimit);

  let newAlt, newSpd, newHdg, newPitch, newRoll, vs;
  let newWow = S.wow ?? false;
  let newTouchdownVS = S.touchdownVS ?? 0;

  /* ── Turbofan N1 dynamics ─────────────────────────────────────────────
     Runs for all turbofan aircraft before the main physics block.
     N1 ramps toward its target (idle floor + throttle contribution) with
     asymmetric time constants: 8 s spool-up, 15 s spool-down.
     State transitions driven here so thrust sees the correct N1 immediately.
     ────────────────────────────────────────────────────────────────────── */
  if (ac.engine?.type === 'turbofan' && !S.crashed) {
    const IDLE_N1 = ac.engine?.idleN1 ?? 22;
    const state   = S.engineState ?? 'off';
    const n1Now   = S.n1 ?? 0;
    const vmo     = ac.envelope.maxSpd ?? 340;

    /* A/THR — when the AP + autothrust are engaged in flight, N1 is driven by a speed loop
       (integrator on the speed error) to hold the target speed instead of being a thrust
       lever. One loop gives the right phase behaviour: level → holds, climb → spools up,
       descent → idles. Target = the FCU/managed speed, capped by 250 < FL100 and Vmo. */
    const athrActive = state === 'running' && S.ap && S.athr && !S.wow;
    let n1Target, athrI = S.athrN1 ?? n1Now;
    let athrMode = null, athrDetent = null;
    if (athrActive) {
      /* The thrust-lever detent is a flat-rated N1 ceiling — the A/THR may modulate up to
         it, no further. Pinned at the ceiling → THR <detent>; below it → SPEED/MACH. */
      const det     = activeDetent(ac, S.thrustLever ?? 0);
      const ceiling = det ? det.n1Limit : 100;
      athrDetent    = det?.label ?? null;
      const mgSpd   = S.spdManaged ? managedSpeed() : null;                      // managed → phase speed schedule
      const spdTgt  = (mgSpd != null) ? Math.min(mgSpd, vmo)                      // (already capped 250<FL100 inside)
                                      : Math.min(S.spdT ?? vmo, S.alt < 10000 ? 250 : 1e4, vmo);  // selected FCU speed
      const spdErr  = spdTgt - (S.spd ?? 0);
      const spdRate = _athrSpdPrev != null ? ((S.spd ?? 0) - _athrSpdPrev) / dt : 0;    // kt/s — damps overshoot
      athrI    = Math.max(IDLE_N1, Math.min(ceiling, athrI + spdErr * 0.10 * dt));      // integral (anti-windup at ceiling)
      const speedN1 = Math.max(IDLE_N1, Math.min(100, athrI + spdErr * 1.0 - spdRate * 3.5)); // + proportional − derivative
      n1Target = Math.min(speedN1, ceiling);                                            // detent caps the command
      athrMode = (speedN1 >= ceiling - 0.5) ? 'THR'                                     // demand pinned at the limit
               : (S.alt > 28000 ? 'MACH' : 'SPEED');                                    // modulating to hold speed
    } else {
      /* A/THR off → manual thrust: N1 follows the thrust lever, not the FCU selected speed
         (turning the SPD knob no longer changes thrust). Falls back to spdT for old state. */
      const lever = S.thrustLever ?? Math.min(1, Math.max(0, (S.spdT ?? 0) / vmo));
      n1Target = (state === 'running') ? IDLE_N1 + (100 - IDLE_N1) * lever
               : (state === 'starting') ? IDLE_N1
               : 0;   // 'off' or 'shutdown'
    }
    _athrSpdPrev = athrActive ? (S.spd ?? 0) : null;

    const tau  = (state === 'starting') ? 25 : (n1Target > n1Now ? 8 : 15);
    const newN1 = n1Now + (n1Target - n1Now) * (1 - Math.exp(-dt / tau));

    const n1Up = { n1: Math.max(0, Math.min(100, newN1)),
                   athrN1: athrActive ? athrI : newN1,      // track the A/THR integral; sync to N1 when off
                   athrMode, athrDetent };                  // thrust mode for the FMA (null when A/THR off)
    if (state === 'starting' && newN1 >= IDLE_N1 * 0.95) n1Up.engineState = 'running';
    if (state === 'shutdown' && newN1 < 0.5) n1Up.engineState = 'off';
    setState(n1Up);
  }

  /* ── ILS approach — real LOC/GS deviations from the runway threshold, with capture. Computed
     once (outside the flight branches) so both the AP coupling and the PFD needles read it.
     Once captured the AP couples: bank tracks the localizer, pitch flies the glideslope. ── */
  let locCap = S.locCaptured ?? false, gsCap = S.gsCaptured ?? false;
  let ilsLocNow = S.ilsLoc, ilsGsNow = S.ilsGs, _locTgtHdg = null, _gsAlt = null;
  const _ils = S.mission?.arrival?.ils;
  if (_ils && !S.wow) {
    const _rw = runwayThreshold(S.mission.arrival.icao, S.mission.arrival.runway);
    if (_rw) {
      const crs    = _rw.hdg ?? _ils.course;                    // the runway's TRUE bearing — the published course is magnetic (~4° off → off the centerline)
      const dNm    = _gcNm(_rw.thr[0], _rw.thr[1], S.lat, S.lon);
      const angOff = ((_brgDeg(_rw.thr[0], _rw.thr[1], S.lat, S.lon) - (crs + 180) + 540) % 360) - 180;  // ° off centerline (+ = right)
      const hdgOff = ((S.hdg - crs + 540) % 360) - 180;
      if (dNm < 30 && Math.abs(hdgOff) < 90) {                  // inbound and within range
        ilsLocNow = Math.max(-2.5, Math.min(2.5, angOff));      // localizer dots (~1 dot/°)
        _gsAlt    = (S.mission.arrival.elevation ?? 0) + 50 + dNm * 318;   // 3° glideslope + ~50 ft threshold-crossing height
        ilsGsNow  = Math.max(-2.5, Math.min(2.5, (S.alt - _gsAlt) / 80));   // + = above the slope
        _dmeNm    = dNm;
        if (!locCap && Math.abs(ilsLocNow) < 1.5 && Math.abs(hdgOff) < 35 && dNm < 18) locCap = true;
        if (locCap && !gsCap && ilsGsNow < 0.4 && ilsGsNow > -1.8) gsCap = true;
        if (locCap) {                                           // crab toward the centerline → null deviation flies the course
          const aglNow = S.alt - (S.mission.arrival.elevation ?? 0);
          _locTgtHdg = (aglNow < 150) ? crs                     // near the ground the localizer is over-sensitive → just hold the runway heading (align)
                                      : crs + Math.max(-12, Math.min(12, ilsLocNow * 8));
        }
      }
    }
  }
  if (!_ils || S.wow) { locCap = false; gsCap = false; }

  if (ac.manualControl) {
    /* ── Shared setup ── */
    const perf = ac.performance ?? {};

    /* Ground elevation from mission */
    const groundFt = S.mission?.departure?.elevation ?? S.mission?.arrival?.elevation ?? 0;
    const onGround = S.alt <= groundFt + 0.5;

    /* ISA density */
    const alt_m  = S.alt * 0.3048;
    const rho    = 1.225 * Math.pow(Math.max(0, 1 - 2.2558e-5 * alt_m), 4.2559);

    /* Airspeed and dynamic pressure */
    const spd_ms = Math.max(1, S.spd) * 0.5144;                          // IAS (m/s) — what the wing & gauge feel
    const tas_ms = spd_ms / Math.sqrt(Math.max(0.05, rho / 1.225));      // true airspeed (faster than IAS up high)
    const q      = 0.5 * 1.225 * spd_ms * spd_ms;                        // dynamic pressure from IAS (sea-level ρ)

    /* Throttle — turbofan uses N1-derived fraction; piston/prop uses spdT directly */
    const isTurbofan = ac.engine?.type === 'turbofan';
    const throttle   = isTurbofan
      ? Math.pow(Math.max(0, (S.n1 ?? 0) / 100), 1.8)   // N1^1.8 → 22% N1 ≈ 5% T_max
      : Math.min(1, Math.max(0, S.spdT / (ac.envelope.cruiseSpd ?? 122)));

    /* Aircraft constants */
    const S_wing   = perf.wingArea  ?? 16.2;
    const mass     = perf.mass      ?? 1157;
    const T_max    = perf.thrustMax ?? 1800;
    const CL_0     = perf.CL_0     ?? 0.2;
    const CL_alpha = perf.CL_alpha ?? 5.0;
    const CL_max   = perf.CL_max   ?? 1.9;
    const CD_0     = perf.CD_0     ?? 0.028;
    const k_ind    = perf.inducedK ?? 0.055;
    const Vr       = perf.Vr ?? 55;

    /* ── Angular inertia — roll and pitch rates have momentum ── */
    const maxRollRate  = ac.handling?.rollRate  ?? 30;   // deg/s
    const maxPitchRate = ac.handling?.pitchRate ?? 5;    // deg/s

    /* AP lateral channel — when engaged in flight the autopilot banks toward a target heading:
       captured localizer > managed NAV (LNAV) > selected FCU bug. */
    let apBank = null;
    if (S.ap && !onGround) {
      let tgtHdg = locCap ? _locTgtHdg : (S.navManaged ? lnavTargetHeading() : null);
      if (tgtHdg == null) tgtHdg = S.hdgT;                     // fall back to selected HDG (or if no route)
      if (tgtHdg != null) {
        const e = ((tgtHdg - S.hdg + 540) % 360) - 180;        // shortest heading error
        apBank = Math.max(-25, Math.min(25, e * 1.2));         // proportional, AP bank limit 25°
      }
    }

    /* AP vertical channel — when engaged in flight the autopilot pitches to capture and hold
       a target altitude: managed VNAV flies the flight-plan profile, else it holds the FCU
       altitude. Outer loop alt→VS (eased near capture), inner loop VS→flight-path-angle→pitch. */
    let apPitch = null;
    if (S.ap && !onGround) {
      const horizFpm = Math.max(120, tas_ms * 196.85);                          // TRUE airspeed → ft/min (IAS understated the path angle up high → over-steep VS)
      /* Captured glideslope: feed-forward the nominal 3° rate so the aircraft tracks the beam
         without lag, plus a gentle pull toward it. Pure proportional on a moving target either
         lags high or oscillates (phugoid); the feed-forward fixes both. */
      let cmdVSraw;
      if (gsCap) {
        const gsRate = -horizFpm * 0.05241;                                    // nominal 3° descent rate at this TAS
        const aglFt  = S.alt - (S.mission?.arrival?.elevation ?? 0);
        if (aglFt < 40) {                                                      // FLARE — ease the sink to a gentle touchdown (else it hits at the full GS rate → hard-landing crash)
          const f = Math.max(0, aglFt / 40);
          cmdVSraw = gsRate * f - 130 * (1 - f);                               // GS rate at 40 ft → ~-130 fpm at the ground
        } else {
          cmdVSraw = Math.max(-2000, Math.min(500, gsRate + (_gsAlt - S.alt) * 8));   // + firm deviation pull; small climb to regain from below
        }
      } else {
        const altTgt = S.altManaged ? vnavTargetAlt() : S.altT;
        cmdVSraw = Math.max(-1800, Math.min(1800, (altTgt - S.alt) * 3));      // gentle gain → flares ~600 ft out, less overshoot
      }
      if (_apVsCmd == null || onGround) _apVsCmd = S.vs ?? 0;
      const vsStep   = 550 * dt;                                                 // ease the command in (~3 s to full rate) so the descent doesn't step → no spike
      _apVsCmd = Math.max(_apVsCmd - vsStep, Math.min(_apVsCmd + vsStep, cmdVSraw));
      const cmdVS    = _apVsCmd;
      const gammaDeg = Math.asin(Math.max(-0.3, Math.min(0.3, cmdVS / horizFpm))) * 180 / Math.PI;
      const vsErr    = cmdVS - (S.vs ?? 0);                                     // close the loop on actual VS — the ramp keeps the start small, so damping can be firm
      /* Trim AoA from the lift the wing actually needs at this speed — a fixed 2.5° held at
         cruise but badly under-trimmed on a slow approach (a heavy jet needs ~10° at Vapp),
         so the AP sank through the glideslope. Derive it from CL = W/(q·S). */
      const clNeed   = (mass * 9.81) / Math.max(1, q * S_wing);
      const _dCL0ap  = ((ac.flaps ?? [])[S.flaps] ?? {}).dCL_0 ?? 0;            // flaps add camber lift → less AoA at a given CL
      const trimAoA  = Math.max(0, Math.min(14, (clNeed - CL_0 - _dCL0ap) / CL_alpha * 180 / Math.PI));
      const _aglP    = S.alt - (S.mission?.arrival?.elevation ?? 0);
      const _flaring = gsCap && _aglP < 50;
      const _vsGain  = _flaring ? 0.0045 : 0.0032;                            // flare — arrest the sink, but capped so the camber lift doesn't balloon it
      apPitch = Math.max(-8, Math.min(16, gammaDeg + trimAoA + vsErr * _vsGain));
      if (_flaring) apPitch = Math.max(trimAoA, Math.min(apPitch, trimAoA + 4));   // flare: hold level..+4° — never nose-down (let ground effect cushion), never balloon
    }

    /* On ground: snap back to level; in flight: fight inertia (AP overrides the stick) */
    const rollTarget  = onGround ? 0 : (apBank ?? S.rollT);
    const pitchTarget = (onGround && S.spd < Vr) ? 0 : (apPitch ?? S.pitchT);
    const maxBank     = ac.handling?.maxBank  ?? 60;
    const maxPitch    = ac.handling?.maxPitch ?? 30;

    /* PD controller — proportional (attitude error) + derivative (damps oscillation)
       Without the D term the rate overshoots and the aircraft jitters.            */
    const curRollRate  = S.rollRate  ?? 0;
    const curPitchRate = S.pitchRate ?? 0;
    const desiredRollRate  = Math.max(-maxRollRate,  Math.min(maxRollRate,
      4.0 * (rollTarget  - S.roll)  - 0.7 * curRollRate));
    const desiredPitchRate = Math.max(-maxPitchRate, Math.min(maxPitchRate,
      2.5 * (pitchTarget - S.pitch) - 0.8 * curPitchRate));

    const tauRoll  = onGround ? 0.05 : 0.18;
    const tauPitch = onGround ? 0.05 : 0.30;
    const newRollRateVal  = curRollRate  + ((desiredRollRate  - curRollRate)  / tauRoll)  * dt;
    const newPitchRateVal = curPitchRate + ((desiredPitchRate - curPitchRate) / tauPitch) * dt;

    newRoll  = Math.max(-maxBank,  Math.min(maxBank,  S.roll  + newRollRateVal  * dt));
    newPitch = Math.max(-maxPitch, Math.min(maxPitch, S.pitch + newPitchRateVal * dt));

    /* Flap effects */
    const flapCfg  = (ac.flaps ?? [])[S.flaps] ?? {};
    const CL_max_e = CL_max + (flapCfg.dCL_max ?? 0);
    const CL_0_e   = CL_0   + (flapCfg.dCL_0   ?? 0);   // camber lift — more CL at the same AoA (slow flight at low pitch)
    const CD_0_e   = CD_0   + (flapCfg.dCD_0   ?? 0);

    /* Gear drag — retractable aircraft only; fixed-gear drag is baked into CD_0 */
    const gearDrag = (!ac.fixedGear && S.gear) ? (perf.gearDrag ?? 0) : 0;

    /* Prop/damage drag — seized propeller + battle damage as engine dies */
    const ePow     = S.enginePower ?? 1.0;
    const propDrag = (1 - ePow) * 0.022;
    const CD_0_eff = CD_0_e + propDrag + gearDrag;

    /* Ground effect — within ~1 wingspan of the ground the wing's induced drag collapses
       (Wieselsberger) and lift rises a little: the cushion that floats the flare. */
    const span    = perf.wingSpan ?? Math.sqrt(8.5 * S_wing);            // estimate from area (AR ~8.5) if absent
    const hOverB  = Math.max(0, S.alt - groundFt) / span;               // height above ground / wingspan
    const geK     = hOverB < 1.1 ? ((16 * hOverB) ** 2) / (1 + (16 * hOverB) ** 2) : 1;   // induced-drag factor → ~0.4 at touchdown
    const geLift  = hOverB < 1.1 ? 1 + 0.10 * (1 - Math.min(1, hOverB)) : 1;              // up to +10% CL near the ground

    /* Aerodynamics */
    const alpha = newPitch * DEG;
    const CL_b  = Math.min(CL_max_e, Math.max(-0.5, CL_0_e + CL_alpha * alpha));
    const CL    = CL_b * geLift;                                         // ground effect lifts …
    const CD    = CD_0_eff + k_ind * CL_b * CL_b * geK;                  // … and cuts the induced drag near the ground
    const L     = q * S_wing * CL;
    const D     = q * S_wing * CD;
    const engineLive = S.engineState === 'running';
    const T     = engineLive ? throttle * T_max * (rho / 1.225) * (S.enginePower ?? 1.0) : 0;
    const W     = mass * 9.81;

    const wowLatch = S.wow && (S.vs ?? 0) < -50;  // latch only when landing (descending), not takeoff
    if (onGround && (L < W || wowLatch)) {  // wow latch: stay on ground once down
      /* ── Ground roll ──
         Forces: thrust, aerodynamic drag, rolling friction, brakes.
         Heading via nose wheel steering.                              */
      const muRoll  = perf.muRoll  ?? 0.05;   // grass ≈ 0.05, tarmac ≈ 0.02
      const muStatic = perf.muStatic ?? muRoll * 1.8;   // breakaway: idle won't roll a parked jet
      const muBrake = perf.muBrake ?? 0.35;
      const engineDead = (S.enginePower ?? 1.0) < 0.05;
      /* Use actual (unclamped) speed for ground dynamics — spd_ms is clamped to 1 kt
         for the flight model only (prevents division-by-zero in gamma calculation). */
      const spd_ms_gnd = S.spd * 0.5144;
      /* Parking brake latches full braking (holds against thrust even at a standstill);
         momentary brakes / idle-stop only bite once actually rolling. */
      const braking = (S.parkBrake || ((_idleThr || engineDead || S.braking) && spd_ms_gnd > 0.5)) ? 1 : 0;

      /* Static (breakaway) friction below taxi speed for jets, so idle thrust alone can't
         start a parked aircraft rolling — it takes a touch above idle to break away, then
         idle sustains the taxi once moving. */
      const muGround  = (isTurbofan && spd_ms_gnd < 1.0) ? muStatic : muRoll;
      const F_net     = T - D - (muGround + braking * muBrake) * W;
      const newSpd_ms = Math.max(0, spd_ms_gnd + F_net / mass * dt);

      newSpd = newSpd_ms / 0.5144;
      newAlt = groundFt;
      vs     = 0;
      if (S.aircraft?.manualControl) {
        /* Nose-wheel steering: yaw rate ∝ steer angle × ground speed, so it only
           turns while rolling (can't pivot a stationary aircraft). Capped at 30°/s. */
        const yawRate = Math.max(-30, Math.min(30, (S.steer ?? 0) * newSpd * 1.1));  // °/s
        newHdg = (((S.hdg + yawRate * dt) % 360) + 360) % 360;
      } else {
        newHdg = convergeHdg(S.hdg, S.hdgT, 30 * dt);  // AP heading-bug steering
      }

    } else {
      /* ── Flight model ──
         Point-mass wind axes. VS integrated across frames via S.vs.  */
      const vz_ms  = (S.vs ?? 0) / 196.85;
      const gamma  = Math.asin(Math.max(-0.5, Math.min(0.5, vz_ms / tas_ms)));

      const a_long = (T * Math.cos(alpha) - D - W * Math.sin(gamma)) / mass;
      const dGamma = (L - W * Math.cos(gamma)) / (mass * Math.max(10, tas_ms))
                   - 0.4 * gamma                        // pitch damping — horizontal stab
                   + (S.trim ?? 0) * 0.0015;            // trim — shifts pitch equilibrium

      const newTas_ms = Math.max(0, tas_ms + a_long * dt);   // integrate TAS (forces are real); display IAS
      const newGamma  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, gamma + dGamma * dt));

      newSpd = newTas_ms * Math.sqrt(Math.max(0.05, rho / 1.225)) / 0.5144;   // TAS → IAS for the gauge
      vs     = newTas_ms * Math.sin(newGamma) * 196.85;

      /* High-alpha stall: CL hits CL_max — sudden snap, nose drops */
      if (CL > CL_max_e * 0.95) {
        const sf = Math.min(1, (CL / CL_max_e - 0.95) / 0.05);
        vs      -= sf * 800;
        newPitch = Math.max(newPitch - 3 * sf * dt, -15);
      }

      /* Energy stall: L < W at low speed — gentle progressive sink, no snap */
      const liftDeficit = Math.max(0, W - L) / W;              // 0 = flying, 1 = no lift
      if (liftDeficit > 0.05) {
        vs -= liftDeficit * 120;                                // gentle fpm nudge per frame
      }

      /* Liftoff: bump clear of ground to release WoW next frame */
      newAlt = Math.max(onGround ? groundFt + 1 : groundFt, S.alt + vs * dt / 60);

      /* Coordinated turn — rate uses true airspeed */
      const turnRate = 9.81 * Math.tan(newRoll * DEG) / Math.max(10, newTas_ms);
      newHdg = (S.hdg + turnRate * dt * 180 / Math.PI + 360) % 360;

      /* ── Rotary engine gyroscopic precession ──
         Le Rhône spins clockwise seen from pilot.
         Pitch-up → yaw right. Left bank → pitch-down assist. Right bank → pitch-up resistance.
         All effects scale with throttle (engine spin speed).                                  */
      if (ac.rotaryEngine?.gyroscopicTorque) {
        const gyro = throttle * 0.6;                          // strength scales with power
        newHdg  = (newHdg  + newPitchRateVal * gyro * dt * 1.5 + 360) % 360;  // pitch → yaw
        newPitch = Math.max(-maxPitch, Math.min(maxPitch,
          newPitch - newRollRateVal * gyro * dt * 0.4));       // roll → pitch couple
      }
    }

    /* WoW — weight on wheels (squat switch) */
    newWow = newAlt <= groundFt + 0.5;
    if (!S.wow && newWow) newTouchdownVS = vs;   // record VS on touchdown

  } else {
    /* ── Autopilot convergence ── */
    const apGround = S.mission?.departure?.elevation ?? S.mission?.arrival?.elevation
                  ?? ac.situations?.[0]?.alt ?? 0;
    const apOnGnd  = S.alt <= apGround + 0.5;
    const agl      = S.alt - apGround;

    /* Cap descent rate by AGL: full 2400 fpm above 500 ft,
       700 fpm on final (< 500 ft), 250 fpm flare (< 50 ft) */
    const maxDescentFpm = agl < 50 ? 250 : agl < 500 ? 700 : 2400;
    const descentFpm    = S.altT < S.alt ? maxDescentFpm : 2400;
    const altRate   = Math.min(Math.abs(S.altT - S.alt), descentFpm * dt / 60);
    const spdRate   = 8  * dt;
    const hdgRate   = 3  * dt;
    const pitchRate = 1.5 * dt;
    const rollRate  = 3  * dt;

    /* Don't climb while on the ground — altitude target is a preselect only.
       Aircraft leaves the ground only when it's already airborne (alt > apGround). */
    newAlt   = apOnGnd ? apGround : Math.max(apGround, converge(S.alt, S.altT, altRate));
    /* On the ground, a near-idle command rolls to a stop (static friction) rather than
       holding a 1-kt creep — the converge-model analog of taxi breakaway. */
    const _spdTgt = (apOnGnd && spdTarget < 4) ? 0 : spdTarget;
    newSpd   = converge(S.spd,   _spdTgt,   spdRate);
    newHdg   = convergeHdg(S.hdg, S.hdgT,  hdgRate);
    newPitch = converge(S.pitch, S.pitchT,  pitchRate);
    newRoll  = converge(S.roll,  S.rollT,   rollRate);
    vs       = (newAlt - prevAlt) / dt * 60;
    newWow   = apOnGnd;
  }

  /* ── ILS needles — the geometric LOC/GS computed at the top (display value) ── */
  const ilsLoc = ilsLocNow;
  const ilsGs  = ilsGsNow;

  /* ── FMA ── glass airliners drive it from the shared phase model; other aircraft keep
     their altitude-banded fmaPhases strip. ── */
  let fma = S.fma;
  if (ac.panel === 'airbus' || ac.panel === 'e190') {
    const fieldElev = S.mission?.departure?.elevation ?? S.mission?.arrival?.elevation ?? 0;
    const fp = { wow: newWow, n1: S.n1 ?? 0, vs, alt: newAlt, altT: S.altT,
                 gear: S.gear, ap: S.ap, athr: S.athr, fieldElev,
                 navManaged: S.navManaged, altManaged: S.altManaged,
                 athrMode: S.athrMode, athrDetent: S.athrDetent,
                 locCap, gsCap };
    fma = ac.manufacturer === 'boeing' ? computeBoeingFMA(fp) : computeAirbusFMA(fp);
  } else if (ac.fmaPhases) {
    const phase = ac.fmaPhases.find(p => newAlt >= p.minAlt);
    if (phase) {
      fma = phase.vals.map((val, i) => ({
        sub:   S.fma[i]?.sub ?? '',
        val,
        col:   phase.cols[i] ?? 'white',
        flash: 0,
      }));
    }
  }

  /* ── Wind ── */
  const wx = _getWind();
  const windSpd_ms  = wx.spd * 0.5144;
  const windDir_rad = wx.dir * DEG;
  // Wind FROM → air moves in opposite direction
  const windN_ms = windSpd_ms * Math.cos(windDir_rad + Math.PI);
  const windE_ms = windSpd_ms * Math.sin(windDir_rad + Math.PI);

  /* ── Turbulence — vertical buffeting only; roll noise causes terrain jitter ── */
  const turb = wx.turbulence ?? 0;
  if (turb > 0 && !newWow) {
    vs += (Math.random() - 0.5) * turb * 300;
  }

  /* ── Dead reckoning — ground velocity = TAS vector + wind. On the ground the wheels
     hold the aircraft, so no wind drift — it only tracks along its heading (a parked
     aircraft doesn't get blown across the apron). ── */
  const hdgRad = newHdg * DEG;
  const cosLat = Math.cos(S.lat * DEG);
  const _rhoRatio = Math.pow(Math.max(0, 1 - 2.2558e-5 * newAlt * 0.3048), 4.2559);   // ρ/ρ₀ at the new altitude
  const _tasMs    = newSpd * 0.5144 / Math.sqrt(Math.max(0.05, _rhoRatio));            // groundspeed ≈ TAS (IAS→TAS)
  const acN_ms = _tasMs * Math.cos(hdgRad);
  const acE_ms = _tasMs * Math.sin(hdgRad);
  const gndN_ms = acN_ms + (newWow ? 0 : windN_ms);
  const gndE_ms = acE_ms + (newWow ? 0 : windE_ms);
  const newLat  = S.lat + gndN_ms / 1852 / 60 * dt;
  const newLon  = S.lon + gndE_ms / 1852 / 60 / cosLat * dt;

  const newRollRate  = ac?.manualControl ? (typeof newRollRateVal  !== 'undefined' ? newRollRateVal  : S.rollRate)  : 0;
  const newPitchRate = ac?.manualControl ? (typeof newPitchRateVal !== 'undefined' ? newPitchRateVal : S.pitchRate) : 0;

  /* ── Bounds checker — crash detection ── */
  if (ac.manualControl) {
    // Hard landing: just touched down (WoW just went true) with excessive VS
    const justTouched = !S.wow && newWow;
    if (justTouched && vs < CRASH_VS_FPM) {
      setState({ crashed: true, crashReason: `HARD LANDING  ${Math.round(vs)} fpm`,
                 enginePower: 0, spdT: 0 });
      bbEvent({ type: 'crash', reason: `HARD LANDING ${Math.round(vs)} fpm` });
      return;
    }
    // Overspeed: structural failure above VNE × 1.15
    const vne = ac.envelope.maxSpd ?? 999;
    if (newSpd > vne * CRASH_OVERSPD) {
      setState({ crashed: true, crashReason: `OVERSPEED  ${Math.round(newSpd)} kt  (VNE ${Math.round(vne)} kt)`,
                 enginePower: 0, spdT: 0 });
      bbEvent({ type: 'crash', reason: `OVERSPEED ${Math.round(newSpd)} kt` });
      return;
    }
  }

  /* ── Oil temperature — first-order lag toward throttle-dependent target ── */
  const _running  = S.engineState === 'running';
  const _throttle = Math.max(0, Math.min(1, (S.spdT ?? 0) / (ac.envelope.maxSpd ?? 335)));
  const _oilTarget = _running ? 40 + _throttle * 75 : 15;   // °C: 40 idle → 115 full
  const _tau       = _running ? 180 : 600;                   // s: 3 min warm-up, 10 min cool-down
  const _oilNow    = S.oilTempC ?? 15;
  const newOilTempC = _oilNow + (_oilTarget - _oilNow) * (dt / _tau);

  /* Thrust reverser: auto-deploy on rollout above 60 kt, auto-stow below */
  const _trCapable = !!(ac.engine?.thrustReverser);
  const _trOn = _trCapable && newWow && newSpd > 60 && (_idleThr || S.braking);
  const _trPatch = _trCapable ? { thrustReverser: _trOn } : {};

  /* Ground spoilers: auto-deploy on touchdown when armed (lever at 1) + idle thrust */
  const justTouched = !S.wow && newWow;
  const _sbPatch = (justTouched && (S.speedBrake ?? 0) === 1 && _idleThr)
    ? { speedBrake: 2 } : {};

  /* Gear animation — 12-second transit (not for fixed-gear aircraft) */
  const GEAR_TIME = 12;
  const gearTarget = S.gear ? 1 : 0;
  const gearCur    = S.gearAnim ?? gearTarget;
  const gearDelta  = dt / GEAR_TIME;
  const newGearAnim = gearTarget > gearCur
    ? Math.min(1, gearCur + gearDelta)
    : Math.max(0, gearCur - gearDelta);
  const _gearPatch = !ac.fixedGear ? { gearAnim: newGearAnim } : {};

  /* ── Pushback: the tug walks the aircraft from the stand back onto the taxiway.
     Path reuses the already-computed taxi route (S.taxiRoute — the green map line):
     target = first network node, aligned toward the next node (taxi-out heading).
     Absolute interpolation from the captured stand pose, so no drift. ── */
  let pbLat = newLat, pbLon = newLon, pbHdg = newHdg, pbPatch = {};
  if (S.pushbackStart && !S.pushbackDone) {               // override the pose only while the push is in progress
    if (!S.pushbackTo) {                                  // capture the two-phase path once, on the first frame
      const _gr = ac?.gear || {}, NM_M = 1852;            // model units: 1 NM = 1852 m
      const _nx = _gr.nose?.x, _mx = _gr.main?.x;         // gear stations fwd of the model origin (NM)
      const _noseFwdM = (_nx ?? 0) * NM_M;                // origin → nose-gear (matches mission-start parking)
      const _wbM = _gr.noseGearToMainGear ? _gr.noseGearToMainGear / 1000      // real wheelbase if specified
                 : (_nx != null && _mx != null) ? (_nx - _mx) * NM_M           // else from gear stations
                 : 15;
      setState({ pushbackTo: capturePushback(S.taxiRoute, S.lat, S.lon, S.hdg, _wbM, _noseFwdM) });
    }
    const path = S.pushbackTo;
    if (path) {
      const PB_DELAY = 6000;                              // wait for the bridge to clear
      const PB_DUR = Math.max(12000, Math.min(45000, path.len * 250));   // pace by main-gear travel
      let p = (performance.now() - S.pushbackStart - PB_DELAY) / PB_DUR;
      p = Math.max(0, Math.min(1, p));
      if (p > 0) {
        const pose = pushbackPose(path, p);
        pbLat = pose.lat; pbLon = pose.lon; pbHdg = pose.hdg;
        pbPatch = { hdgT: pose.hdgT };                    // nose-wheel steering: straight on the back leg, into the turn
        if (p >= 1) pbPatch.pushbackDone = true;          // motion complete → release to normal taxi physics
      }
    }
  }

  setState({ alt: newAlt, spd: newSpd, hdg: pbHdg, pitch: newPitch, roll: newRoll,
             rollRate: newRollRate, pitchRate: newPitchRate,
             vs, ilsLoc, ilsGs, locCaptured: locCap, gsCaptured: gsCap, fma, lat: pbLat, lon: pbLon,
             prevAlt: S.alt, time: S.time + dt,
             wow: newWow, touchdownVS: newTouchdownVS,
             oilTempC: newOilTempC, ..._trPatch, ..._gearPatch, ..._sbPatch, ...pbPatch });
}

export function resetApproach() {
  _approachInit = false;
  _dmeNm = 0;
}

/* ── Helpers ── */
function _getWind() {
  const w = S.mission?.weather;
  if (!w) return { dir: 0, spd: 0, turbulence: 0 };
  const src = w.source === 'manual' ? w.manual
            : w.source === 'live'   ? S.metar
            : w.fallback;
  if (!src) return { dir: 0, spd: 0, turbulence: 0 };
  return {
    dir:        src.wdir  ?? src.wind  ?? 0,
    spd:        src.wspd  ?? 0,
    turbulence: src.turbulence ?? 0,
  };
}

function converge(cur, tgt, rate) {
  const d = tgt - cur;
  return Math.abs(d) <= rate ? tgt : cur + Math.sign(d) * rate;
}

function convergeHdg(cur, tgt, rate) {
  let diff = ((tgt - cur + 540) % 360) - 180;
  if (Math.abs(diff) <= rate) return tgt;
  return (cur + Math.sign(diff) * rate + 360) % 360;
}
