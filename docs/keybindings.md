# OpenSim Keybindings

## Universal

| Key | Action |
|-----|--------|
| `Escape` | Back to mission selector |
| `P` | Pause / resume |
| `M` | Audio on / off (non-V12 engines) |
| `V` | Cycle view: instruments → combined → outside |
| `Tab` | Cycle display mode (PFD → ND → ECAM) |
| `K` | Kneeboard (checklists + briefings) |
| `N` | Mini-map (heading, track, wind) |
| `Space` | PTT — push to talk |
| `R` | Cycle role: PF → PM → INSTRUCTOR |
| `Ctrl+Shift+T` | Download flight telemetry (JSONL) |

---

## Flight controls

| Key | Autopilot OFF (manual) | Autopilot ON |
|-----|------------------------|--------------|
| `↑` | Pitch up | Altitude target +500 ft |
| `↓` | Pitch down | Altitude target −500 ft |
| `←` | Roll left | Heading target −5° |
| `→` | Roll right | Heading target +5° |
| `t` | Trim nose up | Trim nose up |
| `T` | Trim nose down | Trim nose down |
| `B` (hold) | Brakes | Brakes |

---

## Engine and systems

| Key | Action |
|-----|--------|
| `+` / `=` | Throttle +5 kt (or +20 kt on manual-control aircraft) |
| `-` / `_` | Throttle −5 kt (or −20 kt on manual-control aircraft) |
| `f` | Flaps extend one stage |
| `F` | Flaps retract one stage |
| `g` | Gear toggle (if retractable) |
| `F1`–`F4` | Thrust detents (aircraft-specific profiles) |
| `1`–`5` | Situation presets (disabled during active missions) |

---

## Aircraft-specific

### Bf 109 G-4 / DB 605 (v12-supercharged)

| Key | Action |
|-----|--------|
| `E` | Anlasser — start engine (cold or warm lifecycle) |
| `Q` | Kraftstoffhahn zu — cut fuel, shut down engine |
| `M` | Toggle audio (replaces standard audio toggle) |

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

### Rocket missions (Falcon 1, Falcon 9)

| Key | Action |
|-----|--------|
| `W` | Time warp: 1× → 10× → 100× → 1000× |

Time warp is rocket-only. A 3-day Inspiration5 orbit takes ~4 minutes at 1000×.

---

## Gamepad — Logitech Extreme 3D Pro

| Axis / Button | Action |
|---------------|--------|
| Axis 0 (stick X) | Roll |
| Axis 1 (stick Y) | Pitch |
| Axis 2 (twist) | Rudder |
| Axis 5 (throttle) | Throttle |
| Button 1 | Flaps |
| Button 2 | Gear |
| Trigger | PTT |

---

## Notes

- Arrow keys control attitude in manual mode, targets in autopilot mode.
- `Space` (PTT) triggers the currently active voice role (PF, PM, or INSTRUCTOR).
- Situation presets (`1`–`5`) are locked during active missions to prevent jumping out of the scenario.
- `F1`–`F4` map to aircraft thrust profiles (e.g. IDLE / CRUISE / COMBAT / EMERGENCY on the F4U-1A).
