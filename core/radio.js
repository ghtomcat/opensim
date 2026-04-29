/* ═══════════════════════════════════════════════════════════════
   OpenSim — core/radio.js
   Historically accurate comm chain for mission audio.

   Usage:
     const chain = await createRadioChain(audioCtx, 'vhf-aviation');
     sourceNode.connect(chain.input);
     chain.output.connect(audioCtx.destination);
     chain.squelchTail();   // call when transmission ends
     chain.destroy();       // clean up when done

   Profiles: vhf-aviation, tower-quiet, sband-apollo, vhf-vostok, ip-spacex
   ═══════════════════════════════════════════════════════════════ */

/* ── Comm profile presets ── */
const PROFILES = {

  'vhf-aviation': {
    /* Standard aviation VHF 118–137 MHz — ATC + airborne */
    bandpass:      [350, 3400],     // Hz lo / hi
    presenceFreq:  2100,            // Hz centre of intelligibility boost
    presenceGain:  5,               // dB
    presenceQ:     0.9,
    carrierFreq:   1000,            // Hz carrier hum under voice
    carrierGain:   0.008,
    whineFreq:     400,             // Hz cockpit ambience whine
    whineGain:     0.005,
    noiseFloor:    0.022,           // broadband static level
    crackle:       0.018,
    burstLevel:    0.07,
    squelchTail:   true,
    outputGain:    0.92,
  },

  'tower-quiet': {
    /* Ground station transmitting — clean room, good equipment */
    bandpass:      [400, 3200],
    presenceFreq:  2000,
    presenceGain:  3,
    presenceQ:     0.7,
    carrierFreq:   1000,
    carrierGain:   0.004,
    whineFreq:     null,            // no cockpit whine
    whineGain:     0,
    noiseFloor:    0.010,
    crackle:       0.008,
    burstLevel:    0.04,
    squelchTail:   true,
    outputGain:    0.95,
  },

  'sband-apollo': {
    /* NASA S-band MSFN 2.1 GHz — cleaner than VHF but distinctive hiss */
    bandpass:      [300, 3000],
    presenceFreq:  1800,
    presenceGain:  4,
    presenceQ:     0.8,
    carrierFreq:   null,            // no carrier hum on S-band
    carrierGain:   0,
    whineFreq:     null,
    whineGain:     0,
    noiseFloor:    0.030,           // more hiss — long distance, 380 000 km
    crackle:       0.006,
    burstLevel:    0.12,            // occasional signal dropout
    squelchTail:   false,
    outputGain:    0.88,
  },

  'vhf-vostok': {
    /* Soviet VHF 143.625 MHz, 1961 military gear — narrow, harsh */
    bandpass:      [500, 2800],     // much narrower than Western VHF
    presenceFreq:  1600,
    presenceGain:  6,
    presenceQ:     1.4,             // peaky — cheap filter hardware
    carrierFreq:   300,             // low-pitched hum — Soviet power supply
    carrierGain:   0.015,
    whineFreq:     600,
    whineGain:     0.010,
    noiseFloor:    0.045,           // heavy noise floor
    crackle:       0.030,
    burstLevel:    0.14,
    squelchTail:   true,
    outputGain:    0.80,
  },

  'ip-spacex': {
    /* SpaceX IP backbone — near-phone quality voice, very clean */
    bandpass:      [200, 7000],
    presenceFreq:  3000,
    presenceGain:  2,
    presenceQ:     0.5,
    carrierFreq:   null,
    carrierGain:   0,
    whineFreq:     null,
    whineGain:     0,
    noiseFloor:    0.001,
    crackle:       0,
    burstLevel:    0,
    squelchTail:   false,
    outputGain:    1.0,
  },

  'arc-5': {
    /* Vought ARC-5 AM receiver, VHF 105–145 MHz — WWII US Navy fighter
       South Pacific, November 1943. R-2800 ignition bleeds at 135 Hz.
       400 Hz inverter hum. Tropical atmospheric static. Tube soft-clip. */
    bandpass:      [360, 2400],     // AM voice, narrower than modern VHF
    presenceFreq:  1400,            // AM intelligibility peak — lower than VHF
    presenceGain:  9,               // dB — strong tube presence
    presenceQ:     1.8,             // peaky — hardwired LC filter hardware
    carrierFreq:   400,             // 400 Hz — US Navy 400 Hz AC inverter hum
    carrierGain:   0.020,
    whineFreq:     135,             // R-2800 ignition rate at 1800 RPM cruise (9 × 1800/120)
    whineGain:     0.014,
    noiseFloor:    0.065,           // South Pacific atmospheric static
    crackle:       0.052,
    burstLevel:    0.22,            // tropical dropouts
    squelchTail:   true,
    saturation:    120,             // tube soft-clip amount (0 = bypass)
    outputGain:    0.76,
  },

};

/* ── Worklet registration guard ── */
let _workletLoaded = false;

async function _ensureWorklet(ctx) {
  if (_workletLoaded) return;
  await ctx.audioWorklet.addModule('./core/radio-crackle-processor.js');
  _workletLoaded = true;
}

/* ── createRadioChain ──────────────────────────────────────────
   Returns { input, output, squelchTail(), destroy() }
   Caller connects: source → chain.input, chain.output → destination
   ─────────────────────────────────────────────────────────────── */
export async function createRadioChain(ctx, profileName = 'vhf-aviation') {
  const p = PROFILES[profileName] ?? PROFILES['vhf-aviation'];

  await _ensureWorklet(ctx);

  const nodes = [];

  /* ── Input gain (entry point for caller) ── */
  const input = ctx.createGain();
  input.gain.value = 1.0;
  nodes.push(input);

  /* ── Bandpass lo-cut (highpass) ── */
  const hpf = ctx.createBiquadFilter();
  hpf.type            = 'highpass';
  hpf.frequency.value = p.bandpass[0];
  hpf.Q.value         = 0.7;
  nodes.push(hpf);

  /* ── Bandpass hi-cut (lowpass) ── */
  const lpf = ctx.createBiquadFilter();
  lpf.type            = 'lowpass';
  lpf.frequency.value = p.bandpass[1];
  lpf.Q.value         = 0.7;
  nodes.push(lpf);

  /* ── Presence boost — intelligibility peak ── */
  const presence = ctx.createBiquadFilter();
  presence.type            = 'peaking';
  presence.frequency.value = p.presenceFreq;
  presence.gain.value      = p.presenceGain;
  presence.Q.value         = p.presenceQ;
  nodes.push(presence);

  /* ── Noise floor (broadband static under voice) ── */
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const noiseData   = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop   = true;
  const noiseGain    = ctx.createGain();
  noiseGain.gain.value = p.noiseFloor;
  noiseSource.connect(noiseGain);
  noiseSource.start();

  /* ── Carrier hum (1000 Hz) ── */
  let carrierOsc = null;
  if (p.carrierFreq) {
    carrierOsc = ctx.createOscillator();
    carrierOsc.type            = 'sine';
    carrierOsc.frequency.value = p.carrierFreq;
    const carrierGain          = ctx.createGain();
    carrierGain.gain.value     = p.carrierGain;
    carrierOsc.connect(carrierGain);
    carrierGain.connect(presence);   // inject into chain after filters
    carrierOsc.start();
    nodes.push(carrierOsc);
  }

  /* ── Cockpit whine ── */
  let whineOsc = null;
  if (p.whineFreq) {
    whineOsc = ctx.createOscillator();
    whineOsc.type            = 'sine';
    whineOsc.frequency.value = p.whineFreq;
    const whineGain          = ctx.createGain();
    whineGain.gain.value     = p.whineGain;
    whineOsc.connect(whineGain);
    whineGain.connect(presence);
    whineOsc.start();
    nodes.push(whineOsc);
  }

  /* ── Crackle / static bursts (AudioWorklet) ── */
  let crackleNode = null;
  try {
    crackleNode = new AudioWorkletNode(ctx, 'radio-crackle-processor', {
      parameterData: { crackleLevel: p.crackle, burstLevel: p.burstLevel },
    });
  } catch (e) {
    console.warn('[radio] crackle worklet unavailable:', e.message);
  }

  /* ── Tube saturation (optional) — warm even-harmonic soft-clip ── */
  let satNode = null;
  if (p.saturation > 0) {
    satNode = ctx.createWaveShaper();
    const n = 512, k = p.saturation;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * 2 / (n - 1) - 1;
      curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
    }
    satNode.curve     = curve;
    satNode.oversample = '2x';
    nodes.push(satNode);
  }

  /* ── Output gain ── */
  const output = ctx.createGain();
  output.gain.value = p.outputGain;

  /* ── Wire the chain ──
     input → hpf → lpf → presence → [saturation] → output
     noiseFloor ─────────────────────────────────────────┘
     crackle ─────────────────────────────────────────────┘
  ── */
  input.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(presence);
  if (satNode) { presence.connect(satNode); satNode.connect(output); }
  else           presence.connect(output);
  noiseGain.connect(output);
  if (crackleNode) crackleNode.connect(output);

  /* ── Squelch tail ── */
  function squelchTail() {
    if (!p.squelchTail || !crackleNode) return;
    crackleNode.port.postMessage({ squelchTail: true });
  }

  /* ── Destroy — disconnect everything ── */
  function destroy() {
    try { noiseSource.stop(); } catch {}
    try { carrierOsc?.stop(); } catch {}
    try { whineOsc?.stop(); } catch {}
    try { crackleNode?.disconnect(); } catch {}
    nodes.forEach(n => { try { n.disconnect(); } catch {} });
  }

  return { input, output, squelchTail, destroy };
}

/* ── playThroughChain ──────────────────────────────────────────
   Convenience: fetch an MP3, decode, play through a radio chain.
   Returns a stop() function.
   profileName: commProfile string (default 'vhf-aviation')
   envBleedNode: optional AudioNode to mix in as environment (e.g. engine tap)
   ─────────────────────────────────────────────────────────────── */
export async function playThroughChain(ctx, url, {
  profileName  = 'vhf-aviation',
  destination  = ctx.destination,
  envBleedNode = null,
  bleedLevel   = 0.08,
  onEnded      = null,
} = {}) {

  const [chain, resp] = await Promise.all([
    createRadioChain(ctx, profileName),
    fetch(url),
  ]);

  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await ctx.decodeAudioData(arrayBuf);

  const source = ctx.createBufferSource();
  source.buffer = audioBuf;

  source.connect(chain.input);

  /* Environment bleed — e.g. engine tap mixed under received voice */
  if (envBleedNode) {
    const bleedGain = ctx.createGain();
    bleedGain.gain.value = bleedLevel;
    envBleedNode.connect(bleedGain);
    bleedGain.connect(chain.output);
  }

  chain.output.connect(destination);
  source.start();

  source.onended = () => {
    chain.squelchTail();
    setTimeout(() => chain.destroy(), 400);
    onEnded?.();
  };

  return {
    stop() {
      try { source.stop(); } catch {}
      chain.squelchTail();
      setTimeout(() => chain.destroy(), 400);
    },
  };
}

export { PROFILES };
