# Testing

Two runners, no build step:

| Runner | Files | Count | Time | What |
|--------|-------|-------|------|------|
| **Node** (`node --test`) | `tests/*.test.mjs` | 113 | < 1 s | Data schema (every mission, catalog entry, aircraft), shared vocabulary, DB 601 synthesis, FMA, managed speed, route building, thrust, VNAV |
| **Playwright** (headless Chromium) | `tests/*.spec.js`, `tests/*.test.js` | 165 in 13 files | ~6 min (4 workers) | The real sim in a browser page: physics, fuel/engine/carb, sound state machines, COM, rockets, orbits, outside profiles |

---

## Setup (once)

```bash
npm install
npx playwright install chromium
```

Playwright starts its own `python3 -m http.server 8080` and reuses one that's already running.

---

## Running

```bash
npm test                                        # everything: Node first, then Playwright
node --test tests/*.test.mjs                    # Node unit tests only
npx playwright test tests/physics.spec.js       # one file
npx playwright test -g "rotates"                # tests whose name matches
npx playwright test tests/rocket.spec.js --workers=4
```

**Airplane tests only** (no rockets, ~4 min):

```bash
npx playwright test tests/physics.spec.js tests/physics.test.js tests/fuel-engine-carb.spec.js \
  tests/db601-sound.spec.js tests/com.spec.js tests/outside-profiles.spec.js --workers=4
```

The full Playwright run takes longer than a 10-minute tool timeout — run it in the background or split it.

### Calibration specs

`tests/calibrate_*.spec.js` are not tests — they **tune data**: `calibrate_ift12` rewrites `aircraft/starship.json` and `missions/ift-12.json`. They are excluded from the default run (`playwright.config.js` → `testIgnore`) and run only on purpose:

```bash
npm run calibrate          # CALIBRATE=1 playwright test calibrate_
```

Review the JSON diff afterwards before committing it.

`check_*.spec.js` and `debug_*.spec.js` are trajectory diagnostics (they log numbers); they run in the default suite.

---

## Output

| Where | What |
|-------|------|
| Terminal (default `list` reporter) | ✓ / ✘ per test, then each failure with expected vs received and the source line |
| `--reporter=line` | Compact, one line of progress |
| `--reporter=json` + `PLAYWRIGHT_JSON_OUTPUT_NAME=file.json` | Machine-readable — best for a failure table across many files |
| `test-results/<test>/error-context.md` | Page snapshot of a failed test |
| `test-results/.last-run.json` | Pass/fail of the last run (git-ignored, like all of `test-results/`) |

Playwright imports the Node `*.test.mjs` files too, so their `✔` lines appear at the top of a Playwright log. They are not counted in the Playwright total.

Turning a JSON report into a failure table:

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/run.json npx playwright test --reporter=json > /dev/null
python3 -c "
import json
def walk(s, f):
    for sp in s.get('specs', []):
        for t in sp['tests']:
            r = t['results'][-1]
            if r['status'] != 'passed':
                print(r['status'], f, sp['line'], sp['title'])
    for c in s.get('suites', []): walk(c, f)
for s in json.load(open('/tmp/run.json'))['suites']: walk(s, s['title'])
"
```

---

## Test mode — `?test=1`

Load a mission with `/?mission=<id>&test=1` and wait for `window.simReady === true`. Test mode:

- **skips the key overview overlay and its pause** — a paused sim never ticks
- **never fetches live weather** — missions with `weather.source: "live"` fly their recorded `fallback` METAR, the same on every run
- **`simStep` is the only clock** — the page keeps rendering, but the game loop never advances the sim on its own; waiting between calls changes nothing
- **seeds turbulence** on every mission load — the same random sequence every run
- **doesn't record** — telemetry and the black box aren't started (they grow with sim time)
- **checks data strictly** — a mission or aircraft that doesn't match its schema (`core/schema/`) fails the load instead of only warning
- exposes the test API on `window`

Together: the same test gives the same numbers on every run, to the last digit.

| Function | What |
|----------|------|
| `simStep(n = 1, dt = 1/60)` | Advance `n` steps of `dt` seconds, synchronously — the game's own step (`tickSim`) |
| `simGetState()` | Shallow copy of the whole state `S` |
| `simSetState(patch)` | Merge a patch into `S` |
| `simLoad(missionId, setup)` | Load another mission (returns a promise); `setup` = the scenario choices `{ weather, failures, crew }` as the setup screen passes them (`loadMission()` in `core/mission.js`) |
| `simGetRpm()` · `simEngineState()` | Engine RPM string · engine state |

To try something without writing a test, `tools/probe.mjs` loads a mission in test mode and prints what a snippet returns — see [issues.md → Reproducing](issues.md#reproducing).

`simStep` calls `tickSim(dt)` from `core/loop.js` — the same step the game loop runs each frame: control easing, failures, fuel, battery, electrical, hydraulics, vehicle physics, crew, warp target. Keyboard input is the only part outside it; tests set state directly or press real keys.

---

## Writing tests

**Missions start the way a pilot finds the aircraft.** Prepare it like a pilot would:

- Ground starts are **parked**: parking brake set. Cold-start aircraft (C172, DR400, Velis, warbirds, the modern airliners) have the **engine off**; the An-225 and Tu-95 start with engines running. Release the brake and start the engine before a takeoff — see `readyForTakeoff()` in `tests/physics.spec.js`.
- Story missions may start **airborne** (Wolfskopf: 2 000 ft, engine running). Use a ground mission when the test is about the engine start.
- Approach missions start on the autopilot. With the AP engaged, `pitchT` / `rollT` have no effect.

**Weather is fixed.** Tests never use live METAR — today's weather would make a test pass or fail by the day. Live-weather missions use their `fallback` block; a test that needs specific weather (crosswind, low QNH) sets it explicitly.

**Set up physically meaningful states.**

- The flight model uses **pitch attitude as angle of attack**. A nose-down attitude at low speed means negative lift, not a gentle glide.
- A touchdown has a **sink rate**. The ground latch only holds when the aircraft is descending (`vs < -50`); a test that sets `wow: true` with no sink rate sees the aircraft fly away.
- A fuel cut is not instant: the engine runs on line fuel for **4 s** (`STARVE_RUNDOWN_S` in `core/fuel.js`).
- **Turbulence is on.** A mission's `turbulence` adds random vertical buffeting every frame. It's seeded in test mode, so a run repeats — but a test that passes only for this one gust sequence is fragile. Test landing mechanics in still air — `calmAir()` in `tests/physics.spec.js`.
- **Land like a pilot.** An engine-out glide sinks 1 000–1 700 fpm; held to the ground it is a hard landing (limit −800 fpm). Flare: raise the nose near the ground — `glideAndFlare()` glides at a nose-up attitude and flares at 50 ft.

**Step size matters.** Aircraft run at `dt = 1/60`. Rocket specs step at `dt = 1.0` for speed — coarse steps change the ascent, so compare against a fine-step run before trusting a rocket result. Rockets go through the fixed-step accumulator like in time warp: any `dt` ≥ 1 s is split into 1 s steps (`dt = 10` → ten steps).

**Keep loops cheap.** The default timeout is 30 s. A loop of `page.evaluate(() => simStep(1))` per frame costs a round trip each time; for long runs, step inside one `evaluate` and return what you need.

**Keys are real keys.** `page.keyboard.press('h')` goes through the same handlers as a player — check [keybindings.md](keybindings.md) when a test presses a key.

**Data files have a schema.** `tests/data-schema.test.mjs` checks every mission, catalog entry and aircraft against `core/schema/`; an unknown key or name fails. A new field needs a schema entry — see [creating-missions.md → The schema](creating-missions.md#7-the-schema). A violation that's logged in `issues.md` but not fixed yet goes on `core/schema/known.js`; the test fails when it no longer occurs, so the list stays current.

**One file per area, one test per behaviour.** Add a test when you add an aircraft (`tests/physics.spec.js`). Name the test after the behaviour: *"rotates between 50–75 kt"*.

---

## Known failures

Open as of 2026-10-12 — remove a line when its group is fixed. Failing values are deterministic: two runs give the same numbers. Causes and planned fixes: [issues.md](issues.md).

| Group | File | Tests | Why |
|-------|------|-------|-----|
| DB 601 engine-off start | `db601-sound.spec.js` | 2 | Uses Wolfskopf, which starts airborne with the engine running |
| Temporary EGLL mission | `physics.test.js` | 2 | `egll-approach` is temporarily the 737 MAX 9 into Madrid |
| Rocket coarse steps | `rocket.spec.js`, `check_alt.spec.js` | 8 | Ascent breaks at `dt = 1.0` (also affects time warp ≥ 100×); Demo-2 timings predate its 178 s countdown; Inspiration5 inserts at ~283 × 897 km instead of 590 km circular |
