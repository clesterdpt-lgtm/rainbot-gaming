/* ============================================================
   APOP DEMON MOGGERS 3D - physics

   A kinematic character controller, not a rigid-body simulation.

   Nothing in this game needs constraint islands, restitution or
   angular momentum. What it needs is for a capsule to be exactly
   where the player expects it, on exactly the surface the moveset
   asked about, at 30fps and at 144fps alike. A general solver
   spends its budget somewhere else and gives back a character that
   floats.

   The five details that decide whether this reads as Super Mario 64
   or as a student project, in the order players notice them:

   1. GROUND SNAPPING. While grounded and moving, the capsule is
      pulled back down onto the surface within a small tolerance.
      Without it, every convex ridge and every stair tread launches
      the character for one frame, the landing animation retriggers,
      and the whole game feels like it is on a trampoline.

   2. SLOPE PROJECTION. Below the slope limit, velocity is projected
      onto the slope plane in a way that PRESERVES horizontal speed,
      so a ramp neither gives free acceleration downhill nor stalls
      the run uphill. Above the limit you slide, and sliding is a
      first-class state the moveset uses on purpose.

   3. MOVING PLATFORMS. A body inherits its platform's delta - both
      translation and yaw about the platform's own pivot - BEFORE it
      integrates. Get this wrong and every lift in the game slides
      the player off the back. It is done by transforming the body
      through the platform's old inverse and its new matrix, so a
      rotating, rising, orbiting platform all work without anybody
      having to declare a pivot.

   4. ITERATED DEPENETRATION, deepest contact first. Single-pass
      resolution jitters in corners: you push out of one wall into
      another and back again forever.

   5. A FIXED INTERNAL TIMESTEP. Everything above runs at 1/120 s
      regardless of the frame rate, because the screenshot goldens
      and the jump arcs both have to be reproducible.

   THREE comes from ctx, never from an import - see collision.js for
   why. This module is runnable under plain node.
   ============================================================ */

import { clamp, clamp01, angleDelta, DEG } from "apop3d/core.js";

/* CONTRACT.md section 5. Exported because the moveset needs the same
   numbers and two copies of a tuning constant is two tuning
   constants. */
export const TUNING = {
  GRAVITY: -22,          // m/s^2
  WALK_SPEED: 3.2,       // m/s
  RUN_SPEED: 7.4,        // m/s
  LONG_JUMP_SPEED: 13,   // m/s horizontal launch
  CAPSULE_RADIUS: 0.32,  // m
  CAPSULE_HEIGHT: 1.7,   // m
  MAX_SLOPE: 46 * DEG,   // rad - above this you slide
  TILE: 2,               // m, one level grid tile
};

const FIXED = 1 / 120;         // the integrator's own clock
const MAX_SUBSTEPS = 16;       // 16 * 1/120 = 133ms, past main.js's clamp
const DEPEN_ITERATIONS = 4;
const SKIN = 0.0015;           // overshoot on push-out, kills wall jitter
const JUMP_BREAK = 0.05;       // upward speed that counts as leaving ground
/* Flatter than this is a floor - walkable or not - and steeper is a
   wall. SM64 draws the line at very nearly vertical; a platformer
   with a wall kick needs a little more margin so the move only fires
   on something the player reads as a wall. 0.3 is about 73 degrees. */
const WALL_MAX_NY = 0.3;
const CEILING_NY = 0.35;       // n.y under -this is a ceiling
const GLANCING_NY = -0.85;     // above this a ceiling deflects, below it stops
const TERMINAL = -55;          // m/s
const WATER_GRAVITY = 0.32;    // fraction of gravity that survives underwater
const WATER_BUOYANCY = 13.5;   // m/s^2 at full submersion
const WATER_DRAG = 2.6;        // per second, scaled by submersion
const WATER_CURRENT = 1.0;

export function create(ctx) {
  const THREE = ctx && ctx.THREE;
  const Vec3 = THREE && THREE.Vector3;
  if (!Vec3) throw new Error("apop3d/physics: ctx.THREE.Vector3 is required");

  const bodies = [];
  let nextId = 1;
  let substepCount = 0;
  let contactCount = 0;

  const _delta = new Vec3();
  const _inc = new Vec3();
  const _start = new Vec3();
  const _base = new Vec3();
  const _top = new Vec3();
  const _contacts = [];
  const _freeList = [];
  const _invMat = new Float64Array(16);

  const _slideResult = makeResult();
  const _stepResult = makeResult();

  function makeResult() {
    return {
      moved: new Vec3(),
      movedDist: 0,
      hitWall: false,
      hitCeiling: false,
      hitGround: false,
      groundNormal: new Vec3(0, 1, 0),
      wallNormal: new Vec3(),
      ceilingNormal: new Vec3(),
      groundMaterial: null,
      groundMesh: null,
      wallDepth: 0,
      stepped: 0,
      contacts: 0,
    };
  }

  function resetResult(res) {
    res.moved.set(0, 0, 0);
    res.movedDist = 0;
    res.hitWall = false;
    res.hitCeiling = false;
    res.hitGround = false;
    res.groundNormal.set(0, 1, 0);
    res.wallNormal.set(0, 0, 0);
    res.ceilingNormal.set(0, 0, 0);
    res.groundMaterial = null;
    res.groundMesh = null;
    res.wallDepth = 0;
    res.stepped = 0;
    res.contacts = 0;
  }

  const col = () => ctx.collision || null;
  const frameNow = () => (ctx.clock && ctx.clock.frame) || 0;

  /* ------------------------------- bodies ------------------------------- */

  /**
   * body.position is the FEET, not the centre.
   *
   * Every other system asks the same question about a character -
   * what is under it - and a feet-origin makes that a direct compare
   * against groundAt's surface height instead of a radius-offset
   * that someone will eventually get wrong by half a capsule.
   */
  function createBody(opts = {}) {
    const body = {
      id: nextId++,
      kind: opts.kind || "character",
      owner: opts.owner || null,

      radius: opts.radius ?? TUNING.CAPSULE_RADIUS,
      height: opts.height ?? TUNING.CAPSULE_HEIGHT,
      mass: opts.mass ?? 1,
      gravityScale: opts.gravityScale ?? 1,
      maxSlope: opts.maxSlope ?? TUNING.MAX_SLOPE,
      stepHeight: opts.stepHeight ?? 0.42,
      snapDistance: opts.snapDistance ?? 0.42,
      slideAccel: opts.slideAccel ?? 30,
      slideFriction: opts.slideFriction ?? 0.35,
      terminalVelocity: opts.terminalVelocity ?? TERMINAL,
      buoyancy: opts.buoyancy ?? WATER_BUOYANCY,

      position: new Vec3(),
      velocity: new Vec3(),
      yaw: opts.yaw ?? 0,

      grounded: false,
      wasGrounded: false,
      groundNormal: new Vec3(0, 1, 0),
      groundMaterial: "stone",
      groundMesh: null,
      groundY: 0,
      slopeAngle: 0,
      sliding: false,
      slideDir: new Vec3(),

      platform: null,
      platformVelocity: new Vec3(),
      platformYaw: 0,

      inWater: false,
      waterDepth: 0,
      waterSurfaceY: 0,
      submersion: 0,
      swimming: false,
      waterCurrent: new Vec3(),

      hitWall: false,
      wallNormal: new Vec3(),
      hitCeiling: false,
      ceilingNormal: new Vec3(),
      steppedUp: 0,

      airTime: 0,
      groundTime: 0,
      fallSpeed: 0,
      landSpeed: 0,
      justLanded: false,
      dropThrough: false,

      /* auto is true because CONTRACT.md's update order runs physics
         between moveset and player: moveset writes intent, physics
         integrates, player reads the result. A body whose owner
         wants to drive step() by hand sets auto = false. */
      auto: opts.auto !== false,
      enabled: opts.enabled !== false,

      _acc: 0,
      _snapLock: 0,
      _steppedFrame: -1,
      _platMat: new Float64Array(16),
      _hasPlatMat: false,
    };
    if (opts.position) body.position.set(opts.position.x, opts.position.y, opts.position.z);
    bodies.push(body);
    return body;
  }

  function destroyBody(body) {
    const i = bodies.indexOf(body);
    if (i >= 0) bodies.splice(i, 1);
    if (body) { body.enabled = false; body.platform = null; }
    return i >= 0;
  }

  /** Force a body airborne for a moment. The moveset calls this on
   *  jump-like actions so ground snapping cannot eat the launch. */
  function unground(body, seconds = 0.08) {
    body.grounded = false;
    body.sliding = false;
    body.platform = null;
    body._hasPlatMat = false;
    body._snapLock = Math.max(body._snapLock, seconds);
  }

  /* --------------------------- moving platforms --------------------------- */

  function invertAffine(m, out) {
    const a = m[0], b = m[4], c = m[8];
    const d = m[1], e = m[5], f = m[9];
    const g = m[2], h = m[6], i = m[10];
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    let det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) det = 1e-12;
    const id = 1 / det;
    out[0] = A * id; out[4] = (c * h - b * i) * id; out[8] = (b * f - c * e) * id;
    out[1] = B * id; out[5] = (a * i - c * g) * id; out[9] = (c * d - a * f) * id;
    out[2] = C * id; out[6] = (b * g - a * h) * id; out[10] = (a * e - b * d) * id;
    const tx = m[12], ty = m[13], tz = m[14];
    out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
    out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
    out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  }

  /**
   * Carry the body with whatever it is standing on, before it moves
   * itself.
   *
   * The transform is `M_now * inverse(M_prev)` applied to the body's
   * world position. That single expression covers translation,
   * rotation about the platform's own pivot, and any combination -
   * nobody has to declare where the pivot is, and a platform that is
   * a child of another moving thing works for free, because the
   * matrices are already world matrices.
   */
  function ridePlatform(body, dt) {
    body.platformVelocity.set(0, 0, 0);
    body.platformYaw = 0;
    const plat = body.platform;
    if (!plat) { body._hasPlatMat = false; return; }
    const m = plat.matrixWorld && plat.matrixWorld.elements;
    if (!m) { body._hasPlatMat = false; return; }
    if (body._hasPlatMat) {
      invertAffine(body._platMat, _invMat);
      const p = body.position;
      const lx = _invMat[0] * p.x + _invMat[4] * p.y + _invMat[8] * p.z + _invMat[12];
      const ly = _invMat[1] * p.x + _invMat[5] * p.y + _invMat[9] * p.z + _invMat[13];
      const lz = _invMat[2] * p.x + _invMat[6] * p.y + _invMat[10] * p.z + _invMat[14];
      const nx = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      const ny = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      const nz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      const dx = nx - p.x, dy = ny - p.y, dz = nz - p.z;
      if (dx || dy || dz) {
        p.set(nx, ny, nz);
        if (dt > 1e-6) body.platformVelocity.set(dx / dt, dy / dt, dz / dt);
      }
      // Yaw of a Y-rotation lives in the third basis column; atan2 is
      // scale invariant so a scaled platform still reads correctly.
      const yawPrev = Math.atan2(body._platMat[8], body._platMat[10]);
      const yawNow = Math.atan2(m[8], m[10]);
      const turn = angleDelta(yawPrev, yawNow);
      body.platformYaw = turn;
      if (Number.isFinite(body.yaw)) body.yaw += turn;
    }
    for (let i = 0; i < 16; i += 1) body._platMat[i] = m[i];
    body._hasPlatMat = true;
  }

  /* ------------------------------ contacts ------------------------------ */

  function capsuleAt(body, x, y, z) {
    _base.set(x, y + body.radius, z);
    _top.set(x, y + Math.max(body.radius, body.height - body.radius), z);
  }

  function capsuleFree(body, x, y, z) {
    const c = col();
    if (!c || typeof c.capsuleQuery !== "function") return true;
    capsuleAt(body, x, y, z);
    const list = c.capsuleQuery(_base, _top, body.radius, _freeList, {
      feetY: y, dropThrough: body.dropThrough,
    });
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].depth > SKIN * 2) return false;
    }
    return true;
  }

  /**
   * Sort a contact into ground, ceiling, wall - or nothing at all.
   *
   * Returns false when the contact should be discarded entirely.
   *
   * THE STEP RULE lives here, and it is the SM64 one rather than the
   * Quake one. A kerb, a stair tread or the lip of a paving slab is
   * simply not an obstacle: any contact whose triangle tops out below
   * feet + stepHeight stops blocking, and the ground probe then lifts
   * the body onto it as its centre crosses the edge. The alternative
   * - detect the wall, then teleport the capsule up and forward past
   * its own radius - pops the character 40cm for a 30cm kerb, and it
   * is exactly the tell that reads as "engine demo".
   *
   * It has a level-design consequence worth knowing: a fence has to
   * be taller than stepHeight (0.42m) or the player walks through it.
   */
  function classify(ct, res, stepCeil) {
    const ny = ct.normal.y;
    if (ny >= WALL_MAX_NY) {
      /* Anything flatter than 60 degrees is a floor, even when it is
         far too steep to walk on. Calling a 55 degree bank a wall
         would let the player wall-kick off the side of every hill. */
      if (!res.hitGround || ny > res.groundNormal.y) {
        res.hitGround = true;
        res.groundNormal.copy(ct.normal);
        res.groundMaterial = ct.material;
        res.groundMesh = ct.mesh;
      }
      return true;
    }
    if (ny <= -CEILING_NY) {
      res.hitCeiling = true;
      res.ceilingNormal.copy(ct.normal);
      return true;
    }
    if (ct.topY <= stepCeil) return false;
    res.hitWall = true;
    if (ct.depth >= res.wallDepth) {
      res.wallDepth = ct.depth;
      res.wallNormal.copy(ct.normal);
    }
    return true;
  }

  /**
   * Push the capsule out of everything it overlaps, deepest first.
   *
   * Re-querying between iterations is the point. Resolving every
   * contact from one snapshot double-counts a corner and ejects the
   * body across the room; resolving only the deepest and looking
   * again converges on the corner in three or four rounds.
   */
  function depenetrate(body, res, feetY, stepCeil) {
    const c = col();
    if (!c || typeof c.capsuleQuery !== "function") return;
    const p = body.position;
    for (let it = 0; it < DEPEN_ITERATIONS; it += 1) {
      capsuleAt(body, p.x, p.y, p.z);
      const list = c.capsuleQuery(_base, _top, body.radius, _contacts, {
        feetY, dropThrough: body.dropThrough,
      });
      if (!list.length) break;
      contactCount += list.length;
      res.contacts = list.length;
      let deepest = null;
      for (let i = 0; i < list.length; i += 1) {
        const ct = list[i];
        if (!classify(ct, res, stepCeil)) continue;
        if (!deepest || ct.depth > deepest.depth) deepest = ct;
      }
      if (!deepest || deepest.depth <= SKIN) break;
      p.addScaledVector(deepest.normal, deepest.depth + SKIN);
      const v = body.velocity;
      const into = v.x * deepest.normal.x + v.y * deepest.normal.y + v.z * deepest.normal.z;
      if (into < 0) v.addScaledVector(deepest.normal, -into);
    }
  }

  /**
   * Move by `delta`, sliding along whatever stops it.
   *
   * Substeps are capped by DISTANCE, not by count, so a long-jumping
   * player at 13 m/s and a shuffling enemy at 1 m/s get the same
   * collision fidelity and neither can pass through a wall.
   */
  function moveAndSlide(body, delta, out) {
    const res = out || _slideResult;
    resetResult(res);
    const p = body.position;
    _start.copy(p);

    const c = col();
    if (!c || typeof c.capsuleQuery !== "function") {
      p.add(delta);
      res.moved.copy(delta);
      res.movedDist = delta.length();
      return res;
    }

    /* One-way platforms are decided against the feet BEFORE the move.
       Once the capsule overlaps the platform its feet are already
       under the surface, and a test on the current position would
       make every one-way ledge solid from below. */
    const feetY = p.y;
    /* Obstacles topping out below this are stepped over rather than
       collided with. Frozen for the whole move: recomputing it as the
       feet rise would let a body ratchet up a wall one substep at a
       time, which is the classic way a step rule becomes a ladder. */
    const stepCeil = feetY + (body.grounded ? body.stepHeight : 0);
    const dist = delta.length();
    const steps = clamp(Math.ceil(dist / Math.max(0.05, body.radius * 0.5)), 1, 24);
    _inc.copy(delta).multiplyScalar(1 / steps);

    for (let s = 0; s < steps; s += 1) {
      p.add(_inc);
      depenetrate(body, res, feetY, stepCeil);
      if (res.hitWall) {
        const into = _inc.x * res.wallNormal.x + _inc.y * res.wallNormal.y + _inc.z * res.wallNormal.z;
        if (into < 0) _inc.addScaledVector(res.wallNormal, -into);
      }
    }

    res.moved.copy(p).sub(_start);
    res.movedDist = res.moved.length();
    return res;
  }

  /* -------------------------------- water -------------------------------- */

  function sampleWater(body) {
    const c = col();
    const w = (c && typeof c.waterAt === "function")
      ? c.waterAt(body.position.x, body.position.y + 0.02, body.position.z)
      : null;
    if (!w || !w.inside) {
      body.inWater = false;
      body.submersion = 0;
      body.swimming = false;
      body.waterDepth = 0;
      return;
    }
    body.inWater = true;
    body.waterSurfaceY = w.surfaceY;
    body.waterDepth = Math.max(0, w.surfaceY - body.position.y);
    body.submersion = clamp01(body.waterDepth / Math.max(0.25, body.height));
    body.swimming = body.submersion > 0.55;
    body.waterCurrent.copy(w.current);
  }

  /* ------------------------------- forces ------------------------------- */

  function applyForces(body, h) {
    const v = body.velocity;
    const g = TUNING.GRAVITY * body.gravityScale;
    const sub = body.submersion;

    if (sub > 0.02) {
      /* Reduced gravity plus buoyancy proportional to submersion.
         The pair has a fixed point: the body settles where buoyancy
         cancels the residual weight, which is what "floating" is.
         Drag is what stops it oscillating about that point forever. */
      v.y += (g * WATER_GRAVITY + body.buoyancy * sub) * h;
      const damp = Math.exp(-WATER_DRAG * sub * h);
      v.x *= damp; v.y *= damp; v.z *= damp;
      const cur = body.waterCurrent;
      if (cur.x || cur.y || cur.z) {
        v.x += cur.x * WATER_CURRENT * sub * h;
        v.y += cur.y * WATER_CURRENT * sub * h;
        v.z += cur.z * WATER_CURRENT * sub * h;
      }
      return;
    }

    if (body.grounded) {
      if (v.y < 0) v.y = 0;
      return;
    }
    v.y += g * h;
    if (v.y < body.terminalVelocity) v.y = body.terminalVelocity;
    if (v.y < body.fallSpeed) body.fallSpeed = v.y;
  }

  function slopeResponse(body, h) {
    if (!body.grounded || body.submersion > 0.02) return;
    const v = body.velocity;
    if (v.y > JUMP_BREAK) return;    // a launch in progress is not a slope
    const n = body.groundNormal;
    if (body.sliding) {
      // Stay on the plane, then take the downhill acceleration. The
      // magnitude scales with sin(slope) so a 47 degree ramp barely
      // creeps and a 70 degree face is unrecoverable, which is the
      // relationship the level design leans on.
      const into = v.x * n.x + v.y * n.y + v.z * n.z;
      if (into < 0) { v.x -= n.x * into; v.y -= n.y * into; v.z -= n.z * into; }
      const a = body.slideAccel * Math.sin(body.slopeAngle) * h;
      v.x += body.slideDir.x * a;
      v.y += body.slideDir.y * a;
      v.z += body.slideDir.z * a;
      const f = Math.exp(-body.slideFriction * h);
      v.x *= f; v.z *= f;
      return;
    }
    if (n.y > 1e-3) {
      /* Set the vertical rate from the horizontal one so the body
         tracks the plane at UNCHANGED horizontal speed. Projecting
         the 3D velocity onto the plane instead would shorten it on
         every uphill substep, and a long ramp would grind a full run
         down to a walk for no reason the player can see. */
      v.y = -(n.x * v.x + n.z * v.z) / n.y;
    }
  }

  /* ------------------------------- ground ------------------------------- */

  function updateGround(body, res, h) {
    const c = col();
    const v = body.velocity;
    body.wasGrounded = body.grounded;
    if (body._snapLock > 0) body._snapLock = Math.max(0, body._snapLock - h);

    if (v.y > JUMP_BREAK || body._snapLock > 0) {
      if (body.grounded) { body.platform = null; body._hasPlatMat = false; }
      body.grounded = false;
      body.sliding = false;
      body.slopeAngle = 0;
      body.slideDir.set(0, 0, 0);
      body.airTime += h;
      body.groundTime = 0;
      return;
    }

    let grounded = false;
    let nx = 0, ny = 1, nz = 0;
    let material = body.groundMaterial;
    let mesh = null;
    let groundY = body.position.y;

    /* The authoritative floor is the ray under the character, exactly
       as SM64's find_floor is. Contacts are the fallback, because a
       capsule perched on a ledge corner is genuinely supported even
       though the centre ray has nothing under it.

       The probe starts a step height ABOVE the feet, which is the
       other half of the step rule: once the body's centre crosses a
       kerb's edge, the ray sees the higher surface and the body is
       placed on it. Downward, it reaches snapDistance, which is what
       keeps a run over a convex ridge or down a staircase attached
       to the ground instead of launching once per tread. */
    const rise = body.wasGrounded ? body.stepHeight : 0;
    const snap = (body.wasGrounded && v.y <= JUMP_BREAK) ? body.snapDistance : 0.05;
    const probe = (c && typeof c.groundAt === "function")
      ? c.groundAt(body.position.x, body.position.z,
        body.position.y + rise + 0.02, rise + snap + 0.07)
      : null;
    if (probe && !(probe.oneWay && probe.y > body.position.y + 0.06)) {
      const gap = body.position.y - probe.y;
      const lifting = gap < -1e-3;
      const legalLift = !lifting
        || (probe.upFacing && -gap <= rise + 1e-3 && probe.slope <= body.maxSlope
          && capsuleFree(body, body.position.x, probe.y + 0.01, body.position.z));
      if (gap <= snap + 1e-3 && gap >= -rise - 1e-3 && legalLift) {
        grounded = true;
        nx = probe.normal.x; ny = probe.normal.y; nz = probe.normal.z;
        material = probe.material;
        mesh = probe.mesh;
        groundY = probe.y;
        if (lifting) { body.steppedUp = -gap; res.stepped = -gap; }
        body.position.y = probe.y;
        if (v.y < 0) v.y = 0;
      }
    }
    if (!grounded && res.hitGround) {
      grounded = true;
      nx = res.groundNormal.x; ny = res.groundNormal.y; nz = res.groundNormal.z;
      material = res.groundMaterial || material;
      mesh = res.groundMesh;
      groundY = body.position.y;
      if (v.y < 0) v.y = 0;
    }

    body.grounded = grounded;
    if (grounded) {
      body.groundNormal.set(nx, ny, nz);
      body.groundMaterial = material || "stone";
      body.groundMesh = mesh || null;
      body.groundY = groundY;
      body.slopeAngle = Math.acos(clamp(ny, -1, 1));
      body.sliding = body.slopeAngle > body.maxSlope;
      if (body.sliding) {
        // Gravity projected onto the plane, normalised: the direction
        // water would run. slideDir is public because the moveset
        // steers along it during the slide action.
        const dx = nx * ny;
        const dy = ny * ny - 1;
        const dz = nz * ny;
        const l = Math.hypot(dx, dy, dz) || 1;
        body.slideDir.set(dx / l, dy / l, dz / l);
      } else {
        body.slideDir.set(0, 0, 0);
      }
      const plat = (mesh && c && typeof c.isMoving === "function" && c.isMoving(mesh)) ? mesh : null;
      if (plat !== body.platform) {
        body.platform = plat;
        body._hasPlatMat = false;
      }
      body.groundTime += h;
      if (!body.wasGrounded) {
        body.justLanded = true;
        body.landSpeed = -body.fallSpeed;
        body.airTime = 0;
        body.fallSpeed = 0;
        if (ctx.bus) ctx.bus.emit("physics:land", { body, speed: body.landSpeed, material: body.groundMaterial });
      }
    } else {
      body.sliding = false;
      body.slopeAngle = 0;
      body.slideDir.set(0, 0, 0);
      if (body.platform) { body.platform = null; body._hasPlatMat = false; }
      body.airTime += h;
      body.groundTime = 0;
    }
  }

  /* ------------------------------- stepping ------------------------------- */

  function substep(body, h) {
    substepCount += 1;
    sampleWater(body);
    applyForces(body, h);
    slopeResponse(body, h);

    _delta.copy(body.velocity).multiplyScalar(h);
    const res = moveAndSlide(body, _delta, _stepResult);

    if (res.hitCeiling) {
      const v = body.velocity;
      const n = res.ceilingNormal;
      /* A glancing ceiling deflects; a flat one stops you dead. The
         difference is what makes a low arch feel like architecture
         rather than a lid. */
      if (n.y > GLANCING_NY) {
        const into = v.x * n.x + v.y * n.y + v.z * n.z;
        if (into < 0) v.addScaledVector(n, -into);
      }
      if (v.y > 0) v.y = 0;
    }

    updateGround(body, res, h);

    body.hitWall = res.hitWall;
    if (res.hitWall) body.wallNormal.copy(res.wallNormal);
    body.hitCeiling = res.hitCeiling;
    if (res.hitCeiling) body.ceilingNormal.copy(res.ceilingNormal);
    body.steppedUp = res.stepped;
  }

  /**
   * Integrate and resolve.
   *
   * The accumulator is what makes 30fps and 144fps produce the same
   * jump arc, the same slide distance and the same screenshot. The
   * leftover stays on the body, so no time is invented or lost.
   */
  function step(body, dt) {
    if (!body || body.enabled === false) return body;
    body._steppedFrame = frameNow();
    const d = clamp(Number(dt) || 0, 0, 0.25);
    body.justLanded = false;
    body.steppedUp = 0;
    ridePlatform(body, d);
    body._acc += d;
    let n = 0;
    while (body._acc >= FIXED - 1e-9 && n < MAX_SUBSTEPS) {
      substep(body, FIXED);
      body._acc -= FIXED;
      n += 1;
    }
    // A frame long enough to exhaust the substep budget means the tab
    // was away. Drop the backlog rather than teleporting the player
    // through the level catching up.
    if (n >= MAX_SUBSTEPS) body._acc = 0;
    return body;
  }

  /* -------------------------------- debug -------------------------------- */

  /**
   * Wireframe capsules, ground normals and contact spikes. Built on
   * request and never added to a scene by this module - the camera
   * and moveset agents own where it goes. Call update() per frame.
   */
  function debugMesh(opts = {}) {
    const maxBodies = opts.maxBodies ?? 8;
    const SEG = 16;
    const perBody = SEG * 2 * 2 + 4 * 2 + 2 * 2;   // two rings, four struts, two rays
    const positions = new Float32Array(maxBodies * perBody * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: opts.color ?? 0xff5aa8, transparent: true, opacity: 0.9, depthTest: false,
    }));
    lines.name = "physics-debug";
    lines.frustumCulled = false;
    lines.renderOrder = 999;

    lines.update = () => {
      const arr = geo.attributes.position.array;
      let w = 0;
      const put = (x, y, z) => { arr[w++] = x; arr[w++] = y; arr[w++] = z; };
      for (let b = 0; b < Math.min(bodies.length, maxBodies); b += 1) {
        const body = bodies[b];
        const p = body.position;
        const r = body.radius;
        const yLo = p.y + r;
        const yHi = p.y + Math.max(r, body.height - r);
        for (const y of [yLo, yHi]) {
          for (let i = 0; i < SEG; i += 1) {
            const a0 = (i / SEG) * Math.PI * 2;
            const a1 = ((i + 1) / SEG) * Math.PI * 2;
            put(p.x + Math.cos(a0) * r, y, p.z + Math.sin(a0) * r);
            put(p.x + Math.cos(a1) * r, y, p.z + Math.sin(a1) * r);
          }
        }
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * Math.PI * 2;
          put(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
          put(p.x + Math.cos(a) * r, p.y + body.height, p.z + Math.sin(a) * r);
        }
        const n = body.groundNormal;
        put(p.x, p.y, p.z);
        put(p.x + n.x, p.y + n.y, p.z + n.z);
        const wn = body.wallNormal;
        put(p.x, p.y + body.height * 0.5, p.z);
        put(p.x + wn.x, p.y + body.height * 0.5 + wn.y, p.z + wn.z);
      }
      while (w < arr.length) arr[w++] = 0;
      geo.attributes.position.needsUpdate = true;
    };
    lines.update();
    return lines;
  }

  /* --------------------------------- api --------------------------------- */

  return {
    TUNING,
    bodies,
    createBody,
    destroyBody,
    step,
    moveAndSlide,
    unground,
    capsuleFree(body, x, y, z) {
      return capsuleFree(body, x ?? body.position.x, y ?? body.position.y, z ?? body.position.z);
    },

    /** Forwarded so a level builder can register water through either
     *  module without knowing which one owns the registry. */
    addWater(spec) { const c = col(); return c && c.addWater ? c.addWater(spec) : null; },
    removeWater(vol) { const c = col(); return c && c.removeWater ? c.removeWater(vol) : false; },

    debugMesh,

    update(context) {
      const c = context || ctx;
      const dt = c.clock ? c.clock.dt : 0;
      if (!(dt > 0)) return;
      const frame = c.clock.frame;
      for (let i = 0; i < bodies.length; i += 1) {
        const body = bodies[i];
        if (!body.enabled || body.auto === false) continue;
        if (body._steppedFrame === frame) continue;
        step(body, dt);
      }
    },

    stats() {
      const s = { bodies: bodies.length, substeps: substepCount, contacts: contactCount };
      substepCount = 0;
      contactCount = 0;
      return s;
    },
  };
}
