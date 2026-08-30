/* ============================================================
   SAINTFALL - Kenosis character weapon loadouts

   These are separate Meshy props, not part of either skinned body.
   Every prop is normalised from its own measured GLB bounds, then
   attached to the palm locator supplied by summit-player.js. That
   keeps the contact point on the gauntlet through idle, walking,
   running and flight without baking equipment into the character.
   ============================================================ */

import { patchMaterial } from "saintfall/art.js";
import {
  makeGoldLampMaterial,
  makeGoldLampMesh,
} from "saintfall/summit-lights.js";

const DEG = Math.PI / 180;
const MODEL_ROOT = "../../../assets/models/saintfall/player-weapons/";

/* Grip points are in each raw Meshy model's local coordinates. The
   runtime scale is derived from measured bounds, so these remain
   stable if texture compression or mesh pruning changes the GLB. */
/* HOW THE CRESCENT HYBRID SITS IN A FIST.
   Palm space: +X across the palm, +Y distal along the forearm, +Z the
   palm's own normal (see `holdQuaternion`).

   THE MODEL. Raycast maps of the raw GLB give: a frame carrying the
   barrel and the energy cell, a crescent blade at its -Y end, a
   trigger spur near (0.105, 0.020), and a bow leaving the frame at
   (0.15,-0.13), swinging out to x 0.42 and returning at (0.13, 0.42).
   By section the BOW is the true grip - a near-constant 34 x 17mm bar,
   ~105mm perimeter, a sabre grip, leather-wrapped in the concept -
   while the frame is 30 x 42mm and ~145mm, which no fist closes on.
   The 41mm between them is the finger tunnel.

   AND THE FIST BELONGS ON THAT BOW. The frame-seat this replaced
   palmed the receiver with the whole D-guard hanging empty beside
   the hand - reported from play as "the hand is not at the pistol
   grip", and it was right. What saves the bow seat NOW is the
   DOWN-THE-FOREARM hold below: the bar climbs 21 degrees off +Y
   while the muzzle is raked 20 the other way, so the wrap crosses
   the sculpted finger curl at ~40 degrees and the fingers close
   AROUND the 34x17mm bar instead of lying along it (the failure that
   sank the bow seat under the old across-palm hold). Photographed at
   four seats along the bar by `saintfall-grip-seat-sweep.mjs`, then
   arbitrated by the loadout audit: the seat rides the bar's TOP,
   because a seat lower on the bar slides the whole prop proximally
   and the receiver column follows the folded forearm into the
   arm capsules - mid-span cost 8 audit rows at up to 52mm inside.

     long   the muzzle axis, sent distally down the forearm and raked
            27 degrees back within the plate's own plane. Straight
            down the arm is where the barrel wants to be, but this
            prop is MID-GRIP - 0.93 units of it sit above the hand
            against 0.97 below - so held dead in line it pushed its
            butt 30cm up the forearm and 42mm into the trooper's own
            upper arm. Raking it swings that end clear (every pose to
            0% clipping) and costs nothing: the rake is about the
            PLATE'S NORMAL, so the face stays square to the body.
     roll   the PLATE'S OWN NORMAL, sent along the palm's normal so
            the flat of the weapon lies flat in the hand.

   That roll is what squares the weapon to the trooper. This prop is a
   plate 0.26 units thick against 0.97 wide, so it has a broad face
   and a thin edge, and the two things wanted of it - palm turned in
   toward the body, and the weapon's SIDE face presented to the side -
   are only simultaneously possible when those two normals share an
   axis. Rolled the old way (plate normal across the palm) they sat 90
   degrees apart and the wrist could satisfy one or the other: squared
   to the side the palm faced backwards, palm turned in the weapon
   faced front. Measured, not guessed - at the best wrist angle the
   old hold reached |plate.x| 0.95 with the palm at 0.06, or the
   reverse. Sharing the axis, ONE wrist angle gets both to 0.95.

   The right palm frame is reflected across the body, but remains
   right-handed. Its across-palm target therefore needs one explicit
   X reflection below: without it the right pommel points skyward and
   the crescent toes into the hip even though the left remains sound. */
const HYBRID_HOLD = {
  long: [0, -1, 0],
  roll: [0, 0, 1],
  /* Raked 20 degrees, down from 27. The 27 was measured against the
     old wide-forward carry, whose forearm already leaned 17 degrees
     outboard and 22 forward - stacked, the muzzle sat only 37 degrees
     below horizontal and the piece read as a levelled carbine, butt
     and bow to the sky over the hip. On the hanging carry below the
     forearm is near vertical, so less rake is needed to clear the
     butt from the upper arm (swept: butt axis holds 29mm+ off the
     forearm) and the muzzle settles ~46 degrees down - the concept's
     hang, blade beside the knee. */
  longTo: [-0.340, 0.940, 0],
  rollTo: [0, 0, -1],
};

/* A CHIRAL PROP CANNOT MIRROR ALL THREE AXES. The palm frames are
   reflected but right-handed, so once two model axes are told to
   mirror, the third comes out ANTI-mirrored - a rotation cannot make
   a left glove of a right glove. The first version of this reflected
   only the palm-space X, which mirrors the muzzle and the shown face
   and silently spends the anti-mirror on the BOW: measured on the
   carry, the left D-guard/grip-bar axis read (0.06,-0.67,-0.74) -
   down-back, tucked - while the right read (0.06,+0.69,+0.73) -
   guard and wrapped grip pointing at the SKY. That is the reported
   "right pistol is upside down", and no muzzle/plate check sees it.

   So the reflection now spends the error on the FACE instead:
   longTo mirrors the muzzle, and rollTo is reflected THROUGH the
   mirror plane (y/z negated) so the right prop presents its reverse
   cheek outboard and the bow truly mirrors. Both cheeks of this
   Meshy plate are fully painted - the swap is invisible - and
   `saintfall-pistol-mirror-audit.mjs` now checks the bow axis pair
   directly. */
const mirrorHold = (hold) => ({
  ...hold,
  longTo: [-hold.longTo[0], hold.longTo[1], hold.longTo[2]],
  rollTo: [hold.rollTo[0], -hold.rollTo[1], -hold.rollTo[2]],
});

const LOADOUTS = {
  "white-vigil": [
    {
      id: "left-hybrid",
      file: "white-vigil-crescent-emitter.glb",
      hand: 0,
      sizeAxis: "y",
      /* 0.62 measures 0.70m tall in world on a 1.74m trooper. Read
         against the two dual-wield references this is about right for
         a heavy sidearm: big enough to have presence in the hand,
         short of the 0.99m polearm that 0.86 produced. */
      targetSize: 0.62,
      /* ON THE WRAPPED BAR, mid-span. The bar's centreline runs
         (0.220,-0.102) -> (0.344, 0.219) in model units - the
         leather-wrapped sabre grip inside the D-guard, gold ferrule
         at its foot. Seated here the fist is visibly ON the grip
         with the guard around it; seated at the frame's edge
         (0.105, y) the guard hung empty beside a hand palming the
         receiver. High (0.34, 0.19) crowds the guard head, low
         (0.24,-0.05) sits on the ferrule; mid reads best from every
         bearing. The bar is centred at z 0. */
      grip: [0.335, 0.205, 0.000],
      /* The v2 prop has one active end. Its crescent and embedded
         energy aperture both live on model -Y; +Y is a sealed pommel.
         Keeping an explicit socket/axis here means a discharge can
         only originate on the blade side. */
      /* CLEAR OF THE MUZZLE, not inside it. (0,-0.790) was buried in
         solid material - a Z-cast there returns a span -0.037..0.035
         and the point is 35mm from any surface - so every pulse and
         every flash was born inside the blade and left through its
         own cutting edge. Casting -Y down the barrel line puts the
         last surface at y -0.896..-0.928; this sits just past it. */
      emitter: [0.045, -0.960, 0.000],
      emitterAxis: [0, -1, 0],
      /* Offsets found by `saintfall-loadout-fit.mjs`, which scores a
         candidate mount against a capsule body over seven captured
         poses at once. Palm space, like the mount they sit on.
         Halved with the prop, since they were solving a reach that
         is now half as long. */
      /* ON THE LOCATOR, and that is a measured result rather than a
         default. These are PALM-LOCATOR units, which are BONE units:
         the armature carries a 0.01 scale, so one of them is about a
         centimetre, and the old [-0.001, 0.003, -0.107] here was a
         tenth of a millimetre - it had never done anything.

         Given real values to try, every offset was worse. Seating the
         bar out at the sculpted finger pads (0, 4.8, 2.2) dropped
         grip-to-hand contact from 24 samples to ZERO - the weapon
         hanging off the fingertips rather than held - and pushed walk
         clipping up. The locator is where the hand closes. */
      position: [0.000, 0.000, 0.000],
      /* Measured v2 axes: -Y is the crescent/emitter end, +Y the
         CLOSED pommel, +X the crescent width and +Z its thickness.
         The old prop aimed +Y and thereby presented a generated
         barrel on the side opposite its blade. */
      /* THE GRIP LIES ALONG THE PALM'S OWN NORMAL, measured rather
         than guessed. player.js builds the free hand's basis with
         local +Z as the palm axis, so the palm's inward normal reads
         (-0.80, -0.39, -0.45) in body space for this hand - inboard,
         down and back. The handle was pointing (-0.22, -0.42, -0.88),
         some 65 degrees off it: butt to the rear like a holstered
         sidearm, with the hand behind the weapon instead of closed on
         it.

         AND THEN FLIPPED AGAIN. Aiming this axis ALONG the palm
         normal scored 0.997 and still read wrong in play: `roll` is
         the direction from the prop's centroid TOWARD its grip, so
         pointing it at the palm puts the grip on the far side of the
         hand - the weapon hanging off the back of the fist. The palm
         presses on the OPPOSITE face, so the axis points away from
         the palm normal and the grip lands in it. Numbers agreed
         with the wrong model of the joint twice; the plates are the
         arbiter here. */
      hold: HYBRID_HOLD,
    },
    {
      id: "right-hybrid",
      file: "white-vigil-crescent-emitter.glb",
      hand: 1,
      sizeAxis: "y",
      targetSize: 0.62,
      /* Identical grip seat to the left; `mirrorHold` reflects the
         aim and swaps the presented cheek so the guard mirrors. */
      grip: [0.335, 0.205, 0.000],
      /* CLEAR OF THE MUZZLE, not inside it. (0,-0.790) was buried in
         solid material - a Z-cast there returns a span -0.037..0.035
         and the point is 35mm from any surface - so every pulse and
         every flash was born inside the blade and left through its
         own cutting edge. Casting -Y down the barrel line puts the
         last surface at y -0.896..-0.928; this sits just past it. */
      emitter: [0.045, -0.960, 0.000],
      emitterAxis: [0, -1, 0],
      /* ON THE LOCATOR, and that is a measured result rather than a
         default. These are PALM-LOCATOR units, which are BONE units:
         the armature carries a 0.01 scale, so one of them is about a
         centimetre, and the old [-0.001, 0.003, -0.107] here was a
         tenth of a millimetre - it had never done anything.

         Given real values to try, every offset was worse. Seating the
         bar out at the sculpted finger pads (0, 4.8, 2.2) dropped
         grip-to-hand contact from 24 samples to ZERO - the weapon
         hanging off the fingertips rather than held - and pushed walk
         clipping up. The locator is where the hand closes. */
      position: [0.000, 0.000, 0.000],
      hold: mirrorHold(HYBRID_HOLD),
    },
  ],
  "bastion-penitent": [
    {
      id: "bastion-shield",
      file: "bastion-shield.glb",
      hand: 0,
      sizeAxis: "y",
      /* Deliberately enormous again. 1.62 measured 1.72m in world -
         taller than the 1.74m trooper wearing it - and 1.13 was cut
         back to 1.14m, which read as a kite shield rather than a
         tower. 1.50 lands around 1.59m: shin to shoulder, unmistakably
         a bulwark's wall. It is ACCEPTED that a shield this size rests
         against the leg; see the audit's residual rows. */
      targetSize: 1.50,
      /* A little behind the reconstructed back plate: the generated
         shield has no authored hand bone, so this is its virtual grip. */
      grip: [0.000, 0.000, -0.155],
      /* Offsets found by `saintfall-loadout-fit.mjs`, which scores a
         candidate mount against a capsule body over seven captured
         poses at once. Palm space, like the mount they sit on. */
      position: [0.086, 0.120, -0.160],
      /* Measured model axes: +Y is the shield's height, +X its width,
         +Z its face normal, and the virtual grip sits 3cm behind the
         back plate - so seating the grip at the palm puts the hand on
         the enarme, which is where a hand goes. Face forward and
         canted outboard; the long axis stays vertical. */
      aim: {
        long: [0, 0, 1], to: [0.458, 0.06, 0.887],
        roll: [0, 1, 0], rollTo: [0, 1, 0],
      },
    },
    {
      id: "bastion-hammer",
      file: "bastion-hammer.glb",
      hand: 1,
      sizeAxis: "x",
      /* Scale around the grip, not the model origin: this raises the
         reliquary head clear of the snow without moving the handle
         out of the gauntlet. */
      targetSize: 1.08,
      grip: [0.365, 0.000, 0.000],
      /* Offsets found by `saintfall-loadout-fit.mjs`, which scores a
         candidate mount against a capsule body over seven captured
         poses at once. Palm space, like the mount they sit on. */
      position: [-0.135, 0.067, -0.160],
      /* Measured model axes: +X is the haft, with the reliquary HEAD
         at -X (1.32 local from the grip, against 0.58 to the spiked
         pommel) - the bulk pulls the centroid toward the head, and
         the grip sits on the far side of it.

         CARRIED ACROSS, NOT SHOULDERED. Aimed mostly up (0.93 of Y)
         the mace stood on end like a staff and the head disappeared
         behind the pauldron. A maul at rest is levelled - the head
         out in front where its weight reads, the haft running back
         under the forearm. */
      aim: {
        long: [-1, 0, 0], to: [-0.26, 0.30, 0.92],
        roll: [0, 0, 1], rollTo: [0, 1, 0],
      },
    },
  ],
};

const finiteArray = (value, fallback) => Array.isArray(value)
  && value.length === fallback.length
  && value.every(Number.isFinite)
  ? value : fallback;

/**
 * Build the mount rotation from a carry described in BODY space.
 *
 * WHY NOT EULERS ON THE PALM. `rotationDeg` is applied in the palm
 * locator's frame, and that frame is the hand bone's - raked, and
 * MIRRORED between the two arms. So the same grip with the Y angle
 * negated does not produce a mirrored carry: it produced a left-hand
 * weapon hanging clear of the leg and a right-hand one with 76% of
 * its vertices inside the shins.
 *
 * A carry is much easier to state as "this axis of the model points
 * that way on the body": the hammer's head goes up and forward, the
 * shield's face goes forward and outboard. `aim` says exactly that
 * and this resolves it against whatever the hand's rest orientation
 * turns out to be, per hand, so mirroring is automatic.
 *
 *   long / to      the model axis that defines the piece, and the
 *                  body direction it should point along
 *   roll / rollTo  a second pair, to settle the spin about `long`
 */
function pairBasis(THREE, a, b) {
  const x = new THREE.Vector3().fromArray(a).normalize();
  const y = new THREE.Vector3().fromArray(b).normalize();
  y.addScaledVector(x, -y.dot(x));
  if (y.lengthSq() < 1e-8) {
    const alt = new THREE.Vector3(x.z, x.x, x.y);
    y.copy(alt).addScaledVector(x, -alt.dot(x));
  }
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}

function aimQuaternion(THREE, aim, figure, palm) {
  const model = pairBasis(THREE, aim.long, aim.roll || [0, 0, 1]);
  const body = pairBasis(THREE, aim.to, aim.rollTo || [0, 1, 0]);
  const inBody = new THREE.Quaternion()
    .setFromRotationMatrix(body.multiply(model.invert()));
  const rootWorld = figure.root.getWorldQuaternion(new THREE.Quaternion());
  const wanted = rootWorld.multiply(inBody);
  const palmWorld = palm.getWorldQuaternion(new THREE.Quaternion()).invert();
  return palmWorld.multiply(wanted);
}

/* A GRIP BELONGS TO THE HAND, NOT TO THE BODY.
   `aim` above resolves a model axis against a BODY direction, and
   that is the wrong frame for something being held: the arm moves,
   so holding the weapon still in body space means turning it inside
   the fist. Every pose then needs its own aim, no two of them agree
   about where the palm is, and four rounds of "the grip is not in the
   hand" came out of exactly that.

   `hold` resolves against the PALM instead. The mount is a child of
   the palm locator, whose axes are the ones player.js builds the
   wrist from - +Y distal along the forearm, +Z the palm's normal, +X
   across the palm - so a hold expressed here is a constant, and the
   weapon is welded into the fist for every pose there will ever be.
   Aiming is then the wrist's job, which is also whose job it is on a
   real arm. The two palm frames are reflected but right-handed, so a
   loadout may explicitly reflect its across-palm target once when a
   paired prop needs a true visual mirror. */
function holdQuaternion(THREE, hold) {
  const model = pairBasis(THREE, hold.long, hold.roll || [0, 0, 1]);
  const palm = pairBasis(THREE, hold.longTo, hold.rollTo || [0, 0, 1]);
  return new THREE.Quaternion()
    .setFromRotationMatrix(palm.multiply(model.invert()));
}

function worldUniformScale(node, THREE) {
  const scale = new THREE.Vector3();
  node.getWorldScale(scale);
  return Math.max(1e-6, Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
}

export async function buildSummitLoadout(ctx, player) {
  const { THREE, atmos } = ctx;
  const specs = LOADOUTS[ctx.playerCharacter?.id] || [];
  const group = new THREE.Group();
  group.name = `player-loadout-${ctx.playerCharacter?.id || "none"}`;
  player.figure.root.add(group);

  if (!specs.length) {
    return {
      group, parts: [], armPose: null, armSwing: null, handTurn: null,
      status: () => ({ id: ctx.playerCharacter?.id, parts: [] }),
    };
  }

  /* HOW EACH ARM CARRIES WHAT IS IN IT.
     Read by player.js's free-hand solve through `ctx.loadout`, both
     optional and both additive, so nothing outside Kenosis changes.

     `armPose` moves the hand's rest TARGET in figure-root space:
     +Y raises it toward the shoulder, which is what bends the elbow,
     and +Z brings it forward of the hip. `armSwing` scales the
     fore-aft stroke the walk gives that hand.

     A tower shield is not a swinging fist. Braced forward and held
     almost still, it reads as a wall the trooper is walking behind;
     left on the free-hand walk it travelled the Bastion's full 47cm
     of arm swing twice a stride, which on a 1.5m shield is the whole
     prop crossing the body and back. The mace arm keeps its stroke -
     a hammer wants one. */
  const CARRY = {
    "white-vigil": {
      /* A HANGING carry, matched to the concept's rest pose. The
         13cm-out / 10cm-forward lane was authored against the old
         across-palm hold, whose blade crossed toward the far thigh;
         the down-the-forearm hold hangs the blade beside the OWN
         leg, so the wide lane bought nothing and cost the read: the
         forearm leaned 17 degrees outboard, that lean leaked into
         the muzzles (x +-0.27), and from the chase camera both butts
         flared skyward and toed inboard over the hips.

         6cm out and 3cm forward hangs the arm near vertical: muzzle
         leak drops to +-0.14, the piece settles ~46 degrees below
         horizontal, and the butt tucks along the forearm instead of
         over the hip. The near-flat lift keeps the elbows at a soft
         151/147 degrees, bending BACK (bend z -0.067/-0.079) - a
         relaxed hang, not a raised guard. Swept and photographed by
         `saintfall-carry-sweep.mjs`; clearance re-proven by the
         loadout audit. */
      /* `sprint` opens the fold at speed, scaled by sprintN. The
         sprint pump tucks the fists toward the biceps, and a stock
         that rides above the fist follows them in: at the bar seat
         the audit put 3-4 samples 22mm inside the upper arm at full
         sprint, and raking the hold did not touch it. Dropping the
         carried hands 4.5cm and 3.5cm forward at sprint opens the
         elbow those few degrees instead - a body sprinting with a
         heavy pistol in each hand lowers its pump anyway. */
      0: { pose: [0.060, 0.005, 0.030], sprint: [0.012, -0.045, 0.035], swing: 0.58, turn: -0.60 },
      1: { pose: [-0.060, 0.005, 0.030], sprint: [-0.012, -0.045, 0.035], swing: 0.58, turn: 0.60 },
    },
    "bastion-penitent": {
      /* `turn` rolls the wrist so the palm is presented to what the
         hand is carrying. On White Vigil it is also what squares the
         weapon: -0.60 radians brings BOTH the palm's normal and the
         plate's face to within 18 degrees of the body's own lateral
         axis, so the palm turns in toward the trooper and the pistol
         shows its side to the side. Opposite signs because the roll
         is applied about each forearm directly, with no side factor. It is the only grip lever these rigs have:
         the gauntlets are a single `Hand` bone with the fingers
         sculpted open, so nothing can close on a haft. */
      0: { pose: [0.010, 0.105, 0.170], swing: 0.10, turn: 0.62 },
      /* The mace arm keeps a real stroke - it is the half of this
         loadout that still reads as walking.

         The one fault left is the sprint, where 20% of the head sits
         in the near thigh, and it is NOT the arm: damping the swing
         to 0.52 changed nothing, and lifting the whole carry 10cm
         traded it for a worse fault at rest. At a sprint the THIGH
         comes up to meet a mace carried level at hip height. Removing
         it needs a per-speed carry, not a better constant. */
      1: { pose: [0.000, 0.020, 0.030], swing: 0.72, turn: -0.48 },
    },
  };
  /* Swept and measured against the new hold. With the barrel now in
     line with the FOREARM, raising the hands is what aims the weapon
     rather than what ruins it - the exact reverse of the across-palm
     hold this replaced, which needed them held down at 0.05. Below
     0.18 the arm has not come up far enough and the muzzle lands 30
     degrees off; from 0.18 up it is on the crosshair, and 0.30 buys
     the extended, presented arm the reference photographs show. */
  const FIRE_POSE = { x: 0.105, y: 0.320, z: 0.260 };
  const carry = CARRY[ctx.playerCharacter?.id] || null;
  const isWhiteVigil = ctx.playerCharacter?.id === "white-vigil";
  let aimBlend = 0;
  const armPose = carry || isWhiteVigil
    ? (i, out, gait) => {
      const rule = carry?.[i];
      if (rule) {
        out.x += rule.pose[0];
        out.y += rule.pose[1];
        out.z += rule.pose[2];
        const sprintN = gait?.sprintN ?? 0;
        if (rule.sprint && sprintN > 0.001) {
          out.x += rule.sprint[0] * sprintN;
          out.y += rule.sprint[1] * sprintN;
          out.z += rule.sprint[2] * sprintN;
        }
      }
      if (isWhiteVigil && aimBlend > 0.001) {
        const side = i === 0 ? 1 : -1;
        /* Both compact hybrids rise clear of the thighs before a
           pulse leaves, and the hands stay separated - these are not
           a two-handed rifle.

           The carry keeps the muzzle only 20 degrees off the
           forearm, so this reach does most of the presentation. The
           wrist solver below then supplies the smaller convergence
           correction without moving the grip inside the hand. */
        out.x += side * FIRE_POSE.x * aimBlend;
        out.y += FIRE_POSE.y * aimBlend;
        out.z += FIRE_POSE.z * aimBlend;
      }
    }
    : null;
  const armSwing = carry || isWhiteVigil
    ? (i) => (carry?.[i]?.swing ?? 1) * (1 - aimBlend * 0.82)
    : null;
  const handTurn = carry ? (i) => (carry[i]?.turn ?? 0) : null;
  /* INSTALLED BEFORE THE ARMS ARE SOLVED, and that ordering is the
     whole point. Every `aim` below is resolved against the palm's
     REST orientation, and `handTurn` changes that orientation - the
     props are children of the palm, so a wrist roll applied
     afterwards rotates the shield with the hand and undoes the fit.
     Measured after the roll is in, the aims already account for it. */
  ctx.loadout = { armPose, armSwing, handTurn, handBasis: null };

  /* SOLVE THE ARMS BEFORE READING THE HANDS.
     Every carry below is resolved against the palm's REST
     orientation, and at construction the arms are still in the GLB's
     bind pose - a wide A-pose, some fifty degrees from a hanging
     arm. Read there, every aim would mean something else the moment
     the trooper stood normally. One pass of the player's own arm
     solve is all it takes. */
  for (let i = 0; i < 4; i += 1) player.postUpdate?.(1 / 60);
  player.figure.root.updateMatrixWorld(true);

  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  const cache = new Map();

  const load = (file) => {
    if (!cache.has(file)) {
      const url = new URL(`${MODEL_ROOT}${file}`, import.meta.url);
      if (ctx.build) url.searchParams.set("v", ctx.build);
      cache.set(file, loader.loadAsync(url.href));
    }
    return cache.get(file);
  };

  const gltfs = await Promise.all([...new Set(specs.map((spec) => spec.file))].map(load));
  const byFile = new Map([...new Set(specs.map((spec) => spec.file))]
    .map((file, index) => [file, gltfs[index]]));
  const parts = [];

  for (const spec of specs) {
    const gltf = byFile.get(spec.file);
    const asset = gltf.scene.clone(true);
    asset.name = `${spec.id}-meshy-model`;
    let triangles = 0;
    const materialState = [];
    const seenMaterials = new Set();
    asset.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const count = node.geometry.index?.count || node.geometry.attributes.position?.count || 0;
      triangles += count / 3;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material || seenMaterials.has(material.uuid)) continue;
        seenMaterials.add(material.uuid);
        materialState.push(material);
        if (material.userData.sfLoadoutPatched) continue;
        material.userData.sfLoadoutPatched = true;
        /* Meshy's weapon GLBs omit the scalar PBR factors, so glTF
           correctly defaults both to 1. On White Vigil there is no
           studio HDRI to reflect and a fully metallic surface mirrors
           the dark alpine sky, turning even the ivory atlas black.
           Match the ceramic-and-metal compromise already used by the
           two playable body meshes, while preserving the authored
           metallic/roughness texture's regional variation. */
        if ("metalness" in material) material.metalness = 0.24;
        if ("roughness" in material) material.roughness = 0.58;
        if ("envMapIntensity" in material) material.envMapIntensity = 0.94;
        if (material.emissive) material.emissive.set(0xffffff);
        /* Keep the painted atlas legible on the shadow side, just as
           summit-player does for the armour. The level deliberately
           has brutal directional contrast, so the generated glow map
           alone only revealed the amber slits and lost the ivory/red. */
        material.emissiveMap = material.map || material.emissiveMap;
        material.emissiveIntensity = spec.file === "bastion-shield.glb" ? 0.32
          : ctx.playerCharacter?.id === "bastion-penitent" ? 0.22 : 0.24;
        patchMaterial(material, atmos, { rim: 1.18, glitter: 0 });
      }
    });

    asset.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(asset);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const sourceSpan = Math.max(1e-6, sourceSize[spec.sizeAxis]);
    const parent = player.figure.palmLocators?.[spec.hand]
      || player.figure.handPivots?.[spec.hand];
    if (!parent) throw new Error(`${ctx.playerCharacter?.name || "Player"} is missing hand ${spec.hand}`);
    parent.updateWorldMatrix(true, false);

    const mount = new THREE.Group();
    mount.name = spec.id;
    mount.position.fromArray(spec.position);
    if (spec.hold) {
      mount.quaternion.copy(holdQuaternion(THREE, spec.hold));
    } else if (spec.aim) {
      mount.quaternion.copy(aimQuaternion(THREE, spec.aim, player.figure, parent));
    } else {
      mount.rotation.set(...spec.rotationDeg.map((value) => value * DEG));
    }
    parent.add(mount);
    parent.updateWorldMatrix(true, true);

    const scalar = spec.targetSize / (sourceSpan * worldUniformScale(parent, THREE));
    const grip = new THREE.Vector3().fromArray(spec.grip);
    asset.scale.setScalar(scalar);
    asset.position.copy(grip).multiplyScalar(-scalar);
    mount.add(asset);

    const contact = new THREE.Object3D();
    contact.name = `${spec.id}-grip-contact`;
    contact.position.copy(grip);
    asset.add(contact);

    const emitter = spec.emitter ? new THREE.Object3D() : null;
    if (emitter) {
      emitter.name = `${spec.id}-crescent-emitter`;
      emitter.position.fromArray(spec.emitter);
      asset.add(emitter);
    }
    let goldGlow = null;
    if (spec.file === "bastion-shield.glb") {
      const material = makeGoldLampMaterial(THREE, atmos, {
        name: "bastion-shield-gold-glow",
        intensity: 4.35,
      });
      /* +Y is the raw shield height and +Z its face. The lamp must
         tuck beneath the complete inner rim: even the 110 x 665mm
         pass left a dark, uneven band in the recess at the player's
         close camera angle. Keep it centred, overscan the aperture,
         and seat it beneath the raised rim so the metal masks it. */
      const mesh = makeGoldLampMesh(THREE, {
        name: "bastion-shield-core-gold",
        material,
        targets: [{
          name: "bastion-shield-core",
          position: [0.017, 0.115, 0.110],
          normal: [0, 0, 1],
          up: [0, 1, 0],
          widthM: 0.149,
          heightM: 0.718,
          perimeterBrightness: 0.88,
        }],
        /* raw model units per final world metre */
        unitsPerMetre: sourceSpan / spec.targetSize,
        standoffM: 0.001,
      });
      asset.add(mesh);
      goldGlow = { mesh, material };
    }
    mount.updateWorldMatrix(true, true);

    parts.push({
      spec, parent, mount, asset, contact, emitter, sourceBox, sourceSize, scalar,
      triangles: Math.round(triangles), materialState, goldGlow,
    });
  }

  const camDir = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const converge = new THREE.Vector3();
  const mountWorldPos = new THREE.Vector3();

  /* WHERE THE CROSSHAIR IS, in the world.
     The reticle sits at the centre of the screen, so the point it
     names is simply a distance down the camera's own forward ray.
     Both pistols and both projectiles are aimed at THAT POINT rather
     than along a fixed body direction - which is what makes a shot go
     where the player is looking when they look up a mountain, and
     what makes the pair converge instead of firing on parallel
     lines. */
  const CONVERGE_RANGE = 18;
  function aimPoint(out) {
    const camera = ctx.render?.camera;
    if (!camera) return null;
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    return out.copy(camPos).addScaledVector(camDir, CONVERGE_RANGE);
  }

  /* AIMING IS THE WRIST'S JOB.
     The weapon is welded into the fist by `hold`, so nothing here may
     turn it against the hand - that is what used to break the grip.
     What this does instead is hand player.js a wrist: the smallest
     rotation that swings the muzzle onto the crosshair, applied to
     the basis the free-hand solve would otherwise have used.

     Smallest, and CLAMPED - but not by one number, because a wrist
     is not one joint. The carry already rakes the muzzle close to the
     forearm, while reticle convergence varies with camera pitch and
     bearing. The remaining correction is split about the forearm:
     the twist component is pronation, which has a wide anatomical
     range, while the bend component is wrist flexion/deviation and
     stays inside about 35 degrees. */
  const ROLL_LIMIT = 2.35;
  const BEND_LIMIT = 0.62;
  const restBasis = new THREE.Matrix4();
  const restWorldQ = new THREE.Quaternion();
  const aimedQ = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  const muzzleLocal = new THREE.Vector3();
  const muzzleWorld = new THREE.Vector3();
  const wantDir = new THREE.Vector3();
  const basisX = new THREE.Vector3();
  const swingAxis = new THREE.Vector3();
  const twistAxis = new THREE.Vector3();
  const clampAxis = new THREE.Vector3();
  const twist = new THREE.Quaternion();
  const bend = new THREE.Quaternion();
  const partForHand = (i) => parts.find((part) => part.spec.hand === i
    && part.spec.hold && part.spec.emitterAxis) || null;

  function handBasis(i, yWorld, zWorld) {
    if (!isWhiteVigil || aimBlend < 0.002) return;
    const part = partForHand(i);
    if (!part) return;
    if (!aimPoint(converge)) return;
    /* The muzzle in PALM space: the mount's own rotation applied to
       the model's emit axis. The asset carries scale and offset only,
       so the mount is the whole of the weapon's orientation. */
    muzzleLocal.fromArray(part.spec.emitterAxis)
      .applyQuaternion(part.mount.quaternion).normalize();
    basisX.crossVectors(yWorld, zWorld).normalize();
    restBasis.makeBasis(basisX, yWorld, zWorld);
    restWorldQ.setFromRotationMatrix(restBasis);
    muzzleWorld.copy(muzzleLocal).applyQuaternion(restWorldQ).normalize();
    /* Last frame's palm position. The wrist is being solved right
       now, so this frame's is not available yet - and a frame of lag
       on the ORIGIN of a ray 18m long is far below one pixel. */
    part.parent.getWorldPosition(mountWorldPos);
    wantDir.copy(converge).sub(mountWorldPos);
    if (wantDir.lengthSq() < 1e-8) return;
    wantDir.normalize();
    swing.setFromUnitVectors(muzzleWorld, wantDir);
    /* Swing-twist about the forearm: the twist is the roll, whatever
       is left over is the bend. */
    const dot = swingAxis.copy(yWorld).normalize().dot(
      twistAxis.set(swing.x, swing.y, swing.z));
    twist.set(swingAxis.x * dot, swingAxis.y * dot, swingAxis.z * dot, swing.w);
    if (twist.lengthSq() < 1e-9) twist.set(0, 0, 0, 1);
    twist.normalize();
    bend.copy(swing).multiply(twist.clone().invert());
    clampQuaternion(twist, ROLL_LIMIT * aimBlend, aimBlend);
    clampQuaternion(bend, BEND_LIMIT * aimBlend, aimBlend);
    aimedQ.copy(bend).multiply(twist).multiply(restWorldQ);
    yWorld.set(0, 1, 0).applyQuaternion(aimedQ);
    zWorld.set(0, 0, 1).applyQuaternion(aimedQ);
  }

  /* Hold a rotation to `limit` radians and scale what survives by
     `blend`, in one pass, so a partly-raised weapon is partly aimed. */
  function clampQuaternion(q, limit, blend) {
    if (q.w < 0) { q.x *= -1; q.y *= -1; q.z *= -1; q.w *= -1; }
    const sin = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    if (sin < 1e-6) { q.set(0, 0, 0, 1); return q; }
    const angle = Math.min(2 * Math.acos(Math.min(1, q.w)), limit) * blend;
    return q.setFromAxisAngle(
      clampAxis.set(q.x / sin, q.y / sin, q.z / sin).normalize(), angle);
  }

  /* Published only now: `ctx.loadout` was installed before the arms
     were first solved (the mounts are measured against a solved
     palm), and this hook did not exist yet at that point. */
  if (ctx.loadout) ctx.loadout.handBasis = handBasis;

  function update(dt) {
    /* FIRING ONLY. The right button is the Vigil's melee hand (see
       summit-kenosis), so reading `ads` here would raise the guns on
       the same press that swings them. A running melee action owns
       the arms outright - the guns come down for the swing. */
    const firing = isWhiteVigil && !player.action
      && !!player.input?.state?.firing;
    const rate = firing ? 22 : 8;
    aimBlend += (Number(firing) - aimBlend)
      * (1 - Math.exp(-rate * Math.max(0, dt)));
    for (const part of parts) {
      if (!part.goldGlow) continue;
      const dusk = Math.max(0, Math.min(1, atmos.duskFactor || 0));
      const night = Math.max(0, Math.min(1, atmos.nightFactor || 0));
      const target = 4.35 + dusk * 1.25 + night * 2.15;
      part.goldGlow.material.emissiveIntensity += (target
        - part.goldGlow.material.emissiveIntensity)
        * (1 - Math.exp(-8 * Math.max(0, dt)));
    }
    if (!isWhiteVigil) return;
    /* Nothing to do to the mounts: a held weapon does not move in the
       hand. The pose changes entirely through `armPose` and
       `handBasis`, both of which player.js reads while solving. */
    for (const part of parts) {
      if (!part.spec.hold) continue;
      part.mount.updateWorldMatrix(true, true);
    }
  }

  const status = () => {
    const mountWorld = new THREE.Vector3();
    const contactWorld = new THREE.Vector3();
    return {
      id: ctx.playerCharacter?.id || null,
      parts: parts.map((part) => {
        part.mount.updateWorldMatrix(true, true);
        part.mount.getWorldPosition(mountWorld);
        part.contact.getWorldPosition(contactWorld);
        const box = new THREE.Box3().setFromObject(part.asset);
        const size = box.getSize(new THREE.Vector3());
        const emitterWorld = part.emitter
          ? part.emitter.getWorldPosition(new THREE.Vector3()) : null;
        const emitterDirection = part.emitter && part.spec.emitterAxis
          ? new THREE.Vector3().fromArray(part.spec.emitterAxis)
            .transformDirection(part.asset.matrixWorld) : null;
        return {
          id: part.spec.id,
          file: part.spec.file,
          hand: part.spec.hand === 0 ? "left" : "right",
          triangles: part.triangles,
          targetSize: part.spec.targetSize,
          worldSize: size.toArray().map((value) => Number(value.toFixed(3))),
          gripErrorM: Number(mountWorld.distanceTo(contactWorld).toFixed(5)),
          emitterWorld: emitterWorld?.toArray()
            .map((value) => Number(value.toFixed(3))) || null,
          emitterDirection: emitterDirection?.toArray()
            .map((value) => Number(value.toFixed(3))) || null,
          materials: part.materialState.map((material) => ({
            color: material.color?.getHexString?.() || null,
            metalness: Number(material.metalness?.toFixed?.(2) ?? 0),
            roughness: Number(material.roughness?.toFixed?.(2) ?? 0),
            emissive: material.emissive?.getHexString?.() || null,
            emissiveIntensity: Number(material.emissiveIntensity?.toFixed?.(2) ?? 0),
            map: !!material.map,
            normalMap: !!material.normalMap,
            metalnessMap: !!material.metalnessMap,
            roughnessMap: !!material.roughnessMap,
          })),
          goldGlow: part.goldGlow ? {
            mesh: part.goldGlow.mesh.name,
            targets: part.goldGlow.mesh.userData.sfGoldTargets,
            emissive: part.goldGlow.material.emissive.getHexString(),
            emissiveIntensity: Number(part.goldGlow.material.emissiveIntensity.toFixed(2)),
          } : null,
          position: part.mount.position.toArray().map((value) => Number(value.toFixed(3))),
          rotationDeg: [part.mount.rotation.x, part.mount.rotation.y, part.mount.rotation.z]
            .map((value) => Number((value / DEG).toFixed(2))),
        };
      }),
    };
  };

  /* For the grip sweep: re-seat a held weapon from a candidate hold
     without a reload, so a dozen rakes can be photographed in one
     boot. Takes the same shape as the spec's own `hold`. */
  const setHold = (id, hold) => {
    const part = parts.find((candidate) => candidate.spec.id === id);
    if (!part || !hold) return null;
    part.spec.hold = { ...part.spec.hold, ...hold };
    part.mount.quaternion.copy(holdQuaternion(THREE, part.spec.hold));
    if (Array.isArray(hold.grip) && hold.grip.length === 3) {
      part.spec.grip = hold.grip.slice();
      part.asset.position.fromArray(part.spec.grip).multiplyScalar(-part.scalar);
      part.contact.position.fromArray(part.spec.grip);
    }
    part.mount.updateWorldMatrix(true, true);
    return part.spec.hold;
  };

  /* For the carry-pose sweep: same shape as a CARRY entry's `pose`,
     applied to both hands with x mirrored. */
  const setCarryPose = (pose = {}) => {
    if (!carry) return null;
    for (const i of [0, 1]) {
      const rule = carry[i];
      if (!rule) continue;
      const sign = i === 0 ? 1 : -1;
      if (Number.isFinite(pose.x)) rule.pose[0] = sign * pose.x;
      if (Number.isFinite(pose.y)) rule.pose[1] = pose.y;
      if (Number.isFinite(pose.z)) rule.pose[2] = pose.z;
      if (Number.isFinite(pose.swing)) rule.swing = pose.swing;
      if (Number.isFinite(pose.turn)) rule.turn = sign * pose.turn;
    }
    return carry;
  };

  /* For the fire-pose sweep. */
  const setFirePose = (pose = {}) => {
    for (const key of ["x", "y", "z"]) {
      if (Number.isFinite(pose[key])) FIRE_POSE[key] = pose[key];
    }
    return { ...FIRE_POSE };
  };

  const setTransform = (id, transform = {}) => {
    const part = parts.find((candidate) => candidate.spec.id === id);
    if (!part) return null;
    const position = finiteArray(transform.position, part.mount.position.toArray());
    const rotationDeg = finiteArray(transform.rotationDeg,
      [part.mount.rotation.x, part.mount.rotation.y, part.mount.rotation.z].map((value) => value / DEG));
    part.mount.position.fromArray(position);
    part.mount.rotation.set(...rotationDeg.map((value) => value * DEG));
    part.mount.updateWorldMatrix(true, true);
    return status().parts.find((candidate) => candidate.id === id) || null;
  };

  return {
    group, parts, status, setTransform, setHold, setFirePose, setCarryPose, update,
    armPose, armSwing, handTurn, handBasis, aimPoint, CONVERGE_RANGE,
  };
}
