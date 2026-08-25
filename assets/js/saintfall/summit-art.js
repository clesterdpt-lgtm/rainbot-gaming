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
  /* --- SNOW IN SHADOW IS STILL SNOW -----------------------------
     These three were a night-blue ramp: 2c4373 is 17/26/45 percent,
     and painting the dark end of a SNOW ramp at 17 percent says the
     surface absorbs five sixths of the light that reaches it. Snow's
     albedo is about 0.85. What makes shadowed snow dark is not the
     snow, it is that the only thing lighting it is the sky - and the
     sky is bright. Getting this wrong did not show while the level
     was lit almost entirely by ambient, because nothing was ever
     properly in shadow. The moment the sun's shadow map was wired up
     correctly the real shadows landed on this ramp and blind review
     came back with "reads as water", "slate-navy", "painted metal"
     across five frames.
     Rebuilt so the darkest snow sits at 58 percent and stays blue by
     HUE rather than by level - which is the actual difference between
     a shadow on snow and a hole in it. */
  snowShade: "#93a6c6",
  snowShadeLit: "#a8bad6",
  snowCool: "#c2cee4",
  snowMid: "#c3d0e4",
  snowLit: "#e4e6ee",
  snowCrest: "#f0ecec",
  snowSunlit: "#f6e7dc",

  /* wind slab - harder, bluer, and a shade darker than fresh snow
     because it is compacted and scoured rather than fluffy. */
  slabShade: "#2b3f61",
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
/* THE UPPER HALF WARMS AND LIGHTENS, and it is a correction found at
   EYE LEVEL rather than from the air.

   The first table ran blue-grey from #95abcf through #c3d0e4 to
   #e4e6ee - defensible stops for snow, and measured on the arrival
   frame they look right, because that frame is nearly all
   mountainside catching a raking key. At 1.75m the picture is
   different: most of it is HORIZONTAL ground, which at a 15 degree
   sun takes 0.26 of the key and therefore sits in the ramp's middle,
   and a 40%-saturated blue at 83% lightness under a warm key mixes
   to grey. The basecamp read as wet asphalt.

   The dark end is untouched - shaded snow going saturated blue is
   the whole colour idea and the header argues it at length. What
   moved is 0.55 upward, toward the warm near-white that snow
   actually is when light reaches it, so the ramp now travels from
   blue to warm across its range instead of from blue to pale blue.
   That hue journey is what the eye reads as sunlight on snow. */
export const SNOW_RAMP = makeRamp([
  [0.00, K.snowShade],
  [0.16, K.snowShadeLit],
  [0.34, K.snowCool],
  /* THE UPPER HALF WENT BACK TO COOL, and the reason is a lesson
     about where warmth should come from.

     It was warmed to #f6f2ee to stop flat ground reading grey at a
     7-degree sun. That worked, and then the sun went to 24 degrees
     to clear the encircling range - which put four times as much
     warm key on every horizontal surface in the level. The two
     changes compounded: the valley pan came back at saturation 51
     and hue 332, and it read as SAND. A snow level whose ground is
     beige has lost the argument before any of the rest matters.

     Alpenglow belongs to the LIGHT, not to the albedo. The sun is
     #ffdcc0 and the horizon band is peach; a neutral-cool snow
     under them still comes out warm where the key lands and stays
     blue where it does not, which is the hue swing this whole
     palette is built on. Warming the pigment as well collapses that
     swing into one colour. */
  [0.55, "#cfd8ea"],
  [0.74, "#e2e7f0"],
  [0.90, "#eef1f5"],
  [1.00, "#f7f9fb"],
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

/**
 * Granite, and the dark end is much LIGHTER than instinct says.
 *
 * The first table bottomed out at #22262a - a defensible colour for
 * rock, and completely wrong for this level. Every wall on Kenosis
 * is lit by a 7-degree key, so most of the masonry area in any
 * frame is taking fill only; drop the ramp's dark end into the
 * twenties and the entire architecture of the level renders as a
 * black silhouette against a bright sky. Measured on the first
 * parvis frame: the cathedral, its spire, the parapet and both
 * basecamp buttresses all came out under sRGB 20, and it read as a
 * missing material rather than as a dark ramp.
 *
 * Two changes. The floor is up by two and a half stops, and it is
 * BLUER than the mid-tones - shaded stone here is lit by the same
 * deep zenith the snow is, so it belongs on the same hue journey.
 * The light end is warmer, because the only stone that gets the
 * key is the stone the alpenglow reaches.
 */
export const GRANITE_RAMP = makeRamp([
  [0.00, "#4a5364"],
  [0.22, "#5c6570"],
  [0.48, K.graniteMid],
  [0.76, K.graniteLit],
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

/* And the same again for the Rime Forest: at #241d1c a stand of
   eighty trees against snow is eighty black sticks. */
export const BARK_RAMP = makeRamp([
  [0.00, "#41393a"],
  [0.44, K.barkMid],
  [0.80, K.barkLit],
  [1.00, "#8a7263"],
]);

/* Same argument as the granite's dark end, one material along: an
   unlit bronze bell against a bright sky is a hole in the frame. */
export const BELL_RAMP = makeRamp([
  [0.00, "#514a35"],
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

/* THE SUN'S AZIMUTHS ARE ENGINE AZIMUTHS, NOT COMPASS BEARINGS.

   `direction()` in art.js resolves an azimuth as
   `(x, z) = (sin az, cos az)`, and +Z is SOUTH on both worlds - so
   compass north is -Z, which is azimuth 180, and compass east is
   +X, which is azimuth 90. The mapping is a REFLECTION,
   `az = 180 - compass`, not the offset it reads as.

   Every row below was first written with the compass bearing typed
   straight in, and the result is worth recording because it cost a
   whole review round to see: at "158" the alpenglow sun sat NNE
   instead of SSE, which put the cathedral's south front, the
   basecamp's approach and the entire east flank of the mountain in
   shadow. Nothing looked broken. The sky was still beautiful, the
   snow still bright, the halo still in the right place relative to
   a sun that was simply on the wrong side of the level - and every
   piece of architecture in the game rendered as a black
   silhouette, which reads as a material bug rather than a lighting
   one, and was very nearly fixed as one.

   Compass bearings, for the record, and derive from them:
     alpenglow SSE 157   noon S 180   blue hour WNW 293
     the vigil's moon NE 45   whiteout SSE 157
   ============================================================ */
export const SUMMIT_TIMES = {
  /* The default, and the composition the level was laid out for: a
     7-degree sun from the south-south-east, so the ascent's east
     flank is lit, its west flank is in blue shadow, and the summit
     cathedral is rim-lit from behind the player's shoulder. */
  goldenhour: {
    label: "Alpenglow",
    /* compass ESE 110, and the bearing is a COMPOSITION decision
       rather than a plausibility one.

       At SSE the sun sat behind the arrival camera, which looks
       north from the basecamp gate at the level's most important
       frame - and a front-lit subject has no form. The mountain
       rendered as one pale mass with its own ridge noise as the
       only structure in it, which reads as fur. Nothing was broken;
       the light was simply in the one place that flattens the shot.

       At ESE the key rakes ACROSS the arrival view: the east flank
       takes it, the west flank falls into the blue shade the whole
       colour idea depends on, and every spur between them casts
       down its own gully. That is what the art direction asks for
       in as many words, and it is why the row moved. It still
       clears the cathedral's south front (z stays positive), so the
       parvis shot keeps its lit facade. */
    sunAzimuth: 70,
    /* 15 degrees, not 7.2, and the reason is the GROUND PLANE.

       At 7.2 the key strikes flat snow at sin(7.2) = 0.125, so the
       surface that fills most of every eye-level frame in the level
       was taking an eighth of the sun and living on ambient. It
       measured as snow and read as wet grey concrete: the arrival
       shot looked right because it is mostly mountainside, and the
       moment the camera came down to 1.75m the level went flat and
       colourless.

       Doubling the elevation doubles the light on every horizontal
       surface in the game and costs almost nothing in raking: 15
       degrees still throws shadows four times an object's height,
       still rims every sastrugi crest, and is within a degree and a
       half of Vesper's own golden hour, which was cut against the
       same tone curve. The alpenglow is carried by the sun's COLOUR
       and the horizon band, not by grazing the horizon. */
    /* 24 degrees, and the number is set by the ENCIRCLING RANGE
       rather than by taste.

       Measured looking straight down at the basecamp pan: the frame
       renders at 38.8 with shadows and 79.1 without. The ground is
       in shade, and raising the shadow bias ninefold only recovers
       it to 46.5 - so it is not acne, it is a real shadow. The range
       added to seal the level is 119-310m tall and stands 400-600m
       out from the ring valley; at a 15 degree sun an obstacle 500m
       away shadows everything shorter than 134m behind it, so the
       barrier was laying its own shadow across the arrival area and
       every station in the ring.

       That is what a real valley does at dawn and it is the wrong
       picture for the level's first frame, so the sun goes up until
       it clears: 24 degrees needs a 222m obstacle at that distance,
       which only the highest crests reach. It is still a raking key -
       shadows run 2.2x an object's height - and Vesper's own noon
       sits at 62 for comparison.

       This is the cost of the barrier, and it is worth paying: a
       level you can walk out of is worse than a level whose sun is
       nine degrees higher. */
    /* --- 15 DEGREES, AND WHY IT WENT UP IN THE FIRST PLACE -------

       This was raised 15 -> 24 early in this work to fix a real and
       measured fault: the level was lit almost entirely by ambient,
       and the key's contribution to the frame measured 3%. Raising
       the sun fixed that - the key's share went to 64%.

       It also cut every shadow in the level nearly in half. Shadow
       length is height over tan(elevation), so 24 degrees gives 22.5m
       from a 10m object where 13.5 gives 41.7m. Measured against
       Vesper on the same engine, with an identical shadow map, span,
       texel and bias, the whole built world here - cathedral,
       colonnade, every prop - contributes 0.6-0.9% of frame in cast
       shadow against Vesper's 3.7%. Nearly every blind round since r8
       has reported some form of "nothing casts a shadow", and this is
       the mechanism: not a broken shadow map, a short one.

       The reason for raising it is gone. The ambient problem was
       fixed at its source instead - the scene fill is 0.36, snow
       takes 26% of that, and snow has its own floor - so the key now
       dominates because the fill is small rather than because the sun
       is high. Vesper runs 13.5 degrees at 4.75 intensity; this is
       the same neighbourhood, with the intensity raised to pay for
       the longer atmospheric path. */
    sunElevation: 15.0,
    /* Cleaner than the desert's #ffd6a0. At 4km of altitude there is
       far less atmosphere to redden the light; what makes alpenglow
       pink is the SNOW picking up the horizon band, not the key
       itself being orange. Overcooking the key here is what turns a
       mountain into a sand dune with a white texture. */
    sunColor: "#ffdcc0",
    sunIntensity: 4.15,
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
    /* MEASURED, AND IT OVERTURNS THIS FILE'S OWN FIRST INSTINCT.

       The header argued that a snowfield is an enormous bounce card
       and that underlighting it is what makes snow read as chalk -
       which is true of the real world and wrong for this renderer.
       The fill here is a HEMISPHERE plus a convolved environment: it
       has no direction, so every unit of it removes form everywhere
       at once. Vesper runs 0.52 under a key on sand with an albedo
       of 0.30; at 0.82 over snow at 0.85 the ambient was carrying
       most of the light on most of the pixels, and the mountain
       rendered as one pale mass with its own ridge noise as the
       only structure in it.

       Swept on the arrival frame at high, holding everything else:
       cutting the fill to a third took the frame's standard
       deviation from 41.5 to 52.2, a 26% gain in contrast. The same
       sweep raised the key by half and moved the frame by 0.1 - the
       key was never the missing term. Exposure comes up to pay for
       the light removed, so the change is contrast, not darkness. */
    /* 0.26. The same argument as the first cut from 0.82, one step
       further: the fill is non-directional, so every unit of it
       raises the darkest thing in the frame as much as the
       brightest. Taking it down is what lets the shadow side of the
       mountain reach a real black while the lit side does not move. */
    /* 0.40. This was dropped to 0.26 and the grade's toe raised to
       1.44 in the SAME pass, to answer a review that said the level
       had no blacks. Two darkening levers at once over-corrected:
       measured across the beauty set, 10.1% of all pixels ended up
       under 15% luma, with four frames over a quarter black and the
       Cascade lip at 56%. Blind review came back with "every non-snow
       surface crushed to one hueless black" - stone, ice, metal and
       wood all at the same near-zero, so nothing had a material
       response and a horizon trunk was as black as one at 20m.

       This is the right lever to give back, because it is the SKY
       FILL: `skyFill.intensity` is envIntensity * 0.72, its colour is
       the sky and its groundColor is the bounce, so raising it lifts
       shadow sides toward cool daylight rather than lifting the whole
       frame toward grey. The toe comes back to 1.32 rather than all
       the way to 1.26 - the original complaint was real too. */
    /* --- 0.22. THE FILL IS WHY THE SNOW HAS NO SHADOW SIDE -------

       This has now been moved twice in opposite directions and both
       moves were right about the evidence in front of them. It went
       0.36 -> 0.26 to answer "the level has no blacks", then 0.26 ->
       0.40 when that (together with a toe raise in the same pass)
       had put 10.1% of all pixels under 15% luma and blind review
       came back with "every non-snow surface crushed to one hueless
       black".

       What both passes missed is that those are different surfaces.
       A hemisphere fill is the only thing lighting the shadow side of
       a rock, and it is ALSO what stops snow ever having a shadow
       side - snow is 0.85 albedo, so it takes the fill and returns
       nearly all of it. At 0.40 the shaded side of every drift sits
       around 60% luma, which is why five rounds running have said
       "no true black anywhere", "one compressed high band", and most
       precisely: "rake a surface whose shadows bottom out at 60% grey
       and you get embossing, not carving".

       So the fill comes down to where shaded snow can reach the
       25-35% the reviewers keep asking for, and the crush it caused
       last time is answered where it actually belongs - in the rock
       and prop ramps, not by flooding the whole level with ambient.
       `skyFill` is tinted from the sky, so what shaded snow loses in
       level it keeps in hue. */
    /* --- 0.36, NOW THAT SNOW CUTS ITS OWN ------------------------

       This number has been moved four times because it was being
       asked to do two contradictory jobs: it is the only thing
       lighting the shadow side of a rock, and it was also the reason
       snow never had a shadow side. Every setting traded one for the
       other - 0.40 lit the rock and flattened the snow, 0.22 gave
       the snow its darks and blind review immediately reported "the
       cliff mass is crushed to a featureless black slab, zero
       mid-tone detail on a 200m object" across four frames.

       The contradiction is gone now that the snow shader scales its
       OWN indirect term (see uSnowWrap.z). Snow takes 42% of this;
       rock, iron, bronze and bark take all of it. So the global fill
       goes back up to where stone reads, and the snow keeps the
       shadow it just earned. */
    envIntensity: 0.36,
    fogDensity: 0.00058,
    fogHeightFalloff: 0.0165,
    fogStart: 55,
    /* 0.72, down from 1.20. `sunScatter` multiplies BOTH of the
       dome's lobes, and the wide one is `pow(mu, 3.0) * 0.16` -
       a term with a half-angle around 50 degrees. At 1.20 it put a
       soft white wash over roughly a quarter of any frame with the
       sun in it, which a blind reviewer read as a second sun: "an
       unmotivated bloom halo in the emptiest corner, and it is the
       brightest thing in frame." A low sun should have a tight
       aureole and a bright horizon band, not a hemisphere of glare. */
    sunScatter: 0.72,
    /* Two thirds of a stop down, which is the blind review's own
       prescription for the value compression below. */
    exposure: 0.92,
    grade: "alpenglow",
  },

  /* High sun. Brutal, flat, and the hardest light in the level -
     which is what it is for: it is the only time of day that shows
     the mountain's real shape without alpenglow doing the work. */
  noon: {
    label: "White Noon",
    sunAzimuth: 0,    // compass S 180
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
    envIntensity: 0.52,
    fogDensity: 0.00042,
    fogHeightFalloff: 0.0195,
    fogStart: 70,
    sunScatter: 0.5,
    exposure: 0.90,
    grade: "glare",
  },

  /* Blue hour. The sun is gone, the snow is entirely sky-lit, and
     the nine braziers on the parvis become the only warm thing on
     the mountain. This is the level's portrait light. */
  dusk: {
    label: "Blue Hour",
    sunAzimuth: 247,    // compass WNW 293
    sunElevation: -1.4,
    sunColor: "#8fa6d8",
    sunIntensity: 1.05,
    skyZenith: "#101f4e",
    skyHigh: "#26417c",
    skyHorizon: "#6b6ba0",
    skyLow: "#a08cad",
    sunHalo: "#c8b4d8",
    haloSpread: 0.42,
    /* Blue hour keeps the highest fill in the table and it is the one
       row where that is right: the sun is BELOW the horizon, so the
       sky IS the key and there is no directional term left to
       protect. */
    groundBounce: "#4a5a86",
    envIntensity: 0.95,
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
    sunAzimuth: 135,    // compass NE 45 - the moon
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
    envIntensity: 0.92,
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
    sunAzimuth: 70,    // compass ESE 110, as alpenglow
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
  Object.freeze({ phase: 0.00, key: "goldenhour", sunAzimuth: 88, sunElevation: 24.0 }),
  Object.freeze({ phase: 0.27, key: "noon", sunAzimuth: 0, sunElevation: 58 }),
  Object.freeze({ phase: 0.54, key: "dusk", sunAzimuth: 247, sunElevation: -1.4 }),
  Object.freeze({ phase: 0.74, key: "night", sunAzimuth: 135, sunElevation: 27 }),
  Object.freeze({ phase: 1.00, key: "goldenhour", sunAzimuth: 88, sunElevation: 24.0 }),
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
    /* 1.44, up from 1.26. The GT curve's toe exponent only has
       authority below the linear midpoint (m = 0.22), so this
       darkens the bottom of the range and cannot touch the snow,
       the sky or a highlight - which is exactly the half of the
       histogram a blind reviewer found missing: "snow, ridge and
       sky all sit between 60% and 85%, with one small black slot as
       the only dark." A white world still needs a black in it or
       every frame is one value. */
    toe: 1.32,
    /* Deep shade goes BLUE and stays saturated - the single most
       important number in this file. Vesper desaturates toward a
       violet because desert shade is lit by a pink horizon; snow
       shade is lit by a deep blue zenith and gets MORE chromatic
       as it darkens, not less. The amount is high and the knee is
       high with it, because on this world the shaded half of the
       mountain is most of the frame. */
    /* THE KNEE CAME DOWN, and the arena floors are why.

       This term desaturates toward `shadeHue` below a linear-luma
       knee, and it exists so deep shade goes blue instead of going
       to a dark version of the key. At a knee of 0.30 it was also
       catching FLAT GROUND: horizontal snow under a 15 degree sun
       lands near 0.28 linear, which is inside the term's authority,
       so every arena floor and the whole valley pan was pulled
       toward #4f74c4 and read as wet grey asphalt with a hard edge
       where the field ended. Raising the exposure and warming the
       ramp both failed to shift it, because neither is what was
       doing it.

       0.16 puts the knee below the lit ground and leaves it on the
       shadow side of every ridge, which is the half of the range the
       term was written for. */
    /* --- THE SHADE BLOCK WAS SWITCHED OFF BY ITS OWN KNEE --------

       `uShade` is [amount, knee] and the knee is THE LUMA THE TERM
       DIES AT. At 0.16 it was dead everywhere in this level: the
       grade header eleven lines above states the measurement itself -
       "a snow field under a 3.35 key runs a median near 0.6" - and
       that number was used to set the `ao` knee and then not applied
       here. So the one term whose job is to deepen the shadow side
       has never once fired on a snow frame.

       That is the missing black. Blind review has said so in five
       different rounds ("no true black anywhere", "one compressed
       high band", "the darkest pixel is a mid-grey"), and the last
       one put its finger on why it matters now: rake a surface whose
       shadows bottom out at 60% grey and you get embossing, not
       carving. The raking-light fix and this one multiply; neither is
       worth much alone.

       Knee to 0.58, just under the measured median, so the term has
       authority through the shade and none in the lit crests. */
    shade: [0.52, 0.58],
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
    /* --- THE KNEE MUST NOT LAND INSIDE THE LEVEL'S OWN LUMA -------

       The second number is the key-luma knee: above it, occlusion
       stops darkening the surface, so a sunlit face is not dirtied by
       its own ambient term. On a level with a range of surface
       brightnesses that is exactly right.

       This level does not have a range. It is snow, at 0.85 albedo,
       under one key - so nearly all of its ground sits within a
       stop of the same luma, and a knee at 1.95 fell in the MIDDLE of
       that. The result is a hard iso-contour on open ground where
       occlusion switches off: a large, flat, brighter-than-its-
       surroundings polygon with straight edges, sitting in the near
       field of the level's most-photographed frame. A blind reviewer
       called it "a flat untextured white hexagon - an obvious
       unshipped plane" and lost the frame on it alone.

       It cost four wrong diagnoses before an A/B found it - the
       powder material's relief, the drift-collar tail, the contact
       term's authority, and the shadow map - because it looks like
       geometry and raycasts as terrain. (The contact-term A/B was
       itself misread: the probe applied its mutations cumulatively,
       so the frame credited to the contact term had AO already off.)

       5.6 puts the knee clear above anything the level produces, so
       occlusion applies evenly and there is no contour to see. */
    ao: [0.74, 5.60],
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
    /* `makeAtmosphere` defaults its storm GRADE to the key "storm",
       and Kenosis calls that grade "whiteout" - the storm TIME is
       named `storm`, the grade it selects is not. Every other table
       is handed over here and this one was missed, so the whiteout
       preset resolved its grade to undefined and `blendGrade` died
       on it: `?time=storm` has never booted on this level. It only
       bites at a non-zero storm mix, which is why nothing else ever
       touched it - blendGrade returns early at t = 0. */
    stormGrade: "whiteout",
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

/* THE TINTS ARE MUCH WEAKER THAN THEY LOOK LIKE THEY SHOULD BE, and
   the reason is that they multiply a surface whose whole identity is
   that it is WHITE.

   A district tint on Vesper sits on sand at albedo 0.30 and reads as
   a shift of hue. The same strength on snow at 0.85 reads as a
   change of MATERIAL: the Basecamp's `#8a8d7e` at 0.16 turned its
   arena into a disc of wet grey asphalt with a hard edge where the
   field ended, and at eye level the whole landing zone looked like a
   car park with a mountain behind it. The tint was doing exactly
   what it was authored to do and the authored value was wrong by a
   factor of two.

   So: every grey pulled up toward the snow it is tinting, and every
   strength roughly halved except the three stations whose ground
   genuinely is not snow - the Black Tarn's ice, the Fumarole's
   sulphur crust and the Glacier's blue ice. Those three are the
   places a strong tint is the point. */
export const STATION_TINT = {
  basecamp: { snow: -0.05, tint: "#c2c4ba", strength: 0.08 },
  tarn: { snow: -0.34, tint: "#31465f", strength: 0.34 },
  bowl: { snow: 0.14, tint: "#eef2f8", strength: 0.08 },
  glacier: { snow: -0.24, tint: "#5aa0b8", strength: 0.30 },
  rime: { snow: 0.04, tint: "#ccd2d8", strength: 0.11 },
  fumarole: { snow: -0.44, tint: "#a8791f", strength: 0.42 },
  cascade: { snow: -0.18, tint: "#7fc2d4", strength: 0.26 },
  bell: { snow: -0.08, tint: "#aab0a6", strength: 0.12 },
  summit: { snow: -0.14, tint: "#c4c8c4", strength: 0.10 },
  road: { snow: -0.26, tint: "#9a968c", strength: 0.12 },
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

/* --- WHY THERE IS NOISE IN HERE AND NOT MORE SINES ----------------

   The relief below was three cosine trains. Four rounds were spent
   trying to stop it reading as a printed pattern: the amplitude was
   halved, the patch mask floor was dropped, the phase was
   domain-warped, and finally all three trains were given their own
   steered headings. Each of those was a real improvement to a real
   defect and NONE of them fixed the tell, because a sum of periodic
   functions is periodic. Crossing three of them at 37 and -61
   degrees does not produce irregularity, it produces a lattice - the
   frame after that change was a regular basket weave, which is worse
   than the stripes it replaced and would alias harder.

   Sastrugi are not a waveform. They are erosional: sharp crests and
   scoured hollows, no two alike, no spacing repeated. That needs
   noise, and specifically RIDGED noise, where the absolute value
   folds the field and makes a crease where a sine would round over.

   Two octaves, not four - this frame is fill-bound, and the gradient
   needs three evaluations of whatever this is, so every octave costs
   three times what it looks like it costs. */
float sfHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float sfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sfHash(i), sfHash(i + vec2(1.0, 0.0)), u.x),
             mix(sfHash(i + vec2(0.0, 1.0)), sfHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sfRidge(vec2 p) {
  float a = 1.0 - abs(2.0 * sfNoise(p) - 1.0);
  float b = 1.0 - abs(2.0 * sfNoise(p * 2.17 + 4.3) - 1.0);
  return a * 0.68 + b * 0.32;
}
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
  /* AND IT FADES WITH DISTANCE. The fwidth term already kills a train once
     it reaches pixel scale, but that is an aliasing guard, not an
     art decision: a snowfield's micro-relief is a near-field
     property, and holding it out to the horizon is a large part of
     what makes a whole valley look moulded. Gone by 220m. */
  /* 160-420m, not 90-220. This is the ART fade - "micro-relief is a
     near-field property" - and it was cut when the aliasing guard
     below was still killing the field at thirty metres anyway, so its
     range was never the binding constraint and never got revisited.
     With the guard moved to Nyquist it IS the binding constraint, and
     two reviewers independently found the same thing: the relief that
     works is "the only snow frame with real near-field relief", and
     "relief lives in the first 20-40m". Aliasing is not the risk here
     - the fwidth term owns that and owns it at the correct limit. */
  sfFlat *= 1.0 - smoothstep(160.0, 420.0, length(cameraPosition - vSFWorld));
  if (sfFlat > 0.002) {
    vec2 p = vSFWorld.xz;
    /* Bearing 292, the world's one wind. Constant rather than a
       uniform: the blowing-snow fields animate along the wind and
       relief that swung with them would read as the whole mountain
       rotating. */
    /* THE HEADING AND THE WAVELENGTH BOTH DRIFT, and this is the
       single change a blind review asked for by name.

       Three trains on one fixed heading at fixed wavelengths is a
       single-frequency parallel wave, and over the largest surface
       in the level that reads as corrugated plastic. It was called
       in eight of our frames in one round: "the ground reads as
       moulded plastic rather than terrain".

       DUNE_FRAG's rule - which this file inherited - is that trains
       at DISCRETE headings print plaid at a grazing angle. That rule
       is correct and is not what is being broken here. A heading
       that varies CONTINUOUSLY over hundreds of metres cannot
       cross-hatch: there is only ever one local direction, it just
       is not the same one two hundred metres away. It is also what a
       real snowfield does, because the wind that carved it is
       steered by the ground it crosses.

       So the wind axis rotates through a slow field of about +/-17
       degrees and the wavelength scales between 0.72x and 1.34x on a
       second, offset field - offset because two effects sharing one
       mask read as one effect. Both are sines rather than a texture
       because they have to be exactly continuous and cost nothing. */
    /* --- THE VARIATION HAS TO BE SMALLER THAN THE WORLD ------------

       Both of the mechanisms that were supposed to keep this field
       from reading as a print operated at scales LARGER THAN THE
       MAP. The heading steered on 3471m, 2768m and 5280m; the
       wavelength scaled on 4393m and 6477m. The level is 2048m
       across. So over the whole mountain there was effectively one
       heading at one wavelength - which is, word for word, what a
       blind reviewer wrote after four rounds of tuning: "one heading
       at one fixed world-space wavelength reads as a printed
       pattern, not weather."

       This is the same mistake as the patch mask's 174m lobes and
       it is worth naming: a variation term whose period exceeds the
       thing it varies is not weak, it is ABSENT. The numbers all
       looked like variation in the source.

       Steering is now 190m / 112m / 70m at +-45 degrees, so two
       patches twenty metres apart genuinely disagree.

       And the three trains now have their OWN headings rather than
       one heading with the gradient basis nudged. Crests perpendicular
       to a single direction are ribs however many frequencies you
       stack on them; crests at 37 and -61 degrees to each other
       interfere, and interference is what sastrugi actually looks
       like. The offsets are deliberately not commensurate, and they
       are scaled by the steer at different rates so even the ANGLES
       BETWEEN the trains drift across the map. */
    const vec2 wdir0 = vec2(-0.9272, -0.3746);
    /* Two terms, not three, and half the swing. At +-45 degrees over
       a 70m third term the heading turned fast enough that the crest
       lines curved back on themselves, and the ground photographed as
       polished marble - "concentric marble swirls" in review. Sastrugi
       are LOCALLY LINEAR: the heading drifts across a slope, it does
       not rotate underfoot. 190m and 112m at +-22 degrees keeps two
       patches a stride apart disagreeing without either of them
       curving. */
    float steer = (sin(p.x * 0.0331 + 0.7) + sin(p.y * 0.0562 + 2.1)) * 0.19;

    float ang1 = steer;
    float ang2 = steer * 0.63 + 0.646;
    float ang3 = steer * 1.31 - 1.064;
    vec2 d1 = vec2(wdir0.x * cos(ang1) - wdir0.y * sin(ang1),
                   wdir0.x * sin(ang1) + wdir0.y * cos(ang1));
    vec2 d2 = vec2(wdir0.x * cos(ang2) - wdir0.y * sin(ang2),
                   wdir0.x * sin(ang2) + wdir0.y * cos(ang2));
    vec2 d3 = vec2(wdir0.x * cos(ang3) - wdir0.y * sin(ang3),
                   wdir0.x * sin(ang3) + wdir0.y * cos(ang3));
    vec2 q1 = vec2(-d1.y, d1.x);
    vec2 q2 = vec2(-d2.y, d2.x);
    vec2 q3 = vec2(-d3.y, d3.x);

    /* Wavelength scaling, also brought inside the map: 133m and
       209m rather than 4393m and 6477m. */
    float lam = 1.0 + 0.31 * (sin(p.x * 0.0472 - 1.3) + sin(p.y * 0.0301 + 0.4));
    vec2 wdir = d1;
    vec2 wper = q1;
    float along = dot(p, d1) / lam;
    float across = dot(p, q1);
    float along2 = dot(p, d2) / (2.0 - lam);
    float along3 = dot(p, d3) / lam;

    /* WINDWARD ONLY - BUT FLAT GROUND IS WINDWARD.

       The test is the horizontal part of the normal against the
       wind, and on level ground that vector is ZERO. Normalising
       it with a 1e-5 nudge returns an arbitrary direction whose dot
       with the wind averages 0, which lands at smoothstep(0.26) =
       0.17 and scaled the relief to about a THIRD of its authored
       strength. Every arena floor and the whole valley pan is level
       ground, so the one surface that most needs near-field texture
       was the one surface getting least.

       Measured against Vesper's own eye-level frames, whose near
       field is carried by its dune ripples: local detail (mean
       absolute difference across a 6px baseline in the bottom third
       of the frame) ran 2.4-4.1 there against 1.06-1.4 here - a
       third to a half. Two blind reviewers called the bottom third
       of our open-ground frames bare, in nine frames out of
       twenty-four between them.

       So the gate fades toward NEUTRAL as the surface flattens: a
       slope is judged on its aspect, level ground is simply exposed,
       which is also what is physically true. A snowfield with no
       shelter takes the full wind. */
    vec2 hn = vec2(sfWN.x, sfWN.z);
    float hlen = length(hn);
    float aspect = hlen > 1e-4
      ? smoothstep(-0.12, 0.34, dot(hn / hlen, wdir))
      : 1.0;
    float expo = mix(1.0, aspect, smoothstep(0.03, 0.22, hlen));
    sfFlat *= mix(0.22, 1.0, expo);

    /* --- AND IT MUST DIE ON A WALL -------------------------------

       This whole field is sampled in world XZ. On level ground that
       is the right frame and the relief is real. On a NEAR-VERTICAL
       face it is a disaster of a specific kind: every point in a
       vertical column shares almost the same x and z, so the noise
       returns almost the same value the whole way down, and what
       draws is a stripe. Same pitch on every cliff, running top to
       bottom, ignoring the form underneath - which is exactly how
       five separate reviews have described the cliffs, and it is a
       SHADER cause sitting on top of the geometric one (a height
       field at 88 degrees also facets per grid column).

       The gate above only ever took it down to 0.22 of full strength,
       so a wall still carried a fifth of a field that had degenerated
       into vertical lines.

       Physically this is also just true: sastrugi are carved into
       snow that LIES. A face too steep to hold a snowpack does not
       have any. hlen is the horizontal part of the normal, which is
       sin(slope) - so this fades from about 46 degrees and is gone by
       72, where wind-plastered rime takes over and the rock ramp is
       doing the work anyway. */
    sfFlat *= 1.0 - smoothstep(0.72, 0.95, hlen);

    /* MEANDER, at three incommensurate rates, and it had to grow
       with the amplitude.

       "Straight crests are corduroy" is DUNE_FRAG's rule and it is
       scale-dependent: a meander that hides the periodicity at one
       amplitude stops hiding it at three times that. Tripling the
       relief without touching this produced exactly the failure the
       rule names - a foreground of regular parallel stripes about a
       metre apart, measurably more detailed and obviously worse.

       The wobble is now comparable to the wavelength itself, so a
       crest wanders by more than its own spacing over a few metres
       and the field reads as carved rather than combed. The high
       rate is deliberately not a harmonic of the low one. */
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

    /* ...AND THE MASK HAS TO WORK AT THE SCALE YOU CAN SEE.

       Every lobe above is measured in HUNDREDS of metres: 326m, 848m,
       174m. That is the right scale for the question it was asked -
       where was the wind accelerating - but it means that across a
       single 60m eye-level frame the mask is a constant. It could not
       break up the field inside a picture, only between pictures, and
       a blind reviewer looking at one picture called the result "a
       striped rug" and "one machine-regular heading edge to edge".

       These two lobes are 45m and 64m, which is a few times the
       spacing of the trains they gate, so a patch carves and the next
       one does not WITHIN one view. The floor comes down with them:
       0.28 of full relief everywhere was what guaranteed a stripe on
       every square metre of the level. At 0.08 a scoured flat is
       actually smooth, which is the thing that makes the carved
       patches next to it read as carving. */
    float pn = sin(along * 0.1387 + across * 0.0912 + 2.3) * 0.5
             + sin(across * 0.0981 - along * 0.0634 + 5.1) * 0.5;
    /* --- AND THE FLOOR CAME BACK UP WHEN THE FIELD STOPPED REPEATING

       This mask exists to break up a field that would otherwise read
       as a printed pattern, and its floor was dropped from 0.28 to
       0.08 while the relief was still three cosine trains - at that
       point every square metre of ground carrying relief meant every
       square metre carrying CORDUROY, and killing most of it was the
       only lever available.

       The relief is ridged noise now. It does not repeat, so it does
       not need to be absent to avoid repeating, and the 0.08 floor
       has been buying nothing while costing everything: with the mask
       off its floor, most of the level's ground carries a twelfth of
       the authored relief and photographs as a flat wash. Blind
       review, counting causes across a whole round, put roughly 70%
       of this level's lost frames on the ground surface - and named
       the one frame where the treatment survives as "what the whole
       level should look like", noting it only holds in a narrow
       exposure band.

       0.45 to 1.07 rather than 0.08 to 1.10. The variation is still
       there; the ground is no longer bare where the mask says no. */
    sfFlat *= clamp(
      0.45 + 0.62 * smoothstep(-0.45, 0.35, pw + pf * 0.28 + pn * 0.62),
      0.0, 1.15);

    /* --- THE RELIEF, AS EROSION RATHER THAN AS A WAVEFORM ---------

       Sampled in the wind frame with the along axis stretched: a
       sastruga is a long feature lying with the wind, roughly 3.6m
       of length to 1.15m of width, and that aspect is the single
       thing that stops ridged noise reading as generic lumps.

       The gradient is a forward difference in the same frame rather
       than an analytic derivative, because the field is a fold
       (abs()) and its analytic derivative is discontinuous at every
       crest - which is exactly where the shading matters. A 0.5
       sample step is about half a feature width, so the crease
       survives and the sharp edges get one sample of softening for
       free. */
    vec2 sp = vec2(along / 3.6, across / 1.15);
    const float SF_EPS = 0.5;
    float n0 = sfRidge(sp);
    float na = sfRidge(sp + vec2(SF_EPS, 0.0));
    float nb = sfRidge(sp + vec2(0.0, SF_EPS));

    /* PIXEL FOOTPRINT FADE. Noise has no bandlimit, so past the
       point where one feature is under a pixel it stops being relief
       and becomes shimmer. fwidth on the sample coordinate is the
       honest measure of that, and it costs nothing here because the
       coordinate already exists. */
    float foot = max(fwidth(sp.x), fwidth(sp.y));
    /* --- 0.9, NOT 5.5, AND THE UNITS ARE WHY ---------------------

       sp is measured in FEATURE WIDTHS - along is divided by 3.6m
       and across by 1.15m - so fwidth(sp) is "how many sastrugi does
       this pixel span". One feature per pixel is Nyquist; that is
       where a bandlimit belongs and nowhere earlier.

       At 5.5 this term was already halving the relief at foot = 0.43,
       which is two and a half pixels PER feature - comfortably
       resolvable, and on ground viewed at a grazing angle (which is
       most of an eye-level frame) it is reached by about thirty
       metres. Every blind reviewer for four rounds described the
       consequence in the same words without knowing the cause:
       "relief lives in the first 20-40m and dies completely beyond
       that", "the sastrugi is authored on the near LOD only", and
       most usefully "fade amplitude in world space, never in screen
       space".

       There is already a world-space fade above - gone by 220m - and
       that is the one making the art decision. This is only the
       aliasing guard, so it now sits at the actual Nyquist limit:
       half strength at foot = 1.05, one feature per pixel. That is
       roughly two and a half times further out, which is the whole
       mid-ground. */
    /* --- AND THE ROLLOFF ITSELF MUST NOT BE VISIBLE --------------

       fwidth on a ground plane has iso-contours that are rings
       centred under the camera, so whatever shape this rolloff has
       gets drawn on the snow as concentric bands. At the old 5.5 the
       rings were tight and inside 30m where nothing survived to show
       them; moving the limit out to Nyquist made the relief live long
       enough for the rolloff to become the pattern, and a reviewer
       called it exactly - "concentric ground rings centred near the
       camera, a radial noise function, not wind".

       A reciprocal has a knee. A single wide smoothstep does not:
       full relief below 0.7 features per pixel, gone by 2.4, and
       nothing in between that reads as an edge. */
    float band = 1.0 - smoothstep(0.7, 2.4, foot);
    /* 4.4 rather than 3.1: with the mask floor restored the field is
       present nearly everywhere, and it has to READ at eye level on a
       flat, which is where nine of twelve frames stand. */
    float amp = uSastrugi.y * 4.4 * sfFlat * band;

    float ga = (na - n0) / SF_EPS;
    float gb = (nb - n0) / SF_EPS;
    vec3 g = vec3(d1.x * ga + q1.x * gb, 0.0, d1.y * ga + q1.y * gb) * amp;

    sfWN = normalize(sfWN - g);
    normal = normalize((viewMatrix * vec4(sfWN, 0.0)).xyz);

    /* Crests run PALER and troughs run BLUER, and that is not the
       same statement twice: the crest is scoured to bare wind slab
       while the trough holds fresh drift, so the difference is a
       change of substance, not of exposure. Keeping it small - this
       is a tie-breaker under the ramp, not a second ramp. */
    float crest = (n0 - 0.42) * 1.7;
    diffuseColor.rgb *= 1.0 + crest * sfFlat * band * uSastrugi2.z;
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
/* The room's own bounce, as a colour and a gain. Cool, because
   everything feeding it is: snow through two open doors, ice in
   nine window heads, and a black-ice floor. */
const CHAPEL_BOUNCE = { colour: [0.44, 0.52, 0.68], gain: 1.95 };

const CHAPEL_BOUNCE_FRAG = /* glsl */`
#include <lights_fragment_end>
{
  /* World up, brought INTO view space - the same direction the snow
     scatter takes with the sun, and the reason is the same: the
     normal is view-space here and moving one constant vector across the
     boundary is cheaper and clearer than carrying a second varying. */
  vec3 sfUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float sfDown = clamp(-dot(normal, sfUp), 0.0, 1.0);
  /* A floor of 1.0 with a further 0.30 for a face looking down at
     that floor. Up-facing surfaces already have the hemisphere fill
     and must not be lifted twice.

     0.8 was too much, and the reason is that the interior's paint
     pass ALREADY favours down-facing normals - so the vault was
     taking both the palest albedo in the room and the largest
     bounce, and photographed as a near-white ceiling over black
     walls, which is the balance of a lit room inverted. One of the
     two terms has to give; this is the one that is not also doing
     the work of making the ribs read. */
  float sfLift = uChapelBounce.a * (1.0 + 0.30 * sfDown);
  reflectedLight.indirectDiffuse = max(
    reflectedLight.indirectDiffuse,
    diffuseColor.rgb * uChapelBounce.rgb * sfLift
  );
}
`;

/* PUTTING IT ON `shader.uniforms` IS HALF THE JOB. The other half is
   declaring it in the GLSL, and forgetting that does not fail the way
   a missing uniform usually does - the fragment shader will not
   compile, three logs VALIDATE_STATUS false, and the material then
   draws NOTHING while the mesh reports visible:true with a valid
   bounding sphere and the raycaster still hits it. The symptom was an
   interior that photographed as bare terrain while every probe said
   the floor was the topmost surface in the room. */
const CHAPEL_BOUNCE_PARS = /* glsl */`
uniform vec4 uChapelBounce;
`;

function chapelBounceExtend(THREE, tune) {
  return (shader) => {
    shader.uniforms.uChapelBounce = {
      value: new THREE.Vector4(tune.colour[0], tune.colour[1], tune.colour[2], tune.gain),
    };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CHAPEL_BOUNCE_PARS}`)
      .replace("#include <lights_fragment_end>", CHAPEL_BOUNCE_FRAG);
  };
}

const SNOW_SCATTER_FRAG = /* glsl */`
#include <lights_fragment_end>
{
  vec3 sfL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float ndl = dot(normal, sfL);
  /* Half-Lambert with an authored wrap. The subtraction is what
     keeps this honest: only the part BEYOND what the direct term
     already delivered is added, so a fully lit face gains nothing
     and the whole effect lives in the terminator and just past it. */
  /* --- THE AMBIENT CUT, ON SNOW AND ONLY ON SNOW ----------------

     The scene's hemisphere fill has been moved three times chasing
     this, and every move was a compromise: it is the only thing
     lighting the shadow side of a rock, and it is also the reason
     snow never has a shadow side. At 0.40 the rock read and the snow
     was flat; at 0.22 the silhouettes read and blind review measured
     the open snowfields UNCHANGED at 62-70% luma in shade against
     85% crests - "a 15-20 point spread, which is not a shadow, it is
     a tint", and "you fixed the silhouettes, not the snow".

     They are different surfaces and they want different fills, so
     this scales indirect light HERE, inside the snow shader, where
     rock and iron and bronze cannot feel it. Snow is 0.85 albedo -
     it returns nearly all the ambient it is given, which is exactly
     why it needs less of it than anything else in the level.

     uSnowWrap.z was one of two unused components on a vec4 that
     already existed, so this costs no uniform and no branch. */
  reflectedLight.indirectDiffuse *= uSnowWrap.z;
  /* --- AND A FLOOR, BECAUSE A CUT ALONE IS NOT A CALIBRATION -----

     Scaling the fill gave the snow its shadow back and then let it
     fall wherever the geometry happened to put it. Reviewed across a
     set, shaded snow measured anywhere from 12% to 78% luma: some
     frames finally read as carved, and others went past a shadow into
     "wet slate, the character's boots are brighter than the ground".

     Snow does not do that. It is 0.85 albedo under an open sky, so
     however deep the shadow, the sky is still lighting it - there is
     a floor below which no snow in daylight can go, and this is that
     floor, expressed the honest way: a fraction of the surface's own
     albedo times the sky colour, so it carries the hue rather than
     just the level. Above the floor the sun still owns everything.

     .w was the last unused component of a vec4 that already
     existed. */
  reflectedLight.indirectDiffuse = max(
    reflectedLight.indirectDiffuse,
    diffuseColor.rgb * uSnowSky * uSnowWrap.w);

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
  /* Amplitudes up ~70%. Sastrugi are the level's ONLY near-field
     texture - there is no grass, no rubble, no scatter on an open
     snowfield - so on any eye-level frame the bottom third of the
     picture is this term and nothing else. A blind reviewer called
     that third "a bare violet-grey plane with zero near-field" and
     the honest reading is that the relief was authored at a
     strength that works at 40m and vanishes at 4m. */
  /* TRIPLED AGAIN, and this time against a measurement rather than
     an opinion.

     The near field of an open snowfield is this term and nothing
     else, and two blind reviewers called it bare in nine frames out
     of twenty-four. Toggling the amplitude at runtime on a basecamp
     eye-level frame and measuring the mean absolute luminance
     difference across a 6px baseline in the bottom third:

         sastrugi off      0.673
         as authored       1.104
         x4                2.432

     Vesper's own open-ground eye frames - whose near field is
     carried by its three dune-ripple trains, the same idea one
     material along - measure 2.4 to 4.1 on the identical metric. So
     the term was authored at about a quarter of the strength the
     job needs, and no amount of ramp, exposure or fill work was ever
     going to substitute for it.

     AND x3 WAS TOO FAR - MEASURED, AND THEN MEASURED AGAIN BY A
     BLIND ROUND, WHICH IS THE ONLY ONE THAT COUNTED. Taken there, the metric read 2.01 and the
     picture read as corduroy - a foreground of regular parallel
     bands about a metre apart, which is precisely the failure
     DUNE_FRAG's own header names. Measurably more detailed and
     obviously worse, which is the whole argument for looking at the
     frame as well as the number.

     The wavelength is the constraint, not the amplitude: at 1.05m
     the finest train projects into wide horizontal bands at any
     eye-level viewing angle, and there is no amplitude at which a
     periodic function that regular stops reading as periodic.
     Settled at x1.5, where the relief is present and the field is
     not ruled - and the rest of the near field is bought where
     Vesper buys it, with SCATTER on the ground rather than more
     shader. */
  /* [0]/[1] are the 1.05m grain, [2]/[3] the 5.6m train. The 5.6m
     train's amplitude came down from 0.146 because on a level pad
     under a 24-degree sun it WAS the barcode: this is a pure normal
     perturbation, ndotl on flat ground is only sin(24) = 0.41, and
     tilting the shading normal by 0.146 swings that by about a third
     either way. A third of a stop, every 5.6 metres, across a flat
     the size of the arrival plaza. */
  sastrugi: [5.984, 0.218, 1.122, 0.105],
  /* k3, slope3, crest albedo, undercut. Crest albedo is nearly double
     sand's 0.286-era value: the difference between scoured slab and
     fresh drift is a change of MATERIAL, so it is allowed to be seen. */
  sastrugi2: [0.242, 0.048, 0.115, 0.92],
  /* wrap, gain. 0.62 of wrap puts the terminator about 38 degrees past
     where Lambert would end it, which is roughly right for snow's
     transport mean free path at this scale. The gain is deliberately
     under a quarter: the term must round the terminator, never fill
     the shadow. */
  /* THE GAIN CAME UP, and flat ground is why.

     At a 15 degree sun a horizontal surface takes sin(15) = 0.26 of
     the key, and horizontal surface is most of every eye-level frame
     in the level - so the arena floors and the valley pan rendered
     around sRGB 110 while the sun-facing slopes behind them sat at
     200, and the near field read as wet grey concrete with a white
     mountain beyond it. The albedo was never the problem; the ramp
     puts that ground at 0.83 before a photon lands on it.

     Raising exposure would fix the floor and blow the slopes with
     it. This term is the one that lifts LOW N.L specifically, which
     is exactly the case that is dark, and it is what actually
     happens in snow: a metre of pack returns most of what enters it
     and the return does not care much about the incidence angle.
     0.38 puts flat snow near sRGB 165 and leaves the lit faces where
     they were - the gap between them closes from 90 code values to
     about 40, which is the difference between two materials and one
     material in two lights. */
  /* --- THE SNOW'S OWN AMBIENT, AND IT IS THE WHOLE PROBLEM ------

     `wrapped = (ndl + wrap) / (1 + wrap)`. At a wrap of 0.62 the
     TERMINATOR - where ndl is zero and the surface faces exactly
     along the light - still receives 0.62/1.62 = 38% of full key.
     There is no arrangement of sun, grade or exposure that can put a
     shadow on a surface lit like that; the number forbids it.

     Which is why cutting the scene's hemisphere fill from 0.40 to
     0.22 improved the rock and the silhouettes and did nothing at all
     to the snowfields. A blind reviewer measured the result exactly:
     shaded flanks at 62-70% luma against crests at 85%, "a 15-20
     point spread, which is not a shadow, it is a tint", and its
     verdict - "you fixed the silhouettes, not the snow".

     Multiple scattering in a snowpack is real and this term models
     it, but 0.62 is a subsurface glow standing in for the sky, and
     the sky is already in the picture twice over. 0.18 keeps the
     terminator soft - snow does not have a knife edge - while
     leaving the shaded side somewhere a shadow can actually live.
     The scatter gain comes down with it so the recovered contrast is
     not immediately spent again. */
  /* .z is a FRACTION of the scene fill, so it has to be re-derived
     whenever that fill moves - and it was not. The global went 0.22
     to 0.36 to stop distant rock crushing to a featureless card, and
     because snow takes a fraction of it, snow's effective fill went
     0.092 to 0.151 in the same edit: the shadow that had just been
     won was handed straight back, and the next review measured
     shaded snow at 0.60-0.72 again.
     0.26 puts snow's effective fill back at 0.36 * 0.26 = 0.094 -
     where it was when the darks worked - while rock keeps the whole
     0.36. That is the entire point of separating them. */
  wrap: [0.18, 0.20, 0.26, 0.30],
  /* density, falloff distance, gain. See SNOW_SPARKLE_FRAG - the
     density is a THRESHOLD WIDTH, not a count, and 0.016 lights
     roughly one grain in six hundred. */
  /* Cut from [0.016, 38, 1.35]. On a drift running across the sun
     the lit band came out as a dense field of hard white specks -
     the one place the term is meant to be a suggestion. Fewer
     grains, a shorter throw and less gain; sparkle should be
     something you notice on the second look. */
  sparkle: [0.009, 30, 0.95],
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
    sastrugi2: [0.242, 0.042, 0.112, 1.0],
    wrap: [0.34, 0.19, 0.28, 0.26],
    sparkle: [0.009, 30, 0.9],
  }), "slab");

  /* Fresh powder, for the deepest lee drifts and for the skin that
     beds a prop into its own snow. Almost no relief - powder has not
     been carved yet - and the strongest scattering in the level. */
  add("powder", {
    flat: false, roughness: 0.97, rim: 0.62,
  }, snowExtend(THREE, {
    ...SNOW_TUNING,
    /* --- A DRIFT IS SMOOTHER THAN A SNOWFIELD, NOT FEATURELESS ----

       0.036 against the snowfield's 0.218 is one SIXTH of the
       relief, and the intent was right: fresh drift is smoother than
       wind slab. What it produces is a collar that reads as a flat
       untextured polygon set into textured ground - and every prop in
       this level stands in one. It is the "sticker prop", the
       "hard-edged white sticker pancake" and the "razor contact line"
       that five separate blind rounds reported, and once the
       snowfield's own relief came up it became the single most
       visible artefact in the set: one reviewer called a 60m cluster
       of merged collars "a flat untextured white hexagon - an obvious
       unshipped plane", and it lost that frame on its own.

       0.125 is still only 57% of the snowfield, so a drift still
       reads as the softer surface. It is just no longer blank. */
    sastrugi: [5.984, 0.125, 1.122, 0.052],
    sastrugi2: [0.242, 0.030, 0.075, 0.35],
    wrap: [0.55, 0.30, 0.32, 0.34],
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

  /* ---------------------- the chapel's inside -------------------
     THE ONE ROOM IN THIS LEVEL WITH NO SUN IN IT, and it needs its
     own material for a reason the interior's own paint pass gets
     wrong.

     That pass lifts the interior's albedo off the bottom of
     GRANITE_RAMP - "a room the player can walk into that renders as
     a void is not a room" - and reasons that a ramp value costs
     nothing and cannot break the twelve-light ceiling. Both halves
     are true and the conclusion does not follow: ALBEDO IS A
     MULTIPLIER. Raising it where no light arrives multiplies zero by
     a larger number. Photographed from the crossing, the vault - four
     thousand triangles of rib and web, the most careful geometry in
     the building - came back at pure black, and the only thing
     visible in the whole nave was the FLOOR, because a hemisphere
     fill lights up-facing normals and nothing else.

     undercroft.js hit this first and wrote down the answer: a room
     lit by its own surfaces cannot get that from a lit material, and
     a new light is the one thing these rooms may not do. So the
     interior gets an indirect-diffuse FLOOR - the same device the
     snow scatter above uses, aimed at the opposite problem - and the
     existing albedo work starts doing what it was always meant to.

     LIT FROM BELOW, which is the whole character of the room. The
     floor is polished black stone under blown snow and the doors are
     open on a snowfield at 452 m, so the brightest surface in here
     is the ground, and a stone vault over a pale floor is lit from
     underneath. Weighting the bounce toward down-facing normals is
     what makes the ribs read as ribs instead of as a flat ceiling. */
  add("chapelStone", { roughness: 0.94, rim: 0.85 },
    chapelBounceExtend(THREE, CHAPEL_BOUNCE), "chapelStone");
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
    wrap: [0.70, 0.34, 0, 0],
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
