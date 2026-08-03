/* ============================================================
   Tardigrade Simulator - synthesised spatial audio + adaptive music

   100% Web Audio synthesis. There is not a single sample file in
   this game: every footstep, impact, squeak, bird, gust of wind and
   note of music is built at runtime from oscillators, procedurally
   filled noise buffers and filters.

   ------------------------------------------------------------
   SIGNAL FLOW
   ------------------------------------------------------------
       one-shots -> [panner] -> sfxBus ---------.
       ambience  -> [panner] -> ambientBus -> ambientDuck -.
       music     ->            musicBus    -> musicDuck ---+-> masterGain
                                                           |
                       sfxBus -> reverbSend -> convolver --'
                                                           |
       masterGain -> limiter (compressor) -> softClip (tanh) -> destination
                                                           `-> analyser (tap)

   The tanh soft-clipper is a hard mathematical guarantee that the
   output can never reach 0 dBFS, whatever twenty simultaneous
   collisions try to do to the bus.

   ------------------------------------------------------------
   HOUSE RULES OBSERVED HERE
   ------------------------------------------------------------
   * No Math.random(). A private mulberry32 stream is seeded from
     `ctx.rng` once at construction. It is deliberately *private*:
     audio randomness is driven by real time and frame rate, so
     drawing from the shared world PRNG every frame would destroy
     the frame-for-frame reproducibility the screenshot review
     depends on. One draw at startup keeps us seeded off the world
     seed without perturbing anybody mid-run.
   * The AudioContext is created lazily on the first real user
     gesture. Constructing one earlier makes Chrome log an autoplay
     warning on every load, and we do not spam the console.
   * If Web Audio is unavailable, blocked, or the tab is muted, every
     entry point becomes a cheap no-op. The game must never break
     because audio could not start.
   * Nothing allocates per frame beyond what Web Audio requires.
     Noise buffers are built once per context, PannerNodes are
     pooled, and finished voices are swept and disconnected.

   ------------------------------------------------------------
   PUBLIC API (other systems may rely on all of this)
   ------------------------------------------------------------
     play(name, opts)                 -> voice | null   (2D)
     playAt(name, position, opts)     -> voice | null   (3D)
     setWind(strength01)
     duck(amount01, seconds)
     setSurface(materialName)         hint for footsteps/rolling
     setRolling(active, speed, surface)
     setWaterSource(position, radius) where the puddle ambience sits
     unlock() / suspend() / resume()
     renderPreview(kind, seconds)     -> { sampleRate, wav } (base64)
     report()
   ============================================================ */

import { clamp, clamp01, lerp, makeRng, TAU } from "./core.js";

/* ------------------------------------------------------------------ */
/* 1. Tuning tables                                                    */
/* ------------------------------------------------------------------ */

/** Concurrent voices allowed per category. Overflow steals the quietest. */
const VOICE_CAPS = {
  impact: 8,
  foot: 6,
  vocal: 3,
  ui: 4,
  ambient: 12,
  misc: 6,
};
const TOTAL_VOICE_CAP = 40;

/**
 * Distance presets. The map is ~900 units across and the hero is 1.6
 * units long, with the chase camera ~8 units out - so "near" has to
 * fall off fast enough to localise a footstep, while "far" has to
 * still carry a bird from the other side of the garden.
 */
const DISTANCE_PRESETS = {
  near: { refDistance: 4, rolloffFactor: 1.15, maxDistance: 220, hrtf: true },
  mid: { refDistance: 7, rolloffFactor: 0.9, maxDistance: 420, hrtf: true },
  far: { refDistance: 45, rolloffFactor: 0.55, maxDistance: 900, hrtf: false },
};

/**
 * Impact voices. `modes` are resonant partials [freq, gain, decay];
 * `noise` is the strike transient; `thump` is the body/sub.
 * These are what make ceramic and gravel unmistakably different.
 */
const IMPACT_PROFILES = {
  soil: {
    modes: [],
    noise: { band: 300, q: 0.7, decay: 0.09, gain: 0.9, sweep: 0.55 },
    thump: { freq: 90, decay: 0.1, gain: 0.6 },
    click: 0.05, lowpass: [600, 2600],
  },
  moss: {
    modes: [],
    noise: { band: 760, q: 0.6, decay: 0.05, gain: 0.5, sweep: 0.7 },
    thump: { freq: 124, decay: 0.05, gain: 0.22 },
    click: 0.02, lowpass: [500, 2000],
  },
  gravel: {
    modes: [[2400, 0.14, 0.05], [3350, 0.09, 0.035]],
    noise: { band: 1900, q: 1.4, decay: 0.055, gain: 1, sweep: 0.5 },
    thump: { freq: 130, decay: 0.05, gain: 0.32 },
    click: 0.35, scatter: 5, lowpass: [1400, 11000],
  },
  leaf: {
    modes: [],
    noise: { band: 3200, q: 0.8, decay: 0.05, gain: 0.85, sweep: 0.8 },
    thump: null,
    click: 0.2, crinkle: 7, lowpass: [2200, 13000],
  },
  bark: {
    modes: [[520, 0.2, 0.09], [1240, 0.09, 0.05]],
    noise: { band: 900, q: 1, decay: 0.07, gain: 0.7, sweep: 0.6 },
    thump: { freq: 112, decay: 0.07, gain: 0.36 },
    click: 0.14, lowpass: [800, 5200],
  },
  stone: {
    modes: [[1150, 0.3, 0.14], [2100, 0.15, 0.09], [3400, 0.07, 0.05]],
    noise: { band: 1500, q: 1.2, decay: 0.045, gain: 0.8, sweep: 0.5 },
    thump: { freq: 95, decay: 0.09, gain: 0.62 },
    click: 0.25, lowpass: [1100, 9000],
  },
  concrete: {
    modes: [[820, 0.18, 0.07], [1560, 0.08, 0.04]],
    noise: { band: 1100, q: 0.9, decay: 0.04, gain: 0.8, sweep: 0.5 },
    thump: { freq: 82, decay: 0.11, gain: 0.75 },
    click: 0.2, lowpass: [900, 7200],
  },
  ceramic: {
    modes: [[1780, 0.5, 0.55], [2960, 0.34, 0.42], [4380, 0.2, 0.3], [6100, 0.1, 0.2]],
    noise: { band: 4200, q: 1.6, decay: 0.02, gain: 0.45, sweep: 0.9 },
    thump: { freq: 152, decay: 0.03, gain: 0.2 },
    click: 0.5, lowpass: [2600, 15000],
  },
  metal: {
    modes: [[430, 0.4, 0.9], [1211, 0.3, 0.75], [2637, 0.24, 0.6], [4890, 0.15, 0.45], [7301, 0.07, 0.3]],
    noise: { band: 3000, q: 1.2, decay: 0.03, gain: 0.5, sweep: 0.8 },
    thump: { freq: 118, decay: 0.05, gain: 0.3 },
    click: 0.45, lowpass: [2200, 15000],
  },
  paintedWood: {
    modes: [[380, 0.3, 0.16], [940, 0.16, 0.1], [1610, 0.06, 0.05]],
    noise: { band: 800, q: 1, decay: 0.05, gain: 0.7, sweep: 0.6 },
    thump: { freq: 120, decay: 0.09, gain: 0.5 },
    click: 0.18, lowpass: [700, 5600],
  },
  plastic: {
    modes: [[1600, 0.28, 0.09], [2700, 0.14, 0.06]],
    noise: { band: 2200, q: 1.1, decay: 0.03, gain: 0.6, sweep: 0.7 },
    thump: { freq: 180, decay: 0.04, gain: 0.26 },
    click: 0.4, lowpass: [1600, 11000],
  },
  water: {
    modes: [],
    noise: { band: 1800, q: 0.8, decay: 0.22, gain: 1, sweep: 0.22 },
    thump: { freq: 140, decay: 0.06, gain: 0.2 },
    click: 0, splash: 4, lowpass: [1200, 9000],
  },
  chitin: {
    modes: [[900, 0.3, 0.06], [1700, 0.16, 0.04]],
    noise: { band: 1400, q: 1.1, decay: 0.035, gain: 0.6, sweep: 0.7 },
    thump: { freq: 160, decay: 0.05, gain: 0.28 },
    click: 0.3, lowpass: [1200, 9000],
  },
  glass: {
    modes: [[2400, 0.5, 0.5], [3900, 0.35, 0.4], [5600, 0.24, 0.3], [8100, 0.11, 0.2]],
    noise: { band: 6000, q: 2, decay: 0.015, gain: 0.42, sweep: 1 },
    thump: null,
    click: 0.6, lowpass: [3200, 16000],
  },
};
const IMPACT_MATERIALS = Object.keys(IMPACT_PROFILES);

/**
 * Eight legs means a *patter*, not a thump. Each gait beat fires a
 * cluster of `grains` micro-ticks smeared over `spread` seconds with
 * randomised pitch and position - that scatter is the signature.
 */
const STEP_PROFILES = {
  soil: { band: 520, q: 0.9, decay: 0.028, gain: 0.5, grains: 4, spread: 0.05, tilt: -3, jitter: 0.22 },
  moss: { band: 900, q: 0.6, decay: 0.03, gain: 0.36, grains: 5, spread: 0.055, tilt: -2, jitter: 0.3 },
  gravel: { band: 2100, q: 1.5, decay: 0.02, gain: 0.6, grains: 5, spread: 0.06, tilt: 2, jitter: 0.34, ping: 0.3 },
  concrete: { band: 2600, q: 2.2, decay: 0.016, gain: 0.44, grains: 4, spread: 0.042, tilt: 3, jitter: 0.2, ping: 0.18 },
  stone: { band: 2400, q: 2, decay: 0.018, gain: 0.46, grains: 4, spread: 0.045, tilt: 2, jitter: 0.22, ping: 0.22 },
  ceramic: { band: 3300, q: 3, decay: 0.02, gain: 0.42, grains: 4, spread: 0.04, tilt: 4, jitter: 0.2, ping: 0.4 },
  leaf: { band: 3400, q: 0.7, decay: 0.03, gain: 0.5, grains: 7, spread: 0.07, tilt: 4, jitter: 0.4 },
  bark: { band: 1300, q: 1, decay: 0.03, gain: 0.44, grains: 5, spread: 0.055, tilt: 0, jitter: 0.28 },
  paintedWood: { band: 1500, q: 1.4, decay: 0.024, gain: 0.44, grains: 4, spread: 0.05, tilt: 1, jitter: 0.24 },
  plastic: { band: 2800, q: 1.8, decay: 0.018, gain: 0.4, grains: 4, spread: 0.045, tilt: 3, jitter: 0.24, ping: 0.24 },
  metal: { band: 3000, q: 3.4, decay: 0.05, gain: 0.4, grains: 4, spread: 0.05, tilt: 4, jitter: 0.26, ping: 0.55 },
  glass: { band: 4200, q: 3.2, decay: 0.03, gain: 0.36, grains: 4, spread: 0.04, tilt: 5, jitter: 0.2, ping: 0.5 },
  water: { band: 900, q: 0.8, decay: 0.06, gain: 0.55, grains: 3, spread: 0.07, tilt: -2, jitter: 0.3, wet: true },
  chitin: { band: 1900, q: 1.6, decay: 0.02, gain: 0.4, grains: 4, spread: 0.045, tilt: 2, jitter: 0.24 },
};

/**
 * Formant tables. Human vowels scaled up hard - a half-millimetre
 * animal has a tiny resonant cavity, so everything sits an octave
 * or so above a person and reads as "small and cross".
 */
const FORMANT_SCALE = 1.95;
const VOWELS = {
  ee: [270, 2290, 3010],
  eh: [530, 1840, 2480],
  ah: [730, 1090, 2440],
  oh: [570, 840, 2410],
  oo: [300, 870, 2240],
  uh: [640, 1190, 2390],
};

/** Every named vocal the creature owns. */
const VOCALS = {
  squeak: { vowel: "ee", f0: [640, 1000, 780], dur: 0.12, vib: [26, 0.035], gain: 0.55, breath: 0.05 },
  chirp: { vowel: "ee", f0: [700, 900, 1180], dur: 0.15, vib: [18, 0.02], gain: 0.5, breath: 0.03 },
  grunt: { vowel: "uh", f0: [230, 190, 165], dur: 0.18, vib: [9, 0.02], gain: 0.6, breath: 0.16, dark: true },
  yelp: { vowel: "ah", f0: [520, 1320, 430], dur: 0.42, vib: [14, 0.09], gain: 0.85, breath: 0.06, hold: 0.18 },
  moan: { vowel: "oo", f0: [340, 300, 250], dur: 0.5, vib: [6, 0.03], gain: 0.42, breath: 0.1, dark: true },
  purr: { vowel: "uh", f0: [180, 172, 178], dur: 0.6, vib: [31, 0.06], gain: 0.34, breath: 0.12, dark: true },
  huff: { vowel: "oh", f0: [300, 260, 230], dur: 0.14, vib: [8, 0.01], gain: 0.4, breath: 0.55 },
  giggle: { vowel: "ee", f0: [780, 940, 820], dur: 0.09, vib: [40, 0.06], gain: 0.42, breath: 0.04 },
};

/** Named one-shot -> synth routing. Anything not listed falls back to a blip. */
const SOUND_ALIASES = {
  step: "scuttle",
  footstep: "scuttle",
  land: "land",
  jump: "jump",
};

/* Pentatonic-with-attitude. Lydian #4 is the "slightly unhinged" bit. */
const SCALE_MAJOR_PENT = [0, 2, 4, 7, 9];
const SCALE_LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const CHORD_CYCLE = [0, 9, 5, 7]; // I - vi - IV - V, in semitones from the root

const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* ------------------------------------------------------------------ */
/* 2. WAV export (dev/QA affordance for offline previews)              */
/* ------------------------------------------------------------------ */

function encodeWavBase64(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const total = 44 + frames * channels * 2;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const ascii = (off, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(off + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, total - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * channels * 2, true);

  const data = [];
  for (let c = 0; c < channels; c += 1) data.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const s = clamp(data[c][i], -1, 1);
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* 3. The graph                                                        */
/* ------------------------------------------------------------------ */

function makeNoiseBuffer(ac, seconds, rng, pinkness) {
  const frames = Math.max(1, Math.floor(seconds * ac.sampleRate));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  if (!pinkness) {
    for (let i = 0; i < frames; i += 1) data[i] = rng() * 2 - 1;
    return buffer;
  }
  // Paul Kellet's economy pink filter - cheap and good enough for wind beds.
  let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
  for (let i = 0; i < frames; i += 1) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    data[i] = clamp(pink, -1, 1);
  }
  return buffer;
}

/** Short, bright, garden-sized early-reflection tail. Not a cathedral. */
function makeImpulse(ac, seconds, decay, rng) {
  const frames = Math.max(1, Math.floor(seconds * ac.sampleRate));
  const buffer = ac.createBuffer(2, frames, ac.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i += 1) {
      const t = i / frames;
      // A couple of discrete slaps in the first 30ms sell "outdoors, near stuff".
      const slap = (i > frames * 0.02 && i < frames * 0.03) || (i > frames * 0.06 && i < frames * 0.072) ? 1.9 : 1;
      data[i] = (rng() * 2 - 1) * Math.pow(1 - t, decay) * slap;
    }
  }
  return buffer;
}

function makeSoftClipCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.35) * 0.96;
  }
  return curve;
}

/**
 * Builds the whole mixer for a given BaseAudioContext. Used twice:
 * once for the live context and once per OfflineAudioContext render,
 * which is why nothing in here touches module-level mutable state.
 */
function buildGraph(ac, rng, options = {}) {
  const reverb = options.reverb !== false;

  const graph = {
    ac,
    rng,
    live: Boolean(options.live),
    spatial: typeof ac.createPanner === "function",
    hrtf: options.hrtf !== false,
    voices: [],
    pending: [],
    pannerPools: { HRTF: [], equalpower: [] },
    spawned: 0,
    released: 0,
    stolen: 0,
    refused: 0,
    peakVoices: 0,
  };

  const master = ac.createGain();
  master.gain.value = options.masterVolume === undefined ? 0.8 : options.masterVolume;

  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -7;
  limiter.knee.value = 2;
  limiter.ratio.value = 18;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.16;

  const softClip = ac.createWaveShaper();
  softClip.curve = makeSoftClipCurve();
  softClip.oversample = "2x";

  // Underwater muffle. Sits between the master bus and the limiter so it
  // catches everything - sfx, music and ambience alike - which is the point:
  // going under should change the whole soundscape, not individual sounds.
  const submergeFilter = ac.createBiquadFilter();
  submergeFilter.type = "lowpass";
  submergeFilter.frequency.value = 20000;   // effectively open when dry
  submergeFilter.Q.value = 0.6;
  master.connect(submergeFilter);
  submergeFilter.connect(limiter);
  limiter.connect(softClip);
  softClip.connect(ac.destination);

  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  softClip.connect(analyser);

  const sfxBus = ac.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(master);

  const musicBus = ac.createGain();
  musicBus.gain.value = options.musicVolume === undefined ? 0.55 : options.musicVolume;
  const musicDuck = ac.createGain();
  musicDuck.gain.value = 1;
  musicBus.connect(musicDuck);
  musicDuck.connect(master);

  const ambientBus = ac.createGain();
  ambientBus.gain.value = 0.9;
  const ambientDuck = ac.createGain();
  ambientDuck.gain.value = 1;
  ambientBus.connect(ambientDuck);
  ambientDuck.connect(master);

  graph.master = master;
  graph.submergeFilter = submergeFilter;
  graph.limiter = limiter;
  graph.softClip = softClip;
  graph.analyser = analyser;
  graph.sfxBus = sfxBus;
  graph.musicBus = musicBus;
  graph.musicDuck = musicDuck;
  graph.ambientBus = ambientBus;
  graph.ambientDuck = ambientDuck;

  if (reverb && typeof ac.createConvolver === "function") {
    try {
      const convolver = ac.createConvolver();
      convolver.buffer = makeImpulse(ac, 0.55, 3.4, rng);
      const send = ac.createGain();
      send.gain.value = 0.085;
      const ret = ac.createGain();
      ret.gain.value = 0.9;
      sfxBus.connect(send);
      ambientBus.connect(send);
      send.connect(convolver);
      convolver.connect(ret);
      ret.connect(master);
      graph.convolver = convolver;
      graph.reverbSend = send;
    } catch (error) {
      graph.convolver = null;
    }
  }

  graph.noise = makeNoiseBuffer(ac, 3, rng, false);
  graph.pink = makeNoiseBuffer(ac, 10, rng, true);

  graph.buses = { sfx: sfxBus, ambient: ambientBus, music: musicBus };
  return graph;
}

/* ---- panner pooling -------------------------------------------------- */

function acquirePanner(graph, presetName) {
  const preset = DISTANCE_PRESETS[presetName] || DISTANCE_PRESETS.mid;
  const model = preset.hrtf && graph.hrtf ? "HRTF" : "equalpower";
  const pool = graph.pannerPools[model];
  let panner = pool.pop();
  if (!panner) {
    panner = graph.ac.createPanner();
    try { panner.panningModel = model; } catch (error) { /* older Safari */ }
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
  }
  panner.distanceModel = "inverse";
  panner.refDistance = preset.refDistance;
  panner.rolloffFactor = preset.rolloffFactor;
  panner.maxDistance = preset.maxDistance;
  panner._pool = model;
  return panner;
}

function setPannerPosition(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else if (panner.setPosition) {
    panner.setPosition(x, y, z);
  }
}

function releasePanner(graph, panner) {
  try { panner.disconnect(); } catch (error) { /* already gone */ }
  const pool = graph.pannerPools[panner._pool] || graph.pannerPools.equalpower;
  if (pool.length < 48) pool.push(panner);
}

/* ---- voice allocation ------------------------------------------------ */

/**
 * Reserves a voice slot. Returns `null` when the category is full and
 * the incoming sound is quieter than everything already playing - that
 * is the whole of the voice-limiting policy, and it is what stops a
 * hundred simultaneous collisions turning into white noise.
 */
function spawnVoice(graph, opts) {
  const ac = graph.ac;
  const category = opts.category || "misc";
  const level = opts.level === undefined ? 0.5 : opts.level;

  if (graph.live) {
    const cap = VOICE_CAPS[category] || VOICE_CAPS.misc;
    let sameCategory = 0;
    let quietest = null;
    for (let i = 0; i < graph.voices.length; i += 1) {
      const v = graph.voices[i];
      if (v.category !== category) continue;
      sameCategory += 1;
      if (!quietest || v.level < quietest.level) quietest = v;
    }
    const overTotal = graph.voices.length >= TOTAL_VOICE_CAP;
    if (sameCategory >= cap || overTotal) {
      let victim = quietest;
      if (overTotal && !victim) {
        for (let i = 0; i < graph.voices.length; i += 1) {
          if (!victim || graph.voices[i].level < victim.level) victim = graph.voices[i];
        }
      }
      if (!victim || victim.level >= level) {
        graph.refused += 1;
        return null;
      }
      stealVoice(graph, victim);
      graph.stolen += 1;
    }
  }

  const gain = ac.createGain();
  gain.gain.value = 1;

  const busName = opts.bus || "sfx";
  const bus = graph.buses[busName] || graph.sfxBus;

  let panner = null;
  if (opts.position && graph.spatial) {
    panner = acquirePanner(graph, opts.distance || "mid");
    setPannerPosition(panner, opts.position.x || 0, opts.position.y || 0, opts.position.z || 0);
    gain.connect(panner);
    panner.connect(bus);
  } else {
    gain.connect(bus);
  }

  const voice = {
    category,
    level,
    node: gain,
    panner,
    startedAt: ac.currentTime,
    endsAt: ac.currentTime + (opts.duration || 0.4),
    extras: [],
    dead: false,
  };

  graph.spawned += 1;
  if (graph.live) {
    graph.voices.push(voice);
    if (graph.voices.length > graph.peakVoices) graph.peakVoices = graph.voices.length;
  }
  return voice;
}

function stealVoice(graph, voice) {
  const ac = graph.ac;
  const t = ac.currentTime;
  try {
    voice.node.gain.cancelScheduledValues(t);
    voice.node.gain.setValueAtTime(Math.max(0.0001, voice.node.gain.value), t);
    voice.node.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  } catch (error) { /* param already detached */ }
  const index = graph.voices.indexOf(voice);
  if (index >= 0) graph.voices.splice(index, 1);
  voice.endsAt = t + 0.03;
  voice.stolen = true;
  graph.pending.push(voice);
}

/** Marks a voice finished at `endsAt`; the sweeper disconnects it later. */
function finishVoice(graph, voice, endsAt) {
  voice.endsAt = endsAt;
  if (!graph.live) return voice;
  const index = graph.voices.indexOf(voice);
  if (index >= 0) graph.voices.splice(index, 1);
  graph.pending.push(voice);
  return voice;
}

function sweepVoices(graph) {
  const now = graph.ac.currentTime;
  // Voices whose scheduled end has passed: disconnect, recycle, forget.
  for (let i = graph.pending.length - 1; i >= 0; i -= 1) {
    const voice = graph.pending[i];
    if (now < voice.endsAt + 0.05) continue;
    graph.pending.splice(i, 1);
    disposeVoice(graph, voice);
  }
  // Belt and braces: a voice that never got finished (a bug, or a
  // suspended context) still cannot leak forever.
  for (let i = graph.voices.length - 1; i >= 0; i -= 1) {
    const voice = graph.voices[i];
    if (now < voice.endsAt + 2) continue;
    graph.voices.splice(i, 1);
    disposeVoice(graph, voice);
  }
}

function disposeVoice(graph, voice) {
  if (voice.dead) return;
  voice.dead = true;
  for (let i = 0; i < voice.extras.length; i += 1) {
    try { voice.extras[i].disconnect(); } catch (error) { /* fine */ }
  }
  voice.extras.length = 0;
  try { voice.node.disconnect(); } catch (error) { /* fine */ }
  if (voice.panner) releasePanner(graph, voice.panner);
  voice.panner = null;
  graph.released += 1;
}

/* ------------------------------------------------------------------ */
/* 4. Synth primitives                                                 */
/* ------------------------------------------------------------------ */

function noiseSource(graph, when, rate) {
  const src = graph.ac.createBufferSource();
  src.buffer = graph.noise;
  src.playbackRate.value = rate || 1;
  src.loop = true;
  const offset = graph.rng() * (graph.noise.duration - 0.2);
  src.start(when, offset);
  return src;
}

function envGain(ac, when, peak, attack, decay, curve) {
  const g = ac.createGain();
  const a = Math.max(0.0006, attack);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), when + a);
  if (curve === "linear") g.gain.linearRampToValueAtTime(0.0001, when + a + decay);
  else g.gain.exponentialRampToValueAtTime(0.0001, when + a + decay);
  return g;
}

/** Short filtered noise burst - the workhorse for anything percussive. */
function burst(graph, dest, when, opts) {
  const ac = graph.ac;
  const src = noiseSource(graph, when, opts.rate || 1);
  const filter = ac.createBiquadFilter();
  filter.type = opts.type || "bandpass";
  filter.frequency.setValueAtTime(opts.band, when);
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), when + opts.decay);
  filter.Q.value = opts.q === undefined ? 1 : opts.q;
  const g = envGain(ac, when, opts.gain, opts.attack || 0.0015, opts.decay);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.stop(when + opts.decay + 0.05);
  return { src, filter, gain: g, nodes: [src, filter, g] };
}

/** Decaying sine/triangle partial - the "ring" of a struck object. */
function mode(graph, dest, when, freq, gain, decay, type) {
  const ac = graph.ac;
  const osc = ac.createOscillator();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, when);
  const g = envGain(ac, when, gain, 0.001, decay);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + decay + 0.05);
  return { osc, gain: g, nodes: [osc, g] };
}

/** Pitch-dropping sine - kick drums, thumps, cartoon bonks. */
function thump(graph, dest, when, fromFreq, toFreq, gain, decay, type) {
  const ac = graph.ac;
  const osc = ac.createOscillator();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(fromFreq, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(18, toFreq), when + decay * 0.85);
  const g = envGain(ac, when, gain, 0.002, decay);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + decay + 0.05);
  return { osc, gain: g, nodes: [osc, g] };
}

/* ------------------------------------------------------------------ */
/* 5. Sound library                                                    */
/* ------------------------------------------------------------------ */

function createSounds(graph) {
  const ac = graph.ac;
  const rng = graph.rng;

  function collect(voice, parts) {
    for (let i = 0; i < parts.length; i += 1) {
      const nodes = parts[i].nodes;
      for (let n = 0; n < nodes.length; n += 1) voice.extras.push(nodes[n]);
    }
  }

  /* ---- impacts ---------------------------------------------------- */

  /**
   * `speed` is world units/second. The hero tops out around 20 and a
   * long fall lands near 60, so 45 is a good "that really hurt" mark.
   */
  function impact(opts) {
    const profile = IMPACT_PROFILES[opts.material] || IMPACT_PROFILES.soil;
    const energy = clamp01((opts.speed === undefined ? 12 : opts.speed) / 45);
    const level = clamp(0.1 + 0.78 * Math.pow(energy, 0.65), 0.05, 0.95) * (opts.gain === undefined ? 1 : opts.gain);
    const decayScale = 0.78 + 0.55 * energy;
    const duration = 0.12 + 0.9 * decayScale;

    const voice = spawnVoice(graph, {
      category: opts.category || "impact",
      level,
      duration,
      position: opts.position,
      distance: opts.distance || "mid",
      bus: opts.bus,
    });
    if (!voice) return null;

    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const head = ac.createGain();
    head.gain.value = level;
    const tone = ac.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(lerp(profile.lowpass[0], profile.lowpass[1], Math.pow(energy, 0.6)), when);
    tone.Q.value = 0.4;
    head.connect(tone);
    tone.connect(voice.node);
    voice.extras.push(head, tone);

    const parts = [];
    let end = when + 0.1;

    // 1. strike transient
    if (profile.noise) {
      const n = profile.noise;
      const decay = n.decay * decayScale;
      parts.push(burst(graph, head, when, {
        band: n.band * lerp(0.8, 1.25, rng()),
        sweepTo: n.band * n.sweep,
        q: n.q,
        gain: n.gain * lerp(0.85, 1.1, rng()),
        decay,
        rate: lerp(0.85, 1.2, rng()),
      }));
      end = Math.max(end, when + decay);
    }

    // 2. modal ring - higher partials only really wake up on hard hits
    for (let i = 0; i < profile.modes.length; i += 1) {
      const [freq, g, decay] = profile.modes[i];
      const partialGain = g * (i === 0 ? 1 : 0.3 + 0.95 * energy);
      if (partialGain < 0.01) continue;
      const d = decay * decayScale;
      parts.push(mode(graph, head, when, freq * lerp(0.97, 1.04, rng()), partialGain, d));
      end = Math.max(end, when + d);
    }

    // 3. body / sub
    if (profile.thump) {
      const t = profile.thump;
      const d = t.decay * decayScale;
      parts.push(thump(graph, head, when, t.freq * lerp(1.3, 1.7, rng()), t.freq * 0.7, t.gain, d));
      end = Math.max(end, when + d);
    }

    // 4. HF tick that gives contact definition
    if (profile.click > 0) {
      parts.push(burst(graph, head, when, {
        type: "highpass",
        band: 5200,
        q: 0.6,
        gain: profile.click * (0.35 + 0.85 * energy),
        decay: 0.012,
        rate: lerp(0.9, 1.3, rng()),
      }));
    }

    // 5. material extras
    if (profile.scatter) {
      const count = 2 + Math.floor(profile.scatter * energy);
      for (let i = 0; i < count; i += 1) {
        const t = when + 0.012 + rng() * 0.09 * (0.5 + energy);
        parts.push(burst(graph, head, t, {
          band: 1600 * lerp(0.7, 2.4, rng()),
          q: 2.4,
          gain: 0.16 * lerp(0.5, 1, rng()),
          decay: 0.018,
          rate: lerp(0.9, 1.5, rng()),
        }));
        end = Math.max(end, t + 0.04);
      }
    }
    if (profile.crinkle) {
      const count = 3 + Math.floor(profile.crinkle * energy);
      for (let i = 0; i < count; i += 1) {
        const t = when + rng() * 0.11;
        parts.push(burst(graph, head, t, {
          band: 3000 * lerp(0.75, 2, rng()),
          q: 1.1,
          gain: 0.12 * lerp(0.4, 1, rng()),
          decay: 0.014,
          rate: lerp(1, 1.7, rng()),
        }));
        end = Math.max(end, t + 0.04);
      }
    }
    if (profile.splash) {
      const count = 2 + Math.floor(profile.splash * energy);
      for (let i = 0; i < count; i += 1) {
        const t = when + 0.02 + rng() * 0.16;
        const f = lerp(700, 2400, rng());
        const bub = mode(graph, head, t, f, 0.1 * lerp(0.5, 1, rng()), 0.05);
        bub.osc.frequency.exponentialRampToValueAtTime(f * lerp(1.5, 2.6, rng()), t + 0.045);
        parts.push(bub);
        end = Math.max(end, t + 0.09);
      }
    }

    collect(voice, parts);
    finishVoice(graph, voice, end + 0.06);
    return voice;
  }

  /* ---- eight-legged scuttle --------------------------------------- */

  /**
   * One gait beat. Fires a smeared cluster of micro-ticks so the ear
   * hears "lots of small feet" rather than a single footfall.
   */
  function scuttle(opts) {
    const profile = STEP_PROFILES[opts.surface] || STEP_PROFILES.soil;
    const intensity = clamp01(opts.intensity === undefined ? 0.6 : opts.intensity);
    const level = profile.gain * (0.35 + 0.75 * intensity) * (opts.gain === undefined ? 1 : opts.gain);
    const grains = Math.max(2, Math.round(profile.grains * (0.6 + 0.55 * intensity)));
    const spread = profile.spread * lerp(1.15, 0.72, intensity);
    const duration = spread + profile.decay + 0.08;

    const voice = spawnVoice(graph, {
      category: "foot",
      level,
      duration,
      position: opts.position,
      distance: "near",
      bus: opts.bus,
    });
    if (!voice) return null;

    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const head = ac.createGain();
    head.gain.value = level;
    const tilt = ac.createBiquadFilter();
    tilt.type = "highshelf";
    tilt.frequency.value = 2200;
    tilt.gain.value = profile.tilt;
    head.connect(tilt);
    tilt.connect(voice.node);
    voice.extras.push(head, tilt);

    const parts = [];
    let end = when + 0.05;
    for (let i = 0; i < grains; i += 1) {
      // Legs land in a travelling wave, not all at once.
      const t = when + (i / grains) * spread * lerp(0.7, 1.3, rng());
      const pitch = lerp(1 - profile.jitter, 1 + profile.jitter, rng());
      parts.push(burst(graph, head, t, {
        band: profile.band * pitch,
        sweepTo: profile.wet ? profile.band * pitch * 0.4 : 0,
        q: profile.q,
        gain: lerp(0.45, 1, rng()),
        decay: profile.decay * lerp(0.75, 1.3, rng()),
        rate: lerp(0.85, 1.35, rng()),
      }));
      if (profile.ping && rng() < 0.45) {
        parts.push(mode(graph, head, t, profile.band * pitch * lerp(1.4, 2.6, rng()), profile.ping * 0.12, 0.035));
      }
      if (profile.wet && rng() < 0.5) {
        const f = lerp(900, 2100, rng());
        const plip = mode(graph, head, t + 0.004, f, 0.09, 0.04);
        plip.osc.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.038);
        parts.push(plip);
      }
      end = Math.max(end, t + profile.decay * 1.4);
    }

    // A soft low "shff" underneath binds the cluster into one footfall.
    if (!profile.wet) {
      parts.push(burst(graph, head, when, {
        type: "lowpass",
        band: lerp(240, 420, rng()),
        q: 0.7,
        gain: 0.28 * intensity,
        decay: 0.05,
        rate: lerp(0.7, 1, rng()),
      }));
    }

    collect(voice, parts);
    finishVoice(graph, voice, end + 0.08);
    return voice;
  }

  /* ---- creature vocals -------------------------------------------- */

  function vocal(name, opts = {}) {
    const shape = VOCALS[name] || VOCALS.squeak;
    const level = (shape.gain || 0.5) * (opts.gain === undefined ? 1 : opts.gain);
    const dur = shape.dur * lerp(0.86, 1.18, rng()) * (opts.stretch || 1);
    const voice = spawnVoice(graph, {
      category: "vocal",
      level,
      duration: dur + 0.2,
      position: opts.position,
      distance: "near",
      bus: opts.bus,
    });
    if (!voice) return null;

    const when = opts.when === undefined ? ac.currentTime + 0.003 : opts.when;
    // Per-utterance body variation: never the same creature twice.
    const pitchScale = (opts.pitch || 1) * lerp(0.86, 1.2, rng());
    const bodyScale = lerp(0.92, 1.1, rng());

    const head = ac.createGain();
    head.gain.value = level;
    head.connect(voice.node);
    voice.extras.push(head);

    // glottal source
    const osc = ac.createOscillator();
    osc.type = shape.dark ? "sawtooth" : "sawtooth";
    const f0 = shape.f0;
    const hold = shape.hold || 0;
    osc.frequency.setValueAtTime(f0[0] * pitchScale, when);
    osc.frequency.exponentialRampToValueAtTime(f0[1] * pitchScale, when + dur * (hold ? 0.22 : 0.42));
    osc.frequency.exponentialRampToValueAtTime(f0[2] * pitchScale, when + dur);

    // vibrato
    const lfo = ac.createOscillator();
    lfo.frequency.value = shape.vib[0] * lerp(0.85, 1.2, rng());
    const lfoGain = ac.createGain();
    lfoGain.gain.value = f0[1] * pitchScale * shape.vib[1];
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start(when);
    lfo.stop(when + dur + 0.1);

    // breath
    const breath = noiseSource(graph, when, lerp(0.9, 1.2, rng()));
    const breathGain = ac.createGain();
    breathGain.gain.value = shape.breath;
    breath.connect(breathGain);
    breath.stop(when + dur + 0.1);

    const source = ac.createGain();
    source.gain.value = 1;
    osc.connect(source);
    breathGain.connect(source);

    // formant bank
    const vowel = VOWELS[shape.vowel] || VOWELS.ee;
    const formantGains = [1, 0.55, 0.26];
    const sum = ac.createGain();
    sum.gain.value = 0.6;
    const filters = [];
    for (let i = 0; i < 3; i += 1) {
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      const target = vowel[i] * FORMANT_SCALE * bodyScale * (shape.dark ? 0.72 : 1);
      f.frequency.setValueAtTime(clamp(target, 80, ac.sampleRate * 0.45), when);
      // Formants glide a little, which is what makes it read as a word.
      f.frequency.linearRampToValueAtTime(
        clamp(target * lerp(0.88, 1.16, rng()), 80, ac.sampleRate * 0.45),
        when + dur
      );
      f.Q.value = 7 + i * 3;
      const g = ac.createGain();
      g.gain.value = formantGains[i];
      source.connect(f);
      f.connect(g);
      g.connect(sum);
      filters.push(f, g);
    }

    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(1, when + Math.min(0.02, dur * 0.18));
    if (hold) env.gain.setValueAtTime(1, when + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    sum.connect(env);
    env.connect(head);
    osc.start(when);
    osc.stop(when + dur + 0.08);

    voice.extras.push(osc, lfo, lfoGain, breath, breathGain, source, sum, env, ...filters);
    finishVoice(graph, voice, when + dur + 0.14);
    return voice;
  }

  /** Ascending happy phrase - "I meant to do that". */
  function cheer(opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.005 : opts.when;
    const steps = 3 + Math.floor(rng() * 2);
    let last = null;
    for (let i = 0; i < steps; i += 1) {
      last = vocal(i === steps - 1 ? "chirp" : "giggle", {
        when: when + i * 0.075,
        pitch: 1 + i * 0.13,
        position: opts.position,
        gain: (opts.gain || 1) * (0.7 + i * 0.12),
      });
    }
    return last;
  }

  /* ---- named one-shots -------------------------------------------- */

  function jump(opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const voice = spawnVoice(graph, {
      category: "misc", level: 0.4, duration: 0.3, position: opts.position, distance: "near",
    });
    if (!voice) return null;
    const parts = [];
    parts.push(burst(graph, voice.node, when, { band: 900, q: 0.8, gain: 0.3, decay: 0.06, sweepTo: 2600 }));
    const boing = thump(graph, voice.node, when, 220, 620, 0.14, 0.12, "triangle");
    parts.push(boing);
    collect(voice, parts);
    finishVoice(graph, voice, when + 0.26);
    vocal("huff", { when: when + 0.01, position: opts.position, gain: 0.6 });
    return voice;
  }

  function land(opts = {}) {
    const speed = opts.speed === undefined ? 14 : opts.speed;
    const v = impact({ ...opts, material: opts.material || opts.surface || "soil", speed, category: "impact" });
    if (speed > 26) vocal("yelp", { position: opts.position, gain: clamp01((speed - 26) / 30) * 0.9 + 0.2 });
    else if (speed > 14 && rng() < 0.4) vocal("huff", { position: opts.position, gain: 0.5 });
    return v;
  }

  function bonk(opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const voice = spawnVoice(graph, {
      category: "impact", level: 0.7, duration: 0.5, position: opts.position, distance: "mid",
    });
    if (!voice) return null;
    const parts = [];
    parts.push(thump(graph, voice.node, when, 420 * lerp(0.9, 1.2, rng()), 78, 0.5, 0.22, "triangle"));
    parts.push(burst(graph, voice.node, when, { band: 1800, q: 1.4, gain: 0.35, decay: 0.035 }));
    parts.push(mode(graph, voice.node, when, 880 * lerp(0.9, 1.15, rng()), 0.14, 0.18));
    collect(voice, parts);
    finishVoice(graph, voice, when + 0.42);
    return voice;
  }

  function chomp(opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const voice = spawnVoice(graph, {
      category: "misc", level: 0.5, duration: 0.3, position: opts.position, distance: "near",
    });
    if (!voice) return null;
    const parts = [];
    parts.push(burst(graph, voice.node, when, { band: 2600, q: 1.6, gain: 0.3, decay: 0.02 }));
    parts.push(burst(graph, voice.node, when + 0.055, { band: 1500, q: 2.2, gain: 0.36, decay: 0.03 }));
    parts.push(thump(graph, voice.node, when + 0.05, 260, 120, 0.16, 0.08));
    collect(voice, parts);
    finishVoice(graph, voice, when + 0.24);
    return voice;
  }

  function grapple(opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const voice = spawnVoice(graph, {
      category: "misc", level: 0.45, duration: 0.4, position: opts.position, distance: "near",
    });
    if (!voice) return null;
    const parts = [];
    // wet tongue launch: rising resonant slurp
    const b = burst(graph, voice.node, when, { band: 420, q: 2.6, gain: 0.4, decay: 0.16, sweepTo: 2800 });
    parts.push(b);
    const rise = mode(graph, voice.node, when, 320, 0.12, 0.14, "triangle");
    rise.osc.frequency.exponentialRampToValueAtTime(1100, when + 0.13);
    parts.push(rise);
    collect(voice, parts);
    finishVoice(graph, voice, when + 0.32);
    return voice;
  }

  function grappleHit(opts = {}) {
    const v = impact({ ...opts, material: opts.material || "chitin", speed: 18, category: "impact", gain: 0.7 });
    return v;
  }

  function splash(opts = {}) {
    return impact({ ...opts, material: "water", speed: opts.speed === undefined ? 20 : opts.speed });
  }

  function propBreak(opts = {}) {
    const material = opts.material || "ceramic";
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const first = impact({ ...opts, material, speed: 38, when });
    // debris tail
    const bits = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < bits; i += 1) {
      impact({
        ...opts,
        material,
        speed: 8 + rng() * 10,
        when: when + 0.06 + rng() * 0.42,
        gain: 0.35,
        category: "misc",
      });
    }
    return first;
  }

  /** Bright arpeggiated "ding" for score / combo UI feedback. */
  function ui(name, opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const voice = spawnVoice(graph, { category: "ui", level: opts.level || 0.45, duration: 0.7, bus: "sfx" });
    if (!voice) return null;
    const parts = [];
    const root = opts.root || 74;
    const shape = name === "down" ? [0, -3, -7] : [0, 4, 7, 12];
    for (let i = 0; i < shape.length; i += 1) {
      const t = when + i * 0.055;
      const f = mtof(root + shape[i]);
      parts.push(mode(graph, voice.node, t, f, 0.16, 0.24, "triangle"));
      parts.push(mode(graph, voice.node, t, f * 2, 0.05, 0.14));
    }
    collect(voice, parts);
    finishVoice(graph, voice, when + shape.length * 0.055 + 0.3);
    return voice;
  }

  /** Generic fallback so an unknown name is a soft blip, never an error. */
  function blip(opts = {}) {
    const when = opts.when === undefined ? ac.currentTime + 0.002 : opts.when;
    const voice = spawnVoice(graph, {
      category: "misc", level: 0.3, duration: 0.2, position: opts.position, distance: "mid",
    });
    if (!voice) return null;
    const parts = [mode(graph, voice.node, when, lerp(600, 1400, rng()), 0.18, 0.1, "triangle")];
    collect(voice, parts);
    finishVoice(graph, voice, when + 0.18);
    return voice;
  }

  return {
    impact, scuttle, vocal, cheer, jump, land, bonk, chomp,
    grapple, grappleHit, splash, propBreak, ui, blip,
    collect,
  };
}

/* ------------------------------------------------------------------ */
/* 6. Rolling / scraping loop for the curled "tun" ball                */
/* ------------------------------------------------------------------ */

function createRoller(graph) {
  const ac = graph.ac;
  let built = false;
  let nodes = null;
  const state = { active: false, speed: 0, surface: "soil", crackleAt: 0 };

  function build() {
    if (built) return;
    built = true;

    const out = ac.createGain();
    out.gain.value = 0;

    let dest = out;
    let panner = null;
    if (graph.spatial) {
      panner = acquirePanner(graph, "near");
      out.connect(panner);
      panner.connect(graph.sfxBus);
    } else {
      out.connect(graph.sfxBus);
    }

    // rumble: the ball's contact patch
    const rumbleSrc = ac.createBufferSource();
    rumbleSrc.buffer = graph.pink;
    rumbleSrc.loop = true;
    rumbleSrc.playbackRate.value = 1;
    const rumbleFilter = ac.createBiquadFilter();
    rumbleFilter.type = "bandpass";
    rumbleFilter.frequency.value = 220;
    rumbleFilter.Q.value = 1.1;
    const rumbleGain = ac.createGain();
    rumbleGain.gain.value = 0.75;
    rumbleSrc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(out);
    rumbleSrc.start();

    // scrape: the bright edge that tells you what you are rolling on
    const scrapeSrc = ac.createBufferSource();
    scrapeSrc.buffer = graph.noise;
    scrapeSrc.loop = true;
    scrapeSrc.playbackRate.value = 0.8;
    const scrapeFilter = ac.createBiquadFilter();
    scrapeFilter.type = "bandpass";
    scrapeFilter.frequency.value = 2400;
    scrapeFilter.Q.value = 2.6;
    const scrapeGain = ac.createGain();
    scrapeGain.gain.value = 0;
    scrapeSrc.connect(scrapeFilter);
    scrapeFilter.connect(scrapeGain);
    scrapeGain.connect(out);
    scrapeSrc.start();

    // slow wobble so a constant roll never sounds like a sine tone
    const wobble = ac.createOscillator();
    wobble.frequency.value = 0.37;
    const wobbleGain = ac.createGain();
    wobbleGain.gain.value = 70;
    wobble.connect(wobbleGain);
    wobbleGain.connect(rumbleFilter.frequency);
    wobble.start();

    nodes = { out, panner, rumbleSrc, rumbleFilter, rumbleGain, scrapeSrc, scrapeFilter, scrapeGain, wobble, wobbleGain };
  }

  return {
    get active() { return state.active; },
    set(active, speed, surface, position) {
      state.active = Boolean(active);
      state.speed = speed || 0;
      if (surface) state.surface = surface;
      if (state.active) build();
      if (!nodes) return;
      if (position && nodes.panner) setPannerPosition(nodes.panner, position.x, position.y, position.z);
    },
    update() {
      if (!nodes) return;
      const t = ac.currentTime;
      const profile = STEP_PROFILES[state.surface] || STEP_PROFILES.soil;
      const norm = clamp01(state.speed / 24);
      const target = state.active ? 0.06 + 0.34 * Math.pow(norm, 0.8) : 0;
      nodes.out.gain.setTargetAtTime(target, t, 0.08);
      nodes.rumbleFilter.frequency.setTargetAtTime(150 + norm * 260, t, 0.12);
      nodes.rumbleSrc.playbackRate.setTargetAtTime(0.7 + norm * 0.9, t, 0.15);
      nodes.scrapeFilter.frequency.setTargetAtTime(profile.band * (0.8 + norm * 0.6), t, 0.12);
      nodes.scrapeGain.gain.setTargetAtTime(state.active ? 0.1 + 0.35 * norm : 0, t, 0.1);
      nodes.scrapeSrc.playbackRate.setTargetAtTime(0.6 + norm * 1.1, t, 0.15);
    },
    /** Gravel and leaf litter need discrete crackle on top of the loop. */
    wantsCrackle() {
      return state.active && (state.surface === "gravel" || state.surface === "leaf" || state.surface === "soil");
    },
    get speed() { return state.speed; },
    get surface() { return state.surface; },
    dispose() {
      if (!nodes) return;
      try { nodes.rumbleSrc.stop(); nodes.scrapeSrc.stop(); nodes.wobble.stop(); } catch (error) { /* fine */ }
      Object.keys(nodes).forEach((key) => {
        const n = nodes[key];
        if (n && typeof n.disconnect === "function") { try { n.disconnect(); } catch (error) { /* fine */ } }
      });
      nodes = null;
      built = false;
    },
  };
}

/* ------------------------------------------------------------------ */
/* 7. Ambience                                                         */
/* ------------------------------------------------------------------ */

function createAmbience(graph, options = {}) {
  const ac = graph.ac;
  const rng = graph.rng;
  const radius = options.radius || 400;
  const layers = [];
  let started = false;
  let wind = 0.35;
  let windTarget = 0.35;
  let nodes = null;
  const water = { position: { x: options.waterX || radius * 0.32, y: 0, z: options.waterZ || -radius * 0.28 }, radius: 40 };
  const cursor = { birds: 0, crickets: 0, gusts: 0, plips: 0 };
  let scheduled = { birds: 0, crickets: 0 };

  function widen(input, amount) {
    if (typeof ac.createStereoPanner !== "function") return input;
    const p = ac.createStereoPanner();
    p.pan.value = amount;
    input.connect(p);
    return p;
  }

  function start(t0) {
    if (started) return;
    started = true;
    const bus = graph.ambientBus;

    /* --- wind through grass -------------------------------------- */
    // Two decorrelated pink layers at incommensurate rates: the composite
    // never lines up, so the bed has no audible loop point.
    const windOut = ac.createGain();
    windOut.gain.value = 0;
    windOut.connect(bus);

    const windParts = [];
    const rates = [0.83, 1.17];
    for (let i = 0; i < rates.length; i += 1) {
      const src = ac.createBufferSource();
      src.buffer = graph.pink;
      src.loop = true;
      src.playbackRate.value = rates[i];
      const band = ac.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 420 + i * 260;
      band.Q.value = 0.85;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 0.041 + i * 0.0237;
      const lfoGain = ac.createGain();
      lfoGain.gain.value = 210 + i * 90;
      lfo.connect(lfoGain);
      lfoGain.connect(band.frequency);
      lfo.start(t0);
      const g = ac.createGain();
      g.gain.value = 0.7;
      src.connect(band);
      band.connect(g);
      const out = widen(g, i === 0 ? -0.55 : 0.55);
      out.connect(windOut);
      src.start(t0, rng() * 8);
      windParts.push({ src, band, lfo, lfoGain, g });
    }

    // grass hiss - only really appears in gusts
    const hissSrc = ac.createBufferSource();
    hissSrc.buffer = graph.pink;
    hissSrc.loop = true;
    hissSrc.playbackRate.value = 1.51;
    const hissBand = ac.createBiquadFilter();
    hissBand.type = "bandpass";
    hissBand.frequency.value = 2900;
    hissBand.Q.value = 0.7;
    const hissGain = ac.createGain();
    hissGain.gain.value = 0;
    hissSrc.connect(hissBand);
    hissBand.connect(hissGain);
    hissGain.connect(bus);
    hissSrc.start(t0, rng() * 6);

    /* --- insect hum ---------------------------------------------- */
    const insectGain = ac.createGain();
    insectGain.gain.value = 0.016;
    insectGain.connect(bus);
    const insects = [];
    const insectCount = options.lite ? 2 : 3;
    for (let i = 0; i < insectCount; i += 1) {
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 3200 + i * 420 + rng() * 180;
      const band = ac.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = osc.frequency.value;
      band.Q.value = 12;
      const trem = ac.createOscillator();
      trem.frequency.value = 17 + i * 3.7 + rng() * 2;
      const tremGain = ac.createGain();
      tremGain.gain.value = 0.5;
      const vca = ac.createGain();
      vca.gain.value = 0.5;
      trem.connect(tremGain);
      tremGain.connect(vca.gain);
      osc.connect(band);
      band.connect(vca);
      const out = widen(vca, i % 2 === 0 ? -0.7 : 0.7);
      out.connect(insectGain);
      osc.start(t0);
      trem.start(t0);
      insects.push({ osc, band, trem, tremGain, vca });
    }

    /* --- water lapping ------------------------------------------- */
    const waterOut = ac.createGain();
    waterOut.gain.value = 0.5;
    let waterPanner = null;
    if (graph.spatial) {
      waterPanner = acquirePanner(graph, "far");
      setPannerPosition(waterPanner, water.position.x, water.position.y, water.position.z);
      waterOut.connect(waterPanner);
      waterPanner.connect(bus);
    } else {
      waterOut.connect(bus);
    }
    const waterSrc = ac.createBufferSource();
    waterSrc.buffer = graph.pink;
    waterSrc.loop = true;
    waterSrc.playbackRate.value = 0.61;
    const waterFilter = ac.createBiquadFilter();
    waterFilter.type = "lowpass";
    waterFilter.frequency.value = 900;
    waterFilter.Q.value = 0.9;
    const waterLfo = ac.createOscillator();
    waterLfo.frequency.value = 0.19;
    const waterLfoGain = ac.createGain();
    waterLfoGain.gain.value = 0.35;
    const waterVca = ac.createGain();
    waterVca.gain.value = 0.55;
    waterLfo.connect(waterLfoGain);
    waterLfoGain.connect(waterVca.gain);
    waterSrc.connect(waterFilter);
    waterFilter.connect(waterVca);
    waterVca.connect(waterOut);
    waterSrc.start(t0, rng() * 5);
    waterLfo.start(t0);

    nodes = {
      windOut, windParts, hissSrc, hissBand, hissGain,
      insectGain, insects,
      waterOut, waterPanner, waterSrc, waterFilter, waterLfo, waterLfoGain, waterVca,
    };
    layers.push("wind", "grass-hiss", "insects", "water");
    if (!options.lite) layers.push("birds", "crickets");

    cursor.birds = t0 + 1.5 + rng() * 3;
    cursor.crickets = t0 + 0.8 + rng() * 2;
    cursor.gusts = t0 + 0.5;
    cursor.plips = t0 + 1 + rng() * 3;

    applyWind(t0, 0.001);
  }

  function applyWind(t, tau) {
    if (!nodes) return;
    const w = clamp01(wind);
    nodes.windOut.gain.setTargetAtTime(0.03 + 0.16 * Math.pow(w, 1.1), t, tau);
    nodes.hissGain.gain.setTargetAtTime(0.004 + 0.05 * Math.pow(w, 1.9), t, tau);
    for (let i = 0; i < nodes.windParts.length; i += 1) {
      nodes.windParts[i].band.frequency.setTargetAtTime(360 + i * 240 + w * 620, t, tau * 2);
    }
    nodes.insectGain.gain.setTargetAtTime(lerp(0.02, 0.006, w), t, tau * 3);
  }

  /* --- scheduled stochastic events ------------------------------- */

  function bird(t) {
    const angle = rng() * TAU;
    const dist = radius * lerp(0.55, 1, rng());
    const pos = { x: Math.cos(angle) * dist, y: radius * lerp(0.35, 0.8, rng()), z: Math.sin(angle) * dist };
    const notes = 2 + Math.floor(rng() * 4);
    const base = lerp(2200, 4200, rng());
    const voice = spawnVoice(graph, {
      category: "ambient", level: 0.22, duration: notes * 0.13 + 0.3, position: pos, distance: "far", bus: "ambient",
    });
    if (!voice) return;
    const parts = [];
    for (let i = 0; i < notes; i += 1) {
      const nt = t + i * lerp(0.075, 0.15, rng());
      const f = base * lerp(0.85, 1.35, rng());
      const dur = lerp(0.05, 0.1, rng());
      const m = mode(graph, voice.node, nt, f, 0.1, dur);
      m.osc.frequency.exponentialRampToValueAtTime(f * lerp(0.7, 1.7, rng()), nt + dur);
      parts.push(m);
      // a whisper of noise gives the chirp a beak
      parts.push(burst(graph, voice.node, nt, { band: f * 1.4, q: 6, gain: 0.03, decay: dur * 0.6 }));
    }
    for (let i = 0; i < parts.length; i += 1) {
      for (let n = 0; n < parts[i].nodes.length; n += 1) voice.extras.push(parts[i].nodes[n]);
    }
    finishVoice(graph, voice, t + notes * 0.16 + 0.2);
    scheduled.birds += 1;
  }

  function cricket(t) {
    const angle = rng() * TAU;
    const dist = radius * lerp(0.2, 0.7, rng());
    const pos = { x: Math.cos(angle) * dist, y: 2, z: Math.sin(angle) * dist };
    const pulses = 3 + Math.floor(rng() * 4);
    const f = lerp(4200, 5400, rng());
    const voice = spawnVoice(graph, {
      category: "ambient", level: 0.12, duration: pulses * 0.05 + 0.2, position: pos, distance: "far", bus: "ambient",
    });
    if (!voice) return;
    const parts = [];
    for (let i = 0; i < pulses; i += 1) {
      const nt = t + i * 0.032;
      parts.push(burst(graph, voice.node, nt, { band: f, q: 24, gain: 0.16, decay: 0.016, rate: 1.3 }));
    }
    for (let i = 0; i < parts.length; i += 1) {
      for (let n = 0; n < parts[i].nodes.length; n += 1) voice.extras.push(parts[i].nodes[n]);
    }
    finishVoice(graph, voice, t + pulses * 0.04 + 0.1);
    scheduled.crickets += 1;
  }

  function plip(t) {
    const pos = {
      x: water.position.x + (rng() - 0.5) * water.radius,
      y: 1,
      z: water.position.z + (rng() - 0.5) * water.radius,
    };
    const voice = spawnVoice(graph, {
      category: "ambient", level: 0.12, duration: 0.2, position: pos, distance: "far", bus: "ambient",
    });
    if (!voice) return;
    const f = lerp(700, 1800, rng());
    const m = mode(graph, voice.node, t, f, 0.14, 0.09);
    m.osc.frequency.exponentialRampToValueAtTime(f * 2.3, t + 0.08);
    for (let n = 0; n < m.nodes.length; n += 1) voice.extras.push(m.nodes[n]);
    finishVoice(graph, voice, t + 0.18);
  }

  function gust(t) {
    if (!nodes) return;
    // Random-walk gusts on top of the caller's wind parameter keep the
    // bed alive even if nobody ever calls setWind().
    const depth = lerp(0.25, 1, rng());
    const rise = lerp(0.8, 2.6, rng());
    const g = nodes.windOut.gain;
    const base = 0.03 + 0.16 * Math.pow(clamp01(wind), 1.1);
    g.cancelScheduledValues(t);
    g.setTargetAtTime(base * (0.55 + depth * 0.9), t, rise * 0.4);
    nodes.hissGain.gain.setTargetAtTime((0.004 + 0.05 * Math.pow(clamp01(wind), 1.9)) * (0.4 + depth * 1.5), t, rise * 0.5);
  }

  /** Schedules every stochastic layer up to absolute time `until`. */
  function scheduleUntil(until) {
    if (!started || !nodes) return;
    let guard = 0;
    while (cursor.birds < until && guard < 64) {
      bird(cursor.birds);
      cursor.birds += lerp(3.5, 11, rng());
      guard += 1;
    }
    while (cursor.crickets < until && guard < 128) {
      cricket(cursor.crickets);
      cursor.crickets += lerp(1.6, 5.5, rng());
      guard += 1;
    }
    while (cursor.plips < until && guard < 192) {
      plip(cursor.plips);
      cursor.plips += lerp(2.4, 9, rng());
      guard += 1;
    }
    while (cursor.gusts < until && guard < 256) {
      gust(cursor.gusts);
      cursor.gusts += lerp(2.5, 7, rng());
      guard += 1;
    }
  }

  return {
    start,
    scheduleUntil,
    get started() { return started; },
    get wind() { return wind; },
    get layers() { return layers.slice(); },
    get counts() { return { birds: scheduled.birds, crickets: scheduled.crickets }; },
    setWind(value) { windTarget = clamp01(value); },
    setWaterSource(position, r) {
      if (position) {
        water.position.x = position.x;
        water.position.y = position.y || 0;
        water.position.z = position.z;
        if (nodes && nodes.waterPanner) setPannerPosition(nodes.waterPanner, water.position.x, water.position.y, water.position.z);
      }
      if (r) water.radius = r;
    },
    update(dt) {
      if (Math.abs(windTarget - wind) > 0.0005) {
        wind = lerp(wind, windTarget, clamp01(dt * 0.8));
        applyWind(ac.currentTime, 0.5);
      }
    },
    /** Push cursors forward without emitting - used after a long suspend. */
    resync(now) {
      const shift = Math.max(0, now - cursor.gusts);
      if (shift < 1) return;
      cursor.birds = now + 1 + rng() * 3;
      cursor.crickets = now + 0.5 + rng() * 2;
      cursor.plips = now + 1 + rng() * 3;
      cursor.gusts = now + 0.4;
    },
    dispose() {
      if (!nodes) return;
      const stopAll = (list) => list.forEach((entry) => {
        Object.keys(entry).forEach((key) => {
          const n = entry[key];
          if (!n) return;
          if (typeof n.stop === "function") { try { n.stop(); } catch (error) { /* fine */ } }
          if (typeof n.disconnect === "function") { try { n.disconnect(); } catch (error) { /* fine */ } }
        });
      });
      stopAll(nodes.windParts);
      stopAll(nodes.insects);
      [nodes.hissSrc, nodes.waterSrc, nodes.waterLfo].forEach((n) => {
        try { n.stop(); } catch (error) { /* fine */ }
      });
      Object.keys(nodes).forEach((key) => {
        const n = nodes[key];
        if (n && typeof n.disconnect === "function") { try { n.disconnect(); } catch (error) { /* fine */ } }
      });
      nodes = null;
      started = false;
    },
  };
}

/* ------------------------------------------------------------------ */
/* 8. Adaptive music                                                   */
/* ------------------------------------------------------------------ */

function createMusic(graph) {
  const ac = graph.ac;
  const rng = graph.rng;
  const bus = graph.musicBus;

  const state = {
    playing: false,
    intensity: 0,
    target: 0,
    /** Baseline the target decays to - "how busy is play right now". */
    floor: 0,
    bpm: 124,
    bar: 0,
    step: 0,
    root: 60,
    section: 0,
    cursor: 0,
    notes: 0,
    stingers: 0,
    lastStinger: "",
  };

  let motif = [];
  regenerateMotif();

  function regenerateMotif() {
    motif = [];
    const scale = SCALE_LYDIAN;
    for (let i = 0; i < 16; i += 1) {
      const on = rng() < (i % 4 === 0 ? 0.85 : 0.42);
      motif.push({
        on,
        degree: scale[Math.floor(rng() * scale.length)],
        octave: rng() < 0.25 ? 12 : 0,
      });
    }
  }

  const stepDur = () => 60 / state.bpm / 4;

  /* ---- instrument voices (music bus, no spatialisation) ---- */

  function kick(t, gain) {
    const g = envGain(ac, t, gain, 0.002, 0.17);
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.07);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + 0.25);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (error) { /* fine */ } };
  }

  function snare(t, gain) {
    const src = noiseSource(graph, t, 1);
    const hp = ac.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 1900;
    hp.Q.value = 0.9;
    const g = envGain(ac, t, gain, 0.001, 0.09);
    src.connect(hp);
    hp.connect(g);
    g.connect(bus);
    src.stop(t + 0.15);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (error) { /* fine */ } };
    const body = ac.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    const bg = envGain(ac, t, gain * 0.4, 0.001, 0.06);
    body.connect(bg);
    bg.connect(bus);
    body.start(t);
    body.stop(t + 0.12);
    body.onended = () => { try { body.disconnect(); bg.disconnect(); } catch (error) { /* fine */ } };
  }

  function hat(t, gain, open) {
    const src = noiseSource(graph, t, 1.4);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const g = envGain(ac, t, gain, 0.001, open ? 0.11 : 0.026);
    src.connect(hp);
    hp.connect(g);
    g.connect(bus);
    src.stop(t + 0.2);
    src.onended = () => { try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (error) { /* fine */ } };
  }

  function block(t, gain, freq) {
    const osc = ac.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 14;
    const g = envGain(ac, t, gain, 0.001, 0.045);
    osc.connect(bp);
    bp.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + 0.1);
    osc.onended = () => { try { osc.disconnect(); bp.disconnect(); g.disconnect(); } catch (error) { /* fine */ } };
  }

  function bass(t, midi, gain, dur) {
    const osc = ac.createOscillator();
    osc.type = "square";
    osc.frequency.value = mtof(midi);
    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.value = mtof(midi - 12);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + dur);
    lp.Q.value = 6;
    const g = envGain(ac, t, gain, 0.004, dur);
    osc.connect(lp);
    sub.connect(lp);
    lp.connect(g);
    g.connect(bus);
    osc.start(t);
    sub.start(t);
    osc.stop(t + dur + 0.06);
    sub.stop(t + dur + 0.06);
    osc.onended = () => { try { osc.disconnect(); sub.disconnect(); lp.disconnect(); g.disconnect(); } catch (error) { /* fine */ } };
  }

  function pluck(t, midi, gain, dur) {
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = mtof(midi);
    const osc2 = ac.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = mtof(midi) * 2.01;
    const g2 = ac.createGain();
    g2.gain.value = 0.3;
    const g = envGain(ac, t, gain, 0.003, dur);
    osc.connect(g);
    osc2.connect(g2);
    g2.connect(g);
    g.connect(bus);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + dur + 0.05);
    osc2.stop(t + dur + 0.05);
    osc.onended = () => { try { osc.disconnect(); osc2.disconnect(); g2.disconnect(); g.disconnect(); } catch (error) { /* fine */ } };
  }

  /** The unhinged layer: fat detuned saws that show up when you are winning. */
  function brass(t, midi, gain, dur) {
    const g = envGain(ac, t, gain, 0.02, dur);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(2600, t + 0.08);
    lp.frequency.linearRampToValueAtTime(900, t + dur);
    lp.Q.value = 3;
    const oscs = [];
    for (let i = 0; i < 3; i += 1) {
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = (i - 1) * 11;
      osc.frequency.value = mtof(midi);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.08);
      oscs.push(osc);
    }
    lp.connect(g);
    g.connect(bus);
    oscs[0].onended = () => {
      try { oscs.forEach((o) => o.disconnect()); lp.disconnect(); g.disconnect(); } catch (error) { /* fine */ }
    };
  }

  /* ---- pattern ---- */

  function emitStep(t, step) {
    const i = state.intensity;
    const chord = CHORD_CYCLE[state.bar % CHORD_CYCLE.length];
    const rootMidi = state.root + chord;

    // drums
    if (step === 0 || step === 6 || (step === 10 && i > 0.3)) kick(t, 0.55 + 0.2 * i);
    if (step === 4 || step === 12) snare(t, 0.2 + 0.16 * i);
    if (i > 0.2 && step % 2 === 0) hat(t, 0.055 + 0.05 * i, false);
    if (i > 0.62 && step % 2 === 1) hat(t, 0.03 + 0.03 * i, step === 15);
    if (i > 0.3 && (step === 3 || step === 11)) block(t, 0.09 + 0.07 * i, 1180 + (step === 11 ? 260 : 0));

    // bass - skippy, off-beat, deliberately daft
    if (step === 0 || step === 3 || step === 6 || step === 8 || step === 11 || step === 14) {
      const oct = step === 8 ? 12 : 0;
      bass(t, rootMidi - 24 + oct, 0.16 + 0.1 * i, stepDur() * 1.6);
      state.notes += 1;
    }

    // lead motif
    if (i > 0.38) {
      const cell = motif[step];
      if (cell && cell.on) {
        pluck(t, rootMidi + cell.degree + cell.octave, (0.07 + 0.09 * i), stepDur() * lerp(1.2, 2.4, rng()));
        state.notes += 1;
      }
    }

    // sparkle arps at high intensity
    if (i > 0.72 && step % 4 === 2) {
      const scale = SCALE_MAJOR_PENT;
      for (let k = 0; k < 3; k += 1) {
        pluck(t + k * stepDur() * 0.28, rootMidi + 12 + scale[(k + state.bar) % scale.length], 0.05 * i, 0.1);
      }
    }

    // brass stabs
    if (i > 0.74 && (step === 0 || step === 8)) {
      brass(t, rootMidi - 12, 0.1 + 0.08 * i, stepDur() * 3);
      state.notes += 1;
    }
  }

  function advance() {
    state.cursor += stepDur();
    state.step += 1;
    if (state.step >= 16) {
      state.step = 0;
      state.bar += 1;
      if (state.bar % 4 === 0) regenerateMotif();
      if (state.bar % 16 === 0) {
        state.section += 1;
        // Wander the key so a long session never settles into a rut.
        state.root = 58 + Math.floor(rng() * 7);
      }
    }
  }

  function scheduleUntil(until) {
    let guard = 0;
    while (state.cursor < until && guard < 512) {
      if (state.playing) emitStep(state.cursor, state.step);
      advance();
      guard += 1;
    }
  }

  /* ---- stingers ---- */

  function stingerBank(t) {
    state.stingers += 1;
    state.lastStinger = "bank";
    const scale = SCALE_MAJOR_PENT;
    for (let i = 0; i < 6; i += 1) {
      pluck(t + i * 0.055, state.root + 12 + scale[i % scale.length] + (i >= 5 ? 12 : 0), 0.17, 0.22);
    }
    brass(t + 0.3, state.root, 0.16, 0.5);
    brass(t + 0.3, state.root + 7, 0.12, 0.5);
    hat(t + 0.3, 0.1, true);
  }

  function stingerBreak(t) {
    state.stingers += 1;
    state.lastStinger = "break";
    // The sad trombone. Three descending semitone slumps and a wet raspberry.
    for (let i = 0; i < 3; i += 1) {
      const at = t + i * 0.17;
      const g = envGain(ac, at, 0.2, 0.02, 0.18);
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      lp.Q.value = 4;
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      const f = mtof(state.root - 12 - i * 2);
      osc.frequency.setValueAtTime(f, at);
      osc.frequency.linearRampToValueAtTime(f * 0.89, at + 0.17);
      const vib = ac.createOscillator();
      vib.frequency.value = 6.5;
      const vibGain = ac.createGain();
      vibGain.gain.value = f * 0.02;
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);
      osc.connect(lp);
      lp.connect(g);
      g.connect(bus);
      osc.start(at);
      vib.start(at);
      osc.stop(at + 0.24);
      vib.stop(at + 0.24);
      osc.onended = () => {
        try { osc.disconnect(); vib.disconnect(); vibGain.disconnect(); lp.disconnect(); g.disconnect(); } catch (error) { /* fine */ }
      };
    }
  }

  function accent(t, amount) {
    const scale = SCALE_MAJOR_PENT;
    const idx = Math.min(scale.length - 1, Math.floor(clamp01(amount / 4000) * scale.length));
    pluck(t, state.root + 24 + scale[idx], 0.11, 0.24);
  }

  return {
    state,
    scheduleUntil,
    stingerBank,
    stingerBreak,
    accent,
    setPlaying(on) {
      if (on && !state.playing) state.cursor = Math.max(state.cursor, ac.currentTime + 0.05);
      state.playing = Boolean(on);
    },
    setIntensityTarget(v) { state.target = clamp01(v); },
    setFloor(v) { state.floor = clamp01(v); },
    bumpIntensity(v) { state.target = clamp01(Math.max(state.target, v)); },
    update(dt) {
      // The target sags back toward the play-driven floor at a fixed rate
      // per *second*, so the comedown does not depend on frame rate.
      state.target = clamp01(Math.max(state.floor, state.target - dt * 0.14));
      // Intensity chases its target quickly and decays slowly, so a combo
      // lifts the score instantly but the comedown is gentle.
      const rate = state.target > state.intensity ? 2.6 : 0.32;
      state.intensity = lerp(state.intensity, state.target, clamp01(dt * rate));
      state.bpm = 124 + state.intensity * 38;
      // keep the scheduler honest after a suspend/resume
      if (state.cursor < ac.currentTime - 0.5) state.cursor = ac.currentTime + 0.03;
    },
    report() {
      return {
        playing: state.playing,
        intensity: Number(state.intensity.toFixed(3)),
        target: Number(state.target.toFixed(3)),
        bpm: Number(state.bpm.toFixed(1)),
        floor: Number(state.floor.toFixed(3)),
        bar: state.bar,
        step: state.step,
        root: state.root,
        notes: state.notes,
        stingers: state.stingers,
        lastStinger: state.lastStinger,
        layers: [
          "drums",
          "bass",
          state.intensity > 0.2 ? "hats" : null,
          state.intensity > 0.3 ? "blocks" : null,
          state.intensity > 0.38 ? "lead" : null,
          state.intensity > 0.72 ? "arps" : null,
          state.intensity > 0.74 ? "brass" : null,
        ].filter(Boolean),
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* 9. The system                                                       */
/* ------------------------------------------------------------------ */

export async function createAudio(ctx) {
  const AudioContextCtor = typeof window !== "undefined"
    ? (window.AudioContext || window.webkitAudioContext)
    : null;
  const OfflineCtor = typeof window !== "undefined"
    ? (window.OfflineAudioContext || window.webkitOfflineAudioContext)
    : null;

  /* Private, world-seeded PRNG. See the header for why this is not ctx.rng. */
  const rngSeed = ((ctx.rng ? ctx.rng() : 0.5) * 0xffffffff) >>> 0;
  const rng = makeRng(rngSeed || 0x51a4c3);

  const quality = ctx.settings ? ctx.settings.quality : {};
  const lite = quality.particles !== undefined && quality.particles < 0.5;

  const listener = {
    x: 0, y: 0, z: 0,
    fx: 0, fy: 0, fz: -1,
    ux: 0, uy: 1, uz: 0,
    lastSync: -1,
  };

  const fwd = new ctx.THREE.Vector3();
  const upv = new ctx.THREE.Vector3();
  const heroPos = { x: 0, y: 0, z: 0 };
  const prevHero = { x: 0, y: 0, z: 0, valid: false };

  const levels = { rms: 0, peak: 0, peakHold: 0, samples: 0 };
  let analyserBuffer = null;

  const gait = {
    phase: 0,
    lastStepAt: -1,
    speed: 0,
    grounded: true,
    airborne: false,
  };

  const duckState = { depth: 0, until: 0 };
  const vocalState = { lastAt: -1, lastName: "", repeats: 0 };
  const comboState = { count: 0, best: 0, lastScoreAt: -1e9 };

  let graph = null;
  let sounds = null;
  let music = null;
  let ambience = null;
  let roller = null;
  let contextState = AudioContextCtor ? "uncreated" : "unsupported";
  let unlocked = false;
  let disposed = false;
  let failed = false;
  let surface = "soil";
  let windParam = 0.35;
  let crackleAt = 0;

  const offs = [];

  const worldRadius = (ctx.world && ctx.world.bounds && ctx.world.bounds.radius) || 400;

  /* ---------------------------------------------------------------- */
  /* context lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  function buildLiveGraph() {
    if (graph || failed || !AudioContextCtor) return false;
    let ac = null;
    try {
      ac = new AudioContextCtor({ latencyHint: "interactive" });
    } catch (error) {
      failed = true;
      contextState = "unsupported";
      return false;
    }
    try {
      graph = buildGraph(ac, rng, {
        live: true,
        quality,
        hrtf: !lite,
        masterVolume: ctx.settings ? ctx.settings.masterVolume : 0.8,
        musicVolume: ctx.settings ? ctx.settings.musicVolume : 0.55,
      });
      analyserBuffer = new Float32Array(graph.analyser.fftSize);
      sounds = createSounds(graph);
      music = createMusic(graph);
      ambience = createAmbience(graph, { radius: worldRadius, lite });
      roller = createRoller(graph);
      contextState = ac.state;
      ac.onstatechange = () => {
        contextState = ac.state;
        if (ac.state === "running" && ambience && !ambience.started) {
          ambience.start(ac.currentTime + 0.05);
        }
      };
    } catch (error) {
      failed = true;
      graph = null;
      contextState = "unsupported";
      return false;
    }
    return true;
  }

  /** Called from a real user gesture (or explicitly by QA). */
  function unlock() {
    if (disposed || failed) return Promise.resolve(false);
    if (!graph && !buildLiveGraph()) return Promise.resolve(false);
    const ac = graph.ac;
    if (ac.state === "running") {
      unlocked = true;
      contextState = "running";
      if (!ambience.started) ambience.start(ac.currentTime + 0.05);
      return Promise.resolve(true);
    }
    const promise = ac.resume ? ac.resume() : Promise.resolve();
    return Promise.resolve(promise).then(
      () => {
        unlocked = ac.state === "running";
        contextState = ac.state;
        if (unlocked && !ambience.started) ambience.start(ac.currentTime + 0.05);
        return unlocked;
      },
      () => {
        // Autoplay still blocked. Perfectly normal; stay quiet about it.
        contextState = ac.state;
        return false;
      }
    );
  }

  const gestureEvents = ["pointerdown", "keydown", "touchstart", "click"];
  let gesturesAttached = true;
  const onGesture = () => {
    unlock().then((ok) => { if (ok) detachGestures(); });
  };
  function detachGestures() {
    if (!gesturesAttached) return;
    gesturesAttached = false;
    for (const type of gestureEvents) window.removeEventListener(type, onGesture);
  }
  for (const type of gestureEvents) {
    window.addEventListener(type, onGesture, { passive: true });
  }

  const onVisibility = () => {
    if (!graph || failed) return;
    const ac = graph.ac;
    if (document.hidden) {
      if (ac.state === "running" && ac.suspend) ac.suspend().catch(() => {});
    } else if (unlocked && ac.state === "suspended" && ac.resume) {
      ac.resume().then(() => {
        if (ambience) ambience.resync(ac.currentTime);
      }).catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  /* ---------------------------------------------------------------- */
  /* dispatch                                                          */
  /* ---------------------------------------------------------------- */

  const materialOf = (name) => (name && IMPACT_PROFILES[name] ? name : "soil");
  const surfaceOf = (name) => (name && STEP_PROFILES[name] ? name : "soil");

  function dispatch(name, opts) {
    if (!graph || !sounds || graph.ac.state !== "running") return null;
    const key = SOUND_ALIASES[name] || name;
    switch (key) {
      case "impact": return sounds.impact(opts);
      case "scuttle": return sounds.scuttle({ ...opts, surface: surfaceOf(opts.surface || surface) });
      case "land": return sounds.land(opts);
      case "jump": return sounds.jump(opts);
      case "bonk": return sounds.bonk(opts);
      case "chomp": return sounds.chomp(opts);
      case "grapple": return sounds.grapple(opts);
      case "grappleHit": return sounds.grappleHit(opts);
      case "splash": return sounds.splash(opts);
      case "propBreak": return sounds.propBreak(opts);
      case "cheer": return sounds.cheer(opts);
      case "score": return sounds.ui("up", opts);
      case "comboUp": return sounds.ui("up", { ...opts, root: 74 + Math.min(12, (opts.count || 1) * 2) });
      case "comboBank": return sounds.ui("up", { ...opts, root: 79 });
      case "comboBreak": return sounds.ui("down", { ...opts, root: 66 });
      default:
        if (VOCALS[key]) return sounds.vocal(key, opts);
        return sounds.blip(opts);
    }
  }

  /**
   * Repetition guard: the same vocal fired twenty times in ten seconds
   * gets quieter and eventually drops out. This is the difference
   * between "endearing" and "please stop".
   */
  function speak(name, opts = {}) {
    if (!graph || graph.ac.state !== "running") return null;
    const now = graph.ac.currentTime;
    const gap = now - vocalState.lastAt;
    if (gap < 0.06) return null;
    if (name === vocalState.lastName && gap < 1.4) {
      vocalState.repeats += 1;
    } else {
      vocalState.repeats = 0;
    }
    if (vocalState.repeats > 4) return null;
    const fatigue = Math.pow(0.78, vocalState.repeats);
    vocalState.lastAt = now;
    vocalState.lastName = name;
    return sounds.vocal(name, { ...opts, gain: (opts.gain === undefined ? 1 : opts.gain) * fatigue });
  }

  /* ---------------------------------------------------------------- */
  /* ducking                                                           */
  /* ---------------------------------------------------------------- */

  function duck(amount, seconds = 0.45) {
    if (!graph) return;
    const ac = graph.ac;
    const now = ac.currentTime;
    const depth = clamp01(amount);
    if (depth <= 0.001) return;
    // Do not let a small impact cut short a big one's recovery.
    if (now < duckState.until && depth < duckState.depth * 0.85) return;
    duckState.depth = depth;
    duckState.until = now + seconds;
    for (const node of [graph.musicDuck, graph.ambientDuck]) {
      const g = node.gain;
      const scale = node === graph.ambientDuck ? 0.55 : 1;
      const target = 1 - depth * scale;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(0.0001, g.value), now);
        g.linearRampToValueAtTime(Math.max(0.0001, target), now + 0.02);
        g.setValueAtTime(Math.max(0.0001, target), now + Math.min(0.08, seconds * 0.2));
        g.linearRampToValueAtTime(1, now + seconds);
      } catch (error) { /* param detached */ }
    }
  }

  /* ---------------------------------------------------------------- */
  /* events                                                            */
  /* ---------------------------------------------------------------- */

  function on(type, fn) {
    if (!ctx.events) return;
    offs.push(ctx.events.on(type, fn));
  }

  on("impact", (payload) => {
    if (!payload || !graph) return;
    const speed = payload.speed === undefined ? 12 : Math.abs(payload.speed);
    const material = materialOf(payload.material);
    sounds && sounds.impact({
      material,
      speed,
      position: payload.position,
      distance: "mid",
    });
    if (speed > 26) duck(clamp01((speed - 26) / 45) * 0.55, 0.35 + speed * 0.004);
    if (speed > 34 && rng() < 0.5) speak("grunt", { position: payload.position, gain: 0.7 });
  });

  on("player:land", (payload) => {
    if (!payload || !graph || !sounds) return;
    const speed = payload.impactSpeed === undefined ? 12 : Math.abs(payload.impactSpeed);
    const mat = materialOf(payload.surface || surface);
    if (payload.surface) surface = surfaceOf(payload.surface);
    sounds.impact({ material: mat, speed, position: payload.position, distance: "near", gain: 0.9 });
    if (speed > 30) {
      speak("yelp", { position: payload.position, gain: clamp01((speed - 30) / 30) * 0.7 + 0.3 });
      duck(0.45, 0.5);
    } else if (speed > 16) {
      speak("huff", { position: payload.position, gain: 0.55 });
    }
    gait.lastStepAt = graph.ac.currentTime;
  });

  on("player:jump", (payload) => {
    if (!graph || !sounds) return;
    sounds.jump({ position: payload && payload.position });
  });

  on("player:grapple", (payload) => {
    if (!graph || !sounds) return;
    sounds.grapple({ position: (payload && payload.from) || heroPos });
    if (payload && payload.to) {
      sounds.grappleHit({ position: payload.to, when: graph.ac.currentTime + 0.11 });
    }
  });

  on("player:ragdoll", (payload) => {
    if (!graph) return;
    if (payload && payload.enabled) speak("moan", { position: heroPos, gain: 0.8 });
    else speak("huff", { position: heroPos, gain: 0.6 });
  });

  on("player:tun", (payload) => {
    const enabled = payload && (payload.enabled !== undefined ? payload.enabled : payload) ? true : false;
    if (roller) roller.set(enabled, gait.speed, surface, heroPos);
    if (graph && sounds) sounds.blip({ position: heroPos });
  });

  on("prop:destroyed", (payload) => {
    if (!graph || !sounds || !payload) return;
    sounds.propBreak({ material: materialOf(payload.kind || payload.material), position: payload.position });
    duck(0.3, 0.4);
  });

  on("score", (payload) => {
    if (!graph || !music) return;
    comboState.lastScoreAt = graph.ac.currentTime;
    music.accent(graph.ac.currentTime + 0.01, (payload && payload.amount) || 100);
  });

  on("combo", (payload) => {
    if (!graph || !music || !sounds) return;
    const count = (payload && payload.count) || 0;
    const now = graph.ac.currentTime;
    if (count > comboState.count) {
      music.bumpIntensity(clamp01(0.25 + count * 0.09));
      dispatch("comboUp", { count });
      if (count === 3 || count === 6 || count % 10 === 0) {
        speak("chirp", { position: heroPos, pitch: 1 + Math.min(0.5, count * 0.04) });
      }
    } else if (count === 0 && comboState.count >= 2) {
      // Banked or broken? A score event within a beat means banked.
      if (now - comboState.lastScoreAt < 0.35) {
        music.stingerBank(now + 0.01);
        sounds.cheer({ position: heroPos });
      } else {
        music.stingerBreak(now + 0.01);
        speak("moan", { position: heroPos, gain: 0.7 });
      }
      duck(0.35, 0.5);
    }
    comboState.count = count;
    if (count > comboState.best) comboState.best = count;
  });

  on("settings:changed", () => applyVolumes());
  on("settings:quality", () => applyVolumes());

  const lastVolumes = { master: -1, music: -1 };
  function applyVolumes() {
    if (!graph || !ctx.settings) return;
    const master = clamp01(ctx.settings.masterVolume);
    const musicVol = clamp01(ctx.settings.musicVolume);
    // Only schedule automation when something actually moved - this runs
    // every frame and Web Audio does not need the churn.
    if (master === lastVolumes.master && musicVol === lastVolumes.music) return;
    lastVolumes.master = master;
    lastVolumes.music = musicVol;
    const now = graph.ac.currentTime;
    try {
      graph.master.gain.setTargetAtTime(master, now, 0.05);
      graph.musicBus.gain.setTargetAtTime(musicVol, now, 0.05);
    } catch (error) { /* param detached */ }
  }

  /* ---------------------------------------------------------------- */
  /* per-frame                                                         */
  /* ---------------------------------------------------------------- */

  function readHero() {
    const p = (ctx.player && ctx.player.position)
      || (ctx.tardigrade && ctx.tardigrade.root && ctx.tardigrade.root.position)
      || null;
    if (!p) return false;
    heroPos.x = p.x;
    heroPos.y = p.y;
    heroPos.z = p.z;
    return true;
  }

  /** report() allocates, so poll the slow-moving flags at 10Hz, not 60. */
  const gaitPoll = { at: -1, grounded: true, curled: false };

  function readGait(dt) {
    let speed = 0;
    let grounded = gaitPoll.grounded;
    let curled = gaitPoll.curled;

    const player = ctx.player;
    if (player) {
      if (player.velocity) {
        speed = Math.hypot(player.velocity.x, player.velocity.z);
      }
      const clock = ctx.time ? ctx.time.elapsed : 0;
      if (typeof player.report === "function" && (gaitPoll.at < 0 || clock - gaitPoll.at >= 0.1)) {
        gaitPoll.at = clock;
        const r = player.report();
        if (r) {
          if (typeof r.speed === "number" && !player.velocity) speed = r.speed;
          if (typeof r.grounded === "boolean") gaitPoll.grounded = r.grounded;
          if (typeof r.curled === "boolean") gaitPoll.curled = r.curled;
          if (typeof r.surface === "string") surface = surfaceOf(r.surface);
        }
        grounded = gaitPoll.grounded;
        curled = gaitPoll.curled;
      }
    }
    if (!speed && prevHero.valid && dt > 0) {
      speed = Math.hypot(heroPos.x - prevHero.x, heroPos.z - prevHero.z) / dt;
    }
    prevHero.x = heroPos.x;
    prevHero.y = heroPos.y;
    prevHero.z = heroPos.z;
    prevHero.valid = true;

    gait.speed = speed;
    gait.grounded = grounded;
    gait.airborne = !grounded;
    return curled;
  }

  function updateGait(dt) {
    if (!graph || !sounds || graph.ac.state !== "running") return;
    if (!gait.grounded || roller.active) { gait.phase = 0; return; }
    const norm = clamp01(gait.speed / 20);
    if (norm < 0.06) { gait.phase = 0; return; }

    // Eight legs: the gait fires roughly 3-10 clusters per second.
    const rate = 3 + norm * 7;
    gait.phase += dt * rate;
    if (gait.phase < 1) return;
    gait.phase = 0;

    // Hard floor on step rate in *audio* time. QA's advanceTime() runs
    // hundreds of sim steps in no wall-clock time at all; without this
    // it would machine-gun the mixer.
    const now = graph.ac.currentTime;
    if (now - gait.lastStepAt < 0.045) return;
    gait.lastStepAt = now;

    sounds.scuttle({
      surface,
      intensity: 0.25 + norm * 0.85,
      position: heroPos,
    });
  }

  function syncListener() {
    if (!graph || !ctx.camera) return;
    const ac = graph.ac;
    const now = ac.currentTime;
    // One update per ~8ms of audio time, no matter how often we are called.
    if (listener.lastSync >= 0 && now - listener.lastSync < 0.008) return;
    const delta = listener.lastSync < 0 ? 0.02 : clamp(now - listener.lastSync, 0.006, 0.1);
    listener.lastSync = now;

    const cam = ctx.camera;
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    upv.set(0, 1, 0).applyQuaternion(cam.quaternion);

    listener.x = cam.position.x;
    listener.y = cam.position.y;
    listener.z = cam.position.z;
    listener.fx = fwd.x; listener.fy = fwd.y; listener.fz = fwd.z;
    listener.ux = upv.x; listener.uy = upv.y; listener.uz = upv.z;

    const L = ac.listener;
    const end = now + delta;
    if (L.positionX) {
      L.positionX.linearRampToValueAtTime(listener.x, end);
      L.positionY.linearRampToValueAtTime(listener.y, end);
      L.positionZ.linearRampToValueAtTime(listener.z, end);
      L.forwardX.linearRampToValueAtTime(listener.fx, end);
      L.forwardY.linearRampToValueAtTime(listener.fy, end);
      L.forwardZ.linearRampToValueAtTime(listener.fz, end);
      L.upX.linearRampToValueAtTime(listener.ux, end);
      L.upY.linearRampToValueAtTime(listener.uy, end);
      L.upZ.linearRampToValueAtTime(listener.uz, end);
    } else {
      if (L.setPosition) L.setPosition(listener.x, listener.y, listener.z);
      if (L.setOrientation) L.setOrientation(listener.fx, listener.fy, listener.fz, listener.ux, listener.uy, listener.uz);
    }
  }

  function sampleLevels() {
    if (!graph || !analyserBuffer) return levels;
    try {
      graph.analyser.getFloatTimeDomainData(analyserBuffer);
    } catch (error) {
      return levels;
    }
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < analyserBuffer.length; i += 1) {
      const v = analyserBuffer[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    levels.rms = Math.sqrt(sum / analyserBuffer.length);
    levels.peak = peak;
    if (peak > levels.peakHold) levels.peakHold = peak;
    levels.samples += 1;
    return levels;
  }

  /* ---------------------------------------------------------------- */
  /* offline preview rendering                                         */
  /* ---------------------------------------------------------------- */

  const PREVIEW_KINDS = ["music", "impacts", "creature", "movement", "ambience"];

  async function renderPreview(kind = "music", seconds = 10) {
    if (!OfflineCtor) throw new Error("OfflineAudioContext unavailable");
    const sampleRate = 48000;
    const frames = Math.max(1, Math.round(seconds * sampleRate));
    const oac = new OfflineCtor(2, frames, sampleRate);
    const prng = makeRng(0xbeef00 + PREVIEW_KINDS.indexOf(kind) + 1);
    const g = buildGraph(oac, prng, {
      live: false, quality: { ssao: true }, hrtf: true, masterVolume: 0.85, musicVolume: 0.7,
    });
    const s = createSounds(g);

    // A fixed listener so the stereo image is stable in the preview.
    const L = oac.listener;
    if (L.positionX) {
      L.positionX.value = 0; L.positionY.value = 3; L.positionZ.value = 8;
      L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else if (L.setPosition) {
      L.setPosition(0, 3, 8);
      L.setOrientation(0, 0, -1, 0, 1, 0);
    }

    if (kind === "music") {
      const m = createMusic(g);
      m.state.cursor = 0.1;
      m.setPlaying(true);
      // Walk intensity up across the render so every layer gets an airing.
      const chunk = 0.25;
      for (let t = 0; t < seconds - 1.2; t += chunk) {
        m.state.intensity = clamp01(t / (seconds - 3));
        m.state.bpm = 124 + m.state.intensity * 38;
        m.scheduleUntil(Math.min(t + chunk, seconds - 1.2));
      }
      m.stingerBank(seconds - 1.1);
      m.stingerBreak(seconds - 0.55);
    } else if (kind === "impacts") {
      const list = IMPACT_MATERIALS;
      const gapT = (seconds - 0.6) / list.length;
      for (let i = 0; i < list.length; i += 1) {
        const t = 0.15 + i * gapT;
        s.impact({ material: list[i], speed: 14, when: t, position: { x: -3, y: 1, z: 0 }, distance: "near" });
        s.impact({ material: list[i], speed: 42, when: t + gapT * 0.45, position: { x: 3, y: 1, z: 0 }, distance: "near" });
      }
    } else if (kind === "creature") {
      const names = Object.keys(VOCALS);
      const gapT = (seconds - 1.4) / (names.length + 2);
      names.forEach((name, i) => {
        s.vocal(name, { when: 0.2 + i * gapT, position: { x: 0, y: 1, z: 2 } });
      });
      s.cheer({ when: 0.2 + names.length * gapT, position: { x: 0, y: 1, z: 2 } });
      s.bonk({ when: 0.2 + (names.length + 1) * gapT, position: { x: 0, y: 1, z: 2 } });
    } else if (kind === "movement") {
      const surfaces = ["soil", "gravel", "concrete", "leaf", "water"];
      const span = (seconds - 0.4) / surfaces.length;
      surfaces.forEach((name, i) => {
        const t0 = 0.15 + i * span;
        let t = t0;
        let k = 0;
        while (t < t0 + span * 0.82) {
          const norm = 0.3 + 0.6 * Math.sin((k / 14) * Math.PI);
          s.scuttle({
            surface: name,
            intensity: norm,
            when: t,
            position: { x: Math.sin(k * 0.4) * 3, y: 0.5, z: Math.cos(k * 0.4) * 3 },
          });
          t += 1 / (3 + norm * 7);
          k += 1;
        }
      });
    } else if (kind === "ambience") {
      const amb = createAmbience(g, { radius: worldRadius, lite: false });
      amb.start(0);
      amb.setWind(0.75);
      amb.scheduleUntil(seconds);
    }

    const buffer = await oac.startRendering();
    return { kind, sampleRate, seconds, wav: encodeWavBase64(buffer) };
  }

  /* ---------------------------------------------------------------- */
  /* public API                                                        */
  /* ---------------------------------------------------------------- */

  /** Current muffle target, so we only touch the AudioParam on real change. */
  let submergeAmount = -1;

  const api = {
    /**
     * @param {number} amount 0 = dry, 1 = fully under.
     * Sweeps the master lowpass exponentially, because pitch perception is
     * logarithmic - a linear sweep spends most of its travel somewhere the
     * ear reads as already muffled.
     */
    setSubmersion(amount) {
      // buildGraph() is a separate closure (it also runs against an offline
      // context for pre-rendering), so the node has to be reached through
      // the graph object rather than captured directly.
      const filter = graph && graph.submergeFilter;
      if (!filter) return;
      const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
      if (Math.abs(a - submergeAmount) < 0.02) return;
      submergeAmount = a;
      const hz = 20000 * Math.pow(620 / 20000, a);
      filter.frequency.setTargetAtTime(hz, graph.ac.currentTime, 0.09);
    },

    /* --- playback --- */
    play(name, opts = {}) {
      if (!graph) return null;
      return dispatch(name, opts);
    },
    playAt(name, position, opts = {}) {
      if (!graph) return null;
      return dispatch(name, { ...opts, position: position || heroPos });
    },
    speak,

    /* --- parameters --- */
    setWind(strength) {
      windParam = clamp01(strength);
      if (ambience) ambience.setWind(windParam);
    },
    duck,
    setSurface(name) { surface = surfaceOf(name); },
    setRolling(active, speed, name) {
      if (!graph) return;
      if (name) surface = surfaceOf(name);
      roller.set(active, speed === undefined ? gait.speed : speed, surface, heroPos);
    },
    setWaterSource(position, radius) {
      if (ambience) ambience.setWaterSource(position, radius);
    },
    setMusicIntensity(v) { if (music) music.setIntensityTarget(v); },

    /* --- lifecycle --- */
    unlock,
    get context() { return graph ? graph.ac : null; },
    get analyser() { return graph ? graph.analyser : null; },
    suspend() {
      if (graph && graph.ac.state === "running" && graph.ac.suspend) return graph.ac.suspend();
      return Promise.resolve();
    },
    resume() { return unlock(); },
    sampleLevels,
    resetPeak() { levels.peakHold = 0; levels.samples = 0; },
    renderPreview,
    previewKinds: PREVIEW_KINDS.slice(),

    /* --- frame hooks --- */
    update(dt) {
      if (disposed || failed) return;

      // These run with or without audio so state stays coherent if the
      // context unlocks halfway through a session.
      readHero();
      const curled = readGait(dt);
      if (curled !== undefined && roller && curled !== roller.active) {
        roller.set(curled, gait.speed, surface, heroPos);
      }

      if (!graph) return;
      const ac = graph.ac;
      if (ac.state !== "running") return;

      applyVolumes();
      updateGait(dt);

      roller.set(roller.active, gait.speed, surface, heroPos);
      roller.update();
      if (roller.wantsCrackle()) {
        const now = ac.currentTime;
        if (now > crackleAt) {
          crackleAt = now + lerp(0.03, 0.12, rng()) / Math.max(0.25, clamp01(gait.speed / 20));
          sounds.scuttle({ surface, intensity: 0.25, position: heroPos, gain: 0.5 });
        }
      }

      ambience.update(dt);
      ambience.scheduleUntil(ac.currentTime + 0.9);

      music.setPlaying(ctx.state.phase !== "loading" && ctx.state.phase !== "paused");
      // Combo and motion set the resting level; stingers and combo bumps
      // push above it and decay back down inside music.update().
      music.setFloor(
        Math.min(0.78, comboState.count * 0.11) + clamp01(gait.speed / 26) * 0.18
      );
      music.update(dt);
      music.scheduleUntil(ac.currentTime + 0.2);

      sweepVoices(graph);
      sampleLevels();
    },

    lateUpdate() {
      if (disposed || failed || !graph) return;
      if (graph.ac.state !== "running") return;
      syncListener();
    },

    /* --- diagnostics --- */
    report() {
      const byCategory = {};
      let total = 0;
      if (graph) {
        for (let i = 0; i < graph.voices.length; i += 1) {
          const c = graph.voices[i].category;
          byCategory[c] = (byCategory[c] || 0) + 1;
          total += 1;
        }
      }
      const toDb = (v) => (v > 1e-7 ? Number((20 * Math.log10(v)).toFixed(2)) : -120);
      return {
        supported: Boolean(AudioContextCtor),
        state: graph ? graph.ac.state : contextState,
        unlocked,
        failed,
        sampleRate: graph ? graph.ac.sampleRate : 0,
        currentTime: graph ? Number(graph.ac.currentTime.toFixed(3)) : 0,
        spatial: graph ? graph.spatial : false,
        hrtf: !lite,
        voices: {
          total,
          byCategory,
          fading: graph ? graph.pending.length : 0,
          spawned: graph ? graph.spawned : 0,
          released: graph ? graph.released : 0,
          stolen: graph ? graph.stolen : 0,
          refused: graph ? graph.refused : 0,
          peak: graph ? graph.peakVoices : 0,
          caps: VOICE_CAPS,
          totalCap: TOTAL_VOICE_CAP,
        },
        buses: graph ? {
          master: Number(graph.master.gain.value.toFixed(3)),
          music: Number(graph.musicBus.gain.value.toFixed(3)),
          musicDuck: Number(graph.musicDuck.gain.value.toFixed(3)),
          ambient: Number(graph.ambientBus.gain.value.toFixed(3)),
          ambientDuck: Number(graph.ambientDuck.gain.value.toFixed(3)),
          reverb: graph.reverbSend ? Number(graph.reverbSend.gain.value.toFixed(3)) : 0,
        } : null,
        levels: {
          rms: Number(levels.rms.toFixed(6)),
          peak: Number(levels.peak.toFixed(6)),
          peakHold: Number(levels.peakHold.toFixed(6)),
          rmsDb: toDb(levels.rms),
          peakDb: toDb(levels.peak),
          peakHoldDb: toDb(levels.peakHold),
          samples: levels.samples,
        },
        listener: {
          x: Number(listener.x.toFixed(3)),
          y: Number(listener.y.toFixed(3)),
          z: Number(listener.z.toFixed(3)),
          forward: [Number(listener.fx.toFixed(3)), Number(listener.fy.toFixed(3)), Number(listener.fz.toFixed(3))],
          up: [Number(listener.ux.toFixed(3)), Number(listener.uy.toFixed(3)), Number(listener.uz.toFixed(3))],
          param: graph && graph.ac.listener.positionX ? {
            x: Number(graph.ac.listener.positionX.value.toFixed(3)),
            y: Number(graph.ac.listener.positionY.value.toFixed(3)),
            z: Number(graph.ac.listener.positionZ.value.toFixed(3)),
            fx: Number(graph.ac.listener.forwardX.value.toFixed(3)),
            fy: Number(graph.ac.listener.forwardY.value.toFixed(3)),
            fz: Number(graph.ac.listener.forwardZ.value.toFixed(3)),
          } : null,
        },
        movement: {
          surface,
          speed: Number(gait.speed.toFixed(2)),
          grounded: gait.grounded,
          rolling: roller ? roller.active : false,
        },
        wind: Number(windParam.toFixed(3)),
        ambience: ambience ? {
          started: ambience.started,
          wind: Number(ambience.wind.toFixed(3)),
          layers: ambience.layers,
          scheduled: ambience.counts,
        } : null,
        music: music ? music.report() : null,
        combo: { count: comboState.count, best: comboState.best },
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) { try { off(); } catch (error) { /* fine */ } }
      offs.length = 0;
      detachGestures();
      document.removeEventListener("visibilitychange", onVisibility);
      if (roller) roller.dispose();
      if (ambience) ambience.dispose();
      if (graph) {
        for (const voice of graph.voices.slice()) disposeVoice(graph, voice);
        for (const voice of graph.pending.slice()) disposeVoice(graph, voice);
        graph.voices.length = 0;
        graph.pending.length = 0;
        try { graph.ac.close(); } catch (error) { /* fine */ }
        graph = null;
      }
      contextState = "closed";
    },
  };

  // If the page already had a gesture before we loaded (a click on the
  // start button, say), we are allowed to start right now.
  if (typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive) {
    unlock();
  }

  return api;
}
