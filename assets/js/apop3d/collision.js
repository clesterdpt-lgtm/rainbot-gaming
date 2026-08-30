/* ============================================================
   APOP DEMON MOGGERS 3D - collision

   Static world queries against the triangles the course actually
   shipped, indexed by a BVH built at load.

   WHY TRIANGLES AND NOT A SOLIDITY GRID
   SAINTFALL rasterises its world into a 1m grid because it is two
   kilometres of mostly empty dune and nothing there needs a surface
   normal finer than "wall or floor". A platformer is the opposite
   shape of problem. Courses are small, dense and vertical, and the
   moveset branches on the exact surface under the feet: 30 degrees
   is a run-up, 60 degrees is a slide, and a grid cell cannot tell
   them apart. Ground material drives footstep dust and audio, and
   ice changes the friction model. All of that is per-triangle data,
   so the collider has to be the triangles.

   WHY NOT three-mesh-bvh
   boot.js pulls three from a CDN with one fallback and vendors
   nothing else. A second CDN import on the boot path buys a new way
   for the game to fail to start, in exchange for code that fits in
   this file.

   WHY THREE COMES FROM ctx
   This module never imports "three". Everything it needs is
   ctx.THREE.Vector3 plus plain reads of mesh.geometry and
   mesh.matrixWorld.elements. That keeps the module loadable under
   plain node, which is the only way the physics integrator can be
   regression-tested without a WebGL context.

   Result objects are POOLED. Every one of these queries runs dozens
   of times per frame per body; a fresh Vector3 per query is a GC
   hitch with the player's name on it. Copy anything you keep.
   ============================================================ */

import { clamp, clamp01 } from "apop3d/core.js";

const LEAF_SIZE = 4;
const MAX_DEPTH = 40;
const BIN_COUNT = 12;
const BOUND_PAD = 1e-4;      // node bounds are Float32; pad past rounding
const MAX_CONTACTS = 48;
const DEFAULT_MATERIAL = "stone";

/* A surface only counts as ground if it is not a wall. Anything
   flatter than this is a candidate floor even if it is far too steep
   to walk on - physics decides walk-vs-slide from the angle, and it
   cannot decide anything about a surface collision never reported. */
const GROUND_MIN_NY = 0.0175;   // cos(89 degrees)

/* ------------------------------------------------------------------
   Scratch. Module-level so the geometric predicates below allocate
   nothing; they are called once per candidate triangle per query.
   ------------------------------------------------------------------ */

const _tri = new Float64Array(9);
const _cp = new Float64Array(3);      // closest point on triangle
const _cq = new Float64Array(3);      // closest point on segment
const _hitN = new Float64Array(3);
const _contact = new Float64Array(8); // depth, nx,ny,nz, px,py,pz, face

/** Closest point on triangle abc to p. Ericson, voronoi regions. */
function closestPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return 0; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return 0; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v;
    return 0;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return 0; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w;
    return 0;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w;
    return 0;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
  return 1;   // strictly inside the face
}

/** Closest points between segments p1->q1 and p2->q2. Ericson. */
function closestSegmentSegment(p1x, p1y, p1z, q1x, q1y, q1z,
  p2x, p2y, p2z, q2x, q2y, q2z, outA, outB) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  outA[0] = p1x + d1x * s; outA[1] = p1y + d1y * s; outA[2] = p1z + d1z * s;
  outB[0] = p2x + d2x * t; outB[1] = p2y + d2y * t; outB[2] = p2z + d2z * t;
}

/** Moller-Trumbore. Returns t or -1. Double sided on purpose: level
 *  geometry is authored by several builders and a flipped winding
 *  must not become a hole the player falls through. */
function rayTriangle(ox, oy, oz, dx, dy, dz,
  ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/** Unnormalised triangle normal into _hitN. */
function triNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) { _hitN[0] = 0; _hitN[1] = 1; _hitN[2] = 0; return 0; }
  _hitN[0] = nx / len; _hitN[1] = ny / len; _hitN[2] = nz / len;
  return len;
}

/**
 * Capsule segment vs triangle, into _contact as
 * [depth, nx, ny, nz, px, py, pz, faceContact].
 *
 * Two cases, and the second one is the one that is easy to forget:
 * if the capsule's AXIS passes clean through the triangle, every
 * closest-point candidate reports a healthy positive distance and
 * the wall is silently not there. That is the tunnelling bug that
 * survives substepping, because a corner can put the axis through a
 * face without the endpoints ever being close to it.
 */
function capsuleTriangle(s0x, s0y, s0z, s1x, s1y, s1z, radius,
  ax, ay, az, bx, by, bz, cx, cy, cz) {
  triNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
  const nx = _hitN[0], ny = _hitN[1], nz = _hitN[2];
  const d0 = (s0x - ax) * nx + (s0y - ay) * ny + (s0z - az) * nz;
  const d1 = (s1x - ax) * nx + (s1y - ay) * ny + (s1z - az) * nz;

  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    const ix = s0x + (s1x - s0x) * t;
    const iy = s0y + (s1y - s0y) * t;
    const iz = s0z + (s1z - s0z) * t;
    if (closestPointTriangle(ix, iy, iz, ax, ay, az, bx, by, bz, cx, cy, cz, _cp) === 1) {
      // Axis is through the face. Eject toward whichever side holds
      // more of the capsule; with no motion history that is the only
      // defensible guess, and substepping keeps it rare.
      const sgn = Math.abs(d0) >= Math.abs(d1) ? Math.sign(d0) : Math.sign(d1);
      _contact[0] = radius + Math.min(Math.abs(d0), Math.abs(d1));
      _contact[1] = nx * sgn; _contact[2] = ny * sgn; _contact[3] = nz * sgn;
      _contact[4] = ix; _contact[5] = iy; _contact[6] = iz;
      _contact[7] = 1;
      return true;
    }
  }

  let best = Infinity;
  let bpx = 0, bpy = 0, bpz = 0, bsx = 0, bsy = 0, bsz = 0, bface = 0;
  const consider = (sx, sy, sz, px, py, pz, face) => {
    const ddx = sx - px, ddy = sy - py, ddz = sz - pz;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d >= best) return;
    best = d; bsx = sx; bsy = sy; bsz = sz; bpx = px; bpy = py; bpz = pz; bface = face;
  };

  let face = closestPointTriangle(s0x, s0y, s0z, ax, ay, az, bx, by, bz, cx, cy, cz, _cp);
  consider(s0x, s0y, s0z, _cp[0], _cp[1], _cp[2], face);
  face = closestPointTriangle(s1x, s1y, s1z, ax, ay, az, bx, by, bz, cx, cy, cz, _cp);
  consider(s1x, s1y, s1z, _cp[0], _cp[1], _cp[2], face);

  closestSegmentSegment(s0x, s0y, s0z, s1x, s1y, s1z, ax, ay, az, bx, by, bz, _cq, _cp);
  consider(_cq[0], _cq[1], _cq[2], _cp[0], _cp[1], _cp[2], 0);
  closestSegmentSegment(s0x, s0y, s0z, s1x, s1y, s1z, bx, by, bz, cx, cy, cz, _cq, _cp);
  consider(_cq[0], _cq[1], _cq[2], _cp[0], _cp[1], _cp[2], 0);
  closestSegmentSegment(s0x, s0y, s0z, s1x, s1y, s1z, cx, cy, cz, ax, ay, az, _cq, _cp);
  consider(_cq[0], _cq[1], _cq[2], _cp[0], _cp[1], _cp[2], 0);

  if (best >= radius * radius) return false;
  const dist = Math.sqrt(best);
  let ox = bsx - bpx, oy = bsy - bpy, oz = bsz - bpz;
  if (dist > 1e-7) { ox /= dist; oy /= dist; oz /= dist; }
  else {
    // Touching exactly: fall back to the face normal, oriented by
    // whichever side the capsule's first endpoint sits on.
    const sgn = d0 >= 0 ? 1 : -1;
    ox = nx * sgn; oy = ny * sgn; oz = nz * sgn;
  }
  _contact[0] = radius - dist;
  _contact[1] = ox; _contact[2] = oy; _contact[3] = oz;
  _contact[4] = bpx; _contact[5] = bpy; _contact[6] = bpz;
  _contact[7] = bface;
  return true;
}

/**
 * Swept sphere vs triangle. Returns t in [0, maxT] or -1, normal in
 * _hitN, contact point in _cp.
 *
 * Plane sweep first, then the three edge cylinders and three vertex
 * spheres. Dropping the edge/vertex quadratics is the usual shortcut
 * and it is exactly what makes a camera sphere snag on a corner and
 * then pop through it.
 */
function sweepSphereTriangle(ox, oy, oz, dx, dy, dz, radius, maxT,
  ax, ay, az, bx, by, bz, cx, cy, cz) {
  triNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
  let nx = _hitN[0], ny = _hitN[1], nz = _hitN[2];
  let sd = (ox - ax) * nx + (oy - ay) * ny + (oz - az) * nz;
  if (sd < 0) { nx = -nx; ny = -ny; nz = -nz; sd = -sd; }
  const vn = dx * nx + dy * ny + dz * nz;

  let bestT = -1;
  if (sd <= radius) bestT = 0;
  else if (vn < -1e-9) {
    const t = (sd - radius) / -vn;
    if (t >= 0 && t <= maxT) {
      const px = ox + dx * t - nx * radius;
      const py = oy + dy * t - ny * radius;
      const pz = oz + dz * t - nz * radius;
      if (closestPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, _cq) === 1) {
        _hitN[0] = nx; _hitN[1] = ny; _hitN[2] = nz;
        _cp[0] = px; _cp[1] = py; _cp[2] = pz;
        return t;
      }
    }
  }
  if (bestT === 0) {
    closestPointTriangle(ox, oy, oz, ax, ay, az, bx, by, bz, cx, cy, cz, _cp);
    let ex = ox - _cp[0], ey = oy - _cp[1], ez = oz - _cp[2];
    const l = Math.hypot(ex, ey, ez);
    if (l > 1e-7) { _hitN[0] = ex / l; _hitN[1] = ey / l; _hitN[2] = ez / l; }
    else { _hitN[0] = nx; _hitN[1] = ny; _hitN[2] = nz; }
    return 0;
  }

  const r2 = radius * radius;
  const dd = dx * dx + dy * dy + dz * dz;
  if (dd < 1e-12) return -1;
  let hitT = -1;
  let hx = 0, hy = 0, hz = 0;

  const vertex = (vx, vy, vz) => {
    const mx = ox - vx, my = oy - vy, mz = oz - vz;
    const b = mx * dx + my * dy + mz * dz;
    const c = mx * mx + my * my + mz * mz - r2;
    const disc = b * b - dd * c;
    if (disc < 0) return;
    const t = (-b - Math.sqrt(disc)) / dd;
    if (t < 0 || t > maxT) return;
    if (hitT >= 0 && t >= hitT) return;
    hitT = t; hx = vx; hy = vy; hz = vz;
  };
  const edge = (p0x, p0y, p0z, p1x, p1y, p1z) => {
    const ex = p1x - p0x, ey = p1y - p0y, ez = p1z - p0z;
    const mx = ox - p0x, my = oy - p0y, mz = oz - p0z;
    const ee = ex * ex + ey * ey + ez * ez;
    if (ee < 1e-12) return;
    const ed = ex * dx + ey * dy + ez * dz;
    const em = ex * mx + ey * my + ez * mz;
    const A = ee * dd - ed * ed;
    const B = ee * (mx * dx + my * dy + mz * dz) - em * ed;
    const C = ee * (mx * mx + my * my + mz * mz - r2) - em * em;
    if (Math.abs(A) < 1e-12) return;
    const disc = B * B - A * C;
    if (disc < 0) return;
    const t = (-B - Math.sqrt(disc)) / A;
    if (t < 0 || t > maxT) return;
    if (hitT >= 0 && t >= hitT) return;
    const s = (ed * t + em) / ee;
    if (s < 0 || s > 1) return;
    hitT = t; hx = p0x + ex * s; hy = p0y + ey * s; hz = p0z + ez * s;
  };

  vertex(ax, ay, az); vertex(bx, by, bz); vertex(cx, cy, cz);
  edge(ax, ay, az, bx, by, bz);
  edge(bx, by, bz, cx, cy, cz);
  edge(cx, cy, cz, ax, ay, az);
  if (hitT < 0) return -1;

  const px = ox + dx * hitT, py = oy + dy * hitT, pz = oz + dz * hitT;
  let mx = px - hx, my = py - hy, mz = pz - hz;
  const l = Math.hypot(mx, my, mz) || 1;
  _hitN[0] = mx / l; _hitN[1] = my / l; _hitN[2] = mz / l;
  _cp[0] = hx; _cp[1] = hy; _cp[2] = hz;
  return hitT;
}

/* ------------------------------------------------------------------
   The BVH.

   Binned SAH over 12 bins on all three axes, median split as the
   fallback so no node can ever get a degenerate child. Flat typed
   arrays rather than objects: a course is tens of thousands of
   triangles and the build has to disappear inside a level load.
   ------------------------------------------------------------------ */

class TriSoup {
  constructor() {
    this.count = 0;
    this.pos = null;     // Float32Array, 9 per triangle
    this.mat = null;     // Uint16Array, index into the material table
    this.flags = null;   // Uint8Array, bit 0 = one-way
    this.owner = null;   // Uint32Array, index into the mesh table
    this.idx = null;     // Uint32Array, triangles in BVH leaf order
    this.nodeMin = null;
    this.nodeMax = null;
    this.nodeLeft = null;
    this.nodeStart = null;
    this.nodeCount = null;
    this.nodes = 0;
    this.stack = new Int32Array(96);
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  alloc(count) {
    this.count = count;
    this.pos = new Float32Array(count * 9);
    this.mat = new Uint16Array(count);
    this.flags = new Uint8Array(count);
    this.owner = new Uint32Array(count);
  }

  build() {
    const n = this.count;
    this.nodes = 0;
    if (!n) return;
    const cap = 2 * n + 1;
    this.idx = new Uint32Array(n);
    this.nodeMin = new Float32Array(cap * 3);
    this.nodeMax = new Float32Array(cap * 3);
    this.nodeLeft = new Int32Array(cap).fill(-1);
    this.nodeStart = new Int32Array(cap);
    this.nodeCount = new Int32Array(cap);

    const cent = new Float32Array(n * 3);
    const tmin = new Float32Array(n * 3);
    const tmax = new Float32Array(n * 3);
    const p = this.pos;
    for (let t = 0; t < n; t += 1) {
      this.idx[t] = t;
      const o = t * 9;
      for (let a = 0; a < 3; a += 1) {
        const v0 = p[o + a], v1 = p[o + 3 + a], v2 = p[o + 6 + a];
        const lo = Math.min(v0, v1, v2);
        const hi = Math.max(v0, v1, v2);
        tmin[t * 3 + a] = lo;
        tmax[t * 3 + a] = hi;
        cent[t * 3 + a] = (v0 + v1 + v2) / 3;
      }
    }

    this.nodeStart[0] = 0;
    this.nodeCount[0] = n;
    this.nodes = 1;
    this._bounds(0, tmin, tmax);

    const binCount = new Int32Array(BIN_COUNT);
    const binMin = new Float32Array(BIN_COUNT * 3);
    const binMax = new Float32Array(BIN_COUNT * 3);
    const work = [0, 0];

    while (work.length) {
      const depth = work.pop();
      const node = work.pop();
      const start = this.nodeStart[node];
      const count = this.nodeCount[node];
      if (count <= LEAF_SIZE || depth >= MAX_DEPTH) continue;

      let clo0 = Infinity, clo1 = Infinity, clo2 = Infinity;
      let chi0 = -Infinity, chi1 = -Infinity, chi2 = -Infinity;
      for (let i = start; i < start + count; i += 1) {
        const t = this.idx[i] * 3;
        if (cent[t] < clo0) clo0 = cent[t];
        if (cent[t] > chi0) chi0 = cent[t];
        if (cent[t + 1] < clo1) clo1 = cent[t + 1];
        if (cent[t + 1] > chi1) chi1 = cent[t + 1];
        if (cent[t + 2] < clo2) clo2 = cent[t + 2];
        if (cent[t + 2] > chi2) chi2 = cent[t + 2];
      }
      const clo = [clo0, clo1, clo2];
      const chi = [chi0, chi1, chi2];

      const nb = node * 3;
      const ex = this.nodeMax[nb] - this.nodeMin[nb];
      const ey = this.nodeMax[nb + 1] - this.nodeMin[nb + 1];
      const ez = this.nodeMax[nb + 2] - this.nodeMin[nb + 2];
      const parentArea = Math.max(1e-6, ex * ey + ey * ez + ez * ex);
      const leafCost = parentArea * count;

      let bestCost = Infinity, bestAxis = -1, bestSplit = -1, bestScale = 0, bestLo = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        const lo = clo[axis];
        const span = chi[axis] - lo;
        if (span < 1e-8) continue;
        const scale = BIN_COUNT / span;
        binCount.fill(0);
        binMin.fill(Infinity);
        binMax.fill(-Infinity);
        for (let i = start; i < start + count; i += 1) {
          const t = this.idx[i];
          let b = ((cent[t * 3 + axis] - lo) * scale) | 0;
          if (b >= BIN_COUNT) b = BIN_COUNT - 1;
          if (b < 0) b = 0;
          binCount[b] += 1;
          for (let a = 0; a < 3; a += 1) {
            const bi = b * 3 + a;
            if (tmin[t * 3 + a] < binMin[bi]) binMin[bi] = tmin[t * 3 + a];
            if (tmax[t * 3 + a] > binMax[bi]) binMax[bi] = tmax[t * 3 + a];
          }
        }
        // Sweep left, then right, accumulating surface area * count.
        const leftArea = new Float64Array(BIN_COUNT);
        const leftNum = new Int32Array(BIN_COUNT);
        let l0 = Infinity, l1 = Infinity, l2 = Infinity;
        let h0 = -Infinity, h1 = -Infinity, h2 = -Infinity;
        let acc = 0;
        for (let b = 0; b < BIN_COUNT; b += 1) {
          if (binCount[b]) {
            l0 = Math.min(l0, binMin[b * 3]); h0 = Math.max(h0, binMax[b * 3]);
            l1 = Math.min(l1, binMin[b * 3 + 1]); h1 = Math.max(h1, binMax[b * 3 + 1]);
            l2 = Math.min(l2, binMin[b * 3 + 2]); h2 = Math.max(h2, binMax[b * 3 + 2]);
            acc += binCount[b];
          }
          const dx = Math.max(0, h0 - l0), dy = Math.max(0, h1 - l1), dz = Math.max(0, h2 - l2);
          leftArea[b] = acc ? dx * dy + dy * dz + dz * dx : 0;
          leftNum[b] = acc;
        }
        l0 = Infinity; l1 = Infinity; l2 = Infinity;
        h0 = -Infinity; h1 = -Infinity; h2 = -Infinity;
        acc = 0;
        for (let b = BIN_COUNT - 1; b > 0; b -= 1) {
          if (binCount[b]) {
            l0 = Math.min(l0, binMin[b * 3]); h0 = Math.max(h0, binMax[b * 3]);
            l1 = Math.min(l1, binMin[b * 3 + 1]); h1 = Math.max(h1, binMax[b * 3 + 1]);
            l2 = Math.min(l2, binMin[b * 3 + 2]); h2 = Math.max(h2, binMax[b * 3 + 2]);
            acc += binCount[b];
          }
          if (!leftNum[b - 1] || !acc) continue;
          const dx = Math.max(0, h0 - l0), dy = Math.max(0, h1 - l1), dz = Math.max(0, h2 - l2);
          const cost = leftArea[b - 1] * leftNum[b - 1] + (dx * dy + dy * dz + dz * dx) * acc;
          if (cost < bestCost) {
            bestCost = cost; bestAxis = axis; bestSplit = b - 1; bestScale = scale; bestLo = lo;
          }
        }
      }

      let leftCount;
      if (bestAxis < 0 || bestCost + parentArea * 0.5 >= leafCost) {
        // A split that does not pay for itself. Big flat floors land
        // here and stay as fat leaves, which is the right answer.
        if (count <= LEAF_SIZE * 4) continue;
        leftCount = -1;
      } else {
        let i = start;
        let j = start + count - 1;
        while (i <= j) {
          const t = this.idx[i];
          let b = ((cent[t * 3 + bestAxis] - bestLo) * bestScale) | 0;
          if (b >= BIN_COUNT) b = BIN_COUNT - 1;
          if (b < 0) b = 0;
          if (b <= bestSplit) i += 1;
          else { this.idx[i] = this.idx[j]; this.idx[j] = t; j -= 1; }
        }
        leftCount = i - start;
        if (leftCount === 0 || leftCount === count) leftCount = -1;
      }

      if (leftCount < 0) {
        // Median fallback. Rare, but a degenerate child would make
        // the tree a linked list and the query a linear scan.
        const axis = ex >= ey && ex >= ez ? 0 : (ey >= ez ? 1 : 2);
        const slice = Array.from(this.idx.subarray(start, start + count));
        slice.sort((p1, p2) => cent[p1 * 3 + axis] - cent[p2 * 3 + axis]);
        for (let k = 0; k < count; k += 1) this.idx[start + k] = slice[k];
        leftCount = count >> 1;
      }

      const l = this.nodes; this.nodes += 1;
      const r = this.nodes; this.nodes += 1;
      this.nodeLeft[node] = l;
      this.nodeStart[l] = start; this.nodeCount[l] = leftCount;
      this.nodeStart[r] = start + leftCount; this.nodeCount[r] = count - leftCount;
      this._bounds(l, tmin, tmax);
      this._bounds(r, tmin, tmax);
      work.push(l, depth + 1, r, depth + 1);
    }

    this.min = [this.nodeMin[0], this.nodeMin[1], this.nodeMin[2]];
    this.max = [this.nodeMax[0], this.nodeMax[1], this.nodeMax[2]];
  }

  _bounds(node, tmin, tmax) {
    const start = this.nodeStart[node];
    const count = this.nodeCount[node];
    let l0 = Infinity, l1 = Infinity, l2 = Infinity;
    let h0 = -Infinity, h1 = -Infinity, h2 = -Infinity;
    for (let i = start; i < start + count; i += 1) {
      const t = this.idx[i] * 3;
      if (tmin[t] < l0) l0 = tmin[t];
      if (tmin[t + 1] < l1) l1 = tmin[t + 1];
      if (tmin[t + 2] < l2) l2 = tmin[t + 2];
      if (tmax[t] > h0) h0 = tmax[t];
      if (tmax[t + 1] > h1) h1 = tmax[t + 1];
      if (tmax[t + 2] > h2) h2 = tmax[t + 2];
    }
    const b = node * 3;
    this.nodeMin[b] = l0 - BOUND_PAD; this.nodeMax[b] = h0 + BOUND_PAD;
    this.nodeMin[b + 1] = l1 - BOUND_PAD; this.nodeMax[b + 1] = h1 + BOUND_PAD;
    this.nodeMin[b + 2] = l2 - BOUND_PAD; this.nodeMax[b + 2] = h2 + BOUND_PAD;
  }

  /**
   * Walk the tree along a ray, optionally dilated by `rad` so the
   * same traversal serves sphere casts. `visit(tri, maxT)` returns
   * the possibly-shortened maxT, which prunes the rest of the walk.
   */
  rayVisit(ox, oy, oz, dx, dy, dz, maxT, rad, visit) {
    if (!this.nodes || !this.count) return maxT;
    // A zero component makes (min - o) * Infinity produce NaN when
    // min happens to equal o. Nudging the direction is cheaper than
    // branching inside the slab test.
    if (Math.abs(dx) < 1e-12) dx = dx < 0 ? -1e-12 : 1e-12;
    if (Math.abs(dy) < 1e-12) dy = dy < 0 ? -1e-12 : 1e-12;
    if (Math.abs(dz) < 1e-12) dz = dz < 0 ? -1e-12 : 1e-12;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const nMin = this.nodeMin, nMax = this.nodeMax;
    const nLeft = this.nodeLeft, nStart = this.nodeStart, nCount = this.nodeCount;
    const idx = this.idx;
    const stack = this.stack;

    const enter = (node) => {
      const o = node * 3;
      let t0 = (nMin[o] - rad - ox) * ix;
      let t1 = (nMax[o] + rad - ox) * ix;
      let lo = t0 < t1 ? t0 : t1;
      let hi = t0 < t1 ? t1 : t0;
      t0 = (nMin[o + 1] - rad - oy) * iy;
      t1 = (nMax[o + 1] + rad - oy) * iy;
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
      if (t0 > lo) lo = t0;
      if (t1 < hi) hi = t1;
      t0 = (nMin[o + 2] - rad - oz) * iz;
      t1 = (nMax[o + 2] + rad - oz) * iz;
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
      if (t0 > lo) lo = t0;
      if (t1 < hi) hi = t1;
      if (hi < 0 || lo > hi) return -1;
      return lo < 0 ? 0 : lo;
    };

    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const t = enter(node);
      if (t < 0 || t > maxT) continue;
      const left = nLeft[node];
      if (left < 0) {
        const start = nStart[node];
        const end = start + nCount[node];
        for (let i = start; i < end; i += 1) maxT = visit(idx[i], maxT);
        continue;
      }
      const tl = enter(left);
      const tr = enter(left + 1);
      // Near child last so it is popped first: a hit there shrinks
      // maxT and the far subtree is culled at pop.
      if (tl >= 0 && tr >= 0) {
        if (tl <= tr) { stack[sp++] = left + 1; stack[sp++] = left; }
        else { stack[sp++] = left; stack[sp++] = left + 1; }
      } else if (tl >= 0) stack[sp++] = left;
      else if (tr >= 0) stack[sp++] = left + 1;
    }
    return maxT;
  }

  /** Every triangle whose node box overlaps the query box. */
  boxVisit(x0, y0, z0, x1, y1, z1, visit) {
    if (!this.nodes || !this.count) return;
    const nMin = this.nodeMin, nMax = this.nodeMax;
    const nLeft = this.nodeLeft, nStart = this.nodeStart, nCount = this.nodeCount;
    const idx = this.idx;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const o = node * 3;
      if (nMax[o] < x0 || nMin[o] > x1) continue;
      if (nMax[o + 1] < y0 || nMin[o + 1] > y1) continue;
      if (nMax[o + 2] < z0 || nMin[o + 2] > z1) continue;
      const left = nLeft[node];
      if (left < 0) {
        const start = nStart[node];
        const end = start + nCount[node];
        for (let i = start; i < end; i += 1) visit(idx[i]);
        continue;
      }
      stack[sp++] = left;
      stack[sp++] = left + 1;
    }
  }
}

/* ------------------------------------------------------------------
   Module
   ------------------------------------------------------------------ */

export function create(ctx) {
  const THREE = ctx && ctx.THREE;
  const Vec3 = THREE && THREE.Vector3;
  if (!Vec3) throw new Error("apop3d/collision: ctx.THREE.Vector3 is required");

  const entries = [];             // registration order
  const byMesh = new Map();
  const meshTable = [];           // owner index -> mesh
  const materials = [DEFAULT_MATERIAL];
  const materialIndex = new Map([[DEFAULT_MATERIAL, 0]]);

  const statics = new TriSoup();
  let dirty = true;
  let buildMs = 0;
  let staticTris = 0;
  let movingTris = 0;
  let syncedFrame = -1;
  let queries = 0;
  let warnedDirty = false;

  const waters = [];

  function materialId(name) {
    const key = typeof name === "string" && name ? name : DEFAULT_MATERIAL;
    let id = materialIndex.get(key);
    if (id === undefined) {
      id = materials.length;
      materials.push(key);
      materialIndex.set(key, id);
    }
    return id;
  }

  /* ---------------------------- registration ---------------------------- */

  /**
   * `opts.moving` (or mesh.userData.moving) keeps the mesh OUT of the
   * merged static soup and gives it a private BVH in its own local
   * space. Queries then transform into that space instead of the
   * world rebuilding its index every time a lift takes a step. A
   * course has a handful of these; a linear pass over them is far
   * cheaper than a rebuild and exact rather than approximate.
   */
  function addStatic(mesh, opts = {}) {
    if (!mesh || !mesh.geometry) return null;
    let entry = byMesh.get(mesh);
    if (!entry) {
      entry = { mesh, soup: null, mat: new Float64Array(16), inv: new Float64Array(16), scale: 1 };
      entries.push(entry);
      byMesh.set(mesh, entry);
    }
    const ud = mesh.userData || {};
    entry.material = opts.material || ud.collisionMaterial || DEFAULT_MATERIAL;
    entry.materialId = materialId(entry.material);
    entry.oneWay = !!(opts.oneWay ?? ud.oneWay);
    entry.moving = !!(opts.moving ?? opts.dynamic ?? ud.moving ?? ud.movingPlatform);
    entry.enabled = opts.enabled !== false;
    dirty = true;
    return entry;
  }

  function removeStatic(mesh) {
    const entry = byMesh.get(mesh);
    if (!entry) return false;
    byMesh.delete(mesh);
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
    dirty = true;
    return true;
  }

  function clear() {
    entries.length = 0;
    byMesh.clear();
    meshTable.length = 0;
    waters.length = 0;
    dirty = true;
  }

  function isMoving(mesh) {
    const entry = byMesh.get(mesh);
    return !!(entry && entry.moving);
  }

  function materialOf(mesh) {
    const entry = byMesh.get(mesh);
    return entry ? entry.material : DEFAULT_MATERIAL;
  }

  /* ------------------------------- build ------------------------------- */

  function triangleCount(mesh) {
    const geo = mesh.geometry;
    const pos = geo && geo.attributes && geo.attributes.position;
    if (!pos) return 0;
    const n = geo.index ? geo.index.count : pos.count;
    return Math.max(0, Math.floor(n / 3));
  }

  /**
   * Copy a mesh's triangles into a soup.
   *
   * matrixWorld is refreshed first. Collision is built before the
   * first rendered frame, so nested objects still carry the identity
   * transform at this point - SAINTFALL baked an entire landmark at
   * the origin for exactly this reason, and the bug is invisible
   * because the renderer fixes the matrices a moment later.
   */
  function gather(entry, soup, at, useWorld) {
    const mesh = entry.mesh;
    if (typeof mesh.updateWorldMatrix === "function") mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const index = geo.index || null;
    const parr = (pos.array && pos.itemSize === 3 && !pos.isInterleavedBufferAttribute)
      ? pos.array : null;
    const iarr = index ? (index.array || null) : null;
    const n = index ? index.count : pos.count;
    const e = useWorld ? (mesh.matrixWorld && mesh.matrixWorld.elements) : null;
    const owner = meshTable.length ? meshTable.indexOf(mesh) : -1;
    const ownerId = owner >= 0 ? owner : (meshTable.push(mesh) - 1);
    const P = soup.pos;
    let w = at;
    for (let t = 0; t + 2 < n; t += 3) {
      for (let k = 0; k < 3; k += 1) {
        const vi = index ? (iarr ? iarr[t + k] : index.getX(t + k)) : (t + k);
        let x, y, z;
        if (parr) { const o = vi * 3; x = parr[o]; y = parr[o + 1]; z = parr[o + 2]; }
        else { x = pos.getX(vi); y = pos.getY(vi); z = pos.getZ(vi); }
        if (e) {
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
          const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          x = wx; y = wy; z = wz;
        }
        P[w * 9 + k * 3] = x;
        P[w * 9 + k * 3 + 1] = y;
        P[w * 9 + k * 3 + 2] = z;
      }
      soup.mat[w] = entry.materialId;
      soup.flags[w] = entry.oneWay ? 1 : 0;
      soup.owner[w] = ownerId;
      w += 1;
    }
    return w;
  }

  function build() {
    const t0 = now();
    meshTable.length = 0;

    let count = 0;
    for (const entry of entries) {
      if (!entry.enabled || entry.moving) continue;
      count += triangleCount(entry.mesh);
    }
    statics.alloc(count);
    let at = 0;
    for (const entry of entries) {
      if (!entry.enabled || entry.moving) continue;
      at = gather(entry, statics, at, true);
    }
    statics.build();
    staticTris = count;

    movingTris = 0;
    for (const entry of entries) {
      if (!entry.enabled || !entry.moving) continue;
      const n = triangleCount(entry.mesh);
      const soup = new TriSoup();
      soup.alloc(n);
      gather(entry, soup, 0, false);   // local space; the matrix is the query's job
      soup.build();
      entry.soup = soup;
      entry.matDirty = true;
      movingTris += n;
    }

    dirty = false;
    warnedDirty = false;
    syncedFrame = -1;
    syncMoving(true);
    buildMs = now() - t0;
    return { triangles: staticTris + movingTris, nodes: statics.nodes, ms: buildMs };
  }

  function now() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now() : Date.now();
  }

  /* --------------------------- moving transforms --------------------------- */

  /** Inverse of an affine 4x4 held column-major, as three stores it. */
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
   * Refresh the cached world transform of every moving mesh, at most
   * once per frame. collision.js is not in main.js's update order by
   * design - it is a query service, not a simulation - so the sync
   * has to be lazy or a lift's collider lags a frame behind its mesh.
   */
  function syncMoving(force) {
    const frame = (ctx.clock && ctx.clock.frame) || 0;
    if (!force && frame === syncedFrame) return;
    syncedFrame = frame;
    for (const entry of entries) {
      if (!entry.moving || !entry.soup) continue;
      const mesh = entry.mesh;
      if (typeof mesh.updateWorldMatrix === "function") mesh.updateWorldMatrix(true, false);
      const e = mesh.matrixWorld && mesh.matrixWorld.elements;
      if (!e) continue;
      for (let i = 0; i < 16; i += 1) entry.mat[i] = e[i];
      invertAffine(entry.mat, entry.inv);
      entry.scale = Math.hypot(e[0], e[1], e[2]) || 1;
      // World AABB of the local box, by projecting the half extents.
      const s = entry.soup;
      const cx = (s.min[0] + s.max[0]) * 0.5;
      const cy = (s.min[1] + s.max[1]) * 0.5;
      const cz = (s.min[2] + s.max[2]) * 0.5;
      const hx = (s.max[0] - s.min[0]) * 0.5;
      const hy = (s.max[1] - s.min[1]) * 0.5;
      const hz = (s.max[2] - s.min[2]) * 0.5;
      if (!Number.isFinite(cx)) { entry.wmin = null; continue; }
      const wcx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
      const wcy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
      const wcz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
      const ex = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz;
      const ey = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
      const ez = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
      entry.wmin = [wcx - ex, wcy - ey, wcz - ez];
      entry.wmax = [wcx + ex, wcy + ey, wcz + ez];
    }
  }

  function ensureBuilt() {
    if (!dirty) return;
    if (!warnedDirty) {
      warnedDirty = true;
      console.warn("[apop3d] collision queried before build(); building now");
    }
    build();
  }

  const _lx = new Float64Array(3);   // transform scratch
  const _wk = new Float64Array(3);   // second transform scratch, never aliased with _lx
  const _cap = new Float64Array(8);  // capsule query in the space being tested
  function xform(m, x, y, z, out) {
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  function xformDir(m, x, y, z, out) {
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
  }

  /* ------------------------------ pooling ------------------------------ */

  const rayPool = {
    point: new Vec3(), normal: new Vec3(), dist: 0,
    material: DEFAULT_MATERIAL, mesh: null, oneWay: false, hit: false,
  };
  const spherePool = {
    point: new Vec3(), normal: new Vec3(), dist: 0,
    material: DEFAULT_MATERIAL, mesh: null, oneWay: false, hit: false,
  };
  const groundPool = {
    y: 0, normal: new Vec3(0, 1, 0), material: DEFAULT_MATERIAL,
    mesh: null, oneWay: false, slope: 0, upFacing: true,
  };
  const wallPool = { normal: new Vec3(), dist: 0, point: new Vec3(), material: DEFAULT_MATERIAL, mesh: null };
  const waterPool = {
    inside: false, surfaceY: 0, bottomY: 0, depth: 0,
    current: new Vec3(), material: "water", volume: null,
  };

  const contactPool = [];
  const contactList = [];
  function contactAt(i) {
    let c = contactPool[i];
    if (!c) {
      c = {
        point: new Vec3(), normal: new Vec3(), depth: 0, topY: 0,
        material: DEFAULT_MATERIAL, mesh: null, oneWay: false, face: false, normalY: 0,
      };
      contactPool[i] = c;
    }
    return c;
  }

  /* ------------------------------ raycast ------------------------------ */

  const _rayHit = {
    t: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0,
    mat: 0, mesh: null, oneWay: false, hit: false,
  };

  /**
   * Nearest triangle along a ray.
   *
   * `minAbsNy` rejects triangles by the absolute Y of their normal:
   * groundAt passes a small value so a wall standing exactly on the
   * probe column cannot be mistaken for a floor.
   */
  function castRay(ox, oy, oz, dx, dy, dz, maxDist, minAbsNy, skipOneWay) {
    ensureBuilt();
    syncMoving(false);
    queries += 1;
    _rayHit.hit = false;
    let best = maxDist;

    const consume = (soup, tri, t, ex, ey, ez) => {
      const o = tri * 9;
      const p = soup.pos;
      triNormal(p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5],
        p[o + 6], p[o + 7], p[o + 8]);
      let nx = _hitN[0], ny = _hitN[1], nz = _hitN[2];
      if (ex) {
        xformDir(ex, nx, ny, nz, _lx);
        const l = Math.hypot(_lx[0], _lx[1], _lx[2]) || 1;
        nx = _lx[0] / l; ny = _lx[1] / l; nz = _lx[2] / l;
      }
      if (minAbsNy > 0 && Math.abs(ny) < minAbsNy) return false;
      _rayHit.hit = true;
      _rayHit.t = t;
      _rayHit.nx = nx; _rayHit.ny = ny; _rayHit.nz = nz;
      _rayHit.px = ox + dx * t; _rayHit.py = oy + dy * t; _rayHit.pz = oz + dz * t;
      _rayHit.mat = soup.mat[tri];
      _rayHit.mesh = meshTable[soup.owner[tri]] || null;
      _rayHit.oneWay = (soup.flags[tri] & 1) === 1;
      void ey; void ez;
      return true;
    };

    best = statics.rayVisit(ox, oy, oz, dx, dy, dz, best, 0, (tri, limit) => {
      if (skipOneWay && (statics.flags[tri] & 1) === 1) return limit;
      const o = tri * 9;
      const p = statics.pos;
      const t = rayTriangle(ox, oy, oz, dx, dy, dz,
        p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5], p[o + 6], p[o + 7], p[o + 8]);
      if (t < 0 || t > limit) return limit;
      return consume(statics, tri, t, null) ? t : limit;
    });

    for (const entry of entries) {
      if (!entry.moving || !entry.soup || !entry.wmin) continue;
      const soup = entry.soup;
      xform(entry.inv, ox, oy, oz, _lx);
      const lox = _lx[0], loy = _lx[1], loz = _lx[2];
      xformDir(entry.inv, dx, dy, dz, _lx);
      const scale = Math.hypot(_lx[0], _lx[1], _lx[2]) || 1;
      const ldx = _lx[0] / scale, ldy = _lx[1] / scale, ldz = _lx[2] / scale;
      let localBest = best * scale;
      localBest = soup.rayVisit(lox, loy, loz, ldx, ldy, ldz, localBest, 0, (tri, limit) => {
        if (skipOneWay && (soup.flags[tri] & 1) === 1) return limit;
        const o = tri * 9;
        const p = soup.pos;
        const t = rayTriangle(lox, loy, loz, ldx, ldy, ldz,
          p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5], p[o + 6], p[o + 7], p[o + 8]);
        if (t < 0 || t > limit) return limit;
        return consume(soup, tri, t / scale, entry.mat) ? t : limit;
      });
      if (_rayHit.hit && _rayHit.t < best) best = _rayHit.t;
    }
    return _rayHit.hit;
  }

  function raycast(origin, dir, maxDist = 1000, out) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    if (!castRay(origin.x, origin.y, origin.z, dx, dy, dz, maxDist, 0, false)) return null;
    const res = out || rayPool;
    res.point.set(_rayHit.px, _rayHit.py, _rayHit.pz);
    // Normals face the ray, so a caller never has to guess the winding.
    const facing = _rayHit.nx * dx + _rayHit.ny * dy + _rayHit.nz * dz > 0 ? -1 : 1;
    res.normal.set(_rayHit.nx * facing, _rayHit.ny * facing, _rayHit.nz * facing);
    res.dist = _rayHit.t;
    res.material = materials[_rayHit.mat] || DEFAULT_MATERIAL;
    res.mesh = _rayHit.mesh;
    res.oneWay = _rayHit.oneWay;
    res.hit = true;
    return res;
  }

  /* ----------------------------- sphereCast ----------------------------- */

  function sphereCast(origin, dir, radius, maxDist = 1000, out) {
    ensureBuilt();
    syncMoving(false);
    queries += 1;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    let best = maxDist;
    let found = false;
    let bnx = 0, bny = 0, bnz = 0, bpx = 0, bpy = 0, bpz = 0, bmat = 0, bmesh = null, bone = false;

    const run = (soup, m, inv, scale) => {
      let lox = ox, loy = oy, loz = oz, ldx = dx, ldy = dy, ldz = dz, sc = 1, lr = radius;
      if (inv) {
        xform(inv, ox, oy, oz, _lx);
        lox = _lx[0]; loy = _lx[1]; loz = _lx[2];
        xformDir(inv, dx, dy, dz, _lx);
        sc = Math.hypot(_lx[0], _lx[1], _lx[2]) || 1;
        ldx = _lx[0] / sc; ldy = _lx[1] / sc; ldz = _lx[2] / sc;
        lr = radius * sc;
      }
      let limit = best * sc;
      soup.rayVisit(lox, loy, loz, ldx, ldy, ldz, limit, lr, (tri, lim) => {
        const o = tri * 9;
        const p = soup.pos;
        const t = sweepSphereTriangle(lox, loy, loz, ldx, ldy, ldz, lr, lim,
          p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5], p[o + 6], p[o + 7], p[o + 8]);
        if (t < 0 || t > lim) return lim;
        const world = t / sc;
        if (world > best) return lim;
        best = world;
        found = true;
        let nx = _hitN[0], ny = _hitN[1], nz = _hitN[2];
        let px = _cp[0], py = _cp[1], pz = _cp[2];
        if (m) {
          xformDir(m, nx, ny, nz, _lx);
          const l = Math.hypot(_lx[0], _lx[1], _lx[2]) || 1;
          nx = _lx[0] / l; ny = _lx[1] / l; nz = _lx[2] / l;
          xform(m, px, py, pz, _lx);
          px = _lx[0]; py = _lx[1]; pz = _lx[2];
        }
        bnx = nx; bny = ny; bnz = nz; bpx = px; bpy = py; bpz = pz;
        bmat = soup.mat[tri];
        bmesh = meshTable[soup.owner[tri]] || null;
        bone = (soup.flags[tri] & 1) === 1;
        return t;
      });
      void scale;
    };

    run(statics, null, null, 1);
    for (const entry of entries) {
      if (!entry.moving || !entry.soup || !entry.wmin) continue;
      run(entry.soup, entry.mat, entry.inv, entry.scale);
    }
    if (!found) return null;
    const res = out || spherePool;
    res.point.set(bpx, bpy, bpz);
    res.normal.set(bnx, bny, bnz);
    res.dist = best;
    res.material = materials[bmat] || DEFAULT_MATERIAL;
    res.mesh = bmesh;
    res.oneWay = bone;
    res.hit = true;
    return res;
  }

  /* ---------------------------- capsuleQuery ---------------------------- */

  /**
   * Every triangle overlapping the capsule, as pooled contacts.
   *
   * `opts` is additive to the frozen signature and lets physics tell
   * this query what it knows about one-way platforms:
   *   opts.feetY      - where the capsule's feet were before the move
   *   opts.dropThrough- ignore one-way surfaces entirely (crouch drop)
   * Without it, one-way contacts come back flagged and the caller
   * decides.
   */
  function capsuleQuery(base, top, radius, out, opts) {
    ensureBuilt();
    syncMoving(false);
    queries += 1;
    const list = out || contactList;
    list.length = 0;
    const feetY = opts && Number.isFinite(opts.feetY) ? opts.feetY : null;
    const dropThrough = !!(opts && opts.dropThrough);

    const x0 = Math.min(base.x, top.x) - radius, x1 = Math.max(base.x, top.x) + radius;
    const y0 = Math.min(base.y, top.y) - radius, y1 = Math.max(base.y, top.y) + radius;
    const z0 = Math.min(base.z, top.z) - radius, z1 = Math.max(base.z, top.z) + radius;

    const push = (soup, tri, m, sc) => {
      if (list.length >= MAX_CONTACTS) return;
      const oneWay = (soup.flags[tri] & 1) === 1;
      if (oneWay && dropThrough) return;
      const o = tri * 9;
      const p = soup.pos;
      if (!capsuleTriangle(_cap[0], _cap[1], _cap[2], _cap[3], _cap[4], _cap[5], _cap[6],
        p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5], p[o + 6], p[o + 7], p[o + 8])) return;
      let depth = _contact[0];
      let nx = _contact[1], ny = _contact[2], nz = _contact[3];
      let px = _contact[4], py = _contact[5], pz = _contact[6];
      if (m) {
        xformDir(m, nx, ny, nz, _wk);
        const l = Math.hypot(_wk[0], _wk[1], _wk[2]) || 1;
        nx = _wk[0] / l; ny = _wk[1] / l; nz = _wk[2] / l;
        xform(m, px, py, pz, _wk);
        px = _wk[0]; py = _wk[1]; pz = _wk[2];
        depth *= sc;
      }
      if (oneWay) {
        /* Pass through from below, land on from above. The test is on
           the pre-move feet height, not the current one: by the time
           the capsule overlaps the platform its feet are already
           under the surface, and testing that would make every
           one-way platform solid from both sides. */
        if (ny < 0.5) return;
        if (feetY !== null && feetY < py - 0.08) return;
      }
      /* The triangle's own highest point, which is not the same thing
         as the contact point. A capsule leaning on a kerb touches it
         at knee height whatever the kerb's real height is, and the
         step-over rule needs to know how tall the obstacle actually
         is, not where the two shapes happen to be nearest. */
      let topY = Math.max(p[o + 1], p[o + 4], p[o + 7]);
      if (m) {
        topY = Math.max(
          m[1] * p[o] + m[5] * p[o + 1] + m[9] * p[o + 2] + m[13],
          m[1] * p[o + 3] + m[5] * p[o + 4] + m[9] * p[o + 5] + m[13],
          m[1] * p[o + 6] + m[5] * p[o + 7] + m[9] * p[o + 8] + m[13]
        );
      }
      const c = contactAt(list.length);
      c.point.set(px, py, pz);
      c.normal.set(nx, ny, nz);
      c.topY = topY;
      c.depth = depth;
      c.material = materials[soup.mat[tri]] || DEFAULT_MATERIAL;
      c.mesh = meshTable[soup.owner[tri]] || null;
      c.oneWay = oneWay;
      c.face = _contact[7] === 1;
      c.normalY = ny;
      list.push(c);
    };

    _cap[0] = base.x; _cap[1] = base.y; _cap[2] = base.z;
    _cap[3] = top.x; _cap[4] = top.y; _cap[5] = top.z;
    _cap[6] = radius;
    statics.boxVisit(x0, y0, z0, x1, y1, z1, (tri) => push(statics, tri, null, 1));

    for (const entry of entries) {
      if (!entry.moving || !entry.soup || !entry.wmin) continue;
      if (entry.wmax[0] < x0 || entry.wmin[0] > x1) continue;
      if (entry.wmax[1] < y0 || entry.wmin[1] > y1) continue;
      if (entry.wmax[2] < z0 || entry.wmin[2] > z1) continue;
      const inv = entry.inv;
      const invScale = 1 / (entry.scale || 1);
      xform(inv, base.x, base.y, base.z, _lx);
      const bx = _lx[0], by = _lx[1], bz = _lx[2];
      xform(inv, top.x, top.y, top.z, _lx);
      const tx = _lx[0], ty = _lx[1], tz = _lx[2];
      const lr = radius * invScale;
      _cap[0] = bx; _cap[1] = by; _cap[2] = bz;
      _cap[3] = tx; _cap[4] = ty; _cap[5] = tz;
      _cap[6] = lr;
      const lx0 = Math.min(bx, tx) - lr, lx1 = Math.max(bx, tx) + lr;
      const ly0 = Math.min(by, ty) - lr, ly1 = Math.max(by, ty) + lr;
      const lz0 = Math.min(bz, tz) - lr, lz1 = Math.max(bz, tz) + lr;
      entry.soup.boxVisit(lx0, ly0, lz0, lx1, ly1, lz1,
        (tri) => push(entry.soup, tri, entry.mat, entry.scale));
      _cap[0] = base.x; _cap[1] = base.y; _cap[2] = base.z;
      _cap[3] = top.x; _cap[4] = top.y; _cap[5] = top.z;
      _cap[6] = radius;
    }
    return list;
  }

  /* ------------------------------ groundAt ------------------------------ */

  /**
   * The workhorse. One downward ray, and the answer carries the
   * surface material because the moveset changes on ice, the VFX
   * layer keys footstep dust off it, and audio keys the step sound.
   * Returning only a height would make every caller do a second
   * query to find out what they are standing on.
   */
  function groundAt(x, z, fromY = 1000, maxDrop = 2000) {
    if (!castRay(x, fromY, z, 0, -1, 0, maxDrop, GROUND_MIN_NY, false)) return null;
    const res = groundPool;
    res.y = _rayHit.py;
    /* Which side of the triangle the probe came down on. A surface
       hit from behind is the UNDERSIDE of something - the belly of a
       walkway, the inside of a roof - and a body must never be lifted
       onto one of those by the step rule. */
    res.upFacing = _rayHit.ny > 0;
    const flip = _rayHit.ny < 0 ? -1 : 1;
    res.normal.set(_rayHit.nx * flip, _rayHit.ny * flip, _rayHit.nz * flip);
    res.slope = Math.acos(clamp(res.normal.y, -1, 1));
    res.material = materials[_rayHit.mat] || DEFAULT_MATERIAL;
    res.mesh = _rayHit.mesh;
    res.oneWay = _rayHit.oneWay;
    return res;
  }

  /* ------------------------------ wallProbe ----------------------------- */

  const _probeBase = { x: 0, y: 0, z: 0 };
  const _probeTop = { x: 0, y: 0, z: 0 };
  const _probeList = [];
  const WALL_REACH = 0.22;
  const WALL_MAX_NY = 0.5;   // steeper than this is a floor or a ceiling

  /**
   * Is there a near-vertical surface in front of this capsule?
   *
   * Answered by inflating the capsule rather than casting, because
   * the wall kick needs to fire on CONTACT, and a cast from the
   * capsule's axis reports a distance that is already inside the
   * radius by the time the player is touching the wall.
   * `pos` is the feet position, matching body.position.
   */
  function wallProbe(pos, dir, radius = 0.32, height = 1.7) {
    const r = radius + WALL_REACH;
    _probeBase.x = pos.x; _probeBase.y = pos.y + radius * 0.9; _probeBase.z = pos.z;
    _probeTop.x = pos.x; _probeTop.y = pos.y + Math.max(radius, height - radius); _probeTop.z = pos.z;
    const list = capsuleQuery(_probeBase, _probeTop, r, _probeList, { dropThrough: true });
    const dl = Math.hypot(dir.x, dir.z) || 1;
    const dx = dir.x / dl, dz = dir.z / dl;
    let best = null;
    let bestDot = 0.35;   // must actually be in front
    for (let i = 0; i < list.length; i += 1) {
      const c = list[i];
      if (Math.abs(c.normal.y) > WALL_MAX_NY) continue;
      const into = -(c.normal.x * dx + c.normal.z * dz);
      if (into <= bestDot) continue;
      bestDot = into;
      best = c;
    }
    if (!best) return null;
    wallPool.normal.copy(best.normal);
    wallPool.dist = Math.max(0, (r - best.depth) - radius);
    wallPool.point.copy(best.point);
    wallPool.material = best.material;
    wallPool.mesh = best.mesh;
    return wallPool;
  }

  /* ------------------------------- water ------------------------------- */

  /**
   * Water is a registered volume, not a material on a triangle. A
   * swimming body needs a surface height and a depth at any point
   * inside it, and a triangle tagged "water" can only answer where
   * the ray happens to land.
   */
  function addWater(spec = {}) {
    let min = spec.min;
    let max = spec.max;
    if (!min && spec.isObject3D && spec.geometry) {
      const mesh = spec;
      if (typeof mesh.updateWorldMatrix === "function") mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry;
      if (typeof g.computeBoundingBox === "function" && !g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (bb) {
        const e = mesh.matrixWorld.elements;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < 8; i += 1) {
          const x = (i & 1) ? bb.max.x : bb.min.x;
          const y = (i & 2) ? bb.max.y : bb.min.y;
          const z = (i & 4) ? bb.max.z : bb.min.z;
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
          const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          lo[0] = Math.min(lo[0], wx); hi[0] = Math.max(hi[0], wx);
          lo[1] = Math.min(lo[1], wy); hi[1] = Math.max(hi[1], wy);
          lo[2] = Math.min(lo[2], wz); hi[2] = Math.max(hi[2], wz);
        }
        min = { x: lo[0], y: lo[1], z: lo[2] };
        max = { x: hi[0], y: hi[1], z: hi[2] };
      }
    }
    if (!min || !max) return null;
    const vol = {
      minX: min.x, minY: min.y, minZ: min.z,
      maxX: max.x, maxY: max.y, maxZ: max.z,
      surfaceY: Number.isFinite(spec.surfaceY) ? spec.surfaceY : max.y,
      current: spec.current ? new Vec3(spec.current.x || 0, spec.current.y || 0, spec.current.z || 0) : new Vec3(),
      material: spec.material || "water",
      object: spec.object || (spec.isObject3D ? spec : null),
    };
    waters.push(vol);
    return vol;
  }

  function removeWater(vol) {
    const i = waters.indexOf(vol);
    if (i >= 0) { waters.splice(i, 1); return true; }
    return false;
  }

  function waterAt(x, y, z, out) {
    const res = out || waterPool;
    res.inside = false;
    res.volume = null;
    res.depth = 0;
    for (let i = 0; i < waters.length; i += 1) {
      const v = waters[i];
      if (x < v.minX || x > v.maxX || z < v.minZ || z > v.maxZ) continue;
      if (y > v.surfaceY || y < v.minY - 0.001) continue;
      res.inside = true;
      res.surfaceY = v.surfaceY;
      res.bottomY = v.minY;
      res.depth = v.surfaceY - y;
      res.current.copy(v.current);
      res.material = v.material;
      res.volume = v;
      return res;
    }
    return null;
  }

  /* ----------------------------- debug view ----------------------------- */

  /**
   * A wireframe of the index itself. An "invisible wall" is by
   * definition something the player cannot see, so the only way to
   * report one is to draw it. Off by default and never added to the
   * scene by this module - the caller owns where it goes.
   */
  function debugMesh(opts = {}) {
    ensureBuilt();
    const mode = opts.mode || "leaves";   // "leaves" | "nodes" | "triangles"
    const pts = [];
    const box = (x0, y0, z0, x1, y1, z1) => {
      const v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ];
      const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (let i = 0; i < e.length; i += 1) pts.push(v[e[i]][0], v[e[i]][1], v[e[i]][2]);
    };
    if (mode === "triangles") {
      const p = statics.pos;
      const limit = Math.min(statics.count, opts.limit || 20000);
      for (let t = 0; t < limit; t += 1) {
        const o = t * 9;
        for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
          pts.push(p[o + a], p[o + a + 1], p[o + a + 2], p[o + b], p[o + b + 1], p[o + b + 2]);
        }
      }
    } else {
      for (let n = 0; n < statics.nodes; n += 1) {
        if (mode === "leaves" && statics.nodeLeft[n] >= 0) continue;
        const b = n * 3;
        box(statics.nodeMin[b], statics.nodeMin[b + 1], statics.nodeMin[b + 2],
          statics.nodeMax[b], statics.nodeMax[b + 1], statics.nodeMax[b + 2]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: opts.color ?? 0x35ffd0, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    mesh.name = "collision-debug";
    mesh.frustumCulled = false;
    return mesh;
  }

  return {
    addStatic,
    removeStatic,
    clear,
    build,
    rebuild: build,
    raycast,
    sphereCast,
    capsuleQuery,
    groundAt,
    wallProbe,
    addWater,
    removeWater,
    waterAt,
    isMoving,
    materialOf,
    debugMesh,
    get needsBuild() { return dirty; },
    stats() {
      const s = {
        meshes: entries.length,
        triangles: staticTris + movingTris,
        staticTriangles: staticTris,
        movingTriangles: movingTris,
        nodes: statics.nodes,
        materials: materials.slice(),
        waters: waters.length,
        buildMs: Math.round(buildMs * 100) / 100,
        queries,
      };
      queries = 0;
      return s;
    },
  };
}
