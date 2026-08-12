/* ============================================================
   SAINTFALL - THE PENITENT'S FALL

   Q, in the air. The trooper stops dead, brings the censer-lance
   overhead, and then drives it into the ground hard enough to put
   everything nearby on the floor.

   Three beats, and the pause is the whole feel of it: HANG (the
   body arrests mid-air and the lance charges), PLUNGE (straight
   down, faster than gravity would ever manage), IMPACT (a ring, and
   everything inside it stunned).

   The hang exists because a slam with no wind-up is indistinguishable
   from falling. A quarter of a second of hanging still, with the
   charge building, is what tells the player - and everything under
   them - what is about to happen.

   This module owns the envelope, the charge spend and the strike.
   The player controller still owns vertical collision; it asks this
   for a vertical speed and reports back when the ground arrives.
   ============================================================ */

import { clamp01, damp } from "saintfall/core.js";

export const SLAM_CONFIG = Object.freeze({
  /** Hang time: the body arrests and the lance charges. */
  charge: 0.26,
  /** Straight down, and much faster than terminal fall (20). */
  plungeSpeed: 46,
  /** Below this off the deck there is no room for the beat to read. */
  minHeight: 1.5,
  /** Lockout after landing, so it cannot be chained into itself. */
  recover: 0.42,
  cooldown: 1.15,
  fuelCost: 20,
  /** The strike. */
  radius: 8.0,
  innerRadius: 3.2,
  damage: 190,
  /** Damage at the rim, as a fraction of the centre. */
  edgeFalloff: 0.42,
  stun: 2.4,
  knockSpeed: 18,
  /** A slight rise during the hang reads as "gathering", not "stalling". */
  hangRise: 1.6,
});

export function buildSlam(ctx, player) {
  const config = SLAM_CONFIG;
  const state = {
    active: false,
    justEnded: false,
    phase: "ready",
    elapsed: 0,
    charge: 0,
    pose: 0,
    /* Signed body pitch, in radians, for the figure to lean by. The
       gather goes BACK and the fall goes forward, and one unsigned
       `pose` cannot say which - so the attitude is authored here,
       where the phase is known, rather than reconstructed downstream
       from a phase string. */
    lean: 0,
    verticalSpeed: 0,
    recoverRemaining: 0,
    cooldownRemaining: 0,
    startY: 0,
    fallen: 0,
    slams: 0,
    hits: 0,
    stunned: 0,
    kills: 0,
    lastHits: 0,
    lastReason: "ready",
  };

  function reset(full = true) {
    state.active = false;
    state.justEnded = false;
    state.phase = "ready";
    state.elapsed = 0;
    state.charge = 0;
    state.pose = 0;
    state.lean = 0;
    state.verticalSpeed = 0;
    state.recoverRemaining = 0;
    state.fallen = 0;
    state.lastHits = 0;
    state.lastReason = "ready";
    if (full) state.cooldownRemaining = 0;
  }

  /** How far the body is above the ground it would land on. */
  function altitude() {
    const ps = player.state;
    const gy = ctx.collide?.groundHeight
      ? ctx.collide.groundHeight(ps.x, ps.z)
      : (ctx.terrain?.heightAt?.(ps.x, ps.z) ?? 0);
    return ps.y - gy;
  }

  /**
   * Commit to the fall. Airborne only - on the ground Q is still the
   * melee swing, and routing that is main.js's job rather than this
   * module's.
   */
  function trigger() {
    const ps = player.state;
    if (state.active || state.cooldownRemaining > 0) return false;
    if (ps.free || ctx.combat?.player?.dead || ctx.mission?.entry?.active
      || ctx.shield?.state?.active) {
      state.lastReason = "blocked";
      return false;
    }
    if (ps.grounded) {
      state.lastReason = "grounded";
      return false;
    }
    if (altitude() < config.minHeight) {
      state.lastReason = "too-low";
      return false;
    }
    /* Charged from the same reliquary as the pack and the glide.
       Drawn as a GROUND spend so the post-flight lockout - which is
       about relighting the pack, not about this - cannot refuse it
       one frame after the player left the ground; and as an AIRBORNE
       spend because this is committed to mid-flight, which the pack
       otherwise treats as someone siphoning the tank it is burning. */
    if (!ctx.jetpack?.spend?.(config.fuelCost, true, true)) {
      state.lastReason = "low-charge";
      return false;
    }

    state.active = true;
    state.justEnded = false;
    state.phase = "hang";
    state.elapsed = 0;
    state.charge = 0;
    state.startY = ps.y;
    state.fallen = 0;
    state.slams += 1;
    state.lastHits = 0;
    state.lastReason = "hang";
    ctx.vfx?.slamCharge?.(ps.x, ps.y, ps.z, 0);
    ctx.audio?.slamCharge?.(ps.x, ps.z);
    return true;
  }

  /** Called by the player before vertical motion is resolved. */
  function beginFrame(dt) {
    state.justEnded = false;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - dt);
    if (state.recoverRemaining > 0) {
      state.recoverRemaining = Math.max(0, state.recoverRemaining - dt);
      state.pose = damp(state.pose, 0, 9, dt);
      state.lean = damp(state.lean, 0, 8, dt);
      if (state.recoverRemaining <= 0) state.phase = "ready";
      return state;
    }
    if (!state.active) {
      state.pose = damp(state.pose, 0, 12, dt);
      state.charge = damp(state.charge, 0, 12, dt);
      state.lean = damp(state.lean, 0, 12, dt);
      state.verticalSpeed = 0;
      return state;
    }

    const ps = player.state;
    if (ps.free || ctx.combat?.player?.dead) {
      abort("interrupted");
      return state;
    }

    state.elapsed += dt;
    if (state.phase === "hang") {
      state.charge = clamp01(state.elapsed / config.charge);
      /* Held, not falling. A rise this small is not a jump - it is
         the body gathering before it goes - and it is the difference
         between a deliberate attack and a dropped ragdoll. */
      state.verticalSpeed = config.hangRise * (1 - state.charge);
      state.pose = damp(state.pose, 0.55 + state.charge * 0.45, 14, dt);
      // Arched back over the raised lance.
      state.lean = damp(state.lean, -0.38, 13, dt);
      ctx.vfx?.slamCharge?.(ps.x, ps.y, ps.z, state.charge);
      if (state.elapsed >= config.charge) {
        state.phase = "plunge";
        state.charge = 1;
        /* Set here as well as in the plunge branch below: the frame
           that COMMITS is already a falling frame. Leaving it at the
           hang's terminal zero spent one frame hanging motionless
           after the wind-up had visibly finished, which reads as a
           hitch in the one attack that is supposed to snap. */
        state.verticalSpeed = -config.plungeSpeed;
        state.lastReason = "plunge";
        ctx.audio?.slamPlunge?.(ps.x, ps.z);
      }
    } else if (state.phase === "plunge") {
      state.verticalSpeed = -config.plungeSpeed;
      state.pose = damp(state.pose, 1, 20, dt);
      /* Thrown forward and over, so the lance leads the body down.
         Snapped harder than the gather - the whole point of the beat
         before it is that this part is sudden. */
      state.lean = damp(state.lean, 0.98, 22, dt);
      state.fallen = Math.max(0, state.startY - ps.y);
      ctx.vfx?.slamTrail?.(ps.x, ps.y, ps.z);
      /* A plunge that never finds ground - walked off the map edge,
         or a collision case nobody thought of - must not lock the
         player into a permanent dive. */
      if (state.elapsed > config.charge + 4.0) abort("no-ground");
    }
    return state;
  }

  function abort(reason = "interrupted") {
    if (!state.active) return false;
    state.active = false;
    state.justEnded = true;
    state.phase = "ready";
    state.verticalSpeed = 0;
    state.charge = 0;
    state.recoverRemaining = 0;
    state.cooldownRemaining = Math.max(state.cooldownRemaining, 0.35);
    state.lastReason = reason;
    return true;
  }

  /**
   * The ground arrived. Called by the player controller on the frame
   * the capsule touches down while a plunge is running.
   */
  function impact() {
    if (!state.active) return null;
    const ps = player.state;
    state.active = false;
    state.justEnded = true;
    state.phase = "recover";
    state.recoverRemaining = config.recover;
    state.cooldownRemaining = config.cooldown;
    state.verticalSpeed = 0;
    state.charge = 0;
    state.lastReason = "impact";

    /* Reach scales a little with how far it fell, so a slam off the
       top of a jetpack climb is worth the climb. Capped, because the
       map has 40m drops in it and a 20m shockwave is not a melee. */
    const drop = clamp01(state.fallen / 14);
    const radius = config.radius * (1 + drop * 0.28);
    const result = ctx.combat?.shockwave?.(ps.x, ps.y, ps.z, {
      radius,
      innerRadius: config.innerRadius,
      damage: config.damage * (1 + drop * 0.22),
      edgeFalloff: config.edgeFalloff,
      stun: config.stun,
      knockSpeed: config.knockSpeed,
      source: "slam",
    }) || { hits: 0, kills: 0, stunned: 0 };

    state.hits += result.hits;
    state.kills += result.kills || 0;
    state.stunned += result.stunned || 0;
    state.lastHits = result.hits;

    ctx.vfx?.slamImpact?.(ps.x, ps.y, ps.z, radius, result.hits);
    ctx.audio?.slamImpact?.(ps.x, ps.z, drop);
    /* Punched hard, and downward-biased: this is the one attack in
       the game where the camera should feel the floor. */
    player.punch?.(2.2 + drop * 0.8);
    return { ...result, radius };
  }

  function status() {
    return {
      active: state.active,
      justEnded: state.justEnded,
      phase: state.phase,
      charge: Number(state.charge.toFixed(3)),
      pose: Number(state.pose.toFixed(3)),
      lean: Number(state.lean.toFixed(4)),
      verticalSpeed: Number(state.verticalSpeed.toFixed(3)),
      elapsed: Number(state.elapsed.toFixed(3)),
      fallen: Number(state.fallen.toFixed(2)),
      recoverRemaining: Number(state.recoverRemaining.toFixed(3)),
      cooldownRemaining: Number(state.cooldownRemaining.toFixed(3)),
      slams: state.slams,
      hits: state.hits,
      kills: state.kills,
      stunned: state.stunned,
      lastHits: state.lastHits,
      lastReason: state.lastReason,
      fuelCost: config.fuelCost,
      radius: config.radius,
    };
  }

  function restore(saved = {}) {
    reset(true);
    state.cooldownRemaining = Math.max(0,
      Math.min(config.cooldown, Number(saved.cooldownRemaining) || 0));
    state.slams = Math.max(0, Math.round(Number(saved.slams) || 0));
    state.hits = Math.max(0, Math.round(Number(saved.hits) || 0));
    state.lastReason = "restored";
    return status();
  }

  return {
    config, state, trigger, beginFrame, impact, abort, reset, status, restore,
    altitude,
  };
}
