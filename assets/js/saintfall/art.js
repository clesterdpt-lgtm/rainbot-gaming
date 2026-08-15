/* ============================================================
   SAINTFALL - art direction kernel

   One place decides what this game looks like: the palette, the
   atmosphere model, and the material archetypes every other module
   builds from.

   The look is two references welded together.

   From Journey: smooth silk dunes against hard faceted rock, a
   tightly rationed warm palette, and *directional* aerial
   perspective - distance does not fade to one grey, it fades to
   whatever the sky is doing in that direction, so a ridge near the
   sun glows and the same ridge away from it goes violet. That one
   effect does more for a low-poly vista than any amount of
   geometry.

   From the grim gothic: verdigris bronze, gold leaf, bone, oxblood
   banners and black basalt - colours that read as reliquary rather
   than as desert.

   Lighting is deliberately minimal: one authoritative celestial
   key, one image-based sky fill, and a handful of local emitters.
   The visible sky can carry Vesper's binary suns and three moons,
   but they resolve into that single key so props never grow a forest
   of contradictory shadows. Everything else is the grade. Fill
   comes from `scene.environment`, so changing the sky palette moves
   every shadow side in the world with it - note that inherited IBL
   is scaled by `scene.environmentIntensity`, NOT by
   `material.envMapIntensity`, which does nothing without a
   per-material envMap.
   ============================================================ */

import {
  clamp, clamp01, lerp, smoothstep, hexToRgb, mixRgb, shiftHsl, makeRamp,
} from "saintfall/core.js";

/* ============================================================
   PALETTE
   Authored in sRGB, because that is where eyes and reference
   images live. Conversion to linear happens once, at the point a
   value is handed to three - a colour that looks like a moderate
   brown in sRGB is far more chromatic in linear, and multiplying
   tints in the wrong space is how a palette drifts.
   ============================================================ */

const P = {
  /* sand */
  duneCrest: "#f8dfae",
  sandLit: "#e9ba79",
  sandMid: "#d59a58",
  sandWarm: "#c07f45",
  sandShade: "#9c5c3f",
  sandDeep: "#6b3a41",
  sandViolet: "#4e2c44",

  /* ash + black sand (Censer Works, Glass Scar approaches) */
  ashLit: "#6f6a68",
  ashMid: "#48423f",
  ashDeep: "#241f20",

  /* rock */
  rockLit: "#9a7660",
  rockMid: "#6a4c3e",
  rockShade: "#3f2b2b",
  basaltLit: "#4a4150",
  basaltMid: "#2f2937",
  basaltDeep: "#191521",

  /* the Saint: oxidised bronze and gold leaf */
  bronze: "#7e5c33",
  bronzeLit: "#a87f45",
  verdigris: "#4d8c74",
  verdigrisLit: "#82bda3",
  verdigrisDeep: "#28503f",
  gold: "#d8a441",
  goldLit: "#f6d585",
  goldDeep: "#8a601f",

  /* bone */
  bone: "#e6dbbd",
  boneLit: "#f6efd8",
  boneMid: "#c3b088",
  boneShade: "#8d7a5c",
  boneCold: "#b9c2c0",

  /* cloth and heraldry */
  oxblood: "#8a2230",
  crimson: "#c33a3c",
  crimsonLit: "#e8695c",
  ivory: "#efe6cf",
  indigo: "#2b3566",
  indigoLit: "#4b5a9c",

  /* iron */
  iron: "#3a3f47",
  ironLit: "#5c636d",
  ironDeep: "#20242a",
  rust: "#7d4a2e",
  rustLit: "#a86a3c",

  /* the Glass Scar */
  glassDeep: "#0e2229",
  glass: "#17414a",
  glassLit: "#3f8f92",
  glassEdge: "#79e2d4",

  /* the Bloom */
  chitinDeep: "#2a1c33",
  chitin: "#43304f",
  chitinLit: "#7a5a90",
  bioViolet: "#b568f5",
  bioCyan: "#54efd2",
  fleshy: "#8d4a63",

  /* fire */
  emberDeep: "#8c2606",
  ember: "#e0611a",
  emberLit: "#ffb057",
  flameCore: "#fff0c4",
};

export const PALETTE = P;

/* --------------------------- ramps --------------------------- */

/** Height/exposure ramp for open sand. Reads as one dune field
 *  rather than a flat plane, before a single light touches it. */
/**
 * Sand, from deep shade to wind-scoured crest.
 *
 * The dark end is a warm violet-brown, NOT a dark red. An earlier
 * table bottomed out at a saturated maroon, and once shadow and
 * baked occlusion multiplied into it the impact basin turned to
 * mud. Shadowed sand in reality is lit almost entirely by the sky,
 * so it goes violet and desaturated - it does not go to a darker
 * version of the sunlit hue.
 */
export const SAND_RAMP = makeRamp([
  [0.00, "#6b5070"],
  [0.13, "#7d5566"],
  [0.30, "#a06a54"],
  [0.48, P.sandWarm],
  [0.68, P.sandMid],
  [0.85, P.sandLit],
  [1.00, P.duneCrest],
]);

export const ROCK_RAMP = makeRamp([
  [0.00, P.rockShade],
  [0.35, P.rockMid],
  [0.72, P.rockLit],
  [1.00, "#c6a184"],
]);

export const BASALT_RAMP = makeRamp([
  [0.00, P.basaltDeep],
  [0.45, P.basaltMid],
  [0.80, P.basaltLit],
  [1.00, "#6d6178"],
]);

/**
 * Bone. Paler and COOLER than the sand it lies on, or the Ossuary
 * disappears: under a warm sun a warm khaki bone against warm sand
 * is the same colour, and 26 ribs the height of a building read as
 * texture. The grey-green cast is what separates them.
 */
export const BONE_RAMP = makeRamp([
  [0.00, "#7f7a70"],
  [0.34, "#a8a394"],
  [0.62, "#cdc8b4"],
  [0.84, "#e8e4d2"],
  [1.00, "#faf7ea"],
]);

export const ASH_RAMP = makeRamp([
  [0.00, P.ashDeep],
  [0.45, P.ashMid],
  [0.85, P.ashLit],
  [1.00, "#8b8480"],
]);

/**
 * Vitrified ground. Overwhelmingly DARK, with the teal reserved
 * for the fractured edges that catch the sky. A ramp whose middle
 * sat at a mid teal painted the whole crater apron the colour of a
 * swimming pool, and against warm sand that mixes to green.
 */
export const GLASS_RAMP = makeRamp([
  [0.00, "#0a171c"],
  [0.42, "#14262c"],
  [0.72, P.glass],
  [0.90, P.glassLit],
  [1.00, P.glassEdge],
]);

export const CHITIN_RAMP = makeRamp([
  [0.00, "#1d1326"],
  [0.34, P.chitinDeep],
  [0.62, P.chitin],
  [0.85, P.chitinLit],
  [1.00, "#b18ec6"],
]);

/**
 * Oxidised bronze. Weighted toward the metal rather than the
 * patina: a ramp that spent its bottom 40% in dark verdigris turned
 * the Saint into a black-green boulder, because most of a rounded
 * form faces away from the sun and lands in the ramp's lower half.
 * Verdigris survives only in the deepest recesses.
 */
/**
 * Oxidised bronze, patina to gold.
 *
 * The transition band is deliberately NARROW and pushed toward
 * grey. Interpolating straight from a blue-green verdigris to a
 * warm bronze passes through yellow-green, and on a 100m head that
 * band is most of the lit side - the Saint came out lime. Real
 * bronze does not have a lime state: the patina either survives or
 * it has been scoured off.
 */
export const BRONZE_RAMP = makeRamp([
  [0.00, "#2c4a46"],
  [0.24, "#3f7a66"],
  [0.46, "#5f9483"],
  [0.58, "#84876c"],
  [0.68, "#9c7f50"],
  [0.82, P.bronzeLit],
  [0.92, "#d0a35a"],
  [1.00, P.goldLit],
]);

/* ============================================================
   TIME OF DAY
   Each preset is a complete atmosphere: sun angle and colour, the
   three-band sky gradient, fog, and the grade. Districts push
   local tints on top, they never replace this.
   ============================================================ */

export const TIMES = {
  /* The default, and the one the level is composed for: a low sun
     raking across the dune field from the west-north-west so every
     ridge has a lit face and a violet shadow face. */
  goldenhour: {
    label: "Golden Hour",
    sunAzimuth: 288,
    sunElevation: 13.5,
    /* This key is why the figure cannot separate its materials.
       Measured on the player: 276,342 px land in hue 66-82 at mean
       chroma 26.3 whatever their albedo, because a saturated key
       imposes its own hue and a chroma floor on every surface. Two
       large albedo lifts moved the figure's lit luminance 51.2 ->
       51.8, and pulling verdigris to near-neutral moved its rendered
       chroma 26.6 -> 26.3. Per-material ramps have almost no
       authority here.

       Left alone deliberately: it lights the whole desert, and the
       level's look was built on it. Separating the FIGURE and keeping
       THIS key are in tension, and that is a level-wide art call, not
       a player-model tweak. */
    sunColor: "#ffd6a0",
    sunIntensity: 4.75,
    /* The blue end is deliberately LUMINOUS, not just saturated.
       Fill comes from a cosine convolution of this gradient, and a
       zenith at a tenth of the horizon's brightness contributes
       almost nothing to it - so every shadow in the level was lit
       by the orange horizon band and the entire frame came out one
       hue. Brightening the blue is what puts cool shadows under a
       warm sun, which is the whole colour idea. */
    skyZenith: "#4a74bc",
    skyHigh: "#8fa9d6",
    skyHorizon: "#eab077",
    skyLow: "#f8cb98",
    sunHalo: "#fff0cf",
    haloSpread: 0.24,
    // Warm on purpose. A cool lower hemisphere fights the sand and
    // drains the heat out of the entire frame - the COLOUR of the
    // term opposing the key matters far more than its level.
    groundBounce: "#a67a58",
    // Fill was at 0.92 against a key of 3.55 and the dunes came out
    // flat: with a low sun most of the ground sits near dot(N,L) of
    // 0.2, so the fill was over half the light on the average pixel.
    envIntensity: 0.52,
    fogDensity: 0.00040,
    fogHeightFalloff: 0.0085,
    fogStart: 85,
    sunScatter: 1.15,
    exposure: 1.02,
    grade: "warm",
  },

  noon: {
    label: "High Sun",
    sunAzimuth: 214,
    sunElevation: 62,
    sunColor: "#fff4dd",
    sunIntensity: 4.1,
    skyZenith: "#20489c",
    skyHigh: "#5c85cc",
    skyHorizon: "#d5d3c0",
    skyLow: "#efe0bd",
    sunHalo: "#ffffff",
    haloSpread: 0.11,
    groundBounce: "#d8a86a",
    envIntensity: 1.0,
    fogDensity: 0.00030,
    fogHeightFalloff: 0.011,
    fogStart: 90,
    sunScatter: 0.55,
    exposure: 0.98,
    grade: "bleach",
  },

  dusk: {
    label: "Vespers",
    sunAzimuth: 297,
    sunElevation: 2.2,
    sunColor: "#ff9a5e",
    sunIntensity: 2.5,
    skyZenith: "#241a4d",
    skyHigh: "#553a7a",
    skyHorizon: "#e2694f",
    skyLow: "#ffb173",
    sunHalo: "#ffd9a0",
    haloSpread: 0.34,
    groundBounce: "#8a4a58",
    envIntensity: 0.72,
    fogDensity: 0.00062,
    fogHeightFalloff: 0.0070,
    fogStart: 40,
    sunScatter: 1.65,
    exposure: 1.12,
    grade: "dusk",
  },

  /* Moonlight, not blackout. A first pass ran the key at 0.62 with
     fill at 0.34 and the whole map crushed to silhouette - the
     Bloom's bioluminescence, which is the single best thing night
     has to offer, registered as four cyan specks on a black frame.
     A night scene still needs a readable ground for its emitters
     to have somewhere to sit. */
  night: {
    label: "The Long Dark",
    sunAzimuth: 96,
    sunElevation: 16,
    sunColor: "#9fb8e8",
    sunIntensity: 2.1,
    skyZenith: "#0d1430",
    skyHigh: "#1c2a52",
    skyHorizon: "#3a4674",
    skyLow: "#4b4d76",
    sunHalo: "#cfe0ff",
    haloSpread: 0.16,
    groundBounce: "#3a3a5e",
    envIntensity: 1.05,
    fogDensity: 0.00052,
    fogHeightFalloff: 0.0080,
    fogStart: 30,
    sunScatter: 0.5,
    // Night scenes are always heavily lifted. Working the numbers
    // through the BRDF and the tone curve, a physically plausible
    // moonlit desert lands at a frame luma near 30 - which is a
    // black rectangle. The exposure here is a display decision, not
    // a physical one; the BLUE of the grade is what says "night".
    exposure: 2.6,
    grade: "night",
  },

  storm: {
    label: "Ochre Front",
    sunAzimuth: 288,
    sunElevation: 19,
    sunColor: "#e8b27a",
    sunIntensity: 1.55,
    skyZenith: "#8a6338",
    skyHigh: "#b4834b",
    skyHorizon: "#d9a45f",
    skyLow: "#e6bd86",
    sunHalo: "#ffe0ae",
    haloSpread: 0.5,
    groundBounce: "#a8763f",
    envIntensity: 0.8,
    fogDensity: 0.0031,
    fogHeightFalloff: 0.0045,
    fogStart: 8,
    sunScatter: 0.9,
    exposure: 1.02,
    grade: "storm",
  },
};

/* A full Vesper day is deliberately shorter than a terrestrial one:
   one ordinary operation can cross the whole arc, while each change
   remains slow enough to be felt as weather rather than a filter
   switch. Phase zero is 06:00 local time. The final repeated dawn
   stop makes the wrap mathematically and visually continuous. */
export const DAY_CYCLE_SECONDS = 18 * 60;
export const DAY_CYCLE_STOPS = Object.freeze([
  Object.freeze({ phase: 0.00, key: "goldenhour", sunAzimuth: 108, sunElevation: 13.5 }),
  Object.freeze({ phase: 0.25, key: "noon", sunAzimuth: 214, sunElevation: 62 }),
  Object.freeze({ phase: 0.50, key: "dusk", sunAzimuth: 297, sunElevation: 2.2 }),
  Object.freeze({ phase: 0.72, key: "night", sunAzimuth: 96, sunElevation: 16 }),
  Object.freeze({ phase: 1.00, key: "goldenhour", sunAzimuth: 108, sunElevation: 13.5 }),
]);

/* --------------------------- grades --------------------------- */

/**
 * Film grades. `lift/gamma/gain` per channel, plus saturation and a
 * split-tone. Applied in the composite pass, after tone mapping,
 * which is where a grade belongs - a curve applied before the
 * highlight rolloff just moves the clipping point around.
 */
export const GRADES = {
  warm: {
    /* The black floor, and the reason every shadow on the figure
       measured magenta no matter what lit it. At [0.022, 0.014,
       0.040] blue is lifted 2.9x green, so EVERY dark pixel in the
       game converges on rgb(41,34,55) - decode the lift and that is
       exactly the pauldron shadow that three rounds of review kept
       reporting. The rim term, the sky IBL and the split-tone shadow
       tint were each blamed for it in turn and each changed nothing,
       because none of them is what a pixel approaches as it goes
       dark. Keep the lift COOL - shade should not be the same hue as
       key light - but not tinted. */
    /* Lift is the BLACK FLOOR: nothing in the frame can render
       darker than what this decodes to. At [0.026, 0.021, 0.030]
       that floor was L17, which is exactly where the figure's 5th
       percentile landed no matter how dark its vertex colours went -
       the plate junctions had nowhere to go. The reference reaches
       L2. Kept very slightly cool and very slightly lifted off zero
       so shadows read as air rather than as holes. */
    lift: [0.013, 0.011, 0.015],
    gamma: [1.0, 1.015, 1.06],
    gain: [1.06, 1.005, 0.94],
    /* Re-measured. The "plates' 16.4" this was cut against came from
       a sample where ten of thirteen boxes were off-component - one
       "torso" was the gold sash, one "thigh" was teal glass ground.
       Cropped and eye-checked, the reference ARMOUR is chroma 24.9
       (a* +11.8, L 46.8) and the render is 28.3: about 14% over, not
       80%. Cutting to 0.88 was an overcorrection driven by bad data,
       and it is what made the figure read as flat warm olive. */
    /* 1.00. This was cut to 0.75 to bring the FIGURE's chroma down to
       the plate's absolute C 24.9 - but it desaturates the whole
       frame, so the render's sand landed at C 35.7 against the
       concept's C 62.4. Matching the figure while letting the world
       fall 43% short crushed every accent that should reach C 49-70
       down to C 24-36: the correction was applied at the wrong stage.

       Swept at runtime on the hero setup: at 1.00 the figure measures
       C p50 33.3 / p95 55 against the concept figure's 33.7 / 66, and
       L p50 is UNCHANGED at 42 across the entire sweep - it costs
       nothing in value structure. Still 11 points short of the plates
       at p95, so this is the conservative end. */
    saturation: 1.00,
    /* Was #5a3f8a at 0.34 - a 46%-saturation violet. While the LIFT
       floor was broken this tint measured as changing nothing, and a
       comment here recorded that null result. It was only true while
       something larger dominated: with the lift neutralised this
       became the main remaining source, holding the shadowed lower
       body at hue 280-338 where the reference holds one hue from
       highlight through to black. A null result measured under a
       broken variable is not a null result. */
    shadowTint: "#3a3630",
    /* Left alone: neutralising this moved the figure's armour hue by
       ZERO (73 before, 73 after). Fourth lever tested against the
       key-light finding, fourth one inert. */
    highlightTint: "#ffe0a8",
    tint: 0.16,
    contrast: 1.04,
  },
  bleach: {
    lift: [0.010, 0.010, 0.018],
    gamma: [1.0, 1.0, 1.02],
    gain: [1.02, 1.0, 0.98],
    saturation: 0.96,
    shadowTint: "#39406a",
    highlightTint: "#fff6e2",
    tint: 0.20,
    contrast: 1.10,
  },
  dusk: {
    lift: [0.022, 0.008, 0.036],
    gamma: [0.98, 1.02, 1.05],
    gain: [1.10, 0.985, 0.96],
    /* Vespers used to push every armour material into the same
       magenta-black band.  The sky already supplies the violet/red
       identity; the grade now leaves enough chroma separation for
       ivory, patina and amber to remain distinct in active play. */
    saturation: 0.98,
    shadowTint: "#3a2160",
    highlightTint: "#ffd2a0",
    tint: 0.22,
    contrast: 1.02,
  },
  night: {
    lift: [0.008, 0.012, 0.030],
    gamma: [1.05, 1.02, 0.96],
    gain: [0.92, 0.97, 1.10],
    saturation: 1.05,
    shadowTint: "#111c40",
    highlightTint: "#cfe2ff",
    tint: 0.36,
    contrast: 1.12,
  },
  storm: {
    lift: [0.030, 0.020, 0.012],
    gamma: [1.0, 1.01, 1.03],
    gain: [1.06, 1.0, 0.90],
    saturation: 0.88,
    shadowTint: "#5a3a24",
    highlightTint: "#ffe3b4",
    tint: 0.34,
    contrast: 0.98,
  },
};

/* ============================================================
   ATMOSPHERE
   The shared state every shader reads. One object, updated once
   per frame, so the sky dome, the terrain, the props and the
   composite pass can never disagree about where the sun is.

   That disagreement is not hypothetical: a sibling project spent
   a full review round with its shadows raked at 8 degrees while
   the sky drew the sun at 48, because two modules each owned a
   piece of the light. Here, exactly one function writes it.
   ============================================================ */

export function makeAtmosphere(THREE, timeKey = "goldenhour", options = {}) {
  const initialStop = DAY_CYCLE_STOPS.find((stop) => stop.key === timeKey)
    || DAY_CYCLE_STOPS[0];
  const requestedPhase = Number(options.phase);
  const cycleDuration = Math.max(60, Number(options.duration) || DAY_CYCLE_SECONDS);
  const state = {
    THREE,
    time: timeKey,
    preset: TIMES[timeKey] || TIMES.goldenhour,
    /** Blend factor toward the storm preset, 0..1, driven by weather. */
    storm: 0,
    windDir: new THREE.Vector2(-0.82, 0.57).normalize(),
    windSpeed: 1.0,
    elapsed: 0,

    /** Natural time. Phase zero is 06:00, so 0.25/0.5/0.75 map to
     *  noon/18:00/midnight. QA and explicit `?time=` views can freeze
     *  it without introducing a separate lighting implementation. */
    cyclePhase: Number.isFinite(requestedPhase)
      ? ((requestedPhase % 1) + 1) % 1 : initialStop.phase,
    cycleDuration,
    cycleRunning: options.cycle !== false,
    cycleCount: Math.max(0, Math.floor(Number(options.cycleCount) || 0)),
    cycleFrom: timeKey,
    cycleTo: timeKey,
    cycleBlend: 0,
    solarHour: 6,
    daylightFactor: timeKey === "night" ? 0 : 1,
    goldenFactor: timeKey === "goldenhour" ? 1 : 0,
    duskFactor: timeKey === "dusk" ? 1 : 0,
    nightFactor: timeKey === "night" ? 1 : 0,

    sunDir: new THREE.Vector3(),          // points FROM the world TOWARD the sun
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    skyZenith: new THREE.Color(),
    skyHigh: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    skyLow: new THREE.Color(),
    sunHalo: new THREE.Color(),
    groundBounce: new THREE.Color(),
    haloSpread: 0.25,
    envIntensity: 1,
    fogDensity: 0.0005,
    fogHeightFalloff: 0.008,
    fogStart: 50,
    sunScatter: 1,
    exposure: 1,
    grade: GRADES.warm,

    /** Uniform block shared by every patched material. One object,
     *  so a single write updates the entire world. */
    uniforms: null,
  };

  const CYCLE_SAMPLE_SECONDS = 0.25;
  let cycleSampleClock = 0;
  let manualKey = TIMES[timeKey] ? timeKey : "goldenhour";

  state.uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunHalo: { value: new THREE.Color() },
    uSkyZenith: { value: new THREE.Color() },
    uSkyHigh: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSkyLow: { value: new THREE.Color() },
    uFog: { value: new THREE.Vector4(0.0005, 0.008, 50, 1.0) }, // density, heightFalloff, start, scatter
    uRim: { value: new THREE.Vector3(0.16, 2.6, 1.0) },          // strength, power, unused
    uTimeSF: { value: 0 },
    uWind: { value: new THREE.Vector3(-0.82, 0.57, 1.0) },       // x, z, speed
    uGlitter: { value: new THREE.Vector2(0.0, 60.0) },           // strength, falloff distance
    uStorm: { value: 0 },
  };

  const wrap01 = (value) => ((value % 1) + 1) % 1;
  const setC = (target, rgb) => target.setRGB(
    srgb(rgb[0]), srgb(rgb[1]), srgb(rgb[2]), THREE.LinearSRGBColorSpace
  );
  const direction = (target, azimuth, elevation) => {
    const az = azimuth * Math.PI / 180;
    const el = elevation * Math.PI / 180;
    return target.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    ).normalize();
  };

  function resolve(baseA, baseB, blend, stormMix, directionA = baseA, directionB = baseB) {
    const t = clamp01(blend);
    const s = clamp01(stormMix);
    const storm = TIMES.storm;
    const num = (key) => lerp(lerp(baseA[key], baseB[key], t), storm[key], s);
    const col = (key) => {
      const between = mixRgb(hexToRgb(baseA[key]), hexToRgb(baseB[key]), t);
      return mixRgb(between, hexToRgb(storm[key]), s);
    };

    /* Interpolate azimuth and elevation, not two unit vectors. The
       dusk key and the night moon sit on opposite horizons; a great-
       circle vector blend lifts their midpoint overhead, making the
       shadows race through noon at 20:30. The angular path keeps the
       handoff low across the northern sky, where a setting sun really
       gives way to a rising moon. */
    const azA = directionA.sunAzimuth;
    const azB = directionB.sunAzimuth;
    const azDelta = ((azB - azA + 540) % 360) - 180;
    direction(state.sunDir,
      azA + azDelta * t,
      lerp(directionA.sunElevation, directionB.sunElevation, t));

    setC(state.sunColor, col("sunColor"));
    state.sunIntensity = num("sunIntensity");
    setC(state.skyZenith, col("skyZenith"));
    setC(state.skyHigh, col("skyHigh"));
    setC(state.skyHorizon, col("skyHorizon"));
    setC(state.skyLow, col("skyLow"));
    setC(state.sunHalo, col("sunHalo"));
    setC(state.groundBounce, col("groundBounce"));
    state.haloSpread = num("haloSpread");
    state.envIntensity = num("envIntensity");
    state.fogDensity = num("fogDensity");
    state.fogHeightFalloff = num("fogHeightFalloff");
    state.fogStart = num("fogStart");
    state.sunScatter = num("sunScatter");
    state.exposure = num("exposure");
    const baseGrade = blendGrade(
      GRADES[baseA.grade] || GRADES.warm,
      GRADES[baseB.grade] || GRADES.warm,
      t
    );
    state.grade = blendGrade(baseGrade, GRADES.storm, s);
    sync();
    return state;
  }

  function sampleCycle(phase = state.cyclePhase) {
    const p = wrap01(phase);
    let from = DAY_CYCLE_STOPS[0];
    let to = DAY_CYCLE_STOPS[1];
    for (let i = 0; i < DAY_CYCLE_STOPS.length - 1; i += 1) {
      if (p >= DAY_CYCLE_STOPS[i].phase && p < DAY_CYCLE_STOPS[i + 1].phase) {
        from = DAY_CYCLE_STOPS[i];
        to = DAY_CYCLE_STOPS[i + 1];
        break;
      }
    }
    const linear = (p - from.phase) / Math.max(0.0001, to.phase - from.phase);
    const blend = smoothstep(linear);
    return { phase: p, from, to, blend };
  }

  function applyCycle(phase = state.cyclePhase) {
    const sample = sampleCycle(phase);
    state.cyclePhase = sample.phase;
    state.cycleFrom = sample.from.key;
    state.cycleTo = sample.to.key;
    state.cycleBlend = sample.blend;
    state.solarHour = (6 + sample.phase * 24) % 24;
    state.time = sample.blend < 0.5 ? sample.from.key : sample.to.key;
    state.preset = TIMES[state.time] || TIMES.goldenhour;
    const weight = (key) => (sample.from.key === key ? 1 - sample.blend : 0)
      + (sample.to.key === key ? sample.blend : 0);
    state.duskFactor = clamp01(weight("dusk"));
    state.nightFactor = clamp01(weight("night"));
    state.goldenFactor = clamp01(weight("goldenhour"));
    state.daylightFactor = clamp01(1 - state.nightFactor);
    return resolve(
      TIMES[sample.from.key], TIMES[sample.to.key], sample.blend, state.storm,
      sample.from, sample.to
    );
  }

  /** Apply a named preset as a deliberate fixed review/preview mode. */
  function apply(key = state.time, stormMix = state.storm) {
    const base = TIMES[key] || TIMES.goldenhour;
    manualKey = TIMES[key] ? key : "goldenhour";
    state.cycleRunning = false;
    state.time = manualKey;
    state.preset = base;
    state.storm = clamp01(stormMix);
    state.cycleFrom = manualKey;
    state.cycleTo = manualKey;
    state.cycleBlend = 0;
    state.duskFactor = manualKey === "dusk" ? 1 : 0;
    state.nightFactor = manualKey === "night" ? 1 : 0;
    state.goldenFactor = manualKey === "goldenhour" ? 1 : 0;
    state.daylightFactor = 1 - state.nightFactor;
    const stop = DAY_CYCLE_STOPS.find((entry) => entry.key === manualKey);
    if (stop) {
      state.cyclePhase = stop.phase;
      state.solarHour = (6 + stop.phase * 24) % 24;
    }
    return resolve(base, base, 0, state.storm);
  }

  function setCyclePhase(phase, running = state.cycleRunning, cycleCount = state.cycleCount) {
    state.cyclePhase = wrap01(Number(phase) || 0);
    state.cycleRunning = !!running;
    state.cycleCount = Math.max(0, Math.floor(Number(cycleCount) || 0));
    cycleSampleClock = 0;
    return applyCycle(state.cyclePhase);
  }

  function setCycleRunning(running = true) {
    state.cycleRunning = !!running;
    if (state.cycleRunning) applyCycle(state.cyclePhase);
    return state.cycleRunning;
  }

  function setStorm(stormMix = 0) {
    state.storm = clamp01(stormMix);
    return state.cycleRunning ? applyCycle(state.cyclePhase)
      : resolve(TIMES[manualKey] || TIMES.goldenhour,
        TIMES[manualKey] || TIMES.goldenhour, 0, state.storm);
  }

  /** Push state into the shared uniform block. */
  function sync() {
    const u = state.uniforms;
    u.uSunDir.value.copy(state.sunDir);
    u.uSunHalo.value.copy(state.sunHalo);
    u.uSkyZenith.value.copy(state.skyZenith);
    u.uSkyHigh.value.copy(state.skyHigh);
    u.uSkyHorizon.value.copy(state.skyHorizon);
    u.uSkyLow.value.copy(state.skyLow);
    u.uFog.value.set(state.fogDensity, state.fogHeightFalloff, state.fogStart, state.sunScatter);
    u.uTimeSF.value = state.elapsed;
    u.uWind.value.set(state.windDir.x, state.windDir.y, state.windSpeed);
    u.uStorm.value = state.storm;
  }

  function update(dt) {
    state.elapsed += dt;
    state.uniforms.uTimeSF.value = state.elapsed;
    if (!state.cycleRunning || dt <= 0) return false;
    const turns = state.cyclePhase + dt / state.cycleDuration;
    if (turns >= 1) state.cycleCount += Math.floor(turns);
    state.cyclePhase = wrap01(turns);
    cycleSampleClock += dt;
    if (cycleSampleClock < CYCLE_SAMPLE_SECONDS) return false;
    cycleSampleClock %= CYCLE_SAMPLE_SECONDS;
    applyCycle(state.cyclePhase);
    return true;
  }

  function cycleStatus() {
    return {
      phase: Number(state.cyclePhase.toFixed(6)),
      duration: state.cycleDuration,
      running: state.cycleRunning,
      cycleCount: state.cycleCount,
      solarHour: Number(state.solarHour.toFixed(3)),
      from: state.cycleFrom,
      to: state.cycleTo,
      blend: Number(state.cycleBlend.toFixed(4)),
      time: state.time,
      daylight: Number(state.daylightFactor.toFixed(4)),
      golden: Number(state.goldenFactor.toFixed(4)),
      dusk: Number(state.duskFactor.toFixed(4)),
      night: Number(state.nightFactor.toFixed(4)),
    };
  }

  /** Linear-space sky colour for a world-space direction. The sky
   *  dome, the aerial perspective and the IBL all call this so they
   *  cannot drift apart. */
  function skyAt(dirX, dirY, dirZ) {
    const h = clamp01(dirY * 0.5 + 0.5);
    const low = state.skyLow;
    const hor = state.skyHorizon;
    const hi = state.skyHigh;
    const zen = state.skyZenith;
    let r; let g; let b;
    if (h < 0.5) {
      const t = smoothstep(clamp01(h / 0.5));
      r = lerp(low.r, hor.r, t); g = lerp(low.g, hor.g, t); b = lerp(low.b, hor.b, t);
    } else if (h < 0.72) {
      const t = smoothstep(clamp01((h - 0.5) / 0.22));
      r = lerp(hor.r, hi.r, t); g = lerp(hor.g, hi.g, t); b = lerp(hor.b, hi.b, t);
    } else {
      const t = smoothstep(clamp01((h - 0.72) / 0.28));
      r = lerp(hi.r, zen.r, t); g = lerp(hi.g, zen.g, t); b = lerp(hi.b, zen.b, t);
    }
    const mu = clamp01(dirX * state.sunDir.x + dirY * state.sunDir.y + dirZ * state.sunDir.z);
    const halo = Math.pow(mu, lerp(64, 3, state.haloSpread)) * state.sunScatter;
    const wide = Math.pow(mu, 3.0) * 0.16 * state.sunScatter;
    return [
      r + state.sunHalo.r * (halo + wide),
      g + state.sunHalo.g * (halo + wide),
      b + state.sunHalo.b * (halo + wide),
    ];
  }

  state.apply = apply;
  state.applyCycle = applyCycle;
  state.setCyclePhase = setCyclePhase;
  state.setCycleRunning = setCycleRunning;
  state.setStorm = setStorm;
  state.cycleStatus = cycleStatus;
  state.sync = sync;
  state.update = update;
  state.skyAt = skyAt;
  if (state.cycleRunning && timeKey !== "storm") applyCycle(state.cyclePhase);
  else apply(timeKey, timeKey === "storm" ? 1 : 0);
  return state;
}

const srgb = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function blendGrade(a, b, t) {
  if (t <= 0.0001) return a;
  const arr = (x, y) => x.map((v, i) => lerp(v, y[i], t));
  const hex = (x, y) => {
    const c = mixRgb(hexToRgb(x), hexToRgb(y), t);
    return `#${[0, 1, 2].map((i) => Math.round(clamp01(c[i]) * 255).toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    lift: arr(a.lift, b.lift),
    gamma: arr(a.gamma, b.gamma),
    gain: arr(a.gain, b.gain),
    saturation: lerp(a.saturation, b.saturation, t),
    shadowTint: hex(a.shadowTint, b.shadowTint),
    highlightTint: hex(a.highlightTint, b.highlightTint),
    tint: lerp(a.tint, b.tint, t),
    contrast: lerp(a.contrast, b.contrast, t),
  };
}

/* ============================================================
   SHADER INJECTION

   Every world material gets the same two additions:

     1. A sky-tinted rim, so silhouettes separate from whatever is
        behind them. Low-poly geometry lives or dies on silhouette.
     2. Directional aerial perspective. Not a fog colour - the
        actual sky in the direction you are looking, including the
        sun's forward scatter, with a height falloff so haze pools
        in the basins and thins over the ridges.

   Written against the standard material's chunk names so shadows,
   IBL and instancing all keep working. Anchored after
   `opaque_fragment`, where the value is still linear: the scene
   renders to a linear HDR target and does its tone mapping and
   sRGB encode once, in the composite pass. Encoding twice is the
   classic way to turn mid grey into milk.
   ============================================================ */

const ATMOS_PARS = /* glsl */`
uniform vec3  uSunDir;
uniform vec3  uSunHalo;
uniform vec3  uSkyZenith;
uniform vec3  uSkyHigh;
uniform vec3  uSkyHorizon;
uniform vec3  uSkyLow;
uniform vec4  uFog;     // density, heightFalloff, start, sunScatter
uniform vec3  uRim;     // strength, power, -
uniform float uTimeSF;
uniform vec3  uWind;
uniform vec2  uGlitter; // strength, falloff distance
uniform float uStorm;
varying vec3  vSFWorld;

vec3 sfSky(vec3 rd) {
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c;
  if (h < 0.5) {
    c = mix(uSkyLow, uSkyHorizon, smoothstep(0.0, 1.0, h / 0.5));
  } else if (h < 0.72) {
    c = mix(uSkyHorizon, uSkyHigh, smoothstep(0.0, 1.0, (h - 0.5) / 0.22));
  } else {
    c = mix(uSkyHigh, uSkyZenith, smoothstep(0.0, 1.0, (h - 0.72) / 0.28));
  }
  float mu = max(dot(rd, uSunDir), 0.0);
  // Two lobes: a tight halo around the disc and a broad forward
  // scatter that lifts the whole sunward half of the sky.
  c += uSunHalo * (pow(mu, 26.0) * 0.55 + pow(mu, 3.0) * 0.16) * uFog.w;
  return c;
}
`;

const ATMOS_VERT = /* glsl */`
  vSFWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

/* Aerial perspective alone, with no reference to `normal` or
   `vViewPosition`. MeshBasicMaterial's fragment shader declares
   neither, so the full block below will not compile against it. */
const ATMOS_FRAG_BASIC = /* glsl */`
{
  vec3 toEye = cameraPosition - vSFWorld;
  float sfDist = length(toEye);
  vec3 rd = -toEye / max(sfDist, 1e-4);
  float baseY = min(vSFWorld.y, cameraPosition.y);
  float hFac  = exp(-max(0.0, baseY - 2.0) * uFog.y);
  float d     = max(0.0, sfDist - uFog.z);
  float f     = clamp(1.0 - exp(-pow(d * uFog.x, 1.62) * hFac), 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, sfSky(rd), f * uRim.z);
}
`;

/* The additive variant: distance attenuates toward zero, which for
   additive blending is invisibility. */
const ATMOS_FRAG_ADDITIVE = /* glsl */`
{
  float sfDist = length(cameraPosition - vSFWorld);
  float baseY = min(vSFWorld.y, cameraPosition.y);
  float hFac  = exp(-max(0.0, baseY - 2.0) * uFog.y);
  float d     = max(0.0, sfDist - uFog.z);
  float f     = clamp(1.0 - exp(-pow(d * uFog.x, 1.62) * hFac), 0.0, 1.0);

  /* NEAR FADE, and it is not a polish pass - it is what stops a
     volume the camera has walked INSIDE from painting itself across
     the whole screen.

     A light shaft is a cone. Stand inside one and its far shell
     fills the frame, and because the shell is additive it arrives as
     a flat translucent sheet with a hard polygon edge - which is
     exactly what the nave review frame was: a white chevron spanning
     corner to corner over the floor, the columns and the crossing,
     read by everyone who saw it as a rendering fault. The shafts
     were not too bright so much as too CLOSE.

     Every additive volume in the game wants this, so it lives here
     rather than in the shaft builder: dust plumes, beacon beams and
     glow cards all have the same failure the moment a player stands
     in them. */
  gl_FragColor.rgb *= (1.0 - f * uRim.z) * smoothstep(0.6, 11.0, sfDist);
}
`;

const ATMOS_FRAG = /* glsl */`
{
  vec3 toEye = cameraPosition - vSFWorld;
  float sfDist = length(toEye);
  vec3 rd = -toEye / max(sfDist, 1e-4);

  // --- sky-tinted rim ------------------------------------------------
  // At this point "normal" holds the final shading normal, so a
  // flat-shaded facet gets a facet-accurate rim, not a smoothed one.
  // (No backticks in this string: it is a template literal, and a
  // stray backtick inside a GLSL comment terminates it early.)
  vec3 vDir = normalize(vViewPosition);
  float fres = 1.0 - clamp(dot(normal, vDir), 0.0, 1.0);
  vec3 rimCol = sfSky(vec3(rd.x, max(rd.y, 0.05) + 0.06, rd.z));
  gl_FragColor.rgb += rimCol * pow(fres, uRim.y) * uRim.x;

  // --- directional aerial perspective ---------------------------------
  // Haze pools low and thins with altitude, so a ridge line stays
  // legible against the basin behind it.
  float baseY = min(vSFWorld.y, cameraPosition.y);
  float hFac  = exp(-max(0.0, baseY - 2.0) * uFog.y);
  float d     = max(0.0, sfDist - uFog.z);
  // Exponent above 1 keeps the near and middle field clear and puts
  // the whole falloff out at range. At 1.28 the mid-field lost all
  // its separation and every landmark between 300m and 900m turned
  // into the same cream silhouette.
  float f     = 1.0 - exp(-pow(d * uFog.x, 1.62) * hFac);
  f = clamp(f, 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, sfSky(rd), f);
}
`;

/* ============================================================
   AEOLIAN RIPPLES

   Sand is 50-70% of every frame in this game and it was carrying
   almost no information: a review of all 21 authored poses found
   half of them dominated by one smooth untextured dune face, and a
   10x crop of the worst (`fosse`) is a flat brown wash with faint
   8-bit banding in it and nothing else. No amount of work on the
   things STANDING on the sand can fix a frame that is mostly sand.

   The terrain grid is 4m at its finest LOD, so ripples cannot be
   geometry - 30cm relief is two orders of magnitude below the mesh.
   They are shading relief instead: three sine trains perturbing the
   NORMAL, so a 13-degree sun rakes across them and produces real
   lit and shadowed faces rather than a painted pattern.

   Three things make this hold up rather than turn into corduroy:

   1. IT IS ANTIALIASED ANALYTICALLY. `fwidth(phase)` is how many
      radians of ripple fall in one pixel; past about one the train
      is sub-pixel and any amount of it is aliasing. Amplitude is
      divided by (1 + w^2), so each train fades itself out at its
      own range and the far field stays clean. This project has
      already recorded the opposite approach failing - a screen-space
      bump cannot antialias itself, and guarding it with `fwidth` of
      the same aliased signal does not help. The difference here is
      that the signal is a SINE with a known phase, so its screen
      derivative is exact rather than sampled.

   2. THREE SCALES, so something is always in its good range: 0.75m
      carries the ground at your feet, 4.2m the middle distance, 22m
      the big empty dune faces that were the actual complaint.

   3. AMPLITUDE FALLS OFF WITH SLOPE. Ripples form on gentle
      windward slopes and are wiped off slip faces at the angle of
      repose. Without this the pattern climbs vertical rock and
      instantly reads as a texture rather than as a surface.
   ============================================================ */
const DUNE_PARS = /* glsl */`
uniform vec4 uDuneA;   // k1, slope1, k2, slope2
uniform vec4 uDuneB;   // k3, slope3, crest albedo, -
`;

const DUNE_FRAG = /* glsl */`
#include <normal_fragment_maps>
{
  vec3 sfWN = inverseTransformDirection(normal, viewMatrix);
  // Gentle ground only. 0.42-0.88 in world-normal Y is roughly
  // 28-65 degrees of slope fading out; the slip faces keep their
  // clean sweep, which is what makes them read as slip faces.
  float sfFlat = smoothstep(0.42, 0.88, sfWN.y);
  if (sfFlat > 0.002) {
    vec2 p = vSFWorld.xz;
    // A fixed prevailing wind. Ripple crests run ACROSS it, so the
    // phase advances along it. Constant rather than uniform: the
    // dust wind animates, and ripples that swung with it would read
    // as the whole desert rotating.
    const vec2 wdir = vec2(0.947, 0.322);
    const vec2 wper = vec2(-0.322, 0.947);
    float along = dot(p, wdir);
    float across = dot(p, wper);

    // Meander. Straight parallel crests are corduroy; two slow
    // lateral wobbles at incommensurate rates make them wander the
    // way a real ripple field does.
    float wob = sin(across * 0.085) * 2.6 + sin(across * 0.0295) * 4.4
              + sin(across * 0.0121 + along * 0.006) * 6.2;

    /* All three trains run along EXACTLY the same heading, and each
       carries its own meander.

       They started 46 degrees apart, which is woven corduroy - a
       regular cross-hatch a 10x crop showed plainly. Bringing them
       within 15 degrees fixed the near field and left a subtler
       version of the same fault at grazing angles: at a shallow
       viewing angle, 15 degrees of world-space heading becomes most
       of a right angle on screen, so the coarse train printed
       near-horizontal lines across the fine one and the far ground
       went plaid.

       Strictly parallel, then. A real ripple field is strongly
       directional and its variety comes from the MEANDER and the
       three SCALES, never from three headings. */
    float ph1 = along * uDuneA.x + wob;
    float ph2 = along * uDuneA.z + wob * 0.45 + sin(across * 0.042) * 1.7;
    float ph3 = along * uDuneB.x
              + sin(across * 0.0075) * 2.8 + sin(across * 0.019) * 1.5;

    float w1 = fwidth(ph1);
    float w2 = fwidth(ph2);
    float w3 = fwidth(ph3);
    float a1 = 1.0 / (1.0 + w1 * w1 * 0.85);
    float a2 = 1.0 / (1.0 + w2 * w2 * 0.85);
    float a3 = 1.0 / (1.0 + w3 * w3 * 0.85);

    /* Skewed, not sinusoidal. A wind ripple has a long gentle stoss
       side and a short steep lee side, and the second harmonic is
       what puts the crest where the wind would leave it. It is faded
       by a1 SQUARED because it carries twice the frequency and so
       reaches pixel scale at half the distance. */
    float s1 = (cos(ph1) + 0.45 * cos(ph1 * 2.0) * a1) * uDuneA.y * a1;
    float s2 = cos(ph2) * uDuneA.w * a2;
    float s3 = cos(ph3) * uDuneB.y * a3;

    vec3 g = vec3(wdir.x * s1 + (wdir.x * 0.951 + wper.x * 0.309) * s2
                  + (wdir.x * 0.883 - wper.x * 0.469) * s3,
                  0.0,
                  wdir.y * s1 + (wdir.y * 0.951 + wper.y * 0.309) * s2
                  + (wdir.y * 0.883 - wper.y * 0.469) * s3);
    sfWN = normalize(sfWN - g * sfFlat);
    normal = normalize((viewMatrix * vec4(sfWN, 0.0)).xyz);

    // Crests run a shade paler: wind sorts the coarse pale grains
    // up onto them and leaves the fines in the troughs. Small, but
    // it is what stops the relief reading as pure lighting.
    float crest = sin(ph1) * a1 * 0.65 + sin(ph3) * a3 * 0.35;
    diffuseColor.rgb *= 1.0 + crest * sfFlat * uDuneB.z;
  }
}
`;

/* Bioluminescence, carried in COLOR_0's FOURTH CHANNEL.

   Nothing in SAINTFALL is transparent, so vertex alpha was an unused
   channel on every mesh in the game, and an unused channel is a free
   mask. The bestiary paints it: 1.0 on a compound eye, 0.55 on the
   membrane between two plates, 0 on chitin. Here that mask adds the
   vertex's own colour back as emission.

   The alternative was a second material for the glowing parts, which
   is a second draw call PER INSTANCE - a hundred-odd enemies would
   have paid a hundred-odd extra draws for a few hundred pixels of
   eye. This costs three lines of GLSL and nothing per instance.

   `diffuseColor.a` is forced back to 1 immediately, because three
   multiplies vColor into diffuseColor wholesale and the alpha would
   otherwise land in the framebuffer's alpha channel. */
const BIO_FRAG_COLOR = /* glsl */`
#include <color_fragment>
#ifdef USE_COLOR_ALPHA
  vec3 sfBio = diffuseColor.rgb * vColor.a * uBio;
  diffuseColor.a = 1.0;
#else
  vec3 sfBio = vec3(0.0);
#endif
`;

const BIO_FRAG_EMIT = /* glsl */`
#include <emissivemap_fragment>
totalEmissiveRadiance += sfBio;
`;

/**
 * Patch a material so it participates in the shared atmosphere.
 * Safe to call twice; the second call is a no-op.
 *
 * `opts.rim` scales the rim for that surface (cloth wants more,
 * sand wants less). `opts.glitter` turns on the dune sparkle.
 * `opts.bio` turns on vertex-alpha emission and sets its strength;
 * above 1 the emitter clears the bloom chain's bright threshold and
 * actually blooms, which is the whole point of a lit eye.
 * `opts.dunes` scales the aeolian ripple relief; 0 turns it off.
 */
export function patchMaterial(material, atmos, opts = {}) {
  if (!material || material.userData.sfPatched) return material;
  material.userData.sfPatched = true;
  material.userData.sfBasic = false;

  const rimScale = opts.rim === undefined ? 1 : opts.rim;
  const glitter = opts.glitter || 0;
  const bio = opts.bio || 0;
  const dunes = opts.dunes || 0;
  material.userData.sfRim = rimScale;
  material.userData.sfGlitter = glitter;
  material.userData.sfBio = bio;
  material.userData.sfDunes = dunes;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);

    Object.assign(shader.uniforms, atmos.uniforms);
    // Per-material scalars ride alongside the shared block.
    shader.uniforms.uRim = { value: new atmos.THREE.Vector3(0.155 * rimScale, 2.55, 0) };
    shader.uniforms.uGlitter = { value: new atmos.THREE.Vector2(glitter, 55) };
    if (bio > 0) shader.uniforms.uBio = { value: bio };
    if (dunes > 0) {
      /* Wavenumbers are 2*PI / wavelength: 0.75m, 4.2m, 22m. The
         slopes are the TANGENT of the tilt each train adds, not a
         height - 0.17 is about ten degrees, which is as far as sand
         goes before it slumps. */
      shader.uniforms.uDuneA = {
        value: new atmos.THREE.Vector4(8.378, 0.105 * dunes, 1.496, 0.082 * dunes),
      };
      shader.uniforms.uDuneB = {
        value: new atmos.THREE.Vector4(0.286, 0.052 * dunes, 0.07 * dunes, 0),
      };
    }

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSFWorld;")
      .replace("#include <project_vertex>", `#include <project_vertex>${ATMOS_VERT}`);

    let frag = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${ATMOS_PARS}`);

    if (bio > 0) {
      frag = frag
        .replace("#include <common>", "#include <common>\nuniform float uBio;")
        .replace("#include <color_fragment>", BIO_FRAG_COLOR)
        .replace("#include <emissivemap_fragment>", BIO_FRAG_EMIT);
    }

    /* Injected at `normal_fragment_maps`, which is the last chunk
       that touches `normal` before the lighting reads it. Anywhere
       after `lights_fragment_begin` and the perturbation would be
       decoration on an already-shaded pixel. */
    if (dunes > 0) {
      frag = frag
        .replace("#include <common>", `#include <common>\n${DUNE_PARS}`)
        .replace("#include <normal_fragment_maps>", DUNE_FRAG);
    }

    if (glitter > 0) frag = frag.replace("#include <opaque_fragment>", `${GLITTER_FRAG}\n#include <opaque_fragment>`);

    frag = frag.replace("#include <opaque_fragment>", `#include <opaque_fragment>${ATMOS_FRAG}`);
    shader.fragmentShader = frag;

    material.userData.sfShader = shader;
  };

  // Changing onBeforeCompile after a program exists requires a
  // recompile; forcing the key keeps variants distinct.
  material.customProgramCacheKey = () =>
    `sf:${rimScale.toFixed(3)}:${glitter.toFixed(3)}:${bio.toFixed(3)}`
    + `:${dunes.toFixed(3)}`;
  material.needsUpdate = true;
  return material;
}

/**
 * The unlit counterpart, for MeshBasicMaterial. Additive glow cards
 * and emissive faces still need to sit behind haze, or a lamp two
 * hundred metres away punches through a sandstorm at full strength.
 * `fade` scales how much: a true emitter wants less than a wall.
 *
 * `additive` is not optional dressing. Haze on an OPAQUE surface
 * means "mix toward the sky", but on an ADDITIVE one the sky colour
 * is added on top of the frame - so a light shaft a kilometre away,
 * fully hazed, output a full-brightness patch of sky and read as a
 * pale wedge stamped over the mountains. Additive surfaces must
 * fade toward BLACK, which for additive blending is invisibility.
 */
export function patchBasicMaterial(material, atmos, fade = 0.7, additive = false) {
  if (!material || material.userData.sfPatched) return material;
  material.userData.sfPatched = true;
  /* Material.clone() does not preserve onBeforeCompile in every pinned Three
     build. Record which atmosphere path authored the material so presentation
     clones can restore the unlit shader instead of feeding MeshBasicMaterial
     through the lit normal/rim patch. */
  material.userData.sfBasic = true;
  material.userData.sfFade = fade;
  material.userData.sfAdditive = !!additive;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, atmos.uniforms);
    shader.uniforms.uRim = { value: new atmos.THREE.Vector3(0, 1, fade) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSFWorld;")
      .replace("#include <project_vertex>", `#include <project_vertex>${ATMOS_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${ATMOS_PARS}`)
      .replace("#include <opaque_fragment>",
        `#include <opaque_fragment>${additive ? ATMOS_FRAG_ADDITIVE : ATMOS_FRAG_BASIC}`);
    material.userData.sfShader = shader;
  };
  material.customProgramCacheKey = () => `sfb:${fade.toFixed(3)}:${additive ? 1 : 0}`;
  material.needsUpdate = true;
  return material;
}

/* Dune sparkle. Journey's sand glints; a flat matte desert reads as
   plastic. Kept as a specular *modulation* rather than added noise:
   it only appears at grazing sun angles, only within a short
   distance, and it fades out entirely by mid-field, so it can never
   become a static pixel lattice at range. This renderer has no
   temporal resolve, so anything that survives to the horizon would
   be permanent. */
const GLITTER_FRAG = /* glsl */`
{
  float gd = 1.0 - smoothstep(uGlitter.y * 0.35, uGlitter.y, length(cameraPosition - vSFWorld));
  if (uGlitter.x > 0.0 && gd > 0.001) {
    vec3 gp = floor(vSFWorld * 5.5);
    float gh = fract(sin(dot(gp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 gv = normalize(vViewPosition);
    vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float spec = pow(max(dot(reflect(-sunV, normal), gv), 0.0), 90.0);
    float sparkle = step(0.982, gh + spec * 0.4) * spec;
    outgoingLight += uSunHalo * sparkle * uGlitter.x * gd * 2.4;
  }
}
`;

/* ============================================================
   MATERIAL ARCHETYPES

   A small vocabulary. Every surface in the level is one of these,
   varied by vertex colour rather than by inventing new materials -
   which is also what keeps the draw call count sane, because
   meshes sharing a material can be merged.
   ============================================================ */

export function makeMaterials(THREE, atmos) {
  const made = new Map();

  function base(name, spec) {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: spec.vertexColors !== false,
      flatShading: spec.flat !== false,
      roughness: spec.roughness ?? 0.95,
      metalness: spec.metalness ?? 0.0,
      side: spec.side || THREE.FrontSide,
      transparent: !!spec.transparent,
      opacity: spec.opacity ?? 1,
      depthWrite: spec.depthWrite ?? true,
      emissive: spec.emissive ? new THREE.Color(spec.emissive) : new THREE.Color(0, 0, 0),
      emissiveIntensity: spec.emissiveIntensity ?? 1,
      envMapIntensity: 1,
    });
    if (spec.color) m.color.setStyle(spec.color, THREE.SRGBColorSpace);
    m.name = `sf-${name}`;
    patchMaterial(m, atmos, {
      rim: spec.rim, glitter: spec.glitter, dunes: spec.dunes,
    });
    made.set(name, m);
    return m;
  }

  const lib = {
    /* Sand is the exception to flat shading: silk dunes need smooth
       normals, and the faceting is carried by the rock instead. */
    /* Glitter came down hard when the ripples went in, from 0.55 to
       0.18. The sparkle is a specular lobe keyed on `reflect(-sun,
       normal)` inside 18cm world cells, and it was tuned against a
       normal that varied slowly across a whole dune face. Once the
       ripples started tilting that normal ten degrees every 75cm,
       entire cells flipped to full specular at once and the
       near-field filled with hard white parallelograms - broken
       confetti, not glinting sand. The ripples now supply most of
       the life the glitter was there to provide. */
    sand: base("sand", {
      flat: false, roughness: 0.98, rim: 0.55, glitter: 0.10, dunes: 1.0,
    }),
    sandDark: base("sandDark", {
      flat: false, roughness: 0.99, rim: 0.45, glitter: 0.08, dunes: 0.8,
    }),
    /* Ash takes a fraction of the ripple: it is a fallen crust
       rather than a drifting one, so it holds a fainter print. */
    ash: base("ash", { flat: false, roughness: 1.0, rim: 0.5, glitter: 0.0, dunes: 0.45 }),

    rock: base("rock", { roughness: 0.94, rim: 1.0 }),
    basalt: base("basalt", { roughness: 0.86, rim: 1.25 }),

    /* Stonework is faceted but slightly smoother than living rock -
       it reads as dressed rather than eroded.
       Low rim on purpose: a masonry cylinder seen nearly edge-on
       has a whole band of high-fresnel facets, and at the default
       rim strength a cathedral spire grew blue-violet stripes
       where the string courses flared. */
    stone: base("stone", { roughness: 0.88, rim: 0.55 }),

    /* Oxidised bronze is a patina - a dielectric crust - over metal,
       not bare metal. At metalness 0.62 the albedo becomes the
       specular F0 and the diffuse term nearly vanishes, so the
       Saint's head stopped showing its own colour and instead
       showed a blurred reflection of the environment: with a warm
       ground-bounce hemisphere below it, a 60m bronze head rendered
       bright ORANGE-RED. Weathered bronze belongs near 0.2. */
    bronze: base("bronze", { roughness: 0.62, metalness: 0.20, rim: 1.0 }),
    /* Verdigris is a CORRODED surface - a mineral crust, not a metal.
       Rendered on the bronze material its 0.20 metalness turned part
       of the albedo into specular, and under a golden-hour key that
       specular is warm: the figure carried verdigris across arms,
       thighs, shins, gorget, crest and haft - about a third of its
       area - and measured 10.9% green-side in Lab. The same
       mechanism this file already records for gold and bronze, one
       more time. Zero metalness, so the pigment is the pigment. */
    verdigris: base("bronze", { roughness: 0.88, metalness: 0.0, rim: 1.0 }),
    /* Gold at metalness 0.72 rendered TERRACOTTA - measured hue 8
       degrees against a ramp at 39. Identical mechanism to the bronze
       note directly above: past ~0.6 the albedo becomes specular F0,
       diffuse nearly vanishes, and the surface shows a blurred warm
       environment instead of its own colour. Bronze was fixed for
       this and gold was left at 0.72. Bias was never the lever. */
    gold: base("gold", { roughness: 0.52, metalness: 0.16, rim: 1.0 }),
    /* Gold on cloth: same pigment, no metalness. A broad flat sheet
       with metalness reads as a mirror of the sand behind it, which
       is the opposite of what a sash should do. */
    goldCloth: base("gold", { roughness: 0.86, metalness: 0.0, rim: 1.0 }),
    /* Bluing and parkerising are conversion coatings - dielectric.
       Setting metalness 1.0 here would make the albedo the specular
       F0 and the iron would take its colour from the sky. */
    iron: base("iron", { roughness: 0.62, metalness: 0.28, rim: 1.0 }),
    rust: base("rust", { roughness: 0.95, metalness: 0.05, rim: 1.0 }),

    /* Rim strengths cut on every plate archetype.
       The rim term samples the sky's ZENITH, which is blue, so a
       surface made of many small facets grows saturated blue-violet
       seams along every junction. `stone` was already dropped to
       0.55 for exactly this - a cathedral spire grew blue stripes -
       but the fix never reached the materials the player is built
       from, and the figure is nothing BUT facet junctions. It is the
       worst case for this term in the whole game. */
    bone: base("bone", { roughness: 0.82, rim: 1.0 }),
    chitin: base("chitin", { roughness: 0.44, metalness: 0.12, rim: 1.5 }),

    glassRock: base("glassRock", { roughness: 0.18, metalness: 0.16, rim: 1.6 }),

    cloth: base("cloth", {
      /* Was 1.5 - the highest rim on the figure, applied to the one
         piece of DoubleSide sheet geometry, which is the worst case
         a fresnel term can have. It blew out every grazing edge so
         the tabard read as backlit gauze with the leg showing
         through it. */
      roughness: 1.0, rim: 0.35, side: THREE.DoubleSide,
    }),

    /* Light shafts, spore glow, flame cards. No depth write so they
       layer without sorting artefacts. */
    glow: (() => {
      const m = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, toneMapped: true,
      });
      m.name = "sf-glow";
      // Additive, so it must fade to black with distance rather
      // than toward the sky. Fading a light shaft toward the sky
      // colour is how it ends up brightest a kilometre away.
      patchBasicMaterial(m, atmos, 1.0, true);
      made.set("glow", m);
      return m;
    })(),

    /* Unlit flat colour, for emissive faces that must not pick up
       the sun at all - stained glass, rune cuts, lamp lenses. */
    emissive: (() => {
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
      m.name = "sf-emissive";
      patchBasicMaterial(m, atmos, 0.75);
      made.set("emissive", m);
      return m;
    })(),
  };

  lib.all = made;
  lib.get = (name) => made.get(name);
  /** Depth-sorted alpha variant of any archetype, made on demand. */
  lib.transparentOf = (name, opacity = 0.5) => {
    const key = `${name}@${opacity}`;
    if (made.has(key)) return made.get(key);
    const src = made.get(name);
    const m = src.clone();
    m.transparent = true;
    m.opacity = opacity;
    m.depthWrite = false;
    m.name = `sf-${key}`;
    // clone() may or may not carry onBeforeCompile depending on the
    // three build; deleting the own property falls back to Material's
    // prototype no-op, which makes the re-patch unambiguous rather
    // than double-injecting the atmosphere block. Assigning
    // `undefined` instead would shadow the prototype and crash the
    // program builder.
    delete m.onBeforeCompile;
    delete m.customProgramCacheKey;
    m.userData = { ...src.userData, sfPatched: false };
    patchMaterial(m, atmos, { rim: src.userData.sfRim ?? 1, glitter: 0 });
    made.set(key, m);
    return m;
  };
  return lib;
}

/* ============================================================
   VERTEX COLOUR HELPERS
   Low-poly geometry with one flat colour per material looks like a
   prototype. Every builder in this project paints its vertices, so
   the shape carries tonal variation before any light lands on it.
   ============================================================ */

/**
 * Paint a non-indexed or indexed geometry from a ramp, keyed on a
 * per-vertex scalar produced by `fn(x, y, z, i)` in 0..1.
 */
export function paintGeometry(THREE, geometry, ramp, fn, opts = {}) {
  const pos = geometry.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const jitter = opts.jitter ?? 0;
  const gamma = opts.gamma ?? 1;
  for (let i = 0; i < count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let t = clamp01(fn(x, y, z, i));
    if (gamma !== 1) t = Math.pow(t, gamma);
    let c = ramp.at(t);
    /* A second ramp blended in by a mask - the patina. Sampled at the
       same t so the blotch keeps the surface's own shading; only its
       hue changes. */
    if (opts.ramp2 && opts.mix2) {
      const m = clamp01(opts.mix2(x, y, z, i));
      if (m > 0) {
        const c2 = opts.ramp2.at(t);
        c = [c[0] + (c2[0] - c[0]) * m,
          c[1] + (c2[1] - c[1]) * m,
          c[2] + (c2[2] - c[2]) * m];
      }
    }
    if (jitter > 0) {
      // Deterministic per-vertex wobble, hashed off the position so
      // duplicated geometry does not shimmer between instances.
      const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;
      c = [
        clamp01(c[0] * (1 + (h - 0.5) * jitter)),
        clamp01(c[1] * (1 + (h - 0.5) * jitter * 0.92)),
        clamp01(c[2] * (1 + (h - 0.5) * jitter * 1.08)),
      ];
    }
    colors[i * 3] = srgb(c[0]);
    colors[i * 3 + 1] = srgb(c[1]);
    colors[i * 3 + 2] = srgb(c[2]);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Paint every vertex one linear colour from an sRGB hex. */
export function paintFlat(THREE, geometry, hex, jitter = 0) {
  const rgb = typeof hex === "string" ? hexToRgb(hex) : hex;
  const pos = geometry.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    let c = rgb;
    if (jitter > 0) {
      const h = Math.abs(Math.sin(
        pos.getX(i) * 12.9898 + pos.getY(i) * 78.233 + pos.getZ(i) * 37.719
      ) * 43758.5453) % 1;
      c = [
        clamp01(rgb[0] * (1 + (h - 0.5) * jitter)),
        clamp01(rgb[1] * (1 + (h - 0.5) * jitter)),
        clamp01(rgb[2] * (1 + (h - 0.5) * jitter)),
      ];
    }
    colors[i * 3] = srgb(c[0]);
    colors[i * 3 + 1] = srgb(c[1]);
    colors[i * 3 + 2] = srgb(c[2]);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Paint by local height with a touch of upward-facing bias - the
 * default for anything carved from rock. Faces that catch the sky
 * lighten, undercuts darken, which is what erosion actually does
 * and what a single directional light alone will not give you.
 */
function smoothstep01(e0, e1, x) {
  const t = clamp01((x - e0) / Math.max(1e-6, e1 - e0));
  return t * t * (3 - 2 * t);
}

/* ---------------------- value noise ----------------------
   Trig is not noise. Any sum of a few sines has a spectrum of a few
   spikes, so on a surface large enough to span several wavelengths
   it resolves into visible stripes or a cross-hatch - which is what
   happened to the Saint. This is the real thing: a hash on the
   integer lattice, smoothstep-faded, so its spectrum is broad and
   nothing in it lines up with anything else.

   `Math.imul` rather than `*`: the mixing constants push the product
   past 2^53, where float64 silently drops the low bits that carry
   all the entropy, and the "hash" degenerates into a smooth ramp.
   imul is an exact 32-bit multiply and is what makes this a hash. */
function vhash3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Trilinear value noise in [0,1), mean 0.5, cell size 1. */
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  let sum = 0;
  for (let c = 0; c < 8; c += 1) {
    const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
    const w = (ox ? ux : 1 - ux) * (oy ? uy : 1 - uy) * (oz ? uz : 1 - uz);
    sum += w * vhash3(xi + ox, yi + oy, zi + oz);
  }
  return sum;
}

export function paintByHeight(THREE, geometry, ramp, opts = {}) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const lo = opts.min ?? bb.min.y;
  const hi = opts.max ?? bb.max.y;
  const span = Math.max(1e-4, hi - lo);
  const normalWeight = opts.normalWeight ?? 0.35;
  const bias = opts.bias ?? 0;
  const noise = opts.noise ?? 0.12;

  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const nrm = geometry.attributes.normal;
  const pos = geometry.attributes.position;

  /* A LOCAL height term alongside the body-wide one.
     Painting a part only against the whole figure's height means its
     own form contributes nothing: every upper-body part landed at
     h 0.75-0.85 whatever its shape, so three pauldron lames, a
     keeled breastplate, a gorget and a fauld ring all came out the
     same value and none of them could be seen. The body gradient is
     what stops the figure looking striped part-by-part, so it stays
     - just no longer alone. */
  const localWeight = opts.localWeight ?? 0;
  const lspan = Math.max(1e-4, bb.max.y - bb.min.y);
  /* PATINA. Verdigris is a MOTTLE inside a bone plate, not a colour
     assigned to whole components. Two rounds were spent shuffling
     parts between ivory and verdigris - first as accents, then as an
     underlayer - and both were wrong because the reference does not
     work that way: it measures 2-8% olive across a body column while
     assigning whole shells put the render at 24-41% and turned a
     bone knight green. Blotches, at low frequency so they cluster
     rather than speckle. */
  const patina = opts.patina || null;
  /* ~0.35m period. The first cut used frequencies of 2.9-4.7 per
     metre - a period of about two metres, which on a 1.85m figure is
     one blotch for the whole model, and it can land entirely off it.
     Coverage measured 0.8% and did not move when the mask threshold
     was changed, because the mask was not the variable. */
  const pnoise = (x, y, z) => {
    const a = Math.sin(x * 17.3 + y * 11.1) * Math.cos(z * 19.7 - y * 13.3);
    const b = Math.sin((x + z) * 23.1 - y * 15.7) * 0.5;
    return (a + b) * 0.5 + 0.5;
  };
  return paintGeometry(THREE, geometry, ramp, (x, y, z, i) => {
    const hBody = (y - lo) / span;
    const hLocal = (y - bb.min.y) / lspan;
    const h = hBody * (1 - localWeight) + hLocal * localWeight;
    const up = clamp01(nrm.getY(i) * 0.5 + 0.5);
    /* The tonal break-up term, and it must not be PERIODIC. This was
       `sin(x*0.7 + z*1.13)`: a single plane wave, one direction, one
       wavelength of 4.73m, and no y term at all - so its phase was
       extruded vertically and every structure on the map shared the
       same world-space bands.

       Replaced with value noise, two octaves at ~5m and ~1.9m. Mean
       is 0.5 and the amplitude is unchanged, so nothing downstream
       re-tunes; measured autocorrelation at the old wavelength falls
       from 0.955 to 0.10.

       Honest about the size of this: it is a correctness fix to the
       primitive, not a fix for a named visible defect. It moves
       ~28% of pixels on the ossuary interior and under 3% on the
       open-desert poses, and the ribs read slightly cleaner. It was
       NOT the cause of the faint rectangular quilt visible on large
       smooth surfaces under a 3x zoom - that survives this change and
       is still unattributed. Do not cite this comment as having
       explained it.

       Build-time only: runs once per merged mesh at load, costs the
       renderer nothing. */
    const n = vnoise3(x * 0.20, y * 0.20, z * 0.20) * 0.62
      + vnoise3(x * 0.53, y * 0.53, z * 0.53) * 0.38;
    /* CAVITY. A downward-facing face is an undercut - the underside
       of a lame, the lip beneath a gorget - and in a flat-shaded
       untextured figure the near-black line at those junctions IS
       the drawing. Without it the model carried thousands of
       triangles of armour detail with no value to read it by: the
       darkest pixel on the lit figure measured L17 against the
       reference's L2. */
    const cavity = nrm.getY(i) < -0.05 ? (opts.cavity ?? 1) : 1;
    return clamp01(
      (h * (1 - normalWeight) + up * normalWeight + bias
        + (n - 0.5) * noise) * cavity
    );
  }, { jitter: opts.jitter ?? 0.06, ramp2: patina,
    mix2: patina
      /* A narrow window and a full-strength blend. Vertex colours
         interpolate across a face, so a wide ramp spends most of its
         coverage on partial mixes that never actually read as green -
         which is why the measured share sat at 1.3% while the mask
         nominally covered a fifth of the vertices. */
      ? (x, y, z) => smoothstep01(0.455, 0.545, pnoise(x, y, z))
      : null });
}

/* ============================================================
   SKY-DERIVED IMAGE-BASED LIGHTING
   Builds an equirectangular sky from the atmosphere model and runs
   it through PMREM. This is where every shadow side gets its
   colour, so the fill can never contradict the sky - a whole class
   of "the ambient is wrong" bugs simply cannot happen.
   ============================================================ */

export function buildSkyEnvironment(THREE, renderer, atmos, size = 64) {
  const w = size * 2;
  const h = size;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    // Equirect: v=0 is +Y (up).
    const theta = (y + 0.5) / h * Math.PI;
    const sy = Math.cos(theta);
    const st = Math.sin(theta);
    for (let x = 0; x < w; x += 1) {
      const phi = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      const sx = st * Math.sin(phi);
      const sz = st * Math.cos(phi);
      let c = atmos.skyAt(sx, sy, sz);
      if (sy > 0) {
        /* The sky may be as violet as it likes to LOOK at; it must
           not dye everything it LIGHTS. This dome is the only source
           on a surface facing away from the sun, so at golden hour
           the zenith was painting every shadow face magenta - 24% of
           the player's shadow-side pixels landed in the 200-330 hue
           wedge, on a figure whose reference has warm shade
           throughout. The lower hemisphere was already warmed to
           ground bounce for exactly this reason and the upper one was
           left raw. Weighting the light toward the horizon band of
           the SAME sky keeps the fill sky-derived - it still cannot
           contradict the sky - while taking the zenith's hue back out
           of the cast. The visible sky is untouched. */
        const t = clamp01(sy) * 0.88;
        const hz = atmos.skyAt(sx, 0.08, sz);
        c = [lerp(c[0], hz[0], t), lerp(c[1], hz[1], t), lerp(c[2], hz[2], t)];
        /* Weighting to the horizon alone took the violet out and left
           magenta: at golden hour that band is pink, so the fill was
           still the wrong hue, just a nearer-by wrong hue. What
           actually lights a shaded face out here is the enormous
           sunlit floor - the same ground bounce the lower hemisphere
           already uses. Mixing it upward is why desert shade reads
           warm rather than pink. */
        const gb = atmos.groundBounce;
        const wt = clamp01(sy) * 0.52;
        c = [lerp(c[0], gb.r, wt), lerp(c[1], gb.g, wt), lerp(c[2], gb.b, wt)];
      }
      if (sy < 0) {
        // Below the horizon the "sky" is the ground bounce: warm,
        // and warm on purpose. A cool blue lower hemisphere fights
        // the sand and drains the whole frame of its heat.
        const t = clamp01(-sy * 2.2);
        const g = atmos.groundBounce;
        c = [lerp(c[0], g.r, t), lerp(c[1], g.g, t), lerp(c[2], g.b, t)];
      }
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt.texture;
}

/* ============================================================
   DISTRICT TINTS
   Each area of the map shifts the palette without leaving it. A
   level that is one colour everywhere is a level with one idea.
   ============================================================ */

/**
 * Each area shifts the palette without leaving it. Strengths are
 * deliberately modest: at 0.42 the Glass Scar's teal was visible as
 * a green field from the far side of the map, which reads as a
 * texturing bug rather than as a district. The tint's job is to be
 * felt at 300m and named at 100m.
 */
export const DISTRICT_TINT = {
  threshold: { sand: 0.0, tint: "#e9ba79", strength: 0.0 },
  reach: { sand: 0.06, tint: "#f2c88a", strength: 0.16 },
  saint: { sand: 0.0, tint: "#d9a97a", strength: 0.12 },
  cathedral: { sand: -0.05, tint: "#bfa88c", strength: 0.14 },
  ossuary: { sand: -0.08, tint: "#cfc7a8", strength: 0.24 },
  scar: { sand: -0.18, tint: "#6f8b98", strength: 0.22 },
  censer: { sand: -0.30, tint: "#6a5a52", strength: 0.40 },
  choir: { sand: -0.04, tint: "#a98a72", strength: 0.20 },
  bloom: { sand: -0.14, tint: "#6f5480", strength: 0.32 },
  road: { sand: 0.02, tint: "#dbb489", strength: 0.10 },
  fosse: { sand: -0.06, tint: "#a8845e", strength: 0.18 },
};

export { srgb as srgbTransfer };
