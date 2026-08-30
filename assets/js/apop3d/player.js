/* ============================================================
   APOP DEMON MOGGERS 3D - player (Moggadonna)

   The binding layer. moveset.js decides what Moggadonna is doing;
   this file owns the things that doing it requires:

     the physics body        (physics.createBody)
     the rig                 (character.build + anim.attach)
     health, the mog meter, the active Record Deal
     death and respawn
     the translation from "action name" to "clip, squash, dust"

   It deliberately contains no movement rules. If a number in here
   changes how the character moves, it is in the wrong file.

   ------------------------------------------------------------
   DEGRADING RATHER THAN DYING

   Every module this one talks to is being written in parallel, and
   several are still stubs. A stub must cost us a feature, never a
   frame: every cross-module call is guarded, and when physics.js is
   not there yet we integrate the body ourselves against a flat
   plane so the moveset is still observable and still testable. That
   fallback is marked and it yields the moment a real physics module
   exports createBody.

   ------------------------------------------------------------
   ORDERING. main.js runs `moveset -> physics -> player`, and player
   is NOT in the lateUpdate list, so the rig transform is written at
   the end of update() - before anim.lateUpdate consumes it. Landing
   detection is handed back to the moveset here, immediately after
   the body resolves, because the jump-chain window is measured from
   that instant.
   ============================================================ */

import { clamp, clamp01, damp } from "apop3d/core.js";

const CAPSULE_RADIUS = 0.32;   // contract §5
const BODY_HEIGHT = 1.7;       // contract §5
const GRAVITY = 22.0;          // contract §5
const MAX_SLOPE = 50 * (Math.PI / 180);

const DEATH_HOLD = 1.5;        // seconds on the floor before respawn
const MOG_MAX = 1.0;
const MOG_PER_BEAM = 0.06;
const MOG_PER_BEAM_ONBEAT = 0.14;
const MOG_PER_POUND = 0.04;

/* ============================================================
   RECORD DEALS

   The cap analogue (contract §1). Each one is a small, legible
   multiplier bundle rather than a bespoke system - a player should
   be able to describe what a deal does in one sentence after
   wearing it once. `duration` is in seconds; 0 means permanent
   until it is swapped.
   ============================================================ */

const DEALS = {
  "auto-tune-beam": {
    name: "Auto-Tune Beam", duration: 30,
    mods: { beamMul: 2.0 }, tint: 0x62e8ff,
  },
  "stan-shield": {
    name: "Stan Shield", duration: 40,
    mods: {}, shield: 1, tint: 0xff8ad4,
  },
  "main-character-energy": {
    name: "Main Character Energy", duration: 25,
    mods: { speedMul: 1.28, jumpMul: 1.18 }, tint: 0xffd166,
  },
  "choreo-cancel": {
    /* One extra mid-air jump. It is the only deal that touches the
       action table, and it does it through a counter the moveset
       already refills on landing rather than a new state. */
    name: "Choreo Cancel", duration: 30,
    mods: { airJumps: 1 }, tint: 0xa0ff9c,
  },
  "label-advance": {
    name: "Label Advance", duration: 45,
    mods: {}, cloutMul: 2, tint: 0xf2f2f2,
  },
  "diva-tax": {
    name: "Diva Tax", duration: 30,
    mods: {}, reflect: 1, tint: 0xff5e5e,
  },
};

/* ============================================================
   A vector that works with or without three.

   player.js never imports three (it reads ctx.THREE) so that the
   moveset harness can run this file under plain node. When THREE is
   absent the body still needs something with .x/.y/.z that vfx and
   camera code can read without special-casing.
   ============================================================ */

class PlainVec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new PlainVec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}

function makeVec(ctx, x, y, z) {
  const V = ctx.THREE && ctx.THREE.Vector3;
  return V ? new V(x, y, z) : new PlainVec3(x, y, z);
}

/* ============================================================
   FALLBACK BODY

   Used only while physics.js is a stub. It integrates the same
   gravity constant against collision.groundAt when collision exists
   and against a plane at y = 0 when it does not, so the moveset's
   arcs are the arcs it will have with the real integrator. It does
   not do walls, slopes, platforms or water - those degrade to "no
   wall kicks, no slides, no lifts", which is visible and honest.
   ============================================================ */

function createFallbackBody(ctx, opts) {
  return {
    fallback: true,
    position: makeVec(ctx, 0, 0, 0),
    velocity: makeVec(ctx, 0, 0, 0),
    groundNormal: makeVec(ctx, 0, 1, 0),
    grounded: false,
    groundMaterial: "stone",
    slopeAngle: 0,
    platform: null,
    inWater: false,
    waterDepth: 0,
    radius: opts.radius,
    height: opts.height,
    mass: opts.mass,
    gravityScale: opts.gravityScale === undefined ? 1 : opts.gravityScale,
    maxSlope: opts.maxSlope,
  };
}

function stepFallbackBody(ctx, body, dt) {
  const p = body.position;
  const v = body.velocity;

  v.y -= GRAVITY * (body.gravityScale === undefined ? 1 : body.gravityScale) * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  let groundY = 0;
  let material = "stone";
  let normalY = 1;
  const col = ctx.collision;
  if (col && typeof col.groundAt === "function") {
    let g = null;
    try { g = col.groundAt(p.x, p.z, p.y + body.height, 6); } catch (_) { g = null; }
    if (g) {
      groundY = g.y;
      material = g.material || "stone";
      normalY = g.normal ? g.normal.y : 1;
    } else {
      groundY = -Infinity;
    }
  }

  if (p.y <= groundY) {
    p.y = groundY;
    if (v.y < 0) v.y = 0;
    body.grounded = true;
    body.groundMaterial = material;
    body.groundNormal.set(0, normalY, 0);
    body.slopeAngle = Math.acos(clamp(normalY, -1, 1));
  } else {
    body.grounded = false;
    body.slopeAngle = 0;
  }
}

/* ============================================================
   ACTION -> PRESENTATION

   The one-shot table. Anything not listed here is a looping
   locomotion or hold state and is driven by setLocomotion instead.
   Clip names are from the contract §9 list; where an action has no
   dedicated clip it borrows the nearest one, which is recorded in
   the action table itself rather than duplicated here.
   ============================================================ */

const ONE_SHOT_FADE = 0.08;
const LOOP_FADE = 0.16;

/* Locomotion actions blend from the idle/walk/run triangle rather
   than playing a clip, so setLocomotion owns them entirely. */
const LOCOMOTION = new Set(["idle", "walk", "run", "crouch", "crawl", "swim", "tread", "fall", "wallSlide"]);

export function create(ctx) {
  /* ---------------------------------------------------------- body */

  /* auto:false is load-bearing. physics.js steps every `auto` body from
     its own update(), which main.js runs BEFORE this module - so a body
     left on auto would be integrated there and again by the step() call
     below, and Moggadonna would fall at 2g and jump half as high.
     Owning the step also makes integrate -> detect-landing atomic, and
     the jump chain window is measured from that instant. */
  const bodyOpts = {
    radius: CAPSULE_RADIUS,
    height: BODY_HEIGHT,
    mass: 62,
    gravityScale: 1,
    maxSlope: MAX_SLOPE,
    auto: false,
    kind: "character",
    owner: "player",
  };

  let body = null;
  let ownsIntegration = false;
  if (ctx.physics && typeof ctx.physics.createBody === "function") {
    try { body = ctx.physics.createBody(bodyOpts); } catch (error) {
      console.warn("[apop3d] physics.createBody failed; using the fallback body", error);
    }
  }
  if (!body) {
    body = createFallbackBody(ctx, bodyOpts);
    ownsIntegration = true;
  }
  if (!body.position) body.position = makeVec(ctx, 0, 0, 0);
  if (!body.velocity) body.velocity = makeVec(ctx, 0, 0, 0);
  if (body.maxSlope === undefined) body.maxSlope = MAX_SLOPE;

  /* ----------------------------------------------------------- rig */

  let rig = null;
  if (ctx.character && typeof ctx.character.build === "function") {
    try {
      const spec = (ctx.character.specs && ctx.character.specs.moggadonna) || "moggadonna";
      rig = ctx.character.build(spec);
    } catch (error) {
      console.warn("[apop3d] character.build(moggadonna) failed", error);
    }
  }
  if (rig && rig.root && ctx.scene && typeof ctx.scene.add === "function") {
    rig.root.name = "moggadonna";
    ctx.scene.add(rig.root);
  }

  let anim = null;
  if (rig && ctx.anim && typeof ctx.anim.attach === "function") {
    try { anim = ctx.anim.attach(rig); } catch (error) {
      console.warn("[apop3d] anim.attach failed", error);
    }
  }

  /* -------------------------------------------------------- state */

  const spawn = { x: 0, y: 1.2, z: 0, yaw: 0 };
  const self = {
    body,
    rig,
    anim,
    controller: null,
    position: body.position,
    velocity: body.velocity,
    action: "idle",
    grounded: false,
    yaw: 0,
    speed: 0,
    deal: null,
    dealTime: 0,
    shield: 0,
    invuln: 0,
    deathTimer: 0,
    alive: true,
  };

  /* Squash-and-stretch. anim.js owns it when it exists (contract §9
     gives the controller a squash()), but the pop on every takeoff
     and landing is on the quality bar's list of tells, so when the
     anim module is still a stub we drive the rig scale directly
     rather than shipping a character that lands like a statue. */
  let squashAmount = 0;
  let squashVel = 0;
  let flipAngle = 0;

  function pushSquash(amount, duration) {
    if (anim && typeof anim.squash === "function") {
      try { anim.squash(amount, duration || 0.16); return; } catch (_) { /* fall through */ }
    }
    squashAmount = clamp(squashAmount + amount, -0.5, 0.5);
  }

  /* ------------------------------------------------------ moveset */

  function onAction(name, def, prev) {
    self.action = name;
    if (!anim) return;
    try {
      if (def.oneShot && !LOCOMOTION.has(name)) {
        anim.play(def.clip, { fade: ONE_SHOT_FADE, loop: false, weight: 1 });
      } else if (!LOCOMOTION.has(name)) {
        anim.play(def.clip, { fade: LOOP_FADE, loop: true, weight: 1 });
      }
    } catch (error) {
      /* One bad clip name must not take the character down. */
      console.warn(`[apop3d] anim.play("${def.clip}") failed for action "${name}" (from "${prev}")`, error);
    }
  }

  function onEvent(name, payload) {
    switch (name) {
      case "beam":
        /* The mog meter is charged by playing on the beat. That is the
           entire reason the beat clock exists in a platformer. */
        gainMog(payload && payload.onBeat ? MOG_PER_BEAM_ONBEAT : MOG_PER_BEAM);
        break;
      case "pound":
        gainMog(MOG_PER_POUND);
        break;
      case "died":
        self.alive = false;
        self.deathTimer = DEATH_HOLD;
        ctx.hud?.toast?.(payload && payload.kind === "drown" ? "Out of breath" : "Wiped");
        break;
      default:
        break;
    }
  }

  const controller = ctx.moveset && typeof ctx.moveset.attach === "function"
    ? ctx.moveset.attach(body, { yaw: 0, onAction, onEvent, onSquash: pushSquash })
    : null;
  self.controller = controller;

  if (!controller) {
    console.warn("[apop3d] moveset.attach missing - Moggadonna will not move");
  }

  /* ------------------------------------------------------- health */

  function gainMog(n) {
    const st = ctx.state;
    if (!st) return;
    st.mog = clamp(( st.mog || 0) + n, 0, MOG_MAX);
    ctx.hud?.setMog?.(st.mog);
  }

  function setHealth(v) {
    const st = ctx.state;
    if (!st) return;
    st.hp = clamp(v, 0, st.maxHp || 8);
    ctx.hud?.setHealth?.(st.hp, st.maxHp || 8);
  }

  function damage(n, fromPos) {
    if (!self.alive || !controller) return false;
    if (controller.invuln > 0) return false;

    /* Stan Shield eats the hit whole, including the knockback. A
       shield that only reduces damage is a shield nobody notices. */
    if (self.shield > 0) {
      self.shield -= 1;
      controller.invuln = 0.9;
      ctx.vfx?.burst?.("sparkle", body.position, { strength: 1 });
      ctx.audio?.play?.("shieldBreak", { pos: body.position });
      ctx.hud?.toast?.("Stan Shield absorbed it");
      return false;
    }

    let dx = 0;
    let dz = 0;
    if (fromPos) {
      dx = body.position.x - fromPos.x;
      dz = body.position.z - fromPos.z;
    }

    const st = ctx.state || {};
    const amount = Math.max(1, Math.round(n || 1));
    setHealth((st.hp === undefined ? 8 : st.hp) - amount);

    if (self.deal && DEALS[self.deal] && DEALS[self.deal].reflect && fromPos) {
      ctx.bus?.emit?.("player:reflect", { position: fromPos, damage: amount });
    }

    if ((ctx.state ? ctx.state.hp : 0) <= 0) {
      controller.kill("hurt");
      return true;
    }
    controller.hurt(amount, dx, dz);
    ctx.bus?.emit?.("player:hurt", { amount, position: body.position });
    return true;
  }

  function heal(n) {
    const st = ctx.state || {};
    setHealth((st.hp === undefined ? 8 : st.hp) + Math.max(0, n || 0));
    ctx.vfx?.burst?.("sparkle", body.position, { strength: 0.6 });
  }

  function setSpawn(x, y, z, yaw) {
    spawn.x = x; spawn.y = y; spawn.z = z; spawn.yaw = yaw || 0;
  }

  function resolveSpawn(index) {
    const cur = ctx.world && ctx.world.current;
    const list = cur && cur.spawns;
    if (list && list.length) {
      const s = list[clamp(index | 0, 0, list.length - 1)] || list[0];
      if (s) {
        const p = s.position || s;
        return { x: p.x || 0, y: p.y || 0, z: p.z || 0, yaw: s.yaw || 0 };
      }
    }
    return spawn;
  }

  function teleport(x, y, z, yaw) {
    if (controller) controller.reset(x, y, z, yaw === undefined ? self.yaw : yaw);
    else {
      body.position.x = x; body.position.y = y; body.position.z = z;
      body.velocity.x = 0; body.velocity.y = 0; body.velocity.z = 0;
    }
    self.alive = true;
    self.deathTimer = 0;
    syncRig(1);
  }

  function respawn(spawnIndex) {
    const s = resolveSpawn(spawnIndex === undefined ? 0 : spawnIndex);
    const st = ctx.state;
    if (st) setHealth(st.maxHp || 8);
    teleport(s.x, s.y, s.z, s.yaw);
    if (controller) controller.revive();
    ctx.vfx?.burst?.("sparkle", body.position, { strength: 1 });
    ctx.bus?.emit?.("player:respawn", { position: body.position });
  }

  function setDeal(id) {
    const deal = id ? DEALS[id] : null;
    self.deal = deal ? id : null;
    self.dealTime = deal ? deal.duration : 0;
    self.shield = deal && deal.shield ? deal.shield : 0;
    applyMods();
    if (deal) {
      ctx.vfx?.burst?.("recordGet", body.position, { strength: 1, color: deal.tint });
      ctx.audio?.play?.("dealGet", { pos: body.position });
      ctx.hud?.toast?.(deal.name);
      ctx.bus?.emit?.("player:deal", { id, name: deal.name, duration: deal.duration });
    } else {
      ctx.bus?.emit?.("player:deal", { id: null });
    }
  }

  function applyMods() {
    if (!controller) return;
    const mods = controller.mods;
    mods.speedMul = 1;
    mods.jumpMul = 1;
    mods.beamMul = 1;
    mods.airJumps = 0;
    const deal = self.deal ? DEALS[self.deal] : null;
    if (deal && deal.mods) Object.assign(mods, deal.mods);
    /* airJumpsLeft is refilled on landing, but a deal picked up in
       mid-air should be usable before touching the ground again. */
    controller.airJumpsLeft = Math.max(controller.airJumpsLeft, mods.airJumps);
  }

  /* ----------------------------------------------------- the rig */

  function syncRig(dt) {
    if (!rig || !rig.root) return;
    const p = body.position;
    rig.root.position.set(p.x, p.y, p.z);
    rig.root.rotation.y = self.yaw;

    /* Only drive scale and flip ourselves when anim.js is not doing
       it, otherwise the two fight over the same transform. */
    if (anim) return;

    squashAmount = damp(squashAmount, 0, 11, dt);
    const s = 1 + squashAmount;
    rig.root.scale.set(1 / Math.sqrt(Math.max(0.2, s)), Math.max(0.2, s), 1 / Math.sqrt(Math.max(0.2, s)));

    if (controller && controller.spin) {
      const speed = controller.spin === 2 ? 14 : 9;
      flipAngle += (controller.spin === -1 ? -1 : 1) * speed * dt;
      if (controller.spin === 2) rig.root.rotation.y += flipAngle * 0.6;
      else rig.root.rotation.x = flipAngle;
    } else if (flipAngle !== 0) {
      flipAngle = 0;
      rig.root.rotation.x = 0;
    }
  }

  function driveAnim(dt) {
    if (!anim || !controller) return;
    try {
      if (typeof anim.setLocomotion === "function") {
        /* setLocomotion owns the idle/walk/run blend. Feeding it zero
           while airborne stops the run cycle bleeding into a fall. */
        const norm = controller.grounded ? controller.speedNorm : 0;
        anim.setLocomotion(norm, controller.turnRate || 0);
      }
      if (typeof anim.additive === "function") {
        /* Lean into the turn, and out of a hard fall. Both are cheap
           and both are on the "linear motion" tell list. */
        const lean = clamp((controller.turnRate || 0) / 6, -1, 1) * controller.speedNorm;
        anim.additive("lean", lean);
        anim.additive("fall", controller.grounded ? 0 : clamp01(-body.velocity.y / 16));
      }
      if (typeof anim.footIK === "function") anim.footIK(controller.grounded);
    } catch (error) {
      console.warn("[apop3d] anim drive failed", error);
      anim = null;
    }
  }

  /* --------------------------------------------------------- loop */

  let hudHp = -1;
  let hudMog = -1;

  return {
    /* Read-only surface other modules use. `position` and `velocity`
       are the live body vectors: do not copy them into a local and
       expect it to track. */
    get position() { return body.position; },
    get velocity() { return body.velocity; },
    get action() { return controller ? controller.action : "idle"; },
    get grounded() { return controller ? controller.grounded : !!body.grounded; },
    get yaw() { return self.yaw; },
    get speed() { return controller ? controller.speed : 0; },
    get alive() { return self.alive; },
    get invulnerable() { return controller ? controller.invuln > 0 : false; },
    get breath() { return controller ? controller.breath : 0; },
    get chainStage() { return controller ? controller.chainStage : 0; },
    body,
    rig,
    controller,
    deals: DEALS,

    damage,
    heal,
    respawn,
    setDeal,
    teleport,
    setSpawn,

    /** qa.setAction drives this for animation goldens. */
    setAction(name) {
      if (!controller) return false;
      return controller.set(name, true);
    },

    enter(c, payload) {
      const index = (payload && payload.spawn) || 0;
      respawn(index);
      applyMods();
      const st = c.state;
      if (st) {
        ctx.hud?.setHealth?.(st.hp, st.maxHp || 8);
        ctx.hud?.setMog?.(st.mog || 0);
      }
    },

    update(c) {
      const dt = c.clock ? c.clock.dt : 0;
      if (dt <= 0) return;

      /* No course means no floor. Integrating into an empty BVH is
         how Moggadonna used to spawn and fall forever while the
         title state waited for a load that nobody issued. Hold
         still until world.js has something to stand on. */
      if (!ctx.world || !ctx.world.current) return;

      /* physics.js owns the integrator when it exists. `step(body,dt)`
         is the frozen entry point for it (contract §9), and bodies are
         stepped by their owner so ordering stays explicit. */
      /* Belt and braces on the auto:false request above: if some other
         physics build ignores the flag and steps the body from its own
         update(), stepping it again here would double gravity. */
      const already = body._steppedFrame !== undefined
        && c.clock && body._steppedFrame === c.clock.frame;
      if (!already && !ownsIntegration && ctx.physics && typeof ctx.physics.step === "function") {
        try { ctx.physics.step(body, dt); } catch (error) {
          console.warn("[apop3d] physics.step failed; falling back to local integration", error);
          ownsIntegration = true;
        }
      }
      if (ownsIntegration) stepFallbackBody(ctx, body, dt);

      /* Landing, wall and ledge detection, against a freshly resolved
         body. This is the moveset's second half of the frame. */
      ctx.moveset?.postPhysics?.(c);

      if (controller) {
        self.yaw = controller.yaw;
        self.action = controller.action;
        self.grounded = controller.grounded;
        self.speed = controller.speed;
      }

      /* Record Deal lifetime. */
      if (self.deal && self.dealTime > 0) {
        self.dealTime -= dt;
        if (self.dealTime <= 0) {
          const name = DEALS[self.deal]?.name;
          setDeal(null);
          ctx.hud?.toast?.(`${name} expired`);
        }
      }

      /* Death and respawn. Held on the floor long enough to read as a
         consequence, not long enough to be a loading screen. */
      if (!self.alive) {
        self.deathTimer -= dt;
        if (self.deathTimer <= 0) respawn(0);
      }

      driveAnim(dt);
      syncRig(dt);

      const st = c.state;
      if (st) {
        if (st.hp !== hudHp) { hudHp = st.hp; ctx.hud?.setHealth?.(st.hp, st.maxHp || 8); }
        const mog = st.mog || 0;
        if (Math.abs(mog - hudMog) > 0.01) { hudMog = mog; ctx.hud?.setMog?.(mog); }
      }
    },

    /* main.js does not call player.lateUpdate (the late list is
       camera/anim/vfx/render), so this exists only for a harness that
       drives the module directly. */
    lateUpdate() {},

    exit() {
      if (rig && rig.root && ctx.scene && typeof ctx.scene.remove === "function") {
        ctx.scene.remove(rig.root);
      }
      if (controller) ctx.moveset?.detach?.(controller);
      if (!ownsIntegration) ctx.physics?.destroyBody?.(body);
    },
  };
}
