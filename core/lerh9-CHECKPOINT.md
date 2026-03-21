# Le Rhône 9J — Checkpoint D ✅ ULTRAGEIL

**Date:** 2026-03-22, ~02:00
**Status:** Blip working — 400 RPM röchelt, 600+ RPM ultrageil

## What works
- 400 RPM: röchelt beim Landen (Blip-Switch aktiv)
- 600+ RPM: voller Rotary-Charakter
- Gyro-Whirr subtil drin
- Blip bei throttle < 0.3: zufällige 20-60ms Power / 30-80ms Cut

## Key parameters (lerh9-processor.js)
```
bangDecay:    Math.exp(-8000 / sr)    // ~0.3ms
bangAmp:      cylinderGains * 0.05   // nearly silent
exhaustAmp:   cylinderGains * 0.3
noiseLpCoeff: Math.exp(-2π * 3000 / sr)
lpCoeff:      Math.exp(-2π * 2000 / sr)
jitter:       ±18°
gainRange:    0.3 + random * 1.4
spinGain:     0.04
blip:         throttle < 0.3 → random cuts
```

## Key parameters (sound.js)
```
rpmIdle:    400
rpmMax:     1200
masterGain: 3.5
```

## What NOT to change
- Do NOT increase blip threshold above 0.3 (too aggressive)
- Do NOT remove gyro spin (it's subtle but adds life)
- 400 RPM röcheln is correct — that's the blip on approach

---

# Le Rhône 9J — Checkpoint C ✅ WORKING

**Date:** 2026-03-22, ~01:30
**Status:** BRÖPPEL BRÖPPEL — the rotary character is real

## Key parameters (lerh9-processor.js)

```
bangDecay:    Math.exp(-8000 / sampleRate)   // ~0.3ms — ultra short
bangAmp:      cylinderGains * 0.05           // nearly silent
exhaustAmp:   cylinderGains * 0.3            // starts soft, builds
exhaustDecay: dynamic via _updateDecay()
noiseLpCoeff: Math.exp(-2π * 3000 / sr)     // 3000 Hz — open/airy
lpCoeff:      Math.exp(-2π * 2000 / sr)     // 2000 Hz output cutoff
jitter:       ±18° per cylinder
gainRange:    0.3 + random * 1.4
```

## Key parameters (sound.js)

```
rpmIdle:    400
rpmMax:     1200
masterGain: 2.0
```

## Character by RPM
- 353 RPM: Nähmaschine mit Dampf
- 400 RPM: bröppel bröppel ✅
- 630 RPM: cool, etwas gedämpft

## What NOT to change
- Do NOT reduce jitter (was too uniform = Heli)
- Do NOT lower noiseLpCoeff below 2000 Hz (gets too muffled)
- Do NOT remove bang entirely (needs the initial transient)

---

# Le Rhône 9J — Checkpoint B

**Date:** 2026-03-22, ~01:00
**Status:** 9 cylinders working — pffft at low RPM, propeller-like at high RPM

## Key parameters

```
bangDecay:    Math.exp(-3000 / sampleRate)  // ~0.8ms
exhaustDecay: dynamic via _updateDecay()
lpCoeff:      Math.exp(-2π * 600 / sampleRate)  // 600 Hz cutoff
mix:          exhaust * noise only (bang = 0)
```

## Character
- 60 RPM: individual pffffft, steam engine
- 300–600 RPM: perkussiv, Dampflok
- 600+ RPM: verschmelzen zu Luftschraube-Charakter — physically correct for rotary

## What's good
- Basic pffft sound is right
- RPM scaling works
- Overall character: "recht gut"

## What needs tuning
- Still too percussive overall
- Lowpass at 600 Hz helps but may need further adjustment
- Spin tone (gyroscopic whirr) not yet added

---

# Le Rhône 9J — Checkpoint A

**Date:** 2026-03-22, ~00:30
**Status:** 1-cylinder working — the pffffft is real

---

## What works

- 1 cylinder, 60 RPM
- Bang (0.8ms transient) + Exhaust (broadband noise, ~35ms decay)
- The pffffft sounds like air rushing out — not bass, not drum
- Silence between pulses — the steam engine character

## Key parameters

```
bangDecay:    Math.exp(-3000 / sampleRate)  // ~0.8ms
exhaustDecay: Math.exp(-80 / sampleRate)    // ~35ms
bangAmp:      1.0
exhaustAmp:   0.8
mix:          bang*0.2 + noise*0.8
```

## What's next

1. Scale exhaustDecay with RPM (overlap at high RPM)
2. Add 9 cylinders at 80° spacing in 720° cycle
3. Tune masterGain for correct volume
4. Test at 600 RPM idle — should sound like Nähmaschine
5. Test at 1200 RPM — should sound like Rasenmäher
6. Add spin tone (gyroscopic whirr from rotating mass)

## What NOT to do

- Do NOT go back to resonator-dominant model (was: schiffsdiesel)
- Do NOT add noise body without bang first
- The silence between pffft is the character — protect it

## RPM setting

Currently rpmIdle: 60 in sound.js for testing.
Before release: set back to rpmIdle: 600.
