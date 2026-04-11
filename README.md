# OpenSim

**Open-source browser-based simulation engine.**
Any vehicle is a JSON file. Any mission is a JSON file.

![OpenSim PFD — ILS Approach LSZH](opensim.png)

Born 05:32, Sunday 15 March 2026, Zürich. Built with Claude Code.

---

**Realism as respect.**

Every aircraft modeled here carried a human being. Every engine sound is calibrated from real recordings. Every mission is set on the right day, over the right place, with the right names.

We do not take sides in history. A nineteen-year-old climbing into a Zero over the Pacific deserves the same accuracy and respect as the one climbing into a Corsair. OpenSim honors duty. Not victory. Not ideology. Duty.

→ [MANIFEST.md](MANIFEST.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

---

## Who it is for

**Spotters** — open the live radar, watch real flights within 1000nm, color-coded by destination. Click any aircraft and fly it at its current position, altitude, and heading.

**Historians** — load a mission from 1918, 1942, or 1956. Read the classified briefing document. Hear the crew in the right language. Fly the aircraft with the right physics.

**Airplane buffs** — the DB 601 fires 12 cylinders via AudioWorklet. The NK-12 contra-rotation beat is a 3.8Hz LFO modulating the master gain. Every number in the aircraft JSON came from a POH or technical manual.

**PPL students** — circuits at LSZF and LSZG. Full checklists. GPWS callouts. Takeoff and approach briefings. Real weather via live METAR.

**Makers** — build a Dragon capsule mockup with a table saw, a Bambu A1, and four screens. Wire an ESP32 to a physical altimeter. Add a 6-DOF motion platform. The WebSocket data stream is open.

**Anyone with a browser** — no install. No login. No fee. Works on a laptop, tablet, or Raspberry Pi.

---

## What it is

OpenSim is not a game. It is a modular simulation engine that runs entirely in the browser with zero dependencies and no build step.

- **Real aerodynamic physics** — lift, drag, thrust, weight from first principles. Not kinematic approximations.
- **Procedural sound** — engine sounds synthesised from physics. No samples. Wind rises with airspeed. The DB 601 fires 12 cylinders. The NK-12 turboprop beats at 3.8Hz.
- **Historically accurate comm chain** — every voice passes through the correct radio equipment for its era. VHF aviation, NASA S-band, Soviet VHF, SpaceX IP backbone. Pre-recorded voices, archival recordings, or TTS — all through the same chain.
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
| `W` | Time warp — rocket missions only (1× → 10× → 100× → 1000×) |
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
| Antonov An-225 Mriya | ZMKB Progress D-18T × 6 · 1 377 kN | Ukrainian crew voices, 500 t, Hostomel 2022 |

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
| Mriya — Die letzte Reise | An-225 | 2022 | Hostomel, Ukrainian ATC, 3 February 2022 |

### Orbit tab

| Mission | Vehicle | Year | What |
|---------|---------|------|------|
| Falcon 1 — Omelek Island | Falcon 1 | 2008 | First privately funded orbital rocket. 2-stage gravity turn, RatSat to LEO |
| CRS-1 — Engine Out | Falcon 9 Block 1 | 2012 | Engine failure at T+79s. Vehicle reaches orbit on 8 engines |
| Crew Dragon Demo-2 | Falcon 9 Block 5 | 2020 | Behnken + Hurley. First crewed Dragon. Stage 1 RTLS to LZ-1. Full webcast audio |
| Inspiration5 — Commander Leutwyler | Falcon 9 Block 5 | 2030 | Four civilians. 590 km orbit. RTLS. 3-day mission. Deorbit → reentry → splashdown |

---

## Live radar

Press **Near me** to fetch real flights via [OpenSky Network](https://opensky-network.org). No account needed.

- **Range:** 150nm (local) · 400nm (regional) · 1000nm (intercontinental)
- **Color coding:** each destination airport gets a color. All flights going there share it.
- **Routes:** callsign lookup via [adsbdb.com](https://www.adsbdb.com) — `LSZH → JFK`, `ORD → EDDM`
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

**Angular inertia** — PD controller with momentum (τ_roll = 0.18s, τ_pitch = 0.30s).
**Stall** — high-alpha snap + energy stall (progressive sink at low speed).
**Gyroscopic precession** — rotary engines precess when pitch or roll rate changes.

---

## Rocket + orbital physics

Point-mass gravity turn, programmed FPA profile, extended ISA through 140 km. Thrust interpolated sea-level ↔ vacuum.

**Orbital propagation** — Velocity Verlet integrator in ECEF. Energy conserved < 0.01% over 30 minutes. Dragon / Stage 2 propagate independently after separation.

**Deorbit + reentry** — retrograde ΔV at `deorbitT`, drag below 140 km, drogue at 5 500 m, mains at 1 800 m, terminal ~6 m/s.

**Booster RTLS** — flip → boostback → coast → glide → landing. Single engine proportional throttle `v²/2h`.

**Time warp** — `W` key cycles 1× → 10× → 100× → 1000×. A 3-day Inspiration5 orbit takes ~4 minutes real time at 1000×.

---

## Sound

All engine sound is synthesised. No samples.

| Layer | How |
|-------|-----|
| DB 601 / IO-360 / Le Rhône | AudioWorklet impulse model — cylinders fire at individual crankshaft angles |
| NK-12 turboprop | 3.8Hz LFO contra-rotation beat + slewTime 1.8s |
| GTF / HBF / LBF | Oscillator harmonics, engine-specific filter and gain |
| Wind | White noise → bandpass, gain ∝ speed² |
| Ground creak | Lowpass rumble, WoW × speed |
| Coolant hiss | Rises as `enginePower` drops |

See `docs/db601-synthesis.md` for the full DB 601 physical impulse model.

---

## Audio chain — historically accurate comm

Every voice in a mission passes through the correct radio equipment for its era. The voice source and the comm chain are decoupled:

```
[voice source]           [commProfile chain]
ElevenLabs MP3      ──►  bandpass + presence boost
Archival recording  ──►  noise floor + crackle
H4n Pro WAV         ──►  carrier hum + squelch tail  ──►  speakers
Web Speech TTS      ──►
                    ↑
          environment bleed
          (engine tap from sound.js)
```

### commProfile presets

| Profile | Era | Character |
|---|---|---|
| `vhf-aviation` | Standard ATC 118–137 MHz | Bandpass 350–3400 Hz, presence boost, squelch tail |
| `tower-quiet` | Ground station TX | Cleaner — quiet room, good equipment |
| `sband-apollo` | NASA S-band MSFN | More hiss — 380 000 km signal path |
| `vhf-vostok` | Soviet VHF 1961 | Narrow, harsh, heavy noise floor |
| `ip-spacex` | SpaceX IP backbone | Near-phone quality, minimal processing |

### Environment bleed

Cockpit profiles tap the live engine output and mix it into received comms. A Bf 109 pilot hears ATC with DB 601 underneath. A Dragon crew hears CAPCOM with Merlin rumble during ascent.

### Voice sources

Three tiers, all through the same chain:

- **ElevenLabs MP3** — pre-generated character voices (e.g. Ukrainian ATC: Olena voice)
- **Archival recording** — real mission audio. NASA audio is public domain. SpaceX webcasts.
- **Own recording** — Zoom H4n Pro, 24-bit WAV. For Inspiration5: Markus, Lydia, Pradeep, and MS2 record their own lines. The actual crew, in the actual simulator, years before launch.

### Mission JSON

```json
{
  "commProfile": "vhf-aviation",
  "atcClearances": [
    { "t": 5, "audio": "audio/hostomel/atc_olena.mp3" },
    { "t": 8, "text": "Мрія, запуск двигунів дозволено.", "voice": "atc" }
  ]
}
```

If an `audio:` file is missing, the mission falls back to TTS automatically.

See `docs/audio-chain.md` for full documentation including spectral analysis results.

---

## Crew voices (TTS)

Five independent voices, each with distinct character:

| Voice key | Role | Character |
|-----------|------|-----------|
| `crew` | CDR (Pilot Flying) | Daniel — calm, authoritative |
| `pm` | PLT (Pilot Monitoring) | Karen — professional, precise |
| `atc` | CAPCOM / ATC | Gordon — official radio |
| `narrator` | Webcast host (John) | Natural pace, technical |
| `narrator2` | Webcast host (Lauren) | Enthusiastic, human moments |

Crew language set per aircraft via `"crewLang": "ru-RU"`. Every utterance — GPWS, PM callouts, ATC clearances — in that language.

Named rocket events: `supersonic` · `maxq` · `ceco` · `meco` · `stagesep` · `seco` · `orbit` · `booster_flip` · `booster_boostback` · `booster_landing` · `deorbit` · `blackout` · `signal` · `drogue` · `mains` · `splashdown`

---

## Hardware ecosystem

OpenSim streams live sim state over WebSocket from a Raspberry Pi hub. Any device on the network can consume it.

**Physical cockpit mockup** — four screens, four seats, each a browser tab. Build the frame from wood and 3D-printed panels. FabLab Winti has the tools. The software is already there.

**6-DOF motion platform** — G-force, pitch, roll, vertical acceleration are computed every tick. Publish the WebSocket format, makers wire their platform to the data stream. MaxQ pushes you back. Stage sep: weightlessness.

**Physical instruments** — ESP32 reads WebSocket state keys (`S.alt`, `S.spd`, `S.hdg`...) and drives stepper motors. 3D print the bezels, wire the needles. Altimeter, airspeed, VSI, RPM — all physical, all driven by the same physics engine.

The software is the platform. The hardware is the expression. MIT open source means anyone can build.

---

## Structure

```
core/
  state.js                    — single source of truth, all sim state
  physics.js                  — aerodynamic force balance, wind drift, turbulence
  rocket.js                   — gravity turn, staging, RTLS, Keplerian propagator, reentry
  crew.js                     — five voices, rocket events, language-aware, radio dispatch
  radio.js                    — commProfile chain: createRadioChain(), playThroughChain()
  radio-crackle-processor.js  — AudioWorklet: crackle, static bursts, squelch tail
  sound.js                    — procedural engine audio, engine bleed tap
  mission.js                  — loads aircraft + mission JSON, live METAR fetch
  failures.js                 — scripted failure event processor
  input.js                    — keyboard · mouse · Gamepad API
  loop.js                     — rAF loop: tickFailures → tickPhysics → tickCrew → renders
  telemetry.js                — flight recorder: 2Hz JSONL

display/
  bf109.js       — Bf 109 instrument panel
  rocket_display.js — SpaceX-style telemetry, split panel for RTLS
  map.js         — world map (rocket) + local mini-map + vehicle silhouette panels
  terrain.js     — 3D outside view: day/night sky, stars, water, space
  com.js         — COM radio + transponder
  svg/           — vehicle silhouettes: dragon.svg, trunk.svg, stage2.svg, stage1.svg

aircraft/        — JSON vehicle definitions
missions/        — JSON mission definitions
audio/           — voice assets (not in git — generate locally, see docs/audio-chain.md)

docs/
  db601-synthesis.md  — DB 601 physical impulse model, all parameters
  audio-chain.md      — radio chain architecture, commProfile presets, pipeline

scripts/
  render-startup.mjs   — offline DB 601 startup synthesis → startup.wav
  analyze-startup.py   — DB 601 spectrogram + phase annotation
  analyze-radio.py     — radio chain: clean vs processed spectrogram comparison

tests/
  db601-synth.test.mjs  — 13 synthesis math tests (Node, ~0.2s)
  db601-sound.spec.js   — 9 sound state machine tests (Playwright)
  physics.spec.js       — 10 physics tests (Playwright, ~45s)
  rocket.spec.js        — 25 rocket tests: pad, liftoff, staging, orbit, RTLS, Dragon sep
  check_alt.spec.js     — 30 Inspiration5 orbit tests: perigee 560–630 km, e < 0.05

server/
  hub.js   — WebSocket hub (Node.js, runs on Raspberry Pi)
```

---

## Testing

```bash
npm install
npx playwright install chromium
npm test
```

Physics, engine lifecycle, sound parameters, rocket staging, orbital mechanics — all tested headless. 55+ tests across 5 suites.

---

## Add an aircraft

```json
{
  "id": "your-aircraft",
  "name": "Your Aircraft",
  "crewLang": "de-DE",
  "envelope": { "cruiseSpd": 122, "maxSpd": 163 },
  "performance": {
    "mass": 1157, "wingArea": 16.2, "thrustMax": 1800,
    "CL_0": 0.2, "CL_alpha": 5.0, "CL_max": 1.9,
    "CD_0": 0.028, "inducedK": 0.055, "Vr": 55
  },
  "handling": { "rollRate": 30, "pitchRate": 5, "maxBank": 60 },
  "sound": { "engineType": "lycoming-o360" }
}
```

## Add a mission

```json
{
  "id": "your-mission",
  "aircraft": "aircraft/your-aircraft.json",
  "commProfile": "vhf-aviation",
  "weather": { "source": "live", "icao": "LSZH" },
  "initialState": { "lat": 47.39, "lon": 8.78, "alt": 1788, "spd": 0, "hdg": 260 },
  "atcClearances": [
    { "t": 10, "audio": "audio/your-mission/atc_line1.mp3" },
    { "t": 30, "text": "Radar contact.", "voice": "atc" }
  ],
  "failures": [
    { "trigger": { "type": "time", "t": 120 }, "type": "engine_power", "value": 0.0, "rampTime": 60 }
  ]
}
```

---

## Telemetry

Every flight recorded automatically. `Ctrl+Shift+T` downloads JSONL.

```json
{"t":48.6,"alt":1789,"spd":68.7,"vs":11,"pitch":9.06,"roll":0,"hdg":260,
 "enginePower":1,"flaps":0,"lat":47.385,"lon":8.776}
```

Feed to pandas, plot, debrief approaches, or stream to an AI co-pilot.

---

## Vision

- **PPL(A) training** — circuits at LSZF and LSZG
- **Kitfox electric digital twin** — the sim IS the avionics
- **Time machine** — 1918 · 1942 · 1956 · Apollo 11 · Challenger · Demo-2
- **FabLab cockpits** — anyone with a laser cutter and a Bambu A1 builds a Dragon capsule
- **Real crew training** — Inspiration5 crew records their actual voices on an H4n Pro, years before launch
- **Ghost aircraft replay** — record instructor flight as JSONL, student flies alongside
- **Hardware panels** — RPi WebSocket bridge, ESP32 instruments, 6-DOF motion

---

## Why

Because a 40-million-franc simulator should not be the only way to train crew.
Because anyone on earth with a browser should be able to fly.
Because the same URL that runs on a MacBook runs on a Raspberry Pi in a FabLab in Nairobi.
Because somewhere in the permafrost near Titovka, a man is still waiting to be found.

---

## License

MIT © 2026 Markus Leutwyler
Built with [Claude Code](https://claude.ai/code) by Anthropic.

---

*Developed with Claude. Things happen there you could not imagine.*
