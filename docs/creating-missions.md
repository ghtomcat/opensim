# Creating Missions

A mission is a scenario: an aircraft, a place, a phase of flight, and the crew/ATC
script around it. This guide covers the mission file, how the route/briefing are
derived from the departure + arrival airports, and how to add a **new airport** so
its SIDs/STARs/approaches and runways are available.

---

## 1. The two files

A mission lives in two places:

| File | Purpose |
|---|---|
| `missions/<id>.json` | The mission definition — aircraft, start state, dep/arr, ATC + brief scripts. |
| `missions/catalog.json` (→ `core/catalog.js` `MISSIONS`) | The menu card — title, aircraft name, location, briefing card, roles, accent colour. |

The catalog entry is what shows in the picker; the `<id>.json` is loaded when the
mission starts (`missions/<id>.json`). The two share the same `id`.

---

## 2. Mission JSON

```jsonc
{
  "id": "evra-approach",            // matches the filename and the catalog id
  "phase": "cruise",                // "ground" | "cruise" | "approach" — start phase
  "title": "Cruise — Warsaw to Rīga",
  "description": "...",
  "author": "Markus Leutwyler",
  "aircraft": "a220",               // an id from aircraft/<id>.json

  "departure": { "icao": "EPWA", "name": "Warsaw" },
  "arrival":   { "icao": "EVRA", "name": "Rīga", "runway": "36",
                 "ils": { "freq": "110.300", "course": 360 }, "elevation": 36 },

  "initialState": { ... },          // where the aircraft starts (see below)
  "weather":  { "source": "live", "icao": "EVRA", "fallback": { ... } },
  "atcClearances": [ { "pm": "...", "atc": "..." } ],
  "approachBrief":  [ { "v": "pf", "t": "..." } ],
  "approachBriefAlt": 9500,         // altitude at which the brief auto-plays
  "debrief":  [ "..." ],
  "failures": [],
  "timeOfDay": 14.0                 // hours (local), drives the lighting
}
```

### Start phase + `initialState`

`initialState` places the aircraft. Three patterns:

- **Ground / takeoff** (`"phase": "ground"`): `spd: 0`, `alt` = field elevation, and a
  `"start": { "stand": "10" }` or `"start": { "runway": "22" }`. Turbofans cold-start
  (run the start sequence); the exact lat/lon/hdg are derived from the named stand/runway.
- **Cruise** (`"phase": "cruise"`): `lat`/`lon`/`alt`/`spd`/`hdg` mid-route, `ap: true`,
  `athr: true`. The engines start already running and warm.
- **Approach** (`"phase": "approach"`): like cruise but lower/slower, positioned on or
  near the ILS so the localizer/glideslope captures.

> Missions that start in the air (cruise/approach) **should still define a `departure`** —
> see §3. Without it there is no route, so no briefing, no ND track, and no managed
> speed/altitude constraints.

---

## 3. How departure + arrival drive the route

`core/route.js` `buildFullRoute(departure, arrival)` assembles the full gate-to-gate
plan from the bundled procedures + the airway graph:

```
departure → SID → airways → STAR → approach → arrival runway
```

This single route feeds the **briefing nav-log**, the **ND** (magenta/green track), the
**MCDU F-PLN**, and the **managed** autoflight (LNAV heading, VNAV altitude, A/THR speed).
Altitude and speed restrictions on the procedure legs (`≥FL260`, `≤220`) show in the
nav-log ALT/SPD columns and are honoured by managed VNAV / managed speed.

A `departure` / `arrival` block needs at minimum `{ "icao": "..." }`. Add `runway` to
pin the SID/approach end; `ils` (freq + course) for the final-approach capture;
`elevation` (m) for the ground reference. Mid-air starts: the LNAV sequencer skips the
already-flown legs and picks up at the nearest fix ahead.

For these to resolve, **both airports must be in the bundled data** (runways +
procedures). If they are not, add them — §4.

---

## 4. Adding a new airport

The bundled data is sliced to exactly the airports referenced by `missions/*.json`. To
use a new airport, name it in a mission's `departure`/`arrival`, then regenerate:

```bash
# 1. Runways + airport tiers (public domain, OurAirports — committable)
python3 scripts/build-runways.py        # → display/runways-data.js

# 2. SID/STAR/approach procedures (X-Plane CIFP — PROPRIETARY, gitignored)
python3 scripts/build-cifp.py           # → display/procedures-data-xp.js
```

Both scripts read `missions/*.json` and auto-include any new departure/arrival ICAO.
`build-runways.py` downloads OurAirports CSVs; `build-cifp.py` slices a local X-Plane 12
install (`--xplane <path>` to override).

**Licensing:** `display/runways-data.js` and the navaids are public-domain (OurAirports,
CC0) — committable. `display/procedures-data-xp.js` is Navigraph/Jeppesen via X-Plane —
**proprietary, gitignored, never redistributed.** The scripts contain no data and are
fine to commit.

Verify the route builds:

```bash
node --input-type=module -e "
  import { buildFullRoute } from './core/route.js';
  await new Promise(r => setTimeout(r, 300));   // let the procedures bundle load
  const r = buildFullRoute({icao:'EPWA'}, {icao:'EVRA', runway:'36'});
  console.log(r.legs.length, 'legs', 'SID', r.sid?.name, 'STAR', r.star?.name, 'APPR', r.appr);
"
```

A long-haul pair (e.g. KSFO → LSZH) builds a sparse en-route segment — the airway graph
only spans the bundled navaids — but the SID, STAR, approach, and constraints are intact.

---

## 5. Aircraft

`"aircraft"` is an `aircraft/<id>.json` id. Match the type to the route: wide-bodies
(a350) for long-haul, narrow-bodies (a220/b737/e190) for shorter legs. Turbofans need a
valid `engine.type: "turbofan"` + `count` and a `thrustProfiles` block — `npm test`
lints this (`tests/aircraft-data.test.mjs`).

---

## 6. Testing a mission

```bash
# Load it headless and check the start state is sane:
#   http://localhost:8080/?mission=<id>&test=1   (window.simGetState / simStep)
npx playwright test tests/physics.test.js        # regime smoke tests
npm test                                         # full suite (node + playwright)
```

Or open `?mission=<id>` in the browser and fly it.
