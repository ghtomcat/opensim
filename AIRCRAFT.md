# Adding an Aircraft to OpenSim

An aircraft is a single JSON file in `aircraft/`. A mission pairs it with a scenario. The 3D outside view is handled automatically by `display/outside.js` based on the `panel` field — no code changes needed for standard types.

---

## Quickstart

1. Copy the closest existing aircraft (e.g. `aircraft/a220.json` for a narrowbody jet, `aircraft/c172.json` for a piston).
2. Change `id`, `name`, `callsign`, `icaoType`, `envelope`, and `situations`.
3. Register a mission in `index.html` → `MISSIONS` array.
4. Done.

---

## File structure

```
aircraft/
  a350.json      ← Airbus A350 (wide-body AP jet)
  a220.json      ← Airbus A220 (narrow-body AP jet)
  e190.json      ← Embraer E190 (narrow-body AP jet, e190 panel)
  c172.json      ← Cessna 172 (piston, manual control, G1000)
  bf109.json     ← Bf 109 (WWII fighter, manual control)
  velis-hb-syc.json  ← Pipistrel Velis Electro (electric, manual)
```

---

## Core fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Matches filename without `.json`. Used in mission refs. |
| `name` | string | ✓ | Full display name shown in the mission selector. |
| `panel` | string | ✓ | Selects cockpit renderer — see Panel types below. |
| `callsign` | string | ✓ | ATC callsign used by crew voices. |
| `icaoType` | string | ✓ | ICAO designator (e.g. `"A359"`, `"C172"`). |
| `approachSpeed` | number | ✓ | Vref in knots — used by PM callout logic. |
| `manualControl` | bool | — | `true` = player flies with arrow keys; `false`/absent = AP aircraft. |
| `fixedGear` | bool | — | `true` = gear always down, no G key. |
| `swissCross` | bool | — | Paints Swiss cross on v-stab and winglets. |
| `map` | bool | — | `false` disables the Leaflet moving-map overlay (default `true`). |
| `crewLang` | string | — | Voice language for crew TTS, e.g. `"de-DE"`. Default is browser default. |
| `era` | string | — | Label shown in mission card (e.g. `"PPL"`, `"MODERN"`, `"WWII"`). |

---

## Panel types

The `panel` field controls which 3D cockpit and instrument renderer is used.

| Value | Renderer | Used by |
|---|---|---|
| `"airbus"` | Airbus EFIS — PFD + ND + ECAM | A350, A220 |
| `"e190"` | Embraer Primus-style EFIS | E190 |
| `"g1000"` | Garmin G1000 glass cockpit | C172 |
| `"bf109"` | Bf 109 analog steam gauges | Bf 109 |
| `"f4u"` | F4U Corsair analog gauges | F4U-1A |
| `"velis-epsi"` | Velis Electro EPSI panel | Velis HB-SYC |

The 3D outside model (fuselage, wings, engines) is also driven by `panel`:
- `"airbus"` or `"e190"` → wide-body jet renderer (`_buildWB`) with twin turbofan engines, swept wings, proper aileron/flap animation.
- `"g1000"` → C172 high-wing geometry.
- `"bf109"` → Bf 109 propeller fighter geometry.
- Everything else → default wide-body fallback.

For `"airbus"` panel you must also add a `displays` array (see below).

---

## Livery

```json
"livery": {
  "colors": [null, null, [200, 16, 46], null, null, [20, 22, 28], null, null, null, [200, 16, 46]]
}
```

The array maps to color slots `0–9` in `display/outside.js`. `null` keeps the default.

| Index | Default color | Meaning |
|---|---|---|
| 0 | `[210, 215, 220]` | Fuselage |
| 1 | `[195, 205, 215]` | Wings |
| 2 | `[200, 16, 46]` | V-stab (Swiss red default) |
| 3 | `[200, 210, 218]` | H-stabs |
| 4 | `[ 45,  50,  60]` | Engines |
| 5 | `[ 20,  22,  28]` | Cockpit band (bandit) |
| 6 | `[215, 218, 222]` | Radome |
| 7 | `[ 45,  50,  60]` | Thrust reverser zone |
| 8 | `[ 25,  45,  75]` | Cockpit windows |
| 9 | `[195, 205, 215]` | Winglets |

---

## Engine (AP / turbofan aircraft)

Used by the outside renderer for nacelle geometry and sound.

```json
"engine": {
  "model": "trent-xwb",
  "chevrons": true,
  "thrustReverser": true
}
```

| Field | Description |
|---|---|
| `model` | Engine label shown in briefing card. No functional effect. |
| `chevrons` | Draws chevron serrations on the nozzle. |
| `thrustReverser` | Enables TR cascade overlay on landing. |

---

## Sound (manual / piston aircraft)

```json
"sound": {
  "engineType": "lycoming-o360"
}
```

| Value | Description |
|---|---|
| `"lycoming-o360"` | 4-cylinder piston — startup/shutdown lifecycle, RPM-linked |
| `"v12-supercharged"` | DB 605 / Merlin — V12 startup sequence, gyroscopic effects |
| `"radial-2000hp"` | R-2800 Double Wasp radial |
| `"electric"` | Velis Electro — high-frequency whine, no startup delay |
| `"turbofan"` | Continuous ambient tone (AP aircraft use `ambient` block instead) |

AP aircraft use the `ambient` block instead of `sound.engineType`:

```json
"ambient": {
  "type": "turbofan",
  "freqMin": 180,
  "freqMax": 380,
  "detune": 4,
  "gainMin": 0.006,
  "gainMax": 0.017
}
```

---

## Envelope

Defines the performance ceiling and autopilot speed targets.

```json
"envelope": {
  "cruiseAlt": 35000,
  "maxAlt": 43000,
  "cruiseSpd": 312,
  "maxSpd": 350,
  "spdProfile": {
    "35000": 312,
    "10000": 250,
    "3000": 180,
    "0": 135
  }
}
```

`spdProfile` is a map of `altitude_ft → max_speed_kt`. The physics engine caps speed at the value for the aircraft's current altitude band. Keys are evaluated from highest to lowest.

---

## Situations

Five preset states loaded by number keys `1–5` (disabled when a mission is active).

```json
"situations": [
  { "label": "GROUND",   "alt": 1450, "spd": 0,   "hdg": 280, "altT": 1450, "spdT": 0   },
  { "label": "TAKEOFF",  "alt": 1450, "spd": 160,  "hdg": 280, "altT": 10000,"spdT": 350 },
  { "label": "CLIMB",    "alt": 10000,"spd": 250,  "hdg": 280, "altT": 35000,"spdT": 280 },
  { "label": "CRUISE",   "alt": 35000,"spd": 312,  "hdg": 280, "altT": 35000,"spdT": 280 },
  { "label": "APPROACH", "alt": 3000, "spd": 180,  "hdg": 280, "altT": 2000, "spdT": 180 }
]
```

`alt`/`spd`/`hdg` = current state. `altT`/`spdT` = AP targets. There is no `hdgT` in situations — the AP defaults to the current heading on load.

---

## Thrust profiles

Four presets mapped to keys `F1–F4`.

```json
"thrustProfiles": [
  { "label": "IDLE", "spdT": 0   },
  { "label": "CLB",  "spdT": 180 },
  { "label": "MCT",  "spdT": 280 },
  { "label": "TOGA", "spdT": 350 }
]
```

---

## Manual flight physics

Required when `manualControl: true`. Drives the aerodynamic flight model.

```json
"performance": {
  "mass":      1157,
  "wingArea":  16.2,
  "thrustMax": 1800,
  "CL_0":      0.2,
  "CL_alpha":  5.0,
  "CL_max":    1.9,
  "CD_0":      0.028,
  "inducedK":  0.055,
  "Vr":        55,
  "muRoll":    0.05,
  "muBrake":   0.35
},
"handling": {
  "rollRate":  30,
  "pitchRate": 5,
  "maxBank":   60,
  "maxPitch":  20
}
```

**Performance fields:**

| Field | Unit | Description |
|---|---|---|
| `mass` | kg | MTOW |
| `wingArea` | m² | Reference wing area |
| `thrustMax` | N | Maximum static thrust |
| `CL_0` | — | Zero-AoA lift coefficient |
| `CL_alpha` | /rad | Lift curve slope |
| `CL_max` | — | Stall lift coefficient |
| `CD_0` | — | Zero-lift drag |
| `inducedK` | — | Induced drag factor |
| `Vr` | kt | Rotation speed |
| `muRoll` | — | Rolling friction coefficient |
| `muBrake` | — | Braking friction coefficient |

**Handling fields** control rate limits and PD controller gains:

| Field | Unit | Description |
|---|---|---|
| `rollRate` | °/s | Max commanded roll rate |
| `pitchRate` | °/s | Max commanded pitch rate |
| `maxBank` | ° | Bank angle limit (aileron authority) |
| `maxPitch` | ° | Pitch limit |

---

## Flaps

Defines aerodynamic effects per config step. Applies to manual aircraft only.

```json
"flaps": [
  { "deg": 0,  "dCL_max": 0.0, "dCD_0": 0.000 },
  { "deg": 10, "dCL_max": 0.3, "dCD_0": 0.010 },
  { "deg": 20, "dCL_max": 0.5, "dCD_0": 0.020 },
  { "deg": 30, "dCL_max": 0.7, "dCD_0": 0.035 }
]
```

`deg` or `label` — the label shown in the cockpit. `dCL_max` adds to stall CL. `dCD_0` adds to parasitic drag.

---

## Fuel system

```json
"tanks": { "left": 95, "right": 95, "unit": "L" },
"fuelBurn": 28,
"hasCarbHeat": true
```

| Field | Description |
|---|---|
| `tanks` | `left`/`right` capacity in the given unit (`"L"` or `"kg"`). Omit entirely for jets/no-tank aircraft. |
| `fuelBurn` | Consumption in unit/hour at full power. |
| `hasCarbHeat` | Enables the carb heat control (C key). |

AP aircraft (A350, A220, E190) have no `tanks` — they use `fuelLeft: null` and are not fuel-limited.

---

## FMA phases

Defines the Flight Mode Annunciator text for each altitude band, shown on the PFD. Evaluated top-to-bottom — first match wins.

```json
"fmaPhases": [
  {
    "minAlt": 10000,
    "vals": ["A/THR", "AP1", "NAV", "CRZ", "ALT"],
    "cols": ["white", "green", "green", "cyan", "white"]
  },
  {
    "minAlt": 0,
    "vals": ["SPEED", "", "LOC", "ROLLOUT", ""],
    "cols": ["white", "white", "green", "green", "white"]
  }
]
```

Five columns left to right: thrust mode, lateral AP, lateral nav, vertical mode, approach phase. Colors: `"white"`, `"green"`, `"cyan"`, `"amber"`.

---

## Crew callouts

### Checklist callouts (approach)

Spoken by PM as the aircraft descends through each altitude.

```json
"checklist": {
  "flaps": [
    { "alt": 1400, "config": 1, "pf": "flaps one",  "pm": "flaps one"  },
    { "alt":  900, "config": 2, "pf": "flaps two",  "pm": "flaps two"  },
    { "alt":  500, "config": 3, "pf": "flaps full", "pm": "flaps full" }
  ],
  "gear": {
    "alt": 700,
    "pf": "gear down",
    "pm": "gear down and locked"
  }
}
```

`config` is the flap index (matches flap step number). `pf`/`pm` are the TTS strings for each crew role.

### GPWS callouts

```json
"gpws": [
  { "alt": 1000, "text": "1 0 0 0", "speech": "one thousand",  "red": false },
  { "alt":  200, "text": "MINIMUM", "speech": "minimum",       "red": true  },
  { "alt":   10, "text": "R E T A R D", "speech": "retard",    "red": false }
]
```

`text` is displayed on screen. `speech` is the TTS string. `red: true` renders the callout in red. Each altitude fires exactly once per approach.

### PM altitude callouts

```json
"pmCallouts": [
  { "alt": 10000, "speech": "passing ten thousand" },
  { "alt":  1000, "speech": "passing one thousand" }
]
```

Fired on descent through each altitude. Uses PM voice.

### Takeoff callouts (piston/manual)

```json
"takeoffCallouts": [
  { "spd": 55, "speech": "rotate",    "voice": "pm" },
  { "spd": 74, "speech": "best rate", "voice": "pm" }
]
```

Fired on climb through each speed. `voice`: `"pm"` or `"pf"`.

---

## Kneeboard

Shown in the kneeboard overlay (K key). Alternates between `"briefing"` and `"checklist"` types.

```json
"kneeboard": [
  {
    "title": "APPROACH FLOW",
    "type": "briefing",
    "items": [
      "ATIS received · QNH noted",
      "ILS freq tuned + identified"
    ]
  },
  {
    "title": "LANDING CHECKLIST",
    "type": "checklist",
    "items": [
      "GEAR — DOWN · 3 GREEN",
      "FLAPS — CONF FULL"
    ]
  }
]
```

`"briefing"` renders with a plain list. `"checklist"` renders with checkboxes. Items are plain strings — use `·` and `—` for formatting.

---

## Displays (Airbus panel only)

Required for `panel: "airbus"` and `panel: "e190"`. Maps physical screens to panel specs.

```json
"displays": [
  { "id": "pfd", "spec": "airbus-pfd", "screen": 0, "pages": ["airbus-pfd", "airbus-nd"] },
  { "id": "nd",  "spec": "airbus-nd",  "screen": 1, "pages": ["airbus-nd",  "airbus-ecam"] }
]
```

`spec` references a JSON file in `panels/`. `screen` is the canvas index. `pages` lists what the screen can cycle to (Tab key).

---

## Registering a mission in index.html

Add an entry to the `MISSIONS` array in `index.html`:

```js
{
  id: 'myairport-approach',   // must match missions/myairport-approach.json
  aircraft: 'myaircraft',     // must match aircraft/myaircraft.json
  acName: 'Boeing 737-800',
  engine: 'CFM56-7B · 120 kN',
  location: 'Zürich LSZH',
  title: 'ILS Approach · RWY 14',
  era: 'MODERN',
  accent: '#4dc5dc',          // card accent color
  briefing: {
    date: 'LSZH · RWY 14 · ILS 111.150',
    pilot: 'Captain / First Officer',
    unit: 'Zurich Approach 119.700',
    aircraft: 'Boeing 737-800 · SWISS LX418',
    orders: 'Cleared ILS 14. Descend 4000ft.\nGear down at FAF. Full flaps by FAP.',
    atmosphere: 'Overcast 600ft. Wet runway.',
  },
  roles: [
    { id: 'PF',         label: 'Pilot Flying' },
    { id: 'PM',         label: 'Pilot Monitoring' },
    { id: 'INSTRUCTOR', label: 'Instructor' },
  ],
},
```

---

## AP vs manual — which to use?

| | AP aircraft | Manual aircraft |
|---|---|---|
| Examples | A350, A220, E190 | C172, Bf 109, AN-225 |
| `manualControl` | absent / `false` | `true` |
| Arrow keys | change `hdgT`/`altT` | bank/pitch the aircraft |
| Physics | converges to targets | full aero model |
| Required fields | `envelope`, `thrustProfiles`, `ambient` | `performance`, `handling`, `flaps`, `sound` |
| Fuel | omit `tanks` (unlimited) | add `tanks` + `fuelBurn` |
| Ailerons (outside view) | driven by `hdgT − hdg` | driven by `rollT` |

For a new jet airliner: use AP. For a propeller aircraft or fighter: use manual.
