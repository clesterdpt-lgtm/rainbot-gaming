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
   ============================================================ */

import { TAU, clamp, clamp01, damp, lerp, makeBus, makeRng } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { GARNER_PIT } from "saintfall/terrain.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

export const GARNER_CONFIG = Object.freeze({
  /* THE PIT ITSELF IS TERRAIN, and it is authored in terrain.js next to
     the districts rather than here. Everything in this file is what
     lives at the bottom of it. See the note on GARNER_PIT for why: the
     collision grid, the walking plane and the visible ground all come
     out of `heightAt`, and nothing built at runtime reaches any of
     them - so a pit made of scene geometry is a picture of a hole the
     player walks straight over. */
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
  /* HOW FAR THE COLLAR'S LIP STANDS ABOVE THE FUNNEL'S FLOOR - and
     the number that took three attempts to get honest.

     The mouth cannot be flush with the sand, because the terrain is a
     HEIGHT FIELD: there is no hole in it at any radius, so a throat
     level with the ground has ground across the bottom of it and reads
     as a bowl of sand. It needs to stand proud of whatever surface it
     is set into by however much throat you want to be able to see down.

     What it must never stand proud of is the DESERT. So the surface it
     rises from is the floor of a twelve-metre funnel, and five metres
     up from there still leaves the whole animal seven metres under the
     pan - which is precisely the shape of the thing this is: a beak in
     the bottom of a sand pit you have to climb down into. */
  mawStand: 5.0,
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

  eruptSeconds: 0.62,
  /* The telegraph, and the most important duration in the fight. Long
     enough to see a fifteen-metre limb stand up, pick you, and cock
     back; short enough that standing still through it is a decision
     rather than an oversight. */
  rearSeconds: 1.05,
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
  armCadence: 3.1,
  /* How many go at once, at full health and at none. A wounded Garner
     does not hit harder; it hits with more limbs, which is the same
     escalation the Coulter makes on its hunt window. */
  armVolley: [1, 3],
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

const PLATE_RINGS = 4;
const PLATE_SIDES = 26;

const SHARD_MAX = 22;

/* The palette. Bone outside, gut inside, and the gut is the only warm
   thing in the district - which is exactly why the mouth reads from
   the rim of the pan at night. */
const BONE_PALE = [0.86, 0.81, 0.68];
const BONE_DARK = [0.36, 0.32, 0.24];
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
const FLESH_DARK = [0.040, 0.014, 0.018];
const FLESH_MID = [0.130, 0.042, 0.042];
const FLESH_LIT = [0.215, 0.065, 0.058];
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
     is set into. */
  const rimY = groundAt(C.pitX + C.pitRimRadius + 34, C.pitZ);
  const floorY = groundAt(C.pitX, C.pitZ);
  const lipY = floorY + C.mawStand;
  /** The funnel's own floor at a radius, for laying the lid on it. */
  const funnelY = (radius) => groundAt(C.pitX + radius, C.pitZ);
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

     Three, and no more: the pan's own bone, the animal's flesh, and
     the gullet. Every mesh below shares one of them, so the entire
     boss - crater, mouth, teeth, six tentacles - costs four draw
     calls whatever it is doing.
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
  patchMaterial(boneMat, atmos, { rim: 1.05, glitter: 0.12, bio: 0.9 });

  const fleshMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.52,
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
  patchMaterial(fleshMat, atmos, { rim: 0.55, glitter: 0, bio: 0.85 });

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
  const collarMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.66,
    metalness: 0.0,
  });
  collarMat.name = "sf-garner-collar-mat";
  patchMaterial(collarMat, atmos, { rim: 0.34, glitter: 0, bio: 1.1 });

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
        for (let v = 0; v < 4; v += 1) {
          const inner = v === 0 || v === 3;
          const k = (b + v) * 4;
          const t = shade * (inner ? 0.6 : 1) * (0.86 + rng() * 0.28);
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
  }

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
  const shaft = (() => {
    const depth = 26;
    const geo = new THREE.CylinderGeometry(C.craterInner * 1.26,
      C.craterInner * 0.42, depth, 26, 3, true);
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      // Darker downward, so the eye reads depth from the walls alone
      // even when the gullet is shut and giving off nothing.
      const y = geo.attributes.position.getY(i);
      const t = clamp01((y + depth * 0.5) / depth);
      const shade = 0.016 + Math.pow(t, 2.4) * 0.10;
      colour[i * 4] = shade * 0.98;
      colour[i * 4 + 1] = shade * 0.90;
      colour[i * 4 + 2] = shade * 0.74;
      colour[i * 4 + 3] = 0;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-shaft";
    // Its mouth at the funnel's floor, everything else under it.
    mesh.position.set(C.pitX, lipY - depth * 0.5 + 0.4, C.pitZ);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  })();

  /* ------------------------------------------------------------
     THE BOTTOM OF THE VISIBLE THROAT

     A black disc laid just above the funnel's floor, inside the collar.

     It is the last consequence of the terrain being a height field.
     There is no hole in the ground at any radius, so the sand runs
     straight across the inside of the mouth - and without this the
     player looking down a lit gullet sees, five metres in, a nicely
     shaded dune. The disc is what turns those five metres into
     something with no bottom, and the collar hides the fact that it
     has one.
     ------------------------------------------------------------ */
  const throatFloor = (() => {
    const geo = new THREE.CircleGeometry(C.craterInner * 1.24, 24);
    geo.rotateX(-Math.PI / 2);
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      colour[i * 4] = 0.012;
      colour[i * 4 + 1] = 0.010;
      colour[i * 4 + 2] = 0.008;
      colour[i * 4 + 3] = 0;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-throat-floor";
    mesh.position.set(C.pitX, floorY + 0.16, C.pitZ);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    group.add(mesh);
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
     ============================================================ */
  const maw = new THREE.Group();
  maw.name = "sf-garner-maw";
  group.add(maw);

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
    const height = 11;
    const geo = new THREE.CylinderGeometry(C.craterInner * 1.08,
      C.craterInner * 1.30, height, 36, 3, true);
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < count; i += 1) {
      /* Chewed, not turned. A perfect cylinder around a mouth is a
         drainpipe; a per-vertex radial bite deep enough to facet under
         flat shading makes it a ring of fused plate that something
         grew. */
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      /* Deep enough to facet hard under flat shading. A shallow bite on
         a 36-segment tube is a barrel with grain; this is a ring of
         separate swallowing muscles that happen to be joined. */
      const bite = 1 - 0.22 * Math.abs(Math.sin(a * 9)) - 0.10 * Math.cos(a * 13);
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
      // Only the very lip catches the gullet's own light.
      colour[i * 4 + 3] = Math.pow(t, 7) * 0.55;
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

     Static. It never poses, so it costs one merge at construction and
     nothing per frame.
     ------------------------------------------------------------ */
  {
    const N = 20;
    const perFlap = 5;
    const position = new Float32Array(N * perFlap * 3);
    const colour = new Float32Array(N * perFlap * 4);
    const index = [];
    const base = C.craterInner * 1.30;
    for (let i = 0; i < N; i += 1) {
      const b = i * perFlap;
      index.push(b, b + 1, b + 4, b + 1, b + 2, b + 4,
        b + 2, b + 3, b + 4, b, b + 2, b + 1, b, b + 3, b + 2);
      const a = (i / N) * TAU + rng() * 0.06;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const w = (base * TAU / N) * 0.44;
      const drop = 2.2 + rng() * 2.6;
      const out = 1.1 + rng() * 1.5;
      // The four roots, set into the collar's lower flank...
      const rootY = -(11 * 0.5) + 1.2 + 2.4 + rng() * 1.2;
      const set = (v, x, y, z) => {
        position[(b + v) * 3] = x;
        position[(b + v) * 3 + 1] = y;
        position[(b + v) * 3 + 2] = z;
      };
      set(0, ca * base - sa * w, rootY, sa * base + ca * w);
      set(1, ca * (base - 0.5), rootY + w * 0.7, sa * (base - 0.5));
      set(2, ca * base + sa * w, rootY, sa * base - ca * w);
      set(3, ca * (base + 0.6), rootY - w * 0.5, sa * (base + 0.6));
      // ...and the tip, splayed out and down onto the floor.
      set(4, ca * (base + out), rootY - drop, sa * (base + out));
      for (let v = 0; v < perFlap; v += 1) {
        const k = (b + v) * 4;
        const tip = v === 4 ? 1 : 0;
        const shade = (tip ? 0.25 : 1) * (0.8 + rng() * 0.4);
        colour[k] = lerp(COLLAR_DARK[0], COLLAR_LIT[0], shade);
        colour[k + 1] = lerp(COLLAR_DARK[1], COLLAR_LIT[1], shade);
        colour[k + 2] = lerp(COLLAR_DARK[2], COLLAR_LIT[2], shade);
        colour[k + 3] = tip ? 0.30 : 0.05;
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
  const teeth = [];
  const fangs = (() => {
    const perTooth = 5;      // four base corners and a tip
    const total = TUSK_RINGS.reduce((sum, ring) => sum + ring.n, 0);
    const verts = total * perTooth;
    const position = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = [];
    for (let t = 0; t < total; t += 1) {
      const b = t * perTooth;
      // Four faces up to the tip, and a floor so it is not hollow when
      // the mouth is open and the player is looking straight down it.
      index.push(b, b + 1, b + 4, b + 1, b + 2, b + 4,
        b + 2, b + 3, b + 4, b + 3, b, b + 4,
        b, b + 2, b + 1, b, b + 3, b + 2);
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
          ring,
          base: idx * perTooth,
        });
        const shade = 0.5 + ring * 0.14;
        for (let v = 0; v < perTooth; v += 1) {
          const k = (idx * perTooth + v) * 4;
          // Tips paler than roots - enamel over bone - and the roots
          // carry a little of the gullet's own light.
          const tip = v === 4 ? 1 : 0;
          const t2 = clamp01(shade + tip * 0.46) * (0.88 + rng() * 0.2);
          colour[k] = lerp(BONE_DARK[0], BONE_PALE[0], t2);
          colour[k + 1] = lerp(BONE_DARK[1], BONE_PALE[1], t2);
          colour[k + 2] = lerp(BONE_DARK[2], BONE_PALE[2], t2);
          colour[k + 3] = tip ? 0 : 0.30;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.name = "sf-garner-teeth";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    maw.add(mesh);
    return { mesh, geo, position };
  })();

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
      const reach = tooth.height;
      const inward = Math.cos(lean);
      const up = Math.sin(lean);
      set(4,
        bx - ca * reach * inward + (-sa) * reach * tooth.skew * 0.4,
        tooth.y + reach * up + reach * 0.14,
        bz - sa * reach * inward + ca * reach * tooth.skew * 0.4);
    }
    fangs.geo.attributes.position.needsUpdate = true;
    fangs.geo.computeVertexNormals();
    fangs.geo.computeBoundingSphere();
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
      uGain: { value: 2.1 },
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
        // Only lit while the mouth is actually parted.
        float a = clamp(heat * uOpen * uGain, 0.0, 1.0);
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
    const geo = new THREE.CylinderGeometry(C.craterInner * 1.02, 1.1, 6, 22, 5, true);
    const mesh = new THREE.Mesh(geo, gulletMat);
    mesh.name = "sf-garner-gullet";
    mesh.position.y = -1.4;
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
        for (let s = 0; s < ARM_SIDES; s += 1) {
          const k = (base + n * ARM_SIDES + s) * 4;
          const under = clamp01(Math.cos((s / ARM_SIDES) * TAU) * 0.5 + 0.5);
          const warm = clamp01(t * 1.25) * (0.55 + under * 0.45);
          colour[k] = lerp(FLESH_DARK[0], FLESH_LIT[0], warm);
          colour[k + 1] = lerp(FLESH_DARK[1], FLESH_LIT[1], warm);
          colour[k + 2] = lerp(FLESH_DARK[2], FLESH_LIT[2], warm);
          // Sucker rings: every other node, on the underside only.
          colour[k + 3] = under > 0.72 && n % 2 === 1
            ? 0.22 + t * 0.34 : 0.02;
        }
      }
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
   */
  function writeArmGeometry(arm) {
    const p = armMesh.position;
    const nrm = armMesh.normal;
    const buried = arm.phase === "sheathed";
    for (let n = 0; n < C.armNodes; n += 1) {
      const node = arm.nodes[n];
      // Tangent from the neighbours, so the frame is continuous.
      const a = arm.nodes[Math.max(0, n - 1)];
      const b = arm.nodes[Math.min(C.armNodes - 1, n + 1)];
      _t.subVectors(b, a);
      if (_t.lengthSq() < 1e-8) _t.set(0, 1, 0);
      _t.normalize();
      // Any two perpendiculars will do; picking the one furthest from
      // the tangent avoids the degenerate cross at vertical.
      _n1.set(0, 1, 0);
      if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
      _n1.crossVectors(_t, _n1).normalize();
      _n2.crossVectors(_t, _n1).normalize();
      const tt = n / (C.armNodes - 1);
      /* The taper, and it is not linear. A tentacle is thickest just
         above the ground, holds most of its bulk through the middle,
         and only gives it up over the last quarter - and then swells
         again into the grasping pad, which is the part that lands next
         to the player and therefore the part that has to read. A
         straight lerp gave a traffic cone. */
      const pad = Math.pow(clamp01((tt - 0.86) / 0.14), 2) * 0.42;
      const radius = (buried ? 0 : 1)
        * (lerp(ARM_TIP_R, ARM_ROOT_R, Math.pow(1 - tt, 0.55)) + pad);
      for (let s = 0; s < ARM_SIDES; s += 1) {
        const ang = (s / ARM_SIDES) * TAU;
        const cx = _n1.x * Math.cos(ang) + _n2.x * Math.sin(ang);
        const cy = _n1.y * Math.cos(ang) + _n2.y * Math.sin(ang);
        const cz = _n1.z * Math.cos(ang) + _n2.z * Math.sin(ang);
        const k = (arm.base + n * ARM_SIDES + s) * 3;
        p[k] = node.x + cx * radius;
        p[k + 1] = node.y + cy * radius;
        p[k + 2] = node.z + cz * radius;
        nrm[k] = cx; nrm[k + 1] = cy; nrm[k + 2] = cz;
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
        + lerp(ARM_ROOT_R, ARM_TIP_R, n / (C.armNodes - 1)) * 0.92;
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
    color: new THREE.Color(0xd9cead),
    roughness: 0.8,
    metalness: 0,
    flatShading: true,
  });
  shardMat.name = "sf-garner-shard";
  patchMaterial(shardMat, atmos, { rim: 0.85, glitter: 0.2 });
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
       that could actually close on somebody. */
    let flat = Infinity;
    let vertical = Infinity;
    for (let n = C.armNodes - 4; n < C.armNodes; n += 1) {
      const node = arm.nodes[n];
      const f = Math.hypot(ps.x - node.x, ps.z - node.z);
      if (f < flat) {
        flat = f;
        vertical = Math.abs((ps.y + 1.0) - node.y);
      }
    }
    if (ctx.combat?.player?.dead || flat > C.grabRadius || vertical > 3.4) {
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
      if (state.inhaleWind <= 0) {
        state.inhaleFor = C.inhaleSeconds;
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

  /** The rim the mouth occupies. The pit is a hole in the picture but
   *  not in the collision grid - `groundHeight` is a max over terrain
   *  and authored surfaces, so nothing can lower it - and a player
   *  walking across the middle of an open mouth on invisible ground is
   *  the one artefact this encounter cannot have. So the animal keeps
   *  them out itself: inside the collar they are devoured and thrown,
   *  and short of that they are held at its face. */
  function keepOut() {
    const ps = ctx.player?.state;
    if (!ps || state.open < 0.35) return;
    const d = pitDist(ps.x, ps.z);
    const wall = C.craterInner * C.keepOutScale * clamp01(state.open);
    if (d >= wall || d < 1e-4) return;
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

  function beginFeeding() {
    state.phase = "feeding";
    state.timer = 0;
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
        ctx.player?.setFree?.(false);
        state.releaseCameraAt = undefined;
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

  function updateVisuals(dt, opening) {
    if (opening) poseLid();
    poseTeeth();
    /* Up the shaft, and it stops AT the funnel's floor. `mawY` is the
       one place this creature's altitude is decided, and the ceiling on
       it is the ground it lives under. */
    maw.position.set(C.pitX, mawY(state.open), C.pitZ);
    maw.rotation.y += dt * 0.045;
    maw.updateMatrixWorld(true);
    gulletMat.uniforms.uTime.value = atmos.elapsed;
    gulletMat.uniforms.uOpen.value = clamp01(state.mawOpen) * clamp01(state.open * 1.4);
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

    if (state.phase === "feeding" || state.phase === "gorge") {
      for (const arm of arms) stepArm(arm, d);
      keepOut();
    } else if (state.phase === "dead") {
      for (const arm of arms) stepArm(arm, d);
      state.mawOpen = damp(state.mawOpen, 0.08, 0.8, d);
    } else {
      for (const arm of arms) {
        if (arm.phase !== "sheathed") stepArm(arm, d);
      }
    }

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
    poseLid();
    poseTeeth();
    setEncounterGate(true, true);
    return inst;
  }

  /** The hard reset - QA and save-restore only. Snaps rather than
   *  animating, because a restore has no business playing a reveal. */
  function resetToPit() {
    state.defeated = false;
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
    state.releaseCameraAt = undefined;
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
