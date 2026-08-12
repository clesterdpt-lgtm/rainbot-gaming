/* ============================================================
   SAINTFALL - combat

   Hitscan fire, damage, enemy behaviour, and the player's own
   health. Everything here is deliberately readable rather than
   physical: a shot is a ray, a hit is a capsule test, and an enemy
   decides what to do from four numbers.

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
  reachMultiplier: 1.18,
  lightEnemy: "thresher",
  lightKnockbackSpeed: 16,
  hitSparkScale: 2.10,
  hitPunch: 1.05,
  whiffPunch: 0.24,
  slamPunch: 1.35,
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
    profile: [1.10, 1.28, 1.36, 1.34, 1.28, 1.20, 1.10, 0.99,
      0.87, 0.74, 0.60, 0.44, 0.27, 0.12],
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
};

const SPEC = {
  thresher: {
    hp: 60, damage: 14, reach: 2.6, cadence: 1.15,
    sight: 78, hearing: 26, aggro: 130,
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
    hp: 5200, damage: 56, reach: 9.4, cadence: 2.05,
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
    };
    const result = ctx.progression?.modifyEnemyDamage?.(request);
    const resultDamage = Number(result?.damage);
    const candidate = Number.isFinite(result)
      ? result
      : Number.isFinite(resultDamage) ? resultDamage : requested;
    return Math.max(0, candidate);
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
    out.copy(body.head).addScaledVector(body.dir, maw.forward);
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
      const r = box.maw.r;
      if (along > 0 && perpSq <= r * r) {
        const entry = Math.max(0, along - Math.sqrt(Math.max(0, r * r - perpSq)));
        if (entry <= bestT) { bestT = entry; weak = true; found = true; }
      }
    }

    _bodyA.copy(body.head);
    for (let i = 0; i < body.joints.length; i += 1) {
      _bodyB.copy(body.joints[i]);
      const radius = (jointRadius(box, i) + jointRadius(box, i + 1)) * 0.5;
      const t = segmentHit(ox, oy, oz, dx, dy, dz, _bodyA, _bodyB, radius);
      if (t >= 0 && t < bestT) { bestT = t; weak = false; found = true; }
      _bodyA.copy(_bodyB);
    }
    if (!found) return null;
    return { t: bestT, weak };
  }

  /** The nearest point on a creature to a world position, and how far.
   *  A point test against a 25m animal's origin is a test against its
   *  mouth, which would let a stratagem land on its back for nothing. */
  function nearestBodyPoint(inst, x, z, out) {
    const body = inst.body;
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

  /** Under the sand, and therefore not there. Every damage path in
   *  this file asks, because a boss that can be shot through a planet
   *  has no submerged phase at all. */
  const untouchable = (inst) => inst.state === "death"
    || !!inst.emerging?.active || !!inst.body?.hidden;

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
        ? ((box.weak && box.weak.mult) || (box.maw && box.maw.mult) || 3)
        : 1;
      const dmg = damage * (hit.head ? 2.6 : 1) * weakMult;
      // `head` means headshot, and only that. A weak-point hit rides
      // in the event below instead of being folded in here, so that
      // anything reading the kill feed can tell the two apart.
      const dealt = applyDamage(hit.inst, dmg, {
        source: "shot",
        head: hit.head,
        weak: !!hit.weak,
        x: hit.x,
        y: hit.y,
        z: hit.z,
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
      /* Measured to the NEAREST part of the animal, which for
         everything with a single capsule is its own centre and for a
         chained body is whichever coil is in front of the player. A
         lance swing at the twenty metres of Coulter lying across the
         sand has to connect with the twenty metres of Coulter. */
      const near = nearestBodyPoint(inst, ps.x, ps.z, _bodyNear);
      const dx = _bodyNear.x - ps.x;
      const dz = _bodyNear.z - ps.z;
      const dist = Math.max(near, 1e-4);
      const box = HITBOX[inst.key] || HITBOX.thresher;
      if (dist > reach + box.r) continue;
      let rel = Math.atan2(dx, dz) - ps.yaw;
      while (rel > Math.PI) rel -= TAU;
      while (rel < -Math.PI) rel += TAU;
      if (Math.abs(rel) > arc * 0.5) continue;
      const inv = 1 / Math.max(1e-4, dist);
      if (collide.rayBlock(ps.x, eyeY, ps.z, dx * inv, 0, dz * inv, dist) < dist) continue;
      const wasAlive = inst.state !== "death";
      /* Threshers are the light swarm caste. A clean polearm connection
         always removes one, even if an authored encounter spawned it with a
         little bonus health; larger castes retain their normal balance. */
      const strikeDamage = inst.key === MELEE_CONFIG.lightEnemy
        ? Math.max(dmg, inst.health)
        : dmg;
      const dealt = applyDamage(inst, strikeDamage, {
        source: "melee",
        x: inst.x,
        y: inst.y + box.y1 * 0.55,
        z: inst.z,
      });
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
        weak: false,
        damage: dealt,
        killed,
        x: inst.x,
        y: inst.y + box.y1 * 0.55,
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
        vfx.spark(inst.x, inst.y + box.y1 * 0.55, inst.z,
          MELEE_CONFIG.hitSparkScale * (slam ? 1.18 : 1), false, true);
      }
    }
    if (vfx && vfx.meleeArc) {
      vfx.meleeArc(ps.x, ps.y, ps.z, ps.yaw, reach, arc, hits, slam);
    }
    ctx.player.punch?.(slam
      ? MELEE_CONFIG.slamPunch
      : hits ? MELEE_CONFIG.hitPunch : MELEE_CONFIG.whiffPunch);
    const step = Number.isInteger(comboStep) && comboStep >= 1 && comboStep <= 3
      ? comboStep : 0;
    const meleeEvent = {
      source: "melee",
      comboStep: step,
      targets,
      hits,
      kills,
      knockbacks,
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
      const dist = Math.max(nearestBodyPoint(inst, x, z, _bodyNear), 1e-4);
      const dx = _bodyNear.x - x;
      const dz = _bodyNear.z - z;
      const box = HITBOX[inst.key] || HITBOX.thresher;
      if (dist > radius + box.r) continue;
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

     Four states, and the transitions between them are all distance
     and line-of-sight. There is no planner and no navmesh: this
     level is open ground, and an enemy that walks toward you while
     refusing to walk through walls is indistinguishable from one
     that pathfinds, right up until it meets a courtyard.
     ============================================================ */

  function canSee(inst, px, py, pz) {
    const dx = px - inst.x;
    const dz = pz - inst.z;
    const horizontal = Math.hypot(dx, dz);
    const spec = SPEC[inst.key] || SPEC.thresher;
    if (horizontal > spec.sight) return false;

    const box = HITBOX[inst.key] || HITBOX.thresher;
    const ey = inst.y + box.head;
    const dy = py - ey;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-4) return true;
    return collide.rayBlock(inst.x, ey, inst.z,
      dx / distance, dy / distance, dz / distance, distance) >= distance;
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
    /* A CHAINED BODY IS SOMEBODY ELSE'S DECISION.
       Everything below this line assumes a creature that stands on the
       ground, walks toward the player and is always hittable, and the
       burrower is none of those. coulter.js runs its own loop over its
       own instances - see main.js's step order - so the only correct
       thing to do here is decline: the alternative is this function
       growing a second state machine inside the first. */
    if (inst.body) return;
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
          approach(inst, lx / ld, lz / ld,
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
    else inst.suspicion = Math.max(0, inst.suspicion - dt * 0.16);

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
        approach(inst, hx / hd, hz / hd, inst.spec.speed.walk * 0.45, dt);
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

    const ux = dist > 1e-4 ? dx / dist : 0;
    const uz = dist > 1e-4 ? dz / dist : 0;
    const speed = spec.reach > 8 ? inst.spec.speed.walk : inst.spec.speed.charge;
    approach(inst, ux, uz, speed, dt);
    if (inst.state !== "alert") enemies.play(inst, "alert", 0.24);
  }

  function approach(inst, ux, uz, speed, dt) {
    const step = speed * dt;
    const nx = inst.x + ux * step;
    const nz = inst.z + uz * step;
    const r = (HITBOX[inst.key] || HITBOX.thresher).r;
    // Enemies are grounded walkers too. Candidate-ground collision
    // prevents the same downhill stale-Y penetration that used to
    // trap the player; their larger capsule radius is preserved.
    const out = collide.slide(inst.x, inst.z, nx, nz, null, r * 0.8);
    inst.x = out[0];
    inst.z = out[1];
    inst.speed = Math.hypot(out[0] - (nx - ux * step), out[1] - (nz - uz * step)) / Math.max(dt, 1e-4);
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
    // Machines miss; a charging xeno at arm's length does not.
    const accuracy = spec.burst ? 0.55 : 1;
    const landed = Math.random() < accuracy;
    const incoming = spec.damage * SURVIVAL_CONFIG.enemyDamageMultiplier
      * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1);
    if (landed) hurtPlayer(incoming, {
      source: spec.burst ? "enemy-fire" : "enemy-melee",
      x: inst.x,
      y: inst.y + (HITBOX[inst.key] || HITBOX.thresher).head,
      z: inst.z,
      enemy: inst.key,
      enemyId: inst.id,
      enemyKey: inst.key,
    });

    /* Return fire gets a bolt too. Not decoration for its own sake:
       with the player's shots now visible and the garrison's not, a
       firefight looked one-sided in the wrong way - damage arriving
       from nowhere, with no direction to turn toward. A miss is
       thrown wide so the near miss is the thing you see. */
    if (spec.burst && vfx && vfx.tracer) {
      const box = HITBOX[inst.key] || HITBOX.thresher;
      const ps = ctx.player.state;
      muzzleAt(inst, box, _muzzle);
      const ox = _muzzle.x;
      const oy = _muzzle.y;
      const oz = _muzzle.z;
      let tx = ps.x - ox;
      let ty = ps.y + 1.15 - oy;
      let tz = ps.z - oz;
      const d = Math.hypot(tx, ty, tz) || 1;
      tx /= d; ty /= d; tz /= d;
      if (!landed) {
        tx += (Math.random() - 0.5) * 0.09;
        ty += (Math.random() - 0.5) * 0.06;
        tz += (Math.random() - 0.5) * 0.09;
        const n = Math.hypot(tx, ty, tz) || 1;
        tx /= n; ty /= n; tz /= n;
      }
      const blocked = collide.rayBlock(ox, oy, oz, tx, ty, tz, d);
      vfx.tracer(ox, oy, oz, tx, ty, tz, Math.min(d, blocked), 0.055, false);
      if (vfx.muzzle) vfx.muzzle(ox, oy, oz, tx, ty, tz, 0.75, false);
    }
  }

  /* ============================================================
     UPDATE
     ============================================================ */

  function update(dt) {
    clock += dt;
    const ps = ctx.player.state;

    if (player.dead) {
      player.respawnIn -= dt;
      if (player.respawnIn <= 0) respawn();
      return;
    }

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
      if (inst.state === "death" && clock - (inst.diedAt || 0) > 26) {
        enemies.group.remove(inst.root);
        enemies.live.splice(i, 1);
      }
    }
  }

  function respawn() {
    player.dead = false;
    player.hp = player.maxHp;
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
    meleeStrike,
    shockwave,
    explode,
    hurtPlayer,
    raycastEnemies,
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
