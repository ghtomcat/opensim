# DB 601 Engine Sound Synthesis

**Aircraft:** Messerschmitt Bf 109 E-4 · D-FEML · Werknummer 1983
**Engine:** Daimler-Benz DB 601 A — 33.9 L inverted V12, 960 PS at takeoff
**Implementation:** `core/sound.js` + `core/db605-processor.js`

---

## Overview

The DB 601 sound is fully synthesized — no audio samples. Every sound event
from cold iron to full song is generated in real time from physical first
principles: gear mesh, compression events, cylinder impulses, and the
supercharger spooling on the same crankshaft that drives the propeller.

The startup sequence runs as a pre-rendered buffer (offline synthesis,
played once). After handoff, the live AudioWorklet takes over and runs
sample-by-sample for the duration of the flight.

---

## Startup Sequence

The DB 601 uses a **Schwungkraftanlasser** (inertia starter): an electric
motor spins a flywheel for ~26 seconds, then a dog clutch engages it to
the crankshaft, cranking the engine until combustion sustains itself.

### Phase 1 — Schwungrad (Flywheel) · 26 s

The flywheel spins under electric motor load. Two overlapping sounds:

**Gear mesh strain** — the flywheel driving against its housing:
- Two mesh frequencies: primary `f₁ = 47 · exp(0.1143 · t)` (reaches 310 Hz
  at t = 26 s) and a secondary at `f₁ · 1.633`
- Each gear tooth engagement fires an impulse burst decaying at ~15 ms
- LFSR pseudo-noise adds rasp texture scaled with mesh frequency
- Amplitude envelope rises over 8 s, holds, then decays into the Klonk

**Electric motor whine:**
- Carrier at 1590 Hz ± 28 Hz (3.7 Hz wobble — motor under load)
- Three harmonics: 1×, 2×, 3× at 0.65 / 0.22 / 0.08
- Fades out over the last 5 s before clutch engagement

### Phase 2 — Klonk · 0.18 s

The engagement transient when the flywheel clutch locks onto the crankshaft.

- Fast transient: `decay = exp(-200/sr)` (~5 ms)
- Slower body noise: `decay = exp(-60/sr)` (~16 ms)
- 180 Hz resonator (r = 0.88) gives the metallic ring
- Peak amplitude ×1.8 — distinct, mechanical, once

### Phase 3 — Anlassen (Motoring) · 2.8 s

The flywheel cranks the engine. No combustion yet. Compression events only.

- ~65 RPM at start, declining to ~47 RPM at end as flywheel energy transfers
- Compression interval: `sr · 2 · 60 / (rpm · 12)` — one event per cylinder
  per two-stroke cycle (12-cylinder engine)
- Each event: transient + low-frequency body noise (same model as live engine)
- Gear mesh continues from flywheel engagement, frequency sliding 310 → 240 Hz,
  amplitude fading as flywheel disengages
- Electric motor continues at reduced gain, sagging under crankshaft load

### Phase 4 — Anlauf (Runup) · 42 s

First combustion to idle. The engine takes over from the flywheel.

**First Zündung (Knall):** at t = 0.04 s into the runup, a large impulse
(`transient += 2.8, body += 1.96`) kicks the engine into life.

**RPM curve:**
```
rpm(t) = 80 + (targetRpm − 80) · (t / duration)^0.55
```
The 0.55 exponent gives a fast initial rise that flattens toward idle —
matching the way a real engine catches and settles.

**Misfire probability** early in the runup (before oil pressure builds and
cylinders warm):
```
missFireProb = max(0, 0.55 − rpm / 250 · 0.55)
```
Cylinders start misfiring at ~40% probability at 80 RPM, clearing completely
by ~250 RPM. The irregular firing during this phase is the characteristic
rough-catch sound.

**Gear mesh tail:** The flywheel does not disengage instantly. A 3-second
decaying tail continues from where motoring left off (240 Hz, sliding down
as the flywheel spins out). Level starts at 0.30 (matching end-of-motoring)
and decays with τ = 3 s — audible through the first Zündungen, gone before
the supercharger comes in.

**Supercharger (Lader):**
```
laderFreq = superchargerFreqIdle · rpm / rpmIdle
lader = (sin(2π·φ) + sin(4π·φ)·0.4) · max(0, (progress − 0.28) / 0.72) · 0.10
```
Fades in at 28% of the runup duration (~11.8 s in). The frequency is
proportional to RPM so it rises naturally with the engine and matches the
live Lader oscillator at handoff. The two-harmonic shape (fundamental + 2×)
gives the characteristic supercharger whine.

---

## Live Engine — AudioWorklet

After startup completes, `db605-processor.js` takes over. It runs
sample-by-sample inside a Web Audio AudioWorklet — zero-latency, no
JavaScript garbage collection pauses.

### Cylinder firing model

```
firingAngles = [0, 60, 120, 180, 240, 300]° ± 8° jitter
```

Six evenly-spaced firing events per revolution (V12 = 2 banks of 6,
firing alternately). The ±8° jitter gives each cylinder a slightly
different character, preventing the mechanical regularity of pure
digital synthesis.

At each firing angle crossing:

```
transient += cylinderGain
body      += cylinderGain · 0.7
```

### Transient / body decay model

```
transDecay = exp(−300 / sr)          // ~15 ms — percussion crack
tau        = max(firingInterval / 3, sr · 0.003)
bodyDecay  = exp(−1 / tau)           // dynamic — scales with RPM
noiseScale = 0.2 · (1 − exp(−firingInterval / tau))
```

The body decay adapts to RPM. At low RPM the firing interval is long —
each compression puff has room to breathe. At high RPM the interval
shrinks, bodyDecay tightens to prevent puffs bleeding into each other.
This was the key breakthrough: a fixed bodyDecay produces massive noise
overlap above 800 RPM.

### Resonator

```
firingFreq = min(480, rpm / 60 · 6)    // Hz
resR       = 0.94
resCos/Sin = 2π · firingFreq / sr
```

The resonator tracks firing frequency so the tonal character of the
engine shifts with RPM. A fixed resonator (the earlier implementation
used 45 Hz) masks the pitch entirely — the engine sounds the same at
400 RPM and 2000 RPM.

Output mix: `raw · 0.05 + resonated · 0.95` — the resonator dominates,
the raw impulse provides the crack on the attack.

### Supercharger (live)

Two oscillators:
- Fundamental: `superchargerFreqIdle · rpm / rpmIdle` (700 Hz at idle)
- 2nd harmonic: `2 · fundamental`

Gain scales with throttle: `superchargerGain · (0.28 + 0.72 · throttle)`.
The 0.28 base keeps the whine present at idle; the 0.72 factor gives it
mechanical authority as throttle opens.

---

## Synthesis handoff

At the end of the startup buffer, the AudioWorklet is already running.
The crossfade is instantaneous — the startup synthesis ends with the
Lader at `superchargerFreqIdle · rpmIdle / rpmIdle = 700 Hz`, and the
live Lader oscillator starts at exactly 700 Hz. No pitch jump.

The resonator in the worklet is initialized fresh (not carried over from
synthesis), but at idle RPM the firing frequency is ~40 Hz — close enough
to the synthesis resonant character that the transition is seamless.

---

## File map

| File | Role |
|------|------|
| `core/sound.js` | Startup synthesis, live engine wiring, AudioWorklet loading |
| `core/db605-processor.js` | AudioWorklet processor — sample-by-sample live engine |
| `aircraft/bf109.json` | Engine config: rpmIdle, rpmMax, superchargerFreqIdle, etc. |
| `scripts/render-startup.mjs` | Offline renderer — writes startup.wav from same synthesis |
| `scripts/analyze-startup.py` | Spectrogram + phase annotation for startup WAV |

---

## Parameters (bf109.json)

```json
{
  "rpmIdle":              400,
  "rpmMax":               2800,
  "masterGain":           0.80,
  "superchargerFreqIdle": 700,
  "superchargerFreqMax":  2500,
  "superchargerGain":     0.45
}
```

---

## Why it works

The engine sound is not waves added together. It is **events in time** —
each cylinder firing, each tooth engaging, each compression stroke. The
noise is not background texture; it is the thermodynamic character of
combustion itself. Manage it, don't suppress it.

The gear mesh tail at the start of the runup is a detail that nobody
requested but everyone notices when it's missing. The flywheel gave its
energy to the crankshaft. It doesn't stop instantly. It says goodbye over
three seconds, slowing down, letting go.

D-FEML, Werknummer 1983. 24. Januar 1942.
She runs again.
