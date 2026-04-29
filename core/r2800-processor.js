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
   - bang     — low punch/impact
   - crack    — mid presence (zero at idle, scales with throttle)
   - exhaust  — body and texture

   All throttle-varying parameters lerp in _updateParams(throttle):
     throttle=0 → matches startup synthesis exactly (flat harmonic series)
     throttle=1 → full power character (crack, wider bandwidth, stronger transients)
   ═══════════════════════════════════════════════════════════════ */

class R2800Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.rpm        = 750;
    this.masterGain = 0.8;
    this.throttle   = 0;

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

    /* Per-cylinder amplitude buffers */
    this.bangAmpA    = new Float32Array(9);
    this.bangAmpB    = new Float32Array(9);
    this.crackAmpA   = new Float32Array(9);
    this.crackAmpB   = new Float32Array(9);
    this.exhaustAmpA = new Float32Array(9);
    this.exhaustAmpB = new Float32Array(9);

    /* Crack decay — only active above idle */
    this.crackDecayA = Math.exp(-10000 / sampleRate);
    this.crackDecayB = Math.exp(-8500  / sampleRate);

    this.exhaustDecay = Math.exp(-60 / sampleRate);
    this.noiseScale   = 0.18;

    /* Resonator 1 — fundamental (~56 Hz idle) */
    this.resCos = 1; this.resSin = 0;
    this.resX   = 0; this.resY   = 0;

    /* Resonator 2 — 9th harmonic (~506 Hz idle): exhaust rasp */
    this.res2R   = 0.80;
    this.res2Cos = 1; this.res2Sin = 0;
    this.res2X   = 0; this.res2Y   = 0;

    /* LFSR noise */
    this.lfsr = 0xACE1;

    this.noiseLp      = 0;
    this.noiseLpCoeff = 0;
    this.lpState      = 0;
    this.lpCoeff      = 0;

    /* Throttle-lerped params — initialised in _updateParams */
    this.bangBaseA    = 0;
    this.bangBaseB    = 0;
    this.bangDecayA   = 0;
    this.bangDecayB   = 0;
    this.exhaustBaseA = 0;
    this.exhaustBaseB = 0;
    this.crackMix     = 0;
    this.rawBangW     = 0;
    this.rawExhDirW   = 0;
    this.rawW         = 0;
    this.res1W        = 0;
    this.res2W        = 0;
    this.resR         = 0;

    this._updateDecay(this.rpm);
    this._updateParams(0);

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.rpm        !== undefined) { this.rpm = d.rpm; this._updateDecay(d.rpm); }
      if (d.masterGain !== undefined)   this.masterGain = d.masterGain;
      if (d.throttle   !== undefined) { this.throttle   = d.throttle; this._updateParams(d.throttle); }
    };
  }

  _lerp(a, b, t) { return a + (b - a) * t; }

  /* Recompute all throttle-varying coefficients.
     t=0 → synthesis-matched idle  |  t=1 → full power character */
  _updateParams(t) {
    const L = this._lerp.bind(this);

    /* Per-cylinder firing amplitudes */
    this.bangBaseA    = L(0.10, 0.50, t);
    this.bangBaseB    = L(0.09, 0.44, t);
    this.exhaustBaseA = L(0.55, 0.75, t);
    this.exhaustBaseB = L(0.52, 0.68, t);

    /* Bang decay (higher K = faster decay = synthesis-style subtle transient) */
    this.bangDecayA = Math.exp(-L(5500, 4500, t) / sampleRate);
    this.bangDecayB = Math.exp(-L(4800, 3800, t) / sampleRate);

    /* Crack: zero at idle, grows with power */
    this.crackMix = 0.14 * t;

    /* Raw signal composition */
    this.rawBangW    = L(0.40, 0.28, t);
    this.rawExhDirW  = L(0.00, 0.32, t);  // synthesis has no direct exhaust path

    /* Output mix weights (sum = 1 at both t=0 and t=1) */
    this.rawW  = L(0.05, 0.50, t);
    this.res1W = L(0.95, 0.32, t);
    this.res2W = L(0.00, 0.18, t);

    /* Resonator 1 Q: tight (synthesis) → broad (power) */
    this.resR = L(0.96, 0.86, t);

    /* LP filter bandwidths: narrow (synthesis) → wide (power) */
    this.noiseLpCoeff = Math.exp(-2 * Math.PI * L(900,  2200, t) / sampleRate);
    this.lpCoeff      = Math.exp(-2 * Math.PI * L(2000, 3500, t) / sampleRate);

    /* noiseScale — RPM-dependent overlap factor scaled by throttle */
    if (this._noiseBase !== undefined)
      this.noiseScale = L(0.22, 0.55, t) * this._noiseBase;
  }

  _updateDecay(rpm) {
    const cyclesPerSec   = rpm / 120;
    const firingInterval = sampleRate / (cyclesPerSec * 9);

    const tau = Math.min(firingInterval * 0.50, sampleRate * 0.022);
    this.exhaustDecay = Math.exp(-1 / tau);

    /* Store overlap factor — noiseScale coefficient lerps with throttle in _updateParams */
    const overlap   = Math.exp(-firingInterval / tau);
    this._noiseBase = 1 - overlap;
    this.noiseScale = this._lerp(0.22, 0.55, this.throttle) * this._noiseBase;

    /* Resonator 1: fundamental */
    const omega  = 2 * Math.PI * cyclesPerSec * 9 / sampleRate;
    this.resCos = Math.cos(omega);
    this.resSin = Math.sin(omega);

    /* Resonator 2: 9th harmonic */
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
          this.bangAmpA[c]    = this.gainA[c] * this.bangBaseA;
          this.crackAmpA[c]   = this.gainA[c] * 0.38;
          this.exhaustAmpA[c] = this.gainA[c] * this.exhaustBaseA;
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
          this.bangAmpB[c]    = this.gainB[c] * this.bangBaseB;
          this.crackAmpB[c]   = this.gainB[c] * 0.34;
          this.exhaustAmpB[c] = this.gainB[c] * this.exhaustBaseB;
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

      const raw = (bang    * this.rawBangW
                 + crack   * this.crackMix
                 + exhaust * this.rawExhDirW
                 + exhaust * this.noiseLp * this.noiseScale) * this.masterGain;

      /* Resonator 1 — fundamental */
      const nx  = this.resR * (this.resX * this.resCos - this.resY * this.resSin) + raw;
      const ny  = this.resR * (this.resX * this.resSin + this.resY * this.resCos);
      this.resX = nx; this.resY = ny;

      /* Resonator 2 — 9th harmonic */
      const nx2 = this.res2R * (this.res2X * this.res2Cos - this.res2Y * this.res2Sin) + raw;
      const ny2 = this.res2R * (this.res2X * this.res2Sin + this.res2Y * this.res2Cos);
      this.res2X = nx2; this.res2Y = ny2;

      const mixed  = raw * this.rawW + nx * this.res1W + nx2 * this.res2W;
      this.lpState = this.lpCoeff * this.lpState + (1 - this.lpCoeff) * mixed;
      out[i]       = this.lpState;
    }

    return true;
  }
}

registerProcessor('r2800-processor', R2800Processor);
