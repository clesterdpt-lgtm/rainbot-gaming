/* ============================================================
   SAINTFALL - audio

   Gameplay sound in this file is synthesised. The drop cinematic also
   lazy-loads a tiny set of CC0 transients from the shared Rainbot sound
   bank, then layers them under procedural cabin, plasma and engine
   voices. Everything still runs through this one graph and master.

   The engine is a small graph:

     one-shots -> per-voice gain -> bus gain -> master -> destination

   with category buses so a sound family can be mixed or ducked without
   touching the individual voices.

   Two rules the browser imposes, both of which are load-bearing:

   - An AudioContext starts SUSPENDED until a real user gesture. The
     game cannot make a sound before the player clicks, and nothing
     here may throw or queue up if it tries.
   - Every node is single-use. A BufferSource or Oscillator that has
     been started cannot be restarted, so voices are built per shot
     and left to be collected. The expensive part - the noise buffer -
     is built once and shared.
   ============================================================ */

import { clamp01, lerp } from "saintfall/core.js";

const NOISE_SECONDS = 2.0;
const CINEMATIC_NOISE_SECONDS = 4.0;
const DROP_ASSET_ROOT = new URL("../../Sounds/shared/", import.meta.url);
const DROP_ASSETS = Object.freeze({
  confirm: "ui/confirm.ogg",
  drop: "ui/drop.ogg",
  metal: "impact/metal.ogg",
  softHeavy: "impact/soft-heavy.ogg",
  forceField: "sci-fi/force-field.ogg",
  lowExplosion: "sci-fi/low-explosion.ogg",
  metalImpact: "sci-fi/metal-impact.ogg",
  doorOpen: "sci-fi/door-open.ogg",
});

export function buildAudio(ctx) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor && !(ctx && ctx.__audioContext)) {
    // No Web Audio at all. Everything below still has to be callable.
    return makeSilentApi();
  }

  /* An injected context is how this gets TESTED. Rendered through an
     OfflineAudioContext the whole graph can be measured for actual
     signal, which is the only way to tell a working one-shot from one
     that builds its nodes, connects them to nothing and is collected
     in silence - the two are indistinguishable from every other
     vantage point, including "no console errors". */
  const ac = (ctx && ctx.__audioContext) || new Ctor({ latencyHint: "interactive" });
  const master = ac.createGain();
  master.gain.value = 1.35;

  /* A limiter on the way out. Sustained fire puts three or four
     overlapping gunshots into the bus at once, and without this the
     sum clips - which is heard as a crackle exactly when the action
     peaks, i.e. at the worst possible moment. A fast-attack
     compressor with a high ratio is doing the job of a brick wall
     here, not the job of a mix compressor. */
  const limiter = ac.createDynamicsCompressor
    ? ac.createDynamicsCompressor() : null;
  if (limiter) {
    /* Threshold near the ceiling and a steep ratio: this should be
       inaudible on a single sound and only engage when several
       overlap. Set lower it acts as a mix compressor instead, and
       pulls every quiet sound down with it - an early setting at -8dB
       took the impacts from 0.26 to 0.065 while doing nothing useful. */
    limiter.threshold.value = -2.5;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;
    master.connect(limiter);
    limiter.connect(ac.destination);
  } else {
    master.connect(ac.destination);
  }

  const buses = {};
  for (const [name, level] of Object.entries({
    weapon: 0.9, world: 0.75, ui: 0.6, ambience: 0.5, cinematic: 0.72,
  })) {
    const g = ac.createGain();
    g.gain.value = level;
    g.connect(master);
    buses[name] = g;
  }

  /* One white-noise buffer, shared by every noise voice in the game.
     Generating a fresh buffer per gunshot allocates 88KB and blocks
     the main thread, at nine shots a second. */
  const noise = ac.createBuffer(1, ac.sampleRate * NOISE_SECONDS, ac.sampleRate);
  {
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      const w = Math.random() * 2 - 1;
      // Slightly brown-tinted. Pure white noise reads as a hiss;
      // rolling it off gives everything built on it some weight.
      last = (last + w * 0.06) / 1.02;
      d[i] = w * 0.7 + last * 3.2;
    }
  }

  /* The drop lasts long enough for a two-second random loop point to
     become audible. Its noise bed is longer and deterministic: visual
     turbulence can now drive the same sonic movement in every run,
     while the ordinary firefight keeps the looser random texture it
     has always used. */
  const cinematicNoise = ac.createBuffer(
    1, ac.sampleRate * CINEMATIC_NOISE_SECONDS, ac.sampleRate
  );
  {
    const d = cinematicNoise.getChannelData(0);
    let seed = 0x51a17fa1;
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const w = ((seed >>> 0) / 4294967295) * 2 - 1;
      last = (last + w * 0.045) / 1.018;
      d[i] = w * 0.62 + last * 3.5;
    }
  }

  const state = {
    enabled: true,
    started: false,
    offline: false,
    paused: false,
    listenerX: 0,
    listenerZ: 0,
    listenerYaw: 0,
    voices: 0,
  };

  const drop = {
    active: false,
    paused: false,
    sources: new Set(),
    buffers: new Map(),
    loads: new Map(),
    loadErrors: new Map(),
    beds: null,
    run: 0,
    cueSerial: 0,
    pauseQueue: Promise.resolve(true),
    controls: {
      heat: 0,
      turbulence: 0,
      retro: 0,
      altitude: 1,
      velocity: 0,
    },
  };

  /* A hard voice cap. A garrison of thirty units firing bursts can
     ask for more simultaneous voices than the context can mix, and
     the failure mode is not "quieter" - it is crackling and dropped
     frames. Past the cap, new sounds are simply not played, which is
     inaudible next to the twenty already playing. */
  const MAX_VOICES = 28;

  function now() { return ac.currentTime; }

  /**
   * A voice: one gain node, routed to a bus, self-cleaning.
   *
   * Callers connect their own sub-graph INTO the returned node. The
   * routing onward is this function's business, so a positional
   * sound can insert a panner without every caller knowing.
   */
  function voice(bus, duration) {
    if (!state.enabled) return null;
    if (ac.state !== "running" && !state.offline) return null;
    if (state.voices >= MAX_VOICES) return null;
    const g = ac.createGain();
    g.gain.value = 1;
    const target = buses[bus] || buses.world;
    g.connect(target);
    g.__bus = target;
    state.voices += 1;
    window.setTimeout(() => {
      state.voices = Math.max(0, state.voices - 1);
      try { g.disconnect(); } catch (_) { /* already gone */ }
    }, Math.ceil(duration * 1000) + 60);
    return g;
  }

  /**
   * Place a voice in the world: attenuate by distance, pan by bearing.
   *
   * The panner is spliced in SERIES, which means disconnecting the
   * direct bus route first. Connecting it in parallel instead - the
   * obvious way, and the way this was first written - leaves half the
   * signal bypassing the panner, so everything sounds half-centred
   * and nothing ever pans fully to one side.
   */
  function place(g, x, z, refDist = 22, maxDist = 420) {
    const dx = x - state.listenerX;
    const dz = z - state.listenerZ;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist) return null;
    // Floored falloff, not true inverse-square: a distant machine gun
    // has to stay faintly audible, because hearing WHERE the fight is
    // is most of the information audio carries in an open level.
    const atten = refDist / (refDist + Math.max(0, dist - refDist) * 1.6);
    if (ac.createStereoPanner) {
      try { g.disconnect(); } catch (_) { /* not connected yet */ }
      const pan = ac.createStereoPanner();
      // Bearing relative to where the player is facing, so turning
      // your head moves the battle across the stereo field.
      const rel = Math.atan2(dx, dz) - state.listenerYaw;
      pan.pan.value = Math.max(-0.92, Math.min(0.92, Math.sin(rel)));
      g.connect(pan);
      pan.connect(g.__bus);
    }
    return { node: g, atten };
  }

  function noiseSource(playbackRate = 1) {
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = playbackRate;
    src.loopStart = Math.random() * (NOISE_SECONDS - 0.5);
    src.loopEnd = NOISE_SECONDS;
    return src;
  }

  /* ============================================================
     ONE-SHOTS
     ============================================================ */

  /**
   * The autogun.
   *
   * Three layers, because a single noise burst reads as a hiss and a
   * single oscillator reads as a beep: a filtered noise crack for the
   * report, a fast pitch-swept sine for the body, and a tail that
   * only appears with distance - a far-off shot is mostly its own
   * echo off the basin.
   *
   * The layer gains look large because each is measured AFTER its
   * filter. A bandpass at Q 0.8 throws away most of a noise source's
   * energy, and the first mix had the game's most-heard sound peaking
   * at 0.08 against an impact at 0.26 - a gunshot quieter than the
   * bullet landing.
   */
  function shot(x, z, opts = {}) {
    const t = now();
    const dur = 0.26;
    const g = voice("weapon", dur);
    if (!g) return;
    const p = place(g, x ?? state.listenerX, z ?? state.listenerZ, 30, 520);
    if (!p) return;
    const out = p.node;
    const amp = (opts.gain ?? 0.5) * p.atten;

    /* AN ENERGY DISCHARGE THAT STILL HITS SOMETHING.

       The previous version was built on a principle that is true and
       was taken too far: a cartridge sounds mechanical because of the
       noise crack, so the crack was removed entirely and every layer
       replaced with a downward pitch sweep. Everything gliding down
       in the same direction over the same 100-150ms IS the "pew" -
       it is the one gesture a toy ray gun makes, and with no
       transient at all there was nothing for the ear to read as an
       event. It sounded thin and slow.

       What a punchy weapon needs is a TRANSIENT the sweeps can hang
       off. So the structure is now:

         0-18ms   an ignition crack, broadband and gone before it can
                  be heard as a pitch, which is what makes the shot
                  land at a moment rather than over a moment
         0-70ms   a hard low thump, swept fast so it reads as impact
                  rather than as a falling tone
         0-90ms   the arc and the resonant body, both much faster
                  than before so they decorate the transient instead
                  of being the whole sound
         tail     the basin

       The crack is deliberately NOT the old primer bandpass: it is
       highpassed well above where a cartridge lives, so it reads as
       an arc striking rather than as a case going off. */

    // Ignition: the transient. Short enough that its pitch is
    // unresolvable, which is exactly what makes it a crack.
    const crack = noiseSource(2.4);
    const ch = ac.createBiquadFilter();
    ch.type = "highpass";
    ch.frequency.setValueAtTime(1400, t);
    const cb = ac.createBiquadFilter();
    cb.type = "peaking";
    cb.frequency.setValueAtTime(3400, t);
    cb.Q.value = 0.9;
    cb.gain.value = 9;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 4.6, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    crack.connect(ch); ch.connect(cb); cb.connect(cg); cg.connect(out);
    crack.start(t); crack.stop(t + 0.02);

    // The arc: a bright partial, now ringing off in a third of the
    // time so it is an edge on the transient, not a descending tone.
    const arc = ac.createOscillator();
    arc.type = "triangle";
    arc.frequency.setValueAtTime(3400, t);
    arc.frequency.exponentialRampToValueAtTime(1150, t + 0.032);
    const ag = ac.createGain();
    ag.gain.setValueAtTime(amp * 1.35, t);
    ag.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    arc.connect(ag); ag.connect(out);
    arc.start(t); arc.stop(t + 0.06);

    /* The body: sawtooth through a tracking resonant lowpass, driven
       into a soft clip. The clipper is what puts harmonics above the
       filter and stops the layer from being a polite sine-ish tone -
       distortion is most of why a real weapon sounds loud on small
       speakers, because it survives being made quiet. */
    const body = ac.createOscillator();
    body.type = "sawtooth";
    body.frequency.setValueAtTime(1320, t);
    body.frequency.exponentialRampToValueAtTime(150, t + 0.075);
    const res = ac.createBiquadFilter();
    res.type = "lowpass";
    res.frequency.setValueAtTime(5200, t);
    res.frequency.exponentialRampToValueAtTime(420, t + 0.085);
    res.Q.value = 9.5;
    const drive = ac.createWaveShaper();
    {
      const n = 1024;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 2.6);
      }
      drive.curve = curve;
      drive.oversample = "2x";
    }
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp * 2.9, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.115);
    body.connect(res); res.connect(drive); drive.connect(bg); bg.connect(out);
    body.start(t); body.stop(t + 0.12);

    // Sizzle: texture only. Kept narrow and brief - widen it and the
    // cartridge comes straight back.
    const sizzle = noiseSource(1.9);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(2100, t + 0.06);
    bp.Q.value = 2.6;
    const sg = ac.createGain();
    sg.gain.setValueAtTime(amp * 1.4, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    sizzle.connect(bp); bp.connect(sg); sg.connect(out);
    sizzle.start(t); sizzle.stop(t + 0.08);

    /* The thump. Same sine as before and twice as fast: 150->46 over
       120ms is long enough to hear the pitch fall, which reads as a
       descending tone. 210->40 over 55ms is heard as a hit. This is
       the layer that carries the weight on a laptop speaker, where
       everything below it is gone. */
    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(210, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.055);
    const subg = ac.createGain();
    subg.gain.setValueAtTime(amp * 3.4, t);
    subg.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    sub.connect(subg); subg.connect(out);
    sub.start(t); sub.stop(t + 0.11);

    // The tail is where distance is actually heard: a far-off shot is
    // mostly its own echo off the basin.
    const far = Math.min(1, Math.max(0, 1 - p.atten));
    if (far > 0.12) {
      /* Distance is mostly the tail, and an energy tail rings rather
         than thuds - a narrow resonant band decaying off the basin,
         not a lowpassed rumble. */
      const tail = noiseSource(0.75);
      const tf = ac.createBiquadFilter();
      tf.type = "bandpass";
      tf.frequency.setValueAtTime(900, t);
      tf.frequency.exponentialRampToValueAtTime(430, t + dur);
      tf.Q.value = 3.4;
      const tg = ac.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.linearRampToValueAtTime(amp * 1.9 * far, t + 0.03);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      tail.connect(tf); tf.connect(tg); tg.connect(out);
      tail.start(t); tail.stop(t + dur);
    }
  }

  /** A round landing: flesh, or stone. */
  function impact(x, z, kind = "flesh") {
    const t = now();
    const g = voice("world", 0.2);
    if (!g) return;
    const p = place(g, x, z, 14, 220);
    if (!p) return;
    const amp = 0.36 * p.atten;

    const src = noiseSource(kind === "wall" ? 1.9 : 0.85);
    const f = ac.createBiquadFilter();
    f.type = kind === "wall" ? "highpass" : "lowpass";
    f.frequency.value = kind === "wall" ? 2400 : 700;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(amp, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "wall" ? 0.1 : 0.16));
    src.connect(f); f.connect(ng); ng.connect(p.node);
    src.start(t); src.stop(t + 0.18);
  }

  /** Something large stops working. */
  function death(x, z, big = false) {
    const t = now();
    const dur = big ? 1.5 : 0.7;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 26, 340);
    if (!p) return;
    const amp = 0.5 * p.atten;

    const osc = ac.createOscillator();
    osc.type = big ? "square" : "sawtooth";
    osc.frequency.setValueAtTime(big ? 168 : 320, t);
    osc.frequency.exponentialRampToValueAtTime(big ? 28 : 60, t + dur * 0.8);
    const og = ac.createGain();
    og.gain.setValueAtTime(amp, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    osc.connect(lp); lp.connect(og); og.connect(p.node);
    osc.start(t); osc.stop(t + dur);

    const rattle = noiseSource(big ? 0.6 : 1.1);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(amp * 0.6, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.6);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = big ? 320 : 900;
    rattle.connect(bp); bp.connect(rg); rg.connect(p.node);
    rattle.start(t); rattle.stop(t + dur * 0.7);
  }

  /** A stratagem landing. */
  function explosion(x, z, radius = 20) {
    const t = now();
    const dur = 2.2;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 60, 900);
    if (!p) return;
    const amp = 0.95 * p.atten;

    const boom = ac.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(96, t);
    boom.frequency.exponentialRampToValueAtTime(19, t + 1.1);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    boom.connect(bg); bg.connect(p.node);
    boom.start(t); boom.stop(t + 1.5);

    const roar = noiseSource(0.75);
    const rf = ac.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.setValueAtTime(3800, t);
    rf.frequency.exponentialRampToValueAtTime(160, t + dur);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(amp * 0.9, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    roar.connect(rf); rf.connect(rg); rg.connect(p.node);
    roar.start(t); roar.stop(t + dur);
    void radius;
  }

  /** The descent whistle before it lands. */
  function inbound(x, z, seconds) {
    const t = now();
    const g = voice("world", seconds);
    if (!g) return;
    const p = place(g, x, z, 90, 900);
    if (!p) return;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(230, t + seconds);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.30 * p.atten, t + seconds * 0.75);
    og.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(og); og.connect(p.node);
    osc.start(t); osc.stop(t + seconds);
  }

  /** A footfall. Quiet on sand, sharp on stone. */
  function step(hard) {
    const t = now();
    const g = voice("world", 0.2);
    if (!g) return;
    const src = noiseSource(hard ? 1.5 : 0.5);
    const f = ac.createBiquadFilter();
    f.type = hard ? "bandpass" : "lowpass";
    f.frequency.value = hard ? 1500 : 420;
    f.Q.value = 0.7;
    const ng = ac.createGain();
    const amp = (hard ? 0.16 : 0.11) * (0.8 + Math.random() * 0.4);
    ng.gain.setValueAtTime(amp, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + (hard ? 0.11 : 0.17));
    src.connect(f); f.connect(ng); ng.connect(g);
    src.start(t); src.stop(t + 0.2);
  }

  /** The player is hit. */
  function hurt() {
    const t = now();
    const g = voice("ui", 0.45);
    if (!g) return;
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.35);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.34, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(og); og.connect(g);
    osc.start(t); osc.stop(t + 0.45);
  }

  /* --- interface ------------------------------------------------ */

  function blip(freq, dur = 0.06, gain = 0.2, type = "square") {
    const t = now();
    const g = voice("ui", dur + 0.05);
    if (!g) return;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(gain, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(og); og.connect(g);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function chord(freqs, dur = 0.5, gain = 0.16) {
    for (let i = 0; i < freqs.length; i += 1) {
      window.setTimeout(() => blip(freqs[i], dur, gain, "triangle"), i * 55);
    }
  }

  /* ============================================================
     DROP CINEMATIC

     The cinematic owns its long-running sources. Gameplay one-shots
     can be fire-and-forget, but an intro can be skipped, restarted or
     paused halfway through a burn, so every pod source must be
     retained and stopped as a group.
     ============================================================ */

  function cinematicNoiseSource(playbackRate = 1, offset = 0) {
    const src = ac.createBufferSource();
    src.buffer = cinematicNoise;
    src.loop = true;
    src.playbackRate.value = playbackRate;
    src.loopStart = Math.max(0, Math.min(CINEMATIC_NOISE_SECONDS - 0.5, offset));
    src.loopEnd = CINEMATIC_NOISE_SECONDS;
    return src;
  }

  function releaseDropRecord(record) {
    if (!record || record.released) return;
    record.released = true;
    drop.sources.delete(record);
    for (const node of record.nodes) {
      try { node.disconnect(); } catch (_) { /* already disconnected */ }
    }
  }

  function retainDropSource(source, nodes = [], gains = []) {
    const record = {
      source,
      nodes: [source, ...nodes],
      gains,
      released: false,
    };
    drop.sources.add(record);
    const release = () => releaseDropRecord(record);
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", release, { once: true });
    } else {
      source.onended = release;
    }
    return record;
  }

  function stopDropSources(fadeSeconds = 0.055) {
    const records = Array.from(drop.sources);
    drop.sources.clear();
    const t = now();
    for (const record of records) {
      for (const gain of record.gains) {
        try {
          gain.gain.cancelScheduledValues(t);
          gain.gain.setTargetAtTime(0.0001, t, Math.max(0.006, fadeSeconds * 0.3));
        } catch (_) { /* node may already have ended */ }
      }
      try { record.source.stop(t + fadeSeconds); } catch (_) { /* already stopped */ }
      window.setTimeout(() => releaseDropRecord(record), Math.ceil(fadeSeconds * 1000) + 80);
    }
    drop.beds = null;
  }

  function connectDropOutput(node, pan = 0) {
    const extra = [];
    if (ac.createStereoPanner) {
      const panner = ac.createStereoPanner();
      panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
      node.connect(panner);
      panner.connect(buses.cinematic);
      extra.push(panner);
    } else {
      node.connect(buses.cinematic);
    }
    return extra;
  }

  async function loadDropBuffer(id) {
    if (!DROP_ASSETS[id] || state.offline) return null;
    if (drop.buffers.has(id)) return drop.buffers.get(id);
    if (drop.loads.has(id)) return drop.loads.get(id);
    if (drop.loadErrors.has(id) || typeof window.fetch !== "function") return null;

    const promise = window.fetch(new URL(DROP_ASSETS[id], DROP_ASSET_ROOT).href, {
      cache: "force-cache",
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then((data) => ac.decodeAudioData(data)).then((buffer) => {
      drop.buffers.set(id, buffer);
      return buffer;
    }).catch((error) => {
      drop.loadErrors.set(id, (error && error.message) || String(error));
      return null;
    }).finally(() => {
      drop.loads.delete(id);
    });
    drop.loads.set(id, promise);
    return promise;
  }

  function preloadDropBuffers() {
    return Promise.all(Object.keys(DROP_ASSETS).map((id) => loadDropBuffer(id)));
  }

  async function playDropSample(id, options = {}) {
    const run = drop.run;
    const buffer = await loadDropBuffer(id);
    if (!buffer || !drop.active || drop.paused || run !== drop.run) return false;
    if (ac.state !== "running" && !state.offline) return false;

    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.5, Math.min(1.5, Number(options.rate) || 1));
    const gain = ac.createGain();
    gain.gain.value = Math.max(0, Math.min(0.8, Number(options.gain) || 0.2));
    const nodes = [gain];
    if (options.lowpass && ac.createBiquadFilter) {
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.max(120, Number(options.lowpass) || 2400);
      source.connect(filter);
      filter.connect(gain);
      nodes.push(filter);
    } else {
      source.connect(gain);
    }
    nodes.push(...connectDropOutput(gain, Number(options.pan) || 0));
    retainDropSource(source, nodes, [gain]);
    source.start(now());
    return true;
  }

  function dropTone(options = {}) {
    if (!drop.active || drop.paused || (ac.state !== "running" && !state.offline)) return false;
    const t = now() + Math.max(0, Number(options.delay) || 0);
    const duration = Math.max(0.04, Number(options.duration) || 0.3);
    const frequency = Math.max(18, Number(options.frequency) || 120);
    const endFrequency = Math.max(18, Number(options.endFrequency) || frequency);
    const peak = Math.max(0.001, Math.min(0.5, Number(options.gain) || 0.1));
    const attack = Math.min(duration * 0.25, Math.max(0.004, Number(options.attack) || 0.018));

    const osc = ac.createOscillator();
    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(frequency, t);
    if (endFrequency !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(endFrequency, t + duration * 0.9);
    }
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    const nodes = [gain, ...connectDropOutput(gain, Number(options.pan) || 0)];
    retainDropSource(osc, nodes, [gain]);
    osc.start(t);
    osc.stop(t + duration + 0.025);
    return true;
  }

  function dropNoiseBurst(options = {}) {
    if (!drop.active || drop.paused || (ac.state !== "running" && !state.offline)) return false;
    const delay = Math.max(0, Number(options.delay) || 0);
    const t = now() + delay;
    const duration = Math.max(0.05, Number(options.duration) || 0.4);
    const peak = Math.max(0.001, Math.min(0.6, Number(options.gain) || 0.1));
    const cuePhase = ((drop.cueSerial * 0.619 + (Number(options.pan) || 0) * 0.17) % 1 + 1) % 1;
    const offset = 0.2 + cuePhase * (CINEMATIC_NOISE_SECONDS - 0.8);
    const source = cinematicNoiseSource(Number(options.rate) || 1, offset);
    const filter = ac.createBiquadFilter();
    filter.type = options.filter || "bandpass";
    const startFrequency = Math.max(40, Number(options.frequency) || 520);
    const endFrequency = Math.max(40, Number(options.endFrequency) || startFrequency);
    filter.frequency.setValueAtTime(startFrequency, t);
    if (endFrequency !== startFrequency) {
      filter.frequency.exponentialRampToValueAtTime(endFrequency, t + duration * 0.9);
    }
    filter.Q.value = Math.max(0.1, Number(options.q) || 0.7);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + Math.min(0.025, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter);
    filter.connect(gain);
    const nodes = [filter, gain, ...connectDropOutput(gain, Number(options.pan) || 0)];
    retainDropSource(source, nodes, [gain]);
    source.start(t, offset);
    source.stop(t + duration + 0.03);
    return true;
  }

  function startDropBeds() {
    if (!drop.active || drop.paused || drop.beds) return !!drop.beds;
    if (ac.state !== "running" && !state.offline) return false;
    const t = now();

    // The sealed cabin: mono fundamentals so the floor does not swim
    // in headphones, with a small mechanical LFO in the upper body.
    const cabinOut = ac.createGain();
    cabinOut.gain.value = 0.0001;
    cabinOut.connect(buses.cinematic);
    const cabinSub = ac.createOscillator();
    cabinSub.type = "sine";
    cabinSub.frequency.value = 38;
    const cabinSubGain = ac.createGain();
    cabinSubGain.gain.value = 0.72;
    cabinSub.connect(cabinSubGain);
    cabinSubGain.connect(cabinOut);
    const cabinHarmonic = ac.createOscillator();
    cabinHarmonic.type = "triangle";
    cabinHarmonic.frequency.value = 79;
    const cabinHarmonicGain = ac.createGain();
    cabinHarmonicGain.gain.value = 0.2;
    cabinHarmonic.connect(cabinHarmonicGain);
    cabinHarmonicGain.connect(cabinOut);
    const cabinLfo = ac.createOscillator();
    cabinLfo.type = "sine";
    cabinLfo.frequency.value = 6.2;
    const cabinLfoGain = ac.createGain();
    cabinLfoGain.gain.value = 0.006;
    cabinLfo.connect(cabinLfoGain);
    cabinLfoGain.connect(cabinOut.gain);

    // Two decorrelated plasma layers keep the reentry roar wide while
    // the sub and hull remain centred.
    const plasmaOut = ac.createGain();
    plasmaOut.gain.value = 0.0001;
    plasmaOut.connect(buses.cinematic);
    const plasmaFilters = [];
    for (const spec of [
      { rate: 0.87, offset: 0.47, pan: -0.28, frequency: 720 },
      { rate: 1.11, offset: 1.93, pan: 0.28, frequency: 980 },
    ]) {
      const source = cinematicNoiseSource(spec.rate, spec.offset);
      const filter = ac.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = spec.frequency;
      filter.Q.value = 0.48;
      source.connect(filter);
      let tail = filter;
      const nodes = [filter];
      if (ac.createStereoPanner) {
        const panner = ac.createStereoPanner();
        panner.pan.value = spec.pan;
        filter.connect(panner);
        tail = panner;
        nodes.push(panner);
      }
      tail.connect(plasmaOut);
      retainDropSource(source, [...nodes, plasmaOut], [plasmaOut]);
      source.start(t, spec.offset);
      plasmaFilters.push(filter);
    }

    // Retro burn: broadband chamber exhaust over a tonal motor body.
    const retroOut = ac.createGain();
    retroOut.gain.value = 0.0001;
    retroOut.connect(buses.cinematic);
    const retroNoise = cinematicNoiseSource(0.72, 2.71);
    const retroFilter = ac.createBiquadFilter();
    retroFilter.type = "bandpass";
    retroFilter.frequency.value = 180;
    retroFilter.Q.value = 0.62;
    retroNoise.connect(retroFilter);
    retroFilter.connect(retroOut);
    const retroBody = ac.createOscillator();
    retroBody.type = "sawtooth";
    retroBody.frequency.value = 42;
    const retroBodyGain = ac.createGain();
    retroBodyGain.gain.value = 0.12;
    retroBody.connect(retroBodyGain);
    retroBodyGain.connect(retroOut);

    retainDropSource(cabinSub, [cabinSubGain, cabinOut], [cabinOut]);
    retainDropSource(cabinHarmonic, [cabinHarmonicGain, cabinOut], [cabinOut]);
    retainDropSource(cabinLfo, [cabinLfoGain], [cabinOut]);
    retainDropSource(retroNoise, [retroFilter, retroOut], [retroOut]);
    retainDropSource(retroBody, [retroBodyGain, retroOut], [retroOut]);
    cabinSub.start(t);
    cabinHarmonic.start(t);
    cabinLfo.start(t);
    retroNoise.start(t, 2.71);
    retroBody.start(t);

    cabinOut.gain.setTargetAtTime(0.058, t, 0.16);
    drop.beds = {
      cabinOut,
      cabinSub,
      cabinHarmonic,
      plasmaOut,
      plasmaFilters,
      retroOut,
      retroFilter,
      retroBody,
    };
    return true;
  }

  function beginDrop() {
    if (drop.active || drop.sources.size) stopDropSources(0.025);
    drop.run += 1;
    drop.active = true;
    drop.paused = false;
    drop.cueSerial = 0;
    drop.controls = { heat: 0, turbulence: 0, retro: 0, altitude: 1, velocity: 0 };
    const run = drop.run;
    // Decoding begins with the cinematic but never delays its first
    // procedural frame; the short files join as soon as they are warm.
    void preloadDropBuffers();
    return unlock({ ambience: false }).then((ready) => {
      if (ready && drop.active && run === drop.run) startDropBeds();
      return !!ready;
    }).catch(() => false);
  }

  function updateDrop(values = {}) {
    if (!drop.active) return false;
    if (Object.prototype.hasOwnProperty.call(values, "paused")) {
      void pauseDrop(!!values.paused);
    }
    if (drop.paused) return true;
    startDropBeds();
    if (!drop.beds) return false;

    for (const key of ["heat", "turbulence", "retro", "altitude", "velocity"]) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      const numeric = Number(values[key]);
      if (!Number.isFinite(numeric)) continue;
      drop.controls[key] = clamp01(key === "velocity" ? Math.abs(numeric) : numeric);
    }
    const { heat, turbulence, retro, altitude, velocity } = drop.controls;
    const landingPressure = 1 - altitude;
    const t = now();
    drop.beds.cabinOut.gain.setTargetAtTime(
      0.052 + turbulence * 0.044 + velocity * 0.018 + landingPressure * 0.008,
      t, 0.055
    );
    drop.beds.cabinSub.frequency.setTargetAtTime(38 + turbulence * 7 + retro * 4, t, 0.08);
    drop.beds.cabinHarmonic.frequency.setTargetAtTime(79 + turbulence * 21, t, 0.07);
    drop.beds.plasmaOut.gain.setTargetAtTime(heat * 0.32 + turbulence * 0.11, t, 0.055);
    for (let i = 0; i < drop.beds.plasmaFilters.length; i += 1) {
      drop.beds.plasmaFilters[i].frequency.setTargetAtTime(
        lerp(i ? 880 : 620, i ? 4200 : 3300, heat) * lerp(0.9, 1.12, turbulence),
        t, 0.065
      );
    }
    drop.beds.retroOut.gain.setTargetAtTime(retro * 0.39, t, retro > 0 ? 0.038 : 0.11);
    drop.beds.retroFilter.frequency.setTargetAtTime(lerp(150, 620, retro), t, 0.045);
    drop.beds.retroBody.frequency.setTargetAtTime(lerp(42, 82, retro), t, 0.05);
    return true;
  }

  function dropCue(name) {
    if (!drop.active || drop.paused) return false;
    const cue = String(name || "").toLowerCase().replace(/[\s_-]/g, "");
    drop.cueSerial += 1;
    const serial = drop.cueSerial;
    const side = serial % 2 ? -0.32 : 0.32;

    if (["armed", "confirm", "sealed"].includes(cue)) {
      void playDropSample("confirm", { gain: 0.17, rate: 0.92 });
      dropTone({ frequency: 880, endFrequency: 1320, duration: 0.18, gain: 0.045, type: "triangle" });
      return true;
    }
    if (["drop", "release", "separation", "launch"].includes(cue)) {
      void playDropSample("drop", { gain: 0.23, rate: 0.82 });
      void playDropSample("metal", { gain: 0.16, rate: 0.76, lowpass: 2100 });
      dropTone({ frequency: 84, endFrequency: 34, duration: 0.58, gain: 0.22 });
      dropNoiseBurst({ frequency: 1300, endFrequency: 240, duration: 0.42, gain: 0.13, filter: "lowpass" });
      return true;
    }
    if (["entry", "atmosphere", "reentry", "plasma"].includes(cue)) {
      void playDropSample("forceField", { gain: 0.17, rate: 0.72, lowpass: 3200 });
      dropNoiseBurst({ frequency: 440, endFrequency: 2200, duration: 1.15, gain: 0.12, q: 0.5 });
      return true;
    }
    if (["hull", "hullstress", "stress", "buffet", "buffeting"].includes(cue)) {
      const variants = [
        { id: "metalImpact", rate: 0.72, gain: 0.16 },
        { id: "metal", rate: 0.88, gain: 0.14 },
        { id: "softHeavy", rate: 0.78, gain: 0.13 },
      ];
      const variant = variants[(serial - 1) % variants.length];
      void playDropSample(variant.id, {
        gain: variant.gain, rate: variant.rate, pan: side, lowpass: 1900,
      });
      dropTone({
        frequency: 190 + (serial % 3) * 31,
        endFrequency: 61 + (serial % 2) * 13,
        duration: 0.72,
        gain: 0.085,
        type: "sawtooth",
        pan: side,
      });
      dropNoiseBurst({
        frequency: 760, endFrequency: 170, duration: 0.52,
        gain: 0.075, filter: "lowpass", pan: side,
      });
      return true;
    }
    if (["comms", "radio", "link"].includes(cue)) {
      void playDropSample("confirm", { gain: 0.075, rate: 1.18, lowpass: 2600 });
      dropTone({ frequency: 1460, endFrequency: 980, duration: 0.11, gain: 0.038, type: "square" });
      dropTone({ frequency: 1120, duration: 0.09, gain: 0.03, type: "triangle", delay: 0.13 });
      return true;
    }
    if (["alert", "warning", "brace"].includes(cue)) {
      dropTone({ frequency: 940, duration: 0.13, gain: 0.06, type: "square" });
      dropTone({ frequency: 620, duration: 0.16, gain: 0.07, type: "square", delay: 0.17 });
      return true;
    }
    if (["retro", "retroignite", "retroignition", "burn", "braking"].includes(cue)) {
      void playDropSample("lowExplosion", { gain: 0.25, rate: 0.67, lowpass: 1800 });
      void playDropSample("softHeavy", { gain: 0.13, rate: 0.82 });
      dropTone({ frequency: 92, endFrequency: 31, duration: 1.1, gain: 0.22 });
      dropNoiseBurst({ frequency: 680, endFrequency: 140, duration: 0.9, gain: 0.18, filter: "lowpass" });
      return true;
    }
    if (["impact", "contact", "touchdown", "landed"].includes(cue)) {
      void playDropSample("softHeavy", { gain: 0.34, rate: 0.72 });
      void playDropSample("metalImpact", { gain: 0.28, rate: 0.78, lowpass: 2600 });
      void playDropSample("lowExplosion", { gain: 0.3, rate: 0.78, lowpass: 1500 });
      dropTone({ frequency: 76, endFrequency: 23, duration: 1.55, gain: 0.34 });
      dropNoiseBurst({ frequency: 3100, endFrequency: 190, duration: 0.82, gain: 0.28, filter: "lowpass" });
      dropTone({ frequency: 247, endFrequency: 180, duration: 1.8, gain: 0.055, type: "triangle", delay: 0.08 });
      return true;
    }
    if (["hatch", "door", "dooropen", "vent"].includes(cue)) {
      void playDropSample("doorOpen", { gain: 0.27, rate: 0.88, lowpass: 4200 });
      dropNoiseBurst({
        frequency: 3900, endFrequency: 1100, duration: 1.25,
        gain: 0.13, filter: "highpass", q: 0.45,
      });
      dropTone({ frequency: 420, endFrequency: 210, duration: 0.55, gain: 0.04, type: "triangle" });
      return true;
    }
    if (["handoff", "clear", "ready"].includes(cue)) {
      void playDropSample("confirm", { gain: 0.15, rate: 1.05 });
      dropTone({ frequency: 523, endFrequency: 784, duration: 0.28, gain: 0.045, type: "triangle" });
      return true;
    }
    return false;
  }

  function pauseDrop(value = true) {
    const paused = !!value;
    if (!drop.active) return Promise.resolve(false);
    if (paused === drop.paused) return Promise.resolve(true);
    drop.paused = paused;
    if (state.offline) return Promise.resolve(true);
    /* Serialize context transitions. suspend()/resume() are async;
       without a queue a rapid pause -> resume (or skip) can let an
       older suspend resolve last and strand the whole game silent. */
    drop.pauseQueue = drop.pauseQueue.catch(() => false).then(async () => {
      if (!drop.active) return true;
      if (drop.paused) {
        if (ac.state === "running" && typeof ac.suspend === "function") {
          try { await ac.suspend(); } catch (_) { return false; }
        }
        return ac.state !== "running";
      }
      return unlock({ ambience: false, allowPaused: true });
    });
    return drop.pauseQueue;
  }

  function setPaused(value = true) {
    const paused = !!value;
    if (paused === state.paused) return Promise.resolve(true);
    state.paused = paused;
    if (state.offline) return Promise.resolve(true);
    /* Share the cinematic transition queue so a handoff resume, menu
       suspend, and quick resume cannot finish out of order. */
    drop.pauseQueue = drop.pauseQueue.catch(() => false).then(async () => {
      if (state.paused) {
        if (ac.state === "running" && typeof ac.suspend === "function") {
          try { await ac.suspend(); } catch (_) { return false; }
        }
        return ac.state !== "running";
      }
      return unlock({ ambience: false, allowPaused: true });
    });
    return drop.pauseQueue;
  }

  function endDrop({ handoff = false } = {}) {
    drop.run += 1;
    drop.active = false;
    drop.paused = false;
    stopDropSources(handoff ? 0.085 : 0.035);
    if (!handoff) return Promise.resolve(true);
    /* Run after any in-flight suspend so the handoff resume is the
       final context operation, never the loser of a race. */
    drop.pauseQueue = drop.pauseQueue.catch(() => false).then(() => unlock({
      ambience: false, allowPaused: true,
    })).then((ready) => {
      if (ready) startAmbience();
      return !!ready;
    }).catch(() => false);
    return drop.pauseQueue;
  }

  /* ============================================================
     AMBIENCE

     One continuous wind bed, filtered noise with a slow LFO on the
     cutoff. Started on the first gesture and never stopped: starting
     and stopping a looping source per district is audible as a click,
     and the wind on Vesper-IX does not stop.
     ============================================================ */

  let wind = null;
  let jetLoop = null;
  function startAmbience() {
    if (wind || ac.state !== "running") return;
    const src = noiseSource(0.35);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 260;
    bp.Q.value = 0.55;
    const g = ac.createGain();
    g.gain.value = 0.0;
    src.connect(lp); lp.connect(bp); bp.connect(g); g.connect(buses.ambience);
    src.start();
    // Fade in, or the wind arrives as a click on the first gesture.
    g.gain.setTargetAtTime(0.34, now(), 1.6);

    const lfo = ac.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.055;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
    wind = { src, g, lp, lfo };
  }

  function startJetLoop() {
    if (jetLoop || ac.state !== "running") return;
    const src = noiseSource(0.82);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 310;
    bp.Q.value = 0.72;
    const low = ac.createOscillator();
    low.type = "sawtooth";
    low.frequency.value = 74;
    const lowGain = ac.createGain();
    lowGain.gain.value = 0.035;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(bp); bp.connect(g);
    low.connect(lowGain); lowGain.connect(g);
    g.connect(buses.world);
    src.start();
    low.start();
    jetLoop = { src, bp, low, lowGain, g };
  }

  /* ============================================================
     WIRING

     Subscribed to the buses the game already emits rather than
     called from inside the systems: audio should be removable
     without touching combat.
     ============================================================ */

  function attach() {
    const { combat, mission, breaches } = ctx;
    if (combat) {
      combat.bus.on("hit", (e) => impact(e.x, e.z, "flesh"));
      /* The `big` death is now the Harrow's. It is a two-tonne animal
         and the only one whose death should be audible across the
         basin; the other two castes have to stay cheap, because a
         Thresher pack dies eight at a time and eight big deaths at
         once is a wall of noise with no information in it. */
      combat.bus.on("kill", (e) => death(e.x, e.z, e.key === "harrow"));
      combat.bus.on("wallHit", (e) => impact(e.x, e.z, "wall"));
      combat.bus.on("enemyFire", (e) => {
        // A garrison that shoots in silence is worse than one that
        // does no damage: the player has no idea they are under fire
        // or from where.
        if (e.melee) impact(e.x, e.z, "flesh");
        else shot(e.x, e.z, { gain: 0.34 });
      });
      combat.bus.on("playerHurt", () => hurt());
      combat.bus.on("playerDied", () => {
        chord([220, 165, 110], 1.2, 0.2);
      });
      combat.bus.on("respawn", () => chord([330, 440, 550], 0.4, 0.14));
    }
    if (mission) {
      mission.bus.on("stratagem", () => blip(880, 0.09, 0.2));
      mission.bus.on("code", (e) => blip(e && e.ok ? 1320 : 220, 0.05, 0.18));
      mission.bus.on("relayDone", () => chord([392, 523, 659, 784], 0.7, 0.18));
      mission.bus.on("extractCalled", () => chord([262, 392, 523], 1.1, 0.22));
      mission.bus.on("won", () => chord([523, 659, 784, 1047], 1.4, 0.24));
      mission.bus.on("lost", () => chord([196, 147, 110], 1.6, 0.24));
      mission.bus.on("inbound", (e) => inbound(e.x, e.z, e.seconds));
      mission.bus.on("impact", (e) => explosion(e.x, e.z, e.radius));
    }
    if (breaches) {
      breaches.bus.on("warning", () => chord([147, 196, 220], 0.72, 0.14));
      breaches.bus.on("bossWarning", () => chord([92, 110, 147, 196], 1.45, 0.24));
      breaches.bus.on("opened", (e) => explosion(e.x, e.z, e.boss ? 18 : 10));
      breaches.bus.on("cleared", () => chord([294, 392, 494], 0.7, 0.16));
      breaches.bus.on("complete", () => chord([392, 523, 659, 880], 1.25, 0.22));
    }
  }

  /* Unlock on the first real gesture. Chrome will not start an
     AudioContext without one, and calling resume() before then is a
     no-op that leaves the game permanently silent if nothing calls
     it again. */
  function unlock(options = {}) {
    const wantsAmbience = options.ambience === true && !ctx.deferAmbience;
    /* Ordinary gesture listeners must not wake looping pod beds while
       the cinematic is paused behind the Escape menu or a hidden tab.
       pauseDrop/endDrop opt in when a real state transition needs it. */
    if ((state.paused || (drop.active && drop.paused)) && options.allowPaused !== true) {
      return Promise.resolve(false);
    }
    if (state.offline) {
      state.started = true;
      return Promise.resolve(true);
    }
    const resume = ac.state === "running"
      ? Promise.resolve()
      : (typeof ac.resume === "function" ? ac.resume() : Promise.reject(new Error("no resume")));
    return Promise.resolve(resume).then(() => {
      const ready = ac.state === "running";
      if (ready) {
        state.started = true;
        if (wantsAmbience) startAmbience();
      }
      return ready;
    }).catch(() => false); // still suspended; the next gesture will retry
  }
  for (const evt of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(evt, () => { void unlock({ ambience: true }); }, { passive: true });
  }

  /* Footsteps are driven by the stride the gait solver already
     accumulates, so they land on the foot plant rather than on a
     timer - the same reason the gait itself is distance-driven. */
  let lastStride = 0;
  const STRIDE_PER_STEP = 1.55 * 0.5;

  function update(dt, player, camera) {
    if (!state.enabled) return;
    if (camera) {
      state.listenerX = camera.position.x;
      state.listenerZ = camera.position.z;
    }
    if (player) {
      state.listenerYaw = player.state.camYaw;
      const s = player.state.stride;
      if (s < lastStride) lastStride = s;          // teleport / respawn
      if (s - lastStride >= STRIDE_PER_STEP) {
        lastStride = s;
        if (player.state.grounded) {
          step(ctx.collide
            ? ctx.collide.solidTop(player.state.x, player.state.z) > -Infinity
            : false);
        }
      }
    }
    const throttle = clamp01(ctx.jetpack?.state?.throttle || 0);
    if (state.started && (throttle > 0.001 || jetLoop)) {
      startJetLoop();
      if (jetLoop) {
        jetLoop.g.gain.setTargetAtTime(throttle * 0.26, now(), throttle > 0 ? 0.035 : 0.12);
        jetLoop.bp.frequency.setTargetAtTime(lerp(220, 620, throttle), now(), 0.06);
        jetLoop.low.frequency.setTargetAtTime(lerp(58, 92, throttle), now(), 0.08);
      }
    }
    void dt;
  }

  function jetIgnite() {
    blip(92, 0.18, 0.16, "sawtooth");
    window.setTimeout(() => blip(184, 0.12, 0.10, "triangle"), 55);
  }

  function jetCutoff() { blip(78, 0.11, 0.08, "triangle"); }
  function jetEmpty() { chord([165, 124, 82], 0.20, 0.10); }
  function jetLand(speed = 0) {
    if (speed > 4) blip(66, 0.16, Math.min(0.16, 0.06 + speed * 0.006), "sine");
  }

  return {
    context: ac,
    shot,
    impact,
    death,
    explosion,
    inbound,
    step,
    hurt,
    blip,
    chord,
    jetIgnite,
    jetCutoff,
    jetEmpty,
    jetLand,
    attach,
    update,
    unlock,
    startAmbience,
    beginDrop,
    updateDrop,
    dropCue,
    pauseDrop,
    setPaused,
    endDrop,
    testWith(offlineCtx) {
      state.offline = true;
      state.started = true;
      void offlineCtx;
    },
    setEnabled(v) {
      state.enabled = !!v;
      master.gain.setTargetAtTime(v ? 1.35 : 0, now(), 0.05);
    },
    get enabled() { return state.enabled; },
    stats() {
      return {
        state: ac.state,
        voices: state.voices,
        sampleRate: ac.sampleRate,
        paused: state.paused,
        ambience: !!wind,
        jetLoop: !!jetLoop,
        cinematic: {
          active: drop.active,
          sources: drop.sources.size,
          buffers: drop.buffers.size,
          loadErrors: Array.from(drop.loadErrors, ([id, message]) => `${id}: ${message}`),
          paused: drop.paused,
        },
      };
    },
  };
}

function makeSilentApi() {
  const noop = () => {};
  const no = () => false;
  const noPromise = () => Promise.resolve(false);
  return {
    context: null,
    shot: noop, impact: noop, death: noop, explosion: noop, inbound: noop,
    step: noop, hurt: noop, blip: noop, chord: noop, attach: noop,
    jetIgnite: noop, jetCutoff: noop, jetEmpty: noop, jetLand: noop,
    update: noop, unlock: noPromise, startAmbience: noop, setEnabled: noop,
    beginDrop: noPromise, updateDrop: no, dropCue: no,
    pauseDrop: noPromise, setPaused: noPromise, endDrop: noPromise,
    enabled: false,
    stats() {
      return {
        state: "unavailable",
        voices: 0,
        sampleRate: 0,
        paused: false,
        ambience: false,
        jetLoop: false,
        cinematic: {
          active: false, sources: 0, buffers: 0, loadErrors: [], paused: false,
        },
      };
    },
  };
}
