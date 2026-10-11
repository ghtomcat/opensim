# OpenSim Quickstart

Your first ten minutes. No install, no account — a browser and a keyboard.

---

## 1. Start it

```bash
python3 -m http.server 8080
open http://localhost:8080
```

Any static web server works. Click once anywhere on the page so the browser allows sound.

---

## 2. What you will see

Starting a mission walks you through a few screens. Each one waits for you.

| Screen | What to do |
|--------|------------|
| **Mission selector** | Three tabs: **Fly** (aircraft), **Orbit** (rockets), **Lab** (robots and hovercraft). Click a card. |
| **Briefing** | The mission orders and the story. Read it, then click anywhere. |
| **Scenario setup** | Pick **Weather** (Live METAR or a preset), **Crew** (your role), **Failures** (start with *No failure*). Click **Fly**. Story missions and rocket launches skip this screen. |
| **Flight briefing** | Airliners only: route, airport, departure, arrival, nav log, weather, frequencies. Click **Fly →**. |
| **Key overview** | The most important keys for this aircraft. Press any key or click to begin. |
| **Flying** | You're in. |
| **Debrief** | After landing (or crashing): alignment, speed and touchdown point — and, if a failure hit you, how you handled it. |

`Esc` takes you back to the mission selector at any time.

---

## 3. First flight — sit back and watch

**Fly tab → Airbus A350-900 · ILS Approach · RWY 28** (Zürich).

You start on the approach at about 4 000 ft, gear down, autopilot and autothrust on. The aircraft captures the ILS and flies the approach down to the flare on its own. Your job for now is to look around:

| Key | Try it |
|-----|--------|
| `v` | Instruments → instruments + outside → outside only |
| `c` | Outside camera: cockpit → chase → side → wing |
| `k` | Kneeboard — the approach plate, briefing and checklists |
| `o` `l` `m` `r` `d` | Cockpit views: overhead, left, centre, right, pedestal (press again to return) |
| `p` | Pause — in chase or side cam, drag with the mouse to orbit around the aircraft |

**Take over:** click **AP1** on the glareshield (FCU) to disconnect the autopilot. Now the arrow keys fly the aircraft directly — `↑` `↓` pitch, `←` `→` roll. Click **AP1** again to give it back.

---

## 4. Second flight — your own takeoff

**Fly tab → Cessna 172S · VFR Pattern** (Speck-Fehraltorf LSZF, grass strip).

The aircraft is cold and dark, parking brake set. Bring it to life on the switch panel on the left of the screen — click each switch:

1. **MASTER BAT** → ON
2. **AVIONICS** → ON — both screens come alive
3. **FUEL PUMP** → ON — you'll hear it
4. **MAGNETO** → click through OFF → R → L → BOTH → **START** — the starter whirrs, the engine catches
5. **FUEL PUMP** → OFF once the engine runs

Then take off:

1. Press `d` for the pedestal and set the **PARK BRK** to OFF. Press `d` again.
2. Press `+` several times — full throttle.
3. Watch the airspeed. At **55 kt**, hold `↑` gently to lift the nose.
4. Climb at about 75 kt. `t` / `T` trims the nose up / down so you don't have to hold the arrow key.

Fly a circuit, line up, pull the power back with `−`, extend flaps with `f`, and land. The debrief tells you how it went.

---

## 5. Where to go next

- **Orbit tab → Crew Dragon Demo-2.** The launch runs on its own. Press `c` for the plume and booster cams, `w` to speed up time, `j` to jump to the next event.
- **Warbirds** — Bf 109, F4U Corsair, MiG-15. Press `E` to start the engine and wait: the DB 601 takes over a minute from cold.
- **Live Flight** — at the bottom of the selector: type a flight number (`LX038`) or registration, or press **Near me** to see real traffic on the radar and click one to fly it.
- **Training** — in the scenario setup, choose a failure (*Partial*, *Rough*, *Full failure*). It comes when it comes. See the *Training* section in the [README](../README.md#training).

---

## Lost?

| Problem | Do this |
|---------|---------|
| No sound | Click the page once; press `x` to toggle audio. On cold-start aircraft the sound follows the engine — start it. |
| Aircraft won't roll | Parking brake — `d` for the pedestal (or `l` on fighters), set it OFF. |
| Don't know what to do | `k` — the kneeboard has the briefing and the checklists. |
| Need a moment | `p` pauses. |
| Want out | `Esc` — back to the mission selector. |

All keys: [keybindings.md](keybindings.md).
