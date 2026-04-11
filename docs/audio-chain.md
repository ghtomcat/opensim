# OpenSim Audio Chain — Developer Documentation

**Module:** `core/radio.js` + `core/radio-crackle-processor.js`
**Status:** Stage 1+2 complete. Stage 3 (environment bleed) integrated.

---

## Overview

Every voice in an OpenSim mission passes through a historically accurate comm chain before reaching the speaker. The chain models the physical comm equipment of the era — VHF aviation radio, NASA S-band, Soviet VHF, SpaceX IP backbone — including bandpass characteristics, noise floor, crackle, and squelch tail.

The voice source is decoupled from the comm chain:

```
[voice source]  ──────────────────────────────────────────────────────┐
  ElevenLabs MP3 (pre-recorded, specific character)                    │
  Archival recording (real mission audio — NASA, SpaceX, etc.)         ├──► [commProfile chain] ──► speakers
  Zoom H4n Pro WAV (real crew — Markus, Lydia, Pradeep, MS2)           │
  Web Speech TTS (fallback for dynamic content)                        │
                                                                       │
[environment bleed] ──────────────────────────────────────────────────┘
  Engine output tap from sound.js (cockpit environments only)
```

---

## commProfile presets

Defined in `core/radio.js → PROFILES`.

| Profile | Era / context | Bandpass | Noise floor | Notes |
|---|---|---|---|---|
| `vhf-aviation` | Standard ATC, 118–137 MHz | 350–3400 Hz | 0.022 | Squelch tail, 400Hz whine, 1kHz carrier |
| `tower-quiet` | Ground station TX | 400–3200 Hz | 0.010 | Cleaner — good equipment, quiet room |
| `sband-apollo` | NASA S-band MSFN, 2.1 GHz | 300–3000 Hz | 0.030 | More hiss — 380,000 km path |
| `vhf-vostok` | Soviet VHF 143.625 MHz, 1961 | 500–2800 Hz | 0.045 | Narrow, harsh, heavy noise floor |
| `ip-spacex` | SpaceX IP backbone | 200–7000 Hz | 0.004 | Near phone quality, minimal processing |

---

## Signal chain (per transmission)

```
input gain
  → highpass BiquadFilter  (bandpass lo-cut)
  → lowpass  BiquadFilter  (bandpass hi-cut)
  → peaking  BiquadFilter  (presence boost, ~2100 Hz)
  → output gain
      ↑
  noise floor (BufferSource looped white noise → gain)
  crackle     (RadioCrackleProcessor AudioWorklet)
  carrier hum (OscillatorNode, 1000 Hz, profile-dependent)
  cockpit whine (OscillatorNode, 400 Hz, profile-dependent)
  environment bleed (engine tap from sound.js _master node, cockpit profiles only)
```

---

## AudioWorklet: RadioCrackleProcessor

File: `core/radio-crackle-processor.js`

Per-sample synthesis of three effects:
- **Crackle** — sparse random pops, probability `crackleLevel` per sample
- **Static bursts** — periodic noise surges, 40–200ms, interval 1–8s random
- **Squelch tail** — 180ms noise burst triggered on transmission end

Parameters (k-rate):
- `crackleLevel` — default 0.018
- `burstLevel` — default 0.08

Trigger squelch tail by posting `{ squelchTail: true }` to the worklet port.

---

## Mission JSON integration

### Mission-wide default profile

```json
{
  "id": "hostomel-2022",
  "commProfile": "vhf-aviation",
  ...
}
```

### Pre-recorded audio callout

```json
{
  "t": 5,
  "audio": "audio/hostomel/atc_olena.mp3",
  "commProfile": "vhf-aviation"
}
```

If `commProfile` is omitted on the callout, the mission-level `commProfile` is used. Falls back to `"vhf-aviation"`.

### TTS callout (unchanged)

```json
{
  "t": 8,
  "text": "Мрія, запуск двигунів дозволено.",
  "voice": "atc"
}
```

TTS callouts do not currently pass through the radio chain (Stage 4 — character system).

---

## Environment bleed (Stage 3)

Cockpit profiles tap the engine output from `sound.js` (`_master` GainNode) and mix it into the receive chain at low level. This models engine noise bleeding into received comms in a real cockpit.

| Environment profile | Engine bleed level |
|---|---|
| `cockpit-bf109` | 4% |
| `cockpit-c172` | 5% |
| `capsule-dragon` | 4% |

**Critical:** The radio chain must use the same `AudioContext` as `sound.js`. `getAudioContext()` in `sound.js` returns the shared context. Using a separate `AudioContext` for the radio chain prevents cross-node connections and breaks environment bleed.

---

## Audio file pipeline

### ElevenLabs → radio chain

1. Generate voice in ElevenLabs (e.g. Olena voice for Ukrainian ATC)
2. Download as MP3
3. Place in `audio/[mission_id]/[filename].mp3`
4. Reference in mission JSON: `"audio": "audio/hostomel/atc_olena.mp3"`
5. The radio chain applies `commProfile` coloring at playback time

No pre-baking required. The chain is applied at runtime.

### Real crew recording pipeline (Inspiration5)

1. Record on Zoom H4n Pro — 24-bit WAV, 96kHz, clean preamps
2. Optional: record through aviation headset for natural mic coloring
3. Trim silence in any audio editor
4. Place in `audio/inspiration5/[role]_[line].wav`
5. Reference in mission JSON with `"commProfile": "sband-crew"`

Web Audio decodes WAV natively — no conversion needed.

### Archival recordings (Demo-2, Apollo, Vostok)

#### 1. Download the source

```bash
# YouTube webcast — outputs to audio/[mission_id]/raw.mp3
yt-dlp -x --audio-format mp3 -o "audio/crew-demo2/webcast.%(ext)s" "https://..."

# Or cut a specific time window directly (saves bandwidth):
yt-dlp -x --audio-format mp3 \
  --download-sections "*01:44:40-01:46:40" \
  -o "audio/crew-demo2/demo2_raw.%(ext)s" \
  "https://..."
```

#### 2. Identify timestamps

Watch the raw clip and note the offset (seconds from clip start) of each moment you want.

Example (Demo-2, raw clip starts at webcast T-1:00 = mission t=0):

| Offset in clip | Mission t | Content |
|---|---|---|
| 0:05 | t=5 | "Falcon 9 is in startup" |
| 0:16 | t=16 | "Dragon SpaceX, you are go for launch" + crew |
| 0:31 | t=31 | "Stage one tanks pressing for flight" |
| 0:48 | t=48 | Countdown + ignition + "Godspeed Bob and Doug" |

#### 3. Cut individual clips

```bash
ffmpeg -y -ss 0:00:05 -i audio/crew-demo2/demo2_raw.mp3 -t 6  -q:a 0 audio/crew-demo2/f9_startup.mp3
ffmpeg -y -ss 0:00:16 -i audio/crew-demo2/demo2_raw.mp3 -t 8  -q:a 0 audio/crew-demo2/go_for_launch.mp3
ffmpeg -y -ss 0:00:31 -i audio/crew-demo2/demo2_raw.mp3 -t 5  -q:a 0 audio/crew-demo2/tanks_pressing.mp3
ffmpeg -y -ss 0:00:48 -i audio/crew-demo2/demo2_raw.mp3 -t 20 -q:a 0 audio/crew-demo2/ignition_liftoff.mp3
```

`-ss` before `-i` = fast seek. `-t` = duration in seconds. `-q:a 0` = best MP3 quality.

#### 4. Wire into mission JSON

Add a `characters` block to the mission with the correct commProfile for each speaker, then reference clips with `speaker` + `audio`:

```json
{
  "commProfile": "ip-spacex",
  "characters": {
    "narrator": { "commProfile": "ip-spacex" },
    "atc":      { "commProfile": "ip-spacex" },
    "crew":     { "commProfile": "sband-crew" }
  },
  "atcClearances": [
    { "t":  5, "speaker": "narrator", "audio": "audio/crew-demo2/f9_startup.mp3" },
    { "t": 16, "speaker": "narrator", "audio": "audio/crew-demo2/go_for_launch.mp3" },
    { "t": 31, "speaker": "narrator", "audio": "audio/crew-demo2/tanks_pressing.mp3" },
    { "t": 48, "speaker": "narrator", "audio": "audio/crew-demo2/ignition_liftoff.mp3" }
  ]
}
```

The `speaker` field resolves `characters[speaker].commProfile` at playback time. No extra field needed.

#### 5. Profile for each source

| Source | Profile |
|---|---|
| SpaceX webcast (John Insprucker, Kate Tice, webcast room) | `ip-spacex` |
| SpaceX CAPCOM (Mission Control to crew) | `ip-spacex` |
| Crew inside Dragon | `sband-crew` *(add when H4n recordings land)* |
| NASA public affairs / MSFN (Apollo) | `sband-apollo` |
| Soviet ground (Vostok) | `vhf-vostok` |

#### License note

NASA audio is public domain. SpaceX webcasts are © SpaceX — use only for non-commercial simulation and education. The audio files are excluded from the repo (`.gitignore`) and are not redistributed.

---

## Spectral analysis

`scripts/analyze-radio.py` — compares clean vs processed audio side by side.

**Requirements:** Python 3, numpy, matplotlib, ffmpeg in PATH.

```bash
python3 scripts/analyze-radio.py audio/hostomel/atc_olena.mp3 processed.mp3
```

Output: `radio_analysis.png` — spectrogram + waveform + band energy report.

**Validated result (Olena, vhf-aviation):**

| Band | Clean | Processed |
|---|---|---|
| Sub-bass <350 Hz | 163 | 49 (−70%) |
| Voice 350–3400 Hz | 60 | 56 (preserved) |
| Presence 1800–2600 Hz | 14 | 22 (+57%) |
| Air >3400 Hz | 6.5 | 2.3 (−65%) |

Peak frequency: 182 Hz (clean) → 358 Hz (processed). Sub-bass cut, voice preserved, presence boosted.

---

## Adding a new commProfile

In `core/radio.js → PROFILES`, add:

```javascript
'my-profile': {
  bandpass:     [400, 3200],   // Hz lo / hi
  presenceFreq: 2000,          // Hz centre
  presenceGain: 4,             // dB
  presenceQ:    0.8,
  carrierFreq:  1000,          // Hz — null to disable
  carrierGain:  0.005,
  whineFreq:    null,          // Hz — null to disable
  whineGain:    0,
  noiseFloor:   0.015,
  crackle:      0.012,
  burstLevel:   0.06,
  squelchTail:  true,
  outputGain:   0.92,
},
```

Then reference it in mission JSON: `"commProfile": "my-profile"`.

---

## Roadmap

| Stage | Status | Description |
|---|---|---|
| 1 — Radio chain | ✓ Done | `createRadioChain()`, 5 profiles, crackle worklet |
| 2 — MP3 playback | ✓ Done | `audio:` field in callouts, `playRadio()` in crew.js |
| 3 — Environment bleed | ✓ Done | Engine tap from sound.js into cockpit profiles |
| 4 — Character system | ✓ Done | `characters:` block in mission JSON, per-character commProfile + `speaker:` field on callouts |
| 5 — Era sounds | Future | AFSK data bursts (SpaceX), biomedical beeps (Apollo), SELCAL |

---

## File map

| File | Role |
|---|---|
| `core/radio.js` | Radio chain — `createRadioChain()`, `playThroughChain()`, `PROFILES` |
| `core/radio-crackle-processor.js` | AudioWorklet — crackle, static bursts, squelch tail |
| `core/crew.js` | `playRadio()` — dispatches audio callouts through the chain |
| `core/sound.js` | `getAudioContext()`, `getEngineBleedNode()` — shared context + engine tap |
| `scripts/analyze-radio.py` | Spectral analysis — clean vs processed comparison |
| `audio/hostomel/atc_olena.mp3` | Ukrainian ATC voice (ElevenLabs, Olena) |
| `audio/crew-demo2/demo2_raw.mp3` | Demo-2 webcast raw clip (T-60 to T+60), not committed |
| `audio/crew-demo2/f9_startup.mp3` | "Falcon 9 is in startup" — John Insprucker, t=5 |
| `audio/crew-demo2/go_for_launch.mp3` | Go for launch comm + crew — t=16 |
| `audio/crew-demo2/tanks_pressing.mp3` | "Stage one tanks pressing" — t=31 |
| `audio/crew-demo2/ignition_liftoff.mp3` | Countdown + ignition + Godspeed — t=48 |
| `docs/db601-synthesis.md` | Companion doc — DB 601 engine synthesis |
