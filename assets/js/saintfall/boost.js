/* ============================================================
   SAINTFALL - the reliquary glide

   Shift. Tapped it is a burst; HELD it keeps going, and it steers -
   hold it with A, D or S and the trooper keeps skating that way
   until the charge runs out. Driven forward it is also a weapon:
   contact damages, and anything light enough gets thrown off the
   line.

   The player controller still owns world collision. This module
   owns the envelope, the charge spend, the steering and the contact
   rules, and nothing else.

   It is deliberately NOT a sprint. Sprint was removed - the trooper
   travels at what used to be sprint speed all the time - so this
   key had to become something a player would reach for in a fight
   rather than a tax on crossing open ground.
   ============================================================ */

import { clamp01, damp, dampAngle } from "saintfall/core.js";
import { JETPACK_CONFIG } from "saintfall/jetpack.js";

export const BOOST_CONFIG = Object.freeze({
  /* The minimum a TAP buys. Releasing inside this still gets a whole
     burst, so the verb is never punished for being pressed briefly. */
  burst: 0.30,
  /** Hard ceiling on one held glide, charge notwithstanding. */
  glideMax: 3.2,
  cooldown: 0.5,
  burstSpeed: 27,
  glideSpeed: 19,
  ignitionCost: 9,
  /** Charge per second once the burst is over and the key is held. Drains at the same rate as flight (10.7). */
  holdDrain: JETPACK_CONFIG.burnRate,
  damage: 46,
  /* A held glide is not one attack. The same creature can be caught
     again after this, which is what makes skating through a pack
     read as ploughing rather than as one free hit. */
  damageInterval: 0.42,
  bodyRadius: 0.78,
  sidePush: 1.35,
  knockSpeed: 15,
  /* How far off dead-ahead still counts as ramming. Sideways and
     backward glides are mobility only - being able to kill by
     retreating would make the whole fight one button. */
  forwardThreshold: 0.44,
  steerResponse: 7.0,
});

const HEAVY_KEYS = new Set([
  "harrow", "precentor", "cantor", "matriarch", "coulter",
  "distaff", "winnower", "apostate",
]);

export function buildBoost(ctx, player) {
  const config = BOOST_CONFIG;
  /** inst -> glide-clock time it was last struck. */
  const struck = new Map();
  let endSerial = 0;
  let reportedEndSerial = 0;
  const state = {
    active: false,
    justEnded: false,
    holding: false,
    remaining: 0,
    elapsed: 0,
    cooldownRemaining: 0,
    pose: 0,
    speed: 0,
    directionX: 0,
    directionZ: 1,
    yaw: 0,
    attack: false,
    contactEnabled: false,
    boosts: 0,
    hits: 0,
    lastHits: 0,
    chargeSpent: 0,
    modifierSource: "",
    steerLockRemaining: 0,
    impactModified: false,
    lastReason: "ready",
    /** Metres of ground travel since the last scar was cut. */
    scarDebt: 0,
  };

  function reset(full = true) {
    state.active = false;
    state.justEnded = false;
    state.holding = false;
    state.remaining = 0;
    state.elapsed = 0;
    state.pose = 0;
    state.speed = 0;
    state.attack = false;
    state.contactEnabled = false;
    state.lastHits = 0;
    state.chargeSpent = 0;
    state.modifierSource = "";
    state.steerLockRemaining = 0;
    state.impactModified = false;
    state.lastReason = "ready";
    state.scarDebt = 0;
    struck.clear();
    reportedEndSerial = endSerial;
    if (full) state.cooldownRemaining = 0;
  }

  function stop(reason = "complete") {
    if (!state.active) return;
    ctx.progression?.noteVerb?.("boostEnd", {
      verb: "boostEnd",
      x: player.state.x,
      y: player.state.y,
      z: player.state.z,
      yaw: state.yaw,
      directionX: state.directionX,
      directionZ: state.directionZ,
      attack: state.attack,
      elapsed: state.elapsed,
      reason,
      boostIndex: state.boosts,
    });
    state.active = false;
    state.holding = false;
    state.remaining = 0;
    state.speed = 0;
    state.contactEnabled = false;
    state.steerLockRemaining = 0;
    state.justEnded = true;
    endSerial += 1;
    state.lastReason = reason;
    ctx.audio?.boostCut?.();
  }

  /** Camera-relative move input as a world heading, or null. */
  function headingFrom(mx, my, camYaw) {
    const mag = Math.hypot(mx, my);
    if (mag < 0.08) return null;
    return { yaw: camYaw + Math.atan2(-mx / mag, -my / mag), forward: -my / mag };
  }

  function blocked() {
    const ps = player.state;
    return ps.free || !ps.grounded || ctx.combat?.player?.dead
      || player.action || ctx.mission?.entry?.active
      || ctx.jetpack?.state?.inFlight || ctx.shield?.state?.active
      || ctx.slam?.state?.active;
  }

  /**
   * Ignite. Locked to the current camera-relative movement vector, or
   * to the trooper's own facing when nothing is pressed - a boost
   * that refuses to fire because the stick is centred reads as a dead
   * key, and forward is the only thing it could sensibly mean.
   */
  function trigger(options = {}) {
    const ps = player.state;
    const input = player.input.state;
    const mx = Number.isFinite(options.x) ? options.x : input.move.x;
    const my = Number.isFinite(options.y) ? options.y : input.move.y;

    if (state.active || state.cooldownRemaining > 0) return false;
    if (blocked()) {
      state.lastReason = "blocked";
      return false;
    }

    const heading = headingFrom(mx, my, ps.camYaw);
    const intendedYaw = heading ? heading.yaw : ps.yaw;
    const intendedAttack = heading ? heading.forward >= config.forwardThreshold : true;
    const changed = ctx.progression?.modifyBoostTrigger?.({
      x: mx,
      y: my,
      baseYaw: ps.yaw,
      cameraYaw: ps.camYaw,
      intendedYaw,
      intendedAttack,
      baseIgnitionCost: config.ignitionCost,
      anticipatedBoostIndex: state.boosts + 1,
      playerX: ps.x,
      playerY: ps.y,
      playerZ: ps.z,
    });
    let ignitionCost = config.ignitionCost;
    let yaw = intendedYaw;
    let attack = intendedAttack;
    let contactEnabled = false;
    let modifierSource = "";
    let steerLockSeconds = 0;
    if (changed && typeof changed === "object") {
      const cost = Number(changed.cost);
      if (Number.isFinite(cost)) {
        ignitionCost = Math.max(0, Math.min(config.ignitionCost, cost));
      }
      const changedYaw = Number(changed.yaw);
      if (Number.isFinite(changedYaw)) yaw = changedYaw;
      if (typeof changed.attack === "boolean") attack = changed.attack;
      contactEnabled = changed.contactEnabled === true;
      const steerLock = Number(changed.steerLockSeconds);
      if (Number.isFinite(steerLock)) {
        steerLockSeconds = Math.max(0, Math.min(config.glideMax, steerLock));
      }
      modifierSource = typeof changed.source === "string"
        ? changed.source.slice(0, 48) : "";
    }
    if (ignitionCost > 0 && !ctx.jetpack?.spend?.(ignitionCost, true)) {
      state.lastReason = "low-charge";
      return false;
    }

    state.directionX = Math.sin(yaw);
    state.directionZ = Math.cos(yaw);
    state.yaw = yaw;
    state.attack = attack;
    state.contactEnabled = contactEnabled;
    state.active = true;
    state.holding = true;
    state.justEnded = false;
    state.remaining = config.burst;
    state.elapsed = 0;
    state.cooldownRemaining = 0;
    state.pose = 0.35;
    state.speed = config.burstSpeed;
    state.boosts += 1;
    state.lastHits = 0;
    state.chargeSpent = ignitionCost;
    state.modifierSource = modifierSource;
    state.steerLockRemaining = steerLockSeconds;
    state.impactModified = false;
    state.lastReason = state.attack ? "forward" : "mobility";
    struck.clear();

    ctx.progression?.noteVerb?.("boost", {
      verb: "boost",
      x: ps.x,
      y: ps.y,
      z: ps.z,
      yaw,
      directionX: state.directionX,
      directionZ: state.directionZ,
      attack: state.attack,
      contactEnabled: state.contactEnabled,
      baseIgnitionCost: config.ignitionCost,
      ignitionCost,
      chargeSpent: ignitionCost,
      modifierSource,
      steerLockSeconds,
      boostIndex: state.boosts,
    });
    ctx.audio?.boostIgnite?.(ps.x, ps.z);
    return true;
  }

  /** Called by the player before horizontal movement is resolved. */
  function beginFrame(dt, playerState, inputState) {
    state.justEnded = false;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - dt);

    if (state.active && blocked()) stop("interrupted");
    if (endSerial !== reportedEndSerial) {
      state.justEnded = true;
      reportedEndSerial = endSerial;
    }

    if (!state.active) {
      state.pose = damp(state.pose, 0, 15, dt);
      state.speed = 0;
      state.holding = false;
      return state;
    }

    state.elapsed += dt;
    state.remaining = Math.max(0, state.remaining - dt);

    /* ---- the hold ----
       Past the guaranteed burst, the glide lives entirely off the
       key and the charge. Extending `remaining` rather than running
       on a separate flag keeps one clock for both halves, so a tap
       and a hold cannot disagree about when the thing is over. */
    /* The hold has to be a hold of SOMETHING. Shift with nothing on
       the stick still buys the whole burst - a dash on facing, which
       is what a player pressing it alone means - but it must not
       extend into a stationary glide that quietly burns a third of
       the reliquary while the trooper stands there. */
    const steering = Math.hypot(
      inputState?.move?.x ?? 0, inputState?.move?.y ?? 0) >= 0.08;
    const held = !!(inputState?.boostHeld) && steering;
    state.holding = held;
    if (state.elapsed >= config.burst) {
      if (!held) {
        stop(inputState?.boostHeld ? "no-input" : "released");
      } else if (state.elapsed >= config.glideMax) {
        stop("exhausted");
      } else if (!ctx.jetpack?.spend?.(config.holdDrain * dt, true)) {
        stop("low-charge");
      } else {
        state.remaining = Math.max(state.remaining, dt);
      }
    }
    if (!state.active) {
      state.cooldownRemaining = config.cooldown;
      return state;
    }

    /* ---- steering ----
       A held glide follows the stick. Damped rather than snapped,
       because an instant heading change at nineteen metres a second
       is a teleport sideways; and re-evaluated every frame, which is
       what makes "hold Shift and D" a thing you can hold. */
    const heading = headingFrom(
      inputState?.move?.x ?? 0, inputState?.move?.y ?? 0, playerState.camYaw);
    if (heading && state.elapsed >= config.burst * 0.5 && state.steerLockRemaining <= 0) {
      state.yaw = dampAngle(state.yaw, heading.yaw, config.steerResponse, dt);
      state.directionX = Math.sin(state.yaw);
      state.directionZ = Math.cos(state.yaw);
      state.attack = heading.forward >= config.forwardThreshold;
      state.lastReason = state.attack ? "forward" : "mobility";
    }
    /* Consume the lock after this frame's steering decision. Triggering
       happens after player movement, so decrementing at frame entry would
       make a 0.30s lock protect only 0.20s of actual boosted travel. */
    state.steerLockRemaining = Math.max(0, state.steerLockRemaining - dt);

    /* Hard launch, then a settled skate. The burst delivers most of
       the ground in the first fifth of a second - that is what makes
       it read as a boost - and the hold settles to a speed that can
       be steered and shot from. */
    const launch = clamp01(state.elapsed / config.burst);
    state.speed = state.elapsed < config.burst
      ? config.burstSpeed * (1 - launch * 0.16)
      : damp(state.speed, config.glideSpeed, 6.5, dt);
    state.pose = Math.max(0.42, Math.min(1, 0.55 + Math.sin(launch * Math.PI) * 0.45));

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
   * Resolve armed contacts along the movement collision actually
   * allowed. Ordinary boosts arm only their forward heading; Doctrine
   * may explicitly authorize contact without mislabelling that heading
   * as forward. A creature can be caught again after `damageInterval`,
   * so a long glide through a pack keeps working.
   */
  function noteMotion(fromX, fromZ, toX, toZ, dt = 0) {
    if (!state.active) return 0;
    const travelled = Math.hypot(toX - fromX, toZ - fromZ);
    /* Stopped dead against masonry. A glide that grinds into a wall
       and keeps burning charge is a key that has stopped answering. */
    if (dt > 0 && travelled < state.speed * dt * 0.12) stop("blocked");

    /* The scar the glide cuts, laid by DISTANCE rather than per frame.
       At nineteen metres a second a per-frame mark is a dashed line
       whose dashes get longer as the frame rate drops, so the effect
       would read as stuttering exactly when the machine is struggling.
       Stepping along the segment also keeps it continuous through a
       long frame instead of leaving a gap the length of that frame. */
    if (state.active && player.state.grounded && travelled > 1e-4) {
      const STEP = 0.55;
      state.scarDebt += travelled;
      if (state.scarDebt >= STEP) {
        const yaw = Math.atan2(toX - fromX, toZ - fromZ);
        const bite = clamp01(state.speed / config.glideSpeed);
        let laid = 0;
        while (state.scarDebt >= STEP && laid < 6) {
          state.scarDebt -= STEP;
          const k = 1 - (state.scarDebt / travelled);
          ctx.vfx?.skidMark?.(
            fromX + (toX - fromX) * clamp01(k),
            fromZ + (toZ - fromZ) * clamp01(k),
            yaw, bite, STEP
          );
          laid += 1;
        }
        // A single frame long enough to owe seven marks is a hitch,
        // not a glide; drop the backlog rather than paying it later.
        if (laid >= 6) state.scarDebt = 0;
      }
    }

    if (!(state.attack || state.contactEnabled) || travelled < 1e-5) return 0;

    let hits = 0;
    for (const inst of ctx.enemies.live) {
      if (!inst || inst.state === "death" || inst.emerging?.active) continue;
      if (inst.spec?.flies && !inst.grounded
        && Math.abs(inst.y - player.state.y) > 2.4) continue;
      const last = struck.get(inst);
      if (last !== undefined && state.elapsed - last < config.damageInterval) continue;
      const box = ctx.combat.hitbox[inst.key] || ctx.combat.hitbox.thresher;
      const contact = segmentDistanceSq(inst.x, inst.z, fromX, fromZ, toX, toZ);
      const reach = config.bodyRadius + box.r;
      if (contact.d2 > reach * reach) continue;

      /* Contact obeys the same masonry rule as every other attack.
         This matters at thin pillars, where the body passes one side
         while a large hit capsule reaches around the other. */
      const hitY = inst.y + Math.min(box.y1 * 0.48, 1.35);
      const rayY = Math.max(player.state.y + 0.58, hitY * 0.45 + player.state.y * 0.55);
      const dx = inst.x - contact.qx;
      const dz = inst.z - contact.qz;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-5 && ctx.collide.rayBlock(
        contact.qx, rayY, contact.qz, dx / dist, 0, dz / dist, dist
      ) < dist - 0.04) continue;

      struck.set(inst, state.elapsed);
      const dealt = ctx.combat.damageEnemy(inst, config.damage, {
        source: "boost",
        x: inst.x,
        y: hitY,
        z: inst.z,
        originX: contact.qx,
        originZ: contact.qz,
      });
      if (dealt <= 0) continue;
      const firstImpact = state.lastHits === 0;
      const identity = {
        enemyId: typeof inst.id === "string" ? inst.id : "",
        enemyKey: typeof inst.key === "string" ? inst.key : "unknown",
      };
      const changed = ctx.progression?.modifyBoostImpact?.({
        ...identity,
        enemy: inst,
        firstImpact,
        boostIndex: state.boosts,
        source: state.modifierSource || "boost",
        damage: dealt,
        x: inst.x,
        y: hitY,
        z: inst.z,
        directionX: state.directionX,
        directionZ: state.directionZ,
      });
      const stun = Number(changed?.stun);
      if (Number.isFinite(stun) && stun > 0 && inst.state !== "death") {
        if (ctx.enemies.stun?.(inst, Math.min(4, stun))) state.impactModified = true;
      }
      hits += 1;
      state.hits += 1;
      state.lastHits += 1;

      /* Light castes are THROWN, and thrown along the glide rather
         than merely nudged aside: the read the player wants from
         driving a lance-armed knight through a swarm at nineteen
         metres a second is that the swarm goes flying. */
      if (!HEAVY_KEYS.has(inst.key)) {
        const rightX = state.directionZ;
        const rightZ = -state.directionX;
        const side = ((inst.x - contact.qx) * rightX
          + (inst.z - contact.qz) * rightZ) >= 0 ? 1 : -1;
        const ux = state.directionX * 0.72 + rightX * side * 0.69;
        const uz = state.directionZ * 0.72 + rightZ * side * 0.69;
        if (!ctx.enemies.knockback?.(inst, ux, uz, config.knockSpeed)) {
          const wantX = inst.x + rightX * side * config.sidePush;
          const wantZ = inst.z + rightZ * side * config.sidePush;
          const radius = Math.max(0.34, (inst.spec?.collisionRadius || box.r) * 0.78);
          const out = ctx.collide.slide(inst.x, inst.z, wantX, wantZ, null, radius);
          inst.x = out[0];
          inst.z = out[1];
          inst.root?.position?.set(inst.x, inst.y, inst.z);
        }
      }

      ctx.vfx?.boostImpact?.(inst.x, hitY, inst.z,
        state.directionX, state.directionZ, HEAVY_KEYS.has(inst.key));
      ctx.audio?.boostHit?.(inst.x, inst.z, HEAVY_KEYS.has(inst.key));
    }
    return hits;
  }

  function status() {
    return {
      active: state.active,
      justEnded: state.justEnded,
      holding: state.holding,
      attack: state.attack,
      contactEnabled: state.contactEnabled,
      mode: state.active ? (state.attack ? "attack" : "mobility")
        : state.cooldownRemaining > 0 ? "cooldown" : "ready",
      remaining: Number(state.remaining.toFixed(3)),
      elapsed: Number(state.elapsed.toFixed(3)),
      cooldownRemaining: Number(state.cooldownRemaining.toFixed(3)),
      pose: Number(state.pose.toFixed(3)),
      speed: Number(state.speed.toFixed(3)),
      yaw: Number(state.yaw.toFixed(4)),
      direction: [Number(state.directionX.toFixed(4)), Number(state.directionZ.toFixed(4))],
      boosts: state.boosts,
      hits: state.hits,
      lastHits: state.lastHits,
      chargeSpent: Number(state.chargeSpent.toFixed(3)),
      modifierSource: state.modifierSource,
      steerLockRemaining: Number(state.steerLockRemaining.toFixed(3)),
      impactModified: state.impactModified,
      lastReason: state.lastReason,
      fuelCost: config.ignitionCost,
    };
  }

  function restore(saved = {}) {
    reset(true);
    state.cooldownRemaining = Math.max(0,
      Math.min(config.cooldown, Number(saved.cooldownRemaining) || 0));
    state.boosts = Math.max(0, Math.round(Number(saved.boosts) || 0));
    state.hits = Math.max(0, Math.round(Number(saved.hits) || 0));
    state.lastReason = "restored";
    return status();
  }

  return { config, state, trigger, beginFrame, noteMotion, reset, stop, status, restore };
}
