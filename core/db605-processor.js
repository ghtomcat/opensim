/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/db605-processor.js
   ═══════════════════════════════════════════════════════════════ */

class DB605Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.rpm        = 400;
    this.masterGain = 0.8;
    this.laderGain  = 0;
    this.laderFreq  = 663;

    this.crankAngle = 0;
    this.firingAngles  = [0, 60, 120, 180, 240, 300].map(a => (a + (Math.random() - 0.5) * 16) % 360);
    this.cylinderGains = Array.from({ length: 12 }, () => 0.4 + Math.random() * 1.2);

    this.transient  = 0;
    this.transDecay = Math.exp(-300 / sampleRate);   // ~15ms crack

    this.body       = 0;
    this.bodyDecay  = Math.exp(-55  / sampleRate);   // ~60ms puff

    const f0    = 45;
    const r     = 0.96;
    const omega = 2 * Math.PI * f0 / sampleRate;
    this.resR   = r;
    this.resCos = Math.cos(omega);
    this.resSin = Math.sin(omega);
    this.resX   = 0;
    this.resY   = 0;

    this.lfsr = 0xACE1;

    this.noiseScale = 0.2;
    this._updateBodyDecay(this.rpm);

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.rpm        !== undefined) { this.rpm = d.rpm; this._updateBodyDecay(d.rpm); }
      if (d.masterGain !== undefined) this.masterGain = d.masterGain;
      if (d.laderGain  !== undefined) this.laderGain  = d.laderGain;
      if (d.laderFreq  !== undefined) this.laderFreq  = d.laderFreq;
    };
  }

  _updateBodyDecay(rpm) {
    const firingInterval = sampleRate * 10 / rpm;
    const tau            = Math.max(firingInterval / 3, sampleRate * 0.003);
    this.bodyDecay       = Math.exp(-1 / tau);
    const overlap        = Math.exp(-firingInterval / tau);
    this.noiseScale      = 0.2 * (1 - overlap); // less noise when firings overlap more
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const degPerSample = this.rpm / 60 / sampleRate * 360;

    for (let i = 0; i < out.length; i++) {
      const prev      = this.crankAngle;
      this.crankAngle = (this.crankAngle + degPerSample) % 360;

      for (let c = 0; c < this.firingAngles.length; c++) {
        if (_crossed(prev, this.crankAngle, this.firingAngles[c])) {
          const amp       = this.cylinderGains[c % 12];
          this.transient += amp;
          this.body      += amp * 0.7;
        }
      }

      this.transient *= this.transDecay;
      this.body      *= this.bodyDecay;

      this.lfsr ^= this.lfsr << 13;
      this.lfsr ^= this.lfsr >> 17;
      this.lfsr ^= this.lfsr << 5;
      const noise = (this.lfsr & 0xFFFF) / 32768 - 1;

      const raw     = this.transient * 0.3 + this.body * noise * this.noiseScale;
      const nx      = this.resR * (this.resX * this.resCos - this.resY * this.resSin) + raw;
      const ny      = this.resR * (this.resX * this.resSin + this.resY * this.resCos);
      this.resX     = nx;
      this.resY     = ny;

      out[i] = (raw * 0.05 + nx * 0.95) * this.masterGain;
    }

    return true;
  }
}

function _crossed(prev, curr, target) {
  if (curr >= prev) return prev <= target && curr > target;
  return prev <= target || curr > target;
}

registerProcessor('db605-processor', DB605Processor);
