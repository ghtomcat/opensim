# Creating Missions

A mission is a scenario: an aircraft, a place, a phase of flight, and the crew/ATC
script around it. This guide covers the mission file, how the route/briefing are
derived from the departure + arrival airports, and how to add a **new airport or city
pair** so its runways, procedures, airways and ground layout are bundled (§4).

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
  "course": 310,                    // optional: the course to fly (°) — set on the F4U's remote compass
                                    //   (the course setter); absent → the start heading
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

This single route, held in flight as `S.flightPlan` by `core/flightplan.js`, feeds the **briefing nav-log**, the **ND** (magenta/green track), the
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

## 4. Adding a new airport or city pair

The bundled data is sliced to the airports and city pairs that `missions/*.json` name in
`departure` / `arrival`. A mission with a new airport, or two known airports in a new
pairing, needs the builders re-run. Write the mission file first (with both ICAO codes),
then run them **in this order**: most read `data/runways-data.js` for the airport
centres, so the runways come first.

```bash
# 1. Runways + airport tiers — everything below reads this
python3 scripts/build-runways.py      # → data/runways-data.js      OurAirports, public domain

# 2. Procedures and airways — the route (§3)
python3 scripts/build-cifp.py         # → data/procedures-data-xp.js  X-Plane CIFP, PROPRIETARY, gitignored
python3 scripts/build-airways.py      # → data/airways-data.js        X-Plane nav 2012.08, GPL v3

# 3. Radio: navaids, frequencies, the ND's VORs
python3 scripts/build-navdata.py      # → data/navdata.js             OurAirports
python3 scripts/build-navaids.py      # → data/navaids-data.js        OurAirports

# 4. The airport on the ground — OpenStreetMap via Overpass (ODbL)
python3 scripts/build-taxi.py         # → data/taxi-data.js           taxiways, stand lead-in lines
python3 scripts/build-stands.py       # → data/stands-data.js         named stands ("start": {"stand": "B7"})
python3 scripts/build-terminals.py    # → data/terminals-data.js      terminal footprints, aprons
python3 scripts/build-satellites.py   # → data/satellites-data.js     round satellite terminals
python3 scripts/build-towers.py       # → data/towers-data.js         control tower
```

| Builder | Needed when | Source on disk / network |
|---|---|---|
| `build-runways.py` | a new airport | downloads OurAirports CSVs (cached in `scripts/ourairports/`) |
| `build-cifp.py` | a new airport | a local X-Plane 11/12 install (`--xplane <path>`) |
| `build-airways.py` | a new **city pair** — also two known airports paired anew | `scripts/xplane-nav/earth_awy.dat` (in the repo) |
| `build-navdata.py`, `build-navaids.py` | a new airport | OurAirports |
| `build-taxi.py`, `build-stands.py`, `build-terminals.py`, `build-satellites.py`, `build-towers.py` | a new airport the aircraft is on the ground at | Overpass (flaky — re-run on a timeout; taxi, stands and terminals take ICAO arguments to fetch only the new airport, e.g. `build-taxi.py FIMP`) |

**The airways are per city pair.** `build-airways.py` keeps only the airways near each
pair's great circle (±110 nm), widened in 50 nm steps until they connect the two airports;
it prints each widened pair, and `NOT connected` if even ±600 nm doesn't (the route then
flies direct). Forgetting it doesn't fail loudly in the sim: the route snaps to whatever
airway is nearest and detours — `fimp-takeoff` once flew Mauritius → Zürich via Sumatra
(9,217 nm). `tests/airways.test.mjs` catches it, and `core/route.js` warns in the console
(`[route] … rebuild data/airways-data.js`).

**By hand, where the open data has gaps:**
- **Tower:** OSM sometimes tags none, or the wrong one — add an entry with `"manual": true`
  to `data/towers-data.js` (FIMP, KBZN); the builder keeps it.
- **Windsock:** where OSM has none, `data/windsocks-data.js` (hand-maintained).
- **Stands:** a `start.stand` must exist in `data/stands-data.js` — check the ref there
  after `build-stands.py`; OSM's naming varies by airport.

**Licensing:** OurAirports (public domain), OSM (ODbL) and the X-Plane nav airways (GPL v3)
are committable. `data/procedures-data-xp.js` is Navigraph/Jeppesen via X-Plane —
**proprietary, gitignored, never redistributed.** The scripts contain no data and are
fine to commit.

**Check it:**

```bash
node --test tests/airways.test.mjs tests/data-schema.test.mjs   # every pair has an airway path; the schema
```

and the route, with the procedures loaded:

```bash
node --input-type=module -e "
  const { getProcedures } = await import('./core/route.js');
  const t0 = Date.now(); while (!getProcedures().FIMP && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 25));
  const { planFor } = await import('./core/flightplan.js');
  const r = planFor({ icao: 'FIMP', runway: '14' }, { icao: 'LSZH', runway: '28' });
  console.log(r.legs.length, 'legs', Math.round(r.distNm), 'nm', 'SID', r.sid?.name, 'STAR', r.star?.name, 'APPR', r.appr);
"
```

The distance should be near the great circle (a few per cent over for a long-haul, more
for a short hop with procedures at both ends). Then open `?briefing=<id>`: the Route tab
draws the line on the map, and the Departure block shows the takeoff plan (lineup, runway
ahead, speeds) — a lineup that reads "Full length" where the aircraft starts at a stand far
from the threshold means the taxi data is missing.

---

## 5. Aircraft

`"aircraft"` is an `aircraft/<id>.json` id. Match the type to the route: wide-bodies
(a350) for long-haul, narrow-bodies (a220/b737/e190) for shorter legs. Turbofans need a
valid `engine.type: "turbofan"` + `count` and a `thrustProfiles` block — the aircraft
schema checks this (§7).

---

## 6. Testing a mission

```bash
# Load it headless and check the start state is sane:
#   http://localhost:8080/?mission=<id>&test=1   (window.simGetState / simStep)
npx playwright test tests/physics.test.js        # regime smoke tests
npm test                                         # full suite (node + playwright)
```

Or open `?mission=<id>` in the browser and fly it.

---

## 7. The schema

Every mission, catalog entry and aircraft is checked against a schema in `core/schema/`
(`mission.js`, `catalog.js`, `aircraft.js`):

- **by `npm test`** — `tests/data-schema.test.mjs` validates every file;
- **at load** — players get a console warning (`[data] missions/<id>.json doesn't match
  its schema: …`); in test mode (`?test=1`) the load fails.

An **unknown key** fails, and so does an **unknown name** in an enum-like field: trigger
type, rocket event, failure type, engine sound, panel, vehicle type, comm profile. The
names live in `core/vocab.js` — the same lists the code checks itself against, so the
data can't use a name the code doesn't know.

**Adding a field.** Put it in the schema where it belongs:

| The field is … | Schema option | Example |
|---|---|---|
| read by the sim | `fields` (with its type) | `approachBriefAlt: num` |
| for people only | `doc` | `narrative`, `fiction_note`, `book` |
| data for a feature not built yet | `planned` | `landSurfaces`, `gearRuggedness` |

A **new name** (a trigger type, a comm profile, …) goes into `core/vocab.js`, and the code
that handles it into the matching table — the table checks on load that it covers every
name in the vocabulary.

**Comments.** Keys starting with `_` (`_note`, `_doc`, `_status`) are allowed anywhere and
never read — JSON has no other comment syntax.

**The catalog card holds labels, the mission file the facts.** `title`, `acName`,
`location` and `engine` on the card may differ from the mission (a short card title);
`aircraft` must match.

**Known violations.** A problem that's logged in `docs/issues.md` but not fixed yet goes
on `core/schema/known.js`, so it passes. The test fails once it no longer occurs —
remove it there and close the issue.

