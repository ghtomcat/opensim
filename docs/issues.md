# Open issues

Known problems and planned work that isn't done yet. Features live in GitHub issues; this file is for bugs, model limitations, test problems and technical debt. Remove an entry when it's fixed — the commit says what was done.

Failing tests are tracked in [testing.md → Known failures](testing.md#known-failures); the causes behind them live here.

Larger entries follow one shape: **Symptom · Reproduce · Cause · Baseline · Fix · Done when · Affects**. *Cause* says whether it is verified or suspected. Baselines were measured on the date given.

### Reproducing

`tools/probe.mjs` loads a mission in test mode and runs a snippet in the page:

```bash
python3 -m http.server 8080 &                  # repo root; leave running
node tools/probe.mjs <mission-id> <<'EOF'
window.simStep(600, 1/60);                     // n steps of dt seconds
return window.simGetState().alt;               // whatever you return is printed as JSON
EOF
```

`simStep` runs the game loop's own tick (`tickSim` in `core/loop.js`), and in test mode nothing else advances the sim — the page only renders between calls. Turbulence is seeded per mission load, so a snippet gives the same result every run. Many snippets still start from still air:

```js
const m = window.simGetState().mission;
window.simSetState({ mission: { ...m, weather: { ...m.weather, manual: { ...m.weather.manual, turbulence: 0 } } } });
```

---

## Flight model

### Energy stall double-counts the lift deficit
*Found 2026-10-11 · `tickPhysics()` in `core/physics.js`, comment "Energy stall: L < W"*

**Symptom.** Engine-out glides sink hard and oscillate; any attitude slightly below level-flight lift sinks much faster than the force balance predicts.

**Reproduce.** Bf 109, still air (snippet above), 115 kt, 7° nose-up, engine dead, no flare:

```js
window.simSetState({ alt: 600, altT: 100, spd: 115, spdT: 0, pitch: 7, pitchT: 7, vs: -300, gear: true, wow: false, enginePower: 0 });
const vs = [];
for (let i = 1; i <= 26 * 60; i++) { window.simStep(1); const s = window.simGetState();
  if (i % 120 === 0) vs.push(Math.round(s.vs)); if (s.wow || s.crashed) return { vs, end: s.crashReason ?? 'landed' }; }
return { vs };
```
`node tools/probe.mjs wolfskopf-1942` — prints vertical speed every 2 s.

**Cause — verified (code), motivation suspected.** The flight-path equation already contains the deficit: `dγ/dt = (L − W·cos γ)/(m·v) − 0.4·γ + trim`. The energy stall then subtracts again: `vs -= liftDeficit × 120 × 60 × dt` whenever the deficit exceeds 5 %. The pushed-down `vs` becomes next frame's flight-path angle, so the push accumulates while the `−0.4·γ` damping pulls back — oscillation. Added in `bf035f2` (25 Mar), eleven hours after the force balance (`ba4cc38`); most likely because the artificial `−0.4·γ` damping alone holds the sink to ~500 fpm at a 10 % deficit and slow flight felt floaty. The commit message doesn't say.

**Baseline (2026-10-11).**

| Case | Result |
|------|--------|
| Bf 109, 115 kt, 7°, no flare | vs every 2 s: −51, −526, −1389, −1692, −1553, −1333, −1240 … settles ~−1 300 fpm at ~107 kt → hard landing −1 133 fpm |
| Bf 109, same, flare to 15° at 50 ft | touchdown ~−215 fpm (the landing tests rely on this) |
| C172 glide, 8° | 650–800 fpm at 67–69 kt (real C172: best glide 68 kt, ~700 fpm) |
| C172 glide, 4° | settles −900…−1 150 fpm at 85–91 kt, first 4 s −3 258 fpm |

**Done so far.** Made frame-rate independent (scaled by `dt`, identical at 60 fps).

**Fix.** Remove the energy stall; reduce or rethink the `−0.4·γ` damping (real phugoid damping is weak) so the force balance alone sets the sink. Do it together with *Angle of attack = pitch attitude* below.

**Done when.** No lift-deficit term outside the force balance; glide sinks are steady (no oscillation) and plausible — C172 ~700 fpm at 68 kt; `physics.spec.js`, `physics.test.js` (AP altitude hold, ILS tracking) and the landing tests pass, re-tuned where the old behaviour was baked in.

**Affects.** Every aircraft with the full flight model (`manualControl`): all Fly-tab aircraft, also with the AP engaged (applies after the AP pitch command). Not rockets, DC-8. Active only above a 5 % lift deficit: slow flight, engine-out glides, under-pitched approaches, the flare.

### Angle of attack = pitch attitude
*Found 2026-10-11 · `tickPhysics()` in `core/physics.js`, `const alpha = newPitch * DEG`*

**Symptom.** A nose-down attitude gives negative lift: the aircraft falls instead of descending. A normal descent or glide with the nose slightly down cannot be flown.

**Reproduce.** Bf 109, still air, 120 kt, 2° nose-down, engine running:

```js
window.simSetState({ alt: 3000, altT: 3000, spd: 120, pitch: -2, pitchT: -2, vs: 0, gear: false });
const r = []; for (let i = 1; i <= 3 * 60; i++) { window.simStep(1); if (i % 60 === 0) r.push(Math.round(window.simGetState().vs)); }
return r;
```
`node tools/probe.mjs wolfskopf-1942`

**Cause — verified.** `alpha = pitch`. A real aircraft's AoA is pitch minus flight-path angle (α = θ − γ); in a descent γ is negative, so α stays positive with the nose below the horizon. Since March (`ba4cc38`).

**Baseline (2026-10-11).** Bf 109, 120 kt, −2°: vs −6 974, −7 650, −8 315 fpm after 1, 2, 3 s. For reference, Bf 109 level-flight attitudes (2 700 kg, CL_0 0.15, CL_α 5.5): 120 kt ≈ 6°, 100 kt ≈ 9°, 80 kt ≈ 16° (= CL_max, the stall).

**Fix.** Use α = θ − γ in the lift and drag calculation. Changes how every aircraft holds altitude; the AP pitch law (which computes a trim AoA and adds the flight-path angle) needs re-checking.

**Done when.** The reproduce case descends at a moderate rate (hundreds, not thousands, of fpm); level-flight attitudes stay as above; the test suite passes.

**Affects.** Every Fly-tab aircraft, AP and manual.

### High-alpha stall and turbulence are per frame
*Found 2026-10-11 · `tickPhysics()` in `core/physics.js`: `vs -= sf * 800` and `vs += (Math.random() - 0.5) * turb * 300`*

Both apply per frame, not per second — their strength depends on the frame rate. Scale by `dt` like the energy stall. (Turbulence draws from `random()` in `core/random.js`, seeded in test mode, so tests repeat.)

### The ground is flat: the nearer airport's field elevation everywhere
*Found 2026-10-11 · `tickPhysics()` in `core/physics.js` (`_grdElev`)*

**Symptom.** Wherever the aircraft is, "ground" is a flat plane at the field elevation of the nearer airport (departure or arrival threshold, whichever is closer; missions without elevations fall back to `situations[0].alt` or 0). Takeoff, landing, weight on wheels, the ground roll and the AP's ground logic all use it. Real terrain only enters as a crash check, and only where it's more than 100 ft above that field (see *CFIT* in `docs/architecture.md` §7.4).

**Cause — verified (code).** Ground elevation was never taken from the DEM; the DEM arrived later for rendering and EGPWS.

**Consequences.**
- No off-field landing: an engine-out glide into a valley or a field below the airport elevation can't touch down there — it either "lands" in the air at field elevation or flies on until terrain is >100 ft higher and counts as CFIT.
- Terrain within 100 ft of field elevation is invisible to physics: the aircraft can fly through low hills near an airport.
- Midway between two fields of different elevation the ground jumps from one elevation to the other.

**Fix.** Use the DEM elevation under the aircraft as the ground (`core/elevation.js`); near a runway, use the runway elevation (the DEM is too coarse for a landing surface — blend within the airport boundary). Keep the airport-elevation fallback when no DEM tile is loaded.

**Done when.** An engine-out glide over terrain below the field elevation touches down on the terrain; a low pass over hills near an airport crashes on the hill; airport takeoffs and landings are unchanged; the landing tests pass.

**Affects.** Every Fly-tab aircraft; most visible in engine-out and low-level missions. Needs a terrain source in tests (DEM tiles are fetched live).

### `spdT` is both the speed target and the throttle
*Found 2026-10-11 · `tickPhysics()` in `core/physics.js`*

`S.spdT` means two things: on turbofans it's the A/THR target speed (kt); on props it's the power lever — thrust uses `spdT / envelope.cruiseSpd`. The oil-temperature and coolant heat models then compute their own "throttle" as `spdT / envelope.maxSpd` for **every** aircraft: on a jet that's the selected speed, not the thrust (oil temperature follows the FCU speed knob, not N1); on a prop it's a different normalisation than the thrust uses (`maxSpd` vs `cruiseSpd`), so full power reads as 61–87 % of full heat depending on the type (F4U 61 %, Bf 109 84 %).

**Fix.** One explicit power variable per engine (`thrustLever` already exists for jets; props get the same, keyed by the throttle input), used by thrust, oil temperature and the cooling heat input alike; `spdT` stays a speed. **Done when.** No code reads `spdT` as a power setting; the cooling model's heat input follows the same throttle as the thrust; Bf 109 / F4U cooling behaviour re-checked (normal temperatures, coolant leak → seizure timing).

### Turbulence: mission-level and from METAR gusts — enhancement
*Noted 2026-10-11 · `_getWind()` in `core/physics.js`*

Turbulence is read from the active weather source: the `manual` block (15 missions set it, e.g. Wolfskopf 0.4), or `S.metar` for live missions — but a real METAR has no turbulence field, so live missions are always smooth. A value in a live mission's `fallback` would only apply when the fetch fails, which is why `nordmeer-1956`'s fallback `turbulence: 0.3` was removed (2026-10-11).

Ideas:
- **Mission-level turbulence** — `weather.turbulence`, independent of the source, so the author's intent ("a rough Arctic flight") holds whether the weather is live, fallback or manual.
- **Derive it from the METAR** — gusts (`wgst` vs `wspd`) are a reasonable measure; live missions get realistic turbulence on gusty days.
- Keep it reproducible in tests: draw from `random()` (`core/random.js`, seeded in test mode), not `Math.random`.

---

## Rockets

### Ascent fails with 1-second physics steps — also in time warp
*Found 2026-10-11 · `core/loop.js` (`PHYS_DT = 1.0`), `core/rocket.js`*

**Symptom.** Stepped at `dt = 1.0`, the Demo-2 ascent never reaches orbit: SECO comes too low and too fast, and Dragon has fallen to 0 km by separation.

**Reproduce.** Run twice, with `dt = 1.0` and `dt = 0.1`:

```js
const dt = 1.0; let seco = null;
for (let t = dt; t <= 1000; t += dt) { window.simStep(1, dt); const s = window.simGetState();
  if (s.rocketSECO && !seco) seco = { t: Math.round(t), altKm: Math.round(s.alt*0.3048/1000), vel: Math.round(s.spd*0.5144) };
  if (s.dragonSep) return { seco, sep: { t: Math.round(t), dragonAltKm: Math.round(s.alt*0.3048/1000) } }; }
return { seco };
```
`node tools/probe.mjs crew-demo2`

**Baseline (2026-10-11).**

| dt | SECO | At Dragon separation |
|----|------|----------------------|
| 0.1 s | t 694 s, 200 km, 7 788 m/s | t 898 s, Dragon 200 km, Stage 2 200 km |
| 1.0 s | t 721 s, 100 km, 9 083 m/s | t 899 s, Dragon 0 km, Stage 2 −700 km |

**Cause — verified symptom, mechanism suspected.** Demo-2 flies orbit-targeting guidance (`orbitTargetSECO`, `57110f0`), which steers the pitch and cuts off when the periapsis arrives — validated at small steps in `tools/booster-descent-sim.mjs`. At 1 s steps the closed loop likely over-steers / overshoots the cutoff. Not yet traced inside `core/rocket.js`.

**Players are affected (inferred, not yet seen in the browser).** The game loop steps rockets at a fixed `PHYS_DT = 1.0` whenever `dt × warp ≥ 1 s` — from 100× warp up (and next-event warp, `J`). Warping during the ascent very likely ruins it.

**Fix.** Either make the ascent guidance robust at 1 s, or sub-step powered flight finer (e.g. cap the rocket step at 0.1 s while thrusting; coast/orbit can stay at 1 s). Then step the rocket specs at a realistic dt.

**Done when.** The reproduce case gives the same SECO (±1 km, ±10 m/s) at 0.1 s and 1.0 s; a 100× warp through the ascent in the browser reaches orbit; `rocket.spec.js` booster/Dragon tests pass (after the timing fix below).

**Affects.** All rocket missions with time warp; Demo-2 (orbit-targeting guidance) shown, others not yet checked at both step sizes.

### CRS-1 ends at 310 km and 6 km/s — suborbital
*Found 2026-10-11 · `missions/crs1.json`, `aircraft/falcon9-b1.json`*

Same snippet as above on `crs1`: SECO t 770 s, 310 km, 5 974 m/s at `dt = 0.1` (6 048 m/s at 1.0) — circular velocity at 310 km is ~7 730 m/s. Independent of step size. The real CRS-1 reached orbit on 8 engines. Possibly the lofted ascent profile (`6c71e7a`). `rocket.spec.js` "orbit achieved on 8 engines" fails on this.

### Inspiration5 inserts at ~284 × 943 km, not 590 km circular
*Found 2026-10-11 · `aircraft/falcon9-b5-590.json`, `missions/inspiration5.json` (`targetOrbitKm: 590`)*

**Symptom.** SECO at ~287 km with too much velocity — an elliptical orbit with perigee ~284 km. The callouts say "Nominal orbit insertion. 590 kilometres."

**Reproduce.**

```js
const dt = 0.1, MU = 3.986004418e14, RE = 6371000;
for (let t = dt; t <= 900; t += dt) { window.simStep(1, dt); const s = window.simGetState();
  if (s.rocketSECO) { const r = RE + s.alt*0.3048, v = s.spd*0.5144, g = s.pitch*Math.PI/180;
    const a = 1/(2/r - v*v/MU), h = r*v*Math.cos(g), e = Math.sqrt(Math.max(0, 1 - h*h/(MU*a)));
    return { t: Math.round(t), altKm: +(s.alt*0.3048/1000).toFixed(1), vel: Math.round(v),
             perigeeKm: Math.round((a*(1-e) - RE)/1000), apogeeKm: Math.round((a*(1+e) - RE)/1000), e: +e.toFixed(4) }; } }
```
`node tools/probe.mjs inspiration5` (pitch ≈ flight-path angle at SECO).

**Baseline (2026-10-11).** dt 0.1: SECO t 707 s, 286.8 km, 7 917 m/s → 284 × 943 km, e 0.047. dt 1.0: 287 × 1 304 km, e 0.071.

**Cause — suspected.** Inspiration5 still flies its fixed `fpaProfile` and burns to its programmed cutoff; only Demo-2 uses orbit-targeting guidance. When it last met the test (April) is unknown — later changes (stage-sep gap, upper-stage spool-up, ASDS recovery) may have shifted it. `git bisect` with this snippet would find the commit.

**Fix.** Put the 590 km stage on orbit-targeting guidance (`orbitTargetSECO`, as in `falcon9-b5-demo2.json`) targeting 590 km circular.

**Done when.** Perigee 560–630 km, e < 0.05 (the `check_alt.spec.js` bounds) at dt 0.1 and in the browser; deorbit/reentry timing still works.

**Affects.** Inspiration5 only.

### The Earth doesn't rotate in the rocket model
*Found 2026-10-11 · `core/rocket.js` — no rotation rate anywhere in the model*

**Symptom.** Launches get no eastward velocity from the Earth's rotation (~408 m/s at Cape Canaveral, 28.5° N), and after SECO the orbit vector (`S.orbitVec`) is converted to lat/lon as if the Earth were fixed (`atan2(ry, rx)`), so ground tracks don't shift west from orbit to orbit (~22.5° per LEO orbit in reality). The sun position in `display/terrain.js` advances separately, so day/night is right; the track under the vehicle is not.

**Cause — verified (code).** The ascent integrates in an Earth-fixed vertical plane; `_captureOrbitVec()` labels its frame ECEF and the Moon is placed in "ECI", but there is no rotation between them — effectively a non-rotating Earth.

**Why it matters.** The missions still reach their targets, so the ascent tuning (`fpaProfile`, stage data) has likely absorbed the missing ~400 m/s; realistic launch data then won't reach orbit as-is. Possibly related to *CRS-1 ends at 310 km* and *Inspiration5 inserts at ~284 × 943 km* — suspected, not checked.

**Fix.** Treat the orbit state as inertial (ECI); at SECO add the Earth's rotation to the velocity (ω × r, ω = 7.2921e-5 rad/s) and convert ECI → lat/lon with the Earth's rotation angle at mission time. During the ascent, account for the launch-site velocity (or integrate the ascent in ECI too). The booster (RTLS/ASDS) lands on a rotating Earth — check its guidance after. Then re-tune ascent profiles against real data.

**Done when.** A circular LEO ground track shifts ~22.5° west per orbit; Demo-2 still reaches its target orbit with re-tuned (or real) profiles; the rocket specs pass.

### Rocket test timings predate the countdowns
*`tests/rocket.spec.js`* — Demo-2 has a 178 s countdown (`ignitionTime`, since 11 Apr); the booster and Dragon-separation tests check too early (separation is at t ≈ 898 s, the test expects it by 850).

### Demo-2 flies RTLS, but the real booster landed on a droneship — and no mission is left for RTLS
*Found 2026-10-13 · `aircraft/falcon9-b5-demo2.json` (`performance.recovery`), `missions/crew-demo2.json`, `missions/catalog.json`, `tests/rocket.spec.js`*

**Symptom.** Demo-2 is described as "a faithful recreation of the real SpaceX Demo-2 launch" (`fiction_note`), but its booster does a boostback and lands at LZ-1. The real B1058 landed downrange on the droneship *Of Course I Still Love You*, with no boostback. The catalog briefing was updated on 2026-10-13 to the real flight (droneship landing); the mission itself still flies RTLS, so briefing and sim disagree until this is fixed.

**Fix — the mission.**
- `falcon9-b5-demo2.json` → `recovery`: `rtls` → `asds`, with the droneship's real position (`landingLat` / `landingLon`) and entry/landing burns. The sim already supports this — Inspiration5's vehicle uses `asds`. Source the position and the event times (press kit, webcast) instead of estimating them.
- `crew-demo2.json`: clearance #30 ("Stage 1 landing burn. Touchdown confirmed. LZ-1.") → droneship; `description` and `narrative` ("Stage 1 returns / comes home to LZ-1").
- `catalog.json`: title "Crew Dragon Demo-2 · RTLS" → drop "· RTLS". Re-measure the briefing's flight sequence in the sim and give the landing line a time (it reads "T+08:36+" now).
- Check the webcast audio timing against the sim's landing.
- `tests/rocket.spec.js` → *Falcon 9 Block 5 — RTLS booster recovery* (4 tests, already known failures) uses `crew-demo2`: rewrite as droneship tests (booster lands within a set distance of the droneship).

**Fix — a mission for RTLS.** After the switch, no mission flies RTLS: `aircraft/falcon9-b5.json` has `rtls: true` but no mission uses it, and the RTLS model (boostback, LZ-1 landing) would lose its only test. Define a new mission with a real LZ-1 landing (e.g. Orbcomm OG2 Flight 2, December 2015 — the first Falcon 9 landing, or a later CRS flight that returned to LZ-1), and move the RTLS test block to it.

**Done when.** Demo-2's booster lands on the droneship in the sim, its briefing, title and script agree, and an RTLS mission with its own tests exists.

---

## Tests

### DB 601 engine-off tests use an airborne mission
*`tests/db601-sound.spec.js`* — "starts in off state" and "lader gain is zero at engine off" load Wolfskopf, which starts at 2 000 ft with the engine running. Use a ground start (`hahnweide-1944`).

### `egll-approach` is temporarily the 737 MAX 9 into Madrid
*`missions/egll-approach.json`, `tests/physics.test.js`* — two tests expect the EGLL 737-800 ("loads a stable airborne state", "autopilot holds altitude": 726.5 ft off vs < 300, the same every run since 2026-10-12). Restore the mission, then re-check the altitude hold.

---

## Mission loading

### Live flight always loads the A350
*Found 2026-10-11 · `flyWithFlight()` in `index.html` (`const liveMission = { … aircraft: 'a350' … }`)*

`flyWithFlight()` picks an aircraft for the tracked flight with `pickAircraft(flight.icaoType)` (C172 → `c172`, DR40 → `robin-dr400`, PA28 → `c172`, else `a350`) and passes it to `init()`. But the inline mission it builds also sets `aircraft: 'a350'`, and `loadMission()` gives the mission's `aircraft` precedence over the caller's path. So the A350 always loads. **Cause — verified (code), not yet seen in the browser.** The hard-coded `'a350'` dates from `8f2d067` (25 Mar) and was harmless until `37ea9d0` (13 Jun) made the mission JSON the aircraft source of truth. **Fix:** set the inline mission's `aircraft` to the `pickAircraft()` result (or drop the field). **Done when:** tracking a C172 or DR400 loads that aircraft.

### Five screens between mission select and flying
*Found 2026-10-15 · `index.html` (`showBriefing`, `showRoleSelect`, `showScenarioSetup`, `showFlightBriefing`, `init`)*

**Symptom.** After picking a mission the pilot passes up to six screens in sequence, each one dismissed before the next appears:

| # | Screen | Shown for | Dismissed by |
|---|---|---|---|
| 1 | Mission story (`showBriefing`) | every mission | tap |
| 1b | Role select (`showRoleSelect`) | missions with `roles` | card |
| 2 | Scenario setup (weather · crew · failure) | all but launches, live flight, `fixedScenario` | Fly |
| 3 | Flight briefing (route · airport · SID/STAR · navlog · freqs · weather) | glass airliners only (`panel === 'airbus'/'e190'`) | Fly |
| 4 | Loading splash | every mission | waits — incl. ~1.2 s of fixed `sleep()` |
| 5 | Key map (onboarding), **pauses the sim** | all but rockets/robots | key or click |

**Baseline — measured 2026-10-15** (headless Chromium, localhost, direct link, no Mapbox token). The splash is almost all fixed waiting:

| Mission | page modules loaded | `loadMission()` → ready | splash hidden |
|---|---|---|---|
| `lszh-approach` (A350) | 532 ms | 74 ms | 1 930 ms |
| `lszf-pattern` (C172) | 365 ms | 14 ms | 1 712 ms |
| `wolfskopf-1942` (Bf 109) | 599 ms | 11 ms | 1 946 ms |
| `crew-demo2` (rocket) | 343 ms | 36 ms | 1 690 ms |

`init()` itself takes 10–75 ms; the remaining ~1.2 s is the `sleep(400/300/500)` in `init()`. Terrain tiles, the map and large audio (Demo-2 webcast, 2.2 MB) stream in after the splash anyway and don't block. The JS modules and CDN libraries load once with the page, i.e. on the selection screen. So no preload layer is needed — removing the sleeps is the speed-up. (DEM tile timing not measured: headless has no `mapboxToken`; those tiles load asynchronously via `core/elevation.js` either way.)

**Related defect — verified (browser, 2026-10-15); fixed 2026-10-15:** `loadMission(…, setup)` applies the choices before anything reads them; a preset at a station also becomes `S.metar` (`tests/scenario-setup.spec.js`). Was: The setup is applied *after* `loadMission()`: `init()` patches `S.mission.weather` and appends `S.mission.failures` from fields stashed on the catalog entry (`m._weatherOverride`, `m._scenarioFailures`). By then `loadMission()` has started the live-METAR fetch from the mission's own weather. `lszh-approach` with *Overcast 1500*: `S.mission.weather` = OVC 1500, but the METAR is fetched and `S.metar` = live LSZH (FEW 4500, 1020 hPa, 12 kt). The flight follows the preset (wind `_getWind()`, clouds, baro read `S.mission.weather`); what reads `S.metar` shows the live weather — METAR strip, ATIS, the tower's wind in the landing clearance (`display/com.js`).

**Fix.** Select → **one briefing page** → Fly.
- One page with the story, the scenario setup (and role) and — where the mission has them — the flight-briefing tabs, plus a Controls tab; one Fly button. Sections appear only when the mission has them. **Done 2026-10-16:** `showBriefing()` in `index.html` is the one page: the main content by `briefingLayout()` — scanned orders, the airliner's charts, or the story text — and a strip with a chip per choice (Weather · Crew · Failure · Controls, each a popover) and Fly (Enter). `setupChoices()` reads the mission and aircraft files: no weather or engine failure for launches, rockets and the robot labs (was: shown, since the catalog entry has no `phase`); carb icing from the aircraft's `hasCarbHeat`; no Controls for rockets and labs. The parameters are in sentence case, the start altitude is labelled *Start · Altitude* (was *CRUISE* "FL040"), and empty blocks are hidden (was: an empty DEPARTURE). `tests/briefing.spec.js`.
- Fly passes the setup (weather, failures, role) *into* `loadMission()` as an argument — no patching after the load, no stash on the catalog entry. Remove the fixed sleeps — done 2026-10-15: the splash fades over the running sim; a direct link is ready after 0.4–0.8 s instead of ~1.9 s. Per the baseline, no preload layer is needed (the briefing page may still fetch the mission/aircraft JSON it displays).
- The key map stops blocking: Controls tab in the briefing, `?` in flight, and a key-map hint that fades out without pausing — once per aircraft after the briefing, **every time** after a direct link.
- **Direct links (`?mission=…`) go straight in** — no briefing, mission defaults for the setup. They come from anywhere: the Zeitanker book links its story straight to the Wolfskopf mission (https://zeitanker-trilogie.ch/episode3_en.html), which must start right away; tests and shared links rely on it too. With no briefing page to show progress, a direct link keeps a minimal loading indicator (no fixed sleeps).
- The new page is its own module (`app/briefing.js`, next to `app/session.js`) — a first piece of *`index.html` carries most of the application wiring*.

**Done when.** Select → briefing → Fly for every mission; a direct link starts the mission right away with the key-map hint; the full-screen splash (except the direct-link indicator) and the blocking key-map overlay are gone; a manual weather preset on a live-weather mission flies with the preset (no METAR fetch); the test suite passes.

---

## Navigation

### Geneva → Munich routes 470 nm, with no STAR
*Found 2026-10-16 · `buildFullRoute()` in `core/route.js`, `routeAirway()` in `core/airway-graph.js`, `missions/lsgg-takeoff.json`*

**Symptom.** The briefing's route tab for `lsgg-takeoff` (LSGG 22 → EDDM 26L) shows 470 nm in 17 legs, for about 263 nm great-circle. The line runs far north and zigzags before it reaches Munich. The ND and LNAV fly the same route, since it comes from one place (`core/flightplan.js`).

**Legs (verified, browser, 2026-10-16).** SID KONI4D to KONIL (46.57, 6.46), then the airway part: KARLU (48.97, 8.55) — one 167 nm leg north to near Karlsruhe — GBL (49.64, 9.95), DKB (49.14, 10.24), VADRU, BUGEK, ANELA (49.77, 11.22), EKSOS, DOSIS (49.24, 11.41), then straight into the approach: NELBI, FI26L, EDDM. `star` is `null`.

**Cause — not yet verified.** Two things to check:
- No STAR for EDDM 26L: `arrStarOptions()` returns nothing, so the airway part aims at the runway instead of a STAR entry, and its path ends north of Munich at DOSIS.
- The airway part: KONIL → KARLU looks like a jump to the nearest graph node, not an airway segment, and the path north of 49° N is a detour (via Würzburg / Nürnberg).

**Done when.** The `lsgg-takeoff` route uses an EDDM STAR and is close to the real-world Geneva → Munich distance (roughly 280–330 nm); a test in `tests/` holds the distance.

### One engine per aircraft
*Found 2026-10-11 · `S.engineState`, `S.enginePower`, `S.n1` (single values)*

**Symptom.** Whatever `engine.count` says, the engine is one `engineState`, one `enginePower`, one `n1`. `core/electrical.js` builds "per-engine" generators from the shared N1; `core/hydraulics.js` drives both engine pumps from it ("approximated with shared N1"). Thrust is one force on the centreline.

**Why it matters.** Engine-out on a twin can't be simulated: engine failure after V1, single-engine climb, the engine-out departure procedure (EOSID), asymmetric thrust and rudder, single-engine approach and go-around — the core of multi-engine training and of the abnormal-procedures backlog. Also per-engine start sequences, a single engine fire, and generator/pump loss of one engine.

**Design — agreed 2026-10-18.** One owner for the engines, and the three engine issues become one piece of work (this entry, *Engine start completes when the start-up sound finishes* — done 2026-10-18 — and *`enginePower` has many writers and no composition* — done 2026-10-18). The cockpit side of it is the first instance of *The cockpit builds itself from the aircraft data*.

*Decisions.*
- **Owner:** `core/engine.js` is the only writer of `S.engines[]`, sized by `engine.count`; a single-engine aircraft is an array of one. Each entry has a shared core (`state`, `lever`, `reverser`, power factors) plus fields for its engine type. Other modules change an engine only through `engine.js` commands (master, start, cut-off, fire handle).
- **The APU is an engine.** A single-spool gas turbine with a start sequence, core speed, EGT and fire handle: an entry of type `apu` in `engine.js`, same lifecycle code, its own parameters. Its state machine moves out of `core/electrical.js`.
- **Full engine model, kept simple.** First-order curves, like the cooling model; no thermodynamic cycle.
  - Turbofans have a **fan %** (N1) and a **core %** state. The core is the spool the starter turns and the accessory gearbox sits on: N2 on a two-spool engine, N3 on a three-spool one. On a three-spool engine the middle spool is computed between the two; nothing we model is driven by it.
  - The core drives the start (starter → light-up at ~20 % → N1 follows) and every gearbox-driven generator and pump. A windmilling failed engine (fan up, core low) therefore loses its generators and pumps.
  - EGT gives hot starts, the redline and fire/stall cues. FF is computed from thrust.
  - **A geared fan changes no numbers:** the reduction gear (~3 : 1 on the PW1000G family) is a fixed ratio, so fan % and low-pressure spool % are the same value. `fanGear` only feeds the sound (lower fan tone, higher turbine whine) and the documentation. GTF-specific start behaviour (dry motoring against a bowed rotor) is start-sequence data.
  - Data per engine type in the `engine` object, e.g. `"spools": 3, "fanGear": null, "display": ["N1", "EGT", "N3", "FF"]` (the ECAM labels), plus idle fan/core %, spool times and EGT limits from published limits. Trent XWB (A350) is three-spool; CFM56, GE90 and PW1500G/1900G (geared) are two-spool; the D-18T (An-225) three-spool; the NK-12 (Tu-95) is one spool driving a propeller gear.
  - Pistons keep RPM/MAP/EGT/CHT/FF; electric keeps RPM/power/current.
- **Power is a product of factors, each owned by its cause:** `power[i] = fuel × failure × ice × seizure × battery`, set through `engine.js` (e.g. `setEngineFactor(i, cause, value)`). No module assigns power directly.
- **Systems point at engines, not the other way round.** The electrical and hydraulic layouts are per-aircraft JSON; each source names its `driver` (`"eng1"`, `"apu"`), and a gearbox unit is always driven by the core. `engine.js` knows nothing about generators or pumps; it publishes state and core %. Sketch for the A350 (two VFGs per engine; GREEN + YELLOW at 5000 psi, two engine-driven pumps per engine plus an electric pump each):
  ```json
  "electrical": { "sources": [
    { "id": "gen1a", "type": "vfg", "driver": "eng1" }, { "id": "gen1b", "type": "vfg", "driver": "eng1" },
    { "id": "gen2a", "type": "vfg", "driver": "eng2" }, { "id": "gen2b", "type": "vfg", "driver": "eng2" },
    { "id": "apugen", "type": "gen", "driver": "apu" }, { "id": "ext", "type": "ext" } ] },
  "hydraulics": { "systems": [
    { "id": "green",  "psi": 5000, "sources": [{ "type": "edp", "driver": "eng1" }, { "type": "edp", "driver": "eng1" }, { "type": "emp" }] },
    { "id": "yellow", "psi": 5000, "sources": [{ "type": "edp", "driver": "eng2" }, { "type": "edp", "driver": "eng2" }, { "type": "emp" }] } ] }
  ```
- **One system description, three readers:** the simulation (`core/`), the controls (overhead, pedestal) and the ECAM synoptic pages (ELEC, HYD) all read the same layout, so they can't disagree.
- **Rudder keys:** `,` / `.` (springing back to centre), rudder trim `<` / `>`; on the ground they also steer the nosewheel. Gamepad axis 2 (already mapped to rudder) also works in flight.
- **First engine-out aircraft: the A350.** It is data-driven already (`dimensions` from the airport-planning drawing; the engine lateral positions still have to be measured), its real cockpit has the Airbus ECAM the sim draws, and its yaw moment is large. Its only mission (`lszh-approach`) starts airborne, so the V1 cut needs a new LSZH departure mission. Later: the A320 (data-driven build) and a DA42 (light twin: critical engine, V_MC, the multi-engine rating).
- **Out of scope:** bleed air/pneumatics and fuel for the jets (tanks → engines, crossfeed). They fit the same layout pattern later; until then the overhead shows no buttons for them. FF is computed, so the fuel system can use it later.

*Against the layers (architecture.md, bottom-up).*
- **Data (§3).** `engine` becomes an object on every aircraft; the string moves to `engine.model` (closes the `engine` part of *Overloaded fields*); Tu-95 and An-225 get `count: 4` / `6`. Engine positions for the yaw moment come from `dimensions` (mm, the source of truth), **not** from the render field `geometry.engineY`. `electrical`, `hydraulics`, `apu` and the fire protection (agents per engine / APU) become per-aircraft blocks; the current `electrical {extPwrB, batCount}` and the A340 layout hard-coded for every turbofan go. New names (`engine_fire`, `flameout`, source and system types) go in `core/vocab.js`; a failure entry gets an `engine` index in `core/schema/`.
- **State and loop (§6).** `S.engines` is replaced whole on each write (`setState` is shallow). During the migration `engine.js` also writes `S.engineState` / `S.enginePower` / `S.n1` as values derived from the array, so readers can move over one by one; they're dropped at the end. Reset through `onMissionReset`; the airborne-start defaults move from `mission.js` into the engine reset. Tick order: `tickFailures` → `tickFuel` / `tickBattery` (factors) → **`tickEngines`** (engines + APU) → `tickElectrical` / `tickHydraulics` (read core %) → `tickPhysics` (reads thrust).
- **Physics (§7).** The turbofan N1 spool and the `starting → running` / `shutdown → off` transitions move out of `tickPhysics()` into `engine.js` (done 2026-10-18). The A/THR stays in automation and only produces a lever/N1 command (`S.n1Cmd`, `tickThrust` in `core/thrust.js`, done 2026-10-18) — later for all running engines. Thrust and reverse thrust are summed per engine, on the ground too (asymmetric reverse, a rejected takeoff on one engine). A new yaw axis: a sideslip state, directional stability, sideslip drag and side force, rudder authority, and a thrust moment = Σ thrust × lateral arm. V_MC then comes out of the data. Goes with the split in *`tickPhysics()` is one 680-line function*. Prop throttles move to the lever, which also fixes *`spdT` is both the speed target and the throttle*.
- **Systems (§9).** Electrical and hydraulics read their layout from the aircraft and their drivers' core % from `engine.js`. Failures target an engine index; fuel starvation and an empty battery become factors.
- **Automation (§10).** The A/THR drives running engines only. What the autopilot does about yaw (fly-by-wire compensation vs. the pilot trimming rudder) is per-type data — check the A350's flight-control laws. Engine-out speeds, drift-down and the EOSID belong to the training stage.
- **Sound (§11).** `sound.js` follows `S.engines[]` and writes no engine state. One shared AudioContext (`core/audio.js`, done 2026-10-18), so starting ENG 1 doesn't cut ENG 2's start sound. Later, one voice per engine (or per side), panned; `fanGear` sets the fan and turbine tones.
- **Input and recording (§12).** Rudder in `core/input.js`; `keybindings.md` updated. `E` doesn't start an airliner (2026-10-18): the start is the cockpit procedure — power, ENG MODE IGN/START, one ENG MASTER at a time — and an automatic start from the keyboard would first have to check the whole aircraft (power, mode, fuel). `Q` cuts all engines; single engines are started and stopped from their own controls. Telemetry and the black box record the engine array and log per-engine events.
- **Display (§13).** Engine controls are derived from the engine entries, generators and pumps from the system layouts; each control is *node + action* and sends a command to its owner instead of writing `S` (see *The cockpit builds itself from the aircraft data*). ECAM ENGINE page (`display/ecam.js`) and the engine widgets in `pfd_instruments.js` read per engine, labelled from `engine.display`; a failed engine is amber. ELEC and HYD pages are drawn from the layouts. The outside view spins each fan and deploys each reverser separately. `velis_epsi.js` no longer writes `engineState` (done 2026-10-18: the motor follows its switches in `engine.js`).
- **Shell (§14).** The `E`/`Q` handlers call `engine.js`; `simGetState()` exposes `engines`. Engine-out scoring doesn't go into `index.html` (*`index.html` carries most of the application wiring*).

*Stages.*
0. **Owner, still one engine.** `core/engine.js`: lifecycle out of `sound.js` and `velis_epsi.js` (done 2026-10-18: sim time, `engine.startTime` / `stopTime`, `sound.js` follows the state), the APU lifecycle out of `electrical.js` (done 2026-10-18: `apuMaster` / `apuStart` / `apuFire`, `apu.startTime` in the data, `sound.js` follows `apuState`), power from factors (done 2026-10-18: `S.engineFactors` + `setEngineFactor()`, `enginePower` computed in `engine.js` only; fixes the cold-and-dark power of 1), N1 spool out of `physics.js` (done 2026-10-18: the A/THR command in `core/thrust.js` `tickThrust`, the spool in `engine.js`). `engine` an object everywhere (done 2026-10-18). One AudioContext (done 2026-10-18). Done when: a cold start completes via `simStep` with audio muted; no module but `engine.js` writes engine or APU state. **Stage 0 done 2026-10-18** (both checks met).
1. **The array.** `S.engines[]` by `count`, old fields derived from it. Done when: every aircraft flies the same seeded test runs as before.
2. **Per-engine control and failure, electrical layout as data, no yaw yet.** Masters, levers, fire handles and failures by engine; the full turbofan model (fan/core/EGT/FF); the A350 electrical layout in JSON, read by the simulation, the overhead and the ELEC page; engine controls derived and sending commands. Done when: an A350 loses ENG 1 at V1 (new LSZH departure), climbs on ENG 2 with less climb rate, the ECAM shows ENG 1 failed and GEN 1A/1B offline, and the overhead shows exactly the A350's generators.
3. **Yaw axis.** A350 engine lateral positions measured into `dimensions`; sideslip, rudder (keys + gamepad), rudder trim, thrust moment. Done when: an engine failure yaws the aircraft toward the dead engine, rudder holds it, and full rudder below V_MC can't.
4. **Hydraulic layout as data.** The A350 first (GREEN/YELLOW), same three readers. Done when: losing ENG 1 drops GREEN's engine pumps only, and overhead and HYD page show the A350's two systems.
5. **Sound and outside view per engine.**
6. **Training.** V1-cut mission, ENG FAIL procedure and callouts, engine-out climb and EOSID, single-engine approach and go-around, scoring (see the training-procedures backlog).

**Done when.** A twin can lose one engine (failure or fuel cut) and keep flying on the other with the expected yaw and climb loss; the ECAM/EICAS shows the failed engine; single-engine aircraft behave as before.

### Airliner electrical and hydraulics are display-only — not implemented yet (intentional)
*Noted 2026-10-11 · `core/electrical.js`, `core/hydraulics.js`*

Bus states (AC/DC/essential, generators, APU, external power, batteries) and hydraulic pressures (GREEN/BLUE/YELLOW) are computed every frame, but only the ECAM, overhead, pedestal and PFD read them. Nothing in the simulation depends on them: gear, flaps, brakes, flight controls, autopilot, displays and COM keep working with all buses and hydraulics dead. **Status: intentional for now** — the systems are modelled for the cockpit first; coupling them to the simulation is future work.

When it's taken up: decide which consumers depend on which bus/system (e.g. COM on DC ESS, gear and flaps on hydraulics, displays on AC), replace the per-panel COM power check in `core/crew.js` with the bus state, and make the hydraulic layout per aircraft (next entry).

### Light-aircraft electrical is switches only — not implemented yet
*Noted 2026-10-18 · `masterBat`, `masterAlt`, `avionicsOn` in `core/state.js`; `core/engine.js`, `core/crew.js`, `display/panel_renderer.js`, `display/outside.js`*

The C172, DR400 and Velis switches are plain fields: no battery charge, no alternator, no bus. Each consumer checks the switch itself — the COM (`_isComPowered()` in `core/crew.js`), the G1000 screens (`panel_renderer.js`), the C172 lights (`outside.js`) and, since 2026-10-18, the electric starter (`startEngine()` in `core/engine.js`: an `engine.starter: "electric"` needs BAT on). The checks are right as far as they go; what they can't catch: a flat battery, a battery run down by cranking too long or flying with the alternator off, avionics or lights on a dead bus, an alternator failure (a classic training failure). **Fix:** a small electrical model for light aircraft from the aircraft data — battery (capacity, charge), alternator (driven by the engine RPM, `masterAlt`), one bus with its consumers (starter, avionics, COM, lights, fuel pump) — the same pattern as *The cockpit builds itself from the aircraft data*: the consumers read the bus, not the switches. Takes in *Velis COM ignores its power switches*. **Done when:** on the C172 a long crank with the alternator off flattens the battery, the starter then won't turn and the G1000 and COM go dark; an alternator failure can be injected.

### Velis COM ignores its power switches — panel name mismatch
*Found 2026-10-13 · `_isComPowered()` in `core/crew.js`*

`_isComPowered()` powers the COM on the Velis only with MASTER + BATT EN + AVIONICS on — but it checks `panel === 'velis'`, and the Velis has `panel: "velis-epsi"` (the value `index.html` and `display/pedestal.js` compare against). The branch never matches, so the Velis COM is always powered: the switches don't cut it, and a `com_active` clearance trigger can't wait for the pilot to switch the avionics on. **Cause — verified (code); not yet seen in the browser.** **Fix:** compare against `'velis-epsi'` — better, take panel names from shared constants (data-contract stage 3), so a mistyped name can't compile in silently; longer term the COM power belongs to the electrical system (see *Vehicle- and mission-specific special cases in generic core modules*). **Done when:** on the Velis, the COM is silent until MASTER, BATT EN and AVIONICS are on.

### Smaller systems items
*Found 2026-10-11*

- **One hydraulic layout for all turbofans.** `core/hydraulics.js` is the A340's GREEN/BLUE/YELLOW for every turbofan — also the A220, the Boeings (737: A/B/standby) and the E190 (systems 1/2/3). Make the systems per aircraft (JSON) when the hydraulics get coupled to the simulation.
- **`BURN_DEFAULTS` keyed by unused engine types.** `core/fuel.js` has `lycoming-o320` and `r-2800`, but no aircraft uses those engine types (the DR400 is `lycoming-o360`, the F4U `radial-2000hp`); all four fuel aircraft set `fuelBurn` explicitly, so the defaults are never used. Remove them or key them correctly.
- **"Battery" means two things.** `core/battery.js` is the Velis propulsion battery (`batteryCharge`); airliner batteries are `bat1..3` inside `core/electrical.js`. Rename (e.g. `tractionBattery`) to keep them apart.

---

## Input, recording and external links

### The hub drops `CART_JOG` messages
*Found 2026-10-11 · `server/hub.js`; `sendCartJog()` in `core/hil.js`; `server/robot_bridge.js`*

`sendCartJog()` sends `{ type: 'CART_JOG', room, dx, dy, dz, speed }` and `robot_bridge.js` handles `CART_JOG` (forwards it to the ESP32 IK solver), but `server/hub.js` relays only `STATE_PATCH` and `CREW_EVENT` — every other type is ignored. **Cause — verified (code), not yet tried with hardware.** Cartesian jogging of the SO-101 can't work through the hub. **Fix:** relay any message type with a `room` to the other room members (the hub doesn't need to know the types), or add `CART_JOG` to the relayed types. **Done when:** a Cartesian jog from the sim reaches `robot_bridge.js`.

### HIL room names don't match by default
*Found 2026-10-11 · `hilInit()` in `core/hil.js`; `ROOM` in `server/robot_bridge.js`*

The browser always joins room `hil-corsair` (`index.html` calls `hilInit(hubUrl)` without a room; there is no URL option), while `robot_bridge.js` defaults to `ROOM=so101-hil`. With defaults, sim and arm sit in different rooms and never see each other; it only works with `ROOM=hil-corsair node server/robot_bridge.js`. **Cause — verified (code).** **Fix:** a `?hilRoom=` URL option, and a room default derived from the mission (e.g. `so101-workspace` → `so101-hil`), or the mission JSON names its HIL room. **Done when:** `npm run hub` + `node server/robot_bridge.js` + `?hil` on the SO-101 mission connect without extra settings.

### Multi-crew — not implemented yet
*Noted 2026-10-11 · `server/hub.js`, `core/state.js` (`role`, `roomId`), `missions/catalog.json` (`roles`)*

The pieces exist but aren't connected: the hub supports rooms and relays `STATE_PATCH` / `CREW_EVENT`; `S.role` (PF / PM / INSTRUCTOR, cycled with R) and `S.roomId` exist; catalog entries list roles. But the only WebSocket client in the browser is `core/hil.js` (hardware). No state is shared between two browsers, nothing sends `CREW_EVENT`, and `S.role` only changes what the PFD label shows. **Status: not implemented yet** (training roadmap: PF/PM/instructor).

When it's taken up, decide: who owns the simulation (one authoritative browser — likely the PF or the instructor — others mirror), which state is shared (controls per role vs. full state), how crew audio and ATC are synchronised (`CREW_EVENT`), and what the instructor can inject (failures, weather, ATC). Builds on the one shared tick (`tickSim` in `core/loop.js`) and the flight-plan state (`S.flightPlan`, `core/flightplan.js`).

### The black box is not tamper-evident
*Found 2026-10-11 · `downloadBlackbox()` in `core/blackbox.js`*

The header describes the recorder as "tamper-evident". The download appends `{ type: 'sha256', hash }` computed over the content in the browser with `crypto.subtle.digest` — no key, no signature. Anyone can edit a recording and recompute the hash; the hash only detects accidental corruption. Records are also kept in `localStorage`, editable from the console. **Why it matters:** once recordings are used for training scoring, debriefs or certification evidence, they need to be trustworthy. **Fix (when needed):** sign on a server (HMAC or a signature with a server-held key), or stream events to a server as they happen. Until then, change the header to say "fingerprinted" rather than "tamper-evident". **Done when:** the doc comment matches what the code guarantees; if signing is added, an edited file fails verification.

### Telemetry buffer grows without limit in sim time
*Found 2026-10-12 · `tickTelemetry()` in `core/telemetry.js`; `_persist()` in `core/blackbox.js`*

`tickTelemetry(warpDt)` appends a row to `_buf` every 0.5 s of **sim** time and never drops one. A long warped mission fills memory: Apollo 8 (~147 h) → ~1 million rows of ~40 fields. **Cause — verified (code); seen under test:** during stage 1 of the tick refactor, three headless Chromium tabs running rocket specs to t ≈ 330 000 s grew to 7.8 / 7.3 / 3.4 GB on a 16 GB Mac; macOS swapped until WindowServer's watchdog killed the login session (`WindowServer_2026-10-12-201641….userspace_watchdog_timeout.spin`). Tests no longer start either recorder (`_isTestMode` gate in `init()`), so this is now a player-only issue. **Related:** the black box `_persist()` re-serialises the whole record list into `localStorage` on every 5 s snapshot — quadratic in session length. In the game it ticks in real time, so it stays small; under sim-time stepping it was measured at +15 ms per 2 000 sim-s chunk per 1 000 s already elapsed. **Fix:** cap `_buf` (ring buffer of the last N hours, or decimate older rows); persist the black box at most every few real seconds, or append-only. **Done when:** a full Apollo 8 flight at warp keeps the page under a fixed memory bound, and `downloadTelemetry` still exports the recent trace.

### No single key map
*Found 2026-10-11*

Keys are handled in about six places: `core/input.js` (flight controls, AP, warp, role, …), `index.html` (5 `keydown` listeners: cockpit zones, telemetry download, Tab page cycling, onboarding, …), `display/outside.js`, `display/com.js`, `display/robot_arm.js`, `display/yertle_quadruped.js`. The same key can mean different things depending on aircraft and view (R = right console or role), and `docs/keybindings.md` has to be kept in step by hand. **Why it matters:** conflicts are hard to see; remappable controls, a cockpit-hardware key mapping, or a generated key reference need one table. **Fix:** one key map (key → action id, with conditions such as `views` or vehicle type) and one dispatcher; modules register actions, not listeners. **Done when:** a single `keydown` listener dispatches all keys; `docs/keybindings.md` can be generated from the map.

---

## Display

### `renderTerrain()` is one 2,840-line function
*Found 2026-10-11 · `display/terrain.js`, `renderTerrain()` (line 653 to ~3,490)*

`renderTerrain(canvas, options)` draws the whole world for every camera in one function: sky, twilight, stars, sun and moon, the Earth globe, the DEM ground grid, water, city lights and roads, every airport element (runways, taxiways, aprons, lights, holding points, signs, stands, terminals, jet bridges, satellites, towers, windsocks), clouds, haze, mission effects, the cockpit frame and overlays — sharing local projection state across all of it.

**Why it matters.** It's the largest function in the project; every scenery change lands in it; nothing in it can be tested or profiled per layer.

**Fix.** Keep `renderTerrain()` as an orchestrator over a shared view object (projection, pose, time of day, DPR) and move each layer into its own function/module: `sky`, `celestial`, `globe`, `ground`, `water`, `nightLights`, `airport/*` (runways, lights, signs, buildings), `weather` (clouds, haze), `cockpitOverlay`. Behaviour-preserving first, checked with before/after screenshots per camera mode. **Done when.** No function in `terrain.js` above ~300 lines; the outside views match the pre-split screenshots.

### Prop and warbird 3D models are code, not data
*Found 2026-10-11 · `display/outside-c172.js`, `outside-b109.js`, `outside-f4u.js`, `outside-mig15.js` (+ `outside-pp.js`)*

Airliners are built from the aircraft JSON (`_acGeoFromJson()`, data-driven from `dimensions`, see *Aircraft geometry is derived when authored*). The C172/DR400, Bf 109, F4U and MiG-15 are hand-authored vertex/face arrays inside JS modules, scaled to true size by a per-type constant (`_S172`, `_SB109`, `_SF4U`); their camera and gear fields in the JSON (`nose.tipX`, `geometry.tailX`, tire radii) must be kept in step with that constant by hand. Adding a new GA aircraft or warbird means writing a module.

**Fix.** Extend the data-driven method to props: a `dimensions` block from real drawings plus parametric builders for fuselage, wing, tail, cowling/radial, prop — the way `outside-wb.js` builds airliners — so the geometry lives in the aircraft JSON. Migrate one aircraft at a time (C172 first), comparing screenshots. **Done when.** The four prop/warbird modules are gone; their shapes come from JSON; per-type scale constants no longer exist.

### Display lag only on the glass instruments
*Noted 2026-10-11 · `display/smooth.js`*

`smooth.js` gives needles and tapes first-order lag (instruments that move with inertia read as real). Only `display/pfd_instruments.js` uses it. Pending on the steam gauges and GA panels: `bf109.js`, `f4u1a.js`, `velis_epsi.js`, `g1000.js`, and the analog widgets in `panel_renderer.js` (DR400, G1000 standby). **Done when.** Every needle and drum display eases through `smooth.js` with a per-quantity time constant.

### The pause hint depends on the panel
*Found 2026-10-15 · `display/bf109.js`, `display/f4u1a.js`, `display/velis_epsi.js`, `display/pfd.js`, `display/outside.js`*

Each cockpit panel draws its own pause hint when `S.paused`: "PAUSE [P]" in `bf109.js` and `f4u1a.js` (twice each, one per layout) and `velis_epsi.js`, "PAUSED [P] to resume" in the fallback `pfd.js`, "⏸ PAUSED" plus the orbit-camera hints in `outside.js`. The glass airliners (`panel_renderer.js`: A350, A340, 737, 777, E190), the G1000/C172 and DR400 cockpits and the rockets draw nothing — a paused A350 just looks frozen. Not a design choice: the hand-drawn panels each got a copy (same pattern as *Gauge helpers copied between the hand-drawn panels*). **Fix:** one pause indicator in the shell — an element in `index.html` shown while `S.paused`, the same on every panel and view; remove the copies from the panels. `outside.js` keeps only its orbit-camera hints (drag · zoom · 0 reset), which are specific to that view. Planned with step 5 of *Five screens between mission select and flying* (the non-blocking key map). **Done when:** pausing shows the same indicator on every aircraft and view, and no `display/` module draws a pause text.

### The cloud layer is never drawn
*Found 2026-10-15 · `display/terrain.js` ("Procedural cloud layer from METAR")*

The procedural cloud layer reads `S.weather?.clouds`, but nothing writes `S.weather` — not `loadMission()`, not the METAR fetch, not the scenario setup. So `cloudLayers` is always empty and no cloud is drawn, live or preset; this has been so since the layer was added (`c3cb933`). **Cause — verified (code):** no writer of `S.weather` anywhere in `core/`, `display/`, `index.html`; not yet looked at in the browser. The clouds exist in the data: `S.metar.clouds` (live, the recorded fallback, or a setup preset at a station — `loadMission()`), and `S.mission.weather.manual.clouds` (setup presets). **Fix:** read the clouds from the same source as the wind — `manual` → `weather.manual`, `live` → `S.metar`, else `weather.fallback` (as `_getWind()` in `core/physics.js` and `_windNow()` in `terrain.js` do) — ideally one shared "current weather" helper instead of four copies of that choice. **Done when:** the setup's *Overcast 1500* draws an overcast layer at 1 500 ft, and a live METAR's layers are drawn. See also *Manual weather: the schema doesn't know clouds*.

### External libraries and fonts load from CDNs at start-up
*Found 2026-10-11 · `index.html` `<head>`*

Leaflet 1.9.4 (JS + CSS) and Three.js r134 (+ `STLLoader`, `OrbitControls`) load from unpkg.com; the fonts (IBM Plex Mono, Kalam, Syne) from Google Fonts. The scripts are synchronous `<script>` tags in `<head>`, so a slow or unreachable CDN delays the whole page; offline, the map and robot views fail and fonts fall back. Three.js r134 is old (its `examples/js` globals were removed in later releases), so it can't simply be updated from the CDN either.

**Why it matters.** Public demos on unreliable networks (e.g. the Speck open day), offline use, and not depending on a third-party CDN being up. Note that the live data services (Mapbox, Overpass, METAR, ADS-B — `docs/architecture.md` §4.2) also need the network; an offline mode would need cached tiles too.

**Fix.** Vendor the libraries and fonts into the repo (e.g. `vendor/leaflet/`, `vendor/three/`, `vendor/fonts/`) with their licences, and load them locally. Optionally load Three.js only when a robot mission starts. **Done when.** With the network off, the page loads, the map module initialises, and the robot view renders.

---

## Sound

### F4U Corsair starts up with the DB 605 start-up sound
*Found 2026-10-11 · `startRecording()` in `core/sound.js` (`case 'radial-2800hp'`)*

The check compares against `'radial-2800hp'`, but the F4U's engine type (and every other check in the code) is `'radial-2000hp'`. It never matches, so the Corsair falls through to `_assembleStartup()`, the DB 605 sequence; `_assembleR2800Startup()` is never called. **Cause — verified (code + history).** `21d56de` (14 Apr, Lycoming start-up) changed `'radial-2000hp'` to `'radial-2800hp'` on that line — most likely a typo. **Fix:** `'radial-2000hp'` (in `startRecording()`), and set the F4U's `engine.startTime` to the R-2800 recording, 64.1 s (`tests/engine.test.mjs` fails until the two agree). **Done when:** an F4U cold start (E key, `bougainville-1943` or another ground start) plays the R-2800 start-up. One of the hand-spelled comparisons in *Name comparisons still spelled out by hand*.


### Velis electric motor plays the geared-turbofan sound
*Found 2026-10-11 · `ENGINES` in `core/sound.js`; `startSound('electric')` when the motor runs*

The Velis's `sound.engineType` is `"electric"`, but `ENGINES` has no `electric` preset; `initSound()` / `startSound()` fall back to the geared-turbofan preset (`_preset()` in `core/sound.js`). **Cause — verified (code), not yet heard in the sim.** **Fix:** an `electric` preset (motor whine + prop, no combustion — the removed `edf-hovercraft` preset used `slewTime: 0.04`, "electric motors spool almost instantly"), calibrated against a Velis recording (`docs/sound-calibration.md`). Since 2026-10-13 the fallback is visible: the console warns `[vocab] unknown engine sound "electric"`, and the sound coverage check in `core/sound.js` exempts `electric` with a pointer to this entry. **Done when:** the Velis sounds like an electric motor, and `electric` is no longer exempt from the `ENGINES` coverage check. (An unknown `engineType` already fails the data schema.)

### Comm profile names outside the profile table
*Found 2026-10-11 · `PROFILES` in `core/radio.js`; `missions/crew-demo2.json`*

- **`sband-crew` is planned but not defined yet.** `crew-demo2` sets `characters.crew.commProfile: "sband-crew"`; `docs/audio-chain.md` lists it as *"add when H4n recordings land"*. No effect today — the crew lines are TTS, and TTS ignores profiles — but until it's defined, recordings for the crew would play as `vhf-aviation` (`createRadioChain()` falls back, with a console warning since 2026-10-13). It's on the schema's known list (`core/schema/known.js`). Fix: define it together with the recordings, then remove it from the known list.
- **`broadcast` is valid but special-cased.** It's a dry bypass for narrators, handled by `profileName === COMM_PROFILE.BROADCAST` in `playThroughChain()` instead of being an entry in `PROFILES`. The valid names are in one place now (`COMM_PROFILE` in `core/vocab.js`; the `PROFILES` coverage check exempts `broadcast`). Optional: a `PROFILES` entry with a `bypass: true` flag would remove the exemption.
- **`COCKPIT_PROFILES` in `core/crew.js` lists `cockpit-c172`**, which isn't a radio profile.

**Done when.** Every `commProfile` value in missions/aircraft is a key of `PROFILES`; unknown names fail validation.

### A missing audio clip can stop the `after` chain
*Found 2026-10-12 · `atcClearances` dispatch in `core/crew.js` (the `clr.audio` branch, `_safeSpeak()`)*

**Symptom.** A clearance with `trigger: { type: "after", idx: N }` fires only once clearance N has *ended*. When N's `audio:` clip is missing, the follow-up line never fires. The README promises "If an `audio:` file is missing, the mission falls back to TTS automatically" — the line itself does fall back, but the chain behind it stops.

**Reproduce.** In a checkout without the gitignored `audio/` folder (e.g. a fresh clone or `git worktree add`), run Inspiration5 in test mode for 1 200 s and log `[crew] ATC fire idx=`: 64 clearances fire, against 70 with the clips present. The six missing ones (idx 13, 17, 40, 55, 57, 75) are all `after` triggers whose predecessor has a missing clip (`gl_startup`, `mc_ldgo`, `gl_meco`, `mc_1bravo`, `mc_staging`, `mc_2bravo`).

**Cause — verified in headless Chromium; not yet checked in a real browser.** `_atcEndedAt[idx]` — what `after` waits for — is set by the clip's `onEnded`, or in the fallback by the utterance's `u.onend`. If the utterance never ends normally, nothing sets it: `_safeSpeak()` returns silently when `speechSynthesis` is undefined, there's no `u.onerror` handler, and there's no time-based fallback. Headless Chromium's speech doesn't complete, so the chain stops there; in a real browser it could stop the same way on a speech error or on Chrome's known long-utterance `onend` bug.

**Why it matters.** Anyone who clones the repo has no `audio/` folder, so mission scripts that chain with `after` lose lines silently. Tests can't see the chain either.

**Fix.** Mark the clearance ended on every way speech can finish: `onend`, `onerror`, no `speechSynthesis` (immediately), and a fallback timer from the text length and rate (whichever comes first, once). **Done when.** Inspiration5 without `audio/` fires the same clearances as with it (70), in test mode.

---

## Architecture

### Overview: strong data architecture, weak runtime architecture
*Found 2026-10-11 · high-level review of `docs/architecture.md`*

The data side is disciplined: vehicles, missions, panels and world data are JSON or generated modules, with a config cascade. The runtime side grew feature by feature; each feature reached across whatever layers it needed. Most single entries in this file are symptoms of five patterns, filed below as their own entries:

1. **No owners for state:** *`S` has no field ownership*.
2. **Shared products are recomputed by each consumer:** *Shared products are computed per consumer, not owned once*.
3. **"Vehicle" is a file format, not an interface:** *No vehicle contract*.
4. ~~**A mission has no single start, stop and tick.**~~ **Fixed 2026-10-12:** one `tickSim(dt)` for the loop and `simStep`, a manual clock + seeded turbulence in test mode, a mission session (`app/session.js`) that `init()` and Back stop, and a reset registry (`core/lifecycle.js`).
5. **Model depth is uneven where training needs it:** *The runtime has no seam for training-grade systems*.

The declared layering (data → simulation → presentation → shell) is also not the real one. Display modules do simulation work (see `architecture.md` §13.6), and there is an unnamed fourth layer: the **application** (session, briefing, scoring, live flight), which lives in `index.html` (*`index.html` carries most of the application wiring*).

**Suggested order.**
1. ~~One tick and one mission lifecycle~~ — done 2026-10-12.
2. Owned products in `core/` (route, taxi route, elevation); `core/` no longer depends on `display/` — done 2026-10-13 (`data/`, `core/elevation.js`); taxi route — done 2026-10-13 (`core/taxi.js`); flight plan — done 2026-10-13 (`core/flightplan.js`); left: flat ground.
3. ~~Schema check at load + a test that loads every aircraft and mission~~ — done 2026-10-13 (`core/schema/`, `core/vocab.js`); left: *Overloaded fields in the JSON data*, *Name comparisons still spelled out by hand*.
4. Vehicle contract and per-engine state — when the training work needs them.

### `S` has no field ownership
*Found 2026-10-11 · architecture review (`docs/architecture.md` §6.1, §9.2)*

**Symptom.** `S` is one mutable object with ~170 fields. `setState` is `Object.assign` (~280 calls), and ~110 direct writes sit beside it. No field has a declared owner, so several modules write the same field and the last writer in the frame wins. The comment at the top of `state.js` (only physics, input, mission write) is out of date. On top of that, modules keep private state between frames (fired entries, ramps, caches), cleared by hand-written `reset*()` functions.

**Evidence.** ~~*`enginePower` has many writers and no composition*~~ (done 2026-10-18: `core/engine.js` composes it from factors); ~~*Engine start completes when the start-up sound finishes*~~ (done 2026-10-18: `core/engine.js` owns `engineState`); *The outside view borrows the flight state for its camera*.

**Why it matters.** Correctness depends on the order of the frame loop and of the ~30 closures in the renderer list. A new feature can't tell whose field it is about to overwrite.

**Fix.** Give each field group one owning module (documented in `state.js`, next to the defaults). Others request changes through that owner (e.g. `enginePower` composed from contributions: failure × carb ice × fuel × battery). Displays read only. Optional dev-mode guard: a `Proxy` on `S` in test mode that logs writes from non-owners.

**Done when.** Every field group in `state.js` names its owner; no display module writes `S` except through an owner's API; a test-mode write check passes.

### Shared products are computed per consumer, not owned once
*Found 2026-10-11 · architecture review (`docs/architecture.md` §7.4, §10.1, §10.5)*

**Symptom.** Products that several modules need are rebuilt by whoever needs them instead of being computed once and stored:
- ~~the flight plan~~ — done 2026-10-13: `core/flightplan.js` owns it (`S.flightPlan`); LNAV, VNAV, the ND, the MCDU and the briefing read it, and `setArrivalRunway()` amends it in flight;
- ~~the taxi route~~ — done 2026-10-13: `core/taxi.js` owns it; the map draws it, com.js phrases it, pushback follows it;
- "ground": the field elevation of the nearer airport, recomputed each tick (*The ground is flat*). (The DEM elevation now has an owner: `core/elevation.js`, sampled once per tick — done 2026-10-13.)

**Why it matters.** Copies can disagree, nothing can be amended (no route to re-clear in flight), and a product disappears when the consumer that happens to produce it isn't running.

**Fix.** One rule for new work: a product used by more than one module gets an owning `core/` module that computes it when its inputs change and stores it; consumers read. The single entries above are the instances.

**Done when.** The three instances are closed, and the rule is written in `architecture.md`.

### No vehicle contract
*Found 2026-10-11 · architecture review (`docs/architecture.md` §3.1, §8)*

**Symptom.** One JSON shape and one `S` cover aircraft, rockets and robots, and each vehicle type is handled by `if` branches spread across modules:
- rockets reuse fields with different meanings (`S.pitch` = flight-path angle, `S.spd` = total velocity);
- selectors are inconsistent: `so101.json` and `yertle.json` still carry a top-level `type` no code reads (since the hovercraft removal, `vehicleType` is the only physics selector), `panel: "airbus"` on the Boeings and `"bf109"` on the MiG-15, `engine` as object or string;
- specific ids are checked in generic modules (*Vehicle- and mission-specific special cases in generic core modules*).

**Why it matters.** Each new vehicle kind adds branches in the loop, mission load, sound, displays and crew. The hovercraft's removal (2026-10-12) was partly this cost.

**Fix.** A small contract per vehicle kind, registered by `vehicleType`: `{ initState(aircraft, mission), tick(dt), reset(), fields, display, sound }`. The loop and `loadMission()` dispatch through the registry instead of branching. One selector field (`vehicleType`), required. Rocket-specific quantities get their own names instead of reusing `pitch`/`spd`.

**Done when.** `core/loop.js` and `core/mission.js` have no per-vehicle branches; `vehicleType` is the only physics selector.

### The runtime has no seam for training-grade systems
*Found 2026-10-11 · architecture review (`docs/architecture.md` §7, §9)*

**Symptom.** Model depth is uneven. Sound synthesis, rocket trajectories and airliner geometry are deep; the parts the training roadmap needs are shallow: one engine value per aircraft (*One engine per aircraft*), airliner electrical and hydraulics that only feed displays (*Airliner electrical and hydraulics are display-only*), a point-mass flight model on flat ground.

**Why it matters.** The training procedures backlog (engine-out / EOSID, V1 cut, failure injection, hydraulic loss) needs per-engine state and systems that affect the flight. These aren't missing features to bolt on; there is no place in the runtime where a system's output reaches physics.

**Fix.** Design the seam before the first training procedure that needs it: per-engine state arrays (`engines[i].{state, n1, power}`), and a defined path by which systems produce effects that physics reads (thrust per engine, control authority, gear/flap availability). Builds on *`S` has no field ownership* and the engine owner `core/engine.js` (2026-10-18).

**Done when.** An engine can fail on its own on a twin, and the aircraft yaws and loses thrust accordingly; one hydraulic loss removes one function.

### The cockpit builds itself from the aircraft data
*Noted 2026-10-18 · `display/overhead.js`, `pedestal.js`, `leftconsole.js`, `rightconsole.js`, `centerconsole.js`; `config/`*

**Today.** Only the main panel is data-driven (`panels/*.json`). The overhead is built in code from `engine.count` / `engine.type` and a two-field `electrical` block, with the A340's layout (IDG per engine, GREEN/BLUE/YELLOW pumps, fuel pumps) for every turbofan — wrong on the A350 (two VFGs per engine, no BLUE). The pedestal and the consoles read hand-written token lists (`pedestal: [...]` on the C172, `left` / `right` on the Bf 109); without one, `_pedestalTokens()` derives a list from code rules with panel names spelled out. The centre view is code. Handlers write `S` directly.

**Idea.** The cockpit is built bottom-up, like the airport scenery from the airport graph:

| Layer | Question | Source |
|---|---|---|
| 1. Systems | What does the aircraft have? | Aircraft JSON — engines, APU, electrical, hydraulics, flaps, gear, brakes, radios, FMS, autopilot. The simulation needs it anyway. |
| 2. Controls | Which buttons? | Derived: each system brings its controls (engine → master, lever, fire handle; piston engine → throttle, mixture, magnetos; generator → GEN button; flaps → lever with the `flaps` detents; tanks → selector). |
| 3. Placement | Which zone, in what order? | Rules per manufacturer and class in the config cascade (`config/manufacturers/*.json`, which carries only `comPanel` today). Airbus: engine masters on the pedestal, fire buttons on the overhead; 737: engine start on the overhead, fire handles on the aisle stand; C172: main panel; Bf 109: left console. |
| 4. Look | How does it look? | `panels/styles/` per family; hand-drawn exceptions. |

The aircraft says *what* it has, the manufacturer *where* it goes, the style *how* it looks. The token lists become optional overrides for a type whose real layout differs from its manufacturer's rule.

**What makes it work.** A control is *node + action* (`eng2 · master off`, `gen1a · off`) and sends a command to the module that owns the node (`engine.js`, `electrical.js`, `hydraulics.js`); no control writes `S`. With owners and commands in place, the five zone modules (each with its own HTML, CSS and handlers) become one builder: systems → controls → placement → zone. Builds on *`S` has no field ownership*.

**Limits.** Derived means complete and correct (every control exists, is in the right zone and works), not the exact real panel geometry; a type that needs that gets a layout override. The hand-drawn cockpits (Bf 109, F4U, Velis, rockets) keep their drawings, but their controls can come from the data. The main panel shows instruments, not controls, and stays with `panels/`.

**First instance.** The multi-engine work (*One engine per aircraft*, stages 2 and 4): engine controls, generators and hydraulic pumps on the A350, derived from its data. The rest of the overhead (lights, anti-ice, pressurisation, ADIRS …) follows the same pattern later.

**Done when.** A new airliner that fits its manufacturer's rules gets a complete, working overhead, pedestal and centre view from its systems data alone, with no token list and no zone-specific code.

### Overloaded fields in the JSON data
*Found 2026-10-11 · `aircraft/*.json`, `missions/*.json`; left over from the data-contract work (2026-10-13)*

The data now has a schema (`core/schema/`, checked by `npm test` and at load), but these fields have two meanings, and the schema has to accept both:
- ~~**`engine`** an object on the jets, a descriptive string on the others~~ — done 2026-10-18: one object on every aircraft (`type`, `count`, `model`, `description`).
- **`timeOfDay`** is hours, or a day fraction when < 1 (`display/terrain.js`).
- **A `failures` entry** goes to `core/failures.js` or `core/rocket.js` depending on whether it has a `trigger` key.

**Fix:** one shape each — e.g. `engine` always an object (the description as `engine.model` / documentation), `timeOfDay` always hours, rocket anomalies under their own key. One field at a time; the schema then drops the second shape. **Done when:** none of them needs an `anyOf` in `core/schema/`.

### Name comparisons still spelled out by hand (data-contract stage 3b)
*Noted 2026-10-13 · `core/vocab.js`; comparisons in `core/`, `display/`, `index.html`*

Stage 3a put the shared names in `core/vocab.js` and made the five dispatch points (triggers, rocket events, failures, comm profiles, engine sounds) check themselves against it. The plain comparisons were left for later: about 180 literals like `panel === 'airbus'` (53, in 8 files), `vehicleType === 'rocket'` (48, in 13 files) and `engineType === 'lycoming-o360'` (31, in 3 files), much of it in `index.html`. Each is a place where a typo compares silently false — two are already logged: *Velis COM ignores its power switches* (`'velis'` for `'velis-epsi'`) and *F4U Corsair starts up with the DB 605 start-up sound* (`'radial-2800hp'` for `'radial-2000hp'`). **Fix:** replace them with `PANEL.X` / `VEHICLE.X` / `ENGINE.X` from `core/vocab.js` (a misspelled name throws). The two known typos change behaviour when fixed, so each gets its own commit, not hidden in the bulk change. Can go together with the `index.html` rewrite. **Done when:** `grep -nE "(panel|vehicleType|engineType)\s*[!=]==\s*'" core display index.html` finds nothing.

### Vehicle- and mission-specific special cases in generic core modules
*Found 2026-10-11 · architecture review*

Generic modules branch on specific missions, aircraft and panels by name, instead of reading a property from the data:

| Where | Check | Could be data |
|---|---|---|
| `core/failures.js` `tickFailures()` | `mission.id === 'wolfskopf-1942'` → Niflheim, T+108…124 s | a mission event / `atcClearances` entry |
| `core/sound.js` | `mission.id === 'wolfskopf-1942'` | mission field |
| `core/rocket.js` (2×) | `aircraft.id === 'starship'` | a vehicle capability flag |
| `core/mission.js` `loadMission()` | list of engine types that need a cold start; `panel === 'g1000'` → cold-and-dark switches, `'airbus'`/`'e190'` → lights on | `engine.coldStart`, an initial-switches block per aircraft or config layer |
| `core/crew.js` `_isComPowered()` | `panel === 'velis'` / `'g1000'` → which switches power the COM | the electrical system / aircraft data |
| `core/physics.js` | `panel === 'airbus' \|\| 'e190'` | a capability flag |
| `display/panel_renderer.js` `_drawAnalogASI()` | `const V = { Vs0: 44, Vs1: 53, Vfe: 85, Vno: 128, Vne: 163 }` — the C172's V-speeds; any aircraft using the `analog_asi` widget gets C172 arcs | the aircraft's `envelope` / a `vSpeeds` block, or the widget `config` |

Also in `display/` (`outside.js` 4×, `terrain.js`, `cislunar.js`) — less of a concern there, since display code is type-specific by nature.

**Why it matters.** Each new aircraft or mission needs a code change in a module that should be generic, and it isn't visible from the JSON what the code will do with it. It runs against the cascade in `config/` and the data-driven cockpit `views`.

**Fix.** Move each case into the data (aircraft/mission field or a `config/` layer) as it is touched; no big-bang refactor.

**Done when.** No `mission.id` / `aircraft.id` comparisons in `core/`; `panel` checks replaced by properties.

### Aircraft geometry is derived when authored — derive it at load time
*Decided 2026-10-11 · `aircraft/*.json` (`dimensions` vs render fields), `scripts/rescale-aircraft.py`, `display/outside*.js`*

**Now.** Data-driven airliners (`a340`, `a350`, `b737max9`, `b777-300er`) keep real measurements in `dimensions` (mm), but the renderer reads absolute model-unit fields (`nose`, `wing`, `geometry`, `gear`, `bellyFairing`, `doors`, decal placements …), written by `rescale-aircraft.py --write` or by hand. Of `dimensions` the renderer reads only `windowsBetweenDoor1and2`. So the same fact is stored twice and can drift; editing `dimensions` changes nothing until the script is re-run. (Checked 2026-10-11: `a340` and `a350` agree exactly on length and gear stations.)

**Decision.** Derive the geometry at load time from `dimensions`, so there is one source of truth and drift is impossible.

**What the script actually does** (sets the scope). It does not derive shape from measurements. It scales the hand-authored shape by two factors, `fR` (radial, from `fuselageDiameter`) and `fX` (longitudinal, from `length`), field by field (radial: Y/Z, radii, thicknesses; longitudinal: X stations), and sets `engineLen` from `engineLength`. Shape (nose rings, cockpit panels, nacelle profile, wing planform) is not a measurement and can't come from `dimensions`.

**Fix — outline.**
1. **Split size from shape.** Size = `dimensions` (mm). Shape = stored as proportions — X stations as fractions of `length`, radial values as fractions of the fuselage radius (or as named measurements where one exists: gear stations, wing root, engine gap, fairing).
2. **One load-time resolver** (next to `resolveAircraftConfig()` in `loadMission()`) computes the model-space geometry from `dimensions` × proportions at 1 mm = 1/1 852 000 NM. The renderer reads only the resolved geometry.
3. **A `dimensions` schema.** The keys differ today: `a350` has `mainGearHalfTrack`, `b777-300er` has `mainGearTrack`; `b737max9` nests `engine` / `gear` sub-blocks and has no `length`. The aircraft schema (`core/schema/aircraft.js`) accepts the 3D-model blocks as `open` until then.
4. **Migrate per aircraft, `a340` first** (the reference build). Compare outside-view screenshots before and after; the model must not move.
5. Retire `rescale-aircraft.py`.

**Done when.** For the data-driven aircraft the JSON holds no absolute model-unit geometry; editing a value in `dimensions` changes the model on reload; `rescale-aircraft.py` is gone; the outside views match the pre-migration screenshots.

**Affects.** The four data-driven airliners now; every airliner rolled out to the method later. Props/warbirds keep their scaled hand-authored geometry until they get a data-driven build.

### Gauge helpers copied between the hand-drawn panels
*Found 2026-10-11 · `display/bf109.js`, `display/f4u1a.js`, `display/velis_epsi.js`*

Each hand-drawn panel has its own copy of the gauge-drawing helpers: `_base` / `_bezel`, `_cap`, `_needle`, `_ticks`, `_num`, `_label` (and `_roundRect`, also in `panel_renderer.js`). `_ticks` is identical in `bf109.js` and `f4u1a.js`; the others have drifted slightly (the Velis versions take a colour argument). A fix to one gauge doesn't reach the others, and each new warbird panel adds another copy.

**Fix.** One shared module (e.g. `display/gauges.js`) with the helpers, parameterised where the copies differ (colours, face style); the three panels import it. Check each panel visually before and after.

**Done when.** No gauge helper is defined in more than one file; the three panels look unchanged.

### The outside view borrows the flight state for its camera
*Found 2026-10-11 · `display/outside.js` (e.g. the chase/orbit camera before `renderTerrain(canvas, { outsideView: true, … })`)*

To draw the terrain from the camera, `outside.js` saves the aircraft pose, writes the **camera** pose into `S.lat`, `S.lon`, `S.alt`, `S.hdg`, `S.pitch`, `S.roll`, calls `renderTerrain()`, and restores the saved pose — 38 such writes, every frame, in several camera modes.

**Why it matters.** It works only because nothing else runs in between. An exception between write and restore leaves the camera pose in the flight state — the aircraft jumps, physics continues from there. Any code `renderTerrain()` calls that reads `S` for the *aircraft* (not the viewpoint) gets the camera instead. And the terrain renderer can't be used with any viewpoint other than `S`.

**Fix.** Pass the viewpoint to `renderTerrain()` explicitly (`{ lat, lon, alt, hdg, pitch, roll }`), and have it and its helpers read the viewpoint from that argument; `S` stays the aircraft. `renderTerrain()` already takes an `acPose` option for the aircraft — the same idea in reverse.

**Done when.** `display/outside.js` doesn't write `S.lat/lon/alt/hdg/pitch/roll`; all outside camera modes look unchanged.

### `tickPhysics()` is one 680-line function
*Found 2026-10-11 · `core/physics.js`*

`tickPhysics(dt)` holds, in one function: ground reference, speed limits, ILS deviation and capture, runway-vacate detection, the force model (flight and ground roll), the autopilot (lateral + vertical), the kinematic model, FMA, wind, dead reckoning, crash detection, oil and coolant temperature, thrust reverser, ground spoilers, gear animation and pushback — sharing ~100 local variables, with module-level state for some (`_flapActual`, `_apVsCmd`, `_vsRefAlt`). (The turbofan N1 and the A/THR speed loop moved out on 2026-10-18: `core/thrust.js`, `core/engine.js`.)

**Why it matters.** The flight-model fixes already logged (α = θ − γ, the energy stall, per-frame terms, flat ground) all land in the middle of this function; none of its parts can be unit-tested alone; a change to one concern (e.g. the AP pitch law) can shift another through shared locals.

**Fix.** Split along the concerns, keeping one `tickPhysics()` that calls them in the current order: `ils` (deviation/capture), `autopilot` (targets only), `flightModel` (forces → speed/γ/attitude; ground roll), `navigation` (wind, dead reckoning), `systems` (temperatures, reverser, spoilers, gear), `pushback`, `crash`. Pure functions where possible (inputs → outputs, no `S`), so `node --test` can cover them. Behaviour-preserving first; fix the model issues after.

**Done when.** No single function in `core/physics.js` above ~150 lines; the extracted model parts have unit tests; the test suite passes unchanged.

### `core/crew.js` is a 1,250-line module with many jobs
*Found 2026-10-11 · architecture review*

`core/crew.js` holds: PM altitude callouts, GPWS radio-altitude callouts, reactive terrain GPWS, predictive EGPWS (with the siren synthesis), flap/gear checklist calls, the mission script (`atcClearances`: trigger evaluation, four playback shapes, ambient audio), rocket event detection (~250 lines of edge-tracking state), the approach briefing, takeoff callouts, TTS voice selection, COM power, PTT clicks and radio playback (`playRadio`). About 45 module-level variables carry the state between frames.

**Why it matters.** GPWS/EGPWS is safety logic and belongs with the aircraft systems, testable without audio; the mission script engine is the core of every scenario and the training roadmap (virtual ATC, scoring) will grow it; neither can be tested on its own today.

**Fix.** Split along the concerns: `core/script.js` (atcClearances triggers + dispatch), `core/gpws.js` (callouts + terrain GPWS + EGPWS — decisions only, emitting alerts), `core/rocket-events.js` (event detection), `core/callouts.js` (PM/takeoff/checklist), `core/voice.js` (TTS voices, recordings, radio playback). Behaviour-preserving first. **Done when.** No module above ~400 lines; GPWS and trigger evaluation have unit tests that run without audio.

### `index.html` carries most of the application wiring — needs a structured rewrite
*Found 2026-10-11 · architecture review*

`index.html` is 5 219 lines (220 KB): ~1 750 lines of CSS (17–1768), ~450 lines of markup, and a ~3 000-line module script (2214–5217) with ~60 functions. Beyond wiring `core/` to `display/`, the script holds application logic: mission `init()`, the display routing chain, route building for briefing/ND/MCDU, live flight (`flyWithFlight()`), the debrief, scenario-failure merging, and the test hooks (`window.simStep` / `simGetState` / `simSetState` / `simLoad`). Also the training **scoring**: `_computeApproachScore()`, `_computeEmergScore()` and `showDebrief()` — the evaluation logic the training roadmap builds on, untestable where it is (move it to e.g. `core/scoring.js`, pure functions over the recorded state and `S.emergLog`).

**Why it matters.** Every feature passes through it, and none of it can be unit-tested with `node --test` — only through Playwright. Bugs hide there: *Live flight always loads the A350* went unnoticed for four months.

**Fix — a structured rewrite, not piecemeal.** Plan it as its own piece of work: CSS into stylesheet(s); application logic into modules next to `app/session.js` (the mission session, 2026-10-12) — e.g. `app/init.js`, `app/routing.js`, `app/liveflight.js`, `app/debrief.js`, `app/test-hooks.js`); `index.html` left as markup plus a short bootstrap. Moved logic gets unit tests where it is pure. The Playwright suite is the safety net — it must pass before and after.

**Done when.** `index.html` holds markup and a bootstrap only; no application logic in inline script; the test suite passes unchanged.

---

## Data and docs

### `catalog.json` and mission files disagree
*`missions/catalog.json`* — `egll-approach` (catalog: 737-800 into EGLL; file: 737 MAX 9 into Madrid), `fimp-takeoff` (catalog: Mauritius takeoff; file: Zürich Dock E) and `anchorage-bozeman` (catalog: "Anchorage → Bozeman", from Anchorage PANC; file: "Bozeman → Anchorage — ILS 15 (temp approach)", departing Bozeman — the direction is reversed). Also `lszh-approach`: the briefing line says "LSZH · RWY 28 · ILS 110.300" (the same text as the `egll-approach` card — likely copied), the mission's ILS 28 is 109.900 (found 2026-10-15). The card's labels (title, location) may differ from the mission by design, but these describe a different flight. Only the aircraft is checked automatically (`tests/data-schema.test.mjs`; `egll-approach` is on its known list).

### Inspiration5 description says "Stage 1 returns to LZ-1"
*`missions/inspiration5.json`* — the booster now lands on the droneship (ASDS). Its catalog briefing still says so too: `orders` lists "T+02:53 Boostback burn" and "T+08:45+ Stage 1 RTLS · LZ-1".

### Manual weather: the schema doesn't know clouds
*Found 2026-10-15 · `core/schema/mission.js` (`weatherManual`), `app/briefing.js` (`WEATHER_PRESETS`)*

The scenario-setup presets are manual weather with `clouds` and `dewp`, and since 2026-10-15 a preset at a station becomes `S.metar`, so the ATIS reads its clouds. The schema's `weatherManual` has neither field (`visib` is listed as *planned*, with the note "no ATIS for manual weather"). Presets are applied after the schema check, so nothing fails today — but a mission file that authors manual clouds would be rejected. **Fix:** give `weatherManual` the METAR fields the code reads (`dewp`, `visib`, `clouds`), i.e. the same shape as `weatherFallback`; update the note. **Done when:** the setup presets pass the mission schema (a check in `tests/briefing.test.mjs`). Goes with *The cloud layer is never drawn*.

### An-225 and DC-8 are turbofans but fly the non-turbofan path
*Found 2026-10-18 · `aircraft/an225.json`, `aircraft/dc8.json`*

Both have turbofans (D-18T; JT3D/CFM56 depending on the DC-8 variant), but their `engine` has no `type`: `"turbofan"` switches on the N1 spool, A/THR thrust, electrical, hydraulics and the turbofan sound, so setting it would change how they fly. They use the prop path today (`spdT` as the throttle). The DC-8 is also the kinematic stub (no `manualControl`). **Fix:** when each one is checked in flight on the turbofan path (thrust levers, `thrustProfiles`, `idleN1`), set `type: "turbofan"`. **Done when:** both declare `type: "turbofan"` and fly their missions as before or better.

### Stale docs
`docs/architecture.md` was rewritten bottom-up on 2026-10-11 (§1–14). `docs/panel-system.md` was updated 2026-10-11. `docs/url-routing.md` (formerly `navigation.md` — it covers browser URLs and history, not aircraft navigation; renamed 2026-10-11) hasn't been checked against the code yet.
