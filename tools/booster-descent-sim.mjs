/* Booster descent + guidance simulation — derive attitude (φ), the entry burn, and the
   closed-loop guidance (boostback sized to the target + lateral steering) for RTLS and ASDS.
   Scratch tool, not shipped.

   Vertical plane: X = downrange position (m, + away from launch), Z = altitude.
   Velocity (vDown = downrange, vVert = up). φ = nose angle from +Z(up) toward +X(downrange). */

const R_EARTH = 6_371_000, G0 = 9.80665, GM = 3.986004418e14, DEG = Math.PI / 180;

function rhoAtAlt(a) {
  if (a <= 11_000) { const T = 288.15 - 6.5e-3 * a; return 1.225 * Math.pow(T / 288.15, 4.2559); }
  if (a <= 25_000) return 0.3639 * Math.exp(-(a - 11_000) / 6341.6);
  if (a <= 86_000) return 0.01 * Math.exp(-(a - 25_000) / 7200);
  if (a <= 140_000) return 5.6e-6 * Math.exp(-(a - 86_000) / 6150);
  return 0;
}

import { readFileSync } from 'fs';
/* config-driven: load any F9 variant from its aircraft JSON */
let STG, S2, Cd, area, REC;
function loadAc(file) {
  const a = JSON.parse(readFileSync(`aircraft/${file}.json`, 'utf8'));
  const p = a.performance;
  const s1 = p.stages[0], s2 = p.stages[1];
  STG = { thrustSL: s1.thrustSL, thrustVac: s1.thrustVac, isp: s1.isp, massDry: s1.massDry, massWet: s1.massWet, nEng: s1.engineCount };
  S2  = { thrustVac: s2.thrustVac, isp: s2.isp, wet: s2.massWet, dry: s2.massDry };
  Cd = p.Cd ?? 0.27; area = p.area ?? 10.75;
  REC = { flipDuration: 20, boostbackEngines: 3, boostbackThrottle: 1.0, boostbackMax: 70,
          entryBurnAlt_m: 70000, entryBurnEngines: 3, entryBurnThrottle: 0.4, entryBurnDuration: 22,
          landingBurnAlt_m: 600, landingBurnEngines: 1, ...(p.recovery ?? {}) };
  return a;
}
const PROP1 = () => STG.massWet - STG.massDry;

const norm = d => ((d + 180) % 360 + 360) % 360 - 180;
const angOf = (x, z) => Math.atan2(x, z) / DEG;
const slew = (cur, tgt, m) => cur + Math.sign(norm(tgt - cur)) * Math.min(Math.abs(norm(tgt - cur)), m);

function attTarget(phase, vDown, vVert) {
  if (phase === 'flip' || phase === 'boostback') return angOf(-vDown, -vVert);
  if (phase === 'coast' || phase === 'entry' || phase === 'glide' || phase === 'landing')
    return vVert < 0 ? angOf(-vDown, -vVert) : 0;
  return angOf(vDown, vVert);
}

/* cheap predicted landing downrange: coast to apogee + fall, drift at current vDown */
function predLandX(X, alt, vDown, vVert, g) {
  const apAlt = alt + (vVert > 0 ? vVert * vVert / (2 * g) : 0);
  const T = Math.max(0, vVert / g) + Math.sqrt(2 * Math.max(0, apAlt) / g);
  return X + vDown * T;
}

/* programmed-FPA ascent → real MECO conditions (alt, downrange X, velocity, FPA) */
function _fpa(t, prof) {
  if (t <= prof[0][0]) return prof[0][1];
  if (t >= prof[prof.length-1][0]) return prof[prof.length-1][1];
  for (let i=0;i<prof.length-1;i++){ const[a,b]=prof[i],[c,d]=prof[i+1]; if(t>=a&&t<c) return b+(d-b)*(t-a)/(c-a); }
  return 0;
}
function ascend(scn) {
  const dt = 0.1, ig = scn.ignition;
  const upper = scn.upperMass;                 // stage2 + payload (stays after sep)
  let mass = STG.massDry + scn.prop1 + upper;   // liftoff
  let alt = 0, X = 0, vVert = 0, vDown = 0, t = ig;
  for (let i=0;i<20000;i++){
    const rho = rhoAtAlt(alt), atm = Math.min(1, rho/1.225);
    const g = G0 * Math.pow(R_EARTH/(R_EARTH+alt),2);
    if (mass <= STG.massDry + upper + scn.reserve + 1) break;  // MECO: stage-1 reserve kept for recovery
    const T = STG.thrustSL*atm + STG.thrustVac*(1-atm);
    const mdot = T/(STG.isp*G0);
    const fpa = _fpa(t, scn.fpaProfile) * DEG;    // commanded body pitch from horizontal
    const a = T/mass;
    const spd = Math.hypot(vVert,vDown);
    const dragA = spd>0.5 ? 0.5*rho*spd*spd*Cd*area/mass : 0;
    vVert += (a*Math.sin(fpa) - g - (spd>0.5?dragA*vVert/spd:0))*dt;
    vDown += (a*Math.cos(fpa)     - (spd>0.5?dragA*vDown/spd:0))*dt;
    mass = Math.max(STG.massDry+upper, mass - mdot*dt);
    alt += vVert*dt; X += vDown*dt; t += dt;
  }
  return { alt, X, vVert, vDown, t, fpaDeg: angOf(vDown,vVert) };
}

/* Stage 2 + payload from MECO → orbit (S2 loaded per-aircraft by loadAc) */
function orbitOf(alt, vDown, vVert) {
  const r = R_EARTH + alt, v2 = vDown*vDown + vVert*vVert;
  const energy = v2/2 - GM/r, sma = -GM/(2*energy);
  const L = r * vDown;                                   // angular momentum (tangential = horizontal)
  const e = Math.sqrt(Math.max(0, 1 + 2*energy*L*L/(GM*GM)));
  return energy < 0 ? { peri: sma*(1-e) - R_EARTH, apo: sma*(1+e) - R_EARTH } : { peri: -Infinity, apo: Infinity };
}
/* Orbit-targeting S2 guidance (the "build it properly" path): closed-loop on the orbit —
   steer the pitch so the APOAPSIS climbs to the target, then SECO when the PERIAPSIS reaches it.
   No fpaProfile, no burn-to-depletion: any mission just specifies targetAlt. Returns whether the
   target orbit was reached and how much Δv was left (margin) or how short it fell. */
function s2Ascent(meco, scn) {
  const dt = 0.2, pay = scn.payload ?? 12500, dryTot = S2.dry + pay, tgt = scn.targetAlt;
  let mass = S2.wet + pay, alt = meco.alt, t = meco.t, maxAlt = alt;
  let spd = Math.hypot(meco.vVert, meco.vDown);
  let fpaV = Math.atan2(meco.vVert, meco.vDown) / DEG;
  for (let i = 0; i < 9000; i++) {
    const ob = orbitOf(alt, spd * Math.cos(fpaV * DEG), spd * Math.sin(fpaV * DEG));
    if (ob.peri >= tgt - 5000)                            // orbit insertion — periapsis at target
      return { orbit: true, alt, maxAlt, spd, fpaV, peri: ob.peri, apo: ob.apo, secoT: t,
               dvLeft: S2.isp * G0 * Math.log(mass / dryTot) };
    if (mass <= dryTot)                                   // out of propellant before insertion
      return { orbit: false, alt, maxAlt, spd, fpaV, peri: ob.peri, apo: ob.apo, secoT: t, dvLeft: 0 };
    const g = G0 * Math.pow(R_EARTH / (R_EARTH + alt), 2);
    const a = S2.thrustVac / mass, mdot = S2.thrustVac / (S2.isp * G0);
    /* pitch command: raise apoapsis to target (pitch up when below, pitch DOWN hard when above so
       it stops climbing and circularizes instead of overshooting). */
    const apo = ob.apo > 0 && isFinite(ob.apo) ? ob.apo : 1e12;
    const fpaCmd = Math.max(-30, Math.min(35, 90 * (tgt - apo) / tgt));
    fpaV += Math.max(-3, Math.min(3, (fpaCmd - fpaV) * 0.5)) * dt;   // rate-limited steering
    spd += (a - g * Math.sin(fpaV * DEG)) * dt;
    alt += spd * Math.sin(fpaV * DEG) * dt;
    mass -= mdot * dt; t += dt; maxAlt = Math.max(maxAlt, alt);
  }
  const ob = orbitOf(alt, spd * Math.cos(fpaV * DEG), spd * Math.sin(fpaV * DEG));
  return { orbit: false, alt, maxAlt, spd, fpaV, peri: ob.peri, apo: ob.apo, secoT: t, dvLeft: 0 };
}

function run(scn) {
  const dt = 0.05;
  const m = scn.meco;
  let alt = m.alt, vVert = m.vVert, vDown = m.vDown, X = m.X;
  let fuel = scn.reserve, mass = STG.massDry + fuel, phi = angOf(vDown, vVert);   // real recovery propellant budget
  let minFuel = fuel;
  let phase = 'flip', phaseT = 0, t = 0, apogee = alt, entryV0 = null, entryV1 = null;
  const log = [];

  for (let i = 0; i < 400000; i++) {
    const rho = rhoAtAlt(alt), atmFrac = Math.min(1, rho / 1.225);
    const g = G0 * Math.pow(R_EARTH / (R_EARTH + alt), 2);
    const spd = Math.hypot(vVert, vDown);
    const dynQ = 0.5 * rho * spd * spd;
    const dragMult = phase === 'glide' ? 8 : 1;
    const dragAcc = spd > 0.5 ? dynQ * Cd * area * dragMult / mass : 0;

    let thV = 0, thD = 0, mdot = 0;
    const burn = (n, thr) => { if (fuel <= 0) { mdot = 0; return 0; } const T = (STG.thrustSL * atmFrac + STG.thrustVac * (1 - atmFrac)) * (n / STG.nEng) * thr; mdot = T / (STG.isp * G0); return T / mass; };
    const bbDir = Math.sign(scn.targetX - X) || -1;                          // boostback thrust direction (toward target)
    const bbAtt = angOf(bbDir * Math.cos(18 * DEG), Math.sin(18 * DEG));      // nose along boostback thrust

    if (phase === 'flip') {
      if (phaseT >= REC.flipDuration) { phase = scn.boostback ? 'boostback' : 'coast'; phaseT = 0; }
    } else if (phase === 'boostback') {
      /* closed-loop RTLS: thrust toward the target (engines downrange) to BUILD reverse velocity,
         not just null it, until the predicted landing reaches the target. */
      const pred = predLandX(X, alt, vDown, vVert, g);
      if (pred - scn.targetX > 2000 && phaseT < REC.boostbackMax) {
        const tA = burn(REC.boostbackEngines, REC.boostbackThrottle);
        const bb  = (scn.bbPitch ?? 4) * DEG;   // thrust ~horizontal (don't loft the apogee)
        thD = bbDir * Math.cos(bb) * tA;
        thV = Math.sin(bb) * tA;
      } else { phase = 'coast'; phaseT = 0; }
    } else if (phase === 'coast') {
      if (alt <= REC.entryBurnAlt_m && vVert < 0) { phase = 'entry'; phaseT = 0; entryV0 = spd; }
    } else if (phase === 'entry') {
      const tA = burn(REC.entryBurnEngines, REC.entryBurnThrottle);
      if (spd > 0.5) { thV = -tA * (vVert / spd); thD = -tA * (vDown / spd); }
      if (spd <= entryV0 * 0.55 || phaseT >= REC.entryBurnDuration) { phase = 'glide'; phaseT = 0; entryV1 = spd; }
    } else if (phase === 'glide') {
      if (alt <= REC.landingBurnAlt_m && vVert < 0) { phase = 'landing'; phaseT = 0; }
    } else if (phase === 'landing') {
      const tAmax = burn(REC.landingBurnEngines, 1.0);
      const reqDecel = vVert < 0 ? Math.min(tAmax, vVert * vVert / (2 * Math.max(1, alt))) : 0;
      thV = Math.min(tAmax, reqDecel + g);
    }

    /* lateral guidance — grid fins (glide) + gimbal/landing legs null the downrange error.
       horizontal accel ∝ position error + velocity, authority-limited. */
    if (phase === 'glide' || phase === 'landing') {
      const aMax = phase === 'landing' ? 6 : 2.5;
      thD += Math.max(-aMax, Math.min(aMax, -0.0008 * (X - scn.targetX) - 0.20 * vDown));
    }

    const dV = spd > 0.5 ? -dragAcc * (vVert / spd) : 0;
    const dD = spd > 0.5 ? -dragAcc * (vDown / spd) : 0;
    const rate = (atmFrac > 0.02 ? 12 : 4) * dt;
    let attTgt;
    if (phase === 'flip' || phase === 'boostback') attTgt = bbAtt;            // nose toward launch (boostback thrust)
    else if (phase === 'coast' || phase === 'entry' || phase === 'glide' || phase === 'landing')
      attTgt = vVert < 0 ? angOf(-vDown, -vVert) : 0;                          // reorient nose-up, then engine-first down
    else attTgt = angOf(vDown, vVert);
    phi = slew(phi, attTgt, rate);

    vVert += (thV + dV - g) * dt;
    vDown += (thD + dD) * dt;
    fuel = Math.max(0, fuel - mdot * dt); mass = STG.massDry + fuel; minFuel = Math.min(minFuel, fuel);
    alt += vVert * dt;
    X += vDown * dt;
    apogee = Math.max(apogee, alt);
    t += dt; phaseT += dt;

    if (i % 40 === 0 || alt <= 0) log.push({ t, phase, alt, X, v: spd, vV: vVert, vD: vDown, phi });
    if (alt <= 0) break;
  }
  const L = log[log.length - 1];
  return { log, apogee, entryV0, entryV1, landX: L.X, touchV: L.v, touchVV: L.vV, touchPhi: L.phi, minFuel, fuelLeft: fuel };
}

/* Two-burn (Hohmann) S2 for high orbits: burn 1 raises the apoapsis to target, coast to apoapsis,
   burn 2 circularizes (raises periapsis to target). Returns whether 590 km is in the Δv budget. */
function s2TwoBurn(meco, scn) {
  const dt = 0.1, pay = scn.payload ?? 12500, dryTot = S2.dry + pay, tgt = scn.targetAlt;
  let mass = S2.wet + pay, alt = meco.alt, vVert = meco.vVert, vDown = meco.vDown, t = meco.t;
  const fire = () => { const a = S2.thrustVac / mass; mass -= (S2.thrustVac / (S2.isp * G0)) * dt; return a; };
  let phase = 'burn1', coastApo = 0, cmd = Math.atan2(vVert, vDown) / DEG;   // commanded thrust pitch
  for (let i = 0; i < 40000; i++) {
    const g = G0 * Math.pow(R_EARTH / (R_EARTH + alt), 2), cen = vDown * vDown / (R_EARTH + alt);
    const ob = orbitOf(alt, vDown, vVert);
    if (phase === 'burn1') {
      if (ob.apo >= tgt) { phase = 'coast'; continue; }
      if (mass <= dryTot) return { ok: false, why: 'out of fuel raising apoapsis', apo: ob.apo, peri: ob.peri };
      /* thrust steered toward a shallow climb (~6°) — build horizontal velocity at low altitude to
         raise the apoapsis efficiently, instead of flying up and overshooting it. */
      const a = fire();
      cmd += Math.max(-3, Math.min(3, (6 - cmd) * 0.5)) * dt;
      vVert += (a * Math.sin(cmd * DEG) - g + cen) * dt;
      vDown += (a * Math.cos(cmd * DEG)) * dt;
    } else if (phase === 'coast') {
      if (vVert <= 0) { phase = 'circ'; coastApo = alt; continue; }   // reached apoapsis
      vVert += (-g + cen) * dt;                       // ballistic
    } else {                                          // circularize at apoapsis
      if (ob.peri >= tgt - 5000) return { ok: true, peri: ob.peri, apo: ob.apo, alt, dvLeft: S2.isp * G0 * Math.log(mass / dryTot), coastApo };
      if (mass <= dryTot) return { ok: false, why: 'out of fuel circularizing', apo: ob.apo, peri: ob.peri, coastApo };
      const a = fire();
      vDown += a * dt;                                // horizontal burn
      vVert += (-g + cen) * dt;
    }
    alt += vVert * dt; t += dt;
  }
  return { ok: false, why: 'timeout' };
}

/* config-driven reachability: load each mission's aircraft + payload, ascend to MECO, then run
   the orbit-targeting S2 guidance against a target altitude → does it reach the orbit, with margin? */
function check(name, file, payload, reserve, targetKm, fpaOverride) {
  const a = loadAc(file);
  const scn = { name, ignition: a.ignitionTime, fpaProfile: fpaOverride ?? a.performance.fpaProfile,
                prop1: PROP1(), upperMass: S2.wet + payload, payload, reserve, targetAlt: targetKm * 1000,
                targetX: 0, boostback: true, bbPitch: 4 };
  const meco = ascend(scn); scn.meco = meco;
  const s2 = s2Ascent(meco, scn);
  const tag = s2.orbit ? `✓ reached (Δv margin ${s2.dvLeft.toFixed(0)} m/s)`
                       : `✗ SHORT — apo ${(s2.apo/1000).toFixed(0)}km, peri ${(s2.peri/1000).toFixed(0)}km`;
  console.log(`${name.padEnd(15)} tgt ${String(targetKm).padStart(3)}km | MECO T+${(meco.t-scn.ignition).toFixed(0)}s ${(meco.alt/1000).toFixed(0)}km `
    + `→ SECO T+${(s2.secoT-scn.ignition).toFixed(0)}s ${(s2.peri/1000).toFixed(0)}×${(s2.apo/1000).toFixed(0)}km | ${tag}`);
}

console.log('=== Orbit-targeting S2 guidance — reachability per mission ===');
check('demo2',       'falcon9-b5-demo2', 12500, 0,     200);   // expendable-equivalent (no reserve)
check('demo2 +45t',  'falcon9-b5-demo2', 12500, 45000, 200);   // with RTLS reserve
check('CRS-1',       'falcon9-b1',        5000, 0,     250);   // ISS-bound, no recovery
check('I5 590 base', 'falcon9-b5-590',   12500, 0,     590);   // 590 km, no reserve (ASDS-equivalent perf)
check('I5 590 +45t', 'falcon9-b5-590',   12500, 45000, 590);   // 590 km AND RTLS reserve
check('I5 400 +45t', 'falcon9-b5-590',   12500, 45000, 400);   // would a lower orbit allow RTLS?
/* I5 with a STANDARD early profile (no loft-up hack) — let the guidance do the lofting to 590 */
const STD = [[180,90],[195,89],[210,84],[235,72],[260,57],[285,40],[310,26],[335,16],[355,9],[385,4],[490,2],[690,1],[880,0]];
console.log('\n-- I5 590 with TWO-BURN S2 (Hohmann: raise apoapsis → coast → circularize) --');
function checkTwoBurn(name, file, payload, reserve, targetKm, fpaOverride) {
  const a = loadAc(file);
  const scn = { name, ignition: a.ignitionTime, fpaProfile: fpaOverride ?? a.performance.fpaProfile,
                prop1: PROP1(), upperMass: S2.wet + payload, payload, reserve, targetAlt: targetKm * 1000 };
  const meco = ascend(scn);
  const r = s2TwoBurn(meco, scn);
  console.log(`${name.padEnd(18)} tgt ${targetKm}km, ${reserve/1000}t reserve | ` + (r.ok
    ? `✓ ORBIT ${(r.peri/1000).toFixed(0)}×${(r.apo/1000).toFixed(0)}km, coast-apo ${(r.coastApo/1000).toFixed(0)}km, Δv margin ${r.dvLeft.toFixed(0)} m/s`
    : `✗ ${r.why} (apo ${(r.apo/1000).toFixed(0)}km, peri ${(r.peri/1000).toFixed(0)}km)`));
}
checkTwoBurn('I5 590 2burn base',  'falcon9-b5-590', 12500, 0,     590, STD);   // expendable / ASDS perf
checkTwoBurn('I5 590 2burn +45t',  'falcon9-b5-590', 12500, 45000, 590, STD);   // + RTLS reserve
checkTwoBurn('I5 590 2burn 11t',   'falcon9-b5-590', 11000, 0,     590, STD);   // lighter 4-civilian Dragon
