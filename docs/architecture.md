# OpenSim Architecture

## Panel/Display Routing

**Routing decision tree (index.html ~2691–2700):**

```
if      (isHover)                            → renderHovercraft(canvas)
else if (isRocket)                           → renderRocket(canvas)
else if (ecam && !isG1000 && !isBf109)       → renderECAM(ecamCanvas)
else if (isG1000)                            → renderG1000(canvas)
else if (isBf109)                            → renderBf109(canvas)
else                                         → renderPFD(canvas)
```

**Display conditions:**
- `isHover` = `S.aircraft.type === 'hovercraft'`
- `isRocket` = `S.aircraft.vehicleType === 'rocket'`
- `isG1000` = `S.aircraft.id === 'c172'`
- `isBf109` = `S.aircraft.id === 'bf109'`
- `ecam` = `S.mode === 'ECAM'`

**UI panel visibility rules:**
- Hovercraft control panel: hidden except when `isHover === true`
- COM container: hidden for hovercraft only
- Panel, keys, FMA: hidden for rockets only

---

## Aircraft IDs → Panel Mapping

| Aircraft ID | Display | Notes |
|-------------|---------|-------|
| `c172` | Garmin G1000 | Cessna 172 glass cockpit |
| `bf109` | Bf 109 vintage panel | Messerschmitt Bf 109 G-4 |
| `falcon9-b5`, `falcon9-b5-590`, `falcon9-b1`, `falcon1` | Rocket display | SpaceX rockets + telemetry |
| `hovercraft_timo`, `hovercraft_markus`, `hovercraft` | Hovercraft panel | Split or single-vehicle view |
| `a350`, `an225`, `tu95ms`, `f4u1a`, `avro504`, `robin-dr400` | PFD (default) | All other aircraft |

---

## Sound Engine Types

| Engine Type | Application | Key Characteristics |
|-------------|-------------|---------------------|
| `geared-turbofan` | A350, AN-225 | High-bypass turbofan; fundamental 52–105 Hz; 4 harmonics; 260 Hz lowpass |
| `high-bypass` | Modern turbofans | Fundamental 68–155 Hz; 5 harmonics; 500 Hz cutoff |
| `low-bypass-military` | Military jets | Bandpass 88–260 Hz; 7 harmonics; 900 Hz resonance |
| `rotary-9` | Avro 504 (Le Rhône 9J) | AudioWorklet impulse; 9-cylinder; 400–1200 RPM |
| `lycoming-o360` | C172 (IO-360) | AudioWorklet impulse; 4-cylinder; 700–2700 RPM |
| `nk12-turboprop` | Tu-95 (NK-12MV) | Contra-rotating turboprop; 38–96 Hz fundamental; 8 harmonics; dual LFOs |
| `edf-hovercraft` | Hovercraft | Dual EDF banks; lift 620–5400 Hz, thrust 420–3600 Hz; plenum rumble ~50 Hz |
| `v12-supercharged` | Bf 109 (DB 605) | AudioWorklet impulse; 12-cylinder; 400–2800 RPM; multi-phase lifecycle; supercharger whine |
| `radial-2000hp` | F4U-1A Corsair (R-2800) | Placeholder — radial synthesis not yet implemented |

**Note:** Impulse-based engines (v12, lycoming, rotary) use AudioWorklet. Oscillator-based use sawtooth + noise. Only `v12-supercharged` has a full startup/shutdown lifecycle.

---

## Mission JSON Fields

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique mission identifier |
| `title` | string | Display name |
| `description` | string | Short mission brief |
| `author` | string | Mission creator |
| `book` | string | (Optional) Collection name |
| `aircraft` | string | Path to aircraft JSON |
| `commProfile` | string | Mission-level radio chain preset |
| `characters` | object | Per-speaker commProfile overrides: `{atc: {commProfile}, pilot: {commProfile}}` |
| `departure` | object | `{icao, name, runway, elevation}` — null if no takeoff |
| `arrival` | object | `{icao, name, runway, ils, elevation}` — null if no landing |
| `initialState` | object | `{lat, lon, alt, spd, hdg, pitch, roll}` |
| `weather` | object | `{source: "live"\|"manual", icao?, manual: {...}, fallback: {...}}` |
| `atcClearances` | array | `[{t/event, text?, audio?, voice?, speaker?, commProfile?, delay?}]` |
| `approachBrief` | array | `[{v: "pf"\|"pm", t: "..."}]` — crew briefing sequence |
| `narrative` | array | Scene-setting text overlay lines |
| `com` | object | `{title, xpdrLabel, active, standby, freqs: {...}}` |
| `debrief` | array | Post-flight question prompts |
| `failures` | array | `[{trigger: {type, t/alt}, type, value?, rampTime?}]` |
| `timeOfDay` | number | 0–24 hour (affects lighting) |
| `water` | boolean | Enable water surface rendering |
| `dragonSepT` | number | (Rockets) Dragon separation time (s) |
| `deorbitT` | number | (Rockets) Deorbit burn time (s) |
| `deorbitDv` | number | (Rockets) Deorbit delta-v (m/s) |
| `engineFailures` | array | (Rockets) `[{t, stageIdx, activeEngines}]` |

**atcClearances dispatch logic (crew.js):**
- `t:` — fires at elapsed seconds
- `event:` — named event (supersonic, maxq, meco, stagesep, seco, orbit, booster_landing, etc.)
- `alt_km:` — ascending altitude trigger
- `alt_ft:` — descending altitude trigger
- `audio:` + `speaker:` — play MP3 through radio chain; commProfile resolved from `characters[speaker]`
- `voice:` — TTS via Web Speech API (atc, crew, pm, narrator, narrator2)

---

## Aircraft JSON Fields

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique aircraft ID (drives panel selection) |
| `name` | string | Display name |
| `callsign` | string | Radio callsign |
| `icaoType` | string | 4-letter ICAO designator |
| `vehicleType` | string | `"rocket"` or omit |
| `type` | string | `"hovercraft"` or omit |
| `manualControl` | boolean | Disable autopilot |
| `fixedGear` | boolean | Gear cannot retract |
| **envelope** | object | `{cruiseAlt, maxAlt, cruiseSpd, maxSpd, spdProfile}` |
| **performance** | object | `{mass, wingArea, thrustMax, CL_0, CL_alpha, CL_max, CD_0, gearDrag, inducedK, Vr, muRoll, muBrake}` |
| **handling** | object | `{rollRate, pitchRate, spdRate, maxBank, maxPitch}` |
| **flaps** | array | `[{label, dCL_max, dCD_0}]` |
| **sound** | object | `{engineType}` |
| **com** | object | `{title, xpdrLabel, active, standby, freqs}` |
| **situations** | array | Pre-set states for quick-start |
| **thrustProfiles** | array | `[{label, spdT}]` — power setting shortcuts |
| **fmaPhases** | array | `[{minAlt, vals[5], cols[5]}]` — FMA annunciation by altitude |
| **gpws** | array | `[{alt, text, speech, red}]` |
| **pmCallouts** | array | `[{alt, speech}]` |
| **kneeboard** | array | `[{title, type:"checklist"\|"briefing", items[]}]` |
| **onboarding** | array | `[{key, desc}]` — keyboard help overlay |

**Rocket-specific performance fields:** `massWet, Cd, area, stages[], payload, gLimit, qLimit, cegCutoffG, fpaProfile[], recovery{}`

---

## commProfile Values

| Profile | Context | Band | Notes |
|---------|---------|------|-------|
| `vhf-aviation` | Standard ATC | 350–3400 Hz | Squelch tail; 1000 Hz carrier; 400 Hz cockpit whine |
| `tower-quiet` | Ground station TX | 400–3200 Hz | Clean; minimal carrier; no whine |
| `sband-apollo` | NASA S-band, 2.1 GHz | 300–3000 Hz | High hiss; no carrier; 380,000 km path loss |
| `vhf-vostok` | Soviet VHF 143.625 MHz, 1961 | 500–2800 Hz | Narrow; harsh; heavy noise floor |
| `ip-spacex` | SpaceX IP backbone | 200–7000 Hz | Near phone quality; very clean |
| `cockpit-bf109` | Bf 109 missions | — | Custom profile with engine bleed |

**Environment bleed (cockpit profiles only):**

| Cockpit Profile | Engine Bleed Level |
|---|---|
| `cockpit-bf109` | 4% |
| `cockpit-c172` | 5% |
| `capsule-dragon` | 4% |

**Character system:** Mission JSON `characters` block maps speaker names to commProfiles. Callout with `speaker: "atc"` resolves `characters.atc.commProfile` at playback time.

---

## Vehicle Types & Physics Loop

**core/loop.js dispatch:**

| Vehicle Type | Trigger | Physics | Time Warp |
|---|---|---|---|
| rocket | `S.aircraft.vehicleType === 'rocket'` | `tickRocket()` + `tickBooster()` | 1×/10×/100×/1000× |
| hovercraft | `S.aircraft.type === 'hovercraft'` | `tickHovercraft()` | none |
| aircraft (default) | all others | `tickPhysics()` | none |

---

## Key State Fields (S{})

| Field | Purpose |
|-------|---------|
| `alt`, `altT` | Current / target altitude (ft) |
| `spd`, `spdT` | Current / target speed (kt) |
| `hdg`, `hdgT` | Current / target heading (°) |
| `vs` | Vertical speed (ft/min) |
| `pitch`, `roll` | Attitude (°) |
| `flaps` | Config index (0–3) |
| `gear` | Gear down? |
| `wow` | Weight on wheels? |
| `crashed` | Physics frozen? |
| `enginePower` | 0–1 (failure scale) |
| `engineState` | off / starting / idle / running / shutdown (v12 only) |
| `ap`, `athr` | Autopilot / autothrust engaged? |
| `mode` | "PFD" / "ND" / "ECAM" |
| `aircraft` | Full aircraft JSON object |
| `mission` | Full mission JSON object |
| `time` | Elapsed seconds since mission start |
| `warpFactor` | 1/10/100/1000 (rockets only) |
| `paused` | Simulation paused? |

---

## Core Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `state.js` | S{} single source of truth + setState() patch |
| `loop.js` | RAF animation loop; dispatches physics + renderers |
| `physics.js` | Fixed-wing aero; autopilot modes (ALT/HDG/SPD) |
| `rocket.js` | Gravity turn; staging; booster RTLS; Keplerian propagator; deorbit/reentry |
| `input.js` | Keyboard, mouse, gamepad → setState() |
| `sound.js` | Web Audio engine synthesis; exports getAudioContext(), getEngineBleedNode() |
| `radio.js` | Comm chain: bandpass, presence, crackle, squelch (5 profiles) |
| `crew.js` | Voice dispatch: PF/PM/ATC/GPWS; playRadio() for MP3 through chain |
| `mission.js` | Load aircraft + mission JSON; patch initial state; fetch METAR |
| `failures.js` | Scripted failure injection by time or altitude |
| `telemetry.js` | 2 Hz flight recording; CSV/JSONL export |
| `db605-processor.js` | AudioWorklet: DB 605 V12 impulse |
| `lerh9-processor.js` | AudioWorklet: Le Rhône 9J rotary impulse |
| `lycoming-processor.js` | AudioWorklet: Lycoming IO-360 4-cyl impulse |
| `radio-crackle-processor.js` | AudioWorklet: crackle/burst noise |

## Display Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `pfd.js` | Attitude sphere, alt/spd tapes, heading, HSI, ILS deviation |
| `ecam.js` | Engine/warning display + systems synoptic |
| `g1000.js` | Garmin G1000 dual-screen (PFD 62% + MFD 38%) |
| `bf109.js` | Bf 109 vintage panel — feldgrau, German labels, km/h + m |
| `rocket_display.js` | SpaceX telemetry: ALT/VEL/DOWNRANGE/G; booster split panel |
| `hovercraft_display.js` | Plenum pressure, EDF rpm, lift ratio, voting triad |
| `fma.js` | 5-box FMA annunciation with color coding |
| `map.js` | Local mini-map (aircraft) or world map with ground track (rocket) |
| `kneeboard.js` | Checklists + briefings panel |
| `com.js` | COM radio + transponder UI |
| `terrain.js` | 3D outside view: sky, terrain/water, stars, space scale |
| `coastlines.js` | World coastline geometry + space launch sites |

---

## Adding a New Aircraft with Custom Panel

1. Create `aircraft/[id].json` with `id`, `performance`, `handling`, `sound.engineType`, etc.
2. If new panel needed: create `display/[id].js` exporting `render[Id](canvas)`
3. Import in index.html alongside other display imports
4. Add detection condition: `const is[Id] = S.aircraft?.id === '[id]'`
5. Insert into display routing if/else chain
6. Add mission entry to MISSIONS array in index.html with `briefing: {image, document, ...}`

---

## Archival Audio Pipeline

1. `yt-dlp --download-sections "*HH:MM:SS-HH:MM:SS"` → raw clip
2. `ffmpeg -ss 0:00:XX -i raw.mp3 -t N -q:a 0 clip.mp3` — cut individual clips
3. Add `"characters"` block to mission JSON with per-speaker commProfile
4. Reference with `{t: N, speaker: "narrator", audio: "audio/[mission]/clip.mp3"}`
5. Audio files excluded from repo (`.gitignore`)
