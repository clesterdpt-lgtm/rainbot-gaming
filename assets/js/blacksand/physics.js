/* ============================================================
   BLACKSAND - physics

   A purpose-built collision world rather than a general rigid-body
   engine. A shooter needs three things to be exact - capsule-vs-world
   character movement, fast ray queries for bullets, and cheap
   sphere/box overlap for explosions - and needs them at 120Hz for a
   hundred entities. A general solver spends its budget on constraint
   islands nobody in this game ever forms.

   Broadphase is a uniform grid over the map. With colliders that are
   static and roughly evenly spread, a grid beats a BVH on both build
   time and query time, and it can be rebuilt in a millisecond when
   something is destroyed.
   ============================================================ */

import { clamp, clamp01 } from "./core.js";

/** Collision layers. Bitmask, so a query can say "solids and vehicles
 *  but not players" without a callback. */
export const LAYER = {
  TERRAIN: 1 << 0,
  STATIC: 1 << 1,
  DYNAMIC: 1 << 2,
  PLAYER: 1 << 3,
  VEHICLE: 1 << 4,
  FOLIAGE: 1 << 5,
  WATER: 1 << 6,
  ALL: 0xffff,
};

/** Surface types drive impact VFX, audio and penetration. */
export const SURFACE = {
  SAND: "sand",
  DIRT: "dirt",
  ROCK: "rock",
  CONCRETE: "concrete",
  METAL: "metal",
  WOOD: "wood",
  GLASS: "glass",
  FLESH: "flesh",
  WATER: "water",
  FOLIAGE: "foliage",
};

const GRID_CELL = 24;   // metres

export async function createPhysics(ctx) {
  const { THREE, terrain } = ctx;

  /* ---------------------------- colliders ---------------------------- */

  /**
   * Every static collider is an oriented box. Cylinders and capsules
   * for props are approximated by boxes because the error is under a
   * few centimetres at the scale things are placed, and a uniform
   * primitive keeps the sweep code to one function instead of nine.
   */
  const colliders = [];
  let nextId = 1;

  const grid = new Map();
  const gridKey = (ix, iz) => ix * 4096 + iz;

  function addBox(options) {
    const collider = {
      id: nextId++,
      type: "box",
      center: new THREE.Vector3().copy(options.center),
      halfExtents: new THREE.Vector3().copy(options.halfExtents),
      quaternion: options.quaternion
        ? options.quaternion.clone()
        : new THREE.Quaternion(),
      layer: options.layer ?? LAYER.STATIC,
      surface: options.surface ?? SURFACE.CONCRETE,
      /** Bullets pass through, players do not. Windows, chain link. */
      penetrable: options.penetrable ?? 0,
      /** Blocks sight for AI. */
      opaque: options.opaque ?? true,
      destructible: options.destructible ?? false,
      health: options.health ?? Infinity,
      userData: options.userData || null,
      active: true,
    };
    // Cache the inverse rotation - every sweep and ray needs it.
    collider.invQuaternion = collider.quaternion.clone().invert();
    // World-space AABB for the broadphase, computed from the OBB.
    updateBounds(collider);
    colliders.push(collider);
    insertIntoGrid(collider);
    return collider;
  }

  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _m = new THREE.Matrix3();

  function updateBounds(collider) {
    // The AABB of a rotated box: project the half-extents onto each
    // world axis through the absolute rotation matrix.
    _m.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(collider.quaternion));
    const e = collider.halfExtents;
    const m = _m.elements;
    const ex = Math.abs(m[0]) * e.x + Math.abs(m[3]) * e.y + Math.abs(m[6]) * e.z;
    const ey = Math.abs(m[1]) * e.x + Math.abs(m[4]) * e.y + Math.abs(m[7]) * e.z;
    const ez = Math.abs(m[2]) * e.x + Math.abs(m[5]) * e.y + Math.abs(m[8]) * e.z;
    collider.min = new THREE.Vector3(
      collider.center.x - ex, collider.center.y - ey, collider.center.z - ez
    );
    collider.max = new THREE.Vector3(
      collider.center.x + ex, collider.center.y + ey, collider.center.z + ez
    );
  }

  function insertIntoGrid(collider) {
    const i0 = Math.floor(collider.min.x / GRID_CELL);
    const i1 = Math.floor(collider.max.x / GRID_CELL);
    const j0 = Math.floor(collider.min.z / GRID_CELL);
    const j1 = Math.floor(collider.max.z / GRID_CELL);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const key = gridKey(i, j);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(collider);
      }
    }
  }

  function rebuildGrid() {
    grid.clear();
    for (const collider of colliders) {
      if (collider.active) insertIntoGrid(collider);
    }
  }

  /** Everything whose AABB overlaps the query box. */
  const _query = [];
  function queryBox(min, max, layerMask = LAYER.ALL) {
    _query.length = 0;
    const seen = new Set();
    const i0 = Math.floor(min.x / GRID_CELL);
    const i1 = Math.floor(max.x / GRID_CELL);
    const j0 = Math.floor(min.z / GRID_CELL);
    const j1 = Math.floor(max.z / GRID_CELL);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const bucket = grid.get(gridKey(i, j));
        if (!bucket) continue;
        for (const collider of bucket) {
          if (!collider.active) continue;
          if ((collider.layer & layerMask) === 0) continue;
          if (seen.has(collider.id)) continue;
          if (collider.max.x < min.x || collider.min.x > max.x) continue;
          if (collider.max.y < min.y || collider.min.y > max.y) continue;
          if (collider.max.z < min.z || collider.min.z > max.z) continue;
          seen.add(collider.id);
          _query.push(collider);
        }
      }
    }
    return _query;
  }

  /* ------------------------- closest point ------------------------- */

  /**
   * Closest point on an OBB to a world-space point.
   *
   * Uses its OWN scratch vector, not the shared `_v`.
   *
   * It used `_v`, and every caller passes `_v` as `point` - so the
   * first line transformed the caller's world-space sample into the
   * box's local space behind its back, and the caller then computed a
   * push direction from local-space coordinates it believed were world
   * space. The result was a depenetration vector pointing essentially
   * anywhere, and the practical symptom was that a sprinting player
   * walked straight through a solid wall: measured at 21 metres past a
   * collider whose face a raycast could see perfectly well 2.15m ahead.
   * Aliasing between a shared temporary and an argument is invisible at
   * the call site, which is what makes it worth this comment.
   */
  const _cpLocal = new THREE.Vector3();
  function closestPointOnBox(collider, point, out) {
    _cpLocal.copy(point).sub(collider.center).applyQuaternion(collider.invQuaternion);
    _cpLocal.x = clamp(_cpLocal.x, -collider.halfExtents.x, collider.halfExtents.x);
    _cpLocal.y = clamp(_cpLocal.y, -collider.halfExtents.y, collider.halfExtents.y);
    _cpLocal.z = clamp(_cpLocal.z, -collider.halfExtents.z, collider.halfExtents.z);
    return out.copy(_cpLocal).applyQuaternion(collider.quaternion).add(collider.center);
  }

  /* ------------------------ capsule resolution ------------------------ */

  /**
   * Push a vertical capsule out of everything it overlaps.
   *
   * Iterative depenetration rather than a swept solve. Sweeping a
   * capsule against arbitrary OBBs correctly needs GJK/EPA; three
   * rounds of "find deepest overlap, push out along the normal"
   * converges on the same answer for the geometry this game builds
   * (axis-ish boxes, no thin slivers) at a fraction of the cost.
   *
   * The substep count in moveCapsule is what stops tunnelling, not
   * this - a fast player is moved in <= 0.4m increments so there is
   * never a frame where the capsule has skipped past a wall.
   */
  const _closest = new THREE.Vector3();
  const _segA = new THREE.Vector3();
  const _segB = new THREE.Vector3();
  const _push = new THREE.Vector3();

  function resolveCapsule(position, radius, height, layerMask, hitNormals) {
    // Capsule as a vertical segment between two sphere centres.
    const bottom = radius;
    const top = height - radius;
    let resolved = false;

    for (let iteration = 0; iteration < 4; iteration += 1) {
      _v2.set(position.x - radius - 0.1, position.y - 0.1, position.z - radius - 0.1);
      _v3.set(position.x + radius + 0.1, position.y + height + 0.1, position.z + radius + 0.1);
      const nearby = queryBox(_v2, _v3, layerMask);
      if (!nearby.length) break;

      let deepest = 0;
      let deepestNormal = null;
      let deepestCollider = null;

      for (const collider of nearby) {
        _segA.set(position.x, position.y + bottom, position.z);
        _segB.set(position.x, position.y + top, position.z);

        // Sample the segment at both caps and the middle. Three points
        // is enough for a 1.8m capsule against 0.5m+ boxes.
        for (const t of [0, 0.5, 1]) {
          _v.lerpVectors(_segA, _segB, t);
          closestPointOnBox(collider, _v, _closest);
          _push.copy(_v).sub(_closest);
          const distSq = _push.lengthSq();
          if (distSq >= radius * radius) continue;

          const dist = Math.sqrt(distSq);
          const depth = radius - dist;
          if (depth <= deepest) continue;

          if (dist > 1e-5) {
            _push.multiplyScalar(1 / dist);
          } else {
            // Centre exactly inside: push out along the shallowest axis
            // of the box in its own frame.
            _v.sub(collider.center).applyQuaternion(collider.invQuaternion);
            const e = collider.halfExtents;
            const dx = e.x - Math.abs(_v.x);
            const dy = e.y - Math.abs(_v.y);
            const dz = e.z - Math.abs(_v.z);
            if (dx < dy && dx < dz) _push.set(Math.sign(_v.x) || 1, 0, 0);
            else if (dy < dz) _push.set(0, Math.sign(_v.y) || 1, 0);
            else _push.set(0, 0, Math.sign(_v.z) || 1);
            _push.applyQuaternion(collider.quaternion);
          }

          deepest = depth;
          deepestNormal = _push.clone();
          deepestCollider = collider;
        }
      }

      if (!deepestNormal) break;
      // A hair of extra push stops the capsule re-entering next step
      // and producing the classic jitter against a wall.
      position.addScaledVector(deepestNormal, deepest + 0.0015);
      if (hitNormals) hitNormals.push({ normal: deepestNormal, collider: deepestCollider, depth: deepest });
      resolved = true;
    }
    return resolved;
  }

  /* --------------------------- ray casting --------------------------- */

  /** Slab test against an OBB. Returns entry distance or -1. */
  function rayBox(collider, origin, direction, maxDist) {
    // Transform the ray into the box's local frame; the test is then
    // an axis-aligned slab intersection.
    _v.copy(origin).sub(collider.center).applyQuaternion(collider.invQuaternion);
    _v2.copy(direction).applyQuaternion(collider.invQuaternion);

    let tMin = 0;
    let tMax = maxDist;
    const e = collider.halfExtents;
    const o = [_v.x, _v.y, _v.z];
    const d = [_v2.x, _v2.y, _v2.z];
    const h = [e.x, e.y, e.z];

    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(d[axis]) < 1e-8) {
        if (o[axis] < -h[axis] || o[axis] > h[axis]) return -1;
      } else {
        const inv = 1 / d[axis];
        let t1 = (-h[axis] - o[axis]) * inv;
        let t2 = (h[axis] - o[axis]) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return -1;
      }
    }
    return tMin;
  }

  /** Local-space face normal at a hit point on an OBB. */
  function boxNormalAt(collider, point, out) {
    _v.copy(point).sub(collider.center).applyQuaternion(collider.invQuaternion);
    const e = collider.halfExtents;
    const dx = e.x - Math.abs(_v.x);
    const dy = e.y - Math.abs(_v.y);
    const dz = e.z - Math.abs(_v.z);
    if (dx < dy && dx < dz) out.set(Math.sign(_v.x), 0, 0);
    else if (dy < dz) out.set(0, Math.sign(_v.y), 0);
    else out.set(0, 0, Math.sign(_v.z));
    return out.applyQuaternion(collider.quaternion).normalize();
  }

  const _rayOrigin = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  const _hitPoint = new THREE.Vector3();
  const _hitNormal = new THREE.Vector3();

  /**
   * Cast against terrain and colliders.
   *
   * Terrain is marched rather than intersected analytically: a
   * heightfield has no closed form, and a fixed-step march with a
   * bisection refinement lands within a centimetre in about 40
   * iterations for a 400m shot.
   */
  function raycast(origin, direction, maxDist = 500, options = {}) {
    const layerMask = options.layer ?? (LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE);
    const ignore = options.ignore || null;

    _rayOrigin.copy(origin);
    _rayDir.copy(direction).normalize();

    let best = null;

    /* ---- colliders ---- */
    if (layerMask & ~LAYER.TERRAIN) {
      // Walk the broadphase grid along the ray instead of testing the
      // whole map. A 400m shot touches ~17 cells out of 1800.
      const steps = Math.ceil(maxDist / GRID_CELL) + 1;
      const seen = new Set();
      for (let s = 0; s <= steps; s += 1) {
        const t = Math.min(maxDist, s * GRID_CELL);
        const px = _rayOrigin.x + _rayDir.x * t;
        const pz = _rayOrigin.z + _rayDir.z * t;
        const ci = Math.floor(px / GRID_CELL);
        const cj = Math.floor(pz / GRID_CELL);
        // Include the 8 neighbours: a collider straddling a boundary
        // is only registered in the cells its AABB touches, and the
        // ray can clip a corner without entering the cell centre.
        for (let di = -1; di <= 1; di += 1) {
          for (let dj = -1; dj <= 1; dj += 1) {
            const bucket = grid.get(gridKey(ci + di, cj + dj));
            if (!bucket) continue;
            for (const collider of bucket) {
              if (!collider.active) continue;
              if ((collider.layer & layerMask) === 0) continue;
              if (ignore && ignore(collider)) continue;
              if (seen.has(collider.id)) continue;
              seen.add(collider.id);

              const hit = rayBox(collider, _rayOrigin, _rayDir, best ? best.distance : maxDist);
              if (hit < 0) continue;
              if (best && hit >= best.distance) continue;
              best = { distance: hit, collider };
            }
          }
        }
        if (t >= maxDist) break;
      }
    }

    /* ---- terrain ---- */
    if (layerMask & LAYER.TERRAIN) {
      const limit = best ? Math.min(best.distance, maxDist) : maxDist;
      // Adaptive step: coarse far away, fine near. A uniform 0.5m step
      // over 500m is 1000 height lookups per bullet.
      let t = 0;
      let prevT = 0;
      let prevAbove = _rayOrigin.y - terrain.heightAt(_rayOrigin.x, _rayOrigin.z);
      let found = -1;
      while (t < limit) {
        const step = clamp(t * 0.06 + 0.6, 0.6, 12);
        t = Math.min(t + step, limit);
        const px = _rayOrigin.x + _rayDir.x * t;
        const py = _rayOrigin.y + _rayDir.y * t;
        const pz = _rayOrigin.z + _rayDir.z * t;
        const above = py - terrain.heightAt(px, pz);
        if (above <= 0 && prevAbove > 0) {
          // Bisect between the last two samples.
          let lo = prevT;
          let hi = t;
          for (let i = 0; i < 14; i += 1) {
            const mid = (lo + hi) * 0.5;
            const mx = _rayOrigin.x + _rayDir.x * mid;
            const my = _rayOrigin.y + _rayDir.y * mid;
            const mz = _rayOrigin.z + _rayDir.z * mid;
            if (my - terrain.heightAt(mx, mz) > 0) lo = mid; else hi = mid;
          }
          found = (lo + hi) * 0.5;
          break;
        }
        prevAbove = above;
        prevT = t;
      }
      if (found >= 0 && (!best || found < best.distance)) {
        _hitPoint.copy(_rayOrigin).addScaledVector(_rayDir, found);
        terrain.normalAt(_hitPoint.x, _hitPoint.z, _hitNormal);
        const slope = 1 - _hitNormal.y;
        return {
          hit: true,
          distance: found,
          point: _hitPoint.clone(),
          normal: _hitNormal.clone(),
          collider: null,
          terrain: true,
          surface: slope > 0.4 ? SURFACE.ROCK : SURFACE.SAND,
        };
      }
    }

    if (!best) return { hit: false, distance: maxDist, point: null, normal: null, collider: null };

    _hitPoint.copy(_rayOrigin).addScaledVector(_rayDir, best.distance);
    boxNormalAt(best.collider, _hitPoint, _hitNormal);
    return {
      hit: true,
      distance: best.distance,
      point: _hitPoint.clone(),
      normal: _hitNormal.clone(),
      collider: best.collider,
      terrain: false,
      surface: best.collider.surface,
    };
  }

  /** Unobstructed line of sight between two points. Used by AI. */
  function lineOfSight(from, to, layerMask = LAYER.TERRAIN | LAYER.STATIC) {
    _v.copy(to).sub(from);
    const distance = _v.length();
    if (distance < 1e-4) return true;
    _v.multiplyScalar(1 / distance);
    const hit = raycast(from, _v, distance - 0.05, {
      layer: layerMask,
      ignore: (c) => !c.opaque,
    });
    return !hit.hit;
  }

  /* --------------------------- movement --------------------------- */

  /**
   * Move a capsule with collide-and-slide.
   *
   * Substeps are capped by distance, not by count: 0.35m per substep
   * means a 90m/s helicopter and a 4m/s soldier both get the same
   * collision fidelity, and neither can pass through a wall.
   */
  const _target = new THREE.Vector3();
  const _delta = new THREE.Vector3();

  function moveCapsule(position, velocity, radius, height, dt, options = {}) {
    const layerMask = options.layer ?? (LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE);
    const stepHeight = options.stepHeight ?? 0.42;
    const slopeLimit = options.slopeLimit ?? 0.62;   // cos of max walkable angle

    _delta.copy(velocity).multiplyScalar(dt);
    const distance = _delta.length();
    const substeps = clamp(Math.ceil(distance / 0.35), 1, 12);
    _delta.multiplyScalar(1 / substeps);

    const result = {
      grounded: false,
      groundNormal: new THREE.Vector3(0, 1, 0),
      hitWall: false,
      wallNormal: new THREE.Vector3(),
      steppedUp: 0,
      surface: SURFACE.SAND,
      collider: null,
    };

    const hits = [];

    for (let s = 0; s < substeps; s += 1) {
      position.add(_delta);

      hits.length = 0;
      resolveCapsule(position, radius, height, layerMask, hits);

      for (const hit of hits) {
        if (hit.normal.y > slopeLimit) {
          result.grounded = true;
          result.groundNormal.copy(hit.normal);
          result.surface = hit.collider.surface;
          result.collider = hit.collider;
          // Cancel downward velocity so the capsule does not accumulate
          // gravity while standing.
          if (velocity.y < 0) velocity.y = 0;
        } else {
          result.hitWall = true;
          result.wallNormal.copy(hit.normal);
          // Slide: remove the component of velocity into the wall.
          const into = velocity.dot(hit.normal);
          if (into < 0) velocity.addScaledVector(hit.normal, -into);
        }
      }

      /* ---- terrain ---- */
      const groundY = terrain.heightAt(position.x, position.z);
      if (position.y < groundY) {
        position.y = groundY;
        if (velocity.y < 0) velocity.y = 0;
        result.grounded = true;
        terrain.normalAt(position.x, position.z, result.groundNormal);
        const slope = 1 - result.groundNormal.y;
        result.surface = slope > 0.4 ? SURFACE.ROCK : SURFACE.SAND;
      } else if (position.y - groundY < 0.06 && velocity.y <= 0.01) {
        // Standing on terrain within a snap threshold: treat as
        // grounded so walking down a shallow slope does not produce a
        // stutter of airborne frames.
        position.y = groundY;
        result.grounded = true;
        terrain.normalAt(position.x, position.z, result.groundNormal);
      }
    }

    /* ---- step up ----
       Only after the whole move, and only when the capsule is blocked
       horizontally but has clear space at step height. Doing this per
       substep lets a player "climb" a wall by ramming it. */
    if (result.hitWall && result.grounded && stepHeight > 0) {
      _target.copy(position);
      _target.y += stepHeight;
      const clear = [];
      resolveCapsule(_target, radius, height, layerMask, clear);
      if (!clear.length) {
        // Space above is free - but only take the step if the ground
        // under the raised capsule is actually there.
        const groundY = terrain.heightAt(_target.x, _target.z);
        if (_target.y - groundY < stepHeight + 0.1) {
          position.copy(_target);
          result.steppedUp = stepHeight;
          result.hitWall = false;
        }
      }
    }

    return result;
  }

  /* ------------------------- capsule queries ------------------------- */

  const _probe = new THREE.Vector3();
  const _mpDir = new THREE.Vector3();
  const _mpFrom = new THREE.Vector3();
  const _mpTo = new THREE.Vector3();
  const _mpDown = new THREE.Vector3(0, -1, 0);
  const _probeHits = [];

  /**
   * Is a capsule at this position free of geometry?
   *
   * Non-mutating, unlike resolveCapsule - it copies the position first.
   * Movement code needs to ASK before it commits ("could I stand up
   * here?", "is there room on that ledge?"), and calling the resolver
   * to find out silently teleports whatever vector you passed in.
   */
  function capsuleFree(position, radius, height, layerMask = LAYER.STATIC | LAYER.DYNAMIC) {
    _probe.copy(position);
    _probeHits.length = 0;
    resolveCapsule(_probe, radius, height, layerMask, _probeHits);
    if (_probeHits.length) return false;
    // Terrain is not a collider, so the resolver never sees it.
    return _probe.y >= terrain.heightAt(_probe.x, _probe.z) - 0.02;
  }

  /**
   * Find a mantle target ahead of a capsule.
   *
   * Cast forward at chest height to find the obstacle face, then walk a
   * downward probe back from above the far side to find the top surface,
   * then verify the player actually fits standing there. Returning a
   * landing point rather than a boolean lets the player controller
   * animate towards a real position instead of teleporting.
   *
   * Rejecting on "the top is not reachable" is the important part. A
   * mantle check that only tests the near face happily lifts a player
   * onto the outside of a wall they should not be able to climb.
   */
  function mantleProbe(position, forward, options = {}) {
    const radius = options.radius ?? 0.34;
    const height = options.height ?? 1.8;
    const maxHeight = options.maxHeight ?? 1.35;
    const minHeight = options.minHeight ?? 0.45;
    const reach = options.reach ?? 0.95;
    const layerMask = options.layer ?? (LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE);

    // Private vectors, not the shared `_v`/`_v2`/`_v3`. This function
    // calls raycast(), and raycast() calls rayBox(), which uses those
    // same shared temporaries - so a direction parked in `_v` is
    // garbage by the time the second cast reads it. Same class of bug
    // as closestPointOnBox above, and it made every mantle probe
    // return null while the raycasts it was built on worked fine.
    const dir = _mpDir.copy(forward).setY(0);
    if (dir.lengthSq() < 1e-6) return null;
    dir.normalize();

    // 1. Is there a face in front of us?
    //
    // Probed at several heights, lowest first, not once at chest
    // height. A single ray at 0.95m sails straight over a 0.9m wall -
    // exactly the waist-high cover a player most wants to vault - and
    // the failure is invisible because taller obstacles still work.
    // Lowest-first matters too: against a stack it should find the
    // bottom step, not the top of the stack.
    let face = null;
    for (const probeHeight of [0.35, 0.6, 0.9, 1.2, 1.5]) {
      if (probeHeight > maxHeight + 0.25) break;
      _mpFrom.set(position.x, position.y + probeHeight, position.z);
      const hit = raycast(_mpFrom, dir, reach + radius, { layer: layerMask });
      // A near-vertical face only. Walking up a ramp is the movement
      // code's job, not the mantle's.
      if (hit.hit && Math.abs(hit.normal.y) <= 0.4) { face = hit; break; }
    }
    if (!face) return null;

    // 2. Probe down onto the far side to find the ledge.
    const beyond = face.point.clone().addScaledVector(dir, radius + 0.18);
    const from = _mpTo.set(beyond.x, position.y + maxHeight + height * 0.5, beyond.z);
    const top = raycast(from, _mpDown, maxHeight + height * 0.5 + 0.4, { layer: layerMask });

    let ledgeY;
    if (top.hit) {
      ledgeY = top.point.y;
      // Only mantle onto something you could stand on.
      if (top.normal.y < 0.62) return null;
    } else {
      const groundY = terrain.heightAt(beyond.x, beyond.z);
      if (groundY <= position.y + minHeight) return null;
      ledgeY = groundY;
    }

    const rise = ledgeY - position.y;
    if (rise < minHeight || rise > maxHeight) return null;

    // 3. Will the player actually fit up there?
    const landing = new THREE.Vector3(beyond.x, ledgeY + 0.03, beyond.z);
    if (!capsuleFree(landing, radius, height, layerMask)) {
      // Try a little further in - the first probe may have landed on
      // the lip of a parapet.
      landing.addScaledVector(dir, radius * 1.6);
      landing.y = ledgeY + 0.03;
      if (!capsuleFree(landing, radius, height, layerMask)) return null;
    }

    return { position: landing, rise, surface: face.surface, normal: face.normal.clone() };
  }

  /* ---------------------------- overlaps ---------------------------- */

  /** Everything a sphere touches. Explosions and triggers. */
  function overlapSphere(center, radius, layerMask = LAYER.ALL) {
    _v2.set(center.x - radius, center.y - radius, center.z - radius);
    _v3.set(center.x + radius, center.y + radius, center.z + radius);
    const candidates = queryBox(_v2, _v3, layerMask);
    const out = [];
    for (const collider of candidates) {
      closestPointOnBox(collider, center, _closest);
      if (_closest.distanceToSquared(center) <= radius * radius) out.push(collider);
    }
    return out;
  }

  /* ------------------------------ api ------------------------------ */

  let raycastCount = 0;

  const api = {
    LAYER,
    SURFACE,
    colliders,

    addBox,
    removeCollider(collider) {
      collider.active = false;
      rebuildGrid();
    },
    rebuildGrid,

    raycast(origin, direction, maxDist, options) {
      raycastCount += 1;
      return raycast(origin, direction, maxDist, options);
    },
    lineOfSight,
    moveCapsule,
    resolveCapsule,
    capsuleFree,
    mantleProbe,
    overlapSphere,

    /**
     * Trace a bullet through penetrable geometry.
     *
     * Walks the ray forward, and at each hit either stops (solid) or
     * continues from just past the exit point with reduced energy. The
     * `penetrable` field on a collider is the fraction of energy that
     * survives per metre of material - 0 stops everything, which is
     * what an unspecified collider defaults to.
     *
     * Returns the list of surfaces passed through plus the final hit,
     * so the caller can spawn an entry AND an exit effect. Firing
     * through a plywood door and having the impact appear only on the
     * near side is the tell that a shooter has no penetration model.
     */
    penetrate(origin, direction, maxDist = 500, options = {}) {
      const maxPasses = options.maxPasses ?? 4;
      const layerMask = options.layer
        ?? (LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE);
      let energy = options.energy ?? 1;
      let travelled = 0;
      const path = [];
      const start = origin.clone();

      for (let pass = 0; pass < maxPasses && travelled < maxDist && energy > 0.05; pass += 1) {
        raycastCount += 1;
        const hit = raycast(start, direction, maxDist - travelled, { layer: layerMask });
        if (!hit.hit) {
          return { hits: path, final: null, energy, distance: maxDist };
        }

        travelled += hit.distance;
        const survives = hit.collider ? hit.collider.penetrable : 0;
        path.push({ ...hit, distance: travelled, energy, exit: null });

        if (survives <= 0) {
          return { hits: path, final: path[path.length - 1], energy, distance: travelled };
        }

        // Find the far face by casting BACK from beyond the collider.
        // Casting forward from inside would immediately re-hit the same
        // near face and the bullet would never leave.
        const thicknessProbe = 3.0;
        const beyond = hit.point.clone().addScaledVector(direction, thicknessProbe);
        const back = raycast(beyond, direction.clone().negate(), thicknessProbe, {
          layer: layerMask,
          ignore: (c) => c !== hit.collider,
        });
        const exitPoint = back.hit
          ? back.point
          : hit.point.clone().addScaledVector(direction, 0.12);
        const thickness = Math.max(0.02, exitPoint.distanceTo(hit.point));

        path[path.length - 1].exit = { point: exitPoint, thickness };
        energy *= Math.pow(survives, thickness);
        travelled += thickness;

        start.copy(exitPoint).addScaledVector(direction, 0.02);
      }

      return { hits: path, final: path[path.length - 1] || null, energy, distance: travelled };
    },

    queryBox,
    closestPointOnBox,

    /** Ground height including static geometry - what a spawn point
     *  needs so a soldier does not appear inside a roof. */
    groundHeightAt(x, z, from = 200) {
      const hit = raycast(
        new THREE.Vector3(x, from, z),
        new THREE.Vector3(0, -1, 0),
        from + 100,
        { layer: LAYER.TERRAIN | LAYER.STATIC }
      );
      return hit.hit ? hit.point.y : terrain.heightAt(x, z);
    },

    report() {
      const stats = { colliders: colliders.filter((c) => c.active).length, cells: grid.size, raycasts: raycastCount };
      raycastCount = 0;
      return stats;
    },
  };

  return api;
}
