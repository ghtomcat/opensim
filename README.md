# OpenSim

**Open-source browser-based simulation engine.**
Any vehicle is a JSON file. Any mission is a JSON file.

![OpenSim PFD — ILS Approach LSZH](opensim.png)

Born 05:32, Sunday 15 March 2026, Zürich. Built with Claude Code.

---

## What it is

OpenSim is not a game. It is a modular simulation engine that runs entirely in the browser with zero dependencies and no build step.

- **Real aerodynamic physics** — lift, drag, thrust, weight from first principles. Not kinematic approximations.
- **Procedural sound** — every sound synthesised from physics. No samples. Wind rises with airspeed. Flaps change the airflow character. The DB 605 fires 12 cylinders.
- **Any aircraft** — envelope, performance, handling, sound, checklists in one JSON file
- **Any mission** — weather, ATC clearances, approach brief, scripted failures, crew voices in one JSON file
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
| `f` / `F` | Flaps extend / retract |
| `g` | Gear toggle |
| `1`–`5` | Situation presets: Ground / Takeoff / Climb / Cruise / Approach |
| `F1`–`F4` | Thrust detents (aircraft-specific) |
| `k` | Kneeboard (briefings + checklists) |
| `n` | Mini map (heading, track made good, wind) |
| `v` | Cycle view: instruments / combined / outside |
| `Tab` | Cycle display mode |
| `p` | Pause |
| `m` | Audio on/off |
| `r` | Cycle role: PF → PM → INSTRUCTOR |
| `Space` | PTT (push to talk) |

**Gamepad:** Logitech Extreme 3D Pro out of the box.
axes[0]=roll · axes[1]=pitch · axes[2]=rudder · axes[5]=throttle · buttons[1]=flaps · buttons[2]=gear

---

## Aircraft included

| Aircraft | Engine | Physics |
|----------|--------|---------|
| Airbus A350-900 | Rolls-Royce Trent XWB | Autopilot convergence |
| Cessna 172S | Lycoming IO-360 180hp | Full aerodynamic model |
| Messerschmitt Bf 109 G-6 | Daimler-Benz DB 605 1800hp | Full aerodynamic model |
| Avro 504K | Le Rhône 9J 110hp | Full aerodynamic model |

---

## Missions included

| Mission | Aircraft | Where | What |
|---------|----------|-------|------|
| ILS Approach RWY 28 | A350 | Zürich LSZH | Live METAR, ATC clearances, approach brief |
| VFR Pattern | C172 | Speck-Fehraltorf LSZF | Grass strip, takeoff callouts, kneeboard |
| Airshow Ground Run | Bf 109 | Hahnweide EDST | DB 605 start, ground roll |
| Patrol — Marne 1918 | Avro 504K | Melun-Villaroche | WWI rotary engine |
| Operation Wolfskopf | Bf 109 | Titovka, Arctic 1942 | Scripted engine failure: gunfire → bang → dead engine |

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
Stall occurs when CL → CL_max — lift collapses, nose drops.
Wind drift: dead reckoning uses ground velocity = TAS vector + wind vector.

---

## Sound layers

All sound is synthesised. No samples.

| Layer | How |
|-------|-----|
| Engine | AudioWorklet impulse model or oscillator harmonics |
| Wind | White noise → bandpass, gain ∝ speed², filter softens with flaps |
| Flap rumble | Low-frequency turbulence noise, rises with flap angle |
| Ground creak | Lowpass rumble, WoW × speed — grass strip character |
| Coolant hiss | Highpass steam noise, rises as `enginePower` drops |
| Engine bang | Single impulse event — damage hit |
| Engine gunfire | 5 rapid irregular impacts — enemy burst |

Engine RPM displayed live. Oil temp warms over 4 minutes. EGT and CHT track throttle.

---

## Failure system

Missions can script mechanical failures in the mission JSON:

```json
"failures": [
  { "trigger": { "type": "time", "t": 115 }, "type": "engine_gunfire" },
  { "trigger": { "type": "time", "t": 120 }, "type": "engine_bang" },
  { "trigger": { "type": "time", "t": 120 }, "type": "engine_power", "value": 0.35, "rampTime": 20 },
  { "trigger": { "type": "time", "t": 160 }, "type": "engine_power", "value": 0.0,  "rampTime": 30 }
]
```

`enginePower` multiplies thrust and engine sound gain simultaneously. The coolant hiss rises automatically as the engine dies.

Trigger types: `time` (seconds elapsed) · `alt` (altitude in feet)

---

## Structure

```
core/
  state.js       — single source of truth, all sim state
  physics.js     — aerodynamic force balance, wind drift, turbulence
  crew.js        — four voices: PF · PM · ATC · GPWS, data-driven
  failures.js    — scripted failure event processor
  mission.js     — loads aircraft + mission JSON, live METAR fetch
  input.js       — keyboard · mouse · Gamepad API
  loop.js        — rAF loop: tickFailures → tickPhysics → tickCrew → renders
  sound.js       — procedural audio: engine + wind + all layers

display/
  pfd.js         — Primary Flight Display (canvas)
  g1000.js       — Garmin G1000: PFD + MFD engine strip
  fma.js         — 5-box Flight Mode Annunciator
  ecam.js        — Engine + Warning Display
  kneeboard.js   — HTML overlay kneeboard: briefings + checklists
  map.js         — Mini moving map: heading/track/wind/stopwatch
  terrain.js     — 3D outside view: pinhole projection, ground grid
  outside.js     — outside view shell
  com.js         — COM panel + transponder

aircraft/
  a350.json      — Airbus A350-900
  c172.json      — Cessna 172S (full performance + kneeboard)
  bf109.json     — Messerschmitt Bf 109 G-6 (manualControl, DB 605)
  avro504.json   — Avro 504K (Le Rhône 9J rotary)

missions/
  lszh-approach.json   — ILS RWY 28, live METAR, ATC clearances
  lszf-pattern.json    — VFR circuit, grass, C172
  wolfskopf-1942.json  — Arctic 1942, scripted engine failure
  hahnweide-1944.json  — Airshow ground run
  melun-1918.json      — WWI patrol

server/
  hub.js         — WebSocket hub (Node.js, runs on Pi)
```

---

## Add an aircraft

```json
{
  "id": "your-aircraft",
  "name": "Your Aircraft",
  "manualControl": true,

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

---

## Add a mission

```json
{
  "id": "your-mission",
  "title": "Your Mission",
  "aircraft": "your-aircraft",

  "departure": null,
  "arrival": {
    "icao": "LSZF", "runway": "26", "elevation": 1788,
    "ils": { "freq": "109.900", "course": 260 }
  },

  "weather": {
    "source": "manual",
    "manual": { "wdir": 270, "wspd": 12, "turbulence": 0.2, "altim": 1013 }
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

## DB 605 — Physical Engine Sound

The Daimler-Benz DB 605 is the V12 that powered the Bf 109G. OpenSim synthesises it sample-by-sample via AudioWorklet:

- **12 cylinders** fire at their own crankshaft angle (every 60°, ±8° jitter)
- **Each firing** generates an impulse + noise burst with exponential decay
- **Exhaust resonator** at ~110 Hz — the fundamental of the DB 605 note
- **Supercharger** — two sine oscillators (663 Hz + 1097 Hz) mechanically coupled to RPM
- **No samples** — every sound is computed from physics

The same impulse model drives the Lycoming IO-360 (4 cylinders) and Le Rhône 9J (9-cylinder rotary).

---

## Vision

- **PPL(A) training** — Markus flying circuits at LSZF, target: licence end of 2026
- **Kitfox electric digital twin** — the sim IS the avionics. Tune the sim, tune the aircraft.
- **Time machine** — WWII, Apollo 11, Demo-2, Challenger, Inspiration5
- **Rwanda aviation academy** — three Raspberry Pis and a browser
- **Hardware cockpit** — RPi WebSocket bridge, force-feedback controls, physical panels

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
