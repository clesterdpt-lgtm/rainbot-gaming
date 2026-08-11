/* ============================================================
   SAINTFALL - audio

   Every sound in this file is SYNTHESISED. There is not one audio
   asset in the project, for the same reason there is not one texture:
   the whole game is procedural, it loads from a static host with no
   build step, and a firefight needs dozens of overlapping one-shots
   that would otherwise be dozens of megabytes to download before the
   first shot is fired.

   The engine is a small graph:

     one-shots -> per-voice gain -> bus gain -> master -> destination

   with three buses (weapons, world, ui) so a category can be mixed
   or ducked without touching the individual voices.

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
    weapon: 0.9, world: 0.75, ui: 0.6, ambience: 0.5,
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

  const state = {
    enabled: true,
    started: false,
    offline: false,
    listenerX: 0,
    listenerZ: 0,
    listenerYaw: 0,
    voices: 0,
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

    /* AN ENERGY DISCHARGE, NOT A CARTRIDGE.

       What made the old shot read as kinetic was its structure rather
       than its brightness: a broadband noise crack through a bandpass
       (the primer and the muzzle blast) over a sawtooth thump (the
       action). Both are the sound of something mechanical happening
       to a solid object, and no amount of level makes that electric.

       An energy weapon is TONAL and it MOVES. The body here is a
       fast downward pitch sweep through a resonant lowpass - the
       filter tracking the oscillator is what gives the "pew" its
       vowel - with a bright ringing partial above it for the arc, a
       short noise sizzle for texture rather than for weight, and a
       sub for the punch the tonal layers cannot carry on their own. */

    // The arc: a bright partial, sweeping and ringing off fast.
    const arc = ac.createOscillator();
    arc.type = "triangle";
    arc.frequency.setValueAtTime(2950, t);
    arc.frequency.exponentialRampToValueAtTime(760, t + 0.09);
    const ag = ac.createGain();
    ag.gain.setValueAtTime(amp * 1.5, t);
    ag.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    arc.connect(ag); ag.connect(out);
    arc.start(t); arc.stop(t + 0.12);

    // The body: sawtooth swept down through a resonant lowpass that
    // follows it. The tracking is the whole character.
    const body = ac.createOscillator();
    body.type = "sawtooth";
    body.frequency.setValueAtTime(1180, t);
    body.frequency.exponentialRampToValueAtTime(120, t + 0.15);
    const res = ac.createBiquadFilter();
    res.type = "lowpass";
    res.frequency.setValueAtTime(4200, t);
    res.frequency.exponentialRampToValueAtTime(340, t + 0.15);
    // High enough to sing, short of self-oscillating into a whistle.
    res.Q.value = 11.5;
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp * 2.6, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    body.connect(res); res.connect(bg); bg.connect(out);
    body.start(t); body.stop(t + 0.20);

    // Sizzle: texture only. Kept narrow and brief - widen it and the
    // cartridge comes straight back.
    const sizzle = noiseSource(1.9);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(2100, t + 0.07);
    bp.Q.value = 2.6;
    const sg = ac.createGain();
    sg.gain.setValueAtTime(amp * 1.7, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    sizzle.connect(bp); bp.connect(sg); sg.connect(out);
    sizzle.start(t); sizzle.stop(t + 0.09);

    // Sub: the shove. Sine, so it is felt rather than heard, and none
    // of the mechanical rattle a sawtooth would put here.
    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(150, t);
    sub.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const subg = ac.createGain();
    subg.gain.setValueAtTime(amp * 2.2, t);
    subg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    sub.connect(subg); subg.connect(out);
    sub.start(t); sub.stop(t + 0.16);

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
  function unlock() {
    if (state.started) return;
    ac.resume().then(() => {
      state.started = true;
      startAmbience();
    }).catch(() => { /* still suspended; the next gesture will retry */ });
  }
  for (const evt of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(evt, unlock, { passive: true });
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
        ambience: !!wind,
        jetLoop: !!jetLoop,
      };
    },
  };
}

function makeSilentApi() {
  const noop = () => {};
  return {
    context: null,
    shot: noop, impact: noop, death: noop, explosion: noop, inbound: noop,
    step: noop, hurt: noop, blip: noop, chord: noop, attach: noop,
    jetIgnite: noop, jetCutoff: noop, jetEmpty: noop, jetLand: noop,
    update: noop, unlock: noop, setEnabled: noop,
    enabled: false,
    stats() { return { state: "unavailable", voices: 0, sampleRate: 0, ambience: false }; },
  };
}
