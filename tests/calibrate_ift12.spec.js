/**
 * Calibration test for IFT-12 (Starship V3).
 *
 * Correct IFT-12 physics (from telemetry):
 *   SECO:   T+9:10 (~550 s), alt ≈ 146 km, FPA ≈ +1.77° (still ascending)
 *   Apogee: T+24:00 (~1440 s), 195 km, 7 204 m/s — reached 14.5 min AFTER SECO
 *   Periapsis: deeply inside atmosphere → natural single-pass reentry, no deorbit burn
 *   Recovery: active RTLS body-flap guidance back toward Boca Chica
 *   Splashdown: Gulf of Mexico (NOT Indian Ocean)
 *
 * Key insight: fpaProfile must keep FPA > 0 through SECO so the ship is still
 * ascending when engines cut. The old profile (FPA = 0 at t = 270) put SECO at
 * ~492 km — completely wrong. New profile holds a shallow positive FPA right
 * through the end of the burn.
 *
 * stgIgnT (stage 2 ignition time in mission clock) ≈ 252 s:
 *   stage 1 ignition at t = 60, burnDuration = 170 → MECO at t ≈ 230,
 *   6 s coast → stage 2 ignition at t ≈ 236 (observed in blackbox: ≈ 252 s).
 *   Nominal SECO at t = 252 + burnDuration + 62 (burnExt) = 610 → burnDuration ≈ 296 s.
 *
 * Scan strategy:
 *   Scan 1 — coarse (5 s steps, dt = 1.0): burnDuration 270–330 s.
 *             Reports SECO alt/vel/FPA and computes apogee analytically.
 *             Target: apogee ≈ 195 km.
 *   Scan 2 — fine (1 s steps, dt = 0.1): ±8 s around best candidate.
 *             Writes winning burnDuration + fpaProfile to starship.json.
 */

import { test } from '@playwright/test';
import * as fs from 'fs';

test.setTimeout(600_000);

const MU      = 3.986004418e14;
const R_EARTH = 6_371_000;

function apogeeKm(alt_m, vel_ms, fpa_deg) {
  const r   = R_EARTH + alt_m;
  const vt  = vel_ms * Math.cos(fpa_deg * Math.PI / 180);
  const eps = vel_ms * vel_ms / 2 - MU / r;
  if (eps >= 0) return Infinity;
  const a   = -MU / (2 * eps);
  const h   = r * vt;
  const e   = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU * MU)));
  return (a * (1 + e) - R_EARTH) / 1000;
}

function periapsisKm(alt_m, vel_ms, fpa_deg) {
  const r   = R_EARTH + alt_m;
  const vt  = vel_ms * Math.cos(fpa_deg * Math.PI / 180);
  const eps = vel_ms * vel_ms / 2 - MU / r;
  if (eps >= 0) return -Infinity;
  const a   = -MU / (2 * eps);
  const h   = r * vt;
  const e   = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU * MU)));
  return (a * (1 - e) - R_EARTH) / 1000;
}

const STARSHIP_JSON = new URL('../aircraft/starship.json', import.meta.url).pathname;

/* ── Correct IFT-12 fpaProfile ─────────────────────────────────────────────
   Stage 1 is unchanged. Right after stage 2 ignition (~t = 213), pitch over
   aggressively to ~0.5° (the rate limiter delivers 3°/s, so 13° → 0.5° in
   ~4 s). Hold a very small positive FPA through most of the burn so the ship
   gains only ~26 km of altitude (120 km at sep → 146 km at SECO).
   Ramp back up to ~2° in the final 50 s so FPA at SECO ≈ 1.77° — the value
   required for a 195 km apogee (angular momentum conservation with apogee
   velocity 7 204 m/s from telemetry).
   Old profile hit 0° at t = 270 while engines still burned — wrong physics. */
const FPA_RTLS = [
  [  60,  90],
  [  80,  88],
  [ 100,  84],
  [ 130,  70],
  [ 160,  51],
  [ 200,  26],
  [ 225,  13],
  [ 240,   0.5],  // aggressive pitch-over: rate limiter hits 3°/s, done in ~4 s
  [ 560,   0.5],  // hold very flat through most of stage 2 burn
  [ 640,   2.5],  // ramp up so actual FPA at SECO (t≈610) lands near 1.77°
  [ 700,   0],
  [9999,   0],
];

async function runSim(page, burnDuration, fpaProfile, dtPerTick = 1.0) {
  const ac = JSON.parse(fs.readFileSync(STARSHIP_JSON, 'utf8'));
  ac.performance.stages[1].burnDuration = burnDuration;
  ac.performance.fpaProfile = fpaProfile;
  fs.writeFileSync(STARSHIP_JSON, JSON.stringify(ac, null, 2));

  await page.goto('/?mission=ift-12&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  const ticksPerCall     = dtPerTick <= 0.2 ? Math.round(10 / dtPerTick) : 10;
  const simSecondsPerCall = ticksPerCall * dtPerTick;
  const maxSim           = 900;

  for (let t = 0; t < maxSim; t += simSecondsPerCall) {
    await page.evaluate(([n, dt]) => window.simStep(n, dt), [ticksPerCall, dtPerTick]);
    const s = await page.evaluate(() => window.simGetState());
    if (s.rocketSECO) {
      const alt_m  = (s.alt  ?? 0) * 0.3048;
      const vel_ms = (s.spd  ?? 0) * 0.5144;
      const fpa    = s.pitch ?? 0;
      const v_circ = Math.sqrt(MU / (R_EARTH + alt_m));
      const apo    = apogeeKm(alt_m, vel_ms, fpa);
      const peri   = periapsisKm(alt_m, vel_ms, fpa);
      return { burnDuration, alt_km: alt_m / 1000, vel_ms, fpa, v_circ,
               delta_v: vel_ms - v_circ, apo_km: apo, peri_km: peri,
               secoT: s.time ?? 0 };
    }
  }
  return null;
}

// ── Scan 1: coarse burnDuration sweep ──────────────────────────────────────
// Target: apogee ≈ 195 km with FPA > 0 at SECO (ascending trajectory).
// Expected burnDuration ≈ 296 s (stgIgnT≈252, burnExt=62, SECO at t≈610).
test('scan 1: coarse burnDuration → apogee 195 km', async ({ page }) => {
  test.setTimeout(300_000);

  // stgIgnT≈206, burnExt=62, SECO target t=610 → burnDuration ≈ 342 s
  const candidates = [];
  for (let bd = 320; bd <= 370; bd += 5) candidates.push(bd);

  let best = null;
  console.log('\n--- IFT-12 coarse scan (FPA>0 profile) ---');
  console.log('burnDur  SECO_alt  SECO_vel   FPA    v_circ   Δv      apogee    peri    SECO_t');

  for (const bd of candidates) {
    const r = await runSim(page, bd, FPA_RTLS, 1.0);
    if (!r) { console.log(`bd=${bd}: no SECO within 900 s`); continue; }
    const apoStr  = isFinite(r.apo_km)  ? r.apo_km.toFixed(0).padStart(6)  + ' km' : '  orb+';
    const periStr = isFinite(r.peri_km) ? r.peri_km.toFixed(0).padStart(6) + ' km' : '  orb+';
    console.log(
      `${bd.toString().padStart(7)}  ` +
      `${r.alt_km.toFixed(1).padStart(7)} km  ` +
      `${r.vel_ms.toFixed(0).padStart(7)} m/s  ` +
      `${r.fpa.toFixed(2).padStart(5)}°  ` +
      `${r.v_circ.toFixed(0).padStart(7)} m/s  ` +
      `${r.delta_v.toFixed(0).padStart(6)} m/s  ` +
      `${apoStr}  ${periStr}  t=${r.secoT.toFixed(0)}`
    );
    if (!best || Math.abs(r.apo_km - 195) < Math.abs(best.apo_km - 195))
      best = { ...r };
  }

  if (best) {
    console.log(`\n→ Best: bd=${best.burnDuration}  SECO ${best.alt_km.toFixed(1)} km  ` +
                `v=${best.vel_ms.toFixed(0)} m/s  FPA=${best.fpa.toFixed(2)}°  ` +
                `apogee=${best.apo_km.toFixed(0)} km  t=${best.secoT.toFixed(0)} s`);
  }
});

// ── Scan 3: splashdown verification ───────────────────────────────────────────
// Run the winning config (bd=342) to splashdown; report lat/lon vs target
// Indian Ocean off NW Australia: lat ≈ -22°, lon ≈ 115°.
async function runSimSplash(page, burnDuration, fpaProfile) {
  const ac = JSON.parse(fs.readFileSync(STARSHIP_JSON, 'utf8'));
  ac.performance.stages[1].burnDuration = burnDuration;
  ac.performance.fpaProfile = fpaProfile;
  fs.writeFileSync(STARSHIP_JSON, JSON.stringify(ac, null, 2));

  await page.goto('/?mission=ift-12&test=1');
  await page.waitForFunction(() => window.simReady === true, { timeout: 20_000 });

  let dt = 0.1;
  const maxSim = 6000;
  let secoState = null;

  for (let t = 0; t < maxSim; ) {
    const ticksPerCall = dt <= 0.2 ? Math.round(10 / dt) : 10;
    const step = ticksPerCall * dt;
    await page.evaluate(([n, d]) => window.simStep(n, d), [ticksPerCall, dt]);
    const s = await page.evaluate(() => window.simGetState());
    t += step;

    if (!secoState && s.rocketSECO) {
      const alt_m  = (s.alt ?? 0) * 0.3048;
      const vel_ms = (s.spd ?? 0) * 0.5144;
      const fpa    = s.pitch ?? 0;
      const v_circ = Math.sqrt(MU / (R_EARTH + alt_m));
      secoState = { burnDuration, alt_km: alt_m/1000, vel_ms, fpa, v_circ,
                    delta_v: vel_ms - v_circ,
                    apo_km: apogeeKm(alt_m, vel_ms, fpa),
                    peri_km: periapsisKm(alt_m, vel_ms, fpa) };
      dt = 1.0;
    }

    if (s.starshipSplashdown) {
      return { ...secoState, splashLat: s.lat, splashLon: s.lon, splashT: s.time };
    }
  }
  return secoState ? { ...secoState, splashLat: null, splashLon: null, splashT: null } : null;
}

// ── Scan 3: ldRatio sweep — find lift coefficient that reaches Indian Ocean ───
// Guided reentry (rocket.js) uses mission.reentryGuidance.ldRatio.
// Scan 0.4–1.2 to bracket the value that puts splashdown near lat=-22, lon=115.
async function runSimSplashLD(page, ldRatio) {
  const MISSION_JSON = new URL('../missions/ift-12.json', import.meta.url).pathname;
  const mj = JSON.parse(fs.readFileSync(MISSION_JSON, 'utf8'));
  mj.reentryGuidance.ldRatio = ldRatio;
  fs.writeFileSync(MISSION_JSON, JSON.stringify(mj, null, 2));
  return runSimSplash(page, 342, FPA_RTLS);
}

test('scan 3: ldRatio → Indian Ocean splashdown', async ({ page }) => {
  test.setTimeout(300_000);
  const TARGET_LAT = -22, TARGET_LON = 115;

  const candidates = [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.2, 2.5];
  let best = null;

  console.log('\n--- IFT-12 reentry guidance ldRatio scan ---');
  console.log('ldRatio  splash_lat  splash_lon  T+min   dist°');

  for (const ld of candidates) {
    const r = await runSimSplashLD(page, ld);
    if (!r?.splashLat) { console.log(`ld=${ld}: no splash`); continue; }
    const dist = Math.sqrt((r.splashLat - TARGET_LAT)**2 + (r.splashLon - TARGET_LON)**2);
    console.log(
      `${ld.toFixed(1).padStart(7)}  ` +
      `${r.splashLat.toFixed(2).padStart(10)}  ` +
      `${r.splashLon.toFixed(2).padStart(10)}  ` +
      `${(r.splashT/60).toFixed(1).padStart(6)}  ` +
      `${dist.toFixed(1).padStart(5)}`
    );
    if (!best || dist < best.dist) best = { ...r, ld, dist };
  }

  if (best) {
    console.log(`\n→ Best: ld=${best.ld}  splash lat=${best.splashLat.toFixed(2)} lon=${best.splashLon.toFixed(2)}  dist=${best.dist.toFixed(1)}°`);
    const MISSION_JSON = new URL('../missions/ift-12.json', import.meta.url).pathname;
    const mj = JSON.parse(fs.readFileSync(MISSION_JSON, 'utf8'));
    mj.reentryGuidance.ldRatio = best.ld;
    fs.writeFileSync(MISSION_JSON, JSON.stringify(mj, null, 2));
    console.log('ift-12.json ldRatio updated.');
  }
});

// ── Scan 2: fine burnDuration (dt=0.1) around best from scan 1 ──────────────
// Writes winning config to starship.json.
test('scan 2: fine burnDuration → apogee 195 km', async ({ page }) => {
  test.setTimeout(300_000);

  // Update center value after scan 1; ±8 s in 1 s steps.
  const CENTER = 341;
  const candidates = [];
  for (let bd = CENTER - 8; bd <= CENTER + 8; bd += 1) candidates.push(bd);

  let best = null;
  console.log('\n--- IFT-12 fine scan (dt=0.1) ---');
  console.log('burnDur  SECO_alt  SECO_vel   FPA    apogee    peri    SECO_t');

  for (const bd of candidates) {
    const r = await runSim(page, bd, FPA_RTLS, 0.1);
    if (!r) { console.log(`bd=${bd}: no SECO`); continue; }
    const apoStr  = isFinite(r.apo_km)  ? r.apo_km.toFixed(0).padStart(6)  + ' km' : '  orb+';
    const periStr = isFinite(r.peri_km) ? r.peri_km.toFixed(0).padStart(6) + ' km' : '  orb+';
    console.log(
      `${bd.toString().padStart(7)}  ` +
      `${r.alt_km.toFixed(1).padStart(7)} km  ` +
      `${r.vel_ms.toFixed(0).padStart(7)} m/s  ` +
      `${r.fpa.toFixed(2).padStart(5)}°  ` +
      `${apoStr}  ${periStr}  t=${r.secoT.toFixed(0)}`
    );
    if (!best || Math.abs(r.apo_km - 195) < Math.abs(best.apo_km - 195))
      best = { ...r };
  }

  if (best && isFinite(best.apo_km)) {
    console.log(
      `\n→ Best: bd=${best.burnDuration}  SECO ${best.alt_km.toFixed(1)} km  ` +
      `v=${best.vel_ms.toFixed(0)} m/s  FPA=${best.fpa.toFixed(2)}°  ` +
      `apogee=${best.apo_km.toFixed(0)} km  peri=${best.peri_km.toFixed(0)} km`
    );
    const ac = JSON.parse(fs.readFileSync(STARSHIP_JSON, 'utf8'));
    ac.performance.stages[1].burnDuration = best.burnDuration;
    ac.performance.fpaProfile = FPA_RTLS;
    fs.writeFileSync(STARSHIP_JSON, JSON.stringify(ac, null, 2));
    console.log('starship.json updated.');
  }
});
