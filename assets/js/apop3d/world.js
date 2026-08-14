/* ============================================================
   APOP DEMON MOGGERS 3D - world

   Turns a course definition from levels.js into a live scene.

   levels.js authors geometry declaratively: a course's build() calls
   out.add() a few hundred times and never touches three. Everything
   that decides frame cost happens here instead.

   THE THREE THINGS THIS FILE EXISTS TO DO

   1. BATCH. A course is 200-400 authored pieces. Submitted naively
      that is 400 draw calls against a budget of 300 for the entire
      frame. Statics are baked into world space and merged into ONE
      mesh per surface; repeated props go through out.inst() into an
      InstancedMesh instead, one draw per prop type regardless of
      count. Course 1 lands at about 120 draws with several hundred
      authored pieces and thirteen instanced prop types.

   2. LEAVE THE LIGHTS ALONE. Adding a light to a scene recompiles
      every material in it - a recorded multi-hundred-millisecond
      freeze in this repo. sky.js allocates its light set once at
      construction and only ever re-points and re-dims it, so the
      accents and beams a course authors are handed to sky.setCourse
      rather than instantiated here.

   3. DRIVE THE MOVERS. levels.js returns descriptors, not meshes, for
      anything that moves. They are instantiated here and stepped in
      update(). Physics reads a rider's platform delta straight off the
      platform mesh's matrix (old inverse x new matrix), so all this
      has to do is move the mesh and keep its matrix current - and do
      it in update(), BEFORE physics integrates, or every rider slides
      off by exactly one frame of platform motion.
   ============================================================ */

import * as THREE from "three";
import { makeRng, TAU, clamp01, lerp, smoothstep } from "apop3d/core.js";

/* A course's `theme` is not its surface namespace. levels.js caches
   surfaces under names like `foodcourt.tile`, while the course that
   uses them is themed "mall". unload() needs the namespace to release
   them, so the mapping lives here rather than being guessed. */
const SURFACE_NAMESPACE = {
  hub: "lobby",
  mall: "foodcourt",
  redcarpet: "redcarpet",
  basement: "basement",
  rooftop: "roof",
  hell: "hell",
};

export function create(ctx) {
  const root = new THREE.Group();
  root.name = "course";
  ctx.scene.add(root);

  /** Everything belonging to the course currently loaded. */
  let cur = null;

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();

  /* ---------------------------------------------------------------
     Geometry helpers
     --------------------------------------------------------------- */

  /** Bake a transform into a copy of a geometry so it can be merged. */
  function bake(geo, pos, rot, scale) {
    const g = geo.clone();
    _v.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
    _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    _q.setFromEuler(_e);
    if (scale === undefined) _s.set(1, 1, 1);
    else if (typeof scale === "number") _s.set(scale, scale, scale);
    else _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_v, _q, _s);
    g.applyMatrix4(_m);
    return g;
  }

  /**
   * Merge geometries that share an attribute layout.
   *
   * three's own mergeGeometries refuses the whole batch if one member
   * is missing an attribute the others have. A course build is
   * hand-authored across thousands of lines, so one primitive without
   * a uv set should cost that primitive, not the course. Anything
   * non-conforming is normalised here rather than dropped.
   */
  function mergeAll(list) {
    if (!list.length) return null;
    let total = 0;
    for (const g of list) {
      const pos = g.attributes.position;
      if (!pos) continue;
      const n = pos.count;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.attributes.color) {
        const c = new Float32Array(n * 3);
        c.fill(1);
        g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      }
      if (!g.index) {
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i += 1) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      total += n;
    }
    if (!total) return null;

    let indexCount = 0;
    for (const g of list) if (g.index) indexCount += g.index.count;

    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const color = new Float32Array(total * 3);
    const index = new Uint32Array(indexCount);

    let vo = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position;
      if (!p) continue;
      position.set(p.array.subarray(0, p.count * 3), vo * 3);
      normal.set(g.attributes.normal.array.subarray(0, p.count * 3), vo * 3);
      uv.set(g.attributes.uv.array.subarray(0, p.count * 2), vo * 2);
      color.set(g.attributes.color.array.subarray(0, p.count * 3), vo * 3);
      const gi = g.index;
      for (let i = 0; i < gi.count; i += 1) index[io + i] = gi.array[i] + vo;
      io += gi.count;
      vo += p.count;
      g.dispose();
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.setAttribute("color", new THREE.BufferAttribute(color, 3));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  /* ---------------------------------------------------------------
     The builder handed to a course's build()
     --------------------------------------------------------------- */

  function makeBuilder(def, rng, levels) {
    const statics = new Map();     // surface -> [geometry]
    const collide = new Map();     // surface -> [geometry]  (collision only)
    const insts = new Map();       // key -> { geo, surface, xforms[] }
    const movers = [];
    const lights = [];
    const beams = [];
    const markers = new Map();
    const spawns = [];
    const records = [];
    const clout = [];
    const deals = [];
    const switches = [];
    const enemies = [];
    const bosses = [];
    const portals = [];
    const shade = [];   // ground footprints for non-colliding decor
    let bounds = null;

    const prim = levels.primitives;

    function push(map, surface, geo) {
      let arr = map.get(surface);
      if (!arr) { arr = []; map.set(surface, arr); }
      arr.push(geo);
    }

    const out = {
      prim,
      rng,
      levels,

      bounds(min, max) { bounds = { min: min.slice(), max: max.slice() }; },

      /**
       * The workhorse. Bakes the transform, projects UVs at the
       * surface's own physical scale, paints vertex colour, and queues
       * the result for merging into its surface bucket.
       */
      add(geo, surface, opts = {}) {
        if (!geo) return;
        const g = bake(geo, opts.pos, opts.rot, opts.scale);
        const scale = opts.uvScale !== undefined ? opts.uvScale : levels.surfaceScale(surface);
        levels.projectUV(g, scale);
        levels.paintGeometry(g, {
          tint: opts.tint, jitter: opts.jitter,
          ao: opts.ao, aoHeight: opts.aoHeight, groundY: opts.groundY,
        });
        push(statics, surface, g);

        /* Optional grounding footprint.
           Decor authored with `collide: false` is merged into one mesh
           per surface AND absent from the collision BVH, so it is
           invisible to both sources vfx.js can ground from - awnings,
           signage and kiosk fascias floated with nothing under them.
           Recording the world-space box here is far cheaper than
           giving them collision they do not need for gameplay. */
        if (opts.shade) {
          g.computeBoundingBox();
          const bb = g.boundingBox;
          shade.push({
            x: (bb.min.x + bb.max.x) / 2,
            z: (bb.min.z + bb.max.z) / 2,
            y: bb.min.y,
            sx: Math.max(0.2, bb.max.x - bb.min.x),
            sz: Math.max(0.2, bb.max.z - bb.min.z),
          });
        }

        if (opts.collide) {
          // `collide` may be a string naming the collision material, and
          // several courses pass one expecting it to win over the
          // surface's own tag. Route those into the same __box bucket
          // the explicit collide() helper uses, which carries a material.
          const c = g.clone();
          if (typeof opts.collide === "string") push(collide, `__box.${opts.collide}`, c);
          else push(collide, surface, c);
        }
      },

      /**
       * Repeated prop. One draw per key no matter how many instances.
       *
       * `geo` is normally a FACTORY, not a geometry: courses call this
       * inside their scatter loops, so building the prototype eagerly
       * would construct the same mesh hundreds of times and throw all
       * but one away. The factory is invoked exactly once, the first
       * time a key is seen. A plain geometry is accepted too, since a
       * course that already has one in hand should not have to wrap it.
       */
      inst(key, geo, surface, opts = {}) {
        if (!geo) return;
        let rec = insts.get(key);
        if (!rec) {
          const proto = typeof geo === "function" ? geo() : geo;
          if (!proto || !proto.isBufferGeometry) {
            console.warn(`[apop3d] out.inst("${key}") produced no geometry`);
            return;
          }
          const base = proto.clone();
          if (!base.attributes.uv) {
            levels.projectUV(base,
              opts.uvScale !== undefined ? opts.uvScale : levels.surfaceScale(surface));
          }
          levels.paintGeometry(base, { tint: opts.tint, jitter: opts.jitter, ao: opts.ao });
          rec = { geo: base, surface, xforms: [], collide: !!opts.collide };
          insts.set(key, rec);
        }
        rec.xforms.push({ pos: opts.pos, rot: opts.rot, scale: opts.scale });
        if (opts.collide) rec.collide = true;
      },

      /** An invisible collision box, for fencing off decor. */
      collide(pos, size, material) {
        const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
        g.translate(pos[0], pos[1], pos[2]);
        push(collide, `__box.${material || "stone"}`, g);
      },

      /** A named camera framing. camera.js reads these for its presets. */
      marker(name, pos, lookAt) {
        markers.set(name, {
          pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
          lookAt: lookAt ? new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]) : null,
        });
      },

      spawn(index, pos, yaw) {
        spawns[index] = { pos: new THREE.Vector3(pos[0], pos[1], pos[2]), yaw: yaw || 0 };
      },

      /** Handed to sky.js, which owns the light set. */
      accent(index, opts) { lights[index] = opts; },
      beam(opts) { beams.push(opts); },

      mover(descriptor) { if (descriptor) movers.push(descriptor); },

      record(id, pos, opts) { records.push({ id, pos, opts: opts || {} }); },
      clout(pos, kind) { clout.push({ pos, kind: kind || "yellow" }); },

      cloutLine(a, b, count, kind) {
        for (let i = 0; i < count; i += 1) {
          const t = count === 1 ? 0.5 : i / (count - 1);
          clout.push({
            pos: [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
            kind: kind || "yellow",
          });
        }
      },

      cloutRing(center, radius, count, kind) {
        for (let i = 0; i < count; i += 1) {
          const a = (i / count) * TAU;
          clout.push({
            pos: [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius],
            kind: kind || "yellow",
          });
        }
      },

      deal(pos, dealId) { deals.push({ pos, dealId }); },
      switchAt(pos, kind, id) { switches.push({ pos, kind, id }); },
      enemy(kind, pos, opts) { enemies.push({ kind, pos, opts: opts || {} }); },
      boss(kind, pos, opts) { bosses.push({ kind, pos, opts: opts || {} }); },
      portal(course, pos, opts) { portals.push({ course, pos, opts: opts || {} }); },
    };

    return {
      out,
      collected: {
        statics, collide, insts, movers, lights, beams, markers, spawns,
        records, clout, deals, switches, enemies, bosses, portals, shade,
        get bounds() { return bounds; },
      },
    };
  }

  /* ---------------------------------------------------------------
     Instantiation
     --------------------------------------------------------------- */

  function buildStatics(collected, levels, disposables, colliders) {
    const meshes = [];
    for (const [surface, list] of collected.statics) {
      const geo = mergeAll(list);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, levels.surface(surface));
      mesh.name = `static.${surface}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      meshes.push(mesh);
      disposables.push(geo);
    }

    // Collision uses its own merged soup. Keeping it separate from the
    // draw meshes lets decor be non-colliding without splitting the
    // render batch, which is what keeps the draw count down.
    for (const [surface, list] of collected.collide) {
      const geo = mergeAll(list);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo);
      mesh.name = `collide.${surface}`;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      const material = surface.startsWith("__box.")
        ? surface.slice(6)
        : levels.surfaceCollision(surface);
      ctx.collision?.addStatic?.(mesh, { material });
      colliders.push(mesh);
      disposables.push(geo);
    }
    return meshes;
  }

  function buildInstances(collected, levels, disposables, colliders) {
    const meshes = [];
    for (const [key, rec] of collected.insts) {
      const n = rec.xforms.length;
      if (!n) continue;
      const mesh = new THREE.InstancedMesh(rec.geo, levels.surface(rec.surface), n);
      mesh.name = `inst.${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < n; i += 1) {
        const x = rec.xforms[i];
        _v.set(x.pos ? x.pos[0] : 0, x.pos ? x.pos[1] : 0, x.pos ? x.pos[2] : 0);
        _e.set(x.rot ? x.rot[0] : 0, x.rot ? x.rot[1] : 0, x.rot ? x.rot[2] : 0);
        _q.setFromEuler(_e);
        if (x.scale === undefined) _s.set(1, 1, 1);
        else if (typeof x.scale === "number") _s.set(x.scale, x.scale, x.scale);
        else _s.set(x.scale[0], x.scale[1], x.scale[2]);
        _m.compose(_v, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
      meshes.push(mesh);
      disposables.push(rec.geo);

      // Instanced props are only worth colliding when the course asked
      // for it; hundreds of chairs of triangle soup is a real BVH cost.
      if (rec.collide) {
        const baked = [];
        for (let i = 0; i < n; i += 1) {
          const x = rec.xforms[i];
          baked.push(bake(rec.geo, x.pos, x.rot, x.scale));
        }
        const geo = mergeAll(baked);
        if (geo) {
          const cm = new THREE.Mesh(geo);
          cm.name = `collide.inst.${key}`;
          cm.visible = false;
          root.add(cm);
          ctx.collision?.addStatic?.(cm, { material: levels.surfaceCollision(rec.surface) });
          colliders.push(cm);
          disposables.push(geo);
        }
      }
    }
    return meshes;
  }

  /**
   * Movers. Each becomes its own mesh with matrixAutoUpdate on, and is
   * registered with collision as a moving body so physics can adopt it
   * as a rider's platform.
   */
  function buildMovers(collected, levels, disposables, colliders) {
    const list = [];
    const P = levels.primitives;

    for (const d of collected.movers) {
      const surface = d.surface || "shared.metal";
      let geo = null;

      if (d.kind === "rotator") {
        // The arms are merged into one geometry so the whole rotor is
        // a single draw and a single collision body.
        const parts = [];
        for (let i = 0; i < d.arms; i += 1) {
          const a = (i / d.arms) * TAU;
          parts.push(bake(
            P.platform(d.armSize[0], d.armSize[1], d.armSize[2]),
            [Math.cos(a) * d.radius, 0, Math.sin(a) * d.radius], [0, -a, 0]
          ));
        }
        if (d.hub) parts.push(bake(P.pillar(1.4, 1.2), [0, -0.4, 0]));
        geo = mergeAll(parts);
      } else {
        geo = P.platform(d.size[0], d.size[1], d.size[2]);
      }
      if (!geo) continue;

      levels.projectUV(geo, levels.surfaceScale(surface));
      levels.paintGeometry(geo, { tint: d.tint, ao: 0.18 });

      const holder = new THREE.Group();
      const mesh = new THREE.Mesh(geo, levels.surface(surface));
      mesh.name = `mover.${d.kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
      root.add(holder);
      disposables.push(geo);

      const start = d.kind === "moving" ? d.points[0] : d.pos;
      holder.position.set(start[0], start[1], start[2]);
      if (d.tilt) holder.rotation.z = d.tilt;
      holder.updateMatrixWorld(true);

      ctx.collision?.addStatic?.(mesh, {
        material: levels.surfaceCollision(surface),
        moving: true,
      });
      colliders.push(mesh);

      list.push({ def: d, holder, mesh });
    }
    return list;
  }

  /**
   * Step the movers.
   *
   * Runs in update(), which main.js orders BEFORE physics. A platform
   * that moved after its riders integrated would leave every rider one
   * frame behind, which reads as the player sliding off a lift.
   */
  function stepMovers() {
    if (!cur) return;
    const t = ctx.clock.t;
    for (const m of cur.movers) {
      const d = m.def;
      const h = m.holder;

      if (d.kind === "moving") {
        const pts = d.points;
        const legs = pts.length - 1;
        if (legs < 1) continue;
        // Out-and-back, so a two-point path does not snap home.
        const u = (((t / d.period) + (d.phase || 0)) % 1 + 1) % 1;
        const ping = u < 0.5 ? u * 2 : (1 - u) * 2;
        const eased = d.ease ? smoothstep(ping) : ping;
        const f = eased * legs;
        const i = Math.min(legs - 1, Math.floor(f));
        const k = f - i;
        const a = pts[i], b = pts[i + 1];
        h.position.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
      } else if (d.kind === "elevator") {
        const u = (((t / d.period) + (d.phase || 0)) % 1 + 1) % 1;
        const hold = clamp01(d.hold / Math.max(0.01, d.period));
        const ramp = Math.max(1e-4, 0.5 - hold / 2);
        let k;
        if (u < ramp) k = smoothstep(u / ramp);
        else if (u < 0.5) k = 1;
        else if (u < 0.5 + ramp) k = 1 - smoothstep((u - 0.5) / ramp);
        else k = 0;
        h.position.y = lerp(d.low, d.high, k);
      } else if (d.kind === "rotator") {
        h.rotation.y = ((t / d.period) + (d.phase || 0)) * TAU;
      } else if (d.kind === "seesaw") {
        const a = Math.sin((t * d.rate) + (d.phase || 0) * TAU) * d.maxTilt;
        if (d.axis === "z") h.rotation.z = a; else h.rotation.x = a;
      }
      h.updateMatrixWorld(true);
    }
  }

  /* ---------------------------------------------------------------
     Load / unload
     --------------------------------------------------------------- */

  function unload() {
    if (!cur) return;
    ctx.bus.emit("world:unload", { id: cur.id });

    ctx.enemies?.clearSpawners?.();
    ctx.bosses?.disarm?.();
    ctx.collect?.exit?.(ctx);
    ctx.enemies?.exit?.(ctx);
    ctx.bosses?.exit?.(ctx);

    for (const mesh of cur.colliders) ctx.collision?.removeStatic?.(mesh);

    /* Dispose ONLY what this module built.
       This used to traverse the whole subtree and dispose every mesh
       geometry under it, which is a trap for any module that parks a
       long-lived group here via register(): enemies.js registered its
       shared proxy meshes once, and the SECOND course load destroyed
       the geometry of all eight archetypes permanently - they simply
       stopped drawing while the system still reported them alive.
       cur.disposables is the authoritative list of what world.js
       created; anything else under root belongs to its registrar. */
    for (const d of cur.disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    while (root.children.length) root.remove(root.children[0]);

    /* Surface materials are cached per namespace; release the ones
       this course pulled in so a five-course run does not accumulate
       every texture atlas in the game.

       This needs a mapping, and used to be a silent no-op without one.
       `release()` compares BARE namespaces ("foodcourt"), so passing
       "foodcourt." never matched — and a course's `theme` is not its
       surface namespace anyway ("mall" owns the `foodcourt.*` surfaces,
       "rooftop" owns `roof.*"). Both mismatches had to be wrong for the
       leak to be invisible, which is why it was. */
    const ns = SURFACE_NAMESPACE[cur.def && cur.def.theme];
    if (ns) ctx.levels?.releaseSurfaces?.([ns]);

    /* Rebuild the (now empty) BVH immediately.
       Between removing a course's statics and building the next one,
       collision has no valid structure, and anything that queries the
       ground in that window - the player settling, a deferred bake -
       triggers a "queried before build(); building now" warning and an
       unplanned rebuild. Leaving a valid empty structure behind costs
       nothing and closes the gap. */
    ctx.collision?.build?.();
    cur = null;
  }

  async function load(courseId, spawnIndex = 0) {
    const levels = ctx.levels;
    if (!levels || typeof levels.byId !== "function") {
      console.error("[apop3d] world.load: levels.js is not available");
      return null;
    }
    const def = levels.byId(courseId);
    if (!def) {
      console.error(`[apop3d] world.load: no course with id ${courseId}`);
      return null;
    }

    unload();

    // Seeded per course, so the same build always produces the same
    // scatter - which is the only reason a screenshot golden means
    // anything.
    const rng = makeRng(0xA90D ^ (courseId * 2654435761));
    const { out, collected } = makeBuilder(def, rng, levels);

    try {
      def.build(ctx, out);
    } catch (error) {
      console.error(`[apop3d] course ${courseId} build() threw`, error);
    }

    const disposables = [];
    const colliders = [];

    const statics = buildStatics(collected, levels, disposables, colliders);
    const instances = buildInstances(collected, levels, disposables, colliders);
    const movers = buildMovers(collected, levels, disposables, colliders);

    ctx.collision?.build?.();

    const bounds = collected.bounds || { min: [-100, -20, -100], max: [100, 60, 100] };
    const spawn = collected.spawns[spawnIndex] || collected.spawns[0]
      || { pos: new THREE.Vector3(0, 2, 0), yaw: 0 };

    cur = {
      id: courseId, def, group: root,
      markers: collected.markers, spawns: collected.spawns, bounds,
      movers, statics, instances, colliders, disposables,
      records: collected.records,
      shade: collected.shade,
    };
    ctx.state.course = courseId;

    /* Sky first: it owns the light set and the fog everything else is
       read against.

       The accents and beams a course authored are handed over rather
       than instantiated here. sky.js allocates its light set ONCE at
       construction and only re-points and re-dims it, which is what
       keeps a course change off the "adding a light recompiles every
       material in the scene" path. World-owned PointLights would have
       walked straight back onto it. */
    const centre = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const radius = 0.575 * Math.max(
      bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]
    );
    // Courses author directions as plain arrays because levels.js does
    // not import three; sky.js works in Vector3. Convert at the seam
    // rather than making either side change its convention.
    const beams = collected.beams.map((b) => ({
      ...b,
      dir: Array.isArray(b.dir) ? new THREE.Vector3(b.dir[0], b.dir[1], b.dir[2]) : b.dir,
    }));
    ctx.sky?.setCourse?.(courseId, {
      centre, radius,
      accents: collected.lights.filter(Boolean),
      beams,
    });

    // Now that sky.js has set this course's bounce palette, build the
    // environment cube from it. Without this every metal surface in
    // the game falls back to a hemisphere stand-in that reads as pure
    // black on vertical faces - chrome, truss and ducting all render
    // as holes cut in the frame. Must come AFTER setCourse.
    ctx.materials?.refreshEnv?.(1);

    // Then the populations. Each is optional-chained because a module
    // that failed to create must not take the course down with it.
    for (const r of collected.records) {
      ctx.collect?.spawnRecord?.(r.id, r.pos, { courseId, ...r.opts });
    }
    for (const c of collected.clout) ctx.collect?.spawnClout?.(c.pos, c.kind);
    for (const d of collected.deals) ctx.collect?.spawnDeal?.(d.pos, d.dealId);
    for (const s of collected.switches) ctx.collect?.spawnSwitch?.(s.pos, s.kind, s.id);

    for (const e of collected.enemies) {
      ctx.enemies?.addSpawner?.({ kind: e.kind, position: e.pos, ...e.opts });
    }
    for (const b of collected.bosses) {
      // provideArena reads `center`; passing only `position` left every
      // fight sitting at bosses.js's default home no matter where the
      // course placed its arena. Both keys are sent so either reader works.
      ctx.bosses?.provideArena?.(b.kind, {
        center: b.pos, position: b.pos, courseId, ...b.opts,
      });
    }
    ctx.bosses?.armForCourse?.(courseId);

    ctx.collect?.enter?.(ctx, { course: courseId });
    ctx.enemies?.enter?.(ctx, { course: courseId });
    ctx.bosses?.enter?.(ctx, { course: courseId });

    // The player goes last: it needs a floor to stand on, and a camera
    // that already knows where the course is.
    ctx.player?.teleport?.(spawn.pos.x, spawn.pos.y, spawn.pos.z, spawn.yaw);
    ctx.cameraRig?.enter?.(ctx, { course: courseId, markers: collected.markers, bounds });
    ctx.audio?.music?.(def.music || courseId, { fade: 1.2 });
    ctx.hud?.courseTitle?.(def.name);

    ctx.bus.emit("world:load", { id: courseId, def, bounds, spawn });
    return cur;
  }

  /* ---------------------------------------------------------------
     Public API
     --------------------------------------------------------------- */

  return {
    root,
    get current() { return cur; },
    get markers() { return cur ? cur.markers : null; },
    get bounds() { return cur ? cur.bounds : null; },

    load,
    unload,

    /** A named camera framing, or null. camera.js reads this. */
    marker(name) { return cur ? (cur.markers.get(name) || null) : null; },
    spawn(index) { return cur ? (cur.spawns[index] || cur.spawns[0] || null) : null; },

    /** Late registration, for anything built outside a course build. */
    register(obj, kind) {
      if (!obj) return;
      root.add(obj);
      if (kind === "static" && ctx.collision) {
        ctx.collision.addStatic(obj, {});
        if (cur) cur.colliders.push(obj);
      }
    },

    update() { stepMovers(); },

    report() {
      if (!cur) return { loaded: false };
      return {
        loaded: true,
        id: cur.id,
        name: cur.def.name,
        statics: cur.statics.length,
        instances: cur.instances.length,
        movers: cur.movers.length,
        shade: cur.shade.length,
        markers: [...cur.markers.keys()],
        bounds: cur.bounds,
      };
    },

    dispose() {
      unload();
      ctx.scene.remove(root);
    },
  };
}
