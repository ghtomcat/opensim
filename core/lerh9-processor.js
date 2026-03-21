/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/lerh9-processor.js
   Le Rhône 9J rotary engine — AudioWorklet physical model

   Built from first principles — the steam engine model:
   Intake (silence) → Compression (silence) → Bang → Exhaust (pffft)

   Start: 1 cylinder, 60 RPM, hear each pffft individually.
   ═══════════════════════════════════════════════════════════════ */

class LeRh9Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.rpm        = 60;
    this.masterGain = 0.8;

    /* 9 cylinders — firing events at 80° spacing in 720° cycle */
    this.angle = 0;
    this.firingAngles  = Array.from({ length: 9 }, (_, i) =>
      ((i * 80) + (Math.random() - 0.5) * 18) % 720
    );
    this.cylinderGains = Array.from({ length: 9 }, () => 0.3 + Math.random() * 1.4);

    /* Bang — sharp transient */
    this.bangDecay = Math.exp(-8000 / sampleRate);   // ~0.3ms — ultra kurz
    this.bangAmp   = new Float32Array(9);

    /* Exhaust — broadband pffffft, duration scales with RPM */
    this.exhaustAmp   = new Float32Array(9);
    this.exhaustDecay = Math.exp(-80 / sampleRate);  // updated by _updateDecay

    /* LFSR noise for exhaust character */
    this.lfsr = 0xACE1;

    /* Gyro whirr — rotating cylinder mass, 1× rotation frequency */
    this.spinPhase = 0;

    /* Blip switch — ignition cut at low throttle */
    this.throttle   = 1.0;
    this.blipOn     = true;   // ignition state
    this.blipTimer  = 0;      // samples until next state change

    /* Noise lowpass — smooths the LFSR into soft air sound */
    this.noiseLp = 0;
    this.noiseLpCoeff = Math.exp(-2 * Math.PI * 3000 / sampleRate); // 3000 Hz — open

    /* Output lowpass — just remove digital harshness */
    this.lpState = 0;
    this.lpCoeff = Math.exp(-2 * Math.PI * 2000 / sampleRate); // 2000 Hz cutoff

    this._updateDecay(this.rpm);

    this.port.onmessage = (e) => {
      if (e.data.rpm        !== undefined) { this.rpm = e.data.rpm; this._updateDecay(this.rpm); }
      if (e.data.masterGain !== undefined) this.masterGain = e.data.masterGain;
      if (e.data.throttle   !== undefined) this.throttle   = e.data.throttle;
    };
  }

  _updateDecay(rpm) {
    /* Exhaust duration must stay below firing interval to keep silence between pffft */
    const firingInterval = sampleRate / Math.max(1, rpm / 60 * 4.5);
    const tau = Math.min(firingInterval * 0.35, sampleRate * 0.035); // max 35ms
    this.exhaustDecay = Math.exp(-1 / tau);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    /* 4-stroke = 720° per 2 crankshaft revolutions */
    const degsPerSample = this.rpm * 720 / 60 / sampleRate;

    for (let i = 0; i < out.length; i++) {
      const prev  = this.angle;
      this.angle  = (this.angle + degsPerSample) % 720;

      /* Blip switch — at low throttle, cut ignition in bursts */
      if (this.throttle < 0.3) {
        this.blipTimer--;
        if (this.blipTimer <= 0) {
          this.blipOn    = !this.blipOn;
          /* On = 20-60ms power, Off = 30-80ms cut */
          const ms       = this.blipOn ? (20 + Math.random() * 40) : (30 + Math.random() * 50);
          this.blipTimer = Math.round(ms * sampleRate / 1000);
        }
      } else {
        this.blipOn = true;
      }

      /* Check each cylinder for firing */
      for (let c = 0; c < 9; c++) {
        const fa = this.firingAngles[c];
        const crossed = (prev < fa && this.angle >= fa) ||
                        (prev > this.angle && (fa >= prev || fa < this.angle));
        if (crossed && this.blipOn) {
          this.bangAmp[c]    = this.cylinderGains[c] * 0.05;
          this.exhaustAmp[c] = this.cylinderGains[c] * 0.3;
        }
        /* Exhaust builds up briefly before decaying — soft onset */
        const target = this.bangAmp[c] * 0.9;
        if (this.exhaustAmp[c] < target) this.exhaustAmp[c] += (target - this.exhaustAmp[c]) * 0.08;
        this.bangAmp[c]    *= this.bangDecay;
        this.exhaustAmp[c] *= this.exhaustDecay;
      }

      /* Sum all cylinders */
      this.lfsr ^= this.lfsr << 13;
      this.lfsr ^= this.lfsr >> 17;
      this.lfsr ^= this.lfsr << 5;
      const raw_noise = (this.lfsr & 0xFFFF) / 0x8000 - 1;
      this.noiseLp = this.noiseLpCoeff * this.noiseLp + (1 - this.noiseLpCoeff) * raw_noise;
      const noise = this.noiseLp;

      let bang = 0, exhaust = 0;
      for (let c = 0; c < 9; c++) {
        bang    += this.bangAmp[c];
        exhaust += this.exhaustAmp[c];
      }

      /* Gyro whirr — 1× rotation frequency, subtle */
      const spinFreq = this.rpm / 60;
      this.spinPhase = (this.spinPhase + 2 * Math.PI * spinFreq / sampleRate) % (2 * Math.PI);
      const spin = Math.sin(this.spinPhase) * 0.04 * this.masterGain;

      const raw = exhaust * noise * this.masterGain + spin;
      this.lpState = this.lpCoeff * this.lpState + (1 - this.lpCoeff) * raw;
      out[i] = this.lpState;
    }
    return true;
  }
}

registerProcessor('lerh9-processor', LeRh9Processor);
