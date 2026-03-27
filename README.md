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

| Aircraft | Engine | Notes |
|----------|--------|-------|
| Airbus A350-900 | Rolls-Royce Trent XWB | Autopilot, FMGS |
| Cessna 172S | Lycoming IO-360 · 180hp | Full kneeboard, grass strip |
| Robin DR400/140B | Lycoming O-320 · 160hp | Flugschule Grenchen checklists |
| Messerschmitt Bf 109 G-4 | Daimler-Benz DB 601 · 1175hp | AudioWorklet 12-cylinder impulse model |
| Avro 504K | Le Rhône 9J · 110hp | Gyroscopic precession, rotary blip switch |
| Tupolev Tu-95MS Bear H | Kuznetsov NK-12MV × 4 · 44740kW | Russian crew voices, contra-rotation LFO |

---

## Missions included

| Mission | Aircraft | Era | What |
|---------|----------|-----|------|
| ILS Approach RWY 28 | A350 | Modern | Live METAR, ATC clearances, approach brief |
| VFR Pattern | C172 | PPL | Grass strip LSZF, takeoff callouts, kneeboard |
| VFR Circuit | Robin DR400 | PPL | LSZG, Flugschule Grenchen, live METAR |
| Airshow Ground Run | Bf 109 G-4 | 2025 | DB 601 startup, D-FEML at Hahnweide |
| Patrol — Marne 1918 | Avro 504K | 1918 | WWI rotary engine, Le Rhône blip switch |
| Operation Wolfskopf | Bf 109 G-4 | 1942 | Arctic, scripted engine failure, NIFLHEIM |
| Aufklärungsflug Nordmeer | Tu-95MS Bear H | 1956 | Olenya AB, Soviet ATC, Cold War dossier |

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

Crew language is set per aircraft via `"crewLang": "ru-RU"`. The browser selects a matching TTS voice (macOS: Milena, Chrome: Google русский). Every utterance — GPWS, PM callouts, takeoff calls — is spoken in that language.

The Tu-95MS crew speaks Russian: **Взлётная · Набор · Тысяча · Пятьсот · Проходим десять тысяч.**

ATC clearances support both altitude triggers (commercial missions) and time triggers (military departures). The Nordmeer ATC fires on elapsed seconds: engine start permission at T+5, takeoff at T+90, radio silence order at T+200.

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
  crew.js        — four voices: PF · PM · ATC · GPWS, language-aware
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
  a350.json      — Airbus A350-900
  c172.json      — Cessna 172S (full kneeboard, LSZF)
  robin-dr400.json — Robin DR400/140B (Flugschule Grenchen)
  bf109.json     — Messerschmitt Bf 109 G-4 (DB 601 impulse model)
  avro504.json   — Avro 504K (Le Rhône 9J, gyroscopic precession)
  tu95ms.json    — Tupolev Tu-95MS Bear H (NK-12 turboprop, ru-RU crew)

missions/
  lszh-approach.json     — ILS RWY 28, live METAR, ATC clearances
  grenchen-circuit.json  — VFR circuit, Robin DR400, LSZG
  lszf-pattern.json      — VFR circuit, grass, C172, LSZF
  wolfskopf-1942.json    — Arctic 1942, scripted engine failure, NIFLHEIM
  hahnweide-1944.json    — Airshow ground run, D-FEML
  melun-1918.json        — WWI patrol, Le Rhône rotary
  nordmeer-1956.json     — Cold War recon, Tu-95MS, Olenya AB, Soviet ATC

tests/
  physics.spec.js  — Playwright: 10 tests, ~45s headless

server/
  hub.js         — WebSocket hub (Node.js, runs on Pi)
```

---

## Testing

OpenSim uses [Playwright](https://playwright.dev) for automated physics validation. Every aircraft has a test. Every physics change is verified before merge.

```bash
npm install
npx playwright install chromium
npm test
```

Tests run headlessly in ~45 seconds.

```
Running 10 tests using 1 worker
  10 passed (45.5s)
```

| Test | Passes if |
|------|-----------|
| C172 rotation | Liftoff 50–75 kt |
| C172 climb | VS > 300 fpm |
| C172 stall | VS < −100 fpm below Vs |
| Robin rotation | Liftoff 60–75 kt |
| Robin climb | VS > 300 fpm |
| Robin stall | VS < −100 fpm below Vs |
| Bf 109 engine failure | `enginePower` < 0.5 by T+200 |
| Bf 109 engine dead | `enginePower` < 0.05 by T+210 |
| Tu-95MS rotation | Liftoff 155–230 kt (flaps 20°) |
| Tu-95MS climb | VS > 500 fpm |

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
