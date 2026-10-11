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

**Affects.** Every aircraft with the full flight model (`manualControl`): all Fly-tab aircraft, also with the AP engaged (applies after the AP pitch command). Not rockets, hovercraft, DC-8. Active only above a 5 % lift deficit: slow flight, engine-out glides, under-pitched approaches, the flare.

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

### Rocket test timings predate the countdowns
*`tests/rocket.spec.js`* — Demo-2 has a 178 s countdown (`ignitionTime`, since 11 Apr); the booster and Dragon-separation tests check too early (separation is at t ≈ 898 s, the test expects it by 850).

---

## Tests

### Test runs are not deterministic
*Found 2026-10-11*

**Symptom.** The same test passes or fails between runs — LSZH ILS tracking passes ~3 of 4 runs; landing tests failed by chance before `calmAir()`.

**Three sources:**

1. **The real game loop keeps running in test mode — verified.** `core/loop.js` ticks on `requestAnimationFrame` while the test waits between `simStep` calls, so physics also advances in wall-clock time, by an amount that depends on the machine.
   ```js
   const t0 = window.simGetState().time;
   return new Promise(r => setTimeout(() => r({ t0, after2s: window.simGetState().time }), 2000));
   ```
   `node tools/probe.mjs lszf-pattern` → `{ t0: 0.017, after2s: 2.03 }` — two seconds of sim time without a single `simStep`.
2. **Live weather — verified.** `weather.source: "live"` fetches the METAR (`fetchMetar()` in `core/mission.js`) from aviationweather.gov, then a CORS proxy. From `localhost` in a test it usually fails → `S.metar` stays `null` → `_getWind()` in `core/physics.js` returns **zero wind and ignores the mission's `fallback`**. When a fetch does succeed, the test flies in today's real wind. (The ignored fallback is also a bug for players offline.)
3. **Turbulence — verified.** Random vertical speed every frame (see above). Landing tests use `calmAir()`.

**Fix.** In `?test=1`: don't let the rAF loop tick physics (`simStep` is the only clock); don't fetch live weather — use the mission's `fallback`; let tests opt into turbulence explicitly. Separately: make `_getWind()` use `fallback` when the live METAR is missing.

**Done when.** `npx playwright test tests/physics.test.js --repeat-each=5` passes 5/5 (or fails 5/5); two runs of the full airplane suite give identical results.

**Affects.** Every Playwright spec; most visibly the ILS and AP tests in `physics.test.js`.

### DB 601 engine-off tests use an airborne mission
*`tests/db601-sound.spec.js`* — "starts in off state" and "lader gain is zero at engine off" load Wolfskopf, which starts at 2 000 ft with the engine running. Use a ground start (`hahnweide-1944`).

### `egll-approach` is temporarily the 737 MAX 9 into Madrid
*`missions/egll-approach.json`, `tests/physics.test.js`* — two tests expect the EGLL 737-800 ("loads a stable airborne state", "autopilot holds altitude": 711–723 ft off vs < 300). Restore the mission, then re-check the altitude hold.

---

## Data and docs

### `catalog.json` and mission files disagree
*`missions/catalog.json`* — `egll-approach` (catalog: 737-800 into EGLL; file: 737 MAX 9 into Madrid) and `fimp-takeoff` (catalog: Mauritius takeoff; file: Zürich Dock E).

### Inspiration5 description says "Stage 1 returns to LZ-1"
*`missions/inspiration5.json`* — the booster now lands on the droneship (ASDS).

### Cold-and-dark start leaves `enginePower` at 1
*Found 2026-10-11* — after loading `lszf-pattern`, `engineState` is `'off'` but `enginePower` reads 1. `core/mission.js` sets 0 for an engine-off start, so something after mission load sets it back — start by searching for `enginePower: 1` in `index.html` / `core/sound.js` init paths. No effect on thrust (needs `'running'`), but inconsistent.

### Stale docs
`docs/architecture.md` (last changed 11 Apr) and `docs/navigation.md` (5 Apr) predate: the data-driven cockpit views, the taxi graph and gate-to-gate, aircraft systems (cooling, electrical, hydraulics), `core/route.js` + LNAV/VNAV, EGPWS, and the newer rocket work (orbit-targeting guidance, ASDS).
