/* ============================================================
   Tardigrade Simulator - Rapier physics world

   Owner: the "physics" agent. This is the simulation foundation
   every other system builds on; treat the exported API as a
   contract and add to it rather than reshaping it.

   ------------------------------------------------------------
   WHAT LIVES HERE
   ------------------------------------------------------------
     * one tuned RAPIER.World stepped at ctx.FIXED_STEP (120 Hz)
     * named interaction layers so nobody hand-rolls bitmasks
     * body factories (static / dynamic / trimesh / heightfield /
       sensor) that return small handles with a .sync(mesh)
     * a capsule KinematicCharacterController service for player.js
     * a ragdoll builder (capsule chain + limited joints)
     * a grapple/rope service (clamped spring-damper + optional
       hard rope joint)
     * contact-force -> `impact` event surfacing for audio/vfx/score
     * previous/current transform interpolation so meshes never
       judder between fixed steps

   ------------------------------------------------------------
   SCALE + UNITS
   ------------------------------------------------------------
   1 world unit == 1 Three.js unit == "tardigrade-ish" length.
   The hero is 1.6 units long inside a ~900x900 unit map, gravity
   is ctx.GRAVITY (-19.6). Because the hero is small and fast,
   tunnelling is a genuine risk: continuous collision detection is
   enabled automatically for every small dynamic body.

   ------------------------------------------------------------
   DETERMINISM
   ------------------------------------------------------------
   Nothing here calls Math.random(). Rapier itself is deterministic
   for a fixed body-creation order and a fixed timestep, so as long
   as callers build their world in a stable order the simulation
   replays frame for frame.
   ============================================================ */

/* ------------------------------------------------------------------ */
/* Interaction layers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Membership bits. A collider belongs to exactly one of these (usually)
 * and lists the layers it is allowed to interact with in its filter.
 * Rapier packs both halves into one u32: (membership << 16) | filter.
 */
export const LAYER = Object.freeze({
  TERRAIN: 1 << 0, // ground, patio slabs, the big immovable world
  STATIC_PROP: 1 << 1, // scenery that never moves but is not terrain
  DYNAMIC_PROP: 1 << 2, // knockable, launchable, scoreable things
  HERO: 1 << 3, // the tardigrade's character capsule
  HERO_SENSOR: 1 << 4, // proboscis reach, stomp radius, grab probes
  CREATURE: 1 << 5, // mites, springtails, the neighbours
  DEBRIS: 1 << 6, // gravel, pollen, crumbs - cheap, ignores itself
  RAGDOLL: 1 << 7, // hero + creature ragdoll bones
  TRIGGER: 1 << 8, // world sensors (zones, checkpoints)
  WATER: 1 << 9, // puddles / droplet volumes (usually sensors)
  ALL: 0xffff,
});

/** Sensible "collides with" masks for each layer. Callers may override. */
export const LAYER_FILTER = Object.freeze({
  [LAYER.TERRAIN]:
    LAYER.HERO | LAYER.HERO_SENSOR | LAYER.DYNAMIC_PROP | LAYER.CREATURE | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.TRIGGER,
  [LAYER.STATIC_PROP]:
    LAYER.HERO | LAYER.HERO_SENSOR | LAYER.DYNAMIC_PROP | LAYER.CREATURE | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.TRIGGER,
  [LAYER.DYNAMIC_PROP]:
    LAYER.TERRAIN | LAYER.STATIC_PROP | LAYER.DYNAMIC_PROP | LAYER.HERO | LAYER.HERO_SENSOR |
    LAYER.CREATURE | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.TRIGGER | LAYER.WATER,
  [LAYER.HERO]:
    LAYER.TERRAIN | LAYER.STATIC_PROP | LAYER.DYNAMIC_PROP | LAYER.CREATURE | LAYER.DEBRIS |
    LAYER.TRIGGER | LAYER.WATER,
  [LAYER.HERO_SENSOR]:
    LAYER.TERRAIN | LAYER.STATIC_PROP | LAYER.DYNAMIC_PROP | LAYER.CREATURE | LAYER.DEBRIS | LAYER.RAGDOLL,
  [LAYER.CREATURE]:
    LAYER.TERRAIN | LAYER.STATIC_PROP | LAYER.DYNAMIC_PROP | LAYER.HERO | LAYER.HERO_SENSOR |
    LAYER.CREATURE | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.TRIGGER | LAYER.WATER,
  // Debris deliberately ignores other debris: hundreds of gravel chips
  // stay cheap and still collide with everything that matters.
  [LAYER.DEBRIS]:
    LAYER.TERRAIN | LAYER.STATIC_PROP | LAYER.DYNAMIC_PROP | LAYER.HERO | LAYER.HERO_SENSOR |
    LAYER.CREATURE | LAYER.WATER,
  [LAYER.RAGDOLL]:
    LAYER.TERRAIN | LAYER.STATIC_PROP | LAYER.DYNAMIC_PROP | LAYER.HERO_SENSOR |
    LAYER.CREATURE | LAYER.RAGDOLL | LAYER.TRIGGER | LAYER.WATER,
  [LAYER.TRIGGER]: LAYER.HERO | LAYER.CREATURE | LAYER.DYNAMIC_PROP | LAYER.RAGDOLL,
  [LAYER.WATER]: LAYER.HERO | LAYER.CREATURE | LAYER.DYNAMIC_PROP | LAYER.DEBRIS | LAYER.RAGDOLL,
});

/** Pack a Rapier interaction-group u32 from a membership + filter mask. */
export function interactionGroups(membership, filter) {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

/* ------------------------------------------------------------------ */
/* tiny math helpers (kept local so physics never imports the renderer) */
/* ------------------------------------------------------------------ */

const V0 = { x: 0, y: 0, z: 0 };

const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

function readVec(value, fallbackX = 0, fallbackY = 0, fallbackZ = 0) {
  if (!value) return vec3(fallbackX, fallbackY, fallbackZ);
  if (Array.isArray(value)) return vec3(value[0] || 0, value[1] || 0, value[2] || 0);
  return vec3(value.x || 0, value.y || 0, value.z || 0);
}

function readQuat(value) {
  if (!value) return { x: 0, y: 0, z: 0, w: 1 };
  const q = Array.isArray(value)
    ? { x: value[0] || 0, y: value[1] || 0, z: value[2] || 0, w: value.length > 3 ? value[3] : 1 }
    : { x: value.x || 0, y: value.y || 0, z: value.z || 0, w: value.w === undefined ? 1 : value.w };
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** out = q * v * q^-1 (rotate a vector by a unit quaternion). */
function rotateVec(q, v, out = { x: 0, y: 0, z: 0 }) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ */

export async function createPhysics(ctx) {
  const RAPIER = ctx.RAPIER;
  if (!RAPIER) throw new Error("createPhysics(ctx): ctx.RAPIER is not initialised");

  const GRAVITY = typeof ctx.GRAVITY === "number" ? ctx.GRAVITY : -19.6;
  const G_ABS = Math.abs(GRAVITY) || 9.81;
  const FIXED_STEP = ctx.FIXED_STEP || 1 / 120;
  const quality = (ctx.settings && ctx.settings.quality) || {};
  const events = ctx.events || { emit() {}, on() { return () => {}; } };

  /* ---------------------------------------------------------------- */
  /* World + solver tuning                                             */
  /* ---------------------------------------------------------------- */

  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  const params = world.integrationParameters;

  params.dt = FIXED_STEP;
  // 1 world unit behaves like ~1 metre dynamically (gravity is ~2g in
  // units/s^2), so the default length unit is correct. Everything Rapier
  // normalises - allowed error, prediction distance, sleep thresholds -
  // keys off this, so do not "fix" it to match the fictional micro-scale.
  params.lengthUnit = 1;
  // Solver quality scales with the render tier; low still has to be stable.
  const tierName = (ctx.settings && ctx.settings.tierName) || "high";
  const SOLVER_ITERS = { low: 4, medium: 6, high: 8, ultra: 8 };
  world.numSolverIterations = SOLVER_ITERS[tierName] || 8;
  world.numInternalPgsIterations = 1;
  // A little extra contact prediction keeps small props from popping
  // through each other at 120 Hz without making resting contacts floaty.
  params.normalizedPredictionDistance = 0.004;
  params.normalizedAllowedLinearError = 0.001;
  // Bigger islands = fewer solver dispatches when hundreds of props rest.
  params.minIslandSize = 128;
  world.maxCcdSubsteps = tierName === "low" ? 1 : 2;
  void quality;

  const eventQueue = new RAPIER.EventQueue(true);

  /* ---------------------------------------------------------------- */
  /* Registries                                                        */
  /* ---------------------------------------------------------------- */

  /** Every handle we created, in creation order (determinism). */
  const records = [];
  /** collider handle -> record, for event + query lookups. */
  const byCollider = new Map();
  /** rigid-body handle -> record, for the awake-body sweep. */
  const byBody = new Map();

  const ropes = [];
  const ragdolls = [];
  const characters = [];
  const sensors = [];

  let disposed = false;
  let stepIndex = 0;
  let stepMs = 0;
  let stepMsSum = 0;
  let stepMsCount = 0;
  let stepMsPeak = 0;
  let impactsThisStep = 0;
  let impactsTotal = 0;

  /* Tunables other systems may poke at runtime. */
  const tuning = {
    /** Dynamic bodies whose smallest half-extent is under this get full CCD. */
    ccdSizeLimit: 2.0,
    /** Contact-force events under (mass * g * this) are ignored as "resting". */
    impactForceFactor: 3.2,
    /** Absolute floor so featherweight things still ping. */
    impactForceFloor: 45,
    /** Ignore repeat impacts on the same pair inside this many seconds. */
    impactCooldown: 0.07,
    /** Hard cap on impact events emitted per fixed step. */
    maxImpactsPerStep: 24,
    /** Below this the aggressive sleeper starts counting. */
    sleepLinear: 0.16,
    sleepAngular: 0.35,
    /** Consecutive quiet scans before we force the body asleep. */
    sleepScans: 6,
    /** Run the sleep sweep every N fixed steps (120 Hz -> 15 Hz). */
    sleepInterval: 8,
    /** Default surface response. */
    friction: 0.85,
    restitution: 0.12,
  };

  /* ---------------------------------------------------------------- */
  /* Shape helpers                                                     */
  /* ---------------------------------------------------------------- */

  const isColliderDesc = (value) => !!value && typeof value.setRestitution === "function" && "shape" in value;

  /**
   * Accepts a ready-made RAPIER.ColliderDesc (preferred) or a plain
   * descriptor: {type:'box'|'ball'|'capsule'|'cylinder'|'cone'|'hull'|
   * 'trimesh', ...}. Returning the desc lets callers keep chaining.
   */
  function toColliderDesc(shape) {
    if (isColliderDesc(shape)) return shape;
    if (!shape || typeof shape !== "object") {
      throw new Error("physics: shape must be a RAPIER.ColliderDesc or a shape descriptor object");
    }
    const D = RAPIER.ColliderDesc;
    switch (shape.type) {
      case "box":
      case "cuboid": {
        const h = readVec(shape.halfExtents || shape.half || [0.5, 0.5, 0.5], 0.5, 0.5, 0.5);
        return D.cuboid(h.x, h.y, h.z);
      }
      case "ball":
      case "sphere":
        return D.ball(shape.radius === undefined ? 0.5 : shape.radius);
      case "capsule":
        return D.capsule(shape.halfHeight === undefined ? 0.5 : shape.halfHeight, shape.radius === undefined ? 0.25 : shape.radius);
      case "cylinder":
        return D.cylinder(shape.halfHeight === undefined ? 0.5 : shape.halfHeight, shape.radius === undefined ? 0.5 : shape.radius);
      case "cone":
        return D.cone(shape.halfHeight === undefined ? 0.5 : shape.halfHeight, shape.radius === undefined ? 0.5 : shape.radius);
      case "hull":
      case "convex":
        return D.convexHull(shape.vertices instanceof Float32Array ? shape.vertices : new Float32Array(shape.vertices));
      case "trimesh":
        return D.trimesh(
          shape.vertices instanceof Float32Array ? shape.vertices : new Float32Array(shape.vertices),
          shape.indices instanceof Uint32Array ? shape.indices : new Uint32Array(shape.indices)
        );
      default:
        throw new Error(`physics: unknown shape type "${shape.type}"`);
    }
  }

  /** Rough half-extents of a collider desc, used for CCD + soft-CCD tuning. */
  function shapeExtents(desc) {
    const s = desc && desc.shape;
    if (!s) return { min: 0.5, max: 0.5 };
    if (s.halfExtents) {
      const h = s.halfExtents;
      return { min: Math.min(h.x, h.y, h.z), max: Math.max(h.x, h.y, h.z) };
    }
    if (s.halfHeight !== undefined && s.radius !== undefined) {
      return { min: s.radius, max: s.halfHeight + s.radius };
    }
    if (s.radius !== undefined) return { min: s.radius, max: s.radius };
    if (s.vertices && s.vertices.length >= 3) {
      let minV = Infinity;
      let maxV = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = axis; i < s.vertices.length; i += 3) {
          const v = s.vertices[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const half = (hi - lo) * 0.5;
        if (half < minV) minV = half;
        if (half > maxV) maxV = half;
      }
      return { min: Number.isFinite(minV) ? minV : 0.5, max: maxV || 0.5 };
    }
    return { min: 0.5, max: 0.5 };
  }

  /* ---------------------------------------------------------------- */
  /* Record bookkeeping + interpolation state                          */
  /* ---------------------------------------------------------------- */

  function makeRecord(body, collider, options) {
    const t = body.translation();
    const r = body.rotation();
    const record = {
      body,
      collider,
      kind: options.kind || null,
      material: options.material || null,
      mesh: options.mesh || null,
      onSync: typeof options.onSync === "function" ? options.onSync : null,
      userData: options.userData === undefined ? null : options.userData,
      dynamic: options.dynamic === true,
      mass: options.dynamic ? body.mass() : 0,
      impactThreshold: 0,
      quiet: 0,
      stamp: -1,
      alive: true,
      /* previous + current transforms for render interpolation */
      p0: vec3(t.x, t.y, t.z),
      q0: { x: r.x, y: r.y, z: r.z, w: r.w },
      p1: vec3(t.x, t.y, t.z),
      q1: { x: r.x, y: r.y, z: r.z, w: r.w },

      setMesh(mesh) {
        record.mesh = mesh || null;
        return record;
      },
      /** Bind a mesh (optional) and snap it to the body immediately. */
      sync(mesh) {
        if (mesh) record.mesh = mesh;
        writeTransform(record, record.p1, record.q1);
        return record;
      },
      translation() { return record.body.translation(); },
      rotation() { return record.body.rotation(); },
      linvel() { return record.body.linvel(); },
      setTranslation(x, y, z) {
        record.body.setTranslation({ x, y, z }, true);
        snapRecord(record);
        return record;
      },
      setRotation(q) {
        record.body.setRotation(readQuat(q), true);
        snapRecord(record);
        return record;
      },
      setLinvel(x, y, z) { record.body.setLinvel({ x, y, z }, true); return record; },
      setAngvel(x, y, z) { record.body.setAngvel({ x, y, z }, true); return record; },
      applyImpulse(x, y, z) { record.body.applyImpulse({ x, y, z }, true); return record; },
      applyTorqueImpulse(x, y, z) { record.body.applyTorqueImpulse({ x, y, z }, true); return record; },
      applyImpulseAtPoint(impulse, point) {
        record.body.applyImpulseAtPoint(readVec(impulse), readVec(point), true);
        return record;
      },
      wake() { record.body.wakeUp(); record.quiet = 0; return record; },
      sleep() { record.body.sleep(); return record; },
      isSleeping() { return record.body.isSleeping(); },
      remove() { removeRecord(record); },
    };
    records.push(record);
    byBody.set(body.handle, record);
    if (collider) byCollider.set(collider.handle, record);
    return record;
  }

  function snapRecord(record) {
    const t = record.body.translation();
    const r = record.body.rotation();
    record.p0.x = record.p1.x = t.x;
    record.p0.y = record.p1.y = t.y;
    record.p0.z = record.p1.z = t.z;
    record.q0.x = record.q1.x = r.x;
    record.q0.y = record.q1.y = r.y;
    record.q0.z = record.q1.z = r.z;
    record.q0.w = record.q1.w = r.w;
    record.stamp = -1;
  }

  function writeTransform(record, p, q) {
    if (record.mesh) {
      if (record.mesh.position && record.mesh.quaternion) {
        record.mesh.position.set(p.x, p.y, p.z);
        record.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }
    }
    if (record.onSync) record.onSync(p.x, p.y, p.z, q.x, q.y, q.z, q.w, record);
  }

  function removeRecord(record) {
    if (disposed || !record || !record.alive) return;
    record.alive = false;
    if (record.collider) byCollider.delete(record.collider.handle);
    byBody.delete(record.body.handle);
    const idx = records.indexOf(record);
    if (idx >= 0) records.splice(idx, 1);
    // Removing the body removes its colliders and attached joints too.
    world.removeRigidBody(record.body);
    record.body = null;
    record.collider = null;
    record.mesh = null;
    record.onSync = null;
  }

  /* ---------------------------------------------------------------- */
  /* Body factories                                                    */
  /* ---------------------------------------------------------------- */

  function applyCommonCollider(desc, options, defaults) {
    const membership = options.group === undefined ? defaults.group : options.group;
    const filter = options.filter === undefined
      ? (LAYER_FILTER[membership] === undefined ? LAYER.ALL : LAYER_FILTER[membership])
      : options.filter;

    desc.setFriction(options.friction === undefined ? defaults.friction : options.friction);
    desc.setRestitution(options.restitution === undefined ? defaults.restitution : options.restitution);
    desc.setCollisionGroups(interactionGroups(membership, filter));
    if (options.solverGroups !== undefined) desc.setSolverGroups(options.solverGroups);
    if (options.sensor) desc.setSensor(true);
    if (options.contactSkin) desc.setContactSkin(options.contactSkin);
    if (options.frictionCombineRule !== undefined) desc.setFrictionCombineRule(options.frictionCombineRule);
    if (options.restitutionCombineRule !== undefined) desc.setRestitutionCombineRule(options.restitutionCombineRule);
    return { membership, filter };
  }

  /**
   * Immovable geometry. `shape` is a RAPIER.ColliderDesc (or descriptor).
   * @returns {{body, collider, remove():void}}
   */
  function addStatic(options = {}) {
    const position = readVec(options.position);
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    if (options.rotation) desc.setRotation(readQuat(options.rotation));
    const body = world.createRigidBody(desc);

    const colliderDesc = toColliderDesc(options.shape);
    applyCommonCollider(colliderDesc, options, {
      group: LAYER.STATIC_PROP,
      friction: tuning.friction,
      restitution: 0,
    });
    if (options.offset) {
      const o = readVec(options.offset);
      colliderDesc.setTranslation(o.x, o.y, o.z);
    }
    if (options.sensor) colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = world.createCollider(colliderDesc, body);
    return makeRecord(body, collider, { ...options, dynamic: false });
  }

  /**
   * A movable, launchable, scoreable body.
   * @returns handle - see makeRecord() for the full surface.
   */
  function addDynamic(options = {}) {
    const position = readVec(options.position);
    let desc = options.kinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(position.x, position.y, position.z);
    if (options.rotation) desc.setRotation(readQuat(options.rotation));
    if (options.linvel) { const v = readVec(options.linvel); desc.setLinvel(v.x, v.y, v.z); }
    if (options.angvel) desc.setAngvel(readVec(options.angvel));
    desc.setLinearDamping(options.linearDamping === undefined ? 0.05 : options.linearDamping);
    desc.setAngularDamping(options.angularDamping === undefined ? 0.15 : options.angularDamping);
    if (options.gravityScale !== undefined) desc.setGravityScale(options.gravityScale);
    if (options.dominance !== undefined) desc.setDominanceGroup(options.dominance);
    desc.setCanSleep(options.canSleep !== false);
    if (options.lockRotations) desc.lockRotations();
    if (options.lockTranslations) desc.lockTranslations();

    const colliderDesc = toColliderDesc(options.shape);
    const groups = applyCommonCollider(colliderDesc, options, {
      group: LAYER.DYNAMIC_PROP,
      friction: tuning.friction,
      restitution: tuning.restitution,
    });
    const extents = shapeExtents(colliderDesc);

    if (options.mass !== undefined && options.mass !== null) colliderDesc.setMass(options.mass);
    else if (options.density !== undefined) colliderDesc.setDensity(options.density);

    // --- continuous collision detection -----------------------------
    // Small bodies tunnel; big ones basically cannot. Auto-enable full
    // CCD below the size limit and give everything cheap soft-CCD.
    const wantsCcd = options.ccd === undefined ? extents.min <= tuning.ccdSizeLimit : options.ccd !== false;
    if (wantsCcd && !options.kinematic) desc.setCcdEnabled(true);
    desc.setSoftCcdPrediction(
      options.softCcd === undefined ? Math.max(0.25, extents.min * 2) : options.softCcd
    );

    const body = world.createRigidBody(desc);

    // Contact-force events drive audio/vfx/score. Only dynamic bodies
    // need the flag - Rapier unions the flags of both colliders.
    const mass = options.mass !== undefined && options.mass !== null
      ? options.mass
      : null;
    if (options.impacts !== false) {
      colliderDesc.setActiveEvents(
        options.sensor
          ? RAPIER.ActiveEvents.COLLISION_EVENTS
          : RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS
      );
    } else if (options.sensor) {
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }

    const collider = world.createCollider(colliderDesc, body);
    const realMass = body.mass() || mass || 1;
    const threshold = options.impactThreshold === undefined
      ? Math.max(tuning.impactForceFloor, realMass * G_ABS * tuning.impactForceFactor)
      : options.impactThreshold;
    collider.setContactForceEventThreshold(threshold);

    const record = makeRecord(body, collider, { ...options, dynamic: !options.kinematic });
    record.mass = realMass;
    record.impactThreshold = threshold;
    record.groups = groups;
    record.ccd = wantsCcd;
    if (record.mesh || record.onSync) record.sync();
    return record;
  }

  /**
   * Static collision straight off a Three.js BufferGeometry.
   * The matrix is baked into the vertices so non-uniform scale works.
   * @param {object} geometry BufferGeometry, or {positions, indices}
   * @param {object} matrix4  THREE.Matrix4 | number[16] | null
   */
  function addTrimesh(geometry, matrix4 = null, options = {}) {
    const attr = geometry && geometry.attributes ? geometry.attributes.position : null;
    const src = attr ? attr.array : (geometry && (geometry.positions || geometry.vertices));
    if (!src) throw new Error("physics.addTrimesh: geometry has no position data");

    const vertices = new Float32Array(src.length);
    const e = matrix4 ? (matrix4.elements || matrix4) : null;
    if (e && e.length >= 16) {
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i];
        const y = src[i + 1];
        const z = src[i + 2];
        const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
        vertices[i] = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
        vertices[i + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
        vertices[i + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
      }
    } else {
      vertices.set(src);
    }

    const indexAttr = geometry && geometry.index ? geometry.index.array : (geometry && geometry.indices);
    let indices;
    if (indexAttr) {
      indices = indexAttr instanceof Uint32Array ? indexAttr : new Uint32Array(indexAttr);
    } else {
      const count = vertices.length / 3;
      indices = new Uint32Array(count);
      for (let i = 0; i < count; i += 1) indices[i] = i;
    }

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    applyCommonCollider(colliderDesc, options, {
      group: options.group === undefined ? LAYER.TERRAIN : options.group,
      friction: options.friction === undefined ? 0.95 : options.friction,
      restitution: 0,
    });
    const collider = world.createCollider(colliderDesc, body);
    return makeRecord(body, collider, { ...options, dynamic: false, kind: options.kind || "trimesh" });
  }

  /** Rapier heightfield terrain. `heights` is row-major (nrows+1)*(ncols+1). */
  function addHeightfield(heights, nrows, ncols, scale, options = {}) {
    const origin = readVec(options.position);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z)
    );
    const data = heights instanceof Float32Array ? heights : new Float32Array(heights);
    const colliderDesc = RAPIER.ColliderDesc.heightfield(nrows, ncols, data, readVec(scale, 1, 1, 1));
    applyCommonCollider(colliderDesc, options, {
      group: LAYER.TERRAIN,
      friction: options.friction === undefined ? 0.95 : options.friction,
      restitution: 0,
    });
    const collider = world.createCollider(colliderDesc, body);
    return makeRecord(body, collider, { ...options, dynamic: false, kind: "heightfield" });
  }

  /**
   * A non-solid trigger volume. onEnter/onExit fire with the other
   * record (or null for unregistered colliders).
   */
  function addSensor(options = {}) {
    const record = addStatic({
      ...options,
      sensor: true,
      group: options.group === undefined ? LAYER.TRIGGER : options.group,
    });
    record.kind = options.kind || "sensor";
    record.onEnter = typeof options.onEnter === "function" ? options.onEnter : null;
    record.onExit = typeof options.onExit === "function" ? options.onExit : null;
    record.inside = new Set();
    sensors.push(record);
    const baseRemove = record.remove;
    record.remove = () => {
      const i = sensors.indexOf(record);
      if (i >= 0) sensors.splice(i, 1);
      baseRemove();
    };
    return record;
  }

  /* ---------------------------------------------------------------- */
  /* Fallback ground                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * world.js publishes real terrain, but physics loads first and props
   * that spawn before it would otherwise fall forever. This slab keeps
   * the sim sane; world.js should call removeFallbackGround() once its
   * own collision exists.
   */
  let fallbackGround = addStatic({
    position: [0, -0.5, 0],
    shape: RAPIER.ColliderDesc.cuboid(600, 0.5, 600),
    group: LAYER.TERRAIN,
    friction: 0.95,
    restitution: 0,
    kind: "fallback-ground",
    material: "soil",
  });

  function removeFallbackGround() {
    if (!fallbackGround) return false;
    fallbackGround.remove();
    fallbackGround = null;
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  const rayScratch = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const MISS = Object.freeze({ hit: false, point: null, normal: null, distance: Infinity, collider: null, body: null, record: null });

  /**
   * raycast(origin, direction, maxDistance, options|solid)
   * options: { solid, groups, filter (mask), exclude (record|collider|body), predicate }
   * @returns {{hit, point, normal, distance, collider, body, record}}
   */
  function raycast(origin, direction, maxDistance = 100, options = undefined) {
    const opts = typeof options === "boolean" ? { solid: options } : (options || {});
    const o = readVec(origin);
    const d = readVec(direction, 0, -1, 0);
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-9) return MISS;
    rayScratch.origin = o;
    rayScratch.dir = { x: d.x / len, y: d.y / len, z: d.z / len };

    const groups = opts.groups !== undefined
      ? opts.groups
      : interactionGroups(opts.membership === undefined ? LAYER.ALL : opts.membership,
        opts.filter === undefined ? LAYER.ALL : opts.filter);

    let excludeCollider = null;
    let excludeBody = null;
    if (opts.exclude) {
      const ex = opts.exclude;
      if (ex.collider && ex.body) { excludeCollider = ex.collider; excludeBody = ex.body; }
      else if (typeof ex.parent === "function") excludeCollider = ex;
      else excludeBody = ex;
    }

    const hit = world.castRayAndGetNormal(
      rayScratch,
      maxDistance,
      opts.solid !== false,
      opts.flags === undefined ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS : opts.flags,
      groups,
      excludeCollider,
      excludeBody,
      opts.predicate
    );
    if (!hit) return MISS;

    const toi = hit.timeOfImpact;
    const point = {
      x: rayScratch.origin.x + rayScratch.dir.x * toi,
      y: rayScratch.origin.y + rayScratch.dir.y * toi,
      z: rayScratch.origin.z + rayScratch.dir.z * toi,
    };
    const collider = hit.collider;
    const record = collider ? byCollider.get(collider.handle) || null : null;
    return {
      hit: true,
      point,
      normal: hit.normal,
      distance: toi,
      collider,
      body: collider ? collider.parent() : null,
      record,
      material: record ? record.material : null,
    };
  }

  /** Every registered dynamic body whose centre is inside a sphere. */
  function bodiesInRadius(center, radius, options = {}) {
    const c = readVec(center);
    const r2 = radius * radius;
    const out = [];
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!rec.alive || !rec.dynamic) continue;
      if (options.group && rec.groups && !(rec.groups.membership & options.group)) continue;
      const t = rec.body.translation();
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      const dz = t.z - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) out.push({ record: rec, distance: Math.sqrt(d2) });
    }
    return out;
  }

  /**
   * Goat-Sim-grade radial shove. Falls off linearly and always adds a
   * little lift so props arc instead of skidding.
   */
  function explode(center, radius, strength, options = {}) {
    const c = readVec(center);
    const lift = options.lift === undefined ? 0.45 : options.lift;
    const spin = options.spin === undefined ? 0.35 : options.spin;
    const hits = bodiesInRadius(c, radius, options);
    for (let i = 0; i < hits.length; i += 1) {
      const rec = hits[i].record;
      const t = rec.body.translation();
      let dx = t.x - c.x;
      let dy = t.y - c.y;
      let dz = t.z - c.z;
      const d = Math.hypot(dx, dy, dz) || 1e-4;
      dx /= d; dy /= d; dz /= d;
      const falloff = 1 - clamp(d / radius, 0, 1);
      const j = strength * falloff * rec.mass;
      rec.body.wakeUp();
      rec.body.applyImpulse({ x: dx * j, y: (dy + lift) * j, z: dz * j }, true);
      if (spin > 0) {
        rec.body.applyTorqueImpulse({ x: dz * j * spin, y: dx * j * spin, z: dy * j * spin }, true);
      }
    }
    return hits.length;
  }

  /* ---------------------------------------------------------------- */
  /* Character controller                                              */
  /* ---------------------------------------------------------------- */

  const characterCollisionScratch = new RAPIER.CharacterCollision();

  /**
   * A capsule kinematic character with autostep, slope limits and
   * snap-to-ground. player.js drives this; nothing else should.
   *
   * createCharacter({ radius, halfHeight, offset, position, mass,
   *                   autostepHeight, autostepMinWidth, maxSlopeDeg,
   *                   minSlideDeg, snapDistance, group, filter, pushProps })
   */
  function createCharacter(options = {}) {
    const radius = options.radius === undefined ? 0.34 : options.radius;
    const halfHeight = options.halfHeight === undefined ? 0.36 : options.halfHeight;
    // Rapier wants a small skin so the capsule never rests exactly on a
    // surface; ~6% of the radius is stable without visible float.
    const offset = options.offset === undefined ? Math.max(0.01, radius * 0.06) : options.offset;
    // A capsule cannot be both short and wide - its height can never be less
    // than twice its radius - so a flat, broad animal cannot be described by
    // one. `bodyRadius` asks for a ROUND CYLINDER instead: the same overall
    // height as the capsule it replaces, but a horizontal footprint set
    // independently, with rounded edges so the rim cannot catch on ledges
    // the way a hard cylinder lip does.
    const bodyRadius = options.bodyRadius === undefined ? 0 : options.bodyRadius;
    const halfTall = halfHeight + radius;
    const round = bodyRadius > 0
      ? Math.min(options.bodyRound === undefined ? 0.12 : options.bodyRound,
                 halfTall * 0.5, bodyRadius * 0.5)
      : 0;
    const position = readVec(options.position, 0, 2, 0);
    const membership = options.group === undefined ? LAYER.HERO : options.group;
    const filter = options.filter === undefined
      ? (LAYER_FILTER[membership] === undefined ? LAYER.ALL : LAYER_FILTER[membership])
      : options.filter;
    const groups = interactionGroups(membership, filter);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z)
    );
    // Same total height either way (2 * halfTall), so nothing that depends on
    // the hero's standing height - foot offset, autostep, snap - has to move.
    const shapeDesc = bodyRadius > 0
      ? (typeof RAPIER.ColliderDesc.roundCylinder === "function"
        ? RAPIER.ColliderDesc.roundCylinder(halfTall - round, bodyRadius - round, round)
        : RAPIER.ColliderDesc.cylinder(halfTall, bodyRadius))
      : RAPIER.ColliderDesc.capsule(halfHeight, radius);
    const colliderDesc = shapeDesc
      .setFriction(options.friction === undefined ? 0.6 : options.friction)
      .setRestitution(0)
      .setCollisionGroups(groups)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    const collider = world.createCollider(colliderDesc, body);

    const controller = world.createCharacterController(offset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(true);
    // Autostep tall enough to walk up gravel (0.3-0.8 units) without
    // jumping, but never taller than the capsule can plausibly mount.
    controller.enableAutostep(
      // Raised from 0.55. This world is full of grit, chips and paving relief
      // a real tardigrade would simply clamber over; at 0.55 a great many of
      // them were hard walls the player could not pass, which reads as an
      // invisible barrier because the obstruction is a centimetre of gravel.
      // A tardigrade climbs. They walk up moss stems and glass; nothing in a
      // flowerbed should stop one. Raised far beyond a humanoid step height
      // so grit, paving lips, crack edges and prop sides are all simply
      // walked over - those were being reported as invisible walls because
      // the obstruction is a couple of millimetres of gravel that the player
      // cannot see but the capsule cannot pass.
      options.autostepHeight === undefined ? Math.min(3.4, halfTall * 7.5) : options.autostepHeight,
      // Accept a very narrow ledge to step onto - a crack edge or a chip of
      // grit gives almost no landing width.
      options.autostepMinWidth === undefined ? 0.04 : options.autostepMinWidth,
      options.autostepDynamic !== false
    );
    // 52 degrees is a humanoid limit. This animal has claws and clings to
    // whatever it is on, so near-vertical faces should be climbable; that is
    // both correct for a tardigrade and the thing that stops a slope reading
    // as an invisible wall.
    controller.setMaxSlopeClimbAngle((options.maxSlopeDeg === undefined ? 84 : options.maxSlopeDeg) * Math.PI / 180);
    // Must track the climb angle. Leaving this at 38 while the climb limit is
    // 84 means the animal walks up a steep face and is then slid straight back
    // down it, which feels exactly like the wall it was supposed to fix.
    controller.setMinSlopeSlideAngle((options.minSlideDeg === undefined ? 80 : options.minSlideDeg) * Math.PI / 180);
    // Snap must stay small: callers compare the returned delta against
    // what they asked for, and a big snap dwarfs one step of walking.
    controller.enableSnapToGround(
      options.snapDistance === undefined ? Math.min(0.12, radius * 0.45) : options.snapDistance
    );
    controller.setApplyImpulsesToDynamicBodies(options.pushProps !== false);
    controller.setCharacterMass(options.mass === undefined ? 1.2 : options.mass);
    if (options.normalNudge !== undefined) controller.setNormalNudgeFactor(options.normalNudge);

    const record = makeRecord(body, collider, {
      kind: options.kind || "character",
      material: options.material || "chitin",
      dynamic: false,
      mesh: null,
    });
    record.isCharacter = true;

    const state = {
      /** The corrected movement for this step (a DELTA, like Rapier's
       *  computedMovement) - i.e. `desiredTranslation` after collision
       *  resolution, autostep and snap-to-ground. */
      translation: vec3(0, 0, 0),
      /** Alias of `translation`, for callers that prefer the noun. */
      movement: vec3(0, 0, 0),
      /** The absolute world position the capsule will occupy. */
      position: vec3(position.x, position.y, position.z),
      grounded: false,
      slope: 0,
      hitCount: 0,
      collisions: [],
      groundNormal: vec3(0, 1, 0),
      groundRecord: null,
      groundMaterial: null,
    };

    const filterFlags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const groundDown = vec3(0, -1, 0);
    let alive = true;

    const api = {
      body,
      collider,
      controller,
      record,
      radius,
      halfHeight,
      offset,
      /** Horizontal half-extent actually in the world (0 -> capsule radius). */
      bodyRadius: bodyRadius > 0 ? bodyRadius : radius,

      /**
       * @param {{x,y,z}|number[]} desiredTranslation movement for this step
       * @param {number} dt fixed step (informational; Rapier uses world.timestep)
       * @returns {{translation, movement, position, grounded, slope, hitCount,
       *            collisions, groundNormal, groundMaterial}}
       *   `translation` is the DELTA actually applied this step.
       */
      move(desiredTranslation, dt = world.timestep) {
        if (!alive) return state;
        const desired = readVec(desiredTranslation);
        controller.computeColliderMovement(collider, desired, filterFlags, groups, undefined);

        const moved = controller.computedMovement();
        state.grounded = controller.computedGrounded();

        const n = controller.numComputedCollisions();
        state.hitCount = n;
        state.collisions.length = 0;
        for (let i = 0; i < n; i += 1) {
          const hit = controller.computedCollision(i, characterCollisionScratch);
          if (!hit) continue;
          const other = hit.collider;
          const rec = other ? byCollider.get(other.handle) || null : null;
          const otherBody = other ? other.parent() : null;
          // normal2 is the outward normal on the obstacle - the useful one.
          const nrm = hit.normal2 || hit.normal1 || groundDown;
          state.collisions.push({
            collider: other,
            body: otherBody,
            record: rec,
            material: rec ? rec.material : null,
            point: hit.witness2 ? { ...hit.witness2 } : { ...state.position },
            normal: { x: nrm.x, y: nrm.y, z: nrm.z },
            normal1: hit.normal1 ? { ...hit.normal1 } : null,
            normal2: hit.normal2 ? { ...hit.normal2 } : null,
            toi: hit.toi,
            applied: hit.translationDeltaApplied ? { ...hit.translationDeltaApplied } : null,
            remaining: hit.translationDeltaRemaining ? { ...hit.translationDeltaRemaining } : null,
            dynamic: otherBody ? otherBody.isDynamic() : false,
          });
        }

        const t = body.translation();
        state.translation.x = moved.x;
        state.translation.y = moved.y;
        state.translation.z = moved.z;
        state.movement.x = moved.x;
        state.movement.y = moved.y;
        state.movement.z = moved.z;
        state.position.x = t.x + moved.x;
        state.position.y = t.y + moved.y;
        state.position.z = t.z + moved.z;
        body.setNextKinematicTranslation(state.position);

        // Ground normal + slope from a short probe: far more reliable than
        // guessing which collision was "the floor".
        if (state.grounded) {
          const probe = raycast(
            { x: state.position.x, y: state.position.y, z: state.position.z },
            groundDown,
            halfHeight + radius + offset * 6 + 0.05,
            { exclude: api, solid: true, groups }
          );
          if (probe.hit && probe.normal) {
            const ny = probe.normal.y >= 0 ? probe.normal : { x: -probe.normal.x, y: -probe.normal.y, z: -probe.normal.z };
            state.groundNormal.x = ny.x;
            state.groundNormal.y = ny.y;
            state.groundNormal.z = ny.z;
            state.slope = Math.acos(clamp(ny.y, -1, 1));
            state.groundRecord = probe.record;
            state.groundMaterial = probe.material;
          } else {
            state.slope = 0;
            state.groundNormal.x = 0; state.groundNormal.y = 1; state.groundNormal.z = 0;
            state.groundRecord = null;
            state.groundMaterial = null;
          }
        } else {
          state.slope = 0;
          state.groundRecord = null;
          state.groundMaterial = null;
        }
        return state;
      },

      /** Hard teleport: skips the controller, no collision resolution. */
      teleport(x, y, z) {
        body.setTranslation({ x, y, z }, true);
        body.setNextKinematicTranslation({ x, y, z });
        state.position.x = x; state.position.y = y; state.position.z = z;
        state.translation.x = 0; state.translation.y = 0; state.translation.z = 0;
        state.movement.x = 0; state.movement.y = 0; state.movement.z = 0;
        state.grounded = false;
        state.collisions.length = 0;
        state.hitCount = 0;
        snapRecord(record);
      },
      /** Convenience for callers holding a vector. */
      setPosition(v) { const p = readVec(v); api.teleport(p.x, p.y, p.z); },

      translation() { return body.translation(); },
      setEnabled(enabled) { collider.setEnabled(enabled); body.setEnabled(enabled); },
      isEnabled() { return body.isEnabled(); },
      get grounded() { return state.grounded; },
      get slope() { return state.slope; },
      get collisions() { return state.collisions; },
      state,

      dispose() {
        if (!alive) return;
        alive = false;
        const i = characters.indexOf(api);
        if (i >= 0) characters.splice(i, 1);
        world.removeCharacterController(controller);
        removeRecord(record);
      },
    };
    // raycast() exclusion accepts {collider, body}
    api.collider = collider;
    characters.push(api);
    return api;
  }

  /* ---------------------------------------------------------------- */
  /* Ragdolls                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * createRagdoll(bones, options)
   *
   * bones: array of
   *   {
   *     name?: string,
   *     position?: [x,y,z],          // world centre of the capsule
   *     offset?: [x,y,z],            // ...or a centre relative to options.origin
   *     rotation?: [x,y,z,w],
   *     radius?: number, halfHeight?: number,   // capsule (local +Y)
   *     shape?: RAPIER.ColliderDesc,            // overrides the capsule
   *     mass?: number, density?: number,
   *     parent?: number,             // index into bones, default i-1
   *     joint?: {
   *       type?: 'revolute' | 'spherical' | 'fixed',
   *       axis?: [x,y,z],            // revolute hinge axis (world-ish local)
   *       limits?: [min, max],       // radians, revolute only
   *       cone?: number,             // radians, spherical soft limit
   *       coneStiffness?: number,
   *       anchorA?: [x,y,z], anchorB?: [x,y,z],  // local anchors; auto if absent
   *       contacts?: boolean         // default false between jointed bones
   *     },
   *     linearDamping?, angularDamping?
   *   }
   *
   * options: { origin, group, filter, linearDamping, angularDamping, enabled }
   *
   * A rig described purely with `offset` and no `origin` is treated as a
   * template: it is built disabled, and setEnabled(true, position, velocity)
   * drops it into the world at that position. Rigs with absolute positions
   * are live immediately.
   *
   * @returns {{bones, joints, center(), settled(), applyImpulse(), setEnabled(), dispose()}}
   */
  function createRagdoll(bones, options = {}) {
    if (!Array.isArray(bones) || bones.length === 0) {
      throw new Error("physics.createRagdoll: bones must be a non-empty array");
    }
    const originGiven = options.origin || options.position || null;
    const origin = readVec(originGiven);
    const hasAbsolute = bones.some((b) => b && b.position);
    const startEnabled = options.enabled === undefined
      ? (hasAbsolute || Boolean(originGiven))
      : options.enabled !== false;
    const membership = options.group === undefined ? LAYER.RAGDOLL : options.group;
    const filter = options.filter === undefined
      ? (LAYER_FILTER[membership] === undefined ? LAYER.ALL : LAYER_FILTER[membership])
      : options.filter;
    // Ragdoll bones settle instead of buzzing: high angular damping,
    // modest linear damping, and joints that carry contacts off.
    const linearDamping = options.linearDamping === undefined ? 0.35 : options.linearDamping;
    const angularDamping = options.angularDamping === undefined ? 1.6 : options.angularDamping;

    const built = [];
    const joints = [];
    const coneLimits = [];

    for (let i = 0; i < bones.length; i += 1) {
      const bone = bones[i] || {};
      const radius = bone.radius === undefined ? 0.16 : bone.radius;
      const halfHeight = bone.halfHeight === undefined ? 0.18 : bone.halfHeight;
      const shape = bone.shape || RAPIER.ColliderDesc.capsule(halfHeight, radius);
      const offset = bone.offset ? readVec(bone.offset) : null;
      const where = bone.position
        ? readVec(bone.position)
        : vec3(origin.x + (offset ? offset.x : 0), origin.y + (offset ? offset.y : 0), origin.z + (offset ? offset.z : 0));
      const rec = addDynamic({
        position: where,
        rotation: bone.rotation,
        shape,
        mass: bone.mass,
        density: bone.mass === undefined ? (bone.density === undefined ? 1.1 : bone.density) : undefined,
        friction: bone.friction === undefined ? 0.9 : bone.friction,
        restitution: bone.restitution === undefined ? 0.03 : bone.restitution,
        linearDamping: bone.linearDamping === undefined ? linearDamping : bone.linearDamping,
        angularDamping: bone.angularDamping === undefined ? angularDamping : bone.angularDamping,
        group: membership,
        filter,
        ccd: bone.ccd === undefined ? true : bone.ccd,
        kind: "ragdoll-bone",
        material: bone.material || options.material || "chitin",
        mesh: bone.mesh || null,
        onSync: bone.onSync || null,
        impacts: bone.impacts !== undefined ? bone.impacts : options.impacts !== false,
        canSleep: true,
      });
      rec.boneName = bone.name || `bone${i}`;
      rec.boneIndex = i;
      rec.radius = radius;
      rec.halfHeight = halfHeight;
      rec.restOffset = vec3(where.x - origin.x, where.y - origin.y, where.z - origin.z);
      built.push(rec);
    }

    for (let i = 0; i < bones.length; i += 1) {
      const bone = bones[i] || {};
      const parentIndex = bone.parent === undefined ? i - 1 : bone.parent;
      if (parentIndex === null || parentIndex < 0 || parentIndex >= built.length || parentIndex === i) continue;
      const parentRec = built[parentIndex];
      const childRec = built[i];
      const cfg = bone.joint || {};

      // Auto anchors: the midpoint between the two bone centres, expressed
      // in each body's local frame. Correct for a capsule chain.
      const pa = parentRec.body.translation();
      const pb = childRec.body.translation();
      const mid = vec3((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5, (pa.z + pb.z) * 0.5);
      const anchorA = cfg.anchorA
        ? readVec(cfg.anchorA)
        : localise(parentRec.body, mid);
      const anchorB = cfg.anchorB
        ? readVec(cfg.anchorB)
        : localise(childRec.body, mid);

      const type = cfg.type || "revolute";
      let data;
      if (type === "fixed") {
        data = RAPIER.JointData.fixed(anchorA, { x: 0, y: 0, z: 0, w: 1 }, anchorB, { x: 0, y: 0, z: 0, w: 1 });
      } else if (type === "spherical") {
        data = RAPIER.JointData.spherical(anchorA, anchorB);
      } else {
        data = RAPIER.JointData.revolute(anchorA, anchorB, readVec(cfg.axis, 1, 0, 0));
      }

      const joint = world.createImpulseJoint(data, parentRec.body, childRec.body, true);
      // Jointed neighbours overlap at the anchor by design; contacts
      // between them would fight the joint and buzz.
      joint.setContactsEnabled(cfg.contacts === true);

      if (type === "revolute" && typeof joint.setLimits === "function") {
        const limits = cfg.limits || [-0.7, 0.7];
        joint.setLimits(limits[0], limits[1]);
      }
      if (type === "spherical" && cfg.cone !== undefined && cfg.cone !== null) {
        // Rapier's JS bindings expose no spherical limits, so hold the
        // cone with a soft corrective torque - enough to stop the chain
        // folding through itself without deadening the flop.
        coneLimits.push({
          parent: parentRec.body,
          child: childRec.body,
          axis: readVec(cfg.coneAxis, 0, 1, 0),
          cone: cfg.cone,
          stiffness: cfg.coneStiffness === undefined ? 6 : cfg.coneStiffness,
        });
      }
      joints.push(joint);
    }

    let alive = true;
    const handle = {
      bones: built,
      joints,
      coneLimits,

      center() {
        let x = 0; let y = 0; let z = 0;
        for (let i = 0; i < built.length; i += 1) {
          const t = built[i].body.translation();
          x += t.x; y += t.y; z += t.z;
        }
        const n = built.length || 1;
        return vec3(x / n, y / n, z / n);
      },
      /** Largest bone speed - handy for "has it stopped flailing yet". */
      maxSpeed() {
        let best = 0;
        for (let i = 0; i < built.length; i += 1) {
          const v = built[i].body.linvel();
          const s = Math.hypot(v.x, v.y, v.z);
          if (s > best) best = s;
        }
        return best;
      },
      settled(threshold = 0.4) {
        return handle.maxSpeed() <= threshold;
      },
      wake() { for (const b of built) b.body.wakeUp(); },
      applyImpulse(impulse, boneIndex = 0) {
        const rec = built[clamp(boneIndex, 0, built.length - 1)];
        const v = readVec(impulse);
        rec.body.wakeUp();
        rec.body.applyImpulse(v, true);
      },
      launch(impulse) {
        const v = readVec(impulse);
        for (const b of built) {
          b.body.wakeUp();
          b.body.applyImpulse({ x: v.x * b.mass, y: v.y * b.mass, z: v.z * b.mass }, true);
        }
      },
      teleport(x, y, z) {
        const c = handle.center();
        for (const b of built) {
          const t = b.body.translation();
          b.body.setTranslation({ x: t.x - c.x + x, y: t.y - c.y + y, z: t.z - c.z + z }, true);
          b.body.setLinvel(V0, true);
          b.body.setAngvel(V0, true);
          snapRecord(b);
        }
      },
      /**
       * setEnabled(on) toggles the rig in place.
       * setEnabled(true, position, velocity) drops it in at `position`
       * (bones keep their authored relative layout) carrying `velocity`
       * - this is the hero's ragdoll toggle.
       */
      setEnabled(enabled, position, velocity) {
        const on = enabled !== false;
        if (on) {
          for (const b of built) {
            if (b.collider) b.collider.setEnabled(true);
            b.body.setEnabled(true);
          }
          if (position) {
            const p = readVec(position);
            for (const b of built) {
              const o = b.restOffset || V0;
              b.body.setTranslation({ x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }, true);
              b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
              b.body.setAngvel(V0, true);
              snapRecord(b);
            }
          }
          const v = velocity ? readVec(velocity) : null;
          for (const b of built) {
            if (v) b.body.setLinvel(v, true);
            b.body.wakeUp();
            b.quiet = 0;
          }
        } else {
          for (const b of built) {
            b.body.setLinvel(V0, true);
            b.body.setAngvel(V0, true);
            b.body.sleep();
            if (b.collider) b.collider.setEnabled(false);
            b.body.setEnabled(false);
          }
        }
        handle.enabled = on;
      },
      get enabledState() { return handle.enabled; },
      dispose() {
        if (!alive) return;
        alive = false;
        const i = ragdolls.indexOf(handle);
        if (i >= 0) ragdolls.splice(i, 1);
        for (const b of built) removeRecord(b);
        joints.length = 0;
        coneLimits.length = 0;
      },
    };
    handle.enabled = true;
    if (!startEnabled) handle.setEnabled(false);
    ragdolls.push(handle);
    return handle;
  }

  /** World point -> body-local point. */
  function localise(body, worldPoint) {
    const t = body.translation();
    const r = body.rotation();
    const inv = { x: -r.x, y: -r.y, z: -r.z, w: r.w };
    return rotateVec(inv, vec3(worldPoint.x - t.x, worldPoint.y - t.y, worldPoint.z - t.z));
  }

  const coneScratchA = vec3();
  const coneScratchB = vec3();

  function applyConeLimits() {
    for (let r = 0; r < ragdolls.length; r += 1) {
      const limits = ragdolls[r].coneLimits;
      for (let i = 0; i < limits.length; i += 1) {
        const lim = limits[i];
        const qa = lim.parent.rotation();
        const qb = lim.child.rotation();
        rotateVec(qa, lim.axis, coneScratchA);
        rotateVec(qb, lim.axis, coneScratchB);
        let dot = coneScratchA.x * coneScratchB.x + coneScratchA.y * coneScratchB.y + coneScratchA.z * coneScratchB.z;
        dot = clamp(dot, -1, 1);
        const angle = Math.acos(dot);
        if (angle <= lim.cone) continue;
        // Torque about the axis that brings the child back inside the cone.
        let ax = coneScratchB.y * coneScratchA.z - coneScratchB.z * coneScratchA.y;
        let ay = coneScratchB.z * coneScratchA.x - coneScratchB.x * coneScratchA.z;
        let az = coneScratchB.x * coneScratchA.y - coneScratchB.y * coneScratchA.x;
        const len = Math.hypot(ax, ay, az);
        if (len < 1e-6) continue;
        ax /= len; ay /= len; az /= len;
        const excess = angle - lim.cone;
        const k = lim.stiffness * excess * lim.child.mass() * world.timestep;
        lim.child.applyTorqueImpulse({ x: ax * k, y: ay * k, z: az * k }, true);
        lim.parent.applyTorqueImpulse({ x: -ax * k * 0.5, y: -ay * k * 0.5, z: -az * k * 0.5 }, true);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Grapple / rope                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * attachRope(bodyA, bodyB, anchorA, anchorB, length, stiffness, options)
   * attachRope({ from, to, anchor, length, stiffness, damping, ... })
   *
   * Both call shapes are supported: the positional form takes body-local
   * anchors, the object form additionally accepts a world-space `anchor`
   * (or `point`) which is converted into each body's local frame - that
   * is what a grapple hit gives you.
   *
   * Implemented as a clamped spring-damper applied every fixed step
   * rather than a rigid constraint, because the comedy needs an explicit
   * force ceiling: pull a crumb and the crumb comes to you, pull a
   * plant pot and you come to the plant pot.
   *
   * options: { damping, dampingRatio, maxForce, pullOnly, hardLimit,
   *            breakForce, onBreak }
   * @returns handle with .detach(), .setLength(), .tension, .taut - or
   *          null if either end is not a usable body.
   */
  function attachRope(bodyA, bodyB, anchorA, anchorB, length = 4, stiffness = 240, options = {}) {
    // --- object form -------------------------------------------------
    if (bodyA && typeof bodyA === "object" && !resolveBody(bodyA) &&
        (bodyA.from !== undefined || bodyA.to !== undefined || bodyA.bodyA !== undefined || bodyA.bodyB !== undefined)) {
      const o = bodyA;
      const fromBody = resolveBody(o.from !== undefined ? o.from : o.bodyA);
      const toBody = resolveBody(o.to !== undefined ? o.to : o.bodyB);
      if (!fromBody || !toBody) return null;
      const worldAnchor = o.anchor || o.point || o.worldAnchorB || null;
      const localA = o.anchorA || o.fromAnchor
        || (o.worldAnchorA ? localise(fromBody, readVec(o.worldAnchorA)) : vec3());
      const localB = o.anchorB || o.toAnchor
        || (worldAnchor ? localise(toBody, readVec(worldAnchor)) : vec3());
      let restLength = o.length;
      if (restLength === undefined || restLength === null) {
        const ta = fromBody.translation();
        const tb = toBody.translation();
        restLength = Math.hypot(tb.x - ta.x, tb.y - ta.y, tb.z - ta.z);
      }
      return attachRope(
        fromBody,
        toBody,
        localA,
        localB,
        restLength,
        o.stiffness === undefined ? 240 : o.stiffness,
        o
      );
    }

    const a = resolveBody(bodyA);
    const b = resolveBody(bodyB);
    if (!a || !b) throw new Error("physics.attachRope: both bodies must be valid");

    const invMassA = a.isDynamic() ? a.invMass() : 0;
    const invMassB = b.isDynamic() ? b.invMass() : 0;
    const invSum = invMassA + invMassB;
    const effMass = invSum > 1e-9 ? 1 / invSum : 1;
    const ratio = options.dampingRatio === undefined ? 0.9 : options.dampingRatio;
    const damping = options.damping === undefined
      ? 2 * ratio * Math.sqrt(Math.max(stiffness, 1e-4) * effMass)
      : options.damping;

    const rope = {
      bodyA: a,
      bodyB: b,
      anchorA: readVec(anchorA),
      anchorB: readVec(anchorB),
      length,
      stiffness,
      damping,
      /** The comedy dial. Heavier-than-this targets drag YOU instead. */
      maxForce: options.maxForce === undefined ? 900 : options.maxForce,
      pullOnly: options.pullOnly !== false,
      breakForce: options.breakForce === undefined ? Infinity : options.breakForce,
      onBreak: typeof options.onBreak === "function" ? options.onBreak : null,
      joint: null,
      tension: 0,
      distance: 0,
      taut: false,
      alive: true,
      pointA: vec3(),
      pointB: vec3(),

      setLength(value) { rope.length = Math.max(0, value); return rope; },
      /** Reel in / pay out, clamped to >= 0. */
      reel(delta) { rope.length = Math.max(0, rope.length + delta); return rope; },
      setStiffness(value) { rope.stiffness = value; return rope; },
      setMaxForce(value) { rope.maxForce = value; return rope; },
      detach() { detachRope(rope); },
    };

    if (options.hardLimit) {
      // Optional inextensible backstop on top of the spring.
      rope.joint = world.createImpulseJoint(
        RAPIER.JointData.rope(length * (options.hardLimitSlack === undefined ? 1.15 : options.hardLimitSlack), rope.anchorA, rope.anchorB),
        a,
        b,
        true
      );
      rope.joint.setContactsEnabled(false);
    }

    ropes.push(rope);
    return rope;
  }

  function detachRope(rope) {
    if (!rope || !rope.alive) return false;
    rope.alive = false;
    const i = ropes.indexOf(rope);
    if (i >= 0) ropes.splice(i, 1);
    if (rope.joint && !disposed) {
      world.removeImpulseJoint(rope.joint, true);
      rope.joint = null;
    }
    return true;
  }

  /** Accept a RAPIER.RigidBody, one of our handles, or a character. */
  function resolveBody(value) {
    if (!value) return null;
    if (typeof value.isDynamic === "function") return value;
    if (value.body && typeof value.body.isDynamic === "function") return value.body;
    return null;
  }

  const ropeWorldA = vec3();
  const ropeWorldB = vec3();

  function applyRopeForces(step) {
    for (let i = ropes.length - 1; i >= 0; i -= 1) {
      const rope = ropes[i];
      const a = rope.bodyA;
      const b = rope.bodyB;
      if (!a.isValid() || !b.isValid()) { detachRope(rope); continue; }

      const ta = a.translation();
      const tb = b.translation();
      rotateVec(a.rotation(), rope.anchorA, ropeWorldA);
      rotateVec(b.rotation(), rope.anchorB, ropeWorldB);
      ropeWorldA.x += ta.x; ropeWorldA.y += ta.y; ropeWorldA.z += ta.z;
      ropeWorldB.x += tb.x; ropeWorldB.y += tb.y; ropeWorldB.z += tb.z;

      let dx = ropeWorldB.x - ropeWorldA.x;
      let dy = ropeWorldB.y - ropeWorldA.y;
      let dz = ropeWorldB.z - ropeWorldA.z;
      const dist = Math.hypot(dx, dy, dz);
      rope.distance = dist;
      rope.pointA.x = ropeWorldA.x; rope.pointA.y = ropeWorldA.y; rope.pointA.z = ropeWorldA.z;
      rope.pointB.x = ropeWorldB.x; rope.pointB.y = ropeWorldB.y; rope.pointB.z = ropeWorldB.z;
      if (dist < 1e-6) { rope.tension = 0; rope.taut = false; continue; }
      dx /= dist; dy /= dist; dz /= dist;

      const extension = dist - rope.length;
      if (rope.pullOnly && extension <= 0) { rope.tension = 0; rope.taut = false; continue; }
      rope.taut = true;

      // Relative velocity along the rope, for the damping term.
      const va = a.velocityAtPoint(ropeWorldA);
      const vb = b.velocityAtPoint(ropeWorldB);
      const closing = (vb.x - va.x) * dx + (vb.y - va.y) * dy + (vb.z - va.z) * dz;

      let force = rope.stiffness * extension + rope.damping * closing;
      if (rope.pullOnly && force < 0) force = 0;
      const magnitude = Math.abs(force);
      if (magnitude > rope.maxForce) force = Math.sign(force) * rope.maxForce;
      rope.tension = Math.abs(force);

      if (rope.tension >= rope.breakForce) {
        const onBreak = rope.onBreak;
        detachRope(rope);
        events.emit("rope:break", { position: { ...rope.pointB }, tension: rope.tension });
        if (onBreak) onBreak(rope);
        continue;
      }

      const impulse = force * step;
      if (a.isDynamic()) {
        a.wakeUp();
        a.applyImpulseAtPoint({ x: dx * impulse, y: dy * impulse, z: dz * impulse }, ropeWorldA, true);
      }
      if (b.isDynamic()) {
        b.wakeUp();
        b.applyImpulseAtPoint({ x: -dx * impulse, y: -dy * impulse, z: -dz * impulse }, ropeWorldB, true);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  /** pairKey -> last emission time, so a grinding contact pings once. */
  const impactClock = new Map();
  let simTime = 0;

  function contactPointFor(colliderA, colliderB, out) {
    let found = false;
    try {
      world.contactPair(colliderA, colliderB, (manifold) => {
        if (found || !manifold) return;
        if (manifold.numSolverContacts() > 0) {
          const p = manifold.solverContactPoint(0);
          if (p) { out.x = p.x; out.y = p.y; out.z = p.z; found = true; }
        }
      });
    } catch (error) {
      found = false;
    }
    if (!found) {
      const a = colliderA.translation();
      const b = colliderB.translation();
      out.x = (a.x + b.x) * 0.5;
      out.y = (a.y + b.y) * 0.5;
      out.z = (a.z + b.z) * 0.5;
    }
    return out;
  }

  const impactPoint = vec3();

  function drainEvents(step) {
    impactsThisStep = 0;

    eventQueue.drainCollisionEvents((h1, h2, started) => {
      const a = byCollider.get(h1);
      const b = byCollider.get(h2);
      const sensorRec = a && a.inside ? a : (b && b.inside ? b : null);
      if (sensorRec) {
        const other = sensorRec === a ? b : a;
        const otherCollider = sensorRec === a ? world.getCollider(h2) : world.getCollider(h1);
        if (started) {
          sensorRec.inside.add(sensorRec === a ? h2 : h1);
          if (sensorRec.onEnter) sensorRec.onEnter(other || null, otherCollider || null);
          events.emit("sensor:enter", { sensor: sensorRec, other: other || null, collider: otherCollider || null });
        } else {
          sensorRec.inside.delete(sensorRec === a ? h2 : h1);
          if (sensorRec.onExit) sensorRec.onExit(other || null, otherCollider || null);
          events.emit("sensor:exit", { sensor: sensorRec, other: other || null, collider: otherCollider || null });
        }
      }
      events.emit("physics:contact", { a: a || null, b: b || null, started });
    });

    eventQueue.drainContactForceEvents((event) => {
      if (impactsThisStep >= tuning.maxImpactsPerStep) return;
      const force = event.totalForceMagnitude();
      const h1 = event.collider1();
      const h2 = event.collider2();
      const recA = byCollider.get(h1) || null;
      const recB = byCollider.get(h2) || null;

      // Pick the tighter of the two thresholds so a light thing hitting a
      // heavy thing still counts.
      let threshold = tuning.impactForceFloor;
      if (recA && recA.impactThreshold) threshold = recA.impactThreshold;
      if (recB && recB.impactThreshold) threshold = Math.min(threshold || Infinity, recB.impactThreshold);
      if (force < threshold) return;

      const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
      const last = impactClock.get(key);
      if (last !== undefined && simTime - last < tuning.impactCooldown) return;
      impactClock.set(key, simTime);

      const colliderA = world.getCollider(h1);
      const colliderB = world.getCollider(h2);
      if (!colliderA || !colliderB) return;
      contactPointFor(colliderA, colliderB, impactPoint);

      const dir = event.maxForceDirection();
      const massA = recA && recA.mass ? recA.mass : 0;
      const massB = recB && recB.mass ? recB.mass : 0;
      // Effective mass of the pair; a static partner has infinite mass.
      let effMass;
      if (massA > 0 && massB > 0) effMass = (massA * massB) / (massA + massB);
      else effMass = massA > 0 ? massA : (massB > 0 ? massB : 1);
      const speed = (force * step) / Math.max(effMass, 1e-3);

      impactsThisStep += 1;
      impactsTotal += 1;
      events.emit("impact", {
        position: { x: impactPoint.x, y: impactPoint.y, z: impactPoint.z },
        normal: dir ? { x: dir.x, y: dir.y, z: dir.z } : { x: 0, y: 1, z: 0 },
        speed,
        force,
        material: (recA && recA.material) || (recB && recB.material) || null,
        materials: [recA ? recA.material : null, recB ? recB.material : null],
        a: recA,
        b: recB,
        kind: (recA && recA.kind) || (recB && recB.kind) || null,
      });
    });

    // Keep the cooldown map from growing forever.
    if ((stepIndex & 255) === 0 && impactClock.size > 512) {
      for (const [key, when] of impactClock) {
        if (simTime - when > 2) impactClock.delete(key);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sleep sweep                                                       */
  /* ---------------------------------------------------------------- */

  function sleepSweep() {
    const linear2 = tuning.sleepLinear * tuning.sleepLinear;
    const angular2 = tuning.sleepAngular * tuning.sleepAngular;
    world.forEachActiveRigidBody((body) => {
      const record = byBody.get(body.handle);
      if (!record || !record.dynamic) return;
      const v = body.linvel();
      const w = body.angvel();
      const speed2 = v.x * v.x + v.y * v.y + v.z * v.z;
      const spin2 = w.x * w.x + w.y * w.y + w.z * w.z;
      if (speed2 < linear2 && spin2 < angular2) {
        record.quiet += 1;
        if (record.quiet >= tuning.sleepScans) {
          body.sleep();
          record.quiet = 0;
        }
      } else {
        record.quiet = 0;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Transform capture + interpolation                                 */
  /* ---------------------------------------------------------------- */

  function captureTransforms() {
    world.forEachActiveRigidBody((body) => {
      const record = byBody.get(body.handle);
      if (!record || !record.alive) return;
      const t = body.translation();
      const r = body.rotation();
      record.p0.x = record.p1.x; record.p0.y = record.p1.y; record.p0.z = record.p1.z;
      record.q0.x = record.q1.x; record.q0.y = record.q1.y; record.q0.z = record.q1.z; record.q0.w = record.q1.w;
      record.p1.x = t.x; record.p1.y = t.y; record.p1.z = t.z;
      record.q1.x = r.x; record.q1.y = r.y; record.q1.z = r.z; record.q1.w = r.w;
      record.stamp = stepIndex;
    });
  }

  const lerpPos = vec3();
  const lerpRot = { x: 0, y: 0, z: 0, w: 1 };

  /**
   * Push interpolated transforms into meshes. `alpha` is
   * ctx.time.alpha - how far the renderer is between fixed steps.
   */
  function syncMeshes(alpha = 0) {
    const a = clamp(alpha, 0, 1);
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!rec.alive || (!rec.mesh && !rec.onSync)) continue;
      if (rec.stamp !== stepIndex || a <= 0) {
        writeTransform(rec, rec.p1, rec.q1);
        continue;
      }
      lerpPos.x = rec.p0.x + (rec.p1.x - rec.p0.x) * a;
      lerpPos.y = rec.p0.y + (rec.p1.y - rec.p0.y) * a;
      lerpPos.z = rec.p0.z + (rec.p1.z - rec.p0.z) * a;

      // nlerp with a hemisphere fix - plenty for render smoothing.
      const q0 = rec.q0;
      const q1 = rec.q1;
      const sign = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w < 0 ? -1 : 1;
      let qx = q0.x + (q1.x * sign - q0.x) * a;
      let qy = q0.y + (q1.y * sign - q0.y) * a;
      let qz = q0.z + (q1.z * sign - q0.z) * a;
      let qw = q0.w + (q1.w * sign - q0.w) * a;
      const inv = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
      lerpRot.x = qx * inv; lerpRot.y = qy * inv; lerpRot.z = qz * inv; lerpRot.w = qw * inv;
      writeTransform(rec, lerpPos, lerpRot);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  function fixedUpdate(step = FIXED_STEP) {
    if (disposed) return;
    const t0 = performance.now();

    if (world.timestep !== step) world.timestep = step;

    applyRopeForces(step);
    applyConeLimits();

    world.step(eventQueue);
    stepIndex += 1;
    simTime += step;

    captureTransforms();
    drainEvents(step);

    if (stepIndex % tuning.sleepInterval === 0) sleepSweep();

    stepMs = performance.now() - t0;
    stepMsSum += stepMs;
    stepMsCount += 1;
    if (stepMs > stepMsPeak) stepMsPeak = stepMs;
  }

  function lateUpdate(dt, context) {
    if (disposed) return;
    const alpha = context && context.time ? context.time.alpha : (ctx.time ? ctx.time.alpha : 0);
    syncMeshes(alpha || 0);
  }

  function report() {
    let awake = 0;
    let dynamic = 0;
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!rec.dynamic) continue;
      dynamic += 1;
      if (!rec.body.isSleeping()) awake += 1;
    }
    return {
      bodies: world.bodies.len(),
      colliders: world.colliders.len(),
      joints: world.impulseJoints.len(),
      tracked: records.length,
      dynamic,
      awake,
      sleeping: dynamic - awake,
      stepMs: Number(stepMs.toFixed(3)),
      stepMsAvg: Number((stepMsCount ? stepMsSum / stepMsCount : 0).toFixed(3)),
      stepMsPeak: Number(stepMsPeak.toFixed(3)),
      steps: stepIndex,
      solverIterations: world.numSolverIterations,
      ccdSubsteps: world.maxCcdSubsteps,
      characters: characters.length,
      ragdolls: ragdolls.length,
      ropes: ropes.length,
      sensors: sensors.length,
      impacts: impactsTotal,
      fallbackGround: Boolean(fallbackGround),
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const character of characters.slice()) character.dispose();
    for (const ragdoll of ragdolls.slice()) ragdoll.dispose();
    ropes.length = 0;
    records.length = 0;
    byCollider.clear();
    byBody.clear();
    impactClock.clear();
    try { eventQueue.free(); } catch (error) { /* already gone */ }
    world.free();
  }

  /* ---------------------------------------------------------------- */

  const api = {
    /* --- raw handles for anyone who needs to go deeper --- */
    world,
    RAPIER,
    eventQueue,

    /* --- interaction layers --- */
    LAYER,
    LAYER_FILTER,
    interactionGroups,
    groupsFor(membership, filter) {
      return interactionGroups(
        membership,
        filter === undefined ? (LAYER_FILTER[membership] === undefined ? LAYER.ALL : LAYER_FILTER[membership]) : filter
      );
    },

    /* --- tuning --- */
    tuning,
    setGravity(y) {
      world.gravity = { x: 0, y, z: 0 };
      for (const rec of records) if (rec.dynamic) rec.body.wakeUp();
    },
    getGravity() { return world.gravity; },
    setSolverIterations(count) { world.numSolverIterations = Math.max(1, count | 0); },

    /* --- construction --- */
    addStatic,
    addDynamic,
    addTrimesh,
    addHeightfield,
    addSensor,
    remove(handle) { removeRecord(handle); },
    removeFallbackGround,
    hasFallbackGround() { return Boolean(fallbackGround); },

    /* --- services --- */
    createCharacter,
    createRagdoll,
    attachRope,
    detachRope,

    /* --- queries --- */
    raycast,
    bodiesInRadius,
    explode,
    recordForCollider(collider) {
      if (!collider) return null;
      const h = typeof collider === "number" ? collider : collider.handle;
      return byCollider.get(h) || null;
    },
    recordForBody(body) {
      if (!body) return null;
      const h = typeof body === "number" ? body : body.handle;
      return byBody.get(h) || null;
    },
    get records() { return records; },

    /* --- lifecycle --- */
    fixedUpdate,
    lateUpdate,
    syncMeshes,
    report,
    dispose,

    /** Debug line buffers for a wireframe overlay (vfx.js may use these). */
    debugBuffers() {
      const buffers = world.debugRender();
      return { vertices: buffers.vertices, colors: buffers.colors };
    },
  };

  if (typeof ctx.track === "function") ctx.track(api);
  return api;
}
