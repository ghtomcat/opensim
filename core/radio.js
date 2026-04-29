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

  'capsule-dragon': {
    /* Dragon capsule intercom — Bose A20-style headset, close-mic.
       Internal crew callouts: no beep, no carrier, very clean.
       Slight presence peak around the intelligibility band. */
    bandpass:      [300, 8000],
    presenceFreq:  2500,
    presenceGain:  3,
    presenceQ:     0.6,
    carrierFreq:   null,
    carrierGain:   0,
    whineFreq:     null,
    whineGain:     0,
    noiseFloor:    0.003,
    crackle:       0.001,
    burstLevel:    0,
    squelchTail:   false,
    outputGain:    0.96,
  },

  'ip-spacex-crew': {
    /* Dragon crew outgoing comms — mic inside sealed helmet, Comm1 IP link.
       Helmet cavity cuts lows hard, creates boxy 2-3kHz resonance (tinny).
       Life-support fan bleed comes via COCKPIT_PROFILES in crew.js. */
    bandpass:      [500, 4500],
    presenceFreq:  2600,
    presenceGain:  7,
    presenceQ:     1.4,
    carrierFreq:   null,
    carrierGain:   0,
    whineFreq:     null,
    whineGain:     0,
    noiseFloor:    0.012,
    crackle:       0.005,
    burstLevel:    0.015,
    squelchTail:   false,
    outputGain:    0.90,
    commBeep:      { freq: 2000, durationMs: 280, gain: 0.46 },
  },

  'ip-spacex-narrate': {
    /* SpaceX webcast narration — same chain as ip-spacex, no PTT beep */
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
    commBeep:      { freq: 2000, durationMs: 280, gain: 0.46 },  // SpaceX PTT tone — measured 1975Hz/280ms from webcast 1:09:53
  },

  'cockpit-bf109': {
    /* Lorenz FuG 16 VHF AM, 38–42 MHz — Bf 109 South/Eastern Front 1942.
       50 Hz European power hum. Arctic atmospheric static. Tube soft-clip.
       No squelch — 1940s AM hardware. Narrow voice bandwidth. */
    bandpass:      [380, 2600],     // narrow AM voice — narrower than modern VHF
    presenceFreq:  1300,            // lower intelligibility peak — older AM
    presenceGain:  8,               // dB — strong tube presence
    presenceQ:     1.6,             // peaky — German LC filter hardware
    carrierFreq:   50,              // 50 Hz — European power grid hum
    carrierGain:   0.018,
    whineFreq:     150,             // DB 605 ignition rate at cruise RPM
    whineGain:     0.012,
    noiseFloor:    0.055,           // Arctic atmospheric static
    crackle:       0.042,
    burstLevel:    0.18,            // terrain masking dropouts at low altitude
    squelchTail:   false,           // no squelch on 1940s AM
    saturation:    100,             // tube soft-clip
    outputGain:    0.78,
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

/* ── Worklet registration guard — tracked per AudioContext ── */
const _workletContexts = new WeakSet();

async function _ensureWorklet(ctx) {
  if (_workletContexts.has(ctx)) return;
  await ctx.audioWorklet.addModule('./core/radio-crackle-processor.js');
  _workletContexts.add(ctx);
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

  /* Broadcast bypass — narrators play completely dry, no chain */
  if (profileName === 'broadcast') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`404: ${url}`);
    const audioBuf = await ctx.decodeAudioData(await resp.arrayBuffer());
    const source   = ctx.createBufferSource();
    const out      = ctx.createGain();
    source.buffer  = audioBuf;
    source.connect(out);
    out.connect(destination);
    source.start();
    source.onended = () => { try { out.disconnect(); } catch {} onEnded?.(); };
    return { stop() { try { source.stop(); } catch {} try { out.disconnect(); } catch {} } };
  }

  const [chain, resp] = await Promise.all([
    createRadioChain(ctx, profileName),
    fetch(url),
  ]);

  if (!resp.ok) throw new Error(`404: ${url}`);
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

  /* Comm beep — short PTT tone through the same radio chain before the voice */
  const p = PROFILES[profileName] ?? PROFILES['vhf-aviation'];
  let voiceOffset = 0;
  if (p.commBeep) {
    const b       = p.commBeep;
    const pk      = b.gain ?? 0.45;
    const attack  = 0.010;                          // 10 ms ramp up
    const sustain = 0.225;                          // 225 ms hold
    const decay   = 0.045;                          // 45 ms fade out
    const beepDur = attack + sustain + decay;
    const beepOsc  = ctx.createOscillator();
    const beepGain = ctx.createGain();
    beepOsc.type = 'sine';
    beepOsc.frequency.value = b.freq ?? 900;
    const t0 = ctx.currentTime;
    beepGain.gain.setValueAtTime(0.0001, t0);
    beepGain.gain.linearRampToValueAtTime(pk,     t0 + attack);
    beepGain.gain.setValueAtTime(pk,              t0 + attack + sustain);
    beepGain.gain.exponentialRampToValueAtTime(0.0001, t0 + beepDur);
    beepOsc.connect(beepGain);
    beepGain.connect(chain.input);
    beepOsc.start(t0);
    beepOsc.stop(t0 + beepDur + 0.005);
    voiceOffset = beepDur + 0.03;
  }

  source.start(ctx.currentTime + voiceOffset);

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
