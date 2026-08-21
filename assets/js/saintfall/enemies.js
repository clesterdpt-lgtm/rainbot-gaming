/* ============================================================
   SAINTFALL - enemies

   Loads the Blender-authored .glb bestiary, and owns everything the
   clips deliberately do not.

   The integration trap this module exists to close: a material that
   arrives from GLTFLoader is a plain MeshStandardMaterial. It has
   none of the level's atmosphere injection - no directional aerial
   perspective, no sky-tinted rim - so an enemy standing at 300m
   renders at full contrast in front of a hazed landscape and reads
   as a sticker. Every loaded material is therefore DISCARDED and
   rebuilt through the same `patchMaterial` path the world uses.

   Locomotion is solved here rather than baked, for the reason set
   out in the model pipeline: Vesper-IX is 45-degree crater walls,
   dune slip faces at the angle of repose, trench floors and
   shattered rock. A baked walk cycle foot-slides on all of it.
   ============================================================ */

import { TAU, clamp, clamp01, lerp, damp, makeRng } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { applySurface } from "saintfall/boss-surface.js";

/* Which bones the IK solver owns. Must agree with the `--leg-bones`
   pattern the model optimiser strips channels against; if these two
   drift apart, a clip and the solver end up writing the same bone.

   NOTE THE UNDERSCORE. Blender's mirror convention is `.L`/`.R`, but
   a dot is three's PropertyBinding path separator, so GLTFLoader
   sanitises it out on load and `mandible.L` arrives as `mandibleL`.
   A lookup keyed on the Blender name silently finds nothing, the leg
   array comes back empty, and the IK becomes dead code that fails by
   doing exactly nothing. The rig is authored with underscores so the
   name is identical in Blender, in the .glb and here. */
const LEG_RE = /^(coxa|femur|tibia)(\d+)_(L|R)$/;

/* ONE BROOD, THREE CASTES.
 *
 * The level used to field the Bloom's xenos against the Concord's own
 * walking machines, which was a good story and a bad read: two
 * factions meant two visual languages, and the machine half was
 * competing with the player's own armour for the same iron-and-gold
 * palette. Everything hostile on Vesper-IX is now one animal in three
 * shapes, and the shapes are separated on the axes a player resolves
 * FIRST and at the GREATEST distance:
 *
 *   height    1.2m  ·  3.3m  ·  2.4m
 *   stance    six legs low  ·  four legs stilted  ·  six legs braced
 *   outline   a wedge  ·  an inverted V  ·  a slab
 *   role      swarm melee  ·  ranged  ·  armoured breaker
 *
 * A player who has learned those three outlines can read a ridge line
 * in one glance, which is the entire job. Decoration cannot do it and
 * neither can colour - all three are painted from the same hue family
 * on purpose, because they came out of the same hive.
 */
export const BESTIARY = {
  thresher: {
    url: "assets/models/saintfall/thresher.glb",
    faction: "bloom",
    health: 60,
    /* Authored at 1:1 with the world and scaled here rather than in
       Blender, so proportion can be tuned against the trooper IN
       ENGINE - it is a thing you measure in context, not in the
       abstract. At 0.62 it stands 1.19m: knee-high on a 1.85m
       trooper, which is what makes forty of them read as a horde
       rather than as a queue. */
    scale: 0.62,
    speed: { walk: 2.6, charge: 7.4 },
    material: { roughness: 0.46, metalness: 0.10, rim: 1.5, bio: 1.35 },
    legs: 3,                 // pairs
    stance: 0.58,            // foot reach, in model units
    stepHeight: 0.34,
    collisionRadius: 0.62,
    // Three pixels tall at this range; see the draw-distance tier.
    cullRange: 235,
    clips: ["idle", "alert", "strike", "flinch", "death"],
    // Insect knee: up and outward, above the back.
    kneePole: { up: 1.6, out: 1.0, fwd: 0 },
  },

  gleaner: {
    url: "assets/models/saintfall/gleaner.glb",
    faction: "bloom",
    health: 150,
    /* Shipped at 1:1 and 3.55m tall - nearly twice the trooper, and
       three times the Thresher standing next to it. It is the ranged
       caste, so it has to be identifiable from further away than
       anything else in the game. */
    scale: 1.0,
    speed: { walk: 1.9, charge: 3.6 },
    material: { roughness: 0.52, metalness: 0.06, rim: 1.45, bio: 1.7 },
    legs: 2,                 // pairs
    /* Long strides, and a high one. A stance tuned for the Thresher
       made this thing mince: at 0.58 model units a 3.4m leg was
       re-planting every 20cm, which reads as a shiver rather than as
       a walk. */
    stance: 1.15,
    stepHeight: 0.62,
    collisionRadius: 0.80,
    /* The longest reach in the bestiary, and it has to be: this is
       the unit that shoots you from 52m and stands where you can see
       it from four hundred. Popping the shooters out of a ridge line
       is the one place a draw cutoff would actually be felt. */
    cullRange: 460,
    clips: ["idle", "alert", "fire", "flinch", "death"],
    kneePole: { up: 1.8, out: 0.85, fwd: 0 },
  },

  /* The Choir Spires' district guardian uses the same authored mantis
     anatomy as a Thresher, but it is a separate species contract so its
     boss scale, health and hit volumes never leak into the roaming caste.
     At 1.55 against the ordinary Thresher's 0.62 this silhouette is exactly
     two and a half times taller and wider, which reads as an individual
     guardian rather than a randomly enlarged wave member. */
  precentor: {
    url: "assets/models/saintfall/thresher.glb",
    faction: "bloom",
    health: 3200,
    scale: 1.55,
    speed: { walk: 1.35, charge: 4.25 },
    material: { roughness: 0.46, metalness: 0.10, rim: 1.35, bio: 2.2 },
    legs: 3,
    stance: 1.35,
    stepHeight: 0.68,
    collisionRadius: 1.9,
    cullRange: 620,
    ikRange: 300,
    animRange: 440,
    poseRange: 620,
    shadowRange: 150,
    clips: ["idle", "alert", "strike", "flinch", "death"],
    kneePole: { up: 1.8, out: 0.85, fwd: 0 },
  },

  /* The iron servitor-engine already had an authored model and animation
     set but no runtime role. It now guards the Gilded Reach: a ranged,
     armoured district boss whose Concord palette distinguishes that hunt
     from the five insect encounters. */
  cantor: {
    url: "assets/models/saintfall/cantor.glb",
    faction: "concord",
    health: 3000,
    scale: 1.28,
    speed: { walk: 1.55, charge: 2.8 },
    material: { roughness: 0.48, metalness: 0.34, rim: 1.2, bio: 0.25 },
    legs: 1,
    stance: 0.92,
    stepHeight: 0.44,
    collisionRadius: 1.15,
    cullRange: 620,
    ikRange: 260,
    animRange: 400,
    poseRange: 620,
    shadowRange: 150,
    clips: ["idle", "alert", "fire", "flinch", "death"],
    kneePole: { up: 2.0, out: 0.25, fwd: 1.35 },
  },

  harrow: {
    url: "assets/models/saintfall/harrow.glb",
    faction: "bloom",
    health: 420,
    /* Squat and WIDE. Height is not what makes a heavy read as heavy -
       a wide, low, horizontal mass is, which is why this one is
       shorter than the Gleaner and reads as twice its weight. */
    scale: 1.0,
    speed: { walk: 1.5, charge: 5.4 },
    material: { roughness: 0.44, metalness: 0.16, rim: 1.25, bio: 1.7 },
    legs: 3,                 // pairs
    stance: 0.86,
    stepHeight: 0.40,
    collisionRadius: 1.05,
    cullRange: 330,
    clips: ["idle", "alert", "strike", "flinch", "death"],
    kneePole: { up: 1.5, out: 1.25, fwd: 0 },
  },

  matriarch: {
    url: "assets/models/saintfall/matriarch.glb",
    faction: "bloom",
    /* A district boss, not a heavy caste with a longer bar. The exposed
       gaster still rewards a clean weak-point sequence, but 9000 gives
       its pursuit, Tremor Rite and new grab-slam enough room to form a
       complete fight instead of ending inside the first rotation. */
    health: 15000,
    /* Shipped at 1:1: 5.05m tall, 6.93m wide and 11.13m long. There
       is exactly one of these on the map, so the usual argument for
       tuning scale in engine - that proportion is read against the
       trooper standing next to it - is replaced by a different one:
       it is read against the DISTRICT. At this size it clears the
       Ossuary's ribs and is visible over the crater lip, which is
       what makes walking into the Fallen Saint feel like arriving
       somewhere rather than like entering a bigger arena. */
    scale: 1.0,
    /* Fallback locomotion only; matriarch.js owns the live pursuit pace.
       Kept conservative so a newly spawned instance cannot jump before
       the encounter module adopts it on the same frame. */
    speed: { walk: 1.15, charge: 3.9 },
    material: { roughness: 0.42, metalness: 0.14, rim: 1.3, bio: 2.1 },
    legs: 4,                 // pairs - nothing else in the brood has 8
    /* Long strides. The stance that suits a Harrow would have this
       thing re-planting a 4.5m leg every 86cm, which reads as a
       shiver; the Gleaner's own 1.15 is the closest reference and
       this is longer-legged still. */
    stance: 1.42,
    stepHeight: 0.78,
    collisionRadius: 2.30,
    /* The longest in the game, and it has to be: it is a landmark as
       much as an enemy. Popping in at 460m would be visible against
       an empty crater floor from the Pilgrim's Road. */
    cullRange: 620,
    clips: ["idle", "alert", "strike", "brood", "flinch", "death"],
    /* Flatter and wider than the hexapods. Eight long legs bending
       hard up-and-in read as a knot over the back; splaying the pole
       outward keeps each knee over its OWN foot, which is what makes
       the count legible instead of a thicket. */
    kneePole: { up: 1.35, out: 1.55, fwd: 0 },
  },

  /* ------------------------------------------------------------------
     THE COULTER. The fifth silhouette, and the first that is not a
     walker - so almost everything the four entries above tune does not
     apply to it and the two fields that replace them are new.

     `spine` puts it on the OTHER procedural solver in this file. The
     walkers keep a body the clips pose and legs the IK owns; this one
     is the reverse - the clips own its mouth and nothing else, and its
     entire body is laid along a trail of the points its head has
     already travelled through. That is the only model that makes a
     burrower work: when the head dives, the body follows it down
     through the same hole, because the hole is literally where the
     head was.

     `burrows` is the flag every system that assumes an enemy is
     standing on the ground checks. It is deliberately a capability
     rather than a species test - `key === "coulter"` scattered through
     four modules is how the next burrower becomes a rewrite.
     ------------------------------------------------------------------ */
  coulter: {
    url: "assets/models/saintfall/coulter.glb",
    faction: "bloom",
    /* Half again the Matriarch's, and the number is a consequence of
       the fight's shape rather than a difficulty knob. It is only
       hittable while it is out of the sand, which is about a third of
       the cycle, so raw health has to be read as "health per surfacing"
       - and at 5200 with the maw multiplier it takes four good
       surfacings to kill, which is long enough for the player to have
       to survive the venom rather than out-damage it. */
    health: 5200,
    /* The Coulter is the penultimate boss beneath the Fallen Saint. It is
       four times the former Ossuary silhouette in every dimension; because
       the spine arc is measured from the scaled rig, this also turns its
       twenty-five-metre body into a roughly hundred-metre sand leviathan. */
    scale: 4.64,
    bodyHitScale: 4,
    bodyScale: 4,
    /* `walk` is what it makes when surfaced and anchored - it barely
       moves, because a reared worm is a tower and not a chase. `charge`
       is the BURROWING speed, and it is the fastest thing in the game
       by four metres a second: under the sand it is untouchable, so the
       only cost it can be given for crossing ground is time, and it
       should not be much. */
    speed: { walk: 2.2, charge: 13.5 },
    material: { roughness: 0.50, metalness: 0.08, rim: 1.20, bio: 1.95 },
    legs: 0,
    spine: 13,
    burrows: true,
    stance: 0,
    stepHeight: 0,
    /* The mesosoma is 2.7m across at the swell. This is deliberately
       under that: it is what keeps the animal out of masonry when it
       surfaces, and a radius sized to the widest ring would refuse
       every courtyard on the map. */
    collisionRadius: 7.5,
    /* The longest in the game. It is 25m of animal that rears eight
       metres out of open sand, and a player who watches it dive on one
       side of the basin has to be able to see the wake coming back. */
    cullRange: 700,
    /* Its own tiers, because the defaults were written for creatures a
       tenth of its length: an animal culled for animation at 190m
       would freeze mid-arc in plain sight. */
    ikRange: 300,
    animRange: 420,
    poseRange: 700,
    shadowRange: 150,
    clips: ["idle", "alert", "spew", "strike", "flinch", "death"],
  },

  /* ------------------------------------------------------------------
     THE DISTAFF. Not a sixth silhouette in this brood - it is not the
     Bloom at all, and its BESTIARY entry only carries the fields
     every walker already has. `legs: 4` is the same eight-leg rig the
     Matriarch proved; what makes it a different fight lives in
     combat.js's per-leg hit table and in distaff.js, not here.
     ------------------------------------------------------------------ */
  distaff: {
    url: "assets/models/saintfall/distaff.glb",
    faction: "scar",
    /* Its health is earned through repeated one-leg knockdowns: only
       one limb keeps damage at a time and every rise restores the other
       intact legs, so 11000 supports several readable body windows
       without asking the player to grind eight simultaneous pools. */
    health: 11000,
    /* Driven entirely by distaff.js, the same reason the Coulter opts
       out via `spine`/`burrows` - combat.js's generic stepEnemy has no
       SPEC entry for this key and would fall back to a Thresher's
       sight/hearing/aggro numbers while trying to walk a body the leg
       solver expects to hold still underneath it. */
    selfDriven: true,
    /* Each leg's own pool - 340 is two to three solid hits from a
       decent weapon. Distaff owns the one-injured-leg rule while
       combat.js still pays the ordinary break bonus into this pool. */
    legHealth: 340,
    scale: 1.0,
    /* It does not chase. A stationary guardian that can run the
       player down removes the one thing breaking a leg buys - room to
       stand clear of it - so it plants and reaches instead. */
    speed: { walk: 0.85, charge: 2.4 },
    material: { roughness: 0.38, metalness: 0.10, rim: 1.30, bio: 2.4 },
    legs: 4,                 // pairs - eight, the Matriarch's own rig
    /* Long, high strides for a body carried nine metres up on them. A
       stance tuned for anything else in the bestiary would have this
       replanting a twelve-metre leg every few centimetres, which
       reads as a shiver on something this size rather than a walk. */
    stance: 2.35,
    stepHeight: 1.15,
    collisionRadius: 3.5,
    /* A landmark from across the crater, and it has to be: this is
       the one thing standing in the Glass Scar taller than its own
       fulgurite spires. */
    cullRange: 780,
    ikRange: 340,
    animRange: 500,
    poseRange: 780,
    shadowRange: 180,
    clips: ["idle", "alert", "slam", "webCast", "collapse", "bite",
      "recover", "flinch", "death"],
    /* Flared hard outward and barely lifted - the tarantula stance,
       and the opposite bend from every insect knee in the bestiary.
       This is what puts the knees over its own back instead of tucked
       beneath it, which is the entire silhouette. */
    kneePole: { up: 0.85, out: 2.1, fwd: 0 },
    /* `collapse`/`recover` bend the leg bones directly, the same
       trick `death` uses everywhere else - see `solveLegs`. Both are
       exported with those channels; the model pipeline's hard gate
       fails the build if any OTHER clip leaks a leg channel. */
    legOwnedStates: ["collapse", "recover"],
  },

  /* ------------------------------------------------------------------
     THE WINNOWER. The first thing in the bestiary that leaves the
     ground, and the only entry here whose `y` is not a terrain sample.

     `flies` is a capability rather than a species test, for the same
     reason `burrows` is: the moment a second flyer exists, every
     system that assumes a creature stands on something needs one flag
     to ask rather than a growing list of keys to compare against.
     ------------------------------------------------------------------ */
  winnower: {
    url: "assets/models/saintfall/winnower.glb",
    faction: "censer",
    /* Lower than the Distaff's, and it should be: this one cannot be
       cornered. 7800 survives long enough for its growing bombard to
       become visible without turning each landed window into a token. */
    health: 7800,
    scale: 1.0,
    /* `walk` is its cruise on a thermal; `charge` is the dive. It is
       the fastest thing in the game across open ground because it
       does not touch any. */
    speed: { walk: 8.5, charge: 22.0 },
    material: { roughness: 0.54, metalness: 0.12, rim: 1.45, bio: 2.2 },
    flies: true,
    /* Driven by winnower.js. Same opt-out the Distaff takes and for
       the same reason - there is no SPEC entry for this key, and the
       generic walker would try to path a flying creature across
       terrain it never touches. */
    selfDriven: true,
    /* How much punishment the heat sacs can absorb before the animal
       cannot hold altitude. Four hits' worth at the sac multiplier -
       enough that draining it is a deliberate investment of fire, and
       little enough that it is a real alternative to waiting out the
       timer. */
    liftPool: 4,
    legs: 0,
    stance: 0,
    stepHeight: 0,
    /* Sized to the BODY, not the span. A radius cut to twenty-six
       metres of wing would refuse every gap in the refinery and shove
       the animal out of its own district the moment it landed. */
    collisionRadius: 1.8,
    /* The longest sightline in the game after the Coulter's, and for
       the opposite reason: this one is usually ABOVE the horizon, so
       it is visible from anywhere in the basin that can see sky. */
    cullRange: 820,
    animRange: 560,
    poseRange: 820,
    shadowRange: 200,
    /* "sweep" was authored into the model and played by winnower.js
       but missing from this list for one build - and this list is
       what decides which clips get actions at all, so the grounded
       attack animated NOTHING and the miss was silent. The fight
       harness now asserts the module's own attack clips exist. */
    clips: ["idle", "alert", "bombard", "strain", "land", "stoke",
      "launch", "sweep", "sprawl", "flinch", "death"],
  },

  /* ------------------------------------------------------------------
     THE GARNER. The Ossuary's own animal, and the first entry here with
     no .glb behind it at all.

     `procedural` is why. Every other creature in this bestiary is a
     skinned mesh with authored clips, which is the right pipeline for
     anything with a skeleton and a walk cycle - and the wrong one for
     this. The Garner is a mouth in the ground with six tentacles, and
     both halves of that are things a baked rig cannot do: the pit has
     to OPEN, which is per-vertex motion on seventy-eight separate
     plates, and a tentacle has to whip, miss, fall limp across the sand
     and drag itself home, which is a chain solved against live terrain
     rather than a clip that was correct on the day it was exported.

     So the species loads as an empty root and garner.js builds and
     poses everything inside it. Declared as a capability rather than
     tested by key for the same reason `flies`, `burrows` and
     `selfDriven` are: this file should never learn what a tentacle is.
     ------------------------------------------------------------------ */
  garner: {
    procedural: true,
    faction: "bloom",
    /* Between the Distaff's and the Winnower's, and the shape of the
       fight is why it sits there rather than higher. Six tentacles
       guard it, each with its own pool, and every one that breaks pays
       into this - so the number the player actually chews through is
       half again this figure. */
    health: 7400,
    scale: 1.0,
    /* One pool per tentacle. Deliberately softer than a Distaff leg:
       a tentacle is only reachable while it is DOWN, and that window
       is about five seconds long, so a limb that took three of them to
       cut would make the whole melee mechanic theoretical. */
    legHealth: 260,
    /* It does not go anywhere. Speed is here because the shared systems
       read it, not because anything uses it. */
    speed: { walk: 0, charge: 0 },
    material: { roughness: 0.62, metalness: 0.04, rim: 1.15, bio: 2.2 },
    selfDriven: true,
    /* The tentacles live in `inst.legs` so that combat.js's existing
       per-limb hit table, melee reach gate and break bonus all apply
       unchanged - see HITBOX.garner. They are NOT legs, though, and the
       walking solver must never touch them: it would replant six
       fifteen-metre limbs onto the terrain as feet. */
    legs: 0,
    selfPosedLegs: true,
    stance: 0,
    stepHeight: 0,
    /* The maw's own bulk. Nothing should be able to walk through the
       mouth, and this is what keeps spawned brood out of it. */
    collisionRadius: 7.0,
    /* A landmark inside the ribcage, and it has to draw from the rim of
       the pan - the whole point of the district is that you can see
       what is waiting in the middle of it. */
    cullRange: 700,
    ikRange: 320,
    animRange: 480,
    poseRange: 700,
    shadowRange: 180,
    clips: [],
  },

  /* ------------------------------------------------------------------
     THE STYLITE. The Choir Spires' tenant, and the third procedural
     entry - by now the established path for a creature whose whole
     read is motion rather than surface.

     What moves: two hind springs that compress to a quarter of their
     length and unload in a frame. That is a hinge problem, not a
     deformation one, so unlike the Garner's tentacles and the Abbess's
     sac this module poses a HIERARCHY of groups rather than rewriting
     vertices - see the note in stylite.js. It is still procedural
     because the alternative is a .glb whose only content is six
     rotations.

     `perches` is the capability flag: it is not a flyer, but like one
     it spends most of the fight out of a polearm's reach, and every
     system that asks "can I melee this" needs one thing to check.
     ------------------------------------------------------------------ */
  stylite: {
    procedural: true,
    faction: "bloom",
    /* It is not meant to be out-damaged, it is meant to be brought DOWN.
       Most damage still lands in the stunned melee window, while 7000
       gives its expanded barrages more than one chance to matter. */
    health: 7000,
    scale: 1.0,
    speed: { walk: 0, charge: 0 },
    material: { roughness: 0.58, metalness: 0.06, rim: 0.42, bio: 1.5 },
    selfDriven: true,
    /* Out of reach unless it is on the ground - the same gate the
       Winnower's `flies` opens, for a creature that never flies. */
    perches: true,
    legs: 0,
    stance: 0,
    stepHeight: 0,
    collisionRadius: 1.6,
    /* It lives on the crowns of hundred-metre needles and is a
       silhouette against open sky from anywhere in the district. */
    cullRange: 700,
    ikRange: 320,
    animRange: 520,
    poseRange: 700,
    shadowRange: 160,
    clips: [],
  },

  /* ------------------------------------------------------------------
     THE ABBESS. The Bloom's queen, and the second entry here with no
     .glb - the Garner having established that a creature whose whole
     surface deforms is better served by a module than by a rig.

     What deforms: twenty metres of egg sac that breathes at rest, runs
     a peristaltic wave down its length every time she lays, and heaves
     bodily off the chamber floor to slam. Three superimposed radial and
     axial deformations, which a skeleton can only approximate with
     enough bones to cost more than the mesh does.

     She also has no `legs` and no `spine`: she does not walk and she
     has no chain to follow. What she publishes instead is
     `inst.sacSpine`, read by combat.js's `queenHit`.
     ------------------------------------------------------------------ */
  abbess: {
    procedural: true,
    faction: "bloom",
    /* The largest pool in the game after the Distaff's, and for a
       reason that is the opposite of the Distaff's: hers is not guarded
       by sub-targets, it is REFILLED. Every child that walks home feeds
       her, so the number the player has to out-damage depends on how
       well they hold the room rather than on how well they aim. At 12000
       a fight that ignores the brood entirely does not converge. */
    health: 12000,
    scale: 1.0,
    speed: { walk: 0, charge: 0 },
    material: { roughness: 0.44, metalness: 0.02, rim: 1.05, bio: 1.35 },
    selfDriven: true,
    legs: 0,
    stance: 0,
    stepHeight: 0,
    /* Sized to the THORAX, not the animal. A radius cut to twenty-six
       metres of queen would refuse her own chamber and shove every
       Thresher she lays out through the spire ring. */
    collisionRadius: 3.4,
    /* She is a landmark inside a walled clearing rather than across the
       basin, so this is shorter than the Garner's - but her sac is the
       brightest object in the district at night and has to survive the
       walk in from the Bloom's edge. */
    cullRange: 560,
    ikRange: 300,
    animRange: 420,
    poseRange: 560,
    shadowRange: 170,
    clips: [],
  },
};

/* ============================================================
   WHAT EACH SPECIES IS MADE OF

   Kept HERE rather than as a `surface:` key inside each BESTIARY
   entry, for a coordination reason rather than a design one: the
   bestiary table is where seven other modules' authors go to tune
   their own boss, and the surface kit is one owner's contract. One
   table, one edit, no merge fight over a hundred-line species block.

   A boss agent that wants to argue for a different family may still
   set `material.surface` on its own entry - that wins over this map.

   The Concord's servitor-engine is the only thing in the bestiary
   that is NOT an animal, and it must not read as one: it gets the
   corroded-bronze family, which is the whole reason "different parts
   read as different materials" is a testable claim rather than a
   slogan. Stand a Cantor next to a Precentor and the machine should
   look pitted and rubbed where the insect looks pored and wet.

   ONLY THE .glb SPECIES ARE REACHED FROM HERE. The Garner, the
   Stylite and the Abbess are `procedural: true` - the loader hands
   their modules an empty root and they build and surface their own
   materials - so those three opt in with the same one-line call in
   their own files. They are absent from this map on purpose, so it
   cannot claim credit for a surface it does not apply.
   ============================================================ */
const SPECIES_SURFACE = {
  thresher: "chitin",
  gleaner: "chitin",
  precentor: "chitin",
  harrow: "chitin",
  matriarch: "chitin",
  coulter: "chitin",
  distaff: "chitin",
  winnower: "chitin",
  cantor: "bronze",
};

function surfaceFamily(key, spec) {
  return (spec.material && spec.material.surface) || SPECIES_SURFACE[key] || "chitin";
}

/* ============================================================
   LOADING
   ============================================================ */

/* ============================================================
   WHERE A CORPSE COMES TO REST

   A death clip only rotates bones - nothing in this bestiary animates
   root motion - so the body's ORIGIN stays exactly where the creature
   was standing while the pose underneath it collapses. That is fine
   for a Thresher, whose legs fold under a body already at ankle
   height, and badly wrong for a Gleaner: it dies on four three-metre
   stilts, the stilts fold, and the corpse is left hanging a metre in
   the air with its legs tucked beneath it.

   Measured rather than hand-tuned, because the number is a property of
   the CLIP: re-author the death animation and the correction follows
   it without anybody remembering that a constant exists. The clip is
   posed once at load on a throwaway clone, and the skinned mesh is
   asked where it actually ends up.

   The 4th percentile rather than the true minimum. A single claw or
   antenna tip left pointing straight down would otherwise lift the
   whole body onto it - a corpse balanced on one spike, which is a
   worse artefact than the one being fixed.
   ============================================================ */
const DEATH_REST_PERCENTILE = 0.04;
/* And then a little further, so the body BEDS IN. A corpse whose
   lowest point rests exactly on the surface reads as laid on the sand
   rather than fallen into it. */
const DEATH_BED_IN = 0.09;

export async function buildEnemies(ctx, onProgress) {
  const { THREE, scene, atmos, terrain } = ctx;
  const groundY = (x, z) => ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : (terrain.groundHeightAt ? terrain.groundHeightAt(x, z) : terrain.heightAt(x, z));
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { clone: cloneSkinned } = await import("three/addons/utils/SkeletonUtils.js");

  const group = new THREE.Group();
  group.name = "enemies";
  /* The whole bestiary is taken off three's automatic scene walk HERE,
     at the group, and not on each instance.

     The flag has to go on the parent because of how the walk is
     written: a node checks `child.matrixWorldAutoUpdate` before
     recursing, but it also checks its OWN copy of that flag before
     writing its own matrixWorld - so an object with the flag cleared
     can never have its world matrix updated again, not even by an
     explicit `updateMatrixWorld(true)`. Setting it per instance
     therefore did not make them cheap, it made them permanently
     stuck at the world origin in their bind pose, invisible at the
     spot they were supposed to be standing.

     Cleared on the group instead, the scene walk stops at the group
     and every instance keeps working normally when `update` below
     asks it to. The group itself never moves, so its identity world
     matrix stays correct without maintenance. */
  group.matrixWorldAutoUpdate = false;
  scene.add(group);

  const loader = new GLTFLoader();
  const species = new Map();
  const names = Object.keys(BESTIARY);

  /**
   * Pose a throwaway clone at the last frame of its death clip and ask
   * the skinned mesh where it ended up.
   *
   * Returns how far the root must move for the finished pose to rest on
   * y=0, at scale 1. Positive lifts a body that would otherwise sink;
   * negative drops one left hanging on folded legs.
   */
  function measureDeathRest(source, clip) {
    if (!source || !clip) return 0;
    const probe = cloneSkinned(source);
    probe.position.set(0, 0, 0);
    probe.rotation.set(0, 0, 0);
    probe.scale.setScalar(1);

    let mesh = null;
    probe.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    if (!mesh || typeof mesh.getVertexPosition !== "function") return 0;

    const mixer = new THREE.AnimationMixer(probe);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    // The last frame the player will ever see of this creature, minus
    // an epsilon: exactly `duration` can wrap on a looping binding.
    mixer.setTime(Math.max(0, clip.duration - 1e-3));
    probe.updateMatrixWorld(true);

    const v = new THREE.Vector3();
    const count = mesh.geometry.attributes.position.count;
    const heights = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      heights[i] = v.y;
    }
    heights.sort();
    const index = Math.min(count - 1,
      Math.max(0, Math.floor(count * DEATH_REST_PERCENTILE)));
    mixer.stopAllAction();
    const rest = heights[index];
    return Number.isFinite(rest) ? -rest : 0;
  }

  for (let i = 0; i < names.length; i += 1) {
    const key = names[i];
    const spec = BESTIARY[key];

    /* A creature with no .glb behind it. The species is registered as an
       empty root with no clips, and the module that owns the creature
       builds its geometry into `inst.root` after spawning it.

       Registered HERE rather than skipped so that everything downstream
       is unchanged: it gets an id, a health pool, a save entry, a cull
       range and a place in `enemies.live`, and `spawn` does not grow a
       second path. An AnimationMixer over an empty group and a `play`
       that finds no action are both already no-ops, and `kill` already
       sets the authoritative combat state for a creature with no death
       clip - see the Apostate, which uses a procedural fall. */
    if (spec.procedural) {
      const root = new THREE.Group();
      root.name = `sf-enemy-${key}`;
      species.set(key, {
        key, spec, source: root, clips: new Map(), material: null,
        deathSettle: 0, deathSeconds: 0,
      });
      if (onProgress) onProgress((i + 1) / names.length, `Waking the ${key}`);
      continue;
    }

    let gltf = null;
    try {
      /* Versioned like every other asset on the site. The .glb was
         the one thing in the loading path that was NOT - the module
         graph all carries `?v=` from boot.js - so a returning player
         got the new code and the old bestiary, which fails in the
         worst possible way: the rig loads, the bone names still
         match, and the creature animates correctly while looking
         like the previous build. */
      const href = new URL(`../../../${spec.url}`, import.meta.url).href
        + (ctx.build ? `?v=${ctx.build}` : "");
      gltf = await loader.loadAsync(href);
    } catch (error) {
      console.warn(`[saintfall] enemy "${key}" failed to load`, error);
      continue;
    }

    /* One material per species, built here rather than taken from
       the file. Also flat-shaded: everything in SAINTFALL above the
       sand is faceted, and a smooth-shaded enemy reads as belonging
       to another game. */
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: spec.material.roughness,
      metalness: spec.material.metalness,
    });
    mat.name = `sf-enemy-${key}`;
    /* `bio` reads COLOR_0's alpha as an emissive mask - see art.js.
       The bestiary paints eyes, glands and the membrane between plates
       into that channel, so a creature lights its own detail without
       a second material and therefore without a second draw call per
       instance. Above 1 it clears the bloom chain's bright threshold,
       which is what makes an eye read at night.

       `applySurface` REPLACES the old `patchMaterial` call rather than
       sitting next to it - it goes through the same door and takes the
       same rim and bio, and calling both would trip the patch path's
       already-patched early return and leave the surface silently off.

       `scale` is what makes the grain world-sized. These models are
       authored at 1:1 and drawn at whatever `spec.scale` says, so
       without it a Thresher at 0.62 would wear a grain 60% too fine
       and a Precentor at 1.55 one half again too coarse - the same
       animal, in two different materials, standing next to each other.

       `shared: true` because this is ONE material for every instance
       of the caste. Forty Threshers share it, so it must never take a
       per-instance damage write; the kit refuses one. A boss that
       wants a damage response owns its own material. */
    applySurface(mat, atmos, surfaceFamily(key, spec), {
      rim: spec.material.rim,
      glitter: 0,
      bio: spec.material.bio ?? 0,
      scale: spec.scale ?? 1,
      shared: true,
    });

    let sourceMesh = null;
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return;
      // COLOR_0 is linear per the glTF spec, and the level's own
      // vertex colours are linear too - so no conversion here. If
      // this ever needs one, the bug is in the exporter.
      if (!child.geometry.attributes.color) {
        console.warn(`[saintfall] enemy "${key}" has no COLOR_0; it will render white`);
      }
      child.material = mat;
      child.castShadow = true;
      child.receiveShadow = true;

      /* Culled, against a deliberately generous bounding sphere.
         This was `frustumCulled = false`, on the sound reasoning that
         a skinned mesh's bounds go stale the moment a clip poses it -
         but the cost of that reasoning was one draw call per enemy
         from anywhere on the map, and garrisoning the level put 35
         unconditional draw calls into every frame whether or not a
         single machine was on screen.

         Inflating the bind-pose sphere is the cheap correct answer:
         a pose can move a vertex, but not by more than the model's
         own size, so a radius at 2.4x cannot be escaped by anything
         short of a clip that flings a limb into the next district. */
      child.geometry.computeBoundingSphere();
      if (child.geometry.boundingSphere) child.geometry.boundingSphere.radius *= 2.4;
      child.frustumCulled = true;
      sourceMesh = child;
    });
    if (!sourceMesh) {
      console.warn(`[saintfall] enemy "${key}" contained no mesh`);
      continue;
    }

    const clips = new Map();
    for (const clip of gltf.animations) clips.set(clip.name, clip);

    const death = clips.get("death");
    species.set(key, {
      key, spec, source: gltf.scene, clips, material: mat,
      /* How far the root has to move for the FINISHED death pose to lie
         on the sand, and how long the clip takes to get there. Both
         measured off the model at load - see `measureDeathRest`. */
      deathSettle: measureDeathRest(gltf.scene, death),
      deathSeconds: death ? death.duration : 0,
    });
    if (onProgress) onProgress((i + 1) / names.length, `Waking the ${key}`);
  }

  /* ============================================================
     INSTANCES
     ============================================================ */

  const live = [];
  const rng = makeRng((ctx.seed ^ 0x3e5e17) >>> 0 || 991);
  let nextId = 1;
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  /* ------------------------------------------------------------
     EMERGENCE

     The animation is deliberately split between the creature and the
     ground. A model merely translated upward reads as an elevator; a
     telegraphed fissure, thrown debris, a compressed body and a slight
     overshoot read as something forcing its way through a surface.
     ------------------------------------------------------------ */
  const fissureGeo = new THREE.RingGeometry(0.42, 1, 40, 1);
  const shardGeo = new THREE.OctahedronGeometry(0.18, 0);
  const shardMat = new THREE.MeshStandardMaterial({
    color: 0x5b3021,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
  });
  patchMaterial(shardMat, atmos, { rim: 0.15, glitter: 0 });
  /* WARM STUB. makeEmergenceFx builds its meshes on demand, so this
     shared shard material had no object in the graph at boot - and
     the boot warm-up compiles the materials OF OBJECTS, so a bare
     material is invisible to it. Its program therefore compiled on
     the first emergence of the session, which is always mid-fight.
     One hidden zero-cost mesh keys it at load instead. */
  {
    const warm = new THREE.Mesh(shardGeo, shardMat);
    warm.name = "sf-emergence-shard-warm";
    warm.visible = false;
    warm.frustumCulled = false;
    group.add(warm);
  }

  function makeEmergenceFx(inst, spec) {
    const fx = new THREE.Group();
    fx.name = `sf-breach-${inst.key}`;
    fx.position.set(inst.x, inst.y + 0.07, inst.z);

    const darkMat = new THREE.MeshBasicMaterial({
      color: 0x2b0d0b,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: inst.key === "matriarch" ? 0xffb13b : 0xdf6b24,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const dark = new THREE.Mesh(fissureGeo, darkMat);
    const glow = new THREE.Mesh(fissureGeo, glowMat);
    dark.rotation.x = -Math.PI * 0.5;
    glow.rotation.x = -Math.PI * 0.5;
    glow.scale.setScalar(0.73);
    dark.renderOrder = 3;
    glow.renderOrder = 4;
    fx.add(dark, glow);

    const shards = [];
    const shardCount = inst.key === "matriarch" ? 16 : inst.key === "harrow" ? 12 : 9;
    for (let i = 0; i < shardCount; i += 1) {
      const angle = (i / shardCount) * TAU + rng() * 0.35;
      const shard = new THREE.Mesh(shardGeo, shardMat);
      const size = (0.55 + rng() * 1.05) * (inst.key === "matriarch" ? 2.4 : 1);
      shard.scale.set(size * 0.75, size * (0.7 + rng()), size);
      shard.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
      shard.visible = false;
      shard.userData.breach = {
        angle,
        reach: spec.radius * (0.55 + rng() * 0.72),
        lift: spec.radius * (0.28 + rng() * 0.34),
        spin: (rng() - 0.5) * 5,
      };
      fx.add(shard);
      shards.push(shard);
    }
    scene.add(fx);
    return { group: fx, dark, glow, shards, darkMat, glowMat };
  }

  function disposeEmergence(inst) {
    const fx = inst.emerging?.fx;
    if (!fx) return;
    scene.remove(fx.group);
    fx.darkMat.dispose();
    fx.glowMat.dispose();
    inst.emerging.fx = null;
  }

  function configureEmergence(inst, options) {
    const duration = reducedMotion ? Math.min(0.42, options.duration || 1.2) : options.duration || 1.2;
    const depth = Math.max(0.7, options.depth || 1.3);
    const radius = Math.max(1.8, inst.spec.collisionRadius * (options.boss ? 3.0 : 3.1));
    inst.emerging = {
      active: true,
      surfaced: false,
      burst: false,
      elapsed: 0,
      delay: reducedMotion ? Math.min(0.2, options.delay || 0) : Math.max(0, options.delay || 0),
      duration,
      depth,
      radius,
      baseScale: inst.root.scale.x,
      fx: null,
    };
    inst.emerging.fx = makeEmergenceFx(inst, inst.emerging);
    inst.root.position.y = inst.y - depth;
    inst.root.scale.setScalar(inst.emerging.baseScale * 0.68);
    inst.state = "emerge";
    inst.suspicion = 0;
    inst.alerted = false;
  }

  function updateEmergence(inst, dt, silent = false) {
    const e = inst.emerging;
    if (!e) return false;
    e.elapsed += dt;
    const fx = e.fx;

    if (e.active && e.elapsed < e.delay) {
      const pulse = 0.5 + Math.sin(e.elapsed * 8.5 + inst.x * 0.07) * 0.5;
      const warning = 0.66 + pulse * 0.22;
      fx.dark.scale.setScalar(e.radius * warning);
      fx.glow.scale.setScalar(e.radius * (0.52 + pulse * 0.16));
      fx.darkMat.opacity = 0.34 + pulse * 0.22;
      fx.glowMat.opacity = 0.17 + pulse * 0.16;
      fx.group.rotation.y += dt * 0.18;
      return true;
    }

    const t = clamp01((e.elapsed - e.delay) / Math.max(0.01, e.duration));
    if (e.active && !e.burst) {
      e.burst = true;
      if (!silent) {
        ctx.vfx?.breach?.(inst.x, inst.y, inst.z, e.radius,
          inst.key === "matriarch" ? 1.8 : 1);
      }
    }

    if (e.active) {
      const rise = 1 - Math.pow(1 - t, 3);
      const settle = Math.sin(t * Math.PI) * e.depth * 0.055;
      inst.root.position.set(inst.x, inst.y - e.depth * (1 - rise) + settle, inst.z);
      const widen = Math.sin(t * Math.PI) * 0.09;
      const base = e.baseScale;
      inst.root.scale.set(
        base * (0.68 + rise * 0.32 + widen),
        base * (0.52 + rise * 0.48 - widen * 0.35),
        base * (0.68 + rise * 0.32 + widen)
      );
      inst.root.rotation.x = Math.sin(t * Math.PI * 3) * (1 - t) * 0.075;
      inst.root.rotation.z = Math.sin(t * Math.PI * 2.2 + inst.yaw) * (1 - t) * 0.06;

      fx.dark.scale.setScalar(e.radius * (0.72 + t * 0.82));
      fx.glow.scale.setScalar(e.radius * (0.55 + t * 0.48));
      fx.darkMat.opacity = (1 - t * 0.72) * 0.65;
      fx.glowMat.opacity = (1 - t) * 0.52;
      for (const shard of fx.shards) {
        const s = shard.userData.breach;
        shard.visible = t > 0.015;
        const travel = Math.min(1, t * 1.65);
        shard.position.set(
          Math.cos(s.angle) * s.reach * travel,
          Math.sin(travel * Math.PI) * s.lift + 0.05,
          Math.sin(s.angle) * s.reach * travel
        );
        shard.rotation.x += dt * s.spin;
        shard.rotation.z -= dt * s.spin * 0.7;
      }

      if (t >= 1) {
        e.active = false;
        e.surfaced = true;
        inst.root.position.set(inst.x, inst.y, inst.z);
        inst.root.scale.setScalar(e.baseScale);
        inst.root.rotation.x = 0;
        inst.root.rotation.z = 0;
        inst.suspicion = 1;
        inst.alerted = true;
        play(inst, "alert", 0.12);
      }
      return e.active;
    }

    const after = (e.elapsed - e.delay - e.duration) / 0.72;
    if (fx) {
      const fade = 1 - clamp01(after);
      fx.darkMat.opacity = fade * 0.18;
      fx.glowMat.opacity = fade * 0.08;
      for (const shard of fx.shards) shard.visible = fade > 0.01;
    }
    if (after >= 1) {
      disposeEmergence(inst);
      inst.emerging = null;
    }
    return false;
  }

  /** A caste's starting health under the live difficulty tier. */
  function spawnHealth(key, opts = {}) {
    const base = opts.health ?? species.get(key)?.spec?.health ?? 100;
    if (opts.exactHealth) return base;
    const scale = ctx.difficulty?.healthScale?.(key) ?? 1;
    return Math.max(1, Math.round(base * scale));
  }

  /**
   * Re-fit every live pool to a new tier, proportionally. A tier change in
   * the entry panel or the field menu must not leave the garrison that was
   * spawned at boot on the old numbers - and a wounded creature stays
   * wounded by the same fraction.
   */
  function rescaleForDifficulty(previousTier, nextTier) {
    const scaleFor = ctx.difficulty?.healthScale;
    if (typeof scaleFor !== "function") return 0;
    let touched = 0;
    for (const inst of live) {
      if (inst.state === "death") continue;
      const before = scaleFor(inst.key, previousTier) || 1;
      const after = scaleFor(inst.key, nextTier) || 1;
      if (before === after) continue;
      const factor = after / before;
      const maxHealth = Math.max(1, Math.round((inst.maxHealth || 1) * factor));
      const health = Math.max(1, Math.min(maxHealth, Math.round((inst.health || 1) * factor)));
      inst.maxHealth = maxHealth;
      inst.health = health;
      touched += 1;
    }
    return touched;
  }

  function spawn(key, x, z, opts = {}) {
    const sp = species.get(key);
    if (!sp) return null;

    // SkeletonUtils.clone, not Object3D.clone: a plain clone shares
    // the skeleton, so every instance strikes when one of them does.
    const root = cloneSkinned(sp.source);
    root.scale.setScalar(sp.spec.scale * (opts.scale || 1));
    const mixer = new THREE.AnimationMixer(root);

    const actions = new Map();
    for (const [name, clip] of sp.clips) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
      actions.set(name, action);
    }

    const bones = new Map();
    root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });

    /* Gather the leg chains the solver owns, and remember each
       foot's rest position in the creature's own space - that is the
       target the solver steps toward and the reference the stride is
       measured against. */
    const legs = [];
    for (let i = 0; i < sp.spec.legs; i += 1) {
      for (const side of ["L", "R"]) {
        const coxa = bones.get(`coxa${i}_${side}`);
        const femur = bones.get(`femur${i}_${side}`);
        const tibia = bones.get(`tibia${i}_${side}`);
        const toe = bones.get(`foot${i}_${side}`);
        if (!coxa || !femur || !tibia || !toe) continue;
        legs.push({
          i, side, coxa, femur, tibia, toe,
          sign: side === "L" ? 1 : -1,
          // Alternating tripod: legs 0L, 1R, 2L step together, then
          // the other three. It is what actual hexapods do and the
          // only gait that keeps a six-legged body statically stable
          // at every instant of the cycle.
          phase: ((i + (side === "L" ? 0 : 1)) % 2) * 0.5,
          rest: new THREE.Vector3(),
          plant: new THREE.Vector3(),
          target: new THREE.Vector3(),
          foot: new THREE.Vector3(),
          outward: new THREE.Vector3(),
          forward: new THREE.Vector3(),
          femurLen: 0,
          tibiaLen: 0,
          stepping: 0,
        });
      }
    }

    /* The other chain: a body, front to back. Gathered by exactly the
       same name-driven approach as the legs and for the same reason -
       the solver works on any rig that follows the convention, at any
       scale, without being told the creature's proportions. */
    const spine = [];
    for (let i = 0; i < (sp.spec.spine || 0); i += 1) {
      const bone = bones.get(`spine${String(i).padStart(2, "0")}`);
      if (bone) spine.push(bone);
    }

    let skin = null;
    root.traverse((o) => { if (o.isSkinnedMesh && !skin) skin = o; });

    const inst = {
      id: typeof opts.id === "string" && opts.id ? opts.id : `sf-enemy-${nextId++}`,
      key, root, mixer, actions, bones, legs, spine, skin,
      spec: sp.spec,
      x, z,
      y: groundY(x, z),
      yaw: opts.yaw ?? rng() * TAU,
      speed: 0,
      state: "idle",
      /* Scaled by the live difficulty tier at spawn (see difficulty.js:
         health is the ranged-side tax). A restore passes `exactHealth`,
         because a saved pool was scaled when it was first spawned and the
         tier is restored from the same file. */
      health: spawnHealth(key, opts),
      maxHealth: spawnHealth(key, opts),
      damageScale: Number.isFinite(opts.damageScale) ? opts.damageScale : 1,
      eventId: opts.eventId || null,
      eventWave: Number.isFinite(opts.eventWave) ? opts.eventWave : null,
      stride: 0,
      current: null,
      knockbackX: 0,
      knockbackZ: 0,
      knockbackTime: 0,
      /* Seconds of "on the floor". Honoured by combat's `stepEnemy`,
         which is where every decision a creature makes lives - set
         here and read there, so a stunned unit cannot walk, turn,
         shoot or claw while it runs. */
      stunTime: 0,
      /* One HP pool per leg, for a species that declares `legHealth`.
         `null` for everything else, so combat.js's `box.legs` check is
         the only place that has to know this exists at all. */
      legHp: sp.spec.legHealth ? legs.map(() => sp.spec.legHealth) : null,
      legBroken: sp.spec.legHealth ? legs.map(() => false) : null,
      legsBroken: 0,
      /* Whether the body itself is currently a reachable target. Owned
         by the creature's own boss module (see distaff.js), read
         generically by combat.js's leg-walker hit tests. */
      collapsed: false,
      /* Bank and pitch, for a species that declares `flies`. Zero and
         unread for everything that walks - a ground creature's root
         rotation stays yaw-only, which is what keeps its feet on the
         terrain the IK just solved them against. */
      pitch: 0,
      roll: 0,
      /* How far below its normal ride height the creature is holding
         itself. The ground-follow subtracts it - see the update loop -
         and the creature's module animates it (the Distaff's collapse
         is its one current writer). */
      bodyDrop: 0,
      /* The lift pool and its burst sacs, for a species that declares
         `liftPool`. `grounded` is read by combat.js to decide whether
         the gut is a target and whether a lance can reach at all; it
         is owned by the creature's own module. */
      lift: sp.spec.liftPool || 0,
      maxLift: sp.spec.liftPool || 0,
      sacBurst: sp.spec.liftPool ? [false, false] : null,
      grounded: !sp.spec.flies,
      /* Where this body will come to rest, and how long its clip takes
         to fold it. Copied off the species so the settle is one
         multiply per frame rather than a map lookup. */
      deathSettle: sp.deathSettle || 0,
      deathSeconds: sp.deathSeconds || 0,
      deathElapsed: 0,
    };

    root.position.set(inst.x, inst.y, inst.z);
    root.rotation.y = inst.yaw;
    group.add(root);

    /* Everything the solver needs, measured ONCE off the bind pose:
       segment lengths, the rest foot position in the creature's own
       space, and the outward direction that keeps the knee pointing
       away from the body. Measuring these rather than hard-coding
       them means the same solver works on any rig that follows the
       coxa/femur/tibia naming, at any scale. */
    root.updateMatrixWorld(true);
    const hip = new THREE.Vector3();
    const knee = new THREE.Vector3();
    const toe = new THREE.Vector3();
    for (const leg of inst.legs) {
      leg.femur.getWorldPosition(hip);
      leg.tibia.getWorldPosition(knee);
      leg.toe.getWorldPosition(toe);

      // Both segment lengths MEASURED off the bind pose, in world
      // units, so the root scale is already in them.
      leg.femurLen = hip.distanceTo(knee);
      leg.tibiaLen = knee.distanceTo(toe);

      // Rest foot in the creature's own space, taken from where the
      // rig actually puts it rather than from a fudge factor.
      leg.rest.copy(root.worldToLocal(toe.clone()));

      const foot = leg.rest.clone().applyMatrix4(root.matrixWorld);
      foot.y = groundY(foot.x, foot.z);
      leg.plant.copy(foot);
      leg.target.copy(foot);
      leg.foot.copy(foot);

      // Outward, in world space, from the body centreline.
      leg.outward.set(leg.sign, 0, 0).applyQuaternion(root.quaternion).normalize();
      // ...and forward, which a biped's knee needs and an insect's
      // does not. Both are recomputed per frame in solveTwoBone off
      // the live quaternion; these are the bind-pose seeds.
      leg.forward.set(0, 0, 1).applyQuaternion(root.quaternion).normalize();
    }

    /* And the body chain's arc lengths, measured the same way off the
       same bind pose: how far behind the mouth each vertebra's TAIL
       sits. Those distances are what the trail is sampled at, so they
       have to come off the model - a hard-coded segment length that
       disagrees with the .glb by a few centimetres shows up as a body
       that either concertinas into itself or pulls apart at every
       joint, thirteen times over. */
    if (spine.length) {
      measureSpine(inst);
      // Laid out straight, underground, aimed the way it was spawned
      // facing. Anything else starts the animal as a knot at one point.
      seedBody(inst, inst.x, inst.y - inst.body.depth, inst.z, inst.yaw,
        inst.body.depth);
    }

    play(inst, "idle", 0);
    /* A burrower does not RISE, it arrives. The fissure-and-shards
       emergence above is built for something standing up out of a hole
       it made where it already was, and this animal's entrance is a
       wake crossing two hundred metres of open sand - so it declines
       the shared telegraph and starts the fight underground. */
    if (opts.emerge && !sp.spec.burrows) configureEmergence(inst, opts.emerge);
    live.push(inst);
    return inst;
  }

  /* ============================================================
     THE BODY CHAIN

     One function of geometry and one of posing, and the split is the
     same one the legs use: the runtime owns where the body IS, the
     clips own what its mouth is doing.
     ============================================================ */

  const _origin = new THREE.Vector3();

  function measureSpine(inst) {
    inst.root.updateMatrixWorld(true);
    _origin.setFromMatrixPosition(inst.root.matrixWorld);
    const heads = inst.spine.map((bone) => bone.getWorldPosition(new THREE.Vector3()));
    const arcs = [];
    for (let i = 1; i < heads.length; i += 1) arcs.push(_origin.distanceTo(heads[i]));
    /* The last vertebra has no successor to measure against, so its
       tail is extrapolated by the segment length in front of it. Every
       other arc is a real measurement. */
    const lastSeg = heads.length > 1
      ? heads[heads.length - 1].distanceTo(heads[heads.length - 2])
      : 1;
    arcs.push((arcs[arcs.length - 1] ?? 0) + lastSeg);
    inst.spineArc = arcs;
    inst.spineLength = arcs[arcs.length - 1];
    inst.body = {
      /* The trail: (x, y, z, distance-from-the-front) quadruples, newest
         first. A ring buffer would save the shifting, but the sampler
         walks it from the front on every frame anyway and 13 lookups
         into 96 samples is not what this animal costs. */
      trail: [],
      head: new THREE.Vector3(),
      // Last frame's head, so the encounter module can measure how far
      // the animal really moved rather than how far it meant to.
      prev: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, 1),
      quat: new THREE.Quaternion(),
      joints: arcs.map(() => new THREE.Vector3()),
      // Owned by coulter.js from here; declared here so a save can be
      // written and validated without the encounter module loaded.
      phase: "burrow",
      /* Seconds of hunting before it may surface, and it starts full.
         A burrower that arrives and immediately erupts has skipped the
         only part of its cycle the player can read. */
      timer: 6,
      heading: inst.yaw,
      pitch: 0,
      depth: 6,
      hidden: true,
      mawOpen: 0,
      spewsLeft: 0,
      surfacings: 0,
    };
    return inst.body;
  }

  /**
   * Lay the whole body out straight behind a head position.
   *
   * Used on spawn, on load, and by anything that teleports the animal.
   * The alternative - letting the trail fill in over the first second
   * of movement - starts every Coulter as thirteen coincident segments
   * at one point, which is a ball rather than a worm.
   */
  function seedBody(inst, x, y, z, heading = inst.yaw, terrainDepth = null) {
    const body = inst.body || (inst.spine.length ? measureSpine(inst) : null);
    if (!body) return null;
    const sx = Math.sin(heading);
    const sz = Math.cos(heading);
    const conform = Number.isFinite(terrainDepth) && terrainDepth > 0;
    const headY = conform ? groundY(x, z) - terrainDepth : y;
    body.head.set(x, headY, z);
    body.prev.set(x, headY, z);
    body.dir.set(sx, 0, sz);
    body.heading = heading;
    body.pitch = 0;
    body.trail.length = 0;
    const span = inst.spineLength + 4;
    // Front to back, so index 0 is the freshest sample.
    for (let d = 0; d <= span; d += 1.2) {
      const px = x - sx * d;
      const pz = z - sz * d;
      body.trail.push({ x: px, y: conform ? groundY(px, pz) - terrainDepth : y,
        z: pz, d });
    }
    poseBody(inst);
    return body;
  }

  /**
   * Sample the trail at `distance` behind the head.
   *
   * THE HEAD IS THE FIRST POINT, and it is not in the list. Samples are
   * only laid every 0.9m, so between them the newest recorded point is
   * up to 0.9m stale - and the front of a body sampled from that list
   * alone lags the mouth by up to a whole segment, which reads as the
   * neck stretching and snapping back every few frames.
   *
   * The alternative that suggests itself - dragging the front sample
   * along with the head - is worse, and was tried: a sample that moves
   * with the head has travelled no distance relative to it, so the
   * threshold that lays the next one is never crossed, the list stops
   * growing, and the body concertinas into the front ten metres of a
   * twenty-five metre path.
   */
  function trailAt(body, distance, out) {
    const trail = body.trail;
    if (!trail.length) return out.copy(body.head);
    let ax = body.head.x;
    let ay = body.head.y;
    let az = body.head.z;
    let ad = 0;
    for (let i = 0; i < trail.length; i += 1) {
      const b = trail[i];
      if (b.d < distance) {
        ax = b.x; ay = b.y; az = b.z; ad = b.d;
        continue;
      }
      const span = b.d - ad;
      const t = span > 1e-5 ? (distance - ad) / span : 0;
      return out.set(ax + (b.x - ax) * t, ay + (b.y - ay) * t, az + (b.z - az) * t);
    }
    const last = trail[trail.length - 1];
    return out.set(last.x, last.y, last.z);
  }

  /** Resolve the trail into this frame's joint targets and root frame. */
  function poseBody(inst) {
    const body = inst.body;
    if (!body) return;
    for (let i = 0; i < inst.spineArc.length; i += 1) {
      trailAt(body, inst.spineArc[i], body.joints[i]);
    }
    /* The root carries the head's full orientation, PITCH INCLUDED,
       which is the one place this differs from every walker in the
       file. A worm coming out of the sand at fifty degrees is doing the
       only thing it does that a yaw-only transform cannot express, and
       it is also the frame the whole encounter is sold on. */
    _dir.copy(body.dir);
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
    _dir.normalize();
    _b.set(0, 0, 1);
    body.quat.setFromUnitVectors(_b, _dir);
  }

  /**
   * Aim each vertebra at its own trail point.
   *
   * The whole solver, and it is three lines because the rig was
   * authored for it: every spine bone's rest axis already runs down the
   * body, so the rotation each one receives is the actual bend and
   * nothing else. `aimBone` walks the chain in order, so bone i reads
   * the world position its parent has just given it.
   */
  function solveSpine(inst) {
    const joints = inst.body?.joints;
    if (!joints) return;
    for (let i = 0; i < inst.spine.length; i += 1) aimBone(inst.spine[i], joints[i]);
  }

  function play(inst, name, fade = 0.22) {
    const next = inst.actions.get(name);
    if (!next || inst.current === next) return;
    next.reset();
    // A strike may have been time-scaled to its tell (see replay); every
    // other entry into a clip runs it at authored speed.
    next.timeScale = 1;
    next.setLoop(
      name === "death" ? THREE.LoopOnce : THREE.LoopRepeat,
      name === "death" ? 1 : Infinity
    );
    next.clampWhenFinished = name === "death";

    /* Stop everything else, ALWAYS.
       `crossFadeFrom` only winds the outgoing action down when there
       is a fade to wind it down over; called with fade 0 it was
       skipped entirely, so the previous action kept running at full
       weight beside the new one. Two actions at weight 1 blend to
       the mean, which meant every clip rendered as itself averaged
       with idle - five visually identical frames, and a bug that
       looks like "the animations do not work" rather than like
       "the animations all work at once". */
    for (const [other, action] of inst.actions) {
      if (other === name) continue;
      if (fade > 0 && action === inst.current) action.fadeOut(fade);
      else action.stop();
    }
    if (inst.current && fade > 0) next.crossFadeFrom(inst.current, fade, false);
    next.play();
    inst.current = next;
    inst.state = name;
  }

  /**
   * Restart `name` from its first frame even when it is already the
   * current clip, and time-scale it so that its `contactAt` second lands
   * `contactIn` seconds from now.
   *
   * `play()` is deliberately a no-op for the clip already playing, which
   * is right for a walk and wrong for a bite: a creature standing in reach
   * looped its strike clip unsynchronised with its own timer, so the
   * animation said nothing about when the damage came. A telegraph needs
   * the clip to START at the tell and reach its contact frame at the
   * strike, whatever the authored clip length happens to be. */
  function replay(inst, name, fade = 0.08, contactAt = 0, contactIn = 0) {
    const action = inst.actions.get(name);
    if (!action) return false;
    if (inst.current !== action) play(inst, name, fade);
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.timeScale = contactAt > 0 && contactIn > 0 ? contactAt / contactIn : 1;
    action.play();
    inst.current = action;
    inst.state = name;
    return true;
  }

  /* ============================================================
     PROCEDURAL LEGS

     A foot stays planted where it was put until the body drags it
     past `stance` metres, then it swings to a new target sampled
     off the terrain. That is the whole algorithm, and it is why it
     handles a crater wall without being told a crater wall exists.
     ============================================================ */

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _knee = new THREE.Vector3();
  const _head = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _cur = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _pole = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _pq = new THREE.Quaternion();
  const _wq = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  function solveLegs(inst, dt) {
    /* `death` always owns its legs - see the model pipeline. A species
       may claim additional clips for the same reason: the Distaff's
       `collapse`/`recover` bend the leg bones directly, because the
       only way to bring a standing animal's body down is to fold the
       legs themselves - a foot-planted IK solver given a lower body
       to serve would simply re-stretch the knee to keep holding it up
       at exactly the height it was already at. Declared per-species
       rather than checked by clip name here, so this file does not
       grow a new hardcoded string every time a boss needs the same
       trick. */
    if (inst.state === "death" || inst.spec.legOwnedStates?.includes(inst.state)) return;
    /* A creature whose limbs are posed by its own module. `inst.legs` is
       the hit-table contract combat.js reads - three segments and a tip
       per limb - and a species can satisfy it without those limbs being
       legs at all. The Garner's six tentacles are the first: handed to
       this solver they would be replanted as feet on the terrain, at
       which point the animal is standing on its own tentacles. */
    if (inst.spec.selfPosedLegs) return;
    const scale = inst.root.scale.x;
    const reach = inst.spec.stance * scale;
    const lift = inst.spec.stepHeight * scale;

    for (const leg of inst.legs) {
      // Where this foot WANTS to be right now, in world space.
      _a.copy(leg.rest).applyMatrix4(inst.root.matrixWorld);
      _a.y = groundY(_a.x, _a.z);

      if (leg.stepping > 0) {
        leg.stepping = Math.max(0, leg.stepping - dt * 5.5);
        const t = 1 - leg.stepping;
        _b.copy(leg.plant).lerp(leg.target, t);
        // A parabola over the step, so the foot clears the ground
        // instead of skating across it.
        _b.y += Math.sin(t * Math.PI) * lift;
        leg.foot.copy(_b);
        if (leg.stepping <= 0) leg.plant.copy(leg.target);
      } else {
        if (leg.plant.distanceTo(_a) > reach) {
          leg.target.copy(_a);
          leg.stepping = 1;
        }
        leg.foot.copy(leg.plant);
      }

      solveTwoBone(inst, leg);
    }
  }

  /**
   * Analytic two-bone IK, law of cosines, with a pole vector.
   *
   * The first version of this "simplified" by aiming the femur
   * straight at the foot and letting the tibia close the gap. That
   * is not a simplification, it is a different result: a chain
   * pointed at its own end effector is a STRAIGHT LINE, so every
   * knee collapsed and six carefully-placed high insect knees
   * rendered as six straight spikes. The bend is the silhouette.
   *
   * The knee position is computed first, then each bone is simply
   * aimed - femur at the knee, tibia at the foot - which keeps the
   * per-bone maths to one `setFromUnitVectors` each.
   */
  function solveTwoBone(inst, leg) {
    const { femur, tibia } = leg;
    femur.updateWorldMatrix(true, false);
    _head.setFromMatrixPosition(femur.matrixWorld);

    const L1 = leg.femurLen;
    const L2 = leg.tibiaLen;
    _dir.copy(leg.foot).sub(_head);
    let d = _dir.length();
    if (d < 1e-5) return;
    // Clamp inside the reachable annulus, or acos goes NaN and the
    // whole leg becomes non-finite for the rest of the session.
    d = clamp(d, Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    _dir.normalize();

    /* Pole: which way the joint bends, and it is per species.

       Up-and-outward is what puts an insect's knee above its back
       instead of under its belly - but applied to a two-legged
       machine the same vector shoves both knees out sideways into a
       plie. A reverse-jointed walker wants its bend BEHIND it, which
       is a forward weight of -1 and almost no outward at all. The
       bend is the silhouette of a leg, so this is the one number
       that decides whether a rig reads as a beast or as a machine. */
    const kp = inst.spec.kneePole || { up: 1.6, out: 1.0, fwd: 0 };
    leg.outward.set(leg.sign, 0, 0).applyQuaternion(inst.root.quaternion);
    leg.forward.set(0, 0, 1).applyQuaternion(inst.root.quaternion);
    _pole.copy(UP).multiplyScalar(kp.up)
      .addScaledVector(leg.outward, kp.out)
      .addScaledVector(leg.forward, kp.fwd)
      .normalize();
    _axis.crossVectors(_dir, _pole);
    if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
    _axis.normalize();

    // POSITIVE angle: with the axis taken as cross(dir, pole),
    // rotating `dir` by +A about it swings the knee TOWARD the pole.
    // Negated, it swings the same amount the other way - the knee
    // ends up tucked under the belly, and six insect legs render as
    // six straight spikes splayed flat on the ground.
    const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    _knee.copy(_dir).applyAxisAngle(_axis, Math.acos(cosA))
      .multiplyScalar(L1).add(_head);

    aimBone(femur, _knee);
    aimBone(tibia, leg.foot);
  }

  /** Point a bone's local +Y at a world-space target. */
  function aimBone(bone, targetWorld) {
    bone.updateWorldMatrix(true, false);
    _head.setFromMatrixPosition(bone.matrixWorld);
    _dir.copy(targetWorld).sub(_head);
    if (_dir.lengthSq() < 1e-10) return;
    _dir.normalize();

    bone.getWorldQuaternion(_wq);
    _cur.copy(UP).applyQuaternion(_wq).normalize();
    _q.setFromUnitVectors(_cur, _dir);
    _wq.premultiply(_q);

    if (bone.parent) {
      bone.parent.getWorldQuaternion(_pq);
      _pq.invert();
      bone.quaternion.copy(_pq.multiply(_wq));
    } else {
      bone.quaternion.copy(_wq);
    }
    bone.updateWorldMatrix(false, false);
  }

  /* ============================================================
     UPDATE
     ============================================================ */

  /* Distance tiers. Every enemy used to animate and solve its legs
     every frame regardless of where it was, and garrisoning the level
     took the frame from 0.97ms to 2.07ms for units that a contribution
     mask measured at 0.02%-0.15% of the frame. Paying half the frame
     budget for two thousand pixels is the wrong trade.

     The IK is the expensive half - six chains per Thresher against
     terrain.heightAt - so it is the first thing to go, and it goes at
     a range where a foot is well under a pixel.

     POSE_RANGE is the outermost tier and it exists for a different
     reason than the other two. Everything else here is about work
     THIS module does; that one is about work THREE does. A garrisoned
     level is ~190 skinned meshes of forty bones each, and the
     renderer's own scene walk touches all 7,600 of those nodes every
     frame whether or not a single one is on screen or has moved.

     So each instance's root is taken off the automatic walk entirely
     (`matrixWorldAutoUpdate = false`) and this loop updates the ones
     that need it. It has to sit OUTSIDE the AI's own 240m horizon:
     an enemy that is being walked toward you by combat.js but whose
     matrices stopped updating is an enemy that slides across the sand
     in its bind pose and then snaps when it crosses the line. */
  /* These three are the DEFAULTS. Any species may raise its own - see
     `coulter` in the bestiary - because a tier is really a statement
     about how many pixels the thing is worth, and a 25m animal is
     worth more of them at 300m than a Thresher is at 80. */
  const IK_RANGE = 85;
  const ANIM_RANGE = 190;
  const POSE_RANGE = 300;
  /* Shadows are the other tier, and they are a RENDER cost rather
     than a simulation one: every caster inside the sun's shadow
     camera is a second full draw of that mesh, so a garrison of
     ~190 skinned meshes can double the frame's geometry on its own.

     A creature's own contact shadow is what sells it as standing on
     the sand, and that stops being resolvable well before the
     creature does - at 70m a Thresher's shadow is a few pixels of
     soft grey on soft orange. Everything past that draws twice for
     nothing. */
  const SHADOW_RANGE = 74;
  const _eye = new THREE.Vector3();

  const dyingOrNear = (inst, d2, range) =>
    inst.state === "death" || d2 < range * range;

  /**
   * How far to move a body while its death clip folds it.
   *
   * Ramped on the CLIP'S OWN PROGRESS rather than applied at the moment
   * of death: the legs are still holding the creature up on the frame
   * it dies, and a correction that arrives before they fold is a
   * corpse that jumps. The full offset lands exactly when the pose
   * that needs it does.
   */
  function deathLift(inst) {
    const span = Math.max(0.05, inst.deathSeconds || 0);
    if (!(span > 0.05)) return 0;
    const t = clamp01((inst.deathElapsed || 0) / span);
    const eased = t * t * (3 - 2 * t);
    return ((inst.deathSettle || 0) * inst.root.scale.x - DEATH_BED_IN) * eased;
  }

  const KNOCKBACK_DRAG = 6.5;
  const KNOCKBACK_DURATION = 0.55;
  const KNOCKBACK_MAX_SPEED = 22;

  /** Add a short, collision-aware horizontal impulse. It remains active on
   *  a dying Thresher so the death clip travels with the hit instead of
   *  folding in place where the lance found it. */
  /**
   * Put a creature on the floor for `seconds`.
   *
   * Additive up to the longest pending stun rather than cumulative:
   * two overlapping slams should not add up to five seconds of a
   * creature standing still being shot.
   */
  function stun(inst, seconds = 1.5) {
    if (!inst || inst.state === "death") return false;
    const want = Math.max(0, Number(seconds) || 0);
    if (want <= 0) return false;
    inst.stunTime = Math.max(Number(inst.stunTime) || 0, want);
    play(inst, "flinch", 0.06);
    return true;
  }

  function knockback(inst, ux, uz, speed = 10) {
    if (!inst || inst.emerging?.active) return false;
    const length = Math.hypot(ux, uz);
    if (length < 1e-5) return false;
    const impulse = Math.max(0, Number(speed) || 0);
    inst.knockbackX = clamp((inst.knockbackX || 0) + (ux / length) * impulse,
      -KNOCKBACK_MAX_SPEED, KNOCKBACK_MAX_SPEED);
    inst.knockbackZ = clamp((inst.knockbackZ || 0) + (uz / length) * impulse,
      -KNOCKBACK_MAX_SPEED, KNOCKBACK_MAX_SPEED);
    inst.knockbackTime = Math.max(inst.knockbackTime || 0, KNOCKBACK_DURATION);
    return true;
  }

  function stepKnockback(inst, dt) {
    if (!(inst.knockbackTime > 0)) return false;
    const vx = Number(inst.knockbackX) || 0;
    const vz = Number(inst.knockbackZ) || 0;
    if (Math.hypot(vx, vz) < 0.06) {
      inst.knockbackX = 0;
      inst.knockbackZ = 0;
      inst.knockbackTime = 0;
      return false;
    }
    const r = inst.spec?.collisionRadius || 0.62;
    const out = ctx.collide?.slide
      ? ctx.collide.slide(inst.x, inst.z,
        inst.x + vx * dt, inst.z + vz * dt, null, r * 0.8)
      : [inst.x + vx * dt, inst.z + vz * dt];
    const moved = Math.hypot(out[0] - inst.x, out[1] - inst.z) > 1e-5;
    inst.x = out[0];
    inst.z = out[1];
    const decay = Math.exp(-KNOCKBACK_DRAG * dt);
    inst.knockbackX = vx * decay;
    inst.knockbackZ = vz * decay;
    inst.knockbackTime = Math.max(0, inst.knockbackTime - dt);
    return moved;
  }

  function update(dt, camera) {
    if (camera) camera.getWorldPosition(_eye);
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const inst = live[i];
      const knocked = stepKnockback(inst, dt);
      const d2 = camera
        ? (inst.x - _eye.x) ** 2 + (inst.z - _eye.z) ** 2
        : 0;
      /* Draw distance, PER SPECIES.
         Frustum culling already removes what is off screen; this
         removes what is on screen and too far away to be worth a
         skinned draw. Every rendered skinned mesh costs a draw call, a
         skeleton update and a bone-texture upload, and a garrison
         looking out across two kilometres of open basin can have fifty
         of them in frustum at once - which measured at 2.1ms of a
         5.6ms frame while ten units were actually near enough to see.

         The cutoff is per species because a Thresher at 250m is three
         pixels and a Gleaner at 250m is a recognisable silhouette on a
         ridge, and popping the second one out would be visible. */
      const cull = inst.spec.cullRange || 260;
      const ikRange = inst.spec.ikRange || IK_RANGE;
      const animRange = inst.spec.animRange || ANIM_RANGE;
      const poseRange = inst.spec.poseRange || POSE_RANGE;
      /* A fully buried Coulter is behind an opaque planet, and a
         district boss whose arena has not been entered does not exist
         in the player's picture yet. Both stay spawned for stable
         save/animation state, but neither pays a skinned draw or leaks
         its silhouette before its own reveal. */
      const shown = dyingOrNear(inst, d2, cull)
        && !inst.body?.hidden && !inst.encounterHidden;
      if (inst.root.visible !== shown) inst.root.visible = shown;
      if (inst.skin) {
        const wants = shown
          && d2 < (inst.spec.shadowRange || SHADOW_RANGE) ** 2;
        if (inst.skin.castShadow !== wants) inst.skin.castShadow = wants;
      }
      // Dying units always finish their clip: a corpse frozen
      // mid-collapse because the player walked away is worse than
      // the cost of animating it.
      const dying = inst.state === "death";
      if (dying) inst.deathElapsed = (inst.deathElapsed || 0) + dt;
      if (!dying && d2 > poseRange * poseRange) continue;

      if (dying || d2 < animRange * animRange) inst.mixer.update(dt);

      const emerging = !dying && updateEmergence(inst, dt);
      if (inst.body) {
        /* The body owns its own transform, and the AI that moves it
           runs after this loop - so what is placed here is last
           frame's trail. That is the same one-frame contract every
           other creature in the file already has (combat writes
           inst.x/z, this reads it next frame) and it is invisible at
           any speed the animal actually travels. */
        inst.root.position.copy(inst.body.head);
        inst.root.quaternion.copy(inst.body.quat);
        inst.root.updateMatrixWorld(true);
      } else if (inst.spec.flies && !emerging) {
        /* A FLYER OWNS ITS OWN ALTITUDE.
           Every other walker here is damped onto the terrain each
           frame, which is right for something that stands on it and
           fatal for something that does not: a flyer handed that
           treatment is pinned to the sand and its whole encounter
           stops existing. Its module writes `inst.y` directly - the
           same contract the burrower's body chain already has, one
           step simpler because there is no chain to pose.

           Its ROLL is its own too. Yaw alone cannot express a bank,
           and a twenty-six metre wingspan turning flat reads as a
           table sliding sideways through the air. */
        inst.root.position.set(inst.x, inst.y, inst.z);
        if (!dying) {
          inst.root.rotation.set(inst.pitch || 0, inst.yaw, inst.roll || 0);
        }
      } else if (!emerging) {
        /* A CORPSE KEEPS FOLLOWING THE GROUND, and it follows it to a
           different height than a standing creature does.

           This branch used to be skipped entirely for the dead unless
           a knockback was still pushing them, which froze the body at
           whatever height it happened to be standing at - and since a
           death clip only rotates bones, that is the height its LEGS
           were holding it at. A Gleaner folded four three-metre stilts
           and stayed exactly where they had put it. */
        /* `bodyDrop` is the standing counterpart of a corpse's
           deathLift: a creature holding itself BELOW its own ride
           height. The Distaff's collapse needs it because a clip can
           only rotate bones - folding the legs moves the FEET, not
           the body, so without the root actually sinking the animal
           "collapses" at exactly the altitude it stood at and the
           whole read is lost. The creature's module animates the
           value; the damp below is what makes the sink a settle
           rather than a snap. */
        const want = groundY(inst.x, inst.z)
          + (dying ? deathLift(inst) : -(inst.bodyDrop || 0));
        inst.y = damp(inst.y, want, 12, dt);
        inst.root.position.set(inst.x, inst.y, inst.z);
        if (!dying) inst.root.rotation.y = inst.yaw;
      }
      if (!inst.body) inst.root.updateMatrixWorld(true);

      /* Legs and body are solved AFTER `mixer.update()`, deliberately.
         The mixer writes every bone it has a track for; anything
         written before it is overwritten. This ordering is what makes
         "clips own the mouth, the solver owns the body" actually true
         rather than merely intended. */
      if (emerging) continue;
      if (inst.body) {
        if (dying || d2 < ikRange * ikRange) solveSpine(inst);
      } else if (dying || d2 < ikRange * ikRange) solveLegs(inst, dt);
    }
  }

  /* ============================================================
     GARRISONS

     Who holds what. The brood came out of the hive in the north-west
     and it now holds every district on the map, which is the whole
     story of the level told by where things are standing: the
     Concord's own ground, walked by the thing that took it.

     THE MIX IS THE ENCOUNTER DESIGN. Nothing here is a flat count of
     enemies - each site is a recipe, and the recipe is what the fight
     at that site feels like:

       Threshers alone       a rush. Cheap, fast, and survivable if
                             you keep moving.
       Threshers + Gleaners  the standard problem. Something forces
                             you into cover while something else
                             takes cover away from you.
       + a Harrow            cover stops working. It is the unit that
                             makes a position untenable and moves the
                             player, which is the job a heavy exists
                             to do.

     Density falls off toward the drop. The Threshold is deliberately
     the thinnest ground on the map - a player who is killed in the
     first ninety seconds has learned nothing - and the Bloom is
     deliberately the worst, because it is the only place on Vesper-IX
     the mission never asks you to go.

     Placement is seeded and deterministic so the beauty shots frame
     the same garrison every run, and every spawn is pushed to the
     ground by the same terrain sampler the legs solve against.
     ============================================================ */
  const GARRISONS = [
    // --- The Bloom: the hive. Nothing sends you here; it is here so
    //     that the map has a place that is visibly worse than the
    //     mission, and so the north-west horizon is never empty.
    { key: "thresher", at: [-655, -655], r: 245, n: 26 },
    { key: "gleaner", at: [-655, -655], r: 225, n: 7 },
    { key: "harrow", at: [-655, -655], r: 190, n: 4 },
    { key: "thresher", at: [-700, -560], r: 105, n: 9 },    // The Throat

    // --- Relay BETA, the Choir Spires. Spires are cover, so this one
    //     is weighted toward the ranged caste: the spires give the
    //     player cover too, and Gleaners are the reason to leave it.
    { key: "thresher", at: [-820, -95], r: 200, n: 13 },
    { key: "gleaner", at: [-820, -95], r: 215, n: 7 },
    { key: "harrow", at: [-820, -95], r: 150, n: 2 },

    // --- Relay GAMMA, the Vault-Cathedral. Interiors and a nave: the
    //     Harrows are in here because a heavy in a corridor is a
    //     different problem from a heavy in the open.
    { key: "thresher", at: [-95, -725], r: 190, n: 14 },
    { key: "gleaner", at: [-95, -725], r: 205, n: 6 },
    { key: "harrow", at: [-95, -725], r: 145, n: 3 },

    // --- Relay ALPHA, the Censer Works. The first relay most players
    //     walk to, so it is the lightest of the three.
    { key: "thresher", at: [655, 700], r: 185, n: 12 },
    { key: "gleaner", at: [655, 700], r: 195, n: 5 },
    { key: "harrow", at: [655, 700], r: 130, n: 2 },

    // --- The Fallen Saint: extraction. Calling the shuttle re-homes
    //     the whole map onto this point, so what is standing here at
    //     the start is only the seed of the last fight.
    { key: "thresher", at: [0, -20], r: 205, n: 12 },
    { key: "gleaner", at: [0, -20], r: 190, n: 5 },
    { key: "harrow", at: [0, -20], r: 150, n: 2 },

    // --- Off-route districts. No objective sends the player to any of
    //     these; they are garrisoned because an open-world level whose
    //     enemies are only where the quest markers are is a corridor
    //     wearing a map.
    { key: "thresher", at: [645, -640], r: 205, n: 10 },    // The Ossuary
    { key: "gleaner", at: [645, -640], r: 195, n: 4 },
    { key: "harrow", at: [645, -640], r: 140, n: 2 },
    { key: "thresher", at: [790, 95], r: 195, n: 9 },       // The Glass Scar
    { key: "gleaner", at: [790, 95], r: 185, n: 4 },
    { key: "thresher", at: [-600, 545], r: 225, n: 9 },     // The Gilded Reach
    { key: "gleaner", at: [-600, 545], r: 200, n: 3 },

    // --- The Pilgrim's Road. Small packs strung along the causeway,
    //     so the two-kilometre walk between districts is a journey
    //     through held ground rather than a loading screen you have
    //     to operate yourself.
    { key: "thresher", at: [-8, 300], r: 95, n: 5 },
    { key: "thresher", at: [-24, 40], r: 90, n: 5 },
    { key: "thresher", at: [-52, -238], r: 100, n: 6 },
    { key: "gleaner", at: [-66, -382], r: 115, n: 3 },

    // --- The Threshold. Four, at the far edge of the drop zone: the
    //     player has to be able to see what is coming before it is a
    //     problem, once, at the start.
    { key: "thresher", at: [0, 700], r: 150, n: 4 },

    // No Matriarch here. The unique boss is raised by the final Bloom
    // breach, after the player has survived the four lesser surges.
  ];

  function garrison() {
    const grng = makeRng(0x5a17);
    let placed = 0;
    for (const g of GARRISONS) {
      if (!species.has(g.key)) continue;
      /* The tier thickens the field itself, not only the breach waves -
         most of the road is garrison, and a hard tier that left it alone
         read as no tier at all. */
      const count = Math.max(1, Math.round(g.n * (ctx.difficulty?.current?.garrison || 1)));
      for (let i = 0; i < count; i += 1) {
        // Square-rooted radius, or every garrison clumps in its own
        // middle: uniform r over a disc puts most of the area, and
        // so most of the units, near the rim.
        const a = grng() * TAU;
        const d = Math.sqrt(grng()) * g.r;
        let x = g.at[0] + Math.cos(a) * d;
        let z = g.at[1] + Math.sin(a) * d;
        /* Nudged out of masonry. A unit spawned inside a wall is
           permanently blocked by its own collision, so it can never
           close on the player - and from the player's side that
           reads as an enemy that has seen you and is ignoring you,
           which is far more confusing than one that charges. */
        if (ctx.collide) {
          const radius = BESTIARY[g.key]?.collisionRadius || 0.42;
          /* Being outside a solid cell is not enough: the old sampler
             accepted one-cell pockets between Cathedral ribs and Ossuary
             stacks. Those units spawned legally but had no possible first
             move. Require one four-metre exit lane at placement time; the
             runtime planner can handle every larger detour from there. */
          const hasEgress = (px, pz) => {
            for (let bearing = 0; bearing < 16; bearing += 1) {
              const turn = (bearing / 16) * TAU;
              if (ctx.collide.walkClear(px, pz,
                px + Math.cos(turn) * 4, pz + Math.sin(turn) * 4, radius)) return true;
            }
            return false;
          };
          const open = ctx.collide.findOpen(
            x, z, groundY(x, z), 32, 12, radius, null, hasEgress
          );
          if (!open) continue;
          x = open[0];
          z = open[1];
        }
        /* A few per cent of size either way. Twenty-six identical
           Threshers in one clearing read as twenty-six copies of one
           Thresher; the variance costs nothing and it is the
           difference between a brood and a spawn table. Kept small
           enough that the shared world-metre hit capsules still fit.

           NOT for a unique. There is one Matriarch, so there is
           nothing for it to look identical to, and its hit capsule
           carries a weak point placed in metres off the model - a
           7% scale wobble would move that sphere 23cm off the gaster
           it is supposed to be inside.

           The roll is still TAKEN and then discarded. `grng` is one
           sequential stream shared by every garrison, so a skipped
           draw shifts every number handed out after it and re-places
           whatever follows in the array. Consuming it means a unique
           costs the stream exactly what an ordinary unit costs. */
        const roll = 0.93 + grng() * 0.14;
        const size = g.unique ? 1 : roll;
        if (spawn(g.key, x, z, { yaw: grng() * TAU, scale: size })) placed += 1;
      }
    }
    return placed;
  }

  function snapshot() {
    return {
      rng: rng.getState?.() || null,
      nextId,
      /* Domain-owned figures (the Apostate is the first) carry their own
         lifecycle snapshot. Persisting them here as well would make restore
         replace the instance behind their controller's closure. */
      live: live.filter((inst) => inst && !inst.spec?.durableDomain
        && inst.state !== "death" && inst.health > 0)
        .map((inst) => ({
          id: inst.id,
          key: inst.key,
          x: Number(inst.x.toFixed(4)),
          z: Number(inst.z.toFixed(4)),
          yaw: Number(inst.yaw.toFixed(5)),
          /* Emergence animates root.scale; persisting that frame would bake
             the temporary underground squash into the creature's permanent
             authored size when configureEmergence runs after load. */
          scale: Number(((inst.emerging?.baseScale ?? inst.root.scale.x)
            / Math.max(1e-5, inst.spec.scale)).toFixed(4)),
          health: Number(inst.health.toFixed(3)),
          maxHealth: Number(inst.maxHealth.toFixed(3)),
          damageScale: Number((inst.damageScale || 1).toFixed(4)),
          eventId: inst.eventId || null,
          eventWave: Number.isFinite(inst.eventWave) ? inst.eventWave : null,
          home: inst.home ? { x: Number(inst.home.x.toFixed(4)), z: Number(inst.home.z.toFixed(4)) } : null,
          suspicion: Number((inst.suspicion || 0).toFixed(4)),
          alerted: !!inst.alerted,
          fireTimer: Number((inst.fireTimer || 0).toFixed(4)),
          burstLeft: Math.max(0, Math.round(inst.burstLeft || 0)),
          broodTimer: Number.isFinite(inst.broodTimer) ? Number(inst.broodTimer.toFixed(4)) : null,
          broodIds: (inst.broodKids || [])
            .filter((kid) => kid?.id && kid.state !== "death" && kid.health > 0)
            .map((kid) => kid.id),
          /* A burrower's durable state is its PHASE, not its pose. The
             trail is thirteen interpolated points behind a head that is
             about to move anyway, so it is re-seeded straight on load
             and the first second of travel curves it again; what a save
             cannot reconstruct is whether the animal was eight metres
             underground or reared over the player, and that is what is
             written here. */
          body: inst.body ? {
            phase: String(inst.body.phase || "burrow"),
            timer: Number((inst.body.timer || 0).toFixed(3)),
            heading: Number((inst.body.heading || 0).toFixed(5)),
            depth: Number((inst.body.depth || 0).toFixed(3)),
            surfacings: Math.max(0, Math.round(inst.body.surfacings || 0)),
            x: Number(inst.body.head.x.toFixed(3)),
            y: Number(inst.body.head.y.toFixed(3)),
            z: Number(inst.body.head.z.toFixed(3)),
          } : null,
          emergence: inst.emerging ? {
            active: !!inst.emerging.active,
            surfaced: !!inst.emerging.surfaced,
            burst: !!inst.emerging.burst,
            elapsed: Number((inst.emerging.elapsed || 0).toFixed(4)),
            delay: Number((inst.emerging.delay || 0).toFixed(4)),
            duration: Number((inst.emerging.duration || 1.2).toFixed(4)),
            depth: Number((inst.emerging.depth || 1.3).toFixed(4)),
            boss: inst.key === "matriarch",
          } : null,
        })),
    };
  }

  function clearAll() {
    for (const inst of live) {
      disposeEmergence(inst);
      group.remove(inst.root);
    }
    live.length = 0;
  }

  function restore(saved = {}) {
    const records = Array.isArray(saved.live) ? saved.live.slice(0, 420) : [];
    clearAll();
    const byId = new Map();
    nextId = Math.max(1, Math.round(Number(saved.nextId) || 1));
    for (const record of records) {
      if (!record || !species.has(record.key) || typeof record.id !== "string") continue;
      const x = clamp(Number(record.x) || 0, -980, 980);
      const z = clamp(Number(record.z) || 0, -980, 980);
      /* The 0.72s post-surface dust tail is visual-only. Reconstructing it
         would run configureEmergence again and shrink an already-surfaced
         creature to its underground scale with no active update to restore
         it. Only genuinely active rises survive a field-state load. */
      const emergenceRecord = record.emergence?.active === true ? record.emergence : null;
      const emergence = emergenceRecord ? {
        delay: Math.max(0, Number(emergenceRecord.delay) || 0),
        duration: Math.max(0.1, Number(emergenceRecord.duration) || 1.2),
        depth: Math.max(0.7, Number(emergenceRecord.depth) || 1.3),
        boss: !!emergenceRecord.boss,
      } : null;
      const savedMax = Math.max(1, Number(record.maxHealth) || Number(record.health) || 1);
      const savedHealth = clamp(Number(record.health) || savedMax, 1, savedMax);
      /* Preserve the wounded fraction for the four pools enlarged in the
         boss-pressure pass. The allow-list is exact by species and old
         difficulty-scaled maximum, so arbitrary/custom saved health is
         still restored byte-for-byte rather than silently retuned. */
      const legacyBossPools = {
        matriarch: new Set([3060, 3600, 4320, 6120, 7200, 7650, 9000, 10080, 12600, 15000]),
        distaff: new Set([7650, 9000, 12600]),
        winnower: new Set([5270, 6200, 8680]),
        stylite: new Set([4590, 5400, 7560]),
      };
      const tunedMax = spawnHealth(record.key);
      const migrateBossPool = legacyBossPools[record.key]?.has(savedMax)
        && savedMax < tunedMax;
      const restoreMax = migrateBossPool ? tunedMax : savedMax;
      const restoreHealth = migrateBossPool
        ? clamp(Math.round(restoreMax * savedHealth / savedMax), 1, restoreMax)
        : savedHealth;
      const inst = spawn(record.key, x, z, {
        id: record.id,
        yaw: Number(record.yaw) || 0,
        scale: clamp(Number(record.scale) || 1, 0.7, 1.35),
        health: restoreMax,
        exactHealth: true,
        damageScale: clamp(Number(record.damageScale) || 1, 0.2, 4),
        eventId: typeof record.eventId === "string" ? record.eventId : null,
        eventWave: record.eventWave !== null && record.eventWave !== undefined
          && Number.isFinite(Number(record.eventWave)) ? Number(record.eventWave) : null,
        emerge: emergence,
      });
      if (!inst) continue;
      inst.health = restoreHealth;
      if (migrateBossPool) {
        inst.balanceMigration = {
          fromMax: savedMax, fromHealth: savedHealth,
          toMax: restoreMax, toHealth: restoreHealth,
        };
      }
      inst.home = record.home && Number.isFinite(Number(record.home.x))
        && Number.isFinite(Number(record.home.z))
        ? { x: Number(record.home.x), z: Number(record.home.z) } : { x, z };
      inst.suspicion = clamp01(Number(record.suspicion) || 0);
      inst.alerted = !!record.alerted;
      inst.fireTimer = Math.max(0, Number(record.fireTimer) || 0);
      inst.burstLeft = Math.max(0, Math.round(Number(record.burstLeft) || 0));
      if (record.broodTimer !== null && record.broodTimer !== undefined
        && Number.isFinite(Number(record.broodTimer))) {
        inst.broodTimer = Math.max(0, Number(record.broodTimer));
      }
      if (inst.body) {
        const saved = record.body && typeof record.body === "object" ? record.body : {};
        const heading = Number.isFinite(Number(saved.heading))
          ? Number(saved.heading) : inst.yaw;
        const hy = Number.isFinite(Number(saved.y))
          ? Number(saved.y) : groundY(x, z);
        const phase = typeof saved.phase === "string" ? saved.phase : "burrow";
        const depth = clamp(Number(saved.depth) || 0, -20, 20);
        seedBody(inst, Number.isFinite(Number(saved.x)) ? Number(saved.x) : x,
          hy, Number.isFinite(Number(saved.z)) ? Number(saved.z) : z, heading,
          phase === "burrow" && depth > 0 ? depth : null);
        inst.body.phase = phase;
        inst.body.timer = Math.max(0, Number(saved.timer) || 0);
        inst.body.depth = depth;
        inst.body.surfacings = Math.max(0, Math.round(Number(saved.surfacings) || 0));
      }
      if (inst.emerging && emergenceRecord) {
        inst.emerging.elapsed = Math.max(0, Number(emergenceRecord.elapsed) || 0);
        inst.emerging.active = true;
        inst.emerging.surfaced = !!emergenceRecord.surfaced;
        inst.emerging.burst = !!emergenceRecord.burst;
        /* The load menu may keep the scene paused for several seconds.
           Sample the saved rise immediately so the paused background does
           not show one frame at configureEmergence's initial 0.68 scale. */
        updateEmergence(inst, 0, true);
      } else {
        play(inst, inst.alerted ? "alert" : "idle", 0);
      }
      byId.set(inst.id, inst);
    }
    for (const record of records) {
      const inst = byId.get(record.id);
      if (!inst) continue;
      inst.broodKids = (Array.isArray(record.broodIds) ? record.broodIds : [])
        .map((id) => byId.get(id)).filter(Boolean);
    }
    rng.setState?.(saved.rng);
    return { restored: byId.size, byId };
  }

  return {
    group,
    species,
    live,
    garrison,
    spawn,
    snapshot,
    restore,
    play,
    replay,
    rescaleForDifficulty,
    update,
    /* The body chain's public surface, for the encounter module that
       drives it. `seedBody` lays a worm out straight, `poseBody`
       resolves this frame's trail into joint targets, and `trailAt`
       answers "where was the head N metres ago" - which is what a
       burrowing wake, a hit capsule and a dive all need. */
    seedBody,
    poseBody,
    trailAt,
    knockback,
    stun,
    kill(inst) {
      play(inst, "death", 0.12);
      /* A domain-owned humanoid can use a procedural fall instead of a GLB
         death clip. The authoritative combat state still has to become dead. */
      if (inst && inst.health <= 0 && inst.state !== "death") inst.state = "death";
    },
    remove(inst) {
      const index = live.indexOf(inst);
      if (index < 0) return false;
      disposeEmergence(inst);
      group.remove(inst.root);
      live.splice(index, 1);
      return true;
    },
    clear: clearAll,
    stats() {
      return {
        species: species.size,
        live: live.length,
        clips: [...species.values()].map((s) => `${s.key}:${s.clips.size}`),
      };
    },
  };
}

export { LEG_RE };
