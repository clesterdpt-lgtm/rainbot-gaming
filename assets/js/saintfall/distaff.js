/* ============================================================
   SAINTFALL - the Distaff

   The Glass Scar's own guardian, and everything about it that is not
   geometry: when it wakes, how it fights while standing, what
   breaking a leg does to it, and what it does once enough of them
   are gone.

   WHY THIS IS ITS OWN MODULE

   Every other creature in the bestiary is a body `stepEnemy` can
   reason about with one set of rules: it stands on the ground, it is
   always hittable, and it is either closing or attacking. None of
   that is true here. This animal is driven entirely by proximity
   rather than sight/hearing/aggro, most of its body is not a valid
   target until eight legs have taken real damage, and "standing" and
   "collapsed" are different creatures as far as combat.js's hit
   tests are concerned. Bolting that onto stepEnemy would have put a
   `key === "distaff"` branch into the file every walker in the game
   depends on - see combat.js's own opt-out for the reasoning, which
   this module is the second user of.

   THE CYCLE

     DORMANT    Folded in its lair. Ignores the player completely
                until they cross AGGRO_RADIUS - this is a place you
                walk into, not a wave that finds you.
     ALERT      A short reveal beat: rears up, the camera cuts to it.
     STANDING   THE FIGHT'S FIRST HALF. Nine metres up, only the legs
                are in reach. It answers with a telegraphed leg slam,
                web bolts at range and web patches underfoot.
     COLLAPSED  Triggered once enough legs are broken (see combat.js's
                LEG_BREAK_BONUS_FRACTION and HITBOX.distaff for the
                mechanical half of this). The body comes down and is,
                for the first time, worth more to melee than to a
                rifle - it still bites back while it is there.
     RECOVERING Standing back up, if it survives the window. Every
                broken leg stays broken; breaking a NINTH... eighth
                one is not possible, and breaking the last of the
                eight leaves it down for good.

   A leg it has lost stays lost - this module reads `inst.legBroken`/
   `inst.legsBroken`, which combat.js owns, and never writes to them.

   ------------------------------------------------------------------
   AND WHAT IT IS MADE OF. See `THE DRESSING` below: this module also
   owns the animal's skin now. The bestiary's one shared `distaff`
   material is replaced at spawn by five of our own, the vertex colours
   are repainted from the crater's near-black teal to chalk and fused
   glass, and a broken leg is repainted rather than merely flagged.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus, sstep, srgbToLinear,
} from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
import { DISTRICTS } from "saintfall/terrain.js";

export const DISTAFF_CONFIG = Object.freeze({
  // Off-centre in the Scar's flat floor, clear of the buried lance
  // and its light at the crater's middle - see world.js.
  lairX: DISTRICTS.scar.x - 14,
  lairZ: DISTRICTS.scar.z + 10,
  /* Inside the crater, not across it - the reveal is "you have
     walked into its territory", not "it noticed you from the rim". */
  aggroRadius: 52,
  /* Past this and unengaged long enough, it resets to full health and
     goes back to sleep - see `stepDormantCheck`. Without this a
     player who pulls it, dies elsewhere and respawns would come back
     to a boss frozen mid-fight with no way to reach it again. */
  disengageRadius: 240,
  disengageSeconds: 14,

  // A real boss introduction, not the 0.37-second camera flash the
  // old release threshold accidentally produced.
  alertSeconds: 4.8,

  /* ------------------------------------------------------------
     LOCOMOTION. It walks now - the original shipped as a planted
     turret and read as furniture with a health bar. It stalks a
     preferred ring around the player: outside the band it advances,
     inside it backs away (a thing this size giving ground is worth
     more menace than any charge), and inside the band it drifts
     sideways so the legs are never still. Everything stops while an
     attack is winding up: a slam thrown mid-stride would smear the
     telegraph. */
  walkSpeed: 3.0,
  backSpeed: 1.7,
  strafeSpeed: 0.9,
  holdBand: Object.freeze([10.5, 16]),
  /* THE LUNGE. The answer to standing at 25m plinking legs: a rear-up
     read, then a sprint that ends in the ordinary slam. It converts
     the existing telegraph vocabulary into a gap-closer instead of
     adding a new unreadable one.

     FURTHER AND FASTER than it shipped. 9.5 m/s barely outpaced the
     trooper's own 8.6 sprint and 34m was inside the range a Volley
     player naturally settles at, so the "gap-closer" arrived late to a
     gap that had already been re-opened. Twice the sprint, half the
     crater: it reaches from where the player actually stands and gets
     there before they have finished deciding to move. The rear-up beat
     is the whole warning now - the HUD banner is gone - so it stays
     at 0.4s and the chord still plays over it. */
  lungeCadence: 8.0,
  lungeSeconds: 2.4,
  lungeSpeed: 17.5,
  lungeMinRange: 13,
  lungeMaxRange: 48,
  /* How fast the sprint may bend toward a player who is not where it
     was pointed when it left. A homing lunge is unreadable and an
     unsteerable one is a joke; this is a twelve-metre turning radius
     at full speed - a committed step off the line at the last moment
     is a dodge, standing still and strafing at 30m is not. */
  lungeSteer: 1.4,

  /* TURNING. It used to face the player with an uncapped exponential:
     the further you got round it, the FASTER it swung - several
     radians a second on a big error - and every thirteen degrees of
     yaw replants all eight feet, so the leg a melee player had lined
     up on walked away from them by design. Angular velocity is capped
     now, low enough that a trooper circling at a walk gains ground on
     the turn, and it does not turn at all while an attack is wound up
     or while it is staggering off a lost leg. */
  turnRate: 0.62,          // rad/s, standing
  turnRateCollapsed: 0.26, // rad/s, on the ground - the flanks are safe ground
  turnRateReturning: 1.2,
  turnDeadband: 0.045,     // rad - no micro-tracking of a player edging sideways

  /* Its territory. It will not be kited out of the Scar: movement is
     clamped to this ring around the lair, and a player who leaves
     (see disengageRadius) sends it WALKING home at full health
     rather than teleporting - the reset is diegetic. */
  arenaRadius: 74,
  returnSpeed: 5.2,

  /* How far the body sinks below its standing ride height while
     collapsed - the runtime half of the collapse read. The clip folds
     the legs, but a clip only rotates bones: folding legs moves the
     FEET, and without the root itself coming down the animal
     "collapsed" at exactly its standing altitude. enemies.js's
     ground-follow subtracts `inst.bodyDrop`; this module animates it. */
  collapseDrop: 6.1,

  // Legs broken before it buckles - half of eight - and how long the
  // body stays a target once it has.
  collapseThreshold: 4,
  collapseSeconds: 11,
  collapseSlamContact: 0.90,      // seconds into `collapse`, matches the model's own timing
  recoverSeconds: 1.7,
  /* A fresh collapse cannot retrigger inside this window even if a
     new leg breaks the instant it stands - the vulnerable window has
     to actually end before the next one can begin. */
  recollapseGuard: 2.5,

  /* A LOST LEG BUYS A WINDOW. Breaking one is the fight's unit of
     progress and it used to buy nothing but a poise kick: the slam
     that was winding up still landed, the next one started on time.
     Now every attack, the lunge and the stalk stop for this long, and
     a wind-up in flight is cancelled - a melee player who has just
     spent four seconds against a shin gets four seconds to keep
     going, which is what makes the leg fight a fight rather than a
     tax. Held through the collapse phase too, where it holds the bite. */
  legBreakStagger: 3.4,

  slamCadence: 4.4,
  slamContact: 0.90,
  /* THE LEG SLAM covers the animal's own FOOTPRINT now. At 9.5m it
     stopped short of the feet, which stand twelve metres out - so the
     one attack the standing phase throws at close range could not
     reach the one place a lance player stands, and once the legs were
     actually reachable the fight was free. 12.5m with the same
     falloff is 46 under the body and about 19 at a tarsus: the tell
     is 0.9s and a step outward is the answer, but there is a question
     to answer now. Ranged players in the hold band feel it too, at
     the same edge value they used to at 9m. */
  slamRadius: 12.5,
  slamDamage: 46,

  webCadence: 5.6,
  webContact: 0.78,
  webSpeed: 25,
  webDamage: 10,
  /* THE PIN. A web bolt HOLDS you now - it was a 0.34x slow, which on
     a trooper is a jog, and silk thrown to pin something that then
     jogs off is silk that missed. Rooted to the spot for the first
     window (aim, shoot, swing and Aegis all still work; the feet do
     not), then the strands drag for a moment more as they tear. */
  webRootSeconds: 2.4,
  webSlowFactor: 0.45,
  webSlowSeconds: 1.6,

  /* THE REEL. The second web: a line rather than a pin, thrown to
     HAUL. It lands, holds, and drags the trooper across the sand to
     the edge of the slam ring - and the slam is queued for the moment
     they arrive. The dodge is the same as the pin's (it is a bolt;
     step off its line) and the answer once hooked is Aegis for the
     slam that follows or a sprint out of the ring in the 0.9s tell.
     Faster than the pin bolt because it is thrown at range. */
  reelCadence: 12.5,
  reelContact: 0.78,
  reelSpeed: 34,
  reelMinRange: 14,
  reelMaxRange: 46,
  reelPreferRange: 28,     // beyond this a ready line beats a ready lunge
  reelPull: 16,            // m/s the line hauls at
  reelSeconds: 2.4,        // longest haul before the line parts
  reelStop: 8.5,           // haul ends here - the slam ring's own edge

  patchCadence: 7.5,
  patchRadius: 5.2,
  patchSeconds: 11,
  patchSlowFactor: 0.55,

  /* THE BITE, from the ground. It was 58 of a 150-point trooper every
     1.75s inside 6.8m of the body CENTRE with no facing test - which,
     against a collapsed body 3m across, is "every melee player, every
     bite, wherever they stand". It is thrown from the HEAD now, at
     what is in front of the head, and the collapsed animal turns too
     slowly to bring its mouth round on someone working its flank -
     so where you stand while it is down is the mechanic. */
  biteCadence: 2.6,
  biteContact: 0.50,
  biteReach: 5.4,          // from the head bone, not the centre
  biteArc: 1.15,           // rad, half-angle about the head's forward
  biteDamage: 40,

  // Simulated well past combat.js's own culling horizon: a landmark
  // this size has to keep fighting even if the player circles wide.
  simRange: 620,
});

const BOLT_MAX = 6;
const PATCH_MAX = 5;
const STAIN_MAX = 4;
const WEB_COLOUR = "#bff5ec";
const WEB_EDGE = "#3f8f92";
const WEB_BED = "#0c2624";

/* ============================================================
   THE DRESSING

   WHAT WAS WRONG. `saintfall-distaff.py` painted this animal out of
   `GLASS_RAMP` - the crater's own near-black teal - on the sound
   reasoning that a thing which came up out of vitrified sand should
   be cut from the same cloth as the sand. Photographed, it is a black
   cut-out. Measured across the gallery's five frames it carried a
   mean luminance of 22 against a Halo pool band of 31-92, a 99th
   percentile of 100 against a band of 130-234, and 0.007% blown
   pixels against 1.5%: eight metres of animal with not one specular
   hit on it anywhere. The art direction's answer is the opposite
   paint - "pale chalk-white chitin ... with glass fused into the
   shell, shards catching the sun along the leg tops and the carapace
   ridge" - and the whole of that is reachable from here, because
   COLOR_0 is data this module is allowed to rewrite.

   FIVE MATERIALS, ONE PROGRAM. `enemies.js` gives every species ONE
   material, shared by every instance of the caste, which is right for
   forty Threshers and wrong for the one thing in the district that is
   supposed to read as several materials at once. So the instance is
   re-dressed here: the geometry is de-indexed, every triangle is
   classified, and the index is rebuilt in five contiguous runs with a
   `geometry.groups` entry each - shell, leg, glass, belly, head.

   The five all take the SAME `rim`, `bio` and `glitter` numbers the
   bestiary entry already declares, and that is deliberate rather than
   lazy: `patchMaterial`'s cache key is built out of exactly those, so
   five materials with one set of numbers are five materials sharing
   ONE compiled program - the very program `enemies.js` compiled for
   the species. Five draw calls, no new shader compile, and therefore
   none of the 198ms freeze this project has already recorded once
   when a material had to be built at the moment a boss appeared.
   Everything that differs between the five is a uniform (family,
   roughness, metalness) or per-vertex (colour, and the emissive mask
   in COLOR_0's alpha).

   DE-INDEXED ON PURPOSE. 8,888 triangles become 26,664 vertices,
   which sounds like a cost and is the point: with the vertices shared
   there is no such thing as a per-FACET colour, and every tool below
   - the chalk-on-top ramp, the facet-to-facet value jitter, the glass
   shards, the silk at the joints, a broken leg going dark - is a
   per-facet tool. Faceting is this game's art direction (`enemies.js`)
   and a per-facet paint is the only paint that agrees with it. The
   extra 16k vertices are skinned once per frame on a frame that is
   fill-bound, not vertex-bound.
   ============================================================ */

/** sRGB hex to a LINEAR triple. COLOR_0 is linear per the glTF spec
 *  and the level's own vertex colours are linear too (enemies.js says
 *  so and says the exporter is the bug if it ever stops being true),
 *  so every colour below is authored in the only space a human can
 *  pick one in and converted exactly once, here. */
function lin(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

/* THE PALETTE, AND WHY IT LOOKS WRONG IN THE SOURCE.

   These read as ice blues. On screen the animal is a cold bone white,
   and the gap between those two facts is the whole reason the first
   two passes of this repaint failed.

   The Glass Scar at golden hour is lit almost entirely orange. Sampled
   off the render, the illumination reaching the animal is in the ratio
   R:G:B = 5.2 : 1.9 : 1.0 - better than two stops of warm bias between
   red and blue. A NEUTRAL chalk under that light is not chalk, it is
   sand: pass two painted the shell #8fa5a6, a barely-cool grey, and it
   photographed at (96, 68, 50) against a crater floor at (78, 51, 37).
   Same hue, same family, twelve metres of animal reading as terrain -
   which is precisely the failure the art-direction doc opens by
   calling non-negotiable.

   The albedo therefore has to carry the INVERSE of the light. Painted
   with roughly three times as much blue as red, the animal lands
   cool-neutral on screen while the sand beside it stays orange - two
   hue families in one frame, which is what Halo does with a blue-violet
   Hunter in a sand valley and what this frame did not have. Read these
   numbers as "what is left after the light has taken two stops of blue
   out of them", not as a colour anyone is meant to see.

   The same light is also why the animal cannot simply be made bright:
   with albedo 1.0 the brightest a diffuse facet here can be is
   (174, 110, 82), so the value range has to be bought inside that
   ceiling, and the only surfaces allowed past it are the glass shards
   and the eye cluster - which are EMISSIVE, and an emitter does not
   care what colour the sun is. That is why the cold accents on this
   animal are all bio-mask accents.

   The three-stop ramp is keyed on the facet's own up-vector, which is
   not decoration: chalk is DUST AND BLEACH, both of which are gravity
   stories. Up-faces are powdered and sun-bleached, down-faces keep the
   crater's own shadow, and everything else is the material itself.

   AND THE MID IS THE DOMINANT STOP, NOT THE LOW ONE. The first pass
   ramped LOW -> MID -> TOP on clamp01(n.y), which is correct for a
   plate and catastrophic for a leg: a near-vertical cylinder has
   n.y ~ 0 over almost its whole surface, so every one of the eight
   twelve-metre legs - two thirds of the animal's vertices and the
   entire first half of the fight - landed on the DARKEST stop and
   photographed as exactly the black stick it was before the repaint.
   The ramp is signed now. Sideways is the material; up and down are
   the two directions it departs in. */
/* The up-faces are the coolest paint on the animal and that is not a
   stylistic preference. What lights an upward facet here is the SKY,
   and this sky is the warmest light in the frame - the first pass
   painted the carapace dome a near-neutral pale and it photographed
   maroon. Nearly all of the red is taken out of the top stop so what
   comes back is bone. */
const CHALK_TOP = lin("#a6fbff");   // powdered, sun-bleached crest
const CHALK_MID = lin("#a8dcee");   // the DOMINANT value - flank and leg shaft
const CHALK_LOW = lin("#26404f");   // cold shadow, the crater showing through
const SILK_PALE = lin("#e8ffff");   // dried silk, the palest thing on the animal
const SILK_DULL = lin("#9ed2de");
const GLASS_DARK = lin("#123840");  // fused shard, seen against the light
const GLASS_LIT = lin("#69c9c2");   // the same shard with the sun in it
/* THE UNDERSIDE WAS A HOLE PUNCHED IN THE FRAME, not a body part.
   Read blind, the critic named it twice: "the pedicel/spinneret mass
   is pure unlit black with a hard silhouette while the mound
   centimetres away is fully lit", and "a hard-edged black plane
   cutting through the abdomen with no shading and no occlusion".

   The mechanism is the same one the palette note above already
   records, running the other way. A down-facing facet on this planet
   is lit by the GROUND BOUNCE and by nothing else, and the Glass
   Scar's floor is vitrified dark blue-grey - so a facet at
   nrm.y < -0.22 receives almost no light at all, whatever it is
   painted, and the darkest paint on the animal was sitting exactly
   there. Raised two stops, and given real emission of its own below:
   this is the Abbess's lesson (a mass that dark needs light of its
   own, not a brighter grade) applied to the one part of this animal
   that has the fiction to justify it - wet, unarmoured, warm. */
const BELLY_SOFT = lin("#8f5f56");  // unarmoured, wet, and the only warm thing here
const BELLY_HOT = lin("#cf7f6d");
const FOOT_WORN = lin("#414a4d");
const ICHOR_DARK = lin("#2a1416");  // a leg that is gone
const ICHOR_WET = lin("#7d2a26");   // the fracture itself, still wet

/* Which bone owns which kind of surface. Read off the rig by NAME,
   the same convention `enemies.js` gathers the leg chains by, so this
   survives a re-export as long as the naming does - and the naming is
   the thing the whole solver already depends on. */
/* `spinneret` USED TO BE IN HERE and it was wrong twice over. It is
   at the rear tip of the gaster, nine metres from the mouth, so
   filing it under "head" gave the animal's back end the head's own
   0.82 value knock-down - and a critic reading blind picked exactly
   that mass out as "pure unlit black with a hard silhouette". It is
   glandular, it carries its own authored glow in COLOR_0's alpha, and
   the alpha branch below already knows what to do with that. */
const HEAD_BONES = new Set(["head", "fang_L", "fang_R", "palp_L", "palp_R"]);
const LEG_PREFIX = ["coxa", "femur", "tibia", "foot"];

/* Per-segment value on a leg, and this is the "accent language" the
   art direction asks for stated as four numbers: a lot of the
   neutral, a little of the bright, in a pattern that repeats eight
   times across the animal. The coxa is buried in the body's own
   shadow, the femur is the dominant read, the tibia is the sun-catcher
   the glass collects on, and the toe is worn back to bare shell by
   standing in a glass crater. */
const SEGMENT_VALUE = { coxa: 0.52, femur: 1.0, tibia: 1.16, foot: 0.66 };

/** Six surfaces, in the order their materials sit in the array that
 *  is handed to the mesh - so a group's material index IS its part.
 *
 *  BRISTLE is the newest and it exists for a hard tell rather than
 *  for a look. `saintfall-distaff.py` builds every bristle, claw,
 *  palp and fang with `spike(..., cap_end=False)` - an OPEN tube - and
 *  a front-side material draws nothing where the interior faces the
 *  lens. Blind, that came back as "mouth palps are no-thickness quads
 *  that flip to nothing at grazing angles ... cheap to fix, and it is
 *  a hard tell". It is cheap: one more material, drawn DoubleSide,
 *  holding about 1,400 of the animal's 8,888 triangles - all of them
 *  spikes a few centimetres wide, so the doubled fill is nothing. */
const PART = { SHELL: 0, LEG: 1, GLASS: 2, BELLY: 3, HEAD: 4, BRISTLE: 5 };
const PART_COUNT = 6;

/* A cheap integer hash over a quantised point. Deliberately NOT a
   smooth noise: what is wanted is a value that is CONSTANT over a
   facet and uncorrelated with its neighbours, because the facet edge
   is the detail. A smooth field sampled per facet would give a soft
   gradient across the shell, which is the flat look being fixed. */
function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393)
    ^ Math.imul(y | 0, 668265263)
    ^ Math.imul(z | 0, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ============================================================
   BAKED OCCLUSION

   THE NOTE THIS ANSWERS. A hostile critic reading the gallery blind
   said, twice and in two different frames: "zero cavity darkening
   where any leg meets the body, and adjacent facets butt at identical
   brightness, so the entire animal reads as one continuous shell with
   no anatomy". Both halves of that are true and both have the same
   cause - nothing in this animal's paint knows that anything else on
   it is standing in the way of the sky.

   WHY THE SURFACE KIT CANNOT DO IT. `boss-surface.js` has a cavity
   term and it is a good one, but it is driven by the kit's own
   sub-facet HEIGHT FIELD - it darkens the troughs of a two-centimetre
   grain. It knows nothing about the animal's shape, because a
   fragment shader with no ray budget cannot know that a coxa has a
   two-metre body sitting over it. Occlusion at THAT scale is a
   property of the model, so it is baked into the model, once, at
   spawn.

   HOW. Point-based occlusion, the Bunnell form: every triangle is an
   emitter disc carrying its own area and normal, and a sample point
   accumulates how much of its hemisphere those discs cover. Two
   levels, because the two things being asked for live two orders of
   magnitude apart:

     fine    0.6 m buckets, 1.2 m reach - the crease where a femur
             enters its trochanter, the gap between two adjacent leg
             shafts, the inside of the mouth.
     coarse  2.5 m proxies, 7.5 m reach - the fact that there is a
             nine-metre body directly above the coxae and a swollen
             gaster hanging over the spinnerets.

   The coarse level's contribution is faded IN over 1.2-2.6 m so the
   two do not both count the same neighbour.

   SAMPLED PER VERTEX, NOT PER FACET, and that is the half that
   answers "adjacent facets butt at identical brightness". A per-facet
   number is one more flat value on a flat facet; evaluating at the
   three CORNERS puts a gradient across every triangle and makes the
   shared edge between two of them a place where two gradients meet at
   different slopes. That is what a seam looks like.

   IT IS EVALUATED ON THE SOURCE, INDEXED GEOMETRY. The dressing
   de-indexes 8,888 triangles into 26,664 vertices; sampling those
   would pay three or four times over for corners that share a
   position. `toNonIndexed` preserves order exactly - new vertex i is
   source vertex index[i] - so the bake runs on the source's own
   vertex list and is read back through that same index.

   AND IT IS MEAN-PRESERVING, WHICH IS NOT A DETAIL. The same critic
   said the frames are already too dark - "the entire left half
   carries no information", 5th percentile at 7/255. An occlusion pass
   that only multiplies down would buy anatomy and pay for it in the
   one currency this boss has none of. So the shade is
   `1 + gain * (ao - mean(ao))`: the creases go down, the exposed
   plate goes UP by as much, and the animal's mean albedo is exactly
   what it was. Occlusion here is contrast, not exposure.
   ============================================================ */

/** A CSR bucket grid. Flat typed arrays rather than a Map because the
 *  inner loop is 125 to 343 cell lookups per sample and a string or
 *  object key there is the whole cost of the bake. */
function bucketGrid(px, py, pz, count, cell, lo, dim) {
  const cells = dim[0] * dim[1] * dim[2];
  const start = new Int32Array(cells + 1);
  const cellOf = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const ix = clamp(Math.floor((px[i] - lo[0]) / cell), 0, dim[0] - 1);
    const iy = clamp(Math.floor((py[i] - lo[1]) / cell), 0, dim[1] - 1);
    const iz = clamp(Math.floor((pz[i] - lo[2]) / cell), 0, dim[2] - 1);
    const c = (iz * dim[1] + iy) * dim[0] + ix;
    cellOf[i] = c;
    start[c + 1] += 1;
  }
  for (let c = 0; c < cells; c += 1) start[c + 1] += start[c];
  const items = new Int32Array(count);
  const cursor = start.slice(0, cells);
  for (let i = 0; i < count; i += 1) {
    const c = cellOf[i];
    items[cursor[c]] = i;
    cursor[c] += 1;
  }
  return { start, items, dim, cell, lo };
}

const AO_FINE_CELL = 0.60;
const AO_FINE_REACH = 1.20;
const AO_COARSE_CELL = 2.50;
const AO_COARSE_REACH = 7.50;

/**
 * Bake per-vertex occlusion shade for one creature.
 *
 * @param {Float32Array|ArrayLike<number>} sp   sample positions, xyz interleaved
 * @param {ArrayLike<number>} sn                sample normals, xyz interleaved
 * @param {number} sampleCount
 * @param {Float64Array} fc  facet centroids, xyz interleaved
 * @param {Float64Array} fn  facet normals, xyz interleaved
 * @param {Float64Array} fa  facet areas
 * @param {number} triCount
 * @param {number} gain      how much contrast to buy. 0 is a no-op.
 * @returns {Float32Array}   one albedo multiplier per sample, mean 1.0
 */
function bakeOcclusion(sp, sn, sampleCount, fc, fn, fa, triCount, gain = 1.0) {
  const shade = new Float32Array(sampleCount).fill(1);
  if (!triCount || !sampleCount) return shade;

  /* Bounds over the facets AND the samples: a vertex outside the
     facet cloud's box would clamp into an edge cell and collect that
     cell's occluders as if it were standing in them. */
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = fc[t * 3 + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  for (let k = 0; k < 3; k += 1) { lo[k] -= 0.5; hi[k] += 0.5; }

  const fcx = new Float64Array(triCount);
  const fcy = new Float64Array(triCount);
  const fcz = new Float64Array(triCount);
  for (let t = 0; t < triCount; t += 1) {
    fcx[t] = fc[t * 3];
    fcy[t] = fc[t * 3 + 1];
    fcz[t] = fc[t * 3 + 2];
  }

  const dimOf = (cell) => [
    Math.max(1, Math.ceil((hi[0] - lo[0]) / cell)),
    Math.max(1, Math.ceil((hi[1] - lo[1]) / cell)),
    Math.max(1, Math.ceil((hi[2] - lo[2]) / cell)),
  ];

  const fineDim = dimOf(AO_FINE_CELL);
  const fine = bucketGrid(fcx, fcy, fcz, triCount, AO_FINE_CELL, lo, fineDim);

  /* The coarse level is PROXIES, not facets: every 2.5 m cell is
     collapsed to one area-weighted disc. A body is a few hundred of
     those instead of eight thousand triangles, and at seven metres
     the difference is invisible. */
  const coarseDim = dimOf(AO_COARSE_CELL);
  const coarseCells = coarseDim[0] * coarseDim[1] * coarseDim[2];
  const pxs = new Float64Array(coarseCells);
  const pys = new Float64Array(coarseCells);
  const pzs = new Float64Array(coarseCells);
  const pnx = new Float64Array(coarseCells);
  const pny = new Float64Array(coarseCells);
  const pnz = new Float64Array(coarseCells);
  const par = new Float64Array(coarseCells);
  for (let t = 0; t < triCount; t += 1) {
    const ix = clamp(Math.floor((fcx[t] - lo[0]) / AO_COARSE_CELL), 0, coarseDim[0] - 1);
    const iy = clamp(Math.floor((fcy[t] - lo[1]) / AO_COARSE_CELL), 0, coarseDim[1] - 1);
    const iz = clamp(Math.floor((fcz[t] - lo[2]) / AO_COARSE_CELL), 0, coarseDim[2] - 1);
    const c = (iz * coarseDim[1] + iy) * coarseDim[0] + ix;
    const a = fa[t];
    par[c] += a;
    pxs[c] += fcx[t] * a; pys[c] += fcy[t] * a; pzs[c] += fcz[t] * a;
    pnx[c] += fn[t * 3] * a; pny[c] += fn[t * 3 + 1] * a; pnz[c] += fn[t * 3 + 2] * a;
  }
  let proxyCount = 0;
  for (let c = 0; c < coarseCells; c += 1) {
    if (par[c] <= 0) continue;
    const inv = 1 / par[c];
    pxs[proxyCount] = pxs[c] * inv;
    pys[proxyCount] = pys[c] * inv;
    pzs[proxyCount] = pzs[c] * inv;
    const nl = Math.hypot(pnx[c], pny[c], pnz[c]) || 1;
    pnx[proxyCount] = pnx[c] / nl;
    pny[proxyCount] = pny[c] / nl;
    pnz[proxyCount] = pnz[c] / nl;
    par[proxyCount] = par[c];
    proxyCount += 1;
  }
  const coarse = bucketGrid(pxs, pys, pzs, proxyCount, AO_COARSE_CELL, lo, coarseDim);

  const fineSpan = Math.ceil(AO_FINE_REACH / AO_FINE_CELL);
  const coarseSpan = Math.ceil(AO_COARSE_REACH / AO_COARSE_CELL);
  const fineR2 = AO_FINE_REACH * AO_FINE_REACH;
  const coarseR2 = AO_COARSE_REACH * AO_COARSE_REACH;

  const ao = new Float32Array(sampleCount);
  let mean = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const x = sp[i * 3];
    const y = sp[i * 3 + 1];
    const z = sp[i * 3 + 2];
    let nx = sn[i * 3];
    let ny = sn[i * 3 + 1];
    let nz = sn[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    let occ = 0;

    const bx = clamp(Math.floor((x - lo[0]) / AO_FINE_CELL), 0, fineDim[0] - 1);
    const by = clamp(Math.floor((y - lo[1]) / AO_FINE_CELL), 0, fineDim[1] - 1);
    const bz = clamp(Math.floor((z - lo[2]) / AO_FINE_CELL), 0, fineDim[2] - 1);
    for (let cz = Math.max(0, bz - fineSpan); cz <= Math.min(fineDim[2] - 1, bz + fineSpan); cz += 1) {
      for (let cy = Math.max(0, by - fineSpan); cy <= Math.min(fineDim[1] - 1, by + fineSpan); cy += 1) {
        const row = (cz * fineDim[1] + cy) * fineDim[0];
        const x0 = Math.max(0, bx - fineSpan);
        const x1 = Math.min(fineDim[0] - 1, bx + fineSpan);
        const from = fine.start[row + x0];
        const to = fine.start[row + x1 + 1];
        for (let k = from; k < to; k += 1) {
          const t = fine.items[k];
          const dx = fcx[t] - x;
          const dy = fcy[t] - y;
          const dz = fcz[t] - z;
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 > fineR2 || r2 < 1e-8) continue;
          const r = Math.sqrt(r2);
          const ux = dx / r; const uy = dy / r; const uz = dz / r;
          const recv = nx * ux + ny * uy + nz * uz;
          if (recv <= 0) continue;
          const emit = -(fn[t * 3] * ux + fn[t * 3 + 1] * uy + fn[t * 3 + 2] * uz);
          if (emit <= 0) continue;
          occ += (fa[t] * recv * emit) / (Math.PI * r2 + fa[t]);
        }
      }
    }

    const gx = clamp(Math.floor((x - lo[0]) / AO_COARSE_CELL), 0, coarseDim[0] - 1);
    const gy = clamp(Math.floor((y - lo[1]) / AO_COARSE_CELL), 0, coarseDim[1] - 1);
    const gz = clamp(Math.floor((z - lo[2]) / AO_COARSE_CELL), 0, coarseDim[2] - 1);
    for (let cz = Math.max(0, gz - coarseSpan);
      cz <= Math.min(coarseDim[2] - 1, gz + coarseSpan); cz += 1) {
      for (let cy = Math.max(0, gy - coarseSpan);
        cy <= Math.min(coarseDim[1] - 1, gy + coarseSpan); cy += 1) {
        const row = (cz * coarseDim[1] + cy) * coarseDim[0];
        const x0 = Math.max(0, gx - coarseSpan);
        const x1 = Math.min(coarseDim[0] - 1, gx + coarseSpan);
        const from = coarse.start[row + x0];
        const to = coarse.start[row + x1 + 1];
        for (let k = from; k < to; k += 1) {
          const p = coarse.items[k];
          const dx = pxs[p] - x;
          const dy = pys[p] - y;
          const dz = pzs[p] - z;
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 > coarseR2 || r2 < 1e-8) continue;
          const r = Math.sqrt(r2);
          // Faded in past where the fine level stops, so one occluder
          // is never counted by both.
          const w = sstep(1.2, 2.6, r);
          if (w <= 0) continue;
          const ux = dx / r; const uy = dy / r; const uz = dz / r;
          const recv = nx * ux + ny * uy + nz * uz;
          if (recv <= 0) continue;
          const emit = -(pnx[p] * ux + pny[p] * uy + pnz[p] * uz);
          if (emit <= 0) continue;
          occ += w * (par[p] * recv * emit) / (Math.PI * r2 + par[p]);
        }
      }
    }

    const v = clamp01(1 - occ);
    ao[i] = v;
    mean += v;
  }
  mean /= sampleCount;

  /* Mean-preserving, per the header: the creases go down and the
     exposed plate goes up by the same amount, so nothing here makes
     an already-dark frame darker. */
  for (let i = 0; i < sampleCount; i += 1) {
    shade[i] = clamp(1 + gain * (ao[i] - mean), 0.28, 1.55);
  }
  return shade;
}

export function buildDistaff(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = DISTAFF_CONFIG;
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "distaff-web";
  scene.add(group);

  const state = {
    phase: "dormant",       // dormant, alert, standing, collapsed, recovering, returning, dead
    timer: 0,
    legsAtLastCollapse: 0,
    slamTimer: C.slamCadence * 0.55,
    webTimer: C.webCadence * 0.7,
    patchTimer: C.patchCadence * 0.5,
    action: 0,
    actionKind: null,
    pending: 0,
    recollapseFor: 0,
    disengageFor: 0,
    defeated: false,
    biteTimer: 0,
    releaseCameraAt: undefined,
    // Read off the instance's own leg pool at spawn, since
    // DISTAFF_CONFIG is frozen and cannot carry it - see resetToLair.
    legHealthRef: 340,
    /* The reveal camera plays once per encounter, not once per
       re-aggro: a player who has already been shown the animal is
       mid-fight, and stealing the camera again is a punishment. A
       full reset (walking home, or the hard QA reset) re-arms it. */
    revealed: false,
    // Locomotion.
    lungeFor: 0,
    lungeTimer: C.lungeCadence * 0.6,
    lungeYaw: 0,
    strafeDir: 1,
    footfallGap: 0,
    // A leg just went; nothing is thrown until this runs out.
    staggerFor: 0,
    // The reel: its cadence, and the haul in progress (null when none).
    reelTimer: C.reelCadence * 0.45,
    reel: null,
    /* WEIGHT. `drop` is the collapse sink, animated slowly because a
       nine-metre body coming down is not a snap; `poise` is the fast
       spring underneath it - the rear before a slam, the compression
       after it, the buckle when a leg goes. They are summed into
       `inst.bodyDrop` rather than fighting over it. */
    drop: 0,
    poise: 0,
    poiseVel: 0,
    // The abdomen's lag, in the animal's own frame. See stepSway.
    swayX: 0,
    swayZ: 0,
    swayVX: 0,
    swayVZ: 0,
    lastX: 0,
    lastZ: 0,
    lastVX: 0,
    lastVZ: 0,
  };
  let inst = null;

  /** Dormant district bosses remain spawned so their rig, save id and
   *  performance footprint are stable, but are neither rendered nor
   *  targetable. Alert reveals the figure while retaining the damage
   *  lock; the fight clears both gates when it hands control back.
   *  `root.visible` is written immediately because enemies.js already
   *  ran earlier in the frame that detects the arena crossing. */
  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = !inst.encounterHidden;
  }

  /* Last known plant per leg, for footfall detection - the solver
     replants feet on its own schedule and this module just watches
     for the moment each one lands. */
  const plantMemo = [];

  /* ============================================================
     THE DRESSING, part two: the code. See the header block above for
     why any of this exists.
     ============================================================ */

  /** Everything the repaint produced, or null until the animal has
   *  been spawned and dressed. One instance, one dressing. */
  let dress = null;

  function makeSurfaceMaterial(name, family, roughness, metalness, extra = {}) {
    const spec = inst.spec.material;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      /* Faceted, like everything in SAINTFALL above the sand. The
         whole paint below is per-facet and would be averaged away by
         a smooth normal. */
      flatShading: true,
      roughness,
      metalness,
    });
    mat.name = `sf-distaff-${name}`;
    /* `rim`, `bio` and `glitter` are taken from the bestiary entry
       UNCHANGED and identically across all five - that is what makes
       the five share one program. Anything this module wants to vary
       is varied through a uniform or through COLOR_0. */
    applySurface(mat, atmos, family, {
      rim: spec.rim,
      glitter: 0,
      bio: spec.bio ?? 0,
      scale: inst.spec.scale ?? 1,
      ...extra,
    });
    return mat;
  }

  /**
   * Rebuild this instance's geometry and materials.
   *
   * Runs ONCE, at spawn, and never again - it is a few milliseconds of
   * load-time work on 8,888 triangles and nothing per frame. The
   * source geometry and the species material are left exactly as they
   * were: this makes its own copies, so a second Distaff (there is
   * never one, but the loader does not know that) would still get the
   * bestiary's shared surface rather than a half-shared mutant.
   */
  function dressInstance() {
    if (!inst || dress) return;
    const skin = inst.skin;
    if (!skin || !skin.geometry || !skin.skeleton) return;

    const src = skin.geometry;
    /* toNonIndexed returns a NEW geometry and leaves the source
       alone; with no index it would return the source itself, which
       is the one case that must be cloned instead or the species
       geometry gets repainted for everybody. */
    const geo = src.index ? src.toNonIndexed() : src.clone();
    const posAttr = geo.attributes.position;
    const skinIndexAttr = geo.attributes.skinIndex;
    const skinWeightAttr = geo.attributes.skinWeight;
    const srcColour = geo.attributes.color;
    if (!posAttr || !skinIndexAttr || !skinWeightAttr || !srcColour) {
      console.warn("[saintfall] the Distaff is missing an attribute the dressing needs; "
        + "leaving it in the bestiary's shared surface");
      return;
    }

    const vertexCount = posAttr.count;
    const triCount = Math.floor(vertexCount / 3);
    const bones = skin.skeleton.bones;

    /* ------------------------------------------------------------
       INSIDE OUT. The asset arrives wound clockwise-outward: its
       signed volume is -289 m^3 (a closed outward surface is positive
       - a THREE.BoxGeometry measures +1). Every material here is
       FrontSide, so the GPU culls the NEAR wall of the body and draws
       the far wall's INTERIOR in its place. From thirty metres, flat
       shading (normals from screen derivatives) and an unchanged
       silhouette make that read as a solid animal; from six metres,
       standing beside the collapsed body, it is a hole through the
       carapace with the legs behind it showing - which is exactly how
       it was reported. The authored NORMALS agree with the winding, so
       they point inward too, and the paint below - which classifies
       "up" and "belly" by facet normal - had chalk on the underside
       and the warm belly on the inside of the top plates.

       Fixed here, on this module's own copy of the geometry, in two
       halves: the authored normals are negated NOW, before a single
       facet is classified, so the paint keys on the outward plate;
       and the winding is reversed when the index is rebuilt below,
       so the GPU keeps the outward faces. Detected rather than
       assumed - a re-export that fixes the kit's winding must not
       be flipped back inside out by this. See the milestone note:
       the rest of the rigged bestiary measures the same way. */
    let insideOut = false;
    {
      let volume = 0;
      for (let t = 0; t < triCount; t += 1) {
        const v0 = t * 3;
        const ax0 = posAttr.getX(v0), ay0 = posAttr.getY(v0), az0 = posAttr.getZ(v0);
        const bx0 = posAttr.getX(v0 + 1), by0 = posAttr.getY(v0 + 1), bz0 = posAttr.getZ(v0 + 1);
        const cx0 = posAttr.getX(v0 + 2), cy0 = posAttr.getY(v0 + 2), cz0 = posAttr.getZ(v0 + 2);
        volume += ax0 * (by0 * cz0 - bz0 * cy0)
          + ay0 * (bz0 * cx0 - bx0 * cz0)
          + az0 * (bx0 * cy0 - by0 * cx0);
      }
      insideOut = volume < 0;
      const nrmAttr = geo.attributes.normal;
      if (insideOut && nrmAttr) {
        for (let i = 0; i < nrmAttr.count; i += 1) {
          nrmAttr.setXYZ(i, -nrmAttr.getX(i), -nrmAttr.getY(i), -nrmAttr.getZ(i));
        }
        nrmAttr.needsUpdate = true;
      }
    }

    /* The authored COLOR_0, read through the attribute accessors so a
       normalised byte buffer and a float buffer both arrive as 0..1,
       and written back as our own float array. Owning the array is
       what makes a broken leg a buffer write rather than a shader. */
    const colour = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      colour[i * 4] = srcColour.getX(i);
      colour[i * 4 + 1] = srcColour.getY(i);
      colour[i * 4 + 2] = srcColour.getZ(i);
      colour[i * 4 + 3] = srcColour.itemSize > 3 ? srcColour.getW(i) : 1;
    }

    /* Per vertex: which bone owns it, and whether it sits in a
       SKINNING BLEND ZONE. The blend zone is not an approximation of
       where the joints are - it IS where the joints are, because a
       vertex only takes weight from two bones where two bones meet.
       That is where the art direction wants dried silk wrapped, and
       the rig hands it over for free. */
    const boneOf = new Int16Array(vertexCount);
    const boneWeight = new Float32Array(vertexCount);
    const jointness = new Float32Array(vertexCount);
    for (let i = 0; i < vertexCount; i += 1) {
      const j = [skinIndexAttr.getX(i), skinIndexAttr.getY(i),
        skinIndexAttr.getZ(i), skinIndexAttr.getW(i)];
      const w = [skinWeightAttr.getX(i), skinWeightAttr.getY(i),
        skinWeightAttr.getZ(i), skinWeightAttr.getW(i)];
      let best = 0;
      let bestW = -1;
      let secondW = 0;
      for (let k = 0; k < 4; k += 1) {
        if (w[k] > bestW) { secondW = bestW; bestW = w[k]; best = j[k]; }
        else if (w[k] > secondW) secondW = w[k];
      }
      boneOf[i] = best;
      boneWeight[i] = Math.max(0, bestW);
      jointness[i] = Math.max(0, secondW);
    }

    const partOf = new Uint8Array(triCount);
    const legOf = new Int8Array(triCount).fill(-1);
    const segOf = new Int8Array(triCount).fill(-1);
    const counts = new Uint32Array(PART_COUNT);

    const ax = new Float64Array(3);
    const bx = new Float64Array(3);
    const cx = new Float64Array(3);
    const nrm = new Float64Array(3);
    const rgb = new Float64Array(3);

    /* ------------------------------------------------------------
       PASS A. Everything that is a FACT about a facet - where it is,
       which way it faces, how big it is, which bone owns it - taken
       once. It used to be computed inline in the paint loop, which
       was fine when the paint was the only reader; the occlusion bake
       and the limb frames below both need the same numbers before a
       single facet is painted, and computing them three times on
       8,888 triangles is three times the load hitch for nothing.
       ------------------------------------------------------------ */
    const facetC = new Float64Array(triCount * 3);
    const facetN = new Float64Array(triCount * 3);
    const facetA = new Float64Array(triCount);
    const facetBone = new Int16Array(triCount);
    const facetJoint = new Float32Array(triCount);
    const facetAlpha = new Float32Array(triCount);
    const authoredN = geo.attributes.normal;

    for (let t = 0; t < triCount; t += 1) {
      const v0 = t * 3;
      ax[0] = posAttr.getX(v0); ax[1] = posAttr.getY(v0); ax[2] = posAttr.getZ(v0);
      bx[0] = posAttr.getX(v0 + 1); bx[1] = posAttr.getY(v0 + 1); bx[2] = posAttr.getZ(v0 + 1);
      cx[0] = posAttr.getX(v0 + 2); cx[1] = posAttr.getY(v0 + 2); cx[2] = posAttr.getZ(v0 + 2);

      /* The facet's OWN normal, taken from its three corners. The
         NORMAL attribute is the authored smooth one and on a shell
         this faceted it points somewhere between three plates; the
         paint below is a per-plate paint and has to key on the plate.
         Winding is checked against the authored normal rather than
         assumed, because a mirrored limb comes out of Blender with
         its winding flipped and half the animal would then be painted
         upside down - dark on top, chalk underneath. */
      const e1x = bx[0] - ax[0], e1y = bx[1] - ax[1], e1z = bx[2] - ax[2];
      const e2x = cx[0] - ax[0], e2y = cx[1] - ax[1], e2z = cx[2] - ax[2];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const cross = Math.hypot(nx, ny, nz);
      const nlen = cross || 1;
      nx /= nlen; ny /= nlen; nz /= nlen;
      if (authoredN) {
        const dot = nx * authoredN.getX(v0) + ny * authoredN.getY(v0)
          + nz * authoredN.getZ(v0);
        if (dot < 0) { nx = -nx; ny = -ny; nz = -nz; }
      }
      facetN[t * 3] = nx; facetN[t * 3 + 1] = ny; facetN[t * 3 + 2] = nz;
      facetA[t] = cross * 0.5;
      facetC[t * 3] = (ax[0] + bx[0] + cx[0]) / 3;
      facetC[t * 3 + 1] = (ax[1] + bx[1] + cx[1]) / 3;
      facetC[t * 3 + 2] = (ax[2] + bx[2] + cx[2]) / 3;

      /* One dominant bone for the whole facet: the corner with the
         strongest single weight decides. Averaging bone indices would
         be meaningless (they are labels, not numbers). */
      let bone = boneOf[v0];
      let boneVote = boneWeight[v0];
      let jn = 0;
      let alphaMax = 0;
      for (let k = 0; k < 3; k += 1) {
        if (boneWeight[v0 + k] > boneVote) {
          boneVote = boneWeight[v0 + k];
          bone = boneOf[v0 + k];
        }
        jn = Math.max(jn, jointness[v0 + k]);
        alphaMax = Math.max(alphaMax, colour[(v0 + k) * 4 + 3]);
      }
      facetBone[t] = bone;
      facetJoint[t] = jn;
      facetAlpha[t] = alphaMax;
    }

    /* ------------------------------------------------------------
       THE LIMB FRAME, and the defect it answers.

       Blind, the critic said: "each femur is a single flat plane with
       a specular stripe running unbroken end to end and a hard crease
       where the ribbon turns; joints are dark dashes painted on a flat
       strip rather than modelled cavity. Give segments a real
       cross-section."

       Half of that is a misreading and the other half is exactly
       right, and the difference decides what to build. The geometry
       IS a real cross-section already - `saintfall-distaff.py` builds
       every femur as `kit.tube(..., sides=9, profile=flutes(9,0.055))`
       and every tibia at eight sides. Nine facets around a shaft is
       twice what the note asks for. What was missing is that all nine
       were painted the SAME VALUE: the chalk ramp keys on the facet's
       world up-vector, and on a leg shaft carried nearly vertical
       every facet on the ring has n.y ~ 0 and lands on one stop. So a
       nine-sided tube arrived at the lens as one value with a
       lighting gradient over it, which is precisely what a folded
       ribbon looks like.

       The fix is a value that keys on the shaft's OWN frame rather
       than on the world's: for every leg facet, where it sits along
       the bone and which way it faces AROUND the bone. Then the
       underside of every segment is dark, the flank is the material,
       and the dorsal line is chalk - which is what makes a cylinder
       read as a cylinder from any angle and in any light, and it is
       also where the art direction wants the fused glass ("shards
       catching the sun along the leg tops").

       THE AXIS COMES OFF THE SKELETON'S BIND MATRICES, not off the
       live bones: this runs once, at spawn, on bind-pose vertices,
       and the live pose has no business in a paint that is glued to
       the shell. `boneInverses[b]` is the inverse bind matrix, so its
       inverse is the bone's own bind placement in exactly the space
       `position` is in.
       ------------------------------------------------------------ */
    const bindPos = new Map();
    {
      const m4 = new THREE.Matrix4();
      const v3 = new THREE.Vector3();
      for (let b = 0; b < bones.length; b += 1) {
        const inv = skin.skeleton.boneInverses[b];
        if (!inv) continue;
        m4.copy(inv).invert();
        v3.setFromMatrixPosition(m4);
        bindPos.set(bones[b].name, [v3.x, v3.y, v3.z]);
      }
    }

    const LEG_NAME = /^(coxa|femur|tibia|foot)(\d+)_(L|R)$/;

    /** The shaft frame for one leg bone, or null if the rig does not
     *  give us one (in which case the paint simply falls back to the
     *  world-up ramp it always used). */
    function limbFrame(name) {
      const m = LEG_NAME.exec(name);
      if (!m) return null;
      const seg = LEG_PREFIX.indexOf(m[1]);
      const here = bindPos.get(name);
      /* Every segment is aimed at its own child; the tarsus has none,
         so it borrows the tibia's heading and runs the other way. */
      const other = bindPos.get(seg < 3
        ? `${LEG_PREFIX[seg + 1]}${m[2]}_${m[3]}`
        : `tibia${m[2]}_${m[3]}`);
      if (!here || !other) return null;
      let dx = other[0] - here[0];
      let dy = other[1] - here[1];
      let dz = other[2] - here[2];
      if (seg === 3) { dx = -dx; dy = -dy; dz = -dz; }
      const len = Math.hypot(dx, dy, dz);
      if (!(len > 1e-3)) return null;
      dx /= len; dy /= len; dz /= len;
      const sign = m[3] === "L" ? 1 : -1;
      /* A reference "up" at right angles to the shaft. It DEGENERATES
         on a near-vertical tibia - world up projected off a vertical
         axis is zero - and a normalised zero would have painted four
         legs out of eight from a random direction. Where it collapses,
         the meaningful cross-section direction is inboard/outboard
         instead, which is the axis the body actually sits on. */
      let rx = -dx * dy;
      let ry = 1 - dy * dy;
      let rz = -dz * dy;
      let rl = Math.hypot(rx, ry, rz);
      if (rl < 0.34) {
        const d = dx * sign;
        rx = sign - dx * d; ry = -dy * d; rz = -dz * d;
        rl = Math.hypot(rx, ry, rz);
      }
      if (!(rl > 1e-4)) return null;
      return {
        seg, sign, len,
        ox: here[0], oy: here[1], oz: here[2],
        ax: dx, ay: dy, az: dz,
        rx: rx / rl, ry: ry / rl, rz: rz / rl,
        radius: 0.5, samples: [],
      };
    }

    const limbs = new Map();
    for (const bone of bones) {
      if (!LEG_NAME.test(bone.name)) continue;
      const frame = limbFrame(bone.name);
      if (frame) limbs.set(bone.name, frame);
    }

    /* Per-facet shaft coordinates, and the shaft radius measured
       rather than assumed. The bristles are the reason: they are
       `spike()` tubes hung OFF the shaft, they belong to the same
       bone, and the only thing that separates them from the shaft
       itself is that they stand further out from the axis. A median
       is the right statistic for that - the shaft is most of the
       triangles by construction, so the median IS the shaft radius,
       and no bristle count or leg thickness has to be hard-coded. */
    const facetT = new Float32Array(triCount);
    const facetUp = new Float32Array(triCount);
    const facetRad = new Float32Array(triCount);
    for (let t = 0; t < triCount; t += 1) {
      const f = limbs.get(bones[facetBone[t]] ? bones[facetBone[t]].name : "");
      if (!f) { facetRad[t] = -1; continue; }
      const dx = facetC[t * 3] - f.ox;
      const dy = facetC[t * 3 + 1] - f.oy;
      const dz = facetC[t * 3 + 2] - f.oz;
      const along = dx * f.ax + dy * f.ay + dz * f.az;
      const px2 = dx - f.ax * along;
      const py2 = dy - f.ay * along;
      const pz2 = dz - f.az * along;
      const rad = Math.hypot(px2, py2, pz2);
      facetT[t] = clamp01(along / f.len);
      facetRad[t] = rad;
      f.samples.push(rad);
      const nA = facetN[t * 3] * f.ax + facetN[t * 3 + 1] * f.ay + facetN[t * 3 + 2] * f.az;
      let ux = facetN[t * 3] - f.ax * nA;
      let uy = facetN[t * 3 + 1] - f.ay * nA;
      let uz = facetN[t * 3 + 2] - f.az * nA;
      const ul = Math.hypot(ux, uy, uz);
      if (ul > 1e-4) { ux /= ul; uy /= ul; uz /= ul; }
      facetUp[t] = ul > 1e-4 ? (ux * f.rx + uy * f.ry + uz * f.rz) : 0;
    }
    for (const f of limbs.values()) {
      if (!f.samples.length) continue;
      f.samples.sort((p, q) => p - q);
      f.radius = f.samples[Math.floor(f.samples.length * 0.5)];
      f.samples.length = 0;
      /* A safety rail, not a tuning knob. If the bind matrices ever
         stop agreeing with the vertex data - a re-export with a
         non-identity bind transform would do it - every radius here
         comes back in the tens of metres and the cross-section ramp
         would paint garbage. Better to fall back silently to the
         world-up ramp that shipped than to ship a striped animal. */
      if (!(f.radius > 0.02 && f.radius < 2.4)) f.radius = -1;
    }

    /* ------------------------------------------------------------
       PASS A2. The occlusion bake. See the header block above
       `bucketGrid` for the method and for why it is mean-preserving.
       ------------------------------------------------------------ */
    const srcPos = src.attributes.position;
    const srcNrm = src.attributes.normal;
    let aoShade = null;
    if (srcPos && srcNrm) {
      const n = srcPos.count;
      const sp = new Float64Array(n * 3);
      const sn = new Float64Array(n * 3);
      // The source normals point the way the asset was wound; if that
      // was inward (see INSIDE OUT above) the bake wants them turned
      // round too, or it computes the occlusion of the interior.
      const nSign = insideOut ? -1 : 1;
      for (let i = 0; i < n; i += 1) {
        sp[i * 3] = srcPos.getX(i);
        sp[i * 3 + 1] = srcPos.getY(i);
        sp[i * 3 + 2] = srcPos.getZ(i);
        sn[i * 3] = srcNrm.getX(i) * nSign;
        sn[i * 3 + 1] = srcNrm.getY(i) * nSign;
        sn[i * 3 + 2] = srcNrm.getZ(i) * nSign;
      }
      aoShade = bakeOcclusion(sp, sn, n, facetC, facetN, facetA, triCount, 1.35);
    }
    const srcIndex = src.index;
    const aoAt = (v) => {
      if (!aoShade) return 1;
      const i = srcIndex ? srcIndex.getX(v) : v;
      return aoShade[i] === undefined ? 1 : aoShade[i];
    };

    /* ------------------------------------------------------------
       PASS B. The paint.
       ------------------------------------------------------------ */
    for (let t = 0; t < triCount; t += 1) {
      const v0 = t * 3;
      nrm[0] = facetN[t * 3]; nrm[1] = facetN[t * 3 + 1]; nrm[2] = facetN[t * 3 + 2];
      const px = facetC[t * 3];
      const py = facetC[t * 3 + 1];
      const pz = facetC[t * 3 + 2];
      const jn = facetJoint[t];
      const alphaMax = facetAlpha[t];
      const bone = facetBone[t];

      const name = bones[bone] ? bones[bone].name : "";
      const isHead = HEAD_BONES.has(name);
      let segment = -1;
      for (let k = 0; k < LEG_PREFIX.length; k += 1) {
        if (name.startsWith(LEG_PREFIX[k])) { segment = k; break; }
      }
      const frame = limbs.get(name) || null;
      const shaft = frame && frame.radius > 0 ? frame : null;
      /* A bristle, a claw or a spine: same bone as the shaft, but
         standing well outside it. */
      const isBristle = !!shaft && facetRad[t] > shaft.radius * 1.42 + 0.09;

      /* Two facet-constant hashes: a fine one for facet-to-facet value
         jitter (this is the microDetail the metric compare has been
         asking for, and it is free), and a coarse one for blotchy
         bleaching so the jitter does not read as even static. */
      const hFine = hash3(px * 41, py * 41, pz * 41);
      const hBlotch = hash3(Math.floor(px * 1.7), Math.floor(py * 1.7), Math.floor(pz * 1.7));
      const up = clamp01(nrm[1]);

      const toTop = sstep(0.06, 0.88, nrm[1]);
      const toLow = sstep(0.06, 0.78, -nrm[1]);
      for (let k = 0; k < 3; k += 1) {
        rgb[k] = lerp(lerp(CHALK_MID[k], CHALK_TOP[k], toTop), CHALK_LOW[k], toLow);
      }

      let part = PART.SHELL;
      /* THE UP-FACES CARRY A LITTLE LIGHT OF THEIR OWN, and this is
         the one place the paint stops being purely physical.

         The illumination reaching this animal tops out at
         (174, 110, 82) - see the palette note - so NO diffuse facet
         anywhere on it can reach the highlight band a Halo frame
         lives in, whatever it is painted. Measured, our 99th
         percentile sits at 99 against a pool band that starts at 130,
         and it is the last axis on this boss that paint alone cannot
         move.

         The fiction already has the answer and the model already
         wrote it down: this shell has GLASS FUSED THROUGH IT, and
         every lit thing in the Glass Scar - the fulgurite spires, the
         vitrified floor, the veins the model script painted into
         COLOR_0's alpha - carries the crater's own cold light. So the
         chalk takes a small bio-mask term, scaled by how far the
         facet faces the sky, which reads as light caught in the glass
         on the surfaces that would catch it. It is small: at the
         crest it adds about as much as the diffuse term already
         there, and on a side facet it adds a twentieth of it. */
      let alpha = 0.045 + 0.085 * toTop;

      /* THE GLASS. Chosen by a facet-constant roll biased hard toward
         up-facing plate, because that is where a crater throws its
         glass and where the sun can find it. About one facet in
         twelve, which is the number that reads as "fused into the
         shell" - at one in four it reads as a mosaic and the animal
         stops being an animal. */
      const glassRoll = hash3(Math.floor(px * 3.1), Math.floor(py * 3.1), Math.floor(pz * 3.1))
        * (0.46 + 0.86 * up);
      const glass = glassRoll > 0.70;

      if (isHead) {
        part = PART.HEAD;
        /* The authored bio mask is kept wherever it is real: the eye
           cluster, the fang glow and the spinneret were painted into
           COLOR_0's alpha by the model script and art.js owns that
           channel's meaning. This repaint has no business inventing a
           new place for the animal's one saturated focal colour. */
        if (alphaMax >= 0.25) {
          rgb[0] = colour[v0 * 4]; rgb[1] = colour[v0 * 4 + 1]; rgb[2] = colour[v0 * 4 + 2];
          alpha = Math.min(1, alphaMax * 1.2);
        } else {
          for (let k = 0; k < 3; k += 1) rgb[k] *= 0.82;
        }
      } else if (segment >= 0) {
        const pair = Number(name.slice(LEG_PREFIX[segment].length, -2));
        const side = name.endsWith("_L") ? 0 : 1;
        if (Number.isFinite(pair)) legOf[t] = pair * 2 + side;
        segOf[t] = segment;
        const seg = SEGMENT_VALUE[LEG_PREFIX[segment]];
        for (let k = 0; k < 3; k += 1) rgb[k] *= seg;
        if (segment === 3) {
          // Worn back to bare shell by standing in a glass crater.
          for (let k = 0; k < 3; k += 1) rgb[k] = lerp(rgb[k], FOOT_WORN[k], 0.55);
        }
        if (jn > 0.26) {
          /* Dried silk at the joint. Filed under the SHELL material
             rather than the leg's, and that is the point of having
             five: silk is chalk-dry and matte and the leg plate next
             to it is glossy, and the eye reads the boundary between
             two materials long before it reads either one. */
          part = PART.SHELL;
          const strand = hFine;
          for (let k = 0; k < 3; k += 1) {
            rgb[k] = lerp(SILK_DULL[k], SILK_PALE[k], strand) * (0.72 + 0.42 * up);
          }
          /* "Silk: cold blue-white, translucent, CATCHING LIGHT." A
             dried strand does not emit, but it does scatter, and under
             a light this orange scattering is the only mechanism left
             that can put a cold value on this animal - see the palette
             note. Small enough to read as translucency rather than as
             a glowing ring. */
          alpha = 0.15;
        } else if (glass) {
          part = PART.GLASS;
          const litShard = glassRoll > 0.92;
          for (let k = 0; k < 3; k += 1) {
            rgb[k] = litShard ? GLASS_LIT[k] : GLASS_DARK[k];
          }
          alpha = litShard ? 0.86 : 0.16 + 0.18 * hFine;
        } else {
          part = PART.LEG;
        }
      } else if (alphaMax >= 0.25) {
        /* The model's own lit veins through the carapace and the
           abdomen. They were authored as cracks with light behind
           them and they are exactly the glass family - so they get the
           glossy material and keep their colour. */
        part = PART.GLASS;
        rgb[0] = colour[v0 * 4]; rgb[1] = colour[v0 * 4 + 1]; rgb[2] = colour[v0 * 4 + 2];
        alpha = Math.min(1, alphaMax * 1.25);
      } else if (nrm[1] < -0.22) {
        /* THE UNDERSIDE, and the doc is right that nobody has ever
           looked at it: it is the reward for breaking eight legs and
           it has to be a different animal from the top. Soft, wet,
           unarmoured, and the only warm colour anywhere on a boss
           made of cold glass - which is the Hunter's blue-plate-over-
           orange-flesh trick and the reason that silhouette works. */
        part = PART.BELLY;
        const core = clamp01(1 - Math.hypot(px, pz + 3.2) / 4.2);
        for (let k = 0; k < 3; k += 1) {
          rgb[k] = lerp(BELLY_SOFT[k], BELLY_HOT[k], core * 0.75) * (0.80 + 0.4 * hBlotch);
        }
        alpha = 0.06 + 0.20 * core;
      } else if (glass) {
        part = PART.GLASS;
        const litShard = glassRoll > 0.93;
        for (let k = 0; k < 3; k += 1) rgb[k] = litShard ? GLASS_LIT[k] : GLASS_DARK[k];
        alpha = litShard ? 0.84 : 0.15 + 0.16 * hFine;
      }

      if (part !== PART.GLASS && part !== PART.HEAD) {
        const jitter = 1 + (hFine - 0.5) * 0.30;
        const blotch = 1 + (hBlotch - 0.5) * 0.34;
        for (let k = 0; k < 3; k += 1) rgb[k] = Math.max(0, rgb[k] * jitter * blotch);
      }

      partOf[t] = part;
      counts[part] += 1;
      for (let k = 0; k < 3; k += 1) {
        const v = (v0 + k) * 4;
        colour[v] = rgb[0];
        colour[v + 1] = rgb[1];
        colour[v + 2] = rgb[2];
        colour[v + 3] = alpha;
      }
    }

    /* The index exists ONLY to sort triangles into their material
       runs; every vertex is still used exactly once. Uint32 because
       26,664 vertices do not fit in a short, and a Uint16 index would
       have wrapped silently into a shredded model. */
    const index = new Uint32Array(triCount * 3);
    const starts = new Uint32Array(PART_COUNT);
    let running = 0;
    for (let p = 0; p < PART_COUNT; p += 1) {
      starts[p] = running;
      running += counts[p] * 3;
    }
    const cursor = starts.slice();
    /* ...and the second half of INSIDE OUT: an inside-out asset gets
       its winding reversed here, where the index is being written
       anyway - second and third corner swapped - so the faces the GPU
       keeps are the outward ones. */
    const w1 = insideOut ? 2 : 1;
    const w2 = insideOut ? 1 : 2;
    for (let t = 0; t < triCount; t += 1) {
      const p = partOf[t];
      const at = cursor[p];
      cursor[p] = at + 3;
      index[at] = t * 3;
      index[at + 1] = t * 3 + w1;
      index[at + 2] = t * 3 + w2;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.clearGroups();
    for (let p = 0; p < PART_COUNT; p += 1) {
      if (counts[p] > 0) geo.addGroup(starts[p], counts[p] * 3, p);
    }
    /* The same inflated bounding sphere `enemies.js` gives every
       species, and for the same reason: a skinned mesh's bind-pose
       bounds go stale the moment a clip poses it, and a clip that
       throws a twelve-metre leg out sideways would otherwise cull the
       whole animal off screen. toNonIndexed does not carry the sphere
       over, so the inflation has to be redone here or the fix silently
       reverts for this one creature. */
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius *= 2.4;

    /* Roughness and metalness, per part, each with its reason - the
       kit's own table is advisory and says so, because a module's
       centre value is an argument and a kit that overwrote it would
       undo the argument invisibly.

         shell    0.78  chalk. Chalk is the ABSENCE of gloss travel.
         leg      0.44  hard plate; the fight's first half is legs and
                        a lobe that travels across them as the camera
                        moves is what carries the detail.
         glass    0.11  the one place on this animal a highlight is
                        allowed to blow out. 0.26 metalness so the
                        shard throws a coloured specular rather than a
                        white one - well under art.js's 0.6 ceiling,
                        past which the diffuse term vanishes and the
                        surface becomes a blurred mirror of the sky.
         belly    0.30  wet. Wetness is a highlight that MOVES.
         head     0.34  the wettest hard surface it has; the eyes and
                        the fangs are the focal element. */
    /* CAVITY, MOTTLE AND GLOSS ARE PUSHED WELL PAST THE KIT'S
       DEFAULTS, and RELIEF IS NOT. The kit's own header records why
       the amplitudes are where they are: at twice these numbers a
       close-up of THIS animal's legs came back looking like braided
       rope, because a cell field wrapped round a thirty-centimetre
       cylinder reads as cord. That ceiling is real and is left alone.

       But `cavity`, `mottle` and `gloss` are not relief. They darken
       troughs, tint albedo and spread the specular lobe, and at the
       distance this fight is actually photographed from - 33 to 39
       metres, where the 13cm octave is seven pixels wide and the 4cm
       one is two - they are the terms that survive to the screen while
       a two-millimetre bump does not. They are also exactly what
       `localContrast` and `microDetail` measure. */
    const grain = { cavity: 0.58, mottle: 0.36, gloss: 0.38 };
    const mats = [
      makeSurfaceMaterial("shell", "bone", 0.78, 0.0, { ...grain, ember: 0.20 }),
      makeSurfaceMaterial("leg", "chitin", 0.44, 0.09, { ...grain, ember: 0.30 }),
      makeSurfaceMaterial("glass", "chitin", 0.11, 0.26,
        { cavity: 0.42, mottle: 0.22, gloss: 0.36, sheen: 0.16, ember: 0.10 }),
      makeSurfaceMaterial("belly", "membrane", 0.30, 0.0,
        { cavity: 0.38, mottle: 0.26, gloss: 0.30, ember: 0.62 }),
      makeSurfaceMaterial("head", "chitin", 0.34, 0.06, { ...grain, ember: 0.35 }),
    ];

    skin.geometry = geo;
    skin.material = mats;

    dress = {
      geo,
      mats,
      colour,
      colourAttr: geo.attributes.color,
      base: colour.slice(),
      legOf,
      segOf,
      triCount,
      broken: new Array(8).fill(false),
      damage: 0,
      insideOut,
    };
  }

  /** Push the accumulated damage response onto every one of the five
   *  surfaces. Per-instance materials, so this is legal - the kit
   *  refuses the same write on a shared caste material and is right
   *  to, since forty Threshers would scorch together. */
  function pushSurfaceDamage(value) {
    if (!dress) return;
    /* CAPPED, and the cap is the argument. The kit's damage term is
       mostly SOOT - scorch pooling in the coarse mottle's troughs -
       which is exactly right for something that lives in a furnace and
       wrong for a chalk-white animal standing in a glass crater. Run
       to 1.0 it takes the whole shell down to a quarter of its albedo,
       and the frame this boss is weakest in is already the hurt one.
       At 0.55 the same term reads as a shell that has been cracked and
       dirtied rather than burnt, and the Distaff's real damage state -
       eight legs that go dark one at a time - is painted directly by
       `paintLeg` instead of being asked of a global uniform. */
    const v = clamp01(value) * 0.55;
    if (v === dress.damage) return;
    if (Math.abs(v - dress.damage) < 0.02 && v > 0 && v < 0.55) return;
    dress.damage = v;
    for (const mat of dress.mats) setSurfaceDamage(mat, v);
  }

  /**
   * Repaint one leg as BROKEN, or restore it.
   *
   * "A broken leg must read as broken from 50 m: a wet dark fracture,
   * the segment hanging, silk trailing." At fifty metres a stump is
   * four pixels wide, so the only thing that can carry it is VALUE:
   * the whole limb below the break drops to a wet near-black while
   * every other leg is chalk, and the fracture itself is the one warm
   * wet band on a cold white animal. That is a read the silhouette
   * survives; a decal on the joint is not.
   *
   * A buffer write rather than a shader uniform, deliberately: there
   * are eight of these events in the longest possible fight, the
   * colour array is already ours, and the alternative is a per-leg
   * uniform that would have to be threaded through a kit five other
   * agents share.
   */
  function paintLeg(legIndex, broken) {
    if (!dress) return;
    const { colour, base, legOf, segOf, triCount } = dress;
    for (let t = 0; t < triCount; t += 1) {
      if (legOf[t] !== legIndex) continue;
      const seg = segOf[t];
      // The coxa stays: it is the socket, and the socket is still
      // attached to the animal.
      if (seg <= 0) continue;
      const v0 = t * 3;
      for (let k = 0; k < 3; k += 1) {
        const v = (v0 + k) * 4;
        if (!broken) {
          colour[v] = base[v];
          colour[v + 1] = base[v + 1];
          colour[v + 2] = base[v + 2];
          colour[v + 3] = base[v + 3];
          continue;
        }
        /* The break is at the top of the femur - where combat.js's
           bonus says the limb failed - so the femur carries the wet
           fracture and everything past it is dead weight. */
        const wet = seg === 1 ? 0.55 : 0.0;
        colour[v] = lerp(ICHOR_DARK[0], ICHOR_WET[0], wet);
        colour[v + 1] = lerp(ICHOR_DARK[1], ICHOR_WET[1], wet);
        colour[v + 2] = lerp(ICHOR_DARK[2], ICHOR_WET[2], wet);
        colour[v + 3] = wet * 0.22;
      }
    }
    dress.colourAttr.needsUpdate = true;
  }

  /** Watch combat.js's own per-leg flags and answer them. This module
   *  never writes `legBroken`; it only notices that combat.js has. */
  function watchLegBreaks() {
    if (!dress || !inst?.legBroken) return;
    for (let i = 0; i < inst.legBroken.length && i < dress.broken.length; i += 1) {
      const now = !!inst.legBroken[i];
      if (now === dress.broken[i]) continue;
      dress.broken[i] = now;
      paintLeg(i, now);
      if (!now) continue;
      onLegBroke(i);
    }
  }

  /* ============================================================
     MOTION AND WEIGHT

     THE POISE SPRING. One number, in metres, added to the collapse
     sink and handed to `inst.bodyDrop` - so every weight beat in the
     fight is expressed as a push on the same spring rather than as
     six independent tweens that can fight each other. It is a real
     damped harmonic oscillator (about 1.1Hz, settling in two thirds
     of a second) because that is what makes a rear read as
     ANTICIPATION and the drop after it read as RECOVERY: the same
     impulse played backwards through the same spring, which is what
     the eye is actually reading when it calls something heavy.

     Note that `enemies.js` then damps `inst.y` toward the target at
     12/s on top of this. That second lag is not a mistake to be
     cancelled - it is the mass of the body arriving after the legs
     have decided - but it does mean the impulses below are larger
     than the displacement they produce.
     ============================================================ */
  const POISE_K = 48;
  const POISE_C = 7.0;

  /** Positive drives the body DOWN (bodyDrop is a sink). */
  function poiseKick(v) {
    state.poiseVel = clamp(state.poiseVel + v, -9, 9);
  }

  function stepPoise(dt) {
    state.poiseVel += (-state.poise * POISE_K - state.poiseVel * POISE_C) * dt;
    state.poise = clamp(state.poise + state.poiseVel * dt, -1.1, 1.1);
  }

  /* THE ABDOMEN LAGS.

     A spider's opisthosoma is a sac hung off a pedicel and it does
     not accelerate when the animal does - it arrives afterwards. That
     one behaviour is most of what separates "nine metres of animal"
     from "a model being translated", and it costs a spring and two
     quaternion multiplies.

     THE DELTA IS BUILT IN THE PARENT'S FRAME, not the bone's own.
     `bone.getWorldQuaternion` reads `matrixWorld`, which at this point
     in the frame still carries LAST frame's version of this same
     delta, so composing there would integrate the sway into itself
     and wind the abdomen up like a clock spring. The parent's world
     quaternion is clean - `enemies.js` updated it this frame and
     nothing here touches it - so the world-space delta is conjugated
     into parent space and multiplied onto the mixer's own local pose.

     AND THE MIXER MIGHT NOT HAVE RUN. `enemies.js` gates
     `mixer.update` on camera range, and past it the bone would still
     be holding what this wrote last frame - the same wind-up by a
     different door. Detected exactly rather than guessed at: if the
     bone is bit-for-bit what was written, nothing overwrote it, and
     the saved pre-delta pose is used as the base instead. */
  const SWAY_K = 26;
  const SWAY_C = 6.4;
  const _swayAxis = new THREE.Vector3();
  const _swayDelta = new THREE.Quaternion();
  const _swayParent = new THREE.Quaternion();
  const _swayLocal = new THREE.Quaternion();
  const _swayBase = new THREE.Quaternion();
  const _swayWrote = new THREE.Quaternion();
  let swayValid = false;

  function stepSway(dt) {
    if (!inst?.bones) return;
    const inv = 1 / Math.max(dt, 1e-3);
    const vx = (inst.x - state.lastX) * inv;
    const vz = (inst.z - state.lastZ) * inv;
    state.lastX = inst.x;
    state.lastZ = inst.z;
    const ax = clamp((vx - state.lastVX) * inv, -60, 60);
    const az = clamp((vz - state.lastVZ) * inv, -60, 60);
    state.lastVX = vx;
    state.lastVZ = vz;

    // Driven by acceleration, opposed by the spring. The 0.055 turns
    // m/s^2 into the metres of lag the pedicel actually allows.
    state.swayVX += (-state.swayX * SWAY_K - state.swayVX * SWAY_C - ax * 0.055) * dt;
    state.swayVZ += (-state.swayZ * SWAY_K - state.swayVZ * SWAY_C - az * 0.055) * dt;
    state.swayX = clamp(state.swayX + state.swayVX * dt, -0.6, 0.6);
    state.swayZ = clamp(state.swayZ + state.swayVZ * dt, -0.6, 0.6);

    const bone = inst.bones.get("abdomen1");
    if (!bone || !bone.parent) return;
    const tilt = Math.hypot(state.swayX, state.swayZ);

    if (swayValid && bone.quaternion.equals(_swayWrote)) bone.quaternion.copy(_swayBase);
    else _swayBase.copy(bone.quaternion);

    if (tilt < 1e-4) {
      // Nothing to add. Leave the mixer's pose exactly as authored and
      // drop the memo, so the next frame takes a fresh base.
      swayValid = false;
      return;
    }
    // A horizontal axis at right angles to the lag: rotating about it
    // tips the sac backwards out of the turn.
    _swayAxis.set(state.swayZ, 0, -state.swayX).normalize();
    _swayDelta.setFromAxisAngle(_swayAxis, clamp(tilt * 0.30, -0.14, 0.14));
    bone.parent.getWorldQuaternion(_swayParent);
    _swayLocal.copy(_swayParent).invert().multiply(_swayDelta).multiply(_swayParent);
    bone.quaternion.copy(_swayLocal).multiply(_swayBase);
    _swayWrote.copy(bone.quaternion);
    swayValid = true;
    // The sac and everything hung off it - abdomen2, the spinneret the
    // web bolts are launched from.
    bone.updateWorldMatrix(false, true);
  }

  /** A leg has just gone. Everything that is not the repaint. */
  function onLegBroke(index) {
    const leg = inst.legs?.[index];
    const plant = leg?.plant;
    const fx = plant ? plant.x : inst.x;
    const fz = plant ? plant.z : inst.z;
    const fy = plant ? plant.y : groundAt(fx, fz);
    if (leg?.femur) {
      leg.femur.updateWorldMatrix(true, false);
      leg.femur.getWorldPosition(_vec);
      ctx.vfx?.spark?.(_vec.x, _vec.y, _vec.z, 2.4, false, false);
    }
    ctx.vfx?.sandSpray?.(fx, fy + 0.25, fz, 1.7, 0, 1);
    spillIchor(fx, fz, 2.1 + Math.random() * 1.2);
    // Seven legs holding what eight were, and the body says so.
    poiseKick(2.1);
    // ...and slews toward the side that just stopped answering.
    const away = Math.atan2(fx - inst.x, fz - inst.z);
    state.swayVX += Math.sin(away) * 1.1;
    state.swayVZ += Math.cos(away) * 1.1;
    ctx.player?.doctrineKick?.(0.42, 0.75);
    // ...and every attack stops for a while. See beginStagger.
    beginStagger();
    bus.emit("legBroken", { index, x: fx, y: fy, z: fz, legsBroken: inst.legsBroken || 0 });
  }

  /* A hit lands. `enemyDamaged` carries where, so the flinch can be
     about where - a boss that shrugs identically whatever you shot is
     a boss with no body. Subscribed lazily because ctx.combat is built
     after this module and the reference would be undefined at build
     time. */
  let combatOff = null;
  function ensureCombatWatch() {
    if (combatOff || !ctx.combat?.bus?.on) return;
    combatOff = ctx.combat.bus.on("enemyDamaged", (e) => {
      if (!inst || !e || e.enemyId !== inst.id) return;
      const scale = clamp01((Number(e.actual) || 0) / 260);
      if (scale <= 0.005) return;
      const dx = inst.x - (Number.isFinite(e.x) ? e.x : inst.x);
      const dz = inst.z - (Number.isFinite(e.z) ? e.z : inst.z);
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        state.swayVX += (dx / d) * scale * 1.6;
        state.swayVZ += (dz / d) * scale * 1.6;
      }
      // A hit high on the body pushes it down; a hit low on a leg
      // makes it pick the body up off that side.
      const high = Number.isFinite(e.y) ? clamp01((e.y - inst.y - 4) / 5) : 0.5;
      poiseKick((high * 2 - 0.6) * scale * 1.2);
    });
  }

  /* ============================================================
     WEB BOLTS - a fast, near-straight shot rather than a lobbed
     arc, because silk is thrown to PIN something, not to land on it
     a second later. Pooled and updated exactly like the Coulter's
     venom globules, which this is a straight-line simplification of.
     ============================================================ */
  const boltGeo = new THREE.IcosahedronGeometry(0.30, 0);
  const boltMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(WEB_EDGE),
    emissive: new THREE.Color(WEB_COLOUR),
    emissiveIntensity: 1.4,
    roughness: 0.30,
    metalness: 0,
    flatShading: true,
  });
  boltMat.name = "sf-distaff-bolt";
  patchMaterial(boltMat, atmos, { rim: 0.6, glitter: 0 });
  const bolts = [];
  for (let i = 0; i < BOLT_MAX; i += 1) {
    const mesh = new THREE.Mesh(boltGeo, boltMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    bolts.push({ mesh, live: false, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, reel: false });
  }
  let boltCursor = 0;

  /* THE LINE the reel hauls on: one open unit cylinder along +Y in the
     bolt's own material, re-posed between the spinneret and the
     trooper's chest every frame the haul is live and hidden otherwise.
     A haul with no visible line is a trooper sliding across the sand
     for no reason. */
  const lineGeo = new THREE.CylinderGeometry(0.075, 0.115, 1, 6, 1, true);
  const line = { mesh: new THREE.Mesh(lineGeo, boltMat), up: new THREE.Vector3(0, 1, 0) };
  line.mesh.name = "sf-distaff-reel-line";
  line.mesh.visible = false;
  line.mesh.castShadow = false;
  line.mesh.frustumCulled = false;
  group.add(line.mesh);

  function launchBolt(x, y, z, vx, vy, vz) {
    const b = bolts[boltCursor];
    boltCursor = (boltCursor + 1) % BOLT_MAX;
    b.live = true;
    b.life = 3.2;
    b.reel = false;
    b.x = x; b.y = y; b.z = z;
    b.vx = vx; b.vy = vy; b.vz = vz;
    b.mesh.position.set(x, y, z);
    b.mesh.visible = true;
    return b;
  }

  /* ============================================================
     WEB PATCHES - the venom pool's own construction, rewritten as a
     woven strand pattern instead of a liquid stain, and a movement
     slow instead of a damage tick. `aRadial`/`aAngle` per vertex let
     the shader draw both the concentric rings and the radial spokes
     of an actual web rather than a plain disc.
     ============================================================ */
  const PATCH_RINGS = 3;
  const PATCH_SIDES = 24;
  const PATCH_VERTS = 1 + PATCH_RINGS * PATCH_SIDES;

  const patchVertex = /* glsl */`
    attribute float aRadial;
    attribute float aAngle;
    varying float vRadial;
    varying float vAngle;
    void main() {
      vRadial = aRadial;
      vAngle = aAngle;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }
  `;
  const patchFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform vec3 uBed;
    uniform float uFade;
    uniform float uTime;
    varying float vRadial;
    varying float vAngle;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // Concentric rings and radial spokes, the two things that read
      // as "spun" rather than "spilled" at any distance.
      float rings = pow(0.5 + 0.5 * sin(r * 22.0 - uTime * 0.6), 10.0);
      float spokes = pow(abs(cos(vAngle * 9.0)), 14.0);
      float web = clamp(rings * 0.7 + spokes * (1.0 - r) * 0.8, 0.0, 1.0);
      float bed = (1.0 - smoothstep(0.55, 1.0, r)) * 0.20;
      vec3 c = mix(uBed, uEdge, bed * 3.0 + web * 0.4);
      c = mix(c, uCore, web * 0.7);
      float far = 1.0 - smoothstep(180.0, 300.0, length(cameraPosition));
      float a = (bed + web * 0.62) * uFade * (0.4 + 0.6 * far);
      if (a < 0.006) discard;
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.88));
    }
  `;

  /** One ground-conforming disc, ringed and spoked. Shared with the
   *  ichor stains below - they are the same fan of triangles laid on
   *  the same height field, and only the fragment shader differs. */
  function makeDiscGeometry() {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(PATCH_VERTS * 3);
    const radial = new Float32Array(PATCH_VERTS);
    const angle = new Float32Array(PATCH_VERTS);
    const index = [];
    for (let s = 0; s < PATCH_SIDES; s += 1) {
      const n = (s + 1) % PATCH_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < PATCH_RINGS - 1; r += 1) {
        const a0 = 1 + r * PATCH_SIDES + s;
        const a1 = 1 + r * PATCH_SIDES + n;
        const b0 = 1 + (r + 1) * PATCH_SIDES + s;
        const b1 = 1 + (r + 1) * PATCH_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < PATCH_RINGS; r += 1) {
      const t = (r + 1) / PATCH_RINGS;
      for (let s = 0; s < PATCH_SIDES; s += 1) {
        radial[1 + r * PATCH_SIDES + s] = t;
        angle[1 + r * PATCH_SIDES + s] = (s / PATCH_SIDES) * TAU;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return { geo, position };
  }

  /** Lay a disc on the terrain at (x, z), following the height field
   *  so it beds into a slope instead of hovering over it. */
  function layDisc(entry, x, z, radius) {
    const y = groundAt(x, z);
    const p = entry.position;
    p[0] = 0; p[1] = 0.07; p[2] = 0;
    for (let r = 0; r < PATCH_RINGS; r += 1) {
      const rr = radius * ((r + 1) / PATCH_RINGS);
      for (let s = 0; s < PATCH_SIDES; s += 1) {
        const a = (s / PATCH_SIDES) * TAU + r * 0.1;
        const wob = 1 - 0.10 * Math.sin(a * 4 + r * 1.3);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * PATCH_SIDES + s) * 3;
        p[i] = px;
        p[i + 1] = groundAt(x + px, z + pz) - y + 0.075;
        p[i + 2] = pz;
      }
    }
    entry.mesh.position.set(x, y, z);
    entry.mesh.geometry.attributes.position.needsUpdate = true;
    entry.mesh.geometry.computeBoundingSphere();
    return y;
  }

  const patches = [];
  for (let i = 0; i < PATCH_MAX; i += 1) {
    const { geo, position } = makeDiscGeometry();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(WEB_COLOUR) },
        uEdge: { value: new THREE.Color(WEB_EDGE) },
        uBed: { value: new THREE.Color(WEB_BED) },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: patchVertex,
      fragmentShader: patchFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-web-patch-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    patches.push({
      mesh, mat, position, life: 0, span: 1, x: 0, y: 0, z: 0, radius: C.patchRadius,
    });
  }
  let patchCursor = 0;

  function spillPatch(x, z, radius = C.patchRadius, seconds = C.patchSeconds) {
    const patch = patches[patchCursor];
    patchCursor = (patchCursor + 1) % patches.length;
    patch.radius = radius;
    patch.span = seconds;
    patch.life = seconds;
    const y = layDisc(patch, x, z, radius);
    patch.x = x; patch.y = y; patch.z = z;
    patch.mesh.visible = true;
    bus.emit("patch", { x, y, z, radius });
    return patch;
  }

  function patchAt(x, y, z) {
    for (const patch of patches) {
      if (patch.life <= 0) continue;
      const dx = x - patch.x;
      const dz = z - patch.z;
      if (dx * dx + dz * dz > patch.radius * patch.radius) continue;
      if (Math.abs(y - patch.y) > 3) continue;
      return patch;
    }
    return null;
  }

  function updatePatches(dt) {
    const ps = ctx.player?.state;
    let standing = false;
    for (const patch of patches) {
      if (patch.life <= 0) {
        if (patch.mesh.visible) patch.mesh.visible = false;
        continue;
      }
      patch.life -= dt;
      if (patch.life <= 0) {
        patch.mesh.visible = false;
        patch.mat.uniforms.uFade.value = 0;
        continue;
      }
      const t = patch.life / patch.span;
      const fade = t > 0.85 ? clamp01((1 - t) / 0.15) : clamp01(t / 0.85) ** 0.6;
      patch.mat.uniforms.uFade.value = fade;
      patch.mat.uniforms.uTime.value = atmos.elapsed;
    }
    if (ps && !ctx.combat?.player?.dead && patchAt(ps.x, ps.y, ps.z)) standing = true;
    if (standing) ctx.player?.applySlow?.(C.patchSlowFactor, 0.3);
  }

  /* ============================================================
     ICHOR

     "Blood/ichor/dust that lands and stains" is one of the five
     things the art direction says every boss owes the frame, and the
     Distaff is the boss with eight scheduled opportunities to pay it:
     every broken leg empties itself onto the crater floor and the
     floor keeps it.

     A SEPARATE POOL FROM THE WEB, and not for tidiness. The web
     patches are a movement hazard - `patchAt` slows whatever stands
     in one - and a puddle of the animal's own blood that slowed the
     player would be a mechanic nobody was told about. They are also
     named `sf-web-patch-N`, and qa.js's `webPools` hook enumerates
     the group by exactly that prefix, so a stain filed in that pool
     would show up in every check that counts webs.

     Four of them, and they do not fade: a stain that expires is a
     stain the player learns to ignore. `clearHazards` takes them out,
     which is the same door the leash and the save-restore already use.
     ============================================================ */
  const stainFragment = /* glsl */`
    precision highp float;
    uniform vec3 uDark;
    uniform vec3 uWet;
    uniform float uFade;
    uniform float uSeed;
    varying float vRadial;
    varying float vAngle;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // A blotch, not a disc. Two low harmonics break the rim so it
      // reads as something that ran and pooled; a circle reads as a
      // decal at any distance and in any light.
      float lobe = 0.74 + 0.18 * sin(vAngle * 3.0 + uSeed)
        + 0.11 * sin(vAngle * 7.0 - uSeed * 1.7);
      float body = 1.0 - smoothstep(lobe * 0.52, lobe, r);
      if (body < 0.004) discard;
      // Wet in the middle, drying at the rim. Gloss is the only cue at
      // range that separates fluid from shadow.
      vec3 c = mix(uDark, uWet, pow(body, 2.4) * 0.85);
      gl_FragColor = vec4(c, clamp(body * 0.62 * uFade, 0.0, 0.80));
    }
  `;

  const stains = [];
  for (let i = 0; i < STAIN_MAX; i += 1) {
    const { geo, position } = makeDiscGeometry();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uDark: { value: new THREE.Color("#150a0b") },
        uWet: { value: new THREE.Color("#5a1f1c") },
        uFade: { value: 0 },
        uSeed: { value: i * 1.7 },
      },
      vertexShader: patchVertex,
      fragmentShader: stainFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-distaff-ichor-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 4;
    group.add(mesh);
    stains.push({ mesh, mat, position });
  }
  let stainCursor = 0;

  /* ============================================================
     THE LAIR'S OWN SILK

     A guardian that has stood in one crater long enough to have
     become part of it has webbed the floor of it. Three standing mats
     around the lair, laid once and never expiring - the web bolts and
     the thrown patches are the FIGHT's silk and they come and go;
     this is the animal's address.

     It is also the only cold, pale, high-frequency thing this module
     can put on the crater floor, and the frame needs one. Measured
     across the gallery, 75% of every Distaff frame sits below sRGB 32
     and almost all of that is unlit crater rim this module does not
     own; the one surface it does own down there is silk.

     NOT A HAZARD, and named so nothing mistakes it for one: `patchAt`
     - which is what slows a player standing in a fresh web - only
     walks the `patches` pool, and qa.js's `webPools` enumerates by
     the `sf-web-patch` prefix. A permanent slow field under a boss
     would be a mechanic nobody was told about.

     A DORMANT BOSS MUST COST NOTHING, so these are hidden until
     something is near enough to see them. Three transparent discs is
     three draw calls on a frame that is already fill-bound, and there
     is no reason for the far side of the map to pay them.
     ============================================================ */
  const LAIR_SILK = [
    { r: 13.5, a: 0.35, size: 11.5, fade: 0.82 },
    { r: 17.0, a: 2.45, size: 8.5, fade: 0.70 },
    { r: 12.0, a: 4.30, size: 9.5, fade: 0.76 },
  ];
  const lairSilk = [];
  for (let i = 0; i < LAIR_SILK.length; i += 1) {
    const { geo, position } = makeDiscGeometry();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        // Old silk, not fresh: dustier and duller than a thrown patch,
        // which is also what keeps it from reading as a hazard.
        uCore: { value: new THREE.Color("#e8f6f2") },
        uEdge: { value: new THREE.Color("#5b8f90") },
        uBed: { value: new THREE.Color("#101d1f") },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: patchVertex,
      fragmentShader: patchFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-distaff-lair-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    lairSilk.push({ mesh, mat, position, spec: LAIR_SILK[i] });
  }
  let lairLaid = false;

  function updateLairSilk() {
    if (!lairLaid) {
      lairLaid = true;
      for (const silk of lairSilk) {
        const { r, a, size } = silk.spec;
        layDisc(silk, C.lairX + Math.cos(a) * r, C.lairZ + Math.sin(a) * r, size);
      }
    }
    const ps = ctx.player?.state;
    const near = !!ps && Math.hypot(ps.x - C.lairX, ps.z - C.lairZ) < 260;
    for (const silk of lairSilk) {
      if (silk.mesh.visible !== near) silk.mesh.visible = near;
      if (!near) continue;
      silk.mat.uniforms.uFade.value = silk.spec.fade;
      silk.mat.uniforms.uTime.value = atmos.elapsed;
    }
  }

  function spillIchor(x, z, radius = 2.6) {
    const stain = stains[stainCursor];
    stainCursor = (stainCursor + 1) % stains.length;
    layDisc(stain, x, z, radius);
    stain.mat.uniforms.uFade.value = 1;
    stain.mat.uniforms.uSeed.value = Math.random() * TAU;
    stain.mesh.visible = true;
    return stain;
  }

  function updateBolts(dt) {
    const ps = ctx.player?.state;
    for (const b of bolts) {
      if (!b.live) continue;
      b.life -= dt;
      const px = b.x, py = b.y, pz = b.z;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += dt * 6;
      b.mesh.rotation.y += dt * 4.4;

      let hit = null;
      const step = Math.hypot(b.x - px, b.y - py, b.z - pz);
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (b.x - px) / step, (b.y - py) / step, (b.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((b.x - px) / step) * blocked,
            y: py + ((b.y - py) / step) * blocked,
            z: pz + ((b.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = b.x - ps.x;
        const dz = b.z - ps.z;
        const dy = b.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 1.6) {
          hit = { x: b.x, y: b.y, z: b.z, direct: true };
        }
      }
      if (hit) {
        b.live = false;
        b.mesh.visible = false;
        if (hit.direct && b.reel) {
          hookPlayer(hit);
        } else if (hit.direct) {
          ctx.combat?.hurtPlayer?.(C.webDamage, {
            source: "distaff-web", x: hit.x, y: hit.y, z: hit.z,
          });
          /* PINNED. Held fast first, then slowed as the strands tear -
             the root is the attack; the slow is what is left of it.
             `applyRoot` refreshes toward the longer timer, so a second
             bolt on a held trooper extends the hold rather than
             restarting a shorter one. */
          ctx.player?.applyRoot?.(C.webRootSeconds);
          ctx.player?.applySlow?.(C.webSlowFactor, C.webRootSeconds + C.webSlowSeconds);
          ctx.player?.doctrineKick?.(0.5, 0.2);
          // The silk on the ground under them, for as long as it holds.
          spillPatch(ps.x, ps.z, 1.7, C.webRootSeconds + C.webSlowSeconds);
          bus.emit("webHit", hit);
        } else {
          bus.emit("webSplash", hit);
        }
        ctx.vfx?.spark?.(hit.x, hit.y, hit.z, hit.direct ? 1.6 : 0.9, !hit.direct, false);
        continue;
      }
      if (b.life <= 0) { b.live = false; b.mesh.visible = false; }
    }
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  /** Turn toward (x, z): an exponential approach whose per-frame step
   *  is capped at `maxRate` radians a second, and which ignores errors
   *  inside `turnDeadband`. The cap is the mechanic - see the config
   *  note - and the deadband is what stops a player edging sideways
   *  along a shin from re-aiming the whole animal a degree at a time,
   *  which replanted feet for nothing. */
  function faceTowards(x, z, rate, dt, maxRate = Infinity) {
    const dx = x - inst.x;
    const dz = z - inst.z;
    if (Math.hypot(dx, dz) < 1e-3) return;
    faceYaw(Math.atan2(dx, dz), rate, dt, maxRate);
  }

  function faceYaw(targetYaw, rate, dt, maxRate = Infinity) {
    const want = dampAngle(inst.yaw, targetYaw, rate, dt);
    let step = want - inst.yaw;
    while (step > Math.PI) step -= TAU;
    while (step < -Math.PI) step += TAU;
    let err = targetYaw - inst.yaw;
    while (err > Math.PI) err -= TAU;
    while (err < -Math.PI) err += TAU;
    if (Math.abs(err) < C.turnDeadband) return;
    const cap = maxRate * dt;
    step = clamp(step, -cap, cap);
    inst.yaw += step;
    inst.root.rotation.y = inst.yaw;
  }

  function beginAlert() {
    state.phase = "alert";
    state.timer = C.alertSeconds;
    setEncounterGate(false, true);
    enemies.play(inst, "alert", 0.25);
    bus.emit("aggro", { x: inst.x, z: inst.z });
    /* Authored hero framing: open floor of the Glass Scar crater,
       viewing the Distaff's full body and legs clearly without
       risk of terrain or crater rim occluding the shot. */
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const camX = C.lairX - 22;
      const camZ = C.lairZ + 26;
      const camY = groundAt(camX, camZ) + 4.2;
      ctx.player.setFree(true, [camX, camY, camZ],
        [inst.x, inst.y + 3.8, inst.z], 48);
      state.releaseCameraAt = 0;
    }
  }

  function releaseEncounterCamera() {
    ctx.player?.setFree?.(false);
    state.releaseCameraAt = undefined;
  }

  function beginCollapse() {
    state.phase = "collapsed";
    state.timer = C.collapseSeconds;
    state.legsAtLastCollapse = inst.legsBroken;
    state.action = 0;
    state.pending = 0;
    inst.collapsed = true;
    poiseKick(1.4);
    enemies.play(inst, "collapse", 0.06);
    ctx.player?.doctrineKick?.(1.1, 1);
    bus.emit("collapse", { x: inst.x, z: inst.z, legsBroken: inst.legsBroken });
  }

  function beginRecover() {
    state.phase = "recovering";
    state.timer = C.recoverSeconds;
    inst.collapsed = false;
    enemies.play(inst, "recover", 0.08);
    bus.emit("recover", { x: inst.x, z: inst.z });
  }

  function beginSlam() {
    enemies.play(inst, "slam", 0.1);
    // ANTICIPATION. It gathers before it hits: the body comes up on
    // the spring during the windup and the same spring throws it back
    // down on contact. Negative is up - bodyDrop is a sink.
    poiseKick(-1.6);
    state.action = 2.0;
    state.actionKind = "slam";
    state.pending = C.slamContact;
    state.slamTimer = C.slamCadence;
    bus.emit("slamTelegraph", { x: inst.x, z: inst.z });
  }

  function beginWebCast() {
    enemies.play(inst, "webCast", 0.1);
    state.action = 1.92;
    state.actionKind = "webCast";
    state.pending = C.webContact;
    state.webTimer = C.webCadence;
    bus.emit("webCastTelegraph", { x: inst.x, z: inst.z });
  }

  function beginBite() {
    enemies.play(inst, "bite", 0.05);
    poiseKick(-0.55);
    state.action = 1.33;
    state.actionKind = "bite";
    state.pending = C.biteContact;
    bus.emit("biteTelegraph", { x: inst.x, z: inst.z });
  }

  /** Where the mouth is. Falls back to a point ahead of the centre if
   *  the rig is not up, which it always is once the animal is awake. */
  function headAt(out) {
    const bone = inst.bones?.get("head");
    if (bone) {
      bone.updateWorldMatrix(true, false);
      return bone.getWorldPosition(out);
    }
    return out.set(inst.x + Math.sin(inst.yaw) * 4, inst.y + 2, inst.z + Math.cos(inst.yaw) * 4);
  }

  /** Is the player somewhere the mouth can reach - within `biteReach`
   *  of the HEAD and inside `biteArc` of the way it is pointing? Asked
   *  at the tell (to decide whether to bite at all) and again at
   *  contact (so stepping round the head during the wind-up is a
   *  dodge). The generous `slack` at contact is the difference between
   *  a bite you can dodge and one you can dodge by standing still. */
  function biteCanReach(slack = 0) {
    const ps = ctx.player?.state;
    if (!ps) return false;
    const h = headAt(_headV);
    const dx = ps.x - h.x;
    const dz = ps.z - h.z;
    const d = Math.hypot(dx, dz);
    if (d > C.biteReach + slack) return false;
    // Touching the mouth is inside the arc by definition.
    if (d < 1.4) return true;
    let rel = Math.atan2(dx, dz) - inst.yaw;
    while (rel > Math.PI) rel -= TAU;
    while (rel < -Math.PI) rel += TAU;
    return Math.abs(rel) <= C.biteArc;
  }

  function landSlam() {
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);
    const y = groundAt(inst.x, inst.z);
    // ...and RECOVERY: the mass arrives, the body compresses onto the
    // legs and settles back over the next two thirds of a second.
    poiseKick(2.7);
    ctx.vfx?.blast?.(inst.x, y + 0.3, inst.z, C.slamRadius * 0.55);
    if (dist > C.slamRadius || ctx.combat?.player?.dead) {
      bus.emit("slamMiss", { x: inst.x, z: inst.z });
      return;
    }
    const falloff = 1 - 0.6 * (dist / C.slamRadius);
    ctx.combat.hurtPlayer(C.slamDamage * falloff, {
      source: "distaff-slam", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    ctx.player.punch?.(1.5);
    ctx.player.doctrineKick?.(0.9, 0.85);
    bus.emit("slam", { x: inst.x, z: inst.z });
  }

  function launchWebBolt() {
    const bone = inst.bones.get("spinneret");
    if (!bone) return;
    bone.updateWorldMatrix(true, false);
    const origin = bone.getWorldPosition(_vec);
    const ps = ctx.player.state;
    const dx = ps.x - origin.x;
    const dy = (ps.y + 0.9) - origin.y;
    const dz = ps.z - origin.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    launchBolt(origin.x, origin.y, origin.z,
      (dx / d) * C.webSpeed, (dy / d) * C.webSpeed, (dz / d) * C.webSpeed);
    ctx.vfx?.spark?.(origin.x, origin.y, origin.z, 1.1, false, true);
    bus.emit("webCast", { x: origin.x, y: origin.y, z: origin.z });
  }

  function landBite() {
    const ps = ctx.player.state;
    if (!biteCanReach(0.8) || ctx.combat?.player?.dead) {
      bus.emit("biteMiss", { x: inst.x, z: inst.z });
      return;
    }
    ctx.combat.hurtPlayer(C.biteDamage, {
      source: "distaff-bite", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    ctx.player.punch?.(1.4);
    poiseKick(0.9);
    bus.emit("bite", { x: inst.x, z: inst.z });
  }

  /* ------------------------------------------------------------
     THE REEL. Same clip, same spinneret, same bolt pool as the pin -
     the animal has one way of throwing silk - but the bolt is flagged
     and what it does on arrival is different: it HOLDS, and hauls.
     ------------------------------------------------------------ */
  function beginWebReel() {
    enemies.play(inst, "webCast", 0.1);
    state.action = 1.92;
    state.actionKind = "webReel";
    state.pending = C.reelContact;
    state.reelTimer = C.reelCadence;
    // The pin's own cadence is pushed back a little, so the two silks
    // do not arrive as one double throw.
    state.webTimer = Math.max(state.webTimer, 2.2);
    bus.emit("reelTelegraph", { x: inst.x, z: inst.z });
  }

  function launchReelBolt() {
    const bone = inst.bones.get("spinneret");
    if (!bone) return;
    bone.updateWorldMatrix(true, false);
    const origin = bone.getWorldPosition(_vec);
    const ps = ctx.player.state;
    const dx = ps.x - origin.x;
    const dy = (ps.y + 0.9) - origin.y;
    const dz = ps.z - origin.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const b = launchBolt(origin.x, origin.y, origin.z,
      (dx / d) * C.reelSpeed, (dy / d) * C.reelSpeed, (dz / d) * C.reelSpeed);
    b.reel = true;
    b.life = 2.4;
    ctx.vfx?.spark?.(origin.x, origin.y, origin.z, 1.3, false, true);
    bus.emit("reelCast", { x: origin.x, y: origin.y, z: origin.z });
  }

  /** The line has landed on the trooper. Hold them and start hauling;
   *  `stepReel` does the rest every frame until the haul ends. */
  function hookPlayer(hit) {
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead) return;
    state.reel = { for: C.reelSeconds, hauled: 0 };
    // Held for the whole haul plus a beat, so a hooked trooper cannot
    // sprint against the line - the line wins, that is what it is.
    ctx.player?.applyRoot?.(C.reelSeconds + 0.15);
    ctx.combat?.hurtPlayer?.(C.webDamage * 0.5, {
      source: "distaff-web", x: hit.x, y: hit.y, z: hit.z,
    });
    ctx.player?.punch?.(0.9);
    ctx.player?.doctrineKick?.(0.55, 0.35);
    line.mesh.visible = true;
    bus.emit("reelHit", { x: hit.x, y: hit.y, z: hit.z });
  }

  function endReel(reason) {
    if (!state.reel) return;
    state.reel = null;
    line.mesh.visible = false;
    ctx.player?.clearRoot?.();
    bus.emit("reelEnd", { x: inst.x, z: inst.z, reason });
  }

  function stepReel(dt) {
    const reel = state.reel;
    if (!reel) return;
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead || inst.state === "death"
      || state.phase !== "standing") {
      endReel("dropped");
      return;
    }
    reel.for -= dt;
    const dx = inst.x - ps.x;
    const dz = inst.z - ps.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > C.reelStop) {
      /* Through the player's own masonry slide, so a wall between the
         two of them stops the haul the way it would stop a walk - a
         line cannot drag a trooper through a fulgurite spire, it can
         only pin them against it. */
      const step = Math.min(C.reelPull * dt, d - C.reelStop);
      const moved = ctx.player?.drag?.((dx / d) * step, (dz / d) * step) ?? 0;
      reel.hauled += moved;
      // The line has been stopped by something. Let go rather than
      // hold a trooper against a wall for the whole timer.
      if (moved < step * 0.15) reel.for -= dt * 2.5;
    }
    // Feet skidding across vitrified sand.
    if (Math.random() < dt * 8) {
      ctx.vfx?.sandSpray?.(ps.x, ps.y + 0.15, ps.z, 0.7, 0, 1);
    }
    if (d <= C.reelStop + 0.05 || reel.for <= 0) {
      const arrived = d <= C.reelStop + 0.05;
      endReel(arrived ? "arrived" : "parted");
      /* THE PAYOFF: the slam is queued the moment they arrive at its
         ring, so the sequence reads reel -> slam, and the tell on the
         slam is the whole of the player's answer. */
      if (arrived) state.slamTimer = Math.min(state.slamTimer, 0.12);
    }
  }

  /** Draw the line from the spinneret to the trooper's chest. Cheap:
   *  one unit cylinder, re-posed. */
  function updateLine() {
    if (!line.mesh.visible) return;
    const bone = inst?.bones?.get("spinneret");
    const ps = ctx.player?.state;
    if (!bone || !ps) { line.mesh.visible = false; return; }
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(_lineA);
    _lineB.set(ps.x, ps.y + 1.05, ps.z);
    const len = _lineA.distanceTo(_lineB);
    if (len < 0.2) { line.mesh.visible = false; return; }
    line.mesh.position.copy(_lineA).lerp(_lineB, 0.5);
    line.mesh.scale.set(1, len, 1);
    _vec.copy(_lineB).sub(_lineA).normalize();
    line.mesh.quaternion.setFromUnitVectors(line.up, _vec);
  }

  function resolveAction(dt) {
    if (!(state.pending > 0)) return;
    state.pending -= dt;
    if (state.pending > 0) return;
    state.pending = 0;
    if (state.actionKind === "slam") landSlam();
    else if (state.actionKind === "webCast") launchWebBolt();
    else if (state.actionKind === "webReel") launchReelBolt();
    else if (state.actionKind === "bite") landBite();
  }

  /** Advance the body by (vx, vz), clamped to the arena and steered
   *  around masonry. The leg solver does the rest: feet replant on
   *  their own once the body has dragged their rest pose far enough,
   *  which is the entire reason walking costs this module three lines
   *  of physics and no animation. */
  function moveBody(vx, vz, dt) {
    const speed = Math.hypot(vx, vz);
    if (speed < 1e-4) return;
    const ux = vx / speed;
    const uz = vz / speed;
    // A body-height probe ahead; a spire in the way turns the step
    // along its tangent rather than walking the animal into it.
    if (ctx.collide?.rayBlock) {
      const gy = groundAt(inst.x, inst.z);
      const ahead = ctx.collide.rayBlock(inst.x, gy + 4.2, inst.z, ux, 0, uz, 7);
      if (ahead < 7) {
        const side = state.strafeDir;
        const tx = -uz * side;
        const tz = ux * side;
        inst.x += tx * speed * dt;
        inst.z += tz * speed * dt;
        return;
      }
    }
    let nx = inst.x + vx * dt;
    let nz = inst.z + vz * dt;
    // Its territory has an edge and it respects it - see arenaRadius.
    const hx = nx - C.lairX;
    const hz = nz - C.lairZ;
    const home = Math.hypot(hx, hz);
    if (home > C.arenaRadius) {
      nx = C.lairX + (hx / home) * C.arenaRadius;
      nz = C.lairZ + (hz / home) * C.arenaRadius;
    }
    inst.x = nx;
    inst.z = nz;
  }

  function beginLunge() {
    // The rear-up beat, on the same spring the slam uses, so the
    // player is reading one vocabulary rather than two.
    poiseKick(-1.15);
    state.lungeFor = C.lungeSeconds;
    state.lungeTimer = C.lungeCadence;
    const ps = ctx.player.state;
    state.lungeYaw = Math.atan2(ps.x - inst.x, ps.z - inst.z);
    enemies.play(inst, "alert", 0.10);
    ctx.player?.doctrineKick?.(0.5, 0.4);
    bus.emit("lungeTelegraph", { x: inst.x, z: inst.z });
  }

  /** A leg has just gone: drop whatever was being wound up and hold
   *  everything for `legBreakStagger`. See the config note.
   *
   *  IT DOES NOT STACK. A leg broken while the animal is already
   *  staggering cancels whatever it was winding up (there is nothing
   *  to cancel - it was staggering) and does not restart the clock.
   *  A lance breaks a leg every five seconds or so - walk to the next
   *  tarsus, three swings - and gets its window every time; the
   *  Volley, taking a knee a second at range, would otherwise hold
   *  the animal helpless for its entire standing phase, which measured
   *  as a boss that never threw anything at a ranged player at all. */
  function beginStagger() {
    const already = state.staggerFor > 0;
    if (!already) state.staggerFor = C.legBreakStagger;
    const wasWinding = state.pending > 0 || state.lungeFor > 0;
    state.action = 0;
    state.pending = 0;
    state.actionKind = null;
    state.lungeFor = 0;
    // A line under tension parts when the animal holding it buckles.
    endReel("staggered");
    /* The flinch clip - unless a leg-owned clip has the bones, in
       which case playing anything else would hand the folded legs
       back to the walking solver mid-collapse. */
    if (!inst.spec?.legOwnedStates?.includes(inst.state)) enemies.play(inst, "flinch", 0.06);
    bus.emit("stagger", {
      x: inst.x, z: inst.z, seconds: already ? state.staggerFor : C.legBreakStagger,
      cancelled: wasWinding, extended: false,
    });
  }

  function stepStanding(dt, dist) {
    /* THE TRIGGER. Standing only - a leg broken mid-collapse (the
       body is already the target) or mid-recovery does not restart
       the clock; it just counts toward the next one. */
    if (state.recollapseFor > 0) state.recollapseFor -= dt;
    if (inst.legsBroken >= C.collapseThreshold
      && inst.legsBroken > state.legsAtLastCollapse
      && state.recollapseFor <= 0) {
      state.lungeFor = 0;
      endReel("collapsed");
      beginCollapse();
      return;
    }
    /* THE STAGGER. Nothing ticks, nothing is thrown, nothing moves.
       The cadence timers are held rather than run down, so a lost leg
       buys a clean window and not merely a delayed one - the slam it
       postponed does not arrive the instant the window closes. */
    if (state.staggerFor > 0) {
      state.staggerFor -= dt;
      stepReel(dt);
      return;
    }
    state.slamTimer -= dt;
    state.webTimer -= dt;
    state.reelTimer -= dt;
    state.patchTimer -= dt;
    state.lungeTimer -= dt;
    state.action = Math.max(0, state.action - dt);
    const ps = ctx.player.state;

    /* THE LUNGE, mid-flight. A short rear (the first 0.4s of the
       alert clip) and then the sprint; it cashes out into the
       ordinary slam the moment the player is inside its arc, so the
       payoff is a telegraph the player has already learned. The
       heading is COMMITTED at the rear-up and only bends toward the
       player at `lungeSteer` - so a late step off the line is a real
       dodge and the animal barrels past and slams the sand. */
    if (state.lungeFor > 0) {
      state.lungeFor -= dt;
      if (state.lungeFor > C.lungeSeconds - 0.4) return;    // the rear-up beat
      const dx = ps.x - inst.x;
      const dz = ps.z - inst.z;
      const d = Math.hypot(dx, dz) || 1;
      const wantYaw = Math.atan2(dx, dz);
      let turn = wantYaw - state.lungeYaw;
      while (turn > Math.PI) turn -= TAU;
      while (turn < -Math.PI) turn += TAU;
      state.lungeYaw += clamp(turn, -C.lungeSteer * dt, C.lungeSteer * dt);
      moveBody(Math.sin(state.lungeYaw) * C.lungeSpeed,
        Math.cos(state.lungeYaw) * C.lungeSpeed, dt);
      // The body faces the way it is running, at a rate a sprint allows.
      faceYaw(state.lungeYaw, 6, dt, 2.4);
      if (d < C.slamRadius * 0.85 || state.lungeFor <= 0) {
        state.lungeFor = 0;
        beginSlam();
      }
      return;
    }

    if (state.action > 0) { resolveAction(dt); stepReel(dt); return; }
    stepReel(dt);
    /* HAULING. The animal braces and reels; it does not also stalk,
       throw a second silk or lay a patch under a trooper it is
       already dragging - one thing at a time is what makes the reel
       readable, and the queued slam is waiting at the end of it. */
    if (state.reel) {
      if (inst.state !== "alert") enemies.play(inst, "alert", 0.3);
      return;
    }

    /* The reel is thrown at RANGE - it is the answer to a player who
       has learned to stand outside the lunge's reach or to strafe it.
       Beyond `reelPreferRange` a ready line goes before a ready lunge,
       so a player parked at the far edge of the crater meets both
       answers rather than the same sprint every eight seconds. */
    const reelReady = state.reelTimer <= 0 && !state.reel
      && dist > C.reelMinRange && dist < C.reelMaxRange;
    if (reelReady && dist > C.reelPreferRange) { beginWebReel(); return; }
    if (state.lungeTimer <= 0 && !state.reel
      && dist > C.lungeMinRange && dist < C.lungeMaxRange) {
      beginLunge();
      return;
    }
    if (state.slamTimer <= 0 && dist < C.slamRadius * 1.3) { beginSlam(); return; }
    if (reelReady) { beginWebReel(); return; }
    if (state.webTimer <= 0) { beginWebCast(); return; }
    if (state.patchTimer <= 0) {
      state.patchTimer = C.patchCadence;
      const ang = Math.random() * TAU;
      const r = 3 + Math.random() * 6;
      spillPatch(ps.x + Math.cos(ang) * r, ps.z + Math.sin(ang) * r);
      return;
    }

    /* THE STALK. Outside the band it closes, inside it gives ground,
       and held in the band it side-steps - the drift flips direction
       on a slow random clock so the orbit never reads as mechanical. */
    if (Math.random() < dt * 0.15) state.strafeDir = -state.strafeDir;
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    if (dist > C.holdBand[1]) {
      moveBody(ux * C.walkSpeed, uz * C.walkSpeed, dt);
    } else if (dist < C.holdBand[0] - 2) {
      moveBody(-ux * C.backSpeed, -uz * C.backSpeed, dt);
    } else {
      moveBody(-uz * C.strafeSpeed * state.strafeDir,
        ux * C.strafeSpeed * state.strafeDir, dt);
    }
    if (inst.state !== "alert") enemies.play(inst, "alert", 0.3);
  }

  /** Walking home. Health is already back - the reset happened the
   *  moment it gave up (see the disengage block) - so this phase is
   *  pure presentation: the animal turns, crosses its own arena, and
   *  folds down where it started. Crossing its aggro radius on the
   *  way home re-engages it without a second camera steal. */
  function stepReturning(dt, dist) {
    if (dist <= C.aggroRadius) {
      state.phase = "standing";
      enemies.play(inst, "alert", 0.25);
      bus.emit("aggro", { x: inst.x, z: inst.z });
      return;
    }
    const dx = C.lairX - inst.x;
    const dz = C.lairZ - inst.z;
    const home = Math.hypot(dx, dz);
    if (home < 3) {
      state.phase = "dormant";
      state.revealed = false;
      setEncounterGate(true, true);
      enemies.play(inst, "idle", 0.5);
      bus.emit("reset", { x: inst.x, z: inst.z });
      return;
    }
    faceTowards(C.lairX, C.lairZ, 1.6, dt, C.turnRateReturning);
    moveBody((dx / home) * C.returnSpeed, (dz / home) * C.returnSpeed, dt);
  }

  function stepCollapsed(dt) {
    state.timer -= dt;
    /* A leg broken while it is down holds the bite the same way it
       holds everything standing - the window is the window. The
       collapse clock keeps running: the stagger does not extend the
       vulnerable phase, it only quiets it. */
    if (state.staggerFor > 0) {
      state.staggerFor -= dt;
    } else {
      state.action = Math.max(0, state.action - dt);
      if (state.action > 0) resolveAction(dt);
      else if (state.biteTimer === undefined || state.biteTimer <= 0) {
        // Only what is in FRONT of the mouth - see biteCanReach.
        if (biteCanReach(0)) {
          beginBite();
          state.biteTimer = C.biteCadence;
        }
      } else {
        state.biteTimer -= dt;
      }
    }
    if (state.timer <= 0) {
      if (inst.legsBroken >= 8) {
        // No legs left to stand on. Down for good.
        state.timer = 4;
        return;
      }
      beginRecover();
    }
  }

  function stepRecovering(dt) {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.phase = "standing";
      state.recollapseFor = C.recollapseGuard;
      enemies.play(inst, "alert", 0.3);
    }
  }

  const _vec = new THREE.Vector3();
  const _headV = new THREE.Vector3();
  const _lineA = new THREE.Vector3();
  const _lineB = new THREE.Vector3();

  function stepDormantCheck(dist) {
    if (dist <= C.aggroRadius) { beginAlert(); return; }
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death") {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        bus.emit("defeated", { x: inst.x, z: inst.z });
      }
      return;
    }
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);

    if (state.phase === "dormant") { stepDormantCheck(dist); return; }
    if (state.phase === "returning") { stepReturning(dt, dist); return; }

    /* A boss that can be permanently ground out of reach by a
       player who simply leaves is a boss that can be soft-locked -
       full health, no way back to it, in whatever run this is. The
       reset itself is immediate (health, legs, hazards); the walk
       home is presentation on top of it. */
    if (dist > C.disengageRadius && state.phase !== "collapsed") {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginReturn(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "alert") {
      faceTowards(ps.x, ps.z, 1.1, dt);
      state.timer -= dt;
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        releaseEncounterCamera();
      }
      if (state.timer <= 0) {
        releaseEncounterCamera();
        setEncounterGate(false, false);
        state.phase = "standing";
        enemies.play(inst, "alert", 0.3);
      }
      return;
    }

    /* FACING, and when it is allowed to change. Not while an attack
       is wound up (the tell is a commitment: a slam does not care
       where you are and a bite has to be dodgeable by stepping round
       the head), not while staggering off a lost leg, and not while
       the lunge owns it - the sprint faces the way it runs. Otherwise
       a capped turn, slower again on the ground. */
    const committed = state.pending > 0 || state.staggerFor > 0 || state.lungeFor > 0;
    if (!committed) {
      const cap = state.phase === "collapsed" ? C.turnRateCollapsed : C.turnRate;
      faceTowards(ps.x, ps.z, state.phase === "collapsed" ? 0.5 : 1.5, dt, cap);
    }

    if (state.phase === "standing") stepStanding(dt, dist);
    else if (state.phase === "collapsed") stepCollapsed(dt);
    else if (state.phase === "recovering") stepRecovering(dt);
  }

  /** Full strength again - health, legs, everything. Broken legs
   *  regrow, because there is no honest way to leave the fight
   *  half-won and still call the encounter repeatable. */
  function healToFull() {
    inst.health = inst.maxHealth;
    if (inst.legHp) {
      for (let i = 0; i < inst.legHp.length; i += 1) inst.legHp[i] = state.legHealthRef;
    }
    if (inst.legBroken) inst.legBroken.fill(false);
    inst.legsBroken = 0;
    /* The legs grew back, so the paint has to as well - and the
       accumulated surface damage with it, or a healed animal keeps
       every scorch mark the last attempt left on it. */
    if (dress) {
      for (let i = 0; i < dress.broken.length; i += 1) {
        if (!dress.broken[i]) continue;
        dress.broken[i] = false;
        paintLeg(i, false);
      }
    }
    pushSurfaceDamage(0);
    inst.collapsed = false;
    state.legsAtLastCollapse = 0;
    state.lungeFor = 0;
    state.action = 0;
    state.pending = 0;
    state.actionKind = null;
    state.staggerFor = 0;
    endReel("reset");
  }

  /** The player left. Heal NOW - the reset the leash promises must
   *  not depend on the walk home completing - then walk home and
   *  fold up. */
  function beginReturn() {
    healToFull();
    clearHazards();
    releaseEncounterCamera();
    setEncounterGate(false, false);
    state.phase = "returning";
    state.disengageFor = 0;
    enemies.play(inst, "alert", 0.4);
    bus.emit("returning", { x: inst.x, z: inst.z });
  }

  /** The hard variant - QA and save-restore only: snaps home rather
   *  than walking, because a restore has no business animating. */
  function resetToLair() {
    state.defeated = false;
    if (!inst) ensureSpawned();
    if (!inst) return;
    healToFull();
    clearHazards();
    inst.x = C.lairX;
    inst.z = C.lairZ;
    inst.root.position.set(inst.x, inst.y, inst.z);
    state.phase = "dormant";
    state.revealed = false;
    state.disengageFor = 0;
    releaseEncounterCamera();
    setEncounterGate(true, true);
    enemies.play(inst, "idle", 0.4);
    bus.emit("reset", { x: inst.x, z: inst.z });
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    const x = C.lairX;
    const z = C.lairZ;
    inst = enemies.spawn("distaff", x, z, {
      yaw: Math.PI * 0.15,
      eventId: "district-boss:scar",
    });
    if (inst) {
      state.legHealthRef = inst.legHp?.[0] || 340;
      dressInstance();
      setEncounterGate(true, true);
    }
    return inst;
  }

  /** Watch the solver replant feet and turn each landing into dust
   *  and a report. The solver owns WHEN a foot lands; this only
   *  notices that it has - throttled, because eight legs at a sprint
   *  can land two feet in one frame and the second puff buys nothing. */
  function watchFootfalls(dt) {
    state.footfallGap = Math.max(0, state.footfallGap - dt);
    if (!inst.legs) return;
    const running = state.lungeFor > 0 || state.phase === "returning";
    for (let i = 0; i < inst.legs.length; i += 1) {
      const plant = inst.legs[i].plant;
      const memo = plantMemo[i] || (plantMemo[i] = { x: plant.x, z: plant.z });
      const moved = Math.hypot(plant.x - memo.x, plant.z - memo.z);
      if (moved < 0.8) continue;
      memo.x = plant.x;
      memo.z = plant.z;
      if (inst.legBroken?.[i] || state.footfallGap > 0) continue;
      state.footfallGap = 0.12;
      ctx.vfx?.sandSpray?.(plant.x, plant.y + 0.2, plant.z,
        running ? 1.5 : 0.9, 0, 1);
      /* FOOTFALLS THAT MOVE GROUND AND CAMERA IN PROPORTION TO SIZE,
         and the only honest measure of "in proportion" available here
         is how close the player is standing to where twelve metres of
         leg just landed. Squared falloff over 34m, which is a little
         inside the arena, so a player who backs off gets the dust
         without the rumble.

         The magnitudes look small on purpose. `doctrineKick`
         ACCUMULATES into the player's heave and eight legs at a
         sprint plant one every 0.12s (the throttle above), so a kick
         sized to read on its own would settle into a permanent
         earthquake within a second. These settle at about 0.15 heave
         while it is walking beside you and fall away the moment it
         stops - which is the read that was wanted. */
      const ps = ctx.player?.state;
      if (ps) {
        const near = 1 - clamp01(Math.hypot(plant.x - ps.x, plant.z - ps.z) / 34);
        if (near > 0.03) {
          ctx.player?.doctrineKick?.((running ? 0.17 : 0.10) * near * near, 0.92);
        }
      }
      // Every step transmits into the body: the art direction's "the
      // body should never translate on a rail", spent on the spring.
      poiseKick(running ? 0.34 : 0.19);
      bus.emit("footfall", { x: plant.x, y: plant.y, z: plant.z, running });
    }
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    ensureCombatWatch();
    stepInstance(d);
    /* The collapse sink. The clip folds the legs; this brings the
       body down with them, and brings it back up through recovery.
       enemies.js damps inst.y toward (ground - bodyDrop), so the
       change here is a target, not a teleport. */
    const wantDrop = state.phase === "collapsed"
      ? C.collapseDrop
      : state.phase === "recovering" ? C.collapseDrop * 0.35 : 0;
    state.drop = damp(state.drop, wantDrop, 2.4, d);

    /* EVERYTHING BELOW IS GATED ON THE FIGHT BEING LIVE. A dormant
       boss must cost nothing - the Stylite's dormant pose solve once
       cost the whole game 1.3ms a frame and surfaced as the Abbess
       failing her budget - and a folded animal nobody has walked up
       to has no weight to express, no legs to lose and no damage to
       accumulate. The spring is left where it is rather than zeroed,
       so waking it does not start with a jolt. */
    const live = state.phase !== "dormant";
    if (live) {
      stepPoise(d);
      inst.bodyDrop = state.drop + state.poise;
      watchFootfalls(d);
      watchLegBreaks();
      pushSurfaceDamage(1 - clamp01(inst.health / Math.max(1, inst.maxHealth)));
      stepSway(d);
    } else {
      inst.bodyDrop = state.drop;
    }
    updateBolts(d);
    updateLine();
    updatePatches(d);
    updateLairSilk();
  }

  function status() {
    if (!inst) return state.defeated ? {
      phase: "dead", dead: true, defeated: true,
      health: 0, maxHealth: 9000,
      x: C.lairX, z: C.lairZ,
    } : null;
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      legsBroken: inst.legsBroken || 0,
      legCount: inst.legHp ? inst.legHp.length : 8,
      legBroken: inst.legBroken ? [...inst.legBroken] : [],
      collapsed: !!inst.collapsed,
      bodyDrop: Number((inst.bodyDrop || 0).toFixed(2)),
      lunging: state.lungeFor > 0,
      staggerFor: Number(Math.max(0, state.staggerFor).toFixed(2)),
      reeling: !!state.reel,
      action: state.pending > 0 ? state.actionKind : null,
      // Still inside an attack clip (wind-up OR recovery): nothing new
      // is chosen until this clears.
      busy: state.action > 0,
      // The dressing found the asset inside out and turned it - see
      // dressInstance. QA reads this to prove the near wall is drawn.
      windingCorrected: !!dress?.insideOut,
      yaw: Number(inst.yaw.toFixed(3)),
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      homeDist: Number(Math.hypot(inst.x - C.lairX, inst.z - C.lairZ).toFixed(1)),
      dead: inst.state === "death",
      x: Number(inst.x.toFixed(2)),
      z: Number(inst.z.toFixed(2)),
    };
  }

  function snapshot() {
    if (!inst) return state.defeated ? {
      phase: "dead", timer: 0, instanceId: null,
      legsAtLastCollapse: 0, health: 0, maxHealth: 9000,
      legHp: null, legBroken: null, legsBroken: 0,
      x: C.lairX, z: C.lairZ, yaw: 0, defeated: true,
    } : null;
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(state.timer.toFixed(2)),
      legsAtLastCollapse: state.legsAtLastCollapse,
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      legHp: inst.legHp ? [...inst.legHp] : null,
      legBroken: inst.legBroken ? [...inst.legBroken] : null,
      legsBroken: inst.legsBroken || 0,
      x: inst.x, z: inst.z, yaw: inst.yaw,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((candidate) => candidate.eventId === "district-boss:scar")
      || enemies.live.find((candidate) => candidate.key === "distaff"
        && Math.hypot(candidate.x - C.lairX, candidate.z - C.lairZ) < C.arenaRadius);
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    /* A restore can rebind an instance that was spawned before this
       module ever ran - `ensureSpawned` only dresses the one it
       spawns itself, and the dressing is idempotent. */
    dressInstance();
    const phase = ["dormant", "alert", "standing", "collapsed", "recovering",
      "returning", "dead"].includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    /* A restore mid-return finishes the walk; a restore into any
       live phase has, by definition, already seen the animal. */
    state.revealed = phase !== "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.legsAtLastCollapse = Math.max(0, Math.round(Number(saved.legsAtLastCollapse) || 0));
    state.defeated = false;
    state.disengageFor = 0;
    state.recollapseFor = 0;
    state.releaseCameraAt = undefined;
    // Transient beats never survive a save: no wind-up, no stagger,
    // no line on the trooper.
    state.staggerFor = 0;
    state.lungeFor = 0;
    state.action = 0;
    state.pending = 0;
    state.actionKind = null;
    endReel("restore");
    inst.x = Number.isFinite(saved.x) ? saved.x : inst.x;
    inst.z = Number.isFinite(saved.z) ? saved.z : inst.z;
    inst.yaw = Number.isFinite(saved.yaw) ? saved.yaw : inst.yaw;
    inst.root.position.set(inst.x, inst.y, inst.z);
    inst.root.rotation.y = inst.yaw;
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "alert");
    if (Number.isFinite(saved.health)) inst.health = clamp(saved.health, 0, inst.maxHealth);
    if (Array.isArray(saved.legHp) && inst.legHp) {
      for (let i = 0; i < inst.legHp.length; i += 1) {
        inst.legHp[i] = Number.isFinite(saved.legHp[i]) ? saved.legHp[i] : inst.legHp[i];
      }
    }
    if (Array.isArray(saved.legBroken) && inst.legBroken) {
      for (let i = 0; i < inst.legBroken.length; i += 1) inst.legBroken[i] = !!saved.legBroken[i];
    }
    inst.legsBroken = Math.max(0, Math.round(Number(saved.legsBroken) || 0));
    inst.collapsed = phase === "collapsed";
    if (state.defeated || phase === "dead") {
      enemies.play(inst, "death", 0);
      inst.health = 0;
    } else {
      enemies.play(inst, phase === "dormant" ? "idle" : "alert", 0);
    }
    return true;
  }

  function clearHazards() {
    endReel("cleared");
    for (const b of bolts) { b.live = false; b.mesh.visible = false; }
    for (const p of patches) {
      p.life = 0; p.mesh.visible = false; p.mat.uniforms.uFade.value = 0;
    }
    for (const stain of stains) {
      stain.mesh.visible = false;
      stain.mat.uniforms.uFade.value = 0;
    }
  }

  return {
    bus,
    config: C,
    group,
    update,
    status,
    snapshot,
    restore,
    clearHazards,
    spillPatch,
    ensureSpawned,
    /** Force a phase transition, for checks about a phase rather than
     *  about how the animal gets into it - the same reasoning as the
     *  Coulter's `setCoulterPhase`. Only meaningful once spawned. */
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      inst.collapsed = state.phase === "collapsed";
      setEncounterGate(state.phase === "dormant",
        state.phase === "dormant" || state.phase === "alert");
      return { phase: state.phase, timer: state.timer };
    },
    /** Instance accessor. QA-facing rather than gameplay-facing - the
     *  encounter itself only ever needs `status()`. */
    instance() { return inst; },
    /** QA: make `kind` ("slam" | "web" | "reel" | "lunge") the next
     *  thing it throws, by zeroing that cadence and pushing the others
     *  back. Range and phase still apply - this only settles WHICH of
     *  the eligible answers comes first, so a check about the reel is
     *  not at the mercy of the lunge's timer. */
    primeAttack(kind) {
      const key = `${String(kind)}Timer`;
      if (!(key in state)) return false;
      for (const k of ["slamTimer", "webTimer", "reelTimer", "lungeTimer"]) {
        state[k] = k === key ? 0 : Math.max(state[k], 6);
      }
      state.staggerFor = 0;
      return true;
    },
    /** The hard reset - QA and checks about the leash's PROMISE
     *  (full health, home, dormant) rather than the walk that
     *  delivers it. */
    resetToLair,
    dispose() {
      scene.remove(group);
      combatOff?.();
      combatOff = null;
      for (const stain of stains) { stain.mesh.geometry.dispose(); stain.mat.dispose(); }
      lineGeo.dispose();
      /* The dressed geometry and the five materials are this module's
         own - `enemies.js` never saw them - so nothing else can be
         holding them. The species geometry and the caste material it
         DID hand us are deliberately not touched. */
      if (dress) {
        dress.geo.dispose();
        for (const mat of dress.mats) mat.dispose();
        dress = null;
      }
    },
  };
}
