/* ============================================================
   SAINTFALL - the Garner

   The Ossuary's own animal, and everything about it that is not the
   shared hit table: how the pan gives way, what comes up out of it,
   and why a tentacle that misses is worth more to the player than one
   that connects.

   "The Ossuary is not a graveyard. It is one animal." The drop
   briefing has said that since the first build, and this is the line
   being cashed. The ribcage is not a monument the district was named
   after - it is a set of ribs, and something is still using them.

   WHY THIS IS ITS OWN MODULE, AND WHY IT HAS NO MODEL

   Every other boss in the game is a skinned .glb with authored clips
   and a bespoke controller on top. This one is procedural to the last
   vertex, and both halves of it are the reason:

     THE PIT has to OPEN. Seventy-eight bone plates tipping inward off
     their own outer edges and dropping into a hole that was not there
     is per-vertex motion across a surface, not a rotation of a
     skeleton, and no rig expresses it.

     A TENTACLE has to MISS. It whips, it falls short, it lands across
     the sand, it lies there, and it drags itself home along the
     ground it landed on - and where it lands is a function of where
     the player dodged to and what the terrain does there. A baked
     clip can play a miss; it cannot land one somewhere it was not
     authored to.

   So `procedural: true` in the bestiary gives this creature an empty
   root, an id, a health pool, a save entry and a place in
   `enemies.live`, and everything the player actually looks at is
   built and posed here.

   THE FIGHT

     DORMANT   A bone-white pan with a ring of settled dust on it and
               nothing else. It ignores the player entirely until they
               cross AGGRO_RADIUS - the Ossuary is a place you walk
               into, not a wave that finds you.
     BREACH    5.2s. The ground domes, cracks in a ring forty metres
               across, and falls in. The maw rises out of the hole.
               Untouchable, and the camera is borrowed for it.
     FEEDING   THE FIGHT. Three things happen on three clocks:

               THE LASH is the encounter. Tentacles erupt from the
               sand NEAR THE PLAYER - not from the pit, because the
               animal is bigger than its own mouth - rear, and strike.
               A hit SEIZES: heavy damage and a hard drag toward the
               throat. A MISS is the whole design: the limb crashes
               across the sand and lies there, and then drags itself
               home at walking pace. While it is down it is the only
               part of the creature a polearm can reach, and cutting
               it there is worth more than any amount of rifle fire.
               Punishing the player for the dodge they just made would
               have been the easy version of this fight; rewarding it
               is the fight.

               THE INHALE is why the pit is dangerous to stand near.
               The mouth draws, everything loose on the pan goes with
               it, and so does the player. Reaching the throat is not
               instant death - it is most of a life and a long throw
               back to the rim.

               THE VOLLEY is why the player cannot answer all of that
               from forty metres. It spits the district at them: a fan
               of bone shards on a ballistic arc.

     GORGE     Cut enough tentacles and it recoils - the mouth gapes,
               the gullet comes up, and for eleven seconds it does
               nothing but be a target. The limbs regrow on the way
               out of it.
     SEALING   The leash. The player left, so the mouth sinks, the
               plates come back up, and the pan closes over it at full
               health. Every other boss walks home; this one has
               nowhere to walk, so it goes back down instead.

   A tentacle's own pool lives in `inst.legHp`, which combat.js owns -
   see HITBOX.garner for why six tentacles are declared through the
   same `legs: true` table eight spider legs are.

   ============================================================
   THE SURFACE ROUND, AND THE BUG IT FOUND FIRST

   This creature's stated image is "the value drop from bleached rim
   to wet dark maw, visible from the far side of the arena". It was
   not being drawn. A screen-space id map of the gallery's own
   portrait camera - raycast a grid of pixels, name the mesh each one
   landed on - came back with `sf-garner-shaft` owning the entire
   middle of the frame and `sf-garner-collar` owning about forty
   pixels.

   THE SHAFT WAS OUTSIDE THE MOUTH. It is an unlit bore whose only
   job is to be opaque and near-black BEHIND the gullet, and it was
   built at `craterInner * 1.26` with its top rim four tenths of a
   metre ABOVE the collar's lip - wider than the collar at every
   height they share and standing proud of it. So from a trooper's
   eye line the player did not see a dark ringed mouth at all; they
   saw the shaft's outer wall, and because the shaft's vertex ramp
   puts its PALEST band at the top and the top is also its widest
   ring, the single largest surface on the animal was a smooth khaki
   drum at very nearly the value of the dune behind it. Every note in
   this file about painting the collar black was true and none of it
   was ever on screen.

   The lesson generalises past this boss: a mesh whose comment says
   "behind" has to be checked against a camera, because "behind" is a
   claim about two radii and an offset and nothing in the code
   enforces it. The shaft, the throat floor and the gullet are now all
   sized against the collar's MINIMUM inner radius (its chew bite
   takes it down to 0.68 of nominal, so the constraint is 0.68r, not
   r) and all three sit below the lip.

   WHAT THE ROUND CHANGED, by the brief's axes:

     SURFACE   Four materials now go through `boss-surface.js`, in
               three families, so the animal is not one plastic:
               `bone` on the pan and the shards, `membrane` on the
               collar and its palps, `chitin` on the limbs, and a
               fourth `bone` variant on the teeth overridden into
               ENAMEL - gloss and crest metalness up, because chalk
               and enamel are opposites and the family's whole
               argument is that bone has no specular travel.
     COLOUR    The pan was HALF A STOP BRIGHTER than the sand it is
               set in and the same warm hue. It is now a stop under
               it and neutral, so the separation survives a low sun
               raking across the pan and flattening the value cue.
     MOTION    The mouth breathes, the pit shudders before it draws,
               and the volley has a recoil.
     RESPONSE  Damage drives the kit's crack/scorch/wet response on
               the maw and the limbs, and tusks SNAP and stay snapped.
   ============================================================ */

import { TAU, clamp, clamp01, damp, lerp, makeBus, makeRng } from "saintfall/core.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
import { GARNER_PIT, garnerPitProfile } from "saintfall/terrain.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

export const GARNER_CONFIG = Object.freeze({
  /* THE PIT ITSELF IS TERRAIN, and it is authored in terrain.js next to
     the districts rather than here. Everything in this file is what
     lives at the bottom of it. See the note on GARNER_PIT for why: the
     collision grid, the walking plane and the visible ground all come
     out of `heightAt`, and nothing built at runtime reaches any of
     them - so a pit made of scene geometry is a picture of a hole the
     player walks straight over.

     AND IT IS DRIVEN FROM HERE. `state.open` scales the pit's whole
     displacement through `terrain.setGarnerPitReveal`, so the funnel
     does not exist until this animal opens it: from the far side of the
     pan the Ossuary is unbroken flat ground with a skeleton on it, and
     the collapse the player walks into is the ground itself giving way
     rather than a lid coming off a hole that was always there. */
  pitX: GARNER_PIT.x,
  pitZ: GARNER_PIT.z,
  pitDepth: GARNER_PIT.depth,
  pitRimRadius: GARNER_PIT.rimRadius,

  /* The throat, and the number every other radius here is quoted
     against: the collar flares from 1.08x to 1.30x it, the tusks are
     set on it, and the keep-out wall sits just outside it. */
  craterInner: 7.0,
  /* Where the bone lid over the mouth ends. Inside this radius the pan
     is a plate the creature is under; outside it, ordinary funnel. */
  lidRadius: 12.6,
  /* HOW FAR THE COLLAR'S LIP STANDS ABOVE THE FUNNEL'S FLOOR - and it
     took four attempts, of which three were the same mistake.

     It was 5.0, and the reasoning for that was airtight given what the
     terrain could do at the time: there is no hole in a height field at
     any radius, so a throat level with the ground has ground across the
     bottom of it and reads as a bowl of sand. However much throat you
     want to see down, the mouth has to stand proud of the surface it is
     set into by that much - and five metres of it, out of a twelve-metre
     funnel, still left the whole animal seven metres under the pan.

     THE PROBLEM IS THAT IT IS STILL A PLINTH. Five metres of collar
     standing clear of flat sand is a drum with a crown on it, whichever
     surface the drum is standing on, and every note in this file about
     "a mouth standing on the desert is a tower" was arguing with a
     symptom of the missing hole rather than with the hole.

     GARNER_PIT now carves the throat, so the depth the player looks
     into is terrain. The lip comes down to a hand's width above the
     floor it breaks - the mouth is a rim in the sand with teeth around
     it, and the sand runs up to the teeth. */
  mawStand: 1.0,
  /* How far below the lip the mouth starts, before the ground opens.
     Deep enough that nothing of it shows through the lid's own cracks
     while it is dormant. */
  mawHidden: 15,
  /* Where the animal holds the player off, as a multiple of the throat.
     Just outside the collar's flare: the player stands on the funnel's
     real floor with the mouth's rim at their boots, which is both the
     most dangerous place on the map and the only place a polearm
     reaches the gullet from. See HITBOX.garner's `bodyRadius`, which is
     the other half of that arithmetic. */
  keepOutScale: 1.37,

  aggroRadius: 64,
  breachSeconds: 5.2,
  /* Past this and unengaged long enough it seals and resets - the same
     soft-lock guard every other boss carries. A player who pulls it,
     dies elsewhere and respawns must not come back to a pit frozen
     mid-fight. */
  disengageRadius: 235,
  disengageSeconds: 14,
  sealSeconds: 6.0,
  arenaRadius: 112,

  /* ------------------------------------------------------------
     THE TENTACLES
     ------------------------------------------------------------ */
  arms: 6,
  /* Fifteen metres of limb over fourteen links. The link length is
     what the relaxation pass below preserves, so this is the number
     that decides whether a limp tentacle lying on a dune reads as
     rope (too many links) or as scaffolding (too few). */
  armLength: 18,
  armNodes: 15,
  /* Where a limb is allowed to come up. Never inside the crater - the
     tentacles are the animal's reach, and reach that only extends over
     its own mouth is not reach - and never past the point where it
     could not drag itself home in one retraction. */
  armMinRadius: 15,
  armMaxRadius: 44,
  /* How far from the player it surfaces. Deliberately not AT them: the
     eruption has to be a warning with a second of value in it, and a
     limb that breaks ground under the player's boots is a hit they
     could not have read. The far end of the band is most of the limb's
     own length, so a lash from out there is a genuine reach rather
     than a limb with ten metres of spare rope in it. */
  armSpawnLead: [8, 14],

  eruptSeconds: 0.72,
  /* The telegraph, and the most important duration in the fight. Long
     enough to see a fifteen-metre limb stand up, pick you, and cock
     back; short enough that standing still through it is a decision
     rather than an oversight.
     A QUARTER LONGER than it shipped at, along with the eruption in
     front of it. Erupt plus rear was 1.67s from broken sand to contact
     and only the back half of it was aimed, which read as a limb that
     appeared and hit rather than as one that appeared, chose, and hit -
     the sequence was legible in isolation and not while two others were
     also running. It is now 2.07s, and the locked half of the rear -
     the actual dodge window - goes from 0.47s to 0.61s. */
  rearSeconds: 1.35,
  lashSeconds: 0.34,
  /* Resolved at the CONTACT frame, not at the wind-up. Moving out of
     the arc after the limb has committed is the answer to it, and that
     only works if the test happens when the tip actually arrives. */
  grabRadius: 3.9,
  seizeSeconds: 1.5,
  seizeDamage: 34,
  /* Per second, while held. A seize is not a burst - it is the animal
     spending a second and a half winding you toward its mouth, and the
     cost is the ground you lose. */
  seizeTickDps: 16,
  seizeDragSpeed: 7.5,
  seizeSlowFactor: 0.30,
  /* THE MELEE WINDOW. How long a missed limb lies on the sand before
     it starts pulling itself in, and how fast it goes once it does.
     Both tuned against the player's own walking speed: a limb that
     retracts faster than a trooper runs is a window nobody reaches. */
  limpSeconds: 1.3,
  dragSeconds: 5.4,
  dragSpeed: 3.2,
  /* And what standing in the way of a retraction costs. Getting swept
     by fifteen metres of muscle going home is a shove and a graze, not
     a punish - the limb is not attacking any more. */
  dragSweepDamage: 13,
  /* HOW OFTEN A WAVE GOES OUT, and it is the number that decides how
     many limbs are in the air at once rather than how fast any one of
     them is.

     A full lash runs erupt, rear, strike, lie there and drag home -
     about nine seconds - so the concurrent count is that divided by
     this. At 3.1 the pan carried three overlapping telegraphs at full
     health before a single limb had been cut, and three simultaneous
     reads is not a harder version of one read, it is a different and
     worse mechanic: the player stops dodging limbs and starts running
     from the general direction of the pit. At 3.9 it is two, which is
     what the dodge was designed against. */
  armCadence: 3.9,
  /* How many go at once, at full health and at none. A wounded Garner
     does not hit harder; it hits with more limbs, which is the same
     escalation the Coulter makes on its hunt window.
     The top of the range comes down from three, for the reason above:
     a wave of three on top of the two already up is five, and the fifth
     limb is not a target the player can see, it is one that hits them
     from off screen. Two still doubles the escalation. */
  armVolley: [1, 2],
  /* Once cut, how long the stump takes to push a new limb up. Long
     enough that clearing the pan is real progress, short enough that
     the fight never runs out of the thing it is about. */
  regrowSeconds: 13,

  /* ------------------------------------------------------------
     THE INHALE
     ------------------------------------------------------------ */
  inhaleCadence: 15.5,
  inhaleWindup: 1.6,
  inhaleSeconds: 4.2,
  /* Reach and strength. The pull falls off to nothing at the edge, so
     the rim of the crater is a place you can hold and the middle of it
     is not. */
  inhaleRadius: 46,
  inhalePull: 9.5,
  /* Crossing into the throat while the mouth is drawing. Survivable
     from full health and only just, and it ends with the player thrown
     clear rather than dead in a hole they cannot be seen in. */
  devourDamage: 62,
  devourThrow: 26,
  /* Longer than one draw, so a breath can only swallow once. */
  devourLockout: 5.0,

  /* ------------------------------------------------------------
     THE VOLLEY
     ------------------------------------------------------------ */
  spitCadence: 8.5,
  spitWindup: 0.85,
  spitShards: 7,
  spitSpeed: 34,
  spitSpread: 0.16,
  spitDamage: 19,
  spitBurstRadius: 4.6,
  spitBurstDamage: 11,

  /* ------------------------------------------------------------
     THE GORGE
     ------------------------------------------------------------ */
  /* Tentacles that have to be cut to force the window. Half of six,
     and they do NOT have to be cut at once - severed limbs count until
     the window they bought has been spent. */
  gorgeThreshold: 3,
  gorgeSeconds: 11,
  gorgeGuard: 4.0,

  /* Simulated well past combat.js's own culling horizon, like every
     other boss: a mouth in the ground that stops moving because the
     player walked to the rim of the pan is a mouth that is never doing
     anything when they look back at it. */
  simRange: 620,
});

/* Rendered radii. The HIT radii live in combat.js's HITBOX.garner and
   are deliberately fatter than these - see the note there. */
const ARM_ROOT_R = 1.40;
const ARM_TIP_R = 0.34;
const ARM_SIDES = 8;

/* How far the collar's lip sits above the maw group's own origin. The
   collar mesh is an 11m tube offset so its top edge lands here, and
   `mawY` subtracts it - so "the mouth is level with the floor" is one
   subtraction rather than a constant that has to be re-derived every
   time the collar's proportions change. */
const MAW_TOP = 1.2;

/* 4x26 ORIGINALLY, AND THAT WAS A HUNDRED AND FOUR QUADS FOR THE
   LARGEST SINGLE SURFACE IN EVERY FRAME OF THIS ENCOUNTER.

   The lid is twenty-five metres across and the lens spends most of its
   area on it, so at 4x26 a plate is three metres wide - about a
   hundred and eighty screen pixels at fighting distance, with one
   crack line every hundred and eighty pixels. That is a mosaic, not
   broken ground, and it is why the pan carried almost no edge count
   however it was painted.

   5x40 puts a crack every seventy pixels and costs 200 quads: 800
   vertices, 400 triangles, still ONE draw call, and `poseLid` only
   runs while the lid is actually moving, so a fight in progress pays
   nothing for it at all. Geometry edges rather than shader detail,
   which is the one kind of detail that cannot read as a printed
   pattern. */
const PLATE_RINGS = 5;
const PLATE_SIDES = 40;

const SHARD_MAX = 22;

/* THE COLLAR'S NARROWEST POINT, as a fraction of its nominal radius.

   The collar is chewed rather than turned - a per-vertex radial bite
   of `1 - 0.22|sin 9a| - 0.10 cos 13a` - and that bottoms out at
   0.68. Every piece of geometry that claims to be INSIDE the mouth
   has to fit inside 0.68r, not inside r, or it pokes through the
   collar wall at the twenty-two angles where the bite is deepest.
   Written down once, here, because three separate meshes depend on it
   and the number is not derivable from anything they can see. */
const COLLAR_BITE_MIN = 0.68;

/* THE PALETTE.

   Bone outside, gut inside, and the gut is the only warm thing in the
   district - which is exactly why the mouth reads from the rim of the
   pan at night.

   BONE_PALE WAS 0.86/0.81/0.68 AND THAT WAS THE WHOLE FRAME FAILING.
   Measured off the gallery's own portrait, the pan rendered at about
   linear 0.87 luminance against sand at 0.47: the bone lid was
   brighter than the desert it is set into, in the same warm hue, so
   the Ossuary's boss wore the Ossuary's sand at a HIGHER value than
   the sand did. The art direction asks for the opposite - "slightly
   darker and much rougher, or the pit disappears into its own
   district" - and the reason it must also be a hue change is that a
   low sun raking across a pan erases a pure value cue the moment the
   plates tip. Neutral bone against orange sand survives that; paler
   orange bone against orange sand never did.

   Ratio R:B is 1.16 here against the sand's ~3.0, which is what the
   hue-family metric actually counts. */
const BONE_PALE = [0.415, 0.400, 0.358];
const BONE_DARK = [0.052, 0.049, 0.046];
/* Enamel, and it is a DIFFERENT MATERIAL from the pan, not a brighter
   paint of it. The tusks are the only thing on this animal allowed to
   be bright, and they are the frame's only source of a blown
   highlight - the metric harness reports our bosses at brightPct
   ~0.05 against a Halo pool that always carries some, and a creature
   with no specular hot spot anywhere has no wet, no polish and no
   metal on it. So the tips are near-white and glossy and the roots
   are wet gum, which puts a stop and a half of range inside one
   tooth. */
const ENAMEL_TIP = [0.905, 0.885, 0.815];
const ENAMEL_ROOT = [0.155, 0.140, 0.126];
/* Warm, and deliberately warmer than the collar it is set into: a
   tooth root is the one part of the bone that is INSIDE the light, and
   the emissive mask multiplies a vertex's own colour, so the roots
   have to be painted amber for the gullet to have anything to spill
   onto them. */
const TOOTH_GUM = [0.105, 0.036, 0.024];
/* Wet muscle, and DARK - far darker than these numbers look on paper.

   They are LINEAR ALBEDO under a desert noon. The sun here runs well
   above 1, so a value multiplies rather than caps: an oxblood 0.44 red
   came back at 0.87 in sRGB after lighting and tone mapping, which is
   coral, and eighteen metres of limb rendered as a party streamer. Two
   successive halvings later these read as meat. The rule the district
   sets is that only bone and sand are allowed to be mid-value, so the
   animal has to sit under both - and everything bright about it comes
   from the gullet, or the one warm light source in the Ossuary stops
   being the mouth. */
/* And a second halving on the LIT end this round, for a reason the
   first two did not cover. Photographed mid-lash the limb came back at
   about sRGB 150/110/105 - a pale mauve hose - because the value that
   matters is not the darkest paint on the limb but the brightest, and
   the brightest was carrying two thirds of its surface. The animal now
   gets its range from the muscle rings and the bone-meal dust band
   rather than from a bright base coat. */
const FLESH_DARK = [0.020, 0.007, 0.009];
const FLESH_MID = [0.085, 0.023, 0.024];
const FLESH_LIT = [0.100, 0.027, 0.026];
/* The collar. Deeper and more saturated than the limbs - see the note
   where it is painted. */
const COLLAR_DARK = [0.016, 0.004, 0.007];
const COLLAR_LIT = [0.085, 0.020, 0.026];
const GULLET_HOT = "#ffb347";
const GULLET_DEEP = "#48120a";

export function buildGarner(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = GARNER_CONFIG;
  const rng = makeRng(0x6a17e5);
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  /* THREE HEIGHTS, and keeping them apart is most of what makes this
     creature sit in its hole instead of on it.

     `rimY` is the untouched pan, out past the funnel. `floorY` is the
     bottom of the funnel, which is real terrain nine metres under that
     and the ground the player actually fights from. `lipY` is where the
     mouth's collar breaks that floor - barely, by `mawRecess` - and
     every piece of the animal is measured down from it.

     Sampled off `groundAt` rather than computed from GARNER_PIT's own
     numbers so that the dunes, the pan's crack detail and the funnel
     all agree: whatever the terrain actually did here is what the mouth
     is set into.

     AND THE PIT IS NOT OPEN YET WHEN THIS RUNS. The funnel is a
     displacement scaled by the reveal, and the reveal is zero at load,
     so `groundAt` at the middle of the pan answers with the PAN - which
     is where the mouth would be built if this were one sample rather
     than a sample plus a profile. `garnerPitProfile` supplies the rest:
     the funnel's own drop at the axis, WITHOUT the throat bore, because
     the surface the animal is measured against is the floor the player
     fights from and not the hole in the middle of it. */
  const rimY = groundAt(C.pitX + C.pitRimRadius + 34, C.pitZ);
  const floorY = groundAt(C.pitX, C.pitZ) + garnerPitProfile(0, false);
  const lipY = floorY + C.mawStand;
  /** The funnel's floor at a radius AS IT IS RIGHT NOW - part-way
   *  through the collapse while the lid is falling, finished after. The
   *  lid has to lie on the ground it is made of at every value of
   *  `open`, so this reads the live terrain rather than the profile. */
  const funnelY = (radius) => groundAt(C.pitX + radius, C.pitZ);
  /** How much of the pit exists. The terrain owns the surface; this
   *  module owns the number. Every path that moves `state.open` without
   *  animating it - a restore, a QA phase force, the hard reset - has to
   *  come through here too, or the ground disagrees with the animal
   *  standing in it. */
  const setPitReveal = (v) => ctx.terrain?.setGarnerPitReveal?.(clamp01(v));
  /** Where the mouth's ORIGIN sits for a given openness. Its own
   *  geometry is built so that the collar's lip is `mawTop` above this,
   *  which is what pins the fully-revealed mouth to the funnel floor. */
  const mawY = (open) => lipY - MAW_TOP - C.mawHidden * (1 - clamp01(open));

  const group = new THREE.Group();
  group.name = "garner";
  group.visible = false;
  scene.add(group);

  let inst = null;

  const state = {
    phase: "dormant",     // dormant, breach, feeding, gorge, sealing, dead
    timer: 0,
    /* 0 is a sealed pan, 1 is a fully open pit with the mouth up. Every
       piece of geometry in this module is a function of it, which is
       what makes both the reveal and the leash one animated scalar
       rather than two hand-choreographed sequences. */
    open: 0,
    mawOpen: 0.12,
    armTimer: C.armCadence * 0.7,
    inhaleTimer: C.inhaleCadence * 0.55,
    spitTimer: C.spitCadence * 0.8,
    inhaleFor: 0,
    inhaleWind: 0,
    spitWind: 0,
    gorgeGuard: 0,
    severedCredit: 0,
    disengageFor: 0,
    defeated: false,
    revealed: false,
    releaseCameraAt: undefined,
    seizedBy: -1,
    seizeTick: 0,
    dustTick: 0,
    breathTick: 0,
    /* ------------------------------------------------------------
       WEIGHT, which on a boss that cannot take a step has to come from
       somewhere other than footfalls.

       A pit does not dodge and it does not stagger, so every cue about
       how big this thing is has to be carried by the mouth itself: it
       breathes between attacks, it hauls itself down before it draws,
       and it kicks when it spits. All three are one number added to
       the maw's height, which is free - the group is being positioned
       every frame anyway.
       ------------------------------------------------------------ */
    breath: 0,
    /* The pre-inhale haul. Ground about to be pulled at gets pulled at
       first: the mouth sinks and the pan trembles for the whole
       wind-up, which is the telegraph the player reads. */
    shudder: 0,
    /* And the answer to the volley - a mouth that throws seven bone
       shards at thirty-four metres a second and does not move has not
       thrown them. */
    recoil: 0,
    shakeTick: 0,
    /* 0..1, mirrored onto the surface kit. Held here rather than read
       off `inst` every frame because the kit's uniform must only be
       written when it actually moves - see `syncDamage`. */
    damage: 0,
    brokenTusks: 0,
    /* A lockout after being swallowed, and it is not a nicety. The
       throw lands the player thirty metres out; at a sprint they can be
       back at the collar inside a second, and a draw runs for four - so
       without this a single bad approach could resolve as two or three
       devours in one breath, which is a hundred and fifty points of
       damage for one mistake. One per breath is the intent. */
    devourGap: 0,
  };

  /* Where the player was last frame, for the lash's lead. `player.state`
     does not publish a velocity and this is the only consumer that
     wants one, so it is measured here rather than added there. */
  const lead = { x: 0, z: 0, vx: 0, vz: 0 };

  /* ============================================================
     MATERIALS

     Four, and the fourth was bought deliberately: the pan's own bone,
     the ENAMEL of the tusks, the animal's flesh, and the gullet. Every
     mesh below shares one of them, so the entire boss - crater, mouth,
     teeth, six tentacles - costs five draw calls whatever it is doing.

     The teeth came off the pan's material this round, for one draw
     call, because the surface kit's `bone` family is an argument that
     chalk has NO specular travel and enamel is the exact opposite of
     that. Sharing one material meant either a glossy pan or matte
     teeth, and the tusks are the only place on this animal a highlight
     can blow out.

     Every one of them goes through `applySurface`, which REPLACES the
     `patchMaterial` call rather than adding to it: the patch path
     early-returns on an already-patched material, so calling both
     silently drops the surface and warns.
     ============================================================ */
  const boneMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.88,
    metalness: 0.0,
  });
  boneMat.name = "sf-garner-bone";
  /* Double-sided, for three separate reasons that all land on the same
     material: a tipped plate shows its underside, the void cone is
     looked INTO from the far rim, and the collar is a tube the player
     ends up standing inside the mouth of. */
  boneMat.side = THREE.DoubleSide;
  /* WAVELENGTH IS THE NUMBER THAT MATTERS HERE, and the first pass got
     it wrong in a way worth writing down.

     The kit's families are tuned against the .glb bestiary, where a
     limb is thirty centimetres and a plate is a hand's width. This
     boss is built from slabs THREE METRES across and tusks a metre
     wide, so the family's 0.85m base wavelength put two or three
     gyroid cells on a whole tooth face - and a cell field at that
     scale is not grain, it is leopard print. The gallery came back
     with the tusks and the pan wearing what a reviewer would call a
     texture map, which is precisely the tell this programme exists to
     remove.

     Two thirds, not a tenth, and finding the floor took a round. At
     0.22m the base octave was eleven screen pixels at fighting
     distance and the two that touch the NORMAL were four and one -
     sub-pixel, therefore invisible, therefore contributing nothing but
     shimmer. The measured detail went DOWN. 0.55m puts the base at
     about 35 pixels and the score octave at four, which is where a
     laplacian can actually see it.

     AND THE RELIEF AMPLITUDES SCALE WITH IT. Slope is amplitude times
     wavenumber, so shortening a wavelength without touching `score`
     multiplies the tilt by the same factor - dropping the family's
     0.85m to 0.22m and keeping 0.0018 took a 6-degree bevel to 23
     degrees, which is where the "printed lattice" look came from. The
     numbers below hold the slope at the family's, whatever the
     wavelength is.

     `mottle` stays LOW whatever else moves. It rides the coarsest
     octave, and the coarsest octave is the one that reads as leopard
     spots rather than as grain. */
  applySurface(boneMat, atmos, "bone", {
    rim: 1.05, glitter: 0.12, bio: 0.9,
    wavelength: 0.55, wear: 0.13, cavity: 0.34, mottle: 0.06,
    score: 0.00125, pore: 0.00072,
  });

  /* ENAMEL. The `bone` family with its two defining numbers inverted,
     and the overrides are the whole point of the material existing:
     `gloss` (the roughness spread) goes from the table's narrowest to
     wider than chitin's, and `sheen` - crest metalness - comes off
     zero so the highlight takes the tooth's own colour and TRAVELS as
     the camera moves. A dielectric spec at F0 0.04 on a matte tooth is
     invisible at any range; this is the frame's blown pixel. */
  /* WET FROM A LOW BASE ROUGHNESS, NOT FROM A WIDE SPREAD, and that
     distinction cost two gallery rounds to find.

     The kit's `gloss` is a roughness MODULATION riding the coarse
     octave, and on a curved surface under a low hard sun a spread of
     plus or minus 0.16 does not read as breakup - it reads as
     alternating bright and dark patches at the wavelength of the
     field, which on the tusks and the limbs photographed as tiger
     camouflage. It was mistaken for the albedo terms twice and neither
     `cavity` nor `mottle` was ever the cause.

     So the spread comes down to a third and the CENTRE comes down with
     it. Same amount of wet, carried by a material property instead of
     by a pattern. */
  const toothMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.30,
    metalness: 0.0,
  });
  toothMat.name = "sf-garner-enamel";
  toothMat.side = THREE.DoubleSide;
  applySurface(toothMat, atmos, "bone", {
    rim: 0.92, glitter: 0.45, bio: 1.0,
    /* Finer still than the pan: a tusk is the smallest hard surface on
       the animal and the one the lens spends its centre on. */
    /* AND ALMOST NO ALBEDO VARIATION, which is the correction the
       gallery forced. Enamel is the one surface on this animal that is
       genuinely smooth - what makes a tooth read is a highlight
       rolling along it, not grime in it - and at the pan's own cavity
       the tusks came back wearing a visible regular lattice, which is
       the exact "that is a texture map" tell this programme exists to
       remove. Cavity and mottle go to a third of the pan's; `gloss`
       and `sheen`, which are the specular terms, stay. */
    wavelength: 0.45,
    gloss: 0.16, sheen: 0.14, wear: 0.10, cavity: 0.20, mottle: 0.04,
    score: 0.00102, pore: 0.00058,
    /* And the crack-ember all but off. It is a FIRE colour, and this
       animal has no fire in it - what the kit's damage term is being
       borrowed for here is the wet dark break, not a glow. Left at the
       family's 0.18 a badly hurt Garner came back with orange sparks
       scattered over the collar, which reads as glitter. */
    ember: 0.06,
  });

  const fleshMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.44,
    metalness: 0.0,
  });
  fleshMat.name = "sf-garner-flesh";
  /* Smooth-shaded, and it is the one thing in SAINTFALL above the sand
     that is. Everything faceted in this game is MADE - masonry, plate,
     chitin. Wet muscle is the exception the rule exists to point at,
     and flat-shading a tentacle turned fifteen metres of limb into a
     folded paper snake. */
  /* `bio` low, and it was 2.4. The emissive mask multiplies the
     surface's OWN colour, so a strong one on a limb whose alpha
     channel carries sucker rings up its whole underside does not add
     glowing detail - it adds two and a half times the diffuse back on
     top of itself, and fifteen metres of oxblood muscle came out as a
     pale pink streamer in daylight. Enough to make the rings read at
     night, and not enough to be visible against the sun. */
  /* And the RIM low too, for a related reason. A strong rim term on a
     ring of thin outward-splayed flaps catches on every one of them at
     every angle, which is not a highlight - it is a second, paler
     albedo. The collar and its fringe came back the colour of the sand
     they are set in with the rim at the tentacles' own 1.35. */
  /* `chitin`, not `membrane`, and the two are next to each other in the
     kit for a reason. Membrane is the wet-sac family: a 2.4m
     wavelength and almost no grain, because fine detail on a swollen
     gland stops it reading as wet. That is the COLLAR. A limb is the
     other thing - chitin over sinew, per the art direction - and what
     it needs is the crease and the pore that a plate has, plus
     chitin's small crest metalness, which turns an oxblood albedo into
     an oxblood-coloured highlight instead of a white one.

     `score` is pulled under the family default. The kit's own note
     records that the ceiling on relief is set by the THINNEST limb on
     an animal, not by its widest plate, and this limb tapers to a
     34cm tip - a cell field wrapped that tight reads as braided cord
     long before it reads as muscle. */
  applySurface(fleshMat, atmos, "chitin", {
    rim: 0.55, glitter: 0, bio: 0.85,
    /* Half the family's, for the same reason the pan's is: this limb
       is 2.8 metres thick at the root, so chitin's 1.15m cells sat
       three to a diameter and eighteen metres of tentacle photographed
       as a python. */
    wavelength: 0.70,
    /* WEAR ALL BUT OFF, unlike the bone. Wear is the kit's "rubbed
       pale and desaturated" term and it keys on the facet pointing UP,
       which on a limb standing fifteen metres out of the sand is its
       whole sunward face. It is a BONE cue - a rubbed bone edge goes
       chalky - and applied to wet muscle it took the one red object in
       an orange district to a neutral mid grey, which is the exact
       failure the separation table exists to prevent. */
    wear: 0.03,
    score: 0.00134, pore: 0.00066, cavity: 0.28, gloss: 0.13,
    mottle: 0.06, ember: 0.10,
  });

  /* THE COLLAR'S OWN MATERIAL, and it exists because of a measurement
     rather than a preference.

     The collar reads at 16m against sunlit sand, and at that range the
     atmosphere patch's sky-tinted rim is ADDITIVE and independent of
     albedo. Painted black and photographed, the ring came back the same
     khaki as the dune behind it - so no amount of darkening the paint
     was ever going to make it read as meat. What the rim cannot flatten
     is FACETING: flat shading gives every muscle segment its own normal
     and therefore its own rim strength, and the ring goes from a smooth
     cone washed to one tone into alternating lit and shadowed staves.
     The rim is then dropped to a third of the limbs', because on a
     surface this dark it is the whole of what is being seen. */
  /* Roughness comes DOWN from 0.66 to the membrane family's own centre.
     The note above is about stopping the collar reading pale, and it
     was right, but the cure it reached for - kill every reflective
     term on the surface - also removed the only cue that says WET. A
     black matte ring is a rubber gasket. What separates meat from
     rubber at 16m is a highlight that moves across it, which the kit
     supplies as a roughness SPREAD around this centre rather than as a
     lower number, so the dark stays dark between the wet spots. */
  const collarMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.44,
    metalness: 0.0,
  });
  collarMat.name = "sf-garner-collar-mat";
  applySurface(collarMat, atmos, "membrane", {
    rim: 0.34, glitter: 0, bio: 1.1,
    /* The collar's staves are about 1.3m wide, so the family's 2.4m
       wavelength put less than one cell on each of them - which is not
       a surface, it is a gradient across the whole ring. */
    wavelength: 1.20,
    score: 0.00050, pore: 0.00010,
    gloss: 0.18, cavity: 0.24, mottle: 0.06, ember: 0.14,
  });

  /* ============================================================
     THE CRATER

     Seventy-eight plates of pan, each hinged on its own OUTER edge.

     One geometry, rewritten in place. The alternative - a mesh per
     plate - is seventy-eight draw calls for a thing that is only
     moving for five seconds of the encounter, and the alternative to
     THAT - a shader that derives the motion from `open` - cannot tell
     this module where a plate's lip ended up, which is where the dust
     has to be thrown from.

     Rewritten only while `open` is actually changing. A sealed pan and
     a fully open pit both cost nothing.
     ============================================================ */
  const plateCount = PLATE_RINGS * PLATE_SIDES;
  const plates = [];
  const crater = (() => {
    const verts = plateCount * 4;
    const position = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = [];
    for (let p = 0; p < plateCount; p += 1) {
      const b = p * 4;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    for (let ring = 0; ring < PLATE_RINGS; ring += 1) {
      /* Bands from the moat outward. The inner band falls furthest and
         first, which is what makes the collapse read as something
         pulling from underneath rather than as a lid being removed. */
      /* Bands from the middle out to the lid's edge. Ring 0 is over the
         mouth itself and falls into it; the outer bands hinge and stay
         as the broken collar of pan around the hole. */
      const r0 = (ring / PLATE_RINGS) * C.lidRadius;
      const r1 = ((ring + 1) / PLATE_RINGS) * C.lidRadius;
      for (let s = 0; s < PLATE_SIDES; s += 1) {
        const a0 = (s / PLATE_SIDES) * TAU;
        const a1 = ((s + 1) / PLATE_SIDES) * TAU;
        /* Cracks are not evenly spaced and plates are not identical
           trapezoids. A per-plate radial wobble is the whole difference
           between broken ground and a dartboard. */
        const wob0 = 0.90 + rng() * 0.20;
        const wob1 = 0.90 + rng() * 0.20;
        const idx = plates.length;
        const b = idx * 4;
        plates.push({
          /* The two OUTER corners are the hinge; the two inner ones
             swing. Stored in polar so the swing is a couple of
             multiplies rather than a matrix per plate per frame. */
          a0, a1,
          rIn: r0, rOut: r1,
          wob0, wob1,
          /* Staggered, so the ring does not fall as one piece, and
             biased inward: the plates nearest the throat go first. */
          delay: clamp01((1 - ring / PLATE_RINGS) * 0.28 + rng() * 0.34),
          /* Per-plate tip on top of the funnel profile, and it is what
             makes this broken ground rather than a smooth cone. Signed,
             so adjacent slabs disagree about which way they fell. */
          /* Kept UNDER the funnel's own dip on purpose. Disagreement
             larger than the slump it sits on scatters the ring into
             unrelated shards lying about on open sand; smaller, and it
             is a single collapsed surface with broken slabs in it. */
          tilt: (rng() - 0.5) * 1.9,
          /* THE TWIST, applied +/- to a plate's two flanks so no slab
             stays level across its own width. This is what actually
             sells broken ground: a ring of quads that each tip as a
             unit still reads as a machined iris, and the cracks that
             open between neighbours when their shared edge disagrees
             are most of what the eye reads as "shattered". */
          twist: (rng() - 0.5) * 1.5,
          twistOut: (rng() - 0.5) * 0.7,
          /* And a little inward creep, because a slab that tips into a
             hole also slides toward it. */
          slide: 0.4 + rng() * 1.4,
          /* A dome BEFORE the drop. Ground about to give way lifts
             first; without this the pan simply switches from flat to
             broken and the eye files it as a cut rather than a
             collapse. */
          heave: 0.35 + rng() * 0.55,
          /* THE SLABS THAT LEVER UP rather than falling in, and only on
             the outer band - the ring of broken pan left standing
             around the hole once the middle has gone. Ground that gives
             way does not only sink; it tips slabs at the break line,
             and that jagged ring is what tells the player from the far
             rim that the funnel has opened.

             Deliberately mostly gaps. None of this geometry is in the
             collision grid - that is built once, from the authored
             world - so a solid raised lip would be a wall they walk
             through, and the gaps are where they walk in. */
          rearUp: ring === PLATE_RINGS - 1 && rng() < 0.45
            ? 1.4 + rng() * 2.6 : 0,
          /* Whether this slab goes into the mouth or stays at the edge
             of it. The inner bands are directly over the animal and
             have nothing left to rest on. */
          falls: r0 < C.craterInner * 1.30,
          base: b,
          lipX: 0, lipY: 0, lipZ: 0,
        });
        /* Bone, and DARKENING HARD toward the middle. A lid painted at
           pan brightness throughout reads as pale shards lying about on
           open sand; the inside of a hole being darker than the outside
           is most of what makes it legible as a hole at all. */
        const shade = lerp(0.20, 1.0, ring / Math.max(1, PLATE_RINGS - 1));
        /* AND ONE SLAB IN FOUR IS STAINED, hard, whatever ring it is
           in. The lid is the roof of a mouth: some of these plates
           have been inside one. A smooth radial ramp from dark centre
           to pale edge is a gradient, and a gradient has no local
           contrast anywhere in it - the metric harness reads the pan as
           one flat mid-band surface and so does the eye. Discontinuous
           per-slab value is what makes a hundred and four quads read as
           broken ground instead of as a dartboard, and it is the
           cheapest local contrast available: it costs four vertex
           writes that were happening anyway. */
        const stain = rng() < 0.26 ? 0.22 + rng() * 0.26 : 1;
        for (let v = 0; v < 4; v += 1) {
          const inner = v === 0 || v === 3;
          const k = (b + v) * 4;
          const t = shade * stain * (inner ? 0.6 : 1) * (0.78 + rng() * 0.44);
          colour[k] = lerp(BONE_DARK[0], BONE_PALE[0], t);
          colour[k + 1] = lerp(BONE_DARK[1], BONE_PALE[1], t);
          colour[k + 2] = lerp(BONE_DARK[2], BONE_PALE[2], t);
          colour[k + 3] = 0;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-crater";
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, geo, position };
  })();

  /**
   * Lay every slab of the lid for the current `open`.
   *
   * Closed, the lid IS the floor of the funnel: each slab sits on the
   * terrain at its own radius, and the pit reads as an empty sand
   * crater with a plate of fused bone at the bottom.
   *
   * Open, the middle of it is gone - the inner bands drop into the
   * mouth and keep going until the terrain occludes them - and the
   * outer band is left tipped and levered around the hole.
   */
  function poseLid() {
    const p = crater.position;
    for (const plate of plates) {
      /* Each slab has its own slice of the opening. `t` is how far THIS
         one has gone, which is why the lid comes apart progressively
         instead of hinging as one disc. */
      const t = clamp01((state.open - plate.delay) / (1 - plate.delay + 1e-4));
      const ease = t * t * (3 - 2 * t);
      // The dome, which peaks at a quarter open and is gone by half.
      const swell = Math.sin(clamp01(t / 0.45) * Math.PI) * plate.heave
        * (1 - clamp01((t - 0.4) / 0.35));
      const pull = plate.slide * ease;
      const inR = Math.max(0.4, plate.rIn - pull);
      const write = (v, angle, radius, y) => {
        const k = (plate.base + v) * 3;
        p[k] = C.pitX + Math.cos(angle) * radius;
        p[k + 1] = y;
        p[k + 2] = C.pitZ + Math.sin(angle) * radius;
      };
      /* A slab that falls goes ALL the way. There is nothing under the
         middle of this lid but the animal, so a plate that only slumped
         a couple of metres would hang in the mouth like a shelf; it
         drops past the terrain that is drawn around it and is gone. */
      const drop = plate.falls ? -C.mawHidden * 1.4 * ease : 0;
      const outY = funnelY(plate.rOut) + swell * 0.35
        + (plate.rearUp - (plate.falls ? C.mawHidden * 1.4 : 0)) * ease;
      const inY = funnelY(inR) + swell + drop + plate.tilt * 0.5 * ease;
      const tw = plate.twist * ease;
      const twOut = plate.twistOut * ease;
      write(0, plate.a0, inR * plate.wob0, inY + tw);
      write(1, plate.a0, plate.rOut * plate.wob0, outY + twOut);
      write(2, plate.a1, plate.rOut * plate.wob1, outY - twOut);
      write(3, plate.a1, inR * plate.wob1, inY - tw);
      // The lip, remembered for the dust that falls off it.
      const mid = (plate.a0 + plate.a1) * 0.5;
      plate.lipX = C.pitX + Math.cos(mid) * inR;
      plate.lipY = inY;
      plate.lipZ = C.pitZ + Math.sin(mid) * inR;
    }
    crater.geo.attributes.position.needsUpdate = true;
    crater.geo.computeVertexNormals();
    crater.geo.computeBoundingSphere();
    /* The rubble collar outside the lid goes with it. Declared below
       this function and called from it, because "the ground is moving"
       is one event and the two meshes lying on that ground should never
       be posed from two different places. */
    spoil.pose(state.open);
  }

  /* ------------------------------------------------------------
     THE SPOIL

     Broken bone lying on the funnel between the lid and the pan.

     This is an EDGE DENSITY buy and it is worth saying so plainly.
     The gallery's portrait of this boss measured 4.40% of pixels
     carrying an edge, against a Halo pool that runs 8.6 to 20.1 - the
     only frame in the round that fell outside the pool's full range,
     not merely its central band. The reason is visible the moment you
     look: the animal sits in the middle of a nine-metre sand cone,
     and a sand cone is the single smoothest surface the renderer can
     produce. No amount of surface shader helps, because there is
     nothing there to shade.

     A hundred and forty chips of the lid, thrown out of the hole when
     it opened and never cleared away, put small hard edges in exactly
     the annulus the lens spends most of its frame on. One merged
     buffer, one draw call.

     Cheap in the honest sense too: each chip is a four-vertex wedge,
     which is 560 vertices for the whole ring.

     AND IT RIDES THE GROUND DOWN. It used to be pinned once and never
     touched again, which was correct while the funnel was permanent.
     Now the sand these chips are lying on sinks up to twelve metres
     under them during the collapse, so each one remembers where it sits
     on the sealed pan and how far its own patch of ground has to fall,
     and `poseLid` slides it - a chip on ground that is giving way goes
     with the ground. Three hundred vertical writes while the pit is
     actually moving, and nothing at all either side of that.
     ------------------------------------------------------------ */
  const spoil = (() => {
    const N = 300;
    const perChip = 4;
    const position = new Float32Array(N * perChip * 3);
    const colour = new Float32Array(N * perChip * 4);
    /* Per chip: where its ground is with the pan shut, how far that
       ground drops, and the four local heights above it. Kept apart
       from `position` so the slide is an add rather than a re-derive. */
    const restY = new Float32Array(N);
    const dropY = new Float32Array(N);
    const localY = new Float32Array(N * perChip);
    const index = [];
    for (let i = 0; i < N; i += 1) {
      const b = i * perChip;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3,
        b, b + 3, b + 1, b + 1, b + 3, b + 2);
      const a = rng() * TAU;
      /* Concentrated near the lid and thinning outward, because that
         is where a collapse throws its spoil - and because the ring
         has to stop before the pan or it reads as litter rather than
         as the edge of a hole. */
      /* PULLED IN HARD, twice. Spread over the whole funnel out to
         the pan, two hundred chips read as confetti dropped on the
         set - spoil belongs at the BREAK LINE, thrown a few metres by
         the collapse and no further. A tight rubble collar around the
         lid is also denser per square metre, which is what the edge
         count actually wanted. */
      const r = C.lidRadius - 2 + Math.pow(rng(), 1.4) * (C.pitRimRadius - C.lidRadius);
      const cx = C.pitX + Math.cos(a) * r;
      const cz = C.pitZ + Math.sin(a) * r;
      /* Both ends of this chip's travel. `groundAt` answers with the
         SEALED pan here - the reveal is zero until the encounter starts
         - and the profile is how far the funnel takes that patch down.
         With the throat, unlike `floorY`: a chip is dressing and may lie
         wherever the sand ends up, including on the bore's own slope. */
      const cy = groundAt(cx, cz);
      restY[i] = cy;
      dropY[i] = garnerPitProfile(r);
      /* MOSTLY GRAVEL. The first field was slabs half a trooper wide
         and two hundred of them read as confetti dropped on the set;
         the same count at bone-chip size reads as what the floor of an
         ossuary is made of, and small hard things are worth far more
         per square metre to an edge count than large flat ones. */
      const size = 0.26 + Math.pow(rng(), 2.4) * 1.5;
      const yaw = rng() * TAU;
      const cw = Math.cos(yaw);
      const sw = Math.sin(yaw);
      const set = (v, lx, ly, lz) => {
        position[(b + v) * 3] = cx + lx * cw - lz * sw;
        position[(b + v) * 3 + 1] = cy + ly;
        position[(b + v) * 3 + 2] = cz + lx * sw + lz * cw;
        localY[b + v] = ly;
      };
      /* A wedge lying on its side, half buried. Three of the four
         vertices sit at or under the sand, so what stands out of the
         ground is one canted plate - which is what a slab of broken
         bone in a dune actually shows. */
      set(0, -size, -0.32, -size * 0.5);
      set(1, size * (0.6 + rng() * 0.7), -0.28, -size * (0.3 + rng() * 0.5));
      /* Only the fourth vertex clears the sand, and only by a third of
         the chip's own length. At two thirds the field read as a
         hundred and forty little pyramids standing to attention, which
         is scatter dressing; a slab canted out of a dune is spoil. */
      set(2, size * (0.2 + rng() * 0.5), size * (0.16 + rng() * 0.34), size * 0.4);
      set(3, -size * 0.7, -0.36, size * (0.5 + rng() * 0.6));
      /* Painted off the pan's own palette but a shade under it, and
         with a wide per-chip jitter. A field of identical-value chips
         is a texture; a field with a stop of spread in it is rubble. */
      const shade = 0.30 + Math.pow(rng(), 1.4) * 0.72;
      for (let v = 0; v < perChip; v += 1) {
        const k = (b + v) * 4;
        const t = shade * (v === 2 ? 1.18 : 0.72);
        colour[k] = lerp(BONE_DARK[0], BONE_PALE[0], t);
        colour[k + 1] = lerp(BONE_DARK[1], BONE_PALE[1], t);
        colour[k + 2] = lerp(BONE_DARK[2], BONE_PALE[2], t);
        colour[k + 3] = 0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-spoil";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    /* The chips fall twelve metres out of this sphere and it was fitted
       to them lying on flat sand. Cheaper to stop asking than to refit
       it every frame - the whole boss is culled by `simRange` anyway. */
    mesh.frustumCulled = false;
    group.add(mesh);
    /** Slide every chip to where its own ground has got to. Normals are
     *  untouched on purpose: a chip translates as a rigid body, so the
     *  four vertices move together and the facet it presents to the sun
     *  is the same one it presented on the pan. */
    function pose(open) {
      for (let i = 0; i < N; i += 1) {
        const y = restY[i] + dropY[i] * open;
        const b = i * perChip;
        for (let v = 0; v < perChip; v += 1) {
          position[(b + v) * 3 + 1] = y + localY[b + v];
        }
      }
      geo.attributes.position.needsUpdate = true;
    }
    return { mesh, pose };
  })();

  /* The maw's own group, declared HERE rather than beside the mesh
     that first fills it, because the shelf below is a child of it and
     is built two blocks from now. Everything that has to stay inside
     the mouth while the mouth is moving has to ride this. */
  const maw = new THREE.Group();
  maw.name = "sf-garner-maw";
  group.add(maw);

  /* ------------------------------------------------------------
     THE SHAFT

     What the lid falls into: an unlit bore running down inside the
     collar, below the terrain the mouth is set into.

     It is not the hole - the mouth is the hole. This is what makes the
     mouth READ as one: something opaque and nearly black behind the
     gullet's additive light, so the throat has a bottom the eye cannot
     find rather than a bright tube hanging in front of the far wall of
     the funnel.
     ------------------------------------------------------------ */
  /* HOW FAR THE BORE'S RIM SITS UNDER THE COLLAR'S LIP. Enough that a
     camera at the far rim of the pan, which looks slightly DOWN into
     the funnel, never sees the rim itself - only the dark inside it. */
  const SHAFT_RECESS = 2.4;

  const shaft = (() => {
    const depth = 26;
    /* SIZED AGAINST THE COLLAR'S NARROWEST POINT, and that constraint
       is the whole of this round's opening bug.

       This was `craterInner * 1.26` with its top rim 0.4m ABOVE the
       lip. The collar it is supposed to hide inside is 1.08r at the
       lip - so the bore was 17% WIDER than the mouth and standing
       proud of it, and an id map of the gallery's portrait frame found
       this mesh owning the middle of the picture while the collar
       owned about forty pixels. The pale khaki drum every reviewer
       called "the mouth" was the inside of a hole, drawn from outside,
       at its brightest ring.

       0.70 rather than 1.08 because the collar is CHEWED: the bite
       takes its inner radius down to 0.68 of nominal at twenty-two
       angles, and a bore sized to the nominal radius pokes through the
       wall at every one of them. */
    const geo = new THREE.CylinderGeometry(
      C.craterInner * 1.08 * COLLAR_BITE_MIN * 0.95,
      C.craterInner * 0.30, depth, 20, 3, true);
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      // Darker downward, so the eye reads depth from the walls alone
      // even when the gullet is shut and giving off nothing.
      const y = geo.attributes.position.getY(i);
      const t = clamp01((y + depth * 0.5) / depth);
      /* An order of magnitude under the old ramp's top. It no longer
         has to survive being LOOKED AT in daylight - it is behind the
         teeth now - so it can be what its own comment always claimed:
         a bottom the eye cannot find. */
      const shade = 0.004 + Math.pow(t, 2.6) * 0.022;
      colour[i * 4] = shade * 1.00;
      colour[i * 4 + 1] = shade * 0.88;
      colour[i * 4 + 2] = shade * 0.72;
      colour[i * 4 + 3] = 0;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-shaft";
    // Its rim under the collar's lip, everything else below that.
    mesh.position.set(C.pitX, lipY - SHAFT_RECESS - depth * 0.5, C.pitZ);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  })();

  /* ------------------------------------------------------------
     THE COLLAR'S PROFILE, DEFINED ONCE

     Three meshes have to agree about the shape of the inside of this
     mouth - the collar itself, the shelf below it and the bore behind
     that - and until this round they each carried their own guess.
     One of those guesses was 17% too wide and hid the animal (see the
     header). A shape that three meshes depend on is not a constant
     any of them may own.
     ------------------------------------------------------------ */
  const COLLAR_H = 11;
  /** The chew. Deep enough to facet hard under flat shading: a shallow
   *  bite on a 36-segment tube is a barrel with grain, this is a ring
   *  of separate swallowing muscles that happen to be joined. */
  const collarBite = (a) => 1 - 0.22 * Math.abs(Math.sin(a * 9))
    - 0.10 * Math.cos(a * 13);
  /** Nominal collar radius `drop` metres below the lip. */
  const collarR = (drop) => lerp(C.craterInner * 1.08, C.craterInner * 1.30,
    clamp01(drop / COLLAR_H));

  /* ------------------------------------------------------------
     THE SHELF AT THE BOTTOM OF THE VISIBLE THROAT

     A black annulus laid across the gap between the collar's inner
     wall and the bore inside it.

     It is the last consequence of the terrain being a height field.
     There is no hole in the ground at any radius, so the sand runs
     straight across the inside of the mouth - and without this the
     player looking down a lit gullet sees, five metres in, a nicely
     shaded dune.

     AN ANNULUS AND NOT A DISC, which is the difference between this
     and what it replaced. A disc wide enough to cover the gap also
     caps the bore, and the gullet's own glowing cone runs fourteen
     metres down THROUGH where that disc would be - so a disc turned
     the throat into a two-and-a-half-metre dish. The ring covers the
     sand and leaves the hole.

     Its outer edge carries the collar's own bite rather than being a
     circle, because a circle inscribed in a chewed tube either shows
     a crescent of sand at the wide angles or pokes through the wall at
     the narrow ones. There is no radius that does neither.
     ------------------------------------------------------------ */
  const throatFloor = (() => {
    const N = 30;
    /* JUST UNDER THE LIP, and it used to be under the SHAFT'S RIM.
       That was the right depth while the mouth stood five metres proud
       of flat sand: everything below the lip was air, so the shelf could
       be set as deep as the bore and still have nothing behind it. With
       the lip a hand's width above the floor, 2.45m down is 1.45m BELOW
       the funnel - and a black plate under the ground it is meant to
       hide is a black plate with sand on top of it.
       Held at the lip instead, where the sand it covers is between two
       and seven metres beneath it whatever the sample grid does with the
       bore's edge. The depth the player looks into is the bore now; this
       is only the lid on the last of the sand. */
    const drop = 1.05;
    const inner = C.craterInner * 1.08 * COLLAR_BITE_MIN * 0.90;
    const position = new Float32Array(N * 2 * 3);
    const colour = new Float32Array(N * 2 * 4);
    const index = [];
    for (let i = 0; i < N; i += 1) {
      const a = (i / N) * TAU;
      const j = (i + 1) % N;
      const rOut = collarR(drop) * collarBite(a) * 0.99;
      position[i * 6] = Math.cos(a) * inner;
      position[i * 6 + 1] = 0;
      position[i * 6 + 2] = Math.sin(a) * inner;
      position[i * 6 + 3] = Math.cos(a) * rOut;
      position[i * 6 + 4] = 0;
      position[i * 6 + 5] = Math.sin(a) * rOut;
      index.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
      for (let v = 0; v < 2; v += 1) {
        const k = (i * 2 + v) * 4;
        colour[k] = 0.005;
        colour[k + 1] = 0.004;
        colour[k + 2] = 0.003;
        colour[k + 3] = 0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-throat-floor";
    /* Rides the MAW, not the world, so it stays inside the collar the
       whole way up out of the shaft. Laid on a disc pinned to the
       funnel floor it was correct at `open` 1 and a black plate
       hanging in mid-air at every value between. */
    mesh.position.y = MAW_TOP - drop;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    maw.add(mesh);
    return mesh;
  })();

  /* ============================================================
     THE MAW

     A collar, two counter-set rings of tusks, and a gullet, all riding
     one group whose height is the reveal: fifteen metres down the shaft
     at `open` 0, and at `open` 1 with its lip level with the floor of
     the funnel.

     LEVEL WITH IT, AND NEVER ABOVE. An earlier build stood the collar
     five metres proud of the sand because it made a better silhouette
     from across the pan, and it made the wrong creature: a mouth
     standing on the desert is a tower, and this one is a pit. The whole
     read of the animal is that the ground opens and the mouth is
     already down there. `mawRecess` is the only offset it gets, and it
     is a hand's width DOWN.

     What replaces the silhouette is the funnel: a nine-metre sand cone
     carved into the terrain (see GARNER_PIT) that the player has to
     walk into, with real ground under them the whole way.

     (The group itself is declared further up, above the shelf that
     rides it.)
     ============================================================ */

  /* THE COLLAR: a ring of wet muscle the tusks are set into.
     Built once, never re-posed - it is the one rigid thing here and
     it is what gives the tentacles and the tusks a scale to read
     against.

     FLESH, not bone, and that one decision does more for this animal
     than any amount of geometry did. A bone collar under bone teeth on
     a bone-white pan is a single pale mass with no silhouette: the
     first build's mouth read as an architectural drum with a crown on
     it. A dark ring of muscle puts the one thing in the district that
     is not bone at the centre of the district that is nothing else,
     and the tusks stop being a fence the moment they have something to
     be set INTO. */
  {
    /* TALL, and plunging well below ground level. Two jobs, and the
       second one is not aesthetic: the gullet is an additive tube that
       runs fourteen metres down, and any stretch of it not enclosed by
       opaque geometry draws a bright ring of throat-light across the
       outside of the animal. A short collar left a two-metre band of
       exactly that hanging in the air under the mouth. Enclosing the
       whole visible run of the gullet fixes it, and turns the mouth
       from a bowl on the sand into something on a stalk. */
    const height = COLLAR_H;
    const geo = new THREE.CylinderGeometry(C.craterInner * 1.08,
      C.craterInner * 1.30, height, 36, 3, true);
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < count; i += 1) {
      /* Chewed, not turned. A perfect cylinder around a mouth is a
         drainpipe; a per-vertex radial bite deep enough to facet under
         flat shading makes it a ring of fused plate that something
         grew. `collarBite` rather than the expression, so the shelf
         inside cannot drift out of agreement with the wall it is
         inscribed in. */
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const bite = collarBite(a);
      pos.setX(i, x * bite);
      pos.setZ(i, z * bite);
      const t = clamp01(pos.getY(i) / height + 0.5);
      const shade = lerp(0.05, 1.0, Math.pow(t, 1.6))
        * (0.85 + Math.abs(Math.sin(a * 5)) * 0.2);
      /* DARKER THAN THE TENTACLES, and by a lot. This surface is lit by
         a low warm sun bouncing off orange sand on every side of it, and
         at the tentacles' own oxblood it came back tan - a wooden barrel
         set in a dune. The rule that fixes it is not a hue change: it is
         that the only things in this district allowed to be MID-VALUE
         are bone and sand, so the animal has to sit below both. */
      colour[i * 4] = lerp(COLLAR_DARK[0], COLLAR_LIT[0], shade);
      colour[i * 4 + 1] = lerp(COLLAR_DARK[1], COLLAR_LIT[1], shade);
      colour[i * 4 + 2] = lerp(COLLAR_DARK[2], COLLAR_LIT[2], shade);
      /* Only the lip catches the gullet's own light - but a WIDER band
         of it than the seventh power gave, because from the funnel
         floor the lens sits four degrees above the rim and everything
         the seventh power lit was over the horizon of the mouth. This
         is the warm line that reads between the tusks from outside. */
      colour[i * 4 + 3] = Math.pow(t, 4.5) * 0.9;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, collarMat);
    mesh.name = "sf-garner-collar";
    // Its lip a metre above the tooth roots, its foot deep in the shaft.
    mesh.position.y = -(height * 0.5) + 1.2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    maw.add(mesh);
  }

  /* ------------------------------------------------------------
     THE FRINGE

     A ring of short muscular palps hanging around the outside of the
     collar, splayed onto the sand it rises from.

     Purely a silhouette job, and the cheapest one available: a
     truncated cone is a truncated cone however it is shaded, and from
     the pit floor - which is where the whole fight happens - the mouth
     was reading as a drum somebody had left there. Twenty flaps breaking
     its bottom edge turn the join between animal and ground from a rim
     into something that grew out of it.

     THEY HAVE MOVED UP TO THE LIP, and flattened. They used to be
     rooted two to four metres down the collar's flank and hang onto the
     sand below - which worked when there were five metres of collar
     standing clear of it. There is now one, so every one of those roots
     is under the funnel's floor and the whole ring was invisible. They
     are re-rooted just beneath the lip and splayed OUT rather than down,
     lying across the sand between the mouth and the tooth ring set into
     it. Same job, done from the only side of the join that is still
     above ground.

     AND, IN THE SAME BUFFER, THE INNER PALPS.

     The art direction asks for a throat "ringed with translucent soft
     tissue", and until this round there was none: the gullet's light
     arrived out of a bare tube, so the one saturated element in the
     frame had no material to sit on and read as a lamp in a bucket
     rather than as something lit from inside a body. Sixteen short
     palps hang inward over the throat, high vertex-alpha so the bio
     mask throws the gullet's own colour back off them, and their tips
     end well inside the tusk ring so they are backlit rather than
     silhouetted.

     THEY GO IN THIS MESH, not their own. Same material, one merge, one
     draw call - and the palps and the fringe are the same tissue, so
     there was never a reason for two.

     Static, like the fringe: it never poses, so it costs one merge at
     construction and nothing per frame.
     ------------------------------------------------------------ */
  {
    const N = 20;
    const P = 16;
    const perFlap = 5;
    const total = N + P;
    const position = new Float32Array(total * perFlap * 3);
    const colour = new Float32Array(total * perFlap * 4);
    const index = [];
    /* Rooted on the collar at the height they now sit, not on its widest
       ring. `collarR` is the shape of the inside of this mouth and the
       flaps have to grow out of the wall where it actually is - set at
       the flare's 1.30r they would have stood a metre and a half clear
       of it in open air. */
    const base = collarR(0.9);
    const set = (b, v, x, y, z) => {
      position[(b + v) * 3] = x;
      position[(b + v) * 3 + 1] = y;
      position[(b + v) * 3 + 2] = z;
    };
    const paint = (b, v, shade, alpha) => {
      const k = (b + v) * 4;
      colour[k] = lerp(COLLAR_DARK[0], COLLAR_LIT[0], shade);
      colour[k + 1] = lerp(COLLAR_DARK[1], COLLAR_LIT[1], shade);
      colour[k + 2] = lerp(COLLAR_DARK[2], COLLAR_LIT[2], shade);
      colour[k + 3] = alpha;
    };
    for (let i = 0; i < N; i += 1) {
      const b = i * perFlap;
      index.push(b, b + 1, b + 4, b + 1, b + 2, b + 4,
        b + 2, b + 3, b + 4, b, b + 2, b + 1, b, b + 3, b + 2);
      const a = (i / N) * TAU + rng() * 0.06;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const w = (base * TAU / N) * 0.44;
      /* OUT FAR AND DOWN BARELY. The tip has to reach the sand and then
         lie on it: the funnel floor is a hand's width under the lip now,
         so a flap that drops two metres is a flap driven into the ground
         and one that drops three is not drawn at all. Three metres of
         reach against half a metre of fall gives the splayed webbing
         this join wants, and leaves the tips just clear of the sand so
         the mouth's own breathing does not push them through it. */
      const out = 2.4 + rng() * 1.2;
      const drop = 0.15 + rng() * 0.40;
      // The four roots, set into the collar just under its lip...
      const rootY = MAW_TOP - 0.45 - rng() * 0.35;
      set(b, 0, ca * base - sa * w, rootY, sa * base + ca * w);
      set(b, 1, ca * (base - 0.5), rootY + w * 0.7, sa * (base - 0.5));
      set(b, 2, ca * base + sa * w, rootY, sa * base - ca * w);
      set(b, 3, ca * (base + 0.6), rootY - w * 0.5, sa * (base + 0.6));
      // ...and the tip, splayed out across the sand it rises from.
      set(b, 4, ca * (base + out), rootY - drop, sa * (base + out));
      for (let v = 0; v < perFlap; v += 1) {
        const tip = v === 4 ? 1 : 0;
        /* HALF THE VALUE IT WAS. These flaps splay outward and UPWARD
           onto the funnel floor, which makes them the most sun-facing
           surface on the animal - and painted at the collar's own lit
           end they came back as a ring of pink arrowheads standing in
           front of the mouth, brighter than the meat they belong to.
           They are the outside of a throat; the only soft tissue on
           this creature allowed to be bright is the palps, which are
           bright because there is a light behind them. */
        paint(b, v, (tip ? 0.18 : 1) * (0.40 + rng() * 0.30), tip ? 0.30 : 0.05);
      }
    }
    /* The palps. Rooted just under the lip, INSIDE the collar's
       narrowest point, and reaching down and inward across the mouth
       of the gullet. */
    const pRoot = collarR(0.9) * COLLAR_BITE_MIN * 0.94;
    for (let i = 0; i < P; i += 1) {
      const b = (N + i) * perFlap;
      index.push(b, b + 1, b + 4, b + 1, b + 2, b + 4,
        b + 2, b + 3, b + 4, b, b + 2, b + 1, b, b + 3, b + 2);
      const a = ((i + 0.5) / P) * TAU + rng() * 0.08;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const w = (pRoot * TAU / P) * 0.40;
      const rootY = MAW_TOP - 0.9 - rng() * 0.7;
      /* IN, and only a little DOWN. A palp that hangs mostly downward
         is hidden behind the collar's own lip from every angle a
         player fights from; one that reaches across the hole is
         backlit by the gullet from all of them. */
      const inTo = pRoot * (0.36 + rng() * 0.20);
      const fall = 1.0 + rng() * 1.1;
      set(b, 0, ca * pRoot - sa * w, rootY, sa * pRoot + ca * w);
      set(b, 1, ca * (pRoot + 0.35), rootY + w * 0.5, sa * (pRoot + 0.35));
      set(b, 2, ca * pRoot + sa * w, rootY, sa * pRoot - ca * w);
      set(b, 3, ca * (pRoot - 0.30), rootY - w * 0.55, sa * (pRoot - 0.30));
      set(b, 4, ca * inTo, rootY - fall, sa * inTo);
      for (let v = 0; v < perFlap; v += 1) {
        const tip = v === 4 ? 1 : 0;
        if (tip) {
          /* THE PALP TIPS ARE THE MOUTH'S LIGHT, and they are painted
             rather than lerped for a reason the first pass got wrong.

             The gullet is five metres down a ten-metre hole. A player
             fights this thing from the funnel floor, which puts the
             lens about four degrees above the lip - and at four
             degrees you cannot see into that hole at all. The gallery
             portrait came back with a perfect black maw and no warm
             element anywhere in the frame, which loses the one thing
             the art direction says the district is for: "the gut is
             the only warm thing in the district, which is exactly why
             the mouth reads from the rim of the pan".

             So the light has to come OUT. These sixteen tips stand at
             the lip, lean over the throat, and are painted as tissue
             with a lamp behind it - and the kit's bio mask multiplies
             a vertex's OWN colour, so a near-black palp with alpha 1
             returns a near-black glow. The tip has to be hot in albedo
             for the mask to have anything to give back. */
          const k = (b + 4) * 4;
          colour[k] = 0.62;
          colour[k + 1] = 0.185;
          colour[k + 2] = 0.055;
          colour[k + 3] = 1.0;
        } else {
          paint(b, v, 0.9 + rng() * 0.5, 0.22);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, collarMat);
    mesh.name = "sf-garner-fringe";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    maw.add(mesh);
  }

  /* ------------------------------------------------------------
     THE TUSKS

     Two rings of inward-raked fangs that IRIS. Each tusk is a
     four-sided spike whose base is fixed in the collar and whose tip
     swings across the throat, so closing the mouth crosses the rings
     over each other rather than sliding a shutter.

     FEW AND HUGE. Three rings of eighteen shipped first and the mouth
     came out as a bed of nails: fifty-four identical white spikes at a
     size where none of them individually reads, which the eye files as
     one fringed texture rather than as teeth. Nine tusks the height of
     a trooper and a half, plus a shorter inner ring behind them, gives
     the same coverage with a countable silhouette - and a silhouette
     the player can count is one they can tell "open" from "shut" at
     forty metres.

     One geometry, rewritten from `mawOpen`, because twenty-one teeth
     the other way is twenty-one draw calls for something that is never
     still.

     NINE VERTICES A TOOTH, NOT FIVE, and the four extra are the
     highest-value geometry on this animal. A four-sided pyramid has
     exactly four long straight silhouette edges and one interior
     crease, and twenty-one of them at the centre of the frame is why
     the gallery's portrait measured an edge density of 4.40 against a
     Halo pool that runs 8.6 to 20.1 - worse than any frame in the
     reference set. A mid ring turned 45 degrees against the base gives
     each tooth a hard spiral crease running its whole length, a
     silhouette that changes width twice, and somewhere for a break to
     happen; it costs 84 vertices across the entire boss.

     It also buys the CURVE. The mid ring is offset along the tooth's
     own tangent and the tip carries twice that offset, so a fang hooks
     rather than pointing - which is the difference between a tooth and
     a traffic cone, and it costs one multiply.
     ------------------------------------------------------------ */
  const TUSK_RINGS = [
    // radius scale, count, height scale, base height
    /* Heights are capped by a hard constraint rather than chosen by
       eye: a gaping tusk swings up by about its own length, and the tip
       of the longest one has to stay several metres UNDER the pan. Five
       metres of stand plus a 4.3m tusk is the most this pit can carry
       and still be a pit. */
    { r: 1.04, n: 9, h: 0.62, y: 1.2 },
    { r: 0.72, n: 12, h: 0.50, y: -0.2 },
  ];
  const TOOTH_VERTS = 9;     // four base corners, four mid, one tip
  const teeth = [];
  const fangs = (() => {
    const total = TUSK_RINGS.reduce((sum, ring) => sum + ring.n, 0);
    const verts = total * TOOTH_VERTS;
    const position = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = [];
    for (let t = 0; t < total; t += 1) {
      const b = t * TOOTH_VERTS;
      // A floor, so it is not hollow when the mouth is open and the
      // player is looking straight down it...
      index.push(b, b + 2, b + 1, b, b + 3, b + 2);
      for (let s = 0; s < 4; s += 1) {
        const n = (s + 1) % 4;
        // ...the twisted skirt from base ring to mid ring...
        index.push(b + s, b + n, b + 4 + n, b + s, b + 4 + n, b + 4 + s);
        // ...and the crown.
        index.push(b + 4 + s, b + 4 + n, b + 8);
      }
    }
    for (let ring = 0; ring < TUSK_RINGS.length; ring += 1) {
      const spec = TUSK_RINGS[ring];
      const rr = C.craterInner * spec.r;
      /* The inner ring is set further in and still has to reach across
         what is left, so its tusks are only slightly shorter - a shut
         mouth is a dome of interlocking fangs rather than two
         concentric fences with a hole down the middle of them. */
      const height = C.craterInner * spec.h;
      for (let s = 0; s < spec.n; s += 1) {
        /* Offset by half a tusk against the ring outside it, so a shut
           mouth interlocks instead of leaving gaps the player can see
           the gullet through. */
        const a = ((s + (ring % 2) * 0.5) / spec.n) * TAU;
        const idx = teeth.length;
        teeth.push({
          a,
          r: rr * (0.94 + rng() * 0.12),
          y: spec.y,
          height: height * (0.80 + rng() * 0.40),
          /* Wide enough that a tusk is a WEDGE rather than a needle.
             This is most of what separates "teeth" from "thorns" at
             any distance - a spike whose base is narrower than its own
             length reads as a spine however big it is. */
          width: (rr * TAU / spec.n) * 0.52,
          /* Every tusk leans a little differently, and the lean is
             what stops the ring reading as a machined collet. */
          skew: (rng() - 0.5) * 0.55,
          /* The hook, signed and per tooth. Applied once at the mid
             ring and twice at the tip, so the fang curves instead of
             kinking. */
          bend: (rng() - 0.5) * 0.85,
          /* 0 intact, 1 snapped off at the mid ring. Some are already
             gone: this animal has been eating the district for a long
             time and a full set of twenty-one perfect fangs is the one
             thing that would read as manufactured. Those ones are
             flagged, because the leash heals the fight and must not
             heal the animal's history with it. */
          chip: 0,
          bornBroken: false,
          ring,
          base: idx * TOOTH_VERTS,
        });
        if (rng() < 0.14) {
          teeth[idx].chip = 1;
          teeth[idx].bornBroken = true;
        }
        paintTooth(colour, teeth[idx]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, toothMat);
    mesh.name = "sf-garner-teeth";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    maw.add(mesh);
    return { mesh, geo, position, colour };
  })();

  /** Paint one tusk into a colour buffer.
   *
   *  A function rather than a loop at build time because a tooth is
   *  repainted when it BREAKS: a snapped fang is not a shorter white
   *  spike, it is a wet dark stump with the pulp showing, and that is
   *  the whole difference between damage the player can see and a
   *  number going down in the HUD. */
  function paintTooth(colour, tooth) {
    const broken = tooth.chip > 0;
    for (let v = 0; v < TOOTH_VERTS; v += 1) {
      const k = (tooth.base + v) * 4;
      /* Three bands up one tooth, and the range inside them is most of
         what this material is for: wet gum at the root, then bone, then
         near-white enamel at the tip. Roots carry the gullet's own
         light in alpha; the tip carries none, because a glowing tooth
         is a lamp and a specular tooth is a tooth. */
      let col;
      let alpha;
      if (v < 4) { col = TOOTH_GUM; alpha = 0.55; }
      else if (v < 8) { col = ENAMEL_ROOT; alpha = 0.12; }
      else { col = ENAMEL_TIP; alpha = 0; }
      /* A broken tooth loses its enamel from the break upward. The mid
         ring becomes the exposed rim of the stump - pale, because that
         is where the bone was cut - and everything above it is pulp. */
      if (broken && v >= 8) { col = TOOTH_GUM; alpha = 0.75; }
      const j = 0.86 + rng() * 0.26;
      colour[k] = col[0] * j;
      colour[k + 1] = col[1] * j;
      colour[k + 2] = col[2] * j;
      colour[k + 3] = alpha;
    }
  }

  function poseTeeth() {
    const p = fangs.position;
    /* 0 is shut across the throat, 1 is raked fully back off it. The
       rings do not travel the same distance: the inner ones have
       further to fold, so an opening mouth peels rather than
       blooming.

       The sign of this was inverted for one build and the animal spent
       it as a sea anemone: `lean` was near vertical when the mouth was
       SHUT, so a closed Garner splayed fifty-four fangs outward at the
       sky and an open one folded them politely across its own throat.
       A closed mouth is teeth meeting over the gullet - lean 0, which
       is why the closed end of this lerp is the one near zero. */
    const o = clamp01(state.mawOpen);
    for (const tooth of teeth) {
      const ca = Math.cos(tooth.a);
      const sa = Math.sin(tooth.a);
      // Tangent, for the tooth's own width.
      const tx = -sa * tooth.width;
      const tz = ca * tooth.width;
      const b = tooth.base * 3;
      const set = (v, x, y, z) => {
        p[b + v * 3] = x;
        p[b + v * 3 + 1] = y;
        p[b + v * 3 + 2] = z;
      };
      const bx = ca * tooth.r;
      const bz = sa * tooth.r;
      set(0, bx + tx, tooth.y, bz + tz);
      set(1, bx + tx * 0.35 - ca * tooth.width, tooth.y - tooth.width * 0.8,
        bz + tz * 0.35 - sa * tooth.width);
      set(2, bx - tx, tooth.y, bz - tz);
      set(3, bx + tx * 0.35 + ca * tooth.width, tooth.y + tooth.width * 0.8,
        bz + tz * 0.35 + sa * tooth.width);
      /* THE TIP IS THE ANIMATION. It swings from across the throat up
         and back over the collar, which is what a tooth set in a ring
         of muscle actually does - it does not retract into a slot.
         Shut, the inner rings reach furthest across, so a closed mouth
         interlocks into a dome instead of leaving a hole down the
         middle of it. */
      /* Shut is teeth meeting across the throat; open rakes them past
         vertical so they lean OUT over the collar. Stopping at vertical
         gave a crown of white spikes standing to attention, which reads
         as a fence around a hole rather than as a mouth that has just
         let go of something. */
      const lean = lerp(-0.10 - tooth.ring * 0.09, 2.05 - tooth.ring * 0.18, o);
      const inward = Math.cos(lean);
      const up = Math.sin(lean);
      /* The tooth's own axis, as an actual unit vector this time. The
         five-vertex version only ever needed the tip, so it added the
         unnormalised offset straight onto the base and never had to
         know how long it was; the mid ring has to be placed at a
         FRACTION of that length, so the length has to exist. */
      let ax = -ca * inward - sa * tooth.skew * 0.4;
      let ay = up + 0.14;
      let az = -sa * inward + ca * tooth.skew * 0.4;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      /* A snapped tusk keeps its root and loses everything above the
         break. Not a shorter tooth: the mid ring stays where the break
         is, so the stump is as WIDE as the tooth was there, which is
         what makes it read as broken rather than as small. */
      const broken = tooth.chip > 0;
      const len = tooth.height * al * (broken ? 0.46 : 1);
      /* The ring frame. The tangent is the obvious perpendicular and it
         is not quite perpendicular once the tooth leans, so it is
         orthogonalised against the axis - otherwise a fully raked tusk
         gets a mid ring skewed into its own skirt and the twist reads
         as a pinch. */
      let ux = -sa;
      let uy = 0;
      let uz = ca;
      const dot = ux * ax + uy * ay + uz * az;
      ux -= ax * dot; uy -= ay * dot; uz -= az * dot;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ay * uz - az * uy;
      const vy = az * ux - ax * uz;
      const vz = ax * uy - ay * ux;

      const midT = broken ? 0.98 : 0.44;
      const rw = tooth.width * (broken ? 0.52 : 0.58);
      const hook = tooth.width * tooth.bend;
      const mcx = bx + ax * len * midT + ux * hook;
      const mcy = tooth.y + ay * len * midT + uy * hook;
      const mcz = bz + az * len * midT + uz * hook;
      for (let i = 0; i < 4; i += 1) {
        /* Turned 45 degrees against the base ring. That offset is the
           spiral crease - the edge that runs the length of the tooth
           and catches the sun on one flank only - and it is the whole
           reason the ring is here. */
        const th = (i / 4) * TAU + Math.PI * 0.25;
        const cw = Math.cos(th) * rw;
        const sw = Math.sin(th) * rw;
        set(4 + i, mcx + ux * cw + vx * sw,
          mcy + uy * cw + vy * sw,
          mcz + uz * cw + vz * sw);
      }
      /* THE TIP IS THE ANIMATION. It swings from across the throat up
         and back over the collar, which is what a tooth set in a ring
         of muscle actually does - it does not retract into a slot.
         Shut, the inner rings reach furthest across, so a closed mouth
         interlocks into a dome instead of leaving a hole down the
         middle of it.

         Shut is teeth meeting across the throat; open rakes them past
         vertical so they lean OUT over the collar. Stopping at vertical
         gave a crown of white spikes standing to attention, which reads
         as a fence around a hole rather than as a mouth that has just
         let go of something.

         On a broken tooth it collapses onto the break, so the crown
         degenerates into a ragged cap rather than a needle. */
      const tipT = broken ? 1.06 : 1;
      const tipHook = broken ? hook : hook * 2.1;
      set(8, bx + ax * len * tipT + ux * tipHook,
        tooth.y + ay * len * tipT + uy * tipHook,
        bz + az * len * tipT + uz * tipHook);
    }
    fangs.geo.attributes.position.needsUpdate = true;
    fangs.geo.computeVertexNormals();
    fangs.geo.computeBoundingSphere();
  }

  /** Snap a tusk, for good. The pit cannot flinch and it cannot limp,
   *  so the only place damage can accumulate VISIBLY on this animal is
   *  its face - and a mouth that loses teeth as the fight runs is the
   *  one damage state a player reads without being told. */
  function breakTusk(index) {
    const tooth = teeth[clamp(Math.round(index), 0, teeth.length - 1)];
    if (!tooth || tooth.chip > 0) return null;
    tooth.chip = 1;
    paintTooth(fangs.colour, tooth);
    fangs.geo.attributes.color.needsUpdate = true;
    return tooth;
  }

  /* ------------------------------------------------------------
     THE OUTER RING - the small teeth in the sand.

     Twenty-six of them, standing in the funnel floor between the mouth
     and the rubble collar, raked inward at the throat.

     WHY THE MOUTH NEEDED THEM. Twenty-one tusks on a collar is a crown,
     and a crown has an edge: however low the collar sits, the animal
     stops exactly where its own geometry stops and the sand begins
     again. That edge is what read as "a mouth on a base" even after the
     base came down, because a ring of enamel with nothing outside it is
     a rim somebody set into the ground rather than something the ground
     is full of. These break it - the teeth thin out and get smaller as
     they go away from the throat, so the animal has no outline, it has a
     falloff.

     THEY ARE GROUND, NOT MOUTH. Pinned to the world at the funnel's
     finished floor instead of riding the maw, for two reasons that both
     matter: they must not iris - a small tooth set in sand has nothing
     to fold on - and being at the FINISHED floor while the pan is still
     shut means they are buried until the collapse reaches them. So the
     ring is not revealed by the mouth coming up; it surfaces as the sand
     goes down, which is the beat the collapse wanted and costs nothing
     to get.

     Nine vertices each, the same topology and the same 45-degree mid
     ring as the tusks, because that spiral crease is what makes a spike
     read as a tooth rather than as a thorn - and it is the reason these
     can be a third the size of a tusk and still be countable.
     ------------------------------------------------------------ */
  {
    const N = 26;
    const verts = N * TOOTH_VERTS;
    const position = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = [];
    for (let t = 0; t < N; t += 1) {
      const b = t * TOOTH_VERTS;
      index.push(b, b + 2, b + 1, b, b + 3, b + 2);
      for (let s = 0; s < 4; s += 1) {
        const n = (s + 1) % 4;
        index.push(b + s, b + n, b + 4 + n, b + s, b + 4 + n, b + 4 + s);
        index.push(b + 4 + s, b + 4 + n, b + 8);
      }
      /* Two loose rings rather than one even one. A single ring of
         twenty-six at one radius is a fence; staggering half of them
         outward and jittering both is a jaw the sand has half swallowed.
         `pow` biases the scatter inward, so the ring is dense at the
         throat and thins toward the rubble. */
      const a = ((t + 0.5) / N) * TAU + (rng() - 0.5) * 0.16;
      const r = 10.4 + Math.pow(rng(), 1.5) * 4.2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = C.pitX + ca * r;
      const z = C.pitZ + sa * r;
      /* The floor as it will BE, not as it is: `groundAt` answers with
         the sealed pan at build time, and the profile is the rest. Set a
         little under it, because a tooth resting on sand is a prop and
         one driven into it is a tooth. */
      const y = groundAt(x, z) + garnerPitProfile(r) - (0.25 + rng() * 0.5);
      /* Smaller the further out, and none of them near a tusk's 4.3m.
         The size gradient is what makes this read as one animal's
         dentition rather than as two unrelated rings. */
      const fall = clamp01((r - 10.4) / 4.2);
      /* Well under a tusk's 4.3m at the inner end and a third of it at
         the outer. These have to read as the SAME dentition a size down,
         and a spike two thirds of a tusk standing further from the
         camera photographs as another tusk - two rings of the same
         tooth, which is a fence again. */
      const height = lerp(1.90, 0.85, fall) * (0.78 + rng() * 0.44);
      const width = (0.42 + rng() * 0.34) * lerp(1, 0.72, fall);
      /* Raked at the throat, and hard. Every one of these leans in at
         the mouth, which is what turns a scatter of spikes into
         something with a direction - and it is the same read the tusks
         give from inside the collar, continued outward. */
      const lean = 1.30 - fall * 0.34 + (rng() - 0.5) * 0.34;
      const skew = (rng() - 0.5) * 0.5;
      const bend = (rng() - 0.5) * 0.7;
      let ax = -ca * Math.cos(lean) - sa * skew * 0.4;
      let ay = Math.sin(lean);
      let az = -sa * Math.cos(lean) + ca * skew * 0.4;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      /* A quarter of them are stumps. Nothing has been chewing on the
         Ossuary but this, and a complete set of twenty-six perfect
         spikes in open sand is the one arrangement that reads as
         manufactured. */
      const worn = rng() < 0.26;
      const len = height * (worn ? 0.48 : 1);
      // The base quad, in the tangent plane.
      const tx = -sa * width;
      const tz = ca * width;
      const set = (v, px, py, pz) => {
        position[(b + v) * 3] = px;
        position[(b + v) * 3 + 1] = py;
        position[(b + v) * 3 + 2] = pz;
      };
      set(0, x + tx, y, z + tz);
      set(1, x + tx * 0.35 - ca * width, y - width * 0.8, z + tz * 0.35 - sa * width);
      set(2, x - tx, y, z - tz);
      set(3, x + tx * 0.35 + ca * width, y + width * 0.8, z + tz * 0.35 + sa * width);
      // The mid ring's frame, orthogonalised against the lean.
      let ux = -sa;
      let uy = 0;
      let uz = ca;
      const dot = ux * ax + uy * ay + uz * az;
      ux -= ax * dot; uy -= ay * dot; uz -= az * dot;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ay * uz - az * uy;
      const vy = az * ux - ax * uz;
      const vz = ax * uy - ay * ux;
      const midT = worn ? 0.96 : 0.44;
      const rw = width * (worn ? 0.54 : 0.58);
      const hook = width * bend;
      const mcx = x + ax * len * midT + ux * hook;
      const mcy = y + ay * len * midT + uy * hook;
      const mcz = z + az * len * midT + uz * hook;
      for (let i = 0; i < 4; i += 1) {
        const th = (i / 4) * TAU + Math.PI * 0.25;
        const cw = Math.cos(th) * rw;
        const sw = Math.sin(th) * rw;
        set(4 + i, mcx + ux * cw + vx * sw, mcy + uy * cw + vy * sw,
          mcz + uz * cw + vz * sw);
      }
      const tipT = worn ? 1.05 : 1;
      const tipHook = worn ? hook : hook * 2.1;
      set(8, x + ax * len * tipT + ux * tipHook,
        y + ay * len * tipT + uy * tipHook,
        z + az * len * tipT + uz * tipHook);
      /* Painted a stop under the tusks. These stand in daylight on open
         sand rather than at the rim of a lit throat, and at the crown's
         own near-white they came back as the brightest thing in the
         frame - a ring of pale chips on pale sand, which is the one
         value relationship this district cannot carry. Gum at the root,
         and the enamel dusty rather than wet. */
      for (let v = 0; v < TOOTH_VERTS; v += 1) {
        const k = (b + v) * 4;
        let col;
        let alpha;
        if (v < 4) { col = TOOTH_GUM; alpha = 0.30; }
        else if (v < 8) { col = ENAMEL_ROOT; alpha = 0.06; }
        else { col = ENAMEL_TIP; alpha = 0; }
        if (worn && v >= 8) { col = TOOTH_GUM; alpha = 0.45; }
        const j = (0.80 + rng() * 0.26) * lerp(0.86, 0.62, fall);
        colour[k] = col[0] * j;
        colour[k + 1] = col[1] * j;
        colour[k + 2] = col[2] * j;
        colour[k + 3] = alpha;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, toothMat);
    mesh.name = "sf-garner-ring-teeth";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /* ------------------------------------------------------------
     THE GULLET

     A throat that goes DOWN and glows, with a peristaltic wave
     travelling the wrong way up it. Additive, but divided by its own
     peak channel so that a saturated amber at full gain stays amber
     instead of clipping to a white disc - the same correction the
     doctrine rites needed.
     ------------------------------------------------------------ */
  const gulletMat = new THREE.ShaderMaterial({
    uniforms: {
      uHot: { value: new THREE.Color(GULLET_HOT) },
      uDeep: { value: new THREE.Color(GULLET_DEEP) },
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uSpan: { value: 6 },
      /* Additive, on a district lit by a low warm sun onto white bone.
         Below about 1.8 the gullet is simply not brighter than the pan
         it is set into and the mouth reads as a dark hole rather than
         as a lit one - which is the wrong read for the only warm light
         source in the Ossuary. */
      /* And UP again to 2.5 now that the throat is inside the collar
         rather than standing on top of it: the same light through a
         third of the screen area has to be brighter to be the frame's
         focal point, and it is the only element in the picture that
         reaches a blown pixel. */
      uGain: { value: 2.5 },
    },
    vertexShader: /* glsl */`
      uniform float uSpan;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        /* 0 at the lip, 1 at the bottom of the visible throat. The tube
           is uSpan long about its own centre.
           Sized to the five metres of throat that stand above the pit's
           floor, and no longer: the terrain caps everything below that,
           so a fourteen-metre tube spent three quarters of its gradient
           underground and the part the player could see was all one
           colour. */
        vDepth = clamp(0.5 - position.y / uSpan, 0.0, 1.0);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uHot;
      uniform vec3 uDeep;
      uniform float uTime;
      uniform float uOpen;
      uniform float uGain;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        // Rings of contraction climbing the throat. Slow, and slightly
        // irregular, because a clean sine reads as a lava lamp.
        float wave = 0.5 + 0.5 * sin(vDepth * 13.0 - uTime * 1.35);
        float wave2 = 0.5 + 0.5 * sin(vDepth * 5.0 - uTime * 0.62 + 1.7);
        float pulse = pow(wave * 0.65 + wave2 * 0.45, 2.2);
        // Hotter deeper: the light is coming from somewhere further
        // down than the player can see, which is the whole point of it.
        float heat = mix(0.16, 1.0, pow(vDepth, 0.75)) * (0.55 + pulse * 0.75);
        vec3 c = mix(uDeep, uHot, clamp(heat, 0.0, 1.0));
        /* Only lit while the mouth is actually parted - and ALLOWED TO
           OVERDRIVE past 1, which the clamp used to forbid.

           This is the frame's only blown pixel and it was being capped
           out of existence. The hot colour peaks at 1.0 in red and
           0.70 in green, so a term clamped to 1 tops out at a
           luminance of about 0.74 - amber, never white - and the
           metric harness reads our whole boss set at brightPct 0.02
           against a Halo pool that never drops below 0.004 and
           averages 1.5. A frame with no blown highlight anywhere has
           no wet, no polish and no heat in it.

           Ceiling at 1.8 rather than none: past about twice, the
           amber-to-white core swallows the peristaltic banding and the
           throat becomes a featureless disc, which is the failure the
           doctrine rites recorded. 1.8 blows the deepest sixth of the
           gullet and leaves the rest reading as a gradient. */
        float a = min(max(heat * uOpen * uGain, 0.0), 1.8);
        float far = 1.0 - smoothstep(320.0, 520.0, length(cameraPosition - vWorld));
        gl_FragColor = vec4(c * a, 1.0) * far;
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const gullet = (() => {
    /* INSIDE THE COLLAR AND UNDER THE LIP, which it was not.

       At `craterInner * 1.02` with its top ring 0.4m ABOVE the lip,
       the throat's widest and brightest band stood proud of the mouth
       it belongs to - and the only reason nobody ever saw a glowing
       ring hanging over the sand is that the shaft, which was
       ALSO too wide, happened to be drawn in front of it. Two bugs
       cancelling is not a design. Both are now sized against the
       collar's chewed minimum, so the gullet is a light at the bottom
       of a hole from every angle rather than from one. */
    const geo = new THREE.CylinderGeometry(
      C.craterInner * 1.08 * COLLAR_BITE_MIN * 0.88, 1.1, 6, 22, 5, true);
    const mesh = new THREE.Mesh(geo, gulletMat);
    mesh.name = "sf-garner-gullet";
    mesh.position.y = MAW_TOP - 0.5 - 3;
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    maw.add(mesh);
    return mesh;
  })();

  /* THE HIT NODES. combat.js's HITBOX.garner names these two, and it
     reads them off the live scene - so the mouth's hit capsule rises
     out of the ground with the geometry rather than being a fixed
     offset that would hang in open air over a sealed pan. */
  const throatNode = new THREE.Object3D();
  throatNode.name = "garner_throat";
  throatNode.position.set(0, -3.4, 0);
  maw.add(throatNode);
  const lipNode = new THREE.Object3D();
  lipNode.name = "garner_lip";
  lipNode.position.set(0, 1.9, 0);
  maw.add(lipNode);

  /* ============================================================
     THE TENTACLES

     Six limbs, one geometry, fifteen nodes each.

     A node chain rather than a spline through control points, because
     the two things this limb has to do are opposites: while it is
     rearing it is MUSCLE and holds whatever arc it is given, and the
     moment it misses it is DEAD WEIGHT and has to fall on the terrain
     under it. A parametric curve does the first and cannot do the
     second; a chain with a length constraint does both, and the only
     difference between the two states is how hard the nodes are
     pulled toward their targets.
     ============================================================ */
  const link = C.armLength / (C.armNodes - 1);
  const armVertsEach = C.armNodes * ARM_SIDES + 1;

  /* THE MUSCLE RINGS, as a wavenumber over the limb's own parameter.

     Eighteen metres of smooth taper is a hose. Photographed against
     the pan it read as exactly that: one continuous value, one
     continuous outline, and no cue anywhere on it about how thick it
     was or which way it was going. Real annulated muscle has a
     silhouette that changes width several times along its length, and
     a silhouette that changes is edge density - which the metric
     harness reports us failing worse than any frame in the Halo pool.

     3.5 cycles over fifteen nodes is four nodes to a ring. Faster than
     that and consecutive nodes land on opposite phases, which is not
     annulation, it is a zigzag; slower and there are three bulges on
     an eighteen-metre limb and it is still a hose. */
  const ARM_RING_K = 22.0;
  const ARM_RING_A = 0.15;

  /** A limb's radius at parameter `tt`, 0 at the root and 1 at the tip.
   *
   *  Extracted from `writeArmGeometry` because THREE separate things
   *  need to agree about it: the ring positions, the analytic normal
   *  (which needs its derivative), and the vertex paint, which has to
   *  put its dark band at the waist of a ring and not half a ring off
   *  it. Three copies of this expression is three chances for the
   *  shading, the outline and the paint to describe different limbs. */
  function armRadius(tt) {
    /* The taper, and it is not linear. A tentacle is thickest just
       above the ground, holds most of its bulk through the middle,
       and only gives it up over the last quarter - and then swells
       again into the grasping pad, which is the part that lands next
       to the player and therefore the part that has to read. A
       straight lerp gave a traffic cone. */
    const pad = Math.pow(clamp01((tt - 0.86) / 0.14), 2) * 0.42;
    const ring = 1 + ARM_RING_A * Math.sin(tt * ARM_RING_K + 0.6);
    return (lerp(ARM_TIP_R, ARM_ROOT_R, Math.pow(1 - tt, 0.55)) + pad) * ring;
  }

  const arms = [];
  for (let i = 0; i < C.arms; i += 1) {
    const nodes = [];
    for (let n = 0; n < C.armNodes; n += 1) nodes.push(new THREE.Vector3());
    arms.push({
      index: i,
      phase: "sheathed",   // sheathed, erupt, rear, lash, seize, limp, drag, severed
      timer: 0,
      regrow: 0,
      nodes,
      /* Where it broke ground. Migrates toward the pit while the limb
         drags itself home, which is what makes the retraction a moving
         melee target instead of a limb that shrinks in place. */
      anchor: new THREE.Vector3(),
      aim: new THREE.Vector3(),
      rear: new THREE.Vector3(),
      /* Where the tip is being asked to be. Eased toward the phase's
         real target rather than handed to the solver raw, so a limb
         that changes its mind between frames sweeps instead of
         teleporting. */
      goal: new THREE.Vector3(),
      /* The four nodes combat.js measures against - see `limbSpan`.
         Plain Object3Ds re-placed every frame; they are the entire
         contract between this module's spline and the shared hit
         table, and nothing else about the limb is exposed. */
      chain: [new THREE.Object3D(), new THREE.Object3D(),
        new THREE.Object3D(), new THREE.Object3D()],
      severedFor: 0,
      sweepGap: 0,
      base: i * armVertsEach,
    });
    for (const node of arms[i].chain) group.add(node);
  }

  const armMesh = (() => {
    const verts = C.arms * armVertsEach;
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = [];
    for (let a = 0; a < C.arms; a += 1) {
      const base = a * armVertsEach;
      for (let n = 0; n < C.armNodes - 1; n += 1) {
        for (let s = 0; s < ARM_SIDES; s += 1) {
          const ns = (s + 1) % ARM_SIDES;
          const r0 = base + n * ARM_SIDES;
          const r1 = base + (n + 1) * ARM_SIDES;
          index.push(r0 + s, r1 + s, r1 + ns, r0 + s, r1 + ns, r0 + ns);
        }
      }
      // The tip fan, so a limb pointed at the camera is not a hole.
      const tip = base + C.armNodes * ARM_SIDES;
      const last = base + (C.armNodes - 1) * ARM_SIDES;
      for (let s = 0; s < ARM_SIDES; s += 1) {
        index.push(last + s, tip, last + ((s + 1) % ARM_SIDES));
      }
      /* Colour is static. Dark wet muscle at the root shading to a
         lit, engorged grasping pad at the tip, and the emissive mask
         in alpha carries a ladder of sucker rings up the underside -
         which at night is the only way a limb reads before it is
         silhouetted against the sky. */
      for (let n = 0; n < C.armNodes; n += 1) {
        const t = n / (C.armNodes - 1);
        /* IN PHASE WITH THE MUSCLE RINGS the geometry now carries -
           `armRadius` owns the phase and this reads it, so a
           constriction is always dark and a swell always lit. Painted
           on its own frequency the two patterns beat against each
           other and eighteen metres of limb came out looking sleeved.
           -1 at the waist, +1 at the belly of each ring. */
        const ring = Math.sin(t * ARM_RING_K + 0.6);
        /* BONE MEAL. The art direction asks for limbs "wet at the
           joints, dry and dusty at the tips where they drag through
           bone meal", and it is also the answer to a measured problem:
           eighteen metres of one oxblood value is eighteen metres with
           no local contrast in it. The dust band lands over the outer
           third and lifts off again at the pad, so the limb runs
           wet-dark, dusty-pale, wet-dark - three bands rather than a
           ramp. */
        const dust = clamp01((t - 0.66) / 0.22) * (1 - clamp01((t - 0.86) / 0.10));
        for (let s = 0; s < ARM_SIDES; s += 1) {
          const k = (base + n * ARM_SIDES + s) * 4;
          const u = clamp01(Math.cos((s / ARM_SIDES) * TAU) * 0.5 + 0.5);
          const warm = clamp01(t * 1.25) * (0.55 + u * 0.45)
            * (0.72 + ring * 0.28);
          let r = lerp(FLESH_DARK[0], FLESH_LIT[0], warm);
          let g = lerp(FLESH_DARK[1], FLESH_LIT[1], warm);
          let b = lerp(FLESH_DARK[2], FLESH_LIT[2], warm);
          /* Dust settles on the UPPER half of a limb lying in a pit -
             `u` is the underside mask, so this is its complement, and
             the underside stays wet.

             HALF STRENGTH AND WARM, after the first pass photographed
             as a grey python. At 0.8 the band covered the whole of the
             limb that a rearing tentacle actually shows, and mixed
             toward a neutral bone value it took the animal's hue out
             with it - which is the one thing this boss cannot afford,
             because the only thing separating a limb from the dune
             behind it is that it is red. Bone meal ground into wet
             muscle is an ochre, not a grey. */
          const d = dust * (1 - u) * 0.32;
          r = lerp(r, 0.105, d);
          g = lerp(g, 0.066, d);
          b = lerp(b, 0.038, d);
          colour[k] = r;
          colour[k + 1] = g;
          colour[k + 2] = b;
          // Sucker rings: every other node, on the underside only.
          colour[k + 3] = u > 0.72 && n % 2 === 1
            ? 0.22 + t * 0.34 : 0.02;
        }
      }
      /* THE GRASPING PAD. The one saturated element on a limb, and the
         part that ends up lying next to the player - so it is wet, it
         is the deepest red on the animal outside the collar, and its
         emissive mask is high enough to read at night. */
      const k = tip * 4;
      colour[k] = FLESH_MID[0];
      colour[k + 1] = FLESH_MID[1];
      colour[k + 2] = FLESH_MID[2];
      colour[k + 3] = 0.85;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.pitX, rimY, C.pitZ), C.armMaxRadius + C.armLength);
    const mesh = new THREE.Mesh(geo, fleshMat);
    mesh.name = "sf-garner-arms";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, geo, position, normal };
  })();

  /* Scratch, allocated once. A per-frame Vector3 in a solver that runs
     six times over fifteen nodes is ninety allocations a frame. */
  const _v = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n1 = new THREE.Vector3();
  const _n2 = new THREE.Vector3();

  /**
   * Write one limb's tube into the shared buffer.
   *
   * Normals are computed ANALYTICALLY from the ring frame rather than
   * by `computeVertexNormals`. On a tube they are simply the radial
   * direction, the frame is already in hand from placing the ring, and
   * the alternative is re-deriving them from face winding across six
   * hundred vertices every frame for an answer that is worse - a
   * smooth-shaded tube averaged off triangles bands visibly at the
   * joints where the taper changes.
   *
   * ============================================================
   * THE FRAME IS TRANSPORTED ALONG THE LIMB, and the version that
   * built it from scratch at every node is why these tentacles were
   * see-through.
   *
   * That version picked a reference vector per node - world up, or
   * world x if the tangent was within 23 degrees of vertical - and
   * crossed the tangent against it. Both halves of that are locally
   * correct and the SEED SWITCH is a discontinuity: a limb standing
   * out of the sand and hooking over its target passes through
   * |tangent.y| = 0.92 somewhere in the middle of itself, and the
   * ring on one side of that node is rotated about 180 degrees
   * against the ring on the other. The eight quads spanning them are
   * therefore twisted through a half turn, which pinches the tube to
   * nothing at the seam and reverses the winding of every face past
   * it - and reversed faces on a FrontSide material are not drawn.
   *
   * So a rearing tentacle showed a hard crease at the bend and then
   * simply stopped having a surface: the player saw the inside of the
   * far wall through it. It looked like an alpha problem and it was a
   * basis problem, which is the same bug `rockTube` in structures.js
   * was given parallel transport to fix.
   *
   * The cure is to stop choosing: seed ONE frame at the root and
   * rotate it from node to node by the minimum rotation that carries
   * the old tangent onto the new one. Consecutive rings then differ by
   * the smallest angle that the curve itself demands, there is no
   * angle at which anything switches, and the tube cannot invert.
   * ============================================================
   */
  function writeArmGeometry(arm) {
    const p = armMesh.position;
    const nrm = armMesh.normal;
    const buried = arm.phase === "sheathed";
    /* The transported basis. `_n1` is carried across the whole limb, so
       it is seeded once outside the loop rather than per node. */
    let seeded = false;
    for (let n = 0; n < C.armNodes; n += 1) {
      const node = arm.nodes[n];
      // Tangent from the neighbours, so the frame is continuous.
      const a = arm.nodes[Math.max(0, n - 1)];
      const b = arm.nodes[Math.min(C.armNodes - 1, n + 1)];
      _t.subVectors(b, a);
      if (_t.lengthSq() < 1e-8) _t.set(0, 1, 0);
      _t.normalize();
      if (!seeded) {
        /* The root's frame, and this is the ONLY place a reference
           vector is chosen - so the choice can be as arbitrary as it
           likes without being able to produce a seam. */
        seeded = true;
        _n1.set(0, 1, 0);
        if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
        _n1.crossVectors(_t, _n1).normalize();
      } else {
        /* Rotate the carried reference by the same rotation that took
           the previous tangent to this one: project it back onto the
           plane perpendicular to the new tangent and renormalise. That
           is the minimum-twist transport, in four multiplies and a
           square root, and it degenerates only where the curve doubles
           back on itself - where the previous frame is still a valid
           answer, which is what the guard below keeps. */
        const dot = _n1.dot(_t);
        _n1.addScaledVector(_t, -dot);
        if (_n1.lengthSq() < 1e-6) {
          _n1.set(0, 1, 0);
          if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
          _n1.crossVectors(_t, _n1);
        }
        _n1.normalize();
      }
      _n2.crossVectors(_t, _n1).normalize();
      const tt = n / (C.armNodes - 1);
      const radius = (buried ? 0 : 1) * armRadius(tt);
      /* THE RINGS HAVE TO SHADE, not merely bulge.
         The normals on this tube are written analytically - they are
         the radial direction, which is exact for a CYLINDER and wrong
         for anything whose radius changes. With a plain taper the
         error is a fraction of a degree and nobody could see it; with
         a 15% annulation it is the difference between muscle segments
         that catch the light along their swell and a smooth hose with
         a wavy outline. Tilting the radial by dr/ds along the tangent
         is the whole correction, and it costs two extra evaluations of
         a function that is four multiplies.

         Central difference over half a link, so it is the slope at the
         node rather than the slope of the link after it. */
      const h = 0.5 / (C.armNodes - 1);
      const slope = (armRadius(Math.min(1, tt + h)) - armRadius(Math.max(0, tt - h)))
        / (2 * h * C.armLength);
      const nScale = 1 / Math.sqrt(1 + slope * slope);
      for (let s = 0; s < ARM_SIDES; s += 1) {
        const ang = (s / ARM_SIDES) * TAU;
        const cx = _n1.x * Math.cos(ang) + _n2.x * Math.sin(ang);
        const cy = _n1.y * Math.cos(ang) + _n2.y * Math.sin(ang);
        const cz = _n1.z * Math.cos(ang) + _n2.z * Math.sin(ang);
        const k = (arm.base + n * ARM_SIDES + s) * 3;
        p[k] = node.x + cx * radius;
        p[k + 1] = node.y + cy * radius;
        p[k + 2] = node.z + cz * radius;
        nrm[k] = (cx - _t.x * slope) * nScale;
        nrm[k + 1] = (cy - _t.y * slope) * nScale;
        nrm[k + 2] = (cz - _t.z * slope) * nScale;
      }
    }
    const tip = arm.nodes[C.armNodes - 1];
    const k = (arm.base + C.armNodes * ARM_SIDES) * 3;
    p[k] = tip.x + _t.x * ARM_TIP_R * 1.6;
    p[k + 1] = tip.y + _t.y * ARM_TIP_R * 1.6;
    p[k + 2] = tip.z + _t.z * ARM_TIP_R * 1.6;
    nrm[k] = _t.x; nrm[k + 1] = _t.y; nrm[k + 2] = _t.z;

    /* And the four nodes combat.js will measure. Sampled at quarters
       along the chain rather than at the ends, so the three capsules
       between them cover the whole limb - the same three-segment
       coverage the Distaff's legs get, and for the same reason: the
       stretch nearest the ground is most of what a player standing
       next to a downed tentacle can actually reach. */
    const quarter = (C.armNodes - 1) / 3;
    for (let i = 0; i < 4; i += 1) {
      const node = arm.nodes[Math.min(C.armNodes - 1, Math.round(i * quarter))];
      arm.chain[i].position.copy(node);
      arm.chain[i].updateMatrix();
      arm.chain[i].updateMatrixWorld(true);
    }
  }

  /** Enforce the link length outward from a pinned root. One pass, and
   *  forward only, because the caller has already put the nodes roughly
   *  where they belong - this is a correction, not a solve. */
  function relax(arm) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (let n = 1; n < C.armNodes; n += 1) {
        const a = arm.nodes[n - 1];
        const b = arm.nodes[n];
        _v.subVectors(b, a);
        const d = _v.length();
        if (d < 1e-5) { b.set(a.x, a.y + link, a.z); continue; }
        b.copy(a).addScaledVector(_v, link / d);
      }
    }
  }

  /**
   * FABRIK: put the tip on `goal` and the root on the anchor without
   * changing the length of anything in between.
   *
   * THE ONLY SOLVER THAT WORKS HERE, and the first version proved why
   * by not being it. Laying fifteen nodes evenly along the straight
   * line from the anchor to the target and then enforcing link length
   * from the root outward is correct exactly when the target happens
   * to be `armLength` away. It never is: a limb reaching for a player
   * six metres from where it surfaced has nine metres of slack, so the
   * evenly-spaced nodes end up 0.4m apart, the forward pass stretches
   * each gap to 1.1m, and every node after the second one is placed
   * BEHIND the one before it. The limb folded into a ball at its own
   * root and the whole animal rendered as six wet knots in the sand.
   *
   * Two passes distribute that slack instead of accumulating it: the
   * backward pass pins the tip and lets the chain trail home, the
   * forward pass pins the root and lets the error run back out to the
   * tip. Two iterations is visually converged at any speed the limb
   * actually moves.
   */
  function solveToGoal(arm, goal, iterations = 2) {
    const nodes = arm.nodes;
    const last = C.armNodes - 1;
    for (let it = 0; it < iterations; it += 1) {
      nodes[last].copy(goal);
      for (let n = last - 1; n >= 0; n -= 1) {
        _v.subVectors(nodes[n], nodes[n + 1]);
        const d = _v.length();
        if (d < 1e-5) _v.set(0, 1, 0); else _v.multiplyScalar(1 / d);
        nodes[n].copy(nodes[n + 1]).addScaledVector(_v, link);
      }
      nodes[0].copy(arm.anchor);
      for (let n = 1; n <= last; n += 1) {
        _v.subVectors(nodes[n], nodes[n - 1]);
        const d = _v.length();
        if (d < 1e-5) _v.set(0, 1, 0); else _v.multiplyScalar(1 / d);
        nodes[n].copy(nodes[n - 1]).addScaledVector(_v, link);
      }
    }
  }

  /**
   * Reach for a target, easing toward it rather than snapping.
   *
   * `curl` decides WHERE THE SLACK GOES, which on a limb that is
   * usually much longer than its reach is most of what the pose looks
   * like. Positive bows the middle of the chain up and the limb hooks
   * over its target like a cobra; negative lets it pile onto the sand.
   * The solver itself has no opinion - it only preserves length - so
   * without this bias a reaching tentacle picks an arbitrary plane and
   * the same strike reads differently every time it is thrown.
   */
  function reachTo(arm, target, curl, blend) {
    arm.goal.lerp(target, clamp01(blend));
    if (curl !== 0) {
      for (let n = 1; n < C.armNodes - 1; n += 1) {
        const t = n / (C.armNodes - 1);
        arm.nodes[n].y += Math.sin(t * Math.PI) * curl * clamp01(blend);
      }
    }
    solveToGoal(arm, arm.goal);
  }

  /** Point a limb straight up out of its own hole, `t` of the way out.
   *  A translation rather than a solve: what a tentacle rising through
   *  sand actually does is emerge, and the buried part of the chain is
   *  under opaque terrain and therefore free. */
  function extrude(arm, t) {
    const drop = (1 - clamp01(t)) * C.armLength;
    for (let n = 0; n < C.armNodes; n += 1) {
      arm.nodes[n].set(arm.anchor.x, arm.anchor.y + n * link - drop, arm.anchor.z);
    }
  }

  /** Drop a limb onto the terrain it is lying across, then settle it.
   *  Gravity is applied to every node, the ground catches each one at
   *  its own height, and the relaxation pass afterwards is what turns
   *  fifteen independent falls back into one limb. */
  function flop(arm, dt, damping = 0.86) {
    for (let n = 1; n < C.armNodes; n += 1) {
      const node = arm.nodes[n];
      /* Rest height follows the TAPER, so the tube lies on the sand
         along its whole length. A single rest height for every node
         buries the fat end and floats the thin one, and eighteen metres
         of limb half-sunk in a dune reads as a flat slab rather than as
         something round lying on the ground. */
      const rest = groundAt(node.x, node.z)
        + armRadius(n / (C.armNodes - 1)) * 0.92;
      if (node.y > rest) {
        node.y = Math.max(rest, node.y - 26 * dt * dt - dt * 3.2);
      } else {
        node.y = damp(node.y, rest, 8, dt);
      }
      // A little lateral settle so a fallen limb spreads rather than
      // staying folded exactly where the lash left it.
      node.x += (node.x - arm.nodes[n - 1].x) * dt * (1 - damping) * 2;
      node.z += (node.z - arm.nodes[n - 1].z) * dt * (1 - damping) * 2;
    }
    arm.nodes[0].copy(arm.anchor);
    arm.nodes[0].y = groundAt(arm.anchor.x, arm.anchor.z) + 0.2;
    relax(arm);
  }

  /** Stack a limb straight down under its anchor, out of sight and out
   *  of every hit test - see the note on `legBroken` in `syncLimbs`. */
  function sheathe(arm) {
    const y = groundAt(arm.anchor.x, arm.anchor.z);
    for (let n = 0; n < C.armNodes; n += 1) {
      arm.nodes[n].set(arm.anchor.x, y - 2 - n * link, arm.anchor.z);
    }
  }

  /* ============================================================
     THE VOLLEY

     Bone shards on a ballistic arc. The Coulter's globules with the
     liquid taken out: they fly, they can be walked out from under,
     and they shatter rather than pooling.
     ============================================================ */
  const shardGeo = new THREE.ConeGeometry(0.26, 1.5, 4);
  const shardMat = new THREE.MeshStandardMaterial({
    /* Set in LINEAR, explicitly, and matched to the pan's own new
       value. It was 0xd9cead - a warm cream authored in sRGB, which is
       the district's sand - so a volley of ossuary bone arrived
       invisible against the ground it was thrown over. */
    color: new THREE.Color().setRGB(BONE_PALE[0] * 1.25, BONE_PALE[1] * 1.25,
      BONE_PALE[2] * 1.25, THREE.LinearSRGBColorSpace),
    roughness: 0.8,
    metalness: 0,
    flatShading: true,
  });
  shardMat.name = "sf-garner-shard";
  applySurface(shardMat, atmos, "bone", {
    rim: 0.85, glitter: 0.2, wavelength: 0.35, cavity: 0.32, mottle: 0.06,
    score: 0.00080, pore: 0.00046,
  });
  const shards = [];
  for (let i = 0; i < SHARD_MAX; i += 1) {
    const mesh = new THREE.Mesh(shardGeo, shardMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    shards.push({
      mesh, live: false, life: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0,
    });
  }
  let shardCursor = 0;

  function launchShard(x, y, z, vx, vy, vz) {
    const s = shards[shardCursor];
    shardCursor = (shardCursor + 1) % SHARD_MAX;
    s.live = true;
    s.life = 5;
    s.x = x; s.y = y; s.z = z;
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.spin = (Math.random() - 0.5) * 14;
    s.mesh.position.set(x, y, z);
    s.mesh.visible = true;
    return s;
  }

  /** A lobbed solution, falling back to a flat one. Lifted wholesale
   *  from the Coulter, which is the point: the player has already
   *  learned to read an arc from that fight. */
  function ballistic(x, y, z, tx, ty, tz, speed) {
    const dx = tx - x;
    const dz = tz - z;
    const flat = Math.hypot(dx, dz) || 1e-4;
    const dy = ty - y;
    const g = 24;
    const s2 = speed * speed;
    const root = s2 * s2 - g * (g * flat * flat + 2 * dy * s2);
    const ux = dx / flat;
    const uz = dz / flat;
    if (root < 0) {
      const pitch = 0.44;
      return {
        x: ux * Math.cos(pitch) * speed,
        y: Math.sin(pitch) * speed,
        z: uz * Math.cos(pitch) * speed,
      };
    }
    const angle = Math.atan2(s2 - Math.sqrt(root), g * flat);
    const horizontal = Math.cos(angle) * speed;
    return { x: ux * horizontal, y: Math.sin(angle) * speed, z: uz * horizontal };
  }

  function updateShards(dt) {
    const ps = ctx.player?.state;
    for (const s of shards) {
      if (!s.live) continue;
      s.life -= dt;
      const px = s.x, py = s.y, pz = s.z;
      s.vy -= 24 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.mesh.position.set(s.x, s.y, s.z);
      // Nose-first. A shard tumbling end over end reads as debris; one
      // that holds its heading reads as thrown.
      _v.set(s.vx, s.vy, s.vz);
      if (_v.lengthSq() > 1e-6) {
        s.mesh.quaternion.setFromUnitVectors(
          _t.set(0, 1, 0), _v.normalize().multiplyScalar(-1));
      }
      s.mesh.rotateY(s.spin * dt);

      let hit = null;
      const step = Math.hypot(s.x - px, s.y - py, s.z - pz);
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (s.x - px) / step, (s.y - py) / step, (s.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((s.x - px) / step) * blocked,
            y: py + ((s.y - py) / step) * blocked,
            z: pz + ((s.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = s.x - ps.x;
        const dz = s.z - ps.z;
        const dy = s.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 1.5) {
          hit = { x: s.x, y: s.y, z: s.z, direct: true };
        }
      }
      if (!hit && s.y <= groundAt(s.x, s.z) + 0.2) {
        hit = { x: s.x, y: groundAt(s.x, s.z), z: s.z, direct: false };
      }
      if (hit) {
        s.live = false;
        s.mesh.visible = false;
        shatter(hit.x, hit.y, hit.z, hit.direct);
      } else if (s.life <= 0) {
        s.live = false;
        s.mesh.visible = false;
      }
    }
  }

  /** A shard coming apart, and the splinters it throws. The burst is
   *  what makes a near miss cost something - the shards are big and
   *  slow enough to dodge individually, so a volley that only punished
   *  direct hits would be free at any range. */
  function shatter(x, y, z, direct) {
    ctx.vfx?.spark?.(x, y, z, direct ? 1.9 : 1.1, !direct, false);
    ctx.vfx?.sandSpray?.(x, y + 0.2, z, 0.9, 0, 1);
    const ps = ctx.player?.state;
    if (direct) {
      ctx.combat?.hurtPlayer?.(C.spitDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
        source: "garner-shard", x, y, z,
      });
      ctx.player?.punch?.(0.8);
    } else if (ps && !ctx.combat?.player?.dead) {
      const d = Math.hypot(ps.x - x, ps.z - z);
      if (d < C.spitBurstRadius) {
        ctx.combat?.hurtPlayer?.(C.spitBurstDamage * (1 - d / C.spitBurstRadius)
          * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "garner-shrapnel", x: ps.x, y: ps.y + 1, z: ps.z,
        });
      }
    }
    bus.emit("shard", { x, y, z, direct });
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  const pitDist = (x, z) => Math.hypot(x - C.pitX, z - C.pitZ);

  function playerPoint() {
    const ps = ctx.player.state;
    return { x: ps.x, y: ps.y + 1.0, z: ps.z };
  }

  /** Where a limb should come up: near the player, offset so the
   *  eruption is beside them rather than under them, and clamped to
   *  the band the animal can actually reach. */
  function pickAnchor(arm) {
    const ps = ctx.player.state;
    const a = Math.random() * TAU;
    const out = lerp(C.armSpawnLead[0], C.armSpawnLead[1], Math.random());
    let x = ps.x + Math.cos(a) * out;
    let z = ps.z + Math.sin(a) * out;
    const d = pitDist(x, z);
    if (d > C.armMaxRadius || d < C.armMinRadius) {
      const clampd = clamp(d, C.armMinRadius, C.armMaxRadius);
      const ux = (x - C.pitX) / (d || 1);
      const uz = (z - C.pitZ) / (d || 1);
      x = C.pitX + ux * clampd;
      z = C.pitZ + uz * clampd;
    }
    arm.anchor.set(x, groundAt(x, z), z);
  }

  function beginErupt(arm) {
    if (arm.phase !== "sheathed") return false;
    pickAnchor(arm);
    sheathe(arm);
    arm.phase = "erupt";
    arm.timer = C.eruptSeconds;
    arm.goal.copy(arm.anchor);
    const y = arm.anchor.y;
    ctx.vfx?.breach?.(arm.anchor.x, y, arm.anchor.z, 5.2, 1.4);
    ctx.vfx?.sandSpray?.(arm.anchor.x, y + 0.3, arm.anchor.z, 2.2, 0, 1);
    bus.emit("erupt", { x: arm.anchor.x, y, z: arm.anchor.z, index: arm.index });
    return true;
  }

  /** Where a rearing limb is currently pointed. Tracked live through
   *  the first half of the rear and then LOCKED, which is the whole
   *  dodge window: the limb visibly follows the player, visibly stops
   *  following them, and then arrives.
   *
   *  Locking at the moment of the strike instead - which is what the
   *  first build did - makes the telegraph decorative. The player
   *  watches a limb cock back for a second, steps aside, and it
   *  re-aims into the step, because the aim was taken after the move.
   *  Every strike connected and there was nothing to read. */
  function trackAim(arm) {
    const ps = ctx.player.state;
    arm.aim.set(
      ps.x + lead.vx * 0.55,
      ps.y + 0.9,
      ps.z + lead.vz * 0.55
    );
  }

  function beginLash(arm) {
    arm.phase = "lash";
    arm.timer = C.lashSeconds;
    bus.emit("lash", { x: arm.anchor.x, z: arm.anchor.z, index: arm.index });
  }

  /** The contact frame. Everything the player can do about a lash
   *  happens between `beginLash` and here. */
  function resolveLash(arm) {
    const ps = ctx.player.state;
    const tip = arm.nodes[C.armNodes - 1];
    /* Tested against the LAST FOUR NODES rather than the tip alone.
       The strike deliberately lands past the player - that is what
       leaves the limb on the sand behind them - so a tip-only test
       would mean the closer they stand to the eruption, the safer they
       are, which is exactly backwards. Four nodes is the grasping pad
       and the three metres of limb behind it: the part of a tentacle
       that could actually close on somebody.
       ------------------------------------------------------------
       EACH NODE IS TESTED ON BOTH AXES, and the version that did not
       was a coin toss.

       It took the FLAT-CLOSEST of the four and then asked that one node
       to also be within reach vertically - so a limb whose pad closed on
       the player's chest was scored on whichever bend of itself happened
       to pass a few centimetres nearer in plan, and if that bend was
       buried in the funnel wall six metres below their boots the strike
       was recorded as a miss. Which bend wins is a function of where the
       limb surfaced and how far under the player that patch of ground
       is, so on the Ossuary's own slope the same lash against the same
       stationary player resolved either way at about even odds.

       "An attack that only lands on people who move is not a telegraph,
       it is a coin toss with the wrong face up" - and this was the other
       face of the same coin. The question was always whether ANY of the
       four closed on them. */
    let hit = false;
    for (let n = C.armNodes - 4; n < C.armNodes && !hit; n += 1) {
      const node = arm.nodes[n];
      hit = Math.hypot(ps.x - node.x, ps.z - node.z) <= C.grabRadius
        && Math.abs((ps.y + 1.0) - node.y) <= 3.4;
    }
    if (ctx.combat?.player?.dead || !hit) {
      /* THE MISS, and the payoff. It goes limp where it landed and
         everything about it is now a target the player put there. */
      arm.phase = "limp";
      arm.timer = C.limpSeconds;
      ctx.vfx?.blast?.(tip.x, groundAt(tip.x, tip.z) + 0.2, tip.z, 4.4);
      ctx.vfx?.sandSpray?.(tip.x, groundAt(tip.x, tip.z) + 0.3, tip.z, 2.4, 0, 1);
      ctx.player?.punch?.(0.45);
      bus.emit("lashMiss", { x: tip.x, z: tip.z, index: arm.index });
      return;
    }
    arm.phase = "seize";
    arm.timer = C.seizeSeconds;
    state.seizedBy = arm.index;
    state.seizeTick = 0;
    ctx.combat.hurtPlayer(C.seizeDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
      source: "garner-seize", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    ctx.player?.punch?.(1.6);
    ctx.player?.doctrineKick?.(1.0, 0.8);
    bus.emit("seize", { x: ps.x, z: ps.z, index: arm.index });
  }

  function releaseSeize(arm) {
    if (state.seizedBy === arm.index) state.seizedBy = -1;
    arm.phase = "limp";
    arm.timer = C.limpSeconds * 0.6;
    bus.emit("release", { index: arm.index });
  }

  /** A limb that has run out of pool. It does not retract - it falls
   *  where it is and the pan keeps it, which is the visible receipt
   *  for the melee the player just committed to. */
  function severArm(arm) {
    arm.phase = "severed";
    arm.timer = 0;
    arm.regrow = C.regrowSeconds;
    arm.severedFor = 0;
    if (state.seizedBy === arm.index) state.seizedBy = -1;
    state.severedCredit += 1;
    const tip = arm.nodes[Math.round(C.armNodes * 0.6)];
    ctx.vfx?.spark?.(tip.x, tip.y, tip.z, 3.2, false, true);
    ctx.vfx?.blast?.(arm.anchor.x, arm.anchor.y + 0.3, arm.anchor.z, 5.5);
    /* AND IT LEAVES SOMETHING. A cut limb thrashes down the length of
       itself and bleeds out along the sand, and the stain is the whole
       point: the brief asks for "ichor that lands and stains", and a
       boss whose damage exists only on its own body leaves an arena
       that looks the same at the end of the fight as at the start.

       `skidMark` rather than a decal of our own, because vfx.js owns
       the ground-mark atlas and this module may not add to it - a
       skid is a dark oriented bite into sand, which is exactly the
       shape a bleeding limb lying across a dune leaves. */
    for (let n = 1; n < C.armNodes; n += 2) {
      const a = arm.nodes[n - 1];
      const b = arm.nodes[n];
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      ctx.vfx?.skidMark?.(b.x, b.z, yaw, 1, 1.9);
    }
    ctx.player?.doctrineKick?.(0.7, 0.6);
    bus.emit("sever", {
      x: arm.anchor.x, z: arm.anchor.z, index: arm.index,
      severed: state.severedCredit,
    });
  }

  function regrowArm(arm) {
    arm.phase = "sheathed";
    arm.regrow = 0;
    arm.severedFor = 0;
    if (inst?.legHp) inst.legHp[arm.index] = inst.spec.legHealth;
    sheathe(arm);
    bus.emit("regrow", { index: arm.index });
  }

  function stepArm(arm, dt) {
    /* The pool is combat.js's, and it is authoritative: a limb whose
       health reached zero is cut, whatever this module thought it was
       doing at the time. */
    if (arm.phase !== "severed" && arm.phase !== "sheathed"
      && inst?.legHp && inst.legHp[arm.index] <= 0) {
      severArm(arm);
    }

    if (arm.phase === "sheathed") {
      sheathe(arm);
      return;
    }

    if (arm.phase === "severed") {
      arm.severedFor += dt;
      // It lies there for a few seconds, then the sand takes it.
      flop(arm, dt, 0.94);
      if (arm.severedFor > 3.5) {
        const sink = Math.min(1, (arm.severedFor - 3.5) * 0.35);
        for (const node of arm.nodes) node.y -= sink * dt * 2.4;
      }
      arm.regrow -= dt;
      if (arm.regrow <= 0 && state.phase === "feeding") regrowArm(arm);
      return;
    }

    arm.timer -= dt;

    if (arm.phase === "erupt") {
      /* Straight up and fast, out of its own hole. A piston at this
         point - the S-bend only appears once it has something to aim
         at - so this is a translation rather than a solve. */
      extrude(arm, 1 - clamp01(arm.timer / C.eruptSeconds));
      if (arm.timer <= 0) {
        arm.phase = "rear";
        arm.timer = C.rearSeconds;
        arm.goal.copy(arm.nodes[C.armNodes - 1]);
        trackAim(arm);
        bus.emit("rear", { x: arm.anchor.x, z: arm.anchor.z, index: arm.index });
      }
      return;
    }

    if (arm.phase === "rear") {
      /* THE TELEGRAPH. It stands up, leans AWAY from its target and
         hooks over - a cobra, not a crane. Leaning back is what makes
         the strike legible before it happens: the limb visibly loads,
         and the direction it loads away from is the direction it is
         about to come from.
         Tracking stops at the halfway mark; from there it is aimed at
         wherever the player WAS, which is the half-second they have to
         stop being there. */
      if (arm.timer > C.rearSeconds * 0.45) trackAim(arm);
      const dx = arm.aim.x - arm.anchor.x;
      const dz = arm.aim.z - arm.anchor.z;
      const d = Math.hypot(dx, dz) || 1;
      const back = 1 - clamp01(arm.timer / C.rearSeconds);
      arm.rear.set(
        arm.anchor.x - (dx / d) * C.armLength * (0.30 + back * 0.16),
        arm.anchor.y + C.armLength * (0.74 - back * 0.06),
        arm.anchor.z - (dz / d) * C.armLength * (0.30 + back * 0.16)
      );
      reachTo(arm, arm.rear, C.armLength * 0.30, dt * 7);
      if (arm.timer <= 0) beginLash(arm);
      return;
    }

    if (arm.phase === "lash") {
      /* Overshoot: it strikes THROUGH the target, which is what puts
         the limb on the sand past the player when they get out of the
         way rather than stopping politely where they were - and the
         limb lying past them is the whole reward for the dodge. */
      _v.copy(arm.aim).sub(arm.anchor);
      _v.y = 0;
      const flat = _v.length() || 1;
      /* A FIXED two metres past, not a percentage of the range. The
         first build overshot by 35%, which on a limb that surfaces
         eight to fourteen metres out puts the tip three to five metres
         beyond the player - past `grabRadius` - so a player who stood
         perfectly still was reliably MISSED. An attack that only lands
         on people who move is not a telegraph, it is a coin toss with
         the wrong face up. */
      _v.multiplyScalar(clamp(flat + 2, C.armLength * 0.45,
        C.armLength * 0.94) / flat).add(arm.anchor);
      _v.y = groundAt(_v.x, _v.z) + 0.5;
      // Negative curl: the slack goes DOWN, so the limb comes over the
      // top and lands flat rather than staying arched in the air.
      reachTo(arm, _v, -C.armLength * 0.10, dt * 22);
      if (arm.timer <= 0) resolveLash(arm);
      return;
    }

    if (arm.phase === "seize") {
      /* Held. The limb tracks the player because it has hold of them,
         and the player is being wound in - see `dragPlayer`. */
      const ps = ctx.player.state;
      _v.set(ps.x, ps.y + 1.2, ps.z);
      reachTo(arm, _v, C.armLength * 0.14, dt * 14);
      state.seizeTick += dt;
      if (state.seizeTick >= 0.5) {
        const seconds = state.seizeTick;
        state.seizeTick = 0;
        ctx.combat?.hurtPlayer?.(C.seizeTickDps * seconds
          * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "garner-seize", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
      }
      if (arm.timer <= 0 || ctx.combat?.player?.dead) releaseSeize(arm);
      return;
    }

    if (arm.phase === "limp") {
      flop(arm, dt);
      if (arm.timer <= 0) {
        arm.phase = "drag";
        arm.timer = C.dragSeconds;
        bus.emit("drag", { x: arm.anchor.x, z: arm.anchor.z, index: arm.index });
      }
      return;
    }

    if (arm.phase === "drag") {
      /* HOME. The anchor itself walks back toward the pit and the
         limb follows it across the sand, so the melee window is a
         moving one: standing still and swinging loses it.

         Slow on purpose. This is the only part of the encounter where
         the player is rewarded rather than threatened, and a window
         that closes faster than a trooper can cross ten metres is a
         window that exists only in the design document. */
      const dx = C.pitX - arm.anchor.x;
      const dz = C.pitZ - arm.anchor.z;
      const home = Math.hypot(dx, dz);
      const step = Math.min(home, C.dragSpeed * dt);
      if (home > 1e-3) {
        arm.anchor.x += (dx / home) * step;
        arm.anchor.z += (dz / home) * step;
        arm.anchor.y = groundAt(arm.anchor.x, arm.anchor.z);
        for (const node of arm.nodes) {
          node.x += (dx / home) * step * 0.85;
          node.z += (dz / home) * step * 0.85;
        }
      }
      flop(arm, dt, 0.92);
      // Swept: standing in front of a retracting limb is a shove, not
      // a punish - see `dragSweepDamage`.
      arm.sweepGap = Math.max(0, arm.sweepGap - dt);
      const ps = ctx.player.state;
      if (arm.sweepGap <= 0 && !ctx.combat?.player?.dead) {
        for (let n = 2; n < C.armNodes; n += 2) {
          const node = arm.nodes[n];
          if (Math.hypot(ps.x - node.x, ps.z - node.z) < 1.8
            && Math.abs((ps.y + 0.8) - node.y) < 2.2) {
            arm.sweepGap = 1.4;
            ctx.combat?.hurtPlayer?.(C.dragSweepDamage
              * SURVIVAL_CONFIG.enemyDamageMultiplier, {
              source: "garner-sweep", x: ps.x, y: ps.y + 1.0, z: ps.z,
            });
            ctx.player?.punch?.(0.7);
            bus.emit("sweep", { x: node.x, z: node.z, index: arm.index });
            break;
          }
        }
      }
      if (home < C.lidRadius + 2 || arm.timer <= 0) {
        arm.phase = "sheathed";
        ctx.vfx?.sandSpray?.(arm.anchor.x, arm.anchor.y + 0.3, arm.anchor.z,
          1.4, 0, 1);
        sheathe(arm);
      }
    }
  }

  /* ------------------------------------------------------------
     THE INHALE
     ------------------------------------------------------------ */

  function beginInhale() {
    state.inhaleWind = C.inhaleWindup;
    state.inhaleTimer = C.inhaleCadence;
    bus.emit("inhaleTelegraph", { x: C.pitX, z: C.pitZ });
  }

  function updateInhale(dt) {
    if (state.inhaleWind > 0) {
      state.inhaleWind -= dt;
      // The mouth gapes on the wind-up. This is the tell, and it is
      // the same aperture the gorge window uses - the player learns
      // one read and it means the same thing both times.
      state.mawOpen = damp(state.mawOpen, 0.95, 4.5, dt);
      /* THE ANTICIPATION, and on this animal it is the only place
         anticipation can live. "A pit cannot dodge, so its drama is
         entirely in anticipation - the ground trembling before a lash,
         the rim shedding dust, the maw dilating before an inhale."
         The gape was already here and it is not enough on its own,
         because it happens INSIDE the mouth and the player fighting
         this thing is usually looking at the pan.

         So the wind-up loads three ways at once: the mouth hauls
         itself down into the shaft, the pan sheds dust off the plate
         lips, and the camera trembles - all ramped over the wind-up so
         the frame the draw starts on is the loudest one. */
      const load = 1 - clamp01(state.inhaleWind / Math.max(1e-4, C.inhaleWindup));
      state.shudder = load;
      state.shakeTick -= dt;
      if (state.shakeTick <= 0) {
        state.shakeTick = 0.11;
        ctx.player?.punch?.(0.06 + load * 0.20);
        const plate = plates[(Math.random() * plates.length) | 0];
        ctx.vfx?.sandSpray?.(plate.lipX, plate.lipY, plate.lipZ,
          0.7 + load * 1.4,
          (C.pitX - plate.lipX) * 0.03, (C.pitZ - plate.lipZ) * 0.03);
      }
      if (state.inhaleWind <= 0) {
        state.inhaleFor = C.inhaleSeconds;
        // And the mouth comes back UP as it opens - the recoil of the
        // haul, so the draw starts on a movement rather than on a
        // held pose.
        state.recoil = -1.15;
        ctx.player?.doctrineKick?.(0.9, 0.7);
        bus.emit("inhale", { x: C.pitX, z: C.pitZ });
      }
      return;
    }
    if (state.inhaleFor <= 0) return;
    state.inhaleFor -= dt;
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead) return;
    const d = pitDist(ps.x, ps.z);
    if (d < C.inhaleRadius) {
      /* Falls off to nothing at the edge and is strongest at the lip,
         so the rim of the crater is a place a player can fight from
         and the slope into it is not. */
      const strength = Math.pow(1 - d / C.inhaleRadius, 1.4);
      const pull = C.inhalePull * strength * dt;
      const ux = (C.pitX - ps.x) / (d || 1);
      const uz = (C.pitZ - ps.z) / (d || 1);
      ps.x += ux * pull;
      ps.z += uz * pull;
      ctx.player?.applySlow?.(lerp(1, 0.62, strength), 0.2);
    }
    // The vortex. Dust off the pan spiralling in over the lip, thrown
    // from a ring so the spiral is the emitter rather than a fountain.
    state.dustTick -= dt;
    if (state.dustTick <= 0) {
      state.dustTick = 0.06;
      const a = atmos.elapsed * 2.4;
      for (let i = 0; i < 3; i += 1) {
        const ang = a + (i / 3) * TAU;
        const r = C.pitRimRadius * (0.55 + Math.random() * 0.55);
        const px = C.pitX + Math.cos(ang) * r;
        const pz = C.pitZ + Math.sin(ang) * r;
        // Inward AND tangential: a purely radial throw reads as a
        // drain, and what sells a vortex is the spin on the way in.
        ctx.vfx?.sandSpray?.(px, groundAt(px, pz) + 0.4, pz, 1.6,
          -Math.cos(ang) * 0.7 - Math.sin(ang) * 0.75,
          -Math.sin(ang) * 0.7 + Math.cos(ang) * 0.75);
      }
    }
  }

  /** Crossing the throat while it is drawing. Not a kill: a kill in a
   *  hole the player cannot see the bottom of is a death they cannot
   *  learn anything from. */
  function checkDevour() {
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead || state.open < 0.5) return;
    if (state.devourGap > 0) return;
    const d = pitDist(ps.x, ps.z);
    if (d > C.craterInner * C.keepOutScale) return;
    state.devourGap = C.devourLockout;
    ctx.combat.hurtPlayer(C.devourDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
      source: "garner-devour", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    // And thrown clear, past the lip, so the player lands somewhere
    // they can fight from rather than back in the mouth.
    const ux = (ps.x - C.pitX) / (d || 1);
    const uz = (ps.z - C.pitZ) / (d || 1);
    const out = C.pitRimRadius * 0.72;
    ps.x = C.pitX + ux * out;
    ps.z = C.pitZ + uz * out;
    ctx.player?.punch?.(2.2);
    ctx.player?.doctrineKick?.(1.4, 1.2);
    ctx.vfx?.blast?.(C.pitX, lipY + 1.5, C.pitZ, C.craterInner);
    bus.emit("devour", { x: ps.x, z: ps.z });
  }

  /** The rim the mouth occupies.
   *
   *  The FUNNEL is real ground and the player walks down it, but the
   *  THROAT is not walkable for two reasons that survive the terrain now
   *  carrying a bore: the collar, the shelf and the twenty-six-metre
   *  shaft are runtime meshes and runtime meshes are never in the
   *  collision grid, so the sand five metres down inside the mouth is a
   *  floor the player would stand on with the whole animal drawn around
   *  them - and the bore is deliberately shallow enough to climb out of
   *  (see GARNER_PIT's slope note), which means nothing about the ground
   *  itself keeps them out either. So the animal does it: inside the
   *  collar they are devoured and thrown, and short of that they are
   *  held at its face. */
  function keepOut() {
    const ps = ctx.player?.state;
    if (!ps || state.open < 0.35) return;
    const d = pitDist(ps.x, ps.z);
    const wall = C.craterInner * C.keepOutScale * clamp01(state.open);
    if (d >= wall) return;
    /* THE AXIS ITSELF USED TO BE A HOLE IN THIS. The bearing to push
       them out along is `(ps - pit) / d`, so a degenerate `d` was
       guarded by returning - which means a player who arrived exactly
       over the middle of the mouth was the one player it did not hold
       out of it. Any bearing will do when there is no bearing. */
    if (d < 1e-3) {
      ps.x = C.pitX + wall;
      ps.z = C.pitZ;
      return;
    }
    /* Reaching the collar while the mouth is DRAWING is the one way
       into it. Standing against the collar at any other time - which
       is exactly where a player has to stand to swing at an open
       gullet - is only ever being held off, because devouring them
       there would delete the reward the whole limb fight buys.
       The lockout counts as "any other time": a mouth that has just
       swallowed and cannot swallow again must go back to holding them
       off, or the five seconds it is recovering are five seconds the
       player can stand inside it. */
    if (state.inhaleFor > 0 && state.devourGap <= 0) { checkDevour(); return; }
    const ux = (ps.x - C.pitX) / d;
    const uz = (ps.z - C.pitZ) / d;
    ps.x = C.pitX + ux * wall;
    ps.z = C.pitZ + uz * wall;
  }

  /* ------------------------------------------------------------
     THE VOLLEY
     ------------------------------------------------------------ */

  function beginSpit() {
    state.spitWind = C.spitWindup;
    state.spitTimer = C.spitCadence;
    state.mawOpen = Math.max(state.mawOpen, 0.5);
    bus.emit("spitTelegraph", { x: C.pitX, z: C.pitZ });
  }

  function launchVolley() {
    const ps = ctx.player.state;
    const y = lipY + 2.2;
    for (let i = 0; i < C.spitShards; i += 1) {
      const spread = C.spitShards > 1 ? (i / (C.spitShards - 1) - 0.5) * 2 : 0;
      /* A FAN, not a shotgun. The shards land spaced across the ground
         the player is standing on rather than converging on them, so
         the answer is to move perpendicular to the pit - which is also
         the direction that takes you around the fight. */
      const tx = ps.x + spread * 7.5 + lead.vx * 0.55;
      const tz = ps.z + spread * 5.0 + lead.vz * 0.55;
      const v = ballistic(C.pitX, y, C.pitZ, tx, ps.y + 0.6, tz, C.spitSpeed);
      launchShard(C.pitX, y, C.pitZ,
        v.x + (Math.random() - 0.5) * C.spitSpread * C.spitSpeed,
        v.y + (Math.random() - 0.5) * C.spitSpread * C.spitSpeed,
        v.z + (Math.random() - 0.5) * C.spitSpread * C.spitSpeed);
    }
    ctx.vfx?.breach?.(C.pitX, y, C.pitZ, 8, 1.6);
    /* THE KICK. Seven bone shards leaving at thirty-four metres a
       second out of a mouth that does not move is a cannon on a
       gantry. It drops, and the mouth snaps most of the way shut on
       the same frame - the recovery is the half of the animation that
       says the attack cost it something. */
    state.recoil = 1.0;
    state.mawOpen = Math.min(state.mawOpen, 0.34);
    ctx.player?.punch?.(0.35);
    bus.emit("spit", { x: C.pitX, y, z: C.pitZ, count: C.spitShards });
  }

  /* ------------------------------------------------------------
     PHASES
     ------------------------------------------------------------ */

  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = false;    // the root is an empty anchor
    group.visible = !hidden;
  }

  function beginBreach() {
    state.phase = "breach";
    state.timer = C.breachSeconds;
    setEncounterGate(false, true);
    ctx.mission?.announce?.("THE OSSUARY IS AWAKE", 3.4);
    bus.emit("aggro", { x: C.pitX, z: C.pitZ });
    /* The reveal camera, once per encounter. Same borrowed free-cam the
       Distaff and the Apostate use; handed straight back, and combat
       and mission time never stop for it. Framed from the rim looking
       DOWN the axis of the pit, because the whole subject of the shot
       is a hole appearing. */
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const px = ctx.player.state.x;
      const pz = ctx.player.state.z;
      const dx = C.pitX - px;
      const dz = C.pitZ - pz;
      const d = Math.hypot(dx, dz) || 1;
      const camX = px + (dx / d) * Math.min(d * 0.3, 16);
      const camZ = pz + (dz / d) * Math.min(d * 0.3, 16);
      const camY = groundAt(camX, camZ) + 13;
      ctx.player.setFree(true, [camX, camY, camZ], [C.pitX, lipY + 1, C.pitZ], 52);
      state.releaseCameraAt = 0.9;
    }
  }

  function releaseEncounterCamera() {
    ctx.player?.setFree?.(false);
    state.releaseCameraAt = undefined;
  }

  function beginFeeding() {
    state.phase = "feeding";
    state.timer = 0;
    releaseEncounterCamera();
    setEncounterGate(false, false);
    state.armTimer = 0.6;
    bus.emit("engaged", { x: C.pitX, z: C.pitZ });
  }

  function beginGorge() {
    state.phase = "gorge";
    state.timer = C.gorgeSeconds;
    state.severedCredit = 0;
    state.inhaleFor = 0;
    state.inhaleWind = 0;
    state.spitWind = 0;
    if (inst) inst.collapsed = true;
    ctx.player?.doctrineKick?.(1.2, 1.0);
    bus.emit("gorge", { x: C.pitX, z: C.pitZ });
  }

  function endGorge() {
    state.phase = "feeding";
    state.gorgeGuard = C.gorgeGuard;
    if (inst) inst.collapsed = false;
    // The limbs come back with the window. A boss that recovers with
    // nothing to fight with is a boss the player waits out.
    for (const arm of arms) if (arm.phase === "severed") regrowArm(arm);
    bus.emit("gorgeEnd", { x: C.pitX, z: C.pitZ });
  }

  function beginSeal() {
    healToFull();
    clearHazards();
    state.phase = "sealing";
    state.timer = C.sealSeconds;
    state.disengageFor = 0;
    state.inhaleFor = 0;
    state.inhaleWind = 0;
    state.spitWind = 0;
    if (inst) inst.collapsed = false;
    for (const arm of arms) {
      arm.phase = "sheathed";
      sheathe(arm);
    }
    releaseEncounterCamera();
    bus.emit("sealing", { x: C.pitX, z: C.pitZ });
  }

  function stepFeeding(dt) {
    state.gorgeGuard = Math.max(0, state.gorgeGuard - dt);
    if (state.severedCredit >= C.gorgeThreshold && state.gorgeGuard <= 0) {
      beginGorge();
      return;
    }
    // The mouth works while it hunts, but never all the way open: the
    // gullet being a target is what the gorge window IS.
    const idle = 0.20 + Math.sin(atmos.elapsed * 0.7) * 0.08;
    if (state.inhaleWind <= 0 && state.inhaleFor <= 0 && state.spitWind <= 0) {
      state.mawOpen = damp(state.mawOpen, idle, 2.2, dt);
    }

    state.armTimer -= dt;
    state.inhaleTimer -= dt;
    state.spitTimer -= dt;

    updateInhale(dt);
    if (state.spitWind > 0) {
      state.spitWind -= dt;
      state.mawOpen = damp(state.mawOpen, 0.72, 5, dt);
      if (state.spitWind <= 0) launchVolley();
    }

    const busy = state.inhaleFor > 0 || state.inhaleWind > 0 || state.spitWind > 0;
    if (state.armTimer <= 0) {
      state.armTimer = C.armCadence;
      /* A wounded Garner fields MORE limbs rather than hitting harder.
         Damage escalation on a boss the player is already losing to is
         a difficulty spike; more targets on the pan is a busier fight
         with more melee windows in it, which is the fight getting
         louder rather than meaner. */
      const hurt = 1 - clamp01(inst ? inst.health / Math.max(1, inst.maxHealth) : 1);
      const want = Math.round(lerp(C.armVolley[0], C.armVolley[1], hurt));
      let sent = 0;
      for (const arm of arms) {
        if (sent >= want) break;
        if (beginErupt(arm)) sent += 1;
      }
    }
    if (!busy && state.inhaleTimer <= 0) beginInhale();
    else if (!busy && state.spitTimer <= 0) beginSpit();
  }

  function stepGorge(dt) {
    state.timer -= dt;
    // Wide open and held there. This is the read: the mouth is not
    // doing anything else, and everything it can be hurt by is inside
    // it.
    state.mawOpen = damp(state.mawOpen, 1, 3.4, dt);
    state.breathTick -= dt;
    if (state.breathTick <= 0) {
      state.breathTick = 0.28;
      ctx.vfx?.venomGas?.(C.pitX, lipY + 0.6, C.pitZ,
        C.craterInner * 0.7, 0.8);
    }
    if (state.timer <= 0) endGorge();
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death" || inst.health <= 0) {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        state.timer = 0;
        /* THE BREATH STOPS. `updateInhale` is only reached from
           `stepFeeding`, so a draw in progress when the last shot lands
           was harmless while nothing else read it - but `keepOut` now
           runs in this phase, to stop the player walking into a dead
           animal's throat, and its one way IN is `inhaleFor`. Left set,
           a Garner killed mid-inhale spent the rest of the level
           swallowing anyone who came near the corpse. */
        state.inhaleFor = 0;
        state.inhaleWind = 0;
        state.spitWind = 0;
        if (inst.state !== "death") enemies.kill?.(inst);
        for (const arm of arms) {
          if (arm.phase !== "sheathed" && arm.phase !== "severed") {
            arm.phase = "severed";
            arm.severedFor = 0;
            arm.regrow = Infinity;
          }
        }
        ctx.vfx?.breach?.(C.pitX, lipY, C.pitZ, C.pitRimRadius, 3.2);
        ctx.player?.doctrineKick?.(1.8, 1.6);
        bus.emit("defeated", { x: C.pitX, z: C.pitZ });
      }
      return;
    }

    const ps = ctx.player.state;
    const dist = pitDist(ps.x, ps.z);

    if (state.phase === "dormant") {
      if (!ctx.combat?.player?.dead && dist <= C.aggroRadius) beginBreach();
      return;
    }

    if (state.phase === "sealing") {
      state.timer -= dt;
      if (dist <= C.aggroRadius && !ctx.combat?.player?.dead) {
        // Walked back in before it finished closing. It simply reopens
        // from wherever it had got to.
        state.phase = "breach";
        state.timer = C.breachSeconds * (1 - state.open);
        setEncounterGate(false, true);
        bus.emit("aggro", { x: C.pitX, z: C.pitZ });
        return;
      }
      if (state.timer <= 0) {
        state.phase = "dormant";
        state.revealed = false;
        setEncounterGate(true, true);
        bus.emit("reset", { x: C.pitX, z: C.pitZ });
      }
      return;
    }

    /* The leash. Immediate in effect - health, limbs and hazards are
       already back the moment it gives up - with the closing pan as
       presentation on top, exactly like the Distaff's walk home. */
    if (dist > C.disengageRadius) {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginSeal(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "breach") {
      state.timer -= dt;
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        releaseEncounterCamera();
      }
      // The mouth cracks its teeth apart on the way up, so the first
      // thing the player sees of it is that it is a mouth.
      state.mawOpen = damp(state.mawOpen, 0.55, 1.4, dt);
      if (state.timer <= 0) beginFeeding();
      return;
    }

    if (state.phase === "feeding") stepFeeding(dt);
    else if (state.phase === "gorge") stepGorge(dt);
  }

  /* ------------------------------------------------------------
     PER-FRAME
     ------------------------------------------------------------ */

  /** Keep combat.js's view of the six limbs honest.
   *
   *  `legBroken` means "not a valid target this frame" to every hit
   *  test in combat.js, and that is exactly the question here - a limb
   *  underground is no more shootable than one that has been cut off.
   *  So the flag carries both, and the module keeps its own count of
   *  what has actually been severed rather than reading it back out. */
  function syncLimbs() {
    if (!inst) return;
    let severed = 0;
    for (let i = 0; i < arms.length; i += 1) {
      const arm = arms[i];
      const absent = arm.phase === "sheathed" || arm.phase === "severed";
      if (inst.legBroken) inst.legBroken[i] = absent;
      if (arm.phase === "severed") severed += 1;
    }
    inst.legsBroken = severed;
  }

  /** Mirror the health pool onto the shared surface kit.
   *
   *  GATED ON MOVEMENT, and not as a micro-optimisation. `applySurface`
   *  builds ONE uniform value object per material and hands the same
   *  object to every compile, precisely so that a recompile - which
   *  happens the first time a new light enters the scene - cannot
   *  silently reset how hurt the boss is. Writing it unconditionally
   *  every frame would work; writing it only when it moves also makes
   *  the QA hooks' "did the damage take" question answerable by
   *  reading the material back. */
  function syncDamage() {
    if (!inst) return;
    const hurt = clamp01(1 - inst.health / Math.max(1, inst.maxHealth));
    if (Math.abs(hurt - state.damage) > 0.004) {
      state.damage = hurt;
      /* HELD WELL UNDER 1, and that is a calibration and not a
         timidity. The kit's soot term darkens the coarse mottle's
         troughs by up to 79% at full damage, which on a surface whose
         coarsest octave is a third of a metre is not grime - it is
         camouflage. A badly hurt Garner photographed as a leopard.
         Half strength keeps the crease darkening and the wet break and
         loses the blotch, and the silhouette carries the rest: seven
         tusks are gone by then. */
      setSurfaceDamage(collarMat, hurt * 0.50);
      setSurfaceDamage(toothMat, hurt * 0.40);
      setSurfaceDamage(fleshMat, hurt * 0.26);
    }
    /* AND THE TEETH GO, one at a time and for good.
       The kit's damage response is a shader term - it can crack and
       scorch a surface but it cannot change a silhouette, and a boss
       whose OUTLINE never changes has not visibly been hurt. Seven of
       twenty-one over the fight is enough to read at forty metres and
       few enough that the mouth still closes. */
    const want = Math.round(hurt * 7);
    while (state.brokenTusks < want) {
      let picked = -1;
      for (let tries = 0; tries < 12 && picked < 0; tries += 1) {
        const i = (Math.random() * teeth.length) | 0;
        if (teeth[i].chip <= 0) picked = i;
      }
      if (picked < 0) break;
      breakTusk(picked);
      state.brokenTusks += 1;
    }
  }

  function updateVisuals(dt, opening) {
    if (opening) poseLid();
    poseTeeth();
    /* Up the shaft, and it stops AT the funnel's floor. `mawY` is the
       one place this creature's altitude is decided, and the ceiling on
       it is the ground it lives under.

       Everything ADDED to it here is under half a metre and is the
       animal's only weight cue - see the note on `state.breath`. The
       breath is slow and shallow while it hunts and deepens with the
       wind-up, so the same motion carries "alive" and "about to". */
    const alive = state.phase === "feeding" || state.phase === "gorge";
    if (alive) {
      state.breath += dt * (0.62 + state.shudder * 1.5);
      state.recoil = damp(state.recoil, 0, 3.2, dt);
    } else {
      state.recoil = 0;
      state.shudder = 0;
    }
    /* THE HAUL RELAXES HERE AND NOWHERE ELSE. It is raised by the
       inhale's wind-up, and the wind-up lives in `updateInhale`, which
       only `stepFeeding` calls - so a gorge window opening mid-wind-up
       (which cutting the third limb does, at any moment) froze the
       decay and left the mouth sitting eleven seconds lower than it
       belongs. A value that several phases can SET must be relaxed by
       the frame, not by the phase that set it. */
    if (state.inhaleWind <= 0) state.shudder = damp(state.shudder, 0, 5, dt);
    const swell = Math.sin(state.breath);
    const lift = alive
      ? swell * (0.16 + state.shudder * 0.34)
        - state.shudder * 0.55 - state.recoil * 0.62
      : 0;
    maw.position.set(C.pitX, mawY(state.open) + lift, C.pitZ);
    /* A SWALLOW, not a scale animation. Half a percent on the vertical
       and a quarter on the radius, in antiphase - a ring of muscle
       that draws in gets taller, which is the one deformation that
       reads as peristalsis rather than as a mesh being squashed. The
       hit nodes ride this and move by seven centimetres at the
       extreme, which is well inside the capsule radii in
       HITBOX.garner. */
    maw.scale.set(1 - swell * 0.006, 1 + swell * 0.012, 1 - swell * 0.006);
    maw.rotation.y += dt * 0.045;
    maw.updateMatrixWorld(true);
    gulletMat.uniforms.uTime.value = atmos.elapsed;
    /* A FLOOR UNDER THE APERTURE, because a furnace does not go out
       when the lid comes down. Tied strictly to `mawOpen` the throat
       was dark through the whole hunting phase - which is four of the
       five photographs anyone ever sees of this animal, and it left
       the district's only warm light source doing nothing in any of
       them. Light leaks between twenty-one fangs. */
    gulletMat.uniforms.uOpen.value = clamp01(Math.max(state.mawOpen, 0.45))
      * clamp01(state.open * 1.4);
    shaft.visible = state.open > 0.06;
    throatFloor.visible = shaft.visible;

    for (const arm of arms) writeArmGeometry(arm);
    armMesh.geo.attributes.position.needsUpdate = true;
    armMesh.geo.attributes.normal.needsUpdate = true;
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    const ps = ctx.player?.state;
    if (ps) {
      // The lash's lead, measured here because nothing else wants it.
      lead.vx = damp(lead.vx, (ps.x - lead.x) / Math.max(1e-4, d), 9, d);
      lead.vz = damp(lead.vz, (ps.z - lead.z) / Math.max(1e-4, d), 9, d);
      lead.x = ps.x;
      lead.z = ps.z;
    }

    state.devourGap = Math.max(0, state.devourGap - d);
    stepInstance(d);

    /* THE ONE SCALAR. Everything the player looks at is a function of
       it, in both directions: the reveal drives it to 1 and the leash
       drives it back to 0, and the geometry does not know or care
       which of those is happening. */
    const wantOpen = state.phase === "dormant" ? 0
      : state.phase === "sealing" ? 0
        : state.phase === "breach"
          ? clamp01(1 - state.timer / Math.max(1e-4, C.breachSeconds))
          : 1;
    const before = state.open;
    state.open = state.phase === "breach"
      ? wantOpen
      : damp(state.open, wantOpen, 1.6, d);
    const opening = Math.abs(state.open - before) > 1e-4;

    /* AND THE GROUND IS PART OF IT. The funnel is a displacement on the
       height field scaled by exactly this scalar, so the pan gives way
       on the same curve the lid comes apart on and the mouth rises on -
       one number, three surfaces, and the collision plane the player is
       standing on is the third of them.
       BEFORE `updateVisuals`, and that ordering is load-bearing:
       `poseLid` lays every slab on `funnelY`, which reads the live
       terrain. Posed first, the lid would spend the whole collapse a
       frame's worth of sand above the ground it is made of. */
    if (opening || state.phase === "breach") setPitReveal(state.open);

    if (state.phase === "feeding" || state.phase === "gorge") {
      for (const arm of arms) stepArm(arm, d);
    } else if (state.phase === "dead") {
      for (const arm of arms) stepArm(arm, d);
      state.mawOpen = damp(state.mawOpen, 0.08, 0.8, d);
    } else {
      for (const arm of arms) {
        if (arm.phase !== "sheathed") stepArm(arm, d);
      }
    }
    /* IN EVERY PHASE THE MOUTH IS UP, not only the two it fights in.
       A dead Garner's throat is still a hole in the ground with a
       five-metre bore under it, and `keepOut` is the only thing that has
       ever stopped a player from standing inside the collar - it was
       called from the feeding branch alone, so the corpse let them walk
       in. The function gates itself on `open` and its devour branch on
       an active draw, so calling it here costs a compare in the phases
       where the pan is shut. */
    keepOut();

    /* THE COLLAPSE'S OWN DUST, thrown off the lips of the plates that
       are actually moving. Sampled rather than emitted per plate:
       seventy-eight sprays a frame is the whole impact pool spent on
       one second of one boss. */
    if (opening && state.phase !== "dormant") {
      state.dustTick -= d;
      if (state.dustTick <= 0) {
        state.dustTick = 0.05;
        for (let i = 0; i < 4; i += 1) {
          const plate = plates[(Math.random() * plates.length) | 0];
          ctx.vfx?.sandSpray?.(plate.lipX, plate.lipY, plate.lipZ, 1.5,
            (C.pitX - plate.lipX) * 0.05, (C.pitZ - plate.lipZ) * 0.05);
        }
      }
    }

    if (state.seizedBy >= 0 && ps && !ctx.combat?.player?.dead) {
      /* Wound in. Written straight onto the player because that is the
         only honest way to move them - `player.update` has already run
         this frame and `postUpdate` has not, so the figure and camera
         both resolve against this. */
      const d2 = pitDist(ps.x, ps.z);
      if (d2 > C.craterInner * C.keepOutScale) {
        const ux = (C.pitX - ps.x) / (d2 || 1);
        const uz = (C.pitZ - ps.z) / (d2 || 1);
        ps.x += ux * C.seizeDragSpeed * d;
        ps.z += uz * C.seizeDragSpeed * d;
      }
      ctx.player?.applySlow?.(C.seizeSlowFactor, 0.25);
    }

    syncLimbs();
    syncDamage();
    updateShards(d);
    updateVisuals(d, opening || state.phase === "breach");

    /* Mirrored onto the instance, because the HUD's minimap, the
       mission marker and the arena-boundary check all ask every enemy
       where it is and none of them should have to learn what a pit
       is. Its `y` is the mouth, not the pan: a hit capsule anchored to
       the floor of the crater would sit nine metres under the thing
       being shot at. */
    inst.x = C.pitX;
    inst.z = C.pitZ;
    inst.y = mawY(state.open);
    inst.yaw = 0;
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
    if (inst.legHp) {
      for (let i = 0; i < inst.legHp.length; i += 1) {
        inst.legHp[i] = inst.spec.legHealth;
      }
    }
    if (inst.legBroken) inst.legBroken.fill(true);
    inst.legsBroken = 0;
    inst.collapsed = false;
    state.severedCredit = 0;
    state.seizedBy = -1;
    /* THE FACE HEALS TOO. Health, limbs and hazards were already
       being restored here; the surface damage and the snapped tusks
       were not, so a boss that sealed and reopened at full health came
       back up scorched and gap-toothed - the leash's whole point is
       that the encounter starts again, and a damage state that
       survives it is a save-file bug waiting to be reported as an art
       one. */
    state.damage = 0;
    setSurfaceDamage(collarMat, 0);
    setSurfaceDamage(toothMat, 0);
    setSurfaceDamage(fleshMat, 0);
    if (state.brokenTusks > 0) {
      state.brokenTusks = 0;
      for (const tooth of teeth) {
        if (tooth.chip > 0 && !tooth.bornBroken) {
          tooth.chip = 0;
          paintTooth(fangs.colour, tooth);
        }
      }
      fangs.geo.attributes.color.needsUpdate = true;
    }
  }

  function clearHazards() {
    for (const s of shards) { s.live = false; s.mesh.visible = false; }
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    inst = enemies.spawn("garner", C.pitX, C.pitZ, {
      yaw: 0,
      eventId: "district-boss:ossuary",
    });
    if (!inst) return null;
    /* The limb pools, built here rather than in `spawn`. The bestiary
       declares `legs: 0` because there is no leg rig to gather bones
       from, so the arrays the shared hit table needs are this module's
       to make - and the chain each one is measured along is a set of
       plain Object3Ds, not bones. */
    inst.legs = arms.map((arm) => ({ chain: arm.chain, garnerArm: arm.index }));
    inst.legHp = arms.map(() => inst.spec.legHealth);
    inst.legBroken = arms.map(() => true);
    inst.legsBroken = 0;
    inst.bones.set("garner_throat", throatNode);
    inst.bones.set("garner_lip", lipNode);
    for (const arm of arms) {
      arm.anchor.set(C.pitX, floorY, C.pitZ);
      sheathe(arm);
    }
    setPitReveal(state.open);
    poseLid();
    poseTeeth();
    setEncounterGate(true, true);
    return inst;
  }

  /** The hard reset - QA and save-restore only. Snaps rather than
   *  animating, because a restore has no business playing a reveal. */
  function resetToPit() {
    state.defeated = false;
    /* A DEAD INSTANCE IS NOT A RESETTABLE ONE, and this reset used to
       assume it was.
       `enemies` retires a corpse once its death animation has run, so
       after a kill the reference this module holds is to something that
       is no longer in `enemies.live` - and `healToFull` then wrote full
       health onto an object nothing reads. Everything downstream came
       back half-alive: the pit reopened because `stepInstance` still saw
       `inst.state === "death"` and drove `open` to 1 for a corpse, and a
       harness that killed the boss could never get a live one back. Drop
       it and spawn again, which is what "reset" has always claimed. */
    if (inst && (inst.state === "death" || !enemies.live.includes(inst))) {
      enemies.remove?.(inst);
      inst = null;
    }
    if (!inst) ensureSpawned();
    if (!inst) return;
    healToFull();
    clearHazards();
    state.phase = "dormant";
    state.timer = 0;
    state.open = 0;
    state.mawOpen = 0.12;
    state.revealed = false;
    state.disengageFor = 0;
    state.severedCredit = 0;
    state.gorgeGuard = 0;
    state.inhaleFor = 0;
    state.inhaleWind = 0;
    state.spitWind = 0;
    state.breath = 0;
    state.shudder = 0;
    state.recoil = 0;
    releaseEncounterCamera();
    state.armTimer = C.armCadence * 0.7;
    state.inhaleTimer = C.inhaleCadence * 0.55;
    state.spitTimer = C.spitCadence * 0.8;
    for (const arm of arms) {
      arm.phase = "sheathed";
      arm.timer = 0;
      arm.regrow = 0;
      arm.severedFor = 0;
      arm.anchor.set(C.pitX, floorY, C.pitZ);
      sheathe(arm);
    }
    setPitReveal(state.open);
    poseLid();
    poseTeeth();
    setEncounterGate(true, true);
    bus.emit("reset", { x: C.pitX, z: C.pitZ });
  }

  function status() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", dead: true, defeated: true,
        health: 0, maxHealth: 7400, x: C.pitX, z: C.pitZ,
      } : null;
    }
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      open: Number(state.open.toFixed(3)),
      mawOpen: Number(state.mawOpen.toFixed(3)),
      gorging: state.phase === "gorge",
      exposed: !!inst.collapsed,
      armsUp: arms.filter((a) => a.phase !== "sheathed" && a.phase !== "severed").length,
      armsDown: arms.filter((a) => a.phase === "limp" || a.phase === "drag").length,
      armsSevered: arms.filter((a) => a.phase === "severed").length,
      armPhases: arms.map((a) => a.phase),
      armHp: inst.legHp ? inst.legHp.map((v) => Math.max(0, Math.round(v))) : [],
      severedCredit: state.severedCredit,
      seized: state.seizedBy >= 0,
      inhaling: state.inhaleFor > 0,
      /* Surfaced so a check about the DAMAGE STATE can be written
         against a number rather than against a screenshot. */
      damage: Number(state.damage.toFixed(3)),
      brokenTusks: teeth.filter((t) => t.chip > 0).length,
      shards: shards.filter((s) => s.live).length,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      dead: inst.state === "death",
      x: C.pitX,
      z: C.pitZ,
    };
  }

  function snapshot() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", timer: 0, instanceId: null, open: 0,
        health: 0, maxHealth: 7400, armHp: null, armPhases: null,
        defeated: true,
      } : null;
    }
    /* Shards are deliberately not persisted, for the Coulter's reason:
       restoring into a volley the player never saw thrown is worse
       than losing it. Limb phases ARE, because "three tentacles are
       down on the sand next to you" is most of the fight's state. */
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(state.timer.toFixed(2)),
      open: Number(state.open.toFixed(3)),
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      armHp: inst.legHp ? [...inst.legHp] : null,
      armPhases: arms.map((a) => a.phase),
      armRegrow: arms.map((a) => Number(Math.max(0, a.regrow).toFixed(2))),
      severedCredit: state.severedCredit,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((c) => c.eventId === "district-boss:ossuary" && c.key === "garner")
      || enemies.live.find((c) => c.key === "garner");
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      state.open = 0;
      /* AND THE PAN CLOSES OVER IT. This branch has always set `open` to
         zero; while the funnel was permanent terrain that meant nothing,
         and now it means the ground. A save reloaded after the kill
         therefore comes back to unbroken pan rather than to an empty
         hole with no animal in it - which is also the only arrangement
         that cannot leave a player standing in a throat that has nothing
         left to hold them out of it. */
      setPitReveal(0);
      group.visible = false;
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    const phase = ["dormant", "breach", "feeding", "gorge", "sealing", "dead"]
      .includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    state.revealed = phase !== "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.open = clamp01(Number(saved.open) || (phase === "dormant" ? 0 : 1));
    state.severedCredit = Math.max(0, Math.round(Number(saved.severedCredit) || 0));
    state.disengageFor = 0;
    state.gorgeGuard = 0;
    state.releaseCameraAt = undefined;
    state.seizedBy = -1;
    if (Number.isFinite(saved.health)) {
      inst.health = clamp(saved.health, 1, inst.maxHealth);
    }
    if (Array.isArray(saved.armHp) && inst.legHp) {
      for (let i = 0; i < inst.legHp.length; i += 1) {
        inst.legHp[i] = Number.isFinite(saved.armHp[i]) ? saved.armHp[i] : inst.legHp[i];
      }
    }
    /* A limb is restored SEVERED or SHEATHED and never mid-strike. The
       positions of fifteen nodes are not in the save and re-deriving a
       lash from its phase alone would put a tentacle somewhere the
       player did not leave it - which on a limb that damages by
       touching things is worse than losing the state. */
    for (let i = 0; i < arms.length; i += 1) {
      const arm = arms[i];
      const wasSevered = Array.isArray(saved.armPhases)
        && saved.armPhases[i] === "severed";
      arm.phase = wasSevered ? "severed" : "sheathed";
      arm.severedFor = wasSevered ? 3.4 : 0;
      arm.regrow = wasSevered
        ? clamp(Number(saved.armRegrow?.[i]) || C.regrowSeconds, 0, C.regrowSeconds)
        : 0;
      arm.timer = 0;
      arm.anchor.set(C.pitX, floorY, C.pitZ);
      sheathe(arm);
    }
    inst.collapsed = phase === "gorge";
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "breach");
    setPitReveal(state.open);
    poseLid();
    poseTeeth();
    syncLimbs();
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
    /** Close the pit and heal, with the animation. The arena boundary's
     *  reset path - see district-bosses.js - and the only way `sealing`
     *  is ever actually reached: the module's own disengage leash sits
     *  at 235m and the arena ring is at 112, so the ring always wins. */
    seal() {
      if (!inst || state.defeated) return null;
      if (state.phase === "dormant" || state.phase === "sealing") return null;
      beginSeal();
      return { phase: state.phase, timer: state.timer };
    },
    resetToPit,
    /** Force a phase, for checks about a phase rather than about how
     *  the animal gets into one - the same reasoning as the Distaff's
     *  and the Coulter's. */
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      if (state.phase === "dormant" || state.phase === "sealing") state.open = 0;
      else if (state.phase !== "breach") state.open = 1;
      /* Re-laid HERE, because `open` has just moved discontinuously and
         the per-frame path only re-poses the lid while it is changing -
         a deliberate saving, since a sealed pan and a fully open pit
         both cost nothing to hold. Forcing a phase skips the change, so
         without this the geometry keeps whatever the previous phase
         left it as: a boss forced to `gorge` for a check gaped at the
         underside of a lid that was still shut over it. */
      setPitReveal(state.open);
      poseLid();
      inst.collapsed = state.phase === "gorge";
      setEncounterGate(state.phase === "dormant",
        state.phase === "dormant" || state.phase === "breach");
      return { phase: state.phase, timer: state.timer, open: state.open };
    },
    /** Send one limb up now, for checks about the lash rather than
     *  about the clock that schedules it. */
    forceLash(index = 0) {
      const arm = arms[clamp(Math.round(index), 0, arms.length - 1)];
      if (!arm) return null;
      arm.phase = "sheathed";
      return beginErupt(arm) ? { index: arm.index, phase: arm.phase } : null;
    },
    /** Drop a limb straight to the melee window, skipping the strike
     *  it would have had to miss to get there. */
    forceArmDown(index = 0) {
      const arm = arms[clamp(Math.round(index), 0, arms.length - 1)];
      if (!arm || state.phase === "dormant") return null;
      if (arm.phase === "sheathed") pickAnchor(arm);
      const ps = ctx.player.state;
      arm.anchor.y = groundAt(arm.anchor.x, arm.anchor.z);
      /* Laid at its OWN length along the bearing to the player, not
         stretched between the two - the chain is fifteen metres and the
         player is usually nearer than that, and a line short of the
         limb's length is exactly the collapsed pose `solveToGoal`
         exists to avoid. */
      const dx = ps.x - arm.anchor.x;
      const dz = ps.z - arm.anchor.z;
      const d = Math.hypot(dx, dz) || 1;
      for (let n = 0; n < C.armNodes; n += 1) {
        const x = arm.anchor.x + (dx / d) * n * link;
        const z = arm.anchor.z + (dz / d) * n * link;
        arm.nodes[n].set(x, groundAt(x, z) + ARM_ROOT_R * 0.8, z);
      }
      arm.goal.copy(arm.nodes[C.armNodes - 1]);
      arm.phase = "limp";
      arm.timer = C.limpSeconds;
      return { index: arm.index, phase: arm.phase };
    },
    inhale() { beginInhale(); return { windup: state.inhaleWind }; },
    volley() { beginSpit(); return { windup: state.spitWind }; },
    instance() { return inst; },
    arms() { return arms.map((a) => ({ index: a.index, phase: a.phase })); },
    dispose() { scene.remove(group); },
  };
}
