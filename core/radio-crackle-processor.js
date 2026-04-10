/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/radio-crackle-processor.js
   AudioWorklet: per-sample crackle, static bursts, squelch tail.
   ═══════════════════════════════════════════════════════════════ */

class RadioCrackleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._burstTimer   = 0;   // samples until next static burst
    this._burstLen     = 0;   // samples remaining in current burst
    this._squelchTimer = 0;   // samples of squelch tail remaining
    this.port.onmessage = (e) => {
      if (e.data.squelchTail) this._squelchTimer = Math.floor(sampleRate * 0.18);
    };
  }

  process(inputs, outputs, parameters) {
    const out        = outputs[0][0];
    const crackle    = parameters.crackleLevel[0] ?? 0.018;
    const burstLevel = parameters.burstLevel[0]   ?? 0.08;

    for (let i = 0; i < out.length; i++) {
      let sample = 0;

      /* Random crackle — sparse, sharp pops */
      if (Math.random() < crackle) {
        sample += (Math.random() * 2 - 1) * 0.9;
      }

      /* Static burst — periodic noise surge */
      if (this._burstLen > 0) {
        sample += (Math.random() * 2 - 1) * burstLevel;
        this._burstLen--;
      } else {
        this._burstTimer--;
        if (this._burstTimer <= 0) {
          /* Next burst: random interval 1–8s, length 40–200ms */
          this._burstTimer = Math.floor(sampleRate * (1 + Math.random() * 7));
          this._burstLen   = Math.floor(sampleRate * (0.04 + Math.random() * 0.16));
        }
      }

      /* Squelch tail — white noise burst at transmission end */
      if (this._squelchTimer > 0) {
        const env = this._squelchTimer / Math.floor(sampleRate * 0.18);
        sample += (Math.random() * 2 - 1) * 0.55 * env;
        this._squelchTimer--;
      }

      out[i] = Math.max(-1, Math.min(1, sample));
    }

    return true;
  }

  static get parameterDescriptors() {
    return [
      { name: 'crackleLevel', defaultValue: 0.018, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'burstLevel',   defaultValue: 0.08,  minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
}

registerProcessor('radio-crackle-processor', RadioCrackleProcessor);
