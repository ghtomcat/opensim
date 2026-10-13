# OpenSim Architecture

This document describes OpenSim **bottom-up**: first where things live on disk, then
the data that defines every vehicle and mission, then the simulation core that runs it,
then the displays that draw it, and finally the page that wires it all together. It is
written so that a new contributor — human or agent — can build a correct mental model
before opening any code.

**The one-paragraph version.** OpenSim is a static, build-free browser application.
`index.html` loads plain ES modules from `core/` (state, physics, systems, sound) and
`display/` (instruments, 3D outside view, maps). Everything that varies between
vehicles or missions is JSON data (`aircraft/`, `missions/`, `config/`, `panels/`).
Real-world reference data (runways, taxiways, navaids, procedures …) is pre-baked by
Python scripts in `scripts/` into JS modules under `data/`. Serve the repo
root with any static web server (`python3 -m http.server 8080`) and open it in a browser.
An optional Node WebSocket hub in `server/` connects multiple browsers or hardware.

---

## 1. Directory Structure

The layout follows the layering of the system. Read it top to bottom:
data → simulation → presentation → shell → tooling.

```
OpenSim/
│
│   ── DATA: what to simulate (no code) ─────────────────────────────
├── aircraft/          One JSON per vehicle: aircraft, rockets, robots
├── missions/          One JSON per mission + catalog.json (the mission picker list)
├── config/            Cockpit-config cascade: defaults.json → manufacturers/*.json
├── panels/            Data-driven glass-panel layouts (PFD/ND/ECAM/G1000/DR400/E190)
│   └── styles/        Per-family visual styles (colours, fonts) for those panels
├── data/              Generated reference data as JS modules: runways, navaids,
│                      airways, procedures, taxiways, stands, terminals, towers …
│
│   ── SIMULATION: the engine (no DOM drawing) ──────────────────────
├── core/              State, main loop, physics, aircraft systems, navigation,
│                      crew/ATC voice, sound synthesis, input, telemetry
│
│   ── PRESENTATION: everything the user sees ───────────────────────
├── display/           Canvas instruments, cockpit panels, 3D outside view, maps,
│   │                  kneeboard
│   └── svg/           Vector art (Falcon 9 stages, Dragon) used by rocket displays
│
│   ── SHELL: the application entry point ───────────────────────────
├── index.html         The single page: HTML/CSS layout, mission picker, and the
│                      module script that imports core/ + display/ and wires them
├── app/               Application layer pulled out of index.html: the mission
│                      session (session.js)
│
│   ── MEDIA: binary assets loaded at runtime ───────────────────────
├── assets/            GPWS callouts, archival mission audio (Apollo), terrain-colour
│                      and night-lights textures, STL meshes (SO-101 arm, Yertle)
├── audio/             Per-mission radio/voice clips (gitignored — not in the repo)
├── images/            Briefing images shown in the mission picker
├── sounds/            Reference recordings used for engine-sound calibration
│
│   ── OPTIONAL SERVICES ────────────────────────────────────────────
├── server/            Node WebSocket hub (multi-crew rooms) + hardware bridge
│
│   ── TOOLING: never loaded by the sim ─────────────────────────────
├── scripts/           Python data builders (→ data/*.js) and audio analysis
├── tools/             Node dev tools: headless state probe, scratch simulations
├── tests/             Unit tests (node --test, *.test.mjs) + Playwright specs (*.spec.js)
├── test/              Standalone diagnostics (no browser)
│
│   ── DOCUMENTATION ────────────────────────────────────────────────
├── docs/              Developer documentation (this file, testing, navigation, …)
├── README.md          Project overview, feature tour, how to run
├── AIRCRAFT.md        Aircraft catalogue and data notes
├── MANIFEST.md        Project values ("realism as respect")
├── LESSONS.md         Lessons learned while building
├── posts/             Writing about the project (drafts, published posts)
│
│   ── PROJECT FILES ────────────────────────────────────────────────
├── package.json       npm scripts: test, calibrate, hub; deps: ws, @playwright/test
└── playwright.config.js  Browser tests; auto-starts python http.server on :8080
```

### 1.1 Data directories

| Directory | Contents | Read by |
|---|---|---|
| `aircraft/` | Vehicle definitions: identity, envelope, performance/aero, handling, engines, fuel, gear, cooling, sound, cockpit views, checklists. `vehicleType` selects the physics model (aircraft, rocket, robot). | `core/mission.js` at mission load |
| `missions/` | Scenario definitions: aircraft reference, departure/arrival, initial state, weather, ATC/narrative timeline, failures, debrief. `catalog.json` is the mission-picker list (titles, briefings, roles). | `core/mission.js`, `core/catalog.js` |
| `config/` | Cockpit configuration cascade. `defaults.json` is the base layer; `manufacturers/{airbus,boeing,embraer}.json` override it; the aircraft's own `cockpit` block overrides last. | `core/aircraft-config.js` |
| `panels/` | Layout specs for the data-driven glass displays (`airbus-pfd/nd/ecam`, `e190-pfd/nd`, `g1000`, `dr400`); `styles/` holds the per-family look. | `display/panel_renderer.js` |
| `data/` | Real-world reference data as plain ES modules: `runways-data.js`, `navdata.js`, `navaids-data.js`, `airways-data.js`, `taxi-data.js`, `stands-data.js`, `terminals-data.js`, `satellites-data.js`, `towers-data.js`, `procedures-data-xp.js` (gitignored, optional) — all produced by `scripts/build-*.py`; `windsocks-data.js` and `coastlines.js` are hand-maintained. Generated files are not edited by hand; each names its source script in its header comment. They are scoped to the airports referenced in `missions/`, so adding a mission airport means re-running the relevant builders. See §4.1. | `core/` and `display/` |

### 1.2 `core/` — simulation

Pure simulation logic. Modules mutate the shared state object `S` (`state.js`) and do
not draw. Grouped by role:

| Group | Modules |
|---|---|
| State & loop | `state.js` (single source of truth `S` + `setState`), `loop.js` (requestAnimationFrame loop; `tickSim(dt)`, the one simulation step), `lifecycle.js` (mission reset registry), `random.js` (simulation random numbers, seeded in test mode), `mission.js` / `mission-start.js` (load JSON, set initial state, weather), `catalog.js` (mission list) |
| World | `elevation.js` (Mapbox Terrain-RGB DEM: one tile cache, `elevM(lat, lon)`, and `tickElevation()` → `S.terrainElevFt`) |
| Data contract | `vocab.js` (the names data and code share — vehicle types, panels, engine sounds, triggers, rocket events, failures, comm profiles; a misspelled name throws), `schema/` (`check.js` validator; `mission.js`, `catalog.js`, `aircraft.js` schemas; `known.js`: logged violations) |
| Physics | `physics.js` (fixed-wing), `rocket.js` (launch, staging, orbit, booster recovery), `thrust.js`, `pushback.js` |
| Aircraft systems | `fuel.js`, `electrical.js`, `battery.js`, `hydraulics.js`, `baro.js`, `failures.js`, `aircraft-config.js` |
| Navigation & automation | `route.js` (full route: SID/airways/STAR/approach), `lnav.js`, `vnav.js`, `managed-speed.js`, `fma.js`, `airway-graph.js`, `taxi-graph.js`, `taxi.js` (the active taxi route + clearance) |
| Crew, radio, sound | `crew.js` (PF/PM/ATC/GPWS voice dispatch), `radio.js` (comm-chain filtering), `sound.js` (Web Audio engine synthesis), `*-processor.js` (AudioWorklet engine/crackle synthesizers: DB 605, Le Rhône 9J, Lycoming, R-2800) |
| I/O | `input.js` (keyboard/mouse/gamepad), `telemetry.js` + `blackbox.js` (recording/export), `hil.js` (hardware-in-the-loop), `liveflight.js` (live ADS-B lookup) |

### 1.3 `display/` — presentation

Everything that draws. Three kinds of files live here:

| Kind | Files |
|---|---|
| Instruments & cockpit panels | `pfd.js`, `pfd_instruments.js`, `panel_renderer.js` (data-driven, reads `panels/`), `ecam.js`, `g1000.js`, `fma.js`, `com.js`, `clock.js`, `smooth.js` (display-lag smoothing); type-specific panels `bf109.js`, `f4u1a.js`, `velis_epsi.js`, `rocket_display.js`, `dragon.js`, `lm_display.js`, `dsky.js`; cockpit zones `overhead.js`, `pedestal.js`, `leftconsole.js`, `rightconsole.js`, `centerconsole.js`, `pushbutton.js` |
| World & views | `outside.js` (3D outside view entry) with `outside-*.js` (per-type airframes, engines, gear, livery, rockets, space), `terrain.js`, `terrain-color.js`, `night-lights.js`, `map.js`, `cislunar.js`, `earthrise.js`, `kneeboard.js`, `robot_arm.js`, `yertle_quadruped.js` |
| Helpers | `stands-util.js` (stand lookups over `data/stands-data.js`) |

### 1.4 Tooling

| Directory | Contents |
|---|---|
| `scripts/` | `build-*.py`: download OurAirports / OpenStreetMap / X-Plane / FAA CIFP data and write `data/*.js`. Download caches (`ourairports/`, `xplane-nav/`, `faa-cifp/`) are gitignored. `analyze-*.py` / `render-*.mjs`: engine and radio audio analysis. `rescale-aircraft.py`: geometry rescaling. |
| `tools/` | `probe.mjs` runs a snippet inside the sim in headless Chromium (used to reproduce issues in `docs/issues.md`); `booster-descent-sim.mjs` is a scratch guidance simulation. |
| `tests/` | `*.test.mjs` — Node unit tests on pure modules. `*.spec.js` — Playwright tests against the running page. `calibrate_*.spec.js` tune JSON data and only run via `npm run calibrate`. See `docs/testing.md`. |
| `test/` | Self-contained diagnostics run with plain `node` (e.g. cislunar trajectory). |

### 1.5 Not in the repository

Gitignored and created locally: `node_modules/`, `test-results/` (Playwright output),
`audio/` (mission clips), the `scripts/` download caches, `data/procedures-data-xp.js`
(proprietary-licensed source), and `posts/private/`. `index.html` imports
`procedures-data-xp.js` dynamically and carries on without it if the file is absent.

---

## 2. The Mission

A **mission** is the top-level unit of data: *which vehicle, where, when, in what
weather, and what happens around it*. Everything the simulation does starts from one
mission file; the aircraft is pulled in by reference from it. (Authoring guide:
[creating-missions.md](creating-missions.md).)

### 2.1 Two files per mission

| File | Role | Read by |
|---|---|---|
| `missions/<id>.json` | The scenario itself — loaded when the mission starts. | `core/mission.js` → `S.mission` |
| `missions/catalog.json` | The picker card — title, aircraft label, era, accent colour, briefing text, crew roles. One entry per mission, same `id`. | `core/catalog.js` → `MISSIONS` |

The catalog is presentation only. The mission file is the source of truth: its
`aircraft` field decides which vehicle loads, overriding the catalog's `aircraft`
(which is just the picker label and a fallback if the mission names none).

### 2.2 Load lifecycle

```
picker click / ?mission=<id>
  └─ index.html  init(missionId, aircraftId)
       └─ core/mission.js  loadMission("missions/<id>.json", fallbackAircraftPath)
            1. fetch mission JSON
            2. fetch aircraft/<mission.aircraft>.json
               check both against their schemas (core/schema/) — a console
               warning for players; in test mode the load fails (§6.4)
            3. resolve cockpit config cascade        (core/aircraft-config.js)
            4. resolve start position                (core/mission-start.js)
                 "start": {runway, at} | {stand}  → exact lat/lon/hdg from bundled
                 runway / stand data; otherwise initialState lat/lon/hdg is used
            5. derive initial conditions from the start:
                 on ground?  (spd 0, alt ≤ field elevation) → gear down, park brake,
                             cold engine ('off') for types that need a manual start
                 airborne?   → engine 'running', warm oil/coolant, N1 set
                 altimeter subscale → field QNH, or STD above transitionAlt
            6. setState({...})  — S.mission and S.aircraft now hold the full JSON
            7. seed S.metar from weather.fallback; fetch live METAR unless ?test=1
            8. runMissionResets()                    (core/lifecycle.js)
                 each module with per-mission state registered its reset once
                 (onMissionReset): failures, fuel, battery, electrical,
                 hydraulics; the shell registers display smoothing
```

After loading, nothing copies mission data any further: modules read `S.mission.*`
directly, every frame, for as long as the mission runs.

A mission can also be built in code instead of fetched. The live-flight feature
(`core/liveflight.js`) builds a minimal mission object from an ADS-B position and
passes it to `init()` inline.

### 2.3 Field groups and their consumers

Grouped by what each field controls. "Consumer" is the module that reads it at run time.

| Group | Fields | Consumer |
|---|---|---|
| **Identity** | `id`, `title`, `description`, `author` | picker / HUD (`index.html`) |
| **Vehicle** | `aircraft` — id (`"a350"`) or path (`"aircraft/a350.json"`) | `core/mission.js` |
| **Place** | `departure {icao, name, runway, elevation}`, `arrival {icao, name, runway, elevation, ils {freq, course}, dock, surface, rwy*}` | start resolution, route building (`core/route.js` via `index.html`), COM/ATC (`display/com.js`), terrain & airport scenery, arrival-gate assignment (`dock`) |
| **Start** | `phase` (`ground`/`cruise`/`approach`), `start {runway, at}` or `start {stand}`, `initialState {lat, lon, alt, spd, hdg, pitch, roll, gear?, ap?, athr?, …Managed?, autobrake?, speedBrake?}`, `transitionAlt` | `core/mission.js`, `core/mission-start.js`; `phase` also feeds ATC check-ins |
| **Environment** | `weather {source: live\|manual, icao, manual, fallback}`, `timeOfDay`, `water` | `core/mission.js` (METAR), `display/terrain.js`, `display/outside.js`, `display/clock.js`, `display/map.js` |
| **Radio & voice** | `com {title, active, standby, freqs, loops, xpdrLabel}`, `commProfile`, `characters {<speaker>: {commProfile}}`, `atcClearances [...]`, `approachBrief [...]` | `display/com.js`, `core/crew.js`, `core/radio.js` |
| **Scripted events** | `failures [...]`, `engineFailures [...]` (rockets), `events [{t, label}]` (timeline markers) | `core/failures.js`, `core/rocket.js`, rocket displays |
| **Crew aids** | `kneeboard [...]`, `waypoints [...]`, `debrief [...]` | `display/kneeboard.js`, `display/map.js` / `pfd_instruments.js`, `index.html` (post-flight) |
| **Vehicle-specific** | Spaceflight: `dragonSepT`, `dragonSeats`, `targetOrbitKm`, `deorbitT/Dv`, `tliT/Dv/Duration`, `sivbSepT`, `mcc*T`, `loiT/Dv`, `teiT/Dv`, `pc2T/Dv`, `noLOI`, `hasLM`, `moonRefAngle`, `crew`, `reentryGuidance`. Others: `arm` (robot-arm targets) | `core/rocket.js`, rocket/Dragon/Apollo displays; `index.html` |

Units follow the aviation convention used throughout `S`: feet, knots, degrees,
hPa, seconds of mission time. `timeOfDay` is in hours (0–24); values below 1 are
read as a fraction of a day (older rocket missions).

### 2.4 The timeline: `atcClearances`

`atcClearances` is the mission's script. It holds every ATC call, crew exchange,
narration and ambient audio cue. `core/crew.js` checks each entry every frame and
fires it **once** when its trigger is met:

| Trigger form | Fires when |
|---|---|
| `t: <s>` | mission time ≥ t |
| `alt: <ft>` | descending through the altitude |
| `event: "<name>"` | named rocket event (supersonic, maxq, stagesep, …); `uid` separates repeated events |
| `trigger: {type, …}` | structured: `time`, `after` (n s after another entry finished), `airborne`, `alt_ft`, `alt_km`, `velocity`, `gload`, `com_active` (radio just powered), and rocket milestones `meco`, `meco_s2`, `s2_ignition`, `s3_ignition`, `seco`, `ceco`, `tli`, `loi`, `tei` |

What plays is chosen by the entry's shape:

| Shape | Result |
|---|---|
| `audio` + `voice: "ambient"` | Background audio straight to the output (`volume`, `startTime`, `duration`); skipped during time warp |
| `audio` (+ `speaker`) | Recording played through the radio chain; falls back to `text` via TTS if the file is missing (e.g. `audio/` not present) |
| `text` + `voice` | Single TTS line in that voice |
| `pm` / `atc` / `ack` (+ `*Audio`) | Three-step exchange: PM calls, ATC replies over the radio, PM reads back. Needs the COM radio powered. |

The radio profile (how a voice is filtered) resolves most-specific first:
entry `commProfile` → `characters[speaker].commProfile` → mission `commProfile` →
`vhf-aviation`.

### 2.5 Failures

`failures` entries carry a `trigger` (`{type: "time", t}` or `{type: "alt", alt}`)
and a `type`, handled by `core/failures.js`: `engine_power` (ramp to `value` over
`rampTime`), `engine_bang`, `engine_gunfire`, `carb_ice` (needs `hasCarbHeat` on the
aircraft), `coolant_leak` (needs a liquid cooling system). Entries **without** a
`trigger` are spacecraft system failures (`{t, id, affects[], masterAlarm}`), handled
by `core/rocket.js`; they light warnings rather than change engine power.

### 2.6 The schema: what a file may contain

Every mission, catalog entry and aircraft has a schema in `core/schema/`, checked by
`npm test` (`tests/data-schema.test.mjs`) and again at load (§2.2). An unknown key or
an unknown name (trigger type, rocket event, engine sound, panel, comm profile, …)
fails. Two kinds of fields are allowed although the sim doesn't read them:

- **Documentation only** — for people: mission `author`, `description`, `narrative`,
  `fiction_note`, `book`; aircraft `model`, `era`, `subtype`, `specs`, `links`,
  `envelope.maxAlt`, and `dimensions` (the DWG measurement record). Keys starting
  with `_` are comments, allowed anywhere.
- **Planned** — data for a feature that isn't built yet, listed so it stays visible:
  e.g. `landSurfaces`, `gearRuggedness`, `ambient`, the robot arm's `scoring`, manual
  weather `visib` and `snow`.

The briefing text the user sees comes from `catalog.json` (`briefing.*`), not the
mission file. The catalog card holds labels (short titles); the one fact it shares
with the mission, `aircraft`, must match. The aircraft's 3D-model blocks are accepted
as `open` until the geometry work gives them a schema.

---

## 3. The Aircraft (Vehicle)

An **aircraft file** describes one vehicle: what it is, how it flies, what its cockpit
looks like, how it sounds, and what it looks like from outside. "Aircraft" is used
loosely. The same format covers rockets and robots. The file is pulled in
by the mission's `aircraft` field (§2.2) and lives in `S.aircraft` for the whole flight.

### 3.1 Selector fields: which code runs

A small set of fields does not describe the vehicle so much as **choose the code path**
that simulates and draws it. Read these first when opening an unfamiliar aircraft file.

| Field | Chooses | Values in use | Read by |
|---|---|---|---|
| `vehicleType` | Physics model | `vehicleType: "rocket"` → `tickRocket()`; `vehicleType: "robot-arm"` → no physics (kinematics in the display); anything else → `tickPhysics()` | `core/loop.js` |
| `manualControl` | Inside `tickPhysics()`: the force-based flight model (`true`), or a simple kinematic model that converges on the autopilot targets (absent) | `true` on every flyable aircraft; absent only on `dc8` (stub) | `core/physics.js` |
| `panel` | Cockpit instrument panel | `airbus` (also used by the Boeings), `e190`, `g1000`, `dr400`, `bf109` (also MiG-15), `f4u`, `velis-epsi`; absent → default PFD | `index.html`, `display/panel_renderer.js`, many `core/` modules (see issues) |
| `displays` | Glass screens and their page specs from `panels/` | Airbus-family aircraft | `display/panel_renderer.js` |
| `views` | Which cockpit zones exist and which keys toggle them | `overhead`, `left`, `center`, `right`, `pedestal` | `index.html`, `display/*console.js`, `overhead.js`, `pedestal.js` |
| `render` | 3D outside model builder, when not the generic airliner builder | `bf109`, `f4u`, `mig15`, `propplane` (C172), `c172` (DR400), `falcon1`, `falcon9`, `saturn-v`, `starship` | `display/outside.js` |
| `sound.engineType` | Engine sound synthesizer | `v12-supercharged`, `radial-2000hp`, `lycoming-o360`, `rotary-9`, `turbojet-vk1`, `nk12-turboprop`, `high-bypass`, `geared-turbofan` (default when absent), `electric`, `none` | `index.html` → `core/sound.js` |
| `engine.type` | Turbofan systems (N1 spool, start sequence, reversers, ECAM) | `"turbofan"`; on other aircraft `engine` is a descriptive **string** | `core/physics.js`, `thrust.js`, `sound.js`, `electrical.js`, `mission.js`, displays |
| `manufacturer`, `family` | Config cascade layers (§3.3) | `airbus`, `boeing`, `embraer` have layer files | `core/aircraft-config.js` |

### 3.2 Field groups and their consumers

| Group | Fields | Consumer |
|---|---|---|
| **Identity** | `id`, `name`, `manufacturer`, `family`, `model`, `subtype`, `registration`, `callsign`, `icaoType`, `crewLang` | picker, COM/ATC (`callsign`), `core/crew.js` (`crewLang`) |
| **Flight model** | `performance {mass, wingArea, thrustMax, CL_0, CL_alpha, CL_max, CD_0, …}`, `envelope {cruiseAlt, maxAlt, cruiseSpd, maxSpd, spdProfile}`, `handling {rollRate, pitchRate, maxBank, maxPitch}`, `flaps [{label, dCL_0, dCL_max, dCD_0}]`, `thrustProfiles`, `approachSpeed`, `autobrake`, `rotaryEngine` | `core/physics.js`, `thrust.js`, `managed-speed.js`, `vnav.js`, `input.js`, pedestal/levers |
| **Rocket model** | `performance {massWet, stages[], payload, fpaProfile[], recovery{}, …}`, `ignitionTime`, `staging`, `gridFins`, `landingLegs` | `core/rocket.js`, rocket displays |
| **Other vehicle models** | `specs` (robot), `joints`, `links` (robot arm/dog) | `display/robot_arm.js`, `display/yertle_quadruped.js` |
| **Systems** | `tanks`, `fuelBurn`, `hasCarbHeat`; `cooling {type, ambient, normal, redline, …}` + `coolingSystem`; `electrical`; `battery` | `core/fuel.js`, `core/physics.js` (heat balance), `core/failures.js`, `core/electrical.js`, `core/battery.js` |
| **Cockpit** | `panel`, `displays`, `views`, `clock`, `left` / `right` / `pedestal` (control lists per zone), `com`, `cockpit` (config override, §3.3), `map` | `display/*`, `index.html` |
| **Crew & procedures** | `pmCallouts`, `takeoffCallouts`, `gpws`, `checklist` (flap schedule callouts), `fmaPhases`, `kneeboard`, `situations` (quick-start states), `onboarding` (key help) | `core/crew.js`, `display/kneeboard.js`, `core/physics.js`, `index.html` |
| **Sound** | `sound {engineType}` | `core/sound.js` |
| **Outside geometry** | `dimensions` (real measurements, mm), `nose`, `wing`, `geometry`, `gear`, `engine` (nacelle fields), `winglet`, `wingletGeom`, `vstab`, `dorsalFillet`, `bellyFairing`, `flapTracks`, `doors`, `cabinWindows`, `window*`, `overwingExits`, `cheatline`, `livery`, `propplane`, `rocketGeometry` | `display/outside*.js`; `gear` also `core/physics.js`, `core/mission-start.js` |

### 3.3 Cockpit config cascade

Some cockpit properties are shared by a whole manufacturer or family (for example,
where the radio panel sits). They are not repeated in each aircraft. At load,
`core/aircraft-config.js` deep-merges four layers, each overriding only what it changes:

```
config/defaults.json
  → config/manufacturers/<manufacturer>.json     (airbus, boeing, embraer)
    → config/families/<family>.json               (none exist yet; optional)
      → aircraft JSON "cockpit" block              (none use it yet)
= S.aircraft.cockpitCfg
```

Objects merge; arrays and scalars replace. Missing layer files contribute nothing.
Today the cascade carries only `comPanel` placement.

### 3.4 Geometry: data-driven from real dimensions

Airliners are **data-driven**: their shape comes from real measurements, never from
placing parts by eye. The method (reference build: `a340`; also `a350`, `b737max9`,
`b777-300er`):

1. **Source.** The manufacturer's *airport-planning* drawings (published so airports can
   plan gates and taxiways) are measured in real millimetres.
2. **`dimensions` block.** Every measurement goes into the aircraft JSON in mm:
   `length`, `fuselageDiameter`, `noseTipToNoseGear`, `noseTipToMainGear`,
   `mainGearHalfTrack`, `mainGearStrutLength`, `noseTipToWingRoot`,
   `engineTopBelowWing`, … This block is the **source of truth**.
3. **Derived geometry.** The render fields (`nose`, `wing`, `geometry`, `gear`, `engine`,
   `bellyFairing`, …) are computed from `dimensions` at true scale. The outside view's
   world unit is the nautical mile, so 1 mm = 1/1,852,000 model units. Dependent parts
   are parametric: move the wing root and the engines, pylons and flap-track fairings
   follow; pylons are shaped to fit between nacelle and wing.

**Where the derivation runs.** It runs when the aircraft file is authored, not at load
time. `scripts/rescale-aircraft.py <id> --write` (or a calculation when building an
aircraft) writes the derived values into the render fields. The renderer
(`display/outside*.js`) reads those fields. Of `dimensions`, it reads only
`windowsBetweenDoor1and2` directly. Two consequences:

- After editing `dimensions`, re-derive the render fields; the model doesn't change
  until you do.
- `dimensions` and the derived fields can drift apart if one is edited by hand. Checked
  2026-10-11: `a340` and `a350` agree exactly (length, nose-gear and main-gear stations).

**Planned:** derive the geometry at load time from `dimensions` instead, with shape
stored as proportions, so the two can't drift. See `issues.md` → *Aircraft geometry is
derived when authored — derive it at load time*.

Older aircraft (narrow-bodies not yet rebuilt, props, warbirds) still carry hand-authored
geometry, scaled to true size per aircraft. Rolling the method out to every airliner is
pending.

### 3.5 Fields present but not read, and overloaded fields

- **Not read by any code:** `model`, `era`, `landSurfaces`, `ambient`, `gearRuggedness`,
  `raCallouts`, `crewCallouts`, `externalSensor`, `_status`.
- **`engine` has two shapes:** an object (`{type: "turbofan", model, count, …}`) on the
  jets, a descriptive string (`"Lycoming IO-360, 180hp"`) on the others. Code checks
  `engine?.type`, which is `undefined` on a string.
- **`panel` is shared across manufacturers:** the Boeings use `"airbus"` (the shared
  glass renderer), and the MiG-15 uses `"bf109"`.

---

## 4. World Reference Data

Missions name places by ICAO code, runway and stand (§2). The facts behind those
names (where a runway threshold is, which taxiways connect, where gate B7 points, which
VOR is nearby) come from real-world sources. They come in two layers: **bundled** data,
pre-built into JS modules and shipped with the repo, and **live** data, fetched from
web services while the sim runs.

### 4.1 Bundled data (built offline)

Python scripts in `scripts/` download public data, keep only what the missions need,
and write a plain ES module under `data/`. The sim imports these like any other
module. There's no database and no build step at load.

| Module | Exports | Source (licence) | Builder | Read by |
|---|---|---|---|---|
| `runways-data.js` | `RUNWAYS` (thresholds, width, surface, per-end designators, lighting), `AIRPORTS` (tier, name, elevation) | OurAirports (public domain) | `build-runways.py` | `core/mission-start.js`, `core/route.js`, `display/terrain.js`, `map.js`, `com.js`, `index.html` |
| `navdata.js` | `NAVAIDS`, `AIRPORT_FREQS` | OurAirports | `build-navdata.py` | `display/map.js`, `index.html` |
| `navaids-data.js` | `VORS` | OurAirports | `build-navaids.py` | `display/pfd_instruments.js` (dynamic import) |
| `airways-data.js` | `AIRWAYS` (graph edges), `FIXES` | X-Plane nav data, cycle 2012.08 (GPL v3) | `build-airways.py` | `core/airway-graph.js` |
| `procedures-data-xp.js` | `PROCEDURES` (SIDs, STARs, approaches as legs with constraints) | X-Plane CIFP (Navigraph/Jeppesen, **proprietary**) — **gitignored**, built locally | `build-cifp.py` | `core/route.js`, `index.html` (both dynamic import, optional) |
| `taxi-data.js` | `TAXI_WAYS` | OpenStreetMap (ODbL) via Overpass | `build-taxi.py` | `core/taxi-graph.js`, `display/terrain.js`, `index.html` |
| `stands-data.js` | `STANDS` (position, heading, ref), `BRIDGE_COVERAGE` | OSM | `build-stands.py` | `core/mission-start.js`, `display/stands-util.js`, `terrain.js`, `index.html` |
| `terminals-data.js` | `TERMINALS`, `APRONS` (footprints) | OSM | `build-terminals.py` | `display/terrain.js`, `index.html` |
| `satellites-data.js` | `SATELLITES` (round satellite terminals) | OSM | `build-satellites.py` | `display/terrain.js` |
| `towers-data.js` | `TOWERS` | OSM | `build-towers.py` | `display/terrain.js` |
| `windsocks-data.js` | `WINDSOCKS` | **hand-maintained** (where OSM has none) | — | `display/terrain.js` |
| `coastlines.js` | `COAST`, `SPACE_SITES` | hand-maintained | — | `display/map.js`, `index.html` |

Two raster textures in `assets/` are bundled the same way: `terrain-color.jpg`
(Blue Marble land colour, `display/terrain-color.js`) and `night-lights.png` (VIIRS
night glow, `display/night-lights.js`).

**Scope.** Builders slice their source down to the **airports referenced in
`missions/*.json`** (departure and arrival ICAO), and the airways to the mission
city-pairs. Adding a mission at a new airport therefore means re-running the builders.
The steps are in [creating-missions.md → Adding a new airport](creating-missions.md).
Generated modules carry their source and builder in a header comment and are never
edited by hand.

**Graphs on top.** Two `core/` modules turn edge lists into routable graphs at load:
`airway-graph.js` (en-route airways → `core/route.js`) and `taxi-graph.js`
(taxiways → taxi routes and ATC taxi clearances).

### 4.2 Live data (fetched at run time)

| Service | What | Used by | Without it |
|---|---|---|---|
| Mapbox `terrain-rgb` tiles | Terrain elevation (DEM) | `core/elevation.js` — one tile cache for physics, the EGPWS look-ahead, the ND terrain and `display/terrain.js` | Needs a token in `localStorage.mapboxToken`; without one, elevation lookups return `null` |
| Mapbox Streets v8 tiles | Water polygons | `display/terrain.js` | same token |
| Overpass API (OSM) | Aeroway detail around the aircraft (runways, taxiways, aprons, holding points, windsocks) and major roads for night lighting | `display/terrain.js` | retried with back-off; scenery is thinner |
| ArcGIS World Topo tiles | Map background | `display/map.js` | no background |
| aviationweather.gov (direct, then via corsproxy.io) | METAR | `core/mission.js` | mission `weather.fallback`; never fetched in test mode |
| OpenSky Network, adsb.fi (via corsproxy.io) | Live flights | `core/liveflight.js` | live-flight feature unavailable |

### 4.3 Layering notes

`core/` imports nothing from `display/` (checked by `tests/elevation.test.mjs`).
Reference data shared by both layers lives in `data/`; terrain elevation is a
`core/` module (`elevation.js`) that the renderer imports, not the other way round.

---

## 5. Cockpit Panel Specs

The last piece of the data layer describes **what the cockpit screens show**. Glass
airliner screens and GA panels are not coded per aircraft. They are composed from
JSON and drawn by one renderer, `display/panel_renderer.js`. Full reference:
[panel-system.md](panel-system.md).

```
aircraft/<id>.json          "panel": "airbus"                 → style  panels/styles/airbus.json
                            "displays": [{spec, screen, pages}] → specs  panels/airbus-pfd.json, …
panels/<spec>.json          layout: rows → columns → widget + config   (sizes as fractions)
display/panel_renderer.js   _WIDGETS registry: widget name → draw function
```

| Layer | Files | Role |
|---|---|---|
| Spec | `panels/airbus-pfd`, `airbus-nd`, `airbus-ecam`, `e190-pfd`, `e190-nd`, `g1000`, `dr400` | Layout: which widget sits where, with what config |
| Style | `panels/styles/airbus`, `e190`, `g1000`, `dr400` | Colours and font per cockpit family |
| Widgets | `display/panel_renderer.js` (`_WIDGETS`), drawing from `display/pfd_instruments.js` and `display/g1000.js` | 9 glass widgets, 12 GA widgets |

**What is data and what is code.** A new airliner or GA aircraft that fits the
existing widgets needs only JSON: `panel`, `displays`, and if necessary a new spec or
style. A new kind of instrument needs a new widget (code). Cockpits that don't fit the
widget model (the warbirds, the Velis) are hand-drawn modules selected by `panel`
(§3.1), and so are the vehicle displays (rockets, robots).

The slide-in **cockpit zones** (overhead, pedestal, consoles, centre) are configured
by the aircraft's `views` list and per-zone token lists (`left`, `right`,
`pedestal`), not by `panels/` specs.

Two loading details matter. Specs and styles are **fetched on first render** of an
aircraft and cached by aircraft id, not loaded by `loadMission()`; the screen stays
blank until they arrive. The style is chosen by the aircraft's `panel`, not by the
spec's own `style` field.

---

## 6. State and the Main Loop

This is the base of the simulation layer. Everything in `core/` and `display/` shares
one state object and runs inside one frame loop.

### 6.1 `S`: the shared state (`core/state.js`)

`S` is one plain, mutable JavaScript object, exported from `core/state.js` and
imported by almost every module. It holds about 170 top-level fields. The defaults in
`state.js` are the full inventory, with a comment per field:

| Group | Examples |
|---|---|
| Flight state | `lat`, `lon`, `alt` (ft, true MSL), `spd` (kt), `hdg`, `pitch`, `roll`, `vs`, `wow`, `time` |
| Targets / commands | `altT`, `spdT`, `hdgT`, `pitchT`, `rollT`, `vsT`, `thrustLever` — the `T` suffix means *commanded*, the value without it is *actual* |
| Automation | `ap`, `athr`, `navManaged`, `altManaged`, `spdManaged`, `autobrake`, `baroSet`, `baroStd` |
| Engine & systems | `engineState`, `enginePower`, `n1`, `oilTempC`, `coolantTemp`, `fuelLeft`, `fuelRight`, `switches`, `lights`, `warnings`, … |
| Vehicle-specific | `rocket*`, `dragon*`, `starship*`, `armJoints`, `dogJoints`, … |
| Cockpit & UI | `mode`, `cockpitView`, `ecamPage`, `comPanelVisible` |
| Session | `role`, `paused`, `warpFactor`, `roomId`, `emergLog` |
| Loaded data | `aircraft` (full JSON + `cockpitCfg`), `mission` (full JSON), `metar` |

**Writing.** `setState(patch)` is `Object.assign(S, patch)`. It's a shallow merge,
with no validation, no change notification and no history. Readers see a change on
their next read, and the loop reads everything every frame. Consequences:

- A nested object must be replaced whole: `setState({ lights: { ...S.lights, nav: true } })`.
- `setState` is the convention (about 280 calls), but direct assignment also occurs
  (about 110, mostly `display/outside.js`, see 6.5). Nothing enforces the difference.
- The comment at the top of `state.js` says only `physics.js`, `input.js` and
  `mission.js` write. That is out of date: systems, crew, failures, the shell and
  interactive cockpit displays all write.

**Not everything is in `S`.** Many modules keep private module-level state (fired
ATC entries in `crew.js`, active ramps in `failures.js`, caches in renderers).
`loadMission()` clears it through the reset registry: each module registers its
`reset*()` with `onMissionReset()` (§2.2). Not every module does yet — crew, the robot
arm, the cislunar view and others are still reset by hand in the shell.

### 6.2 The frame loop (`core/loop.js`)

`startLoop(renderers, { manualClock })` starts one `requestAnimationFrame` loop. Each
frame:

```
dt = time since last frame, capped at 0.1 s
(nothing at all while suspended — see below)
1. input        tickGamepad(), tickHIL()
2. simulation   tickSim(dt) — skipped while S.paused, and always in test mode
     tickControls(dt)                held keys; roll/steer spring back when released
     tickFailures(warpDt)
     tickFuel(dt), tickBattery(dt), tickElectrical(dt), tickHydraulics(dt)
     vehicle physics, chosen per frame (§3.1):
        rocket      → tickRocket + tickBooster   (time warp, fixed steps; see below)
        robot-arm   → nothing (kinematics live in the display)
        otherwise   → tickPhysics(warpDt)
     tickCrew(prevAlt, S.alt)        ATC script, callouts, GPWS
     tickTelemetry(warpDt), bbTick(dt)
     drop the time warp when S.warpTarget is reached
3. renderers    every function in the list, every frame (also while paused)
```

- **Mission time.** `S.time` is advanced inside `tickPhysics()` and `tickRocket()`. Robots
  don't advance it.
- **Time warp exists only for rockets** (`warpFactor` 1/10/100/1000). Below 1 s of sim
  time per frame, the rocket steps once with the frame's `dt`. At or above it, an
  accumulator steps in fixed `PHYS_DT = 1.0 s` increments, so the trajectory doesn't
  depend on the warp setting. Systems (fuel, electrical, …) always tick with the
  unwarped `dt`.
- **Frame-rate dependence.** All tickers take `dt`, so the simulation is meant to be
  frame-rate independent. Places that apply a change per frame instead of per second
  are bugs (see `issues.md`).
- **One step for everyone.** `tickSim(dt)` is exported: the frame loop calls it once per
  frame, the test API's `simStep` calls it n times (§6.4).
- **Suspended between missions.** `suspendLoop()` stops ticks and renders while the
  mission selector is up (leaving a mission, §14.2); the next `startLoop()` resumes.

### 6.3 The renderer list

`index.html` passes about 30 closures to `startLoop()`. Despite the name, they're
"everything else that runs each frame":

- **drawing:** the main panel dispatch ([panel-system.md](panel-system.md)), FMA,
  cockpit zones, outside view (`tickOutside`), kneeboard, mission clock, map, cislunar
  and earthrise views;
- **non-drawing work:** `tickSound()`, `checkCrash()`, `checkDebrief()`,
  `_trackApproach()`, METAR and panel text updates, camera automation.

The order of the list is the order of execution. There's no separate update and
draw phase for these.

### 6.4 Test stepping

In test mode (`?test=1`), `index.html` exposes `window.simStep(n, dt)`,
`simGetState()`, `simSetState()` and `simLoad()` ([testing.md](testing.md)).

- **`simStep(n, dt)` is `tickSim(dt)` n times** — the same step the game runs, including
  the systems and the rocket fixed-step accumulator (a `dt` of 10 s is ten 1 s rocket
  steps).
- **`simStep` is the only clock.** The loop starts with `manualClock: true`: frames
  still render (screenshots work), but never call `tickSim`.
- **Turbulence is seeded.** Simulation code draws from `random()` in `core/random.js`;
  `init()` calls `seedRandom(1)` on every mission load in test mode, so a run repeats
  to the last digit. Players get `Math.random`.
- **No recorders.** Telemetry and the black box aren't started in test mode: no test
  reads them, and both grow with sim time (a rocket spec runs to t ≈ 330 000 s).
- **Strict data.** A mission or aircraft that doesn't match its schema fails the load
  (`setStrictData(true)`); players only get a console warning (§2.6).

### 6.5 Observations

- **The outside view borrows `S`.** To draw the terrain from the camera's position,
  `display/outside.js` saves the aircraft pose, writes the camera pose into
  `S.lat/lon/alt/hdg/pitch/roll`, calls `renderTerrain()`, and restores the pose (38
  such writes). This works because JavaScript is single-threaded. But an exception
  between write and restore would leave the camera pose in the flight state, and the
  terrain renderer can only take its viewpoint from `S`.

Tracked in `issues.md` (*The outside view borrows the flight state for its camera*).

---

## 7. Aircraft Physics (`core/physics.js`)

`tickPhysics(dt)` simulates every winged aircraft, once per frame (§6.2). It's one
function of about 680 lines that reads `S` and the aircraft JSON and ends in a single
`setState()` with the new state. Rockets (`core/rocket.js`) have their own
ticker and are described separately.

### 7.1 One tick, in order

```
guards        no aircraft / paused / crashed / no envelope → return
ground ref    field elevation of the NEARER airport (departure or arrival threshold)
speed limit   envelope.spdProfile → cap on the speed target
engine        turbofan only: N1 spool + A/THR speed loop (thrust-lever detents, core/thrust.js)
ILS           LOC/GS deviation from the arrival runway threshold; LOC/GS capture
vacate        on the ground: has the aircraft left the landing runway? (taxi-in trigger)
model         manualControl → force-based flight model (7.2)
              otherwise     → kinematic convergence on the targets (7.3)
FMA           Airbus/Boeing phase model (core/fma.js) or the aircraft's fmaPhases
wind          from the mission weather source (manual / live METAR / fallback)
navigation    ground velocity = TAS along heading + wind (no wind drift on the ground) → lat/lon
crash         hard landing, overspeed, terrain (CFIT)
engine temps  oil temperature; coolant/CHT heat balance (aircraft.cooling + OAT)
automation    thrust reverser, ground spoilers, gear animation (12 s), pushback pose
write         one setState() — includes S.time += dt
```

### 7.2 The force-based model (`manualControl: true`)

All flyable aircraft use this. It's a **point-mass model in wind axes**: forces act on
the centre of mass; attitude isn't produced by moments.

- **Atmosphere:** ISA density from altitude. Dynamic pressure uses IAS at sea-level
  density; TAS is derived for groundspeed and turn rate.
- **Attitude:** pitch and roll follow a target (the stick `pitchT`/`rollT`, or the
  autopilot) through a PD controller with first-order rate lag, capped by
  `handling.rollRate/pitchRate/maxBank/maxPitch`. There's no moment-of-inertia
  model.
- **Aerodynamics:** `CL = CL_0 + CL_alpha·α`, capped at `CL_max`, with α = pitch
  attitude (see issues). Drag is `CD_0` plus induced, gear, propeller-damage,
  cooling-flap and spoiler drag. Flap coefficients ramp over ~9 s per stage. Ground
  effect cuts induced drag and adds up to ~4 % lift within one wingspan.
- **Thrust:** turbofans `T_max·(N1/100)^1.8·ρ/ρ₀`. Props use `spdT/cruiseSpd` as the
  throttle: the speed target doubles as the power lever. Thrust is zero unless
  `engineState === 'running'`, and it's scaled by `enginePower` (failures).
- **In flight:** speed from longitudinal forces; flight-path angle from
  `(L − W·cos γ)/(m·v)`, damped (−0.4·γ) and trimmed. Two extra stall terms (high-α
  snap, energy stall) are added on top. Turn rate from bank (coordinated). The Avro's
  rotary engine adds gyroscopic coupling.
- **On the ground:** a separate branch with thrust, drag, rolling/static friction,
  brakes (park brake, manual, autobrake levels with spool-in), and reverse thrust. Nose-wheel
  steering turns in proportion to speed. Weight on wheels latches on landing.
- **Autopilot:** it lives in this branch and only produces targets.
  - **Lateral:** a bank command toward the localizer, LNAV (`core/lnav.js`) or the
    heading bug.
  - **Vertical:** altitude → vertical speed → flight-path angle → pitch, with a trim
    angle of attack derived from the lift needed. Altitude comes from VNAV
    (`core/vnav.js`) or the FCU; selected V/S and glideslope tracking with flare are
    handled here too.
  - The autopilot flies through the same attitude controller as the stick.

### 7.3 The kinematic model (no `manualControl`)

Altitude, speed, heading, pitch and roll each move toward their target at a fixed
rate, with the descent rate capped near the ground. No forces. Only the `dc8` stub
uses it today.

### 7.4 Ground and terrain

- **"Ground" is the field elevation of the nearer airport**, a flat plane at
  `departure.elevation` or `arrival.elevation`, whichever threshold is closer. Takeoff,
  landing, weight on wheels and the autopilot's ground logic all use it.
- **Real terrain only enters as a crash check.** Each sim tick, `core/elevation.js`
  writes the DEM elevation under the aircraft into `S.terrainElevFt` (whether or not
  the outside view is drawing). Physics
  declares CFIT when the aircraft is below it, but only where terrain is more than
  100 ft above the field. The EGPWS (`core/crew.js`) and the black box read the same
  value. Without a Mapbox token (§4.2) it stays `null`, and there is no CFIT and no
  EGPWS.

### 7.5 Crash conditions

| Condition | Threshold |
|---|---|
| Hard landing | vertical speed below −800 fpm at the moment of touchdown |
| Overspeed | above `envelope.maxSpd` × 1.15 |
| Terrain | below `S.terrainElevFt` (where that is > field + 100 ft) |

A crash sets `S.crashed` (physics stops), `crashReason`, and logs to the black box.
`checkCrash()` in `index.html` shows the screen. Crash checks apply to the force model
only.

### 7.6 Known model issues

Tracked in `issues.md` → *Flight model*: α = pitch attitude (no flight-path
term), the energy stall double-counting the lift deficit, and the high-α stall and
turbulence applied per frame instead of per second.

---

## 8. Rocket and Robot Physics

The other vehicle kinds, chosen by the loop from `vehicleType` (§3.1, §6.2). Rockets
write into `S` like the aircraft model, reusing the aircraft fields with different
meanings; robots have no physics ticker.

### 8.1 Rockets (`core/rocket.js`)

`tickRocket(dt)` (about 1,500 lines with helpers) runs a mission through three regimes,
switching on flags in `S`:

```
pad hold       S.time < aircraft.ignitionTime → sit on the pad (countdown);
               after ignition, hold until thrust > weight
powered ascent point mass in a vertical plane over a spherical Earth
               (2D: altitude + downrange along a fixed heading → lat/lon)
               until SECO (S.rocketSECO)
orbit / coast  at SECO the state is converted once to a 3D Cartesian vector (S.orbitVec)
               and integrated with velocity Verlet: Earth + Moon point-mass gravity;
               scheduled burns, separations and reentry act on that vector
```

**Ascent.**
- **Stages** come from `performance.stages[]` (wet mass, thrust, burn time, engine
  count). Thrust, fuel flow, staging and coast gaps all work from them.
- **Atmosphere and gravity:** an extended atmosphere up to low orbit (`rhoAtAlt`) and
  inverse-square gravity.
- **Drag:** from `Cd` and `area`.
- **Limits:** a centrifugal term, a G-limit that throttles thrust (`gLimit`), and a
  G-triggered centre-engine cutoff (CECO).
- **Guidance:** a programmed flight-path angle over time (`performance.fpaProfile`,
  interpolated). Two exceptions on the last stage: `orbitTargetSECO` steers and
  cuts off for a target orbit (`mission.targetOrbitKm`), and `velocityGateSECO`
  cuts at a velocity.
- **Engine failures:** `mission.engineFailures` takes engines out.

**State conventions for rockets.** `S.pitch` is the **flight-path angle** (90° = up),
not attitude. `S.spd` is total velocity in knots. Rocket-specific state uses `rocket*`,
`dragon*`, `starship*` and `booster` fields, all initialised in `loadMission()` (§2.2).

**Orbit and beyond: mission-scheduled events.** Times and ΔVs come from the mission
file (§2.3); the ticker applies them as impulsive burns on `S.orbitVec`:

| Event | Mission fields | Effect |
|---|---|---|
| Dragon separation | `dragonSepT` | Dragon and Stage 2 propagate separately (`S.s2Vec`) |
| TLI | `tliT`, `tliDv`, `tliDuration` | prograde burn toward the Moon |
| Mid-course corrections | `mcc1T`, `mcc2T`, `mcc4T` | solved, not scripted: a Newton solve aims at the Moon's sphere of influence, then a bisection sets periapsis (~113 km) |
| S-IVB separation, LM docking | `sivbSepT`, `hasLM` | |
| LOI / TEI / PC+2 | `loiT`, `loiDv`, `teiT`, `teiDv`, `pc2T`, `pc2Dv`, `noLOI`, `moonRefAngle` | Moon-relative burns; LOI can trigger on SOI entry |
| Deorbit, reentry | `deorbitT`, `deorbitDv`, `reentryGuidance` | Dragon: blunt-body drag, blackout, drogues 5.5 km, mains 1.8 km, splashdown; Starship: bank-angle guided reentry |
| System failures | `failures[]` entries without `trigger` | warnings + master alarm (Apollo 13) |

**Time warp.** Rockets are the only vehicles with warp (§6.2). The ticker lowers the
warp itself before events (e.g. near the Moon, before TEI, before LM docking) and
stops it at splashdown.

### 8.2 Booster recovery (`tickBooster`)

After stage separation, `S.booster` holds a second, independent vehicle. It's stepped
by `tickBooster(dt)` alongside the upper stage, through a phase state machine:

```
flip → boostback → coast → entry → glide → landing → landed
```

The booster returns to the launch site (RTLS) or flies to a droneship downrange
(`performance.recovery.asds`, no boostback). It uses its own vertical-plane
integration, with guidance derived and validated in `tools/booster-descent-sim.mjs`.

### 8.3 Robots

`robot-arm` and `robot-dog` vehicles have no physics ticker. Joint kinematics live in
their displays (`display/robot_arm.js`, `display/yertle_quadruped.js`), driven by
`S.armJoints` / `S.dogJoints`.

### 8.4 Modelling notes

- **The Earth doesn't rotate.** No rotation rate appears in the model: the launch gets
  no eastward velocity from the Earth, and the orbit vector is converted to lat/lon as
  if the Earth were fixed. Ground tracks therefore don't shift westward from orbit to
  orbit. (The sun position in `display/terrain.js` advances on its own.)
- **Known issues:** ascent at 1 s steps (and so in time warp), CRS-1 suborbital,
  the `inspiration5` orbit. See `issues.md` → *Rockets*.

---

## 9. Aircraft Systems

Systems tick every frame between input and physics (§6.2). Each is a small module
with `reset*()` (registered with `onMissionReset()`, run by `loadMission()`) and
`tick*(dt)`. Each applies only to
aircraft that declare the matching data.

### 9.1 Overview

| Module | Applies to | State it owns | Effect on the simulation |
|---|---|---|---|
| `core/fuel.js` | aircraft with `tanks` (Bf 109, F4U, C172, DR400) | `fuelLeft`, `fuelRight`, `fuelSelector`, `fuelShutoff`, `fuelStarveT`; `warnings.LOW_FUEL/OIL_PRESS/FUEL_SHUTOFF` | burn ∝ `enginePower` (`fuelBurn` L/h); empty selected tank or shutoff → 4 s run-down → engine off |
| `core/battery.js` | aircraft with `battery` (Velis Electro) | `batteryCharge` (%) | drain ∝ `enginePower` (`powerDrawKw`, `capacityKwh`); empty → `enginePower` 0 |
| `core/electrical.js` | turbofans | APU state machine; generators, AC/DC/essential buses, bus tie, ext power, `bat1..3Charge` | **display only** (ECAM, overhead, pedestal) |
| `core/hydraulics.js` | turbofans | GREEN / BLUE / YELLOW pressure, engine-driven and electric pumps | **display only** (ECAM, PFD) |
| `core/failures.js` | all (by mission) | scripted failures (§2.5); carb ice (`carbIceLevel`); coolant leak → seize | sets `enginePower` / `engineState` |
| cooling (in `core/physics.js`) | aircraft with `cooling` | `coolantTemp`, `oilTempC` | heat balance (§7.1); `failures.js` seizes the engine at `cooling.critical` |

Light-aircraft switches (`masterBat`, `masterAlt`, `avionicsOn`, `magnetos`, `lights`;
the Velis `switches`) are plain fields in `S`, toggled by the cockpit. They aren't a
system model. COM power is decided per panel type in `core/crew.js` (§2.4).

### 9.2 The engine: one engine per aircraft

The engine is represented by **single values**, whatever `engine.count` says:

| Field | Meaning | Written by |
|---|---|---|
| `engineState` | `off` → `starting` → `running` (→ `shutdown`) | `core/sound.js` (start-up lifecycle, 11 writes), `physics.js` (turbofan spool), `fuel.js`, `failures.js`, `mission.js`, Velis panel |
| `enginePower` | 0–1 power available (scales thrust) | `failures.js` (ramps, carb ice, seize), `fuel.js`, `battery.js`, `sound.js`, `mission.js`, crash |
| `n1` | turbofan fan speed % | `physics.js` |

Consequences:
- **Multi-engine aircraft have one N1 and one power value.** The electrical system
  derives "per-engine" generators from the shared N1, and the hydraulics drives both
  engine pumps from it ("approximated with shared N1"). One engine can't fail or be
  shut down on its own.
- **`enginePower` has many writers and no composition.** Each writer sets an absolute
  value. Carb ice, for example, sets `1 − 0.7·ice` every frame while active, which
  overwrites a failure ramp. The last writer in the frame wins.
- **Engine start completes when the sound finishes.** `startEngineLifecycle()` in
  `core/sound.js` plays the start-up recording and sets `engineState: 'running'` in the
  audio buffer's `onended` callback. For impulse engines it also requires the
  AudioWorklet; without it the engine goes back to `off`. For turbofans,
  `physics.js` also moves `starting → running` when N1 reaches idle, so there are two
  paths.

### 9.3 Observations

- **Airliner systems are a display model.** Bus and hydraulic states are computed
  carefully, but nothing in the simulation reads them. Gear, flaps, brakes, flight
  controls and the COM radio work with all buses and hydraulics dead. This is intentional
  for now: the systems are modelled for the cockpit first, and coupling them is future work.
- **One hydraulic layout for all turbofans.** The A340's GREEN/BLUE/YELLOW is used
  for the A220, the Boeings and the E190 too (the 737 has A/B/standby, the E190
  systems 1/2/3).
- **Two different "battery" concepts.** `battery.js` is the Velis propulsion battery;
  airliner batteries are `bat1..3` inside `electrical.js`.
- **Fuel only on four aircraft, and jets burn none.** `BURN_DEFAULTS` in `fuel.js`
  is keyed partly by engine types no aircraft uses (`lycoming-o320`, `r-2800`); all
  four fuel aircraft set `fuelBurn` explicitly.

All of these, plus the engine points in 9.2, are tracked in `issues.md` → *Engine and
systems*.

---

## 10. Navigation and Automation

Everything that decides *where to go* and *what the automation commands*. It builds on
the world data (§4) and feeds the autopilot inside `tickPhysics()` (§7.2). (Browser URLs and
history are a different topic: [url-routing.md](url-routing.md).)

### 10.1 The flight plan: `core/route.js`

`buildFullRoute(dep, arr)` assembles the gate-to-gate route from the mission's
`departure` / `arrival`:

```
departure runway
  → SID       for the runway; pinned by departure.sid, else the one minimising
              (flown SID distance + distance to the STAR entry)
  → airways   Dijkstra over the airway graph, SID exit → STAR entry (core/airway-graph.js)
  → STAR      pinned by arrival.star, else the entry nearest the departure
  → approach  legs for arrival.runway, plus the missed approach
  → arrival runway
= { legs: [{lat, lon, id, seg, alt, spd}], distNm, sid, star, appr, missed }
```

SIDs, STARs and approaches come from the optional CIFP bundle (§4.1). Without it the
route falls back to airport → airways → airport. Altitude and speed constraints
travel on each leg (`altParse` / `spdParse` read them).

**One function, many copies of the result.** There's no flight-plan object in `S`.
Each consumer calls `buildFullRoute()` itself:

| Consumer | Caching |
|---|---|
| LNAV (`core/lnav.js`) | cached per dep/arr/SID/STAR + procedure-count key |
| ND map (`display/pfd_instruments.js`) | same key, own cache |
| MCDU F-PLN page (`display/pedestal.js`) | none: rebuilt each time the pedestal opens |
| Kneeboard approach page (`display/kneeboard.js`) | cached on the arrival |
| Briefing charts (`index.html`, 3 call sites) | none |

All produce the same route as long as the inputs match. The route can't be edited or
re-cleared in flight, because there's nothing to edit.

### 10.2 Managed guidance

The autopilot (§7.2) has a selected and a managed source per axis:

| Axis | Selected | Managed (`S.*Managed`) | Module |
|---|---|---|---|
| Lateral | `hdgT` (heading bug) | `navManaged` → LNAV: heading to the active waypoint; sequences when the fix is passed or within a speed-based turn lead (`S.fmsActive`) | `core/lnav.js` |
| Vertical | `altT` (FCU altitude), V/S | `altManaged` → VNAV: a ~3° geometric descent path built backward from the runway through the altitude constraints, giving TOD and a predicted altitude per fix; never below the cleared `altT` (pull the altitude down to start the descent) | `core/vnav.js` |
| Speed | `spdT` | `spdManaged` → interpolates `envelope.spdProfile` by height above the destination; binds upcoming speed constraints within a look-ahead; turbofans only | `core/managed-speed.js` |
| Thrust | lever | A/THR speed loop within the lever detent's N1 ceiling | `core/thrust.js` + `physics.js` |

Priority on the lateral axis: localizer (once captured) > LNAV > heading bug. On the
vertical axis: glideslope (once captured) > selected V/S > VNAV / FCU altitude.

### 10.3 Flight mode annunciation: `core/fma.js`

`physics.js` calls the FMA every tick. A shared phase model (`parked`, `takeoff`,
`climb`, `cruise`, `descent`, `approach`, from weight on wheels, N1, vertical speed,
altitude vs target, gear) is translated into each manufacturer's words:
`computeAirbusFMA()` (5 columns) or `computeBoeingFMA()` (3 fields), chosen by
`manufacturer`. Aircraft without a glass panel use their own altitude-banded
`fmaPhases` table instead.

### 10.4 Ground navigation

| Piece | Module | What |
|---|---|---|
| Taxi graph | `core/taxi-graph.js` | Builds a graph from bundled OSM taxiways (`TAXI_WAYS`), or fetches them live from Overpass for airports not bundled. Stand lead-in lines are stitched on as edges. Dijkstra gives a route; collapsing edges by `ref` gives the clearance text ("T5, A, A5"). |
| Taxi route + clearance | `core/taxi.js` | Owns the active route, ticked with the sim (map open or not). Departure: stand → departure runway. Arrival: vacate point → assigned gate (`S.arrivalGate`), routed when Ground clears the taxi-in (`clearTaxiIn()`), published once `S.taxiCleared` is set. Recomputed after 80 m of movement or a new goal. Publishes `S.taxiRoute` and `S.taxiClearance` (`via` = the route's taxiway sequence). |
| Taxi display and phrasing | `display/map.js`, `display/com.js` | The map draws `S.taxiRoute` as the green line; com.js phrases `S.taxiClearance` and assigns the arrival gate from `arrival.dock`. |
| Runway vacate | `core/physics.js` | Latches `S.vacated` once the aircraft is slow and clear of the runway edge, which unlocks the taxi-in request. |
| Pushback | `core/pushback.js` + `physics.js` | A main-gear path from the stand backwards onto the taxiway (straight back, then a fillet arc), derived from `S.taxiRoute`; physics overrides the pose while the push runs. |

### 10.5 Observations

- **No flight-plan state.** See 10.1: five consumers recompute the route (a Dijkstra
  over the airway graph each time), and there is no plan to amend in flight.
- **LNAV writes `S.fmsActive` directly** rather than through `setState`.

All three are tracked in `issues.md` → *Navigation*.

---

## 11. Crew, ATC, Radio and Sound

Everything you hear. Three modules: `core/crew.js` decides **what is said and when**,
`core/radio.js` shapes **how a transmission sounds**, and `core/sound.js` synthesizes
**the engine and cockpit sounds**. All share one Web Audio context. Detailed docs:
[audio-chain.md](audio-chain.md) (radio chain, and the pipeline for recorded and archival
audio: download, cut, wire into the mission), [sound-calibration.md](sound-calibration.md)
and [db601-synthesis.md](db601-synthesis.md) (engine synthesis). Those three haven't
been checked against the code during this rewrite.

### 11.1 Crew and ATC (`core/crew.js`)

`tickCrew(prevAlt, alt)` runs every frame after physics (§6.2) and checks, in order:

| Check | Source data | Output |
|---|---|---|
| PM altitude callouts | `aircraft.pmCallouts` | PM voice when descending through each altitude |
| GPWS radio-altitude callouts | `aircraft.gpws` | recorded callouts (`assets/gpws/*.mp3`) |
| Predictive EGPWS ("TERRAIN AHEAD") | DEM look-ahead along the track (`terrainElevM`, §4.2) | siren + voice |
| Reactive GPWS (sink rate, terrain closure) | `S.terrainElevFt` (§7.4) | siren + voice |
| Flap/gear checklist calls | `aircraft.checklist` | PF/PM exchange |
| **The mission script** | `mission.atcClearances` (§2.4) | ATC, crew, narration, ambient audio |
| Approach briefing | `mission.approachBrief` | PF/PM briefing sequence |
| Takeoff callouts | `aircraft.takeoffCallouts` | "rotate", "positive climb", … |

For rockets it also tracks the vehicle's state transitions (max-Q, staging, SECO,
booster phases, Dragon events) for the `event:` triggers.

**Voices.** Live speech uses the browser's **Web Speech API** (TTS) with five
voices: PF, PM, ATC, narrator, narrator 2. `aircraft.crewLang` sets the language.
Recorded audio (`audio/…`, gitignored) plays instead when an entry names a file,
falling back to TTS if the file is missing. A few fixed phrases map to recordings
(`AUDIO_FILES`).

**COM power** gates ATC exchanges. It's decided per panel type (`_isComPowered()`:
Velis and G1000 switches; everything else always on).

**Interactive COM** (`display/com.js`): tuning frequencies from `mission.com` /
`aircraft.com`, virtual ATC check-ins per frequency, taxi clearances and gate
assignment (§10.4), the transponder, and looped mission audio (`com.loops`).

**Reset.** `resetCrew()` clears all fired-sets and stops ambient audio. A generation
counter (`_crewGen`) cancels callbacks still pending from the previous mission.

### 11.2 Radio chain (`core/radio.js`)

A transmission is filtered through a **comm profile**: a Web Audio chain of
bandpass, presence boost, carrier hum, cockpit whine, noise floor, crackle and burst
noise (`radio-crackle-processor.js` AudioWorklet), and a squelch tail.

- **12 profiles**, each historically matched: `vhf-aviation`, `tower-quiet`,
  `sband-apollo`, `vhf-vostok`, `capsule-dragon`, `ip-spacex`, `ip-spacex-crew`,
  `ip-spacex-narrate`, `launch-control`, `cockpit-bf109`, `arc-5`, `rsiu-3`; plus
  `broadcast`, a dry bypass (no chain) for narrators, special-cased in `playThroughChain()`.
- **Choosing a profile:** entry `commProfile` → `characters[speaker]` → mission
  `commProfile` → `vhf-aviation` (§2.4). An unknown name falls back to `vhf-aviation`
  with a console warning; in data files the schema rejects it (§2.6). The names are
  `COMM_PROFILE` in `core/vocab.js`, and `PROFILES` checks itself against them on load.
- **Engine bleed:** for cockpit profiles, `playRadio()` (in `crew.js`) mixes the live
  engine sound under the received voice (`COCKPIT_PROFILES`, 2.5–9 %), taken from
  `sound.js` via `getEngineBleedNode()`.
- **TTS can't be filtered.** Profiles apply only to recordings; for spoken ATC a "radio atmosphere" (the chain with no
  voice input) runs underneath while the voice speaks.

### 11.3 Engine and cockpit sound (`core/sound.js`)

Procedural synthesis. Nothing is a looped recording except the start-up sequences.
`sound.engineType` (§3.1) selects a preset in `ENGINES`:

| Kind | Engine types | Technique |
|---|---|---|
| Oscillator engines | `geared-turbofan` (default), `high-bypass`, `low-bypass-military`, `turbojet-vk1`, `nk12-turboprop` | sawtooth harmonics + filtered noise, pitch follows RPM/N1 |
| Impulse engines | `v12-supercharged` (DB 605), `radial-2000hp` (R-2800), `lycoming-o360`, `rotary-9` (Le Rhône) | AudioWorklet cylinder-firing synthesis (`*-processor.js`), one per engine family |
| Start-up / shut-down | turbofan (CFM56), DB 605, R-2800, Lycoming, VK-1 | assembled buffers played once; **they drive `engineState`** (§9.2) |
| Effects | — | engine bang, gunfire, coolant hiss, AP-disconnect chime, APU, fuel pump, GPWS whoop |

`tickSound()` runs in the renderer list (§6.3) and maps RPM/N1, throttle and state
to the synthesis parameters. `startSound()` **closes the AudioContext and creates a
new one** on every (re)start, and re-adds the worklet modules.

### 11.4 Observations

- **Unknown names fall back — with a warning.**
  - `crew-demo2` gives its crew `commProfile: "sband-crew"`, which is planned (with
    the crew recordings, per `audio-chain.md`) but not defined yet — on the schema's
    known list. No effect today (the crew lines are TTS, and TTS ignores profiles);
    until it's defined, recordings would play as `vhf-aviation`. (`broadcast`, used by `inspiration5`'s narrators, is
    valid: a dry bypass handled in `playThroughChain()` rather than in `PROFILES`.)
  - The Velis's `engineType: "electric"` has no `ENGINES` entry, so the electric motor
    gets the **geared-turbofan** preset (the console says so).
  - `COCKPIT_PROFILES` lists `cockpit-c172`, which isn't a radio profile.
- **One AudioContext, re-created.** The radio chain and engine bleed use the context
  from `sound.js`. That context is closed and replaced whenever an engine sound
  (re)starts, so anything playing on the old one stops (inferred: an engine start
  during an ATC transmission would cut it). `display/com.js` (squelch) and `index.html`
  create contexts of their own.
- **`crew.js` is 1,250 lines** covering callouts, two GPWS layers, the mission script,
  rocket event detection, briefings, TTS voices and radio playback.

---

## 12. Input, Recording and External Links

The edges of the simulation: how input gets in, how flights are recorded, and how
the sim talks to other machines.

### 12.1 Input

| Source | Where | What |
|---|---|---|
| Keyboard | `core/input.js` (`initInput`, `tickControls(dt)`), plus handlers in `index.html` (5 `keydown` listeners) and some displays (`outside.js`, `com.js`, robots) | Flight controls (held keys → `pitchT`/`rollT`, continuous), AP/FCU, flaps, gear, PTT, time warp and next-event warp (rockets), role, cockpit-zone keys (§5). Full list: [keybindings.md](keybindings.md). |
| Mouse | `core/input.js` | drag-to-fly stick |
| Gamepad | `core/input.js` (`tickGamepad`, each frame) | axes: roll, pitch, rudder, throttle; trigger = PTT; buttons: flaps, gear. Fixed mapping (`GP`), dead zone 0.08 |
| Cockpit clicks | `display/panel_renderer.js`, cockpit zones, Velis/Dragon/Apollo panels | switches, levers, knobs, all through `setState` (§5) |
| Hardware | `core/hil.js` (12.3) | `rollT`, `pitchT`, `spdT`, `ap`; robot-arm telemetry |

Input writes **targets** (`*T`) and switch states; physics and systems turn them into
motion (§6.1). Keyboard handling is spread over `core/input.js`, `index.html` and
several displays. There's no single key map.

### 12.2 Recording

| Recorder | Module | Rate | Content | Output |
|---|---|---|---|---|
| Telemetry | `core/telemetry.js` | 2 Hz (sim time) | flight state, targets, engine; rocket fields | download as JSONL (aircraft) or CSV (rockets), **Ctrl+Shift+L** |
| Black box | `core/blackbox.js` | snapshot every 5 s + events | state snapshot; `bbEvent()` records from anywhere (failures, crashes, flaps, gear, fuel starvation, …) | JSONL, persisted in `localStorage` (last 5 sessions), downloaded with a SHA-256 line appended |

The black box starts per mission (`initBlackbox()` in `init()`), telemetry likewise
(`startTelemetry()`); neither starts in test mode (§6.4). Telemetry keeps every row in
memory — unbounded on long warped missions (`issues.md`). The black box's SHA-256
fingerprint is computed in the browser with no secret, so it detects accidental
corruption, not deliberate edits.

### 12.3 Hub and hardware-in-the-loop

```
browser (core/hil.js)  ⇄  server/hub.js (WebSocket, rooms)  ⇄  server/robot_bridge.js  ⇄  ESP32 (SO-101 arm)
                                                           ⇄  ESP32 VotingTriad / other hardware
```

- **`server/hub.js`** (`npm run hub`, port 3000): clients `JOIN` a room; the hub
  relays `STATE_PATCH` and `CREW_EVENT` messages to the other members. It has no
  state and does no validation.
- **`core/hil.js`**: enabled with `?hil` or `?hil=ws://host:port`. At 50 Hz it sends
  the aircraft state (hdg, pitch, roll, alt, vs, spd, plus robot-arm joints). It
  applies control patches received from hardware. It always joins room `hil-corsair`.
- **`server/robot_bridge.js`**: bridges the hub to the SO-101 arm's ESP32
  (`HUB_URL`, `ESP_URL`, `ROOM` default `so101-hil`, `SPEED`).

**Multi-crew isn't wired up.** The hub's header describes PF / PM / INSTRUCTOR rooms,
and `S.role` / `S.roomId` and the catalog's `roles` exist. But the only WebSocket
client in the browser is `hil.js`: no state is shared between two browsers, and
nothing sends `CREW_EVENT`. `S.role` is local (the R key cycles it; displays show it).

### 12.4 Live flight data

`core/liveflight.js`: nearby flights from the OpenSky Network, lookup by registration
or callsign from adsb.fi (through corsproxy.io), and polling for tracking. The picker
starts a mission built from a live position (§2.2), and `pickAircraft(icaoType)` maps
the type to a sim aircraft (overridden by bug, see `issues.md`).

### 12.5 Observations

- **HIL room mismatch.** The browser always joins `hil-corsair` (no URL option);
  `robot_bridge.js` defaults to `so101-hil`. With defaults the arm and the sim don't
  meet unless `ROOM=hil-corsair` is set.
- **`CART_JOG` is dropped by the hub.** `sendCartJog()` in `core/hil.js` sends
  `CART_JOG`, and `robot_bridge.js` handles it, but `server/hub.js` relays only
  `STATE_PATCH` and `CREW_EVENT`.
- **No single key map:** keys are handled in about six modules.

All tracked in `issues.md` → *Input, recording and external links*, including
multi-crew (not implemented yet).

---

## 13. The Display Layer

Everything that draws. Display modules read `S` (and the loaded JSON) every frame
through the renderer list (§6.3). They are meant not to change the simulation; the
exceptions are listed in 13.6.

### 13.1 Screen surfaces

| Surface | Element | Drawn by |
|---|---|---|
| Outside view (world + aircraft) | `#outside-canvas` | `display/outside.js` → `display/terrain.js` |
| Main panel / left screen | `#pfd` | panel dispatch ([panel-system.md](panel-system.md)) |
| Right screen, FCU, ECAM | `#nd`, `#fcu`, `#ecam` | `display/panel_renderer.js`, `display/ecam.js` |
| Moving map | Leaflet `<div>` + overlay canvas | `display/map.js` |
| Cislunar / earthrise views | `#cislunar-canvas`, `#earthrise-canvas` | `display/cislunar.js`, `display/earthrise.js` |
| Cockpit zones, kneeboard, COM, FMA | DOM overlays | `overhead.js`, `pedestal.js`, `*console.js`, `kneeboard.js`, `com.js`, `fma.js` |
| Mission picker, briefing charts, debrief | DOM + canvases in `index.html` | `index.html` |

### 13.2 Rendering technology

- **Canvas 2D for nearly everything,** including the 3D outside view. There's no
  WebGL engine. The outside view is a custom software renderer: a flat-earth pinhole
  projection in the aircraft's body frame (nautical-mile units) and flat-shaded
  polygons sorted back to front (painter's algorithm).
- **Three.js** (r134, loaded globally from unpkg with `STLLoader` / `OrbitControls`)
  is used only by the robot views (`robot_arm.js`, `yertle_quadruped.js`) to show the
  STL meshes in `assets/`.
- **Leaflet** (1.9.4, unpkg) for the moving map, with ArcGIS topo tiles (§4.2).
- **DOM** for the cockpit zones, kneeboard and COM panel.

The external libraries come from a CDN at load time. Offline, the map and robot views
fail; everything else is local.

### 13.3 Outside view (`display/outside*.js`)

`tickOutside()` draws one camera, chosen by `setOutsideCamMode()`:

| Mode | Camera |
|---|---|
| 0 | cockpit forward: the terrain renderer from the eye point, with a cockpit frame per aircraft |
| 1 | chase (orbit with mouse and wheel) |
| 2 | side (fixed distance) |
| 3 | wing view |
| 4 | plume cam (rockets) |
| 5 | booster cam / Starship body cam |
| 6 | droneship cam |

For the external cameras, the world is drawn by `renderTerrain()` from the camera
pose (which `outside.js` writes into `S` temporarily, §6.5). The vehicle model is then
drawn on top.

**Vehicle models** come from three sources:

| Vehicles | Geometry | Modules |
|---|---|---|
| Airliners (wide/narrow-body) | **built from the aircraft JSON** (`nose`, `wing`, `geometry`, `gear`, `engine`, `livery`, …, §3.4) by `_acGeoFromJson()` | `outside-wb.js`, `outside-livery.js`, `outside-engines-draw.js`, `outside-gear-draw.js` |
| Props and warbirds (C172/DR400, Bf 109, F4U, MiG-15) | **hand-authored vertex/face arrays in code**, one module each, scaled to true size by a per-type constant | `outside-c172.js`, `outside-b109.js`, `outside-f4u.js`, `outside-mig15.js`, `outside-pp.js` |
| Rockets and spacecraft | parametric builders (`_buildRocket`, `rocketGeometry` for Starship) plus hand-authored parts (Saturn V, LM, Falcon) | `outside-space.js`, `outside-rocket.js`, `outside-rocket-draw.js`, `outside-shared.js` |

The aircraft's `render` field picks the builder (§3.1). Control surfaces, props, gear
and flaps are animated from `S`.

### 13.4 Terrain and world renderer (`display/terrain.js`)

`renderTerrain(canvas, options)` draws the world for every camera. Layers, back to
front:

```
sky gradient, twilight glow, stars, sun and moon (phase from the real synodic cycle)
Earth globe at high altitude (rockets)
ground grid from DEM elevation (Mapbox, §4.2), coloured by Blue Marble land colour
water polygons (Mapbox vector tiles)
night city lights (VIIRS radiance) and major roads (Overpass)
airports: runways, taxiways and aprons (bundled + live OSM), runway and taxiway lights,
  holding points, taxi signs, stands, terminals and jet bridges, satellites,
  control towers, windsocks
clouds from the METAR, horizon haze, water shimmer
mission effects (e.g. Niflheim, Wolfskopf)
cockpit frame, heading tape, clock and moon-phase overlay, FPS
```

Its DEM elevation comes from `core/elevation.js`, the same tile cache the physics and
the EGPWS read (§7.4).

### 13.5 Other displays

- **Instruments and panels:** §5 and [panel-system.md](panel-system.md).
  `display/smooth.js` gives needles first-order lag; today only
  `pfd_instruments.js` uses it.
- **Vehicle displays:** `rocket_display.js` (launch telemetry, Apollo),
  `dragon.js`, `lm_display.js`, `dsky.js`, `cislunar.js`, `earthrise.js`,
  `robot_arm.js`, `yertle_quadruped.js`.
- **Map** (`display/map.js`): local north-up mini-map for aircraft (runways, navaids,
  route, taxi route); world map with the ground track for rockets. Also embedded maps
  in the G1000 and Velis panels.
- **Kneeboard** (`display/kneeboard.js`): checklists and briefings from the aircraft
  and mission, plus a generated approach page.

### 13.6 Observations

- **`renderTerrain()` is one function of about 2,840 lines** (`terrain.js` lines
  653–~3,490), drawing every layer in 13.4 and sharing local state across them.
- **Display modules do simulation work:** the Velis motor's engine state
  (`velis_epsi.js`, §9.2), and the camera pose written into `S` (`outside.js`, §6.5).
- **Prop and warbird geometry is code, not data.** Airliners are data-driven (§3.4),
  but the C172, Bf 109, F4U and MiG-15 are vertex arrays inside JS modules.
- **Display lag is applied unevenly:** only the glass instruments use `smooth.js`.

Tracked in `issues.md` → *Display* (also the CDN dependency from 13.2).

---

## 14. The Shell (`index.html`)

The single page that ties everything together. It's the top of the stack: it imports
`core/` and `display/`, and nothing imports it.

### 14.1 Layout of the file

| Lines (approx.) | Content |
|---|---|
| 1–16 | `<head>`: fonts, Leaflet and Three.js from CDNs (§13.2) |
| 17–1768 | CSS for the whole app (picker, briefing, panels, overlays, debrief) |
| 1770–2213 | Markup: mission picker, briefing, canvases (§13.1), overlays, loading screen |
| 2214–5217 | One `<script type="module">`: imports, then the application logic below |

### 14.2 Boot and mission start

```
page load
  ?test=1     → test mode: no live METAR, onboarding skipped, test API exposed,
                manual clock, seeded turbulence, no recorders, strict data (§6.4)
  ?mission=id → straight to init(id)            otherwise → showSelect() (picker)
  popstate    → back: stop the mission session, picker
                forward: init(that mission)                 (url-routing.md)

picker card → showBriefing → [showRoleSelect] → [showScenarioSetup] → [showFlightBriefing (jets)]
            → init(missionId, aircraftId)

init()
  _session?.stop(); _session = newSession()        (app/session.js)
     onStop: suspendLoop, hide the maps, close the kneeboard,
             stopSound, stopCOM, resetCrew
  history.pushState(?mission=id)
  loadMission()                         (§2.2)
  test mode: seedRandom(1) · otherwise: initBlackbox()
  merge scenario-setup failures into S.mission.failures
  init displays: COM, overhead, ECAM, crew, input, FMA, outside view, kneeboard, map, …
  initSound(engineType); onboarding overlay (pauses the sim until dismissed)
  keyboard listener for shell keys (K, O, D, N, E, Q, H, X, V, C, M, L, Esc, Ctrl+Shift+L/B)
  view mode (cockpit / combined / outside); rockets start combined
  dispatch opensim:aircraft-loaded       (glass-cockpit screens back to page 1)
  window.simReady = true (test harness); HIL if ?hil
  startLoop([...renderers], { manualClock: test mode })   (§6.3)
```

`init()` is called again for each mission in the same page session (picker,
back/forward, `simLoad`). There's no page reload between missions, so what a mission
sets up must not pile up:

- **Per-mission wiring goes through the session.** Listeners and timers that close over
  the mission (the shell key handler, ND click, onboarding) are registered with
  `_session.on()` / `_session.timeout()`; `stop()` removes them. The next `init()` and
  the Back button both stop the session.
- **Page-lifetime setup is create-once.** Display `init*()` functions build their DOM and
  window listeners on the first call and only reset on later ones (kneeboard, maps,
  outside view, ECAM, input). Panels that rebuild remove their old element first
  (overhead, pedestal, consoles).

### 14.3 What else lives in the shell

Beyond wiring, the module script holds application features (see `issues.md` →
*`index.html` carries most of the application wiring*):

| Feature | Functions |
|---|---|
| Mission picker, briefing, role select, scenario setup | `showSelect`, `showBriefing`, `showRoleSelect`, `showScenarioSetup` |
| Flight briefing charts (route, airport, SID/STAR, nav log, weather) | `showFlightBriefing`, `_renderRouteChart`, `_renderProcChart`, … |
| Live flight: radar picker, ADS-B tracking that drives the sim | `flyWithFlight`, `renderRadarMap`, `_startTracking`, `_pollTracking` |
| Panel text updates, mission clock, METAR display | `updatePanel` (~175 lines), `renderMissionClock`, `updateMetar` |
| Approach tracking and **scoring**, debrief, crash overlay | `_trackApproach`, `_computeApproachScore`, `_computeEmergScore`, `showDebrief`, `checkCrash` |
| Mission-specific UI | Wolfskopf diary debrief |
| Time-warp buttons, on-screen keyboard | `_getNextEvent`, `_initOsk` |
| FCU and glass-panel interaction, page cycling | `_fcuGeometry`, `_currentSpec`, Tab handler |
| Test API | `window.simStep`, `simGetState`, `simSetState`, `simLoad` |

### 14.4 Observations

- **Training logic lives in the shell:** approach and emergency scoring and the
  debrief are `index.html` functions, out of reach of unit tests.

Tracked in `issues.md`: *`index.html` carries most of the application wiring*.
