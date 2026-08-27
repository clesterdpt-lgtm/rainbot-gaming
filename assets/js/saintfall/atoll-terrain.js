/* ============================================================
   SAINTFALL - Meridian-IV terrain  (the Green Antiphon atoll)

   The peer of terrain.js and summit-terrain.js. Same 2048m square,
   same 8x8 chunk grid, same four LODs, same analytic normals, same
   skirt trick, same yield cadence. Everything in those headers
   still applies and is not repeated. What follows is only what is
   DIFFERENT, because those differences are where this file can go
   wrong.

   ------------------------------------------------------------
   1. THIS IS THE FIRST WORLD WITH A SEA LEVEL IN IT.

   Both other levels measure altitude against their own radial
   PROFILE - summit-terrain.js:3093 says so explicitly, and notes
   that there is no sea level in this codebase. Here there is, it
   is `SEA_Y = 0`, and it is the datum every other module reads:
   the tide bands, the surface classification, the water shader,
   the wading rule, the flora's elevation bands and the wreck's
   waterline all resolve against it.

   Negative ground already works and always did. `heightAt` is
   unbounded below and Kenosis already returns -16 past its map
   edge. What did not exist is anything that KNOWS what a negative
   height means, and `waterDepthAt` is that one function. Every
   reader goes through it. Two derivations of "how deep is it
   here" would disagree within a week, and the disagreement would
   surface as a foam line in the wrong place, which names nothing.

   ------------------------------------------------------------
   2. THE MAP IS A SQUARE AND THE ATOLL IS A RING, AND THE
      PLAYER'S CLAMP IS THE SQUARE.

   player.js clamps to +/-1010 PER AXIS, so the reachable region
   is a square whose CORNER is at r = 1428 - four hundred metres
   further out than its edge at r = 1010. Any feature authored as
   a ring at a single radius is therefore either invisible on the
   diagonals or unreachable on the axes.

   Three consequences, all of them load-bearing:

     a. The reef crest sits at r = 972 +/- 29, so it is inside the
        chunk mesh on every bearing and is visible from the beach
        at about 200m. It is ABOVE WATER on the windward half - a
        rubble rampart with surf breaking on it - which makes the
        level's outer boundary a thing you can see rather than a
        thing you discover.
     b. Everything past the crest is on the APRON: a separate
        coarse ring mesh from r = 1000 to r = 2600 carrying the
        fore-reef, the drop-off and the deep seabed. The chunk grid
        cannot reach it and the sea has to have something under it
        or the drop-off is a colour change with no geometry.
     c. The corner region (r 1024..1428, reachable only on a
        diagonal) is genuinely deep water. There is no swim state
        in this engine, so the boundary is a CURRENT: atoll-main
        reads `waterDepthAt` and calls `player.drag` toward the
        shallows past WADE_MAX. It needs no engine change, it is
        diegetic, and it fails safe - a player who jetpacks out
        there gets the reef wall and open ocean, and walks back.

   ------------------------------------------------------------
   3. A RING PROFILE IS A BAGEL UNLESS IT IS ATTACKED.

   One radial elevation table gives a perfectly circular atoll,
   and a perfectly circular atoll reads as a bagel from the first
   frame. Three fields break it, and all three are functions of
   BEARING ALONE so all three are baked into 1440-entry tables and
   read with a lerp - the same trick summit-terrain.js uses for its
   cliff bands, for the same reason: heightAt is evaluated about
   1.4M times at build and a noise call per sample is not
   affordable.

     ringRadius(a)  - the ring's centreline moves +/-34m, and that
                      budget is set by the mesh, not by taste: see
                      RING_R_HARMONICS
     ringHeight(a)  - its crest scales 0.28..1.72, which is what
                      makes the north side a low sandy thread and
                      the south-west a broad forested shoulder
     ringWidth(a)   - how far the island extends inboard

   And one authored feature the tables cannot express: THE PASS.
   An atoll needs at least one breach connecting lagoon to ocean or
   the lagoon is a lake. It is at compass 352, it is 130m wide, and
   the Antiphon's drive section came through it - which is why the
   Drive Cathedral sits where it does.

   ------------------------------------------------------------
   4. THE THING THE SEA CANNOT ASK THE FIELD.

   A water shader cannot call `heightAt`. So the build bakes a
   1024x1024 RGBA8 seabed texture over the whole map, 2m per texel,
   with the height in a 16-bit R+G pair. Eight bits alone puts
   visible terracing in the shallow foam line, which is exactly
   where the eye is; the second byte costs nothing and removes it.

   The texture is the ONLY thing the water knows about the ground,
   so the foam line, the depth colour, the caustic strength and the
   wet-sand band all derive from it, and they therefore all agree
   with each other by construction even where they disagree with
   the field by a texel.

   ------------------------------------------------------------
   5. A HEIGHT FIELD DRAWS A COMB, NEVER A CLIFF.

   Kenosis spent five blind review rounds on this and concluded
   there is no one feature to fix - the steepness is the sum. The
   four things that together moved it (and each of which moved it
   by 0.00 alone) are all applied here from the start: a derived
   face grade past the walk limit but under the comb threshold, a
   bedding term with A*k < 1, a wallness mottle in the vertex
   colour, and a normal relaxation pass. The Cauldron's plug, the
   reef crest's outer face and the beach scarp all land in this
   trap.
   ============================================================ */

import {
  clamp, clamp01, lerp, smoothstep, smootherstep, sstep, invLerp,
  angleDelta, makeNoise2D, makeRng, hash2, hexToRgb, mixRgb, TAU, DEG,
} from "saintfall/core.js";
import { srgbTransfer as srgb } from "saintfall/art.js";
import {
  SAND_RAMP, WETSAND_RAMP, BLACKSAND_RAMP, CORAL_RAMP, BONE_RAMP,
  BASALT_RAMP, ASH_RAMP, LOAM_RAMP, MANGROVE_RAMP, STATION_TINT,
  ATOLL_WIND,
} from "saintfall/atoll-art.js";

/* ============================================================
   SCAFFOLD

   MAP_SIZE STAYS 2048 and this is not a preference. collide.js:28
   hardcodes `const HALF = 1024` instead of importing MAP_HALF,
   sizes its paged ground cache from it, bounds its raster at
   REACH = 1030 and tests `Math.abs(x) <= 1010` in findPath;
   player.js clamps to +/-1010 in three more places. A larger map
   mis-pages the ground cache SILENTLY.
   ============================================================ */

export const MAP_SIZE = 2048;
export const MAP_HALF = MAP_SIZE / 2;
export const CHUNKS = 8;
export const CHUNK_SIZE = MAP_SIZE / CHUNKS;          // 256m
export const LOD_CELLS = [64, 32, 16, 8];             // 4m, 8m, 16m, 32m
export const LOD_RANGES = [430, 780, 1350, Infinity];

/** THE DATUM. Every module measures against this. */
export const SEA_Y = 0;

/** The tide. `range` is the spring range; the still-water level the
 *  level is authored at is SEA_Y. Bands are heights relative to it. */
export const TIDE = Object.freeze({
  range: 1.35,
  low: -0.68,
  high: 0.68,
  /* Above `crustTop` the barnacle and algae crust stops; between it
     and `splashTop` there is salt bloom and nothing living. These
     two heights are the most powerful readability device on the
     level - they are what makes a 400m ship's scale legible. */
  crustTop: 0.55,
  splashTop: 2.30,
});

/** The deepest water the player may stand in. Past it atoll-main
 *  applies a shoreward current through `player.drag`.

    1.45m, raised from 1.30. 1.45 on a 1.8m figure is hip depth,
    which is where wading genuinely stops being walking; 1.30 was
    mid-thigh, which was conservative rather than correct.

    IT WAS RAISED TO FIX THE REACHABILITY GATE AND IT DID NOT.
    At 1.30 the gate reported the Drive Cathedral, the Weeping Steps
    and the Hold unreachable on foot, each blocked by a single shelf
    at 1.32, 1.35 and 1.36m - three stations lost to six
    centimetres, which looked like a number that wanted rounding up.
    At 1.45 the same three stations block at 1.47, 1.49 and 1.53.
    The blocking depth TRACKED THE CAP, because the lagoon's edge is
    a broad gentle shelf and there is always another centimetre of
    it just past wherever the line is drawn. The gate's companion
    says the same thing in one number: 44 gentle shelves past the
    cap, at any cap.

    That is the correct answer arriving through the wrong door. Two
    of those three stations are MEANT to need the ship: the Hold is
    mid-lagoon in eight metres of water and the Drive Cathedral is
    half-sunk in the pass. Finding the Spine and crossing on it is
    this level's first objective, and a cap that made them walkable
    would have deleted it. The gate should go green when
    `atoll-world.js` places the Spine and publishes its dorsal
    walkway through `walkSurfaceAt` - not before, and not by
    raising this.

    Kept at 1.45 on its own merits, with the reason it did not do
    the job it was raised for recorded here so nobody raises it
    again. */
export const WADE_MAX = 1.45;

/* The eight taken surfaces. `sand` is NOT in this list because it
   is the RESIDUAL - whatever the other eight did not claim - which
   is what makes an unclassified sample land on a beach rather than
   on nothing. Module level because both the classifier and the mesh
   builder walk it and one of them walking a different list is the
   kind of divergence that shows up as a colour, not as an error. */
const ATOLL_SURFACE_KEYS = Object.freeze([
  "wetSand", "blackSand", "reef", "bone", "basalt", "ash", "loam", "mud",
]);


/* THE CLAIM RAMP IS 14m AND IT MUST NOT BE DERIVED. Inside a pad's
   footprint it is exactly 1 - starting the ramp inside the rim
   hands the outer fifth of an arena to the road's bed, and
   Kenosis's flatness assertion went to 22.8m when it tried - and it
   falls to zero 14m outside. 14 rather than Kenosis's 46 because
   the one pad this road meets is 16m across its short axis and the
   road's next pass is 40m inboard of its centre: a 46m ramp would
   reach that pass and drag it toward 74.

   MODULE LEVEL, and that is not tidiness. Declared inside the
   factory it sat below the road march that reads it, and a `const`
   read before its initialiser is a TEMPORAL DEAD ZONE error - which
   a browser reports as the page simply never becoming ready.
   summit-terrain.js:429 records the identical fault costing a whole
   debugging session. */
const CLAIM_RAMP = 14;

/** Where the apron mesh takes over from the chunk grid, and where
 *  it stops. Past APRON_OUT the sea is drawn over nothing and its
 *  shader falls back to the abyssal colour.
 *
 *  APRON_IN is the NOMINAL handover radius and it is reported
 *  rather than used as geometry: the apron's inner edge follows the
 *  map SQUARE (MAP_HALF / max(|sin a|, |cos a|), 1024 on the axes
 *  and 1448 on the diagonals) so it cannot overlap the chunk mesh.
 *  A circular inner edge at 980 would put two surfaces at the same
 *  elevation over four hundred metres of every diagonal, which is
 *  z-fighting across the most-looked-at water in the level. */
const APRON_IN = 980;
const APRON_OUT = 2600;

export { ATOLL_WIND };

/* ============================================================
   THE RADIAL PROFILE

   Read the table, not the code. Every elevation here is authored
   and every one of them is a decision:

     the lagoon floor is -8.5, which is four times WADE_MAX, so
       the lagoon is genuinely crossed rather than waded and the
       Spine has a job;
     it shelves to -1.05 at r=742 and to -0.28 at r=768, which
       puts a 26m-wide wadeable rim all the way round the lagoon -
       that band is where the player actually meets water and it
       is worth its own line in the table;
     the berm crest is +1.55, only 0.87m above the spring high
       tide, because a tropical berm IS marginal - that is why
       storms wash over it and why the ring is made of what the
       sea put there;
     the island interior tops at +8.6, which is the whole natural
       relief on this level. Everything higher is either the
       Cauldron's plug or it is the ship.

   Blended with smootherstep between stops, so the second
   derivative is continuous and the analytic normal does not band.
   ============================================================ */

export const ATOLL_PROFILE = Object.freeze([
  /* r,     y */
  [0, -8.60],
  [260, -8.42],
  [430, -7.90],
  [560, -6.35],
  [640, -3.95],
  [686, -2.30],
  [716, -1.05],
  [738, -0.28],
  /* --- the beach face. 738 -> 756 is eighteen metres of horizontal
     for 1.83m of rise, a 1:10 slope, which is what a moderate-energy
     beach actually stands at. Steeper reads as a step; shallower and
     the intertidal band becomes 60m wide and the tide stops being
     legible. */
  [756, 1.55],
  [782, 4.40],
  [812, 7.90],
  [842, 8.60],
  [868, 5.20],
  [894, 1.90],
  /* --- the reef flat. Nearly level, very slightly falling
     seaward, and it is 0.3-0.6m under the still-water line, so it
     DRIES at low tide and floods at high. That is the single most
     characteristic thing an atoll does. */
  [914, -0.30],
  [944, -0.55],
  /* --- THE CREST. Above water, and it is the level's boundary.

     972 AND NOT 1006, AND THE REASON IS THE MESH. The profile is
     sampled at (r - dR), so a feature authored at profile-radius rp
     appears at WORLD radius rp + dR, and dR reaches +34 on the
     south-west. At 1006 the crest surfaced at world 1040 - sixteen
     metres outside the chunk grid's own half-extent - so on four
     bearings the level's boundary was drawn on the apron at a
     coarse LOD, and on the axes it was simply not in the mesh. The
     probe found it by reading -0.66 where +0.62 was authored.
     972 + 34 = 1006, inside 1024 on every bearing. */
  [972, 0.62],
  [998, -2.80],
  /* --- the fore-reef and the drop-off. All of this is apron. */
  [1050, -14.0],
  [1140, -31.0],
  [1300, -39.0],
  [1500, -42.0],
  [2600, -44.0],
]);

const PROF = ATOLL_PROFILE;

/** The authored profile. TOTAL and FINITE for every real r,
 *  including r = 5000: past the last stop it saturates. */
export function atollProfile(r) {
  const x = Math.max(0, r);
  if (x <= PROF[0][0]) return PROF[0][1];
  const last = PROF[PROF.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < PROF.length - 1; i += 1) {
    const a = PROF[i];
    const b = PROF[i + 1];
    if (x >= a[0] && x <= b[0]) {
      /* core.js's `smootherstep` takes ONE argument - the already
         normalised t - unlike `sstep`, which takes (edge0, edge1,
         x). Called with three, the extra arguments are ignored and
         `clamp01(a[0])` is 1 for every row after the first, so the
         profile returned the row's UPPER value across its whole
         span: a perfect staircase, twenty-two treads and twenty-two
         risers, with the risers landing on the beach face and the
         reef crest. The probe read the ground flat at -0.55 from
         r = 910 to 935 and then -2.80 at 965 - a three-metre cliff
         where a 1:10 beach is authored - and every grade, crest and
         shoreline number in the level was measured against it.

         smootherstep and NOT smoothstep: smoothstep leaves a
         curvature discontinuity at every row boundary, and a
         curvature discontinuity on a 2km ring is a visible terrace
         - the "wedding cake". smootherstep's second derivative is
         zero at both ends, so the rows join invisibly. */
      return lerp(a[1], b[1], smootherstep(invLerp(a[0], b[0], x)));
    }
  }
  return last[1];
}

/** |dy/dr|, by central difference on the profile itself. Used by the
 *  audit and by the shelf solver; not on any hot path. */
export function atollProfileSlope(r) {
  const e = 2.0;
  return Math.abs(atollProfile(r + e) - atollProfile(r - e)) / (2 * e);
}

/* ============================================================
   THE NINE PLACES

   `r` is the NAMING radius, with the same semantics as Vesper's
   DISTRICTS and Kenosis's STATIONS: it decides what the HUD calls
   the ground and which STATION_TINT washes it, and it has nothing
   to do with where the arena floor is. `padR`/`padY` are the
   levelled disc.

   x = r*sin(compass), z = -r*cos(compass). +Z is SOUTH, so the
   compass-to-engine mapping is a REFLECTION, and it has been got
   wrong twice in this project already.

   THE PAD ELEVATIONS ARE THE TERRAIN'S, NOT THE ARENA'S. Kenosis
   learned this the expensive way: it authored nine stations at
   elevations its own profile did not pass through, built them,
   and got "eight lumps stuck on a dome". Here the split is
   explicit - the terrain provides ground between -0.3m and +9m
   everywhere except the Cauldron, and every arena floor above
   that is ARCHITECTURE. The Prow's deck at 26m, the Roost's
   platform at 62m, the Drive's containment walk at 96m and the
   Hold's floor at 34m are all the ship. The terrain does not lift
   a metre for any of them.

   ORDER MATTERS. Station shaping is a sequence of lerps, so a
   later entry carves through an earlier one.
   ============================================================ */

const P = (compass, r) => ({
  x: Math.round(r * Math.sin(compass * DEG) * 10) / 10,
  z: Math.round(-r * Math.cos(compass * DEG) * 10) / 10,
});

export const STATIONS = {
  /* S 180. Where you land. Black volcanic sand, and it is on the
     leeward south shore so the water in front of it is calm - the
     arrival frame needs a mirror, not a chop. */
  landing: { ...P(180, 790), r: 250, name: "The Landing", padA: 118, padC: 46, padY: 3.6, tint: "landing" },

  /* SE 135. The bow, driven into the reef. Its terrain pad is the
     reef flat it lies on; the arena is the canted foredeck above.

     r 930 padC 34 AND NOT 936/52, and the reason is the crest. The
     r 918, padC 18, feather 16 - AND ALL THREE ARE SET BY THE REEF
     FLAT'S OWN WIDTH, which is the number that governs every shore
     pad on this level.

     The profile puts the flat at -0.30..-0.55 from 914 to 944 and
     the CREST at 972, so the flat is thirty metres of profile
     radius and the pad plus its feather has to fit inside it with
     room to spare on both sides. The first draft used 936 with
     padC 52 and a 30m feather - a 164m-wide disc laid across a
     30m-wide flat - and it erased the beach face, the berm, the
     island crest AND the crest itself on the arrival bearing.

     The bearing warp is the other half: a feature authored at
     profile radius rp appears at world radius rp + dR, and dR is
     -6.2 here, so the crest is at world 966 and the pad's outer
     feather edge must land inboard of it. 918 + 18 + 16 = 952. */
  prow: {
    ...P(135, 918), r: 258, name: "The Prow",
    padA: 124, padC: 18, padFeather: 16, padY: -0.20, tint: "prow",
  },

  /* E 90. Windward, and that is the point: the mangrove sits in the
     lee of the ring's widest section, in water the reef has already
     taken the energy out of. Tidal - its floor is at mean low. */
  nave: { ...P(90, 806), r: 266, name: "The Drowned Nave", padA: 150, padC: 62, padY: -0.44, tint: "nave" },

  /* NE 45. The reef flat proper, and the level's brightest place.
     Same arithmetic as the Prow and a different answer, because dR
     is -12.65 on this bearing rather than -6.2: the crest surfaces
     at world 959, so the pad sits at 916 and stops at 950. The
     probe caught the first draft reading DEAD FLAT at -0.2 from
     r = 868 to r = 972 - a hundred metres of pad where the beach
     face, the reef flat and the crest should have been. */
  bone: {
    ...P(45, 916), r: 256, name: "The Bone Reef",
    padA: 140, padC: 18, padFeather: 16, padY: -0.24, tint: "bone",
  },

  /* COMPASS 352, NOT 0. The Drive Cathedral sits IN the pass, and
     the pass is at 352 - so siting the station on due north put the
     arena eight degrees off the only feature that explains it, and
     its pad then had to be wide enough to reach the channel, which
     is what made it eat the crest from 814 to 930.

     Aligned with the pass it needs half the width, and the pad
     becomes the SILL the drive section grounded on: padY -0.60 in a
     channel whose floor is -4.2 is a 3.6m bar across the throat,
     which is why the aft section stopped here rather than washing
     through into the lagoon. It also gives the ring circuit a
     wadeable crossing (0.6m against WADE_MAX 1.30) instead of a
     four-metre hole. */
  drive: {
    ...P(352, 878), r: 270, name: "The Drive Cathedral",
    /* padA 96 rather than 132 because the pass is only 8 degrees
       from due north and padA is a TANGENTIAL half-length: at 132
       the pad still had a third of its weight on compass 0, where
       the probe read the reef flat at -0.12 against an authored
       -0.45. An arena in a channel is a strip and 96m of strip is
       still two hundred metres of fight. */
    padA: 96, padC: 42, padFeather: 22, padY: -0.60, tint: "drive",
  },

  /* On the Cauldron's north-west shoulder, in the breach, where the
     mountain already passes through 74m. Sited by COORDINATE rather
     than by bearing-and-radius, because it belongs to the plug
     rather than to the ring. */
  /* THE WEEPING STEPS HAVE NO PAD, AND THAT IS THE DECISION RATHER
     THAN A SHRINKING OF ONE.

     `padA: 0` skips the station in `padsAt` exactly as the Hold's
     does. The mountain already provides this arena's floor: the
     breach carries a natural terrace at 74m that runs from d=150 to
     d=180 out from the Cauldron's axis, and the station sits on it.

     What was there before was a 96 x 62m levelled ellipse, and it
     failed its own gate by two orders of magnitude - p95 90.48m
     against a 0.35m budget, rim grade 625% against 8%. The cause is
     geometric and no amount of feather fixes it: a level disc of
     half-width C cut into ground at grade G has a rim grade that
     tends to 1.5*G however wide the feather is, and this flank runs
     1.36. A 96m disc on it is a cliff with a tabletop on top.

     Two further things made it worse. The terrace is about 30m wide
     RADIALLY, so a 62m half-width across it was reaching 90m of
     mountain on the uphill side and 80m of air on the downhill one.
     And the pad's local frame is built from the station's radius
     vector about the WORLD origin, while this terrace's contour runs
     about the CAULDRON - the two are 40 degrees apart here, so the
     ellipse's major axis was pointing across the contour rather than
     along it.

     The arena floor is `atoll-world.js`'s job: basalt benches, the
     plunge pool and the stacked columnar risers the art direction
     asks for, bedded onto ground that is already the right shape. */
  weeping: { x: -484, z: 251, r: 232, name: "The Weeping Steps", padA: 0, padC: 0, padY: 74.0, tint: "weeping" },

  /* W 270. Ring crest. The 62m platform above it is architecture. */
  roost: {
    ...P(270, 826), r: 244, name: "The Canopy Roost",
    /* padC 32 with a 58m feather, and the pair is set by the RING
       CIRCUIT rather than by the arena. The circuit runs at
       762 + dR and this pad sits on the island crest at 826, six
       metres above it and fifty-eight metres outboard; at padC 48
       with the default 30m feather the circuit crossed the pad's
       rim and the walk grade came back at 0.344 against a 0.18
       gate. A rim resolving 6m over 58m peaks at 1.5*6/58 = 0.155.
       This is the one pad whose feather is sized by a route
       instead of by its own earthwork. */
    padA: 100, padC: 32, padFeather: 58, padY: 8.9, tint: "roost",
  },

  /* SW 225. The plug, and it rises straight out of the lagoon on
     its inboard side. `padY` is the CRATER FLOOR; the rim stands at
     214 and is built by `cauldronAt`, not by the pad. */
  cauldron: {
    /* r 520 AND NOT 580, and the number is set by the ring circuit
       rather than by the mountain. At 580 with a 240m foot the
       plug's flank reached world r = 820 and the circuit runs at
       762 + dR = 781 on this bearing, so the beach walk climbed
       35m up the side of a volcano: the probe measured grade 0.510
       at compass 233 against a 0.18 gate. This is the SECOND time
       that has happened - the first fix moved the plug from the
       berm to r=580 and took the grade from 1.39 to 0.247 - and it
       came back at a third of the size because only the centre
       moved and the foot did not.

       520 + 240 = 760, twenty-one metres inboard of the circuit.
       It is also the better image: the plug now rises out of the
       lagoon from r = 280, so from the Landing you see 214m of
       mountain standing in turquoise water rather than behind a
       beach. */
    ...P(225, 520), r: 300, name: "The Cauldron",
    /* 52 AND A 10m FEATHER, BOTH SMALLER THAN THEY LOOK, because
       this pad lives inside a crater whose rim is only 84m out. The
       default 66 + 30 reaches d = 96 - twelve metres PAST the rim -
       and it therefore lerped the level's highest ground down
       toward the crater floor, costing the rim seven metres and
       putting a notch all the way round it. The crater floor is
       already dead level out to d = 60 (see CAULDRON.lipFrom), so
       the pad has almost nothing to do here and must not reach the
       lip to do it. */
    padA: 42, padC: 42, padFeather: 10, padY: 194.0, tint: "cauldron",
  },

  /* Centre. The Hold is on the Spine, 34m over the lagoon; its
     "pad" is the lagoon floor under it and exists only so the
     naming field has something to key on. */
  hold: { x: 0, z: 0, r: 232, name: "The Reliquary Hold", padA: 0, padC: 0, padY: -8.55, tint: "hold" },
};

export const STATION_ORDER = Object.freeze([
  "landing", "prow", "nave", "bone", "drive",
  "weeping", "roost", "cauldron", "hold",
]);

/** Where the player lands, and what they look at. Facing north,
 *  across the lagoon, with the whole level in the frame: the Spine
 *  crossing the water, the Drive Cathedral's ring beyond it, the
 *  Cauldron on the left. See the arrival note in atoll-art.js -
 *  every hour is judged on this frame first. */
export const LANDING = Object.freeze({
  x: STATIONS.landing.x,
  z: STATIONS.landing.z - 18,
  /* Yaw 0 faces -Z, which is north under this project's axes. */
  yaw: 0,
});

/* ============================================================
   THE THREE BEARING FIELDS

   All functions of bearing alone, all baked. `a` is the engine
   bearing atan2(x, -z) in radians, which is the compass bearing in
   radians - the reflection is already in the (x, z) construction.

   THE WAVENUMBERS ARE INTEGERS. A ring is a function on a circle
   and a fractional wavenumber tears it open at theta = 0 - a 450m
   crack, in summit-sky.js's words. Every harmonic below is an
   integer and the audit checks it.
   ============================================================ */

const BAND_N = 1440;

/* Ring centreline offset, metres. Three integer harmonics, phases
   chosen so the widest section lands on the SOUTH-WEST (where the
   Cauldron is, and a plug needs a shoulder to stand on) and the
   narrowest on the NORTH (where the pass is). */
/* THE SUM OF THE AMPLITUDES IS THE BUDGET, and it is 34m, not 58.
   A feature authored at profile-radius rp appears at world radius
   rp + dR, so max(dR) is subtracted from the mesh's usable half-
   extent for every ring feature. At the first draft's 34+17+7 = 58
   the reef crest surfaced outside the chunk grid on four bearings.
   Keep sum(a) <= 34. */
const RING_R_HARMONICS = [
  { k: 1, a: 20, p: 3.93 },   // widest at compass 225
  { k: 2, a: 9, p: 1.20 },
  { k: 5, a: 5, p: 4.55 },
];

/* Ring crest height scale. Runs 0.18 on the north thread to 1.34 on
   the south-west shoulder. The 0.18 is what makes the ring READ as
   a ring rather than as a wall: from the lagoon you can see over it
   to open ocean on the north side, and that sightline is the only
   thing that says the lagoon is enclosed by something thin. */
const RING_H_HARMONICS = [
  { k: 1, a: 0.46, p: 3.93 },
  { k: 2, a: 0.17, p: 0.62 },
  { k: 3, a: 0.09, p: 2.41 },
];

/* Ring width scale - how far inboard the island extends. Broad on
   the lee side where sediment accumulates, thin on the windward
   side where the trades scour it. Trade wind is FROM compass 78. */
const RING_W_HARMONICS = [
  { k: 1, a: 0.30, p: 1.36 },   // widest at compass 258, downwind
  { k: 3, a: 0.12, p: 5.02 },
];

/* Where the height scale hands over to the bare profile, in
   PROFILE radius. 880 is inside the outer beach face (profile +5.2
   at 868) so the island's own crest keeps its full variation; 918
   is four metres inboard of the reef flat's first stop at 914, so
   the flat, the crest and the fore-reef are the profile's alone on
   every bearing. */
const RING_H_FADE_IN = 880;
const RING_H_FADE_OUT = 918;

function bakeHarmonics(list, base, scale) {
  const t = new Float32Array(BAND_N);
  for (let i = 0; i < BAND_N; i += 1) {
    const a = (i / BAND_N) * TAU;
    let v = base;
    for (const h of list) v += h.a * Math.sin(h.k * a + h.p) * scale;
    t[i] = v;
  }
  return t;
}

/* CATMULL-ROM, NOT A LERP, AND IT IS A CORRECTNESS REQUIREMENT.

   A linearly interpolated table is C0: its derivative is a STEP
   function, so an analytic normal - which differentiates the height
   field - jumps at every table entry. At r = 850 with 1440 entries
   the entries are 3.71m apart, which is the LOD0 cell (4m) to
   within seven per cent. The result is not a subtle crease, it is
   textbook moire across the whole ring, on ground the player walks,
   and it would be extremely hard to attribute after the fact.

   Kenosis gets away with a lerp because its RIM_TABLE is 900m away
   and unclimbable. Every table in this file is under somebody's
   feet. Four array reads instead of two, C1, no creases. */
function readBand(table, a) {
  let u = (a / TAU) * BAND_N;
  u -= Math.floor(u / BAND_N) * BAND_N;
  const i = u | 0;
  const f = u - i;
  const i0 = i === 0 ? BAND_N - 1 : i - 1;
  const i2 = i + 1 === BAND_N ? 0 : i + 1;
  const i3 = i2 + 1 === BAND_N ? 0 : i2 + 1;
  const p0 = table[i0];
  const p1 = table[i];
  const p2 = table[i2];
  const p3 = table[i3];
  const f2 = f * f;
  return 0.5 * (
    2 * p1
    + (p2 - p0) * f
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2
    + (3 * p1 - p0 - 3 * p2 + p3) * f2 * f
  );
}

/* ============================================================
   THE PASS

   Compass 352, 130m wide at its throat, cut from the reef flat
   right through the ring to the lagoon shelf. Its floor is -4.2m,
   which is deep enough that it is not wadeable and shallow enough
   that the drive section grounded in it rather than sinking.

   Authored as an angular gate times a radial window, and it is
   applied as a MIN against the ring, not as a subtraction: a
   subtraction would dig a trench through the lagoon floor as well.
   ============================================================ */
const PASS = Object.freeze({
  bearing: 352 * DEG,
  halfAngle: 0.074,      // ~4.2 deg -> about 130m at r=900
  inner: 700,
  outer: 1010,
  /* THE FLOOR IS A FUNCTION OF RADIUS AND THAT IS THE WHOLE
     CROSSING. A constant -4.2 all the way in put a four-metre hole
     across the ring circuit at r = 762: the walk grade came back at
     0.247 against a 0.18 gate, on the one bearing where the player
     has no choice but to cross.

     Real passes have a shallow INNER sill - the lagoon end silts
     and the ocean end scours - so the floor runs -0.62 at the
     lagoon throat and -4.20 out under the crest. -0.62 is inside
     WADE_MAX (1.30), so the circuit crosses ankle-deep and the
     pass still drains, because -0.62 is still below SEA_Y. */
  sillY: -0.62,
  sillR: 774,            // where the floor stops being a sill
  floorY: -4.2,
  deepR: 884,            // and where it has reached full depth
  feather: 0.030,
});

/** The pass floor at a radius. Not on any hot path outside the
 *  pass's own angular gate, so the smoothstep is affordable. */
function passFloorAt(r) {
  return lerp(PASS.sillY, PASS.floorY, sstep(PASS.sillR, PASS.deepR, r));
}

/* ============================================================
   THE CAULDRON

   A residual volcanic plug on the south-west shoulder. It is not a
   cone: it is a breached crater, open to the north-west, and the
   Weeping Steps come down through the breach. The rim stands at
   214m, the crater floor at 196m, and the whole thing is 300m
   across at its base.

   TWO REGIMES, AND THE FIRST DRAFT HAD ONLY ONE.

   That draft built a raised-cosine bell that reached 1.0 at the
   CENTRE and then dished the middle of it down to floorY. A bell
   peaks where it is dished, so the dish ate the peak: the rim - the
   authored high point of the entire level, and the thing you see
   from the arrival beach 1400m away - measured 161m against 214,
   and the highest ground on the map was the crater FLOOR at 194.
   The mountain had no top.

     d >= rimR : the outer flank, rising from the ground at baseR to
                 rimY at rimR
     d <  rimR : the lip, then the dish to floorY

   THE FLANK IS QUADRATIC-LINEAR-QUADRATIC, NOT A SMOOTHSTEP, and
   that is the crevasse-wall arithmetic from summit-terrain.js
   applied to a mountain instead of a slot. Two things have to hold
   at once: the drawn mesh must agree with the analytic field (a
   second derivative is what makes a 4m linear interpolant deviate
   from the surface), and the grade must be as low as the geometry
   allows. A smoothstep's peak grade is 1.5 D/S, which for
   D = 222m of rise over S = 178m of run is 1.87 - past the 1.7 walk
   limit and, worse, peaking exactly halfway up where the whole
   flank is at its steepest at once. A rounded toe, a DEAD STRAIGHT
   face and a rounded shoulder give a constant D/(S - ease) = 1.68
   over the middle, with zero second derivative there, so the mesh
   error is bounded by the eases alone.

   1.68 is deliberately past nothing and deliberately under the walk
   limit: at the 4m LOD0 cell it is a 6.7m step from column to
   column, which reads as rock. Past about 1.9 it becomes the
   uniform vertical comb that cost Kenosis five blind rounds.

   And a wall you cannot walk up is only acceptable because there is
   a way up that you can - see CAULDRON_ROAD. A level whose one peak
   needs a jetpack has made its jetpack mandatory.
   ============================================================ */
const CAULDRON = Object.freeze({
  x: STATIONS.cauldron.x,
  z: STATIONS.cauldron.z,
  /* Centre at r = 580, which is INBOARD of the berm at ~800: the
     plug rises straight out of the lagoon on its north-east side
     and out of the jungle on its south-west, and the beach circuit
     passes seaward of its foot with 200m to spare. Sited at the
     berm it swallowed the beach, the reef flat and the whole
     south-west quadrant of the ring, and the circuit's grade came
     back at 1.39 - eighty per cent over the walk limit, for a
     route that is supposed to be a beach. */
  /* 240, and it is a CLEARANCE not a taste: 520 + 240 = 760 puts
     the plug's foot 21m inboard of the ring circuit at 781. */
  baseR: 240,
  rimR: 84,
  rimY: 214,
  floorY: 194,
  /* The ease at each end of the straight face, in metres of run,
     and IT IS SMALL ON PURPOSE - a longer ease is a STEEPER
     mountain, which is the opposite of the intuition.

     The face's grade is D / (span - ease): all the rise has to
     happen somewhere, and every metre spent easing the ends is a
     metre the straight section does not get. With span 156 and
     D = 222m of rise off the lagoon floor, ease 46 gives 2.02 and
     ease 20 gives 1.635 - the difference between a wall past the
     walk limit and a flank a determined player can scramble.

     The floor under `ease` is the mesh, not the eye: a rounded end
     contributes 2 * grade / ease of disagreement between the
     analytic field and the 4m-sampled triangles, and `vfx.footprint`
     reads the field while collision reads the mesh. At ease 20 that
     is 0.16m against the 0.5m budget. Below about 8m it stops
     being affordable, and a plug's foot IS a sharp break of slope -
     that break is most of what makes it read as a plug. */
  flankEase: 20,
  /* THE CREST EASE, AND IT IS NOT THE TOE EASE. Round 1's aerial
     frame named the plug a "flat-topped mesa with smooth rounded
     featureless flanks", and half of that is this number: a single
     symmetric 20 m ease put a twenty-metre radius of rounded
     shoulder immediately under the rim, which is exactly the band
     the silhouette is made of. A crater rim is the sharpest break
     of slope on a volcano and it was the softest thing on this
     mountain.

     9 m, and the floor under it is the mesh rather than the eye,
     same arithmetic as the toe's: a quadratic cap of run `e`
     carrying slope `g` disagrees with a linear interpolant across
     a 4 m LOD0 cell by g * 2 / e, so at g = 1.7 and e = 9 that is
     0.38 m against the 0.5 m budget. At e = 6 it is 0.57 and over
     it. Note the direction of the surprise, which is the same one
     the toe's comment records: SHRINKING an ease makes the face
     LESS steep, because the ease's run is half-charged to the
     rise. 20/20 gave 1.65 on the straight; 20/9 gives 1.59. */
  crestEase: 9,
  /* THE FACE IS CONCAVE UP. A constant-grade straight face is a
     cone, and a cone photographs as a mesa the moment its top is
     flat - which is the same fault summit-terrain.js records
     against its own first PROFILE_ROWS ("a uniform grade is a
     cone... it read as a hill with fur on it").

     `faceBias` tilts the straight section's grade linearly from
     (1 - b) of the mean at the toe to (1 + b) at the crest, with
     the integral held so the rim height is unchanged. 0.14 turns a
     flat 1.59 into 1.37 at the apron and 1.81 under the rim: an
     apron the eye reads as a base, and an upper third that is a
     wall. The second derivative it costs is 2 * b * g / straight =
     0.0035/m, which is 0.007 m of mesh disagreement across a 4 m
     cell - nothing.

     Past about 0.22 the crest end goes through 1.9, which is where
     Kenosis's uniform vertical comb starts. */
  faceBias: 0.18,
  /* THE RIM IS NOT A LEVEL LINE. Round 1: "the crater floor at 194
     and the rim at 217 read at distance as one plateau". They do,
     because the rim was a CONSTANT: every bearing stood at 214, so
     the skyline was a ruled horizontal edge and the only thing
     breaking it was the breach.

     Integer wavenumbers, and that is mandatory rather than tidy -
     this is a term in the bearing and a non-integer wavenumber
     puts a seam at -X, which on a skyline is a vertical step
     nobody authored. Five of them at 1, 2, 3, 5 and 7 lobes: the
     low orders make one side of the crater higher than the other
     (a crater rim is always higher on its downwind side), 5 and 7
     put teeth on it. Coprime, so the sum does not repeat inside a
     revolution.

     Amplitudes sum to 16.7 m but the realised swing is about
     +/-12: the measured rim after the change runs 202 to 228
     against a flat 214, and 26 m of skyline break at 900 m is 26
     px on a 900 px frame. It was 3 px. */
  rimHarmonics: Object.freeze([
    [1, 5.0, 0.90],
    [2, 3.4, 2.35],
    [3, 4.2, -1.15],
    /* 7 AND 11 ARE PHASE-LOCKED TO THE BUTTRESSES below - same
       wavenumbers, same phases. A buttress ridge that runs all
       the way up a volcano ENDS IN A HORN; one that fades out
       under a level rim is a texture painted on a dome. Locking
       them is what turns the crest line into a set of teeth with
       ribs under them instead of two unrelated noise fields, and
       it costs nothing because both are already integers. */
    [7, 6.0, 0.73],
    [11, 3.0, -2.11],
  ]),
  /* Where the crater's flat floor ends and the lip begins. Round 0
     shipped this as a fixed fraction of rimR (0.72: a 60 m floor
     and a 24 m lip climbing 20 m at peak grade 1.25). With the rim
     now varying by bearing that fraction cannot be fixed - on the
     high sectors the same 24 m of lip would have to climb 34 m,
     peak grade 2.1, and the crater arena would be a bowl with two
     unclimbable walls in it.

     So the lip's RUN is derived from the rise it has to make and
     the fraction falls out of it: run = 1.25 * rise, clamped. The
     lower clamp is round 0's own 23.5 m so nothing got narrower;
     the upper is 44 m, which leaves 40 m of dead-level crater
     floor - and the Cauldron's pad is a 42 m disc that feathers to
     52, so the pad still wins everywhere the audit samples it and
     `padFlatness("cauldron")` still reads exactly 194. */
  lipRunMin: 23.5,
  lipRunMax: 44,
  lipRunPerRise: 1.25,
  /* the breach, toward the Weeping Steps at compass 315 */
  breachBearing: 315 * DEG,
  breachHalf: 0.40,
  /* 36 rather than 30. "A breached crater should read as breached
     from outside" - the notch has to survive against a rim that is
     now itself 26 m of relief, or it stops being the one authored
     feature of the skyline and becomes the deepest of several. 36
     keeps it that, and it is under the 40 the road corrector was
     measured to swing out of in about ten 6 m steps. */
  breachDrop: 36,
  /* Radial rills. AMPLITUDE TIMES WAVENUMBER IS THE GRADE IT ADDS.
     The grade it adds is TANGENTIAL, though, and the face's own
     grade is RADIAL - these terms are functions of the bearing
     alone - so the two compose as a hypotenuse and not as a sum.
     Round 0's note added them and under-spent the budget by a
     factor of three: at a face of 1.59 and a rill contribution of
     0.32, the surface grade is hypot(1.59, 0.32) = 1.62, not 1.91.
     Measured over the whole cone after this change: max 1.86.

     1.4 m was invisible. The aerial camera stands 900 m off, where
     one pixel is about one metre, so a 1.4 m rill was one pixel of
     shading and round 1 recorded the rills as "invisible" - which
     they were. 2.2 m is the most this term can carry before its
     own tangential grade stops being free. */
  rillAmp: 2.6,
  /* THE BUTTRESSES, and they are the other half of the mesa fix.
     Rills are a texture; a plug's silhouette is made of RIBS -
     radial buttresses tens of metres across that put a star in the
     plan outline and a serrated edge on the skyline. 9 m of
     amplitude is nine pixels at 900 m and it survives.

     Explicit integers rather than a noise circle, because the
     wavenumber has to be EXACT: `nRidge.fbm(cos(a)*7, sin(a)*7)`
     does not give seven lobes, it gives about 2*PI*7 of them, and
     the old rill comment's "21 lobes" is out by that same factor.
     A sum of sin(7a) and sin(11a) is exactly periodic in the
     bearing, has no seam, has a known tangential wavenumber at
     every radius, and 7 and 11 being coprime means the pattern
     does not repeat inside a revolution.

     9 m WAS NOT ENOUGH AND THE SECOND ROUND OF FRAMES SAID SO.
     The plug is 480 m across at its base; 9 m of rib is under two
     per cent of that and it disappeared into the shading. 21 m
     changes the PLAN OUTLINE - the cone's edge against the sky
     stops being an arc - and that is the only thing that ever
     fixes a silhouette.

     The grade it adds is TANGENTIAL, and that is the whole reason
     21 is affordable where 21 of anything radial would not be.
     At d = 170: 21 * 0.62 * (7/170) + 21 * 0.38 * (11/170) =
     0.537 + 0.516 = 1.05 across the fall line of 1.55, so the
     surface grade is hypot(1.55, 1.05) = 1.87. Added to it
     instead, it would have been 2.60 and unshippable.

     What DOES add to the fall line is the envelope's own radial
     gradient, and that is why the envelope is long at both ends -
     see the ramp below. */
  buttressAmp: 21.0,
});

/**
 * The flank's rise fraction at distance `p` metres inboard of
 * `baseR`. Quadratic - LINEARLY RAMPED - quadratic; see the
 * CAULDRON header. Returns 0 at p <= 0 and 1 at p >= span.
 *
 * `e0` is the toe ease, `e1` the crest ease and `b` the concavity
 * bias: the straight section's slope runs from m(1-b) at the toe
 * end to m(1+b) at the crest end. The slope profile is therefore a
 * trapezium with a tilted top, and `m` is whatever makes its area
 * exactly 1:
 *
 *   m = 1 / [ (1-b)*e0/2 + L + (1+b)*e1/2 ],   L = span - e0 - e1
 *
 * Integrating that piecewise is the whole function. It is exact at
 * both ends and C0/C1 at both joins, which is what keeps the drawn
 * mesh on the analytic field - the reason the shape is built this
 * way rather than as a smoothstep is recorded in the CAULDRON
 * header and has not changed.
 */
function flankRamp(p, span, e0, e1, b) {
  if (p <= 0) return 0;
  if (p >= span) return 1;
  const L = span - e0 - e1;
  if (L <= 0) return smoothstep(p / span);
  const m = 1 / ((1 - b) * e0 * 0.5 + L + (1 + b) * e1 * 0.5);
  const m0 = m * (1 - b);
  const m1 = m * (1 + b);
  if (p < e0) return m0 * p * p / (2 * e0);
  if (p < e0 + L) {
    const q = p - e0;
    return m0 * e0 * 0.5 + m0 * q + (m1 - m0) * q * q / (2 * L);
  }
  const q = span - p;
  return 1 - m1 * q * q / (2 * e1);
}

/**
 * The rim's elevation on bearing `ab`, in metres. Exactly periodic
 * in the bearing - every wavenumber is an integer - so there is no
 * seam at -X, which on a skyline would be a vertical step.
 * See CAULDRON.rimHarmonics.
 */
function cauldronRimY(ab) {
  let y = CAULDRON.rimY;
  const H = CAULDRON.rimHarmonics;
  for (let i = 0; i < H.length; i += 1) y += H[i][1] * Math.sin(H[i][0] * ab + H[i][2]);
  return y;
}

/**
 * The radial fraction of `rimR` at which the crater's dead-level
 * floor ends and the lip begins, on bearing `ab`. Derived from the
 * rise the lip has to make so the lip's grade stays bounded as the
 * rim varies - see CAULDRON.lipRunPerRise.
 */
function cauldronLipFrom(ab) {
  const rise = Math.max(0, cauldronRimY(ab) - CAULDRON.floorY);
  const run = clamp(
    CAULDRON.lipRunPerRise * rise, CAULDRON.lipRunMin, CAULDRON.lipRunMax
  );
  return (CAULDRON.rimR - run) / CAULDRON.rimR;
}

/* ============================================================
   THE BOMMIE FIELD

   Round 1: "the lagoon floor is camouflage - the bommie field
   reads as high-contrast leopard blotches at one scale, evenly
   distributed, with no shadow and no relief. It is paint, not
   coral heads."

   It was right, and the cause is one line. The floor was
   `smoothstep(0.34, 0.72, fbm(x * 0.0086, z * 0.0086))` squared
   and scaled by 6.2 m. 0.0086 is a 116 m wavelength, so the
   "coral heads" were 116 m across; `smoothstep` of a smooth field
   is still a smooth field, so they had no flanks; and a Gaussian
   field crosses 0.34 about seventeen per cent of the time no
   matter where you stand, so they were EVENLY distributed. A
   hundred-metre soft mound of the right colour, repeated evenly,
   is the definition of camouflage. 37.6 % of the lagoon floor
   stood more than a metre above its own thirtieth percentile.

   A real lagoon floor is mostly clean sand with sparse, isolated
   heads that CLUSTER, that come in a size range, and that shelve
   steeply enough to shade themselves. So:

     - PLACEMENT IS A JITTERED GRID, not a threshold on noise.
       One candidate head per cell, its site jittered inside the
       cell, its radius and height hashed. That is what makes a
       head ISOLATED - a threshold on a continuous field cannot
       be, because its level sets are connected.
     - TWO SCALES. 46 m cells carry the ordinary heads (7-16 m
       radius); 150 m cells carry the rare hero bommies (20-33 m,
       up to 8.6 m tall) that are big enough to break the water
       and to cast a shadow the Spine's own shadow has to compete
       with.
     - CLUSTERING IS A SEPARATE, MUCH LONGER FIELD. `dens` runs
       at a 480 m wavelength and gates the per-cell hash, so the
       lagoon has reef patches and wide clean sand between them
       rather than a uniform sprinkle.
     - THE PROFILE IS SHELVED, not domed. pow(1 - t*t, 0.62) is
       flat-ish on top and steep at the skirt, which is both what
       coral does and what makes a head read as a solid object
       through six metres of water. A cosine dome reads as a
       bruise.

   THE FLOOR IS ALSO WHAT THE SPINE'S SHADOW FALLS ON, so the
   coverage is a budget and not a taste. Measured after: 7.4 % of
   the lagoon floor raised more than a metre, against 37.6 %.
   ============================================================ */
const BOMMIE = Object.freeze({
  /* Cell size, metres. It must be at least twice the largest
     radius or a 3x3 neighbourhood is not enough to find every
     head that can reach the sample - at 46 and rMax 16 the margin
     is 14 m. */
  cell: 46,
  /* Fraction of cells carrying a head where the clustering field
     is at full strength. 0.62 x a mean density of 0.42 is about a
     quarter of cells, which at a mean plan area of 380 m2 in a
     2116 m2 cell is the 7 % coverage above. */
  cover: 0.62,
  rMin: 7.0,
  rMax: 16.0,
  hMin: 2.4,
  hMax: 6.4,
  /* The hero scale. Rare, and its own 3x3 is affordable only
     because both loops start with one integer hash and a compare. */
  bigCell: 150,
  bigCover: 0.30,
  bigRMin: 20,
  bigRMax: 33,
  bigHMin: 5.0,
  bigHMax: 8.6,
  /* The clustering field's spatial frequency. 480 m wavelength:
     three or four reef patches across a 1400 m lagoon. */
  clumpFreq: 0.00208,
  /* Where the field stops. The lagoon's inner beach face starts
     climbing around 700, and a coral head on a beach is a rock. */
  outer: 690,
  fade: 110,
  /* AND WHERE IT STARTS. The Hold is the wreck's arena, its floor
     is the deepest ground on the level at -8.55 and it is the one
     place `lagoonDepth` is gated on (7.5-9.0 m). `hold` also has
     padA 0, so `padsAt` SKIPS it - nothing downstream would put
     the floor back if a hero bommie landed on it. The station's
     naming radius is 232; 150 to 268 clears it with a margin and
     also leaves the ship a clean apron to lie in. */
  inner: 150,
  innerFade: 118,
  /* The crown cap, in metres above SEA_Y. A head that reaches the
     surface stops growing and gets planed flat - that is a real
     landform (a micro-atoll) and it is the cheapest scale
     reference the lagoon has, because a flat coral table with a
     hard waterline round it tells you how deep the water is. It
     is also a guard: uncapped, the hero scale put a crown 3.9 m
     PROUD of the sea in the middle of the lagoon, which is an
     islet nobody authored. */
  crownY: 0.30,
});

/* ============================================================
   THE FIELD
   ============================================================ */

export function makeAtollField(seed = 0x0a70113a) {
  const nReef = makeNoise2D(seed + 1);
  const nRidge = makeNoise2D(seed + 2);
  const nWarp = makeNoise2D(seed + 3);
  const nDetail = makeNoise2D(seed + 4);
  const nGully = makeNoise2D(seed + 5);

  const WIND = ATOLL_WIND;
  /* The trade wind's travel vector, precomputed. Aspect-to-wind is
     read on every surface classification and it is a dot product,
     not a trig call. */
  const windX = WIND.x;
  const windZ = WIND.z;

  const ringR = bakeHarmonics(RING_R_HARMONICS, 0, 1);
  const ringH = bakeHarmonics(RING_H_HARMONICS, 1, 1);
  const ringW = bakeHarmonics(RING_W_HARMONICS, 1, 1);

  /** The ring's height scale at a bearing, faded to 1 outboard of
   *  the beach. ONE derivation, three callers (heightAt,
   *  circuitLandform, cauldronLandform) - two would disagree within
   *  a week and the disagreement would surface as a shoreline in
   *  the wrong place with every check still green. */
  function ringHeightAt(aa, rp) {
    const g = 1 - sstep(RING_H_FADE_IN, RING_H_FADE_OUT, rp);
    if (g <= 0.0005) return 1;
    return lerp(1, readBand(ringH, aa), g);
  }

  /* ------------------------------------------------------------
     THE BOMMIE FIELD - see the BOMMIE header for the argument.

     Returns metres of coral head standing above the sand at
     (x, z), always >= 0. Pure, so `surfaceAt` can ask it the same
     question the height field did and paint coral exactly where
     there IS coral - which is the other half of round 1's
     camouflage: the old classifier keyed `reef` off ABSOLUTE
     depth, so the coral colour was a contour line of the seabed
     rather than a property of the heads.
     ------------------------------------------------------------ */
  function bommieHeads(x, z, cell, cover, rMin, rMax, hMin, hMax, salt) {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    let best = 0;
    for (let j = -1; j <= 1; j += 1) {
      for (let i = -1; i <= 1; i += 1) {
        const gx = ci + i;
        const gz = cj + j;
        /* ONE HASH AND A COMPARE is the reject, and it is why nine
           cells at two scales are affordable inside a 1.35M-sample
           mesh build: three quarters of the eighteen tests end
           here. */
        const pick = hash2(gx + salt, gz - salt);
        if (pick > cover) continue;
        const jx = hash2(gx * 7 + 131 + salt, gz * 3 - 57);
        const jz = hash2(gx * 5 - 89, gz * 11 + 313 + salt);
        const shape = hash2(gx + 6151, gz + 2749 + salt);
        const sx = (gx + 0.16 + 0.68 * jx) * cell;
        const sz = (gz + 0.16 + 0.68 * jz) * cell;
        const dx = x - sx;
        const dz = z - sz;
        /* Radius is biased SMALL - shape squared - because a reef
           has many little heads and a few big ones, and a uniform
           draw gives a field of identical medium lumps, which is
           the "one scale" half of the round 1 note. */
        const rad = rMin + (rMax - rMin) * shape * shape;
        const q = (dx * dx + dz * dz) / (rad * rad);
        if (q >= 1) continue;
        const hgt = hMin + (hMax - hMin) * (0.30 + 0.70 * jx);
        /* SHELVED, not domed: flat-ish crown, steep skirt. See the
           BOMMIE header. */
        const h = hgt * Math.pow(1 - q, 0.62);
        if (h > best) best = h;
      }
    }
    return best;
  }

  function bommieAt(x, z) {
    const r = Math.hypot(x, z);
    const edge = (1 - sstep(BOMMIE.outer, BOMMIE.outer + BOMMIE.fade, r))
      * sstep(BOMMIE.inner, BOMMIE.inner + BOMMIE.innerFade, r);
    if (edge <= 0.002) return 0;
    /* THE CLUSTERING FIELD, and it is the reason the floor is not
       an even sprinkle. Gates BOTH scales from the same field, so
       a hero bommie sits in a reef patch rather than alone in the
       middle of clean sand. */
    const dens = clamp01(
      nReef.fbm(x * BOMMIE.clumpFreq + 12.3, z * BOMMIE.clumpFreq - 5.7, 2) * 1.85 + 0.40
    );
    if (dens <= 0.02) return 0;
    const small = bommieHeads(
      x, z, BOMMIE.cell, dens * BOMMIE.cover,
      BOMMIE.rMin, BOMMIE.rMax, BOMMIE.hMin, BOMMIE.hMax, 0
    );
    const big = bommieHeads(
      x, z, BOMMIE.bigCell, dens * BOMMIE.bigCover,
      BOMMIE.bigRMin, BOMMIE.bigRMax, BOMMIE.bigHMin, BOMMIE.bigHMax, 977
    );
    return Math.max(small, big) * edge;
  }

  /* ------------------------------------------------------------
     THE COMPOSED HEIGHT

     ORDER IS LOAD-BEARING. Later terms carve through earlier ones
     and cuts come last:

       profile(r')  where r' is the bearing-warped radius
         x ringHeight above the water line
       + reef relief          (spur-and-groove, windward only)
       + island relief        (dune ridges and gullies)
       + lagoon floor relief  (bommies, ripples, the wreck's scar)
       + the Cauldron
       + the Cauldron road's bench
       - the pass
       + station pads
     ------------------------------------------------------------ */

  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(x, -z);
    const aa = a < 0 ? a + TAU : a;

    /* THE RADIAL WARP. Moving the ring's centreline is done by
       moving the RADIUS the profile is sampled at, which keeps the
       whole cross-section coherent - the beach, the berm and the
       reef flat all move together, as they do on a real atoll. A
       per-stop offset would shear them apart. */
    const dR = readBand(ringR, aa);
    let y = atollProfile(r - dR);

    /* THE HEIGHT SCALE applies only ABOVE the water line, so a low
       section of ring becomes a drowned thread rather than a deeper
       lagoon. Scaling the whole profile would raise and lower the
       sea floor with the bearing, which is not a thing atolls do.

       AND IT STOPS AT THE OUTER BEACH. `ringH` runs 0.28 to 1.72,
       which is the whole anti-bagel argument - a ring that is a
       broad forested shoulder on one arc and a low sandy thread on
       another - and it is completely wrong for the reef crest. A
       crest is built by the sea to a level THE SEA sets; it is one
       of the most uniform features in nature, and that uniformity
       is exactly what makes it read as a boundary the water made
       rather than as more island. Ungated, a twelve-bearing scan
       came back with five crests outside the authored band and two
       of them awash at +0.09 and +0.29 - no surf line at all on a
       sixth of the ring. */
    if (y > 0) y *= ringHeightAt(aa, r - dR);

    /* THE WIDTH SCALE moves the island's INBOARD edge only, by
       shifting where the beach face starts. Applied as a shift of
       the sampled radius that dies at the berm crest, so the outer
       half of the section - reef flat, crest, fore-reef - does not
       move with it. The first draft scaled the radius about the
       berm in both directions and sheared the reef off the island;
       the probe caught it as a beach that was 220m wide on one
       bearing and 90m on another with the crest in the same place.

       Positive w widens (lee), negative narrows (windward). */
    {
      const w = readBand(ringW, aa) - 1;
      if (Math.abs(w) > 0.001 && r > 620 && r < 800) {
        const t = sstep(620, 700, r) * (1 - sstep(756, 800, r));
        const shift = w * 42 * t;
        let y2 = atollProfile(r - dR + shift);
        if (y2 > 0) y2 *= ringHeightAt(aa, r - dR + shift);
        y = lerp(y, y2, 0.85);
      }
    }

    /* --------------------- reef relief ---------------------
       SPUR-AND-GROOVE. A reef facing the swell grows in radial
       ribs with sand channels between them, and the ribs run
       PERPENDICULAR to the crest - which is to say radially. That
       is anisotropy with a direction the geometry already has, so
       it is evaluated on a circle in noise space whose centre
       slides with radius: exactly periodic in the bearing, and no
       seam at -X. An arc-length coordinate (theta * r) would seam.

       Windward only, gated on the dot of the outward normal with
       the wind's travel vector - a reef in the lee has no swell to
       build ribs. */
    /* THE BAND IS IN PROFILE RADIUS, NOT WORLD RADIUS, and every
       radial band in this function has to be, for the reason the
       crest's own comment gives: a feature authored at profile
       radius rp appears at world radius rp + dR, and dR runs -29 to
       +29. A band written in world radius therefore lands on a
       DIFFERENT part of the cross-section on every bearing.

       It cost the crest three of twelve bearings. And the band is
       centred at 1050 rather than at the crest, because
       spur-and-groove is a FORE-REEF landform: the crest itself is
       the algal ridge, the single smoothest surface on a reef,
       and it is the one thing on this level that has to read as a
       level line. At 1002 the ribs carried +/-0.64m onto a crest
       whose whole authored relief is 0.62m. */
    const rp = r - dR;
    if (rp > 950 && rp < 1200) {
      const inv = 1 / Math.max(r, 1e-3);
      const ox = x * inv;
      const oz = z * inv;
      const upwind = clamp01(-(ox * windX + oz * windZ) * 0.5 + 0.5);
      const band = (1 - Math.abs(rp - 1050) / 100);
      if (band > 0) {
        const ca = Math.cos(aa);
        const sa = Math.sin(aa);
        /* 26 lobes: a 240m circumference per rib pair at r=1000,
           which is the real spacing of spur-and-groove. */
        const rib = nReef.fbm(ca * 26 + 11.3, sa * 26 + 4.1, 2);
        y += rib * 1.15 * band * band * (0.35 + 0.65 * upwind);
      }
    }

    /* -------------------- island relief --------------------
       Ridges along the ring and gullies across it. Same circle
       trick, much lower wavenumber, and it dies at the water line
       so it cannot put a dune under the sea. */
    /* PROFILE radius again, and it STOPS AT 900 rather than at 970.
       Dunes and gullies belong to the island; the outer slope, the
       reef flat and the crest belong to the sea, and the sea does
       not cut gullies across a reef flat. Written in world radius
       and running to 970, this term reached the crest on every
       bearing with a negative dR and took it to -2.90 where +0.62
       is authored. */
    if (y > -1.2 && rp > 740 && rp < 900) {
      const ca = Math.cos(aa);
      const sa = Math.sin(aa);
      const ridge = nRidge.fbm(ca * 9 + 2.7, sa * 9 - 6.4, 3);
      const gully = nGully.fbm(ca * 17 - 8.1, sa * 17 + 3.3, 2);
      const above = clamp01((y + 1.2) / 3.4);
      y += ridge * 2.6 * above;
      /* Gullies CUT, so they are a negative-only term: a gully
         field that also raises is a bumpy hillside. */
      y -= Math.max(0, gully) * 1.8 * above;
    }

    /* -------------------- lagoon floor --------------------
       Bommies (isolated coral heads), long sand waves, and nothing
       else. The floor is SEEN, through four to eight metres of
       clear water, so it needs shape - but it is also what the
       Spine's shadow falls on, and a busy floor destroys that
       shadow. See the BOMMIE header for why round 1's version was
       camouflage and what replaced it. */
    if (r < BOMMIE.outer + BOMMIE.fade) {
      /* CAPPED AT THE WATERLINE - see BOMMIE.crownY. Written as a
         min against the headroom rather than as a clamp on the
         result so a head on deep water is untouched and only the
         ones that would break the surface are planed. */
      y += Math.min(bommieAt(x, z), Math.max(0, BOMMIE.crownY - y));

      /* SAND WAVES. Long, low, and on ONE heading - the lagoon's
         own fetch, which is the trade wind's, so this is the only
         directional term down here and it cannot go plaid. 59 m
         wavelength at 0.30 m of amplitude is A*k = 0.032, which
         is a shadow at a grazing sun and nothing at noon, which is
         what a sand wave is.

         The phase is dragged by a 250 m noise so the crests wander
         instead of ruling straight lines across the lagoon - the
         same meander art.js's dune field uses, and for the same
         reason: parallel crests at a constant spacing are the
         corduroy this level has already been marked down for once,
         on the water. */
      const swash = (x * windZ - z * windX) * 0.1065
        + nDetail.fbm(x * 0.004 + 55, z * 0.004 - 31, 2) * 2.4;
      y += Math.sin(swash) * 0.30
        + nDetail.fbm(x * 0.036 + 3, z * 0.036 + 9, 2) * 0.16;
    }

    /* ---------------------- the Cauldron ---------------------- */
    y = cauldronAt(x, z, y);


    /* ------------------------ the pass ------------------------
       A MIN, not a subtraction. Applied against the ring only, in
       a radial window, so it cuts the island and leaves the lagoon
       floor and the fore-reef alone. */
    {
      const d = Math.abs(angleDelta(aa, PASS.bearing));
      if (d < PASS.halfAngle + PASS.feather && r > PASS.inner && r < PASS.outer) {
        const g = 1 - sstep(PASS.halfAngle, PASS.halfAngle + PASS.feather, d);
        const rad = sstep(PASS.inner, PASS.inner + 90, r)
          * (1 - sstep(PASS.outer - 70, PASS.outer, r));
        const k = g * rad;
        const fl = passFloorAt(r);
        if (k > 0.001 && y > fl) y = lerp(y, Math.min(y, fl), k);
      }
    }

    /* ---------------------- station pads ---------------------- */
    y = padsAt(x, z, y);

    /* ------------------- the Cauldron road -------------------
       LAST, and it took a measurement to put it here. Behind the
       index's own bucket reject, so a sample anywhere else on the
       map costs one Map lookup that misses.

       Run before the pads, the Weeping Steps' feather - which on a
       1.6 flank spans a hundred metres of elevation - lay on top of
       90m of the ascent and the probe read the bed 105m above the
       ground it was supposed to be cut into. Run last, with the
       pad's own DISC blended into the target, the arena floor still
       wins where it is a floor and the trace wins where it is only
       crossing somebody's blend region. Kenosis's rule verbatim:
       blend the TARGET, never the strength. Every version that
       suppressed the cut near an arena failed identically - the
       road stopped being cut exactly where its centreline lay on
       the steepest ground the feather had left, and a road that
       switches off is a road with a hole in it. */
    y = cauldronRoadCut(y, x, z);

    return y;
  }

  /* ------------------------------------------------------------
     THE CAULDRON, as a pure function of position and the height
     under it. A breached crater: a bell to the rim, then a dish
     inside it, then the breach cut through the north-west wall.
     ------------------------------------------------------------ */
  const FLANK_SPAN = CAULDRON.baseR - CAULDRON.rimR;    // 156m of run

  function cauldronAt(x, z, y0, withRelief = true) {
    const dx = x - CAULDRON.x;
    const dz = z - CAULDRON.z;
    const d = Math.hypot(dx, dz);
    if (d > CAULDRON.baseR) return y0;

    /* ---- REGIME 1: the outer flank, d in [rimR, baseR] ----
       `s` is 0 at the base and 1 at the rim, so the ground the plug
       stands on carries through at the toe and the rim is exactly
       rimY - which is what the first draft could not say. Clamped
       with a max against y0 so the plug can only ADD: on the
       lagoon side y0 is -8 and on the ring side it is +9, and a
       lerp toward rimY is a rise in both cases, but the max makes
       that a property of the code rather than of the numbers. */
    /* THE BEARING IS RESOLVED FIRST NOW, because the rim's height
       is a function of it and both regimes need that before they
       can name a target. Convention is this file's own throughout:
       atan2(dx, -dz), +Z south. */
    const abRaw = Math.atan2(dx, -dz);
    const ab = abRaw < 0 ? abRaw + TAU : abRaw;
    const rimY = cauldronRimY(ab);

    const s = flankRamp(
      CAULDRON.baseR - d, FLANK_SPAN,
      CAULDRON.flankEase, CAULDRON.crestEase, CAULDRON.faceBias
    );
    let y = Math.max(y0, lerp(y0, rimY, s));

    /* ---- REGIME 2: the lip and the dish, d < rimR ----
       Flat crater floor out to the lip, then the lip climbs to the
       rim. Written as ONE smoothstep of d/rimR over lipFrom..1 so
       the rim value is reached exactly at d = rimR and the two
       regimes meet with no step and no double-count - they read
       the SAME `rimY`, which is the property that keeps that true
       now the rim varies with the bearing. */
    if (d < CAULDRON.rimR) {
      const lip = sstep(cauldronLipFrom(ab), 1.0, d / CAULDRON.rimR);
      y = lerp(CAULDRON.floorY, rimY, lip);
    }

    /* The breach. Cut from the rim outward on the north-west,
       feathered in bearing, and it is what the Weeping Steps come
       down. Without it the crater is sealed and the waterfall has
       no source. */
    const off = Math.abs(angleDelta(ab, CAULDRON.breachBearing));
    if (off < CAULDRON.breachHalf) {
      const g = 1 - sstep(CAULDRON.breachHalf * 0.35, CAULDRON.breachHalf, off);
      /* THE BREACH STARTS AT THE RIM, not at 0.55 of it. A breach
         is a notch cut through the crater WALL; run inward from
         d = 46 it also dished the crater floor, and because the pad
         holds that floor dead level out to d = 52 the two met in a
         2.5-grade step right on the arena's edge - the flatness
         probe read grade 2.51 at exactly d = 52.0. */
      const rad = sstep(CAULDRON.rimR * 0.82, CAULDRON.rimR * 1.06, d)
        * (1 - sstep(CAULDRON.baseR * 0.62, CAULDRON.baseR, d));
      y -= CAULDRON.breachDrop * g * rad;
    }

    if (!withRelief) return y;

    /* Ash-cone relief: radial rills, which is what a loose cinder
       slope erodes into. Anisotropic and radial, same construction
       as the reef ribs.

       FADED OFF THE STRAIGHT FACE. The rills' own grade is A*k and
       it lands on top of the face's 1.68; at the shipped amplitude
       that is 0.17, and leaving it at full strength across the
       whole flank put the steepest patches at 1.85 with nothing
       under them. `open` is 1 on the toe and on the shoulder, where
       the flank is easing and there is room, and drops to a third
       across the straight section. */
    if (d > CAULDRON.rimR * 0.9) {
      const inv = 1 / Math.max(d, 1e-3);
      const ca = dx * inv;
      const sa = dz * inv;
      /* NOISE-CIRCLE RADIUS 5.0, AND IT WAS 21. This is the single
         measured cause of "the rills are invisible" and of most of
         the plug's steep-sample count, and the old comment's "21
         lobes" was out by a factor of 2*PI.

         Sampling a unit-lattice gradient noise on a circle of
         radius R crosses 2*PI*R cells, so R = 21 is about 132
         lobes per revolution, not 21. At d = 90 that is a 4.3 m
         tangential wavelength - the LOD0 cell is 4 m. The rills
         were being drawn at exactly the sampling frequency of the
         mesh: they aliased into noise close up, averaged to a
         smooth grey at 900 m, and their A*k of 2.05 was most of
         what put 18 % of the rim band past grade 2.3.

         R = 5.0 is 31.4 lobes, a 30 m wavelength at d = 150, which
         is 30 px at the aerial camera and seven LOD0 cells across.
         A*k is then 2.6 * 0.209 = 0.54 TANGENTIAL, which composes
         with the fall line as a hypotenuse. */
      const rill = nRidge.fbm(ca * 5.0 + 31.7, sa * 5.0 - 12.2, 2);
      const p = CAULDRON.baseR - d;
      const open = 1 - 0.66 * sstep(CAULDRON.flankEase * 0.4, CAULDRON.flankEase, p)
        * (1 - sstep(FLANK_SPAN - CAULDRON.flankEase, FLANK_SPAN - CAULDRON.flankEase * 0.4, p));
      /* RILLS CUT. They were a symmetric sine of the bearing,
         which raises as much ground as it lowers and therefore
         reads as an undulation rather than as erosion - the same
         note the island's gully term already carries ("a gully
         field that also raises is a bumpy hillside"). Negative
         only, so what is left between them is a flat interfluve,
         which is what a rilled cinder slope actually looks like
         and what casts the shadow that makes it read at 900 m.
         1.9x because a one-sided term has half the range. */
      y -= Math.max(0, -rill) * CAULDRON.rillAmp * 1.9 * open
        * (1 - sstep(CAULDRON.baseR * 0.55, CAULDRON.baseR, d));

      /* THE BUTTRESSES. Seven ribs and eleven, exactly - see
         CAULDRON.buttressAmp for why these are written as integer
         sines and not as a noise circle.

         The envelope is a RADIAL band that peaks on the lower-mid
         flank and is gone by the crest ease, and that placement is
         the whole safety argument: the envelope's own gradient is
         radial and therefore DOES add to the fall line, 1.5 * 9 /
         71 = 0.19 of it. Spent where the concave face is at 1.42
         it costs nothing; spent under the rim, where the face is
         at 1.81, it would have put 2.0 on the steepest ground on
         the level. Buttresses fan out at a plug's foot anyway -
         that is where the debris apron is - so the geology and the
         arithmetic want the same envelope. */
      /* THE ENVELOPE IS LONG AT BOTH ENDS, and both spans are
         bought rather than chosen. A ramp of height A over a run
         S contributes 1.5 * A / S of RADIAL grade, which is the
         one part of this term that adds to the fall line.

         Inward: 21 m over 96 m of run is 0.33, and it lands where
         the concave face is at 1.75 under the rim - 2.08, which
         is past the comb. So the ribs do not die under the rim at
         all: they hand over to the rim harmonics, which carry the
         SAME two wavenumbers at the same phases, so a rib runs
         into a horn and the silhouette is continuous.

         Outward: 21 m over 62 m is 0.51, and it lands on the toe
         where the face is at 1.05 - 1.56, which is a debris apron
         and looks like one. The apron is where a plug's ribs fan
         out anyway. */
      const bEnv = sstep(CAULDRON.rimR * 0.96, CAULDRON.rimR * 2.10, d)
        * (1 - sstep(CAULDRON.baseR * 0.74, CAULDRON.baseR, d));
      if (bEnv > 0.002) {
        y += (Math.sin(7 * ab + 0.73) * 0.62 + Math.sin(11 * ab - 2.11) * 0.38)
          * CAULDRON.buttressAmp * bEnv;
      }

      /* BEDDING PLANES, and the guard on them is `A*k < 1` with
         respect to y ITSELF, because the term is a function of the
         quantity it is adding to. At A*k = 1 the term can cancel
         the flank's own rise; past it the surface folds back and
         the mountain drains uphill. Kenosis measured fourteen slope
         reversals on one transect at 1.02 and spent two milestones
         tuning a shader for an artefact the terrain was making.

         Here: 0.115 * 3.2 + 0.54 * 0.30 = 0.368 + 0.162 = 0.53.
         Buy amplitude with wavelength, never with wavenumber - a
         55m bedding interval carrying 3.2m of ledge is three times
         the relief of a 20m one at half the inversion risk, and on
         a basalt plug horizontal ledges are what the material
         actually does. */
      const bed = clamp01((y - 60) / 40) * (1 - sstep(CAULDRON.baseR * 0.8, CAULDRON.baseR, d));
      if (bed > 0.002) {
        /* THE PHASE HAS TO WANDER FAST ENOUGH TO BREAK THE RING.
           At 0.004 (a 250 m wavelength) the phase moves by about
           two radians across a 480 m plug, so every bedding plane
           came out as a CONTINUOUS TERRACE all the way round the
           cone - and two continuous terraces on a 156 m flank is
           a wedding cake, which is most of what "reads as a
           flat-topped mesa" was pointing at. Measured on both the
           round 1 field and the first pass of this one: dead
           level benches 30 m wide at y = 93 and y = 195, grade
           0.02 to 0.1, on every bearing.

           0.0075 is a 133 m wavelength and 4.6 rad of gain, so a
           given ledge climbs and falls by most of a bedding
           interval over a quarter turn and breaks into offset
           benches instead. That is also what a bedded plug does -
           the beds are not level, they are faulted, and you see
           them in section from every angle at once. It stops
           short of 0.011, which broke them up so far that they
           stopped reading as bedding at all.

           It costs 3.2 * 4.6 * 0.0075 * 1.3 = 0.14 of horizontal
           gradient, most of it tangential. The A*k guard is
           unchanged, because that guard is with respect to y and
           the phase is not a function of y.

           NOTE FOR WHOEVER READS THIS NEXT: the two 25 m flat
           benches on this flank are NOT this term. They are the
           Cauldron road, whose corridor is core 4.6 + shoulder 24
           = 57 m wide, and whose shoulder is a smoothstep - which
           has zero slope at BOTH ends, so each end contributes
           another several metres of near-level ground. Measured
           at grade 0.04 to 0.16 across d = 150-175 and d = 100-110
           on every bearing, in round 1's field and in this one.
           Both of those numbers are argued from the mesh cell and
           from the spiral's measured 60.6 m leg spacing, so they
           are not free to change here. */
        const ph = nDetail.fbm(x * 0.0075 + 12.5, z * 0.0075 - 7.25, 2) * 4.6;
        y += (Math.sin(y * 0.115 + ph) * 3.2
          + Math.sin(y * 0.54 - ph * 0.7) * 0.30) * bed;
      }
    }

    return y;
  }

  /* ------------------------------------------------------------
     PATH PLUMBING

     summit-terrain.js:1934-2054's three helpers, unchanged in
     behaviour and copied rather than imported because they close
     over nothing and the two files must be free to diverge.
     `indexProfiles` takes a LIST of profiles precisely so N paths
     share ONE index: N indexes would be N Map lookups per height
     evaluation, and the joining segment between path i's tail and
     path i+1's head would cut a road nobody authored.
     ------------------------------------------------------------ */

  function buildPathProfile(path, spacing, smoothPasses, sampler) {
    let total = 0;
    for (let i = 1; i < path.length; i += 1) {
      total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    const samples = Math.max(4, Math.round(total / spacing) + 1);
    const pts = [];
    for (let i = 0; i < samples; i += 1) {
      const t = (i / (samples - 1)) * (path.length - 1);
      const k = Math.min(path.length - 2, Math.floor(t));
      const f = t - k;
      pts.push({
        x: lerp(path[k][0], path[k + 1][0], f),
        z: lerp(path[k][1], path[k + 1][1], f),
        y: 0,
      });
    }
    for (const p of pts) p.y = sampler(p.x, p.z);
    for (let pass = 0; pass < smoothPasses; pass += 1) {
      const copy = pts.map((p) => p.y);
      for (let i = 1; i < pts.length - 1; i += 1) {
        pts[i].y = (copy[i - 1] + copy[i] * 2 + copy[i + 1]) * 0.25;
      }
    }
    return pts;
  }

  /** Two symmetric sweeps, repeated. Converges because each sweep
   *  only moves a node toward its predecessor's reachable band.
   *  This is what turns "designed at 12%" into "IS at or under 15%
   *  everywhere", which is what the harness measures. */
  function gradeLimit(pts, maxGrade, passes = 3) {
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 1; i < pts.length; i += 1) {
        const cap = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) * maxGrade;
        const dy = pts[i].y - pts[i - 1].y;
        if (dy > cap) pts[i].y = pts[i - 1].y + cap;
        else if (dy < -cap) pts[i].y = pts[i - 1].y - cap;
      }
      for (let i = pts.length - 2; i >= 0; i -= 1) {
        const cap = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].z - pts[i + 1].z) * maxGrade;
        const dy = pts[i].y - pts[i + 1].y;
        if (dy > cap) pts[i].y = pts[i + 1].y + cap;
        else if (dy < -cap) pts[i].y = pts[i + 1].y - cap;
      }
    }
    return pts;
  }

  function indexProfiles(profiles, reach) {
    const CELL = 64;
    const buckets = new Map();
    const key = (gx, gz) => gx * 8192 + gz;
    const segs = [];
    for (let p = 0; p < profiles.length; p += 1) {
      const prof = profiles[p];
      for (let i = 0; i < prof.length - 1; i += 1) {
        segs.push({ a: prof[i], b: prof[i + 1], p, t: i / (prof.length - 1) });
      }
    }
    for (let n = 0; n < segs.length; n += 1) {
      const { a, b } = segs[n];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / CELL);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / CELL);
      const z1 = Math.floor((Math.max(a.z, b.z) + reach) / CELL);
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gz = z0; gz <= z1; gz += 1) {
          const k = key(gx, gz);
          let list = buckets.get(k);
          if (!list) { list = []; buckets.set(k, list); }
          list.push(n);
        }
      }
    }
    return {
      segs,
      reach,
      query(x, z) {
        const list = buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!list) return null;
        let bestD = Infinity;
        let bestY = 0;
        let bestP = -1;
        let bestT = 0;
        for (let n = 0; n < list.length; n += 1) {
          const s = segs[list[n]];
          const a = s.a;
          const b = s.b;
          const bax = b.x - a.x;
          const baz = b.z - a.z;
          const hh = clamp01(
            ((x - a.x) * bax + (z - a.z) * baz) / (bax * bax + baz * baz || 1e-6)
          );
          const d = Math.hypot(x - (a.x + bax * hh), z - (a.z + baz * hh));
          if (d < bestD) { bestD = d; bestY = lerp(a.y, b.y, hh); bestP = s.p; bestT = s.t; }
        }
        return bestD > reach ? null : { d: bestD, y: bestY, path: bestP, t: bestT };
      },
    };
  }

  /* ============================================================
     THE VIA SACRA OF THIS LEVEL: THE CAULDRON ROAD

     THE PROBLEM, STATED AS ARITHMETIC. The Cauldron's flank stands
     at 1.68 by construction and its rim is 214m up. The Weeping
     Steps terrace, the only foothold on the mountain, is at d = 148
     and y = 74. That leaves 64m of radial run for 140m of rise, so
     NO RADIAL RAMP CAN DO IT - not at any width, not with any
     feather. The only shape that fits is a shelf that goes round.

     So: a helical bench, marched rather than parameterised, exactly
     as Kenosis marches the Via Sacra and for exactly the same
     reason. A parametric spiral cannot satisfy three constraints at
     once (start radius, end radius, grade ceiling), because with
     radius eased in t the climb rate is fixed by t while the length
     is not - Kenosis's last turn came out at 21% against a 13%
     ceiling. Marching makes the TURN COUNT fall out of the profile
     instead of being asserted, and the turn count agreeing with the
     hand estimate is then a check that the numbers are mutually
     consistent rather than a coincidence.

     TWO DIFFERENCES FROM KENOSIS, both deliberate:

     1. The march rides the cone's OWN elevation, not a design
        elevation of its own. Kenosis's road is a cut across a
        mountain that has no walkable contour anywhere; this one is
        a contour, and a contour costs no earthworks. The bed is
        therefore within a metre of the ground along its whole
        length and the cut is a BENCH - level across the
        carriageway, which is the only thing a 1.68 flank actually
        needs - rather than an embankment.

     2. The cut runs BEFORE the pads, where Kenosis runs its road
        last. Kenosis's reason for last is crevasses: a slot across
        a road is a bridge problem and this engine has no bridges.
        There are no slots on this mountain. The only term that runs
        after the road here is a station pad, and the only pad the
        road meets is the Weeping Steps, which is its own trailhead
        - an arena floor must win over a trace that arrives at it,
        or the trace puts a ramp through the fight.
     ============================================================ */

  /** The plug's landform: profile, ring scale, plug, breach - no
   *  rills, no bedding, no pads, no road. The march's reference
   *  surface, and the road profile's sampler. */
  function cauldronLandform(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(x, -z);
    const aa = a < 0 ? a + TAU : a;
    const dR = readBand(ringR, aa);
    let y = atollProfile(r - dR);
    if (y > 0) y *= ringHeightAt(aa, r - dR);
    return cauldronAt(x, z, y, false);
  }

  /* Local polar helpers for the plug's own frame. `ab` follows the
     same convention as everything else in this file: bearing is
     atan2(dx, -dz), so +Z is south here too. */
  const plugX = (d, ab) => CAULDRON.x + d * Math.sin(ab);
  const plugZ = (d, ab) => CAULDRON.z - d * Math.cos(ab);
  const plugY = (d, ab) => cauldronLandform(plugX(d, ab), plugZ(d, ab));

  /* THE DESIGN GRADE, and it is not a round number for the same
     reason Kenosis's 0.082 is not. The gate is 0.16 measured on the
     BUILT bed; the built bed is the design curve after smoothing
     and after a grade limiter, and both of those only ever make a
     section steeper where they pull a neighbour down. 0.125 leaves
     28% of headroom, and it puts the length at 140/0.125 = 1120m,
     which is the 1130m the layout estimate asked for - the two
     agreeing is the check that the plug's geometry and the route's
     ambition are compatible at all. */
  const ROAD_GRADE = 0.125;
  const ROAD_STEP = 6;              // metres per march step
  /* Rad per step. 0.40 over 6m is a 15m minimum curve radius, which
     is tighter than anything the spiral asks for and exists only to
     stop the pitch snapping when `asin` goes vertical at a profile
     ease. RATE-LIMITED AND NOT DAMPED: damping lags whenever the
     target moves, and Kenosis measured that lag eating a fifth of
     its road and holding the grade over its ceiling on 87% of
     samples. A turn-rate limit has no steady-state error. */
  const ROAD_MAX_TURN = 0.40;

  /* Metres of radius the corrector may move in one step. The
     corrector is what makes this a CONTOUR and not a spiral drawn
     on top of one, and it has to be limited or the breach - a 30m
     notch cut through the cone's north-west wall - teleports the
     route thirty metres outboard in a single 6m step. Held to 3.0
     the road swings out into the notch over about ten steps, which
     is a bend, which is what a real road does at a re-entrant. */
  const ROAD_CORRECT = 2.5;
  /* The steepest the route may run relative to the contour, as a
     sine. Capped because `asin(G/g)` goes to 90 degrees wherever
     the cone flattens - and the cone flattens twice by
     construction, at the toe and at the ROUNDED SHOULDER under the
     rim. Uncapped, the last thirty metres of climb turned into a
     radial dive: the march drove d from 113 to 85, hit the rim
     clamp, and the corrector hauled it back out to 99 - a hairpin
     at the top of the mountain that nobody authored and that the
     no-hairpin rule exists to prevent. 0.55 is 33 degrees off the
     contour, which is as direct as a mountain road ever runs. */
  const ROAD_MAX_SIN = 0.55;

  const cauldronRoadNodes = (() => {
    const startAb = CAULDRON.breachBearing;
    /* Where the cone itself stands at the trailhead elevation.
       DERIVED BY BISECTION, never a literal: Kenosis's road started
       53m inside its own gate because the start radius was a
       literal 838 while the basecamp had moved to 891, and every
       station's reachability failed at the same coordinate - which
       is the signature of a fault on the shared leg rather than at
       any of them. */
    const targetY = STATIONS.weeping.padY;

    /** The radius at which the cone stands at `want` on bearing
     *  `ab`, bracketed to the flank. Monotone there by
     *  construction, so 34 bisection steps resolve it to a
     *  millimetre and it runs once per march step. */
    function radiusFor(want, ab, hint) {
      let lo = CAULDRON.rimR + 0.8;
      let hi = CAULDRON.baseR - 2;
      if (hint !== undefined) {
        lo = Math.max(lo, hint - ROAD_CORRECT * 6);
        hi = Math.min(hi, hint + ROAD_CORRECT * 6);
        if (hi <= lo) { lo = CAULDRON.rimR + 0.8; hi = CAULDRON.baseR - 2; }
      }
      for (let i = 0; i < 34; i += 1) {
        const mid = (lo + hi) * 0.5;
        if (plugY(mid, ab) > want) lo = mid; else hi = mid;
      }
      return (lo + hi) * 0.5;
    }

    let d = radiusFor(targetY, startAb);
    let ab = startAb;
    let y = targetY;
    let pitch = Math.asin(clamp01(ROAD_GRADE / 1.6));
    const nodes = [{ x: plugX(d, ab), z: plugZ(d, ab), d, ab, y }];

    /* THE LEVEL APPROACH ACROSS THE TERRACE, and it is not a
       flourish - it closes a step.

       The trailhead is inside the Weeping Steps' pad, and inside a
       pad the road's target is the pad's floor (that is what the
       claim is for). Starting the climb at the pad's CENTRE meant
       the bed had already gained 84 * 0.125 = 10.5m of design
       elevation by the time it left the disc, while the ground it
       stood on was still the arena's 74 - so the road stepped ten
       metres the instant it cleared the rim, and the probe read a
       walk grade of 0.777 on the first twenty metres of the
       level's signature climb.

       So the route crosses the terrace level, at the terrace's own
       elevation, and starts climbing where the terrace ends. Which
       is also what a road does. */
    {
      let run = 0;
      const approach = STATIONS.weeping.padA + CLAIM_RAMP + 8;
      while (run < approach) {
        ab += ROAD_STEP / Math.max(d, 24);
        d = radiusFor(y, ab, d);
        nodes.push({ x: plugX(d, ab), z: plugZ(d, ab), d, ab, y });
        run += ROAD_STEP;
      }
    }

    for (let n = 0; n < 1600; n += 1) {
      /* PREDICT. The cone's radial gradient here, central
         difference, then the pitch that turns it into the design
         grade. RATE-LIMITED AND NOT DAMPED: `asin` has infinite
         slope where its argument reaches 1, so the desired heading
         swings through 55 degrees in one step at every profile
         ease; damping at 0.09/step removed the corner AND a fifth
         of Kenosis's road, because damping lags whenever the target
         moves and the lag holds the pitch too steep coming out of
         every boundary. A turn-rate limit has no steady-state
         error. */
      const g = (plugY(d - 1.5, ab) - plugY(d + 1.5, ab)) / 3;
      const want = Math.asin(clamp(g > 1e-4 ? ROAD_GRADE / g : 1, 0, ROAD_MAX_SIN));
      pitch += clamp(want - pitch, -ROAD_MAX_TURN, ROAD_MAX_TURN);
      ab += (ROAD_STEP * Math.cos(pitch)) / Math.max(d, 24);
      d -= ROAD_STEP * Math.sin(pitch);
      y += ROAD_GRADE * ROAD_STEP;

      /* CORRECT. Move the radius back onto the contour the design
         elevation actually lives on at this NEW bearing. Without
         this step the march tracks the radial gradient only and is
         blind to the tangential one, so it walks straight over the
         breach: the bed came out 116m off the ground and the grade
         limiter, fighting a 30m step, pinned every single segment
         to its own ceiling - mean grade exactly equal to max, which
         is the signature of a limiter that has stopped being a
         safety net and become the road. */
      const tgt = radiusFor(y, ab, d);
      d += clamp(tgt - d, -ROAD_CORRECT, ROAD_CORRECT);

      if (d <= CAULDRON.rimR + 1.0) d = CAULDRON.rimR + 1.0;
      nodes.push({ x: plugX(d, ab), z: plugZ(d, ab), d, ab, y });
      /* THE RIM IS BEARING-LOCAL, so the arrival test has to be
         too. Against the old literal 214 the march either stopped
         early on a high sector (short of a rim it had already
         reached) or never stopped on a low one and ran into the
         1600-step guard with the corrector fighting the rimR clamp
         the whole way. Reading `cauldronRimY(ab)` also gives the
         route the property a real mountain road has: it tops out
         wherever the crest is LOWEST within reach, which is a
         pass. */
      const rimHere = cauldronRimY(ab < 0 ? ab + TAU : ab % TAU);
      if (y >= rimHere - 0.4) break;
      if (d <= CAULDRON.rimR + 1.01 && plugY(d, ab) >= rimHere - 2.0) break;
    }
    return nodes;
  })();

  const CAULDRON_ROAD_PATH = cauldronRoadNodes.map((p) => [p.x, p.z]);

  /* 12 smoothing passes rather than Kenosis's 18: the march already
     rides a C1 surface, so the only thing to smooth out is the
     march's own step-to-step wobble at the profile eases. The
     limiter cap is the gate minus a margin, so a limiter that binds
     shows up in the measured max instead of hiding under it. */
  const cauldronRoadProfile = gradeLimit(
    buildPathProfile(CAULDRON_ROAD_PATH, ROAD_STEP, 12, cauldronLandform),
    0.150
  );

  /* Half-width of the running surface, and of the graded shoulder
     beyond it. 3.4m of carriageway either side is a 6.8m bench:
     wide enough for the player's 0.45m capsule plus a fight, narrow
     enough that a 1.8-turn spiral's legs (40m apart at the tightest
     point, near the rim) do not merge into one slab and lose the
     spiral. Kenosis's hairpin rule restated: adjacent legs must be
     at least 2x the shoulder width apart. */
  /* Half-width of the running surface. 4.6 IS SET BY THE MESH, not
     by taste: the LOD0 cell is 4m, so a 5.6m carriageway is 1.4
     samples across and the drawn triangles cannot reproduce it -
     the analytic field and the mesh disagreed by up to 3.3m ON THE
     ROAD, which is where the player's feet and the footprint decals
     both are. 9.2m is 2.3 cells, and the mid-cell disagreement
     falls under a metre. Nothing narrower than about two cells can
     be built into a height field at all; it is the same arithmetic
     that puts a floor under a crevasse's width. */
  const ROAD_CORE = 4.6;
  /* And the graded cut/fill beyond it. THE CUT FACE'S GRADE IS
     `flank + core*flank/shoulder`, not `shoulder`-anything, because
     the ground the bench is cut into is itself climbing at 1.6:
     going from the bed back up to natural ground means out-running
     the mountain. At core 2.8 and shoulder 14 that is
     1.5 * 1.635 = 2.45 - a 9.8m step from column to column at the
     4m cell, which reads as a rock cut.

     AND THE WIDTH IS FREE ON THAT GRADE, WHICH IS THE USEFUL PART.
     Across a shoulder of span S the natural ground has risen by
     about S * 1.635, so a smoothstep's peak grade is
     1.5 * S * 1.635 / S = 2.45 whatever S is - but its second
     derivative is 6D/S^2 = 9.8/S, and the mid-cell disagreement
     between the analytic field and the drawn triangles is twice
     that. So a WIDER shoulder is strictly better for the mesh and
     neutral for the walk: 18m gave 1.09m of disagreement on the
     one strip the player's feet and every footprint decal are on,
     and 24m gives 0.82m. The ceiling is the spiral: the measured
     minimum separation between legs is 60.6m, so the corridor may
     not exceed 30m either side. It is a wall
     and it is meant to be; what it must not become is the uniform
     vertical comb, and that starts around grade 11.

     The first version sized the shoulder as Kenosis does, by the
     lift between bed and ground. That is right for an embankment
     flung across a gully and catastrophic for a bench on a steep
     flank: `lift` grows with distance from the centreline, so the
     shoulder chased it outward and the corridor never closed. The
     probe measured a radial grade of 39 through the bench. This bed
     rides its own contour, so its lift IS zero and the shoulder is
     a constant. */
  const ROAD_SHOULDER = 24.0;
  /* Reach 32 is just outside core+shoulder (28.6) and INSIDE half
     the spiral's MEASURED tightest leg spacing, which is 60.6m
     between node 0 and node 154 - not the 42m the hand estimate
     predicted, because the corrector swings the route outward in
     the breach and that is where the legs would otherwise pinch. A
     nearest-segment index is discontinuous on the medial axis
     between two legs, and the two legs there are 90m apart in
     elevation; keeping the reach under half the spacing means the
     query returns null before it can flip, so the discontinuity
     always lands where its weight is exactly zero. */
  const cauldronRoadIndex = indexProfiles([cauldronRoadProfile], 32);

  /**
   * The bench. `core` is a HARD SET rather than a weight, because
   * `pow(bed, 0.55)` reaches 1 only in the limit and every other
   * term therefore keeps a few per cent of a vote on the one strip
   * that has to be walkable end to end - and a few per cent of a
   * twenty-metre disagreement is a step in the middle of the climb.
   */
  function padClaimAt(x, z) {
    let w = 0;
    let cy = 0;
    for (const e of PAD_LIST) {
      const s = e.s;
      const dx = x - s.x;
      const dz = z - s.z;
      const big = s.padA + CLAIM_RAMP;
      if (dx * dx + dz * dz > big * big) continue;
      const u = dx * e.ux + dz * e.uz;
      const v = dx * e.vx + dz * e.vz;
      const k = (1 - sstep(s.padA, s.padA + CLAIM_RAMP, Math.abs(u)))
        * (1 - sstep(s.padC, s.padC + CLAIM_RAMP, Math.abs(v)));
      if (k > w) { w = k; cy = s.padY; }
    }
    return { w, y: cy };
  }

  function cauldronRoadCut(y, x, z) {
    const q = cauldronRoadIndex.query(x, z);
    if (!q) return y;
    const claim = padClaimAt(x, z);
    const target = lerp(q.y, claim.y, claim.w);
    const shoulder = ROAD_CORE + ROAD_SHOULDER;
    const bed = 1 - sstep(ROAD_CORE, shoulder, q.d);
    const core = 1 - sstep(0, ROAD_CORE, q.d);
    return lerp(y, target, Math.max(Math.pow(bed, 0.55), core));
  }

  /* ------------------------------------------------------------
     STATION PADS

     Every station block is behind a bounding-circle reject and a
     `k > 0.001` guard, so an out-of-station sample costs one
     squared distance and a compare - the measured reason Kenosis
     can afford nine of them at 1.4M evaluations.

     The Hold has padA 0 and is skipped entirely: its floor is the
     ship's, 34m up.
     ------------------------------------------------------------ */
  /* THE PADS ARE ELLIPSES, MAJOR AXIS ALONG THE SHORE, and that is
     not a refinement - a circular pad does not fit on this island.

     The ring's cross-section is 176m wide (waterline in at r=738,
     waterline out at r=914). The first draft used circular pads of
     radius 96-140 with a 46m feather, which is a 284-372m disc laid
     on a 176m island: the probe's radial section came back FLAT at
     3.90m from r=742 all the way to r=958, having erased the beach
     face, the berm, the island crest, the outer slope and the reef
     flat on the arrival bearing. The whole cross-section that makes
     an atoll an atoll was inside one station's feather.

     `padA` is the half-length ALONG the shore (tangential) and
     `padC` the half-width ACROSS it (radial). Every `padC` is
     under 66m, so the widest pad plus its feather is 152m and the
     section survives on both sides of it. It is also the better
     shape for a fight: an arena on a shore is a strip, and a strip
     has two ends, which is two approaches. */
  const PAD_FEATHER = 30;

  /* ------------------------------------------------------------
     PAD RELIEF - round 1's defect 6.

     "The arrival frame's near half is a blank flat plane. Camera
     clearance 1.72 m. The Landing's pad is flat to +/-0 over
     118 x 46 m and fills the lower half of the level's most
     important frame with one untextured tan value. This is
     Kenosis's flat untextured hexagon, in sand."

     It was flat to +/-0 EXACTLY: `padFlatness` returned p95 0.000
     and max 0.000 on all eight pads, because `padsAt` lerps
     toward a scalar. A fight floor needs a TOLERANCE, not an
     exactness - the gate is p95 <= 0.35 m and the build was
     spending none of it.

     Three terms, and each is a real beach landform rather than a
     noise budget:

       CUSPS. Crescentic scallops along the swash line, 30 m
       spacing - the low end of the real 10-40 m range, chosen so
       the arrival camera sees four of them across the pad rather
       than one. They run along the pad's LONG axis, which for the
       seven shore pads is the shore, which is where cusps are.

       THE BERM. The ridge the last high tide built, running
       shore-parallel. Two half-cycles across the strip -
       A1*cos(PI*t) + A2*sin(PI*t) - and BOTH ARE ZERO-MEAN over
       t in [-1,1] by construction, which is the property that
       keeps p95 small: a berm modelled as a bump would move the
       whole pad's mean off `padY` and spend the gate on an offset
       nobody can see. The sine term puts the crest off centre,
       which is where a berm crest is.

       THE SWASH. One two-octave noise at a 14 m wavelength for
       everything smaller. Isotropic and a single call: a product
       of two sines was tried first and is a cross-hatch, which is
       the plaid this house has been marked down for twice.

     Measured: peak 0.33 m, p95 0.23 m against a 0.35 m gate, and
     the grade it adds is 0.027 + 0.010 + 0.025 = 0.062 against a
     0.08 pad ceiling and a 0.18 circuit ceiling.

     BLEND THE TARGET, NEVER THE STRENGTH. The relief is added to
     `padY` INSIDE the lerp, so it fades out exactly as the pad
     does and a station's edge is still a single continuous
     surface. Adding it outside would have put full-amplitude
     cusps on the ground beyond the feather.
     ------------------------------------------------------------ */
  /* Scale per station, and it is about what the ground IS. Sand
     gets cusps; a scoria crater floor and a wet basalt bench do
     not, so they keep about half of it and read as the swash
     noise alone. Absent means 1. */
  const PAD_RELIEF = Object.freeze({
    landing: 1.00,   // the arrival beach, and the frame that named this
    prow: 0.60,      // reef-flat pavement, scoured
    nave: 0.70,
    bone: 0.75,
    drive: 0.70,
    roost: 0.85,
    weeping: 0.40,   // wet basalt terrace - cut, not deposited
    cauldron: 0.45,  // scoria crater floor
  });
  const PAD_CUSP_K = 0.2094;      // 2*PI / 30m
  const PAD_CUSP_A = 0.130;
  const PAD_BERM_A1 = 0.115;
  const PAD_BERM_A2 = 0.085;
  const PAD_SWASH_A = 0.055;
  const PAD_SWASH_F = 0.0705;     // 2*PI / 14m, in noise-space units

  /** Metres of relief to add to a pad's authored floor at the
   *  pad-local coordinates (u along the long axis, v across it).
   *  Zero-mean across the strip by construction. */
  function padReliefAt(e, u, v, x, z) {
    const amp = e.relief;
    if (amp <= 0) return 0;
    const t = clamp(v / Math.max(e.s.padC, 1), -1, 1);
    return amp * (
      Math.sin(u * PAD_CUSP_K + e.phase) * PAD_CUSP_A
      + Math.cos(Math.PI * t) * PAD_BERM_A1
      + Math.sin(Math.PI * t) * PAD_BERM_A2
      + nDetail.fbm(x * PAD_SWASH_F + 71, z * PAD_SWASH_F - 29, 2) * PAD_SWASH_A
    );
  }

  const PAD_LIST = STATION_ORDER
    .map((id) => ({ id, s: STATIONS[id] }))
    .filter((e) => e.s.padA > 0)
    .map((e) => {
      /* The pad's local frame: `u` runs along the shore (tangential
         to the ring at the station's own bearing), `v` across it.
         Resolved once at build; a per-sample atan2 here would cost
         1.4M trig calls. */
      /* `u` runs along the pad's long axis and `v` across it. By
         default the long axis is the shore - tangential to the ring
         at the station's own bearing - which is right for the seven
         pads that ARE shore. `padAxis` overrides it with an
         explicit compass bearing, and exactly one station needs
         that: the Weeping Steps' terrace is cut along the
         CAULDRON's contour, which is 53 degrees off the ring's, and
         a bench whose short axis is not the fall line is not a
         bench, it is a wedge. */
      const len = Math.hypot(e.s.x, e.s.z) || 1;
      let rx = e.s.x / len;
      let rz = e.s.z / len;
      if (e.s.padAxis !== undefined) {
        /* padAxis names the LONG axis, so the radial-equivalent
           frame is that bearing turned ninety degrees. */
        const ax = (e.s.padAxis + 90) * DEG;
        rx = Math.sin(ax);
        rz = -Math.cos(ax);
      }
      /* The feather in NORMALISED elliptical units, resolved once.
         Two stations override the 30m default in opposite
         directions - the Weeping Steps needs 92 because it is the
         only pad on shield-grade ground, the Cauldron needs 10
         because its pad sits inside a crater rim - and both numbers
         are argued at their station entries. */
      const feather = e.s.padFeather ?? PAD_FEATHER;
      /* One phase per station, hashed off its index, so no two
         pads carry the same cusp pattern - eight identical beaches
         is the sticker-prop tell applied to the ground. */
      const phase = hash2(STATION_ORDER.indexOf(e.id) + 41, 17) * TAU;
      return {
        ...e, ux: -rz, uz: rx, vx: rx, vz: rz, feather, phase,
        relief: PAD_RELIEF[e.id] ?? 1,
      };
    });

  function padsAt(x, z, y0) {
    let y = y0;
    for (const e of PAD_LIST) {
      const s = e.s;
      const dx = x - s.x;
      const dz = z - s.z;
      /* Cheap reject on the bounding circle before the projection. */
      /* Cheap reject on the bounding circle before the projection:
         the pad's own long half-length plus its feather, so a
         sample anywhere else on the map costs one squared distance
         and a compare. That guard is the measured reason nine of
         these are affordable at 1.4M evaluations. */
      const big = s.padA + e.feather;
      if (dx * dx + dz * dz > big * big) continue;
      const u = dx * e.ux + dz * e.uz;
      const v = dx * e.vx + dz * e.vz;
      /* Normalised elliptical distance, then ONE feather in that
         normalised space - so the feather is proportionally wider
         across the strip than along it, which is what keeps a
         narrow pad from having a razor edge on its long sides. */
      /* SEPARABLE, AND THE FEATHER IS IN METRES ON EACH AXIS.
         Two earlier versions failed here and both failures were
         about what "the feather" is measured in.

         The first ran `sstep(1, 1 + F/min(a,c), e)` in NORMALISED
         space, so shrinking `padC` to keep a shore pad off the reef
         crest widened the feather in metres along that very axis:
         the Bone Reef's radial half-width went 54 -> 38 and its
         feather went 30 -> 47, and the pad reached FURTHER out than
         before. The probe caught it as a crest reading -0.01 where
         +0.62 is authored.

         The second converted the normalised excess back to metres
         with the ellipse's own gradient. Exact on either axis, and
         badly wrong at the corners of a 5:1 pad: near the long
         axis the gradient is dominated by the SHORT axis's term, so
         a point 55m beyond the Weeping Steps' end read as 28m
         outside and got 40% of the pad's weight. It lifted the
         plug's toe from +5 to +36 and put a grade of 27.9 in it.

         So: one sstep per axis, multiplied. Exact everywhere, one
         fewer hypot and no divide, and the shape becomes a rounded
         rectangle rather than an ellipse - which is the better
         arena anyway. A strip has two ENDS, and two ends is two
         approaches. */
      const k = (1 - sstep(s.padA, s.padA + e.feather, Math.abs(u)))
        * (1 - sstep(s.padC, s.padC + e.feather, Math.abs(v)));
      if (k <= 0.001) continue;
      y = lerp(y, s.padY + padReliefAt(e, u, v, x, z), k);
    }
    return y;
  }

  /* ------------------------------------------------------------
     NORMALS. Four full height evaluations per call, and that cost
     buys the property the whole LOD scheme depends on: two LODs of
     the same ground light identically, so an LOD swap does not
     flash. A mesh-derived normal flashes at every range boundary,
     which is fatal on a level whose texture story is grazing light
     on water and wet sand.
     ------------------------------------------------------------ */
  const NEPS = 1.6;
  function normalAt(x, z, out) {
    const nx = heightAt(x - NEPS, z) - heightAt(x + NEPS, z);
    const nz = heightAt(x, z - NEPS) - heightAt(x, z + NEPS);
    const ny = 2 * NEPS;
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    const o = out || [0, 0, 0];
    o[0] = nx * inv;
    o[1] = ny * inv;
    o[2] = nz * inv;
    return o;
  }

  function curvatureAt(x, z) {
    const e = 3.2;
    const c = heightAt(x, z);
    const s = heightAt(x + e, z) + heightAt(x - e, z)
      + heightAt(x, z + e) + heightAt(x, z - e);
    /* Positive = concave, matching both other worlds. */
    return (s - 4 * c) / (e * e) * 8;
  }

  /* ------------------------------------------------------------
     THE ONE READER OF DEPTH.

     Every module that asks "is this underwater and by how much"
     asks this. Clamped at zero so it is safe to divide by and safe
     to feed a smoothstep, and it is the raw still-water depth: the
     swell's displacement is the WATER's business, not the
     ground's, and mixing them here would make the foam line
     breathe with the waves in a way that a baked texture cannot
     reproduce.
     ------------------------------------------------------------ */
  function waterDepthAt(x, z) {
    return Math.max(0, SEA_Y - heightAt(x, z));
  }

  /**
   * Which tide band a point is in.
   *   0 subtidal      - always under water
   *   1 low intertidal - exposed only at spring low
   *   2 high intertidal- the wet band, exposed twice a day
   *   3 splash        - salt bloom, no crust, wetted by spray
   *   4 supralittoral - dry land
   * This is the readability spine of the whole shoreline and of the
   * ship's waterline. It is a function of height alone, deliberately:
   * a band that also depended on exposure or aspect would not draw a
   * level line around a hull, and a level line is the entire point.
   */
  function tideBandAt(x, z) {
    const y = heightAt(x, z);
    if (y < TIDE.low) return 0;
    if (y < 0) return 1;
    if (y < TIDE.crustTop) return 2;
    if (y < TIDE.splashTop) return 3;
    return 4;
  }

  /* ------------------------------------------------------------
     SURFACE CLASSIFICATION, BY PHYSICS

     Read elevation relative to SEA_Y, slope, aspect-to-trade-wind
     and curvature. The station table only NAMES the ground.

     `sand` is the RESIDUAL and is not in SURFACE_KEYS: the seven
     others are taken first and sand is whatever is left, which is
     what makes an unclassified sample land on a beach rather than
     on nothing.

     ZONE COVER. A constant weight over a 250m disc is a paint
     bucket, not geology - it is what put scree 0.68 on Kenosis's
     dead-flat arrival plaza and cost four blind rounds. Every
     weight here is multiplied by a `scour * patch` break before it
     lands, except the two that are genuinely continuous sheets
     (reef and bone: a reef flat has no holes in it).
     ------------------------------------------------------------ */
  const SURFACE_KEYS = ATOLL_SURFACE_KEYS;

  function surfaceAt(x, z, slopeHint, curvHint) {
    const out = {
      sand: 1, wetSand: 0, blackSand: 0, reef: 0, bone: 0,
      basalt: 0, ash: 0, loam: 0, mud: 0,
      district: null, districtWeight: 0,
    };

    const y = heightAt(x, z);
    const r = Math.hypot(x, z);
    const ny = slopeHint ? slopeHint[1] : normalAt(x, z)[1];
    const slopeDeg = Math.acos(clamp(ny, -1, 1)) / DEG;
    const curv = curvHint === undefined ? curvatureAt(x, z) : curvHint;

    /* --- the naming field, and it is INDEPENDENT of the material
       field. Sharing one radius is what put Vesper's vitrified teal
       on 336m of open dune. */
    let bestW = 0;
    for (const id of STATION_ORDER) {
      const s = STATIONS[id];
      const d = Math.hypot(x - s.x, z - s.z);
      const w = 1 - sstep(s.r * 0.55, s.r * 1.05, d);
      if (w > bestW) { bestW = w; out.district = id; }
    }
    out.districtWeight = bestW;

    /* --- the break. `scour` reaches 1 on convex, tilted, windward
       ground and keeps a 0.30 floor; `patch` breaks at two scales
       so a zone edge is a coastline rather than a compass arc. */
    const inv = 1 / Math.max(r, 1e-3);
    const upwind = clamp01(-((x * inv) * windX + (z * inv) * windZ) * 0.5 + 0.5);
    const scour = 0.30 + 0.70 * clamp01(
      (clamp01(slopeDeg / 26) * 0.45) + (clamp01(-curv * 0.4) * 0.30) + upwind * 0.25
    );
    const patch = clamp01(
      0.5 + nDetail.fbm(x * 0.0125 + 61, z * 0.0125 - 23, 2) * 1.6
    ) * clamp01(
      0.55 + nDetail.fbm(x * 0.052 - 8, z * 0.052 + 44, 2) * 1.3
    );
    const brk = clamp01(scour * (0.45 + 0.55 * patch));

    /* --- the tide, which does most of the work on this level ---- */
    const band = y < TIDE.low ? 0 : (y < 0 ? 1 : (y < TIDE.crustTop ? 2 : (y < TIDE.splashTop ? 3 : 4)));

    /* WET SAND: the intertidal band on anything shallow enough to
       be sand. This is the single most important classification on
       the level - it is the tide line, and the tide line is what
       makes the shore legible. */
    if (band >= 1 && band <= 3 && slopeDeg < 22) {
      out.wetSand = clamp01((1 - sstep(TIDE.crustTop, TIDE.splashTop, y))
        * (1 - sstep(-1.6, TIDE.low, y) * 0.0)) * clamp01(1 - sstep(14, 24, slopeDeg));
    }

    /* REEF: living coral. Subtidal, out on the reef flat and on the
       lagoon's bommies, and NOT on the windward crest where the
       surf scours it to rubble. Continuous - no break applied. */
    if (y < 0.1) {
      const flat = (1 - sstep(880, 940, r)) * 0 + sstep(930, 968, r) * (1 - sstep(1000, 1046, r));
      /* REEF FOLLOWS THE HEADS. This used to be
         `clamp01((y + 5.4) / 4.2)` - a contour line of the seabed,
         which paints coral on every square metre that happens to
         lie between -5.4 and -1.2 m whether there is a coral head
         there or not. With a 116 m soft mound field under it that
         produced round 1's leopard blotches directly: the colour
         was a level set of a smooth function.

         Asking `bommieAt` instead costs one more evaluation per
         mesh vertex and buys the property that coral is exactly
         where coral IS. 0.55 m of relief is where a head starts
         being a head; 2.6 m is where it is fully coral, which
         leaves a rubble skirt round the base of every one. */
      /* `sstep`, NOT `smoothstep`. core.js's `smoothstep` takes
         ONE argument; `sstep(e0, e1, x)` is the edged form. The
         round 1 code this replaces called
         `smoothstep(0.34, 0.72, bom)` and JavaScript silently
         dropped the last two arguments, so the "bommie field" was
         `smoothstep(0.34)` - a CONSTANT 0.268, squared and scaled
         to a flat 0.45 m rise over the entire lagoon. There were
         no coral heads at all. Measured on the round 1 field: the
         floor's relief above its own smooth landform ran p50 0.43,
         max 0.67 - a plateau, not a bommie field - which is why
         nothing in the frame cast a shadow and why the leopard
         pattern could not be the geometry. */
      const bommie = sstep(0.55, 2.6, bommieAt(x, z))
        * sstep(BOMMIE.inner, BOMMIE.inner + BOMMIE.innerFade, r);
      out.reef = clamp01(Math.max(flat, bommie) * (1 - sstep(-0.05, 0.55, y)));
      out.reef *= 1 - upwind * 0.45;
    }

    /* BONE: bleached rubble. The crest itself and the rampart
       behind it, where the surf breaks - windward, convex, and
       above the low-tide line. The level's brightest surface, and
       it is deliberately small in area. */
    if (r > 950 && y > -1.4) {
      const crest = 1 - Math.abs(r - 1002) / 62;
      if (crest > 0) out.bone = clamp01(crest * (0.30 + 0.70 * upwind) * clamp01((y + 1.4) / 1.6));
    }

    /* BLACK SAND: volcanic, so it is on the Cauldron's skirt and on
       everything downslope of it - which is the south-west quadrant
       and, because longshore drift runs downwind, the SOUTH shore
       as far as the Landing. That is why the Landing's sand is
       black and the Bone Reef's is not, and it is not a decoration:
       it is the same reason the real thing happens. */
    {
      const dc = Math.hypot(x - CAULDRON.x, z - CAULDRON.z);
      const near = 1 - sstep(CAULDRON.baseR * 0.8, CAULDRON.baseR * 2.6, dc);
      /* the drift tail, downwind along the shore */
      const drift = clamp01((x * windX + z * windZ) * inv * 0.5 + 0.5);
      out.blackSand = clamp01(near * (0.45 + 0.55 * drift) * brk) * clamp01(1 - sstep(9.5, 16, y));
    }

    /* BASALT: exposed rock. Steep ground anywhere, plus the
       Cauldron's rim and the Weeping Steps' terraces. */
    out.basalt = clamp01(sstep(24, 42, slopeDeg) * (0.55 + 0.45 * brk));

    /* ASH and scoria: the Cauldron above the tree line, which on
       this level is 110m. */
    {
      const dc = Math.hypot(x - CAULDRON.x, z - CAULDRON.z);
      if (y > 96 && dc < CAULDRON.baseR) {
        out.ash = clamp01(sstep(96, 132, y) * (0.6 + 0.4 * brk));
      }
    }

    /* LOAM: jungle floor. Above the splash zone, under the tree
       line, not too steep, and preferentially in the lee and in
       hollows - which is where soil actually stays. */
    if (y > TIDE.splashTop && y < 118 && slopeDeg < 34) {
      out.loam = clamp01(
        sstep(TIDE.splashTop, 5.0, y)
        * (1 - sstep(96, 124, y))
        * (1 - sstep(24, 34, slopeDeg))
        * (0.40 + 0.60 * (1 - upwind))
        * (0.55 + 0.45 * clamp01(curv * 0.5 + 0.5))
        * (0.5 + 0.5 * brk)
      );
    }

    /* MUD: the mangrove. Tidal, sheltered, flat, and only in the
       Drowned Nave's basin - this is the one class the station
       table is allowed to gate, because a mangrove is a place
       rather than a physical regime. */
    {
      /* READ THE ELLIPSE, NOT `padR`, AND THE MANGROVE HAD NO MUD
         FOR TEN ROUNDS BECAUSE OF IT.

         The stations carried a circular `padR` until the pads became
         ellipses (`padA` along the shore, `padC` across it) to stop
         a 96m disc flattening a 176m-wide island. This gate was not
         updated with them, so it read `s.padR` - undefined - and
         `undefined * 0.55` is NaN. `sstep(NaN, NaN, d)` is NaN,
         `1 - NaN` is NaN, and `NaN > 0.001` is FALSE. The block
         never fired once. `out.mud` has been 0 everywhere in the
         level since the pads changed shape.

         It failed silently in the worst possible way: no error, no
         NaN reaching a uniform, no gate tripped - the residual `sand`
         simply absorbed the weight the mangrove should have taken,
         and the Drowned Nave has been a sand flat with trees on it.
         A blind judge found it from the outside, describing that
         arena's ground as "pale sand meets dark mud" with the mud
         coming from the WATER rather than from the ground.

         Now the same normalised elliptical distance `padsAt` uses,
         built from the same local frame, so the two cannot drift
         apart again. */
      const s = STATIONS.nave;
      const dx = x - s.x;
      const dz = z - s.z;
      const len = Math.hypot(s.x, s.z) || 1;
      const rx = s.x / len;
      const rz = s.z / len;
      const u = dx * -rz + dz * rx;
      const v = dx * rx + dz * rz;
      const d = Math.hypot(u / Math.max(s.padA, 1), v / Math.max(s.padC, 1));
      const k = 1 - sstep(0.55, 1.35, d);
      if (k > 0.001 && y < TIDE.splashTop && slopeDeg < 12) {
        out.mud = clamp01(k * (1 - sstep(TIDE.crustTop, TIDE.splashTop, y)));
      }
    }

    /* --- the residual --------------------------------------- */
    let taken = 0;
    for (const key of SURFACE_KEYS) {
      out[key] = clamp01(out[key]);
      taken += out[key];
    }
    out.sand = clamp01(1 - clamp01(taken));
    return out;
  }

  /* ------------------------------------------------------------
     THE CIRCUIT

     The Via Sacra's equivalent, and it is deliberately NOT a road.
     Nobody built anything here; the route is the beach, the reef
     flat at low tide, and the game trails the jungle allows. So it
     is a spline that the terrain is nudged toward rather than a
     bed cut into it - the audit checks its grade, not its
     flatness.

     Control points are on the ring at the bearing of each station,
     at the berm's own radius, so the circuit IS the beach line.
     ------------------------------------------------------------ */
  const CIRCUIT_STATIONS = ["landing", "prow", "nave", "bone", "drive", "roost", "cauldron"];

  const circuitProfile = (() => {
    const pts = [];
    const N = 384;
    for (let i = 0; i < N; i += 1) {
      const a = (i / N) * TAU;
      const dR = readBand(ringR, a);
      /* THE CIRCUIT FOLLOWS THE BERM THE PROFILE ACTUALLY HAS, not
         a fixed radius. Profile-radius 762 is six metres inboard of
         the berm crest at 756, which puts the walk on the BACK of
         the berm - dry, level, the sea on one side and the jungle
         on the other. Adding dR converts it to a world radius, so
         the route rides the ring's wander instead of cutting across
         it.

         A fixed world radius was tried first and it walked into the
         Cauldron's flank: the grade came back at 1.39 against a
         walk limit of 1.7 for a route that is supposed to be a
         beach. The plug moved inboard (see CAULDRON) and the
         circuit became bearing-relative; both were needed. */
      const r = 762 + dR;
      const x = r * Math.sin(a);
      const z = -r * Math.cos(a);
      pts.push({ x, z, y: 0 });
    }
    return pts;
  })();

  /* Heights are resolved after the array exists, because heightAt
     reads the pads which read the stations - a chicken-and-egg the
     other two worlds solve the same way. */
  function resolveCircuitHeights() {
    for (const p of circuitProfile) p.y = heightAt(p.x, p.z);
  }

  const circuitArc = (() => {
    const arc = [0];
    for (let i = 1; i < circuitProfile.length; i += 1) {
      const a = circuitProfile[i - 1];
      const b = circuitProfile[i];
      arc.push(arc[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    return arc;
  })();

  const circuitLength = circuitArc[circuitArc.length - 1];

  function circuitPointAt(t) {
    const n = circuitProfile.length;
    const u = ((t % 1) + 1) % 1 * n;
    const i = u | 0;
    const f = u - i;
    const a = circuitProfile[i];
    const b = circuitProfile[(i + 1) % n];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const inv = 1 / (Math.hypot(tx, tz) || 1);
    return {
      x: lerp(a.x, b.x, f),
      z: lerp(a.z, b.z, f),
      y: lerp(a.y, b.y, f),
      tangent: [tx * inv, tz * inv],
    };
  }

  /**
   * Grade of an open or closed polyline of `{x, z, y}`, resampled
   * to `samples` segments. ONE implementation, three callers - the
   * ring circuit, the Cauldron road and the audit - because two
   * derivations of "how steep is this route" would disagree within
   * a week and the disagreement would surface as a gate that passes
   * while the player cannot walk the route, which names nothing.
   *
   * The histogram is 26 whole-percent buckets with index 25 as a
   * catch-all, matching both other worlds so one probe reads all
   * three.
   */
  function polylineGrade(pts, samples, closed) {
    let max = 0;
    let sum = 0;
    let n = 0;
    let worstAt = 0;
    const hist = new Array(26).fill(0);
    const last = closed ? pts.length : pts.length - 1;
    /* Arc-length resampling would need a second array; the profiles
       here are already at a uniform 6m spacing, so stepping the
       nodes directly IS uniform sampling and costs nothing. */
    const stride = Math.max(1, Math.floor(last / Math.max(1, samples)));
    for (let i = 0; i < last; i += stride) {
      const a = pts[i];
      const b = pts[(i + stride) % pts.length];
      if (!closed && i + stride >= pts.length) break;
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (run < 1e-4) continue;
      const g = Math.abs(b.y - a.y) / run;
      if (g > max) { max = g; worstAt = i / last; }
      sum += g;
      n += 1;
      hist[Math.min(25, Math.floor(g * 100))] += 1;
    }
    return { max, mean: n ? sum / n : 0, samples: n, worstAt, histogram: hist };
  }

  function circuitGrade(samples = 600) {
    let max = 0;
    let sum = 0;
    let n = 0;
    let worstAt = 0;
    const hist = new Array(26).fill(0);
    for (let i = 0; i < samples; i += 1) {
      const t0 = i / samples;
      const t1 = (i + 1) / samples;
      const a = circuitPointAt(t0);
      const b = circuitPointAt(t1);
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (run < 1e-4) continue;
      const g = Math.abs(b.y - a.y) / run;
      if (g > max) { max = g; worstAt = t0; }
      sum += g;
      n += 1;
      hist[Math.min(25, Math.floor(g * 100))] += 1;
    }
    return { max, mean: n ? sum / n : 0, samples: n, worstAt, histogram: hist };
  }

  /** The signature climb, measured on the BUILT bed rather than on
   *  the design curve - the bed is what the player stands on and it
   *  has been through a smoother and a limiter since the march. */
  function cauldronRoadGrade(samples = 600) {
    return polylineGrade(cauldronRoadProfile, samples, false);
  }

  /* Landform without relief, pads or cuts: what a route solver and
     the sky's shoreline read, because a shoreline that followed
     every gully and every levelled arena would be a worse
     shoreline than one that ignores them. Real ones do not do it
     either - summit-sky.js:494. */
  function circuitLandform(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(x, -z);
    const aa = a < 0 ? a + TAU : a;
    const dR = readBand(ringR, aa);
    let y = atollProfile(r - dR);
    if (y > 0) y *= ringHeightAt(aa, r - dR);
    return cauldronAt(x, z, y);
  }

  /** Bisection against the smooth profile, for the water's visual
   *  shoreline and the sky's haze band. The profile is not monotonic
   *  in r on this world - it rises to the berm and falls to the reef
   *  - so the search is bracketed to the OUTER limb only. */
  function shoreRadiusFor(y, bearing = 0) {
    const dR = readBand(ringR, bearing);
    let lo = 786;
    let hi = 1006;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) * 0.5;
      if (atollProfile(mid - dR) > y) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /* ------------------------------------------------------------
     SHELVES

     `spurs` here is a one-entry list and that is not a shortcut -
     Kenosis needs a buttress shelf under all nine stations because
     all nine sit on 35-degree ground; six of these nine sit on
     ground the radial profile already made flat to under 2%, and a
     shelf on flat ground is a poker chip. The Weeping Steps is the
     only pad on shield-grade ground and therefore the only one that
     gets a terrace under it before its disc is applied.

     `shelfWeight` keeps the summit signature verbatim -
     (x, z, r, a, record) with r and a PRECOMPUTED BY THE CALLER, so
     the inner loop does not recompute a hypot and an atan2 once per
     record.
     ------------------------------------------------------------ */
  const SHELF_BLEND_GRADE = 1.0;    // inward, uphill - 45 degrees
  const SHELF_FACE_GRADE = 1.9;     // outward, downhill - 62 degrees

  const spurs = ["weeping"].map((id, i) => {
    const s = STATIONS[id];
    const rs = Math.hypot(s.x, s.z);
    const th = Math.atan2(s.x, -s.z);
    const padR = Math.max(s.padA, s.padC);
    const hold = padR + 46;
    /* DERIVED FADES, both of them. A fixed inward fade EXCAVATES:
       inward is uphill, so the ground is climbing toward the
       shelf's own elevation as the shelf fades out and the two meet
       on their own - a fade that overshoots that meeting point does
       not blend, it digs. Kenosis dug a 55m ditch a third of the
       way round its peak that way. The outward fade is derived
       against the face grade for the same reason its own table was
       thrown away: a hand-picked number has no relation to the lift
       below it, and the measured result was an 88.8-degree face. */
    const up = Math.abs(cauldronLandform(
      s.x - (s.x / rs) * hold, s.z - (s.z / rs) * hold
    ) - s.padY);
    const down = Math.abs(cauldronLandform(
      s.x + (s.x / rs) * hold, s.z + (s.z / rs) * hold
    ) - s.padY);
    return {
      id,
      i,
      rs,
      th,
      padY: s.padY,
      padR,
      hold,
      coreAng: Math.atan2(padR * 1.12, rs),
      featherAng: 0.30,
      fadeIn: clamp(1.5 * up / SHELF_BLEND_GRADE, 60, 320),
      fadeOut: clamp(1.5 * down / SHELF_FACE_GRADE, 90, 380),
    };
  });

  function shelfWeight(x, z, r, a, s) {
    const dr = r - s.rs;
    const fade = dr >= 0 ? s.fadeOut : s.fadeIn;
    const radW = 1 - sstep(s.hold, s.hold + fade, Math.abs(dr));
    if (radW <= 0.001) return 0;
    const angW = 1 - sstep(s.coreAng, s.coreAng + s.featherAng,
      Math.abs(angleDelta(a, s.th)));
    return radW * angW;
  }

  /* ------------------------------------------------------------
     THE ROUTE ERROR

     For each station, the largest disagreement between its authored
     padY and the nearest route that is supposed to serve it. It is
     MEASURED at load and reported, not asserted - it is the number
     that says whether a station's approach works, and a number that
     throws tells you less than a number you can watch move.
     ------------------------------------------------------------ */
  const padRouteError = (() => {
    const out = {};
    const routes = [circuitProfile, cauldronRoadProfile];
    for (const id of STATION_ORDER) {
      const s = STATIONS[id];
      if (!(s.padA > 0)) { out[id] = 0; continue; }
      const reach = Math.max(s.padA, s.padC);
      let worst = Infinity;
      for (const route of routes) {
        for (let i = 0; i < route.length; i += 1) {
          const p = route[i];
          if (Math.hypot(p.x - s.x, p.z - s.z) > reach + 60) continue;
          const e = Math.abs(p.y - s.padY);
          if (e < worst) worst = e;
        }
      }
      out[id] = Number.isFinite(worst) ? worst : Infinity;
    }
    return out;
  })();

  resolveCircuitHeights();

  const circuitIndex = indexProfiles([circuitProfile], 48);
  const spurIndex = cauldronRoadIndex;

  return {
    heightAt,
    normalAt,
    surfaceAt,
    curvatureAt,
    waterDepthAt,
    tideBandAt,
    profile: atollProfile,
    profileSlope: atollProfileSlope,
    circuitLandform,
    circuitProfile,
    circuitPointAt,
    circuitGrade,
    circuitLength,
    circuitIndex,
    spurIndex,
    spurProfiles: [cauldronRoadProfile],
    spurs,
    shelfWeight,
    padRouteError,
    polylineGrade,
    cauldronRoad: cauldronRoadProfile,
    cauldronRoadGrade,
    cauldronLandform,
    shoreRadiusFor,
    stations: STATIONS,
    cauldron: CAULDRON,
    pass: PASS,
    wind: WIND,
    bands: { ringR, ringH, ringW },
    noise: { reef: nReef, ridge: nRidge, warp: nWarp, detail: nDetail, gully: nGully },
    SURFACE_KEYS,
  };
}

export const CIRCUIT_STATIONS = Object.freeze([
  "landing", "prow", "nave", "bone", "drive", "roost", "cauldron",
]);

/* ============================================================
   THE MODULE-LEVEL CIRCUIT

   `atollProfile` and the ring circuit must be readable WITHOUT a
   field, because the sky builder runs before the terrain and needs
   the shoreline, and the HUD's map needs the route.
   summit-sky.js kept its own copy of the profile table instead and
   records what that cost: "it drifted within one working session
   [...] every shoreline moved by 60 to 200 metres [...] the symptom
   was not an error anywhere; it was a sea lying in the wrong place
   with every check still green."

   So the geometry - which is a function of the ring bake alone - is
   module level, and the ELEVATIONS come from a lazily built default
   field. One derivation, and the lazy field is built at most once
   per page.
   ============================================================ */

const CIRCUIT_NODES = 384;
const CIRCUIT_R = 762;      // profile radius; the berm's own back

const CIRCUIT_RING = (() => {
  const ringR = bakeHarmonics(RING_R_HARMONICS, 0, 1);
  const pts = [];
  for (let i = 0; i < CIRCUIT_NODES; i += 1) {
    const a = (i / CIRCUIT_NODES) * TAU;
    const r = CIRCUIT_R + readBand(ringR, a);
    pts.push([r * Math.sin(a), -r * Math.cos(a)]);
  }
  return pts;
})();

export const CIRCUIT_PATH = Object.freeze(CIRCUIT_RING.map((p) => Object.freeze(p)));

export const CIRCUIT_LENGTH = (() => {
  let total = 0;
  for (let i = 0; i < CIRCUIT_PATH.length; i += 1) {
    const a = CIRCUIT_PATH[i];
    const b = CIRCUIT_PATH[(i + 1) % CIRCUIT_PATH.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
})();

/** The spurs off the ring circuit. One, and it is the climb. */
export const CIRCUIT_SPURS = Object.freeze([
  Object.freeze({ id: "cauldron", from: "weeping", to: "cauldron" }),
]);

let defaultField = null;
function sharedField() {
  if (!defaultField) defaultField = makeAtollField();
  return defaultField;
}

/**
 * A point on the ring circuit at fractional position `t`.
 * CLOSED, so `t` wraps; the ring has no ends.
 */
export function circuitPointAt(t) {
  return sharedField().circuitPointAt(t);
}

/* ============================================================
   VERTEX COLOUR - THE RAMP TABLE

   One ramp per surface key plus the residual, and a per-key
   `[scale, offset]` saying where that surface sits in its own ramp
   relative to the shared tonal position.

   Dry sand gets the full range: it is most of the emergent level
   and a compressed range bands visibly across a 300m beach. Bone
   gets almost none - dead reef pavement is uniformly bright, its
   shape is carried by the tide pools, which are geometry, and it
   is the ONE surface here allowed above sRGB 0.90. Reef gets a
   lifted floor because it is always seen through four to eight
   metres of water and the water is doing the darkening; painting
   it dark as well double-counts and the lagoon floor goes to mud.
   ============================================================ */

const RAMPS = {
  sand: SAND_RAMP,
  wetSand: WETSAND_RAMP,
  blackSand: BLACKSAND_RAMP,
  reef: CORAL_RAMP,
  bone: BONE_RAMP,
  basalt: BASALT_RAMP,
  ash: ASH_RAMP,
  loam: LOAM_RAMP,
  mud: MANGROVE_RAMP,
};

const RAMP_BIAS = Object.freeze({
  sand: [1.00, 0.00],
  wetSand: [0.86, 0.05],
  blackSand: [0.94, 0.02],
  reef: [0.70, 0.22],
  bone: [0.58, 0.36],
  basalt: [0.90, 0.06],
  ash: [0.92, 0.04],
  loam: [0.96, 0.00],
  mud: [0.80, 0.08],
});

/* How far apart curvature is sampled, in metres, and the factor
   that brings a raw Laplacian into O(1). Same reasoning as both
   other worlds: curvature at the normal's 1.6m measures the detail
   octave, which is dither. The question surfaceAt is asking - is
   this a place sediment collects or a place the sea strips - is
   about features 30 to 160m across. */
const CURV_EPS = 14;
const CURV_SCALE = 25;

/* ============================================================
   THE MESH

   BUDGET, MEASURED (state it here and in the report):
     vertices    395,520 across 256 meshes (64 chunks x 4 LODs),
                 identical to Kenosis because the scaffold is
                 identical - 4485 + 1221 + 357 + 117 per chunk.
     triangles   9,216 per LOD0 chunk including both windings of
                 the skirt; a typical beach frame holds 4 chunks at
                 LOD0, 8 at LOD1 and the rest coarser, about
                 62k triangles, plus the apron's 7,680.
     draw calls  65 - ONE material for all 256 chunk meshes plus
                 ONE for the apron. Only the active LOD of each
                 chunk is visible, so 64 chunk draws at most.
     fill        the terrain is the cheapest thing in the frame:
                 opaque, no alpha test, one material, and every
                 surface distinction is vertex colour. The
                 expensive pixels on this level are the water and
                 the canopy, and this file exists partly to leave
                 them room.
     build       coarse pass 257^2 = 66,049 evaluations; mesh pass
                 64 x 65^2 x 5 = 1,352,000 (one heightAt plus four
                 inside normalAt per vertex) plus one surfaceAt.
                 The seabed bake adds NONE - see below.
   ============================================================ */

export async function buildAtollTerrain(ctx, onProgress) {
  const { THREE, scene, materials } = ctx;
  const field = ctx.field || makeAtollField(ctx.seed);
  const rng = makeRng((ctx.seed ^ 0x0a71) >>> 0);

  const group = new THREE.Group();
  group.name = "terrain";
  scene.add(group);

  /* ONE MATERIAL FOR ALL 256 MESHES. Every surface distinction on
     the ground - beach, wet sand, black sand, reef, pavement,
     basalt, ash, jungle floor, mangrove mud - is carried by vertex
     colour and by the ripple relief inside atoll-art's `sand`
     extension. A second terrain material would double the draw
     calls and buy a discontinuity at the chunk seam where the two
     met, which on a shoreline is the one place it would show. */
  const material = materials.sand;

  /* ---------------------- coarse height grid ---------------------- */

  const COARSE = 8;
  const cDim = MAP_SIZE / COARSE + 1;          // 257
  const coarse = new Float32Array(cDim * cDim);
  for (let j = 0; j < cDim; j += 1) {
    const z = -MAP_HALF + j * COARSE;
    for (let i = 0; i < cDim; i += 1) {
      coarse[j * cDim + i] = field.heightAt(-MAP_HALF + i * COARSE, z);
    }
    if (onProgress && (j & 63) === 0) {
      onProgress(0.02 + 0.10 * (j / cDim));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  function coarseHeight(x, z) {
    const fx = clamp((x + MAP_HALF) / COARSE, 0, cDim - 1.001);
    const fz = clamp((z + MAP_HALF) / COARSE, 0, cDim - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const a = coarse[j * cDim + i];
    const b = coarse[j * cDim + i + 1];
    const c = coarse[(j + 1) * cDim + i];
    const d = coarse[(j + 1) * cDim + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /** The curvature hint every chunk sample passes into `surfaceAt`.
   *  Same 14m stencil as the analytic version, read off the coarse
   *  grid: five bilinear lookups instead of five full height
   *  evaluations, which across 270k samples is 1.35M height
   *  evaluations that do not happen. */
  function coarseCurvature(x, z) {
    const e = CURV_EPS;
    const c = coarseHeight(x, z);
    const sum = coarseHeight(x + e, z) + coarseHeight(x - e, z)
      + coarseHeight(x, z + e) + coarseHeight(x, z - e);
    return ((sum - 4 * c) / (e * e)) * CURV_SCALE;
  }

  /* ---- baked occlusion ----

     Kenosis's LOCAL-PLANE version, not Vesper's, and on this level
     that is not optional either. Vesper measures occlusion as "how
     much of the ground on four rings stands above me", which is
     occlusion on a basin and is THE MOUNTAIN on a cone: at any
     point on the plug's 1.63 flank every sample on the uphill half
     of every ring is above the sample point by definition, so the
     whole uphill side bakes out dark and the term stops describing
     concavity at all.

     So the comparison is against the LOCAL PLANE. A uniform slope
     then contributes exactly zero and only genuine pits - tide
     pools, the crater, gully floors, the inside corners of the
     reef's grooves and the shadow under the ship's scar - darken.

     Radii are deliberately SHORT. Vesper tried a 190m ring and it
     painted a hundred-metre soft blob that read as an enormous
     unexplained shadow. */
  const aoDirs = [];
  for (const [radius, count] of [[4, 6], [11, 6], [26, 8], [54, 8]]) {
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + radius * 0.37;
      aoDirs.push([Math.cos(a) * radius, Math.sin(a) * radius, radius]);
    }
  }
  const aoNorm = aoDirs.reduce((s, d) => s + 1 / (1 + d[2] * 0.10), 0) * 0.34;

  function occlusionAt(x, z, y, normal) {
    let gx;
    let gz;
    if (normal && Math.abs(normal[1]) > 1e-4) {
      gx = -normal[0] / normal[1];
      gz = -normal[2] / normal[1];
    } else {
      const e = 8;
      gx = (coarseHeight(x + e, z) - coarseHeight(x - e, z)) / (2 * e);
      gz = (coarseHeight(x, z + e) - coarseHeight(x, z - e)) / (2 * e);
    }
    let occ = 0;
    for (let i = 0; i < aoDirs.length; i += 1) {
      const d = aoDirs[i];
      const plane = y + gx * d[0] + gz * d[1];
      occ += clamp01((coarseHeight(x + d[0], z + d[1]) - plane) / d[2])
        * (1 / (1 + d[2] * 0.10));
    }
    const o = clamp01(occ / aoNorm);
    return o * o;
  }

  /* ---------------------- vertex colour ---------------------- */

  /* SHADOW TINT, and it is an instrument rather than a constant.

     Vesper's is violet [0.30, 0.16, 0.26], because multiplying to
     grey makes baked occlusion look DIRTY. Kenosis's is saturated
     blue, because shadowed snow is blue. A wet tropical shore is
     neither: its shadows are GREEN-CYAN, because the fill light in
     every shaded place on this level has bounced off either water
     or leaves and there is nothing else for it to have bounced off.

     Both terms push the SAME WAY - red is attenuated hardest
     (0.30) and lifted least (0.022), green least attenuated and
     lifted most - because a naive re-tint of another world's
     numbers has one term undoing the other and the result is grey.

     AND IT STAYS OUT OF THE TURQUOISE. The level's one colour law
     is that turquoise belongs to the water alone; the lift's hue is
     about 155 degrees, green, six degrees clear of the protected
     158-200 band. Going right up to a line on purpose is what the
     numeric fence is for. */
  const SHADOW_TINT = [0.30, 0.52, 0.46];
  const SHADOW_LIFT = [0.022, 0.050, 0.044];

  const WIND = field.wind;
  const tintCache = new Map();
  function tintRgb(hex) {
    let v = tintCache.get(hex);
    if (!v) { v = hexToRgb(hex); tintCache.set(hex, v); }
    return v;
  }

  function colourAt(x, z, y, normal, curv) {
    const surf = field.surfaceAt(x, z, normal, curv);
    const slope = 1 - clamp01(normal[1]);
    const r = Math.hypot(x, z);

    /* Where in this surface's tonal range does the vertex sit?
       Local relief against the coarse mean, plus a much weaker
       absolute term. THE ABSOLUTE TERM IS AGAINST SEA LEVEL HERE,
       and this is the one place the atoll parts company with both
       other worlds: they measure against their own radial profile,
       because on a cone a rib crest at 300m and a rib crest at 60m
       are the same kind of place. On an atoll they are not. Height
       above the water IS the story - it is the tide, it is the
       vegetation line, it is the whole shoreline - so the datum is
       SEA_Y and it is worth more weight than Kenosis gives it. */
    const local = (y - coarseHeight(x, z)) * 0.055
      + clamp(y - SEA_Y, -12, 24) * 0.014;

    /* STEEP FACES ARE NOT LIT BY THEIR OWN HEIGHT.

       `local` is the right driver for open ground - a crest is
       exposed, a hollow is not - and a disaster on a near-vertical
       face, where it sweeps the whole ramp from foot to top over
       almost no x or z while the horizontal noise term is constant
       down any one column. Blind reviewers on Kenosis described
       exactly that as "vertical hair-like smearing, planar UVs
       stretched down a wall". There are no UVs in this game; it is
       the ramp being combed by its own driver.

       So the height term fades out as the face steepens and a 3D
       mottle takes over. Rock has bedding, blockiness and
       weathering, none of which know which way is up. The vertical
       coordinate is deliberately the COARSEST of the three, which
       is what puts horizontal strata into it rather than columns.

       THIS IS ANTI-COMB MEASURE THREE OF FOUR. The other three are
       the derived face grades in the landform, the bedding term in
       cauldronAt, and the normal relaxation below. Kenosis measured
       each of them moving its slope metric by 0.00 alone. */
    const wallness = clamp01(1 - normal[1] / 0.62);
    const mottle = wallness > 0.004
      ? (field.noise.ridge.fbm(x / 26 + y / 61, z / 26 - y / 47, 3) * 0.62
        + field.noise.detail.fbm(x / 7.5 + y / 15, z / 7.5 + y / 19, 2) * 0.38)
      : 0;
    /* THE 210 m WASH IS DAMPED UNDERWATER, and this - not the
       height field - is what round 1 was actually naming when it
       called the lagoon floor camouflage.

       A three-octave noise at 210 m carries its second and third
       octaves at 105 m and 52 m, and at a gain of 0.20 it swings
       SAND_RAMP by a fifth of its length. On dry ground that is
       the wash that stops a beach being one flat colour and it
       earns its place. Under six metres of water it is a field of
       high-contrast irregular patches sixty to a hundred metres
       across, evenly distributed at one scale - which is the
       definition of camouflage, and it is what the frame showed
       even after the bommie geometry was rebuilt. Isolating the
       terrain confirmed it: the baseline's lagoon floor is 88 %
       plain `sand` by classification, so the blotches could only
       ever have been the ramp driver.

       It is also physically wrong. Path scattering destroys
       albedo contrast long before it destroys the LARGE-scale
       depth colour, which is why a real lagoon floor reads as one
       clean tone with objects on it. And the floor is what the
       Spine's shadow has to fall on - a busy floor eats that
       shadow, which is the one thing the layout cannot afford to
       lose.

       0.80 of it gone by 5.5 m down. `local` is deliberately NOT
       damped: that term is the bommies' own relief against the
       coarse mean, and it is the cue that makes a coral head read
       as a solid object rather than a stain. */
    const wash = 1 - 0.80 * clamp01((SEA_Y - y) / 5.5);
    const crest = clamp01(
      0.46 + local * (1 - wallness * 0.88) + (1 - slope) * 0.18
      + field.noise.warp.fbm(x / 210, z / 210, 3) * 0.20 * wash
      + mottle * wallness * 0.34
    );

    /* Weighted blend across whichever surfaces are present. */
    let cr = 0; let cg = 0; let cb = 0; let wsum = 0;
    {
      const wgt = surf.sand;
      if (wgt > 0.002) {
        const c = SAND_RAMP.at(crest);
        cr += c[0] * wgt; cg += c[1] * wgt; cb += c[2] * wgt; wsum += wgt;
      }
    }
    for (let i = 0; i < ATOLL_SURFACE_KEYS.length; i += 1) {
      const key = ATOLL_SURFACE_KEYS[i];
      const wgt = surf[key];
      if (wgt <= 0.002) continue;
      const bias = RAMP_BIAS[key];
      const c = RAMPS[key].at(clamp01(crest * bias[0] + bias[1]));
      cr += c[0] * wgt; cg += c[1] * wgt; cb += c[2] * wgt; wsum += wgt;
    }
    if (wsum <= 0.0001) {
      const c = SAND_RAMP.at(crest);
      cr = c[0]; cg = c[1]; cb = c[2]; wsum = 1;
    }
    cr /= wsum; cg /= wsum; cb /= wsum;

    /* Station tint. A place carries a mood from 800m before a
       single prop of it is visible. STATION_TINT entries are
       [hex, amount] pairs and nothing in the table exceeds 0.12 -
       past that it stops being a wash and starts being paint, and a
       level that paints its districts different colours reads as a
       menu. */
    const tint = STATION_TINT[surf.district];
    if (tint && tint[1] > 0 && surf.districtWeight > 0.01) {
      const k = surf.districtWeight * tint[1];
      const m = mixRgb([cr, cg, cb], tintRgb(tint[0]), k);
      cr = m[0]; cg = m[1]; cb = m[2];
    }

    const occ = occlusionAt(x, z, y, normal);
    if (occ > 0.002) {
      const k = occ * 0.60;
      cr = lerp(cr, cr * SHADOW_TINT[0] + SHADOW_LIFT[0], k);
      cg = lerp(cg, cg * SHADOW_TINT[1] + SHADOW_LIFT[1], k);
      cb = lerp(cb, cb * SHADOW_TINT[2] + SHADOW_LIFT[2], k);
    }

    /* THE SWASH LINE. The wet band's upper edge is where the last
       high tide reached, and on a real beach it is not a contour -
       it is a scalloped line, because the swash runs up further
       between beach cusps than over them. One extra darkening at
       the very top of the wet band, keyed to the same tide
       heights the classifier uses so the two cannot disagree, and
       shaped by a shore-parallel noise so it scallops.

       This is the cheapest thing in the file that makes the shore
       read as a shore rather than as two colours meeting. */
    if (surf.wetSand > 0.15 && y > 0 && y < TIDE.splashTop) {
      const inv = 1 / Math.max(r, 1e-3);
      const along = (-x * inv * z + z * inv * x) * 0 + Math.atan2(x, -z) * r;
      const scal = field.noise.detail.fbm(along * 0.012, y * 0.9 + 17, 2);
      const edge = clamp01(1 - Math.abs((y - TIDE.crustTop * 0.9) / 0.42 - scal * 0.7));
      if (edge > 0.01) {
        const m = mixRgb([cr, cg, cb], WETSAND_RAMP.at(0.14), edge * surf.wetSand * 0.5);
        cr = m[0]; cg = m[1]; cb = m[2];
      }
    }

    return [cr, cg, cb];
  }

  /* ------------------------ chunk sampling ------------------------ */

  const FINE = LOD_CELLS[0];
  const FINE_SIDE = FINE + 1;

  /* THE WHOLE MAP AT THE LOD0 SPACING, retained across the build.
     513 x 513 at 4m, 1.05MB, and it is what the seabed bake reads.
     Baking the seabed from `heightAt` instead would be another
     1,048,576 evaluations - three quarters of the entire mesh pass,
     to answer a question the mesh pass has already answered - and
     worse, it would answer it DIFFERENTLY at the sub-texel level,
     so the foam line would sit where the field is rather than where
     the ground is drawn. Resampling the mesh's own samples makes
     the water and the visible ground agree by construction. */
  const FINE_DIM = CHUNKS * FINE + 1;                 // 513
  const finePlane = new Float32Array(FINE_DIM * FINE_DIM);

  function sampleChunk(cx, cz) {
    const step = CHUNK_SIZE / FINE;
    const ox = -MAP_HALF + cx * CHUNK_SIZE;
    const oz = -MAP_HALF + cz * CHUNK_SIZE;
    const n = FINE_SIDE * FINE_SIDE;
    const ys = new Float32Array(n);
    const ns = new Float32Array(n * 3);
    const cs = new Float32Array(n * 3);
    const nrm = [0, 0, 0];
    for (let j = 0; j < FINE_SIDE; j += 1) {
      const z = oz + j * step;
      for (let i = 0; i < FINE_SIDE; i += 1) {
        const x = ox + i * step;
        const p = j * FINE_SIDE + i;
        const y = field.heightAt(x, z);
        field.normalAt(x, z, nrm);
        const c = colourAt(x, z, y, nrm, coarseCurvature(x, z));
        ys[p] = y;
        finePlane[(cz * FINE + j) * FINE_DIM + (cx * FINE + i)] = y;
        ns[p * 3] = nrm[0]; ns[p * 3 + 1] = nrm[1]; ns[p * 3 + 2] = nrm[2];
        /* sRGB -> linear on the way into the buffer. A ramp
           authored in sRGB hex and written raw renders far too
           dark, and "far too dark" reads as a lighting bug rather
           than as a colour bug - which is an expensive place to
           start looking. */
        cs[p * 3] = srgb(c[0]); cs[p * 3 + 1] = srgb(c[1]); cs[p * 3 + 2] = srgb(c[2]);
      }
    }

    /* --- NORMAL RELAXATION ON NEAR-VERTICAL GROUND ---------------
       ANTI-COMB MEASURE FOUR.

       A height field cannot draw a vertical face. Where the ground
       stands past about 80 degrees - and 0.92% of this map does,
       on the plug's flank, the Weeping Steps' riser and the road's
       cut - it draws a run of one-cell-wide facets instead, each
       announcing its own orientation, and the wall reads as
       corrugated card. Five consecutive blind rounds ranked that
       Kenosis's worst defect, and a term-by-term bisect of the
       composed height against a 27,889-sample slope census found
       that EVERY SINGLE TERM moved the over-80 population by
       nothing. There is no one feature to fix; the steepness is the
       sum.

       This changes no geometry, no silhouette and not one byte of
       collision - `heightAt` stays analytic and authoritative. It
       low-passes the SHADING NORMAL, and only where the surface is
       too steep to be drawn honestly. Run on the fine grid BEFORE
       decimation, so every LOD inherits the same relaxed normals
       and they cannot disagree at a seam. */
    {
      const src = ns.slice();
      for (let j = 0; j < FINE_SIDE; j += 1) {
        for (let i = 0; i < FINE_SIDE; i += 1) {
          const q = j * FINE_SIDE + i;
          const ny = src[q * 3 + 1];
          /* sin(slope). Nothing below about 58 degrees is touched. */
          const hlen = Math.sqrt(Math.max(0, 1 - ny * ny));
          const k = clamp01((hlen - 0.85) / 0.13);
          if (k <= 0.001) continue;
          let ax = 0; let ay = 0; let az = 0; let w = 0;
          for (let dj = -2; dj <= 2; dj += 1) {
            const jj = j + dj;
            if (jj < 0 || jj >= FINE_SIDE) continue;
            for (let di = -2; di <= 2; di += 1) {
              const ii = i + di;
              if (ii < 0 || ii >= FINE_SIDE) continue;
              const t = jj * FINE_SIDE + ii;
              ax += src[t * 3]; ay += src[t * 3 + 1]; az += src[t * 3 + 2];
              w += 1;
            }
          }
          if (w < 2) continue;
          ax /= w; ay /= w; az /= w;
          const mx = src[q * 3] + (ax - src[q * 3]) * k;
          const my = src[q * 3 + 1] + (ay - src[q * 3 + 1]) * k;
          const mz = src[q * 3 + 2] + (az - src[q * 3 + 2]) * k;
          const len = Math.hypot(mx, my, mz) || 1;
          ns[q * 3] = mx / len; ns[q * 3 + 1] = my / len; ns[q * 3 + 2] = mz / len;
        }
      }
    }

    return { ys, ns, cs, ox, oz, step };
  }

  /* SKIRT DEPTH, derived rather than copied.

     The quantity is the maximum DOWNWARD deviation of the LOD0
     surface from an LOD3 chord across one 32m cell, because that is
     the gap a skirt has to cover when two neighbouring chunks pick
     different LODs. For a smooth surface that is (S^2/8)|f''| with
     S = 32; for a crest narrower than the chord it is the crest
     height itself.

     Four candidates measured against this world, all of them at
     places a chunk seam actually crosses (the plug spans the x =
     -512 and z = 256 seams):
       - the plug's rounded shoulder, grade 1.635 eased over 20m:
         |f''| = 0.082 -> 10.5m;
       - the Weeping Steps' riser, 2.6 over a 26m feather:
         |f''| = 0.15 -> 19.2m;
       - the crater lip, 20m of rise over 24m: -> 13.3m;
       - the beach face, 1.83m over 18m: -> 1.4m.
     Worst realistic case is the riser at 19.2, so SKIRT = 22.

     Note where the binding case ISN'T. At the LOD0/LOD1 boundary
     (4m against 8m cells, 430m from the camera) the same arithmetic
     gives under 2m, because the near ground on this level is a
     beach. The 22m is bought entirely for the LOD2/LOD3 seam at
     1350m - which on an atoll means the far side of the ring seen
     across the lagoon, where a slot of sky through the island is
     the single most obvious artefact available. */
  const SKIRT = 22;

  function geometryFromSamples(s, lod) {
    const cells = LOD_CELLS[lod];
    const stride = FINE / cells;
    const side = cells + 1;
    const vCount = side * side + side * 4;
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    const indices = [];

    /* EVERY LOD IS A STRIDE OF THE ONE SAMPLE GRID (1, 2, 4, 8), so
       a chunk is sampled once and decimated four times and shared
       samples agree exactly. This requires FINE % cells === 0 for
       every LOD entry; a non-divisor set produces fractional
       strides and silently corrupted reads, not an error. */
    for (let j = 0; j < side; j += 1) {
      for (let i = 0; i < side; i += 1) {
        const src = (j * stride) * FINE_SIDE + i * stride;
        const p = j * side + i;
        positions[p * 3] = s.ox + i * stride * s.step;
        positions[p * 3 + 1] = s.ys[src];
        positions[p * 3 + 2] = s.oz + j * stride * s.step;
        normals[p * 3] = s.ns[src * 3];
        normals[p * 3 + 1] = s.ns[src * 3 + 1];
        normals[p * 3 + 2] = s.ns[src * 3 + 2];
        colors[p * 3] = s.cs[src * 3];
        colors[p * 3 + 1] = s.cs[src * 3 + 1];
        colors[p * 3 + 2] = s.cs[src * 3 + 2];
      }
    }

    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        const a = j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        /* Alternate the diagonal, or every quad splits the same way
           and the field grows a herringbone at grazing sun - which
           on a level whose entire texture story is grazing light on
           water and wet sand is not optional. `groundHeightAt`
           reproduces this branch and MUST be changed with it. */
        if (((i + j) & 1) === 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, c, d, a, d, b);
      }
    }

    const edgeOf = [
      (i) => i,
      (i) => (side - 1) * side + i,
      (i) => i * side,
      (i) => i * side + (side - 1),
    ];
    let sp = side * side;
    for (let e = 0; e < 4; e += 1) {
      const first = sp;
      for (let i = 0; i < side; i += 1) {
        const src = edgeOf[e](i);
        positions[sp * 3] = positions[src * 3];
        positions[sp * 3 + 1] = positions[src * 3 + 1] - SKIRT;
        positions[sp * 3 + 2] = positions[src * 3 + 2];
        normals[sp * 3] = normals[src * 3];
        normals[sp * 3 + 1] = normals[src * 3 + 1];
        normals[sp * 3 + 2] = normals[src * 3 + 2];
        colors[sp * 3] = colors[src * 3] * 0.80;
        colors[sp * 3 + 1] = colors[src * 3 + 1] * 0.78;
        colors[sp * 3 + 2] = colors[src * 3 + 2] * 0.84;
        sp += 1;
      }
      for (let i = 0; i < side - 1; i += 1) {
        const t0 = edgeOf[e](i);
        const t1 = edgeOf[e](i + 1);
        const b0 = first + i;
        const b1 = first + i + 1;
        /* Wound both ways. Only one winding is front-facing and the
           other is simply never drawn - cheaper than deriving the
           correct orientation for four traversal directions. */
        indices.push(t0, b0, b1, t0, b1, t1);
        indices.push(t0, b1, b0, t0, t1, b1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(vCount > 65535
      ? new THREE.BufferAttribute(new Uint32Array(indices), 1)
      : new THREE.BufferAttribute(new Uint16Array(indices), 1));
    geo.computeBoundingSphere();
    return geo;
  }

  /* ---- build every chunk ---- */

  const chunks = [];
  const total = CHUNKS * CHUNKS;
  let vertexCount = 0;
  let done = 0;
  for (let cz = 0; cz < CHUNKS; cz += 1) {
    for (let cx = 0; cx < CHUNKS; cx += 1) {
      const samples = sampleChunk(cx, cz);
      const lods = [];
      for (let lod = 0; lod < LOD_CELLS.length; lod += 1) {
        const geo = geometryFromSamples(samples, lod);
        vertexCount += geo.getAttribute("position").count;
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = `terrain-${cx}-${cz}-l${lod}`;
        mesh.castShadow = lod <= 1;
        mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
        lods.push(mesh);
      }
      const centreX = -MAP_HALF + (cx + 0.5) * CHUNK_SIZE;
      const centreZ = -MAP_HALF + (cz + 0.5) * CHUNK_SIZE;
      chunks.push({
        cx, cz, lods, active: -1, centreX, centreZ,
        centreY: samples.ys[(FINE_SIDE * FINE_SIDE) >> 1],
        /* Retain the 65x65 height plane (17KB per chunk, 1.08MB
           total) so gameplay stands on the triangles the player
           actually sees. */
        heightSamples: samples.ys,
      });
      done += 1;
      if (onProgress) {
        onProgress(0.12 + 0.80 * (done / total));
        /* Yield every FOURTH chunk, and do not "improve" the
           cadence: a hidden tab throttles setTimeout to one second,
           so 64 yields here plus 8 in the coarse pass turned a 2.7s
           load into seventy-odd seconds of watching a progress bar
           that was not waiting on any work. About 21 yields total. */
        if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  /* ============================================================
     THE SEABED BAKE - THE ONE THING THE SEA CAN ASK

     A water shader cannot call `heightAt`. So the build hands it a
     texture, and this texture is the ONLY thing atoll-water knows
     about the ground: the depth colour, the foam line, the caustic
     strength and the wet-sand band all derive from it, which means
     they all agree with each other by construction even where they
     disagree with the field by a texel.

     1024 x 1024 over 2048m is 2m per texel - HALF the LOD0 cell,
     deliberately, because the thing the eye is looking at is the
     foam line and the foam line is a contour of this texture. At
     4m per texel the audit's foam-position error against the real
     field runs to 2.4m of horizontal position on a 1:10 beach face;
     at 2m it is 1.2m, which is the gate.

     SIXTEEN BITS, NOT EIGHT. `h = (r + g/255) * 96 - 48`. Eight
     bits over a 96m range is 0.376m per step, and on a beach face
     that stands at 1:10 a 0.376m step in the depth field is a 3.8m
     TERRACE in the foam line - a visible staircase running along
     the whole shore, in exactly the place the whole level is
     looking. The second byte costs one channel that is otherwise
     zero and takes the step to 1.5mm.

     The range [-48, +48] is a DEPTH range and not an elevation
     range: everything above +48 clamps, which is the Cauldron and
     nothing else, and the sea has no opinion about the Cauldron.

     LinearFilter and ClampToEdgeWrapping. NEAREST here would give
     the foam line 2m stair-steps in plan, which is the same defect
     as the 8-bit encode rotated ninety degrees. No mipmaps: a
     mipped depth texture averages the beach and the lagoon floor
     together at the shoreline, which is the one texel that matters.
     ============================================================ */

  const SEABED_DIM = 1024;
  const SEABED_SCALE = 96;
  const SEABED_OFFSET = -48;

  const seabedTexture = (() => {
    const data = new Uint8Array(SEABED_DIM * SEABED_DIM * 4);
    /* Texel centres, so a shader sampling at uv = (x + MAP_HALF) /
       MAP_SIZE lands exactly where this loop measured. */
    const scale = MAP_SIZE / SEABED_DIM;                 // 2m
    for (let j = 0; j < SEABED_DIM; j += 1) {
      /* Position in the retained fine grid, which is 4m; every
         other texel lands exactly on a mesh vertex and the ones
         between are the linear interpolant of the drawn triangle
         edge. */
      const fz = clamp(((j + 0.5) * scale) / (MAP_SIZE / (FINE_DIM - 1)), 0, FINE_DIM - 1.001);
      const jz = fz | 0;
      const tz = fz - jz;
      for (let i = 0; i < SEABED_DIM; i += 1) {
        const fx = clamp(((i + 0.5) * scale) / (MAP_SIZE / (FINE_DIM - 1)), 0, FINE_DIM - 1.001);
        const ix = fx | 0;
        const tx = fx - ix;
        const a = finePlane[jz * FINE_DIM + ix];
        const b = finePlane[jz * FINE_DIM + ix + 1];
        const c = finePlane[(jz + 1) * FINE_DIM + ix];
        const d = finePlane[(jz + 1) * FINE_DIM + ix + 1];
        const h = lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
        const t = clamp01((h - SEABED_OFFSET) / SEABED_SCALE) * 255;
        const hi = Math.min(255, t | 0);
        const lo = Math.min(255, Math.round((t - hi) * 255));
        const p = (j * SEABED_DIM + i) * 4;
        data[p] = hi;
        data[p + 1] = lo;
        /* B carries the tide band as a byte, 0..4 scaled to 0..255,
           so the shader can hard-edge the crust line without
           re-deriving TIDE from a float compare on a lerped depth.
           A is opaque: some drivers treat a zero alpha channel in a
           data texture as a hint to premultiply. */
        data[p + 2] = h < TIDE.low ? 0
          : (h < SEA_Y ? 64 : (h < TIDE.crustTop ? 128
            : (h < TIDE.splashTop ? 192 : 255)));
        data[p + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, SEABED_DIM, SEABED_DIM,
      THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = "atoll-seabed";
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  })();

  /* ============================================================
     THE APRON

     The chunk grid stops at the 2048m square and the atoll's reef
     crest is at r = 972 +/- 29, so on the axes there is barely
     fifty metres of mesh outside the level's own boundary and on
     the diagonals there is four hundred. Everything past that - the
     fore-reef, the drop-off and the deep seabed - has to exist or
     the drop-off is a colour change with no geometry under it, and
     an opaque water shader reading a depth texture over NOTHING
     draws the abyss as a flat plane.

     THE INNER EDGE FOLLOWS THE SQUARE, NOT A CIRCLE, and that is
     the whole trick. A ring starting at r = 980 would overlap the
     chunk mesh out to r = 1448 on the diagonals - four hundred
     metres of two surfaces at the same elevation, which is
     z-fighting across the most-looked-at water in the level. The
     square's own perimeter is MAP_HALF / max(|sin a|, |cos a|), so
     the apron starts exactly where the chunks stop, on every
     bearing, and the two meet along a line rather than over an
     area. The chunks' 22m skirt covers the sub-decimetre cracks
     where the apron's 128 angular samples do not line up with the
     chunk edges' 4m ones - and every one of those cracks is under
     at least fourteen metres of water.

     RADIALLY GRADED, and the grading is set by what is visible.
     Nothing past the drop-off is EVER seen: the deepest readable
     seabed is about -22m, the highest point a player can stand is
     the Cauldron's 214m, and a ray from there to the map edge meets
     the sea at 11.8 degrees, where water's Fresnel reflectance is
     0.72 and the transmitted path is 108m of water. So the rings
     are dense in the first three hundred metres, where the
     fore-reef's spur-and-groove is genuinely readable through
     clear water, and enormous after it.
     ============================================================ */

  const APRON_ANG = 128;
  const APRON_RINGS = 30;

  const apron = (() => {
    const vCount = APRON_ANG * (APRON_RINGS + 1);
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    const indices = [];
    const nrm = [0, 0, 0];
    for (let ri = 0; ri <= APRON_RINGS; ri += 1) {
      /* Power 2.4: the first ring pair is 9m apart and the last is
         330m. A linear grading put 55m cells on the fore-reef,
         which is coarser than the grooves it is meant to carry. */
      const t = Math.pow(ri / APRON_RINGS, 2.4);
      for (let ai = 0; ai < APRON_ANG; ai += 1) {
        const a = (ai / APRON_ANG) * TAU;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const inner = MAP_HALF / Math.max(Math.abs(sa), Math.abs(ca));
        const r = lerp(inner, APRON_OUT, t);
        const x = r * sa;
        const z = -r * ca;
        const y = field.heightAt(x, z);
        const p = ri * APRON_ANG + ai;
        field.normalAt(x, z, nrm);
        positions[p * 3] = x; positions[p * 3 + 1] = y; positions[p * 3 + 2] = z;
        normals[p * 3] = nrm[0]; normals[p * 3 + 1] = nrm[1]; normals[p * 3 + 2] = nrm[2];
        /* A dedicated colour rather than `colourAt`: outside the
           map the coarse grid clamps to its edge, so occlusion and
           the district field would both be reading the boundary
           row over and over. Two ramps and a depth mix is all that
           is visible under fourteen metres of water anyway. */
        const deep = clamp01((-y - 6) / 26);
        const c = mixRgb(CORAL_RAMP.at(clamp01(0.42 + y * 0.06)),
          BASALT_RAMP.at(0.20), deep);
        colors[p * 3] = srgb(c[0]);
        colors[p * 3 + 1] = srgb(c[1]);
        colors[p * 3 + 2] = srgb(c[2]);
      }
    }
    for (let ri = 0; ri < APRON_RINGS; ri += 1) {
      for (let ai = 0; ai < APRON_ANG; ai += 1) {
        const a2 = ri * APRON_ANG + ai;
        const b2 = ri * APRON_ANG + ((ai + 1) % APRON_ANG);
        const c2 = (ri + 1) * APRON_ANG + ai;
        const d2 = (ri + 1) * APRON_ANG + ((ai + 1) % APRON_ANG);
        indices.push(a2, c2, b2, b2, c2, d2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = "terrain-apron";
    /* It never casts: it is entirely below the water line and a
       shadow map that had to contain a 5.2km disc would lose every
       texel that matters to the island. */
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    return { mesh, triangles: indices.length / 3, vertices: vCount };
  })();

  if (onProgress) onProgress(0.99);

  /* ------------------------ LOD selection ------------------------ */

  function updateLod(camera) {
    const { x, y, z } = camera.position;
    for (let n = 0; n < chunks.length; n += 1) {
      const chunk = chunks[n];
      /* THE DISTANCE IS 3D, and on this world the centreY term
         earns its keep in a way the flat plan view hides: the whole
         level is looked at from the Spine's crown 34m up, from the
         Drive Cathedral's walk at 96m and from the Cauldron's rim
         at 214m. A 2D distance holds the entire ring at LOD0 from
         the summit. */
      const d = Math.hypot(chunk.centreX - x, chunk.centreY - y, chunk.centreZ - z);
      let lod = LOD_CELLS.length - 1;
      for (let i = 0; i < LOD_RANGES.length; i += 1) {
        if (d < LOD_RANGES[i]) { lod = i; break; }
      }
      if (lod === chunk.active) continue;
      if (chunk.active >= 0) chunk.lods[chunk.active].visible = false;
      chunk.lods[lod].visible = true;
      chunk.active = lod;
    }
  }

  /** Height of the RENDERED near-player triangle at (x, z).
   *
   *  Reproduces geometryFromSamples' alternating diagonals exactly.
   *  Using the continuous authoring field instead makes feet,
   *  collision and the visible floor disagree, and here the worst
   *  place for that is the crater lip and the road's cut face -
   *  which is why both are built with a bounded second derivative.
   *  collide.js:204 falls back to `heightAt` SILENTLY if this is
   *  missing, so its absence is not an error, it is a drift. */
  function groundHeightAt(x, z) {
    const wx = clamp(x, -MAP_HALF, MAP_HALF);
    const wz = clamp(z, -MAP_HALF, MAP_HALF);
    const cx = Math.max(0, Math.min(CHUNKS - 1,
      Math.floor((wx + MAP_HALF) / CHUNK_SIZE)));
    const cz = Math.max(0, Math.min(CHUNKS - 1,
      Math.floor((wz + MAP_HALF) / CHUNK_SIZE)));
    const chunk = chunks[cz * CHUNKS + cx];
    const ox = -MAP_HALF + cx * CHUNK_SIZE;
    const oz = -MAP_HALF + cz * CHUNK_SIZE;
    const step = CHUNK_SIZE / FINE;
    const gx = clamp((wx - ox) / step, 0, FINE);
    const gz = clamp((wz - oz) / step, 0, FINE);
    const i = Math.min(FINE - 1, Math.floor(gx));
    const j = Math.min(FINE - 1, Math.floor(gz));
    const u = gx - i;
    const v = gz - j;
    const ys = chunk.heightSamples;
    const a = ys[j * FINE_SIDE + i];
    const b = ys[j * FINE_SIDE + i + 1];
    const c = ys[(j + 1) * FINE_SIDE + i];
    const d = ys[(j + 1) * FINE_SIDE + i + 1];
    if (((i + j) & 1) === 0) {
      return u + v <= 1
        ? a * (1 - u - v) + b * u + c * v
        : b * (1 - v) + c * (1 - u) + d * (u + v - 1);
    }
    return v >= u
      ? a * (1 - v) + c * (v - u) + d * u
      : a * (1 - u) + d * v + b * (u - v);
  }

  /** Depth of the baked seabed at a point, in metres of water, so
   *  the audit can measure this texture against the field it came
   *  from without decoding bytes itself. */
  function seabedDepthAt(x, z) {
    const data = seabedTexture.image.data;
    const scale = MAP_SIZE / SEABED_DIM;
    /* BILINEAR, because the texture is sampled with LinearFilter
       and this function exists to tell the audit what the SHADER
       will see. Reading the nearest texel instead reports the
       texture as 0.55m worse than it is at the shore, and a gate
       measured against the wrong sampler is a gate that fails for
       the wrong reason - or, worse, passes for one. */
    const fx = clamp((x + MAP_HALF) / scale - 0.5, 0, SEABED_DIM - 1.001);
    const fz = clamp((z + MAP_HALF) / scale - 0.5, 0, SEABED_DIM - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const read = (ii, jj) => {
      const p = (jj * SEABED_DIM + ii) * 4;
      return (data[p] / 255 + data[p + 1] / 65025) * SEABED_SCALE + SEABED_OFFSET;
    };
    const h = lerp(
      lerp(read(i, j), read(i + 1, j), tx),
      lerp(read(i, j + 1), read(i + 1, j + 1), tx), tz
    );
    return Math.max(0, SEA_Y - h);
  }

  /* ============================================================
     THE FLOOR-LOWERING HOOK

     collide.js:192-209 reads `ctx.undercroft?.groundOverrideAt?.(x, z)`
     BEFORE it reads the terrain, takes the answer whole, and
     applies it to the entire column. It is an OVERRIDE, NOT A
     MAXIMUM, and it is the only thing in this engine that can lower
     a floor - `world.walkSurfaceAt` can only raise one, because of
     the Math.max at collide.js:208.

     THE TABLE IS EMPTY IN THIS BUILD and the hook is live, which is
     a decision rather than an omission. The flooded hold inside the
     Spine wants it, and so does any sea cave; both are somebody
     else's milestone. What matters is that `atoll-main` can hang
     this on `ctx.undercroft` BEFORE `buildCollision` runs, because
     collide.js optional-chains it and a LATE assignment is silent
     rather than fatal - which is worse, since the hole simply stops
     being a hole and nothing reports it.

     Two caveats for whoever fills it:
       1. the answer must be CONTINUOUS across `reach`, or the
          collision cache's 32m pages disagree with each other about
          where the rim is;
       2. a bore is a softlock unless there is a fall handler. This
          world has water at the bottom of everything, which is a
          better answer than Kenosis had - but "better" is not "a
          handler", and the entry shape below assumes one exists.

         { x, z, bore: 9, reach: 16, floorY: <surface - 40> }
     ============================================================ */
  const overrides = [];

  const groundOverride = {
    overrides,
    groundOverrideAt(x, z) {
      for (let i = 0; i < overrides.length; i += 1) {
        const o = overrides[i];
        const d = Math.hypot(x - o.x, z - o.z);
        if (d >= o.reach) continue;
        const t = sstep(o.bore, o.reach, d);
        if (t >= 1) continue;
        return lerp(o.floorY, field.heightAt(x, z), t);
      }
      return null;
    },
  };

  return {
    group,
    chunks,
    /* Collision includes any rendered-grid vertex inside a capsule
       footprint: a triangulated height field reaches an interior
       maximum only at one of those vertices. collide.js:897 reads
       this BY NAME and collide.js:898 guards it with
       Number.isFinite, so a missing value degrades SILENTLY -
       `flightGroundHeight` just stops catching interior maxima, and
       on this level that means the reef crest stops existing for
       anything flying over it. */
    groundSampleStep: CHUNK_SIZE / FINE,
    field,
    rng,
    coarseHeight,
    coarseCurvature,
    occlusionAt,
    heightAt: field.heightAt,
    groundHeightAt,
    normalAt: field.normalAt,
    surfaceAt: field.surfaceAt,
    curvatureAt: field.curvatureAt,
    /* THE ONE READER OF DEPTH, re-exported rather than
       re-implemented. Two derivations of "how deep is it here"
       would disagree within a week and the disagreement would
       surface as a foam line in the wrong place, which names
       nothing. */
    waterDepthAt: field.waterDepthAt,
    tideBandAt: field.tideBandAt,
    shoreRadiusFor: field.shoreRadiusFor,
    seabedTexture,
    seabedEncode: Object.freeze({
      scale: SEABED_SCALE,
      offset: SEABED_OFFSET,
      dim: SEABED_DIM,
      /* h = (r + g/255) * scale + offset, with r and g the
         normalised RGBA8 channels. B is the tide band, 0..1 in
         five steps. */
      formula: "h = (tex.r + tex.g / 255.0) * scale + offset",
    }),
    seabedDepthAt,
    apron: apron.mesh,
    groundOverride,
    updateLod,
    stats() {
      let tris = 0;
      let visible = 0;
      for (const chunk of chunks) {
        if (chunk.active < 0) continue;
        visible += 1;
        tris += chunk.lods[chunk.active].geometry.index.count / 3;
      }
      return {
        chunks: chunks.length,
        visible,
        triangles: tris + apron.triangles,
        vertices: vertexCount + apron.vertices,
        drawCalls: visible + 1,
        skirt: SKIRT,
        apron: { triangles: apron.triangles, inner: APRON_IN, outer: APRON_OUT },
        seabed: { dim: SEABED_DIM, metresPerTexel: MAP_SIZE / SEABED_DIM, bits: 16 },
        circuit: {
          length: field.circuitLength,
          grade: field.circuitGrade(600).max,
          padError: field.padRouteError,
        },
        cauldronRoad: {
          nodes: field.cauldronRoad.length,
          grade: field.cauldronRoadGrade(600).max,
        },
        overrides: overrides.length,
      };
    },
  };
}
