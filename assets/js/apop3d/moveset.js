/* ============================================================
   APOP DEMON MOGGERS 3D - moveset

   The SM64-class action table, as a pure state machine.

   Nothing in here imports three, touches the scene graph or knows
   what a bone is. It reads an input intent and a physics body, and
   it writes a velocity and a facing. That constraint is not
   tidiness for its own sake: this is the module that decides
   whether the game feels right, and the only way to iterate on
   feel at the speed it needs is to be able to run it headlessly,
   a thousand simulated jumps at a time, with no renderer attached.

   ------------------------------------------------------------
   WHY A STATE MACHINE AND NOT A PILE OF FLAGS

   Mario's moveset is not "walking, plus modifiers". A long jump is
   not a jump with more speed - it is a distinct action with its own
   arc, its own steering rules (none), its own landing consequence
   and its own way of being entered. Modelling those as booleans on
   a single controller produces the classic failure where holding
   crouch during a wall kick does something nobody designed. Each
   action here owns its enter/update/exit and states what it may
   become. If a transition is not written down, it cannot happen.

   ------------------------------------------------------------
   THE THREE PROPERTIES THAT CARRY THE FEEL

   1. FORGIVENESS AT THE EDGES. Jump buffering (120ms) and coyote
      time (100ms). The triple jump is a three-link chain of frame-
      accurate inputs; without both windows the chain is not hard,
      it is broken, and players read it as the game ignoring them.

   2. NOTHING SNAPS. Ground acceleration is 28 m/s^2, air is 8, and
      friction is a per-surface exponential decay. Velocity is never
      assigned from the stick. The one exception is a deliberate
      launch (long jump, wall kick, dive), where the snap IS the
      event.

   3. TURN RATE FALLS OFF WITH SPEED. At a walk you pivot on the
      spot; at a run you carve a wide arc and have to skid to
      reverse. This single property is most of why SM64 movement
      feels like it has mass, and it is why `skid` is a real
      deceleration state rather than an instant about-face.

   ------------------------------------------------------------
   BUTTON MAP - the non-obvious pairings

   The contract gives us `jump crouch pound beam aura`. SM64 gets its
   acrobatics out of A/B/Z overlaps, so ours come out of overlaps
   too, and the assignments below are chosen so that no two of them
   are reachable from the same situation:

     crouch (still)      -> crouch / crawl
     crouch (at speed)   -> crouchSlide, the long jump launcher
     crouch + jump still -> backflip
     crouch + jump fast  -> longJump
     crouch (airborne)   -> dive          (never a ground action, so
                                           it can never eat a long jump)
     jump (reversing)    -> sideFlip
     jump (near a wall)  -> wallKick
     pound (airborne)    -> groundPound
     beam / aura         -> the Mog verbs, ground or air

   ------------------------------------------------------------
   ORDERING. `moveset.update` runs BEFORE physics (contract §4): it
   decides and writes velocity. `player.js` calls `postPhysics` after
   the integrator has resolved, which is where landings, wall
   contacts and ledges are detected - reacting to a resolve from the
   previous frame would put a frame of lag on the single most
   timing-sensitive event in the game.
   ============================================================ */

import {
  clamp, clamp01, lerp, damp, dampAngle, angleDelta, approach,
} from "apop3d/core.js";

/* ============================================================
   TUNING

   Anchored on CONTRACT §5. The numbers marked "contract" are not
   ours to move; everything else was tuned against them.

   Jump velocities are quoted as launch speeds because that is what
   the code applies, but the number that matters is the apex, which
   is v^2 / (2g). At g = 22 that gives 0.61m / 0.99m / 1.53m for the
   single / double / triple. The gaps have to be large enough to
   read at a glance from a fixed camera - a 10% height gain looks
   like a mistake, a 55% gain looks like a reward.
   ============================================================ */

export const TUNING = {
  gravity: 22.0,          // contract §5, m/s^2, positive magnitude
  walkSpeed: 3.2,         // contract §5
  runSpeed: 7.4,          // contract §5
  longJumpSpeed: 13.0,    // contract §5, horizontal launch
  capsuleRadius: 0.32,    // contract §5
  bodyHeight: 1.7,        // contract §5

  crawlSpeed: 1.5,
  groundAccel: 28.0,
  airAccel: 8.0,
  slideAccel: 16.0,

  /* Speed-dependent turn rate, in radians/second of exponential
     damping. 16 rad/s at a standstill is a pivot; 4.2 at a full run
     is a carve you have to plan. */
  turnRateStill: 16.0,
  turnRateRun: 4.2,
  turnRateAir: 6.5,

  /* Skid. Entered when the stick opposes travel by more than
     SKID_DOT while moving faster than skidMinSpeed. It is a real
     state with a real deceleration because an instant 180 at 7 m/s
     is the single loudest "this is a prototype" tell in movement. */
  skidDot: -0.35,
  skidMinSpeed: 4.0,
  skidDecel: 34.0,
  skidExitSpeed: 1.3,
  turnaroundTime: 0.15,

  jumpSpeed: 5.2,
  doubleJumpSpeed: 6.6,
  tripleJumpSpeed: 8.2,
  jumpCut: 0.42,          // vy multiplier when jump is released early
  jumpChainWindow: 0.25,  // seconds after landing to extend the chain
  doubleMinSpeed: 1.5,
  tripleMinSpeed: 3.0,

  longJumpUp: 4.6,
  /* The long jump is the one arc that cheats gravity, and it has to.
     At full 22 m/s^2 a 13 m/s launch that stays visually LOW covers
     about 4m, which is not a long jump - it is a hop with a silly
     animation. Scaling gravity to 0.58 for the duration buys a 9m
     gap at an apex (0.73m) still below the double jump, which is the
     shape players actually remember: flat, fast, and committing. */
  longJumpGravityScale: 0.58,
  longJumpMinSpeed: 4.6,

  backflipUp: 7.6,
  backflipBack: 4.6,
  sideFlipUp: 6.9,
  sideFlipSpeed: 5.2,
  sideFlipMinSpeed: 3.2,
  sideFlipDot: -0.5,

  wallSlideFall: -3.2,    // terminal fall speed while hugging a wall
  wallKickUp: 6.2,
  wallKickKeep: 0.80,     // fraction of mirrored speed retained
  wallKickPush: 4.5,      // extra speed straight out along the normal
  wallCoyote: 0.20,       // grace after leaving a wall
  wallRepeatDot: 0.62,    // a second kick needs a genuinely new wall
  wallMinApproach: 0.5,   // must be moving INTO the wall to arm a kick

  diveUp: 1.4,
  diveSpeed: 9.6,
  diveGravityScale: 0.86,
  bellySlideFriction: 0.42,
  rollTime: 0.42,
  getUpTime: 0.38,

  poundFreeze: 0.22,      // the pause at the top - the whole point
  poundSpeed: 24.0,
  poundRecover: 0.34,

  jumpBuffer: 0.12,       // contract §9: 120ms
  coyoteTime: 0.10,       // contract §9: 100ms

  hardLandSpeed: 14.0,
  hardLandTime: 0.42,
  fidgetDelay: 8.0,
  fidgetTime: 1.9,

  beamCharge: 0.09,
  beamTime: 0.26,
  beamCooldown: 0.30,
  beamRange: 22.0,
  beamDamage: 1.0,
  beamOnBeatBonus: 1.6,   // on-beat firing is the game's timing verb
  auraTime: 0.85,
  auraCost: 1.0,

  hurtTime: 0.5,
  knockbackTime: 0.62,
  knockbackSpeed: 6.0,
  knockbackUp: 4.2,
  invulnTime: 1.25,

  swimSpeed: 3.4,
  swimAccel: 6.0,
  swimRise: 2.6,
  swimSink: -0.9,
  treadDepth: 1.0,        // waterDepth below which we stand instead
  breathSeconds: 22.0,

  stepLength: 1.05,       // metres of travel per footstep sound
  killY: -60.0,
};

/* ============================================================
   SURFACES

   `body.groundMaterial` is whatever collision.addStatic was given -
   either a base kind ("stone", "ice") or a level surface name
   ("carpet.red", "foodcourt.tile"). We look up the full name first
   and fall back to the segment before the dot, so a course can name
   a hundred surfaces and still inherit sane physics.

   Ice is deliberately punitive. Grip 0.14 means you accelerate at
   under 4 m/s^2 and steer at a seventh of normal authority, and a
   friction of 0.55 means you keep almost everything you had. An ice
   floor should be a hazard you route around, not a texture swap.
   ============================================================ */

const SURFACES = {
  default: { friction: 12.0, grip: 1.00, step: "step.stone" },
  stone: { friction: 12.0, grip: 1.00, step: "step.stone" },
  tile: { friction: 13.0, grip: 1.00, step: "step.tile" },
  metal: { friction: 10.5, grip: 0.96, step: "step.metal" },
  grass: { friction: 14.0, grip: 1.00, step: "step.grass" },
  carpet: { friction: 17.0, grip: 1.04, step: "step.carpet" },
  wood: { friction: 12.0, grip: 1.00, step: "step.wood" },
  sand: { friction: 18.0, grip: 0.86, step: "step.sand" },
  snow: { friction: 9.0, grip: 0.82, step: "step.snow" },
  glass: { friction: 3.2, grip: 0.46, step: "step.glass" },
  ice: { friction: 0.55, grip: 0.14, step: "step.ice" },
  water: { friction: 5.0, grip: 0.60, step: "step.water" },
  slope: { friction: 8.0, grip: 0.92, step: "step.stone" },
};

export function surfaceOf(name) {
  if (!name) return SURFACES.default;
  const exact = SURFACES[name];
  if (exact) return exact;
  const dot = name.indexOf(".");
  if (dot > 0) {
    const base = SURFACES[name.slice(0, dot)];
    if (base) return base;
    const leaf = SURFACES[name.slice(dot + 1)];
    if (leaf) return leaf;
  }
  return SURFACES.default;
}

/* ============================================================
   GEOMETRY HELPERS

   CONTRACT §5: -Z is forward for a mesh at identity. So the yaw
   that aims a rig down (dx, dz) is atan2(-dx, -dz). Getting this
   backwards produces a character who runs correctly and faces
   180 degrees wrong, which is a bug that survives review because
   from behind it looks fine.
   ============================================================ */

const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);
const forwardX = (yaw) => -Math.sin(yaw);
const forwardZ = (yaw) => -Math.cos(yaw);

const ZERO2 = { x: 0, y: 0 };
const NO_INPUT = {
  move: ZERO2, moveMag: 0,
  pressed() { return false; },
  held() { return false; },
  released() { return false; },
};

/* ============================================================
   THE ACTION TABLE

   Each entry is:
     clip           anim clip name (must exist in anim.js's list)
     group          "ground" | "air" | "water" | "special"
     oneShot        play the clip once rather than looping
     gravityScale   multiplier applied as a corrective acceleration
     lockFacing     the action steers its own yaw
     noSteer        horizontal input is ignored entirely
     cancelable     the beam/aura may be fired from here
     enter/update/exit

   `update` returns the name of the next action, or null to stay.
   Shared transitions (landing, water, death, hurt) are handled by
   the controller before the action runs, so no action needs to
   repeat them.
   ============================================================ */

const ACTIONS = {

  /* ---------------------------------------------------------- ground */

  idle: {
    clip: "idle", group: "ground", cancelable: true,
    update(m) {
      if (m.tryJump()) return null;
      if (m.in.crouchHeld) return "crouch";
      if (m.in.mag > 0.08) return m.wantsRun() ? "run" : "walk";
      m.groundMove(0);
      m.faceIntent();
      /* The fidget is the cheapest possible signal that the game is
         still running while a player reads the level. */
      if (m.t > TUNING.fidgetDelay) return "idleFidget";
      return null;
    },
  },

  idleFidget: {
    clip: "idleFidget", group: "ground", oneShot: true, cancelable: true,
    update(m) {
      if (m.tryJump()) return null;
      if (m.in.mag > 0.08 || m.in.crouchHeld) return "idle";
      m.groundMove(0);
      if (m.t > TUNING.fidgetTime) return "idle";
      return null;
    },
  },

  walk: {
    clip: "walk", group: "ground", cancelable: true,
    update(m) {
      if (m.tryJump()) return null;
      if (m.in.crouchHeld) return m.speed > 1.0 ? "crawl" : "crouch";
      if (m.in.mag <= 0.08 && m.speed < 0.35) return "idle";
      if (m.shouldSkid()) return "skid";
      if (m.wantsRun()) return "run";
      m.groundMove(TUNING.walkSpeed * m.in.mag);
      m.faceIntent();
      m.footsteps(0.9);
      return null;
    },
  },

  run: {
    clip: "run", group: "ground", cancelable: true,
    update(m) {
      if (m.tryJump()) return null;
      if (m.in.crouchHeld) return "crouchSlide";
      if (m.in.mag <= 0.08 && m.speed < 0.35) return "idle";
      if (m.shouldSkid()) return "skid";
      if (!m.wantsRun() && m.speed < TUNING.walkSpeed + 0.6) return "walk";
      m.groundMove(TUNING.runSpeed * m.in.mag * m.mods.speedMul);
      m.faceIntent();
      m.footsteps(1.0);
      return null;
    },
  },

  /* A real deceleration state. Facing stays with travel while the
     brakes are on, which is what sells the weight; only `turnaround`
     rotates, and only once the speed is gone. */
  skid: {
    clip: "skid", group: "ground", lockFacing: true,
    enter(m) {
      m.fx("dust", 1.0);
      m.sfx("skid");
    },
    update(m) {
      if (m.tryJump()) return null;
      if (m.in.crouchHeld) return "crouchSlide";
      const s = m.speed;
      if (s <= TUNING.skidExitSpeed) {
        return m.in.mag > 0.08 ? "turnaround" : "idle";
      }
      m.brake(TUNING.skidDecel * m.surface.grip);
      m.faceVelocity(1.4);
      /* Keep releasing dust for as long as the feet are fighting the
         floor - a single puff at entry reads as a glitch. */
      if (m.everyMetre(0.55)) m.fx("dust", 0.6);
      return null;
    },
  },

  turnaround: {
    clip: "skid", group: "ground", oneShot: true,
    update(m) {
      if (m.tryJump()) return null;
      m.groundMove(TUNING.walkSpeed * 0.35 * m.in.mag);
      m.faceIntent(3.0);
      if (m.t >= TUNING.turnaroundTime || m.in.mag <= 0.08) {
        if (m.in.mag <= 0.08) return "idle";
        return m.wantsRun() ? "run" : "walk";
      }
      return null;
    },
  },

  crouch: {
    clip: "crouch", group: "ground", cancelable: true,
    update(m) {
      if (m.tryJump()) return null;
      if (!m.in.crouchHeld) return m.in.mag > 0.08 ? "walk" : "idle";
      if (m.in.mag > 0.15) return "crawl";
      m.groundMove(0);
      m.faceIntent(0.5);
      return null;
    },
  },

  crawl: {
    clip: "crawl", group: "ground", cancelable: true,
    update(m) {
      if (m.tryJump()) return null;
      if (!m.in.crouchHeld) return "walk";
      if (m.in.mag <= 0.1) return "crouch";
      m.groundMove(TUNING.crawlSpeed * m.in.mag);
      m.faceIntent(0.8);
      m.footsteps(0.45, 1.9);
      return null;
    },
  },

  /* Crouching out of a run does not stop you - it drops you into a
     decelerating slide. This is the long jump's launch window, and
     making it a state (rather than testing "crouch held" at the
     moment of the jump) is what lets a player land a triple jump and
     immediately long-jump out of it without frame-perfect ordering. */
  crouchSlide: {
    clip: "crouch", group: "ground", lockFacing: true,
    enter(m) { m.fx("dust", 0.7); },
    update(m) {
      if (m.tryJump()) return null;
      if (!m.in.crouchHeld) {
        if (m.speed > TUNING.walkSpeed) return "run";
        return m.in.mag > 0.08 ? "walk" : "idle";
      }
      if (m.speed < 0.8) return m.in.mag > 0.15 ? "crawl" : "crouch";
      m.brake(9.0 * m.surface.grip);
      m.steerVelocity(2.2);
      m.faceVelocity(1.2);
      if (m.everyMetre(0.8)) m.fx("dust", 0.4);
      return null;
    },
  },

  /* Steep-slope slide. Steerable, because an unsteerable slide is a
     cutscene. Gradient comes from the ground normal, so it works on
     anything collision reports rather than needing authored splines. */
  slide: {
    clip: "slide", group: "ground", lockFacing: true,
    enter(m) { m.sfx("slideStart"); },
    update(m) {
      if (m.tryJump()) return null;
      if (!m.onSteepSlope()) {
        if (m.speed > TUNING.walkSpeed) return "getUp";
        return m.in.mag > 0.08 ? "walk" : "idle";
      }
      /* physics.js already accelerates a body it has flagged
         `sliding` along body.slideDir and applies its own slide
         friction - its comment says slideDir is public precisely so
         the moveset can STEER along it. Adding a second gradient push
         here would double the acceleration on every steep face, so we
         only derive our own when the integrator is not doing it. */
      if (!m.body.sliding) {
        const n = m.body.groundNormal;
        const gx = n ? n.x : 0;
        const gz = n ? n.z : 0;
        const gl = Math.hypot(gx, gz);
        if (gl > 1e-4) {
          const push = TUNING.slideAccel * gl;
          m.vel.x += (gx / gl) * push * m.dt;
          m.vel.z += (gz / gl) * push * m.dt;
        }
        m.applyFriction(0.25);
      }
      m.steerVelocity(3.5);
      m.faceVelocity(2.0);
      if (m.everyMetre(0.7)) m.fx("dust", 0.5);
      return null;
    },
  },

  getUp: {
    clip: "getUp", group: "ground", oneShot: true, noSteer: true,
    update(m) {
      m.applyFriction(1.6);
      if (m.t >= TUNING.getUpTime) {
        if (m.in.mag > 0.08) return m.wantsRun() ? "run" : "walk";
        return "idle";
      }
      return null;
    },
  },

  /* Landing hard costs you time. Without a recovery state, falling
     from any height is free and vertical level design has no stakes. */
  hardLandRecovery: {
    clip: "hardLand", group: "ground", oneShot: true, noSteer: true,
    enter(m) {
      m.fx("landRing", 1.0);
      m.fx("dust", 1.2);
      m.sfx("landHard");
      m.shake(0.22, 0.18);
    },
    update(m) {
      m.applyFriction(2.2);
      if (m.t >= TUNING.hardLandTime) {
        if (m.in.mag > 0.08) return m.wantsRun() ? "run" : "walk";
        return "idle";
      }
      return null;
    },
  },

  bellySlide: {
    clip: "slide", group: "ground", lockFacing: true,
    enter(m) {
      m.fx("dust", 1.1);
      m.sfx("bellySlide");
    },
    update(m) {
      /* Cancelling into a roll is the reward for reading the landing.
         It converts a long helpless slide into a short one, and it is
         the reason a dive is worth doing on the ground at all. */
      if (m.wantJump() || m.in.crouch) { m.consumeJump(); return "roll"; }
      if (m.speed < 0.6) return "getUp";
      m.applyFriction(TUNING.bellySlideFriction);
      m.steerVelocity(1.4);
      m.faceVelocity(1.0);
      if (m.everyMetre(0.6)) m.fx("dust", 0.4);
      return null;
    },
  },

  roll: {
    clip: "getUp", group: "ground", oneShot: true, lockFacing: true,
    enter(m) { m.sfx("roll"); },
    update(m) {
      m.applyFriction(0.9);
      if (m.t >= TUNING.rollTime) {
        if (m.in.mag > 0.08) return m.wantsRun() ? "run" : "walk";
        return "idle";
      }
      return null;
    },
  },

  /* ------------------------------------------------------------ air */

  fall: {
    clip: "fall", group: "air", cancelable: true,
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove();
      m.faceIntent();
      return null;
    },
  },

  jump: {
    clip: "jump", group: "air", oneShot: true, cancelable: true,
    enter(m) {
      /* Horizontal velocity is untouched. Every jump in the chain
         preserves momentum - that is the rule that makes "land a
         triple at speed, long jump out of it" a thing you can do. */
      m.vel.y = TUNING.jumpSpeed * m.mods.jumpMul;
      m.chainNext = 2;
      m.armJumpCut();
      m.squash(0.22);
      m.fx("dust", 0.5);
      m.sfx("jump1");
    },
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove();
      m.faceIntent();
      return null;
    },
  },

  doubleJump: {
    clip: "doubleJump", group: "air", oneShot: true, cancelable: true,
    enter(m) {
      m.vel.y = TUNING.doubleJumpSpeed * m.mods.jumpMul;
      m.chainNext = 3;
      m.armJumpCut();
      m.squash(0.28);
      m.fx("dust", 0.8);
      m.sfx("jump2");
    },
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove();
      m.faceIntent();
      return null;
    },
  },

  /* The signature move. Highest, flips, and ends the chain: landing
     it resets you to stage zero so the ladder has to be climbed
     again rather than held. */
  tripleJump: {
    clip: "tripleJump", group: "air", oneShot: true, cancelable: true,
    enter(m) {
      m.vel.y = TUNING.tripleJumpSpeed * m.mods.jumpMul;
      m.chainNext = 0;
      m.spin = 1;
      m.armJumpCut();
      m.squash(0.34);
      m.fx("sparkle", 1.0);
      m.fx("dust", 1.0);
      m.sfx("jump3");
    },
    exit(m) { m.spin = 0; },
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove();
      m.faceIntent();
      return null;
    },
  },

  /* Low, flat, fast, committed. gravityScale is the whole trick -
     see TUNING.longJumpGravityScale. */
  longJump: {
    clip: "longJump", group: "air", oneShot: true, noSteer: true,
    lockFacing: true, gravityScale: TUNING.longJumpGravityScale,
    enter(m) {
      const yaw = m.speed > 0.5 ? yawFromDir(m.vel.x, m.vel.z) : m.yaw;
      m.yaw = yaw;
      m.targetYaw = yaw;
      const sp = Math.max(TUNING.longJumpSpeed, m.speed) * m.mods.speedMul;
      m.vel.x = forwardX(yaw) * sp;
      m.vel.z = forwardZ(yaw) * sp;
      m.vel.y = TUNING.longJumpUp;
      m.chainNext = 0;
      m.speedCap = sp + 0.01;
      m.squash(0.3);
      m.fx("dust", 1.2);
      m.sfx("longJump");
    },
    update(m) {
      /* Diving out of a long jump is deliberate tech: it trades the
         remaining arc for a slide, and it is how you stop one short. */
      if (m.in.crouch) return "dive";
      if (m.tryWallKick()) return null;
      if (m.in.pound) return "groundPoundStart";
      return null;
    },
  },

  backflip: {
    clip: "backflip", group: "air", oneShot: true, lockFacing: true,
    enter(m) {
      m.vel.x = -forwardX(m.yaw) * TUNING.backflipBack;
      m.vel.z = -forwardZ(m.yaw) * TUNING.backflipBack;
      m.vel.y = TUNING.backflipUp * m.mods.jumpMul;
      m.chainNext = 0;
      m.spin = -1;
      m.armJumpCut();
      m.squash(0.32);
      m.fx("dust", 0.9);
      m.sfx("backflip");
    },
    exit(m) { m.spin = 0; },
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove(0.45);
      return null;
    },
  },

  sideFlip: {
    clip: "sideFlip", group: "air", oneShot: true, lockFacing: true,
    enter(m) {
      /* Launch along the NEW stick direction, not the old travel -
         the side flip's job is to convert a reversal into height
         without paying the skid. */
      const yaw = m.in.mag > 0.1 ? yawFromDir(m.in.x, m.in.z) : m.yaw + Math.PI;
      m.yaw = yaw;
      m.targetYaw = yaw;
      const sp = Math.max(TUNING.sideFlipSpeed, m.speed * 0.5);
      m.vel.x = forwardX(yaw) * sp;
      m.vel.z = forwardZ(yaw) * sp;
      m.vel.y = TUNING.sideFlipUp * m.mods.jumpMul;
      m.chainNext = 0;
      m.spin = 1;
      m.armJumpCut();
      m.squash(0.3);
      m.fx("dust", 0.8);
      m.sfx("sideFlip");
    },
    exit(m) { m.spin = 0; },
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove(0.6);
      return null;
    },
  },

  wallSlide: {
    clip: "wallSlide", group: "air", lockFacing: true,
    enter(m) { m.sfx("wallTouch"); },
    update(m) {
      if (m.wantJump()) { m.consumeJump(); return "wallKick"; }
      if (!m.wallTouch()) return "fall";
      /* Hugging the wall slows the fall, which is what turns a wall
         kick from a reflex test into a decision. */
      if (m.vel.y < TUNING.wallSlideFall) m.vel.y = TUNING.wallSlideFall;
      const n = m.wallNormal;
      m.targetYaw = yawFromDir(-n.x, -n.z);
      if (m.everyMetre(0.5)) m.fx("dust", 0.35);
      return null;
    },
  },

  /* Mirror the horizontal velocity in the wall plane, keep 80% of it,
     add a shove straight out and fresh height. Mirroring rather than
     simply reversing is what makes a kick off an angled wall send you
     somewhere useful instead of straight back where you came from. */
  wallKick: {
    clip: "wallKick", group: "air", oneShot: true, lockFacing: true,
    enter(m) {
      const n = m.wallNormal;
      const vn = m.vel.x * n.x + m.vel.z * n.z;
      let rx = m.vel.x - 2 * vn * n.x;
      let rz = m.vel.z - 2 * vn * n.z;
      rx = rx * TUNING.wallKickKeep + n.x * TUNING.wallKickPush;
      rz = rz * TUNING.wallKickKeep + n.z * TUNING.wallKickPush;
      m.vel.x = rx;
      m.vel.z = rz;
      m.vel.y = TUNING.wallKickUp * m.mods.jumpMul;
      const yaw = yawFromDir(rx, rz);
      m.yaw = yaw;
      m.targetYaw = yaw;
      m.chainNext = 0;
      /* Remember the wall we just left so a chain has to alternate
         between two surfaces instead of ratcheting up a single one. */
      m.lastWallX = n.x;
      m.lastWallZ = n.z;
      m.wallTimer = 0;
      m.armJumpCut();
      m.squash(0.28);
      m.fx("dust", 0.9);
      m.sfx("wallKick");
    },
    update(m) {
      if (m.tryAirAction()) return null;
      m.airMove(0.7);
      return null;
    },
  },

  dive: {
    clip: "dive", group: "air", oneShot: true, lockFacing: true, noSteer: true,
    gravityScale: TUNING.diveGravityScale,
    enter(m) {
      const yaw = m.in.mag > 0.1 ? yawFromDir(m.in.x, m.in.z)
        : (m.speed > 0.5 ? yawFromDir(m.vel.x, m.vel.z) : m.yaw);
      m.yaw = yaw;
      m.targetYaw = yaw;
      const sp = Math.max(TUNING.diveSpeed, m.speed);
      m.vel.x = forwardX(yaw) * sp;
      m.vel.z = forwardZ(yaw) * sp;
      m.vel.y = Math.max(m.vel.y, 0) + TUNING.diveUp;
      m.chainNext = 0;
      m.speedCap = sp + 0.01;
      m.fx("sparkle", 0.5);
      m.sfx("dive");
    },
    update(m) {
      if (m.tryWallKick()) return null;
      if (m.in.pound) return "groundPoundStart";
      return null;
    },
  },

  /* The pause at the top is not garnish. It is the read: it tells
     every enemy under you and every player watching that something
     is about to land, and it is the frame budget the camera uses to
     get out of the way. */
  groundPoundStart: {
    clip: "groundPoundStart", group: "air", oneShot: true,
    noSteer: true, lockFacing: true, gravityScale: 0,
    enter(m) {
      m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
      m.chainNext = 0;
      m.spin = 2;
      m.sfx("poundSpin");
    },
    update(m) {
      m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
      if (m.t >= TUNING.poundFreeze) return "groundPoundFall";
      return null;
    },
  },

  groundPoundFall: {
    clip: "groundPoundFall", group: "air", noSteer: true, lockFacing: true,
    gravityScale: 0,
    enter(m) {
      m.spin = 0;
      m.sfx("poundDrop");
      m.stretch(0.3);
    },
    update(m) {
      /* Horizontal is held at exactly zero for the whole drop: a
         ground pound that drifts cannot be aimed, and aiming it at a
         switch two metres wide is most of what it is for. */
      m.vel.x = 0;
      m.vel.z = 0;
      m.vel.y = -TUNING.poundSpeed;
      return null;
    },
  },

  groundPoundLand: {
    clip: "groundPoundLand", group: "ground", oneShot: true, noSteer: true,
    enter(m) {
      m.vel.x = 0; m.vel.z = 0;
      m.fx("poundShock", 1.0);
      m.fx("dust", 1.4);
      m.sfx("poundLand");
      m.shake(0.34, 0.24);
      m.squash(0.45);
      m.emit("pound", { position: m.pos, radius: 2.6 });
    },
    update(m) {
      m.applyFriction(3.0);
      if (m.t >= TUNING.poundRecover) {
        if (m.in.mag > 0.08) return m.wantsRun() ? "run" : "walk";
        return "idle";
      }
      return null;
    },
  },

  /* ---------------------------------------------------------- ledges */

  ledgeGrab: {
    clip: "climbLedge", group: "special", noSteer: true, lockFacing: true,
    gravityScale: 0,
    enter(m) {
      m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
      m.chainNext = 0;
      m.sfx("ledgeGrab");
    },
    update(m) {
      m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
      if (m.wantJump()) { m.consumeJump(); return "ledgeClimb"; }
      /* Pushing toward the wall climbs; pushing away lets go. Both
         read instantly and neither needs a prompt. */
      if (m.in.mag > 0.4) {
        const into = m.in.x * -m.wallNormal.x + m.in.z * -m.wallNormal.z;
        if (into > 0.4) return "ledgeClimb";
        if (into < -0.4) return "fall";
      }
      if (m.in.crouch) return "fall";
      return null;
    },
  },

  ledgeClimb: {
    clip: "climbLedge", group: "special", oneShot: true, noSteer: true,
    lockFacing: true, gravityScale: 0,
    enter(m) { m.sfx("ledgeClimb"); },
    update(m) {
      m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
      if (m.t >= 0.5) {
        /* Teleporting at the end of the clip rather than animating the
           translation keeps the player out of the wall the entire
           time, which no amount of root motion reliably does. */
        if (m.ledge) {
          m.pos.x = m.ledge.x;
          m.pos.y = m.ledge.y + 0.02;
          m.pos.z = m.ledge.z;
        }
        m.fx("dust", 0.4);
        return "idle";
      }
      return null;
    },
  },

  /* ---------------------------------------------------------- water */

  diveIn: {
    clip: "dive", group: "water", oneShot: true, noSteer: true,
    enter(m) {
      m.fx("landRing", 0.8);
      m.sfx("splash");
      m.chainNext = 0;
      /* Entering fast should carry you down, but not to the seabed. */
      m.vel.y = Math.max(m.vel.y, -6.0) * 0.55;
      m.vel.x *= 0.6;
      m.vel.z *= 0.6;
    },
    update(m) {
      if (m.t >= 0.35) return "swim";
      return null;
    },
  },

  swim: {
    /* No gravityScale override on any water action. physics.js swaps
       full gravity for reduced-gravity-plus-buoyancy while submerged,
       and that pair has a fixed point the body settles at - which is
       exactly what "treading water" is. Zeroing gravity here would
       delete the buoyancy term along with it and leave the swimmer
       hanging at whatever depth they entered. */
    clip: "swim", group: "water", cancelable: true,
    update(m) {
      if (!m.inWater()) return "fall";
      /* Tread on "no input at all", not on "not moving vertically" -
         a released stick still sinks at the idle sink rate, so gating
         on vertical speed makes treading unreachable. */
      if (m.in.mag <= 0.1 && !m.in.jumpHeld && !m.in.crouchHeld) return "tread";
      m.swimMove();
      m.faceIntent(0.7);
      if (m.everyMetre(1.4)) m.fx("sparkle", 0.25);
      return null;
    },
  },

  tread: {
    clip: "tread", group: "water", cancelable: true,
    update(m) {
      if (!m.inWater()) return "fall";
      if (m.in.mag > 0.1 || m.in.crouchHeld) return "swim";
      if (m.wantJump()) { m.consumeJump(); return "surface"; }
      m.vel.x = damp(m.vel.x, 0, 3.0, m.dt);
      m.vel.z = damp(m.vel.z, 0, 3.0, m.dt);
      /* Vertical is left alone on purpose: buoyancy floats the body to
         the surface and holds it there, which is the whole animation.
         Damping vy toward zero here would pin the swimmer at whatever
         depth they stopped at. */
      if (!m.body.inWater) m.vel.y = damp(m.vel.y, 0, 2.0, m.dt);
      return null;
    },
  },

  surface: {
    clip: "swim", group: "water", oneShot: true,
    enter(m) { m.sfx("surface"); },
    update(m) {
      if (!m.inWater()) return "fall";
      m.vel.y = TUNING.swimRise;
      m.swimMove(0.5);
      if (m.nearSurface()) {
        m.fx("sparkle", 0.4);
        return "tread";
      }
      if (m.t > 1.2) return "swim";
      return null;
    },
  },

  /* --------------------------------------------------------- combat */

  beam: {
    clip: "beam", group: "special", oneShot: true,
    enter(m) {
      const onBeat = !!(m.ctx.clock && m.ctx.clock.onBeat);
      const damage = TUNING.beamDamage * m.mods.beamMul
        * (onBeat ? TUNING.beamOnBeatBonus : 1);
      m.beamCooldown = TUNING.beamCooldown;
      m.emit("beam", {
        position: m.pos,
        dirX: forwardX(m.yaw), dirZ: forwardZ(m.yaw),
        range: TUNING.beamRange, damage, onBeat,
      });
      /* On-beat gets its own effect, not a louder version of the same
         one. The player has to be able to tell from the screen alone
         that they hit the window. */
      if (onBeat) {
        m.fx("beamHit", 1.0);
        m.flash(0xffe27a, 0.2, 0.12);
        m.shake(0.1, 0.1);
        m.sfx("beamOnBeat");
      } else {
        m.fx("sparkle", 0.6);
        m.sfx("beam");
      }
      m.stretch(0.18);
    },
    update(m) {
      /* The beam does not stop you: it is a state layered over
         whatever you were doing, so movement keeps its authority. */
      if (m.grounded) { m.groundMove(TUNING.walkSpeed * m.in.mag, 0.6); m.faceIntent(0.7); }
      else m.airMove(0.8);
      if (m.t >= TUNING.beamTime) return m.restingAction();
      return null;
    },
  },

  aura: {
    clip: "aura", group: "special", oneShot: true, noSteer: true,
    enter(m) {
      m.vel.x = 0; m.vel.z = 0;
      if (!m.grounded) m.vel.y = Math.max(m.vel.y, 1.2);
      m.fx("auraWave", 1.0);
      m.flash(0xff5ec8, 0.42, 0.3);
      m.shake(0.4, 0.4);
      m.sfx("aura");
      m.emit("aura", { position: m.pos, radius: 9.0, damage: 4 });
    },
    update(m) {
      m.vel.x = damp(m.vel.x, 0, 8, m.dt);
      m.vel.z = damp(m.vel.z, 0, 8, m.dt);
      if (m.t >= TUNING.auraTime) return m.restingAction();
      return null;
    },
  },

  hurt: {
    clip: "hurt", group: "special", oneShot: true, noSteer: true,
    enter(m) {
      m.sfx("hurt");
      m.shake(0.2, 0.16);
      m.flash(0xff2a44, 0.3, 0.16);
    },
    update(m) {
      if (m.grounded) m.applyFriction(1.4);
      if (m.t >= TUNING.hurtTime) return m.restingAction();
      return null;
    },
  },

  knockback: {
    clip: "hurt", group: "special", oneShot: true, noSteer: true,
    enter(m) {
      m.chainNext = 0;
      m.sfx("hurtBig");
      m.shake(0.3, 0.24);
      m.flash(0xff2a44, 0.4, 0.2);
    },
    update(m) {
      if (m.grounded && m.t > 0.15) {
        m.applyFriction(1.6);
        if (m.t >= TUNING.knockbackTime) return "getUp";
      }
      return null;
    },
  },

  death: {
    clip: "dizzy", group: "special", oneShot: true, noSteer: true, lockFacing: true,
    enter(m) {
      m.chainNext = 0;
      m.emit("died", { kind: m.deathKind, position: m.pos });
      if (m.deathKind === "drown") m.fx("sparkle", 1.0);
      else if (m.deathKind === "burn") m.flash(0xff7a2a, 0.5, 0.4);
      m.sfx(m.deathKind === "drown" ? "drown" : "die");
    },
    update(m) {
      if (m.grounded) m.applyFriction(2.0);
      return null;
    },
  },
};

/* Actions the player can be "at rest" in, per group. Used when a
   transient action (beam, hurt) finishes and has to hand control
   back to whatever situation the body is actually in. */
function restingFor(m) {
  if (m.inWater()) return m.in.mag > 0.1 ? "swim" : "tread";
  if (!m.grounded) return "fall";
  if (m.in.crouchHeld) return m.in.mag > 0.15 ? "crawl" : "crouch";
  if (m.in.mag > 0.08) return m.wantsRun() ? "run" : "walk";
  return "idle";
}

/* ============================================================
   THE CONTROLLER
   ============================================================ */

function makeController(ctx, body, opts = {}) {
  const m = {
    ctx,
    body,
    vel: body.velocity,
    pos: body.position,
    dt: 0,

    action: "idle",
    prevAction: "idle",
    def: ACTIONS.idle,
    t: 0,
    frames: 0,

    yaw: opts.yaw || 0,
    targetYaw: opts.yaw || 0,
    turnRate: 0,
    speed: 0,
    speedNorm: 0,
    speedCap: 0,
    spin: 0,

    grounded: false,
    wasGrounded: false,
    groundedTime: 0,
    airTime: 0,
    surface: SURFACES.default,

    /* Feel windows. These are mirrored locally even though input.js
       owns the canonical ones, because a stubbed or replaced input
       module must never be able to silently delete jump buffering. */
    jumpBuffer: 0,
    coyote: 0,
    chainStage: 0,
    chainNext: 0,
    chainTimer: 0,
    airJumpsLeft: 0,

    wallTimer: 0,
    wallNormal: { x: 0, y: 0, z: 1 },
    lastWallX: 0,
    lastWallZ: 0,
    ledge: null,

    beamCooldown: 0,
    invuln: 0,
    breath: TUNING.breathSeconds,
    dead: false,
    deathKind: "fall",

    stepPhase: 0,
    metrePhase: 0,
    jumpCutArmed: false,

    mods: { speedMul: 1, jumpMul: 1, beamMul: 1, airJumps: 0 },
    intent: { x: 0, z: 0, mag: 0, crouch: false, crouchHeld: false, pound: false, beam: false, aura: false, jumpHeld: false },

    onAction: opts.onAction || null,
    onEvent: opts.onEvent || null,
    onSquash: opts.onSquash || null,
    enabled: true,
  };
  m.in = m.intent;

  /* ---------------------------------------------------------- events */

  m.emit = function emit(name, payload) {
    if (ctx.bus && typeof ctx.bus.emit === "function") ctx.bus.emit(`player:${name}`, payload);
    if (m.onEvent) m.onEvent(name, payload);
  };

  /* All of these go through `?.` because vfx.js and audio.js are being
     written in parallel and a missing burst must degrade to silence,
     never to a thrown frame. */
  m.fx = function fx(name, strength) {
    if (ctx.vfx && typeof ctx.vfx.burst === "function") {
      ctx.vfx.burst(name, m.pos, { strength, normal: m.body.groundNormal, material: m.body.groundMaterial });
    }
  };
  m.sfx = function sfx(name, gain) {
    if (ctx.audio && typeof ctx.audio.play === "function") {
      ctx.audio.play(name, { pos: m.pos, gain });
    }
  };
  m.shake = function shake(amount, seconds) { ctx.vfx?.shake?.(amount, seconds); };
  m.flash = function flash(hex, amount, seconds) { ctx.vfx?.flash?.(hex, amount, seconds); };
  m.squash = function squash(amount) { if (m.onSquash) m.onSquash(amount, 0.16); };
  m.stretch = function stretch(amount) { if (m.onSquash) m.onSquash(-amount, 0.18); };

  /* ---------------------------------------------------- input access */

  function readIntent() {
    const input = ctx.input && typeof ctx.input.held === "function" ? ctx.input : NO_INPUT;
    const mv = input.move || ZERO2;
    const it = m.intent;
    /* input.js hands us WORLD-SPACE movement, already rotated out of
       stick space by the camera heading: move.x is world +X and move.y
       is world +Z (its own header says so). It is not a 2D stick with
       a "forward" axis to negate - doing that runs the character
       exactly opposite the stick, and it looks plausible on a symmetric
       test course right up until someone turns the camera. */
    let x = mv.x || 0;
    let z = mv.y || 0;
    let len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; len = 1; }
    it.mag = len;
    if (len > 1e-5) { it.x = x / len; it.z = z / len; } else { it.x = 0; it.z = 0; }

    const pressed = (n) => { try { return !!input.pressed(n); } catch (_) { return false; } };
    const held = (n) => { try { return !!input.held(n); } catch (_) { return false; } };

    it.crouch = pressed("crouch");
    it.crouchHeld = held("crouch");
    it.pound = pressed("pound");
    it.beam = pressed("beam");
    it.aura = pressed("aura");
    it.jumpHeld = held("jump");

    if (pressed("jump")) m.jumpBuffer = TUNING.jumpBuffer;
  }

  /* input.js is the authority on both windows when it exists; the
     local buffer is the floor, not a competing implementation. */
  m.wantJump = function wantJump() {
    if (m.jumpBuffer > 0) return true;
    const bj = ctx.input && ctx.input.bufferedJump;
    if (typeof bj === "function") { try { return !!bj.call(ctx.input); } catch (_) { return false; } }
    return false;
  };
  m.consumeJump = function consumeJump() {
    m.jumpBuffer = 0;
    const cj = ctx.input && ctx.input.consumeJump;
    if (typeof cj === "function") { try { cj.call(ctx.input); } catch (_) { /* ignore */ } }
  };
  m.armJumpCut = function armJumpCut() { m.jumpCutArmed = true; };

  /* ------------------------------------------------- state switching */

  m.set = function set(name, force) {
    const next = ACTIONS[name];
    if (!next) return false;
    if (!force && name === m.action) return false;
    const prev = m.action;
    const prevDef = m.def;
    if (prevDef && prevDef.exit) prevDef.exit(m, name);
    m.prevAction = prev;
    m.action = name;
    m.def = next;
    m.t = 0;
    m.frames = 0;
    m.speedCap = 0;
    if (next.enter) next.enter(m, prev);
    m.emit("action", { from: prev, to: name, speed: m.speed, grounded: m.grounded });
    if (m.onAction) m.onAction(name, next, prev);
    return true;
  };

  m.restingAction = function restingAction() { return restingFor(m); };

  /* ------------------------------------------------ movement helpers */

  m.horizSpeed = function horizSpeed() { return Math.hypot(m.vel.x, m.vel.z); };

  m.wantsRun = function wantsRun() { return m.in.mag > 0.62; };

  m.inWater = function inWater() {
    return !!m.body.inWater && (m.body.waterDepth === undefined || m.body.waterDepth > TUNING.treadDepth);
  };
  m.nearSurface = function nearSurface() {
    const d = m.body.waterDepth;
    return d === undefined ? true : d < TUNING.treadDepth + 0.5;
  };

  m.onSteepSlope = function onSteepSlope() {
    if (!m.grounded) return false;
    const maxSlope = m.body.maxSlope || 0.87; // ~50 degrees
    return (m.body.slopeAngle || 0) > maxSlope;
  };

  /* Isotropic acceleration toward the desired velocity vector. Per-
     axis approach would make diagonal acceleration 1.41x faster than
     cardinal, which players feel long before they can name it. */
  m.groundMove = function groundMove(maxSpeed, accelMul = 1) {
    const grip = m.surface.grip;
    const accel = TUNING.groundAccel * accelMul * grip;
    if (m.in.mag <= 0.08 || maxSpeed <= 0) {
      m.applyFriction(1);
      return;
    }
    const wantX = m.in.x * maxSpeed;
    const wantZ = m.in.z * maxSpeed;
    const dx = wantX - m.vel.x;
    const dz = wantZ - m.vel.z;
    const d = Math.hypot(dx, dz);
    const step = accel * m.dt;
    if (d <= step || d < 1e-6) { m.vel.x = wantX; m.vel.z = wantZ; } else {
      m.vel.x += (dx / d) * step;
      m.vel.z += (dz / d) * step;
    }
  };

  /* Exponential, so it is frame-rate independent, and scaled by the
     surface. On ice this decays 0.55/s: you keep essentially
     everything, which is exactly the hazard we want. */
  m.applyFriction = function applyFriction(mul = 1) {
    const k = Math.exp(-m.surface.friction * mul * m.dt);
    m.vel.x *= k;
    m.vel.z *= k;
  };

  m.brake = function brake(decel) {
    const s = m.horizSpeed();
    if (s < 1e-5) { m.vel.x = 0; m.vel.z = 0; return; }
    const next = Math.max(0, s - decel * m.dt);
    const k = next / s;
    m.vel.x *= k;
    m.vel.z *= k;
  };

  /* Air control is a fraction of ground control (8 vs 28 m/s^2) AND
     is capped at whatever speed you took off with. You may redirect
     a jump; you may not out-accelerate the ground in mid-air. */
  m.airMove = function airMove(mul = 1) {
    if (m.def.noSteer) return;
    if (m.in.mag <= 0.08) return;
    const cap = Math.max(m.speedCap, TUNING.runSpeed * m.mods.speedMul, m.horizSpeed());
    const wantX = m.in.x * cap * m.in.mag;
    const wantZ = m.in.z * cap * m.in.mag;
    const dx = wantX - m.vel.x;
    const dz = wantZ - m.vel.z;
    const d = Math.hypot(dx, dz);
    const step = TUNING.airAccel * mul * m.dt;
    if (d <= step || d < 1e-6) { m.vel.x = wantX; m.vel.z = wantZ; } else {
      m.vel.x += (dx / d) * step;
      m.vel.z += (dz / d) * step;
    }
    const s = m.horizSpeed();
    if (s > cap) { m.vel.x = (m.vel.x / s) * cap; m.vel.z = (m.vel.z / s) * cap; }
  };

  /* Nudge the direction of travel without changing its magnitude.
     Slides and belly-slides steer; they do not accelerate. */
  m.steerVelocity = function steerVelocity(rate) {
    if (m.in.mag <= 0.1) return;
    const s = m.horizSpeed();
    if (s < 0.2) return;
    const cur = Math.atan2(m.vel.z, m.vel.x);
    const want = Math.atan2(m.in.z, m.in.x);
    const next = cur + angleDelta(cur, want) * clamp01(rate * m.dt);
    m.vel.x = Math.cos(next) * s;
    m.vel.z = Math.sin(next) * s;
  };

  m.swimMove = function swimMove(mul = 1) {
    const target = TUNING.swimSpeed * m.in.mag * mul;
    const wantX = m.in.x * target;
    const wantZ = m.in.z * target;
    const step = TUNING.swimAccel * mul * m.dt;
    m.vel.x = approach(m.vel.x, wantX, step);
    m.vel.z = approach(m.vel.z, wantZ, step);
    /* Vertical is an ACCELERATION, not a target. The integrator is
       already applying buoyancy and water drag; assigning vy would
       overwrite them every frame and the swimmer would neither float
       nor sink the way the water volume says it should. */
    const rise = TUNING.swimRise * 2.4 * mul * m.dt;
    if (m.in.jumpHeld) m.vel.y += rise;
    else if (m.in.crouchHeld) m.vel.y -= rise;
    m.vel.y = clamp(m.vel.y, -4.5, 4.5);
  };

  /* The turn-rate curve. At rest 16 rad/s is effectively a snap; at a
     full run 4.2 gives roughly a 45-degree turn in a quarter second,
     so committing to a direction costs distance. Grip scales it, so
     ice steals your steering as well as your traction. */
  m.faceIntent = function faceIntent(mul = 1) {
    if (m.def.lockFacing) return;
    if (m.in.mag <= 0.08) return;
    m.targetYaw = yawFromDir(m.in.x, m.in.z);
    const norm = clamp01(m.speed / TUNING.runSpeed);
    const base = lerp(TUNING.turnRateStill, TUNING.turnRateRun, norm);
    const rate = (m.grounded ? base * m.surface.grip : TUNING.turnRateAir) * mul;
    m.yaw = dampAngle(m.yaw, m.targetYaw, rate, m.dt);
  };

  m.faceVelocity = function faceVelocity(mul = 1) {
    const s = m.horizSpeed();
    if (s < 0.15) return;
    m.targetYaw = yawFromDir(m.vel.x, m.vel.z);
    m.yaw = dampAngle(m.yaw, m.targetYaw, 8.0 * mul, m.dt);
  };

  /* Distance-keyed rather than time-keyed so footfalls stay locked to
     travel when the surface or the speed changes. */
  m.everyMetre = function everyMetre(metres) {
    if (m.metrePhase >= metres) { m.metrePhase -= metres; return true; }
    return false;
  };

  m.footsteps = function footsteps(strength = 1, lengthMul = 1) {
    const len = TUNING.stepLength * lengthMul;
    if (m.stepPhase < len) return;
    m.stepPhase -= len;
    m.sfx(m.surface.step, strength);
    if (strength > 0.85 && m.speed > TUNING.walkSpeed) m.fx("dust", 0.25);
    m.emit("footstep", { position: m.pos, material: m.body.groundMaterial, strength });
  };

  /* --------------------------------------------- jump resolution */

  /* One place decides what a jump press means. Spreading this across
     the ground actions is how you end up with a long jump that works
     from `run` but not from `skid` for no reason anyone can explain. */
  m.tryJump = function tryJump() {
    if (!m.wantJump()) return false;
    if (!m.grounded && m.coyote <= 0) return false;
    m.consumeJump();
    m.coyote = 0;

    if (m.in.crouchHeld) {
      if (m.speed >= TUNING.longJumpMinSpeed) { m.set("longJump"); return true; }
      m.set("backflip");
      return true;
    }
    if (m.isReversing() && m.speed >= TUNING.sideFlipMinSpeed) { m.set("sideFlip"); return true; }
    /* chainStage names the jump this press WOULD be, not the one you
       just landed: 2 = a double is available, 3 = a triple is. It is
       written on landing from the chainNext each jump declares, so
       the ladder survives the jump -> fall transition that happens at
       every apex. */
    if (m.chainTimer > 0 && m.chainStage === 2 && m.speed >= TUNING.doubleMinSpeed) {
      m.set("doubleJump");
      return true;
    }
    if (m.chainTimer > 0 && m.chainStage === 3 && m.speed >= TUNING.tripleMinSpeed) {
      m.set("tripleJump");
      return true;
    }
    m.set("jump");
    return true;
  };

  m.isReversing = function isReversing() {
    if (m.in.mag < 0.5) return false;
    const s = m.horizSpeed();
    if (s < 0.5) return false;
    const dot = (m.vel.x / s) * m.in.x + (m.vel.z / s) * m.in.z;
    return dot < TUNING.sideFlipDot;
  };

  m.shouldSkid = function shouldSkid() {
    if (m.in.mag < 0.5) return false;
    const s = m.horizSpeed();
    if (s < TUNING.skidMinSpeed) return false;
    const dot = (m.vel.x / s) * m.in.x + (m.vel.z / s) * m.in.z;
    return dot < TUNING.skidDot;
  };

  /* Actions available from any airborne state. Ordered by how
     committing they are: a wall kick beats a pound beats a dive,
     because the wall kick is the one with a 200ms window. */
  m.tryAirAction = function tryAirAction() {
    /* Coyote time. This is the only place a jump can be started from
       an airborne action, and leaving it out is the classic way to
       ship coyote time that does not actually work: the window opens
       correctly, and then nothing reads it because `fall` never asks
       for a jump. */
    if (m.coyote > 0 && m.tryJump()) return true;
    if (m.tryWallKick()) return true;
    if (m.in.pound) { m.set("groundPoundStart"); return true; }
    if (m.in.crouch) { m.set("dive"); return true; }
    if (m.wantJump() && m.airJumpsLeft > 0) {
      m.consumeJump();
      m.airJumpsLeft -= 1;
      m.set("doubleJump", true);
      return true;
    }
    return false;
  };

  m.wallTouch = function wallTouch() { return m.wallTimer > 0; };

  m.tryWallKick = function tryWallKick() {
    if (!m.wantJump()) return false;
    if (m.wallTimer <= 0) return false;
    /* A chain has to alternate. Without this, two frames of contact
       with one wall lets you ratchet straight up it. */
    const same = m.wallNormal.x * m.lastWallX + m.wallNormal.z * m.lastWallZ;
    if (same > TUNING.wallRepeatDot) return false;
    m.consumeJump();
    m.set("wallKick");
    return true;
  };

  /* ------------------------------------------------------ damage */

  m.hurt = function hurt(power, dirX, dirZ) {
    if (m.dead || m.invuln > 0) return false;
    m.invuln = TUNING.invulnTime;
    const len = Math.hypot(dirX || 0, dirZ || 0);
    const nx = len > 1e-4 ? dirX / len : -forwardX(m.yaw);
    const nz = len > 1e-4 ? dirZ / len : -forwardZ(m.yaw);
    const big = power >= 2;
    const speed = TUNING.knockbackSpeed * (big ? 1.35 : 0.8);
    m.vel.x = nx * speed;
    m.vel.z = nz * speed;
    m.vel.y = TUNING.knockbackUp * (big ? 1 : 0.6);
    m.chainNext = 0;
    m.chainTimer = 0;
    m.set(big ? "knockback" : "hurt", true);
    return true;
  };

  m.kill = function kill(kind) {
    if (m.dead) return;
    m.dead = true;
    m.deathKind = kind || "fall";
    m.set("death", true);
  };

  m.revive = function revive() {
    m.dead = false;
    m.breath = TUNING.breathSeconds;
    m.invuln = TUNING.invulnTime;
    m.chainStage = 0;
    m.chainNext = 0;
    m.chainTimer = 0;
    m.set("idle", true);
  };

  m.reset = function reset(x, y, z, yaw) {
    m.pos.x = x; m.pos.y = y; m.pos.z = z;
    m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
    m.yaw = yaw || 0;
    m.targetYaw = m.yaw;
    m.dead = false;
    m.speed = 0;
    m.speedNorm = 0;
    m.jumpBuffer = 0;
    m.coyote = 0;
    m.wallTimer = 0;
    m.ledge = null;
    m.breath = TUNING.breathSeconds;
    m.invuln = TUNING.invulnTime;
    m.chainStage = 0; m.chainNext = 0; m.chainTimer = 0;
    m.set("fall", true);
  };

  /* ============================================================
     PRE-PHYSICS STEP - decide, then write velocity
     ============================================================ */

  m.step = function step(dt) {
    if (!m.enabled || dt <= 0) return;
    m.dt = dt;
    m.t += dt;
    m.frames += 1;

    m.grounded = !!m.body.grounded;
    m.surface = surfaceOf(m.body.groundMaterial);
    m.speed = m.horizSpeed();
    m.speedNorm = clamp01(m.speed / TUNING.runSpeed);

    /* -------- timers. All of them decay here and nowhere else. */
    m.jumpBuffer = Math.max(0, m.jumpBuffer - dt);
    m.chainTimer = Math.max(0, m.chainTimer - dt);
    if (m.chainTimer === 0) m.chainStage = 0;
    m.wallTimer = Math.max(0, m.wallTimer - dt);
    m.beamCooldown = Math.max(0, m.beamCooldown - dt);
    m.invuln = Math.max(0, m.invuln - dt);
    if (m.grounded) { m.coyote = TUNING.coyoteTime; m.groundedTime += dt; m.airTime = 0; } else {
      m.coyote = Math.max(0, m.coyote - dt);
      m.airTime += dt;
      m.groundedTime = 0;
    }

    readIntent();

    /* -------- breath. Drowning is a real hazard or water is a
       decorative floor, and a decorative hazard is worse than none. */
    if (m.inWater()) {
      m.breath -= dt;
      if (m.breath <= 0 && !m.dead) { m.kill("drown"); }
    } else if (m.breath < TUNING.breathSeconds) {
      m.breath = Math.min(TUNING.breathSeconds, m.breath + dt * 6);
    }

    if (m.dead) {
      if (ACTIONS[m.action].update) ACTIONS[m.action].update(m);
      applyGravityScale();
      return;
    }

    /* -------- global overrides, in priority order.
       These run before the action so no action has to repeat them. */
    if (m.pos.y < TUNING.killY) { m.kill("fall"); applyGravityScale(); return; }

    const group = m.def.group;
    if (m.inWater() && group !== "water" && m.action !== "death") {
      m.set(m.airTime > 0.2 && m.vel.y < -3 ? "diveIn" : "swim");
    } else if (!m.inWater() && group === "water") {
      m.set("fall");
    }

    /* Beam and aura layer over anything that declares itself
       cancelable. They are verbs, not modes. */
    if (m.in.beam && m.beamCooldown <= 0 && m.def.cancelable) m.set("beam", true);
    else if (m.in.aura && m.def.cancelable && m.spendAura()) m.set("aura", true);

    /* Steep slopes take control away from the ground actions.
       Re-read the group rather than reusing the snapshot above: the
       beam may have moved us out of it two lines ago. */
    if (m.onSteepSlope() && m.def.group === "ground"
      && m.action !== "slide" && m.action !== "groundPoundLand"
      && m.action !== "hardLandRecovery") {
      m.set("slide");
    }

    /* Falling off an edge without jumping. Coyote time is already
       armed above, so this is purely the animation/state change. */
    if (!m.grounded && m.def.group === "ground" && !m.inWater()) m.set("fall");

    /* -------- variable jump height. Cutting on release rather than
       on "not held" means a tap is short and a hold is full, and it
       only ever fires once per jump. */
    if (m.jumpCutArmed && !m.in.jumpHeld) {
      m.jumpCutArmed = false;
      if (m.vel.y > 0) m.vel.y *= TUNING.jumpCut;
    }
    if (m.vel.y <= 0) m.jumpCutArmed = false;

    /* -------- the action itself. The loop bound stops a pair of
       actions that name each other from hanging the frame; four is
       generous and has never been reached in practice. */
    for (let i = 0; i < 4; i += 1) {
      const def = m.def;
      const next = def.update ? def.update(m) : null;
      if (!next || next === m.action) break;
      m.set(next);
    }

    /* -------- a plain jump that has peaked becomes a fall, so the
       anim controller does not hold a takeoff pose all the way down. */
    if (m.def.group === "air" && m.vel.y < -0.4
      && (m.action === "jump" || m.action === "doubleJump"
        || m.action === "tripleJump" || m.action === "wallKick"
        || m.action === "sideFlip" || m.action === "backflip")) {
      m.set("fall");
    }

    applyGravityScale();

    m.speed = m.horizSpeed();
    m.speedNorm = clamp01(m.speed / TUNING.runSpeed);
    const travelled = m.speed * dt;
    /* Footfall distance only accrues on the ground. Letting it run
       through a long jump means the stride counter is metres ahead by
       touchdown and fires three footsteps into one landing frame. */
    if (m.grounded) m.stepPhase += travelled;
    m.metrePhase += travelled;
    m.turnRate = angleDelta(m.lastYaw === undefined ? m.yaw : m.lastYaw, m.yaw) / Math.max(dt, 1e-4);
    m.lastYaw = m.yaw;
  };

  /* Actions that want a different arc (the long jump's flat one, the
     ground pound's hang) declare a gravityScale, and we publish it on
     the body rather than applying a corrective acceleration ourselves.

     physics.js reads body.gravityScale every substep, so writing it is
     exact, and - critically - it stays correct underwater, where the
     integrator swaps full gravity for a reduced-gravity-plus-buoyancy
     model. A corrective "+g * (1 - scale)" would assume a -22 that was
     never applied there and fire the player out of the water. */
  function applyGravityScale() {
    m.body.gravityScale = m.def.gravityScale === undefined ? 1 : m.def.gravityScale;
  }

  m.spendAura = function spendAura() {
    const st = ctx.state;
    if (!st || (st.mog || 0) < TUNING.auraCost) return false;
    st.mog = Math.max(0, st.mog - TUNING.auraCost);
    return true;
  };

  /* ============================================================
     POST-PHYSICS STEP - react to what the integrator resolved

     Landing detection lives here rather than at the top of the next
     frame's step, because the jump chain window is measured from the
     landing and a frame of slop at 60fps is 7% of it.
     ============================================================ */

  m.postStep = function postStep(dt) {
    if (!m.enabled) return;
    const grounded = !!m.body.grounded;
    /* physics.js publishes the real touchdown speed (it tracks the
       peak of the fall across substeps); our own last-frame velocity
       is only the fallback for an integrator that does not. */
    const impact = (m.body.justLanded && typeof m.body.landSpeed === "number")
      ? -m.body.landSpeed
      : (m.landingVy === undefined ? m.vel.y : m.landingVy);

    /* Refresh the cached body state BEFORE running the edge handlers.
       onLand asks restingFor() which action to hand control back to,
       and restingFor asks whether we are grounded - so leaving the
       stale value in place makes every landing resolve to `fall`, and
       the character then runs around on air control forever. */
    m.grounded = grounded;
    m.speed = m.horizSpeed();
    m.speedNorm = clamp01(m.speed / TUNING.runSpeed);
    m.surface = surfaceOf(m.body.groundMaterial);

    if (grounded && !m.wasGrounded) onLand(impact);
    else if (!grounded && m.wasGrounded) onLeaveGround();

    if (!grounded) {
      probeWall();
      probeLedge();
    } else {
      m.ledge = null;
    }

    m.wasGrounded = grounded;
    m.landingVy = m.vel.y;
  };

  function onLand(impactVy) {
    const hard = impactVy < -TUNING.hardLandSpeed;

    /* The chain ladder advances only on a landing that came from a
       jump that offers a follow-up. Everything else zeroes it. */
    m.chainStage = m.chainNext;
    m.chainNext = 0;
    m.chainTimer = m.chainStage ? TUNING.jumpChainWindow : 0;
    m.airJumpsLeft = m.mods.airJumps;
    m.lastWallX = 0;
    m.lastWallZ = 0;
    /* Half a stride, so the first footfall after a landing is spaced
       from the landing thump rather than stacked on top of it. */
    m.stepPhase = TUNING.stepLength * 0.5;

    m.emit("land", {
      position: m.pos, impact: impactVy, hard,
      material: m.body.groundMaterial, action: m.action,
    });

    const from = m.action;
    if (from === "groundPoundFall" || from === "groundPoundStart") {
      m.set("groundPoundLand", true);
      return;
    }
    if (from === "dive" || (from === "longJump" && m.speed > TUNING.runSpeed)) {
      m.set("bellySlide", true);
      m.fx("landRing", 0.5);
      return;
    }
    if (from === "death" || from === "knockback" || from === "hurt") {
      m.sfx("land", 0.5);
      return;
    }

    if (hard) { m.set("hardLandRecovery", true); return; }

    /* A soft landing gets a squash and a puff and hands straight back
       to locomotion - stopping to play a "land" clip at speed is the
       thing that makes a platformer feel gummy. */
    m.squash(clamp(Math.abs(impactVy) / 14, 0.12, 0.4));
    m.fx("dust", clamp(Math.abs(impactVy) / 12, 0.2, 1));
    m.sfx("land", clamp01(Math.abs(impactVy) / 12));
    m.set(restingFor(m), true);
  }

  function onLeaveGround() {
    if (m.def.group !== "ground") return;
    /* Walked off, did not jump. Open the coyote window and close the
       jump chain: a chain link you did not take off for is not a link
       anyone earned. */
    m.coyote = TUNING.coyoteTime;
    m.chainNext = 0;
    m.set("fall");
  }

  /* Wall contact. collision.wallProbe is the frozen API for exactly
     this; if collision is still a stub we fall back to whatever the
     body happens to expose, and if neither exists wall kicks simply
     never arm rather than throwing. */
  function probeWall() {
    const col = ctx.collision;
    let nx = 0; let nz = 0; let found = false;

    if (col && typeof col.wallProbe === "function") {
      /* Probe where the player is ASKING to go first. Once you are
         flush against a wall the solver has already eaten the normal
         component of your velocity, so probing along velocity finds
         nothing and the kick window never opens - which is the single
         most common way wall kicks ship broken. */
      const s = m.horizSpeed();
      let dx; let dz;
      if (m.in.mag > 0.3) { dx = m.in.x; dz = m.in.z; } else if (s > 0.6) {
        dx = m.vel.x / s; dz = m.vel.z / s;
      } else { dx = forwardX(m.yaw); dz = forwardZ(m.yaw); }
      let hit = null;
      try {
        hit = col.wallProbe({ x: m.pos.x, y: m.pos.y + 0.9, z: m.pos.z },
          { x: dx, y: 0, z: dz }, TUNING.capsuleRadius + 0.16, 1.2);
      } catch (_) { hit = null; }
      if (hit && hit.normal && Math.abs(hit.normal.y) < 0.36) {
        nx = hit.normal.x; nz = hit.normal.z; found = true;
      }
    } else if (m.body.hitWall && m.body.wallNormal) {
      const n = m.body.wallNormal;
      if (Math.abs(n.y) < 0.36) { nx = n.x; nz = n.z; found = true; }
    }

    if (!found) return;
    const len = Math.hypot(nx, nz);
    if (len < 1e-4) return;
    nx /= len; nz /= len;

    /* Only arm on an approach - brushing a wall on the way past must
       not hand out a free 6 m/s of height. Holding the stick into the
       wall counts as an approach even at zero speed, because that is
       what a player hugging a wall looks like after the solver has
       cancelled their inward velocity. */
    const approachSpeed = -(m.vel.x * nx + m.vel.z * nz);
    const pressingIn = m.in.mag > 0.5 && -(m.in.x * nx + m.in.z * nz) > 0.5;
    if (approachSpeed < TUNING.wallMinApproach && !pressingIn) return;

    m.wallNormal.x = nx;
    m.wallNormal.y = 0;
    m.wallNormal.z = nz;
    m.wallTimer = TUNING.wallCoyote;

    if (m.vel.y < 0 && m.def.group === "air" && m.action !== "wallSlide"
      && m.action !== "longJump" && m.action !== "dive") {
      m.set("wallSlide");
    }
  }

  /* Ledge grab. Needs a wall in front and standable ground just above
     and beyond it, which is two collision queries - both optional. */
  function probeLedge() {
    if (m.vel.y >= 0) return;
    if (m.def.group !== "air") return;
    if (m.action === "longJump" || m.action === "dive"
      || m.action === "groundPoundFall" || m.action === "ledgeClimb") return;
    if (m.wallTimer <= 0) return;
    const col = ctx.collision;
    if (!col || typeof col.groundAt !== "function") return;

    const n = m.wallNormal;
    const reach = TUNING.capsuleRadius + 0.45;
    const tx = m.pos.x - n.x * reach;
    const tz = m.pos.z - n.z * reach;
    let g = null;
    try { g = col.groundAt(tx, tz, m.pos.y + 2.0, 2.4); } catch (_) { g = null; }
    if (!g) return;
    const rise = g.y - m.pos.y;
    /* Chest-height only. Grabbing anything you can already step onto
       makes the character look like they cannot walk. */
    if (rise < 0.75 || rise > 1.65) return;
    if (g.normal && g.normal.y < 0.7) return;

    m.ledge = { x: tx, y: g.y, z: tz };
    m.pos.y = g.y - 1.25;
    m.set("ledgeGrab", true);
  }

  return m;
}

/* ============================================================
   MODULE
   ============================================================ */

export function create(ctx) {
  const controllers = [];

  return {
    TUNING,
    actions: Object.keys(ACTIONS),
    surfaceOf,
    yawFromDir,
    forwardX,
    forwardZ,

    /** player.js (and, later, any scripted stand-in) binds a physics
     *  body here. Returns the controller it should drive. */
    attach(body, opts) {
      const m = makeController(ctx, body, opts);
      controllers.push(m);
      return m;
    },

    detach(m) {
      const i = controllers.indexOf(m);
      if (i >= 0) controllers.splice(i, 1);
    },

    /** Contract §4 puts moveset before physics: decide and write
     *  velocity, integrate nothing. */
    update(c) {
      const dt = c.clock ? c.clock.dt : 0;
      if (dt <= 0) return;
      for (let i = 0; i < controllers.length; i += 1) controllers[i].step(dt);
    },

    /** Called by player.js immediately after its body is integrated. */
    postPhysics(c) {
      const dt = c.clock ? c.clock.dt : 0;
      for (let i = 0; i < controllers.length; i += 1) controllers[i].postStep(dt);
    },

    lateUpdate() {},
  };
}
