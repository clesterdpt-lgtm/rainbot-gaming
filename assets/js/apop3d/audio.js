/* ============================================================
   APOP DEMON MOGGERS 3D - audio

   Every sound in this game is synthesised. There is not one audio
   file: the kick, the snare, the bass, the arpeggio, the pad, the
   fanfare, every footstep and every coin is built at runtime out of
   oscillators, procedurally filled noise buffers and filters.

   SIGNAL FLOW

     one-shots -> [panner] -> sfxBus  --------------.
     music     ->            musicBus -> musicDuck -+-> master -> limiter
                                                                     |
                                                            destination

   ------------------------------------------------------------
   THE BEAT CLOCK IS THE POINT OF THIS FILE

   ctx.clock.beat is handed over to this module the moment it exposes
   beatPhase() - main.js stops computing it from the wall clock (see
   its beat block) and every on-beat bonus, enemy step and material
   pulse in the game reads what is written here. So:

   * The phase is derived from ONE transport origin, expressed in
     AudioContext time, and the music scheduler derives its step
     indices from that same origin. The beat the player hears and the
     beat the combat window tests against are therefore the same
     event by construction, not two clocks that agree approximately.

   * It is offset by the output latency. Audio scheduled at time T is
     HEARD at T + outputLatency, so the beat audible right now is the
     one that was scheduled at currentTime - outputLatency. Without
     this the on-beat window is early by 20-40ms on every machine,
     which is exactly enough to feel wrong and not enough to explain.

   * When the context is suspended - before the first gesture, which
     is most of a screenshot run - AudioContext time does not advance.
     The beat then runs off ctx.clock.t instead, and the handover
     re-anchors the origin so the phase is continuous across it. The
     game is fully playable, and fully in time, in silence.

   ------------------------------------------------------------
   TWO RULES THE BROWSER IMPOSES, BOTH LOAD-BEARING

   * An AudioContext starts SUSPENDED until a real user gesture.
     Nothing here may throw, queue up or warn if it tries to make a
     sound before that. Every entry point is callable at any time.

   * Every node is single-use. An OscillatorNode or BufferSource that
     has been started cannot be restarted, so voices are built per
     sound and left to be collected. The expensive part - the noise
     buffer - is built once and shared.

   ------------------------------------------------------------
   SCHEDULING

   Notes are scheduled ahead into the AudioContext's own timeline,
   never triggered by a timer. The timer only decides how often we
   look; the note times themselves are exact. A 25ms interval and a
   180ms horizon means a stalled frame - or headless Chromium's 1fps
   rAF throttle - cannot make the music stutter.
   ============================================================ */

import { clamp, clamp01, lerp, makeRng } from "apop3d/core.js";

const BPM = 124;
const SEC_PER_BEAT = 60 / BPM;
const STEPS_PER_BEAT = 4;          // 16th-note grid
const STEPS_PER_BAR = 16;
const STEP_DUR = SEC_PER_BEAT / STEPS_PER_BEAT;
const ON_BEAT_WINDOW = 0.14;       // matches main.js, either side of the beat

const LOOKAHEAD = 0.18;            // seconds of audio scheduled in advance
const TICK_MS = 25;                // how often we look, not when notes play
const NOISE_SECONDS = 2.0;
const MAX_VOICES = 30;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------------ */
/* Musical material                                                    */
/* ------------------------------------------------------------------ */

const SCALE = {
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
  natMinor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

const TRIAD = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  sus: [0, 5, 7],
  dim: [0, 3, 6],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dom7: [0, 4, 7, 10],
  min9: [0, 3, 7, 10, 14],
};

/** 16-step patterns. `1` is a hit, `2` is an accent. Written out as
 *  arrays rather than generated because a drum pattern is a piece of
 *  authorship and the arrays are readable as notation. */
const P = (s) => s.split("").map((c) => (c === "." ? 0 : c === "X" ? 2 : 1));

/**
 * One entry per course.
 *
 * The instrumentation and the key are what make a course identifiable
 * from four bars with your eyes shut, which is the whole reason this
 * is per-course rather than one bed with a filter on it.
 */
const COURSES = {
  // The Label Lobby. Nothing is chasing you; the hub is the only
  // place in the game with no snare.
  0: {
    id: "hub", root: 55, scale: SCALE.majorPent, swing: 0.16,
    prog: [{ r: 0, t: "maj7" }, { r: 9, t: "min7" }, { r: 5, t: "maj7" }, { r: 7, t: "dom7" }],
    kick: P("x.......x......."),
    snare: P("................"),
    clap: P("................"),
    hat: P("..x...x...x...x."),
    bassRhythm: P("x.......x...x..."),
    bass: { shape: "sine", sub: true, cut: 900, drive: 0 },
    arp: { shape: "triangle", mode: "up", rate: 4, gain: 0.10, octave: 12 },
    pad: { shape: "sine", gain: 0.075, attack: 0.9, spread: 6 },
    lead: null,
    gains: { kick: 0.50, snare: 0, hat: 0.05, bass: 0.16, pad: 1, arp: 1 },
    master: 0.55,
  },

  // 1 - The Mall Food Court. Plastic, bright, a bit cheap. Marimba
  // pluck over a slap bass, A minor pentatonic.
  1: {
    id: "foodcourt", root: 57, scale: SCALE.minorPent, swing: 0.18,
    prog: [{ r: 0, t: "min7" }, { r: 5, t: "min7" }, { r: 3, t: "maj" }, { r: 7, t: "min" }],
    kick: P("x.....x...x....."),
    snare: P("....x.......x..."),
    clap: P("................"),
    hat: P("..x.x.x.x.x.x.x."),
    bassRhythm: P("x..x..x...x.x..."),
    bass: { shape: "square", sub: true, cut: 1500, drive: 0.1 },
    arp: { shape: "triangle", mode: "updown", rate: 2, gain: 0.13, octave: 12 },
    pad: { shape: "sawtooth", gain: 0.05, attack: 0.5, spread: 9 },
    lead: { shape: "square", gain: 0.09, steps: P("............x.x.") },
    gains: { kick: 0.68, snare: 0.30, hat: 0.075, bass: 0.20, pad: 1, arp: 1 },
    master: 0.6,
  },

  // 2 - The Awards-Show Red Carpet. Glossy and self-important:
  // strings pad, FM bell, claps on the backbeat. D minor.
  2: {
    id: "redcarpet", root: 50, scale: SCALE.natMinor, swing: 0.08,
    prog: [{ r: 0, t: "min9" }, { r: 8, t: "maj7" }, { r: 5, t: "min7" }, { r: 10, t: "maj7" }],
    kick: P("x.......x......."),
    snare: P("....x.......x..."),
    clap: P("....x.......x..x"),
    hat: P("..x...x...x...xx"),
    bassRhythm: P("x.....x.x......."),
    bass: { shape: "sawtooth", sub: true, cut: 700, drive: 0.05 },
    arp: { shape: "bell", mode: "up", rate: 2, gain: 0.11, octave: 24 },
    pad: { shape: "strings", gain: 0.10, attack: 1.2, spread: 12 },
    lead: { shape: "sawtooth", gain: 0.075, steps: P("........x...x.x.") },
    gains: { kick: 0.62, snare: 0.22, hat: 0.06, bass: 0.19, pad: 1, arp: 1 },
    master: 0.6,
  },

  // 3 - The Streaming Farm Basement. Cold, mechanical, relentless
  // 16ths. C minor, phrygian colour, distorted bass.
  3: {
    id: "farm", root: 48, scale: SCALE.phrygian, swing: 0,
    prog: [{ r: 0, t: "min" }, { r: 0, t: "min" }, { r: 1, t: "maj" }, { r: 10, t: "maj" }],
    kick: P("x...x...x...x..x"),
    snare: P("....x.......x..."),
    clap: P("................"),
    hat: P("xxxxxxxxxxxxxxxx"),
    bassRhythm: P("x.x.x.x.x.x.x.x."),
    bass: { shape: "sawtooth", sub: false, cut: 480, drive: 0.55 },
    arp: { shape: "bell", mode: "random", rate: 1, gain: 0.085, octave: 24 },
    pad: { shape: "gated", gain: 0.085, attack: 0.03, spread: 5 },
    lead: null,
    gains: { kick: 0.70, snare: 0.26, hat: 0.045, bass: 0.24, pad: 1, arp: 1 },
    master: 0.58,
  },

  // 4 - Influencer Rooftop Afterparty. The hyperpop one: detuned
  // supersaw, hard four-on-the-floor, sidechain pump. F# minor.
  4: {
    id: "rooftop", root: 54, scale: SCALE.natMinor, swing: 0,
    prog: [{ r: 0, t: "min" }, { r: 8, t: "maj" }, { r: 5, t: "maj" }, { r: 3, t: "maj" }],
    kick: P("x...x...x...x..."),
    snare: P("....x.......x..."),
    clap: P("....x.......x..."),
    hat: P(".x.x.x.x.x.x.xxx"),
    bassRhythm: P("x.x.x.x.x.x.x.x."),
    bass: { shape: "square", sub: true, cut: 1100, drive: 0.3 },
    arp: { shape: "supersaw", mode: "updown", rate: 1, gain: 0.085, octave: 12 },
    pad: { shape: "supersaw", gain: 0.075, attack: 0.25, spread: 14 },
    lead: { shape: "supersaw", gain: 0.075, steps: P("..x...x.....x...") },
    gains: { kick: 0.80, snare: 0.20, hat: 0.055, bass: 0.20, pad: 1, arp: 1 },
    pump: 0.55,
    master: 0.6,
  },

  // 5 - Boyz II Hell, the Final Livestream. Half-time, heavy, choir.
  // E minor. This is a course and also the last boss's home key, so
  // the boss bed below drops straight into it without a modulation.
  5: {
    id: "livestream", root: 52, scale: SCALE.natMinor, swing: 0,
    prog: [{ r: 0, t: "min" }, { r: 0, t: "min" }, { r: 8, t: "maj" }, { r: 7, t: "maj" }],
    kick: P("x.....x.x......."),
    snare: P("........x......."),
    clap: P("................"),
    hat: P("..x...x...x...x."),
    bassRhythm: P("x..x..x.x..x...."),
    bass: { shape: "sawtooth", sub: true, cut: 420, drive: 0.7 },
    arp: { shape: "supersaw", mode: "up", rate: 2, gain: 0.075, octave: 12 },
    pad: { shape: "choir", gain: 0.10, attack: 0.7, spread: 12 },
    lead: { shape: "sawtooth", gain: 0.085, steps: P("............x..x") },
    gains: { kick: 0.78, snare: 0.30, hat: 0.05, bass: 0.24, pad: 1, arp: 1 },
    master: 0.6,
  },
};

/**
 * The boss bed.
 *
 * Phase-reactive: `layers` gates each voice on the boss phase, and a
 * layer only ever enters on a BAR line. A layer that fades in mid-bar
 * sounds like a mixing accident rather than like the fight escalating,
 * which is the entire point of doing it this way.
 */
const BOSS = {
  id: "boss", root: 52, scale: SCALE.phrygian, swing: 0,
  prog: [{ r: 0, t: "min" }, { r: 1, t: "maj" }, { r: 0, t: "min" }, { r: 10, t: "maj" }],
  kick: P("x..x..x.x..x..x."),
  snare: P("....x.......x..."),
  clap: P("....x.......x..."),
  hat: P("..x...x...x...x."),
  hatFast: P("xxxxxxxxxxxxxxxx"),
  bassRhythm: P("x.x.x.x.x.x.x.x."),
  bass: { shape: "sawtooth", sub: true, cut: 380, drive: 0.8 },
  arp: { shape: "supersaw", mode: "updown", rate: 1, gain: 0.09, octave: 12 },
  pad: { shape: "choir", gain: 0.11, attack: 0.5, spread: 14 },
  lead: { shape: "supersaw", gain: 0.10, steps: P("........x...x.x.") },
  stab: P("x..............."),
  gains: { kick: 0.82, snare: 0.32, hat: 0.055, bass: 0.26, pad: 1, arp: 1 },
  master: 0.64,
  // Which phase each layer joins at.
  layers: { kick: 0, bass: 0, hat: 0, pad: 1, snare: 1, arp: 2, clap: 2, lead: 3, hatFast: 3 },
};

/** Footstep character per surface. `band` is the resonance the strike
 *  excites, `body` the thump under it. Getting these different is how
 *  a player hears that they have stepped off carpet onto metal. */
const SURFACE_STEP = {
  tile: { band: 2400, q: 1.6, decay: 0.045, body: 150, bodyGain: 0.20, gain: 0.13, rate: 1.6 },
  stone: { band: 1500, q: 1.1, decay: 0.055, body: 110, bodyGain: 0.26, gain: 0.13, rate: 1.2 },
  metal: { band: 3600, q: 6.0, decay: 0.10, body: 190, bodyGain: 0.16, gain: 0.11, rate: 1.9, ring: 5200 },
  carpet: { band: 620, q: 0.7, decay: 0.055, body: 90, bodyGain: 0.20, gain: 0.085, rate: 0.55 },
  grass: { band: 1900, q: 0.6, decay: 0.05, body: 80, bodyGain: 0.12, gain: 0.09, rate: 1.0 },
  wood: { band: 1100, q: 2.2, decay: 0.07, body: 130, bodyGain: 0.24, gain: 0.12, rate: 1.1 },
  sand: { band: 2600, q: 0.5, decay: 0.07, body: 70, bodyGain: 0.10, gain: 0.09, rate: 1.0 },
  water: { band: 1400, q: 0.5, decay: 0.13, body: 60, bodyGain: 0.10, gain: 0.14, rate: 0.8 },
  ice: { band: 4200, q: 3.5, decay: 0.05, body: 160, bodyGain: 0.14, gain: 0.11, rate: 2.1 },
  snow: { band: 900, q: 0.5, decay: 0.06, body: 70, bodyGain: 0.10, gain: 0.075, rate: 0.7 },
  default: { band: 1600, q: 1.0, decay: 0.055, body: 120, bodyGain: 0.22, gain: 0.12, rate: 1.2 },
};

/** The Clout chain. A pentatonic ladder, so a twelve-coin run is a
 *  melody rather than a siren. SM64's rising coin pitch is one of the
 *  most imitated details in the genre and it is imitated here on
 *  purpose. */
const COIN_LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
const COIN_CHAIN_RESET = 1.4;   // seconds of silence that ends a chain

/* ------------------------------------------------------------------ */

/** Callable, silent, never throws. Returned when Web Audio is missing
 *  or blocked outright - the game must run identically without it. */
function silentApi(ctx) {
  const listeners = new Set();
  let beatOrigin = 0;
  let lastIndex = -1;

  function tickClock(context) {
    const c = context.clock;
    const beats = (c.t - beatOrigin) / SEC_PER_BEAT;
    const index = Math.floor(beats);
    c.beatIndex = index;
    c.beat = beats - index;
    const toNearest = Math.min(c.beat, 1 - c.beat) * SEC_PER_BEAT;
    c.onBeat = toNearest <= ON_BEAT_WINDOW;
    if (index !== lastIndex && index >= 0) {
      lastIndex = index;
      for (const fn of listeners) {
        try { fn({ index, strength: index % 4 === 0 ? 1 : 0.5 }); } catch (_) { /* listener's problem */ }
      }
    }
  }

  return {
    available: false,
    beatPhase() { return ctx.clock.beat || 0; },
    onBeat(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    play() { return null; },
    music() {},
    duck() {},
    setMuted() {},
    setMusicVolume() {},
    bossPhase() {},
    resume() { return Promise.resolve(false); },
    stats() { return { available: false }; },
    update(context) { tickClock(context); },
    dispose() { listeners.clear(); },
  };
}

/* ------------------------------------------------------------------ */

export function create(ctx) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return silentApi(ctx);

  let ac;
  try {
    ac = new Ctor({ latencyHint: "interactive" });
  } catch (error) {
    console.warn("[apop3d] Web Audio unavailable", error);
    return silentApi(ctx);
  }

  // Created suspended and kept that way until a real gesture. Chrome
  // starts it suspended on its own; Safari does not always, and an
  // AudioContext that is running before the player has touched
  // anything is how a game ends up making noise on a page the user
  // has not interacted with.
  if (ac.state !== "suspended") { try { ac.suspend(); } catch (error) { /* fine */ } }

  const rng = makeRng(0x9c17);

  /* ---------------------------- the graph --------------------------- */

  const master = ac.createGain();
  master.gain.value = 0.85;

  /**
   * A limiter on the way out.
   *
   * Threshold near the ceiling and a steep ratio: inaudible on a
   * single sound, and only engaging when a fanfare, a pound and four
   * enemy pops arrive in the same 50ms. Set lower it becomes a mix
   * compressor and pulls every quiet sound down with the loud one.
   */
  const limiter = ac.createDynamicsCompressor ? ac.createDynamicsCompressor() : null;
  if (limiter) {
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 18;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter);
    limiter.connect(ac.destination);
  } else {
    master.connect(ac.destination);
  }

  const sfxBus = ac.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(master);

  const musicBus = ac.createGain();
  musicBus.gain.value = 0.62;
  const musicFade = ac.createGain();     // course crossfades live here
  musicFade.gain.value = 0;
  const musicDuck = ac.createGain();     // ducking lives here
  musicDuck.gain.value = 1;
  musicBus.connect(musicFade);
  musicFade.connect(musicDuck);
  musicDuck.connect(master);

  /* One noise buffer, shared by every noise voice in the game.
     Generating a fresh one per footstep allocates 350KB and blocks the
     main thread, twice a second, forever. Seeded rather than
     Math.random so two runs of a build are identical. */
  const noiseBuffer = ac.createBuffer(1, Math.floor(ac.sampleRate * NOISE_SECONDS), ac.sampleRate);
  {
    const d = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      const w = rng() * 2 - 1;
      // Slightly brown-tinted. Pure white reads as a hiss; rolling it
      // off gives everything built on it some weight.
      last = (last + w * 0.06) / 1.02;
      d[i] = clamp(w * 0.7 + last * 3.0, -1, 1);
    }
  }

  /** Fixed soft-clip curve. A mathematical guarantee that the bus
   *  cannot reach full scale whatever twenty overlapping sounds do. */
  const driveCurves = new Map();
  function driveCurve(amount) {
    const key = Math.round(amount * 10);
    let curve = driveCurves.get(key);
    if (curve) return curve;
    const n = 1024;
    curve = new Float32Array(n);
    const k = 1 + amount * 12;
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    driveCurves.set(key, curve);
    return curve;
  }

  /* ----------------------------- state ----------------------------- */

  const state = {
    started: false,       // a gesture has resumed the context
    muted: false,
    voices: 0,
    notes: 0,
    coinChain: 0,
    coinAt: -99,
    jumpChain: 0,
  };

  /**
   * The beat clock. `source` is which domain the origin is expressed
   * in - see the file header for why there are two and why the
   * handover has to re-anchor rather than restart.
   */
  const beatClock = {
    source: "sim",
    simOrigin: 0,
    audioOrigin: 0,
    lastIndex: -1,
  };
  const beatListeners = new Set();

  function outputLatency() {
    const l = ac.outputLatency;
    if (Number.isFinite(l) && l > 0 && l < 0.5) return l;
    const b = ac.baseLatency;
    return Number.isFinite(b) && b > 0 && b < 0.5 ? b : 0;
  }

  /** Total beats elapsed, fractional. The single source of truth for
   *  both ctx.clock.beat and the music scheduler's step index. */
  function beatsNow() {
    if (beatClock.source === "audio") {
      return (ac.currentTime - outputLatency() - beatClock.audioOrigin) / SEC_PER_BEAT;
    }
    return (ctx.clock.t - beatClock.simOrigin) / SEC_PER_BEAT;
  }

  /** Move the origin into the AudioContext domain without moving the
   *  phase. The player must not hear the beat jump when the first
   *  gesture lands. */
  function anchorToAudio() {
    if (beatClock.source === "audio") return;
    const beats = beatsNow();
    beatClock.audioOrigin = (ac.currentTime - outputLatency()) - beats * SEC_PER_BEAT;
    beatClock.source = "audio";
  }

  /* ---------------------------- voices ----------------------------- */

  const pannerPool = [];

  function acquirePanner() {
    const p = pannerPool.pop() || ac.createPanner();
    try { p.panningModel = "equalpower"; } catch (error) { /* older Safari */ }
    p.distanceModel = "inverse";
    p.refDistance = 6;
    p.rolloffFactor = 1.1;
    p.maxDistance = 140;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    p.coneOuterGain = 1;
    return p;
  }

  function setPannerPosition(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    } else if (p.setPosition) {
      p.setPosition(x, y, z);
    }
  }

  /**
   * A voice: one gain node routed to a bus, self-cleaning.
   *
   * Callers connect their own sub-graph INTO the returned node, so the
   * routing onward - and whether a panner is spliced in - is this
   * function's business and not every caller's.
   *
   * A hard voice cap matters more than it looks: past about thirty
   * simultaneous voices the failure mode is not "quieter", it is
   * crackling and dropped frames.
   */
  function voice(duration, opts) {
    if (state.muted || !running()) return null;
    if (state.voices >= MAX_VOICES) return null;
    const g = ac.createGain();
    const level = Number.isFinite(opts && opts.gain) ? clamp(opts.gain, 0, 4) : 1;
    g.gain.value = level;

    let tail = g;
    let panner = null;
    if (opts && opts.pos && Number.isFinite(opts.pos.x)) {
      panner = acquirePanner();
      setPannerPosition(panner, opts.pos.x, opts.pos.y || 0, opts.pos.z || 0);
      g.connect(panner);
      panner.connect(sfxBus);
      tail = panner;
    } else {
      g.connect(sfxBus);
    }

    state.voices += 1;
    window.setTimeout(() => {
      state.voices = Math.max(0, state.voices - 1);
      try { g.disconnect(); } catch (error) { /* already gone */ }
      if (panner) {
        try { panner.disconnect(); } catch (error) { /* already gone */ }
        if (pannerPool.length < 32) pannerPool.push(panner);
      }
    }, Math.ceil(Math.max(0.05, duration) * 1000) + 120);
    return g;
  }

  function running() {
    return ac.state === "running";
  }

  /* --------------------------- primitives -------------------------- */

  /** Attack/decay envelope. Everything in this file is built on it. */
  function env(t, peak, attack, decay, dest) {
    const g = ac.createGain();
    const p = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(p, t + Math.max(0.0006, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.0006, attack) + Math.max(0.012, decay));
    if (dest) g.connect(dest);
    return g;
  }

  function noiseSource(t, rate = 1) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = rate;
    // A random loop point per shot: without it every footstep in the
    // game is bit-identical and the ear picks that up within seconds.
    src.loopStart = rng() * (NOISE_SECONDS - 0.5);
    src.loopEnd = NOISE_SECONDS;
    src.start(t);
    return src;
  }

  function osc(t, type, freq, dest) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (dest) o.connect(dest);
    o.start(t);
    return o;
  }

  function filter(type, freq, q) {
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  /** Fire and forget: stop the source and let the graph be collected.
   *  Retaining these would be pointless - a one-shot is never
   *  cancelled, and holding references is how a synth leaks. */
  function release(source, stopAt, nodes) {
    try { source.stop(stopAt); } catch (error) { /* already stopped */ }
    source.onended = () => {
      try { source.disconnect(); } catch (error) { /* fine */ }
      if (nodes) for (const n of nodes) { try { n.disconnect(); } catch (error) { /* fine */ } }
    };
  }

  /**
   * A detuned saw stack. Three oscillators at +-11 cents is the
   * cheapest thing that sounds like a supersaw; one saw sounds like a
   * test tone and seven costs four times as much for no more width.
   */
  function sawStack(t, freq, dest, count = 3, spread = 11) {
    const oscs = [];
    for (let i = 0; i < count; i += 1) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.detune.value = (i - (count - 1) / 2) * spread;
      o.frequency.setValueAtTime(freq, t);
      o.connect(dest);
      o.start(t);
      oscs.push(o);
    }
    return oscs;
  }

  /* ------------------------------------------------------------------ */
  /* Music                                                               */
  /* ------------------------------------------------------------------ */

  const music = {
    def: COURSES[1],
    pending: null,
    pendingFade: 1.2,
    requested: null,       // set before the first gesture, applied after
    playing: false,
    bossPhase: 0,
    activeLayers: BOSS.layers,
    stepAbs: 0,            // absolute 16th index; derived from beatOrigin
    cursor: 0,             // AudioContext time of the next step
    bars: 0,
    notes: 0,
  };

  /** MIDI note for a scale degree, wrapping octaves. */
  function degree(def, n) {
    const s = def.scale;
    const oct = Math.floor(n / s.length);
    return def.root + s[((n % s.length) + s.length) % s.length] + oct * 12;
  }

  function chordAt(def, bar) {
    return def.prog[bar % def.prog.length];
  }

  function chordNotes(def, chord, octave) {
    const t = TRIAD[chord.t] || TRIAD.min;
    const out = [];
    for (let i = 0; i < t.length; i += 1) out.push(def.root + chord.r + t[i] + octave);
    return out;
  }

  function layerOn(name) {
    if (music.def !== BOSS) return true;
    const need = music.activeLayers[name];
    return need === undefined ? true : music.bossPhase >= need;
  }

  /* ---- instruments (music bus only, never spatialised) ---- */

  function kick(t, gain) {
    const g = env(t, gain, 0.002, 0.20, musicBus);
    const o = osc(t, "sine", 160, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.075);
    // The click. A kick with no transient disappears the moment
    // anything else is playing over it.
    const cg = env(t, gain * 0.35, 0.0008, 0.012, musicBus);
    const cf = filter("highpass", 1200);
    const cs = noiseSource(t, 1.6);
    cs.connect(cf); cf.connect(cg);
    release(o, t + 0.30, [g]);
    release(cs, t + 0.05, [cf, cg]);
    music.notes += 1;
  }

  function snare(t, gain) {
    const bp = filter("bandpass", 1900, 0.85);
    const ng = env(t, gain, 0.001, 0.10, musicBus);
    const ns = noiseSource(t, 1);
    ns.connect(bp); bp.connect(ng);
    release(ns, t + 0.18, [bp, ng]);
    const bg = env(t, gain * 0.45, 0.001, 0.06, musicBus);
    const bo = osc(t, "triangle", 220, bg);
    bo.frequency.exponentialRampToValueAtTime(148, t + 0.055);
    release(bo, t + 0.14, [bg]);
    music.notes += 1;
  }

  /** Layered short noise bursts. One burst is a snare; three offset by
   *  a few milliseconds is a room full of people clapping, and the
   *  offsets are what make it read as a crowd. */
  function clap(t, gain) {
    for (let i = 0; i < 3; i += 1) {
      const at = t + i * 0.011;
      const bp = filter("bandpass", 1500 + i * 220, 1.4);
      const g = env(at, gain * (1 - i * 0.22), 0.001, i === 2 ? 0.10 : 0.02, musicBus);
      const ns = noiseSource(at, 1.2);
      ns.connect(bp); bp.connect(g);
      release(ns, at + 0.16, [bp, g]);
    }
    music.notes += 1;
  }

  function hat(t, gain, open) {
    const hp = filter("highpass", 7400);
    const g = env(t, gain, 0.001, open ? 0.13 : 0.024, musicBus);
    const ns = noiseSource(t, 1.5);
    ns.connect(hp); hp.connect(g);
    release(ns, t + 0.22, [hp, g]);
    music.notes += 1;
  }

  function bassNote(t, midi, gain, dur, cfg) {
    const lp = filter("lowpass", cfg.cut, 7);
    lp.frequency.setValueAtTime(cfg.cut * 2.2, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, cfg.cut * 0.4), t + dur);
    const g = env(t, gain, 0.004, dur, musicBus);
    let tail = g;
    if (cfg.drive > 0) {
      const shaper = ac.createWaveShaper();
      shaper.curve = driveCurve(cfg.drive);
      shaper.oversample = "2x";
      lp.connect(shaper);
      shaper.connect(g);
      tail = shaper;
    } else {
      lp.connect(g);
    }
    const o = osc(t, cfg.shape, mtof(midi), lp);
    const nodes = [lp, g];
    if (tail !== g) nodes.push(tail);
    if (cfg.sub) {
      const s = osc(t, "sine", mtof(midi - 12), lp);
      release(s, t + dur + 0.08, []);
    }
    release(o, t + dur + 0.08, nodes);
    music.notes += 1;
  }

  function pluck(t, midi, gain, dur, shape) {
    const g = env(t, gain, shape === "bell" ? 0.002 : 0.004, dur, musicBus);
    const f = mtof(midi);
    if (shape === "bell") {
      // Two-operator FM. A bell is the one timbre a subtractive voice
      // cannot fake, and it costs two oscillators.
      const carrier = ac.createOscillator();
      carrier.type = "sine";
      carrier.frequency.setValueAtTime(f, t);
      const mod = ac.createOscillator();
      mod.type = "sine";
      mod.frequency.setValueAtTime(f * 2.01, t);
      const modGain = ac.createGain();
      modGain.gain.setValueAtTime(f * 2.4, t);
      modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(g);
      carrier.start(t); mod.start(t);
      release(mod, t + dur + 0.06, [modGain]);
      release(carrier, t + dur + 0.06, [g]);
    } else if (shape === "supersaw") {
      const lp = filter("lowpass", 3200, 3);
      lp.frequency.setValueAtTime(4600, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + dur);
      lp.connect(g);
      const oscs = sawStack(t, f, lp, 3, 14);
      for (let i = 1; i < oscs.length; i += 1) release(oscs[i], t + dur + 0.06, []);
      release(oscs[0], t + dur + 0.06, [lp, g]);
    } else {
      const o = osc(t, shape, f, g);
      // A quiet octave above, so a triangle pluck has an edge to it.
      const hg = ac.createGain();
      hg.gain.value = 0.28;
      hg.connect(g);
      const h = osc(t, "sine", f * 2.005, hg);
      release(h, t + dur + 0.05, [hg]);
      release(o, t + dur + 0.05, [g]);
    }
    music.notes += 1;
  }

  function padChord(t, midis, gain, dur, cfg) {
    const attack = cfg.attack;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, gain), t + Math.max(attack, dur - 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(musicBus);

    const lp = filter("lowpass", cfg.shape === "gated" ? 1800 : 2600, 0.8);
    lp.connect(g);

    for (let i = 0; i < midis.length; i += 1) {
      const f = mtof(midis[i]);
      if (cfg.shape === "supersaw") {
        const oscs = sawStack(t, f, lp, 3, cfg.spread);
        for (const o of oscs) release(o, t + dur + 0.1, []);
      } else if (cfg.shape === "choir" || cfg.shape === "strings") {
        // Two detuned saws plus a sine an octave up. The sine is what
        // stops a string pad turning into a wall of fuzz.
        const a = ac.createOscillator();
        a.type = "sawtooth";
        a.detune.value = -cfg.spread;
        a.frequency.setValueAtTime(f, t);
        a.connect(lp); a.start(t);
        const b = ac.createOscillator();
        b.type = "sawtooth";
        b.detune.value = cfg.spread;
        b.frequency.setValueAtTime(f, t);
        b.connect(lp); b.start(t);
        const cg = ac.createGain();
        cg.gain.value = cfg.shape === "choir" ? 0.5 : 0.25;
        cg.connect(lp);
        const c = osc(t, "sine", f * 2, cg);
        release(a, t + dur + 0.1, []);
        release(b, t + dur + 0.1, []);
        release(c, t + dur + 0.1, [cg]);
      } else {
        const o = osc(t, cfg.shape === "gated" ? "square" : cfg.shape, f, lp);
        release(o, t + dur + 0.1, []);
      }
    }
    // One node in the chain owns the teardown of the shared nodes.
    window.setTimeout(() => {
      try { lp.disconnect(); g.disconnect(); } catch (error) { /* fine */ }
    }, Math.ceil((t - ac.currentTime + dur + 0.4) * 1000) + 60);
    music.notes += 1;
  }

  function leadNote(t, midi, gain, dur, shape) {
    const g = env(t, gain, 0.01, dur, musicBus);
    const lp = filter("lowpass", 3400, 4);
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.linearRampToValueAtTime(4200, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1200, t + dur);
    lp.connect(g);
    if (shape === "supersaw") {
      const oscs = sawStack(t, mtof(midi), lp, 3, 16);
      for (let i = 1; i < oscs.length; i += 1) release(oscs[i], t + dur + 0.08, []);
      release(oscs[0], t + dur + 0.08, [lp, g]);
    } else {
      const o = osc(t, shape, mtof(midi), lp);
      release(o, t + dur + 0.08, [lp, g]);
    }
    music.notes += 1;
  }

  /* ---- the pattern emitter ---- */

  const ARP_ORDER = { up: 1, updown: 2, random: 3 };

  function emitStep(t, absStep) {
    const def = music.def;
    if (!def) return;
    const step = ((absStep % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
    const bar = Math.floor(absStep / STEPS_PER_BAR);
    const chord = chordAt(def, bar);
    const g = def.gains;

    // Swing: push the odd 16ths late. Applied to the scheduled time,
    // not to the grid, so the beat clock stays exactly on the grid and
    // the on-beat combat window does not swing with the hats.
    const swung = (step % 2 === 1) ? t + STEP_DUR * (def.swing || 0) : t;

    if (def.kick[step] && layerOn("kick")) kick(swung, g.kick * (def.kick[step] === 2 ? 1.15 : 1));
    if (def.snare[step] && layerOn("snare")) snare(swung, g.snare);
    if (def.clap && def.clap[step] && layerOn("clap")) clap(swung, g.snare * 0.75);
    if (def.hat[step] && layerOn("hat")) hat(swung, g.hat * (def.hat[step] === 2 ? 1.4 : 1), step === 14);
    if (def.hatFast && def.hatFast[step] && layerOn("hatFast")) hat(swung, g.hat * 0.55, false);

    if (def.bassRhythm[step] && layerOn("bass")) {
      // Bass follows the chord root, an octave and a half down. The
      // pump on the hyperpop course is applied here rather than with a
      // compressor: a scheduled duck is exact and free.
      const midi = def.root + chord.r - 24;
      const pumped = def.pump ? g.bass * lerp(1 - def.pump, 1, clamp01((step % 4) / 3)) : g.bass;
      bassNote(swung, midi, pumped, STEP_DUR * 1.7, def.bass);
    }

    if (def.arp && layerOn("arp")) {
      const a = def.arp;
      if (step % a.rate === 0) {
        const notes = chordNotes(def, chord, a.octave);
        const i = Math.floor(step / a.rate);
        let idx;
        const mode = ARP_ORDER[a.mode] || 1;
        if (mode === 1) idx = i % notes.length;
        else if (mode === 2) {
          const span = notes.length * 2 - 2;
          const k = i % Math.max(1, span);
          idx = k < notes.length ? k : span - k;
        } else {
          idx = Math.floor(rng() * notes.length);
        }
        const midi = notes[clamp(idx, 0, notes.length - 1)];
        pluck(swung, midi, a.gain, STEP_DUR * (a.rate * 0.85), a.shape);
      }
    }

    if (step === 0 && def.pad && layerOn("pad")) {
      padChord(t, chordNotes(def, chord, 0), def.pad.gain, STEP_DUR * STEPS_PER_BAR, def.pad);
    }

    if (def.lead && def.lead.steps[step] && layerOn("lead")) {
      // The lead sits on a scale degree derived from the bar, so it
      // moves with the progression instead of repeating one lick.
      const midi = degree(def, 5 + (bar % 3)) + 12;
      leadNote(swung, midi, def.lead.gain, STEP_DUR * 2.4, def.lead.shape);
    }

    if (def.stab && def.stab[step] && music.bossPhase >= 2) {
      const notes = chordNotes(def, chord, 0);
      for (const n of notes) leadNote(swung, n, 0.05, STEP_DUR * 1.5, "sawtooth");
    }
  }

  /**
   * Lookahead scheduling.
   *
   * The step index is derived from the SAME origin as beatPhase(), so
   * the kick and the on-beat window cannot drift apart no matter how
   * long the session runs or how badly the main thread stalls.
   */
  function scheduleUntil(until) {
    if (!music.playing || !music.def || !running()) return;
    let guard = 0;
    while (music.cursor < until && guard < 256) {
      // A pending course swap lands on a bar line and nowhere else.
      if (music.pending && music.stepAbs % STEPS_PER_BAR === 0) {
        music.def = music.pending;
        music.pending = null;
        const at = music.cursor;
        musicFade.gain.cancelScheduledValues(at);
        musicFade.gain.setValueAtTime(Math.max(0.0001, musicFade.gain.value), at);
        musicFade.gain.linearRampToValueAtTime(music.def.master ?? 0.6, at + music.pendingFade * 0.5);
      }
      try { emitStep(music.cursor, music.stepAbs); }
      catch (error) { /* a bad pattern must not stop the transport */ }
      music.stepAbs += 1;
      if (music.stepAbs % STEPS_PER_BAR === 0) music.bars += 1;
      music.cursor = beatClock.audioOrigin + music.stepAbs * STEP_DUR;
      guard += 1;
    }

    // If the tab was hidden for a minute the cursor is now far in the
    // past and the loop above would try to catch up by emitting
    // thousands of notes at once. Re-derive it from the clock instead.
    if (music.cursor < ac.currentTime - 0.5) alignCursor();
  }

  /** Put the cursor on the next 16th boundary at or after now. */
  function alignCursor() {
    const now = ac.currentTime + 0.05;
    const steps = Math.ceil((now - beatClock.audioOrigin) / STEP_DUR);
    music.stepAbs = Math.max(0, steps);
    music.cursor = beatClock.audioOrigin + music.stepAbs * STEP_DUR;
  }

  function startMusic(def, fade) {
    anchorToAudio();
    music.def = def;
    music.pending = null;
    music.playing = true;
    alignCursor();
    const t = ac.currentTime;
    musicFade.gain.cancelScheduledValues(t);
    musicFade.gain.setValueAtTime(Math.max(0.0001, musicFade.gain.value), t);
    musicFade.gain.linearRampToValueAtTime(def.master ?? 0.6, t + Math.max(0.05, fade));
  }

  function stopMusic(fade) {
    const t = ac.currentTime;
    musicFade.gain.cancelScheduledValues(t);
    musicFade.gain.setValueAtTime(Math.max(0.0001, musicFade.gain.value), t);
    musicFade.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    window.setTimeout(() => {
      if (musicFade.gain.value <= 0.002) music.playing = false;
    }, Math.ceil(Math.max(0.05, fade) * 1000) + 60);
  }

  function resolveCourse(courseId) {
    if (courseId === null || courseId === undefined || courseId === "off" || courseId === false) {
      return null;
    }
    if (typeof courseId === "string") {
      const key = courseId.toLowerCase();
      if (key.startsWith("boss")) return BOSS;
      const found = Object.values(COURSES).find((c) => c.id === key);
      if (found) return found;
      const n = Number(key);
      if (Number.isFinite(n) && COURSES[n]) return COURSES[n];
      return COURSES[1];
    }
    const n = Number(courseId);
    return COURSES[Number.isFinite(n) ? n : 1] || COURSES[1];
  }

  /* ------------------------------------------------------------------ */
  /* SFX                                                                 */
  /* ------------------------------------------------------------------ */

  function surfaceProfile(name) {
    const key = String(name || "").toLowerCase();
    if (SURFACE_STEP[key]) return SURFACE_STEP[key];
    for (const k of Object.keys(SURFACE_STEP)) {
      if (k !== "default" && key.includes(k)) return SURFACE_STEP[k];
    }
    // The contract's collision materials that have no direct entry.
    if (key.includes("slope")) return SURFACE_STEP.stone;
    return SURFACE_STEP.default;
  }

  /** A short filtered noise burst plus a body thump. The workhorse
   *  behind footsteps, landings and impacts. */
  function impact(t, dest, cfg, scale = 1) {
    const bp = filter(cfg.q > 2 ? "bandpass" : "lowpass", cfg.band, cfg.q);
    const g = env(t, cfg.gain * scale, 0.001, cfg.decay, dest);
    const ns = noiseSource(t, cfg.rate);
    ns.connect(bp); bp.connect(g);
    release(ns, t + cfg.decay + 0.12, [bp, g]);
    if (cfg.bodyGain > 0) {
      const bg = env(t, cfg.bodyGain * scale, 0.001, cfg.decay * 1.6, dest);
      const bo = osc(t, "sine", cfg.body, bg);
      bo.frequency.exponentialRampToValueAtTime(Math.max(30, cfg.body * 0.55), t + cfg.decay * 1.4);
      release(bo, t + cfg.decay * 2 + 0.08, [bg]);
    }
    if (cfg.ring) {
      // Metal only: a high partial that outlives the strike.
      const rg = env(t, cfg.gain * 0.3 * scale, 0.002, 0.42, dest);
      const ro = osc(t, "sine", cfg.ring, rg);
      release(ro, t + 0.5, [rg]);
    }
  }

  /** The vocal-ish "hup". A bandpass sweeping upward over a saw is
   *  the cheapest thing that reads as a voice rather than as a beep,
   *  and Moggadonna is a frontwoman - her jumps have to sound sung. */
  function vocalPop(t, dest, freq, gain, dur, rise) {
    const bp = filter("bandpass", freq * 2.4, 4.5);
    bp.frequency.setValueAtTime(freq * 1.6, t);
    bp.frequency.exponentialRampToValueAtTime(freq * (rise > 0 ? 4.2 : 1.2), t + dur * 0.7);
    const g = env(t, gain, 0.008, dur, dest);
    bp.connect(g);
    const o = osc(t, "sawtooth", freq, bp);
    o.frequency.exponentialRampToValueAtTime(freq * (1 + rise), t + dur * 0.75);
    const sg = ac.createGain();
    sg.gain.value = 0.5;
    sg.connect(g);
    const s = osc(t, "sine", freq * 2, sg);
    s.frequency.exponentialRampToValueAtTime(freq * 2 * (1 + rise), t + dur * 0.75);
    release(s, t + dur + 0.08, [sg]);
    release(o, t + dur + 0.08, [bp, g]);
  }

  /** Noise through a swept bandpass: every whoosh in the game. */
  function whoosh(t, dest, f0, f1, gain, dur, q = 1.4) {
    const bp = filter("bandpass", f0, q);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    const ns = noiseSource(t, 1);
    ns.connect(bp); bp.connect(g);
    release(ns, t + dur + 0.1, [bp, g]);
  }

  function blip(t, dest, freq, gain, dur, type = "square") {
    const g = env(t, gain, 0.004, dur, dest);
    const o = osc(t, type, freq, g);
    release(o, t + dur + 0.05, [g]);
  }

  /**
   * The SFX library.
   *
   * Every entry takes (t, opts, dest). `t` is an absolute
   * AudioContext time, already offset by opts.delay, so a caller can
   * schedule a sound ahead of the frame it asks on.
   */
  const SFX = {

    footstep(t, o, dest) {
      const cfg = surfaceProfile(o.surface || o.material);
      // Speed makes a step harder and slightly higher, which is what
      // separates a walk from a sprint without a second sample.
      const s = clamp01((o.speed ?? 3.2) / 7.4);
      impact(t, dest, cfg, lerp(0.7, 1.25, s));
    },

    /**
     * The jump chain.
     *
     * Rising pitch across jump / double / triple is the single most
     * imitated audio detail in this genre and it is the reason the
     * triple jump feels like an achievement rather than a third jump.
     * Roughly a minor third then a fifth above the first.
     */
    jump(t, o, dest) {
      const chain = clamp(Math.round(o.chain ?? 1), 1, 3);
      const ratio = [1, 1.19, 1.41][chain - 1];
      vocalPop(t, dest, 330 * ratio, 0.20 + chain * 0.02, 0.20 + chain * 0.03, 0.28);
      whoosh(t, dest, 900, 2600, 0.045, 0.16, 1.1);
    },
    doubleJump(t, o, dest) { SFX.jump(t, { ...o, chain: 2 }, dest); },
    tripleJump(t, o, dest) {
      SFX.jump(t, { ...o, chain: 3 }, dest);
      // The third one gets a flourish. It should sound like a win.
      blip(t + 0.06, dest, 880, 0.075, 0.10, "triangle");
      blip(t + 0.13, dest, 1320, 0.06, 0.14, "triangle");
    },

    longJump(t, o, dest) {
      vocalPop(t, dest, 240, 0.20, 0.34, 0.55);
      whoosh(t, dest, 400, 2400, 0.09, 0.42, 0.9);
    },

    wallKick(t, o, dest) {
      impact(t, dest, SURFACE_STEP.stone, 1.1);
      // A rising zip so the kick reads as a launch, not a bump.
      const g = env(t + 0.01, 0.11, 0.004, 0.16, dest);
      const osc1 = osc(t + 0.01, "square", 300, g);
      osc1.frequency.exponentialRampToValueAtTime(900, t + 0.15);
      release(osc1, t + 0.2, [g]);
    },

    dive(t, o, dest) {
      whoosh(t, dest, 2600, 500, 0.11, 0.38, 1.0);
      vocalPop(t, dest, 420, 0.14, 0.18, -0.35);
    },

    /** Ground pound, part one: the spin-up. */
    poundStart(t, o, dest) {
      whoosh(t, dest, 500, 3200, 0.13, 0.30, 1.8);
      const g = env(t, 0.09, 0.02, 0.28, dest);
      const o1 = osc(t, "triangle", 200, g);
      o1.frequency.exponentialRampToValueAtTime(760, t + 0.28);
      release(o1, t + 0.34, [g]);
    },

    /** Part two: the impact. Sub, crack and a wide low thud. */
    poundHit(t, o, dest) {
      const g = env(t, 0.42, 0.001, 0.34, dest);
      const o1 = osc(t, "sine", 190, g);
      o1.frequency.exponentialRampToValueAtTime(36, t + 0.13);
      release(o1, t + 0.42, [g]);
      const cfg = surfaceProfile(o.surface || o.material);
      impact(t, dest, cfg, 2.2);
      const hp = filter("highpass", 900);
      const cg = env(t, 0.20, 0.001, 0.09, dest);
      const ns = noiseSource(t, 1.3);
      ns.connect(hp); hp.connect(cg);
      release(ns, t + 0.16, [hp, cg]);
    },

    /** Part three: the settle. Debris and air filling back in. */
    poundSettle(t, o, dest) {
      const lp = filter("lowpass", 700, 0.7);
      lp.frequency.exponentialRampToValueAtTime(140, t + 0.6);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
      g.connect(dest);
      const ns = noiseSource(t, 0.55);
      ns.connect(lp); lp.connect(g);
      release(ns, t + 0.7, [lp, g]);
    },

    groundPound(t, o, dest) {
      SFX.poundHit(t, o, dest);
      SFX.poundSettle(t + 0.09, o, dest);
    },

    land(t, o, dest) {
      const cfg = surfaceProfile(o.surface || o.material);
      impact(t, dest, cfg, lerp(0.9, 1.6, clamp01((o.speed ?? 8) / 18)));
    },

    hardLand(t, o, dest) {
      const cfg = surfaceProfile(o.surface || o.material);
      impact(t, dest, cfg, 2.0);
      const g = env(t, 0.30, 0.001, 0.26, dest);
      const o1 = osc(t, "sine", 130, g);
      o1.frequency.exponentialRampToValueAtTime(45, t + 0.16);
      release(o1, t + 0.34, [g]);
      // The grunt. It is what tells the player that hurt.
      vocalPop(t + 0.02, dest, 190, 0.13, 0.22, -0.30);
    },

    /**
     * Clout. The pitch climbs a pentatonic ladder as the chain runs
     * and resets after a beat and a half of silence.
     */
    coin(t, o, dest) {
      const chain = clamp(Math.round(o.chain ?? state.coinChain), 0, COIN_LADDER.length - 1);
      const base = 72 + COIN_LADDER[chain];
      const kindGain = o.kind === "blue" ? 1.25 : o.kind === "red" ? 1.1 : 1;
      blip(t, dest, mtof(base), 0.13 * kindGain, 0.055, "triangle");
      blip(t + 0.055, dest, mtof(base + 7), 0.115 * kindGain, 0.14, "triangle");
      // A little sparkle on top, brighter for the rarer kinds.
      if (o.kind && o.kind !== "yellow") {
        blip(t + 0.10, dest, mtof(base + 12), 0.07, 0.18, "sine");
      }
    },

    /**
     * The Platinum Record fanfare. Six seconds of ceremony, and it
     * ducks the bed underneath itself so it is heard rather than
     * fought - which is the entire reason duck() exists.
     */
    recordGet(t, o, dest) {
      api.duck(0.72, 3.0);
      const root = 60;
      const rise = [0, 4, 7, 12, 16, 19];
      for (let i = 0; i < rise.length; i += 1) {
        const at = t + i * 0.085;
        const g = env(at, 0.13, 0.006, 0.30, dest);
        const lp = filter("lowpass", 4200, 2);
        lp.connect(g);
        const oscs = sawStack(at, mtof(root + rise[i]), lp, 3, 12);
        for (let k = 1; k < oscs.length; k += 1) release(oscs[k], at + 0.4, []);
        release(oscs[0], at + 0.4, [lp, g]);
      }
      // The landing chord, held.
      const chordAt2 = t + 0.55;
      for (const n of [60, 64, 67, 72, 76]) {
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, chordAt2);
        g.gain.linearRampToValueAtTime(0.085, chordAt2 + 0.03);
        g.gain.setValueAtTime(0.085, chordAt2 + 1.1);
        g.gain.exponentialRampToValueAtTime(0.0001, chordAt2 + 2.2);
        g.connect(dest);
        const lp = filter("lowpass", 3600, 1.2);
        lp.connect(g);
        const oscs = sawStack(chordAt2, mtof(n), lp, 3, 10);
        for (let k = 1; k < oscs.length; k += 1) release(oscs[k], chordAt2 + 2.4, []);
        release(oscs[0], chordAt2 + 2.4, [lp, g]);
      }
      // Cymbal swell into the chord, and a crash on it.
      const swell = ac.createGain();
      swell.gain.setValueAtTime(0.0001, t);
      swell.gain.linearRampToValueAtTime(0.075, chordAt2);
      swell.gain.exponentialRampToValueAtTime(0.0001, chordAt2 + 1.4);
      swell.connect(dest);
      const hp = filter("highpass", 5200);
      hp.connect(swell);
      const ns = noiseSource(t, 1.4);
      ns.connect(hp);
      release(ns, chordAt2 + 1.6, [hp, swell]);
      // And a timpani-ish hit underneath, because a fanfare needs a floor.
      const bg = env(chordAt2, 0.28, 0.002, 0.7, dest);
      const bo = osc(chordAt2, "sine", 110, bg);
      bo.frequency.exponentialRampToValueAtTime(55, chordAt2 + 0.4);
      release(bo, chordAt2 + 0.85, [bg]);
    },

    enemyPop(t, o, dest) {
      const f = 620 * (o.rate || 1);
      const g = env(t, 0.15, 0.002, 0.17, dest);
      const o1 = osc(t, "square", f, g);
      o1.frequency.exponentialRampToValueAtTime(f * 0.32, t + 0.15);
      release(o1, t + 0.22, [g]);
      const hp = filter("highpass", 1600);
      const ng = env(t, 0.10, 0.001, 0.11, dest);
      const ns = noiseSource(t, 1.1);
      ns.connect(hp); hp.connect(ng);
      release(ns, t + 0.2, [hp, ng]);
    },

    beamFire(t, o, dest) {
      const g = env(t, 0.15, 0.003, 0.20, dest);
      const lp = filter("lowpass", 3800, 8);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.18);
      lp.connect(g);
      const oscs = sawStack(t, 880, lp, 3, 20);
      for (const oo of oscs) oo.frequency.exponentialRampToValueAtTime(300, t + 0.18);
      for (let i = 1; i < oscs.length; i += 1) release(oscs[i], t + 0.26, []);
      release(oscs[0], t + 0.26, [lp, g]);
      whoosh(t, dest, 3000, 900, 0.05, 0.18, 1.6);
    },

    beamHit(t, o, dest) {
      const bp = filter("bandpass", 2800, 2.4);
      const g = env(t, 0.16, 0.001, 0.12, dest);
      const ns = noiseSource(t, 1.5);
      ns.connect(bp); bp.connect(g);
      release(ns, t + 0.2, [bp, g]);
      blip(t, dest, 1480, 0.09, 0.11, "triangle");
    },

    aura(t, o, dest) {
      api.duck(0.4, 1.4);
      whoosh(t, dest, 300, 5200, 0.13, 0.42, 1.2);
      const at = t + 0.32;
      for (const n of [40, 52, 59, 64]) {
        const g = env(at, 0.16, 0.004, 0.9, dest);
        const shaper = ac.createWaveShaper();
        shaper.curve = driveCurve(0.4);
        shaper.connect(g);
        const oscs = sawStack(at, mtof(n), shaper, 3, 18);
        for (let i = 1; i < oscs.length; i += 1) release(oscs[i], at + 1.1, []);
        release(oscs[0], at + 1.1, [shaper, g]);
      }
      const sg = env(at, 0.34, 0.002, 0.6, dest);
      const so = osc(at, "sine", 120, sg);
      so.frequency.exponentialRampToValueAtTime(34, at + 0.45);
      release(so, at + 0.75, [sg]);
    },

    hurt(t, o, dest) {
      const g = env(t, 0.24, 0.002, 0.32, dest);
      const shaper = ac.createWaveShaper();
      shaper.curve = driveCurve(0.5);
      shaper.connect(g);
      const o1 = osc(t, "triangle", 440, shaper);
      o1.frequency.exponentialRampToValueAtTime(96, t + 0.28);
      release(o1, t + 0.4, [shaper, g]);
      whoosh(t, dest, 1800, 400, 0.06, 0.2, 1.0);
    },

    heal(t, o, dest) {
      for (let i = 0; i < 3; i += 1) {
        blip(t + i * 0.075, dest, mtof(72 + [0, 4, 7][i]), 0.085, 0.24, "sine");
      }
    },

    splash(t, o, dest) {
      whoosh(t, dest, 3400, 700, 0.16, 0.32, 0.7);
      const g = env(t, 0.14, 0.001, 0.13, dest);
      const lp = filter("lowpass", 900, 1.2);
      lp.connect(g);
      const ns = noiseSource(t, 0.7);
      ns.connect(lp);
      release(ns, t + 0.22, [lp, g]);
    },

    swim(t, o, dest) { whoosh(t, dest, 1400, 380, 0.06, 0.34, 0.6); },

    switchHit(t, o, dest) {
      impact(t, dest, SURFACE_STEP.metal, 1.6);
      blip(t + 0.03, dest, 520, 0.11, 0.20, "square");
      blip(t + 0.13, dest, 780, 0.10, 0.26, "square");
    },

    checkpoint(t, o, dest) {
      blip(t, dest, mtof(76), 0.10, 0.18, "triangle");
      blip(t + 0.11, dest, mtof(83), 0.10, 0.32, "triangle");
    },

    menuMove(t, o, dest) { blip(t, dest, 620, 0.06, 0.045, "square"); },
    menuClick(t, o, dest) {
      blip(t, dest, 880, 0.085, 0.05, "square");
      blip(t + 0.035, dest, 1320, 0.06, 0.07, "square");
    },
    menuBack(t, o, dest) {
      blip(t, dest, 520, 0.07, 0.06, "square");
      blip(t + 0.04, dest, 340, 0.06, 0.09, "square");
    },
  };

  /**
   * How long a voice's graph must stay connected.
   *
   * The voice gain is torn down on a timer, so a sound whose tail is
   * longer than its allowance gets cut off - which is how the Record
   * fanfare lost its final chord the first time round. Anything not
   * listed gets the default.
   */
  const SFX_DURATION = {
    recordGet: 4.2, fanfare: 4.2, record: 4.2,
    aura: 2.2, groundPound: 1.4, poundSettle: 1.0, pound: 1.4,
    hardLand: 0.9, beamFire: 0.6, longJump: 0.8, dive: 0.7,
    switchHit: 0.8, checkpoint: 0.7, heal: 0.7, splash: 0.7, swim: 0.6,
  };
  const SFX_DURATION_DEFAULT = 1.2;

  // Aliases. Callers use the name of the action; the table has one
  // entry per sound, and the two vocabularies are not the same.
  SFX.step = SFX.footstep;
  SFX.pound = SFX.groundPound;
  SFX.poundLand = SFX.poundHit;
  SFX.clout = SFX.coin;
  SFX.record = SFX.recordGet;
  SFX.fanfare = SFX.recordGet;
  SFX.pop = SFX.enemyPop;
  SFX.beam = SFX.beamFire;
  SFX.waterEnter = SFX.splash;
  SFX.confirm = SFX.menuClick;
  SFX.cancel = SFX.menuBack;

  /* ------------------------------------------------------------------ */
  /* Autoplay unlock                                                     */
  /* ------------------------------------------------------------------ */

  let unlockPromise = null;

  function resume() {
    if (running()) return Promise.resolve(true);
    if (unlockPromise) return unlockPromise;
    unlockPromise = Promise.resolve()
      .then(() => ac.resume())
      .then(() => {
        unlockPromise = null;
        if (!running()) return false;
        state.started = true;
        // Re-anchor before anything is scheduled, so the first bar
        // lands exactly on the beat the game has been counting.
        anchorToAudio();
        if (music.requested !== undefined && music.requested !== null) {
          const def = resolveCourse(music.requested);
          if (def) startMusic(def, 0.8);
        }
        return true;
      })
      .catch(() => {
        // Blocked. Not an error - the game is playable and silent.
        unlockPromise = null;
        return false;
      });
    return unlockPromise;
  }

  const gestureEvents = ["pointerdown", "touchend", "keydown", "mousedown"];
  function onGesture() {
    resume().then((ok) => { if (ok) removeGestureListeners(); });
  }
  function removeGestureListeners() {
    for (const name of gestureEvents) {
      window.removeEventListener(name, onGesture, true);
      if (ctx.canvas) ctx.canvas.removeEventListener(name, onGesture, true);
    }
  }
  for (const name of gestureEvents) {
    window.addEventListener(name, onGesture, true);
    if (ctx.canvas) ctx.canvas.addEventListener(name, onGesture, true);
  }

  /* ---------------------- the backup scheduler --------------------- */

  /**
   * The interval only decides how OFTEN we look ahead. Every note time
   * inside scheduleUntil is an exact AudioContext time, so the drift
   * and jitter of setInterval never reach the music. This exists
   * alongside the per-frame call in update() because rAF is throttled
   * to about 1fps in a hidden tab and in headless Chromium, and the
   * bed must not stutter in either.
   */
  const timer = window.setInterval(() => {
    if (!running()) return;
    try { scheduleUntil(ac.currentTime + LOOKAHEAD); }
    catch (error) { /* never let the transport die */ }
  }, TICK_MS);

  /* ------------------------------------------------------------------ */
  /* Listener                                                            */
  /* ------------------------------------------------------------------ */

  const listenerVec = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };

  function updateListener() {
    const cam = ctx.camera;
    if (!cam) return;
    const l = ac.listener;
    const p = cam.position;
    if (!Number.isFinite(p.x)) return;

    // Forward and up straight out of the camera's world matrix. Going
    // through Euler angles here gets the roll wrong the moment the
    // camera shake applies one.
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];

    if (l.positionX) {
      const t = ac.currentTime;
      // setTargetAtTime, not .value: a teleporting listener produces an
      // audible click on every sound currently playing.
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      if (l.setOrientation) l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    listenerVec.x = p.x; listenerVec.y = p.y; listenerVec.z = p.z;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  const missingWarned = new Set();
  const EMPTY = Object.freeze({});

  const api = {
    available: true,

    /** CONTRACT section 9. 0..1 within the current beat. Also written
     *  into ctx.clock.beat every frame - see the file header. */
    beatPhase() {
      const b = beatsNow();
      if (!Number.isFinite(b)) return 0;
      return b - Math.floor(b);
    },

    /** CONTRACT section 9. `fn` gets { index, strength }. */
    onBeat(fn) {
      if (typeof fn !== "function") return () => {};
      beatListeners.add(fn);
      return () => beatListeners.delete(fn);
    },

    /** CONTRACT section 9. opts: { pos, gain, rate, delay }. Returns
     *  null when audio is blocked, muted or over its voice cap - which
     *  every caller must treat as normal, not as a failure. */
    play(name, opts) {
      if (!running() || state.muted) return null;
      const key = String(name || "");
      const fn = SFX[key];
      if (!fn) {
        if (!missingWarned.has(key)) {
          missingWarned.add(key);
          console.warn(`[apop3d] audio.play("${key}") - no such sound`);
        }
        return null;
      }
      const o = opts || EMPTY;

      // The coin chain lives here rather than in collect.js so that
      // any caller gets the rising pitch for free.
      if (fn === SFX.coin && o.chain === undefined) {
        const now = ac.currentTime;
        state.coinChain = (now - state.coinAt) < COIN_CHAIN_RESET ? state.coinChain + 1 : 0;
        state.coinAt = now;
      }

      const g = voice(2.5, o);
      if (!g) return null;
      // A few milliseconds of slack: scheduling at exactly currentTime
      // means the first envelope segment is already in the past by the
      // time the graph runs, which clicks.
      const t = ac.currentTime + 0.006 + Math.max(0, Number(o.delay) || 0);
      try {
        fn(t, o, g);
      } catch (error) {
        console.warn(`[apop3d] audio.play("${key}") threw`, error);
        return null;
      }
      return g;
    },

    /** CONTRACT section 9. Accepts a course number, a course id
     *  string, "boss", or null to stop. */
    music(courseId, opts) {
      const fade = Math.max(0.05, (opts && Number(opts.fade)) || 1.2);
      music.requested = courseId;
      const def = resolveCourse(courseId);

      if (opts && Number.isFinite(opts.phase)) api.bossPhase(opts.phase);

      if (!def) { stopMusic(fade); return; }
      if (!running()) return;              // applied when the gesture lands
      if (music.playing && music.def === def) return;
      if (!music.playing) { startMusic(def, fade); return; }

      // Already playing something else: dip, and let the scheduler
      // swap the pattern on the next bar line.
      music.pending = def;
      music.pendingFade = fade;
      const t = ac.currentTime;
      musicFade.gain.cancelScheduledValues(t);
      musicFade.gain.setValueAtTime(Math.max(0.0001, musicFade.gain.value), t);
      musicFade.gain.linearRampToValueAtTime(0.02, t + fade * 0.45);
    },

    /** CONTRACT section 9. Pulls the music down and lets it back up,
     *  so a fanfare or a boss line is heard over the bed. */
    duck(amount, seconds) {
      const a = clamp01(Number(amount) || 0);
      const s = Math.max(0.1, Number(seconds) || 1);
      const t = ac.currentTime;
      const target = clamp(1 - a, 0.02, 1);
      try {
        musicDuck.gain.cancelScheduledValues(t);
        musicDuck.gain.setValueAtTime(musicDuck.gain.value, t);
        // Down fast, back up slowly. The reverse reads as a dropout.
        musicDuck.gain.linearRampToValueAtTime(target, t + 0.08);
        musicDuck.gain.setValueAtTime(target, t + s * 0.55);
        musicDuck.gain.linearRampToValueAtTime(1, t + s);
      } catch (error) { /* a scheduling clash is not worth a crash */ }
    },

    /** CONTRACT section 9. The transport keeps running while muted -
     *  ctx.clock.beat must not stop just because the volume did. */
    setMuted(on) {
      state.muted = !!on;
      const t = ac.currentTime;
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(state.muted ? 0.0001 : 0.85, t + 0.12);
      } catch (error) { /* fine */ }
    },

    /* ---- extensions beyond the frozen signatures ---- */

    /** Boss phase. Layers only ever join on a bar line - see BOSS. */
    bossPhase(index) {
      const n = clamp(Math.round(Number(index) || 0), 0, 3);
      if (n === music.bossPhase) return;
      music.bossPhase = n;
      // A short lift so the new layer arrives as an event.
      if (running() && music.playing) api.duck(0.18, 0.6);
    },

    setMusicVolume(v) {
      musicBus.gain.setTargetAtTime(clamp01(Number(v) || 0) * 0.62, ac.currentTime, 0.05);
    },

    setSfxVolume(v) {
      sfxBus.gain.setTargetAtTime(clamp(Number(v) || 0, 0, 2), ac.currentTime, 0.05);
    },

    /** For a UI "enable sound" button. The gesture listeners already
     *  do this; this is for callers that want the promise. */
    resume,

    get context() { return ac; },

    stats() {
      return {
        available: true,
        state: ac.state,
        muted: state.muted,
        voices: state.voices,
        beat: Number(api.beatPhase().toFixed(3)),
        beatIndex: ctx.clock.beatIndex,
        source: beatClock.source,
        music: music.playing ? (music.def && music.def.id) : null,
        bars: music.bars,
        notes: music.notes,
        bossPhase: music.bossPhase,
        coinChain: state.coinChain,
        latency: Number(outputLatency().toFixed(4)),
      };
    },

    /* -------------------------- lifecycle -------------------------- */

    update(context) {
      const c = context.clock;

      // 1. The beat clock, written straight into ctx.clock. main.js
      //    has stopped computing this the moment beatPhase() existed,
      //    so if this line stops running the whole game loses time.
      const beats = beatsNow();
      if (Number.isFinite(beats)) {
        const index = Math.floor(beats);
        c.beatIndex = index;
        c.beat = beats - index;
        const toNearest = Math.min(c.beat, 1 - c.beat) * SEC_PER_BEAT;
        c.onBeat = toNearest <= ON_BEAT_WINDOW;

        // 2. Beat callbacks. Fired once per whole beat crossed, and
        //    capped so a long stall does not fire two hundred at once.
        if (index > beatClock.lastIndex) {
          const from = Math.max(beatClock.lastIndex + 1, index - 3);
          for (let i = from; i <= index; i += 1) {
            const strength = i % 4 === 0 ? 1 : (i % 2 === 0 ? 0.7 : 0.45);
            for (const fn of beatListeners) {
              try { fn({ index: i, strength }); }
              catch (error) { console.error("[apop3d] onBeat listener threw", error); }
            }
          }
          beatClock.lastIndex = index;
        }
      }

      if (!running()) return;

      // 3. Listener, then the music. Scheduling here as well as on the
      //    interval means a healthy frame rate keeps the horizon full
      //    without waiting for the next tick.
      updateListener();
      try { scheduleUntil(ac.currentTime + LOOKAHEAD); }
      catch (error) { /* never let the transport die */ }
    },

    dispose() {
      window.clearInterval(timer);
      removeGestureListeners();
      beatListeners.clear();
      try { master.disconnect(); } catch (error) { /* fine */ }
      try { ac.close(); } catch (error) { /* fine */ }
    },
  };

  /* --------------------------- bus wiring --------------------------- */

  /**
   * The same event vocabulary vfx.js listens on. Gameplay modules emit
   * once and both the picture and the sound happen, which is the only
   * way two modules built in parallel stay in sync.
   */
  const bus = ctx.bus;
  if (bus) {
    bus.on("player:step", (e = {}) => api.play("footstep", { pos: e.position, surface: e.surface, speed: e.speed }));
    bus.on("player:jump", (e = {}) => api.play("jump", { pos: e.position, chain: e.chain }));
    bus.on("player:longJump", (e = {}) => api.play("longJump", { pos: e.position }));
    bus.on("player:wallKick", (e = {}) => api.play("wallKick", { pos: e.position }));
    bus.on("player:dive", (e = {}) => api.play("dive", { pos: e.position }));
    bus.on("player:land", (e = {}) => api.play(e.hard ? "hardLand" : "land", {
      pos: e.position, surface: e.surface, speed: e.speed,
    }));
    bus.on("player:pound", (e = {}) => {
      if (e.phase === "start") api.play("poundStart", { pos: e.position });
      else api.play("groundPound", { pos: e.position, surface: e.surface });
    });
    bus.on("player:hurt", (e = {}) => api.play("hurt", { pos: e.position }));
    bus.on("player:heal", (e = {}) => api.play("heal", { pos: e.position }));
    bus.on("player:water", (e = {}) => api.play("splash", { pos: e.position }));
    bus.on("beam:fire", (e = {}) => api.play("beamFire", { pos: e.position }));
    bus.on("beam:hit", (e = {}) => api.play("beamHit", { pos: e.position }));
    bus.on("aura:fire", (e = {}) => api.play("aura", { pos: e.position }));
    bus.on("enemy:pop", (e = {}) => api.play("enemyPop", { pos: e.position, rate: e.rate }));
    bus.on("collect:clout", (e = {}) => api.play("coin", { pos: e.position, kind: e.kind, chain: e.chain }));
    bus.on("collect:record", (e = {}) => api.play("recordGet", {}));
    bus.on("collect:switch", (e = {}) => api.play("switchHit", { pos: e.position }));
    bus.on("boss:phase", (e = {}) => api.bossPhase(e.index));
    bus.on("world:load", (e = {}) => api.music(e.course ?? ctx.state.course ?? 1, { fade: 1.4 }));
    bus.on("world:unload", () => api.music(null, { fade: 0.6 }));
  }

  // The bed the game will start on once a gesture arrives. Recording
  // it rather than playing it is what "playable and silent until then"
  // means in practice.
  music.requested = ctx.state ? ctx.state.course : 1;
  beatClock.simOrigin = ctx.clock.t;

  return api;
}
