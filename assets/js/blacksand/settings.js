/* ============================================================
   BLACKSAND - settings and quality tiers

   One place that decides how expensive the frame is allowed to be.
   Every renderer/world module reads from `ctx.settings.q` (the
   resolved tier) rather than branching on device guesses of its own,
   so "low" means the same thing in the terrain shader as it does in
   the post stack.
   ============================================================ */

import { clamp, mergeDeep } from "./core.js";

const STORE_KEY = "blacksand.settings.v1";

/* ---------------------------- tiers ---------------------------- */

/**
 * Tiers are additive: each one turns things on rather than scaling a
 * single magic number. That is deliberate - a slider called "quality"
 * that dims everything at once is how a game ends up looking bad at
 * every setting instead of good at one.
 */
export const TIERS = {
  low: {
    label: "Low",
    pixelRatioCap: 1.0,
    renderScale: 0.72,
    shadows: true,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowDistance: 90,
    shadowSoftness: 0.6,
    contactShadows: false,
    ssao: false,
    ssaoQuality: 0,
    ssr: false,
    bloom: true,
    bloomQuality: 0,
    motionBlur: false,
    dof: false,
    taa: false,
    fxaa: true,
    filmGrain: false,
    chromaticAberration: false,
    volumetricLight: false,
    lightShafts: false,
    cloudQuality: 0,
    terrainLodBias: 1.6,
    terrainDetailTiles: false,
    grassDensity: 0.0,
    grassDistance: 0,
    treeDistance: 260,
    propDistance: 220,
    decalBudget: 48,
    particleBudget: 350,
    tracerBudget: 96,
    anisotropy: 4,
    textureSize: 512,
    reflectionProbe: false,
    waterQuality: 0,
    maxLights: 8,
    ragdolls: 2,
  },
  medium: {
    label: "Medium",
    pixelRatioCap: 1.25,
    renderScale: 0.88,
    shadows: true,
    shadowMapSize: 1536,
    shadowCascades: 3,
    shadowDistance: 150,
    shadowSoftness: 1.0,
    contactShadows: true,
    ssao: true,
    ssaoQuality: 1,
    ssr: false,
    bloom: true,
    bloomQuality: 1,
    motionBlur: false,
    dof: false,
    taa: true,
    fxaa: false,
    filmGrain: true,
    chromaticAberration: false,
    volumetricLight: false,
    lightShafts: true,
    cloudQuality: 1,
    terrainLodBias: 1.15,
    terrainDetailTiles: true,
    grassDensity: 0.5,
    grassDistance: 48,
    treeDistance: 420,
    propDistance: 380,
    decalBudget: 128,
    particleBudget: 900,
    tracerBudget: 192,
    anisotropy: 8,
    textureSize: 1024,
    reflectionProbe: true,
    waterQuality: 1,
    maxLights: 16,
    ragdolls: 4,
  },
  high: {
    label: "High",
    pixelRatioCap: 1.5,
    renderScale: 1.0,
    shadows: true,
    shadowMapSize: 2048,
    shadowCascades: 4,
    shadowDistance: 260,
    shadowSoftness: 1.35,
    contactShadows: true,
    ssao: true,
    ssaoQuality: 2,
    ssr: false,
    bloom: true,
    bloomQuality: 2,
    motionBlur: true,
    dof: true,
    taa: true,
    fxaa: false,
    filmGrain: true,
    chromaticAberration: true,
    volumetricLight: true,
    lightShafts: true,
    cloudQuality: 2,
    terrainLodBias: 1.0,
    terrainDetailTiles: true,
    grassDensity: 0.85,
    grassDistance: 78,
    treeDistance: 620,
    propDistance: 560,
    decalBudget: 256,
    particleBudget: 1800,
    tracerBudget: 320,
    anisotropy: 16,
    textureSize: 2048,
    reflectionProbe: true,
    waterQuality: 2,
    maxLights: 24,
    ragdolls: 8,
  },
  ultra: {
    label: "Ultra",
    pixelRatioCap: 2.0,
    renderScale: 1.0,
    shadows: true,
    shadowMapSize: 3072,
    shadowCascades: 4,
    shadowDistance: 420,
    shadowSoftness: 1.6,
    contactShadows: true,
    ssao: true,
    ssaoQuality: 3,
    ssr: true,
    bloom: true,
    bloomQuality: 3,
    motionBlur: true,
    dof: true,
    taa: true,
    fxaa: false,
    filmGrain: true,
    chromaticAberration: true,
    volumetricLight: true,
    lightShafts: true,
    cloudQuality: 3,
    terrainLodBias: 0.82,
    terrainDetailTiles: true,
    grassDensity: 1.0,
    grassDistance: 110,
    treeDistance: 900,
    propDistance: 820,
    decalBudget: 384,
    particleBudget: 3000,
    tracerBudget: 512,
    anisotropy: 16,
    textureSize: 2048,
    reflectionProbe: true,
    waterQuality: 3,
    maxLights: 32,
    ragdolls: 12,
  },
};

export const TIER_ORDER = ["low", "medium", "high", "ultra"];

/* --------------------------- gameplay --------------------------- */

const DEFAULT_PREFS = {
  quality: "auto",
  fov: 74,
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensitivityScale: 0.68,
  invertY: false,
  toggleAds: false,
  toggleCrouch: true,
  toggleSprint: false,
  masterVolume: 0.85,
  sfxVolume: 1.0,
  musicVolume: 0.5,
  voiceVolume: 0.9,
  showFps: false,
  showHud: true,
  hudScale: 1.0,
  crosshair: "dynamic",
  headBob: 1.0,
  viewKick: 1.0,
  cameraShake: 1.0,
  colourblind: "off",
  bloodEffects: true,
  motionBlurAmount: 0.6,
  adaptiveResolution: true,
  targetFps: 60,
  name: "",
};

/* --------------------------- detection --------------------------- */

/**
 * Auto-tier from what the GPU actually reports plus a coarse device
 * class. This is only a starting point - the adaptive resolution
 * controller in render.js is what keeps the frame inside budget.
 */
export function detectTier() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return "low";

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "")
      : "";
    const r = renderer.toLowerCase();

    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;

    // Software rasterisers cannot run this at any tier that looks good.
    if (/swiftshader|llvmpipe|software|basic render/.test(r)) return "low";

    // Phones and tablets. Apple silicon in a tablet is genuinely fast,
    // but the thermal envelope is not, so cap at medium.
    if (coarse) {
      if (/apple (a1[4-9]|m[1-9])/.test(r)) return "medium";
      if (/adreno (7[0-9]{2}|8[0-9]{2})|mali-g[7-9][0-9]|immortalis/.test(r)) return "medium";
      return "low";
    }

    // Desktop discrete parts.
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

/* ---------------------------- module ---------------------------- */

export function createSettings(overrides = {}) {
  const prefs = { ...DEFAULT_PREFS };

  // Saved preferences, then URL overrides. The URL wins so the
  // screenshot harness can pin a tier without touching the profile.
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) mergeDeep(prefs, JSON.parse(raw));
  } catch (error) { /* private mode, corrupt json - defaults are fine */ }

  const params = new URLSearchParams(window.location.search);
  if (params.has("quality")) prefs.quality = params.get("quality");
  if (params.has("fov")) prefs.fov = clamp(Number(params.get("fov")) || 74, 55, 110);
  if (params.get("hud") === "0") prefs.showHud = false;
  mergeDeep(prefs, overrides);

  const detected = detectTier();
  let tierName = prefs.quality === "auto" ? detected : prefs.quality;
  if (!TIERS[tierName]) tierName = detected;

  const api = {
    prefs,
    detected,
    /** Resolved tier name. */
    get tier() { return tierName; },
    /** Resolved tier values. Read this, not TIERS, so runtime
     *  downgrades from the adaptive controller are visible. */
    q: { ...TIERS[tierName] },
    /** True when the harness is driving; disables anything that
     *  makes captures non-deterministic. */
    qa: params.get("qa") === "1",
    isTouch: window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false,

    setTier(name) {
      if (!TIERS[name]) return false;
      tierName = name;
      Object.assign(api.q, TIERS[name]);
      prefs.quality = name;
      api.save();
      api.onChange.forEach((fn) => fn(api));
      return true;
    },

    /** Step down one tier. Returns false when already at the bottom. */
    stepDown() {
      const index = TIER_ORDER.indexOf(tierName);
      if (index <= 0) return false;
      return api.setTier(TIER_ORDER[index - 1]);
    },

    set(key, value) {
      prefs[key] = value;
      api.save();
      api.onChange.forEach((fn) => fn(api));
    },

    onChange: [],

    save() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
      } catch (error) { /* nothing to do */ }
    },

    reset() {
      Object.assign(prefs, DEFAULT_PREFS);
      api.setTier(detected);
    },
  };

  return api;
}
