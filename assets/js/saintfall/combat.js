/* ============================================================
   SAINTFALL - combat

   Player hitscan fire, hostile projectiles, damage, enemy behaviour,
   and the player's own health. Everything here is deliberately
   readable rather than physical: a shot is a swept ray, a hit is a
   capsule test, and an enemy decides what to do from four numbers.

   The rule that shapes the whole file: NOTHING may reach through
   masonry. A shot, a sight line and a charge all ask
   `collide.rayBlock` first, because the moment collision existed for
   the player and not for the enemies, the Cathedral turned into a
   place where you get shot through the wall by something that then
   walks around it.
   ============================================================ */

import { clamp, clamp01, damp, makeBus } from "saintfall/core.js";

const TAU = Math.PI * 2;

export const SURVIVAL_CONFIG = Object.freeze({
  playerMaxHp: 150,
  enemyDamageMultiplier: 0.82,
  regenDelay: 5.5,
  regenPerSecond: 10,
});

/* Close-combat tuning lives beside the authoritative damage path. The
   animation supplies each move's character; these values define what the
   censer-lance consistently means in the world. */
export const MELEE_CONFIG = Object.freeze({
  reachMultiplier: 1.24,
  lightEnemy: "thresher",
  lightKnockbackSpeed: 16,
  chargeOnHit: 3,
  chargeOnKill: 3,
  maxChargeRestore: 9,
  hitSparkScale: 2.10,
  hitPunch: 1.05,
  whiffPunch: 0.24,
  slamPunch: 1.35,
});

/* The Gleaner is the one ordinary ranged enemy, so this is the player's
   complete incoming-fire reaction window. Its bolt is authoritative now:
   damage is resolved when this travelling point reaches the player's
   capsule, not when the muzzle flashes. */
export const GLEANER_PROJECTILE_CONFIG = Object.freeze({
  speed: 105,
  directAimChance: 0.42,
  horizontalSpread: 0.14,
  verticalSpread: 0.09,
  playerRadius: 0.52,
  playerCapsuleBottom: 0.28,
  playerCapsuleTop: 1.58,
  maxRange: 60,
});

/* Body capsules in WORLD metres, taken from what
   `saintfall-bestiary-measure.mjs` measured rather than guessed - a
   hit volume that does not match the silhouette is the single
   most-felt bug in a shooter.

   World metres, so they are NOT multiplied by the instance scale
   again. Doing that once shrank the Thresher's box to 0.71m against
   a creature that stands 1.19m, and the top third of it could not be
   shot at all.

   `r` is cut to the BODY, not to the feet. A hexapod's widest point
   is its leg splay, and a Harrow's feet are 1.9m out from its
   centreline - a capsule cut to those would register body hits on
   shots passing a clear metre wide of anything solid.

   `head`/`headZ` place the head sphere in the creature's own frame:
   height, and how far FORWARD of the body axis it sits. The offset
   is not a refinement. These are long animals with their heads out
   in front - a Gleaner's is 0.85m forward - and the old test measured
   the head's distance from the vertical axis, so on every one of them
   the head sphere sat in the middle of the thorax and a shot that
   visibly hit the face scored body damage. */
const HITBOX = {
  thresher: {
    r: 0.80, y0: 0.02, y1: 1.30, head: 0.70, headR: 0.34, headZ: 0.52,
  },
  precentor: {
    r: 1.95, y0: 0.02, y1: 3.24, head: 1.74, headR: 0.84, headZ: 1.28,
  },
  cantor: {
    r: 1.18, y0: 0.02, y1: 3.48, head: 2.72, headR: 0.48, headZ: 0.10,
    muzzle: 2.08, muzzleZ: 0.72,
  },
  gleaner: {
    // Tall and thin: nearly all of the capsule is leg, which is
    // correct - shooting the stilts out from under it should work.
    r: 0.80, y0: 0.02, y1: 3.62, head: 2.02, headR: 0.42, headZ: 0.86,
    // The spinneret it actually fires from, carried up over its back.
    // Without this the return fire came out of its chest while the
    // muzzle flared a metre above, which reads as a bug even to a
    // player who could not say what was wrong.
    muzzle: 3.10, muzzleZ: 0.92,
  },
  harrow: {
    r: 1.20, y0: 0.02, y1: 2.70, head: 1.24, headR: 0.52, headZ: 0.96,
  },
  matriarch: {
    /* The body capsule is deliberately NARROWER than the animal.
       Ten metres of gaster trailing behind it means a capsule sized
       to the whole creature would swallow the ground the player has
       to stand on to reach the weak point, and every shot at the
       flank would resolve on the body before it got there. 2.3m is
       the mesosoma - the part that is actually solid. */
    r: 2.30, y0: 0.02, y1: 5.05, head: 4.16, headR: 0.92, headZ: 1.40,
    /* THE WEAK POINT. Sphere on the gaster, behind and low, in the
       same (yaw, forward, up) frame the head uses. Everything else
       in the bestiary is killed by shooting it anywhere; this one
       has a place to shoot, and it is on the far side of the animal. */
    weak: { y: 1.95, z: -3.30, r: 1.55, mult: 4.5 },
  },

  /* ------------------------------------------------------------------
     THE COULTER. Not a capsule, because it is not a shape - it is a
     twenty-five metre chain that is usually mostly underground and
     bent into an arch.
     ------------------------------------------------------------------ */
  coulter: {
    /* The flag that sends every damage path in this file to the live
       spine instead of to a vertical cylinder. A capsule sized to this
       animal would be a 25m column standing on its head. */
    segments: true,
    /* Radius per body joint, front to back, matching the .glb's own
       taper - it is thickest a third of the way back, and the tail is
       genuinely thin enough to shoot past. The first entry is the
       head. */
    profile: [1.28, 1.48, 1.58, 1.55, 1.48, 1.39, 1.28, 1.15,
      1.01, 0.86, 0.70, 0.51, 0.31, 0.14],
    // Fallbacks, for anything that asks a burrower a capsule question.
    r: 1.35, y0: -1.30, y1: 2.60, head: 0, headR: 0, headZ: 0,
    /* THE MAW, and the reason this fight has a tell.
       A live sphere in front of the head rather than a fixed offset in
       the creature's own frame, because it is only THERE when the mouth
       is open - and the mouth is only open while the animal is biting
       or spitting. So the window in which the boss can be hurt properly
       is exactly the window in which it can hurt you, which is the one
       property that makes a damage multiplier a decision instead of a
       bonus.

       `open` is the threshold on the clip-driven aperture. Below it the
       petals are across the throat and a shot into them is an ordinary
       body hit. */
    maw: { r: 1.60, forward: 1.35, mult: 4.5, open: 0.45 },
  },

  /* ------------------------------------------------------------------
     THE DISTAFF. Not a capsule and not a chain - a standing body with
     eight independently-hittable legs under it, and nothing else in
     the bestiary has more than one designed target on a single kill.

     `legs: true` sends every damage path to `legAndBodyHit` instead of
     the capsule/head/weak test above. `r`/`y0`/`y1`/`head`/`headR`/
     `headZ` stay here anyway as the fallback every OTHER system that
     asks a creature a capsule question still needs - `explode` and
     `shockwave` in particular, which reasonably treat "near its feet"
     as "hit it" rather than learning what a leg is. */
  distaff: {
    legs: true,
    legCount: 8,
    /* Thick enough to match the model's own bristled legs - a hair-
       thin capsule on a leg this size would put most near-misses a
       player calls a hit outside it. Raised from 0.62 after playtest:
       the visual legs carry bristle fringes well past their core, and
       shots that look on-target were falling outside the old radius. */
    legRadius: 0.85,
    /* The foot bone is the centre of a visible tarsus and three
       outward claws, not the very end of the rendered limb. The
       lower-leg capsule already rounds over the joint; this slightly
       wider live-bone sphere carries that coverage through the claw
       silhouette instead of ending damage at an invisible pivot. */
    footRadius: 1.10,
    /* THE BODY IS A CAPSULE BETWEEN TWO LIVE BONES - "abdomen2" at
       the rear, "head" at the front - because those are the two rig
       origins that actually sit inside the visual mass. (The
       "prosoma" bone's origin is at the armature ROOT, ground level;
       an earlier build centred the collapsed hit sphere on it and put
       the target at the animal's feet while the visible body hung
       nine metres up.) Shootable in EVERY phase - a boss you can see
       but cannot damage reads as a bug, not a mechanic - but only a
       WEAK target while collapsed, so the leg fight is still what
       buys the bonus window rather than the only way to hurt it. */
    bodyBones: ["abdomen2", "head"],
    bodyRadius: 3.1,
    /* Ranged reward for finding the collapsed body anyway; melee's is
       larger and applied directly in `meleeStrike` - see the comment
       there for why the two are not the same number. */
    weak: { mult: 1.4 },
    collapsedMeleeMult: 2.35,
    /* How far above the player's feet a melee swing can honestly
       claim to land. Without this gate the xz-only reach test lets a
       ground-level swing "hit" a coxa nine metres overhead, and with
       it the reachable band is exactly what it looks like: feet,
       shins, and whatever the collapse brings down. */
    meleeReachY: 3.6,
    // Fallback capsule for explode()/shockwave(), which treat this as
    // an ordinary tall, narrow-based creature.
    r: 3.7, y0: 0.02, y1: 13.8, head: 12.9, headR: 1.3, headZ: 2.2,
  },

  /* ------------------------------------------------------------------
     THE WINNOWER. A flyer, so every offset here is measured from an
     origin that is thirty metres up rather than from the sand - which
     costs nothing, because `y0`/`y1` were always relative to `inst.y`
     and a flyer simply moves that.

     The capsule is cut to the BODY. A hit volume sized to twenty-six
     metres of wingspan would eat every shot that passes anywhere near
     it, and the wings are not what the player is aiming at.
     ------------------------------------------------------------------ */
  winnower: {
    r: 1.5, y0: -2.6, y1: 1.6, head: 0.4, headR: 0.85, headZ: 4.4,
    /* The gaster. The insect rebuild hung seven metres of glowing
       abdomen behind a body whose hit capsule is VERTICAL at the
       origin - without this, the biggest lit surface on the animal
       would eat shots and report nothing. A fore-aft capsule in the
       creature's frame, matching the authored curl. */
    tail: { a: [0, 0.1, -2.0], b: [0, -1.5, -6.9], r: 1.15 },
    /* THE HEAT SACS. Two live spheres on the wing roots, and the only
       way a ranged build can shorten the wait for a landing. Unlike
       the Matriarch's single fixed weak point these are a RESOURCE:
       shooting them does not multiply damage much, it drains the lift
       pool in winnower.js, and draining that pool is what brings the
       animal down early. The reward is the window, not the number. */
    sacs: {
      /* The bones are authoritative; the offsets are the fallback for
         anything asking before the rig exists. Both mirror
         `SAC_OFFSETS` in saintfall-winnower.py. */
      bones: ["sac_L", "sac_R"],
      offsets: [[1.35, 0.25, 0.85], [-1.35, 0.25, 0.85]],
      r: 0.95,
      mult: 1.5,
      lift: 1.0,
    },
    /* The furnace gut, slung under the thorax. Only a designed target
       while it is on the ground: in the air it is nine metres over the
       player's head and pointing away from them, and a weak point that
       can be sniped from underneath mid-flight would delete the whole
       reason the animal ever has to land. */
    /* Y AND Z BOTH COME OFF THE MODEL'S OWN `HEART` VECTOR
       (saintfall-winnower.py). This read -1.9 for one build - the
       gut's lowest EXTENT rather than its centre - which put forty
       per cent of the hit sphere under the sand and meant aiming at
       the glowing furnace was aiming a metre high. The z has always
       been right, which is what proves the y was a transcription
       slip rather than a decision. */
    heart: { y: -0.85, z: 0.35, r: 1.25, mult: 4.0 },
  },

  /* ------------------------------------------------------------------
     THE GARNER. The same primitive as the Distaff - independent limbs
     plus a body - reached from the opposite direction, which is exactly
     why `legs: true` is a hit-table flavour rather than a species test.

     The Distaff carries its body nine metres above eight legs, and the
     fight is about cutting the legs until the body comes DOWN. The
     Garner's body never moves: it is a mouth set in the ground, always
     within reach, and the six tentacles are the thing that leaves. So
     the two numbers that shape the encounter are inverted. `meleeReachY`
     is low, because a tentacle is only a melee target while it is lying
     on the sand and a raised one must not be swingable at; and the maw
     is a real ranged target in every phase, which is the reason the
     player has something to do while all six limbs are in the air.
     ------------------------------------------------------------------ */
  garner: {
    legs: true,
    legCount: 6,
    /* Thicker than a Distaff leg because a tentacle IS thicker - the
       rendered tube is 1.8m through at the root and tapers to a pad -
       and the three capsules below are laid along its spline rather
       than along a straight bone. A radius cut to the tip would make
       the root, which is most of the visible limb, nearly unhittable. */
    legRadius: 0.95,
    /* The tip, and it is a designed target: the grasping pad is the
       fattest part of a tentacle's last two metres and it is what lands
       next to the player when a lash misses. */
    footRadius: 1.35,
    /* THE MAW, as a capsule between two live nodes garner.js drives -
       the throat's floor and its lip. Both move: the mouth rises out of
       the ground on the reveal and sinks back into it on the leash, and
       a fixed offset would leave the hit volume standing in open air
       above a closed pit. */
    bodyBones: ["garner_throat", "garner_lip"],
    /* Sized so that a player held off at the pit's lip can still swing
       into the mouth, and no larger. The arithmetic is a contract with
       garner.js's `keepOutScale`: the animal stops them at the inner
       edge of the broken pan, 14m from the throat axis, and the lance
       reaches 3.4m - so anything under 10.6m here would make the gorge
       window ranged-only and the melee payoff a lie. It is still
       narrower than the mouth, which is 19m across at the collar, so
       shots wide of the tusks genuinely miss. */
    bodyRadius: 6.8,
    /* Ranged reward for shooting a gullet that is actually open. Modest,
       for the same reason the Distaff's is: the limb fight has to stay
       worth doing. */
    weak: { mult: 1.5 },
    /* And melee's, which is larger and applied in `meleeStrike`. A
       player standing at the lip of an open mouth swinging a polearm
       into it has earned more than a rifle shot from forty metres. */
    collapsedMeleeMult: 2.6,
    /* Low, and it is the whole tentacle mechanic. A lash that misses
       falls across the sand and drags home along it; a lash that is
       still winding up is eleven metres overhead. This one number is
       what makes those two states different to a swing without either
       of them needing to tell combat.js which it is. */
    meleeReachY: 3.0,
    /* Fallback capsule for explode()/shockwave(), which reasonably
       treat "near it" as "hit it". Cut to the maw's collar rather than
       to the crater: ordnance dropped on the rim of the pit should not
       resolve on the animal at the bottom of it. */
    r: 6.8, y0: -2.0, y1: 6.5, head: 3.5, headR: 2.0, headZ: 0,
  },

  /* ------------------------------------------------------------------
     THE ABBESS. A queen: four metres of armoured thorax in front and
     twenty metres of egg sac behind, and the hit table is that sentence
     rendered as arithmetic.

     `sac: true` sends every damage path to the LIVE spine the encounter
     publishes on `inst.sacSpine`, one capsule per segment at its own
     current radius. It has to be live rather than authored because the
     sac breathes, swells when she lays, and heaves nine metres into the
     air when she slams - a fixed volume would be wrong in all three
     states and most wrong in the one that matters.
     ------------------------------------------------------------------ */
  abbess: {
    sac: true,
    /* The thorax: a short capsule at the origin, in front of the sac,
       and the ONE part of her that resists. Everything the player can
       see from the chamber's mouth is this; everything worth shooting
       is behind it. Turning her armour toward the door is the whole of
       her positional design. */
    r: 3.1, y0: 0.02, y1: 5.6, head: 4.2, headR: 1.9, headZ: 4.6,
    /* Armour, expressed as a discount rather than as immunity. A player
       who empties a magazine into her face should see numbers - just
       bad ones - or they will read it as a broken hitbox rather than as
       a wrong target. */
    thoraxMult: 0.34,
    /* THE UNDERSIDE, and the reason the fight has a decision in it.

       Only present while `inst.raised` is past the aperture, which is
       exactly the window in which she is winding up the slam. The most
       dangerous ground on the map and the only place her one weak point
       can be shot are the same two metres, and the player chooses every
       nine seconds whether to be standing there. Worth more than any
       other weak point in the game because it costs more to take. */
    ventral: { mult: 5.0, open: 0.5 },
  },

  /* ------------------------------------------------------------------
     THE STYLITE. A small, compact target that spends the fight ninety
     metres up, so almost everything here is about REACH rather than
     about where its parts are.

     No sub-targets and no designed weak point on the body, because the
     designed target is not on the animal at all - it is the GRIP, a
     pool worn down by any damage dealt while it is perched (see
     `ctx.stylite.wearGrip`, called from `applyDamage`). The reward for
     emptying it is that the boss falls off a needle and lies on the
     ground, and that window is where this table's one multiplier
     lives.
     ------------------------------------------------------------------ */
  stylite: {
    /* Cut to the shell. Its hind springs fold out to five metres when
       it jumps and a capsule sized to those would be a free hit on
       anything passing near a leaping animal. */
    r: 1.9, y0: -1.5, y1: 1.9, head: 0.4, headR: 0.85, headZ: 1.9,
    /* THE PAYOFF, and it is a melee multiplier rather than a ranged
       one on purpose. The player earns the window by shooting UP at a
       distant target; what the window is FOR is closing the distance
       and spending it at arm's length. Applied only while `grounded`,
       which the encounter sets for exactly the stunned and recovering
       phases. */
    groundedMeleeMult: 2.8,
  },

  /* The Apostate is the player's own silhouette made hostile. Its capsule is
     deliberately close to the trooper's visible plate instead of receiving a
     boss-sized invisible volume; the extra insect limbs are readable armour,
     not metres of free target around the body. */
  apostate: {
    r: 0.72, y0: 0.02, y1: 2.08, head: 1.75, headR: 0.34, headZ: 0.08,
    muzzle: 1.32, muzzleZ: 0.72,
  },
};

/* Bonus paid straight to the main pool when a leg breaks, as a
   fraction of maxHealth. A leg fight has to be real progress toward
   the kill or it reads as a side quest the boss ignores; too large
   and the legs alone kill it before the body is ever reachable. */
const LEG_BREAK_BONUS_FRACTION = 0.026;

const SPEC = {
  thresher: {
    hp: 60, damage: 14, reach: 2.6, cadence: 1.15,
    sight: 78, hearing: 26, aggro: 130,
  },
  precentor: {
    hp: 3200, damage: 54, reach: 6.2, cadence: 1.85,
    sight: 140, hearing: 55, aggro: 280,
  },
  cantor: {
    hp: 3000, damage: 16, reach: 58, cadence: 0.24, burst: 5, burstGap: 2.9,
    sight: 170, hearing: 55, aggro: 300,
  },
  gleaner: {
    /* Tougher than the machine it replaces and slower to shoot. It is
       the only ranged unit left in the game, so its cadence is what
       sets the pace of every firefight in the level - a garrison of
       these on a ridge has to be a reason to move, not a reason to
       hide behind one rock until they run dry. */
    hp: 150, damage: 11, reach: 52, cadence: 0.30, burst: 3, burstGap: 2.4,
    sight: 140, hearing: 40, aggro: 200,
  },
  harrow: {
    /* Seven Threshers' worth of health and two and a half times their
       damage, on a body that closes at 5.4m/s once it commits. It is
       meant to be the thing you spend a stratagem on. */
    hp: 420, damage: 34, reach: 4.4, cadence: 1.65,
    sight: 92, hearing: 34, aggro: 150,
  },
  matriarch: {
    /* Nine Harrows of health, and that number is a consequence
       rather than a choice: the fight is meant to last long enough
       for the brooding cycle below to matter, and the cycle is 14
       seconds. Anything under about 3000 died before it laid twice,
       which made the one mechanic that distinguishes it optional.

       The damage is a hit you survive exactly once. It reaches 7.4m
       with a scythe, so the range at which you are safe is further
       out than any other melee unit in the game by three metres -
       backing off from a Harrow works, backing off from this does
       not until you are most of a Thresher's charge away. */
    hp: 3600, damage: 58, reach: 7.4, cadence: 2.35,
    sight: 150, hearing: 60, aggro: 320,
    /* Boss-only. It plants and lays every `broodEvery` seconds while
       it can see the player, up to `broodCap` live children at once
       - the cap is what stops a long fight from turning the crater
       into a solid floor of Threshers. */
    broodEvery: 14, broodCount: 3, broodCap: 12,
  },
  /* The Coulter's numbers live in COULTER_CONFIG, in the module that
     owns its behaviour, because none of the four fields this table is
     built around describe it: its reach depends on which phase it is
     in, its cadence is two different attacks, and its sight is
     irrelevant to an animal that hunts by vibration through sand.
     What is left here is what the shared systems ask of every enemy. */
  coulter: {
    hp: 5200, damage: 56, reach: 28, cadence: 2.05,
    sight: 190, hearing: 220, aggro: 520,
  },
};

export function buildCombat(ctx) {
  const { THREE, enemies, collide, vfx } = ctx;
  const bus = makeBus();

  const player = {
    hp: SURVIVAL_CONFIG.playerMaxHp, maxHp: SURVIVAL_CONFIG.playerMaxHp,
    dead: false,
    respawnIn: 0,
    lastHitAt: -99,
    kills: 0,
    shots: 0,
    hits: 0,
  };

  const dir = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let clock = 0;
  /* A Cathedral-sized detour is intentionally a real search, but a
     garrison must not make every stalled unit run it in the same frame.
     One route request per simulation tick amortises a newly-alerted pack
     while every other creature keeps its cheap collision-slide pursuit. */
  let navigationBudget = 0;
  const hostileProjectiles = [];
  const projectileTotals = {
    launched: 0,
    contacts: 0,
    damagingHits: 0,
    intercepted: 0,
    misses: 0,
    coverStops: 0,
  };
  let projectileSerial = 0;
  const _playerCapsuleA = new THREE.Vector3();
  const _playerCapsuleB = new THREE.Vector3();

  /* Progression is constructed after combat, so every bridge resolves it
     lazily from `ctx`. These helpers keep the event vocabulary stable while
     leaving all doctrine rules in the progression service. */
  function enemyIdentity(inst) {
    return {
      enemyId: typeof inst?.id === "string" ? inst.id : "",
      enemyKey: typeof inst?.key === "string" ? inst.key : "unknown",
    };
  }

  function modifiedEnemyDamage(inst, requested, detail, before) {
    const identity = enemyIdentity(inst);
    const request = {
      ...identity,
      key: identity.enemyKey,
      damage: requested,
      requested,
      health: before,
      maxHealth: Math.max(before, Number(inst?.maxHealth) || before),
      source: detail.source || "unknown",
      head: !!detail.head,
      weak: !!detail.weak,
      x: Number.isFinite(detail.x) ? detail.x : inst.x,
      y: Number.isFinite(detail.y) ? detail.y : inst.y,
      z: Number.isFinite(detail.z) ? detail.z : inst.z,
      originX: Number.isFinite(detail.originX) ? detail.originX : null,
      originZ: Number.isFinite(detail.originZ) ? detail.originZ : null,
    };
    const result = ctx.progression?.modifyEnemyDamage?.(request);
    const resultDamage = Number(result?.damage);
    const candidate = Number.isFinite(result)
      ? result
      : Number.isFinite(resultDamage) ? resultDamage : requested;
    /* The Gilding Rite, applied LAST and to everything.
       Every caller of applyDamage is the player doing something - a
       shot, a swing, a stratagem, a glide - so a blessing on the bearer
       is correctly a multiplier on this one path rather than something
       each weapon has to remember. Kept outside the progression hook
       above so a doctrine that replaces damage outright cannot silently
       eat a command the player spent a cooldown on. */
    const boon = ctx.mission?.boon?.();
    const gilding = boon?.active ? Math.max(0, Number(boon.damage) || 1) : 1;
    let finalDamage = Math.max(0, candidate * gilding);
    /* Capability hook, resolved lazily because the encounter is built after
       combat. This is the one authoritative place for the mirrored Aegis:
       shots, melee, shockwaves and command explosions all pass through it. */
    if (inst?.key === "apostate" && ctx.apostate?.modifyIncomingDamage) {
      finalDamage = ctx.apostate.modifyIncomingDamage(inst, request, finalDamage);
    }
    return Math.max(0, Number(finalDamage) || 0);
  }

  /* ============================================================
     HITSCAN
     ============================================================ */

  /**
   * Where a creature's head is, in world space.
   *
   * `headZ` is measured along the creature's own forward axis, so it
   * has to be rotated by the instance's yaw. Skipping that rotation
   * would put a Harrow's head a metre north of it regardless of which
   * way the animal is facing, which is worse than no offset at all.
   */
  function headAt(inst, box, out) {
    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    const fz = box.headZ || 0;
    out.set(inst.x + s * fz, inst.y + box.head, inst.z + c * fz);
    return out;
  }

  const _head = new THREE.Vector3();
  const _weak = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();

  /** Ray-vs-sphere against the head volume. */
  function headHit(inst, box, ox, oy, oz, dx, dy, dz) {
    headAt(inst, box, _head);
    const mx = _head.x - ox;
    const my = _head.y - oy;
    const mz = _head.z - oz;
    const along = mx * dx + my * dy + mz * dz;
    if (along < 0) return false;
    const perpSq = (mx * mx + my * my + mz * mz) - along * along;
    return perpSq <= box.headR * box.headR;
  }

  /**
   * Distance to a creature's WEAK POINT along a ray, or -1.
   *
   * Returns `t` rather than a boolean, unlike the head test, and the
   * difference matters. A head sits inside the body capsule, so it
   * can be a modifier applied to a hit that already landed. The
   * Matriarch's gaster sits 3.3m BEHIND its capsule and well outside
   * it - test it as a modifier and the capsule rejects the ray before
   * anything looks at the weak point, so the one place on the boss
   * worth shooting would have been unhittable.
   */
  function weakHit(inst, box, ox, oy, oz, dx, dy, dz) {
    const w = box.weak;
    if (!w) return -1;
    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    _weak.set(inst.x + s * w.z, inst.y + w.y, inst.z + c * w.z);
    const mx = _weak.x - ox;
    const my = _weak.y - oy;
    const mz = _weak.z - oz;
    const along = mx * dx + my * dy + mz * dz;
    if (along < 0) return -1;
    const perpSq = (mx * mx + my * my + mz * mz) - along * along;
    if (perpSq > w.r * w.r) return -1;
    // Entry point, not centre distance: a 1.55m sphere shot edge-on
    // would otherwise resolve behind whatever is actually in front.
    return Math.max(0, along - Math.sqrt(Math.max(0, w.r * w.r - perpSq)));
  }

  /* ============================================================
     BODY CHAINS

     A burrower's hit volume cannot be a capsule, so it is a run of
     them: one per vertebra, laid along the same trail the body is. The
     maths below is the standard closest-approach between a ray and a
     segment, and it is worth the twenty lines because every cheaper
     approximation fails in a way the player feels - a single capsule
     from head to tail is a fence across the arena, and one sphere per
     joint leaves gaps a bolt slips between at range.
     ============================================================ */

  const _bodyA = new THREE.Vector3();
  const _bodyB = new THREE.Vector3();
  const _bodyNear = new THREE.Vector3();

  /** Radius of the body at joint `i`, from the species' taper. */
  const jointRadius = (box, i) => {
    const p = box.profile;
    if (!p || !p.length) return box.r || 1;
    return p[Math.min(p.length - 1, Math.max(0, i))];
  };

  const bodyHitScale = (inst) => Math.max(0.25,
    Number(inst?.spec?.bodyHitScale) || 1);

  /**
   * Closest approach between a ray and one body segment.
   *
   * Returns the ray parameter where it enters the segment's capsule, or
   * -1. The entry is taken as the closest-approach point pulled back by
   * the chord through the capsule, which is exact for a sphere and
   * within a few centimetres for a cylinder at any angle a shot at a
   * 2.7m-thick animal actually arrives from.
   */
  function segmentHit(ox, oy, oz, dx, dy, dz, a, b, radius) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const wx = ox - a.x;
    const wy = oy - a.y;
    const wz = oz - a.z;
    const B = dx * ux + dy * uy + dz * uz;
    const C = ux * ux + uy * uy + uz * uz;
    const D = dx * wx + dy * wy + dz * wz;
    const E = ux * wx + uy * wy + uz * wz;
    const denom = C - B * B;
    let t = denom > 1e-8 ? (B * E - C * D) / denom : -D;
    let s = C > 1e-8 ? clamp((B * t + E) / C, 0, 1) : 0;
    // One re-projection after clamping the segment parameter, which is
    // what makes the ends of each capsule round instead of chopped.
    t = Math.max(0, (a.x + ux * s - ox) * dx + (a.y + uy * s - oy) * dy
      + (a.z + uz * s - oz) * dz);
    const px = ox + dx * t - (a.x + ux * s);
    const py = oy + dy * t - (a.y + uy * s);
    const pz = oz + dz * t - (a.z + uz * s);
    const distSq = px * px + py * py + pz * pz;
    if (distSq > radius * radius) return -1;
    return Math.max(0, t - Math.sqrt(Math.max(0, radius * radius - distSq)));
  }

  /** Where the open maw is, in world space, or null if it is shut. */
  function mawAt(inst, box, out) {
    const maw = box.maw;
    const body = inst.body;
    if (!maw || !body) return null;
    if ((body.mawOpen || 0) < maw.open) return null;
    out.copy(body.head).addScaledVector(body.dir, maw.forward * bodyHitScale(inst));
    return out;
  }

  /** Ray against a chained body: nearest vertebra, or the open maw. */
  function bodyHit(inst, box, ox, oy, oz, dx, dy, dz, maxT) {
    const body = inst.body;
    if (!body) return null;
    let bestT = maxT;
    let weak = false;
    let found = false;

    if (mawAt(inst, box, _weak)) {
      const mx = _weak.x - ox;
      const my = _weak.y - oy;
      const mz = _weak.z - oz;
      const along = mx * dx + my * dy + mz * dz;
      const perpSq = (mx * mx + my * my + mz * mz) - along * along;
      const r = box.maw.r * bodyHitScale(inst);
      if (along > 0 && perpSq <= r * r) {
        const entry = Math.max(0, along - Math.sqrt(Math.max(0, r * r - perpSq)));
        if (entry <= bestT) { bestT = entry; weak = true; found = true; }
      }
    }

    _bodyA.copy(body.head);
    for (let i = 0; i < body.joints.length; i += 1) {
      _bodyB.copy(body.joints[i]);
      const radius = (jointRadius(box, i) + jointRadius(box, i + 1)) * 0.5
        * bodyHitScale(inst);
      const t = segmentHit(ox, oy, oz, dx, dy, dz, _bodyA, _bodyB, radius);
      if (t >= 0 && t < bestT) { bestT = t; weak = false; found = true; }
      _bodyA.copy(_bodyB);
    }
    if (!found) return null;
    return { t: bestT, weak };
  }

  /* ============================================================
     LEG WALKERS WITH A DESIGNED TARGET PER LEG

     The Coulter's body chain is one animal with vertebrae; this is a
     different shape entirely - a small standing mass with eight
     independent limbs under it, each carrying its own health and
     its own live world position off the same bones the IK solver
     already reads. Nothing here duplicates that solver: it is called
     AFTER `enemies.js` has posed the frame, so every position taken
     below is exactly what is on screen.
     ============================================================ */

  const _legA = new THREE.Vector3();
  const _legB = new THREE.Vector3();
  const _legC = new THREE.Vector3();
  const _legD = new THREE.Vector3();
  const _bodyLive = new THREE.Vector3();

  const _bodyLive2 = new THREE.Vector3();

  /** Read all four live joints of one limb from the rendered scene.
   *
   * A LIMB IS FOUR NODES, root to tip, and deliberately nothing more
   * specific than that. Two species satisfy this contract from
   * completely different rigs: the Distaff's eight legs name their
   * skeleton bones (coxa/femur/tibia/foot), and the Garner's six
   * tentacles hand over a `chain` of four plain Object3Ds their own
   * module re-places along a spline every frame. Everything below -
   * three capsules and a tip sphere, the melee reach gate, the per-limb
   * pool - is the same question in both cases, so it is asked once.
   *
   * `leg.foot` on the walkers is the IK's requested plant point. It
   * matches the rendered foot while IK owns the pose, but deliberately
   * stops updating while authored collapse/recover clips own the bones.
   * A hitbox built to that target therefore stayed standing while the
   * visible lower legs folded several metres away. The foot BONE is
   * authoritative in every phase because it is what skins the mesh. */
  function limbSpan(leg, outA, outB, outC, outD) {
    const chain = leg?.chain
      || (leg?.coxa && leg.femur && leg.tibia && leg.toe
        ? [leg.coxa, leg.femur, leg.tibia, leg.toe] : null);
    if (!chain) return false;
    const outs = [outA, outB, outC, outD];
    for (let i = 0; i < 4; i += 1) {
      const node = chain[i];
      if (!node) return false;
      node.updateWorldMatrix(true, false);
      outs[i].setFromMatrixPosition(node.matrixWorld);
    }
    return true;
  }

  /** The body capsule's two live endpoints, read off the bones the
   *  HITBOX entry names. True in every phase by construction: the
   *  bones ride the same root the collapse sinks, so "where the body
   *  is" and "where the body can be shot" cannot drift apart the way
   *  a fixed offset let them. Returns false if the rig is not up yet. */
  function distaffBodySpan(inst, box, outA, outB) {
    const names = box.bodyBones;
    if (!names) return false;
    const a = inst.bones?.get?.(names[0]);
    const b = inst.bones?.get?.(names[1]);
    if (!a || !b) return false;
    a.updateWorldMatrix(true, false);
    b.updateWorldMatrix(true, false);
    outA.setFromMatrixPosition(a.matrixWorld);
    outB.setFromMatrixPosition(b.matrixWorld);
    return true;
  }

  /**
   * Ray against every leg, then the body.
   *
   * Three segments per leg - body attach to hip, hip to knee, knee to
   * foot - so the WHOLE limb is hittable: the coxa stretch nearest
   * the body went untested for one build, and what looked like
   * coverage in a probe was rays luckily crossing other legs. The
   * body capsule is tested in every phase (plain damage standing,
   * weak while collapsed). Returns the NEAREST thing the ray actually
   * crosses, with `legIndex` set for a leg (`-1` for the body).
   */
  function legAndBodyHit(inst, box, ox, oy, oz, dx, dy, dz, maxT) {
    let bestT = maxT;
    let legIndex = -1;
    let weak = false;
    let found = false;
    const r = box.legRadius || 0.6;
    for (let i = 0; i < (inst.legs?.length || 0); i += 1) {
      if (inst.legBroken?.[i]) continue;
      const leg = inst.legs[i];
      if (!limbSpan(leg, _legC, _legA, _legB, _legD)) continue;
      const tCoxa = segmentHit(ox, oy, oz, dx, dy, dz, _legC, _legA, r * 1.25);
      if (tCoxa >= 0 && tCoxa < bestT) {
        bestT = tCoxa; legIndex = i; weak = false; found = true;
      }
      const tUpper = segmentHit(ox, oy, oz, dx, dy, dz, _legA, _legB, r * 1.15);
      if (tUpper >= 0 && tUpper < bestT) {
        bestT = tUpper; legIndex = i; weak = false; found = true;
      }
      const tLower = segmentHit(ox, oy, oz, dx, dy, dz, _legB, _legD, r);
      if (tLower >= 0 && tLower < bestT) {
        bestT = tLower; legIndex = i; weak = false; found = true;
      }
      const tFoot = sphereEntry(_legD.x, _legD.y, _legD.z,
        box.footRadius || r, ox, oy, oz, dx, dy, dz);
      if (tFoot >= 0 && tFoot < bestT) {
        bestT = tFoot; legIndex = i; weak = false; found = true;
      }
    }
    if (distaffBodySpan(inst, box, _bodyLive, _bodyLive2)) {
      const tBody = segmentHit(ox, oy, oz, dx, dy, dz, _bodyLive, _bodyLive2,
        box.bodyRadius || 3);
      if (tBody >= 0 && tBody < bestT) {
        bestT = tBody; legIndex = -1; weak = !!inst.collapsed; found = true;
      }
    }
    if (!found) return null;
    return { t: bestT, legIndex, weak };
  }

  /* ============================================================
     QUEENS

     A thorax capsule that resists, and a live segmented sac behind it
     that does not. The sac's geometry is published by the encounter
     every frame (`inst.sacSpine` / `inst.sacRadius`), so this walks the
     actual pose - including the nine metres of arc it makes at the top
     of a slam.

     The ventral weak point is not a separate primitive. It is the SAME
     capsules, scored differently: while the abdomen is raised past the
     aperture, a ray that arrives from below the segment it hits has
     found the underside. Testing direction rather than adding a sphere
     is what keeps it honest - there is no invisible bonus volume to
     find, only the actual belly of the thing, actually exposed.
     ============================================================ */
  function queenHit(inst, box, ox, oy, oz, dx, dy, dz, maxT) {
    let bestT = maxT;
    let weak = false;
    let thorax = false;
    let found = false;

    /* THE THORAX, as a ray-vs-cylinder ENTRY distance rather than a
       closest-approach one - and the distinction is not academic here.

       Projecting the capsule's centre onto the ray, which is what the
       walkers' own body test does, answers "how far along the ray is
       the point nearest the middle of the target". On an isolated
       creature that is close enough to the entry point to sort
       correctly against everything else. On this one it is not: the
       thorax reported ~26m for a shot fired from 26m away, the sac
       segment behind it reported its true entry at ~22m, and the sac
       therefore won EVERY comparison. Shooting her in the face scored
       the abdomen, at full damage instead of armoured - and while she
       was mid-slam it scored the ventral weak point, so her most
       protected surface was also her softest. */
    {
      const a = dx * dx + dz * dz;
      const rx = ox - inst.x;
      const rz = oz - inst.z;
      const b = 2 * (rx * dx + rz * dz);
      const cc = rx * rx + rz * rz - box.r * box.r;
      const disc = b * b - 4 * a * cc;
      if (a > 1e-9 && disc >= 0) {
        const root = Math.sqrt(disc);
        // The near root, floored at zero for an origin already inside.
        const t = Math.max(0, (-b - root) / (2 * a));
        const py = oy + dy * t;
        if (t <= bestT && py >= inst.y + box.y0 && py <= inst.y + box.y1) {
          bestT = t; thorax = true; found = true;
        }
      }
    }

    const spine = inst.sacSpine;
    const radii = inst.sacRadius;
    if (Array.isArray(spine) && spine.length > 1 && radii) {
      const open = (inst.raised || 0) >= (box.ventral?.open ?? 0.5);
      /* FROM THE SECOND SEGMENT. The sac's first ring is tucked inside
         the collar plate, and it is fatter than the thorax capsule that
         covers the same volume - so a shot at her FACE reached the sac
         first, scored it as body, and while she was mid-slam scored it
         as the ventral weak point. Her front is armour; the part of the
         abdomen that is underneath the armour has to be armour too. */
      for (let i = 1; i < spine.length - 1; i += 1) {
        const r = Math.max(radii[i], radii[i + 1]);
        const st = segmentHit(ox, oy, oz, dx, dy, dz, spine[i], spine[i + 1], r);
        if (st < 0 || st >= bestT) continue;
        bestT = st;
        thorax = false;
        found = true;
        /* Underneath, and only while it is up. The hit point's height
           against the segment's own centreline is the test: a shot that
           lands on the top of a raised abdomen is an ordinary body hit,
           and one that lands under it is the belly. */
        const hy = oy + dy * st;
        const mid = (spine[i].y + spine[i + 1].y) * 0.5;
        weak = open && hy < mid;
      }
    }
    if (!found) return null;
    return { t: bestT, weak, thorax };
  }

  /* ============================================================
     FLYERS

     A body capsule with two live sacs on it and a gut that only
     counts while the animal is grounded. All three are placed in the
     creature's own (yaw, forward, up) frame off an origin that
     happens to be in the air, so nothing here needs to know how high
     it is - which is the whole reason `y0`/`y1` were always relative.
     ============================================================ */

  const _sac = new THREE.Vector3();
  const _tail = new THREE.Vector3();

  /** Place an offset in the creature's own frame. */
  function localAt(inst, ox, oy, oz, out) {
    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    return out.set(
      inst.x + c * ox + s * oz,
      inst.y + oy,
      inst.z - s * ox + c * oz
    );
  }

  /** Ray-vs-sphere returning the ENTRY distance, or -1. */
  function sphereEntry(px, py, pz, r, ox, oy, oz, dx, dy, dz) {
    const mx = px - ox;
    const my = py - oy;
    const mz = pz - oz;
    const along = mx * dx + my * dy + mz * dz;
    if (along < 0) return -1;
    const perpSq = (mx * mx + my * my + mz * mz) - along * along;
    if (perpSq > r * r) return -1;
    return Math.max(0, along - Math.sqrt(Math.max(0, r * r - perpSq)));
  }

  /**
   * Ray against a flyer: body capsule, heat sacs, and the grounded
   * gut. Returns the nearest, with `sacIndex` set when a sac was hit
   * so the caller can drain the lift pool instead of only dealing
   * damage - see `winnower.js`.
   */
  function flyerHit(inst, box, ox, oy, oz, dx, dy, dz, maxT) {
    let bestT = maxT;
    let sacIndex = -1;
    let weak = false;
    let found = false;

    // Body capsule, vertical about the creature's own origin.
    const cx = inst.x - ox;
    const cy = inst.y + (box.y0 + box.y1) * 0.5 - oy;
    const cz = inst.z - oz;
    const t = cx * dx + cy * dy + cz * dz;
    if (t >= 0 && t <= bestT) {
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const hd = Math.hypot(px - inst.x, pz - inst.z);
      if (hd <= box.r && py >= inst.y + box.y0 && py <= inst.y + box.y1) {
        bestT = t; found = true;
      }
    }

    if (box.sacs) {
      for (let i = 0; i < box.sacs.offsets.length; i += 1) {
        if (inst.sacBurst?.[i]) continue;
        /* READ OFF THE LIVE BONE, falling back to the authored offset.
           The sacs hang on the thorax, which every clip rotates - so a
           fixed offset in the creature's own frame drifts away from
           the geometry the player is actually aiming at as soon as the
           animal does anything, and measured over a metre out during
           the stoke. This is the Coulter's `mawFromClip` rule applied
           to a hit volume rather than a multiplier: what counts as the
           target is taken from where the target IS. */
        const bone = inst.bones?.get?.(box.sacs.bones?.[i]);
        if (bone) {
          bone.updateWorldMatrix(true, false);
          _sac.setFromMatrixPosition(bone.matrixWorld);
        } else {
          const o = box.sacs.offsets[i];
          localAt(inst, o[0], o[1], o[2], _sac);
        }
        const entry = sphereEntry(_sac.x, _sac.y, _sac.z, box.sacs.r,
          ox, oy, oz, dx, dy, dz);
        if (entry >= 0 && entry < bestT) {
          bestT = entry; sacIndex = i; weak = false; found = true;
        }
      }
    }

    // The gaster: a fore-aft capsule behind the body. Plain damage -
    // the lit abdomen is an honest target, not a weak point.
    if (box.tail) {
      const ta = box.tail.a;
      const tb = box.tail.b;
      localAt(inst, ta[0], ta[1], ta[2], _sac);
      _tail.copy(_sac);
      localAt(inst, tb[0], tb[1], tb[2], _sac);
      const tTail = segmentHit(ox, oy, oz, dx, dy, dz, _tail, _sac, box.tail.r);
      if (tTail >= 0 && tTail < bestT) {
        bestT = tTail; sacIndex = -1; weak = false; found = true;
      }
    }

    // The gut, and only once it is on the ground. Read off the live
    // "heart" bone for the same reason the sacs are.
    if (box.heart && inst.grounded) {
      const hb = inst.bones?.get?.("heart");
      if (hb) {
        hb.updateWorldMatrix(true, false);
        _sac.setFromMatrixPosition(hb.matrixWorld);
      } else {
        localAt(inst, 0, box.heart.y, box.heart.z, _sac);
      }
      const entry = sphereEntry(_sac.x, _sac.y, _sac.z, box.heart.r,
        ox, oy, oz, dx, dy, dz);
      if (entry >= 0 && entry < bestT) {
        bestT = entry; sacIndex = -1; weak = true; found = true;
      }
    }
    if (!found) return null;
    return { t: bestT, sacIndex, weak };
  }

  /**
   * The nearest MELEE-reachable point on a leg walker, and which leg
   * (or the body) it belongs to. The horizontal-only distance test
   * every other melee target uses is unchanged - see `meleeStrike` -
   * this only replaces WHERE that distance is measured to.
   */
  /** Nearest point on the xz-projection of segment ab to (x, z),
   *  written to `out` as the full 3D point at that parameter. Returns
   *  the horizontal distance. */
  function nearestOnSegmentXZ(ax, ay, az, bx, by, bz, x, z, out) {
    const ex = bx - ax;
    const ez = bz - az;
    const lenSq = ex * ex + ez * ez;
    const t = lenSq < 1e-8 ? 0
      : clamp(((x - ax) * ex + (z - az) * ez) / lenSq, 0, 1);
    out.set(ax + ex * t, ay + (by - ay) * t, az + ez * t);
    return Math.hypot(out.x - x, out.z - z);
  }

  const _legCand = new THREE.Vector3();
  const _legClipA = new THREE.Vector3();
  const _legClipB = new THREE.Vector3();

  /** Clip a segment to the portion no higher than `maxY`.
   *
   * Melee used to find the horizontally-nearest point first and then
   * reject it when that one point was too high. On a sloped shin this
   * discarded the entire limb even when its lower half was beside the
   * player. Clipping first makes every physically reachable portion a
   * candidate without granting swings against the overhead coxa. */
  function clipSegmentBelowY(a, b, maxY, outA, outB) {
    if (a.y > maxY && b.y > maxY) return false;
    outA.copy(a);
    outB.copy(b);
    if (a.y > maxY) {
      const t = (maxY - a.y) / (b.y - a.y);
      outA.lerpVectors(a, b, clamp(t, 0, 1));
    } else if (b.y > maxY) {
      const t = (maxY - a.y) / (b.y - a.y);
      outB.lerpVectors(a, b, clamp(t, 0, 1));
    }
    return true;
  }

  function nearestLegPoint(inst, box, x, z, py, out) {
    let best = Infinity;
    let bestSurface = Infinity;
    let bestRadius = box.legRadius || 0.6;
    let legIndex = -1;
    /* Swings land where a swing can physically go. Point-based
       targeting (knee and foot only) shipped for one build and made
       melee on the legs a coin toss: a player square against a shin
       was often out of reach of BOTH points while the limb itself
       crossed their swing. Every segment is tested now and clipped at
       `meleeReachY`, so the reachable band is exactly the part of the
       leg a person could actually strike. */
    const reachY = py + (box.meleeReachY || 3.6);
    const r = box.legRadius || 0.6;
    for (let i = 0; i < (inst.legs?.length || 0); i += 1) {
      if (inst.legBroken?.[i]) continue;
      const leg = inst.legs[i];
      if (!limbSpan(leg, _legC, _legA, _legB, _legD)) continue;
      const segs = [
        [_legC, _legA, r * 1.25],
        [_legA, _legB, r * 1.15],
        [_legB, _legD, r],
      ];
      for (const s of segs) {
        if (!clipSegmentBelowY(s[0], s[1], reachY, _legClipA, _legClipB)) continue;
        const d = nearestOnSegmentXZ(
          _legClipA.x, _legClipA.y, _legClipA.z,
          _legClipB.x, _legClipB.y, _legClipB.z, x, z, _legCand);
        const surface = d - s[2];
        if (surface < bestSurface) {
          best = d; bestSurface = surface; bestRadius = s[2];
          legIndex = i; out.copy(_legCand);
        }
      }
      const footRadius = box.footRadius || r;
      const footDist = Math.hypot(_legD.x - x, _legD.z - z);
      const footSurface = footDist - footRadius;
      if (_legD.y <= reachY && footSurface < bestSurface) {
        best = footDist; bestSurface = footSurface; bestRadius = footRadius;
        legIndex = i; out.copy(_legD);
      }
    }
    /* The body joins the candidate list only while collapsed - same
       height honesty: standing, it is nine metres up and no swing
       reaches it; collapsed, the capsule is genuinely down where the
       reach gate passes it. */
    if (inst.collapsed && distaffBodySpan(inst, box, _bodyLive, _bodyLive2)) {
      const bodyRadius = box.bodyRadius || 3;
      if (clipSegmentBelowY(_bodyLive, _bodyLive2, reachY + 1.6,
        _legClipA, _legClipB)) {
        const d = nearestOnSegmentXZ(
          _legClipA.x, _legClipA.y, _legClipA.z,
          _legClipB.x, _legClipB.y, _legClipB.z, x, z, _legCand);
        const surface = d - bodyRadius;
        if (surface < bestSurface) {
          best = d; bestSurface = surface; bestRadius = bodyRadius;
          legIndex = -1; out.copy(_legCand);
        }
      }
    }
    return { dist: best, legIndex, radius: bestRadius };
  }

  /**
   * Damage to ONE leg's own pool - entirely separate from
   * `applyDamage`'s single `inst.health`, so a leg fight is real
   * progress without being a second way to kill the animal outright.
   * Breaking a leg pays a fixed bonus straight to the main pool (see
   * `LEG_BREAK_BONUS_FRACTION`) and reports it through the same
   * `applyDamage` path so the kill feed, HUD numbers and progression
   * all see one consistent chunk of damage rather than a silent one.
   */
  function damageLeg(inst, legIndex, dmg, detail = {}) {
    if (!inst || untouchable(inst)) return 0;
    if (!Array.isArray(inst.legHp) || legIndex < 0 || legIndex >= inst.legHp.length) return 0;
    if (inst.legBroken?.[legIndex]) return 0;
    const requested = Math.max(0, Number(dmg) || 0);
    const before = Math.max(0, Number(inst.legHp[legIndex]) || 0);
    const actual = Math.min(before, requested);
    if (actual <= 0) return 0;
    inst.legHp[legIndex] = Math.max(0, before - requested);
    inst.alerted = true;
    inst.suspicion = 1;
    const broke = inst.legHp[legIndex] <= 0;
    if (broke) {
      inst.legBroken[legIndex] = true;
      inst.legsBroken = (inst.legsBroken || 0) + 1;
      const bonus = Math.round((inst.maxHealth || 0) * LEG_BREAK_BONUS_FRACTION);
      if (bonus > 0) {
        applyDamage(inst, bonus, {
          source: "leg-break", x: detail.x, y: detail.y, z: detail.z,
        });
      }
    }
    const identity = enemyIdentity(inst);
    bus.emit("legHit", {
      ...identity,
      key: identity.enemyKey,
      legIndex,
      damage: actual,
      legHp: inst.legHp[legIndex],
      broke,
      legsBroken: inst.legsBroken || 0,
      x: Number.isFinite(detail.x) ? detail.x : inst.x,
      y: Number.isFinite(detail.y) ? detail.y : inst.y,
      z: Number.isFinite(detail.z) ? detail.z : inst.z,
    });
    return actual;
  }

  /**
   * Drain a flyer's lift pool.
   *
   * Deliberately NOT health: this is the resource that keeps the
   * animal in the air, and emptying it is what forces the landing the
   * whole encounter is built around. The pool itself lives on the
   * instance so a save can carry it, and the creature's own module
   * (`winnower.js`) decides what running dry means - this function
   * only ever reports that it happened.
   */
  function drainLift(inst, amount, sacIndex = -1, detail = {}) {
    if (!inst || untouchable(inst)) return 0;
    if (!Number.isFinite(inst.lift)) return 0;
    const before = Math.max(0, inst.lift);
    const drained = Math.min(before, Math.max(0, Number(amount) || 0));
    if (drained <= 0) return 0;
    inst.lift = before - drained;
    inst.alerted = true;
    inst.suspicion = 1;
    /* A sac BURSTS at a quarter of the pool each. Tracking which ones
       have gone is what lets the model stop drawing them and the ray
       test stop offering them - a sac that is visibly blown open but
       still shootable is the kind of thing a player reads as the hit
       box lying to them. */
    let burst = false;
    if (sacIndex >= 0 && Array.isArray(inst.sacBurst) && !inst.sacBurst[sacIndex]) {
      const perSac = (inst.maxLift || 1) / inst.sacBurst.length;
      if (before - drained <= (inst.maxLift || 1) - perSac * (sacIndex + 1) + 1e-6) {
        inst.sacBurst[sacIndex] = true;
        burst = true;
      }
    }
    const identity = enemyIdentity(inst);
    bus.emit("liftDrained", {
      ...identity,
      key: identity.enemyKey,
      sacIndex,
      drained,
      lift: inst.lift,
      maxLift: inst.maxLift || 0,
      burst,
      grounded: !!inst.grounded,
      x: Number.isFinite(detail.x) ? detail.x : inst.x,
      y: Number.isFinite(detail.y) ? detail.y : inst.y,
      z: Number.isFinite(detail.z) ? detail.z : inst.z,
    });
    return drained;
  }

  /** The nearest point on a creature to a world position, and how far.
   *  A point test against a 25m animal's origin is a test against its
   *  mouth, which would let a stratagem land on its back for nothing. */
  function nearestBodyPoint(inst, x, z, out) {
    const body = inst.body;
    /* A published sac is the same question as a body chain and gets the
       same answer: the nearest of its live segments. Without this every
       melee swing, explosion and shockwave measures a twenty-metre
       queen from her thorax, so a player standing against the middle of
       her abdomen is told they are eleven metres away from her. */
    const spine = inst.sacSpine;
    if (!body && Array.isArray(spine) && spine.length) {
      let near = Math.hypot(inst.x - x, inst.z - z);
      out.set(inst.x, inst.y, inst.z);
      for (const p of spine) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < near) { near = d; out.copy(p); }
      }
      return near;
    }
    if (!body) {
      out.set(inst.x, inst.y, inst.z);
      return Math.hypot(inst.x - x, inst.z - z);
    }
    let best = Infinity;
    out.copy(body.head);
    const consider = (p) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best) { best = d; out.copy(p); }
    };
    consider(body.head);
    for (const joint of body.joints) consider(joint);
    return best;
  }

  /** Not physically available to the player. Every damage path in
   *  this file asks, because a boss hidden below the sand or held
   *  behind an encounter reveal is not protected if only hitscan
   *  remembers the rule and stratagems/melee do not. */
  const untouchable = (inst) => inst.state === "death"
    || !!inst.emerging?.active || !!inst.body?.hidden
    || !!inst.encounterHidden || !!inst.encounterLocked;

  /**
   * Closest enemy hit by a ray, or null.
   *
   * Tests a capsule per enemy: the perpendicular distance from the
   * enemy's vertical axis to the ray, plus a separate, tighter test
   * at head height. Ray-vs-sphere per body part would be more
   * correct and would also mean five tests per enemy per shot; a
   * capsule is what the silhouette actually looks like.
   */
  function raycastEnemies(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const inst of enemies.live) {
      if (untouchable(inst)) continue;
      const box = HITBOX[inst.key] || HITBOX.thresher;

      /* A chained body takes the other path entirely: there is no
         centre to project and no head sphere to modify, only vertebrae
         and a mouth that is sometimes open. */
      if (box.segments) {
        const seg = bodyHit(inst, box, ox, oy, oz, dx, dy, dz, bestT);
        if (!seg) continue;
        best = {
          inst, t: seg.t, weak: seg.weak, head: false,
          x: ox + dx * seg.t, y: oy + dy * seg.t, z: oz + dz * seg.t,
        };
        bestT = seg.t;
        continue;
      }

      // A queen: an armoured thorax and a live egg sac behind it that
      // is only soft while she is holding it up - see queenHit.
      if (box.sac) {
        const qh = queenHit(inst, box, ox, oy, oz, dx, dy, dz, bestT);
        if (!qh) continue;
        best = {
          inst, t: qh.t, weak: qh.weak, head: false, thorax: qh.thorax,
          x: ox + dx * qh.t, y: oy + dy * qh.t, z: oz + dz * qh.t,
        };
        bestT = qh.t;
        continue;
      }

      // A flyer: body capsule plus live sacs, and a gut that only
      // exists once it is down - see flyerHit.
      if (box.sacs) {
        const fh = flyerHit(inst, box, ox, oy, oz, dx, dy, dz, bestT);
        if (!fh) continue;
        best = {
          inst, t: fh.t, weak: fh.weak, head: false, sacIndex: fh.sacIndex,
          x: ox + dx * fh.t, y: oy + dy * fh.t, z: oz + dz * fh.t,
        };
        bestT = fh.t;
        continue;
      }

      // A leg walker: eight independent targets and, once collapsed,
      // a ninth. No capsule, no head - see legAndBodyHit.
      if (box.legs) {
        const lb = legAndBodyHit(inst, box, ox, oy, oz, dx, dy, dz, bestT);
        if (!lb) continue;
        best = {
          inst, t: lb.t, weak: lb.weak, head: false, legIndex: lb.legIndex,
          x: ox + dx * lb.t, y: oy + dy * lb.t, z: oz + dz * lb.t,
        };
        bestT = lb.t;
        continue;
      }

      // Project the enemy's centre onto the ray.
      const cx = inst.x - ox;
      const cy = inst.y + (box.y0 + box.y1) * 0.5 - oy;
      const cz = inst.z - oz;
      const t = cx * dx + cy * dy + cz * dz;
      if (t < 0 || t > bestT) continue;

      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      // Horizontal miss distance against the body cylinder...
      const hd = Math.hypot(px - inst.x, pz - inst.z);
      const lo = inst.y + box.y0;
      const hi = inst.y + box.y1;
      const onBody = hd <= box.r && py >= lo && py <= hi;

      /* ...and the weak point, which is a SEPARATE primitive rather
         than a modifier, and is therefore tested even when the body
         capsule missed. `continue`-ing on a capsule miss first would
         make the Matriarch's gaster - 3.3m behind its capsule and
         outside it - impossible to hit. */
      const wt = weakHit(inst, box, ox, oy, oz, dx, dy, dz);
      const hitsWeak = wt >= 0 && wt <= bestT && (!onBody || wt < t);
      if (!onBody && !hitsWeak) continue;

      const useT = hitsWeak ? wt : t;
      if (useT > bestT) continue;

      // Head or body is only a damage multiplier. The head is a
      // SPHERE placed in the creature's own frame - forward of the
      // body axis by `headZ`, rotated by its yaw - so it lands on the
      // face of an animal that carries its head out in front.
      best = {
        inst, t: useT, weak: hitsWeak,
        head: !hitsWeak && headHit(inst, box, ox, oy, oz, dx, dy, dz),
        x: ox + dx * useT, y: oy + dy * useT, z: oz + dz * useT,
      };
      bestT = useT;
    }
    return best;
  }

  /** Fire one shot from an origin along a direction. */
  function fire(origin, direction, opts = {}) {
    const damage = opts.damage ?? 22;
    const range = opts.range ?? 320;
    player.shots += 1;

    dir.copy(direction).normalize();
    /* Live Fuse rides the authoritative accepted hitscan path. It never
       consumes the round: this opt-in command target is checked first, then
       the same ray continues through ordinary enemy and masonry resolution. */
    const commandHit = ctx.mission?.tryHitCommandBeacon?.(origin, dir, {
      precision: opts.precision !== false,
    });
    // Masonry first. A shot that reaches through a wall is the bug
    // that makes cover meaningless, and cover is most of what makes
    // a firefight a firefight.
    const wall = collide.rayBlock(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range
    );
    const hit = raycastEnemies(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, Math.min(range, wall)
    );
    /* THE ABBESS'S EGGS, which are not enemies.
       They have no rig, no brain and no place in `enemies.live`, so
       `raycastEnemies` cannot see them - but they are the one thing in
       her fight the player most needs to be able to shoot. The
       encounter publishes a sphere test instead, and every damage path
       in this file that can reach the ground calls it. Resolved along
       the shot's accepted length so a round cannot pass through a wall
       and still burst a clutch behind it. */
    const eggReach = hit ? hit.t : Math.min(range, wall);
    if (ctx.abbess?.hitEggs) {
      /* Marched rather than sphere-tested at a point: a clutch is small
         and a rifle round is long, so the only honest way to ask "did
         this shot cross an egg" is to walk the accepted length of it. */
      const step = 1.4;
      for (let m = 0; m <= eggReach; m += step) {
        if (ctx.abbess.hitEggs(origin.x + dir.x * m, origin.y + dir.y * m,
          origin.z + dir.z * m, 1.6, damage)) break;
      }
    }

    /* The bolt is drawn to WHERE THE RAY STOPPED, which is why this
       is worked out here rather than at the call site: only this
       function knows whether the shot ended on a creature, on masonry
       or at maximum range. A tracer launched at a fixed length
       instead sails on through whatever it just killed. */
    const reach = hit ? hit.t : Math.min(range, wall);
    if (vfx && vfx.tracer) {
      vfx.tracer(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        reach, opts.tracerWidth, true);
    }

    if (hit) {
      player.hits += 1;
      /* The weak-point multiplier is per creature, not global. A
         headshot bonus can be one number because every head in the
         bestiary is roughly the same fraction of its animal; a weak
         point is a designed target on one boss, and how much it is
         worth is part of that boss's design. */
      const box = HITBOX[hit.inst.key] || HITBOX.thresher;
      // Two kinds of designed target now: a fixed one on the body (the
      // Matriarch's gaster) and a transient one (the Coulter's open
      // maw). Both carry their own worth next to their own geometry.
      const weakMult = hit.weak
        ? ((box.weak && box.weak.mult) || (box.maw && box.maw.mult)
          || (box.heart && box.heart.mult) || (box.ventral && box.ventral.mult) || 3)
        : 1;
      /* Armour, as a discount. A queen's thorax is the part facing the
         door and the part that resists; the player has to see bad
         numbers there rather than none, or a wrong target reads as a
         broken hit volume. */
      const thoraxMult = hit.thorax ? (box.thoraxMult || 1) : 1;
      /* A heat sac is worth its own modest multiplier - the reward for
         hitting one is the LIFT it drains, resolved below, not the
         damage. Paying out a weak-point multiplier here as well would
         make shooting the sacs the whole fight. */
      const sacMult = hit.sacIndex >= 0 ? (box.sacs?.mult || 1) : 1;
      const dmg = damage * (hit.head ? 2.6 : 1) * weakMult * sacMult * thoraxMult;
      /* A leg hit never reaches `applyDamage` at all - it has its own
         pool, and `legIndex >= 0` is how every damage path in this
         file already tells "one of the eight" from "the body once it
         is collapsed", so the same branch works for a shot as it will
         for a swing below. */
      // A sac hit still damages the animal normally; what makes it
      // worth aiming at is the lift it drains on the way through.
      if (hit.sacIndex >= 0 && box.sacs) {
        drainLift(hit.inst, box.sacs.lift || 1, hit.sacIndex,
          { x: hit.x, y: hit.y, z: hit.z });
      }
      const dealt = hit.legIndex >= 0
        ? damageLeg(hit.inst, hit.legIndex, dmg, { x: hit.x, y: hit.y, z: hit.z })
        // `head` means headshot, and only that. A weak-point hit rides
        // in the event below instead of being folded in here, so that
        // anything reading the kill feed can tell the two apart.
        : applyDamage(hit.inst, dmg, {
          source: "shot",
          head: hit.head,
          weak: !!hit.weak,
          x: hit.x,
          y: hit.y,
          z: hit.z,
          originX: origin.x,
          originZ: origin.z,
        });
      if (vfx && vfx.spark) {
        vfx.spark(hit.x, hit.y, hit.z,
          hit.weak ? 2.6 : (hit.head ? 1.9 : 1.2), false, true);
      }
      const identity = enemyIdentity(hit.inst);
      bus.emit("hit", {
        ...identity,
        key: identity.enemyKey,
        source: "shot",
        head: hit.head,
        weak: !!hit.weak,
        damage: dmg,
        actual: dealt,
        killed: hit.inst.state === "death",
        x: hit.x,
        y: hit.y,
        z: hit.z,
      });
      return hit;
    }
    if (wall !== Infinity) {
      const wx = origin.x + dir.x * wall;
      const wy = origin.y + dir.y * wall;
      const wz = origin.z + dir.z * wall;
      if (vfx && vfx.spark) vfx.spark(wx, wy, wz, 0.85, true, true);
      bus.emit("wallHit", { x: wx, z: wz });
    }
    if (commandHit) player.hits += 1;
    return null;
  }

  /**
   * The one authoritative enemy-damage path.
   *
   * Every source comes through here so feedback cannot claim a hit
   * that health never received. The emitted world point is consumed by
   * the HUD's projected damage numbers; callers may provide the exact
   * impact, otherwise the number rises from the centre of the target.
   */
  function applyDamage(inst, dmg, detail = {}) {
    /* A submerged burrower takes nothing from anything, and the gate is
       HERE rather than only in the ray test - stratagems, shockwaves and
       the melee arc all reach this function by other routes, and a boss
       that can be killed by dropping ordnance on the sand above it has
       no invulnerable phase however carefully the ray test was
       written. */
    if (!inst || untouchable(inst)) return 0;
    if (typeof detail === "boolean") detail = { head: detail };
    const requested = Math.max(0, Number(dmg) || 0);
    const before = Math.max(0, Number(inst.health) || 0);
    const damage = modifiedEnemyDamage(inst, requested, detail, before);
    const actual = Math.min(before, damage);
    if (actual <= 0) return 0;
    inst.health = Math.max(0, before - damage);
    inst.lastHurtAt = clock;
    // Being shot is how a garrison finds out where you are, whether
    // or not it could see you.
    inst.alerted = true;
    inst.suspicion = 1;
    const killed = inst.health <= 0;
    const box = HITBOX[inst.key] || HITBOX.thresher;
    const identity = enemyIdentity(inst);
    const damageEvent = {
      ...identity,
      // `key` remains for established HUD/audio consumers; new systems use
      // the unambiguous enemyKey/enemyId pair.
      key: identity.enemyKey,
      requested,
      damage,
      actual,
      remaining: inst.health,
      source: detail.source || "unknown",
      head: !!detail.head,
      weak: !!detail.weak,
      killed,
      x: Number.isFinite(detail.x) ? detail.x : inst.x,
      y: Number.isFinite(detail.y) ? detail.y : inst.y + box.y1 * 0.62,
      z: Number.isFinite(detail.z) ? detail.z : inst.z,
    };
    if (killed) {
      enemies.kill(inst);
      inst.diedAt = clock;
      player.kills += 1;
      /* A RUPTURE, sized to the animal.
         The death clip is three seconds of collapse, which is exactly
         the right length and exactly the wrong feedback: with a
         swarm caste at forty a time the player needs to know
         IMMEDIATELY which of the six things they are shooting at has
         stopped being a problem, and a body that is still upright
         while it folds does not say that. One burst at the moment of
         death does, and scaling it off the hit capsule means a
         Harrow's death carries across the basin while a Thresher's
         stays local - which is also the correct relative importance. */
      if (vfx && vfx.spark) {
        vfx.spark(inst.x, inst.y + box.y1 * 0.45, inst.z, box.r * 2.4);
      }
      const killEvent = { ...damageEvent, x: inst.x, z: inst.z };
      bus.emit("kill", killEvent);
      ctx.progression?.onEnemyKilled?.(killEvent);
    } else if (enemies.play && clock - (inst.lastFlinchAt || -9) > 0.8) {
      inst.lastFlinchAt = clock;
      enemies.play(inst, "flinch", 0.08);
    }
    bus.emit("enemyDamaged", damageEvent);
    ctx.progression?.onEnemyDamaged?.(damageEvent);
    /* THE STYLITE'S GRIP, worn in proportion to whatever just landed.
       Here rather than in the ray test so that every source counts -
       a shot, a swing, a stratagem, a shockwave - and so no weapon
       needs a rule of its own. The encounter decides whether this
       instance is its own and whether the phase allows it; combat.js
       only reports that damage happened. */
    ctx.stylite?.wearGrip?.(actual, inst);
    return actual;
  }

  /**
   * A melee swing: everything inside a forward arc, once.
   *
   * An arc rather than a ray, because a polearm sweeps - hitting
   * only what is dead ahead makes a two-metre crescent feel like a
   * needle, and the whole reason to carry it is that it clears a
   * group. Line of sight is still checked, so a swing does not reach
   * through a wall.
   */
  /* `lunge` scales the weapon's own reach for one strike. A sweep
     covers a wide arc at the length the weapon happens to be; a
     thrust covers almost no arc and buys its threat back in depth,
     and without this it would simply be the same attack with a
     narrower cone - strictly worse. The clip that uses it drives
     the body forward too, so the extra reach is earned on screen
     rather than granted. */
  function meleeStrike(mult = 1, arc = 2.4, slam = false, lunge = 1, comboStep = 0) {
    const ps = ctx.player.state;
    const w = ctx.weapons && ctx.weapons.current;
    if (!w || !w.spec.melee) return 0;
    const reach = w.spec.reach * lunge * MELEE_CONFIG.reachMultiplier;
    const dmg = (w.spec.damage || 70) * mult;
    const eyeY = ps.y + 1.4;
    let hits = 0;
    let kills = 0;
    let knockbacks = 0;
    const targets = [];
    for (const inst of enemies.live) {
      if (untouchable(inst)) continue;
      const box = HITBOX[inst.key] || HITBOX.thresher;
      /* A leg walker measures reach to whichever LEG is nearest - or
         to the body, but only once collapse has made that a target at
         all. Everything else keeps measuring to the single nearest
         part of the animal, unchanged. */
      /* A FLYER IS ONLY MELEE-REACHABLE WHEN IT IS DOWN, and the check
         is vertical rather than a flag: `nearestBodyPoint` returns its
         origin, which is thirty metres up while it soars, so the
         ordinary reach test below rejects it by arithmetic. The
         explicit guard is here anyway because a lance swing that
         connects with something directly overhead is the exact bug
         this encounter cannot afford. */
      /* ...and the same for a creature that never flies but spends the
         fight on top of a hundred-metre needle. `perches` is the
         Stylite's own capability flag; the gate is identical because
         the question is. */
      if ((inst.spec?.flies || inst.spec?.perches) && !inst.grounded) continue;
      const legTarget = box.legs
        ? nearestLegPoint(inst, box, ps.x, ps.z, ps.y, _bodyNear) : null;
      const near = legTarget ? legTarget.dist : nearestBodyPoint(inst, ps.x, ps.z, _bodyNear);
      const dx = _bodyNear.x - ps.x;
      const dz = _bodyNear.z - ps.z;
      const dist = Math.max(near, 1e-4);
      const targetRadius = !box.legs ? box.r * (box.segments ? bodyHitScale(inst) : 1)
        : legTarget.radius;
      if (box.legs && legTarget.legIndex < 0 && !inst.collapsed) continue;
      if (dist > reach + targetRadius) continue;
      /* TOUCHING RANGE IS ITS OWN CASE. A collapsed boss's body is a
         capsule the player can stand inside the footprint of - the
         nearest point is then at or under their feet, the bearing to
         it is atan2(0,0)-noise, and a zero-length LOS ray reports
         itself blocked. Inside 1.2m none of those questions mean
         anything: you are against the target, the swing lands. */
      const inv = 1 / Math.max(1e-4, dist);
      if (dist > 1.2) {
        let rel = Math.atan2(dx, dz) - ps.yaw;
        while (rel > Math.PI) rel -= TAU;
        while (rel < -Math.PI) rel += TAU;
        if (Math.abs(rel) > arc * 0.5) continue;
        if (collide.rayBlock(ps.x, eyeY, ps.z, dx * inv, 0, dz * inv, dist) < dist) continue;
      }
      const wasAlive = inst.state !== "death";
      /* Threshers are the light swarm caste. A clean polearm connection
         always removes one, even if an authored encounter spawned it with a
         little bonus health; larger castes retain their normal balance. */
      const strikeDamage = inst.key === MELEE_CONFIG.lightEnemy
        ? Math.max(dmg, inst.health)
        : dmg;
      const hitY = box.legs ? _bodyNear.y : inst.y + box.y1 * 0.55;
      let dealt;
      if (box.legs && legTarget.legIndex >= 0) {
        dealt = damageLeg(inst, legTarget.legIndex, strikeDamage,
          { x: _bodyNear.x, y: hitY, z: _bodyNear.z });
      } else if (box.legs) {
        /* THE PAYOFF. A collapsed body is the one melee target in the
           game worth more than a rifle shot at it - see the comment on
           `collapsedMeleeMult` in the HITBOX entry for why that number
           is bigger than the ranged one. */
        dealt = applyDamage(inst, strikeDamage * (box.collapsedMeleeMult || 1), {
          source: "melee", weak: true, x: inst.x, y: hitY, z: inst.z,
          originX: ps.x, originZ: ps.z,
        });
      } else {
        /* A creature the player has knocked out of the sky is worth
           more at arm's length than at range - the window was earned
           by shooting, and it is spent by closing. */
        const downed = inst.grounded && box.groundedMeleeMult
          && (inst.spec?.flies || inst.spec?.perches);
        dealt = applyDamage(inst, strikeDamage * (downed ? box.groundedMeleeMult : 1), {
          source: "melee", weak: !!downed, x: inst.x, y: hitY, z: inst.z,
          originX: ps.x, originZ: ps.z,
        });
      }
      if (dealt <= 0) continue;
      hits += 1;
      const killed = wasAlive && inst.state === "death";
      if (killed) kills += 1;
      const identity = enemyIdentity(inst);
      targets.push({
        ...identity,
        key: identity.enemyKey,
        source: "melee",
        head: false,
        weak: box.legs && legTarget.legIndex < 0,
        legIndex: box.legs ? legTarget.legIndex : undefined,
        damage: dealt,
        killed,
        x: inst.x,
        y: hitY,
        z: inst.z,
      });
      if (inst.key === MELEE_CONFIG.lightEnemy) {
        /* This API is part of the enemy-system contract. Keeping the call
           direct means a missing export becomes a test-visible failure
           instead of silently turning the feature off. */
        if (enemies.knockback(inst, dx * inv, dz * inv,
          MELEE_CONFIG.lightKnockbackSpeed * (slam ? 1.30 : 1))) {
          knockbacks += 1;
        }
      }
      /* A kill already emits the caste-sized rupture in applyDamage. Add
         the warm contact spark only to survivors; stacking both made a
         Thresher disappear inside two white flashes at the exact read. */
      if (vfx && vfx.spark && inst.state !== "death") {
        vfx.spark(inst.x, hitY, inst.z,
          MELEE_CONFIG.hitSparkScale * (slam ? 1.18 : 1)
            * (box.legs && legTarget.legIndex < 0 ? 1.8 : 1),
          false, true);
      }
    }
    /* A swing clears a clutch. The arc is approximated by one sphere a
       little in front of the trooper rather than by re-deriving the
       cone - an egg is 2m across and the whole swing is 3.4m long, so
       the two differ by less than the target. */
    if (ctx.abbess?.hitEggs) {
      hits += ctx.abbess.hitEggs(ps.x + Math.sin(ps.yaw) * reach * 0.6,
        ps.y + 0.9, ps.z + Math.cos(ps.yaw) * reach * 0.6,
        reach * 0.8, dmg);
    }
    if (vfx && vfx.meleeArc) {
      vfx.meleeArc(ps.x, ps.y, ps.z, ps.yaw, reach, arc, hits, slam);
    }
    ctx.player.punch?.(slam
      ? MELEE_CONFIG.slamPunch
      : hits ? MELEE_CONFIG.hitPunch : MELEE_CONFIG.whiffPunch);
    const step = Number.isInteger(comboStep) && comboStep >= 1 && comboStep <= 3
      ? comboStep : 0;
    /* Close combat now feeds the same Reliquary reserve that powers Aegis.
       The return is per connected sweep, capped before a dense Thresher pack
       can turn one wide swing into a full tank. A dedicated Procession build
       layers Processional Mercy on top of this baseline reclaim. */
    const chargeRequested = hits > 0
      ? Math.min(MELEE_CONFIG.maxChargeRestore,
        hits * MELEE_CONFIG.chargeOnHit + kills * MELEE_CONFIG.chargeOnKill)
      : 0;
    const chargeRestored = chargeRequested > 0
      ? (ctx.jetpack?.restoreCharge?.(chargeRequested, "melee-reclaim") || 0)
      : 0;
    const meleeEvent = {
      source: "melee",
      comboStep: step,
      targets,
      hits,
      kills,
      knockbacks,
      chargeRequested,
      chargeRestored,
      slam,
      x: ps.x,
      y: ps.y,
      z: ps.z,
      yaw: ps.yaw,
      reach,
      arc,
    };
    bus.emit("melee", meleeEvent);
    ctx.progression?.onMeleeStrike?.(meleeEvent);
    if (slam) {
      // The finisher shakes the ground whether or not it connects.
      if (vfx && vfx.blast) vfx.blast(ps.x + Math.sin(ps.yaw) * 1.8, ps.y + 0.2,
        ps.z + Math.cos(ps.yaw) * 1.8, 5.4);
      bus.emit("slam", { x: ps.x, z: ps.z });
    }
    return hits;
  }

  /** Area damage: stratagems, and anything else that lands hard. */
  function explode(x, y, z, radius, damage) {
    const targets = [];
    let kills = 0;
    for (const inst of enemies.live) {
      if (untouchable(inst)) continue;
      const near = nearestBodyPoint(inst, x, z, _bodyNear);
      const d = Math.hypot(near, (_bodyNear.y - y) * 0.5);
      if (d > radius) continue;
      const wasAlive = inst.state !== "death";
      const dealt = applyDamage(inst, damage * (1 - (d / radius) * 0.65), {
        source: "explosion",
        x: _bodyNear.x,
        y: _bodyNear.y + (HITBOX[inst.key] || HITBOX.thresher).y1 * 0.55,
        z: _bodyNear.z,
        originX: x,
        originZ: z,
      });
      if (dealt <= 0) continue;
      const identity = enemyIdentity(inst);
      const killed = wasAlive && inst.state === "death";
      if (killed) kills += 1;
      targets.push({
        id: identity.enemyId,
        key: identity.enemyKey,
        damage: dealt,
        health: Math.max(0, Number(inst.health) || 0),
        killed,
      });
    }
    const pd = Math.hypot(
      ctx.player.state.x - x,
      ctx.player.state.y + 1.0 - y,
      ctx.player.state.z - z
    );
    if (pd < radius) hurtPlayer(damage * 0.5 * (1 - pd / radius), {
      source: "explosion",
      x,
      y,
      z,
    });
    ctx.abbess?.hitEggs?.(x, y, z, radius, damage);
    if (vfx && vfx.blast) vfx.blast(x, y, z, radius);
    return { hits: targets.length, kills, targets };
  }

  /**
   * A radial ground strike: the aerial slam's business end.
   *
   * Distinct from `explode` in the two ways that matter to how it
   * reads. It STUNS, which is the point of it - the reward for
   * committing to a fall is that everything under you stops - and it
   * falls off from an inner plateau rather than from the centre, so
   * a slam that lands next to something and a slam that lands on it
   * are worth the same. Line of sight is still required: a creature
   * on the far side of a wall is not standing on the ground you hit.
   */
  function shockwave(x, y, z, opts = {}) {
    const radius = Math.max(0.5, Number(opts.radius) || 8);
    const inner = Math.min(radius, Math.max(0, Number(opts.innerRadius) || 0));
    const peak = Math.max(0, Number(opts.damage) || 0);
    const rawEdge = Number(opts.edgeFalloff);
    const edge = clamp01(Number.isFinite(rawEdge) ? rawEdge : 0.4);
    const stunFor = Math.max(0, Number(opts.stun) || 0);
    const knock = Math.max(0, Number(opts.knockSpeed) || 0);
    const source = opts.source || "shockwave";
    let hits = 0;
    let kills = 0;
    let stunned = 0;
    for (const inst of enemies.live) {
      if (untouchable(inst)) continue;
      if (source === "slam" && inst.spec?.flies && !inst.grounded
        && inst.y > y + 3) continue;
      const dist = Math.max(nearestBodyPoint(inst, x, z, _bodyNear), 1e-4);
      const dx = _bodyNear.x - x;
      const dz = _bodyNear.z - z;
      const box = HITBOX[inst.key] || HITBOX.thresher;
      const targetRadius = box.r * (box.segments ? bodyHitScale(inst) : 1);
      if (dist > radius + targetRadius) continue;
      const inv = 1 / dist;
      if (dist > 0.6 && collide.rayBlock(
        x, y + 0.55, z, dx * inv, 0, dz * inv, dist) < dist - 0.05) continue;

      const reach = clamp01((dist - inner) / Math.max(1e-3, radius - inner));
      const scale = 1 - reach * (1 - edge);
      const wasAlive = inst.state !== "death";
      const dealt = peak > 0
        ? applyDamage(inst, peak * scale, {
          source,
          x: _bodyNear.x,
          y: _bodyNear.y + box.y1 * 0.4,
          z: _bodyNear.z,
          originX: x,
          originZ: z,
        })
        : 0;
      if (peak > 0 && dealt <= 0) continue;
      hits += 1;
      if (dealt > 0 && wasAlive && inst.state === "death") kills += 1;
      if (inst.state !== "death") {
        if (stunFor > 0 && enemies.stun(inst, stunFor * (0.6 + 0.4 * (1 - reach)))) {
          stunned += 1;
        }
        if (knock > 0 && dist > 1e-3) {
          enemies.knockback(inst, dx * inv, dz * inv, knock * (1 - reach * 0.5));
        }
        if (vfx && vfx.spark) {
          vfx.spark(inst.x, inst.y + box.y1 * 0.45, inst.z, 1.15, false, true);
        }
      }
    }
    if (peak > 0) ctx.abbess?.hitEggs?.(x, y, z, radius, peak);
    bus.emit("shockwave", { x, y, z, radius, hits, kills, stunned, source });
    return { hits, kills, stunned, radius };
  }

  function hurtPlayer(amount, detail = {}) {
    /* Set only by the QA hook, and only by checks that are not about
       survival. Garrisoning the level properly made standing still in
       the Bloom lethal inside three seconds - which is the intended
       behaviour of the Bloom - and that quietly broke six checks
       downstream that were testing stratagems and the mission state
       machine, because a dead player channels nothing. A test that
       fails for a reason it is not testing is worse than no test. */
    if (player.invulnerable) return 0;
    if (player.dead) return 0;
    /* Field Chapel's upgraded boundary intercepts only Gleaner fire. The
       sanctuary is checked before Aegis, so a blocked projectile never drains
       shield charge or accidentally counts as a perfect guard. */
    if (detail.source === "enemy-fire" && ctx.mission?.blocksEnemyProjectile?.(detail)) {
      bus.emit("projectileBlocked", {
        source: detail.source,
        reason: "field-sanctuary",
        x: detail.x,
        y: detail.y,
        z: detail.z,
        enemyId: detail.enemyId || "",
        enemyKey: detail.enemyKey || detail.enemy || "",
      });
      return 0;
    }
    if (ctx.shield?.tryBlock?.(amount, detail)) {
      const block = ctx.shield.lastBlock?.() || {};
      bus.emit("shieldBlock", {
        amount,
        source: detail.source || "attack",
        enemyId: detail.enemyId || "",
        enemyKey: detail.enemyKey || detail.enemy || "",
        x: detail.x,
        y: detail.y,
        z: detail.z,
        hp: player.hp,
        perfect: !!block.perfect,
        timing: block.timing || null,
      });
      return 0;
    }
    player.hp = Math.max(0, player.hp - amount);
    player.lastHitAt = clock;
    bus.emit("playerHurt", { hp: player.hp, damage: amount, source: detail.source || "attack" });
    if (player.hp <= 0) {
      player.dead = true;
      player.respawnIn = 3.4;
      bus.emit("playerDied", {});
    }
    return amount;
  }

  /* ============================================================
     ENEMY BEHAVIOUR

     Four states, and the transitions between them are distance and
     line-of-sight. Ordinary pursuit stays allocation-light and uses
     collision sliding; a creature that genuinely stalls requests one
     bounded route from the collision grid and follows its smoothed
     waypoints until it has a clear chase line again.
     ============================================================ */

  function canSee(inst, px, py, pz) {
    const horizontal = Math.hypot(px - inst.x, pz - inst.z);
    const spec = SPEC[inst.key] || SPEC.thresher;
    if (horizontal > spec.sight) return false;

    const box = HITBOX[inst.key] || HITBOX.thresher;
    /* Sight for a ranged unit starts at the socket its bolt actually
       leaves. The old head-centre ray could pass below an overhang while
       the higher spinneret was buried in it; damage was then applied even
       though the visible tracer stopped on masonry seven metres away. */
    const origin = spec.burst
      ? muzzleAt(inst, box, _muzzle)
      : headAt(inst, box, _head);
    const dx = px - origin.x;
    const dy = py - origin.y;
    const dz = pz - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-4) return true;
    return collide.rayBlock(origin.x, origin.y, origin.z,
      dx / distance, dy / distance, dz / distance, distance,
      /* Player gun sockets may escape their own wall cell; a physical
         Gleaner muzzle embedded in masonry may not. */ !spec.burst) >= distance;
  }

  /** Where a ranged unit's bolts leave it, in world space. */
  function muzzleAt(inst, box, out) {
    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    const fz = box.muzzleZ ?? box.headZ ?? 0;
    const y = box.muzzle ?? box.head * 0.92;
    out.set(inst.x + s * fz, inst.y + y, inst.z + c * fz);
    return out;
  }

  function stepEnemy(inst, dt, px, py, pz) {
    if (inst.state === "death" || inst.emerging?.active) return;
    /* District guardians exist from load so their asset and durable identity
       are stable, but dormant/reveal-locked actors do not perceive, move or
       attack. Damage already honours the same gate in targetable(). */
    if (inst.encounterHidden || inst.encounterLocked) return;
    /* A CHAINED BODY IS SOMEBODY ELSE'S DECISION.
       Everything below this line assumes a creature that stands on the
       ground, walks toward the player and is always hittable, and the
       burrower is none of those. coulter.js runs its own loop over its
       own instances - see main.js's step order - so the only correct
       thing to do here is decline: the alternative is this function
       growing a second state machine inside the first. */
    /* A SELF-DRIVEN CREATURE IS SOMEBODY ELSE'S DECISION, same as a
       chained body is. `distaff.js` runs its own loop over its own
       instance - see main.js's step order - so falling through to
       the generic sight/hearing/approach/attack machinery below would
       have it acting on `SPEC.thresher`'s fallback numbers (it has no
       entry of its own) and dragging its own root position around
       from underneath legs that expect it to hold still. */
    /* ...and the same opt-out is available PER INSTANCE, not only per
       species. An encounter can take temporary ownership of an ordinary
       creature: the Abbess's brood are Threshers in every other
       respect, and for the last few seconds of their lives they walk
       home to feed her instead of fighting. Releasing their aggro is
       not enough to do that - the sensing block above re-detects a
       player standing in the same room on the very next frame - so the
       encounter drives them, and this is where it says so. */
    if (inst.body || inst.spec.selfDriven || inst.selfDriven) return;
    /* STUNNED CREATURES DO NOTHING. Not walk, not turn, not shoot.
       The gate lives here rather than in enemies.js because this is
       where every decision a creature makes is taken; enforcing it
       at the animation layer would leave a unit that stands still
       and still puts rounds through you, which is the version of a
       stun nobody can read. */
    if (inst.stunTime > 0) {
      inst.stunTime = Math.max(0, inst.stunTime - dt);
      /* Woken by it, though - a garrison flattened by a slam should
         be looking for you when it gets up. */
      inst.suspicion = 1;
      inst.alerted = true;
      return;
    }
    const spec = SPEC[inst.key] || SPEC.thresher;
    const dx = px - inst.x;
    const dz = pz - inst.z;
    const dist = Math.hypot(dx, dz);

    /* Each field guarded SEPARATELY, not behind one flag.
       Gating the whole block on `suspicion === undefined` meant that
       anything which woke a unit before its first update - a bullet,
       or the alarm that calling extraction raises across the map -
       set suspicion, skipped the initialiser, and left `home`
       undefined until the unit tried to walk back to it and threw. */
    if (inst.suspicion === undefined) inst.suspicion = 0;
    if (inst.fireTimer === undefined) inst.fireTimer = 0;
    if (inst.burstLeft === undefined) inst.burstLeft = 0;
    if (!inst.home) inst.home = { x: inst.x, z: inst.z };

    /* Command markers temporarily author the unit's attention. Light bodies
       investigate the tone; heavy bodies only turn to acknowledge it. This
       precedes ordinary player sensing on purpose: otherwise a nearby player
       instantly overwrites Siren Beacon and the talent exists only in data. */
    const lure = inst.commandLure;
    if (lure && lure.owner === "mission"
      && Number.isFinite(lure.x) && Number.isFinite(lure.z)
      && Number.isFinite(lure.until) && lure.until >= clock) {
      const lx = lure.x - inst.x;
      const lz = lure.z - inst.z;
      const ld = Math.hypot(lx, lz);
      if (ld > 1e-4) {
        const want = Math.atan2(lx, lz);
        const turn = ((want - inst.yaw + Math.PI * 3) % TAU) - Math.PI;
        inst.yaw += clamp(turn, -2.9 * dt, 2.9 * dt);
        if (lure.mode === "pull" && ld > 2.4) {
          approach(inst, lure.x, lure.z,
            inst.spec.speed.walk * clamp(Number(lure.speedScale) || 0.72, 0.2, 1.4), dt);
          if (inst.state !== "alert") enemies.play(inst, "alert", 0.2);
        }
      }
      inst.suspicion = 1;
      inst.alerted = true;
      return;
    }

    /* Hearing can wake a garrison and make it investigate, but only
       an unobstructed 3D ray authorises a ranged attack. Treating the
       hearing radius as sight let ranged units shoot through roofs and
       walls at close range, which was especially obvious in flight. */
    const hears = !player.dead && dist < spec.hearing;
    const sees = !player.dead && canSee(inst, px, py, pz);
    const sensed = hears || sees;
    if (sensed) inst.suspicion = 1;
    else if (inst.alerted && inst.navigation?.path) {
      /* A valid detour often begins by moving away from the player to
         reach a courtyard exit. Letting suspicion decay during that leg
         made the unit abandon a correct Cathedral route after six seconds,
         turn around, and walk home. It retains the investigation only while
         an actual route exists; once the last-known point is reached, the
         ordinary decay resumes. */
      inst.suspicion = Math.max(inst.suspicion, 0.12);
    } else inst.suspicion = Math.max(0, inst.suspicion - dt * 0.16);

    // Alerting the neighbours. A garrison that wakes one unit at a
    // time is a shooting gallery.
    if (sensed && !inst.alerted) {
      inst.alerted = true;
      for (const other of enemies.live) {
        if (other === inst || other.state === "death") continue;
        if (Math.hypot(other.x - inst.x, other.z - inst.z) < 42) {
          other.suspicion = Math.max(other.suspicion || 0, 0.9);
        }
      }
    }

    if (inst.suspicion <= 0.01 || dist > spec.aggro) {
      // Idle: drift back toward the post it was garrisoned on.
      const hx = inst.home.x - inst.x;
      const hz = inst.home.z - inst.z;
      const hd = Math.hypot(hx, hz);
      if (hd > 3) {
        approach(inst, inst.home.x, inst.home.z, inst.spec.speed.walk * 0.45, dt);
        if (inst.state !== "idle") enemies.play(inst, "idle", 0.3);
      } else if (inst.state !== "idle") {
        enemies.play(inst, "idle", 0.3);
      }
      inst.alerted = false;
      return;
    }

    // Face the player whether or not it can reach them.
    const want = Math.atan2(dx, dz);
    let delta = ((want - inst.yaw + Math.PI * 3) % TAU) - Math.PI;
    inst.yaw += clamp(delta, -2.6 * dt, 2.6 * dt);

    /* BROODING. The boss's whole reason to exist as something other
       than a large Harrow: it stops, plants, and lays.

       It runs on the same clock whether or not the player is in
       reach, and deliberately so. A brood gated on melee range would
       only ever fire while the player was already being hit, which
       is the moment they can least afford to look at anything else;
       fired at range it is a timer that says "stop shooting the
       armour and go around", which is the decision the fight is
       about. It still requires line of sight, so breaking contact
       genuinely stops it. */
    if (spec.broodEvery && sees) {
      if (inst.broodTimer === undefined) inst.broodTimer = spec.broodEvery * 0.55;
      inst.broodTimer -= dt;
      if (inst.broodTimer <= 0) {
        inst.broodTimer = spec.broodEvery;
        brood(inst, spec);
        return;
      }
    }

    /* A ground creature cannot bite a capsule ten metres overhead.
       Ranged units keep their line-of-sight attack; only physical
       strikes require vertical overlap. */
    const verticalReach = spec.burst || Math.abs(py - (inst.y + 1.1)) < 2.8;
    const inRange = dist <= spec.reach && verticalReach;
    if (inRange && sees) {
      attack(inst, spec, dt);
      return;
    }

    const speed = spec.reach > 8 ? inst.spec.speed.walk : inst.spec.speed.charge;
    approach(inst, px, pz, speed, dt);
    if (inst.state !== "alert") enemies.play(inst, "alert", 0.24);
  }

  /** Move toward a world-space goal, retaining a detour once collision
   *  proves that direct wall sliding cannot make progress. */
  function approach(inst, goalX, goalZ, speed, dt) {
    const r = (HITBOX[inst.key] || HITBOX.thresher).r;
    const radius = r * 0.8;
    if (!inst.navigation) {
      inst.navigation = {
        path: null,
        at: 0,
        pathGoalX: goalX,
        pathGoalZ: goalZ,
        stallFor: 0,
        repathIn: 0,
        clearCheckIn: 0,
      };
    }
    const nav = inst.navigation;
    nav.repathIn = Math.max(0, nav.repathIn - dt);
    nav.clearCheckIn = Math.max(0, nav.clearCheckIn - dt);

    const goalShift = Math.hypot(goalX - nav.pathGoalX, goalZ - nav.pathGoalZ);
    if (nav.path && goalShift > 7.5 && nav.repathIn <= 0) {
      nav.path = null;
      nav.at = 0;
      nav.stallFor = 0.24;
    }
    /* Once the obstacle is behind the creature, abandon the remaining
       stale lattice route and chase the player's live position directly. */
    if (nav.path && nav.clearCheckIn <= 0) {
      nav.clearCheckIn = 0.36;
      if (collide.walkClear(inst.x, inst.z, goalX, goalZ, radius)) {
        nav.path = null;
        nav.at = 0;
      }
    }

    let steerX = goalX;
    let steerZ = goalZ;
    if (nav.path) {
      const reach = Math.max(radius + 0.32, speed * dt * 2.2);
      while (nav.at < nav.path.length) {
        const point = nav.path[nav.at];
        if (Math.hypot(point[0] - inst.x, point[1] - inst.z) > reach) break;
        nav.at += 1;
      }
      if (nav.at >= nav.path.length) {
        nav.path = null;
        nav.at = 0;
      } else {
        steerX = nav.path[nav.at][0];
        steerZ = nav.path[nav.at][1];
      }
    }

    const dx = steerX - inst.x;
    const dz = steerZ - inst.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-5) {
      inst.speed = 0;
      return;
    }
    const ux = dx / dist;
    const uz = dz / dist;
    const step = Math.min(speed * dt, dist);
    const nx = inst.x + ux * step;
    const nz = inst.z + uz * step;
    const oldX = inst.x;
    const oldZ = inst.z;
    // Enemies are grounded walkers too. Candidate-ground collision
    // prevents the same downhill stale-Y penetration that used to
    // trap the player; their larger capsule radius is preserved.
    const out = collide.slide(inst.x, inst.z, nx, nz, null, radius);
    inst.x = out[0];
    inst.z = out[1];
    const moved = Math.hypot(inst.x - oldX, inst.z - oldZ);
    const before = Math.hypot(steerX - oldX, steerZ - oldZ);
    const after = Math.hypot(steerX - inst.x, steerZ - inst.z);
    const progress = before - after;
    inst.speed = moved / Math.max(dt, 1e-4);

    /* The route owns facing only while it is genuinely taking a detour.
       Direct chase already faced the player above; overriding that every
       frame would make ranged creatures waggle around their own muzzle. */
    if (nav.path) {
      const want = Math.atan2(ux, uz);
      const turn = ((want - inst.yaw + Math.PI * 3) % TAU) - Math.PI;
      inst.yaw += clamp(turn, -2.8 * dt, 2.8 * dt);
    }

    const stalled = moved < step * 0.28 || progress < step * 0.08;
    nav.stallFor = stalled
      ? nav.stallFor + dt
      : Math.max(0, nav.stallFor - dt * 2.5);
    if (nav.stallFor < 0.22 || nav.repathIn > 0 || !collide.findPath
      || navigationBudget <= 0) return;

    navigationBudget -= 1;
    const path = collide.findPath(inst.x, inst.z, goalX, goalZ, radius);
    nav.path = path && path.length ? path : null;
    nav.pathGoalX = goalX;
    nav.pathGoalZ = goalZ;
    nav.at = 0;
    nav.stallFor = 0;
    nav.repathIn = nav.path ? 0.72 : 1.25;
    nav.clearCheckIn = 0.24;
  }

  /**
   * Lay a clutch behind the ovipositor.
   *
   * Spawned BEHIND the boss, at its own tail, which is the point: the
   * weak point and the children come out of the same place, so the
   * ground the player wants to stand on is the ground that keeps
   * filling up. Spawning them in front would have made the brood a
   * wall between the player and the fight instead of a cost of
   * getting to it.
   */
  function brood(inst, spec) {
    if (enemies.play) enemies.play(inst, "brood", 0.2);
    bus.emit("brood", { key: inst.key, x: inst.x, z: inst.z });
    if (!enemies.spawn) return;

    // Its own living children only. Counting every Thresher on the
    // map would let a garrison two districts away suppress the boss
    // mechanic entirely.
    inst.broodKids = (inst.broodKids || []).filter(
      (kid) => kid && kid.state !== "death" && kid.health > 0);
    if (inst.broodKids.length >= (spec.broodCap || 12)) return;

    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    const room = (spec.broodCap || 12) - inst.broodKids.length;
    for (let i = 0; i < Math.min(spec.broodCount || 3, room); i += 1) {
      const spread = (i - (spec.broodCount - 1) * 0.5) * 2.2;
      // Tail-ward along the boss's own forward axis, then fanned out
      // across it, so the clutch lands in an arc rather than a stack.
      const bz = -5.6;
      const x = inst.x + s * bz + c * spread;
      const z = inst.z + c * bz - s * spread;
      const kid = enemies.spawn("thresher", x, z, {
        yaw: inst.yaw + Math.PI,
        emerge: { delay: i * 0.12, duration: 1.05, depth: 1.2 },
      });
      if (!kid) continue;
      // Born awake and looking at you. A clutch that has to notice
      // the player first gives away the seconds that make it a threat.
      kid.alerted = true;
      kid.suspicion = 1;
      inst.broodKids.push(kid);
    }
  }

  function clearEnemyProjectiles(enemyId = null) {
    const before = hostileProjectiles.length;
    if (typeof enemyId !== "string" || !enemyId) {
      hostileProjectiles.length = 0;
    } else {
      for (let i = hostileProjectiles.length - 1; i >= 0; i -= 1) {
        if (hostileProjectiles[i].enemyId === enemyId) hostileProjectiles.splice(i, 1);
      }
    }
    const cleared = before - hostileProjectiles.length;
    return cleared;
  }

  function projectileState() {
    return {
      config: { ...GLEANER_PROJECTILE_CONFIG },
      active: hostileProjectiles.length,
      launched: projectileTotals.launched,
      contacts: projectileTotals.contacts,
      damagingHits: projectileTotals.damagingHits,
      intercepted: projectileTotals.intercepted,
      misses: projectileTotals.misses,
      coverStops: projectileTotals.coverStops,
      flights: hostileProjectiles.map((projectile) => ({
        id: projectile.id,
        enemyId: projectile.enemyId,
        age: Number(projectile.age.toFixed(4)),
        travelled: Number(projectile.travelled.toFixed(3)),
        span: Number(projectile.span.toFixed(3)),
        speed: projectile.speed,
        directAim: projectile.directAim,
      })),
    };
  }

  /** Advance every hostile bolt as a swept segment.
   *
   * A 105m/s point moves up to 10.5m in the largest accepted game step;
   * checking only its new position would let it tunnel completely through a
   * trooper. The same capsule/ray helper used for enemy bodies makes every
   * intervening centimetre authoritative. Static cover already shortened the
   * bolt's span at launch, so it can never reach a player behind masonry. */
  function updateEnemyProjectiles(dt, ps) {
    if (!(dt > 0) || hostileProjectiles.length === 0) return;
    _playerCapsuleA.set(ps.x, ps.y + GLEANER_PROJECTILE_CONFIG.playerCapsuleBottom, ps.z);
    _playerCapsuleB.set(ps.x, ps.y + GLEANER_PROJECTILE_CONFIG.playerCapsuleTop, ps.z);

    for (let i = hostileProjectiles.length - 1; i >= 0; i -= 1) {
      const projectile = hostileProjectiles[i];
      const remaining = Math.max(0, projectile.span - projectile.travelled);
      const step = Math.min(remaining, projectile.speed * dt);
      if (step <= 1e-6) {
        const reason = projectile.endsAtCover ? "cover" : "miss";
        projectileTotals[reason === "cover" ? "coverStops" : "misses"] += 1;
        bus.emit("enemyProjectileResolved", {
          id: projectile.id,
          enemyId: projectile.enemyId,
          enemyKey: projectile.enemyKey,
          reason,
          flightSeconds: projectile.age,
          travelled: projectile.travelled,
          directAim: projectile.directAim,
        });
        hostileProjectiles.splice(i, 1);
        continue;
      }

      const hitT = segmentHit(
        projectile.x, projectile.y, projectile.z,
        projectile.dx, projectile.dy, projectile.dz,
        _playerCapsuleA, _playerCapsuleB,
        GLEANER_PROJECTILE_CONFIG.playerRadius
      );
      if (hitT >= 0 && hitT <= step + 1e-5) {
        projectile.x += projectile.dx * hitT;
        projectile.y += projectile.dy * hitT;
        projectile.z += projectile.dz * hitT;
        projectile.travelled += hitT;
        projectile.age += hitT / projectile.speed;
        projectileTotals.contacts += 1;
        const dealt = hurtPlayer(projectile.damage, {
          source: projectile.source || "enemy-fire",
          x: projectile.ox,
          y: projectile.oy,
          z: projectile.oz,
          projectileX: projectile.x,
          projectileY: projectile.y,
          projectileZ: projectile.z,
          enemy: projectile.enemyKey,
          enemyId: projectile.enemyId,
          enemyKey: projectile.enemyKey,
        });
        if (dealt > 0) projectileTotals.damagingHits += 1;
        else projectileTotals.intercepted += 1;
        bus.emit("enemyProjectileResolved", {
          id: projectile.id,
          enemyId: projectile.enemyId,
          enemyKey: projectile.enemyKey,
          reason: dealt > 0 ? "hit" : "intercepted",
          damage: dealt,
          flightSeconds: projectile.age,
          travelled: projectile.travelled,
          directAim: projectile.directAim,
          x: projectile.x,
          y: projectile.y,
          z: projectile.z,
        });
        hostileProjectiles.splice(i, 1);
        if (player.dead) {
          clearEnemyProjectiles();
          return;
        }
        continue;
      }

      projectile.x += projectile.dx * step;
      projectile.y += projectile.dy * step;
      projectile.z += projectile.dz * step;
      projectile.travelled += step;
      projectile.age += step / projectile.speed;
      if (projectile.travelled + 1e-5 >= projectile.span) {
        const reason = projectile.endsAtCover ? "cover" : "miss";
        projectileTotals[reason === "cover" ? "coverStops" : "misses"] += 1;
        bus.emit("enemyProjectileResolved", {
          id: projectile.id,
          enemyId: projectile.enemyId,
          enemyKey: projectile.enemyKey,
          reason,
          flightSeconds: projectile.age,
          travelled: projectile.travelled,
          directAim: projectile.directAim,
          x: projectile.x,
          y: projectile.y,
          z: projectile.z,
        });
        hostileProjectiles.splice(i, 1);
      }
    }
  }

  function launchEnemyProjectile(inst, spec = {}, options = {}) {
    const config = {
      ...GLEANER_PROJECTILE_CONFIG,
      speed: Number.isFinite(options.speed) ? options.speed : GLEANER_PROJECTILE_CONFIG.speed,
      directAimChance: Number.isFinite(options.directAimChance)
        ? clamp01(options.directAimChance) : GLEANER_PROJECTILE_CONFIG.directAimChance,
      horizontalSpread: Number.isFinite(options.horizontalSpread)
        ? Math.max(0, options.horizontalSpread) : GLEANER_PROJECTILE_CONFIG.horizontalSpread,
      verticalSpread: Number.isFinite(options.verticalSpread)
        ? Math.max(0, options.verticalSpread) : GLEANER_PROJECTILE_CONFIG.verticalSpread,
      maxRange: Number.isFinite(options.maxRange)
        ? Math.max(1, options.maxRange) : GLEANER_PROJECTILE_CONFIG.maxRange,
    };
    const box = HITBOX[inst.key] || HITBOX.thresher;
    const ps = ctx.player.state;
    if (options.origin?.isVector3) _muzzle.copy(options.origin);
    else if (options.origin && Number.isFinite(options.origin.x)
      && Number.isFinite(options.origin.y) && Number.isFinite(options.origin.z)) {
      _muzzle.set(options.origin.x, options.origin.y, options.origin.z);
    } else muzzleAt(inst, box, _muzzle);
    const ox = _muzzle.x;
    const oy = _muzzle.y;
    const oz = _muzzle.z;
    const target = options.target || ps;
    let tx = (Number.isFinite(target.x) ? target.x : ps.x) - ox;
    let ty = (Number.isFinite(target.y) ? target.y : ps.y + 1.62) - oy;
    let tz = (Number.isFinite(target.z) ? target.z : ps.z) - oz;
    const targetDistance = Math.hypot(tx, ty, tz) || 1;
    tx /= targetDistance;
    ty /= targetDistance;
    tz /= targetDistance;

    /* Fewer bolts are pin-perfect, and even those are committed to the
       player's launch-time position. Movement after the muzzle flash is a
       real dodge rather than an animation played after damage was decided. */
    const directAim = Math.random() < config.directAimChance;
    if (!directAim) {
      tx += (Math.random() - 0.5) * config.horizontalSpread;
      ty += (Math.random() - 0.5) * config.verticalSpread;
      tz += (Math.random() - 0.5) * config.horizontalSpread;
      const n = Math.hypot(tx, ty, tz) || 1;
      tx /= n;
      ty /= n;
      tz /= n;
    }

    /* End at the launch-time aim point. On a stationary contact the GPU
       head therefore dies inside the player/shield volume instead of flying
       several metres through it; on an evasion it visibly crosses the old
       position and expires as a clean miss. */
    const pathRange = Math.min(config.maxRange, targetDistance);
    const blocked = collide.rayBlock(ox, oy, oz, tx, ty, tz, pathRange, false);
    const span = Math.min(pathRange, blocked);
    const baseDamage = Number.isFinite(options.damage)
      ? Math.max(0, options.damage)
      : Math.max(0, Number(spec.damage) || 0) * SURVIVAL_CONFIG.enemyDamageMultiplier
        * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1);
    const incoming = baseDamage;
    const projectile = {
      id: `${options.idPrefix || `${inst.key}-bolt`}-${++projectileSerial}`,
      enemyId: inst.id,
      enemyKey: inst.key,
      ox, oy, oz,
      x: ox, y: oy, z: oz,
      dx: tx, dy: ty, dz: tz,
      speed: config.speed,
      span: Math.max(0, span),
      travelled: 0,
      age: 0,
      damage: incoming,
      source: options.source || "enemy-fire",
      directAim,
      targetDistance,
      endsAtCover: Number.isFinite(blocked) && blocked < pathRange - 0.05,
    };
    hostileProjectiles.push(projectile);
    projectileTotals.launched += 1;
    bus.emit("enemyProjectileLaunched", {
      id: projectile.id,
      enemyId: inst.id,
      enemyKey: inst.key,
      x: ox,
      y: oy,
      z: oz,
      speed: config.speed,
      span: projectile.span,
      targetDistance,
      directAim,
      damage: incoming,
    });

    if (vfx?.tracer) {
      vfx.tracer(ox, oy, oz, tx, ty, tz,
        projectile.span, Number.isFinite(options.tracerWidth) ? options.tracerWidth : 0.055,
        options.tracerStyle === "bloom" ? "bloom" : false, config.speed);
    }
    if (options.muzzle !== false && vfx?.muzzle) vfx.muzzle(ox, oy, oz, tx, ty, tz,
      Number.isFinite(options.muzzleScale) ? options.muzzleScale : 0.75, false);
    return projectile;
  }

  function attack(inst, spec, dt) {
    inst.fireTimer -= dt;
    if (inst.fireTimer > 0) return;

    if (spec.burst) {
      if (inst.burstLeft <= 0) inst.burstLeft = spec.burst;
      inst.burstLeft -= 1;
      inst.fireTimer = inst.burstLeft > 0 ? spec.cadence : spec.burstGap;
      if (inst.state !== "fire") enemies.play(inst, "fire", 0.12);
    } else {
      inst.fireTimer = spec.cadence;
      enemies.play(inst, "strike", 0.1);
    }
    bus.emit("enemyFire", { key: inst.key, x: inst.x, z: inst.z, melee: !spec.burst });
    if (spec.burst) {
      launchEnemyProjectile(inst, spec);
      return;
    }

    const incoming = spec.damage * SURVIVAL_CONFIG.enemyDamageMultiplier
      * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1);
    hurtPlayer(incoming, {
      source: "enemy-melee",
      x: inst.x,
      y: inst.y + (HITBOX[inst.key] || HITBOX.thresher).head,
      z: inst.z,
      enemy: inst.key,
      enemyId: inst.id,
      enemyKey: inst.key,
    });
  }

  /* ============================================================
     UPDATE
     ============================================================ */

  function update(dt) {
    clock += dt;
    navigationBudget = 1;
    const ps = ctx.player.state;

    if (player.dead) {
      clearEnemyProjectiles();
      player.respawnIn -= dt;
      if (player.respawnIn <= 0) respawn();
      return;
    }

    /* Existing bolts move before this frame's enemy decisions. A Gleaner
       that fires below is therefore born at the muzzle on both the logical
       and rendered timelines, then advances on the next simulation step. */
    updateEnemyProjectiles(dt, ps);
    if (player.dead) return;

    // Regeneration, but only well after the last hit - long enough
    // that it never rewards standing in the open.
    if (clock - player.lastHitAt > SURVIVAL_CONFIG.regenDelay && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + dt * SURVIVAL_CONFIG.regenPerSecond);
    }

    const eyeY = ps.y + 1.62;
    for (const inst of enemies.live) {
      // Enemies far enough away that they cannot act are skipped
      // entirely, matching the render-side distance tiers.
      const d2 = (inst.x - ps.x) ** 2 + (inst.z - ps.z) ** 2;
      if (inst.state !== "death" && d2 > 240 * 240) continue;
      stepEnemy(inst, dt, ps.x, eyeY, ps.z);
    }

    // Corpses are cleared a while after they land, so a long fight
    // does not leave the field carpeted in bodies at full cost.
    for (let i = enemies.live.length - 1; i >= 0; i -= 1) {
      const inst = enemies.live[i];
      /* Restored domain-owned deaths have no session-clock timestamp. Give
         them a fresh corpse lifetime instead of interpreting zero as an
         ancient death and removing the actor before its controller can
         finish a short mission handoff. */
      if (inst.state === "death" && !Number.isFinite(inst.diedAt)) inst.diedAt = clock;
      if (inst.state === "death" && clock - inst.diedAt > 26) {
        enemies.group.remove(inst.root);
        enemies.live.splice(i, 1);
      }
    }
  }

  function respawn() {
    player.dead = false;
    player.hp = player.maxHp;
    clearEnemyProjectiles();
    // Back at the drop point, which is the only place on the map
    // guaranteed not to have been overrun.
    let x = ctx.mission ? ctx.mission.spawn.x : 0;
    let z = ctx.mission ? ctx.mission.spawn.z : 700;
    const open = collide.findOpen(x, z, collide.groundHeight(x, z), 40, 22);
    if (open) { x = open[0]; z = open[1]; }
    /* Use the player-owned spawn path so vertical grounding, velocity,
       stride and both planted feet reset together. Directly rewriting
       x/y/z left foot IK at the death site and bypassed the same safe
       collision placement used everywhere else. */
    ctx.player.spawn(x, z, Math.PI);
    for (const inst of enemies.live) {
      inst.suspicion = 0;
      inst.alerted = false;
    }
    bus.emit("respawn", {});
  }

  /* ============================================================
     DURABLE PLAYER STATE

     Save files carry outcomes, never momentary combat effects. In
     particular, a load must not replay the death/respawn bus or leave
     the player half-way through a damage transition. The regeneration
     lock is stored as time REMAINING instead of the private combat
     clock, so a save is portable across fresh sessions.
     ============================================================ */

  function snapshot() {
    const sinceHit = Math.max(0, clock - player.lastHitAt);
    return {
      hp: player.hp,
      maxHp: player.maxHp,
      kills: player.kills,
      shots: player.shots,
      hits: player.hits,
      regenLockRemaining: clamp(
        SURVIVAL_CONFIG.regenDelay - sinceHit,
        0,
        SURVIVAL_CONFIG.regenDelay
      ),
    };
  }

  function restore(saved) {
    if (!saved || typeof saved !== "object") return false;
    clearEnemyProjectiles();

    // These generous ceilings make corrupt/untrusted local saves safe
    // without constraining any value normal play can produce.
    const finite = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const counter = (value, fallback) => Math.round(clamp(
      finite(value, fallback), 0, 1_000_000_000
    ));

    const maxHp = clamp(
      finite(saved.maxHp, SURVIVAL_CONFIG.playerMaxHp),
      1,
      10_000
    );
    const shots = counter(saved.shots, 0);
    const regenLockRemaining = clamp(
      finite(saved.regenLockRemaining, 0),
      0,
      SURVIVAL_CONFIG.regenDelay
    );

    player.maxHp = maxHp;
    // A durable save may have been captured at the instant of death.
    // Loading always resumes in a playable state rather than starting
    // a silent respawn timer with no matching death presentation.
    player.hp = clamp(finite(saved.hp, maxHp), 1, maxHp);
    player.kills = counter(saved.kills, 0);
    player.shots = shots;
    player.hits = Math.min(shots, counter(saved.hits, 0));
    player.dead = false;
    player.respawnIn = 0;
    player.invulnerable = false;

    player.lastHitAt = regenLockRemaining > 0
      ? clock - (SURVIVAL_CONFIG.regenDelay - regenLockRemaining)
      : clock - SURVIVAL_CONFIG.regenDelay - 1;
    return true;
  }

  void eye; void tmp; void damp;

  return {
    player,
    bus,
    fire,
    damageEnemy: applyDamage,
    damageLeg,
    drainLift,
    meleeStrike,
    shockwave,
    explode,
    hurtPlayer,
    raycastEnemies,
    launchEnemyProjectile,
    projectileState,
    clearProjectiles: clearEnemyProjectiles,
    projectileConfig: GLEANER_PROJECTILE_CONFIG,
    update,
    snapshot,
    restore,
    hitbox: HITBOX,
    /** Whether anything can currently be done to a creature at all.
     *  Exposed because "the boss is invulnerable while submerged" is a
     *  claim worth asserting in a test rather than trusting. */
    targetable: (inst) => !untouchable(inst),
    stats() {
      return {
        hp: Math.round(player.hp),
        maxHp: player.maxHp,
        kills: player.kills,
        accuracy: player.shots ? Math.round((player.hits / player.shots) * 100) : 0,
        live: enemies.live.filter((e) => e.state !== "death").length,
      };
    },
  };
}
