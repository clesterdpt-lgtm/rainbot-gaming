/* ============================================================
   SAINTFALL - Kenosis art

   The second world's palette, lighting tables and surfaces.

   Everything structural is borrowed from art.js: the ramp format,
   the atmosphere machinery, the material archetypes, the shader
   injection points. What is here is a DIFFERENT PLANET's numbers -
   and a handful of surfaces the desert had no use for.

   ------------------------------------------------------------
   THE THREE THINGS THAT MAKE SNOW HARD, AND WHAT IS DONE ABOUT
   EACH OF THEM

   1. SNOW IS NOT WHITE, AND A WHITE SNOW LEVEL IS A GREY ONE.

      Lit snow under a low sun is peach. Shadowed snow is
      SATURATED BLUE - it is lit by a deep sky and by nothing
      else, so it does not merely go darker, it changes hue. The
      full sunlit-to-shadow swing on this world is roughly 40
      degrees of hue and it is the entire reason the level reads
      as expensive rather than as a bleached desert. Every ramp
      below runs cool at the dark end and warm at the light end,
      and `shadeHue` in each grade is BLUE where Vesper's is
      violet.

      The corollary is a ceiling: the brightest snow albedo here
      is 0.86, not 1.0. A surface at 1.0 has nowhere to go when
      the sun hits it, the bloom has nothing to bloom, and the
      cathedral's braziers - which must be the brightest thing in
      any frame that contains them - lose to a hillside.

   2. THE POST CHAIN WAS CUT AGAINST A DARK DESERT.

      Two terms in render.js's composite are keyed on absolute
      linear scene luma, and both were tuned on frames whose
      scene buffer runs p50 0.165:

        - the occlusion KEY KNEE, which hands the picture back to
          the sun as a pixel gets bright. A snow field sits well
          past that knee everywhere, so on a white world the
          contact darkening exempts the entire frame and quietly
          stops existing. Every grade here therefore carries its
          own `ao` pair - see the optional field in blendGrade.
        - the emissive BOUNCE receiver knee, for the same reason
          in the opposite direction: a brazier on snow is a much
          weaker ratio than a brazier on sand, so the gain goes
          up and the knee goes with it.

      Exposure comes down across the board to match. This is not
      "make it darker": it is that a scene whose average albedo is
      two and a half times the desert's needs two and a half times
      less light to land in the same place on the tone curve.

   3. SNOW WITHOUT MICRO-RELIEF IS PLASTIC.

      Vesper solved the same problem for sand with DUNE_FRAG - a
      three-train ripple field perturbing the normal in the
      fragment shader, for free, at every scale the geometry
      cannot afford. Snow gets the same treatment and a different
      shape: SASTRUGI_FRAG carves hard, undercut, wind-parallel
      ridges instead of soft symmetric ripples, and fades itself
      out on slopes too steep to hold a drift. The one rule
      inherited wholesale is that all trains run on EXACTLY one
      heading; three headings is plaid, and at a grazing angle
      plaid is what the far ground becomes.
   ============================================================ */

import { makeRamp } from "saintfall/core.js";
import {
  makeAtmosphere, makeMaterials, patchMaterial, DAY_CYCLE_SECONDS,
} from "saintfall/art.js";

/* ============================================================
   PALETTE
   ============================================================ */

const K = {
  /* snow - the six-stop spine of the whole level. Note that the
     dark end is a BLUE, not a grey: see the header. */
  snowShade: "#4a6494",
  snowShadeLit: "#6b85b4",
  snowCool: "#95abcf",
  snowMid: "#c3d0e4",
  snowLit: "#e4e6ee",
  snowCrest: "#f0ecec",
  snowSunlit: "#f6e7dc",

  /* wind slab - harder, bluer, and a shade darker than fresh snow
     because it is compacted and scoured rather than fluffy. */
  slabShade: "#42597f",
  slabMid: "#9fb2cd",
  slabLit: "#d5dae4",

  /* glacier ice. The saturation lives in the DEPTH, so the ramp's
     dark end is where the cyan is and the light end goes to a pale
     near-white edge - the opposite arrangement to snow. */
  iceDeep: "#0d3f5e",
  iceCore: "#1a6f92",
  iceBody: "#4fa5bd",
  iceLit: "#a8d8e2",
  iceEdge: "#e2f3f6",

  /* black ice on the tarn - dark, wet-looking, sky-reflecting */
  tarnDeep: "#0a1220",
  tarnMid: "#16233a",
  tarnLit: "#2e4869",
  tarnSheen: "#7d9dc4",

  /* granite. Grey-GREEN on purpose: neutral grey rock against blue
     shadow snow mixes to the same value and the mountain loses its
     bones. The green is what separates them. */
  graniteDeep: "#22262a",
  graniteShade: "#3b423f",
  graniteMid: "#5c6259",
  graniteLit: "#8a8d7e",
  graniteBleach: "#b2b1a0",

  /* rime - off-white, slightly warm against the snow so a rimed
     windward face reads as a different substance and not as a
     lighting accident */
  rimeShade: "#8fa0b8",
  rimeMid: "#d3d6dc",
  rimeLit: "#f4f1ec",

  /* scree and moraine - the dirty ice and rock the glacier carries */
  screeDeep: "#2a2620",
  screeMid: "#544c40",
  screeLit: "#8a7f6c",

  /* the Fumarole Steps - the one warm district */
  sulphurDeep: "#4a3413",
  sulphur: "#a8791f",
  sulphurLit: "#e0b545",
  sulphurCrust: "#f5dd8e",
  basaltWet: "#191a1e",

  /* the Rime Forest's dead wood under its armour */
  barkDeep: "#241d1c",
  barkMid: "#463832",
  barkLit: "#6b574a",

  /* bronze, for the bells and the braziers. Colder than Vesper's:
     the same alloy under a blue sky. */
  bellDeep: "#3a3524",
  bell: "#7a6c3f",
  bellLit: "#b8a463",
  bellVerdigris: "#5c8478",

  /* fire - the only warm light above 400m */
  emberDeep: "#7d1f05",
  ember: "#d95a16",
  emberLit: "#ffb257",
  flameCore: "#fff3d2",
};

export const SUMMIT_PALETTE = K;

/* ============================================================
   RAMPS

   Same contract as art.js's: `makeRamp` takes [t, hex] stops and
   returns a sampler the paint helpers call per vertex. `t` is
   "how exposed/lit is this vertex" in 0..1, decided by the
   terrain build, so a ramp is a tonal range rather than a
   gradient in space.
   ============================================================ */

/**
 * Deep snow. Seven stops, because this is the surface most of the
 * level is made of and a five-stop ramp banded visibly across a
 * 400m open bowl.
 *
 * The bottom three stops are the interesting ones. They run BLUE
 * and they stay saturated: a grey dark end plus the composite's
 * shade-desaturation term is how snow turns into dirty concrete,
 * and it is the failure mode of every cheap snow level.
 */
export const SNOW_RAMP = makeRamp([
  [0.00, K.snowShade],
  [0.16, K.snowShadeLit],
  [0.34, K.snowCool],
  [0.55, K.snowMid],
  [0.74, K.snowLit],
  [0.90, K.snowCrest],
  [1.00, K.snowSunlit],
]);

/** Wind slab. Narrower range and bluer - it is snow that has been
 *  pressed flat and polished, so it has less tonal variety than the
 *  drift beside it, which is exactly what makes the two read as
 *  different surfaces from a distance. */
export const SLAB_RAMP = makeRamp([
  [0.00, K.slabShade],
  [0.30, "#6e83a6"],
  [0.58, K.slabMid],
  [0.82, K.slabLit],
  [1.00, "#e8ebf0"],
]);

/**
 * Glacier ice, and the ramp is inverted relative to snow: the
 * SATURATION IS AT THE DARK END. Ice is cyan where it is thick and
 * pale where it is thin, so a serac's shaded flank is the most
 * colourful thing on it and its sunlit crest is nearly white.
 * Ramping it like snow - pale shadow, saturated highlight - makes
 * a glacier read as blue-painted styrofoam.
 */
export const GLACIER_RAMP = makeRamp([
  [0.00, K.iceDeep],
  [0.24, K.iceCore],
  [0.52, K.iceBody],
  [0.78, K.iceLit],
  [1.00, K.iceEdge],
]);

/** Black ice. Overwhelmingly dark, with the light end reserved for
 *  the pressure ridges and the crack lips that catch the sky - same
 *  reasoning as Vesper's GLASS_RAMP, which learned it the hard way
 *  when a mid-value teal painted a whole crater the colour of a
 *  swimming pool. */
export const BLACKICE_RAMP = makeRamp([
  [0.00, K.tarnDeep],
  [0.46, K.tarnMid],
  [0.76, K.tarnLit],
  [0.92, K.tarnSheen],
  [1.00, "#c3d6ea"],
]);

export const GRANITE_RAMP = makeRamp([
  [0.00, K.graniteDeep],
  [0.28, K.graniteShade],
  [0.58, K.graniteMid],
  [0.84, K.graniteLit],
  [1.00, K.graniteBleach],
]);

/** Rime. A very short range on purpose: rime is uniformly bright
 *  and its shape is carried by the FEATHERS, not by tone. A wide
 *  ramp turns it into snow. */
export const RIME_RAMP = makeRamp([
  [0.00, K.rimeShade],
  [0.42, "#b6c0cd"],
  [0.74, K.rimeMid],
  [1.00, K.rimeLit],
]);

export const SCREE_RAMP = makeRamp([
  [0.00, K.screeDeep],
  [0.40, K.screeMid],
  [0.78, K.screeLit],
  [1.00, "#b09c82"],
]);

export const SULPHUR_RAMP = makeRamp([
  [0.00, K.basaltWet],
  [0.22, K.sulphurDeep],
  [0.52, K.sulphur],
  [0.80, K.sulphurLit],
  [1.00, K.sulphurCrust],
]);

export const BARK_RAMP = makeRamp([
  [0.00, K.barkDeep],
  [0.44, K.barkMid],
  [0.80, K.barkLit],
  [1.00, "#8a7263"],
]);

export const BELL_RAMP = makeRamp([
  [0.00, K.bellDeep],
  [0.34, K.bell],
  [0.64, K.bellVerdigris],
  [0.86, K.bellLit],
  [1.00, "#e2cf95"],
]);

/* ============================================================
   TIMES

   THE ROW NAMES ARE NOT FREE. `goldenhour`, `dusk` and `night` set
   `goldenFactor` / `duskFactor` / `nightFactor` inside
   makeAtmosphere, which modules outside this file read to ask what
   kind of light they are standing in. Kenosis renames the LABEL and
   rewrites every number; it keeps the row.

   Numbers that differ from Vesper's on principle rather than taste:

     sunIntensity  - down about 30%. Snow's albedo is roughly 0.85
                     against sand's 0.35, so the same key lands two
                     and a half stops hotter on this world.
     envIntensity  - up. A snowfield is an enormous bounce card and
                     the fill IS most of the light on any surface
                     the sun is not hitting. Underlighting this is
                     what makes snow read as chalk.
     groundBounce  - COOL, and bright. Vesper's is warm on purpose
                     to keep the heat in the frame; the same choice
                     here would put a sandy cast on every shadow on
                     the mountain and undo rule 1 in the header.
     fogHeightFalloff - roughly double. Thin cold air clears fast
                     with altitude, and this term is the entire
                     reason the summit reads as ABOVE the weather
                     rather than as a flat cutout pasted on it.
   ============================================================ */

export const SUMMIT_TIMES = {
  /* The default, and the composition the level was laid out for: a
     7-degree sun from the south-south-east, so the ascent's east
     flank is lit, its west flank is in blue shadow, and the summit
     cathedral is rim-lit from behind the player's shoulder. */
  goldenhour: {
    label: "Alpenglow",
    sunAzimuth: 158,
    sunElevation: 7.2,
    /* Cleaner than the desert's #ffd6a0. At 4km of altitude there is
       far less atmosphere to redden the light; what makes alpenglow
       pink is the SNOW picking up the horizon band, not the key
       itself being orange. Overcooking the key here is what turns a
       mountain into a sand dune with a white texture. */
    sunColor: "#ffdcc0",
    sunIntensity: 3.35,
    /* The zenith is the deepest in the game and it is deliberately
       LUMINOUS rather than merely dark - the fill is a cosine
       convolution of this gradient, and on this world the fill is
       carrying the whole shadow side of a 452m mountain. A navy
       zenith that contributes nothing would leave every shaded face
       lit only by the horizon band, which is pink, which is how
       snow shadows end up magenta. */
    skyZenith: "#2b4f9e",
    skyHigh: "#6d90d2",
    skyHorizon: "#efb9a2",
    skyLow: "#f7d8c2",
    sunHalo: "#fff0dc",
    haloSpread: 0.21,
    groundBounce: "#b7c8e4",
    envIntensity: 0.82,
    fogDensity: 0.00058,
    fogHeightFalloff: 0.0165,
    fogStart: 55,
    sunScatter: 1.20,
    exposure: 0.88,
    grade: "alpenglow",
  },

  /* High sun. Brutal, flat, and the hardest light in the level -
     which is what it is for: it is the only time of day that shows
     the mountain's real shape without alpenglow doing the work. */
  noon: {
    label: "White Noon",
    sunAzimuth: 196,
    sunElevation: 58,
    sunColor: "#fffaf2",
    sunIntensity: 3.9,
    skyZenith: "#12356f",
    skyHigh: "#3f6cb4",
    skyHorizon: "#a8c4e0",
    skyLow: "#d2e0ee",
    sunHalo: "#ffffff",
    haloSpread: 0.09,
    groundBounce: "#c8d6e8",
    envIntensity: 1.15,
    fogDensity: 0.00042,
    fogHeightFalloff: 0.0195,
    fogStart: 70,
    sunScatter: 0.5,
    exposure: 0.80,
    grade: "glare",
  },

  /* Blue hour. The sun is gone, the snow is entirely sky-lit, and
     the nine braziers on the parvis become the only warm thing on
     the mountain. This is the level's portrait light. */
  dusk: {
    label: "Blue Hour",
    sunAzimuth: 268,
    sunElevation: -1.4,
    sunColor: "#8fa6d8",
    sunIntensity: 1.05,
    skyZenith: "#101f4e",
    skyHigh: "#26417c",
    skyHorizon: "#6b6ba0",
    skyLow: "#a08cad",
    sunHalo: "#c8b4d8",
    haloSpread: 0.42,
    groundBounce: "#4a5a86",
    envIntensity: 1.25,
    fogDensity: 0.00072,
    fogHeightFalloff: 0.0150,
    fogStart: 40,
    sunScatter: 0.85,
    exposure: 1.45,
    grade: "bluehour",
  },

  /* The vigil. Moonlight on snow is genuinely bright - far brighter
     than moonlight on anything else - so this is the most legible
     night in either level, and the exposure is lower than Vesper's
     2.6 for exactly that reason. */
  night: {
    label: "The Vigil",
    sunAzimuth: 44,
    sunElevation: 27,
    sunColor: "#b6cbf2",
    sunIntensity: 1.9,
    skyZenith: "#060c22",
    skyHigh: "#0f1a3e",
    skyHorizon: "#243356",
    skyLow: "#38456a",
    sunHalo: "#e2ecff",
    haloSpread: 0.14,
    groundBounce: "#243356",
    envIntensity: 1.35,
    fogDensity: 0.00060,
    fogHeightFalloff: 0.0145,
    fogStart: 28,
    sunScatter: 0.45,
    exposure: 2.05,
    grade: "vigil",
  },

  /* Whiteout. The mountain's storm, and the exact inverse of
     Vesper's ochre front: instead of a warm kilometre-wide softbox
     it is a cold one, with no horizon, no shadow and no distance.
     `fogStart` at 5m is what removes the world. */
  storm: {
    label: "Whiteout",
    sunAzimuth: 158,
    sunElevation: 24,
    sunColor: "#dfe8f4",
    sunIntensity: 1.35,
    skyZenith: "#9fb0c4",
    skyHigh: "#b4c2d2",
    skyHorizon: "#cbd5df",
    skyLow: "#dbe2e9",
    sunHalo: "#f2f6fa",
    haloSpread: 0.62,
    groundBounce: "#a8b6c6",
    envIntensity: 0.9,
    fogDensity: 0.0042,
    fogHeightFalloff: 0.0035,
    fogStart: 5,
    sunScatter: 0.8,
    exposure: 0.86,
    grade: "whiteout",
  },
};

/* The day on Kenosis. Same phase contract as Vesper's - phase 0 is
   06:00 - with the stops moved because this world's sun tracks a
   different arc: it rises in the south-east, crosses high in the
   south, and sets north-west behind the Bell Terrace, which is why
   the Terrace is the level's best sunset vantage. */
export const SUMMIT_CYCLE_STOPS = Object.freeze([
  Object.freeze({ phase: 0.00, key: "goldenhour", sunAzimuth: 132, sunElevation: 7.2 }),
  Object.freeze({ phase: 0.27, key: "noon", sunAzimuth: 196, sunElevation: 58 }),
  Object.freeze({ phase: 0.54, key: "dusk", sunAzimuth: 292, sunElevation: -1.4 }),
  Object.freeze({ phase: 0.74, key: "night", sunAzimuth: 44, sunElevation: 27 }),
  Object.freeze({ phase: 1.00, key: "goldenhour", sunAzimuth: 132, sunElevation: 7.2 }),
]);

/* ============================================================
   GRADES

   Field-for-field the same shape as art.js's, plus the optional
   `ao` pair every grade here carries - see the header's point 2,
   and the optional field in blendGrade.

     ao: [sky-tint amount, key knee in linear scene luma]

   The knees below sit between 3x and 6x the desert's 0.55, and
   they are not guesses: the composite hands the picture back to
   the sun across `smoothstep(knee, knee * 2.2, luma)`, so the
   knee has to sit near the scene buffer's median for the term to
   have authority in the shade and none in the highlights. A snow
   field under a 3.35 key runs a median near 0.6.
   ============================================================ */

export const SUMMIT_GRADES = {
  /* Alpenglow. The whole grade exists to protect one thing: the
     hue gap between peach-lit snow and blue shadow snow. Anything
     that desaturates the bottom of the range closes that gap and
     the level becomes grey. */
  alpenglow: {
    /* The floor is BLUE-weighted at about the same absolute level
       as Vesper's - the lesson recorded there (a floor at sRGB 30
       makes every frame in the game measure the same first
       percentile) is a property of the pipeline, not of the
       desert, and it carries over unchanged. */
    lift: [0.0016, 0.0022, 0.0042],
    /* Slightly gentler than the desert's 1.34. A mountain at
       alpenglow genuinely has less true black in it than a dune
       field does - the sky is brighter, the bounce is stronger,
       and there is snow filling every crevice. Crushing to match
       Vesper would be the histogram driving the art. */
    toe: 1.26,
    /* Deep shade goes BLUE and stays saturated - the single most
       important number in this file. Vesper desaturates toward a
       violet because desert shade is lit by a pink horizon; snow
       shade is lit by a deep blue zenith and gets MORE chromatic
       as it darkens, not less. The amount is high and the knee is
       high with it, because on this world the shaded half of the
       mountain is most of the frame. */
    shade: [0.34, 0.30],
    shadeHue: "#4f74c4",
    /* The braziers are competing with a snowfield rather than with
       sand, so the gain is up and the receiver knee is up with it -
       a bounce is a RATIO against the key, and the key here lands
       on a surface two and a half times as bright. */
    bounce: [0.46, 2.6],
    gamma: [1.0, 1.005, 1.04],
    gain: [1.03, 1.0, 0.985],
    saturation: 1.06,
    shadowTint: "#2c4270",
    highlightTint: "#ffe8d6",
    tint: 0.20,
    contrast: 1.05,
    ao: [0.74, 1.95],
  },

  /* High noon. Flat light, so the grade does the separating: more
     contrast, a harder toe, and the lowest saturation in the table
     because a vertical sun on snow genuinely is close to
     monochrome and pretending otherwise reads as a filter. */
  glare: {
    lift: [0.0014, 0.0018, 0.0034],
    toe: 1.36,
    shade: [0.26, 0.24],
    shadeHue: "#5a7cc0",
    bounce: [0.20, 3.2],
    gamma: [1.0, 1.0, 1.02],
    gain: [1.0, 1.0, 1.0],
    saturation: 0.94,
    shadowTint: "#31456e",
    highlightTint: "#fffaf0",
    tint: 0.14,
    contrast: 1.14,
    ao: [0.80, 2.60],
  },

  /* Blue hour. Almost everything in frame is one hue, so the grade
     protects the two exceptions - the braziers and the rose window -
     with the strongest split-tone and the strongest bounce in the
     table. */
  bluehour: {
    lift: [0.0030, 0.0038, 0.0074],
    toe: 1.20,
    shade: [0.22, 0.26],
    shadeHue: "#3c5296",
    bounce: [0.86, 1.10],
    gamma: [1.02, 1.01, 0.99],
    gain: [1.02, 0.99, 1.06],
    saturation: 1.10,
    shadowTint: "#1e2c5e",
    highlightTint: "#ffcf9e",
    tint: 0.30,
    contrast: 1.04,
    ao: [0.70, 0.95],
  },

  /* The vigil. Moonlit snow is bright and almost colourless, so
     the identity is carried entirely by the blue of the floor and
     the split-tone - the same argument Vesper's night grade makes,
     one world colder. */
  vigil: {
    lift: [0.0026, 0.0040, 0.0098],
    toe: 1.10,
    shade: [0.12, 0.18],
    shadeHue: "#22376e",
    bounce: [0.92, 0.55],
    gamma: [1.04, 1.02, 0.97],
    gain: [0.93, 0.97, 1.09],
    saturation: 1.08,
    shadowTint: "#0e1a42",
    highlightTint: "#dceaff",
    tint: 0.34,
    contrast: 1.10,
    ao: [0.62, 0.70],
  },

  /* Whiteout. There is no black in a whiteout and there is no
     highlight either - it is one value everywhere, and the only
     honest grade for it is a very high floor, a straight toe and
     almost no saturation. The knee goes ABOVE everything else in
     the table because the whole frame is bright and occlusion in a
     whiteout is physically almost absent. */
  whiteout: {
    lift: [0.0090, 0.0104, 0.0128],
    toe: 1.04,
    shade: [0.06, 0.12],
    shadeHue: "#7d8ea4",
    bounce: [0.08, 3.0],
    gamma: [1.0, 1.0, 1.01],
    gain: [0.99, 1.0, 1.03],
    saturation: 0.72,
    shadowTint: "#3f5068",
    highlightTint: "#f4f8fc",
    tint: 0.26,
    contrast: 0.96,
    ao: [0.50, 3.40],
  },
};

/* ============================================================
   ATMOSPHERE
   ============================================================ */

/**
 * Kenosis's atmosphere. Same object, same update contract and the
 * same uniform block as Vesper's - only the tables differ, which is
 * the entire point of makeAtmosphere taking them as options.
 */
export function makeSummitAtmosphere(THREE, timeKey = "goldenhour", options = {}) {
  return makeAtmosphere(THREE, SUMMIT_TIMES[timeKey] ? timeKey : "goldenhour", {
    ...options,
    times: SUMMIT_TIMES,
    grades: SUMMIT_GRADES,
    cycleStops: SUMMIT_CYCLE_STOPS,
    fallbackTime: "goldenhour",
    fallbackGrade: "alpenglow",
    duration: options.duration || DAY_CYCLE_SECONDS,
  });
}

export { DAY_CYCLE_SECONDS };

/* ============================================================
   THE WIND

   ONE VECTOR FOR THE WHOLE WORLD, and it is declared here rather
   than in the terrain or the weather because five separate systems
   have to agree about it and any two of them disagreeing is
   immediately visible: sastrugi grain, rime feathers, spindrift
   plumes, drift tails behind props, the cascade's frozen lean, the
   cloud deck's flow and every banner on the mountain.

   TWO VECTORS, ONE WIND, and the difference between them is the
   commonest sign error in this kind of code:

     `toward`   - the direction the air MOVES. Anything that drifts,
                  streams, flaps or blows uses this. It is what goes
                  into `atmos.windDir` and therefore into `uWind`.
     `windward` - the direction you face to look INTO the wind, i.e.
                  the negation. Anything about EXPOSURE uses this: a
                  windward face is one whose normal points along it,
                  and that is where rime grows, where slab forms and
                  where snow does not lie.

   Bearing is meteorological - "292" means the wind comes FROM the
   WNW - and the vector convention is the engine's own: x = sin(az),
   z = cos(az), matching `direction()` in art.js's atmosphere.

   Speed rises with altitude because on a real mountain it does, and
   because it is what makes the summit read as a more hostile place
   than the valley without a single extra asset. */
export const SUMMIT_WIND = Object.freeze({
  bearingDeg: 292,
  fromBearing: 292,
  /* DERIVED, not typed in, because typing it in is how it was wrong
     the first time. The engine's azimuth convention is
     `(x, z) = (sin(az), cos(az))` - see `direction()` in art.js - and
     +Z is SOUTH in both levels (Vesper's threshold sits at z +830 in
     the south, its cathedral at z -725 in the north). So compass
     north is -Z, which is azimuth 180, and compass east is +X, which
     is azimuth 90: the mapping is a REFLECTION, `az = 180 - compass`,
     not the offset it looks like.
     Getting that backwards flips z only, which is the worst possible
     failure mode - the wind still blows along the right line, so
     spindrift and drift tails still look plausible, and the only
     symptom is that rime grows on the sheltered side of every tree
     in the level and nobody can say why. */
  toward: Object.freeze([0.9272, 0.3746]),
  windward: Object.freeze([-0.9272, -0.3746]),
  /* Flat aliases, because a consumer that only needs "the direction
     the air moves" should not have to index an array. */
  x: 0.9272,
  z: 0.3746,
  valleySpeed: 14,
  summitSpeed: 31,
  /** Wind speed in m/s at an altitude, for anything that scales with
   *  it - plume length, flag flap, spindrift density. */
  speedAt(y) {
    const t = Math.max(0, Math.min(1, y / 452));
    return 14 + (31 - 14) * (t * t * (3 - 2 * t));
  },
});

/**
 * Point an atmosphere at Kenosis's wind. `makeAtmosphere` seeds
 * `windDir` with Vesper's, and `sync()` copies it into `uWind` every
 * update - so this has to be applied to the STATE, once, rather than
 * written into the uniform where the next sync would overwrite it.
 */
export function applySummitWind(atmos) {
  atmos.windDir.set(SUMMIT_WIND.toward[0], SUMMIT_WIND.toward[1]).normalize();
  atmos.windSpeed = 1.35;
  atmos.sync();
  return atmos;
}

/* ============================================================
   STATION TINT

   The peer of art.js's DISTRICT_TINT. `snow` biases the surface
   weight toward or away from deep snow; `tint` and `strength` are a
   wide, soft colour wash so a station has an identity from 800m
   before a single prop of it is visible.
   ============================================================ */

export const STATION_TINT = {
  basecamp: { snow: -0.10, tint: "#8a8d7e", strength: 0.16 },
  tarn: { snow: -0.34, tint: "#31465f", strength: 0.34 },
  bowl: { snow: 0.14, tint: "#dfe6f0", strength: 0.10 },
  glacier: { snow: -0.24, tint: "#5aa0b8", strength: 0.30 },
  rime: { snow: 0.04, tint: "#9fa6ac", strength: 0.22 },
  fumarole: { snow: -0.44, tint: "#a8791f", strength: 0.42 },
  cascade: { snow: -0.18, tint: "#7fc2d4", strength: 0.26 },
  bell: { snow: -0.12, tint: "#6c7268", strength: 0.24 },
  summit: { snow: -0.20, tint: "#8f9490", strength: 0.20 },
  road: { snow: -0.30, tint: "#6e6a62", strength: 0.18 },
};

/* ============================================================
   SNOW SHADING

   Four fragment extensions, injected through patchMaterial's
   `extend` hook. That hook runs LAST, after the atmosphere block
   has done its own replacements, and art.js's comment above it
   spells out the consequence: every anchor those blocks touch is
   either re-emitted or is `opaque_fragment`, so the chunk names
   reached for here are all still present. The three used below -
   `normal_fragment_maps`, `lights_fragment_end` and
   `opaque_fragment` - are all intact for any material built
   WITHOUT the `dunes` option, and nothing on this world takes it.
   ============================================================ */

const SNOW_PARS = /* glsl */`
uniform vec4 uSastrugi;   // k1, slope1, k2, slope2
uniform vec4 uSastrugi2;  // k3, slope3, crest albedo, undercut
uniform vec4 uSnowWrap;   // wrap, gain, sky-tint r/g packed below
uniform vec3 uSnowSky;    // the colour multiple scattering returns
uniform vec3 uSparkle;    // density, size falloff distance, gain
`;

/**
 * SASTRUGI.
 *
 * The same trick as art.js's DUNE_FRAG - a normal perturbation in
 * the fragment shader, at every scale the geometry cannot afford -
 * and the same two rules inherited wholesale, both of which were
 * learned the hard way there:
 *
 *   ONE HEADING. Three trains 15 degrees apart still print plaid at
 *   a grazing angle, because 15 degrees of world heading becomes
 *   most of a right angle on screen when you are looking along the
 *   ground. Variety comes from the MEANDER and from the three
 *   scales, never from three headings.
 *
 *   FADE BY fwidth. Amplitude falls as the phase's screen-space
 *   derivative grows, so a train that has reached pixel scale
 *   contributes nothing instead of aliasing into a moire.
 *
 * What is DIFFERENT from sand, and it is the whole reason this is
 * not just DUNE_FRAG with new constants:
 *
 *   Wind ripples in sand are soft and roughly sinusoidal. Sastrugi
 *   are CARVED - the wind erodes a hard slab, so each ridge has a
 *   near-vertical windward scarp and a long tail, and the scarp
 *   frequently UNDERCUTS. The profile below is therefore a skewed
 *   sawtooth with a sharpening exponent rather than a cosine, and
 *   `uSastrugi2.w` biases the perturbation asymmetrically along the
 *   wind so the lit and shaded sides of a ridge are different
 *   widths. That asymmetry is what the eye reads as "carved".
 *
 *   And they only exist where wind reaches. The relief fades out on
 *   slopes steeper than about 30 degrees (nothing holds there) and
 *   on anything facing away from the prevailing wind, where the
 *   surface is drift rather than slab.
 */
const SASTRUGI_FRAG = /* glsl */`
#include <normal_fragment_maps>
{
  vec3 sfWN = inverseTransformDirection(normal, viewMatrix);
  /* 0.55-0.94 in world-normal Y is roughly 20-56 degrees fading
     out. Steeper than sand's window because a wind slab holds on
     ground a dune could never sit on. */
  float sfFlat = smoothstep(0.55, 0.94, sfWN.y);
  if (sfFlat > 0.002) {
    vec2 p = vSFWorld.xz;
    /* Bearing 292, the world's one wind. Constant rather than a
       uniform: the blowing-snow fields animate along the wind and
       relief that swung with them would read as the whole mountain
       rotating. */
    const vec2 wdir = vec2(-0.9272, -0.3746);
    const vec2 wper = vec2(0.3746, -0.9272);
    float along = dot(p, wdir);
    float across = dot(p, wper);

    /* WINDWARD ONLY. On the lee side of a ridge the surface is a
       soft drift with no relief at all, and the transition between
       the two is one of the few things that makes a snowfield read
       as having weather rather than texture. */
    float expo = smoothstep(-0.12, 0.34, dot(normalize(vec3(sfWN.x, 0.0, sfWN.z) + 1e-5), vec3(wdir.x, 0.0, wdir.y)));
    sfFlat *= mix(0.22, 1.0, expo);

    // Meander, at three incommensurate rates. Straight crests are corduroy.
    float wob = sin(across * 0.071) * 3.1 + sin(across * 0.0233) * 5.2
              + sin(across * 0.00907 + along * 0.0041) * 7.4;

    /* PATCHINESS, and it is the difference between sastrugi and
       corduroy.

       The first version of this ran the relief at full strength
       everywhere the exposure test allowed, and a 200m flat came out
       as continuous parallel ribbing from the near field to the fade
       - which is a ploughed field, not a snowfield. Real sastrugi
       form in DISCRETE FIELDS: a patch forty metres across is carved
       to the bone, the next twenty metres is smooth drift, and the
       boundary between them is soft. What decides it is where the
       wind was actually accelerating, which is a low-frequency
       property of the ground and not of the surface.

       Two lobes at incommensurate scales, biased so the mask spends
       more time on than off - the mountain is windy, and a mask that
       spends half its area at zero reads as patchy snow rather than
       as patchy carving. The floor is not zero for the same reason:
       even sheltered slab has some grain. */
    float pw = sin(along * 0.0193 + across * 0.0121) * 0.5
             + sin(along * 0.00741 - across * 0.00532 + 1.7) * 0.5;
    float pf = sin(across * 0.0361 - along * 0.0087 + 4.1);
    sfFlat *= clamp(0.28 + 0.9 * smoothstep(-0.45, 0.35, pw + pf * 0.28), 0.0, 1.0);

    float ph1 = along * uSastrugi.x + wob;
    float ph2 = along * uSastrugi.z + wob * 0.41 + sin(across * 0.038) * 2.0;
    float ph3 = along * uSastrugi2.x
              + sin(across * 0.0062) * 3.4 + sin(across * 0.0171) * 1.8;

    float w1 = fwidth(ph1);
    float w2 = fwidth(ph2);
    float w3 = fwidth(ph3);
    float a1 = 1.0 / (1.0 + w1 * w1 * 0.85);
    float a2 = 1.0 / (1.0 + w2 * w2 * 0.85);
    float a3 = 1.0 / (1.0 + w3 * w3 * 0.85);

    /* THE CARVED PROFILE. A cosine gives a sand ripple; sharpening
       it toward the crest and biasing the derivative along the wind
       gives a scarp. The undercut term pushes the steep face past vertical
       in normal terms, which is legal for a shading normal and is
       what sells the overhang the geometry does not have. */
    float u = uSastrugi2.w;
    float c1 = cos(ph1);
    float s1 = (c1 * (1.0 + u * 0.65 * (1.0 - c1))) * uSastrugi.y * a1;
    float c2 = cos(ph2);
    float s2 = (c2 * (1.0 + u * 0.45 * (1.0 - c2))) * uSastrugi.w * a2;
    float s3 = cos(ph3) * uSastrugi2.y * a3;

    vec3 g = vec3(wdir.x * s1 + (wdir.x * 0.966 + wper.x * 0.259) * s2
                  + (wdir.x * 0.906 - wper.x * 0.423) * s3,
                  0.0,
                  wdir.y * s1 + (wdir.y * 0.966 + wper.y * 0.259) * s2
                  + (wdir.y * 0.906 - wper.y * 0.423) * s3);
    sfWN = normalize(sfWN - g * sfFlat);
    normal = normalize((viewMatrix * vec4(sfWN, 0.0)).xyz);

    /* Crests run PALER and troughs run BLUER, and that is not the
       same statement twice: the crest is scoured to bare wind slab
       while the trough holds fresh drift, so the difference is a
       change of substance, not of exposure. Keeping it small - this
       is a tie-breaker under the ramp, not a second ramp. */
    float crest = sin(ph1) * a1 * 0.62 + sin(ph3) * a3 * 0.38;
    diffuseColor.rgb *= 1.0 + crest * sfFlat * uSastrugi2.z;
  }
}
`;

/**
 * MULTIPLE SCATTERING, which is what makes snow snow.
 *
 * Light entering a snowpack bounces between ice grains a dozen
 * times and leaves somewhere else. Two visible consequences, and
 * the level is worth very little without either:
 *
 *   1. Terminators are SOFT and ROUNDED. A hard Lambert
 *      terminator on a drift is the single clearest tell that a
 *      snow surface is plastic.
 *   2. Shaded snow is not dark, it is BLUE. The scattered light
 *      that escapes has been filtered by the ice, and ice absorbs
 *      red - which is the same physics that makes a glacier cyan,
 *      just at a shorter path length.
 *
 * Injected at `lights_fragment_end`, so it lands after the direct
 * and indirect terms are accumulated and before `opaque_fragment`
 * turns them into `outgoingLight`.
 *
 * DELIBERATELY NOT SHADOW-MASKED. That looks like a bug and is
 * not: the term models light arriving from the SKY and from the
 * snow around the pixel, and neither of those is occluded by the
 * thing casting the shadow. Masking it would put a hard black
 * terminator back in, which is the exact artefact it exists to
 * remove. It is bounded well under the key so it can never flatten
 * a shadow into nothing - and it is driven by `uSnowSky`, which
 * the atmosphere writes, so it dims to almost nothing at night on
 * its own rather than needing a second switch.
 */
const SNOW_SCATTER_FRAG = /* glsl */`
#include <lights_fragment_end>
{
  vec3 sfL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float ndl = dot(normal, sfL);
  /* Half-Lambert with an authored wrap. The subtraction is what
     keeps this honest: only the part BEYOND what the direct term
     already delivered is added, so a fully lit face gains nothing
     and the whole effect lives in the terminator and just past it. */
  float wrapped = clamp((ndl + uSnowWrap.x) / (1.0 + uSnowWrap.x), 0.0, 1.0);
  float lambert = max(ndl, 0.0);
  float skirt = max(wrapped - lambert, 0.0);
  reflectedLight.indirectDiffuse +=
    diffuseColor.rgb * uSnowSky * (skirt * uSnowWrap.y);
}
`;

/**
 * SPARKLE.
 *
 * art.js's GLITTER_FRAG is the ancestor and its failure is written
 * into the file: at 5.5 world cells and step(0.982) it produced
 * "hard white parallelograms - broken confetti, not glinting sand"
 * once the dune ripples started tilting the normal ten degrees
 * every 75cm, because an entire cell flips to full specular at
 * once. Sastrugi tilt the normal far harder than dune ripples do,
 * so a straight port would be worse here, not better.
 *
 * Three changes:
 *   - the cell is 34 per metre rather than 5.5, so a "grain" is
 *     about 3cm and a flipped cell is a point rather than a patch;
 *   - the threshold is a smoothstep rather than a step, so a
 *     grain lights and dies over a few degrees of view instead of
 *     switching;
 *   - the lobe is far tighter (exponent 220) and the whole term is
 *     multiplied by how close the pixel is, because a sparkle
 *     smaller than a pixel is just noise. It ends at 38m.
 *
 * The result is meant to be SPARSE. Roughly one grain in six
 * hundred is lit at any moment; more than that and a snowfield
 * reads as glitter glue.
 */
const SNOW_SPARKLE_FRAG = /* glsl */`
{
  float sd = length(cameraPosition - vSFWorld);
  float sfade = 1.0 - smoothstep(uSparkle.y * 0.45, uSparkle.y, sd);
  if (uSparkle.x > 0.0 && sfade > 0.001) {
    vec3 gp = floor(vSFWorld * 34.0);
    float gh = fract(sin(dot(gp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 gv = normalize(vViewPosition);
    vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float spec = pow(max(dot(reflect(-sunV, normal), gv), 0.0), 220.0);
    /* A grain has its own random facet orientation, so which grains
       are lit changes with the view. gh is both the selector and
       the jitter; sampling it twice at different scales would cost
       a second hash for no visible gain. */
    float pick = smoothstep(1.0 - uSparkle.x, 1.0 - uSparkle.x * 0.35, gh + spec * 0.28);
    outgoingLight += uSunHalo * pick * spec * uSparkle.z * sfade;
  }
}
#include <opaque_fragment>
`;

/**
 * ICE DEPTH.
 *
 * ANCHORED AT `normal_fragment_maps`, and the anchor is the whole
 * correctness of it. This is an ABSORPTION - it changes how much
 * light the surface had to work with - so it has to land on
 * `diffuseColor` before the lighting reads it. The obvious anchor,
 * `opaque_fragment`, is after the accumulation: tinting there is a
 * filter laid over a fully lit pixel, which is a different picture
 * and a duller one. It also happens to be the last chunk that
 * touches `normal`, which this needs.
 *
 * Nothing in SAINTFALL is transparent, and glacier ice still has
 * to look like something you can see INTO. Beer-Lambert does the
 * work: the path a ray takes through the ice is longest where the
 * surface is seen at a grazing angle, so absorption keyed on
 * `1 - |N.V|` reproduces the real behaviour - a serac's face pale
 * where it points at you and saturating to deep cyan around its
 * edges - with no second pass and no sorting.
 *
 * Ice absorbs RED, an order of magnitude more than blue. The
 * coefficients below are in that ratio, which is why the tint
 * arrives as cyan without a cyan ever being written: it is what
 * is LEFT.
 */
const ICE_DEPTH_FRAG = /* glsl */`
#include <normal_fragment_maps>
{
  vec3 iv = normalize(vViewPosition);
  float grazing = 1.0 - abs(dot(normalize(normal), iv));
  /* Squared, so the tint stays out of the middle of a flat face and
     concentrates at silhouettes and creases where the ray really is
     long. Linear read as a vignette painted on every polygon. */
  float path = grazing * grazing * uIceDepth.w;
  diffuseColor.rgb *= exp(-uIceDepth.xyz * path);
}
`;

const ICE_PARS = /* glsl */`
uniform vec4 uIceDepth;   // absorb r, g, b, path scale
`;

/* ============================================================
   MATERIALS

   `makeMaterials` from art.js supplies the shared archetypes -
   stone, rock, basalt, iron, bronze, cloth, glow, emissive and the
   rest - and this ADDS the alpine ones to the same library object,
   so `lib.get`, `lib.all` and `lib.transparentOf` keep working
   across both sets.

   Snow and ice cannot go through art.js's own `base()` helper,
   because that helper does not pass `extend` - the four fragment
   extensions above are the entire difference between snow and
   white plastic. They are built here instead, against the same
   MeshStandardMaterial spec, and patched directly.

   ONE TRAP, and art.js records it at `transparentOf`: an alpha
   variant re-patches from `userData.sfExtend` / `sfExtendKey`.
   Setting both (which `patchMaterial` does) is what stops a
   transparent copy of the ice coming back with the atmosphere
   intact and the depth tint silently gone.
   ============================================================ */

/** The shared uniform block for every snow-family material. One
 *  object per material because `patchMaterial` writes per-material
 *  scalars into `shader.uniforms`, but the VALUES here are authored
 *  once so two snow surfaces cannot drift apart. */
const SNOW_TUNING = {
  /* Wavenumbers are 2*PI / wavelength: 1.05m, 5.6m, 26m. Sastrugi
     are longer-waved than sand ripples because the slab they are cut
     from is stiffer, and the smallest one is deliberately above sand's
     0.75m - a snow surface has no grain scale to speak of, so a train
     that fine is just noise. */
  sastrugi: [5.984, 0.128, 1.122, 0.086],
  /* k3, slope3, crest albedo, undercut. Crest albedo is nearly double
     sand's 0.286-era value: the difference between scoured slab and
     fresh drift is a change of MATERIAL, so it is allowed to be seen. */
  sastrugi2: [0.242, 0.062, 0.115, 0.85],
  /* wrap, gain. 0.62 of wrap puts the terminator about 38 degrees past
     where Lambert would end it, which is roughly right for snow's
     transport mean free path at this scale. The gain is deliberately
     under a quarter: the term must round the terminator, never fill
     the shadow. */
  wrap: [0.62, 0.22, 0, 0],
  /* density, falloff distance, gain. See SNOW_SPARKLE_FRAG - the
     density is a THRESHOLD WIDTH, not a count, and 0.016 lights
     roughly one grain in six hundred. */
  sparkle: [0.016, 38, 1.35],
};

/** Ice absorption, in Beer-Lambert coefficients per unit path.
 *  Red is absorbed about eight times as hard as blue, which is the
 *  real ratio and the reason a glacier is cyan without anything
 *  cyan ever being authored. */
const ICE_TUNING = {
  glacier: [1.35, 0.42, 0.17, 1.0],
  /* Black ice on the tarn is thin over dark water, so the path
     scale is short and the absorption is nearly neutral - it goes
     DARK rather than cyan, which is the whole difference between
     the Tarn and the Tongue. */
  black: [0.55, 0.48, 0.40, 2.6],
  /* The Cascade's columnar ice is the thickest in the level and the
     only place the tint is allowed to run to saturation. */
  cascade: [1.75, 0.52, 0.20, 1.35],
};

function vec4(THREE, a) { return new THREE.Vector4(a[0], a[1], a[2], a[3]); }

/** The snow extension: sastrugi relief, multiple scattering, sparkle. */
function snowExtend(THREE, tuning) {
  return (shader) => {
    shader.uniforms.uSastrugi = { value: vec4(THREE, tuning.sastrugi) };
    shader.uniforms.uSastrugi2 = { value: vec4(THREE, tuning.sastrugi2) };
    shader.uniforms.uSnowWrap = { value: vec4(THREE, tuning.wrap) };
    shader.uniforms.uSnowSky = { value: new THREE.Color(0.42, 0.55, 0.86) };
    shader.uniforms.uSparkle = {
      value: new THREE.Vector3(tuning.sparkle[0], tuning.sparkle[1], tuning.sparkle[2]),
    };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SNOW_PARS}`)
      .replace("#include <normal_fragment_maps>", SASTRUGI_FRAG)
      .replace("#include <lights_fragment_end>", SNOW_SCATTER_FRAG)
      .replace("#include <opaque_fragment>", SNOW_SPARKLE_FRAG);
  };
}

/** The ice extension: depth absorption only. Ice gets no sastrugi
 *  (it is not a drift) and no scattering skirt (it is not a
 *  scatterer at this scale) - what it has is thickness. */
function iceExtend(THREE, absorb) {
  return (shader) => {
    shader.uniforms.uIceDepth = { value: vec4(THREE, absorb) };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${ICE_PARS}`)
      .replace("#include <normal_fragment_maps>", ICE_DEPTH_FRAG);
  };
}

/**
 * Build the Kenosis material library.
 *
 * Returns the object art.js's `makeMaterials` returns, with the
 * alpine archetypes added to the same `all` map so `get` and
 * `transparentOf` reach every surface in the level.
 */
export function makeSummitMaterials(THREE, atmos) {
  const lib = makeMaterials(THREE, atmos);
  const made = lib.all;

  function add(name, spec, extend, extendKey) {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: spec.vertexColors !== false,
      flatShading: spec.flat !== false,
      roughness: spec.roughness ?? 0.95,
      metalness: spec.metalness ?? 0.0,
      side: spec.side || THREE.FrontSide,
      envMapIntensity: 1,
    });
    m.name = `sf-${name}`;
    patchMaterial(m, atmos, {
      rim: spec.rim, glitter: spec.glitter || 0, extend, extendKey,
    });
    made.set(name, m);
    lib[name] = m;
    return m;
  }

  /* ---------------------------- snow ----------------------------
     SMOOTH-SHADED, and for exactly the reason art.js gives for sand:
     the faceting that makes this world read as low-poly comes from
     the rock, the seracs and the architecture standing on the snow,
     not from the snow itself. Flat-shading a drift throws away the
     one surface that is supposed to be silk - and here it would also
     fight the sastrugi relief, which is a per-pixel normal and needs
     a smooth one underneath it to perturb. */
  add("snow", {
    flat: false, roughness: 0.92, rim: 0.75,
  }, snowExtend(THREE, SNOW_TUNING), "snow");

  /* Wind slab. The same shader with the relief pushed and the
     scatter pulled: a slab is compacted, so it carries MORE carved
     shape and LESS subsurface glow than a drift. */
  add("slab", {
    flat: false, roughness: 0.78, rim: 0.9,
  }, snowExtend(THREE, {
    ...SNOW_TUNING,
    sastrugi: [5.984, 0.205, 1.122, 0.138],
    sastrugi2: [0.242, 0.088, 0.148, 1.0],
    wrap: [0.34, 0.11, 0, 0],
    sparkle: [0.009, 30, 0.9],
  }), "slab");

  /* Fresh powder, for the deepest lee drifts and for the skin that
     beds a prop into its own snow. Almost no relief - powder has not
     been carved yet - and the strongest scattering in the level. */
  add("powder", {
    flat: false, roughness: 0.97, rim: 0.62,
  }, snowExtend(THREE, {
    ...SNOW_TUNING,
    sastrugi: [5.984, 0.036, 1.122, 0.028],
    sastrugi2: [0.242, 0.022, 0.055, 0.35],
    wrap: [0.78, 0.30, 0, 0],
    sparkle: [0.026, 42, 1.7],
  }), "powder");

  /* ----------------------------- ice ----------------------------- */

  /* Glacier ice IS faceted - it fractures in planes, and every serac
     in the Tongue is a fracture surface. This is the one place in the
     level where flat shading is the physical answer rather than the
     stylistic one. */
  add("glacierIce", {
    roughness: 0.24, rim: 1.45, glitter: 0.12,
  }, iceExtend(THREE, ICE_TUNING.glacier), "ice-glacier");

  add("cascadeIce", {
    roughness: 0.18, rim: 1.6, glitter: 0.16,
  }, iceExtend(THREE, ICE_TUNING.cascade), "ice-cascade");

  /* Black ice is nearly a mirror and takes its colour from the sky,
     so it is SMOOTH-shaded and the roughness is the lowest in either
     level. Metalness stays at zero - the lesson art.js records three
     times over (bronze, verdigris, gold) is that past about 0.6 the
     albedo becomes specular F0 and the surface stops showing its own
     colour. A dielectric at roughness 0.10 reflects plenty. */
  add("blackIce", {
    flat: false, roughness: 0.10, rim: 1.15,
  }, iceExtend(THREE, ICE_TUNING.black), "ice-black");

  /* ------------------------- rock and rime ------------------------- */

  /* Granite. Faceted, and slightly rougher than Vesper's rock: this
     is frost-shattered stone, not wind-polished. */
  add("granite", { roughness: 0.96, rim: 1.0 });
  /* The wind-polished variant, for the summit cone's windward faces
     and the exposed ribs of every spur. */
  add("graniteScoured", { roughness: 0.72, rim: 1.2, glitter: 0.05 });

  /* Rime. Bright, matte and nearly rangeless - its shape is carried
     by the feathers, which are geometry, so the material must not
     add relief of its own or the two fight. Scattering only. */
  add("rime", {
    roughness: 0.99, rim: 0.85,
  }, snowExtend(THREE, {
    ...SNOW_TUNING,
    sastrugi: [5.984, 0.0, 1.122, 0.0],
    sastrugi2: [0.242, 0.0, 0.0, 0.0],
    wrap: [0.70, 0.26, 0, 0],
    sparkle: [0.020, 26, 1.15],
  }), "rime");

  /* Moraine scree and the dirty ice the glacier carries. */
  add("scree", { roughness: 0.98, rim: 0.9 });

  /* The Fumarole Steps: wet black basalt under a sulphur crust. The
     wetness is the point - it is the only non-white specular in the
     level and it is what makes the steam read as steam. */
  add("sulphur", { roughness: 0.82, rim: 1.05 });
  add("basaltWet", { roughness: 0.34, rim: 1.3 });

  /* The Rime Forest's dead wood, under its armour. */
  add("bark", { roughness: 0.98, rim: 0.85 });

  return lib;
}

/* An alias, because half the level calls it glacier ice and the
   other half calls it blue ice. */
export { GLACIER_RAMP as BLUEICE_RAMP };
