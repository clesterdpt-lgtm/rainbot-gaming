/* ============================================================
   SAINTFALL - reliquary boost slide

   A short, grounded burst in the direction the player is already
   moving. The player controller still owns world collision; this
   module owns the boost envelope, charge spend, contact damage and
   the light-enemy deflection rule.
   ============================================================ */

import { clamp01, damp } from "saintfall/core.js";

export const BOOST_CONFIG = Object.freeze({
  duration: 0.28,
  cooldown: 1.05,
  speed: 24,
  fuelCost: 16,
  damage: 52,
  bodyRadius: 0.72,
  sidePush: 1.35,
  forwardThreshold: 0.44,
});

const HEAVY_KEYS = new Set(["harrow", "matriarch"]);

export function buildBoost(ctx, player) {
  const config = BOOST_CONFIG;
  const struck = new Set();
  let endSerial = 0;
  let reportedEndSerial = 0;
  const state = {
    active: false,
    justEnded: false,
    remaining: 0,
    cooldownRemaining: 0,
    pose: 0,
    speed: 0,
    directionX: 0,
    directionZ: 1,
    yaw: 0,
    attack: false,
    boosts: 0,
    hits: 0,
    lastHits: 0,
    lastReason: "ready",
  };

  function reset(full = true) {
    state.active = false;
    state.justEnded = false;
    state.remaining = 0;
    state.pose = 0;
    state.speed = 0;
    state.attack = false;
    state.lastHits = 0;
    state.lastReason = "ready";
    struck.clear();
    reportedEndSerial = endSerial;
    if (full) state.cooldownRemaining = 0;
  }

  function stop(reason = "complete") {
    if (!state.active) return;
    state.active = false;
    state.remaining = 0;
    state.speed = 0;
    state.justEnded = true;
    endSerial += 1;
    state.lastReason = reason;
  }

  /**
   * Lock a boost to the current camera-relative movement vector.
   * Pure side/back boosts are mobility only; W and forward diagonals
   * cross the attack threshold and can strike enemies.
   */
  function trigger(options = {}) {
    const ps = player.state;
    const input = player.input.state;
    const mx = Number.isFinite(options.x) ? options.x : input.move.x;
    const my = Number.isFinite(options.y) ? options.y : input.move.y;
    const mag = Math.hypot(mx, my);

    if (state.active || state.cooldownRemaining > 0) return false;
    if (mag < 0.08) {
      state.lastReason = "no-direction";
      return false;
    }
    if (ps.free || !ps.grounded || ctx.combat?.player?.dead
      || player.action || ctx.mission?.entry?.active || ctx.jetpack?.state?.inFlight
      || ctx.shield?.state?.active) {
      state.lastReason = "blocked";
      return false;
    }
    if (!ctx.jetpack?.spend?.(config.fuelCost)) {
      state.lastReason = "low-charge";
      return false;
    }

    const nx = mx / mag;
    const ny = my / mag;
    const yaw = ps.camYaw + Math.atan2(-nx, -ny);
    state.directionX = Math.sin(yaw);
    state.directionZ = Math.cos(yaw);
    state.yaw = yaw;
    state.attack = (-ny) >= config.forwardThreshold;
    state.active = true;
    state.justEnded = false;
    state.remaining = config.duration;
    state.cooldownRemaining = config.cooldown;
    state.pose = 0.35;
    state.speed = config.speed;
    state.boosts += 1;
    state.lastHits = 0;
    state.lastReason = state.attack ? "forward" : "mobility";
    struck.clear();

    /* The ordinary jet flame is authored for vertical flight. A short
       sand-level ignition spark reads correctly from every boost angle
       without turning the folded wing pack into a sideways rocket. */
    ctx.vfx?.spark?.(
      ps.x - state.directionX * 0.42,
      ps.y + 0.30,
      ps.z - state.directionZ * 0.42,
      0.92
    );
    return true;
  }

  /** Called by the player before horizontal movement is resolved. */
  function beginFrame(dt) {
    state.justEnded = false;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - dt);

    if (state.active && (
      player.state.free || !player.state.grounded || ctx.combat?.player?.dead
      || player.action || ctx.jetpack?.state?.inFlight || ctx.shield?.state?.active
    )) stop("interrupted");
    if (state.active && state.remaining <= 0) stop("complete");
    if (endSerial !== reportedEndSerial) {
      state.justEnded = true;
      reportedEndSerial = endSerial;
    }

    if (!state.active) {
      state.pose = damp(state.pose, 0, 15, dt);
      state.speed = 0;
      return state;
    }

    const progress = clamp01(1 - state.remaining / config.duration);
    /* Hard launch, slight taper. Most of the distance is delivered in
       the first two tenths, which is what makes this read as a boost
       rather than as a temporary sprint multiplier. */
    state.speed = config.speed * (1 - progress * 0.18);
    state.pose = Math.max(0.35, Math.sin(progress * Math.PI));
    state.remaining = Math.max(0, state.remaining - dt);
    if (state.remaining <= 0) state.lastReason = "complete";
    return state;
  }

  /** Squared distance from a point to an XZ line segment. */
  function segmentDistanceSq(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > 1e-8
      ? clamp01(((px - ax) * dx + (pz - az) * dz) / lenSq)
      : 0;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    return { d2: (px - qx) ** 2 + (pz - qz) ** 2, qx, qz };
  }

  /**
   * Resolve forward-boost contacts along the movement that collision
   * actually allowed. Each creature can be hit once per ignition.
   */
  function noteMotion(fromX, fromZ, toX, toZ, dt = 0) {
    if (!state.active) return 0;
    const travelled = Math.hypot(toX - fromX, toZ - fromZ);
    if (dt > 0 && travelled < state.speed * dt * 0.12) {
      stop("blocked");
    }
    if (!state.attack || travelled < 1e-5) return 0;

    let hits = 0;
    for (const inst of ctx.enemies.live) {
      if (!inst || inst.state === "death" || struck.has(inst)) continue;
      const box = ctx.combat.hitbox[inst.key] || ctx.combat.hitbox.thresher;
      const contact = segmentDistanceSq(inst.x, inst.z, fromX, fromZ, toX, toZ);
      const reach = config.bodyRadius + box.r;
      if (contact.d2 > reach * reach) continue;

      /* Contact damage obeys the same masonry rule as every other
         attack. This matters at thin pillars, where the body can pass
         on one side while a large hit capsule reaches around the other. */
      const hitY = inst.y + Math.min(box.y1 * 0.48, 1.35);
      const rayY = Math.max(player.state.y + 0.58, hitY * 0.45 + player.state.y * 0.55);
      const dx = inst.x - contact.qx;
      const dz = inst.z - contact.qz;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-5 && ctx.collide.rayBlock(
        contact.qx, rayY, contact.qz, dx / dist, 0, dz / dist, dist
      ) < dist - 0.04) continue;

      struck.add(inst);
      const dealt = ctx.combat.damageEnemy(inst, config.damage, {
        source: "boost",
        x: inst.x,
        y: hitY,
        z: inst.z,
      });
      if (dealt <= 0) continue;
      hits += 1;
      state.hits += 1;
      state.lastHits += 1;

      if (!HEAVY_KEYS.has(inst.key)) {
        const rightX = state.directionZ;
        const rightZ = -state.directionX;
        const side = ((inst.x - contact.qx) * rightX
          + (inst.z - contact.qz) * rightZ) >= 0 ? 1 : -1;
        const wantX = inst.x + rightX * side * config.sidePush;
        const wantZ = inst.z + rightZ * side * config.sidePush;
        const radius = Math.max(0.34, (inst.spec?.collisionRadius || box.r) * 0.78);
        const out = ctx.collide.slide(inst.x, inst.z, wantX, wantZ, null, radius);
        inst.x = out[0];
        inst.z = out[1];
        inst.root?.position?.set(inst.x, inst.y, inst.z);
      }

      ctx.vfx?.spark?.(inst.x, hitY, inst.z, HEAVY_KEYS.has(inst.key) ? 1.45 : 1.12);
    }
    return hits;
  }

  function status() {
    return {
      active: state.active,
      justEnded: state.justEnded,
      attack: state.attack,
      mode: state.active ? (state.attack ? "attack" : "mobility")
        : state.cooldownRemaining > 0 ? "cooldown" : "ready",
      remaining: Number(state.remaining.toFixed(3)),
      cooldownRemaining: Number(state.cooldownRemaining.toFixed(3)),
      pose: Number(state.pose.toFixed(3)),
      speed: Number(state.speed.toFixed(3)),
      direction: [Number(state.directionX.toFixed(4)), Number(state.directionZ.toFixed(4))],
      boosts: state.boosts,
      hits: state.hits,
      lastHits: state.lastHits,
      lastReason: state.lastReason,
      fuelCost: config.fuelCost,
    };
  }

  return { config, state, trigger, beginFrame, noteMotion, reset, stop, status };
}
