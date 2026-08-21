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
      expo[i] = e * root;
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
        const tail = amb * lerp(1.1, 4.2, lee);
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

  return {
    ...kit,
    /* ice */
    serac, crevasseLip, icicleFringe, columnarIce, pressureRidge,
    /* snow */
    rimeFeathers, snowCap,
    /* built */
    bellFrame, votiveMarker, parapet, cairn, prayerFlagRun,
    /* shared */
    polyRadiusFactor, sweepProfile, radialFootprint, resample,
    wind, upwind, windVector,
    SNOW_HOLD_COS,
  };
}
