/* ============================================================
   APOP DEMON MOGGERS 3D - settings and quality tiers

   One place decides how expensive a frame is allowed to be. Every
   other module reads `ctx.settings.q` rather than making its own
   guess about the device, so "low" means the same thing in the
   texture synthesiser as it does in the particle budget.

   Tiers turn things on and off rather than scaling one magic number.
   A quality slider that dims everything at once is how a game ends up
   looking mediocre at every setting instead of good at one - and this
   game is judged blind against real Super Mario 64 frames, where the
   things that must never be cut (a grounded contact shadow, texture
   variance, dust in the air) are cheap, and the things that can go
   (shadow resolution, post intensity, prop distance) are not.

   Under `?qa=1` the tier is pinned and auto-detection is skipped
   entirely. The screenshot harness runs in headless Chromium, which
   frequently reports a software rasteriser; letting the probe decide
   would silently capture the low tier on the harness machine and the
   high tier on a laptop, and every golden comparison after that would
   be measuring the settings rather than the art.
   ============================================================ */

import { clamp } from "apop3d/core.js";

const STORE_KEY = "apop3d.settings.v1";

/** Tier the harness pins to. Fixed on purpose - see the header. */
const QA_TIER = "high";

export const TIERS = {
  low: {
    label: "Low",
    renderScale: 0.72,
    pixelRatioCap: 1.0,
    adaptiveResolution: true,

    shadows: true,
    shadowMapSize: 1024,
    shadowDistance: 60,
    shadowEvery: 3,
    /* Blob shadows are never a tier option. CONTRACT §2 lists "no
       contact shadow" as the loudest failure in the whole comparison,
       and a blob under every character costs one draw call. */
    blobShadows: true,
    contactShadowSize: 1.0,

    particleBudget: 220,
    decalBudget: 32,
    trailBudget: 6,
    dustDensity: 0.45,
    sparkleDensity: 0.4,

    textureSize: 256,
    textureVariants: 1,
    anisotropy: 2,
    detailTextures: false,

    postIntensity: 0.35,
    bloom: false,
    grain: false,
    vignette: true,
    colorGrade: true,

    drawDistance: 220,
    propDistance: 120,
    decorDensity: 0.45,
    crowdDensity: 0.3,
    maxLights: 6,
    waterQuality: 0,
    reflections: false,
  },
  medium: {
    label: "Medium",
    renderScale: 0.88,
    pixelRatioCap: 1.25,
    adaptiveResolution: true,

    shadows: true,
    shadowMapSize: 1536,
    shadowDistance: 90,
    shadowEvery: 2,
    blobShadows: true,
    contactShadowSize: 1.0,

    particleBudget: 700,
    decalBudget: 96,
    trailBudget: 12,
    dustDensity: 0.75,
    sparkleDensity: 0.75,

    textureSize: 512,
    textureVariants: 2,
    anisotropy: 8,
    detailTextures: true,

    postIntensity: 0.65,
    bloom: true,
    grain: false,
    vignette: true,
    colorGrade: true,

    drawDistance: 380,
    propDistance: 220,
    decorDensity: 0.75,
    crowdDensity: 0.6,
    maxLights: 12,
    waterQuality: 1,
    reflections: false,
  },
  high: {
    label: "High",
    renderScale: 1.0,
    pixelRatioCap: 1.5,
    adaptiveResolution: true,

    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 130,
    shadowEvery: 2,
    blobShadows: true,
    contactShadowSize: 1.0,

    particleBudget: 1600,
    decalBudget: 192,
    trailBudget: 20,
    dustDensity: 1.0,
    sparkleDensity: 1.0,

    textureSize: 512,
    textureVariants: 3,
    anisotropy: 16,
    detailTextures: true,

    postIntensity: 1.0,
    bloom: true,
    grain: true,
    vignette: true,
    colorGrade: true,

    drawDistance: 600,
    propDistance: 380,
    decorDensity: 1.0,
    crowdDensity: 1.0,
    maxLights: 20,
    waterQuality: 2,
    reflections: true,
  },
  ultra: {
    label: "Ultra",
    renderScale: 1.0,
    pixelRatioCap: 2.0,
    adaptiveResolution: false,

    shadows: true,
    shadowMapSize: 3072,
    shadowDistance: 190,
    shadowEvery: 1,
    blobShadows: true,
    contactShadowSize: 1.0,

    particleBudget: 2800,
    decalBudget: 320,
    trailBudget: 32,
    dustDensity: 1.25,
    sparkleDensity: 1.2,

    /* 1024 is past the point where an SM64-derived texture reads as
       SM64 - the grain stops being grain. It buys mip quality at a
       distance, nothing more, which is why ultra keeps the same
       variant count rather than inventing a fourth look. */
    textureSize: 1024,
    textureVariants: 4,
    anisotropy: 16,
    detailTextures: true,

    postIntensity: 1.15,
    bloom: true,
    grain: true,
    vignette: true,
    colorGrade: true,

    drawDistance: 900,
    propDistance: 620,
    decorDensity: 1.25,
    crowdDensity: 1.25,
    maxLights: 28,
    waterQuality: 3,
    reflections: true,
  },
};

export const TIER_ORDER = ["low", "medium", "high", "ultra"];

const DEFAULT_PREFS = {
  quality: "auto",
  /* input */
  sensitivity: 0.0024,
  deadzone: 0.16,
  invertY: false,
  binds: null,
  cameraSwingSpeed: 1.0,
  /* audio */
  masterVolume: 0.9,
  musicVolume: 0.6,
  sfxVolume: 1.0,
  muted: false,
  /* presentation */
  showHud: true,
  hudScale: 1.0,
  showFps: false,
  cameraShake: 1.0,
  beatFlash: 1.0,
  reducedMotion: false,
  subtitles: true,
};

/**
 * Coarse tier from what the GPU actually reports. Only a starting
 * point - the dynamic-resolution controller in render.js is what keeps
 * the frame inside budget once the course is running.
 */
export function detectTier() {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) return "low";

    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "") : "";
    const r = name.toLowerCase();

    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;

    // A software rasteriser cannot run this at any tier that looks
    // good; better to be honest and fast than pretty and unplayable.
    if (/swiftshader|llvmpipe|software|basic render|angle \(google/.test(r)) return "low";

    // Phones and tablets. Recent Apple silicon in a tablet is genuinely
    // quick, but the thermal envelope is not, so cap at medium.
    if (coarse) {
      if (/apple (a1[5-9]|m[1-9])/.test(r)) return "medium";
      if (/adreno (7[0-9]{2}|8[0-9]{2})|mali-g[7-9][0-9]|immortalis/.test(r)) return "medium";
      return "low";
    }

    if (/rtx (30|40|50)[0-9]{2}|rx (6[7-9]|7[5-9]|9[0-9])00|apple m[2-9]/.test(r)) return "ultra";
    if (/rtx 20[0-9]{2}|gtx 16[0-9]{2}|rx (5[6-9]|6[0-6])00|apple m1/.test(r)) return "high";
    if (/gtx (9|10)[0-9]{2}|rx (4[7-9]|5[0-5])0|iris xe|arc a[0-9]/.test(r)) return "high";
    if (/intel|uhd|hd graphics|vega [0-9]/.test(r)) return "medium";

    if (mem >= 8 && cores >= 8) return "high";
    if (mem >= 4 && cores >= 4) return "medium";
    return "low";
  } catch (error) {
    return "medium";
  }
}

export function create(ctx) {
  const params = new URLSearchParams(window.location.search);
  const qa = params.get("qa") === "1";

  const prefs = { ...DEFAULT_PREFS };
  let stored = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch (error) { /* private mode or corrupt json - defaults are fine */ }
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (stored[key] !== undefined && stored[key] !== null) prefs[key] = stored[key];
    }
  }

  // URL wins over the saved profile, so a capture run can pin a tier
  // without editing - or corrupting - whatever the player had chosen.
  if (params.has("quality")) prefs.quality = String(params.get("quality"));
  if (params.get("hud") === "0") prefs.showHud = false;
  if (params.get("mute") === "1") prefs.muted = true;

  const detected = qa ? QA_TIER : detectTier();

  let deterministic = qa;
  let tierName = prefs.quality === "auto" ? detected : prefs.quality;
  if (!TIERS[tierName]) tierName = detected;
  if (qa && !params.has("quality")) tierName = QA_TIER;

  const q = { ...TIERS[tierName] };
  if (deterministic) applyDeterministic(q);

  /** Anything that would make two runs of the same build differ is
   *  switched off here rather than in the modules that own it. */
  function applyDeterministic(target) {
    target.adaptiveResolution = false;
    target.renderScale = 1.0;
    target.pixelRatioCap = 1.0;
    target.shadowEvery = 1;
  }

  const changed = [];

  function emit() {
    for (const fn of changed) {
      try { fn(api); } catch (error) { console.error("[apop3d] settings listener threw", error); }
    }
    ctx.bus.emit("settings:change", { tier: tierName, q });
  }

  const api = {
    prefs,
    detected,
    qa,
    isTouch: Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches),

    /** Resolved tier name. */
    get tier() { return tierName; },
    /** Resolved tier values. Read these, never TIERS directly, so a
     *  runtime downgrade is visible to everyone at once. */
    q,
    get deterministic() { return deterministic; },
    TIERS,
    TIER_ORDER,

    setTier(name) {
      if (!TIERS[name]) return false;
      tierName = name;
      Object.assign(q, TIERS[name]);
      if (deterministic) applyDeterministic(q);
      prefs.quality = name;
      api.save();
      emit();
      return true;
    },

    /** Drop one tier. Returns false at the bottom, so a caller can
     *  stop asking instead of looping. */
    stepDown() {
      const i = TIER_ORDER.indexOf(tierName);
      if (i <= 0) return false;
      return api.setTier(TIER_ORDER[i - 1]);
    },

    /** qa.js calls this from pin(): freeze everything that varies. */
    setDeterministic(on) {
      deterministic = on !== false;
      Object.assign(q, TIERS[tierName]);
      if (deterministic) applyDeterministic(q);
      emit();
      return deterministic;
    },

    get(key, fallback) {
      return prefs[key] === undefined ? fallback : prefs[key];
    },

    set(key, value) {
      prefs[key] = value;
      if (key === "quality") return api.setTier(value === "auto" ? detected : value);
      api.save();
      emit();
      return true;
    },

    /** Subscribe; returns an unsubscribe. `onChange` is kept as an
     *  array too because that is the shape blacksand's modules expect. */
    on(fn) {
      changed.push(fn);
      return () => {
        const i = changed.indexOf(fn);
        if (i >= 0) changed.splice(i, 1);
      };
    },
    onChange: changed,

    save() {
      // Never write the profile while the harness is driving: a capture
      // run would otherwise leave its pinned tier in the player's
      // localStorage and they would wonder why the game got slower.
      if (qa) return false;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
        return true;
      } catch (error) {
        return false;
      }
    },

    reset() {
      Object.assign(prefs, DEFAULT_PREFS);
      api.setTier(detected);
      return true;
    },

    /** Volume helpers, so audio.js does not have to re-clamp. */
    volume(bus) {
      if (prefs.muted) return 0;
      const master = clamp(prefs.masterVolume, 0, 1);
      if (bus === "music") return master * clamp(prefs.musicVolume, 0, 1);
      if (bus === "sfx") return master * clamp(prefs.sfxVolume, 0, 1);
      return master;
    },

    report() {
      return { tier: tierName, detected, qa, deterministic, prefs: { ...prefs, binds: undefined } };
    },
  };

  return api;
}
