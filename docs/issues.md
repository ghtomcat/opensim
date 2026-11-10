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

### `envelope.maxSpd` is three values at once — never-exceed speed for crashes, throttle scale, speed ceiling
*Found 2026-11-09 (analog panel step 4) · `core/physics.js` (`CRASH_OVERSPD`, the overspeed crash), `core/input.js`, `core/engine.js`, `core/mission.js`, `core/thrust.js`, `display/analog_panel.js` (the rpm stand-in)*

`envelope.maxSpd` is used as the never-exceed speed for the crash ("Overspeed: structural failure above VNE × 1.15", `vne = ac.envelope.maxSpd`), as the throttle scale (`spdT / maxSpd` is the lever, the turbofan N1, the analog panel's stand-in rpm), and as the ceiling of the speed target. Those are three different numbers on a real aircraft. **Decided (Markus, 2026-11-09):** `envelope` records the aircraft's real limits — the never-exceed speed (`vne`), and the others as they come (gear and flap speeds, rpm limits) — sourced, and the sim uses them for the consequences (crashes, damage, warnings). A dial's markings are the instrument's own, painted values (`analogPanel` … `scale.red` / `redLine`), never derived from `envelope`: what a manufacturer painted is often not the never-exceed value. **Fix:** a sourced `envelope.vne` per aircraft for the overspeed crash; `maxSpd` stays the throttle scale and the speed ceiling (or is renamed for it). **Done when:** no crash or damage reads `maxSpd`, and every aircraft's `vne` names its source.

### The An-225's speeds are true airspeeds, the sim flies indicated
*Found 2026-11-09 (analog panel research) · `aircraft/an225.json` `envelope`, `S.spd` in `core/physics.js`*

`S.spd` is indicated airspeed — physics.js integrates true airspeed and converts it back "for the gauge". The An-225's `envelope` gives `cruiseSpd` 440 and `maxSpd` 460 kt, and its `spdProfile` 440 kt at 39 000 ft: true airspeeds (the An-225 cruised at about 800 km/h TAS). Flown as indicated, 440 kt at 39 000 ft is about 750 kt true — far beyond the aircraft, and off its airspeed dial (the Soviet КУС-730/1100 reads indicated 50–730 km/h). Other aircraft may mix the two as well (not checked). **Fix:** the speeds in each `envelope` as indicated airspeed (or marked as true and converted). **Done when:** the An-225 cruises at about 270 kt indicated at 39 000 ft.

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

**Also (2026-11-06):** `getCurrentRpm()` in `core/sound.js`, and through it the status bar's Engine cell, computed a piston engine's RPM from `spdT / envelope.maxSpd`, a third normalisation (*The Engine cell's reading comes from the sound module* — closed 2026-11-09: the rpm is `core/engine.js`'s now, still from `spdT / maxSpd`).

**Fix.** One explicit power variable per engine (`thrustLever` already exists for jets; props get the same, keyed by the throttle input), used by thrust, oil temperature and the cooling heat input alike; `spdT` stays a speed. **Done when.** No code reads `spdT` as a power setting; the cooling model's heat input follows the same throttle as the thrust; Bf 109 / F4U cooling behaviour re-checked (normal temperatures, coolant leak → seizure timing).

### Turbulence: mission-level and from METAR gusts — enhancement
*Noted 2026-10-11 · `_getWind()` in `core/physics.js`*

Turbulence is read from the active weather source: the `manual` block (15 missions set it, e.g. Wolfskopf 0.4), or `S.metar` for live missions — but a real METAR has no turbulence field, so live missions are always smooth. A value in a live mission's `fallback` would only apply when the fetch fails, which is why `nordmeer-1956`'s fallback `turbulence: 0.3` was removed (2026-10-11).

Ideas:
- **Mission-level turbulence** — `weather.turbulence`, independent of the source, so the author's intent ("a rough Arctic flight") holds whether the weather is live, fallback or manual.
- **Derive it from the METAR** — gusts (`wgst` vs `wspd`) are a reasonable measure; live missions get realistic turbulence on gusty days.
- Keep it reproducible in tests: draw from `random()` (`core/random.js`, seeded in test mode), not `Math.random`.

### Single-engine yaw: propeller effects and crosswind — not implemented yet
*Noted 2026-10-23 · the yaw axis (stage 3 of *One engine per aircraft*), `rotaryEngine.gyroscopicTorque` in `core/physics.js`*

**Today.** The yaw axis of stage 3 is generic — every aircraft with a measured vertical tail (`dimensions.vstab…`, read by `core/airframe.js`) gets sideslip, rudder, weathercock stability and damping — but only the 777 is measured, so every light aircraft flies as before: the nose always on the flight path, no rudder in the air. A centreline engine gives no thrust moment, so the multi-engine work brings them nothing by itself. The only propeller effect modelled is the rotary engine's gyroscopic precession.

**Real world.** A single-engine propeller aircraft needs rudder all the time at high power and low speed — the *left-turning tendencies* (for a propeller turning clockwise seen from the cockpit): P-factor (the down-going blade at a higher angle of attack), the slipstream spiralling onto the left of the fin, engine torque (mainly roll, and more load on the left tyre on the roll), gyroscopic precession when the tail comes up (taildraggers). Right rudder on the takeoff roll and in the climb is the first thing a student learns. The yaw axis also carries the crosswind: weathervaning on the ground, the crab and the wing-low technique on landing, the forward slip as a descent aid.

**Fix.**
- **Data:** measure the vertical tail of a light aircraft (the C172 or the DR400 first — the PPL training aircraft) into `dimensions`, like the 777; the propeller per engine — direction of rotation, diameter, and the strength of each effect (per-type, `engine.propeller`).
- **Simulation:** P-factor and slipstream as yaw moments scaled by power and angle of attack / airspeed; torque as a roll moment (with roll coupling — not in stage 3's first version); the rotary engine's precession moved into the same model.
- **Crosswind on the ground:** today the wind does not act on an aircraft with weight on wheels (`core/physics.js`, dead reckoning) — the fin's weathercock moment and the side force from the wind, against the tyres.
- **Training:** right rudder on the takeoff roll (the centreline held, scored), crosswind takeoffs and landings to the aircraft's demonstrated crosswind, the forward slip.

**Done when.** The C172 (or DR400) swings left on a full-power takeoff roll unless right rudder holds the centreline, needs right rudder in a low-speed climb, and weathervanes into a crosswind on the ground.

### Time warp works only on rockets — not implemented yet
*Noted 2026-11-06 · `tickSim()` in `core/loop.js` (`warp = isRocket ? … : 1`), `core/input.js` (`W`, `J`)*

**Today.** Aircraft fly in real time. `tickSim()` applies `warpFactor` to rockets only (measured: 10× gives 10 sim-seconds per real second on Demo-2, 1 on the A350 and the Bf 109). The glass airliners had warp buttons, and `W` / `J` worked on every aircraft with a panel, so 10× could be selected and shown while nothing sped up; they were removed on 2026-11-06, and `W`, `J` and the `TIME WARP` flag are now rockets only.

**Why it matters.** A long-haul flight such as `singapore-london` is mostly hours of cruise.

**Why it isn't a switch.** A bigger `dt` isn't enough. The flight model and the autopilot are tuned at frame-sized steps, and some terms still apply per frame (*High-alpha stall and turbulence are per frame*). Rockets needed fixed sub-steps for the same reason (`PHYS_DT`), and their ascent still fails at 1 s steps (*Ascent fails with 1-second physics steps*). What else runs on sim time has to follow: engines, LNAV sequencing, VNAV, the ATC script, failures. Systems (fuel, electrical …) tick with the unwarped `dt` today, so the fuel wouldn't burn with it.

**Fix — to decide.** Sub-step the aircraft physics at a fixed small step, which limits the factor to what the machine can compute per frame; or a cruise-only warp, stable flight on the autopilot, that drops to 1× before the next waypoint constraint, a mode change, an event or a failure; or both. Bring back the controls with it.

**Done when.** `singapore-london` cruises at a selected warp and arrives at the same waypoints, on the same flight path and with the same fuel as at 1× within a stated tolerance; warp drops out by itself when the flight needs the pilot; the flag and the controls are available on aircraft only where warp works.

### Runway condition: every runway is dry — not implemented yet
*Noted 2026-10-23 · `performance.muRoll` / `muBrake` / `muSide` in the aircraft data, `core/physics.js` ground roll, `core/yaw.js` (the nosewheel's grip); the planned `landSurfaces`*

**Today.** The ground friction is a property of the aircraft — `muRoll`, `muBrake`, `muSide` per aircraft file, with defaults — so it mixes the tyre and brake with the surface, and every runway is a dry one. Rain or snow in the METAR changes nothing on the ground.

**Real world.** The runway condition sets the friction for braking and for steering: dry, wet, standing water, slush, snow, ice. Since November 2021 ICAO's Global Reporting Format (GRF) reports it per runway third as a runway condition code, RWYCC 6 (dry) … 0 (ice, braking nil), with the contaminant, its depth and coverage; it comes in the METAR (the runway-state group) and the SNOWTAM / ATIS. It matters for:
- **Braking:** stopping distance on landing and in a rejected takeoff; autobrake settings; reversers count for more on a slippery runway.
- **Directional control:** the tyres' side grip — on a wet or icy runway the nosewheel holds less, so an engine failure or a crosswind swings the aircraft sooner (V_MCG rises; the crosswind limit drops, per type, by RWYCC).
- **Aquaplaning:** above ~9 × √(tyre pressure, psi) kt on standing water, the tyres lose contact — braking and steering go to almost nothing.
- **Contaminant drag:** slush and standing water slow the takeoff acceleration (spray drag) and limit the depth an aircraft may take off in.
- **Takeoff performance:** a wet or contaminated runway lowers V1 and the allowed weight (*Takeoff performance: V1, VR, V2 per takeoff*); landing distance by RWYCC.

**Fix.**
- **Split the friction:** the surface gives a friction level (by RWYCC / contaminant), the aircraft keeps what is its own (tyres, brakes, anti-skid efficiency); braking, rolling and side friction read both. Grass and gravel fields (the planned `landSurfaces`) fit the same table.
- **Where the condition comes from:** the live METAR (precipitation, the runway-state group), a mission's weather setting, or a briefing choice (a wet runway as a training case), per runway — and later per runway third.
- **Readers:** the ground roll (rolling drag, braking), `core/yaw.js` (the nosewheel's grip — `muSide`), aquaplaning from the aircraft's tyre pressure, takeoff performance, the ATIS and the briefing.
- **Training:** a rejected takeoff on a wet runway, a V1 cut on a contaminated one, a crosswind landing at the RWYCC limit, aquaplaning on a flooded runway.

**Done when.** The same 777 V1 cut at WSSS swings further on a wet runway than on a dry one, a landing on a wet runway needs more distance, and the condition comes from the METAR or the briefing.

### Weight and balance: no centre of gravity, no loading — not implemented yet
*Noted 2026-10-21 · `performance.mass` in the aircraft data; the yaw axis (stage 3 of *One engine per aircraft*)*

**Today.** Each aircraft has one fixed `performance.mass`; the jets burn no fuel and carry no payload. There is no centre of gravity at all — the flight model is a point mass. Stage 3 (yaw) needs a moment arm from the CG to the fin and rudder, so it uses a **nominal CG** (`nominalCg()` in `core/airframe.js`): the share of the weight on the nose gear (`balance.noseGearLoadShare`, default 0.08) puts it that fraction of the wheelbase ahead of the main gear — on the 777 7.57 % from the ACAP's gear loads, 34.4 m from the nose tip. For yaw that is enough — the engines' arm is lateral (unchanged by a CG shift), and on the 777 a CG anywhere in its range (very roughly 15–40 % MAC, ~2 m) changes the fin's 31.5 m arm by only about ±6 %.

**Real world.** The CG is set by the loading — passengers, cargo, fuel — computed on the load sheet for every flight, and it moves in flight as fuel burns (which way depends on the tank sequence). It must stay inside the certified envelope, expressed in % of the wing's mean aerodynamic chord (MAC). It matters most in pitch: stability, elevator authority, the takeoff trim setting (Airbus THS, Boeing stab trim from the CG), and fuel burn (aft CG = less trim drag).

**Fix.**
- **Data:** the wing's MAC per aircraft (from the airport-planning DWG top view — root chord, root LE from the nose tip, tip chord and LE, the span position), the CG envelope (forward/aft limits in % MAC, by weight), the tanks (capacity, position, burn sequence), the cabin zones and cargo holds (position, capacity), the empty weight and its CG.
- **Simulation:** mass and CG from the loading, updated as fuel burns; the CG in % MAC as a state field; the moment arms (pitch and yaw) read it instead of the nominal point.
- **Readers:** a loading choice in the briefing (pax, cargo, fuel), a load sheet (ZFW, TOW, CG % MAC, trim setting), the MCDU/FMS fields (ZFW / ZFWCG, Airbus INIT B; Boeing PERF INIT), takeoff performance (*Takeoff performance: V1, VR, V2 per takeoff*), and the takeoff trim.
- **Training:** a wrong trim setting for the CG, a load-sheet error, an out-of-envelope CG (tail tipping on the ground, a nose-heavy rotation).

**Done when.** The 777's CG comes from its loading, shows in % MAC on the load sheet and the FMS, moves as fuel burns, and the takeoff trim and the yaw/pitch arms follow it.

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

### Apollo 8 plays the opening of its audio reel for every event
*Found 2026-11-06 · `missions/apollo8.json`, `assets/apollo8/highlights.mp3`; since `7a4185f` (2026-05-15)*

**Symptom.** Ten `atcClearances` entries name different moments ("Track 2 — Go for TLI", "Track 9 — Christmas Eve", "Track 13 — Re-entry"), but all play the same 22-minute reel with `startTime: 0`. Each restarts the reel's opening (the launch), and clips can overlap: seen 3–4 playing at once when jumping between events.

**The launch is done (2026-11-07).** The repeat Markus heard during the ascent was in `assets/apollo8/launch.mp3` itself: a stitched file with the liftoff roar three times. It was deleted (2026-11-07). Track 1 of the reel replaces it, set by ear: 12 → 81 s from T−4, then 80 → 226 s from the sim's `stagesep`, because the archive cut the track at 1:21 and its staging talk would come 90 s early. Only Tracks 2–13 below are still open.

**Source.** [archive.org/details/Apollo8Highlights](https://archive.org/details/Apollo8Highlights): one file with 15 tracks, in the order of the entries' numbers. The file's silences (`ffmpeg silencedetect`) give these starts, in seconds:

| Track | Start | Confidence |
|---|---|---|
| 1 Launch | 0 (cut at 81) | done, two entries |
| 2 Go for TLI · 3 TLI burn | 226 · 267 | short gaps, by length |
| 4 Earth from midway | 301 | short gap, by length |
| 5 Before LOI · 6 After LOI · 7 Lovell, Earth · 8 Live from the Moon | somewhere in 373 … 701 (gaps at 373, 495 only) | **to be found by ear** |
| 9 Genesis · 10 Before TEI · 11 Santa Claus · 12 Pre-separation · 13 Re-entry · 14 Post-splashdown · 15 President Johnson | 701 · 818 · 881 · 964 · 1012 · 1046 · 1108 | 5 s gaps, seven gaps for seven tracks; **to confirm by ear** |

**Fix.** `startTime` and `duration` per entry from the table. The present durations are estimates (Genesis: 260 s in the data, about 117 s in the file). **Done when.** Each entry plays its own track and ends with it, checked by ear.

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

### The aircraft's starting configuration is set by scattered rules — a named configuration per mission
*Noted 2026-10-18 · `initialEngine()` in `core/engine.js`, `resetElectrical()` in `core/electrical.js`, the switch and light blocks in `core/mission.js`; `phase`, `start`, `initialState` in the missions; `situations` in the aircraft*

**Today.** What the aircraft looks like at mission start is decided in five places, each by its own rule:

| What | Where | Rule |
|---|---|---|
| Engines, ENG MASTERs | `initialEngine()` | on the ground with a start sequence → cold; a turbofan with `start.runway` → running (added 2026-10-18 — a stand-in, see below) |
| APU, batteries, generators | `resetElectrical()` | always off — airborne starts included |
| Lights | `mission.js` | by panel name: G1000 all off; Airbus/E190 nav + beacon + strobe, landing off |
| C172 switches | `mission.js` | `panel === 'g1000'` → cold-and-dark, airborne starts included |
| Gear, park brake | `mission.js` | from "on the ground" |
| AP, A/THR, autobrake, spoilers | `mission.js` | `initialState`, or `!manualControl` |

The missions also have a `phase` (ground / departure / circuit / cruise / approach / launch), and the airliners have `situations` (quick-start states GROUND / TAKEOFF / CLIMB / CRUISE / APPROACH — position, speed and targets only). A runway start is more than "engines running": landing lights and strobes on, APU off, transponder on, takeoff flaps; a cruise or an approach start is a different set again. A rule per item doesn't scale.

**Idea: named configurations.** The end states of the normal checklists — `cold-dark`, `before-start` (at the stand: BAT and APU on, beacon), `lineup` (engines running, APU off, strobes and landing lights, transponder, takeoff flaps), `climb`, `cruise`, `approach`, `final`.
- **Built bottom-up**, as in *The cockpit builds itself from the aircraft data*: each system says what its controls are in each configuration — engines, APU, electrical, lights, flaps, gear, transponder, AP / A/THR, brakes. Generic defaults per aircraft class; the manufacturer's SOP differences in the config cascade (`config/manufacturers/*.json`); the aircraft's own overrides on top.
- **The mission picks one**: `"config": "lineup"`, or a default derived from `start` and `phase` (a stand → `cold-dark`, a runway → `lineup`, airborne → from the phase). Single items can still be overridden in `initialState`, as today (gear, AP, autobrake …).
- **The briefing can offer it** — e.g. at a stand "cold & dark / ready for pushback": the full start procedure, or straight to the departure.
- **The light-aircraft missions that teach the start on the runway** (`lszf-pattern`, `grenchen-neuchatel`, `hahnweide-1944`, …) say `"config": "cold-dark"` — one line, the same behaviour, so the test missions don't change.
- `situations` (the quick-start states) can become a position + a configuration.

**When.** After stages 2c/2d of *One engine per aircraft*: they make the systems (electrical layout, APU, generators at idle) data, so a configuration is "each system's controls in this position" instead of hard-coded switches. Until then the runway rule in `initialEngine()` stays as the stand-in — to be removed when this lands.

**Note (Markus, 2026-11-06).** It isn't clear there will be any cold-and-dark missions; a stand start should come up with power on, at least partially (e.g. on ground power). Until this lands, a mission can set that itself: `initialState.elec` — the electrical sources switched on at the start, by element id, applied after the resets through `elecSwitch()`, then the electrical, hydraulic and fuel systems settle once (dt 0) so the first frame is already powered (`_applyElecStart()` in `core/mission.js`; the data test checks the ids against the aircraft's layout). `fimp-takeoff` (the A340 at Dock E) starts on BAT 1 / 2 / APU BAT and EXT A / B — all four AC mains powered, the fuel pumps running, the APU off (done 2026-11-06). It folds into the named configuration when that lands.

**Done when.** The five places above are one configuration step at mission load; `singapore-london` lines up with the engines running, lights and transponder set and the APU off, from its configuration; a cruise and an approach start come up configured for their phase; and no rule in the code checks a panel name or the start position to set a switch.


### Systems start from zero and build up after load — settle them at mission load
*Noted 2026-11-06 · `core/lifecycle.js`, `core/mission.js` (`_applyElecStart()`), the systems' resets (`core/hydraulics.js`, `core/fuel-system.js`, `core/electrical.js`)*

**Today.** A mission that starts in the middle of things — the 777 on the runway at Singapore with its engines running — loads with every hydraulic system at 0 psi; the pressure builds over the first seconds, and HYD C LO shows for about a second after load. Any system that builds up over time (pressure, voltage, temperature) does the same at a mid-flight or runway start.

**Not a warm-up before the start.** Running the systems' ticks for a while before the mission begins would burn fuel, charge or drain batteries, advance crew / ATC / failure timers and fill the flight recorder, unless each of those is switched off for the warm-up; ticking only some modules gives a state the sim never produces normally; and each mission would need a wait time that depends on the slowest system of its aircraft.

**Idea: each system settles to its steady state at load** — initial conditions, as the engines already do (a runway start begins with them running, not spooling up). A second lifecycle hook next to `onMissionReset`: `onMissionSettle(fn)`; `loadMission` calls them once after the resets and after the mission's start state (`initialState.elec`, later the named configuration). Each system owns its settle step: hydraulics — a system whose pumps run starts at its nominal pressure; fuel — which pumps run (already in its reset); electrical — the buses solved once. No time passes, no number in the mission. It replaces the stand-in in `_applyElecStart()` (three systems ticked once with dt 0). Changes after the start still build up in real time — a pump switched on, an engine started, a generator lost.

**Done when.** Every mission's first frame shows its systems as they would be in that configuration: no caution on the Singapore–London runway start, the A340 at its stand on ground power with its electric pumps' systems pressurised, and the cold aircraft unchanged.

### Mission load resets `S` field by field, so a flight's state can follow into the next mission
*Found 2026-11-06 (Markus: the role cell read BEHNKEN on the Tu-95 after Demo-2) · `loadMission()` in `core/mission.js`, `core/state.js`*

**Symptom.** `init()` runs again in the same page for each mission (`docs/architecture.md` §14.2), and `loadMission()` lists the fields it resets. Whatever isn't on its list stays. Comparing nine missions loaded fresh against the same missions loaded after another one (2026-11-06):

| Left over | Does it matter |
|---|---|
| `role`, `pilotCallsign` … (the crew); on a rocket `rocketMECO`, `rocketMECO2`, `rocketS2Ignition`, `rocketS3Ignition`, read by the crew script's triggers, and `rocketOrbit`, `orbitVec` | Fixed 2026-11-06, one by one |
| `locCaptured`, `gsCaptured`, `athrMode`, `athrDetent`, `athrN1`, `n1Cmd`, `thrustReverser` | On a runway start they clear themselves: 40 s later the same as a fresh load. An airborne start isn't checked |
| `rocket*`, `dragon*`, `starship*`, `booster`, `sivbSep` … on an aircraft after a rocket; `armJoints` after the arm | No reader found on the aircraft path yet, not each checked |
| `prevAlt`, `flapPos`, `fieldElev`, `groundRollT`, `lights`, `warnings` | Not checked |

**Fix.** Keep a copy of the defaults in `core/state.js`; `loadMission()` first puts `S` back to them and removes what isn't in them, then applies the mission. A new field is then reset without anyone remembering. Check what must outlive a mission first (a module's `setState` when it first loads). **Done when.** A mission loaded after any other has the same `S` as one loaded fresh, by a test over the vehicle types (the comparison above), except what is listed as kept on purpose.

### Live flight always loads the A350
*Found 2026-10-11 · `flyWithFlight()` in `index.html` (`const liveMission = { … aircraft: 'a350' … }`)*

`flyWithFlight()` picks an aircraft for the tracked flight with `pickAircraft(flight.icaoType)` (C172 → `c172`, DR40 → `robin-dr400`, PA28 → `c172`, else `a350`) and passes it to `init()`. But the inline mission it builds also sets `aircraft: 'a350'`, and `loadMission()` gives the mission's `aircraft` precedence over the caller's path. So the A350 always loads. **Cause — verified (code), not yet seen in the browser.** The hard-coded `'a350'` dates from `8f2d067` (25 Mar) and was harmless until `37ea9d0` (13 Jun) made the mission JSON the aircraft source of truth. **Fix:** set the inline mission's `aircraft` to the `pickAircraft()` result (or drop the field). **Done when:** tracking a C172 or DR400 loads that aircraft.

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

---

### The altimeter knows QNH and standard only — no QFE for the Warsaw Pact aircraft
*Logged 2026-11-09 (Markus, from the MiG-15bis's ВД-15 in the USAF Museum photo) · `core/baro.js` (`baroSubscale`, `qnhField`, `S.baroSet` / `S.baroStd`), the analog altimeters*

The sim sets the altimeter to QNH or to standard (1013.25 hPa). Soviet and Warsaw Pact practice was **QFE** — the airfield's own pressure, the altimeter reading 0 on the runway and the height above the field in the circuit; the setting in mm Hg (760 = standard). The MiG-15bis's ВД-15 shows it in a window at the bottom (about 750 mm Hg in the photo — Dęblin, about 160 m up, sits near that). The MiG, the Tu-95 and the An-225 fly with QNH meanwhile; the MiG's window shows the QNH setting in mm Hg (hPa × 0.750). **Plan — a feature, not now:** a pressure reference per mission or per aircraft (`QNH` / `QFE`), the QFE from the field's QNH and elevation; the knob sets it; ATC and the briefings give the matching figure (Soviet controllers gave QFE in mm Hg). **Done when:** a Warsaw Pact mission can start with QFE set — the altimeter reads 0 on its runway — and its ATC gives the pressure in mm Hg.

## Engine and systems

### One engine per aircraft — done up to stage 4; sound, outside view and training left
*Found 2026-10-11 · `core/engine.js`, `core/yaw.js`, `core/electrical.js`, `core/hydraulics.js`. The full design and the record of each stage, up to 2026-11-06: `git show 6a2dad4:docs/issues.md`*

**Done.** A twin loses one engine and keeps flying on the other, with the yaw and the climb loss to match; the E/WD shows the failed engine; single-engine aircraft behave as before. How it works: `docs/architecture.md` §3.4, §9.

- **Stage 0, 1:** `core/engine.js` owns the engines and the APU; `S.engines[]`, one entry per engine.
- **Stage 2:** control and failure per engine, core / EGT / fuel flow / oil, the V1 failure in the briefing, the electrical layout as data (the A340; the 777 from IEEE and FCOM-style sources).
- **Stage 3:** the yaw axis on the 777: thrust moment, fin and rudder, V_MCA emerging at ~112 kt, TAC.
- **Stage 4:** the hydraulic layout as data (the 777 L / C / R from the FAA handbook; the A340 from the AAIB).

**Left.**
- **Stage 5, sound and outside view per engine.** One voice per engine or per side, panned, so a failed engine is heard; `engine.fanGear` sets the fan and turbine tones; each fan spins and each reverser deploys on its own.
- **Stage 6, training.** The V1-cut mission, ENG FAIL procedure and callouts, engine-out climb and EOSID, single-engine approach and go-around, scoring.

**Rules that still apply.** Test missions don't change much (`lszh-approach` stays the standard airliner test mission), so the V1 cut stays a briefing choice, not a mission edit. Physics takes engine positions from `dimensions`, never from the render geometry. Systems point at engines (`driver`), not the other way round. One layout, three readers: the simulation, the controls, the pages.

**Open from these stages, not logged elsewhere.**
- **Yaw:** the roll from sideslip (dihedral, sweep), which often limits the real V_MCA, and with it a real departure; V_MCG proper (rudder only, nosewheel steering off); crosswind on the ground. To confirm from a primary source: the rudder limiter's values, whether TAC backdrives the pedals or shows on the trim indicator, its EICAS message and disconnect logic.
- **Displays:** a secondary engine page with the oil gauge (Airbus SD ENG / Boeing EICAS secondary); matching the derived ELEC and HYD pages to each aircraft's real synoptic (`pos` hints, the family look in the config cascade).
- **Electrical (777):** simplified: the backup system's single-generator case and autoland isolation, flight-control PSAs / PMGs, load shedding (ELMS).
- **Hydraulics:** the centre isolation system (CHIS), reservoirs and quantity, the demand pumps' other AUTO triggers, the RAT deploying on the loss of all three systems; the A350's own layout (GREEN / YELLOW at 5000 psi, two VFGs per engine), and the A340's RAT and pump buses.
- **Later aircraft:** the A350 with its own KSFO departure, the A320, a DA42 (critical engine, V_MC, the multi-engine rating).

### Airliner fuel system — the layout as data, display-only — done up to part 5 (2026-11-06)
*`core/fuel-system.js` (new), `display/overhead.js` (FUEL section), the ECAM's FUEL figure; `core/fuel.js` stays for the light aircraft*

**Before this work.** Two worlds. The light aircraft (C172, DR400, warbirds) have a simple, working model in `core/fuel.js` — left/right tanks, a selector, burn, starvation that stops the engine. The airliners have none (`S.fuelLeft` is null): the overhead's X FEED and PMP 1 … n buttons write `S` directly and nothing reads them; the ECAM's FUEL figure is invented from the elapsed time (`_fuelPct()`). Each turbofan already computes its own fuel flow (kg/h, `S.engines[i].ff`, stage 2c of *One engine per aircraft*).

**Design — the same pattern as the electrical and hydraulic layouts, kept out of physics.**
- **1 · Data: the fuel layout** in the aircraft file (`fuelSystem`): tanks (id, label, usable capacity in kg), pumps (in a tank, on an electrical bus, a role — `main`, or `override`: the centre tank's pumps, feeding first at their higher pressure), the engine feeds (which tank side feeds which engine), crossfeed valves, a default load (a fraction of capacity — 0.6 until missions or weight and balance set it).
- **2 · One generic solver** in `core/fuel-system.js`: each engine draws its fuel flow — the centre first while its override pumps run and it has fuel, then its own side's tank, the other side's through an open crossfeed; tank quantities fall. `S.fuelSys`; the controls by element (`S.fuelCtl`) through commands (`fuelPump`, `fuelValve`) — the overhead's direct writes of `xfeedOpen` / `fuelPumps` go.
- **3 · Readers from the layout:** the overhead's FUEL section (pumps per tank, crossfeed), a FUEL page (tanks with quantities, pumps, valves, feed to the engines), the ECAM's FUEL figure (fuel on board instead of `_fuelPct()`), cautions (pump low pressure, low fuel, wing imbalance).
- **Units:** kg internally (the Airbus displays kg; Boeing operators choose lb or kg — per-manufacturer display later).
- **Out of scope, kept out of physics:** an empty tank doesn't stop an engine (starvation is the physics step); the burn doesn't change the mass or the CG (*Weight and balance*); no suction feed without pumps (the engine is fed from its own tank anyway, flagged), no fuel temperature, jettison or refuelling.
- **Light aircraft untouched:** `core/fuel.js` keeps its model, which already reaches the engine; onto the same layout later, as its own step. The electric Velis has no fuel at all — its energy is the battery (`core/battery.js`), untouched too (checked 2026-11-04: battery drain identical over 5 min of powered flight).
- **Order.** (1) the schema, the solver and a default layout (two wing tanks and a centre tank, the engines fed by side, a crossfeed) — no visible change; (2) the FUEL page and the ECAM's FUEL figure; (3) the overhead's FUEL section; (4) the 777's own layout with sources — the ACAP for the -300ER's capacity, FAA-H-8083-31B ch. 14 (figure 14-19) for the tank structure; its pumps, crossfeed valves and centre-first logic still need a source (research first); (5) the A340 when a source turns up.

**Part 1 done (2026-11-04):** `core/fuel-system.js` — the layout schema (`fuelSystem`, with reference checks: pumps in known tanks, engines of the aircraft, buses of the electrical layout, a load within 0 … 1), the generic solver and `S.fuelSys`, the controls by element (`S.fuelCtl`, `fuelPump()` / `fuelValve()`), the default layout (a wing tank each side and a centre tank, 30 % of the mass split 30 / 40 / 30 — an estimate; two pumps each; the engines by side; one crossfeed), loaded at 60 %. Ticked after the hydraulics in `core/loop.js`. No visible change yet: the overhead's buttons still write their old fields until part 3. `tests/fuel-system.test.mjs` (the feed order, the burn equal to the fuel flow, pumps without power or fuel, the crossfeed, empty tanks, light aircraft untouched); seeded flights identical.

**Part 2 done (2026-11-04):** the FUEL page — one drawer (`drawFuelPage` in `display/pfd_instruments.js`) from `fuelView()`: the fuel on board, the engines with the tank feeding each (amber SUCT without a pump), the feed line with the crossfeed valve, the tanks with quantity and fill, their pumps (green running, dim off, amber LO PR, white empty); the glass cockpit's lower ECAM steps ELEC → HYD → FUEL (Tab and a click in the centre view — `SD_PAGES` / `nextSdPage`; the main-panel ECAM cycle has it too); `display/ecam.js` draws the same page, its FUEL column opens it, and its systems row shows the fuel on board (tonnes) instead of the invented `_fuelPct()`. Cautions from `fuelCautions()` — pump LO PR (on, no power, fuel in the tank), a feed tank LO LEVEL (below 5 % of its capacity, or the layout's `loLevelKg`), IMBALANCE (the sides apart by more than 2 % of the total, or `imbalanceKg`) — in `S.warnings` as this module's own `FUEL_…` keys (the glass E/WD shows them amber) and on the legacy page — none while the aircraft has no AC power at all (cold and dark the warning system is unpowered), and a mission reset removes them (both found by Markus on 2026-11-04: six LO PR on the cold A340, carried over to the A350). The thresholds are estimates. `tests/fuel-page.spec.js`, `tests/fuel-system.test.mjs`.

**Part 3 done (2026-11-05):** the overhead's FUEL section is built from the layout — a group per tank with its pumps (ON/OFF, FAULT when on without pressure), then the crossfeed valve(s) (OPEN); every click goes through `fuelPump()` / `fuelValve()`; the old `xfeedOpen` / `fuelPumps` writes are gone (nothing read them). No FUEL section on an aircraft without the airliner fuel system (its fuel controls are on its pedestal or panel). The reset now also solves which pumps run, so the first frame shows no false FAULT. On the unpowered A340 every pump shows FAULT (on, no pressure — the same rule as the hydraulic engine pumps on the stand); real annunciators would be dark without power — logged under *Airliner electrical and hydraulics are display-only* (the screens and annunciators follow power), backlog. `tests/overhead-fuel.spec.js`.

**Part 4 research (2026-11-06).**
- *AAIB Aircraft Accident Report 1/2010, G-YMMM (777-236ER), §1.6.8 and §1.6.4:* three tanks — centre, left main, right main; the centre tank has two override / jettison pumps (OJ), each main tank two boost pumps (FWD, AFT); a check valve in each pump's outlet; a pressure switch per pump — advisory when the pressure rise drops below 4–7 psi. The feed manifold is split left / right by **two crossfeed valves, FWD and AFT**; closed with the centre tank feeding, the left OJ feeds the left engine and the right OJ the right. Normal operation with centre fuel: all OJ and boost pumps on; the OJs deliver at a higher pressure, so the centre tank empties first, then the main tanks' check valves open; the crew switch the OJs off. Both boost pumps of a main tank low → the suction feed bypass opens, the engine's LP pump draws from that tank. Surge tanks outboard of the mains (vent only). Centre tank scavenge: jet pumps move the last centre fuel into the mains (below 15,800 kg centre, mains below 12,500 kg) — not modelled. The crossfeed valves are on DC (AFT: captain flight instrument bus; FWD: left main DC). The pumps' buses are not given.
- *FAA-H-8083-31A vol. 2 (2018), fig. 14-19 "Boeing 777 fuel tank locations and capacities":* left / right main 9,560 US gal (64,000 lb) each, centre 26,100 gal (174,900 lb), total 45,200 gal (302,900 lb), usable at level attitude, 6.7 lb/gal. The variant isn't named — the total matches the -200ER / -300 basic tanks, **not the -300ER**.
- *The -300ER — Boeing ACAP D6-58329-2 Rev G (Dec 2024) §2.1.1:* usable fuel 47,890 US gal = 181,283 L = 320,863 lb = **145,570 kg** (the same for the -200LR and the 777F). The ACAP gives the total only, no split by tank. Source documents are kept in `sources/` (local, git-ignored): the ACAP, the AAIB report, the FAA handbook.
- Still without a source: which AC bus each fuel pump runs on.

**Part 4 done (2026-11-06):** the 777's own layout in `aircraft/b777-300er.json` (`fuelSystem`, sources [F1] … [F3] in its `sources_doc`): left / right main 29,060 kg each, centre 87,450 kg — 145,570 kg in total (ACAP); the split assumed (the mains from the FAA figure, the rest in the centre); boost pumps L / R FWD and AFT, the centre's override / jettison pumps CTR L / R (role `override` — the centre first), two crossfeed valves X FEED FWD / AFT (either one joins the sides). Assumed: the pumps' buses (none — any AC power), the overhead labels. The FUEL page draws every crossfeed valve, side by side. `tests/fuel-system.test.mjs` (the 777's capacity, the centre first, the AFT crossfeed alone feeding ENG 1 from the right), `tests/overhead-fuel.spec.js`.

**Done when.** *(met 2026-11-06)* The 777 burns fuel from its tanks as its engines' fuel flow says — centre first, then the mains — the FUEL page and the ECAM show the real fuel on board, and the overhead's fuel pumps and crossfeed are the 777's and work; the light aircraft unchanged.

**Open.** Part 5 — the A340's own layout, once a source turns up (an AAIB / BEA report on an A340 fuel event is the likeliest); until then the default. On the 777, two assumptions to replace when a source turns up: the pumps' AC buses and the split between the tanks.

**Later — left out on purpose.**
- Fuel into physics: an empty tank stops the engine, the burn lowers the mass and moves the CG (*The runtime has no seam for training-grade systems*, *Weight and balance*).
- The crew side of centre-first: the 777 crew switch the centre pumps off when it runs low (FUEL LOW CTR); today they simply stop at empty.
- Centre tank scavenge, jettison, refuelling, fuel temperature.
- The fuel load per mission (today 60 % on every airliner) — with the named starting configuration or weight and balance.
- Units per manufacturer: lb on the Boeing displays where the operator chooses it.
- The other airliners (A350, 737, E190 …) on the default until each has a sourced layout.
- The light aircraft onto the same layout (they keep `core/fuel.js`).

### Airliner electrical and hydraulics are display-only — not implemented yet (intentional)
*Noted 2026-10-11 · `core/electrical.js`, `core/hydraulics.js`*

Bus states (AC/DC/essential, generators, APU, external power, batteries) and hydraulic pressures (GREEN/BLUE/YELLOW) are computed every frame, but only the ECAM, overhead, pedestal and PFD read them. Nothing in the simulation depends on them: gear, flaps, brakes, flight controls, autopilot, displays and COM keep working with all buses and hydraulics dead. **Status: intentional for now** — the systems are modelled for the cockpit first; coupling them to the simulation is future work.

When it's taken up: decide which consumers depend on which bus/system (e.g. COM on DC ESS, gear and flaps on hydraulics, displays on AC), replace the per-panel COM power check in `core/crew.js` with the bus state. The system layouts per aircraft exist (*One engine per aircraft*, stages 2d and 4); the aircraft still on the default are in *Smaller systems items*.

**The screens and annunciators too (Markus, 2026-11-06).** The A340 at its stand starts with every bus unpowered, yet PFD, ND and ECAM draw as normal and the overhead lights its annunciators — the six fuel pumps show FAULT with no power on the aircraft. Displays and annunciator lights should go dark without their bus: first one rule (AC power), later which bus feeds which display unit as data in the electrical layout. Backlog — whether there will be cold-and-dark missions at all is open (*The aircraft's starting configuration …*).

### Light-aircraft electrical is switches only — not implemented yet
*Noted 2026-10-18 · `masterBat`, `masterAlt`, `avionicsOn` in `core/state.js`; `core/engine.js`, `core/crew.js`, `display/panel_renderer.js`, `display/outside.js`*

The C172, DR400 and Velis switches are plain fields: no battery charge, no alternator, no bus. Each consumer checks the switch itself — the COM (`_isComPowered()` in `core/crew.js`), the G1000 screens (`panel_renderer.js`), the C172 lights (`outside.js`) and, since 2026-10-18, the electric starter (`startEngine()` in `core/engine.js`: an `engine.starter: "electric"` needs BAT on). The checks are right as far as they go; what they can't catch: a flat battery, a battery run down by cranking too long or flying with the alternator off, avionics or lights on a dead bus, an alternator failure (a classic training failure). **Fix:** a small electrical model for light aircraft from the aircraft data — battery (capacity, charge), alternator (driven by the engine RPM, `masterAlt`), one bus with its consumers (starter, avionics, COM, lights, fuel pump) — the same pattern as *The cockpit builds itself from the aircraft data*: the consumers read the bus, not the switches. **Done when:** on the C172 a long crank with the alternator off flattens the battery, the starter then won't turn and the G1000 and COM go dark; an alternator failure can be injected.

### Engine values are generic — an engine catalogue per model, from the type certificates — not implemented yet
*Noted 2026-10-18 · `core/engine.js` (core, EGT, fuel flow, oil pressure, windmilling), the E/WD gauges in `display/pfd_instruments.js`, `engine` in the aircraft files*

**Today.** The turbofan model (stage 2c of *One engine per aircraft*) runs on generic values:
- **Overridable per aircraft, but set by none:** `coreIdle` 60 %, `egtIdle` 400 °C, `egtTakeoff` 850 °C, `egtStart` 650 °C, `ffMax` (from the thrust × ~0.3 lb/lbf/h). `idleN1` is set on some.
- **Hard-coded, the same for every engine:** the oil-pressure curve `80 · (core/100)^1.5` and its minimum, 13 psi (a CFM56 figure — now also the GE90's, the Trent XWB's, the PW1000G's); the curve shapes (EGT exponent 1.2, fuel-flow exponent 2.2, the start profile with light-off at 25 % core and 35 % of the start time); the windmill coefficients; the generator threshold (90 % of core idle).
- **In the display:** the E/WD's EGT bands (amber 850, red 950 °C) and N1 limits are fixed in the code — the redlines differ by engine.
- **Thrust (noted 2026-10-23):** `performance.thrustMax` is one number for all engines, static, with no lapse with speed. The 777's is 760 kN (380 kN an engine) — the GE90-115B is certified at ~512 kN. V_MC follows the thrust (∝ √T): the sim's V_MCA ≈ 112 kt would be ~120–125 kt with the real engine and a lapse with speed (stage 3c). The catalogue should carry the rated thrust and a lapse curve.
- An engine model is shared by several aircraft (the CFM56-7 on the 737, the CFM56-5C4 on the A340, the LEAP-1B on the 737 MAX), so its values belong to the engine, not to each aircraft that carries it.

**Fix.** An engine catalogue: one data file per engine model (`engines/ge90-115b.json`, `engines/cfm56-7b.json`, `engines/trent-xwb.json` …), referenced by the aircraft's `engine.model`, as a mission references its aircraft.
- **Content:** the limits (EGT redline, start EGT limit, N1/N2 maxima, oil-pressure minimum), the operating points (idle N1/core, EGT at idle and takeoff, fuel flow), the start parameters — later the sound reference.
- **A schema**, and a `generic-turbofan` file with today's defaults, so no value falls back to the code.
- **The aircraft can override** single values (a derated version, e.g.).
- **The readers:** `core/engine.js`, the E/WD gauge bands, OIL_PRESS.
- **Sources:** the public **EASA type-certificate data sheets** (TCDS) of each engine for the certified limits — official, public documents, as the airport-planning drawings are for the geometry; operating values from published manuals or performance documents. Where none is found, the value stays generic and says so. No invented numbers.

**Done when.** `core/engine.js` and the displays read every engine value from the catalogue (generic or per model); the GE90-115B (the first engine-out aircraft, the 777) has its own file from its TCDS; the E/WD's EGT redline is the engine's.

### A warm engine start is as long as a cold one — the start's phases belong to the engine
*Found 2026-11-07 · `engine.startTime` in `aircraft/bf109.json`, `f4u1a.json`; `tickEngine()` in `core/engine.js`; `startRecording()`, `_assembleStartup()`, `_assembleR2800Startup()` and the R-2800 RPM reading (~line 202) in `core/sound.js`*

**Symptom.** On a warm or hot start the engine stays `starting` for the cold start's length, while the start-up sound is already at idle. R-2800, hot: the sound ends at 37.8 s, the engine runs at 64.1 s — 26 s with no power behind an idling sound.

**Cause — verified (code, measured).** The start's length is kept in three places that agree only when cold:

| Where | Knows |
|---|---|
| `engine.startTime` (aircraft file) | one number — the cold start |
| `startRecording()` in `core/sound.js` | three recordings by oil temperature (< 30 °C, < 60 °C, else) |
| the R-2800 RPM reading in `core/sound.js` | its own copy of the phase times (flywheel 26 / 12 / 0 s …) |

Measured 2026-11-07 (oil 15 / 45 / 75 °C): DB 601 71.16 / 57.16 / 44.86 s, R-2800 64.10 / 50.10 / 37.80 s. The Lycoming (2.8 s), VK-1 (28.5 s) and turbofan (54.7 s) starts have one length and aren't affected. `tests/engine.test.mjs` checks the recording against `startTime` cold only.

**Why the lengths differ is real.** Only the inertia starter's flywheel wind-up changes — thick cold oil, a longer wind-up; a hot engine skips it. Engage, motoring and the run-up stay the same.

**Fix — the engine owns the start's phases.** The start as a sequence of phases in the aircraft data, the oil temperature setting only the one that varies. Shape to decide; with the R-2800's numbers from the sound code (64.1 / 50.1 / 37.8 s):

```json
"engine": { …, "start": {
  "phases": [
    { "id": "flywheel", "time": { "oilBelow30": 26.0, "oilBelow60": 12.0, "else": 0 } },
    { "id": "engage",   "time": 0.30 },
    { "id": "motoring", "time": 2.86 },
    { "id": "runup",    "time": 35.0 }
  ] } }
```

- `core/engine.js` reads the oil temperature once when the start begins, fixes the phase lengths for that start, and keeps the current phase in the engine's state (e.g. `S.engines[i].startPhase`); running when the last phase ends.
- `core/sound.js` plays the phases the engine chose; it no longer reads the oil temperature, and the R-2800 RPM reading reads the phase from the engine instead of its copy of the times — a first piece of *The Engine cell's reading comes from the sound module* (closed 2026-11-09).
- `engine.startTime` goes for these two engines (the one-length starts can keep it, or become a single phase).
- `tests/engine.test.mjs` checks each recording against the phases at all three temperatures.

Rejected: three numbers in `startTime` (`cold` / `warm` / `hot`) — smaller, but the thresholds would live in the engine and in the sound, and the RPM reading keeps its copy.

**Done when.** A warm and a hot restart of the Bf 109 and the F4U run when their start-up sound reaches idle; the oil-temperature thresholds and the phase times exist only in the aircraft data; the engine test covers cold, warm and hot.

### Smaller systems items
*Found 2026-10-11*

- **The MiG-15 has no airbrakes yet.** Its fuselage airbrakes (in / out) aren't modelled. The `spoilers` field (2026-11-07) is the airliners' RET / ARM / FULL with ground spoilers and touchdown auto-deploy, which doesn't fit an in/out dive brake, so the MiG-15 has none — no SPD BRK on its pedestal, `S` does nothing. Needs a shape for the field (e.g. `spoilers.positions`, or an `airbrakes` block with its drag) and a source for the drag.
- **Most turbofans have no hydraulic layout of their own.** The A340 and the 777 have theirs (`aircraft.hydraulics`); the A220, A350, 737, 737 MAX 9 and E190 use the default in `core/hydraulics.js` (GREEN / BLUE / YELLOW, the structure once hard-coded for every turbofan), which isn't theirs (737: A/B/standby; E190: systems 1/2/3; A350: GREEN/YELLOW). Give each a sourced layout when it is needed.
- **`BURN_DEFAULTS` keyed by unused engine types.** `core/fuel.js` has `lycoming-o320` and `r-2800`, but no aircraft uses those engine types (the DR400 is `lycoming-o360`, the F4U `radial-2000hp`); all four fuel aircraft set `fuelBurn` explicitly, so the defaults are never used. Remove them or key them correctly.
- **"Battery" means two things.** `core/battery.js` is the Velis propulsion battery (`batteryCharge`); airliner batteries are `bat1..3` inside `core/electrical.js`. Rename (e.g. `tractionBattery`) to keep them apart.

---

### The MiG-15bis's air-start ignition — a switch, a lamp, an in-flight relight
*Logged 2026-11-09 (Markus, from the MiG-15bis panel — step 8) · `core/engine.js` (the lifecycle, `engineQuit`), `display/leftconsole.js`, the MiG's analog panel*

The MiG has two ignitions: the start ignition, part of the ground start (`E` — the start sequence), and the **air-start ignition switch** for relighting the engine in flight. The procedure: on before take-off (a flame-out on the climb-out relights), off after take-off; a lamp on the main panel is lit while it is on — "В ВОЗДУХЕ ПРОИЗВЁЛ ЗАЖИГАНИЕ — ВЫКЛЮЧИ" (USAF placard: "warning light for engine re-light sw."). Today the sim has neither the switch nor an in-flight relight for the MiG, so the lamp is left off the panel (step 8, Markus). **Plan — a feature, not now:** the switch on the MiG's left console (`S.switches.airStartIgn`), the lamp on the panel reading it, and a relight in flight only with it on (after a flame-out: the engine restarts while the switch is on, the fuel there and the speed enough). **Done when:** the switch and the lamp are in the cockpit, and a flamed-out MiG relights in the air with the switch on — and not with it off.

### The light aircraft's fuel burn ignores the throttle
*Found 2026-11-09 (the MiG-15bis's tank, step 8) · `core/fuel.js` (`tickFuel`, `BURN_DEFAULTS`, `fuelBurn`)*

The aircraft with a simple tank (`tanks` — the Bf 109, the F4U, the C172, the DR400) burn a fixed full-power rate (`fuelBurn` or `BURN_DEFAULTS` by the sound's engine type, l/h) × `S.enginePower` — and the engine's power is 1 whenever it runs, at idle as at full throttle. So they burn their take-off rate on the ground at idle. The turbofans (`S.engines[i].ff` from N1, burned by `core/fuel-system.js`) and since 2026-11-09 the turbojet (`S.engines[i].ff` from the rpm, burned by `fuel.js` through `fuelFlowKgH()`) follow the throttle. **Fix:** a fuel flow per engine for the pistons too — from the rpm and the manifold pressure (with *The supercharger*), or meanwhile from the throttle — and `fuel.js` burns it like the turbojet's. **Done when:** every engine's burn follows its power setting, and a piston at idle burns a fraction of its take-off rate.

### The oil system — quantity, consumption, pressure
*Logged 2026-11-07 (Markus) · `core/engine.js` (`e.oil`, `engineOilLow`), `oilTempC` in `core/physics.js`, the analog panels*

Oil pressure exists only on the turbofans (`e.oil` from core speed); there is no oil quantity anywhere, and the warbirds' oil pressure is a stand-in (`core/engine-gauges.js`, `oilPressure`). **Plan — a system of its own, not now:** per engine type in the data `engine.oil` (capacity, consumption, pressure limits — from the manuals); per engine in the state `oilQty`, falling with consumption, a leak or damage; pressure from rpm (engine-driven pump), oil temperature (cold → high) and quantity (low → the pump starves); no pressure → the engine seizes after a while (like the Bf 109's coolant leak). It pays off beyond the gauge: the Avro's Le Rhône is a total-loss system — the castor oil burns, the tank sets the endurance, and the oil pulsator pulses while oil flows; the airliners get OIL QTY and a cause for OIL PRESS.

**First step — oil temperature and pressure per engine, every engine type** *(logged 2026-11-09, Markus, from the Tu-95's engine grid)*. Today `S.oilTempC` is one value for the aircraft (`core/physics.js`: a first-order lag, 40 °C at idle → 115 °C at full throttle, τ 3 min warming / 10 min cooling, toward 15 °C at rest) and it follows the aggregate `S.engineState` — "running" while any engine runs. So the Tu-95's four oil temperature dials show the same number, and a stopped engine's oil stays warm while the others run; the same on every multi-engine aircraft that will show it (the An-225, the DC-8). No turbofan has an oil temperature at all (only `e.oil`, the pressure), and no glass display shows one. Readers of `S.oilTempC`: the analog panels, the R-2800's start curve (its flywheel time by the oil temperature, `core/engine.js`), `core/sound.js`. **Plan:** `oilTemp` per engine in `S.engines[i]`, lagged in `tickEngine` from the engine's own state and power (the same targets and time constants to begin with, the ambient from the outside air like the cooling model); `S.oilTempC` derived from the array like the other single fields, so the single-engine readers stay; the panel's `oilT` reads engine *i*; the mission's warm start (airborne → 75 °C) per engine. **The turbofans too:** they get the same per-engine oil temperature (none today), ready for an ECAM/EICAS oil readout. **Oil pressure — the turbofans' pattern for all:** every engine already carries `S.engines[i].oil` (psi), but only the turbofans fill it (from the core's speed, `core/engine.js` `_gaugesAtLoad`), and only they run the low-pressure check (`engineOilLow` → OIL PRESS; `core/fuel.js` checks it for turbofans only). Pistons and turboprops fill the same field from their own rpm (`S.engines[i].rpm` — the crankshaft- or rotor-driven pump), so the stand-in `oilPressure(i)` in `core/engine-gauges.js` goes, the low-pressure check works for every engine type, and the state keeps one unit (psi — the metric dials convert to kg/cm²). **Done when:** a stopped engine's oil cools while the others stay warm, every engine of every type has its own oil temperature and pressure in `S.engines[i]`, every oil dial shows its own engine, and `core/engine-gauges.js` has no oil pressure stand-in left.

**Done when:** every engine's oil pressure and quantity come from this system, and an oil leak ends like the coolant leak.

### The fuel system — fuel pressure
*Logged 2026-11-09 (Markus, analog panel step 5) · `core/fuel.js`, `S.fuelShutoff` / `S.fuelStarveT`, the analog panels*

No fuel pressure in the sim. D-FEML's panel has a fuel / oil pressure gauge (Fl 20512-2: fuel 0–2 kg/cm²), so until a fuel system exists the panel shows a **stand-in**: the engine-driven pump gives a normal pressure while the engine runs with fuel available, builds it up on the start, and lets it fall to 0 over the starvation time once the fuel cock is closed or the tank is empty (`S.fuelShutoff`, `fuelLeft` / `fuelRight`, `S.fuelStarveT`) — so the pressure drops before the engine quits. The normal value is unconfirmed (to source: the DB 601 A manual). **Plan — a system of its own, not now:** fuel pressure per engine from the pump (engine-driven, electric booster where fitted), the tank, the selector and the cock; a failing pump or a blocked line as failures. **Done when:** the fuel pressure gauge reads the fuel system, and a pump failure starves the engine.

### The supercharger — manifold pressure and boost
*Logged 2026-11-07 (Markus) · `core/engine.js`, `core/physics.js` (thrust), the analog panels*

Manifold pressure is drawn from a formula in the drawing code (`_drawManifold`: `12 + throttle × 40` inHg); the power comes straight from the throttle. **Plan — a system of its own, not now:** `S.engines[i].map` (one unit, kPa; the panel shows ata or inHg by its style) from the throttle, the rpm, the ambient pressure (altitude, QNH) and the supercharger in the data — e.g. `engine.supercharger: { type, criticalAlt, maxBoost, unit }`: the DB 601A single-stage with a fluid coupling and a boost regulator (ata; take-off about 1.3–1.35 ata — to source from the Bedienungsvorschrift), the R-2800 two-stage two-speed (inHg; take-off about 54), the Lycomings without (below ambient, falling with altitude). In two stages: first the value (shown, not yet driving anything), then the power from manifold pressure and rpm — weaker above the full-throttle height, overboost with consequences; this touches the thrust and every piston aircraft's calibration. **Done when:** the boost gauge reads `S.engines[i].map`, and the power falls above the full-throttle height.

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

---

## Display

### `renderTerrain()` is one 2,840-line function
*Found 2026-10-11 · `display/terrain.js`, `renderTerrain()` (line 615 to ~3,450, checked 2026-11-06)*

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

### The E/WD's warning display — Airbus layout done, Boeing EICAS later
*Done 2026-11-04 (found by Markus: six fuel LO PR cautions large at the top left of the E/WD) · `core/alerts.js` (new), `_ecamWarnZone` / `_ecamMemoZone` in `display/pfd_instruments.js`*

**Was.** The E/WD put the warning messages in a band at the top (28 % of the height, above the engines), bold at 5.5 % of the height — the largest text on the screen — about four lines with no overflow handling (more ran into the engine display), in the order raised, and each alert's colour guessed from its name (`LOW…` / `FUEL…` amber, everything else red — the glareshield's MASTER WARN / CAUT the same), so a hydraulic caution would have come out red.

**Now.** `core/alerts.js`: an alert's value in `S.warnings` is its level — `'warning'` (red) or `'caution'` (amber); the older writers' `true` keeps the name rule. `activeAlerts()` lists them warnings first; `publishAlerts(owner, …)` / `clearAlerts(owner)` let each module replace and clear only its own keys (the fuel system and the hydraulics use it). The E/WD in the Airbus layout: the engines on top (60 %), below them the messages on the left at memo size — red warnings first, amber cautions, `▼ n MORE` when they don't fit — and the memos in a column on the right; the glareshield lights read the levels. (The dim "NORMAL" with no alerts is gone — the real E/WD shows none.) `tests/alerts.test.mjs`.

**Later.** The Boeing EICAS layout — the alert messages in a column at the upper right beside the engine gauges, warnings / cautions / advisories — with the per-manufacturer look (the 777 shows the Airbus glass for now — the accepted compromise). The older `true` writers (`core/fuel.js`: `OIL_PRESS`, `LOW_FUEL`, `FUEL_SHUTOFF`) onto levels; message texts separate from keys.

### The mission clock covers the left end of the FMA
*Found 2026-11-06 · `#mission-clock` and `#mission-title` in `index.html`; the FMA strip of the PFD*

On the glass airliners the clock sits at top 90 px, left 20 px, over the FMA's first column: `A/THR` can't be read behind it, and it touches `AP1` (A350 at 1600 × 900). That's flight information. **Done when:** the whole FMA can be read with the clock showing, on every glass cockpit and in the combined view.

### The glass screens run underneath the status bar
*Found 2026-11-06 · `#pfd`, `#nd` (`body.panel-dual … height: 91vh`), `#panel` (80 px, translucent) in `index.html`*

Outside the combined view the screens go to the bottom of the window, under the strip. The bottom of the PFD's heading tape is cut off, and the ND's VOR and DME text shows through the strip's cells. The combined view already leaves room (`calc(50vh - 80px)`). **Done when:** no instrument is drawn under the strip, in any view.

### A status bar cell wraps on the F4U
*Found 2026-11-06 · `.panel-section` in `index.html`*

The warbirds have two more cells (Fuel L/R, Fuel Sel). At 1280 px the F4U's `375 / 375 L` breaks onto two lines; the Bf 109 and MiG-15 no longer do, since the Display and Audio cells went (measured 2026-11-06). `tests/status-strip.spec.js` only checks that nothing overflows. **Done when:** every cell stays on one line at 1280 px, on every aircraft with the bar.

### The DC-8's analog panel is a stand-in
*Logged 2026-11-10 (Markus, closing the analog panel plan) · `aircraft/dc8.json` (`analogPanel`), `display/analog_panel.js`*

The analog panel work (plan in steps 1–8, 2026-11-07 to 2026-11-10 — the design now in docs/architecture.md §5.2) gave every analog aircraft its own sourced panel except the DC-8: a nose-only stub without a mission (`_status`), its panel a stand-in like the An-225's — the flight block and a turbofan engine grid (N1, EGT, oil temperature and pressure per engine) in the `usn` style. **Plan:** when the DC-8 gets a mission (and its variant — JT3D or CFM56), research its cockpit like the others (a photo, the manual), read dial by dial, and build its panel from it. **Done when:** the DC-8 draws its sourced instruments in its groups and order.
### The analog instruments have no knobs
*Logged 2026-11-09 (Markus, from the F4U's remote compass — step 8) · `display/analog_panel.js`, the cockpit views, `core/keymap.js`*

No knob on an analog instrument does anything in the sim. The real ones did: the F4U's remote compass has a course-setting knob (it turns the course setter, two parallel arrows — fly with the heading pointer between them); the altimeters' setting knobs (the F4U's in. Hg window, the MiG's mm Hg window, D-FEML's pressure window); the directional gyro's caging and setting knob; the АГК-47Б's cage and pitch knobs; the clocks' winding and stopwatch buttons. Meanwhile the F4U's course setter shows the mission's course (Markus). **Plan — a feature, not now:** the knobs as controls — a click on the dial in the panel view (or keys), each setting a value in the sim (`S.courseSet`, the altimeter setting already in `core/baro.js`, a gyro's caged state). **Done when:** the course setter and an altimeter's setting can be turned in the cockpit and the dial follows.

### The METAR strip always says LSZH
*Found 2026-11-06 · `updateMetar()` and `_rwyFromWind()` in `index.html`*

The strip's text starts with a literal `LSZH`, and its runway comes from a table for Zürich (`28`, `10`, `34`, `16`), wherever the mission is. It shows on the default panel (Avro 504, An-225, Tu-95, DC-8): the Avro over the Marne reads `LSZH Z · RWY 28`, the An-225 at Hostomel `LSZH Z · RWY 16` (seen 2026-11-06). The time is empty too, without a live report. The strip sits under the mini-map's corner when the map is open. **Fix:** the station from the weather source, the runway from the mission or left out. **Done when:** the strip names the mission's own station, and no runway it doesn't have.

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

### Velis electric motor plays the geared-turbofan sound
*Found 2026-10-11 · `ENGINES` in `core/sound.js`; `startSound('electric')` when the motor runs*

The Velis's `sound.engineType` is `"electric"`, but `ENGINES` has no `electric` preset; `initSound()` / `startSound()` fall back to the geared-turbofan preset (`_preset()` in `core/sound.js`). **Cause — verified (code), not yet heard in the sim.** **Fix:** an `electric` preset (motor whine + prop, no combustion — the removed `edf-hovercraft` preset used `slewTime: 0.04`, "electric motors spool almost instantly"), calibrated against a Velis recording (`docs/sound-calibration.md`). Since 2026-10-13 the fallback is visible: the console warns `[vocab] unknown engine sound "electric"`, and the sound coverage check in `core/sound.js` exempts `electric` with a pointer to this entry. **Done when:** the Velis sounds like an electric motor, and `electric` is no longer exempt from the `ENGINES` coverage check. (An unknown `engineType` already fails the data schema.)

### Comm profile names outside the profile table
*Found 2026-10-11 · `PROFILES` in `core/radio.js`; `missions/crew-demo2.json`*

- **`sband-crew` is planned but not defined yet.** `crew-demo2` sets `characters.crew.commProfile: "sband-crew"`; `docs/audio-chain.md` lists it as *"add when H4n recordings land"*. No effect today — the crew lines are TTS, and TTS ignores profiles — but until it's defined, recordings for the crew would play as `vhf-aviation` (`createRadioChain()` falls back, with a console warning since 2026-10-13). It's on the schema's known list (`core/schema/known.js`). Fix: define it together with the recordings, then remove it from the known list.
- **`broadcast` is valid but special-cased.** It's a dry bypass for narrators, handled by `profileName === COMM_PROFILE.BROADCAST` in `playThroughChain()` instead of being an entry in `PROFILES`. The valid names are in one place now (`COMM_PROFILE` in `core/vocab.js`; the `PROFILES` coverage check exempts `broadcast`). Optional: a `PROFILES` entry with a `bypass: true` flag would remove the exemption.
- **`COCKPIT_PROFILES` in `core/crew.js` lists `cockpit-c172`**, which isn't a radio profile.

**Done when.** Every `commProfile` value in missions/aircraft is a key of `PROFILES`; unknown names fail validation.

### The audio switch (`X`) is untested on most orbital missions
*Noted 2026-11-06 · `setAudioMuted()` / `_respeak()` in `core/audio.js`*

**Tested in the browser (Markus, 2026-11-06).** `X` cuts a line at once and the script carries on: spoken on Demo-2, a recording on `nordmeer-1956`, ATC callouts on aircraft, and an engine start. (One earlier run where a line played on to its end didn't repeat.) The tests can't cover this: speech doesn't work in headless Chromium, so `tests/audio-output.test.mjs` uses a stand-in engine.

**Not tested yet.** The other orbital missions mix the sound paths: `inspiration5` (133 recordings, ambient audio), `apollo8` (12 ambient, 18 spoken), `apollo13`, `crs1` (radio loops). Also `X` during time warp. The mute carries over between missions; `AUDIO OFF` under the mission clock shows it on every vehicle.

**Done when.** Every orbital mission above goes silent and comes back correctly, and the script's later lines still fire.

### A missing audio clip can stop the `after` chain
*Found 2026-10-12 · `atcClearances` dispatch in `core/crew.js` (the `clr.audio` branch, `_safeSpeak()`)*

**Symptom.** A clearance with `trigger: { type: "after", idx: N }` fires only once clearance N has *ended*. When N's `audio:` clip is missing, the follow-up line never fires. The README promises "If an `audio:` file is missing, the mission falls back to TTS automatically" — the line itself does fall back, but the chain behind it stops.

**Reproduce.** In a checkout without the gitignored `audio/` folder (e.g. a fresh clone or `git worktree add`), run Inspiration5 in test mode for 1 200 s and log `[crew] ATC fire idx=`: 64 clearances fire, against 70 with the clips present. The six missing ones (idx 13, 17, 40, 55, 57, 75) are all `after` triggers whose predecessor has a missing clip (`gl_startup`, `mc_ldgo`, `gl_meco`, `mc_1bravo`, `mc_staging`, `mc_2bravo`).

**Cause — verified in headless Chromium; not yet checked in a real browser.** `_atcEndedAt[idx]` — what `after` waits for — is set by the clip's `onEnded`, or in the fallback by the utterance's `u.onend`. If the utterance never ends normally, nothing sets it: `_safeSpeak()` returns silently when `speechSynthesis` is undefined, there's no `u.onerror` handler, and there's no time-based fallback. Headless Chromium's speech doesn't complete, so the chain stops there; in a real browser it could stop the same way on a speech error or on Chrome's known long-utterance `onend` bug.

**Still so (checked 2026-11-06):** `core/crew.js` sets `onend` on its utterances and never `onerror`; `speak()` in `core/audio.js` only passes on what is there. Look at this together with *The audio switch (`X`)*, which replaces running lines.

**Why it matters.** Anyone who clones the repo has no `audio/` folder, so mission scripts that chain with `after` lose lines silently. Tests can't see the chain either.

**Fix.** Mark the clearance ended on every way speech can finish: `onend`, `onerror`, no `speechSynthesis` (immediately), and a fallback timer from the text length and rate (whichever comes first, once). **Done when.** Inspiration5 without `audio/` fires the same clearances as with it (70), in test mode.

### Pause holds the sound — done
*Found 2026-11-07 · `setAudioPaused()` in `core/audio.js`, called from `core/loop.js`*

**Symptom (confirmed by Markus, 2026-11-07).** A pause during a running clip, with `P` or with the key map up, let the recording run on while the clock stood; afterwards it was ahead by the length of the pause.

**Fix (built 2026-11-07, Markus: pause stops *all* sound).** The loop sets `setAudioPaused(S.paused)` every frame. Pause suspends the one context (engine, recordings, radio, GPWS, tones hold mid-sample), pauses the playing clips and the speech; unpause continues all of them where they stood. A key during a pause doesn't wake the context; leaving a mission ends the pause. Test: `pause holds every sound with the clock…` in `tests/sound-output.spec.js` (fails on the old code).

**Heard correct (Markus, 2026-11-07).** Apollo 8, paused during the launch commentary: it stops, and is on the clock afterwards. TTS callouts stop and continue, in Safari too (macOS); in Safari also the engine and the recordings.

**Not heard.** Speech on other platforms: `speechSynthesis.pause()` is known to cancel instead on some (a line would be lost, or its `after` chain stop). Nothing to do unless it shows up.

### Smaller sound items
*Found 2026-11-07, in the check that all sound goes through `core/audio.js` (it does)*

- **`getAudioContext()` in `core/sound.js` has no callers left.** Crew audio used it until 2026-11-07, and was silent whenever the engine sound was off. Remove it so nothing new picks it up; `audioContext()` in `core/audio.js` is the one context.
- **`_streamAudio` in `display/com.js` (the LiveATC stream) is cleared but never set.** `_stopStream()` and the `com-live-ind` indicator are left over; remove them, or bring the stream back on purpose.
- **One-shot sounds aren't stopped when a mission is left:** the GPWS voice, the whoop, the PTT click and the warning tone. They last a second or two and just finish, so it doesn't matter; noted so the list of what `resetCrew()` stops is complete.

---

## Training

### The failure choice, rethought — not implemented yet
*Noted 2026-10-18 · `failurePresets()` / `failureEntries()` / `buildSetup()` in `app/briefing.js`; the briefing strip in `index.html` (`_bpFails`, `.bp-timing`); `core/failures.js`; `_computeEmergScore()` in `index.html`*

**Today.** The briefing offers one failure per flight, from four presets that are all about engine power ("50 % power · 30 s", "30 % power · bang", "Full failure"; carb icing where there is carb heat), at a random time (60–300 s) or a fixed time. `failureEntries()` turns the pick into `engine_power` / `engine_bang` / `carb_ice` entries for `core/failures.js`, which triggers on time or altitude. The debrief scores it as a glider: best glide speed after the failure (`_computeEmergScore()`). That fits a single piston engine; it doesn't fit a twin (the task after an engine failure is V2 and the engine-out climb, not best glide), and it doesn't reach any system but the engine.

**The general shape.** A failure is four independent choices:

| Choice | Today | General |
|---|---|---|
| **What** | engine power presets | a catalogue **derived from the aircraft data** — only what the aircraft has and the sim simulates: per engine power loss, flameout, fire, seizure (liquid-cooled), carb ice (carb heat); a generator, a battery, the alternator (light aircraft); a hydraulic system; later instruments (pitot/static, AHRS), gear, flaps, flight controls. The same pattern as *The cockpit builds itself from the aircraft data*: a system brings its failures, as it brings its controls |
| **Where** | — | which engine / which side / which system (`engine: 1`, a source id from the system layout like `gen1a`); or random, so the pilot has to identify it |
| **When** | random 60–300 s, fixed s | **by flight phase** rather than by seconds — at V1 (the takeoff roll), after rotation, in the climb, cruise, on the approach, below 1 000 ft — or a time or altitude; a random time *within* a phase. Seconds since mission start mean little on a long-haul |
| **How** | ramp time, optional bang | sudden, gradual, intermittent (rough running), with or without a cue (bang, vibration) |

**Also:**
- **Combat damage** on the warbirds is a failure kind of its own (gunfire, then the hits), not an engine failure — the generic presets dropped their gunfire on 2026-10-18; `wolfskopf-1942` scripts it as part of its story.
- **More than one failure** per flight, and "a random failure from a category" (engine, electrical, hydraulic …) — the pilot doesn't know what's coming.
- **Live failures by the instructor.** `S.role` already has INSTRUCTOR (R key); an instructor view could trigger failures during the flight, not only before it — the shape multi-crew needs too (*Multi-crew — not implemented yet*).
- **One data format.** The pick generates ordinary mission `failures` entries, so a fixed-story mission and a pilot's pick run through the same code (`core/failures.js`, the schema, `core/vocab.js`). Rocket failures keep their own key (*Overloaded fields in the JSON data*).
- **The debrief follows the failure.** Per failure what is expected: best glide (single engine), V2 and the engine-out climb (multi-engine), the ECAM/EICAS procedure. Links to the training-procedures backlog (RTO/V1, engine-out, EOSID).
- **Persistence.** A failure stays until the mission is reloaded (a restart doesn't heal it — `core/engine.js` power factors); a repair or reset belongs to the instructor.

**First steps that don't need the rewrite.** Stage 2b of *One engine per aircraft*: "at V1" as a timing for missions that start on the ground, and the engine to fail (ENG 1 … n / random) on multi-engine aircraft — added to the existing strip. Everything else waits for this entry.

**Done when.** The briefing's failure choice is built from the aircraft's systems (no hard-coded preset list), offers what / where / when (by phase) / how, can combine failures and pick one at random from a category, and the debrief scores the failure that was flown.

### Takeoff performance: V1, VR, V2 per takeoff — not implemented yet
*Noted 2026-10-18 · `performance.Vr` in the aircraft data; `_vSpeeds()` in `display/pfd_instruments.js`; kneeboard texts (`a340`, `an225`)*

**Today.** VR is a fixed number per aircraft (`performance.Vr`); there is no V1 and no V2 — a few kneeboards print them as text (A340: "V1: 162 kt Vr: 165 kt V2: 181 kt"). The stall speed and VLS are already computed, from mass, wing area, `CL_max` and the flaps (`_vSpeeds()`). The jets have one fixed `performance.mass` and burn no fuel. Stage 2b of *One engine per aircraft* uses **V1 = VR** for the "at V1" failure — an interim value, clearly marked.

**Real world.** V1 is worked out for every takeoff from the weight, the runway (length, slope, wet/dry), wind, temperature, pressure altitude, flaps and thrust (full or derated), with V1 ≤ VR and V1 ≥ VMCG; the crew enters it in the FMS (Airbus PERF TAKEOFF, Boeing TAKEOFF REF) and it shows as a bug on the PFD.

**Fix.** A takeoff-performance module in `core/` that computes V1 / VR / V2 for the takeoff about to be flown:
- **Inputs** the sim already has: runway length and elevation (bundled runway data), temperature and wind (METAR), flaps, thrust, mass.
- **VR / V2** from the computed stall speed in the takeoff configuration (V2 ≥ 1.13 VSR).
- **V1 from the sim's own physics** — the balanced field: play the stop case (engine failure at V, brakes, reversers, spoilers) and the go case (continue on N−1 to 35 ft), and find the speed where both need the same runway. VMCG comes with the yaw axis (stage 3).
- **Readers:** the briefing, the MCDU PERF page, the PFD speed bugs, a "V1" / "rotate" callout, the "at V1" failure trigger, and the RTO / V1-decision training.
- **Weight** only matters once the jets have fuel and payload (out of scope so far); until then the fixed `performance.mass` is the takeoff weight.

**Done when.** On the 777 at WSSS the briefing and the PFD show V1 / VR / V2 for the runway and weather of the day; a hotter day or a shorter runway changes them; and the "at V1" failure fires at that V1.

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
4. Vehicle contract and per-engine state — when the training work needs them. **Per-engine state done** (2026-10-18 … 2026-10-21, *One engine per aircraft* stages 1–2: `S.engines[]`, owned by `core/engine.js`); the vehicle contract is still open.

### `S` has no field ownership
*Found 2026-10-11 · architecture review (`docs/architecture.md` §6.1, §9.2)*

**Symptom.** `S` is one mutable object with ~150 fields. `setState` is `Object.assign` (~250 calls), and ~50 direct writes sit beside it (44 in `display/`, nearly all the outside view's camera; counted 2026-11-06). No field has a declared owner, so several modules write the same field and the last writer in the frame wins. The comment at the top of `state.js` (only physics, input, mission write) is out of date. On top of that, modules keep private state between frames (fired entries, ramps, caches), cleared by hand-written `reset*()` functions.

**Evidence.** ~~*`enginePower` has many writers and no composition*~~ (done 2026-10-18: `core/engine.js` composes it from factors); ~~*Engine start completes when the start-up sound finishes*~~ (done 2026-10-18: `core/engine.js` owns `engineState`); *The outside view borrows the flight state for its camera*.

**Why it matters.** Correctness depends on the order of the frame loop and of the ~30 closures in the renderer list. A new feature can't tell whose field it is about to overwrite.

**Fix.** Give each field group one owning module (documented in `state.js`, next to the defaults). Others request changes through that owner (e.g. `enginePower` composed from contributions: failure × carb ice × fuel × battery). Displays read only. Optional dev-mode guard: a `Proxy` on `S` in test mode that logs writes from non-owners.

**Progress (checked 2026-11-06).** New owners with commands since the review: `core/engine.js` (engines, APU — `engineMaster`, `apuMaster` …), `core/electrical.js` (`S.elec`, `S.elecCtl` — `elecSwitch`, `elecIdgDisconnect`, `elecBusTie`), `core/hydraulics.js` (`S.hyd`, `S.hydCtl` — `hydPump`), `core/fuel-system.js` (`S.fuelSys`, `S.fuelCtl` — `fuelPump`, `fuelValve`), `core/yaw.js` (`S.tacOff` — `tacSwitch`; the yaw state `beta` / `yawDev` / `latAccel` / `tacRudder` written by `core/physics.js`), `core/input.js` (`rudder`, `rudderTrim`). The overhead's ELECTRICAL, HYDRAULICS, FUEL and FLIGHT CONTROLS controls go through them. **Still written directly by `display/overhead.js`:** `engFireArmed`, `engAgents`, `apuBleedOn`, `apuAgent`, `cockpitView` (6 places) — the fire and APU bleed controls and the view; the controls go with *The cockpit builds itself from the aircraft data*.

**Done when.** Every field group in `state.js` names its owner; no display module writes `S` except through an owner's API; a test-mode write check passes.

### Shared products are computed per consumer, not owned once
*Found 2026-10-11 · architecture review (`docs/architecture.md` §7.4, §10.1, §10.5)*

**Symptom.** Products that several modules need are rebuilt by whoever needs them instead of being computed once and stored:
- ~~the flight plan~~ — done 2026-10-13: `core/flightplan.js` owns it (`S.flightPlan`); LNAV, VNAV, the ND, the MCDU and the briefing read it, and `setArrivalRunway()` amends it in flight;
- ~~the taxi route~~ — done 2026-10-13: `core/taxi.js` owns it; the map draws it, com.js phrases it, pushback follows it;
- "ground": the field elevation of the nearer airport, recomputed each tick (*The ground is flat*). (The DEM elevation now has an owner: `core/elevation.js`, sampled once per tick — done 2026-10-13.)

**Why it matters.** Copies can disagree, nothing can be amended (no route to re-clear in flight), and a product disappears when the consumer that happens to produce it isn't running.

**Fix.** One rule for new work: a product used by more than one module gets an owning `core/` module that computes it when its inputs change and stores it; consumers read. The single entries above are the instances.

**New products follow the rule (2026-11-04).** The electrical and hydraulic state is solved once per tick by its owner (`S.elec`, `S.hyd`); the displays read views the owner provides (`hydView()`, the ELEC page's reading of `S.elec`) — recomputed per call from owned state, cheap, never by the consumer's own logic. The airframe geometry (`core/airframe.js`) and the yaw model (`yawModel()`, cached per aircraft) likewise.

**Done when.** The three instances are closed, and the rule is written in `architecture.md`.

### No vehicle contract
*Found 2026-10-11 · architecture review (`docs/architecture.md` §3.1, §8)*

**Symptom.** One JSON shape and one `S` cover aircraft, rockets and robots, and each vehicle type is handled by `if` branches spread across modules:
- rockets reuse fields with different meanings (`S.pitch` = flight-path angle, `S.spd` = total velocity);
- selectors are inconsistent: `so101.json` and `yertle.json` still carry a top-level `type` no code reads (since the hovercraft removal, `vehicleType` is the only physics selector), `panel: "airbus"` on the Boeings, `engine` as object or string;
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

**Progress (checked 2026-11-04) — the first half is met.** *One engine per aircraft* stages 1–4: per-engine state (`S.engines[]`, `core/engine.js`), thrust summed per engine, the yaw axis (`core/yaw.js` — thrust asymmetry, windmilling drag, rudder, V_MCA emerging, TAC), so an engine fails on its own on the 777 and it yaws and loses thrust. The electrical, hydraulic and fuel systems are now solved from layouts per aircraft (`S.elec`, `S.hyd`, `S.fuelSys`) — but beyond power for the electric pumps and the engine and APU starts, they still only feed the displays: **the second half is open** (checked 2026-11-06). That is the seam still to design: a defined path from a system's state to what physics and the controls can do — brake pressure and anti-skid, nosewheel steering, gear and flap actuation, flight-control authority (per surface, by hydraulic system), the electrical consumers. It decides what a hydraulic or electrical failure *means* in the sim, and it is what the abnormal-procedure training needs next (*Airliner electrical and hydraulics are display-only*).

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

**First instance.** The multi-engine work (*One engine per aircraft*, stages 2 and 4): engine controls, generators and hydraulic pumps on the 777 (then the A350), derived from their data. The rest of the overhead (lights, anti-ice, pressurisation, ADIRS …) follows the same pattern later.

**Done when.** A new airliner that fits its manufacturer's rules gets a complete, working overhead, pedestal and centre view from its systems data alone, with no token list and no zone-specific code.

**Progress (checked 2026-11-06).** The first instance is done for the overhead: its ELECTRICAL section (stage 2d), HYDRAULICS section (stage 4), FUEL section (*Airliner fuel system*, part 3) and FLIGHT CONTROLS section (the TAC switch, only where the data has a TAC — stage 3d) are built from the aircraft's layouts, one control per element, each sending a command to its owner (*node + action*). The 777 and the A340 show their own generators and hydraulic pumps, and the 777 its own fuel pumps and crossfeed valves (the A340's fuel, and all of the A350's systems, still the default structure — no layout of their own yet); the ELEC, HYD and FUEL pages come from the same layouts. Still code: APU, the fire handles (they also write `S` directly — see *`S` has no field ownership*), the placement into zones (layer 3 — no manufacturer rules yet), the pedestal, the consoles and the centre view.

**Where switches are drawn today (checked 2026-11-07).** Five places, two techniques (canvas, HTML), each with its own state names:

| Where | Aircraft | Drawn | A click |
|---|---|---|---|
| `display/velis_epsi.js` — `_velisKey()`, `_velisToggle()` | Velis | canvas, positions in the module | writes `S.switches.master / battEn / pwrEn / avionics` |
| `display/pedestal.js` — `_toggle()`, `.ped-toggle` CSS | C172 (`pedestal` tokens `switches`, `lights`, `breakers`, `magneto` …) | HTML | writes `S.masterBat / masterAlt / avionicsOn / fuelPump`, `S.lights` |
| `display/panel_renderer.js` — `_drawRockerStrip()`, `_drawBottomSwitches()`, `_drawMagnetoKnob()` | DR400 (widgets in `panels/dr400.json`) | canvas widgets, placed by the panel JSON | `_toggleSwitch(key)`, writes `S` |
| `display/overhead.js` + `display/pushbutton.js` | airliners | HTML pushbuttons, one per element of the system layout | a command to the owner (`elecSwitch()`, `hydPump()`, `fuelPump()`) |
| `display/leftconsole.js`, `rightconsole.js` | Bf 109, F4U, MiG-15 (`left` / `right` tokens) | HTML | writes `S` (fuel cock, cooling flaps, breakers, oxygen …) |

- **The looks may differ — they are layer 4.** The duplication is the problem: the Velis toggle and the C172 toggle are one design (bat handle, LED, label, lever `#9eaabf`) written twice, on a canvas and in CSS, so a fix to one doesn't reach the other (the Velis labels were 5 px while the C172's were fine — fixed 2026-11-07).
- **One switch, several names.** The battery master is `S.switches.master` on the Velis and `S.masterBat` on the C172, so readers branch on the panel (`_isComPowered()` in `core/crew.js`).
- **Only the overhead is node + action.** The others write `S` directly (*`S` has no field ownership*).
- **Missing:** one switch component per technique (canvas, HTML), its look a parameter from the style; every control a command to its owner.
- **First step:** the Velis onto the electrical solver (`core/electrical.js`) — its four switches become `elecSwitch()` commands; the C172's follow.

### Overloaded fields in the JSON data
*Found 2026-10-11 · `aircraft/*.json`, `missions/*.json`; left over from the data-contract work (2026-10-13)*

The data now has a schema (`core/schema/`, checked by `npm test` and at load), but these fields have two meanings, and the schema has to accept both:
- ~~**`engine`** an object on the jets, a descriptive string on the others~~ — done 2026-10-18: one object on every aircraft (`type`, `count`, `model`, `description`).
- **`timeOfDay`** is hours, or a day fraction when < 1 (`display/terrain.js`).
- **A `failures` entry** goes to `core/failures.js` or `core/rocket.js` depending on whether it has a `trigger` key.

**Fix:** one shape each — e.g. `engine` always an object (the description as `engine.model` / documentation), `timeOfDay` always hours, rocket anomalies under their own key. One field at a time; the schema then drops the second shape. **Done when:** none of them needs an `anyOf` in `core/schema/`.

### Name comparisons still spelled out by hand (data-contract stage 3b)
*Noted 2026-10-13 · `core/vocab.js`; comparisons in `core/`, `display/`, `index.html`; since 2026-11-06 also `app/briefing.js` (`_ownKeys()`) and `updatePanel` in `index.html`*

Stage 3a put the shared names in `core/vocab.js` and made the five dispatch points (triggers, rocket events, failures, comm profiles, engine sounds) check themselves against it. The plain comparisons were left for later: about 90 literals (counted 2026-11-06; about 180 when noted) like `panel === 'airbus'` (32), `vehicleType === 'rocket'` (43) and `engineType === 'lycoming-o360'` (16), much of it in `index.html`. Each is a place where a typo compares silently false — two were found and fixed on 2026-11-07: the Velis COM (`'velis'` for `'velis-epsi'` — its radio was always on, whatever the switches) and the F4U's start-up sound (`'radial-2800hp'` for `'radial-2000hp'` — the Corsair played the DB 601 start). **Fix:** replace them with `PANEL.X` / `VEHICLE.X` / `ENGINE.X` from `core/vocab.js` (a misspelled name throws). Can go together with the `index.html` rewrite. **Done when:** `grep -nE "(panel|vehicleType|engineType)\s*[!=]==\s*'" core display index.html` finds nothing.

### Vehicle- and mission-specific special cases in generic core modules
*Found 2026-10-11 · architecture review*

Generic modules branch on specific missions, aircraft and panels by name, instead of reading a property from the data:

| Where | Check | Could be data |
|---|---|---|
| `core/failures.js` `tickFailures()` | `mission.id === 'wolfskopf-1942'` → Niflheim, T+108…124 s | a mission event / `atcClearances` entry |
| `core/sound.js` | `mission.id === 'wolfskopf-1942'` | mission field |
| `core/rocket.js` (2×) | `aircraft.id === 'starship'` | a vehicle capability flag |
| `core/mission.js` `loadMission()` | list of engine types that need a cold start; `panel === 'g1000'` → cold-and-dark switches, `'airbus'`/`'e190'` → lights on | `engine.coldStart`, an initial-switches block per aircraft or config layer |
| `core/crew.js` `_isComPowered()` | `panel === PANEL.VELIS` / `PANEL.G1000` → which switches power the COM | the electrical system / aircraft data |
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
*Found 2026-10-11 · `display/analog_panel.js`, `display/velis_epsi.js`*

**Progress (2026-11-07).** `bf109.js` and `f4u1a.js` are merged into `display/analog_panel.js` — one set of helpers, the differing colours in the style's palette; both panels pixel-identical before and after. Left: the Velis's copy.

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

**Note (2026-11-04).** `tickPhysics` is 688 lines: the yaw axis added its wiring (per-engine thrust, TAC, the flight and ground yaw steps). The model itself went out, in the shape this entry asks for — `core/yaw.js` and `core/airframe.js`, pure functions with unit tests (`tests/yaw.test.mjs`, `tests/airframe.test.mjs`).

### `core/crew.js` is a 1,120-line module with many jobs
*Found 2026-10-11 · architecture review*

`core/crew.js` holds: PM altitude callouts, GPWS radio-altitude callouts, reactive terrain GPWS, predictive EGPWS (with the siren synthesis), flap/gear checklist calls, the mission script (`atcClearances`: trigger evaluation, four playback shapes, ambient audio), rocket event detection (~250 lines of edge-tracking state), the approach briefing, takeoff callouts, TTS voice selection, COM power, PTT clicks and radio playback (`playRadio`). About 45 module-level variables carry the state between frames.

**Why it matters.** GPWS/EGPWS is safety logic and belongs with the aircraft systems, testable without audio; the mission script engine is the core of every scenario and the training roadmap (virtual ATC, scoring) will grow it; neither can be tested on its own today.

**Fix.** Split along the concerns: `core/script.js` (atcClearances triggers + dispatch), `core/gpws.js` (callouts + terrain GPWS + EGPWS — decisions only, emitting alerts), `core/rocket-events.js` (event detection), `core/callouts.js` (PM/takeoff/checklist), `core/voice.js` (TTS voices, recordings, radio playback). Behaviour-preserving first. **Done when.** No module above ~400 lines; GPWS and trigger evaluation have unit tests that run without audio.

### `index.html` carries most of the application wiring — needs a structured rewrite
*Found 2026-10-11 · architecture review*

`index.html` is 4 540 lines (190 KB, 2026-11-06): ~1 560 lines of CSS (17–1578), ~300 lines of markup, and a ~2 660-line module script (1877–4539). Beyond wiring `core/` to `display/`, the script holds application logic: mission `init()`, the display routing chain, route building for briefing/ND/MCDU, live flight (`flyWithFlight()`), the debrief, scenario-failure merging, and the test hooks (`window.simStep` / `simGetState` / `simSetState` / `simLoad`). Also the training **scoring**: `_computeApproachScore()`, `_computeEmergScore()` and `showDebrief()` — the evaluation logic the training roadmap builds on, untestable where it is (move it to e.g. `core/scoring.js`, pure functions over the recorded state and `S.emergLog`).

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

### Stale docs
`docs/architecture.md` was rewritten bottom-up on 2026-10-11 (§1–14). `docs/panel-system.md` was updated 2026-10-11. `docs/url-routing.md` (formerly `navigation.md` — it covers browser URLs and history, not aircraft navigation; renamed 2026-10-11) hasn't been checked against the code yet.
