/* ============================================================
   SAINTFALL - structure kit

   The geometry vocabulary. Every built thing on Vesper-IX comes
   out of this file, which is what keeps eleven very different
   districts looking like one world.

   Two rules run through all of it:

   1. RINGS. Almost everything is a stack of polygonal rings
      stitched into a solid. Columns, spires, rocks, ribs, chitin,
      pipes and the Saint's own skull are the same function with
      different ring tables. One well-tested builder beats twenty
      bespoke ones, and it means a silhouette can be tuned by
      editing numbers rather than geometry code.

   2. ODD SIDE COUNTS. Six- and eight-sided prisms read as
      machined; five, seven and nine read as carved. Rock and bone
      use odd counts with per-ring phase offsets so no two rings
      line their edges up, which is what stops a stack of rings
      from looking like a stack of rings.

   Everything returns an indexed BufferGeometry with normals, ready
   to be painted and merged. Materials here are flat-shaded, so
   three derives face normals in the fragment shader and shared
   vertices cost nothing - but the normals are still computed,
   because the vertex painters and the shadow normalBias read them.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, smoothstep, makeRng,
} from "saintfall/core.js";
import { mergeGeometries } from "saintfall/sky.js";

export function makeKit(THREE) {
  /* ============================================================
     PRIMITIVES
     ============================================================ */

  /**
   * The workhorse. `rings` is an ordered list of cross-sections:
   *   { y, r | rx/rz, sides, phase, cx, cz, jitter, seed }
   * Consecutive rings are stitched with quads; ends are capped.
   *
   * Ring side counts may differ between entries - the stitcher
   * walks whichever is larger and duplicates indices - so a shape
   * can lose detail as it tapers without a seam.
   */


  function ringSolid(rings, opts = {}) {
    const capTop = opts.capTop !== false;
    const capBottom = opts.capBottom !== false;
    const pos = [];
    const idx = [];
    const starts = [];
    const counts = [];

    for (let r = 0; r < rings.length; r += 1) {
      const ring = rings[r];
      const sides = Math.max(3, ring.sides || opts.sides || 7);
      const phase = ring.phase || 0;
      const rx = ring.rx !== undefined ? ring.rx : ring.r;
      const rz = ring.rz !== undefined ? ring.rz : ring.r;
      const cx = ring.cx || 0;
      const cz = ring.cz || 0;
      const jitter = ring.jitter || 0;
      const rng = makeRng(((ring.seed || (r * 7919 + 13)) >>> 0) || 1);
      starts.push(pos.length / 3);
      counts.push(sides);
      for (let s = 0; s < sides; s += 1) {
        const a = (s / sides) * TAU + phase;
        const k = 1 + (jitter ? rng.jit(jitter) : 0);
        pos.push(cx + Math.cos(a) * rx * k, ring.y, cz + Math.sin(a) * rz * k);
      }
    }

    /* Triangles are emitted only if they have area.
       Distinct INDICES do not imply distinct POSITIONS: a ring of
       radius 0 - a cone tip, a closed cap, a spire's apex - puts all
       of its vertices on the same point, so every triangle touching
       it is zero-area. Those cost vertex processing for nothing, and
       worse, a vertex whose faces are ALL degenerate gets a
       zero-length normal from computeVertexNormals, which normalises
       to NaN and then travels through lighting into the bloom chain.
       An audit found 21% of every scatter mesh in this state. */
    const tri = (i0, i1, i2) => {
      const p0 = i0 * 3;
      const p1 = i1 * 3;
      const p2 = i2 * 3;
      const ux = pos[p1] - pos[p0];
      const uy = pos[p1 + 1] - pos[p0 + 1];
      const uz = pos[p1 + 2] - pos[p0 + 2];
      const vx = pos[p2] - pos[p0];
      const vy = pos[p2 + 1] - pos[p0 + 1];
      const vz = pos[p2 + 2] - pos[p0 + 2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz < 1e-14) return;
      idx.push(i0, i1, i2);
    };

    for (let r = 0; r < rings.length - 1; r += 1) {
      const s0 = starts[r];
      const s1 = starts[r + 1];
      const c0 = counts[r];
      const c1 = counts[r + 1];
      const steps = Math.max(c0, c1);
      for (let s = 0; s < steps; s += 1) {
        const a0 = s0 + Math.floor((s / steps) * c0) % c0;
        const a1 = s0 + Math.floor(((s + 1) / steps) * c0) % c0;
        const b0 = s1 + Math.floor((s / steps) * c1) % c1;
        const b1 = s1 + Math.floor(((s + 1) / steps) * c1) % c1;
        if (a0 !== a1 && b0 !== b1) { tri(a0, b0, b1); tri(a0, b1, a1); }
        else if (a0 !== a1) tri(a0, b0, a1);
        else if (b0 !== b1) tri(a0, b0, b1);
      }
    }

    if (capBottom && counts[0] >= 3) {
      const c = pos.length / 3;
      const ring = rings[0];
      pos.push(ring.cx || 0, ring.y, ring.cz || 0);
      for (let s = 0; s < counts[0]; s += 1) {
        // Rings advance counter-clockwise when viewed from above.
        // The lower cap therefore needs current -> next around its
        // centre so its normal faces down, out of the solid.
        tri(c, starts[0] + s, starts[0] + ((s + 1) % counts[0]));
      }
    }
    if (capTop && counts[counts.length - 1] >= 3) {
      const last = rings.length - 1;
      const c = pos.length / 3;
      const ring = rings[last];
      pos.push(ring.cx || 0, ring.y, ring.cz || 0);
      for (let s = 0; s < counts[last]; s += 1) {
        // Reverse the fan on the upper cap so its normal faces up.
        // The previous orders pointed both caps into the solid: tops
        // vanished while exposed foundation undersides rendered.
        tri(c, starts[last] + ((s + 1) % counts[last]), starts[last] + s);
      }
    }

    /* Compact away vertices no surviving triangle references.
       Dropping the zero-area triangles above orphans the coincident
       vertices of any radius-0 ring, and an orphan gets a zero-length
       normal from computeVertexNormals - which reads as a NaN normal
       to any audit and is dead weight in the buffer either way. */
    const used = new Int32Array(pos.length / 3).fill(-1);
    for (let i = 0; i < idx.length; i += 1) used[idx[i]] = 0;
    const outPos = [];
    let next = 0;
    for (let v = 0; v < used.length; v += 1) {
      if (used[v] !== 0) continue;
      used[v] = next;
      next += 1;
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    for (let i = 0; i < idx.length; i += 1) idx[i] = used[idx[i]];

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Tapered n-gon prism. `twist` rotates the top ring. */
  function prism(opts = {}) {
    const {
      h = 1, rBottom = 0.5, rTop = 0.5, sides = 6, twist = 0,
      segments = 1, jitter = 0, seed = 1, bulge = 0,
    } = opts;
    const rings = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const r = lerp(rBottom, rTop, t) * (1 + Math.sin(t * Math.PI) * bulge);
      rings.push({ y: t * h, r, sides, phase: twist * t, jitter, seed: seed + i * 31 });
    }
    return ringSolid(rings, opts);
  }

  /** Bevelled box. A hard-edged cube in a low-poly scene reads as
   *  untextured; a 4% bevel catches the rim light and reads as
   *  dressed stone. */
  function slab(w, h, d, bevel = 0) {
    if (bevel <= 0) {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, h / 2, 0);
      return g;
    }
    const b = Math.min(bevel, w * 0.45, h * 0.45, d * 0.45);
    return ringSolid([
      { y: 0, rx: w / 2 - b, rz: d / 2 - b, sides: 4, phase: Math.PI / 4 },
      { y: b, rx: w / 2, rz: d / 2, sides: 4, phase: Math.PI / 4 },
      { y: h - b, rx: w / 2, rz: d / 2, sides: 4, phase: Math.PI / 4 },
      { y: h, rx: w / 2 - b, rz: d / 2 - b, sides: 4, phase: Math.PI / 4 },
    ]).scale(Math.SQRT2, 1, Math.SQRT2);
  }

  /** Vertical extrusion of an arbitrary 2D footprint (x,z). */
  function polyExtrudeY(points, y0, y1) {
    // Normalise to counter-clockwise x/z winding. The side and cap
    // orders below assume this orientation; accepting both orders
    // silently turned authored top faces into backfaces.
    let foot = points;
    let signedArea = 0;
    for (let i = 0; i < points.length; i += 1) {
      const j = (i + 1) % points.length;
      signedArea += points[i][0] * points[j][1] - points[j][0] * points[i][1];
    }
    if (signedArea < 0) foot = points.slice().reverse();
    const n = foot.length;
    const pos = [];
    const idx = [];
    for (const [x, z] of foot) pos.push(x, y0, z);
    for (const [x, z] of foot) pos.push(x, y1, z);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      idx.push(i, i + n, j + n, i, j + n, j);
    }
    // Fan caps. Footprints here are convex or near-convex, which a
    // fan handles; a general polygon triangulator is not worth the
    // code for a kit whose footprints are all authored.
    for (let i = 1; i < n - 1; i += 1) {
      // x/z rings run counter-clockwise from above: the bottom fan
      // faces down and the top fan faces up.
      idx.push(0, i, i + 1);
      idx.push(n, n + i + 1, n + i);
    }
    /* Compact away vertices no surviving triangle references.
       Dropping the zero-area triangles above orphans the coincident
       vertices of any radius-0 ring, and an orphan gets a zero-length
       normal from computeVertexNormals - which reads as a NaN normal
       to any audit and is dead weight in the buffer either way. */
    const used = new Int32Array(pos.length / 3).fill(-1);
    for (let i = 0; i < idx.length; i += 1) used[idx[i]] = 0;
    const outPos = [];
    let next = 0;
    for (let v = 0; v < used.length; v += 1) {
      if (used[v] !== 0) continue;
      used[v] = next;
      next += 1;
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    for (let i = 0; i < idx.length; i += 1) idx[i] = used[idx[i]];

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Extrude a 2D profile (x,y) along Z. Arches, mouldings, ribs. */
  function extrudeZ(profile, depth, opts = {}) {
    const n = profile.length;
    const closed = opts.closed !== false;
    const pos = [];
    const idx = [];
    const hz = depth / 2;

    /* Which way round is this profile?
       The side faces' normals are decided entirely by the profile's
       winding: traversed counter-clockwise they point outward, and
       clockwise they point INTO the solid. Callers should not have to
       know that, and demonstrably did not - the Vault-Cathedral's
       nave roof profile came out clockwise, so the largest roof on
       the map was inside out and took no sunlight at all, reading as
       a flat dark slab. The aisle lean-to had the same fault on one
       side only, because mirroring it by negating x REVERSES the
       winding, so the two halves of a symmetrical building disagreed.

       Measuring the signed area and flipping if needed makes the
       primitive winding-agnostic, which is the only version of this
       that survives the next caller. */
    let area2 = 0;
    for (let i = 0; i < n; i += 1) {
      const [x0, y0] = profile[i];
      const [x1, y1] = profile[(i + 1) % n];
      area2 += x0 * y1 - x1 * y0;
    }
    const flip = area2 < 0;
    const src = flip ? profile.slice().reverse() : profile;

    for (const [x, y] of src) pos.push(x, y, -hz);
    for (const [x, y] of src) pos.push(x, y, hz);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i += 1) {
      const j = (i + 1) % n;
      idx.push(i, j, j + n, i, j + n, i + n);
    }
    /* End caps by triangle fan, which is only valid for a CONVEX
       profile. A concave outline - a crescent, a chevron, a C - gets
       a fan that spans its own hollow and fills it in. A halo built
       this way rendered as a solid black disc. Callers with concave
       profiles should build from overlapping segments instead. */
    /* BOTH cap fans were wound inside-out.

       `src` is force-normalised counter-clockwise above, so these two
       fans came out with the same handedness - and both the wrong
       one. The side walls were always correct; only the caps faced
       away. The consequence is that every extruded plate on the
       player rendered ONE FULL `depth` further back than authored and
       its front face never drew, which means every z offset in that
       file was tuned against a surface the renderer does not
       rasterise. A ray cast through the chest returned five parts in
       a row, each reporting its REAR cap. */
    if (closed) {
      for (let i = 1; i < n - 1; i += 1) {
        idx.push(0, i + 1, i);
        idx.push(n, n + i, n + i + 1);
      }
    }
    /* Compact away vertices no surviving triangle references.
       Dropping the zero-area triangles above orphans the coincident
       vertices of any radius-0 ring, and an orphan gets a zero-length
       normal from computeVertexNormals - which reads as a NaN normal
       to any audit and is dead weight in the buffer either way. */
    const used = new Int32Array(pos.length / 3).fill(-1);
    for (let i = 0; i < idx.length; i += 1) used[idx[i]] = 0;
    const outPos = [];
    let next = 0;
    for (let v = 0; v < used.length; v += 1) {
      if (used[v] !== 0) continue;
      used[v] = next;
      next += 1;
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    for (let i = 0; i < idx.length; i += 1) idx[i] = used[idx[i]];

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /**
   * A closed solid between two 2D curves, extruded along Z. The
   * shape a masonry band actually is: an extrados, an intrados,
   * two faces and two ends.
   *
   * This exists because `extrudeZ` caps its profile with a
   * triangle fan, which is correct for the convex footprints it is
   * used for and catastrophically wrong for a curved band - and
   * for a band the fan lands on the LARGE visible face, not on a
   * hidden end cap.
   */
  function ribbonSolid(topPts, botPts, depth) {
    const n = Math.min(topPts.length, botPts.length);
    const hz = depth / 2;
    const pos = [];
    const idx = [];
    for (let i = 0; i < n; i += 1) {
      pos.push(topPts[i][0], topPts[i][1], -hz);
      pos.push(botPts[i][0], botPts[i][1], -hz);
      pos.push(topPts[i][0], topPts[i][1], hz);
      pos.push(botPts[i][0], botPts[i][1], hz);
    }
    for (let i = 0; i < n - 1; i += 1) {
      const b = i * 4;
      const q = (i + 1) * 4;
      idx.push(b + 0, q + 0, q + 1, b + 0, q + 1, b + 1);   // -z face
      idx.push(b + 2, b + 3, q + 3, b + 2, q + 3, q + 2);   // +z face
      idx.push(b + 0, b + 2, q + 2, b + 0, q + 2, q + 0);   // top edge
      idx.push(b + 1, q + 1, q + 3, b + 1, q + 3, b + 3);   // bottom edge
    }
    // End caps.
    idx.push(0, 1, 3, 0, 3, 2);
    const e = (n - 1) * 4;
    idx.push(e + 0, e + 3, e + 1, e + 0, e + 2, e + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** A tube swept along a 3D polyline. Pipes, cables, roots. */
  function tube(points, radius, sides = 5, opts = {}) {
    const rings = [];
    const up = new THREE.Vector3(0, 1, 0);
    const pos = [];
    const idx = [];
    const taper = opts.taper || 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      let ref = Math.abs(dir.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : up;
      const right = new THREE.Vector3().crossVectors(dir, ref).normalize();
      const nrm = new THREE.Vector3().crossVectors(right, dir).normalize();
      const r = radius * (1 - taper * (i / Math.max(1, points.length - 1)));
      for (let s = 0; s < sides; s += 1) {
        const ang = (s / sides) * TAU + (opts.phase || 0);
        pos.push(
          p[0] + right.x * Math.cos(ang) * r + nrm.x * Math.sin(ang) * r,
          p[1] + right.y * Math.cos(ang) * r + nrm.y * Math.sin(ang) * r,
          p[2] + right.z * Math.cos(ang) * r + nrm.z * Math.sin(ang) * r
        );
      }
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      for (let s = 0; s < sides; s += 1) {
        const n = (s + 1) % sides;
        const a0 = i * sides + s;
        const a1 = i * sides + n;
        const b0 = (i + 1) * sides + s;
        const b1 = (i + 1) * sides + n;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
    // Close pipe, rib, tusk and cable ends. The increasing ring
    // order faces back along the sweep direction, so the start uses
    // that order and the end reverses it. Callers that deliberately
    // need an open mouth can opt out per end.
    if (points.length && opts.capStart !== false) {
      const c = pos.length / 3;
      pos.push(points[0][0], points[0][1], points[0][2]);
      for (let s = 0; s < sides; s += 1) {
        idx.push(c, s, (s + 1) % sides);
      }
    }
    if (points.length && opts.capEnd !== false) {
      const c = pos.length / 3;
      const start = (points.length - 1) * sides;
      const p = points[points.length - 1];
      pos.push(p[0], p[1], p[2]);
      for (let s = 0; s < sides; s += 1) {
        idx.push(c, start + ((s + 1) % sides), start + s);
      }
    }
    void rings;
    /* Compact away vertices no surviving triangle references.
       Dropping the zero-area triangles above orphans the coincident
       vertices of any radius-0 ring, and an orphan gets a zero-length
       normal from computeVertexNormals - which reads as a NaN normal
       to any audit and is dead weight in the buffer either way. */
    const used = new Int32Array(pos.length / 3).fill(-1);
    for (let i = 0; i < idx.length; i += 1) used[idx[i]] = 0;
    const outPos = [];
    let next = 0;
    for (let v = 0; v < used.length; v += 1) {
      if (used[v] !== 0) continue;
      used[v] = next;
      next += 1;
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    for (let i = 0; i < idx.length; i += 1) idx[i] = used[idx[i]];

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================
     ROCK
     ============================================================ */

  /**
   * A faceted crag. Rings of odd side count with per-ring phase
   * drift, radius noise and a lean, so the silhouette is
   * asymmetric from every approach - which is the whole job of a
   * rock in a low-poly scene.
   */
  function crag(rng, opts = {}) {
    const {
      height = 8, radius = 5, layers = 5, sides = 7,
      lean = 0.28, spike = 0.0, sink = 0.12, cliff = 0.0, benches = 0,
    } = opts;
    const leanA = rng() * TAU;
    const lx = Math.cos(leanA) * lean;
    const lz = Math.sin(leanA) * lean;
    const rings = [];
    let previousRadius = Infinity;
    let ringPhase = 0;
    for (let i = 0; i <= layers; i += 1) {
      const t = i / layers;
      // Three profiles, blended. `shape` is a wind-cut boulder;
      // `spiked` is a needle; `walls` holds full radius almost to
      // the top and then breaks.
      //
      // The third exists because a landscape built only from the
      // first reads as a row of tents on the horizon. Real desert
      // ranges are mostly VERTICAL faces with horizontal breaks,
      // and it is those horizontals - among a thousand diagonals -
      // that make a silhouette read as rock rather than as a pile.
      const shape = Math.pow(1 - t, 0.62) * (1 + Math.sin(t * Math.PI) * 0.16);
      const spiked = Math.pow(1 - t, 1.9);
      // Near-vertical to about 70% height, then a decisive break.
      // The earlier exponent held full radius almost to the summit
      // and, combined with the bench modulation, produced crowns
      // WIDER than the shaft below them - a horizon of mushrooms.
      const walls = 1 - Math.pow(t, 2.2) * 0.94;
      let profile = lerp(shape, spiked, spike);
      profile = lerp(profile, walls, cliff);
      // Bench steps: a stratum that juts, repeated up the face.
      // Amplitude is capped so a bench can never out-swell the
      // taper it sits on.
      const bench = benches > 0
        ? 1 + Math.sin(t * Math.PI * 2 * benches) * Math.min(0.09, 0.05 * benches)
        : 1;
      // Per-ring noise used to let a higher ring flare far beyond
      // the one below it, producing detached-looking shelves and
      // large visible undersides on otherwise ordinary rocks. A
      // tiny outward drift keeps the silhouette irregular without
      // allowing a procedural mushroom cap.
      const noisyRadius = radius * profile * bench * rng.range(0.86, 1.14);
      const ringRadius = Math.min(noisyRadius, previousRadius * 1.04);
      previousRadius = ringRadius;
      ringPhase += rng.jit(0.16);
      rings.push({
        y: -height * sink + t * height * (1 + sink),
        r: ringRadius,
        sides: Math.max(4, Math.round(sides - t * 2)),
        phase: ringPhase,
        cx: lx * height * t * t,
        cz: lz * height * t * t,
        jitter: 0.20,
        seed: rng.int(1, 1e6),
      });
    }
    rings[rings.length - 1].r *= lerp(0.36, 0.62, cliff);
    return ringSolid(rings);
  }

  /** A splinter: glass, chitin plate, shattered masonry. */
  function shard(rng, opts = {}) {
    const {
      height = 6, radius = 1.4, sides = 5, sharpness = 0.82, lean = 0.5,
    } = opts;
    const leanA = rng() * TAU;
    const rings = [];
    const layers = 4;
    let ringPhase = 0;
    for (let i = 0; i <= layers; i += 1) {
      const t = i / layers;
      ringPhase += rng.jit(0.20);
      rings.push({
        y: -height * 0.16 + t * height * 1.16,
        r: radius * Math.pow(1 - t, lerp(0.7, 2.6, sharpness)) * rng.range(0.8, 1.25),
        sides: i > layers - 2 ? 3 : sides,
        phase: ringPhase,
        cx: Math.cos(leanA) * lean * height * t * t * 0.35,
        cz: Math.sin(leanA) * lean * height * t * t * 0.35,
        jitter: 0.3,
        seed: rng.int(1, 1e6),
      });
    }
    rings[rings.length - 1].r = radius * 0.03;
    return ringSolid(rings);
  }

  /** A field of boulders as one merged geometry. */
  function boulderField(rng, count, opts = {}) {
    const geos = [];
    for (let i = 0; i < count; i += 1) {
      const s = opts.size ? opts.size(rng, i) : rng.range(0.6, 3.2);
      const g = crag(rng, {
        height: s * rng.range(0.7, 1.5), radius: s,
        layers: 4, sides: rng.int(5, 8), lean: rng.range(0, 0.4), sink: 0.3,
      });
      const p = opts.place(rng, i);
      if (!p) continue;
      g.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(p[0], p[1], p[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          rng.jit(0.22), rng() * TAU, rng.jit(0.22)
        )),
        new THREE.Vector3(1, 1, 1)
      ));
      geos.push(g);
    }
    return geos.length ? mergeGeometries(THREE, geos) : null;
  }

  /* ============================================================
     GOTHIC ARCHITECTURE
     ============================================================ */

  /** The pointed-arch profile as a closed 2D outline (x, y), from
   *  the outer edge round and back along the inner edge. */
  function archOutline(width, height, thickness, rise = 1.0, steps = 9) {
    const hw = width / 2;
    const springY = height * (1 - rise * 0.55);
    const outer = [];
    const inner = [];
    // Two circular arcs struck from opposite springing points is
    // what makes an arch *pointed* rather than round; the centres
    // sit inside the span, and the ratio sets how lancet it looks.
    const c = hw * (1.35 / Math.max(0.35, rise));
    const R = c + hw;
    const apex = springY + Math.sqrt(Math.max(1, R * R - c * c));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(-hw, 0, t);
      const y = springY + Math.sqrt(Math.max(0, R * R - (x - c) ** 2));
      outer.push([x, Math.min(y, apex)]);
    }
    for (let i = steps; i >= 0; i -= 1) {
      const t = i / steps;
      const x = lerp(hw, 0, t);
      const y = springY + Math.sqrt(Math.max(0, R * R - (x + c) ** 2));
      outer.push([x, Math.min(y, apex)]);
    }
    const iw = hw - thickness;
    const iR = R - thickness;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(iw, 0, t);
      const y = springY + Math.sqrt(Math.max(0, iR * iR - (x + c) ** 2));
      inner.push([x, Math.min(y, apex - thickness * 0.6)]);
    }
    for (let i = steps; i >= 0; i -= 1) {
      const t = i / steps;
      const x = lerp(-iw, 0, t);
      const y = springY + Math.sqrt(Math.max(0, iR * iR - (x - c) ** 2));
      inner.push([x, Math.min(y, apex - thickness * 0.6)]);
    }
    return { outer, inner, apex, springY, hw, iw };
  }

  /**
   * A free-standing pointed arch: two jambs and the voussoir ring
   * above them, with a real opening you can walk and see through.
   */
  function gothicArch(opts = {}) {
    const {
      width = 6, height = 11, depth = 2.2, thickness = 0.9, rise = 1.0,
    } = opts;
    const a = archOutline(width, height, thickness, rise);
    const geos = [];

    // Arch ring: a strip between the outer and inner curves.
    const steps = a.outer.length / 2;
    const pos = [];
    const idx = [];
    const hz = depth / 2;
    const outerHalf = a.outer.slice(0, steps);
    const innerHalf = a.inner.slice(steps).reverse();
    const rows = Math.min(outerHalf.length, innerHalf.length);
    const mirror = [];
    for (let i = 0; i < rows; i += 1) {
      mirror.push([outerHalf[i], innerHalf[i]]);
    }
    // Walk left half then mirror to the right so the two sides
    // cannot drift apart.
    const full = mirror.concat(mirror.slice(0, rows).reverse().map(
      ([o, n]) => [[-o[0], o[1]], [-n[0], n[1]]]
    ));
    for (let i = 0; i < full.length; i += 1) {
      const [o, n] = full[i];
      pos.push(o[0], o[1], -hz); pos.push(n[0], n[1], -hz);
      pos.push(o[0], o[1], hz); pos.push(n[0], n[1], hz);
    }
    for (let i = 0; i < full.length - 1; i += 1) {
      const b = i * 4;
      const q = (i + 1) * 4;
      idx.push(b + 0, q + 0, q + 1, b + 0, q + 1, b + 1);   // front face
      idx.push(b + 2, b + 3, q + 3, b + 2, q + 3, q + 2);   // back face
      idx.push(b + 0, b + 2, q + 2, b + 0, q + 2, q + 0);   // extrados
      idx.push(b + 1, q + 1, q + 3, b + 1, q + 3, b + 3);   // intrados
    }
    const ring = new THREE.BufferGeometry();
    ring.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    ring.setIndex(idx);
    ring.computeVertexNormals();
    geos.push(ring);

    // Jambs down to the ground.
    for (const s of [-1, 1]) {
      const jamb = slab(thickness, a.springY, depth, thickness * 0.14);
      jamb.translate(s * (a.hw - thickness / 2), 0, 0);
      geos.push(jamb);
    }
    return mergeGeometries(THREE, geos);
  }

  /**
   * A clustered gothic column: a central drum ringed by engaged
   * shafts, with a moulded base and capital. The shaft count is
   * what makes it read as gothic rather than as a pipe.
   */
  function column(opts = {}) {
    const {
      h = 12, r = 0.9, shafts = 6, shaftR = 0.24,
      base = true, capital = true, entasis = 0.045,
    } = opts;
    const geos = [];
    const coreTop = h - (capital ? h * 0.06 : 0);
    const coreBot = base ? h * 0.045 : 0;

    geos.push(prism({
      h: coreTop - coreBot, rBottom: r, rTop: r * (1 - entasis),
      sides: 8, segments: 3, bulge: entasis * 0.7,
    }).translate(0, coreBot, 0));

    for (let i = 0; i < shafts; i += 1) {
      const a = (i / shafts) * TAU + Math.PI / shafts;
      const s = prism({
        h: coreTop - coreBot, rBottom: shaftR, rTop: shaftR * 0.94,
        sides: 5, segments: 2,
      });
      s.translate(Math.cos(a) * (r + shaftR * 0.55), coreBot, Math.sin(a) * (r + shaftR * 0.55));
      geos.push(s);
    }

    if (base) {
      geos.push(prism({ h: h * 0.028, rBottom: r * 1.62, rTop: r * 1.52, sides: 8 }));
      geos.push(prism({ h: h * 0.022, rBottom: r * 1.48, rTop: r * 1.24, sides: 8 })
        .translate(0, h * 0.028, 0));
    }
    if (capital) {
      const cy = coreTop;
      geos.push(prism({ h: h * 0.032, rBottom: r * 1.06, rTop: r * 1.5, sides: 8 })
        .translate(0, cy, 0));
      geos.push(prism({ h: h * 0.022, rBottom: r * 1.55, rTop: r * 1.42, sides: 4, twist: Math.PI / 4 })
        .translate(0, cy + h * 0.032, 0));
    }
    return mergeGeometries(THREE, geos);
  }

  /**
   * A flying buttress: a pier, a raking arch that leaps to the
   * nave wall, and a pinnacle weighting the pier. This one shape
   * does more to say "cathedral" than any amount of window detail,
   * because it is the profile everybody recognises from outside.
   */
  function flyingButtress(opts = {}) {
    const {
      reach = 9, pierH = 12, wallH = 20, thickness = 1.1, pinnacle = true,
    } = opts;
    const geos = [];
    // The pier is the mass that makes the flyer make sense - it is
    // what the thrust is being carried down INTO. Built slim, the
    // whole assembly reads as a decorative fin stuck on a wall.
    geos.push(slab(thickness * 3.0, pierH, thickness * 3.6, 0.22).translate(reach, 0, 0));
    geos.push(slab(thickness * 3.8, pierH * 0.22, thickness * 4.4, 0.26).translate(reach, 0, 0));
    geos.push(prism({ h: pierH * 0.10, rBottom: thickness * 2.4, rTop: thickness * 2.0, sides: 4, twist: Math.PI / 4 })
      .translate(reach, pierH * 0.86, 0));

    // Raking arch, struck as a quarter-ellipse from pier top to wall.
    const steps = 9;
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(reach, 0.4, t);
      const y = lerp(pierH * 0.92, wallH, Math.pow(t, 1.55));
      pts.push([x, y, 0]);
    }
    geos.push(tube(pts, thickness * 0.95, 5, { phase: Math.PI / 4 }));

    // A solid spandrel under the arch, so it reads as masonry
    // rather than as a pipe bridging two towers.
    const webTop = [];
    const webBot = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(reach, 0.4, t);
      webTop.push([x, lerp(pierH * 0.92, wallH, Math.pow(t, 1.55)) - thickness * 0.9]);
      webBot.push([x, lerp(pierH * 0.42, wallH * 0.62, Math.pow(t, 2.1)) - thickness * 0.9]);
    }
    geos.push(ribbonSolid(webTop, webBot, thickness * 1.05));

    if (pinnacle) {
      const p = prism({ h: pierH * 0.30, rBottom: thickness * 1.25, rTop: 0.06, sides: 4, twist: Math.PI / 4 });
      p.translate(reach, pierH, 0);
      geos.push(p);
      geos.push(slab(thickness * 2.1, pierH * 0.06, thickness * 2.1, 0.1).translate(reach, pierH - pierH * 0.06, 0));
    }
    return mergeGeometries(THREE, geos);
  }

  /**
   * A spire. Stacked tapering stages with a set-back at each
   * break, corner pinnacles on the lower stages, and a finial.
   * Straight cones read as a party hat; the set-backs are what
   * give it height.
   */
  function spire(opts = {}) {
    const {
      h = 60, r = 5, stages = 4, sides = 8, pinnacles = true, seed = 7,
    } = opts;
    const rng = makeRng(seed);
    const geos = [];
    let y = 0;
    let rr = r;
    const courseH = h * 0.012;
    const needleH = h * 0.16;
    const stageBudget = Math.max(h * 0.5, h - courseH * stages - needleH);
    const weights = [];
    for (let s = 0; s < stages; s += 1) {
      const t = s / stages;
      weights.push((0.34 - t * 0.055) * rng.range(0.9, 1.1));
    }
    const weightSum = weights.reduce((sum, v) => sum + v, 0);
    for (let s = 0; s < stages; s += 1) {
      const t = s / stages;
      const sh = stageBudget * weights[s] / weightSum;
      const rTop = rr * lerp(0.78, 0.55, t);
      geos.push(prism({
        h: sh, rBottom: rr, rTop, sides, segments: 2,
      }).translate(0, y, 0));
      // String course: a thin flare marking the set-back.
      geos.push(prism({ h: courseH, rBottom: rTop * 1.16, rTop: rTop * 1.02, sides })
        .translate(0, y + sh, 0));
      if (pinnacles && s < stages - 1) {
        const count = 4;
        for (let i = 0; i < count; i += 1) {
          const a = (i / count) * TAU + Math.PI / 4;
          const ph = sh * 0.42;
          const p = prism({ h: ph, rBottom: rTop * 0.17, rTop: 0.03, sides: 4, twist: Math.PI / 4 });
          p.translate(Math.cos(a) * rTop * 0.98, y + sh, Math.sin(a) * rTop * 0.98);
          geos.push(p);
        }
      }
      y += sh + courseH;
      rr = rTop;
    }
    // The normalised stage budget guarantees a positive needle and
    // makes the authored `h` the actual top instead of folding a
    // negative-height prism back through the upper stages.
    geos.push(prism({ h: needleH, rBottom: rr, rTop: 0.05, sides, segments: 3 }).translate(0, y, 0));
    return mergeGeometries(THREE, geos);
  }

  /** The imperial skull, low-poly. Cranium, brow, sockets, muzzle,
   *  jaw. Small enough to be a boss on a shield, large enough to be
   *  a fifteen-metre reliquary. */
  function skull(opts = {}) {
    const { size = 1, jaw = true } = opts;
    const s = size;
    const geos = [];

    geos.push(ringSolid([
      { y: 0.00 * s, r: 0.30 * s, sides: 7, phase: 0.2 },
      { y: 0.22 * s, r: 0.46 * s, sides: 7, phase: 0.2 },
      { y: 0.52 * s, r: 0.50 * s, sides: 7, phase: 0.35 },
      { y: 0.78 * s, r: 0.44 * s, sides: 7, phase: 0.35 },
      { y: 0.96 * s, r: 0.26 * s, sides: 7, phase: 0.5 },
      { y: 1.04 * s, r: 0.08 * s, sides: 7, phase: 0.5 },
    ]).scale(1, 1, 0.92));

    // Brow ridge - the single feature that makes a rounded lump
    // read as a skull.
    const brow = slab(0.86 * s, 0.10 * s, 0.20 * s, 0.02 * s);
    brow.translate(0, 0.56 * s, 0.40 * s);
    geos.push(brow);

    // Sockets: recessed wedges, dark by vertex colour later.
    for (const sx of [-1, 1]) {
      const eye = prism({ h: 0.20 * s, rBottom: 0.145 * s, rTop: 0.10 * s, sides: 5 });
      eye.rotateX(Math.PI / 2);
      eye.translate(sx * 0.20 * s, 0.50 * s, 0.40 * s);
      geos.push(eye);
    }

    // Muzzle and nasal aperture.
    geos.push(ringSolid([
      { y: 0.20 * s, rx: 0.26 * s, rz: 0.20 * s, sides: 6 },
      { y: 0.38 * s, rx: 0.24 * s, rz: 0.24 * s, sides: 6 },
      { y: 0.46 * s, rx: 0.18 * s, rz: 0.20 * s, sides: 6 },
    ]).translate(0, 0, 0.30 * s));
    const nose = prism({ h: 0.13 * s, rBottom: 0.06 * s, rTop: 0.015 * s, sides: 3 });
    nose.rotateX(-Math.PI * 0.5);
    nose.translate(0, 0.36 * s, 0.50 * s);
    geos.push(nose);

    if (jaw) {
      geos.push(ringSolid([
        { y: 0.06 * s, rx: 0.30 * s, rz: 0.26 * s, sides: 7 },
        { y: 0.20 * s, rx: 0.34 * s, rz: 0.30 * s, sides: 7 },
      ]).translate(0, 0, 0.10 * s));
      // Teeth as one crenellated band; individual teeth at this
      // polygon budget turn to noise past ten metres.
      for (let i = -3; i <= 3; i += 1) {
        const t = slab(0.055 * s, 0.075 * s, 0.07 * s, 0);
        t.translate(i * 0.075 * s, 0.20 * s, 0.34 * s);
        geos.push(t);
      }
    }
    return mergeGeometries(THREE, geos);
  }

  /**
   * A robed figure. The Concord marks everything it owns with one,
   * so this has to hold up as a 2m grave marker and as a 22m
   * processional colossus.
   *
   * Built as: plinth, robe (a ring stack with fold modulation),
   * shoulders, cowl, and one of a small set of attributes. The
   * folds are the whole trick - a smooth taper reads as a chess
   * piece.
   */
  function statue(rng, opts = {}) {
    const {
      h = 6, style = "sword", plinth = true, broken = 0, halo = false,
    } = opts;
    const geos = [];
    const bodyH = h * (plinth ? 0.86 : 1);
    const py = plinth ? h * 0.14 : 0;
    const sides = 9;

    if (plinth) {
      geos.push(slab(h * 0.30, h * 0.10, h * 0.30, h * 0.012));
      geos.push(slab(h * 0.25, h * 0.045, h * 0.25, h * 0.008).translate(0, h * 0.10, 0));
    }

    /* Robe. The profile is the entire silhouette argument: a smooth
       taper from hem to shoulder is a CONE, and at any distance a
       row of them reads as traffic cones on plinths. What makes a
       robed figure read is a wide hem, a sharp intake above it, a
       near-straight body, and then a decisive widening at the
       shoulders - a waist, in other words. Folds alone will not
       rescue a conical mass.

       The profile below is authored as explicit (height, radius)
       stops rather than as a lerp, so the intake stays sharp. */
    const foldPhase = rng() * TAU;
    const PROFILE = [
      [0.000, 0.182], [0.055, 0.168], [0.120, 0.126], [0.300, 0.118],
      [0.480, 0.110], [0.620, 0.102], [0.740, 0.092],
    ];
    const robe = PROFILE.map(([t, r], i) => ({
      y: py + t * bodyH,
      r: bodyH * r,
      sides,
      phase: foldPhase + t * 0.24,
      jitter: 0.085,
      seed: 41 + i * 17,
    }));
    geos.push(ringSolid(robe, { capTop: false }));

    /* A mantle over the shoulders, falling to mid-body. A second
       mass at a different radius is what stops the figure from
       being one solid of revolution. */
    geos.push(ringSolid([
      { y: py + bodyH * 0.74, r: bodyH * 0.112, sides: 7, phase: foldPhase + 0.4 },
      { y: py + bodyH * 0.62, r: bodyH * 0.148, sides: 7, phase: foldPhase + 0.5, jitter: 0.12, seed: 61 },
      { y: py + bodyH * 0.46, r: bodyH * 0.152, sides: 7, phase: foldPhase + 0.6, jitter: 0.14, seed: 63 },
      { y: py + bodyH * 0.40, r: bodyH * 0.138, sides: 7, phase: foldPhase + 0.7, jitter: 0.16, seed: 65 },
    ], { capTop: false, capBottom: false }));

    if (broken < 0.75) {
      // Shoulders and cowl.
      // Shoulders: distinctly WIDER than the body they sit on. This
      // is the waist that the whole silhouette turns on.
      const sy = py + bodyH * 0.74;
      geos.push(ringSolid([
        { y: sy, rx: bodyH * 0.096, rz: bodyH * 0.074, sides: 7, phase: foldPhase },
        { y: sy + bodyH * 0.050, rx: bodyH * 0.142, rz: bodyH * 0.098, sides: 7, phase: foldPhase + 0.2, jitter: 0.09, seed: 5 },
        { y: sy + bodyH * 0.100, rx: bodyH * 0.104, rz: bodyH * 0.080, sides: 7, phase: foldPhase + 0.3 },
      ]));

      if (broken < 0.4) {
        // Cowl: an open hood, deliberately empty. A carved face at
        // this scale is worse than no face - the shadow inside the
        // hood does the work.
        const hy = sy + bodyH * 0.100;
        geos.push(ringSolid([
          { y: hy, rx: bodyH * 0.062, rz: bodyH * 0.056, sides: 7, phase: foldPhase },
          { y: hy + bodyH * 0.052, rx: bodyH * 0.070, rz: bodyH * 0.064, sides: 7, phase: foldPhase + 0.15 },
          { y: hy + bodyH * 0.092, rx: bodyH * 0.050, rz: bodyH * 0.048, sides: 7, phase: foldPhase + 0.3 },
          { y: hy + bodyH * 0.112, rx: bodyH * 0.014, rz: bodyH * 0.014, sides: 7, phase: foldPhase + 0.4 },
        ]));
        // The void inside the hood.
        const hollow = prism({ h: bodyH * 0.055, rBottom: bodyH * 0.040, rTop: bodyH * 0.030, sides: 6 });
        hollow.rotateX(-0.34);
        hollow.translate(0, hy + bodyH * 0.030, bodyH * 0.038);
        geos.push(hollow);

        if (halo) {
          const ring = new THREE.TorusGeometry(bodyH * 0.088, bodyH * 0.010, 4, 13);
          ring.rotateX(0.22);
          ring.translate(0, hy + bodyH * 0.055, -bodyH * 0.030);
          geos.push(ring);
        }
      }
    }

    // Attribute.
    if (broken < 0.55) {
      const ay = py + bodyH * 0.30;
      if (style === "sword") {
        // Point-down greatsword, hands folded on the pommel.
        const blade = prism({ h: bodyH * 0.44, rBottom: bodyH * 0.020, rTop: bodyH * 0.006, sides: 4, twist: 0 });
        blade.rotateX(Math.PI);
        blade.translate(0, ay + bodyH * 0.44, bodyH * 0.13);
        geos.push(blade);
        const guard = slab(bodyH * 0.13, bodyH * 0.014, bodyH * 0.022, 0);
        guard.translate(0, ay + bodyH * 0.44, bodyH * 0.13);
        geos.push(guard);
        const grip = prism({ h: bodyH * 0.075, rBottom: bodyH * 0.011, rTop: bodyH * 0.013, sides: 5 });
        grip.translate(0, ay + bodyH * 0.452, bodyH * 0.13);
        geos.push(grip);
      } else if (style === "book") {
        const book = slab(bodyH * 0.10, bodyH * 0.030, bodyH * 0.075, bodyH * 0.006);
        book.rotateX(-0.28);
        book.translate(0, ay + bodyH * 0.20, bodyH * 0.10);
        geos.push(book);
      } else if (style === "censer") {
        const chain = tube([
          [0, ay + bodyH * 0.34, bodyH * 0.09],
          [bodyH * 0.02, ay + bodyH * 0.20, bodyH * 0.14],
          [bodyH * 0.03, ay + bodyH * 0.08, bodyH * 0.16],
        ], bodyH * 0.005, 3);
        geos.push(chain);
        const bowl = ringSolid([
          { y: ay + bodyH * 0.02, r: bodyH * 0.016, sides: 6 },
          { y: ay + bodyH * 0.055, r: bodyH * 0.034, sides: 6 },
          { y: ay + bodyH * 0.085, r: bodyH * 0.022, sides: 6 },
        ]);
        bowl.translate(bodyH * 0.03, 0, bodyH * 0.16);
        geos.push(bowl);
      } else if (style === "banner") {
        const pole = prism({ h: bodyH * 0.62, rBottom: bodyH * 0.010, rTop: bodyH * 0.008, sides: 5 });
        pole.translate(bodyH * 0.075, ay - bodyH * 0.12, bodyH * 0.06);
        geos.push(pole);
      }
      // Sleeves.
      for (const sx of [-1, 1]) {
        const arm = ringSolid([
          { y: 0, r: bodyH * 0.034, sides: 5 },
          { y: bodyH * 0.16, r: bodyH * 0.026, sides: 5 },
          { y: bodyH * 0.30, r: bodyH * 0.020, sides: 5 },
        ], { capTop: false });
        arm.rotateZ(sx * 0.20);
        arm.rotateX(-0.30);
        arm.translate(sx * bodyH * 0.070, ay + bodyH * 0.14, bodyH * 0.030);
        geos.push(arm);
      }
    }

    const g = mergeGeometries(THREE, geos);
    if (broken > 0.001) {
      // Shear the break so it reads as fractured rather than sawn.
      const p = g.attributes.position;
      const cut = py + bodyH * (1 - broken) * 1.05;
      for (let i = 0; i < p.count; i += 1) {
        if (p.getY(i) > cut) {
          p.setY(i, cut - Math.abs(Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3)) * bodyH * 0.03);
        }
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }
    return g;
  }

  /* ============================================================
     CLOTH
     ============================================================ */

  /**
   * A hanging banner. The geometry carries a catenary sag and a
   * standing wave across it so it reads as cloth even before the
   * vertex animation touches it - and if the animation is ever
   * turned off for performance, it still does not look like a
   * sheet of plywood.
   *
   * Returns a geometry with a `wave` attribute the VFX vertex
   * shader uses to phase the ripple.
   */
  function banner(opts = {}) {
    const {
      w = 2.4, h = 6, cols = 5, rows = 9, sag = 0.14, amp = 0.16, taper = 0.0,
      swallowtail = 0,
    } = opts;
    const pos = [];
    const wave = [];
    const idx = [];
    for (let j = 0; j <= rows; j += 1) {
      const v = j / rows;
      for (let i = 0; i <= cols; i += 1) {
        const u = i / cols;
        const cx = (u - 0.5) * w * (1 - taper * v);
        let y = -v * h;
        // Swallowtail: a V cut in the lower edge, the single most
        // recognisable heraldic silhouette.
        if (swallowtail > 0 && v > 0.999) {
          y += Math.abs(u - 0.5) * 2 * swallowtail * h * -1 + swallowtail * h;
        }
        // Catenary droop between the two top corners.
        y -= Math.sin(u * Math.PI) * sag * w * (1 - v * 0.35);
        const z = Math.sin(u * Math.PI * 2.2 + v * 1.3) * amp * (0.25 + v * 0.9);
        pos.push(cx, y, z);
        wave.push(u, v);
      }
    }
    const stride = cols + 1;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("wave", new THREE.Float32BufferAttribute(wave, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** A ribbon on a pole: the Concord's grave marker, and the thing
   *  that gives an empty dune field something to move. */
  function ribbonPole(rng, opts = {}) {
    const { h = 3.4, ribbons = 3 } = opts;
    const geos = [];
    geos.push(prism({ h, rBottom: 0.055, rTop: 0.035, sides: 5, jitter: 0.1, seed: rng.int(1, 1e6) }));
    const cross = prism({ h: 0.62, rBottom: 0.035, rTop: 0.030, sides: 4 });
    cross.rotateZ(Math.PI / 2);
    cross.translate(0, h * 0.86, 0);
    geos.push(cross);
    void ribbons;
    return mergeGeometries(THREE, geos);
  }

  /* ============================================================
     BONE
     ============================================================ */

  /**
   * A rib: from the vertebral root, out and up, then curling back
   * IN over the spine. The inward return is the whole shape - two
   * mirrored ribs then vault toward each other and the cage reads
   * as anatomy.
   *
   * A first version swept only 0.62pi with a monotonic outward x,
   * so every rib leaned outward and never came back. Mirrored, the
   * pairs splayed apart and crossed their neighbours, and 26 of
   * them read as chain-link fencing rather than as a ribcage. The
   * fix is the sweep passing 90 degrees: `sin(a)` has to come back
   * down.
   */
  function rib(opts = {}) {
    const {
      span = 40, height = 62, thickness = 1.6, twist = 0.18, lean = 0.2,
      sweep = 2.62, seed = 3,
    } = opts;
    const rng = makeRng(seed);
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const a = t * sweep;                       // radians, past pi/2
      pts.push([
        Math.sin(a) * span + rng.jit(0.5),
        (1 - Math.cos(a)) * 0.5 * height + rng.jit(0.4),
        Math.sin(t * 2.4 + twist) * span * lean * 0.20 + rng.jit(0.45),
      ]);
    }
    // Thick at the root, whip-thin at the tip.
    const g = tube(pts, thickness, 6, { taper: 0.80 });
    const head = ringSolid([
      { y: -thickness * 1.1, r: thickness * 1.5, sides: 6 },
      { y: thickness * 0.4, r: thickness * 2.3, sides: 6, phase: 0.4 },
      { y: thickness * 2.2, r: thickness * 1.4, sides: 6, phase: 0.8 },
    ]);
    return mergeGeometries(THREE, [g, head]);
  }

  /** A vertebra: centrum, transverse processes, neural spine. */
  function vertebra(opts = {}) {
    const { size = 4, spine = 1.8 } = opts;
    const s = size;
    const geos = [];
    geos.push(ringSolid([
      { y: 0, r: s * 0.62, sides: 7 },
      { y: s * 0.30, r: s * 0.78, sides: 7, phase: 0.3 },
      { y: s * 0.72, r: s * 0.58, sides: 7, phase: 0.6 },
    ]));
    const neural = prism({ h: s * spine, rBottom: s * 0.30, rTop: s * 0.07, sides: 5 });
    neural.rotateX(-0.22);
    neural.translate(0, s * 0.62, -s * 0.10);
    geos.push(neural);
    for (const sx of [-1, 1]) {
      const t = prism({ h: s * 0.95, rBottom: s * 0.22, rTop: s * 0.06, sides: 5 });
      t.rotateZ(sx * Math.PI * 0.42);
      t.translate(sx * s * 0.45, s * 0.42, 0);
      geos.push(t);
    }
    return mergeGeometries(THREE, geos);
  }

  /* ============================================================
     THE BLOOM
     ============================================================ */

  /** A chitin spire: segmented, swelling and pinching, ending in a
   *  hooked point. Organic curves against a world of hard edges. */
  function chitinSpire(rng, opts = {}) {
    const { h = 22, r = 2.6, segments = 9, hook = 0.5 } = opts;
    const rings = [];
    const leanA = rng() * TAU;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      // Segment pinches: a sine on top of the taper.
      const pinch = 1 + Math.sin(t * Math.PI * segments * 0.62) * 0.20;
      const curl = Math.pow(t, 2.4) * hook * h * 0.30;
      rings.push({
        y: t * h,
        r: r * Math.pow(1 - t, 0.72) * pinch * rng.range(0.9, 1.1),
        sides: t > 0.8 ? 5 : 7,
        phase: t * 1.4 + rng.jit(0.15),
        cx: Math.cos(leanA) * curl,
        cz: Math.sin(leanA) * curl,
        jitter: 0.09,
        seed: rng.int(1, 1e6),
      });
    }
    rings[rings.length - 1].r = r * 0.02;
    return ringSolid(rings);
  }

  /** A membrane sac: a swollen, translucent bladder on a stalk. */
  function membraneSac(rng, opts = {}) {
    const { r = 3, h = 5 } = opts;
    const rings = [];
    const steps = 7;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      rings.push({
        y: t * h,
        r: r * Math.sin(Math.pow(t, 0.72) * Math.PI) * rng.range(0.88, 1.12) + r * 0.06,
        sides: 8,
        phase: t * 0.7,
        jitter: 0.10,
        seed: rng.int(1, 1e6),
      });
    }
    return ringSolid(rings);
  }

  /* ============================================================
     INDUSTRY
     ============================================================ */

  /** A cracking tower: a stepped cylinder stack with an external
   *  ladder run and a flared crown. */
  function crackingTower(rng, opts = {}) {
    const { h = 30, r = 3.6, stages = 3 } = opts;
    const geos = [];
    let y = 0;
    let rr = r;
    for (let s = 0; s < stages; s += 1) {
      const sh = h / stages * rng.range(0.85, 1.15);
      geos.push(prism({ h: sh, rBottom: rr, rTop: rr * 0.9, sides: 9, segments: 1 }).translate(0, y, 0));
      geos.push(prism({ h: h * 0.018, rBottom: rr * 1.14, rTop: rr * 1.1, sides: 9 })
        .translate(0, y + sh - h * 0.018, 0));
      y += sh;
      rr *= 0.9;
    }
    geos.push(prism({ h: h * 0.08, rBottom: rr * 1.3, rTop: rr * 0.8, sides: 9 }).translate(0, y, 0));
    // Ladder cage.
    const rungs = Math.floor(h / 1.6);
    for (let i = 0; i < rungs; i += 1) {
      const g = slab(0.09, 0.09, 0.58, 0);
      g.translate(r * 1.28, i * 1.6 + 0.6, 0);
      geos.push(g);
    }
    geos.push(prism({ h, rBottom: 0.07, rTop: 0.07, sides: 4 }).translate(r * 1.28, 0, 0.22));
    geos.push(prism({ h, rBottom: 0.07, rTop: 0.07, sides: 4 }).translate(r * 1.28, 0, -0.22));
    return mergeGeometries(THREE, geos);
  }

  /** A flare stack: a lattice mast with a burner head. */
  function flareStack(opts = {}) {
    const { h = 46, base = 3.2, legs = 4 } = opts;
    const geos = [];
    for (let i = 0; i < legs; i += 1) {
      const a = (i / legs) * TAU + Math.PI / 4;
      const pts = [];
      const steps = 6;
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        const rr = lerp(base, base * 0.28, t);
        pts.push([Math.cos(a) * rr, t * h, Math.sin(a) * rr]);
      }
      geos.push(tube(pts, 0.20, 4));
    }
    // Bracing: an X between every pair of adjacent legs, per level.
    const levels = 9;
    for (let l = 0; l < levels; l += 1) {
      const t0 = l / levels;
      const t1 = (l + 1) / levels;
      for (let i = 0; i < legs; i += 1) {
        const a0 = (i / legs) * TAU + Math.PI / 4;
        const a1 = ((i + 1) / legs) * TAU + Math.PI / 4;
        const r0 = lerp(base, base * 0.28, t0);
        const r1 = lerp(base, base * 0.28, t1);
        geos.push(tube([
          [Math.cos(a0) * r0, t0 * h, Math.sin(a0) * r0],
          [Math.cos(a1) * r1, t1 * h, Math.sin(a1) * r1],
        ], 0.085, 3));
        geos.push(tube([
          [Math.cos(a1) * r0, t0 * h, Math.sin(a1) * r0],
          [Math.cos(a0) * r1, t1 * h, Math.sin(a0) * r1],
        ], 0.085, 3));
      }
    }
    geos.push(prism({ h: h * 0.10, rBottom: base * 0.34, rTop: base * 0.46, sides: 7 }).translate(0, h, 0));
    geos.push(prism({ h: h * 0.035, rBottom: base * 0.52, rTop: base * 0.40, sides: 7 })
      .translate(0, h + h * 0.10, 0));
    return mergeGeometries(THREE, geos);
  }

  /** A storage tank with a domed head and a wall of stiffener ribs. */
  function tank(opts = {}) {
    const { r = 7, h = 9, ribs = 12 } = opts;
    const geos = [];
    geos.push(prism({ h, rBottom: r, rTop: r, sides: 13 }));
    geos.push(ringSolid([
      { y: h, r, sides: 13 },
      { y: h + r * 0.22, r: r * 0.82, sides: 13, phase: 0.12 },
      { y: h + r * 0.34, r: r * 0.42, sides: 13, phase: 0.24 },
      { y: h + r * 0.38, r: r * 0.10, sides: 13, phase: 0.3 },
    ]));
    for (let i = 0; i < ribs; i += 1) {
      const a = (i / ribs) * TAU;
      const g = slab(0.16, h, 0.42, 0);
      g.rotateY(-a);
      g.translate(Math.cos(a) * r * 1.01, 0, Math.sin(a) * r * 1.01);
      geos.push(g);
    }
    geos.push(prism({ h: 0.5, rBottom: r * 1.14, rTop: r * 1.06, sides: 13 }).translate(0, -0.3, 0));
    return mergeGeometries(THREE, geos);
  }

  /** A catwalk run with handrails. */
  function catwalk(points, opts = {}) {
    const { width = 1.6, rail = 1.05 } = opts;
    const geos = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < 0.05) continue;
      const yaw = Math.atan2(b[2] - a[2], b[0] - a[0]);
      // Each piece is built spanning local x in [0, len], then
      // rotated about the origin and moved onto the run's start
      // point. Geometry rotate/translate both act about the origin,
      // so the order here is the whole correctness argument: build,
      // rotate, then place.
      const place = (g) => {
        g.rotateY(-yaw);
        g.translate(a[0], a[1], a[2]);
        geos.push(g);
      };
      place(slab(len, 0.14, width, 0.03).translate(len / 2, 0, 0));
      for (const s of [-1, 1]) {
        place(slab(len, 0.07, 0.07, 0).translate(len / 2, rail, s * width / 2));
        const posts = Math.max(2, Math.round(len / 2.2));
        for (let k = 0; k <= posts; k += 1) {
          place(slab(0.07, rail, 0.07, 0).translate((k / posts) * len, 0, s * width / 2));
        }
      }
    }
    return mergeGeometries(THREE, geos);
  }

  /* ============================================================
     FIELD WORKS
     ============================================================ */

  /** A run of sandbags: two or three courses, staggered, with the
   *  bags themselves as squashed hexagonal pillows. */
  function sandbagWall(rng, opts = {}) {
    const { length = 8, courses = 3, bagW = 0.62, bagH = 0.26 } = opts;
    const geos = [];
    const perCourse = Math.max(2, Math.round(length / bagW));
    for (let c = 0; c < courses; c += 1) {
      const inset = c * 0.045;
      // The top course is short and ragged - a revetment that runs
      // full length on every course reads as machine-made, and a
      // stack of identical pillows reads as bubble wrap.
      const runFrac = c === courses - 1 ? rng.range(0.45, 0.85) : rng.range(0.9, 1.0);
      const drop = rng() * (1 - runFrac) * length;
      for (let i = 0; i < perCourse; i += 1) {
        const x = (i - (perCourse - 1) / 2) * bagW + (c % 2 ? bagW * 0.5 : 0)
          + rng.jit(bagW * 0.10);
        if (Math.abs(x) > length / 2) continue;
        if (x < -length / 2 + drop || x > -length / 2 + drop + runFrac * length) continue;
        const s = rng.range(0.82, 1.18);
        const bag = ringSolid([
          { y: 0, rx: bagW * 0.44 * s, rz: (0.30 - inset) * s, sides: 6, phase: rng() * 3 },
          { y: bagH * 0.5 * s, rx: bagW * 0.54 * s, rz: (0.37 - inset) * s, sides: 6, phase: rng() * 3, jitter: 0.16, seed: rng.int(1, 1e6) },
          { y: bagH * s, rx: bagW * 0.38 * s, rz: (0.25 - inset) * s, sides: 6, phase: rng() * 3 },
        ]);
        bag.rotateZ(rng.jit(0.10));
        bag.rotateY(rng.jit(0.24));
        bag.translate(x, c * bagH * 0.90 + rng.jit(0.03), rng.jit(0.09));
        geos.push(bag);
      }
    }
    return mergeGeometries(THREE, geos);
  }

  /** Concertina wire on angle-iron pickets, as a merged run. */
  function wireRun(rng, opts = {}) {
    const { length = 12, height = 1.1, coils = 22 } = opts;
    const geos = [];
    const pickets = Math.max(2, Math.round(length / 3));
    for (let i = 0; i <= pickets; i += 1) {
      const p = prism({ h: height * 1.25, rBottom: 0.05, rTop: 0.04, sides: 3 });
      p.translate((i / pickets - 0.5) * length, 0, rng.jit(0.12));
      geos.push(p);
    }
    const pts = [];
    for (let i = 0; i <= coils * 6; i += 1) {
      const t = i / (coils * 6);
      const a = t * coils * TAU;
      pts.push([
        (t - 0.5) * length,
        height * 0.55 + Math.sin(a) * height * 0.4,
        Math.cos(a) * height * 0.4 + rng.jit(0.03),
      ]);
    }
    geos.push(tube(pts, 0.028, 3));
    return mergeGeometries(THREE, geos);
  }

  /** A firing-step bunker: a low concrete box with a horizontal
   *  embrasure and a sloped roof. */
  function bunker(opts = {}) {
    const { w = 7, d = 5, h = 2.8, slit = 0.55 } = opts;
    const geos = [];
    const wall = 0.7;
    // Back and sides solid; the front is split by the embrasure.
    geos.push(slab(w, h, wall, 0.08).translate(0, 0, -d / 2));
    geos.push(slab(wall, h, d, 0.08).translate(-w / 2, 0, 0));
    geos.push(slab(wall, h, d, 0.08).translate(w / 2, 0, 0));
    geos.push(slab(w, h * 0.45, wall, 0.08).translate(0, 0, d / 2));
    geos.push(slab(w, h - h * 0.45 - slit, wall, 0.08)
      .translate(0, h * 0.45 + slit, d / 2));
    // Roof slab, oversailing, with a sand berm shape on top.
    geos.push(slab(w * 1.16, 0.55, d * 1.16, 0.12).translate(0, h, 0));
    geos.push(ringSolid([
      { y: h + 0.55, rx: w * 0.56, rz: d * 0.56, sides: 6, phase: 0.4 },
      { y: h + 1.35, rx: w * 0.40, rz: d * 0.38, sides: 6, phase: 0.7, jitter: 0.12, seed: 21 },
    ]));
    return mergeGeometries(THREE, geos);
  }

  /* ============================================================
     THE SAINT
     ============================================================ */

  /**
   * A colossal death-mask head. Not a face: a smooth helm with two
   * long vertical eye slits, a crest, and a laurel band. Anonymous
   * faces are more monumental than portrait ones at this scale, and
   * they survive being viewed from the ground - which is the only
   * angle anyone will ever see this from.
   */
  function saintHead(opts = {}) {
    const { size = 30 } = opts;
    const s = size;
    const geos = [];

    /* Cranium. Narrow through the jaw, widest at the cheekbones,
       and noticeably deeper front-to-back than it is wide - a head
       modelled on a sphere reads as a pumpkin no matter what is
       carved onto the front of it. The 0.78 width factor is doing
       most of the work here. */
    geos.push(ringSolid([
      { y: -0.06 * s, rx: 0.15 * s, rz: 0.20 * s, sides: 9, phase: 0.2 },
      { y: 0.08 * s, rx: 0.25 * s, rz: 0.33 * s, sides: 9, phase: 0.2 },
      { y: 0.26 * s, rx: 0.34 * s, rz: 0.45 * s, sides: 9, phase: 0.3 },
      { y: 0.48 * s, rx: 0.41 * s, rz: 0.53 * s, sides: 9, phase: 0.35 },
      { y: 0.68 * s, rx: 0.42 * s, rz: 0.54 * s, sides: 9, phase: 0.35 },
      { y: 0.88 * s, rx: 0.37 * s, rz: 0.47 * s, sides: 9, phase: 0.5 },
      { y: 1.02 * s, rx: 0.24 * s, rz: 0.31 * s, sides: 9, phase: 0.5 },
      { y: 1.08 * s, rx: 0.08 * s, rz: 0.10 * s, sides: 9, phase: 0.6 },
    ]));

    // Chin: the head has to end in something, or the underside
    // reads as where the model was cut off.
    geos.push(ringSolid([
      { y: -0.14 * s, rx: 0.09 * s, rz: 0.13 * s, sides: 7 },
      { y: -0.02 * s, rx: 0.17 * s, rz: 0.26 * s, sides: 7, phase: 0.3 },
      { y: 0.12 * s, rx: 0.22 * s, rz: 0.34 * s, sides: 7, phase: 0.5 },
    ]).translate(0, 0, 0.06 * s));

    // Face plate: a flatter panel proud of the cranium, so the
    // front reads as worked metal and the back as a shell.
    const face = ringSolid([
      { y: 0.06 * s, rx: 0.24 * s, rz: 0.10 * s, sides: 7 },
      { y: 0.30 * s, rx: 0.34 * s, rz: 0.13 * s, sides: 7 },
      { y: 0.58 * s, rx: 0.38 * s, rz: 0.14 * s, sides: 7 },
      { y: 0.82 * s, rx: 0.33 * s, rz: 0.12 * s, sides: 7 },
    ]);
    face.translate(0, 0, 0.44 * s);
    geos.push(face);

    // Nose ridge, running from brow to chin as one blade.
    const ridge = extrudeZ([
      [0, 0.10 * s], [0.055 * s, 0.30 * s], [0.05 * s, 0.66 * s],
      [0, 0.78 * s], [-0.05 * s, 0.66 * s], [-0.055 * s, 0.30 * s],
    ], 0.14 * s);
    ridge.translate(0, 0, 0.53 * s);
    geos.push(ridge);

    // Eye slits: deep recessed wedges. The darkness inside is the
    // expression.
    for (const sx of [-1, 1]) {
      const eye = prism({ h: 0.16 * s, rBottom: 0.045 * s, rTop: 0.02 * s, sides: 4 });
      eye.scale(1, 1, 2.6);
      eye.rotateX(Math.PI / 2);
      eye.rotateZ(sx * 0.16);
      eye.translate(sx * 0.16 * s, 0.60 * s, 0.50 * s);
      geos.push(eye);
    }

    // Cheek buttresses.
    for (const sx of [-1, 1]) {
      const c = prism({ h: 0.34 * s, rBottom: 0.09 * s, rTop: 0.05 * s, sides: 5 });
      c.rotateZ(sx * 0.30);
      c.rotateX(0.14);
      c.translate(sx * 0.31 * s, 0.16 * s, 0.36 * s);
      geos.push(c);
    }

    /* Laurel band: overlapping leaf wedges around the brow. They lie
       ALONG the band rather than standing off it - a first pass had
       them radiating outward at 30 degrees and from any distance the
       head grew a crown of spikes that read as horns. A laurel is
       flat to the skull; only the tips lift. */
    const leaves = 26;
    for (let i = 0; i < leaves; i += 1) {
      const a = (i / leaves) * TAU;
      const leaf = prism({ h: 0.155 * s, rBottom: 0.030 * s, rTop: 0.005 * s, sides: 4 });
      leaf.scale(1, 1, 0.40);
      leaf.rotateZ(Math.PI * 0.5);       // lie the leaf down
      leaf.rotateX(-0.16);               // tip lifts slightly
      leaf.rotateY(-a + 0.30);
      leaf.translate(Math.cos(a) * 0.495 * s, 0.795 * s, Math.sin(a) * 0.515 * s);
      geos.push(leaf);
    }
    geos.push(ringSolid([
      { y: 0.76 * s, rx: 0.505 * s, rz: 0.525 * s, sides: 11 },
      { y: 0.82 * s, rx: 0.515 * s, rz: 0.535 * s, sides: 11, phase: 0.1 },
    ], { capTop: false, capBottom: false }));

    // Crest fin along the crown.
    const crest = extrudeZ([
      [-0.42 * s, 0.92 * s], [-0.20 * s, 1.16 * s], [0.10 * s, 1.22 * s],
      [0.38 * s, 1.05 * s], [0.36 * s, 0.96 * s], [-0.40 * s, 0.86 * s],
    ], 0.09 * s);
    crest.rotateY(Math.PI / 2);
    geos.push(crest);

    return mergeGeometries(THREE, geos);
  }

  /** A colossal hand, fingers half-curled, reaching upward. */
  function saintHand(opts = {}) {
    const { size = 20, curl = 0.55 } = opts;
    const s = size;
    const geos = [];

    // Palm: a thick tapered slab, wrist end narrower.
    geos.push(ringSolid([
      { y: 0, rx: 0.24 * s, rz: 0.16 * s, sides: 7 },
      { y: 0.28 * s, rx: 0.32 * s, rz: 0.20 * s, sides: 7, phase: 0.2 },
      { y: 0.62 * s, rx: 0.36 * s, rz: 0.19 * s, sides: 7, phase: 0.3 },
      { y: 0.80 * s, rx: 0.33 * s, rz: 0.16 * s, sides: 7, phase: 0.4 },
    ]));

    // Four fingers, three phalanges each, curling toward the palm.
    for (let f = 0; f < 4; f += 1) {
      const spread = (f - 1.5) * 0.20 * s;
      const lenScale = [0.86, 1.0, 0.96, 0.78][f];
      let y = 0.80 * s;
      let x = spread;
      let z = 0;
      let angle = -0.10 - curl * 0.25;
      for (let p = 0; p < 3; p += 1) {
        const pl = 0.26 * s * lenScale * (1 - p * 0.20);
        const pr = 0.062 * s * (1 - p * 0.16);
        const seg = ringSolid([
          { y: 0, r: pr * 1.14, sides: 6 },
          { y: pl * 0.22, r: pr, sides: 6, phase: 0.2 },
          { y: pl * 0.82, r: pr * 0.95, sides: 6, phase: 0.4 },
          { y: pl, r: pr * 1.10, sides: 6, phase: 0.6 },
        ]);
        seg.rotateX(angle);
        seg.translate(x, y, z);
        geos.push(seg);
        y += Math.cos(angle) * pl;
        z += -Math.sin(angle) * pl;
        angle += curl * 0.55;
      }
    }

    // Thumb, off the side and rotated across.
    let ty = 0.34 * s;
    let tx = -0.34 * s;
    let tz = 0.06 * s;
    let ta = -0.5;
    for (let p = 0; p < 2; p += 1) {
      const pl = 0.24 * s * (1 - p * 0.18);
      const pr = 0.072 * s * (1 - p * 0.15);
      const seg = ringSolid([
        { y: 0, r: pr * 1.1, sides: 6 },
        { y: pl, r: pr * 0.92, sides: 6, phase: 0.4 },
      ]);
      seg.rotateZ(-0.95);
      seg.rotateX(ta);
      seg.translate(tx, ty, tz);
      geos.push(seg);
      tx += Math.sin(0.95) * pl * 0.9;
      ty += Math.cos(0.95) * pl * 0.7;
      ta += 0.35;
      void p;
    }

    // Wrist stump, torn.
    geos.push(ringSolid([
      { y: -0.40 * s, rx: 0.19 * s, rz: 0.15 * s, sides: 8, jitter: 0.22, seed: 77 },
      { y: -0.16 * s, rx: 0.22 * s, rz: 0.16 * s, sides: 8, phase: 0.3 },
      { y: 0.02 * s, rx: 0.24 * s, rz: 0.16 * s, sides: 8, phase: 0.5 },
    ]));

    return mergeGeometries(THREE, geos);
  }

  /* ============================================================
     UTILITIES
     ============================================================ */

  function transform(geo, opts = {}) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = opts.rot
      ? new THREE.Euler(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0)
      : new THREE.Euler();
    q.setFromEuler(e);
    const s = opts.scale === undefined
      ? new THREE.Vector3(1, 1, 1)
      : (typeof opts.scale === "number"
        ? new THREE.Vector3(opts.scale, opts.scale, opts.scale)
        : new THREE.Vector3(...opts.scale));
    m.compose(new THREE.Vector3(...(opts.pos || [0, 0, 0])), q, s);
    geo.applyMatrix4(m);
    return geo;
  }

  /** Push a geometry's vertices outward along a noise field, so a
   *  merged mass of primitives stops looking like primitives. */
  function roughen(geo, amount = 0.2, scale = 0.4) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = Math.sin(x * scale * 1.7 + y * scale * 2.3)
        * Math.cos(z * scale * 1.9 - y * scale * 1.1);
      p.setXYZ(i, x + n * amount, y + n * amount * 0.55, z + n * amount);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  return {
    ringSolid, prism, slab, polyExtrudeY, extrudeZ, ribbonSolid, tube,
    crag, shard, boulderField,
    archOutline, gothicArch, column, flyingButtress, spire, skull, statue,
    banner, ribbonPole,
    rib, vertebra,
    chitinSpire, membraneSac,
    crackingTower, flareStack, tank, catwalk,
    sandbagWall, wireRun, bunker,
    saintHead, saintHand,
    transform, roughen, merge: (list) => mergeGeometries(THREE, list),
  };
}

/**
 * Drop zero-area triangles and any vertex left unreferenced.
 *
 * Applied once per merged mesh rather than in each builder, because
 * there are a dozen builders and only one place they all pass
 * through. Zero-area triangles arise wherever a primitive closes to a
 * point - a cone tip, a spire apex, a ring of radius 0 - since
 * distinct INDICES there still share one POSITION. They cost vertex
 * processing for nothing, and a vertex whose faces are all degenerate
 * gets a zero-length normal from computeVertexNormals, which
 * normalises to NaN and travels into lighting and the bloom chain.
 *
 * An audit found 18,926 of them across the level, 21% of every
 * scatter mesh.
 */
export function cleanGeometry(THREE, geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos) return geo;
  const count = idx ? idx.count : pos.count;
  const at = (i) => (idx ? idx.getX(i) : i);

  const kept = [];
  for (let t = 0; t < count; t += 3) {
    const i0 = at(t);
    const i1 = at(t + 1);
    const i2 = at(t + 2);
    const ax = pos.getX(i0); const ay = pos.getY(i0); const az = pos.getZ(i0);
    const ux = pos.getX(i1) - ax;
    const uy = pos.getY(i1) - ay;
    const uz = pos.getZ(i1) - az;
    const vx = pos.getX(i2) - ax;
    const vy = pos.getY(i2) - ay;
    const vz = pos.getZ(i2) - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
    kept.push(i0, i1, i2);
  }

  const remap = new Int32Array(pos.count).fill(-1);
  let next = 0;
  for (let i = 0; i < kept.length; i += 1) {
    if (remap[kept[i]] === -1) { remap[kept[i]] = next; next += 1; }
  }
  if (next === pos.count && kept.length === count) return geo;

  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.attributes[name];
    const size = src.itemSize;
    const dst = new Float32Array(next * size);
    for (let v = 0; v < pos.count; v += 1) {
      const to = remap[v];
      if (to === -1) continue;
      for (let c = 0; c < size; c += 1) dst[to * size + c] = src.array[v * size + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, size));
  }
  out.setIndex(kept.map((i) => remap[i]));
  if (!geo.attributes.normal) out.computeVertexNormals();
  return out;
}

export { mergeGeometries };
