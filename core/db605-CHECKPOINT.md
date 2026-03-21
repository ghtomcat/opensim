# DB 605 Sound Engine — Parameter Checkpoints

## REGEL: Sofort sichern wenn es gut klingt. Nie wieder verlieren.

---

## Checkpoint B — "nice" (20.3.2026 ~23:55)
*Durchbruch: dynamisches bodyDecay, Noise-Normalisierung, Supercharger aktiv*

```javascript
// db605-processor.js

transDecay = Math.exp(-300 / sampleRate)   // ~15ms crack
// bodyDecay: DYNAMISCH via _updateBodyDecay(rpm)
//   tau = max(firingInterval/3, 3ms)
//   bodyDecay = exp(-1/tau)
//   noiseScale = 0.2 * (1 - overlap)   // overlap-kompensiert

f0 = 45, r = 0.96
raw     = transient * 0.3 + body * noise * noiseScale
exhaust = raw * 0.05 + nx * 0.95

firingAngles: 6 × 60° ±8° jitter
cylinderGains: 0.4 + random * 1.2
```

```javascript
// sound.js
rpmIdle: 400, rpmMax: 2800
masterGain: 0.80
superchargerFreqIdle: 663, superchargerFreqMax: 1100, superchargerGain: 0.45
supercharger2FreqIdle: 1097, supercharger2FreqMax: 1400, supercharger2Gain: 0.18
lGain = superchargerGain * (0.15 + 0.85 * throttle)   // linear / mechanisch
```

**Wichtig: _buildSupercharger() wird jetzt auch im Worklet-Pfad aufgerufen.**
**Cockpit RPM-Anzeige zeigt echte Motor-RPM (400–2800), nicht Fake-20–200.**

### Was hier gelöst wurde:
- bodyDecay dynamisch: kurz bei hohen RPM, lang bei tiefen → kein Noise-Overlap
- noiseScale overlap-kompensiert → gleiche Noise-Power über alle RPM
- Supercharger im Worklet-Pfad aktiviert (war vorher still)
- Cockpit RPM-Anzeige korrigiert

### Klingt gut bei:
- 400 RPM (idle): kernig, DB605-Charakter
- 825–1200 RPM: genial/super
- Supercharger: whine bei Gasgeben hörbar, 663Hz + 1097Hz Oberton

### Noch offen:
- 1991+ RPM: leicht noisy (verbesserbar)
- 2500 RPM: noch nicht perfekt

---

## Checkpoint A — "es stimmt total" / "ultrageil" (20.3.2026 ~23:xx)
*ACHTUNG: War nur bei 400 RPM getestet. Hohe RPM waren uncharted territory.*
*bodyDecay 60ms → massiver Noise-Overlap bei RPM > 800. Nicht als Basis verwenden.*

```javascript
transDecay = Math.exp(-300 / sampleRate)
bodyDecay  = Math.exp(-55  / sampleRate)   // ~60ms — ZU LANG für hohe RPM!
f0 = 45, r = 0.96
raw     = transient * 0.3 + body * noise * 0.8
exhaust = raw * 0.05 + nx * 0.95
firingAngles: 6 × 60° ±8° jitter
```

---

## Was NIE funktioniert:
- r > 0.998 ohne DC-Block → "Flasche" (Resonator saturiert)
- Direkter resX-Strike → "elektronisches Schlagzeug"
- Differenzierter Transient → "Thud"
- body * noise ohne Decay-Anpassung bei hohen RPM → permanentes Rauschen
- Lowpass auf Output → konvertiert High-Freq-Noise zu Low-Freq-Noise, klingt schlimmer
- noiseAmt RPM-proportional (400/rpm) → "less motor" bei allen RPM
- Noise komplett weglassen → "elektrisch"
- bodyDecay zu kurz (< 2ms) → "kein Motor"

## Nächste Session:
1. Checkpoint B laden
2. Testen ob 400–1200 RPM noch gut klingt
3. 1991–2800 RPM weiter optimieren (evtl. noiseScale Formel anpassen)
4. Lader-Sound verfeinern (Attack/Release beim Gasgeben)
