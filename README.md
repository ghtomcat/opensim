# OpenSim

**Open-source browser-based simulation engine.**
Any vehicle is a JSON file. Any mission is a JSON file.

![OpenSim PFD — ILS Approach LSZH](opensim.png)

Born 05:32, Sunday 15 March 2026, Zürich. Built with Claude Code.
First mission: ILS approach into LSZH RWY 28, live METAR, four crew voices, full ECAM.

---

## What it is

OpenSim is not a game. It is a modular simulation engine that runs entirely in the browser with zero dependencies.

- **Any aircraft** — define envelope, FMA phases, crew callouts, GPWS in one JSON file
- **Any mission** — weather, ATC clearances, approach brief, failures, debrief in one JSON file
- **Any vehicle** — the engine doesn't care if it's an A350, an F1 car, or a spacecraft
- **Multi-crew** — PF on one screen, PM on another, INSTRUCTOR on a third via WebSocket
- **Runs anywhere** — laptop, tablet, Raspberry Pi, six round GC9A01 displays on a DIY panel

---

## Quick start

```bash
# Any static server works
python3 -m http.server 8080
open http://localhost:8080

# Multi-crew WebSocket hub (Node.js)
npm install && npm run hub
```

No build step. No framework. Open `index.html` and fly.

---

## Controls

| Key | Action |
|-----|--------|
| `↑` / `↓` | Altitude target ±500 ft |
| `←` / `→` | Heading target ±5° |
| `+` / `−` | Speed ±5 kt |
| `F1` | IDLE |
| `F2` | CLB |
| `F3` | MCT |
| `F4` | TOGA |
| `f` | Flaps up one stage |
| `g` | Gear toggle |
| `Tab` | Cycle display: PFD → ECAM |
| `p` | Pause |
| `r` | Cycle role: PF → PM → INSTRUCTOR |
| `Space` | PTT (push to talk) |

**Gamepad:** Logitech Extreme 3D Pro wired up out of the box.
axes[0]=roll · axes[1]=pitch · axes[2]=rudder · axes[5]=throttle
buttons[0]=PTT · buttons[1]=flaps · buttons[2]=gear

---

## Structure

```
core/
  state.js       — single source of truth, all sim state
  physics.js     — flight model, ILS LOC+GS tracking (DME-based)
  crew.js        — four voices: PF · PM · ATC · GPWS, data-driven
  mission.js     — loads aircraft + mission JSON, live METAR fetch
  input.js       — keyboard · mouse · Gamepad API
  loop.js        — rAF loop, tickPhysics + tickCrew + renders

display/
  pfd.js         — Primary Flight Display (canvas)
  fma.js         — 5-box Flight Mode Annunciator (HTML overlay)
  ecam.js        — Engine + Warning Display (canvas)
  com.js         — COM panel + transponder

aircraft/
  a350.json      — Airbus A350-900

missions/
  lszh-approach.json  — ILS RWY 28 LSZH, live METAR

server/
  hub.js         — WebSocket hub (50 lines, Node.js, runs on Pi)
```

---

## Add an aircraft

Create `aircraft/your-aircraft.json`:

```json
{
  "name": "Your Aircraft",
  "envelope": {
    "maxSpd": 350,
    "climbRate": 2800,
    "descentRate": 2000,
    "turnRate": 3,
    "stallSpd": 120,
    "maxAlt": 43000
  },
  "fmaPhases": [
    { "minAlt": 0,     "maxAlt": 1000,  "lat": "SRS",    "vert": "SRS",   "thrust": "MAN TOGA" },
    { "minAlt": 1000,  "maxAlt": 10000, "lat": "HDG",    "vert": "OP CLB","thrust": "CLB"      },
    { "minAlt": 10000, "maxAlt": 99999, "lat": "NAV",    "vert": "ALT",   "thrust": "CLB"      }
  ],
  "pmCallouts": [1000, 2000, 3000, 4000, 5000, 10000],
  "gpws": {
    "sinkRate": -1500,
    "pullUpAlt": 1000
  }
}
```

---

## Add a mission

Create `missions/your-mission.json`:

```json
{
  "title": "Your Mission",
  "aircraft": "aircraft/your-aircraft.json",
  "weather": { "icao": "LSZH" },
  "initialState": {
    "alt": 8000, "spd": 250, "hdg": 280,
    "altT": 4000, "spdT": 180
  },
  "approach": {
    "course": 281, "threshold": { "lat": 47.458, "lon": 8.548 }
  },
  "atcClearances": [
    { "alt": 4000, "hdg": 280, "spd": 180, "text": "Descend 4000, heading 280" }
  ],
  "debrief": [
    "Was the approach stabilized at 1000 ft?",
    "Did you call out V/S and energy at the gate?"
  ]
}
```

---

## Vision

- **Time machine** — WWII aircraft, Apollo 11, Demo-2, Challenger, Inspiration5
- **CRM protocol engine** — not just a sim, a crew resource management trainer
- **Natural language → mission** — describe a scenario in plain text, get a JSON mission file (Claude API)
- **Rwanda aviation academy** — runs on three Raspberry Pis and a browser
- **WebSerial** — six GC9A01 round displays behind a 3D-printed bezel, driven by the same state

---

## Why

Because a 40-million-franc simulator should not be the only way to train crew.
Because anyone on earth with a browser should be able to fly.
Because my family wants to fly Inspiration5 together.

---

## License

MIT © 2026 Markus Leutwyler
Built with [Claude Code](https://claude.ai/code) by Anthropic.

---

*Developed with Claude. Things happen there you could not imagine.*
