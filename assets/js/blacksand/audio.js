/* ============================================================
   BLACKSAND - audio

   Everything is synthesised through the Web Audio graph. No samples to
   ship, no licensing, and - the part that actually matters - every shot
   is a different shot, because the parameters are randomised rather
   than a file being replayed. Twenty rounds of automatic fire from a
   sample player is the same 40ms of PCM twenty times and the ear hears
   the loop instantly.

   ---- the signal chain ----

     voice layers
        -> occlusion lowpass      (geometry between source and ear)
        -> air absorption x2      (distance-driven, 12dB/oct)
        -> distance gain          (our own law, not the panner's)
        -> HRTF panner            (direction only, rolloff disabled)
        -> bus (weapon | blast | world | vehicle | ambience | comms)
              -> bus compressor -> duck gain
        -> master sum -> concussion muffle -> limiter -> soft clip -> out
                      \-> environment reverbs (open | street | interior)

   Four decisions in there are worth explaining, because each one is a
   place a cheaper approach was tried and sounded wrong:

   1. The panner does DIRECTION ONLY (`rolloffFactor = 0`). The spec's
      distance models clamp to unity below `refDistance`, so with the
      refDistance a gunshot needs, every shot inside 12m was exactly as
      loud as every other - the mix went flat in exactly the range
      where a shooter needs the most resolution. We compute the gain
      ourselves: true inverse law in the near field, a gentler exponent
      past `ref` because a literal -6dB/doubling puts a rifle at 300m
      below the wind.

   2. Sound travels at 343m/s and we honour it. A muzzle report from
      200m arrives 0.58s after the flash. Because the supersonic crack
      is generated at the player's own position and is NOT delayed, the
      correct ordering - crack first, boom after - falls out for free,
      and that ordering is most of what makes incoming fire from range
      feel like incoming fire from range.

   3. The crack/thump ratio inverts with distance. High frequencies are
      absorbed by air at roughly 100dB/km at 10kHz and 5dB/km at 1kHz,
      so the sharp N-wave dies within a couple of hundred metres while
      the low muzzle blast diffracts and keeps going. Distant fire that
      is just "the same shot, quieter" is the single most common tell
      of a game mix.

   4. There is a soft-clip waveshaper AFTER the compressor. A
      DynamicsCompressorNode is not a limiter: soft knee, 3ms attack,
      finite ratio - eight simultaneous explosions still get peaks
      through it. The waveshaper is the actual brickwall and is the
      reason the worst case measures below full scale instead of
      crunching.

   ---- measurement ----

   Audio cannot be judged from a screenshot, so every voice is written
   against an arbitrary BaseAudioContext rather than a module-level
   singleton. `renderOffline()` builds the identical graph inside an
   OfflineAudioContext, fires one event into it and hands back the
   rendered samples. `scripts/blacksand-audio-probe.mjs` uses that to
   measure attack time, spectral centroid, decay and headroom, which is
   how a gunshot with a 40ms attack gets caught.
   ============================================================ */

import { clamp, clamp01, lerp, damp, makeRng } from "./core.js";
import { LAYER, SURFACE } from "./physics.js";

/** Metres per second. Everything spatial schedules against this. */
const SPEED_OF_SOUND = 343;

/** Nothing waits longer than this to be heard; past ~1.5s the delay
 *  stops reading as distance and starts reading as a bug. */
const MAX_PROPAGATION = 1.5;

/**
 * Voice stealing ladder. When the cap is hit the lowest number dies
 * first, oldest within a tier. Footsteps and casings are the ones that
 * should vanish under sustained fire - if a gunshot ever loses to a
 * footstep the mix has failed.
 */
const PRIORITY = {
  gear: 8,
  casing: 14,
  footstep: 22,
  ambience: 26,
  body: 30,
  vehicle: 46,
  ui: 52,
  comms: 58,
  weaponRemote: 66,
  bulletCrack: 78,
  weaponLocal: 88,
  explosion: 100,
};

/** Hard cap on concurrent scheduled voices. Chrome starts dropping
 *  buffers of its own past a few hundred nodes; we would rather choose
 *  which ones die. */
const VOICE_CAP = 56;

/* ------------------------- weapon acoustics -------------------------

   Each entry is a physical description rather than a set of magic
   numbers: bore energy, how sharp the N-wave is, where the body of the
   blast sits, what the action sounds like. `crackReach` is the metre
   constant of the exponential that kills the crack with distance -
   small numbers die fast (pistol, SMG: subsonic 9mm barely cracks at
   all), large numbers carry (marksman: a 7.62 at 850m/s cracks across
   the whole map).                                                    */

const WEAPON_VOICE = {
  rifle: {
    label: "5.56 carbine",
    gain: 1.00,
    crackHz: 2350, crackDecay: 0.028, crackReach: 105, crackGain: 1.05,
    bodyHz: 760, bodyEndHz: 190, bodyDecay: 0.085, bodyQ: 1.15, bodyGain: 0.92,
    thumpHz: 168, thumpEndHz: 54, thumpDecay: 0.115, thumpGain: 0.60,
    supersonic: true,
    mech: { hz: 2900, q: 9, gain: 0.20, at: 0.024, decay: 0.030, count: 2, spread: 0.021 },
    casingDelay: [0.42, 0.60], casingGain: 0.5,
    tailGain: 1.0,
  },
  carbine: {
    label: "7.62 rifle",
    gain: 1.14,
    crackHz: 1850, crackDecay: 0.036, crackReach: 130, crackGain: 1.00,
    bodyHz: 560, bodyEndHz: 132, bodyDecay: 0.115, bodyQ: 0.95, bodyGain: 1.05,
    thumpHz: 132, thumpEndHz: 42, thumpDecay: 0.155, thumpGain: 0.86,
    supersonic: true,
    // The AKM's action is famously loud and loose - a big slow clatter
    // rather than the M4's tight tick.
    mech: { hz: 1750, q: 5.5, gain: 0.30, at: 0.030, decay: 0.052, count: 3, spread: 0.028 },
    casingDelay: [0.46, 0.68], casingGain: 0.62,
    tailGain: 1.12,
  },
  marksman: {
    label: "7.62 bolt rifle",
    gain: 1.40,
    crackHz: 2650, crackDecay: 0.042, crackReach: 165, crackGain: 1.28,
    bodyHz: 500, bodyEndHz: 112, bodyDecay: 0.150, bodyQ: 0.85, bodyGain: 1.20,
    thumpHz: 112, thumpEndHz: 34, thumpDecay: 0.230, thumpGain: 1.00,
    supersonic: true,
    mech: { hz: 2200, q: 7, gain: 0.14, at: 0.030, decay: 0.040, count: 1, spread: 0 },
    // A bolt gun does not eject on firing. The cycle is a separate,
    // much later, two-part event and is scheduled by `boltCycle`.
    casingDelay: null, casingGain: 0,
    boltCycle: true,
    tailGain: 1.35,
  },
  smg: {
    label: "9mm SMG",
    gain: 0.72,
    // Subsonic pistol ammunition: almost no N-wave, so the "crack" is
    // really just the sharp edge of the blast and it dies inside 60m.
    crackHz: 3100, crackDecay: 0.016, crackReach: 46, crackGain: 0.62,
    bodyHz: 980, bodyEndHz: 280, bodyDecay: 0.058, bodyQ: 1.5, bodyGain: 0.70,
    thumpHz: 215, thumpEndHz: 82, thumpDecay: 0.070, thumpGain: 0.34,
    supersonic: false,
    mech: { hz: 3400, q: 8, gain: 0.26, at: 0.014, decay: 0.024, count: 2, spread: 0.014 },
    casingDelay: [0.30, 0.44], casingGain: 0.42,
    tailGain: 0.7,
  },
  lmg: {
    label: "5.56 belt LMG",
    gain: 1.06,
    crackHz: 2250, crackDecay: 0.032, crackReach: 112, crackGain: 1.00,
    bodyHz: 700, bodyEndHz: 170, bodyDecay: 0.098, bodyQ: 1.05, bodyGain: 1.00,
    thumpHz: 152, thumpEndHz: 48, thumpDecay: 0.135, thumpGain: 0.72,
    supersonic: true,
    // Belt links. Four bright taps of metal on metal, and the reason a
    // SAW is identifiable from three rooms away.
    mech: { hz: 4200, q: 11, gain: 0.24, at: 0.018, decay: 0.022, count: 4, spread: 0.016 },
    casingDelay: [0.38, 0.58], casingGain: 0.55, casingLinks: true,
    tailGain: 1.05,
  },
  pistol: {
    label: "9mm sidearm",
    gain: 0.80,
    crackHz: 3400, crackDecay: 0.014, crackReach: 42, crackGain: 0.70,
    bodyHz: 1150, bodyEndHz: 330, bodyDecay: 0.048, bodyQ: 1.7, bodyGain: 0.78,
    thumpHz: 245, thumpEndHz: 95, thumpDecay: 0.062, thumpGain: 0.36,
    supersonic: false,
    // Slide cycling is the loudest part of a pistol at arm's length.
    mech: { hz: 2600, q: 6, gain: 0.34, at: 0.020, decay: 0.036, count: 2, spread: 0.026 },
    casingDelay: [0.34, 0.50], casingGain: 0.48,
    tailGain: 0.72,
  },
};

const DEFAULT_WEAPON_VOICE = WEAPON_VOICE.rifle;

/* --------------------------- environments ---------------------------

   Three reverbs, crossfaded rather than switched. The listener's own
   surroundings choose the mix; the SOURCE's surroundings choose the
   slapback delay, which is why a shot fired at you from inside a
   building sounds different from the same shot fired at you in the
   street even though you are standing still.                        */

const ENVIRONMENTS = {
  /** Open desert. Almost no reverberation in the room sense - what you
   *  actually hear is a long, dark, sparse scatter off dunes and ridge
   *  lines, arriving hundreds of milliseconds late. */
  open: {
    seconds: 2.6, decay: 3.4, damping: 0.72, brightness: 0.22,
    early: [[0.085, 0.30], [0.170, 0.22], [0.265, 0.16], [0.410, 0.11]],
    send: 0.30, slap: [0.14, 0.34], slapGain: 0.55, slapCut: 1400,
  },
  /** A street between two- and three-storey blocks: strong early
   *  reflections off the facing walls, moderate tail. */
  street: {
    seconds: 1.5, decay: 2.4, damping: 0.42, brightness: 0.55,
    early: [[0.016, 0.52], [0.029, 0.44], [0.047, 0.34], [0.072, 0.26], [0.115, 0.18]],
    send: 0.44, slap: [0.028, 0.075], slapGain: 0.72, slapCut: 4200,
  },
  /** Inside a concrete room. Short, dense and bright, with the box
   *  resonance that makes indoor gunfire physically painful. */
  interior: {
    seconds: 0.85, decay: 2.0, damping: 0.20, brightness: 0.86,
    early: [[0.005, 0.62], [0.011, 0.55], [0.019, 0.48], [0.031, 0.38], [0.048, 0.28]],
    send: 0.62, slap: [0.006, 0.022], slapGain: 0.85, slapCut: 7000,
  },
};

/** Where a spent case lands, and what it sounds like when it does. */
const CASING = {
  [SURFACE.SAND]: { hz: 620, q: 1.4, decay: 0.045, gain: 0.30, ring: 0.0, bounces: 1 },
  [SURFACE.DIRT]: { hz: 760, q: 1.6, decay: 0.050, gain: 0.34, ring: 0.05, bounces: 2 },
  [SURFACE.ROCK]: { hz: 3100, q: 7.0, decay: 0.110, gain: 0.52, ring: 0.55, bounces: 3 },
  [SURFACE.CONCRETE]: { hz: 2850, q: 8.5, decay: 0.140, gain: 0.58, ring: 0.72, bounces: 4 },
  [SURFACE.METAL]: { hz: 4300, q: 14.0, decay: 0.230, gain: 0.62, ring: 0.95, bounces: 4 },
  [SURFACE.WOOD]: { hz: 1500, q: 4.0, decay: 0.085, gain: 0.42, ring: 0.30, bounces: 3 },
  [SURFACE.WATER]: { hz: 900, q: 1.1, decay: 0.060, gain: 0.30, ring: 0.0, bounces: 1 },
  [SURFACE.GLASS]: { hz: 5200, q: 12.0, decay: 0.160, gain: 0.5, ring: 0.85, bounces: 3 },
};

/**
 * Footsteps. `body` is the low thud of the boot, `scuff` the broadband
 * grit on top - a footstep with only one of the two reads as a click.
 */
const FOOTSTEP = {
  [SURFACE.SAND]: { bodyHz: 150, bodyDecay: 0.055, scuffHz: 1500, scuffQ: 0.55, scuffDecay: 0.155, gain: 0.34, scuff: 1.10, grit: 0.9 },
  [SURFACE.DIRT]: { bodyHz: 175, bodyDecay: 0.060, scuffHz: 1100, scuffQ: 0.85, scuffDecay: 0.105, gain: 0.38, scuff: 0.85, grit: 0.7 },
  [SURFACE.ROCK]: { bodyHz: 230, bodyDecay: 0.045, scuffHz: 2700, scuffQ: 2.4, scuffDecay: 0.085, gain: 0.44, scuff: 0.95, grit: 0.55 },
  [SURFACE.CONCRETE]: { bodyHz: 210, bodyDecay: 0.048, scuffHz: 2250, scuffQ: 2.0, scuffDecay: 0.100, gain: 0.46, scuff: 0.90, grit: 0.35 },
  [SURFACE.METAL]: { bodyHz: 290, bodyDecay: 0.075, scuffHz: 3400, scuffQ: 5.5, scuffDecay: 0.210, gain: 0.50, scuff: 1.05, grit: 0.25 },
  [SURFACE.WOOD]: { bodyHz: 195, bodyDecay: 0.070, scuffHz: 1350, scuffQ: 2.4, scuffDecay: 0.125, gain: 0.42, scuff: 0.80, grit: 0.30 },
  [SURFACE.WATER]: { bodyHz: 130, bodyDecay: 0.070, scuffHz: 1900, scuffQ: 0.5, scuffDecay: 0.230, gain: 0.48, scuff: 1.35, grit: 1.0 },
  [SURFACE.FOLIAGE]: { bodyHz: 165, bodyDecay: 0.055, scuffHz: 2600, scuffQ: 0.7, scuffDecay: 0.190, gain: 0.36, scuff: 1.25, grit: 1.0 },
};

/** Non-positional and small positional one-shots. */
const ONE_SHOTS = {
  jump: { kind: "noise", hz: 380, q: 1.0, decay: 0.09, gain: 0.16, bus: "world" },
  land: { kind: "noise", hz: 210, q: 0.8, decay: 0.17, gain: 0.42, bus: "world" },
  hurt: { kind: "tone", hz: 190, to: 88, decay: 0.24, gain: 0.36, bus: "world", wave: "triangle" },
  death: { kind: "tone", hz: 132, to: 40, decay: 1.15, gain: 0.52, bus: "world", wave: "triangle" },
  reload: { kind: "noise", hz: 2500, q: 4.0, decay: 0.09, gain: 0.32, bus: "world" },
  click: { kind: "noise", hz: 4300, q: 7.0, decay: 0.03, gain: 0.22, bus: "world" },
  capture: { kind: "tone", hz: 520, to: 784, decay: 0.5, gain: 0.28, bus: "comms", wave: "triangle" },
  lost: { kind: "tone", hz: 420, to: 208, decay: 0.5, gain: 0.28, bus: "comms", wave: "triangle" },
  hitmark: { kind: "noise", hz: 3200, q: 12, decay: 0.045, gain: 0.30, bus: "ui" },
  headshot: { kind: "noise", hz: 5200, q: 16, decay: 0.070, gain: 0.34, bus: "ui" },
  kill: { kind: "tone", hz: 880, to: 1320, decay: 0.16, gain: 0.26, bus: "ui", wave: "square" },
  lowammo: { kind: "tone", hz: 1600, to: 1180, decay: 0.09, gain: 0.16, bus: "ui", wave: "square" },
  vault: { kind: "noise", hz: 900, q: 1.2, decay: 0.22, gain: 0.30, bus: "world" },
  splash: { kind: "noise", hz: 1400, q: 0.5, decay: 0.42, gain: 0.5, bus: "world" },
};

/** Bus layout. Order matters only for the report. */
const BUS_NAMES = ["weapon", "blast", "world", "vehicle", "ambience", "comms", "ui", "music"];

export async function createAudio(ctx) {
  const { THREE, settings } = ctx;

  /* ------------------- context-free sample data -------------------

     Generated once as plain Float32Arrays and copied into whichever
     AudioContext asks for them. The offline measurement contexts get
     byte-identical noise and impulses to the live one, which is the
     only way a measured number means anything about what the player
     hears.                                                           */

  const DATA_RATE = 48000;
  const noiseSeconds = 2.5;

  const noiseData = (() => {
    const r = makeRng(0x9e3779b1);
    const out = new Float32Array(Math.floor(DATA_RATE * noiseSeconds));
    for (let i = 0; i < out.length; i += 1) out[i] = r() * 2 - 1;
    return out;
  })();

  /**
   * Pink-ish noise. One-pole cascade rather than a proper Voss-McCartney
   * network: the error is under a dB across the band that matters and
   * it costs one pass. Used anywhere white noise sounded like a hiss
   * instead of like air or grit.
   */
  const pinkData = (() => {
    const out = new Float32Array(noiseData.length);
    let b0 = 0; let b1 = 0; let b2 = 0;
    for (let i = 0; i < out.length; i += 1) {
      const w = noiseData[i];
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    return out;
  })();

  const irCache = new Map();

  /**
   * Synthesise an impulse response for one environment.
   *
   * Exponential-decay noise alone sounds like a reverb plugin's demo
   * preset. What makes a space identifiable is the EARLY reflections -
   * the handful of discrete arrivals off the nearest surfaces - so
   * those are stamped in explicitly and the noise is only the tail.
   */
  function impulseData(name) {
    if (irCache.has(name)) return irCache.get(name);
    const spec = ENVIRONMENTS[name];
    const length = Math.floor(DATA_RATE * spec.seconds);
    const r = makeRng(0x5bd1 ^ name.length ^ (name.charCodeAt(0) << 8));
    const channels = [];
    for (let c = 0; c < 2; c += 1) {
      const data = new Float32Array(length);
      // Damping as a one-pole running through the tail, so the reverb
      // gets darker as it decays the way a real room does.
      let lp = 0;
      const a = clamp01(1 - spec.damping);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const env = Math.pow(1 - t, spec.decay);
        lp += a * ((r() * 2 - 1) - lp);
        const bright = lerp(lp, r() * 2 - 1, spec.brightness * 0.5);
        data[i] = bright * env;
      }
      // Early reflections, decorrelated per channel so the room has
      // width instead of arriving as one mono click.
      for (const [time, level] of spec.early) {
        const jitter = 1 + (c ? 0.055 : -0.055) * (0.6 + r() * 0.8);
        const index = Math.floor(time * jitter * DATA_RATE);
        if (index < length - 4) {
          for (let k = 0; k < 4; k += 1) data[index + k] += level * (1 - k / 4) * (r() * 2 - 1);
        }
      }
      // Normalise so swapping environments does not change loudness -
      // only character. Reverbs that also change level make the mix
      // pump every time the player walks through a doorway.
      let sum = 0;
      for (let i = 0; i < length; i += 1) sum += data[i] * data[i];
      const norm = sum > 0 ? 0.55 / Math.sqrt(sum / length) / Math.sqrt(length / DATA_RATE) : 1;
      for (let i = 0; i < length; i += 1) data[i] *= norm;
      channels.push(data);
    }
    const result = { channels, seconds: spec.seconds };
    irCache.set(name, result);
    return result;
  }

  /** tanh soft clip curve for the brickwall stage. */
  const CLIP_CURVE = (() => {
    const n = 4096;
    const curve = new Float32Array(n);
    const k = 1.65;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / norm;
    }
    return curve;
  })();

  /* ---------------------------- the graph ---------------------------- */

  /**
   * Build the complete mix on `actx`.
   *
   * Written against a BaseAudioContext rather than the module's own
   * AudioContext so the measurement harness can rebuild it bit for bit
   * inside an OfflineAudioContext. That constraint is the reason none
   * of the voice functions below reach for a module-level variable.
   */
  function createGraph(actx, options = {}) {
    const offline = Boolean(options.offline);
    const g = {
      actx,
      offline,
      rng: makeRng(options.seed ?? (ctx.seed ^ 0xa11d10)),
      voices: new Set(),
      voiceCap: options.voiceCap ?? VOICE_CAP,
      buses: {},
      ducks: {},
      reverb: {},
      /** Crossfade weights between the three environments. */
      envMix: { open: 1, street: 0, interior: 0 },
      listener: {
        pos: new THREE.Vector3(0, 1.6, 0),
        fwd: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, 1, 0),
      },
      stats: { started: 0, stolen: 0, dropped: 0, peakVoices: 0 },
      noiseBuffer: null,
      pinkBuffer: null,
    };

    /* ---- shared buffers ---- */
    const rate = actx.sampleRate;
    function toBuffer(src) {
      // Resample by linear interpolation when the device is not 48k.
      // Nearest-neighbour was audible as a metallic edge on the noise
      // beds at 44.1k, which is most laptops.
      if (Math.abs(rate - DATA_RATE) < 1) {
        const buf = actx.createBuffer(1, src.length, rate);
        buf.getChannelData(0).set(src);
        return buf;
      }
      const length = Math.floor((src.length / DATA_RATE) * rate);
      const buf = actx.createBuffer(1, length, rate);
      const out = buf.getChannelData(0);
      const step = DATA_RATE / rate;
      for (let i = 0; i < length; i += 1) {
        const x = i * step;
        const i0 = Math.floor(x);
        const frac = x - i0;
        out[i] = lerp(src[i0] || 0, src[i0 + 1] || 0, frac);
      }
      return buf;
    }
    g.noiseBuffer = toBuffer(noiseData);
    g.pinkBuffer = toBuffer(pinkData);

    /* ---- master chain ---- */
    const out = actx.createGain();
    out.gain.value = settings.prefs.masterVolume;

    // Brickwall. See the header: the compressor alone is not one.
    const clipper = actx.createWaveShaper();
    clipper.curve = CLIP_CURVE;
    clipper.oversample = "4x";

    const limiter = actx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;

    // Concussion muffle. Sits before the limiter so a blast that
    // deafens the player also stops the limiter chattering on the
    // content it is hiding.
    const muffle = actx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 21000;
    muffle.Q.value = 0.6;
    const muffleHi = actx.createBiquadFilter();
    muffleHi.type = "highshelf";
    muffleHi.frequency.value = 2200;
    muffleHi.gain.value = 0;

    const sum = actx.createGain();
    sum.gain.value = 1;

    sum.connect(muffle);
    muffle.connect(muffleHi);
    muffleHi.connect(limiter);
    limiter.connect(clipper);
    clipper.connect(out);
    out.connect(actx.destination);

    g.out = out;
    g.sum = sum;
    g.limiter = limiter;
    g.muffle = muffle;
    g.muffleHi = muffleHi;

    /* ---- buses ----
       Per-bus dynamics rather than one master compressor, because the
       jobs are different: the weapon bus needs to glue twelve rounds a
       second into one texture, the blast bus needs to stay open and
       let a explosion breathe, comms needs to be squashed flat so a
       callout is intelligible under fire. */
    const BUS_DYN = {
      weapon: { threshold: -18, knee: 6, ratio: 4.0, attack: 0.004, release: 0.12, gain: 1.0 },
      blast: { threshold: -14, knee: 10, ratio: 2.6, attack: 0.010, release: 0.42, gain: 1.0 },
      world: { threshold: -22, knee: 8, ratio: 3.2, attack: 0.006, release: 0.18, gain: 1.0 },
      vehicle: { threshold: -20, knee: 8, ratio: 3.6, attack: 0.020, release: 0.25, gain: 1.0 },
      ambience: { threshold: -26, knee: 12, ratio: 2.0, attack: 0.050, release: 0.60, gain: 1.0 },
      comms: { threshold: -26, knee: 3, ratio: 8.0, attack: 0.003, release: 0.10, gain: 1.25 },
      ui: { threshold: -20, knee: 4, ratio: 3.0, attack: 0.002, release: 0.08, gain: 1.0 },
      music: { threshold: -22, knee: 8, ratio: 2.4, attack: 0.020, release: 0.30, gain: 1.0 },
    };

    for (const name of BUS_NAMES) {
      const dyn = BUS_DYN[name];
      const input = actx.createGain();
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = dyn.threshold;
      comp.knee.value = dyn.knee;
      comp.ratio.value = dyn.ratio;
      comp.attack.value = dyn.attack;
      comp.release.value = dyn.release;
      const duck = actx.createGain();
      duck.gain.value = 1;
      const trim = actx.createGain();
      trim.gain.value = dyn.gain
        * (name === "music" ? settings.prefs.musicVolume
          : name === "comms" ? settings.prefs.voiceVolume : settings.prefs.sfxVolume);

      input.connect(comp);
      comp.connect(duck);
      duck.connect(trim);
      trim.connect(sum);

      g.buses[name] = { input, comp, duck, trim, base: dyn.gain };
      g.ducks[name] = duck;
    }

    /* ---- environment reverbs ----
       Three convolvers running in parallel with a crossfade in front,
       rather than one convolver whose buffer is swapped. Swapping a
       ConvolverNode's buffer cuts the tail dead - walking out of a
       doorway chopped the reverb off mid-decay, which is far more
       noticeable than the cost of two idle convolvers. */
    for (const name of Object.keys(ENVIRONMENTS)) {
      const ir = impulseData(name);
      const buffer = actx.createBuffer(2, Math.floor(ir.seconds * rate), rate);
      for (let c = 0; c < 2; c += 1) {
        const src = ir.channels[c];
        const dst = buffer.getChannelData(c);
        const step = DATA_RATE / rate;
        for (let i = 0; i < dst.length; i += 1) {
          const x = i * step;
          const i0 = Math.floor(x);
          dst[i] = lerp(src[i0] || 0, src[i0 + 1] || 0, x - i0);
        }
      }
      const convolver = actx.createConvolver();
      convolver.normalize = false;
      convolver.buffer = buffer;
      const send = actx.createGain();
      send.gain.value = name === "open" ? 1 : 0;
      const ret = actx.createGain();
      ret.gain.value = 1;
      send.connect(convolver);
      convolver.connect(ret);
      // Reverb returns to its own point on the sum, not through a bus
      // compressor - otherwise the tail of an explosion pumps the
      // gunfire that is feeding the same compressor.
      ret.connect(sum);
      g.reverb[name] = { send, convolver, ret };
    }

    if (options.envMix) setEnvMix(g, options.envMix, true);

    return g;
  }

  function setEnvMix(g, mix, immediate = false) {
    const total = (mix.open || 0) + (mix.street || 0) + (mix.interior || 0) || 1;
    for (const name of Object.keys(ENVIRONMENTS)) {
      const value = (mix[name] || 0) / total;
      g.envMix[name] = value;
      const param = g.reverb[name].send.gain;
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, g.actx.currentTime, 0.18);
    }
  }

  /* --------------------------- voice budget --------------------------- */

  function reap(g) {
    const now = g.actx.currentTime;
    for (const v of g.voices) if (v.until <= now) g.voices.delete(v);
  }

  /**
   * Register a scheduled voice. Returns false when the voice was
   * refused, in which case the caller must not build its nodes.
   *
   * Refusing up front is cheaper than building forty oscillators and
   * then stopping them, and it is what keeps a 100-round belt from
   * allocating a thousand nodes per second on a slow machine.
   */
  function allocVoice(g, priority, duration, stop) {
    reap(g);
    if (g.voices.size >= g.voiceCap) {
      let victim = null;
      for (const v of g.voices) {
        if (v.priority > priority) continue;
        if (!victim || v.priority < victim.priority
          || (v.priority === victim.priority && v.started < victim.started)) victim = v;
      }
      if (!victim) { g.stats.dropped += 1; return null; }
      g.voices.delete(victim);
      g.stats.stolen += 1;
      try { victim.stop(); } catch (error) { /* already ended */ }
    }
    const voice = {
      priority,
      started: g.actx.currentTime,
      until: g.actx.currentTime + duration,
      stop: stop || (() => {}),
    };
    g.voices.add(voice);
    g.stats.started += 1;
    if (g.voices.size > g.stats.peakVoices) g.stats.peakVoices = g.voices.size;
    return voice;
  }

  /* --------------------------- primitives --------------------------- */

  function noiseSource(g, { pink = false, rate = 1, offset = null } = {}) {
    const src = g.actx.createBufferSource();
    src.buffer = pink ? g.pinkBuffer : g.noiseBuffer;
    src.playbackRate.value = rate;
    src._offset = offset === null ? g.rng() * (noiseSeconds - 0.6) : offset;
    return src;
  }

  function startNoise(src, at, duration) {
    src.start(at, src._offset, Math.max(0.005, duration));
  }

  /** Gain node with an exponential decay envelope. */
  function envGain(g, at, peak, decay, { attack = 0.0008, hold = 0 } = {}) {
    const node = g.actx.createGain();
    const p = Math.max(1e-4, peak);
    node.gain.setValueAtTime(1e-4, at);
    node.gain.exponentialRampToValueAtTime(p, at + attack);
    if (hold > 0) node.gain.setValueAtTime(p, at + attack + hold);
    node.gain.exponentialRampToValueAtTime(1e-4, at + attack + hold + Math.max(0.005, decay));
    return node;
  }

  function biquad(g, type, frequency, q = 1) {
    const f = g.actx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clamp(frequency, 12, Math.min(21000, g.actx.sampleRate * 0.49));
    f.Q.value = q;
    return f;
  }

  /* -------------------------- spatialisation -------------------------- */

  /**
   * Our distance law. Two segments:
   *   d <= near   flat (you cannot get closer to a muzzle than this)
   *   near..ref   true inverse, -6dB per doubling
   *   > ref       exponent `far`, because literal physics puts a rifle
   *               at 300m below the wind bed and the player needs to
   *               hear the map.
   */
  function distanceGain(distance, near, ref, far) {
    const d = Math.max(distance, 1e-3);
    if (d <= near) return 1;
    if (d <= ref) return near / d;
    return (near / ref) * Math.pow(ref / d, far);
  }

  /**
   * Air absorption cutoff. Fitted so the numbers land where measured
   * atmospheric absorption puts them: still bright at 50m, distinctly
   * dull at 200m, a thud past 400m. Humidity/dust from the weather
   * preset moves it, because a dust storm really does eat the top end.
   */
  function airCutoff(distance, absorb = 1) {
    return clamp(19000 * Math.exp(-distance / (145 / clamp(absorb, 0.4, 2.6))), 260, 20000);
  }

  const _sv = new THREE.Vector3();
  const _sv2 = new THREE.Vector3();

  /**
   * Occlusion: how much geometry sits between the source and the ear,
   * 0 clear .. 1 fully blocked.
   *
   * Three rays, not one. A single centre ray flickers hard when the
   * player strafes past a doorway - the sound snaps between muffled
   * and open every frame. Sampling the source volume instead gives a
   * value that moves continuously, which is what "partial occlusion"
   * has to be for it to sound like anything but a bug.
   */
  function occlusionAt(position) {
    const physics = ctx.physics;
    const player = ctx.player;
    if (!physics || !physics.lineOfSight || !player) return 0;
    const ear = player.eyePosition || player.position;
    if (!ear) return 0;
    let blocked = 0;
    const samples = 3;
    for (let i = 0; i < samples; i += 1) {
      _sv.copy(position);
      if (i === 1) _sv.y += 1.3;
      if (i === 2) { _sv2.copy(ear).sub(position).normalize(); _sv.x -= _sv2.z * 1.1; _sv.z += _sv2.x * 1.1; }
      if (!physics.lineOfSight(_sv, ear)) blocked += 1;
    }
    return blocked / samples;
  }

  /**
   * Positional chain for one voice. Returns the node to feed, plus the
   * distance and the propagation delay the caller must schedule
   * against.
   *
   * Returns null when the source is beyond `maxDistance` - the caller
   * then builds nothing at all, which is the cheapest possible way to
   * handle a firefight on the far side of a 1024m map.
   */
  function positional(g, position, spec = {}) {
    const {
      bus = "world",
      near = 2,
      ref = 30,
      far = 0.62,
      maxDistance = 700,
      absorb = 1,
      occlusion = null,
      reverbScale = 1,
      delay = true,
    } = spec;

    const lp = g.listener.pos;
    _sv.set(position.x - lp.x, position.y - lp.y, position.z - lp.z);
    const distance = _sv.length();
    if (distance > maxDistance) return null;

    const level = distanceGain(distance, near, ref, far);
    if (level < 0.0016) return null;   // ~ -56dB, under the wind bed

    const occ = occlusion === null
      ? (g.offline ? 0 : occlusionAt(position))
      : clamp01(occlusion);

    // Air absorption as two cascaded one-poles: a single 6dB/oct slope
    // left far-off gunfire sounding merely "quieter and slightly dull"
    // rather than like a thump behind a hill.
    const cutoff = airCutoff(distance, absorb);
    const air1 = biquad(g, "lowpass", cutoff, 0.6);
    const air2 = biquad(g, "lowpass", cutoff * 1.35, 0.5);

    // Occlusion: a wall is a lowpass and a level drop, not a mute.
    // Bass goes through concrete; that is why you feel a firefight in
    // the next building before you hear it.
    const occFilter = biquad(g, "lowpass", lerp(20000, 480, Math.pow(occ, 0.7)), 0.7);
    const occShelf = g.actx.createBiquadFilter();
    occShelf.type = "highshelf";
    occShelf.frequency.value = 900;
    occShelf.gain.value = -22 * occ;

    const attenuation = g.actx.createGain();
    attenuation.gain.value = level * lerp(1, 0.34, occ);

    const panner = g.actx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    // Direction only. The distance work is ours; see the header.
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    panner.maxDistance = 100000;
    // HRTF at sub-metre range produces violent, unstable interaural
    // differences. Push the virtual source out to a minimum radius
    // along the same bearing: same direction, stable filtering.
    const minRadius = 1.1;
    let px = position.x; let py = position.y; let pz = position.z;
    if (distance < minRadius) {
      const s = distance > 1e-4 ? minRadius / distance : 0;
      px = lp.x + _sv.x * s;
      py = lp.y + _sv.y * s;
      pz = lp.z + _sv.z * s;
    }
    if (panner.positionX) {
      panner.positionX.value = px;
      panner.positionY.value = py;
      panner.positionZ.value = pz;
    } else {
      panner.setPosition(px, py, pz);
    }

    occFilter.connect(occShelf);
    occShelf.connect(air1);
    air1.connect(air2);
    air2.connect(attenuation);
    attenuation.connect(panner);
    panner.connect(g.buses[bus].input);

    // Reverb send rises with distance and with occlusion: a sound you
    // cannot see is nearly all reflection.
    const send = g.actx.createGain();
    send.gain.value = clamp01(0.10 + distance / 160 + occ * 0.55) * 0.52 * reverbScale;
    panner.connect(send);
    for (const name of Object.keys(ENVIRONMENTS)) send.connect(g.reverb[name].send);

    return {
      input: occFilter,
      panner,
      distance,
      occlusion: occ,
      level,
      delay: delay ? Math.min(distance / SPEED_OF_SOUND, MAX_PROPAGATION) : 0,
    };
  }

  /* ------------------------------ tails ------------------------------ */

  /**
   * The reflection off the world, as a discrete slapback rather than
   * pure convolution.
   *
   * Convolution alone gives a diffuse wash. What a rifle in a street
   * actually does is fire one hard reflection off the building
   * opposite a few tens of milliseconds later, and THAT is the cue the
   * ear uses to decide it is in a street. In the open desert the same
   * mechanism gives a very late, very dark slap off a dune.
   */
  function tail(g, node, at, distance, envName, gain, busName = "weapon") {
    const spec = ENVIRONMENTS[envName];
    const bus = g.buses[busName].input;
    const [lo, hi] = spec.slap;
    const time = clamp(lerp(lo, hi, g.rng()) + (envName === "open" ? distance / 900 : 0), 0.004, 1.2);
    const delay = g.actx.createDelay(1.5);
    delay.delayTime.value = time;
    const cut = biquad(g, "lowpass", spec.slapCut * lerp(0.7, 1.2, g.rng()), 0.7);
    const level = g.actx.createGain();
    level.gain.value = spec.slapGain * gain;
    node.connect(delay);
    delay.connect(cut);
    cut.connect(level);
    level.connect(bus);

    // A second, later, darker bounce only outdoors, where there is
    // something far enough away to bounce off.
    if (envName === "open" && distance > 30) {
      const d2 = g.actx.createDelay(2.0);
      d2.delayTime.value = clamp(time * 2.4 + 0.18, 0.05, 1.6);
      const c2 = biquad(g, "lowpass", 900, 0.6);
      const l2 = g.actx.createGain();
      l2.gain.value = spec.slapGain * gain * 0.45;
      node.connect(d2); d2.connect(c2); c2.connect(l2); l2.connect(bus);
    }
  }

  /* ----------------------------- gunshot ----------------------------- */

  function resolveWeapon(idOrDef) {
    if (!idOrDef) return null;
    const id = typeof idOrDef === "string" ? idOrDef : idOrDef.id;
    return WEAPON_VOICE[id] || null;
  }

  /**
   * A gunshot. Five layers, because that is what one is:
   *
   *   crack   the supersonic N-wave. 1-2ms of rise. This is the layer
   *           that decides whether the ear says "rifle" or "firework",
   *           and it is the first thing to die with distance.
   *   body    the muzzle blast proper - a filtered noise burst whose
   *           centre sweeps down as the gas ball expands.
   *   thump   the low-frequency component. Diffracts round terrain and
   *           carries; at range it is nearly all you get.
   *   mech    bolt, carrier, slide, belt links. Only audible close.
   *   tail    the world's answer, see `tail()`.
   *
   * The weights on crack and thump INVERT with distance. At the muzzle
   * it is 90% crack; at 300m it is 90% thump. Getting that inversion
   * right is worth more than any amount of layer count.
   */
  function gunshot(g, position, options = {}) {
    const voice = resolveWeapon(options.weapon || options.def)
      || resolveWeapon(ctx.weapons?.state?.def?.id)
      || DEFAULT_WEAPON_VOICE;

    const local = options.local ?? (ctx.player
      ? position.distanceTo(ctx.player.eyePosition || ctx.player.position) < 3
      : false);

    const pos = positional(g, position, {
      bus: "weapon",
      near: local ? 1.4 : 2.4,
      ref: 34,
      far: 0.58,
      maxDistance: 720,
      absorb: g.absorb ?? 1,
      occlusion: options.occlusion ?? null,
      reverbScale: voice.tailGain,
    });
    if (!pos) return;

    const at = g.actx.currentTime + pos.delay + (options.at || 0);
    const d = pos.distance;
    const gain = (options.gain ?? 1) * voice.gain;
    const pitch = (options.pitch ?? 1) * lerp(0.97, 1.03, g.rng());
    const envName = options.environment || pickSourceEnvironment(position);

    // The physics: HF absorption kills the crack over a couple of
    // hundred metres, the LF blast diffracts and keeps going. Below,
    // `crackW` falls and `thumpW` climbs across the same range.
    const crackW = Math.exp(-d / voice.crackReach) * (voice.supersonic ? 1 : 0.75);
    const bodyW = Math.exp(-d / (voice.crackReach * 2.4)) * 0.55 + 0.45 * Math.exp(-d / 320);
    const thumpW = 0.42 + 1.35 * (1 - Math.exp(-d / 130));

    const totalDuration = 0.28 + d / 500 + (envName === "open" ? 0.5 : 0.2);
    const nodes = [];
    if (!allocVoice(g, local ? PRIORITY.weaponLocal : PRIORITY.weaponRemote, totalDuration,
      () => { for (const n of nodes) { try { n.stop(); } catch (e) { /* ended */ } } })) return;

    /* ---- crack ----
       Playback rate 3.2 on white noise moves the whole spectrum up
       nearly two octaves, which is what gives the layer its 1ms edge.
       A highpass alone was not enough: the transient stayed soft
       because the noise buffer's own energy is flat, not front-loaded. */
    if (crackW > 0.012) {
      const src = noiseSource(g, { rate: 3.2 * pitch });
      const hp = biquad(g, "highpass", voice.crackHz * pitch, 0.8);
      const peak = biquad(g, "peaking", voice.crackHz * 1.6 * pitch, 1.4);
      peak.gain.value = 7;
      const env = envGain(g, at, voice.crackGain * gain * crackW, voice.crackDecay, { attack: 0.0006 });
      src.connect(hp); hp.connect(peak); peak.connect(env); env.connect(pos.input);
      startNoise(src, at, voice.crackDecay + 0.03);
      src.stop(at + voice.crackDecay + 0.03);
      nodes.push(src);
    }

    /* ---- body ---- */
    {
      const src = noiseSource(g, { rate: 1.05 * pitch });
      const bp = biquad(g, "bandpass", voice.bodyHz * pitch, voice.bodyQ);
      // The downward sweep is the expanding gas ball. Without it the
      // body layer is a static "shhh" and reads as a hi-hat.
      bp.frequency.setValueAtTime(voice.bodyHz * pitch, at);
      bp.frequency.exponentialRampToValueAtTime(
        Math.max(30, voice.bodyEndHz * pitch), at + voice.bodyDecay * 1.5);
      const env = envGain(g, at, voice.bodyGain * gain * bodyW, voice.bodyDecay * (1 + d / 900),
        { attack: 0.0015 });
      src.connect(bp); bp.connect(env); env.connect(pos.input);
      startNoise(src, at, voice.bodyDecay * 2 + 0.05);
      src.stop(at + voice.bodyDecay * 2 + 0.05);
      nodes.push(src);
    }

    /* ---- thump ----
       Two oscillators a fifth apart plus a noise skirt. A single sine
       is a kick drum; the beating between two detuned partials is what
       makes it read as a blast rather than a note. */
    {
      const thumpDecay = voice.thumpDecay * (1 + d / 260);
      const env = envGain(g, at, voice.thumpGain * gain * thumpW, thumpDecay, { attack: 0.0025 });
      env.connect(pos.input);
      for (let i = 0; i < 2; i += 1) {
        const osc = g.actx.createOscillator();
        osc.type = i ? "triangle" : "sine";
        const f0 = voice.thumpHz * pitch * (i ? 1.48 : 1);
        const f1 = Math.max(24, voice.thumpEndHz * pitch * (i ? 1.3 : 1));
        osc.frequency.setValueAtTime(f0, at);
        osc.frequency.exponentialRampToValueAtTime(f1, at + thumpDecay * 0.85);
        const trim = g.actx.createGain();
        trim.gain.value = i ? 0.34 : 1;
        osc.connect(trim); trim.connect(env);
        osc.start(at); osc.stop(at + thumpDecay + 0.06);
        nodes.push(osc);
      }
      // Low noise skirt: real blasts are not tonal down there.
      const skirt = noiseSource(g, { pink: true, rate: 0.35 });
      const lp = biquad(g, "lowpass", voice.thumpHz * 2.4, 1.1);
      const skirtEnv = envGain(g, at, voice.thumpGain * gain * thumpW * 0.5, thumpDecay * 1.3,
        { attack: 0.004 });
      skirt.connect(lp); lp.connect(skirtEnv); skirtEnv.connect(pos.input);
      startNoise(skirt, at, thumpDecay * 2);
      skirt.stop(at + thumpDecay * 2);
      nodes.push(skirt);
    }

    /* ---- mechanical ----
       You cannot hear a bolt carrier at 40m. Gating this on distance
       is not an optimisation, it is the correct behaviour, and it is
       most of why the player's own weapon sounds like it is in their
       hands rather than out in the world. */
    if (d < 26 && voice.mech) {
      const m = voice.mech;
      const level = m.gain * gain * clamp01(1 - d / 26);
      for (let i = 0; i < m.count; i += 1) {
        const t = at + m.at + i * m.spread + g.rng() * 0.004;
        const src = noiseSource(g, { rate: lerp(0.9, 1.25, g.rng()) });
        const bp = biquad(g, "bandpass", m.hz * lerp(0.82, 1.2, g.rng()), m.q);
        const env = envGain(g, t, level * (1 - i * 0.18), m.decay, { attack: 0.0006 });
        src.connect(bp); bp.connect(env); env.connect(pos.input);
        startNoise(src, t, m.decay + 0.02);
        src.stop(t + m.decay + 0.02);
        nodes.push(src);
      }
    }

    /* ---- ejected case ---- */
    if (d < 22 && voice.casingDelay) {
      const surface = options.surface || ctx.player?.state?.surface || SURFACE.SAND;
      const t = at + lerp(voice.casingDelay[0], voice.casingDelay[1], g.rng());
      casing(g, position, surface, voice.casingGain * clamp01(1 - d / 22), t, voice.casingLinks);
    }

    /* ---- bolt cycle (manual action) ---- */
    if (d < 20 && voice.boltCycle) boltCycle(g, pos, at + 0.30, gain * clamp01(1 - d / 20));

    /* ---- world's answer ---- */
    tail(g, pos.panner, at, d, envName, clamp01(0.35 + d / 260) * gain * voice.tailGain);

    // A close shot ducks the rest of the mix for a moment. This is the
    // difference between "loud" and "the loudest thing in the world".
    if (d < 40) duck(g, "world", 0.55 + 0.3 * (1 - d / 40), 0.006, 0.16);
  }

  function boltCycle(g, pos, at, gain) {
    // Lift-and-pull, then push-and-lock. Two events ~180ms apart with
    // a brass slide between them.
    const parts = [
      { t: 0, hz: 1900, q: 6, decay: 0.045, level: 0.85 },
      { t: 0.055, hz: 3200, q: 9, decay: 0.030, level: 0.5 },
      { t: 0.185, hz: 2400, q: 7, decay: 0.038, level: 0.7 },
      { t: 0.235, hz: 1500, q: 5, decay: 0.070, level: 0.95 },
    ];
    for (const p of parts) {
      const t = at + p.t + g.rng() * 0.008;
      const src = noiseSource(g, { rate: lerp(0.9, 1.2, g.rng()) });
      const bp = biquad(g, "bandpass", p.hz, p.q);
      const env = envGain(g, t, 0.22 * gain * p.level, p.decay, { attack: 0.0006 });
      src.connect(bp); bp.connect(env); env.connect(pos.input);
      startNoise(src, t, p.decay + 0.02);
      src.stop(t + p.decay + 0.02);
    }
  }

  /** Brass hitting the ground. Bounces, because one clink is a UI beep. */
  function casing(g, position, surface, gain, at, links = false) {
    const cfg = CASING[surface] || CASING[SURFACE.SAND];
    const pos = positional(g, position, {
      bus: "world", near: 1.2, ref: 8, far: 1.4, maxDistance: 30, delay: false,
    });
    if (!pos) return;
    const bounces = links ? cfg.bounces + 2 : cfg.bounces;
    const total = bounces * 0.09 + cfg.decay;
    if (!allocVoice(g, PRIORITY.casing, total)) return;

    for (let i = 0; i < bounces; i += 1) {
      const t = at + i * lerp(0.055, 0.115, g.rng()) * (1 + i * 0.35);
      const level = gain * cfg.gain * Math.pow(0.52, i) * lerp(0.8, 1.2, g.rng());
      const src = noiseSource(g, { rate: lerp(1.0, 1.5, g.rng()) });
      const bp = biquad(g, "bandpass", cfg.hz * lerp(0.85, 1.25, g.rng()), cfg.q);
      const env = envGain(g, t, level, cfg.decay * Math.pow(0.8, i), { attack: 0.0005 });
      src.connect(bp); bp.connect(env); env.connect(pos.input);
      startNoise(src, t, cfg.decay + 0.02);
      src.stop(t + cfg.decay + 0.05);

      // The brass ring itself: a decaying partial on top of the impact
      // noise. Only hard surfaces get it - brass on sand just stops.
      if (cfg.ring > 0.02) {
        const osc = g.actx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = cfg.hz * lerp(1.5, 2.3, g.rng());
        const ringEnv = envGain(g, t, level * cfg.ring * 0.5, cfg.decay * 1.8, { attack: 0.0008 });
        osc.connect(ringEnv); ringEnv.connect(pos.input);
        osc.start(t); osc.stop(t + cfg.decay * 2 + 0.05);
      }
    }
  }

  /* ---------------------------- explosion ---------------------------- */

  function explosionSound(g, position, power = 1, options = {}) {
    const pos = positional(g, position, {
      bus: "blast",
      near: 6,
      ref: 60,
      far: 0.5,
      maxDistance: 1200,
      absorb: (g.absorb ?? 1) * 0.55,   // LF survives; do not eat it
      occlusion: options.occlusion ?? null,
      reverbScale: 1.6,
    });
    if (!pos) return;

    const at = g.actx.currentTime + pos.delay + (options.at || 0);
    const d = pos.distance;
    const p = clamp(power, 0.2, 4);
    const envName = options.environment || pickSourceEnvironment(position);
    const nodes = [];
    if (!allocVoice(g, PRIORITY.explosion, 2.6 + d / 400,
      () => { for (const n of nodes) { try { n.stop(); } catch (e) { /* ended */ } } })) return;

    /* ---- ignition crack ----
       Only survives close. It is the difference between a grenade
       going off next to you and one going off across the map. */
    const crackW = Math.exp(-d / 55);
    if (crackW > 0.02) {
      const src = noiseSource(g, { rate: 2.4 });
      const hp = biquad(g, "highpass", 1400, 0.7);
      const env = envGain(g, at, 1.3 * p * crackW, 0.045, { attack: 0.0005 });
      src.connect(hp); hp.connect(env); env.connect(pos.input);
      startNoise(src, at, 0.08); src.stop(at + 0.08);
      nodes.push(src);
    }

    /* ---- the blast ---- */
    {
      const decay = 0.65 * Math.sqrt(p) * (1 + d / 400);
      const env = envGain(g, at, 1.25 * p, decay, { attack: 0.0035 });
      env.connect(pos.input);
      for (let i = 0; i < 3; i += 1) {
        const osc = g.actx.createOscillator();
        osc.type = i === 0 ? "sine" : "triangle";
        const f0 = (105 - i * 22) * Math.pow(p, -0.22);
        osc.frequency.setValueAtTime(f0, at);
        osc.frequency.exponentialRampToValueAtTime(Math.max(18, f0 * 0.22), at + decay * 0.9);
        const trim = g.actx.createGain();
        trim.gain.value = i === 0 ? 1 : 0.4 / i;
        osc.connect(trim); trim.connect(env);
        osc.start(at); osc.stop(at + decay + 0.1);
        nodes.push(osc);
      }
    }

    /* ---- debris and dust ----
       A long, downward-swept noise bed. Its length is what sells the
       size of the thing; a short one is a firecracker. */
    {
      const src = noiseSource(g, { pink: true, rate: 0.55 });
      const lp = biquad(g, "lowpass", 5600, 0.8);
      lp.frequency.setValueAtTime(5600, at);
      lp.frequency.exponentialRampToValueAtTime(190, at + 1.5 * Math.sqrt(p));
      const env = envGain(g, at, 1.05 * p, 1.6 * Math.sqrt(p), { attack: 0.006 });
      src.connect(lp); lp.connect(env); env.connect(pos.input);
      startNoise(src, at, 2.0 * Math.sqrt(p));
      src.stop(at + 2.0 * Math.sqrt(p));
      nodes.push(src);
    }

    /* ---- rubble ----
       Twenty-odd small impacts scattered over a second. Cheap, and the
       single most effective "this happened in a real place" cue. */
    if (d < 90) {
      const count = Math.round(lerp(6, 16, clamp01(p / 2)) * clamp01(1 - d / 90));
      for (let i = 0; i < count; i += 1) {
        const t = at + 0.12 + g.rng() * 1.1 * Math.sqrt(p);
        const src = noiseSource(g, { rate: lerp(0.9, 1.8, g.rng()) });
        const bp = biquad(g, "bandpass", lerp(500, 3200, g.rng()), lerp(1.5, 6, g.rng()));
        const env = envGain(g, t, 0.16 * p * lerp(0.4, 1, g.rng()) * clamp01(1 - d / 90), 0.06,
          { attack: 0.0008 });
        src.connect(bp); bp.connect(env); env.connect(pos.input);
        startNoise(src, t, 0.09); src.stop(t + 0.09);
        nodes.push(src);
      }
    }

    tail(g, pos.panner, at, d, envName, clamp01(0.5 + d / 200) * p * 1.4, "blast");

    // Sidechain. A blast owns the mix for half a second; without this
    // a grenade going off during sustained automatic fire is simply
    // not heard, which is the exact opposite of what it should do.
    const near = clamp01(1 - d / 120);
    duck(g, "weapon", 1 - 0.62 * near * clamp01(p), 0.012, 0.55);
    duck(g, "world", 1 - 0.7 * near * clamp01(p), 0.012, 0.6);
    duck(g, "vehicle", 1 - 0.55 * near * clamp01(p), 0.012, 0.5);
    duck(g, "ambience", 1 - 0.75 * near * clamp01(p), 0.012, 0.8);

    if (!g.offline && d < 16 * p) concussion(clamp01((1 - d / (16 * p)) * p));
  }

  /* ------------------------------ ducking ------------------------------ */

  /** Schedule a bus duck. Attack fast, release slow - the standard
   *  sidechain shape, and the only one that does not sound like a
   *  mistake. */
  function duck(g, busName, target, attack, release) {
    const bus = g.buses[busName];
    if (!bus) return;
    const now = g.actx.currentTime;
    const param = bus.duck.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(clamp(target, 0.05, 1), now + attack);
    param.setTargetAtTime(1, now + attack + 0.02, release / 3);
  }

  /* ---------------------------- concussion ---------------------------- */

  const deaf = { amount: 0, ringNode: null, ringGain: null };

  /**
   * Tinnitus after a close blast.
   *
   * Three things happen to a real ear: the stapedius reflex clamps the
   * level, the basilar membrane's HF region temporarily stops
   * responding (so everything goes muffled, not quiet), and a tone
   * appears. Modelling all three is what makes it read as damage
   * rather than as somebody turning a knob.
   */
  function concussion(intensity = 1) {
    const g = live;
    if (!g) return;
    const i = clamp01(intensity);
    if (i <= deaf.amount * 0.6) return;
    deaf.amount = Math.max(deaf.amount, i);
    const now = g.actx.currentTime;

    const cutoff = lerp(20000, 380, Math.pow(i, 0.8));
    g.muffle.frequency.cancelScheduledValues(now);
    g.muffle.frequency.setValueAtTime(g.muffle.frequency.value, now);
    g.muffle.frequency.linearRampToValueAtTime(cutoff, now + 0.05);
    // Recovery is slow and exponential. Six to nine seconds, which is
    // long enough to be a consequence and short enough not to be a
    // punishment.
    g.muffle.frequency.setTargetAtTime(20000, now + 0.06, 2.2 + i * 1.4);

    g.muffleHi.gain.cancelScheduledValues(now);
    g.muffleHi.gain.setValueAtTime(g.muffleHi.gain.value, now);
    g.muffleHi.gain.linearRampToValueAtTime(-14 * i, now + 0.05);
    g.muffleHi.gain.setTargetAtTime(0, now + 0.06, 2.0);

    if (!deaf.ringNode) {
      const gain = g.actx.createGain();
      gain.gain.value = 1e-4;
      // Post-limiter would be more honest - the ring is in the head,
      // not in the room - but it would also be the one thing that can
      // push the output past full scale, so it goes in front.
      gain.connect(g.sum);
      const nodes = [];
      for (const [hz, level] of [[4380, 1], [6720, 0.4], [3010, 0.22]]) {
        const osc = g.actx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = hz;
        const trim = g.actx.createGain();
        trim.gain.value = level;
        osc.connect(trim); trim.connect(gain);
        osc.start();
        nodes.push(osc);
      }
      deaf.ringNode = nodes;
      deaf.ringGain = gain;
    }
    const ring = deaf.ringGain.gain;
    ring.cancelScheduledValues(now);
    ring.setValueAtTime(Math.max(1e-4, ring.value), now);
    ring.linearRampToValueAtTime(Math.max(1e-4, 0.075 * i), now + 0.03);
    ring.setTargetAtTime(1e-4, now + 0.04, 1.9 + i * 1.6);

    duck(g, "weapon", 1 - 0.5 * i, 0.01, 1.2);
    duck(g, "world", 1 - 0.6 * i, 0.01, 1.4);
    duck(g, "ambience", 1 - 0.7 * i, 0.01, 1.6);
  }

  /* ------------------------- listener environment -------------------------

     Which of the three reverbs the player is standing in, worked out
     from geometry rather than from trigger volumes. Six rays every
     quarter second: one up, five out. A ceiling above you and walls
     round you is an interior; walls but no ceiling is a street;
     neither is the desert.                                           */

  const _probeDir = new THREE.Vector3();
  const _probeUp = new THREE.Vector3(0, 1, 0);
  const envState = { open: 1, street: 0, interior: 0, timer: 0, label: "open" };

  function probeEnvironment(origin) {
    const physics = ctx.physics;
    if (!physics || !physics.raycast) return { open: 1, street: 0, interior: 0 };

    const mask = LAYER.STATIC | LAYER.DYNAMIC;
    const ceiling = physics.raycast(origin, _probeUp, 14, { layer: mask });
    const roofed = ceiling.hit ? clamp01(1 - ceiling.distance / 14) : 0;

    let near = 0;
    const RAYS = 6;
    for (let i = 0; i < RAYS; i += 1) {
      const a = (i / RAYS) * Math.PI * 2 + 0.4;
      _probeDir.set(Math.cos(a), -0.08, Math.sin(a)).normalize();
      const hit = physics.raycast(origin, _probeDir, 22, { layer: mask });
      if (hit.hit) near += clamp01(1 - hit.distance / 22);
    }
    const enclosure = near / RAYS;

    // Roofed AND enclosed is interior; enclosed alone is a street.
    const interior = clamp01(roofed * 1.15) * clamp01(enclosure * 1.8);
    const street = clamp01(enclosure * 2.0) * (1 - interior);
    const open = clamp01(1 - interior - street);
    return { open, street, interior };
  }

  /** Same question for a SOURCE, cached on a coarse grid. Firing 12
   *  rounds a second from one spot should not cost 72 rays a second. */
  const srcEnvCache = new Map();
  function pickSourceEnvironment(position) {
    if (!ctx.physics || !ctx.physics.raycast) return "open";
    const key = `${Math.round(position.x / 6)},${Math.round(position.y / 4)},${Math.round(position.z / 6)}`;
    const now = ctx.time || 0;
    const cached = srcEnvCache.get(key);
    if (cached && now - cached.t < 4) return cached.name;
    const mix = probeEnvironment(position);
    const name = mix.interior > 0.45 ? "interior" : mix.street > 0.4 ? "street" : "open";
    if (srcEnvCache.size > 220) srcEnvCache.clear();
    srcEnvCache.set(key, { name, t: now });
    return name;
  }

  /* ---------------------------- footsteps ---------------------------- */

  function footstep(g, surface, position, intensity = 1, options = {}) {
    const cfg = FOOTSTEP[surface] || FOOTSTEP[SURFACE.SAND];
    const pos = positional(g, position, {
      bus: "world", near: 1.4, ref: 10, far: 1.5, maxDistance: 60,
      occlusion: options.occlusion ?? null, reverbScale: 0.6,
    });
    if (!pos) return;
    const at = g.actx.currentTime + pos.delay;
    if (!allocVoice(g, PRIORITY.footstep, cfg.scuffDecay + 0.1)) return;
    const level = cfg.gain * intensity;

    /* body: the boot's mass arriving */
    {
      const osc = g.actx.createOscillator();
      osc.type = "sine";
      const f = cfg.bodyHz * lerp(0.88, 1.14, g.rng());
      osc.frequency.setValueAtTime(f, at);
      osc.frequency.exponentialRampToValueAtTime(f * 0.55, at + cfg.bodyDecay);
      const env = envGain(g, at, level * 0.9, cfg.bodyDecay, { attack: 0.001 });
      osc.connect(env); env.connect(pos.input);
      osc.start(at); osc.stop(at + cfg.bodyDecay + 0.04);
    }

    /* scuff: grit, gravel, water */
    {
      const src = noiseSource(g, { pink: cfg.grit < 0.6, rate: lerp(0.85, 1.25, g.rng()) });
      const bp = biquad(g, "bandpass", cfg.scuffHz * lerp(0.85, 1.2, g.rng()), cfg.scuffQ);
      const env = envGain(g, at + 0.004, level * cfg.scuff, cfg.scuffDecay, { attack: 0.003 });
      src.connect(bp); bp.connect(env); env.connect(pos.input);
      startNoise(src, at + 0.004, cfg.scuffDecay + 0.03);
      src.stop(at + cfg.scuffDecay + 0.05);
    }

    // Gear rattle rides on the step and scales with how fast the
    // wearer is moving - a walk clinks, a sprint jangles.
    if (options.gear !== false) gearRattle(g, pos, at, intensity * (options.speed ?? 1));
  }

  /** Webbing, magazines, sling swivels. Three or four tiny metallic
   *  ticks spread over ~120ms. */
  function gearRattle(g, pos, at, amount) {
    const level = 0.075 * clamp01(amount);
    if (level < 0.006) return;
    const count = 2 + Math.floor(g.rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const t = at + 0.01 + g.rng() * 0.13;
      const src = noiseSource(g, { rate: lerp(1.1, 1.9, g.rng()) });
      const bp = biquad(g, "bandpass", lerp(2200, 6200, g.rng()), lerp(6, 16, g.rng()));
      const env = envGain(g, t, level * lerp(0.5, 1, g.rng()), 0.028, { attack: 0.0005 });
      src.connect(bp); bp.connect(env); env.connect(pos.input);
      startNoise(src, t, 0.05); src.stop(t + 0.05);
    }
  }

  /* --------------------------- bullet crack --------------------------- */

  /**
   * A round going past your head.
   *
   * Not delayed by propagation: the bullet is supersonic, so the crack
   * it drags with it reaches you BEFORE the muzzle report does. The
   * gunshot voice is delayed and this one is not, which produces the
   * correct crack-then-boom at range with no extra bookkeeping.
   */
  function bulletCrack(g, position, intensity = 1) {
    const pos = positional(g, position, {
      bus: "weapon", near: 0.8, ref: 6, far: 1.8, maxDistance: 26, delay: false, reverbScale: 0.35,
    });
    if (!pos) return;
    const at = g.actx.currentTime;
    if (!allocVoice(g, PRIORITY.bulletCrack, 0.2)) return;
    const level = clamp01(intensity);

    // The N-wave: a snap with a very short, very bright head.
    const src = noiseSource(g, { rate: lerp(2.6, 3.6, g.rng()) });
    const hp = biquad(g, "highpass", lerp(1600, 2600, g.rng()), 0.7);
    const peak = biquad(g, "peaking", lerp(3400, 5600, g.rng()), 2.0);
    peak.gain.value = 9;
    const env = envGain(g, at, 0.62 * level, 0.022, { attack: 0.0004 });
    src.connect(hp); hp.connect(peak); peak.connect(env); env.connect(pos.input);
    startNoise(src, at, 0.05); src.stop(at + 0.05);

    // The whip that follows: air closing behind the round. Short
    // downward-swept noise, and the part players describe as "I could
    // hear it go past".
    const whip = noiseSource(g, { rate: 1.6 });
    const bp = biquad(g, "bandpass", 2400, 1.2);
    bp.frequency.setValueAtTime(3200, at + 0.004);
    bp.frequency.exponentialRampToValueAtTime(700, at + 0.075);
    const whipEnv = envGain(g, at + 0.004, 0.30 * level, 0.07, { attack: 0.002 });
    whip.connect(bp); bp.connect(whipEnv); whipEnv.connect(pos.input);
    startNoise(whip, at + 0.004, 0.11); whip.stop(at + 0.12);

    // Snap-duck: everything else drops for 100ms so the crack cuts
    // through even in the middle of a firefight.
    duck(g, "ambience", 0.55, 0.005, 0.18);
  }

  /* ---------------------------- one-shots ---------------------------- */

  function playOne(g, name, position, options = {}) {
    const cfg = ONE_SHOTS[name];
    if (!cfg) return;
    const spatial = options.spatial !== false && position;
    const busName = options.bus || cfg.bus || "world";

    let target;
    let at = g.actx.currentTime;
    if (spatial) {
      const pos = positional(g, position, {
        bus: busName, near: 1.5, ref: 14, far: 1.2, maxDistance: 120,
        occlusion: options.occlusion ?? null, reverbScale: 0.7,
      });
      if (!pos) return;
      target = pos.input;
      at += pos.delay;
    } else {
      target = g.buses[busName].input;
    }

    const priority = busName === "ui" ? PRIORITY.ui : busName === "comms" ? PRIORITY.comms : PRIORITY.body;
    if (!allocVoice(g, priority, cfg.decay + 0.1)) return;

    const level = cfg.gain * (options.volume ?? 1);
    const env = envGain(g, at, level, cfg.decay, { attack: cfg.kind === "tone" ? 0.004 : 0.001 });
    env.connect(target);

    if (cfg.kind === "noise") {
      const src = noiseSource(g, { rate: lerp(0.9, 1.15, g.rng()) });
      const bp = biquad(g, "bandpass", cfg.hz * (options.pitch ?? 1), cfg.q ?? 1);
      src.connect(bp); bp.connect(env);
      startNoise(src, at, cfg.decay + 0.05);
      src.stop(at + cfg.decay + 0.08);
    } else {
      const osc = g.actx.createOscillator();
      osc.type = cfg.wave || "triangle";
      osc.frequency.setValueAtTime(cfg.hz * (options.pitch ?? 1), at);
      if (cfg.to) osc.frequency.exponentialRampToValueAtTime(cfg.to * (options.pitch ?? 1), at + cfg.decay);
      osc.connect(env);
      osc.start(at); osc.stop(at + cfg.decay + 0.08);
    }
  }

  /* ------------------------------ radio ------------------------------ */

  /**
   * A teammate callout.
   *
   * Not speech - synthesising intelligible speech in Web Audio is not
   * happening - but a band-limited, compressed, squelched burst with a
   * syllable envelope reads unmistakably as "radio traffic", which is
   * all it needs to do. Three formant-ish resonators on a noise/pulse
   * mix, gated into syllables.
   */
  function radio(g, syllables = 4, options = {}) {
    const bus = g.buses.comms.input;
    const at = g.actx.currentTime;
    const level = (options.volume ?? 1) * 0.34;
    const total = 0.09 + syllables * 0.135 + 0.12;
    if (!allocVoice(g, PRIORITY.comms, total)) return;

    // Squelch open.
    {
      const src = noiseSource(g, { rate: 2.0 });
      const bp = biquad(g, "bandpass", 2600, 3);
      const env = envGain(g, at, level * 0.35, 0.035, { attack: 0.001 });
      src.connect(bp); bp.connect(env); env.connect(bus);
      startNoise(src, at, 0.06); src.stop(at + 0.06);
    }

    const base = lerp(105, 190, options.voice ?? g.rng());
    for (let s = 0; s < syllables; s += 1) {
      const t = at + 0.075 + s * 0.135 + g.rng() * 0.02;
      const dur = lerp(0.06, 0.115, g.rng());
      const voiced = g.rng() > 0.28;

      const env = g.actx.createGain();
      env.gain.setValueAtTime(1e-4, t);
      env.gain.exponentialRampToValueAtTime(level * lerp(0.6, 1, g.rng()), t + 0.012);
      env.gain.setValueAtTime(level * lerp(0.6, 1, g.rng()), t + dur * 0.6);
      env.gain.exponentialRampToValueAtTime(1e-4, t + dur);

      // Radio band. Everything outside 300-3200Hz is thrown away,
      // which is most of what makes it sound like a radio.
      const band1 = biquad(g, "highpass", 320, 0.8);
      const band2 = biquad(g, "lowpass", 3100, 0.8);
      band1.connect(band2); band2.connect(env); env.connect(bus);

      // Formants: three peaking filters roughly where a vowel's are.
      // Parallel, not cascaded - cascading three peaks on the same
      // source produced one narrow resonance, which reads as a kazoo.
      const formants = [
        [lerp(420, 780, g.rng()), 7],
        [lerp(1100, 1900, g.rng()), 9],
        [lerp(2300, 2900, g.rng()), 6],
      ];
      const heads = [];
      for (const [hz, boost] of formants) {
        const f = biquad(g, "peaking", hz, 1.6);
        f.gain.value = boost;
        heads.push(f);
        f.connect(band1);
      }

      if (voiced) {
        const osc = g.actx.createOscillator();
        osc.type = "sawtooth";
        const f0 = base * lerp(0.85, 1.2, g.rng());
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f0 * lerp(0.88, 1.14, g.rng()), t + dur);
        const trim = g.actx.createGain();
        trim.gain.value = 0.5;
        osc.connect(trim);
        for (const f of heads) trim.connect(f);
        osc.start(t); osc.stop(t + dur + 0.02);
      }
      const src = noiseSource(g, { rate: 1.2 });
      const hiss = g.actx.createGain();
      hiss.gain.value = voiced ? 0.16 : 0.6;
      src.connect(hiss);
      for (const f of heads) hiss.connect(f);
      startNoise(src, t, dur + 0.02); src.stop(t + dur + 0.03);
    }

    // Squelch tail.
    {
      const t = at + 0.075 + syllables * 0.135;
      const src = noiseSource(g, { rate: 2.4 });
      const bp = biquad(g, "bandpass", 3400, 2);
      const env = envGain(g, t, level * 0.28, 0.055, { attack: 0.001 });
      src.connect(bp); bp.connect(env); env.connect(bus);
      startNoise(src, t, 0.09); src.stop(t + 0.09);
    }

    // Comms sit under combat, not over it: a callout that fights a
    // firefight for the same space wins neither.
    duck(g, "weapon", 0.82, 0.03, 0.4);
  }

  /* ------------------------ continuous ambience ------------------------ */

  /**
   * Wind, in three bands.
   *
   * One band-passed noise loop is what every browser game does and it
   * sounds like a fan. Real wind is a low rumble that pressure-
   * modulates, a mid body, and a high whistle that only appears in a
   * gust - and it is the correlation between them that reads as
   * weather rather than as noise.
   */
  function startWind(g) {
    if (g.wind) return g.wind;
    const bands = [
      { hz: 90, q: 0.6, gain: 0.34, rate: 0.42 },
      { hz: 460, q: 0.5, gain: 0.24, rate: 0.9 },
      { hz: 2100, q: 0.8, gain: 0.09, rate: 1.5 },
    ];
    const master = g.actx.createGain();
    master.gain.value = 0.05;
    master.connect(g.buses.ambience.input);

    const layers = bands.map((b) => {
      const src = noiseSource(g, { pink: true, rate: b.rate });
      src.loop = true;
      const filter = biquad(g, "bandpass", b.hz, b.q);
      const gain = g.actx.createGain();
      gain.gain.value = b.gain;
      // A slow LFO on each band, at a different rate, so the gusts
      // drift in and out of phase and never repeat audibly.
      const lfo = g.actx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.035 + g.rng() * 0.09;
      const lfoGain = g.actx.createGain();
      lfoGain.gain.value = b.gain * 0.55;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain);
      lfo.start();
      src.connect(filter); filter.connect(gain); gain.connect(master);
      src.start(0, g.rng() * 1.5);
      return { src, filter, gain, lfo, lfoGain, base: b };
    });
    g.wind = { master, layers };
    return g.wind;
  }

  /** Breathing. Silent until stamina drops, then increasingly present. */
  function startBreath(g) {
    if (g.breath) return g.breath;
    const gain = g.actx.createGain();
    gain.gain.value = 0;
    gain.connect(g.buses.world.input);
    g.breath = { gain, next: 0 };
    return g.breath;
  }

  function breathCycle(g, level, effort) {
    const at = g.actx.currentTime;
    // In then out, with the out longer and darker.
    const parts = [
      { t: 0, dur: 0.26 * lerp(1.2, 0.62, effort), hz: 620, q: 0.7, level: 1.0 },
      { t: 0.34 * lerp(1.2, 0.62, effort), dur: 0.34 * lerp(1.2, 0.62, effort), hz: 380, q: 0.55, level: 0.72 },
    ];
    for (const p of parts) {
      const src = noiseSource(g, { pink: true, rate: lerp(0.8, 1.3, g.rng()) });
      const bp = biquad(g, "bandpass", p.hz * lerp(0.9, 1.15, g.rng()), p.q);
      const env = g.actx.createGain();
      const t = at + p.t;
      env.gain.setValueAtTime(1e-4, t);
      env.gain.exponentialRampToValueAtTime(Math.max(1e-4, level * p.level), t + p.dur * 0.35);
      env.gain.exponentialRampToValueAtTime(1e-4, t + p.dur);
      src.connect(bp); bp.connect(env); env.connect(g.breath.gain);
      startNoise(src, t, p.dur + 0.05);
      src.stop(t + p.dur + 0.06);
    }
  }

  /**
   * The far side of the map.
   *
   * Sporadic gunfire and explosions 200-600m away, scheduled at a
   * Poisson-ish rate. This is the single cheapest thing that makes a
   * 1km map feel like a battle rather than like a level: with it, the
   * silence between the player's own engagements is full; without it,
   * a desert with five capture points is a desert.
   */
  function scheduleBattle(g, dt) {
    if (!g.battle) g.battle = { timer: 1.5, bursts: 0 };
    const b = g.battle;
    b.timer -= dt;
    if (b.timer > 0) return;
    b.timer = lerp(1.1, 4.5, g.rng());
    if (!ctx.player) return;

    const origin = ctx.player.position;
    const angle = g.rng() * Math.PI * 2;
    const range = lerp(180, 520, g.rng());
    const p = new THREE.Vector3(
      origin.x + Math.cos(angle) * range,
      origin.y + lerp(-6, 10, g.rng()),
      origin.z + Math.sin(angle) * range
    );

    if (g.rng() < 0.13) {
      explosionSound(g, p, lerp(0.7, 1.6, g.rng()), { environment: "open" });
      return;
    }

    // A burst, not a shot. Real distant fire arrives in bursts of
    // three to eight with the weapon's own cadence.
    const id = ["rifle", "carbine", "lmg", "smg"][Math.floor(g.rng() * 4)];
    const count = 2 + Math.floor(g.rng() * 7);
    const spacing = lerp(0.075, 0.135, g.rng());
    for (let i = 0; i < count; i += 1) {
      gunshot(g, p, {
        weapon: id,
        at: i * spacing,
        gain: lerp(0.75, 1.1, g.rng()),
        environment: "open",
        occlusion: 0,
        local: false,
      });
    }
    b.bursts += 1;
  }

  /* ---------------------------- vehicles ---------------------------- */

  const engines = new Map();

  /**
   * An engine.
   *
   * Frequency comes from an RPM that is driven by throttle AND by
   * load, not from road speed - that relationship is what makes a
   * vehicle sound like it is working. Flooring a stationary jeep
   * should scream; cruising at the same speed downhill should not.
   */
  function makeEngine(g, vehicle) {
    const aircraft = Boolean(vehicle.spec.aircraft);
    const bus = g.buses.vehicle.input;
    const out = g.actx.createGain();
    out.gain.value = 0;

    const panner = g.actx.createPanner();
    panner.panningModel = "HRTF";
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    panner.maxDistance = 100000;
    const air = biquad(g, "lowpass", 18000, 0.6);
    out.connect(air); air.connect(panner); panner.connect(bus);

    const send = g.actx.createGain();
    send.gain.value = 0.18;
    panner.connect(send);
    for (const name of Object.keys(ENVIRONMENTS)) send.connect(g.reverb[name].send);

    const parts = [];
    if (aircraft) {
      // Turbine whine plus blade slap. The slap is amplitude
      // modulation at the blade-pass frequency, which is what makes a
      // helicopter identifiable from four hundred metres.
      const turbine = g.actx.createOscillator();
      turbine.type = "sawtooth";
      turbine.frequency.value = 210;
      const tFilter = biquad(g, "bandpass", 1800, 2.2);
      const tGain = g.actx.createGain();
      tGain.gain.value = 0.10;
      turbine.connect(tFilter); tFilter.connect(tGain); tGain.connect(out);
      turbine.start();

      const rotor = noiseSource(g, { pink: true, rate: 0.5 });
      rotor.loop = true;
      const rFilter = biquad(g, "lowpass", 520, 1.0);
      const rGain = g.actx.createGain();
      rGain.gain.value = 0.5;
      const chop = g.actx.createOscillator();
      chop.type = "sawtooth";
      chop.frequency.value = 17;
      const chopDepth = g.actx.createGain();
      chopDepth.gain.value = 0.42;
      chop.connect(chopDepth); chopDepth.connect(rGain.gain);
      chop.start();
      rotor.connect(rFilter); rFilter.connect(rGain); rGain.connect(out);
      rotor.start(0, g.rng());
      parts.push({ kind: "turbine", osc: turbine }, { kind: "chop", osc: chop });
    } else {
      // Four harmonics of the firing frequency plus intake noise. A
      // single oscillator is a moped no matter what you do to it.
      for (const [mult, level, type] of [[1, 0.45, "sawtooth"], [2, 0.26, "square"],
        [3, 0.14, "sawtooth"], [0.5, 0.30, "triangle"]]) {
        const osc = g.actx.createOscillator();
        osc.type = type;
        osc.frequency.value = 60 * mult;
        const gain = g.actx.createGain();
        gain.gain.value = level;
        osc.connect(gain); gain.connect(out);
        osc.start();
        parts.push({ kind: "harm", osc, mult, gain, level });
      }
      const intake = noiseSource(g, { pink: true, rate: 0.9 });
      intake.loop = true;
      const iFilter = biquad(g, "bandpass", 700, 0.8);
      const iGain = g.actx.createGain();
      iGain.gain.value = 0.1;
      intake.connect(iFilter); iFilter.connect(iGain); iGain.connect(out);
      intake.start(0, g.rng());
      parts.push({ kind: "intake", src: intake, filter: iFilter, gain: iGain });
    }

    const tone = biquad(g, "lowpass", 3000, 0.8);
    return { vehicle, out, air, panner, parts, aircraft, tone, rpm: 0.15, prevDistance: null };
  }

  function updateEngines(g, dt) {
    const list = ctx.vehicles?.vehicles;
    if (!list) return;
    const lp = g.listener.pos;
    const seen = new Set();

    for (const vehicle of list) {
      if (!vehicle.alive) continue;
      const dx = vehicle.position.x - lp.x;
      const dy = vehicle.position.y - lp.y;
      const dz = vehicle.position.z - lp.z;
      const distance = Math.hypot(dx, dy, dz);
      const audible = distance < (vehicle.spec.aircraft ? 620 : 260);
      const running = vehicle.occupants.length > 0 || vehicle.spec.aircraft === true;
      if (!audible || !running) continue;

      seen.add(vehicle);
      let engine = engines.get(vehicle);
      if (!engine) { engine = makeEngine(g, vehicle); engines.set(vehicle, engine); }

      const speed = Math.hypot(vehicle.velocity.x, vehicle.velocity.z);
      const top = vehicle.spec.topSpeed || vehicle.spec.maxSpeed || 30;
      const throttle = Math.abs(vehicle.throttle || 0);
      // Load: how much of the commanded throttle is NOT being turned
      // into speed. A vehicle climbing or accelerating is loaded; one
      // coasting at the same speed is not. Without this term the
      // engine is just a speedometer.
      const load = clamp01(throttle - clamp01(speed / top) * 0.8);
      const targetRpm = clamp01(0.13 + clamp01(speed / top) * 0.55 + throttle * 0.30 + load * 0.35);
      engine.rpm = damp(engine.rpm, targetRpm, 4.5, dt);

      // Doppler, computed by hand: the spec's own doppler was removed
      // from Web Audio, and the radial component is the only part that
      // matters anyway.
      let doppler = 1;
      if (engine.prevDistance !== null && dt > 1e-4) {
        const closing = (engine.prevDistance - distance) / dt;
        doppler = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND - clamp(closing, -110, 110)), 0.78, 1.28);
      }
      engine.prevDistance = distance;

      const now = g.actx.currentTime;
      if (engine.aircraft) {
        const bladeHz = lerp(11, 22, engine.rpm) * (vehicle.rotorSpin ?? 1);
        for (const p of engine.parts) {
          if (p.kind === "turbine") p.osc.frequency.setTargetAtTime(lerp(150, 420, engine.rpm) * doppler, now, 0.08);
          if (p.kind === "chop") p.osc.frequency.setTargetAtTime(bladeHz * doppler, now, 0.12);
        }
      } else {
        const hz = lerp(28, 132, engine.rpm) * doppler;
        for (const p of engine.parts) {
          if (p.kind === "harm") {
            p.osc.frequency.setTargetAtTime(hz * p.mult, now, 0.05);
            // Upper harmonics come in with load: that brightening is
            // what the ear reads as "working hard".
            p.gain.gain.setTargetAtTime(p.level * lerp(0.55, 1.25, load + engine.rpm * 0.4), now, 0.1);
          }
          if (p.kind === "intake") {
            p.filter.frequency.setTargetAtTime(lerp(420, 1500, engine.rpm), now, 0.08);
            p.gain.gain.setTargetAtTime(lerp(0.04, 0.22, throttle), now, 0.08);
          }
        }
      }

      const level = distanceGain(distance, 4, 40, 0.7) * (engine.aircraft ? 1.5 : 0.9);
      engine.out.gain.setTargetAtTime(clamp(level, 0, 2), now, 0.06);
      engine.air.frequency.setTargetAtTime(airCutoff(distance, g.absorb ?? 1), now, 0.15);
      if (engine.panner.positionX) {
        engine.panner.positionX.setTargetAtTime(vehicle.position.x, now, 0.05);
        engine.panner.positionY.setTargetAtTime(vehicle.position.y, now, 0.05);
        engine.panner.positionZ.setTargetAtTime(vehicle.position.z, now, 0.05);
      } else {
        engine.panner.setPosition(vehicle.position.x, vehicle.position.y, vehicle.position.z);
      }
    }

    for (const [vehicle, engine] of engines) {
      if (seen.has(vehicle)) continue;
      engine.out.gain.setTargetAtTime(0, g.actx.currentTime, 0.12);
      if (engine.out.gain.value < 0.001) {
        for (const p of engine.parts) { try { (p.osc || p.src).stop(); } catch (e) { /* ended */ } }
        engine.out.disconnect();
        engines.delete(vehicle);
      }
    }
  }

  /* ------------------------------ live ------------------------------ */

  let live = null;
  let started = false;

  function ensureContext() {
    if (live) return live;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    let actx;
    try {
      actx = new Ctor({ latencyHint: "interactive" });
    } catch (error) {
      return null;
    }
    live = createGraph(actx, { seed: ctx.seed ^ 0xa11d10 });
    live.absorb = 1;
    return live;
  }

  /* ------------------------- offline rendering ------------------------- */

  /**
   * Render one event into an OfflineAudioContext and hand back the
   * samples.
   *
   * This is the measurement harness's entire reason for existing, and
   * the reason every voice above takes its graph as an argument. If
   * these functions read a module-level AudioContext, nothing about
   * the mix could be measured and the only test available would be
   * "it did not throw".
   */
  async function renderOffline(spec = {}) {
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) throw new Error("OfflineAudioContext unavailable");

    const seconds = spec.seconds ?? 2.5;
    const sampleRate = spec.sampleRate ?? 48000;
    const actx = new OfflineCtor(2, Math.ceil(seconds * sampleRate), sampleRate);

    const g = createGraph(actx, {
      offline: true,
      seed: spec.seed ?? 0x51ee7,
      envMix: spec.envMix || { open: 1, street: 0, interior: 0 },
      voiceCap: spec.voiceCap ?? VOICE_CAP,
    });
    g.absorb = spec.absorb ?? 1;

    // Listener at the origin, facing -Z, ears level. Fixed so a
    // measured azimuth means the same thing every run.
    g.listener.pos.set(0, 1.6, 0);
    g.listener.fwd.set(0, 0, -1);
    const L = actx.listener;
    if (L.positionX) {
      L.positionX.value = 0; L.positionY.value = 1.6; L.positionZ.value = 0;
      L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(0, 1.6, 0);
      L.setOrientation(0, 0, -1, 0, 1, 0);
    }

    function place(distance, azimuthDeg = 0, elevation = 0) {
      const a = (azimuthDeg * Math.PI) / 180;
      return new THREE.Vector3(
        Math.sin(a) * distance,
        1.6 + elevation,
        -Math.cos(a) * distance
      );
    }

    const distance = spec.distance ?? 6;
    const at = place(distance, spec.azimuth ?? 0, spec.elevation ?? 0);
    const environment = spec.environment || "open";
    const occlusion = spec.occlusion ?? 0;
    const common = { environment, occlusion, ...(spec.options || {}) };

    switch (spec.event) {
      case "gunshot":
        gunshot(g, at, { weapon: spec.weapon || "rifle", local: distance < 3, ...common });
        break;
      case "explosion":
        explosionSound(g, at, spec.power ?? 1, common);
        break;
      case "footstep":
        footstep(g, spec.surface || SURFACE.SAND, at, spec.intensity ?? 1,
          { occlusion, speed: spec.speed ?? 1 });
        break;
      case "bulletCrack":
        bulletCrack(g, at, spec.intensity ?? 1);
        break;
      case "casing":
        casing(g, at, spec.surface || SURFACE.CONCRETE, 1, actx.currentTime + 0.02, false);
        break;
      case "radio":
        radio(g, spec.syllables ?? 4, { volume: spec.volume ?? 1 });
        break;
      case "wind": {
        const bed = startWind(g);
        bed.master.gain.value = 0.035 + (spec.windStrength ?? 1) * 0.05;
        break;
      }
      case "burst": {
        // Sustained fire: what the mix actually has to survive.
        const rpm = spec.rpm ?? 780;
        const shots = spec.shots ?? 10;
        for (let i = 0; i < shots; i += 1) {
          gunshot(g, at, { weapon: spec.weapon || "rifle", at: (i * 60) / rpm, ...common });
        }
        break;
      }
      case "stress": {
        // The worst case the brief asks for: eight simultaneous
        // explosions plus sustained automatic fire from four bearings.
        for (let i = 0; i < 8; i += 1) {
          const p = place(lerp(8, 46, i / 7), i * 47, 0);
          explosionSound(g, p, 1.4, { environment, occlusion: 0, at: i * 0.012 });
        }
        const bearings = [0, 90, 180, 270];
        const guns = ["rifle", "carbine", "lmg", "smg"];
        for (let b = 0; b < 4; b += 1) {
          const p = place(lerp(14, 40, b / 3), bearings[b], 0);
          const rpm = [780, 600, 720, 900][b];
          const shots = Math.floor((seconds - 0.2) * (rpm / 60));
          for (let i = 0; i < shots; i += 1) {
            gunshot(g, p, { weapon: guns[b], at: (i * 60) / rpm, environment, occlusion: 0 });
          }
        }
        break;
      }
      default:
        throw new Error(`unknown probe event "${spec.event}"`);
    }

    const buffer = await actx.startRendering();
    return {
      sampleRate: buffer.sampleRate,
      length: buffer.length,
      left: buffer.getChannelData(0),
      right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0),
      stats: { ...g.stats },
    };
  }

  /* ------------------------------- api ------------------------------- */

  const listenerPos = new THREE.Vector3();
  const listenerFwd = new THREE.Vector3();
  const listenerUp = new THREE.Vector3(0, 1, 0);

  const feedback = { lowAmmoAt: -10, calloutAt: -10, captureStep: -1, suppression: 0 };
  let unbind = [];

  /** Feedback is wired through the event bus rather than by asking the
   *  other modules to call us, so adding a new cue never needs an edit
   *  outside this file. */
  function bindEvents() {
    const on = (type, fn) => unbind.push(ctx.bus.on(type, fn));

    on("weapon:hit", ({ headshot, killed }) => {
      if (!live) return;
      playOne(live, headshot ? "headshot" : "hitmark", null, { spatial: false, volume: 0.9 });
      if (killed) playOne(live, "kill", null, { spatial: false, volume: 0.8 });
    });

    on("weapon:fire", ({ def, ammo }) => {
      if (!live || !def) return;
      const low = Math.max(3, Math.round(def.magazine * 0.18));
      if (ammo > 0 && ammo <= low && ctx.time - feedback.lowAmmoAt > 0.25) {
        feedback.lowAmmoAt = ctx.time;
        // Under the shot, not over it: a low-ammo beep that fights the
        // gunfire is a beep the player learns to resent.
        playOne(live, "lowammo", null, { spatial: false, volume: 0.5, pitch: 1 + (ammo / low) * 0.1 });
      }
    });

    on("weapon:reloadstart", ({ def }) => {
      if (!live || !ctx.player) return;
      magazineSounds(def);
    });

    on("world:capture", ({ to }) => {
      if (!live) return;
      const mine = ctx.player && to === ctx.player.state.team;
      playOne(live, mine ? "capture" : "lost", null, { spatial: false, volume: 0.9 });
      if (mine) callout(0.35);
    });

    on("player:damage", () => { feedback.suppression = 1; });
    on("bot:death", () => { if (live && ctx.rng() < 0.18) callout(0.9); });
    on("vehicle:enter", () => { if (live) playOne(live, "click", null, { spatial: false, volume: 0.4 }); });
  }

  /** Magazine out, magazine in, bolt release. Three events over the
   *  reload's duration rather than one generic "reload" click. */
  function magazineSounds(def) {
    const g = live;
    if (!g || !ctx.player) return;
    const pos = positional(g, ctx.player.position, {
      bus: "world", near: 1.2, ref: 8, far: 1.4, maxDistance: 26, delay: false, reverbScale: 0.4,
    });
    if (!pos) return;
    const at = g.actx.currentTime;
    const total = def?.reloadTime || 2.2;
    const events = [
      { t: 0.06, hz: 1600, q: 5, decay: 0.05, level: 0.30 },
      { t: 0.30, hz: 900, q: 3, decay: 0.09, level: 0.24 },
      { t: total * 0.52, hz: 2100, q: 6, decay: 0.06, level: 0.32 },
      { t: total * 0.70, hz: 1300, q: 4, decay: 0.10, level: 0.36 },
      { t: total * 0.90, hz: 3000, q: 9, decay: 0.04, level: 0.28 },
    ];
    if (!allocVoice(g, PRIORITY.body, total + 0.2)) return;
    for (const e of events) {
      const t = at + e.t + g.rng() * 0.01;
      const src = noiseSource(g, { rate: lerp(0.9, 1.2, g.rng()) });
      const bp = biquad(g, "bandpass", e.hz, e.q);
      const env = envGain(g, t, e.level, e.decay, { attack: 0.0006 });
      src.connect(bp); bp.connect(env); env.connect(pos.input);
      startNoise(src, t, e.decay + 0.02);
      src.stop(t + e.decay + 0.04);
    }
  }

  function callout(volume = 1) {
    if (!live) return;
    if (ctx.time - feedback.calloutAt < 3) return;
    feedback.calloutAt = ctx.time;
    radio(live, 3 + Math.floor(live.rng() * 4), { volume });
  }

  const api = {
    get context() { return live ? live.actx : null; },
    get ready() { return started; },
    WEAPON_VOICE,
    ENVIRONMENTS,

    /** Browsers require a gesture. The HUD calls this on first click. */
    unlock() {
      const g = ensureContext();
      if (!g) return false;
      if (g.actx.state === "suspended") g.actx.resume();
      started = true;
      startWind(g);
      startBreath(g);
      if (!unbind.length) bindEvents();
      return true;
    },

    suspend() { if (live && live.actx.state === "running") live.actx.suspend(); },
    resume() { if (live && live.actx.state === "suspended") live.actx.resume(); },

    gunshot(position, options) { const g = ensureContext(); if (g) gunshot(g, position, options || {}); },
    explosion(position, power, options) {
      const g = ensureContext(); if (g) explosionSound(g, position, power ?? 1, options || {});
    },
    footstep(surface, position, intensity, options) {
      const g = ensureContext();
      if (!g) return;
      const speed = ctx.player ? clamp01(ctx.player.state.speed / 5.4) : 0.5;
      footstep(g, surface, position, intensity ?? 1, { speed, ...(options || {}) });
    },
    bulletCrack(position, intensity) {
      const g = ensureContext(); if (g) bulletCrack(g, position, intensity ?? 1);
    },
    casing(position, surface, gain) {
      const g = ensureContext();
      if (g) casing(g, position, surface || SURFACE.SAND, gain ?? 1, g.actx.currentTime + 0.01, false);
    },
    playAt(name, position, options) { const g = ensureContext(); if (g) playOne(g, name, position, options || {}); },
    radio(syllables, options) { const g = ensureContext(); if (g) radio(g, syllables ?? 4, options || {}); },
    callout,
    concussion,

    /** Vault, splash, landing - movement events other modules may not
     *  know to ask for yet, exposed so they can. */
    vault(position) { api.playAt("vault", position, { volume: 0.9 }); },
    splash(position, intensity = 1) { api.playAt("splash", position, { volume: intensity }); },

    setVolume(bus, value) {
      const g = live;
      if (!g) {
        // Remember the change even before the graph exists, or the
        // options menu silently does nothing until the first shot.
        if (bus === "master") settings.prefs.masterVolume = value;
        if (bus === "sfx") settings.prefs.sfxVolume = value;
        if (bus === "music") settings.prefs.musicVolume = value;
        return;
      }
      if (bus === "master") { g.out.gain.value = value; settings.prefs.masterVolume = value; }
      if (bus === "sfx") {
        settings.prefs.sfxVolume = value;
        for (const name of BUS_NAMES) {
          if (name === "music" || name === "comms") continue;
          g.buses[name].trim.gain.value = g.buses[name].base * value;
        }
      }
      if (bus === "music") { g.buses.music.trim.gain.value = g.buses.music.base * value; settings.prefs.musicVolume = value; }
      if (bus === "voice") { g.buses.comms.trim.gain.value = g.buses.comms.base * value; settings.prefs.voiceVolume = value; }
    },

    /** Environment mix, for anything that wants to force it. */
    setEnvironment(mix, immediate = false) { if (live) setEnvMix(live, mix, immediate); },

    renderOffline,

    update(dt) {
      const g = live;
      if (!g || !ctx.player) return;
      const player = ctx.player;

      /* ---- listener ---- */
      listenerPos.copy(player.eyePosition || player.position);
      listenerFwd.copy(player.aimDirection);
      g.listener.pos.copy(listenerPos);
      g.listener.fwd.copy(listenerFwd);

      const L = g.actx.listener;
      const t = g.actx.currentTime;
      if (L.positionX) {
        L.positionX.setTargetAtTime(listenerPos.x, t, 0.02);
        L.positionY.setTargetAtTime(listenerPos.y, t, 0.02);
        L.positionZ.setTargetAtTime(listenerPos.z, t, 0.02);
        L.forwardX.setTargetAtTime(listenerFwd.x, t, 0.02);
        L.forwardY.setTargetAtTime(listenerFwd.y, t, 0.02);
        L.forwardZ.setTargetAtTime(listenerFwd.z, t, 0.02);
        L.upX.setTargetAtTime(listenerUp.x, t, 0.02);
        L.upY.setTargetAtTime(listenerUp.y, t, 0.02);
        L.upZ.setTargetAtTime(listenerUp.z, t, 0.02);
      } else {
        L.setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
        L.setOrientation(listenerFwd.x, listenerFwd.y, listenerFwd.z, 0, 1, 0);
      }

      /* ---- which space am I in ---- */
      envState.timer -= dt;
      if (envState.timer <= 0) {
        envState.timer = 0.25;
        const mix = probeEnvironment(listenerPos);
        // Smooth rather than snap: a doorway is a crossfade.
        envState.open = damp(envState.open, mix.open, 3.2, 0.25);
        envState.street = damp(envState.street, mix.street, 3.2, 0.25);
        envState.interior = damp(envState.interior, mix.interior, 3.2, 0.25);
        envState.label = envState.interior > 0.45 ? "interior"
          : envState.street > 0.4 ? "street" : "open";
        setEnvMix(g, envState);
      }

      /* ---- wind ---- */
      const weather = ctx.sky ? ctx.sky.weather : "clear";
      const strength = ctx.foliage ? ctx.foliage.wind.strength : 1;
      // Dust and storm eat the top end of everything, not just the
      // wind bed: suspended particulate is a lowpass on the whole map.
      g.absorb = weather === "dust" ? 2.0 : weather === "storm" ? 1.6
        : weather === "overcast" ? 1.15 : weather === "hazy" ? 1.05 : 1;

      if (g.wind) {
        // Altitude: wind is stronger and thinner up high, which is the
        // cue a helicopter needs to feel like it has left the ground.
        const ground = ctx.terrain ? ctx.terrain.heightAt(listenerPos.x, listenerPos.z) : 0;
        const altitude = clamp01((listenerPos.y - ground) / 90);
        const indoors = envState.interior;
        const level = (0.030 + strength * 0.028 + altitude * 0.045) * lerp(1, 0.22, indoors);
        g.wind.master.gain.setTargetAtTime(level, t, 0.4);
        const bands = g.wind.layers;
        bands[0].filter.frequency.setTargetAtTime(lerp(70, 130, clamp01(strength / 3)), t, 0.5);
        bands[1].filter.frequency.setTargetAtTime(lerp(360, 720, clamp01(strength / 3)) * lerp(1, 1.4, altitude), t, 0.5);
        bands[2].gain.gain.setTargetAtTime(0.03 + clamp01(strength / 3) * 0.11 + altitude * 0.08, t, 0.5);
      }

      /* ---- breathing ---- */
      if (g.breath) {
        const stamina = player.state.stamina ?? 1;
        const effort = clamp01(1 - stamina);
        const wounded = clamp01(1 - (player.state.health ?? 100) / 100);
        const drive = clamp01(effort * 0.85 + wounded * 0.5);
        g.breath.gain.gain.setTargetAtTime(player.state.alive ? clamp01(drive) * 0.34 : 0, t, 0.3);
        if (drive > 0.06 && player.state.alive) {
          g.breath.next -= dt;
          if (g.breath.next <= 0) {
            g.breath.next = lerp(2.6, 0.85, drive);
            breathCycle(g, 0.55, drive);
          }
        }
      }

      /* ---- gear, continuous ---- */
      // Handled per footstep; nothing to do here beyond keeping the
      // suppression decay running for the incoming-fire cue.
      feedback.suppression = damp(feedback.suppression, 0, 1.4, dt);

      /* ---- vehicles ---- */
      updateEngines(g, dt);

      /* ---- the rest of the war ---- */
      scheduleBattle(g, dt);

      /* ---- deafness recovery ---- */
      if (deaf.amount > 0) deaf.amount = Math.max(0, deaf.amount - dt / 7);
    },

    report() {
      const g = live;
      if (!g) return { state: "none", sampleRate: 0, voices: 0, environment: envState.label };
      reap(g);
      return {
        state: g.actx.state,
        sampleRate: g.actx.sampleRate,
        voices: g.voices.size,
        peakVoices: g.stats.peakVoices,
        started: g.stats.started,
        stolen: g.stats.stolen,
        dropped: g.stats.dropped,
        environment: envState.label,
        envMix: {
          open: Number(g.envMix.open.toFixed(2)),
          street: Number(g.envMix.street.toFixed(2)),
          interior: Number(g.envMix.interior.toFixed(2)),
        },
        limiterReduction: Number((g.limiter.reduction || 0).toFixed(2)),
        muffleHz: Math.round(g.muffle.frequency.value),
        deafness: Number(deaf.amount.toFixed(2)),
        engines: engines.size,
        absorb: Number((g.absorb ?? 1).toFixed(2)),
      };
    },

    dispose() {
      for (const off of unbind) off();
      unbind = [];
      if (live) live.actx.close().catch(() => {});
      live = null;
    },
  };

  return api;
}
