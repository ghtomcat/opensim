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

Many snippets start from still air — mission turbulence is random:

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

Both apply per frame, not per second — their strength depends on the frame rate. Scale by `dt` like the energy stall. Turbulence also makes tests random (see *Test runs are not deterministic*).

### The ground is flat: the nearer airport's field elevation everywhere
*Found 2026-10-11 · `tickPhysics()` in `core/physics.js` (`_grdElev`)*

**Symptom.** Wherever the aircraft is, "ground" is a flat plane at the field elevation of the nearer airport (departure or arrival threshold, whichever is closer; missions without elevations fall back to `situations[0].alt` or 0). Takeoff, landing, weight on wheels, the ground roll and the AP's ground logic all use it. Real terrain only enters as a crash check, and only where it's more than 100 ft above that field (see *CFIT* in `docs/architecture.md` §7.4).

**Cause — verified (code).** Ground elevation was never taken from the DEM; the DEM arrived later for rendering and EGPWS.

**Consequences.**
- No off-field landing: an engine-out glide into a valley or a field below the airport elevation can't touch down there — it either "lands" in the air at field elevation or flies on until terrain is >100 ft higher and counts as CFIT.
- Terrain within 100 ft of field elevation is invisible to physics: the aircraft can fly through low hills near an airport.
- Midway between two fields of different elevation the ground jumps from one elevation to the other.

**Fix.** Use the DEM elevation under the aircraft as the ground (via the core elevation module from *`core/` depends on `display/`*); near a runway, use the runway elevation (the DEM is too coarse for a landing surface — blend within the airport boundary). Keep the airport-elevation fallback when no DEM tile is loaded.

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
- Keep it reproducible in tests (see *Test runs are not deterministic*).

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

---

## Tests

### Test runs are not deterministic
*Found 2026-10-11*

**Symptom.** The same test passes or fails between runs — LSZH ILS tracking passed ~3 of 4 runs (5 of 5 since live weather was removed from tests); landing tests failed by chance before `calmAir()`.

**Three sources:**

1. **The real game loop keeps running in test mode — verified.** `core/loop.js` ticks on `requestAnimationFrame` while the test waits between `simStep` calls, so physics also advances in wall-clock time, by an amount that depends on the machine.
   ```js
   const t0 = window.simGetState().time;
   return new Promise(r => setTimeout(() => r({ t0, after2s: window.simGetState().time }), 2000));
   ```
   `node tools/probe.mjs lszf-pattern` → `{ t0: 0.017, after2s: 2.03 }` — two seconds of sim time without a single `simStep`.
2. ~~**Live weather.**~~ **Fixed 2026-10-11:** test mode never fetches METAR (`setLiveWeather(false)`); live missions fly their `fallback`. For players, the fallback now seeds `S.metar` until a fetch succeeds — before, a failed fetch meant zero wind, standard QNH and 15 °C.
3. **Turbulence — verified.** Random vertical speed every frame (see above). Landing tests use `calmAir()`.

**Fix.** In `?test=1`: don't let the rAF loop tick physics (`simStep` is the only clock); let tests opt into turbulence explicitly (or seed the random generator in test mode).

**Done when.** `npx playwright test tests/physics.test.js --repeat-each=5` passes 5/5 (or fails 5/5); two runs of the full airplane suite give identical results.

**Affects.** Every Playwright spec; most visibly the ILS and AP tests in `physics.test.js`.

### Tests step a different tick from the game loop
*Found 2026-10-11 · `window.simStep` in `index.html` (test API) vs `_tick()` in `core/loop.js`*

**Symptom.** Tests advance the sim with `simStep()`, which runs its own sequence instead of the loop's tick. Tests check a simulation players never run.

| Step | `core/loop.js` `_tick()` | `simStep()` |
|---|---|---|
| Input: `tickGamepad`, `tickHIL`, `tickControls` | ✓ | — |
| `tickFailures`, `tickFuel` | ✓ | ✓ |
| `tickBattery`, `tickElectrical`, `tickHydraulics` | ✓ | — |
| Rocket fixed-step accumulator (`PHYS_DT = 1.0` at high warp) | ✓ | — (one step of the given `dt`) |
| Robot arm: no physics | ✓ | — (runs `tickPhysics`) |
| `tickCrew` | ✓ | ✓ |
| `tickTelemetry`, `bbTick`, warp-target drop | ✓ | — |

**Cause — verified (code).** Two hand-written copies of the tick order; the loop gained systems (battery, electrical, hydraulics) and the rocket accumulator, `simStep` didn't.

**Why it matters.** Anything depending on the electrical or hydraulic state (bus power, COM power, pumps) behaves differently under test; rocket tests can't reproduce the warp stepping (see *Ascent fails with 1-second physics steps*); every future system added to the loop silently stays untested.

**Fix.** One exported `tickSim(dt)` in `core/loop.js` holding the simulation step (everything between input and renderers). The rAF loop calls it per frame; `simStep()` calls it n times. Input stays outside (tests set state directly). The recorders tick in `tickSim` but aren't started in test mode — no test reads them, and they grow with sim time (see *Telemetry buffer grows without limit in sim time*). Do it together with *Test runs are not deterministic* (in test mode, `simStep` becomes the only clock).

**Done when.** `simStep` and the loop share one tick function; the test suite passes (re-tuned only where a test relied on the missing systems).

### DB 601 engine-off tests use an airborne mission
*`tests/db601-sound.spec.js`* — "starts in off state" and "lader gain is zero at engine off" load Wolfskopf, which starts at 2 000 ft with the engine running. Use a ground start (`hahnweide-1944`).

### `egll-approach` is temporarily the 737 MAX 9 into Madrid
*`missions/egll-approach.json`, `tests/physics.test.js`* — two tests expect the EGLL 737-800 ("loads a stable airborne state", "autopilot holds altitude": 711–723 ft off vs < 300). Restore the mission, then re-check the altitude hold.

---

## Mission loading

### Each mission start stacks another copy of the page wiring
*Found 2026-10-11 · `init()` in `index.html`; `initKneeboard()`, `initMap()`, `initOutside()` and others*

**Symptom.** `init()` runs again for every mission in the same page session (picker, back/forward, `simLoad`) — there's no reload. Each run adds its `keydown` listener and the ND click listener again without removing the old ones, and several `init*()` functions append their DOM again. After a second mission, pressing K toggles the kneeboard twice (it stays closed); old listeners act with the previous mission's closures (e.g. E/Q use its `engineType`).

**Reproduce.** Load missions in one session and count duplicated element ids:

```js
const dups = () => { const c = {}; for (const e of document.querySelectorAll('[id]')) c[e.id] = (c[e.id] || 0) + 1;
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => v > 1)); };
const a = dups();
await window.simLoad('lszf-pattern');  await new Promise(r => setTimeout(r, 1500)); const b = dups();
await window.simLoad('egll-approach'); await new Promise(r => setTimeout(r, 1500));
return { after1: a, after2: b, after3: dups() };
```
`node tools/probe.mjs lszh-approach` (wrap the snippet in `return (async () => { … })();` — `probe.mjs` doesn't accept top-level `await`).

**Baseline (2026-10-11).** after1: none. after2: `kneeboard`, `kb-prev`, `kb-next`, `minimap`, `vehicle-silhouette`, `booster-silhouette`, `velis-map-overlay`, `g1000-map-overlay` ×2. after3: the same ×3, plus `kb-clear` ×2. Kneeboard: one K press opens it after the first mission; after the second, one press leaves it closed. The overhead and pedestal are guarded and not duplicated.

**Cause — verified.** Per-session setup (listeners, DOM creation) is mixed into the per-mission `init()`.

**Fix.** Split `init()` into a one-time `setupApp()` (DOM, listeners — reading the current mission from `S` when they fire) and a per-mission `startMission()`; make each display's `init*()` idempotent (create once, reset per mission). Part of *`index.html` carries most of the application wiring*, but worth fixing first — it's a user-visible bug.

**Done when.** The reproduce snippet returns no duplicates after three loads; K opens the kneeboard with one press after any number of mission changes.

### Glass-cockpit page selection carries over to the next aircraft
*Found 2026-10-11 · `index.html`, `window.addEventListener('opensim:aircraft-loaded', …)`*

`index.html` resets the page index of both glass screens (`_screenPage`) when `opensim:aircraft-loaded` fires — but nothing dispatches that event. **Cause — verified (code).** So after paging the right screen to ECAM (Tab) and loading another airliner mission, the new aircraft starts on page 2, or on a page index past its own page list (taken modulo the length). **Fix:** dispatch the event at the end of `init()` after `loadMission()` (or reset `_screenPage` there directly). **Done when:** a newly loaded airliner always starts on its first page of each screen.

### Live flight always loads the A350
*Found 2026-10-11 · `flyWithFlight()` in `index.html` (`const liveMission = { … aircraft: 'a350' … }`)*

`flyWithFlight()` picks an aircraft for the tracked flight with `pickAircraft(flight.icaoType)` (C172 → `c172`, DR40 → `robin-dr400`, PA28 → `c172`, else `a350`) and passes it to `init()`. But the inline mission it builds also sets `aircraft: 'a350'`, and `loadMission()` gives the mission's `aircraft` precedence over the caller's path. So the A350 always loads. **Cause — verified (code), not yet seen in the browser.** The hard-coded `'a350'` dates from `8f2d067` (25 Mar) and was harmless until `37ea9d0` (13 Jun) made the mission JSON the aircraft source of truth. **Fix:** set the inline mission's `aircraft` to the `pickAircraft()` result (or drop the field). **Done when:** tracking a C172 or DR400 loads that aircraft.

---

## Navigation

### Taxi route and pushback depend on the map being visible
*Found 2026-10-11 · `_updateTaxiRoute()` / `renderMap()` in `display/map.js`; `capturePushback()` call in `core/physics.js`*

**Symptom.** The taxi route (the green line) is computed in `_updateTaxiRoute()`, called from `renderMap()` — which returns early when the map is hidden, and `_updateTaxiRoute()` itself returns if the Leaflet layer doesn't exist. The result is published by direct assignment to `S.taxiRoute`. Physics captures the pushback path from `S.taxiRoute` on the first push frame.

**Cause — verified (code); the pushback effect is inferred, not yet seen in the browser.** With the map closed (or Leaflet not loaded), `S.taxiRoute` stays null or stale → pushback has no path (or the wrong one). Separately, `display/com.js` computes its **own** taxi route for the clearance phrase (`getTaxiGraph` + `routeTaxi`), so the spoken clearance and the green line are two computations that can disagree.

**Fix.** A core taxi module owns the active taxi route: computed from the aircraft position + goal (departure runway / assigned gate) when the goal or clearance changes, stored in `S` via `setState`. The map draws it; com.js phrases it; pushback uses it. **Done when.** `display/map.js` doesn't write `S`; the taxi route exists with the map hidden; the clearance text and the green line come from the same route.

### No flight-plan state — the route is recomputed per consumer
*Found 2026-10-11 · `buildFullRoute()` in `core/route.js`*

**Symptom.** There is no flight plan in `S`. LNAV, the ND, the MCDU, the kneeboard and the briefing (3 call sites) each call `buildFullRoute(departure, arrival)` themselves, with their own caches (or none). The route is a pure function of the mission's dep/arr — it can't change in flight.

**Why it matters.** The training backlog needs a mutable plan: ATC re-clearance (different SID/STAR/runway), direct-to, holding, a diversion, a go-around re-sequencing into the missed approach. Today each of those would have to be threaded into five caches. Also wasteful: each consumer runs the airway Dijkstra.

**Fix.** A flight-plan object owned by `core/` (e.g. `S.flightPlan = { legs, sid, star, appr, missed, activeIdx }`), built once from the mission at load (and rebuilt when the procedures arrive), amended by explicit operations (`directTo(fix)`, `setStar(name)`, `setRunway(rwy)`, …). All consumers read it; `S.fmsActive` becomes `activeIdx`. **Done when.** `buildFullRoute()` is called only by the flight-plan module; changing the arrival runway in flight updates the ND, MCDU and LNAV together.

### LNAV writes `S.fmsActive` directly
*`core/lnav.js`* — `_legs()` and `lnavTargetHeading()` assign `S.fmsActive = …` instead of `setState`. Harmless today (`setState` is a plain assign), but it bypasses the one write path. Folds into *No flight-plan state* (`activeIdx`).

---

## Engine and systems

### Engine start completes when the start-up sound finishes
*Found 2026-10-11 · `startEngineLifecycle()` in `core/sound.js`*

**Symptom.** A cold start (E key, magnetos to START, pedestal ENG START) sets `engineState: 'starting'`, plays the start-up recording, and sets `engineState: 'running'` + `enginePower: 1` in the audio buffer's `onended` callback. For the impulse engines (`v12-supercharged`, `radial-2000hp`, `lycoming-o360`) the engine falls back to `'off'` if the AudioWorklet isn't loaded.

**Cause — verified (code), effects not yet seen in the browser.** The engine lifecycle grew inside the sound module (11 `engineState` writes there). The start rules live there too: no start with `coolantState === 'failed'` or the fuel shutoff closed.

**Consequences (inferred).**
- Without working audio — AudioContext blocked or failing, worklet not loaded, headless tests — a cold-start engine can't start or drops back to off.
- Start time is the wall-clock length of the recording: pause and time warp don't apply; a test can't step through a start with `simStep`.
- Turbofans have a second path: `physics.js` moves `starting → running` when N1 reaches idle. Two owners for one transition.

**Fix.** An engine model in `core/` (e.g. `core/engine.js`) owns the lifecycle as a sim-time state machine: start conditions (fuel, magnetos, coolant, battery), start duration per engine type (from the aircraft JSON — matched to the recording lengths), `starting → running`. `sound.js` *follows* `engineState` and plays the matching recording; it no longer writes engine state.

**Done when.** `grep -n "engineState" core/sound.js` finds only reads; a cold start completes in a headless test via `simStep`; with audio muted the engine still starts; pausing during a start pauses the start.

### One engine per aircraft
*Found 2026-10-11 · `S.engineState`, `S.enginePower`, `S.n1` (single values)*

**Symptom.** Whatever `engine.count` says, the engine is one `engineState`, one `enginePower`, one `n1`. `core/electrical.js` builds "per-engine" generators from the shared N1; `core/hydraulics.js` drives both engine pumps from it ("approximated with shared N1"). Thrust is one force on the centreline.

**Why it matters.** Engine-out on a twin can't be simulated: engine failure after V1, single-engine climb, the engine-out departure procedure (EOSID), asymmetric thrust and rudder, single-engine approach and go-around — the core of multi-engine training and of the abnormal-procedures backlog. Also per-engine start sequences, a single engine fire, and generator/pump loss of one engine.

**Fix — outline.** Engine state becomes an array (`S.engines[i] = { state, power, n1, … }`), sized by `engine.count`. Thrust sums per engine; asymmetric thrust adds a yaw moment (needs a yaw/sideslip term in the flight model — currently heading follows bank only). Electrical generators and hydraulic pumps key off their own engine. Failures target an engine index. Displays (ECAM, EICAS, N1 gauges, pedestal levers) read per engine. Single-engine aircraft are an array of one. Best done after *Engine start completes when the start-up sound finishes* and with *`tickPhysics()` is one 680-line function*.

**Done when.** A twin can lose one engine (failure or fuel cut) and keep flying on the other with the expected yaw and climb loss; the ECAM/EICAS shows the failed engine; single-engine aircraft behave as before.

### `enginePower` has many writers and no composition
*Found 2026-10-11*

About seven places set `S.enginePower` to an absolute value: `failures.js` (power ramps, carb ice, coolant seizure), `fuel.js` (starvation), `battery.js` (empty), `sound.js` (start lifecycle), `mission.js` (initial), crash (`physics.js`). The last writer in a frame wins. Example: while carb ice is active, `tickFailures()` sets `enginePower = 1 − 0.7·ice` every frame, overwriting an `engine_power` failure ramp in progress; a restart via `sound.js` sets 1.0 regardless of an active partial failure.

**Fix.** Keep the causes separate and compute power from them: e.g. `enginePower = available(fuel, battery, seizure) × (1 − failureLoss) × (1 − icingLoss)`, each factor owned by its module (per engine, see *One engine per aircraft*). **Done when.** No module assigns `enginePower` directly; a failure ramp and carb ice combine instead of overwriting each other.

### Airliner electrical and hydraulics are display-only — not implemented yet (intentional)
*Noted 2026-10-11 · `core/electrical.js`, `core/hydraulics.js`*

Bus states (AC/DC/essential, generators, APU, external power, batteries) and hydraulic pressures (GREEN/BLUE/YELLOW) are computed every frame, but only the ECAM, overhead, pedestal and PFD read them. Nothing in the simulation depends on them: gear, flaps, brakes, flight controls, autopilot, displays and COM keep working with all buses and hydraulics dead. **Status: intentional for now** — the systems are modelled for the cockpit first; coupling them to the simulation is future work.

When it's taken up: decide which consumers depend on which bus/system (e.g. COM on DC ESS, gear and flaps on hydraulics, displays on AC), replace the per-panel COM power check in `core/crew.js` with the bus state, and make the hydraulic layout per aircraft (next entry).

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

When it's taken up, decide: who owns the simulation (one authoritative browser — likely the PF or the instructor — others mirror), which state is shared (controls per role vs. full state), how crew audio and ATC are synchronised (`CREW_EVENT`), and what the instructor can inject (failures, weather, ATC). Builds on *Tests step a different tick from the game loop* (one tick function) and the flight-plan state (*No flight-plan state*).

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

`renderTerrain(canvas, options)` draws the whole world for every camera in one function: sky, twilight, stars, sun and moon, the Earth globe, the DEM ground grid, water, city lights and roads, every airport element (runways, taxiways, aprons, lights, holding points, signs, stands, terminals, jet bridges, satellites, towers, windsocks), clouds, haze, mission effects, the cockpit frame and overlays — sharing local projection state across all of it. It also publishes `S.terrainElevFt` for physics.

**Why it matters.** It's the largest function in the project; every scenery change lands in it; nothing in it can be tested or profiled per layer; and the elevation it publishes for physics is buried in the middle (see *`core/` depends on `display/`*).

**Fix.** Keep `renderTerrain()` as an orchestrator over a shared view object (projection, pose, time of day, DPR) and move each layer into its own function/module: `sky`, `celestial`, `globe`, `ground`, `water`, `nightLights`, `airport/*` (runways, lights, signs, buildings), `weather` (clouds, haze), `cockpitOverlay`. Behaviour-preserving first, checked with before/after screenshots per camera mode. Elevation sampling moves to `core/` per the *`core/` depends on `display/`* entry. **Done when.** No function in `terrain.js` above ~300 lines; the outside views match the pre-split screenshots.

### Prop and warbird 3D models are code, not data
*Found 2026-10-11 · `display/outside-c172.js`, `outside-b109.js`, `outside-f4u.js`, `outside-mig15.js` (+ `outside-pp.js`)*

Airliners are built from the aircraft JSON (`_acGeoFromJson()`, data-driven from `dimensions`, see *Aircraft geometry is derived when authored*). The C172/DR400, Bf 109, F4U and MiG-15 are hand-authored vertex/face arrays inside JS modules, scaled to true size by a per-type constant (`_S172`, `_SB109`, `_SF4U`); their camera and gear fields in the JSON (`nose.tipX`, `geometry.tailX`, tire radii) must be kept in step with that constant by hand. Adding a new GA aircraft or warbird means writing a module.

**Fix.** Extend the data-driven method to props: a `dimensions` block from real drawings plus parametric builders for fuselage, wing, tail, cowling/radial, prop — the way `outside-wb.js` builds airliners — so the geometry lives in the aircraft JSON. Migrate one aircraft at a time (C172 first), comparing screenshots. **Done when.** The four prop/warbird modules are gone; their shapes come from JSON; per-type scale constants no longer exist.

### Display lag only on the glass instruments
*Noted 2026-10-11 · `display/smooth.js`*

`smooth.js` gives needles and tapes first-order lag (instruments that move with inertia read as real). Only `display/pfd_instruments.js` uses it. Pending on the steam gauges and GA panels: `bf109.js`, `f4u1a.js`, `velis_epsi.js`, `g1000.js`, and the analog widgets in `panel_renderer.js` (DR400, G1000 standby). **Done when.** Every needle and drum display eases through `smooth.js` with a per-quantity time constant.

### External libraries and fonts load from CDNs at start-up
*Found 2026-10-11 · `index.html` `<head>`*

Leaflet 1.9.4 (JS + CSS) and Three.js r134 (+ `STLLoader`, `OrbitControls`) load from unpkg.com; the fonts (IBM Plex Mono, Kalam, Syne) from Google Fonts. The scripts are synchronous `<script>` tags in `<head>`, so a slow or unreachable CDN delays the whole page; offline, the map and robot views fail and fonts fall back. Three.js r134 is old (its `examples/js` globals were removed in later releases), so it can't simply be updated from the CDN either.

**Why it matters.** Public demos on unreliable networks (e.g. the Speck open day), offline use, and not depending on a third-party CDN being up. Note that the live data services (Mapbox, Overpass, METAR, ADS-B — `docs/architecture.md` §4.2) also need the network; an offline mode would need cached tiles too.

**Fix.** Vendor the libraries and fonts into the repo (e.g. `vendor/leaflet/`, `vendor/three/`, `vendor/fonts/`) with their licences, and load them locally. Optionally load Three.js only when a robot mission starts. **Done when.** With the network off, the page loads, the map module initialises, and the robot view renders.

---

## Sound

### F4U Corsair starts up with the DB 605 start-up sound
*Found 2026-10-11 · `core/sound.js`, start-up buffer selection (`const startupBuf = _engineType === 'radial-2800hp'`)*

The check compares against `'radial-2800hp'`, but the F4U's engine type (and every other check in the code) is `'radial-2000hp'`. It never matches, so the Corsair falls through to `_assembleStartup()`, the DB 605 sequence; `_assembleR2800Startup()` is never called. **Cause — verified (code + history).** `21d56de` (14 Apr, Lycoming start-up) changed `'radial-2000hp'` to `'radial-2800hp'` on that line — most likely a typo. **Fix:** `'radial-2000hp'`. **Done when:** an F4U cold start (E key, `bougainville-1943` or another ground start) plays the R-2800 start-up. An example of *No contract between the JSON data and the code* below.


### Velis electric motor plays the geared-turbofan sound
*Found 2026-10-11 · `ENGINES` in `core/sound.js`; `startSound('electric')` in `display/velis_epsi.js`*

The Velis's `sound.engineType` is `"electric"`, but `ENGINES` has no `electric` preset; `initSound()` / `startSound()` fall back to `ENGINES['geared-turbofan']` (`ENGINES[type] ?? ENGINES['geared-turbofan']`). **Cause — verified (code), not yet heard in the sim.** **Fix:** an `electric` preset (motor whine + prop, no combustion — the removed `edf-hovercraft` preset used `slewTime: 0.04`, "electric motors spool almost instantly"), calibrated against a Velis recording (`docs/sound-calibration.md`). **Done when:** the Velis sounds like an electric motor; an unknown `engineType` is a validation error (see *No contract between the JSON data and the code*), not a silent turbofan.

### Comm profile names outside the profile table
*Found 2026-10-11 · `PROFILES` in `core/radio.js`; `missions/crew-demo2.json`*

- **`sband-crew` is planned but not defined yet.** `crew-demo2` sets `characters.crew.commProfile: "sband-crew"`; `docs/audio-chain.md` lists it as *"add when H4n recordings land"*. No effect today — the crew lines are TTS, and TTS ignores profiles — but until it's defined, recordings for the crew would silently play as `vhf-aviation` (`createRadioChain()` falls back). Fix: define it together with the recordings.
- **`broadcast` is valid but special-cased.** It's a dry bypass for narrators, handled by `if (profileName === 'broadcast')` in `playThroughChain()` instead of being an entry in `PROFILES` — so the list of valid names isn't in one place. Fix: a `PROFILES` entry with a `bypass: true` flag.
- **`COCKPIT_PROFILES` in `core/crew.js` lists `cockpit-c172`**, which isn't a radio profile.

**Done when.** Every `commProfile` value in missions/aircraft is a key of `PROFILES`; unknown names fail validation.

### The AudioContext is recreated on every engine (re)start
*Found 2026-10-11 · `startSound()` / `_teardown()` in `core/sound.js`*

`startSound()` tears down and **closes** the current AudioContext and creates a new one on every engine (re)start (also in `startEngineLifecycle()`, `startApuSound()`, `startFuelPump()` when none exists). The radio chain and engine bleed share that context (`getAudioContext()`, `getEngineBleedNode()` in `core/crew.js`); AudioWorklet modules are re-added per context. `display/com.js` (squelch) and `index.html` create contexts of their own.

**Consequence (inferred, not yet heard).** Anything playing on the old context stops when it's closed — e.g. an ATC transmission or ambient audio playing while the engine is started, restarted after a failure, or switched (`switchEngine`). Browsers also limit the number of live AudioContexts.

**Fix.** One AudioContext for the session, created on the first user gesture, owned by a small `core/audio.js`; engines, radio, GPWS and effects get their own gain buses on it and are started/stopped by connecting/disconnecting, never by closing the context. Worklets added once. **Done when.** `new AudioContext` appears once in the code; starting the engine during an ATC transmission doesn't cut it.

---

## Architecture

### Overview: strong data architecture, weak runtime architecture
*Found 2026-10-11 · high-level review of `docs/architecture.md`*

The data side is disciplined: vehicles, missions, panels and world data are JSON or generated modules, with a config cascade. The runtime side grew feature by feature; each feature reached across whatever layers it needed. Most single entries in this file are symptoms of five patterns, filed below as their own entries:

1. **No owners for state:** *`S` has no field ownership*.
2. **Shared products are recomputed by each consumer:** *Shared products are computed per consumer, not owned once*.
3. **"Vehicle" is a file format, not an interface:** *No vehicle contract*.
4. **A mission has no single start, stop and tick:** *No mission lifecycle and no single tick*.
5. **Model depth is uneven where training needs it:** *The runtime has no seam for training-grade systems*.

The declared layering (data → simulation → presentation → shell) is also not the real one. Dependencies run both ways (*`core/` depends on `display/`*; display modules do simulation work, see `architecture.md` §13.6), and there is an unnamed fourth layer: the **application** (session, briefing, scoring, live flight), which lives in `index.html` (*`index.html` carries most of the application wiring*).

**Suggested order.**
1. One tick and one mission lifecycle — fixes test determinism and the stacked wiring together.
2. Owned products in `core/` (route, taxi route, elevation) and generated data out of `display/`.
3. Schema check at load + a test that loads every aircraft and mission (*No contract between the JSON data and the code*).
4. Vehicle contract and per-engine state — when the training work needs them.

### `S` has no field ownership
*Found 2026-10-11 · architecture review (`docs/architecture.md` §6.1, §9.2)*

**Symptom.** `S` is one mutable object with ~170 fields. `setState` is `Object.assign` (~280 calls), and ~110 direct writes sit beside it. No field has a declared owner, so several modules write the same field and the last writer in the frame wins. The comment at the top of `state.js` (only physics, input, mission write) is out of date. On top of that, modules keep private state between frames (fired entries, ramps, caches), cleared by hand-written `reset*()` functions.

**Evidence.** *`enginePower` has many writers and no composition*; *Engine start completes when the start-up sound finishes* (`sound.js` writes `engineState`); *The outside view borrows the flight state for its camera*; *LNAV writes `S.fmsActive` directly*; `display/map.js` writes `S.taxiRoute`, `display/terrain.js` writes `S.terrainElevFt`.

**Why it matters.** Correctness depends on the order of the frame loop and of the ~30 closures in the renderer list. A new feature can't tell whose field it is about to overwrite.

**Fix.** Give each field group one owning module (documented in `state.js`, next to the defaults). Others request changes through that owner (e.g. `enginePower` composed from contributions: failure × carb ice × fuel × battery). Displays read only. Optional dev-mode guard: a `Proxy` on `S` in test mode that logs writes from non-owners.

**Done when.** Every field group in `state.js` names its owner; no display module writes `S` except through an owner's API; a test-mode write check passes.

### Shared products are computed per consumer, not owned once
*Found 2026-10-11 · architecture review (`docs/architecture.md` §7.4, §10.1, §10.5)*

**Symptom.** Products that several modules need are rebuilt by whoever needs them instead of being computed once and stored:
- the flight plan: five consumers call `buildFullRoute()` (*No flight-plan state — the route is recomputed per consumer*);
- the taxi route: once in `map.js` (only while the map is visible), once in `com.js` (*Taxi route and pushback depend on the map being visible*);
- "ground": the field elevation of the nearer airport, recomputed each tick (*The ground is flat*), and the DEM elevation produced by a renderer (*`core/` depends on `display/`*).

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

### No mission lifecycle and no single tick
*Found 2026-10-11 · architecture review (`docs/architecture.md` §6.4, §14.4)*

**Symptom.** A mission has no single start, stop and tick:
- `init()` runs again for every mission and adds listeners and DOM without removing the old ones (*Each mission start stacks another copy of the page wiring*);
- each module's leftover state is cleared by a hand-maintained list of `reset*()` calls in `loadMission()`;
- the AudioContext is replaced mid-mission (*The AudioContext is recreated on every engine (re)start*);
- tests step a different sequence from the game loop while the real loop keeps running (*Tests step a different tick from the game loop*, *Test runs are not deterministic*).

**Fix.**
1. **One `tick(dt)`** in `core/loop.js`, used by both the `requestAnimationFrame` loop and `simStep`. In test mode the rAF loop doesn't step the simulation.
2. **A mission session object**: `start(mission)` registers listeners, DOM and timers through it; `stop()` removes them all. `init()` = `stop()` the old session, `start()` the new one.
3. Modules with per-mission state register their `reset` with the session instead of being listed by hand.

**Done when.** Loading three missions in a row leaves one copy of every listener and element; `simStep` and the game loop run the same function; the same test run twice gives the same state.

### The runtime has no seam for training-grade systems
*Found 2026-10-11 · architecture review (`docs/architecture.md` §7, §9)*

**Symptom.** Model depth is uneven. Sound synthesis, rocket trajectories and airliner geometry are deep; the parts the training roadmap needs are shallow: one engine value per aircraft (*One engine per aircraft*), airliner electrical and hydraulics that only feed displays (*Airliner electrical and hydraulics are display-only*), a point-mass flight model on flat ground.

**Why it matters.** The training procedures backlog (engine-out / EOSID, V1 cut, failure injection, hydraulic loss) needs per-engine state and systems that affect the flight. These aren't missing features to bolt on; there is no place in the runtime where a system's output reaches physics.

**Fix.** Design the seam before the first training procedure that needs it: per-engine state arrays (`engines[i].{state, n1, power}`), and a defined path by which systems produce effects that physics reads (thrust per engine, control authority, gear/flap availability). Builds on *`S` has no field ownership* and the engine-model fix in *Engine start completes when the start-up sound finishes*.

**Done when.** An engine can fail on its own on a twin, and the aircraft yaws and loses thrust accordingly; one hydraulic loss removes one function.

### No contract between the JSON data and the code
*Found 2026-10-11 · architecture review (`docs/architecture.md` §2)*

**Symptom.** Mistakes in mission and aircraft JSON fail silently, as do the string keys the code compares them against. Evidence so far:
- **Fields no code reads.** `narrative`, `atmosphere`, `fiction_note`, `notes`, `book`, `scoring`, `approachBriefAlt` appear in mission files; authors expect them to do something. In aircraft files: `model`, `era`, `landSurfaces`, `ambient`, `gearRuggedness`, `raCallouts` (a340), `crewCallouts` and `externalSensor` (avro504).
- **`engine` has two shapes.** An object `{type: "turbofan", …}` on the jets, a descriptive string on the others (`"Lycoming IO-360, 180hp"`); code reads `engine?.type`.
- **Unknown trigger types never fire, without a warning.** `_evalTrigger()` in `core/crew.js` returns `false` for an unknown `trigger.type`; `tickFailures()` in `core/failures.js` only knows `time` and `alt`. A typo in a clearance or failure means it never happens.
- **One fact, two sources.** `catalog.json` vs mission files (see *`catalog.json` and mission files disagree*); the live-flight `aircraft` (see *Live flight always loads the A350*).
- **Overloaded fields.** `timeOfDay` is hours, or a day fraction when < 1 (`display/terrain.js`). A `failures` entry goes to `core/failures.js` or `core/rocket.js` depending on whether it has a `trigger` key.
- **Mistyped string keys in code.** See *F4U Corsair starts up with the DB 605 start-up sound* above.
- **Unknown names fall back silently.** `engineType: "electric"` → turbofan sound (*Velis electric motor plays the geared-turbofan sound*); `commProfile: "sband-crew"` → `vhf-aviation` (*Comm profile names outside the profile table*).

**Cause — verified.** The JSON files have no schema, and the loaders accept any shape; every consumer reads `S.mission.*` / `S.aircraft.*` with `?.` and a default.

**Fix.** A schema per file type (mission, catalog entry, aircraft) — fields, types, allowed enum values (trigger types, failure types, `engineType`, `panel`, `commProfile`) — and a Node test that validates every file in `missions/` and `aircraft/` against it: unknown keys and unknown enum values fail. Engine types and trigger types as shared constants rather than repeated string literals. Then decide for each unread field: implement it or remove it.

**Done when.** `npm test` validates all mission, catalog and aircraft files; a misspelled field or trigger type in any of them fails the test.

**Affects.** Every mission and aircraft, and every new one added.

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
3. **A `dimensions` schema.** The keys differ today: `a350` has `mainGearHalfTrack`, `b777-300er` has `mainGearTrack`; `b737max9` nests `engine` / `gear` sub-blocks and has no `length`. Part of *No contract between the JSON data and the code*.
4. **Migrate per aircraft, `a340` first** (the reference build). Compare outside-view screenshots before and after; the model must not move.
5. Retire `rescale-aircraft.py`.

**Done when.** For the data-driven aircraft the JSON holds no absolute model-unit geometry; editing a value in `dimensions` changes the model on reload; `rescale-aircraft.py` is gone; the outside views match the pre-migration screenshots.

**Affects.** The four data-driven airliners now; every airliner rolled out to the method later. Props/warbirds keep their scaled hand-authored geometry until they get a data-driven build.

### `core/` depends on `display/`
*Found 2026-10-11 · architecture review (`docs/architecture.md` §4.3)*

The simulation layer should not depend on the presentation layer, but six `core/` modules import from `display/`:

| Importer | Imports | Kind |
|---|---|---|
| `core/mission-start.js` | `display/runways-data.js`, `display/stands-data.js` | generated data |
| `core/route.js` | `display/runways-data.js`, `display/procedures-data-xp.js` (dynamic) | generated data |
| `core/airway-graph.js` | `display/airways-data.js` | generated data |
| `core/taxi-graph.js` | `display/taxi-data.js` | generated data |
| `core/crew.js` | `terrainElevM()` from `display/terrain.js?v=2` (EGPWS look-ahead) | terrain elevation |
| `core/mission.js` | `resetSmooth()` from `display/smooth.js` | display reset on mission load |
| `core/physics.js`, `core/crew.js`, `core/blackbox.js` | `S.terrainElevFt` — not an import: `display/terrain.js` writes the DEM elevation under the aircraft into `S` while it renders | terrain elevation, via state |

**Why it matters.**
- **Data in the wrong place.** The generated modules are shared reference data, not display code; their location hides that `core/` needs them.
- **Elevation is owned by a renderer.** The DEM tile cache (Mapbox `terrain-rgb`) lives in `display/terrain.js`, which touches browser APIs at import time (`localStorage` for the token; `terrain-color.js` loads an image). So `core/crew.js` can't be unit-tested with `node --test`, and the import URL must match `outside.js`'s exactly (`?v=2`) or the two get separate tile caches — a silent failure.
- **Mission load reaches into the display.** `loadMission()` resets display smoothing; a display concern in the simulation's load path.

**Fix.**
1. **Move the generated data to `data/`** (or `world/`): change the output paths in the ten `scripts/build-*.py`, the imports, the `display/procedures-data-xp.js` line in `.gitignore`, and the paths in `README.md`, `docs/creating-missions.md` and `docs/architecture.md`. `windsocks-data.js` and `coastlines.js` move too.
2. **Move elevation sampling into `core/`** (e.g. `core/elevation.js`: tile fetch, cache, `elevM(lat, lon)`), with no DOM work at import. `display/terrain.js` and `core/crew.js` both import it — one cache, no URL coupling. Physics samples the elevation under the aircraft itself instead of reading `S.terrainElevFt` written by the renderer — then CFIT and EGPWS no longer depend on the terrain view running (still on a Mapbox token).
3. **Reset display state from the shell**, not from `loadMission()`: `index.html` calls `resetSmooth()` after loading (or displays reset on a mission-loaded event).

**Done when.** `grep -rn "display/" core/` finds nothing; `core/crew.js` imports in Node without browser globals; the outside view and EGPWS still share one elevation cache.

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

`tickPhysics(dt)` holds, in one function: ground reference, speed limits, turbofan N1 + A/THR speed loop, ILS deviation and capture, runway-vacate detection, the force model (flight and ground roll), the autopilot (lateral + vertical), the kinematic model, FMA, wind, dead reckoning, crash detection, oil and coolant temperature, thrust reverser, ground spoilers, gear animation and pushback — sharing ~100 local variables, with module-level state for some (`_flapActual`, `_apVsCmd`, `_vsRefAlt`, `_athrSpdPrev`).

**Why it matters.** The flight-model fixes already logged (α = θ − γ, the energy stall, per-frame terms, flat ground) all land in the middle of this function; none of its parts can be unit-tested alone; a change to one concern (e.g. the AP pitch law) can shift another through shared locals.

**Fix.** Split along the concerns, keeping one `tickPhysics()` that calls them in the current order: `engine` (N1, A/THR), `ils` (deviation/capture), `autopilot` (targets only), `flightModel` (forces → speed/γ/attitude; ground roll), `navigation` (wind, dead reckoning), `systems` (temperatures, reverser, spoilers, gear), `pushback`, `crash`. Pure functions where possible (inputs → outputs, no `S`), so `node --test` can cover them. Behaviour-preserving first; fix the model issues after.

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

**Fix — a structured rewrite, not piecemeal.** Plan it as its own piece of work: CSS into stylesheet(s); application logic into modules (e.g. `app/init.js`, `app/routing.js`, `app/liveflight.js`, `app/debrief.js`, `app/test-hooks.js`); `index.html` left as markup plus a short bootstrap. Moved logic gets unit tests where it is pure. The Playwright suite is the safety net — it must pass before and after.

**Done when.** `index.html` holds markup and a bootstrap only; no application logic in inline script; the test suite passes unchanged.

---

## Data and docs

### `catalog.json` and mission files disagree
*`missions/catalog.json`* — `egll-approach` (catalog: 737-800 into EGLL; file: 737 MAX 9 into Madrid) and `fimp-takeoff` (catalog: Mauritius takeoff; file: Zürich Dock E).

### Inspiration5 description says "Stage 1 returns to LZ-1"
*`missions/inspiration5.json`* — the booster now lands on the droneship (ASDS).

### Cold-and-dark start leaves `enginePower` at 1
*Found 2026-10-11* — after loading `lszf-pattern`, `engineState` is `'off'` but `enginePower` reads 1. `core/mission.js` sets 0 for an engine-off start, so something after mission load sets it back — start by searching for `enginePower: 1` in `index.html` / `core/sound.js` init paths. No effect on thrust (needs `'running'`), but inconsistent.

### Stale docs
`docs/architecture.md` was rewritten bottom-up on 2026-10-11 (§1–14). `docs/panel-system.md` was updated 2026-10-11. `docs/url-routing.md` (formerly `navigation.md` — it covers browser URLs and history, not aircraft navigation; renamed 2026-10-11) hasn't been checked against the code yet.
