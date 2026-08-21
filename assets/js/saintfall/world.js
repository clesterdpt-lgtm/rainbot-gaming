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
  paintByHeight, paintFlat, paintGeometry, patchMaterial, srgbTransfer as srgb,
} from "saintfall/art.js";
import { makeKit, mergeGeometries, cleanGeometry } from "saintfall/structures.js";
import {
  DISTRICTS, ROAD_PATH, FOSSE_PATH, MAP_HALF, DROP_SITE,
  CHUNK_SIZE, LOD_CELLS, GARNER_PIT, MATRIARCH_ARENA, STYLITE_ARENA,
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
        /* See collide.js's own rasterMesh comment: a triangle whose
           XZ footprint is under half a metre is dropped as clutter
           UNLESS the mesh opts out of that filter here. A finely
           subdivided hull - a rock arch's legs, sixty rings of it -
           is built from exactly that many small triangles even
           though the assembled shape stands metres tall, and every
           one of them individually failed the footprint test: the
           collider registered a few stray slivers and nothing else,
           while the render mesh stood there solid. */
        if (bin.opts.collisionSolid) mesh.userData.collisionSolid = true;
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
  const { THREE, scene, terrain, atmos } = ctx;
  const kit = makeKit(THREE);
  const field = terrain.field;
  const H = (x, z) => field.heightAt(x, z);

  const root = new THREE.Group();
  root.name = "world";
  scene.add(root);
  const batch = makeBatcher(ctx, root);

  /* The approved Meshy landmarks own both their visible silhouette and
     their collision silhouette. Keeping the old procedural objects as
     hidden proxies looked harmless, but their shapes diverge sharply at
     this scale: the old head reached tens of metres beyond the new veil,
     which left solid walls in visibly empty sand. The collision raster
     still reduces these detailed surfaces to one-metre cells, so the
     player's normal radius provides a stable contact margin without a
     second, drifting version of each object. */
  const authoredMeshes = [];
  const authoredLandmarks = [];
  const landmarkSources = Object.create(null);
  const landmarkAssetsReady = (async () => {
    const specs = [
      ["fallenSaintHead", "fallen-saint-head-veiled-oracle.glb"],
      ["fallenSaintHand", "fallen-saint-hand-benediction.glb"],
      ["gildedReachCross", "gilded-reach-choir-wheel.glb"],
    ];
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      await Promise.all(specs.map(async ([key, file]) => {
        const url = new URL(`../../../assets/models/saintfall/meshy/${file}`, import.meta.url);
        if (ctx.build) url.searchParams.set("v", ctx.build);
        try {
          const gltf = await loader.loadAsync(url.href);
          const source = gltf.scene;
          source.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(source);
          const size = box.getSize(new THREE.Vector3());
          if (!(size.y > 1e-6)) throw new Error("model has no measurable height");
          const seenMaterials = new Set();
          source.traverse((node) => {
            if (!node.isMesh) return;
            const list = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of list) {
              if (!material || seenMaterials.has(material)) continue;
              seenMaterials.add(material);
              material.envMapIntensity = 0.82;
              patchMaterial(material, atmos, { rim: 0.78, glitter: 0 });
            }
          });
          landmarkSources[key] = { source, box, size };
        } catch (error) {
          console.warn(`[saintfall] landmark "${key}" failed to load; using procedural fallback`, error);
        }
      }));
    } catch (error) {
      console.warn("[saintfall] landmark loader unavailable; using procedural fallbacks", error);
    }
  })();

  const addAuthoredLandmark = (asset, opts) => {
    const pivot = new THREE.Group();
    pivot.name = opts.name;
    pivot.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
    if (opts.rotOrder) pivot.rotation.order = opts.rotOrder;
    if (opts.rot) pivot.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);

    const fitted = new THREE.Group();
    const visual = asset.source.clone(true);
    const scale = opts.height / asset.size.y;
    fitted.scale.setScalar(scale);
    fitted.position.set(
      -((asset.box.min.x + asset.box.max.x) * 0.5) * scale,
      -asset.box.min.y * scale,
      -((asset.box.min.z + asset.box.max.z) * 0.5) * scale
    );
    fitted.add(visual);
    pivot.add(fitted);

    const meshes = [];
    visual.traverse((node) => {
      if (!node.isMesh) return;
      node.name = `${opts.name}-mesh`;
      node.castShadow = true;
      node.receiveShadow = true;
      node.userData.district = opts.district;
      /* Meshy triangulates curved panels finely enough that most faces
         are smaller than collide.js's ordinary clutter threshold. This
         tag keeps those faces as one structural surface; collision is
         now baked from the same transformed vertices the player sees. */
      node.userData.collisionSolid = true;
      node.userData.authoredLandmark = opts.key;
      authoredMeshes.push(node);
      meshes.push(node);
    });
    root.add(pivot);

    let terrainSeat = null;
    if (opts.seatOnTerrain) {
      /* Seat the transformed MODEL, not its unrotated bounding box. The
         Choir wheel has a 7-10m square footing at its authored sizes,
         so a centre-point height leaves its downhill corners hanging in
         open air. Fallen versions make that failure larger: their lower
         envelope runs along the monument's side after the tilt.

         The support calculation mirrors `restOnTerrain`, but operates on
         an Object3D hierarchy. It runs after yaw/lean/scale, samples every
         vertex in the transformed lower band, and chooses the lowest
         required seat. `embed` then keeps even the lowest support below
         the sand instead of exposing a flat underside from a low camera. */
      pivot.position.y = 0;
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot);
      const lowBand = box.min.y + Math.max(0.12, (box.max.y - box.min.y) * 0.18);
      const supports = [];
      const point = new THREE.Vector3();
      for (const mesh of meshes) {
        const pos = mesh.geometry?.attributes?.position;
        if (!pos) continue;
        for (let i = 0; i < pos.count; i += 1) {
          point.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          if (point.y <= lowBand) supports.push(H(point.x, point.z) - point.y);
        }
      }
      if (!supports.length) supports.push(H(opts.pos[0], opts.pos[2]) - box.min.y);
      supports.sort((a, b) => a - b);
      const quantile = opts.seatOnTerrain.quantile ?? 0.35;
      const qi = Math.floor((supports.length - 1) * quantile);
      const maxGap = opts.seatOnTerrain.maxGap ?? 0;
      const embed = opts.seatOnTerrain.embed ?? 0.10;
      const y = Math.min(supports[qi], supports[0] + maxGap) - embed;
      pivot.position.y = y;
      pivot.updateMatrixWorld(true);
      terrainSeat = {
        supportCount: supports.length,
        y,
        maxGap: y - supports[0],
        embed,
      };
    }

    const placement = {
      variant: opts.variant || "upright",
      targetHeight: opts.height,
      yaw: opts.rot?.[1] || 0,
      tiltX: opts.rot?.[0] || 0,
      tiltZ: opts.rot?.[2] || 0,
      rotOrder: opts.rotOrder || "XYZ",
      arenaEdge: !!opts.arenaEdge,
      terrainSeat,
    };
    pivot.userData.landmarkPlacement = placement;
    authoredLandmarks.push({ key: opts.key, root: pivot, meshes, placement });
    return pivot;
  };

  const pois = [];
  const lights = [];
  const emitters = [];      // handed to vfx: fires, spores, steam
  /* The Choir's standing needles, published for the encounter that
     lives on top of them. The Stylite perches on real rock - the same
     rock that is in the collision grid and casts the district's light
     shafts - so its ledges cannot be guessed at, re-derived from a
     duplicated RNG seed, or quietly drift when the spire field is
     re-laid. See abbess.js and garner.js for the two encounters that
     had to hard-code a position because there was nothing to read. */
  const choirNeedles = [];
  const banners = [];       // geometry with a `wave` attribute, animated in vfx
  /* Exact authored walking surfaces that sit above the height field.
     Terrain alone cannot answer where the player's soles belong on a
     raised causeway: the Pilgrim's Road is deliberately drawn 22cm
     above the sand so its paving does not z-fight or disappear into
     the interpolated terrain mesh. Collision and foot IK consume this
     function after the world is complete. */
  let walkSurfaceAt = () => -Infinity;
  let walkSurfaceMaxInCircle = () => -Infinity;

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

    /* Boundary samples cover the sloping face of an authored road
       quad, but a sharp shared corner can be the maximum INSIDE a
       flight capsule. Return every indexed quad vertex within the
       footprint so collision can include those exact interior peaks
       just as it does for terrain-grid vertices. */
    walkSurfaceMaxInCircle = (x, z, radius) => {
      const minBX = Math.floor((x - radius) / WALK_BUCKET);
      const maxBX = Math.floor((x + radius) / WALK_BUCKET);
      const minBZ = Math.floor((z - radius) / WALK_BUCKET);
      const maxBZ = Math.floor((z + radius) / WALK_BUCKET);
      const radiusSq = radius * radius + 1e-9;
      let best = -Infinity;
      for (let bx = minBX; bx <= maxBX; bx += 1) {
        for (let bz = minBZ; bz <= maxBZ; bz += 1) {
          const list = walkBuckets.get(`${bx},${bz}`);
          if (!list) continue;
          for (const quad of list) {
            for (const point of quad) {
              if ((point[0] - x) ** 2 + (point[2] - z) ** 2 <= radiusSq) {
                best = Math.max(best, point[1]);
              }
            }
          }
        }
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

    /* --- the drop site ---

       The POD ITSELF is no longer baked here. It is a live, hinged
       object built by pod.js and placed by main.js, because the
       cinematic has to fly the same lander it leaves standing:
       a merged copy in this batch meant the thing the player landed
       in vanished at the handoff and a different, greyer hexagon
       took its place one metre away.

       What stays is the ground it landed ON - the crater, the blast
       ejecta and the burn ring. Those are static, they are terrain,
       and they are what makes the arrival read as violent after the
       camera has moved on. */
    {
      /* Scorch, draped over the crater's own dish.

         The hole itself is TERRAIN - `craterProfile` is composed into
         `heightAt` - so the ground mesh, the collision grid and the
         trooper's soles already agree about it. This adds the burn.

         Sampled off the DRAWN surface, not off `heightAt`. The
         terrain mesh is a 4m grid that interpolates linearly between
         its vertices, and inside a concave bowl a straight chord runs
         ABOVE the curve it is cutting - by half a metre at this
         depth. A skin floated a few centimetres over the analytic
         height therefore spends the whole crater buried under the
         very ground it is supposed to be lying on. Reproducing the
         mesh's own bilinear read puts it back on the surface, and
         14cm of float covers the residual: the mesh triangulates each
         quad rather than interpolating it bilinearly, so the two
         disagree by a few centimetres along every diagonal. */
      const GRID = CHUNK_SIZE / LOD_CELLS[0];
      const drawnY = (x, z) => {
        const gx = (x + MAP_HALF) / GRID;
        const gz = (z + MAP_HALF) / GRID;
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        const fx = gx - i;
        const fz = gz - j;
        const x0 = -MAP_HALF + i * GRID;
        const z0 = -MAP_HALF + j * GRID;
        return lerp(
          lerp(H(x0, z0), H(x0 + GRID, z0), fx),
          lerp(H(x0, z0 + GRID), H(x0 + GRID, z0 + GRID), fx),
          fz);
      };
      {
        const RINGS = [1.1, 2.6, 4.0, 5.3, 6.5, 7.6, 8.6, 9.6, 10.6];
        const SIDES = 40;
        const pos = [];
        const idx = [];
        pos.push(padX, drawnY(padX, padZ) + 0.14, padZ);
        for (let ri = 0; ri < RINGS.length; ri += 1) {
          const r = RINGS[ri];
          for (let s2 = 0; s2 < SIDES; s2 += 1) {
            const a = (s2 / SIDES) * TAU;
            const x = padX + Math.cos(a) * r;
            const z = padZ + Math.sin(a) * r;
            pos.push(x, drawnY(x, z) + 0.14, z);
          }
        }
        const ringStart = (ri) => 1 + ri * SIDES;
        for (let s2 = 0; s2 < SIDES; s2 += 1) {
          idx.push(0, ringStart(0) + ((s2 + 1) % SIDES), ringStart(0) + s2);
        }
        for (let ri = 0; ri < RINGS.length - 1; ri += 1) {
          for (let s2 = 0; s2 < SIDES; s2 += 1) {
            const a0 = ringStart(ri) + s2;
            const a1 = ringStart(ri) + ((s2 + 1) % SIDES);
            const b0 = ringStart(ri + 1) + s2;
            const b1 = ringStart(ri + 1) + ((s2 + 1) % SIDES);
            idx.push(a0, a1, b1, a0, b1, b0);
          }
        }
        const scar = new THREE.BufferGeometry();
        scar.setAttribute("position",
          new THREE.BufferAttribute(new Float32Array(pos), 3));
        scar.setIndex(idx);
        scar.computeVertexNormals();
        /* Painted by RADIUS, not by height: the bowl's floor and the
           rampart's crest are the two extremes of the dish and would
           otherwise take opposite ends of the ramp, putting the
           brightest sand at the bottom of the burn. */
        /* Scorched sand, not a void. A first pass bottomed the ramp
           out near black and the crater stopped reading as ground at
           all - it became a hole punched through the render, and it
           took the lit pod down with it. Burnt sand is a dark WARM
           grey-brown; there is still a sun on it. */
        const SCAR = makeRamp([
          [0, "#33281f"], [0.3, "#4a3728"], [0.62, "#6d543c"],
          [0.85, "#8e6f51"], [1, "#a8855f"],
        ]);
        paintGeometry(THREE, scar, SCAR, (x, y, z) =>
          clamp01(Math.hypot(x - padX, z - padZ) / 10.6), { jitter: 0.24 });
        batch.add("threshold", "ash", scar, { castShadow: false });
      }

      /* Ejecta: the crust the impact threw out, thickest on the
         rampart and thinning outward. Kept SMALL - a first pass
         scattered two-metre slabs and, seen from a camera down at eye
         level looking up at the pod, the near ones projected against
         the sky and read as debris hanging in mid-air. */
      for (let i = 0; i < 38; i += 1) {
        const a = rng() * TAU;
        const r = 8.2 + Math.pow(rng(), 0.6) * 9.0;
        const slab = kit.slab(0.36 + rng() * 0.8, 0.14 + rng() * 0.26,
          0.34 + rng() * 0.7, 0.04);
        place(slab, padX + Math.cos(a) * r, padZ + Math.sin(a) * r, {
          rot: [rng() * 0.5 - 0.25, rng() * TAU, rng() * 0.5 - 0.25],
          dy: -0.05,
        });
        flat(slab, i % 4 === 0 ? "#4a3a2c" : "#7d6349", 0.22);
        batch.add("threshold", "rock", slab);
      }

      /* Still cooking. The prow is buried in the floor of its own
         crater, so the steam comes off DOWN there, not off a skirt
         standing clear of the sand. */
      const craterY = H(padX, padZ);
      emitters.push({ kind: "smoke", x: padX, y: craterY + 2.2, z: padZ, scale: 1.7, rate: 0.66 });
      emitters.push({ kind: "smoke", x: padX + 4.4, y: craterY + 1.0, z: padZ - 3.4, scale: 1.0, rate: 0.36 });
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
  await landmarkAssetsReady;
  {
    const d = DISTRICTS.saint;
    const rng = makeRng(0x5a17ff);

    /* ONE PATINA RULE FOR THE WHOLE STATUE.

       The head, the Reaching Hand and the Breastplate are three
       pieces of ONE bronze, scattered across half the basin, and a
       player who walks between them will compare them whether or not
       anyone intended it. They used to carry three separately
       hand-tuned formulas, and two of them ran the rule backwards -
       `up * 0.42` and `up * 0.5`, upward faces BRIGHT - so once the
       head was corrected to pool patina where water actually sits,
       the fragments stopped reading as the same metal as the head
       they broke off.

       Both halves of the frame matter, and one of them is a decision
       rather than a convenience:

       PATINA IS PAINTED IN LOCAL SPACE, BEFORE THE PIECE IS TIPPED.
       The statue stood for centuries and corroded while it stood;
       THEN it fell. So "up" for weathering is the statue's own up,
       not the world's - which is why the head's paint runs before its
       transform, and why the other two now do the same. Painting a
       fallen fragment in world space would put fresh verdigris on
       whatever face happens to point at the sky today, which is a
       statement that the corrosion happened after the fall. */
    const saintPatina = ({ up, front, heightFrac, ang, reach = 0, runoffMask = null }) => {
      // Water SITS on upward faces, so they corrode hardest; steep
      // faces shed and keep their metal. Strong and narrow rather
      // than moderate and broad - see the head's own note on why the
      // distribution has to be bimodal.
      const pooling = Math.pow(clamp01(up), 1.5) * 0.55;
      const shed = (1 - Math.abs(up)) * 0.18;
      // Vertical runoff streaks, cubed so each is a narrow dark line
      // with clean metal either side.
      const stripe = Math.pow(
        Math.abs(Math.sin(ang * 11.0 + Math.sin(ang * 3.0) * 1.6)), 3.0
      );
      const mask = runoffMask === null ? clamp01(1 - heightFrac) : runoffMask;
      const runoff = stripe * clamp01(mask) * 0.55;
      // Rubbed bright where hands reach.
      const rubbed = reach * front * 0.16;
      return clamp01(
        0.42 + front * 0.34 + shed + rubbed
        - pooling - runoff
        + clamp01(heightFrac) * 0.05
      );
    };

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
      const headAsset = landmarkSources.fallenSaintHead;

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
      if (!headAsset) {
        const nrm = g.attributes.normal;
        paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => {
          const inEye = Math.abs(x) > S * 0.09 && Math.abs(x) < S * 0.26
            && y > S * 0.50 && y < S * 0.74 && z > S * 0.42;
          if (inEye) return 0.02;
          const front = clamp01(z / (S * 0.55));
          /* The head names its own runoff sources rather than taking
             the generic "everything below the top" mask: the laurel
             band and the eye sockets are the two real water traps on
             a face, and streaking from THEM is what makes the patina
             look like it was placed by rain instead of by a falloff. */
          const belowLaurel = clamp01((0.80 * S - y) / (S * 0.55));
          const belowEyes = clamp01((0.60 * S - y) / (S * 0.42)) * clamp01(front * 1.4);
          return saintPatina({
            up: nrm.getY(i),
            front,
            heightFrac: clamp01(y / (S * 1.05)),
            ang: Math.atan2(x, z),
            // The hand-height band pilgrims can actually touch.
            reach: 1 - clamp01(Math.abs(y - 0.10 * S) / (S * 0.18)),
            runoffMask: belowLaurel * 0.7 + belowEyes * 0.8,
          });
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
      if (headAsset) {
        addAuthoredLandmark(headAsset, {
          key: "fallenSaintHead",
          name: "saint-meshy-head",
          district: "saint",
          pos: [hx, H(hx, hz) - S * 0.24, hz],
          rot: [-0.28, -0.95, 0.26],
          // The original head spans -0.14S through 1.22S.
          height: S * 1.36,
        });
      } else {
        batch.add("saint", "bronze", g);
      }
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
      const handAsset = landmarkSources.fallenSaintHand;
      /* Painted BEFORE the transform - see the patina note above.
         The hand corroded while the arm was still raised, so its
         weathering is keyed to the wrist-to-fingertip axis it had
         then, not to whichever facet points at the sky now. */
      if (!handAsset) {
        const nrm = g.attributes.normal;
        paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => saintPatina({
          up: nrm.getY(i),
          // The palm faces local +Z, and it is the side that stayed
          // polished - the surface an upturned hand sheds rain off.
          front: clamp01(z / (S * 0.22)),
          heightFrac: clamp01(y / (S * 1.5)),
          ang: Math.atan2(x, z),
        }), { jitter: 0.12 });
      }
      kit.transform(g, {
        pos: [hx, H(hx, hz) - S * 0.42, hz],
        rot: [0.30, -0.9, 0.20],
      });
      if (handAsset) {
        addAuthoredLandmark(handAsset, {
          key: "fallenSaintHand",
          name: "saint-meshy-hand",
          district: "saint",
          pos: [hx, H(hx, hz) - S * 0.82, hz],
          rot: [0.30, -0.9, 0.20],
          // Matches the procedural wrist-to-fingertip span.
          height: S * 1.64,
        });
      } else {
        batch.add("saint", "bronze", g);
      }
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
      /* Painted before the transform, on the same reasoning as the
         hand: this is chest plate, and it weathered hanging on a
         standing torso. Its outward (convex) face is local +Y here,
         because the plate is built lying in the XY plane and only
         stood on its edge by the transform below - so `up` and
         `front` both key off that, and the concave inner surface
         (the cave a player walks into) correctly reads as the
         sheltered, unweathered side. */
      {
        const nrm = g.attributes.normal;
        paintGeometry(THREE, g, BRONZE_RAMP, (x, y, z, i) => saintPatina({
          up: nrm.getY(i),
          front: clamp01(nrm.getY(i) * 0.5 + 0.5),
          heightFrac: clamp01((y + R) / (R * 2)),
          ang: Math.atan2(x, z),
        }), { jitter: 0.16 });
      }
      kit.transform(g, { pos: [tx, H(tx, tz) - 20, tz], rot: [0.1, 1.15, 0.34] });
      batch.add("saint", "bronze", g);
      pois.push({ id: "saint-shell", name: "The Breastplate", x: tx, z: tz });
    }

    /* --- fallen halo arcs ---
       Sections of the Saint's halo, snapped off and lying in the
       basin. They are drawn on a circle of radius R about the
       geometry's origin, which is the centre of that circle and NOT
       anywhere on the arc - so the piece has to be brought back onto
       its own origin before anything else is done to it.

       A first pass swept the arc from a random start angle a0 and
       then did `translate(0, -R, 0)`, which only lands on the origin
       when a0 happens to be near zero. At the extremes it left the
       arc up to 110m off its anchor BEFORE the placement rotation,
       and the rotation then swung that offset into the air. Measured
       across the four: one hung 55m above the sand beside the head -
       a bronze rainbow floating over the Saint, visible from the
       drop - two more hung 9m up, and the fourth was 113m
       underground. Centre on the real bounds, then let
       `restOnTerrain` seat what is actually there. */
    for (let i = 0; i < 4; i += 1) {
      const len = rng.range(56, 104);
      const outer = [];
      const inner = [];
      const R = len * 1.35;
      const steps = 12;
      const half = len / R / 2;
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        const a = lerp(-half, half, t);
        const th = 5.2 * (0.4 + Math.sin(t * Math.PI) * 0.8);
        outer.push([Math.sin(a) * (R + th / 2), Math.cos(a) * (R + th / 2)]);
        inner.push([Math.sin(a) * (R - th / 2), Math.cos(a) * (R - th / 2)]);
      }
      const g = kit.ribbonSolid(outer, inner, rng.range(4, 9));
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.translate(
        -(bb.min.x + bb.max.x) / 2,
        -(bb.min.y + bb.max.y) / 2,
        -(bb.min.z + bb.max.z) / 2
      );
      const ax = d.x + rng.gauss() * 190;
      const az = d.z + rng.gauss() * 190;
      /* Roll kept shallow. At up to 1.5rad a 140m-radius ribbon
         stands on its edge, and a piece of halo standing upright in
         the sand reads as a sculpture someone installed rather than
         as something that fell off the sky. These lie down, and the
         bow in them lifts the middle clear of the ground on its
         own. */
      restOnTerrain(g, ax, az, {
        rot: [rng.range(-0.3, 0.3), rng() * TAU, rng.range(0.18, 0.62) * rng.sign()],
        embed: rng.range(1.2, 3.6),
        quantile: 0.55,
        maxGap: 2.4,
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
    /* Where the north wall was breached, off the building's axis.
       The wall reads it, the rubble fan reads it and the chandelier
       that came down reads it, so it is one number. */
    const BREACH_X = -6.0;

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
          /* North end is blown open: the first two bays keep only a
             stub of their upper wall.

             b counts NORTH to south - b=0 is z -66 - so `b >= bays-2`
             was knocking the top off the two bays hard against the
             west front, under the surviving roof and behind the
             towers where nothing can see them, and leaving the
             breached end standing at full height with its clerestory
             intact. Everything else in the district already agrees
             about which end was hit: the roof covers the southern two
             thirds, the torn rafters reach north over the open bays,
             and the rose is in the south front. */
          const ruined = b < 2;
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

    /* --- the north end: what is left of the chancel wall ---
       The nave had no north wall at all. Everything else in the
       district says the building was breached at this end - the roof
       stops, the rafters reach out over nothing, the vault is
       stripped back to its ribs - but the wall those events happened
       TO was never built, so the nave ended in a clean rectangular
       opening and the whole thing read as an unfinished hall rather
       than as a ruin. A hole is only legible as damage when there is
       an edge around it.

       Built as vertical strips rather than as a wall with a hole cut
       in it. Masonry does not fail along a drawn outline: it fails
       course by course, and what is left is a ragged crest where
       every strip ended at a different stone. Strips also give the
       breach a real jamb - you can see the wall's thickness through
       it, which a single-sided panel can never do.

       The middle is taken to the ground on purpose. The nave has to
       keep a way out through its own wound, or the fix to the
       silhouette becomes a wall across a route the player already
       uses. */
    {
      const parts = [];
      const HW = 38;                                  // out past the aisle walls
      const DN = 4.2;                                 // wall thickness
      const zN = -NAVE_L / 2 - DN / 2 + 1.0;          // butted to the flank walls
      /* Off-centre on purpose: a breach centred exactly on the
         middle of a symmetrical wall reads as an architectural
         feature rather than as damage. */
      const breachX = BREACH_X;
      const breachR = 16.5;

      /* Strips of varying width, walked across the span rather than
         stepped at a fixed pitch. Equal widths give the crest a
         picket rhythm you read as a repeat before you read it as
         masonry; the depth jitter is what stops the inner and outer
         faces from being two flat planes. */
      let cursor = -HW;
      while (cursor < HW - 0.4) {
        const sw = Math.min(rng.range(1.7, 4.3), HW - cursor);
        const x = cursor + sw / 2;
        cursor += sw;
        const u = Math.abs(x) / HW;
        /* What survived. A wall is thickest and best buttressed at
           its corners and thinnest in the middle of its span, so
           the corners are what stand. */
        let h = 5.5 + Math.pow(u, 2.3) * 26
          + Math.sin(x * 0.43) * 2.1 + rng.range(-2.0, 2.0);
        const dd = Math.abs(x - breachX) / breachR;
        if (dd < 1) {
          h = Math.min(h, 1.0 + Math.pow(dd, 1.8) * 17 - rng.range(0, 2.4));
        }
        if (h < 0.6) continue;
        const dn = DN * rng.range(0.82, 1.14);
        // Started below the pad so the base is never exposed by the
        // paving that sits 4cm proud of it.
        const w = kit.slab(sw * 1.06, h + 0.7, dn, 0.16);
        w.translate(x, -0.7, zN + rng.jit(DN * 0.16));
        parts.push(w);
        // One capping stone per strip, tipped off true: a broken
        // crest is a line of individual blocks, not a saw cut.
        if (h > 1.6 && rng.chance(0.72)) {
          const cap = kit.slab(
            sw * rng.range(0.45, 0.92), rng.range(0.5, 1.4),
            dn * rng.range(0.5, 0.92), 0.1
          );
          cap.rotateX(rng.jit(0.18));
          cap.rotateZ(rng.jit(0.14));
          cap.rotateY(rng.jit(0.45));
          cap.translate(x + rng.jit(sw * 0.3), h - 0.1, zN + rng.jit(DN * 0.22));
          parts.push(cap);
        }
        /* A surviving length of string course. One strong horizontal
           is what says the crest above it used to be a designed wall
           and not a pile. */
        if (h > 9 && rng.chance(0.75)) {
          parts.push(kit.slab(sw * 1.18, 0.8, dn + 0.9, 0.12)
            .translate(x, 8.2, zN));
        }
      }

      /* Corner jambs. Two broken teeth, and the tallest things left
         at this end - they are what stops the crest from reading as
         a single smooth hill of stone. */
      for (const s of [-1, 1]) {
        let y = 0;
        for (const [sh, r] of [[13.5, 4.6], [8.5, 3.9], [4.5, 3.2]]) {
          parts.push(kit.slab(r * 2, sh, r * 2, 0.3)
            .translate(s * (HW - r + 0.8), y, zN - 0.4));
          y += sh;
        }
        // The snapped top, sheared on a slant.
        const tip = kit.slab(5.4, 3.6, 5.4, 0.24);
        tip.rotateX(rng.range(0.12, 0.3) * s);
        tip.rotateZ(rng.range(-0.26, -0.1) * s);
        tip.translate(s * (HW - 3.4), y - 0.6, zN - 0.4);
        parts.push(tip);
      }

      /* The great east window, snapped off at the springing. Two
         curved stubs reaching in toward each other and stopping in
         mid-air is the single clearest statement that something
         used to be there. */
      {
        const SILL = 9.5;
        const WR = 16;
        for (const s of [-1, 1]) {
          const pts = [];
          const cut = rng.range(0.34, 0.46);
          for (let k = 0; k <= 6; k += 1) {
            const t = (k / 6) * cut;
            const a = t * Math.PI * 0.78;
            pts.push([
              s * (WR - Math.sin(a) * WR * 0.62),
              SILL + Math.sin(a) * 20 + t * 7,
              zN + DN * 0.16,
            ]);
          }
          parts.push(kit.tube(pts, 1.05, 5));
          // The jamb below it, still standing on the sill.
          parts.push(kit.slab(2.2, SILL, DN * 0.8, 0.16)
            .translate(s * WR, 0, zN + DN * 0.1));
        }
        // A mullion, snapped at chest height above the sill.
        parts.push(kit.slab(1.5, SILL + rng.range(3, 7), DN * 0.62, 0.14)
          .translate(-1.5, 0, zN + DN * 0.12));
      }

      const g = kit.merge(parts);
      kit.transform(g, { pos: [cx, plazaY, cz] });
      paintH(g, stoneRamp, {
        min: plazaY, max: plazaY + WALL_H, normalWeight: 0.46,
        jitter: 0.15, noise: 0.26,
      });
      batch.add("cathedral", "stone", g);

      /* --- what came down ---
         Rubble is the other half of the statement. A clean-edged
         hole with bare floor under it is a doorway; the same hole
         with a talus of its own wall lying in front of it is
         damage. Heaviest just inside the breach, thinning south
         down the nave and north out onto the plateau. */
      {
        const rocks = [];
        /* Inside the nave the walking surface is the flagstone
           floor, 4cm proud of the pad `restOnTerrain` measures, so
           interior debris is seated a touch HIGH to sit on the
           paving instead of half-sunk through it. */
        const seat = (geo, rx, rz, inside, opts) => restOnTerrain(geo, rx, rz, {
          ...opts,
          embed: opts.embed - (inside ? 0.06 : 0),
        });
        /* Inside, a piece of rubble is either a BLOCK you walk round
           or a CHIP lying flush with the paving - never the
           ankle-height lump in between, and never TILTED.

           Neither rule is an aesthetic preference. The walking
           surface in the nave is the floor, and collision discards
           anything under 75cm as too small to stop a soldier, so a
           20cm stone in here is one the player's boots pass straight
           through - the same defect the paving itself was fixed for,
           and `saintfall-collision-audit.mjs` fails the nave on it.
           Tilt is the same defect wearing a different hat: whatever
           its height, a tipped slab crosses the floor plane
           somewhere, and there is always a wedge of it standing at
           exactly boot height. Square-set blocks clear 75cm on their
           vertical sides, so collision stores them and the player
           walks round them instead.

           Cut stone falls as cut stone, so blockiness is the right
           answer here anyway. Outside the wall there is no floor to
           be flush with and no such band. */
        const INTERIOR_MIN_BLOCK = 0.9;
        for (let i = 0; i < 96; i += 1) {
          const inside = rng.chance(0.62);
          // Spread along the breach mouth, fanning away from it.
          const t = Math.pow(rng(), 1.6);
          const spread = 9 + t * 22;
          const rx = cx + breachX + rng.gauss() * spread * 0.5;
          const throwZ = t * (inside ? 34 : 22);
          const rz = cz - NAVE_L / 2 + (inside ? throwZ : -throwZ - 3);
          const reach = inside ? 33 : HW + 16;
          if (Math.abs(rx - cx) > reach) continue;
          if (inside && rng.chance(0.42)) {
            // A chip: spalled facing, laid flat like the paving.
            const ch = rng.range(0.10, 0.18);
            const chip = kit.slab(rng.range(0.9, 2.6), ch, rng.range(0.8, 2.2), 0.05);
            placeOnTerrain(chip, rx, rz, {
              yaw: rng() * TAU, sample: 1.4, dy: -ch + 0.05, maxTilt: 0.2,
            });
            rocks.push(chip);
            continue;
          }
          const s = rng.range(0.7, 2.6) * (1 - t * 0.45);
          const dim = (k) => (inside ? Math.max(INTERIOR_MIN_BLOCK, s * k) : s * k);
          const block = kit.slab(
            dim(rng.range(1.0, 2.2)), dim(rng.range(0.7, 1.3)),
            dim(rng.range(1.0, 2.0)), 0.12
          );
          seat(block, rx, rz, inside, {
            rot: inside
              ? [0, rng() * TAU, 0]
              : [rng.jit(0.55), rng() * TAU, rng.jit(0.55)],
            embed: inside ? 0.02 : rng.range(0.05, 0.35),
            maxGap: 0.12,
          });
          rocks.push(block);
        }
        /* A handful of pieces big enough to read as WALL rather than
           as scree - a course of ashlar still stuck together, a
           length of string course, the head of the window's arch. */
        for (let i = 0; i < 9; i += 1) {
          const t = rng();
          const inside = rng.chance(0.6);
          const rx = cx + breachX + rng.gauss() * 13;
          const rz = cz - NAVE_L / 2 + (inside ? 4 + t * 26 : -6 - t * 18);
          const chunk = kit.merge([
            kit.slab(rng.range(5, 11), rng.range(1.6, 3.0), rng.range(3, 5.5), 0.2),
            kit.slab(rng.range(3, 7), rng.range(1.2, 2.4), rng.range(2.4, 4.4), 0.18)
              .translate(rng.jit(2.2), rng.range(1.4, 2.4), rng.jit(1.6)),
          ]);
          seat(chunk, rx, rz, inside, {
            rot: inside
              ? [0, rng() * TAU, 0]
              : [rng.jit(0.42), rng() * TAU, rng.jit(0.42)],
            embed: inside ? 0.05 : rng.range(0.2, 0.7),
            maxGap: 0.2,
          });
          rocks.push(chunk);
        }
        /* Two rib sections that came down with the vault. They went
           OUT with the wall rather than in - a 1.2m tube lying on a
           paved floor is a ramp from nothing up to knee height, and
           the nave has no walkable surface between those two. On
           sand it is just a fallen rib. */
        for (let i = 0; i < 2; i += 1) {
          const len = rng.range(15, 24);
          const pts = [];
          for (let k = 0; k <= 5; k += 1) {
            const t = k / 5;
            pts.push([lerp(-len / 2, len / 2, t), Math.sin(t * Math.PI) * 2.2, 0]);
          }
          const rib = kit.tube(pts, 0.62, 5);
          const rx = cx + breachX + rng.jit(15);
          const rz = cz - NAVE_L / 2 - rng.range(4, 22);
          seat(rib, rx, rz, false, {
            rot: [rng.jit(0.3), rng() * TAU, rng.range(-0.5, 0.5)],
            embed: 0.3, maxGap: 0.35,
          });
          rocks.push(rib);
        }
        const rg = kit.merge(rocks);
        paintH(rg, stoneRamp, {
          min: plazaY - 1, max: plazaY + 5, normalWeight: 0.55,
          jitter: 0.18, noise: 0.32,
        });
        batch.add("cathedral", "stone", rg);
        pois.push({
          id: "cathedral-breach", name: "The Breach",
          x: cx + breachX, z: cz - NAVE_L / 2 - 6,
        });
      }
    }

    /* --- flying buttresses --- */
    {
      const parts = [];
      for (const side of [-1, 1]) {
        for (let b = 0; b < 8; b += 1) {
          const z = -NAVE_L / 2 + 10 + (b / 7) * (NAVE_L - 26);
          // Counted from the north, with the rest of the ruin.
          const ruin = b <= 1 ? rng.range(0.35, 0.8) : 0;
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
      /* Transverse vault ribs. The roof is gone over the north
         third, so the ribs there stand open against the sky - the
         single best silhouette in the district.

         The test was `b > bays * 0.62`, and b counts from the NORTH:
         b=0 is z -66, b=9 is z +66. So it was stripping the vault
         out of the southern bays - the ones the surviving roof
         covers - and roofing the breached end with an intact stone
         ceiling. From outside the north end you were looking into a
         finished building; from inside, the bare ribs were the ones
         with a roof over them and could never be seen against
         anything. Counted from the breach instead. */
      for (let b = 0; b <= bays; b += 1) {
        const z = -NAVE_L / 2 + (b / bays) * NAVE_L;
        const open = b < bays * 0.38;
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
      /* Flagstone apron.

         Two rules here, and both of them are about the depth buffer
         rather than about paving.

         The apron is scattered over a 118m disc centred 34m north of
         the front, which reaches 84m PAST the doors - so about forty
         of these slabs were landing inside the nave and under the
         front wall itself. The plaza sits on a dead-level pad, the
         apron puts its top face 4cm above it and so does the nave
         paving, which means every one of those slabs was exactly
         coplanar with the floor it landed on. They fought for the
         depth buffer and, being painted from a much darker ramp,
         resolved as ragged dark blotches torn across the nave.
         Keeping them out of the building's own footprint is the
         fix.

         The same coplanarity applies to the apron against ITSELF -
         220 slabs on a level pad, all at +4cm, overlapping wherever
         the scatter puts two together. A few centimetres of spread
         costs nothing at a walking pace and means no two slabs ever
         share a plane. */
      const FOOTPRINT_HALF_W = NAVE_W / 2 + AISLE_W + 8;   // 43, clears the buttresses
      const FOOTPRINT_Z = NAVE_L / 2 + 8;                  // clears the tower plinths
      for (let i = 0; i < 220; i += 1) {
        const a = rng() * TAU;
        const r = 20 + Math.pow(rng(), 0.5) * 108;
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r + NAVE_L / 2 + 34;
        if (Math.hypot(px, pz - NAVE_L / 2 - 34) > 118) continue;
        if (Math.abs(px) < FOOTPRINT_HALF_W && pz < FOOTPRINT_Z) continue;
        const sw = rng.range(3.4, 6.2);
        const sh = rng.range(0.25, 0.45);
        const sd = rng.range(3.4, 6.2);
        const s = kit.slab(sw, sh, sd, 0.06);
        placeOnTerrain(s, cx + px, cz + pz, {
          yaw: rng() * TAU,
          sample: Math.max(sw, sd) * 0.45,
          // Four centimetres of relief reads as paving without
          // putting an ankle-height non-walkable slab through boots.
          dy: -sh + rng.range(0.015, 0.075),
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

    /* --- corona chandeliers ---
       The nave is 44m wide and 34m to the springing, and until now
       there was nothing at all in the volume between the floor and
       the vault. Everything was either underfoot or overhead, so the
       eye crossed a 30m gap of empty air in one jump and the space
       read as a corridor with a high ceiling rather than as a room
       with height. Something hung halfway up is what gives the
       height a middle to be measured against - and a corona is what
       would be hanging there.

       Chains are structural here, not decoration: the eye follows
       them up and finds the vault. A corona with no chain is a ring
       floating in a church. */
    {
      const iron = [];
      const flames = [];

      /** One corona. `y` is the ring's height above the plaza. */
      const corona = (x, y, z, opts = {}) => {
        const R = opts.r || 4.6;
        const tiers = opts.tiers === undefined ? 2 : opts.tiers;
        const lit = opts.lit !== false;
        const parts = [];
        const flame = [];
        const hoop = (rr, hy, band) => {
          parts.push(kit.ringSolid([
            { y: hy - band, r: rr, sides: 16 },
            { y: hy + band, r: rr, sides: 16 },
          ], { capTop: false, capBottom: false }));
        };
        const tier = (rr, hy, count) => {
          hoop(rr, hy, 0.34);
          for (let i = 0; i < count; i += 1) {
            const a = (i / count) * TAU;
            // Pricket and candle, as one iron spike at this scale.
            const c = kit.prism({ h: 1.5, rBottom: 0.20, rTop: 0.11, sides: 5 });
            c.translate(Math.cos(a) * rr, hy + 0.3, Math.sin(a) * rr);
            parts.push(c);
            if (lit) {
              const f = kit.prism({ h: 0.85, rBottom: 0.21, rTop: 0.02, sides: 5 });
              f.translate(Math.cos(a) * rr, hy + 1.85, Math.sin(a) * rr);
              flame.push(f);
            }
          }
          // Spokes back to the hub.
          for (let i = 0; i < 4; i += 1) {
            const a = (i / 4) * TAU + 0.4;
            const sp = kit.slab(rr, 0.16, 0.30, 0.03);
            sp.translate(rr / 2, 0, 0);
            sp.rotateY(-a);
            sp.translate(0, hy, 0);
            parts.push(sp);
          }
        };
        tier(R, 0, Math.round(R * 3));
        if (tiers > 1) tier(R * 0.60, 1.9, Math.round(R * 1.9));
        // Hub and the collar the stays gather to.
        parts.push(kit.prism({ h: 1.1, rBottom: 0.55, rTop: 0.40, sides: 6 })
          .translate(0, -0.5, 0));
        const collarY = tiers > 1 ? 4.4 : 3.0;
        parts.push(kit.prism({ h: 0.7, rBottom: 0.45, rTop: 0.34, sides: 6 })
          .translate(0, collarY, 0));
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * TAU + 0.4;
          parts.push(kit.tube([
            [Math.cos(a) * R, 0.1, Math.sin(a) * R],
            [Math.cos(a) * R * 0.45, collarY * 0.55, Math.sin(a) * R * 0.45],
            [0, collarY, 0],
          ], 0.09, 4));
        }

        const g = kit.merge(parts);
        const fg = flame.length ? kit.merge(flame) : null;
        if (opts.rot) {
          kit.transform(g, { rot: opts.rot });
          if (fg) kit.transform(fg, { rot: opts.rot });
        }
        g.translate(x, y, z);
        if (fg) fg.translate(x, y, z);

        // The chain up to the vault. Snapped ones keep a stub.
        if (opts.chain !== false) {
          const top = opts.chainTop === undefined ? plazaY + 33 : opts.chainTop;
          const cxTop = opts.chainX === undefined ? x : opts.chainX;
          iron.push(kit.tube([
            [x, y + collarY, z], [cxTop, top, opts.chainZ === undefined ? z : opts.chainZ],
          ], 0.10, 4));
        }
        iron.push(g);
        if (fg) flames.push(fg);
      };

      /* Under the surviving vault: three lit, evenly spaced down
         the bays so the row itself reads as perspective.

         Hung at 10m, not the 16.5m they started at. The nave's
         authored review pose stands at eye height at the north end
         and looks back at the rose, and the rose is only visible
         through a narrow slot between the vault crown and the
         gable - a sightline that climbs at about 0.31. At 16.5 the
         nearest corona sat dead on that line and put a ring of
         candles across the one window the frame exists for. At 10
         the row passes under it and the rose reads. Ten metres is
         also where a corona belongs: they are lit by hand off a
         ladder, and one hung five storeys up is a light nobody
         could ever reach. */
      for (let i = 0; i < 3; i += 1) {
        const z = cz + 6 + i * 20;
        corona(cx, plazaY + 9, z, { r: 4.6, lit: true });
      }

      /* At the edge of the damage, hanging off one stay. Two of its
         four chains are gone, so it hangs 20 degrees out of true and
         its candles are long out - the first thing that tells you,
         from inside, which way the wall went. */
      corona(cx + 3.5, plazaY + 12.5, cz - 26, {
        r: 4.2, lit: false, rot: [0.34, 0.5, -0.12],
        chainX: cx - 1.4, chainZ: cz - 27, chainTop: plazaY + 32,
      });

      /* And one that did not hold, lying in the rubble under the
         breach with its ring buckled. */
      {
        const cxr = cx + BREACH_X - 4;
        const czr = cz - NAVE_L / 2 + 15;
        const wreck = [];
        const R = 4.4;
        wreck.push(kit.ringSolid([
          { y: -0.34, r: R, sides: 16, jitter: 0.22, seed: 0x3c1 },
          { y: 0.34, r: R, sides: 16, jitter: 0.22, seed: 0x3c2 },
        ], { capTop: false, capBottom: false }));
        for (let i = 0; i < 13; i += 1) {
          const a = (i / 13) * TAU;
          if (rng.chance(0.3)) continue;        // snapped off in the fall
          const c = kit.prism({ h: 1.3, rBottom: 0.19, rTop: 0.10, sides: 5 });
          c.rotateZ(rng.jit(0.5));
          c.rotateX(rng.jit(0.5));
          c.translate(Math.cos(a) * R, 0.3, Math.sin(a) * R);
          wreck.push(c);
        }
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * TAU + 0.4;
          const sp = kit.slab(R, 0.16, 0.30, 0.03);
          sp.translate(R / 2, 0, 0);
          sp.rotateY(-a);
          wreck.push(sp);
        }
        wreck.push(kit.prism({ h: 1.0, rBottom: 0.55, rTop: 0.40, sides: 6 })
          .translate(0, -0.5, 0));
        // The chain it came down with, coiled where it landed.
        const coil = [];
        for (let k = 0; k <= 9; k += 1) {
          const t = k / 9;
          coil.push([
            Math.cos(t * 9.2) * (1.4 + t * 3.6),
            0.25 + Math.sin(t * 5.1) * 0.2,
            Math.sin(t * 9.2) * (1.4 + t * 3.6),
          ]);
        }
        wreck.push(kit.tube(coil, 0.10, 4));
        const wg = kit.merge(wreck);
        // Scale flat: a ring that fell 16m onto stone does not stay
        // round, and a perfect hoop lying in rubble reads as a prop
        // that was placed there.
        wg.scale(1, 0.72, 1);
        restOnTerrain(wg, cxr, czr, {
          rot: [0.13, 1.1, 0.08], embed: 0.02, maxGap: 0.3,
        });
        iron.push(wg);
      }

      const ig = kit.merge(iron);
      paintH(ig, makeRamp([
        [0, "#231a18"], [0.45, "#3b2c25"], [0.8, "#5a4436"], [1, "#7d6146"],
      ]), { min: plazaY, max: plazaY + 34, normalWeight: 0.5, jitter: 0.16 });
      batch.add("cathedral", "rust", ig);

      if (flames.length) {
        const fg = kit.merge(flames);
        flat(fg, "#ffb45e", 0.22);
        batch.add("cathedral", "emissive", fg,
          { castShadow: false, receiveShadow: false });
      }

      /* One real light, on the middle corona. The nave's only other
         light sources are the clerestory shafts and the rose, and
         both of those are DIRECTIONAL - they wash two stripes of
         floor and leave the columns, the vault springing and
         everything at head height unlit. A warm point at 16m is what
         the candles are supposed to be doing, and it is the
         difference between a lit interior and a lit floor.

         This takes the level to the twelfth and last light. */
      lights.push({
        x: cx, y: plazaY + 10.5, z: cz + 26,
        colour: "#ffb264", intensity: 190, distance: 120,
        kind: "brazier", flicker: 0.35,
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
        /* KEEP OFF THE GARNER'S PIT.
           This litter is placed on the SEALED pan and never moves
           again, and the pit is a hundred and twenty-four metres of
           that pan which drops away the moment the player walks up to
           it - so a skull standing there is left hanging in the air
           over an open mouth. Resampled rather than pushed outward,
           which would build a ring of bone around the hole that nobody
           authored and that would give the encounter away from the
           other side of the district. */
        let x = d.x;
        let z = d.z;
        for (let tries = 0; tries < 12; tries += 1) {
          const a = rng() * TAU;
          const r = Math.pow(rng(), 0.55) * 300;
          x = d.x + Math.cos(a) * r;
          z = d.z + Math.sin(a) * r;
          if (Math.hypot(x - GARNER_PIT.x, z - GARNER_PIT.z) > GARNER_PIT.reach + 3) break;
        }
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
      paintH(g, GLASS_RAMP, { normalWeight: 0.55, jitter: 0.2, noise: 0.3, bias: 0.30 });
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
        return clamp01(0.10 + rr * 0.36 + Math.sin(x * 0.3 + z * 0.21) * 0.07);
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
        colour: "#ff7a3a", intensity: 255, distance: 220, kind: "ember", flicker: 0.5,
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
      paintH(g, GLASS_RAMP, { normalWeight: 0.4, jitter: 0.2, bias: 0.30 });
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
      const standing = [];
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
        if (!fallen) {
          const needle = { x, z, h, rad, baseY: g.userData.restY };
          standing.push(needle);
          choirNeedles.push(needle);
        }
        parts.push(g);
      }
      const g = kit.merge(parts);
      paintH(g, spireRamp, { normalWeight: 0.40, jitter: 0.14, noise: 0.24 });
      batch.add("choir", "rock", g);
      pois.push({ id: "choir", name: "The Choir Spires", x: d.x, z: d.z });

      /* --- the light between them ---

         These are the district's whole picture, and they have to be
         chosen by the SPIRES. The previous set was scattered by the
         vfx module's own RNG - a random bearing and a random height
         somewhere inside a 320m circle - which put most of the cones
         in open sky with no rock near enough to cast one, and gave
         each of them a direction frozen from the sun at world-build
         time. Standing in the district you got pale, hard-edged bars
         ruled across the sky at every hour including midnight.

         Tallest first, then spaced apart, so the light picks out the
         crowns that already carry the silhouette rather than landing
         in the flats between them. The cone itself is aimed, offset
         and cut to length against the live sun by `buildShafts`; all
         that is fixed here is which needle it belongs to. */
      const lit = standing.filter((n) => n.h > 62).sort((a, b) => b.h - a.h);
      const chosen = [];
      for (const n of lit) {
        if (chosen.length >= 5) break;
        if (chosen.some((c) => Math.hypot(c.x - n.x, c.z - n.z) < 115)) continue;
        chosen.push(n);
      }
      for (const n of chosen) {
        emitters.push({
          kind: "shaft", sun: true,
          /* Not from the crown. These needles stand 84m to 128m, and
             a cone from the top of one down to the sand is a hundred
             metres of object lying across the district - a fallen
             column, not a shaft. Entering at two fifths of the way up
             puts the head of the cone against the needle's own rock,
             which is the slot, and leaves a 45m fall to the floor. */
          x: n.x, y: n.baseY + n.h * 0.42, z: n.z,
          offset: n.rad * 1.6, radius: clamp(n.rad * 0.46, 2.4, 4.8),
          /* Pale, and only just warm. Saturated warm additive over a
             desert sky has one channel already at the ceiling, so the
             extra light lands in the other two and the shaft arrives
             white anyway - with a hard edge where it clipped. */
          /* 0.34, and the district is better for it. Outside, a shaft
             competes with a fully lit desert and has to be almost
             nothing; the number that matters is not how it reads
             against the sky but what it does when it crosses a spire,
             because unlit rock here sits near black and ANY additive
             of size turns it into a flat grey blade. */
          colour: "#ffeacb", gain: 0.34,
        });
      }
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

    /* --- the shrine at the arena's edge --- */
    {
      /* It stood at (d.x+26, d.z-14) - thirty metres from the arena
         centre, a 5.4m altar and nine plinthed statues exactly where
         a downed Stylite is meleed. The Glass Scar already taught
         this lesson (the crater-centre lance blocked every bolt
         thrown east); the shrine keeps its POI and its fire but
         moves to the flat pad's edge, inside the arena and clear of
         the needle-foot crash sites. */
      const sx = d.x + 72;
      const sz = d.z + 38;
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
      const crossAsset = landmarkSources.gildedReachCross;
      /* A separate stream keeps pose variety deterministic without
         re-timing the Reach's existing mast, sail and statue scatter. */
      const poseRng = makeRng(0x6c7a55);
      const fallen = new Map([
        [3, { tiltX: 1.31, tiltZ: -0.18 }],
        [13, { tiltX: -1.24, tiltZ: 0.27 }],
      ]);
      const leaning = new Map([
        [6, { tiltX: 0.23, tiltZ: -0.12 }],
        [14, { tiltX: -0.17, tiltZ: 0.21 }],
      ]);
      for (let i = 0; i < 17; i += 1) {
        // A line marching across the dunes, perpendicular to the
        // wind, so they read as deliberate rather than scattered.
        const t = i / 16;
        let x = d.x - 300 + t * 620 + rng.jit(40);
        let z = d.z - 190 + t * 300 + rng.jit(60);
        /* THE MATRIARCH'S CLEARING. The line used to march straight
           through her arena - mast 8 stood twenty-five metres from
           the marker, a hex plinth inside melee reach, and her own
           masonry probe turned her along it mid-fight. Masts that
           land inside the keep ring are pushed radially to it rather
           than skipped: a skip deletes a vane from the line (and
           re-times every rng draw after it), a push bows the line
           around the clearing, which reads as the builders having
           respected the same ground. */
        {
          const keep = MATRIARCH_ARENA.bossRadius + 12;
          const mdx = x - MATRIARCH_ARENA.x;
          const mdz = z - MATRIARCH_ARENA.z;
          const md = Math.hypot(mdx, mdz);
          if (md < keep) {
            const nx = md > 1e-6 ? mdx / md : 1;
            const nz = md > 1e-6 ? mdz / md : 0;
            x = MATRIARCH_ARENA.x + nx * keep;
            z = MATRIARCH_ARENA.z + nz * keep;
          }
        }
        const h = rng.range(14, 26);
        const yaw = (i * 2.39996323 + poseRng.jit(0.34) + TAU) % TAU;
        const pose = fallen.get(i) || leaning.get(i) || {
          tiltX: poseRng.jit(0.035),
          tiltZ: poseRng.jit(0.035),
        };
        const variant = fallen.has(i) ? "fallen" : leaning.has(i) ? "leaning" : "upright";
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
        if (crossAsset) {
          addAuthoredLandmark(crossAsset, {
            key: `gildedReachCross-${i}`,
            name: `reach-meshy-choir-wheel-${i}`,
            district: "reach",
            pos: [x, 0, z],
            rot: [pose.tiltX, yaw, pose.tiltZ],
            rotOrder: "YXZ",
            // Preserve the old vane's seeded height range and skyline.
            height: h + 1.6,
            variant,
            seatOnTerrain: { maxGap: 0, embed: 0.12 },
          });
        }
      }
      if (crossAsset) {
        /* One processional monument marks the Matriarch territory from
           the outside. Its centre stands one footing-radius beyond the
           145m reset ring, so the buried plinth reaches the boundary but
           the mass of the cross does not obstruct the combat space. */
        const height = 44;
        const bearing = 2.05;
        const edgeRadius = MATRIARCH_ARENA.bossRadius + 12;
        const x = MATRIARCH_ARENA.x + Math.cos(bearing) * edgeRadius;
        const z = MATRIARCH_ARENA.z + Math.sin(bearing) * edgeRadius;
        addAuthoredLandmark(crossAsset, {
          key: "gildedReachCross-matriarchEdge",
          name: "reach-meshy-choir-wheel-matriarch-edge",
          district: "reach",
          pos: [x, 0, z],
          rot: [0.045, bearing - Math.PI * 0.5, -0.035],
          rotOrder: "YXZ",
          height,
          variant: "arena-edge",
          arenaEdge: true,
          seatOnTerrain: { maxGap: 0, embed: 0.16 },
        });
      }
      const mg = kit.merge(masts);
      const sg = kit.merge(sails);
      if (!crossAsset) {
        paintH(mg, makeRamp([[0, "#3b2c22"], [0.6, "#7b6046"], [1, "#b0906c"]]),
          { normalWeight: 0.46, jitter: 0.16 });
        batch.add("reach", "rust", mg);
        paintH(sg, makeRamp([[0, "#7d3a2c"], [0.5, "#c07a4a"], [1, "#e8c384"]]),
          { normalWeight: 0.55, jitter: 0.2 });
        batch.add("reach", "cloth", sg);
      }
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
  /* ============================================================
     THE YARDANGS

     Wind-carved fins standing in the open dune sea: a blunt prow
     into the wind, a long streamlined tail, a scoured waist and a
     crest that runs most of the fin's length. Fifteen of them, all
     on the ripples' own bearing, are what stops the desert between
     districts reading as empty.

     Three things had to be true here that were not:

     - THE UNDERSIDE MUST BE CLOSED. `ringSolid` was called with
       `capBottom: false`, so every fin was a hollow shell. That is
       invisible from every angle except one - and it is the angle a
       player at the foot of a dune actually has, looking up at the
       belly and straight in through the open bottom.

     - A 130-METRE OBJECT CANNOT BE PLACED FROM ONE HEIGHT SAMPLE.
       `place()` takes y from H(x, z) at the centre alone, which
       over a dune sea leaves a fin resting on its middle like a
       plank on a pillow. Measured on the fifteen before this pass:
       the worst base vertex stood ELEVEN METRES clear of the sand,
       and eight fins had more than a tenth of their base ring in
       open air. Open shell plus floating base is the whole of the
       "see-through from underneath" report - neither alone would
       have shown.

     - A CONE IS NOT A FIN. The old profile ran a full-length base
       ellipse up to a single apex, so from broadside it read as a
       squashed paper dart; and nine sides around a 130m ellipse
       left the flanks as four flat facets twenty metres across,
       which is where the layer-cake banding came from. The crest
       now stays a RIDGE - about half the fin's length at the top -
       the prow is blunt where the tail is drawn out, and flutes
       rake the flanks so the surface breaks up the slope rather
       than into horizontal strips.
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

    const inDistrictAt = (px, pz) => Object.values(DISTRICTS)
      .some((d) => Math.hypot(px - d.x, pz - d.z) < d.r * 0.92);

    /* Local (fin) space to world, for a plain Y rotation. Written
       out rather than reached for through a Matrix4 because the
       footprint survey below runs it a few hundred times per
       candidate site and never needs the other eleven terms. */
    const toWorld = (cx, cz, yaw, lx, lz) => [
      cx + lx * Math.cos(yaw) + lz * Math.sin(yaw),
      cz - lx * Math.sin(yaw) + lz * Math.cos(yaw),
    ];

    /* The ground a fin will actually have to stand on: sampled over
       its own elliptical footprint, not at its centre. `lo` is what
       it gets bedded into; `hi - lo` is how much of its height the
       far end of the dune is going to eat, which the builder then
       pays for by making it taller. */
    const survey = (cx, cz, halfL, halfW, yaw) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let a = 0; a < 16; a += 1) {
        for (let k = 1; k <= 3; k += 1) {
          const ang = (a / 16) * TAU;
          const [wx, wz] = toWorld(cx, cz, yaw,
            Math.cos(ang) * halfL * (k / 3), Math.sin(ang) * halfW * (k / 3));
          const y = H(wx, wz);
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      }
      return { lo, hi, relief: hi - lo };
    };

    /* Bed a large rotated mass into the sand by its LOWEST support.
       `restOnTerrain`'s 35th-percentile-with-a-10cm-clamp is right
       for a two-metre boulder, where a little burial beats a little
       gap; on something a hundred metres long the same clamp cannot
       reach, and the quantile guarantees that roughly a third of
       the footprint is in open air by construction. Here the whole
       base ring goes under, with margin - the fin carries a keel
       below its sand line specifically so it can afford to. */
    const bedIn = (geo, x, z, yaw, sink) => {
      kit.transform(geo, { rot: [0, yaw, 0] });
      geo.computeBoundingBox();
      const p = geo.attributes.position;
      const bb = geo.boundingBox;
      const band = bb.min.y + (bb.max.y - bb.min.y) * 0.45;
      let lowest = Infinity;
      for (let i = 0; i < p.count; i += 1) {
        if (p.getY(i) > band) continue;
        const g = H(x + p.getX(i), z + p.getZ(i));
        if (g < lowest) lowest = g;
      }
      if (!Number.isFinite(lowest)) lowest = H(x, z);
      geo.translate(x, lowest - sink, z);
      return geo;
    };

    /* Three characters, because fifteen copies of one recipe is a
       row of identical fins whichever way the recipe is tuned.
       `tail` is how far the downwind edge sweeps forward as it
       rises (the streamlining), `widthPow`/`crest` are how fast the
       flanks fall away and how much back is left at the top - a
       knife-edged fin, a rounded whaleback, a stubby flat-topped
       block that has barely started to be carved. */
    const CHARACTERS = [
      { w: 0.44, id: "fin", lenK: [4.0, 5.2], widK: [0.55, 0.80], tail: 0.42, brow: 0.11, widthPow: 1.75, crest: 0.09, flutes: 9 },
      { w: 0.36, id: "whaleback", lenK: [4.6, 6.0], widK: [1.15, 1.70], tail: 0.31, brow: 0.15, widthPow: 2.60, crest: 0.32, flutes: 7 },
      { w: 0.20, id: "block", lenK: [2.6, 3.4], widK: [0.95, 1.35], tail: 0.20, brow: 0.05, widthPow: 3.40, crest: 0.34, flutes: 6 },
    ];

    let tries = 0;
    while (placed.length < 15 && tries < 9000) {
      tries += 1;
      const x = rng.range(-MAP_HALF + 190, MAP_HALF - 190);
      const z = rng.range(-MAP_HALF + 190, MAP_HALF - 190);

      const surf = field.surfaceAt(x, z);
      if (surf.sand < 0.72) continue;
      if (nearRoad(x, z) < 78) continue;
      if (inDistrictAt(x, z)) continue;
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

      const kind = rng.weighted(CHARACTERS);
      const stand = rng.range(20, 44);            // wanted height above the sand
      const len = stand * rng.range(kind.lenK[0], kind.lenK[1]);
      const wid = stand * rng.range(kind.widK[0], kind.widK[1]);
      const yaw = WIND + rng.jit(0.22);

      /* Yardangs form on flat pans and in interdune corridors, not
         draped over a dune crest - so a site whose own footprint
         rolls through more than a dozen metres is simply the wrong
         landform, and rejecting it is cheaper than trying to build
         a fin that survives it. */
      const ground = survey(x, z, len * 0.5, wid * 0.5, yaw);
      if (ground.relief > 13) continue;

      const sink = 2.2;
      /* Built tall enough to still stand `stand` metres proud of the
         HIGHEST ground under it, not the average. Bedding into the
         lowest support is what makes the fin watertight against the
         dunes; charging the whole of that back to its height is what
         stops the fix quietly turning fifteen landmarks into fifteen
         half-drowned lumps. */
      const h = stand + sink + ground.relief;
      const keel = Math.max(9, h * 0.38);

      const LEVELS = 13;
      // Even, so the prow and the tail both terminate on a vertex
      // and read as edges rather than as flat cut-off faces; high
      // enough that a 5:1 ellipse sampled at uniform angle still
      // puts ten points down each long flank instead of four.
      const SIDES = 22;
      const rings = [];

      // The keel. Below the sand line, full section and mildly
      // flared: it is what lets `bedIn` bury the base ring outright
      // without a plinth ever surfacing on the low side.
      rings.push({ y: -keel, rx: len * 0.53, rz: wid * 0.53, sides: SIDES, jitter: 0.04, seed: rng.int(1, 1e6) });
      rings.push({ y: -keel * 0.42, rx: len * 0.515, rz: wid * 0.515, sides: SIDES, jitter: 0.05, seed: rng.int(1, 1e6) });

      for (let k = 0; k <= LEVELS; k += 1) {
        const t = k / LEVELS;                    // 0 = sand line, 1 = crest
        /* The two edges are shaped SEPARATELY, and that asymmetry
           is the whole read: the upwind brow pulls back barely at
           all, so the prow stands as a near-vertical face, while
           the downwind edge sweeps a long way forward, so the tail
           lies down. Half a fin's length is still there at the top,
           which is what makes a ridge instead of an apex. */
        const front = 0.5 - kind.brow * Math.pow(t, 1.7);
        const back = -(0.5 - kind.tail * Math.pow(t, 1.15));
        // A scoured waist just above the sand. Wind carries its
        // load lowest, so this is where a real fin is thinnest -
        // and an overhang at the base is most of what separates
        // "carved out of" from "set down on".
        const waist = 1 - 0.15 * Math.exp(-(((t - 0.14) / 0.11) ** 2));
        const width = Math.max(kind.crest,
          Math.pow(Math.max(0, 1 - Math.pow(t, kind.widthPow)), 0.62));
        rings.push({
          y: t * h,
          rx: len * 0.5 * (front - back) * waist,
          rz: wid * 0.5 * width * waist,
          cx: len * 0.5 * (front + back),
          sides: SIDES,
          jitter: 0.06,
          seed: rng.int(1, 1e6),
        });
      }

      const g = kit.ringSolid(rings);
      /* FLUTES AND NOTCHES, in local space while the fin's length
         still runs along +X.

         `roughen` alone cannot do this job: it moves every vertex
         by the same field in all three axes, which rounds the
         silhouette off and leaves the flanks as the same long
         horizontal strips the rings drew. A flute has to be a
         groove IN a face - displacement along the surface, biased
         by |z| so the crest line and the keel stay exactly where
         the profile put them and only the flanks between them
         ripple. That is the term that breaks the layer-cake read,
         because it runs UP the slope where the ring seams run
         across it. */
      const fk = TAU / (len / kind.flutes);
      const fphase = rng() * TAU;
      const fluteAmp = wid * 0.15;
      const nk = TAU / (len * rng.range(0.30, 0.42));
      const nphase = rng() * TAU;
      const notchAmp = h * rng.range(0.10, 0.19);
      const vp = g.attributes.position;
      for (let i = 0; i < vp.count; i += 1) {
        const vx = vp.getX(i);
        const vy = vp.getY(i);
        const vz = vp.getZ(i);
        if (vy < 0) continue;                    // the buried keel stays plain
        const t = clamp01(vy / h);
        const s = vz < 0 ? -1 : 1;
        /* Rectified, not a plain sine: a groove is cut INTO a face
           and the rock between two of them is flat, so the profile
           wants a flat top and sharp troughs rather than a smooth
           corrugation. The `vy` term rakes each groove as it climbs,
           which is what stops the set of them reading as a fluted
           column. */
        const rake = vx * fk + vy * 0.055 + fphase;
        const wave = Math.abs(Math.sin(rake)) ** 0.55 - 0.62
          + Math.sin(rake * 2.7 + fphase * 1.7) * 0.22;
        const gain = fluteAmp * sstep(0, 0.20, t) * (1 - 0.7 * sstep(0.60, 1, t));
        // Saddles along the back. A crest that is one clean arc from
        // prow to tail is the other half of why the old shape read
        // as manufactured; real fins are notched where the wind has
        // found a weakness.
        const notch = notchAmp * (0.5 + 0.5 * Math.sin(vx * nk + nphase))
          * sstep(0.52, 1, t);
        vp.setXYZ(i, vx, vy - notch, vz + s * wave * gain);
      }
      vp.needsUpdate = true;
      g.computeVertexNormals();
      kit.roughen(g, h * 0.030, 0.048);
      kit.roughen(g, h * 0.012, 0.14);
      /* Flat-shaded, and the last step before painting so the vertex
         colours land per facet too. Twenty-two sides is the density
         a hundred-metre ellipse needs to stop going polygonal, and
         at that density SMOOTH normals hand back a beanbag: every
         crease the flutes and the notches just cut gets averaged
         into its neighbours and the fin reads as a boulder someone
         inflated. Faceting is also what puts it in the same visual
         language as the rim massifs behind it, which are coarse
         enough to read as planes without needing this. */
      const solid = kit.facet(g);

      bedIn(solid, x, z, yaw, sink);
      paintH(solid, ROCK_RAMP, {
        normalWeight: 0.55, jitter: 0.18, noise: 0.3, bias: 0.1,
      });
      geos.push(solid);

      /* Talus. The same cue the Windgate's footings use, and the
         cheapest one there is: a mass this size has been shedding
         blocks for as long as it has been standing, and a scatter
         of them where it meets the sand is what a viewer reads as
         "in the ground" rather than "on it". Set just outside the
         footprint so none of them are swallowed by the fin. */
      for (let i = 0; i < rng.int(9, 16); i += 1) {
        const ang = rng() * TAU;
        const k = rng.range(1.02, 1.34);
        const [dx, dz] = toWorld(x, z, yaw,
          Math.cos(ang) * len * 0.5 * k, Math.sin(ang) * wid * 0.5 * k);
        if (inDistrictAt(dx, dz)) continue;
        if (field.surfaceAt(dx, dz).sand < 0.5) continue;
        const character = rng();
        const sc = rng.range(0.9, 3.4);
        const block = kit.crag(rng, {
          height: sc * rng.range(0.5, 1.2), radius: sc,
          layers: rng.int(3, 6), sides: rng.int(5, 8), lean: rng.range(0, 0.5), sink: 0.4,
          spike: character < 0.3 ? rng.range(0.2, 0.5) : 0,
          cliff: character >= 0.3 && character < 0.58 ? rng.range(0.3, 0.7) : 0,
        });
        restOnTerrain(block, dx, dz, { rot: [rng.jit(0.35), rng() * TAU, rng.jit(0.35)], maxGap: 0.08 });
        paintH(block, ROCK_RAMP, { normalWeight: 0.5, jitter: 0.22, noise: 0.35 });
        geos.push(block);
      }

      placed.push([x, z]);
    }
    if (geos.length) {
      batch.add("scatter", "rock", mergeGeometries(THREE, geos), { castShadow: true });
    }
  }

  /* ============================================================
     THE WINDGATE

     A natural stone arch, wind-carved from one outcrop into two legs
     and a span, standing alone in open desert well clear of every
     named district - a found thing rather than a built one, the way
     a real arch in a real desert is something you come across, not
     something anyone's civilisation put there.

     It deliberately does NOT compete with the Saint's head for the
     map's ONE dominant landmark: a third of the height, no
     minimap-radius announcement, nothing narrative attached. It is
     the reward for wandering off the road, not a tenth destination.
     ============================================================ */
  await step("Raising the Windgate", 0.955);
  {
    const rng = makeRng(0xc0da2e);

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
    // Every named district plus a wide margin - see the file header:
    // this is deliberately not a tenth destination competing with
    // them, so it needs room of its own rather than a corner of
    // someone else's.
    const inAnyDistrict = (x, z) => Object.values(DISTRICTS)
      .some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 100);
    /* THE SITE IS A SADDLE, NOT A CLEARING.

       An arch standing alone on flat sand reads as a prop set down in
       the desert. The ones worth photographing sit IN something - a
       gap between two rises, walls either side of the walk through.
       So the search does not stop at the first flat, clear point; it
       samples a ring of bearings around each candidate and scores how
       much the ground climbs on BOTH opposite sides at once, keeping
       the best of a batch of tries rather than the first passable
       one. The span is then laid out ALONG the low corridor between
       the two rises - the direction perpendicular to where the
       ground climbs - so a player walking through has higher ground
       to their left and right the whole way, and the two footings
       land on the corridor floor rather than on its flanking slope. */
    const RISE_PROBE = 45;
    const scoreSaddle = (x, z) => {
      const centreY = H(x, z);
      let best = null;
      for (let bDeg = 0; bDeg < 180; bDeg += 15) {
        const b = (bDeg * Math.PI) / 180;
        const dx = Math.cos(b), dz = Math.sin(b);
        const yA = H(x + dx * RISE_PROBE, z + dz * RISE_PROBE);
        const yB = H(x - dx * RISE_PROBE, z - dz * RISE_PROBE);
        const bothRise = Math.min(yA - centreY, yB - centreY);
        if (!best || bothRise > best.bothRise) best = { bearing: b, bothRise };
      }
      return best;
    };

    let site = null;
    let bestScore = -Infinity;
    for (let tries = 0; tries < 90; tries += 1) {
      const x = 280 + rng.range(-70, 70);
      const z = 420 + rng.range(-70, 70);
      if (inAnyDistrict(x, z)) continue;
      if (nearRoad(x, z) < 140) continue;
      const surf = field.surfaceAt(x, z);
      if (surf.sand < 0.5) continue;               // open dune, not rocky floor
      const saddle = scoreSaddle(x, z);
      // The span axis runs perpendicular to the rise direction - along
      // the corridor floor, not up either wall - so the two footings
      // are what actually needs to stay level, not the raw local slope
      // at the centre point.
      const corridorYaw = saddle.bearing + Math.PI / 2;
      const cyaw = Math.cos(corridorYaw), syaw = Math.sin(corridorYaw);
      const HALF_SPAN_PROBE = 17;
      const footingDrop = Math.abs(
        H(x + cyaw * HALF_SPAN_PROBE, z + syaw * HALF_SPAN_PROBE)
        - H(x - cyaw * HALF_SPAN_PROBE, z - syaw * HALF_SPAN_PROBE)
      );
      if (footingDrop > 6) continue;                // too steep for two stable legs
      // Rewards a real saddle, penalises an unstable one - the same
      // trade the refinement probe that found this shape used.
      const score = saddle.bothRise - footingDrop * 2.5;
      if (score > bestScore) {
        bestScore = score;
        site = { x, z, yaw: corridorYaw, bothRise: saddle.bothRise };
      }
    }
    // A saddle worth the name rises at least a storey on both sides.
    // Below that, open ground is the honest fallback rather than
    // forcing a marginal site a terrain reseed might make worse.
    if (site && site.bothRise < 8) site = null;
    if (!site) {
      for (let tries = 0; tries < 120 && !site; tries += 1) {
        const x = 280 + rng.range(-90, 90);
        const z = 420 + rng.range(-90, 90);
        if (inAnyDistrict(x, z)) continue;
        if (nearRoad(x, z) < 140) continue;
        const surf = field.surfaceAt(x, z);
        if (surf.sand < 0.5) continue;
        const S = 8;
        const slope = Math.hypot(
          (H(x + S, z) - H(x - S, z)) / (2 * S), (H(x, z + S) - H(x, z - S)) / (2 * S)
        );
        if (slope > 0.22) continue;
        site = { x, z, yaw: 0.58, bothRise: 0 };
      }
    }
    if (site) {
      const HALF_SPAN = 17;
      const yaw = site.yaw;                        // span axis bearing
      const cy = Math.sin(yaw);
      const cx = Math.cos(yaw);

      // Real footing heights, not an assumed-flat pair - the whole
      // reason this is built in world-relative coordinates instead
      // of a symmetric local template. A hand-tilted template would
      // have to guess the slope; this reads it.
      const siteY = H(site.x, site.z);
      const legAx = site.x - cx * HALF_SPAN;
      const legAz = site.z - cy * HALF_SPAN;
      const legBx = site.x + cx * HALF_SPAN;
      const legBz = site.z + cy * HALF_SPAN;
      const legAy = H(legAx, legAz) - siteY;
      const legBy = H(legBx, legBz) - siteY;

      // Asymmetric on purpose - Delicate Arch and every real one like
      // it has a heavier leg and a more attenuated one, never a
      // mirror. Leg A is the monument; leg B is the survivor.
      //
      // Height cut from 26 to 16 against a wider 17m half-span - a
      // deliberately LOW, broad silhouette instead of a tall peaked
      // one. The waypoint layout below is all expressed as fractions
      // of `archHeight`, so this one number reshapes the whole thing:
      // the legs now climb through the same fraction of a shorter
      // rise and the crown sits closer over the footings than above
      // them, which is what stops a wind-carved arch reading as a
      // gothic one.
      const archHeight = 16;
      const baseRadiusA = 7.6;
      const baseRadiusB = 6.0;
      const crownRadius = 2.35;
      const zWobbleAmp = rng.range(0.6, 1.2);
      const zWobbleK = rng.range(1.1, 1.5);
      const zWobblePhase = rng() * TAU;

      /* WAYPOINTS, NOT ONE SMOOTH CURVE.

         A single cubic through two control points is a section of
         one continuous bend, and no choice of control points ever
         stopped reading as a slice of a circle - a hoop, not a leg
         standing up into a span. A real arch's silhouette is closer
         to three straight-ish runs joined by two tight knuckles: a
         leg that rises PLUMB, a knuckle where it turns over, a span
         that runs across closer to level than to round, a second
         knuckle, a second leg. Catmull-Rom through explicit points
         gives that directly - each segment can be as straight or as
         sharp as the two points either side of it say, which a
         two-control-point bezier cannot express no matter how they
         are placed. Asymmetric on purpose: leg A is the short, high,
         near-vertical "monument" side; leg B reaches further out at
         a shallower angle, the "worn" side a real arch always has. */
      const W = [
        [-HALF_SPAN, legAy],
        [-HALF_SPAN * 0.92, legAy + archHeight * 0.34],
        [-HALF_SPAN * 0.62, legAy + archHeight * 0.70],
        [-HALF_SPAN * 0.20, archHeight * 1.02],
        [HALF_SPAN * 0.18, archHeight * 0.90],
        [HALF_SPAN * 0.55, archHeight * 0.62],
        [HALF_SPAN * 0.86, legBy + archHeight * 0.26],
        [HALF_SPAN, legBy],
      ];
      const catmullRom = (p0, p1, p2, p3, t) => {
        const t2 = t * t, t3 = t2 * t;
        return 0.5 * ((2 * p1)
          + (-p0 + p2) * t
          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
          + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      };
      const at = (i) => W[Math.max(0, Math.min(W.length - 1, i))];
      const sampleU = (segT, seg) => catmullRom(at(seg - 1)[0], at(seg)[0], at(seg + 1)[0], at(seg + 2)[0], segT);
      const sampleV = (segT, seg) => catmullRom(at(seg - 1)[1], at(seg)[1], at(seg + 1)[1], at(seg + 2)[1], segT);

      /* Sixty segments, not thirty. `rockTube`'s parallel-transport
         frame only turns as fast as consecutive points make it, so
         path resolution is what keeps that turn small ring to ring -
         thirty was coarse enough, over this much curvature, that even
         a continuous frame still swept several degrees a step near
         the tightest part of the bend. */
      const N = 60;
      const SEGS = W.length - 1;
      const points = [];
      const radii = [];
      for (let i = 0; i <= N; i += 1) {
        const tGlobal = (i / N) * SEGS;
        const seg = Math.min(SEGS - 1, Math.floor(tGlobal));
        const segT = tGlobal - seg;
        const u = sampleU(segT, seg);
        const v = sampleV(segT, seg);
        const t = i / N;
        const w = zWobbleAmp * Math.sin(t * Math.PI * zWobbleK + zWobblePhase) * Math.sin(t * Math.PI);
        points.push([u, v, w]);
        // Thick through roughly a third of each leg, tapering over a
        // short, clearly-visible middle stretch rather than a long
        // flat run at crown radius - an earlier pass held minimum
        // thickness across more than half the path and read as
        // uniformly worm-thin rather than as a taper at all.
        const distFromEnd = Math.min(t, 1 - t) * 2;
        const thickness = 1 - smoothstep(0.05, 0.34, distFromEnd);
        const nearA = 1 - t;
        radii.push(lerp(crownRadius, lerp(baseRadiusB, baseRadiusA, nearA), thickness));
      }

      /* Surface irregularity without regularity. Zero phase drift
         over a long, constant-side-count sweep prints dead-straight,
         evenly-spaced ribs the whole way round - corrugated pipe, not
         eroded stone, and the tell was obvious even from the hero
         shot. A LOW-FREQUENCY drift (not the sharp per-ring random
         walk `crag()` uses over three rings, which tore the surface
         over sixty of them) rotates which ridge is most prominent as
         the path runs, which is what keeps a real weathered surface
         from repeating. */
      const archGeo = kit.rockTube(rng, points, radii, { sides: 10, jitter: 0.11, phaseDrift: 0.045 });
      kit.roughen(archGeo, 0.16, 0.09);
      kit.roughen(archGeo, 0.36, 0.024);
      paintH(archGeo, ROCK_RAMP, { normalWeight: 0.58, jitter: 0.16, noise: 0.28 });
      kit.transform(archGeo, { pos: [site.x, siteY, site.z], rot: [0, yaw, 0] });

      const dressGeos = [archGeo];

      // A scatter of broken debris at both footings - talus a real
      // arch has shed at its own base, and the same visual cue that
      // stops a boulder floating: something smaller and irregular
      // sitting where the big mass meets the sand.
      for (const [lx, lz, ly] of [[legAx, legAz, legAy], [legBx, legBz, legBy]]) {
        for (let i = 0; i < rng.int(4, 7); i += 1) {
          const a = rng() * TAU;
          const d = rng.range(2.5, 9);
          const dx = lx + Math.cos(a) * d;
          const dz = lz + Math.sin(a) * d;
          if (inAnyDistrict(dx, dz)) continue;
          const character = rng();
          const s = rng.range(0.7, 2.6);
          const g = kit.crag(rng, {
            height: s * rng.range(0.5, 1.2), radius: s,
            layers: rng.int(3, 5), sides: rng.int(5, 7), lean: rng.range(0, 0.5), sink: 0.4,
            spike: character < 0.35 ? rng.range(0.2, 0.5) : 0,
            cliff: character >= 0.35 && character < 0.6 ? rng.range(0.3, 0.7) : 0,
          });
          restOnTerrain(g, dx, dz, { rot: [rng.jit(0.3), rng() * TAU, rng.jit(0.3)], maxGap: 0.08 });
          paintH(g, ROCK_RAMP, { normalWeight: 0.5, jitter: 0.22, noise: 0.35 });
          dressGeos.push(g);
          void ly;
        }
      }

      batch.add("windgate", "rock", mergeGeometries(THREE, dressGeos), { castShadow: true, collisionSolid: true });
      pois.push({ id: "windgate", name: "The Windgate", x: site.x, z: site.z });
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

      /* VARIETY. Every one of these used to be `layers: 3` with the
         plain wind-cut profile and nothing else - which collapses,
         at these small sizes, toward the same near-symmetric dome or
         pyramid every time. Three thousand four hundred repeats of
         one silhouette is the whole "boulders repeat too much"
         complaint by itself, and it has a second, uglier consequence
         at golden hour: with so few rings there are too few facets
         for the sun to catch some and miss others, so the ENTIRE
         shadow side lands on nearly one flat, uniform dark value -
         no internal edge, no break, nothing to read as a faceted
         solid rather than a flat dark shape standing in for a hole.
         More rings buys back exactly the internal value variation a
         low-poly rock needs to read as one in its own cast shadow.

         The cliff/spike/bench mixing already proven on the rim
         massifs (see the belt loop above) is reused here rather than
         invented twice - about a third of boulders now take a
         near-vertical broken-strata profile or a spiked one instead
         of the default wind-cut dome. */
      const character = rng();
      const isCliff = character < 0.28;
      const isSpiked = !isCliff && character < 0.40;
      const s = Math.pow(rng(), 2.1) * 2.6 + 0.22;
      const g = kit.crag(rng, {
        height: s * rng.range(0.5, 1.3), radius: s,
        layers: rng.int(3, 6), sides: rng.int(5, 8), lean: rng.range(0, 0.5), sink: 0.4,
        spike: isSpiked ? rng.range(0.15, 0.55) : 0,
        cliff: isCliff ? rng.range(0.35, 0.85) : 0,
        benches: (isCliff && rng.chance(0.4)) ? rng.int(1, 2) : 0,
      });
      /* Real debris does not all sit bolt upright - a boulder that
         rolled to a stop leans. `restOnTerrain` (not `place`) rests
         each one against its OWN lower envelope wherever it actually
         landed, sampling several points across its footprint rather
         than the single centre height `place` used - which is what
         let a wide boulder's downhill edge hang in open air over a
         real dune slope. It also means the tilt below cannot produce
         a floating corner: the resting logic runs AFTER the tilt is
         applied, against the tilted shape. */
      const tiltX = rng.jit(0.35);
      const yaw = rng() * TAU;
      const tiltZ = rng.jit(0.35);
      /* Boss-arena keep-clear, applied AFTER every rng draw for this
         crag so culling one never re-times the stream - cull earlier
         and all 3,400 downstream boulders silently re-scatter. */
      if (Math.hypot(x - MATRIARCH_ARENA.x, z - MATRIARCH_ARENA.z)
        < MATRIARCH_ARENA.flatRadius + 22) continue;
      if (Math.hypot(x - STYLITE_ARENA.x, z - STYLITE_ARENA.z)
        < STYLITE_ARENA.flatRadius + 9) continue;
      /* AND THE GARNER'S PIT, for a different reason than the arenas:
         not that a boulder would be in the way, but that the ground it
         is resting on IS NOT THERE LATER. Every prop is seated by
         `restOnTerrain` against the pan as it stands at load, with the
         funnel's amplitude still zero; when the encounter opens and
         terrain.js drives `garnerReveal` to 1, the floor under these
         drops up to sixteen metres and leaves them hanging in the
         middle of the hole. Measured at r=6-10m: solid tops at y≈1.5
         over a pit floor at y≈-14.7.

         Bounded by the rim rather than by `reach` (62m): inside the
         rim the bowl cuts down, outside it the spoil lip only RISES,
         and a boulder that ends up slightly buried reads as a boulder
         while one hanging in the air reads as a bug. The Ossuary's own
         debris loop has always re-rolled out of this circle - see the
         GARNER_PIT test there; the map-wide scatter simply never
         learned about it. */
      if (Math.hypot(x - GARNER_PIT.x, z - GARNER_PIT.z)
        < GARNER_PIT.rimRadius + 6) continue;
      restOnTerrain(g, x, z, { rot: [tiltX, yaw, tiltZ], maxGap: 0.08 });
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
  const meshes = batch.flush().concat(authoredMeshes);

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
    choirNeedles,
    authoredLandmarks,
    pois,
    beautyShots,
    walkSurfaceAt,
    walkSurfaceMaxInCircle,
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
