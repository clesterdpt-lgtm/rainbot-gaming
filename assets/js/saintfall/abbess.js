/* ============================================================
   SAINTFALL - the Abbess

   The Bloom's queen, and everything about her that is not geometry:
   what she lays, what it costs you to let it live, and the one second
   in her cycle where the safest place to be and the only place worth
   being are opposite sides of the same animal.

   WHAT SHE IS

   A physogastric termite queen. Her head and thorax are the size of a
   Harrow and armoured like one; behind them is twenty metres of pale
   swollen egg sac that cannot move, cannot be moved, and is most of
   what the player is looking at. She has not walked in years. She does
   not need to.

   The Matriarch stood here before her and was a WALKER with a brooding
   habit - a big Thresher that laid. This one inverts that: the brood is
   not a habit, it is the entire animal, and she is a building with a
   mouth on the front.

   WHY THIS IS ITS OWN MODULE, AND WHY IT HAS NO MODEL

   `procedural: true`, for the same two reasons the Garner has it. A
   twenty-metre abdomen that BREATHES, runs a peristaltic wave down
   itself every time it lays, and heaves bodily off the ground to slam
   is per-vertex motion on a surface, not a rotation of a skeleton. And
   her clutches land where the fight put them - on terrain, around
   whatever the player was standing behind - rather than where an
   exporter decided.

   THE FIGHT

     DORMANT   Seated in the Throat, folded down, dark. She ignores
               everything until the player crosses AGGRO_RADIUS.
     ROUSE     4.6s. The sac lights from inside, the abdomen lifts off
               the floor of the chamber, and the head comes round.
     SEATED    THE FIGHT. Three things on three clocks:

               THE CLUTCH is the encounter. She lays eggs in an arc
               behind her; each swells for a few seconds and splits
               into a Thresher. An egg is a target - shoot it and the
               Thresher never exists - so "she spawns a lot" is a
               problem with an answer rather than a tax.

               TROPHALLAXIS is why that answer matters. Her brood comes
               BACK to her, and every one that reaches her head feeds
               her. Ignore the swarm and it does not merely crowd you,
               it undoes the fight: a dozen Threshers walking home is
               most of a health bar returned.

               THE SLAM is what she does about anything that gets
               close. She heaves twenty metres of abdomen off the floor
               and drops it, and the ring goes down.

               And the slam is the fight's one real decision, because
               the raised abdomen exposes its UNDERSIDE - the one part
               of her that is sac rather than plate. The window in
               which she is about to hurt you most is the window in
               which she can be hurt most, and both of them are in the
               same two metres of ground.

     ROYAL     Once, under a third health. She lays a single royal cell
               and a MATRIARCH comes out of it. The district's previous
               guardian is now something this one produces.
     RETIRE    The leash. She folds back down at full health.

   Her brood's own pool is `inst.health` on ordinary Threshers, so
   nothing here is a special case for combat.js: they are spawned,
   they are killed, and this module only ever watches.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus, makeRng, smoothstep,
} from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { DISTRICTS } from "saintfall/terrain.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

/* The Throat: the clearing at the Bloom's centre, ringed by sixteen
   chitin spires leaning inward over it - see world.js, which keeps
   every other spire and membrane sac out of a 74m circle here.

   Repeated rather than exported because world.js builds asynchronously
   and this module needs the number at construction time. It is the one
   authored space in the district big enough to fight in and enclosed
   enough to read as a room, which is exactly what a royal chamber is. */
const THROAT_X = DISTRICTS.bloom.x - 40;
const THROAT_Z = DISTRICTS.bloom.z - 50;

export const ABBESS_CONFIG = Object.freeze({
  lairX: THROAT_X,
  lairZ: THROAT_Z,
  /* Facing out of the chamber's mouth, so a player walking in from the
     district arrives at her head rather than behind her - and her
     abdomen, which is the thing worth shooting, is the far half. */
  yaw: Math.PI * 0.28,

  /* Inside the spire ring, which stands at 34m. She is a place you
     walk into. */
  aggroRadius: 58,
  rouseSeconds: 4.6,
  arenaRadius: 104,
  disengageRadius: 210,
  disengageSeconds: 14,
  retireSeconds: 5.0,

  /* ------------------------------------------------------------
     THE BODY
     ------------------------------------------------------------ */
  /* Twenty metres of abdomen on a four-metre thorax. The ratio is the
     whole silhouette: anything closer to even reads as a big beetle,
     and a queen has to read as a body that outgrew its own animal. */
  abdomenLength: 20,
  abdomenRadius: 4.6,
  abdomenSegments: 13,
  /* How far the sac's belly sits off the chamber floor when she is
     seated. Small: she rests on it. */
  abdomenClearance: 1.1,

  /* ------------------------------------------------------------
     THE CLUTCH
     ------------------------------------------------------------ */
  clutchCadence: 7.5,
  clutchWindup: 1.15,
  /* Eggs per clutch at full health and at none. She does not hit
     harder as she dies; she lays faster and wider, which is the same
     escalation the Garner makes on limb count and for the same
     reason - more of the fight, not a bigger number. */
  clutchEggs: [3, 6],
  eggHatchSeconds: 5.2,
  /* An egg is a real target with a real pool. Two rifle shots or one
     swing: cheap enough that clearing a clutch is a decision the
     player can afford, dear enough that they cannot clear every
     clutch and still shoot her. */
  eggHealth: 45,
  eggMax: 26,
  /* Live brood she will tolerate. Past this she still lays - the
     animation and the tell are unchanged - but the eggs come out
     spent, which is far better than a queen that visibly stops
     working because an off-screen counter is full. */
  broodCap: 18,

  /* ------------------------------------------------------------
     TROPHALLAXIS
     ------------------------------------------------------------ */
  /* How near her head a child has to get to feed her, and what it is
     worth. Tuned against her pool: a full cap of eighteen walking home
     unopposed is about a third of her health, so ignoring the swarm
     is survivable exactly once. */
  feedRadius: 7.0,
  feedHeal: 145,
  /* How long a newborn hunts the player before it thinks about going
     home. Without this the whole brood turns round immediately and the
     fight becomes a queue rather than a swarm. */
  feedAfterSeconds: 11,

  /* ------------------------------------------------------------
     THE SLAM
     ------------------------------------------------------------ */
  slamCadence: 9.5,
  /* The heave. Long, and deliberately the longest telegraph in the
     game: it is also the vulnerability window, so every frame of it is
     something the player is being offered rather than something they
     are waiting through. */
  slamRise: 1.45,
  slamHold: 0.35,
  slamFall: 0.22,
  slamRadius: 17,
  slamDamage: 52,
  /* Knocked flat rather than merely hurt. The slow IS the stun - the
     player has no stun state, and taking their speed for two seconds
     inside a ring full of Threshers is what "you are on the floor"
     costs. */
  slamSlowFactor: 0.28,
  slamSlowSeconds: 2.0,
  /* And what it does to her OWN brood, which is most of why a good
     player learns to bait it: she does not distinguish. */
  slamBroodDamage: 90,
  /* Only thrown at something close enough to be worth twenty metres of
     abdomen. Further out and she lays instead. */
  slamRange: 21,

  /* THE UNDERSIDE. Multiplier and the aperture it needs - see
     HITBOX.abbess, which reads `inst.raised` to decide whether the
     ventral capsule exists at all. */
  raisedWeak: 0.55,

  /* ------------------------------------------------------------
     THE ROYAL CELL
     ------------------------------------------------------------ */
  royalAtHealth: 0.34,
  royalSeconds: 6.5,

  simRange: 620,
});

const SAC_SIDES = 12;
const EGG_SIDES = 7;
const EGG_RINGS = 4;

/* Pale, and pale is correct here even though the Garner taught the
   opposite lesson. That animal lived at the bottom of a sunlit sand
   funnel where mid-value belongs to the ground; this one sits in a
   violet chitin chamber under spore light, where the ground is dark and
   the only other pale thing in frame is bone. A swollen ivory sac is
   the brightest object in the district by design - she is what the
   player's eye should go to from the rim. */
const SAC_PALE = [0.335, 0.280, 0.262];
const SAC_DEEP = [0.105, 0.062, 0.092];
const SAC_VEIN = [0.30, 0.10, 0.24];
/* The tergites: the hard plates between the swollen segments, and they
   are the same chitin as her head rather than a darker shade of sac.
   Painting them as "dimmer cream" was the first pass and it made twenty
   metres of faint ring lines - the bands have to be a different
   MATERIAL to the eye, not a different exposure of the same one. */
const SAC_BAND = [0.055, 0.038, 0.070];
const CHITIN_DARK = [0.045, 0.030, 0.052];
const CHITIN_LIT = [0.155, 0.105, 0.185];
const EGG_PALE = [0.52, 0.46, 0.44];

export function buildAbbess(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = ABBESS_CONFIG;
  const rng = makeRng(0xab8e55);
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "abbess";
  group.visible = false;
  scene.add(group);

  const floorY = groundAt(C.lairX, C.lairZ);

  let inst = null;

  const state = {
    phase: "dormant",     // dormant, rouse, seated, royal, retire, dead
    timer: 0,
    /* 0 is folded and dark, 1 is lit and up. Everything about her that
       is not an attack is a function of it, which is what makes the
       reveal and the leash the same animation run in two directions. */
    woken: 0,
    /* How far the abdomen is off the floor, 0..1. Owned by the slam,
       read by combat.js through `inst.raised` - it is the aperture on
       her one weak point. */
    raised: 0,
    /* A peristaltic bulge travelling the sac, 0..1, or -1 for none. */
    wave: -1,
    clutchTimer: C.clutchCadence * 0.45,
    clutchWind: 0,
    slamTimer: C.slamCadence * 0.7,
    slamPhase: null,      // rise, hold, fall
    slamTime: 0,
    royalDone: false,
    disengageFor: 0,
    defeated: false,
    revealed: false,
    releaseCameraAt: undefined,
    fed: 0,
    laid: 0,
    breathTick: 0,
    dustTick: 0,
  };

  /* Her living children, and how long each has been alive. combat.js
     drives their walking; this module only ever decides where they are
     walking TO - see `updateBrood`. */
  const brood = [];

  /* ============================================================
     MATERIALS

     Three. The sac, which is the animal; chitin, which is her armour
     and her chamber's own material; and the eggs, which need to read
     as lit from inside at any hour because the player has to be able
     to tell a live one from a spent one across a dark room.
     ============================================================ */
  const sacMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.44,
    metalness: 0.0,
  });
  sacMat.name = "sf-abbess-sac";
  /* Smooth-shaded, like the Garner's limbs and for the same reason:
     everything faceted in this game is made, and a swollen membrane is
     the exception the rule points at. `bio` carries the veining, which
     is the only thing keeping a twenty-metre pale mass from reading as
     a boulder at night. */
  /* RIM LOW, and this is the second time this codebase has learned it.
     The atmosphere patch's sky-tinted rim is additive and independent of
     albedo, and on a twenty-metre SMOOTH surface every facet catches it
     at once - so at the Garner's own 1.35 the sac came back as one flat
     ivory mass with no form in it at all, and halving the paint did
     nothing because the paint was not what was being seen. Turned down,
     the diffuse lighting gets the body back and the segments read. */
  patchMaterial(sacMat, atmos, { rim: 0.28, glitter: 0, bio: 0.9 });

  const chitinMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.52,
    metalness: 0.05,
  });
  chitinMat.name = "sf-abbess-chitin";
  chitinMat.side = THREE.DoubleSide;
  patchMaterial(chitinMat, atmos, { rim: 0.85, glitter: 0.08, bio: 1.0 });

  const eggMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.38,
    metalness: 0.0,
  });
  eggMat.name = "sf-abbess-egg";
  patchMaterial(eggMat, atmos, { rim: 1.2, glitter: 0, bio: 2.6 });

  /* ============================================================
     THE ABDOMEN

     Thirteen rings on a curve, rewritten every frame.

     One geometry and one draw call for the largest single object in
     the district, and the alternative was never a rig: what this
     surface does is SWELL. It breathes at rest, it runs a bulge down
     its whole length every time she lays, and it heaves off the floor
     to slam - three superimposed radial and axial deformations that a
     skeleton can only approximate with enough bones to cost more than
     the mesh.
     ============================================================ */
  const segs = C.abdomenSegments;
  const sacVerts = segs * SAC_SIDES + 1;

  /* Per-ring authored profile, measured once. `swell` is the
     physogastric bulge - narrow at the waist, widest a third of the
     way back, tapering to the ovipositor - and `band` marks the rings
     that carry a dark tergite plate, which is what makes twenty metres
     of pale sac read as SEGMENTED rather than as a sausage. */
  const rings = [];
  for (let i = 0; i < segs; i += 1) {
    const t = i / (segs - 1);
    rings.push({
      t,
      /* Fat and forward, and THICK AT THE WAIST.

         Two explicit pieces rather than one sine, because the first
         version's curve started at 0.31 of full radius - a 1.4m stalk
         emerging from a 4.3m collar plate, which read as an abdomen
         somebody had parked behind the animal rather than one growing
         out of it. It has to leave the thorax at roughly the collar's
         own width, swell to full a third of the way back, and only then
         drain away to the ovipositor. */
      swell: t < 0.38
        ? lerp(0.86, 1.0, smoothstep(t / 0.38))
        : lerp(1.0, 0.16, Math.pow(smoothstep((t - 0.38) / 0.62), 0.9)),
      /* A constriction on every second ring. This is cheaper and reads
         better than modelling separate tergites: the eye takes the
         narrow rings as the joints between plates. */
      /* Deep enough to read as a joint at forty metres. At 0.915 the
         constrictions were a suggestion and the animal came out as one
         smooth bag; a queen's segments are separate swellings with hard
         rings cinched between them. */
      pinch: i % 2 === 1 ? 0.845 : 1,
      band: i % 2 === 1,
      /* Each segment has its own idea of when the breath reaches it,
         so the whole body undulates rather than pumping as one bag. */
      phase: t * 2.4,
    });
  }

  const sac = (() => {
    const position = new Float32Array(sacVerts * 3);
    const normal = new Float32Array(sacVerts * 3);
    const colour = new Float32Array(sacVerts * 4);
    const index = [];
    /* WOUND OUTWARD, and the first build was not.
       Every ring is laid in the frame (n1, n2, tangent), which is
       right-handed - so walking s forward around the ring turns
       POSITIVELY about the tangent, and the naive `a+s, b+s, b+n` order
       puts the face normal on the inside. All three hundred triangles
       faced inward, and with front-face culling that renders as the
       near wall vanishing and the inside of the far wall showing
       through it: the animal was see-through from half the angles in
       the chamber. The vertex normals were analytic and outward the
       whole time, so it lit correctly and only the silhouette betrayed
       it. `saintfall-abbess-fight.mjs` now audits the winding against
       those normals so it cannot come back. */
    for (let i = 0; i < segs - 1; i += 1) {
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const n = (s + 1) % SAC_SIDES;
        const a = i * SAC_SIDES;
        const b = (i + 1) * SAC_SIDES;
        index.push(a + s, b + n, b + s, a + s, a + n, b + n);
      }
    }
    const tip = segs * SAC_SIDES;
    const last = (segs - 1) * SAC_SIDES;
    for (let s = 0; s < SAC_SIDES; s += 1) {
      index.push(last + s, last + ((s + 1) % SAC_SIDES), tip);
    }
    for (let i = 0; i < segs; i += 1) {
      const ring = rings[i];
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const k = (i * SAC_SIDES + s) * 4;
        /* Underside pale and translucent, back darker and plated. A
           queen is lit from below by her own chamber and the belly is
           where the eggs show through, so the value gradient runs the
           opposite way to every other creature in the game. */
        /* SIN, NOT COS - the ring frame's `n1` is horizontal and `n2`
           points DOWN (see `poseAbdomen`), so the cosine term runs
           across her flanks and the sine term runs belly-to-back. Built
           on cosine, this whole ramp painted one side of her pale and
           the other dark, and the animal read as flat because its only
           value gradient was at ninety degrees to the light. */
        const under = clamp01(Math.sin((s / SAC_SIDES) * TAU) * 0.5 + 0.5);
        /* Hard contrast between belly and back. She is lit from below by
           her own chamber and from above by nothing, and a gentle ramp
           across that reads as a smooth object rather than as a body. */
        /* The floor is high enough that her BACK is a mid tone rather
           than a silhouette. It was 0.14 while the ramp was accidentally
           running across her flanks, where the darkest value only ever
           landed on a side the light was already catching; pointed
           correctly at the top of her it made twenty metres of animal
           read as a hole in the chamber. */
        const pale = (0.38 + under * 0.62) * (0.88 + rng() * 0.24)
          * lerp(1.0, 0.78, ring.t);
        /* A band is chitin; everything else is membrane. Two ramps
           rather than one, so the plates read as armour laid over the
           sac instead of as shadow on it. */
        const from = ring.band ? SAC_BAND : SAC_DEEP;
        const to = ring.band ? CHITIN_LIT : SAC_PALE;
        colour[k] = lerp(from[0], to[0], ring.band ? pale * 0.5 : pale);
        colour[k + 1] = lerp(from[1], to[1], ring.band ? pale * 0.5 : pale);
        colour[k + 2] = lerp(from[2], to[2], ring.band ? pale * 0.5 : pale);
        /* THE VEINS. Bright between the plates and brightest toward
           the ovipositor, so the light in her runs backward down the
           body toward where the eggs come out - which is the only
           cue that tells a player at range which end to shoot. */
        colour[k + 3] = ring.band ? 0.02
          : (0.05 + ring.t * 0.30) * (0.30 + under * 0.70);
      }
    }
    {
      const k = tip * 4;
      colour[k] = SAC_VEIN[0];
      colour[k + 1] = SAC_VEIN[1];
      colour[k + 2] = SAC_VEIN[2];
      colour[k + 3] = 0.70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), C.abdomenLength + 16);
    const mesh = new THREE.Mesh(geo, sacMat);
    mesh.name = "sf-abbess-sac";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, geo, position, normal };
  })();

  /* The live spine of the abdomen: one point per ring, in world space,
     recomputed each frame. Combat reads a capsule off it - see
     `inst.sacSpine` - so the hit volume is the pose rather than a
     guess about it. */
  const spine = [];
  for (let i = 0; i < segs; i += 1) spine.push(new THREE.Vector3());
  const spineRadius = new Float32Array(segs);

  const _v = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n1 = new THREE.Vector3();
  const _n2 = new THREE.Vector3();

  /**
   * Lay the abdomen out and write its geometry.
   *
   * The axis is an arc, not a line: it leaves the thorax level, sags
   * under its own mass through the middle, and lifts at the ovipositor.
   * `raised` rotates the whole arc about the waist, which is what makes
   * the slam one number rather than a choreography.
   */
  function poseAbdomen(dt) {
    const yaw = inst ? inst.yaw : C.yaw;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const wake = clamp01(state.woken);
    const lift = state.raised;
    /* The waist, and it sits INSIDE the collar rather than behind it.
       At 3.2m back the sac's first ring started a metre and a half
       clear of the collar plate's rear face, so the two halves of the
       animal were visibly separate objects with a gap of chamber floor
       between them. Tucked to 1.5 it emerges from under the plate,
       which is what a join looks like. */
    const wx = C.lairX - sx * 1.5;
    const wz = C.lairZ - sz * 1.5;
    const wy = floorY + C.abdomenClearance + 2.1 * wake;

    for (let i = 0; i < segs; i += 1) {
      const ring = rings[i];
      const along = ring.t * C.abdomenLength;
      /* The sag, and then the lift. Both are functions of `t` so the
         body bends rather than hinging: an abdomen that pivots at one
         point is a boom, and this one has to look like it is being
         carried by muscle it barely has. */
      const sag = -Math.sin(ring.t * Math.PI) * 0.9 * (1 - lift * 0.75)
        + Math.pow(ring.t, 1.6) * 1.5;
      const heave = Math.pow(ring.t, 1.25) * lift * 9.5;
      spine[i].set(wx - sx * along, wy + sag + heave, wz - sz * along);

      /* Breath, and the laying wave. The wave is a travelling gaussian
         rather than a sine so it reads as ONE thing moving down her
         rather than as the whole body oscillating. */
      const breath = Math.sin(atmos.elapsed * 1.15 - ring.phase) * 0.045;
      const wave = state.wave >= 0
        ? Math.exp(-((ring.t - state.wave) ** 2) / 0.018) * 0.30 : 0;
      spineRadius[i] = C.abdomenRadius * ring.swell * ring.pinch
        * (0.34 + wake * 0.66) * (1 + breath + wave);
    }

    /* And the geometry, with analytic normals off the ring frame -
       `computeVertexNormals` on a smooth-shaded sac bands visibly at
       every pinch, because it averages across the constriction. */
    const p = sac.position;
    const nrm = sac.normal;
    for (let i = 0; i < segs; i += 1) {
      const a = spine[Math.max(0, i - 1)];
      const b = spine[Math.min(segs - 1, i + 1)];
      _t.subVectors(b, a);
      if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
      _t.normalize();
      _n1.set(0, 1, 0);
      if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
      _n1.crossVectors(_t, _n1).normalize();
      _n2.crossVectors(_t, _n1).normalize();
      const r = spineRadius[i];
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const ang = (s / SAC_SIDES) * TAU;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        /* Flattened underneath. She rests on this: a circular section
           reads as a balloon, and the belly of something this heavy
           spreads where it meets the floor. */
        // Same axis correction as the colour ramp: `n2` is down.
        const squash = 1 - 0.22 * clamp01(Math.sin(ang));
        const cx = (_n1.x * ca + _n2.x * sa) * squash;
        const cy = (_n1.y * ca + _n2.y * sa) * squash;
        const cz = (_n1.z * ca + _n2.z * sa) * squash;
        const k = (i * SAC_SIDES + s) * 3;
        p[k] = spine[i].x + cx * r;
        p[k + 1] = spine[i].y + cy * r;
        p[k + 2] = spine[i].z + cz * r;
        nrm[k] = cx; nrm[k + 1] = cy; nrm[k + 2] = cz;
      }
    }
    const tip = segs * SAC_SIDES;
    const end = spine[segs - 1];
    const k = tip * 3;
    p[k] = end.x - _t.x * -spineRadius[segs - 1] * 1.4;
    p[k + 1] = end.y - _t.y * -spineRadius[segs - 1] * 1.4;
    p[k + 2] = end.z - _t.z * -spineRadius[segs - 1] * 1.4;
    nrm[k] = _t.x; nrm[k + 1] = _t.y; nrm[k + 2] = _t.z;

    sac.geo.attributes.position.needsUpdate = true;
    sac.geo.attributes.normal.needsUpdate = true;
    if (dt > 0) sac.mesh.visible = state.woken > 0.02;
  }

  /* ============================================================
     THE HEAD AND THORAX

     Small, dark and plated - and static, because unlike the sac they
     are exactly what a rigid body is for. Built once and carried on a
     group that turns to face the player.

     Everything the player is meant to shoot is behind them. That is
     the point of building her this way round: her armour is the part
     that looks at you.
     ============================================================ */
  const head = new THREE.Group();
  head.name = "sf-abbess-head";
  group.add(head);

  {
    const parts = [];
    const paint = (geo, lit, glow = 0) => {
      const count = geo.attributes.position.count;
      const colour = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        const t = lit * (0.8 + rng() * 0.4);
        colour[i * 4] = lerp(CHITIN_DARK[0], CHITIN_LIT[0], t);
        colour[i * 4 + 1] = lerp(CHITIN_DARK[1], CHITIN_LIT[1], t);
        colour[i * 4 + 2] = lerp(CHITIN_DARK[2], CHITIN_LIT[2], t);
        colour[i * 4 + 3] = glow;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
      return geo;
    };
    /** The same, on the sac's own bone ramp - for the parts of her that
     *  are plate rather than shell. */
    const paintPale = (geo, lit, glow = 0) => {
      const count = geo.attributes.position.count;
      const colour = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        const t = lit * (0.82 + rng() * 0.36);
        colour[i * 4] = lerp(SAC_BAND[0], SAC_PALE[0], t);
        colour[i * 4 + 1] = lerp(SAC_BAND[1], SAC_PALE[1], t);
        colour[i * 4 + 2] = lerp(SAC_BAND[2], SAC_PALE[2], t);
        colour[i * 4 + 3] = glow;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
      return geo;
    };
    /* SCALED UP FROM THE FIRST PASS, all of it.

       Proportionally a queen's fore-body IS tiny, and modelled to that
       proportion it disappeared: twenty metres of lit sac beside four
       metres of dark chitin in a dark chamber left the front of the
       animal reading as a shadow. She needs a head the eye can find,
       because the head is where her armour is and the armour is the
       reason the player has to walk around her. Half again as big, with
       the two things that give a face a focus - lit eyes, and pale
       mandibles against dark plate. */
    // Thorax: a low plated wedge, ribbed.
    const thorax = new THREE.CylinderGeometry(3.3, 4.0, 5.6, 9, 2, false);
    thorax.rotateX(Math.PI / 2);
    thorax.translate(0, 2.7, 1.8);
    parts.push(paint(thorax, 0.75));
    /* A collar plate where the thorax meets the sac. Longer and wider
       at its rear than the first pass so it OVERLAPS the abdomen's
       first two rings: the sac's own radius varies with her breath and
       with the laying wave, and a butt joint between two surfaces that
       both move opens and closes a seam every second. A skirt that
       swallows the join cannot. */
    const collar = new THREE.CylinderGeometry(4.9, 3.7, 3.4, 9, 1, false);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 2.7, -1.5);
    parts.push(paint(collar, 0.5));
    // Head: forward and down.
    const skull = new THREE.SphereGeometry(2.5, 11, 8);
    skull.scale(1, 0.80, 1.30);
    skull.translate(0, 2.3, 6.1);
    parts.push(paint(skull, 1.0, 0.06));
    /* The eyes. Two lit lozenges, and they are the only strongly
       emissive thing on her that is not the egg sac - which makes the
       head the second place the eye goes and the first place it
       returns to. */
    for (const side of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.62, 7, 5);
      eye.scale(1, 0.7, 1.5);
      eye.translate(side * 1.5, 2.85, 7.6);
      parts.push(paint(eye, 1.0, 1.0));
    }
    /* Mandibles: PALE, against dark plate. Chitin-on-chitin was
       invisible; a queen's jaws are the same material as her tergites
       and read as bone at this range, which is also the one cue that
       says this animal can still bite. */
    for (const side of [-1, 1]) {
      const jaw = new THREE.ConeGeometry(0.85, 5.0, 5);
      jaw.rotateX(Math.PI * 0.54);
      jaw.rotateZ(side * 0.34);
      jaw.translate(side * 1.45, 1.7, 8.6);
      parts.push(paintPale(jaw, 0.85));
      // ...and a shorter inner pair, so the mouth reads as a set.
      const inner = new THREE.ConeGeometry(0.5, 3.0, 5);
      inner.rotateX(Math.PI * 0.58);
      inner.rotateZ(side * 0.55);
      inner.translate(side * 0.7, 1.35, 7.9);
      parts.push(paintPale(inner, 0.6));
    }
    /* Six vestigial legs. She cannot walk on them and they are modelled
       to say so: too short for the body, splayed, and holding nothing
       up. A queen with usable legs is just a big insect. */
    for (let i = 0; i < 3; i += 1) {
      for (const side of [-1, 1]) {
        const leg = new THREE.CylinderGeometry(0.42, 0.18, 3.8, 5);
        leg.rotateZ(side * 1.05);
        leg.rotateX(-0.2 + i * 0.16);
        leg.translate(side * 3.1, 1.6, 3.6 - i * 1.9);
        parts.push(paint(leg, 0.4));
      }
    }
    const merged = mergeAll(THREE, parts);
    const mesh = new THREE.Mesh(merged, chitinMat);
    mesh.name = "sf-abbess-fore";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    head.add(mesh);
  }

  /** Minimal merge - three's own helper is an addon import this module
   *  does not otherwise need, and every part here shares one layout. */
  function mergeAll(T, geos) {
    let verts = 0;
    let idx = 0;
    for (const g of geos) {
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
      if (!g.attributes.normal) g.computeVertexNormals();
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
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(position, 3));
    out.setAttribute("normal", new T.BufferAttribute(normal, 3));
    out.setAttribute("color", new T.BufferAttribute(colour, 4));
    out.setIndex(new T.BufferAttribute(index, 1));
    return out;
  }

  /* ============================================================
     THE EGGS

     Pooled, like every other hazard in this game, and each one is a
     small independent creature-in-waiting with its own pool.

     One geometry for all of them, rewritten per frame - they SWELL,
     visibly, and the swell is the timer. A player who has learned to
     read a clutch knows how long they have without a HUD element
     telling them, because the egg that is about to split is the fat
     one.
     ============================================================ */
  const eggVerts = EGG_RINGS * EGG_SIDES + 2;
  const eggs = [];
  for (let i = 0; i < C.eggMax; i += 1) {
    eggs.push({
      live: false, x: 0, y: 0, z: 0, t: 0, hp: 0, seed: rng(), base: i * eggVerts,
    });
  }
  let eggCursor = 0;

  const eggMesh = (() => {
    const total = C.eggMax * eggVerts;
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const colour = new Float32Array(total * 4);
    const index = [];
    for (let e = 0; e < C.eggMax; e += 1) {
      const base = e * eggVerts;
      /* Outward, same correction as the sac's - the rings run down the
         egg while the angle runs positively about that axis, so the
         obvious order faces inward. The caps below were already right,
         which is exactly how a half-inverted mesh gets shipped: the
         ends look correct and only the walls are wrong. */
      for (let r = 0; r < EGG_RINGS - 1; r += 1) {
        for (let s = 0; s < EGG_SIDES; s += 1) {
          const n = (s + 1) % EGG_SIDES;
          const a = base + r * EGG_SIDES;
          const b = base + (r + 1) * EGG_SIDES;
          index.push(a + s, b + n, b + s, a + s, a + n, b + n);
        }
      }
      const top = base + EGG_RINGS * EGG_SIDES;
      const bot = top + 1;
      for (let s = 0; s < EGG_SIDES; s += 1) {
        const n = (s + 1) % EGG_SIDES;
        index.push(base + s, top, base + n);
        const lastRing = base + (EGG_RINGS - 1) * EGG_SIDES;
        index.push(lastRing + n, bot, lastRing + s);
      }
      for (let v = 0; v < eggVerts; v += 1) {
        const k = (base + v) * 4;
        colour[k] = EGG_PALE[0];
        colour[k + 1] = EGG_PALE[1];
        colour[k + 2] = EGG_PALE[2];
        /* Lit from inside, and the alpha is written per frame with the
           swell - a nearly-hatched egg is nearly a light source. */
        colour[k + 3] = 0.4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), 80);
    const mesh = new THREE.Mesh(geo, eggMat);
    mesh.name = "sf-abbess-eggs";
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return { mesh, geo, position, normal, colour };
  })();

  /** Write one egg's ellipsoid, or collapse it to nothing if dead. */
  function writeEgg(egg) {
    const p = eggMesh.position;
    const nrm = eggMesh.normal;
    const col = eggMesh.colour;
    /* Swells from a third of full size to slightly over it, then the
       last tenth of its life is a visible shudder. */
    const grow = egg.live ? lerp(0.34, 1.06, Math.pow(egg.t, 0.7)) : 0;
    const shake = egg.live && egg.t > 0.86
      ? Math.sin(atmos.elapsed * 26 + egg.seed * 9) * 0.10 * (egg.t - 0.86) / 0.14 : 0;
    const R = 1.15 * (grow + shake);
    const H = 1.55 * (grow + shake);
    const glow = egg.live ? 0.25 + Math.pow(egg.t, 2) * 1.15 : 0;
    for (let r = 0; r < EGG_RINGS; r += 1) {
      const v = (r + 0.5) / EGG_RINGS;
      const ry = Math.cos(v * Math.PI);
      const rr = Math.sin(v * Math.PI);
      for (let s = 0; s < EGG_SIDES; s += 1) {
        const ang = (s / EGG_SIDES) * TAU;
        const k = (egg.base + r * EGG_SIDES + s) * 3;
        const cx = Math.cos(ang) * rr;
        const cz = Math.sin(ang) * rr;
        p[k] = egg.x + cx * R;
        p[k + 1] = egg.y + ry * H + H;
        p[k + 2] = egg.z + cz * R;
        nrm[k] = cx; nrm[k + 1] = ry; nrm[k + 2] = cz;
        col[(egg.base + r * EGG_SIDES + s) * 4 + 3] = glow;
      }
    }
    const top = egg.base + EGG_RINGS * EGG_SIDES;
    const bot = top + 1;
    for (const [vi, sign] of [[top, 1], [bot, -1]]) {
      const k = vi * 3;
      p[k] = egg.x;
      p[k + 1] = egg.y + H + sign * H;
      p[k + 2] = egg.z;
      nrm[k] = 0; nrm[k + 1] = sign; nrm[k + 2] = 0;
      col[vi * 4 + 3] = glow;
    }
  }

  function layEgg(x, z) {
    const egg = eggs[eggCursor];
    eggCursor = (eggCursor + 1) % eggs.length;
    egg.live = true;
    egg.x = x;
    egg.z = z;
    egg.y = groundAt(x, z);
    egg.t = 0;
    egg.hp = C.eggHealth;
    egg.seed = rng();
    state.laid += 1;
    ctx.vfx?.spark?.(x, egg.y + 0.6, z, 1.1, false, true);
    bus.emit("egg", { x, y: egg.y, z, index: eggs.indexOf(egg) });
    return egg;
  }

  /** Hatch, or fail to. A capped brood still lays - the tell has to be
   *  identical whether or not the spawn arrives - but the egg comes out
   *  spent rather than silently not being laid. */
  function hatchEgg(egg) {
    egg.live = false;
    pruneBrood();
    if (brood.length >= C.broodCap) {
      ctx.vfx?.spark?.(egg.x, egg.y + 0.5, egg.z, 1.4, false, false);
      bus.emit("stillborn", { x: egg.x, z: egg.z });
      return null;
    }
    const kid = enemies.spawn("thresher", egg.x, egg.z, {
      yaw: rng() * TAU,
      emerge: { delay: 0, duration: 0.85, depth: 1.0 },
    });
    if (!kid) return null;
    /* Born awake and looking at you - a clutch that has to notice the
       player first gives away the seconds that make it a threat. */
    kid.alerted = true;
    kid.suspicion = 1;
    kid.abbessBornAt = atmos.elapsed;
    brood.push(kid);
    ctx.vfx?.blast?.(egg.x, egg.y + 0.4, egg.z, 2.4);
    bus.emit("hatch", { x: egg.x, y: egg.y, z: egg.z });
    return kid;
  }

  function killEgg(egg, x, y, z) {
    egg.live = false;
    ctx.vfx?.blast?.(x ?? egg.x, (y ?? egg.y) + 0.7, z ?? egg.z, 3.0);
    ctx.vfx?.spark?.(x ?? egg.x, (y ?? egg.y) + 0.7, z ?? egg.z, 2.2, false, true);
    bus.emit("eggKilled", { x: egg.x, y: egg.y, z: egg.z });
  }

  /**
   * Damage an egg through a world-space sphere test.
   *
   * Eggs are NOT enemies - they have no rig, no AI and no place in
   * `enemies.live` - so combat.js cannot route to them and this module
   * publishes a test instead. Every damage path in the game that can
   * reach the ground calls it: see `ctx.abbess.hitEggs` in combat.js's
   * shot, melee and explosion resolution.
   */
  function hitEggs(x, y, z, radius, damage) {
    let hits = 0;
    for (const egg of eggs) {
      if (!egg.live) continue;
      const dx = egg.x - x;
      const dz = egg.z - z;
      const dy = (egg.y + 1.4) - y;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      egg.hp -= damage;
      hits += 1;
      if (egg.hp <= 0) killEgg(egg, x, y, z);
      else ctx.vfx?.spark?.(egg.x, egg.y + 1.2, egg.z, 1.0, false, true);
    }
    return hits;
  }

  function updateEggs(dt) {
    for (const egg of eggs) {
      if (egg.live) {
        egg.t += dt / C.eggHatchSeconds;
        if (egg.t >= 1) hatchEgg(egg);
      }
      writeEgg(egg);
    }
    eggMesh.geo.attributes.position.needsUpdate = true;
    eggMesh.geo.attributes.normal.needsUpdate = true;
    eggMesh.geo.attributes.color.needsUpdate = true;
  }

  /* ============================================================
     THE BROOD

     She does not command them - combat.js's ordinary Thresher brain
     does, and it hunts the player. What this module adds is a REASON
     to come home, applied by moving the one thing that brain steers
     by: after `feedAfterSeconds` a child's aggro is released and it
     walks to her, and touching her head feeds her.
     ============================================================ */
  function pruneBrood() {
    for (let i = brood.length - 1; i >= 0; i -= 1) {
      const kid = brood[i];
      if (!kid || kid.state === "death" || kid.health <= 0
        || !enemies.live.includes(kid)) brood.splice(i, 1);
    }
  }

  function updateBrood(dt) {
    pruneBrood();
    if (!inst || state.phase === "dormant") return;
    const now = atmos.elapsed;
    for (const kid of brood) {
      const age = now - (kid.abbessBornAt || now);
      if (age < C.feedAfterSeconds) continue;

      /* RECALLED, and DRIVEN.

         The first version simply dropped the child's aggro and set its
         `home` to her, on the reasoning that combat.js already walks an
         unalerted creature back to its post. It does - but the sensing
         block ahead of that re-detects a player standing in the same
         room on the very next frame, so the child turned round, saw the
         trooper, and went back to work. Nothing ever reached her.

         So the encounter takes ownership (`inst.selfDriven`, honoured
         by stepEnemy) and walks them itself. That is also the better
         read: a nurse carrying food does not stop to fight, and a
         column of Threshers ignoring the player to file home past them
         is a far clearer statement of what is about to happen than any
         amount of them milling about. */
      if (!kid.selfDriven) {
        kid.selfDriven = true;
        kid.alerted = false;
        kid.suspicion = 0;
        kid.home = { x: C.lairX, z: C.lairZ };
        enemies.play?.(kid, "idle", 0.25);
        bus.emit("recall", { x: kid.x, z: kid.z });
      }

      const dx = C.lairX - kid.x;
      const dz = C.lairZ - kid.z;
      const d = Math.hypot(dx, dz);
      if (d <= C.feedRadius) { feed(kid); continue; }

      // Walked, not teleported, and around masonry like anything else.
      const speed = (kid.spec?.speed?.walk || 1.5) * 1.35;
      const step = Math.min(d, speed * dt);
      const nx = kid.x + (dx / d) * step;
      const nz = kid.z + (dz / d) * step;
      const out = ctx.collide?.slide
        ? ctx.collide.slide(kid.x, kid.z, nx, nz, null,
          kid.spec?.collisionRadius || 0.62)
        : [nx, nz];
      kid.x = out[0];
      kid.z = out[1];
      kid.yaw = dampAngle(kid.yaw, Math.atan2(dx, dz), 5, dt);
      kid.speed = speed;
      if (kid.state !== "idle") enemies.play?.(kid, "idle", 0.3);
    }
  }

  function feed(kid) {
    kid.selfDriven = false;
    const healed = Math.min(C.feedHeal, inst.maxHealth - inst.health);
    inst.health = Math.min(inst.maxHealth, inst.health + C.feedHeal);
    state.fed += 1;
    enemies.remove?.(kid);
    const i = brood.indexOf(kid);
    if (i >= 0) brood.splice(i, 1);
    ctx.vfx?.spark?.(kid.x, kid.y + 1.2, kid.z, 2.6, false, true);
    bus.emit("feed", { x: kid.x, z: kid.z, healed, health: inst.health });
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function faceTowards(x, z, rate, dt) {
    if (!inst) return;
    const dx = x - C.lairX;
    const dz = z - C.lairZ;
    if (Math.hypot(dx, dz) < 1e-3) return;
    /* She turns her HEAD, not her body. The abdomen is laid out along
       `inst.yaw` too, but clamped to a narrow arc around the seat: a
       queen who pivots twenty metres of egg sac to track the player is
       a tank turret, and the whole point of her is that she cannot get
       out of the way. */
    const want = Math.atan2(dx, dz);
    inst.yaw = dampAngle(inst.yaw, clampToSeat(want), rate, dt);
    head.rotation.y = inst.yaw;
    head.position.set(C.lairX, floorY, C.lairZ);
    head.updateMatrixWorld(true);
  }

  function clampToSeat(want) {
    let rel = want - C.yaw;
    while (rel > Math.PI) rel -= TAU;
    while (rel < -Math.PI) rel += TAU;
    return C.yaw + clamp(rel, -0.8, 0.8);
  }

  function beginClutch() {
    state.clutchWind = C.clutchWindup;
    state.clutchTimer = C.clutchCadence;
    bus.emit("clutchTelegraph", { x: C.lairX, z: C.lairZ });
  }

  /* ============================================================
     KEEPING THE PLAYER OUT OF HER

     Twenty-six metres of animal that the player could walk straight
     through, because none of it exists as far as the collision grid is
     concerned - that grid is rasterised once, at load, from the
     authored world, and everything in this file is built at runtime.
     The Garner's mouth had the same problem and the same answer: the
     creature holds them off itself.

     Tested against the LIVE sac, one capsule per segment, so it agrees
     with what is on screen at every moment of her breath, her laying
     wave and her slam. Which also means the one place the fight wants
     the player to be stays open by construction: while the abdomen is
     raised, its capsules are nine metres up and the ground underneath
     them is free. Getting under her is supposed to be possible - it is
     where her weak point is - and nothing here has to special-case
     that, because the volume simply is not there any more.

     Horizontal pushes only. A vertical correction on a creature that
     heaves would launch or bury the trooper; being eased sideways out
     of a wall of flesh is what the rest of the game does.
     ============================================================ */
  const PLAYER_RADIUS = 1.05;

  /** Shove the player out of one capsule, in XZ. Returns true if it
   *  moved them, so the caller can settle overlapping segments. */
  function shoveOut(ps, ax, ay, az, bx, by, bz, ra, rb) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 1e-6
      ? clamp01(((ps.x - ax) * dx + (ps.z - az) * dz) / len2) : 0;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const cy = ay + (by - ay) * t;
    const r = lerp(ra, rb, t);
    /* Vertical gate first. A segment the player is standing well under
       or well over is not in their way, and this is the whole reason a
       raised abdomen can be walked beneath. */
    if (Math.abs((ps.y + 0.95) - cy) > r + 1.15) return false;
    const want = r + PLAYER_RADIUS;
    let ox = ps.x - cx;
    let oz = ps.z - cz;
    const d = Math.hypot(ox, oz);
    if (d >= want) return false;
    if (d < 1e-4) {
      // Dead on the axis: pick a bearing rather than divide by zero.
      ox = Math.cos(atmos.elapsed * 3.1);
      oz = Math.sin(atmos.elapsed * 3.1);
    } else {
      ox /= d;
      oz /= d;
    }
    ps.x = cx + ox * want;
    ps.z = cz + oz * want;
    return true;
  }

  function keepOut() {
    const ps = ctx.player?.state;
    if (!ps || state.woken < 0.25 || ctx.combat?.player?.dead) return;
    /* Two passes. Shoving clear of one segment can push the player into
       the next one along a body that curves, and a single pass leaves
       them standing inside her with the correction fighting itself. */
    for (let pass = 0; pass < 2; pass += 1) {
      let moved = false;
      // The thorax and its collar, as one upright capsule at her seat.
      moved = shoveOut(ps, C.lairX, floorY + 2.7, C.lairZ,
        C.lairX, floorY + 4.4, C.lairZ, 4.3, 3.4) || moved;
      for (let i = 0; i < segs - 1; i += 1) {
        moved = shoveOut(ps,
          spine[i].x, spine[i].y, spine[i].z,
          spine[i + 1].x, spine[i + 1].y, spine[i + 1].z,
          spineRadius[i], spineRadius[i + 1]) || moved;
      }
      if (!moved) break;
    }
  }

  function layClutch() {
    const hurt = 1 - clamp01(inst.health / Math.max(1, inst.maxHealth));
    const n = Math.round(lerp(C.clutchEggs[0], C.clutchEggs[1], hurt));
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    /* Behind her, in an arc across her own axis, and past the far end
       of the abdomen - so a clutch lands where the player has to walk
       around twenty metres of animal to reach it. That geometry is the
       mechanic: eggs are cheap to kill and expensive to get to. */
    for (let i = 0; i < n; i += 1) {
      const spread = (i - (n - 1) * 0.5) * 4.2 + (rng() - 0.5) * 1.6;
      const back = C.abdomenLength + 3 + rng() * 7;
      const x = C.lairX - sx * back - sz * spread;
      const z = C.lairZ - sz * back + sx * spread;
      layEgg(x, z);
    }
    // The wave that delivers them, travelling the length of her.
    state.wave = 0;
    ctx.vfx?.spark?.(C.lairX - sx * C.abdomenLength,
      floorY + 2, C.lairZ - sz * C.abdomenLength, 2.4, false, true);
    bus.emit("clutch", { x: C.lairX, z: C.lairZ, count: n });
  }

  function beginSlam() {
    state.slamPhase = "rise";
    state.slamTime = 0;
    state.slamTimer = C.slamCadence;
    ctx.player?.doctrineKick?.(0.45, 0.35);
    bus.emit("slamTelegraph", { x: C.lairX, z: C.lairZ });
  }

  /** The impact. Everything inside the ring goes down, INCLUDING her
   *  own children - which is most of why a good player learns to fight
   *  next to the brood rather than away from it. */
  function landSlam() {
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    // Centred under the abdomen's mass, not under her head.
    const cx = C.lairX - sx * C.abdomenLength * 0.55;
    const cz = C.lairZ - sz * C.abdomenLength * 0.55;
    const cy = groundAt(cx, cz);
    ctx.vfx?.blast?.(cx, cy + 0.4, cz, C.slamRadius * 0.6);
    ctx.vfx?.breach?.(cx, cy, cz, C.slamRadius, 2.4);
    ctx.player?.punch?.(1.8);
    ctx.player?.doctrineKick?.(1.3, 1.1);

    const ps = ctx.player?.state;
    if (ps && !ctx.combat?.player?.dead) {
      const d = Math.hypot(ps.x - cx, ps.z - cz);
      if (d < C.slamRadius) {
        const falloff = 1 - 0.55 * (d / C.slamRadius);
        ctx.combat.hurtPlayer(C.slamDamage * falloff
          * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "abbess-slam", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
        ctx.player?.applySlow?.(C.slamSlowFactor, C.slamSlowSeconds);
      }
    }
    /* Her own brood, through combat's authoritative shockwave so the
       kills count, the stuns apply and the kill feed sees them. */
    ctx.combat?.shockwave?.(cx, cy, cz, {
      radius: C.slamRadius,
      innerRadius: C.slamRadius * 0.35,
      damage: C.slamBroodDamage,
      stun: 1.6,
      knockSpeed: 11,
      source: "abbess-slam",
    });
    bus.emit("slam", { x: cx, y: cy, z: cz });
  }

  function stepSlam(dt) {
    state.slamTime += dt;
    if (state.slamPhase === "rise") {
      state.raised = clamp01(state.slamTime / C.slamRise);
      if (state.slamTime >= C.slamRise) {
        state.slamPhase = "hold";
        state.slamTime = 0;
      }
      return;
    }
    if (state.slamPhase === "hold") {
      state.raised = 1;
      if (state.slamTime >= C.slamHold) {
        state.slamPhase = "fall";
        state.slamTime = 0;
      }
      return;
    }
    // Falling, and fast: the whole read of the attack is that the rise
    // is slow enough to answer and the drop is not.
    state.raised = clamp01(1 - state.slamTime / C.slamFall);
    if (state.slamTime >= C.slamFall) {
      state.slamPhase = null;
      state.raised = 0;
      landSlam();
    }
  }

  function beginRoyal() {
    state.phase = "royal";
    state.timer = C.royalSeconds;
    state.royalDone = true;
    state.raised = 0;
    state.slamPhase = null;
    ctx.mission?.announce?.("THE ABBESS LAYS A ROYAL CELL", 3.6);
    ctx.player?.doctrineKick?.(1.1, 0.9);
    bus.emit("royal", { x: C.lairX, z: C.lairZ });
  }

  /** The one Matriarch. The district's previous guardian, produced by
   *  the thing that replaced it. */
  function hatchRoyal() {
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    const back = C.abdomenLength + 12;
    const x = C.lairX - sx * back;
    const z = C.lairZ - sz * back;
    const kid = enemies.spawn("matriarch", x, z, {
      yaw: inst.yaw + Math.PI,
      emerge: { delay: 0, duration: 1.8, depth: 2.4 },
    });
    if (kid) {
      kid.alerted = true;
      kid.suspicion = 1;
      kid.abbessBornAt = Infinity;   // it never goes home; it hunts
      brood.push(kid);
    }
    ctx.vfx?.breach?.(x, groundAt(x, z), z, 16, 2.8);
    bus.emit("royalHatch", { x, z, spawned: !!kid });
    return kid;
  }

  function stepSeated(dt) {
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - C.lairX, ps.z - C.lairZ);

    if (!state.royalDone
      && inst.health <= inst.maxHealth * C.royalAtHealth) {
      beginRoyal();
      return;
    }

    if (state.slamPhase) { stepSlam(dt); return; }

    state.clutchTimer -= dt;
    state.slamTimer -= dt;

    if (state.clutchWind > 0) {
      state.clutchWind -= dt;
      if (state.clutchWind <= 0) layClutch();
      return;
    }

    /* The slam only answers something close enough to be worth twenty
       metres of abdomen; anything further out gets laid on instead.
       Two clocks, one decision, and the player controls which by where
       they stand - which is the closest this immobile animal gets to
       having a positioning game. */
    if (state.slamTimer <= 0 && dist < C.slamRange) { beginSlam(); return; }
    if (state.clutchTimer <= 0) beginClutch();
  }

  function stepRoyal(dt) {
    state.timer = Math.max(0, state.timer - dt);
    // The cell swells on the same wave the ordinary clutch rides.
    state.wave = clamp01(1 - state.timer / C.royalSeconds);
    if (state.timer <= 0) {
      hatchRoyal();
      state.phase = "seated";
      state.wave = -1;
      state.clutchTimer = C.clutchCadence * 0.6;
      state.slamTimer = C.slamCadence * 0.4;
    }
  }

  function beginRouse() {
    state.phase = "rouse";
    state.timer = C.rouseSeconds;
    setEncounterGate(false, true);
    ctx.mission?.announce?.("THE ABBESS WAKES", 3.4);
    bus.emit("aggro", { x: C.lairX, z: C.lairZ });
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      /* Framed down the LENGTH of her, from behind the ovipositor
         toward the head. It is the only angle that says what she is:
         a body the camera has to travel to get past. */
      const sx = Math.sin(C.yaw);
      const sz = Math.cos(C.yaw);
      const camX = C.lairX - sx * (C.abdomenLength + 16) - sz * 9;
      const camZ = C.lairZ - sz * (C.abdomenLength + 16) + sx * 9;
      ctx.player.setFree(true, [camX, groundAt(camX, camZ) + 7, camZ],
        [C.lairX, floorY + 3.5, C.lairZ], 50);
      state.releaseCameraAt = 0.8;
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
    state.raised = 0;
    state.slamPhase = null;
    state.clutchWind = 0;
    releaseEncounterCamera();
    bus.emit("retiring", { x: C.lairX, z: C.lairZ });
  }

  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = false;   // an empty anchor
    group.visible = !hidden;
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death" || inst.health <= 0) {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        if (inst.state !== "death") enemies.kill?.(inst);
        clearHazards();
        ctx.vfx?.breach?.(C.lairX, floorY, C.lairZ, 24, 3.4);
        ctx.player?.doctrineKick?.(1.8, 1.6);
        bus.emit("defeated", { x: C.lairX, z: C.lairZ });
      }
      return;
    }

    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - C.lairX, ps.z - C.lairZ);

    if (state.phase === "dormant") {
      if (!ctx.combat?.player?.dead && dist <= C.aggroRadius) beginRouse();
      return;
    }

    if (state.phase === "retire") {
      state.timer = Math.max(0, state.timer - dt);
      if (dist <= C.aggroRadius && !ctx.combat?.player?.dead) {
        state.phase = "rouse";
        state.timer = C.rouseSeconds * (1 - state.woken);
        setEncounterGate(false, true);
        bus.emit("aggro", { x: C.lairX, z: C.lairZ });
        return;
      }
      if (state.timer <= 0) {
        state.phase = "dormant";
        state.revealed = false;
        setEncounterGate(true, true);
        bus.emit("reset", { x: C.lairX, z: C.lairZ });
      }
      return;
    }

    if (dist > C.disengageRadius) {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginRetire(); return; }
    } else {
      state.disengageFor = 0;
    }

    faceTowards(ps.x, ps.z, 0.9, dt);

    if (state.phase === "rouse") {
      /* FLOORED, never left to run away negative. The Coulter's own
         comment says why and this encounter proved it again: a phase
         that overshoots by one frame writes `timer: -0.02` into the
         save, the schema validator refuses a negative duration, and the
         whole file is rejected with no indication that a boss's spare
         two hundredths of a second is the reason. "Ready" is a state,
         not a quantity. */
      state.timer = Math.max(0, state.timer - dt);
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        releaseEncounterCamera();
      }
      if (state.timer <= 0) {
        releaseEncounterCamera();
        state.phase = "seated";
        setEncounterGate(false, false);
        bus.emit("engaged", { x: C.lairX, z: C.lairZ });
      }
      return;
    }

    if (state.phase === "seated") stepSeated(dt);
    else if (state.phase === "royal") stepRoyal(dt);
  }

  /* ------------------------------------------------------------
     PER-FRAME
     ------------------------------------------------------------ */

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }

    stepInstance(d);

    const wantWoken = state.phase === "dormant" ? 0
      : state.phase === "retire" ? 0 : 1;
    state.woken = state.phase === "rouse"
      ? clamp01(1 - state.timer / Math.max(1e-4, C.rouseSeconds))
      : damp(state.woken, wantWoken, 1.4, d);

    // The laying wave, once it has been started.
    if (state.wave >= 0 && state.phase !== "royal") {
      state.wave += d * 0.62;
      if (state.wave > 1.25) state.wave = -1;
    }

    poseAbdomen(d);
    head.rotation.y = inst.yaw;
    head.position.set(C.lairX, floorY, C.lairZ);
    head.visible = state.woken > 0.02;
    head.updateMatrixWorld(true);
    /* AFTER the pose, never before: the capsules the player is being
       held out of have to be the ones that were just drawn, or the
       correction is a frame behind a body that breathes and heaves. */
    keepOut();

    updateEggs(d);
    updateBrood(d);

    /* THE SPINE, PUBLISHED. combat.js's hit tests read this directly -
       see HITBOX.abbess - so the volume the player shoots at is the
       pose they are looking at, including mid-slam when twenty metres
       of it is nine metres in the air. */
    inst.sacSpine = spine;
    inst.sacRadius = spineRadius;
    inst.raised = state.raised;

    /* Mirrored onto the instance for the HUD, the minimap, the mission
       marker and the arena check. Her origin is her THORAX, not the
       middle of her mass: it is where the player aims when they are
       aiming at "her", and it is where the objective arrow should
       land. */
    inst.x = C.lairX;
    inst.z = C.lairZ;
    inst.y = floorY;
    inst.alerted = state.phase !== "dormant";
    inst.suspicion = inst.alerted ? 1 : 0;
    inst.root.position.set(inst.x, inst.y, inst.z);

    /* Spore and dust off the sac while she works. Cheap, and it is what
       keeps a mostly-static animal from reading as scenery between
       attacks. */
    if (state.woken > 0.4) {
      state.dustTick -= d;
      if (state.dustTick <= 0) {
        state.dustTick = 0.22;
        const sx = Math.sin(inst.yaw);
        const sz = Math.cos(inst.yaw);
        const t = rng();
        ctx.vfx?.venomGas?.(
          C.lairX - sx * t * C.abdomenLength,
          floorY + 1.5 + state.raised * 5,
          C.lairZ - sz * t * C.abdomenLength, 3.2, 0.5);
      }
    }
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */

  function healToFull() {
    if (!inst) return;
    inst.health = inst.maxHealth;
    inst.raised = 0;
  }

  function clearHazards() {
    for (const egg of eggs) egg.live = false;
    /* Her children are hers. Leaving a cap of Threshers standing in the
       chamber after a reset means the next approach starts mid-fight
       against a swarm nobody saw arrive. */
    for (const kid of [...brood]) {
      kid.selfDriven = false;
      enemies.remove?.(kid);
    }
    brood.length = 0;
    state.wave = -1;
    state.raised = 0;
    state.slamPhase = null;
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    inst = enemies.spawn("abbess", C.lairX, C.lairZ, {
      yaw: C.yaw,
      eventId: "district-boss:bloom",
    });
    if (!inst) return null;
    inst.sacSpine = spine;
    inst.sacRadius = spineRadius;
    inst.raised = 0;
    poseAbdomen(0);
    setEncounterGate(true, true);
    return inst;
  }

  function resetToSeat() {
    state.defeated = false;
    if (!inst) ensureSpawned();
    if (!inst) return;
    healToFull();
    clearHazards();
    state.phase = "dormant";
    state.timer = 0;
    state.woken = 0;
    state.raised = 0;
    state.revealed = false;
    state.disengageFor = 0;
    state.royalDone = false;
    releaseEncounterCamera();
    state.clutchTimer = C.clutchCadence * 0.45;
    state.clutchWind = 0;
    state.slamTimer = C.slamCadence * 0.7;
    state.fed = 0;
    state.laid = 0;
    inst.yaw = C.yaw;
    poseAbdomen(0);
    setEncounterGate(true, true);
    bus.emit("reset", { x: C.lairX, z: C.lairZ });
  }

  function liveEggs() {
    return eggs.filter((e) => e.live).length;
  }

  function status() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", dead: true, defeated: true,
        health: 0, maxHealth: 12000, x: C.lairX, z: C.lairZ,
      } : null;
    }
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      woken: Number(state.woken.toFixed(3)),
      raised: Number(state.raised.toFixed(3)),
      slamming: !!state.slamPhase,
      slamPhase: state.slamPhase,
      exposed: state.raised > 0.5,
      eggs: liveEggs(),
      brood: brood.length,
      broodCap: C.broodCap,
      fed: state.fed,
      laid: state.laid,
      royalDone: state.royalDone,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      dead: inst.state === "death",
      x: C.lairX,
      z: C.lairZ,
    };
  }

  function snapshot() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", timer: 0, instanceId: null, health: 0,
        maxHealth: 12000, royalDone: true, defeated: true,
      } : null;
    }
    /* Eggs and living brood are deliberately NOT persisted, for the
       Coulter's reason: they are seconds-long consequences of an attack,
       and restoring into a chamber full of hatchlings the player never
       saw laid is worse than losing them. `royalDone` IS saved - it is
       a once-per-encounter beat, and repeating it on every load would
       hand the player an unlimited supply of Matriarchs. */
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(Math.max(0, state.timer).toFixed(2)),
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      royalDone: state.royalDone,
      fed: state.fed,
      laid: state.laid,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((c) => c.eventId === "district-boss:bloom" && c.key === "abbess")
      || enemies.live.find((c) => c.key === "abbess");
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      state.woken = 0;
      group.visible = false;
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    const phase = ["dormant", "rouse", "seated", "royal", "retire", "dead"]
      .includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    state.revealed = phase !== "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.woken = phase === "dormant" || phase === "retire" ? 0 : 1;
    state.royalDone = !!saved.royalDone;
    state.fed = Math.max(0, Math.round(Number(saved.fed) || 0));
    state.laid = Math.max(0, Math.round(Number(saved.laid) || 0));
    state.raised = 0;
    state.slamPhase = null;
    state.clutchWind = 0;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    clearHazards();
    if (Number.isFinite(saved.health)) {
      inst.health = clamp(saved.health, 1, inst.maxHealth);
    }
    inst.yaw = C.yaw;
    poseAbdomen(0);
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
    /** Every ground-reaching damage path in combat.js calls this so an
     *  egg can be shot, swung at or blown up. Eggs are not enemies and
     *  cannot be routed to through `enemies.live`. */
    hitEggs,
    /** Live eggs, for the HUD and for checks. */
    eggs() {
      return eggs.filter((e) => e.live).map((e) => ({
        x: Number(e.x.toFixed(2)), y: Number(e.y.toFixed(2)),
        z: Number(e.z.toFixed(2)), t: Number(e.t.toFixed(3)),
        hp: Math.max(0, Math.round(e.hp)),
      }));
    },
    brood() { return brood.map((k) => ({ id: k.id, x: k.x, z: k.z, alerted: !!k.alerted })); },
    /** Fold her back down, with the animation. The arena boundary's
     *  reset path - see district-bosses.js. */
    retire() {
      if (!inst || state.defeated) return null;
      if (state.phase === "dormant" || state.phase === "retire") return null;
      beginRetire();
      return { phase: state.phase, timer: state.timer };
    },
    resetToSeat,
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      state.woken = state.phase === "dormant" || state.phase === "retire" ? 0 : 1;
      setEncounterGate(state.phase === "dormant",
        state.phase === "dormant" || state.phase === "rouse");
      poseAbdomen(0);
      return { phase: state.phase, timer: state.timer, woken: state.woken };
    },
    /** Throw a clutch now, through the production path. */
    forceClutch() {
      if (!inst || state.phase === "dormant") return null;
      layClutch();
      return { eggs: liveEggs() };
    },
    /** ...and a slam, likewise. */
    forceSlam() {
      if (!inst || state.phase === "dormant") return null;
      beginSlam();
      return { slamPhase: state.slamPhase };
    },
    /** Age the whole brood past its hunting window, so a check about
     *  trophallaxis does not have to wait eleven seconds per child. */
    recallBrood() {
      for (const kid of brood) kid.abbessBornAt = -1e6;
      return brood.length;
    },
    instance() { return inst; },
    dispose() { scene.remove(group); },
  };
}
