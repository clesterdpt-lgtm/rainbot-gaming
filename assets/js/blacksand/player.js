/* ============================================================
   BLACKSAND - local player

   Movement, stance, camera and the feel of being a soldier. This is
   the module that decides whether the game plays well, so the numbers
   here are tuned rather than guessed:

     sprint 6.4 m/s, run 4.6, walk 2.6, crouch 1.9, prone 0.9
     jump apex 1.05m, gravity 22 m/s^2 (not 9.81 - real gravity makes
       a jump feel like the moon at first-person scale)
     acceleration 62 m/s^2 grounded, 9 airborne

   Camera height, weapon sway, head bob and landing recoil are all
   driven from the same movement state, so they cannot disagree.
   ============================================================ */

import { clamp, clamp01, lerp, damp, smoothstep, DEG } from "./core.js";
import { LAYER, SURFACE } from "./physics.js";
import { TEAM } from "./world.js";

const STANCE = {
  STAND: "stand",
  CROUCH: "crouch",
  PRONE: "prone",
};

const STANCE_DATA = {
  [STANCE.STAND]: { height: 1.80, eye: 1.66, speed: 4.6, radius: 0.34 },
  [STANCE.CROUCH]: { height: 1.20, eye: 1.06, speed: 1.9, radius: 0.34 },
  [STANCE.PRONE]: { height: 0.55, eye: 0.38, speed: 0.9, radius: 0.40 },
};

const GRAVITY = 22.0;
const JUMP_SPEED = 6.8;
const SPRINT_MULTIPLIER = 1.39;
const ACCEL_GROUND = 62;
const ACCEL_AIR = 9;
const FRICTION = 11;

export async function createPlayer(ctx) {
  const { THREE, render, physics, terrain, world, input, settings } = ctx;

  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();
  // Scratch vectors. The simulation runs at 120Hz; allocating these
  // per step is 720 short-lived Vector3s a second, which is exactly the
  // kind of garbage that produces a hitch every few seconds.
  const _horizontal = new THREE.Vector3();
  const _delta = new THREE.Vector3();

  const state = {
    team: TEAM.BLUE,
    alive: true,
    health: 100,
    maxHealth: 100,
    stance: STANCE.STAND,
    /** Smoothed stance height, so crouching is a movement not a snap. */
    height: STANCE_DATA[STANCE.STAND].height,
    eyeHeight: STANCE_DATA[STANCE.STAND].eye,
    grounded: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    surface: SURFACE.SAND,
    sprinting: false,
    ads: false,
    adsAmount: 0,
    speed: 0,
    stamina: 1,
    yaw: 0,
    pitch: 0,
    lean: 0,
    /** Accumulated head bob phase. */
    bobPhase: 0,
    lastLandImpact: 0,
    suppression: 0,
    inVehicle: null,
    kills: 0,
    deaths: 0,
    score: 0,

    /** Mantle/vault. While `active`, normal movement is suspended and
     *  the capsule is driven along an arc to `to`. */
    mantle: {
      active: false,
      t: 0,
      duration: 0.42,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      rise: 0,
      cooldown: 0,
    },

    /** Slide. Entered from a sprint, decays by friction, ends when
     *  slow or when the player stands. */
    slide: { active: false, t: 0, speed: 0, dirX: 0, dirZ: 0, cooldown: 0 },

    /** Free-look: the camera turns without the body following. */
    freeLookYaw: 0,
    freeLookPitch: 0,
  };

  // Spawn at the blue base looking towards the middle of the map.
  {
    const spawn = world.pickSpawn(state.team);
    position.copy(spawn);
    position.y += 0.2;
    const toCentre = new THREE.Vector3(-spawn.x, 0, -spawn.z).normalize();
    state.yaw = Math.atan2(-toCentre.x, -toCentre.z);
  }

  /* --------------------------- camera rig --------------------------- */

  const camera = render.camera;
  const cameraOffset = new THREE.Vector3();

  /** Additive recoil, applied on top of the aim and decayed back. Kept
   *  separate from yaw/pitch so a player's own mouse input is never
   *  fought by the recoil spring. */
  const recoil = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };

  const deathCam = { t: 0 };
  const _lookTarget = new THREE.Vector3();

  /** Camera shake from explosions. Amplitude decays; the offset is
   *  noise-driven so two shakes never look identical. */
  const shake = { amount: 0, time: 0 };

  const viewKick = { x: 0, y: 0 };

  /* ------------------------------ move ------------------------------ */

  function stanceData() { return STANCE_DATA[state.stance]; }

  function canStandUp() {
    // Probe the taller capsule before rising, or a player crouched
    // under a container pops through the roof.
    const probe = position.clone();
    const hits = [];
    physics.resolveCapsule(probe, STANCE_DATA[STANCE.STAND].radius,
      STANCE_DATA[STANCE.STAND].height, LAYER.STATIC | LAYER.DYNAMIC, hits);
    return hits.length === 0;
  }

  function setStance(next) {
    if (next === state.stance) return;
    if ((state.stance === STANCE.CROUCH || state.stance === STANCE.PRONE)
      && next === STANCE.STAND && !canStandUp()) return;
    state.stance = next;
    ctx.bus.emit("player:stance", next);
  }

  function applyLook(dt) {
    const look = input.drainLook();

    // Free-look: the head turns, the body does not. Held with Alt, and
    // it springs back the moment the key is released - a free-look that
    // stays where you left it means the player fires 90 degrees off
    // their crosshair the next time they shoot.
    if (input.isDown("freelook")) {
      state.freeLookYaw = clamp(state.freeLookYaw + look.yaw, -125 * DEG, 125 * DEG);
      state.freeLookPitch = clamp(state.freeLookPitch + look.pitch, -70 * DEG, 70 * DEG);
      return;
    }
    if (state.freeLookYaw !== 0 || state.freeLookPitch !== 0) {
      state.freeLookYaw = damp(state.freeLookYaw, 0, 14, dt);
      state.freeLookPitch = damp(state.freeLookPitch, 0, 14, dt);
      if (Math.abs(state.freeLookYaw) < 1e-4) state.freeLookYaw = 0;
      if (Math.abs(state.freeLookPitch) < 1e-4) state.freeLookPitch = 0;
    }

    state.yaw += look.yaw;
    state.pitch = clamp(state.pitch + look.pitch, -88 * DEG, 88 * DEG);
    // Keep yaw bounded so it never loses precision over a long match.
    if (state.yaw > Math.PI) state.yaw -= Math.PI * 2;
    if (state.yaw < -Math.PI) state.yaw += Math.PI * 2;
  }

  /* ---------------------------- mantling ---------------------------- */

  const _mantleDir = new THREE.Vector3();
  /** Counts simulation steps so the vault probe can run at 30Hz. */
  let vaultProbeTick = 0;

  /**
   * Try to start a vault. Called when the player jumps or runs into
   * something at chest height.
   *
   * Deliberately requires forward INTENT (`moveY < -0.2`). Mantling on
   * a bare jump means a player pressed against a crate pops onto it
   * every time they try to jump straight up, which feels like the game
   * is playing itself.
   */
  function tryMantle() {
    if (state.mantle.active || state.mantle.cooldown > 0) return false;
    if (state.stance === STANCE.PRONE) return false;
    if (input.state.moveY > -0.2) return false;

    _mantleDir.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    const data = stanceData();
    const result = physics.mantleProbe(position, _mantleDir, {
      radius: data.radius,
      height: STANCE_DATA[STANCE.STAND].height,
      maxHeight: state.grounded ? 1.35 : 1.9,
      minHeight: 0.45,
      reach: 0.95,
    });
    if (!result) return false;

    state.mantle.active = true;
    state.mantle.t = 0;
    state.mantle.rise = result.rise;
    // Tall vaults take longer. A fixed duration makes a 0.5m step feel
    // sluggish and a 1.3m wall feel like a teleport.
    state.mantle.duration = lerp(0.28, 0.62, clamp01(result.rise / 1.35));
    state.mantle.from.copy(position);
    state.mantle.to.copy(result.position);
    velocity.set(0, 0, 0);
    setStance(STANCE.STAND);
    ctx.bus.emit("player:mantle", { rise: result.rise });
    ctx.audio?.playAt?.("land", position, { volume: 0.5 });
    return true;
  }

  function updateMantle(dt) {
    const m = state.mantle;
    m.t += dt;
    const t = clamp01(m.t / m.duration);

    // Up first, then forward. Interpolating straight from A to B drags
    // the capsule through the obstacle's face, which both looks wrong
    // and lets a player clip inside thin geometry mid-vault.
    const up = smoothstep(clamp01(t / 0.55));
    const across = smoothstep(clamp01((t - 0.30) / 0.70));
    position.x = lerp(m.from.x, m.to.x, across);
    position.z = lerp(m.from.z, m.to.z, across);
    position.y = lerp(m.from.y, m.to.y, up);

    // Weight shift through the vault, so it reads as effort.
    viewKick.x = -0.10 * Math.sin(t * Math.PI) * m.rise;

    if (t >= 1) {
      m.active = false;
      m.cooldown = 0.18;
      position.copy(m.to);
      state.grounded = true;
    }
  }

  function fixedUpdate(dt) {
    if (!state.alive) {
      // Still drain look while dead so the death camera can be steered.
      applyLook(dt);
      return;
    }

    applyLook(dt);

    state.mantle.cooldown = Math.max(0, state.mantle.cooldown - dt);
    state.slide.cooldown = Math.max(0, state.slide.cooldown - dt);

    /* ---- mantle overrides everything ---- */
    if (state.mantle.active) {
      updateMantle(dt);
      world.reportPresence(state.team, position);
      recoil.yaw = damp(recoil.yaw, recoil.targetYaw, 9, dt);
      recoil.pitch = damp(recoil.pitch, recoil.targetPitch, 9, dt);
      viewKick.x = damp(viewKick.x, 0, 8, dt);
      return;
    }

    if (input.wasPressed("jump") && tryMantle()) return;

    /* ---- stance ---- */
    const wantProne = input.isDown("prone");
    const wantCrouch = settings.prefs.toggleCrouch
      ? input.wasPressed("crouch")
      : input.isDown("crouch");

    if (wantProne && input.wasPressed("prone")) {
      setStance(state.stance === STANCE.PRONE ? STANCE.STAND : STANCE.PRONE);
    } else if (settings.prefs.toggleCrouch) {
      if (wantCrouch) setStance(state.stance === STANCE.CROUCH ? STANCE.STAND : STANCE.CROUCH);
    } else {
      setStance(wantCrouch ? STANCE.CROUCH : STANCE.STAND);
    }

    const data = stanceData();
    // Ease height so the camera glides rather than teleports. 14/s
    // reaches 99% in ~0.33s, which reads as a deliberate movement.
    state.height = damp(state.height, data.height, 14, dt);
    state.eyeHeight = damp(state.eyeHeight, data.eye, 14, dt);

    /* ---- aim down sights ---- */
    state.ads = input.state.ads && state.stance !== STANCE.PRONE ? true : input.state.ads;
    state.adsAmount = damp(state.adsAmount, state.ads ? 1 : 0, 16, dt);

    /* ---- sprint ---- */
    const movingForward = input.state.moveY < -0.35;
    const wantsSprint = input.state.sprint && movingForward && !state.ads
      && state.stance === STANCE.STAND && state.stamina > 0.04;
    state.sprinting = wantsSprint && !state.slide.active;
    state.stamina = clamp01(state.stamina + (state.sprinting ? -0.145 : 0.21) * dt);

    /* ---- slide ---- */
    // A slide is momentum you have already paid for, not free speed:
    // entry requires an actual sprint, it decays by friction, and it
    // cannot be re-entered instantly. Without the cooldown, tapping
    // crouch on every landing gives a permanent speed boost, which is
    // how "slide cancelling" becomes the only way anyone moves.
    if (!state.slide.active && state.slide.cooldown <= 0 && state.grounded
      && state.speed > 4.4 && input.wasPressed("crouch")) {
      state.slide.active = true;
      state.slide.t = 0;
      state.slide.speed = Math.max(state.speed, 6.0);
      const inv = 1 / Math.max(state.speed, 1e-4);
      state.slide.dirX = velocity.x * inv;
      state.slide.dirZ = velocity.z * inv;
      setStance(STANCE.CROUCH);
      viewKick.x -= 3.4 * DEG;
      ctx.bus.emit("player:slide");
      ctx.audio?.footstep?.(state.surface, position, 1.2);
      ctx.vfx?.footstepDust?.(position, state.surface, 8);
    }

    if (state.slide.active) {
      state.slide.t += dt;
      // Friction plus a slope term: sliding downhill carries, uphill
      // dies quickly. Surface matters too - sand eats a slide.
      const slopeAssist = -state.groundNormal.x * state.slide.dirX
        - state.groundNormal.z * state.slide.dirZ;
      const drag = state.surface === SURFACE.SAND ? 7.4 : 4.6;
      state.slide.speed += (slopeAssist * 16 - drag) * dt;

      const ended = state.slide.speed < 2.4
        || state.slide.t > 1.5
        || !state.grounded
        || !input.isDown("crouch");
      if (ended) {
        state.slide.active = false;
        state.slide.cooldown = 0.9;
        if (!input.isDown("crouch")) setStance(STANCE.STAND);
      } else {
        velocity.x = state.slide.dirX * state.slide.speed;
        velocity.z = state.slide.dirZ * state.slide.speed;
        // Slight steering authority, so a slide is a manoeuvre rather
        // than a commitment to a straight line.
        const steer = input.state.moveX * 1.6 * dt;
        const cos = Math.cos(steer);
        const sin = Math.sin(steer);
        const nx = state.slide.dirX * cos - state.slide.dirZ * sin;
        const nz = state.slide.dirX * sin + state.slide.dirZ * cos;
        state.slide.dirX = nx;
        state.slide.dirZ = nz;
      }
    }

    /* ---- desired velocity ---- */
    forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));

    wish.set(0, 0, 0);
    wish.addScaledVector(right, input.state.moveX);
    wish.addScaledVector(forward, -input.state.moveY);
    if (wish.lengthSq() > 1) wish.normalize();

    let targetSpeed = data.speed;
    if (state.sprinting) targetSpeed *= SPRINT_MULTIPLIER;
    if (state.ads) targetSpeed *= 0.52;
    // Strafing and backpedalling are slower - this is what stops
    // players circle-strafing at full speed and makes aiming matter.
    const facing = wish.dot(forward);
    if (facing < -0.1) targetSpeed *= 0.72;
    else if (Math.abs(facing) < 0.45) targetSpeed *= 0.86;

    // Slope penalty: climbing costs speed, descending does not add it.
    if (state.grounded) {
      const uphill = -wish.dot(state.groundNormal);
      if (uphill > 0) targetSpeed *= lerp(1, 0.45, clamp01(uphill * 2.2));
    }

    wish.multiplyScalar(targetSpeed);

    /* ---- acceleration ---- */
    // Skipped while sliding: the slide owns the velocity outright, and
    // letting the accelerator also write it means the player can just
    // hold W and never lose the slide's speed.
    if (!state.slide.active) {
      const accel = state.grounded ? ACCEL_GROUND : ACCEL_AIR;
      _horizontal.set(velocity.x, 0, velocity.z);
      _delta.copy(wish).sub(_horizontal);
      const maxDelta = accel * dt;
      if (_delta.length() > maxDelta) _delta.setLength(maxDelta);
      velocity.x += _delta.x;
      velocity.z += _delta.z;
    }

    // Friction when there is no input, so stopping is crisp.
    if (state.grounded && !state.slide.active && wish.lengthSq() < 0.01) {
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed > 0.01) {
        const drop = Math.min(speed, FRICTION * dt * Math.max(speed, 1.6));
        const scale = (speed - drop) / speed;
        velocity.x *= scale;
        velocity.z *= scale;
      } else {
        velocity.x = 0;
        velocity.z = 0;
      }
    }

    /* ---- jump ---- */
    if (input.wasPressed("jump") && state.grounded && state.stance === STANCE.STAND
      && state.stamina > 0.12) {
      velocity.y = JUMP_SPEED;
      state.grounded = false;
      state.stamina -= 0.12;
      ctx.bus.emit("player:jump");
      ctx.audio?.playAt?.("jump", position);
    }

    /* ---- gravity and integration ---- */
    velocity.y -= GRAVITY * dt;
    velocity.y = Math.max(velocity.y, -78);

    const wasAirborne = !state.grounded;
    const fallSpeed = -velocity.y;

    const result = physics.moveCapsule(position, velocity, data.radius, state.height, dt, {
      layer: LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
      stepHeight: state.stance === STANCE.STAND ? 0.42 : 0.22,
    });

    state.grounded = result.grounded;
    state.groundNormal.copy(result.groundNormal);
    state.surface = result.surface;

    // Auto-vault.
    //
    // Driven by a forward probe, NOT by `result.hitWall`. Gating on the
    // collision flag looks obviously right and does not work: the
    // step-up block later in moveCapsule clears `hitWall` when it finds
    // headroom, the flag is also cleared by a slide or a grounded
    // resolve, and the one frame where a fast player is genuinely
    // touching the obstacle is easy to miss entirely at 6 m/s. The
    // result was a vault that never triggered while every part it is
    // built from - the broadphase, the resolver, the mantle probe -
    // tested correct in isolation.
    //
    // Probing costs about five raycasts, so it runs at 30Hz rather than
    // 120Hz. Traversal does not need sub-30ms latency and the player
    // covers only 20cm between probes at a sprint.
    vaultProbeTick += 1;
    if ((vaultProbeTick & 3) === 0 && state.grounded && !state.slide.active
      && state.speed > 2.0 && input.state.moveY < -0.5) {
      tryMantle();
    }

    /* ---- landing ---- */
    if (wasAirborne && state.grounded && fallSpeed > 3.2) {
      const severity = clamp01((fallSpeed - 3.2) / 14);
      state.lastLandImpact = severity;
      viewKick.x -= severity * 5.6 * DEG;
      shake.amount = Math.max(shake.amount, severity * 0.35);
      ctx.audio?.playAt?.("land", position, { volume: 0.4 + severity * 0.6 });
      // Fall damage above ~11 m/s, which is roughly a 6m drop.
      if (fallSpeed > 11) {
        applyDamage((fallSpeed - 11) * 7.2, null, "fall");
      }
    }

    state.speed = Math.hypot(velocity.x, velocity.z);

    /* ---- head bob ---- */
    if (state.grounded && state.speed > 0.4) {
      // Phase advances with distance travelled, not time, so bob stays
      // locked to footfalls at any speed.
      state.bobPhase += state.speed * dt * 2.1;
      const stride = Math.sin(state.bobPhase * Math.PI);
      if (stride > 0.985 && !state.stepFired) {
        state.stepFired = true;
        ctx.audio?.footstep?.(state.surface, position, state.sprinting ? 1 : 0.7);
        ctx.vfx?.footstepDust?.(position, state.surface, state.speed);
      } else if (stride < 0.5) {
        state.stepFired = false;
      }
    }

    /* ---- lean ---- */
    const wantLean = input.state.lean;
    state.lean = damp(state.lean, wantLean * (state.ads ? 1 : 0.6), 10, dt);

    /* ---- objective presence ---- */
    world.reportPresence(state.team, position);

    /* ---- suppression decay ---- */
    state.suppression = Math.max(0, state.suppression - dt * 0.9);

    /* ---- recoil recovery ---- */
    recoil.yaw = damp(recoil.yaw, recoil.targetYaw, 9, dt);
    recoil.pitch = damp(recoil.pitch, recoil.targetPitch, 9, dt);
    recoil.targetYaw = damp(recoil.targetYaw, 0, 3.6, dt);
    recoil.targetPitch = damp(recoil.targetPitch, 0, 3.6, dt);

    viewKick.x = damp(viewKick.x, 0, 8, dt);
    viewKick.y = damp(viewKick.y, 0, 8, dt);

    shake.amount = damp(shake.amount, 0, 3.2, dt);
    shake.time += dt;

    /* ---- fall out of the world ---- */
    if (position.y < terrain.minHeight - 40) {
      applyDamage(1000, null, "out-of-bounds");
    }
  }

  /* ---------------------------- damage ---------------------------- */

  function applyDamage(amount, source, cause = "bullet") {
    if (!state.alive) return;
    state.health -= amount;
    const dirX = 0;
    const dirY = 0;
    render.setDamage(clamp01(amount / 45), dirX, dirY);
    ctx.bus.emit("player:damage", { amount, source, cause, health: state.health });

    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
      state.deaths += 1;
      ctx.bus.emit("player:death", { source, cause });
      ctx.audio?.playAt?.("death", position);
      setTimeout(() => { if (!state.alive) respawn(); }, 4200);
    } else {
      ctx.audio?.playAt?.("hurt", position);
    }
  }

  function respawn() {
    const enemies = ctx.bots ? ctx.bots.positionsFor(state.team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE) : [];
    const spawn = world.pickSpawn(state.team, enemies);
    position.copy(spawn);
    position.y += 0.25;
    velocity.set(0, 0, 0);
    state.alive = true;
    state.health = state.maxHealth;
    state.stance = STANCE.STAND;
    state.height = STANCE_DATA[STANCE.STAND].height;
    state.eyeHeight = STANCE_DATA[STANCE.STAND].eye;
    state.stamina = 1;
    render.setDamage(0);
    ctx.bus.emit("player:respawn", { position: spawn });
  }

  /* --------------------------- camera pose --------------------------- */

  function lateUpdate(dt) {
    if (ctx.qa && ctx.qa.cameraIsFree) return;

    /* ---- death camera ---- */
    // Drop to the ground and pull back, so the player sees what killed
    // them. Locking a dead player's view to a first-person corpse is
    // disorienting and tells them nothing.
    if (!state.alive) {
      deathCam.t += dt;
      const rise = smoothstep(clamp01(deathCam.t / 1.6));
      const distance = lerp(0.4, 3.4, rise);
      const height = lerp(state.eyeHeight, 1.9, rise);
      const yaw = state.yaw + state.freeLookYaw;
      camera.position.set(
        position.x + Math.sin(yaw) * distance,
        position.y + height,
        position.z + Math.cos(yaw) * distance
      );
      _lookTarget.set(position.x, position.y + lerp(1.2, 0.35, rise), position.z);
      camera.lookAt(_lookTarget);
      render.setFov(lerp(settings.prefs.fov, 58, rise));
      return;
    }
    deathCam.t = 0;

    /* ---- eye position ---- */
    cameraOffset.set(0, state.eyeHeight, 0);

    // Head bob: a figure-of-eight, vertical at twice the horizontal
    // frequency. Scaled down hard when aiming - bob that survives ADS
    // makes precise shooting feel broken.
    const bobScale = settings.prefs.headBob
      * lerp(1, 0.12, state.adsAmount)
      * clamp01(state.speed / 5.2)
      * (state.grounded ? 1 : 0.15);
    const bobX = Math.sin(state.bobPhase * Math.PI) * 0.045 * bobScale;
    const bobY = Math.abs(Math.cos(state.bobPhase * Math.PI)) * 0.038 * bobScale;
    cameraOffset.y -= bobY;

    // Lean: translate and roll. Translating without rolling reads as
    // sidestepping; rolling without translating reads as a broken neck.
    const leanOffset = state.lean * 0.42;

    camera.position.copy(position).add(cameraOffset);
    camera.position.x += Math.cos(state.yaw) * (leanOffset + bobX);
    camera.position.z += -Math.sin(state.yaw) * (leanOffset + bobX);

    /* ---- shake ---- */
    let shakeYaw = 0;
    let shakePitch = 0;
    if (shake.amount > 0.001) {
      const t = shake.time * 34;
      const decay = shake.amount * settings.prefs.cameraShake;
      shakeYaw = (Math.sin(t * 1.7) + Math.sin(t * 3.1) * 0.5) * decay * 0.02;
      shakePitch = (Math.cos(t * 2.3) + Math.cos(t * 4.7) * 0.5) * decay * 0.02;
    }

    // A slide rolls the camera into the direction of travel and drops
    // the eye - the two cues that tell the player they are no longer
    // upright without needing a third-person view to prove it.
    const slideRoll = state.slide.active
      ? clamp(input.state.moveX, -1, 1) * 5.5 * DEG * clamp01(state.slide.speed / 7)
      : 0;

    camera.rotation.set(
      state.pitch + state.freeLookPitch + recoil.pitch
        + viewKick.x * settings.prefs.viewKick + shakePitch,
      state.yaw + state.freeLookYaw + recoil.yaw
        + viewKick.y * settings.prefs.viewKick + shakeYaw,
      -state.lean * 6.5 * DEG + bobX * 0.6 + slideRoll,
      "YXZ"
    );

    /* ---- fov ---- */
    const baseFov = settings.prefs.fov;
    // Speed FOV: a small widening while sprinting sells velocity. Kept
    // under 6 degrees, because more than that makes players motion sick.
    const sprintFov = clamp01((state.speed - 4.6) / 2.4) * 5.5;
    const adsFov = baseFov * settings.prefs.adsFovScale;
    const fov = lerp(baseFov + sprintFov, adsFov, state.adsAmount);
    render.setFov(fov);
    render.viewCamera.fov = lerp(58, 44, state.adsAmount);
    render.viewCamera.updateProjectionMatrix();

    /* ---- post feedback ---- */
    render.setSuppression(state.suppression);
    if (state.alive && state.health < 100) {
      render.setDamage(clamp01((1 - state.health / 100) * 0.55));
    }
  }

  /* ------------------------------ api ------------------------------ */

  const api = {
    STANCE,
    state,
    position,
    velocity,
    get yaw() { return state.yaw; },
    get pitch() { return state.pitch; },
    get eyePosition() {
      return new THREE.Vector3(position.x, position.y + state.eyeHeight, position.z);
    },
    get aimDirection() {
      const pitch = state.pitch + recoil.pitch;
      const yaw = state.yaw + recoil.yaw;
      return new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch)
      );
    },

    fixedUpdate,
    lateUpdate,
    applyDamage,
    respawn,

    teleport(x, y, z) {
      position.set(x, y, z);
      velocity.set(0, 0, 0);
    },

    /** Called by weapons. Recoil is a target the camera springs
     *  towards, not an instant rotation - instant recoil cannot be
     *  compensated for by a human and feels like a random number. */
    addRecoil(pitchRad, yawRad) {
      recoil.targetPitch += pitchRad;
      recoil.targetYaw += yawRad;
      viewKick.x -= pitchRad * 0.35;
    },

    addShake(amount) { shake.amount = clamp01(shake.amount + amount); },
    addSuppression(amount) { state.suppression = clamp01(state.suppression + amount); },

    report() {
      return {
        alive: state.alive,
        health: Math.round(state.health),
        stance: state.stance,
        grounded: state.grounded,
        mantling: state.mantle.active,
        sliding: state.slide.active,
        speed: Number(state.speed.toFixed(2)),
        stamina: Number(state.stamina.toFixed(2)),
        ads: Number(state.adsAmount.toFixed(2)),
        position: [
          Number(position.x.toFixed(2)),
          Number(position.y.toFixed(2)),
          Number(position.z.toFixed(2)),
        ],
        yawDeg: Number((state.yaw / DEG).toFixed(1)),
        pitchDeg: Number((state.pitch / DEG).toFixed(1)),
        team: state.team,
        kills: state.kills,
        deaths: state.deaths,
      };
    },
  };

  return api;
}
