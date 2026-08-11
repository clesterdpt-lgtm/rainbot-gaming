/* ============================================================
   BLACKSAND - buildings, walls and static props

   A modular kit rather than authored meshes: walls, floors, roofs,
   doorways, stairs and parapets, assembled procedurally into five
   distinct building archetypes plus a set-dressing library. Every
   piece registers its own physics collider as it is placed, so the
   thing you can see and the thing you can hit are generated from one
   call and cannot drift apart.

   Two things decide whether this reads as a place people live in
   rather than as grey-box prototype geometry:

   1. DEPTH IN THE SILHOUETTE. A wall with a hole in it is a
      prototype. A wall with a protruding sill, a lintel band, a
      string course at the floor line, a drainpipe down the corner and
      a water tank on the roof is a building. Almost all of the extra
      geometry here exists to break the outline against the sky, which
      is where a screenshot is won.

   2. TONE. Plaster is a mid-tone material - roughly 45-60% grey. The
      first pass tinted everything at 58-82% lightness and the town
      read as polystyrene. The palette below is deliberately darker and
      more varied, and every wall carries a vertex-colour ramp so its
      base is grimier than its head. That ramp is free: it rides on the
      colour attribute the merge pass already needs.

   BUDGET. Geometry is merged into buckets keyed by material AND by a
   coarse spatial cell. Merging per material alone gives one draw call
   for the whole town - and one bounding sphere, so the entire town is
   drawn every frame no matter where the camera looks. Cells cost a few
   dozen extra calls and buy back real frustum culling, which is the
   better trade once the kit carries this much detail. Repeated props
   go through the same merge rather than through InstancedMesh for the
   same reason: merged props cost zero additional draw calls, an
   instanced prop type costs one each.
   ============================================================ */

import { makeRng, clamp, lerp } from "./core.js";
import { LAYER, SURFACE } from "./physics.js";

/**
 * Render/plaster colours. Sampled off Middle-Eastern street
 * photography rather than generated from an HSL range: a random hue
 * sweep produces pastel mush, a curated list produces a street where
 * neighbouring buildings disagree with each other.
 */
const PLASTER = [
  0x9d8f76, 0xa89877, 0x8b7d64, 0xb0a184, 0x7d7260,
  0xa2957e, 0x8f7a5e, 0xb5a88c, 0x857a6b, 0x9c8468,
  0x8e8a7c, 0xa6906f, 0x77705f, 0xb2a385,
];

/** Rarer accents so a street is not uniformly ochre. */
const ACCENT = [0x7f8c86, 0x6f7166, 0x9a6f5a, 0x8a8fa0, 0xa8a08b];

/** Corrugated sheet, roller shutters, tanks. */
const SHEET = [0x6e6a60, 0x7a6c58, 0x5f6a6c, 0x6b5f52];

/**
 * Canopy and tarpaulin fabrics - the only saturated colour in the set,
 * used sparingly so a market reads as a market.
 *
 * Faded, and by a measured amount. These were authored as if the
 * numbers were sRGB paint chips: 0x8a4436 looks like a muted brick red
 * typed out, and in the LINEAR space where a tint multiplies its map it
 * is saturation 0.855. The set averaged 0.731, which made cloth the
 * most chromatic thing in the town - above sand (0.487), above
 * blockwall (0.563), above every masonry surface - and the canopies are
 * the largest flat areas in the market frame.
 *
 * Same hues, same relative positions, chroma pinned at 0.62 and value
 * lifted 1.22x to keep them from going muddy: sun-rotted cloth rather
 * than a fresh dye lot. Set mean 0.731 -> 0.620.
 *
 * Stated narrowly on purpose. The obvious way to report this would be
 * "sandbag's effective albedo saturation fell", and it did not - it
 * measures 0.813 before and 0.818 after, because the sandbag material
 * dresses far more sandbags than canopies and the bucket mean is set by
 * the sand-coloured ones. The canopies are a large share of the market
 * frame and a small share of that material's vertices, so the only
 * honest number here is the palette's own.
 */
const FABRIC = [0x976760, 0x4a6975, 0x867a55, 0x744954, 0x4d6841, 0x977e60];

/** Wrecked civilian cars. Bleached paint over rust. */
const CAR_PAINT = [0x8f8a80, 0x6e7a80, 0x8a6a58, 0x7a7c6a, 0x9a9288];

export async function createStructures(ctx) {
  const { THREE, render, materials, terrain, settings, textures } = ctx;
  const rng = makeRng(ctx.seed ^ 0x51de51de);

  /* The terrain's own macro-variation field, borrowed rather than
   * duplicated. It is a 512x512 DataTexture that is already synthesised
   * and already uploaded before structures are built, so reusing it for
   * the low-frequency breakup on walls costs zero additional texture
   * memory - only one sampler slot and one fetch. See injectMacro(). */
  const macroTexture = textures.get("macro").map;

  const group = new THREE.Group();
  group.name = "structures";
  render.scene.add(group);

  /* --------------------- geometry accumulation --------------------- */

  /**
   * Merge cell size. 176m over a 1024m map puts each objective and
   * its surroundings in one or two cells, which is the granularity
   * that actually culls: smaller cells multiply draw calls for no gain
   * because a player standing in a town sees most of it anyway.
   */
  const CELL = 176;
  const buckets = new Map();
  let pieceCount = 0;
  let colliderCount = 0;
  let chamferCount = 0;

  function bucketFor(materialName, x, z) {
    const ix = Math.floor((x + 512) / CELL);
    const iz = Math.floor((z + 512) / CELL);
    const key = `${materialName}|${ix}|${iz}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: materialName, geometries: [], labels: null };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * Provenance index, for `?probe=1` only.
   *
   * Every piece is merged into a shared buffer, so a raycast against
   * the finished town tells you "structures-concrete" and nothing else.
   * That is useless when the fault you are chasing is "which of the
   * ninety call sites put a slab in mid-air". With the flag on, each
   * piece records the call stack that placed it and the triangle range
   * it occupies; `identify()` maps a raycast hit straight back to the
   * source line. Off by default because capturing a stack per piece
   * costs about a second over seven thousand pieces.
   */
  const PROBE = typeof location !== "undefined"
    && new URLSearchParams(location.search).get("probe") === "1";

  function callSite() {
    const stack = (new Error().stack || "").split("\n");
    // 0 "Error", 1 callSite, 2 pushPiece, 3 box/mesh, 4+ the caller.
    // Module URLs carry the boot loader's cache-busting query
    // (`structures.js?v=20260803-01:1234:5`), so the line number is not
    // adjacent to the extension. Matching on ".js:<digits>" silently
    // matched nothing at all and every label came back empty.
    const frames = [];
    for (let i = 4; i < stack.length && frames.length < 3; i += 1) {
      const where = stack[i].match(/([\w-]+\.js)(?:\?[^\s:)]*)?:(\d+):\d+/);
      if (!where) continue;
      const who = stack[i].match(/at\s+(?:async\s+)?([\w.<>$]+)\s+\(/);
      frames.push(`${who ? who[1] : "?"}@${where[1]}:${where[2]}`);
    }
    return frames.join(" < ");
  }

  /** Single entry point into a bucket, so the provenance index cannot
   *  drift out of step with the geometry order the merge relies on. */
  function pushPiece(materialName, x, z, geometry) {
    const bucket = bucketFor(materialName, x, z);
    bucket.geometries.push(geometry);
    if (PROBE) {
      if (!bucket.labels) bucket.labels = [];
      const index = geometry.index;
      const tris = index
        ? index.count / 3
        : geometry.attributes.position.count / 3;
      bucket.labels.push({ tris, from: callSite() });
    }
    pieceCount += 1;
  }

  const _matrix = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _pos = new THREE.Vector3();
  const _bbox = new THREE.Box3();

  function shade(colour, factor, cool = 0) {
    const c = new THREE.Color(colour).multiplyScalar(factor);
    if (cool) {
      c.b = clamp(c.b * (1 + cool), 0, 1);
      c.r = clamp(c.r * (1 - cool * 0.6), 0, 1);
    }
    return c.getHex();
  }

  /* A `backlit()` helper lived here for one round and was removed after
   * being measured, because the fault it was written for does not
   * exist. The reasoning was that `shade(fabric, 2.3)` on a canopy
   * underside must be clipping - 0x8a's red channel is 138 and 138 x
   * 2.3 is 317 - and that the clip was arriving as a hue rotation.
   *
   * It is not. `Color.multiplyScalar` works in the LINEAR working
   * space, where 0x8a is 0.254, and the largest FABRIC channel at the
   * largest gain used anywhere reaches 0.59. Nothing in this file
   * clips. A helper that rolled the overflow into white would have been
   * byte-identical to `shade` on every input it is ever given, i.e. a
   * knob that looks tuned and is inert - which this file has a standing
   * rule against. The real defect in the canopies was two rng.pick
   * calls, and it is fixed where it happened. */

  /**
   * Bake a vertical colour ramp into vertex colours.
   *
   * The merged mesh has one material, so per-piece colour has to live
   * in the vertex stream. Two colours rather than one costs nothing
   * extra and buys the single most valuable wear cue there is: every
   * wall gets dirtier towards the ground, which is what stops a row of
   * buildings reading as extruded rectangles.
   */
  function paint(geometry, top, bottom) {
    const position = geometry.attributes.position;
    const count = position.count;
    const colours = new Float32Array(count * 3);
    const cTop = new THREE.Color(top);
    if (bottom === null || bottom === undefined) {
      for (let i = 0; i < count; i += 1) {
        colours[i * 3] = cTop.r; colours[i * 3 + 1] = cTop.g; colours[i * 3 + 2] = cTop.b;
      }
    } else {
      const cBot = new THREE.Color(bottom);
      geometry.computeBoundingBox();
      const y0 = geometry.boundingBox.min.y;
      const span = Math.max(1e-3, geometry.boundingBox.max.y - y0);
      for (let i = 0; i < count; i += 1) {
        const t = (position.getY(i) - y0) / span;
        colours[i * 3] = lerp(cBot.r, cTop.r, t);
        colours[i * 3 + 1] = lerp(cBot.g, cTop.g, t);
        colours[i * 3 + 2] = lerp(cBot.b, cTop.b, t);
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  }

  /** Rescale UVs so tiling is in world units rather than per-face. */
  function scaleUv(geometry, su, sv) {
    const uv = geometry.attributes.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    uv.needsUpdate = true;
  }

  /**
   * Per-material phase quantisation for the UV jitter.
   *
   * Without an offset every box starts sampling its texture at (0,0),
   * so the same eight brick courses and the same four columns appear on
   * every pier in the town - the reviewer's "brick tone sequence
   * repeats identically about every eight bricks". A free random offset
   * fixes the repetition but tears the courses: bricks on neighbouring
   * piers no longer line up and the wall reads as broken UVs instead.
   *
   * The fix is to jitter in whole cells of whatever grid the texture
   * was authored on. blockwall is 8 rows x 4 columns per tile, so
   * offsets in multiples of 1/8 and 1/4 move the pattern by exactly one
   * course or one brick and the coursing survives. Materials with no
   * grid (plaster, concrete, sand) take a free continuous offset.
   */
  const UV_PHASE = {
    blockwall: [4, 8],      // cols, rows per tile
    plaster: [4, 7],        // the blockwork its spall exposes
    /* 4 tie-rod columns x 7 formwork boards. This said 5 boards, which
     * stopped being true when the generator went to 7, and a phase
     * quantised to fifths of a seven-board tile tears the board lines it
     * exists to keep continuous. */
    concrete: [4, 7],
    corrugated: [0, 0],     // profile must stay continuous across a run
    sandbag: [0, 0],
  };

  /**
   * World size, in metres, of one texture tile - for the materials whose
   * generator authored a real construction grid into it.
   *
   * MEASURED, not assumed. `scripts/blacksand-scale-probe.mjs` reads
   * metres-per-UV-unit straight off the merged buffers the scene draws
   * and multiplies by the generator's own grid. Before this table it
   * found blockwall at SIX different rates between 0.62m and 2.86m a
   * tile: courses of 7.7cm on a sill, 10.4cm on a reveal, 15.9cm on a
   * plinth and 34.7cm on the wall panel all three are attached to. So
   * the fault was never "one tile at the wrong scale" - it was that no
   * scale was being asserted at all, and `uvScale` (authored per call
   * site as "how fine should this piece look") was setting the size of
   * the blocks.
   *
   * The panels carry most of the screen area, which is why a reviewer
   * reading the wall called the bricks "~40cm tall". They were 34.7cm.
   * That is not a brick (7.5cm course) and not a block (19cm); it is
   * nothing, and it matters more than it sounds. Masonry is the one
   * object in a frame whose true size every viewer knows without being
   * told, so it silently calibrates everything around it. At 1.8x
   * oversize every building behind it reads as a doll's house and the
   * viewer feels it without being able to name it. No lighting change
   * reaches that - it is authoring.
   *
   * So a material with a construction grid gets its rate fixed here, in
   * world units, and the caller's `uvScale` is ignored for it. That is
   * the point: a block wall's blocks are the same size on the sill, on
   * the pier and on the parapet, because in the real world they came off
   * the same pallet.
   */
  const TILE_METRES = {
    // 4 columns x 8 rows -> 385 x 192mm, a standard dense block.
    blockwall: 1.54,
    // 4 x 7. Lime render over blockwork, and its spall exposes the
    // courses underneath, so its hidden grid has to agree with
    // blockwall's 192mm course or a patched wall shows two buildings.
    plaster: 1.345,
    // 7 formwork boards -> 300mm, the top of the real range and the
    // closest to where it already was, because this generator is the
    // one thing a reviewer has ever called the best material in the set
    // and the brief is not to break it. Tie rods land at 525mm, day
    // joints at 1.05m; both were outside their real ranges before.
    concrete: 2.10,
  };

  /** UV units per metre for a piece. A material with a construction
   *  grid ignores the caller's `uvScale`; see TILE_METRES. */
  function uvRate(materialName, uvScale) {
    const tile = TILE_METRES[materialName];
    return tile ? 1 / tile : uvScale;
  }

  /**
   * The phase draws from its own stream, not from `rng`.
   *
   * Pulling it off the main generator would advance that generator once
   * per box - about seven thousand extra draws - and every layout
   * decision downstream would land differently. The town is seeded, so
   * the point of a seed is that a texturing change does not silently
   * rebuild the map underneath the change you are trying to judge.
   */
  const uvRng = makeRng(ctx.seed ^ 0x2b1d7a03);

  /** Same reasoning as `uvRng`: per-bay colour variation must not
   *  perturb the layout stream. */
  const toneRng = makeRng(ctx.seed ^ 0x5f3a19c7);

  /**
   * Materials whose texture has a GRAIN - a directional pattern that
   * has to follow the piece rather than the box's local axes.
   *
   * Timber is sawn along its length: the rings run down a post and
   * along a beam, always parallel to the long side. BoxGeometry hands
   * every face u = width, v = height, so a vertical post got the grain
   * running horizontally, round it like a barber pole. At the wood
   * generator's old pitch those were 6.7cm bands at 2.0x linear
   * contrast crossing a 10cm post - the "orange and dark red swirl"
   * that read as flame or polished marble across the whole market.
   *
   * The fix is per face, not per piece, because a piece has three
   * different long axes depending on which side you are looking at: on
   * a post the two long faces need the swap and the end grain does not.
   * Costs nothing at runtime - it is two reads and a branch at build
   * time, and three derives the tangent frame from the UVs it is given,
   * so the normal map follows without any extra work.
   */
  const GRAIN_AXIS = new Set(["wood"]);

  function uvPhase(materialName) {
    const grid = UV_PHASE[materialName];
    if (grid && grid[0] === 0) return [0, 0];
    if (!grid) return [uvRng(), uvRng()];
    return [uvRng.int(0, grid[0] - 1) / grid[0], uvRng.int(0, grid[1] - 1) / grid[1]];
  }

  function scaleBoxUv(geometry, size, uvScale, materialName) {
    const uv = geometry.attributes.uv;
    const rate = uvRate(materialName, uvScale);
    const [ou, ov] = uvPhase(materialName);
    /* Break the bond at the arris.
     *
     * BoxGeometry gives every face its own 0..1 UV, so all four sides of
     * a pier start their coursing at the same phase and a corner shows
     * the same block meeting its own mirror image - the reviewer's
     * "wraps corners with no trim or corner detail". Real coursing
     * interlocks at a corner: alternate faces present a header where the
     * other presents a stretcher, which is a half-block shift. It is
     * free, and it is the difference between a built corner and a sheet
     * of wallpaper folded round one.
     */
    const grid = UV_PHASE[materialName];
    const half = grid && grid[0] ? 0.5 / grid[0] : 0;
    const grain = GRAIN_AXIS.has(materialName);
    const faceScales = [
      [size.z, size.y, half], [size.z, size.y, half],   // +X, -X
      [size.x, size.z, 0], [size.x, size.z, 0],         // +Y, -Y
      [size.x, size.y, 0], [size.x, size.y, 0],         // +Z, -Z
    ];
    for (let face = 0; face < 6; face += 1) {
      const [fu, fv, shift] = faceScales[face];
      // See GRAIN_AXIS: put the piece's long side on u, whichever way
      // the box was built.
      const swap = grain && fv > fu;
      const su = swap ? fv : fu;
      const sv = swap ? fu : fv;
      for (let i = 0; i < 4; i += 1) {
        const index = face * 4 + i;
        const px = uv.getX(index);
        const py = uv.getY(index);
        uv.setXY(index,
          (swap ? py : px) * su * rate + ou + shift,
          (swap ? px : py) * sv * rate + ov);
      }
    }
    uv.needsUpdate = true;
  }

  /**
   * A box with its four VERTICAL arrises cut back by `c` metres.
   *
   * The reviewer: "every silhouette is an unbevelled axis-aligned box,
   * so no edge ever catches a rim of light". It is right, and the
   * cheapest honest answer is a real chamfer - a 4.5cm face at 45
   * degrees on each corner, which picks up the sun when the two faces
   * either side of it cannot, and which reads as a dressed corner
   * rather than a mitre. Only the vertical arrises: they are the ones
   * that stand against the sky, and cutting the horizontal ones as well
   * would double the cost for edges that are mostly buried or capped.
   *
   * 28 triangles against a box's 12, so this is gated by size at the
   * call site - a windowsill neither needs it nor could show it.
   *
   * UVs come out in METRES (u around the perimeter, v up from the base)
   * so `scaleMetricUv` can apply the same world rate and phase the plain
   * path uses. Running u continuously around the perimeter is deliberate
   * here: the chamfer face physically interrupts the bond, so the
   * coursing can carry on across it without reading as wrapped.
   */
  function chamferedBox(size, c) {
    const hx = size.x * 0.5;
    const hy = size.y * 0.5;
    const hz = size.z * 0.5;
    // Plan outline as an octagon, clockwise seen from above so the side
    // quads wind outward.
    const plan = [
      [hx, hz - c], [hx, -hz + c], [hx - c, -hz], [-hx + c, -hz],
      [-hx, -hz + c], [-hx, hz - c], [-hx + c, hz], [hx - c, hz],
    ];
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let run = 0;

    for (let i = 0; i < plan.length; i += 1) {
      const [ax, az] = plan[i];
      const [bx, bz] = plan[(i + 1) % plan.length];
      const ex = bx - ax;
      const ez = bz - az;
      const len = Math.hypot(ex, ez);
      if (len < 1e-5) continue;
      // Outward normal of a clockwise-in-plan edge.
      const nx = ez / len;
      const nz = -ex / len;
      const base = positions.length / 3;
      positions.push(ax, -hy, az, bx, -hy, bz, bx, hy, bz, ax, hy, az);
      for (let k = 0; k < 4; k += 1) normals.push(nx, 0, nz);
      uvs.push(run, 0, run + len, 0, run + len, size.y, run, size.y);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      run += len;
    }

    // Caps. A fan off vertex 0 rather than a centre vertex: an octagon
    // is convex, so the fan is valid and costs two fewer triangles.
    for (const top of [true, false]) {
      const y = top ? hy : -hy;
      const base = positions.length / 3;
      for (const [px, pz] of plan) {
        positions.push(px, y, pz);
        normals.push(0, top ? 1 : -1, 0);
        uvs.push(px, top ? pz : -pz);
      }
      for (let i = 1; i < plan.length - 1; i += 1) {
        if (top) indices.push(base, base + i, base + i + 1);
        else indices.push(base, base + i + 1, base + i);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  /** Turn metre-space UVs into tile space at the material's own rate. */
  function scaleMetricUv(geometry, materialName, uvScale) {
    const uv = geometry.attributes.uv;
    const rate = uvRate(materialName, uvScale);
    const [ou, ov] = uvPhase(materialName);
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * rate + ou, uv.getY(i) * rate + ov);
    }
    uv.needsUpdate = true;
  }

  /**
   * Arris cut, in metres. 45mm is what a mason's chamfer or a cast
   * arris fillet actually measures; larger starts reading as a bevelled
   * prop and smaller disappears past about 8m.
   */
  const CHAMFER = 0.045;

  /** Wall-sized, upright, and thick enough that a 45mm cut does not eat
   *  the piece. Sills, copings, lintels and trim fail this on purpose. */
  function chamferFor(size) {
    if (size.y < 1.4) return 0;
    const thin = Math.min(size.x, size.z);
    if (thin < 0.18 || Math.max(size.x, size.z) < 0.45) return 0;
    return Math.min(CHAMFER, thin * 0.20);
  }

  /**
   * Place a box of geometry and (optionally) its collider.
   *
   * `uvScale` matters: a merged mesh has one material, so per-piece
   * tiling has to be baked into the UVs at build time. Without it a
   * 12m wall and a 0.4m windowsill sample the texture at the same
   * rate and the sill looks like a photograph of a wall.
   */
  function box(materialName, options) {
    const {
      position, size, rotationY = 0, rotationX = 0, rotationZ = 0,
      surface = SURFACE.CONCRETE, collide = true, layer = LAYER.STATIC,
      uvScale = 0.35, opaque = true, penetrable = 0,
      tint = null, tintBottom = null,
    } = options;

    // The chamfer is a shading and silhouette change only; the collider
    // below is still the full box, because 45mm is an order of magnitude
    // under anything the capsule can feel.
    const chamfer = options.chamfer === undefined ? chamferFor(size) : options.chamfer;
    let geometry;
    if (chamfer > 0.004) {
      geometry = chamferedBox(size, chamfer);
      scaleMetricUv(geometry, materialName, uvScale);
      chamferCount += 1;
    } else {
      geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      scaleBoxUv(geometry, size, uvScale, materialName);
    }
    if (tint !== null) paint(geometry, tint, tintBottom);

    _quat.setFromEuler(_euler.set(rotationX, rotationY, rotationZ, "YXZ"));
    _matrix.compose(_pos.copy(position), _quat, _scale.set(1, 1, 1));
    geometry.applyMatrix4(_matrix);
    pushPiece(materialName, position.x, position.z, geometry);

    if (collide) {
      ctx.physics.addBox({
        center: position,
        halfExtents: new THREE.Vector3(size.x * 0.5, size.y * 0.5, size.z * 0.5),
        quaternion: _quat.clone(),
        layer,
        surface,
        opaque,
        penetrable,
      });
      colliderCount += 1;
    }
    return geometry;
  }

  /**
   * Place arbitrary (non-box) geometry - cylinders for drums, poles,
   * tanks and pipes. The collider is derived from the untransformed
   * bounding box, so a drum still hits like a drum without the caller
   * having to state its extents twice.
   */
  function mesh(materialName, geometry, options) {
    const {
      position, rotationY = 0, rotationX = 0, rotationZ = 0,
      surface = SURFACE.METAL, collide = true, layer = LAYER.STATIC,
      uv = null, opaque = true, penetrable = 0,
      tint = null, tintBottom = null, colliderScale = 1,
    } = options;

    if (uv) scaleUv(geometry, uv[0], uv[1]);
    if (tint !== null) paint(geometry, tint, tintBottom);

    geometry.computeBoundingBox();
    _bbox.copy(geometry.boundingBox);

    _quat.setFromEuler(_euler.set(rotationX, rotationY, rotationZ, "YXZ"));
    _matrix.compose(_pos.copy(position), _quat, _scale.set(1, 1, 1));
    geometry.applyMatrix4(_matrix);
    pushPiece(materialName, position.x, position.z, geometry);

    if (collide) {
      const centre = _bbox.getCenter(new THREE.Vector3()).applyQuaternion(_quat).add(position);
      const half = _bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5 * colliderScale);
      ctx.physics.addBox({
        center: centre,
        halfExtents: half,
        quaternion: _quat.clone(),
        layer,
        surface,
        opaque,
        penetrable,
      });
      colliderCount += 1;
    }
    return geometry;
  }

  /** Cylinder helper. `axis: "z"` lays it down along its own local Z
   *  so a yaw aligns it with a pipe run or an axle. */
  function cylinder(materialName, options) {
    const {
      radiusTop, radiusBottom, height,
      segments = 10, open = false, axis = "y", uvScale = 0.4,
    } = options;
    // A tapered cylinder (the dome on a fuel tank, a pole that narrows)
    // is specified with radiusTop/radiusBottom and no `radius`. The UV
    // rate below used `radius` directly, so those calls scaled every UV
    // by NaN - which the merge happily swallowed and the sampler
    // resolved to black. Three fuel tanks in the establishing shot had
    // solid black lids because of it. Derive the rate from whatever the
    // caller actually gave.
    const rTop = radiusTop ?? options.radius;
    const rBottom = radiusBottom ?? options.radius;
    const radius = (rTop + rBottom) * 0.5;
    const geometry = new THREE.CylinderGeometry(
      rTop, rBottom, height, segments, 1, open
    );
    if (axis === "z") geometry.rotateX(Math.PI * 0.5);
    // Same world lock as box(): a concrete pipe and the concrete wall
    // behind it must not show two different board pitches.
    const rate = uvRate(materialName, uvScale);
    /* A cylinder's u runs round the circumference and its v runs along
     * the axis, so a grain material lands its rings AROUND the piece -
     * a telegraph pole banded like a barber pole every 12cm. Swap the
     * attribute so u is the axis, same rule as scaleBoxUv. */
    if (GRAIN_AXIS.has(materialName) && geometry.attributes.uv) {
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) {
        const px = uv.getX(i);
        uv.setXY(i, uv.getY(i), px);
      }
      uv.needsUpdate = true;
      return mesh(materialName, geometry, {
        ...options,
        uv: [height * rate, Math.PI * 2 * radius * rate],
      });
    }
    return mesh(materialName, geometry, {
      ...options,
      uv: [Math.PI * 2 * radius * rate, height * rate],
    });
  }

  /* --------------------- contact occlusion --------------------- */

  /**
   * Ground-contact darkening under everything that sits on the sand.
   *
   * The sun shadow map is one 460m-wide cascade at 3072 - about 15cm a
   * texel - with a 35cm depth bias behind it. At that rate a building
   * still throws a long shadow but nothing SMALL does, and worse,
   * nothing has any darkening where it MEETS the ground: the shadow
   * detaches by half a metre and every prop reads as pasted onto lit
   * sand. That is exactly the reviewer's "rocks sit on a sun-raked dune
   * with nothing beneath them".
   *
   * This is the fix BF2 itself shipped: a soft multiply blob under each
   * object. It is ambient occlusion, not a sun shadow - symmetric, and
   * therefore correct at every time of day, which a baked directional
   * shadow would not be. Vertex colours carry the falloff so no texture
   * and no alpha channel are needed, and the blobs merge into the same
   * spatial cells as everything else, so the whole town costs a handful
   * of draw calls.
   *
   * Requests are queued rather than built, because the terrain is still
   * being carved while structures are placed: a decal baked against the
   * height field at placement time ends up hanging in the air as soon
   * as a neighbour flattens its own pad.
   */
  const contactRequests = [];
  let contactBlobCount = 0;
  let unseatedCount = 0;
  const CONTACT_LIFT = 0.05;

  /**
   * Global trim on the blob strength.
   *
   * The first pass ran each blob at 0.45-0.62 and the town went black.
   * The arithmetic is unforgiving: these MULTIPLY, so a prop standing
   * beside a wall inside a compound stacks three of them and 0.5 each
   * becomes 0.125 of the light. Contact occlusion in real daylight is
   * a 15-25% loss under an overhang and almost nothing two metres out;
   * anything stronger stops reading as shading and starts reading as a
   * black tarpaulin on the sand, which is exactly what happened.
   */
  const CONTACT_TRIM = 0.34;

  /**
   * `halfX`/`halfZ` are the object's OWN FOOTPRINT half-extents - the
   * silhouette where it meets the sand - not the size of the blob.
   * The blob is built larger than that; see buildContactShadows().
   *
   * This used to be "roughly how big to make the shadow", and every
   * call site padded it by a different amount (1.1x for a sandbag
   * wall, 2.4x across a jersey barrier). With the falloff keyed off
   * the silhouette that padding became an error term, so the call
   * sites now pass the real thing and the padding lives in one place.
   */
  function contactShadow(x, z, halfX, halfZ = halfX, rotationY = 0, strength = 0.5, atY = null) {
    if (!(halfX > 0.05) || !(halfZ > 0.05)) return;
    contactBlobCount += 1;
    contactRequests.push({
      x, z, halfX, halfZ, rotationY,
      strength: strength * CONTACT_TRIM, atY,
    });
  }

  /**
   * Where the darkening is placed, and why this was rebuilt.
   *
   * The first version spread a 7x7 grid over the whole request and ran
   * the falloff as `(1 - d^2)^3` on the normalised radius. Measured on
   * the built mesh, that curve delivers:
   *
   *     d 0.00  17.8%      d 0.67   3.9%
   *     d 0.33  12.8%      d 1.00   1.0%
   *
   * The object's own silhouette sits near d = 0.75, so every prop got
   * about 3% of darkening where it touches the sand and its full 18%
   * in the middle - underneath itself, where nothing can see it. A
   * close-range framebuffer probe agreed exactly: ground luma 2cm from
   * a prop's base divided by ground luma 2m away came back 1.02, i.e.
   * no contact term at all, and hiding the blobs entirely changed that
   * number by 0.000. The reviewer's "objects are shadowed but not
   * seated" was not a strength problem and not a tier problem. The
   * occlusion was being drawn in the one place it could not be seen.
   *
   * So the shape is now a plateau plus a skirt: full strength across
   * the footprint, and the ramp runs OUTWARD from the silhouette over
   * `margin` metres. The peak value is unchanged - deliberately, since
   * these multiply and the stacking arithmetic in CONTACT_TRIM above
   * still holds - it has only moved to the rim.
   *
   * Vertex rows are placed non-uniformly for the same reason: an even
   * grid spends its resolution on the plateau, which is constant and
   * needs none, and leaves two or three rows for the ramp. Rows land
   * exactly on the silhouette and at 0.32 / 0.66 / 1.0 of the skirt,
   * which is where the curve actually bends. 64 vertices a blob.
   */
  function buildContactShadows() {
    for (const r of contactRequests) {
      const plateauX = r.halfX;
      const plateauZ = r.halfZ;
      // Ground AO reaches out about as far as the occluder is wide,
      // but a whole building does not need a 6m skirt - past a metre
      // or so the sky is unobstructed enough that nothing reads.
      const margin = clamp(0.26 + 0.30 * Math.min(plateauX, plateauZ), 0.30, 1.30);
      const extentX = plateauX + margin;
      const extentZ = plateauZ + margin;

      // Symmetric rows in local metres: the outer rim, two steps
      // through the skirt, then both sides of the silhouette. The
      // middle quad IS the plateau and is left unsubdivided because
      // its four corners all carry the same value.
      const STEPS = [1, 0.66, 0.32, 0];
      const rowFor = (plateau) => [
        ...STEPS.map((s) => -(plateau + s * margin)),
        ...STEPS.slice().reverse().map((s) => plateau + s * margin),
      ];
      const rowX = rowFor(plateauX);
      const rowZ = rowFor(plateauZ);
      const N = rowX.length;
      const positions = new Float32Array(N * N * 3);
      const colours = new Float32Array(N * N * 3);
      const indices = [];
      const cos = Math.cos(r.rotationY);
      const sin = Math.sin(r.rotationY);
      for (let j = 0; j < N; j += 1) {
        for (let i = 0; i < N; i += 1) {
          const lx = rowX[i];
          const lz = rowZ[j];
          const wx = r.x + lx * cos + lz * sin;
          const wz = r.z - lx * sin + lz * cos;
          const k = (j * N + i) * 3;
          positions[k] = wx;
          positions[k + 1] = (r.atY === null ? terrain.heightAt(wx, wz) : r.atY) + CONTACT_LIFT;
          positions[k + 2] = wz;

          // Distance OUTSIDE the footprint rectangle, in metres, as a
          // fraction of the skirt. Zero everywhere on and inside the
          // silhouette. Taking the two axes in quadrature rounds the
          // corners, which is what a real contact shadow does and what
          // the old max-norm did not.
          const ox = Math.max(0, Math.abs(lx) - plateauX);
          const oz = Math.max(0, Math.abs(lz) - plateauZ);
          const t = Math.min(1, Math.sqrt(ox * ox + oz * oz) / margin);
          const f = 1 - t;
          const occ = f * f * Math.sqrt(f);
          const shade01 = 1 - r.strength * occ;
          colours[k] = shade01;
          colours[k + 1] = shade01 * 0.99;   // a touch warmer than neutral:
          colours[k + 2] = shade01 * 1.03;   // sky fill in shade is blue
        }
      }
      for (let j = 0; j < N - 1; j += 1) {
        for (let i = 0; i < N - 1; i += 1) {
          const a = j * N + i;
          indices.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      geometry.setIndex(indices);
      pushPiece("__contact", r.x, r.z, geometry);
    }
    contactRequests.length = 0;
  }

  /* ---------------------------- seating ---------------------------- */

  /**
   * The Y a prop of this footprint should stand at, and how uneven the
   * ground under it is.
   *
   * Every ground prop in this file used to sit at
   * `terrain.heightAt(x, z)` - the height at its CENTRE. On flat sand
   * that is right. On a dune it is not: a 2.4m jersey barrier across a
   * surface that drops 0.5m over that span is placed with its middle
   * on the ground and BOTH ENDS in the air, and a close-range capture
   * of one caught it hanging half a metre clear of the slope with sky
   * visible underneath. That is the reviewer's "objects are shadowed
   * but not seated" in its most literal possible form, and no amount
   * of contact-shadow work reaches it - the shadow was being drawn
   * correctly, on ground the prop was nowhere near.
   *
   * Seating on the LOWEST sample rather than the mean is deliberate.
   * A prop whose base is buried a few centimetres reads as settled
   * into the sand, which is what a real one does; a prop floating by
   * the same few centimetres reads as broken. The two failures are
   * not symmetric, so the bias is not either.
   *
   * `drop` is returned so a caller can refuse ground it cannot sit on
   * at all - burying a barrier in a 45 degree dune face is not an
   * improvement on floating over it.
   */
  function seat(x, z, halfX, halfZ = halfX, rotationY = 0) {
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    let min = Infinity;
    let max = -Infinity;
    for (let j = -1; j <= 1; j += 1) {
      for (let i = -1; i <= 1; i += 1) {
        const lx = i * halfX;
        const lz = j * halfZ;
        const h = terrain.heightAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    return { y: min, drop: max - min };
  }

  /* ------------------------------ kit ------------------------------ */

  const WALL_THICKNESS = 0.34;
  const STOREY = 3.15;

  /** Unit vectors for a wall built along `angle`. Local +Z runs along
   *  the wall, local +X is its outward normal. */
  function wallBasis(angle) {
    return {
      dirX: Math.sin(angle), dirZ: Math.cos(angle),
      nX: Math.cos(angle), nZ: -Math.sin(angle),
    };
  }

  /**
   * Local plan coordinates to world, using the SAME handedness as the
   * Y-Euler that `box()` applies (local +X -> (cos, -sin)).
   *
   * The first pass used the opposite sign on the z row, so a
   * rectangular plan was laid out mirrored relative to the boxes placed
   * into it: floor slabs missed their own walls and a stair ran out of
   * the side of the building. It only shows up when width != depth,
   * which is why it survived a square test case.
   */
  function planner(x, z, rotation) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return (lx, lz, y = 0) => new THREE.Vector3(
      x + lx * cos + lz * sin, y, z - lx * sin + lz * cos
    );
  }

  /** Wall angle of face `side` of a rectangular plan, where side 0 is
   *  the -Z face and sides run anticlockwise in plan. */
  const sideAngle = (rotation, side) => rotation + Math.PI * 0.5 - side * Math.PI * 0.5;

  /** Midpoint (in plan coordinates) and length of face `side`. */
  function faceInfo(side, halfW, halfD) {
    switch (side) {
      case 0: return { lx: 0, lz: -halfD, length: halfW * 2 };
      case 1: return { lx: halfW, lz: 0, length: halfD * 2 };
      case 2: return { lx: 0, lz: halfD, length: halfW * 2 };
      default: return { lx: -halfW, lz: 0, length: halfD * 2 };
    }
  }

  /**
   * A wall segment with any number of openings cut into it, built from
   * piers, lintels and sills rather than from CSG.
   *
   * `openings` are given as fractions along the wall so a caller can
   * space three windows evenly without knowing the wall length.
   */
  function wall(materialName, options) {
    const {
      start, end, height, surface = SURFACE.CONCRETE,
      tint = null, tintBottom = null, thickness = WALL_THICKNESS,
      collide = true,
    } = options;
    let openings = options.opening ? [options.opening] : (options.openings || []);

    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return null;
    const angle = Math.atan2(dx, dz);
    const cx = (start.x + end.x) * 0.5;
    const cz = (start.z + end.z) * 0.5;
    const baseY = start.y;
    const { dirX, dirZ } = wallBasis(angle);

    const at = (u) => new THREE.Vector3(cx + dirX * u, 0, cz + dirZ * u);

    // Resolve fractional positions to local offsets and drop any that
    // will not fit; a 0.9m window in a 1.2m wall makes a wall of air.
    const cuts = [];
    for (const o of openings) {
      const width = Math.min(o.width ?? 1.1, length - 0.9);
      if (width < 0.4) continue;
      const u = clamp((o.at ?? 0.5) * length - length * 0.5, -length * 0.5 + width * 0.5 + 0.35, length * 0.5 - width * 0.5 - 0.35);
      cuts.push({ u, width, sill: o.sill ?? 0, top: Math.min(o.top ?? 2.15, height), spec: o });
    }
    cuts.sort((a, b) => a.u - b.u);

    /* Per-pier tone jitter.
     *
     * A facade is built from piers either side of each opening, and
     * every one of them was handed the building's single tint. Combined
     * with the texture starting at UV zero on each, that made the whole
     * elevation one flat swatch - the reviewer's "brick tone sequence
     * repeats identically". Real render and blockwork is patched: each
     * bay has been repaired at a different time and holds a slightly
     * different colour. Two percent either side is too little to read
     * as stripes and enough to stop the wall reading as printed. */
    const pier = (u0, u1) => {
      const len = u1 - u0;
      if (len < 0.06) return;
      const p = at((u0 + u1) * 0.5);
      const bay = toneRng.range(0.94, 1.07);
      box(materialName, {
        position: new THREE.Vector3(p.x, baseY + height * 0.5, p.z),
        size: new THREE.Vector3(thickness, height, len),
        rotationY: angle, surface, collide,
        tint: tint === null ? null : shade(tint, bay),
        tintBottom: tintBottom === null || tintBottom === undefined
          ? tintBottom : shade(tintBottom, bay),
      });
    };

    let cursor = -length * 0.5;
    for (const cut of cuts) {
      pier(cursor, cut.u - cut.width * 0.5);
      cursor = cut.u + cut.width * 0.5;
      const p = at(cut.u);
      if (height - cut.top > 0.05) {
        box(materialName, {
          position: new THREE.Vector3(p.x, baseY + cut.top + (height - cut.top) * 0.5, p.z),
          size: new THREE.Vector3(thickness, height - cut.top, cut.width),
          rotationY: angle, surface, tint, tintBottom: tint, collide,
        });
      }
      if (cut.sill > 0.05) {
        box(materialName, {
          position: new THREE.Vector3(p.x, baseY + cut.sill * 0.5, p.z),
          size: new THREE.Vector3(thickness, cut.sill, cut.width),
          rotationY: angle, surface, tint, tintBottom, collide,
        });
      }
    }
    pier(cursor, length * 0.5);

    return { angle, length, cuts, at, baseY };
  }

  /**
   * Dress an opening: reveal frame, protruding sill, lintel band,
   * glass, and the water stain that runs from the sill downwards.
   *
   * None of these carry colliders. Every one of them is either flush
   * with, or protrudes less than 0.25m from, a wall that already has
   * one - a collider per sill would triple the physics broadphase for
   * a bump nobody can stand on.
   */
  function dressOpening(opts) {
    const {
      centre, angle, y, width, height, materialName,
      tint, detail = 2, glass = true, shutter = false, arch = false,
    } = opts;
    const { nX, nZ } = wallBasis(angle);
    const out = (d) => new THREE.Vector3(centre.x + nX * d, 0, centre.z + nZ * d);
    const trim = shade(tint, 1.12);
    const dark = shade(tint, 0.16, 0.35);

    // Sill: protrudes both faces, so it casts a line of shade across
    // the wall and breaks the flatness even in silhouette.
    if (opts.sillY !== undefined) {
      box(materialName, {
        position: new THREE.Vector3(centre.x, opts.sillY, centre.z),
        size: new THREE.Vector3(WALL_THICKNESS + 0.30, 0.11, width + 0.34),
        rotationY: angle, uvScale: 0.9, collide: false, tint: trim,
      });
    }
    // Lintel band above the head.
    box(materialName, {
      position: new THREE.Vector3(centre.x, y + height + 0.11, centre.z),
      size: new THREE.Vector3(WALL_THICKNESS + 0.20, 0.20, width + 0.52),
      rotationY: angle, uvScale: 0.9, collide: false, tint: trim,
    });

    /* Reveal, ALWAYS - this is the whole difference between an
       aperture and a rectangle painted on a wall.
       The wall is 0.34m thick and the glass sits on its centre line,
       so there is 0.14m of returned wall on each side of every
       opening. Four thin boxes, unlit on the sun side and self-shading
       on the other, and the facade gains a real shadow line per
       window.

       This used to sit inside `if (detail >= 2)`, along with the
       surround. A blind reviewer picked out one of our buildings for
       having "recessed window reveals with a dark interior - the
       correct standard" and condemned others in the same set as "pure
       black quads flush with the wall, no reveal, no frame, no
       self-shadow". Both were true, and they were the same code: the
       good ones were the detail-2 buildings near an objective and the
       bad ones were the detail-1 filler along the roads, which a
       player walks straight past. Depth is not a decoration that can
       be dropped at range - it is what the opening IS. The surround
       and the staining below are decoration and stay tiered. */
    const rev = out(WALL_THICKNESS * 0.25);
    const revDark = shade(tint, 0.62, 0.06);
    for (const side of [-1, 1]) {
      box(materialName, {
        position: new THREE.Vector3(
          rev.x + Math.sin(angle) * side * (width * 0.5 - 0.03),
          y + height * 0.5,
          rev.z + Math.cos(angle) * side * (width * 0.5 - 0.03)
        ),
        size: new THREE.Vector3(WALL_THICKNESS * 0.5, height, 0.06),
        rotationY: angle, uvScale: 1.6, collide: false, tint: revDark,
      });
    }
    box(materialName, {
      position: new THREE.Vector3(rev.x, y + height - 0.03, rev.z),
      size: new THREE.Vector3(WALL_THICKNESS * 0.5, 0.06, width),
      rotationY: angle, uvScale: 1.6, collide: false,
      tint: shade(tint, 0.42, 0.08),
    });

    if (detail >= 1) {
      /* Surround, proud of the outer face.
         The first pass placed two vertical jambs and stopped, so the
         opening was framed on its left and right and open at top and
         bottom - which, seen at an angle with a lintel band crossing
         above it, reads as an L rather than as a window. A frame has to
         close: jambs, head and cill return, all in the same plane and
         the same width, or the eye does not accept it as an aperture.
         The cost is two more boxes on an object that already has four. */
      const jamb = 0.10;
      const proud = WALL_THICKNESS * 0.5 + 0.05;
      const p = out(proud);
      for (const side of [-1, 1]) {
        box(materialName, {
          position: new THREE.Vector3(
            p.x + Math.sin(angle) * side * (width * 0.5 + jamb * 0.5),
            y + height * 0.5,
            p.z + Math.cos(angle) * side * (width * 0.5 + jamb * 0.5)
          ),
          size: new THREE.Vector3(0.12, height + jamb * 2, jamb),
          rotationY: angle, uvScale: 1.2, collide: false, tint: trim,
        });
      }
      for (const edge of [-1, 1]) {
        box(materialName, {
          position: new THREE.Vector3(p.x, y + height * 0.5 + edge * (height * 0.5 + jamb * 0.5), p.z),
          size: new THREE.Vector3(0.12, jamb, width + jamb * 2),
          rotationY: angle, uvScale: 1.2, collide: false, tint: trim,
        });
      }
      // Corbelled head: two chamfer blocks read as an arch at any
      // distance a player actually sees the building from, for a
      // fraction of the triangles a real arch costs.
      if (arch) {
        for (const side of [-1, 1]) {
          const a = out(WALL_THICKNESS * 0.5 + 0.03);
          box(materialName, {
            position: new THREE.Vector3(
              a.x + Math.sin(angle) * side * width * 0.32,
              y + height - 0.10,
              a.z + Math.cos(angle) * side * width * 0.32
            ),
            size: new THREE.Vector3(0.10, 0.42, width * 0.40),
            rotationY: angle, rotationZ: side * 0.30,
            uvScale: 1.2, collide: false, tint: trim,
          });
        }
      }
    }

    // Water staining below the sill. A thin panel with the dark end at
    // the top is exactly the shape rain makes on render, and it is the
    // cheapest believable dirt there is.
    if (detail >= 2 && opts.sillY !== undefined && rng.chance(0.7)) {
      const p = out(WALL_THICKNESS * 0.5 + 0.015);
      const drop = rng.range(0.8, 2.0);
      box(materialName, {
        position: new THREE.Vector3(p.x, opts.sillY - 0.06 - drop * 0.5, p.z),
        size: new THREE.Vector3(0.03, drop, width * rng.range(0.55, 0.95)),
        rotationY: angle, uvScale: 1.4, collide: false,
        tint: shade(tint, 0.86, 0.06), tintBottom: shade(tint, 0.44, 0.22),
      });
    }

    /* Glass, set back on the wall's centre line so the reveal above
       reads as depth. Penetrable and non-opaque so bullets and AI sight
       pass through while players still cannot walk through a window.

       Two things were wrong with the first version and both showed up
       badly in stills. It sampled the metal set at uvScale 0.5, so a
       1.2m pane covered barely half a texture tile and every window
       displayed one enormous blotch of scratched steel - at a glance,
       a photograph of rock pasted into the hole. And it was flat, one
       tint top to bottom, which no daylight glazing ever is.

       Real glass seen from outside is a mirror of the sky at the top
       and of the dark ground and interior at the bottom. That gradient
       is free here: the vertex ramp `paint()` already bakes for walls
       does it, pale sky at the head into near-black at the cill. It is
       the difference between a hole and a window. */
    if (glass && !shutter) {
      const shut = rng.chance(0.22);
      box("metal", {
        position: new THREE.Vector3(centre.x, y + height * 0.5, centre.z),
        size: new THREE.Vector3(0.05, height - 0.06, width - 0.06),
        rotationY: angle, uvScale: 5.0, surface: SURFACE.GLASS,
        tint: shut ? dark : 0x8199ad,
        tintBottom: shut ? shade(dark, 0.6) : 0x141a20,
        penetrable: 0.9, opaque: false,
      });
      // Glazing bar. One horizontal transom turns a black rectangle
      // into a window at any distance you can see the pane at all.
      box(materialName, {
        position: new THREE.Vector3(centre.x, y + height * 0.55, centre.z),
        size: new THREE.Vector3(0.07, 0.05, width - 0.06),
        rotationY: angle, uvScale: 2.5, collide: false, tint: trim,
      });
    }
    /* A back to the hole.
     *
     * `interior()` returns early below detail 1, so on filler
     * buildings a doorway - which never gets glass - is a clean cut
     * straight through the shell to the landscape on the far side.
     * One dark plane set behind the reveal costs two triangles and
     * turns it into the dark interior the reviewer asked for. */
    if (detail < 1 && !glass && !shutter) {
      const back = out(-WALL_THICKNESS * 0.35);
      box(materialName, {
        position: new THREE.Vector3(back.x, y + height * 0.5, back.z),
        size: new THREE.Vector3(0.05, height, width),
        rotationY: angle, uvScale: 1.0, collide: false,
        tint: dark, tintBottom: shade(dark, 0.5),
      });
    }

    // Roller shutter, part-closed. Reads instantly as a shopfront.
    if (shutter) {
      const drop = rng.range(0.35, 0.9) * height;
      box("metal", {
        position: new THREE.Vector3(centre.x, y + height - drop * 0.5, centre.z),
        size: new THREE.Vector3(0.07, drop, width - 0.05),
        rotationY: angle, uvScale: 1.8, surface: SURFACE.METAL,
        tint: rng.pick(SHEET), penetrable: 0.6,
      });
    }
  }

  /** Horizontal band at a floor line. One box per facade, and the most
   *  cost-effective silhouette break in the whole kit. */
  function stringCourse(materialName, centre, angle, length, y, tint, depth = 0.16) {
    box(materialName, {
      position: new THREE.Vector3(centre.x, y, centre.z),
      size: new THREE.Vector3(WALL_THICKNESS + depth * 2, 0.18, length + 0.12),
      rotationY: angle, uvScale: 0.8, collide: false, tint: shade(tint, 1.1),
    });
  }

  /** Cast-iron downpipe with brackets. Vertical lines on a facade are
   *  what stop it reading as a texture swatch. */
  function drainpipe(x, z, baseY, height, tint) {
    cylinder("metal", {
      position: new THREE.Vector3(x, baseY + height * 0.5, z),
      radius: 0.075, height, segments: 6, collide: false,
      surface: SURFACE.METAL, tint: shade(tint, 0.5, 0.1),
    });
    // Hopper head at the top.
    box("metal", {
      position: new THREE.Vector3(x, baseY + height - 0.12, z),
      size: new THREE.Vector3(0.24, 0.26, 0.24),
      uvScale: 1.6, collide: false, tint: shade(tint, 0.55, 0.1),
    });
  }

  /**
   * Flat roof with a parapet - the defining silhouette of the setting
   * and, more practically, the rooftop firing positions the mode needs.
   * The coping oversails the wall by 0.18m so the roof line reads as a
   * shadow band rather than as an edge.
   */
  function roof(materialName, options) {
    const {
      center, size, y, parapet = 0.9, rotationY = 0,
      tint = 0xffffff, damaged = 0,
    } = options;

    box(materialName, {
      position: new THREE.Vector3(center.x, y + 0.15, center.z),
      size: new THREE.Vector3(size.x, 0.30, size.z),
      rotationY, surface: SURFACE.CONCRETE, uvScale: 0.3,
      tint: shade(tint, 0.78),
    });
    // Oversailing coping.
    box(materialName, {
      position: new THREE.Vector3(center.x, y + 0.36, center.z),
      size: new THREE.Vector3(size.x + 0.36, 0.14, size.z + 0.36),
      rotationY, uvScale: 0.5, collide: false, tint: shade(tint, 1.08),
    });

    if (parapet <= 0) return;

    /* Plan-to-world, in the SAME handedness `box()` applies.
     *
     * This used (ox*cos - oz*sin, ox*sin + oz*cos), which rotates the
     * offset by MINUS rotationY while the box itself is rotated by
     * plus it. On a square roof the four runs are symmetric and nothing
     * shows. On a rectangular one - which is every building here - the
     * parapets end up swung 2*rotationY away from their own roof and
     * hang in mid-air beside it. That is the slab floating over the
     * compound. Identical to the bug `planner()` documents; it survived
     * in here because this function predates it.
     */
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const toWorldX = (lx, lz) => center.x + lx * cos + lz * sin;
    const toWorldZ = (lx, lz) => center.z - lx * sin + lz * cos;
    const half = { x: size.x * 0.5, z: size.z * 0.5 };
    const sides = [
      [0, -half.z, size.x, WALL_THICKNESS, 0],
      [0, half.z, size.x, WALL_THICKNESS, 0],
      [-half.x, 0, WALL_THICKNESS, size.z, 1],
      [half.x, 0, WALL_THICKNESS, size.z, 1],
    ];
    for (const [ox, oz, sx, sz, axis] of sides) {
      const wx = toWorldX(ox, oz);
      const wz = toWorldZ(ox, oz);
      // War damage: blow a gap out of a run rather than lowering it.
      // A parapet with a bite taken out of it is one of the strongest
      // "this town has been fought over" cues available.
      if (damaged > 0 && rng.chance(damaged)) {
        const runLength = axis ? sz : sx;
        const gap = rng.range(0.22, 0.4) * runLength;
        const gapAt = rng.range(-0.25, 0.25) * runLength;
        for (const sign of [-1, 1]) {
          const segLen = runLength * 0.5 - Math.abs(gapAt - sign * (gap * 0.5)) * 0;
          const start = sign < 0 ? -runLength * 0.5 : gapAt + gap * 0.5;
          const end = sign < 0 ? gapAt - gap * 0.5 : runLength * 0.5;
          const len = end - start;
          if (len < 0.4) continue;
          const mid = (start + end) * 0.5;
          const lx = axis ? ox : ox + mid;
          const lz = axis ? oz + mid : oz;
          box(materialName, {
            position: new THREE.Vector3(
              toWorldX(lx, lz), y + 0.43 + parapet * 0.5, toWorldZ(lx, lz)
            ),
            size: new THREE.Vector3(axis ? sx : len, parapet, axis ? len : sz),
            rotationY, surface: SURFACE.CONCRETE, uvScale: 0.5,
            tint: shade(tint, 1.02), tintBottom: shade(tint, 0.8),
          });
          void segLen;
        }
        continue;
      }
      box(materialName, {
        position: new THREE.Vector3(wx, y + 0.43 + parapet * 0.5, wz),
        size: new THREE.Vector3(sx, parapet, sz),
        rotationY, surface: SURFACE.CONCRETE, uvScale: 0.5,
        tint: shade(tint, 1.02), tintBottom: shade(tint, 0.8),
      });
      // Coping cap on the parapet - another shadow line at the top of
      // the silhouette, where the eye reads the building against sky.
      box(materialName, {
        position: new THREE.Vector3(wx, y + 0.43 + parapet + 0.05, wz),
        size: new THREE.Vector3(sx + 0.16, 0.10, sz + 0.16),
        rotationY, uvScale: 0.8, collide: false, tint: shade(tint, 1.14),
      });
    }
  }

  /** One straight run of steps with a solid stringer under it. */
  function stairFlight(materialName, options) {
    const {
      base, rotationY = 0, height, width = 1.4, run = 0.29, tint = 0xffffff,
      rail = false,
    } = options;
    const steps = Math.max(3, Math.round(height / 0.235));
    const rise = height / steps;
    const dirX = Math.sin(rotationY);
    const dirZ = Math.cos(rotationY);
    for (let i = 0; i < steps; i += 1) {
      const depth = (i + 1) * run;
      box(materialName, {
        position: new THREE.Vector3(
          base.x + dirX * (depth - run * 0.5),
          base.y + rise * (i + 0.5),
          base.z + dirZ * (depth - run * 0.5)
        ),
        size: new THREE.Vector3(width, rise, run),
        rotationY, surface: SURFACE.CONCRETE, uvScale: 0.8,
        tint: shade(tint, 0.86),
      });
    }
    const total = steps * run;

    /* Stringer and handrail.
     *
     * The stack of step boxes has a stepped top and a stepped soffit,
     * and from below - which is where a player in an alley sees an
     * external stair from - the treads foreshorten into a single flat
     * plane. The whole flight read as a black plank cantilevered out of
     * a wall. A sloping stringer closing the underside and a rail on
     * each edge give it the diagonal that says "stair" in silhouette,
     * which is the only cue that survives at range.
     */
    const pitch = Math.atan2(height, total);
    const diag = Math.hypot(height, total);
    const midX = base.x + dirX * total * 0.5;
    const midZ = base.z + dirZ * total * 0.5;
    box(materialName, {
      position: new THREE.Vector3(midX, base.y + height * 0.5 - 0.17, midZ),
      size: new THREE.Vector3(width + 0.06, 0.26, diag),
      rotationY, rotationX: -pitch,
      uvScale: 0.7, collide: false,
      tint: shade(tint, 0.7), tintBottom: shade(tint, 0.48, 0.06),
    });
    if (rail && height > 1.4) {
      for (const side of [-1, 1]) {
        const ox = Math.cos(rotationY) * side * width * 0.5;
        const oz = -Math.sin(rotationY) * side * width * 0.5;
        box("metal", {
          position: new THREE.Vector3(midX + ox, base.y + height * 0.5 + 0.94, midZ + oz),
          size: new THREE.Vector3(0.05, 0.05, diag),
          rotationY, rotationX: -pitch,
          uvScale: 2, collide: false, tint: 0x453f36,
        });
        const posts = Math.max(2, Math.round(diag / 1.7));
        for (let i = 0; i <= posts; i += 1) {
          const t = i / posts;
          box("metal", {
            position: new THREE.Vector3(
              base.x + dirX * total * t + ox,
              base.y + height * t + 0.48,
              base.z + dirZ * total * t + oz
            ),
            size: new THREE.Vector3(0.04, 0.96, 0.04),
            rotationY, uvScale: 3, collide: false, tint: 0x453f36,
          });
        }
      }
    }

    return {
      length: total,
      top: new THREE.Vector3(base.x + dirX * total, base.y + height, base.z + dirZ * total),
    };
  }

  /**
   * External stair to the roof. Rooftops must be reachable or they are
   * set dressing rather than level design.
   *
   * A single straight flight to a three-storey roof needs 13m of run
   * and shoves the building away from its neighbours; this switchbacks
   * at a landing so a stair fits in the alley it belongs in.
   */
  function stairs(materialName, options) {
    const { base, rotationY = 0, height, width = 1.5, tint = 0xffffff } = options;
    if (height <= 3.6) {
      stairFlight(materialName, { base, rotationY, height, width, tint, rail: true });
      return;
    }
    const halfHeight = height * 0.5;
    const first = stairFlight(materialName, {
      base, rotationY, height: halfHeight, width, tint, rail: true,
    });
    const landing = new THREE.Vector3(
      first.top.x + Math.sin(rotationY) * width * 0.55,
      first.top.y,
      first.top.z + Math.cos(rotationY) * width * 0.55
    );
    box(materialName, {
      position: new THREE.Vector3(landing.x, landing.y - 0.11, landing.z),
      size: new THREE.Vector3(width * 2.2, 0.22, width * 1.2),
      rotationY, surface: SURFACE.CONCRETE, uvScale: 0.6, tint: shade(tint, 0.86),
    });
    // The second flight doubles back on the BUILDING side (negative
    // outward normal), so the top of the stair arrives against the
    // parapet instead of 1.6m out in mid-air. Callers place the base
    // one flight-width further out to leave room for it.
    const offset = -width * 1.05;
    const backBase = new THREE.Vector3(
      landing.x + Math.cos(rotationY) * offset,
      landing.y,
      landing.z - Math.sin(rotationY) * offset
    );
    const second = stairFlight(materialName, {
      base: backBase, rotationY: rotationY + Math.PI,
      height: height - halfHeight, width, tint, rail: true,
    });
    // Top landing, bridging inward to the roof edge.
    box(materialName, {
      position: new THREE.Vector3(
        second.top.x + Math.cos(rotationY) * offset * 0.55,
        second.top.y - 0.11,
        second.top.z - Math.sin(rotationY) * offset * 0.55
      ),
      size: new THREE.Vector3(width * 2.0, 0.22, width * 1.1),
      rotationY, surface: SURFACE.CONCRETE, uvScale: 0.6, tint: shade(tint, 0.86),
    });
  }

  /**
   * Put a switchback stair against face `side` of a rectangular plan.
   * Kept in one place because every archetype needs it and getting the
   * offsets wrong once produces a stair to nowhere.
   */
  function externalStair(materialName, o) {
    const { x, z, rotation, halfW, halfD, side, baseY, height, tint } = o;
    const toWorld = planner(x, z, rotation);
    const angle = sideAngle(rotation, side);
    const face = faceInfo(side, halfW, halfD);
    // 2.9m out from the face: one flight width for the outbound run,
    // one for the flight that doubles back against the wall.
    const outX = Math.cos(angle) * 2.9;
    const outZ = -Math.sin(angle) * 2.9;
    const mid = toWorld(face.lx, face.lz);
    const start = new THREE.Vector3(
      mid.x + outX - Math.sin(angle) * face.length * 0.34, baseY,
      mid.z + outZ - Math.cos(angle) * face.length * 0.34
    );
    stairs(materialName, { base: start, rotationY: angle, height, width: 1.5, tint });
  }

  /* --------------------------- roof clutter --------------------------- */

  /** Cylindrical water tank on a stand. The single most recognisable
   *  rooftop object in the setting. */
  function waterTank(x, y, z, options = {}) {
    const radius = options.radius ?? rng.range(0.62, 0.9);
    const height = options.height ?? rng.range(1.1, 1.6);
    const legs = 0.42;
    const tint = options.tint ?? rng.pick([0x2f4a58, 0x8a8377, 0x6a3f34, 0x4a5b4a]);
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      box("metal", {
        position: new THREE.Vector3(x + ox * radius * 0.62, y + legs * 0.5, z + oz * radius * 0.62),
        size: new THREE.Vector3(0.09, legs, 0.09),
        uvScale: 2, collide: false, tint: shade(tint, 0.5),
      });
    }
    cylinder("metal", {
      position: new THREE.Vector3(x, y + legs + height * 0.5, z),
      radius, height, segments: 12, surface: SURFACE.METAL, tint,
      tintBottom: shade(tint, 0.72),
    });
    // Cap and inlet pipe.
    cylinder("metal", {
      position: new THREE.Vector3(x, y + legs + height + 0.05, z),
      radius: radius * 0.35, height: 0.12, segments: 8,
      collide: false, tint: shade(tint, 1.2),
    });
    contactShadow(x, z, radius, radius, 0, 0.5, y);
  }

  function satelliteDish(x, y, z, rotationY) {
    box("metal", {
      position: new THREE.Vector3(x, y + 0.22, z),
      size: new THREE.Vector3(0.09, 0.44, 0.09),
      uvScale: 2, collide: false, tint: 0x6a6459,
    });
    const dish = new THREE.CylinderGeometry(0.36, 0.34, 0.05, 12);
    mesh("metal", dish, {
      position: new THREE.Vector3(x, y + 0.5, z),
      rotationY, rotationX: Math.PI * 0.36,
      collide: false, tint: 0xa39c8e, uv: [1.2, 1.2],
    });
    contactShadow(x, z, 0.1, 0.1, rotationY, 0.4, y);
  }

  function acUnit(x, y, z, rotationY) {
    const tint = 0x8e8a80;
    box("metal", {
      position: new THREE.Vector3(x, y + 0.28, z),
      size: new THREE.Vector3(0.78, 0.56, 0.42),
      rotationY, uvScale: 1.5, surface: SURFACE.METAL,
      tint, tintBottom: shade(tint, 0.7),
    });
    // Grille face, slightly proud.
    box("metal", {
      position: new THREE.Vector3(x + Math.cos(rotationY) * 0.22, y + 0.30, z - Math.sin(rotationY) * 0.22),
      size: new THREE.Vector3(0.05, 0.40, 0.32),
      rotationY, uvScale: 4, collide: false, tint: shade(tint, 0.45),
    });
    contactShadow(x, z, 0.42, 0.22, rotationY, 0.5, y);
  }

  /** A line of washing. Cloth and wire against the sky is the fastest
   *  way to say "civilians lived here last week". */
  function laundryLine(x, y, z, rotationY, length) {
    const dirX = Math.cos(rotationY);
    const dirZ = -Math.sin(rotationY);
    for (const side of [-1, 1]) {
      box("metal", {
        position: new THREE.Vector3(x + dirX * side * length * 0.5, y + 0.75, z + dirZ * side * length * 0.5),
        size: new THREE.Vector3(0.07, 1.5, 0.07),
        uvScale: 2, collide: false, tint: 0x5f5a50,
      });
    }
    box("metal", {
      position: new THREE.Vector3(x, y + 1.42, z),
      size: new THREE.Vector3(length, 0.025, 0.025),
      rotationY, uvScale: 2, collide: false, tint: 0x3a352d,
    });
    const items = rng.int(2, 4);
    for (let i = 0; i < items; i += 1) {
      const t = (i + 0.5) / items - 0.5;
      const drop = rng.range(0.4, 0.8);
      box("sandbag", {
        position: new THREE.Vector3(
          x + dirX * t * length * 0.85, y + 1.4 - drop * 0.5, z + dirZ * t * length * 0.85
        ),
        size: new THREE.Vector3(rng.range(0.3, 0.55), drop, 0.03),
        rotationY, uvScale: 1.2, collide: false,
        tint: rng.pick([0xb9b2a4, 0x8a94a0, 0xa08a7a, 0xc2bcae]),
      });
    }
  }

  /** Rebar stubs out of a broken slab. Six thin cylinders that do more
   *  for "this was shelled" than any amount of texture work. */
  function rebar(x, y, z, count = 5, spread = 0.9) {
    for (let i = 0; i < count; i += 1) {
      const ax = x + rng.range(-spread, spread);
      const az = z + rng.range(-spread, spread);
      const h = rng.range(0.35, 0.85);
      cylinder("metal", {
        position: new THREE.Vector3(ax, y + h * 0.5, az),
        radius: 0.022, height: h, segments: 4, collide: false,
        rotationX: rng.range(-0.5, 0.5), rotationZ: rng.range(-0.5, 0.5),
        tint: 0x6b4a34,
      });
    }
  }

  /** Rubble at the foot of anything broken. */
  function rubblePile(x, z, radius, height = 0.9) {
    const y = seat(x, z, radius * 0.7, radius * 0.7).y;
    const chunks = Math.round(radius * 3.2);
    for (let i = 0; i < chunks; i += 1) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng()) * radius;
      const s = rng.range(0.25, 0.75);
      box(rng.chance(0.7) ? "concrete" : "rock", {
        position: new THREE.Vector3(
          x + Math.cos(a) * d,
          y + rng.range(0.05, height) * (1 - d / (radius + 0.1)) + s * 0.3,
          z + Math.sin(a) * d
        ),
        size: new THREE.Vector3(s, s * rng.range(0.4, 0.9), s * rng.range(0.7, 1.4)),
        rotationY: rng.range(0, Math.PI), rotationX: rng.range(-0.4, 0.4),
        rotationZ: rng.range(-0.4, 0.4),
        uvScale: 1.2, collide: i % 3 === 0,
        surface: SURFACE.CONCRETE,
        tint: shade(0x9a9184, rng.range(0.6, 1.0)),
      });
    }
    // One big slab leaning on the heap doubles as climbable cover.
    box("concrete", {
      position: new THREE.Vector3(x + rng.range(-0.6, 0.6), y + height * 0.6, z + rng.range(-0.6, 0.6)),
      size: new THREE.Vector3(rng.range(1.6, 2.8), 0.24, rng.range(1.2, 2.2)),
      rotationY: rng.range(0, Math.PI), rotationZ: rng.range(0.25, 0.55),
      uvScale: 0.5, tint: 0x8f887c,
    });
    rebar(x, y + height * 0.5, z, 4, radius * 0.6);
    contactShadow(x, z, radius, radius, 0, 0.55);
  }

  /* --------------------------- buildings --------------------------- */

  const buildings = [];

  /** Is there room here? Used by the layout code so a designed street
   *  does not end up with two houses sharing a volume. */
  function canPlace(x, z, radius) {
    for (const b of buildings) {
      if (Math.hypot(x - b.x, z - b.z) < radius + b.radius - 1.0) return false;
    }
    return true;
  }

  /**
   * The interior. Rooms, a doorway that lines up storey to storey, and
   * a stair core with a matching void in every floor slab so the climb
   * to the roof actually exists.
   */
  function interior(o) {
    const {
      x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail,
    } = o;
    const toWorld = planner(x, z, rotation);

    const iw = halfW - WALL_THICKNESS * 0.5;
    const id = halfD - WALL_THICKNESS * 0.5;

    // Stair core in the -X/-Z corner. Same footprint on every storey,
    // so the voids stack and a player can run the whole height.
    const coreW = Math.min(3.5, iw * 0.9);
    const coreD = Math.min(2.6, id * 0.85);
    const vx0 = -iw;
    const vx1 = -iw + coreW;
    const vz0 = -id;
    const vz1 = -id + coreD;

    for (let storey = 1; storey <= storeys; storey += 1) {
      const y = baseY + storey * STOREY;
      // Slab, in two pieces around the stair void.
      const slabs = [
        [vx1, iw, -id, id],
        [vx0, vx1, vz1, id],
      ];
      for (const [x0, x1, z0, z1] of slabs) {
        if (x1 - x0 < 0.3 || z1 - z0 < 0.3) continue;
        const c = toWorld((x0 + x1) * 0.5, (z0 + z1) * 0.5, y + 0.13);
        box(materialName, {
          position: c,
          size: new THREE.Vector3(x1 - x0, 0.26, z1 - z0),
          rotationY: rotation, surface: SURFACE.CONCRETE, uvScale: 0.3,
          tint: shade(tint, 0.66),
        });
      }
      // The flight up to this slab, inside the void. `stairFlight`
      // advances along (sin a, cos a); plan +X is (cos r, -sin r), so
      // the yaw that walks along plan +X is r + PI/2.
      const steps = Math.max(4, Math.round((STOREY + 0.26) / 0.235));
      stairFlight(materialName, {
        base: toWorld(vx0 + 0.25, vz0 + coreD * 0.5, baseY + (storey - 1) * STOREY),
        rotationY: rotation + Math.PI * 0.5,
        height: STOREY + 0.26, width: Math.min(1.25, coreD - 0.4),
        run: (coreW - 0.6) / steps,
        tint: shade(tint, 0.9),
      });
    }

    if (detail < 1) return;

    // Partition walls with aligned doorways: one cross wall per storey
    // splits the plan into a front and a back room, which is what makes
    // an interior worth clearing instead of a single empty box.
    for (let storey = 0; storey < storeys; storey += 1) {
      const y = baseY + storey * STOREY;
      const px = iw * rng.range(-0.05, 0.25);
      wall(materialName, {
        start: toWorld(px, -id, y),
        end: toWorld(px, id, y),
        height: STOREY - 0.26,
        thickness: 0.2,
        openings: [{ at: 0.62, width: 1.05, sill: 0, top: 2.1 }],
        tint: shade(tint, 0.92), tintBottom: shade(tint, 0.66, 0.05),
      });
    }
  }

  /** Rooftop dressing shared by every archetype that has a flat roof. */
  function dressRoof(o) {
    const { x, z, y, halfW, halfD, rotation, tint, detail, hatch = true } = o;
    const toWorld = planner(x, z, rotation);

    if (hatch) {
      // Stair penthouse over the core, so the internal stair emerges
      // somewhere rather than stopping at a ceiling.
      const cx = -halfW + 1.8;
      const cz = -halfD + 1.4;
      const ph = 2.2;
      for (const [ox, oz, sx, sz, skip] of [
        [-1.6, 0, 0.24, 2.6, false], [1.6, 0, 0.24, 2.6, false],
        [0, -1.3, 3.2, 0.24, false], [0, 1.3, 3.2, 0.24, true],
      ]) {
        if (skip) continue;
        const p = toWorld(cx + ox, cz + oz, y + ph * 0.5);
        box("blockwall", {
          position: p,
          size: new THREE.Vector3(sx, ph, sz),
          rotationY: rotation, uvScale: 0.5,
          tint: shade(tint, 0.98), tintBottom: shade(tint, 0.74),
        });
      }
      box("concrete", {
        position: toWorld(cx, cz, y + ph + 0.1),
        size: new THREE.Vector3(3.5, 0.2, 2.9),
        rotationY: rotation, uvScale: 0.5, tint: shade(tint, 0.8),
      });
    }

    if (detail < 1) return;

    const spots = [];
    for (let i = 0; i < 8; i += 1) {
      spots.push(toWorld(rng.range(-halfW + 1.2, halfW - 1.2), rng.range(-halfD + 1.2, halfD - 1.2), y));
    }
    waterTank(spots[0].x, y, spots[0].z);
    if (rng.chance(0.8)) waterTank(spots[1].x, y, spots[1].z, { radius: rng.range(0.5, 0.7) });
    if (rng.chance(0.7)) satelliteDish(spots[2].x, y, spots[2].z, rng.range(0, Math.PI * 2));
    if (rng.chance(0.6)) acUnit(spots[3].x, y, spots[3].z, rng.range(0, Math.PI * 2));
    if (detail >= 2 && rng.chance(0.65)) {
      laundryLine(spots[4].x, y, spots[4].z, rng.range(0, Math.PI), Math.min(halfW, halfD) * 1.3);
    }
    if (detail >= 2 && rng.chance(0.5)) {
      // A rooftop sandbag position: the reason to make the climb.
      sandbagWall(spots[5].x, spots[5].z, rng.range(0, Math.PI * 2), 3.0, y);
    }
    if (detail >= 2 && rng.chance(0.45)) {
      crateStack(spots[6].x, spots[6].z, rng.range(0, Math.PI), y);
    }
  }

  /**
   * Facade pass shared by the vertical archetypes. Walks each side of
   * each storey, cuts openings, dresses them and adds the floor band.
   */
  function facades(o) {
    const {
      x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint,
      detail, frontSide = 0, shopfront = false, storeyHeight = STOREY,
      arch = false, windowChance = 0.85,
    } = o;
    const toWorld = planner(x, z, rotation);
    const corners = (y) => [
      toWorld(-halfW, -halfD, y), toWorld(halfW, -halfD, y),
      toWorld(halfW, halfD, y), toWorld(-halfW, halfD, y),
    ];

    for (let storey = 0; storey < storeys; storey += 1) {
      const y = baseY + storey * storeyHeight;
      const c = corners(y);
      /* Only the ground storey ramps.
       *
       * Every storey used to get one, and `paint()` normalises the ramp
       * over the piece, so the second floor darkened towards ITS OWN
       * base - a dark line at 3.15m, another at 6.3m, on every building
       * in the town. Dirt does not restart at each floor. The ground
       * gradient proper is now applied once against the finished
       * terrain in finalise(); this is the part of it that has to be in
       * the tint because it is chromatic (splash-back is cooler as well
       * as darker) and the finalise pass is deliberately value-only. */
      const grime = storey === 0 ? shade(tint, 0.72, 0.10) : tint;

      for (let side = 0; side < 4; side += 1) {
        const start = c[side];
        const end = c[(side + 1) % 4];
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        const angle = Math.atan2(end.x - start.x, end.z - start.z);
        const mid = new THREE.Vector3((start.x + end.x) * 0.5, 0, (start.z + end.z) * 0.5);

        const openings = [];
        const isFront = side === frontSide;

        if (storey === 0 && isFront) {
          if (shopfront) {
            openings.push({
              at: 0.34, width: Math.min(3.2, length * 0.42), sill: 0,
              top: storeyHeight - 0.75, kind: "shop",
            });
            openings.push({ at: 0.78, width: 1.15, sill: 0, top: 2.15, kind: "door" });
          } else {
            openings.push({ at: 0.5, width: 1.3, sill: 0, top: 2.25, kind: "door" });
            if (length > 8) openings.push({ at: 0.82, width: 1.1, sill: 1.0, top: 2.25, kind: "win" });
          }
        } else {
          // Space windows evenly rather than randomly. A facade with
          // rhythm reads as architecture; jittered holes read as noise.
          const count = clamp(Math.round(length / 3.4), 1, 4);
          for (let i = 0; i < count; i += 1) {
            if (!rng.chance(windowChance)) continue;
            openings.push({
              at: (i + 0.5) / count,
              width: rng.range(0.95, 1.35),
              sill: 0.95, top: 2.30, kind: "win",
            });
          }
        }

        const built = wall(materialName, {
          start, end, height: storeyHeight, openings,
          tint, tintBottom: grime, surface: SURFACE.CONCRETE,
        });

        if (built) {
          for (const cut of built.cuts) {
            const p = built.at(cut.u);
            const kind = cut.spec.kind || "win";
            dressOpening({
              centre: new THREE.Vector3(p.x, 0, p.z),
              angle, y: y + cut.sill, sillY: cut.sill > 0.2 ? y + cut.sill : undefined,
              width: cut.width, height: cut.top - cut.sill,
              materialName, tint, detail,
              glass: kind === "win",
              shutter: kind === "shop",
              arch: arch && kind !== "shop",
            });
          }
        }

        // Floor band between storeys.
        if (detail >= 1 && storey > 0) {
          stringCourse(materialName, mid, angle, length, y - 0.06, tint);
        }
      }
    }
  }

  /**
   * One building. `archetype` picks the plan; everything else is
   * randomised within ranges that keep the result playable.
   *
   * `detail` is the budget dial: 2 for anything near an objective,
   * 1 for mid-field, 0 for distant filler that will never be seen from
   * closer than 150m. A town of 60 hero buildings is not affordable and
   * would not look any better from the ridge.
   */
  function building(x, z, options = {}) {
    const detail = options.detail ?? 2;
    const archetype = options.archetype || rng.pick([
      "shophouse", "shophouse", "villa", "warehouse", "tower", "ruin", "shed",
    ]);

    const tint = options.tint ?? (rng.chance(0.82) ? rng.pick(PLASTER) : rng.pick(ACCENT));
    /* Three wall materials, not two.
     *
     * This was a coin flip between blockwall and concrete, and BOTH were
     * then tinted from the same PLASTER list - so the only thing telling
     * a block building from a concrete one was its texture's own
     * relief, at a tile size that was itself uncontrolled. Six reviewers
     * in a row have called the town "one swatch at varying values", and
     * the list they were describing is literally named PLASTER while no
     * surface in the map was plaster.
     *
     * The library has a lime-render generator that nothing used: a
     * trowelled skin with spall, hairline map-cracking and rain splash,
     * which is the render on most of the real buildings this town is
     * modelled on. Turning it on buys a genuinely third surface with its
     * own relief character and its own roughness window, which is the
     * separation the reviewer is asking for and the half of it that is
     * not colour. Cost is one texture set - see the report.
     */
    const materialName = options.material ?? rng.pick([
      "blockwall", "blockwall", "plaster", "plaster", "concrete", "concrete",
    ]);
    const rotation = options.rotationY ?? rng.range(0, Math.PI * 2);

    const spec = { x, z, detail, tint, materialName, rotation, options };
    let record;
    switch (archetype) {
      case "villa": record = buildVilla(spec); break;
      case "warehouse": record = buildWarehouse(spec); break;
      case "tower": record = buildTower(spec); break;
      case "ruin": record = buildRuin(spec); break;
      case "shed": record = buildShed(spec); break;
      default: record = buildShophouse(spec); break;
    }
    record.archetype = archetype;

    /* Plinth.
     *
     * Where a wall meets the ground is the one edge in the whole
     * silhouette a player is always close enough to read, and a wall
     * that simply stops at the sand reads as a box dropped on a
     * heightfield. A base course 0.12m proud puts a real, self-cast
     * shadow line all the way round the building at ankle height and
     * gives the wind-blown sand something to bank against.
     *
     * Deliberately no collider: it is 12cm, the wall behind it already
     * has one, and a step that shallow is not something the capsule
     * needs to know about.
     */
    const bodyW = record.bodyWidth ?? record.width;
    const bodyD = record.bodyDepth ?? record.depth;
    if (bodyW > 3 && bodyD > 3) {
      const plinth = 0.42;
      const w = bodyW;
      const d = bodyD;
      const at = planner(record.x, record.z, record.rotation);
      const dark = shade(tint, 0.52, 0.08);
      for (const [lx, lz, sx, sz] of [
        [0, -d * 0.5, w + 0.24, 0.24],
        [0, d * 0.5, w + 0.24, 0.24],
        [-w * 0.5, 0, 0.24, d + 0.24],
        [w * 0.5, 0, 0.24, d + 0.24],
      ]) {
        box(materialName, {
          position: at(lx, lz, record.baseY + plinth * 0.5),
          size: new THREE.Vector3(sx, plinth, sz),
          rotationY: record.rotation, uvScale: 0.6, collide: false,
          tint: shade(tint, 0.86), tintBottom: dark,
        });
      }

      /* Sand drift banked against the plinth.
       *
       * The plinth comment above says it "gives the wind-blown sand
       * something to bank against", and then nothing banked. A wall
       * that ends in a geometrically perfect horizontal line where it
       * meets the desert is the reviewer's "hard seam" exactly, and
       * darkening alone cannot remove it - a seam is a silhouette
       * fault, not a shading one. Two stacked steps of sand read as a
       * drift from any standing eye height and blend into the ground
       * because they ARE the ground material. Eight boxes a building,
       * no collider: it is ankle height and the wall behind it already
       * blocks. */
      for (const [step, h, out] of [[0, 0.15, 0.34], [1, 0.09, 0.72]]) {
        const lift = step === 0 ? 0 : 0.15;
        for (const [lx, lz, sx, sz] of [
          [0, -(d * 0.5 + out * 0.5), w + 0.3 + out, out],
          [0, d * 0.5 + out * 0.5, w + 0.3 + out, out],
          [-(w * 0.5 + out * 0.5), 0, out, d + 0.3 + out],
          [w * 0.5 + out * 0.5, 0, out, d + 0.3 + out],
        ]) {
          box("sand", {
            position: at(lx, lz, record.baseY + lift + h * 0.5 - 0.04),
            size: new THREE.Vector3(sx, h, sz),
            rotationY: record.rotation, uvScale: 0.5, collide: false,
            // Warm at the crest, shaded where it tucks under the wall.
            tint: 0xb6a488, tintBottom: 0x6d6252,
          });
        }
      }
    }

    // Ground occlusion out to a third of the footprint beyond the wall
    // line. A building sitting on unshaded sand is the single loudest
    // "this is a prototype" cue there is, and it costs 72 triangles.
    contactShadow(
      record.x, record.z,
      bodyW * 0.5, bodyD * 0.5,
      record.rotation, 0.55
    );
    buildings.push(record);
    return record;
  }

  /** Flatten the pad and return the level. Kept in one place because
   *  every archetype has to do it before it places anything. */
  function pad(x, z, width, depth) {
    const radius = Math.max(width, depth) * 0.6;
    // Falloff tightens as the footprint grows: a warehouse pad at the
    // old 1.7 falloff pancaked 45m of dune around it.
    const falloff = radius > 11 ? 1.35 : 1.6;
    return terrain.flatten(x, z, radius, null, falloff);
  }

  /* ---- archetype: shophouse ---- */

  function buildShophouse(spec) {
    const { x, z, detail, tint, materialName, rotation, options } = spec;
    const width = options.width ?? rng.range(7.5, 11);
    const depth = options.depth ?? rng.range(8, 13);
    const storeys = options.storeys ?? rng.int(2, 3);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const baseY = pad(x, z, width, depth);
    const front = options.frontSide ?? 0;

    facades({
      x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail,
      frontSide: front, shopfront: true,
    });
    interior({ x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail });

    const topY = baseY + storeys * STOREY;
    roof(materialName, {
      center: { x, z }, size: { x: width, z: depth }, y: topY, rotationY: rotation,
      parapet: rng.range(0.75, 1.2), tint, damaged: detail >= 1 ? 0.25 : 0,
    });
    dressRoof({ x, z, y: topY + 0.43, halfW, halfD, rotation, tint, detail });

    const toWorld = planner(x, z, rotation);

    if (detail >= 1) {
      // Awning over the shopfront and a balcony on the first floor:
      // the two things that make a street front read as a street.
      const frontAngle = sideAngle(rotation, front);
      const face = faceInfo(front, halfW, halfD);
      const p = toWorld(face.lx, face.lz);
      const spanLen = face.length * 0.55;
      awning(p.x, p.z, baseY + STOREY - 0.55, frontAngle, spanLen);

      if (storeys >= 2 && rng.chance(0.7)) {
        balcony(p.x, p.z, baseY + STOREY + 0.1, frontAngle, spanLen * 0.8, tint, materialName);
      }
      // Downpipes on two corners.
      for (const [ox, oz] of [[-halfW + 0.2, -halfD + 0.2], [halfW - 0.2, halfD - 0.2]]) {
        const c = toWorld(ox, oz);
        drainpipe(c.x, c.z, baseY, storeys * STOREY + 0.4, tint);
      }
    }

    // External stair to the roof, on the side away from the front and
    // running along that wall so it never blocks the street.
    externalStair(materialName, {
      x, z, rotation, halfW, halfD, side: (front + 2) % 4,
      baseY, height: topY - baseY + 0.4, tint,
    });

    return { x, z, width, depth, storeys, rotation, baseY, topY, radius: Math.hypot(halfW, halfD) };
  }

  /** Fabric awning on brackets. */
  function awning(x, z, y, angle, span) {
    const { nX, nZ } = wallBasis(angle);
    const reach = 1.5;
    const fabric = rng.pick(FABRIC);
    // 0.06m of fabric was a plane with a number attached to it: at any
    // distance the edge vanished and the awning read as a decal on the
    // sky. Doubling it and hanging a valance off the front gives the
    // thing an edge-on silhouette, which is the only way a horizontal
    // plate is legible from below.
    box("sandbag", {
      position: new THREE.Vector3(x + nX * reach * 0.5, y + 0.18, z + nZ * reach * 0.5),
      size: new THREE.Vector3(reach, 0.12, span),
      rotationY: angle, rotationZ: -0.22, uvScale: 0.7,
      surface: SURFACE.WOOD,
      tint: fabric, tintBottom: shade(fabric, 2.1), penetrable: 0.85,
    });
    box("sandbag", {
      position: new THREE.Vector3(x + nX * reach * 1.02, y - 0.06, z + nZ * reach * 1.02),
      size: new THREE.Vector3(0.05, 0.26, span),
      rotationY: angle, uvScale: 1.2, collide: false,
      tint: shade(fabric, 0.82), tintBottom: shade(fabric, 0.55),
    });
    for (const side of [-1, 1]) {
      box("metal", {
        position: new THREE.Vector3(
          x + nX * reach * 0.5 + Math.sin(angle) * side * span * 0.48,
          y + 0.02,
          z + nZ * reach * 0.5 + Math.cos(angle) * side * span * 0.48
        ),
        size: new THREE.Vector3(reach + 0.2, 0.05, 0.05),
        rotationY: angle, rotationZ: -0.22, uvScale: 2,
        collide: false, tint: 0x4e4940,
      });
    }
  }

  /** Cantilevered balcony with a railing. */
  function balcony(x, z, y, angle, span, tint, materialName) {
    const { nX, nZ } = wallBasis(angle);
    const reach = 1.15;
    box(materialName, {
      position: new THREE.Vector3(x + nX * reach * 0.5, y, z + nZ * reach * 0.5),
      size: new THREE.Vector3(reach, 0.22, span),
      rotationY: angle, uvScale: 0.6, tint: shade(tint, 0.9),
    });
    // Railing: two rails plus balusters. Reads as ironwork in
    // silhouette, which is where it will be seen.
    for (const h of [0.45, 0.95]) {
      box("metal", {
        position: new THREE.Vector3(x + nX * reach, y + h, z + nZ * reach),
        size: new THREE.Vector3(0.06, 0.06, span),
        rotationY: angle, uvScale: 2, collide: false, tint: 0x453f36,
      });
    }
    const posts = Math.max(3, Math.round(span / 0.5));
    for (let i = 0; i <= posts; i += 1) {
      const t = i / posts - 0.5;
      box("metal", {
        position: new THREE.Vector3(
          x + nX * reach + Math.sin(angle) * t * span,
          y + 0.55,
          z + nZ * reach + Math.cos(angle) * t * span
        ),
        size: new THREE.Vector3(0.04, 1.0, 0.04),
        rotationY: angle, uvScale: 3, collide: false, tint: 0x453f36,
      });
    }
    ctx.physics.addBox({
      center: new THREE.Vector3(x + nX * reach, y + 0.55, z + nZ * reach),
      halfExtents: new THREE.Vector3(0.08, 0.55, span * 0.5),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
      layer: LAYER.STATIC, surface: SURFACE.METAL, penetrable: 0.5, opaque: false,
    });
    colliderCount += 1;
  }

  /* ---- archetype: compound villa ---- */

  function buildVilla(spec) {
    const { x, z, detail, tint, materialName, rotation, options } = spec;
    const width = options.width ?? rng.range(11, 15);
    const depth = options.depth ?? rng.range(9, 13);
    const storeys = options.storeys ?? rng.int(1, 2);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const yardW = width + rng.range(9, 15);
    const yardD = depth + rng.range(9, 14);
    const baseY = pad(x, z, yardW, yardD);

    facades({
      x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail,
      frontSide: 0, arch: true, windowChance: 0.75,
    });
    interior({ x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail });

    const topY = baseY + storeys * STOREY;
    roof(materialName, {
      center: { x, z }, size: { x: width, z: depth }, y: topY, rotationY: rotation,
      parapet: rng.range(0.8, 1.1), tint, damaged: detail >= 1 ? 0.15 : 0,
    });
    dressRoof({ x, z, y: topY + 0.43, halfW, halfD, rotation, tint, detail });

    const toWorld = planner(x, z, rotation);

    if (detail >= 1) {
      // Porch: four columns under a slab, in front of the door.
      const porchZ = -halfD - 1.5;
      box(materialName, {
        position: toWorld(0, porchZ, baseY + 2.75),
        size: new THREE.Vector3(width * 0.5, 0.24, 3.0),
        rotationY: rotation, uvScale: 0.5, tint: shade(tint, 0.95),
      });
      for (const ox of [-width * 0.22, width * 0.22]) {
        for (const oz of [porchZ - 1.2, porchZ + 1.2]) {
          box(materialName, {
            position: toWorld(ox, oz, baseY + 1.35),
            size: new THREE.Vector3(0.34, 2.7, 0.34),
            rotationY: rotation, uvScale: 1.0,
            tint: shade(tint, 1.05), tintBottom: shade(tint, 0.62, 0.1),
          });
        }
      }
    }

    // Courtyard wall with a gate, and the yard clutter that turns an
    // empty compound into somewhere with a reason to enter.
    compoundWall(x, z, yardW, yardD, rotation, 1, { tint: shade(tint, 0.92), height: 2.5 });
    if (detail >= 1) {
      const spot = () => toWorld(
        rng.range(-yardW * 0.44, yardW * 0.44), rng.range(-yardD * 0.44, yardD * 0.44)
      );
      const a = spot();
      if (rng.chance(0.55)) wreckedCar(a.x, a.z, rng.range(0, Math.PI * 2));
      const b = spot();
      if (rng.chance(0.7)) crateStack(b.x, b.z, rng.range(0, Math.PI));
      const c = spot();
      if (rng.chance(0.6)) oilDrums(c.x, c.z, rng.int(2, 4));
      const d = toWorld(0, halfD + 1.4);
      laundryLine(d.x, terrain.heightAt(d.x, d.z) + 0.6, d.z, rotation, 4.2);
    }

    externalStair(materialName, {
      x, z, rotation, halfW, halfD, side: 1,
      baseY, height: topY - baseY + 0.4, tint,
    });

    return {
      x, z, width: yardW, depth: yardD, storeys, rotation, baseY, topY,
      // The plinth and the ground blob want the HOUSE, not the yard the
      // compound wall encloses; `width` here is the yard.
      bodyWidth: width, bodyDepth: depth,
      radius: Math.hypot(yardW * 0.5, yardD * 0.5),
    };
  }

  /* ---- archetype: warehouse ---- */

  function buildWarehouse(spec) {
    const { x, z, detail, tint, rotation, options } = spec;
    const materialName = "concrete";
    const width = options.width ?? rng.range(18, 26);
    const depth = options.depth ?? rng.range(12, 18);
    const height = options.height ?? rng.range(6.4, 7.8);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const baseY = pad(x, z, width, depth);
    const toWorld = planner(x, z, rotation);
    const grime = shade(tint, 0.55, 0.12);

    const corners = [
      toWorld(-halfW, -halfD, baseY), toWorld(halfW, -halfD, baseY),
      toWorld(halfW, halfD, baseY), toWorld(-halfW, halfD, baseY),
    ];

    for (let side = 0; side < 4; side += 1) {
      const start = corners[side];
      const end = corners[(side + 1) % 4];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const angle = Math.atan2(end.x - start.x, end.z - start.z);
      const openings = [];
      if (side === 0) {
        // Roller doors on the long face.
        const doors = clamp(Math.round(length / 9), 1, 3);
        for (let i = 0; i < doors; i += 1) {
          openings.push({ at: (i + 0.5) / doors, width: 4.2, sill: 0, top: 4.4, kind: "shop" });
        }
      } else if (side === 2) {
        openings.push({ at: 0.5, width: 1.4, sill: 0, top: 2.3, kind: "door" });
      }
      // Clerestory band high on every wall - the light slots that make
      // a warehouse interior legible without any lighting work.
      const bays = clamp(Math.round(length / 4.2), 2, 6);
      for (let i = 0; i < bays; i += 1) {
        openings.push({ at: (i + 0.5) / bays, width: 1.9, sill: height - 1.9, top: height - 0.55, kind: "win" });
      }

      const built = wall(materialName, {
        start, end, height, openings, tint, tintBottom: grime,
      });
      if (built) {
        for (const cut of built.cuts) {
          const p = built.at(cut.u);
          dressOpening({
            centre: new THREE.Vector3(p.x, 0, p.z), angle,
            y: baseY + cut.sill, sillY: cut.sill > 0.2 ? baseY + cut.sill : undefined,
            width: cut.width, height: cut.top - cut.sill, materialName, tint, detail,
            glass: cut.spec.kind === "win", shutter: cut.spec.kind === "shop",
          });
        }
      }
      // Pilasters: structural bays proud of the wall. A 24m blank
      // elevation without them is the definition of grey-box.
      if (detail >= 1) {
        for (let i = 0; i <= bays; i += 1) {
          const u = (i / bays - 0.5) * length;
          const p = new THREE.Vector3(
            (start.x + end.x) * 0.5 + Math.sin(angle) * u, 0,
            (start.z + end.z) * 0.5 + Math.cos(angle) * u
          );
          const n = wallBasis(angle);
          box(materialName, {
            position: new THREE.Vector3(p.x + n.nX * 0.24, baseY + height * 0.5, p.z + n.nZ * 0.24),
            size: new THREE.Vector3(0.34, height, 0.55),
            rotationY: angle, uvScale: 0.5, collide: false,
            tint: shade(tint, 1.06), tintBottom: shade(grime, 1.1),
          });
        }
      }
    }

    // Shallow gabled corrugated roof with a raised monitor, built from
    // two tilted slabs. A flat slab on a shed this size reads as a lid.
    const pitch = 0.14;
    for (const side of [-1, 1]) {
      const p = toWorld(0, side * halfD * 0.5, baseY + height + halfD * 0.5 * pitch * 0.5);
      box("metal", {
        position: p,
        size: new THREE.Vector3(width + 0.7, 0.18, halfD + 0.5),
        rotationY: rotation, rotationX: -side * pitch,
        uvScale: 0.6, surface: SURFACE.METAL,
        tint: shade(rng.pick(SHEET), 1.0), tintBottom: shade(rng.pick(SHEET), 0.8),
      });
    }
    // Ridge monitor with side vents.
    const ridge = toWorld(0, 0, baseY + height + halfD * pitch * 0.5 + 0.55);
    box("metal", {
      position: ridge,
      size: new THREE.Vector3(width * 0.7, 1.0, 2.2),
      rotationY: rotation, uvScale: 0.7, tint: shade(rng.pick(SHEET), 0.9),
    });

    if (detail >= 1) {
      // Roof vents.
      for (let i = 0; i < 3; i += 1) {
        const p = toWorld(rng.range(-halfW * 0.7, halfW * 0.7), rng.range(-halfD * 0.7, halfD * 0.7),
          baseY + height + 0.6);
        cylinder("metal", {
          position: p, radius: 0.28, height: 0.7, segments: 8,
          collide: false, tint: 0x7a736a,
        });
      }
      // Lean-to along one long face: shade, cover, and a roof a player
      // can climb onto from a crate.
      const lp = toWorld(0, halfD + 1.9, baseY);
      box("metal", {
        position: new THREE.Vector3(lp.x, baseY + 3.1, lp.z),
        size: new THREE.Vector3(width * 0.8, 0.14, 4.0),
        rotationY: rotation, rotationX: 0.1, uvScale: 0.6,
        surface: SURFACE.METAL, tint: rng.pick(SHEET),
      });
      for (const ox of [-width * 0.36, 0, width * 0.36]) {
        const p = toWorld(ox, halfD + 3.6, baseY);
        box("metal", {
          position: new THREE.Vector3(p.x, baseY + 1.5, p.z),
          size: new THREE.Vector3(0.16, 3.0, 0.16),
          rotationY: rotation, uvScale: 2, tint: 0x5f584e,
        });
      }
      // Interior: a mezzanine deck with a stair. Vertical play inside a
      // big volume is what stops a warehouse being a shooting gallery.
      const mz = toWorld(halfW * 0.45, 0, baseY);
      box("concrete", {
        position: new THREE.Vector3(mz.x, baseY + 3.0, mz.z),
        size: new THREE.Vector3(halfW * 0.9, 0.24, depth - 1.2),
        rotationY: rotation, uvScale: 0.35, tint: shade(tint, 0.62),
      });
      const sb = toWorld(-0.4, -halfD + 1.2, baseY);
      stairFlight("concrete", {
        base: new THREE.Vector3(sb.x, baseY, sb.z),
        rotationY: rotation + Math.PI * 0.5, height: 3.12, width: 1.3, run: 0.26, tint,
      });
      // Trusses under the roof.
      for (let i = 1; i < 4; i += 1) {
        const p = toWorld(-halfW + (i / 4) * width, 0, baseY);
        box("metal", {
          position: new THREE.Vector3(p.x, baseY + height - 0.5, p.z),
          size: new THREE.Vector3(0.2, 0.35, depth),
          rotationY: rotation, uvScale: 1.0, collide: false, tint: 0x6a6055,
        });
      }
    }

    return {
      x, z, width, depth, storeys: 2, rotation, baseY,
      topY: baseY + height + 1.0, radius: Math.hypot(halfW, halfD),
    };
  }

  /* ---- archetype: tower block ---- */

  function buildTower(spec) {
    const { x, z, detail, tint, materialName, rotation, options } = spec;
    const width = options.width ?? rng.range(9, 12.5);
    const depth = options.depth ?? rng.range(8, 11);
    const storeys = options.storeys ?? rng.int(4, 6);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const baseY = pad(x, z, width, depth);

    facades({
      x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail,
      frontSide: 0, windowChance: 0.92,
    });
    interior({ x, z, baseY, storeys, halfW, halfD, rotation, materialName, tint, detail });

    const topY = baseY + storeys * STOREY;
    roof(materialName, {
      center: { x, z }, size: { x: width, z: depth }, y: topY, rotationY: rotation,
      parapet: rng.range(0.9, 1.25), tint, damaged: detail >= 1 ? 0.3 : 0,
    });
    dressRoof({ x, z, y: topY + 0.43, halfW, halfD, rotation, tint, detail });

    const toWorld = planner(x, z, rotation);

    if (detail >= 1) {
      // Stacked balconies on alternating faces: the tower's signature
      // and a large amount of silhouette for very little geometry.
      for (let storey = 1; storey < storeys; storey += 1) {
        const side = storey % 2 === 0 ? 0 : 2;
        const face = faceInfo(side, halfW, halfD);
        const p = toWorld(face.lx, face.lz);
        balcony(p.x, p.z, baseY + storey * STOREY + 0.12,
          sideAngle(rotation, side), face.length * 0.6, tint, materialName);
      }
      for (const [ox, oz] of [[-halfW + 0.2, -halfD + 0.2], [halfW - 0.2, halfD - 0.2]]) {
        const p = toWorld(ox, oz);
        drainpipe(p.x, p.z, baseY, storeys * STOREY + 0.4, tint);
      }
      // Aerial mast on the roof: the landmark read from across the map.
      const m = toWorld(halfW - 1.0, halfD - 1.0);
      cylinder("metal", {
        position: new THREE.Vector3(m.x, topY + 0.43 + 2.6, m.z),
        radius: 0.07, height: 5.2, segments: 6, collide: false, tint: 0x59524a,
      });
    }

    // The external stair only reaches the second floor; above that the
    // internal core is the way up, which is what makes clearing a tower
    // a fight rather than a sprint up the outside.
    externalStair(materialName, {
      x, z, rotation, halfW, halfD, side: 3,
      baseY, height: STOREY * 2 + 0.3, tint,
    });

    return { x, z, width, depth, storeys, rotation, baseY, topY, radius: Math.hypot(halfW, halfD) };
  }

  /* ---- archetype: ruin ---- */

  function buildRuin(spec) {
    const { x, z, detail, tint, materialName, rotation, options } = spec;
    const width = options.width ?? rng.range(8, 13);
    const depth = options.depth ?? rng.range(8, 12);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const baseY = pad(x, z, width, depth);
    const toWorld = planner(x, z, rotation);
    const scorch = shade(tint, 0.30, 0.05);

    const corners = (y) => [
      toWorld(-halfW, -halfD, y), toWorld(halfW, -halfD, y),
      toWorld(halfW, halfD, y), toWorld(-halfW, halfD, y),
    ];

    // Ground floor: three walls standing, one blown open.
    const blown = rng.int(0, 3);
    for (let storey = 0; storey < 2; storey += 1) {
      const y = baseY + storey * STOREY;
      const c = corners(y);
      for (let side = 0; side < 4; side += 1) {
        if (side === blown && storey === 0) {
          // Two stumps where the wall was, with rebar between them.
          const start = c[side];
          const end = c[(side + 1) % 4];
          for (const t of [0.14, 0.86]) {
            const px = lerp(start.x, end.x, t);
            const pz = lerp(start.z, end.z, t);
            box(materialName, {
              position: new THREE.Vector3(px, y + 0.9, pz),
              size: new THREE.Vector3(WALL_THICKNESS, 1.8, 1.6),
              rotationY: Math.atan2(end.x - start.x, end.z - start.z),
              uvScale: 0.5, tint, tintBottom: scorch,
            });
            rebar(px, y + 1.8, pz, 3, 0.4);
          }
          continue;
        }
        // Upper storey survives only in part.
        if (storey === 1 && rng.chance(0.45)) continue;
        const start = c[side];
        const end = c[(side + 1) % 4];
        const height = storey === 1 ? rng.range(1.4, STOREY) : STOREY;
        const openings = [];
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        const count = clamp(Math.round(length / 3.6), 1, 3);
        for (let i = 0; i < count; i += 1) {
          openings.push({
            at: (i + 0.5) / count, width: rng.range(1.1, 1.9),
            sill: storey === 0 && i === 0 ? 0 : rng.range(0.7, 1.0),
            top: Math.min(height, 2.4), kind: "hole",
          });
        }
        const built = wall(materialName, {
          start, end, height, openings, tint, tintBottom: scorch,
        });
        // Blast staining above the openings.
        if (built && detail >= 1) {
          for (const cut of built.cuts) {
            const p = built.at(cut.u);
            const angle = Math.atan2(end.x - start.x, end.z - start.z);
            const n = wallBasis(angle);
            box(materialName, {
              position: new THREE.Vector3(
                p.x + n.nX * (WALL_THICKNESS * 0.5 + 0.02), y + cut.top + 0.45,
                p.z + n.nZ * (WALL_THICKNESS * 0.5 + 0.02)
              ),
              size: new THREE.Vector3(0.04, 0.9, cut.width * 1.3),
              rotationY: angle, uvScale: 1.2, collide: false,
              tint: shade(tint, 0.55), tintBottom: shade(tint, 0.18),
            });
          }
        }
      }
    }

    // The first-floor slab, cracked into pieces with one corner gone.
    const pieces = [
      [-halfW, 0.15 * width, -halfD, halfD],
      [0.2 * width, halfW, -halfD, 0.1 * depth],
    ];
    for (const [x0, x1, z0, z1] of pieces) {
      const c = toWorld((x0 + x1) * 0.5, (z0 + z1) * 0.5, baseY + STOREY + 0.13);
      box("concrete", {
        position: c,
        size: new THREE.Vector3(x1 - x0, 0.26, z1 - z0),
        rotationY: rotation, rotationZ: rng.range(-0.03, 0.03),
        uvScale: 0.3, tint: shade(tint, 0.6),
      });
    }
    const rebarAt = toWorld(0.18 * width, 0.05 * depth);
    rebar(rebarAt.x, baseY + STOREY + 0.26, rebarAt.z, 6, 1.4);

    // Rubble spilling out of the blown side, doubling as a ramp onto
    // the surviving first-floor slab.
    const blownFace = faceInfo(blown, halfW + 2.2, halfD + 2.2);
    const rp = toWorld(blownFace.lx, blownFace.lz);
    rubblePile(rp.x, rp.z, rng.range(2.4, 3.6), 1.3);
    if (detail >= 1) {
      const inner = toWorld(0, 0);
      rubblePile(inner.x, inner.z, 2.0, 0.7);
    }

    return {
      x, z, width, depth, storeys: 2, rotation, baseY,
      topY: baseY + STOREY * 2, radius: Math.hypot(halfW, halfD),
    };
  }

  /* ---- archetype: shed / kiosk ---- */

  function buildShed(spec) {
    const { x, z, detail, tint, materialName, rotation, options } = spec;
    const width = options.width ?? rng.range(4.5, 7.5);
    const depth = options.depth ?? rng.range(4, 6.5);
    const height = rng.range(2.6, 3.2);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const baseY = pad(x, z, width, depth);
    const toWorld = planner(x, z, rotation);

    const corners = [
      toWorld(-halfW, -halfD, baseY), toWorld(halfW, -halfD, baseY),
      toWorld(halfW, halfD, baseY), toWorld(-halfW, halfD, baseY),
    ];
    for (let side = 0; side < 4; side += 1) {
      const start = corners[side];
      const end = corners[(side + 1) % 4];
      const openings = side === 0
        ? [{ at: 0.5, width: 1.1, sill: 0, top: 2.1, kind: "door" }]
        : (side === 2 ? [{ at: 0.5, width: 1.0, sill: 1.0, top: 2.1, kind: "win" }] : []);
      const built = wall(materialName, {
        start, end, height, openings, tint, tintBottom: shade(tint, 0.58, 0.1),
      });
      if (built) {
        const angle = Math.atan2(end.x - start.x, end.z - start.z);
        for (const cut of built.cuts) {
          const p = built.at(cut.u);
          dressOpening({
            centre: new THREE.Vector3(p.x, 0, p.z), angle,
            y: baseY + cut.sill, sillY: cut.sill > 0.2 ? baseY + cut.sill : undefined,
            width: cut.width, height: cut.top - cut.sill,
            materialName, tint, detail, glass: cut.spec.kind === "win",
          });
        }
      }
    }
    // Mono-pitch corrugated lid with an overhang.
    box("metal", {
      position: toWorld(0, 0, baseY + height + 0.25),
      size: new THREE.Vector3(width + 0.9, 0.14, depth + 0.9),
      rotationY: rotation, rotationX: 0.11, uvScale: 0.8,
      surface: SURFACE.METAL, tint: rng.pick(SHEET),
    });
    if (detail >= 1 && rng.chance(0.6)) {
      const p = toWorld(halfW + 0.9, 0);
      oilDrums(p.x, p.z, rng.int(1, 3));
    }

    return {
      x, z, width, depth, storeys: 1, rotation, baseY,
      topY: baseY + height, radius: Math.hypot(halfW, halfD),
    };
  }

  /* ---------------------------- cover kit ---------------------------- */

  /** Sandbag emplacement - the readable, low, shootable-over cover a
   *  capture point needs. */
  function sandbagWall(x, z, rotationY, length = 4.2, atY = null) {
    const ground = seat(x, z, length * 0.5, 0.36, rotationY);
    if (atY === null && ground.drop > 0.8) { unseatedCount += 1; return; }
    const y = atY === null ? ground.y : atY;
    const rows = 3;
    for (let row = 0; row < rows; row += 1) {
      const rowY = y + 0.22 + row * 0.32;
      const rowLen = length - row * 0.5;
      const bags = Math.max(2, Math.round(rowLen / 0.62));
      for (let i = 0; i < bags; i += 1) {
        const t = (i + 0.5) / bags - 0.5;
        const offset = t * rowLen;
        box("sandbag", {
          position: new THREE.Vector3(
            x + Math.cos(rotationY) * offset,
            rowY,
            z - Math.sin(rotationY) * offset
          ),
          size: new THREE.Vector3(0.62, 0.32, 0.42),
          rotationY: rotationY + rng.range(-0.09, 0.09),
          surface: SURFACE.SAND,
          uvScale: 1.4,
          collide: false,     // one collider for the stack, not 24
          tint: shade(0xa3987f, rng.range(0.82, 1.06)),
        });
      }
    }
    ctx.physics.addBox({
      center: new THREE.Vector3(x, y + 0.55, z),
      halfExtents: new THREE.Vector3(length * 0.5, 0.55, 0.34),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -rotationY, 0)),
      layer: LAYER.STATIC,
      surface: SURFACE.SAND,
      penetrable: 0.35,
    });
    colliderCount += 1;
    contactShadow(x, z, length * 0.5, 0.36, rotationY, 0.5, atY);
  }

  /** HESCO-style gabion revetment. Taller and squarer than sandbags,
   *  so a position built from both reads as layered rather than
   *  repeated. */
  function hesco(x, z, rotationY, length = 6, height = 1.35) {
    const units = Math.max(2, Math.round(length / 1.25));
    const ground = seat(x, z, length * 0.5, 0.55, rotationY);
    if (ground.drop > height * 0.75) { unseatedCount += 1; return; }
    const y = ground.y;
    for (let i = 0; i < units; i += 1) {
      const t = (i + 0.5) / units - 0.5;
      const ox = Math.cos(rotationY) * t * length;
      const oz = -Math.sin(rotationY) * t * length;
      box("sandbag", {
        position: new THREE.Vector3(x + ox, y + height * 0.5, z + oz),
        size: new THREE.Vector3(1.22, height, 1.0),
        rotationY, uvScale: 0.9, surface: SURFACE.SAND, collide: false,
        tint: shade(0x8f8873, rng.range(0.85, 1.05)),
        tintBottom: 0x6d6857,
      });
      // Wire mesh cage edge, proud of the fill.
      box("metal", {
        position: new THREE.Vector3(x + ox, y + height + 0.04, z + oz),
        size: new THREE.Vector3(1.28, 0.08, 1.06),
        rotationY, uvScale: 2.5, collide: false, tint: 0x55503f,
      });
    }
    ctx.physics.addBox({
      center: new THREE.Vector3(x, y + height * 0.5, z),
      halfExtents: new THREE.Vector3(length * 0.5, height * 0.5, 0.55),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -rotationY, 0)),
      layer: LAYER.STATIC, surface: SURFACE.SAND, penetrable: 0.15,
    });
    colliderCount += 1;
    contactShadow(x, z, length * 0.5, 0.55, rotationY, 0.55);
  }

  /** Shipping container. Hard cover, climbable, and the one prop that
   *  instantly communicates scale. */
  function container(x, z, rotationY, options = {}) {
    // No drop limit: a container is 2.6m tall, so even a metre of fall
    // across its length buries a corner rather than losing the prop,
    // and callers stack on the Y this returns.
    const y = options.y ?? seat(x, z, 3.08, 1.25, rotationY).y;
    const colour = options.tint || rng.pick([0x7a3f2a, 0x2b5164, 0x4d5c3f, 0x7a6b30, 0x5e3230, 0x6b6255]);
    box("metal", {
      position: new THREE.Vector3(x, y + 1.3, z),
      size: new THREE.Vector3(6.06, 2.59, 2.44),
      rotationY, surface: SURFACE.METAL, uvScale: 0.55,
      tint: colour, tintBottom: shade(colour, 0.62, 0.08),
    });
    // Corner castings and the door end, so it is not a plain cuboid.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box("metal", {
          position: new THREE.Vector3(
            x + (Math.sin(rotationY) * sz * 1.18 + Math.cos(rotationY) * sx * 2.94),
            y + 1.3,
            z + (Math.cos(rotationY) * sz * 1.18 - Math.sin(rotationY) * sx * 2.94)
          ),
          size: new THREE.Vector3(0.28, 2.62, 0.2),
          rotationY, uvScale: 2, collide: false, tint: shade(colour, 1.15),
        });
      }
    }
    box("metal", {
      position: new THREE.Vector3(x + Math.cos(rotationY) * 3.05, y + 1.3, z - Math.sin(rotationY) * 3.05),
      size: new THREE.Vector3(0.06, 2.4, 2.3),
      rotationY, uvScale: 1.6, collide: false, tint: shade(colour, 0.82),
    });
    contactShadow(x, z, 3.08, 1.25, rotationY, 0.62, options.y ?? null);
    return y + 2.59;
  }

  /** Concrete jersey barrier. */
  function barrier(x, z, rotationY, atY = null) {
    const ground = seat(x, z, 1.2, 0.34, rotationY);
    if (atY === null && ground.drop > 0.5) { unseatedCount += 1; return; }
    const y = atY === null ? ground.y : atY;
    const tint = shade(0x9a9488, rng.range(0.82, 1.08));
    box("concrete", {
      position: new THREE.Vector3(x, y + 0.30, z),
      size: new THREE.Vector3(2.4, 0.60, 0.66),
      rotationY, surface: SURFACE.CONCRETE, uvScale: 0.8,
      tint, tintBottom: shade(tint, 0.62, 0.1),
    });
    // Tapered upper section - a jersey barrier's profile is the whole
    // reason it is recognisable.
    box("concrete", {
      position: new THREE.Vector3(x, y + 0.75, z),
      size: new THREE.Vector3(2.4, 0.34, 0.34),
      rotationY, uvScale: 0.9, collide: false, tint: shade(tint, 1.05),
    });
    contactShadow(x, z, 1.2, 0.34, rotationY, 0.5, atY);
  }

  /** Compound wall around a group of buildings. */
  function compoundWall(cx, cz, width, depth, rotationY, gates = 2, options = {}) {
    const y = options.y ?? terrain.heightAt(cx, cz);
    const height = options.height ?? 2.7;
    const tint = options.tint ?? rng.pick(PLASTER);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const corner = (lx, lz) => new THREE.Vector3(
      cx + lx * cos + lz * sin, y, cz - lx * sin + lz * cos
    );
    const corners = [
      corner(-halfW, -halfD), corner(halfW, -halfD),
      corner(halfW, halfD), corner(-halfW, halfD),
    ];
    const gateSides = options.gateSides || rng.shuffle([0, 1, 2, 3]).slice(0, gates);
    for (let i = 0; i < 4; i += 1) {
      const start = corners[i];
      const end = corners[(i + 1) % 4];
      const angle = Math.atan2(end.x - start.x, end.z - start.z);
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const openings = gateSides.includes(i)
        ? [{ at: options.gateAt ?? rng.range(0.35, 0.65), width: 4.0, sill: 0, top: height }]
        : [];
      // A breach: the flanking route that stops a walled compound
      // being a single-entrance killbox.
      if (!openings.length && options.breach !== false && rng.chance(0.28)) {
        openings.push({ at: rng.range(0.25, 0.75), width: rng.range(1.6, 2.6), sill: 0, top: height });
      }
      wall("blockwall", {
        start, end, height, openings,
        tint, tintBottom: shade(tint, 0.56, 0.12),
        surface: SURFACE.CONCRETE,
      });
      // Coping course along the top.
      box("blockwall", {
        position: new THREE.Vector3((start.x + end.x) * 0.5, y + height + 0.06, (start.z + end.z) * 0.5),
        size: new THREE.Vector3(WALL_THICKNESS + 0.16, 0.12, length),
        rotationY: angle, uvScale: 0.7, collide: false, tint: shade(tint, 1.12),
      });
      // Pier at each corner.
      box("blockwall", {
        position: new THREE.Vector3(start.x, y + height * 0.5 + 0.12, start.z),
        size: new THREE.Vector3(0.55, height + 0.24, 0.55),
        rotationY: angle, uvScale: 0.7, collide: false,
        tint: shade(tint, 1.05), tintBottom: shade(tint, 0.6, 0.12),
      });
      /* Sand banked along both faces.
       *
       * A compound wall is the longest uninterrupted line where any
       * built thing meets the desert, and it was ending in a perfectly
       * straight horizontal join tens of metres long - the most
       * conspicuous instance in the whole map of the reviewer's "hard
       * seam where props meet ground". Occlusion cannot repair a seam,
       * because the fault is in the silhouette rather than the value;
       * something has to physically interrupt the line. Two low steps
       * of the ground's own material do, for 24 triangles a run.
       *
       * Drawn per run rather than per compound so it follows a wall
       * that crosses a slope, and drafted from the wall's own centre
       * line so the two faces stay symmetrical. */
      const mid = new THREE.Vector3(
        (start.x + end.x) * 0.5, y, (start.z + end.z) * 0.5
      );
      const nX = Math.cos(angle);
      const nZ = -Math.sin(angle);
      for (const [side, out, h, lift] of [
        [-1, 0.30, 0.14, 0], [1, 0.30, 0.14, 0],
        [-1, 0.62, 0.08, 0.13], [1, 0.62, 0.08, 0.13],
      ]) {
        const d = side * (WALL_THICKNESS * 0.5 + out * 0.5);
        box("sand", {
          position: new THREE.Vector3(mid.x + nX * d, y + lift + h * 0.5 - 0.04, mid.z + nZ * d),
          size: new THREE.Vector3(out, h, length),
          rotationY: angle, uvScale: 0.5, collide: false,
          tint: 0xb6a488, tintBottom: 0x6d6252,
        });
      }
      // One occlusion strip per run rather than one per compound: a
      // single blob over the whole yard would darken the courtyard the
      // wall is supposed to enclose.
      contactShadow(
        mid.x, mid.z,
        0.2, length * 0.5, angle, 0.45
      );
    }
  }

  /* ------------------------- set dressing props ------------------------- */

  function crate(x, y, z, rotationY, size = 0.9) {
    const tint = shade(0x8a7350, rng.range(0.8, 1.15));
    box("wood", {
      position: new THREE.Vector3(x, y + size * 0.5, z),
      size: new THREE.Vector3(size, size, size * rng.range(0.85, 1.15)),
      rotationY, surface: SURFACE.WOOD, uvScale: 1.1,
      tint, tintBottom: shade(tint, 0.72),
    });
    // Diagonal brace on one face.
    box("wood", {
      position: new THREE.Vector3(
        x + Math.cos(rotationY) * (size * 0.5 + 0.02), y + size * 0.5,
        z - Math.sin(rotationY) * (size * 0.5 + 0.02)
      ),
      size: new THREE.Vector3(0.03, size * 0.16, size * 1.3),
      rotationY, rotationX: 0.7, uvScale: 2, collide: false, tint: shade(tint, 1.15),
    });
    return y + size;
  }

  function crateStack(x, z, rotationY, atY = null) {
    const y = atY === null ? seat(x, z, 0.88, 0.88, rotationY).y : atY;
    let top = y;
    const count = rng.int(2, 5);
    for (let i = 0; i < count; i += 1) {
      const size = rng.range(0.62, 1.05);
      top = crate(
        x + rng.range(-0.35, 0.35), i === 0 ? y : top - 0.02, z + rng.range(-0.35, 0.35),
        rotationY + rng.range(-0.4, 0.4), size
      );
    }
    contactShadow(x, z, 0.88, 0.88, rotationY, 0.5, atY);
    if (rng.chance(0.5)) pallet(x + rng.range(-1.4, 1.4), z + rng.range(-1.4, 1.4), rng.range(0, Math.PI), y);
  }

  function pallet(x, z, rotationY, atY = null) {
    const ground = seat(x, z, 0.6, 0.6, rotationY);
    if (atY === null && ground.drop > 0.3) { unseatedCount += 1; return; }
    const y = atY === null ? ground.y : atY;
    const tint = shade(0x9a8256, rng.range(0.75, 1.05));
    for (let i = 0; i < 4; i += 1) {
      box("wood", {
        position: new THREE.Vector3(
          x + Math.cos(rotationY) * (i / 3 - 0.5) * 1.1, y + 0.12,
          z - Math.sin(rotationY) * (i / 3 - 0.5) * 1.1
        ),
        size: new THREE.Vector3(0.16, 0.03, 1.15),
        rotationY, uvScale: 1.5, collide: false, tint,
      });
    }
    for (const side of [-1, 0, 1]) {
      box("wood", {
        position: new THREE.Vector3(
          x - Math.sin(rotationY) * side * 0.5, y + 0.05, z - Math.cos(rotationY) * side * 0.5
        ),
        size: new THREE.Vector3(1.2, 0.09, 0.12),
        rotationY, uvScale: 1.5, collide: false, tint: shade(tint, 0.85),
      });
    }
    ctx.physics.addBox({
      center: new THREE.Vector3(x, y + 0.07, z),
      halfExtents: new THREE.Vector3(0.6, 0.07, 0.6),
      layer: LAYER.STATIC, surface: SURFACE.WOOD,
    });
    colliderCount += 1;
    contactShadow(x, z, 0.6, 0.6, rotationY, 0.42, atY);
  }

  function oilDrum(x, y, z, tint) {
    const colour = tint || rng.pick([0x6a3b2c, 0x3f5566, 0x5f5a3a, 0x7a6a58, 0x4a4a44]);
    cylinder("metal", {
      position: new THREE.Vector3(x, y + 0.44, z),
      radius: 0.29, height: 0.88, segments: 10,
      surface: SURFACE.METAL, tint: colour, tintBottom: shade(colour, 0.6, 0.1),
      rotationY: rng.range(0, Math.PI),
    });
    // Rolling hoops.
    for (const h of [0.32, 0.58]) {
      cylinder("metal", {
        position: new THREE.Vector3(x, y + h, z),
        radius: 0.305, height: 0.05, segments: 10,
        collide: false, tint: shade(colour, 1.2),
      });
    }
    contactShadow(x, z, 0.30, 0.30, 0, 0.5, y);
  }

  function oilDrums(x, z, count = 3, atY = null) {
    const y = atY === null ? seat(x, z, 0.3 + Math.sqrt(count) * 0.5).y : atY;
    for (let i = 0; i < count; i += 1) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 0.75) * Math.sqrt(count);
      const dx = x + Math.cos(a) * d;
      const dz = z + Math.sin(a) * d;
      // Each drum seats itself. Handing every drum the cluster's Y put
      // the outlying ones up to a metre off the sand on a dune, and
      // buried their contact blobs under the terrain with them.
      oilDrum(dx, atY === null ? seat(dx, dz, 0.3, 0.3).y : y, dz);
    }
    // One on its side is worth three standing up.
    if (rng.chance(0.4)) {
      const fx = x + rng.range(-1.4, 1.4);
      const fz = z + rng.range(-1.4, 1.4);
      const fa = rng.range(0, Math.PI);
      cylinder("metal", {
        position: new THREE.Vector3(fx, y + 0.29, fz),
        radius: 0.29, height: 0.88, segments: 10, axis: "z",
        rotationY: fa, surface: SURFACE.METAL,
        tint: rng.pick([0x6a3b2c, 0x4a4a44]),
      });
      contactShadow(fx, fz, 0.44, 0.29, fa, 0.55, y);
    }
    // No cluster blob: oilDrum() now places its own, and a single blob
    // over the whole scatter left the outlying drums on bare sand.
  }

  function tyreStack(x, z, count = 4, atY = null) {
    const y = atY === null ? seat(x, z, 0.5, 0.5).y : atY;
    for (let i = 0; i < count; i += 1) {
      cylinder("metal", {
        position: new THREE.Vector3(x + rng.range(-0.07, 0.07), y + 0.11 + i * 0.21, z + rng.range(-0.07, 0.07)),
        radius: 0.44, height: 0.21, segments: 10, open: true,
        rotationY: rng.range(0, Math.PI), collide: i === 0,
        surface: SURFACE.WOOD, tint: 0x2e2b28,
      });
    }
    contactShadow(x, z, 0.5, 0.5, 0, 0.55, atY);
  }

  function generator(x, z, rotationY, atY = null) {
    const y = atY === null ? seat(x, z, 1.0, 0.58, rotationY).y : atY;
    const tint = rng.pick([0x6a6f5a, 0x5f6470, 0x74695a]);
    box("metal", {
      position: new THREE.Vector3(x, y + 0.12, z),
      size: new THREE.Vector3(2.0, 0.24, 1.1),
      rotationY, uvScale: 1.0, surface: SURFACE.METAL, tint: shade(tint, 0.6),
    });
    box("metal", {
      position: new THREE.Vector3(x, y + 0.82, z),
      size: new THREE.Vector3(1.8, 1.16, 0.95),
      rotationY, uvScale: 1.0, surface: SURFACE.METAL,
      tint, tintBottom: shade(tint, 0.72),
    });
    // Louvre panel and exhaust stack.
    box("metal", {
      position: new THREE.Vector3(x + Math.cos(rotationY) * 0.92, y + 0.82, z - Math.sin(rotationY) * 0.92),
      size: new THREE.Vector3(0.05, 0.8, 0.7),
      rotationY, uvScale: 5, collide: false, tint: shade(tint, 0.45),
    });
    cylinder("metal", {
      position: new THREE.Vector3(x - Math.cos(rotationY) * 0.7, y + 1.75, z + Math.sin(rotationY) * 0.7),
      radius: 0.09, height: 0.85, segments: 6, collide: false, tint: 0x3a352e,
    });
    contactShadow(x, z, 1.0, 0.58, rotationY, 0.55, atY);
  }

  /** Elevated pipe run on saddles. Chest-high pipework is the best
   *  cover-that-you-can-see-through an industrial area can have. */
  function pipeRun(x1, z1, x2, z2, height = 1.5, radius = 0.24) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const angle = Math.atan2(dx, dz);

    /* Clear the crest, not the mean of the two ends.
     *
     * A pipe run is straight; the ground under it is not. The tube used
     * to sit at the mean height of its two ENDPOINTS while every
     * support was sized from its own LOCAL ground - two different
     * references for two things that have to touch. Measured under the
     * depot, the terrain wanders up to 4m from that endpoint mean over a
     * 40m run, so supports in a dip stopped metres short of the tube
     * they hold up and the tube itself was buried where the ground rose
     * between them. Taking the highest point under the run and then
     * running each support up to the tube is how a real rack is built,
     * and it is the only version where the two always meet.
     */
    let crest = -Infinity;
    const profileSteps = Math.max(4, Math.round(length / 3));
    for (let i = 0; i <= profileSteps; i += 1) {
      const t = i / profileSteps;
      crest = Math.max(crest, terrain.heightAt(lerp(x1, x2, t), lerp(z1, z2, t)));
    }
    const y = crest;
    // Weathered galvanised pipework sits near 0.25 linear. The old set
    // was 0.15 - the darkest tint in the file - and measured as the
    // darkest merged mesh in the establishing frame at median luma 27
    // against terrain's 86.
    const tint = rng.pick([0x8b8478, 0x77858a, 0x8f8272]);
    for (const offset of [0, radius * 2.4]) {
      cylinder("metal", {
        position: new THREE.Vector3((x1 + x2) * 0.5, y + height + offset, (z1 + z2) * 0.5),
        radius, height: length, segments: 10, axis: "z", rotationY: angle,
        surface: SURFACE.METAL, tint, tintBottom: shade(tint, 0.7),
      });
    }
    const supports = Math.max(2, Math.round(length / 7));
    // The underside of the lower tube: every support runs up to exactly
    // this, from wherever its own patch of ground happens to be.
    const saddle = y + height - radius;
    for (let i = 0; i <= supports; i += 1) {
      const t = i / supports;
      const px = lerp(x1, x2, t);
      const pz = lerp(z1, z2, t);
      const py = terrain.heightAt(px, pz);
      const stand = saddle - py;
      // Ground that has come up to meet the pipe needs no support, and
      // a 10cm stub reads as a mistake.
      if (stand < 0.25) continue;
      box("metal", {
        position: new THREE.Vector3(px, py + stand * 0.5, pz),
        size: new THREE.Vector3(0.22, stand, 0.22),
        rotationY: angle, uvScale: 1.2, surface: SURFACE.METAL, tint: shade(tint, 0.75),
      });
      contactShadow(px, pz, 0.11, 0.11, angle, 0.5, py);
    }
  }

  /** Large fuel tank inside a bund wall. */
  function fuelTank(x, z, radius = 4.5, height = 6.5) {
    const y = terrain.flatten(x, z, radius * 1.5, null, 1.4);
    const tint = rng.pick([0x8f8b7f, 0x7d857f, 0x8a8172]);
    cylinder("metal", {
      position: new THREE.Vector3(x, y + height * 0.5, z),
      radius, height, segments: 16, surface: SURFACE.METAL,
      /* uvScale 1.05, not 0.25.
         At 0.25 one texture tile covered 4m of a 9m-diameter tank, which
         put the metal generator's paint-failure blotches at roughly a
         metre. The generator fails green-grey paint (0.30,0.34,0.31) to
         warm primer to red-brown rust - a sensible progression at
         weathering scale, and at metre scale a green-and-red patchwork.
         A blind reviewer described these tanks as "garish red/green
         camouflage", which is exactly what two complementary hues in
         metre-sized patches look like. Four times finer puts the
         blotches near 25cm, where they read as corrosion. */
      tint, tintBottom: shade(tint, 0.55, 0.1), uvScale: 1.05,
    });
    // Domed top, approximated by a shallow cone.
    cylinder("metal", {
      position: new THREE.Vector3(x, y + height + 0.5, z),
      radiusTop: radius * 0.25, radiusBottom: radius, height: 1.0, segments: 16,
      collide: false, tint: shade(tint, 1.08), uvScale: 1.05,
    });
    // Bund wall - low, walkable-behind cover that also says "fuel".
    const seg = 14;
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      const br = radius + 3.2;
      box("concrete", {
        position: new THREE.Vector3(x + Math.cos(a) * br, y + 0.55, z + Math.sin(a) * br),
        size: new THREE.Vector3(0.4, 1.1, (Math.PI * 2 * br) / seg + 0.2),
        rotationY: -a, uvScale: 0.6, surface: SURFACE.CONCRETE,
        tint: 0x8f887b, tintBottom: 0x5f5a50,
      });
    }
    // Access ladder and a top railing.
    for (let i = 0; i < Math.round(height / 0.34); i += 1) {
      box("metal", {
        position: new THREE.Vector3(x, y + 0.3 + i * 0.34, z + radius + 0.18),
        size: new THREE.Vector3(0.5, 0.04, 0.05),
        uvScale: 3, collide: false, tint: 0x59524a,
      });
    }
    contactShadow(x, z, radius, radius, 0, 0.6, null);
    return y + height;
  }

  /** Wrecked civilian car. Burnt-out shells are the single most
   *  effective piece of street dressing in the reference material. */
  function wreckedCar(x, z, rotationY, options = {}) {
    const ground = seat(x, z, 2.1, 0.88, rotationY);
    if (options.y === undefined && ground.drop > 0.7) { unseatedCount += 1; return; }
    const y = options.y ?? ground.y;
    const burnt = options.burnt ?? rng.chance(0.5);
    const paint = burnt ? 0x2e2a26 : rng.pick(CAR_PAINT);
    const tilt = rng.range(-0.05, 0.05);
    const body = shade(paint, 1.0);
    box("metal", {
      position: new THREE.Vector3(x, y + 0.62, z),
      size: new THREE.Vector3(4.2, 0.62, 1.72),
      rotationY, rotationZ: tilt, uvScale: 0.7, surface: SURFACE.METAL,
      tint: body, tintBottom: shade(body, 0.55, 0.05),
    });
    box("metal", {
      position: new THREE.Vector3(
        x - Math.cos(rotationY) * 0.25, y + 1.24, z + Math.sin(rotationY) * 0.25
      ),
      size: new THREE.Vector3(2.1, 0.66, 1.58),
      rotationY, rotationZ: tilt, uvScale: 0.9, surface: SURFACE.METAL,
      tint: shade(body, burnt ? 0.7 : 0.92),
    });
    // Bonnet and boot planes, so it is not a two-box silhouette.
    for (const sign of [-1, 1]) {
      box("metal", {
        position: new THREE.Vector3(
          x + Math.cos(rotationY) * sign * 1.5, y + 0.96, z - Math.sin(rotationY) * sign * 1.5
        ),
        size: new THREE.Vector3(1.25, 0.10, 1.6),
        rotationY, rotationZ: tilt, uvScale: 1.0, collide: false,
        tint: shade(body, 1.05),
      });
    }
    for (const sx of [-1.35, 1.35]) {
      for (const sz of [-0.85, 0.85]) {
        cylinder("metal", {
          position: new THREE.Vector3(
            x + Math.cos(rotationY) * sx - Math.sin(rotationY) * sz, y + 0.31,
            z - Math.sin(rotationY) * sx - Math.cos(rotationY) * sz
          ),
          radius: 0.31, height: 0.2, segments: 8, axis: "z",
          rotationY: rotationY + Math.PI * 0.5, collide: false,
          tint: burnt ? 0x1f1c19 : 0x2a2724,
        });
      }
    }
    if (burnt) {
      // Scorch halo on the ground.
      box("asphalt", {
        position: new THREE.Vector3(x, y + 0.03, z),
        size: new THREE.Vector3(5.4, 0.02, 3.4),
        rotationY, uvScale: 0.3, collide: false, tint: 0x2a2724,
      });
    }
    contactShadow(x, z, 2.1, 0.88, rotationY, 0.6, options.y ?? null);
  }

  /** Telegraph pole. Call `wire()` between two of them. */
  function telegraphPole(x, z, options = {}) {
    const y = options.y ?? seat(x, z, 0.18, 0.18).y;
    const height = options.height ?? rng.range(7.5, 9);
    const lean = rng.range(-0.05, 0.05);
    cylinder("wood", {
      position: new THREE.Vector3(x, y + height * 0.5, z),
      radius: 0.16, radiusTop: 0.12, height, segments: 7,
      rotationZ: lean, surface: SURFACE.WOOD,
      tint: 0x6a5b48, tintBottom: 0x453a2e, uvScale: 0.5,
    });
    const rotationY = options.rotationY ?? 0;
    for (const h of [height - 0.5, height - 1.3]) {
      box("wood", {
        position: new THREE.Vector3(x, y + h, z),
        size: new THREE.Vector3(0.12, 0.12, 1.9),
        rotationY, uvScale: 1.5, collide: false, tint: 0x5f5140,
      });
    }
    contactShadow(x, z, 0.18, 0.18, 0, 0.4);
    return { x, z, top: y + height - 0.5, second: y + height - 1.3, rotationY };
  }

  /**
   * Catenary wire between two poles, in three segments so it droops.
   * Wires against the sky are one of the highest value-per-triangle
   * things in the whole kit: they read instantly as inhabited.
   */
  function wire(a, b, sag = 0.9) {
    const segments = 3;
    for (const level of ["top", "second"]) {
      for (const offset of [-0.75, 0, 0.75]) {
        if (level === "second" && offset === 0) continue;
        const ax = a.x + Math.cos(a.rotationY) * offset;
        const az = a.z - Math.sin(a.rotationY) * offset;
        const bx = b.x + Math.cos(b.rotationY) * offset;
        const bz = b.z - Math.sin(b.rotationY) * offset;
        const ay = a[level];
        const by = b[level];
        for (let i = 0; i < segments; i += 1) {
          const t0 = i / segments;
          const t1 = (i + 1) / segments;
          const droop = (t) => -sag * 4 * t * (1 - t);
          const x0 = lerp(ax, bx, t0); const z0 = lerp(az, bz, t0);
          const x1 = lerp(ax, bx, t1); const z1 = lerp(az, bz, t1);
          const y0 = lerp(ay, by, t0) + droop(t0);
          const y1 = lerp(ay, by, t1) + droop(t1);
          const dx = x1 - x0; const dz = z1 - z0; const dy = y1 - y0;
          const len = Math.hypot(dx, dz, dy);
          box("metal", {
            position: new THREE.Vector3((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5),
            size: new THREE.Vector3(0.035, 0.035, len),
            rotationY: Math.atan2(dx, dz),
            rotationX: -Math.asin(clamp(dy / len, -1, 1)),
            uvScale: 1, collide: false, tint: 0x24211d,
          });
        }
      }
    }
  }

  function roadSign(x, z, rotationY, options = {}) {
    const y = seat(x, z, 0.07, 0.07).y;
    const height = options.height ?? 2.4;
    cylinder("metal", {
      position: new THREE.Vector3(x, y + height * 0.5, z),
      radius: 0.06, height, segments: 6,
      surface: SURFACE.METAL, tint: 0x6f6a60,
    });
    box("metal", {
      position: new THREE.Vector3(x, y + height - 0.35, z),
      size: new THREE.Vector3(0.05, 0.7, options.width ?? 1.5),
      rotationY, uvScale: 1.0, collide: false,
      tint: options.tint ?? rng.pick([0x3f5b46, 0x7a7367, 0x5a5f6b]),
    });
    contactShadow(x, z, 0.07, 0.07, 0, 0.45, y);
  }

  /** Chain-link fence: penetrable and see-through, so it shapes
   *  movement without breaking sightlines or stopping bullets. */
  function chainFence(x1, z1, x2, z2, options = {}) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1) return;
    const angle = Math.atan2(dx, dz);
    const height = options.height ?? 2.2;
    const posts = Math.max(2, Math.round(length / 2.6));
    for (let i = 0; i <= posts; i += 1) {
      const t = i / posts;
      const px = lerp(x1, x2, t);
      const pz = lerp(z1, z2, t);
      const py = terrain.heightAt(px, pz);
      cylinder("metal", {
        position: new THREE.Vector3(px, py + height * 0.5, pz),
        radius: 0.055, height, segments: 6, collide: false,
        surface: SURFACE.METAL, tint: 0x66605a,
      });
    }
    // Mesh panels, split so the fence follows the ground.
    for (let i = 0; i < posts; i += 1) {
      const t0 = i / posts;
      const t1 = (i + 1) / posts;
      const mx = lerp(x1, x2, (t0 + t1) * 0.5);
      const mz = lerp(z1, z2, (t0 + t1) * 0.5);
      const my = terrain.heightAt(mx, mz);
      box("metal", {
        position: new THREE.Vector3(mx, my + height * 0.5, mz),
        size: new THREE.Vector3(0.03, height - 0.1, length / posts),
        rotationY: angle, uvScale: 2.2, surface: SURFACE.METAL,
        tint: 0x8a857c, penetrable: 0.95, opaque: false,
      });
      // Top rail catches the light and gives the run a hard edge.
      box("metal", {
        position: new THREE.Vector3(mx, my + height, mz),
        size: new THREE.Vector3(0.06, 0.06, length / posts),
        rotationY: angle, uvScale: 2, collide: false, tint: 0x5c5750,
      });
      contactShadow(mx, mz, 0.06, length / posts * 0.5, angle, 0.4, my);
    }
  }

  /** Concertina razor wire. Approximated by open rings along a run -
   *  at any range a player sees it from, the read is identical. */
  function razorWire(x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 0.8) return;
    const angle = Math.atan2(dx, dz);
    const coils = Math.max(2, Math.round(length / 0.55));
    for (let i = 0; i < coils; i += 1) {
      const t = (i + 0.5) / coils;
      const px = lerp(x1, x2, t);
      const pz = lerp(z1, z2, t);
      const py = terrain.heightAt(px, pz);
      cylinder("metal", {
        position: new THREE.Vector3(px, py + 0.42, pz),
        radius: 0.42, height: 0.06, segments: 9, open: true, axis: "z",
        rotationY: angle + rng.range(-0.12, 0.12), rotationX: rng.range(-0.1, 0.1),
        collide: false, tint: 0x8f8a80,
      });
    }
    ctx.physics.addBox({
      center: new THREE.Vector3((x1 + x2) * 0.5,
        terrain.heightAt((x1 + x2) * 0.5, (z1 + z2) * 0.5) + 0.42, (z1 + z2) * 0.5),
      halfExtents: new THREE.Vector3(0.45, 0.45, length * 0.5),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
      layer: LAYER.STATIC, surface: SURFACE.METAL, penetrable: 1.0, opaque: false,
    });
    colliderCount += 1;
  }

  /** Market stall: posts, a fabric canopy, a table and produce. */
  function marketStall(x, z, rotationY, options = {}) {
    const y = options.y ?? seat(x, z, (options.width ?? 3.1) * 0.5, (options.depth ?? 2.3) * 0.5, rotationY).y;
    const width = options.width ?? rng.range(2.6, 3.6);
    const depth = options.depth ?? rng.range(2.0, 2.6);
    const height = 2.35;
    const fabric = options.tint ?? rng.pick(FABRIC);
    const to = planner(x, z, rotationY);

    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = to(ox * width * 0.5, oz * depth * 0.5);
      box("wood", {
        position: new THREE.Vector3(p.x, y + height * 0.5, p.z),
        size: new THREE.Vector3(0.1, height, 0.1),
        rotationY, uvScale: 1.5, surface: SURFACE.WOOD,
        tint: 0xa89076, tintBottom: 0x6f5c42,
      });
    }
    // Canopy, sagging between the posts.
    box("sandbag", {
      position: new THREE.Vector3(x, y + height + 0.1, z),
      size: new THREE.Vector3(width + 0.5, 0.10, depth + 0.5),
      rotationY, rotationX: rng.range(-0.09, 0.09), rotationZ: rng.range(-0.07, 0.07),
      uvScale: 0.6, surface: SURFACE.WOOD,
      tint: fabric, tintBottom: shade(fabric, 2.3), penetrable: 0.9,
    });
    // Skirt hanging off the front edge, so the canopy has a silhouette
    // from underneath instead of disappearing edge-on.
    {
      const f = to(0, -(depth + 0.5) * 0.5);
      box("sandbag", {
        position: new THREE.Vector3(f.x, y + height - 0.02, f.z),
        size: new THREE.Vector3(width + 0.5, 0.22, 0.04),
        rotationY, uvScale: 1.0, collide: false,
        tint: shade(fabric, 0.9), tintBottom: shade(fabric, 0.6),
      });
    }
    // Table with a cloth front.
    const t = to(0, -depth * 0.22);
    box("wood", {
      position: new THREE.Vector3(t.x, y + 0.85, t.z),
      size: new THREE.Vector3(width * 0.9, 0.08, depth * 0.5),
      rotationY, uvScale: 1.0, surface: SURFACE.WOOD, tint: 0xb49a72,
    });
    box("sandbag", {
      position: new THREE.Vector3(t.x, y + 0.42, t.z - depth * 0.25),
      size: new THREE.Vector3(width * 0.9, 0.85, 0.03),
      rotationY, uvScale: 0.8, collide: false, tint: shade(fabric, 0.85),
    });
    contactShadow(x, z, width * 0.5 + 0.25, depth * 0.5 + 0.25, rotationY, 0.55, options.y ?? null);
    if (rng.chance(0.7)) crateStack(to(width * 0.3, depth * 0.3).x, to(width * 0.3, depth * 0.3).z, rotationY, y);
  }

  /** Long shade canopy over a bazaar aisle. Blocks the sky, which is
   *  what makes a market fight feel different from a street fight. */
  function bazaarCanopy(x1, z1, x2, z2, width = 6) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 2) return;
    const angle = Math.atan2(dx, dz);
    const bays = Math.max(2, Math.round(length / 4.5));
    const height = 3.4;
    for (let i = 0; i <= bays; i += 1) {
      const t = i / bays;
      const px = lerp(x1, x2, t);
      const pz = lerp(z1, z2, t);
      const py = terrain.heightAt(px, pz);
      for (const side of [-1, 1]) {
        box("wood", {
          position: new THREE.Vector3(
            px + Math.cos(angle) * side * width * 0.5, py + height * 0.5,
            pz - Math.sin(angle) * side * width * 0.5
          ),
          size: new THREE.Vector3(0.16, height, 0.16),
          rotationY: angle, uvScale: 1.2, surface: SURFACE.WOOD,
          tint: 0xa8977a, tintBottom: 0x6f6350,
        });
        contactShadow(
          px + Math.cos(angle) * side * width * 0.5,
          pz - Math.sin(angle) * side * width * 0.5,
          0.08, 0.08, angle, 0.45, py
        );
      }
      // Cross beam.
      box("wood", {
        position: new THREE.Vector3(px, py + height, pz),
        size: new THREE.Vector3(width + 0.4, 0.12, 0.12),
        rotationY: angle, uvScale: 1.2, collide: false, tint: 0x9c8c72,
      });
    }
    /* Canopy panels, deliberately NOT continuous.
     *
     * A solid roof over the whole aisle sealed the market off: 22% of
     * that frame came back crushed to black and the metric harness
     * flagged it. It is also wrong. A bazaar canopy is a patchwork of
     * separate sheets slung between beams, and the thing that makes the
     * space photograph is the strips of hard sun falling through the
     * gaps onto the floor. Every third panel is missing and the rest
     * are narrower than the bay, so light gets in and the aisle reads
     * as roofed rather than as a cave.
     */
    for (let i = 0; i < bays; i += 1) {
      if (rng.chance(0.3)) continue;
      const t = (i + 0.5) / bays;
      const px = lerp(x1, x2, t);
      const pz = lerp(z1, z2, t);
      const py = terrain.heightAt(px, pz);
      const span = (length / bays) * rng.range(0.6, 0.86);
      const across = (width + 0.3) * rng.range(0.55, 0.9);
      /* This picked FABRIC twice and handed the second colour to the
       * underside, so a panel could be green on top and orange beneath.
       * A sheet of cloth is one colour seen from two sides.
       *
       * The second draw is KEPT, because dropping an rng call here
       * shifts every layout decision after it and rebuilds the town -
       * and the seed exists so that a material change can be judged on
       * the same map. Spend it on how much sun this particular sheet
       * lets through, which is a real per-sheet property, instead of on
       * a second colour for one piece of cloth. */
      const cloth = rng.pick(FABRIC);
      const through = 1.9 + (FABRIC.indexOf(rng.pick(FABRIC)) / FABRIC.length) * 0.8;
      box("sandbag", {
        position: new THREE.Vector3(px, py + height + 0.16, pz),
        size: new THREE.Vector3(across, 0.11, span),
        rotationY: angle, rotationX: rng.range(-0.05, 0.05),
        rotationZ: rng.range(-0.06, 0.06),
        uvScale: 0.35, surface: SURFACE.WOOD,
        tint: cloth, tintBottom: shade(cloth, through),
        penetrable: 0.9,
      });
    }
  }

  /**
   * Guard tower. Legs, a platform, a railing and a roof - reachable by
   * ladder, so it is a position rather than a landmark.
   */
  function guardTower(x, z, rotationY = 0, options = {}) {
    const y = terrain.flatten(x, z, 4, null, 1.5);
    const height = options.height ?? 5.2;
    const size = options.size ?? 2.8;
    const tint = 0x9c8a72;
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      box("wood", {
        position: new THREE.Vector3(
          x + (ox * size * 0.5 * Math.cos(rotationY) - oz * size * 0.5 * Math.sin(rotationY)),
          y + height * 0.5,
          z + (ox * size * 0.5 * Math.sin(rotationY) + oz * size * 0.5 * Math.cos(rotationY))
        ),
        size: new THREE.Vector3(0.22, height, 0.22),
        rotationY, uvScale: 1.0, surface: SURFACE.WOOD,
        tint, tintBottom: shade(tint, 0.6),
      });
    }
    // Bracing, one X per face.
    for (let side = 0; side < 2; side += 1) {
      const a = rotationY + side * Math.PI * 0.5;
      for (const sign of [-1, 1]) {
        box("wood", {
          position: new THREE.Vector3(
            x + Math.cos(a) * size * 0.5, y + height * 0.45, z - Math.sin(a) * size * 0.5
          ),
          size: new THREE.Vector3(0.1, 0.1, size * 1.35),
          rotationY: a, rotationX: sign * 0.62,
          uvScale: 1.5, collide: false, tint: shade(tint, 0.9),
        });
      }
    }
    box("wood", {
      position: new THREE.Vector3(x, y + height + 0.1, z),
      size: new THREE.Vector3(size + 0.8, 0.2, size + 0.8),
      rotationY, uvScale: 0.9, surface: SURFACE.WOOD, tint: shade(tint, 1.1),
    });
    // Waist-high wall around the platform.
    for (let side = 0; side < 4; side += 1) {
      const a = rotationY + side * Math.PI * 0.5;
      box("wood", {
        position: new THREE.Vector3(
          x + Math.cos(a) * (size * 0.5 + 0.35), y + height + 0.65,
          z - Math.sin(a) * (size * 0.5 + 0.35)
        ),
        size: new THREE.Vector3(0.12, 0.9, size + 0.8),
        rotationY: a, uvScale: 1.0, surface: SURFACE.WOOD,
        tint: shade(tint, 1.05), penetrable: 0.4,
      });
    }
    // Roof on corner posts.
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      box("wood", {
        position: new THREE.Vector3(
          x + (ox * (size * 0.5 + 0.3) * Math.cos(rotationY) - oz * (size * 0.5 + 0.3) * Math.sin(rotationY)),
          y + height + 1.3,
          z + (ox * (size * 0.5 + 0.3) * Math.sin(rotationY) + oz * (size * 0.5 + 0.3) * Math.cos(rotationY))
        ),
        size: new THREE.Vector3(0.1, 2.2, 0.1),
        rotationY, uvScale: 1.5, collide: false, tint,
      });
    }
    box("metal", {
      position: new THREE.Vector3(x, y + height + 2.5, z),
      size: new THREE.Vector3(size + 1.4, 0.12, size + 1.4),
      rotationY, rotationX: 0.08, uvScale: 0.9,
      surface: SURFACE.METAL, tint: rng.pick(SHEET),
    });
    // Ladder up one face.
    const la = rotationY + Math.PI;
    for (let i = 0; i < Math.round(height / 0.34); i += 1) {
      box("wood", {
        position: new THREE.Vector3(
          x + Math.cos(la) * (size * 0.5 + 0.14), y + 0.3 + i * 0.34,
          z - Math.sin(la) * (size * 0.5 + 0.14)
        ),
        size: new THREE.Vector3(0.06, 0.05, 0.62),
        rotationY: la, uvScale: 3, collide: false, tint: shade(tint, 1.1),
      });
    }
    // Stair up to the platform. There is no ladder-climb verb in the
    // movement code, so a tower reached only by rungs is set dressing;
    // steps the capsule can step onto make it a position.
    const runLength = Math.round(height / 0.235) * 0.29;
    stairFlight("wood", {
      base: new THREE.Vector3(
        x + Math.cos(la) * (size * 0.5 + runLength),
        y,
        z - Math.sin(la) * (size * 0.5 + runLength)
      ),
      rotationY: la - Math.PI * 0.5, height: height + 0.2, width: 1.2, tint,
    });
    contactShadow(x, z, size * 0.5 + 0.2, size * 0.5 + 0.2, rotationY, 0.5);
    return y + height;
  }

  /* ---------------------------- merge pass ---------------------------- */

  let merged = null;
  const probeIndex = new Map();

  /**
   * The contact blobs' own material.
   *
   * MultiplyBlending rather than an alpha blend: the blob is an
   * occlusion term, so what it should do is scale the light already
   * there, not mix a grey towards it. Alpha-blended black looks right
   * on lit sand at noon and turns into a light grey smear in shadow at
   * dusk, because it ignores what it is sitting on.
   *
   * `fog: false` is load-bearing. Three's fog blends the fragment
   * towards the fog colour with distance, and a multiply mask fogged
   * towards pale sky would BRIGHTEN the ground at range - blobs would
   * become white patches on the far side of the map. Aerial perspective
   * is applied in the composite anyway, where it belongs.
   */
  const contactMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    // The occlusion term is the vertex stream and NOTHING ELSE. No map,
    // opacity pinned at 1, so every fragment leaves this material with
    // alpha exactly 1 and RGB in 0..1.
    vertexColors: true,
    map: null,
    alphaMap: null,
    opacity: 1,
    blending: THREE.MultiplyBlending,
    /* Three's multiply path is (ZERO, SRC_COLOR), and it REFUSES to run
     * - console.error per draw call, 216 of them in one capture, which
     * fails the shared boot gate every other agent runs - unless the
     * material declares premultiplied alpha.
     *
     * This is not a formality to silence a warning. Multiply blends by
     * the source RGB, so a source that has not been premultiplied
     * delivers a texel of alpha 0 as full-strength BLACK and punches a
     * hole in exactly the ground the blob was supposed to leave alone.
     * The invariant that makes the flag honest here is the one declared
     * above: with no texture and opacity 1, alpha is always 1, so
     * premultiplied and straight are the same value and the blend is a
     * clean dst *= src. Give this material a map and that stops being
     * true - so do not. */
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    side: THREE.FrontSide,
  });
  contactMaterial.name = "bs-contact";

  /**
   * Structures own their materials outright rather than sharing the
   * library's cached instance.
   *
   * Two properties have to be set for a merged town to shade correctly
   * - `vertexColors`, because per-piece colour lives in the vertex
   * stream, and `shadowSide`, because three defaults a FrontSide
   * material's shadow pass to BACK faces. That default is right for a
   * closed solid and wrong for the thin plates this kit is full of
   * (0.05m glass, 0.03m stain panels, 0.06m awning fabric): the back
   * face is a few centimetres behind the front, so the caster depth is
   * wrong by the plate's thickness and thin geometry drops out of its
   * own shadow. Mutating the shared cached material to fix that would
   * silently change every other module that asked for the same surface.
   */
  const ownMaterials = new Map();

  /**
   * Per-surface overrides that only make sense for STATIC STRUCTURES.
   *
   * The library's "metal" is bare steel - metalness 0.85 - which is
   * right for a vehicle hull and wrong for almost everything this kit
   * calls metal. A fuel tank, a shipping container, an oil drum, a
   * water tank, a roller shutter, a corrugated roof and a burnt-out
   * car are all PAINTED steel, and paint is a dielectric. At 0.85 a
   * conductor has essentially no diffuse response, so any face not
   * catching a specular highlight goes to black: the three tanks in the
   * depot shot were solid black silhouettes against a lit hillside,
   * which is precisely the "props are shaded by a different light"
   * complaint. Dropping metalness restores the diffuse term and the
   * tanks shade with everything else. The remaining true-metal uses in
   * the kit - railings, wire, rebar - are rusted iron, which is barely
   * metallic either.
   */
  const SURFACE_OVERRIDE = {
    metal: { metalness: 0.3, roughness: 0.72 },
  };

  /**
   * Roughness WINDOW per built surface, and the low-frequency breakup
   * layer. Both are injected into the structures clone below.
   *
   * ROUGHNESS. Measured across the map, blockwall sat at 0.65 and
   * concrete at 0.62. Three hundredths apart is nothing: two materials
   * at the same roughness and the same normal amplitude read as ONE
   * material whatever colour they are, and that is most of the
   * reviewer's "several panels are one swatch at varying values". The
   * generators do author a spread inside their own ORM - that part of
   * the complaint is already disproved by measurement - but every one of
   * those spreads was landing in the same window. What separates a sawn
   * sandstone face (weathers matte, only its mortar is matte-r) from a
   * steel-shuttered concrete skin (genuinely smooth, and only its
   * damage is rough) is not the width of the spread, it is where the
   * spread SITS. So the window is per material and the ORM's green
   * channel positions the surface inside it.
   *
   * `material.roughness` is set to the window midpoint below. It is not
   * read by the shader once the window is installed, and this file has
   * a standing rule against knobs that look tuned and are inert.
   *
   * MACRO. The tile is pinned at 1.54m now, so a 12m wall shows eight of
   * them. Per-block value jitter cannot hide that - it repeats WITH the
   * tile. What breaks the eye's lock is a field that varies over tens of
   * metres, which is exactly the map terrain.js already tiles at
   * hundreds of metres for the same reason. Reusing it costs no texture
   * memory at all: same 512x512 DataTexture, already synthesised,
   * already uploaded, one extra fetch. Only the R (tone) and B
   * (roughness) channels are read - the G channel is a warm/cool drift
   * and hue is another agent's this round.
   */
  const ROUGH_WINDOW = {
    blockwall: [0.74, 1.00],
    plaster: [0.58, 0.86],
    concrete: [0.46, 0.92],
    metal: [0.34, 0.78],
    corrugated: [0.38, 0.80],
    wood: [0.72, 1.00],
    sandbag: [0.86, 1.00],
    rubble: [0.80, 1.00],
    sand: [0.90, 1.00],
  };

  /**
   * Two octaves of macro breakup, in metres per repeat.
   *
   * One octave at 34m was the first attempt and it is the right band for
   * an establishing shot - it stops a row of buildings reading as one
   * value - but it is nearly constant across a single wall at 3-6m,
   * which is exactly the framing where the tile repeat gives itself
   * away. The second octave at 8m varies two or three times across one
   * panel, which is what a wall that has been patched, rained on and
   * leaned against actually looks like.
   *
   * Two fetches of a 512x512 map that is already resident, on the
   * fraction of the frame that is built surface. Cheaper than any of the
   * alternatives that involve new texture memory.
   */
  const MACRO_METRES = 34;
  const MACRO_DETAIL_METRES = 8;
  const MACRO_TONE = 0.15;
  const MACRO_DETAIL_TONE = 0.13;
  const MACRO_ROUGH = 0.16;

  /**
   * How far to pull a map toward its own luminance before the vertex
   * tint colours it. Zero for everything except painted steel.
   *
   * The metal generator ramps sound paint (0.300, 0.340, 0.310 - a sage
   * grey-green) through primer to rust (0.400, 0.185, 0.085 - a
   * saturated red-brown). Both are individually correct and the
   * progression through primer is the reason painted steel reads as
   * painted at all. But they are about 150 degrees apart in hue, and
   * the field that mixes them has 25cm features, so a fuel tank comes
   * out wearing a red-and-green DPM pattern. A blind reviewer called it
   * "garish red/green camouflage" and a later one called it camouflage
   * again after the tile scale had been corrected - which is the tell
   * that scale was never the fault. It is 25cm blotches of two
   * complementary hues; at any scale that is camouflage.
   *
   * A real storage tank is ONE painted value with rust staining running
   * off its seams. So the map keeps its value and roughness structure -
   * gloss paint at 0.26 against matte rust at 0.95 is the strongest
   * material cue on the object and is not touched - and gives up most
   * of its chroma to the per-tank tint. The rust stays warmer and
   * darker than the paint around it; it stops being a different colour.
   *
   * Deliberately not a fix to the generator: the same map dresses
   * railings, rebar and a burnt-out car, where a rusted rail reading
   * genuinely rust-coloured is something a reviewer has praised. The
   * change belongs to how STRUCTURES tint it, which is here.
   */
  const MAP_DESAT = {
    metal: 0.70,
    corrugated: 0.55,
  };

  function injectMacro(material, name) {
    const window = ROUGH_WINDOW[name];
    // No window: reproduce three's own `roughness * map.g` exactly by
    // making the window (0, roughness), so there is one code path.
    const lo = window ? window[0] : 0;
    const hi = window ? window[1] : material.roughness;
    if (window) material.roughness = (lo + hi) * 0.5;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMacro = { value: macroTexture };
      shader.uniforms.uMacroScale = {
        value: new THREE.Vector2(1 / MACRO_METRES, 1 / MACRO_DETAIL_METRES),
      };
      shader.uniforms.uMacroGain = { value: new THREE.Vector2(MACRO_TONE, MACRO_ROUGH) };
      shader.uniforms.uMacroDetail = { value: MACRO_DETAIL_TONE };
      shader.uniforms.uRoughWindow = { value: new THREE.Vector2(lo, hi) };
      shader.uniforms.uMapDesat = { value: MAP_DESAT[name] || 0 };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", [
          "#include <common>",
          "varying vec3 vMacroPos;",
          "varying vec3 vMacroNrm;",
        ].join("\n"))
        .replace("#include <worldpos_vertex>", [
          "#include <worldpos_vertex>",
          "vMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
          "vMacroNrm = normalize(mat3(modelMatrix) * objectNormal);",
        ].join("\n"));

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", [
          "#include <common>",
          "varying vec3 vMacroPos;",
          "varying vec3 vMacroNrm;",
          "uniform sampler2D uMacro;",
          "uniform vec2 uMacroScale;",
          "uniform vec2 uMacroGain;",
          "uniform float uMacroDetail;",
          "uniform vec2 uRoughWindow;",
          "uniform float uMapDesat;",
          // One projection, not three: the COORDINATES are blended
          // rather than the samples. At these scales a corner smears
          // over a couple of centimetres of a field whose finest
          // feature is metres wide and nothing reads it, whereas
          // tripling the fetch count on every structure pixel in the
          // town is a real cost.
          "vec2 bsMacroUv() {",
          "  vec3 n = abs(normalize(vMacroNrm));",
          "  vec3 w = n / max(n.x + n.y + n.z, 1e-4);",
          "  return vMacroPos.zy * w.x + vMacroPos.xz * w.y + vMacroPos.xy * w.z;",
          "}",
        ].join("\n"))
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "vec2 bsMuv = bsMacroUv();",
          "vec4 bsMacro = texture2D(uMacro, bsMuv * uMacroScale.x);",
          // The second octave is rotated as well as rescaled, so the
          // two do not correlate into one visible blob.
          "vec4 bsMacroFine = texture2D(uMacro,",
          "  (vec2(bsMuv.y, -bsMuv.x) + 31.7) * uMacroScale.y);",
          "diffuseColor.rgb *= 1.0",
          "  + (bsMacro.r * 2.0 - 1.0) * uMacroGain.x",
          "  + (bsMacroFine.r * 2.0 - 1.0) * uMacroDetail;",
          // Before <color_fragment>, so the vertex tint still gets to
          // colour what is left. See MAP_DESAT.
          "diffuseColor.rgb = mix(diffuseColor.rgb,",
          "  vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), uMapDesat);",
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", [
          "float roughnessFactor = uRoughWindow.y;",
          "#ifdef USE_ROUGHNESSMAP",
          "  roughnessFactor = mix(uRoughWindow.x, uRoughWindow.y,",
          "    texture2D( roughnessMap, vRoughnessMapUv ).g);",
          "#endif",
          "roughnessFactor = clamp(roughnessFactor",
          "  + (bsMacro.b * 2.0 - 1.0) * uMacroGain.y",
          "  + (bsMacroFine.b * 2.0 - 1.0) * uMacroGain.y * 0.6, 0.04, 1.0);",
        ].join("\n"));

      material.userData.shader = shader;
    };
    // Any change to onBeforeCompile needs its own program key, or three
    // hands back the cached plain program and the injection is a no-op.
    material.customProgramCacheKey = () => `bs-struct-${name}`;
  }

  /**
   * There is deliberately NO envMapIntensity compensation here.
   *
   * Structures were reported as needing the local sky-probe boost that
   * vehicles.js (2.6-3.4) and viewmodel.js (1.1-4.2) already carry,
   * because `scene.environmentIntensity` used to sit near 0.07 and
   * every shadow-side surface went to a hole. Two measurements against
   * the running build say otherwise, and both are worth recording
   * because the obvious fix is a no-op:
   *
   * 1. sky.js now normalises the probe - it reads 1.064 in daylight,
   *    not 0.07 - and structure surfaces measure healthily without any
   *    compensation. Sampling face normals against the sun vector and
   *    reading the actual framebuffer: citadel shadow sides 56, soffits
   *    70; street 95 and 135; alley 152 and 182. Nothing anywhere near
   *    the 0,0,0 the critic saw.
   *
   * 2. On three r180 `material.envMapIntensity` DOES NOTHING when the
   *    material has no `envMap` of its own and inherits the scene's.
   *    Driving it 0 -> 1 -> 4 across the whole town moved shadow-side
   *    luma 70.1 -> 70.4 -> 70.9, i.e. not at all. Assigning
   *    `material.envMap = scene.environment` and THEN setting 4 moved
   *    the same pixels to 101.8. The scene path is scaled by
   *    `scene.environmentIntensity` alone.
   *
   * So a number here would be a knob that looks tuned and is inert. If
   * the probe is ever starved again, the fix is to assign the envMap
   * reference as well as the intensity - or, better, to correct the
   * probe once in sky.js for everyone.
   */
  function materialFor(name) {
    if (name === "__contact") return contactMaterial;
    let material = ownMaterials.get(name);
    if (!material) {
      // Applied to the clone, not passed to build(): the library caches
      // on name+repeat only, so a build() with different physical
      // parameters can silently hand back somebody else's instance.
      material = materials.build(name, { repeat: 1 }).clone();
      Object.assign(material, SURFACE_OVERRIDE[name] || {});
      material.name = `bs-struct-${name}`;
      material.vertexColors = true;
      material.shadowSide = THREE.DoubleSide;
      injectMacro(material, name);
      ownMaterials.set(name, material);
    }
    return material;
  }

  async function finalise() {
    const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
    merged = [];

    /* ---- vertex tints are ABSOLUTE albedos, not multipliers ----
     *
     * Every per-piece tint in this file was authored as "what colour is
     * this concrete" - measured medians run 0.20-0.24 luma, which is
     * about right for concrete and mud brick. But they are applied by
     * multiplying the albedo MAP, and that map already carries its own
     * mid-grey level (concrete's mean is sRGB ~121, i.e. 0.19 linear).
     * The two multiply into 0.19 x 0.24 = 0.046, roughly a fifth of what
     * concrete reflects.
     *
     * That single factor is why a lighting investigation kept finding
     * walls at display luma 25 while ground in the same frame sat near
     * 100, and why several rounds of ambient tuning could not close it:
     * the surface was not badly lit, it was almost black to begin with.
     *
     * Dividing the tint by the map's own mean turns the map back into
     * what it should be - variation about its mean - and lets the tint
     * set the level it was written to set. Computed per material rather
     * than assumed, because each generator has its own mean. */
    const albedoScaleCache = new Map();
    function albedoScaleFor(material) {
      if (albedoScaleCache.has(material)) return albedoScaleCache.get(material);
      let scale = 1;
      const image = material && material.map && material.map.image;
      const data = image && image.data;
      if (data && data.length >= 4) {
        let sum = 0;
        let n = 0;
        // Every 37th texel: a mean does not need a million samples, and
        // a prime stride avoids locking onto the texture's own period.
        for (let i = 0; i < data.length; i += 4 * 37) {
          for (let c = 0; c < 3; c += 1) {
            const v = data[i + c] / 255;
            sum += v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            n += 1;
          }
        }
        const mean = n ? sum / n : 1;
        /* The upper clamp was 6, and it was defeating this function on
         * exactly the materials that need it most. Measured map means
         * and the scale each one asks for:
         *
         *   metal      0.0885 -> 11.30      rubble  0.1020 -> 9.80
         *   wood       0.1385 ->  7.22      sandbag 0.1399 -> 7.15
         *   corrugated 0.1484 ->  6.74      concrete 0.1891 -> 5.29
         *   dirt       0.2031 ->  4.92      blockwall 0.3045 -> 3.28
         *   plaster    0.3651 ->  2.74      sand    0.3748 -> 2.67
         *
         * FIVE of the ten were clamped, not one, and metal was losing
         * 47% of the albedo its tint asks for - which is most of why
         * `structures-metal` measured as the darkest merged mesh in the
         * frame (median luma 27 against terrain's 86) and why painted
         * steel keeps being reported as a black silhouette.
         *
         * The old comment's rationale is also backwards. "A dark map
         * must not be scaled back up" is precisely what this function
         * is for: the LEVEL is set by the vertex tint, and dividing by
         * the map's own mean is what makes the tint mean what it says.
         * A dark asphalt stays dark because its tint is dark, not
         * because the normalisation was throttled.
         *
         * The real guard the clamp provided is against a low-mean map
         * with bright highlights pushing map x scale x tint past 1, so
         * a cap is kept - at 12, which covers every generator in the
         * library with headroom. Verified after the change: no material
         * clips any texel (blacksand-timber-probe.mjs reports 0.0% for
         * all ten). */
        if (mean > 1e-4) scale = Math.min(12, Math.max(1, 1 / mean));
      }
      albedoScaleCache.set(material, scale);
      return scale;
    }

    /* ---- grime rises from the ground line, ONCE ----
     *
     * Every wall already carries a vertical vertex ramp, and `paint()`
     * normalises it over the PIECE's own bounding box. A three-storey
     * facade is built one storey at a time, so each storey got its own
     * full dark-to-light ramp and the elevation came out with a dark
     * band at every floor line - the exact opposite of what dirt does,
     * and a strong horizontal repeat on the one axis where repetition
     * is most visible. The reviewer read the result as "no dirt
     * gradient rising from the ground".
     *
     * Rebasing here rather than in `paint()` is deliberate: this runs
     * after the terrain is final, so the reference is the ground the
     * wall actually stands on rather than whatever the pad height was
     * when the piece was placed. It also reaches everything - compound
     * walls, plinths, barriers, crates - without threading a ground
     * level through ninety call sites.
     */
    const GRIME_RISE = 1.6;
    const GRIME_FLOOR = 0.78;
    // Terrain under a building is flattened, so a 1.5m lookup grid is
    // far finer than the signal and turns ~200k heightAt calls into a
    // few thousand.
    const groundCache = new Map();
    function groundAt(x, z) {
      const gx = Math.round(x / 1.5);
      const gz = Math.round(z / 1.5);
      const key = (gx + 1024) * 4096 + (gz + 1024);
      let value = groundCache.get(key);
      if (value === undefined) {
        value = terrain.heightAt(gx * 1.5, gz * 1.5);
        groundCache.set(key, value);
      }
      return value;
    }

    function applyGroundGrime(geometry) {
      const position = geometry.attributes.position;
      const colour = geometry.attributes.color;
      if (!position || !colour) return;
      for (let i = 0; i < position.count; i += 1) {
        const above = position.getY(i) - groundAt(position.getX(i), position.getZ(i));
        if (above >= GRIME_RISE) continue;
        const t = clamp(above / GRIME_RISE, 0, 1);
        // Smoothstep, so the top of the band does not leave a line of
        // its own where it meets clean wall.
        const f = GRIME_FLOOR + (1 - GRIME_FLOOR) * t * t * (3 - 2 * t);
        colour.setXYZ(i, colour.getX(i) * f, colour.getY(i) * f, colour.getZ(i) * f);
      }
      colour.needsUpdate = true;
    }

    // Terrain is final by the time finalise() runs, so the contact
    // blobs can be draped on the surface that actually exists.
    buildContactShadows();

    for (const bucket of buckets.values()) {
      const geometries = bucket.geometries;
      if (!geometries.length) continue;
      // Merging needs identical attribute sets. Pieces with a tint have
      // a colour attribute and pieces without do not, so fill the gap
      // with white rather than splitting into two draw calls.
      const decal = bucket.material === "__contact";
      for (const geometry of geometries) {
        if (!geometry.attributes.color) {
          const count = geometry.attributes.position.count;
          const white = new Float32Array(count * 3).fill(1);
          geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));
        }
        // uv2 for the AO map. Three expects it under `uv1` since r151.
        if (geometry.attributes.uv && !geometry.attributes.uv1) {
          geometry.setAttribute("uv1", geometry.attributes.uv.clone());
        }
      }

      const geometry = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      if (!geometry) continue;
      geometry.computeBoundingSphere();

      const bucketMaterial = materialFor(bucket.material);
      // The contact blobs are multiply-blended white and carry no map;
      // rescaling them would darken the ground they sit on.
      if (!decal && geometry.attributes.color) {
        const scale = albedoScaleFor(bucketMaterial);
        if (scale !== 1) {
          const colour = geometry.attributes.color;
          const array = colour.array;
          for (let i = 0; i < array.length; i += 1) array[i] *= scale;
          colour.needsUpdate = true;
        }
        // After the albedo rescale, so the grime is a fraction of the
        // level the surface actually ends up at.
        applyGroundGrime(geometry);
      }

      const object = new THREE.Mesh(geometry, bucketMaterial);
      object.name = decal ? "structures-contact" : `structures-${bucket.material}`;
      // Everything solid is both a caster and a receiver. The blobs are
      // neither: a caster blob would punch a hole in the sun shadow and
      // a receiver blob would be shaded twice.
      object.castShadow = !decal;
      object.receiveShadow = !decal;
      if (decal) {
        object.renderOrder = 2;
        // Keep the QA clearance raycast out of them - a 5cm-proud
        // decal in front of the camera is not "the camera is in a wall".
        object.userData.qaOpaque = false;
      }
      object.matrixAutoUpdate = false;
      object.updateMatrix();
      group.add(object);
      merged.push(object);

      if (PROBE && bucket.labels) {
        let cursor = 0;
        const ranges = bucket.labels.map((entry) => {
          const start = cursor;
          cursor += entry.tris;
          return { start, end: cursor, from: entry.from };
        });
        probeIndex.set(object, ranges);
      }
    }
    buckets.clear();
    ctx.physics.rebuildGrid();
  }

  /** Map a raycast hit on a merged mesh back to the code that placed
   *  the piece. Needs `?probe=1`; see PROBE above. */
  function identify(object, faceIndex) {
    const ranges = probeIndex.get(object);
    if (!ranges) return null;
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (faceIndex < ranges[mid].start) hi = mid - 1;
      else if (faceIndex >= ranges[mid].end) lo = mid + 1;
      else return ranges[mid].from;
    }
    return null;
  }

  /* ------------------------------- api ------------------------------- */

  return {
    group,
    buildings,
    canPlace,
    box,
    mesh,
    cylinder,
    wall,
    roof,
    stairs,
    stairFlight,
    building,
    sandbagWall,
    hesco,
    container,
    barrier,
    compoundWall,
    crate,
    crateStack,
    pallet,
    oilDrum,
    oilDrums,
    tyreStack,
    generator,
    pipeRun,
    fuelTank,
    wreckedCar,
    telegraphPole,
    wire,
    roadSign,
    chainFence,
    razorWire,
    marketStall,
    bazaarCanopy,
    guardTower,
    waterTank,
    rubblePile,
    rebar,
    laundryLine,
    contactShadow,
    /** Exported so map code placing its own geometry on open ground
     *  seats it the same way the kit does. Reimplementing it in the
     *  caller is how props end up floating on a dune. */
    seat,
    finalise,
    identify,

    /** Raycast the town through a normalised device coordinate and name
     *  the call site that placed whatever was hit. `?probe=1` only. */
    probe(ndcX = 0, ndcY = 0) {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, render.camera);
      raycaster.far = 4000;
      const targets = [];
      render.scene.traverse((o) => {
        // The sky dome is a unit sphere parented to the camera, so it
        // is the first thing every ray hits. Skip it and anything else
        // that does not write depth - decals, glows, the contact blobs.
        if (!o.isMesh || !o.visible) return;
        if (o.name === "sky-dome" || (o.material && o.material.depthWrite === false)) return;
        targets.push(o);
      });
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (!hit) return null;
      return {
        object: hit.object.name || hit.object.type,
        distance: Number(hit.distance.toFixed(2)),
        point: hit.point.toArray().map((v) => Number(v.toFixed(2))),
        // Face normal. Structure pieces are merged with their world
        // transform already baked into the vertices and the merged mesh
        // sits at the origin, so the local normal IS the world normal -
        // which is what lets a probe bin pixels by incidence angle
        // without threading a matrix out of here.
        normal: hit.face
          ? hit.face.normal.toArray().map((v) => Number(v.toFixed(3)))
          : null,
        ray: raycaster.ray.direction.toArray().map((v) => Number(v.toFixed(3))),
        from: identify(hit.object, hit.faceIndex),
      };
    },

    report() {
      return {
        buildings: buildings.length,
        pieces: pieceCount,
        colliders: colliderCount,
        meshes: merged ? merged.length : 0,
        // One blob per ground-standing object, and the count of props
        // `seat()` refused because the ground under them fell away
        // faster than the object could straddle. Set dressing density
        // is something a reviewer has already praised, so this number
        // is worth watching: it is the price of not floating.
        contactBlobs: contactBlobCount,
        contactMeshes: merged ? merged.filter((m) => m.name === "structures-contact").length : 0,
        unseated: unseatedCount,
        // Chamfering is the only thing in this file that buys silhouette
        // with triangles, so it states its own bill rather than leaving
        // it to be inferred from a frame counter that also moves with
        // the camera. 16 extra triangles a piece, gated by size.
        chamfered: chamferCount,
        chamferTriangles: chamferCount * 16,
        // One draw call per material per 176m cell, so this is what a
        // new wall material actually costs.
        meshesByMaterial: merged
          ? merged.reduce((acc, m) => {
            const key = m.name.replace("structures-", "");
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {})
          : {},
        triangles: merged
          ? merged.reduce((n, m) => n + m.geometry.index.count / 3, 0)
          : 0,
      };
    },

    dispose() {
      group.traverse((obj) => { if (obj.isMesh) obj.geometry.dispose(); });
      for (const material of ownMaterials.values()) material.dispose();
      contactMaterial.dispose();
      ownMaterials.clear();
      render.scene.remove(group);
    },
  };
}
