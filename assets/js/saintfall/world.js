/* ============================================================
   SAINTFALL - the level

   Operation THE GILDED SILENCE, Vesper-IX. Eleven districts on a
   2048m basin, assembled here.

   The composition, because a big map with nothing to look at is
   just a long walk:

     - ONE dominant landmark. The Saint's head sits at the centre
       of the basin and is visible from every district. Wherever
       the player is lost, it tells them where the middle is.
     - ONE spine. The Pilgrim's Road runs south to north through
       the whole map, past the Saint, up to the Cathedral steps. It
       gives the map a direction and a reading order.
     - ONE horizon anchor. The broken halo arcs overhead from
       everywhere (built in sky.js).
     - NINE destinations, each with a different silhouette, a
       different ground colour, a different sound, and one thing in
       it that exists nowhere else on the map.

   Districts are laid out so that no two neighbours share a
   silhouette family: vertical needles sit next to a flat pan, an
   organic hive next to hard gothic masonry, an industrial lattice
   next to an empty dune sea. That contrast is what makes a large
   map feel varied rather than merely large.

   Everything here is merged per district per material, so a
   district is a handful of draw calls that frustum-cull as a unit.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, smoothstep, sstep, makeRng, hexToRgb, mixRgb,
} from "saintfall/core.js";
import {
  PALETTE, ROCK_RAMP, BASALT_RAMP, BONE_RAMP, BRONZE_RAMP, GLASS_RAMP,
  CHITIN_RAMP, SAND_RAMP, ASH_RAMP,
  paintByHeight, paintFlat, paintGeometry, srgbTransfer as srgb,
} from "saintfall/art.js";
import { makeKit, mergeGeometries, cleanGeometry } from "saintfall/structures.js";
import {
  DISTRICTS, ROAD_PATH, FOSSE_PATH, MAP_HALF, DROP_SITE,
} from "saintfall/terrain.js";
import { makeRamp } from "saintfall/core.js";

/* ============================================================
   BATCHER
   ============================================================ */

function makeBatcher(ctx, root) {
  const { THREE, materials } = ctx;
  const bins = new Map();
  return {
    /** Queue a painted geometry into (district, material). */
    add(district, matName, geo, opts = {}) {
      if (!geo) return;
      const key = `${district}|${matName}|${opts.tag || ""}`;
      let bin = bins.get(key);
      if (!bin) {
        bin = { district, matName, geos: [], opts };
        bins.set(key, bin);
      }
      bin.geos.push(geo);
    },
    flush() {
      const out = [];
      for (const bin of bins.values()) {
        const mat = materials[bin.matName] || materials.stone;
        const merged = mergeGeometries(THREE, bin.geos);
        if (!merged.attributes.position || merged.attributes.position.count === 0) continue;
        /* One clean pass per merged mesh. Zero-area triangles come
           out of every primitive that closes to a point, and their
           orphaned vertices carry zero-length normals that normalise
           to NaN. Doing it here rather than in a dozen builders means
           it cannot be forgotten by the next one. */
        const geo = cleanGeometry(THREE, merged);
        if (geo !== merged) merged.dispose?.();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = bin.opts.tag
          ? `${bin.district}-${bin.opts.tag}-${bin.matName}`
          : `${bin.district}-${bin.matName}`;
        mesh.castShadow = bin.opts.castShadow !== false;
        mesh.receiveShadow = bin.opts.receiveShadow !== false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.district = bin.district;
        root.add(mesh);
        out.push(mesh);
        for (const g of bin.geos) if (g !== geo) g.dispose?.();
      }
      bins.clear();
      return out;
    },
  };
}

/* ============================================================
   BUILD
   ============================================================ */

export async function buildWorld(ctx, onProgress) {
  const { THREE, scene, terrain } = ctx;
  const kit = makeKit(THREE);
  const field = terrain.field;
  const H = (x, z) => field.heightAt(x, z);

  const root = new THREE.Group();
  root.name = "world";
  scene.add(root);
  const batch = makeBatcher(ctx, root);

  const pois = [];
  const lights = [];
  const emitters = [];      // handed to vfx: fires, spores, steam
  const banners = [];       // geometry with a `wave` attribute, animated in vfx
  /* Exact authored walking surfaces that sit above the height field.
     Terrain alone cannot answer where the player's soles belong on a
     raised causeway: the Pilgrim's Road is deliberately drawn 22cm
     above the sand so its paving does not z-fight or disappear into
     the interpolated terrain mesh. Collision and foot IK consume this
     function after the world is complete. */
  let walkSurfaceAt = () => -Infinity;

  const paintH = (geo, ramp, opts) => paintByHeight(THREE, geo, ramp, opts);
  const flat = (geo, hex, jit = 0.08) => paintFlat(THREE, geo, hex, jit);

  const place = (geo, x, z, opts = {}) => {
    const y = opts.y !== undefined ? opts.y : H(x, z) + (opts.dy || 0);
    return kit.transform(geo, {
      pos: [x, y, z],
      rot: opts.rot,
      scale: opts.scale,
    });
  };

  /** Align a small, flat-footed prop to the local terrain plane.
   *  Centre-only placement leaves the downhill half of tents,
   *  slabs and plinths hovering on even a modest slope. */
  const placeOnTerrain = (geo, x, z, opts = {}) => {
    const sample = Math.max(0.5, opts.sample || 2);
    let sx = (H(x + sample, z) - H(x - sample, z)) / (sample * 2);
    let sz = (H(x, z + sample) - H(x, z - sample)) / (sample * 2);
    const maxSlope = Math.tan(opts.maxTilt === undefined ? 0.55 : opts.maxTilt);
    const slope = Math.hypot(sx, sz);
    if (slope > maxSlope) {
      const k = maxSlope / slope;
      sx *= k;
      sz *= k;
    }
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3(-sx, 1, -sz).normalize();
    const slopeQ = new THREE.Quaternion().setFromUnitVectors(up, normal);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(up, opts.yaw || 0);
    const q = slopeQ.multiply(yawQ);
    const scale = opts.scale === undefined
      ? new THREE.Vector3(1, 1, 1)
      : (typeof opts.scale === "number"
        ? new THREE.Vector3(opts.scale, opts.scale, opts.scale)
        : new THREE.Vector3(...opts.scale));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, H(x, z) + (opts.dy || 0), z), q, scale
    );
    geo.applyMatrix4(m);
    return geo;
  };

  /** Rest arbitrary rotated debris against its whole lower surface.
   *  The `maxGap` clamp deliberately favours a little burial over a
   *  metre-scale exposed underside on rough ground. */
  const restOnTerrain = (geo, x, z, opts = {}) => {
    kit.transform(geo, { rot: opts.rot, scale: opts.scale });
    geo.computeBoundingBox();
    const p = geo.attributes.position;
    const box = geo.boundingBox;
    const lowBand = box.min.y + Math.max(0.12, (box.max.y - box.min.y) * 0.18);
    const supports = [];
    for (let i = 0; i < p.count; i += 1) {
      // Only the actual lower envelope can support an object. A
      // downward-facing surface may be an elevated soffit or the
      // inside of a hollow bell; treating it as a foot can bury the
      // entire object by its own height.
      if (p.getY(i) <= lowBand) {
        supports.push(H(x + p.getX(i), z + p.getZ(i)) - p.getY(i));
      }
    }
    if (!supports.length) supports.push(H(x, z) - box.min.y);
    supports.sort((a, b) => a - b);
    const qi = Math.floor((supports.length - 1) * (opts.quantile === undefined ? 0.35 : opts.quantile));
    let y = supports[qi];
    const maxGap = opts.maxGap === undefined ? 0.10 : opts.maxGap;
    y = Math.min(y, supports[0] + maxGap);
    y -= opts.embed || 0;
    geo.translate(x, y, z);
    geo.userData.restY = y;
    return geo;
  };

  const step = async (label, frac) => {
    if (onProgress) onProgress(frac, label);
    await new Promise((r) => setTimeout(r, 0));
  };

  /* ============================================================
     THE RIM
     Distant scenery beyond the playable square. Without it the
     map's edge is a cliff with sky behind it, and the whole
     illusion of a continent collapses at the first horizon.
     ============================================================ */

  await step("Raising the basin wall", 0.02);
  {
    const rng = makeRng(0x2101);
    const geos = [];

    /* Three belts of MASSIFS, not of individual peaks. The first
       version scattered isolated cones around the horizon and read
       as a row of tents: a real range is a connected ridge line
       whose silhouette rises and falls, with subsidiary peaks
       overlapping in front of it.

       So each entry here is a ridge SEGMENT - a run of heavily
       overlapping crags along a meandering line - and the belt is
       a chain of segments around the compass. Overlap is the whole
       point; anything that reads as a separate object is a
       failure. */
    const belts = [
      { r0: 1090, r1: 1420, ridges: 26, h: [90, 250], w: [110, 260], shade: 0.00 },
      { r0: 1650, r1: 2600, ridges: 22, h: [220, 520], w: [260, 620], shade: -0.16 },
      { r0: 3100, r1: 4700, ridges: 16, h: [380, 860], w: [420, 1050], shade: -0.34 },
    ];

    for (const belt of belts) {
      for (let s = 0; s < belt.ridges; s += 1) {
        const a0 = (s / belt.ridges) * TAU + rng.jit(0.06);
        const span = (TAU / belt.ridges) * rng.range(1.05, 1.7);
        const peaks = rng.int(4, 8);
        const baseR = rng.range(belt.r0, belt.r1);
        // The ridge's own height envelope: one dominant summit with
        // the flanks falling away, so the segment has a direction.
        const summit = rng.range(0.3, 0.7);
        for (let p = 0; p < peaks; p += 1) {
          const t = p / (peaks - 1 || 1);
          const a = a0 + (t - 0.5) * span;
          const rr = baseR + Math.sin(t * Math.PI * 1.7 + s) * (belt.r1 - belt.r0) * 0.22;
          const x = Math.cos(a) * rr;
          const z = Math.sin(a) * rr;
          const fall = Math.pow(1 - Math.abs(t - summit) / 0.85, 1.4);
          const w = rng.range(belt.w[0], belt.w[1]) * lerp(0.55, 1.0, clamp01(fall));
          const h = rng.range(belt.h[0], belt.h[1]) * lerp(0.34, 1.0, clamp01(fall));
          // Most of the range is CLIFF, not cone. Two thirds get a
          // near-vertical profile with bench strata, and half of
          // those are then cut flat into mesas.
          const isCliff = rng.chance(0.66);
          const g = kit.crag(rng, {
            height: h, radius: w * 0.5, layers: 7,
            sides: rng.int(5, 9), lean: rng.range(0.05, 0.30), sink: 0.42,
            spike: isCliff ? 0 : rng.range(0.1, 0.6),
            cliff: isCliff ? rng.range(0.55, 0.95) : 0,
            // Benches off. Even capped, a stratum that swells near
            // the summit of an almost-vertical profile produces an
            // overhanging cap, and a horizon of mushroom-topped
            // rocks reads as a generation bug. The cliff profile
            // and the mesa cut carry the horizontals on their own.
            benches: 0,
          });
          if (isCliff && rng.chance(0.55)) {
            const pos = g.attributes.position;
            const cut = h * rng.range(0.46, 0.80);
            // Do not clamp every upper ring to the exact same plane:
            // that turns all stitches between them into overlapping
            // horizontal annuli which read as floating shelves from
            // across the basin. Compress the summit instead, keeping
            // every ring connected and vertically ordered.
            for (let v = 0; v < pos.count; v += 1) {
              const py = pos.getY(v);
              if (py > cut) pos.setY(v, cut + (py - cut) * 0.14);
            }
            pos.needsUpdate = true;
            g.computeVertexNormals();
          }
          const baseY = rr < 1600
            ? H(clamp(x, -MAP_HALF, MAP_HALF), clamp(z, -MAP_HALF, MAP_HALF))
            : -40;
          kit.transform(g, { pos: [x, baseY - h * 0.22, z], rot: [0, rng() * TAU, 0] });
          paintH(g, ROCK_RAMP, {
            normalWeight: 0.42, noise: 0.2, jitter: 0.12, bias: belt.shade,
          });
          geos.push(g);
        }
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(THREE, geos), ctx.materials.rock);
    mesh.name = "rim";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  }

  /* ============================================================
     THE PILGRIM'S ROAD
     The map's reading order. Flagstones, milestones, and a row of
     Concord saints that gets progressively more broken the further
     from the Cathedral you walk - a gradient the player reads
     without being told.
     ============================================================ */

  await step("Laying the Pilgrim's Road", 0.08);
  {
    const rng = makeRng(0x0472);
    /* Paving draws from its OWN stream. Sharing `rng` with the saints
       meant every tweak to the flagstones - one more stone per row,
       one more jitter call - shifted every draw downstream of it, and
       a milestone two hundred metres away quietly fell over. The
       layout stays seeded and reproducible either way, but only if
       the two are decoupled does editing the road leave the rest of
       the road's furniture where the beauty shots were framed on it. */
    const prng = makeRng(0x51ab);
    const furnitureProf = field.roadProfile;
    /* Surface quads are capped at 2m along the route. The terrain the
       player sees is a 4m triangle grid; spanning two of those cells
       with one 7-8m road quad averaged across sharp Fosse/Cathedral
       transitions and left opposite edges up to two metres above or
       below the visible ground. Furniture keeps the authored profile
       so its seeded density and locations do not change. */
    const prof = [];
    const segmentSource = [];
    for (let sourceI = 0; sourceI < furnitureProf.length - 1; sourceI += 1) {
      const a = furnitureProf[sourceI];
      const b = furnitureProf[sourceI + 1];
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      if (!prof.length) prof.push({ x: a.x, z: a.z });
      for (let k = 0; k < count; k += 1) {
        const u = (k + 1) / count;
        segmentSource.push(sourceI);
        prof.push({ x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u) });
      }
    }
    const stones = [];
    const kerbs = [];
    const beds = [];
    const walkBuckets = new Map();
    const WALK_BUCKET = 8;

    /** Index the exact top triangles shipped for a road quad. */
    const indexWalkQuad = (c) => {
      const minX = Math.min(c[0][0], c[1][0], c[2][0], c[3][0]);
      const maxX = Math.max(c[0][0], c[1][0], c[2][0], c[3][0]);
      const minZ = Math.min(c[0][2], c[1][2], c[2][2], c[3][2]);
      const maxZ = Math.max(c[0][2], c[1][2], c[2][2], c[3][2]);
      for (let gx = Math.floor(minX / WALK_BUCKET); gx <= Math.floor(maxX / WALK_BUCKET); gx += 1) {
        for (let gz = Math.floor(minZ / WALK_BUCKET); gz <= Math.floor(maxZ / WALK_BUCKET); gz += 1) {
          const key = `${gx},${gz}`;
          let list = walkBuckets.get(key);
          if (!list) { list = []; walkBuckets.set(key, list); }
          list.push(c);
        }
      }
    };

    /* --- the causeway ----------------------------------------------
       The road is a continuous SURFACE built from quads whose corners
       are shared with their neighbours, not a run of axis-aligned
       boxes. Three failures pushed it here, and each one was only
       visible by measuring pixels rather than by looking:

       1. Flagstones placed a fixed height above heightAt(x,z) sank.
          heightAt is not the surface the renderer draws - the terrain
          mesh samples it at vertices and interpolates between - and
          the drawn ground ran up to 0.12m above the analytic height.
          Against 0.13m of proudness that is a coin toss. A
          differential mask showed roughly half the near-field rows
          contributing NOTHING: the gaps were not dark paving, they
          were bare sand, which is why they read as sand.

       2. Boxes cannot follow a gradient. One flat box per 4m segment
          on a sloping road is a staircase, and each riser threw its
          own shadow.

       3. A bed wide enough to carry the kerbs but wider than the
          paving exposed two metres of the darkest material on the
          road down each flank, and the causeway read as a trench.

       Quads fix all three at once. Every stone's four corners sit on
       one shared bed surface, so stones cannot step against each
       other or against the ground, proudness is exact everywhere, and
       the only shadow left is the one the causeway's own edge casts -
       which is the shadow a raised road is supposed to have.

       Cross-road ground spread measured 0.003m, so the bed follows
       the centreline height alone. */
    const HALF_W = 4.6;
    const ROAD_CLEARANCE = 0.04;
    const sourceBuried = new Float32Array(Math.max(0, furnitureProf.length - 1));
    const perp = [];
    for (let i = 0; i < prof.length; i += 1) {
      const a = prof[i];
      const nb = prof[Math.min(prof.length - 1, i + 1)];
      const pv = prof[Math.max(0, i - 1)];
      const yaw = Math.atan2(nb.z - pv.z, nb.x - pv.x);
      perp.push([Math.sin(yaw), -Math.cos(yaw)]);
    }
    for (let i = 0; i < sourceBuried.length; i += 1) {
      const a = furnitureProf[i];
      sourceBuried[i] = smoothstep(clamp01(
        Math.abs(field.noise.broad.fbm(a.x / 90, a.z / 90, 3)) * 3.4 - 0.35
      ));
    }

    /** A solid from four top corners [x,y,z], skirted straight down. */
    const quadSolid = (c, drop) => {
      indexWalkQuad(c);
      const pos = [];
      const idx = [];
      for (const q of c) pos.push(q[0], q[1], q[2]);
      for (const q of c) pos.push(q[0], q[1] - drop, q[2]);
      idx.push(0, 2, 1, 0, 3, 2);                 // top
      idx.push(4, 5, 6, 4, 6, 7);                 // bottom
      for (let k = 0; k < 4; k += 1) {
        const n = (k + 1) % 4;
        idx.push(k, n, n + 4, k, n + 4, k + 4);   // skirt
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    /** Point on the bed surface at profile index i, lateral offset o. */
    const bedPt = (i, o, lift) => [
      prof[i].x + perp[i][0] * o,
      (terrain.groundHeightAt
        ? terrain.groundHeightAt(
          prof[i].x + perp[i][0] * o,
          prof[i].z + perp[i][1] * o
        )
        : H(prof[i].x + perp[i][0] * o, prof[i].z + perp[i][1] * o))
        + ROAD_CLEARANCE + lift,
      prof[i].z + perp[i][1] * o,
    ];

    for (let i = 0; i < prof.length - 1; i += 1) {
      const sourceI = segmentSource[i];
      if (sourceI < 2 || sourceI >= furnitureProf.length - 3) continue;
      const a = prof[i];
      const b = prof[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.2) continue;

      /* Sand reclaims the road in patches. The gaps are where the
         road stops being a corridor and starts being a ruin.

         Thresholds are loose. At `> 0.62` plus a 45% per-stone cull
         the drift was not making patches, it was making lace, and the
         causeway dissolved exactly where the player stands to look
         down it. Burial has to interrupt the road, not perforate it. */
      const buried = sourceBuried[sourceI];
      if (buried > 0.86) continue;

      // The bed. Skirted deep so its underside stays buried.
      beds.push({
        g: quadSolid([
          bedPt(i, -HALF_W - 0.9, 0), bedPt(i, HALF_W + 0.9, 0),
          bedPt(i + 1, HALF_W + 0.9, 0), bedPt(i + 1, -HALF_W - 0.9, 0),
        ], 2.4),
        t: 0.05 + prng.range(0, 0.12),
      });

      /* Five flagstones across, each inset 7cm from its cell so the
         joints are hairlines and the paving reads as one surface. */
      const rowStones = 5;
      const cell = (HALF_W * 2) / rowStones;
      for (let s = 0; s < rowStones; s += 1) {
        if (prng.chance(buried * 0.22)) continue;
        const lo = -HALF_W + s * cell + 0.07;
        const hi = -HALF_W + (s + 1) * cell - 0.07;
        // Proud of the bed by a few centimetres only. Shadow length
        // is height / tan(sun elevation), and 13.5 degrees turns
        // every centimetre into four: 6cm gives a 25cm joint shadow.
        // The 40cm slabs this started from threw 1.7m each and the
        // causeway read as a stack of planks.
        const lift = 0.06 - prng.range(0, 0.015);
        stones.push({
          g: quadSolid([
            bedPt(i, lo, lift), bedPt(i, hi, lift),
            bedPt(i + 1, hi, lift), bedPt(i + 1, lo, lift),
          ], 0.5),
          t: Math.pow(prng.range(0.06, 1), 1.15),
          dust: clamp01(buried * 1.5 + prng.range(-0.12, 0.12)),
        });
      }
      // Kerbs, standing proud of the paving along both flanks.
      if (sourceI % 2 === 0) {
        for (const sgn of [-1, 1]) {
          const lo = sgn * (HALF_W + 0.16);
          const hi = sgn * (HALF_W + 0.82);
          /* quadSolid expects the lateral corners in increasing
             order. Multiplying both endpoints by -1 reversed only
             the west kerb, culling its top while collision still
             treated the missing surface as a 34cm step. */
          const inner = Math.min(lo, hi);
          const outer = Math.max(lo, hi);
          kerbs.push({
            g: quadSolid([
              bedPt(i, inner, 0.34), bedPt(i, outer, 0.34),
              bedPt(i + 1, outer, 0.34), bedPt(i + 1, inner, 0.34),
            ], 0.95),
            t: Math.pow(prng.range(0.1, 1), 1.5),
          });
        }
      }
    }

    /* The visual road and the walking surface now share the same
       profile instead of asking two different systems what "ground"
       means. `roadIndex` gives the nearest authored segment; its
       normalized t maps directly back onto the smoothed `bedY`
       samples used by every quad above. Missing/reclaimed segments
       deliberately fall through to terrain.

       Paving is at most 6cm proud of the bed, so the centre surface
       follows that upper plane. Kerbs get their own 34cm step. Both
       are below the player's normal step height, but neither should
       visibly pass through the feet while being crossed. */
    walkSurfaceAt = (x, z) => {
      const list = walkBuckets.get(`${Math.floor(x / WALK_BUCKET)},${Math.floor(z / WALK_BUCKET)}`);
      if (!list) return -Infinity;
      let best = -Infinity;
      /* quadSolid's top is triangulated 0-2-1 and 0-3-2. Evaluate
         those same planes, so grounding cannot drift from the mesh at
         bends, reclaimed boundaries, or sharp terrain transitions. */
      const triY = (a, b, c) => {
        const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(det) < 1e-9) return -Infinity;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
        const wc = 1 - wa - wb;
        if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) return -Infinity;
        return wa * a[1] + wb * b[1] + wc * c[1];
      };
      for (const c of list) {
        best = Math.max(best, triY(c[0], c[2], c[1]), triY(c[0], c[3], c[2]));
      }
      return best;
    };

    // Darker than the sand it crosses. A pale flagstone with an
    // up-facing normal under a 4.75 sun clips to white, and 28k
    // vertices of it turned the causeway into a strip of lit paper
    // - the opposite failure to the buried version, and just as
    // illegible. Paving reads because it is DARKER than the drift
    // beside it.
    /* Paving is painted FLAT, one tone per stone, sampled along the
       ramp - not by height.

       paintByHeight defaults its range to the geometry's own bounding
       box, which for a 25cm flagstone maps the whole ramp across the
       slab's thickness: the underside gets the dark end, the top face
       gets the light end, and normalWeight then pushes up-facing
       quads further that way still. So the top of every stone landed
       on the ramp's lightest colour no matter what the ramp said, the
       tops matched the drift, and the road survived only as its joint
       lines. Darkening the ramp could not fix that - the top face was
       pinned to whatever the last stop happened to be.

       Height is simply the wrong axis for a flat stone. The variation
       that makes paving read is between stones, not within one, so
       each gets a single tone and the ramp finally means something.
       Skewed dark (t^1.7) because sand is bright and only the dark
       half of the ramp separates from it under a 4.75 sun. */
    const PAVING = makeRamp([[0, "#6d5c50"], [0.55, "#8e7663"], [1, "#b3957a"]]);
    /* Stones under drifting sand take the drift's colour. `buried`
       already decides where the road survives; reusing it as a dust
       weight means the paving fades INTO the dune it is losing to
       rather than stopping at a hard edge, and it costs one mix. */
    const DUST = hexToRgb("#c09468");
    for (const { g, t, dust } of stones) {
      flat(g, mixRgb(PAVING.at(t), DUST, dust * 0.75), 0.2);
      batch.add("road", "stone", g, { tag: "surface" });
    }
    for (const { g, t } of kerbs) {
      flat(g, PAVING.at(0.35 + t * 0.5), 0.1);
      batch.add("road", "stone", g, { tag: "surface" });
    }
    // The bed is the darkest thing on the road, so the joints between
    // flagstones read as gaps down into it rather than as scratches.
    for (const { g, t } of beds) {
      flat(g, PAVING.at(t), 0.08);
      batch.add("road", "stone", g, { tag: "surface" });
    }

    /* --- the saints of the road --- */
    const STYLES = ["sword", "book", "censer", "banner"];
    for (let i = 6; i < furnitureProf.length - 6; i += 7) {
      const a = furnitureProf[i];
      const nxt = furnitureProf[i + 1];
      const yaw = Math.atan2(nxt.z - a.z, nxt.x - a.x);
      for (const side of [-1, 1]) {
        if (rng.chance(0.28)) continue;
        const off = 17.5 + rng.range(0, 2);
        const x = a.x - Math.sin(-yaw) * side * off;
        const z = a.z - Math.cos(-yaw) * side * off;
        // Ruin gradient: intact near the Cathedral (north, low i is
        // south), progressively wrecked toward the drop zone.
        const north = 1 - i / furnitureProf.length;
        const broken = clamp01(rng.range(-0.25, 0.55) + (1 - north) * 0.5);
        const h = rng.range(10.5, 13.5);
        const g = kit.statue(rng, {
          h, style: rng.pick(STYLES), plinth: true,
          broken: broken < 0.1 ? 0 : broken,
          halo: rng.chance(0.3),
        });
        const toppled = rng.chance(0.22 * (1 - north) + 0.05);
        const propRot = toppled
          ? [rng.range(1.1, 1.6) * rng.sign(), rng() * TAU, rng.jit(0.4)]
          : [rng.jit(0.03), -yaw + Math.PI / 2 * side + rng.jit(0.1), rng.jit(0.03)];
        restOnTerrain(g, x, z, {
          rot: propRot,
          embed: toppled ? 0.45 : 0.12,
          maxGap: 0.08,
        });
        paintH(g, makeRamp([
          [0, "#4a3830"], [0.35, "#7a6150"], [0.7, "#a98a6c"], [1, "#cfb28c"],
        ]), { normalWeight: 0.46, jitter: 0.13, noise: 0.22 });
        batch.add("road", "stone", g);
      }
    }

    /* --- milestones --- */
    for (let i = 10; i < furnitureProf.length - 10; i += 24) {
      const a = furnitureProf[i];
      const g = kit.merge([
        kit.prism({ h: 3.2, rBottom: 0.52, rTop: 0.42, sides: 6 }),
        kit.prism({ h: 0.9, rBottom: 0.46, rTop: 0.06, sides: 6 }).translate(0, 3.2, 0),
      ]);
      place(g, a.x - 13, a.z, { rot: [0, rng() * TAU, 0] });
      paintH(g, makeRamp([[0, "#3e332e"], [1, "#8d7660"]]), { normalWeight: 0.5, jitter: 0.1 });
      batch.add("road", "stone", g);
    }

    pois.push({ id: "road", name: "The Pilgrim's Road", x: -14, z: 168 });
  }

  /* ============================================================
     THE THRESHOLD
     Where the drop lands, and the frame that the whole level is
     first seen through.
     ============================================================ */

  await step("Marking the Threshold", 0.14);
  {
    const d = DISTRICTS.threshold;
    const rng = makeRng(0x7413);
    const padX = DROP_SITE.podX;
    const padZ = DROP_SITE.podZ;
    const padY = H(padX, padZ);

    /* --- the south gate: two pylons framing the road ---
       Squat and heavy, not slender. A first pass built them at 34m
       on a 4m radius and they read as lamp posts with a plank
       across the top; a triumphal pylon is a MASS, and the eye
       reads mass from the base-to-height ratio before it reads any
       carving. Stepped plinth, fluted shaft, corbelled cornice,
       skull boss on the road face, and the springing of a lintel
       that is no longer there. */
    for (const side of [-1, 1]) {
      const gx = 6 + side * 25;
      const gz = d.z - 88;
      const gy = H(gx, gz);
      const hgt = 25;
      const R = 5.6;
      const parts = [];
      // A broad pylon cannot sit on one centre height where the road
      // cuts across a steep shoulder. Carry the footing down into
      // the ground so the low side presents masonry, never the flat
      // underside of a hovering plinth.
      parts.push(kit.slab(R * 3.4, 15, R * 3.4, 0.35).translate(0, -15, 0));
      // Stepped plinth.
      parts.push(kit.slab(R * 3.4, 1.8, R * 3.4, 0.35));
      parts.push(kit.slab(R * 2.9, 1.5, R * 2.9, 0.30).translate(0, 1.8, 0));
      parts.push(kit.slab(R * 2.5, 1.2, R * 2.5, 0.25).translate(0, 3.3, 0));
      // Shaft, with a slight entasis.
      parts.push(kit.prism({
        h: hgt, rBottom: R, rTop: R * 0.86, sides: 8, segments: 3, bulge: 0.03,
      }).translate(0, 4.5, 0));
      // Flutes: eight engaged shafts, which is what makes an
      // octagonal drum read as carved rather than as extruded.
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * TAU + Math.PI / 8;
        parts.push(kit.prism({ h: hgt * 0.94, rBottom: 0.62, rTop: 0.5, sides: 4 })
          .translate(Math.cos(a) * R * 0.94, 4.5, Math.sin(a) * R * 0.94));
      }
      // Corbelled cornice.
      parts.push(kit.prism({ h: 1.5, rBottom: R * 0.92, rTop: R * 1.28, sides: 8 })
        .translate(0, 4.5 + hgt, 0));
      parts.push(kit.slab(R * 2.6, 1.9, R * 2.6, 0.4).translate(0, 6.0 + hgt, 0));
      parts.push(kit.slab(R * 2.15, 1.1, R * 2.15, 0.25).translate(0, 7.9 + hgt, 0));
      // Skull boss on the face that looks down the road.
      const boss = kit.skull({ size: 6.4 });
      boss.rotateY(Math.PI);
      boss.translate(0, hgt * 0.52, -R * 0.86);
      parts.push(boss);
      // The lintel springs from the inner face and is sheared off
      // over the road - the break is the point.
      const stub = kit.slab(13, 3.4, R * 1.9, 0.4);
      stub.rotateZ(-side * 0.10);
      stub.translate(-side * 8.0, 6.0 + hgt, 0);
      parts.push(stub);
      const g = kit.merge(parts);
      kit.transform(g, { pos: [gx, gy - 0.8, gz], rot: [0, 0, 0] });
      paintH(g, makeRamp([
        [0, "#332a2c"], [0.3, "#5b4740"], [0.65, "#8a6f5c"], [1, "#b99a7c"],
      ]), { normalWeight: 0.44, jitter: 0.12, noise: 0.24 });
      batch.add("threshold", "stone", g);

      // Banner hanging from the cornice, on the road face.
      const ban = kit.banner({
        w: 5.0, h: 17, cols: 5, rows: 13, sag: 0.10, taper: 0.12, swallowtail: 0.10,
      });
      // On the SOUTH face - the side the road arrives from and the
      // only side anyone approaching the gate can see.
      ban.translate(gx, gy - 0.8 + hgt + 4.6, gz + R * 1.25);
      banners.push({ geo: ban, colour: PALETTE.oxblood, accent: PALETTE.gold, district: "threshold" });
    }

    /* --- the drop pod --- */
    {
      const parts = [];
      const podH = 6.2;
      parts.push(kit.prism({ h: podH, rBottom: 2.05, rTop: 1.72, sides: 6, segments: 3 }));
      parts.push(kit.prism({ h: 1.1, rBottom: 1.72, rTop: 0.55, sides: 6 }).translate(0, podH, 0));
      parts.push(kit.prism({ h: 0.9, rBottom: 2.25, rTop: 2.1, sides: 6 }).translate(0, -0.5, 0));
      // Ribs.
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        const rib = kit.slab(0.34, podH, 0.62, 0.05);
        rib.rotateY(-a);
        rib.translate(Math.cos(a) * 1.92, 0, Math.sin(a) * 1.92);
        parts.push(rib);
        // Retro fins.
        const fin = kit.slab(0.22, 2.4, 1.5, 0.05);
        fin.rotateY(-a);
        fin.translate(Math.cos(a) * 2.25, -0.2, Math.sin(a) * 2.25);
        parts.push(fin);
      }
      const g = kit.merge(parts);
      kit.transform(g, {
        pos: [padX, padY - 1.5, padZ], rot: [0.05, DROP_SITE.podYaw, 0.04],
      });
      paintH(g, makeRamp([
        [0, "#191a1e"], [0.28, "#2f3239"], [0.62, "#4f545d"], [1, "#7e838c"],
      ]), { normalWeight: 0.5, jitter: 0.16, noise: 0.3 });
      batch.add("threshold", "iron", g);

      // Blown hatch, lying where it fell.
      const hatch = kit.prism({ h: 0.35, rBottom: 1.75, rTop: 1.62, sides: 6 });
      place(hatch, padX + 5.4, padZ + 3.1, { rot: [0.2, 1.1, 0.5] });
      flat(hatch, "#3a3d44", 0.2);
      batch.add("threshold", "iron", hatch);

      emitters.push({ kind: "smoke", x: padX, y: padY + 3.2, z: padZ, scale: 1.5, rate: 0.55 });
      pois.push({ id: "threshold", name: "Landing Zone THRESHOLD", x: padX, z: padZ });
    }

    /* --- the wrecked lander on the ridge --- */
    {
      const parts = [];
      const L = 26;
      parts.push(kit.ringSolid([
        { y: 0, rx: 2.6, rz: 3.0, sides: 7 },
        { y: L * 0.30, rx: 3.7, rz: 4.1, sides: 7, phase: 0.3 },
        { y: L * 0.66, rx: 3.4, rz: 3.8, sides: 7, phase: 0.5 },
        { y: L * 0.88, rx: 2.4, rz: 2.7, sides: 7, phase: 0.7 },
        { y: L, rx: 0.8, rz: 0.9, sides: 7, phase: 0.9 },
      ]));
      // Wings: one snapped off and standing in the sand.
      for (const s of [-1, 1]) {
        const wing = kit.extrudeZ([
          [0, 0], [9.5 * s, 1.4], [11.5 * s, 4.2], [2.4 * s, 4.0], [0, 2.2],
        ], 0.7);
        wing.rotateX(Math.PI / 2);
        wing.rotateZ(s * 0.1);
        wing.translate(0, L * 0.42, 0);
        parts.push(wing);
      }
      const g = kit.merge(parts);
      const wx = padX - 74;
      const wz = padZ - 22;
      kit.transform(g, { pos: [wx, H(wx, wz) - 2.4, wz], rot: [1.28, 0.9, 0.2] });
      paintH(g, makeRamp([
        [0, "#20222a"], [0.35, "#3d424c"], [0.7, "#6c7280"], [1, "#9aa0aa"],
      ]), { normalWeight: 0.5, jitter: 0.16, noise: 0.26 });
      batch.add("threshold", "iron", g);
      emitters.push({ kind: "smoke", x: wx, y: H(wx, wz) + 5, z: wz, scale: 2.4, rate: 0.35 });
    }

    /* --- supply canisters --- */
    for (let i = 0; i < 5; i += 1) {
      const a = rng() * TAU;
      const r = rng.range(20, 90);
      const x = padX + Math.cos(a) * r;
      const z = padZ + Math.sin(a) * r;
      const g = kit.merge([
        kit.prism({ h: 2.4, rBottom: 0.72, rTop: 0.72, sides: 7 }),
        kit.prism({ h: 0.3, rBottom: 0.82, rTop: 0.76, sides: 7 }).translate(0, 2.4, 0),
        kit.prism({ h: 0.3, rBottom: 0.82, rTop: 0.76, sides: 7 }).translate(0, -0.3, 0),
      ]);
      restOnTerrain(g, x, z, {
        rot: [rng.range(1.2, 1.6), rng() * TAU, 0], embed: 0.08, maxGap: 0.04,
      });
      flat(g, rng.chance(0.5) ? "#8a5a1e" : "#3f4a52", 0.22);
      batch.add("threshold", "iron", g);
    }

    /* --- ribbon poles along the ridge --- */
    for (let i = 0; i < 46; i += 1) {
      const x = d.x + rng.gauss() * 200 - 10;
      const z = d.z + rng.gauss() * 70;
      const poleH = rng.range(2.6, 4.4);
      const tiltX = rng.jit(0.06);
      const poleYaw = rng() * TAU;
      const tiltZ = rng.jit(0.06);
      void tiltX; void tiltZ;
      const poleY = H(x, z) - 0.06;
      const g = kit.ribbonPole(rng, { h: poleH });
      kit.transform(g, { pos: [x, poleY, z], rot: [0, poleYaw, 0] });
      flat(g, "#4b3a2c", 0.2);
      batch.add("threshold", "rust", g);

      const ban = kit.banner({
        w: 0.46, h: rng.range(1.6, 2.9), cols: 2, rows: 7, sag: 0.02, amp: 0.28, taper: 0.35,
      });
      ban.translate(-0.31, poleH * 0.86, 0);
      kit.transform(ban, { pos: [x, poleY, z], rot: [0, poleYaw, 0] });
      banners.push({
        geo: ban, district: "threshold",
        colour: rng.pick([PALETTE.oxblood, PALETTE.ivory, PALETTE.indigo, PALETTE.gold]),
        accent: PALETTE.ivory, wind: 1.6,
      });
    }
  }

  /* ============================================================
     THE FALLEN SAINT
     ============================================================ */

  await step("Uncovering the Saint", 0.24);
  {
    const d = DISTRICTS.saint;
    const rng = makeRng(0x5a17ff);

    /* --- the head --- */
    {
      // Sized to be legible from the drop, 950m away, where it has
      // to survive being read through the haze against a bright
      // sky. It also sits in its own 34m impact bowl, so a third of
      // any height given to it is spent climbing out of that: at 82
      // it was a green smudge on the horizon, and the landmark the
      // entire map is composed around has to be the first thing
      // anyone sees.
      const S = 108;
      const g = kit.saintHead({ size: S });
      const hx = d.x + 6;
      const hz = d.z + 18;

      /* Painted in LOCAL space, before the transform, so the face
         can be told apart from the back of the skull. Keyed on
         world position afterwards, every part of a rounded form at
         the same height gets the same value and the head comes out
         as a uniform green pot with no features at all - which is
         exactly what happened.

         Local +Z is the face. The plate is scoured bright bronze;
         the cranium behind it holds its patina; the eye slits go
         to the bottom of the ramp, and that darkness IS the
         expression at this scale. */
      {
        const nrm = g.attributes.normal;
        paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => {
          const up = nrm.getY(i);
          const front = clamp01(z / (S * 0.55));
          const inEye = Math.abs(x) > S * 0.09 && Math.abs(x) < S * 0.26
            && y > S * 0.50 && y < S * 0.74 && z > S * 0.42;
          if (inEye) return 0.02;
          const streak = Math.sin(x * 0.09 + z * 0.07) * 0.5 + 0.5;
          // Rain and dust run DOWN, so patina survives low and
          // gold survives on the upward and forward faces.
          return clamp01(
            0.28 + up * 0.26 + front * 0.30
            + clamp01(y / (S * 1.05)) * 0.12 + streak * 0.09
          );
        }, { jitter: 0.13 });
      }
      /* Tipped back and rolled, part sunk. Reading as fallen rather
         than as installed is entirely about the roll: an upright
         colossal head is a monument, a rolled one is wreckage.

         The yaw is not free. The face plate is built facing local
         +Z, and the player arrives from the south up the road, so
         the yaw has to put the face into the southern half or the
         only view anyone gets on approach is the back of a bronze
         boulder. 0.62rad points it SSE, tipped 32 degrees back as
         if it fell looking at the sky. */
      /* The yaw has to satisfy TWO constraints at once, and only
         one of them is composition.

         It must face the approach - the road comes up the western
         side of the basin, so the face has to be in the southern
         half or every player sees the back of a bronze boulder.
         And it must face the SUN, which sits west-north-west: at
         yaw 0.75 the plate pointed east-south-east, straight into
         its own shadow, and the most detailed surface on the map
         rendered as an unlit slab.

         -0.95rad points the face south-west. dot(face, sun) is
         0.80, so the plate is properly lit, and a camera anywhere
         on the road's western approach is looking at it. */
      kit.transform(g, {
        pos: [hx, H(hx, hz) - S * 0.10, hz],
        rot: [-0.28, -0.95, 0.26],
      });
      batch.add("saint", "bronze", g);
      pois.push({ id: "saint", name: "The Fallen Saint", x: hx, z: hz });

      // Salvage scaffolding abandoned on the brow.
      const scaf = [];
      for (let i = 0; i < 5; i += 1) {
        scaf.push(kit.prism({ h: rng.range(9, 15), rBottom: 0.14, rTop: 0.12, sides: 4 })
          .translate(rng.jit(9), 0, rng.jit(7)));
      }
      for (let i = 0; i < 4; i += 1) {
        scaf.push(kit.slab(18, 0.2, 1.5, 0).translate(0, 3 + i * 3.4, rng.jit(6)));
      }
      const sc = kit.merge(scaf);
      kit.transform(sc, { pos: [hx - 4, H(hx, hz) + S * 0.44, hz - 6], rot: [0.18, 0.5, -0.1] });
      flat(sc, "#5a4130", 0.24);
      batch.add("saint", "rust", sc);
    }

    /* --- the hand --- */
    {
      const S = 40;
      const g = kit.saintHand({ size: S, curl: 0.42 });
      const hx = d.x + 232;
      const hz = d.z - 176;
      kit.transform(g, {
        pos: [hx, H(hx, hz) - S * 0.42, hz],
        rot: [0.30, -0.9, 0.20],
      });
      paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => {
        const nrm = g.attributes.normal;
        return clamp01(0.20 + nrm.getY(i) * 0.42 + clamp01((y - H(hx, hz)) / (S * 0.9)) * 0.36);
      }, { jitter: 0.12 });
      batch.add("saint", "bronze", g);
      pois.push({ id: "saint-hand", name: "The Reaching Hand", x: hx, z: hz });
    }

    /* --- torso fragment: a shell you can walk into --- */
    {
      const parts = [];
      const R = 46;
      // A curved plate section - part of the Saint's chest, resting
      // on its edge to make a cave.
      const outer = [];
      const inner = [];
      for (let i = 0; i <= 14; i += 1) {
        const t = i / 14;
        const a = lerp(-1.15, 1.15, t);
        outer.push([Math.sin(a) * R, Math.cos(a) * R * 0.92]);
        inner.push([Math.sin(a) * (R - 3.2), Math.cos(a) * (R - 3.2) * 0.92]);
      }
      parts.push(kit.ribbonSolid(outer, inner, 40));
      // Rivet lines along the plate seam.
      for (let i = 0; i <= 14; i += 2) {
        const t = i / 14;
        const a = lerp(-1.15, 1.15, t);
        for (let k = -2; k <= 2; k += 1) {
          const r = kit.prism({ h: 0.9, rBottom: 0.7, rTop: 0.45, sides: 5 });
          r.rotateX(Math.PI / 2);
          r.rotateZ(-a);
          r.translate(Math.sin(a) * (R + 0.2), Math.cos(a) * (R + 0.2) * 0.92, k * 8);
          parts.push(r);
        }
      }
      const g = kit.merge(parts);
      const tx = d.x - 214;
      const tz = d.z + 62;
      kit.transform(g, { pos: [tx, H(tx, tz) - 20, tz], rot: [0.1, 1.15, 0.34] });
      paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => {
        const nrm = g.attributes.normal;
        return clamp01(0.14 + nrm.getY(i) * 0.5 + clamp01((y - H(tx, tz)) / 60) * 0.3);
      }, { jitter: 0.16 });
      batch.add("saint", "bronze", g);
      pois.push({ id: "saint-shell", name: "The Breastplate", x: tx, z: tz });
    }

    /* --- fallen halo arcs --- */
    for (let i = 0; i < 4; i += 1) {
      const len = rng.range(56, 104);
      const a0 = rng.range(-0.9, 0.9);
      const outer = [];
      const inner = [];
      const R = len * 1.35;
      const steps = 12;
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        const a = a0 + t * (len / R);
        const th = 5.2 * (0.4 + Math.sin(t * Math.PI) * 0.8);
        outer.push([Math.sin(a) * (R + th / 2), Math.cos(a) * (R + th / 2)]);
        inner.push([Math.sin(a) * (R - th / 2), Math.cos(a) * (R - th / 2)]);
      }
      const g = kit.ribbonSolid(outer, inner, rng.range(4, 9));
      g.translate(0, -R, 0);
      const ax = d.x + rng.gauss() * 190;
      const az = d.z + rng.gauss() * 190;
      kit.transform(g, {
        pos: [ax, H(ax, az) - rng.range(2, 14), az],
        rot: [rng.range(-0.5, 0.5), rng() * TAU, rng.range(0.4, 1.5) * rng.sign()],
      });
      // Softened from a straight up-facing term. At `0.24 + up*0.48`
      // every arc came out gold on top and near-black underneath -
      // four bananas lying in the sand. A curved surface needs the
      // grazing angles to land mid-ramp, not at the ends.
      paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, idx) => {
        const nrm = g.attributes.normal;
        const up = nrm.getY(idx);
        return clamp01(0.36 + up * 0.30 + Math.sin(x * 0.06 + z * 0.05) * 0.08);
      }, { jitter: 0.16 });
      batch.add("saint", "bronze", g);
    }

    /* --- plate debris field --- */
    {
      const geos = [];
      for (let i = 0; i < 130; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.6) * 320;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const s = rng.range(1.2, 7.5);
        const g = kit.slab(s * rng.range(0.8, 2.4), rng.range(0.3, 0.9), s, 0.1);
        place(g, x, z, {
          rot: [rng.jit(0.7), rng() * TAU, rng.jit(0.7)],
          dy: rng.range(-0.5, 0.2),
        });
        geos.push(g);
      }
      const g = mergeGeometries(THREE, geos);
      paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => {
        const nrm = g.attributes.normal;
        return clamp01(0.18 + nrm.getY(i) * 0.5);
      }, { jitter: 0.22 });
      batch.add("saint", "bronze", g);
    }

    /* --- the pilgrim camp, for scale ---
       Placed on the south-west approach, between the road and the
       head. Human-scale objects only do their job when they are
       BETWEEN the viewer and the colossus; off to one side they are
       just more scenery. */
    {
      const cx = d.x - 62;
      const cz = d.z + 92;
      const parts = [];
      for (let i = 0; i < 11; i += 1) {
        const a = (i / 11) * TAU + rng.jit(0.3);
        const r = rng.range(9, 26);
        const tx = cx + Math.cos(a) * r;
        const tz = cz + Math.sin(a) * r;
        // A tent is a four-sided cone with a wind-flap ridge.
        const tentR = rng.range(1.7, 2.6);
        const tent = kit.ringSolid([
          { y: 0, r: tentR, sides: 5, phase: rng() * TAU, jitter: 0.12, seed: rng.int(1, 1e6) },
          { y: rng.range(1.5, 2.3), r: 0.18, sides: 5 },
        ]);
        const tiltX = rng.jit(0.05);
        const yaw = rng() * TAU;
        const tiltZ = rng.jit(0.05);
        void tiltX; void tiltZ;
        // A tent's broad pentagonal hem needs to follow the rendered
        // ground envelope. A centre-gradient tilt still left the
        // downhill corners visibly hovering on the Saint's rough
        // approach, so seat the whole lower band instead.
        restOnTerrain(tent, tx, tz, {
          rot: [0, yaw, 0], embed: 0.18, maxGap: 0.04,
        });
        parts.push(tent);
      }
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#6b4a34"], [0.5, "#9c7550"], [1, "#c8a173"]]),
        { normalWeight: 0.5, jitter: 0.18 });
      batch.add("saint", "cloth", g, { castShadow: true });

      // Braziers: the camp's light, and the reason the Saint's chin
      // has an underlight at dusk.
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * TAU + 0.4;
        const bx = cx + Math.cos(a) * 12;
        const bz = cz + Math.sin(a) * 12;
        const br = kit.merge([
          kit.prism({ h: 1.1, rBottom: 0.22, rTop: 0.16, sides: 4 }),
          kit.ringSolid([
            { y: 1.1, r: 0.42, sides: 7 },
            { y: 1.55, r: 0.66, sides: 7, phase: 0.3 },
          ], { capTop: false }),
        ]);
        place(br, bx, bz);
        flat(br, "#43301f", 0.2);
        batch.add("saint", "rust", br);
        emitters.push({ kind: "fire", x: bx, y: H(bx, bz) + 1.6, z: bz, scale: 0.8, light: 1.4 });
      }
      pois.push({ id: "saint-camp", name: "Pilgrim Camp", x: cx, z: cz });
    }
  }

  /* ============================================================
     THE VAULT-CATHEDRAL
     ============================================================ */

  await step("Consecrating the Vault-Cathedral", 0.36);
  {
    const d = DISTRICTS.cathedral;
    const rng = makeRng(0xca7ed);
    const plazaY = field.cathedralPlazaY;
    const cx = d.x;
    const cz = d.z;

    const NAVE_L = 132;      // north-south
    const NAVE_W = 44;
    const WALL_H = 34;
    const AISLE_W = 13;

    /* The Cathedral's masonry. Lifted hard from the first pass,
       which bottomed out at #241c22: with the sun in the west, the
       whole south front and every north-facing surface sat in the
       ramp's bottom third, and from across the basin the building
       read as a black hulk rather than as pale stone in shadow.
       Stone in shadow is still stone - it is lit by the sky. */
    const stoneRamp = makeRamp([
      [0.00, "#4a3c46"], [0.22, "#6a5459"], [0.48, "#8b7166"],
      [0.74, "#b0937b"], [1.00, "#dcc19c"],
    ]);

    /* --- the nave walls --- */
    {
      const parts = [];
      for (const side of [-1, 1]) {
        const wx = side * (NAVE_W / 2);
        // Wall in bays, with a buttress pier between each.
        const bays = 9;
        for (let b = 0; b < bays; b += 1) {
          const z0 = -NAVE_L / 2 + (b / bays) * NAVE_L;
          const bl = NAVE_L / bays;
          // North end is blown open: skip the last bay's upper wall.
          const ruined = b >= bays - 2;
          const hh = ruined ? WALL_H * rng.range(0.28, 0.55) : WALL_H;
          const w = kit.slab(2.6, hh, bl * 0.98, 0.22);
          w.translate(wx, 0, z0 + bl / 2);
          parts.push(w);
          /* Clerestory lancets. Tall and paired: a gothic bay is
             mostly window above the string course, and the first
             pass's 15m arch on a 34m wall read as a letterbox slot.
             The height of these is what makes the flank legible as
             a cathedral rather than as a warehouse. */
          if (!ruined) {
            for (const off of [-0.22, 0.22]) {
              const arch = kit.gothicArch({
                width: bl * 0.30, height: 21, depth: 3.2, thickness: 0.85, rise: 1.25,
              });
              arch.rotateY(Math.PI / 2);
              arch.translate(wx, WALL_H - 22.5, z0 + bl / 2 + bl * off);
              parts.push(arch);
            }
            // Aisle window below the string course.
            const low = kit.gothicArch({
              width: bl * 0.42, height: 11, depth: 2.6, thickness: 0.8, rise: 1.2,
            });
            low.rotateY(Math.PI / 2);
            low.translate(side * (NAVE_W / 2 + AISLE_W), 1.5, z0 + bl / 2);
            parts.push(low);
          }
          // Pier.
          const pier = kit.slab(4.6, hh * 1.02, 3.4, 0.24);
          pier.translate(wx + side * 1.4, 0, z0);
          parts.push(pier);
        }
        // Aisle wall, lower and further out, with its own lean-to
        // roof: without one the aisle is an open trough and the
        // building has no body between its walls.
        const aw = kit.slab(2.0, 15.5, NAVE_L * 0.86, 0.2);
        aw.translate(side * (NAVE_W / 2 + AISLE_W), 0, -NAVE_L * 0.04);
        parts.push(aw);
        const lean = kit.extrudeZ([
          [side * (NAVE_W / 2 + AISLE_W + 1.4), 15.5],
          [side * (NAVE_W / 2 - 1.0), 22.5],
          [side * (NAVE_W / 2 - 1.0), 20.6],
          [side * (NAVE_W / 2 + AISLE_W + 1.4), 13.6],
        ], NAVE_L * 0.84);
        lean.translate(0, 0, -NAVE_L * 0.04);
        parts.push(lean);
      }

      /* --- the nave roof ---
         A cathedral seen from outside is mostly ROOF. Without one
         the nave is an open-topped box, the vault ribs stand
         against the sky like a wreck, and the whole silhouette
         loses the long horizontal that its towers are supposed to
         be interrupting. This one is a steep pitched roof over the
         southern two thirds; the north third stays open, which is
         where the building was breached. */
      {
        const roofL = NAVE_L * 0.62;
        const roof = kit.extrudeZ([
          [-NAVE_W / 2 - 1.6, WALL_H],
          [0, WALL_H + 17],
          [NAVE_W / 2 + 1.6, WALL_H],
          [NAVE_W / 2 + 1.6, WALL_H - 2.2],
          [0, WALL_H + 14.4],
          [-NAVE_W / 2 - 1.6, WALL_H - 2.2],
        ], roofL);
        roof.translate(0, 0, NAVE_L / 2 - roofL / 2 - 2);
        parts.push(roof);
        // Ridge crest.
        parts.push(kit.slab(1.6, 1.4, roofL, 0.2)
          .translate(0, WALL_H + 17, NAVE_L / 2 - roofL / 2 - 2));
        // Torn edge where the roof ends: a few surviving rafters
        // reaching north over the open bays.
        for (let i = 0; i < 7; i += 1) {
          const rz = NAVE_L / 2 - roofL - 2 - i * 5.6;
          const raf = kit.extrudeZ([
            [-NAVE_W / 2 - 1.0, WALL_H],
            [0, WALL_H + 16 - i * 1.4],
            [NAVE_W / 2 + 1.0, WALL_H],
            [NAVE_W / 2 + 1.0, WALL_H - 1.1],
            [0, WALL_H + 14.6 - i * 1.4],
            [-NAVE_W / 2 - 1.0, WALL_H - 1.1],
          ], 1.1);
          raf.translate(0, 0, rz);
          if (rng.chance(0.34)) continue;
          parts.push(raf);
        }
      }
      const g = kit.merge(parts);
      kit.transform(g, { pos: [cx, plazaY, cz] });
      paintH(g, stoneRamp, { min: plazaY, max: plazaY + WALL_H, normalWeight: 0.40, jitter: 0.13, noise: 0.22 });
      batch.add("cathedral", "stone", g);
    }

    /* --- south front, built around its openings --- */
    {
      /* The west front is the face of the building and the thing
         the whole approach is composed around, so it is built with
         real DEPTH rather than as a wall with holes in it.

         A flat slab pierced by a door and a circle reads as a
         cardboard flat from any angle at all, because nothing on it
         casts a shadow onto anything else. What makes a gothic
         front read is the layering: buttresses standing proud of
         the wall, portals recessed behind orders of arch mouldings,
         a gallery of niches, a string course, a gable. Every one of
         those is a plane at a different depth, and it is the
         shadows they throw across each other that give the stone
         its weight. */
      const parts = [];
      const FW = NAVE_W + 2 * AISLE_W + 10;   // 80
      const frontH = 58;
      const roseY = 39;
      const roseR = 12.5;
      const doorW = 16;
      const doorH = 25;
      const sideDoorW = 8.5;
      const sideDoorH = 15;
      const D = 4.6;                          // wall thickness

      /* --- the wall, built as panels around every opening --- */
      const wallPanel = (w, h, x, y, depth = D) => {
        if (w <= 0.2 || h <= 0.2) return;
        parts.push(kit.slab(w, h, depth, 0.28).translate(x, y, 0));
      };

      const centreHalf = doorW / 2;
      const sideL = -FW / 2;
      const sideCentre = 24;    // centre of each side portal, +/- x

      // Ground storey, split by the three portals.
      wallPanel(FW / 2 - sideCentre - sideDoorW / 2, doorH,
        (sideCentre + sideDoorW / 2 + FW / 2) / 2, 0);
      wallPanel(FW / 2 - sideCentre - sideDoorW / 2, doorH,
        -(sideCentre + sideDoorW / 2 + FW / 2) / 2, 0);
      wallPanel(sideCentre - sideDoorW / 2 - centreHalf, doorH,
        (sideCentre - sideDoorW / 2 + centreHalf) / 2, 0);
      wallPanel(sideCentre - sideDoorW / 2 - centreHalf, doorH,
        -(sideCentre - sideDoorW / 2 + centreHalf) / 2, 0);
      // Over the side portals.
      for (const s of [-1, 1]) {
        wallPanel(sideDoorW, doorH - sideDoorH, s * sideCentre, sideDoorH);
      }
      // Between the portal heads and the rose, and above the rose.
      wallPanel(FW, roseY - roseR - doorH - 1, 0, doorH + 1);
      wallPanel((FW - roseR * 2.4) / 2, roseR * 2.4,
        (roseR * 2.4 + FW) / 4, roseY - roseR * 1.2);
      wallPanel((FW - roseR * 2.4) / 2, roseR * 2.4,
        -(roseR * 2.4 + FW) / 4, roseY - roseR * 1.2);
      wallPanel(FW, frontH - (roseY + roseR * 1.2), 0, roseY + roseR * 1.2);
      void sideL;

      /* --- string courses: two horizontals across the whole width.
             In a facade of verticals these are what stop it reading
             as a picket fence. --- */
      for (const y of [doorH + 0.6, roseY + roseR * 1.25]) {
        parts.push(kit.slab(FW + 2.4, 1.5, D + 2.4, 0.3).translate(0, y, 0));
        parts.push(kit.slab(FW + 1.2, 0.8, D + 1.4, 0.2).translate(0, y + 1.5, 0));
      }

      /* --- buttresses standing proud of the wall --- */
      for (const bx of [-FW / 2 + 8, -14, 14, FW / 2 - 8]) {
        const bh = frontH * 0.86;
        parts.push(kit.slab(4.4, bh, 5.6, 0.3).translate(bx, 0, D / 2 + 1.6));
        parts.push(kit.slab(5.4, bh * 0.34, 6.8, 0.35).translate(bx, 0, D / 2 + 1.9));
        // Weathering set-back and a pinnacle.
        parts.push(kit.prism({ h: 2.0, rBottom: 3.4, rTop: 2.4, sides: 4, twist: Math.PI / 4 })
          .translate(bx, bh, D / 2 + 1.6));
        parts.push(kit.prism({ h: 9.5, rBottom: 2.2, rTop: 0.16, sides: 4, twist: Math.PI / 4 })
          .translate(bx, bh + 2.0, D / 2 + 1.6));
      }

      /* --- portals: recessed, with three orders of arch --- */
      const portal = (w, h, x, orders) => {
        for (let o = 0; o < orders; o += 1) {
          const k = 1 - o * 0.11;
          const arch = kit.gothicArch({
            width: w * k + 3.6, height: h * k + 7, depth: 1.5,
            thickness: 1.35, rise: 1.18,
          });
          arch.translate(x, 0, D / 2 + 2.4 - o * 1.45);
          parts.push(arch);
        }
        // Tympanum: the filled head of the doorway, where the
        // relief would be. Solid, so the opening reads as a door
        // and not as a hole through the building.
        parts.push(kit.slab(w * 0.96, h * 0.30, 1.2, 0.15)
          .translate(x, h * 0.74, D / 2 - 1.2));
        // Trumeau: the central post of a great door.
        if (orders >= 3) {
          parts.push(kit.column({ h: h * 0.74, r: 0.85, shafts: 4, shaftR: 0.2 })
            .translate(x, 0, D / 2 + 0.4));
        }
      };
      portal(doorW, doorH, 0, 3);
      portal(sideDoorW, sideDoorH, -sideCentre, 2);
      portal(sideDoorW, sideDoorH, sideCentre, 2);

      /* --- the gallery of niches --- */
      for (let i = 0; i < 11; i += 1) {
        const nx = (i / 10 - 0.5) * (FW - 16);
        if (Math.abs(nx) < roseR * 1.35) continue;
        const ny = roseY - roseR * 0.55;
        // Canopy and corbel, with the saint standing between them.
        parts.push(kit.slab(4.0, 0.7, 2.4, 0.16).translate(nx, ny + 6.6, D / 2 + 0.9));
        parts.push(kit.prism({ h: 1.0, rBottom: 1.5, rTop: 0.9, sides: 5 })
          .translate(nx, ny - 1.0, D / 2 + 0.9));
        const st = kit.statue(rng, {
          h: 6.4, style: rng.pick(["sword", "book", "censer"]),
          plinth: false, broken: rng.chance(0.35) ? rng.range(0.2, 0.6) : 0,
          halo: rng.chance(0.5),
        });
        st.translate(nx, ny, D / 2 + 0.9);
        parts.push(st);
      }

      /* --- rose tracery: a stone frame, radial mullions and two
             rings of cusped circles. Twelve fat spokes on a bare
             disc is a pinwheel; the density is what makes it read
             as a window. --- */
      parts.push(kit.ringSolid([
        { y: -1.6, r: roseR + 3.0, sides: 21 },
        { y: 1.6, r: roseR + 3.0, sides: 21 },
      ], { capTop: false, capBottom: false })
        .rotateX(Math.PI / 2).translate(0, roseY, D / 2 - 0.4));
      parts.push(kit.ringSolid([
        { y: -0.5, r: roseR + 1.2, sides: 21 },
        { y: 0.5, r: roseR + 1.2, sides: 21 },
      ], { capTop: false, capBottom: false })
        .rotateX(Math.PI / 2).translate(0, roseY, D / 2 + 0.9));
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * TAU;
        const spoke = kit.slab(roseR * 0.98, 0.34, 0.9, 0.05);
        spoke.translate(roseR * 0.49, 0, 0);
        spoke.rotateZ(a);
        spoke.translate(0, roseY, D / 2 - 0.1);
        parts.push(spoke);
      }
      for (const [ringR, count] of [[roseR * 0.42, 8], [roseR * 0.76, 16]]) {
        parts.push(kit.ringSolid([
          { y: -0.28, r: ringR, sides: 19 },
          { y: 0.28, r: ringR, sides: 19 },
        ], { capTop: false, capBottom: false })
          .rotateX(Math.PI / 2).translate(0, roseY, D / 2 - 0.1));
        void count;
      }

      /* --- gable over the centre --- */
      parts.push(kit.extrudeZ([
        [-FW * 0.30, frontH], [0, frontH + 13], [FW * 0.30, frontH],
        [FW * 0.30, frontH - 1.6], [0, frontH + 11.2], [-FW * 0.30, frontH - 1.6],
      ], D + 1.6));
      parts.push(kit.prism({ h: 6.5, rBottom: 1.4, rTop: 0.1, sides: 4, twist: Math.PI / 4 })
        .translate(0, frontH + 13, 0));

      /* --- twin towers: SQUARE and staged. Octagonal cones on the
             corners read as party hats; a bell tower is a stack of
             boxes with openings, and the openings are the point. --- */
      for (const s of [-1, 1]) {
        const tParts = [];
        const TR = 7.2;
        let ty = 0;
        for (let stage = 0; stage < 3; stage += 1) {
          const sh = [26, 20, 16][stage];
          const r = TR * (1 - stage * 0.06);
          tParts.push(kit.slab(r * 2, sh, r * 2, 0.34).translate(0, ty, 0));
          // Corner shafts.
          for (const ox of [-1, 1]) {
            for (const oz of [-1, 1]) {
              tParts.push(kit.prism({ h: sh, rBottom: 0.95, rTop: 0.85, sides: 5 })
                .translate(ox * r * 0.96, ty, oz * r * 0.96));
            }
          }
          // Belfry openings on the upper stages.
          if (stage > 0) {
            for (let f = 0; f < 4; f += 1) {
              const a = (f / 4) * TAU;
              const arch = kit.gothicArch({
                width: r * 0.86, height: sh * 0.62, depth: 1.3,
                thickness: 0.72, rise: 1.2,
              });
              arch.rotateY(a);
              arch.translate(Math.sin(a) * r, ty + sh * 0.22, Math.cos(a) * r);
              tParts.push(arch);
            }
          }
          // Cornice.
          tParts.push(kit.slab(r * 2.3, 1.3, r * 2.3, 0.3).translate(0, ty + sh, 0));
          ty += sh + 1.3;
        }
        // Corner pinnacles, then the spire.
        for (const ox of [-1, 1]) {
          for (const oz of [-1, 1]) {
            tParts.push(kit.prism({ h: 10, rBottom: 1.5, rTop: 0.1, sides: 4, twist: Math.PI / 4 })
              .translate(ox * TR * 0.82, ty, oz * TR * 0.82));
          }
        }
        tParts.push(kit.prism({ h: 30, rBottom: TR * 0.82, rTop: 0.12, sides: 8, segments: 3 })
          .translate(0, ty, 0));
        const t = kit.merge(tParts);
        t.translate(s * (FW / 2 - TR + 0.6), 0, -TR * 0.4);
        parts.push(t);
      }

      const g = kit.merge(parts);
      kit.transform(g, { pos: [cx, plazaY, cz + NAVE_L / 2 + 2.6] });
      // `normalWeight` high, so the depth actually shows: with the
      // front nearly edge-on to the sun, height alone gives every
      // buttress and every recess the same value and the layering
      // disappears. Facing is what separates the planes.
      paintH(g, stoneRamp, {
        min: plazaY, max: plazaY + 62, normalWeight: 0.58,
        jitter: 0.13, noise: 0.20,
      });
      batch.add("cathedral", "stone", g);

      /* The rose window glass. Unlit and emissive so it glows from
         outside at dusk and throws a colour disc on the nave floor.
         The light that actually lands inside is a separate spot -
         no renderer here is going to derive it from the geometry. */
      {
        const glass = [];
        const pane = (r0, r1, a0, a1) => {
          const pts = [];
          const seg = 3;
          for (let i = 0; i <= seg; i += 1) {
            const a = lerp(a0, a1, i / seg);
            pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
          }
          for (let i = seg; i >= 0; i -= 1) {
            const a = lerp(a0, a1, i / seg);
            pts.push([Math.cos(a) * r0, Math.sin(a) * r0]);
          }
          return kit.extrudeZ(pts, 0.4);
        };
        // Deep, saturated, and few. Six bright hues in equal measure
        // is a beach ball; stained glass is mostly two or three
        // colours with the rest as accents.
        // Dark. These are UNLIT and go straight into a linear HDR
        // buffer that a bloom pass reads next, so glass authored at
        // the brightness it would have when backlit comes out as a
        // luminous plastic pinwheel. Real glass seen from the shade
        // side is nearly black with colour in it.
        const COLOURS = [
          "#3a0d16", "#141a3c", "#4a1119", "#1d2450",
          "#3a2a08", "#2a0d20", "#101c2e", "#45161c",
        ];
        // Many small panes, not a few big ones. Sixteen slices of
        // flat colour is a pinwheel; a real rose is hundreds of
        // fragments whose average is what you read at distance.
        for (let ring = 0; ring < 4; ring += 1) {
          const r0 = roseR * (0.14 + ring * 0.215);
          const r1 = roseR * (0.14 + (ring + 1) * 0.215);
          const count = 8 + ring * 8;
          for (let i = 0; i < count; i += 1) {
            const a0 = (i / count) * TAU + 0.025;
            const a1 = ((i + 1) / count) * TAU - 0.025;
            const p = pane(r0, r1, a0, a1);
            p.translate(0, roseY, 0);
            flat(p, COLOURS[(i * 3 + ring * 2) % COLOURS.length], 0.34);
            glass.push(p);
          }
        }
        const hub = kit.prism({ h: 0.4, rBottom: roseR * 0.13, rTop: roseR * 0.13, sides: 11 });
        hub.rotateX(Math.PI / 2);
        hub.translate(0, roseY, 0);
        flat(hub, PALETTE.goldLit, 0.1);
        glass.push(hub);
        const g2 = kit.merge(glass);
        kit.transform(g2, { pos: [cx, plazaY, cz + NAVE_L / 2 + 2.6] });
        batch.add("cathedral", "emissive", g2, { castShadow: false, receiveShadow: false });

        // The shaft of coloured light it casts down the nave.
        emitters.push({
          kind: "shaft", x: cx, y: plazaY + roseY, z: cz + NAVE_L / 2 - 1,
          dir: [0, -0.42, -1], length: 96, radius: roseR * 1.15,
          colour: "#e8804f", scale: 1,
        });
      }
    }

    /* --- flying buttresses --- */
    {
      const parts = [];
      for (const side of [-1, 1]) {
        for (let b = 0; b < 8; b += 1) {
          const z = -NAVE_L / 2 + 10 + (b / 7) * (NAVE_L - 26);
          const ruin = b >= 6 ? rng.range(0.35, 0.8) : 0;
          const fb = kit.flyingButtress({
            reach: AISLE_W + 5.5,
            pierH: 17,
            wallH: WALL_H * (1 - ruin * 0.5),
            thickness: 1.25,
            pinnacle: ruin < 0.5,
          });
          // Rotate rather than mirror. A negative scale flips the
          // triangle winding, and with backface culling on, half the
          // cathedral would render inside out.
          if (side < 0) fb.rotateY(Math.PI);
          fb.translate(side * (NAVE_W / 2), 0, z);
          parts.push(fb);
        }
      }
      const g = kit.merge(parts);
      kit.transform(g, { pos: [cx, plazaY, cz] });
      paintH(g, stoneRamp, { min: plazaY, max: plazaY + WALL_H, normalWeight: 0.42, jitter: 0.14 });
      batch.add("cathedral", "stone", g);
    }

    /* --- the nave floor ---
       Without one the interior is bare terrain, which under a roof
       is fully shadowed sand: a flat purple-brown void with columns
       standing in it. A pale flagstone floor is what the light
       shafts land ON, and a shaft with nothing to land on is just a
       translucent cone. */
    {
      const parts = [];
      const rows = 34;
      const cols = 11;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const fx = (c / (cols - 1) - 0.5) * (NAVE_W - 3.0);
          const fz = (r / (rows - 1) - 0.5) * (NAVE_L - 2.0);
          // Sand has drifted in through the broken north end, so
          // the paving thins out as it goes.
          const drift = clamp01((fz / NAVE_L) * -1.4 + 0.45);
          if (rng.chance(drift * 0.85)) continue;
          const fh = rng.range(0.22, 0.34);
          const s = kit.slab(
            (NAVE_W - 3.0) / cols * rng.range(0.86, 0.97), fh,
            (NAVE_L - 2.0) / rows * rng.range(0.86, 0.97), 0.05
          );
          /* The batch is lifted 16cm below. Keep the visible top only
             4cm proud of the walk surface: the previous fixed -24cm
             base left the random 22-34cm stones 14-26cm through the
             player's boots. */
          s.translate(fx, -fh - 0.12, fz);
          parts.push(s);
        }
      }
      const g = kit.merge(parts);
      kit.transform(g, { pos: [cx, plazaY + 0.16, cz] });
      paintH(g, makeRamp([
        [0, "#6a5750"], [0.4, "#96806f"], [0.75, "#bda589"], [1, "#e0c9a6"],
      ]), { normalWeight: 0.62, jitter: 0.16, noise: 0.34 });
      batch.add("cathedral", "stone", g);
    }

    /* --- the nave interior: columns and vault ribs --- */
    {
      const parts = [];
      const bays = 9;
      for (const side of [-1, 1]) {
        for (let b = 0; b <= bays; b += 1) {
          const z = -NAVE_L / 2 + (b / bays) * NAVE_L;
          const col = kit.column({ h: 24, r: 1.5, shafts: 6, shaftR: 0.34 });
          col.translate(side * (NAVE_W / 2 - 2.6), 0, z);
          parts.push(col);
        }
      }
      // Transverse vault ribs. The roof is gone over the north
      // third, so the ribs there stand open against the sky - the
      // single best silhouette in the district.
      for (let b = 0; b <= bays; b += 1) {
        const z = -NAVE_L / 2 + (b / bays) * NAVE_L;
        const open = b > bays * 0.62;
        const span = NAVE_W - 5.2;
        const pts = [];
        const steps = 9;
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const x = lerp(-span / 2, span / 2, t);
          const y = 24 + Math.sin(t * Math.PI) * 9.5;
          pts.push([x, y, z]);
        }
        if (open && rng.chance(0.4)) {
          // A collapsed rib: only the springing survives.
          parts.push(kit.tube(pts.slice(0, 3), 0.62, 5));
          parts.push(kit.tube(pts.slice(-3), 0.62, 5));
        } else {
          parts.push(kit.tube(pts, 0.62, 5));
        }
        if (!open) {
          // The web between ribs - the actual ceiling.
          const top = [];
          const bot = [];
          for (let i = 0; i <= steps; i += 1) {
            const t = i / steps;
            const x = lerp(-span / 2, span / 2, t);
            top.push([x, 24 + Math.sin(t * Math.PI) * 9.5 + 0.9]);
            bot.push([x, 24 + Math.sin(t * Math.PI) * 9.5 + 0.1]);
          }
          const web = kit.ribbonSolid(top, bot, NAVE_L / bays * 0.98);
          web.translate(0, 0, z);
          parts.push(web);
        }
      }
      const g = kit.merge(parts);
      kit.transform(g, { pos: [cx, plazaY, cz] });
      paintH(g, stoneRamp, { min: plazaY, max: plazaY + 34, normalWeight: 0.38, jitter: 0.12, bias: -0.06 });
      batch.add("cathedral", "stone", g);
    }

    /* --- the crossing spire --- */
    {
      const g = kit.merge([
        kit.prism({ h: 40, rBottom: 13, rTop: 11.5, sides: 8, segments: 3 }),
        kit.prism({ h: 2.4, rBottom: 13.4, rTop: 12.6, sides: 8 }).translate(0, 40, 0),
        kit.spire({ h: 106, r: 11.5, stages: 4, sides: 8, seed: 19 }).translate(0, 42.4, 0),
      ]);
      kit.transform(g, { pos: [cx, plazaY + WALL_H - 6, cz - NAVE_L * 0.10] });
      paintH(g, stoneRamp, {
        min: plazaY + WALL_H - 6, max: plazaY + WALL_H + 130,
        normalWeight: 0.36, jitter: 0.12, noise: 0.2,
      });
      batch.add("cathedral", "stone", g);
      pois.push({ id: "cathedral", name: "Vault-Cathedral", x: cx, z: cz });
    }

    /* --- the plaza --- */
    {
      const parts = [];
      // Flagstone apron.
      for (let i = 0; i < 220; i += 1) {
        const a = rng() * TAU;
        const r = 20 + Math.pow(rng(), 0.5) * 108;
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r + NAVE_L / 2 + 34;
        if (Math.hypot(px, pz - NAVE_L / 2 - 34) > 118) continue;
        const sw = rng.range(3.4, 6.2);
        const sh = rng.range(0.25, 0.45);
        const sd = rng.range(3.4, 6.2);
        const s = kit.slab(sw, sh, sd, 0.06);
        placeOnTerrain(s, cx + px, cz + pz, {
          yaw: rng() * TAU,
          sample: Math.max(sw, sd) * 0.45,
          // Four centimetres of relief reads as paving without
          // putting an ankle-height non-walkable slab through boots.
          dy: -sh + 0.04,
          maxTilt: 0.45,
        });
        parts.push(s);
      }
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#4a3c3a"], [0.5, "#7b665c"], [1, "#a08974"]]),
        { normalWeight: 0.6, jitter: 0.18, noise: 0.35 });
      batch.add("cathedral", "stone", g);

      // A semicircle of saints facing the doors, several toppled.
      const saints = [];
      for (let i = 0; i < 13; i += 1) {
        const a = Math.PI * (0.12 + (i / 12) * 0.76);
        const r = 96;
        const px = cx + Math.cos(a) * r;
        const pz = cz + NAVE_L / 2 + 40 + Math.sin(a) * r * 0.55;
        const toppled = rng.chance(0.34);
        const h = rng.range(13, 17);
        const st = kit.statue(rng, {
          h, style: rng.pick(["sword", "book", "censer"]),
          broken: toppled ? 0 : (rng.chance(0.4) ? rng.range(0.15, 0.5) : 0),
          halo: rng.chance(0.55), plinth: true,
        });
        restOnTerrain(st, px, pz, {
          rot: toppled
            ? [rng.range(1.2, 1.7), rng() * TAU, rng.jit(0.5)]
            : [0, Math.atan2(cz + NAVE_L / 2 + 40 - pz, cx - px) + Math.PI / 2, 0],
          embed: toppled ? 0.45 : 0.12,
          maxGap: 0.08,
        });
        saints.push(st);
      }
      const sg = kit.merge(saints);
      paintH(sg, stoneRamp, { normalWeight: 0.44, jitter: 0.14, noise: 0.24 });
      batch.add("cathedral", "stone", sg);

      // The fallen bell: cracked, on its side, big enough to stand
      // in. Built as a proper bell profile - a flared lip, a waist,
      // a shoulder and a crown - because the previous smooth taper,
      // painted by facing alone, came out as a striped beach ball.
      {
        const reverseWinding = (geo) => {
          const index = geo.index.array;
          for (let i = 0; i < index.length; i += 3) {
            const tmp = index[i + 1];
            index[i + 1] = index[i + 2];
            index[i + 2] = tmp;
          }
          geo.index.needsUpdate = true;
          geo.computeVertexNormals();
          return geo;
        };
        const inner = kit.ringSolid([
          { y: 0.0, r: 7.45, sides: 15 },
          { y: 1.4, r: 7.25, sides: 15, phase: 0.06 },
          { y: 2.6, r: 6.30, sides: 15, phase: 0.10 },
          { y: 6.0, r: 5.52, sides: 15, phase: 0.16 },
          { y: 10.0, r: 4.75, sides: 15, phase: 0.22 },
          { y: 13.0, r: 3.02, sides: 15, phase: 0.28 },
          { y: 14.0, r: 2.65, sides: 15, phase: 0.34 },
        ], { capBottom: false });
        // The bell is a shell, not a one-sided lampshade. Reverse
        // the inner surface so the mouth remains visible from every
        // approach while keeping the district material FrontSide.
        reverseWinding(inner);
        // Stitch the two open boundaries with a real annular lip.
        // Both rings share one plane; reversed winding points the
        // visible mouth surface outward/down the bell's local axis.
        const lip = reverseWinding(kit.ringSolid([
          { y: 0.0, r: 8.2, sides: 15 },
          { y: 0.0, r: 7.45, sides: 15 },
        ], { capBottom: false, capTop: false }));
        const bell = kit.merge([
          kit.ringSolid([
            { y: 0.0, r: 8.2, sides: 15 },
            { y: 1.4, r: 8.0, sides: 15, phase: 0.06 },
            { y: 2.6, r: 7.0, sides: 15, phase: 0.10 },
            { y: 6.0, r: 6.2, sides: 15, phase: 0.16 },
            { y: 10.0, r: 5.4, sides: 15, phase: 0.22 },
            { y: 13.0, r: 3.6, sides: 15, phase: 0.28 },
            { y: 14.4, r: 3.2, sides: 15, phase: 0.34 },
          ], { capBottom: false }),
          inner,
          lip,
          // Crown loops.
          kit.prism({ h: 2.4, rBottom: 0.6, rTop: 0.5, sides: 5 }).translate(1.5, 14.4, 0),
          kit.prism({ h: 2.4, rBottom: 0.6, rTop: 0.5, sides: 5 }).translate(-1.5, 14.4, 0),
          kit.prism({ h: 1.0, rBottom: 2.2, rTop: 1.8, sides: 7 }).translate(0, 16.8, 0),
          // Clapper, hanging out of the mouth.
          kit.ringSolid([
            { y: 1.0, r: 1.5, sides: 7 },
            { y: 3.2, r: 1.0, sides: 7 },
            { y: 9.0, r: 0.5, sides: 7 },
          ]).translate(1.2, 0, 0.6),
        ]);
        const bx = cx + 66;
        const bz = cz + NAVE_L / 2 + 26;
        // Painted BEFORE it is laid on its side, by height along its
        // own axis. Painting a surface of revolution by world normal
        // gives concentric bands, and on a bell that is a striped
        // beach ball every time.
        paintH(bell, BRONZE_RAMP, {
          min: 0, max: 17, normalWeight: 0.20, jitter: 0.12, noise: 0.16, bias: 0.10,
        });
        restOnTerrain(bell, bx, bz, {
          rot: [1.46, 0.7, 0.2], embed: 0.35, maxGap: 0.08,
        });
        batch.add("cathedral", "bronze", bell);
        pois.push({ id: "cathedral-bell", name: "The Fallen Bell", x: bx, z: bz });

        /* A pilgrims' brazier at the mouth of the bell.
           The plaza sits in the shadow of a 190m spire from
           mid-afternoon onward, so at the level's primary hour this
           relic - one of the better objects in the district - was a
           dark lump on a dark field with nothing to read it
           against. Point lights fall off as 1/d-squared, so the
           processional braziers 54m up the stair contributed about
           a ten-thousandth of their intensity here; the only thing
           that lights an object in shadow is a light AT it.

           It is also just what would be there. */
        const fx = bx - 9.5;
        const fz = bz + 5.5;
        const fire = kit.merge([
          kit.prism({ h: 2.2, rBottom: 0.40, rTop: 0.30, sides: 6 }),
          kit.ringSolid([
            { y: 2.2, r: 0.85, sides: 8 },
            { y: 2.95, r: 1.30, sides: 8, phase: 0.3 },
          ], { capTop: false }),
        ]);
        place(fire, fx, fz);
        flat(fire, "#3a2c1c", 0.16);
        batch.add("cathedral", "rust", fire);
        emitters.push({ kind: "fire", x: fx, y: H(fx, fz) + 3.1, z: fz, scale: 1.4, light: 2.4 });
        lights.push({
          x: fx, y: H(fx, fz) + 3.4, z: fz,
          colour: "#ff9040", intensity: 120, distance: 90,
          kind: "brazier", flicker: 0.9,
        });
      }

      // Braziers up the processional stair.
      for (let i = 0; i < 6; i += 1) {
        const s = i % 2 ? 1 : -1;
        const px = cx + s * 14;
        const pz = cz + NAVE_L / 2 + 12 + Math.floor(i / 2) * 16;
        const br = kit.merge([
          kit.prism({ h: 2.6, rBottom: 0.42, rTop: 0.30, sides: 6 }),
          kit.ringSolid([
            { y: 2.6, r: 0.85, sides: 8 },
            { y: 3.3, r: 1.25, sides: 8, phase: 0.3 },
          ], { capTop: false }),
        ]);
        place(br, px, pz);
        flat(br, "#3a2c1c", 0.16);
        batch.add("cathedral", "rust", br);
        emitters.push({ kind: "fire", x: px, y: H(px, pz) + 3.4, z: pz, scale: 1.15, light: 2.0 });
        // Real lights on alternate braziers. With the sun in the
        // west and a 190m building between it and here, the plaza
        // is in deep shadow at golden hour - correct, and it left
        // the two POIs on it with no readable frame at the level's
        // primary time of day. A processional way lit by fire is
        // also just better than one lit by nothing.
        // Two of the six, to leave budget for the one at the bell.
        if (i % 3 === 0) {
          lights.push({
            x: px, y: H(px, pz) + 3.6, z: pz,
            colour: "#ff9a4c", intensity: 110, distance: 90,
            kind: "brazier", flicker: 0.8,
          });
        }
      }
    }

    /* --- hanging banners in the nave --- */
    for (let i = 0; i < 10; i += 1) {
      const side = i % 2 ? 1 : -1;
      const z = cz - NAVE_L / 2 + 16 + (i / 9) * (NAVE_L - 40);
      const ban = kit.banner({
        w: 5.2, h: rng.range(14, 21), cols: 5, rows: 13,
        sag: 0.08, amp: 0.22, taper: 0.08, swallowtail: 0.12,
      });
      ban.translate(cx + side * (NAVE_W / 2 - 4.4), plazaY + 30, z);
      banners.push({
        geo: ban, district: "cathedral",
        colour: rng.pick([PALETTE.oxblood, PALETTE.indigo, PALETTE.crimson]),
        accent: PALETTE.gold, wind: 0.35,
      });
    }
  }

  /* ============================================================
     THE OSSUARY
     ============================================================ */

  await step("Laying out the Ossuary", 0.50);
  {
    const d = DISTRICTS.ossuary;
    const rng = makeRng(0x805e);
    const axis = -0.62;      // the animal's long axis, radians
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    const along = (t) => [d.x + ca * t, d.z + sa * t];

    /* --- the ribcage --- */
    {
      const parts = [];
      const RIBS = 13;
      for (let i = 0; i < RIBS; i += 1) {
        const t = -108 + (i / (RIBS - 1)) * 210;
        const [rx, rz] = along(t);
        // Ribs are longest at the middle of the cage.
        const bulk = Math.sin((i / (RIBS - 1)) * Math.PI * 0.92 + 0.14);
        const span = 24 + bulk * 26;
        const hgt = 44 + bulk * 34;
        for (const side of [-1, 1]) {
          // Some ribs are snapped: the gaps are what let you see
          // through the cage and read it as a cage.
          const snapped = rng.chance(0.22);
          const g = kit.rib({
            // A rib on a 90m animal is a structural member, not a
            // hoop of wire. At 1.9m these read as scaffolding tube
            // from any distance at all.
            span, height: hgt, thickness: 3.4 + bulk * 2.6,
            twist: rng.jit(0.5), lean: rng.range(0.1, 0.30),
            // Just short of a full half turn, so the tips of a pair
            // lean toward each other over the spine without meeting.
            sweep: rng.range(2.45, 2.78),
            seed: rng.int(1, 1e6),
          });
          if (snapped) {
            const p = g.attributes.position;
            const cut = hgt * rng.range(0.35, 0.75);
            for (let v = 0; v < p.count; v += 1) {
              if (p.getY(v) > cut) p.setY(v, cut - Math.abs(Math.sin(p.getX(v) * 0.7)) * 1.2);
            }
            p.needsUpdate = true;
            g.computeVertexNormals();
          }
          // The opposite side is a 180-degree rotation, not a mirror:
          // a negative scale reverses the winding and the whole
          // ribcage would render inside out under backface culling.
          kit.transform(g, {
            pos: [rx, H(rx, rz) - 1.6, rz],
            rot: [
              rng.jit(0.06),
              axis + Math.PI / 2 + (side < 0 ? Math.PI : 0) + rng.jit(0.05),
              rng.jit(0.05),
            ],
          });
          parts.push(g);
        }
      }
      const g = kit.merge(parts);
      paintH(g, BONE_RAMP, { normalWeight: 0.46, jitter: 0.11, noise: 0.2, bias: 0.06 });
      batch.add("ossuary", "bone", g);
      pois.push({ id: "ossuary", name: "The Ossuary", x: d.x, z: d.z });
    }

    /* --- the spine --- */
    {
      const parts = [];
      // The skull begins at t=275. The former 26-piece run continued
      // another 166m through and beyond the head, reading as a line
      // of floating shrine posts up the rim. Stop at the skull and
      // lay each centrum along the animal's actual long axis.
      for (let i = 0; i < 13; i += 1) {
        const t = 104 + i * 13.5;
        const [vx, vz] = along(t);
        const shrink = 1 - (i / 13) * 0.46;
        const size = 6.5 * shrink;
        const g = kit.vertebra({ size, spine: 1.7 + i * 0.03 });
        g.rotateZ(-Math.PI / 2 + rng.jit(0.07));
        g.rotateY(-axis + rng.jit(0.06));
        restOnTerrain(g, vx, vz, {
          embed: size * 0.16, maxGap: 0.08,
        });
        parts.push(g);
      }
      // And the tail vanishing into the dunes the other way.
      for (let i = 0; i < 12; i += 1) {
        const t = -120 - i * 15;
        const [vx, vz] = along(t);
        const shrink = 1 - (i / 12) * 0.5;
        const size = 7.5 * shrink;
        const g = kit.vertebra({ size, spine: 2.2 });
        g.rotateZ(-Math.PI / 2 + rng.jit(0.09));
        g.rotateY(-axis + rng.jit(0.14));
        restOnTerrain(g, vx, vz, {
          embed: size * 0.18 + i * 0.12, maxGap: 0.08,
        });
        parts.push(g);
      }
      const g = kit.merge(parts);
      paintH(g, BONE_RAMP, { normalWeight: 0.48, jitter: 0.12, noise: 0.18 });
      batch.add("ossuary", "bone", g);
    }

    /* --- the skull --- */
    {
      const S = 34;
      const g = kit.skull({ size: S, jaw: true });
      const [sx, sz] = along(275);
      kit.transform(g, {
        pos: [sx, H(sx, sz) + 2.5, sz],
        rot: [0.26, axis + Math.PI, -0.34],
        scale: [1, 1, 1.55],
      });
      paintH(g, BONE_RAMP, { normalWeight: 0.5, jitter: 0.10, noise: 0.16, bias: 0.08 });
      batch.add("ossuary", "bone", g);
      pois.push({ id: "ossuary-skull", name: "The Skull", x: sx, z: sz });

      // Tusks flanking it.
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 8; i += 1) {
          const t = i / 8;
          pts.push([
            side * (6 + Math.sin(t * 1.6) * 9),
            t * 22,
            -t * t * 12,
          ]);
        }
        const tu = kit.tube(pts, 2.0, 6, { taper: 0.82 });
        kit.transform(tu, {
          pos: [sx, H(sx, sz) + 1, sz],
          rot: [0.6, axis + Math.PI, 0],
        });
        paintH(tu, BONE_RAMP, { normalWeight: 0.5, jitter: 0.1, bias: 0.14 });
        batch.add("ossuary", "bone", tu);
      }
    }

    /* --- scavenger works among the ribs --- */
    {
      const parts = [];
      const [wx, wz] = along(30);
      // A bone-cutting gantry straddling one rib.
      const deckY = Math.max(H(wx - 22, wz - 6), H(wx + 20, wz - 6)) + 9;
      parts.push(kit.catwalk([
        [wx - 22, deckY, wz - 6],
        [wx + 20, deckY, wz - 6],
      ], { width: 2.2 }));
      for (const ox of [-20, 18]) {
        const footX = wx + ox;
        const footZ = wz - 6;
        const footY = H(footX, footZ) - 0.2;
        parts.push(kit.merge([
          kit.prism({ h: deckY - footY, rBottom: 0.55, rTop: 0.42, sides: 5 }),
        ]).translate(footX, footY, footZ));
      }
      // Cut bone stacked in cords.
      for (let i = 0; i < 22; i += 1) {
        const length = rng.range(4, 9);
        const boneR = rng.range(0.5, 1.1);
        const s = kit.prism({ h: length, rBottom: boneR, rTop: rng.range(0.4, 0.9), sides: 6 });
        s.translate(0, -length / 2, 0);
        s.rotateZ(Math.PI / 2 + rng.jit(0.06));
        const layer = Math.floor(i / 6);
        const slot = i % 6;
        const px = wx + rng.jit(0.6) + (layer % 2 ? 0.35 : 0);
        const pz = wz + 12 + (slot - 2.5) * 2.15 + rng.jit(0.15);
        s.translate(px, H(px, pz) + 0.65 + layer * 1.38, pz);
        parts.push(s);
      }
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#6a5c48"], [0.5, "#a2937a"], [1, "#d6cbae"]]),
        { normalWeight: 0.5, jitter: 0.16, noise: 0.22 });
      batch.add("ossuary", "bone", g);
    }

    /* --- bone litter across the pan --- */
    {
      const geos = [];
      for (let i = 0; i < 260; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.55) * 300;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const kind = rng();
        let g;
        if (kind < 0.5) {
          g = kit.prism({ h: rng.range(1.4, 5.5), rBottom: rng.range(0.2, 0.5), rTop: rng.range(0.15, 0.4), sides: 5, bulge: 0.3 });
          g.rotateZ(Math.PI / 2);
        } else if (kind < 0.82) {
          g = kit.vertebra({ size: rng.range(0.5, 1.6), spine: 1.4 });
        } else {
          g = kit.skull({ size: rng.range(0.9, 2.4), jaw: rng.chance(0.5) });
        }
        place(g, x, z, {
          rot: [rng.jit(1.2), rng() * TAU, rng.jit(1.2)],
          dy: rng.range(-0.25, 0.15),
        });
        geos.push(g);
      }
      const g = mergeGeometries(THREE, geos);
      paintH(g, BONE_RAMP, { normalWeight: 0.5, jitter: 0.18, noise: 0.3 });
      batch.add("ossuary", "bone", g);
    }
  }

  /* ============================================================
     THE GLASS SCAR
     ============================================================ */

  await step("Vitrifying the Glass Scar", 0.60);
  {
    const d = DISTRICTS.scar;
    const rng = makeRng(0x91a55);

    /* --- fulgurite spires, radiating and leaning outward --- */
    {
      const parts = [];
      for (let i = 0; i < 118; i += 1) {
        const a = rng() * TAU;
        const r = 34 + Math.pow(rng(), 0.72) * 230;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        // Everything leans away from the point of impact, which is
        // what makes a crater read as a blast rather than as a hole.
        const outward = 1 - sstep(40, 250, r);
        /* HEIGHT PEAKS IN A BAND, and the count came down by a third.
           The previous pass doubled these because at 5-38m they were
           slivers you had to look for - and overshot into the other
           failure: 190 shards up to 74m tall, tallest at the centre,
           made a hedge. The review frame for this district was a wall
           of teal spikes with no crater visible behind it, which is
           the only place on the map that is over-dressed rather than
           under-dressed.

           Tallest at MID-RADIUS instead of at the impact point. It
           opens the crater floor to be seen into and the outer
           approach to be walked, and it leaves a ring of big glass
           between them - which is a composition rather than a fill.
           Slimmer too: at a 0.28 radius ratio they read as tents. */
        const band = Math.sin(sstep(30, 268, r) * Math.PI);
        const h = rng.range(7, 15) + band * rng.range(11, 36);
        const g = kit.shard(rng, {
          height: h, radius: h * rng.range(0.12, 0.21),
          sides: rng.int(4, 6), sharpness: rng.range(0.6, 0.92), lean: 0,
        });
        place(g, x, z, {
          rot: [
            Math.cos(a + Math.PI / 2) * outward * rng.range(0.15, 0.55),
            rng() * TAU,
            -Math.sin(a + Math.PI / 2) * outward * rng.range(0.15, 0.55),
          ],
          dy: -h * 0.06,
        });
        parts.push(g);
      }
      const g = mergeGeometries(THREE, parts);
      // Biased UP the ramp, not down. The crater faces away from a
      // western sun, so its interior is lit by sky alone; painted
      // dark on top of that the shards vanish into their own
      // shadow and the district reads as a black hole in the map.
      paintH(g, GLASS_RAMP, { normalWeight: 0.55, jitter: 0.2, noise: 0.3, bias: 0.22 });
      batch.add("scar", "glassRock", g);
      pois.push({ id: "scar", name: "The Glass Scar", x: d.x, z: d.z });
    }

    /* --- the mirror floor --- */
    {
      // Terrain is exactly level only inside r=38; the former 54m
      // disk bridged the crater blend and exposed a 6.7m-high rim.
      const R = 36;
      const rings = [];
      for (let i = 0; i <= 3; i += 1) {
        rings.push({ y: i * 0.16, r: R * (1 - i * 0.06), sides: 15, phase: i * 0.2, jitter: 0.05, seed: 3 + i });
      }
      const g = kit.ringSolid(rings);
      const y = field.scarFloorY;
      kit.transform(g, { pos: [d.x, y - 0.4, d.z] });
      paintGeometry(THREE, g, GLASS_RAMP, (x, yy, z) => {
        const rr = Math.hypot(x - d.x, z - d.z) / R;
        return clamp01(0.06 + rr * 0.34 + Math.sin(x * 0.3 + z * 0.21) * 0.07);
      }, { jitter: 0.05 });
      batch.add("scar", "glassRock", g, { castShadow: false });
    }

    /* --- what made the crater --- */
    {
      const parts = [];
      const L = 34;
      // A lance head, half melted, buried nose-first.
      parts.push(kit.ringSolid([
        { y: 0, r: 0.7, sides: 8 },
        { y: L * 0.24, r: 3.4, sides: 8, phase: 0.2, jitter: 0.14, seed: 3 },
        { y: L * 0.55, r: 4.6, sides: 8, phase: 0.4, jitter: 0.16, seed: 5 },
        { y: L * 0.82, r: 3.9, sides: 8, phase: 0.6, jitter: 0.2, seed: 7 },
        { y: L, r: 2.2, sides: 8, phase: 0.8, jitter: 0.3, seed: 9 },
      ]));
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * TAU;
        const fin = kit.slab(0.6, L * 0.5, 3.4, 0.1);
        fin.rotateY(-a);
        fin.translate(Math.cos(a) * 4.0, L * 0.42, Math.sin(a) * 4.0);
        parts.push(fin);
      }
      const g = kit.merge(parts);
      const y = field.scarFloorY;
      kit.transform(g, { pos: [d.x + 4, y - 2, d.z - 6], rot: [0.34, 0.8, 0.22] });
      paintH(g, makeRamp([
        [0, "#120d10"], [0.35, "#33262a"], [0.7, "#6b4a3e"], [1, "#c07a45"],
      ]), { normalWeight: 0.5, jitter: 0.2, noise: 0.32 });
      batch.add("scar", "iron", g);
      emitters.push({ kind: "heat", x: d.x + 4, y: y + 12, z: d.z - 6, scale: 3.0 });
      // The one light source at the bottom of a shadowed hole, so
      // it has to carry the whole interior. Long reach, because
      // the crater floor is 140m across.
      lights.push({
        x: d.x + 4, y: y + 14, z: d.z - 6,
        colour: "#ff7a3a", intensity: 210, distance: 210, kind: "ember", flicker: 0.5,
      });
    }

    /* --- crazing: glass veins radiating out over the sand --- */
    {
      const parts = [];
      for (let i = 0; i < 34; i += 1) {
        const a = rng() * TAU;
        let r = 230;
        let ang = a;
        const pts = [];
        const veinR = rng.range(0.20, 0.42);
        while (r < 430) {
          const x = d.x + Math.cos(ang) * r;
          const z = d.z + Math.sin(ang) * r;
          pts.push([x, H(x, z) - veinR * 0.18, z]);
          // Short chords follow the rendered grade instead of
          // bridging it like a rail between 20m-spaced samples.
          r += rng.range(4, 8);
          ang += rng.jit(0.045);
        }
        if (pts.length > 2) parts.push(kit.tube(pts, veinR, 4, { taper: 0.72 }));
      }
      const g = kit.merge(parts);
      paintH(g, GLASS_RAMP, { normalWeight: 0.4, jitter: 0.2, bias: 0.22 });
      batch.add("scar", "glassRock", g, { castShadow: false });
    }
  }

  /* ============================================================
     THE CENSER WORKS
     ============================================================ */

  await step("Lighting the Censer Works", 0.68);
  {
    const d = DISTRICTS.censer;
    const rng = makeRng(0xce15e);
    const upper = field.censerUpperY;
    const lower = field.censerLowerY;

    const ironRamp = makeRamp([
      [0.00, "#141719"], [0.26, "#292f36"], [0.55, "#454f59"],
      [0.80, "#6d5443"], [1.00, "#a87a4c"],
    ]);

    /* --- flare stacks: the district's identity from 800m --- */
    const stackPos = [[-46, -30, 58], [8, 18, 48], [54, -52, 66]];
    for (const [ox, oz, h] of stackPos) {
      const x = d.x + ox;
      const z = d.z + oz;
      const g = kit.flareStack({ h, base: h * 0.075 });
      place(g, x, z);
      paintH(g, ironRamp, { normalWeight: 0.42, jitter: 0.18, noise: 0.25 });
      batch.add("censer", "iron", g);
      const ty = H(x, z) + h + h * 0.13;
      emitters.push({ kind: "flare", x, y: ty, z, scale: h / 50, light: 1 });
      emitters.push({ kind: "flaresmoke", x, y: ty + h * 0.10, z, scale: h / 46 });
      lights.push({
        x, y: ty, z, colour: "#ff9a44", intensity: 42, distance: 260, kind: "flare",
        flicker: 1,
      });
    }

    /* --- cracking towers ---
       A refinery is DENSE. Four towers and six tanks scattered over
       a 300m terrace read as three masts on an empty plain; the
       thing that makes industry legible at distance is the tangle -
       many verticals of different heights, close enough together
       to overlap. */
    for (let i = 0; i < 13; i += 1) {
      const a = (i / 13) * TAU + 0.7;
      const rr = 46 + (i % 3) * 26;
      const x = d.x + Math.cos(a) * rr + rng.jit(14);
      const z = d.z + Math.sin(a) * rr * 0.82 + rng.jit(14);
      const th = rng.range(20, 44);
      const g = kit.crackingTower(rng, { h: th, r: rng.range(2.6, 4.8), stages: rng.int(2, 4) });
      place(g, x, z, { rot: [0, rng() * TAU, 0] });
      paintH(g, ironRamp, { normalWeight: 0.44, jitter: 0.16, noise: 0.24 });
      batch.add("censer", "iron", g);
      if (i % 3 === 0) emitters.push({ kind: "steam", x, y: H(x, z) + th, z, scale: 1.0 });
    }

    /* --- tanks --- */
    const tankPos = [];
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * TAU + 0.25;
      const r = 96 + (i % 3) * 22;
      const x = d.x + Math.cos(a) * r;
      const z = d.z + Math.sin(a) * r * 0.8;
      tankPos.push([x, z]);
      const tankR = rng.range(6, 10);
      const tankH = rng.range(7, 13);
      const tankYaw = rng() * TAU;
      const g = kit.tank({ r: tankR, h: tankH, ribs: 12 });
      place(g, x, z, { rot: [0, tankYaw, 0], dy: -0.22 });
      paintH(g, ironRamp, { normalWeight: 0.46, jitter: 0.16, noise: 0.22 });
      batch.add("censer", "iron", g);

      // Every tank wears a skull boss and a banner. The Concord does
      // not build a machine it does not also sanctify.
      const boss = kit.skull({ size: 2.4 });
      const bossA = rng() * TAU;
      boss.rotateY(Math.PI / 2 - bossA);
      boss.translate(
        x + Math.cos(bossA) * tankR * 0.98,
        H(x, z) + tankH * 0.52,
        z + Math.sin(bossA) * tankR * 0.98
      );
      paintH(boss, makeRamp([[0, "#5c4a22"], [1, "#e0bf72"]]), { normalWeight: 0.5, jitter: 0.12 });
      batch.add("censer", "gold", boss);
    }

    /* --- pipe runs linking everything, elevated on trestles --- */
    {
      const parts = [];
      const nodes = tankPos.concat(stackPos.map(([ox, oz]) => [d.x + ox, d.z + oz]));
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        const b = nodes[(i + 1) % nodes.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const invLen = 1 / Math.max(0.001, Math.hypot(dx, dz));
        const nx = -dz * invLen;
        const nz = dx * invLen;
        const pts = [];
        const steps = 7;
        for (let k = 0; k <= steps; k += 1) {
          const t = k / steps;
          const x = lerp(a[0], b[0], t);
          const z = lerp(a[1], b[1], t);
          const pipeY = H(x, z) + 5.5 + Math.sin(t * Math.PI) * 1.2;
          pts.push([x, pipeY, z]);
          if (k > 0 && k < steps && k % 2 === 0) {
            const ground = H(x, z) - 0.15;
            const crossY = pipeY - 0.68;
            parts.push(kit.prism({
              h: crossY - ground, rBottom: 0.32, rTop: 0.26, sides: 4,
            }).translate(x, ground, z));
            // One crossarm cradles both the main and offset pipe.
            // Their different radii and 0.2m centre-height offset
            // put both lower surfaces at essentially the same Y.
            parts.push(kit.tube([
              [x - nx * 0.48, crossY, z - nz * 0.48],
              [x + nx * 1.88, crossY, z + nz * 1.88],
            ], 0.16, 4));
          }
        }
        parts.push(kit.tube(pts, 0.55, 6));
        parts.push(kit.tube(pts.map((p) => [
          p[0] + nx * 1.4, p[1] - 0.2, p[2] + nz * 1.4,
        ]), 0.34, 5));
      }
      const g = kit.merge(parts);
      paintH(g, ironRamp, { normalWeight: 0.44, jitter: 0.2, noise: 0.28 });
      batch.add("censer", "rust", g);
    }

    /* --- the retaining wall between terraces --- */
    {
      const parts = [];
      const nx = 0.55;
      const nz = 0.84;
      for (let t = -150; t <= 150; t += 9) {
        const x = d.x + -nz * t;
        const z = d.z + nx * t;
        const w = kit.slab(9.4, upper - lower + 2.2, 3.0, 0.14);
        w.rotateY(-Math.atan2(nx, -nz));
        w.translate(x, lower - 1.2, z);
        parts.push(w);
        if ((t + 150) % 36 === 0) {
          const b = kit.slab(3.0, upper - lower + 4.0, 4.4, 0.2);
          b.rotateY(-Math.atan2(nx, -nz));
          b.translate(x + nx * 2.2, lower - 1.2, z + nz * 2.2);
          parts.push(b);
        }
      }
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#1b1a1c"], [0.5, "#3d3a38"], [1, "#6d6459"]]),
        { normalWeight: 0.44, jitter: 0.14, noise: 0.24 });
      batch.add("censer", "stone", g);
    }

    /* --- catwalks on the lower terrace --- */
    {
      const y = lower + 7.5;
      const run = [
        [d.x - 90, y, d.z + 70], [d.x - 20, y, d.z + 84],
        [d.x + 48, y, d.z + 74], [d.x + 92, y, d.z + 40],
      ];
      const parts = [kit.catwalk(run, { width: 2.0 })];
      for (let i = 0; i < run.length - 1; i += 1) {
        const a = run[i];
        const b = run[i + 1];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const len = Math.hypot(dx, dz);
        const steps = Math.max(1, Math.ceil(len / 13));
        const nx = -dz / len;
        const nz = dx / len;
        for (let k = 0; k <= steps; k += 1) {
          // Do not duplicate the shared station between segments.
          if (i > 0 && k === 0) continue;
          const t = k / steps;
          const px = lerp(a[0], b[0], t);
          const pz = lerp(a[2], b[2], t);
          for (const side of [-1, 1]) {
            const lx = px + nx * side * 0.72;
            const lz = pz + nz * side * 0.72;
            const ground = H(lx, lz) - 0.18;
            const legH = y - ground;
            if (legH > 0.25) {
              parts.push(kit.prism({
                h: legH, rBottom: 0.22, rTop: 0.15, sides: 4,
              }).translate(lx, ground, lz));
            }
          }
        }
      }
      const g = kit.merge(parts);
      paintH(g, ironRamp, { normalWeight: 0.5, jitter: 0.2 });
      batch.add("censer", "rust", g);
    }

    /* --- spill stains and drum litter --- */
    {
      const geos = [];
      for (let i = 0; i < 90; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.6) * 190;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const g = kit.prism({ h: 1.5, rBottom: 0.52, rTop: 0.52, sides: 8 });
        restOnTerrain(g, x, z, {
          rot: rng.chance(0.6) ? [Math.PI / 2, rng() * TAU, 0] : [0, rng() * TAU, 0],
          embed: 0.08, maxGap: 0.04,
        });
        geos.push(g);
      }
      const g = mergeGeometries(THREE, geos);
      paintH(g, ironRamp, { normalWeight: 0.5, jitter: 0.28, noise: 0.4 });
      batch.add("censer", "rust", g);
    }

    pois.push({ id: "censer", name: "The Censer Works", x: d.x, z: d.z });
  }

  /* ============================================================
     THE CHOIR SPIRES
     ============================================================ */

  await step("Carving the Choir Spires", 0.76);
  {
    const d = DISTRICTS.choir;
    const rng = makeRng(0xc0117);

    // Top end pulled down. A pale rock albedo on a vertical face
    // pointing straight at a 4.75-intensity sun clips to white, and
    // these spires had the highest clipped-pixel count of any shot
    // in the level - the faceting, which is the whole point of
    // them, was disappearing into flat paper.
    const spireRamp = makeRamp([
      [0.00, "#241a20"], [0.24, "#3d2c2e"], [0.52, "#5c4238"],
      [0.78, "#836351"], [1.00, "#a8846a"],
    ]);

    /* --- the needles --- */
    {
      const parts = [];
      const COUNT = 54;
      for (let i = 0; i < COUNT; i += 1) {
        // A loose spiral, densest and tallest at the centre.
        const t = i / COUNT;
        const a = t * TAU * 3.1 + rng.jit(0.35);
        const r = 22 + Math.pow(t, 0.62) * 270;
        let x = d.x + Math.cos(a) * r;
        let z = d.z + Math.sin(a) * r * 0.9;
        const h = lerp(rng.range(84, 128), rng.range(24, 58), Math.pow(t, 0.7));
        // Slenderness ratio. At h*0.045 these came out as 4m sticks
        // on a 90m shaft and the district read as a stand of dead
        // trees; a wind-carved rock needle is a TOWER, roughly 6:1
        // to 9:1, not 20:1.
        const rad = h * rng.range(0.075, 0.125);
        x = clamp(x, -MAP_HALF + rad + 3, MAP_HALF - rad - 3);
        z = clamp(z, -MAP_HALF + rad + 3, MAP_HALF - rad - 3);

        /* Wind-carved: a stack of drums separated by waists. The
           waists are what make the formation read as eroded rather
           than as extruded, but they cannot pinch to nothing - at
           0.20 of the radius the shaft looked like wire between
           beads. 0.58 to 0.80 reads as undercut stone. */
        const drums = Math.max(2, Math.round(h / rng.range(24, 40)));
        const rings = [];
        let ringPhase = 0;
        for (let k = 0; k <= drums; k += 1) {
          const kt = k / drums;
          const waist = k > 0 && k < drums ? rng.range(0.58, 0.80) : 1;
          // Slow taper, with the last fifth doing most of the work,
          // so the silhouette is a shaft with a head rather than a
          // cone.
          const shrink = lerp(1, 0.34, Math.pow(kt, 2.3));
          ringPhase += rng.jit(0.16);
          rings.push({
            y: kt * h * 0.92,
            r: rad * shrink * rng.range(0.88, 1.12),
            sides: rng.int(6, 9),
            phase: ringPhase,
            cx: rng.jit(rad * 0.22),
            cz: rng.jit(rad * 0.22),
            jitter: 0.13,
            seed: rng.int(1, 1e6),
          });
          if (k < drums) {
            ringPhase += rng.jit(0.16);
            rings.push({
              y: (kt + 0.5 / drums) * h * 0.92,
              r: rad * shrink * waist,
              sides: rng.int(6, 8),
              phase: ringPhase,
              cx: rng.jit(rad * 0.30),
              cz: rng.jit(rad * 0.30),
              jitter: 0.18,
              seed: rng.int(1, 1e6),
            });
          }
        }
        rings.push({ y: h, r: rad * 0.16, sides: 6, phase: ringPhase });
        const g = kit.ringSolid(rings);

        const fallen = rng.chance(0.10);
        restOnTerrain(g, x, z, {
          rot: fallen
            ? [rng.range(1.15, 1.55) * rng.sign(), rng() * TAU, rng.jit(0.5)]
            : [rng.jit(0.10), rng() * TAU, rng.jit(0.10)],
          embed: fallen ? rad * 0.36 : rad * 0.14,
          maxGap: 0.08,
        });
        parts.push(g);
      }
      const g = kit.merge(parts);
      paintH(g, spireRamp, { normalWeight: 0.40, jitter: 0.14, noise: 0.24 });
      batch.add("choir", "rock", g);
      pois.push({ id: "choir", name: "The Choir Spires", x: d.x, z: d.z });
    }

    /* --- shattered ground plates --- */
    {
      const geos = [];
      for (let i = 0; i < 220; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.55) * 300;
        const s = rng.range(0.9, 3.8);
        const x = clamp(d.x + Math.cos(a) * r, -MAP_HALF + s + 2, MAP_HALF - s - 2);
        const z = clamp(d.z + Math.sin(a) * r, -MAP_HALF + s + 2, MAP_HALF - s - 2);
        const corners = rng.int(5, 7);
        const foot = [];
        for (let k = 0; k < corners; k += 1) {
          const ang = (k / corners) * TAU + rng.jit(0.3);
          const rr = s * rng.range(0.6, 1.3);
          foot.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
        }
        const g = kit.polyExtrudeY(foot, 0, rng.range(0.4, 1.6));
        const tiltX = rng.jit(0.25);
        const yaw = rng() * TAU;
        const tiltZ = rng.jit(0.25);
        void tiltX; void tiltZ;
        restOnTerrain(g, x, z, {
          rot: [0, yaw, 0], embed: 0.14, maxGap: 0.05,
        });
        geos.push(g);
      }
      const g = mergeGeometries(THREE, geos);
      paintH(g, spireRamp, { normalWeight: 0.55, jitter: 0.2, noise: 0.3 });
      batch.add("choir", "rock", g);
    }

    /* --- the shrine at the foot of the tallest --- */
    {
      const sx = d.x + 26;
      const sz = d.z - 14;
      const parts = [];
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * TAU;
        const st = kit.statue(rng, {
          h: rng.range(3.2, 4.6), style: "censer",
          broken: rng.chance(0.4) ? rng.range(0.2, 0.6) : 0, plinth: true,
        });
        const px = sx + Math.cos(a) * 11;
        const pz = sz + Math.sin(a) * 11;
        restOnTerrain(st, px, pz, {
          rot: [0, -a + Math.PI / 2, 0], embed: 0.10, maxGap: 0.05,
        });
        parts.push(st);
      }
      const alt = kit.merge([
        kit.slab(5.4, 1.1, 5.4, 0.16),
        kit.slab(4.2, 0.5, 4.2, 0.1).translate(0, 1.1, 0),
        kit.prism({ h: 2.2, rBottom: 1.3, rTop: 1.0, sides: 6 }).translate(0, 1.6, 0),
      ]);
      place(alt, sx, sz);
      parts.push(alt);
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#2c2226"], [0.5, "#5a463f"], [1, "#9c8168"]]),
        { normalWeight: 0.46, jitter: 0.14 });
      batch.add("choir", "stone", g);
      emitters.push({ kind: "fire", x: sx, y: H(sx, sz) + 3.9, z: sz, scale: 0.7, light: 1.0 });
      pois.push({ id: "choir-shrine", name: "The Wind Shrine", x: sx, z: sz });
    }
  }

  /* ============================================================
     THE BLOOM
     ============================================================ */

  await step("Letting the Bloom in", 0.83);
  {
    const d = DISTRICTS.bloom;
    const rng = makeRng(0xb1005);
    const throatX = d.x - 40;
    const throatZ = d.z - 50;
    const clearsThroat = (x, z) => Math.hypot(x - throatX, z - throatZ) < 74;

    /* --- chitin spires ---
       Nearly three times the count and twice the height of the
       first pass. A hive has to read as an INFESTATION from a
       distance: 76 thin thorns scattered over 250m read as gorse,
       and a district whose whole identity is "organic mass against
       hard geometry" cannot afford to be sparse. */
    {
      const parts = [];
      for (let i = 0; i < 210; i += 1) {
        const a = rng() * TAU;
        // Clustered, not uniform. The power puts most of them in
        // the middle and leaves clearings at the edge.
        const r = Math.pow(rng(), 0.75) * 265;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const h = lerp(rng.range(34, 62), rng.range(8, 22), Math.pow(r / 265, 0.6));
        const g = kit.chitinSpire(rng, {
          h, r: h * rng.range(0.085, 0.145),
          segments: rng.int(7, 13), hook: rng.range(0.2, 0.9),
        });
        if (clearsThroat(x, z)) continue;
        place(g, x, z, { rot: [rng.jit(0.16), rng() * TAU, rng.jit(0.16)], dy: -h * 0.03 });
        parts.push(g);
      }
      const g = kit.merge(parts);
      paintH(g, CHITIN_RAMP, { normalWeight: 0.46, jitter: 0.15, noise: 0.28 });
      batch.add("bloom", "chitin", g);
      pois.push({ id: "bloom", name: "The Bloom", x: d.x, z: d.z });
    }

    /* --- membrane sacs, lit from inside --- */
    {
      const shells = [];
      const cores = [];
      for (let i = 0; i < 64; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.6) * 220;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const rad = rng.range(3.0, 9.5);
        const g = kit.membraneSac(rng, { r: rad, h: rad * rng.range(1.4, 2.2) });
        if (clearsThroat(x, z)) continue;
        restOnTerrain(g, x, z, {
          rot: [rng.jit(0.2), rng() * TAU, rng.jit(0.2)],
          embed: rad * 0.18, maxGap: 0.06,
        });
        shells.push(g);

        const core = kit.membraneSac(rng, { r: rad * 0.55, h: rad * 1.1 });
        place(core, x, z, { dy: rad * 0.35 });
        flat(core, rng.chance(0.6) ? PALETTE.bioViolet : PALETTE.bioCyan, 0.3);
        cores.push(core);

        if (i % 16 === 0) {
          lights.push({
            x, y: H(x, z) + rad, z,
            colour: rng.chance(0.6) ? "#a55cf0" : "#4fe6cc",
            // Sized for NIGHT, when these are the only light in the
            // district. At golden hour they are invisible against
            // the sun and cost nothing; at 6.5 they were invisible
            // at night too, which made them pointless at every hour.
            intensity: 34, distance: 92, kind: "spore", flicker: 0.4,
          });
        }
        // A haze around a FEW of the bigger pods. Every large pod
        // getting one put thirty overlapping additive systems in
        // one district.
        if (rad > 8.2 && i % 3 === 0) {
          emitters.push({
            kind: "spore", x, y: H(x, z) + rad * 0.6, z, scale: rad * 0.16, rate: 0.5,
          });
        }
      }
      const sg = kit.merge(shells);
      // Violet, not crimson. A pink-red membrane under a warm sun
      // reads as raw meat and, worse, as the same hue family as the
      // sand it is sitting on - the Bloom's entire job is to be the
      // one cold-chromatic thing on the map.
      paintH(sg, makeRamp([
        [0, "#26173a"], [0.4, "#4d2b62"], [0.72, "#8a4a86"], [1, "#c58fc4"],
      ]), { normalWeight: 0.5, jitter: 0.18 });
      batch.add("bloom", "chitin", sg);
      batch.add("bloom", "emissive", kit.merge(cores), { castShadow: false, receiveShadow: false });
    }

    /* --- webbing strung between spires ---
       Short spans only. A first pass allowed a 90-degree swing of
       azimuth AND an 80m radial jump, which strung single strands
       right across the district - a hard blue wire running the full
       width of the frame, which reads as a rendering error rather
       than as biology. --- */
    {
      const parts = [];
      for (let i = 0; i < 70; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.6) * 220;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const a2 = a + rng.jit(0.22);
        const r2 = r + rng.range(-22, 22);
        const x2 = d.x + Math.cos(a2) * r2;
        const z2 = d.z + Math.sin(a2) * r2;
        const y0 = H(x, z) + rng.range(6, 20);
        const y1 = H(x2, z2) + rng.range(6, 20);
        const pts = [];
        for (let k = 0; k <= 6; k += 1) {
          const t = k / 6;
          pts.push([
            lerp(x, x2, t),
            lerp(y0, y1, t) - Math.sin(t * Math.PI) * rng.range(2, 7),
            lerp(z, z2, t),
          ]);
        }
        parts.push(kit.tube(pts, rng.range(0.10, 0.28), 3));
      }
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#2e2138"], [1, "#6b5480"]]), { normalWeight: 0.4, jitter: 0.2 });
      batch.add("bloom", "chitin", g, { castShadow: false });
    }

    /* --- the throat: the pit at the centre --- */
    {
      const parts = [];
      const px = throatX;
      const pz = throatZ;
      const py = H(px, pz);
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * TAU;
        const g = kit.chitinSpire(rng, {
          h: rng.range(14, 30), r: rng.range(1.6, 3.2), segments: 8, hook: 0.9,
        });
        const x = px + Math.cos(a) * 34;
        const z = pz + Math.sin(a) * 34;
        // Leaning inward over the pit, like a mouth.
        restOnTerrain(g, x, z, {
          rot: [Math.cos(a) * 0.45, rng() * TAU, -Math.sin(a) * 0.45],
          embed: 0.35, maxGap: 0.06,
        });
        parts.push(g);
      }
      const g = kit.merge(parts);
      paintH(g, CHITIN_RAMP, { normalWeight: 0.44, jitter: 0.16, bias: -0.1 });
      batch.add("bloom", "chitin", g);
      emitters.push({ kind: "spore", x: px, y: py + 4, z: pz, scale: 3.2, rate: 1 });
      lights.push({
        x: px, y: py + 8, z: pz, colour: "#8c46e0",
        intensity: 95, distance: 160, kind: "spore", flicker: 0.5,
      });
      pois.push({ id: "bloom-throat", name: "The Throat", x: px, z: pz });
    }
  }

  /* ============================================================
     THE FOSSE
     ============================================================ */

  await step("Digging in along the Fosse", 0.89);
  {
    const rng = makeRng(0xf0553);
    const prof = field.fosseProfile;
    const bagGeos = [];
    const woodGeos = [];
    const ironGeos = [];

    for (let i = 4; i < prof.length - 4; i += 3) {
      const a = prof[i];
      const b = prof[i + 1];
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      // Parapet sandbags on the enemy side only, which is what
      // tells the player which way the line faced.
      const off = 11;
      const px = a.x - Math.sin(-yaw) * off;
      const pz = a.z - Math.cos(-yaw) * off;
      if (rng.chance(0.22)) continue;
      const bagLength = rng.range(7, 13);
      const g = kit.sandbagWall(rng, { length: bagLength, courses: rng.int(2, 4) });
      restOnTerrain(g, px, pz, {
        rot: [0, -yaw, 0], embed: 0.22, maxGap: 0.05,
      });
      bagGeos.push(g);

      // Duckboards in the trench floor.
      if (i % 6 === 0) {
        const d2 = kit.slab(4.5, 0.16, 2.6, 0.03);
        d2.rotateY(-yaw);
        d2.translate(a.x, a.y - 4.5, a.z);
        woodGeos.push(d2);
      }
    }

    // Wire, on the far side of the parapet.
    for (let i = 6; i < prof.length - 6; i += 9) {
      const a = prof[i];
      const b = prof[i + 1];
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      const off = 21;
      const px = a.x - Math.sin(-yaw) * off;
      const pz = a.z - Math.cos(-yaw) * off;
      const g = kit.wireRun(rng, { length: 14, height: 1.2, coils: 20 });
      placeOnTerrain(g, px, pz, {
        yaw: -yaw, sample: 7, dy: -0.08, maxTilt: 0.34,
      });
      ironGeos.push(g);
    }

    // Bunkers.
    for (let i = 12; i < prof.length - 12; i += 34) {
      const a = prof[i];
      const b = prof[i + 1];
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      const off = 15;
      const px = a.x - Math.sin(-yaw) * off;
      const pz = a.z - Math.cos(-yaw) * off;
      const g = kit.bunker({ w: rng.range(7, 10), d: rng.range(5, 7), h: 3.0 });
      restOnTerrain(g, px, pz, {
        rot: [0, -yaw + Math.PI, 0], embed: 1.0, maxGap: 0.05,
      });
      const painted = paintH(g, makeRamp([
        [0, "#1c1a1b"], [0.4, "#3a3733"], [0.75, "#66604f"], [1, "#948a6f"],
      ]), { normalWeight: 0.46, jitter: 0.14, noise: 0.26 });
      batch.add("fosse", "stone", painted);
      // A skull over the embrasure. There is always a skull.
      const sk = kit.skull({ size: 0.85 });
      sk.rotateY(-yaw + Math.PI);
      sk.translate(px, g.userData.restY + 3.4, pz);
      paintH(sk, makeRamp([[0, "#6a5a2c"], [1, "#e6c47c"]]), { normalWeight: 0.5 });
      batch.add("fosse", "gold", sk);
    }

    if (bagGeos.length) {
      const g = mergeGeometries(THREE, bagGeos);
      paintH(g, makeRamp([[0, "#5a4433"], [0.45, "#8a6c4c"], [1, "#bfa079"]]),
        { normalWeight: 0.5, jitter: 0.2, noise: 0.3 });
      batch.add("fosse", "cloth", g);
    }
    if (woodGeos.length) {
      const g = mergeGeometries(THREE, woodGeos);
      paintH(g, makeRamp([[0, "#3a2b20"], [1, "#7b5d42"]]), { normalWeight: 0.5, jitter: 0.2 });
      batch.add("fosse", "rust", g);
    }
    if (ironGeos.length) {
      const g = mergeGeometries(THREE, ironGeos);
      paintH(g, makeRamp([[0, "#22242a"], [1, "#6b7078"]]), { normalWeight: 0.5, jitter: 0.2 });
      batch.add("fosse", "iron", g);
    }

    pois.push({ id: "fosse", name: "The Fosse", x: 64, z: 428 });
  }

  /* ============================================================
     THE GILDED REACH
     Deliberately the emptiest district. A large map needs one
     place where nothing happens, or the busy places stop reading
     as busy.
     ============================================================ */

  await step("Combing the Gilded Reach", 0.93);
  {
    const d = DISTRICTS.reach;
    const rng = makeRng(0x91d3d);

    /* --- the singing vanes --- */
    {
      const masts = [];
      const sails = [];
      for (let i = 0; i < 17; i += 1) {
        // A line marching across the dunes, perpendicular to the
        // wind, so they read as deliberate rather than scattered.
        const t = i / 16;
        const x = d.x - 300 + t * 620 + rng.jit(40);
        const z = d.z - 190 + t * 300 + rng.jit(60);
        const h = rng.range(14, 26);
        masts.push(kit.merge([
          // Terrain-conforming foundation: the visible 1.5m plinth
          // can cross a dune shoulder, but its underside cannot.
          kit.prism({ h: 2.6, rBottom: 1.5, rTop: 1.35, sides: 6 }).translate(0, -2.6, 0),
          kit.prism({ h, rBottom: 0.42, rTop: 0.22, sides: 6, segments: 2 }),
          kit.prism({ h: 1.1, rBottom: 1.5, rTop: 1.2, sides: 6 }),
        ]).translate(x, H(x, z) - 0.08, z));
        // Sail blades: four thin vanes on a hub near the top.
        for (let k = 0; k < 4; k += 1) {
          const a = (k / 4) * TAU + rng.jit(0.2);
          const blade = kit.slab(0.14, 5.4, 1.7, 0.03);
          blade.translate(0, 0, 0);
          blade.rotateX(a);
          blade.rotateY(0.35);
          blade.translate(x, H(x, z) + h - 1.6, z);
          sails.push(blade);
        }
      }
      const mg = kit.merge(masts);
      paintH(mg, makeRamp([[0, "#3b2c22"], [0.6, "#7b6046"], [1, "#b0906c"]]),
        { normalWeight: 0.46, jitter: 0.16 });
      batch.add("reach", "rust", mg);
      const sg = kit.merge(sails);
      paintH(sg, makeRamp([[0, "#7d3a2c"], [0.5, "#c07a4a"], [1, "#e8c384"]]),
        { normalWeight: 0.55, jitter: 0.2 });
      batch.add("reach", "cloth", sg);
      pois.push({ id: "reach", name: "The Gilded Reach", x: d.x, z: d.z });
    }

    /* --- the drowned procession: statues buried to the chin --- */
    {
      const parts = [];
      for (let i = 0; i < 26; i += 1) {
        const a = rng() * TAU;
        const r = Math.pow(rng(), 0.5) * 420;
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        const h = rng.range(9, 17);
        const g = kit.statue(rng, {
          h, style: rng.pick(["sword", "book", "banner"]),
          broken: rng.chance(0.5) ? rng.range(0.1, 0.45) : 0,
          plinth: false, halo: rng.chance(0.3),
        });
        // Buried between 45% and 88% - only the shoulders and hood
        // above the sand. The variation is what makes it read as a
        // slow drowning rather than as a row of half-height props.
        const sink = h * rng.range(0.45, 0.88);
        place(g, x, z, {
          rot: [rng.jit(0.3), rng() * TAU, rng.jit(0.3)],
          dy: -sink,
        });
        parts.push(g);
      }
      const g = kit.merge(parts);
      paintH(g, makeRamp([[0, "#5a4436"], [0.4, "#8b6c53"], [0.75, "#b8946f"], [1, "#dcbc8e"]]),
        { normalWeight: 0.48, jitter: 0.15, noise: 0.24 });
      batch.add("reach", "stone", g);
    }

    /* --- a processional arch, drowned to its springing --- */
    {
      const archSpec = { width: 26, height: 40, depth: 7.5, thickness: 4.0, rise: 1.05 };
      const g = kit.gothicArch(archSpec);
      const ax = d.x + 176;
      const az = d.z - 92;
      const springY = kit.archOutline(
        archSpec.width, archSpec.height, archSpec.thickness, archSpec.rise
      ).springY;
      placeOnTerrain(g, ax, az, {
        yaw: 1.05, sample: 14, dy: -springY, maxTilt: 0.38,
      });
      paintH(g, makeRamp([[0, "#4c382f"], [0.45, "#82644d"], [1, "#c6a179"]]),
        { normalWeight: 0.44, jitter: 0.14, noise: 0.22 });
      batch.add("reach", "stone", g);
      pois.push({ id: "reach-arch", name: "The Drowned Arch", x: ax, z: az });
    }

    /* --- a wrecked sand-crawler --- */
    {
      const parts = [];
      parts.push(kit.slab(16, 5.2, 7.5, 0.6));
      parts.push(kit.slab(7.5, 3.4, 6.6, 0.4).translate(5.6, 5.2, 0));
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i += 1) {
          const wheel = kit.prism({ h: 1.4, rBottom: 1.55, rTop: 1.55, sides: 9 });
          wheel.rotateZ(Math.PI / 2);
          wheel.translate(-6 + i * 4, 1.4, s * 4.2);
          parts.push(wheel);
        }
      }
      const g = kit.merge(parts);
      const wx = d.x - 210;
      const wz = d.z + 148;
      // The wreck lies on one of the Reach's steepest faces. The
      // previous 20-degree clamp forced the chassis almost level,
      // leaving one wheel line metres in the air and burying the
      // opposite line. Allow the rigid wreck to follow the actual
      // local grade and sink the tyres a touch into the sand.
      placeOnTerrain(g, wx, wz, {
        yaw: 2.1, sample: 9, dy: -0.12, maxTilt: 1.05,
      });
      paintH(g, makeRamp([[0, "#241f1c"], [0.4, "#4a4038"], [0.75, "#7d6a52"], [1, "#a89272"]]),
        { normalWeight: 0.48, jitter: 0.18, noise: 0.3 });
      batch.add("reach", "rust", g);
      pois.push({ id: "reach-crawler", name: "Wreck of the CONSTANT PENANCE", x: wx, z: wz });
    }
  }

  /* ============================================================
     SCATTER
     Small rock everywhere, keyed to the surface classifier so it
     never puts sandstone chips on the bone pan.
     ============================================================ */

  /* ============================================================
     YARDANGS - the basin between the districts

     A review of all 21 authored poses found the districts
     themselves in good shape and the GROUND BETWEEN THEM empty:
     `fosse`, `reach` and the road corridor were each most of a frame
     of open dune with the nearest built thing on the horizon. The
     level had detail at 0-3m (3,400 scatter crags, none over 2.8m)
     and detail at 400m+ (the districts), and nothing in between.

     Yardangs are the answer a desert gives: wind-carved rock fins,
     streamlined along the prevailing wind, standing alone on open
     sand. They are the right fix here for three reasons - they are
     BIG enough to read as a destination from half a kilometre, there
     are FEW enough (fifteen across four square kilometres) that they
     can never become clutter, and they carry the same wind bearing
     as the sand ripples, so the desert reads as one weather system
     rather than as a set of props.

     Sited by rejection: open sand only, never inside a district,
     never near the road, and never within 210m of each other. A
     landmark you can see two of at once is scenery; one at a time is
     a landmark.
     ============================================================ */
  await step("Carving the yardangs", 0.945);
  {
    const rng = makeRng(0x7a4da9);
    const WIND = Math.atan2(0.947, 0.322);      // matches the ripples
    const placed = [];
    const geos = [];

    const nearRoad = (x, z) => {
      let best = Infinity;
      for (let i = 0; i < ROAD_PATH.length - 1; i += 1) {
        const [ax, az] = ROAD_PATH[i];
        const [bx, bz] = ROAD_PATH[i + 1];
        const vx = bx - ax;
        const vz = bz - az;
        const t = Math.max(0, Math.min(1,
          ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
        best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
      }
      return best;
    };

    let tries = 0;
    while (placed.length < 15 && tries < 4000) {
      tries += 1;
      const x = rng.range(-MAP_HALF + 190, MAP_HALF - 190);
      const z = rng.range(-MAP_HALF + 190, MAP_HALF - 190);

      const surf = field.surfaceAt(x, z);
      if (surf.sand < 0.72) continue;
      if (nearRoad(x, z) < 78) continue;
      let inDistrict = false;
      for (const d of Object.values(DISTRICTS)) {
        if (Math.hypot(x - d.x, z - d.z) < d.r * 0.92) { inDistrict = true; break; }
      }
      if (inDistrict) continue;
      let tooClose = false;
      for (const p of placed) {
        if (Math.hypot(x - p[0], z - p[1]) < 210) { tooClose = true; break; }
      }
      if (tooClose) continue;
      // Not on a slip face: a fin standing on 30 degrees of loose
      // sand reads as dropped in rather than as carved out.
      const slope = Math.hypot(
        (H(x + 6, z) - H(x - 6, z)) / 12, (H(x, z + 6) - H(x, z - 6)) / 12
      );
      if (slope > 0.26) continue;

      const h = rng.range(17, 41);
      const len = h * rng.range(3.4, 5.6);      // streamlined, not a stack
      const wid = h * rng.range(0.72, 1.15);
      const rings = [];
      // Fifteen objects in the whole level, so they can afford to
      // be properly rounded - a 40m landmark built on 7 sides reads
      // as a tent from the side it is not facing.
      const LEVELS = 9;
      for (let k = 0; k <= LEVELS; k += 1) {
        const t = k / LEVELS;
        /* A yardang is a blunt prow and a drawn-out tail, undercut
           at the base where the wind carries the most sand. The
           waist at t≈0.22 is that undercut; without it the shape is
           a loaf. */
        const taper = Math.cos(t * Math.PI * 0.5) ** 0.62;
        // Parenthesised deliberately: `-x ** 2` is a SyntaxError in
        // JS, and it takes the whole module out at parse time.
        const undercut = 1 - 0.16 * Math.exp(-(((t - 0.20) / 0.13) ** 2));
        const prow = 1 - 0.34 * t;               // the tail lifts less
        rings.push({
          y: t * h,
          rx: len * 0.5 * taper * prow * undercut,
          rz: wid * 0.5 * taper * undercut,
          // Drifting backwards as it rises gives the fin a lean into
          // the wind, which is what makes it read as carved BY
          // something rather than merely eroded.
          cx: -len * 0.16 * t * t,
          sides: 9,
          phase: t * 1.7,
        });
      }
      const g = kit.ringSolid(rings, { capBottom: false });
      kit.roughen(g, h * 0.035, 0.045);
      place(g, x, z, {
        rot: [0, WIND + rng.jit(0.22), 0],
        dy: -h * 0.10,
      });
      paintH(g, ROCK_RAMP, {
        normalWeight: 0.55, jitter: 0.18, noise: 0.3, bias: 0.1,
      });
      geos.push(g);
      placed.push([x, z]);
    }
    if (geos.length) {
      batch.add("scatter", "rock", mergeGeometries(THREE, geos), { castShadow: true });
    }
  }

  await step("Scattering", 0.96);
  {
    const rng = makeRng(0x5ca77e);
    const perBucket = new Map();
    for (let i = 0; i < 3400; i += 1) {
      const x = rng.range(-MAP_HALF + 40, MAP_HALF - 40);
      const z = rng.range(-MAP_HALF + 40, MAP_HALF - 40);
      const surf = field.surfaceAt(x, z);
      let mat = "rock";
      let ramp = ROCK_RAMP;
      if (surf.bone > 0.5) { mat = "bone"; ramp = BONE_RAMP; }
      else if (surf.glass > 0.5) { mat = "glassRock"; ramp = GLASS_RAMP; }
      else if (surf.chitin > 0.5) { mat = "chitin"; ramp = CHITIN_RAMP; }
      else if (surf.ash > 0.5) { mat = "rust"; ramp = ASH_RAMP; }
      else if (surf.basalt > 0.4) { mat = "basalt"; ramp = BASALT_RAMP; }
      else if (surf.sand > 0.86 && rng.chance(0.72)) continue;   // keep the dunes clean

      const s = Math.pow(rng(), 2.1) * 2.6 + 0.22;
      const g = kit.crag(rng, {
        height: s * rng.range(0.5, 1.3), radius: s,
        layers: 3, sides: rng.int(5, 7), lean: rng.range(0, 0.4), sink: 0.4,
      });
      const tiltX = rng.jit(0.35);
      const yaw = rng() * TAU;
      const tiltZ = rng.jit(0.35);
      void tiltX; void tiltZ;
      place(g, x, z, { rot: [0, yaw, 0], dy: -0.14 });
      paintH(g, ramp, { normalWeight: 0.5, jitter: 0.22, noise: 0.35 });
      if (!perBucket.has(mat)) perBucket.set(mat, []);
      perBucket.get(mat).push(g);
    }
    for (const [mat, geos] of perBucket) {
      batch.add("scatter", mat, mergeGeometries(THREE, geos), { castShadow: true });
    }
  }

  /* ============================================================
     FLUSH
     ============================================================ */

  await step("Settling", 0.99);
  const meshes = batch.flush();

  /* Point lights. Kept few and short-range: this renderer has no
     clustered lighting, so every point light is a per-fragment cost
     on EVERY material in the scene, whether or not it is in range.
     Twelve is the ceiling; the flare stacks, the plaza braziers and
     the Bloom's pods are the ones that earn their place. */
  const lightObjects = [];
  for (const spec of lights.slice(0, 12)) {
    const l = new THREE.PointLight(
      new THREE.Color(spec.colour), spec.intensity, spec.distance, 2
    );
    l.position.set(spec.x, spec.y, spec.z);
    l.userData.spec = spec;
    l.userData.baseIntensity = spec.intensity;
    root.add(l);
    lightObjects.push(l);
  }

  /* ============================================================
     BEAUTY SHOTS
     Fixed camera poses for the review harness. Each one is a claim
     about the level: if a district cannot hold a composed frame,
     it is not finished.
     ============================================================ */

  const T = DISTRICTS.threshold;
  const beautyShots = [
    {
      id: "establishing",
      name: "The Threshold, looking north",
      // ON the crest, not behind it. Set back at z+74 the ridge
      // itself filled the lower half of the frame and the entire
      // level was hidden behind the thing you were standing on.
      position: [10, H(10, T.z + 6) + 13, T.z + 6],
      target: [-24, 62, -380],
      fov: 64,
    },
    {
      id: "road",
      name: "The Pilgrim's Road",
      position: [-6, H(-6, 430) + 6.5, 430],
      target: [-40, 30, -180],
      fov: 55,
    },
    {
      id: "saint-face",
      name: "The Fallen Saint",
      // South-west of the head: the side the face is turned to, the
      // side the road arrives from, and the side the sun is on.
      position: [-152, H(-152, 176) + 22, 176],
      target: [6, H(6, 18) + 44, 6],
      fov: 50,
    },
    {
      id: "saint-scale",
      name: "The Saint, from the camp",
      /* Eye height, with the tents and braziers in the near field.
         A colossus photographed from the air has no scale; a
         colossus with a 2m tent in front of it has nothing else.

         MOVED, and the move is measured rather than nudged. At
         (-58, 104) the ground rises 32.6 degrees above the camera's
         horizon TEN METRES in front of it, against a target sitting
         at 28.7 - a margin of MINUS 3.9 degrees, which is a
         photograph of the inside of a dune. It had been in the
         review suite in that state, signed off as a picture of the
         Saint, for as long as the terrain has been in its current
         shape. `scripts/saintfall-pose-sightline.mjs` walks the
         ground profile and reports that margin; this position
         measures +12.5 degrees and still stands 43m from the camp,
         so the tents keep their job in the near field. */
      position: [-78, H(-78, 112) + 1.7, 112],
      target: [4, H(6, 18) + 56, 10],
      fov: 52,
    },
    {
      id: "saint-hand",
      name: "The Reaching Hand",
      position: [300, H(300, -120) + 8, -120],
      target: [232, 22, -196],
      fov: 52,
    },
    {
      id: "cathedral-front",
      name: "Vault-Cathedral, west front",
      // The target height is ABSOLUTE, and the plaza sits on a 52m
      // mesa - an authored value of 78 pointed the camera at the
      // building's ankles and cropped the spire out of frame
      // entirely.
      position: [-52, field.cathedralPlazaY + 13, -498],
      target: [-95, field.cathedralPlazaY + 74, -700],
      fov: 56,
    },
    {
      id: "cathedral-nave",
      name: "Inside the nave, looking back at the rose",
      // Standing in the nave looking SOUTH at the rose window. The
      // other way round is a view of a hole in a dark wall; this way
      // the window is the light source in shot and the shafts run
      // toward the camera, which is the only reason to be in here.
      position: [-95, field.cathedralPlazaY + 4.2, -770],
      target: [-95, field.cathedralPlazaY + 28, -640],
      fov: 66,
    },
    {
      id: "cathedral-flank",
      name: "The buttress walk",
      position: [10, field.cathedralPlazaY + 9, -706],
      target: [-90, field.cathedralPlazaY + 40, -742],
      fov: 54,
    },
    {
      id: "ossuary",
      name: "The Ossuary",
      // Off the long axis of the animal, so the cage reads as a
      // cage rather than end-on as a row of arches.
      position: [880, H(880, -400) + 26, -400],
      target: [600, 40, -680],
      fov: 52,
    },
    {
      id: "ossuary-inside",
      name: "Under the ribs",
      position: [665, H(665, -600) + 2.4, -600],
      target: [600, 40, -700],
      fov: 66,
    },
    {
      id: "scar",
      name: "The Glass Scar",
      // ON the crater rim, looking down into it. From 285m out on
      // the outer slope the 27m rim hides the entire hole and the
      // shot is a picture of a dune.
      position: [816, H(816, 292) + 16, 292],
      target: [786, field.scarFloorY + 6, 95],
      fov: 60,
    },
    {
      id: "scar-floor",
      name: "The crater floor",
      // Placed by sampling the ground rather than by assuming the
      // flattened floor extends this far - the harness caught this
      // one 14m UNDER the terrain.
      position: [724, H(724, 150) + 7, 150],
      target: [800, field.scarFloorY + 26, 84],
      fov: 62,
    },
    {
      id: "censer",
      name: "The Censer Works",
      position: [468, H(468, 632) + 22, 632],
      target: [660, H(660, 700) + 40, 700],
      fov: 54,
    },
    {
      id: "choir",
      name: "The Choir Spires",
      position: [-540, H(-540, -50) + 36, -50],
      target: [-830, 74, -100],
      fov: 52,
    },
    {
      id: "choir-floor",
      name: "Among the needles",
      position: [-790, H(-790, -30) + 2.0, -30],
      target: [-840, 70, -120],
      fov: 70,
    },
    {
      id: "bloom",
      name: "The Bloom",
      position: [-436, H(-436, -486) + 26, -486],
      target: [-670, H(-670, -660) + 34, -664],
      fov: 54,
    },
    {
      id: "bloom-throat",
      name: "The Throat",
      position: [-620, H(-620, -640) + 12, -640],
      target: [-695, H(-695, -705) + 14, -705],
      fov: 62,
    },
    {
      id: "reach",
      name: "The Gilded Reach",
      position: [-380, H(-380, 700) + 8, 700],
      target: [-640, 18, 520],
      fov: 50,
    },
    {
      id: "fosse",
      name: "The Fosse",
      position: [40, H(40, 470) + 2.0, 470],
      target: [-320, 20, 380],
      fov: 62,
    },
    {
      id: "vista-north",
      name: "The basin from the north rim",
      position: [-40, H(-40, -960) + 90, -960],
      target: [0, 20, 200],
      fov: 60,
    },
    {
      id: "vista-east",
      name: "The basin from the east",
      position: [960, H(960, 60) + 96, 60],
      target: [-100, 30, -120],
      fov: 58,
    },
  ];

  return {
    group: root,
    meshes,
    lights: lightObjects,
    emitters,
    banners,
    pois,
    beautyShots,
    walkSurfaceAt,
    getBeautyShots: () => beautyShots,
    stats() {
      let tris = 0;
      for (const m of meshes) {
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      }
      return { meshes: meshes.length, triangles: Math.round(tris), lights: lightObjects.length };
    },
  };
}
