/* ============================================================
   SAINTFALL - the Stylite

   The Choir Spires' own animal, and everything about it that is not
   geometry: why it is never on the ground, what it takes to put it
   there, and what those few seconds are worth.

   THE NAME

   A stylite is an ascetic who lives on top of a pillar. Simeon spent
   thirty-seven years on one. This district is fifty-four wind-carved
   needles standing eighty to a hundred and thirty metres out of the
   rock, and something has been living on the crowns of them.

   WHAT IT IS

   A leaping bug. Compact, armoured, and mostly hind leg: two enormous
   coiled springs that visibly compress before every jump and unload on
   the frame it leaves. Four small grasping forelegs that hold it to
   the rock, and a bored maw in the head that it spits through.

   THE FIGHT IS VERTICAL, AND THAT IS THE WHOLE POINT

   Every other boss in the game is a thing you stand in front of. The
   Winnower flies, but it flies over open ground and comes down when
   its lift runs out. This one is anchored to DISCRETE PERCHES - the
   district's own needles, read from the world builder rather than
   invented - so the question is never "where is it" but "which spire,
   and what is between us".

     DORMANT   Folded on a crown, dark, indistinguishable from the
               rock it is on. Nothing until the player crosses the
               aggro radius.
     ROUSE     3.4s. It unfolds, the plates open, and it looks down.
     PERCHED   THE FIGHT. It rakes the ground beneath it with its
               volley and picks a new needle every few seconds.
               Hard to hit: small, ninety metres up, and behind its
               own rock as often as not.
     LEAP      A compressed spring, a launch, an arc, and a landing
               that cracks whatever it lands on.
     STOOP     The answer to a player who camps out of its arc: it
               jumps AT them instead, telegraphed by a shadow, and
               lands with a shockwave.
     PLUMMET   THE MECHANIC. Its GRIP is a separate pool from its
               health, it only takes damage while the animal is
               perched, and emptying it tears the forelegs off the
               rock. It falls - properly falls, tumbling, taking its
               own impact - and lies stunned on the ground where a
               polearm can reach it. This is the only window in which
               it is cheap to kill, and the player makes it happen.
     RECOVER   It gathers itself and goes back up.

   Nothing here is a flyer. It cannot hover, cannot correct mid-air,
   and cannot choose not to land - which is what makes breaking its
   grip meaningful rather than merely inconvenient.

   ============================================================
   THE SURFACE ROUND, AND THE FOUR THINGS IT CHANGED

   1. THE CAMOUFLAGE IS NOW AN OBJECT.

      It used to be a paint job: the animal was tan, the rock was tan,
      and the "reveal" was the same tan animal with its plates open.
      The gallery measured what that cost - meanLuma 112 against a
      Halo pool that tops out at 108, 66% of every frame in the mid
      band, and not one blown pixel in five photographs. A creature
      wearing its own district at its own value is terrain.

      So the district's sand moved OFF the animal and onto a CRUST: a
      separate shell of stone shards, in the needle's own rock, welded
      over the carapace while it sleeps and shed as real falling
      debris when it wakes. The animal underneath is the opposite of
      the Choir Spires - near-black chitin with a cold violet bias -
      and it never has to pretend to be rock again, because the rock
      is a thing it takes off.

      The shed runs a full second (CRUST_SHED), staggered per shard,
      with a tremble before the first one goes. One frame of it is a
      pop; a second of it is an animal breaking out.

   2. ONE PROGRAM FOR THE WHOLE ANIMAL.

      Four materials now - chitin shell, bone crust, bronze trim, wet
      membrane belly - which is four surface families and four
      different reads. It is also four MORE compiled programs if you
      let it be, and a program compiles the first frame its material
      is drawn, which here is the frame the boss wakes up: exactly the
      moment the game can least afford a hitch.

      `patchMaterial`'s cache key is rim/glitter/bio/dunes plus the
      kit's own version tag, and the FAMILY deliberately does not
      enter it - the whole family table is uniforms. So all four are
      patched with identical rim/glitter/bio and share one compiled
      program. They differ only in numbers. Change one of those three
      on one material and you have silently bought a compile in the
      middle of the reveal.

   3. THE BELLY IS LIT BY VERTEX ALPHA, THE SEAMS BY emissiveIntensity.

      Two channels, because they answer different questions. The
      alpha-driven `bio` emission is per-VERTEX, so one merged mesh
      can hold a blown-out ventral sac and a dim hairline seam at the
      same time. `emissiveIntensity` is per-MATERIAL and is the grip
      readout - it pulses, it runs hot as the grip slips, and it goes
      nearly out while the animal is down. A hierarchy inside the
      mesh, and a signal on top of it.

      Which is also why `seamMat.color` is white now. It was a dark
      violet, and multiplied by the vertex colours underneath it the
      belly's albedo came out near black - so `bio`, which scales with
      albedo, had nothing to emit.

   4. DORMANT STILL COSTS NOTHING, and there is now more that could
      cost something. Every addition below - the shed, the flinch
      spring, the antenna lag, the grip dust - lives inside the same
      `group.visible` gate as `poseBody`, for the reason recorded
      there: this animal's pose solve once cost the WHOLE GAME 1.3ms a
      frame while it sat invisible on a needle in another district.
      The crust hides itself the moment the last shard lands and the
      shed loop stops being entered at all.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus, makeRng, smoothstep,
} from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
import { DISTRICTS } from "saintfall/terrain.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

export const STYLITE_CONFIG = Object.freeze({
  homeX: DISTRICTS.choir.x,
  homeZ: DISTRICTS.choir.z,

  aggroRadius: 78,
  rouseSeconds: 3.4,
  arenaRadius: 96,
  disengageRadius: 220,
  disengageSeconds: 14,
  retireSeconds: 4.0,

  /* ------------------------------------------------------------
     THE PERCHES
     ------------------------------------------------------------ */
  /* Which of the district's needles it will use. Tall enough that the
     player has to look up, near enough the middle that the fight does
     not wander out of the arena, and at least this far apart so a leap
     is a real relocation rather than a hop. */
  perchMinHeight: 46,
  perchMaxRange: 150,
  perchMinSpacing: 46,
  perchCount: 7,
  /* How far down the crown it grips, AS A FRACTION OF THE NEEDLE.

     A fixed three metres was the first try and it put the animal on
     the very point: these needles taper hard - the world builder runs
     `shrink` to 0.34 over the last fifth - so three metres below the
     tip the rock is barely a metre across, narrower than the creature
     standing on it, and it read as hovering beside a spike. An eighth
     of the way down the shoulder is seven or eight metres wide and it
     reads as something gripping a tower. */
  perchDropFraction: 0.13,
  /* HOW FAR THE CLAWS SINK INTO THE ROCK THEY ARE HOLDING.

     This used to be `standHeight: 2.4` - a hand-written guess at "hip
     to foot in the clinging pose" - and it was wrong by four metres
     the moment the animal was scaled to 1.7, in the direction nobody
     checks. Measured on the real rig: the forelegs' claw tips sit
     4.5m below the body origin in the grip pose and the hind springs'
     sat TEN, so a body parked 2.4m over the crown had four limbs
     buried in the rock and two hanging eight metres clear of it in
     open air. That is the "legs terminate in flat-cut floating
     stumps... with nothing under them" verdict, and no amount of end
     geometry fixes a limb that is simply not near the surface.

     So the stand height is no longer a number. `STAND_DROP` below
     solves the leg chain in the perched pose and takes the deepest
     claw, and this is the only free parameter left: how far past
     first contact the claw is driven, so the grip reads as bitten in
     rather than as resting on. A gap is the failure this exists to
     make impossible; a small penetration is what a claw in stone
     looks like. */
  standBite: 0.3,
  /* Off the axis, toward the middle of the district: it clings to the
     SHOULDER facing the arena rather than balancing on the crown, so
     it is overlooking the fight rather than sitting on a post. */
  shoulderOffset: 0.45,

  /* ------------------------------------------------------------
     THE BARRAGE
     ------------------------------------------------------------ */
  volleyCadence: 2.35,
  volleyWindup: 0.55,
  volleyShots: 3,
  volleyGap: 0.14,
  volleySpeed: 78,
  volleyDamage: 15,
  /* Lobbed rather than hitscan, and slow enough to walk out of. From
     ninety metres up a hitscan weapon is not a threat, it is a tax:
     there is no reaction to make. A visible bolt with a travel time
     turns "it is shooting at me" into "it is shooting at where I was". */
  volleyLead: 0.55,
  volleyMax: 24,

  /* ------------------------------------------------------------
     THE LEAP
     ------------------------------------------------------------ */
  perchSeconds: [4.6, 7.4],
  /* The coil, the flight, and the grab. The coil is the read - a
     spring visibly loading is the clearest telegraph an animal can
     give - and the flight is deliberately slow enough to track with
     the eye and shoot at. It is at its most vulnerable in the air. */
  coilSeconds: 0.75,
  flightSeconds: 1.35,
  landSeconds: 0.45,
  /* How high above the straight line between two crowns the arc goes,
     as a fraction of the distance. Real jumping insects throw
     themselves far higher than they need to. */
  arcRise: 0.42,

  /* ------------------------------------------------------------
     THE STOOP
     ------------------------------------------------------------ */
  stoopCadence: 13,
  /* Only thrown at a player who is standing where the barrage cannot
     reach - which is the point of it. A stoop at somebody already
     being shot at is just a second attack; a stoop at somebody hiding
     behind a needle is an eviction. */
  stoopMinRange: 26,
  stoopRadius: 13,
  stoopDamage: 46,
  stoopSlowFactor: 0.36,
  stoopSlowSeconds: 1.2,

  /* ------------------------------------------------------------
     THE GRIP, AND THE FALL
     ------------------------------------------------------------ */
  /* A pool entirely separate from its health, and the only one the
     player can empty on purpose. Sized so that a committed magazine
     into a perched target brings it down: the fight should reward
     shooting UP, which is the awkward thing to do, over waiting.

     It refills while the animal is on a perch it has just taken, so a
     player who chips at it between leaps achieves nothing - the grip
     has to be broken in one sustained effort. */
  gripMax: 900,
  gripRegen: 55,
  /* Damage to the grip is a fraction of damage dealt, so every weapon
     contributes in proportion and nothing needs its own rule. Above
     one, because the forelegs are a smaller target than the body and
     hitting them at all is the skill being paid for. */
  gripShare: 1.35,
  /* The fall itself. Long enough to watch, and it does its own damage
     on landing - an animal that drops ninety metres and stands up
     unharmed teaches the player that the mechanic is a formality. */
  fallSeconds: 1.15,
  fallSelfDamage: 420,
  /* Metres past the foot of its own needle that a falling Stylite
     lands. Big enough that the animal, its crash crater and the
     player swinging at it are all on open sand. */
  fallClearance: 11,
  /* Where the body's ORIGIN rests once it has crashed. The thorax is
     a 1.33m half-height sphere carrying a 1.7x body scale, so its
     underside sits 2.26m below the origin - and the 0.9 this was
     written at, before the animal was scaled up to read from the
     ground, buried the whole belly and both hind springs in the sand.
     Slightly under the full 2.26 on purpose: it has just fallen
     eighty metres and should be settled into its own crater, not
     parked on top of the dune. */
  crashRestHeight: 1.95,
  crashRadius: 9,
  crashDamage: 26,
  /* THE WINDOW. Everything the player did to earn it is spent here. */
  stunnedSeconds: 6.5,
  stunnedMeleeMult: 2.8,
  recoverSeconds: 1.4,
  /* It cannot be brought down twice in a row without going back up:
     the grip is restored in full on landing, and a fresh perch has to
     be taken before the next fall is possible. */
  simRange: 620,
});

/* ------------------------------------------------------------------
   THE PALETTE

   Three families in deliberately unequal areas, which is the accent
   language the art-direction doc asks every boss for: a LOT of the
   dominant neutral, a LITTLE of the warm accent, a SPOT of the
   saturated focal.

     dominant  near-black chitin, biased cold and violet. It is the
               inverse of the Choir Spires' warm rock (#a98a72) in
               both hue and value, so the animal separates from its
               own district at silhouette range, before any surface
               detail is resolvable.
     accent    blackened bronze on the crest rails and the thoracic
               collar only - a few per cent of the surface, in a
               designed band rather than scattered.
     focal     the ventral sac. The one saturated, blown-out thing on
               the animal, and it is on the belly because the belly is
               the only surface with a guaranteed line to a camera
               that spends the whole fight underneath it.

   ROCK_* is the crust, and it is the ONLY place the district's sand
   is allowed on this animal. It is authored to match a Choir needle
   at value, because a crust that does not disappear into the rock has
   nothing to shed.
   ------------------------------------------------------------------ */
/* THESE WENT UP ONCE, AFTER A BACKLIT PHOTOGRAPH.

   The first dark pass was authored against the gallery's framings,
   which are all lit from roughly camera-side, and it looked right in
   every one of them. Then the reveal harness photographed the same
   animal against open sky with the sun BEHIND it - which is most of
   this fight, because the boss is ninety metres up and the player is
   underneath - and at those albedos the diffuse term is only the sky
   fill, so the whole creature came back as a solid black cut-out with
   two pink dots in it. That is the Abbess's recorded failure arriving
   here by a different route: too dark AND too flat.

   So the shell sits about a stop and a half under the district's rock
   rather than four stops under it. Separation was never about being
   nearly black; it is about being a DIFFERENT hue at a DIFFERENT
   value, and cold violet at 0.12 against warm sand at 0.40 is
   separated by both. */
const SHELL_DARK = [0.028, 0.026, 0.045];
const SHELL_LIT = [0.115, 0.103, 0.162];
/* Plate rims, and they go PALE-COLD rather than warm. A warm edge
   here is the district's own light and puts the animal back into the
   sand; a cold one reads as sky bouncing off a wet shell. Held well
   under the crust's own lit value: the crest is the largest single
   plate on the animal and the first pass photographed it at almost
   exactly the sandstone behind it, which put the boss's biggest,
   most readable shape back into the district it had just left. */
const SHELL_EDGE = [0.195, 0.172, 0.272];
/* Wet dark muscle, the one warm-ish thing under the plates. */
const SPRING_DARK = [0.045, 0.019, 0.034];
const SPRING_LIT = [0.190, 0.068, 0.104];
/* The accent. Blackened bronze, oxidised toward amber where it rubs. */
const BRASS_DARK = [0.038, 0.024, 0.012];
const BRASS_LIT = [0.300, 0.172, 0.058];
/* The crust: the needle's own rock, and nothing else on the animal
   is allowed to be this colour. */
const ROCK_DARK = [0.078, 0.061, 0.046];
const ROCK_LIT = [0.460, 0.358, 0.272];
const GLOW_VIOLET = [0.52, 0.20, 0.62];
/* The focal. Authored past 1.0 in the violet channels on purpose:
   multiplied through the bio path this is the one surface on the
   animal that is MEANT to clip, and a boss with no blown pixel
   anywhere on it has no wet, no polish and no heat. */
const BELLY_HOT = [0.78, 0.36, 0.92];

/* The body's world scale, quoted once. It sizes the surface kit's
   grain in WORLD metres (the geometry is authored at 1:1 and drawn at
   1.7) as well as the animal, and the two drifting apart is a shell
   whose pores are the wrong size for the creature wearing them. */
const BODY_SCALE = 1.7;

/* How long the stone crust takes to come off, from the first crack to
   the last shard landing. A second, not a frame: the reveal is the
   most-watched moment this boss has and it plays under the encounter
   camera, which holds for 2.7s. */
const CRUST_SHED = 1.05;

export function buildStylite(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = STYLITE_CONFIG;
  const rng = makeRng(0x571e);
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "stylite";
  group.visible = false;
  scene.add(group);

  let inst = null;

  /* ============================================================
     THE RIG, AS DATA - AND WHY THE PERCH HEIGHT IS SOLVED FROM IT

     The leg dimensions and the perched pose used to live inline at
     the two places that needed them, and the height the animal sat
     at was a separate hand-written constant. The two drifted, which
     is the only thing two numbers describing the same distance ever
     do: the body was parked 2.4m over the crown while the rig it was
     carrying reached 4.5m down with the forelegs and TEN metres down
     with the hind springs. Four claws inside the rock and two limbs
     hanging in open sky, which is what a critic sees before anything
     else in the frame.

     So there is one source now. The specs and the perched angles are
     constants, `clawTip` solves the chain, and the perch height is
     whatever puts the deepest claw `standBite` into the stone. Change
     a femur length and the animal re-seats itself.
     ============================================================ */
  /* The tarsus is angled off the tibia in GEOMETRY (it is a fixed
     part of the foot, not a joint the animator drives) and the claw
     hooks off the tarsus the same way. Quoted here because the FK
     below and the mesh builder must agree on them exactly - a claw
     the solver does not know about is a claw that does not reach. */
  const TARSUS_ANGLE = -1.15;
  const CLAW_FRAC = 1.15;
  const CLAW_HOOK = -0.62;
  /* How far the claw's root is sunk back UP the tarsus. Solved, not
     picked: the claw is built wider than the tarsus tip, so it has to
     start back where the tarsus is still wider than the claw's base
     or the join shows as an exposed flat ring - a smaller version of
     the flat end cap this claw exists to get rid of. */
  const CLAW_SEAT = 0.36;
  /* The nose-down pitch a perched Stylite takes (see `poseBody`). It
     is part of the reach: it swings the front claws down and the rear
     ones up by most of a metre. */
  const PERCH_PITCH = 0.42;

  const SPRING_SPEC = {
    femur: 3.5, tibia: 3.9, tarsus: 1.1, thick: 0.78, spring: true,
    ramp: [SPRING_DARK, SPRING_LIT],
  };
  const GRASPER_SPEC = {
    femur: 1.5, tibia: 1.7, tarsus: 0.7, thick: 0.3,
    ramp: [SHELL_DARK, SHELL_LIT],
  };

  /* THE HIND SPRINGS' GRIP POSE, AND WHY IT IS A FOLD NOW.

     It was `{ hip: -0.55, knee: 1.45, foot: -0.75 }`, which is a leg
     STANDING: 8.5 units of femur-plus-tibia reaching almost straight
     down off a body that is holding onto a rock face beside it. On a
     crown it put both springs into thin air with their tarsi ninety
     metres above the sand, and it is most of what the "floating
     stumps with nothing under them" verdict was actually looking at.

     A perched jumping insect does not stand on its hind legs, it
     PARKS them: femur down and forward past the belly, tibia folded
     back up under the abdomen, tarsus braced against the rock at
     about the same depth the forelegs are holding it. Which is also
     the right shape for this fight - the player is underneath, so
     the folded spring is the part of the animal they can actually
     see, and the coil then has somewhere to travel FROM. */
  const SPRING_GRIP = { hip: -0.98, knee: 2.74, foot: 1.37, hipZ: 0.42 };
  const GRASPER_GRIP = { hip: -0.35, knee: 1.50, foot: 0, hipZ: 0.65 };

  const _fkE = new THREE.Euler();
  const _fkV = new THREE.Vector3();
  const _fkC = new THREE.Vector3();

  /**
   * The tip of one leg's claw, in BODY space, for a given pose.
   *
   * Written against the same three groups the mesh builder nests
   * (hip -> knee -> foot) and the same baked tarsus and claw angles,
   * because the whole point is that the solver and the geometry
   * cannot disagree.
   */
  function clawTip(spec, pose, side, hipX, hipY, hipZ) {
    const clawLen = spec.tarsus * CLAW_FRAC;
    const over = spec.tarsus * CLAW_SEAT;
    // The claw's point, in the tarsus's own frame, then into the foot's.
    _fkC.set(0, over - clawLen, 0).applyEuler(_fkE.set(CLAW_HOOK, 0, 0, "XYZ"));
    _fkC.y -= spec.tarsus;
    _fkC.applyEuler(_fkE.set(TARSUS_ANGLE, 0, 0, "XYZ"));
    // foot -> knee -> hip, exactly as the group hierarchy composes them.
    _fkC.applyEuler(_fkE.set(pose.foot || 0, 0, 0, "XYZ"));
    _fkC.y -= spec.tibia;
    _fkC.applyEuler(_fkE.set(pose.knee, 0, 0, "XYZ"));
    _fkC.y -= spec.femur;
    _fkC.applyEuler(_fkE.set(pose.hip, 0, side * pose.hipZ, "XYZ"));
    return _fkC.add(_fkV.set(hipX, hipY, hipZ)).clone();
  }

  /** How deep that claw hangs below the body origin once the animal
   *  has taken its nose-down perch pitch, in WORLD metres. */
  function clawDrop(spec, pose, side, hipX, hipY, hipZ) {
    const p = clawTip(spec, pose, side, hipX, hipY, hipZ);
    p.applyEuler(_fkE.set(PERCH_PITCH, 0, 0, "XYZ"));
    return -p.y * BODY_SCALE;
  }

  /* WHERE THE FORELEGS ARE, and the rear pair's knee is SOLVED
     rather than shared with the front pair.

     Both pairs used one angle, and under a 0.42 nose-down pitch that
     lands them on a plane tilted 24 degrees off the rock: the front
     claws bite and the rear two hang most of a metre clear. Bisecting
     the rear knee (straighter reaches further, and it is monotonic
     over this interval) puts all four on the same plane for the cost
     of twenty iterations at load. */
  const GRASPER_HIPS = [
    { x: 1.0, y: -0.3, z: 0.95, index: 0 },
    { x: 1.0, y: -0.3, z: -0.05, index: 1 },
  ];
  const frontDrop = clawDrop(GRASPER_SPEC, GRASPER_GRIP, 1,
    GRASPER_HIPS[0].x, GRASPER_HIPS[0].y, GRASPER_HIPS[0].z);
  const rearKnee = (() => {
    let lo = 0.55;
    let hi = GRASPER_GRIP.knee;
    for (let i = 0; i < 20; i += 1) {
      const mid = (lo + hi) * 0.5;
      const d = clawDrop(GRASPER_SPEC, { ...GRASPER_GRIP, knee: mid }, 1,
        GRASPER_HIPS[1].x, GRASPER_HIPS[1].y, GRASPER_HIPS[1].z);
      if (d > frontDrop) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  })();
  GRASPER_HIPS[0].kneeGrip = GRASPER_GRIP.knee;
  GRASPER_HIPS[1].kneeGrip = rearKnee;

  /* THE DEEPEST CLAW ON THE ANIMAL. Everything the body rides at is
     measured off this one number. */
  const STAND_DROP = Math.max(
    frontDrop,
    clawDrop(GRASPER_SPEC, { ...GRASPER_GRIP, knee: rearKnee }, 1,
      GRASPER_HIPS[1].x, GRASPER_HIPS[1].y, GRASPER_HIPS[1].z),
    clawDrop(SPRING_SPEC, SPRING_GRIP, 1, 1.15, -0.35, -0.95));

  /* ============================================================
     THE PERCHES

     Read from the world builder's own list of standing needles, not
     invented here. They are the rock the district is made of: the
     same rock in the collision grid, the same rock the light shafts
     hang off. An encounter that guessed at ledge positions would put
     the animal inside a spire the first time the spire field moved.
     ============================================================ */
  const perches = (() => {
    const all = ctx.world?.choirNeedles || [];
    const near = all
      .filter((n) => n.h >= C.perchMinHeight
        && Math.hypot(n.x - C.homeX, n.z - C.homeZ) <= C.perchMaxRange)
      // Tallest first: the crowns that already carry the skyline.
      .sort((a, b) => b.h - a.h);
    const out = [];
    for (const n of near) {
      if (out.length >= C.perchCount) break;
      if (out.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < C.perchMinSpacing)) continue;
      /* Toward the district centre, so every crown it uses overlooks
         the ground the fight happens on. */
      const bx = C.homeX - n.x;
      const bz = C.homeZ - n.z;
      const bd = Math.hypot(bx, bz) || 1;
      /* The rock's own width where it grips - the world builder's own
         taper, so the offset follows the needle rather than a guess. */
      const drop = n.h * C.perchDropFraction;
      const localRad = n.rad * lerp(1, 0.34,
        Math.pow(clamp01((n.h - drop) / n.h), 2.3));
      out.push({
        x: n.x + (bx / bd) * localRad * C.shoulderOffset,
        z: n.z + (bz / bd) * localRad * C.shoulderOffset,
        /* The crown, plus whatever it takes to put the deepest claw
           `standBite` INTO it. Solved from the rig - see STAND_DROP. */
        y: n.baseY + n.h - drop + STAND_DROP - C.standBite,
        rad: localRad,
        /* The needle's own axis, kept because the crown is not over
           it: a leaning shaft puts its high point metres away, and
           the height map below has to be boxed on the ROCK rather
           than on the offset the shoulder pose asked for. */
        axisX: n.x,
        axisZ: n.z,
        /* The needle's full footprint, kept alongside the crown
           radius. A caller asking "can I see the crown from over
           there" is really asking about the whole cone, and the
           taper between the two is most of a needle. */
        baseRad: n.rad,
        baseY: n.baseY,
      });
    }
    /* A fallback ring, for a world that produced no needles tall
       enough - a seeded spire field is not guaranteed, and a boss with
       nowhere to stand is a boss that never appears. Deliberately
       placed at plausible crown height rather than on the ground, so
       the failure is visible in a screenshot rather than silent. */
    if (out.length < 3) {
      for (let i = out.length; i < 3; i += 1) {
        const a = (i / 3) * TAU;
        const x = C.homeX + Math.cos(a) * 62;
        const z = C.homeZ + Math.sin(a) * 62;
        out.push({ x, z, y: groundAt(x, z) + 58, rad: 6, baseRad: 6,
          baseY: groundAt(x, z), axisX: x, axisZ: z });
      }
    }
    return out;
  })();

  /* ============================================================
     THE CROWN, MEASURED

     `perches` above puts the animal at `n.baseY + n.h - drop`, which
     is where the world builder's own PARAMETERS say the rock is. It
     is not where the rock is. `world.js` builds a needle as a stack
     of jittered drums with random waists, per-ring centre offsets up
     to 0.30 of the radius, six-to-nine random sides, then TILTS the
     whole stack by up to 0.1 rad - which over a 128m shaft walks the
     crown better than ten metres sideways - and finally sinks it into
     the terrain with `restOnTerrain`. None of that is visible in the
     four numbers the needle record carries.

     Measured against the built mesh at the perch this boss actually
     takes: the record's axis says the crown is at 125m; the rock
     directly over that axis is at 112.6m; and the real high point of
     that needle is ten metres away in the direction the shaft leans,
     at 137m. The perch offset then pushed the animal the OPPOSITE
     way, down the falling side, and parked it at 129.55 - two and a
     half metres UNDER a surface it was supposed to be standing on,
     with the front graspers twenty-seven metres clear of any rock at
     all. That is the "visible gap between the foot and the rock it is
     standing on" verdict, and it is not a rig problem: the rig was
     right and the rock was somewhere else.

     So the rock is asked, and asked cheaply. Raycasting is the
     obvious tool and the wrong one - one ray against the district's
     9.5k-triangle rock measured 0.68ms, and finding a leaning crown
     needs a search, not a sample. Instead the rock's own triangles
     are read ONCE, in a single linear pass, and splatted into a small
     max-height grid around each perch. That is 9.5k triangles against
     seven boxes, it runs in single-digit milliseconds at load, and
     afterwards every question a claw can ask - "what is under me",
     "where is the top of this thing" - is two array indices.

     Nothing here costs a frame. If the rock mesh is not in the scene
     when this runs, every perch keeps its analytic height and the
     animal stands exactly where it used to; `ensureSpawned` retries
     once. A missing measurement must degrade, not throw.
     ============================================================ */
  /* 1.25m cells over a 44m box: fine enough that a claw lands on the
     drum it is looking at rather than the one next to it, coarse
     enough that seven of them are 25kB. */
  const CROWN_CELL = 1.25;
  const CROWN_HALF = 22;
  const CROWN_N = Math.round((CROWN_HALF * 2) / CROWN_CELL);
  /* How far below the seated crown height still counts as rock. Past
     this the sample is over an edge, and a limb reaching for it is a
     limb reaching into open air - which is the thing this whole block
     exists to stop. */
  const CROWN_CLIFF = 4.2;
  /* How far off the high point it is allowed to shuffle for the
     shoulder pose. It clings to the side of a crown rather than
     balancing on the point, but only as far as the rock comes with
     it: the old fixed offset is what walked it off the edge. */
  const SHOULDER_MAX_FALL = 1.8;
  let crownsMapped = false;

  function mapCrowns() {
    if (crownsMapped) return;
    const rock = scene.getObjectByName("choir-rock");
    const geo = rock && rock.geometry;
    const pos = geo && geo.attributes && geo.attributes.position;
    if (!pos) return;
    crownsMapped = true;
    /* Triangle vertices come out of the buffer in the mesh's own
       space. Nothing has rendered when this runs, so `matrixWorld` is
       whatever the world builder left - refresh it rather than trust
       it. */
    rock.updateWorldMatrix(true, false);
    const mat = rock.matrixWorld;
    const idx = geo.index;
    const tris = idx ? idx.count / 3 : pos.count / 3;
    for (const p of perches) {
      p.grid = new Float32Array(CROWN_N * CROWN_N).fill(-Infinity);
      /* Boxed on the NEEDLE's axis, not on the perch: the crown this
         is looking for is the thing that leaned away from the axis,
         and a box centred on the old perch point can miss it. */
      p.gx0 = p.axisX - CROWN_HALF;
      p.gz0 = p.axisZ - CROWN_HALF;
    }
    const v = new THREE.Vector3();
    for (let t = 0; t < tris; t += 1) {
      let hi = -Infinity;
      let minX = Infinity; let maxX = -Infinity;
      let minZ = Infinity; let maxZ = -Infinity;
      for (let k = 0; k < 3; k += 1) {
        const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(pos, i).applyMatrix4(mat);
        if (v.y > hi) hi = v.y;
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
      }
      for (const p of perches) {
        if (maxX < p.gx0 || minX > p.gx0 + CROWN_HALF * 2) continue;
        if (maxZ < p.gz0 || minZ > p.gz0 + CROWN_HALF * 2) continue;
        /* The triangle's own top, splatted over the cells its
           footprint covers. A max-height field is the right shape for
           "can a claw reach this" - an undercut drum must not hide the
           shelf above it, which is exactly what a first-hit ray does. */
        const cx0 = Math.max(0, Math.floor((minX - p.gx0) / CROWN_CELL));
        const cx1 = Math.min(CROWN_N - 1, Math.floor((maxX - p.gx0) / CROWN_CELL));
        const cz0 = Math.max(0, Math.floor((minZ - p.gz0) / CROWN_CELL));
        const cz1 = Math.min(CROWN_N - 1, Math.floor((maxZ - p.gz0) / CROWN_CELL));
        for (let cz = cz0; cz <= cz1; cz += 1) {
          const row = cz * CROWN_N;
          for (let cx = cx0; cx <= cx1; cx += 1) {
            if (p.grid[row + cx] < hi) p.grid[row + cx] = hi;
          }
        }
      }
    }
    for (const p of perches) seatOnCrown(p);
  }

  /** The mapped rock height at a world position, or null off the map. */
  function gridAt(p, wx, wz) {
    if (!p.grid) return null;
    const cx = Math.floor((wx - p.gx0) / CROWN_CELL);
    const cz = Math.floor((wz - p.gz0) / CROWN_CELL);
    if (cx < 0 || cz < 0 || cx >= CROWN_N || cz >= CROWN_N) return null;
    const h = p.grid[cz * CROWN_N + cx];
    return Number.isFinite(h) ? h : null;
  }

  /**
   * Move a perch onto the rock the grid actually found, and record the
   * height the animal is seated at.
   *
   * Two steps, and the second is the one the old code got wrong. Find
   * the high point of the needle - which is NOT over its recorded axis
   * once the shaft leans - and then walk toward the district centre
   * for the shoulder pose only as far as the rock stays with it.
   */
  function seatOnCrown(p) {
    if (!p.grid) return;
    let best = -Infinity;
    let bx = p.axisX;
    let bz = p.axisZ;
    const reach = Math.min(CROWN_HALF - 1, p.baseRad);
    for (let cz = 0; cz < CROWN_N; cz += 1) {
      const wz = p.gz0 + (cz + 0.5) * CROWN_CELL;
      for (let cx = 0; cx < CROWN_N; cx += 1) {
        const h = p.grid[cz * CROWN_N + cx];
        if (!Number.isFinite(h) || h <= best) continue;
        const wx = p.gx0 + (cx + 0.5) * CROWN_CELL;
        if (Math.hypot(wx - p.axisX, wz - p.axisZ) > reach) continue;
        best = h; bx = wx; bz = wz;
      }
    }
    if (!Number.isFinite(best)) return;
    /* Toward the middle of the district, one cell at a time, stopping
       at the last step that is still rock within `SHOULDER_MAX_FALL`
       of the summit. */
    const ox = C.homeX - bx;
    const oz = C.homeZ - bz;
    const od = Math.hypot(ox, oz) || 1;
    let sx = bx; let sz = bz;
    for (let step = 1; step <= 5; step += 1) {
      const nx = bx + (ox / od) * step * CROWN_CELL;
      const nz = bz + (oz / od) * step * CROWN_CELL;
      const h = gridAt(p, nx, nz);
      if (h == null || h < best - SHOULDER_MAX_FALL) break;
      sx = nx; sz = nz;
    }
    p.x = sx;
    p.z = sz;
    p.seatY = gridAt(p, sx, sz);
    /* `STAND_DROP` is the deepest claw in the grip pose, solved off
       the rig, so this is the one body height that puts that claw
       `standBite` INTO the stone rather than through it or over it. */
    p.y = p.seatY + STAND_DROP - C.standBite;
  }

  /**
   * The rock under a world position, for the perch `p`, or null where
   * there is none within reach.
   *
   * A caller that gets null must TUCK the limb, not extend it: a leg
   * reaching for rock that is not there is exactly the flat-cut stump
   * hanging in open air the critic named first.
   */
  function crownAt(p, wx, wz) {
    const h = gridAt(p, wx, wz);
    if (h == null || p.seatY == null) return null;
    return h < p.seatY - CROWN_CLIFF ? null : h;
  }

  mapCrowns();

  const state = {
    phase: "dormant",   // dormant, rouse, perched, leap, stoop, plummet, stunned, recover, retire, dead
    timer: 0,
    woken: 0,
    perch: 0,           // index into `perches`
    /* Where the body actually is. On a perch this is the perch; in
       flight it is interpolated along the arc; on the ground it is
       wherever it came down. */
    pos: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    arcHeight: 0,
    flight: 0,
    /* 0 relaxed, 1 fully compressed. Drives the hind legs and is the
       single most important read the animal has. */
    coil: 0,
    facing: 0,
    grip: C.gripMax,
    volleyTimer: 0,
    volleyWind: 0,
    volleyLeft: 0,
    volleyGap: 0,
    stoopTimer: 0,
    perchTimer: 0,
    falls: 0,
    disengageFor: 0,
    defeated: false,
    revealed: false,
    releaseCameraAt: undefined,
    tumble: 0,
    dustTick: 0,
    /* --- the surface round's own state -------------------------- */
    /* Latches the moment the last stone shard lands. Everything the
       crust costs is behind it. */
    crustGone: false,
    /* THE FLINCH, as a two-channel spring rather than a decay.

       A hit that only fades reads as a light going out. A hit that
       overshoots and settles reads as MASS being shoved, and mass is
       the whole thing a boss is being judged on. Pitch answers a shot
       from in front or behind, roll answers one from the side, and
       which one moves is what says the player hit where they aimed. */
    flinchP: 0,
    flinchPV: 0,
    flinchR: 0,
    flinchRV: 0,
    /* Landing absorb: 1 the frame it touches down, springing back
       through the legs. */
    absorb: 0,
    absorbV: 0,
    /* Volley recoil, so a bolt leaving the maw throws the head with
       it instead of appearing from a face that never moved. */
    recoil: 0,
    /* Where the last hit landed, in body space, so the flinch and the
       ichor both know which side of the animal was struck. */
    hurtSide: 0,
    hurtLift: 0,
    gripDust: 0,
    /* Death is a sequence here, not a flag. See `stepDeath`. */
    deathT: 0,
    deathFrom: new THREE.Vector3(),
    deathTo: new THREE.Vector3(),
    deathRoll: 0,
    deathLanded: false,
    surfaceDamage: 0,
    breath: 0,
  };
  /* Reused every frame. A Vector3 allocated inside a pose solve is a
     Vector3 the collector has to find again eighteen times a frame. */
  const _scratch = new THREE.Vector3();

  /* ============================================================
     MATERIALS
     ============================================================ */
  /* THE SHARED PATCH ARGUMENTS, and they are shared on purpose.

     `patchMaterial`'s program cache key is rim/glitter/bio/dunes plus
     the surface kit's version tag; the kit's FAMILY is uniforms only
     and deliberately stays out of it. So four materials patched with
     these three identical numbers compile ONE program between them,
     and the animal's four different surfaces cost four sets of
     uniforms rather than four shader builds - which matters because
     the first frame any of them is drawn on is the frame the boss
     wakes up. Vary rim, glitter or bio on one of them and you have
     bought a compile in the middle of the reveal.

     THE RIM WENT BACK UP, and the reason it was ever down is now
     gone. It was cut to 0.42 because the atmosphere patch's rim is
     additive and albedo-independent, and a TAN animal silhouetted
     against open sky caught it on every facet at once and read as a
     bright blob on a spire. The animal is not tan any more: at the
     new albedo the first backlit photograph of the reveal came back
     as a featureless black cut-out with two pink dots on it, which is
     the Abbess's over-correction arriving here - too dark AND too
     flat. The rim is the one term that answers exactly that, because
     it is strongest where the surface turns away and that is where
     all the lost form was. 0.85 still sits below a walker's 1.3. */
  const PATCH = { rim: 0.85, glitter: 0.10, bio: 1.5, scale: BODY_SCALE };

  /* THE GRAIN IS TUNED DOWN FROM THE FAMILY DEFAULT, AND HERE IS THE
     PHOTOGRAPH THAT MADE IT NECESSARY.

     `chitin` at its authored numbers - wavelength 1.15m, gloss spread
     0.22 - went onto this animal and the hind springs came back
     looking like WOVEN METAL MESH. A regular grid of bright dots,
     perfectly periodic, marching up the femur. Which is the kit's own
     recorded failure mode ("a cell field wrapped around a
     thirty-centimetre cylinder reads as cord") arriving through a
     different door: the relief was fine, the ROUGHNESS SPREAD was
     not. At 0.22 the troughs of the field drop to roughness 0.14, and
     a near-mirror lobe on a near-black albedo means the only thing
     visible anywhere on the shell is the pattern itself.

     Two changes, and they push in opposite directions on purpose:

       - the spread comes down by half, so the specular travels
         without ever going to mirror. Gloss that MOVES is the whole
         point; gloss that prints is a texture.
       - the wavelength comes down to 0.78m, which makes the field
         FINER rather than coarser. That is the counter-intuitive
         half. A coarser field would have had cells thirty pixels
         across at fighting range and periodicity is exactly what the
         eye locks onto; at 0.78 the two octaves that touch the normal
         land at 9cm and 3cm, which at 25-35m is one to three pixels -
         grain, which is what the micro-detail measure is actually
         asking for, rather than weave. */
  const GRAIN = { wavelength: 0.78, score: 0.0015, pore: 0.0005, gloss: 0.11 };

  const shellMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    /* Down from 0.58: what reads as "textured" on a model with no
       albedo map is a specular lobe that TRAVELS as the camera moves,
       and at 0.58 nothing on the animal ever caught the sun hard
       enough to clip - the metric harness measured exactly zero blown
       pixels across five photographs. Metalness up for the reason the
       kit's chitin family carries some: past a little of it the
       albedo becomes the specular colour, so a violet-black plate
       throws a violet highlight instead of a white one. */
    roughness: 0.50,
    metalness: 0.13,
  });
  shellMat.name = "sf-stylite-shell";
  shellMat.side = THREE.DoubleSide;
  applySurface(shellMat, atmos, "chitin", {
    ...PATCH, ...GRAIN, cavity: 0.26, sheen: 0.05, mottle: 0.13,
  });

  /* THE CRUST. Dry stone, and the only material on the animal wearing
     the district's own colour. `bone` rather than a rock family
     because the kit does not have one and bone is what dry, chalky,
     specular-dead mineral is in that table - widest cavity, narrowest
     gloss spread, heaviest edge wear. Wear turned up further still:
     a rubbed stone edge going pale and desaturated is the single most
     legible "this is old rock and not an animal" cue at forty metres,
     which is the whole job this material has for the two seconds
     before it falls off. */
  const crustMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.94,
    metalness: 0,
  });
  crustMat.name = "sf-stylite-crust";
  applySurface(crustMat, atmos, "bone", { ...PATCH, ...GRAIN, gloss: 0.07, wear: 0.22 });

  /* THE ACCENT. Blackened bronze on the crest rails and the thoracic
     collar and nowhere else - a few per cent of the animal, which is
     the point. The Scarab is not one colour and it is not two colours
     evenly; it is a lot of neutral, a little warm, and one saturated
     spot, and the unequal areas are what stop a big model reading as
     one mass. */
  const plateMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.50,
    metalness: 0.30,
  });
  plateMat.name = "sf-stylite-trim";
  /* The one material allowed to keep a wide gloss spread: corroded
     metal is SUPPOSED to have rubbed high points reading as bare
     bronze against a dielectric crust, and the accent covers so
     little of the animal that a pattern on it reads as pitting
     rather than as weave. */
  applySurface(plateMat, atmos, "bronze", { ...PATCH, ...GRAIN, gloss: 0.18 });

  /* THE SEAMS get their own material, and it is the only material on
     this animal whose emissive is driven per frame.

     The camouflage was once painted onto the carapace itself - a
     treehopper crest in warm shell against warm sandstone - and
     photographed from the flats that worked far too well: the boss
     was four tan pixels on tan rock, and a player standing under the
     spire could not find the thing shooting at them. The answer was
     never to repaint the animal, because a Stylite that is obvious
     while it sleeps throws away its own reveal. The answer is that
     the camouflage BREAKS, and it is now a crust that physically
     comes off rather than a colour that stops being convincing.

     What the seams then report is the GRIP. They run hotter and
     faster as it slips, so the fall - the whole fight's payoff - is
     legible from the ground for two full seconds before it happens,
     to a player who cannot read a health bar at ninety metres.

     AND WHY THE BASE COLOUR IS WHITE NOW. It was #3b0f4d, which
     multiplied against the violet vertex colours underneath it left
     the belly's albedo at about 1% linear. The `bio` path emits
     `albedo * vertexAlpha * uBio`, so an almost-black albedo had
     almost nothing to emit and the ventral sac - the animal's one
     focal element - could not be made to clip no matter what alpha it
     was painted at. White here means the vertex ramp IS the colour,
     which is what the rest of the animal already assumes.

     `membrane` for the family: this is wet muscle stretched over
     something hot, and what says wet is a highlight that MOVES, which
     is the widest gloss spread in the kit's table. */
  const seamMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.30,
    metalness: 0,
    color: new THREE.Color("#ffffff"),
    emissive: new THREE.Color("#c268ff"),
    emissiveIntensity: 0,
    transparent: true,
    opacity: 1,
  });
  seamMat.name = "sf-stylite-seam";
  applySurface(seamMat, atmos, "membrane", { ...PATCH, wavelength: 1.9, gloss: 0.16 });
  const _seamHot = new THREE.Color("#ffd9f4");
  const _seamCool = new THREE.Color("#a94dff");

  const boltMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b45cf0"),
    emissive: new THREE.Color("#e5b0ff"),
    emissiveIntensity: 1.7,
    roughness: 0.3,
    metalness: 0,
    flatShading: true,
  });
  boltMat.name = "sf-stylite-bolt";
  patchMaterial(boltMat, atmos, { rim: 0.5, glitter: 0 });

  /* ============================================================
     THE BODY

     A jointed insect, built as a hierarchy of groups and animated by
     ROTATING them - not by rewriting vertices.

     This is the opposite choice to the Garner's tentacles and the
     Abbess's sac, and for a reason: those two are surfaces that
     deform, and no skeleton expresses a swelling. This one is a rigid
     shell on hinges. Its whole read is a spring compressing, which is
     three angles per leg, and driving that through a vertex rewrite
     would be doing arithmetic on nine hundred points to express six
     numbers.
     ============================================================ */
  const body = new THREE.Group();
  body.name = "sf-stylite-body";
  /* YXZ, AND IT IS THE REASON TWO CLAWS WERE BURIED AND TWO WERE IN
     OPEN SKY.

     Three's default Euler order is XYZ, which composes as Rx.Ry.Rz -
     the yaw is applied to the vector FIRST and the pitch afterwards,
     about the WORLD x-axis. So `body.rotation.x = 0.42`, written to
     mean "nose down", is only nose-down when the animal happens to be
     facing along +z. This one turns to track the player, and at
     ninety degrees off that the same 0.42 is a pure ROLL: measured on
     the shipped build, the left pair of hips sat 1.39m higher than
     the right pair of hips on a rig whose two pairs are at the same
     height by construction. Four claws on a plane tilted 24 degrees
     off a rock, which no amount of end geometry or leg length fixes,
     and which `clawDrop` could never see because the solver applies
     the pitch in BODY space - correctly - and the renderer did not.

     YXZ composes as Ry.Rx.Rz: pitch and roll happen in the animal's
     own frame and the yaw goes on top. The solver and the renderer
     now agree, which is the only reason the perch height below can be
     solved rather than guessed. */
  body.rotation.order = "YXZ";
  group.add(body);
  let seamGlow = null;
  let mawGlow = null;

  /* SECONDARY MOTION LIVES IN THESE TWO GROUPS.

     A rigid shell on hinges is a cheap animal to pose and a dead one
     to watch: every part of it arrives at its new angle on the same
     frame, which is the tell that says "rig" rather than "creature".
     The crest is a metre and a half of shell cantilevered off the
     thorax and the antennae are whips, so both of them should ARRIVE
     LATE - and they are the only two parts light enough that lagging
     them does not fight the mass read the springs are carrying. */
  const crestPivot = new THREE.Group();
  crestPivot.position.set(0, 0.55, -0.4);
  body.add(crestPivot);
  const antPivot = new THREE.Group();
  antPivot.position.set(0, 0.1, 1.6);
  body.add(antPivot);

  /** Paint a geometry on the shell ramp.
   *
   *  `src` is the random stream the per-vertex jitter is drawn from,
   *  and it is a parameter because the crust must NOT draw from the
   *  encounter's - see the note on `crng` where the shards are built. */
  function paint(geo, lit, glow = 0, ramp = null, src = rng, opts = null) {
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    const from = ramp ? ramp[0] : SHELL_DARK;
    const to = ramp ? ramp[1] : SHELL_LIT;
    /* THE JITTER IS THE REASON A LEG COULD BE LIT IMPOSSIBLY.

       `0.82 + rand*0.36` is an eighteen per cent albedo swing drawn
       INDEPENDENTLY per vertex, and on a flat-shaded prism a facet's
       value is the mean of its three. Six facets, six independent
       draws: nothing stops the facet pointing into the body coming
       out brighter than the one pointing at the sky, which is
       geometrically impossible and reads instantly as a painted
       plane rather than a limb. It never showed on the thorax
       because a nine-by-seven sphere averages it away; on a
       five-sided leg it IS the shading.

       So a caller may hand in `shade` - a monotonic function of the
       vertex's own normal - and when it does, the random term is cut
       to a third. Ordering by geometry first, noise second. */
    const shade = opts && opts.shade;
    const jit = shade ? 0.12 : 0.36;
    const nrm = shade ? geo.attributes.normal : null;
    const pos = shade ? geo.attributes.position : null;
    for (let i = 0; i < count; i += 1) {
      let t = lit * (1 - jit * 0.5 + src() * jit);
      if (shade) {
        t *= shade(
          pos.getX(i), pos.getY(i), pos.getZ(i),
          nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      }
      colour[i * 4] = lerp(from[0], to[0], t);
      colour[i * 4 + 1] = lerp(from[1], to[1], t);
      colour[i * 4 + 2] = lerp(from[2], to[2], t);
      colour[i * 4 + 3] = glow;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    return geo;
  }

  /** Minimal merge - same reasoning as abbess.js's. */
  function mergeAll(geos) {
    let verts = 0;
    let idx = 0;
    for (const g of geos) {
      if (!g.attributes.normal) g.computeVertexNormals();
      verts += g.attributes.position.count;
      idx += g.index ? g.index.count : g.attributes.position.count;
    }
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = new Uint32Array(idx);
    let vo = 0;
    let io = 0;
    for (const g of geos) {
      const n = g.attributes.position.count;
      position.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
      normal.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
      colour.set(g.attributes.color.array.subarray(0, n * 4), vo * 4);
      if (g.index) {
        for (let i = 0; i < g.index.count; i += 1) index[io + i] = g.index.getX(i) + vo;
        io += g.index.count;
      } else {
        for (let i = 0; i < n; i += 1) index[io + i] = i + vo;
        io += n;
      }
      vo += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    out.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    return out;
  }

  /* --- the carapace ---------------------------------------------
     A treehopper's pronotum: a single swept crest of shell over the
     whole animal, and the reason it disappears against the rock while
     it is folded. It echoes the needles it lives on deliberately -
     the district's silhouette is spikes, and so is its tenant's. */
  {
    /* THE CREST GOES ON ITS OWN PIVOT, so it can lag. Its geometry is
       authored in body space and then walked back by the pivot's own
       offset, rather than re-derived - a crest re-measured against a
       new origin is a crest that drifts off the thorax the first time
       either number is touched. */
    /* EVERYTHING THAT LIVES ON THE CREST IS BUILT IN THE CONE'S OWN
       FRAME, and this is the fix for the detached plank.

       The rails and the tip blade used to be authored straight into
       body space with hand-written translates, and they missed. The
       rails ran 0.7 units past the crest's point, floating; the blade
       sat a FULL UNIT - 1.7m at the animal's world scale - above the
       apex it was supposed to be capping. That is the "detached plank
       floating mid-frame that belongs to nothing" in the verdict, and
       it is in three of the six framings.

       On a cone the radius at a height is one line of arithmetic, so
       anything that belongs to the crest is placed on the cone's
       surface and then run through the SAME transform the crest
       takes. They cannot drift apart again without the crest drifting
       with them. */
    const CREST_R = 1.9;
    const CREST_H = 5.4;
    const crestAt = (y) => CREST_R * (CREST_H * 0.5 - y) / CREST_H;
    const onCrest = (g) => {
      g.rotateX(-Math.PI * 0.46);
      g.scale(1, 1, 0.55);
      g.translate(0, 1.15 - 0.55, -1.1 + 0.4);
      return g;
    };

    /* AND THE CREST'S SKY-FACING FACET NO LONGER OUT-LIGHTS THE
       THORAX'S.

       It was painted to `SHELL_EDGE` at 0.9 while the thorax under it
       runs to `SHELL_LIT` at 0.65 - so the roof of the crest carried
       roughly twice the albedo of the body it sits on, and two
       surfaces with the same normal under the same sky came back at
       two different values. A critic reads that as "the normals
       disagree with the light", and it is not a lighting bug at all;
       it is a paint bug, which is why nothing in the shader could
       have fixed it.

       `SHELL_EDGE` is a PLATE RIM colour. It belongs on the crest's
       flanks and its leading edge, where a shell actually gets rubbed
       pale, and not on the one facet the sun already owns. The floor
       here is solved rather than eyeballed: 0.80 * 0.44 lands the
       sky-facing facet on the same linear value the thorax reaches at
       0.65 through the shorter ramp. */
    const crestShade = (x, y, z, nx, ny, nz) => clamp(
      0.44 + 0.56 * (1 - clamp01(ny)) + 0.16 * Math.abs(nx), 0.40, 1.20);

    const crest = new THREE.ConeGeometry(CREST_R, CREST_H, 5);
    crestPivot.add(new THREE.Mesh(
      paint(onCrest(crest), 0.80, 0, [SHELL_DARK, SHELL_EDGE], rng,
        { shade: crestShade }), shellMat));

    /* THE ACCENT BAND, and it is a designed pattern rather than
       scattered wear: two rails running the length of the crest and a
       blade at its point. A few per cent of the animal's area, all of
       it warm, all of it on one structure. */
    {
      const rails = [];
      /* Both ends of a rail are taken off the cone's own radius, so
         the pair CONVERGE as the crest tapers instead of running
         parallel off the end of it. `out` slightly over 1 is what
         keeps them proud of the shell rather than inlaid into it. */
      const RAIL_PHI = 0.62;
      for (const side of [-1, 1]) {
        const rim = (y, out) => new THREE.Vector3(
          side * Math.sin(RAIL_PHI), 0, Math.cos(RAIL_PHI))
          .multiplyScalar(crestAt(y) * out).setY(y);
        const a = rim(-1.30, 1.05);
        const b = rim(1.70, 1.10);
        const dir = b.clone().sub(a);
        const rail = new THREE.CylinderGeometry(0.115, 0.060, dir.length(), 4);
        rail.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
        rail.translate((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        rails.push(paint(onCrest(rail), 0.95, 0, [BRASS_DARK, BRASS_LIT]));
      }
      /* The blade is SOCKETED: its base sits at a height where the
         crest is still 0.23 wide and it is built wider than that, so
         the join is inside solid shell. */
      const blade = new THREE.ConeGeometry(crestAt(2.05) * 1.5, 2.2, 5);
      blade.translate(0, 2.05 + 1.1, 0);
      rails.push(paint(onCrest(blade), 1, 0, [BRASS_DARK, BRASS_LIT]));
      crestPivot.add(new THREE.Mesh(mergeAll(rails), plateMat));
    }

    const parts = [];
    // The thorax under it.
    const thorax = new THREE.SphereGeometry(1.55, 9, 7);
    thorax.scale(1.05, 0.86, 1.35);
    parts.push(paint(thorax, 0.65));
    // Head, low and forward, with two lit eyes.
    const skull = new THREE.SphereGeometry(0.82, 8, 6);
    skull.scale(1, 0.8, 1.15);
    skull.translate(0, -0.18, 1.75);
    parts.push(paint(skull, 0.8));
    for (const side of [-1, 1]) {
      /* Ramped violet-to-hot rather than flat: a lens is bright in the
         middle and not at its rim, and a uniformly-lit disc is the
         "evenly spaced pink dots" read the seams already had to be
         cured of. It also carries the animal's second blown highlight
         - the metric harness measured EXACTLY ZERO blown pixels in
         five photographs of the first pass, and a creature with no
         clipped pixel anywhere on it has no wet, no polish and no
         heat. */
      const eye = new THREE.SphereGeometry(0.3, 6, 5);
      eye.scale(1, 0.75, 1.3);
      eye.translate(side * 0.5, 0.06, 2.25);
      parts.push(paint(eye, 1, 1, [GLOW_VIOLET, BELLY_HOT]));
    }
    /* PLATE BREAKS on the thorax flanks. Not decoration: the metric
       harness reports edge density and micro-detail, and a smooth
       ellipsoid contributes neither at any distance. Three overlapping
       shell laps per side put real silhouette-scale steps into the
       body, which is what a Hunter's plate stack does and what an
       untextured sphere cannot fake in the shader. */
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const lap = new THREE.CylinderGeometry(1.28 - i * 0.10, 1.16 - i * 0.10, 0.20, 7, 1, true);
        lap.rotateZ(Math.PI * 0.5);
        lap.scale(1, 0.86, 1.02);
        lap.rotateY(side * 0.12);
        lap.translate(side * (0.42 + i * 0.30), -0.06 - i * 0.05, 0.30 - i * 0.78);
        parts.push(paint(lap, 0.42 + i * 0.14, 0, [SHELL_DARK, SHELL_EDGE]));
      }
    }
    /* The thoracic collar: the accent's second and last appearance -
       AND THE FLOATING BROWN LOZENGE IN THE VERDICT.

       It was a HORIZONTAL ring (rotated into the XZ plane) of radius
       1.29 by 1.10, dropped at z 0.95 inside a thorax whose section
       there is 1.63 by 2.09. Which means it was buried everywhere
       except two short arcs around 40 degrees off the midline, where
       the ring grazes the shell from underneath and 0.13 of bronze
       tube pokes through. Two brown slivers with no visible structure
       joining them, sitting just under the head - read, correctly, as
       a mandible that is not attached to anything.

       A collar is a ring around a NECK, so it stands in the XY plane
       now, and it is sized off the thorax's own section at the z it
       sits at rather than off a number: the section there is a
       1.408 x 1.153 ellipse, and 1.03 of that puts the tube's inner
       edge just inside the shell and its outer edge proud, all the
       way round. A band, not two lozenges. */
    {
      const NECK_Z = 1.05;
      const k = Math.sqrt(1 - (NECK_Z / (1.55 * 1.35)) ** 2);
      const collar = new THREE.TorusGeometry(1, 0.10, 4, 13);
      collar.scale(1.55 * 1.05 * k * 1.03, 1.55 * 0.86 * k * 1.03, 1);
      collar.translate(0, 0, NECK_Z);
      body.add(new THREE.Mesh(paint(collar, 0.9, 0, [BRASS_DARK, BRASS_LIT]), plateMat));
    }
    body.add(new THREE.Mesh(mergeAll(parts), shellMat));

    /* THE ANTENNAE. Two whips off the head, and they exist for two
       reasons at once: they are the cheapest possible secondary
       motion, and they put thin high-contrast lines across an
       otherwise closed silhouette. */
    /* AND THEY ARE A CHAIN NOW, WHICH THEY WERE NOT.

       The two segments of each whip were placed by absolute
       translate, in a frame nobody re-derived after either angle was
       touched, and they missed each other by 0.83 units - 1.4m out
       here. So the outer half of every antenna was a plank hanging in
       the sky with nothing joining it to the animal. Look at
       `06-silhouette.png` from the first round: four detached slivers
       off the top of the shape, and a critic reading a silhouette
       reads them before it reads the boss.

       Each link now starts where the previous one ENDED. The running
       tip is the only place a position comes from, the angles are
       deltas, and the last link is a cone so the whip comes to a
       point instead of stopping at a flat cap in mid-air. */
    {
      const whips = [];
      for (const side of [-1, 1]) {
        let px = side * 0.40;
        let py = 0.16;
        let pz = 0.34;
        let az = side * 0.55;
        let ax = -0.34;
        // length, base radius, tip radius (0 = comes to a point), dAz, dAx
        const LINKS = [
          [1.30, 0.085, 0.055, 0, 0],
          [1.15, 0.055, 0.030, side * 0.30, -0.42],
          [0.85, 0.030, 0, side * 0.26, -0.40],
        ];
        /* The scape - a bead sunk into the head where the whip leaves
           it, so the antenna is socketed rather than stuck on. */
        const scape = new THREE.IcosahedronGeometry(0.115, 0);
        scape.translate(px, py, pz);
        whips.push(paint(scape, 0.5, 0, [SHELL_DARK, SHELL_EDGE]));
        for (let s = 0; s < LINKS.length; s += 1) {
          const [len, r0, r1, dz, dx] = LINKS[s];
          az += dz;
          ax += dx;
          // Reaches back into its own parent, same rule as the legs.
          const back = r0 * 1.6;
          const g = r1 > 0
            ? new THREE.CylinderGeometry(r1, r0, len + back, 5)
            : new THREE.ConeGeometry(r0, len + back, 5);
          g.translate(0, (len - back) * 0.5, 0);
          g.rotateZ(az);
          g.rotateX(ax);
          g.translate(px, py, pz);
          whips.push(paint(g, 0.55 - s * 0.05, 0, [SHELL_DARK, SHELL_EDGE]));
          const c = Math.cos(az);
          px += -Math.sin(az) * len;
          py += c * Math.cos(ax) * len;
          pz += c * Math.sin(ax) * len;
        }
      }
      antPivot.add(new THREE.Mesh(mergeAll(whips), shellMat));
    }

    /* The seams themselves, and they go on the BELLY.

       The first pass put them along the crest, which is where a
       treehopper's markings would actually be and which photographed
       as nothing at all: the crest is a metre and a half of shell
       arching over them, and the one direction it hides them from is
       DOWN. That is the only direction this fight is ever watched
       from. The player is underneath the animal for the entire
       encounter - that is the premise - so the ventral plates are the
       only surface with a guaranteed line to the camera, and a bug
       that lights its underside is a firefly rather than an
       inconsistency. It also keeps the reveal: seen from across the
       flats on the approach, before it wakes, there is still nothing
       on that spire but rock. */
    const seams = [];
    for (let i = 0; i < 4; i += 1) {
      const t = i / 3;
      const z = lerp(1.05, -1.95, t);
      const w = lerp(0.62, 1.35, Math.sin(t * Math.PI) * 0.7 + 0.3);
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.2, 0.17, w);
        g.rotateX(0.12);
        g.translate(side * lerp(0.5, 0.92, t), lerp(-1.02, -0.72, t), z);
        /* Alpha 0.35 rather than 1: the vertex alpha is the bio
           EMISSION mask and it is now a hierarchy, not a switch. A
           hairline seam glowing as hard as the sac it runs away from
           is why the first pass photographed as evenly-spaced pink
           dots - a repeating pattern with no focus in it. */
        seams.push(paint(g, 1, 0.35, [GLOW_VIOLET, GLOW_VIOLET]));
      }
    }
    // A keel down the midline, and a throat pip under the head.
    const keel = new THREE.BoxGeometry(0.26, 0.2, 3.3);
    keel.translate(0, -1.12, -0.45);
    seams.push(paint(keel, 1, 0.42, [GLOW_VIOLET, GLOW_VIOLET]));
    const throat = new THREE.SphereGeometry(0.34, 7, 5);
    throat.scale(1.25, 0.7, 1);
    throat.translate(0, -0.72, 1.62);
    seams.push(paint(throat, 1, 0.5, [GLOW_VIOLET, GLOW_VIOLET]));

    /* THE VENTRAL SAC - hot-bellied, and the animal's focal element.

       The art direction asks for one saturated spot per boss, and for
       this one it asks specifically for a belly that lights the crown
       it grips. It cannot be a LIGHT: a light entering the scene for
       the first time recompiles every material in it, and this one
       would enter on the frame the boss wakes. So it is an emitter
       painted past the bloom chain's bright threshold instead, sat on
       the one surface the player is guaranteed to be underneath.

       This was suspected once of being the pink ball on the animal's
       rear and it is not - it rides `seamGlow`, which does not draw at
       all unless the shell is `cracked`, so on a perched Stylite it is
       not on screen. Check the gate before blaming an emissive. */
    const sac = new THREE.SphereGeometry(0.62, 9, 7);
    sac.scale(1.45, 0.62, 1.95);
    sac.translate(0, -0.96, -0.35);
    seams.push(paint(sac, 1, 0.92, [GLOW_VIOLET, BELLY_HOT]));
    seamGlow = new THREE.Mesh(mergeAll(seams), seamMat);
    seamGlow.name = "sf-stylite-seams";
    body.add(seamGlow);
  }

  /* --- the maw ----------------------------------------------------
     IT SPITS. It used to have a spinneret: a two-and-a-half-metre
     glowing cone slung under the abdomen, pointing down, with a lit
     bulb on the end of it. Removed on a direct art call - it read, in
     one word, as a pink thing stuck to the animal's backside, and it
     is the third emissive on this model to be removed for exactly
     that reason. The other two are recorded where they used to be
     (the ventral sac, and the knee pip on the hind spring): a bright
     smooth blob hung off the REAR of a creature that is fought from
     directly underneath will be read as an arse every single time, no
     matter how the anatomy is justified.

     Two things were wrong with it beyond the read.

       1. IT WAS NOT GATED. Everything else emissive on this animal
          rides `seamGlow`, which is dark until the crust cracks - so
          the one part of a "camouflaged" boss that glowed while it
          slept was the barrel, and it hung below the rock the crust
          could cover.
       2. IT WAS A SECOND FOCAL POINT. The art direction allows this
          animal ONE saturated spot and the belly already has it.

     So the volley comes out of the head now, which is where an animal
     that spits keeps its mouth. The whole assembly hangs off the
     SKULL'S OWN CENTRE rather than off the aperture, so pitching it
     to track the ground is a head nodding on its neck and the bore
     stays seated in the shell at every angle - a pivot at the lip
     would swing the socket out of the face the first time it aimed.

     Nothing here is a cone stuck onto the silhouette: the bore is
     sunk INTO the skull and the light is recessed inside it, which is
     the fix the old muzzle's own note asked for and never got. */
  const maw = new THREE.Group();
  maw.name = "sf-stylite-maw";
  maw.position.set(0, -0.18, 1.75);
  body.add(maw);
  /* The port is a NODE and not a number, so a harness asking "where do
     the bolts actually come from" gets the answer the game uses rather
     than a second copy of it that can drift. */
  const mawPort = new THREE.Object3D();
  mawPort.name = "sf-stylite-maw-port";
  maw.add(mawPort);
  {
    /* The aperture, in the maw's frame, and the angle the bore points
       below the head's axis. The skull is a 0.82 sphere scaled
       (1, 0.8, 1.15), so its lower-front surface passes through
       roughly y -0.24 z 0.77 - the lip sits just proud of that and
       everything behind it is inside the head. */
    const PITCH = 0.36;
    const LIP_Z = 0.77;
    const LIP_Y = -0.24;
    /* Author along +z - out of the mouth - then tip and seat in one
       place, so no part of this can drift away from the others the
       way the crest's rails once did. */
    const onMaw = (g) => {
      g.rotateX(PITCH);
      g.translate(0, LIP_Y, LIP_Z);
      return g;
    };
    /* THE BORE AND THE JAWS, as ONE mesh - the same rule the legs
       follow, and it is why replacing a three-mesh spinneret with a
       four-piece mouth costs no draw calls. Nothing in here moves
       relative to anything else in here; only the maw's own node
       moves, and that is free.

       THE BORE is open-ended and runs BACK into the skull, on the
       shell's own material - which is DoubleSide, so what the player
       sees down the hole is the inside of the animal rather than a
       hole in the mesh. Painted near-black: the depth is the whole
       reason the light inside it reads as a throat and not as a
       sticker.

       THE JAWS are two mandibles hinged outboard of the lip and
       closing across it, and they are what makes this a MOUTH rather
       than a port - a hole in a face is a hole; a hole with jaws on it
       is a maw. They also break the head's silhouette, which was a
       smooth ellipsoid contributing nothing to the edge-density
       measure the harness reports. */
    const hard = [];
    const bore = new THREE.CylinderGeometry(0.30, 0.15, 0.72, 7, 1, true);
    bore.rotateX(Math.PI * 0.5);
    bore.translate(0, 0, -0.30);
    hard.push(paint(onMaw(bore), 0.16, 0, [SHELL_DARK, SHELL_EDGE]));
    for (const side of [-1, 1]) {
      const jaw = new THREE.ConeGeometry(0.115, 0.66, 5);
      // Apex forward, then swung in and down across the aperture.
      jaw.rotateX(Math.PI * 0.5);
      jaw.translate(0, 0, 0.20);
      jaw.rotateY(-side * 0.62);
      jaw.rotateZ(side * 0.20);
      jaw.translate(side * 0.34, -0.05, 0.06);
      hard.push(paint(onMaw(jaw), 0.72, 0, [SHELL_DARK, SHELL_EDGE]));
    }
    maw.add(new THREE.Mesh(mergeAll(hard), shellMat));
    /* THE LIP. Bronze, and it inherits the slot the spinneret's shroud
       gave up - the accent still appears exactly three times on this
       animal (crest rails, thoracic collar, and here), which is what
       keeps "a lot of neutral, a little warm" true by area. It also
       gives the mouth a hard bright edge, which is the only part of
       this that survives ninety metres. */
    const lip = new THREE.TorusGeometry(0.30, 0.075, 4, 9);
    maw.add(new THREE.Mesh(paint(onMaw(lip), 0.9, 0, [BRASS_DARK, BRASS_LIT]), plateMat));
    /* THE APERTURE, and it is RECESSED - the lit face sits back down
       the bore, so at any angle off the axis the lip occludes part of
       it and the light reads as coming from INSIDE the animal. That is
       the difference between this and the thing it replaces, which was
       a bulb on a stick.

       On `seamMat`, so it is gated with every other emissive on the
       model: dark while it is rock, up with the rouse, and it swells
       on the wind-up (see `poseBody`) so the charge is legible at the
       exact moment the bolt is about to leave.

       AND IT IS PLACED ON THE NODE, not baked into the geometry the
       way its neighbours are - which is the one exception in this
       block and it is load-bearing. `poseBody` scales this mesh, and
       scale is applied about the object's ORIGIN: with the offset
       baked in, the origin is the skull's centre and a 1.35 swell
       does not fatten the throat, it TRANSLATES it half a metre
       forward and out through the lip. Measured, on the first pass -
       the charge tell put the glowing funnel outside the mouth, which
       is the pink-thing-stuck-on read arriving through the back door.

       So the mesh origin is the funnel's own APEX, deep in the bore,
       and the swell is mostly along z: the lit face travels UP the
       bore toward the player as the volley loads and barely widens,
       which is what keeps it inside a socket that narrows behind it. */
    const gullet = new THREE.ConeGeometry(0.19, 0.40, 7);
    gullet.rotateX(-Math.PI * 0.5);
    gullet.translate(0, 0, 0.20);
    mawGlow = new THREE.Mesh(paint(gullet, 1, 0.85, [GLOW_VIOLET, BELLY_HOT]), seamMat);
    mawGlow.name = "sf-stylite-maw-glow";
    mawGlow.rotation.x = PITCH;
    mawGlow.position.set(0,
      LIP_Y + Math.sin(PITCH) * 0.56,
      LIP_Z - Math.cos(PITCH) * 0.56);
    maw.add(mawGlow);
    /* Where the bolt is actually born: on the axis, at the lip. */
    mawPort.position.set(0,
      LIP_Y - Math.sin(PITCH) * 0.06,
      LIP_Z + Math.cos(PITCH) * 0.06);
  }

  /* --- the legs --------------------------------------------------
     Two hind springs and four graspers, each a chain of nested groups
     so a pose is three numbers rather than a mesh rewrite.

     FOUR THINGS WERE WRONG WITH THE FIRST VERSION, and a critic shown
     the frames blind named all four before it named anything else.
     They are the same mistake four times: a limb built as three
     unrelated extrusions that happen to be near each other.

     1. NO END GEOMETRY. `CylinderGeometry` is capped, so every leg on
        this animal finished in a flat n-gon facet hanging in mid-air.
        A flat-cut stump is the clearest "unfinished" signal a model
        can give and there were six of them. The tarsus now tapers to
        a point and carries a CLAW - a hook and an opposed dewclaw -
        so no limb here terminates in a plane.

     2. NO JOINT. The femur ended exactly where the tibia began, so
        the instant a knee bent it opened a wedge you could see
        through - and with `shellMat` on DoubleSide what you saw
        through it was the LIT INSIDE of the tube, which is the
        "inner face reads lighter than its outer face" verdict
        arriving by a route nobody would guess from the sentence.
        Two fixes on purpose, because one of them failing quietly is
        how this shipped: every segment reaches BACK past its own
        pivot into its parent, AND every pivot carries a condyle whose
        inradius is wider than the tube it caps. The joint cannot
        open.

     3. NO CROSS-SECTION. Five and six sides mean opposite facets are
        PARALLEL, and two parallel faces lit from opposite sides is a
        plank, not a leg. Seven has no parallel pair at all, for two
        triangles a segment.

     4. NO SELF-OCCLUSION. See `paint`: the albedo jitter was
        unordered, so which facet came out brightest was a coin flip.
        The legs now ramp dark toward the body and light away from it,
        which is both the occlusion the art direction asks for and a
        guarantee the impossible reading cannot recur.
     ------------------------------------------------------------- */
  /* Odd on purpose - see (3). */
  const LIMB_SIDES = 7;
  /* How far past its own pivot a segment reaches, as a fraction of
     the radius there. Sized for the deepest fold in the pose table:
     the coil takes a knee past 2.7 rad. */
  const JOINT_OVER = 0.75;
  /* An icosahedron's faces sit at 0.7947 of its circumradius, so a
     condyle only swallows a tube of radius r if it is built at
     r/0.7947. Under that and the joint is decorated, not closed. */
  const CONDYLE = 1.30;

  function limb(spec) {
    const hip = new THREE.Group();
    hip.position.set(spec.x, spec.y, spec.z);
    const knee = new THREE.Group();
    knee.position.set(0, -spec.femur, 0);
    const foot = new THREE.Group();
    foot.position.set(0, -spec.tibia, 0);
    hip.add(knee);
    knee.add(foot);

    /* THE OCCLUSION RAMP. `nx * side` is +1 on the facet pointing
       away from the animal and -1 on the one tucked against its own
       body, which is the thing shadowing that face. Monotonic by
       construction, which is the entire point - the noise on top is
       now too small to reorder two facets. */
    const shade = (x, y, z, nx, ny, nz) => {
      const outward = clamp(nx * spec.side, -1, 1);
      /* A little fore-aft on top, so a leg in profile shows three
         values rather than two. */
      const fore = clamp(nz, -1, 1) * 0.07;
      return clamp(0.60 + 0.40 * (0.5 + 0.5 * outward) + fore, 0.40, 1.06);
    };
    const opts = { shade };

    /* A segment, reaching `back` past its own pivot. The top radius is
       extrapolated up the taper rather than reused, or the overlap
       leaves a visible step where the segment enters its socket. */
    const seg = (len, r0, r1, lit) => {
      const back = r0 * JOINT_OVER;
      const rTop = r0 + (r0 - r1) * (back / len);
      const g = new THREE.CylinderGeometry(rTop, r1, len + back, LIMB_SIDES);
      g.translate(0, (back - len) * 0.5, 0);
      return paint(g, lit, 0, spec.ramp, rng, opts);
    };
    const condyle = (r, lit) => {
      const g = new THREE.IcosahedronGeometry(r * CONDYLE, 0);
      /* Squashed across the hinge axis: a knuckle is wider than it is
         long, and a perfect ball at every joint reads as a doll. */
      g.scale(0.92, 1, 1.06);
      return paint(g, lit, 0, spec.ramp, rng, opts);
    };

    const rKnee = spec.thick * 0.72;
    const rAnkle = spec.thick * 0.40;
    const rTip = spec.thick * 0.13;

    /* One mesh per rigid group, so closing the joints costs no draw
       calls: the condyle and the bone it caps never move relative to
       each other. Three meshes a leg, which is what it was before. */
    hip.add(new THREE.Mesh(mergeAll([
      condyle(spec.thick, 0.5),
      seg(spec.femur, spec.thick, rKnee, 0.6),
    ]), shellMat));
    knee.add(new THREE.Mesh(mergeAll([
      condyle(rKnee, 0.42),
      seg(spec.tibia, rKnee, rAnkle, 0.5),
    ]), shellMat));

    /* THE FOOT. Everything in it is authored in the foot group's own
       frame with the tarsus angle BAKED, so tarsus, claw and dewclaw
       are one rigid merged solid that cannot come apart from each
       other however the ankle is driven. The old tarsus was a
       separate mesh rotated about its own end cap, which is exactly
       how a slab ends up "visibly disjoint from the tibia with a gap
       you can see through". */
    {
      const parts = [condyle(rAnkle, 0.6)];
      const tar = seg(spec.tarsus, rAnkle, rTip, 0.85);
      tar.rotateX(TARSUS_ANGLE);
      parts.push(tar);
      /* THE CLAW. The grip is this boss's whole mechanic and it was
         being held on by a flat rectangle. A hook and a shorter
         opposed dewclaw, both coming to a point, both sunk back into
         the tarsus so the join between them is inside the solid. */
      const clawLen = spec.tarsus * CLAW_FRAC;
      const over = spec.tarsus * CLAW_SEAT;
      const hook = (len, r, ang, lit) => {
        const g = new THREE.ConeGeometry(r, len, 5);
        // Apex down: the cone ships apex-up and a claw is not a spike.
        g.rotateX(Math.PI);
        g.translate(0, over - len * 0.5, 0);
        g.rotateX(ang);
        g.translate(0, -spec.tarsus, 0);
        g.rotateX(TARSUS_ANGLE);
        return paint(g, lit, 0, spec.ramp, rng, opts);
      };
      parts.push(hook(clawLen, rTip * 1.7, CLAW_HOOK, 0.95));
      parts.push(hook(clawLen * 0.55, rTip * 1.25, -CLAW_HOOK * 1.5, 0.7));
      foot.add(new THREE.Mesh(mergeAll(parts), shellMat));
    }

    /* A lit collar at the knee of each hind spring. This is the coil
       tell: two points of light that fold up against the body and then
       snap apart, which survives the ninety metres that the shape of a
       bent leg does not.

       It sits OUTBOARD of the condyle now. It used to be the only
       thing at that joint, built at 0.62 of the femur's radius across
       a socket of 0.72 - too small to close the gap it was standing
       in - so at range it read as a glowing flat cap on the end of a
       cut-off leg, which is half of what the critic was pointing at.
       It is a lens on the outside of a knuckle now, which is what it
       was always meant to be. */
    /* REMOVED ON A DIRECT ART CALL - it read as a pink ball stuck on
       the animal's rear, and it is the one the eye actually lands on.

       Two things made it the offender rather than the ventral sac or
       the abdominal spinneret - which was itself removed later, for
       the same reason - and both are worth writing down because this
       cost two wrong edits to find:

       1. IT IS NOT GATED. `seamGlow` - which carries the sac, the
          keel, the throat and the shell seams - is switched off
          whenever the animal is not `cracked`, so on a perched,
          camouflaged Stylite none of it draws. This pip was added
          straight to the knee node with no gate, so it was the only
          emissive on the model in exactly the pose the boss spends
          most of the fight in.
       2. IT IS ON THE HIND SPRING. Those are deliberately out of
          proportion - thicker than the thorax - and they fold up
          under the abdomen, so their knees sit low and BEHIND the
          body. A bright sphere there is, from the side, a bright
          sphere on the creature's backside.

       What it was for was the coil tell: two points of light that
       fold together and snap apart, readable at ninety metres where
       the shape of a bent leg is not. That job is real and is now
       unowned. If it comes back it must be part of the leg's own
       shell - the springs lit through COLOR_0's alpha so the KNUCKLE
       glows with the leg's faceted silhouette - and not a smooth
       sphere parked outboard of the joint. */
    body.add(hip);
    return { hip, knee, foot, spec };
  }

  /* THE SPRINGS. Deliberately out of proportion - a jumping insect's
     hind femora are thicker than its whole thorax, and understating
     that makes the leap arrive from nowhere. */
  const springs = [-1, 1].map((side) => limb({
    ...SPRING_SPEC, x: side * 1.15, y: -0.35, z: -0.95, side,
  }));
  /* The graspers. Small, and they are what the grip pool represents:
     break these and nothing is holding the animal on. */
  const graspers = [];
  for (const hipAt of GRASPER_HIPS) {
    for (const side of [-1, 1]) {
      graspers.push(limb({
        ...GRASPER_SPEC,
        x: side * hipAt.x, y: hipAt.y, z: hipAt.z,
        side, index: hipAt.index, kneeGrip: hipAt.kneeGrip,
      }));
    }
  }

  /* ============================================================
     THE CRUST

     The camouflage, as a physical object rather than as a colour.

     Eleven shards of the needle's own rock, welded over the carapace
     while it sleeps and shed as real debris over a second when it
     wakes. Two things fall out of doing it this way that a repaint
     cannot buy:

       - the DORMANT read and the ROUSED read stop fighting. The
         animal underneath is free to be the darkest, wettest, hottest
         thing in the district, because nobody sees it until the rock
         is off. A painted camouflage has to be both at once and ends
         up being neither.

       - the reveal has WEIGHT. Sheets of stone lifting, tumbling and
         falling past the camera is a physical event with a duration;
         plates opening on a hinge is a pose change.

     They are separate meshes rather than one merged shell with a
     per-vertex shard index, and that is a deliberate eleven draw
     calls: they only exist while `crust.visible`, which is true for
     the one second of the rouse and never again until the encounter
     resets. A merged version would have to carry its own vertex
     stream and a shed solved in the vertex shader to save draws that
     are not being spent.
     ============================================================ */
  const crust = new THREE.Group();
  crust.name = "sf-stylite-crust";
  body.add(crust);
  const shards = [];
  let shedClock = 0;
  {
    /* ITS OWN GENERATOR, and that is not tidiness.

       `rng` is the encounter's stream: `pickPerch`, the bolt spread
       and how long it holds a crown all draw from it in order. Eleven
       shards jittering their own geometry out of that stream shifts
       every draw after them, so adding a decorative crust silently
       re-seeded which needle the boss stands on - and the gallery,
       which frames off wherever the animal actually is, came back with
       a different photograph of a different spire and no way to tell
       the surface change from the reshuffle. */
    const crng = makeRng(0x57c2);
    /* x, y, z, radius, length, and the OUTWARD bearing it peels along.
       Ordered roughly head-to-tail because `t0` is derived from the
       index: the crack runs down the animal rather than the shell
       coming off everywhere at once. */
    const SHARDS = [
      [0, 0.35, 2.00, 0.92, 1.8, 0, 0.30, 1],
      [-1.30, 0.62, 0.55, 1.15, 2.2, -1, 0.35, 0.2],
      [1.30, 0.62, 0.55, 1.15, 2.2, 1, 0.35, 0.2],
      [0, 2.05, -1.30, 1.40, 3.0, 0, 1, -0.15],
      [0, 1.35, 0.35, 1.15, 2.3, 0, 1, 0.45],
      [-1.55, -0.20, -1.30, 1.25, 2.4, -1, 0.10, -0.25],
      [1.55, -0.20, -1.30, 1.25, 2.4, 1, 0.10, -0.25],
      [0, 1.15, -3.10, 1.05, 2.7, 0, 0.55, -1],
      [-1.45, -0.85, -1.95, 1.05, 2.0, -0.85, -0.45, -0.3],
      [1.45, -0.85, -1.95, 1.05, 2.0, 0.85, -0.45, -0.3],
      /* The lower flanks, the rear and the throat. Added after the
         first dormant photograph, which came back as a convincing
         spiky boulder with the animal's whole right side and both
         hind springs standing out from under it in bare black. A
         crust has to CLOSE, or it is a hat. */
      [-1.25, -1.05, 0.20, 1.00, 1.9, -0.85, -0.55, 0.2],
      [1.25, -1.05, 0.20, 1.00, 1.9, 0.85, -0.55, 0.2],
      [0, 0.30, -2.55, 1.10, 2.2, 0, 0.25, -1],
      [0, -0.55, 1.55, 0.85, 1.7, 0, -0.75, 0.6],
      /* The belly plate, and it goes LAST. It is the shard covering
         the ventral sac, so the animal's one blown-out focal element
         is the last thing the reveal hands over - which is the whole
         shape of the shot. */
      [0, -1.30, -0.55, 1.30, 2.2, 0, -1, 0.1],
    ];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < SHARDS.length; i += 1) {
      const [x, y, z, r, len, nx, ny, nz] = SHARDS[i];
      /* Five sides and a hard taper: the district's silhouette is
         spikes and so is its tenant's while it is wearing the
         district. Squashed on one axis so no two shards read as the
         same cone. */
      const g = new THREE.ConeGeometry(r, len, 5, 1);
      g.rotateY(crng() * TAU);
      g.scale(1 + crng() * 0.35, 1, 0.62 + crng() * 0.4);
      g.translate(0, len * 0.18, 0);
      const mesh = new THREE.Mesh(
        paint(g, 0.55 + crng() * 0.45, 0, [ROCK_DARK, ROCK_LIT], crng), crustMat);
      const dir = new THREE.Vector3(nx, ny, nz).normalize();
      mesh.quaternion.setFromUnitVectors(up, dir);
      mesh.position.set(x, y, z);
      crust.add(mesh);
      shards.push({
        mesh,
        seat: new THREE.Vector3(x, y, z),
        seatQ: mesh.quaternion.clone(),
        dir,
        spin: new THREE.Vector3(
          (crng() - 0.5) * 7, (crng() - 0.5) * 5, (crng() - 0.5) * 7),
        /* Staggered across the first 60% of the shed window, so the
           last shard is still in the air when the first has landed. */
        t0: 0.06 + (i / (SHARDS.length - 1)) * 0.54,
        popped: false,
      });
    }
  }
  const _shardQ = new THREE.Quaternion();
  const _shardE = new THREE.Euler();

  /**
   * Drive the shed. `shed` is 0 at the first frame of the rouse and 1
   * when the last shard has gone.
   *
   * Costs nothing once it is over: `state.crustGone` latches, the
   * group hides itself, and this function returns on its first line
   * for the rest of the encounter. Same discipline as the pose gate -
   * a dormant boss's idle work is what cost this game 1.3ms a frame
   * the last time it was allowed to run unconditionally.
   */
  function poseCrust(dt, shed, wake) {
    if (state.crustGone) return;
    if (shed >= 1) {
      state.crustGone = true;
      crust.visible = false;
      /* Parked back on the seat as it hides. `traverseVisible` skips
         a hidden group, but a shard left eleven metres below the
         animal is a hazard for any consumer that walks the whole
         tree - and the gallery frames off the subject's real vertex
         extent, so a stray one would pull the lens back on every
         photograph taken after the reveal. */
      for (const s of shards) {
        s.mesh.position.copy(s.seat);
        s.mesh.quaternion.copy(s.seatQ);
      }
      return;
    }
    crust.visible = true;
    /* THE SHELL IS OVERSIZED WHILE THE ANIMAL IS FOLDED, and shrinks
       onto it as the animal opens out. A crust sized to the roused
       silhouette leaves gaps over a tucked one - the second dormant
       photograph still had a bare flank and both hind springs showing
       through - and growing it by a third at wake 0 closes them
       without another four shards to draw. It is also what a shell
       being pushed off from the inside would do. */
    crust.scale.setScalar(lerp(1.32, 1.0, clamp01(wake)));
    shedClock += dt;
    /* THE TREMBLE, before anything moves off. An ambusher that bursts
       out of its shell with no warning at all is a jump scare; one
       that shivers first, for a third of a second, is an animal
       waking up inside a rock. Wound down as the shards start going,
       because a shell that is coming apart does not also need to
       buzz. */
    const shiver = smoothstep(shed / 0.12) * (1 - smoothstep((shed - 0.22) / 0.4));
    for (let i = 0; i < shards.length; i += 1) {
      const s = shards[i];
      const u = clamp01((shed - s.t0) / 0.30);
      if (u <= 0) {
        const w = shiver * 0.05;
        s.mesh.position.set(
          s.seat.x + Math.sin(shedClock * 47 + i * 2.1) * w,
          s.seat.y + Math.sin(shedClock * 39 + i * 1.3) * w,
          s.seat.z + Math.cos(shedClock * 53 + i * 0.7) * w);
        continue;
      }
      if (!s.popped) {
        s.popped = true;
        /* Dust off the break, in WORLD space - the shard is a child of
           a body that is itself scaled and pitched on a spire, so the
           local seat is not a place. */
        s.mesh.getWorldPosition(_scratch);
        ctx.vfx?.spark?.(_scratch.x, _scratch.y, _scratch.z, 0.75, true, false);
      }
      if (u >= 1) { s.mesh.visible = false; continue; }
      /* Peels outward first and falls after: the u-squared on gravity
         against a linear push is what makes a sheet look like it let
         go rather than like it was thrown. */
      s.mesh.position.set(
        s.seat.x + s.dir.x * u * 2.6,
        s.seat.y + s.dir.y * u * 2.6 - u * u * 11,
        s.seat.z + s.dir.z * u * 2.6);
      _shardE.set(s.spin.x * u, s.spin.y * u, s.spin.z * u);
      _shardQ.setFromEuler(_shardE);
      s.mesh.quaternion.copy(s.seatQ).multiply(_shardQ);
    }
  }

  /** Put the shell back on. Only the encounter reset reaches this. */
  function reseatCrust() {
    state.crustGone = false;
    crust.visible = true;
    shedClock = 0;
    for (const s of shards) {
      s.popped = false;
      s.mesh.visible = true;
      s.mesh.position.copy(s.seat);
      s.mesh.quaternion.copy(s.seatQ);
    }
  }

  /* ============================================================
     THE BARRAGE
     ============================================================ */
  const boltGeo = new THREE.IcosahedronGeometry(0.34, 0);
  const bolts = [];
  for (let i = 0; i < C.volleyMax; i += 1) {
    const mesh = new THREE.Mesh(boltGeo, boltMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    bolts.push({ mesh, live: false, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  let boltCursor = 0;

  function fireBolt() {
    const ps = ctx.player.state;
    mawPort.updateWorldMatrix(true, false);
    const o = new THREE.Vector3().setFromMatrixPosition(mawPort.matrixWorld);
    /* Led, and led by the bolt's own travel time rather than a
       constant. From ninety metres up the flight is over a second, and
       a shot aimed at where the player is standing lands behind them
       every time - which reads as the animal being harmless rather
       than as the player dodging. */
    const tx = ps.x + lead.vx * C.volleyLead;
    const tz = ps.z + lead.vz * C.volleyLead;
    const dx = tx - o.x;
    const dy = (ps.y + 1.0) - o.y;
    const dz = tz - o.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const spread = 0.035;
    const b = bolts[boltCursor];
    boltCursor = (boltCursor + 1) % bolts.length;
    b.live = true;
    b.life = 4.5;
    b.x = o.x; b.y = o.y; b.z = o.z;
    b.vx = (dx / d) * C.volleySpeed + (rng() - 0.5) * C.volleySpeed * spread;
    b.vy = (dy / d) * C.volleySpeed + (rng() - 0.5) * C.volleySpeed * spread;
    b.vz = (dz / d) * C.volleySpeed + (rng() - 0.5) * C.volleySpeed * spread;
    b.mesh.position.copy(o);
    b.mesh.visible = true;
    /* Recovery, and it is the cheap half of the anticipation pair:
       the windup rears the head back off the target, the shot spits it
       forward again. Read by `poseBody`. */
    state.recoil = Math.min(1.4, state.recoil + 0.85);
    ctx.vfx?.spark?.(o.x, o.y, o.z, 1.0, false, true);
    bus.emit("shot", { x: o.x, y: o.y, z: o.z });
  }

  function updateBolts(dt) {
    const ps = ctx.player?.state;
    for (const b of bolts) {
      if (!b.live) continue;
      b.life -= dt;
      const px = b.x;
      const py = b.y;
      const pz = b.z;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += dt * 9;
      b.mesh.rotation.y += dt * 7;

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
      if (!hit && b.y <= groundAt(b.x, b.z) + 0.2) {
        hit = { x: b.x, y: groundAt(b.x, b.z), z: b.z, direct: false };
      }
      if (hit) {
        b.live = false;
        b.mesh.visible = false;
        if (hit.direct) {
          ctx.combat?.hurtPlayer?.(C.volleyDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
            source: "stylite-bolt", x: hit.x, y: hit.y, z: hit.z,
          });
          ctx.player?.punch?.(0.6);
        }
        ctx.vfx?.spark?.(hit.x, hit.y, hit.z, hit.direct ? 1.8 : 1.0, !hit.direct, true);
        bus.emit(hit.direct ? "boltHit" : "boltSplash", hit);
        continue;
      }
      if (b.life <= 0) { b.live = false; b.mesh.visible = false; }
    }
  }

  /* Player velocity, for the lead. Measured here because nothing else
     wants it - the same arrangement the Garner's lash uses. */
  const lead = { x: 0, z: 0, vx: 0, vz: 0 };
  let seamClock = 0;

  /* ============================================================
     POSE

     One function, driven by `state`. Every limb angle in the animal
     is a blend of four postures - gripping, coiled, extended and
     sprawled - and which blend is active is the phase.
     ============================================================ */
  /* Tracked so the crest and the antennae can arrive late. A lag
     driven off an angular VELOCITY needs the velocity, and nothing
     else in this module wants it. */
  let prevFacing = 0;

  function poseBody(dt) {
    const wake = clamp01(state.woken);
    const coil = state.coil;
    const dead = state.phase === "dead";
    const sprawl = state.phase === "plummet" || state.phase === "stunned" || dead
      ? 1 : state.phase === "recover" ? 1 - clamp01(1 - state.timer / C.recoverSeconds) : 0;
    const flying = state.phase === "leap" || state.phase === "stoop";
    /* A dead insect draws its legs IN, and that is the single most
       legible "this one has stopped" cue any arthropod gives. Sprawl
       is the stunned pose - splayed, still holding itself up - and
       curl is its opposite. */
    const curl = dead ? clamp01(state.deathT) : 0;

    /* THE SHED. Driven off the rouse's own clock rather than off
       `wake`, because `wake` is damped and a damped ramp cannot hold
       a schedule: eleven shards on staggered starts need a linear
       time base or the last four arrive whenever the exponential gets
       around to them. */
    if (!state.crustGone) {
      const elapsed = state.phase === "rouse"
        ? Math.max(0, C.rouseSeconds - state.timer)
        : (state.phase === "dormant" ? 0 : CRUST_SHED);
      poseCrust(dt, elapsed / CRUST_SHED, wake);
    }

    /* THE FLINCH SPRING. Second order, critically-ish damped: an
       impulse goes in on the hit and the animal overshoots and
       settles rather than fading back. omega about 11 rad/s and zeta
       about 0.73, which is one visible rock and done inside a third
       of a second - long enough to see at ninety metres, short enough
       that a sustained magazine does not turn the boss into a
       pendulum. */
    for (let i = 0; i < 2; i += 1) {
      const h = dt * 0.5;
      state.flinchPV += (-state.flinchP * 120 - state.flinchPV * 16) * h;
      state.flinchP += state.flinchPV * h;
      state.flinchRV += (-state.flinchR * 120 - state.flinchRV * 16) * h;
      state.flinchR += state.flinchRV * h;
    }
    /* The landing absorb, on the same spring but slower and heavier -
       seven metres of animal arriving on a rock crown should sink
       into its own legs and come back up, not stop dead. */
    state.absorbV += (-state.absorb * 46 - state.absorbV * 9.5) * dt;
    state.absorb += state.absorbV * dt;
    state.recoil = damp(state.recoil, 0, 11, dt);
    state.breath += dt;

    body.position.copy(state.pos);
    /* Facing, and the tumble. A falling Stylite is not a creature
       holding a pose - it is a mass with the wrong side down, and the
       roll it accumulates is what makes the landing read as a crash
       rather than as a controlled descent. */
    body.rotation.set(
      state.tumble * 2.4 + state.flinchP,
      state.facing,
      state.tumble * 1.3 + state.flinchR + state.deathRoll
    );
    /* On a perch it clings to the SIDE of the crown, not the top: the
       whole animal pitches nose-down over the drop so its head points
       at the ground it is shooting at. */
    if (!flying && sprawl < 0.5) {
      body.rotation.x += lerp(0, 0.42, wake) * (1 - sprawl);
      /* Breathing. Small, slow, and only while it is holding still:
         an abdomen that pumps is the cheapest possible answer to "is
         this thing alive or is it a prop", and at ninety metres it is
         one of the few reads that survives. */
      body.rotation.x += Math.sin(state.breath * 1.35) * 0.022 * wake;
    }
    /* SCALED UP, and the number is set by the read rather than by
       anatomy. Fought from directly underneath at ninety metres, a
       four-metre bug is a speck: the player cannot see the coil load,
       cannot see the graspers slip as the grip fails, and cannot tell a
       leap from a stoop. At 1.7 it is a seven-metre animal and every
       tell it has survives the distance it is meant to be read at. */
    /* THE LANDING ABSORB, as a squash rather than as a leg angle.
       A crown landing is over in a fifth of a second and the legs are
       damped at 18 - they cannot answer that fast without being
       snapped, and snapping them costs the coil its own read. A
       non-uniform scale can, and squash-and-stretch is the oldest
       weight cue there is: it goes on the SCALE so it survives even
       when the pose behind it is still catching up. */
    const squash = state.absorb;
    body.scale.set(
      lerp(0.55, 1, wake) * BODY_SCALE * (1 + squash * 0.14),
      lerp(0.55, 1, wake) * BODY_SCALE * (1 - squash * 0.22),
      lerp(0.55, 1, wake) * BODY_SCALE * (1 + squash * 0.14));

    /* THE LAG. The crest and the antennae arrive late, driven off how
       fast the body is actually turning rather than off a noise
       function, so the overshoot always points the right way. */
    const yawRate = dt > 1e-5
      ? clamp(((state.facing - prevFacing + Math.PI * 3) % TAU - Math.PI) / dt, -6, 6)
      : 0;
    prevFacing = state.facing;
    crestPivot.rotation.y = damp(crestPivot.rotation.y, -yawRate * 0.055, 9, dt);
    crestPivot.rotation.x = damp(crestPivot.rotation.x,
      -coil * 0.20 + squash * 0.26 + state.flinchP * 0.5
      + Math.sin(state.breath * 1.35 + 0.7) * 0.020 * wake, 11, dt);
    antPivot.rotation.y = damp(antPivot.rotation.y, -yawRate * 0.14, 6, dt);
    antPivot.rotation.x = damp(antPivot.rotation.x,
      -0.24 * coil + squash * 0.5 + Math.sin(state.breath * 2.1) * 0.09 * wake
      + curl * 1.15, 5.5, dt);
    antPivot.rotation.z = damp(antPivot.rotation.z, Math.sin(state.breath * 1.7) * 0.07 * wake,
      5, dt);

    body.updateMatrixWorld(true);

    /* THE SEAMS. Off entirely while it is rock, up with the rouse,
       and then reporting the grip for the rest of the fight.

       `seamSlip` is how far through the grip it is, so a full hold sits at
       a slow violet idle and an empty one is a fast white flicker. The
       pulse is driven off elapsed time rather than a phase timer
       because the fall can be started from any phase, and a tell that
       resets its own beat every time the animal jumps is not a tell.
       While it is down the seams go nearly out - a stunned Stylite in
       its crater should read as SPENT, and the light coming back is
       the honest warning that the melee window is closing. */
    const seamSlip = clamp01(1 - state.grip / Math.max(1, C.gripMax));
    const downed = state.phase === "plummet" || state.phase === "stunned"
      || state.phase === "recover";
    seamClock += dt * lerp(2.1, 9.5, seamSlip * seamSlip);
    const beat = 0.5 + 0.5 * Math.sin(seamClock);
    const lit = wake * (dead ? 0 : downed ? 0.14 : 1)
      * lerp(0.55 + beat * 0.25, 0.75 + beat * 0.85, seamSlip);
    seamMat.emissiveIntensity = lit * 4.6;
    seamMat.emissive.copy(_seamCool).lerp(_seamHot, seamSlip * (0.45 + beat * 0.55));
    /* THE LIGHT ARRIVES THROUGH THE CRACKS, not after them.

       The seam mesh carries the ventral sac, and the sac's emission is
       vertex-alpha `bio` - a constant, not something a per-frame
       intensity can fade in. So the mesh's VISIBILITY is what schedules
       it, and it is scheduled against the shed rather than against
       `wake`: the belly comes on once the first shards are already
       lifting, so the player reads heat coming out of a breaking rock
       rather than a bug switching a lamp on. `crustGone` covers every
       phase that never had a crust to begin with (a restored save, a
       forced phase from QA), which is why the test is the latch and
       not the timer. */
    const cracked = state.crustGone
      || (state.phase === "rouse"
        && Math.max(0, C.rouseSeconds - state.timer) > CRUST_SHED * 0.18);
    if (seamGlow) seamGlow.visible = cracked && lit > 0.01;
    if (mawGlow) mawGlow.visible = cracked && lit > 0.01;

    /* THE SPRINGS. Three angles, and the whole leap lives in them.
       Gripping is a wide low stance; coiled folds the femur up against
       the body and the tibia back under it, which is what a locust
       does and is visually a spring; extended throws both open. */
    const extend = flying ? clamp01(1 - state.flight * 2.2) : 0;
    for (const leg of springs) {
      const side = leg.spec.side;
      /* Held on a crown: a FOLD, not a stand. See SPRING_GRIP - this
         used to reach 8.5 units almost straight down off an animal
         clinging to a rock face beside it, which put both hind tarsi
         in open air ninety metres above the sand. */
      const gripPose = SPRING_GRIP;
      const coilPose = { hip: -1.55, knee: 2.55, foot: -1.05 };
      const outPose = { hip: 0.75, knee: 0.18, foot: 0.35 };
      const sprawlPose = { hip: -1.15, knee: 0.55, foot: 0.15 };
      /* Dead: drawn IN and over the body. An arthropod's flexors win
         when the extensors stop being driven, which is why every dead
         insect anyone has ever swept off a windowsill is curled. */
      const curlPose = { hip: -1.85, knee: 2.75, foot: -1.35 };
      /* THE DORMANT TUCK, and it is what makes the crust work.

         The shell is a lump of rock welded over the carapace; it
         cannot cover legs that are standing out at their full span,
         and the first photograph of a dormant Stylite was a
         convincing spiky boulder with two pure-black springs hanging
         out from under it. Folded, the whole animal fits inside its
         own camouflage - and it also means the first thing the rouse
         does is UNFOLD, which is the read the phase is named for. */
      const tuck = 1 - clamp01(wake / 0.42);
      const fold = Math.max(coil, tuck);
      const t = Math.max(fold, extend);
      const base = {
        hip: lerp(gripPose.hip, fold >= extend ? coilPose.hip : outPose.hip, t),
        knee: lerp(gripPose.knee, fold >= extend ? coilPose.knee : outPose.knee, t),
        foot: lerp(gripPose.foot, fold >= extend ? coilPose.foot : outPose.foot, t),
      };
      /* The absorb reaches the legs too, a beat behind the scale: the
         squash is what the eye catches and the knee folding under it
         is what makes the squash look earned. */
      leg.hip.rotation.x = damp(leg.hip.rotation.x,
        lerp(lerp(base.hip, sprawlPose.hip, sprawl), curlPose.hip, curl)
        - squash * 0.30 * (1 - curl), 18, dt);
      leg.hip.rotation.z = damp(leg.hip.rotation.z,
        side * lerp(SPRING_GRIP.hipZ, 0.16, t) + side * sprawl * 0.55 * (1 - curl)
        - side * curl * 0.30, 14, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x,
        lerp(lerp(base.knee, sprawlPose.knee, sprawl), curlPose.knee, curl)
        + squash * 0.55 * (1 - curl), 18, dt);
      leg.foot.rotation.x = damp(leg.foot.rotation.x,
        lerp(lerp(base.foot, sprawlPose.foot, sprawl), curlPose.foot, curl), 16, dt);
    }

    /* THE GRASPERS, and they carry the grip pool's own read: as the
       grip fails they splay wider and lose their bite on the rock,
       so the player can see the fall coming before it happens. */
    const slip = 1 - clamp01(state.grip / C.gripMax);
    // Same tuck the springs take, so nothing sticks out of the crust.
    const tuckG = 1 - clamp01(wake / 0.42);
    for (let i = 0; i < graspers.length; i += 1) {
      const leg = graspers[i];
      const side = leg.spec.side;
      const held = flying || sprawl > 0.5 ? 0 : 1;
      /* SHUDDER UNDER STRAIN. The splay already says the grip is
         failing; a claw that is also visibly juddering says it is
         failing NOW, and the two together are what buy the player the
         two seconds of warning the seams promise. Squared, so an
         untouched grip is perfectly still. */
      const strain = slip * slip * Math.sin(seamClock * 3.1 + i * 1.7) * 0.10;
      leg.hip.rotation.x = damp(leg.hip.rotation.x,
        lerp(0.55, GRASPER_GRIP.hip, held) + slip * 0.5 + sprawl * 0.7 + curl * 0.9
        + strain + tuckG * 0.75, 12, dt);
      leg.hip.rotation.z = damp(leg.hip.rotation.z,
        side * (GRASPER_GRIP.hipZ + slip * 0.55 + (1 - held) * 0.4 - curl * 0.45
          - tuckG * 0.45), 12, dt);
      /* THE REAR PAIR REACHES FURTHER, and by a solved amount rather
         than by the same 1.5 the front pair uses. Under the 0.42
         nose-down perch pitch one shared angle lands the four claws
         on a plane tilted 24 degrees off the rock: the front two bite
         and the back two hang clear. `kneeGrip` is bisected at build
         time so all four arrive together. */
      leg.knee.rotation.x = damp(leg.knee.rotation.x,
        lerp(0.9, leg.spec.kneeGrip, held) - slip * 0.6 + curl * 1.4 - strain
        + tuckG * 0.65, 12, dt);
    }

    /* GRIP DUST. The claws are in rock and the rock is losing - so
       the contact sheds. Rationed to a fixed cadence and gated on the
       grip actually being worn, because a perched animal is on screen
       for the entire fight and an unconditional emitter here would be
       a permanent particle cost for a cue nobody is reading yet. */
    if (state.phase === "perched" && slip > 0.22) {
      state.gripDust -= dt;
      if (state.gripDust <= 0) {
        state.gripDust = lerp(0.30, 0.10, slip);
        const leg = graspers[(Math.random() * graspers.length) | 0];
        leg.foot.getWorldPosition(_scratch);
        ctx.vfx?.spark?.(_scratch.x, _scratch.y, _scratch.z, 0.28 + slip * 0.4,
          true, false);
      }
    }

    /* THE HEAD TRACKS THE GROUND IT IS SPITTING AT.

       Only PART of the way, and that is not a compromise: the body
       already pitches nose-down over the drop, so the head asking for
       the full depression angle on top of that would bury its own chin
       in the thorax. It takes 0.45 of the error inside a range a neck
       could actually reach, and the aim itself is exact regardless -
       `fireBolt` solves the bolt's direction from the port's world
       position, not from where the head happens to be looking. What
       the nod buys is the READ. */
    const ps = ctx.player?.state;
    if (ps && !flying) {
      const want = Math.atan2(
        state.pos.y - (ps.y + 1),
        Math.hypot(ps.x - state.pos.x, ps.z - state.pos.z)) - Math.PI * 0.5;
      /* Plus the anticipation pair. A bolt that leaves a face which
         does not move is a bolt that was spawned, not spat: the windup
         REARS - head back and nose up, off the target - and the shot
         throws it forward again. */
      const wind = clamp01(state.volleyWind / Math.max(1e-4, C.volleyWindup));
      maw.rotation.x = damp(maw.rotation.x,
        clamp(-want * 0.45, -0.52, 0.26) + state.recoil * 0.30 - wind * 0.26, 7, dt);
      maw.position.z = damp(maw.position.z,
        1.75 + state.recoil * 0.10 - wind * 0.09, 13, dt);
      /* And the aperture SWELLS as the volley loads, which is the only
         charge tell a player ninety metres below has. `volleyWind`
         counts DOWN to the shot, so the swell is `1 - wind` and it has
         to be gated on the windup being live or an idle animal would
         sit at full charge between bursts. It rides the visibility
         gate above, so a rock-covered Stylite still shows nothing. */
      if (mawGlow) {
        /* CLAMPED, and the ceiling is geometric rather than tasteful.
           The funnel is 0.40 long with its apex 0.56 back from the
           lip, so anything past 1.4 on z pushes the lit face out of
           the mouth - which is the exact artefact this whole block
           exists to avoid. 0.38 lands it flush with the lip at full
           charge and no further. */
        const charge = clamp01((state.volleyWind > 0 ? 1 - wind : 0)
          + state.recoil * 0.5);
        mawGlow.scale.set(1 + charge * 0.16, 1 + charge * 0.16, 1 + charge * 0.38);
      }
    }
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function perchPos(i) {
    const p = perches[clamp(Math.round(i), 0, perches.length - 1)];
    return p;
  }

  function faceThe(x, z, rate, dt) {
    const want = Math.atan2(x - state.pos.x, z - state.pos.z);
    state.facing = dampAngle(state.facing, want, rate, dt);
  }

  /** Pick the next crown: not the one it is on, and biased toward
   *  needles that actually overlook the player. */
  function pickPerch() {
    const ps = ctx.player.state;
    let best = state.perch;
    let bestScore = -Infinity;
    for (let i = 0; i < perches.length; i += 1) {
      if (i === state.perch) continue;
      const p = perches[i];
      const d = Math.hypot(p.x - ps.x, p.z - ps.z);
      /* Wants to be near enough to shoot and far enough to be awkward
         to shoot back at, plus a little noise so a fight never runs
         the same circuit twice. */
      const score = -Math.abs(d - 46) + rng() * 26;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function beginLeap(toIndex) {
    const p = perchPos(toIndex);
    state.phase = "leap";
    state.timer = C.coilSeconds + C.flightSeconds + C.landSeconds;
    state.from.copy(state.pos);
    state.to.set(p.x, p.y, p.z);
    state.flight = 0;
    state.perch = toIndex;
    const span = state.from.distanceTo(state.to);
    state.arcHeight = Math.max(14, span * C.arcRise);
    bus.emit("coil", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
  }

  function beginStoop() {
    const ps = ctx.player.state;
    state.phase = "stoop";
    state.timer = C.coilSeconds + C.flightSeconds * 0.8 + C.landSeconds;
    state.from.copy(state.pos);
    /* At the player's feet, not their head, and captured now rather
       than tracked: a leap that homes is not a leap, it is a missile,
       and the whole answer to this attack is to not be there. */
    state.to.set(ps.x, groundAt(ps.x, ps.z) + 1.2, ps.z);
    state.flight = 0;
    state.arcHeight = Math.max(16, state.from.distanceTo(state.to) * 0.34);
    state.stoopTimer = C.stoopCadence;
    ctx.player?.doctrineKick?.(0.4, 0.3);
    bus.emit("stoopTelegraph", { x: state.to.x, y: state.to.y, z: state.to.z });
  }

  /** Landing, from a leap or a stoop. */
  function land(fromStoop) {
    const p = state.to;
    ctx.vfx?.blast?.(p.x, p.y, p.z, fromStoop ? C.stoopRadius * 0.7 : 5);
    if (fromStoop) {
      ctx.vfx?.breach?.(p.x, groundAt(p.x, p.z), p.z, C.stoopRadius, 2.0);
      ctx.player?.punch?.(1.5);
      ctx.player?.doctrineKick?.(1.0, 0.9);
      const ps = ctx.player?.state;
      if (ps && !ctx.combat?.player?.dead) {
        const d = Math.hypot(ps.x - p.x, ps.z - p.z);
        if (d < C.stoopRadius) {
          const falloff = 1 - 0.5 * (d / C.stoopRadius);
          ctx.combat.hurtPlayer(C.stoopDamage * falloff
            * SURVIVAL_CONFIG.enemyDamageMultiplier, {
            source: "stylite-stoop", x: ps.x, y: ps.y + 1.0, z: ps.z,
          });
          ctx.player?.applySlow?.(C.stoopSlowFactor, C.stoopSlowSeconds);
        }
      }
      ctx.combat?.shockwave?.(p.x, groundAt(p.x, p.z), p.z, {
        radius: C.stoopRadius, innerRadius: C.stoopRadius * 0.3,
        damage: 0, stun: 1.2, knockSpeed: 9, source: "stylite-stoop",
      });
      bus.emit("stoop", { x: p.x, y: p.y, z: p.z });
      /* A stoop puts it ON THE GROUND, but standing and dangerous -
         not the plummet window. It goes straight back up. */
      state.phase = "perched";
      state.perchTimer = 1.1;
      return;
    }
    /* THE CROWN ANSWERS. Seven metres of animal arriving on a rock
       shoulder should shed the shoulder: dust off the contact, the
       body sinking into its own legs, and a camera punch scaled by
       how close the player is standing to it - a landing ninety
       metres up and two hundred metres away must not shake the frame
       as hard as one overhead. */
    state.absorb = 1;
    state.absorbV = 0;
    ctx.vfx?.spark?.(p.x, p.y - 1.6, p.z, 1.6, true, false);
    const pls = ctx.player?.state;
    if (pls) {
      const near = clamp01(1 - Math.hypot(pls.x - p.x, pls.z - p.z) / 90);
      if (near > 0.02) ctx.player?.punch?.(0.55 * near * near);
    }
    bus.emit("land", { x: p.x, y: p.y, z: p.z });
    state.phase = "perched";
    state.perchTimer = lerp(C.perchSeconds[0], C.perchSeconds[1], rng());
    /* A fresh crown is a fresh grip. This is what stops a player
       chipping the pool down over several perches and getting the fall
       for free: it has to be broken inside one perch. */
    state.grip = C.gripMax;
  }

  /* ------------------------------------------------------------
     THE FALL
     ------------------------------------------------------------ */
  function beginPlummet() {
    state.phase = "plummet";
    state.timer = C.fallSeconds;
    state.from.copy(state.pos);
    /* IT HAS TO FALL CLEAR OF THE NEEDLE.

       Dropping straight down looks like the honest thing to do and is
       not: the crowns it perches on are the narrow ends of cones
       fifteen metres wide at the sand, so a plumb-line fall lands the
       animal INSIDE the rock. Not near it - measured at zero metres
       from the axis. Everything after that is broken and none of it
       is obviously broken: the stunned boss is buried in a spire, the
       player is shoved out by the needle's collision before they can
       reach it, and the melee window that the entire fight is built
       to earn cannot be taken. The screenshots read as a black frame,
       which is the only reason this was ever noticed.

       So it peels off. The bearing is toward the player, both because
       a bug losing its grip on a leaning face falls off that face and
       because the reward for breaking the grip should land where the
       person who broke it is standing, not a needle's width behind
       it. The distance clears the widest part of the cone. */
    const p0 = perches[state.perch] || null;
    const ps = ctx.player?.state;
    let dx = ps ? ps.x - state.pos.x : 1;
    let dz = ps ? ps.z - state.pos.z : 0;
    let dd = Math.hypot(dx, dz);
    if (dd < 1e-3) { dx = 1; dz = 0; dd = 1; }
    const clearOf = (p0?.baseRad || 0) + C.fallClearance;
    const tx = state.pos.x + (dx / dd) * clearOf;
    const tz = state.pos.z + (dz / dd) * clearOf;
    const gy = groundAt(tx, tz);
    state.to.set(tx, gy + C.crashRestHeight, tz);
    state.tumble = 0;
    state.volleyWind = 0;
    state.volleyLeft = 0;
    state.falls += 1;
    ctx.player?.doctrineKick?.(0.8, 0.7);
    bus.emit("gripBroken", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
  }

  function crash() {
    const p = state.to;
    const gy = groundAt(p.x, p.z);
    state.phase = "stunned";
    state.timer = C.stunnedSeconds;
    state.tumble = 0;
    state.coil = 0;
    state.grip = C.gripMax;
    /* IT HURTS ITSELF. An animal that drops ninety metres onto rock and
       stands up unmarked teaches the player that breaking the grip was
       decoration. This is most of the reward; the melee window is the
       rest. */
    ctx.combat?.damageEnemy?.(inst, C.fallSelfDamage, {
      source: "stylite-fall", x: p.x, y: gy + 1, z: p.z,
    });
    ctx.vfx?.breach?.(p.x, gy, p.z, C.crashRadius * 1.4, 2.6);
    ctx.vfx?.blast?.(p.x, gy + 0.4, p.z, C.crashRadius * 0.8);
    state.absorb = 1;
    state.absorbV = 0;
    /* THE CRATER STAYS. A landing that leaves nothing on the ground is
       a landing the player can walk away from and find no evidence of
       - which is exactly what a ninety-metre fall should not be. The
       decal pool is what marks are for, and a ring of them under the
       body plus a drag scar off the impact bearing is a crash without
       needing a bespoke system. */
    const drag = Math.atan2(p.x - state.from.x, p.z - state.from.z);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU + drag;
      const r = 1.6 + (i % 2) * 1.5;
      ctx.vfx?.footprint?.(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, a, 0, 1);
    }
    ctx.vfx?.skidMark?.(p.x, p.z, drag, 1, 3.2);
    ctx.vfx?.skidMark?.(p.x - Math.sin(drag) * 2.4, p.z - Math.cos(drag) * 2.4,
      drag, 0.8, 2.6);
    ctx.player?.punch?.(1.7);
    ctx.player?.doctrineKick?.(1.2, 1.0);
    const ps = ctx.player?.state;
    if (ps && !ctx.combat?.player?.dead) {
      const d = Math.hypot(ps.x - p.x, ps.z - p.z);
      if (d < C.crashRadius) {
        ctx.combat.hurtPlayer(C.crashDamage * (1 - d / C.crashRadius)
          * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "stylite-crash", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
      }
    }
    bus.emit("crash", { x: p.x, y: gy, z: p.z });
  }

  /**
   * Damage the grip. Called from combat.js's authoritative damage path
   * so every weapon contributes in proportion and nothing needs a rule
   * of its own - see `ctx.stylite.wearGrip`.
   *
   * Only while perched: a shot at an animal in mid-air has nothing to
   * tear off a rock, and one at an animal already on the ground has
   * nothing left to break.
   */
  function wearGrip(amount) {
    if (!inst || state.phase !== "perched") return 0;
    const before = state.grip;
    state.grip = Math.max(0, state.grip - Math.max(0, amount) * C.gripShare);
    const worn = before - state.grip;
    if (worn > 0) bus.emit("grip", { grip: state.grip, max: C.gripMax });
    if (state.grip <= 0) beginPlummet();
    return worn;
  }

  /* ------------------------------------------------------------
     BEING HIT

     `combat.js` calls `wearGrip(actual, inst)` from its one
     authoritative damage path, and that is the right shape for the
     GRIP - a scalar, in proportion to whatever landed. It is the
     wrong shape for a flinch, which has to know WHERE. So the module
     also listens to the same path's `enemyDamaged` event, which
     already carries the impact point that every other consumer (the
     HUD's hit markers, the damage numbers) reads.

     Subscribed lazily, from `update`, because `buildStylite` runs in
     the module graph before `ctx.combat` exists and reaching for a
     bus at construction time would silently bind nothing.
     ------------------------------------------------------------ */
  let hurtBound = false;

  function bindHurt() {
    if (hurtBound || !ctx.combat?.bus?.on) return;
    hurtBound = true;
    ctx.combat.bus.on("enemyDamaged", (e) => {
      if (!inst || !e || e.enemyId !== inst.id) return;
      onHurt(e);
    });
  }

  function onHurt(e) {
    /* The hit, resolved into BODY space. A flinch that ignores the
       bearing is a wobble; one that answers it is the difference
       between "it was hit" and "I hit it there". */
    const dx = (Number.isFinite(e.x) ? e.x : state.pos.x) - state.pos.x;
    const dz = (Number.isFinite(e.z) ? e.z : state.pos.z) - state.pos.z;
    const s = Math.sin(state.facing);
    const c = Math.cos(state.facing);
    const lz = dx * s + dz * c;          // + is the animal's front
    const lx = dx * c - dz * s;          // + is its left
    const mag = clamp01((e.actual || 0) / 260) * 0.20 + 0.03;
    state.hurtSide = lx;
    state.hurtLift = (Number.isFinite(e.y) ? e.y : state.pos.y) - state.pos.y;
    /* Struck from the FRONT means shoved backward, which is a nose-up
       pitch on this rig, so the sign follows the bearing rather than
       being picked. Divided by the reach so a graze at the tip of a
       hind spring does not throw the thorax as hard as a body shot. */
    const reach = Math.max(1, Math.hypot(lx, lz));
    state.flinchPV += (lz / reach) * mag * 26;
    state.flinchRV += (-lx / reach) * mag * 26;

    /* ICHOR. Warm-channel debris at the wound, and it lands: while
       the animal is on the ground the spray reaches the sand and
       stains it, which is the only way a fight in a crater leaves a
       record of itself. */
    const hx = Number.isFinite(e.x) ? e.x : state.pos.x;
    const hy = Number.isFinite(e.y) ? e.y : state.pos.y;
    const hz = Number.isFinite(e.z) ? e.z : state.pos.z;
    ctx.vfx?.spark?.(hx, hy, hz, 0.55, false, true);
    if (inst.grounded && Math.random() < 0.5) {
      ctx.vfx?.footprint?.(hx + (Math.random() - 0.5) * 2.4,
        hz + (Math.random() - 0.5) * 2.4, Math.random() * TAU, 0, 0.85);
    }

    /* DAMAGE THAT STAYS. The kit pools soot in the coarse mottle's
       troughs and cracks the deepest creases; it is squared inside
       the shader so the glow arrives late, which is why this can be
       driven linearly off health and still keep a second act. The
       crust is deliberately excluded - it is off the animal by the
       time anything can shoot it. */
    if (inst.maxHealth > 0) {
      /* CAPPED, and the cap is not caution - it was measured twice.

         Driven to a full 1.0 the kit's soot term pools hard enough in
         the coarse mottle's troughs that a nearly-dead Stylite
         photographed as LEOPARD PRINT: a high-contrast blotch pattern
         all over the crest, which is the same failure the kit's own
         header records for its ember channel, arriving through the
         scorch instead. 0.72 was the first cap and 05-hurt still came
         back tiger-striped, because the soot keys on the METRE-scale
         octave and this animal's grain is authored at 0.78m - so the
         blotches land at almost exactly plate size and read as
         markings rather than as burning. 0.45 darkens and cracks the
         shell while leaving it one material.

         The real fix belongs in the kit, not here - see the report:
         soot should ride a finer octave than the one that also drives
         albedo mottle, or the family table needs its own `soot`
         scalar. Every boss that gets hurt has this. */
      const d = clamp01(1 - inst.health / inst.maxHealth) * 0.45;
      if (d > state.surfaceDamage + 0.01) {
        state.surfaceDamage = d;
        setSurfaceDamage(shellMat, d);
        setSurfaceDamage(plateMat, d * 0.7);
      }
    }
  }

  /* ------------------------------------------------------------
     PHASES
     ------------------------------------------------------------ */
  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = false;   // an empty anchor
    group.visible = !hidden;
  }

  function beginRouse() {
    state.phase = "rouse";
    state.timer = C.rouseSeconds;
    setEncounterGate(false, true);
    ctx.mission?.announce?.("SOMETHING MOVES ON THE NEEDLES", 3.4);
    bus.emit("aggro", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      /* Framed from BELOW, looking up the needle it is on. The whole
         proposition of this fight is that the boss is above you, and
         the reveal should be the shot that says so. */
      const px = ctx.player.state.x;
      const pz = ctx.player.state.z;
      const dx = state.pos.x - px;
      const dz = state.pos.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      const camX = state.pos.x - (dx / d) * 34;
      const camZ = state.pos.z - (dz / d) * 34;
      ctx.player.setFree(true, [camX, groundAt(camX, camZ) + 4, camZ],
        [state.pos.x, state.pos.y, state.pos.z], 54);
      state.releaseCameraAt = 0.7;
    }
  }

  function releaseEncounterCamera() {
    ctx.player?.setFree?.(false);
    state.releaseCameraAt = undefined;
  }

  function beginRetire() {
    healToFull();
    clearHazards();
    state.phase = "retire";
    state.timer = C.retireSeconds;
    state.disengageFor = 0;
    releaseEncounterCamera();
    bus.emit("retiring", { x: state.pos.x, z: state.pos.z });
  }

  function stepPerched(dt) {
    const ps = ctx.player.state;
    faceThe(ps.x, ps.z, 2.4, dt);
    state.coil = damp(state.coil, 0, 6, dt);
    /* The grip knits back together on a crown it has held for a while,
       which is what makes the pool a burst-damage problem rather than a
       chip-damage one. */
    state.grip = Math.min(C.gripMax, state.grip + C.gripRegen * dt);

    state.perchTimer -= dt;
    state.stoopTimer -= dt;
    state.volleyTimer -= dt;

    if (state.volleyWind > 0) {
      state.volleyWind -= dt;
      if (state.volleyWind <= 0) {
        state.volleyLeft = C.volleyShots;
        state.volleyGap = 0;
      }
    } else if (state.volleyLeft > 0) {
      state.volleyGap -= dt;
      if (state.volleyGap <= 0) {
        fireBolt();
        state.volleyLeft -= 1;
        state.volleyGap = C.volleyGap;
      }
    } else if (state.volleyTimer <= 0) {
      state.volleyTimer = C.volleyCadence;
      state.volleyWind = C.volleyWindup;
      bus.emit("aim", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
    }

    const dist = Math.hypot(ps.x - state.pos.x, ps.z - state.pos.z);
    if (state.stoopTimer <= 0 && dist > C.stoopMinRange) { beginStoop(); return; }
    if (state.perchTimer <= 0) beginLeap(pickPerch());
  }

  function stepFlight(dt, isStoop) {
    state.timer -= dt;
    const total = C.coilSeconds + (isStoop ? C.flightSeconds * 0.8 : C.flightSeconds)
      + C.landSeconds;
    const elapsed = total - state.timer;

    if (elapsed < C.coilSeconds) {
      // The load. Everything about the animal winds down and inward.
      state.coil = smoothstep(elapsed / C.coilSeconds);
      faceThe(state.to.x, state.to.z, 4.5, dt);
      state.pos.lerp(state.from, clamp01(dt * 8));
      return;
    }
    const flightSpan = isStoop ? C.flightSeconds * 0.8 : C.flightSeconds;
    const f = clamp01((elapsed - C.coilSeconds) / flightSpan);
    state.flight = f;
    if (f < 1) {
      if (state.coil > 0) {
        state.coil = 0;
        ctx.vfx?.blast?.(state.from.x, state.from.y, state.from.z, 4.2);
        bus.emit("launch", { x: state.from.x, y: state.from.y, z: state.from.z });
      }
      /* A ballistic arc, not a lerp with a sine on it: the animal
         should visibly slow at the top and accelerate into the landing,
         which is what tells the player when it is going to arrive. */
      state.pos.lerpVectors(state.from, state.to, f);
      state.pos.y += Math.sin(f * Math.PI) * state.arcHeight;
      // Pitched into its own trajectory.
      faceThe(state.to.x, state.to.z, 8, dt);
      state.tumble = Math.sin(f * Math.PI) * 0.12;
      return;
    }
    state.tumble = 0;
    if (state.phase !== "perched") land(isStoop);
  }

  function stepPlummet(dt) {
    state.timer -= dt;
    const f = clamp01(1 - state.timer / C.fallSeconds);
    /* Gravity, not a lerp: it hangs for a moment as the grip goes and
       then arrives fast, which is the difference between falling and
       being lowered. */
    state.pos.lerpVectors(state.from, state.to, f * f);
    state.tumble += dt * (2.2 + f * 5.5);
    state.coil = damp(state.coil, 0.25, 4, dt);
    state.dustTick -= dt;
    if (state.dustTick <= 0) {
      state.dustTick = 0.07;
      ctx.vfx?.spark?.(state.pos.x, state.pos.y, state.pos.z, 0.9, false, true);
    }
    if (state.timer <= 0) crash();
  }

  /* ------------------------------------------------------------
     DEATH, AS A PHYSICAL EVENT

     It used to be a flag: the animal was marked dead, a breach was
     fired at whatever ground was under it, and the body froze in
     place. If it died on a needle it stayed on the needle - a corpse
     hanging ninety metres up, in the pose it was shooting from, for
     the rest of the session.

     It now finishes the fall it was already in the middle of. The
     path is the plummet's - peel clear of the cone, gravity, tumble -
     because a dead Stylite is subject to exactly the same geometry
     as a disgripped one, INCLUDING the trap that cost this module a
     round: dropping straight down lands the body inside the rock,
     measured at zero metres from the axis, where nothing can reach
     it and every assertion still passes. Then it rolls onto its back
     and the legs curl, which is what a dead insect looks like from
     any distance at all.
     ------------------------------------------------------------ */
  function beginDeath() {
    state.defeated = true;
    state.phase = "dead";
    state.deathT = 0;
    state.deathLanded = false;
    state.deathRoll = 0;
    state.from.copy(state.pos);
    const gy = groundAt(state.pos.x, state.pos.z);
    const p0 = perches[state.perch] || null;
    if (state.pos.y - gy < 3.5) {
      // Already down. Nothing to fall; go straight to settling.
      state.deathTo.copy(state.pos);
      state.deathFrom.copy(state.pos);
      state.deathLanded = true;
    } else {
      const ps = ctx.player?.state;
      let dx = ps ? ps.x - state.pos.x : 1;
      let dz = ps ? ps.z - state.pos.z : 0;
      let dd = Math.hypot(dx, dz);
      if (dd < 1e-3) { dx = 1; dz = 0; dd = 1; }
      const clearOf = (p0?.baseRad || 0) + C.fallClearance;
      const tx = state.pos.x + (dx / dd) * clearOf;
      const tz = state.pos.z + (dz / dd) * clearOf;
      state.deathFrom.copy(state.pos);
      state.deathTo.set(tx, groundAt(tx, tz) + C.crashRestHeight * 0.72, tz);
    }
    clearHazards();
    ctx.player?.doctrineKick?.(1.6, 1.4);
    bus.emit("defeated", { x: state.pos.x, z: state.pos.z });
  }

  function stepDeath(dt) {
    state.deathT += dt;
    if (!state.deathLanded) {
      const f = clamp01(state.deathT / (C.fallSeconds * 1.25));
      state.pos.lerpVectors(state.deathFrom, state.deathTo, f * f);
      state.tumble += dt * (1.8 + f * 4.5);
      state.dustTick -= dt;
      if (state.dustTick <= 0) {
        state.dustTick = 0.08;
        ctx.vfx?.spark?.(state.pos.x, state.pos.y, state.pos.z, 0.8, false, true);
      }
      if (f >= 1) {
        state.deathLanded = true;
        state.deathT = 0;
        state.tumble = 0;
        const gy = groundAt(state.pos.x, state.pos.z);
        ctx.vfx?.breach?.(state.pos.x, gy, state.pos.z, 15, 2.6);
        ctx.vfx?.blast?.(state.pos.x, gy + 0.5, state.pos.z, 9);
        ctx.player?.punch?.(1.4);
        const drag = Math.atan2(state.pos.x - state.deathFrom.x,
          state.pos.z - state.deathFrom.z);
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * TAU + drag;
          ctx.vfx?.footprint?.(state.pos.x + Math.sin(a) * (1.8 + (i % 2) * 1.7),
            state.pos.z + Math.cos(a) * (1.8 + (i % 2) * 1.7), a, 0, 1);
        }
        ctx.vfx?.skidMark?.(state.pos.x, state.pos.z, drag, 1, 3.6);
      }
      return;
    }
    /* It rolls over. The settle is deliberately slow - four seconds
       of a big animal giving up its own weight, and then it stops
       being simulated at all. */
    state.deathRoll = damp(state.deathRoll, 2.35, 1.5, dt);
    state.tumble = damp(state.tumble, 0, 3, dt);
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death" || inst.health <= 0) {
      if (!state.defeated) {
        if (inst.state !== "death") enemies.kill?.(inst);
        beginDeath();
      }
      stepDeath(dt);
      return;
    }

    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - state.pos.x, ps.z - state.pos.z);

    if (state.phase === "dormant") {
      if (!ctx.combat?.player?.dead && dist <= C.aggroRadius) beginRouse();
      return;
    }

    if (state.phase === "retire") {
      state.timer -= dt;
      if (dist <= C.aggroRadius && !ctx.combat?.player?.dead) {
        state.phase = "rouse";
        state.timer = C.rouseSeconds * (1 - state.woken);
        setEncounterGate(false, true);
        bus.emit("aggro", { x: state.pos.x, z: state.pos.z });
        return;
      }
      if (state.timer <= 0) {
        state.phase = "dormant";
        state.revealed = false;
        setEncounterGate(true, true);
        bus.emit("reset", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    if (dist > C.disengageRadius) {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginRetire(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "rouse") {
      state.timer = Math.max(0, state.timer - dt);
      faceThe(ps.x, ps.z, 1.6, dt);
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        releaseEncounterCamera();
      }
      if (state.timer <= 0) {
        releaseEncounterCamera();
        state.phase = "perched";
        state.perchTimer = C.perchSeconds[0];
        state.volleyTimer = 1.2;
        state.stoopTimer = C.stoopCadence * 0.6;
        setEncounterGate(false, false);
        bus.emit("engaged", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    if (state.phase === "perched") { stepPerched(dt); return; }
    if (state.phase === "leap") { stepFlight(dt, false); return; }
    if (state.phase === "stoop") { stepFlight(dt, true); return; }
    if (state.phase === "plummet") { stepPlummet(dt); return; }

    if (state.phase === "stunned") {
      state.timer = Math.max(0, state.timer - dt);
      state.tumble = damp(state.tumble, 0, 4, dt);
      faceThe(ps.x, ps.z, 0.7, dt);
      if (state.timer <= 0) {
        state.phase = "recover";
        state.timer = C.recoverSeconds;
        bus.emit("recover", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    if (state.phase === "recover") {
      state.timer = Math.max(0, state.timer - dt);
      state.coil = damp(state.coil, 0.8, 5, dt);
      if (state.timer <= 0) beginLeap(pickPerch());
    }
  }

  /* ------------------------------------------------------------
     PER-FRAME
     ------------------------------------------------------------ */
  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    bindHurt();

    const ps = ctx.player?.state;
    if (ps) {
      lead.vx = damp(lead.vx, (ps.x - lead.x) / Math.max(1e-4, d), 9, d);
      lead.vz = damp(lead.vz, (ps.z - lead.z) / Math.max(1e-4, d), 9, d);
      lead.x = ps.x;
      lead.z = ps.z;
    }

    stepInstance(d);

    const wantWoken = state.phase === "dormant" || state.phase === "retire" ? 0 : 1;
    state.woken = state.phase === "rouse"
      ? clamp01(1 - state.timer / Math.max(1e-4, C.rouseSeconds))
      : damp(state.woken, wantWoken, 2.2, d);

    /* DON'T POSE A HIDDEN ANIMAL.

       `poseBody` damps eighteen joints and then calls
       updateMatrixWorld(true) over the whole rig, and it was running
       every frame from the moment the level loaded - including while
       the Stylite sat dormant and invisible on a needle six hundred
       metres from the player, in every other district's fight. It
       measured as about 1.3ms a frame added to the ENTIRE GAME, which
       is the kind of cost that never shows up in this boss's own
       budget check and quietly pushes somebody else's over.

       `group.visible` is the honest test rather than a distance,
       because the encounter gate already owns that decision: dormant
       means hidden means nothing to draw. Bolts cannot exist while it
       is hidden either - the gate is only closed when it is dormant
       or retired, and both clear the air on the way in. The instance
       mirror below still runs, so the HUD, the hit tests and the
       mission marker keep agreeing about where it is. */
    if (group.visible) {
      poseBody(d);
      updateBolts(d);
    } else {
      body.position.copy(state.pos);
    }

    /* Mirrored onto the instance. Its Y is the live body height, which
       is the whole point: the HUD's range readout, the minimap and
       every hit test have to agree that this animal is ninety metres
       up, because that is the fight. */
    inst.x = state.pos.x;
    inst.y = state.pos.y;
    inst.z = state.pos.z;
    inst.yaw = state.facing;
    /* Read by combat.js's HITBOX.stylite: the melee gate and the
       stunned multiplier both hang off it. */
    inst.grounded = state.phase === "stunned" || state.phase === "recover";
    inst.alerted = state.phase !== "dormant";
    inst.suspicion = inst.alerted ? 1 : 0;
    inst.root.position.set(inst.x, inst.y, inst.z);
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */
  function healToFull() {
    if (!inst) return;
    inst.health = inst.maxHealth;
    state.grip = C.gripMax;
    /* The scorch goes with the health. A boss that retires to its
       needle, heals, and comes back still cracked open and glowing in
       every crease is telling the player a lie about how the last
       engagement went. */
    state.surfaceDamage = 0;
    setSurfaceDamage(shellMat, 0);
    setSurfaceDamage(plateMat, 0);
  }

  function clearHazards() {
    for (const b of bolts) { b.live = false; b.mesh.visible = false; }
  }

  function seat(index) {
    const p = perchPos(index);
    state.perch = clamp(Math.round(index), 0, perches.length - 1);
    state.pos.set(p.x, p.y, p.z);
    state.from.copy(state.pos);
    state.to.copy(state.pos);
    state.facing = Math.atan2(C.homeX - p.x, C.homeZ - p.z);
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    /* One retry, for the ordering this module must not depend on: if
       `buildStylite` ran before the Choir batch reached the scene the
       crowns are still analytic, and the first time anything asks for
       this animal is the last moment that is cheap to fix. Latched, so
       it is one call and never a per-spawn cost. */
    mapCrowns();
    seat(0);
    inst = enemies.spawn("stylite", state.pos.x, state.pos.z, {
      yaw: state.facing,
      eventId: "district-boss:choir",
    });
    if (!inst) return null;
    inst.y = state.pos.y;
    inst.grounded = false;
    poseBody(0);
    setEncounterGate(true, true);
    return inst;
  }

  function resetToPerch() {
    state.defeated = false;
    /* A KILLED INSTANCE CANNOT BE RESET, IT HAS TO BE REPLACED.

       `healToFull` puts the health back but `inst.state` is still
       "death", and `stepInstance`'s first test reads that - so the
       very next frame walked straight back into the death branch and
       re-killed the animal. `resetStylite` therefore did nothing at
       all once the boss had been beaten once, silently, with a status
       block that reported phase "dormant" for exactly one frame. The
       QA hook and the gallery's own pose step both go through here. */
    if (inst && inst.state === "death") {
      enemies.remove?.(inst);
      inst = null;
    }
    if (!inst) ensureSpawned();
    if (!inst) return;
    healToFull();
    clearHazards();
    state.phase = "dormant";
    state.timer = 0;
    state.woken = 0;
    state.coil = 0;
    state.tumble = 0;
    state.flight = 0;
    state.falls = 0;
    state.revealed = false;
    state.disengageFor = 0;
    releaseEncounterCamera();
    state.volleyWind = 0;
    state.volleyLeft = 0;
    state.deathT = 0;
    state.deathRoll = 0;
    state.deathLanded = false;
    state.absorb = 0;
    state.absorbV = 0;
    state.flinchP = 0;
    state.flinchPV = 0;
    state.flinchR = 0;
    state.flinchRV = 0;
    state.recoil = 0;
    /* Back into its rock. The shed is the encounter's one-shot
       opening and a reset that did not put the shell back would give
       every run after the first a boss that wakes up already naked. */
    reseatCrust();
    seat(0);
    inst.grounded = false;
    poseBody(0);
    setEncounterGate(true, true);
    bus.emit("reset", { x: state.pos.x, z: state.pos.z });
  }

  function status() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", dead: true, defeated: true,
        health: 0, maxHealth: 5400, x: C.homeX, z: C.homeZ,
      } : null;
    }
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      grip: Math.round(state.grip),
      gripMax: C.gripMax,
      gripFraction: Number((state.grip / C.gripMax).toFixed(3)),
      perch: state.perch,
      perches: perches.length,
      grounded: !!inst.grounded,
      airborne: state.phase === "leap" || state.phase === "stoop"
        || state.phase === "plummet",
      altitude: Number((state.pos.y - groundAt(state.pos.x, state.pos.z)).toFixed(1)),
      falls: state.falls,
      coil: Number(state.coil.toFixed(3)),
      /* The camouflage, as a readable fact: `crust` is true only
         while the stone shell is still on the animal, which is the
         one window where a screenshot of this boss is supposed to
         look like a rock. A check that photographs the reveal needs
         to be able to ask. */
      crust: !state.crustGone,
      shards: shards.reduce((n, s) => n + (s.mesh.visible ? 1 : 0), 0),
      damage: Number(state.surfaceDamage.toFixed(3)),
      bolts: bolts.filter((b) => b.live).length,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      dead: inst.state === "death",
      x: Number(state.pos.x.toFixed(2)),
      y: Number(state.pos.y.toFixed(2)),
      z: Number(state.pos.z.toFixed(2)),
    };
  }

  function snapshot() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", timer: 0, instanceId: null, health: 0,
        maxHealth: 5400, perch: 0, falls: 0, defeated: true,
      } : null;
    }
    /* Bolts in the air are not saved, for the Coulter's reason. The
       PERCH is, because "which needle it is on" is the whole of where
       this boss is, and restoring it to the wrong crown would put it
       across the district from where the player left it.

       AND THE PHASE IS NARROWED HERE, not just on the way back in.
       `restore` already refuses to rebuild a leap or a plummet - those
       are a position on a curve plus a destination, and re-deriving
       them from a name alone would drop the animal through the district
       - but writing the live name into the file anyway meant the SAVE
       SCHEMA saw a phase it did not accept, and rejected the entire
       record. Not the Stylite's record: the whole save, with the
       player's position and mission in it, and no indication that a
       boss caught mid-jump was the reason. A snapshot may only ever
       contain a state the restore path can actually take. */
    const SAVED = new Set(["dormant", "rouse", "perched", "retire", "dead"]);
    return {
      phase: SAVED.has(state.phase) ? state.phase : "perched",
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(Math.max(0, state.timer).toFixed(2)),
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      perch: state.perch,
      grip: Math.round(state.grip),
      falls: state.falls,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((c) => c.eventId === "district-boss:choir" && c.key === "stylite")
      || enemies.live.find((c) => c.key === "stylite");
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      group.visible = false;
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    /* Restored ON A PERCH, whatever it was doing. Mid-leap and
       mid-plummet are both a position on a curve plus a destination,
       and re-deriving those from a phase name alone would drop the
       animal through the district or leave it hanging in open air. */
    const phase = ["dormant", "rouse", "perched", "retire", "dead"]
      .includes(saved.phase) ? saved.phase : "perched";
    state.phase = phase;
    state.revealed = phase !== "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.woken = phase === "dormant" || phase === "retire" ? 0 : 1;
    state.falls = Math.max(0, Math.round(Number(saved.falls) || 0));
    state.grip = clamp(Number(saved.grip) || C.gripMax, 0, C.gripMax);
    state.coil = 0;
    state.tumble = 0;
    state.flight = 0;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    state.volleyWind = 0;
    state.volleyLeft = 0;
    state.perchTimer = C.perchSeconds[0];
    state.stoopTimer = C.stoopCadence;
    state.deathT = 0;
    state.deathRoll = 0;
    state.deathLanded = false;
    state.absorb = 0;
    state.absorbV = 0;
    state.flinchP = 0;
    state.flinchPV = 0;
    state.flinchR = 0;
    state.flinchRV = 0;
    state.recoil = 0;
    /* A save restored to `dormant` is a Stylite that has not been
       found yet, so it gets its rock back. Every other restorable
       phase is post-rouse and `poseBody` latches `crustGone` on its
       first frame - which is why nothing here has to enumerate them. */
    if (phase === "dormant") reseatCrust();
    seat(Number.isFinite(saved.perch) ? saved.perch : 0);
    clearHazards();
    if (Number.isFinite(saved.health)) {
      inst.health = clamp(saved.health, 1, inst.maxHealth);
    }
    /* Damage is a property of the animal, not of the session: a boss
       reloaded at 20% health has to come back carrying the same
       scorch it went out with, or the save reads as a heal. */
    state.surfaceDamage = clamp01(1 - inst.health / Math.max(1, inst.maxHealth)) * 0.45;
    setSurfaceDamage(shellMat, state.surfaceDamage);
    setSurfaceDamage(plateMat, state.surfaceDamage * 0.7);
    inst.grounded = false;
    poseBody(0);
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "rouse");
    return true;
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
    ensureSpawned,
    /** Called from combat.js's one authoritative damage path, so every
     *  weapon wears the grip in proportion to what it dealt. */
    wearGrip,
    /** The crowns it uses, for the HUD and for checks. */
    perches() {
      return perches.map((p) => ({
        x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        /* The crown's radius at the height the animal stands on. Any
           caller reasoning about a LINE to a perch needs it - a camera
           choosing an angle, a marker deciding it is occluded - and
           without it a needle is a point and every one of them looks
           clear. */
        rad: Number(p.rad.toFixed(2)),
        baseRad: Number(p.baseRad.toFixed(2)),
        baseY: Number(p.baseY.toFixed(2)),
      }));
    },
    /** Fold it back onto its needle, with the animation. The arena
     *  boundary's reset path - see district-bosses.js. */
    retire() {
      if (!inst || state.defeated) return null;
      if (state.phase === "dormant" || state.phase === "retire") return null;
      beginRetire();
      return { phase: state.phase };
    },
    resetToPerch,
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      state.woken = state.phase === "dormant" || state.phase === "retire" ? 0 : 1;
      if (state.phase === "dormant" || state.phase === "retire") reseatCrust();
      if (state.phase === "perched") {
        seat(state.perch);
        state.perchTimer = C.perchSeconds[1];
      }
      inst.grounded = state.phase === "stunned" || state.phase === "recover";
      setEncounterGate(state.phase === "dormant",
        state.phase === "dormant" || state.phase === "rouse");
      poseBody(0);
      return { phase: state.phase, timer: state.timer };
    },
    /** Break the grip now, for checks about the fall rather than about
     *  the shooting that earns it. */
    forceFall() {
      if (!inst || state.phase !== "perched") return null;
      state.grip = 0;
      beginPlummet();
      return { phase: state.phase };
    },
    forceLeap(index) {
      if (!inst || state.phase !== "perched") return null;
      beginLeap(Number.isFinite(index) ? index : pickPerch());
      return { phase: state.phase, to: state.perch };
    },
    forceStoop() {
      if (!inst || state.phase !== "perched") return null;
      beginStoop();
      return { phase: state.phase };
    },
    instance() { return inst; },
    dispose() { scene.remove(group); },
  };
}
