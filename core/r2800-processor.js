/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/r2800-processor.js
   Pratt & Whitney R-2800-8 Double Wasp — AudioWorklet physical model

   18 cylinders, twin-row (9 front + 9 rear).
   4-stroke cycle = 720° per 2 crankshaft revolutions.
   Angle advances at rpm × 360 / 60 / sr (crank degrees per sample),
   so 720° = 2 full crank revolutions = one complete firing cycle.

   Firing angles in 720°:
   Row A: 0°, 80°, 160°, 240°, 320°, 400°, 480°, 560°, 640°
   Row B: 20°, 100°, 180°, 260°, 340°, 420°, 500°, 580°, 660°

   Paired firings 20° apart (≈2.8ms at 750 RPM), 60° gaps between pairs.
   Fundamental = 9 pairs × (RPM/120) = 56 Hz at 750 RPM.

   Signal chain per cylinder firing:
   - bang  (K=4500, f_3dB≈716 Hz)  — low punch/impact
   - crack (K=10000, f_3dB≈1592 Hz) — mid presence, the "snap" per cylinder
   - exhaust × noise                 — body and texture
   Final: raw * 0.85 + resonator * 0.15 (resonator adds warmth, not dominance)

   Calibration target: https://www.youtube.com/watch?v=P1cTOLemXLA
   See docs/sound-calibration.md for methodology.
   ═══════════════════════════════════════════════════════════════ */

class R2800Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.rpm        = 750;
    this.masterGain = 0.8;

    this.angle = 0;

    /* 9 front cylinders — 80° spacing in 720° cycle */
    this.firingAnglesA = Array.from({ length: 9 }, (_, i) =>
      ((i * 80) + (Math.random() - 0.5) * 10) % 720
    );
    /* 9 rear cylinders — 20° offset from front */
    this.firingAnglesB = Array.from({ length: 9 }, (_, i) =>
      ((i * 80 + 20) + (Math.random() - 0.5) * 10) % 720
    );

    this.gainA = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);
    this.gainB = Array.from({ length: 9 }, () => 0.55 + Math.random() * 0.9);

    /* Bang — low punch, f_3dB = K/(2π) ≈ 716 Hz */
    this.bangDecayA = Math.exp(-4500 / sampleRate);
    this.bangDecayB = Math.exp(-3800 / sampleRate);
    this.bangAmpA   = new Float32Array(9);
    this.bangAmpB   = new Float32Array(9);

    /* Crack — mid presence, f_3dB ≈ 1592 Hz — dedicated source for 800-3k range */
    this.crackDecayA = Math.exp(-10000 / sampleRate);
    this.crackDecayB = Math.exp(-8500 / sampleRate);
    this.crackAmpA   = new Float32Array(9);
    this.crackAmpB   = new Float32Array(9);

    /* Exhaust body */
    this.exhaustAmpA  = new Float32Array(9);
    this.exhaustAmpB  = new Float32Array(9);
    this.exhaustDecay = Math.exp(-60 / sampleRate);
    this.noiseScale   = 0.18;   // updated by _updateDecay

    /* Resonator 1 — 3rd harmonic (~168 Hz idle): deep body/warmth */
    this.resR   = 0.86;
    this.resCos = 1;
    this.resSin = 0;
    this.resX   = 0;
    this.resY   = 0;

    /* Resonator 2 — 9th harmonic (~506 Hz idle): exhaust rasp/character
       Lower Q (resR=0.80) → broader resonance, less ringy */
    this.res2R   = 0.80;
    this.res2Cos = 1;
    this.res2Sin = 0;
    this.res2X   = 0;
    this.res2Y   = 0;

    /* LFSR noise */
    this.lfsr = 0xACE1;

    /* Noise lowpass — 2200 Hz for exhaust texture */
    this.noiseLp      = 0;
    this.noiseLpCoeff = Math.exp(-2 * Math.PI * 2200 / sampleRate);

    /* Output lowpass — 3.5 kHz: crack presence without harshness */
    this.lpState = 0;
    this.lpCoeff = Math.exp(-2 * Math.PI * 3500 / sampleRate);

    this._updateDecay(this.rpm);

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.rpm        !== undefined) { this.rpm = d.rpm; this._updateDecay(d.rpm); }
      if (d.masterGain !== undefined)   this.masterGain = d.masterGain;
    };
  }

  _updateDecay(rpm) {
    /* 9 pairs per 720° cycle, cycle = 2 crank revolutions */
    const cyclesPerSec   = rpm / 120;
    const firingInterval = sampleRate / (cyclesPerSec * 9);

    /* Exhaust tau: 50% of interval, max 22ms */
    const tau = Math.min(firingInterval * 0.50, sampleRate * 0.022);
    this.exhaustDecay = Math.exp(-1 / tau);

    /* Noise scale shrinks as cylinders overlap (idle = distinct puffs, power = tonal) */
    const overlap   = Math.exp(-firingInterval / tau);
    this.noiseScale = 0.55 * (1 - overlap);

    /* Resonator 1: 3rd harmonic — 168 Hz at idle */
    const firingFreq = cyclesPerSec * 9 * 3;
    const omega      = 2 * Math.PI * firingFreq / sampleRate;
    this.resCos = Math.cos(omega);
    this.resSin = Math.sin(omega);

    /* Resonator 2: 9th harmonic — 506 Hz at idle (rasp cluster from no-cowling analysis) */
    const omega2   = 2 * Math.PI * (cyclesPerSec * 9 * 9) / sampleRate;
    this.res2Cos = Math.cos(omega2);
    this.res2Sin = Math.sin(omega2);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const degsPerSample = this.rpm * 360 / 60 / sampleRate;

    for (let i = 0; i < out.length; i++) {
      const prev  = this.angle;
      this.angle  = (this.angle + degsPerSample) % 720;

      /* Fire Row A */
      for (let c = 0; c < 9; c++) {
        const fa      = this.firingAnglesA[c];
        const crossed = (prev < fa && this.angle >= fa) ||
                        (prev > this.angle && (fa >= prev || fa < this.angle));
        if (crossed) {
          this.bangAmpA[c]    = this.gainA[c] * 0.50;
          this.crackAmpA[c]   = this.gainA[c] * 0.38;
          this.exhaustAmpA[c] = this.gainA[c] * 0.75;
        }
        this.bangAmpA[c]    *= this.bangDecayA;
        this.crackAmpA[c]   *= this.crackDecayA;
        this.exhaustAmpA[c] *= this.exhaustDecay;
      }

      /* Fire Row B */
      for (let c = 0; c < 9; c++) {
        const fb      = this.firingAnglesB[c];
        const crossed = (prev < fb && this.angle >= fb) ||
                        (prev > this.angle && (fb >= prev || fb < this.angle));
        if (crossed) {
          this.bangAmpB[c]    = this.gainB[c] * 0.44;
          this.crackAmpB[c]   = this.gainB[c] * 0.34;
          this.exhaustAmpB[c] = this.gainB[c] * 0.68;
        }
        this.bangAmpB[c]    *= this.bangDecayB;
        this.crackAmpB[c]   *= this.crackDecayB;
        this.exhaustAmpB[c] *= this.exhaustDecay;
      }

      /* LFSR noise */
      this.lfsr ^= this.lfsr << 13;
      this.lfsr ^= this.lfsr >> 17;
      this.lfsr ^= this.lfsr << 5;
      const raw_noise = (this.lfsr & 0xFFFF) / 0x8000 - 1;
      this.noiseLp = this.noiseLpCoeff * this.noiseLp + (1 - this.noiseLpCoeff) * raw_noise;

      /* Sum rows */
      let bang = 0, crack = 0, exhaust = 0;
      for (let c = 0; c < 9; c++) {
        bang    += this.bangAmpA[c]  + this.bangAmpB[c];
        crack   += this.crackAmpA[c] + this.crackAmpB[c];
        exhaust += this.exhaustAmpA[c] + this.exhaustAmpB[c];
      }

      /* Mix: bang (low punch) + crack (mid presence) + exhaust body (deep rumble) + noise texture */
      const raw = (bang * 0.28 + crack * 0.18
                   + exhaust * 0.32                          // pure exhaust body — deep bass substance
                   + exhaust * this.noiseLp * this.noiseScale) * this.masterGain;

      /* Resonator 1 — 3rd harmonic: deep body */
      const nx  = this.resR * (this.resX * this.resCos - this.resY * this.resSin) + raw;
      const ny  = this.resR * (this.resX * this.resSin + this.resY * this.resCos);
      this.resX = nx;
      this.resY = ny;

      /* Resonator 2 — 9th harmonic: exhaust rasp */
      const nx2 = this.res2R * (this.res2X * this.res2Cos - this.res2Y * this.res2Sin) + raw;
      const ny2 = this.res2R * (this.res2X * this.res2Sin + this.res2Y * this.res2Cos);
      this.res2X = nx2;
      this.res2Y = ny2;

      const mixed  = raw * 0.50 + nx * 0.32 + nx2 * 0.18;
      this.lpState = this.lpCoeff * this.lpState + (1 - this.lpCoeff) * mixed;
      out[i]       = this.lpState;
    }

    return true;
  }
}

registerProcessor('r2800-processor', R2800Processor);
