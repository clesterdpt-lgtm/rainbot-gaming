/* ============================================================
   Tardigrade Simulator - player controller, camera + stunt scoring

   The whole point of this file is FEEL. The move set is small and
   dumb on purpose (Goat Simulator's is too); what makes it fun is
   that every input produces an overreaction:

     scuttle   heavy grounded run with momentum + skid
     jump      anticipation crouch, big pop, coyote time, buffering
     proboscis sticky strand: light props get dragged, heavy anchors
               reel YOU in, anchored points let you swing
     bonk      lunging headbutt that launches everything it touches
     tun       curl into an indestructible bouncing wrecking ball
     ragdoll   go limp on command, flop, get up again

   Layering:
     fixedUpdate()  all simulation, at ctx.FIXED_STEP
     update()       all presentation: pose, camera, rope mesh, juice

   HARD RULE: when `ctx.qa.cameraLocked` is true this system must not
   write to ctx.camera - the screenshot harness owns it. Everything
   else keeps simulating exactly as normal.

   `position` and `velocity` are stable THREE.Vector3 instances that
   other systems read every frame. They are never reassigned.
   ============================================================ */

import * as THREE from "three";
import { TAU, clamp, clamp01, damp, dampAngle, lerp, smoothstep, wrapAngle } from "./core.js";

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Tuning. One table, so feel can be dialled without hunting the file. */
/* Scale reminder: the hero is 1.6 units long, gravity is -19.6.       */
/* ------------------------------------------------------------------ */
const T = {
  /* ---- body ---- */
  radius: 0.32,
  halfHeight: 0.07,
  skin: 0.02,
  headHeight: 0.62,

  /* ---- scuttle ---- */
  walkSpeed: 13.5,
  sprintSpeed: 22.0,
  accelRate: 9.0, // exponential approach, per second
  brakeRate: 3.2, // slower than accel => you skid
  airAccelRate: 2.6,
  airBrakeRate: 0.35,
  faceTurnRate: 14,
  // Near-vertical. They cling to moss stems and glass; a 52 degree limit made
  // ordinary flowerbed relief behave like an invisible wall, which is exactly
  // what it feels like when you cannot see the few millimetres stopping you.
  slopeLimit: 84 * DEG,

  /* ---- jump ---- */
  jumpSpeed: 14.2,
  anticipation: 0.05, // held crouch before the pop
  coyote: 0.15,
  jumpBuffer: 0.18,
  jumpCut: 2.2, // gravity multiplier when the button is released early
  fallMul: 1.35, // gravity multiplier past the apex
  terminal: 52,

  /* ---- tun (curl) ---- */
  curlAccel: 30, // u/s^2, momentum based
  curlTop: 30,
  curlRoll: 0.42, // rolling resistance per second
  curlBounce: 0.66,
  curlBoost: 4.5,
  curlMinTime: 0.18,

  /* ---- water ----
   * Submerging used to change nothing about how the animal moved, which
   * undercut the visuals even once the volume was rendered: you could see
   * water but still ran and fell through it exactly as through air. */
  // Net must come out slightly NEGATIVE or you cannot dive at all: at
  // buoyancy 11 against gravity cut to 18% the animal simply bobbed at the
  // surface and the 19.6 units of water below it were unreachable. Sink
  // slowly, and hold jump to climb back out.
  buoyancy: 3.5,
  swimUp: 20,          // holding jump swims for the surface
  waterDrag: 3.6,      // everything is slower and heavier down here
  waterMove: 0.55,     // horizontal control authority underwater

  /* ---- climb ----
   * A tardigrade's whole trick is clinging to things, and the player asked
   * for one that can climb anything. Rapier's autostep only fires on
   * step-shaped geometry it recognises, so every face steeper than a kerb
   * read as an invisible wall - passable only by jumping or dashing, which
   * is exactly the workaround players were finding. Rather than tune
   * autostep heuristics we detect the block itself: if the animal is
   * pushing into a face that ate its movement, it walks up the face. */
  climbSpeed: 13,
  climbLatch: 0.3,
  climbPress: 95,      // units/s^2 holding the body against the face
  // Some of the blocked push is fed back INTO the face. Without it the
  // slide resolution frees the body, the next frame is unobstructed, the
  // climb stops and it drops - a stutter right at the wall. Staying pressed
  // against the surface is what makes the climb continuous.
  climbGrip: 0.62,
  // Gate that keeps the climb off ordinary ground. Measured: driving across
  // the flattest terrain in the world, the fraction of the intended step the
  // controller eats peaks at 0.23; pressed against the bottle cap rim it
  // sustains 0.50. `into` (speed into the surface) was tried first and does
  // NOT discriminate - it reads ~10.5 in both cases, because the slide
  // zeroes wall-directed velocity every frame and it only ever rebuilds one
  // frame of acceleration. Smoothing the fraction over ~0.1s widens the gap
  // further, since rough ground spikes while a wall sustains.
  climbStall: 0.30,
  // Pushing hard and going nowhere. This is the case the deflection test
  // above CANNOT see: once the body has actually stopped, velocity is ~0,
  // so there is no intended step left to deflect and the ratio collapses.
  // Traced against a grass blade it read 0.24-0.28 for a second and a half
  // while the animal stood there going 0.01 units per frame - the invisible
  // wall the player hits, passable only by jumping.
  climbPressTime: 0.15,   // seconds of pushing without moving
  climbStuckSpeed: 2.5,   // units/s below which "pushing" counts as "stuck"

  /* ---- bonk ---- */
  bonkLunge: 21,
  bonkLift: 5.4,
  bonkTime: 0.34,
  bonkCooldown: 0.5,
  bonkReach: 2.7,
  bonkRadius: 2.1,
  bonkPower: 42,

  /* ---- sticky proboscis ---- */
  ropeRange: 62,
  ropeMin: 2.2,
  ropeReel: 11,
  ropeSpring: 52,
  ropeDamp: 6.0,
  ropeSwing: 0.985, // fraction of radial velocity killed when taut
  ropeHaul: 30, // impulse/s applied to light props
  ropeBreak: 92,
  ropeHeavyMass: 9, // above this the anchor pulls you instead

  /* ---- ragdoll ---- */
  ragBounce: 0.44,
  ragFriction: 2.6,
  ragSpin: 7.5,
  ragSettleSpeed: 1.8,
  ragSettleTime: 0.9,
  ragMinTime: 0.4,
  ragGetUp: 0.42,
  ragImpact: 30, // involuntary flop above this landing speed

  /* ---- juice ---- */
  traumaDecay: 1.75,
  shakePos: 0.55,
  shakeRot: 0.055,
  shakeFreq: 22,

  /* ---- camera ---- */
  camDist: 7.6,
  camPivot: 1.45,
  camPitchMin: -0.62,
  camPitchMax: 1.12,
  camSmooth: 0.16, // spring smoothTime, seconds
  camLookSmooth: 0.1,
  camLead: 0.17,
  camLeadMax: 3.4,
  camFovSpeed: 15,
  camRecenter: 1.4,
  camMinDist: 1.5,

  /* ---- scoring ---- */
  comboWindow: 3.4,
  comboStep: 3, // tricks per multiplier bump
  comboMax: 8,
  airTrickTime: 0.55,
  nearMissRadius: 2.6,
  nearMissSpeed: 13,
};

/* ------------------------------------------------------------------ */
/* Trick names. The humour is the point; keep them stupid.            */
/* ------------------------------------------------------------------ */
const AIR_NAMES = [
  "HOP",
  "MOSS PIGLET AIRLINES",
  "CRYPTOBIOTIC HANGTIME",
  "LOW EARTH ORBIT",
  "SPACE-VACUUM SURVIVOR",
];
const SPIN_NAMES = [
  "TARDIGRADE TWIST",
  "DOUBLE DESICCATION",
  "TRIPLE TUN SPIN",
  "OCTOPEDAL TORNADO",
];
const BONK_NAMES = [
  "BONK!",
  "ABSOLUTE UNIT",
  "STYLET SMASH",
  "PERCUSSIVE MICROBIOLOGY",
];
const ROLL_NAMES = ["TUN OF FUN", "GRAVEL GRINDER", "BOULDER OF BEAR", "WRECKING BALL OF BEAR"];

/* ------------------------------------------------------------------ */
/* Unity-style critically damped spring. Unconditionally stable, so a  */
/* 100ms hitch cannot make the camera explode.                         */
/* ------------------------------------------------------------------ */
function smoothDamp(current, target, velRef, key, smoothTime, dt, maxSpeed = Infinity) {
  const time = Math.max(0.0001, smoothTime);
  const omega = 2 / time;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const maxChange = maxSpeed * time;
  change = clamp(change, -maxChange, maxChange);
  const goal = current - change;
  const temp = (velRef[key] + omega * change) * dt;
  velRef[key] = (velRef[key] - omega * temp) * exp;
  let output = goal + (change + temp) * exp;
  // Never overshoot past the target.
  if (target - current > 0 === output > target) {
    output = target;
    velRef[key] = (output - target) / dt;
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* Character controller adapter.                                       */
/*                                                                     */
/* Preference order:                                                   */
/*   1. ctx.physics.createCharacter({radius, halfHeight, offset})       */
/*      -> move(desiredTranslation, dt)                                */
/*         -> { translation, grounded, slope, collisions[] }           */
/*   2. a locally owned Rapier KinematicCharacterController against    */
/*      ctx.physics.world (works while physics.js is a placeholder)    */
/*   3. an analytic ground clamp off ctx.world.heightAt                */
/*                                                                     */
/* `position` is the hero's FOOT point; the capsule centre sits        */
/* FOOT_OFFSET above it.                                               */
/* ------------------------------------------------------------------ */
const FOOT_OFFSET = T.radius + T.halfHeight;

function createCharacterAdapter(ctx, position) {
  const result = {
    dx: 0,
    dy: 0,
    dz: 0,
    grounded: false,
    slope: 0,
    normal: new THREE.Vector3(0, 1, 0),
    collisions: [],
  };

  /* ---------- 1. the documented physics.js service ---------- */
  if (ctx.physics && typeof ctx.physics.createCharacter === "function") {
    try {
      const handle = ctx.physics.createCharacter({
        radius: T.radius,
        halfHeight: T.halfHeight,
        offset: T.skin,
        position: [position.x, position.y + FOOT_OFFSET, position.z],
      });
      if (handle && typeof handle.move === "function") {
        return {
          kind: "physics.createCharacter",
          collider: handle.collider || null,
          body: handle.body || null,
          move(desired, dt) {
            const out = handle.move({ x: desired.x, y: desired.y, z: desired.z }, dt) || {};
            const t = out.translation || out.movement || { x: 0, y: 0, z: 0 };
            // `translation` is a DELTA, per the physics.js contract.
            //
            // There used to be a "guard" here that treated an unexpectedly
            // large delta as an absolute position and subtracted the current
            // position from it. That was wrong: snap-to-ground and autostep
            // both legitimately return a delta bigger than the one requested,
            // and when they did, the hero was teleported to the world origin
            // and buried under the terrain. Trust the contract; only reject
            // values that are not finite.
            result.dx = Number.isFinite(t.x) ? t.x : 0;
            result.dy = Number.isFinite(t.y) ? t.y : 0;
            result.dz = Number.isFinite(t.z) ? t.z : 0;
            result.grounded = Boolean(out.grounded);
            result.slope = Number(out.slope) || 0;
            result.collisions = out.collisions || [];
            result.normal.set(0, 1, 0);
            for (const c of result.collisions) {
              const n = c && (c.normal || c.normal1 || c.normal2);
              if (n && n.y > result.normal.y - 0.001 && n.y > 0.2) result.normal.set(n.x, n.y, n.z);
            }
            return result;
          },
          setPosition(v) {
            const p = { x: v.x, y: v.y + FOOT_OFFSET, z: v.z };
            if (typeof handle.setPosition === "function") handle.setPosition(p);
            else if (typeof handle.teleport === "function") handle.teleport(p.x, p.y, p.z);
            else if (handle.body && typeof handle.body.setTranslation === "function") {
              handle.body.setTranslation(p, true);
            }
          },
          dispose() {
            if (typeof handle.dispose === "function") handle.dispose();
          },
        };
      }
    } catch (error) {
      console.warn("[player] ctx.physics.createCharacter unavailable, falling back:", error);
    }
  }

  /* ---------- 2. our own Rapier kinematic controller ---------- */
  const RAPIER = ctx.RAPIER;
  const world = ctx.physics && ctx.physics.world;
  if (RAPIER && world && typeof world.createCharacterController === "function") {
    try {
      const controller = world.createCharacterController(T.skin);
      controller.setUp({ x: 0, y: 1, z: 0 });
      controller.setSlideEnabled(true);
      // Must match the values physics.js uses for the primary controller, or
      // the game plays completely differently depending on which path was
      // taken - and there is nothing on screen to tell you which one you got.
      controller.setMaxSlopeClimbAngle(T.slopeLimit);
      controller.setMinSlopeSlideAngle(80 * DEG);
      // A tardigrade climbs. 0.36 is a humanoid kerb; this animal should get
      // over grit, paving lips and crack edges without noticing them.
      controller.enableAutostep(2.9, 0.04, true);
      controller.enableSnapToGround(0.22); // stay glued walking downhill
      controller.setApplyImpulsesToDynamicBodies(true);
      if (typeof controller.setCharacterMass === "function") controller.setCharacterMass(3.2);

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          position.x,
          position.y + FOOT_OFFSET,
          position.z
        )
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(T.halfHeight, T.radius).setFriction(0.62),
        body
      );

      const desiredRaw = { x: 0, y: 0, z: 0 };
      const next = { x: 0, y: 0, z: 0 };

      return {
        kind: "player.rapierCharacter",
        collider,
        body,
        controller,
        move(desired) {
          desiredRaw.x = desired.x;
          desiredRaw.y = desired.y;
          desiredRaw.z = desired.z;
          controller.computeColliderMovement(collider, desiredRaw);
          const mv = controller.computedMovement();
          result.dx = mv.x;
          result.dy = mv.y;
          result.dz = mv.z;
          result.grounded = controller.computedGrounded();
          result.normal.set(0, 1, 0);
          result.collisions.length = 0;

          const count = controller.numComputedCollisions();
          let bestY = -2;
          for (let i = 0; i < count; i += 1) {
            const hit = controller.computedCollision(i);
            if (!hit) continue;
            const n = hit.normal1 || hit.normal2;
            if (!n) continue;
            // normal1 points out of the obstacle towards the character.
            const entry = {
              normal: { x: n.x, y: n.y, z: n.z },
              toi: hit.toi || 0,
              collider: hit.collider || null,
            };
            result.collisions.push(entry);
            if (n.y > bestY) {
              bestY = n.y;
              if (n.y > 0.25) result.normal.set(n.x, n.y, n.z);
            }
          }
          result.slope = Math.acos(clamp(result.normal.y, -1, 1));

          next.x = position.x + result.dx;
          next.y = position.y + result.dy + FOOT_OFFSET;
          next.z = position.z + result.dz;
          body.setNextKinematicTranslation(next);
          return result;
        },
        setPosition(v) {
          const p = { x: v.x, y: v.y + FOOT_OFFSET, z: v.z };
          body.setTranslation(p, true);
          body.setNextKinematicTranslation(p);
        },
        dispose() {
          try {
            world.removeCharacterController(controller);
            world.removeRigidBody(body);
          } catch (error) {
            /* world already torn down */
          }
        },
      };
    } catch (error) {
      console.warn("[player] Rapier character controller unavailable, using height field:", error);
    }
  }

  /* ---------- 3. analytic ground clamp ---------- */
  return {
    kind: "analytic",
    collider: null,
    body: null,
    move(desired) {
      const nx = position.x + desired.x;
      const nz = position.z + desired.z;
      let ny = position.y + desired.y;
      const ground = ctx.world && ctx.world.heightAt ? ctx.world.heightAt(nx, nz) : 0;
      result.grounded = false;
      if (ny <= ground) {
        ny = ground;
        result.grounded = true;
      }
      result.dx = nx - position.x;
      result.dy = ny - position.y;
      result.dz = nz - position.z;
      result.slope = 0;
      result.normal.set(0, 1, 0);
      result.collisions.length = 0;
      return result;
    },
    setPosition() {},
    dispose() {},
  };
}

/* ------------------------------------------------------------------ */
/* The sticky strand mesh. A real swept tube that sags when slack and  */
/* straightens + thins when taut.                                      */
/* ------------------------------------------------------------------ */
const ROPE_SEGS = 26;
const ROPE_SIDES = 6;

function createRopeMesh(ctx) {
  const rings = ROPE_SEGS + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(rings * ROPE_SIDES * 3);
  const normals = new Float32Array(rings * ROPE_SIDES * 3);
  const uvs = new Float32Array(rings * ROPE_SIDES * 2);
  const indices = [];
  for (let s = 0; s < ROPE_SEGS; s += 1) {
    for (let r = 0; r < ROPE_SIDES; r += 1) {
      const a = s * ROPE_SIDES + r;
      const b = s * ROPE_SIDES + ((r + 1) % ROPE_SIDES);
      const c = (s + 1) * ROPE_SIDES + r;
      const d = (s + 1) * ROPE_SIDES + ((r + 1) % ROPE_SIDES);
      indices.push(a, c, b, b, c, d);
    }
  }
  for (let s = 0; s < rings; s += 1) {
    for (let r = 0; r < ROPE_SIDES; r += 1) {
      const i = (s * ROPE_SIDES + r) * 2;
      uvs[i] = r / ROPE_SIDES;
      uvs[i + 1] = s / ROPE_SEGS;
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  ctx.track(geometry);

  let material = null;
  try {
    material = ctx.materials && ctx.materials.make ? ctx.materials.make("chitin") : null;
  } catch (error) {
    material = null;
  }
  if (!material) {
    material = ctx.track(new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0 }));
  }
  if (material.color) material.color.setHex(0xffdca8);
  if (material.emissive) material.emissive.setHex(0x2a1405);
  material.roughness = 0.22;
  material.metalness = 0;
  if ("clearcoat" in material) material.clearcoat = 1;
  if ("sheen" in material) material.sheen = 0.7;
  if ("transmission" in material) material.transmission = 0.18;
  material.transparent = true;
  material.opacity = 0.94;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Proboscis";
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  ctx.scene.add(mesh);

  return { mesh, geometry, material, positions, normals };
}

/* ================================================================== */
export async function createPlayer(ctx) {
  /* ---------------------------------------------------------------- */
  /* stable public state                                              */
  /* ---------------------------------------------------------------- */
  const position = new THREE.Vector3(0, 1.2, 0);
  const velocity = new THREE.Vector3();

  const spawn =
    ctx.world && typeof ctx.world.spawnPoint === "function"
      ? ctx.world.spawnPoint()
      : new THREE.Vector3(0, 1.2, 0);
  position.copy(spawn);

  const adapter = createCharacterAdapter(ctx, position);
  const rope = createRopeMesh(ctx);

  /* ---------------------------------------------------------------- */
  /* scratch vectors - the hot path never allocates                   */
  /* ---------------------------------------------------------------- */
  const forward = new THREE.Vector3();
  const rightAxis = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const planar = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const aimOrigin = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const anchorPoint = new THREE.Vector3();
  const headPoint = new THREE.Vector3();
  const ropeDir = new THREE.Vector3();

  /* ---------------------------------------------------------------- */
  /* locomotion state                                                 */
  /* ---------------------------------------------------------------- */
  let yaw = 0;
  let prevYaw = 0;
  let turnRate = 0;
  let grounded = true;
  let wasGrounded = true;
  let slope = 0;
  const groundNormal = new THREE.Vector3(0, 1, 0);

  let coyote = T.coyote;
  let jumpBuffer = 0;
  let anticipation = 0;
  let jumpHeld = false;
  let airtime = 0;
  let apexY = position.y;
  let launchY = position.y;
  let bestApex = 0;

  let curled = false;
  let curlTime = 0;
  let rollDistance = 0;

  let ragdoll = false;
  let ragTime = 0;
  let ragSettle = 0;
  let getUp = 0;
  let ragSpinYaw = 0;
  let tumble = 0;

  let climbTimer = 0;
  /** 0 = upright, 1 = belly flat to the wall. Damped so it eases in and out. */
  let climbPitch = 0;
  /** Diagnostics for the wall test - reported so a probe can calibrate it. */
  const climbDir = new THREE.Vector3();
  let stall = 0;
  let stallFrames = 0;
  /** Seconds spent pushing a direction while the body barely moves. */
  let pressTime = 0;
  let dbgBlockedFrac = 0;
  let dbgInto = 0;
  // Closure scope, not step scope: report() reads this, and declaring it
  // inside the fixed step made every report() call a ReferenceError.
  let submersion = 0;
  let bonkTimer = 0;
  let bonkCooldown = 0;
  let bonkHits = 0;
  let bonkResolved = true;
  let rollBank = 0;

  let hitStop = 0;
  let hitStopRestore = 1;
  let trauma = 0;
  let shakeTime = 0;

  let spinAccum = 0;
  let lastTrick = "";
  let lastTrickAt = -99;

  /* previous-frame action state, so edges fire exactly once per press
     even though fixedUpdate runs several times per rendered frame. */
  const held = {
    jump: false,
    grapple: false,
    slam: false,
    ragdoll: false,
    tun: false,
  };

  /* ---------------------------------------------------------------- */
  /* camera state                                                     */
  /* ---------------------------------------------------------------- */
  let camYaw = 0;
  let camPitch = 0.26;
  let camDist = T.camDist;
  let camFov = ctx.settings ? ctx.settings.fov : 62;
  let camRoll = 0;
  let lookIdle = 0;

  const camPos = new THREE.Vector3();
  const camGoal = new THREE.Vector3();
  const camPivot = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camLead = new THREE.Vector3();
  const camVel = { x: 0, y: 0, z: 0 };
  const lookVel = { x: 0, y: 0, z: 0 };
  let camPrimed = false;

  /* deterministic shake noise table - no Math.random anywhere */
  const NOISE = 256;
  const noiseTable = new Float32Array(NOISE);
  for (let i = 0; i < NOISE; i += 1) noiseTable[i] = ctx.rng() * 2 - 1;
  function noise1(t, channel) {
    const x = t + channel * 71.31;
    const i = Math.floor(x);
    const f = x - i;
    const a = noiseTable[((i % NOISE) + NOISE) % NOISE];
    const b = noiseTable[(((i + 1) % NOISE) + NOISE) % NOISE];
    return a + (b - a) * (f * f * (3 - 2 * f));
  }

  /* ---------------------------------------------------------------- */
  /* grapple state                                                    */
  /* ---------------------------------------------------------------- */
  const grapple = {
    attached: false,
    kind: "none", // 'static' | 'dynamic'
    body: null,
    collider: null,
    localOffset: new THREE.Vector3(),
    restLength: 0,
    taut: false,
    tension: 0,
    heldTime: 0,
    dragged: 0,
    dragBank: 0,
    joint: null, // handle from ctx.physics.attachRope, when available
  };

  /* ---------------------------------------------------------------- */
  /* stunt scoring                                                    */
  /* ---------------------------------------------------------------- */
  const combo = { count: 0, multiplier: 1, timer: 0, banked: 0 };
  const nearby = new Map(); // colliderHandle -> peak speed while close
  let nearMissCheck = 0;
  let nearMissBroken = false;

  function award(points, reason) {
    if (points <= 0) return;
    const amount = Math.max(1, Math.round(points * combo.multiplier));
    combo.count += 1;
    combo.timer = T.comboWindow;
    combo.multiplier = Math.min(T.comboMax, 1 + Math.floor(combo.count / T.comboStep) * 0.5);
    combo.banked += amount;
    lastTrick = reason;
    lastTrickAt = ctx.time.elapsed;

    ctx.state.score += amount;
    ctx.state.combo = combo.count;
    if (combo.count > ctx.state.comboBest) ctx.state.comboBest = combo.count;

    ctx.events.emit("score", {
      amount,
      reason,
      multiplier: combo.multiplier,
      position: position.clone(),
    });
    ctx.events.emit("combo", {
      count: combo.count,
      multiplier: combo.multiplier,
      reason,
    });
  }

  function expireCombo() {
    if (combo.count === 0) return;
    combo.count = 0;
    combo.multiplier = 1;
    combo.banked = 0;
    ctx.state.combo = 0;
    ctx.events.emit("combo", { count: 0, multiplier: 1, reason: "expired" });
  }

  ctx.events.on("prop:destroyed", (payload) => {
    if (!payload || !payload.position) {
      award(120, "DEMOLITION");
      return;
    }
    const p = payload.position;
    const d = Math.hypot(p.x - position.x, (p.y || 0) - position.y, p.z - position.z);
    if (d < 26) award(140, "STRUCTURAL REASSIGNMENT");
  });

  /* ---------------------------------------------------------------- */
  /* juice helpers                                                    */
  /* ---------------------------------------------------------------- */
  function addTrauma(amount) {
    trauma = clamp01(trauma + amount);
  }

  function requestHitStop(duration, scale) {
    if (duration <= 0) return;
    if (hitStop <= 0) hitStopRestore = ctx.time.timeScale;
    hitStop = Math.max(hitStop, duration);
    ctx.time.timeScale = clamp(scale, 0.02, 1);
  }

  /* ---------------------------------------------------------------- */
  /* physics query helpers                                            */
  /* ---------------------------------------------------------------- */
  const world = ctx.physics && ctx.physics.world;
  const RAPIER = ctx.RAPIER;
  const rayHitOut = {
    hit: false,
    distance: 0,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    collider: null,
    body: null,
  };
  let shapeQueryOk = true;

  function castRay(origin, dir, maxDistance) {
    rayHitOut.hit = false;
    rayHitOut.collider = null;
    rayHitOut.body = null;
    if (world && RAPIER && typeof world.castRayAndGetNormal === "function") {
      try {
        const ray = new RAPIER.Ray(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: dir.x, y: dir.y, z: dir.z }
        );
        const hit = world.castRayAndGetNormal(
          ray,
          maxDistance,
          true,
          0, // no query filter flags
          undefined, // no collision-group filter
          adapter.collider || null,
          adapter.body || null
        );
        if (hit) {
          const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
          rayHitOut.hit = true;
          rayHitOut.distance = toi;
          rayHitOut.point.copy(origin).addScaledVector(dir, toi);
          if (hit.normal) rayHitOut.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
          else rayHitOut.normal.set(0, 1, 0);
          rayHitOut.collider = hit.collider || null;
          rayHitOut.body = hit.collider && hit.collider.parent ? hit.collider.parent() : null;
          return rayHitOut;
        }
        return rayHitOut;
      } catch (error) {
        /* fall through to the documented service */
      }
    }
    if (ctx.physics && typeof ctx.physics.raycast === "function") {
      try {
        const out = ctx.physics.raycast(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: dir.x, y: dir.y, z: dir.z },
          maxDistance
        );
        if (out && out.hit) {
          rayHitOut.hit = true;
          rayHitOut.distance = out.distance || 0;
          if (out.point) rayHitOut.point.set(out.point.x, out.point.y, out.point.z);
          else rayHitOut.point.copy(origin).addScaledVector(dir, rayHitOut.distance);
          if (out.normal) rayHitOut.normal.set(out.normal.x, out.normal.y, out.normal.z);
          else rayHitOut.normal.set(0, 1, 0);
          rayHitOut.collider = out.collider || null;
          rayHitOut.body =
            out.collider && typeof out.collider.parent === "function" ? out.collider.parent() : null;
        }
      } catch (error) {
        /* no raycast available */
      }
    }
    return rayHitOut;
  }

  /** Runs `fn(collider)` for every collider overlapping a sphere. */
  const queryPos = { x: 0, y: 0, z: 0 };
  const queryRot = { x: 0, y: 0, z: 0, w: 1 };
  const queryBalls = new Map();

  function forEachNear(centre, radius, fn) {
    if (!shapeQueryOk || !world || !RAPIER || !RAPIER.Ball) return;
    try {
      let shape = queryBalls.get(radius);
      if (!shape) {
        shape = new RAPIER.Ball(radius);
        queryBalls.set(radius, shape);
      }
      queryPos.x = centre.x;
      queryPos.y = centre.y;
      queryPos.z = centre.z;
      world.intersectionsWithShape(
        queryPos,
        queryRot,
        shape,
        (collider) => {
          if (collider !== adapter.collider) fn(collider);
          return true;
        },
        0,
        undefined,
        adapter.collider || null,
        adapter.body || null
      );
    } catch (error) {
      shapeQueryOk = false;
    }
  }

  function bodyMass(body) {
    if (!body) return Infinity;
    try {
      if (typeof body.isDynamic === "function" && !body.isDynamic()) return Infinity;
      const m = typeof body.mass === "function" ? body.mass() : 0;
      return m > 0 ? m : 1;
    } catch (error) {
      return Infinity;
    }
  }

  function pushBody(body, impulse, point) {
    if (!body) return false;
    try {
      if (typeof body.isDynamic === "function" && !body.isDynamic()) return false;
      if (point && typeof body.applyImpulseAtPoint === "function") {
        body.applyImpulseAtPoint(impulse, { x: point.x, y: point.y, z: point.z }, true);
      } else if (typeof body.applyImpulse === "function") {
        body.applyImpulse(impulse, true);
      } else return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* the sticky proboscis                                             */
  /* ---------------------------------------------------------------- */
  function headWorld(out) {
    return out.set(position.x, position.y + T.headHeight, position.z);
  }

  const scratchQuat = new THREE.Quaternion();

  function anchorWorld(out) {
    if (grapple.kind === "dynamic" && grapple.body) {
      try {
        const t = grapple.body.translation();
        const r = grapple.body.rotation();
        scratchQuat.set(r.x, r.y, r.z, r.w);
        out.copy(grapple.localOffset).applyQuaternion(scratchQuat);
        out.set(out.x + t.x, out.y + t.y, out.z + t.z);
        return out;
      } catch (error) {
        grapple.kind = "static";
      }
    }
    return out.copy(anchorPoint);
  }

  function fireGrapple() {
    headWorld(aimOrigin);
    const cp = Math.cos(camPitch);
    aimDir.set(-Math.sin(camYaw) * cp, -Math.sin(camPitch), -Math.cos(camYaw) * cp).normalize();
    // Aim from just in front of the snout so we never hit ourselves.
    aimOrigin.addScaledVector(aimDir, T.radius + 0.06);

    const hit = castRay(aimOrigin, aimDir, T.ropeRange);
    if (!hit.hit) return false;

    anchorPoint.copy(hit.point);
    grapple.collider = hit.collider;
    grapple.body = hit.body;
    grapple.localOffset.set(0, 0, 0);
    grapple.kind = "static";
    grapple.joint = null;

    const mass = bodyMass(hit.body);
    if (Number.isFinite(mass)) {
      grapple.kind = "dynamic";
      try {
        const t = hit.body.translation();
        const r = hit.body.rotation();
        const inv = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
        grapple.localOffset
          .set(anchorPoint.x - t.x, anchorPoint.y - t.y, anchorPoint.z - t.z)
          .applyQuaternion(inv);
      } catch (error) {
        grapple.kind = "static";
      }
    }

    headWorld(headPoint);
    grapple.restLength = Math.max(T.ropeMin, headPoint.distanceTo(anchorPoint));
    grapple.attached = true;
    grapple.taut = false;
    grapple.tension = 0;
    grapple.heldTime = 0;
    grapple.dragged = 0;
    grapple.dragBank = 0;

    // If physics.js publishes a rope/joint service, prefer it.
    if (ctx.physics && typeof ctx.physics.attachRope === "function") {
      try {
        grapple.joint = ctx.physics.attachRope({
          from: adapter.body || null,
          fromCollider: adapter.collider || null,
          to: hit.body || null,
          toCollider: hit.collider || null,
          anchor: { x: anchorPoint.x, y: anchorPoint.y, z: anchorPoint.z },
          point: { x: anchorPoint.x, y: anchorPoint.y, z: anchorPoint.z },
          length: grapple.restLength,
          stiffness: T.ropeSpring,
          damping: T.ropeDamp,
        });
      } catch (error) {
        grapple.joint = null;
      }
    }

    ctx.events.emit("player:grapple", {
      from: headPoint.clone(),
      to: anchorPoint.clone(),
      target: grapple.kind,
    });
    if (ctx.tardigrade && ctx.tardigrade.playOneShot) ctx.tardigrade.playOneShot("chomp");
    addTrauma(0.08);
    return true;
  }

  function releaseGrapple(reason) {
    if (!grapple.attached) return;
    if (grapple.joint && ctx.physics && typeof ctx.physics.detachRope === "function") {
      try {
        ctx.physics.detachRope(grapple.joint);
      } catch (error) {
        /* ignore */
      }
    }
    grapple.attached = false;
    grapple.joint = null;
    grapple.body = null;
    grapple.collider = null;
    grapple.taut = false;
    grapple.tension = 0;
    rope.mesh.visible = false;
    ctx.events.emit("player:grapple", { from: null, to: null, target: null, released: reason || true });
  }

  function simulateGrapple(step) {
    if (!grapple.attached) return;
    grapple.heldTime += step;

    headWorld(headPoint);
    anchorWorld(tmpA);
    ropeDir.copy(tmpA).sub(headPoint);
    const dist = ropeDir.length();
    if (dist < 1e-4) return;
    ropeDir.multiplyScalar(1 / dist);

    if (dist > T.ropeBreak) {
      releaseGrapple("snapped");
      addTrauma(0.12);
      return;
    }

    // Reeling: keep the button down after it sticks and you winch in.
    if (ctx.input.down("grapple") && grapple.heldTime > 0.28) {
      grapple.restLength = Math.max(T.ropeMin, grapple.restLength - T.ropeReel * step);
    }

    const stretch = dist - grapple.restLength;
    grapple.taut = stretch > 0;
    grapple.tension = clamp01(stretch / 6);
    if (!grapple.taut) return;

    const mass = bodyMass(grapple.body);
    const heavy = !Number.isFinite(mass) || mass > T.ropeHeavyMass;

    if (heavy) {
      /* --- the anchor wins: reel the hero in, and let them swing --- */
      const radial = velocity.dot(ropeDir);
      // Inextensible: kill outward radial velocity, keep the tangent. That
      // is what turns a rope into a pendulum.
      if (radial < 0) velocity.addScaledVector(ropeDir, -radial * T.ropeSwing);
      const pull = T.ropeSpring * Math.min(stretch, 8) * step;
      velocity.addScaledVector(ropeDir, pull);
      // Damp only along the rope so swings keep their energy.
      const along = velocity.dot(ropeDir);
      velocity.addScaledVector(ropeDir, -along * clamp01(T.ropeDamp * step) * 0.35);
    } else {
      /* --- light prop: it comes with you --- */
      const strength = T.ropeHaul * Math.min(stretch, 5) * step * Math.min(mass, 6);
      tmpB.copy(ropeDir).multiplyScalar(-strength);
      const moved = pushBody(grapple.body, { x: tmpB.x, y: tmpB.y, z: tmpB.z }, tmpA);
      if (moved) {
        // Newton's third law, at a comedic discount.
        velocity.addScaledVector(ropeDir, (strength / Math.max(2, mass)) * 0.22);
        grapple.dragged += Math.abs(stretch) * step * 6;
        grapple.dragBank += Math.abs(stretch) * step * 6;
        if (grapple.dragBank > 7) {
          grapple.dragBank = 0;
          award(90, "PROBOSCIS EXPRESS");
        }
      } else {
        // Static after all - treat it as heavy from now on.
        grapple.kind = "static";
        anchorPoint.copy(tmpA);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* headbutt                                                         */
  /* ---------------------------------------------------------------- */
  function startBonk() {
    if (bonkCooldown > 0 || ragdoll) return;
    bonkTimer = T.bonkTime;
    bonkCooldown = T.bonkCooldown;
    bonkHits = 0;
    bonkResolved = false;
    forward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    if (planar.set(velocity.x, 0, velocity.z).lengthSq() > 4) {
      forward.copy(planar).normalize();
    }
    yaw = Math.atan2(forward.x, forward.z);
    velocity.x += forward.x * T.bonkLunge;
    velocity.z += forward.z * T.bonkLunge;
    if (grounded) velocity.y = Math.max(velocity.y, T.bonkLift);
    addTrauma(0.2);
    if (ctx.tardigrade && ctx.tardigrade.playOneShot) ctx.tardigrade.playOneShot("bonk");
  }

  function resolveBonk() {
    tmpA
      .copy(position)
      .add(tmpB.set(0, T.headHeight, 0))
      .addScaledVector(tmpC.set(Math.sin(yaw), 0, Math.cos(yaw)), T.bonkReach);

    let launched = 0;
    forEachNear(tmpA, T.bonkRadius, (collider) => {
      const body = typeof collider.parent === "function" ? collider.parent() : null;
      if (!body || body === adapter.body) return;
      const mass = bodyMass(body);
      if (!Number.isFinite(mass)) return;
      let bp;
      try {
        bp = body.translation();
      } catch (error) {
        return;
      }
      tmpB.set(bp.x - position.x, bp.y - position.y - T.headHeight * 0.5, bp.z - position.z);
      const d = Math.max(0.3, tmpB.length());
      tmpB.multiplyScalar(1 / d);
      tmpB.y = Math.max(tmpB.y, 0.34);
      tmpB.normalize();
      const power = T.bonkPower * Math.min(mass, 8) * (curled ? 1.5 : 1);
      if (pushBody(body, { x: tmpB.x * power, y: tmpB.y * power, z: tmpB.z * power }, null)) {
        launched += 1;
      }
    });

    if (launched > 0) {
      bonkHits += launched;
      addTrauma(0.34 + Math.min(0.3, launched * 0.08));
      requestHitStop(0.075, 0.14);
      ctx.events.emit("impact", {
        position: tmpA.clone(),
        normal: { x: Math.sin(yaw), y: 0.2, z: Math.cos(yaw) },
        speed: Math.hypot(velocity.x, velocity.z),
        material: "prop",
      });
      const name = BONK_NAMES[Math.min(BONK_NAMES.length - 1, launched - 1)];
      award(110 * launched, name);
    }
  }

  /* ---------------------------------------------------------------- */
  /* ragdoll                                                          */
  /* ---------------------------------------------------------------- */
  let ragdollRig = null;
  if (ctx.physics && typeof ctx.physics.createRagdoll === "function") {
    try {
      ragdollRig = ctx.physics.createRagdoll([
        { name: "core", radius: T.radius, halfHeight: T.halfHeight, offset: [0, 0.38, 0] },
        { name: "snout", radius: 0.16, halfHeight: 0.05, offset: [0, 0.34, 0.5] },
        { name: "tail", radius: 0.2, halfHeight: 0.05, offset: [0, 0.34, -0.52] },
      ]);
    } catch (error) {
      ragdollRig = null;
    }
  }

  function setRagdoll(on, cause) {
    if (on === ragdoll) return;
    ragdoll = on;
    if (on) {
      ragTime = 0;
      ragSettle = 0;
      getUp = 0;
      tumble = 0;
      curled = false;
      releaseGrapple("ragdoll");
      ragSpinYaw = (ctx.rng() - 0.5) * 6;
      addTrauma(0.16);
    } else {
      getUp = T.ragGetUp;
      ragSpinYaw = 0;
    }
    if (ragdollRig && typeof ragdollRig.setEnabled === "function") {
      try {
        ragdollRig.setEnabled(on, position, velocity);
      } catch (error) {
        /* rig unavailable - the procedural flop still runs */
      }
    }
    ctx.events.emit("player:ragdoll", { enabled: on, cause: cause || "input" });
  }

  /* ---------------------------------------------------------------- */
  /* jump                                                             */
  /* ---------------------------------------------------------------- */
  function launchJump() {
    velocity.y = T.jumpSpeed;
    grounded = false;
    coyote = 0;
    jumpBuffer = 0;
    airtime = 0;
    launchY = position.y;
    apexY = position.y;
    spinAccum = 0;
    addTrauma(0.06);
    ctx.events.emit("player:jump", { position: position.clone() });
  }

  /* ---------------------------------------------------------------- */
  /* landing                                                          */
  /* ---------------------------------------------------------------- */
  function onLand(impactSpeed) {
    const surface = slope > 0.35 ? "slope" : "ground";
    ctx.events.emit("player:land", {
      position: position.clone(),
      impactSpeed,
      surface,
    });
    ctx.events.emit("impact", {
      position: position.clone(),
      normal: { x: groundNormal.x, y: groundNormal.y, z: groundNormal.z },
      speed: impactSpeed,
      material: surface,
    });
    if (ctx.tardigrade && ctx.tardigrade.playOneShot) ctx.tardigrade.playOneShot("land");

    addTrauma(clamp01(impactSpeed / 46) * 0.7);
    if (impactSpeed > 22) requestHitStop(0.055, 0.2);

    /* --- score the flight --- */
    const rise = Math.max(0, apexY - launchY);
    if (airtime > T.airTrickTime) {
      const tier = clamp(Math.floor(airtime / 0.75), 0, AIR_NAMES.length - 1);
      award(Math.round(airtime * 95 + rise * 12), AIR_NAMES[tier]);
    }
    const turns = Math.floor(spinAccum / TAU);
    if (turns >= 1) {
      const name = SPIN_NAMES[Math.min(SPIN_NAMES.length - 1, turns - 1)];
      award(150 * turns, name);
    }
    if (impactSpeed > 28) award(Math.round(impactSpeed * 7), "CRATER FORMATION");

    if (!curled && impactSpeed > T.ragImpact) {
      setRagdoll(true, "impact");
      award(80, "UNSCHEDULED DISASSEMBLY");
    }

    bestApex = Math.max(bestApex, rise);
    spinAccum = 0;
    airtime = 0;
  }

  /* ---------------------------------------------------------------- */
  /* near-miss detection                                              */
  /* ---------------------------------------------------------------- */
  const seen = new Set();

  function scanNearMisses(step) {
    nearMissCheck -= step;
    if (nearMissCheck > 0) return;
    nearMissCheck = 0.05;
    if (!shapeQueryOk) return;

    const speed = velocity.length();
    tmpA.set(position.x, position.y + T.headHeight, position.z);
    seen.clear();
    forEachNear(tmpA, T.nearMissRadius, (collider) => {
      const handle = collider.handle !== undefined ? collider.handle : collider;
      seen.add(handle);
      const prev = nearby.get(handle) || 0;
      nearby.set(handle, Math.max(prev, speed));
    });

    for (const [handle, peak] of nearby) {
      if (seen.has(handle)) continue;
      nearby.delete(handle);
      if (peak > T.nearMissSpeed && !nearMissBroken) {
        award(Math.round(peak * 3), "TOO CLOSE FOR MICROBES");
      }
    }
    nearMissBroken = false;
    if (nearby.size > 96) nearby.clear();
  }

  /* ---------------------------------------------------------------- */
  /* FIXED UPDATE - all simulation                                    */
  /* ---------------------------------------------------------------- */
  function fixedUpdate(step) {
    const input = ctx.input;

    /* --- edge detection that survives multiple substeps per frame --- */
    const nowJump = input.down("jump");
    const nowGrapple = input.down("grapple");
    const nowSlam = input.down("slam");
    const nowRag = input.down("ragdoll");
    const nowTun = input.down("tun");

    const pressJump = nowJump && !held.jump;
    const pressGrapple = nowGrapple && !held.grapple;
    const pressSlam = nowSlam && !held.slam;
    const pressRag = nowRag && !held.ragdoll;

    held.jump = nowJump;
    held.grapple = nowGrapple;
    held.slam = nowSlam;
    held.ragdoll = nowRag;
    held.tun = nowTun;
    jumpHeld = nowJump;

    /* --- timers --- */
    if (climbTimer > 0) climbTimer = Math.max(0, climbTimer - step);
    climbPitch = damp(climbPitch, climbTimer > 0 ? 1 : 0, 8, step);
    if (bonkCooldown > 0) bonkCooldown = Math.max(0, bonkCooldown - step);
    if (bonkTimer > 0) {
      bonkTimer -= step;
      // The hit box opens a couple of frames into the lunge so the wind-up
      // reads before anything gets launched.
      if (!bonkResolved && bonkTimer <= T.bonkTime - 0.07) {
        bonkResolved = true;
        resolveBonk();
      }
      if (bonkTimer <= 0) bonkTimer = 0;
    }
    if (combo.timer > 0) {
      combo.timer -= step;
      if (combo.timer <= 0) expireCombo();
    }
    if (getUp > 0) getUp = Math.max(0, getUp - step);
    if (jumpBuffer > 0) jumpBuffer = Math.max(0, jumpBuffer - step);
    if (!grounded && coyote > 0) coyote = Math.max(0, coyote - step);

    /* --- action edges --- */
    if (pressRag) setRagdoll(!ragdoll, "input");
    if (pressGrapple) {
      if (grapple.attached) releaseGrapple("input");
      else if (!ragdoll) fireGrapple();
    }
    if (pressSlam && !ragdoll && getUp <= 0) startBonk();

    /* --- curl / tun is a hold --- */
    const wantCurl = nowTun && !ragdoll && getUp <= 0;
    if (wantCurl && !curled) {
      curled = true;
      curlTime = 0;
      planar.set(velocity.x, 0, velocity.z);
      if (planar.lengthSq() > 0.5) {
        planar.normalize();
        velocity.x += planar.x * T.curlBoost;
        velocity.z += planar.z * T.curlBoost;
      }
      addTrauma(0.06);
    } else if (!wantCurl && curled && curlTime > T.curlMinTime) {
      curled = false;
      if (rollDistance > 14) {
        const tier = clamp(Math.floor(rollDistance / 90), 0, ROLL_NAMES.length - 1);
        award(Math.round(Math.min(rollDistance, 220) * 3), ROLL_NAMES[tier]);
      }
      rollDistance = 0;
      rollBank = 0;
    }
    if (curled) curlTime += step;

    /* --- movement basis from the camera --- */
    forward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    rightAxis.set(Math.cos(camYaw), 0, -Math.sin(camYaw));

    wish
      .set(0, 0, 0)
      .addScaledVector(rightAxis, input.move.x)
      .addScaledVector(forward, -input.move.y);
    const wishLen = wish.length();
    if (wishLen > 1) wish.multiplyScalar(1 / wishLen);
    const throttle = Math.min(1, wishLen);
    const controllable = !ragdoll && getUp <= 0;

    // How deeply the body is in water, 0..1 across roughly one body length,
    // so entering and leaving is a transition rather than a switch.
    submersion = 0;
    if (ctx.world && ctx.world.waterAt) {
      const level = ctx.world.waterAt(position.x, position.z);
      if (level !== null && level !== undefined) {
        submersion = clamp01((level - position.y) / 1.2);
      }
    }
    if (ctx.audio && ctx.audio.setSubmersion) ctx.audio.setSubmersion(submersion);

    /* ============================ ragdoll ============================ */
    if (ragdoll) {
      ragTime += step;
      velocity.y += ctx.GRAVITY * step;
      const flat = Math.hypot(velocity.x, velocity.z);
      if (grounded) {
        const f = Math.max(0, 1 - T.ragFriction * step);
        velocity.x *= f;
        velocity.z *= f;
      }
      tumble += (Math.abs(flat) * 0.6 + 2) * step;
      ragSpinYaw += (flat * 0.5 + 3.2) * step * (ragSpinYaw >= 0 ? 1 : -1);
      if (flat < T.ragSettleSpeed && grounded) ragSettle += step;
      else ragSettle = 0;
      if (ragTime > T.ragMinTime && ragSettle > T.ragSettleTime) setRagdoll(false, "recovered");
    } else if (curled) {
      /* ============================= tun ============================= */
      // Momentum steering: input nudges the ball, it does not aim it.
      if (controllable && throttle > 0.02) {
        velocity.x += wish.x * T.curlAccel * throttle * step;
        velocity.z += wish.z * T.curlAccel * throttle * step;
      }
      const flat = Math.hypot(velocity.x, velocity.z);
      if (flat > T.curlTop) {
        const s = T.curlTop / flat;
        velocity.x *= s;
        velocity.z *= s;
      }
      const roll = Math.max(0, 1 - T.curlRoll * step * (grounded ? 1 : 0.25));
      velocity.x *= roll;
      velocity.z *= roll;
      velocity.y += ctx.GRAVITY * step * (velocity.y < 0 ? T.fallMul : 1);
      rollDistance += flat * step;
      // Rolling banks a trick every so many body lengths of wrecking ball.
      if (grounded && flat > 16) {
        rollBank += flat * step;
        if (rollBank > 45) {
          rollBank = 0;
          const tier = clamp(Math.floor(rollDistance / 90), 0, ROLL_NAMES.length - 1);
          award(120, ROLL_NAMES[tier]);
        }
      }
    } else {
      /* =========================== scuttle =========================== */
      const sprinting = ctx.input.down("sprint");
      const top = sprinting ? T.sprintSpeed : T.walkSpeed;
      const bonking = bonkTimer > 0;

      if (grounded) {
        if (throttle > 0.02 && controllable) {
          tmpA.copy(wish).multiplyScalar(top * throttle);
          let rate = bonking ? T.accelRate * 0.35 : T.accelRate;
          if (submersion > 0.01) rate *= 1 - submersion * (1 - T.waterMove);
          velocity.x = damp(velocity.x, tmpA.x, rate, step);
          velocity.z = damp(velocity.z, tmpA.z, rate, step);
        } else {
          velocity.x = damp(velocity.x, 0, T.brakeRate, step);
          velocity.z = damp(velocity.z, 0, T.brakeRate, step);
        }
      } else if (controllable) {
        if (throttle > 0.02) {
          tmpA.copy(wish).multiplyScalar(top * throttle);
          velocity.x = damp(velocity.x, tmpA.x, T.airAccelRate, step);
          velocity.z = damp(velocity.z, tmpA.z, T.airAccelRate, step);
        } else {
          velocity.x = damp(velocity.x, 0, T.airBrakeRate, step);
          velocity.z = damp(velocity.z, 0, T.airBrakeRate, step);
        }
      }

      /* --- jump: buffering, coyote, anticipation crouch, variable height --- */
      if (pressJump && controllable) jumpBuffer = T.jumpBuffer;

      if (anticipation > 0) {
        anticipation -= step;
        if (anticipation <= 0) {
          anticipation = 0;
          launchJump();
        }
      } else if (jumpBuffer > 0 && (grounded || coyote > 0) && controllable) {
        // Commit now; the pop lands a frame or two later so it has weight.
        anticipation = T.anticipation;
        jumpBuffer = 0;
        coyote = 0;
      }

      /* --- gravity with a snappy fall and a variable-height cut --- */
      let g = ctx.GRAVITY;
      if (submersion > 0.01) g *= 1 - submersion * 0.55;   // the water holds you up
      // Hanging off a face, not falling off one.
      else if (climbTimer > 0 && velocity.y > -1) g *= 0.22;
      else if (velocity.y < 0) g *= T.fallMul;
      else if (velocity.y > 0 && !jumpHeld) g *= T.jumpCut;
      velocity.y += g * step;
      if (velocity.y < -T.terminal) velocity.y = -T.terminal;

      /* --- buoyancy and drag --- */
      if (submersion > 0.01) {
        velocity.y += T.buoyancy * submersion * step;
        if (jumpHeld && controllable) velocity.y += T.swimUp * submersion * step;
        // Drag is applied as a per-step fraction and clamped, so a long
        // frame cannot invert the velocity.
        const d = Math.min(0.9, T.waterDrag * submersion * step);
        velocity.x -= velocity.x * d;
        velocity.z -= velocity.z * d;
        velocity.y -= velocity.y * d * 0.7;
      }
    }

    /* --- the rope acts on whatever state we are in --- */
    simulateGrapple(step);

    /* --- how much of the intended step is the world eating? --- */
    const preY = velocity.y;
    delta.copy(velocity).multiplyScalar(step);
    const moved = adapter.move(delta, step);

    position.x += moved.dx;
    position.y += moved.dy;
    position.z += moved.dz;

    {
      // The VECTOR difference, not the speed difference. Sliding along a
      // wall barely changes speed - the body keeps moving at nearly the
      // full rate, just sideways - so "1 - got/wanted" reads ~0 against a
      // wall and is useless here. What actually distinguishes a wall is how
      // far the achieved step was deflected from the intended one.
      const wanted = Math.hypot(delta.x, delta.z);
      const eaten = Math.hypot(delta.x - moved.dx, delta.z - moved.dz);
      const got = Math.hypot(moved.dx, moved.dz);
      const now = wanted > 1e-4 ? clamp01(eaten / wanted) : 0;
      // Actual ground speed achieved this step, which stays honest whether
      // the body is sliding along an obstacle or jammed dead against it.
      // Slow AND obstructed. Requiring some deflection is what separates
      // "jammed against something" from "just started walking": a standing
      // start is equally slow but has nothing in its way (measured 0.08
      // deflection, against 0.24 while stuck on a blade). Without that
      // second term the animal climbs every time it sets off.
      if (throttle > 0.05 && controllable
          && got / step < T.climbStuckSpeed && now > 0.1) {
        pressTime += step;
      } else {
        pressTime = 0;
      }
      // Count consecutive frames rather than smoothing. Wall contact while
      // climbing is intermittent - the body touches, rides up, drifts off -
      // so an exponential average washes it to nothing (measured 0.04 at a
      // wall the instantaneous signal was hitting 0.50 against). Two frames
      // in a row was tried and never triggered - even at a wall the 0.50
      // spikes land on isolated frames - so the threshold does the work on
      // its own. It sits in a measured gap: 0.23 on the flattest ground in
      // the world, 0.50 pressed against the bottle cap rim.
      if (throttle > 0.05 && controllable && now > T.climbStall) stallFrames += 1;
      else stallFrames = 0;
      stall = now;
      dbgBlockedFrac = now;
    }

    wasGrounded = grounded;
    grounded = moved.grounded;
    slope = moved.slope || 0;
    if (moved.normal) groundNormal.copy(moved.normal);

    /* --- resolve blocked vertical motion (once) --- */
    const blockedDown = delta.y < 0 && moved.dy > delta.y + 1e-6;
    const blockedUp = delta.y > 0 && moved.dy < delta.y - 1e-6;
    if (blockedUp) {
      velocity.y = Math.min(velocity.y, 0); // clonked our head
    } else if (blockedDown || (grounded && velocity.y < 0)) {
      if (curled && velocity.y < -3.5) {
        velocity.y = -velocity.y * T.curlBounce; // the tun bounces
        addTrauma(clamp01(-preY / 40) * 0.25);
      } else {
        velocity.y = 0;
      }
    }

    // Horizontal blocking: bounce when curled, slide otherwise. The
    // controller already slides, so all we do is remove the component that
    // was eaten, which is what stops the "glued to a wall" feeling.
    const blockedX = delta.x - moved.dx;
    const blockedZ = delta.z - moved.dz;
    if (Math.abs(blockedX) > 1e-5 || Math.abs(blockedZ) > 1e-5) {
      tmpA.set(blockedX, 0, blockedZ);
      const blockedLen = tmpA.length();
      if (blockedLen > 1e-5) {
        tmpA.multiplyScalar(1 / blockedLen);
        const into = velocity.x * tmpA.x + velocity.z * tmpA.z;
        dbgInto = into;
        if (into > 0) {
          const k = curled ? 1 + T.curlBounce : 1;
          // Remove what the obstruction ACTUALLY ate, not the whole
          // component along it. Normalising `tmpA` throws the magnitude
          // away, so the old form cancelled exactly as much speed for a
          // blocked sliver of 1e-5 units as for a head-on wall. The
          // controller shaves such a sliver on every step of ordinary
          // ground - slope projection, the skin offset, snap-to-ground -
          // and its direction is the direction of travel, so walking on
          // FLAT terrain had its entire forward velocity deleted several
          // times a second. Traced at (-160, 240): deflection 0.0000 while
          // `into` spiked to 9.28, velocity sawtoothing 10.8 -> 6.6 -> 0.8
          // and averaging 5.0 against a walk speed of 13.5. Airborne steps
          // are never clipped, so jumping kept its speed - which is exactly
          // why holding W crawled while spamming jump ran.
          //
          // blockedLen is a distance over one step, so it converts to the
          // speed the obstruction removed. Capping at `into` keeps a real
          // wall fully cancelling (there blockedLen/step == into) and stops
          // the slide from ever reversing the body.
          const cut = Math.min(into, blockedLen / step) * k;
          velocity.x -= tmpA.x * cut;
          velocity.z -= tmpA.z * cut;
          // A real wall only. The character controller shaves a sliver off
          // horizontal motion on ANY uneven ground - slope projection,
          // friction, micro-contacts - so the old test ("was anything eaten
          // at all") fired the climb every single frame on flat terrain and
          // set velocity.y to climbSpeed continuously. That turned ordinary
          // crawling into permanent hopping without the player touching jump.
          if (!curled && controllable && throttle > 0.05 && stallFrames >= 1) {
            // Only ARM the climb here. Applying the lift on detection frames
            // alone produced a 0.5-unit twitch rather than a climb, because
            // contact is intermittent and gravity ate the impulse in between.
            climbTimer = T.climbLatch;
            climbDir.copy(tmpA);
          }
          if (curled && into > 12) {
            addTrauma(clamp01(into / 40) * 0.4);
            award(70, "RICOCHET");
            nearMissBroken = true;
            if (ctx.tardigrade && ctx.tardigrade.playOneShot) ctx.tardigrade.playOneShot("bonk");
          }
        }
      }
    }

    /* --- jammed head-on: climb out of it --- */
    if (pressTime > T.climbPressTime && !curled && controllable && throttle > 0.05) {
      climbTimer = T.climbLatch;
      climbDir.set(wish.x, 0, wish.z);
      if (climbDir.lengthSq() > 1e-6) climbDir.normalize();
    }

    /* --- sustain the climb between contacts --- */
    // The latch carries the animal for climbLatch seconds after each touch,
    // and any further contact refreshes it, so an intermittent series of
    // brushes against a wall reads as one continuous ascent. climbPress
    // keeps the body leaning into the face; without it the slide frees the
    // body, the next frame is unobstructed and the climb drops out.
    if (climbTimer > 0 && !curled && controllable && throttle > 0.05) {
      velocity.y = Math.max(velocity.y, T.climbSpeed);
      velocity.x += climbDir.x * T.climbPress * step;
      velocity.z += climbDir.z * T.climbPress * step;
    }

    /* --- ground / air bookkeeping --- */
    if (grounded) {
      coyote = T.coyote;
      if (!wasGrounded) {
        const impact = Math.abs(Math.min(preY, 0));
        onLand(impact);
      }
      airtime = 0;
    } else {
      airtime += step;
      apexY = Math.max(apexY, position.y);
      if (wasGrounded) {
        launchY = position.y;
        apexY = position.y;
      }
    }

    /* --- facing --- */
    prevYaw = yaw;
    if (ragdoll) {
      yaw += ragSpinYaw * step * T.ragSpin * 0.18;
    } else if (curled) {
      planar.set(velocity.x, 0, velocity.z);
      if (planar.lengthSq() > 0.6) yaw = dampAngle(yaw, Math.atan2(planar.x, planar.z), 9, step);
    } else if (throttle > 0.05 && controllable) {
      // Face where the CAMERA looks, not where the body is travelling.
      // Turning to the wish direction meant S spun the animal 180 degrees
      // and A/D swung it sideways, so there was no way to back off from
      // something while still watching it. Aligning to the camera gives
      // strafe on A/D and a backpedal on S, and W still runs straight ahead
      // because forward IS the camera's forward.
      yaw = dampAngle(yaw, Math.atan2(forward.x, forward.z), T.faceTurnRate, step);
    } else if (bonkTimer > 0) {
      planar.set(velocity.x, 0, velocity.z);
      if (planar.lengthSq() > 1) yaw = dampAngle(yaw, Math.atan2(planar.x, planar.z), 10, step);
    }
    const yawStep = wrapAngle(yaw - prevYaw);
    turnRate = yawStep / step;
    // Spins only count in the air; tumbling while curled/limp counts double
    // because it looks twice as stupid.
    if (!grounded) spinAccum += Math.abs(yawStep) * (ragdoll || curled ? 1.5 : 1);

    /* --- keep the hero inside the world ---
       This used to clamp to a CIRCLE of bounds.radius on a map that is
       square, so the whole corner region - a legal, rendered, walkable
       third of the level - was outside the limit and got projected
       radially inwards. Standing at (-390, 380) teleported the hero 96
       units to (-321, 313) the instant he was placed there.

       It also scaled x and z while leaving y alone, which is how he ended
       up INSIDE the patio: at the destination the slab surface is 16.7 and
       he arrived still carrying the y of 15.7 he had at the old spot, i.e.
       a metre under the floor, and then simply fell to the terrain
       underneath. Clamp to the actual square, and never reinsert the hero
       below the surface he is being moved onto. */
    const bounds = ctx.world && ctx.world.bounds;
    if (bounds) {
      const margin = 1.5;
      let moved = false;
      if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
        const nx = clamp(position.x, bounds.min[0] + margin, bounds.max[0] - margin);
        const nz = clamp(position.z, bounds.min[1] + margin, bounds.max[1] - margin);
        if (nx !== position.x || nz !== position.z) {
          position.x = nx;
          position.z = nz;
          moved = true;
        }
      } else if (bounds.radius) {
        const limit = bounds.radius - margin;
        const r = Math.hypot(position.x, position.z);
        if (r > limit) {
          const s = limit / r;
          position.x *= s;
          position.z *= s;
          moved = true;
        }
      }
      if (moved) {
        velocity.x *= 0.2;
        velocity.z *= 0.2;
        const surface = ctx.world && ctx.world.heightAt
          ? ctx.world.heightAt(position.x, position.z)
          : null;
        if (surface !== null && position.y < surface + 0.8) position.y = surface + 0.8;
        adapter.setPosition(position);
      }
    }
    // Safety net: never let the hero escape below the world.
    const floor = ctx.world && ctx.world.heightAt ? ctx.world.heightAt(position.x, position.z) : 0;
    if (position.y < floor - 30) {
      position.set(spawn.x, floor + 6, spawn.z);
      velocity.set(0, 0, 0);
      adapter.setPosition(position);
      grounded = false;
    }

    scanNearMisses(step);
  }

  /* ---------------------------------------------------------------- */
  /* rope geometry                                                    */
  /* ---------------------------------------------------------------- */
  const ropeA = new THREE.Vector3();
  const ropeB = new THREE.Vector3();
  const ropeP = new THREE.Vector3();
  const ropeQ = new THREE.Vector3();
  const ropeTan = new THREE.Vector3();
  const ropeSide = new THREE.Vector3();
  const ropeUp = new THREE.Vector3();
  const REF_UP = new THREE.Vector3(0, 1, 0);
  const REF_ALT = new THREE.Vector3(1, 0, 0);
  let ropeSagAmount = 0;

  /** The strand hangs in a catenary-ish arc that flattens as it goes taut. */
  function ropePoint(t, out) {
    out.copy(ropeA).lerp(ropeB, t);
    out.y -= ropeSagAmount * 4 * t * (1 - t);
    return out;
  }

  function updateRope() {
    if (!grapple.attached) {
      rope.mesh.visible = false;
      return;
    }
    headWorld(ropeA);
    anchorWorld(ropeB);
    const span = ropeA.distanceTo(ropeB);
    const slack = Math.max(0, grapple.restLength - span);
    ropeSagAmount = Math.min(4.5, slack * 0.42 + 0.16);

    const thinning = 1 - grapple.tension * 0.42;
    const attr = rope.geometry.getAttribute("position");
    const nattr = rope.geometry.getAttribute("normal");

    for (let s = 0; s <= ROPE_SEGS; s += 1) {
      const t = s / ROPE_SEGS;
      ropePoint(t, ropeP);
      ropePoint(Math.min(1, t + 0.02), ropeQ);
      if (t > 0.98) ropePoint(t - 0.02, ropeQ).sub(ropeP).multiplyScalar(-1).add(ropeP);
      ropeTan.copy(ropeQ).sub(ropeP);
      if (ropeTan.lengthSq() < 1e-8) ropeTan.set(0, 1, 0);
      ropeTan.normalize();
      ropeSide.crossVectors(ropeTan, Math.abs(ropeTan.y) > 0.94 ? REF_ALT : REF_UP);
      if (ropeSide.lengthSq() < 1e-8) ropeSide.set(1, 0, 0);
      ropeSide.normalize();
      ropeUp.crossVectors(ropeSide, ropeTan).normalize();

      // Thicker where it leaves the snout, tapering to a sticky tip.
      const radius = lerp(0.085, 0.032, t) * thinning;
      for (let r = 0; r < ROPE_SIDES; r += 1) {
        const a = (r / ROPE_SIDES) * TAU;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const nx = ropeSide.x * cx + ropeUp.x * cy;
        const ny = ropeSide.y * cx + ropeUp.y * cy;
        const nz = ropeSide.z * cx + ropeUp.z * cy;
        const i = (s * ROPE_SIDES + r) * 3;
        rope.positions[i] = ropeP.x + nx * radius;
        rope.positions[i + 1] = ropeP.y + ny * radius;
        rope.positions[i + 2] = ropeP.z + nz * radius;
        rope.normals[i] = nx;
        rope.normals[i + 1] = ny;
        rope.normals[i + 2] = nz;
      }
    }
    attr.needsUpdate = true;
    nattr.needsUpdate = true;
    rope.mesh.visible = true;
  }

  /* ---------------------------------------------------------------- */
  /* UPDATE - pose, camera, juice                                     */
  /* ---------------------------------------------------------------- */
  function update(dt) {
    const realDt = ctx.time.dt || dt;

    /* --- hit-stop resolves on unscaled time and always restores 1 --- */
    if (hitStop > 0) {
      hitStop -= realDt;
      if (hitStop <= 0) {
        hitStop = 0;
        ctx.time.timeScale = hitStopRestore;
        hitStopRestore = 1;
      }
    }

    /* --- look input drives our own yaw/pitch even when the QA camera
           owns ctx.camera, so gameplay never freezes --- */
    const look = ctx.input.look;
    if (Math.abs(look.x) > 1e-6 || Math.abs(look.y) > 1e-6) {
      camYaw -= look.x;
      camPitch = clamp(camPitch + look.y, T.camPitchMin, T.camPitchMax);
      lookIdle = 0;
    } else {
      lookIdle += realDt;
    }

    const hSpeed = Math.hypot(velocity.x, velocity.z);
    const speedT = clamp01(hSpeed / T.sprintSpeed);

    /* --- lazy auto-recentre behind the hero --- */
    if (lookIdle > 1.1 && grounded && hSpeed > 6 && !ragdoll) {
      // Recentre behind the BODY, not behind its velocity. The body now
      // faces wherever the camera looks, so strafing and backpedalling send
      // velocity off at an angle to it - and recentring behind velocity
      // would swing the camera round to chase that. Because movement is
      // camera-relative, the swing feeds straight back into the movement
      // basis and walks the player in a slow circle while they hold one key.
      // Behind the body this is a fixed point (yaw is itself camYaw + PI),
      // so holding A just strafes. A rolling tun does steer with its
      // velocity, so that case keeps the old behaviour.
      let target;
      if (curled) {
        planar.set(velocity.x, 0, velocity.z).normalize();
        target = Math.atan2(-planar.x, -planar.z);
      } else {
        target = yaw + Math.PI;
      }
      camYaw = dampAngle(camYaw, target, T.camRecenter, dt);
    }

    /* --- hero visuals --- */
    if (ctx.tardigrade) {
      ctx.tardigrade.root.position.copy(position);
      ctx.tardigrade.setFacing(yaw);
      // Nose up, belly to the wall. Rotating local +Z (forward) onto +Y is a
      // rotation of -90 degrees about X.
      if (ctx.tardigrade.setTilt) ctx.tardigrade.setTilt(-climbPitch * Math.PI * 0.5);
      ctx.tardigrade.setPose({
        speed: hSpeed / T.sprintSpeed,
        grounded,
        airborne: !grounded,
        curled,
        ragdoll,
        turnRate,
        // extras a richer character rig can use; harmless if ignored
        crouch: anticipation > 0 ? 1 : 0,
        bonk: bonkTimer > 0 ? clamp01(bonkTimer / T.bonkTime) : 0,
        grappling: grapple.attached,
        tumble,
        verticalSpeed: velocity.y,
      });
    }

    updateRope();

    /* --- trauma decay --- */
    if (trauma > 0) trauma = Math.max(0, trauma - T.traumaDecay * realDt);
    shakeTime += realDt * T.shakeFreq;

    if (ctx.qa && ctx.qa.cameraLocked) return; // the harness owns the camera

    /* ---------------- camera rig ---------------- */
    const camera = ctx.camera;
    if (!camera) return;

    /* pivot height + distance depend on what the hero is doing */
    let pivotH = T.camPivot;
    let wantDist = T.camDist + speedT * 2.6;
    let pitchBias = 0;
    if (curled) {
      pivotH = 1.05;
      wantDist = 9.4 + speedT * 2.2;
      pitchBias = 0.05;
    } else if (ragdoll) {
      pivotH = 1.25;
      wantDist = 8.2;
      pitchBias = 0.15;
    }
    if (grapple.attached) wantDist += 1.7;
    if (bonkTimer > 0) wantDist -= 1.2;

    /* look-ahead so you see where you are going, not where you were */
    tmpA.set(velocity.x, velocity.y * 0.24, velocity.z).multiplyScalar(T.camLead);
    if (tmpA.length() > T.camLeadMax) tmpA.setLength(T.camLeadMax);
    camLead.lerp(tmpA, 1 - Math.exp(-5 * dt));

    camPivot.set(position.x, position.y + pivotH, position.z).add(camLead);

    /* the framing target biases towards the rope so the strand reads */
    if (grapple.attached) {
      anchorWorld(tmpB);
      tmpB.sub(camPivot).multiplyScalar(0.16);
      if (tmpB.length() > 3) tmpB.setLength(3);
      camPivot.add(tmpB);
    }

    camDist = damp(camDist, wantDist, 4.5, dt);

    const pitch = clamp(camPitch + pitchBias, T.camPitchMin, T.camPitchMax);
    const horiz = Math.cos(pitch) * camDist;
    camGoal.set(
      camPivot.x + Math.sin(camYaw) * horiz,
      camPivot.y + Math.sin(pitch) * camDist,
      camPivot.z + Math.cos(camYaw) * horiz
    );

    /* --- collision: never let the camera get inside the world --- */
    tmpA.copy(camGoal).sub(camPivot);
    const goalDist = tmpA.length();
    if (goalDist > 1e-4) {
      tmpA.multiplyScalar(1 / goalDist);
      const hit = castRay(camPivot, tmpA, goalDist + 0.45);
      if (hit.hit && hit.distance < goalDist) {
        camGoal.copy(camPivot).addScaledVector(tmpA, Math.max(T.camMinDist, hit.distance - 0.4));
      }
    }

    if (!camPrimed) {
      camPos.copy(camGoal);
      camLook.copy(camPivot);
      camPrimed = true;
    }

    /* spring-damped follow: snappier when close, softer when trailing */
    const smooth = T.camSmooth * (grapple.attached ? 0.8 : 1) * (bonkTimer > 0 ? 0.7 : 1);
    camPos.x = smoothDamp(camPos.x, camGoal.x, camVel, "x", smooth, dt);
    camPos.y = smoothDamp(camPos.y, camGoal.y, camVel, "y", smooth * 1.15, dt);
    camPos.z = smoothDamp(camPos.z, camGoal.z, camVel, "z", smooth, dt);

    camLook.x = smoothDamp(camLook.x, camPivot.x, lookVel, "x", T.camLookSmooth, dt);
    camLook.y = smoothDamp(camLook.y, camPivot.y, lookVel, "y", T.camLookSmooth, dt);
    camLook.z = smoothDamp(camLook.z, camPivot.z, lookVel, "z", T.camLookSmooth, dt);

    /* --- sway + shake --- */
    const shake = trauma * trauma;
    const sway = 0.045 + speedT * 0.14;
    const nx = noise1(shakeTime, 0);
    const ny = noise1(shakeTime, 1);
    const nz = noise1(shakeTime, 2);
    const sx = noise1(ctx.time.elapsed * 0.55, 3);
    const sy = noise1(ctx.time.elapsed * 0.43, 4);

    camera.position.set(
      camPos.x + nx * shake * T.shakePos + sx * sway * 0.4,
      camPos.y + ny * shake * T.shakePos + sy * sway * 0.3,
      camPos.z + nz * shake * T.shakePos
    );
    camera.lookAt(
      camLook.x + nz * shake * 0.3 + sx * sway * 0.2,
      camLook.y + nx * shake * 0.3,
      camLook.z + ny * shake * 0.3
    );

    /* bank into turns, and roll on impact */
    const bankTarget = clamp(-turnRate * 0.035, -0.16, 0.16) * speedT + noise1(shakeTime, 5) * shake * T.shakeRot;
    camRoll = damp(camRoll, bankTarget, 7, dt);
    camera.rotateZ(camRoll);

    /* FOV opens up with speed, punches in on a bonk */
    const baseFov = ctx.settings ? ctx.settings.fov : 62;
    let wantFov = baseFov + speedT * T.camFovSpeed;
    if (curled) wantFov += 4;
    if (bonkTimer > 0) wantFov += 7 * clamp01(bonkTimer / T.bonkTime);
    if (grapple.attached && grapple.taut) wantFov += 4 * grapple.tension;
    camFov = damp(camFov, wantFov, 6, dt);
    if (Math.abs(camera.fov - camFov) > 0.01) {
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }

    if (ctx.engine && ctx.engine.setFocus) ctx.engine.setFocus(camLook);
  }

  /* ---------------------------------------------------------------- */
  /* public API                                                       */
  /* ---------------------------------------------------------------- */
  const api = {
    position,
    velocity,

    teleport(x, y, z) {
      position.set(x, y, z);
      velocity.set(0, 0, 0);
      adapter.setPosition(position);
      releaseGrapple("teleport");
      if (ragdoll) setRagdoll(false, "teleport");
      getUp = 0;
      grounded = false;
      wasGrounded = false;
      airtime = 0;
      coyote = 0;
      jumpBuffer = 0;
      anticipation = 0;
      spinAccum = 0;
      launchY = y;
      apexY = y;
      camPrimed = false;
      nearby.clear();
    },

    /** Aim helper for other systems / debug: where the proboscis would go. */
    aimDirection(out = new THREE.Vector3()) {
      const cp = Math.cos(camPitch);
      return out.set(-Math.sin(camYaw) * cp, -Math.sin(camPitch), -Math.cos(camYaw) * cp).normalize();
    },

    get yaw() { return yaw; },
    get cameraYaw() { return camYaw; },
    get grounded() { return grounded; },
    get curled() { return curled; },
    get ragdoll() { return ragdoll; },
    get grappled() { return grapple.attached; },

    addTrauma,
    hitStop: requestHitStop,
    awardScore: award,

    fixedUpdate,
    update,

    report() {
      const hSpeed = Math.hypot(velocity.x, velocity.z);
      let state = "idle";
      if (ragdoll) state = "ragdoll";
      else if (getUp > 0) state = "getup";
      else if (curled) state = "tun";
      else if (bonkTimer > 0) state = "bonk";
      else if (!grounded) state = velocity.y > 0 ? "rising" : "falling";
      else if (hSpeed > 0.6) state = ctx.input.down("sprint") ? "sprint" : "scuttle";

      return {
        state,
        grounded,
        airborne: !grounded,
        speed: Number(hSpeed.toFixed(2)),
        verticalSpeed: Number(velocity.y.toFixed(2)),
        airtime: Number(airtime.toFixed(3)),
        coyote: Number(coyote.toFixed(3)),
        bufferedJump: jumpBuffer > 0 || anticipation > 0,
        apex: Number(bestApex.toFixed(2)),
        curled,
        ragdoll,
        getUp: Number(getUp.toFixed(3)),
        grappled: grapple.attached,
        ropeLength: Number(grapple.restLength.toFixed(2)),
        ropeTaut: grapple.taut,
        ropeKind: grapple.attached ? grapple.kind : "none",
        combo: combo.count,
        multiplier: combo.multiplier,
        comboTimer: Number(Math.max(0, combo.timer).toFixed(2)),
        score: ctx.state.score,
        lastTrick,
        lastTrickAge: Number((ctx.time.elapsed - lastTrickAt).toFixed(2)),
        trauma: Number(trauma.toFixed(3)),
        timeScale: Number(ctx.time.timeScale.toFixed(3)),
        hitStop: Number(hitStop.toFixed(3)),
        climb: Number(climbTimer.toFixed(3)),
        press: Number(pressTime.toFixed(2)),
        blockedFrac: Number(dbgBlockedFrac.toFixed(2)),
        into: Number(dbgInto.toFixed(2)),
        submersion: Number(submersion.toFixed(2)),
        slope: Number(slope.toFixed(3)),
        yaw: Number(yaw.toFixed(3)),
        camYaw: Number(camYaw.toFixed(3)),
        camPitch: Number(camPitch.toFixed(3)),
        camDist: Number(camDist.toFixed(2)),
        controller: adapter.kind,
        position: {
          x: Number(position.x.toFixed(2)),
          y: Number(position.y.toFixed(2)),
          z: Number(position.z.toFixed(2)),
        },
      };
    },

    dispose() {
      releaseGrapple("dispose");
      if (rope.mesh.parent) rope.mesh.parent.remove(rope.mesh);
      adapter.dispose();
      if (ctx.time.timeScale !== 1 && hitStop > 0) ctx.time.timeScale = 1;
    },
  };

  // Prime the controller at the spawn point.
  adapter.setPosition(position);
  camPitch = 0.26;
  camYaw = 0;

  return api;
}
