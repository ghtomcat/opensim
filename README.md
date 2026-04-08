# OpenSim

**Open-source browser-based simulation engine.**
Any vehicle is a JSON file. Any mission is a JSON file.

![OpenSim PFD — ILS Approach LSZH](opensim.png)

Born 05:32, Sunday 15 March 2026, Zürich. Built with Claude Code.

---

## Who it is for

**Spotters** — open the live radar, watch real flights within 1000nm, color-coded by destination. Click any aircraft and fly it at its current position, altitude, and heading.

**Historians** — load a mission from 1918, 1942, or 1956. Read the classified briefing document. Hear the crew in the right language. Fly the aircraft with the right physics.

**Airplane buffs** — the DB 601 fires 12 cylinders via AudioWorklet. The NK-12 contra-rotation beat is a 3.8Hz LFO modulating the master gain. Every number in the aircraft JSON came from a POH or technical manual.

**PPL students** — circuits at LSZF and LSZG. Full checklists. GPWS callouts. Takeoff and approach briefings. Real weather via live METAR.

**Anyone with a browser** — no install. No login. No fee. Works on a laptop, tablet, or Raspberry Pi.

---

## What it is

OpenSim is not a game. It is a modular simulation engine that runs entirely in the browser with zero dependencies and no build step.

- **Real aerodynamic physics** — lift, drag, thrust, weight from first principles. Not kinematic approximations.
- **Procedural sound** — every sound synthesised from physics. No samples. Wind rises with airspeed. The DB 601 fires 12 cylinders. The NK-12 turboprop beats at 3.8Hz.
- **Any aircraft** — envelope, performance, handling, sound, crew language, checklists in one JSON file
- **Any mission** — weather, ATC clearances, classified briefing documents, scripted failures, crew voices in one JSON file
- **Live radar** — real flights via OpenSky Network, color-coded by destination, route lines to arrival airport, 150/400/1000nm range
- **Runs anywhere** — laptop, tablet, Raspberry Pi, custom cockpit panels

---

## Quick start

```bash
# Any static server works
python3 -m http.server 8080
open http://localhost:8080
```

No build step. No framework. No dependencies. Open `index.html` and fly.

---

## Controls

| Key | Action |
|-----|--------|
| `↑` / `↓` | Pitch up/down (manual) · Altitude target ±500ft (AP) |
| `←` / `→` | Roll left/right (manual) · Heading target ±5° (AP) |
| `+` / `−` | Throttle ±5 kt |
| `t` / `T` | Trim nose up / nose down |
| `B` | Brakes (hold) |
| `f` / `F` | Flaps extend / retract |
| `g` | Gear toggle |
| `1`–`5` | Situation presets (disabled during active missions) |
| `F1`–`F4` | Thrust detents (aircraft-specific) |
| `k` | Kneeboard (briefings + checklists) |
| `n` | Mini map (heading, track made good, wind) |
| `v` | Cycle view: instruments / combined / outside |
| `Tab` | Cycle display mode |
| `p` | Pause |
| `m` | Audio on/off |
| `r` | Cycle role: PF → PM → INSTRUCTOR |
| `Space` | PTT (push to talk) |
| `Ctrl+Shift+T` | Download flight telemetry as JSONL |

**Gamepad:** Logitech Extreme 3D Pro out of the box.
axes[0]=roll · axes[1]=pitch · axes[2]=rudder · axes[5]=throttle · buttons[1]=flaps · buttons[2]=gear

---

## Aircraft included

### Atmosphere

| Aircraft | Engine | Notes |
|----------|--------|-------|
| Airbus A350-900 | Rolls-Royce Trent XWB | Autopilot, FMGS |
| Cessna 172S | Lycoming IO-360 · 180hp | Full kneeboard, grass strip |
| Robin DR400/140B | Lycoming O-320 · 160hp | Flugschule Grenchen checklists |
| Messerschmitt Bf 109 G-4 | Daimler-Benz DB 601 · 1175hp | AudioWorklet 12-cylinder impulse model |
| Avro 504K | Le Rhône 9J · 110hp | Gyroscopic precession, rotary blip switch |
| Tupolev Tu-95MS Bear H | Kuznetsov NK-12MV × 4 · 44740kW | Russian crew voices, contra-rotation LFO |
| Antonov An-225 Mriya | ZMKB Progress D-18T × 6 · 1 377 kN | Ukrainian crew voices (Lesya), 500 t, Hostomel 2022 |

### Orbit

| Vehicle | Notes |
|---------|-------|
| Falcon 1 | 27 000 kg, 2-stage, RatSat payload, Omelek Island |
| Falcon 9 Block 1 | 333 400 kg, 9 Merlins, no recovery |
| Falcon 9 Block 5 | 549 054 kg, RTLS booster recovery, MECO→SECO→Keplerian orbit |
| Falcon 9 Block 5 (590 km) | Tuned for 590 km near-circular insertion — Inspiration5 |

---

## Missions included

### Fly tab

| Mission | Aircraft | Era | What |
|---------|----------|-----|------|
| ILS Approach RWY 28 | A350 | Modern | Live METAR, ATC clearances, approach brief |
| VFR Pattern | C172 | PPL | Grass strip LSZF, takeoff callouts, kneeboard |
| VFR Circuit | Robin DR400 | PPL | LSZG, Flugschule Grenchen, live METAR |
| Airshow Ground Run | Bf 109 G-4 | 2025 | DB 601 startup, D-FEML at Hahnweide |
| Patrol — Marne 1918 | Avro 504K | 1918 | WWI rotary engine, Le Rhône blip switch |
| Operation Wolfskopf | Bf 109 G-4 | 1942 | Arctic, scripted engine failure, NIFLHEIM |
| Aufklärungsflug Nordmeer | Tu-95MS Bear H | 1956 | Olenya AB, Soviet ATC, Cold War dossier |

### Orbit tab

| Mission | Vehicle | Year | What |
|---------|---------|------|------|
| Falcon 1 — Omelek Island | Falcon 1 | 2008 | First privately funded orbital rocket. 2-stage gravity turn, RatSat to LEO |
| CRS-1 — Engine Out | Falcon 9 Block 1 | 2012 | Engine failure at T+79s. Vehicle reaches orbit on 8 engines |
| Crew Dragon Demo-2 | Falcon 9 Block 5 | 2020 | Behnken + Hurley. First crewed Dragon. Stage 1 RTLS to LZ-1. Full webcast audio loop |
| Inspiration5 — Commander Leutwyler | Falcon 9 Block 5 | 2030 | Four civilians. 590 km orbit. RTLS. 3-day mission. Deorbit → reentry → splashdown |

---

## Live radar

Press **Near me** to fetch real flights via [OpenSky Network](https://opensky-network.org). No account needed.

- **Range:** 150nm (local) · 400nm (regional) · 1000nm (intercontinental — see transatlantic heavies at dawn)
- **Color coding:** each destination airport gets a color. All flights going there share it. Route lines connect aircraft to their arrival airport.
- **Routes:** callsign lookup via [adsbdb.com](https://www.adsbdb.com) — `LSZH → JFK`, `ORD → EDDM`. Results cached for the session.
- **Airports:** 23 airports drawn as runway crosses (Pistenkreuz), lit in their destination color when traffic is inbound.
- **Hover:** callsign, FL, speed, heading, route.
- **Click:** spawn the sim at that aircraft's current position, altitude, and heading.

---

## Physics model

OpenSim uses a real aerodynamic force balance — point-mass wind axes:

```
L = q × S × CL(α, flaps)
D = q × S × (CD₀(flaps) + k × CL²)
T = throttle × Tmax × ρ/ρ₀ × enginePower
W = mass × g

dv/dt  = (T·cos(α) − D − W·sin(γ)) / m
dγ/dt  = (L − W·cos(γ)) / (m·v) − 0.4·γ + trim × 0.0015
```

ISA density: `ρ = 1.225 × (1 − 2.2558e⁻⁵ × alt_m)^4.2559`

Ground roll uses rolling friction and brakes. Liftoff triggers when L ≥ W.

**Angular inertia** — PD controller with momentum (τ_roll = 0.18s, τ_pitch = 0.30s). The aircraft resists abrupt inputs and takes time to settle.

**Stall** — two modes: high-alpha snap (CL → CL_max, nose drops suddenly) and energy stall (L < W at low speed, progressive sink).

**Prop drag** — a seized or damaged propeller adds drag proportional to engine power loss.

**Gyroscopic precession** — rotary engines (Le Rhône 9J) precess when pitch or roll rate changes. Left turns assisted, right turns resisted.

Wind drift: dead reckoning uses ground velocity = TAS vector + wind vector.

---

## Rocket + orbital physics

### Ascent

Point-mass gravity turn model driven by a programmed FPA profile `[[t, fpa_deg], ...]`. Extended ISA atmosphere from sea level through 140 km. Thrust interpolated sea-level ↔ vacuum via atmospheric density fraction.

- **Staging** — automatic when propellant mass ≤ dry + upper stages
- **CECO** — center engine cutoff triggered by G-load threshold
- **On-pad hold** — vehicle holds until T/W > 1
- **Engine failures** — scripted via `engineFailures` array in mission JSON

### Orbital propagation

Velocity Verlet integrator in ECEF coordinates. Activated at SECO. Energy conserved < 0.01% over 30 minutes.

- Full 3D ECEF state vector: `{ rx, ry, rz, vx, vy, vz }`
- Ground track: full-globe view, fading tail, anti-meridian breaks, 2000-point rolling window
- Dragon / Stage 2 separation: two independent Keplerian propagators after `dragonSepT`
- Orbital period displayed live once in orbit

### Deorbit + reentry

- Retrograde ΔV subtracted from orbit vector at `deorbitT`
- Drag applied below 140 km: extended atmosphere `5.6e⁻⁶ × exp(−(alt−86km)/6150)`
- Drogue chutes at 5 500 m (CdA = 79.2 m²), 4 mains at 1 800 m (CdA = 996 m²)
- Terminal velocity ~6 m/s, splashdown detected at alt ≤ 0

### Booster RTLS

Phases: **flip → boostback → coast → glide → landing → landed**

- Boostback: retrograde burn (3 engines) opposing full velocity vector — apogee ~100–130 km
- Glide: grid fin drag multiplier ×8
- Landing burn: single engine, proportional throttle `v²/2h` for soft touchdown

---

## Sound

All sound is synthesised. No samples.

| Layer | How |
|-------|-----|
| DB 601 / IO-360 / Le Rhône | AudioWorklet impulse model — cylinders fire at individual crankshaft angles |
| NK-12 turboprop | Oscillator harmonics + 3.8Hz LFO (contra-rotation AM beat) + slewTime 1.8s |
| GTF / HBF / LBF | Oscillator harmonics, engine-specific filter and gain profile |
| Wind | White noise → bandpass, gain ∝ speed², filter softens with flaps |
| Flap rumble | Low-frequency turbulence noise, rises with flap angle |
| Ground creak | Lowpass rumble, WoW × speed — grass strip character |
| Coolant hiss | Highpass steam noise, rises as `enginePower` drops |
| Engine bang | Single impulse event — damage hit |
| Engine gunfire | 5 rapid irregular impacts — enemy burst |

Engine RPM displayed live. Oil temp warms over 4 minutes. EGT and CHT track throttle.

### DB 601 — physical impulse model

The Daimler-Benz DB 601 V12 (D-FEML, Bf 109 G-4, Hahnweide 2025) is synthesised sample-by-sample via AudioWorklet:

- **12 cylinders** fire at their own crankshaft angle (every 60°, ±8° jitter)
- **Each firing** generates an impulse + noise burst with exponential decay
- **Exhaust resonator** at ~110 Hz — the fundamental of the DB 601 note
- **Supercharger** — two sine oscillators (663 Hz + 1097 Hz) mechanically coupled to RPM

The same impulse model drives the Lycoming IO-360 (4 cylinders) and Le Rhône 9J (9-cylinder rotary).

### NK-12 — contra-rotation beat

The Kuznetsov NK-12MV drives two contra-rotating propellers. OpenSim synthesises the characteristic beating sound via Web Audio API LFO:

- **LFO at 3.8Hz** — OscillatorNode → GainNode connected to master gain as AM modulator
- **slewTime 1.8s** — turboprop inertia: throttle changes take seconds to spool
- **Harmonics** [1, 2, 3, 4, 5, 8] through a lowpass filter at 180Hz

---

## Crew voices

Five independent TTS voices, each with distinct character:

| Voice key | Role | Character |
|-----------|------|-----------|
| `crew` | CDR (Pilot Flying) | Daniel — calm, authoritative |
| `pm` | PLT (Pilot Monitoring) | Karen — professional, precise |
| `atc` | CAPCOM / ATC | Gordon — official radio |
| `narrator` | Webcast host (John) | Natural pace, technical commentary |
| `narrator2` | Webcast host (Lauren) | Enthusiastic, human moments |

Crew language is set per aircraft via `"crewLang": "ru-RU"`. The browser selects a matching TTS voice (macOS: Milena for Russian, Lesya for Ukrainian). Every utterance — GPWS, PM callouts, takeoff calls, ATC clearances — is spoken in that language.

The Tu-95MS crew speaks Russian: **Взлётная · Набор · Тысяча · Пятьсот · Проходим десять тысяч.**
The An-225 Mriya crew speaks Ukrainian: **Мрія, виліт дозволено. Злітна смуга вісімнадцять.**

ATC clearances support time triggers, altitude triggers (ascending and descending), and named rocket events:

```json
{ "t": 60, "text": "Liftoff.", "voice": "narrator" },
{ "event": "maxq", "text": "Max Q.", "voice": "narrator2" },
{ "event": "alt", "alt_km": 80, "text": "Kármán line.", "voice": "narrator" },
{ "event": "alt_desc", "alt_ft": 200, "text": "200 feet.", "voice": "pm" },
{ "event": "seco", "text": "SECO confirmed.", "voice": "narrator" },
{ "event": "splashdown", "text": "Splashdown confirmed.", "voice": "narrator", "delay": 1000 }
```

Named rocket events: `supersonic` · `maxq` · `ceco` · `meco` · `stagesep` · `seco` · `orbit` · `booster_flip` · `booster_boostback` · `booster_coast` · `booster_entry` · `booster_landing_burn` · `booster_landing` · `deorbit` · `blackout` · `signal` · `drogue` · `mains` · `splashdown`

### Voice tester

Open `voice-test.html` directly in the browser (no server needed) to explore available TTS voices and tune parameters before committing them to a mission. Filter by language (EN / UK 🇺🇦 / RU / DE / ALL), adjust rate, pitch, and volume with sliders, and fire preset sentences from ATC clearances, crew callouts, and narrative text. Cmd+Enter speaks the current text.

---

## Mission briefing documents

Missions can carry classified briefing images rendered in the pre-flight overlay:

```js
briefing: {
  classification: 'СОВЕРШЕННО СЕКРЕТНО',
  document:    'images/nordmeer-briefing-ru.png',
  document_en: 'images/nordmeer-briefing-en.png',   // RU/EN toggle appears
  image:       'images/olenya-1956.png',
}
```

The Nordmeer 1956 dossier was generated by Gemini: Soviet КГБ order in Cyrillic, then the same document with CIA stamps — *EYES ONLY · Director of Central Intelligence* — and a pencil annotation in the margin: *"Bear H out of Olenya — confirmed. SIGINT match. — R.H."*

---

## COM panel

The COM radio reads frequencies from the mission JSON. The Tu-95MS flies with:

```json
"com": {
  "title": "Р/С 1",
  "xpdrLabel": "IFF",
  "freqs": {
    "302.800": { "label": "ОЛЕНЬЯ · ВЫЛЕТ" },
    "121.500": { "label": "АВАРИЙНЫЙ" },
    "8971.000": { "label": "РАДИОМОЛЧАНИЕ" }
  }
}
```

All other missions fall back to LSZH frequencies with ATIS and squawk assignment.

---

## Failure system

Missions can script mechanical failures:

```json
"failures": [
  { "trigger": { "type": "time", "t": 115 }, "type": "engine_gunfire" },
  { "trigger": { "type": "time", "t": 120 }, "type": "engine_bang" },
  { "trigger": { "type": "time", "t": 120 }, "type": "engine_power", "value": 0.35, "rampTime": 20 },
  { "trigger": { "type": "time", "t": 160 }, "type": "engine_power", "value": 0.0,  "rampTime": 30 }
]
```

`enginePower` multiplies thrust and engine sound gain simultaneously. Trigger types: `time` · `alt`.

---

## Structure

```
core/
  state.js       — single source of truth, all sim state
  physics.js     — aerodynamic force balance, wind drift, turbulence
  crew.js        — five voices: CDR · PLT · CAPCOM · Narrator × 2, rocket events, language-aware
  rocket.js      — gravity turn, staging, RTLS booster, Keplerian propagator, deorbit + reentry
  failures.js    — scripted failure event processor
  mission.js     — loads aircraft + mission JSON, live METAR fetch
  input.js       — keyboard · mouse · Gamepad API
  loop.js        — rAF loop: tickFailures → tickPhysics → tickCrew → renders
  sound.js       — procedural audio: engine + wind + all layers
  telemetry.js   — flight recorder: 2Hz JSONL, download with Ctrl+Shift+T
  liveflight.js  — live flight lookup (adsb.fi) + nearby radar (OpenSky)

display/
  pfd.js         — Primary Flight Display (canvas)
  g1000.js       — Garmin G1000: PFD + MFD engine strip
  fma.js         — 5-box Flight Mode Annunciator
  ecam.js        — Engine + Warning Display
  kneeboard.js   — HTML overlay kneeboard: briefings + checklists
  map.js         — Mini moving map: heading/track/wind/stopwatch
  terrain.js     — 3D outside view: pinhole projection, ground grid
  outside.js     — outside view shell
  com.js         — COM radio + transponder, mission-configurable frequencies

aircraft/
  a350.json            — Airbus A350-900
  c172.json            — Cessna 172S (full kneeboard, LSZF)
  robin-dr400.json     — Robin DR400/140B (Flugschule Grenchen)
  bf109.json           — Messerschmitt Bf 109 G-4 (DB 601 impulse model)
  avro504.json         — Avro 504K (Le Rhône 9J, gyroscopic precession)
  tu95ms.json          — Tupolev Tu-95MS Bear H (NK-12 turboprop, ru-RU crew)
  falcon1.json         — Falcon 1 (27 000 kg, Omelek Island)
  falcon9-b1.json      — Falcon 9 Block 1 (333 400 kg, no recovery)
  falcon9-b5.json      — Falcon 9 Block 5 (549 054 kg, RTLS)
  falcon9-b5-590.json  — Falcon 9 Block 5, tuned for 590 km insertion

missions/
  lszh-approach.json     — ILS RWY 28, live METAR, ATC clearances
  grenchen-circuit.json  — VFR circuit, Robin DR400, LSZG
  lszf-pattern.json      — VFR circuit, grass, C172, LSZF
  wolfskopf-1942.json    — Arctic 1942, scripted engine failure, NIFLHEIM
  hahnweide-1944.json    — Airshow ground run, D-FEML
  melun-1918.json        — WWI patrol, Le Rhône rotary
  nordmeer-1956.json     — Cold War recon, Tu-95MS, Olenya AB, Soviet ATC
  falcon1-omelek.json    — Falcon 1, 2008, first private orbital rocket
  crs1.json              — Falcon 9 B1, 2012, engine out T+79s
  crew-demo2.json        — Falcon 9 B5, 2020, Behnken + Hurley, RTLS, full webcast
  inspiration5.json      — Falcon 9 B5, 2030, 590 km, 3-day mission, full loop

tests/
  db601-synth.test.mjs  — Node: 13 synthesis math tests, ~0.2s
  db601-sound.spec.js   — Playwright: 9 sound state machine tests
  physics.spec.js       — Playwright: 10 physics tests, ~45s headless
  rocket.spec.js        — Playwright: 25 rocket tests (pad, liftoff, staging, orbit, RTLS, Dragon sep)
  check_alt.spec.js     — Playwright: 30 Inspiration5 orbit validation tests (perigee 560–630 km, e < 0.05)

server/
  hub.js         — WebSocket hub (Node.js, runs on Pi)
```

---

## Testing

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` runs two suites in sequence:

**1. Synthesis math (Node.js, ~0.2s)**
Pure unit tests — no browser, no audio. Verifies the DB 601 sound synthesis formulas are correct.

```
node --test tests/db601-synth.test.mjs

✔ gain chain continuity — synthesis end matches worklet idle
✔ scale factor formula — (masterGain × 0.4) / 0.8
✔ gear tail envelope — starts at 0.30
✔ gear tail envelope — decays to ~1/e at τ = 3 s
✔ gear tail envelope — at 9 s (3τ) is ~e⁻³ ≈ 5% of start
✔ lader frequency — proportional to RPM
✔ lader frequency — rises with RPM (not constant)
✔ throttle → rpm mapping covers full range
✔ master gain increases monotonically with throttle
✔ master gain at idle = masterGain × 0.4
✔ startup total duration — flywheel + klonk + motoring + runup + gaps
✔ worklet resonator tracks firing frequency — different at idle vs cruise
✔ worklet resonator caps at 480 Hz (above 4800 RPM)
13 passed
```

**2. Physics + sound state machine (Playwright, ~60s headless)**
Browser tests verifying physics, engine lifecycle, and sound parameters.

```
Running 19 tests using 1 worker
  19 passed
```

| Suite | Test | Passes if |
|-------|------|-----------|
| C172 physics | rotation | Liftoff 50–75 kt |
| C172 physics | climb | VS > 300 fpm |
| C172 physics | stall | VS < −100 fpm below Vs |
| Robin physics | rotation | Liftoff 60–75 kt |
| Robin physics | climb | VS > 300 fpm |
| Robin physics | stall | VS < −100 fpm below Vs |
| Bf 109 physics | engine failure | `enginePower` < 0.5 by T+200 |
| Bf 109 physics | engine dead | `enginePower` < 0.05 by T+210 |
| Tu-95MS physics | rotation | Liftoff 155–230 kt (flaps 20°) |
| Tu-95MS physics | climb | VS > 500 fpm |
| DB 601 state machine | starts off | `engineState` = `'off'` on load |
| DB 601 state machine | rpm format | `getCurrentRpm()` returns `"NNN RPM"` |
| DB 601 RPM | idle | 400 RPM at spdT=0 |
| DB 601 RPM | rises with throttle | idle < half < max |
| DB 601 RPM | range | always within rpmIdle–rpmMax |
| DB 601 gain chain | handoff continuity | synthesis end = worklet idle level |
| DB 601 gain chain | throttle scaling | gain rises monotonically 0→1 |
| DB 601 gain chain | lader proportional | 700 Hz at idle, 1400 Hz at 2× RPM |
| DB 601 supercharger | engine off | `enginePower` > 0 |

---

## Add an aircraft

```json
{
  "id": "your-aircraft",
  "name": "Your Aircraft",
  "manualControl": true,
  "crewLang": "de-DE",

  "envelope": {
    "cruiseSpd": 122, "maxSpd": 163,
    "spdProfile": { "8000": 122, "3000": 100, "0": 55 }
  },

  "performance": {
    "mass": 1157, "wingArea": 16.2, "thrustMax": 1800,
    "CL_0": 0.2, "CL_alpha": 5.0, "CL_max": 1.9,
    "CD_0": 0.028, "inducedK": 0.055,
    "Vr": 55, "muRoll": 0.05, "muBrake": 0.35
  },

  "handling": {
    "rollRate": 30, "pitchRate": 5, "maxBank": 60, "maxPitch": 20
  },

  "flaps": [
    { "deg":  0, "dCL_max": 0.0, "dCD_0": 0.000 },
    { "deg": 10, "dCL_max": 0.3, "dCD_0": 0.010 },
    { "deg": 30, "dCL_max": 0.7, "dCD_0": 0.035 }
  ],

  "sound": { "engineType": "lycoming-o360" }
}
```

Add a test in `tests/physics.spec.js`. POH numbers → test bounds → fly → verify telemetry.

---

## Add a mission

```json
{
  "id": "your-mission",
  "title": "Your Mission",
  "aircraft": "aircraft/your-aircraft.json",

  "weather": {
    "source": "live",
    "icao": "LSZH",
    "fallback": { "wdir": 270, "wspd": 12, "turbulence": 0.2, "altim": 1013 }
  },

  "initialState": {
    "lat": 47.39, "lon": 8.78,
    "alt": 1788, "spd": 0, "hdg": 260, "pitch": 0, "roll": 0
  },

  "failures": [
    { "trigger": { "type": "time", "t": 120 }, "type": "engine_bang" },
    { "trigger": { "type": "time", "t": 120 }, "type": "engine_power", "value": 0.0, "rampTime": 60 }
  ],

  "debrief": ["Did you find the field?", "Did you walk away?"]
}
```

---

## Telemetry

Every flight is recorded automatically. Press `Ctrl+Shift+T` to download a JSONL file.

```json
{"t":48.6,"alt":1789,"spd":68.7,"vs":11,"pitch":9.06,"roll":0,"hdg":260,
 "enginePower":1,"flaps":0,"lat":47.385,"lon":8.776,
 "pitchT":10.64,"rollT":0,"spdT":163,"braking":0}
```

Use the gap between `pitch` and `pitchT` to see angular inertia working. Feed to pandas, plot, debrief approaches, or stream to an AI co-pilot.

```python
import json, pandas as pd, matplotlib.pyplot as plt

df = pd.DataFrame([json.loads(l) for l in open('flight.jsonl')])
df.plot(x='t', y=['alt','vs'], secondary_y='vs')
plt.show()
```

---

## Vision

- **PPL(A) training** — circuits at LSZF and LSZG, licence end of 2026
- **Kitfox electric digital twin** — the sim IS the avionics
- **Time machine** — 1918 · 1942 · 1956 · Apollo 11 · Challenger · Demo-2
- **Rwanda aviation academy** — three Raspberry Pis and a browser
- **Ghost aircraft replay** — record instructor flight as JSONL, student flies alongside
- **AI PM** — stream telemetry to Claude API for real-time callouts and post-flight debrief
- **Hardware cockpit** — RPi WebSocket bridge, physical panels, force-feedback controls

---

## Why

Because a 40-million-franc simulator should not be the only way to train crew.
Because anyone on earth with a browser should be able to fly.
Because somewhere in the permafrost near Titovka, a man is still waiting to be found.

---

## License

MIT © 2026 Markus Leutwyler
Built with [Claude Code](https://claude.ai/code) by Anthropic.

---

*Developed with Claude. Things happen there you could not imagine.*
