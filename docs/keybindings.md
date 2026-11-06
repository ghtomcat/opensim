# OpenSim Keybindings

The tables below are generated from the key map (`core/keymap.js`): edit the table there, then run
`node tools/keybindings.mjs`. `tests/keymap.test.mjs` fails when they differ.

<!-- keymap:start -->

### Flight controls

| Key | Action | On |
|-----|--------|----|
| `Mouse (hold) / ↑ ↓ ← →` | Stick (wings level when released) · on the ground ← → steer | a220, a340, a350, an225, avro504, b737, b737max9, b777-300er, bf109, c172, e190, f4u1a, mig15, robin-dr400, tu95ms, velis-hb-syc |
| `↑ ↓` | Altitude target ±500 ft | dc8 |
| `← →` | Heading target ±5° | dc8 |
| `, . (hold)` | Rudder left / right (springs back) · steers on the ground | a220, a340, a350, an225, avro504, b737, b737max9, b777-300er, bf109, c172, e190, f4u1a, mig15, robin-dr400, tu95ms, velis-hb-syc |
| `< >` | Rudder trim left / right | a220, a340, a350, an225, avro504, b737, b737max9, b777-300er, bf109, c172, e190, f4u1a, mig15, robin-dr400, tu95ms, velis-hb-syc |
| `t` | Pitch trim nose up | every aircraft |
| `T` | Pitch trim nose down | every aircraft |
| `B (hold)` | Brakes (disarm the autobrake) | every aircraft |

### Engine and systems

| Key | Action | On |
|-----|--------|----|
| `+ −` | Thrust lever ±10 % · Throttle ± · Speed target ±5 kt | every aircraft |
| `F1–F4` | Thrust detents: the aircraft's `thrustProfiles` | every aircraft |
| `f` | Flaps: extend one stage | every aircraft |
| `F` | Flaps: retract one stage | every aircraft |
| `G` | Gear up / down (not on the ground) | a220, a340, a350, an225, b737, b737max9, b777-300er, bf109, dc8, e190, f4u1a, mig15, tu95ms |
| `S` | Speed brake: RET → ARM → FULL | a220, a340, a350, b737, b737max9, b777-300er, e190 |
| `D` | Engine start on the pedestal: power, ENG MODE IGN/START, ENG MASTERs | a220, a340, a350, b737, b737max9, b777-300er, e190 |
| `Panel` | Motor on: MASTER → BATT EN → PWR EN | velis-hb-syc |
| `E` | Engine start · Engine start (battery on first) | bf109, c172, dc8, f4u1a, mig15, robin-dr400 |
| `Q` | Fuel cutoff, all engines · Engine cutoff | a220, a340, a350, b737, b737max9, b777-300er, bf109, dc8, e190, f4u1a, mig15 |
| `Q` | Fuel selector: BOTH → LEFT → RIGHT → OFF | c172, robin-dr400 |
| `H` | Carburettor heat | c172, robin-dr400 |
| `1–5` | Situation presets (no mission loaded) | a220, a340, a350, an225, avro504, b737, b737max9, b777-300er, bf109, c172, e190, f4u1a, mig15, robin-dr400, tu95ms, velis-hb-syc |

### Views and screens

| Key | Action | On |
|-----|--------|----|
| `Tab` | Right screen: ND, then the ECAM pages (Shift+Tab: left screen; centre view: ELEC → HYD → FUEL) | a220, a340, a350, b737, b737max9, b777-300er, e190 |
| `V` | View: instruments → combined → outside | every vehicle |
| `C` | Outside camera | every vehicle |
| `0` | While paused: reset the outside camera | every vehicle |
| `O` | Overhead panel | a220, a340, a350, an225, b737, b737max9, b777-300er, dc8, e190, tu95ms |
| `D` | Pedestal | a220, a340, a350, an225, b737, b737max9, b777-300er, c172, dc8, e190, robin-dr400, tu95ms, velis-hb-syc |
| `M` | Centre panel | a220, a340, a350, an225, b737, b737max9, b777-300er, dc8, e190, tu95ms |
| `L` | Left console | a220, a340, a350, an225, b737, b737max9, b777-300er, bf109, dc8, e190, f4u1a, mig15, tu95ms |
| `L` | CM ↔ LM panel (after S-IVB separation) | saturn-v |
| `R` | Right console | a220, a340, a350, an225, b737, b737max9, b777-300er, bf109, dc8, e190, f4u1a, mig15, tu95ms |
| `R` | Role: PF → PM → INSTRUCTOR | avro504, c172, falcon1, falcon9-b1, falcon9-b5-590, falcon9-b5-demo2, falcon9-b5, robin-dr400, saturn-v, so101, starship, velis-hb-syc, yertle |
| `K` | Kneeboard (briefings, checklists, scratchpad) | every vehicle |
| `N` | Map | a220, a340, a350, an225, avro504, b737, b737max9, b777-300er, bf109, dc8, e190, f4u1a, falcon1, falcon9-b1, falcon9-b5-590, falcon9-b5-demo2, falcon9-b5, mig15, robin-dr400, saturn-v, starship, tu95ms |

### The sim

| Key | Action | On |
|-----|--------|----|
| `?` | This key map (also the KEYS button under the clock) | every vehicle |
| `P` | Pause / resume | every vehicle |
| `X` | Audio on / off | every vehicle |
| `Space` | PTT: push to talk | every vehicle |
| `Z` | COM: swap active ↔ standby | every aircraft |
| `w` | Time warp: 1× → 2× → 5× → 10× → 100× → next event | rockets |
| `W` | Time warp: step back | rockets |
| `J` | Time warp: jump to 60 s before the next event (again: cancel) | rockets |
| `Esc` | Back to the mission selector | every vehicle |
| `Ctrl+Shift+L` | Download the flight telemetry (JSONL; CSV on rockets) | every vehicle |
| `Ctrl+Shift+B` | Download the black box | every vehicle |

### Robot arm (SO-101)

| Key | Action | On |
|-----|--------|----|
| `[ ]` | Select a joint or part | so101 |
| `1–6` | Jump to joint J1–J6 | so101 |
| `X Y Z` | Edit axis | so101 |
| `L` | Log the mesh transforms to the console | so101 |
| `C` | Cartesian jog mode on / off | so101 |
| `W S A D R F` | Cartesian jog (in jog mode) | so101 |
| `H` | Home position | so101 |
| `Space` | Gripper open / close | so101 |
| `↑ ↓ ← →` | Move the selected joint or part (Shift: bigger steps); in jog mode ↑ ↓ set the step | so101 |

### Robot dog (Yertle)

| Key | Action | On |
|-----|--------|----|
| `[ ]` | Select a joint | yertle |
| `1–9 0 - =` | Jump to a joint | yertle |
| `← →` | Move the selected joint (Shift: bigger steps) | yertle |
| `H` | Home position | yertle |
| `L` | Log the mesh transforms to the console | yertle |

<!-- keymap:end -->

---

## Notes on the controls

**With the autopilot engaged the arrow keys do nothing** — the autopilot flies pitch and roll. Disconnect it first (airliners: click **AP1** on the FCU), or change its targets on the FCU knobs.

The rudder yaws the aircraft only where its vertical tail is measured (today the 777 — `core/yaw.js`); there it holds an engine failure, in the air and on the takeoff roll. On every other aircraft the rudder steers on the ground and does nothing in the air yet. A gamepad's twist axis is the rudder too.

Armed spoilers (`S`) deploy on touchdown and stow when you advance the thrust lever (ground: toward CLB · air: TOGA). Autobrake (LO / MED / MAX) and the overhead system switches are clickable pushbuttons. On the C172, click any switch in the left panel; click the COM1 frequency in the PFD top bar to show or hide the COM panel.

Airliners have no start key: a start from the keyboard would have to check the whole aircraft first (power, mode, fuel). The start is on the pedestal: power on (APU or external), ENG MODE to IGN/START, then the ENG MASTER switches.

Next-event time warp stops 60 seconds before the event. `F1`–`F4` map to the aircraft's thrust profiles. Situation presets (`1`–`5`) are locked during active missions to prevent jumping out of the scenario. `Space` (PTT) triggers the currently active voice role (PF, PM, or INSTRUCTOR).

The key map opens with `?` or the **KEYS** button under the mission clock, on every vehicle and device (a touchscreen taps the button); the sim waits while it is up. While it is on screen, any key closes it and does nothing else. In a text field the keys belong to the field, except `Esc`.

---

## Cameras

`C` cycles the outside camera:

| Mode | Camera | Notes |
|------|--------|-------|
| 0 | Cockpit forward | |
| 1 | Chase | Right-drag pans the camera sideways |
| 2 | Side | |
| 3 | Wing view | Aircraft only |
| 4 | Plume cam | Rockets only |
| 5 | Booster cam (Falcon 9) · body cam (Starship) | Not on the Saturn V |
| 6 | Ship cam | Starship reentry, or a droneship (ASDS) booster recovery |

In chase, side, booster and ship cam: **left-drag** orbits, **wheel / trackpad** zooms. While paused, `0` resets orbit and zoom.

---

## Engine start times

- **Bf 109 E-4 / DB 601:** ~71 seconds cold, ~55 seconds warm, ~12 seconds hot.
- **F4U-1A / R-2800:** ~64 seconds cold, ~50 seconds warm, ~38 seconds hot. Individual cylinders engage one by one (15–120 RPM) — distinct "brabbel" puffs before all 18 are online.

---

## Gamepad — Logitech Extreme 3D Pro

| Axis / Button | Action |
|---------------|--------|
| Axis 0 (stick X) | Roll |
| Axis 1 (stick Y) | Pitch |
| Axis 2 (twist) | Rudder |
| Axis 5 (throttle) | Throttle |
| Button 0 (trigger) | PTT |
| Button 1 | Flaps |
| Button 2 | Gear |
