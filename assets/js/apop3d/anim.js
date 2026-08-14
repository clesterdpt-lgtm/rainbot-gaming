/* ============================================================
   APOP DEMON MOGGERS 3D - anim

   The pose graph. Every clip in the game is authored here as a
   function of normalised time rather than loaded from a file, because
   character.js builds its skeletons procedurally and there is no
   authoring tool in this pipeline to export from.

   HOW A FRAME IS ASSEMBLED

     rest pose
       + locomotion blend   (idle -> walk -> run, by speed)
       + one-shot clip      (jump, dive, beam ... cross-faded in)
       + additive layers    (breathe, lean, fall, recoil)
       + look-at IK         (head and neck, with a limit cone)
       + foot IK            (plant to the ground normal)
       + squash             (applied to the root BONE, not rig.root)

   Each stage writes into an accumulator of per-bone euler offsets
   FROM REST, and the whole accumulator is composed onto the rest
   quaternions once at the end. Writing straight onto the bones at
   each stage instead would make the layers order-dependent and make
   a cross-fade between two clips that touch the same bone snap.

   WHY THE MOTION IS SHAPED THE WAY IT IS

   The contract lists "linear motion" as a top tell, and it is the one
   that separates this from an engine demo more than any texture does:

   - Every one-shot has an ANTICIPATION window at its head. Nothing
     starts at its extreme; a jump dips before it rises.
   - Every clip that ends in a held pose OVERSHOOTS and settles back
     (ease.outBack / outElastic), never arriving monotonically.
   - Landings and take-offs SQUASH. This is not decoration - it is
     most of why a jump reads as weighty.
   - Hair, coat tails and anything else in rig.secondary is driven by
     a spring from the root's own acceleration, so the character keeps
     moving fractionally after the player stops. Cheap, and a large
     part of why a character reads as expensive.
   ============================================================ */

import * as THREE from "three";
import { clamp, clamp01, lerp, damp, ease, TAU, angleDelta, makeRng, rngShuffle } from "apop3d/core.js";

/* Clip names player.js and enemies.js are entitled to ask for. */
export const CLIPS = [
  "idle", "idleFidget", "walk", "run", "skid", "jump", "doubleJump",
  "tripleJump", "longJump", "backflip", "sideFlip", "wallSlide", "wallKick",
  "groundPoundStart", "groundPoundFall", "groundPoundLand", "dive", "slide",
  "getUp", "crouch", "crawl", "land", "hardLand", "fall", "beam", "beamCharge",
  "aura", "hurt", "dizzy", "victory", "carry", "swim", "tread", "climbLedge",
];

const DEG = Math.PI / 180;

/* Secondary-motion scales. These convert character.js's authored
   per-chunk numbers into radians and are the only place the overall
   liveliness of the hair and coat is set; the RATIOS between chunks
   belong to the model, not here.
     KICK     rad/s of spring VELOCITY per m/s of body velocity change,
              per unit of `drive`. Peak travel from an impulse goes as
              v0/sqrt(stiffness), so one number here gives a soft coat
              tail three times the throw of a stiff fringe off the same
              landing - which is the point of authoring them apart.
     SWING    radians of trail at a full run, per unit of `swing`.
     YAW      radians of side sway per rad/s of turn, per unit of
              `swing`.
     SPLAY    how much of a landing goes sideways instead of back, for
              the chunks that sit off the centre line. */
const SEC_KICK = 0.40;
const SEC_SWING = 0.19;
const SEC_YAW = 0.045;
const SEC_SPLAY = 0.55;

/* ------------------------------------------------------------------
   Clip authoring helpers

   A clip is { dur, loop, pose(t, out, k) } where t is 0..1 through the
   clip and `out` is the accumulator. `k` carries per-instance state
   (phase, limb length) so one clip definition serves every biped.
   ------------------------------------------------------------------ */

/** Add a euler offset, in degrees, onto a bone in the accumulator. */
function add(out, bone, x, y, z, w = 1) {
  let e = out[bone];
  if (!e) { e = out[bone] = [0, 0, 0]; }
  e[0] += x * DEG * w;
  e[1] += y * DEG * w;
  e[2] += z * DEG * w;
}

/* ---- mirrored authoring ------------------------------------------
   A crowd pose is written ONCE, against the left limb, and `sd` turns
   it into its own mirror image: at -1 every write lands on the other
   limb of the pair and the y/z channels flip sign. x is the sagittal
   swing and has no handedness, so it survives untouched.

   This is worth the three helpers. Nine authored poses become
   eighteen, the mirror of an asymmetric idle is a genuinely different
   silhouette rather than a re-timing of the same one, and it costs one
   number per figure instead of nine more hand-written pose blocks. */
function addL(out, sd, base, x, y, z, w = 1) {
  if (sd > 0) add(out, `${base}L`, x, y, z, w);
  else add(out, `${base}R`, x, -y, -z, w);
}
function addR(out, sd, base, x, y, z, w = 1) {
  if (sd > 0) add(out, `${base}R`, x, y, z, w);
  else add(out, `${base}L`, x, -y, -z, w);
}
/** A centre-line bone: nothing to swap, but the yaw and roll flip. */
function addC(out, sd, bone, x, y, z, w = 1) {
  add(out, bone, x, y * sd, z * sd, w);
}

/* ---- build awareness ---------------------------------------------
   A pose is authored in DEGREES on bones, so every figure in the game
   strikes it identically - the numbers below are the same on a 0.8 m
   bat and a 2.15 m bouncer. What is not identical is what that reads
   as, because the outline it makes is the arms measured against the
   TORSO, and the roster runs from a stick to a wardrobe.

   `broad` is that difference as one number, measured off the rig:
   how far the arm reaches compared to how far the shoulder already
   sits from the centre line. Long arms on narrow shoulders (a lackey
   at 5.06, a dancer at 3.96, Moggadonna at 4.2) put every gesture
   clear of the body; short arms on a wide chest (a bouncer at 2.16, a
   Pay-Pig at 1.92) leave the same gesture inside the figure's own
   width, where it does not read at all.

   Measured on the pool, front, 11 m - the distance the capture presets
   actually frame from - the widest band of `cheer` against the median
   band of that figure's own torso:

     lackey  2.45x body      bouncer 1.57x body
     dancer  2.12x body      pig     1.55x body

   So the SAME pose is a gesture on one build and a slightly wider slab
   on the other. Zero for two thirds of the roster; it costs them
   nothing, and a re-measure confirms their numbers are unchanged to
   three decimals. */
function shapeBroad(seg) {
  if (!seg) return 0;
  const reach = ((seg.upperArm || 0) + (seg.foreArm || 0)) / Math.max(1e-4, seg.shoulderX || 1);
  return clamp01((3.4 - reach) / 1.5);
}

/* Bones whose ABDUCTION - the z channel, the one that lifts a limb off
   the ribs - is scaled up on a broad build. Deliberately not the
   forearm or the hand: those carry the shape of the elbow break, which
   is what tells two poses apart at distance, and stretching them
   rewrites the gesture instead of clearing it. */
const BROAD_BONES = ["shoulderL", "shoulderR", "armL", "armR"];
const BROAD_GAIN = 0.55;

/**
 * Stand the arms further off a wide torso.
 *
 * This MULTIPLIES what the pose already asked for rather than adding a
 * constant, and that distinction is the whole of it. Adding a fixed
 * abduction to both arms is the scarecrow move - it opens every figure
 * to the same wide V and destroys exactly the variety the pool exists
 * to create. Scaling keeps a closed pose closed, keeps an asymmetric
 * pose asymmetric, and only ever exaggerates the author's own reading
 * of which side is the open one.
 */
function broaden(out, broad) {
  if (broad <= 0.001) return;
  const g = 1 + BROAD_GAIN * broad;
  for (const name of BROAD_BONES) {
    const e = out[name];
    if (e) e[2] *= g;
  }
}

/** Root translation, in metres, and root yaw/pitch/roll in degrees. */
function root(out, x, y, z, w = 1) {
  out._rp[0] += x * w; out._rp[1] += y * w; out._rp[2] += z * w;
}
function rootRot(out, x, y, z, w = 1) {
  out._rr[0] += x * DEG * w; out._rr[1] += y * DEG * w; out._rr[2] += z * DEG * w;
}

const sin01 = (t) => Math.sin(t * TAU);
const cos01 = (t) => Math.cos(t * TAU);

/**
 * The shared biped walk/run cycle.
 *
 * `stride` scales limb swing, `bounce` the vertical, `lean` the torso
 * pitch. One function serves walk, run and crawl because the only
 * things that actually differ are those three numbers and the arm
 * counter-swing - and keeping it as one function means a fix to the
 * foot timing cannot land in walk but miss run.
 */
function gait(t, out, stride, bounce, lean, armScale, w) {
  const a = sin01(t);
  const b = sin01(t + 0.5);

  add(out, "thighL", a * stride, 0, 0, w);
  add(out, "thighR", b * stride, 0, 0, w);
  // Knees only bend one way, and they bend on the back half of the
  // swing. A knee driven by a raw sine bends backwards for half the
  // cycle, which is the single most obvious broken-walk artefact.
  add(out, "shinL", -Math.max(0, -a) * stride * 1.6, 0, 0, w);
  add(out, "shinR", -Math.max(0, -b) * stride * 1.6, 0, 0, w);
  add(out, "footL", Math.max(0, a) * stride * 0.35, 0, 0, w);
  add(out, "footR", Math.max(0, b) * stride * 0.35, 0, 0, w);

  add(out, "armL", b * stride * armScale, 0, 8, w);
  add(out, "armR", a * stride * armScale, 0, -8, w);
  add(out, "forearmL", -Math.abs(b) * stride * 0.35 - 12, 0, 0, w);
  add(out, "forearmR", -Math.abs(a) * stride * 0.35 - 12, 0, 0, w);

  add(out, "spine", lean, 0, 0, w);
  add(out, "chest", lean * 0.4, -a * stride * 0.18, 0, w);
  add(out, "hips", 0, a * stride * 0.22, 0, w);
  add(out, "head", -lean * 0.7, 0, 0, w);

  // Two bounces per stride: one per footfall.
  root(out, 0, Math.abs(cos01(t)) * bounce, 0, w);
}

/* ==================================================================
   THE IDLE POOL

   WHY THIS EXISTS

   A blind art review ranked "A-posed mannequin NPCs" the loudest
   unfinished-looking thing in the whole build - above every lighting
   fault - and it named the cause exactly: identical figures, arms
   straight out, all facing the same way, evenly spaced. Everything
   standing still in this game runs the one `idle` clip, so a food
   court full of demons was one pose photocopied five times.

   That single idle was ALSO right for the character it was written
   for. It opened Moggadonna's arms to beat a measurement (a 0.02 m
   gap between elbow and coat is under a pixel at capture distance, so
   she was one vertical mass) and it worked. The mistake was scope: a
   hero at 22% of frame height needs a wide unmistakable silhouette,
   and a crowd needs to not be a crowd of one person. Those are
   different jobs, so they are now different poses.

   HOW TO ADD ONE

   Author it against the LEFT limb using addL/addR/addC and let `sd`
   supply the mirror. Give it a `rate` - the multiplier on the shared
   5.4 s clip - because a bored figure sways slower than an excited
   one, and a pool that all breathes at one frequency is a synchronised
   crowd wearing different clothes.

   The bar for a new entry is a SILHOUETTE difference, not a mood
   difference. Two poses whose arms are both down and whose heads are
   both level are one pose at any distance the game is played from.
   ================================================================== */

/**
 * Weight onto the far leg, the near knee broken and turned out.
 *
 * Every pose in the pool takes a stance from here rather than
 * authoring legs of its own. Contrapposto is the difference between a
 * person standing and a doll placed, and it is the same shape on
 * everybody; what varies is how HARD the hip is loaded, which is a
 * mood, and how far the feet splay, which sets how much background
 * shows between the legs.
 */
function stance(out, sd, load, splay) {
  addC(out, sd, "hips", 0, 4 * load, 6 * load);
  addL(out, sd, "thigh", -3 * load, -6 * load, -11 * splay);
  addL(out, sd, "shin", -13 * load, 0, 3 * splay);
  addL(out, sd, "foot", 5 * load, -12 * splay, 0);
  addR(out, sd, "thigh", 2 * load, 7 * load, 7 * splay);
  addR(out, sd, "shin", -2 * load, 0, -2 * splay);
  addR(out, sd, "foot", 0, 10 * splay, 0);
}

/* SIGNS, because getting one wrong costs a render cycle every time.
   Measured off the clips below rather than assumed:
     arm.x      NEGATIVE raises the limb forward and up (-90 is
                horizontal in front, -170 is overhead). POSITIVE
                swings it back behind the hip.
     forearm.x  NEGATIVE is elbow FLEXION - the hand travels toward
                the shoulder. POSITIVE opens the elbow through the
                back, which is what puts a hand at the small of the
                back or on a hip.
     arm.z      abduction: NEGATIVE is outward on the left, positive
                on the right, which addL/addR handle for you.
     spine/head.x  POSITIVE is forward and down; NEGATIVE is up and
                back.

   Nine poses. Read as black shapes: one triangle-under-the-arm, one
   closed block, one head-down box, one narrow lean, one long diagonal,
   one wide V, one narrow shape with two small holes, one clean torso
   with elbows, one big high elbow over a closed side. Mirrored, that
   is eighteen - more than any single frame of this game shows of one
   archetype. */
const IDLE_POOL = [
  {
    /* One hand on the hip. The best standing silhouette there is: the
       forearm closes a triangle of pure background between arm and
       ribs, and a hole in a shape survives any distance. The other arm
       simply hangs, which is what keeps it asymmetric. */
    name: "hipHand", rate: 0.68,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -4, 0, -9);
      addL(out, sd, "arm", 32 + s * 0.6, -10, -30);
      addL(out, sd, "forearm", 58, 24, 26);
      addL(out, sd, "hand", 0, 0, 12);
      addR(out, sd, "shoulder", -3, 0, 3);
      addR(out, sd, "arm", 2 - s * 0.5, -8, 10);
      addR(out, sd, "forearm", -18, 0, -4);
      addC(out, sd, "spine", 1 + s * 0.8, -4, 3);
      addC(out, sd, "chest", s * 0.5, -7, 2);
      addC(out, sd, "head", -2, -12 + s * 2, 3);
      stance(out, sd, 1, 0.9);
      root(out, sd * s * 0.008, 0, 0);
    },
  },
  {
    /* Arms folded. A closed, blocky mass - deliberately the opposite
       read to the hip pose next to it, because variety in a crowd is
       carried by the pair, not by the individual. */
    name: "crossed", rate: 0.5,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -5, 0, -4);
      addL(out, sd, "arm", -16 + s * 0.7, 26, -17);
      addL(out, sd, "forearm", -92, -22, 36);
      addR(out, sd, "shoulder", -5, 0, 4);
      addR(out, sd, "arm", -22 + s * 0.7, -22, 12);
      addR(out, sd, "forearm", -104, 26, -14);
      addC(out, sd, "spine", 3 - s * 0.9, 2, 0);
      addC(out, sd, "chest", 2, 5, 0);
      addC(out, sd, "head", 1, -7, -2);
      stance(out, sd, 0.5, 0.55);
      root(out, 0, s * 0.004, 0);
    },
  },
  {
    /* Looking at a phone. The head angle is the whole read - at 1/6
       frame height nobody sees the phone, but a skull tipped twenty-
       five degrees down is unmistakable and nothing else in the pool
       does it. */
    name: "phone", rate: 0.42,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -3, 0, -3);
      addL(out, sd, "arm", -14, 12, -8);
      addL(out, sd, "forearm", -80 + s * 1.2, -16, 16);
      addR(out, sd, "shoulder", -3, 0, 3);
      addR(out, sd, "arm", -11, -9, 7);
      addR(out, sd, "forearm", -84 - s * 1.2, 14, -13);
      addC(out, sd, "spine", 8, 0, 0);
      addC(out, sd, "chest", 5, -3, 0);
      addC(out, sd, "neck", 11, 0, 0);
      addC(out, sd, "head", 30, -6, 0);
      stance(out, sd, 0.7, 0.5);
      root(out, sd * s * 0.005, 0, 0);
    },
  },
  {
    /* Bored slouch. Narrow on purpose. One narrow figure in a group of
       nine is contrast; nine of them was the original problem. */
    name: "slouch", rate: 0.55,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      const sway = Math.sin(t * TAU * 0.5);
      addL(out, sd, "shoulder", -11, 0, 6);
      addL(out, sd, "arm", 5 + s * 0.9, 6, -8);
      addL(out, sd, "forearm", -26, 0, 2);
      addR(out, sd, "shoulder", -10, 0, -6);
      addR(out, sd, "arm", -3 - s * 0.9, -5, 6);
      addR(out, sd, "forearm", -20, 0, -2);
      addC(out, sd, "spine", 9 + s * 1.1, 0, -2);
      addC(out, sd, "chest", 7, -2, -1);
      addC(out, sd, "head", 11, 14 + sway * 3, 0);
      stance(out, sd, 1.5, 0.7);
      root(out, sd * sway * 0.014, 0, 0);
    },
  },
  {
    /* Pointing at whatever the landmark is. A long diagonal, and the
       only pose in the pool whose extreme is above the shoulder line
       on one side only. The pointing arm stays STRAIGHT - a bent one
       is a wave, and a wave is a different pose. */
    name: "point", rate: 0.6,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -10, 0, -12);
      addL(out, sd, "arm", -104 + s * 1.4, 8, -22);
      addL(out, sd, "forearm", -8, 0, -6);
      addL(out, sd, "hand", -12, 0, 0);
      addR(out, sd, "shoulder", -2, 0, 3);
      addR(out, sd, "arm", -8, -16, 9);
      addR(out, sd, "forearm", -62, 22, -20);
      addC(out, sd, "spine", -2, -7, 3);
      addC(out, sd, "chest", -1, -9, 2);
      addC(out, sd, "head", -6, -16, 3);
      stance(out, sd, 0.8, 0.75);
      root(out, 0, s * 0.005, 0);
    },
  },
  {
    /* One arm up, one out with the elbow broken. The widest entry in
       the pool and the only one that bobs, so it is also the one that
       reads as MOVING from across a plaza.

       This was authored symmetric - both arms up and out at the same
       angle - and on a VIP Bouncer, who is a wardrobe with two stick
       arms, that came out of the capture as a clean T. Which is the
       exact defect this whole pool exists to remove, arrived at from
       the other direction: a pose can be wide, animated, and still be
       a scarecrow if the two sides do the same thing. Lift is carried
       by z (see heroIdle), so the two arms differ by 74 degrees of
       abduction and one of them keeps a bent elbow.

       That killed the literal T - measured, the shoulder-to-hand
       vectors now leave at +45 and +18 degrees of elevation on every
       build - and it was still not enough on the two wide ones. Front,
       11 m, the width profile crown-to-feet:

         dancer  0.02 0.17 0.47 0.43 0.37 0.23 0.13   peak 2.3x body
         pig     0.12 0.20 0.68 0.71 0.65 0.58 0.49   peak 1.5x body
         bouncer 0.09 0.52 0.76 0.73 0.64 0.52 0.27   peak 1.6x body

       On the dancer that is a spike with a body under it. On the Pig
       it is 0.68 / 0.71 / 0.65 - three bands within eight percent of
       each other, a flat bar laid across the top of a barrel, which is
       what "reads as a T" meant. Both arms being UP does not save a
       pose if the figure is wide enough that they arrive at the same
       height anyway.

       So on a broad build the low arm is DROPPED - see below for why
       it is the low arm that moves and not the high one - until the
       pair spans about seventy degrees of elevation instead of
       twenty-seven, and the bar across the top becomes a diagonal off
       one shoulder. Measured after: the Pig's plateau falls from three
       bands to one and its widest band moves from the shoulders to the
       hip, while peak width holds at 0.72; the Bouncer keeps a plateau
       of two and trades 0.756 of width for 0.675. Asymmetry roughly
       doubles on both, 0.185 -> 0.352 and 0.249 -> 0.348.

       `broad` is 0 for two thirds of the roster, which get exactly the
       pose above.

       `broadAware` opts this pose OUT of the blanket broadening in
       broaden(), and it has to. Both applied at once took the raised
       arm to 234 degrees of abduction - over the head and down the far
       side - which measured as the arm having gone DOWN and is the
       kind of failure that looks like a sign error until you notice
       two corrections stacked. */
    name: "cheer", rate: 1.15, broadAware: true,
    pose(t, out, sd, broad = 0) {
      const s = Math.sin(t * TAU);
      /* The raised side is left ALONE. A first pass at this drove it
         higher as well, on the theory that more separation is better,
         and it measured worse on both wide builds: peak width 0.756 ->
         0.503 on a Bouncer, which is under the figure's own torso.
         Past about 150 degrees of abduction an arm is vertical, and a
         vertical arm adds height, not width - it stops being the thing
         that makes this the widest entry in the pool. Its 146 degrees
         is where the hand sits furthest from the centre line, so that
         is where it stays. Only the shoulder lifts, which pops the
         deltoid clear of the collar on a heavy figure. */
      addL(out, sd, "shoulder", -16 - 4 * broad, 0, -20);
      addL(out, sd, "arm", -8 + s * 3, 0, -126 - s * 4);
      addL(out, sd, "forearm", -14, 0, -18 - 8 * broad);
      /* The low side is the whole fix. At 58 plus 14 of abduction with
         the elbow folded to 58, this arm sits OUT and LEVEL - measured,
         the hand leaves the shoulder at +18 degrees of elevation while
         the raised arm leaves at +45, and on a wide enough figure those
         two land in the same width band. That is the bar.

         The elbow is what holds the hand up, not the abduction: at 58
         degrees of flexion the forearm carries the wrist back to
         shoulder height however the upper arm is set. So the fix opens
         the elbow to about 12 and takes only a little off the
         abduction, leaving the upper arm OUT - the hand falls to the
         hip and stays wide, which keeps the width while breaking the
         bar. Measured, the pair then spans 64 degrees of elevation on a
         Bouncer and 71 on a Pay-Pig, against 27 before.

         Closing the arm across the chest instead was tried and cost
         nearly a fifth of the figure's width for no more separation. */
      addR(out, sd, "shoulder", -8, 0, 14 - 4 * broad);
      addR(out, sd, "arm", -14 - s * 2 + 18 * broad, -12, 58 - 12 * broad);
      addR(out, sd, "forearm", -58 + 46 * broad, 12, 22 - 6 * broad);
      /* Lean away from the raised arm. A torso that stays vertical
         under an asymmetric pair reads as a hinge; the counter-lean is
         what makes it read as weight shifting. */
      addC(out, sd, "spine", -9, -4, -5 * broad);
      addC(out, sd, "chest", -6, -6, -4 * broad);
      addC(out, sd, "head", -13, -8 - 6 * broad, 2);
      stance(out, sd, 0.3 + 0.5 * broad, 1.1);
      root(out, 0, Math.abs(s) * 0.035, 0);
    },
  },
  {
    /* Hands clasped low in front. Narrow through the shoulders, but
       both elbows stand off the ribs, so it carries two small holes
       where the slouch carries none. */
    name: "clasp", rate: 0.45,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -3, 0, -8);
      addL(out, sd, "arm", -8 + s * 0.5, 16, -26);
      addL(out, sd, "forearm", -56, -28, 38);
      addR(out, sd, "shoulder", -3, 0, 8);
      addR(out, sd, "arm", -8 - s * 0.5, -16, 25);
      addR(out, sd, "forearm", -56, 28, -37);
      addC(out, sd, "spine", 2 + s * 0.7, 0, 0);
      addC(out, sd, "chest", 1, -3, 0);
      addC(out, sd, "head", 4, 8, 1);
      stance(out, sd, 0.6, 0.6);
      root(out, 0, s * 0.004, 0);
    },
  },
  {
    /* Hands behind the back, chest open, chin up. The tidiest outline
       in the pool: the arms swing far enough behind that the forearms
       vanish behind the hips from the front, leaving one clean torso
       and two barely-there elbows. That is deliberately the opposite
       of `clasp`, which is the same anatomy with the elbows thrown
       wide - two poses that both put the hands at the waist have to
       differ somewhere, and the only place they can differ at
       screenshot distance is how far the elbows stand off. */
    name: "handsBack", rate: 0.5,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -8, 0, -4);
      addL(out, sd, "arm", 52, -16, -10);
      addL(out, sd, "forearm", 40, 30, 16);
      addR(out, sd, "shoulder", -8, 0, 4);
      addR(out, sd, "arm", 54, 16, 11);
      addR(out, sd, "forearm", 38, -30, -15);
      addC(out, sd, "spine", -7 - s * 0.9, 0, 0);
      addC(out, sd, "chest", -5, 3, 0);
      addC(out, sd, "head", -8, -9, 0);
      stance(out, sd, 0.45, 1.0);
      root(out, 0, s * 0.004, 0);
    },
  },
  {
    /* Hand up at the neck, head turned away. One big elbow high and
       out over a completely closed other side: asymmetric, and the
       nearest thing in the pool to a figure caught mid-thought. */
    name: "neckScratch", rate: 0.72,
    pose(t, out, sd) {
      const s = Math.sin(t * TAU);
      addL(out, sd, "shoulder", -12, 0, -22);
      addL(out, sd, "arm", -54 + s * 1.6, 30, -58);
      addL(out, sd, "forearm", -104, -30, -16);
      addL(out, sd, "hand", -18, 0, 0);
      addR(out, sd, "shoulder", -3, 0, 4);
      addR(out, sd, "arm", 4, -11, 11);
      addR(out, sd, "forearm", -24, 0, -6);
      addC(out, sd, "spine", 2, 7, -3);
      addC(out, sd, "chest", 1, 11, -2);
      addC(out, sd, "head", 4, 24 + s * 2, -3);
      stance(out, sd, 0.9, 0.65);
      root(out, sd * s * 0.006, 0, 0);
    },
  },
];

/**
 * Moggadonna's own idle. Not in the pool and never drawn from it.
 *
 * WHAT CHANGED AND WHY
 *
 * The pose this replaces abducted both arms hard - shoulder 13 plus
 * arm 47 on the left, shoulder 18 plus arm 38 on the right, so about
 * 60 and 56 degrees of real abduction - to buy daylight between arm
 * and coat. It bought it. It also made her bilaterally symmetric with
 * both arms held out, and the review that came back called that a
 * scarecrow, which is the same complaint as the mannequin crowd
 * wearing a different word.
 *
 * The fix is not to close the arms again; a narrow vertical was the
 * fault before that one. It is to put the two arms at different
 * HEIGHTS. What made the old pose read as a scarecrow was not the
 * width, it was that both arms left the shoulders at the same angle,
 * so the width profile carried a flat three-band plateau across the
 * middle of the figure. That is the shape of a symbol, not a person.
 *
 *   right (mic)  raised laterally to about a hundred degrees of total
 *                abduction, forearm angled further up so the mic sits
 *                at head height. Shoulder, forearm and head enclose a
 *                real triangle of background - a HOLE, which is worth
 *                more at distance than the same amount of extra
 *                outline - and the mic is the one prop that says what
 *                she is, so it is held where it reads against the sky.
 *   left         stays DOWN, abducted enough that the arm never welds
 *                to the coat, with the hand carried forward of the
 *                hip. It is the low half of the pair.
 *
 * Measured as a black silhouette against the pose it replaces, front
 * at 3 m and 11 m: peak width 0.426 -> 0.432 and 0.451 -> 0.447 of
 * figure height, background inside the outline 0.152 -> 0.153 and
 * 0.143 -> 0.137. So the width the previous pass bought is kept
 * almost exactly; what changed is where it sits. The old profile ran
 * 0.43 / 0.42 / 0.40 across bands five to seven - the plateau. The new
 * one peaks 0.43 / 0.41 at bands two and three, necks in at the waist
 * and bulges again at the hip where the low hand is.
 *
 * The trade is one framing: from three-quarter on her RIGHT the raised
 * arm passes behind the hair and the peak falls 0.390 -> 0.326. From
 * three-quarter on her LEFT it goes the other way, 0.401 -> 0.418,
 * with half again as much daylight. A laterally raised arm cannot
 * read from every azimuth; this is the side that was chosen to lose.
 *
 * Contrapposto, the wide splayed stance and the head counter-rotation
 * all stay: they were measured, they were right, and none of them was
 * what the review objected to.
 */
function heroIdle(t, out) {
  const s = Math.sin(t * TAU);
  const sway = Math.sin(t * TAU * 0.5);

  /* Contrapposto. The hip that carries the weight rides high and the
     ribcage twists back against it. The torso yaw is bigger than it
     was, because an oblique shoulder line is the cheapest asymmetry
     there is and it costs no width at all. */
  add(out, "hips", 0, 9, 5 + sway * 1.5);
  add(out, "spine", 2.0 + s * 1.1, -7, -3);
  add(out, "chest", s * 0.7, -10, -2.5);
  add(out, "neck", 0, 5, 1.5);
  add(out, "head", -3 - s * 0.9, 10 + sway * 2.2, 2);

  /* THE LOW SIDE.
     Down and forward, wrist turned out. Fifty-three degrees of total
     abduction, which is enough that the arm never welds to the coat
     flare but leaves the hand at hip height - a whole shoulder-to-hem
     below where the mic is. It is that vertical GAP between the two
     hands, not either arm on its own, that stops the pair reading as
     one held gesture repeated twice. */
  add(out, "shoulderL", 2, 0, -9);
  add(out, "armL", 20 + s * 0.7, 4, -44);
  add(out, "forearmL", -16, -20, -14);
  add(out, "handL", -8, 0, -10);

  /* THE HIGH SIDE - the mic hand.
     Shoulder 24 plus arm 76 is a hundred degrees of abduction: the
     upper arm is horizontal, out to her right, and the forearm's own
     38 carries the hand up above it. Note that the LIFT has to come
     from z. Once a limb is near horizontal, cos(abduction) is close to
     zero and the x channel barely moves it at all - which is why two
     earlier passes at "raise the arm" using x did nothing measurable
     and cost a render cycle each. */
  add(out, "shoulderR", -15, 0, 24);
  add(out, "armR", -30 + s * 0.9, -18, 76);
  add(out, "forearmR", -26, 0, 38);
  add(out, "handR", -26, 0, 0);

  /* Weight on her right leg; the left knee breaks and turns out.
     The stance is WIDE and both feet turn out. Measured as a
     silhouette the bottom half of this figure used to be a flat
     column - sixteen width bands from the hem down within four
     percent of each other. Two legs a boot's width apart, splayed,
     put a wedge of background up between them and give the lower half
     the only shape change it has. */
  add(out, "thighL", -3, -7, -12);
  add(out, "shinL", -11, 0, 3);
  add(out, "footL", 5, -13, 0);
  add(out, "thighR", 2, 8, 7);
  add(out, "shinR", -2, 0, -2);
  add(out, "footR", 0, 10, 0);

  root(out, sway * 0.010, s * 0.005, 0);
}

const CLIP_DEFS = {
  /* ---- idle: the marketing pose, and now a POOL of them ----------
     The screenshot harness photographs whatever the idle is doing,
     every blind-comparison panel is a standing frame, and the player
     spends more time looking at this than at any other clip. It is not
     a filler loop - and it is not one pose either.

     Everything in this game that stands still runs THIS clip: the
     player, the eight demon archetypes and both rigged bosses. That is
     why one hand-tuned idle turned a food court into five copies of the
     same person, and it is why the dispatch happens here rather than at
     the call site: nothing that plays an idle knows or should know
     which figure it is driving.

     A spec whose kind is "demon" draws from IDLE_POOL by the
     controller's own seed; everyone else - the hero, and the bosses
     derived from her spec - gets heroIdle. A boss checking their phone
     is not a bug worth leaving available. */
  idle: {
    dur: 5.4, loop: true,
    pose(t, out, k) {
      const s = k && k._state;
      const def = s && s.idlePose;
      if (!def) { heroIdle(t, out); return; }
      /* Each pose carries its own cycle length as a multiple of the
         shared clip duration, so the pool does not breathe on one
         frequency. The per-figure tempo multiplier in step() is layered
         on top of this, not instead of it: the first is the pose's
         character, the second is the individual's. */
      def.pose((t * def.rate) % 1, out, s.side, s.broad);
      /* Safe to post-process `out` here: both callers - the idle blend
         in step() and the one-shot path - reset their accumulator
         immediately before this runs, so everything in it came from the
         pose above. A pose that took `broad` itself has already spent
         it and must not be scaled again. */
      if (!def.broadAware) broaden(out, s.broad);
    },
  },

  idleFidget: {
    dur: 2.4, loop: false,
    pose(t, out) {
      const p = ease.outBack(clamp01(t * 1.6));
      const fall = ease.inOutCubic(clamp01((t - 0.6) / 0.4));
      const w = p * (1 - fall);
      add(out, "armR", -48, 0, -18, w);
      add(out, "forearmR", -62, 0, 0, w);
      add(out, "head", -6, -12, 0, w);
      add(out, "chest", 0, -8, 0, w);
    },
  },

  walk: { dur: 1.0, loop: true, pose(t, out) { gait(t, out, 26, 0.035, 3, 0.55, 1); } },
  run: { dur: 0.62, loop: true, pose(t, out) { gait(t, out, 42, 0.07, 12, 0.9, 1); } },
  crawl: {
    dur: 1.3, loop: true,
    pose(t, out) {
      gait(t, out, 20, 0.012, 62, 0.5, 1);
      add(out, "hips", 40, 0, 0);
      root(out, 0, -0.52, 0);
    },
  },

  skid: {
    dur: 0.42, loop: false,
    pose(t, out) {
      const p = ease.outQuart(clamp01(t * 2));
      add(out, "spine", -22 * p, 0, 0);
      add(out, "hips", 14 * p, 0, 0);
      add(out, "thighL", 30 * p, 0, 0);
      add(out, "thighR", -22 * p, 0, 0);
      add(out, "shinL", -34 * p, 0, 0);
      add(out, "armL", -60 * p, 0, 26 * p);
      add(out, "armR", -70 * p, 0, -30 * p);
      add(out, "head", 8 * p, 0, 0);
      root(out, 0, -0.05 * p, 0);
    },
  },

  /* ---- the jump chain ---------------------------------------------
     Three jumps, three silhouettes. They have to be told apart in the
     air at a glance or the player cannot tell which one they got. */

  jump: {
    dur: 0.72, loop: false,
    pose(t, out) {
      const crouch = t < 0.12 ? ease.outQuad(t / 0.12) : 0;   // anticipation
      const air = ease.outCubic(clamp01((t - 0.1) / 0.5));
      add(out, "thighL", 34 * air - 26 * crouch, 0, 0);
      add(out, "thighR", 20 * air - 26 * crouch, 0, 0);
      add(out, "shinL", -46 * air + 34 * crouch, 0, 0);
      add(out, "shinR", -22 * air + 34 * crouch, 0, 0);
      add(out, "armL", -110 * air, 0, 22);
      add(out, "armR", -110 * air, 0, -22);
      add(out, "spine", -6 * air + 16 * crouch, 0, 0);
      add(out, "head", -8 * air, 0, 0);
      root(out, 0, -0.16 * crouch, 0);
    },
  },

  doubleJump: {
    dur: 0.78, loop: false,
    pose(t, out) {
      const air = ease.outCubic(clamp01(t / 0.42));
      const tuck = Math.sin(clamp01(t / 0.7) * Math.PI);
      add(out, "thighL", 62 * tuck, 0, 0);
      add(out, "thighR", 52 * tuck, 0, 0);
      add(out, "shinL", -88 * tuck, 0, 0);
      add(out, "shinR", -80 * tuck, 0, 0);
      add(out, "armL", -150 * air, 0, 30);
      add(out, "armR", -150 * air, 0, -30);
      add(out, "spine", -14 * tuck, 0, 0);
      rootRot(out, -20 * tuck, 0, 0);
    },
  },

  /* A full forward somersault. The rotation is the read. */
  tripleJump: {
    dur: 0.95, loop: false,
    pose(t, out) {
      const spin = ease.inOutCubic(clamp01((t - 0.08) / 0.72));
      const tuck = Math.sin(clamp01(t / 0.9) * Math.PI);
      rootRot(out, -360 * spin, 0, 0);
      add(out, "thighL", 78 * tuck, 0, 0);
      add(out, "thighR", 70 * tuck, 0, 0);
      add(out, "shinL", -104 * tuck, 0, 0);
      add(out, "shinR", -98 * tuck, 0, 0);
      add(out, "armL", -60 - 60 * tuck, 0, 34);
      add(out, "armR", -60 - 60 * tuck, 0, -34);
      add(out, "spine", -20 * tuck, 0, 0);
    },
  },

  longJump: {
    dur: 1.0, loop: false,
    pose(t, out) {
      const p = ease.outCubic(clamp01(t / 0.24));
      add(out, "spine", 34 * p, 0, 0);
      add(out, "hips", -12 * p, 0, 0);
      add(out, "thighL", -34 * p, 0, 0);
      add(out, "thighR", -26 * p, 0, 0);
      add(out, "shinL", -30 * p, 0, 0);
      add(out, "shinR", -20 * p, 0, 0);
      add(out, "armL", -166 * p, 0, 16);
      add(out, "armR", -166 * p, 0, -16);
      add(out, "head", -26 * p, 0, 0);
      rootRot(out, 16 * p, 0, 0);
    },
  },

  backflip: {
    dur: 0.9, loop: false,
    pose(t, out) {
      const spin = ease.inOutCubic(clamp01((t - 0.06) / 0.76));
      const tuck = Math.sin(clamp01(t) * Math.PI);
      rootRot(out, 360 * spin, 0, 0);
      add(out, "thighL", 86 * tuck, 0, 0);
      add(out, "thighR", 86 * tuck, 0, 0);
      add(out, "shinL", -110 * tuck, 0, 0);
      add(out, "shinR", -110 * tuck, 0, 0);
      add(out, "armL", -40 - 90 * tuck, 0, 26);
      add(out, "armR", -40 - 90 * tuck, 0, -26);
    },
  },

  sideFlip: {
    dur: 0.86, loop: false,
    pose(t, out) {
      const spin = ease.inOutCubic(clamp01((t - 0.06) / 0.74));
      const tuck = Math.sin(clamp01(t) * Math.PI);
      rootRot(out, 0, 0, 360 * spin);
      add(out, "thighL", 70 * tuck, 0, 12 * tuck);
      add(out, "thighR", 58 * tuck, 0, -12 * tuck);
      add(out, "shinL", -92 * tuck, 0, 0);
      add(out, "shinR", -84 * tuck, 0, 0);
      add(out, "armL", -120 * tuck, 0, 40);
      add(out, "armR", -120 * tuck, 0, -40);
    },
  },

  wallSlide: {
    dur: 0.5, loop: true,
    pose(t, out) {
      const j = Math.sin(t * TAU) * 2;
      add(out, "spine", -10, 0, 0);
      add(out, "armL", -150, 0, 34 + j);
      add(out, "armR", -60, 0, -20);
      add(out, "thighL", 18, 0, 0);
      add(out, "thighR", -14, 0, 0);
      add(out, "shinL", -46, 0, 0);
      add(out, "shinR", -18, 0, 0);
      add(out, "head", -6, -14, 0);
    },
  },

  wallKick: {
    dur: 0.55, loop: false,
    pose(t, out) {
      const p = ease.outBack(clamp01(t / 0.3));
      rootRot(out, 0, 180 * ease.inOutCubic(clamp01(t / 0.42)), 0);
      add(out, "thighL", -48 * p, 0, 0);
      add(out, "thighR", 60 * p, 0, 0);
      add(out, "shinL", -20 * p, 0, 0);
      add(out, "shinR", -70 * p, 0, 0);
      add(out, "armL", -130 * p, 0, 30);
      add(out, "armR", -80 * p, 0, -40);
      add(out, "spine", -12 * p, 0, 0);
    },
  },

  /* ---- ground pound: the pause at the top is the whole move ------- */

  groundPoundStart: {
    dur: 0.34, loop: false,
    pose(t, out) {
      const p = ease.outQuad(clamp01(t / 0.5));
      rootRot(out, 0, 540 * ease.inOutCubic(clamp01(t)), 0);
      add(out, "thighL", 40 * p, 0, 0);
      add(out, "thighR", 40 * p, 0, 0);
      add(out, "shinL", -60 * p, 0, 0);
      add(out, "shinR", -60 * p, 0, 0);
      add(out, "armL", -90 * p, 0, 50 * p);
      add(out, "armR", -90 * p, 0, -50 * p);
      root(out, 0, 0.14 * p, 0);
    },
  },

  groundPoundFall: {
    dur: 0.4, loop: true,
    pose(t, out) {
      add(out, "spine", 8, 0, 0);
      add(out, "hips", -6, 0, 0);
      add(out, "thighL", 8, 0, 6);
      add(out, "thighR", 8, 0, -6);
      add(out, "shinL", -12, 0, 0);
      add(out, "shinR", -12, 0, 0);
      add(out, "armL", 42, 0, 46);
      add(out, "armR", 42, 0, -46);
      add(out, "head", 12, 0, 0);
    },
  },

  groundPoundLand: {
    dur: 0.46, loop: false,
    pose(t, out) {
      const hit = ease.outQuart(clamp01(t / 0.16));
      const rec = ease.outBack(clamp01((t - 0.18) / 0.6));
      const w = hit * (1 - rec * 0.85);
      add(out, "spine", 34 * w, 0, 0);
      add(out, "hips", 20 * w, 0, 0);
      add(out, "thighL", 74 * w, 0, 14 * w);
      add(out, "thighR", 74 * w, 0, -14 * w);
      add(out, "shinL", -96 * w, 0, 0);
      add(out, "shinR", -96 * w, 0, 0);
      add(out, "armL", 20 * w, 0, 62 * w);
      add(out, "armR", 20 * w, 0, -62 * w);
      root(out, 0, -0.42 * w, 0);
    },
  },

  dive: {
    dur: 0.9, loop: false,
    pose(t, out) {
      const p = ease.outCubic(clamp01(t / 0.2));
      rootRot(out, 74 * p, 0, 0);
      add(out, "armL", -178 * p, 0, 10);
      add(out, "armR", -178 * p, 0, -10);
      add(out, "spine", 12 * p, 0, 0);
      add(out, "thighL", -22 * p, 0, 0);
      add(out, "thighR", -30 * p, 0, 0);
      add(out, "shinL", -26 * p, 0, 0);
      add(out, "shinR", -14 * p, 0, 0);
      add(out, "head", -30 * p, 0, 0);
    },
  },

  slide: {
    dur: 0.6, loop: true,
    pose(t, out) {
      add(out, "spine", -26, 0, 0);
      add(out, "hips", 30, 0, 0);
      add(out, "thighL", 66, 0, 10);
      add(out, "thighR", 20, 0, -6);
      add(out, "shinL", -70, 0, 0);
      add(out, "shinR", -18, 0, 0);
      add(out, "armL", -50, 0, 44);
      add(out, "armR", -96, 0, -30);
      root(out, 0, -0.44, 0);
      rootRot(out, -12, 0, 0);
    },
  },

  crouch: {
    dur: 1, loop: true,
    pose(t, out) {
      add(out, "hips", 16, 0, 0);
      add(out, "spine", 18, 0, 0);
      add(out, "thighL", 74, 0, 8);
      add(out, "thighR", 74, 0, -8);
      add(out, "shinL", -104, 0, 0);
      add(out, "shinR", -104, 0, 0);
      add(out, "armL", 8, 0, 20);
      add(out, "armR", 8, 0, -20);
      add(out, "forearmL", -34, 0, 0);
      add(out, "forearmR", -34, 0, 0);
      root(out, 0, -0.46, 0);
    },
  },

  land: {
    dur: 0.34, loop: false,
    pose(t, out) {
      const w = 1 - ease.outBack(clamp01(t / 0.85));
      add(out, "hips", 12 * w, 0, 0);
      add(out, "spine", 14 * w, 0, 0);
      add(out, "thighL", 46 * w, 0, 6 * w);
      add(out, "thighR", 46 * w, 0, -6 * w);
      add(out, "shinL", -64 * w, 0, 0);
      add(out, "shinR", -64 * w, 0, 0);
      add(out, "armL", -26 * w, 0, 30 * w);
      add(out, "armR", -26 * w, 0, -30 * w);
      root(out, 0, -0.2 * w, 0);
    },
  },

  hardLand: {
    dur: 0.72, loop: false,
    pose(t, out) {
      const w = 1 - ease.outCubic(clamp01(t / 0.9));
      add(out, "hips", 26 * w, 0, 0);
      add(out, "spine", 30 * w, 0, 0);
      add(out, "thighL", 84 * w, 0, 12 * w);
      add(out, "thighR", 84 * w, 0, -12 * w);
      add(out, "shinL", -108 * w, 0, 0);
      add(out, "shinR", -108 * w, 0, 0);
      add(out, "armL", 14 * w, 0, 54 * w);
      add(out, "armR", 14 * w, 0, -54 * w);
      add(out, "head", 18 * w, 0, 0);
      root(out, 0, -0.5 * w, 0);
    },
  },

  getUp: {
    dur: 0.6, loop: false,
    pose(t, out) {
      const w = 1 - ease.inOutCubic(clamp01(t));
      add(out, "hips", 40 * w, 0, 0);
      add(out, "spine", 30 * w, 0, 0);
      add(out, "thighL", 80 * w, 0, 0);
      add(out, "thighR", 60 * w, 0, 0);
      add(out, "shinL", -100 * w, 0, 0);
      add(out, "shinR", -70 * w, 0, 0);
      root(out, 0, -0.55 * w, 0);
    },
  },

  fall: {
    dur: 0.9, loop: true,
    pose(t, out) {
      const f = Math.sin(t * TAU) * 3;
      add(out, "spine", -8, 0, 0);
      add(out, "armL", -128 + f, 0, 36);
      add(out, "armR", -128 - f, 0, -36);
      add(out, "thighL", 16, 0, 6);
      add(out, "thighR", 4, 0, -6);
      add(out, "shinL", -28, 0, 0);
      add(out, "shinR", -14, 0, 0);
      add(out, "head", -12, 0, 0);
    },
  },

  /* ---- combat ---------------------------------------------------- */

  beamCharge: {
    dur: 0.5, loop: true,
    pose(t, out) {
      const p = 0.85 + Math.sin(t * TAU) * 0.15;
      add(out, "chest", 0, -22, 0);
      add(out, "armR", -78 * p, -10, -16);
      add(out, "forearmR", -34 * p, 0, 0);
      add(out, "armL", -20, 0, 24);
      add(out, "spine", -6, 8, 0);
      add(out, "head", -4, -10, 0);
    },
  },

  beam: {
    dur: 0.42, loop: false,
    pose(t, out) {
      // Recoil first, recover after. The kick has to lead the shot.
      const kick = ease.outQuart(clamp01(t / 0.1));
      const rec = ease.outBack(clamp01((t - 0.12) / 0.7));
      const w = kick * (1 - rec);
      add(out, "chest", 0, -28, 0);
      add(out, "armR", -96 + 26 * w, -12, -14);
      add(out, "forearmR", -18 - 22 * w, 0, 0);
      add(out, "armL", -26, 0, 26);
      add(out, "spine", -10 - 8 * w, 10, 0);
      add(out, "head", -6, -12, 0);
      root(out, 0, 0, -0.06 * w);
    },
  },

  aura: {
    dur: 1.1, loop: false,
    pose(t, out) {
      const rise = ease.outCubic(clamp01(t / 0.34));
      const hold = 1 - ease.inOutCubic(clamp01((t - 0.6) / 0.4));
      const w = rise * hold;
      add(out, "spine", -26 * w, 0, 0);
      add(out, "chest", -14 * w, 0, 0);
      add(out, "armL", -168 * w, 0, 52 * w);
      add(out, "armR", -168 * w, 0, -52 * w);
      add(out, "head", -30 * w, 0, 0);
      add(out, "thighL", -10 * w, 0, 8 * w);
      add(out, "thighR", -10 * w, 0, -8 * w);
      root(out, 0, 0.22 * w, 0);
    },
  },

  hurt: {
    dur: 0.5, loop: false,
    pose(t, out) {
      const w = 1 - ease.outCubic(clamp01(t));
      add(out, "spine", -30 * w, 0, 10 * w);
      add(out, "chest", -16 * w, 0, 0);
      add(out, "head", -22 * w, 12 * w, 0);
      add(out, "armL", -70 * w, 0, 40 * w);
      add(out, "armR", -50 * w, 0, -30 * w);
      add(out, "thighL", -16 * w, 0, 0);
      rootRot(out, -14 * w, 0, 0);
    },
  },

  dizzy: {
    dur: 1.4, loop: true,
    pose(t, out) {
      const s = Math.sin(t * TAU), c = Math.cos(t * TAU);
      add(out, "spine", 8 + s * 6, c * 8, s * 5);
      add(out, "head", 10 + c * 10, s * 20, 0);
      add(out, "armL", -20 + s * 14, 0, 30);
      add(out, "armR", -20 - s * 14, 0, -30);
      rootRot(out, 0, s * 6, c * 4);
    },
  },

  victory: {
    dur: 1.8, loop: false,
    pose(t, out) {
      const up = ease.outBack(clamp01(t / 0.3));
      const bob = Math.sin(clamp01((t - 0.3) / 0.7) * TAU * 1.5) * 0.4 + 0.6;
      const w = up * (t > 0.3 ? bob : 1);
      add(out, "armR", -172 * up, 0, -30 * up);
      add(out, "forearmR", -12 * up, 0, 0);
      add(out, "armL", -40 * up, 0, 40 * up);
      add(out, "spine", -16 * up, -10 * up, 0);
      add(out, "head", -20 * up, -6, 0);
      add(out, "thighL", -8 * up, 0, 0);
      root(out, 0, 0.06 * w, 0);
    },
  },

  carry: {
    dur: 1.0, loop: true,
    pose(t, out) {
      gait(t, out, 16, 0.02, 8, 0.15, 1);
      add(out, "armL", -78, 0, 22);
      add(out, "armR", -78, 0, -22);
      add(out, "forearmL", -60, 0, 0);
      add(out, "forearmR", -60, 0, 0);
    },
  },

  /* ---- water ------------------------------------------------------ */

  swim: {
    dur: 1.5, loop: true,
    pose(t, out) {
      const a = sin01(t), b = sin01(t + 0.5);
      rootRot(out, 68, 0, 0);
      add(out, "armL", -120 + a * 60, 0, 26);
      add(out, "armR", -120 + b * 60, 0, -26);
      add(out, "thighL", a * 20, 0, 6);
      add(out, "thighR", b * 20, 0, -6);
      add(out, "shinL", -Math.max(0, -a) * 30, 0, 0);
      add(out, "shinR", -Math.max(0, -b) * 30, 0, 0);
      add(out, "head", -34, 0, 0);
    },
  },

  tread: {
    dur: 2.0, loop: true,
    pose(t, out) {
      const s = sin01(t);
      rootRot(out, 16, 0, 0);
      add(out, "armL", -74, 0, 40 + s * 8);
      add(out, "armR", -74, 0, -40 - s * 8);
      add(out, "thighL", 34 + s * 12, 0, 10);
      add(out, "thighR", 34 - s * 12, 0, -10);
      add(out, "shinL", -40, 0, 0);
      add(out, "shinR", -40, 0, 0);
      root(out, 0, s * 0.03, 0);
    },
  },

  climbLedge: {
    dur: 0.85, loop: false,
    pose(t, out) {
      const pull = ease.inOutCubic(clamp01(t));
      const w = 1 - pull;
      add(out, "armL", -172 * w, 0, 20);
      add(out, "armR", -172 * w, 0, -20);
      add(out, "spine", 26 * w, 0, 0);
      add(out, "thighL", 96 * w, 0, 0);
      add(out, "thighR", 40 * w, 0, 0);
      add(out, "shinL", -110 * w, 0, 0);
      root(out, 0, -0.7 * w, 0);
    },
  },
};

/* Aliases, so a caller asking for a clip we treat as a variant of
   another still gets motion instead of a silent no-op. */
const ALIASES = { jumpLand: "land", fallLoop: "fall", idleLong: "idleFidget" };

/* ------------------------------------------------------------------
   Additive layers. These ride on top of whatever the base is doing.
   ------------------------------------------------------------------ */

const ADDITIVE = {
  breathe(out, w, t) {
    const s = Math.sin(t * 1.6);
    add(out, "chest", -s * 1.6, 0, 0, w);
    add(out, "spine", -s * 0.8, 0, 0, w);
    add(out, "armL", s * 0.9, 0, s * 0.8, w);
    add(out, "armR", s * 0.9, 0, -s * 0.8, w);
  },
  /** Lean into a turn. Signed: w may be negative. */
  lean(out, w) {
    add(out, "spine", 0, 0, -16 * w);
    add(out, "chest", 0, 0, -10 * w);
    add(out, "head", 0, 8 * w, -6 * w);
    add(out, "hips", 0, 0, 6 * w);
  },
  fall(out, w) {
    add(out, "armL", -40 * w, 0, 18 * w);
    add(out, "armR", -40 * w, 0, -18 * w);
    add(out, "spine", -10 * w, 0, 0);
    add(out, "thighL", 10 * w, 0, 0);
    add(out, "thighR", 6 * w, 0, 0);
  },
  recoil(out, w) {
    add(out, "chest", -12 * w, 0, 0);
    add(out, "armR", 22 * w, 0, 0);
    add(out, "forearmR", -18 * w, 0, 0);
  },
};

/* ------------------------------------------------------------------
   Controller
   ------------------------------------------------------------------ */

const _q = new THREE.Quaternion();
const _qe = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mat = new THREE.Matrix4();

function makeAccumulator() {
  return { _rp: [0, 0, 0], _rr: [0, 0, 0] };
}

function resetAccumulator(a) {
  a._rp[0] = a._rp[1] = a._rp[2] = 0;
  a._rr[0] = a._rr[1] = a._rr[2] = 0;
  for (const k in a) {
    if (k === "_rp" || k === "_rr") continue;
    const e = a[k];
    e[0] = e[1] = e[2] = 0;
  }
}

export function create(ctx) {
  const controllers = new Set();

  /**
   * How many controllers of this spec are already attached.
   *
   * This is the default per-figure seed and the choice of source is
   * the whole determinism argument. A module-level "nth attach ever"
   * counter would give each figure a stable pose within one session
   * and a DIFFERENT one in a session that loaded the courses in
   * another order, which is exactly the kind of golden-frame drift
   * CONTRACT section 10 rules out.
   *
   * enemies.js pools rigs per archetype, never shrinks a pool and
   * caps it at three, so the live count at attach time IS that
   * figure's pool slot index: 0, 1, 2 for the first three lackeys and
   * the same three numbers on the next run and the next course.
   *
   * A caller that knows better should say so - see attach(rig, opts).
   */
  function ordinalFor(specId) {
    let n = 0;
    for (const c of controllers) if (c._specId === specId) n += 1;
    return n;
  }

  /**
   * The order this archetype walks the pool in.
   *
   * Drawing a variant at random per figure is not good enough, and a
   * census across three capture presets is what showed it: with twelve
   * controllers drawing independently from eighteen variants, a
   * collision is not unlikely, it is expected. The measured frames had
   * an Industry Plant and a Lip-Sync Lackey both standing in `crossed`.
   *
   * Across two archetypes that is survivable - a plant and a lackey
   * share no silhouette - but the same draw can just as easily hand the
   * SAME pose to two lackeys, and two of one archetype in one pose is
   * the exact "row of clones" this module was asked to remove. Chance
   * is the wrong mechanism for a guarantee.
   *
   * So each archetype gets a seeded permutation of all eighteen
   * variants and figures take entries from it in order. The first
   * eighteen figures of any one archetype are then distinct BY
   * CONSTRUCTION rather than by luck - and enemies.js caps its rig pool
   * at three per kind, so in practice no archetype ever gets close to
   * exhausting it.
   *
   * Seeded from the spec's own literal, so it is the same permutation
   * on every run, in every course, in any load order (CONTRACT §10).
   */
  const permutations = new Map();
  function poolOrderFor(specId, specSeed) {
    let perm = permutations.get(specId);
    if (!perm) {
      const pool = IDLE_POOL.length;
      const base = Array.from({ length: pool * 2 }, (_, i) => i);
      perm = rngShuffle(makeRng(Math.imul((specSeed || 0x2f31) >>> 0, 0x27d4eb2d) >>> 0 || 1), base);
      /* Then separate every pose from its own mirror.
         A shuffle alone put `neckScratch` and `neckScratch.mirror` in
         consecutive slots for the Backup Dancer, and the census duly
         found two dancers standing five percent of a frame apart in
         what is the same gesture handed left and right. The mirror is a
         different SILHOUETTE, which is why it earns its place in the
         pool at all, but it is not a different IDEA, and two neighbours
         scratching their necks at each other reads as one animation
         playing twice. Greedy, deterministic, and it always terminates:
         eighteen entries over nine poses cannot be cornered. */
      for (let i = 1; i < perm.length; i += 1) {
        if (perm[i] % pool !== perm[i - 1] % pool) continue;
        for (let j = i + 1; j < perm.length; j += 1) {
          if (perm[j] % pool === perm[i - 1] % pool) continue;
          if (i + 1 < perm.length && perm[j] % pool === perm[i + 1] % pool) continue;
          const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
          break;
        }
      }
      permutations.set(specId, perm);
    }
    return perm;
  }

  /**
   * Attach a controller.
   *
   * `opts` is optional and every field of it is too:
   *   seed     a stable integer identity for THIS figure. Pass it if
   *            you have one - a spawner index, an actor id - and the
   *            pose stops depending on attach order entirely.
   *   variant  force a pool entry, 0..2n-1. Entries at or above the
   *            pool length are the mirrored half. QA and the
   *            silhouette probe use this; gameplay should not.
   */
  function attach(rig, opts = {}) {
    if (!rig || !rig.bones) return null;

    const bones = rig.bones;
    // Rest pose, captured once. Every clip is expressed as an offset
    // from this, so a rig with different proportions still animates.
    const rest = {};
    for (const name in bones) {
      const b = bones[name];
      if (b && b.isObject3D) rest[name] = b.quaternion.clone();
    }
    const restBonePos = bones.root ? bones.root.position.clone() : new THREE.Vector3();

    /* ---- per-figure identity ------------------------------------
       Everything that makes this figure not-its-neighbour is drawn
       here, once, from one seed. Drawing it here rather than per frame
       is what makes it STABLE: a pose that is re-rolled on the fly is
       a pose that changes between two captures of the same frame. */
    const specId = (rig.spec && rig.spec.id) || "figure";
    const isCrowd = !!(rig.spec && rig.spec.kind === "demon");
    const seed = opts.seed !== undefined
      ? (opts.seed >>> 0) || 1
      : (Math.imul(((rig.spec && rig.spec.seed) || 0x2f31) >>> 0, 0x9e3779b1)
        ^ Math.imul(ordinalFor(specId) + 1, 0x85ebca6b)) >>> 0;
    const prng = makeRng(seed || 1);

    let idlePose = null;
    let side = 1;
    if (isCrowd) {
      const n = IDLE_POOL.length;
      const perm = poolOrderFor(specId, (rig.spec && rig.spec.seed) || 0x2f31);
      let pick;
      if (opts.variant !== undefined && opts.variant !== null) {
        // QA and the silhouette probe address the pool directly.
        pick = Math.abs(opts.variant | 0) % (n * 2);
      } else if (opts.seed !== undefined) {
        // A caller with a real per-figure id has no ordinal to walk, so
        // it indexes the same permutation through its own seed. Same
        // pool, same determinism, no ordering guarantee.
        pick = perm[Math.floor(prng() * perm.length) % perm.length];
      } else {
        pick = perm[ordinalFor(specId) % perm.length];
      }
      idlePose = IDLE_POOL[pick % n];
      side = pick >= n ? -1 : 1;
    }
    /* Phase, tempo and breath depth. A crowd that all inhales together
       is as much of a tell as a crowd that all stands the same way -
       arguably worse, because motion is what the eye tracks first.
       The hero stays at 0/1/1: her timing is felt through the
       controller and there is nothing to desynchronise her from. */
    const phase = isCrowd ? prng() : 0;
    const tempo = isCrowd ? 0.84 + prng() * 0.36 : 1;
    const breathW = isCrowd ? 0.62 + prng() * 0.76 : 1;
    /* Read once, from the model. Not from the spec's `mods.wide`: that
       is an authoring knob and several forms move the shoulder or the
       arm with their own numbers, so the built skeleton is the only
       honest source for what this figure's proportions ended up as. */
    const broad = isCrowd ? shapeBroad(rig.seg) : 0;

    const acc = makeAccumulator();
    const state = {
      // Scattered, not zero, so the base idle layer and the breathe
      // additive both start this figure somewhere of its own.
      time: phase * 91.7,
      idlePose, side, phase, tempo, breathW, broad,
      variantName: idlePose ? `${idlePose.name}${side < 0 ? ".mirror" : ""}` : "hero",
      loco: 0,          // 0 idle .. 1 run
      locoPhase: phase,
      turnRate: 0,
      additives: Object.create(null),
      squashAmt: 0, squashT: 0, squashDur: 0.16,
      look: null, lookW: 0, lookCur: new THREE.Vector3(),
      footIK: false,
      // one-shot
      clip: null, clipT: 0, clipW: 0, clipFade: 0.12, clipLoop: false, clipSpeed: 1,
      // Seeded from where the rig actually IS. Starting these at zero
      // makes the first frame look like a fall from the character's
      // own spawn height and snaps every chunk to its limit.
      prevRootY: rig.root ? rig.root.position.y : 0,
      prevRootX: rig.root ? rig.root.position.x : 0,
      prevRootZ: rig.root ? rig.root.position.z : 0,
      prevVelY: 0, prevSpeedH: 0,
      prevYaw: rig.root ? rig.root.rotation.y : 0,
      scratch: makeAccumulator(),
      sub: makeAccumulator(),
      secondaries: (rig.secondary || []).map((s) => {
        const bone = bones[s.bone] || null;
        return {
          def: s, bone, v: 0, x: 0, vz: 0, xz: 0,
          // -1 / 0 / +1. The only thing anim.js needs to know about
          // where a chunk sits on the body, and the model already
          // says it: the bone's own offset from the spine.
          side: bone ? Math.sign(bone.position.x) : 0,
        };
      }),
    };

    const controller = {
      rig,
      clips: CLIPS,
      _specId: specId,

      play(name, opts = {}) {
        const key = ALIASES[name] || name;
        const def = CLIP_DEFS[key];
        if (!def) return false;
        // Restarting the clip already playing would kill a loop's
        // continuity every time a caller re-asserts its state.
        if (state.clip === def && def.loop && state.clipW > 0.9) return true;
        state.clip = def;
        state.clipLoop = opts.loop !== undefined ? opts.loop : def.loop;
        /* A LOOP starts at this figure's own phase, not at zero.
           This line matters more than it looks. enemies.js drives the
           crowd's idle through play(), and the one-shot layer damps the
           phase-offset base layer down to nothing while it is at full
           weight - so without this, every demon that entered the idle
           state restarted the same loop from the same frame and the
           offsets above bought nothing at all. A one-shot still starts
           at zero: an anticipation window that begins two-thirds of the
           way through is not an anticipation window. */
        state.clipT = state.clipLoop ? state.phase : 0;
        state.clipFade = opts.fade !== undefined ? Math.max(0.001, opts.fade) : 0.12;
        state.clipSpeed = opts.speed || 1;
        state.clipTarget = opts.weight !== undefined ? clamp01(opts.weight) : 1;
        return true;
      },

      stop(fade = 0.15) { state.clipTarget = 0; state.clipFade = fade; },

      setLocomotion(speedNorm, turnRate) {
        state.loco = clamp01(speedNorm || 0);
        state.turnRate = turnRate || 0;
      },

      additive(name, weight) {
        if (!ADDITIVE[name]) return;
        state.additives[name] = weight || 0;
      },

      lookAt(worldPos, weight) {
        state.look = worldPos || null;
        state.lookW = clamp01(weight === undefined ? 1 : weight);
      },

      footIK(on) { state.footIK = !!on; },

      squash(amount, duration) {
        state.squashAmt = amount || 0;
        state.squashDur = Math.max(0.02, duration || 0.16);
        state.squashT = 0;
      },

      get action() { return state.clip ? state.clip._name : null; },

      /** Which idle this figure drew, for QA and for handoff notes.
       *  "hero" when it is not drawing from the pool at all. */
      get idleVariant() { return state.variantName; },

      /**
       * Re-draw this figure's identity from a caller-supplied seed.
       *
       * The default seeding is stable but it is keyed on attach order,
       * which is a property of the RIG POOL rather than of the figure
       * standing in the world - so two enemies that swap pool slots
       * swap poses. A caller with a real per-figure id (enemies.js has
       * `e.id`; a levels.js crowd post has its index) should call this
       * once when the figure claims a rig, and the pose then belongs to
       * the enemy instead of to the slot. Cheap enough to call on every
       * claim; it allocates one small RNG.
       */
      setSeed(n) {
        const s = (n >>> 0) || 1;
        const r = makeRng(s);
        if (isCrowd) {
          const len = IDLE_POOL.length;
          const perm = poolOrderFor(specId, (rig.spec && rig.spec.seed) || 0x2f31);
          const pick = perm[Math.floor(r() * perm.length) % perm.length];
          state.idlePose = IDLE_POOL[pick % len];
          state.side = pick >= len ? -1 : 1;
          state.phase = r();
          state.tempo = 0.84 + r() * 0.36;
          state.breathW = 0.62 + r() * 0.76;
          state.variantName = `${state.idlePose.name}${state.side < 0 ? ".mirror" : ""}`;
          state.time = state.phase * 91.7;
          state.locoPhase = state.phase;
          if (state.clip && state.clipLoop) state.clipT = state.phase;
        }
        return state.variantName;
      },

      dispose() { controllers.delete(controller); },
      _state: state,
      _rest: rest,
      _acc: acc,
      _restBonePos: restBonePos,
    };

    controllers.add(controller);
    return controller;
  }

  /** Head/neck aim with a limit cone, shared with the enemies. */
  function applyLook(c, dt) {
    const s = c._state;
    if (!s.look || s.lookW <= 0.001) return;
    const head = c.rig.bones.head;
    if (!head) return;
    head.updateMatrixWorld();
    _v.setFromMatrixPosition(head.matrixWorld);
    _v2.copy(s.look).sub(_v);
    if (_v2.lengthSq() < 1e-6) return;
    // Into the head's parent space, so the cone limit is about the
    // torso rather than about the world.
    const parent = head.parent;
    if (parent) {
      _mat.copy(parent.matrixWorld).invert();
      _v2.transformDirection(_mat);
    }
    const yaw = clamp(Math.atan2(_v2.x, -_v2.z), -1.1, 1.1);
    const pitch = clamp(Math.asin(clamp(_v2.y / Math.max(1e-5, _v2.length()), -1, 1)), -0.7, 0.7);
    s.lookCur.x = damp(s.lookCur.x, pitch, 9, dt);
    s.lookCur.y = damp(s.lookCur.y, yaw, 9, dt);
    const w = s.lookW;
    add(c._acc, "head", (s.lookCur.x * w) / DEG * 0.7, (s.lookCur.y * w) / DEG * 0.7, 0);
    add(c._acc, "neck", (s.lookCur.x * w) / DEG * 0.3, (s.lookCur.y * w) / DEG * 0.3, 0);
  }

  /**
   * Secondary motion for hair chunks and coat tails.
   *
   * WHAT THE PARAMETERS ARE AND WHERE THEY COME FROM
   *
   * character.js authors one `sec(bone, stiffness, damping, drive,
   * swing, gravity, limit)` per chunk, next to the geometry, because
   * the modeller is the one who knows a back coat tail is four times
   * the mass of a fringe. This function is the only consumer of that
   * authoring and it has to read ALL of it:
   *
   *   stiffness/damping  the spring itself
   *   drive              answer to a CHANGE of motion (a landing)
   *   swing              steady trail while simply moving
   *   gravity            constant droop, so the chunks differ even in
   *                      a still frame - and the capture harness only
   *                      ever photographs still frames
   *   limit              per-chunk travel cap
   *
   * This used to read `sec.def.gain`, a name character.js has never
   * exported, and to ignore drive/swing/gravity/limit entirely. Every
   * chunk therefore ran one shared response and one shared +-0.6 clamp:
   * measured over a two-metre drop all eight moved within 8% of each
   * other and railed against the same clamp on the same frame. That is
   * a whole head of hair swinging as one lump, which is precisely the
   * cheap-secondary tell the per-chunk authoring exists to avoid.
   *
   * Driven from ACCELERATION rather than velocity, as this file has
   * always claimed: hair deflected for the whole of a long fall is
   * hair being HELD, not hair being thrown. The impulse is the change
   * in velocity over the frame, which is frame-rate independent - a
   * 9 m/s landing is a 9-unit impulse whether it resolves in one step
   * or three.
   *
   * The lateral channel matters as much as the vertical one. With a
   * single axis every chunk moves in the same plane, so even perfectly
   * differentiated springs read as one rigid flap. Yaw rate throws the
   * tails sideways, which is what a turn actually looks like.
   */
  function applySecondary(c, dt) {
    const s = c._state;
    if (!s.secondaries.length) return;
    const gameplayRoot = c.rig.root;
    if (!gameplayRoot) return;

    const p = gameplayRoot.position;
    const invDt = 1 / Math.max(1e-4, dt);
    const velY = (p.y - s.prevRootY) * invDt;
    const velX = (p.x - s.prevRootX) * invDt;
    const velZ = (p.z - s.prevRootZ) * invDt;
    const speedH = Math.hypot(velX, velZ);
    s.prevRootY = p.y; s.prevRootX = p.x; s.prevRootZ = p.z;

    // Impulses, in m/s of velocity change. Clamped because a teleport
    // or a course load moves the root metres in one step and a spring
    // that answers that honestly detonates.
    const kickY = clamp(velY - s.prevVelY, -18, 18);
    const kickH = clamp(speedH - s.prevSpeedH, -18, 18);
    s.prevVelY = velY; s.prevSpeedH = speedH;

    const yawRate = clamp(angleDelta(s.prevYaw, gameplayRoot.rotation.y) * invDt, -14, 14);
    s.prevYaw = gameplayRoot.rotation.y;

    // Sub-step the stiff chunks. The fringe runs at stiffness 210 and
    // lateUpdate hands us dt up to 1/20 on a bad frame; one Euler step
    // that wide turns a spring into a buzzer.
    const sub = clamp(Math.ceil(dt * 110), 1, 4);
    const sdt = dt / sub;

    for (const sec of s.secondaries) {
      if (!sec.bone) continue;
      const def = sec.def;
      const stiff = def.stiffness || 60;
      const damp2 = def.damping || 9;
      const drive = def.drive === undefined ? 1 : def.drive;
      const swing = def.swing === undefined ? 0.6 : def.swing;
      const limit = def.limit || 0.6;

      // Trail and droop pull the same way - both are "hangs back" -
      // so a still frame already shows a stiff fringe sitting nearly
      // on the skull and a loose tail hanging well off it.
      const targetX = -(s.loco * swing * SEC_SWING) - (def.gravity || 0);
      const targetZ = yawRate * swing * SEC_YAW;

      /* A landing is an IMPULSE and it goes into the velocity, not
         into the spring's target. Pushing the target instead is what a
         first pass at this always does and it does almost nothing: the
         target only holds for the single frame the kick lasts, so a
         9 m/s landing moved a coat tail three degrees. Into the
         velocity, the same kick throws a soft tail about a fifth of a
         turn and a stiff fringe a third of that - which is the whole
         difference the per-chunk authoring is asking for, because peak
         travel goes as v0/sqrt(stiffness).
         Upward acceleration - a take-off AND a landing, both - makes
         hair lag behind the head; a fall lets it float forward. */
      const kick = -(kickY + kickH * 0.6) * drive * SEC_KICK;
      sec.v += kick;
      // ...and it splays the pair OUTWARD, left tail left and right
      // tail right, which is the read that says "impact" rather than
      // "the whole head of hair shifted". `side` comes off the bone's
      // own offset, so a centred chunk correctly gets none of it.
      sec.vz -= kick * sec.side * SEC_SPLAY;

      for (let i = 0; i < sub; i += 1) {
        sec.v += (targetX - sec.x) * stiff * sdt;
        sec.v -= sec.v * damp2 * sdt;
        sec.x = clamp(sec.x + sec.v * sdt, -limit, limit);
        sec.vz += (targetZ - sec.xz) * stiff * sdt;
        sec.vz -= sec.vz * damp2 * sdt;
        sec.xz = clamp(sec.xz + sec.vz * sdt, -limit, limit);
      }

      const restQ = c._rest[def.bone];
      if (restQ) {
        _qe.set(sec.x, 0, sec.xz);
        _q.setFromEuler(_qe);
        sec.bone.quaternion.copy(restQ).multiply(_q);
      }
    }
  }

  /** Plant the feet onto whatever is actually under them. */
  function applyFootIK(c) {
    const s = c._state;
    if (!s.footIK || !ctx.collision || typeof ctx.collision.groundAt !== "function") return;
    for (const side of ["L", "R"]) {
      const foot = c.rig.bones[`foot${side}`];
      const shin = c.rig.bones[`shin${side}`];
      if (!foot || !shin) continue;
      foot.updateMatrixWorld();
      _v.setFromMatrixPosition(foot.matrixWorld);
      const hit = ctx.collision.groundAt(_v.x, _v.z, _v.y + 0.5, 1.2);
      if (!hit) continue;
      const lift = hit.y - _v.y;
      if (Math.abs(lift) > 0.4) continue;   // do not stretch the leg
      // Roll the ankle onto the surface normal so a foot on a ramp
      // does not intersect it. A foot through a slope is the loudest
      // possible "this is not AAA" cue on an otherwise good character.
      if (hit.normal) {
        const pitch = Math.asin(clamp(-hit.normal.z, -0.6, 0.6));
        const roll = Math.asin(clamp(hit.normal.x, -0.6, 0.6));
        _qe.set(pitch, 0, roll);
        _q.setFromEuler(_qe);
        foot.quaternion.multiply(_q);
      }
    }
  }

  function step(c, dt, t) {
    const s = c._state;
    const acc = c._acc;
    resetAccumulator(acc);

    /* This figure's own clock. `tempo` is 1 for the hero and roughly
       0.84..1.20 for a crowd figure, which is enough that two demons
       standing side by side are visibly out of step within a second
       and never fall back into step. It scales only the idle/breathe
       clock - one-shot clips advance on real seconds through clipT, so
       nothing timed against gameplay drifts. */
    s.time += dt * s.tempo;

    /* ---- base locomotion ---- */
    // Phase advances with speed so the feet do not skate: a faster
    // character takes more steps, it does not take longer ones.
    const cycle = lerp(1.0, 0.62, s.loco);
    s.locoPhase = (s.locoPhase + dt / cycle) % 1;

    const idleW = 1 - clamp01(s.loco * 2.2);
    const walkW = clamp01(s.loco * 2.2) * (1 - clamp01((s.loco - 0.5) * 2));
    const runW = clamp01((s.loco - 0.5) * 2);

    // The gait helper takes a weight directly; the idle clip does not,
    // so it is posed into a scratch accumulator and merged at weight.
    if (idleW > 0.001) {
      resetAccumulator(s.scratch);
      CLIP_DEFS.idle.pose((s.time / CLIP_DEFS.idle.dur) % 1, s.scratch, c);
      mergeInto(acc, s.scratch, idleW);
    }
    if (walkW > 0.001) gait(s.locoPhase, acc, 26, 0.035, 3, 0.55, walkW);
    if (runW > 0.001) gait(s.locoPhase, acc, 42, 0.07, 12, 0.9, runW);

    /* ---- one-shot clip, cross-faded over the base ---- */
    const target = s.clip ? (s.clipTarget === undefined ? 1 : s.clipTarget) : 0;
    s.clipW = damp(s.clipW, target, 1 / s.clipFade, dt);
    if (s.clip && s.clipW > 0.002) {
      s.clipT += (dt * s.clipSpeed) / s.clip.dur;
      if (s.clipT >= 1) {
        if (s.clipLoop) s.clipT %= 1;
        else { s.clipT = 1; s.clipTarget = 0; }
      }
      // The base pose is scaled down by exactly the clip's weight, so
      // the two never sum past a full pose and blow the limbs out.
      damp0(acc, 1 - s.clipW);
      resetAccumulator(s.sub);
      s.clip.pose(s.clipT, s.sub, c);
      mergeInto(acc, s.sub, s.clipW);
      if (s.clipW < 0.003 && target === 0) s.clip = null;
    }

    /* ---- additive layers ----
       Breath DEPTH is per figure as well as breath phase. Two figures
       that inhale at different moments but by the same amount still
       read as one rig driving both; a lung is the second-cheapest
       individual trait after the pose itself. */
    ADDITIVE.breathe(acc, s.breathW, s.time);
    for (const name in s.additives) {
      const w = s.additives[name];
      if (Math.abs(w) > 0.001 && ADDITIVE[name]) ADDITIVE[name](acc, w, s.time);
    }

    /* ---- compose onto the rest pose ---- */
    const bones = c.rig.bones;
    for (const name in acc) {
      if (name === "_rp" || name === "_rr") continue;
      const bone = bones[name];
      const restQ = c._rest[name];
      if (!bone || !restQ) continue;
      const e = acc[name];
      _qe.set(e[0], e[1], e[2], "XYZ");
      _q.setFromEuler(_qe);
      bone.quaternion.copy(restQ).multiply(_q);
    }

    /* ---- root offset, rotation and squash ----

       These go on the root BONE, never on rig.root.

       rig.root is the group gameplay owns: player.js writes the body's
       world position into it every frame. Writing an animation-space
       offset there too means whichever system writes last wins - and
       anim runs in lateUpdate, so anim won, pinning the character at
       the origin while the body walked off without her. The root bone
       is the animation's own space and is exactly what it is for. */
    const rootBone = bones.root;
    if (rootBone) {
      const restRoot = c._rest.root;
      rootBone.position.set(
        c._restBonePos.x + acc._rp[0],
        c._restBonePos.y + acc._rp[1],
        c._restBonePos.z + acc._rp[2]
      );
      // Clip root rotation is authored in the rig's own space and is
      // additive to whatever the gameplay yaw already set, so it is
      // applied to the hips rather than to the rig root - otherwise a
      // somersault would fight the character's facing.
      const hips = bones.hips;
      const restHips = c._rest.hips;
      if (hips && restHips && (acc._rr[0] || acc._rr[1] || acc._rr[2])) {
        _qe.set(acc._rr[0], acc._rr[1], acc._rr[2], "XYZ");
        _q.setFromEuler(_qe);
        hips.quaternion.copy(restHips).multiply(_q);
      }

      if (s.squashAmt !== 0) {
        s.squashT += dt;
        const p = clamp01(s.squashT / s.squashDur);
        // outElastic so it overshoots and settles rather than easing
        // flat. A squash that returns monotonically reads as a scale
        // animation; one that rings reads as impact.
        const k = s.squashAmt * (1 - ease.outElastic(p));
        rootBone.scale.set(1 + k * 0.5, 1 - k, 1 + k * 0.5);
        if (p >= 1) { s.squashAmt = 0; rootBone.scale.set(1, 1, 1); }
      }
    }

    applyLook(c, dt);
    applyFootIK(c);
    applySecondary(c, dt);

    if (c.rig.skeleton && c.rig.root) c.rig.root.updateMatrixWorld(true);
  }

  /* ---- pose census --------------------------------------------------
     The pool is only worth what a FRAME shows of it, and until this
     existed the only way to know was to open the capture and count
     figures by eye. Three things per figure, all read after the last
     step() so they describe exactly what was drawn:

       sig    the composed pose itself, quantised. The variant name is
              the intent; this is the outcome, and it is what catches
              two differently-named poses that happen to arrive at the
              same shape on some particular build.
       arms   shoulder-to-hand direction per side, in the figure's OWN
              space: elevation in degrees (+ is up, -90 hangs at the
              side) and how much of the reach is lateral. This is the
              measurable content of "reads as a T" - both arms near
              zero elevation, both near fully lateral, and the two
              sides agreeing.
       sec    where each secondary chunk is sitting, so a run can show
              that per-figure phase offsets did not quietly flatten the
              spring differentiation they sit next to.
     -------------------------------------------------------------- */
  const SIG_BONES = [
    "hips", "spine", "chest", "neck", "head",
    "shoulderL", "armL", "forearmL", "handL",
    "shoulderR", "armR", "forearmR", "handR",
    "thighL", "thighR",
  ];

  function armGeometry(c) {
    const out = {};
    const root = c.rig.root;
    if (!root) return out;
    root.updateMatrixWorld(true);
    _mat.copy(root.matrixWorld).invert();
    for (const side of ["L", "R"]) {
      const sh = c.rig.bones[`shoulder${side}`];
      const hand = c.rig.bones[`hand${side}`];
      if (!sh || !hand) continue;
      _v.setFromMatrixPosition(sh.matrixWorld).applyMatrix4(_mat);
      _v2.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(_mat);
      _v2.sub(_v);
      const len = _v2.length();
      if (len < 1e-5) continue;
      _v2.divideScalar(len);
      out[side] = {
        elev: +(Math.asin(clamp(_v2.y, -1, 1)) / DEG).toFixed(1),
        lat: +Math.abs(_v2.x).toFixed(3),
      };
    }
    return out;
  }

  /* 1 is a scarecrow, 0 is anything a person does. Both factors have to
     hold: an arm out and level on ONE side is `point`, which is a good
     pose. The elevation agreement term is what separates the two. */
  function tScoreOf(arms) {
    const horiz = (s) => (s
      ? clamp01(1 - Math.abs(s.elev) / 30) * clamp01((s.lat - 0.5) / 0.4)
      : 0);
    if (!arms.L || !arms.R) return 0;
    const agree = clamp01(1 - Math.abs(arms.L.elev - arms.R.elev) / 40);
    return +(Math.min(horiz(arms.L), horiz(arms.R)) * agree).toFixed(3);
  }

  function figureOf(c) {
    const s = c._state;
    const root = c.rig.root;
    let visible = !!(root && root.visible);
    for (let p = root && root.parent; visible && p; p = p.parent) {
      if (!p.visible) visible = false;
    }
    const sig = [];
    for (const name of SIG_BONES) {
      const e = c._acc[name];
      // 4 degrees. The breathing terms inside a pose are one to three,
      // so this quantises them away and leaves the pose.
      sig.push(e ? `${Math.round(e[0] / DEG / 4)},${Math.round(e[1] / DEG / 4)},${Math.round(e[2] / DEG / 4)}` : "0,0,0");
    }
    const arms = armGeometry(c);
    return {
      spec: c._specId,
      variant: s.variantName,
      pose: s.idlePose ? s.idlePose.name : null,
      side: s.side,
      phase: +s.phase.toFixed(3),
      tempo: +s.tempo.toFixed(3),
      breath: +s.breathW.toFixed(3),
      broad: +s.broad.toFixed(3),
      visible,
      pos: root ? [+root.position.x.toFixed(2), +root.position.y.toFixed(2), +root.position.z.toFixed(2)] : [0, 0, 0],
      height: c.rig.height || 1.7,
      sig: sig.join("|"),
      arms,
      tScore: tScoreOf(arms),
      sec: s.secondaries.map((x) => ({ bone: x.def.bone, x: +x.x.toFixed(4), xz: +x.xz.toFixed(4) })),
    };
  }

  /* Accumulator maths kept out of step() for readability. */
  function damp0(a, k) {
    for (const key in a) {
      if (key === "_rp" || key === "_rr") { a[key][0] *= k; a[key][1] *= k; a[key][2] *= k; continue; }
      const e = a[key];
      e[0] *= k; e[1] *= k; e[2] *= k;
    }
  }
  function mergeInto(a, b, w) {
    for (const key in b) {
      if (key === "_rp" || key === "_rr") {
        a[key][0] += b[key][0] * w; a[key][1] += b[key][1] * w; a[key][2] += b[key][2] * w;
        continue;
      }
      let e = a[key];
      if (!e) e = a[key] = [0, 0, 0];
      e[0] += b[key][0] * w; e[1] += b[key][1] * w; e[2] += b[key][2] * w;
    }
  }

  return {
    attach,
    clips: CLIPS,

    lateUpdate(ctx) {
      const dt = Math.min(ctx.clock.dt, 1 / 20);
      if (dt <= 0) return;
      for (const c of controllers) {
        try { step(c, dt, ctx.clock.t); } catch (error) {
          console.error("[apop3d] anim step failed; detaching controller", error);
          controllers.delete(c);
        }
      }
      // Every glowing part in the game pulses on the same beat.
      ctx.character?.setBeat?.(1 - (ctx.clock.beat || 0));
    },

    /**
     * QA surface. `variants` is the histogram the pose pool exists to
     * keep flat: a name appearing twice among the VISIBLE figures is
     * two figures standing in the same pose, which is the defect this
     * module was asked to remove and the only cheap way to check it
     * without eyeballing every capture.
     */
    report(opts = {}) {
      const variants = Object.create(null);
      const visible = Object.create(null);
      const figures = [];
      for (const c of controllers) {
        const n = c._state.variantName;
        variants[n] = (variants[n] || 0) + 1;
        if (c.rig && c.rig.root && c.rig.root.visible) {
          visible[n] = (visible[n] || 0) + 1;
        }
        // Off by default: it walks every bone of every figure and the
        // HUD has no business paying for that.
        if (opts.figures) {
          try { figures.push(figureOf(c)); } catch { /* a half-built rig is not worth a throw */ }
        }
      }
      return {
        controllers: controllers.size,
        clips: CLIPS.length,
        pool: IDLE_POOL.length,
        variants,
        visible,
        figures,
      };
    },
    dispose() { controllers.clear(); },
  };
}
