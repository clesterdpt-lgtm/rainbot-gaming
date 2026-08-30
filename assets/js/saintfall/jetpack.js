/* ============================================================
   SAINTFALL - Reliquary vector jetpack

   A finite traversal tool, not free flight. The player controller
   owns movement and collision; this module owns charge, state,
   presentation and the small public contract used by the HUD/QA.
   ============================================================ */

import { clamp, clamp01, damp, lerp } from "saintfall/core.js";
import { keybindDown } from "saintfall/keybinds.js";
import { buildPackFor } from "saintfall/jetpacks.js";

/* How much fold-to-powered travel a plate needs before its live
   angle is treated as a statement about how far the pack has
   deployed. Below this the ratio is dominated by its own decoration
   rather than by the deployment - see `slowestProgress`. */
const PROGRESS_RANGE_MIN = 0.20;

export const JETPACK_CONFIG = Object.freeze({
  maxFuel: 100,
  ignitionCost: 5,
  minIgnitionFuel: 10,
  /* 16 -> 10.7, which is 50% MORE GROUND per tank rather than 50%
     more speed. The two are not the same request and only one of
     them is what a traversal tool is for: raising `cruiseSpeed`
     would cover more distance per second and still strand the
     player in the same place, because the tank is what runs out.
     Burning slower makes the same 95 usable units last 8.9s instead
     of 5.93, and the gauge still reads 0-100 so nothing in the HUD
     or the recharge maths has to know. */
  burnRate: 10.7,
  rechargeDelay: 2.5,
  depletedDelay: 4.0,
  rechargeRate: 10,
  cruiseSpeed: 30,
  glideSpeed: 13,
  acceleration: 20,
  glideDrag: 5.5,
  cruiseAltitude: 7.0,
  softAltitude: 8.0,
  maxAltitude: 10.0,
  maxRiseFromLaunch: 12.0,
  climbSpeed: 9.0,
  descendSpeed: 11.0,
  gravity: 14.0,
  terminalFall: 20.0,
  sweepStep: 0.20,
});

function buildExhaust(ctx) {
  const { THREE } = ctx;
  const COUNT = 112;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const ages = new Float32Array(COUNT);
  const lives = new Float32Array(COUNT);
  const velocities = new Float32Array(COUNT * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    name: "jetpack-exhaust",
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(72.0 / max(1.0, -mv.z), 2.0, 13.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        // A cinder: hot point, short halo - not a soft disc.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r2 = dot(d, d);
        float a = exp(-r2 * 24.0) * 1.1 + pow(1.0 - smoothstep(0.0, 0.5, sqrt(r2)), 3.0) * 0.4;
        a = clamp(a, 0.0, 1.0);
        if (a <= 0.01) discard;
        gl_FragColor = vec4(vColor * 1.45 * a, a * 0.8);
      }
    `,
  });
  const points = new THREE.Points(geo, material);
  points.name = "jetpack-exhaust-pool";
  points.frustumCulled = false;
  /* Dynamic positions begin parked far below the world. Supplying the
     known pool envelope prevents Three from recomputing a sphere in
     the middle of a partial attribute update. */
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12000);
  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3 + 1] = -9999;
    colors[i * 3] = 1.0;
    colors[i * 3 + 1] = 0.72;
    colors[i * 3 + 2] = 0.24;
  }
  (ctx.vfx?.group || ctx.scene).add(points);
  return { COUNT, points, geo, positions, colors, ages, lives, velocities, cursor: 0, alive: 0 };
}

export function buildJetpack(ctx, player, options = {}) {
  const { THREE } = ctx;
  /* --- THE FIGURE MAY RE-PROPORTION ITS OWN PACK -----------------
     `figure.jetpackProfile` is the same authorship channel as
     `figure.locomotionProfile`: per-figure scalars over the shared
     design, defaulted so a figure that declares nothing (Vesper, and
     every boss harness that borrows this module) flies on the exact
     frozen JETPACK_CONFIG object it always did. The scales build ONE
     effective config here because every gate below, player.js's
     flight solve (via `ctx.jetpack.config`) and the HUD's percentage
     all have to agree about what a full tank is.

     `mode: "leap"` declares a pack that CANNOT sustain flight - the
     Bastion's Censer boiler. The chord that lights other packs
     instead buys a single jet-boosted leap (see `leap` state below);
     `inFlight` is never set, so the flight solver, glide pose and
     HUD flight modes are simply never entered. */
  const profile = player?.figure?.jetpackProfile || null;
  const profScale = (key, lo, hi) => {
    const v = Number(profile?.[key]);
    return Number.isFinite(v) ? clamp(v, lo, hi) : 1;
  };
  const config = !profile ? JETPACK_CONFIG : Object.freeze({
    ...JETPACK_CONFIG,
    maxFuel: JETPACK_CONFIG.maxFuel * profScale("maxFuelScale", 0.5, 2.5),
    burnRate: JETPACK_CONFIG.burnRate * profScale("burnRateScale", 0.4, 2.5),
    rechargeRate: JETPACK_CONFIG.rechargeRate * profScale("rechargeRateScale", 0.4, 2.5),
  });
  const leapMode = profile?.mode === "leap";
  const leapCfg = profile?.leap || {};
  const LEAP = Object.freeze({
    cost: Number.isFinite(leapCfg.cost) ? Math.max(0, leapCfg.cost) : 22,
    vertical: Number.isFinite(leapCfg.vertical) ? leapCfg.vertical : 12.4,
    /* A LEAP IS A DISTANCE, NOT AN IMPULSE. The first version set a
       one-frame speed floor and let the movement solver have it back
       immediately - and that solver drives `wanted` to ZERO whenever
       the stick is centred, so a leap with no input travelled almost
       nowhere. The horizontal is now a sustained DRIVE, held for
       `driveSeconds` and faded over the last `fade` of it, published
       through `driveState()` for the controller to floor its speed
       and open its travel gate against (mirroring the melee lunge,
       which had this problem solved already). */
    driveSpeed: Number.isFinite(leapCfg.driveSpeed) ? leapCfg.driveSpeed : 11.5,
    driveSeconds: Number.isFinite(leapCfg.driveSeconds) ? Math.max(0, leapCfg.driveSeconds) : 0.35,
    fade: Number.isFinite(leapCfg.fade) ? Math.max(0.01, leapCfg.fade) : 0.25,
    cooldown: Number.isFinite(leapCfg.cooldown) ? Math.max(0, leapCfg.cooldown) : 1.9,
    pulse: 0.55,
  });
  /* --- FLYING WITHOUT PAYING, AND WHY IT IS NOT THE BOON ---------

     `ctx.mission.boon()` already means exactly this to the pack -
     every fuel gate below consults it and every one of them refills
     the tank and clears the cooldown. Switching the boon on would
     have been one line in the level's mission stub.

     It is the wrong line. The boon is also read by combat.js,
     weapons.js and hud.js, where it multiplies damage and heat, so
     a level that wants an unlimited PACK cannot borrow it without
     quietly buffing every weapon in the player's hands. This flag
     joins the same path and stops at the pack. */
  const unlimitedFuel = options.unlimitedFuel === true;
  const freeFlight = () => unlimitedFuel
    || ctx.mission?.boon?.()?.active === true;
  /* WHICH PACK. The figure names it (`figure.jetpack`); everything
     that does not name one wears the Seraph, so Vesper-IX needed no
     change when this became a choice. Only the DESIGN varies - fuel,
     flight, collision and the HUD contract below are shared, because
     a pack is decoration and a traversal tool is a mechanic. */
  const visual = buildPackFor(ctx, player);
  const pose = visual.pose;
  const exhaust = buildExhaust(ctx);
  const nozzlePosition = [new THREE.Vector3()];
  const nozzleQuaternion = [new THREE.Quaternion()];
  const plumeDirection = new THREE.Vector3();
  const wallProbePosition = new THREE.Vector3();
  const wallProbeRight = new THREE.Vector3();
  const wallProbeCorner = new THREE.Vector3();
  const exhaustCullMatrix = new THREE.Matrix4();
  const exhaustLocalPosition = new THREE.Vector3();
  let spawnAccumulator = 0;
  let flameWasOn = false;
  let lastRawRequested = false;
  let wingSpread = 0;
  let boostVisualThrottle = 0;

  const state = {
    fuel: config.maxFuel,
    requested: false,
    active: false,
    inFlight: false,
    exhausted: false,
    needsRelease: false,
    cooldownRemaining: 0,
    rechargeDelayRemaining: 0,
    recharging: false,
    throttle: 0,
    pose: 0,
    horizontalSpeed: 0,
    landingAssist: null,
    landingAssistRetry: 0,
    takeoffClearing: false,
    takeoffGround: 0,
    landPulse: 0,
    ignitions: 0,
    exhaustions: 0,
    landings: 0,
    distance: 0,
    blockedFrames: 0,
    lastLandingSpeed: 0,
    /* Leap-mode packs only (see LEAP above). `leapPulse` is the
       presentation window of the burn; `leapAirborne` marks a leap
       whose landing this module still owes a thump for. */
    leapCooldownRemaining: 0,
    leapPulse: 0,
    leapAirborne: false,
    leaps: 0,
    leapBlockedReason: null,
    /* The sustained horizontal of a leap in flight, and the bearing
       it was launched along. */
    leapDriveRemaining: 0,
    leapYaw: 0,
  };

  function clearExhaustPool() {
    spawnAccumulator = 0;
    exhaust.alive = 0;
    exhaust.cursor = 0;
    exhaust.ages.fill(0);
    exhaust.lives.fill(0);
    exhaust.velocities.fill(0);
    for (let i = 0; i < exhaust.COUNT; i += 1) {
      exhaust.positions[i * 3 + 1] = -9999;
    }
    exhaust.geo.attributes.position.needsUpdate = true;
    exhaust.points.visible = false;
  }

  function reset(full = true) {
    const keys = player.input?.keys;
    const chordHeld = !!keys && keybindDown(keys, "jump") && keybindDown(keys, "boost");
    if (full) state.fuel = config.maxFuel;
    state.requested = false;
    state.active = false;
    state.inFlight = false;
    state.exhausted = false;
    /* Spawn/teleport is not a key-up event. Preserve the physical
       latch so holding the chord across a respawn cannot manufacture
       a fresh ignition on the next frame. */
    state.needsRelease = chordHeld;
    state.cooldownRemaining = 0;
    state.rechargeDelayRemaining = 0;
    state.recharging = false;
    state.throttle = 0;
    state.pose = 0;
    state.horizontalSpeed = 0;
    state.landingAssist = null;
    state.landingAssistRetry = 0;
    state.takeoffClearing = false;
    state.landPulse = 0;
    state.leapCooldownRemaining = 0;
    state.leapPulse = 0;
    state.leapAirborne = false;
    state.leapBlockedReason = null;
    boostVisualThrottle = 0;
    wingSpread = 0;
    visual.root.userData.wingSpread = 0;
    for (const wing of visual.wings) {
      wing.wallTuck = 0;
      wing.visualSpread = 0;
      wing.deployCant = 0;
      wing.plumeThrottle = 0;
      wing.root.userData.wallTuck = 0;
      wing.root.rotation.set(0.035, wing.side * 0.46, 0);
      wing.veil.scale.set(0.10, 0.35, 1);
      for (const feather of wing.feathers) {
        feather.rotation.set(0, wing.side * 0.08, feather.userData.foldAngle);
      }
    }
    for (const flame of visual.flames) {
      flame.outer.visible = false;
      flame.inner.visible = false;
    }
    clearExhaustPool();
    lastRawRequested = chordHeld;
  }

  function ignite(playerState, groundY) {
    const wasGrounded = !!playerState.grounded;
    const cost = freeFlight() ? 0 : config.ignitionCost;
    const fuelBefore = state.fuel;
    state.fuel = Math.max(0, state.fuel - cost);
    state.active = true;
    state.inFlight = true;
    state.exhausted = false;
    state.recharging = false;
    state.rechargeDelayRemaining = config.rechargeDelay;
    state.takeoffGround = groundY;
    state.landingAssist = null;
    state.landingAssistRetry = 0;
    state.takeoffClearing = true;
    state.ignitions += 1;
    playerState.grounded = false;
    playerState.vy = Math.max(playerState.vy, 5.2);
    ctx.progression?.noteVerb?.("jet", {
      verb: "jet",
      x: playerState.x,
      y: playerState.y,
      z: playerState.z,
      groundY,
      wasGrounded,
      fuelBefore,
      fuel: state.fuel,
      ignitionCost: cost,
      ignitionIndex: state.ignitions,
    });
    ctx.audio?.jetIgnite?.();
  }

  function cutoff(depleted = false) {
    if (!state.active && !depleted) return;
    state.active = false;
    state.rechargeDelayRemaining = depleted ? config.depletedDelay : config.rechargeDelay;
    if (depleted) {
      state.fuel = 0;
      state.exhausted = true;
      state.needsRelease = true;
      state.cooldownRemaining = config.depletedDelay;
      state.exhaustions += 1;
      ctx.audio?.jetEmpty?.();
    } else {
      ctx.audio?.jetCutoff?.();
    }
  }

  function beginFrame(dt, playerState, inputState) {
    const dead = !!ctx.combat?.player?.dead;
    const blockedByAction = !!player.action || !!ctx.mission?.entry?.active
      || !!ctx.boost?.state?.active
      || !!ctx.shield?.state?.active
      /* Committing to the fall CUTS the pack. Both are on the same
         reliquary charge and both want the vertical axis; leaving the
         pack lit would have it fighting the plunge for the whole
         descent, and the plunge would win slowly. */
      || !!ctx.slam?.state?.active
      || (ctx.weapons?.carry?.venting || 0) > 0;
    const rawRequested = !!inputState.jetpack;
    const requested = rawRequested && !playerState.free && !dead && !blockedByAction;
    state.requested = requested;

    if (freeFlight()) {
      state.fuel = config.maxFuel;
      state.exhausted = false;
      state.cooldownRemaining = 0;
      state.rechargeDelayRemaining = 0;
    }

    if (state.cooldownRemaining > 0) {
      state.cooldownRemaining = Math.max(0, state.cooldownRemaining - dt);
    }
    if (!requested) {
      if (state.active) cutoff(false);
    }
    /* A lockout is armed by the physical key chord, not by the
       software-gated request. Entering free camera, an interaction or
       a death while the keys remain held must not manufacture a new
       press when that gate reopens. */
    if (!rawRequested && state.cooldownRemaining <= 0) state.needsRelease = false;

    const pressed = requested && rawRequested && !lastRawRequested;
    /* Pinned to the ground by a web (player.applyRoot) is pinned: the
       pack does not light from a standing start while it holds. A
       pack already in the air is left alone - the root zeroes its
       horizontal travel through the player's own speed, which reads
       as being caught, without cutting the burn. */
    /* A stun pins whether or not the boots are down: being knocked
       flat by twenty metres of abdomen is not a thing you fly out of. */
    const pinned = ((playerState.rootFor || 0) > 0 && playerState.grounded)
      || (playerState.stunFor || 0) > 0;
    if (leapMode) {
      /* THE CENSER CANNOT FLY. The chord buys one boosted leap from
         the ground: a vertical impulse plus a speed floor along the
         travel bearing, then plain ballistics - `inFlight` is never
         set, so there is no hover, no glide and no cruise solve. The
         refusal reasons mirror the flight gates so QA can name why a
         press did nothing. */
      state.leapCooldownRemaining = Math.max(0, state.leapCooldownRemaining - dt);
      state.leapPulse = Math.max(0, state.leapPulse - dt);
      state.leapDriveRemaining = Math.max(0, state.leapDriveRemaining - dt);
      /* Landing ends the drive: a leap is the flight, not a skate
         along the ground after it. */
      if (playerState.grounded && state.leapDriveRemaining > 0 && !pressed) {
        state.leapDriveRemaining = 0;
      }
      if (pressed) {
        state.leapBlockedReason = !playerState.grounded ? "airborne"
          : pinned ? "pinned"
            : state.needsRelease ? "release"
              : state.leapCooldownRemaining > 0 ? "cooldown"
                : !(state.fuel >= LEAP.cost || freeFlight()) ? "low-charge"
                  : null;
        if (!state.leapBlockedReason) {
          if (!freeFlight()) state.fuel = Math.max(0, state.fuel - LEAP.cost);
          state.rechargeDelayRemaining = Math.max(
            state.rechargeDelayRemaining, config.rechargeDelay);
          state.leapCooldownRemaining = LEAP.cooldown;
          state.leapPulse = LEAP.pulse;
          state.leapAirborne = true;
          state.leaps += 1;
          /* The bearing is the STICK's, read camera-relative exactly
             as the boost reads it, so a leap goes where the player
             asked rather than where the body happens to be pointing.
             A centred stick leaps straight ahead. */
          const mv = inputState.move || { x: 0, y: 0 };
          if (Math.hypot(mv.x, mv.y) > 0.2) {
            state.leapYaw = playerState.camYaw + Math.atan2(mv.x, -mv.y);
          } else {
            state.leapYaw = Number.isFinite(playerState.camYaw)
              ? playerState.camYaw : playerState.yaw;
          }
          state.leapDriveRemaining = LEAP.driveSeconds;
          playerState.grounded = false;
          playerState.vy = Math.max(playerState.vy, LEAP.vertical);
          playerState.speed = Math.max(playerState.speed || 0, LEAP.driveSpeed);
          ctx.audio?.jetIgnite?.();
          ctx.audio?.leapBlast?.(playerState.x, playerState.z);
          /* The Forge hears the firebox open. Optional-chained, like
             every other doctrine seam - Vesper's packs never leap. */
          ctx.doctrine?.verb?.("leap", { x: playerState.x, z: playerState.z });
          ctx.vfx?.jetIgnite?.(playerState.x, playerState.y + 1.1, playerState.z,
            0, -1, 0, 1);
        }
      }
      if (state.leapAirborne && playerState.grounded) {
        state.leapAirborne = false;
        state.landPulse = 1;
        state.landings += 1;
        ctx.audio?.jetLand?.(Math.max(4, Math.abs(playerState.vy || 0)));
        ctx.doctrine?.verb?.("leapLand", { x: playerState.x, z: playerState.z });
      }
    } else if (pressed && !state.active && !state.needsRelease && !pinned
      && (state.fuel >= config.minIgnitionFuel || freeFlight())
      && (state.cooldownRemaining <= 0 || freeFlight())) {
      const gy = ctx.collide?.groundHeight(playerState.x, playerState.z)
        ?? ctx.terrain.heightAt(playerState.x, playerState.z);
      ignite(playerState, gy);
    }

    if (state.active) {
      if (!requested) cutoff(false);
      else if (!freeFlight()) {
        state.fuel = Math.max(0, state.fuel - config.burnRate * dt);
        if (state.fuel <= 1e-6) cutoff(true);
      }
    }

    state.recharging = false;
    if (playerState.grounded && !state.inFlight && !rawRequested && !state.active
      && !ctx.boost?.state?.active && !ctx.shield?.state?.requested) {
      state.rechargeDelayRemaining = Math.max(0, state.rechargeDelayRemaining - dt);
      if (state.cooldownRemaining <= 0 && state.rechargeDelayRemaining <= 0
        && state.fuel < config.maxFuel) {
        state.fuel = Math.min(config.maxFuel, state.fuel + config.rechargeRate * dt);
        state.recharging = state.fuel < config.maxFuel;
        if (state.fuel >= config.maxFuel) state.exhausted = false;
      }
    } else if (!playerState.grounded) {
      state.recharging = false;
    }

    state.throttle = damp(state.throttle, state.active ? 1 : 0, state.active ? 15 : 8, dt);
    const poseTarget = state.inFlight ? (state.active ? 1 : 0.58) : state.landPulse * 0.3;
    state.pose = damp(state.pose, poseTarget, state.inFlight ? 9 : 13, dt);
    state.landPulse = Math.max(0, state.landPulse - dt * 3.5);
    state.landingAssistRetry = Math.max(0, state.landingAssistRetry - dt);
    lastRawRequested = rawRequested;
    return state;
  }

  /** The leap's sustained horizontal, or null when nothing is driving.
   *  Read by the player controller as a speed FLOOR and a travel
   *  bearing - the same contract the melee lunge already uses. Always
   *  null on a pack that is not in leap mode, so Vesper's controller
   *  path is untouched. */
  function driveState() {
    if (!leapMode || state.leapDriveRemaining <= 0) return null;
    const elapsed = LEAP.driveSeconds - state.leapDriveRemaining;
    const fadeFrom = Math.max(0, LEAP.driveSeconds - LEAP.fade);
    const profileN = elapsed <= fadeFrom
      ? 1
      : clamp(1 - (elapsed - fadeFrom) / LEAP.fade, 0, 1);
    return { speed: LEAP.driveSpeed * profileN, yaw: state.leapYaw };
  }

  function noteMotion(distance, blocked = false) {
    state.distance += Math.max(0, distance || 0);
    if (blocked) state.blockedFrames += 1;
  }

  function land(playerState, impactSpeed = 0) {
    if (!state.inFlight) return;
    state.inFlight = false;
    state.active = false;
    state.horizontalSpeed = 0;
    state.landingAssist = null;
    state.landingAssistRetry = 0;
    state.takeoffClearing = false;
    state.landPulse = 1;
    state.landings += 1;
    state.lastLandingSpeed = Math.max(0, impactSpeed);
    state.rechargeDelayRemaining = Math.max(
      state.rechargeDelayRemaining,
      state.exhausted ? config.depletedDelay : config.rechargeDelay
    );
    state.needsRelease = state.needsRelease || state.requested;
    ctx.audio?.jetLand?.(impactSpeed);
    playerState.vy = 0;
  }

  function setState(next = {}) {
    if (Number.isFinite(next.fuel)) {
      state.fuel = clamp(next.fuel, 0, config.maxFuel);
      state.exhausted = state.fuel <= 0;
    }
    if (Number.isFinite(next.cooldownRemaining)) {
      state.cooldownRemaining = Math.max(0, next.cooldownRemaining);
    }
    if (Number.isFinite(next.rechargeDelayRemaining)) {
      state.rechargeDelayRemaining = Math.max(0, next.rechargeDelayRemaining);
    }
    return status(player.state);
  }

  /**
   * Spend reliquary charge on a grounded auxiliary system.
   *
   * Charge belongs here even when the movement does not: writing fuel
   * directly from the boost module would bypass recharge delay and the
   * depleted-flight lockout, making the two jet abilities disagree
   * about how much energy the same pack contains.
   */
  /**
   * Draw charge for something that is not flight.
   *
   * `ground` opts out of the post-flight lockout. That lockout exists
   * to stop the pack being re-lit the instant it lands; it has no
   * business stopping a GROUND boost, and once Shift became the main
   * mobility verb an unexplained half-second where it did nothing
   * after every landing read as the key being broken.
   *
   * `airborne` opts out of the in-flight refusal. That refusal is
   * there so nothing can quietly drain the tank the pack is currently
   * burning - but the ground slam is only ever committed to IN the
   * air, and it CUTS the pack in the same breath, so refusing it made
   * the one ability that has to be airborne the one ability that could
   * never pay for itself. Cost is taken first and the pack goes out
   * immediately after; nothing shares the tank across that frame.
   */
  function spend(amount, ground = false, airborne = false) {
    const cost = Math.max(0, Number(amount) || 0);
    if (freeFlight()) {
      state.fuel = config.maxFuel;
      state.exhausted = false;
      state.cooldownRemaining = 0;
      state.rechargeDelayRemaining = 0;
      return true;
    }
    if (cost <= 0) return true;
    if (!airborne && (state.inFlight || state.active)) return false;
    if (!ground && state.cooldownRemaining > 0) return false;
    if (state.fuel + 1e-6 < cost) return false;
    state.fuel = Math.max(0, state.fuel - cost);
    state.recharging = false;
    state.rechargeDelayRemaining = Math.max(state.rechargeDelayRemaining, config.rechargeDelay);
    if (state.fuel < config.minIgnitionFuel) state.exhausted = true;
    return true;
  }

  /**
   * Continuously draw from the reliquary charge for auxiliary gear.
   * Unlike `spend`, this returns a partial final draw so a held device
   * reaches a true zero instead of marooning a fraction of one frame's
   * fuel in the pack. Recharge delay and depletion lockout still live
   * here, alongside every other consumer of the same meter.
   */
  function drain(amount) {
    const request = Math.max(0, Number(amount) || 0);
    if (freeFlight()) {
      state.fuel = config.maxFuel;
      state.exhausted = false;
      state.cooldownRemaining = 0;
      state.rechargeDelayRemaining = 0;
      return request;
    }
    if (request <= 0) return 0;
    if (state.inFlight || state.active || state.cooldownRemaining > 0) return 0;
    const used = Math.min(state.fuel, request);
    if (used <= 1e-6) return 0;
    state.fuel = Math.max(0, state.fuel - used);
    state.recharging = false;
    state.rechargeDelayRemaining = Math.max(state.rechargeDelayRemaining, config.rechargeDelay);
    if (state.fuel < config.minIgnitionFuel) state.exhausted = true;
    if (state.fuel <= 1e-6) {
      state.fuel = 0;
      state.cooldownRemaining = Math.max(state.cooldownRemaining, config.depletedDelay);
      state.rechargeDelayRemaining = Math.max(state.rechargeDelayRemaining, config.depletedDelay);
      state.exhausted = true;
      state.exhaustions += 1;
      ctx.audio?.jetEmpty?.();
    }
    return used;
  }

  /**
   * Return Reliquary charge from a doctrine effect. This deliberately does
   * not shorten cooldown or recharge delay: a refund changes the shared
   * resource, not the timing gates owned by flight and recharge.
   */
  function restoreCharge(amount, reason = "external") {
    const requested = Math.max(0, Number(amount) || 0);
    if (requested <= 0) return 0;
    const before = state.fuel;
    state.fuel = clamp(before + requested, 0, config.maxFuel);
    const restored = state.fuel - before;
    if (state.fuel >= config.minIgnitionFuel) state.exhausted = false;
    state.recharging = false;
    // Exposed for diagnostics without coupling this low-level resource to a
    // progression event bus or interpreting the refund's rule.
    state.lastRestoreReason = String(reason || "external");
    return restored;
  }

  function spawnParticle(origin, direction, indexSeed, throttle = state.throttle) {
    const i = exhaust.cursor;
    exhaust.cursor = (i + 1) % exhaust.COUNT;
    const k = i * 3;
    const a = indexSeed * 12.9898 + i * 78.233;
    const sx = Math.sin(a) * 0.23;
    const sz = Math.sin(a * 1.731 + 2.1) * 0.23;
    exhaust.positions[k] = origin.x + sx * 0.08;
    exhaust.positions[k + 1] = origin.y;
    exhaust.positions[k + 2] = origin.z + sz * 0.08;
    const speed = 5.4 + 2.8 * throttle + (Math.sin(a * 0.37) * 0.5 + 0.5) * 1.5;
    exhaust.velocities[k] = direction.x * speed + sx;
    exhaust.velocities[k + 1] = direction.y * speed - 0.5;
    exhaust.velocities[k + 2] = direction.z * speed + sz;
    exhaust.ages[i] = 0;
    exhaust.lives[i] = 0.48 + (Math.sin(a * 0.71) * 0.5 + 0.5) * 0.34;
  }

  function updateVisual(dt) {
    /* A ground boost or Executioner's Thrust is propulsion from this same reliquary pack.
       Keep flight state authoritative for physics, while the presentation
       reads the auxiliary boost/thrust and drives the identical wings, central
       ribbon and exhaust pool. */
    const isMeleePierce = !!player.action && player.action.name === "meleePierce";
    const boostThrust = (!!ctx.boost?.state?.active && !!player.state.grounded)
      || isMeleePierce || state.leapPulse > 0;
    boostVisualThrottle = damp(boostVisualThrottle, boostThrust ? 1 : 0,
      boostThrust ? 18 : 8, dt);
    const throttle = Math.max(state.throttle, boostVisualThrottle);
    const powered = state.active || boostThrust;
    const deployed = state.inFlight || boostThrust;
    const stowPhase = clamp01(ctx.weapons?.stowPhase ?? 0);
    /* Let the lance clear the shoulder plane before the blades fan.
       Thrust still begins immediately; only the decorative wing sweep
       is delayed until the authored 0.42s weapon draw is complete. */
    const weaponClear = stowPhase <= 0.0001 ? 1 : 0;
    const wingTarget = deployed ? weaponClear : state.landPulse * 0.24;
    wingSpread = damp(wingSpread, wingTarget,
      deployed ? pose.openRate : pose.closeRate, dt);
    const clock = player.state.clock || 0;
    const spreadEase = wingSpread * wingSpread * (3 - 2 * wingSpread);
    /* The weapon clears first, then the hinges cant the folded blades
       out of its swept volume before fanning. The cant is shared by
       both sides and returns exactly to zero once the slowest feather
       has nearly settled, preserving the authored endpoint poses. */
    const drawProgressT = clamp01((1 - stowPhase) / 0.10);
    const drawProgressEase = drawProgressT * drawProgressT * (3 - 2 * drawProgressT);
    /* Feather rotation is deliberately damped and staggered, so its
       real progress trails the scalar wingSpread during the opening
       sweep. Measure the slowest actual blade instead of releasing
       the clearance cant from the desired spread too early. The more
       open side wins when masonry has tucked its opposite wing. */
    let slowestProgress = 0;
    for (const wing of visual.wings) {
      let wingSlowest = 1;
      let counted = 0;
      for (const feather of wing.feathers) {
        const range = feather.userData.poweredAngle - feather.userData.foldAngle;
        /* A PLATE THAT BARELY MOVES CANNOT REPORT PROGRESS.
           This divides by the plate's own fold-to-powered travel, so
           a plate whose two endpoints are a degree apart turns any
           wobble at all into a full swing of `progress` - and the
           Augur has one, because its BOOM does the folding and its
           innermost vane only trims. Measured: that vane's ratio slammed
           between 0 and 1 at the flutter rate, which slammed
           `settleEase`, which slammed 14 degrees of clearance cant
           into the wing root 1.46 times a second. That is the
           reported stutter, and its period was the flutter rate to
           three figures. Skip the plates with nothing to say; if a
           wing has none, the eased spread is the honest answer. */
        if (Math.abs(range) < PROGRESS_RANGE_MIN) continue;
        counted += 1;
        /* THE SETTLED ANGLE, NOT THE DRAWN ONE. `rotation.z` carries
           the decorative flutter on top of the deployment, and
           reading it back here fed that decoration into a gate whose
           whole window is seven percent wide. */
        const settled = Number.isFinite(feather.userData.settled)
          ? feather.userData.settled
          : feather.rotation.z;
        wingSlowest = Math.min(
          wingSlowest,
          clamp01((settled - feather.userData.foldAngle) / range)
        );
      }
      if (!counted) wingSlowest = spreadEase;
      slowestProgress = Math.max(slowestProgress, wingSlowest);
    }
    const settleT = clamp01((slowestProgress - 0.92) / (0.99 - 0.92));
    const settleEase = settleT * settleT * (3 - 2 * settleT);
    const deploymentCant = powered
      ? (14 * Math.PI / 180) * drawProgressEase * (1 - settleEase)
      : 0;
    /* The lance remains drawn for a short beat after touchdown. Its
       grounded carry twist used to pull the closing left feathers
       through the torso before auto-stow relaxed the pose. Retain a
       restrained five-degree flare while the hands still own the
       weapon, then hand that clearance back continuously through the
       existing release blend. The true fully-stowed endpoint is
       therefore unchanged. */
    const handRelease = clamp01(ctx.weapons?.carry?.handRelease ?? 0);
    const landingCant = !deployed
      ? (5.5 * Math.PI / 180) * (1 - handRelease)
      : 0;
    const clearanceCant = deploymentCant + landingCant;

    /* The seraph span is intentionally wider than the player's
       collision capsule. Probe the authored full-height collision
       intervals and fold either wing independently before it cuts
       through nearby masonry. This is presentation-only: traversal
       collision and player clearance remain exactly as authored. */
    visual.root.updateWorldMatrix(true, false);
    wallProbePosition.set(0, 0.026, -0.136).applyMatrix4(visual.root.matrixWorld);
    wallProbeRight.set(1, 0, 0).transformDirection(visual.root.matrixWorld);
    wallProbeRight.y = 0;
    if (wallProbeRight.lengthSq() > 1e-8) wallProbeRight.normalize();
    else wallProbeRight.set(1, 0, 0);
    let wingBandLo = Infinity;
    let wingBandHi = -Infinity;
    for (let yi = 0; yi < 2; yi += 1) {
      const localY = yi === 0 ? -0.58 : 0.64;
      for (let zi = 0; zi < 2; zi += 1) {
        const localZ = zi === 0 ? -0.32 : 0.05;
        wallProbeCorner.set(0, localY, localZ).applyMatrix4(visual.root.matrixWorld);
        wingBandLo = Math.min(wingBandLo, wallProbeCorner.y);
        wingBandHi = Math.max(wingBandHi, wallProbeCorner.y);
      }
    }

    for (const wing of visual.wings) {
      let obstructionRadius = Infinity;
      for (let ri = 0; ri < 3; ri += 1) {
        const radius = ri === 0 ? 0.50 : (ri === 1 ? 0.70 : 0.90);
        const qx = wallProbePosition.x + wallProbeRight.x * wing.side * radius;
        const qz = wallProbePosition.z + wallProbeRight.z * wing.side * radius;
        const spans = ctx.collide?.flightCellAt?.(qx, qz);
        let blocked = false;
        if (spans) {
          for (let si = 0; si < spans.length; si += 2) {
            if (spans[si + 1] > wingBandLo && spans[si] < wingBandHi) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked && ctx.terrain?.groundHeightAt) {
          blocked = ctx.terrain.groundHeightAt(qx, qz) > wingBandLo + 0.02;
        }
        if (blocked) {
          obstructionRadius = radius;
          break;
        }
      }
      /* Partial span estimates are not conservative while the body
         turns beside a wall: a fifteen-degree yaw can sweep the long
         ceramic tips across a neighbouring cell even though the
         lateral sample distance has not changed. Any occupied probe
         therefore commands the compact endpoint on that side. The
         opposite wing remains fully expressive, while the threatened
         wing stays inside the player's nominal capsule envelope. */
      const tuckTarget = Number.isFinite(obstructionRadius) ? 1 : 0;
      const forcedWallClose = tuckTarget > wing.wallTuck + 0.0001;
      /* A 30 m/s collision can move the capsule half a metre in one
         rendered frame. Close immediately when a newly sampled wall
         removes span, including the articulated transforms below;
         reopening stays damped so cell boundaries never make the
         silhouette chatter. */
      wing.wallTuck = forcedWallClose
        ? tuckTarget
        : damp(wing.wallTuck, tuckTarget, 7, dt);
      const sideSpread = spreadEase * (1 - wing.wallTuck);
      wing.visualSpread = sideSpread;
      wing.root.userData.wallTuck = wing.wallTuck;
      /* ON THE GROUP AS WELL AS THE RECORD. `onVisual` is handed the
         pack's own objects, not this loop's bookkeeping, so a pack
         with per-side hardware (the Augur's outriggers) has no other
         way to ask how far ITS side opened - and reading the missing
         field off the group returned undefined, which multiplied
         into a NaN rotation and collapsed the whole pack's bounding
         box to NaN in one frame. */
      wing.root.userData.spread = sideSpread;
      const modeAngleY = wing.side * (
        deployed ? (powered ? pose.poweredYaw : pose.glideYaw) : pose.stowYaw
      );
      const rootYawTarget = lerp(wing.side * pose.stowYaw, modeAngleY, sideSpread);
      wing.root.rotation.y = forcedWallClose
        ? rootYawTarget
        : damp(wing.root.rotation.y, rootYawTarget, 9, dt);
      const rootPitchTarget = lerp(
        pose.stowPitch,
        powered ? pose.poweredPitch : pose.glidePitch,
        sideSpread
      );
      wing.root.rotation.x = forcedWallClose
        ? rootPitchTarget + clearanceCant
        : damp(wing.root.rotation.x - wing.deployCant, rootPitchTarget, 9, dt)
          + clearanceCant;
      wing.deployCant = clearanceCant;
      for (let f = 0; f < wing.feathers.length; f += 1) {
        const feather = wing.feathers[f];
        const delay = f * pose.featherDelay;
        const localSpread = clamp01((sideSpread - delay) / Math.max(0.01, 1 - delay));
        const deployedAngle = powered
          ? feather.userData.poweredAngle
          : feather.userData.glideAngle;
        const flutter = powered
          ? Math.sin(clock * pose.flutterPoweredRate + feather.userData.phase)
            * pose.flutterPowered * localSpread * throttle
          : Math.sin(clock * pose.flutterGlideRate + feather.userData.phase)
            * pose.flutterGlide * localSpread;
        /* DAMP THE DEPLOYMENT, THEN DRAW THE FLUTTER ON TOP.
           The flutter used to be part of the target the damp chased,
           which both smeared it and - fatally - made it part of the
           angle `slowestProgress` reads back above. Keeping the
           settled angle separate leaves the deployment a clean
           damped ramp and the flutter a crisp decoration. */
        const featherAngleTarget = lerp(
          feather.userData.foldAngle,
          deployedAngle,
          localSpread
        );
        const settled = forcedWallClose
          ? featherAngleTarget
          : damp(
            Number.isFinite(feather.userData.settled)
              ? feather.userData.settled
              : feather.rotation.z,
            featherAngleTarget, 13, dt
          );
        feather.userData.settled = settled;
        feather.rotation.z = settled + flutter;
        const featherYawTarget = wing.side * lerp(
          pose.plateYawStow,
          powered ? pose.plateYawPowered : pose.plateYawGlide,
          localSpread
        );
        feather.rotation.y = forcedWallClose
          ? featherYawTarget
          : damp(feather.rotation.y, featherYawTarget, 11, dt);
      }
      wing.veil.scale.x = lerp(0.10, pose.veilOpenX, sideSpread);
      wing.veil.scale.y = lerp(
        pose.veilOpenY[0], powered ? pose.veilOpenY[2] : pose.veilOpenY[1], sideSpread
      );
      wing.hinge.rotation.z = clock * wing.side * pose.hingeSpin;
      wing.hingeLight.rotation.z = clock * wing.side * pose.hingeLightSpin;
    }
    visual.root.userData.wingSpread = wingSpread;
    visual.root.userData.wallTuckL = visual.wings[0]?.wallTuck || 0;
    visual.root.userData.wallTuckR = visual.wings[1]?.wallTuck || 0;
    if (visual.halo) visual.halo.rotation.z = Math.sin(clock * 0.72) * 0.035 * spreadEase;
    if (visual.haloLight) visual.haloLight.rotation.z = -Math.sin(clock * 0.92) * 0.055 * spreadEase;
    const energyMat = visual.wings[0]?.veil?.material;
    if (energyMat) {
      energyMat.opacity = lerp(
        pose.veilOpacity[0],
        powered ? pose.veilOpacity[2] : pose.veilOpacity[1],
        spreadEase
      );
    }

    /* EVERY APERTURE, not the first one. The Seraph has a single
       central cell and the Augur hangs one pod off each boom tip;
       both are driven from here, so a twin-engine pack does not need
       its own copy of the ignition, flare and exhaust logic (and
       cannot drift out of step with the single-engine one). */
    for (let n = 0; n < visual.nozzles.length; n += 1) {
      if (!nozzlePosition[n]) nozzlePosition[n] = new THREE.Vector3();
      if (!nozzleQuaternion[n]) nozzleQuaternion[n] = new THREE.Quaternion();
      visual.nozzles[n].getWorldPosition(nozzlePosition[n]);
      visual.nozzles[n].getWorldQuaternion(nozzleQuaternion[n]);
    }
    const flicker = 0.92 + Math.sin(player.state.clock * 37) * 0.08;
    /* The central aperture does not belong to either wing. Delay its
       solid ribbon through the opening sweep, then keep it alive when
       one side folds beside masonry; a one-sided wall tuck must not
       make the only engine appear to cut out. */
    const flameThrottle = throttle
      * clamp01((spreadEase - pose.flameGate) / pose.flameGateSpan);
    const wallPlumeTuck = Math.max(
      visual.wings[0]?.wallTuck || 0,
      visual.wings[1]?.wallTuck || 0
    );
    /* The compact endpoint necessarily closes across the centerline
       exhaust envelope. Keep a short, readable pilot ribbon at a wall,
       but remove the long sheet and free particles before either can
       pass through the folding feathers. */
    const wallPlumeLength = lerp(1, 0.26, wallPlumeTuck);
    for (const wing of visual.wings) wing.plumeThrottle = flameThrottle;
    /* A tucked plate crosses the aperture footprint, not merely the
       ribbon's length. Preserve the reactor glow beside masonry, but
       hide the free exhaust sheet until both wings are back outside
       that footprint. */
    const flameOn = flameThrottle > 0.025 && wallPlumeTuck <= 0.02;
    /* Ignition: the first frame the plume lights is a burst, not a
       fade-in - a throat of gas catching. Fired from every aperture,
       because on a twin-pod pack one burst on the centreline is a
       flash from a place there is no engine. */
    if (flameOn && !flameWasOn && ctx.vfx?.jetIgnite) {
      for (let n = 0; n < visual.nozzles.length; n += 1) {
        plumeDirection.set(0, -1, 0).applyQuaternion(nozzleQuaternion[n]).normalize();
        ctx.vfx.jetIgnite(nozzlePosition[n].x, nozzlePosition[n].y, nozzlePosition[n].z,
          plumeDirection.x, plumeDirection.y, plumeDirection.z, flameThrottle);
      }
    }
    flameWasOn = flameOn;
    for (const flame of visual.flames) {
      const s0 = flame.baseScale || 1;
      flame.outer.visible = flameOn;
      flame.inner.visible = flameOn;
      if (flame.flare) {
        flame.flare.visible = flameOn;
        const g = flameThrottle * (0.55 + 0.45 * flicker);
        const gain = flame.flareGain ?? 1;
        flame.flareMat.opacity = flameOn ? (0.55 + g * 0.65) * gain : 0;
        flame.flare.scale.setScalar(0.7 + g * 0.6);
      }
      for (const m of [flame.outer.material, flame.inner.material]) {
        if (!m.uniforms) continue;
        m.uniforms.uTime.value = player.state.clock || 0;
        m.uniforms.uThrottle.value = flameThrottle;
      }
      flame.outer.scale.set(
        s0 * lerp(0.62, 1, flameThrottle),
        s0 * lerp(0.38, 1, flameThrottle) * flicker * wallPlumeLength,
        s0 * lerp(0.62, 1, flameThrottle)
      );
      flame.inner.scale.set(
        s0 * lerp(0.66, 1, flameThrottle),
        s0 * lerp(0.46, 1, flameThrottle) * (2 - flicker) * wallPlumeLength,
        s0 * lerp(0.66, 1, flameThrottle)
      );
    }

    const windowMat = visual.chargeWindow?.material;
    if (windowMat) {
      const fuelN = clamp01(state.fuel / config.maxFuel);
      windowMat.emissiveIntensity = lerp(0.35, 1.7, fuelN)
        * (state.recharging ? 0.88 + Math.sin(player.state.clock * 4) * 0.12 : 1);
      const low = fuelN < 0.18;
      /* Per pack: the Augur's tank is ice-green and the Censer's is
         a firebox, and neither of them can go amber at full and red
         at empty like the Seraph without looking like a bug. */
      const hue = visual.chargeColours || {
        full: 0xffcf67, fullEmissive: 0xb76b18, low: 0xa52b38, lowEmissive: 0xff2338,
      };
      windowMat.color.setHex(low ? hue.low : hue.full);
      windowMat.emissive.setHex(low ? hue.lowEmissive : hue.fullEmissive);
    }

    if (wallPlumeTuck > 0.02 && (exhaust.alive > 0 || spawnAccumulator > 0)) {
      clearExhaustPool();
    }
    if (powered && dt > 0 && flameOn && wallPlumeTuck <= 0.02) {
      spawnAccumulator += dt * lerp(34, 82, flameThrottle);
      const count = Math.min(16, Math.floor(spawnAccumulator));
      spawnAccumulator -= count;
      /* Round-robin across the apertures. Splitting one pool between
         two pods rather than doubling it keeps a twin-engine pack at
         the same particle cost as the single, which is the honest
         thing to do when the budget was set by the pack that had
         one. */
      for (let n = 0; n < count; n += 1) {
        const which = visual.nozzles.length > 1 ? n % visual.nozzles.length : 0;
        plumeDirection.set(0, -1, 0).applyQuaternion(nozzleQuaternion[which]).normalize();
        spawnParticle(nozzlePosition[which], plumeDirection,
          player.state.clock + n * 0.113, throttle);
      }
    }

    /* Particles live in world space so the trail does not follow the
       character like a rigid prop. Cull only the forward half-space in
       pack-local coordinates: turbulence may fan behind the aperture,
       but no random seed can carry a long-lived spark back into armour. */
    exhaustCullMatrix.copy(visual.root.matrixWorld).invert();
    let alive = 0;
    for (let i = 0; i < exhaust.COUNT; i += 1) {
      const life = exhaust.lives[i];
      if (life <= 0) continue;
      exhaust.ages[i] += dt;
      const k = i * 3;
      if (exhaust.ages[i] >= life) {
        exhaust.lives[i] = 0;
        exhaust.positions[k + 1] = -9999;
        continue;
      }
      const fade = 1 - exhaust.ages[i] / life;
      exhaust.colors[k] = lerp(0.72, 1.0, fade);
      exhaust.colors[k + 1] = lerp(0.28, 0.78, fade);
      exhaust.colors[k + 2] = lerp(0.04, 0.34, fade);
      exhaust.positions[k] += exhaust.velocities[k] * dt;
      exhaust.positions[k + 1] += exhaust.velocities[k + 1] * dt;
      exhaust.positions[k + 2] += exhaust.velocities[k + 2] * dt;
      exhaust.velocities[k] *= Math.exp(-1.9 * dt);
      exhaust.velocities[k + 1] -= 1.8 * dt;
      exhaust.velocities[k + 2] *= Math.exp(-1.9 * dt);
      exhaustLocalPosition
        .set(
          exhaust.positions[k],
          exhaust.positions[k + 1],
          exhaust.positions[k + 2]
        )
        .applyMatrix4(exhaustCullMatrix);
      if (exhaustLocalPosition.z > -0.055) {
        exhaust.lives[i] = 0;
        exhaust.positions[k + 1] = -9999;
        continue;
      }
      alive += 1;
    }
    exhaust.alive = alive;
    exhaust.geo.attributes.position.needsUpdate = true;
    exhaust.geo.attributes.color.needsUpdate = true;
    exhaust.points.visible = alive > 0;

    /* WHAT THE SHARED LOOP CANNOT SAY. Everything above is a fold
       angle, a plume or a tank; a gimbal that points, a stack that
       vents and a shutter that glows are none of those, and pushing
       them into the generic path would mean every pack carrying
       fields for hardware it does not have. Last, so a pack sees the
       frame the loop has finished composing. */
    visual.onVisual?.({
      dt, clock, throttle, powered, deployed,
      spread: spreadEase,
      flameThrottle,
      fuel: clamp01(state.fuel / config.maxFuel),
    });
  }

  function status(playerState = player.state) {
    const boostThrust = !!ctx.boost?.state?.active && !!playerState.grounded;
    let mode = "ready";
    if (leapMode) {
      if (state.leapPulse > 0) mode = "thrust";
      else if (boostThrust) mode = "boost";
      else if (state.leapCooldownRemaining > 0) mode = "cooldown";
      else if (state.recharging) mode = "recharging";
      else if (state.fuel < LEAP.cost) mode = "low";
    } else if (state.active) mode = "thrust";
    else if (boostThrust) mode = "boost";
    else if (state.inFlight) mode = state.exhausted ? "empty" : "glide";
    else if (state.cooldownRemaining > 0) mode = "cooldown";
    else if (state.recharging) mode = "recharging";
    else if (state.fuel < config.minIgnitionFuel) mode = "low";
    return {
      leapMode,
      leapCooldownRemaining: Number(state.leapCooldownRemaining.toFixed(3)),
      leapDriveRemaining: Number(state.leapDriveRemaining.toFixed(3)),
      leapDriveSpeed: LEAP.driveSpeed,
      leapCost: LEAP.cost,
      leaps: state.leaps,
      leapBlockedReason: state.leapBlockedReason,
      requested: state.requested,
      active: state.active,
      inFlight: state.inFlight,
      mode,
      fuel: Number(state.fuel.toFixed(3)),
      maxFuel: config.maxFuel,
      burnRate: config.burnRate,
      rechargeRate: config.rechargeRate,
      cooldownRemaining: Number(state.cooldownRemaining.toFixed(3)),
      rechargeDelayRemaining: Number(state.rechargeDelayRemaining.toFixed(3)),
      lockedOut: state.needsRelease || state.cooldownRemaining > 0,
      recharging: state.recharging,
      grounded: !!playerState.grounded,
      y: Number(playerState.y.toFixed(3)),
      vy: Number(playerState.vy.toFixed(3)),
      horizontalSpeed: Number((state.horizontalSpeed || 0).toFixed(3)),
      throttle: Number(state.throttle.toFixed(3)),
      pose: Number(state.pose.toFixed(3)),
      wingSpread: Number(wingSpread.toFixed(3)),
      wallTuckL: Number((visual.wings[0]?.wallTuck || 0).toFixed(3)),
      wallTuckR: Number((visual.wings[1]?.wallTuck || 0).toFixed(3)),
      takeoffClearing: state.takeoffClearing,
      ignitions: state.ignitions,
      exhaustions: state.exhaustions,
      landings: state.landings,
      lastLandingSpeed: Number(state.lastLandingSpeed.toFixed(3)),
      distance: Number(state.distance.toFixed(2)),
      blockedFrames: state.blockedFrames,
      exhaustParticles: exhaust.alive,
      boostThrust,
      flameVisible: visual.flames.some((flame) => flame.outer.visible || flame.inner.visible),
    };
  }

  return {
    config,
    state,
    visual,
    beginFrame,
    noteMotion,
    driveState,
    land,
    reset,
    setState,
    spend,
    drain,
    restoreCharge,
    restore: restoreCharge,
    updateVisual,
    status,
  };
}
