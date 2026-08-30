/* ============================================================
   SAINTFALL - alpine structure kit (Kenosis)

   `structures.js` is the geometry vocabulary of a DESERT. Almost
   all of it transfers unchanged - a ring stack is a ring stack,
   and the Cathedral of the Ninth Ascent is built from the same
   gothic primitives as the Vault-Cathedral. This file imports
   `makeKit` and re-exports every one of its members verbatim, then
   adds the eleven shapes a mountain needs and a basin does not.

   ------------------------------------------------------------
   WHAT MAKES A SNOW LEVEL LOOK CHEAP, AND WHICH PRIMITIVE ANSWERS
   EACH OF THEM

   1. PROPS STANDING **ON** THE SNOW INSTEAD OF **IN** IT.

      This is the tell, and it is worth more than every material in
      summit-art.js put together. Real snow is a fluid that has
      stopped: it beds against anything standing in it, scours a
      moat on the windward foot and lays a long tail downwind. A
      serac, a cairn and a bell frame all dropped onto the height
      field at ground level read as a diorama of white plastic
      models no matter how good the shader on them is.

      `snowCap()` is the answer and it is the most important
      function in this file. It does three jobs at once: it reports
      how far the prop should be SUNK (bedded to the MINIMUM
      support under its own footprint, never the centre point - see
      world.js:4352 for the dune-field version of the same lesson),
      it builds the drift collar around it, and it lays a real
      thickness of snow on every up-facing face steep-angle-culled
      at 38 degrees, with a skirt down the edges so the load is a
      slab and not a decal.

   2. EVERY LEDGE THE SAME LEDGE.

      A mountain is made of edges - cornices, roof eaves, serac
      lips, the parapet coping - and in the cold every one of them
      grows the same fringe. `icicleFringe()` batches an arbitrary
      edge polyline into ONE geometry so the fringe can go on
      everything without costing a draw call per ledge, and it
      varies by exposure rather than by rng alone: a sheltered
      eave grows stubs, a dripping south lip grows a two-metre
      curtain, and the run between them is continuous.

   3. RIME PAINTED ON RATHER THAN GROWN.

      Rime is DIRECTIONAL. It grows on the windward face and only
      on the windward face, into the wind, at the same bearing over
      the whole level. `rimeFeathers()` is therefore a displacement
      pass over an existing geometry rather than a solid: the rime
      on a conifer, on a bell frame and on a summit cross is the
      same operator applied to three different objects, and it is
      that shared heading that makes the mountain look like it has
      weather.

   ------------------------------------------------------------
   RULES INHERITED FROM THIS CODEBASE'S OWN SCAR TISSUE

   - `ringSolid` samples an ellipse at uniform ANGLE, so a 5:1
     cross-section layer-cakes at low side counts (the yardang
     note: a 5:1 fin at 9 sides came out as a stack of discs).
     Nothing here builds a wide thin shape out of one ring stack.
     The Cascade's curtain is N separate columns; the Tarn's
     pressure plates are `polyExtrudeY` footprints.
   - A tube along a 3D path needs PARALLEL TRANSPORT or its frame
     flips 180 degrees at the vertical guard and the backwards-
     wound faces read as transparency. Where a sweep is needed here
     the path is HORIZONTAL (a crevasse edge, a road parapet), so
     the frame is fixed by world up and the flip cannot happen -
     `sweepProfile` below says so explicitly. Anything on a genuinely
     3D path must go through `kit.rockTube`, which transports.
   - Cap the bottom of anything the player can see under. The bells
     are the interesting case: a bell is a shell and you WILL stand
     under one, so `bellFrame` walks its ring list up the outside
     and back down the inside and closes the mouth with a real rim.
   - Nothing uses `Math.random`. Every builder either takes an rng
     from `makeRng` or hashes off position, so two builds of the
     same seed are byte-identical.

   ------------------------------------------------------------
   RETURN CONVENTION

   A builder returns a bare `BufferGeometry` when one material
   covers the whole thing, and `{ geo, extras }` when the caller
   needs a second material's geometry (bronze on stone) or a
   derived anchor list (the cornice lip, so a fringe can hang off
   it). `extras` is never optional-chained away by the callers, so
   its keys are documented at each builder.

   ------------------------------------------------------------
   MEASURED

   Build cost, node/r128, one core, geometry only (no paint upload):
   sixty seracs 24 ms / 36k verts; sixty `snowCap`s over those same
   seracs 21 ms / 12k verts; one 420-icicle fringe 14 ms / 9.2k verts.
   The whole Glacier Tongue is therefore tens of milliseconds inside
   `buildSummitWorld`'s budget, and none of these needs its own yield.

   WINDING was audited rather than eyeballed, because an inside-out
   surface is this project's single most repeated failure and flat
   shading hides it - the GPU draws the far wall's interior and the
   thing looks solid until something passes behind it. Every closed
   solid here was checked by signed volume through the divergence
   theorem, and the open sheets (the drift collar, the cornice, the
   load slab and its skirt) by area-weighted normal direction against
   a known reference. THREE of them were wrong on the first pass and
   are commented individually: the drift collar, the load skirt, and
   the collar's centre cap. All three had been reasoned through on
   paper first, and all three reasonings were wrong in the same way -
   confusing the 2D (x, z) signed-area convention with the right-hand
   rule about +Y. Do not trust a fresh derivation here; measure it.

   ------------------------------------------------------------
   ORDER OF OPERATIONS, from the contract's section 4.4 and enforced
   in every builder here: build parts -> merge -> displace ->
   `kit.facet()` -> paint. `facet()` copies ONLY the position
   attribute (structures.js:2030) so a colour written before it is
   silently thrown away, and a displacement applied after it tears
   the surface into disconnected triangles because nothing is
   shared any more.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, sstep, makeRng, makeNoise2D,
} from "saintfall/core.js";
import { paintGeometry, paintByHeight } from "saintfall/art.js";
import {
  SNOW_RAMP, SLAB_RAMP, GLACIER_RAMP, BLACKICE_RAMP, GRANITE_RAMP,
  RIME_RAMP, BELL_RAMP, BARK_RAMP, SUMMIT_PALETTE, SUMMIT_WIND,
} from "saintfall/summit-art.js";
import { makeKit, mergeGeometries } from "saintfall/structures.js";

/* ------------------------------------------------------------------
   WORLD CONSTANTS

   The layout gives the level exactly one wind (layout section 5) and
   exactly one snow-holding angle (art direction section 4). Both are
   module constants rather than per-call defaults, because the moment
   two builders disagree about the wind the whole illusion goes: rime
   on one heading, drift tails on another, and spindrift on a third
   reads as three unrelated effects rather than as weather.
   ------------------------------------------------------------------ */

/* Meteorological bearing the wind blows FROM. WNW. (layout section 5)

   TAKEN FROM summit-art.js RATHER THAN RESTATED. The number was
   written out here as a literal 292 and it was correct - but it was
   the third independent copy of the world's wind in the pack, and
   the second copy had already been found with the sign of z flipped.
   A sign error on a wind vector produces no obvious artefact: the air
   still moves along the right line. What it produces is rime growing
   on the sheltered face of every tree and nothing anywhere that says
   so. One declaration, imported. */
export const WIND_BEARING = SUMMIT_WIND.fromBearing;

/** Above this the snow does not hold - art direction section 4's
 *  "above ~38 degrees it does not hold". Stored as a cosine because
 *  every consumer has a normal, not an angle. */
export const SNOW_HOLD_DEG = 38;
const SNOW_HOLD_COS = Math.cos((SNOW_HOLD_DEG * Math.PI) / 180);

/**
 * Compass bearing -> the horizontal unit vector the wind TRAVELS
 * along, matching `atmos.uniforms.uWind`'s (x, z, speed) packing
 * (art.js:751) so a builder and a particle shader cannot disagree.
 *
 * Bearing is the direction the wind comes FROM, so the travel vector
 * is the bearing plus 180 degrees. Axis convention is Vesper's:
 * +Z south, -Z north, +X east (layout header), which puts bearing 0
 * at -Z and bearing 90 at +X.
 */
export function windVector(bearingDeg = WIND_BEARING) {
  const to = ((bearingDeg + 180) * Math.PI) / 180;
  return { x: Math.sin(to), z: -Math.cos(to) };
}

/**
 * A copy of `polyRadiusFactor`, private to `saintHead`
 * (structures.js:1685-1690) and needed by anything studded onto a
 * `ringSolid` facet.
 *
 * A ring is a POLYGON inscribed in an ellipse, not the ellipse. At
 * five sides a facet's midpoint sits at cos(pi/5) = 0.81 of the
 * nominal radius, so a bronze plaque placed on the ellipse floats
 * nearly a fifth of the post's radius proud of the flat it is
 * supposed to be pinned to. On the Saint that was four metres of
 * daylight under a rivet course; on a votive marker it is a
 * centimetre, which is worse, because a centimetre of daylight is
 * exactly the gap that reads as a modelling error rather than as a
 * style. This returns the factor that puts a point on the real facet.
 */
export function polyRadiusFactor(a, sides, phase) {
  const seg = TAU / sides;
  let local = (a - (phase || 0)) % seg;
  if (local < 0) local += seg;
  return Math.cos(seg * 0.5) / Math.cos(local - seg * 0.5);
}

/* ==================================================================
   THE KIT
   ================================================================== */

/**
 * `makeSummitKit(THREE, opts)` -> the base kit plus the alpine
 * builders. `opts.wind` overrides the level bearing (the harnesses
 * sweep it to prove that rime and drift track the same vector);
 * `opts.seed` seeds the shared position-hashed noise used by the
 * displacement passes, which take no rng of their own because they
 * must be a pure function of position - two calls over the same
 * geometry have to agree, and a call order dependency would make the
 * level differ between a fresh boot and a reload.
 */
export function makeSummitKit(THREE, opts = {}) {
  const kit = makeKit(THREE);
  const wind = windVector(opts.wind ?? WIND_BEARING);
  /* Upwind: the direction a windward face points, and the direction
     rime grows. Named rather than negated at each site, because a
     sign error here is invisible in a still (feathers on the wrong
     face still look like feathers) and glaring the moment spindrift
     is on screen going the other way. */
  const upwind = { x: -wind.x, z: -wind.z };
  const noise = makeNoise2D((opts.seed ?? 0x5e17fa11) >>> 0);

  /* ================================================================
     LOCAL HELPERS
     ================================================================ */

  /** The zero-area guard from `ringSolid` (structures.js:88-102).
   *  Distinct INDICES do not imply distinct POSITIONS: any profile
   *  that tapers to nothing - and three builders here deliberately
   *  taper their ends to nothing - emits triangles whose vertices
   *  coincide. Those cost vertex processing for nothing and hand
   *  `computeVertexNormals` a zero-length normal, which normalises to
   *  NaN and travels through lighting into the bloom chain. */
  const makeTri = (pos, idx) => (i0, i1, i2) => {
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

  const finish = (pos, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  /** Resample a polyline to a fixed arc-length step. Every sweep here
   *  is authored at whatever spacing was convenient for the layout
   *  (the Via Sacra is sampled at 6 m; a parapet block is 1.15 m), so
   *  the primitives resample rather than trusting the input. */
  const resample = (path, step) => {
    if (path.length < 2) return path.slice();
    const has3 = path[0].length > 2;
    const at = (p) => (has3 ? p : [p[0], 0, p[1]]);
    const pts = path.map(at);
    const out = [pts[0].slice()];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (len < 1e-6) continue;
      let t = carry;
      while (t + step <= len) {
        t += step;
        const k = t / len;
        out.push([lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]);
      }
      carry = t - len;
    }
    const last = pts[pts.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[2] - tail[2]) > step * 0.35) out.push(last.slice());
    return out;
  };

  /**
   * Sweep a closed 2D section along a HORIZONTAL polyline.
   *
   * `sectionAt(i, t, point)` returns `[[u, v], ...]` where **u points
   * to the LEFT of the direction of travel** and v is world up. Every
   * call must return the same number of points; the sweep clamps to
   * the shortest rather than tearing.
   *
   * WHY THIS IS NOT `kit.rockTube`. rockTube carries a parallel-
   * transported frame because its path can go vertical, where a
   * per-ring reference vector flips and the cross-section spins in one
   * step (structures.js records the arch that kept tearing at exactly
   * that seam). Here the path is a crevasse edge or a road parapet:
   * horizontal by construction, so the frame is pinned by world up and
   * the degenerate case cannot arise. It is also the reason the
   * section can be authored in real (metres across, metres up) terms
   * instead of in a rotating frame nobody can reason about.
   *
   * The section is force-wound clockwise in (u, v), the way `extrudeZ`
   * force-winds its profile (structures.js:270-285), because the side
   * faces' normals are decided ENTIRELY by that winding and no caller
   * should have to know it. The cathedral's nave roof was inside out
   * for exactly this reason.
   */
  const sweepProfile = (path, sectionAt, sweepOpts = {}) => {
    const n = path.length;
    if (n < 2) return new THREE.BufferGeometry();
    const capEnds = sweepOpts.capEnds !== false;
    const pos = [];
    const idx = [];
    const tri = makeTri(pos, idx);
    const starts = [];
    let width = Infinity;
    const sections = [];

    for (let i = 0; i < n; i += 1) {
      const p = path[i];
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0];
      let dz = b[2] - a[2];
      let len = Math.hypot(dx, dz);
      if (len < 1e-6) { dx = 1; dz = 0; len = 1; }
      dx /= len; dz /= len;
      /* Left of travel. (N, Y, T) is right-handed with this choice -
         N cross Y = T - which is what makes the winding argument
         above hold and the end caps come out facing away from the
         run rather than into it. */
      const nx = dz;
      const nz = -dx;
      let sec = sectionAt(i, n > 1 ? i / (n - 1) : 0, p) || [];
      /* Signed area in (u, v). Positive is counter-clockwise, which
         gives INWARD side normals here; reverse it. */
      let area2 = 0;
      for (let k = 0; k < sec.length; k += 1) {
        const q = sec[(k + 1) % sec.length];
        area2 += sec[k][0] * q[1] - q[0] * sec[k][1];
      }
      if (area2 > 0) sec = sec.slice().reverse();
      sections.push({ sec, p, nx, nz });
      width = Math.min(width, sec.length);
    }
    if (!Number.isFinite(width) || width < 3) return new THREE.BufferGeometry();

    for (const s of sections) {
      starts.push(pos.length / 3);
      for (let k = 0; k < width; k += 1) {
        const [u, v] = s.sec[k];
        pos.push(s.p[0] + s.nx * u, s.p[1] + v, s.p[2] + s.nz * u);
      }
    }
    for (let i = 0; i < n - 1; i += 1) {
      const s0 = starts[i];
      const s1 = starts[i + 1];
      for (let k = 0; k < width; k += 1) {
        const k1 = (k + 1) % width;
        tri(s0 + k, s1 + k, s1 + k1);
        tri(s0 + k, s1 + k1, s0 + k1);
      }
    }
    if (capEnds) {
      const s0 = starts[0];
      for (let k = 1; k < width - 1; k += 1) tri(s0, s0 + k, s0 + k + 1);
      const sN = starts[n - 1];
      for (let k = 1; k < width - 1; k += 1) tri(sN, sN + k + 1, sN + k);
    }
    return finish(pos, idx);
  };

  /**
   * Weld a geometry's vertices onto a quantised lattice and return
   * the triangle list in welded ids.
   *
   * `snowCap`'s load pass needs to know which faces SHARE a vertex -
   * it averages the load across them so adjacent faces do not tear,
   * and it finds the boundary of the loaded patch by counting edge
   * uses. Handed a `facet()`ed prop (and most alpine props are
   * faceted, because glacier ice and granite both want it) nothing is
   * shared at all: every triangle becomes its own island, gets its own
   * four-sided skirt, and a serac comes out wearing a hundred separate
   * stacked plates of snow. Welding first is what makes the primitive
   * safe to hand any geometry in the kit.
   *
   * 1 mm lattice: fine enough that two genuinely distinct vertices are
   * never merged at this world scale, coarse enough that float error
   * from a matrix multiply cannot split one.
   */
  const weld = (posAttr, quant = 1000) => {
    const map = new Map();
    const ids = new Int32Array(posAttr.count);
    const verts = [];
    for (let i = 0; i < posAttr.count; i += 1) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const key = `${Math.round(x * quant)}|${Math.round(y * quant)}|${Math.round(z * quant)}`;
      let id = map.get(key);
      if (id === undefined) {
        id = verts.length / 3;
        map.set(key, id);
        verts.push(x, y, z);
      }
      ids[i] = id;
    }
    return { ids, verts };
  };

  /**
   * The prop's plan silhouette as a radial star of `bins` maxima.
   *
   * A circle is the wrong footprint for almost everything on this
   * mountain - a serac is a rectangle, a bell frame is a long thin
   * bay, a pressure ridge is a line - and a circular drift collar
   * around a rectangular block leaves the block's corners standing
   * clear of their own snow, which is the exact failure the collar
   * exists to prevent. A radial max is cheap, handles any convex-ish
   * plan, and degrades to a circle for round props.
   *
   * `band` is how far up from the base to look. Only the lower band
   * counts: an overhanging crown is not a footprint, and using the
   * whole bounding box drifts snow against thin air under a serac's
   * toppled head.
   */
  const radialFootprint = (geo, bins = 24, band = 0.25) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) * 0.5;
    const cz = (bb.min.z + bb.max.z) * 0.5;
    const yMin = bb.min.y;
    const yMax = bb.max.y;
    const cut = yMin + Math.max(0.10, (yMax - yMin) * band);
    const r = new Float32Array(bins);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const y = p.getY(i);
      if (y > cut) continue;
      const dx = p.getX(i) - cx;
      const dz = p.getZ(i) - cz;
      const rad = Math.hypot(dx, dz);
      if (rad < 1e-5) continue;
      let a = Math.atan2(dz, dx);
      if (a < 0) a += TAU;
      const b = Math.min(bins - 1, Math.floor((a / TAU) * bins));
      if (rad > r[b]) r[b] = rad;
    }
    /* Fill and smooth. An empty bin (a thin plate leaves plenty) would
       pull the collar to the prop's centre and knot it; a single spike
       vertex would put a sawtooth in the drift outline. One circular
       [1,2,1]/4 pass is the same smoother buildPathProfile uses on the
       road, and one pass is enough - two rounds the corners off a
       rectangular plan back into the circle this exists to avoid. */
    let fallback = 0;
    for (let i = 0; i < bins; i += 1) fallback = Math.max(fallback, r[i]);
    if (fallback <= 0) fallback = Math.max(0.25, (bb.max.x - bb.min.x) * 0.5);
    for (let i = 0; i < bins; i += 1) if (r[i] <= 0) r[i] = fallback * 0.55;
    const sm = new Float32Array(bins);
    for (let i = 0; i < bins; i += 1) {
      sm[i] = (r[(i + bins - 1) % bins] + r[i] * 2 + r[(i + 1) % bins]) * 0.25;
    }
    return { cx, cz, r: sm, bins, yMin, yMax };
  };

  /** Position-hashed relief in [-1, 1]. Used by the displacement
   *  passes, which take no rng: they must be a pure function of
   *  position or the same trunk rimes differently on a reload. */
  const relief = (a, b) => noise(a, b);

  /* ================================================================
     ICE
     ================================================================ */

  /**
   * A serac: a fractured, toppling block of glacier ice.
   *
   * NOT A ROCK, and the distinction is the whole builder. `crag()`
   * produces a wind-cut lump with a smooth taper, which is what
   * erosion by air does. Ice does not erode, it FRACTURES: a serac is
   * a rectangular prism that the glacier's own bending has sheared
   * along a few near-planar surfaces and tipped off vertical, sitting
   * on a wide apron of the rubble it has already shed. Handed
   * `crag()`, the Glacier Tongue came out as a boulder field painted
   * cyan, and no amount of ice shader rescued it - the silhouette was
   * telling the truth about what the shape was.
   *
   * Built as three parts:
   *   - the block: four-sided rings, so it really is a prism, with a
   *     LINEAR shear rather than crag's quadratic lean. A rigid block
   *     toppling about its base shears linearly; a t-squared lean
   *     makes it look like it is bending, which ice a house high does
   *     not do.
   *   - the fracture ledges: one or two doubled ring pairs that step
   *     the section in by 6-14 percent over no height at all. That
   *     step is the sheared face, and it is the single detail that
   *     says "this broke" instead of "this was carved".
   *   - the apron: an eleven-sided, heavily jittered collar sunk
   *     below the base. Wide, because a serac stands in its own
   *     debris; crevassed, because the debris is blocks and not sand.
   *
   * opts: h, w, d, topple, fractures, sink, calved, seed-carrying rng.
   */
  function serac(rng, seracOpts = {}) {
    const {
      h = 9, w = 7, d = 5, topple = 0.20, fractures = 2,
      sink = 0.22, calved = 2, layers = 5,
    } = seracOpts;
    const geos = [];

    /* Topple heading is free, but the block leans DOWNHILL of the
       glacier, which the caller knows and this does not - so it is
       taken from opts when given and random otherwise. */
    const tA = seracOpts.toppleAngle ?? rng() * TAU;
    const tx = Math.cos(tA) * topple;
    const tz = Math.sin(tA) * topple;

    const rings = [];
    let phase = Math.PI / 4 + rng.jit(0.10);
    let shrink = 1;
    const ledges = new Set();
    for (let f = 0; f < fractures; f += 1) {
      ledges.add(1 + Math.floor(((f + 1) / (fractures + 1)) * (layers - 1)));
    }
    for (let i = 0; i <= layers; i += 1) {
      const t = i / layers;
      /* Phase drift capped hard. rockTube records what happens when a
         per-ring random walk tuned for four rings is handed sixty: the
         drift compounds into several full turns and the silhouette
         tears. Six rings at +-0.055 rad is a sheared block; the same
         rate at +-0.3 is a corkscrew. */
      phase += rng.jit(0.055);
      if (ledges.has(i)) {
        /* A doubled ring pair at the same height: the lower one at the
           outgoing section, the upper one stepped in. Zero height means
           zero-area side quads on the way through, which makeTri and
           ringSolid's own guard both drop. */
        rings.push({
          y: t * h, rx: (w / 2) * shrink, rz: (d / 2) * shrink,
          sides: 4, phase, jitter: 0.05, seed: rng.int(1, 1e6),
          cx: tx * h * t, cz: tz * h * t,
        });
        shrink *= rng.range(0.86, 0.94);
        phase += rng.jit(0.12);
      }
      shrink *= rng.range(0.965, 1.0);
      rings.push({
        y: t * h, rx: (w / 2) * shrink, rz: (d / 2) * shrink,
        sides: 4, phase, jitter: 0.06, seed: rng.int(1, 1e6),
        cx: tx * h * t, cz: tz * h * t,
      });
    }
    /* The base ring is pushed BELOW zero so the block is bedded in its
       own apron rather than resting on it. A serac whose lowest face
       is exactly the ground plane shows a hairline of daylight on any
       slope, and this level is nothing but slope. */
    rings[0].y = -h * sink;
    /* Four-gon rings at phase pi/4 put their corners at r/sqrt(2), so
       the section has to be scaled back out to make `w` and `d` mean
       metres - the same correction `slab()` applies (structures.js:190). */
    geos.push(kit.ringSolid(rings).scale(Math.SQRT2, 1, Math.SQRT2));

    /* The apron. Odd side count and heavy per-side jitter: this is a
       ring of shed blocks, and an even, gentle collar reads as a
       fillet weld. */
    const footR = Math.hypot(w, d) * 0.5;
    geos.push(kit.ringSolid([
      { y: -h * sink * 1.9, r: footR * 0.92, sides: 11, phase: rng() * TAU, jitter: 0.22, seed: rng.int(1, 1e6) },
      { y: -h * sink * 0.55, r: footR * 1.34, sides: 11, phase: rng() * TAU, jitter: 0.30, seed: rng.int(1, 1e6) },
      { y: h * 0.07, r: footR * 1.02, sides: 11, phase: rng() * TAU, jitter: 0.26, seed: rng.int(1, 1e6) },
    ]));

    /* Calved fragments leaning on the apron. Two is usually enough:
       they exist to break the block's base silhouette, and past three
       they start reading as a talus pile and the block stops looking
       like it is standing. */
    for (let i = 0; i < calved; i += 1) {
      const a = rng() * TAU;
      const rr = footR * rng.range(0.95, 1.45);
      const s = kit.shard(rng, {
        height: h * rng.range(0.16, 0.34), radius: w * rng.range(0.10, 0.19),
        sides: 4, sharpness: 0.35, lean: 1.1,
      });
      kit.transform(s, {
        pos: [Math.cos(a) * rr, -h * sink * 0.4, Math.sin(a) * rr],
        rot: [rng.jit(0.7), rng() * TAU, rng.jit(0.7)],
      });
      geos.push(s);
    }

    let g = mergeGeometries(THREE, geos);
    /* Faceted, and here that is the PHYSICAL answer rather than the
       stylistic one: every visible surface on a serac is a fracture
       plane. `glacierIce` is a flat-shaded material already, so this
       does not change the shading - what it buys is per-facet vertex
       colour, which is how the ramp's cyan-in-depth ends up banded
       across the fracture faces instead of smeared over them. It costs
       six times the vertices and no draw calls; a Tongue with two
       hundred seracs should pass `facet: false` and take the smear. */
    if (seracOpts.facet !== false) g = kit.facet(g);
    if (seracOpts.paint === false) return g;
    /* GLACIER_RAMP is inverted relative to snow - the saturation lives
       at the DARK end, because ice is cyan where it is thick. Explicit
       min/max, never the geometry's own bounding box (contract 4.4):
       on a merged Tongue mesh the default would map the whole ramp
       across whatever happened to land in the bin. */
    return paintByHeight(THREE, g, GLACIER_RAMP, {
      min: -h * sink * 1.9, max: h * 1.06,
      normalWeight: 0.42, noise: 0.16, cavity: 0.82, bias: -0.04,
    });
  }

  /**
   * The overhanging snow cornice at a crevasse edge, with the undercut.
   *
   * A cornice is the one snow feature that is NOT a height field: it
   * cantilevers out over the void and hollows back underneath, so
   * there is a column of air with snow above and below it. The contract
   * says so explicitly (section 3.2: "a crevasse with an overhanging
   * lip is not a height-field feature"), which is why this is
   * geometry and why the crevasse itself is a slot cut in `heightAt`.
   *
   * The section, in the sweep's (u = toward the void, v = up) frame:
   *
   *        crest ___
   *              /   \___  tip          <- cantilever, OVER the void
   *   ---snow---/        \
   *            |      __/               <- the undercut, back INBOARD
   *            |     /
   *            |____/                   <- down the crevasse wall
   *
   * THE OVERHANG HAS TO BE A REAL DISTANCE. A tip that reaches 0.2 m
   * past the deepest point of the undercut is a rounded edge, not a
   * cornice, and at eye level - which is where the `crevasse-edge`
   * beauty shot is taken - it reads as a soft terrain fillet and the
   * whole feature disappears. The floor here is 0.35 of the cornice
   * height, clamped, and the clamp is deliberate: a caller asking for
   * a 3 m cornice with a 0.1 m overhang gets 1.05 m and a shape that
   * still works.
   *
   * The run is not uniform. Two things vary along it: a low-frequency
   * scallop, because wind loading is lobed rather than even, and
   * occasional FRACTURE SCARS where a section has already calved and
   * the overhang drops to nothing. The scars matter more than the
   * scallop - a continuous cornice down a 200 m edge is the tell that
   * it was extruded.
   *
   * Both ends taper to zero rather than terminating in a wall of snow,
   * which is also why the sweep needs no end caps: there is nothing
   * left to cap, and a fan cap across this section would span the
   * undercut and fill it in (the concave-profile failure structures.js
   * records for `extrudeZ`).
   *
   * `opts.edge` must be ordered so that THE VOID IS ON THE LEFT of the
   * direction of travel, because that is the side `sweepProfile`'s
   * positive u points to. Ordered the other way the cornice
   * cantilevers over solid ground and undercuts the snow the player is
   * standing on, which looks like a shading bug rather than a
   * backwards polyline.
   *
   * extras: `{ lip }` - the polyline of the cantilevered tip, in world
   * space, ready to hand straight to `icicleFringe`. Stations inside a
   * fracture scar are omitted: there is no tip there to hang from.
   */
  function crevasseLip(rng, lipOpts = {}) {
    const {
      edge = [], height = 2.2, over = 1.6, under = 1.9, inboard = 2.6,
      wall = 3.5, step = 1.6, scars = 0.16,
    } = lipOpts;
    if (edge.length < 2) return { geo: new THREE.BufferGeometry(), extras: { lip: [] } };
    const path = resample(edge, step);
    const n = path.length;

    /* Per-station modulation, drawn once so the sweep and the lip
       polyline cannot disagree about where the scars are. */
    const gain = new Float32Array(n);
    const scarPhase = rng() * 100;
    for (let i = 0; i < n; i += 1) {
      const t = n > 1 ? i / (n - 1) : 0;
      const scallop = 0.72 + 0.28 * (relief(t * 3.1 + scarPhase, 0.5) * 0.5 + 0.5);
      /* A scar is a hard local collapse, not a dip: the low-frequency
         noise is thresholded rather than scaled, so the overhang goes
         to nothing over about a metre and comes back. */
      const scar = scars > 0
        ? sstep(0.62 - scars, 0.62, relief(t * 7.7 - scarPhase, 3.3) * 0.5 + 0.5)
        : 0;
      /* Ends taper out into flat snow. Without this the run stops in a
         vertical face of snow that nothing supports. */
      const ends = Math.min(sstep(0, 0.06, t), sstep(1, 0.94, t));
      gain[i] = clamp01(scallop * (1 - scar * 0.92) * ends);
    }

    const overhang = Math.max(over, height * 0.35);
    const geo = sweepProfile(path, (i) => {
      const k = gain[i];
      const crest = height * k;
      const o = overhang * k;
      const u = under * k;
      return [
        [-inboard, -wall * 0.35],
        [-inboard, 0],
        [o * 0.42, crest],
        [o, crest * 0.82],
        /* The undercut comes back INBOARD of the tip. That inequality
           is the overhang; everything else in the section is dressing. */
        [o * 0.66, -u * 0.42],
        [o * 0.14, -u],
        [-inboard * 0.30, -wall],
      ];
    }, { capEnds: false });

    /* The lip polyline, derived in its own pass rather than collected
       from inside the section callback. `sweepProfile` promises to
       call that callback once per station in order, but a builder that
       depends on the call ORDER of somebody else's loop is a builder
       that breaks silently the day the sweep is optimised - and the
       failure would be a fringe of icicles hanging in the wrong places
       along a two-hundred-metre edge, which nothing tests. */
    const lip = [];
    for (let i = 0; i < n; i += 1) {
      const k = gain[i];
      if (k <= 0.02) continue;          // inside a fracture scar: no tip to hang from
      const d = dirLeft(path, i);
      const o = overhang * k;
      lip.push([path[i][0] + d.x * o, path[i][1] + height * k * 0.82, path[i][2] + d.z * o]);
    }

    if (lipOpts.paint === false) return { geo, extras: { lip } };
    /* SLAB_RAMP, not SNOW_RAMP. A cornice is wind slab by definition -
       it is snow the wind compacted and cantilevered - and slab's
       narrower, bluer range is what makes it read as a different
       substance from the drift it grows out of. The undercut catches
       the ramp's dark end through `cavity`, which is correct: the one
       surface on this level that genuinely never sees the sun. */
    return {
      geo: paintByHeight(THREE, geo, SLAB_RAMP, {
        min: -wall, max: height * 1.1,
        normalWeight: 0.46, noise: 0.10, cavity: 0.66,
      }),
      extras: { lip },
    };
  }

  /** The sweep's left-of-travel unit vector at station i, recomputed
   *  for the lip polyline so it lands on exactly the same points the
   *  sweep used. Deriving it a second time from the same path is
   *  cheaper than threading the frame out of `sweepProfile`, and it
   *  cannot drift because it is the same three lines of arithmetic. */
  function dirLeft(path, i) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    return { x: dz, z: -dx };
  }

  /**
   * A run of icicles hung off an edge polyline, batched into ONE
   * geometry.
   *
   * This goes on EVERY ledge in the level - the cathedral's roof
   * pitches, every serac lip, the Cascade's shelves, the parapet
   * coping, the bell mouths - so the cost model is the whole design.
   * One geometry per RUN, not per icicle: a four-sided, four-ring
   * icicle is about thirty triangles, so a four-hundred-icicle
   * cathedral eave is twelve thousand triangles in one buffer that
   * merges into its station's bin and frustum-culls with it.
   *
   * VARIATION BY EXPOSURE, not by rng alone. `opts.exposure(x, y, z)`
   * returns 0..1 and scales the length: a sheltered north eave grows
   * stubs, a dripping lip grows a curtain. On top of that sits a
   * low-frequency wave along the run, because meltwater CONCENTRATES -
   * real fringes come in long-short-long lobes, and a fringe whose
   * lengths are independent per icicle reads as a comb.
   *
   * Icicles hang from y=0 down to y=-length in each icicle's own local
   * frame, so the ring list runs tip-first: `ringSolid`'s bottom cap
   * then closes the tip facing down and its top cap closes the root
   * facing up, buried in the ledge. Both are kept - the root cap costs
   * four triangles and prevents an open tube where a ledge turns out
   * to be thinner than the icicle's root radius.
   *
   * The caller sets `userData.noCollide`: these are sub-decimetre
   * triangles, so collide.js's 0.5 m footprint filter would drop most
   * of them anyway, and the ones it kept would be an invisible fence
   * under every eave.
   */
  function icicleFringe(edgePts, fringeOpts = {}) {
    const {
      spacing = 0.42, length = 0.9, lengthVary = 0.6, radius = 0.055,
      max = 420, sides = 4, lean = 0.10, seed = 0x1c1c1e,
    } = fringeOpts;
    if (!edgePts || edgePts.length < 2) return new THREE.BufferGeometry();
    const rng = makeRng(seed);
    const path = resample(edgePts, spacing);
    const exposure = fringeOpts.exposure || (() => 1);
    const geos = [];
    const wavePhase = rng() * 40;

    for (let i = 0; i < path.length && geos.length < max; i += 1) {
      const p = path[i];
      const t = path.length > 1 ? i / (path.length - 1) : 0;
      const expo = clamp01(exposure(p[0], p[1], p[2]));
      /* The drip lobe. Wavelength ~11 stations, so at the default
         spacing a lobe is about 4.5 m - long enough to read as a
         curtain and short enough that a 30 m eave carries several. */
      const lobe = 0.35 + 0.65 * clamp01(relief(t * (path.length / 11) + wavePhase, 1.7) * 0.5 + 0.5);
      const len = length * expo * lerp(1 - lengthVary, 1 + lengthVary, lobe) * rng.range(0.72, 1.18);
      /* Below about 12 cm an icicle is a sub-pixel speck at any
         distance the fringe is legible from, and it costs the same
         thirty triangles as one that reads. Drop it. */
      if (len < 0.12) continue;
      const r0 = radius * lerp(0.6, 1.25, expo) * rng.range(0.8, 1.2);
      const rings = [];
      const segs = 4;
      for (let s = 0; s <= segs; s += 1) {
        const k = s / segs;                     // 0 at the tip, 1 at the root
        /* Ribbed: real icicles grow in rings, and the ripple is what
           stops a cone reading as a traffic bollard at close range.
           Amplitude scales with radius so the tip stays a point. */
        const ripple = 1 + Math.sin(k * Math.PI * 5.3) * 0.16 * k;
        rings.push({
          y: -len * (1 - k),
          r: Math.max(0.004, r0 * Math.pow(k, 0.62) * ripple),
          sides,
          phase: rng.jit(0.4),
          /* Wind lean. Icicles freeze off vertical in a steady wind,
             and every one on the level leaning the same way is a free
             restatement of the wind bearing. Applied as a per-ring
             offset growing toward the tip. */
          cx: wind.x * lean * len * (1 - k) * (1 - k),
          cz: wind.z * lean * len * (1 - k) * (1 - k),
        });
      }
      const g = kit.ringSolid(rings);
      /* Painted PER ICICLE, before the merge, because the tonal cue is
         thickness and thickness is only knowable in the icicle's own
         frame. Clear ice is cyan where it is thick and near-white
         where it is thin, so the root sits low on GLACIER_RAMP and the
         tip runs to its pale edge - the ramp's dark end is where the
         saturation is (summit-art.js:209). */
      if (fringeOpts.paint !== false) {
        paintGeometry(THREE, g, GLACIER_RAMP, (x, y) => 0.30 + 0.62 * clamp01(-y / len), { jitter: 0.10 });
      }
      g.translate(p[0], p[1], p[2]);
      geos.push(g);
    }
    if (!geos.length) return new THREE.BufferGeometry();
    /* NEVER `facet()` after this point. Every icicle already carries a
       colour attribute, and facet copies only position (structures.js:2030) -
       the whole fringe would come back black. */
    return mergeGeometries(THREE, geos);
  }

  /**
   * The Frozen Cascade's organ pipes: fused vertical columns of
   * varying diameter with bulbous bases.
   *
   * Built as N SEPARATE columns that overlap, never as one wide ring
   * stack. A 26 m curtain 3 m deep is a 9:1 cross-section, and
   * `ringSolid` samples an ellipse at uniform ANGLE - the yardang note
   * measured a 5:1 fin at nine sides coming out as a visible layer
   * cake, and this is twice as extreme. Overlapping cylinders also
   * give the thing its actual silhouette for free: the gaps between
   * pipes, where the light comes through, which is the entire subject
   * of the `cascade-backlit` beauty shot.
   *
   * Three details that are the difference between organ pipes and a
   * palisade fence:
   *   - FUSION. Column radii are drawn as a fraction of the spacing,
   *     with the low end above 0.5, so adjacent pipes always
   *     interpenetrate and the curtain merges into one mass at the
   *     back while staying separate at the front.
   *   - BULBOUS BASES. Falling water splashes and re-freezes, so a
   *     real ice column is fattest and lumpiest at the bottom. A
   *     constant-radius pipe reads as extruded plastic.
   *   - BROKEN PIPES. A fraction of the columns stop short of the
   *     ground or short of the lip. A curtain where every pipe spans
   *     the full drop is a comb.
   */
  function columnarIce(rng, iceOpts = {}) {
    const {
      h = 18, span = 24, columns = 13, lean = 0.16, broken = 0.22,
      sides = 6, bulge = 1.9,
    } = iceOpts;
    const geos = [];
    const spacing = span / Math.max(1, columns - 1);
    for (let c = 0; c < columns; c += 1) {
      const x = (c / Math.max(1, columns - 1) - 0.5) * span + rng.jit(spacing * 0.18);
      const z = rng.jit(spacing * 0.55);
      /* Radius as a fraction of spacing, floored above 0.5 so the
         columns cannot fail to touch. This is the fusion guarantee and
         it is why the range is expressed this way rather than in
         metres: change `columns` and the curtain stays fused. */
      const r = spacing * rng.range(0.54, 1.02);
      const top = h * (rng.chance(broken) ? rng.range(0.45, 0.85) : rng.range(0.96, 1.0));
      const foot = rng.chance(broken) ? h * rng.range(0.08, 0.30) : 0;
      const rings = [];
      const segs = 7;
      for (let s = 0; s <= segs; s += 1) {
        const k = s / segs;
        const y = lerp(foot, top, k);
        /* Bulb at the base, pinches up the shaft, slight flare where
           the pipe meets the lip. `bulge` at the foot decays over the
           bottom fifth; the pinch is a sine on top of a mild taper. */
        const bulb = foot > 0 ? 1 : lerp(bulge, 1, clamp01(k / 0.22));
        const pinch = 1 + Math.sin(k * Math.PI * 3.1 + c) * 0.13;
        const taper = lerp(1, 0.78, Math.pow(k, 1.3));
        rings.push({
          y,
          r: r * bulb * pinch * taper * rng.range(0.93, 1.07),
          sides,
          phase: rng() * TAU,
          jitter: foot > 0 || k > 0.22 ? 0.09 : 0.20,
          seed: rng.int(1, 1e6),
          /* The curtain leans downwind, the way the art direction asks
             every directional thing on the level to. Quadratic in
             height: the lean is accumulated by the freeze, so the top
             of a pipe is displaced far more than its middle. */
          cx: x + wind.x * lean * h * k * k,
          cz: z + wind.z * lean * h * k * k,
        });
      }
      geos.push(kit.ringSolid(rings));
    }
    let g = mergeGeometries(THREE, geos);
    /* Default OFF, unlike the serac. A thirteen-column curtain is
       already ~5k triangles and the Cascade wants several of them;
       `cascadeIce` is a flat-shaded material so the shading is
       identical either way, and the only thing faceting buys is
       per-facet colour banding. Pay for it on a hero curtain, not on
       the whole cirque. */
    if (iceOpts.facet === true) g = kit.facet(g);
    if (iceOpts.paint === false) return g;
    return paintByHeight(THREE, g, GLACIER_RAMP, {
      min: 0, max: h,
      normalWeight: 0.30, noise: 0.14, cavity: 0.85, bias: -0.06,
    });
  }

  /**
   * The Black Tarn's pressure ridges: shattered, upthrust ice plates.
   *
   * A pressure ridge is what happens when two sheets of lake ice
   * converge: the ice buckles and SHATTERS into thin plates that
   * lever up out of the sheet and jam against each other. Two
   * properties carry the whole read and both are easy to lose:
   *
   *   - THE PLATES ARE THIN AND BIG. Three metres across and thirty
   *     centimetres thick. That is a 10:1 shape, and it is built with
   *     `polyExtrudeY` on an irregular quad footprint precisely
   *     because `ringSolid` cannot do 10:1 without layer-caking. It
   *     also gets the fractured outline for free: four jittered
   *     corners read as a broken slab, four regular ones read as a
   *     playing card.
   *   - THEY COME OUT OF THE SHEET, they do not sit on it. Every
   *     plate is seated BELOW y=0 so its lower end is still frozen in.
   *     A ridge of plates resting on the surface is a pile of litter.
   *
   * Tilts alternate in sign along the run so the plates interlock the
   * way real ones do, with enough jitter that the alternation is not
   * a pattern. Rubble at the foot is what hides the intersections.
   */
  function pressureRidge(rng, ridgeOpts = {}) {
    const {
      length = 26, height = 2.4, plates = 16, thickness = 0.34,
      tilt = 1.05, embed = 0.45, rubble = 10, points = null,
    } = ridgeOpts;
    const geos = [];
    const path = points && points.length > 1 ? resample(points, length / plates) : null;
    /* `rotY` is the value to hand `kit.transform`'s rot[1], not the
       heading: a shape built along local +X is aligned to a tangent by
       rotating by MINUS the tangent's yaw, which is the convention
       `catwalk` uses (structures.js:1530) and the one that has already
       been debugged once in this codebase. */
    const at = (k) => {
      if (!path) return { x: (k - 0.5) * length, y: 0, z: 0, rotY: 0 };
      const i = clamp(Math.round(k * (path.length - 1)), 0, path.length - 1);
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      return {
        x: path[i][0], y: path[i][1], z: path[i][2],
        rotY: -Math.atan2(b[2] - a[2], b[0] - a[0]),
      };
    };

    for (let i = 0; i < plates; i += 1) {
      const k = plates > 1 ? i / (plates - 1) : 0.5;
      const st = at(k);
      const pw = height * rng.range(0.55, 1.35);
      const th = thickness * rng.range(0.6, 1.5);
      const len = height * rng.range(0.8, 1.5) + embed;
      /* Four jittered corners. The jitter is a fraction of the plate,
         so a small plate does not come out as a spike. */
      const j = () => rng.range(0.78, 1.22);
      const foot = [
        [-pw * 0.5 * j(), -th * 0.5 * j()],
        [pw * 0.5 * j(), -th * 0.5 * j()],
        [pw * 0.5 * j(), th * 0.5 * j()],
        [-pw * 0.5 * j(), th * 0.5 * j()],
      ];
      const g = kit.polyExtrudeY(foot, 0, len);
      /* Lever it up: rotate about the ridge's own axis so the plate
         tips ACROSS the ridge, then yaw it onto the run's heading. The
         alternating sign is what makes neighbouring plates jam. */
      const sign = i % 2 === 0 ? 1 : -1;
      kit.transform(g, {
        rot: [sign * tilt * rng.range(0.55, 1.15), st.rotY + rng.jit(0.35), rng.jit(0.22)],
      });
      g.translate(st.x + rng.jit(0.5), st.y - embed, st.z + rng.jit(0.5));
      geos.push(g);
    }

    for (let i = 0; i < rubble; i += 1) {
      const k = rng();
      const st = at(k);
      const c = kit.crag(rng, {
        height: height * rng.range(0.12, 0.30), radius: height * rng.range(0.10, 0.26),
        layers: 3, sides: rng.int(5, 7), lean: 0.4, sink: 0.55,
      });
      c.translate(st.x + rng.jit(height * 0.9), st.y - embed * 0.4, st.z + rng.jit(height * 0.9));
      geos.push(c);
    }

    let g = mergeGeometries(THREE, geos);
    if (ridgeOpts.facet === true) g = kit.facet(g);
    if (ridgeOpts.paint === false) return g;
    /* BLACKICE_RAMP is overwhelmingly dark with the light end reserved
       for the lips that catch the sky - which on a pressure ridge is
       literally what the upturned plate edges are. High normalWeight
       and a positive bias put that reserve where it belongs; painting
       this by height alone would light the whole ridge evenly and
       waste the ramp's entire top half. */
    return paintByHeight(THREE, g, BLACKICE_RAMP, {
      min: -embed, max: height * 1.15,
      normalWeight: 0.52, bias: 0.06, noise: 0.13, cavity: 0.60,
    });
  }

  /* ================================================================
     SNOW
     ================================================================ */

  /**
   * RIME FEATHERS - a displacement pass, not a solid.
   *
   * Rime forms when supercooled fog freezes on contact, so it grows
   * INTO the wind, on the windward face, and nowhere else. That
   * directionality is the entire effect: a prop rimed all over is a
   * prop covered in snow, and a whole forest of them rimed on one
   * shared heading is a forest with weather in it.
   *
   * Implemented as displacement because the alternative - modelling
   * feathers as geometry - is unaffordable. The Rime Forest is a
   * stand of conifers; feathering one trunk as solids costs more
   * triangles than the trunk, and there are dozens.
   *
   * `windDir` is the direction the wind TRAVELS (matching uWind's
   * packing) and may be an array, a Vector2, a Vector3 or a bearing in
   * degrees. Faces are selected by how hard they face UPWIND.
   *
   * WHERE THIS MUST SIT IN THE PIPELINE, and it is not negotiable:
   * BEFORE `kit.facet()`. A faceted geometry shares nothing, so
   * displacing it moves each triangle independently and the surface
   * tears into confetti with daylight between every face. The guard
   * below refuses an unindexed geometry outright rather than producing
   * that silently - it is the kind of failure that looks like a
   * shader bug for an hour.
   *
   * It also blends RIME_RAMP into an existing colour attribute where
   * the exposure is high. That is not scope creep: rime is off-white
   * against dark bark and dark granite, and geometry alone cannot say
   * so. RIME_RAMP is deliberately short-range (summit-art.js:241) -
   * rime's shape is carried by the feathers, which are these, so the
   * paint only has to change the substance.
   */
  function rimeFeathers(geo, windDir, featherOpts = {}) {
    const {
      amount = 0.22, scale = 1.0, threshold = 0.12, power = 1.7,
      rootBand = 0.0, rootTaper = 0.6, normalMix = 0.42,
    } = featherOpts;
    if (!geo || !geo.attributes || !geo.attributes.position) return geo;
    if (!geo.index) {
      /* Not an error the caller can ignore: displacing a non-indexed
         (facet()ed, or merged-from-faceted) geometry tears it. */
      console.warn("[summit-structures] rimeFeathers: geometry is not indexed - run it BEFORE kit.facet(), not after.");
      return geo;
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();

    const w = normaliseWind(windDir);
    const ux = -w.x;
    const uz = -w.z;
    /* The cross-wind horizontal axis. Feather ribs stack along the
       surface, so the noise has to vary fast across the wind and
       slowly along it - noise sampled isotropically produces lumps,
       not blades. */
    const cx = -uz;
    const cz = ux;

    const p = geo.attributes.position;
    const nrm = geo.attributes.normal;
    geo.computeBoundingBox();
    const baseY = geo.boundingBox.min.y;
    const expo = new Float32Array(p.count);

    for (let i = 0; i < p.count; i += 1) {
      const nx = nrm.getX(i);
      const ny = nrm.getY(i);
      const nz = nrm.getZ(i);
      /* How hard this vertex faces into the wind. The vertical
         component is discounted rather than ignored: an up-facing
         ledge does catch rime, just far less than a vertical windward
         face, and zeroing it leaves a bald cap on every trunk. */
      const face = clamp01(nx * ux + nz * uz + Math.max(0, ny) * 0.18);
      if (face <= threshold) { expo[i] = 0; continue; }
      const e = Math.pow((face - threshold) / (1 - threshold), power);
      /* Root taper. Feathers growing at the base would lift the object
         off its own ground on the windward side - the bedding rule
         run backwards. */
      const root = rootBand > 0
        ? sstep(rootBand, rootBand + rootTaper, p.getY(i) - baseY)
        : 1;
      /* An optional caller-supplied mask, multiplied in.
         ADDED FOR THE CATHEDRAL, and the reason generalises. Face
         selection alone is right for a prop - a tree, a bell frame,
         a cairn is convex and its windward faces are all outside.
         It is wrong for anything HOLLOW: the inside of a building's
         leeward wall has a normal pointing straight into the wind
         vector, so a sealed chapel rimed by facing alone grows a
         beard on its interior masonry, indoors, on the sheltered
         side. There is no symptom until somebody walks in.
         A predicate is the cheapest fix that keeps the primitive
         general - one call per vertex, only on vertices that already
         passed the facing test. Returning 0 skips the vertex
         entirely, including its paint. */
      const gate = featherOpts.mask
        ? clamp01(featherOpts.mask(p.getX(i), p.getY(i), p.getZ(i), nx, ny, nz))
        : 1;
      expo[i] = e * root * gate;
    }

    /* Irrational-ish wavenumbers. The memory note on procedural
       lattices is explicit: rational frequency ratios re-phase on a
       grid and the "feathers" resolve into a plaid at grazing light,
       which on a level whose whole texture story is grazing light is
       the one failure that cannot be hidden. */
    const fA = 1.6180 * scale;
    const fB = 4.3166 * scale;
    for (let i = 0; i < p.count; i += 1) {
      const e = expo[i];
      if (e <= 0) continue;
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const across = x * cx + z * cz;
      const n = relief(across * fA, y * fB) * 0.66
        + relief(across * fA * 2.31 + 11.7, y * fB * 2.13 - 4.1) * 0.34;
      const d = amount * e * (0.55 + 0.45 * n);
      /* Two components: along the wind (feathers point upwind) and
         along the surface normal (they stand OFF the surface). Wind
         alone slides the silhouette sideways and reads as a modelling
         mistake; normal alone is a lumpy coat and has no heading. */
      p.setXYZ(
        i,
        x + ux * d * (1 - normalMix) + nrm.getX(i) * d * normalMix,
        y + nrm.getY(i) * d * normalMix,
        z + uz * d * (1 - normalMix) + nrm.getZ(i) * d * normalMix
      );
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();

    const col = geo.attributes.color;
    if (col && featherOpts.paint !== false && col.itemSize === 3) {
      /* Written straight into the typed array rather than through
         `getComponent` / `setComponent`. Two reasons and both matter:
         the accessor pair is not present in every three build this
         project has run against, and this is a per-vertex loop over a
         whole geometry where the accessor path is measurably slower
         for no benefit. The colour attribute here is always a
         non-interleaved Float32 buffer of itemSize 3 (art.js:1704
         builds it), which is what makes the direct index safe - hence
         the itemSize guard rather than a comment hoping for it. */
      const ca = col.array;
      for (let i = 0; i < p.count; i += 1) {
        const m = clamp01(expo[i] * (featherOpts.tint ?? 1.0));
        if (m <= 0.01) continue;
        const c = RIME_RAMP.at(0.35 + 0.5 * m);
        /* RIME_RAMP is authored in sRGB and the buffer is linear
           (art.js:963's srgbTransfer runs on every paint), so the mix
           has to happen in linear or a half-rimed face gets a bright
           seam. Squaring is close enough to the transfer over this
           narrow, bright range and costs one multiply. */
        for (let k = 0; k < 3; k += 1) {
          ca[i * 3 + k] = lerp(ca[i * 3 + k], c[k] * c[k], m);
        }
      }
      col.needsUpdate = true;
    }
    return geo;
  }

  function normaliseWind(w) {
    if (w === undefined || w === null) return wind;
    if (typeof w === "number") return windVector(w);
    let x;
    let z;
    if (Array.isArray(w)) {
      x = w[0];
      z = w.length > 2 ? w[2] : w[1];
    } else {
      x = w.x;
      z = w.z !== undefined ? w.z : w.y;
    }
    const len = Math.hypot(x, z);
    if (!(len > 1e-6)) return wind;
    return { x: x / len, z: z / len };
  }

  /**
   * SNOW CAP - the drift skin that beds a prop into its own snow.
   *
   * THE MOST IMPORTANT PRIMITIVE IN THIS FILE. A prop standing ON the
   * snow instead of IN it is the clearest tell that a snow level is a
   * reskin, and no material fixes it: the eye reads the contact, not
   * the surface. Every standing thing on this mountain goes through
   * here.
   *
   * Three products, one call:
   *
   *   1. `extras.seatY` / `extras.bed` - how far down the prop itself
   *      should be moved. `bed` comes from the SNOW DEPTH FIELD, not
   *      from a constant: the layout defines depth as a real scalar
   *      field with four consumers and says outright that if any of
   *      them computes its own they drift apart and the level looks
   *      like snow painted on. This is consumer number two.
   *
   *      `seatY` uses the MINIMUM ground under the whole footprint,
   *      not the centre - the yardang lesson, and world.js:4352's dune
   *      version of it. Seat a five-metre block on its centre height
   *      and its downhill corner hangs in air on any slope; this level
   *      is nothing but slope. The height that costs is paid back by
   *      the drift collar, which rises against the uphill side anyway.
   *
   *   2. The DRIFT COLLAR - a three-ring skirt around the radial
   *      footprint. Its shape is the wind's, not a fillet's: the
   *      windward foot is SCOURED (a shallow moat, drift height goes
   *      negative) and the lee side carries a long deep tail. A collar
   *      that is symmetric about the prop is a rubber gasket, and it
   *      is worse than nothing because it says the wind is not real.
   *
   *      Three rings rather than two. Two gives a cone; the third puts
   *      a shoulder in the drift, which is the profile blown snow
   *      actually takes against an obstacle.
   *
   *   3. The SNOW LOAD - real thickness on every up-facing face,
   *      culled at 38 degrees (art direction section 4: above that it
   *      does not hold), with a skirt down the boundary so the load
   *      is a slab with an edge and not a decal. The skirt is what
   *      makes it survive an eye-level frame, which is the art
   *      direction's stated bar.
   *
   * FRAME. Everything here works in the geometry's OWN coordinates,
   * and `depthAt` / `opts.groundAt` must be in the same frame. Handing
   * this a local-space prop and the world-space samplers puts every
   * drift on the level at the depth measured at the map origin - which
   * is a plausible-looking number, so nothing fails and every prop is
   * subtly wrong. Callers that build in local space should pass
   * wrapped samplers that add the prop's world offset.
   *
   * REJECTED: per-face occlusion testing to keep snow out from under
   * overhangs ("under overhangs it does not fall"). Ray-casting every
   * selected face against the prop's own triangles is O(F^2); measured
   * on a 3k-triangle serac that is nine million tests per prop, and
   * the Tongue has hundreds. `opts.shelter(x, y, z)` is the escape
   * hatch for the handful of props where it matters (the cathedral
   * porch, the bell frame's headstock) and it costs nothing when
   * absent.
   */
  function snowCap(geo, depthAt, capOpts = {}) {
    const {
      bins = 24, band = 0.25, inset = 0.94, bedFactor = 0.55, maxBed = 1.1,
      load = 1.0, maxFaces = 6000, minLoadY = -Infinity, minLoadArea = 0.05,
    } = capOpts;
    const empty = { geo: new THREE.BufferGeometry(), extras: { bed: 0, seatY: 0, footprint: null, loadFaces: 0, loadArea: 0 } };
    if (!geo || !geo.attributes || !geo.attributes.position) return empty;

    const depth = typeof depthAt === "function" ? depthAt : () => (depthAt || 0.6);
    const groundAt = capOpts.groundAt || null;
    const shelter = capOpts.shelter || null;
    const foot = radialFootprint(geo, bins, band);

    /* ---- 1. bedding ------------------------------------------- */
    let ambient = 0;
    let support = Infinity;
    for (let i = 0; i < bins; i += 1) {
      const a = (i / bins) * TAU;
      const x = foot.cx + Math.cos(a) * foot.r[i] * 0.7;
      const z = foot.cz + Math.sin(a) * foot.r[i] * 0.7;
      ambient += Math.max(0, depth(x, z));
      if (groundAt) support = Math.min(support, groundAt(x, z));
    }
    ambient /= bins;
    if (!Number.isFinite(support)) support = 0;
    /* Bedding is a FRACTION of the ambient depth, not the whole of it.
       A prop sunk by the full snow depth is standing on the summer
       ground with a metre of snow round it, which is right for a fence
       post and wrong for a serac that arrived on top of the snowpack.
       0.55 is the value that reads for both; the caller overrides it
       for anything that genuinely sits on bedrock. */
    const bed = Math.min(maxBed, ambient * bedFactor);
    const seatY = support - bed;

    const geos = [];

    /* ---- 2. the drift collar ---------------------------------- */
    {
      const pos = [];
      const idx = [];
      const tri = makeTri(pos, idx);
      const RINGS = 3;
      const ringR = [];
      const ringY = [];
      for (let ring = 0; ring < RINGS; ring += 1) ringR.push(new Float32Array(bins));
      for (let ring = 0; ring < RINGS; ring += 1) ringY.push(new Float32Array(bins));

      for (let i = 0; i < bins; i += 1) {
        const a = (i / bins) * TAU;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        /* `lee` is 1 on the downwind side of the prop, 0 on the
           windward side. Note the sign: the bin direction is the way
           OUT from the prop, so the bins pointing along the wind's
           travel are the lee ones. */
        const lee = clamp01((dx * wind.x + dz * wind.z) * 0.5 + 0.5);
        const local = Math.max(0, depth(foot.cx + dx * foot.r[i], foot.cz + dz * foot.r[i]));
        const amb = local > 0 ? local : ambient;
        /* Negative on the windward side: that is the scour moat, and
           it is the half of the shape that says "wind" rather than
           "glue". A 0.18 dip against a 1.35 tail is the ratio in
           every photograph of a drifted fence post. */
        const rise = amb * lerp(-0.18, 1.35, lee) * load;
        /* --- A DRIFT TAIL IS SET BY THE OBSTACLE, NOT THE SNOWPACK --

           `amb` is the local snow depth, so on deep ground a 5m prop
           grew a tail of thirty metres and its collar came out sixty
           metres across - a 20-gon skirt wide enough to fill the
           bottom third of an eye-level frame. A blind reviewer called
           one "a flat untextured white hexagon, an obvious unshipped
           plane" and lost the frame on it alone, and the merged
           collars of a cluster are worse than any single one.

           What actually sets the length of a lee drift is the size of
           the thing interrupting the wind. Two and a bit footprint
           radii is the number in every photograph of a drifted post
           or boulder; the depth still scales it, it just cannot run
           away with it any more. */
        const tail = Math.min(
          amb * lerp(1.1, 4.2, lee),
          foot.r[i] * 2.2 + 3.0
        );
        const rIn = foot.r[i] * inset;
        const gIn = groundAt ? groundAt(foot.cx + dx * rIn, foot.cz + dz * rIn) : support;
        const rOut = rIn + tail;
        const gOut = groundAt ? groundAt(foot.cx + dx * rOut, foot.cz + dz * rOut) : support;
        const rMid = rIn + tail * 0.42;
        const gMid = groundAt ? groundAt(foot.cx + dx * rMid, foot.cz + dz * rMid) : support;
        ringR[0][i] = rIn; ringY[0][i] = gIn + rise;
        ringR[1][i] = rMid; ringY[1][i] = gMid + rise * 0.45;
        /* The outer ring lands EXACTLY on the ambient surface. That is
           what stops the collar reading as a raised patch and is why
           there is no outer cap: there is nothing to see under it. */
        ringR[2][i] = rOut; ringY[2][i] = gOut;
      }

      for (let ring = 0; ring < RINGS; ring += 1) {
        for (let i = 0; i < bins; i += 1) {
          const a = (i / bins) * TAU;
          pos.push(foot.cx + Math.cos(a) * ringR[ring][i], ringY[ring][i], foot.cz + Math.sin(a) * ringR[ring][i]);
        }
      }
      for (let ring = 0; ring < RINGS - 1; ring += 1) {
        const s0 = ring * bins;
        const s1 = (ring + 1) * bins;
        for (let i = 0; i < bins; i += 1) {
          const j = (i + 1) % bins;
          /* THE REVERSE OF `ringSolid`'s STITCH ORDER, and it has to
             be. ringSolid walks its rings UPWARD, so `a0, b0, b1`
             comes out facing away from the axis (structures.js:110-118).
             This collar walks OUTWARD and DOWNWARD - every ring sits
             at or below the one inside it - which flips both terms of
             the cross product at once, and the same index order gives
             a surface facing down and inward.
             Caught by a signed-volume/mean-normal audit, not by eye:
             a flat-shaded inside-out sheet still draws, so the collar
             looked present in a still and would have been invisible
             from every camera above it - which is all of them. */
          tri(s0 + i, s1 + j, s1 + i);
          tri(s0 + i, s0 + j, s1 + j);
        }
      }
      /* Cap the inner disc. Against a wide prop it is buried, but a
         votive marker or a flag pole is thinner than one bin's radius
         and the collar would otherwise be an open funnel you can see
         down. Cheap insurance at `bins` triangles. */
      const c = pos.length / 3;
      let capY = 0;
      for (let i = 0; i < bins; i += 1) capY += ringY[0][i];
      pos.push(foot.cx, capY / bins, foot.cz);
      /* next -> current around the centre, which is the REVERSE of
         ringSolid's lower-cap order (structures.js:127-130) because
         this disc has to face UP. Written the other way the cap is a
         downward-facing lid: invisible from every camera on the level
         and visible from underneath the terrain, which is where
         nobody looks and so where it would have shipped. */
      for (let i = 0; i < bins; i += 1) tri(c, (i + 1) % bins, i);

      geos.push(finish(pos, idx));
    }

    /* ---- 3. the load on the prop ------------------------------ */
    let loadFaces = 0;
    let loadArea = 0;
    if (load > 0 && capOpts.loadOn !== false) {
      const src = geo.attributes.position;
      const { ids, verts } = weld(src);
      const vCount = verts.length / 3;
      const index = geo.index;
      const triCount = (index ? index.count : src.count) / 3;
      const at = (i) => ids[index ? index.getX(i) : i];

      const selected = [];
      const acc = new Float32Array(vCount);
      const wsum = new Float32Array(vCount);
      for (let t = 0; t < triCount; t += 1) {
        const i0 = at(t * 3);
        const i1 = at(t * 3 + 1);
        const i2 = at(t * 3 + 2);
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        const ax = verts[i0 * 3]; const ay = verts[i0 * 3 + 1]; const az = verts[i0 * 3 + 2];
        const ux2 = verts[i1 * 3] - ax; const uy2 = verts[i1 * 3 + 1] - ay; const uz2 = verts[i1 * 3 + 2] - az;
        const vx2 = verts[i2 * 3] - ax; const vy2 = verts[i2 * 3 + 1] - ay; const vz2 = verts[i2 * 3 + 2] - az;
        const nx = uy2 * vz2 - uz2 * vy2;
        const ny = uz2 * vx2 - ux2 * vz2;
        const nz = ux2 * vy2 - uy2 * vx2;
        const area2 = Math.hypot(nx, ny, nz);
        if (area2 < 1e-9) continue;
        const upness = ny / area2;
        if (upness <= SNOW_HOLD_COS) continue;
        const cyy = (ay + verts[i1 * 3 + 1] + verts[i2 * 3 + 1]) / 3;
        if (cyy < minLoadY) continue;
        if (shelter) {
          const cxx = (ax + verts[i1 * 3] + verts[i2 * 3]) / 3;
          const czz = (az + verts[i1 * 3 + 2] + verts[i2 * 3 + 2]) / 3;
          if (clamp01(shelter(cxx, cyy, czz)) >= 0.999) continue;
        }
        /* Depth is sampled at the FACE, not at the prop's centre, so a
           roof pitch carries less snow at its ridge than at its eaves
           and a wide ledge carries the field's own variation across
           it. Scaled by how far past the holding angle the face is:
           the cull at 38 degrees is a cliff otherwise, and a hard
           cliff draws a visible contour line around every dome. */
        const cxx = (ax + verts[i1 * 3] + verts[i2 * 3]) / 3;
        const czz = (az + verts[i1 * 3 + 2] + verts[i2 * 3 + 2]) / 3;
        const hold = sstep(SNOW_HOLD_COS, 1.0, upness);
        const thick = Math.max(0, depth(cxx, czz)) * 0.30 * hold * load;
        selected.push(i0, i1, i2);
        for (const v of [i0, i1, i2]) { acc[v] += thick * area2; wsum[v] += area2; }
        loadArea += area2 * 0.5;
        loadFaces += 1;
        if (loadFaces > maxFaces) break;
      }

      /* AN AREA FLOOR, not a per-face size filter.
         A spire finial, a rivet head and a bell canon all present a
         two-centimetre horizontal cap to the sky, and each one was
         generating its own snow slab plus a full boundary skirt -
         twenty-odd triangles of sub-pixel detail per fitting, and the
         cathedral has hundreds. Filtering per FACE was the obvious fix
         and is wrong: a finely tessellated roof is made of small
         faces too, and dropping them punches holes in the middle of a
         surface that should be under snow. The total area of the
         selected patch is the quantity that actually distinguishes
         "a roof" from "a bolt head", so that is what is tested. */
      if (loadArea < minLoadArea) loadFaces = 0;

      /* A PARTIAL load is worse than none: half a roof under snow and
         half bare reads as a texture bug, where no snow at all reads
         as a swept roof. Bail whole rather than truncating. */
      if (loadFaces > 0 && loadFaces <= maxFaces) {
        const lift = new Float32Array(vCount);
        for (let v = 0; v < vCount; v += 1) lift[v] = wsum[v] > 0 ? acc[v] / wsum[v] : 0;

        const pos = [];
        const idx = [];
        const tri = makeTri(pos, idx);
        const emit = new Map();       // welded id -> lifted vertex index
        const emitBase = new Map();   // welded id -> base vertex index
        const push = (v, up) => {
          const table = up ? emit : emitBase;
          let k = table.get(v);
          if (k !== undefined) return k;
          k = pos.length / 3;
          pos.push(verts[v * 3], verts[v * 3 + 1] + (up ? lift[v] : 0), verts[v * 3 + 2]);
          table.set(v, k);
          return k;
        };
        const edgeUse = new Map();
        for (let t = 0; t < selected.length; t += 3) {
          const a = selected[t];
          const b = selected[t + 1];
          const c = selected[t + 2];
          tri(push(a, true), push(b, true), push(c, true));
          for (const [p0, p1] of [[a, b], [b, c], [c, a]]) {
            const key = p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;
            const e = edgeUse.get(key);
            if (e) e.n += 1;
            else edgeUse.set(key, { n: 1, a: p0, b: p1 });
          }
        }
        /* The boundary of the loaded patch is every edge used once.
           The skirt hangs from it back down to the prop's own surface.
           Its winding is fixed by the owning triangle's, and the sign
           is genuinely counter-intuitive, so here is the worked case
           rather than an assertion: take the up-facing triangle
           (0,0,0) -> (1,0,0) -> (0,0,-1), whose normal is +Y. Its
           centroid sits on the -Z side of the edge A->B, so the
           OUTSIDE of that edge is +Z, and the order that produces a
           +Z normal is (lifted-a, base-b, lifted-b) - the reverse of
           the one that looks right.
           Caught by a per-quad audit against the patch centre, not by
           eye: an inward skirt is invisible, which puts the load back
           to reading as a decal, which is the exact failure the skirt
           exists to prevent. */
        for (const e of edgeUse.values()) {
          if (e.n !== 1) continue;
          const a0 = push(e.a, true);
          const b0 = push(e.b, true);
          const a1 = push(e.a, false);
          const b1 = push(e.b, false);
          tri(a0, b1, b0);
          tri(a0, a1, b1);
        }
        if (pos.length) geos.push(finish(pos, idx));
      } else if (loadFaces > maxFaces) {
        loadFaces = 0;
      }
    }

    let g = mergeGeometries(THREE, geos);
    if (capOpts.paint !== false && g.attributes.position && g.attributes.position.count) {
      /* SNOW_RAMP, and its dark end is a saturated BLUE rather than a
         grey (summit-art.js:179) - which matters more here than
         anywhere, because a drift collar is mostly shadow and this is
         where a snow level turns into dirty concrete. `cavity` pulls
         the skirt's down-facing edges to the dark end, which is what
         gives the load slab a readable lip. */
      g.computeBoundingBox();
      const lo = g.boundingBox.min.y;
      const hi = Math.max(lo + 0.35, g.boundingBox.max.y);
      g = paintByHeight(THREE, g, SNOW_RAMP, {
        min: lo, max: hi,
        normalWeight: 0.58, noise: 0.10, cavity: 0.72, bias: 0.04,
      });
    }
    return { geo: g, extras: { bed, seatY, footprint: foot, loadFaces, loadArea, ambient } };
  }

  /* ================================================================
     BUILT THINGS
     ================================================================ */

  /**
   * The Bell Terrace's frame: a stone bell cage with hung bronze bells.
   *
   * THE BELLS ARE HOLLOW, and that costs one paragraph to explain and
   * six extra rings to build. A bell hangs four metres up on a cliff
   * terrace with a `bell-terrace-drop` beauty shot taken from below
   * it: the player looks straight up into the mouth. A solid of
   * revolution capped across its mouth shows a flat disc; an open one
   * shows the far wall's back faces, which cull, so the bell has a
   * hole through it.
   *
   * The fix is one ring list that walks UP the outside, across the
   * crown, and back DOWN the inside, closing with a rim ring pair at
   * the mouth:
   *
   *   mouthOuter -> waist -> shoulder -> crownOuter
   *              -> crownInner -> shoulder' -> waist' -> mouthInner
   *              -> mouthOuter (again, at the same y)
   *
   * The winding follows for free from `ringSolid`'s own rule: its
   * stitch faces outward while y INCREASES and inward while y
   * DECREASES, which is exactly right for a shell walked in that
   * order. The repeated mouth ring has zero height and a positive
   * radius step, so it comes out as a down-facing annulus - the rim.
   * Both caps are off; the only surfaces they would close are inside
   * the crown, under the canons, at a radius of six centimetres.
   *
   * Returns `{ geo, extras }`: `geo` is the granite frame, `extras.bronze`
   * is the bells and their fittings (a second material, so a second
   * geometry - the batcher bins by material and merging them here
   * would make the whole assembly one or the other), and
   * `extras.mouths` are the bell-mouth centres, which is where the
   * caller hangs an icicle fringe and where the Bell Terrace's one
   * fallen bell is aimed.
   */
  function bellFrame(rng, frameOpts = {}) {
    const {
      bays = 3, bayW = 3.4, h = 5.6, postR = 0.44, ruin = 0.0,
      bells = true, bellD = 1.25,
    } = frameOpts;
    const stone = [];
    const bronze = [];
    const mouths = [];
    const span = bays * bayW;

    for (let i = 0; i <= bays; i += 1) {
      const x = (i / bays - 0.5) * span;
      /* Ruin is per-post, and a post that is broken is broken SHORT -
         the art direction wants "a broken comb of masonry", and a comb
         needs teeth of different lengths. A uniform ruin factor gives
         a level saw cut, which reads as demolition rather than as
         four centuries of weather. */
      const broken = rng.chance(ruin);
      const ph = broken ? h * rng.range(0.25, 0.78) : h;
      const post = kit.prism({
        h: ph, rBottom: postR * 1.15, rTop: postR * 0.92, sides: 5,
        segments: 3, jitter: 0.05, seed: rng.int(1, 1e6),
      });
      post.translate(x, 0, 0);
      stone.push(post);
      stone.push(kit.slab(postR * 3.0, 0.34, postR * 3.0, 0.06).translate(x, -0.14, 0));
      if (!broken) {
        stone.push(kit.slab(postR * 2.6, 0.30, postR * 2.6, 0.05).translate(x, h - 0.30, 0));
      }
    }

    /* Head beam, in per-bay segments so a ruined bay can lose its
       lintel independently. One continuous beam over a broken post is
       the thing that makes ruins read as intact buildings with holes. */
    for (let i = 0; i < bays; i += 1) {
      if (rng.chance(ruin * 0.8)) continue;
      const x = ((i + 0.5) / bays - 0.5) * span;
      stone.push(kit.slab(bayW * 1.02, 0.46, postR * 2.2, 0.06).translate(x, h - 0.02, 0));
      /* Corbel braces. Two triangles of stone under each lintel end -
         the smallest detail that says the beam is CARRIED rather than
         balanced. */
      for (const s of [-1, 1]) {
        const br = kit.extrudeZ([
          [0, 0], [0.85, 0], [0, 0.85],
        ], postR * 1.7);
        /* Mirrored by a HALF TURN ABOUT Y, never by scale(-1, 1, 1).
           A negative scale reverses the winding of every triangle it
           touches, and structures.js records exactly that failure on
           the cathedral's aisle lean-to: one side of a symmetrical
           building took no sunlight because mirroring it by negating x
           turned it inside out. A rotation is a rigid motion and
           cannot do that. The corbel's z extent is symmetric, so the
           half turn is a true mirror here. */
        kit.transform(br, { rot: [0, s > 0 ? 0 : Math.PI, 0], pos: [x + s * bayW * 0.42, h - 0.5, 0] });
        stone.push(br);
      }
    }

    if (bells) {
      for (let i = 0; i < bays; i += 1) {
        const x = ((i + 0.5) / bays - 0.5) * span;
        if (rng.chance(ruin * 0.7)) continue;
        const d = bellD * rng.range(0.86, 1.14);
        const bh = d * 1.18;
        const top = h - 0.55;
        const mouthY = top - bh;
        const sides = 13;
        const wall = d * 0.045;
        /* Authored profile stops, not a lerp. A bell's silhouette is
           its waist: mouth widest, a sharp intake to the waist, a
           swell at the shoulder, then a fast pinch to the crown. A
           smooth taper is a lampshade. */
        const PROFILE = [
          [0.00, 0.500],   // mouth
          [0.14, 0.430],
          [0.34, 0.352],   // waist
          [0.58, 0.372],   // shoulder swell
          [0.80, 0.300],
          [0.94, 0.140],
          [1.00, 0.062],   // crown
        ];
        const rings = [];
        for (const [t, r] of PROFILE) {
          rings.push({ y: mouthY + t * bh, r: d * r, sides, phase: 0.11 });
        }
        for (let k = PROFILE.length - 1; k >= 0; k -= 1) {
          const [t, r] = PROFILE[k];
          rings.push({
            y: mouthY + t * bh - (k === PROFILE.length - 1 ? wall : 0),
            r: Math.max(d * 0.03, d * r - wall),
            sides,
            phase: 0.11,
          });
        }
        /* Close the rim: repeat the outer mouth ring at the same y.
           Zero height, positive radius step - a down-facing annulus. */
        rings.push({ y: mouthY, r: d * 0.5, sides, phase: 0.11 });
        /* Assembled at the origin and moved into its bay as one piece
           at the end. Building each bell in place would thread `x`
           through every profile expression above and through the canon
           arcs below, and the arithmetic is hard enough to check
           without it. */
        const parts = [kit.ringSolid(rings, { capTop: false, capBottom: false })];

        /* Canons - the crossed loops the bell hangs by - and the
           headstock it hangs from. Without them a bell is floating
           under a beam, and the eye finds that before it finds the
           bell. */
        for (const a of [0, Math.PI / 2]) {
          const pts = [];
          for (let s = 0; s <= 6; s += 1) {
            const k = s / 6;
            const ang = Math.PI * k;
            pts.push([
              Math.cos(a) * Math.cos(ang) * d * 0.11,
              top + Math.sin(ang) * d * 0.13,
              Math.sin(a) * Math.cos(ang) * d * 0.11,
            ]);
          }
          parts.push(kit.tube(pts, d * 0.020, 4));
        }
        /* The headstock: the beam the canons are strapped to. Without
           it the bell hangs off nothing, and the eye finds that gap
           before it finds the bell. */
        parts.push(kit.slab(d * 0.62, d * 0.10, d * 0.26, 0.01).translate(0, top + d * 0.13, 0));
        for (const part of parts) bronze.push(part.translate(x, 0, 0));
        mouths.push([x, mouthY, 0]);
      }
    }

    let frame = mergeGeometries(THREE, stone);
    if (frameOpts.facet !== false) frame = kit.facet(frame);
    let bell = bronze.length ? mergeGeometries(THREE, bronze) : null;

    if (frameOpts.paint !== false) {
      frame = paintByHeight(THREE, frame, GRANITE_RAMP, {
        min: -0.4, max: h * 1.05, normalWeight: 0.40, noise: 0.16, cavity: 0.70,
      });
      if (bell) {
        /* BELL_RAMP runs bronze -> verdigris -> polished. Painted over
           the bell's own height rather than the frame's: a bell is
           dark in its mouth and bright on its shoulder, and mapping it
           against a 5.6 m frame would put the whole bell inside one
           sixth of the ramp. */
        bell = paintByHeight(THREE, bell, BELL_RAMP, {
          min: h - 0.55 - bellD * 1.35, max: h - 0.30,
          normalWeight: 0.46, noise: 0.14, cavity: 0.55,
        });
      }
    }
    return { geo: frame, extras: { bronze: bell, mouths, span } };
  }

  /**
   * A votive marker: the stone that stands at every hairpin on the
   * Via Sacra.
   *
   * The design constraint is WHITEOUT. In the level's second time of
   * day visibility drops to a few tens of metres and the markers are
   * the only thing telling the player they are still on the road, so
   * the silhouette has to survive being a grey shape in grey air: a
   * tall narrow post, a wide flat cap that overhangs it, and a
   * cross-arm near the top. Three cues at three different scales, none
   * of which depends on colour.
   *
   * The bronze plaque is where `polyRadiusFactor` earns its place -
   * see the copy at the top of this file. Pinned to the ellipse rather
   * than to the real facet of a five-sided post it stands nineteen
   * percent of the radius proud, which at this size is a centimetre of
   * daylight: small enough to look like a mistake rather than a style.
   *
   * `extras.bronze` is the plaque and lashing ring; `extras.lashY` is
   * where a prayer-flag run ties on.
   */
  function votiveMarker(rng, markerOpts = {}) {
    const { h = 2.6, r = 0.20, sides = 5, plaque = true, lean = 0.05 } = markerOpts;
    const stone = [];
    const bronze = [];
    const phase = rng() * TAU;

    stone.push(kit.slab(r * 5.2, 0.22, r * 4.6, 0.04).translate(0, -0.12, 0));
    const post = kit.prism({
      h, rBottom: r * 1.12, rTop: r * 0.86, sides, jitter: 0.06,
      segments: 3, seed: rng.int(1, 1e6), twist: rng.jit(0.10),
    });
    stone.push(post);
    /* The cap OVERHANGS. A flush cap sheds no snow and, more to the
       point, has no shadow line under it - and that shadow line is
       most of what makes the marker legible at fifty metres. */
    stone.push(kit.slab(r * 3.4, 0.16, r * 3.0, 0.03).translate(0, h - 0.04, 0));
    const arm = kit.slab(r * 5.0, 0.13, r * 1.1, 0.02);
    kit.transform(arm, { rot: [0, phase, rng.jit(0.06)], pos: [0, h * 0.80, 0] });
    stone.push(arm);

    if (plaque) {
      /* Face the plaque DOWNWIND. It is the one surface that must stay
         readable, and a windward plaque rimes over inside a season -
         which is a real reason and also the reason the level's
         directional cues keep agreeing with each other. */
      const a = Math.atan2(wind.z, wind.x);
      const rr = r * 0.94;
      const f = polyRadiusFactor(a, sides, 0);
      const pl = kit.slab(r * 1.5, r * 2.0, 0.035, 0.008);
      kit.transform(pl, { rot: [0, -a, 0], pos: [Math.cos(a) * rr * f, h * 0.42, Math.sin(a) * rr * f] });
      bronze.push(pl);
    }
    const lashY = h * 0.88;
    const ring = new THREE.TorusGeometry(r * 0.42, r * 0.075, 4, 9);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, lashY, 0);
    bronze.push(ring);

    let g = mergeGeometries(THREE, stone);
    if (lean !== 0) {
      /* Lean the whole marker, after assembly. Leaning the post alone
         leaves the cap level and the marker reads as a well-built
         thing on bad ground; leaning everything together reads as a
         thing that has been pushed, which is what four centuries of
         frost heave does. */
      kit.transform(g, { rot: [rng.jit(lean), 0, rng.jit(lean)] });
    }
    if (markerOpts.facet !== false) g = kit.facet(g);
    let bz = bronze.length ? mergeGeometries(THREE, bronze) : null;
    if (markerOpts.paint !== false) {
      g = paintByHeight(THREE, g, GRANITE_RAMP, {
        min: -0.2, max: h, normalWeight: 0.44, noise: 0.18, cavity: 0.68,
      });
      if (bz) bz = paintByHeight(THREE, bz, BELL_RAMP, { min: 0, max: h, normalWeight: 0.5, noise: 0.10 });
    }
    return { geo: g, extras: { bronze: bz, lashY, phase } };
  }

  /**
   * The Via Sacra's parapet: the 0.9 m wall on the downhill side.
   *
   * The layout is blunt about why it exists - "the parapet is what
   * makes an exposed road readable as exposed" - and that is a
   * composition argument, not a safety one. A road cut across a
   * forty-percent face with nothing on its outer edge reads as a
   * terrace. One low line of masonry along the drop and the same shot
   * reads as a road on a cliff.
   *
   * Built as discrete blocks on a resampled path, with a swept coping
   * over the top. Two things this gets right that a single extruded
   * wall does not:
   *   - GAPS. `ruin` drops blocks, and the coping is built in runs
   *     between the gaps rather than over them. A complete parapet
   *     down two kilometres of spiral is a garden wall.
   *   - BEDDING PER BLOCK, from the MINIMUM of its two ends when a
   *     `groundAt` is supplied. Taking the midpoint height leaves the
   *     downhill end of every block on a graded shoulder hanging, and
   *     because each block is only about a metre long the failure is
   *     a continuous ripple of daylight rather than one obvious fault.
   *
   * The coping is swept rather than blocked because the Via Sacra is a
   * SPIRAL: a chain of straight coping segments on a curve shows a
   * facet at every joint, and at the hairpins - which are the tightest
   * curvature on the level and also where the player is looking at the
   * parapet from a few metres away - it reads as a polygon.
   *
   * The caller must set `userData.collisionSolid` on the resulting
   * mesh. Coping triangles are well under collide.js's half-metre
   * footprint filter (collide.js:369), and a parapet that does not
   * block is a parapet that is decoration.
   */
  function parapet(points, wallOpts = {}) {
    const {
      h = 0.9, w = 0.42, spacing = 1.15, ruin = 0.10, embed = 0.10,
      coping = true, seed = 0x9a11,
    } = wallOpts;
    if (!points || points.length < 2) return new THREE.BufferGeometry();
    const rng = makeRng(seed);
    const groundAt = wallOpts.groundAt || null;
    const path = resample(points, spacing);
    const geos = [];
    const present = new Array(path.length).fill(true);
    const seatAt = new Float32Array(path.length);

    for (let i = 0; i < path.length; i += 1) {
      const p = path[i];
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      /* Minimum of the block's two ends, not its middle. Same rule as
         `snowCap`'s seat and world.js's `restOnTerrain`: bed to the
         lowest support under the footprint and pay it back in height. */
      const seat = groundAt
        ? Math.min(groundAt(a[0], a[2]), groundAt(p[0], p[2]), groundAt(b[0], b[2]))
        : p[1];
      seatAt[i] = seat - embed;
      if (rng.chance(ruin)) { present[i] = false; continue; }
      const yaw = Math.atan2(b[2] - a[2], b[0] - a[0]);
      const bh = h * rng.range(0.90, 1.06);
      const block = kit.slab(spacing * 0.97, bh, w, 0.035);
      kit.transform(block, { rot: [0, -yaw, rng.jit(0.03)] });
      block.translate(p[0], seatAt[i], p[2]);
      geos.push(block);
    }

    if (coping) {
      /* One sweep per unbroken run. A single sweep over the whole path
         would bridge every gap with a floating stone lintel. */
      let start = 0;
      while (start < path.length) {
        while (start < path.length && !present[start]) start += 1;
        let end = start;
        while (end < path.length && present[end]) end += 1;
        if (end - start >= 2) {
          const run = [];
          for (let i = start; i < end; i += 1) run.push([path[i][0], seatAt[i] + h, path[i][2]]);
          geos.push(sweepProfile(run, () => ([
            [-w * 0.62, 0], [w * 0.62, 0], [w * 0.50, 0.11], [-w * 0.50, 0.15],
          ]), { capEnds: true }));
        }
        start = end + 1;
      }
    }

    if (!geos.length) return new THREE.BufferGeometry();
    let g = mergeGeometries(THREE, geos);
    if (wallOpts.facet === true) g = kit.facet(g);
    if (wallOpts.paint === false) return g;
    /* Painted against the wall's OWN height, taken from the run's
       lowest seat. The absolute y of a parapet on this level ranges
       from 12 m at the basecamp to 452 m at the parvis; handing
       paintByHeight the default bounding box would map the whole
       granite ramp across the mountain's elevation and every wall
       would be one flat colour at its own altitude. */
    let lo = Infinity;
    for (let i = 0; i < seatAt.length; i += 1) lo = Math.min(lo, seatAt[i]);
    if (!Number.isFinite(lo)) lo = 0;
    return paintByHeight(THREE, g, GRANITE_RAMP, {
      min: lo, max: lo + h + 0.2, normalWeight: 0.42, noise: 0.20, cavity: 0.66,
    });
  }

  /**
   * A cairn. The oldest route marker there is, and the one the player
   * will read without being told what it is.
   *
   * Flat stones, largest at the base, each rotated off the one below
   * so no two edges line up - the same odd-count, per-ring-phase rule
   * that stops `crag`'s ring stacks looking like ring stacks.
   *
   * THE OFFSET IS CAPPED, and it has to be. An uncapped random walk up
   * seven stones puts the top stone past the edge of the one under it,
   * and a cairn that is visibly falling over is a cairn the player
   * reads as debris. The cap is a fraction of the CURRENT layer's
   * radius, so it tightens as the stack narrows, which is also how
   * somebody actually builds one.
   */
  function cairn(rng, cairnOpts = {}) {
    const { h = 1.7, r = 0.62, layers = 7, sink = 0.22, pointer = true } = cairnOpts;
    const geos = [];
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < layers; i += 1) {
      const t = i / Math.max(1, layers - 1);
      const lr = r * lerp(1.0, 0.34, Math.pow(t, 0.85));
      const lh = (h / layers) * rng.range(0.7, 1.25);
      const drift = lr * 0.16;
      cx = clamp(cx + rng.jit(drift), -lr * 0.34, lr * 0.34);
      cz = clamp(cz + rng.jit(drift), -lr * 0.34, lr * 0.34);
      const yaw = rng() * TAU;
      /* A stone, not a disc: two rings with different radii and phases
         and an elongated section, so it has a long axis and an
         obvious top and bottom face. */
      const stone = kit.ringSolid([
        { y: 0, rx: lr * 0.86, rz: lr * 0.62, sides: 6, phase: yaw, jitter: 0.18, seed: rng.int(1, 1e6) },
        { y: lh * 0.55, rx: lr, rz: lr * 0.72, sides: 6, phase: yaw + 0.4, jitter: 0.20, seed: rng.int(1, 1e6) },
        { y: lh, rx: lr * 0.80, rz: lr * 0.58, sides: 6, phase: yaw + 0.7, jitter: 0.16, seed: rng.int(1, 1e6) },
      ]);
      kit.transform(stone, { rot: [rng.jit(0.10), 0, rng.jit(0.10)] });
      stone.translate(cx, -h * sink + (i / layers) * h, cz);
      geos.push(stone);
    }
    if (pointer) {
      /* The pointer stone: one upright slab on top, leaning along the
         route. It is the difference between a heap and a sign. */
      const p = kit.shard(rng, {
        height: h * 0.42, radius: r * 0.26, sides: 5, sharpness: 0.30, lean: 0.55,
      });
      kit.transform(p, { rot: [rng.jit(0.22), rng() * TAU, rng.jit(0.22)] });
      p.translate(cx, h * 0.94, cz);
      geos.push(p);
    }
    let g = mergeGeometries(THREE, geos);
    if (cairnOpts.facet !== false) g = kit.facet(g);
    if (cairnOpts.paint === false) return g;
    return paintByHeight(THREE, g, GRANITE_RAMP, {
      min: -h * sink, max: h * 1.3, normalWeight: 0.46, noise: 0.22, cavity: 0.62,
    });
  }

  /**
   * A run of prayer flags between two anchors.
   *
   * The one thing on the mountain that moves without a particle
   * system, and the cheapest possible restatement of the wind bearing:
   * forty flags all streaming the same way, at every hairpin, visible
   * from across the map.
   *
   * TWO ATTRIBUTE SETS, AND THEY MUST NOT BE MERGED. The flags carry a
   * `wave` attribute (structures.js's `banner`, which vfx.js's banner
   * vertex shader phases the ripple off) and the cord does not.
   * `mergeGeometries` takes its attribute name list from
   * `geometries[0]` and zero-pads anything missing (sky.js:1006, 1031):
   * merge the cord first and the flags lose `wave` entirely; merge it
   * last and it comes back with wave = (0, 0), which is not an error
   * anywhere - the flags simply hang rigid and nobody can say why. So
   * the cord is `geo` and the flags leave separately.
   *
   * THE FLAGS ARE NOT PAINTED HERE. `buildBanners` (vfx.js:540-560)
   * OVERWRITES the colour attribute from each spec's `colour` /
   * `accent` hexes, so painting them would be work thrown away. They
   * leave as `extras.flagSpecs`, already grouped by colour so a
   * forty-flag run publishes five specs rather than forty, ready to
   * push straight into `world.banners`.
   */
  function prayerFlagRun(points, flagOpts = {}) {
    const {
      flags = 22, sag = 0.09, flagW = 0.40, flagH = 0.52, cordR = 0.012,
      seed = 0x5f1a65, samples = 26,
    } = flagOpts;
    if (!points || points.length < 2) {
      return { geo: new THREE.BufferGeometry(), extras: { flagSpecs: [], anchors: [] } };
    }
    const rng = makeRng(seed);
    /* Five colours, all drawn from summit-art's palette rather than
       invented here. summit-art owns the palette; a hex authored in
       this file is a hex that will not move when the level is
       re-graded. */
    const K = SUMMIT_PALETTE;
    const colours = flagOpts.colours || [
      { colour: K.ember, accent: K.emberLit },
      { colour: K.iceBody, accent: K.iceEdge },
      { colour: K.rimeLit, accent: K.snowCool },
      { colour: K.sulphurLit, accent: K.sulphurCrust },
      { colour: K.bellVerdigris, accent: K.bellLit },
    ];

    /* One catenary per anchor span. Sag scales with the span so a
       short lash between two markers does not droop to the ground and
       a forty-metre span across a hairpin does not run taut. */
    const cord = [];
    for (let s = 0; s < points.length - 1; s += 1) {
      const a = points[s];
      const b = points[s + 1];
      const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let i = 0; i <= samples; i += 1) {
        const t = i / samples;
        if (s > 0 && i === 0) continue;
        cord.push([
          lerp(a[0], b[0], t),
          lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag * span,
          lerp(a[2], b[2], t),
        ]);
      }
    }
    const line = kit.tube(cord, cordR, 3, { capStart: false, capEnd: false });

    const groups = new Map();
    for (let i = 0; i < flags; i += 1) {
      /* Leave the ends bare: a flag tied at the anchor itself sits
         inside the marker's cap and pokes through it. */
      const t = lerp(0.06, 0.94, flags > 1 ? i / (flags - 1) : 0.5);
      const k = t * (cord.length - 1);
      const i0 = Math.min(cord.length - 2, Math.floor(k));
      const f = k - i0;
      const p = [
        lerp(cord[i0][0], cord[i0 + 1][0], f),
        lerp(cord[i0][1], cord[i0 + 1][1], f),
        lerp(cord[i0][2], cord[i0 + 1][2], f),
      ];
      const yaw = Math.atan2(cord[i0 + 1][2] - cord[i0][2], cord[i0 + 1][0] - cord[i0][0]);
      const g = kit.banner({
        w: flagW * rng.range(0.9, 1.1), h: flagH * rng.range(0.85, 1.15),
        cols: 3, rows: 4, sag: 0.05, amp: 0.09,
      });
      /* `banner` builds its top edge along local x at y = 0 and hangs
         down, which is exactly a flag on a line - so the only
         transform needed is the yaw onto the cord's local heading. */
      kit.transform(g, { rot: [0, -yaw, 0], pos: p });
      const slot = i % colours.length;
      if (!groups.has(slot)) groups.set(slot, []);
      groups.get(slot).push(g);
    }

    const flagSpecs = [];
    for (const [slot, list] of groups) {
      flagSpecs.push({
        geo: mergeGeometries(THREE, list),
        colour: colours[slot].colour,
        accent: colours[slot].accent,
        /* `aWind` is scaled by this in buildBanners. Prayer flags are
           small, light and untethered at the hem - the loosest cloth
           on either level. */
        wind: 1.35,
      });
    }

    const geo = flagOpts.paint === false
      ? line
      : paintGeometry(THREE, line, BARK_RAMP, () => 0.28, { jitter: 0.18 });
    return { geo, extras: { flagSpecs, anchors: points.slice(), cord } };
  }


  /* ==================================================================
     GOTHIC DETAIL PRIMITIVES

     `structures.js`'s kit has the five big gothic shapes - the arch,
     the clustered column, the flying buttress, the spire and the
     statue - because those are what the Vault-Cathedral needed at
     132 m of nave. At 54 m the building is read from twice as close
     for the same screen height, and what is missing is the register
     BELOW those: the mouldings, the set-offs, the tracery bars, the
     foiled lights. Vesper got away without them by being enormous
     and by being a ruin, where a broken edge does the work a moulding
     would have done. A sealed chapel has no broken edges.

     All five are authored in the same frame convention, which is the
     one thing that makes them composable: **+Y is up, and the face
     the detail is applied TO is the plane the primitive's local
     origin sits in.** `setOffButtress` projects along +X off the
     plane x = 0; `tracery`, `cuspedLight` and `mullion` are face-on
     to +Z off the plane z = 0. Nothing here rotates itself, because
     a primitive that pre-rotates cannot be mirrored onto the other
     side of a building without reversing its winding - the failure
     `flyingButtress` records at structures.js:944.
     ================================================================== */

  /**
   * A flat annulus with real thickness: the ring band a tracery
   * frame, a ring course and a foiled light are all made of.
   *
   * `rInner` may be a FUNCTION of angle, which is the whole reason
   * this is a primitive rather than two `ringSolid` calls: a cusped
   * light is an annulus whose inner boundary is scalloped, and
   * `ringSolid` samples a fixed radius per ring. Four surfaces are
   * emitted - front, back, outer rim, inner rim - because every one
   * of them is visible: the rims from an oblique approach across the
   * parvis, the back face from inside the building, and a missing
   * back face on an ice-glazed window reads as a hole in the wall
   * exactly where the eye is already going.
   *
   * Wound so the front (+Z) face points at +Z. Checked by signed
   * volume rather than by eye, per this file's winding rule.
   */
  function flatAnnulus(rOuter, rInner, depth, samples, phase = 0) {
    const n = Math.max(6, Math.round(samples));
    const rIn = typeof rInner === "function" ? rInner : () => rInner;
    const hz = depth / 2;
    const pos = [];
    const idx = [];
    const tri = makeTri(pos, idx);
    /* Four vertices per station, in a fixed order the index maths
       below depends on: 0 outer-back, 1 inner-back, 2 outer-front,
       3 inner-front. */
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU + phase;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ri = Math.max(1e-3, rIn(a, i));
      pos.push(ca * rOuter, sa * rOuter, -hz);
      pos.push(ca * ri, sa * ri, -hz);
      pos.push(ca * rOuter, sa * rOuter, hz);
      pos.push(ca * ri, sa * ri, hz);
    }
    for (let i = 0; i < n; i += 1) {
      const b = i * 4;
      const q = ((i + 1) % n) * 4;
      /* Front face (+Z), seen from +Z, must wind counter-clockwise
         in screen space; the ring itself runs counter-clockwise in
         (x, y), so outer-then-inner is the order that gives it. */
      tri(b + 2, q + 2, q + 3);
      tri(b + 2, q + 3, b + 3);
      // Back face, reversed.
      tri(b + 0, b + 1, q + 1);
      tri(b + 0, q + 1, q + 0);
      // Outer rim, facing away from the centre.
      tri(b + 0, q + 0, q + 2);
      tri(b + 0, q + 2, b + 2);
      // Inner rim, facing INTO the hole.
      tri(b + 1, b + 3, q + 3);
      tri(b + 1, q + 3, q + 1);
    }
    return finish(pos, idx);
  }

  /** The matching filled disc, for glazing. Two fans and a rim - a
   *  bare single-sided fan is invisible from the other side of the
   *  window, and the whole point of the ice glazing is that it is
   *  read from BOTH sides. */
  function flatDisc(rEdge, depth, samples, phase = 0) {
    const n = Math.max(6, Math.round(samples));
    const rf = typeof rEdge === "function" ? rEdge : () => rEdge;
    const hz = depth / 2;
    const pos = [0, 0, -hz, 0, 0, hz];
    const idx = [];
    const tri = makeTri(pos, idx);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU + phase;
      const r = Math.max(1e-3, rf(a, i));
      pos.push(Math.cos(a) * r, Math.sin(a) * r, -hz);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, hz);
    }
    for (let i = 0; i < n; i += 1) {
      const b = 2 + i * 2;
      const q = 2 + ((i + 1) % n) * 2;
      tri(0, q + 0, b + 0);          // back fan
      tri(1, b + 1, q + 1);          // front fan
      tri(b + 0, q + 0, q + 1);      // rim
      tri(b + 0, q + 1, b + 1);
    }
    return finish(pos, idx);
  }

  /**
   * A moulded string course swept along a horizontal polyline.
   *
   * WHY IT IS SYMMETRIC ABOUT THE PATH. The obvious authoring is a
   * section that projects OUTWARD from the wall, which needs the
   * primitive to know which side of the path the building is on -
   * and `sweepProfile`'s u axis is left-of-travel, so that knowledge
   * is a winding convention the caller has to get right for every
   * run. The first version did exactly that and the north half of a
   * closed course came out buried in the wall, because a closed ring
   * reverses its handedness the moment the author walks it the other
   * way round. A symmetric section cannot have that bug: the inner
   * half is inside 1.15 m of wall either way, and where it emerges
   * inside the building it is a string course on the inside, which is
   * what a real one does.
   *
   * The section is a drip course, not a rectangle: vertical face,
   * weathered slope, fillet. That slope is the whole point of the
   * moulding - it is what throws the meltwater clear of the wall, and
   * it is the ledge every icicle in the level hangs off.
   *
   * `extras.lip` is the drip line as a polyline, ready for
   * `icicleFringe`.
   */
  function stringCourse(path, courseOpts = {}) {
    const {
      project = 0.34, height = 0.62, capEnds = true, closed = false,
    } = courseOpts;
    if (!path || path.length < 2) {
      return { geo: new THREE.BufferGeometry(), extras: { lip: [] } };
    }
    const pts = path.map((p) => (p.length > 2
      ? [p[0], p[1], p[2]]
      : [p[0], courseOpts.y ?? 0, p[1]]));
    if (closed) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) > 1e-4) pts.push(a.slice());
    }
    const w = project;
    /* Convex on purpose. `sweepProfile` fans its end caps, and a fan
       across a concave section spans its own hollow - the same trap
       `extrudeZ` documents at structures.js:295. */
    const sec = [
      [-w, 0], [w, 0],
      [w, height * 0.30], [w * 0.52, height * 0.72],
      [w * 0.52, height], [-w * 0.52, height],
      [-w * 0.52, height * 0.72], [-w, height * 0.30],
    ];
    const geo = sweepProfile(pts, () => sec, { capEnds });
    /* The drip line sits at the outer bottom corner of the moulding,
       which is where water actually leaves it. Emitted on BOTH sides
       for a course that is exposed on both - the caller picks. */
    const lip = [];
    for (let i = 0; i < pts.length; i += 1) {
      const d = dirLeft(pts, i);
      lip.push([pts[i][0] - d.x * w, pts[i][1] + height * 0.02, pts[i][2] - d.z * w]);
    }
    return { geo, extras: { lip, lipLeft: pts.map((p, i) => {
      const d = dirLeft(pts, i);
      return [p[0] + d.x * w, p[1] + height * 0.02, p[2] + d.z * w];
    }) } };
  }

  /**
   * A buttress that STANDS PROUD OF THE WALL AND STEPS BACK AS IT
   * RISES, which is the only reason a buttress looks like a
   * buttress and not like a fin.
   *
   * Authored projecting along **+X** off the plane x = 0, its width
   * running along Z, base at y = 0. That is the frame a flank
   * buttress on a nave running north-south needs with no rotation at
   * all, and a front buttress needs one `rotateY`.
   *
   * `stages` is `[{ top, project }]` read bottom up: the stage below
   * `top` stands `project` metres off the wall, and between one
   * stage and the next is a WEATHERING - a sloped set-off that
   * sheds water outward. On this mountain the set-offs are also the
   * ledges the rime and the icicles collect on, so their tops come
   * back in `extras.setOffs` as polylines rather than as numbers.
   *
   * BUILT FROM OVERLAPPING SOLIDS, NOT FROM ONE EXTRUSION. The
   * buttress's side profile is a descending staircase with a gablet
   * on top, which is concave, and `extrudeZ` fans its end caps -
   * valid only for a convex profile (structures.js:295). One
   * extrusion would have been forty triangles cheaper and would have
   * come out with its two ends filled in solid across the notches.
   */
  function setOffButtress(buttOpts = {}) {
    const {
      width = 2.2,
      stages = [{ top: 6.4, project: 1.9 }, { top: 10.2, project: 1.35 },
        { top: 12.4, project: 0.9 }],
      weather = 0.5, gablet = 2.2, pinnacle = 3.2, bevel = 0.14,
    } = buttOpts;
    const parts = [];
    const setOffs = [];
    let y = 0;
    for (let i = 0; i < stages.length; i += 1) {
      const st = stages[i];
      const h = Math.max(0.2, st.top - y);
      parts.push(kit.slab(st.project, h, width, bevel)
        .translate(st.project / 2, y, 0));
      const nextP = i + 1 < stages.length
        ? stages[i + 1].project
        : Math.max(0.25, st.project * 0.55);
      /* The weathering. Convex quadrilateral, so the fan caps at the
         two ends of the extrusion are valid. */
      parts.push(kit.extrudeZ([
        [0, st.top], [st.project, st.top],
        [nextP, st.top + weather], [0, st.top + weather],
      ], width));
      setOffs.push({
        y: st.top + weather * 0.06,
        project: st.project,
        width,
      });
      y = st.top + weather;
      if (i === stages.length - 1) {
        // The gablet: a triangular head leaning back into the wall.
        parts.push(kit.extrudeZ([
          [0, y], [nextP, y], [0, y + gablet],
        ], width * 0.94));
        y += gablet;
        if (pinnacle > 0) {
          parts.push(kit.slab(nextP * 1.5, 0.34, width * 0.66, 0.08)
            .translate(nextP * 0.5, y - gablet * 0.55, 0));
          parts.push(kit.prism({
            h: pinnacle, rBottom: width * 0.28, rTop: 0.05,
            sides: 4, twist: Math.PI / 4,
          }).translate(nextP * 0.5, y - gablet * 0.55 + 0.34, 0));
        }
      }
    }
    return {
      geo: kit.merge(parts),
      extras: { setOffs, top: y, height: y + (pinnacle > 0 ? pinnacle : 0) },
    };
  }

  /**
   * A tracery bar. Face-on to +Z, running from the origin along +Y,
   * tapering as it rises and chamfered at both ends.
   *
   * The chamfer is not decoration. A rose's radial mullions are seen
   * against a bright ice light from inside and against the sky from
   * outside, and a square bar in that situation is a black rectangle
   * with no form at all. A chamfered one keeps a lit arris down its
   * whole length whichever side the key is on, which is the entire
   * reason gothic mouldings are shaped the way they are.
   *
   * The `sqrt(2)` scale is `slab`'s (structures.js:200) and it is
   * mandatory: a 4-sided `ringSolid` is a DIAMOND inscribed in the
   * radius, so its flats sit at r/sqrt(2). Without the scale every
   * mullion in the rose comes out 29% thin.
   */
  function mullion(mullOpts = {}) {
    const {
      length = 3, w = 0.26, d = 0.30, taper = 0.86, bevel = 0.05,
    } = mullOpts;
    const b = Math.min(bevel, w * 0.4, d * 0.4, length * 0.2);
    return kit.ringSolid([
      { y: 0, rx: w / 2 - b, rz: d / 2 - b, sides: 4, phase: Math.PI / 4 },
      { y: b, rx: w / 2, rz: d / 2, sides: 4, phase: Math.PI / 4 },
      { y: length - b, rx: (w / 2) * taper, rz: (d / 2) * taper, sides: 4, phase: Math.PI / 4 },
      { y: length, rx: (w / 2) * taper - b, rz: (d / 2) * taper - b, sides: 4, phase: Math.PI / 4 },
    ]).scale(Math.SQRT2, 1, Math.SQRT2);
  }

  /**
   * A cusped light: the foiled opening a rose window is actually
   * made of. Stone ring plus the glazing that fills it.
   *
   * Face-on to +Z, centred on the origin.
   *
   * WHY CUSPS AND NOT CIRCLES. Sixteen plain circles set round a
   * hub is a pinwheel - the Vault-Cathedral's own comment says so
   * (world.js:1817) and then builds plain circles anyway, because at
   * 132 m the rose is 25 m across and the eye never gets close
   * enough to care. Ours is 6.8 m across on a building you stand
   * two metres from. The scallop is the difference between "a
   * window" and "a window in a cathedral", and it costs
   * `foils * samplesPerFoil * 8` triangles.
   *
   * The scallop is `|sin(foils * a / 2)|` raised to a power below 1,
   * which fattens the lobes and sharpens the cusp points - a plain
   * sine gives equal time to lobe and point and reads as a gear.
   */
  function cuspedLight(lightOpts = {}) {
    const {
      r = 0.55, foils = 3, cusp = 0.30, frame = 0.10, depth = 0.26,
      perFoil = 6, phase = 0, glaze = true,
    } = lightOpts;
    const n = Math.max(9, Math.round(foils * perFoil));
    const inner = (a) => r * (1 - cusp)
      + r * cusp * Math.pow(Math.abs(Math.sin((foils * (a - phase)) / 2)), 0.55);
    const geo = flatAnnulus(r + frame, inner, depth, n);
    const glass = glaze ? flatDisc((a) => inner(a) + 0.012, depth * 0.42, n) : null;
    return { geo, extras: { glass, r: r + frame } };
  }

  /**
   * ROSE TRACERY: a stone frame, radial mullions, and two rings of
   * cusped lights. Face-on to +Z, centred on the origin, so the
   * caller translates it into the wall and does not rotate it.
   *
   * Four orders of depth, because depth is the only thing that makes
   * a window read as cut through a wall rather than drawn on one:
   * the outer frame stands proud, the ring courses sit a little
   * back, the mullions sit back further, and the glazing is at the
   * rear plane. At a 7-degree sun those four planes throw four
   * different shadows across each other and that shadow play is what
   * the eye reads as a rose window at 200 m, long before it can
   * resolve a single foil.
   *
   * `extras.glass` is a SEPARATE geometry and it is deliberately not
   * merged in: the world gives it the unlit emissive material, so
   * merging it with the stone would either light the ice or unlight
   * the tracery.
   *
   * Returned glazing carries no colour attribute - the caller paints
   * it, because how bright ice is allowed to be is a decision about
   * the whole frame's exposure and not about this window.
   */
  function tracery(tracOpts = {}) {
    const {
      r = 3.4, frame = 0.62, depth = 0.75, spokes = 16,
      hubR = 0.55, backGlass = true,
      rings = [
        { at: 0.40, count: 8, foilR: 0.50, foils: 5 },
        { at: 0.74, count: 16, foilR: 0.42, foils: 3 },
      ],
    } = tracOpts;
    const stone = [];
    const glass = [];

    /* The frame, in two orders at two depths. */
    stone.push(flatAnnulus(r + frame, r + frame * 0.34, depth, 26));
    stone.push(flatAnnulus(r + frame * 0.42, r, depth * 0.55, 26)
      .translate(0, 0, depth * 0.28));

    /* The ring courses. Thin, and set BACK from the frame so the
       lights sitting on them are read as being inside the window. */
    for (const ring of rings) {
      stone.push(flatAnnulus(r * ring.at + 0.09, r * ring.at - 0.09, depth * 0.42, 24)
        .translate(0, 0, -depth * 0.06));
    }

    /* Radial mullions. They run from the hub to the frame and pass
       BEHIND the ring courses, which is how real tracery is built
       and why the courses read as rings rather than as a dotted
       line of arcs. */
    for (let i = 0; i < spokes; i += 1) {
      const a = (i / spokes) * TAU;
      const m = mullion({ length: r - hubR + 0.1, w: 0.20, d: depth * 0.5, taper: 0.9 });
      m.translate(0, hubR - 0.05, 0);
      m.rotateZ(a);
      m.translate(0, 0, -depth * 0.14);
      stone.push(m);
    }

    /* The hub. */
    stone.push(flatAnnulus(hubR, hubR * 0.42, depth * 0.7, 13));
    if (backGlass) glass.push(flatDisc(hubR * 0.44, depth * 0.3, 11));

    /* The lights. */
    for (const ring of rings) {
      for (let i = 0; i < ring.count; i += 1) {
        const a = (i / ring.count) * TAU + (ring.phase || 0);
        const rr = r * ring.at;
        const lit = cuspedLight({
          r: ring.foilR, foils: ring.foils, depth: depth * 0.5,
          frame: 0.085, phase: a,
        });
        lit.geo.translate(Math.cos(a) * rr, Math.sin(a) * rr, -depth * 0.05);
        stone.push(lit.geo);
        if (lit.extras.glass) {
          lit.extras.glass.translate(Math.cos(a) * rr, Math.sin(a) * rr, -depth * 0.05);
          glass.push(lit.extras.glass);
        }
      }
    }

    /* The glazing behind everything: one sheet of ice filling the
       whole opening. This is what makes it ICE rather than stained
       glass - a leaded window is glazed pane by pane in the tracery,
       a window that has FROZEN OVER is glazed by one continuous
       sheet with the tracery embedded in it. */
    if (backGlass) glass.push(flatDisc(r + 0.05, 0.16, 30).translate(0, 0, -depth * 0.46));

    return {
      geo: kit.merge(stone),
      extras: { glass: glass.length ? kit.merge(glass) : null, r, outerR: r + frame },
    };
  }

  /**
   * A WALL BUILT AROUND ITS OPENINGS.
   *
   * This is the single most important idea borrowed from the
   * Vault-Cathedral's south front (world.js:1697): a gothic wall is
   * not a slab with holes punched in it, it is a set of panels whose
   * edges ARE the openings. The difference is not academic. A slab
   * with a hole has no jamb - you cannot see the wall's thickness
   * through the opening - and no arch, so the head of every window is
   * a square notch. Panels give both for free, because the panel
   * beside an opening is a real solid whose end face is the reveal.
   *
   * `axis` is which world axis the wall RUNS along ("z" for a nave
   * flank, "x" for a front); `offset` is the wall's centre plane on
   * the other axis. Openings are placed by `u`, their coordinate
   * along the run.
   *
   * Each opening is a POINTED arch, struck as two arcs from centres
   * inside the span - the same construction `archOutline`
   * (structures.js:763) uses, restated here because we need the arc
   * as a function of height rather than as a polyline. The masonry
   * above the springing is emitted as stepped panels tight to the
   * arc: real voussoir courses, and tight to the NARROW end of each
   * band so no panel ever intrudes into the light.
   *
   * `kind: "niche"` gives the same treatment plus a back plate at
   * the outer half of the wall's thickness, so the opening is a
   * recess rather than a hole. Nine of those is the chapel's
   * interior.
   *
   * OPENINGS MAY NOT OVERLAP IN `u`. The panelisation walks the run
   * left to right and each opening claims its whole height band, so
   * two openings at the same `u` at different heights would each
   * emit the other's sill panel. Stack nothing; alternate instead.
   * The assert is a console warning rather than a throw, because a
   * mis-authored window must not be able to take the level down.
   */
  function panelledWall(wallOpts = {}) {
    const {
      axis = "z", u0 = 0, u1 = 10, base = 0, top = 13.5,
      thickness = 1.15, offset = 0, inward = -1,
      openings = [], bevel = 0.12, headSteps = 5,
    } = wallOpts;
    const parts = [];
    const resolved = [];

    /* One placement function, so the axis is decided once instead of
       at every panel. `w` is the extent along the run, `d` is the
       wall's thickness, and the perpendicular `p` lets the niche
       back plate sit off the wall's centre plane. */
    const panel = (uc, w, y, h, d = thickness, p = 0) => {
      if (w <= 0.06 || h <= 0.06) return;
      const g = kit.slab(
        axis === "z" ? d : w, h, axis === "z" ? w : d,
        Math.min(bevel, w * 0.2, h * 0.2)
      );
      if (axis === "z") g.translate(offset + p, y, uc);
      else g.translate(uc, y, offset + p);
      parts.push(g);
    };

    const sorted = openings.slice().sort((a, b) => a.u - b.u);
    let cursor = u0;
    for (const op of sorted) {
      const hw = op.width / 2;
      const rise = op.rise ?? 1.2;
      const spring = op.spring ?? (op.sill + op.width * 1.25);
      /* Two-centre pointed arch. `c` is how far inside the span each
         arc's centre sits; a bigger `rise` pulls the centres in and
         makes the head more lancet. */
      const c = hw * (1.35 / Math.max(0.35, rise));
      const R = c + hw;
      const apex = spring + Math.sqrt(Math.max(0, R * R - c * c));
      const halfAt = (y) => Math.max(0,
        Math.sqrt(Math.max(0, R * R - (y - spring) ** 2)) - c);

      if (op.u - hw < cursor - 1e-6) {
        console.warn("[summit-structures] panelledWall: openings overlap in u at", op.u);
      }
      // The pier between the last opening and this one.
      panel((cursor + (op.u - hw)) / 2, (op.u - hw) - cursor, base, top - base);
      // Sill panel under the opening.
      panel(op.u, op.width, base, op.sill - base);
      // The stepped head, tight to the arc.
      for (let k = 0; k < headSteps; k += 1) {
        const ya = lerp(spring, apex, k / headSteps);
        const yb = lerp(spring, apex, (k + 1) / headSteps);
        const hb = halfAt(yb);
        panel(op.u - (hw + hb) / 2, hw - hb, ya, yb - ya);
        panel(op.u + (hw + hb) / 2, hw - hb, ya, yb - ya);
      }
      // Above the head.
      panel(op.u, op.width, apex, top - apex);
      if (op.kind === "niche") {
        /* The back of the recess, pushed to the OUTER half of the
           wall so the hollow opens inward. `inward` is the sign of
           the interior side on the perpendicular axis. */
        const backT = thickness * 0.42;
        panel(op.u, op.width, op.sill, apex - op.sill, backT,
          -inward * (thickness - backT) / 2);
      }
      resolved.push({
        ...op, hw, spring, apex, axis, offset,
        centre: axis === "z" ? [offset, (op.sill + apex) / 2, op.u]
          : [op.u, (op.sill + apex) / 2, offset],
      });
      cursor = op.u + hw;
    }
    panel((cursor + u1) / 2, u1 - cursor, base, top - base);

    return { geo: kit.merge(parts), extras: { openings: resolved } };
  }

  /* ==================================================================
     THE CATHEDRAL OF THE NINTH ASCENT
     ================================================================== */

  /**
   * The summit building, as one builder.
   *
   * WHY IT LIVES IN THE KIT AND NOT IN `summit-world.js`. Every other
   * station is a scatter: place N of a primitive, bed them, move on.
   * The cathedral is a single object with a hundred parts that all
   * have to agree about six numbers, and the moment those numbers are
   * spread across a world file they start disagreeing - the roof
   * pitch that the eaves fringe is hung from stops matching the pitch
   * the roof was extruded at, and nobody notices until the icicles
   * are floating. Here the numbers are declared once at the top and
   * every part is derived from them, including the anchors handed
   * back in `extras` for the things the WORLD has to place: the
   * icicle fringes, the steps, the parvis paving, the braziers.
   *
   * ------------------------------------------------------------------
   * WHAT IT IS, AND WHY IT IS NOT THE VAULT-CATHEDRAL IN WHITE
   *
   * Vesper's Vault-Cathedral is a 132 m ruin lying open: its power is
   * that you walk INTO a broken thing at basin scale. Copying it here
   * would be the worst decision available, and not because it would
   * look derivative. **A bigger building on this summit makes the
   * mountain smaller.** The mountain is the subject; the chapel is
   * the thing that gives it scale. So this one is 54 m long, 17 m
   * wide, its eaves at 13.5 m - about a seventh of the Vault-
   * Cathedral's volume - and it is INTACT and SEALED, which is the
   * other inversion: nothing here is broken, because the whole point
   * is that somebody has kept it standing at 452 m for four
   * centuries in a 31 m/s wind.
   *
   * Every technique below is the Vault-Cathedral's, though:
   * panelised walls, string courses, buttresses with set-offs,
   * portals in three orders, a rose with two rings of lights, a
   * gallery of niches, a staged spire, ribs and webs. That building
   * is this codebase answering this exact problem very well, and
   * re-deriving its answers would only produce worse ones.
   *
   * ------------------------------------------------------------------
   * THE THREE THINGS THE MOUNTAIN ADDS
   *
   * 1. A 58-DEGREE ROOF. Not a style choice: a shallow roof at this
   *    altitude holds its own snow load until the structure fails.
   *    58 degrees sheds, and the number propagates - the ridge
   *    height, the gable outline, the transept ridge and where the
   *    eaves drip line sits are all derived from it, so changing the
   *    pitch moves the whole silhouette coherently.
   *
   * 2. DIRECTIONAL RIME. The windward face is rime-caked and the
   *    leeward face is wind-polished bare stone, both driven by
   *    `SUMMIT_WIND` and by nothing else. This is applied twice, on
   *    purpose and by two different mechanisms: `rimeFeathers`
   *    DISPLACES the windward geometry before faceting, and the
   *    paint blends `RIME_RAMP` in over the same exposure term
   *    afterwards. Displacement alone is invisible at 200 m; paint
   *    alone is a flat stain with no silhouette. Together they are
   *    the one thing that says this building has weather on it.
   *
   *    It also solves a lighting problem that is otherwise fatal.
   *    The level's key is a 7-degree sun from the ESE and its fill
   *    was cut to a third of the first pass's (the critique log's
   *    biggest single win), so an unrimed WNW wall renders at the
   *    very bottom of `GRANITE_RAMP` and reads as a black hole in
   *    the frame - exactly what the first-draft chapel does today.
   *    `RIME_RAMP`'s mid stop is about two and a half times the
   *    brightness of granite's floor, so the rimed windward face is
   *    the one that carries form on the shaded side. The physics and
   *    the composition want the same thing here, which is rare
   *    enough to be worth writing down.
   *
   * 3. AN ICE-GLAZED ROSE. Glazed by one continuous frozen sheet
   *    with the tracery embedded in it, not by leaded panes. It goes
   *    in the `glass` slot so the world can give it the unlit
   *    emissive material; a lit material on a south-facing disc at a
   *    7-degree sun renders as a grey plate.
   *
   * ------------------------------------------------------------------
   * FRAME AND THE ONE THING THE CALLER MAY NOT DO
   *
   * Authored in WORLD-AXIS-ALIGNED local space: the origin is the
   * centre of the nave floor, y = 0 is the floor (and the parvis),
   * +Z is the front. **Translate it; do not rotate it.** The rime is
   * computed against a world wind vector at build time, so a rotated
   * building has its rime on the wrong face and there is no symptom
   * except that the mountain stops looking like it has weather -
   * which is the failure mode `SUMMIT_WIND`'s own comment says is
   * the worst one available. `opts.wind` is there for a caller that
   * genuinely needs to rotate it.
   *
   * ------------------------------------------------------------------
   * RETURNS
   *
   *   { stone, glass, bronze, extras }
   *
   * Three geometries because the world has three materials to give:
   * a lit stone/granite, an unlit emissive for the ice, and bronze.
   * `stone` carries the walls, the roof, the spire, the black floor
   * and the interior - all of it separated by VERTEX COLOUR, not by
   * material, which is how the polished black floor and the pale
   * rimed gable can share one draw call.
   *
   * `extras`:
   *   eaves        [[x,y,z]...][]  the roof drip edges, in build order
   *   ledges       [[x,y,z]...][]  every other icicle-bearing ledge
   *   porchAABB    {min,max}       the portal frontispiece's box
   *   height       number          spire apex above the floor
   *   length       number          overall north-south length
   *   doorY        number          the threshold (0 - the floor)
   *   door         {x,z,width,clear,apex}
   *   footprint    [[x,z]...]      the cruciform plan at the wall face
   *   interiorAABB {min,max}       what the player can stand in
   *   drift        BufferGeometry  the blown snow inside the doors
   *   bins         {}              the material and flags each slot wants
   *   emitters     []              a rose shaft and a sanctuary flame
   *   tris         {}              measured, for the budget
   *
   * ------------------------------------------------------------------
   * MEASURED, headless Chromium, one build, geometry only:
   *
   *   74 ms   stone 50,866 tris   glass 3,588   bronze 517   drift 300
   *           ------------------------------------------------ 55,271
   *
   * Against a 60k budget, and it merges into three bins plus the
   * drift. The stone bin carries walls, roof, spire, buttresses,
   * tracery, the whole interior AND the black floor - four surfaces
   * in one draw call, separated by vertex colour.
   *
   * The single largest line is the fourteen buttresses at about 6k;
   * the tracery is 3.3k, the vault 4.1k, the floor 2.6k. The icicle
   * fringes are NOT in this number: they are built by the world off
   * `extras.eaves` and `extras.ledges`, and at the density the probe
   * used they come to about 50k on their own - which is the reason
   * those two lists are returned separately and the reason this note
   * says so. The world caps them; the building cannot.
   */
  function cathedral(rng, cathOpts = {}) {
    const r = rng || makeRng(0x9a5ce17);

    /* ---------------- the six numbers everything derives from ------- */
    const L = cathOpts.length ?? 54.0;        // overall, front face to chancel face
    const W = cathOpts.width ?? 17.0;         // overall across the nave
    const T = cathOpts.wallT ?? 1.15;         // wall thickness
    const EAVES = cathOpts.eaves ?? 13.5;
    const PITCH = cathOpts.pitchDeg ?? 58;
    const SPIRE_TOP = cathOpts.height ?? 62.0;

    const tanP = Math.tan((PITCH * Math.PI) / 180);
    const HW = W / 2;                         // 8.5
    const OVER = 0.75;                        // eaves overhang past the wall face
    const RIDGE = EAVES + (HW + OVER) * tanP; // 28.30
    const IX = HW - T;                        // interior half width, 7.35
    const ZF = L / 2;                         // front wall outer face, +27
    const ZB = -L / 2;                        // chancel outer face, -27
    const ZFI = ZF - T;                       // front inner face
    const ZBI = ZB + T;

    /* The crossing. Sited north of centre so the nave reads long and
       the chancel reads short, which is what makes the building have
       a FRONT rather than being a symmetrical cross. */
    const CZ0 = -3.5;                          // south face of the transept
    const CZ1 = -18.5;                         // north face
    const ARM = 6.0;                           // transept projection past the wall
    const AX = HW + ARM;                       // 14.5, arm end wall outer face
    const ARM_RIDGE = EAVES + ((CZ1 - CZ0) / -2 + OVER) * tanP;

    /* The vault rises INTO the roof void, which is why a 17 m-wide
       chapel can be 19.5 m tall inside. Springing at 9.5 keeps the
       wall shafts a readable length; the crown at 19.5 gives a 1.33:1
       section, which is the proportion that makes a small room feel
       gothic rather than merely tall. */
    const VS = 9.5;
    const VC = 19.5;

    /* The tower is the crossing carried up: same plan as the crossing
       so its walls ARE the nave and transept walls continued, which
       is both how it would be built and why it needs no separate
       support inside the one room. */
    const TOWER_TOP = 30.0;
    const PARAPET = 1.25;
    const SPIRE_BASE = TOWER_TOP + PARAPET * 0.32;
    const SPIRE_H = SPIRE_TOP - SPIRE_BASE;

    /** Is (x, z) inside the one room? Declared up here rather than
     *  with the floor it was written for, because the PAINT needs it
     *  too - see section 14. */
    const inRoom = (x, z) => {
      if (z > ZFI || z < ZBI) return false;
      if (Math.abs(x) <= IX) return true;
      return z <= CZ0 - T && z >= CZ1 + T && Math.abs(x) <= AX - T;
    };

    const shell = [];      // exterior, gets the rime pass
    const inner = [];      // interior, does not
    const floorParts = [];
    const driftParts = [];
    const glassParts = [];
    const bronzeParts = [];
    const eaves = [];
    const ledges = [];

    /* ================================================================
       1. THE PLAN

       One cruciform ring at the wall's outer face, walked once. Every
       course, every gable and the parvis paving are derived from it,
       so the building cannot disagree with itself about its own
       footprint.
       ================================================================ */
    const foot = [
      [HW, ZF], [HW, CZ0], [AX, CZ0], [AX, CZ1], [HW, CZ1], [HW, ZB],
      [-HW, ZB], [-HW, CZ1], [-AX, CZ1], [-AX, CZ0], [-HW, CZ0], [-HW, ZF],
    ];
    const ringAt = (y) => foot.map((p) => [p[0], y, p[1]]);

    /* ================================================================
       2. THE PLINTH AND THE STRING COURSES

       Three horizontals running the FULL width of every elevation.
       In a facade made almost entirely of verticals - buttresses,
       mullions, lancets, a spire - these are the only things holding
       it together; without them a gothic front reads as a picket
       fence. They are also, on this mountain, the ledges: every one
       comes back in `ledges` with its drip line, and the world hangs
       an icicle fringe off it.
       ================================================================ */
    {
      /* INTERRUPTED AT THE DOOR, and it was not.

         Closed, this course runs its full 1.05 m straight across the
         entrance - a chest-high bar of masonry in the one opening the
         whole building exists to be entered through. It went unnoticed
         for as long as the chapel floor sat 34 cm above the building's
         own datum, because that put the plinth's top 0.71 m over the
         player's feet, inside collide.js's 0.82 m step: you were
         climbing over it every time and it read as a threshold. Seated
         properly on the pad the same course is 1.0 m up, the step
         fails, and the doors stop being doors.

         `foot` begins at [HW, ZF] and ends at [-HW, ZF], so the front
         face IS its closing segment - the one `closed: true` adds.
         Sweeping it open with a stub at each jamb leaves the plinth
         running everywhere except the door, which is what a plinth
         does at an entrance anyway. */
      const PLINTH_DOOR_GAP = 4.0 * 0.5 + 1.05;   // DOOR_W/2 plus a jamb
      const plinth = stringCourse(
        [[PLINTH_DOOR_GAP, 0, ZF]].concat(ringAt(0)).concat([[-PLINTH_DOOR_GAP, 0, ZF]]),
        { project: 0.46, height: 1.05, closed: false },
      );
      shell.push(plinth.geo);
      // No fringe on the plinth: it is buried in the drift at its foot.

      for (const [y, proj, h] of [[8.6, 0.34, 0.62], [12.55, 0.30, 0.55]]) {
        const sc = stringCourse(ringAt(y), { project: proj, height: h, closed: true });
        shell.push(sc.geo);
        ledges.push(sc.extras.lip);
      }
      /* The eaves cornice. Heavier than the string courses because it
         is carrying the roof's overhang, and because it is the
         horizontal that reads from the basecamp 900 m away. */
      const corn = stringCourse(ringAt(EAVES - 0.75), { project: 0.52, height: 0.78, closed: true });
      shell.push(corn.geo);
      ledges.push(corn.extras.lip);
    }

    /* ================================================================
       3. THE WALLS, PANELISED AROUND THEIR OPENINGS

       Three windows and three niches alternating down each nave
       flank. They alternate rather than stack because `panelledWall`
       claims a whole height band per opening (see its header) - and
       because a real chapel puts its altars between its windows, so
       the alternation is what the building would do anyway.
       ================================================================ */
    const allOpenings = [];
    const lancet = (u, extra = {}) => ({
      u, width: 2.30, sill: 6.0, spring: 9.4, rise: 1.2, glaze: true, ...extra,
    });
    const nicheAt = (u, extra = {}) => ({
      u, width: 2.05, sill: 1.25, spring: 3.15, rise: 1.1, kind: "niche", ...extra,
    });

    for (const side of [-1, 1]) {
      const offset = side * (HW - T / 2);
      const inward = -side;
      // Nave flank: front wall to the transept.
      const nave = panelledWall({
        axis: "z", u0: CZ0, u1: ZF, base: 0, top: EAVES,
        thickness: T, offset, inward,
        openings: [
          nicheAt(0.6), lancet(4.9), nicheAt(9.4), lancet(13.7),
          nicheAt(18.2), lancet(22.6),
        ],
      });
      shell.push(nave.geo);
      allOpenings.push(...nave.extras.openings);

      // Chancel flank, north of the transept.
      const chancel = panelledWall({
        axis: "z", u0: ZB, u1: CZ1, base: 0, top: EAVES,
        thickness: T, offset, inward,
        openings: [lancet(-22.6, { width: 2.0, spring: 9.0 })],
      });
      shell.push(chancel.geo);
      allOpenings.push(...chancel.extras.openings);

      // The two transept side walls, running out along X.
      for (const zf of [CZ0, CZ1]) {
        const w = panelledWall({
          axis: "x", u0: side > 0 ? HW - T : -AX, u1: side > 0 ? AX : -HW + T,
          base: 0, top: EAVES, thickness: T,
          offset: zf + (zf === CZ0 ? -T / 2 : T / 2),
          inward: zf === CZ0 ? -1 : 1,
          openings: [],
        });
        shell.push(w.geo);
      }

      // The transept arm end wall: two lancets and a niche between.
      const armEnd = panelledWall({
        axis: "z", u0: CZ1, u1: CZ0, base: 0, top: EAVES,
        thickness: T, offset: side * (AX - T / 2), inward: -side,
        openings: [
          lancet(CZ0 - 3.6, { width: 2.0, spring: 9.0 }),
          nicheAt(-11.0, { width: 2.4, sill: 1.4, spring: 3.6 }),
          lancet(CZ1 + 3.6, { width: 2.0, spring: 9.0 }),
        ],
      });
      shell.push(armEnd.geo);
      allOpenings.push(...armEnd.extras.openings);
    }

    /* The chancel end wall: three graded lancets and the reliquary
       niche under them. This is the wall the whole interior faces. */
    {
      const back = panelledWall({
        axis: "x", u0: -HW, u1: HW, base: 0, top: EAVES,
        thickness: T, offset: ZB + T / 2, inward: 1,
        openings: [
          lancet(-4.3, { width: 1.9, sill: 6.8, spring: 9.4 }),
          nicheAt(0, { width: 3.0, sill: 1.6, spring: 4.4, rise: 1.15 }),
          lancet(4.3, { width: 1.9, sill: 6.8, spring: 9.4 }),
        ],
      });
      shell.push(back.geo);
      allOpenings.push(...back.extras.openings);
    }

    /* ================================================================
       4. THE SOUTH FRONT

       The face of the building, and the only elevation the level is
       actually composed around: `summit-parvis` looks straight at it
       and it is the silhouette the basecamp gate sees at 900 m.

       Built in two storeys because the rose crosses the eaves line.
       Below 11.2 m it is a panelled wall around the portal and two
       niches; above it, a stepped gable coursed around the rose. The
       stepping is tight to the NARROW end of every band, so no
       course ever intrudes into the light or past the roof plane -
       the same rule the arch heads are cut to.
       ================================================================ */
    const DOOR_W = 4.0;
    const DOOR_SPRING = 3.9;
    const doorHalf = DOOR_W / 2;
    const doorC = doorHalf * (1.35 / 1.2);
    const doorR = doorC + doorHalf;
    const DOOR_APEX = DOOR_SPRING + Math.sqrt(doorR * doorR - doorC * doorC);
    const ROSE_Y = 15.6;
    const ROSE_R = 3.4;
    const ROSE_FRAME = 0.62;
    {
      const front = panelledWall({
        axis: "x", u0: -HW, u1: HW, base: 0, top: 11.2,
        thickness: T, offset: ZF - T / 2, inward: -1,
        /* THE PORTAL AND NOTHING ELSE. The first pass put a niche
           either side of it, which took the interior's count to
           eleven - and the world is named for the NINE ascents, so
           nine is not a decoration, it is the building's argument.
           Six down the nave, one in each transept arm, one behind
           the altar. The two that went were also the two nobody
           could ever see: a recess in the front wall opens into the
           two metres of floor directly behind the doors, which is
           where the drift lies. */
        openings: [
          { u: 0, width: DOOR_W, sill: 0, spring: DOOR_SPRING, rise: 1.2 },
        ],
      });
      shell.push(front.geo);
      allOpenings.push(...front.extras.openings);
    }

    /** The gable outline: half width at height y.
     *
     *  DERIVED FROM THE ROOF PLANE, not from the wall. The first
     *  version interpolated linearly from the wall's half width at
     *  the eaves to zero at the ridge, which is a rake of 61.8
     *  degrees against a 58-degree roof - so the gable sat BELOW the
     *  roof everywhere and the roof's 0.75 m overhang hid it
     *  completely. From the parvis the front of the building was the
     *  cut end of a roof extrusion. A parapet gable's rake is
     *  parallel to the roof and raised by the coping, which is this:
     *  the same `tanP` the roof was struck with, offset by COPE, and
     *  clamped to the wall's own half width low down so the gable
     *  springs from the eaves rather than from thin air. */
    const COPE = 0.40;
    const gableHalfAt = (y, maxHalf, ridgeY = RIDGE) => Math.min(
      maxHalf, Math.max(0, (ridgeY + COPE - y) / tanP)
    );

    {
      /* The front gable, coursed around the rose. */
      const y0 = 11.2;
      /* TWENTY-SIX, not fifteen. The band count is the size of the
         step in the gable's raking edge: 15 bands over 17.5 m is a
         0.73 m step, and from the parvis that reads as
         castellation - a ziggurat with a rose in it. 26 bands is a
         0.42 m step, which the coping below covers. The coping's
         projection and the band height are therefore the same
         number in two places, and this is the note that says so. */
      const bands = 26;
      const roseOut = ROSE_R + ROSE_FRAME + 0.14;
      for (let k = 0; k < bands; k += 1) {
        const ya = lerp(y0, RIDGE, k / bands);
        const yb = lerp(y0, RIDGE, (k + 1) / bands);
        const outer = gableHalfAt(yb, HW);
        if (outer <= 0.12) continue;
        /* The widest the opening gets anywhere in this band. Using
           the narrowest would put stone across the top and bottom of
           the rose; the light has to be cut to the band's maximum. */
        const dy = (ya - ROSE_Y) * (yb - ROSE_Y) <= 0
          ? 0
          : Math.min(Math.abs(ya - ROSE_Y), Math.abs(yb - ROSE_Y));
        const hr = dy < roseOut ? Math.sqrt(roseOut * roseOut - dy * dy) : 0;
        const h = yb - ya;
        if (hr <= 0.05) {
          shell.push(kit.slab(outer * 2, h, T, 0.1).translate(0, ya, ZF - T / 2));
        } else if (hr < outer) {
          const w = outer - hr;
          shell.push(kit.slab(w, h, T, 0.1).translate(-(hr + outer) / 2, ya, ZF - T / 2));
          shell.push(kit.slab(w, h, T, 0.1).translate((hr + outer) / 2, ya, ZF - T / 2));
        }
      }
      /* The raking coping, and the kneelers it starts from. A gable
         with no coping is a sawn edge; the coping is also what the
         gable's own icicle run hangs off. */
      for (const s of [-1, 1]) {
        const rake = [];
        for (let k = 0; k <= 6; k += 1) {
          const y = lerp(EAVES - 0.4, RIDGE + COPE, k / 6);
          rake.push([s * gableHalfAt(y, HW + 0.16), y, ZF - T / 2]);
        }
        const cop = stringCourse(rake, { project: 0.44, height: 0.60 });
        shell.push(cop.geo);
        ledges.push(cop.extras.lip);
      }
      // The finial where the copings meet.
      shell.push(kit.prism({ h: 3.4, rBottom: 0.62, rTop: 0.05, sides: 4, twist: Math.PI / 4 })
        .translate(0, RIDGE + COPE - 0.3, ZF - T / 2));
    }

    /** A plain gable, for the three elevations with no rose in them.
     *
     *  A PENTAGON, not a triangle: the rake only starts biting once
     *  it is inside the wall's half width, so the outline is two
     *  short verticals (the kneelers) and then the rake. Checked for
     *  convexity by hand at all five corners, because `extrudeZ`
     *  fans its end caps and a concave gable would come out with its
     *  own outline filled in solid. */
    const plainGable = (maxHalf, ridgeY, thick) => {
      const kneeY = ridgeY + COPE - maxHalf * tanP;
      return kit.extrudeZ([
        [-maxHalf, EAVES - 1.2], [maxHalf, EAVES - 1.2],
        [maxHalf, kneeY], [0, ridgeY + COPE], [-maxHalf, kneeY],
      ], thick);
    };

    {
      /**
       * The three gables that are not the front, each with the same
       * three things: the wall, a raking coping, and an oculus.
       *
       * The coping is not decoration here. It is what stops a gable
       * reading as a sawn edge, and on this mountain it is also a
       * 20 m ledge in the one place icicles are most visible against
       * sky - so it goes into `ledges` like every other one.
       *
       * The oculus is there because a blank gable is dead area. The
       * transept's east gable is 15 m across and 13 m tall and it
       * faces the whole east approach; without something in it the
       * best-lit surface on the building is an empty triangle. A
       * cusped oculus is the cheapest thing that reads at that size,
       * and it puts the ice glazing on three more elevations, which
       * is what carries the building at night.
       *
       * Rotated for the arms, never mirrored, and the gable profile
       * is symmetric in its own axis so one rotation serves both.
       */
      const gable = (maxHalf, ridgeY, rotY, cx, cz, oculusR, out) => {
        const g = plainGable(maxHalf, ridgeY, T);
        if (rotY) g.rotateY(rotY);
        g.translate(cx, 0, cz);
        shell.push(g);

        const rake = [];
        for (let k = 0; k <= 6; k += 1) {
          const y = lerp(EAVES - 0.4, ridgeY + COPE, k / 6);
          rake.push([-gableHalfAt(y, maxHalf + 0.16, ridgeY), y, 0]);
        }
        for (let k = 6; k >= 0; k -= 1) {
          const y = lerp(EAVES - 0.4, ridgeY + COPE, k / 6);
          rake.push([gableHalfAt(y, maxHalf + 0.16, ridgeY), y, 0]);
        }
        const cop = stringCourse(rake, { project: 0.40, height: 0.55 });
        if (rotY) cop.geo.rotateY(rotY);
        cop.geo.translate(cx, 0, cz);
        shell.push(cop.geo);
        const rot = rotY || 0;
        ledges.push(cop.extras.lip.map(([lx, ly, lz]) => [
          cx + lx * Math.cos(rot) + lz * Math.sin(rot),
          ly,
          cz - lx * Math.sin(rot) + lz * Math.cos(rot),
        ]));

        // A finial where the copings meet.
        shell.push(kit.prism({ h: 2.6, rBottom: 0.48, rTop: 0.05, sides: 4, twist: Math.PI / 4 })
          .translate(cx, ridgeY + COPE - 0.25, cz));

        if (!oculusR) return;
        /* BLIND, AND DELIBERATELY SO. Cutting a real hole would open
           into the roof void, which is a black box: the vault crown
           is at 19.5 m and these gables start at 12.3 m, so the top
           two thirds of every one of them has nothing behind it but
           rafters. A blind oculus glazed with ice against dark stone
           is both what such a gable actually gets and the version
           that reads - it is a disc of light, not a hole into a
           black space. It costs 90 triangles and no wall surgery.

           Set PROUD of the wall face by the outward normal the
           caller passes. The first pass offset it by +0.1 on the
           gable's own +Z, which for the chancel (whose outside is
           -Z) buried the whole ring inside 1.15 m of masonry and
           left a faint scratch on the wall. */
        const ox = (out && out[0]) || 0;
        const oz = (out && out[1]) || 0;
        const oy = EAVES + (ridgeY - EAVES) * 0.42;
        /* PROUD BY MORE THAN HALF ITS OWN DEPTH. At 0.42 the ring
           stood only 0.19 m clear of a 1.15 m wall, which left the
           glazing - 0.29 m of it - entirely buried in masonry: from
           outside the oculus was a lobed groove cut in the gable
           with the wall showing through the middle of it, and no
           ice anywhere. The ring and the glass have to be offset
           together, and by enough that the glass's whole thickness
           clears the wall face. */
        const oc = cuspedLight({
          r: oculusR, foils: 6, cusp: 0.24, frame: 0.22, depth: 0.55, perFoil: 5,
        });
        oc.geo.rotateY(rotY || 0);
        oc.geo.translate(cx + ox * 0.62, oy, cz + oz * 0.62);
        shell.push(oc.geo);
        if (oc.extras.glass) {
          const gl = oc.extras.glass;
          /* Brighter than the lancets. A 1.7 m disc read at 100 m
             has to survive the aerial-perspective fade that a 6 m
             lancet at 20 m does not; at the lancets' value it was a
             hole in the gable rather than ice in it. */
          paintGeometry(THREE, gl, GLACIER_RAMP, () => 0.46, { jitter: 0.2 });
          gl.rotateY(rotY || 0);
          gl.translate(cx + ox * 0.70, oy, cz + oz * 0.70);
          glassParts.push(gl);
        }
      };

      gable(HW, RIDGE, 0, 0, ZB + T / 2, 1.55, [0, -1]);
      for (const s of [-1, 1]) {
        gable((CZ0 - CZ1) / 2, ARM_RIDGE, s > 0 ? Math.PI / 2 : -Math.PI / 2,
          s * (AX - T / 2), (CZ0 + CZ1) / 2, 1.75, [s, 0]);
      }
    }

    /* ================================================================
       5. BUTTRESSES STANDING PROUD, WITH SET-OFFS

       Fourteen of them, and they are doing three jobs. They are what
       gives the flank a rhythm at 900 m; they are the only thing on
       the shaded WNW elevation that casts a shadow onto anything
       else, so they are what stops that face reading as a black
       rectangle; and their set-offs are ledges.
       ================================================================ */
    {
      const flankStages = [
        { top: 6.4, project: 1.85 }, { top: 10.2, project: 1.30 },
        { top: 12.3, project: 0.85 },
      ];
      const addButtress = (x, z, rotY, opts) => {
        const b = setOffButtress(opts || { width: 2.1, stages: flankStages });
        const g = b.geo;
        if (rotY) g.rotateY(rotY);
        g.translate(x, 0, z);
        shell.push(g);
        /* Only the TOP set-off comes back as a ledge. The lower two
           are 6 m up a wall with the one above overhanging them, so
           nothing drips onto them and nothing hangs off them - a
           fringe there would be a fringe under a roof. */
        const st = b.extras.setOffs[b.extras.setOffs.length - 1];
        const c = Math.cos(rotY || 0);
        const s = Math.sin(rotY || 0);
        const run = [];
        for (const t of [-0.5, 0.5]) {
          const lx = st.project;
          const lz = t * st.width;
          run.push([x + lx * c + lz * s, st.y, z - lx * s + lz * c]);
        }
        ledges.push(run);
      };

      for (const side of [-1, 1]) {
        const rotY = side > 0 ? 0 : Math.PI;          // rotation, never a mirror
        // Nave flank, between the bays.
        for (const z of [24.4, 16.6, 8.9, 1.2]) addButtress(side * HW, z, rotY);
        // Chancel flank.
        addButtress(side * HW, -21.6, rotY);
        // Transept arm end, two corner buttresses.
        for (const z of [CZ0 - 1.4, CZ1 + 1.4]) {
          addButtress(side * AX, z, rotY, {
            width: 1.9,
            stages: [{ top: 6.0, project: 1.6 }, { top: 10.0, project: 1.1 },
              { top: 12.3, project: 0.75 }],
          });
        }
      }
      // Front corners, projecting south.
      for (const s of [-1, 1]) {
        addButtress(s * (HW - 1.15), ZF, Math.PI / 2, {
          width: 2.3,
          stages: [{ top: 7.0, project: 2.0 }, { top: 11.0, project: 1.4 },
            { top: 13.4, project: 0.9 }],
          gablet: 2.6, pinnacle: 4.4,
        });
      }
    }

    /* ================================================================
       6. THE PORTAL, IN THREE ORDERS

       Recessed portals are the one gothic device that cannot be
       faked with paint: what you read is three arch rings at three
       depths throwing shadows across each other, and at a 7-degree
       sun those shadows are long. The orders stand PROUD of the wall
       and step back into it rather than being cut into 1.15 m of
       masonry, which is both how a frontispiece is actually built
       and the only way to get 2 m of depth out of a thin wall.
       ================================================================ */
    const PORCH_Z = ZF + 1.95;
    {
      const orders = [
        { w: 8.4, h: 12.4, t: 1.00, z: ZF + 1.95, d: 1.30 },
        { w: 6.9, h: 11.3, t: 0.85, z: ZF + 1.05, d: 1.15 },
        { w: 5.4, h: 10.2, t: 0.70, z: ZF + 0.32, d: 1.00 },
      ];
      for (const o of orders) {
        const a = kit.gothicArch({
          width: o.w, height: o.h, depth: o.d, thickness: o.t, rise: 1.2,
        });
        a.translate(0, 0, o.z);
        shell.push(a);
      }
      /* Nook shafts in the angles of the orders. Two per side, and
         they are what turns a stack of arch rings into a jamb. */
      for (const s of [-1, 1]) {
        for (const [x, z, h] of [[3.55, ZF + 1.5, 4.2], [2.85, ZF + 0.7, 4.0]]) {
          shell.push(kit.column({ h, r: 0.30, shafts: 3, shaftR: 0.11 })
            .translate(s * x, 0, z));
        }
      }
      /* The hood: a small gable over the outermost order. It is what
         throws meltwater clear of the doorway, and its rake is the
         one ledge on the building at head height - the icicle fringe
         there is the first thing you see at the door. */
      const hoodApex = 12.9;
      shell.push(kit.extrudeZ([
        [-4.9, 9.4], [0, hoodApex], [4.9, 9.4], [4.9, 8.7], [0, hoodApex - 0.7], [-4.9, 8.7],
      ], 1.5).translate(0, 0, ZF + 1.5));
      const hoodRun = [];
      for (const s of [-1, 1]) hoodRun.push([s * 4.85, 8.75, ZF + 2.2]);
      eaves.push(hoodRun);
    }

    /* ================================================================
       7. THE ROSE, GLAZED WITH ICE
       ================================================================ */
    {
      const rose = tracery({
        r: ROSE_R, frame: ROSE_FRAME, depth: 0.78, spokes: 16, hubR: 0.55,
        rings: [
          { at: 0.40, count: 8, foilR: 0.50, foils: 5 },
          { at: 0.745, count: 16, foilR: 0.42, foils: 3 },
        ],
      });
      rose.geo.translate(0, ROSE_Y, ZF - T * 0.5 + 0.30);
      shell.push(rose.geo);
      if (rose.extras.glass) {
        rose.extras.glass.translate(0, ROSE_Y, ZF - T * 0.5 + 0.30);
        /* Painted here rather than by the world, because how bright
           the ice is allowed to be is a decision about the ICE, and
           the world has no way to know that a rose is a different
           depth of ice from a lancet. Low on GLACIER_RAMP: the ramp's
           dark end is where the saturation lives (summit-art.js:209),
           and this material is UNLIT and goes straight into a linear
           buffer the bloom pass reads next. Authored at the
           brightness it "should" have when backlit, it comes out as a
           luminous plastic pinwheel - Vesper's rose records exactly
           that failure at world.js:1928.

           Graded by radius so the window has structure rather than
           being one flat disc: the hub reads as the deepest ice. */
        paintGeometry(THREE, rose.extras.glass, GLACIER_RAMP, (x, y) => {
          const rr = Math.hypot(x, y - ROSE_Y) / (ROSE_R + ROSE_FRAME);
          return clamp01(0.16 + 0.34 * rr);
        }, { jitter: 0.16 });
        glassParts.push(rose.extras.glass);
      }
    }

    /* ================================================================
       8. THE GALLERY OF NICHES

       Five, in the gable above the rose, where a gable gallery
       belongs. They are the smallest things on the front and they
       are what gives the rose a size: without a row of 2.4 m figures
       beside it the rose could be any diameter at all.
       ================================================================ */
    {
      /* THREE, NOT FIVE, AND THEY MOVED DOWN.
         The first pass put five 2.35 m figures in a row across the
         gable above the rose, each under a spiked canopy. At the
         only distance the front is ever composed from - the parvis,
         and the basecamp gate at 900 m - a row of five small
         spikes on a raking edge does not read as sculpture. It
         reads as cresting, or as a comb, and it fought the rake it
         was sitting on.

         Three, arranged the way a gable actually is: a pair
         flanking the rose at its own centre height, and one above
         it on the axis. That is a composition rather than a row,
         the outer two are clear of the rose's frame by 0.8 m, and
         the figures can be half again as tall because there are two
         fewer of them. The canopies are small gablets rather than
         spires, because a spire above a figure on a gable is a
         second rake arguing with the first. */
      const zf = ZF - T * 0.5 + 0.52;
      const niche = (x, y, h) => {
        shell.push(kit.prism({ h: 0.55, rBottom: 0.30, rTop: 0.66, sides: 5 })
          .translate(x, y - 0.55, zf));
        shell.push(kit.slab(1.7, 0.28, 1.05, 0.08).translate(x, y + h + 0.18, zf));
        shell.push(kit.extrudeZ([
          [x - 0.85, y + h + 0.46], [x, y + h + 1.45], [x + 0.85, y + h + 0.46],
        ], 0.9).translate(0, 0, zf));
        const st = kit.statue(r, {
          h, style: r.pick(["sword", "book", "censer"]),
          plinth: false, broken: 0, halo: r.chance(0.5),
        });
        st.translate(x, y, zf);
        shell.push(st);
      };
      for (const s of [-1, 1]) niche(s * (ROSE_R + ROSE_FRAME + 1.6), ROSE_Y - 1.4, 2.9);
      niche(0, ROSE_Y + ROSE_R + ROSE_FRAME + 0.95, 3.2);
    }

    /* ================================================================
       9. THE ROOFS

       Vesper's roof profile, and Vesper's caveat with it: the
       profile is CONCAVE (it has an underside), so `extrudeZ`'s fan
       end caps span the hollow and come out solid. That is harmless
       here for exactly the reason it was harmless there - every one
       of these four roofs has both of its ends buried, in a gable or
       in the tower - and it is worth 40 triangles a roof not to build
       a capless variant. It would NOT be harmless on a roof with a
       free end, so this comment is the warning for the next one.
       ================================================================ */
    const ROOF_T = 0.58;
    /**
     * ONE SLOPE, as a convex quadrilateral. The obvious authoring is
     * the whole roof in one profile - eaves, ridge, eaves, and back
     * along the underside - which is what the Vault-Cathedral does
     * (world.js:1648) and what the first pass here did.
     *
     * That profile is CONCAVE, and `extrudeZ` fans its end caps,
     * which fills the hollow in solid (structures.js:295). On
     * Vesper it is invisible because both ends of that roof are
     * buried. Here it was not: the nave roof's south end sits at the
     * front wall's inner face, and the rose window looks straight at
     * it. From inside the chapel the whole rose above 13.4 m was
     * BLACK - a solid triangle of roof standing in the room, six
     * metres of it below the vault crown - while from outside
     * everything looked perfect, because the gable hides it.
     *
     * Found by raycasting from the interior camera to the rose
     * centre, which returned `cath-stone` at z = 25.85 before it
     * reached the glass. It is the codebase's own rule and it saved
     * an hour: raycast before deciding a thing is "not rendering".
     *
     * Two convex slopes have honest end caps, cost one extra
     * extrusion, and let each slope carry its own rime exposure.
     */
    const roofPair = (half, eavesY, ridgeY, depth, mapPt) => {
      const out = [];
      for (const side of [-1, 1]) {
        const prof = [
          [side * half, eavesY], [0, ridgeY],
          [0, ridgeY - ROOF_T], [side * half, eavesY - ROOF_T],
        ].map(mapPt || ((q) => q));
        out.push(kit.extrudeZ(prof, depth));
      }
      return out;
    };
    {
      // Nave: front gable to the tower.
      const naveL = ZFI - CZ0;
      for (const g of roofPair(HW + OVER, EAVES, RIDGE, naveL)) {
        g.translate(0, 0, (ZFI + CZ0) / 2);
        shell.push(g);
      }
      // Chancel: tower to the back gable.
      const chL = CZ1 - ZBI;
      for (const g of roofPair(HW + OVER, EAVES, RIDGE, chL)) {
        g.translate(0, 0, (CZ1 + ZBI) / 2);
        shell.push(g);
      }
      /* Slate courses. The roof is nearly a third of the building's
         silhouette from the parvis and every square metre of it was
         one flat plane; at 58 degrees it is also the surface the
         grazing key hits hardest, so it was the brightest and most
         featureless thing in frame. A lap line every 2.4 m up the
         pitch costs 40 triangles apiece and gives the plane a scale
         to be read against - which is the whole job, since nothing
         else on a roof tells you how big it is. */
      for (const [z0, z1] of [[CZ0, ZFI], [ZBI, CZ1]]) {
        for (let u = 2.0; u < HW + OVER; u += 2.0) {
          for (const side of [-1, 1]) {
            const y = RIDGE - u * tanP;
            shell.push(kit.extrudeZ([
              [side * u, y], [side * (u - 0.18), y + 0.34],
              [side * (u - 0.18), y + 0.02], [side * u, y - 0.12],
            ], z1 - z0).translate(0, 0, (z0 + z1) / 2));
          }
        }
      }
      // Ridge crests.
      for (const [z, len] of [[(ZFI + CZ0) / 2, naveL], [(CZ1 + ZBI) / 2, chL]]) {
        shell.push(kit.slab(0.85, 0.7, len, 0.12).translate(0, RIDGE - 0.1, z));
      }
      // The four eaves drip lines.
      for (const s of [-1, 1]) {
        eaves.push([[s * (HW + OVER), EAVES - ROOF_T + 0.04, ZFI],
          [s * (HW + OVER), EAVES - ROOF_T + 0.04, CZ0]]);
        eaves.push([[s * (HW + OVER), EAVES - ROOF_T + 0.04, CZ1],
          [s * (HW + OVER), EAVES - ROOF_T + 0.04, ZBI]]);
      }

      /* The transept arm roofs. Their ridge runs along X, so the
         section lives in the ZY plane and `extrudeZ` (which always
         extrudes along Z) has to be turned. Turned by ROTATION with
         the profile's sign flipped for the far arm, never by a
         negative scale: a mirror reverses the triangle winding and
         with backface culling on, half the transept renders inside
         out - the failure `flyingButtress` is annotated for at
         structures.js:944. `extrudeZ` force-winds its profile by
         signed area, so the sign flip costs nothing. */
      const armHalf = (CZ0 - CZ1) / 2 + OVER;
      const armMidZ = (CZ0 + CZ1) / 2;
      const armLen = (AX + OVER) - (HW - 0.5);
      const armCx = (HW - 0.5) + armLen / 2;
      for (const s of [-1, 1]) {
        /* `rotateY(+PI/2)` maps (a, y, b) -> (b, y, -a), so the
           profile's own axis `a` lands on -z and the extrusion lands
           on +x; `rotateY(-PI/2)` maps it to (-b, y, a), so `a`
           lands on +z. Authoring `a` with the matching sign is what
           lets both arms be built by a ROTATION. Mirroring by
           negating a scale would reverse the triangle winding and
           render half the transept inside out (structures.js:944). */
        const map = ([a, y]) => [s > 0 ? -(armMidZ + a) : (armMidZ + a), y];
        for (const g of roofPair(armHalf, EAVES, ARM_RIDGE, armLen, map)) {
          g.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
          g.translate(s * armCx, 0, 0);
          shell.push(g);
        }
        shell.push(kit.slab(armLen, 0.7, 0.85, 0.12)
          .translate(s * armCx, ARM_RIDGE - 0.1, armMidZ));
        for (const zEdge of [CZ0 + OVER, CZ1 - OVER]) {
          eaves.push([
            [s * (HW - T * 0.4), EAVES - ROOF_T + 0.04, zEdge],
            [s * (AX + OVER), EAVES - ROOF_T + 0.04, zEdge],
          ]);
        }
      }
    }

    /* ================================================================
       10. THE CROSSING TOWER AND THE SPIRE

       The level's plumb line. 62 m over a 28 m ridge, on a 452 m
       peak: the spire is what carries the eye up the last third of
       the mountain, and it is the one element of this building that
       has to work at 900 m as well as at 2 m.

       Staged, with a set-back and a string course at every break.
       A straight cone reads as a party hat - `spire`'s own header
       says so - and the stages are what give it height.
       ================================================================ */
    {
      const tw = HW;                 // the crossing carried up
      const td = (CZ1 - CZ0) / -2;
      const tz = (CZ0 + CZ1) / 2;
      const parts = [];
      /* FOUR WALLS AND A LID, not one box. A `slab` is a closed
         solid, so a tower built as one would put its bottom face
         across the crossing at 11.5 m - a flat stone ceiling eight
         metres under the vault, in the one bay the vault is most
         worth seeing from. Four walls leave the crossing open to the
         vault and seal the void above it with the lid. */
      const tBase = EAVES - 2.0;
      const tH = TOWER_TOP - tBase;
      for (const s of [-1, 1]) {
        parts.push(kit.slab(T, tH, td * 2, 0.3)
          .translate(s * (tw - T / 2), tBase, tz));
        parts.push(kit.slab(tw * 2, tH, T, 0.3)
          .translate(0, tBase, tz + s * (td - T / 2)));
      }
      parts.push(kit.slab(tw * 2, 0.6, td * 2, 0.2)
        .translate(0, TOWER_TOP - 0.6, tz));
      // Corner shafts: the verticals that stop a tower reading as a box.
      for (const ox of [-1, 1]) {
        for (const oz of [-1, 1]) {
          parts.push(kit.prism({
            h: TOWER_TOP - EAVES + 2.0, rBottom: 0.62, rTop: 0.54, sides: 5,
          }).translate(ox * (tw - 0.35), EAVES - 2.0, tz + oz * (td - 0.35)));
        }
      }
      /* Belfry openings. Two per face, and they are the point of a
         tower - a blank one is a chimney. Tall and paired, because
         the first pass's single squat opening read as a letterbox
         slot, which is the same note the Vault-Cathedral's
         clerestory carries. */
      /* `gothicArch` is authored face-on to +-Z. The pair on the
         tower's X faces therefore needs a quarter turn and the pair
         on its Z faces needs none - the reverse of what the first
         pass did, which left four arches standing out sideways off
         the tower like handles. Rotation BEFORE translation, too:
         `rotateY` turns about the origin, so an arch translated
         first sweeps around the building instead of turning on the
         spot. */
      for (const s of [-1, 1]) {
        for (const off of [-0.30, 0.30]) {
          const a = kit.gothicArch({
            width: 3.0, height: 8.2, depth: 1.1, thickness: 0.55, rise: 1.25,
          });
          a.rotateY(Math.PI / 2);
          a.translate(s * (tw + 0.02), TOWER_TOP - 11.0, tz + off * td * 2);
          parts.push(a);
          const b = kit.gothicArch({
            width: 3.0, height: 8.2, depth: 1.1, thickness: 0.55, rise: 1.25,
          });
          b.translate(off * tw * 2, TOWER_TOP - 11.0, tz + s * (td + 0.02));
          parts.push(b);
        }
      }
      // Cornice, then a real parapet walk with corner pinnacles.
      const corn = stringCourse([
        [tw + 0.4, TOWER_TOP, tz - td - 0.4], [tw + 0.4, TOWER_TOP, tz + td + 0.4],
        [-tw - 0.4, TOWER_TOP, tz + td + 0.4], [-tw - 0.4, TOWER_TOP, tz - td - 0.4],
        [tw + 0.4, TOWER_TOP, tz - td - 0.4],
      ], { project: 0.5, height: 0.85 });
      parts.push(corn.geo);
      ledges.push(corn.extras.lip);
      for (const [px, pz] of [[tw, td], [tw, -td], [-tw, td], [-tw, -td]]) {
        parts.push(kit.slab(1.7, 1.0, 1.7, 0.16).translate(px, TOWER_TOP + 0.85, tz + pz));
        parts.push(kit.prism({ h: 6.2, rBottom: 0.95, rTop: 0.05, sides: 4, twist: Math.PI / 4 })
          .translate(px, TOWER_TOP + 1.85, tz + pz));
      }
      const sp = kit.spire({
        h: SPIRE_H, r: Math.min(tw, td) - 0.9, stages: 4, sides: 8,
        pinnacles: true, seed: 0x5e17,
      });
      sp.translate(0, SPIRE_BASE, tz);
      parts.push(sp);
      for (const g of parts) shell.push(g);

      /* The finial cross. Bronze, because it is the one thing above
         the roof line that is allowed to catch a warm highlight, and
         because at alpenglow a bronze cross against a navy zenith is
         the frame the whole level is composed toward. */
      const cx = kit.merge([
        kit.prism({ h: 2.9, rBottom: 0.20, rTop: 0.13, sides: 6 }),
        kit.slab(1.5, 0.22, 0.22, 0.05).translate(0, 1.95, 0),
        kit.prism({ h: 0.5, rBottom: 0.34, rTop: 0.16, sides: 6 }).translate(0, 2.9, 0),
      ]);
      cx.translate(0, SPIRE_TOP - 0.35, tz);
      bronzeParts.push(cx);
    }

    /* ================================================================
       11. THE DOORS

       Bronze, and standing open. Two decisions in that.

       Open, because the player walks in and a sealed chapel with a
       sealed door is a box; ajar is also the single cheapest way to
       say somebody is up here. The leaves are swung to leave 1.9 m
       of clear threshold, which is the width the walk solver needs
       with the drift piled on it.

       Bronze rather than timber because there is no timber material
       in this level's library and there should not be one - the
       whole material bible is snow, ice, granite, rime and bronze.
       Bronze doors at 4,000 m are also just what would be there:
       nothing organic survives four centuries of this.
       ================================================================ */
    const doorSwing = [1.15, 0.95];            // radians, west leaf then east
    let doorClear = 0;
    {
      const leafW = DOOR_W / 2 - 0.06;
      const leafH = DOOR_SPRING + 1.35;
      for (const s of [-1, 1]) {
        const swing = s < 0 ? doorSwing[0] : doorSwing[1];
        const parts = [];
        /* BUILT AWAY FROM ITS OWN HINGE, which is the sign the first
           pass got wrong. Both leaves were extruded along +X from
           their hinge, so the east leaf grew OUT of the doorway
           instead of across it - and then swung out over the parvis
           on a rotation that was correct for a leaf pointing the
           other way. It looked plausible in every wide shot and
           closed the threshold to 1.6 m in none of them, because the
           leaf was never in the opening at all.

           The rotation is `-s * swing` so both leaves swing INWARD
           (toward -Z), which is also why the drift is inside: these
           doors open into the room, so the wind packs snow against
           them and it comes in when they are opened. */
        parts.push(kit.slab(leafW, leafH, 0.13, 0.03)
          .translate(-s * leafW / 2, 0, 0));
        // Strap hinges and a boss ring: the ironwork is what makes a
        // flat leaf read as a door rather than as a panel.
        for (const hy of [leafH * 0.18, leafH * 0.55, leafH * 0.86]) {
          parts.push(kit.slab(leafW * 0.82, 0.16, 0.20, 0.03)
            .translate(-s * leafW * 0.44, hy, 0.02));
        }
        parts.push(kit.ringSolid([
          { y: 0, r: 0.34, sides: 9 }, { y: 0.09, r: 0.34, sides: 9 },
        ], { capTop: false, capBottom: false })
          .rotateX(Math.PI / 2)
          .translate(-s * leafW * 0.78, leafH * 0.52, 0.10));
        const g = kit.merge(parts);
        g.rotateY(-s * swing);
        g.translate(s * doorHalf * 0.98, 0.04, ZF - T * 0.5);
        bronzeParts.push(g);
      }
      /* MEASURED, not asserted. The threshold has to stay wide
         enough for the walk solver, and the leaf angles are the only
         thing setting it - so the number that goes into `extras` is
         computed from the same angles the geometry was built from
         rather than typed in beside them. */
      const edge = (i, s) => s * doorHalf * 0.98
        - s * (DOOR_W / 2 - 0.06) * Math.cos(doorSwing[i]);
      doorClear = edge(1, 1) - edge(0, -1);
    }

    /* ================================================================
       12. THE INTERIOR: ONE ROOM

       Rib vault, nine niches, a floor of polished black stone under
       a drift of blown snow that has come in under the doors.

       It is ONE ROOM on purpose. An arcade would have made it a
       basilica, and a basilica at this size is a corridor. What
       makes the space work instead is height: 14.7 m across and
       19.5 m to the crown, which is a proportion you cannot get in a
       building this small without putting the vault up inside the
       roof - which is exactly what the 58-degree pitch leaves room
       for. The steep roof and the tall vault are the same decision.
       ================================================================ */
    {
      /* --- the floor: polished black stone --- */
      const cell = 1.75;
      for (let z = ZBI + cell * 0.5; z < ZFI; z += cell) {
        for (let x = -(AX - T) + cell * 0.5; x < AX - T; x += cell) {
          if (!inRoom(x, z)) continue;
          const h = r.range(0.20, 0.28);
          const s = kit.slab(cell * r.range(0.90, 0.975), h, cell * r.range(0.90, 0.975), 0.04);
          /* Top face 5 cm proud of the pad. Vesper's nave records the
             two failures either side of this: a fixed deep base left
             randomly sized flags 14-26 cm through the player's boots,
             and anything under about 8 cm of relief is discarded by
             the collision footprint filter and becomes an invisible
             trip hazard. */
          /* FLAGS TOP OUT AT +0.34, not +0.05.

             The parvis and the nave are walked at the podium's
             +0.34 - see summit-world's `summitPodium` for why that
             number cannot move - so a floor laid at +0.05 is a floor
             the player hovers 29 cm above. The building's own y = 0
             stays the datum for the walls and the threshold; only
             the paving rises, which is what a plinth course under a
             wall looks like anyway. */
          s.translate(x, 0.05 - h, z);
          floorParts.push(s);
        }
      }

      /* --- the drift that has come in under the doors ---
         Art direction section 3 asks for it by name, and it is the
         detail that says the building is not heated and not sealed
         against this wind. It tapers north from the threshold and it
         is thickest against the leaves. */
      {
        const reach = 9.5;
        const steps = 11;
        for (let k = 0; k < steps; k += 1) {
          const t = k / (steps - 1);
          const z = ZFI - t * reach;
          const w = lerp(DOOR_W + 1.6, 0.9, Math.pow(t, 0.72));
          const h = lerp(0.44, 0.05, Math.pow(t, 0.62)) * r.range(0.85, 1.15);
          if (h < 0.03) continue;
          const s = kit.slab(w, h, (reach / steps) * 1.35, Math.min(0.18, h * 0.4));
          s.translate(r.jit(0.35), 0.05, z);
          driftParts.push(s);
        }
      }

      /* --- wall shafts and crossing piers ---
         The vault has to LAND on something. A rib springing out of a
         blank wall reads as a decal; a clustered shaft running the
         whole 9.5 m from the floor to the springing is what makes
         the ribs structural, and it is the vertical that gives the
         room its rhythm. */
      const bayZ = [ZFI, 18.51, 11.18, 3.84, CZ0 - T];
      const shaft = (x, z) => {
        const c = kit.column({ h: VS, r: 0.44, shafts: 4, shaftR: 0.155 });
        c.translate(x, 0, z);
        inner.push(c);
      };
      for (const z of bayZ) for (const s of [-1, 1]) shaft(s * (IX - 0.45), z);
      for (const z of [CZ1 + T, ZBI]) for (const s of [-1, 1]) shaft(s * (IX - 0.45), z);
      // Crossing piers, on the corners of the crossing square.
      for (const s of [-1, 1]) {
        for (const z of [CZ0 - T, CZ1 + T]) {
          const c = kit.column({ h: VS, r: 0.58, shafts: 5, shaftR: 0.18 });
          c.translate(s * (IX - 0.5), 0, z);
          inner.push(c);
        }
      }

      /* --- the vault ---
         Transverse ribs at every bay division, diagonal ribs across
         every bay, a boss at each crown, and a web between them. The
         web is the actual ceiling: without it the player looks up
         through the ribs into the roof void and the building has no
         inside.

         The arch is `pow(sin, 0.72)` rather than a plain sine. A
         semicircle springs vertically and crowns flat, which is a
         Romanesque barrel; the power pulls the crown to a point and
         the haunches steeper, which is what makes it gothic. */
      const archY = (t) => VS + (VC - VS) * Math.pow(Math.sin(t * Math.PI), 0.72);
      const ribAcross = (z, halfSpan) => {
        const pts = [];
        for (let i = 0; i <= 10; i += 1) {
          const t = i / 10;
          pts.push([lerp(-halfSpan, halfSpan, t), archY(t), z]);
        }
        return kit.tube(pts, 0.30, 5);
      };
      const webAcross = (z, halfSpan, depth) => {
        const top = [];
        const bot = [];
        for (let i = 0; i <= 10; i += 1) {
          const t = i / 10;
          const x = lerp(-halfSpan, halfSpan, t);
          top.push([x, archY(t) + 0.42]);
          bot.push([x, archY(t) + 0.05]);
        }
        const g = kit.ribbonSolid(top, bot, depth);
        g.translate(0, 0, z);
        return g;
      };
      const naveBays = [ZFI, 18.51, 11.18, 3.84, CZ0 - T, CZ1 + T, ZBI];
      for (const z of naveBays) inner.push(ribAcross(z, IX));
      for (let b = 0; b < naveBays.length - 1; b += 1) {
        const z0 = naveBays[b];
        const z1 = naveBays[b + 1];
        inner.push(webAcross((z0 + z1) / 2, IX, Math.abs(z1 - z0)));
        /* Diagonals. Two per bay, crossing at the boss. They are the
           whole difference between a rib vault and a barrel, and
           they are what the eye follows from the shaft capital to
           the crown. */
        for (const s of [-1, 1]) {
          const pts = [];
          for (let i = 0; i <= 8; i += 1) {
            const t = i / 8;
            pts.push([
              lerp(-IX * s, IX * s, t),
              archY(t),
              lerp(z0, z1, t),
            ]);
          }
          inner.push(kit.tube(pts, 0.22, 5));
        }
        // The boss where they cross.
        inner.push(kit.prism({ h: 0.55, rBottom: 0.62, rTop: 0.38, sides: 7 })
          .translate(0, VC - 0.5, (z0 + z1) / 2));
      }
      /* The transept arms are vaulted the other way: their ribs run
         along Z and their barrel sweeps out along X, which is what a
         transept does and what stops the crossing reading as a
         bulge in a corridor. */
      for (const s of [-1, 1]) {
        const half = (CZ1 - CZ0) / -2 - T;
        const mid = (CZ0 + CZ1) / 2;
        for (const x of [IX, AX - T]) {
          const pts = [];
          for (let i = 0; i <= 10; i += 1) {
            const t = i / 10;
            pts.push([s * x, archY(t), mid + lerp(-half, half, t)]);
          }
          inner.push(kit.tube(pts, 0.28, 5));
        }
        /* The arm's barrel, turned to sweep out along X.
           TWO SEPARATE THINGS HAD TO BE GOT RIGHT HERE and the
           first pass got both wrong, which put a black arch
           floating in mid-air outside the west wall - visible from
           the parvis and impossible to explain from inside.

           1. `ribbonSolid` builds in the (x, y) plane, so the arm's
              z coordinates go in as the profile's FIRST component
              and `rotateY` carries them onto z. `rotateY(+PI/2)`
              maps (a, y, b) -> (b, y, -a), so it needs `a = -z`;
              `rotateY(-PI/2)` maps it to (-b, y, a) and needs
              `a = +z`. Feeding both arms `a = +z` put the east
              arm's vault at POSITIVE z, in the nave, outside the
              wall.
           2. `ribbonSolid` does not force-wind its input (unlike
              `extrudeZ`): its faces are decided entirely by the
              direction the point list is traversed. Negating `a`
              reverses that traversal, so the sign fix alone would
              have turned the east arm's vault inside out. The
              arrays are re-sorted ascending, which is the order the
              nave webs are already built in and known good. */
        const top = [];
        const bot = [];
        for (let i = 0; i <= 10; i += 1) {
          const t = i / 10;
          const a = (s > 0 ? -1 : 1) * (mid + lerp(-half, half, t));
          top.push([a, archY(t) + 0.42]);
          bot.push([a, archY(t) + 0.05]);
        }
        if (top[0][0] > top[top.length - 1][0]) { top.reverse(); bot.reverse(); }
        const web = kit.ribbonSolid(top, bot, (AX - T) - IX);
        web.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
        web.translate(s * ((AX - T + IX) / 2), 0, 0);
        inner.push(web);
      }

      /* --- the nine niches' fittings ---
         The recesses themselves are cut by `panelledWall`; what goes
         in them is a corbel, a canopy and a figure. Nine of them,
         which is the number the world is named for. */
      const niches = allOpenings.filter((o) => o.kind === "niche");
      for (const n of niches) {
        const [nx, , nz] = n.centre;
        const dirX = n.axis === "z" ? (nx > 0 ? -1 : 1) : 0;
        const dirZ = n.axis === "x" ? (nz > 0 ? -1 : 1) : 0;
        const px = nx + dirX * 0.30;
        const pz = nz + dirZ * 0.30;
        inner.push(kit.prism({ h: 0.42, rBottom: 0.22, rTop: 0.46, sides: 5 })
          .translate(px, n.sill, pz));
        inner.push(kit.slab(1.2, 0.22, 1.2, 0.06).translate(px, n.apex - 0.5, pz));
        const st = kit.statue(r, {
          h: Math.min(2.6, (n.apex - n.sill) * 0.74),
          style: r.pick(["sword", "book", "censer"]),
          plinth: false, broken: 0, halo: r.chance(0.34),
        });
        /* Turned to face into the room. `rotateY` on the merged
           statue rather than a mirrored copy, for the same winding
           reason the buttresses are rotated. */
        st.rotateY(Math.atan2(dirX, dirZ));
        st.translate(px, n.sill + 0.42, pz);
        inner.push(st);
      }

      /* --- the altar, and the reliquary on it ---
         The chancel end is the only thing the whole interior points
         at, and an empty one makes the room read as a corridor with
         a wall at the end of it. */
      /* ANYTHING THAT STANDS ON THE FLOOR STANDS ON THE FLAGS.

         The flags top out at +0.34 so the player walks the level the
         parvis is walked at - see the note on their translate - and
         the building's y = 0 remains the datum for the WALLS. A
         piece of furniture placed at 0 is therefore a piece of
         furniture buried to the ankles. Wall-mounted things (the
         niche statues, the shafts, the vault) keep the wall datum;
         floor-standing things use this. */
      const FLOOR_Y = 0.05;
      const altarZ = ZBI + 2.6;
      inner.push(kit.slab(4.2, 0.30, 1.9, 0.06).translate(0, FLOOR_Y + 1.12, altarZ));
      inner.push(kit.slab(3.2, 1.12, 1.4, 0.10).translate(0, FLOOR_Y, altarZ));
      for (const s of [-1, 1]) {
        inner.push(kit.prism({ h: 1.12, rBottom: 0.26, rTop: 0.22, sides: 6 })
          .translate(s * 1.75, FLOOR_Y, altarZ));
      }

      /* ================================================================
         THE FURNISHINGS

         The room was built as architecture and left empty, and an
         empty nave reads as a corridor however good its vault is.
         Three things, and all three are things a vigil that has been
         kept for four centuries would actually leave behind.

         The candles are the only WARM light in the room and they are
         not lights: the level is at its twelve-point-light ceiling -
         nine braziers on the parvis and three fumarole vents - so
         every flame in here is unlit emissive geometry in the glass
         slot. They read because everything around them is blue.
         ================================================================ */
      {
        /* --- a warm flame, as flat colour on the unlit slot --- */
        const flame = (h, rad) => {
          const g = kit.prism({ h, rBottom: rad, rTop: rad * 0.55, sides: 5 });
          const n = g.attributes.position.count;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i += 1) {
            const t = g.attributes.position.getY(i) / Math.max(h, 1e-4);
            col[i * 3] = 1.0;
            col[i * 3 + 1] = 0.60 + 0.30 * t;
            col[i * 3 + 2] = 0.22 + 0.34 * t;
          }
          g.setAttribute("color", new THREE.BufferAttribute(col, 3));
          return g;
        };

        /* --- votive stands --- a tray of candles on a bronze stem.
           Two flanking the altar and four down the nave, offset from
           the centre line so they never block the aisle. */
        const votive = (x, z) => {
          bronzeParts.push(kit.merge([
            kit.prism({ h: 0.10, rBottom: 0.42, rTop: 0.36, sides: 7 }),
            kit.prism({ h: 0.92, rBottom: 0.09, rTop: 0.07, sides: 6 }).translate(0, 0.10, 0),
            kit.prism({ h: 0.09, rBottom: 0.52, rTop: 0.56, sides: 7 }).translate(0, 1.02, 0),
          ]).translate(x, FLOOR_Y, z));
          const lit = r.int(5, 9);
          for (let i = 0; i < 9; i += 1) {
            const a = (i / 9) * Math.PI * 2 + r.range(0, 0.4);
            const rr = r.range(0.16, 0.42);
            const cx = x + Math.cos(a) * rr;
            const cz = z + Math.sin(a) * rr;
            const ch = i < lit ? r.range(0.14, 0.34) : r.range(0.03, 0.09);
            glassParts.push(flame(ch, 0.045).translate(cx, FLOOR_Y + 1.11, cz));
          }
        };
        for (const s of [-1, 1]) votive(s * 2.9, altarZ + 2.2);
        for (const z of [6.5, 15.0]) for (const s of [-1, 1]) votive(s * (IX - 1.9), z);

        /* --- benches --- two ranks facing the altar down the nave,
           set back from the shafts so the aisle stays walkable. Plank
           and two cheeks: at this light level a bench is a silhouette
           and a joinery study would be triangles nobody resolves. */
        const bench = (x, z, w) => {
          inner.push(kit.merge([
            kit.slab(w, 0.11, 0.52, 0.03).translate(0, 0.46, 0),
            kit.slab(w, 0.44, 0.10, 0.02).translate(0, 0.50, 0.26),
            kit.slab(0.09, 0.46, 0.46, 0.02).translate(-w * 0.5 + 0.10, 0, 0),
            kit.slab(0.09, 0.46, 0.46, 0.02).translate(w * 0.5 - 0.10, 0, 0),
          ]).translate(x, FLOOR_Y, z));
        };
        /* THE AISLE IS SIZED FROM THE PLAYER, not from the plan.

           Ranked off the shafts at a comfortable-looking spacing the
           benches left 3.1 m between them, which reads generous and
           is not: the capsule is 0.84 m across, it does not walk a
           perfect centre line, and a walk-in test stopped dead on the
           first rank at x = -1.5. 2.2 m of clear each side of the
           centre is the aisle a processional way earns anyway. */
        /* 2.7, and a side aisle behind the ranks as well.

           At 2.2 a walk down the nave worked only in the three lanes
           within 1.2 m of the centre; at 2.5 you were inside a pew.
           A player cannot step over ANYTHING in this engine - a
           knee-high bench is as solid as a wall - so the circulation
           has to be wide enough to be found without aiming, and the
           1.9 m left outside the ranks gives the room a way round
           rather than a single corridor. */
        /* 3.0, AND THAT IS A CELL BOUNDARY, NOT A TASTE.

           collide.js rasters at one metre, so a bench whose inner
           edge is at 2.7 marks the whole cell from x = 2 outward as
           solid - and the player's own 0.42 m radius then stops at
           1.58. Measured: at AISLE_HALF 2.2 only the three lanes
           within 1.2 m of the centre walked; raising it to 2.7
           changed nothing at all, because 2 is still the cell the
           edge falls in. Landing the edge ON the boundary is what
           actually buys the metre: benches from 3.0 leave every cell
           under x = 3 clear and the player free to 2.58.

           JUST OFF the boundary, not on it. At exactly 3.0 the two
           sides come out a metre different: the raster keys on
           `floor`, so a bench running -5.45 to -3.00 marks cells -6
           through floor(-3.00) = -3, which is [-3, -2] - a metre of
           aisle the mirror-image bench on the +x side does not take,
           because floor(3.00) = 3 leaves [2, 3] alone. Measured, the
           free lane was [-1.5, +2.5]. 3.05 puts both inner edges
           inside their own cell and the aisle comes out symmetric.

           An aisle in this level has to be authored against whole
           metres or it is not the width it says it is. */
        const AISLE_HALF = 3.05;
        const benchOuter = IX - 1.9;
        const benchW = Math.max(1.2, benchOuter - AISLE_HALF);
        for (let z = altarZ + 5.0; z < 19.5; z += 1.75) {
          for (const s of [-1, 1]) {
            bench(s * (AISLE_HALF + benchW * 0.5), z, benchW);
          }
        }
      }
      const casket = kit.merge([
        kit.slab(1.5, 0.62, 0.72, 0.08),
        kit.extrudeZ([[-0.78, 0.62], [0, 1.02], [0.78, 0.62]], 0.76).translate(0, 0, 0),
        kit.prism({ h: 0.55, rBottom: 0.09, rTop: 0.05, sides: 5 }).translate(0, 1.02, 0),
      ]);
      casket.translate(0, 1.42, altarZ);
      bronzeParts.push(casket);

      /* A sanctuary lamp on a chain from the crossing boss. The one
         thing hanging in the 19.5 m of air between the floor and the
         vault - the Vault-Cathedral's coronae comment is right that
         a space with nothing in its middle reads as a corridor with
         a high ceiling rather than as a room with height. */
      {
        const lz = (CZ0 + CZ1) / 2;
        const lampY = 7.4;
        bronzeParts.push(kit.tube([[0, VC - 0.6, lz], [0, lampY + 0.9, lz]], 0.055, 4));
        bronzeParts.push(kit.merge([
          kit.ringSolid([
            { y: 0, r: 0.30, sides: 9 }, { y: 0.34, r: 0.52, sides: 9 },
            { y: 0.72, r: 0.44, sides: 9 },
          ], { capTop: false }),
          kit.prism({ h: 0.30, rBottom: 0.10, rTop: 0.16, sides: 6 }).translate(0, 0.72, 0),
        ]).translate(0, lampY, lz));
      }
    }

    /* ================================================================
       13. THE ICE IN THE WINDOWS

       Every lancet is glazed, and the glazing is what carries the
       building at night and at whiteout - the one hour where the
       stone has no key at all. Authored DARK for the reason the rose
       is: this goes into an unlit emissive material and then into a
       linear buffer the bloom pass reads.

       Set at the wall's outer half rather than centred, so from
       inside you see the reveal's full depth around the light.
       ================================================================ */
    {
      for (const op of allOpenings) {
        if (!op.glaze) continue;
        const hw = op.hw - 0.10;
        const c = hw * (1.35 / (op.rise ?? 1.2));
        const R = c + hw;
        const pts = [];
        const steps = 7;
        pts.push([-hw, op.sill + 0.08]);
        for (let k = 0; k <= steps; k += 1) {
          const t = k / steps;
          const y = lerp(op.spring, op.apex - 0.10, t);
          pts.push([-(Math.sqrt(Math.max(0, R * R - (y - op.spring) ** 2)) - c), y]);
        }
        for (let k = steps; k >= 0; k -= 1) {
          const t = k / steps;
          const y = lerp(op.spring, op.apex - 0.10, t);
          pts.push([Math.sqrt(Math.max(0, R * R - (y - op.spring) ** 2)) - c, y]);
        }
        pts.push([hw, op.sill + 0.08]);
        /* A lancet outline is CONVEX (a pointed arch on a flat sill),
           so `extrudeZ`'s fan caps are valid - unlike the buttress
           profiles above. Checked rather than assumed, because a
           filled-in cap on a window is a solid black pane. */
        const g = kit.extrudeZ(pts, 0.10);
        paintGeometry(THREE, g, GLACIER_RAMP,
          (x, y) => clamp01(0.10 + 0.26 * ((y - op.sill) / Math.max(1, op.apex - op.sill))),
          { jitter: 0.18 });
        if (op.axis === "z") {
          g.rotateY(Math.PI / 2);
          g.translate(op.offset + (op.offset > 0 ? 0.30 : -0.30), 0, op.u);
        } else {
          g.translate(op.u, 0, op.offset + (op.offset > 0 ? 0.30 : -0.30));
        }
        /* A mullion down the middle of the wider lancets. A 2.3 m
           light with nothing in it is a slot; the bar is what makes
           it a window, and it is the smallest piece of stone on the
           building. */
        if (op.width > 2.1) {
          const m = mullion({ length: op.spring + 0.9, w: 0.17, d: 0.40, taper: 0.95 });
          m.translate(0, op.sill, 0);
          if (op.axis === "z") {
            /* Turned with its wall. `mullion` is authored thin along
               X and deep along Z - deep INTO the wall - which is the
               front wall's frame. On a flank the light runs along Z,
               so an unturned bar would be a 0.4 m slab across a
               2.3 m window and 0.17 m of depth in a 1.15 m wall. */
            m.rotateY(Math.PI / 2);
            m.translate(op.offset, 0, op.u);
          } else m.translate(op.u, 0, op.offset);
          shell.push(m);
        }
        glassParts.push(g);
      }
    }

    /* ================================================================
       14. THE RIME PASS, THEN FACET, THEN PAINT

       ORDER IS EVERYTHING HERE and it is the order this file's
       header states: build -> merge -> displace -> facet -> paint.
       `rimeFeathers` refuses a non-indexed geometry outright because
       displacing a faceted one tears it into confetti, and `facet`
       copies only the position attribute (structures.js:2030) so a
       colour written before it is silently discarded.

       The interior is merged and faceted SEPARATELY and never sees
       the rime pass. The `mask` would have caught most of it -
       `rimeFeathers` selects by how hard a face points upwind, and
       the inside of the WNW wall points downwind - but the inside of
       the ESE wall points straight into the wind vector and would
       have grown a beard, on the leeward wall, indoors. Two guards
       rather than one: separate geometry AND an exterior-facing mask,
       because this is the failure that is invisible until somebody
       walks in with a torch.
       ================================================================ */
    const windTo = cathOpts.wind
      ? normaliseWind(cathOpts.wind)
      : { x: SUMMIT_WIND.x, z: SUMMIT_WIND.z };
    /* How hard a surface faces into the wind, in 0..1. Declared once
       and used TWICE - by the displacement and by the paint - so the
       feathers and the pale stain cannot land on different faces. */
    const upX = -windTo.x;
    const upZ = -windTo.z;
    const rimeExposure = (nx, ny, nz) => clamp01(nx * upX + nz * upZ + Math.max(0, ny) * 0.18);

    /**
     * Is this face on the OUTSIDE of the building?
     *
     * Declared once and used three times - by the rime displacement,
     * by the rime paint and by the base tone - because the first
     * pass only guarded the displacement. The result was a chapel
     * whose interior walls were unfeathered but PAINTED with rime:
     * pale panels down the inside of the nave, at the exact height
     * the eye lands on walking in, with no possible physical
     * explanation. Two mechanisms sharing one exposure term have to
     * share the mask that gates it as well.
     *
     * The test is `(p - centre) . n > 0`, which is exact for a
     * convex mass and close enough for a cruciform one. The centre
     * is low (y = 2) rather than at the building's own centroid:
     * with the centroid at 7.4 m every UP-facing surface below that
     * height came out classified as interior, which is the plinth's
     * top, every lower buttress set-off and the string courses'
     * weatherings - all of them outdoors, all of them ledges, and
     * all of them the places rime and icicles actually collect.
     *
     * The second clause catches what the dot product still cannot:
     * an up-facing surface standing outside the room's own footprint
     * is outdoors whatever the vector says.
     */
    const OUT_CY = 2.0;
    const OUT_CZ = (CZ0 + ZF) * 0.5;
    const facesOut = (x, y, z, nx, ny, nz) => (
      x * nx + (y - OUT_CY) * ny + (z - OUT_CZ) * nz > 0
      || (ny > 0.45 && !inRoom(x, z))
    );

    const shellGeo = kit.merge(shell);
    rimeFeathers(shellGeo, windTo, {
      amount: 0.26, scale: 1.35, threshold: 0.16, power: 1.8,
      rootBand: 1.1, rootTaper: 1.4, normalMix: 0.46, paint: false,
      mask: (x, y, z, nx, ny, nz) => (facesOut(x, y, z, nx, ny, nz) ? 1 : 0),
    });
    const shellFaceted = kit.facet(shellGeo);

    /* The paint. Two ramps: granite by height and facing, with rime
       blended in over the SAME exposure the feathers used.

       `normalWeight` is carried high, the way the Vault-Cathedral's
       front is (world.js:1902), and for the same reason plus one
       more. Vesper's reason: with the facade nearly edge-on to the
       sun, height alone gives every buttress and every recess the
       same value and the layering disappears. Ours: this level's
       fill was cut to a third to get form back into the mountain, so
       an unlit vertical face has almost nothing on it but its ramp
       value. Facing IS the shading here. */
    {
      const nrm = shellFaceted.attributes.normal;
      const facing = (i) => {
        const nx = nrm.getX(i);
        const ny = nrm.getY(i);
        const nz = nrm.getZ(i);
        return { nx, ny, nz };
      };
      paintGeometry(THREE, shellFaceted, GRANITE_RAMP, (x, y, z, i) => {
        const { nx, ny, nz } = facing(i);
        /* The inner faces of the wall panels are in this same
           geometry - a wall panel is a solid, so its back is the
           room's surface - and they are lit by nothing but a
           doorway. Painting them on the exterior's ramp made the
           inside of a sealed chapel brighter than its own facade. */
        if (!facesOut(x, y, z, nx, ny, nz)) {
          return clamp01(0.26 + 0.30 * clamp01((y - 1) / VC) + 0.13 * clamp01(-ny));
        }
        /* Never below about a third of the ramp. "Stone in shadow is
           still stone - it is lit by the sky" is the note that fixed
           Vesper's cathedral reading as a black hulk, and this level
           reproduced the same defect from the other direction by
           cutting its fill. The floor is where the fix lives. */
        let t = 0.34;
        t += 0.30 * clamp01(y / (RIDGE + 6));          // the wind scours the top pale
        t += 0.26 * clamp01(ny * 0.5 + 0.5) * 0.9;      // sky-facing catches the light
        t += 0.10 * clamp01(nx * 0.94 + nz * 0.34);     // the ESE key
        return clamp01(t);
      }, {
        jitter: 0.13,
        ramp2: RIME_RAMP,
        mix2: (x, y, z, i) => {
          const { nx, ny, nz } = facing(i);
          if (!facesOut(x, y, z, nx, ny, nz)) return 0;
          /* Rime thins with height: the summit's last twenty metres
             are scoured by 31 m/s and hold nothing. The spire is
             nearly bare, which is also what makes it read against
             the sky as a dark plumb line rather than dissolving into
             the snow behind it. */
          const alt = 1 - sstep(EAVES + 6, RIDGE + 16, y) * 0.72;
          return clamp01(Math.pow(rimeExposure(nx, ny, nz), 1.45) * 1.15 * alt);
        },
      });
    }

    const innerGeo = kit.facet(kit.merge(inner));
    {
      const nrm = innerGeo.attributes.normal;
      paintGeometry(THREE, innerGeo, GRANITE_RAMP, (x, y, z, i) => {
        /* Darker and flatter than the outside. Nothing in here is
           weathered, nothing in here takes the key, and the only
           gradient that exists is the one the ice windows throw. The
           vault is lifted a little so the ribs read from the floor -
           an interior painted uniformly dark is a black ceiling and
           the whole vault is wasted. */
        const ny = nrm.getY(i);
        /* Lifted off the ramp floor for the same reason the
           exterior is, one storey down: a sealed chapel at
           alpenglow is genuinely almost black inside, and a room
           the player can walk into that renders as a void is not a
           room. The lift is small - the ice windows and the open
           doors still have to be the brightest things in here -
           and it is a ramp value rather than a light, so it costs
           nothing and cannot break the 12-light ceiling. */
        /* Raised from 0.26/0.32/0.14. The old floor put the mean
           interior albedo at 0.088 - measured - and an ambient term
           has to multiply THAT, so even a generous bounce came back
           at nothing. The room is still the darkest surface in the
           level; it is no longer a black one. */
        return clamp01(0.44 + 0.18 * clamp01((y - 1) / VC) + 0.10 * clamp01(-ny));
      }, { jitter: 0.11 });
    }

    const floorGeo = kit.facet(kit.merge(floorParts));
    /* BLACKICE_RAMP, not granite. Art direction section 3 asks for a
       floor of polished black stone, and the tarn's ramp is exactly
       that colour - dark, cold, slightly blue. It goes in the SAME
       geometry and the same material as the walls: the difference
       between a black floor and pale rimed masonry is carried
       entirely by vertex colour, which is what lets a building with
       four surfaces in it merge into one draw call. */
    /* LOW ON THE RAMP, and the first pass was not.

       BLACKICE_RAMP runs from the tarn's deep water to #c3d6ea - a
       pale ice blue - and the flags span barely 0.3 m of height, so
       a window of [-0.4, 0.4] put them in the middle of it and a
       `normalWeight` of 0.5 pushed every up-facing top the rest of
       the way. The result was a floor of polished PALE stone, which
       is the one thing art direction section 3 does not ask for; it
       photographed as a flat grey plane and read as untextured.

       A tall window and a light normal term keep the flags between
       the deep and the mid stop, and the jitter and noise are what
       give a polished floor its variation. */
    paintByHeight(THREE, floorGeo, BLACKICE_RAMP, {
      min: -0.35, max: 1.25, normalWeight: 0.14, jitter: 0.16, noise: 0.34,
    });

    const driftGeo = driftParts.length ? kit.facet(kit.merge(driftParts)) : null;
    if (driftGeo) {
      paintByHeight(THREE, driftGeo, SNOW_RAMP, {
        min: 0, max: 0.7, normalWeight: 0.55, jitter: 0.12, noise: 0.2,
      });
    }

    /* THE INSIDE IS ITS OWN SLOT NOW, and the note above about four
       surfaces sharing one draw call no longer covers it.

       The shell and the interior want different LIGHT, not different
       paint, and no amount of vertex colour crosses that: the shell
       stands in a 7-degree key and the interior stands in nothing at
       all. See summit-art's `chapelStone` for the measurement - the
       vault photographed at pure black with its albedo already
       lifted, because albedo is a multiplier and there was nothing
       to multiply. One more draw call, and the room exists. */
    const stone = shellFaceted;
    const interior = kit.merge([innerGeo, floorGeo]);
    const glass = glassParts.length ? kit.merge(glassParts) : null;
    const bronze = bronzeParts.length ? kit.merge(bronzeParts) : null;
    if (bronze) {
      /* Painted along the object's own height, not the world's:
         `paintByHeight` on a bronze cross 62 m up and a casket at
         1.4 m in one buffer gives the cross the top of the ramp and
         the casket the very bottom, and the reliquary comes out
         black. The two are painted before the merge for that reason
         - the same lesson Vesper's fallen bell records (world.js:2478),
         where painting a surface of revolution after laying it on its
         side gave it concentric stripes. */
      paintByHeight(THREE, bronze, BELL_RAMP, {
        min: 0, max: SPIRE_TOP, normalWeight: 0.42, jitter: 0.14, noise: 0.18,
      });
    }

    const triCount = (g) => (!g ? 0
      : (g.index ? g.index.count : g.attributes.position.count) / 3);

    return {
      stone,
      interior,
      glass,
      bronze,
      extras: {
        eaves,
        ledges,
        porchAABB: {
          min: [-4.9, 0, ZF - 0.2],
          max: [4.9, 12.9, PORCH_Z + 0.7],
        },
        height: SPIRE_TOP,
        length: L,
        width: W,
        eavesY: EAVES,
        ridgeY: RIDGE,
        doorY: 0,
        door: {
          x: 0, z: ZF, width: DOOR_W, clear: +doorClear.toFixed(2),
          apex: DOOR_APEX, spring: DOOR_SPRING,
        },
        footprint: foot,
        interiorAABB: {
          min: [-(AX - T), 0, ZBI],
          max: [AX - T, VC, ZFI],
        },
        /* HOW THE WORLD SHOULD BIN THESE. Written down rather than
           left to be inferred, because two of the four are not
           obvious and getting either wrong is silent.

           `stone` MUST carry `collisionSolid`. The chapel is the
           only building on this mountain the player walks inside,
           and `collide.js` drops any triangle whose XZ footprint is
           under half a metre as clutter - which is most of a rose's
           tracery, every icicle-scale moulding and a good deal of
           the vault. Without the flag the collider registers a few
           slivers and the player walks through the walls of a
           building that is standing there solid.

           `glass` must NOT: it is unlit emissive, it is 0.1 m
           thick, and a collidable ice pane is a window you cannot
           see out of and cannot walk past. `castShadow` off too -
           an unlit surface casting a shadow is a black disc on the
           floor where the coloured pool should be. */
        bins: {
          stone: { material: "granite", collisionSolid: true },
          glass: { material: "emissive", noCollide: true, castShadow: false },
          bronze: { material: "bronze", collisionSolid: false },
          drift: { material: "powder", noCollide: true },
        },
        /* WHAT THE WORLD SHOULD LIGHT, and why it is a suggestion
           rather than a light.
           `world.lights` is capped at twelve and the parvis's nine
           braziers have spent most of it, so nothing in here may
           create one. These are `world.emitters` entries in the
           shape `buildVfx` already accepts (vfx.js:1174 diverts
           `kind: "shaft"` into `buildShafts`), and they are what
           makes the interior legible: a cold shaft through the
           rose landing on the black floor - the art direction asks
           for that pool by name - and a small flame at the
           sanctuary lamp, which is the one thing that would still
           be burning in a reliquary chapel. Both are optional; the
           building reads without them. */
        emitters: [
          {
            /* GAIN, because these had never actually been seen.
               `buildShafts` was not writing static shafts at all
               (vfx.js), so every number here was authored blind. At
               full gain a 3.7 m cone raked 34 m down the nave is not
               a shaft, it is weather indoors: the first frame that
               ever drew it filled the room with milk and washed the
               chancel out completely. */
            kind: "shaft", x: 0, y: ROSE_Y, z: ZF - 1.4,
            dir: [0, -0.55, -1], length: 27, radius: ROSE_R * 0.78,
            colour: "#9fd4e8", scale: 1, gain: 0.30,
          },
          { kind: "fire", x: 0, y: 7.4, z: (CZ0 + CZ1) / 2, scale: 0.34 },
          /* --- ONE SHAFT PER LANCET --------------------------------

             The rose has thrown a shaft down the nave since the
             building was first built and it is the only light in
             here that behaves like light. The flank lancets - six of
             them, three a side - were glazed and lit from outside and
             threw nothing, so the room had one beam in it and eight
             bright holes.

             Taken off `allOpenings` rather than re-derived, so a
             window that moves takes its shaft with it, and started a
             hand inside the inner face: begun at the wall's own
             centre line the cone spends its first metre inside 1.15 m
             of masonry, and additive geometry behind an opaque wall
             is not dimmer, it is absent.

             Cold, and colder than the rose. These are plain ice in a
             north and south flank; the rose is the one piece of
             coloured glazing in the building and it should stay the
             warmest thing on that wall. */
          ...allOpenings
            .filter((op) => op.glaze && op.axis === "z" && op.u > CZ0)
            .map((op) => {
              /* `inward` is not a field on an opening - `panelledWall`
                 records axis, offset and centre and nothing else - so
                 it is derived from which side of the nave the wall is
                 on. Reading a field that is not there costs nothing
                 at build time and produces a NaN position, and a NaN
                 in a merged additive buffer takes the whole shaft
                 mesh with it. */
              const inward = op.offset > 0 ? -1 : 1;
              const inset = T * 0.5 + 0.15;
              return {
                kind: "shaft",
                x: op.offset + inward * inset,
                y: (op.sill + op.spring) * 0.5 + 0.6,
                z: op.u,
                dir: [inward, -0.62, 0],
                length: 16.5,
                radius: (op.hw ?? 1.15) * 0.85,
                colour: "#bcd8ea",
                scale: 1,
                /* Six of these overlap down the nave and they add,
                   so each one has to be a good deal fainter than it
                   would be on its own. */
                gain: 0.34,
              };
            }),
        ],
        /* The drift is its own geometry rather than being folded into
           `stone`, because it is SNOW and the world has a `powder`
           material for that. A caller with nowhere to put it can add
           it to the stone bin and lose nothing but the sparkle - it
           is painted from SNOW_RAMP either way. */
        drift: driftGeo,
        tris: {
          stone: triCount(stone),
          glass: triCount(glass),
          bronze: triCount(bronze),
          drift: triCount(driftGeo),
          total: triCount(stone) + triCount(glass) + triCount(bronze) + triCount(driftGeo),
        },
      },
    };
  }

  /* Assigned to the module-level fallback below rather than just
     returned, so the bare `cathedral(rng, opts)` export has a kit to
     reach. See the block after this function. */
  const summitKit = {
    ...kit,
    /* ice */
    serac, crevasseLip, icicleFringe, columnarIce, pressureRidge,
    /* snow */
    rimeFeathers, snowCap,
    /* built */
    bellFrame, votiveMarker, parapet, cairn, prayerFlagRun,
    /* gothic detail - see the CATHEDRAL block */
    stringCourse, setOffButtress, mullion, cuspedLight, tracery,
    panelledWall, flatAnnulus, flatDisc,
    /* the summit building */
    cathedral,
    /* shared */
    polyRadiusFactor, sweepProfile, radialFootprint, resample,
    wind, upwind, windVector,
    SNOW_HOLD_COS,
  };
  lastSummitKit = summitKit;
  return summitKit;
}

/* ============================================================
   THE CATHEDRAL, AT MODULE SCOPE

   `cathedral` needs a `THREE` and therefore lives inside
   `makeSummitKit`, where every other builder in this file lives.
   The world module already holds a kit, so `kit.cathedral(rng, opts)`
   is the supported call and the one with no hidden state in it.

   This shim exists because the contract the world was written
   against is a bare `cathedral(rng, opts)`. It resolves a kit three
   ways, in order: an explicit `opts.kit`, an explicit `opts.THREE`,
   or the most recently constructed kit. The last of those is
   module-level mutable state and it is the kind of thing this
   codebase is right to be suspicious of - so it is the LAST resort
   rather than the mechanism, and the reason it is here at all is
   that the alternative failure is a throw inside `buildSummitWorld`,
   which is a level that does not boot. A surprising wind vector is a
   recoverable mistake; a dead level is not.

   In practice there is exactly one kit per world build, so the
   fallback and the explicit path agree.
   ============================================================ */

let lastSummitKit = null;

export function cathedral(rng, opts = {}) {
  const kit = opts.kit
    || (opts.THREE ? makeSummitKit(opts.THREE, opts) : lastSummitKit);
  if (!kit || !kit.cathedral) {
    throw new Error(
      "[summit-structures] cathedral(): no kit available. Pass opts.kit "
      + "(from makeSummitKit) or opts.THREE, or call makeSummitKit first."
    );
  }
  return kit.cathedral(rng, opts);
}
