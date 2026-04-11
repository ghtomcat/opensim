# Engine Sound Calibration

## How to calibrate a new engine from a reference video

This is the repeatable workflow for tuning an AudioWorklet engine synthesizer
against a real recording.

---

## Step 1 — Watch and listen

Open the reference video. Listen all the way through without taking notes first.
Form impressions:

- What is the character at low RPM? Fast pops? Slow thuds? Individual cylinders audible?
- How does it change through the RPM range?
- Is there a mechanical whine (supercharger, gearbox)?
- What's the timbre at max power — raspy, smooth, wet, dry?
- Is there reverb / echo in the recording? (Ignore environment — focus on the engine itself.)

---

## Step 2 — Spectrum analysis in Audacity

1. Download the reference audio:
   ```
   yt-dlp -x --audio-format mp3 -o reference.mp3 <URL>
   ```
2. Open in Audacity. Select a 2–3 second steady-state section at idle.
3. `Analyze → Plot Spectrum` — use Hann window, 4096 FFT.
4. Note the following peaks:
   - Lowest audible peak = **fundamental** (Hz)
   - Second peak = 2× fundamental (first harmonic) — should be prominent on radial
   - Any high-pitched steady tone = supercharger/gearbox whine
   - Broad noise floor baseline = exhaust gas turbulence level

5. Repeat at mid-RPM and high-RPM sections.

---

## Step 3 — Describe what you hear

Write a plain description. Example format:

```
IDLE (estimated 600-700 RPM):
- Individual cylinder puffs clearly audible — about 8-10 per second
- Each puff: short sharp crack followed by a brief rumble (~10ms)
- Pairs slightly uneven — two close together, then a gap
- Tone is very low, chest-felt, no high pitch yet

MID POWER (~1500 RPM):
- Individual puffs merge — continuous growl
- Lower harmonics dominate, second harmonic very strong
- Faint whine starting, around 1 kHz
- Overall character: "potato potato" burble

FULL POWER (~2700 RPM):
- Dense roar, cylinders no longer individually audible
- 400 Hz fundamental, rich harmonics up to ~1200 Hz
- Supercharger whine clearly audible at ~2 kHz
- Brief throttle blip: whine drops then rises sharply
```

---

## Step 4 — Parameter mapping

The description maps directly to synthesis parameters:

| Observation | Parameter to change |
|-------------|---------------------|
| Puffs per second at idle | `rpmIdle` (verify: rpm/60 × cylinders/2) |
| Puff duration / overlap | `exhaustDecay` tau multiplier in `_updateDecay` |
| Sharpness of each puff | `bangDecayA/B` — shorter = sharper crack |
| Overall darkness / brightness | `lpCoeff` cutoff frequency |
| Low-RPM chug vs smooth | `resR` resonator feedback — higher = more ring |
| Resonator pitch | Tuned to `firingFreq` automatically — check formula |
| Supercharger whine pitch at idle | `superchargerFreqIdle` in sound.js |
| Supercharger pitch at max | `superchargerFreqMax` in sound.js |
| Supercharger audibility | `superchargerGain` (0 = inaudible, 0.5 = prominent) |
| Cylinder-to-cylinder roughness | gain variance range in constructor (e.g. `0.55 + rand × 0.9`) |
| Row A vs Row B asymmetry | `bangDecayA` vs `bangDecayB`, `gainA` vs `gainB` ranges |

---

## Step 5 — Iterate

1. Load the mission in the sim.
2. Listen at idle, then throttle up slowly.
3. Return with a description of what's wrong: "puffs too fast", "too buzzy at high RPM",
   "supercharger too loud", "not enough body in the exhaust".
4. Map the complaint → parameter → adjust.

Typical first-pass issues:
- **Too clean / digital** → lower `noiseLpCoeff` cutoff (let more LFSR noise through)
- **Too much buzz** → raise `noiseLpCoeff` cutoff (smoother noise)
- **Pairs not audible** → reduce exhaust tau multiplier, sharpest them (`bangDecayA` shorter)
- **No depth** → raise `resR` slightly (0.93–0.95 max, or it rings forever)
- **Whine too loud** → lower `superchargerGain`
- **Whine wrong pitch** → adjust `superchargerFreqIdle` / `superchargerFreqMax`

---

## R-2800 Double Wasp — current calibration target

**Reference:** https://www.youtube.com/watch?v=P1cTOLemXLA

**Why this video:** Recording starts at very low RPM — individual cylinder puffs
audible as the engine is coming up to speed. This is the ideal calibration signal
because the pair structure (Row A fires, then Row B 20° later = ~2.8ms gap at 600 RPM)
should be audible as a slight double-puff character.

**Physical facts:**
- 18 cylinders, twin-row (9 front + 9 rear)
- Row offset: 20° in 720° 4-stroke cycle ≈ 2.8ms gap between rows at 600 RPM
- Firing fundamental: 90 Hz at 600 RPM, 405 Hz at 2700 RPM
- Supercharger: single-stage, two-speed
- RPM idle: ~650, combat: 2700, max: 2800

**Current first-pass parameters (r2800-processor.js):**
- bangDecayA: exp(-5500/sr) = 0.45ms crack
- bangDecayB: exp(-4800/sr) = 0.52ms (rear row slightly longer stack)
- exhaustDecay tau: 50% of firing interval, max 22ms
- noiseLpCoeff: 1100 Hz lowpass (exhaust character)
- lpCoeff: 1300 Hz output cutoff (cowling absorption)
- resR: 0.91 (moderate ring)

**Spectrum analysis results (2026-04-11):**

| Moment | Video timestamp | Recording t | Fundamental | Implied RPM |
|--------|----------------|------------|-------------|-------------|
| First puffs | 1:12–1:13 | 72–73s | ~67 Hz | individual pops, ~10–15 RPM on starter |
| Early idle | 1:16 | 76s | 51 Hz | ~680 RPM |
| Warm idle (2:02) | 2:02 | 122s | 56–62 Hz | ~750–830 RPM |
| Throttle push | 2:36 | 156s | 64.6 Hz | ~861 RPM |
| Max in recording | 2:42 | 162s | 80.7 Hz | ~1077 RPM |

**Key findings:**
- 479–584 Hz peaks = 8–9th harmonic of firing fundamental, NOT supercharger
- Real supercharger (7.5:1 gear, ~16 blades) estimated at 1500 Hz idle, 4050 Hz at 2700 RPM
- Harmonic series extends clearly to 9× fundamental (~500 Hz at idle)
- Warm idle RPM = ~750, not 650 (corrected rpmIdle in sound.js)
- Recording is outside ground run only — combat power (2700 RPM) not shown

**Pending:**
- In-cockpit recording needed to verify supercharger pitch
- Startup lifecycle ("brabbel" phase at 10–15 RPM) not yet implemented
- Confirm pair structure (Row A → Row B 20° apart) is audible at idle in sim
