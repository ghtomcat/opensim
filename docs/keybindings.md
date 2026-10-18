# OpenSim Keybindings

## Universal

| Key | Action |
|-----|--------|
| `Escape` | Back to mission selector |
| `P` | Pause / resume |
| `X` | Audio on / off (aircraft without an engine start lifecycle — on cold-start aircraft the sound follows the engine) |
| `V` | Cycle view: instruments → combined → outside (rockets in orbit: 5 views) |
| `C` | Cycle outside camera (see [Cameras](#cameras)) |
| `Tab` | Cycle display mode (PFD → ND → ECAM) |
| `K` | Kneeboard (briefings, checklists, scratchpad) |
| `N` | Mini-map (heading, track, wind) |
| `Space` | PTT — push to talk |
| `Ctrl+Shift+L` | Download flight telemetry (JSONL; CSV on rockets) |
| `Ctrl+Shift+B` | Download the black box |

---

## Flight controls

| Key | In flight | On the ground |
|-----|-----------|---------------|
| `↑` | Pitch up | Pitch up (rotate at Vr) |
| `↓` | Pitch down | Pitch down |
| `←` | Roll left (wings spring back to level when released) | Nosewheel steering left |
| `→` | Roll right | Nosewheel steering right |
| `t` | Trim nose up | Trim nose up |
| `T` | Trim nose down | Trim nose down |
| `B` (hold) | Brakes | Brakes |

**With the autopilot engaged the arrow keys do nothing** — the autopilot flies pitch and roll. Disconnect it first (airliners: click **AP1** on the FCU), or change its targets on the FCU knobs.

Manual braking disarms the autobrake.

---

## Engine and systems

| Key | Action |
|-----|--------|
| `+` / `=` | Throttle up — thrust lever +10% on turbofans; +5 kt (or +20 kt on manual-control aircraft) otherwise |
| `-` / `_` | Throttle down — same steps |
| `F1`–`F4` | Thrust detents (aircraft-specific profiles) |
| `f` | Flaps extend one stage |
| `F` | Flaps retract one stage |
| `g` | Gear toggle (retractable gear only; squat switch — no gear-up on the ground) |
| `s` | Speed brake: RET → ARM → FULL → RET. Armed spoilers deploy on touchdown and stow when you advance the thrust lever (ground: toward CLB · air: TOGA) |
| `E` | Engine start (cold-start aircraft — not the airliners: start them on the pedestal) |
| `Q` | Engine cutoff (V12, radial, turbofan, VK-1) · fuel selector cycle (other manual aircraft with a fuel system) |
| `H` | Carburettor heat toggle (aircraft with carb heat) |
| `1`–`5` | Situation presets (disabled during active missions) |

---

## Cockpit views

Each aircraft JSON lists the zones it has in a `views` array. A key only works if the aircraft has that zone; press it again to return to the forward view.

| Key | View | Who has it |
|-----|------|------------|
| `O` | Overhead panel | Airliners |
| `L` | Left console | Airliners, fighters (Bf 109, F4U, MiG-15) |
| `M` | Centre panel — ECAM screens, landing gear, AUTO BRK | Airliners |
| `R` | Right console | Airliners, fighters |
| `D` | Pedestal | Airliners, light aircraft (C172, DR400, Velis) |

On aircraft without a right console, `R` cycles the crew role instead: PF → PM → INSTRUCTOR.

Autobrake (LO / MED / MAX) and the overhead system switches are clickable pushbuttons. On the C172, click any switch in the left panel; click the COM1 frequency in the PFD top bar to show or hide the COM panel. `Z` (or the ⇄ button) swaps COM active ↔ standby on any aircraft with the COM panel.

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

## Aircraft-specific

### Bf 109 E-4 / DB 601 (v12-supercharged)

| Key | Action |
|-----|--------|
| `E` | Anlasser — start engine (cold or warm lifecycle) |
| `Q` | Kraftstoffhahn zu — cut fuel, shut down engine |

The V12 startup lifecycle takes ~71 seconds cold, ~55 seconds warm, ~12 seconds hot.
Engine state: `off → starting → idle → running → shutdown → off`

### F4U-1A Corsair / R-2800 Double Wasp (radial-2000hp)

| Key | Action |
|-----|--------|
| `E` | Start engine — inertial starter + runup lifecycle |
| `Q` | Cut off — shut down engine |

The R-2800 startup takes ~64 seconds cold, ~50 seconds warm, ~38 seconds hot.
Individual cylinders engage one by one (15–120 RPM) — distinct "brabbel" puffs before all 18 are online.
Engine state: `off → starting → running → shutdown → off`

### Turbofans (A220, A340, A350, 737, 737 MAX 9, 777, E190)

| Key | Action |
|-----|--------|
| `Q` | Fuel cutoff |

No start key: the start is on the pedestal (`D`) — power on (APU or external), ENG MODE to
IGN/START, then the ENG MASTER switches. A start from the keyboard would have to check the whole
aircraft first (power, mode, fuel).

### Saturn V (missions with a lunar module)

| Key | Action |
|-----|--------|
| `L` | Toggle CM ↔ LM panel (after S-IVB separation) |

### Time warp — rockets and every aircraft with an instrument panel

| Key | Action |
|-----|--------|
| `w` | Step up: 1× → 2× → 5× → 10× → 100× → next mission event |
| `W` | Step back (from next-event mode, drops to 100×) |
| `J` | Jump: warp straight to the next mission event (press again to cancel) |

Next-event warp stops 60 seconds before the event.

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

---

## Notes

- `Space` (PTT) triggers the currently active voice role (PF, PM, or INSTRUCTOR).
- Situation presets (`1`–`5`) are locked during active missions to prevent jumping out of the scenario.
- `F1`–`F4` map to aircraft thrust profiles (e.g. IDLE / CRUISE / COMBAT / EMERGENCY on the F4U-1A).
