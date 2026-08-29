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
const SAINTFALL_ASSET_ROOT = new URL("../../Sounds/saintfall/", import.meta.url);
const SAINTFALL_ASSETS = Object.freeze({
  insectProximity: "insects-nearby.wav",
  lightgunMain: "lightgun-main.wav",
});

/* The nearby cue is keyed to immersive proximity ranges around Bloom hostiles.
   Gleaner is omitted because it is a ranged caste with distinct sniper cues. */
const INSECT_PROXIMITY_RANGES = Object.freeze({
  thresher: 14,
  harrow: 18,
  precentor: 22,
  matriarch: 26,
  coulter: 28,
  garner: 28,
  stylite: 24,
  abbess: 36,
});
const INSECT_PROXIMITY_GAIN = 0.28;
const PLAYER_LIGHTGUN_GAIN = 0.65;

/* The gunshot clipper's transfer curve. A compile-time constant -
   building 1024 tanh samples per DISCHARGE allocated ~36KB/s of
   Float32 garbage during a firefight, which is exactly when a GC
   pause hurts. A WaveShaper only reads its curve, so one shared
   array serves every shot of every context. */
let SHOT_DRIVE_CURVE = null;
function shotDriveCurve() {
  if (SHOT_DRIVE_CURVE) return SHOT_DRIVE_CURVE;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.6);
  }
  SHOT_DRIVE_CURVE = curve;
  return curve;
}

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

  const BASE_BUS_LEVELS = Object.freeze({
    weapon: 0.9, world: 0.75, doctrine: 0.62, ui: 0.6,
    ambience: 0.5, cinematic: 0.72, music: 0.52,
  });

  const buses = {};
  for (const [name, level] of Object.entries(BASE_BUS_LEVELS)) {
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
    masterVolume: 1.0,
    musicVolume: 0.8,
    sfxVolume: 1.0,
    listenerX: 0,
    listenerZ: 0,
    listenerYaw: 0,
    voices: 0,
    doctrineVoices: 0,
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

  const saintfallAssets = {
    buffers: new Map(),
    loads: new Map(),
    loadErrors: new Map(),
  };
  const insectProximity = {
    source: null,
    gain: null,
    pan: null,
    target: null,
    stopping: false,
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

  async function loadSaintfallBuffer(id) {
    if (!SAINTFALL_ASSETS[id] || state.offline
      || typeof window.fetch !== "function") return null;
    if (saintfallAssets.buffers.has(id)) return saintfallAssets.buffers.get(id);
    if (saintfallAssets.loadErrors.has(id)) return null;
    if (saintfallAssets.loads.has(id)) return saintfallAssets.loads.get(id);

    const promise = window.fetch(new URL(SAINTFALL_ASSETS[id], SAINTFALL_ASSET_ROOT).href, {
      cache: "force-cache",
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then((data) => ac.decodeAudioData(data)).then((buffer) => {
      saintfallAssets.buffers.set(id, buffer);
      return buffer;
    }).catch((error) => {
      saintfallAssets.loadErrors.set(id, (error && error.message) || String(error));
      return null;
    }).finally(() => {
      saintfallAssets.loads.delete(id);
    });
    saintfallAssets.loads.set(id, promise);
    return promise;
  }

  function preloadSaintfallBuffers() {
    return Promise.all(Object.keys(SAINTFALL_ASSETS).map((id) => loadSaintfallBuffer(id)));
  }

  /** Play a decoded local clip through the same positional bus as the
   *  procedural voices. The clip is a one-shot, so it still obeys the hard
   *  voice cap and the game's master/SFX volume controls. */
  function playSaintfallBuffer(id, x, z, opts = {}) {
    const buffer = saintfallAssets.buffers.get(id);
    if (!buffer) {
      void loadSaintfallBuffer(id);
      return false;
    }
    const duration = Math.max(0.05, Number(buffer.duration) || 0.05);
    const g = voice(opts.bus || "world", duration);
    if (!g) return false;
    const p = place(g, x ?? state.listenerX, z ?? state.listenerZ,
      opts.refDist ?? 22, opts.maxDist ?? 520);
    if (!p) return false;
    const t = now();
    const amp = Math.max(0, Number(opts.gain) || 0) * p.atten;
    const out = ac.createGain();
    const fadeIn = Math.max(0.001, Number(opts.fadeIn) || 0.002);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(Math.max(0.0001, amp), t + fadeIn);
    const fadeStart = Math.max(t + fadeIn + 0.01, t + duration - 0.06);
    out.gain.setValueAtTime(Math.max(0.0001, amp), fadeStart);
    out.gain.linearRampToValueAtTime(0.0001, t + duration);
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    out.connect(p.node);
    source.start(t);
    source.stop(t + duration + 0.02);
    return true;
  }

  function findNearbyInsect(player) {
    const ps = player?.state;
    const live = ctx.enemies?.live;
    if (!ps || player.dead || ps.dead || !Array.isArray(live)) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const inst of live) {
      if (!inst || inst.state === "death" || inst.health <= 0
        || inst.encounterHidden || inst.body?.hidden) continue;
      if (inst.spec?.faction !== "bloom") continue;
      const reach = INSECT_PROXIMITY_RANGES[inst.key] || 14;
      const distance = Math.hypot(inst.x - ps.x, inst.z - ps.z);
      if (distance <= reach && distance < nearestDistance) {
        nearest = { inst, distance, reach };
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function updateInsectProximityPosition(x, z) {
    if (!insectProximity.pan) return;
    const rel = Math.atan2(x - state.listenerX, z - state.listenerZ) - state.listenerYaw;
    const pan = Math.max(-0.92, Math.min(0.92, Math.sin(rel)));
    if (typeof insectProximity.pan.pan.setTargetAtTime === "function") {
      insectProximity.pan.pan.setTargetAtTime(pan, now(), 0.06);
    } else {
      insectProximity.pan.pan.value = pan;
    }
  }

  function clearInsectProximity(source) {
    if (insectProximity.source !== source) return;
    try { source.disconnect(); } catch (_) { /* already disconnected */ }
    try { insectProximity.gain?.disconnect(); } catch (_) { /* no-op */ }
    try { insectProximity.pan?.disconnect(); } catch (_) { /* no-op */ }
    insectProximity.source = null;
    insectProximity.gain = null;
    insectProximity.pan = null;
    insectProximity.target = null;
    insectProximity.stopping = false;
  }

  function stopInsectProximity() {
    const loop = insectProximity;
    if (!loop.source || loop.stopping) return;
    loop.stopping = true;
    loop.target = null;
    const t = now();
    loop.gain.gain.cancelScheduledValues(t);
    loop.gain.gain.setValueAtTime(Math.max(0.0001, loop.gain.gain.value), t);
    loop.gain.gain.linearRampToValueAtTime(0.0001, t + 0.18);
    try { loop.source.stop(t + 0.20); } catch (_) { /* already stopped */ }
  }

  function updateInsectProximity(player) {
    const target = findNearbyInsect(player);
    if (!target || !state.enabled || state.paused
      || (!state.started && !state.offline)) {
      stopInsectProximity();
      return;
    }
    const buffer = saintfallAssets.buffers.get("insectProximity");
    if (!buffer) {
      void loadSaintfallBuffer("insectProximity");
      stopInsectProximity();
      return;
    }

    const loop = insectProximity;
    const t = now();
    const distRatio = clamp01(1 - (target.distance / Math.max(1, target.reach)));
    const targetGain = Math.max(0.04, distRatio * INSECT_PROXIMITY_GAIN);

    if (!loop.source) {
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = Math.max(0.05, buffer.duration);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(targetGain, t + 0.22);
      let pan = null;
      source.connect(gain);
      if (ac.createStereoPanner) {
        pan = ac.createStereoPanner();
        gain.connect(pan);
        pan.connect(buses.world);
      } else {
        gain.connect(buses.world);
      }
      loop.source = source;
      loop.gain = gain;
      loop.pan = pan;
      loop.target = target.inst;
      loop.stopping = false;
      source.onended = () => clearInsectProximity(source);
      source.start(t);
    } else if (loop.stopping) {
      loop.stopping = false;
      loop.gain.gain.cancelScheduledValues(t);
      loop.gain.gain.setValueAtTime(Math.max(0.0001, loop.gain.gain.value), t);
      loop.gain.gain.linearRampToValueAtTime(targetGain, t + 0.12);
    } else {
      loop.gain.gain.setTargetAtTime(targetGain, t, 0.08);
    }
    loop.target = target.inst;
    updateInsectProximityPosition(target.inst.x, target.inst.z);
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
     DOCTRINE SIGNATURES

     Talent effects happen inside familiar actions, so reusing the shot,
     shield or boost sound leaves the player unable to tell whether a rite
     actually fired. These five compact signatures sit above the ordinary
     action without replacing it. They share one deliberately restrained bus,
     a four-voice sub-cap, and per-cue debounce so a crowd-control pulse cannot
     turn a successful build into an audio storm.

     Event contract:
       { order, cue, x?, z?, intensity?, capstone? }

     `kind` aliases `cue` and `strength` aliases `intensity` for callers that
     already use those field names. Coordinates are optional; player-state
     feedback remains centred when they are absent.
     ============================================================ */

  const DOCTRINE_ORDERS = new Set(["censer", "procession", "wing", "halo", "edict"]);
  const doctrineLastCue = new Map();
  const doctrineCurrentOrder = new Map();
  const doctrineActive = new Set();
  const doctrineCueCounts = Object.create(null);
  let doctrineCueSerial = 0;
  let doctrineLastPlayed = null;
  const DOCTRINE_VOICE_CAP = 4;

  function doctrineEvent(raw = {}) {
    const order = typeof raw.order === "string" ? raw.order.toLowerCase() : "";
    if (!DOCTRINE_ORDERS.has(order)) return null;
    const cueValue = raw.cue ?? raw.kind ?? "proc";
    const cue = String(cueValue).trim().toLowerCase().slice(0, 64) || "proc";
    const stage = String(raw.stage || "proc").trim().toLowerCase().slice(0, 32) || "proc";
    const prep = /^(arm|segment|store|inbound|channel|form|pulse)$/.test(stage);
    const resolves = /^(consume|complete|resolve|release|impact)$/.test(stage);
    const namedCapstone = /capstone|furnace|martyr|litany|circuit|seraph|liturgy|fusion/.test(cue);
    const explicitPriority = Number(raw.priority);
    const semanticPriority = (raw.capstone === true || namedCapstone) && !prep
      ? 3
      : resolves || /break|parry|toll|blast/.test(cue) ? 2
        : prep ? 0 : 1;
    /* Presentation publishers normally supply priority, but the recognisable
       finisher names remain a safety floor. This prevents a generic `proc`
       stage from accidentally ranking Third Toll or Votive Parry alongside a
       routine refund and reinstating first-wins suppression. */
    const priority = Number.isFinite(explicitPriority)
      ? Math.max(semanticPriority, Math.max(0, Math.min(3, Math.floor(explicitPriority))))
      : semanticPriority;
    const emphatic = priority >= 3;
    let fallback = /tick|pulse|store|arm|brand|feather|wake|sigil|beacon/.test(cue)
      ? 0.42
      : /break|consume|release|rupture|complete|resolve|impact|blast|fuse/.test(cue)
        ? 0.76 : 0.58;
    if (emphatic) fallback = 1;
    const rawIntensity = Number(raw.intensity ?? raw.strength);
    const intensity = clamp01(Number.isFinite(rawIntensity) ? rawIntensity : fallback);
    const x = raw.x == null ? NaN : Number(raw.x);
    const z = raw.z == null ? NaN : Number(raw.z);
    return {
      order,
      cue,
      stage,
      priority,
      intensity,
      capstone: emphatic,
      x: Number.isFinite(x) ? x : null,
      z: Number.isFinite(z) ? z : null,
    };
  }

  function doctrinePitch(cue) {
    let hash = 0;
    for (let i = 0; i < cue.length; i += 1) hash = ((hash * 31) + cue.charCodeAt(i)) | 0;
    return 2 ** ([0, 2, -2][Math.abs(hash) % 3] / 12);
  }

  function doctrineVoice(event, duration) {
    if (state.paused) return null;
    const t = now();
    const repeated = /tick|pulse|wake/.test(event.cue);
    const cueGap = repeated ? 0.34 : event.capstone ? 0.16 : 0.09;
    const orderGap = 0.07;
    /* Different rites are allowed to speak on the same authoritative action.
       A perfect guard can legitimately store Wrath, arm Reversal and proc a
       Parry together; an Order-wide debounce silenced the most important cue
       simply because a quieter one happened to be published first. Stage is
       part of the key so an arm immediately followed by its capstone release
       remains audible, while repeated wake pulses are still controlled. */
    const cueKey = `${event.order}:${event.cue}:${event.stage}`;
    if (t - (doctrineLastCue.get(cueKey) ?? -Infinity) < cueGap) return null;
    const prior = doctrineCurrentOrder.get(event.order);
    if (prior && t - prior.at < orderGap) {
      /* A consume is the player's follow-through, not another layer of the
         same proc. If it lands immediately after an equal-priority release
         (shield release -> reversal boost is the real example), let the
         follow-through own the audible beat. Equal-priority duplicates and
         unrelated routine cues remain suppressed. */
      const consumeFollowThrough = event.priority === prior.priority
        && event.stage === "consume" && prior.stage !== "consume";
      if (event.priority < prior.priority
        || (event.priority === prior.priority && !consumeFollowThrough)) return null;
      /* Synchronous talent stacks publish in mechanic order, not importance
         order. Fade the already-started prep voice when a finisher/capstone
         follows in the same action; this is true preemption rather than just
         allowing both sounds to fight for the limiter. */
      prior.release(true);
    }
    if (state.doctrineVoices >= DOCTRINE_VOICE_CAP) {
      let weakest = null;
      for (const candidate of doctrineActive) {
        if (!weakest || candidate.priority < weakest.priority) weakest = candidate;
      }
      if (!weakest || event.priority <= weakest.priority) return null;
      weakest.release(true);
    }
    const g = voice("doctrine", duration);
    if (!g) return null;
    const placed = event.x === null || event.z === null
      ? { node: g, atten: 1 }
      : place(g, event.x, event.z, 32, 340);
    if (!placed) return null;
    doctrineLastCue.set(cueKey, t);
    if (doctrineLastCue.size > 96) {
      const oldest = doctrineLastCue.keys().next().value;
      doctrineLastCue.delete(oldest);
    }
    state.doctrineVoices += 1;
    const record = {
      at: t,
      priority: event.priority,
      stage: event.stage,
      released: false,
      release(fade = false) {
        if (record.released) return;
        record.released = true;
        doctrineActive.delete(record);
        state.doctrineVoices = Math.max(0, state.doctrineVoices - 1);
        if (fade) {
          try {
            g.gain.cancelScheduledValues(now());
            g.gain.setTargetAtTime(0.0001, now(), 0.012);
          } catch (_) { /* context is already closing */ }
        }
        if (doctrineCurrentOrder.get(event.order) === record) {
          doctrineCurrentOrder.delete(event.order);
        }
      },
    };
    doctrineActive.add(record);
    doctrineCurrentOrder.set(event.order, record);
    window.setTimeout(() => record.release(false), Math.ceil(duration * 1000) + 70);
    return { ...placed, t };
  }

  /** Hot brass and an ash exhale: precision armed, then pressure released. */
  function censerDoctrine(event) {
    const power = 0.62 + event.intensity * 0.58;
    const dur = event.capstone ? 0.88 : 0.34 + event.intensity * 0.22;
    const out = doctrineVoice(event, dur);
    if (!out) return false;
    const pitch = doctrinePitch(event.cue);
    const amp = 0.13 * power * out.atten;
    const partials = event.capstone ? [[1, 1], [1.5, 0.58], [2.03, 0.34]]
      : [[1, 1], [1.5, 0.48]];
    for (const [ratio, gain] of partials) {
      const bell = ac.createOscillator();
      bell.type = ratio === 1 ? "triangle" : "sine";
      bell.frequency.setValueAtTime(392 * pitch * ratio, out.t);
      bell.frequency.exponentialRampToValueAtTime(310 * pitch * ratio, out.t + dur * 0.82);
      const bg = ac.createGain();
      bg.gain.setValueAtTime(0.0001, out.t);
      bg.gain.linearRampToValueAtTime(amp * gain, out.t + 0.008);
      bg.gain.exponentialRampToValueAtTime(0.0001, out.t + dur);
      bell.connect(bg); bg.connect(out.node);
      bell.start(out.t); bell.stop(out.t + dur + 0.02);
    }
    const ash = noiseSource(0.72);
    const af = ac.createBiquadFilter();
    af.type = "bandpass";
    af.Q.value = 0.65;
    af.frequency.setValueAtTime(680, out.t);
    af.frequency.exponentialRampToValueAtTime(2100, out.t + dur * 0.55);
    const ag = ac.createGain();
    ag.gain.setValueAtTime(amp * 0.38, out.t);
    ag.gain.exponentialRampToValueAtTime(0.0001, out.t + dur * 0.72);
    ash.connect(af); af.connect(ag); ag.connect(out.node);
    ash.start(out.t); ash.stop(out.t + dur * 0.75);
    return true;
  }

  /** Three measured tolls: the Order always speaks in combo cadence. */
  function processionDoctrine(event) {
    const dur = event.capstone ? 0.98 : 0.68;
    const out = doctrineVoice(event, dur);
    if (!out) return false;
    const pitch = doctrinePitch(event.cue);
    const amp = (0.095 + event.intensity * 0.045) * out.atten;
    const gap = event.capstone ? 0.105 : 0.082;
    for (let i = 0; i < 3; i += 1) {
      const start = out.t + i * gap;
      const bell = ac.createOscillator();
      bell.type = "triangle";
      const base = [196, 247, 294][i] * pitch;
      bell.frequency.setValueAtTime(base, start);
      bell.frequency.exponentialRampToValueAtTime(base * 0.76, start + dur * 0.58);
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1300 + event.intensity * 900;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp * (0.82 + i * 0.09), start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.62);
      bell.connect(filter); filter.connect(gain); gain.connect(out.node);
      bell.start(start); bell.stop(start + dur * 0.65);
    }
    return true;
  }

  /** Air through a reliquary vane, resolving into an ascending wingbeat. */
  function wingDoctrine(event) {
    const dur = event.capstone ? 0.86 : 0.46 + event.intensity * 0.18;
    const out = doctrineVoice(event, dur);
    if (!out) return false;
    const pitch = doctrinePitch(event.cue);
    const amp = (0.11 + event.intensity * 0.055) * out.atten;
    const lift = ac.createOscillator();
    lift.type = "sawtooth";
    lift.frequency.setValueAtTime(150 * pitch, out.t);
    lift.frequency.exponentialRampToValueAtTime((event.capstone ? 980 : 680) * pitch,
      out.t + dur * 0.72);
    const lf = ac.createBiquadFilter();
    lf.type = "bandpass";
    lf.Q.value = 2.2;
    lf.frequency.setValueAtTime(520, out.t);
    lf.frequency.exponentialRampToValueAtTime(3100, out.t + dur * 0.74);
    const lg = ac.createGain();
    lg.gain.setValueAtTime(0.0001, out.t);
    lg.gain.linearRampToValueAtTime(amp, out.t + 0.028);
    lg.gain.exponentialRampToValueAtTime(0.0001, out.t + dur);
    lift.connect(lf); lf.connect(lg); lg.connect(out.node);
    lift.start(out.t); lift.stop(out.t + dur + 0.02);

    const air = noiseSource(1.45);
    const af = ac.createBiquadFilter();
    af.type = "highpass";
    af.frequency.setValueAtTime(700, out.t);
    af.frequency.exponentialRampToValueAtTime(3600, out.t + dur * 0.8);
    const ag = ac.createGain();
    ag.gain.setValueAtTime(amp * 0.48, out.t);
    ag.gain.exponentialRampToValueAtTime(0.0001, out.t + dur * 0.84);
    air.connect(af); af.connect(ag); ag.connect(out.node);
    air.start(out.t); air.stop(out.t + dur * 0.86);
    return true;
  }

  /** A glass guard transient and a stable perfect fifth. */
  function haloDoctrine(event) {
    const dur = event.capstone ? 1.02 : 0.5 + event.intensity * 0.2;
    const out = doctrineVoice(event, dur);
    if (!out) return false;
    const pitch = doctrinePitch(event.cue);
    const amp = (0.105 + event.intensity * 0.05) * out.atten;
    const tones = event.capstone ? [[440, 1], [660, 0.72], [880, 0.42]]
      : [[440, 1], [660, 0.66]];
    for (const [frequency, gain] of tones) {
      const ring = ac.createOscillator();
      ring.type = "sine";
      ring.frequency.setValueAtTime(frequency * pitch, out.t);
      const rg = ac.createGain();
      rg.gain.setValueAtTime(0.0001, out.t);
      rg.gain.linearRampToValueAtTime(amp * gain, out.t + 0.004);
      rg.gain.exponentialRampToValueAtTime(0.0001, out.t + dur);
      ring.connect(rg); rg.connect(out.node);
      ring.start(out.t); ring.stop(out.t + dur + 0.02);
    }
    const guard = noiseSource(1.9);
    const gf = ac.createBiquadFilter();
    gf.type = "highpass";
    gf.frequency.value = 2800;
    const gg = ac.createGain();
    gg.gain.setValueAtTime(amp * 0.45, out.t);
    gg.gain.exponentialRampToValueAtTime(0.0001, out.t + 0.075);
    guard.connect(gf); gf.connect(gg); gg.connect(out.node);
    guard.start(out.t); guard.stop(out.t + 0.09);
    return true;
  }

  /** A terse command cipher; capstones close it with a low authorization tone. */
  function edictDoctrine(event) {
    const dur = event.capstone ? 0.78 : 0.42;
    const out = doctrineVoice(event, dur);
    if (!out) return false;
    const pitch = doctrinePitch(event.cue);
    const amp = (0.09 + event.intensity * 0.045) * out.atten;
    const notes = event.capstone ? [330, 494, 740, 247] : [330, 494, 740];
    for (let i = 0; i < notes.length; i += 1) {
      const start = out.t + i * 0.052;
      const osc = ac.createOscillator();
      osc.type = i === notes.length - 1 && event.capstone ? "triangle" : "square";
      osc.frequency.setValueAtTime(notes[i] * pitch, start);
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = i === notes.length - 1 && event.capstone ? 1100 : 2600;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp * (i === 3 ? 1.25 : 1), start + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001,
        start + (i === 3 ? 0.42 : 0.095));
      osc.connect(filter); filter.connect(gain); gain.connect(out.node);
      osc.start(start); osc.stop(start + (i === 3 ? 0.45 : 0.11));
    }
    return true;
  }

  function doctrineCue(raw = {}) {
    const event = doctrineEvent(raw);
    if (!event) return false;
    const played = event.order === "censer" ? censerDoctrine(event)
      : event.order === "procession" ? processionDoctrine(event)
        : event.order === "wing" ? wingDoctrine(event)
          : event.order === "halo" ? haloDoctrine(event) : edictDoctrine(event);
    if (played) {
      doctrineCueSerial += 1;
      const id = `${event.order}:${event.cue}`;
      doctrineCueCounts[id] = (doctrineCueCounts[id] || 0) + 1;
      doctrineLastPlayed = { ...event, serial: doctrineCueSerial };
    }
    return played;
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
  function proceduralShot(x, z, opts = {}) {
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
    drive.curve = shotDriveCurve();
    drive.oversample = "2x";
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

  function playerShot(x, z, opts = {}) {
    const gain = Number.isFinite(Number(opts.gain)) ? Number(opts.gain) : PLAYER_LIGHTGUN_GAIN;
    if (saintfallAssets.buffers.has("lightgunMain")) {
      return playSaintfallBuffer("lightgunMain", x, z, {
        bus: "weapon",
        gain,
        refDist: 30,
        maxDist: 520,
        fadeIn: 0.002,
      });
    }
    /* Keep the first shot responsive if the browser has not finished
       decoding the local clip yet. The preload normally wins this race;
       the procedural fallback is also what keeps OfflineAudioContext QA
       deterministic without a network fetch. */
    void loadSaintfallBuffer("lightgunMain");
    proceduralShot(x, z, { ...opts, gain });
    return false;
  }

  function shot(x, z, opts = {}) {
    return opts.player ? playerShot(x, z, opts) : proceduralShot(x, z, opts);
  }

  let furnaceChargeVoice = null;

  function furnaceCharge(progress = 0) {
    if (!ac || state.paused) return;
    const p = clamp01(progress);
    const t = now();
    if (p <= 0.02) {
      if (furnaceChargeVoice) {
        try {
          furnaceChargeVoice.gain.gain.linearRampToValueAtTime(0.0001, t + 0.05);
          furnaceChargeVoice.osc.stop(t + 0.06);
          furnaceChargeVoice.noise.stop(t + 0.06);
        } catch (_) {}
        furnaceChargeVoice = null;
      }
      return;
    }
    if (!furnaceChargeVoice) {
      const g = voice("weapon", 1.2);
      if (!g) return;
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, t);
      const flt = ac.createBiquadFilter();
      flt.type = "bandpass";
      flt.Q.value = 4.5;
      flt.frequency.setValueAtTime(380, t);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.05);
      osc.connect(flt); flt.connect(gain); gain.connect(g);
      osc.start(t);

      const noise = noiseSource(1.2);
      const nflt = ac.createBiquadFilter();
      nflt.type = "bandpass";
      nflt.Q.value = 2.0;
      nflt.frequency.setValueAtTime(450, t);
      const ngain = ac.createGain();
      ngain.gain.setValueAtTime(0.001, t);
      ngain.gain.linearRampToValueAtTime(0.04, t + 0.05);
      noise.connect(nflt); nflt.connect(ngain); ngain.connect(g);
      noise.start(t);

      furnaceChargeVoice = { osc, flt, gain, noise, nflt, ngain, g };
    }
    const freq = 220 + p * 680;
    const filterFreq = 380 + p * 1400;
    furnaceChargeVoice.osc.frequency.setTargetAtTime(freq, t, 0.03);
    furnaceChargeVoice.flt.frequency.setTargetAtTime(filterFreq, t, 0.03);
    furnaceChargeVoice.nflt.frequency.setTargetAtTime(500 + p * 1200, t, 0.03);
    furnaceChargeVoice.gain.gain.setTargetAtTime(0.06 + p * 0.12, t, 0.03);
  }

  function furnaceDischarge(x, z, opts = {}) {
    if (furnaceChargeVoice) {
      try {
        const t = now();
        furnaceChargeVoice.gain.gain.linearRampToValueAtTime(0.0001, t + 0.03);
        furnaceChargeVoice.osc.stop(t + 0.04);
        furnaceChargeVoice.noise.stop(t + 0.04);
      } catch (_) {}
      furnaceChargeVoice = null;
    }
    const t = now();
    const rank = opts.rank || 1;
    const dur = rank >= 2 ? 0.65 : 0.48;
    const g = voice("weapon", dur);
    if (!g) return;
    const p = place(g, x ?? state.listenerX, z ?? state.listenerZ, 45, 800);
    if (!p) return;
    const out = p.node;
    const amp = (opts.gain ?? 0.85) * p.atten * (rank >= 2 ? 1.35 : 1.0);

    const crack = noiseSource(dur);
    const ch = ac.createBiquadFilter();
    ch.type = "highpass";
    ch.frequency.setValueAtTime(1100, t);
    const cb = ac.createBiquadFilter();
    cb.type = "peaking";
    cb.frequency.setValueAtTime(2800, t);
    cb.Q.value = 1.2;
    cb.gain.value = 14;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 6.5, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    crack.connect(ch); ch.connect(cb); cb.connect(cg); cg.connect(out);
    crack.start(t); crack.stop(t + 0.05);

    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(180, t);
    sub.frequency.exponentialRampToValueAtTime(32, t + 0.12);
    const subg = ac.createGain();
    subg.gain.setValueAtTime(amp * 5.2, t);
    subg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    sub.connect(subg); subg.connect(out);
    sub.start(t); sub.stop(t + 0.24);

    const bell = ac.createOscillator();
    bell.type = "triangle";
    bell.frequency.setValueAtTime(520, t);
    bell.frequency.exponentialRampToValueAtTime(370, t + dur * 0.7);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp * 1.8, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.85);
    bell.connect(bg); bg.connect(out);
    bell.start(t); bell.stop(t + dur);

    const ash = noiseSource(dur);
    const af = ac.createBiquadFilter();
    af.type = "bandpass";
    af.frequency.setValueAtTime(1200, t);
    af.frequency.exponentialRampToValueAtTime(420, t + dur);
    af.Q.value = 1.8;
    const ag = ac.createGain();
    ag.gain.setValueAtTime(amp * 2.2, t);
    ag.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
    ash.connect(af); af.connect(ag); ag.connect(out);
    ash.start(t); ash.stop(t + dur);
  }

  let meleePierceVoice = null;

  function meleePierceCharge(progress = 0) {
    if (!ac || state.paused) return;
    const p = clamp01(progress);
    const t = now();
    if (p <= 0.02) {
      if (meleePierceVoice) {
        try {
          meleePierceVoice.gain.gain.linearRampToValueAtTime(0.0001, t + 0.04);
          meleePierceVoice.osc.stop(t + 0.05);
          meleePierceVoice.noise.stop(t + 0.05);
        } catch (_) {}
        meleePierceVoice = null;
      }
      return;
    }
    if (!meleePierceVoice) {
      const g = voice("weapon", 1.0);
      if (!g) return;
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(260, t);
      const flt = ac.createBiquadFilter();
      flt.type = "bandpass";
      flt.Q.value = 6.0;
      flt.frequency.setValueAtTime(420, t);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.04);
      osc.connect(flt); flt.connect(gain); gain.connect(g);
      osc.start(t);

      const noise = noiseSource(1.0);
      const nflt = ac.createBiquadFilter();
      nflt.type = "bandpass";
      nflt.Q.value = 3.2;
      nflt.frequency.setValueAtTime(600, t);
      const ngain = ac.createGain();
      ngain.gain.setValueAtTime(0.001, t);
      ngain.gain.linearRampToValueAtTime(0.05, t + 0.04);
      noise.connect(nflt); nflt.connect(ngain); ngain.connect(g);
      noise.start(t);

      meleePierceVoice = { osc, flt, gain, noise, nflt, ngain, g };
    }
    const freq = 260 + p * 820;
    const filterFreq = 420 + p * 1600;
    meleePierceVoice.osc.frequency.setTargetAtTime(freq, t, 0.025);
    meleePierceVoice.flt.frequency.setTargetAtTime(filterFreq, t, 0.025);
    meleePierceVoice.nflt.frequency.setTargetAtTime(600 + p * 1400, t, 0.025);
    meleePierceVoice.gain.gain.setTargetAtTime(0.08 + p * 0.14, t, 0.025);
  }

  function meleePierceLaunch(x, z) {
    if (meleePierceVoice) {
      try {
        const t = now();
        meleePierceVoice.gain.gain.linearRampToValueAtTime(0.0001, t + 0.03);
        meleePierceVoice.osc.stop(t + 0.04);
        meleePierceVoice.noise.stop(t + 0.04);
      } catch (_) {}
      meleePierceVoice = null;
    }
    const t = now();
    const dur = 0.52;
    const g = voice("weapon", dur);
    if (!g) return;
    const p = place(g, x ?? state.listenerX, z ?? state.listenerZ, 45, 800);
    if (!p) return;
    const out = p.node;
    const amp = 0.95 * p.atten;

    // Rocket thruster roar
    const roar = noiseSource(dur);
    const rf = ac.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.setValueAtTime(1400, t);
    rf.frequency.exponentialRampToValueAtTime(320, t + dur);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(amp * 4.5, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
    roar.connect(rf); rf.connect(rg); rg.connect(out);
    roar.start(t); roar.stop(t + dur);

    // Piercing supersonic crack
    const crack = noiseSource(0.12);
    const cf = ac.createBiquadFilter();
    cf.type = "highpass";
    cf.frequency.setValueAtTime(2200, t);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 6.0, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    crack.connect(cf); cf.connect(cg); cg.connect(out);
    crack.start(t); crack.stop(t + 0.09);

    // Deep sub drop
    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(240, t);
    sub.frequency.exponentialRampToValueAtTime(45, t + 0.22);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(amp * 5.0, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    sub.connect(sg); sg.connect(out);
    sub.start(t); sub.stop(t + 0.30);
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

  /** The censer-lance connecting: low body, dry chitin crack and a short
   *  reliquary ring. One voice per swing keeps pack-clearing readable. */
  function meleeImpact(x, z, event = {}) {
    if (!(event.hits > 0)) return;
    const t = now();
    const dur = event.slam ? 0.52 : 0.34;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 18, 260);
    if (!p) return;
    const weight = Math.min(1.35, 0.84 + Math.max(0, event.hits - 1) * 0.10);
    const amp = 0.46 * p.atten * weight;

    const body = ac.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(event.slam ? 105 : 142, t);
    body.frequency.exponentialRampToValueAtTime(event.slam ? 38 : 58, t + dur);
    const bodyGain = ac.createGain();
    bodyGain.gain.setValueAtTime(amp, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    body.connect(bodyGain); bodyGain.connect(p.node);
    body.start(t); body.stop(t + dur + 0.02);

    const crack = noiseSource(1.45);
    const crackFilter = ac.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = event.slam ? 820 : 1180;
    crackFilter.Q.value = 1.2;
    const crackGain = ac.createGain();
    crackGain.gain.setValueAtTime(amp * 0.88, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.105);
    crack.connect(crackFilter); crackFilter.connect(crackGain); crackGain.connect(p.node);
    crack.start(t); crack.stop(t + 0.13);

    const ring = ac.createOscillator();
    ring.type = "sine";
    ring.frequency.setValueAtTime(event.slam ? 430 : 620, t + 0.012);
    ring.frequency.exponentialRampToValueAtTime(260, t + dur * 0.8);
    const ringGain = ac.createGain();
    ringGain.gain.setValueAtTime(amp * 0.24, t + 0.012);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ring.connect(ringGain); ringGain.connect(p.node);
    ring.start(t + 0.012); ring.stop(t + dur + 0.02);
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

  /** A stratagem landing. `delay` schedules it ahead on the audio
   *  clock rather than through a timer, so a salvo's seven reports keep
   *  their spacing regardless of what the frame rate is doing. */
  function explosion(x, z, radius = 20, delay = 0) {
    const wait = Math.max(0, Math.min(4, Number(delay) || 0));
    const t = now() + wait;
    const dur = 2.2;
    /* The voice's own lifetime has to cover the WAIT as well as the
       sound. `voice` disconnects on a wall-clock timer measured from
       now, so a scheduled report whose gain node is torn down before it
       starts is silence with no error attached to it. */
    const g = voice("world", dur + wait);
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

  /* ------------------------------------------------------------------
     THE COULTER

     Its whole submerged phase is a sound. The player cannot see the
     animal, the mini-map glyph is a hint rather than a warning, and the
     wake is only readable if they happen to be looking the right way -
     so what actually tells them the boss is coming is a low, rising
     rumble that pans.

     Deliberately almost all below 90Hz. Everything else on Vesper-IX
     lives in the midrange - the wind, the lance, the brood's chittering
     - so a register nothing else occupies is audible at a level that
     does not fight the rest of the mix, and it reads as felt rather
     than heard, which is the correct impression for something moving
     under the ground you are standing on.
     ------------------------------------------------------------------ */

  /** Sand shifting somewhere under the player. `strength` 0-1. */
  function rumble(x, z, strength = 1) {
    const t = now();
    const dur = 0.85;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 45, 620);
    if (!p) return;
    const amp = clamp01(strength) * 0.62 * p.atten;
    if (amp < 0.002) return;

    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(38 + Math.random() * 8, t);
    sub.frequency.linearRampToValueAtTime(26, t + dur);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(amp, t + 0.18);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(p.node);
    sub.start(t); sub.stop(t + dur + 0.02);

    // Grit: the sand itself, well down and heavily filtered so it reads
    // as material rather than as static.
    const grit = noiseSource(0.35);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + dur);
    const gg = ac.createGain();
    gg.gain.setValueAtTime(amp * 0.42, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    grit.connect(lp); lp.connect(gg); gg.connect(p.node);
    grit.start(t); grit.stop(t + dur);
  }

  /** The eruption: a shovel of sand and something enormous shouting
   *  through it. Louder and longer than a stratagem, because it is the
   *  one sound in the game that means "it is here". */
  function surface(x, z) {
    explosion(x, z, 26);
    const t = now();
    const dur = 1.65;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 70, 900);
    if (!p) return;
    const amp = 0.86 * p.atten;

    /* A shriek built from two detuned saws an octave apart, swept down
       and through a resonant band. It is not a real animal noise and
       does not need to be - what it has to be is UNLIKE the brood's
       chitter, so the player never mistakes the boss for a garrison. */
    for (const [ratio, level] of [[1, 1], [2.02, 0.42]]) {
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(126 * ratio, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(41 * ratio, t + dur * 0.85);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(340, t);
      bp.frequency.exponentialRampToValueAtTime(120, t + dur);
      bp.Q.value = 2.6;
      const og = ac.createGain();
      og.gain.setValueAtTime(0.0001, t + 0.05);
      og.gain.exponentialRampToValueAtTime(amp * level, t + 0.16);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(bp); bp.connect(og); og.connect(p.node);
      osc.start(t + 0.05); osc.stop(t + dur + 0.02);
    }
  }

  /** Venom leaving a throat. High, wet, and short - the one bright
   *  sound this animal makes, matching the one bright thing on it. */
  function hiss(x, z) {
    const t = now();
    const dur = 0.62;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 30, 480);
    if (!p) return;
    const amp = 0.42 * p.atten;

    const src = noiseSource(1.35);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    bp.Q.value = 1.1;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(amp, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(ng); ng.connect(p.node);
    src.start(t); src.stop(t + dur);

    const gulp = ac.createOscillator();
    gulp.type = "triangle";
    gulp.frequency.setValueAtTime(240, t);
    gulp.frequency.exponentialRampToValueAtTime(88, t + 0.24);
    const gg = ac.createGain();
    gg.gain.setValueAtTime(amp * 0.5, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    gulp.connect(gg); gg.connect(p.node);
    gulp.start(t); gulp.stop(t + 0.28);
  }

  /** Shared two-beat guard language. The first spatial note announces the
   *  committed source; the final note marks the 250ms timing window. */
  function guardBeat(x, z, guardType = "frontal", ready = false) {
    const t = now();
    const dur = ready ? 0.16 : 0.23;
    const g = voice("world", dur + 0.04);
    if (!g) return;
    const p = place(g, x, z, 34, 520);
    if (!p) return;
    const dodge = guardType === "unblockable";
    const osc = ac.createOscillator();
    osc.type = dodge ? "sawtooth" : ready ? "square" : "triangle";
    const start = dodge ? (ready ? 165 : 240) : (ready ? 1180 : 560);
    const end = dodge ? (ready ? 110 : 155) : (ready ? 820 : 390);
    osc.frequency.setValueAtTime(start, t);
    osc.frequency.exponentialRampToValueAtTime(end, t + dur);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime((ready ? 0.38 : 0.24) * p.atten, t + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(og); og.connect(p.node);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /* ============================================================
     VENTING

     Pressing R had no sound and no picture. The heat gauge moved,
     which is the one part of the screen a player in a firefight is
     not looking at, so a deliberate 1.4-second vulnerability read as
     "nothing happened" and the input felt unbound.

     Built as three parts, because a single hiss reads as a leak
     rather than as a machine doing something on purpose:
       - the CRACK of the ports opening,
       - a bright steam jet that falls in pitch and thins out as the
         pressure drops, held for the real vent duration so the sound
         ends exactly when the trooper is ready again,
       - a low body resonance, so it has mass.
     `startHeat` scales all three: venting at 30% should sound like
     much less of an event than venting at 95%.
     ============================================================ */
  function vent(x, z, opts = {}) {
    const t = now();
    const dur = Math.max(0.35, Math.min(3, Number(opts.duration) || 1.4));
    const heat = Math.max(0, Math.min(1, Number(opts.startHeat) ?? 0.6));
    const g = voice("world", dur + 0.25);
    if (!g) return;
    const p = place(g, x, z, 26, 420);
    if (!p) return;
    // A near-empty vent is a short sigh; a redline vent is the event.
    const amp = (0.26 + heat * 0.40) * p.atten * (Number(opts.gain) || 1);

    // 1. The ports crack open.
    const crack = noiseSource(2.1);
    const cbp = ac.createBiquadFilter();
    cbp.type = "highpass";
    cbp.frequency.value = 1800;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 0.9, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    crack.connect(cbp); cbp.connect(cg); cg.connect(p.node);
    crack.start(t); crack.stop(t + 0.15);

    // 2. The jet itself, falling as the pressure goes.
    const jet = noiseSource(1.5);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(3200 + heat * 1400, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + dur);
    bp.Q.value = 0.9;
    const jg = ac.createGain();
    jg.gain.setValueAtTime(0.0001, t);
    jg.gain.exponentialRampToValueAtTime(amp, t + 0.07);
    jg.gain.setValueAtTime(amp, t + dur * 0.55);
    jg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    jet.connect(bp); bp.connect(jg); jg.connect(p.node);
    jet.start(t); jet.stop(t + dur + 0.05);

    // 3. Body resonance, so the lance has mass behind the steam.
    const body = ac.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(150 + heat * 60, t);
    body.frequency.exponentialRampToValueAtTime(62, t + dur * 0.8);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp * 0.42, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.85);
    body.connect(bg); bg.connect(p.node);
    body.start(t); body.stop(t + dur);
  }

  /** The lance is cool and ready again. Deliberately a clean, short
   *  interval rather than another noise burst: it is information the
   *  player is waiting for, and it has to cut through a firefight. */
  function ventReady(x, z) {
    const t = now();
    const g = voice("world", 0.4);
    if (!g) return;
    const p = place(g, x, z, 26, 300);
    if (!p) return;
    const amp = 0.20 * p.atten;
    for (const [i, f] of [523.25, 784].entries()) {
      const osc = ac.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const og = ac.createGain();
      const at = t + i * 0.055;
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(amp, at + 0.012);
      og.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
      osc.connect(og); og.connect(p.node);
      osc.start(at); osc.stop(at + 0.28);
    }
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
    /* Start the two music streams buffering NOW, under the cinematic,
       rather than at startMusic() - which fires on the handoff frame,
       where kicking off ~9.4MB of media fetch+demux used to land its
       scheduling cost on the exact frame the match cut must not
       hitch. initMusic only creates the elements and their gain
       nodes; nothing plays until startMusic flips `started`. */
    initMusic();
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
    if (paused) {
      stopInsectProximity();
      pauseMusicAudio();
    } else if (state.enabled && music.started) resumeMusicAudio();
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
      if (ready) {
        startAmbience();
        startMusic();
      }
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
     MUSIC

     Four dynamic soundtrack beds:
     - Ashes Over Arrakis (Background / Exploration / Overworld)
     - Iron Chapel March (Boss Fights / Apex Engagements)
     - Abyss of Bells (Apostate / Phase One)
     - Vault-Cathedral Brood (Apostate / Phase Two)

     Uses HTML5 Audio streams piped into buses.music (with fallback
     direct audio element volume control if createMediaElementSource
     is unavailable). Smoothly cross-fades between exploration, ordinary
     boss combat, and the two Apostate phases.
     ============================================================ */

  const MUSIC_ASSETS = Object.freeze({
    bg: new URL("../../Sounds/saintfall music/Ashes Over Arrakis.mp3", import.meta.url).href,
    boss: new URL("../../Sounds/saintfall music/Iron Chapel March.mp3", import.meta.url).href,
    finalPhase1: new URL("../../Sounds/saintfall music/Abyss of Bells.mp3", import.meta.url).href,
    finalPhase2: new URL("../../Sounds/saintfall music/Vault-Cathedral Brood.mp3", import.meta.url).href,
  });

  const MUSIC_TRACKS = Object.freeze([
    Object.freeze({
      mode: "exploration", asset: MUSIC_ASSETS.bg,
      audio: "bgAudio", gain: "bgGainNode", volume: "bgVol",
    }),
    Object.freeze({
      mode: "boss", asset: MUSIC_ASSETS.boss,
      audio: "bossAudio", gain: "bossGainNode", volume: "bossVol",
    }),
    Object.freeze({
      mode: "finalPhase1", asset: MUSIC_ASSETS.finalPhase1,
      audio: "finalPhase1Audio", gain: "finalPhase1GainNode", volume: "finalPhase1Vol",
    }),
    Object.freeze({
      mode: "finalPhase2", asset: MUSIC_ASSETS.finalPhase2,
      audio: "finalPhase2Audio", gain: "finalPhase2GainNode", volume: "finalPhase2Vol",
    }),
  ]);

  const music = {
    initialized: false,
    started: false,
    bgAudio: null,
    bossAudio: null,
    bgGainNode: null,
    bossGainNode: null,
    finalPhase1Audio: null,
    finalPhase2Audio: null,
    finalPhase1GainNode: null,
    finalPhase2GainNode: null,
    bgVol: 0,
    bossVol: 0,
    finalPhase1Vol: 0,
    finalPhase2Vol: 0,
    mode: "exploration",
    isBossActive: false,
    pollIn: 0,
  };

  function initMusic() {
    if (music.initialized || state.offline) return;
    if (typeof Audio === "undefined") return;
    music.initialized = true;

    try {
      for (const track of MUSIC_TRACKS) {
        const audio = new Audio(track.asset);
        audio.loop = true;
        audio.preload = "auto";
        audio.crossOrigin = "anonymous";
        music[track.audio] = audio;
      }

      if (ac && typeof ac.createMediaElementSource === "function") {
        try {
          for (const track of MUSIC_TRACKS) {
            const audio = music[track.audio];
            const source = ac.createMediaElementSource(audio);
            const gain = ac.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(buses.music);
            music[track.gain] = gain;
          }
        } catch (_) {
          for (const track of MUSIC_TRACKS) music[track.gain] = null;
        }
      }
    } catch (_) {
      // Audio element initialization fallback
    }
  }

  function startMusic() {
    initMusic();
    if (!music.initialized || !state.enabled || state.paused || ctx.intro?.isBlocking?.()) return;
    music.started = true;
  }

  function isOrdinaryBossFightActive() {
    if (ctx.districtBosses?.anyFightActive?.()) return true;
    const winnower = ctx.winnower?.status?.();
    if (winnower && !winnower.dead && winnower.phase !== "dormant" && winnower.phase !== "return") return true;
    const distaff = ctx.distaff?.status?.();
    if (distaff && !distaff.dead && distaff.phase !== "dormant" && distaff.phase !== "returning") return true;
    const garner = ctx.garner?.status?.();
    if (garner && !garner.dead && garner.phase !== "dormant") return true;
    const abbess = ctx.abbess?.status?.();
    if (abbess && !abbess.dead && abbess.phase !== "dormant") return true;
    const stylite = ctx.stylite?.status?.();
    if (stylite && !stylite.dead && stylite.phase !== "dormant") return true;
    const saint = ctx.districtBosses?.status?.("saint");
    if (saint && !saint.defeated && (saint.phase === "alert" || saint.phase === "active")) return true;
    const breach = ctx.breaches?.status?.();
    if (breach?.boss && breach.phase === "active") return true;
    return false;
  }

  function currentMusicMode() {
    const apostate = ctx.apostate?.status?.();
    if (apostate && !apostate.dead && apostate.phase !== "dormant" && apostate.phase !== "alert") {
      return apostate.stage === 2 || apostate.phase === "descent"
        ? "finalPhase2" : "finalPhase1";
    }
    return isOrdinaryBossFightActive() ? "boss" : "exploration";
  }

  function pauseMusicAudio() {
    for (const track of MUSIC_TRACKS) {
      const audio = music[track.audio];
      if (audio && !audio.paused) audio.pause();
    }
  }

  function resumeMusicAudio() {
    if (!state.enabled || state.paused || !music.started) return;
    const track = MUSIC_TRACKS.find((candidate) => candidate.mode === music.mode);
    const audio = track && music[track.audio];
    if (audio) audio.play().catch(() => {});
  }

  function updateMusic(dt) {
    if (!music.started || !music.initialized) return;
    const muted = !state.enabled || state.paused || ctx.deferAmbience || ctx.intro?.isBlocking?.();
    /* Polled at 4Hz, not per frame. currentMusicMode fans out into
       eight modules' status() calls, several of which assemble fresh
       snapshot objects - a dozen-plus allocations a frame, peaking
       exactly during boss fights, purely to choose between soundtrack beds.
       The answer moves on encounter timescales and the crossfade below
       takes ~1.2s, so a quarter-second poll is inaudible and removes
       the churn. */
    music.pollIn -= dt;
    if (music.pollIn <= 0) {
      music.pollIn = 0.25;
      music.mode = currentMusicMode();
      music.isBossActive = music.mode !== "exploration";
    }

    const fadeRate = 2.4; // smooth ~1.2s crossfade
    const step = Math.min(1, Math.max(0, dt * fadeRate));

    for (const track of MUSIC_TRACKS) {
      const target = muted || track.mode !== music.mode ? 0 : 1;
      const volumeKey = track.volume;
      music[volumeKey] += (target - music[volumeKey]) * step;
      if (Math.abs(music[volumeKey] - target) < 0.025) music[volumeKey] = target;

      const audio = music[track.audio];
      if (!audio) continue;
      if (music[volumeKey] > 0.001) {
        if (audio.paused) audio.play().catch(() => {});
      } else if (music[volumeKey] === 0 && !audio.paused && target === 0) {
        audio.pause();
      }
      if (music[track.gain]) {
        music[track.gain].gain.value = music[volumeKey];
        audio.volume = 1.0;
      } else {
        audio.volume = clamp01(music[volumeKey] * 0.52 * (state.musicVolume / 0.8)
          * state.masterVolume * (state.enabled ? 1 : 0));
      }
    }
  }

  /* ============================================================
     VOLUMES

     Master, Music, and SFX volume controls. Master scales the
     overall output, Music scales buses.music, and SFX scales all
     weapon, world, doctrine, ui, ambience, and cinematic buses.
     ============================================================ */

  function applyVolumes() {
    const masterGain = (state.enabled ? 1.35 : 0) * state.masterVolume;
    if (ac.state === "running") {
      master.gain.setTargetAtTime(masterGain, now(), 0.04);
    } else {
      master.gain.value = masterGain;
    }

    if (buses.music) {
      const targetMusicGain = BASE_BUS_LEVELS.music * (state.musicVolume / 0.8);
      if (ac.state === "running") {
        buses.music.gain.setTargetAtTime(targetMusicGain, now(), 0.04);
      } else {
        buses.music.gain.value = targetMusicGain;
      }
    }

    for (const name of ["weapon", "world", "doctrine", "ui", "ambience", "cinematic"]) {
      if (buses[name]) {
        const targetSfxGain = (BASE_BUS_LEVELS[name] || 0.7) * state.sfxVolume;
        if (ac.state === "running") {
          buses[name].gain.setTargetAtTime(targetSfxGain, now(), 0.04);
        } else {
          buses[name].gain.value = targetSfxGain;
        }
      }
    }

    if (music.initialized) {
      for (const track of MUSIC_TRACKS) {
        const audio = music[track.audio];
        if (audio && !music[track.gain]) {
          audio.volume = clamp01(music[track.volume] * 0.52 * (state.musicVolume / 0.8)
            * state.masterVolume * (state.enabled ? 1 : 0));
        }
      }
    }
  }

  function setMasterVolume(v) {
    state.masterVolume = clamp01(Number.isFinite(Number(v)) ? Number(v) : 1.0);
    applyVolumes();
    return state.masterVolume;
  }

  function setMusicVolume(v) {
    state.musicVolume = clamp01(Number.isFinite(Number(v)) ? Number(v) : 0.8);
    applyVolumes();
    return state.musicVolume;
  }

  function setSfxVolume(v) {
    state.sfxVolume = clamp01(Number.isFinite(Number(v)) ? Number(v) : 1.0);
    applyVolumes();
    return state.sfxVolume;
  }

  function setVolumes({ master: m, music: mu, sfx: s } = {}) {
    if (Number.isFinite(Number(m))) state.masterVolume = clamp01(Number(m));
    if (Number.isFinite(Number(mu))) state.musicVolume = clamp01(Number(mu));
    if (Number.isFinite(Number(s))) state.sfxVolume = clamp01(Number(s));
    applyVolumes();
    return { master: state.masterVolume, music: state.musicVolume, sfx: state.sfxVolume };
  }

  /* ============================================================
     WIRING

     Subscribed to the buses the game already emits rather than
     called from inside the systems: audio should be removable
     without touching combat.
     ============================================================ */

  let doctrineAttached = false;
  let doctrineStop = null;
  function attach() {
    const { combat, mission, breaches } = ctx;
    void preloadSaintfallBuffers();
    if (!doctrineAttached) {
      doctrineAttached = true;
      doctrineStop = ctx.progression?.bus?.on?.("doctrine", doctrineCue) || null;
    }
    /* The weapons bus had no audio consumer at all, so a manual vent -
       a deliberate 1.4s of vulnerability the player chose - made no
       sound whatsoever. */
    if (ctx.weapons?.bus?.on) {
      ctx.weapons.bus.on("vent", (e = {}) => {
        vent(e.x ?? 0, e.z ?? 0, { duration: e.duration, startHeat: e.startHeat });
      });
      ctx.weapons.bus.on("ventComplete", (e = {}) => ventReady(e.x ?? 0, e.z ?? 0));
    }
    if (combat) {
      combat.bus.on("hit", (e) => impact(e.x, e.z, "flesh"));
      combat.bus.on("melee", (e) => meleeImpact(e.x, e.z, e));
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
        // or from where. A bite that lands nothing lands no sound
        // either; the whiff is the silence after the hiss.
        if (e.melee) { if (e.landed !== false) impact(e.x, e.z, "flesh"); }
        else shot(e.x, e.z, { gain: 0.34 });
      });
      combat.bus.on("playerHurt", () => hurt());
      combat.bus.on("playerDied", () => {
        chord([220, 165, 110], 1.2, 0.2);
      });
      combat.bus.on("respawn", () => chord([330, 440, 550], 0.4, 0.14));
    }
    if (ctx.guardReadability?.bus) {
      ctx.guardReadability.bus.on("threatTelegraph", (e) => {
        guardBeat(e.x, e.z, e.guardType, false);
      });
      ctx.guardReadability.bus.on("threatReady", (e) => {
        guardBeat(e.x, e.z, e.guardType, true);
      });
    }
    if (mission) {
      mission.bus.on("stratagem", () => blip(880, 0.09, 0.2));
      mission.bus.on("code", (e) => blip(e && e.ok ? 1320 : 220, 0.05, 0.18));
      mission.bus.on("relayDone", () => chord([392, 523, 659, 784], 0.7, 0.18));
      mission.bus.on("extractCalled", () => chord([262, 392, 523], 1.1, 0.22));
      mission.bus.on("won", () => chord([523, 659, 784, 1047], 1.4, 0.24));
      mission.bus.on("lost", () => chord([196, 147, 110], 1.6, 0.24));
      mission.bus.on("inbound", (e) => inbound(e.x, e.z, e.seconds));
      /* The ARRIVAL carries the sound now, not the resolution: the
         picture leads the damage by up to half a second, and a bang on
         the damage frame arrives after the flash that caused it.
         The lance keeps the full stratagem explosion; the salvo trades
         it for a rolling string of smaller ones, which is the whole
         difference between the two commands in one cue. */
      mission.bus.on("arrival", (e) => {
        if (e.key === "cluster") {
          for (let i = 0; i < 7; i += 1) {
            explosion(e.x + (Math.random() - 0.5) * e.radius,
              e.z + (Math.random() - 0.5) * e.radius,
              e.radius * 0.5, 0.24 + i * 0.09 + Math.random() * 0.04);
          }
        } else if (e.heals) {
          chord([392, 523, 659, 784], 1.1, 0.2);
        } else {
          explosion(e.x, e.z, e.radius);
        }
      });
      /* Only commands whose picture is NOT the arrival still sound on
         impact - which after the change above is none of the three, so
         this stays for anything a doctrine adds later that resolves
         without a lead. */
      mission.bus.on("impact", (e) => {
        if (e.key === "orbital" || e.key === "cluster" || e.heals) return;
        explosion(e.x, e.z, e.radius);
      });
      mission.bus.on("boonEnded", () => chord([330, 262], 0.5, 0.12));
    }
    if (breaches) {
      breaches.bus.on("warning", () => chord([147, 196, 220], 0.72, 0.14));
      breaches.bus.on("bossWarning", () => chord([92, 110, 147, 196], 1.45, 0.24));
      breaches.bus.on("opened", (e) => explosion(e.x, e.z, e.boss ? 18 : 10));
      breaches.bus.on("cleared", () => chord([294, 392, 494], 0.7, 0.16));
      breaches.bus.on("complete", () => chord([392, 523, 659, 880], 1.25, 0.22));
    }
    /* The burrower. Subscribed here like everything else, so the whole
       encounter can be muted by not attaching - and so the module that
       owns it never learns what an AudioContext is. */
    const coulter = ctx.coulter;
    if (coulter) {
      coulter.bus.on("wake", (e) => rumble(e.x, e.z, e.strength));
      coulter.bus.on("breach", (e) => surface(e.x, e.z));
      coulter.bus.on("spew", (e) => hiss(e.x, e.z));
      coulter.bus.on("bite", (e) => impact(e.x, e.z, "flesh"));
      coulter.bus.on("dive", (e) => rumble(e.x, e.z, 1));
      // A pool landing is a wet slap, not a hiss: the hiss belongs to
      // the throat that threw it and would double up on the same beat.
      coulter.bus.on("spill", (e) => impact(e.x, e.z, "flesh"));
    }
    /* The Glass Scar's guardian. Subscribed the same way as the
       burrower and for the same reason - distaff.js never learns what
       an AudioContext is either. */
    const distaff = ctx.distaff;
    if (distaff) {
      distaff.bus.on("aggro", () => chord([110, 147, 185, 233], 1.35, 0.22));
      distaff.bus.on("slamTelegraph", (e) => rumble(e.x, e.z, 0.6));
      /* Eight legs walking is the sound of this fight now. Small per
         step, doubled for the lunge - the footfall event is already
         throttled at the source. */
      distaff.bus.on("footfall", (e) => rumble(e.x, e.z, e.running ? 0.5 : 0.22));
      distaff.bus.on("lungeTelegraph", (e) => chord([87, 110, 147], 0.7, 0.2));
      distaff.bus.on("slam", (e) => impact(e.x, e.z, "wall"));
      distaff.bus.on("webCast", (e) => hiss(e.x, e.z));
      distaff.bus.on("webHit", (e) => impact(e.x, e.z, "flesh"));
      /* The reel: the same hiss leaving the spinneret, and a hit that
         is followed by a low held chord for as long as the haul - the
         line under tension. The stagger is a fall in pitch: something
         that was holding the animal up has stopped. */
      distaff.bus.on("reelCast", (e) => hiss(e.x, e.z));
      distaff.bus.on("reelHit", (e) => { impact(e.x, e.z, "flesh"); chord([65, 98, 131], 1.4, 0.18); });
      distaff.bus.on("stagger", (e) => chord([123, 98, 73], 0.5, 0.2));
      distaff.bus.on("patch", (e) => surface(e.x, e.z));
      // Lower and longer than the aggro sting: the collapse is the
      // fight changing shape, not a new threat announcing itself.
      distaff.bus.on("collapse", (e) => chord([73, 98, 123], 1.1, 0.24));
      distaff.bus.on("recover", (e) => chord([98, 130, 165], 0.6, 0.16));
      distaff.bus.on("bite", (e) => impact(e.x, e.z, "flesh"));
      distaff.bus.on("defeated", () => chord([196, 262, 330, 392], 1.6, 0.24));
    }
    /* The Gilded Reach's mantis. Its new rite is heard as one low
       planting chord followed by separate ground transients, matching
       the three (then four) visible fronts instead of collapsing the
       whole mechanic into one explosion. */
    const matriarch = ctx.matriarch;
    if (matriarch) {
      matriarch.bus.on("tremorTell", (e) => {
        chord(e.roused ? [49, 65, 98, 131] : [55, 73, 110], 1.35, 0.25);
        rumble(e.x, e.z, 0.65);
      });
      matriarch.bus.on("tremorPulse", (e) => rumble(e.x, e.z,
        e.roused ? 1 : 0.82));
      matriarch.bus.on("tremorHit", (e) => impact(e.x, e.z, "wall"));
      matriarch.bus.on("tremorCleared", () => chord([220, 294], 0.18, 0.06));
    }
    /* The flyer. Its cues are pitched HIGHER than either ground boss -
       a thing overhead should not share a register with a thing that
       walks, or the player cannot tell from sound alone which one is
       about to hurt them. */
    const winnower = ctx.winnower;
    if (winnower) {
      winnower.bus.on("aggro", () => chord([196, 294, 392, 494], 1.5, 0.22));
      winnower.bus.on("bombardTelegraph", (e) => hiss(e.x, e.z));
      winnower.bus.on("bombard", (e) => surface(e.x, e.z));
      winnower.bus.on("ash", (e) => explosion(e.x, e.z, e.radius * 0.8));
      winnower.bus.on("strafeTelegraph", (e) => rumble(e.x, e.z, 0.9));
      winnower.bus.on("strafeHit", (e) => impact(e.x, e.z, "flesh"));
      winnower.bus.on("landing", (e) => rumble(e.x, e.z, 1));
      // The stoke is the window opening: a low, sustained note under
      // everything else, so a player who is looking the wrong way
      // still knows the animal is down.
      winnower.bus.on("stoke", (e) => chord([65, 98, 131], 1.4, 0.26));
      winnower.bus.on("stunned", (e) => explosion(e.x, e.z, 12));
      winnower.bus.on("stokeRecover", (e) => chord([82, 110, 138], 0.8, 0.2));
      winnower.bus.on("sweep", (e) => impact(e.x, e.z, "flesh"));
      winnower.bus.on("launch", (e) => surface(e.x, e.z));
      winnower.bus.on("crash", (e) => explosion(e.x, e.z, 16));
      winnower.bus.on("defeated", () => chord([220, 294, 370, 440], 1.7, 0.24));
    }
    /* The Ossuary's pit. Pitched LOWER than any other boss in the game
       and deliberately so: the Distaff walks, the Winnower flies, and
       this one is underneath the player. A cue that shares a register
       with either of the others would put the sound of the fight in
       the wrong place in the mix, and where the sound is coming from
       is the only thing this animal's audio has to say. */
    const garner = ctx.garner;
    if (garner) {
      // Not a sting. Two octaves of pedal under a fifth, held long
      // enough to still be sounding when the plates finish falling.
      garner.bus.on("aggro", () => chord([41, 55, 82, 110], 2.6, 0.30));
      garner.bus.on("engaged", () => chord([49, 73, 98], 1.2, 0.20));
      /* THE LIMB CUES ARE THE FIGHT, and the ordering of them is what
         a player who is facing the wrong way listens to: a hard
         positional surface as it breaks ground, a rising note while it
         cocks back, and a wall impact when it lands on the pan. */
      garner.bus.on("erupt", (e) => surface(e.x, e.z));
      garner.bus.on("rear", (e) => hiss(e.x, e.z));
      garner.bus.on("lash", (e) => rumble(e.x, e.z, 0.55));
      garner.bus.on("lashMiss", (e) => impact(e.x, e.z, "wall"));
      garner.bus.on("seize", (e) => impact(e.x, e.z, "flesh"));
      garner.bus.on("sweep", (e) => impact(e.x, e.z, "flesh"));
      garner.bus.on("sever", (e) => {
        impact(e.x, e.z, "flesh");
        chord([58, 87, 116], 0.7, 0.18);
      });
      // The draw. A long swell rather than a hit, because the inhale is
      // four seconds of pressure and the player has to be able to hear
      // it start from anywhere on the pan.
      garner.bus.on("inhaleTelegraph", (e) => chord([37, 49, 74], 1.7, 0.26));
      garner.bus.on("inhale", (e) => rumble(e.x, e.z, 1));
      garner.bus.on("devour", (e) => explosion(e.x, e.z, 18));
      garner.bus.on("spitTelegraph", (e) => hiss(e.x, e.z));
      garner.bus.on("spit", (e) => surface(e.x, e.z));
      garner.bus.on("shard", (e) => impact(e.x, e.z, e.direct ? "flesh" : "wall"));
      // The window, and it is the one cue in this set that goes UP -
      // everything else the Garner does is a threat, and this is the
      // only thing it does that is an opportunity.
      garner.bus.on("gorge", () => chord([98, 147, 196, 262], 1.5, 0.26));
      garner.bus.on("gorgeEnd", () => chord([62, 82, 110], 0.8, 0.18));
      garner.bus.on("sealing", (e) => rumble(e.x, e.z, 0.8));
      garner.bus.on("defeated", () => chord([147, 196, 247, 294], 1.9, 0.26));
    }
    /* The Bloom's queen. Her register sits between the Garner's pedal
       and the Distaff's mid - she is underground-adjacent rather than
       underground - and every cue she has is about POPULATION rather
       than about damage, because that is what her fight is. The two
       that matter most are the ones a player facing the wrong way has
       to hear: a clutch going down behind them, and a child getting
       home. */
    const abbess = ctx.abbess;
    if (abbess) {
      abbess.bus.on("aggro", () => chord([55, 73, 110, 147], 2.2, 0.28));
      abbess.bus.on("engaged", () => chord([65, 98, 131], 1.1, 0.20));
      abbess.bus.on("clutchTelegraph", (e) => hiss(e.x, e.z));
      abbess.bus.on("clutch", (e) => surface(e.x, e.z));
      // One per egg would be a rattle; the clutch already sounded.
      abbess.bus.on("hatch", (e) => impact(e.x, e.z, "flesh"));
      abbess.bus.on("eggKilled", (e) => impact(e.x, e.z, "flesh"));
      abbess.bus.on("stillborn", (e) => hiss(e.x, e.z));
      /* THE FEED, and it is the one cue in this set the player must
         never miss: it is the sound of the fight going backwards.
         Pitched UP against everything else she does, because a rising
         figure is what the ear reads as something being given. */
      abbess.bus.on("feed", (e) => chord([147, 196, 262], 0.5, 0.20));
      abbess.bus.on("recall", (e) => hiss(e.x, e.z));
      abbess.bus.on("slamTelegraph", (e) => rumble(e.x, e.z, 0.85));
      abbess.bus.on("slam", (e) => {
        explosion(e.x, e.z, 20);
        rumble(e.x, e.z, 1);
      });
      abbess.bus.on("royal", () => chord([41, 55, 82, 110], 2.6, 0.30));
      abbess.bus.on("royalHatch", (e) => explosion(e.x, e.z, 22));
      abbess.bus.on("retiring", (e) => rumble(e.x, e.z, 0.7));
      abbess.bus.on("defeated", () => chord([165, 220, 277, 330], 1.9, 0.26));
    }
    /* The Choir's tenant. Its cues are the only ones in the game that
       have to carry HEIGHT: the animal is ninety metres up and usually
       behind a needle, so the audio is most of how a player knows what
       it is doing. Pitched high and dry against the Abbess's pedal -
       a thing on a rock spire should not share a register with a thing
       in a pit. */
    const stylite = ctx.stylite;
    if (stylite) {
      stylite.bus.on("aggro", () => chord([220, 330, 440, 587], 1.8, 0.24));
      stylite.bus.on("engaged", () => chord([196, 294, 392], 1.0, 0.18));
      // The wind-up before a volley: the one cue that buys a dodge.
      stylite.bus.on("aim", (e) => hiss(e.x, e.z));
      stylite.bus.on("shot", (e) => surface(e.x, e.z));
      stylite.bus.on("boltHit", (e) => impact(e.x, e.z, "flesh"));
      stylite.bus.on("boltSplash", (e) => impact(e.x, e.z, "wall"));
      /* The spring loading, then unloading. Two cues rather than one
         because the gap between them IS the telegraph, and a player
         facing away needs to hear it leave the rock. */
      stylite.bus.on("coil", (e) => rumble(e.x, e.z, 0.5));
      stylite.bus.on("launch", (e) => surface(e.x, e.z));
      stylite.bus.on("land", (e) => impact(e.x, e.z, "wall"));
      stylite.bus.on("stoopTelegraph", (e) => chord([98, 147, 196], 0.8, 0.24));
      stylite.bus.on("stoop", (e) => explosion(e.x, e.z, 14));
      /* THE FALL. A descending figure, because everything else this
         animal does goes up, and this is the one thing the player made
         happen. */
      stylite.bus.on("gripBroken", () => chord([392, 294, 196, 131], 1.5, 0.28));
      stylite.bus.on("crash", (e) => {
        explosion(e.x, e.z, 18);
        rumble(e.x, e.z, 1);
      });
      stylite.bus.on("recover", (e) => rumble(e.x, e.z, 0.6));
      stylite.bus.on("retiring", (e) => hiss(e.x, e.z));
      stylite.bus.on("defeated", () => chord([175, 233, 294, 349], 1.8, 0.26));
    }
    /* The false saint uses the player's mechanical vocabulary in the
       Bloom register: familiar lance/boost transients under violet shell
       movement and a brood-call chord where a command confirmation belongs. */
    const apostate = ctx.apostate;
    if (apostate) {
      apostate.bus.on("aggro", () => chord([69, 92, 138, 185], 1.9, 0.28));
      apostate.bus.on("engaged", () => chord([82, 110, 165, 247], 1.1, 0.22));
      apostate.bus.on("shot", (e) => shot(e.x, e.z, { gain: 0.44 }));
      apostate.bus.on("meleeTelegraph", (e) => hiss(e.x, e.z));
      apostate.bus.on("melee", (e) => {
        if (e.hit) impact(e.x, e.z, "flesh");
      });
      apostate.bus.on("boost", (e) => rumble(e.x, e.z, 0.52));
      apostate.bus.on("boostHit", (e) => impact(e.x, e.z, "wall"));
      apostate.bus.on("jet", (e) => rumble(e.x, e.z, 0.72));
      apostate.bus.on("slam", (e) => explosion(e.x, e.z, e.radius));
      apostate.bus.on("call", (e) => chord([65, 98, 131, 196], 1.55, 0.25));
      apostate.bus.on("summoned", (e) => surface(e.x, e.z));
      apostate.bus.on("shield", (e) => {
        if (e.active) chord([147, 220, 294], 0.72, 0.14);
      });
      apostate.bus.on("shieldBlock", (e) => impact(e.x, e.z, "wall"));
      apostate.bus.on("vent", (e) => hiss(e.x, e.z));
      apostate.bus.on("defeated", () => chord([196, 262, 330, 494], 2.2, 0.30));
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
        if (wantsAmbience) startMusic();
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
    updateMusic(dt);
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
    updateInsectProximity(player);
    const jetThrottle = clamp01(ctx.jetpack?.state?.throttle || 0);
    const isMeleePierce = !!ctx.player?.action && ctx.player.action.name === "meleePierce";
    const boostThrottle = ctx.boost?.state?.active
      ? (ctx.boost?.state?.holding ? 0.88 : 1.0)
      : (isMeleePierce ? 1.0 : 0);
    const throttle = clamp01(Math.max(jetThrottle, boostThrottle));
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


  /* ============================================================
     THE GLIDE AND THE FALL

     The glide/boost shares the same propulsion sfx as jetpack flight
     (ignition burst, jet engine roar while held, and clean cutoff).
     The fall uses its rising choir charge and heavy landing slam.
     ============================================================ */

  /** The heel jets lighting (matches flying ignition). */
  function boostIgnite(x, z) {
    jetIgnite();
  }

  /** Release, or a glide cut short (matches flying cutoff). */
  function boostCut() {
    jetCutoff();
  }

  /** Contact while ramming. */
  function boostHit(x, z, heavy = false) {
    const t = now();
    const dur = 0.42;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 24, 260);
    if (!p) return;
    const amp = (heavy ? 0.72 : 0.5) * p.atten;
    const thud = ac.createOscillator();
    thud.type = "triangle";
    thud.frequency.setValueAtTime(heavy ? 150 : 205, t);
    thud.frequency.exponentialRampToValueAtTime(heavy ? 44 : 68, t + 0.2);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(amp, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    thud.connect(tg); tg.connect(p.node);
    thud.start(t); thud.stop(t + dur);

    const crack = noiseSource(heavy ? 0.7 : 1.05);
    const cf = ac.createBiquadFilter();
    cf.type = "bandpass";
    cf.Q.value = 1.1;
    cf.frequency.setValueAtTime(heavy ? 700 : 1500, t);
    cf.frequency.exponentialRampToValueAtTime(180, t + 0.24);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 0.85, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    crack.connect(cf); cf.connect(cg); cg.connect(p.node);
    crack.start(t); crack.stop(t + 0.28);
  }

  /** The hang: a reliquary winding up over the trooper's head. */
  function slamCharge(x, z) {
    const t = now();
    const dur = 0.30;
    const g = voice("world", dur + 0.1);
    if (!g) return;
    const p = place(g, x, z, 30, 260);
    if (!p) return;
    /* Three voices STACK, so the per-voice amplitude has to be about a
       third of what a single-oscillator cue would take: at 0.30 the
       wind-up rendered as loud as the gunshot. */
    const amp = 0.19 * p.atten;
    /* A rising fifth, three voices. Deliberately CHORAL rather than
       mechanical: the pack already owns every industrial sound the
       trooper makes, and this is the one thing they do that the
       game's own fiction would call a rite. */
    for (const [mult, delay] of [[1, 0], [1.5, 0.02], [2, 0.045]]) {
      const osc = ac.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(196 * mult, t + delay);
      osc.frequency.exponentialRampToValueAtTime(392 * mult, t + dur);
      const og = ac.createGain();
      og.gain.setValueAtTime(0.0001, t + delay);
      og.gain.linearRampToValueAtTime(amp / (mult * 1.2), t + dur * 0.7);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      osc.connect(og); og.connect(p.node);
      osc.start(t + delay); osc.stop(t + dur + 0.1);
    }
  }

  /** The drop itself: a short downward tear, then silence. */
  function slamPlunge(x, z) {
    const t = now();
    const dur = 0.34;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 26, 260);
    if (!p) return;
    const amp = 0.62 * p.atten;
    const tear = noiseSource(1.6);
    const tf = ac.createBiquadFilter();
    tf.type = "bandpass";
    tf.Q.value = 0.9;
    tf.frequency.setValueAtTime(2600, t);
    tf.frequency.exponentialRampToValueAtTime(300, t + dur);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.linearRampToValueAtTime(amp, t + 0.03);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    tear.connect(tf); tf.connect(tg); tg.connect(p.node);
    tear.start(t); tear.stop(t + dur);
  }

  /** Landfall. The loudest thing the trooper can do. */
  function slamImpact(x, z, drop = 0) {
    const t = now();
    const dur = 1.7;
    const g = voice("world", dur);
    if (!g) return;
    const p = place(g, x, z, 55, 700);
    if (!p) return;
    const amp = (0.9 + drop * 0.25) * p.atten;

    // The floor.
    const boom = ac.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(78, t);
    boom.frequency.exponentialRampToValueAtTime(23, t + 0.9);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    boom.connect(bg); bg.connect(p.node);
    boom.start(t); boom.stop(t + 1.25);

    // The crack of the lance arriving.
    const hit = noiseSource(0.55);
    const hf = ac.createBiquadFilter();
    hf.type = "lowpass";
    hf.frequency.setValueAtTime(6500, t);
    hf.frequency.exponentialRampToValueAtTime(120, t + 0.65);
    const hg = ac.createGain();
    hg.gain.setValueAtTime(amp * 0.95, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    hit.connect(hf); hf.connect(hg); hg.connect(p.node);
    hit.start(t); hit.stop(t + 0.8);

    /* The ring going out. A metallic tail on a low hit is what turns
       "an explosion" into "something struck the ground", and it is
       the same gold the whole faction sounds like. */
    for (const [freq, gain, delay] of [[523, 0.13, 0.02], [784, 0.09, 0.04],
      [1046, 0.055, 0.07]]) {
      const bell = ac.createOscillator();
      bell.type = "triangle";
      bell.frequency.setValueAtTime(freq, t + delay);
      bell.frequency.exponentialRampToValueAtTime(freq * 0.92, t + 1.1);
      const bgn = ac.createGain();
      bgn.gain.setValueAtTime(0.0001, t + delay);
      bgn.gain.linearRampToValueAtTime(gain * amp, t + delay + 0.01);
      bgn.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
      bell.connect(bgn); bgn.connect(p.node);
      bell.start(t + delay); bell.stop(t + 1.2);
    }
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

  /* ==========================================================
     KENOSIS OPERATIVE CUES. Same two-to-three-layer discipline as
     everything above: a single oscillator is a beep and a single
     noise burst is a hiss. The Vigil's sounds live above the shot
     spectrum (small weapon, fast hands); the Bastion's sit below it
     (a furnace and a bell on legs).
     ========================================================== */

  /** One crescent pulse. `opts.hand` detunes left/right so an
   *  alternating volley reads as two instruments, not a stutter. */
  function crescentShot(x, z, opts = {}) {
    const t = now();
    const dur = 0.17;
    const g = voice("weapon", dur + 0.05);
    if (!g) return;
    const p = place(g, x, z, 20, 300);
    if (!p) return;
    const amp = (opts.gain ?? 0.30) * p.atten;
    const detune = opts.hand === 1 ? 1.06 : 1.0;
    // Layer A: the pulse leaving - a falling sine, fast.
    const tone = ac.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(1180 * detune, t);
    tone.frequency.exponentialRampToValueAtTime(610 * detune, t + dur);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(amp, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    tone.connect(tg); tg.connect(p.node);
    tone.start(t); tone.stop(t + dur + 0.02);
    // Layer B: the emitter's crack - a very short band of noise.
    const crack = noiseSource(1.7);
    const cf = ac.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 2300 * detune;
    cf.Q.value = 1.3;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 0.85, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    crack.connect(cf); cf.connect(cg); cg.connect(p.node);
    crack.start(t); crack.stop(t + 0.07);
  }

  /** The Vigil Step, leaving. A rising tear with a choir edge. */
  function blinkCast(x, z) {
    const t = now();
    const dur = 0.22;
    const g = voice("world", dur + 0.05);
    if (!g) return;
    const p = place(g, x, z, 22, 240);
    if (!p) return;
    const amp = 0.30 * p.atten;
    const rise = ac.createOscillator();
    rise.type = "sine";
    rise.frequency.setValueAtTime(520, t);
    rise.frequency.exponentialRampToValueAtTime(1680, t + dur);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(amp * 0.8, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    rise.connect(rg); rg.connect(p.node);
    rise.start(t); rise.stop(t + dur + 0.02);
    const shimmer = noiseSource(1.3);
    const sf = ac.createBiquadFilter();
    sf.type = "highpass";
    sf.frequency.value = 3400;
    const sg = ac.createGain();
    sg.gain.setValueAtTime(amp * 0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    shimmer.connect(sf); sf.connect(sg); sg.connect(p.node);
    shimmer.start(t); shimmer.stop(t + dur);
  }

  /** The Vigil Step, arriving: displaced air paid back in. */
  function blinkArrive(x, z) {
    const t = now();
    const dur = 0.28;
    const g = voice("world", dur + 0.05);
    if (!g) return;
    const p = place(g, x, z, 22, 240);
    if (!p) return;
    const amp = 0.32 * p.atten;
    const thump = ac.createOscillator();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(185, t);
    thump.frequency.exponentialRampToValueAtTime(88, t + dur * 0.8);
    const hg = ac.createGain();
    hg.gain.setValueAtTime(amp, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    thump.connect(hg); hg.connect(p.node);
    thump.start(t); thump.stop(t + dur + 0.02);
    const chime = ac.createOscillator();
    chime.type = "triangle";
    chime.frequency.setValueAtTime(1320, t + 0.015);
    chime.frequency.exponentialRampToValueAtTime(1180, t + 0.2);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 0.30, t + 0.015);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    chime.connect(cg); cg.connect(p.node);
    chime.start(t + 0.015); chime.stop(t + 0.26);
  }

  /** The reliquary hammer leaving the hand. */
  function hammerThrow(x, z) {
    const t = now();
    const dur = 0.48;
    const g = voice("weapon", dur + 0.05);
    if (!g) return;
    const p = place(g, x, z, 24, 300);
    if (!p) return;
    const amp = 0.48 * p.atten;
    // Layer A: the swing tearing air - noise swept down.
    const whoosh = noiseSource(1.0);
    const wf = ac.createBiquadFilter();
    wf.type = "lowpass";
    wf.frequency.setValueAtTime(950, t);
    wf.frequency.exponentialRampToValueAtTime(240, t + dur);
    const wg = ac.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.linearRampToValueAtTime(amp, t + 0.05);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    whoosh.connect(wf); wf.connect(wg); wg.connect(p.node);
    whoosh.start(t); whoosh.stop(t + dur + 0.02);
    // Layer B: the mass behind it.
    const mass = ac.createOscillator();
    mass.type = "triangle";
    mass.frequency.setValueAtTime(138, t);
    mass.frequency.exponentialRampToValueAtTime(72, t + dur * 0.7);
    const mg = ac.createGain();
    mg.gain.setValueAtTime(amp * 0.7, t);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    mass.connect(mg); mg.connect(p.node);
    mass.start(t); mass.stop(t + dur);
  }

  /** The cast landing. `heavy` is a body or a downed flyer;
   *  the light variant is masonry and spent range. */
  function hammerImpact(x, z, heavy = false) {
    const t = now();
    const dur = heavy ? 0.62 : 0.38;
    const g = voice("world", dur + 0.1);
    if (!g) return;
    const p = place(g, x, z, 26, 320);
    if (!p) return;
    const amp = (heavy ? 0.60 : 0.44) * p.atten;
    // Layer A: the body of the blow.
    const body = ac.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(heavy ? 108 : 150, t);
    body.frequency.exponentialRampToValueAtTime(heavy ? 40 : 62, t + dur);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    body.connect(bg); bg.connect(p.node);
    body.start(t); body.stop(t + dur + 0.02);
    // Layer B: the bell of the reliquary - two detuned partials.
    for (const [freq, gain] of [[522, 0.34], [787, 0.20]]) {
      const bell = ac.createOscillator();
      bell.type = "square";
      bell.frequency.setValueAtTime(freq, t + 0.008);
      bell.frequency.exponentialRampToValueAtTime(freq * 0.94, t + dur);
      const gg = ac.createGain();
      gg.gain.setValueAtTime(amp * gain, t + 0.008);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
      bell.connect(gg); gg.connect(p.node);
      bell.start(t + 0.008); bell.stop(t + dur);
    }
    // Layer C: the crack.
    const crack = noiseSource(1.45);
    const cf = ac.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = heavy ? 900 : 1300;
    cf.Q.value = 1.1;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 0.9, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    crack.connect(cf); cf.connect(cg); cg.connect(p.node);
    crack.start(t); crack.stop(t + 0.12);
  }

  /** The hammer slapping back into the gauntlet. */
  function hammerCatch(x, z) {
    const t = now();
    const dur = 0.26;
    const g = voice("world", dur + 0.05);
    if (!g) return;
    const p = place(g, x, z, 18, 220);
    if (!p) return;
    const amp = 0.40 * p.atten;
    const slap = noiseSource(1.5);
    const sf = ac.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.value = 1500;
    sf.Q.value = 1.0;
    const sg = ac.createGain();
    sg.gain.setValueAtTime(amp, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    slap.connect(sf); sf.connect(sg); sg.connect(p.node);
    slap.start(t); slap.stop(t + 0.1);
    const ring = ac.createOscillator();
    ring.type = "triangle";
    ring.frequency.setValueAtTime(740, t + 0.01);
    ring.frequency.exponentialRampToValueAtTime(690, t + dur);
    const rg = ac.createGain();
    rg.gain.setValueAtTime(amp * 0.35, t + 0.01);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ring.connect(rg); rg.connect(p.node);
    ring.start(t + 0.01); ring.stop(t + dur + 0.02);
    const thud = ac.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(150, t);
    thud.frequency.exponentialRampToValueAtTime(85, t + 0.18);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(amp * 0.6, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    thud.connect(tg); tg.connect(p.node);
    thud.start(t); thud.stop(t + 0.22);
  }

  /** A blow taken ON the tower shield. `perfect` brightens the ring -
   *  the parry has to be audible before it is legible. */
  function blockImpact(x, z, perfect = false) {
    const t = now();
    const dur = perfect ? 0.55 : 0.36;
    const g = voice("world", dur + 0.1);
    if (!g) return;
    const p = place(g, x, z, 20, 240);
    if (!p) return;
    const amp = 0.46 * p.atten;
    for (const [freq, gain] of [[452, 0.5], [678, 0.3]]) {
      const clang = ac.createOscillator();
      clang.type = "square";
      clang.frequency.setValueAtTime(freq, t);
      clang.frequency.exponentialRampToValueAtTime(freq * 0.95, t + dur * 0.8);
      const gg = ac.createGain();
      gg.gain.setValueAtTime(amp * gain, t);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7);
      clang.connect(gg); gg.connect(p.node);
      clang.start(t); clang.stop(t + dur);
    }
    const crack = noiseSource(1.5);
    const cf = ac.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 1700;
    cf.Q.value = 1.2;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(amp * 0.8, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    crack.connect(cf); cf.connect(cg); cg.connect(p.node);
    crack.start(t); crack.stop(t + 0.09);
    if (perfect) {
      const bell = ac.createOscillator();
      bell.type = "triangle";
      bell.frequency.setValueAtTime(1568, t + 0.02);
      bell.frequency.exponentialRampToValueAtTime(1490, t + dur);
      const bg = ac.createGain();
      bg.gain.setValueAtTime(amp * 0.4, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      bell.connect(bg); bg.connect(p.node);
      bell.start(t + 0.02); bell.stop(t + dur + 0.02);
    }
  }

  /** The Censer's leap: one furnace huff, no sustain. */
  function leapBlast(x, z) {
    const t = now();
    const dur = 0.42;
    const g = voice("world", dur + 0.05);
    if (!g) return;
    const p = place(g, x, z, 24, 260);
    if (!p) return;
    const amp = 0.5 * p.atten;
    const huff = noiseSource(0.9);
    const hf = ac.createBiquadFilter();
    hf.type = "lowpass";
    hf.frequency.setValueAtTime(850, t);
    hf.frequency.exponentialRampToValueAtTime(190, t + dur);
    const hg = ac.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.linearRampToValueAtTime(amp, t + 0.04);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    huff.connect(hf); hf.connect(hg); hg.connect(p.node);
    huff.start(t); huff.stop(t + dur + 0.02);
    const boom = ac.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(98, t);
    boom.frequency.exponentialRampToValueAtTime(54, t + dur * 0.8);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(amp * 0.8, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    boom.connect(bg); bg.connect(p.node);
    boom.start(t); boom.stop(t + dur + 0.02);
  }

  return {
    context: ac,
    shot,
    furnaceCharge,
    furnaceDischarge,
    vent,
    ventReady,
    impact,
    death,
    explosion,
    inbound,
    rumble,
    surface,
    hiss,
    step,
    hurt,
    blip,
    chord,
    boostIgnite,
    boostCut,
    boostHit,
    slamCharge,
    slamPlunge,
    slamImpact,
    meleePierceCharge,
    meleePierceLaunch,
    doctrineCue,
    detachDoctrine() {
      doctrineStop?.();
      doctrineStop = null;
      doctrineAttached = false;
    },
    jetIgnite,
    jetCutoff,
    jetEmpty,
    jetLand,
    crescentShot,
    blinkCast,
    blinkArrive,
    hammerThrow,
    hammerImpact,
    hammerCatch,
    blockImpact,
    leapBlast,
    attach,
    update,
    unlock,
    startAmbience,
    startMusic,
    setMasterVolume,
    setMusicVolume,
    setSfxVolume,
    setVolumes,
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
      if (!state.enabled) stopInsectProximity();
      master.gain.setTargetAtTime(v ? 1.35 : 0, now(), 0.05);
      if (!v) {
        pauseMusicAudio();
      } else if (music.started) resumeMusicAudio();
    },
    get enabled() { return state.enabled; },
    stats() {
      return {
        state: ac.state,
        voices: state.voices,
        doctrineVoices: state.doctrineVoices,
        doctrine: {
          serial: doctrineCueSerial,
          lastCue: doctrineLastPlayed ? { ...doctrineLastPlayed } : null,
          cueCounts: { ...doctrineCueCounts },
        },
        sampleRate: ac.sampleRate,
        paused: state.paused,
        ambience: !!wind,
        jetLoop: !!jetLoop,
        volumes: {
          master: Number(state.masterVolume.toFixed(3)),
          music: Number(state.musicVolume.toFixed(3)),
          sfx: Number(state.sfxVolume.toFixed(3)),
        },
        localAssets: {
          loaded: Array.from(saintfallAssets.buffers.keys()),
          loadErrors: Array.from(saintfallAssets.loadErrors,
            ([id, message]) => `${id}: ${message}`),
          insectProximity: {
            active: !!insectProximity.source && !insectProximity.stopping,
            targetId: insectProximity.target?.id || null,
            gain: INSECT_PROXIMITY_GAIN,
          },
        },
        music: {
          started: music.started,
          activeTrack: music.mode,
          bossActive: music.isBossActive,
          bgVol: Number(music.bgVol.toFixed(3)),
          bossVol: Number(music.bossVol.toFixed(3)),
          finalPhase1Vol: Number(music.finalPhase1Vol.toFixed(3)),
          finalPhase2Vol: Number(music.finalPhase2Vol.toFixed(3)),
          bgPlaying: !!music.bgAudio && !music.bgAudio.paused,
          bossPlaying: !!music.bossAudio && !music.bossAudio.paused,
          finalPhase1Playing: !!music.finalPhase1Audio && !music.finalPhase1Audio.paused,
          finalPhase2Playing: !!music.finalPhase2Audio && !music.finalPhase2Audio.paused,
        },
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
    shot: noop, furnaceCharge: noop, furnaceDischarge: noop, impact: noop, death: noop, explosion: noop, inbound: noop,
    rumble: noop, surface: noop, hiss: noop,
    step: noop, hurt: noop, blip: noop, chord: noop, attach: noop,
    jetIgnite: noop, jetCutoff: noop, jetEmpty: noop, jetLand: noop,
    crescentShot: noop, blinkCast: noop, blinkArrive: noop,
    hammerThrow: noop, hammerImpact: noop, hammerCatch: noop,
    blockImpact: noop, leapBlast: noop,
    boostIgnite: noop, boostCut: noop, boostHit: noop,
    slamCharge: noop, slamPlunge: noop, slamImpact: noop,
    meleePierceCharge: noop, meleePierceLaunch: noop,
    doctrineCue: no, detachDoctrine: noop,
    update: noop, unlock: noPromise, startAmbience: noop, startMusic: noop, setEnabled: noop,
    setMasterVolume: noop, setMusicVolume: noop, setSfxVolume: noop, setVolumes: noop,
    beginDrop: noPromise, updateDrop: no, dropCue: no,
    pauseDrop: noPromise, setPaused: noPromise, endDrop: noPromise,
    enabled: false,
    stats() {
      return {
        state: "unavailable",
        voices: 0,
        doctrineVoices: 0,
        sampleRate: 0,
        paused: false,
        ambience: false,
        jetLoop: false,
        volumes: { master: 1, music: 0.8, sfx: 1 },
        localAssets: {
          loaded: [],
          loadErrors: [],
          insectProximity: { active: false, targetId: null, gain: INSECT_PROXIMITY_GAIN },
        },
        music: {
          started: false,
          activeTrack: "exploration",
          bossActive: false,
          bgVol: 0,
          bossVol: 0,
          finalPhase1Vol: 0,
          finalPhase2Vol: 0,
          bgPlaying: false,
          bossPlaying: false,
          finalPhase1Playing: false,
          finalPhase2Playing: false,
        },
        cinematic: {
          active: false, sources: 0, buffers: 0, loadErrors: [], paused: false,
        },
      };
    },
  };
}
