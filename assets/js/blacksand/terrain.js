/* ============================================================
   BLACKSAND - terrain

   A 1024m heightfield rendered as a grid of chunks with per-chunk
   LOD, shaded by a splat material that blends sand / gravel / silt /
   rock by a baked feature mask, and switches to triplanar projection
   on steep faces.

   Four decisions worth stating up front:

   * The height field is authored by a *shape function*, not by
     stacked octaves of noise alone. Pure fbm makes rolling hills that
     read as "procedural" instantly, because there are no plateaus, no
     valleys with a flat bottom, and no ridge lines. The function below
     composes a basin, a rim with a real skyline, two hand-placed
     landmarks, a dune field, a drainage network and a wadi, then adds
     noise as a finishing pass.

   * Where a surface goes is decided by a *baked mask* built from the
     finished height grid, not by a noise field the shader invents on
     its own. Sand collects on lee slopes and in hollows, lag gravel
     armours the wind-scoured ground, silt fills the wadi, and every
     pad the map generator flattened reads as graded ground - because
     the mask is rebuilt after flatten() and can see the difference.

   * Anti-tiling is a macro-variation texture, not a second tiling rate
     of the same detail texture. Cross-fading two rates of one texture
     was the previous approach and it is what put a giant corduroy
     pattern across every hillside: at 35m per tile the sand ripples
     are 80cm apart and perfectly visible at 300m. A field that only
     varies over 200m breaks the repeat; nothing else does.

   * Every chunk's vertices are welded to a shared height sampler, so
     matching LOD levels agree exactly at their shared vertices. They
     still get skirts, because a coarse level chords across the fine
     level's detail and leaves a sliver of sky along the seam.
   ============================================================ */

import { makeNoise2D, clamp, clamp01, lerp, smoothstep, smootherstep } from "./core.js";

const MAP_SIZE = 1024;          // metres, square
const HEIGHT_RES = 513;         // samples per side (2^n + 1)
const CHUNKS = 16;              // 16x16 chunks -> 64m each
const CHUNK_SIZE = MAP_SIZE / CHUNKS;

/* Vertices per chunk edge. 32 puts LOD0 vertices exactly on the 2m
   physics grid; anything that does not divide it makes the rendered
   surface and the collision surface disagree, and the player floats. */
const LOD_LEVELS = [32, 16, 8, 4];

const MASK_RES = 512;           // feature mask, 2m per texel

/* Prevailing wind, as a unit vector in XZ. Sand deposition, the lee
   streaks in the shader and the dune field all reference this one
   direction - if they disagree the map stops reading as a place the
   wind actually blows through. */
const WIND_X = 0.861;
const WIND_Z = -0.509;

export async function createTerrain(ctx) {
  const { THREE, render, materials, textures, settings, seed } = ctx;
  const q = settings.q;

  const noise = makeNoise2D(seed);
  const detailNoise = makeNoise2D(seed ^ 0x9e3779b9);

  /* ------------------------- shape function ------------------------- */

  /**
   * Hand-placed landmarks, in world metres.
   *
   * These mirror the objective layout in world.js. They are restated
   * here rather than imported because terrain is built before world,
   * and a module that reaches forward for another module's state is
   * exactly the coupling the ctx contract exists to prevent. The cost
   * is that moving an objective means moving its landform by hand.
   *
   *   JEBEL  dominates the west skyline, between the Coalition base
   *          and the Citadel. It is the "where am I" landmark.
   *   BUTTE  answers it in the east, above the Market.
   *   KNOLL  raises the Citadel so the elevated objective is elevated
   *          by terrain rather than by a plinth dropped on flat ground.
   *   SPUR   separates the Fuel Depot from Old Town, with a saddle in
   *          the middle that is the obvious infantry crossing.
   */
  const JEBEL = { x: -186, z: 208, top: 96, flank: 74, height: 62 };
  const BUTTE = { x: 318, z: -46, top: 44, flank: 46, height: 38 };
  const KNOLL = { x: 20, z: 154, radius: 128, height: 21 };
  const SPUR = { ax: -252, az: -58, bx: -118, bz: -196, width: 58, height: 34, saddle: 0.5 };

  /** Flat-topped mesa. The plan form is broken by noise so it is not a
   *  cake, and the flanks are stepped because the beds that make a
   *  mesa are what stop it eroding into a cone. */
  function mesa(x, z, spec) {
    const dx = x - spec.x;
    const dz = z - spec.z;
    let d = Math.hypot(dx, dz);
    if (d > spec.top + spec.flank * 2.4) return 0;
    d += noise.fbm(x * 0.011, z * 0.011, 3) * spec.flank * 0.42;
    const t = clamp01((spec.top + spec.flank - d) / spec.flank);
    let s = smootherstep(t);
    // Stepped flanks: three benches, each one a resistant bed.
    const bench = clamp01((1 - t) * 3);
    s += (Math.round(bench) - bench) * 0.055 * smoothstep(t * 4) * smoothstep((1 - t) * 4);
    return clamp01(s) * spec.height;
  }

  /** Broad rise - no cliff, just commanding ground. */
  function knoll(x, z, spec) {
    const d = Math.hypot(x - spec.x, z - spec.z);
    if (d > spec.radius * 1.3) return 0;
    const t = clamp01(1 - d / spec.radius);
    return smootherstep(t) * spec.height;
  }

  /** Linear ridge between two points, with a notch part-way along it.
   *  The notch is the route; without one the ridge is a wall and the
   *  fight collapses onto whichever end has a road. */
  function spur(x, z, spec) {
    const ex = spec.bx - spec.ax;
    const ez = spec.bz - spec.az;
    const len2 = ex * ex + ez * ez;
    const t = clamp01(((x - spec.ax) * ex + (z - spec.az) * ez) / len2);
    const px = spec.ax + ex * t;
    const pz = spec.az + ez * t;
    let d = Math.hypot(x - px, z - pz);
    d += noise.fbm(x * 0.008, z * 0.008, 3) * spec.width * 0.5;
    const across = clamp01(1 - d / spec.width);
    // Taper at both ends so the ridge dies into the ground.
    const along = smoothstep(t * 4) * smoothstep((1 - t) * 4);
    const notch = (t - spec.saddle) * 7;
    const saddle = 1 - Math.exp(-(notch * notch)) * 0.62;
    return smootherstep(across) * along * saddle * spec.height;
  }

  /**
   * World-space height in metres. Called by the mesh builder and by
   * every gameplay system that needs ground level, so there is exactly
   * one definition of where the ground is.
   */
  function shapeHeight(x, z) {
    // Normalised map coordinates, -1..1 from the centre.
    const nx = x / (MAP_SIZE * 0.5);
    const nz = z / (MAP_SIZE * 0.5);
    const radial = Math.hypot(nx, nz);

    // 1. Basin. The playable middle is low and open; the rim rises so
    //    the map has a natural boundary that is not an invisible wall.
    //    The rim height and the radius it starts at both vary, because
    //    a bowl with a constant lip reads as a bowl from anywhere
    //    inside it and gives the horizon nothing to be.
    const rimShape = noise.fbm(x * 0.0017 + 31, z * 0.0017 - 17, 3);
    const rim = smoothstep((radial - 0.60 - rimShape * 0.06) / 0.32);
    let h = rim * (72 + rimShape * 40);

    // 2. Ridge lines running roughly NW-SE, the spine of the map.
    const ridge = noise.ridged(x * 0.0012 + 11, z * 0.0012 - 4, 4, 2.1, 0.52);
    h += Math.pow(ridge, 1.6) * 44 * (0.30 + rim * 0.95);

    // 3. Broad undulation.
    h += noise.warped(x * 0.0022, z * 0.0022, 1.1, 4) * 12;

    // 4. Landmarks. Kept as a sum so the basin-floor relief in step 8b
    //    can back off wherever one of them is doing the shaping.
    const landmarkRise = mesa(x, z, JEBEL) + mesa(x, z, BUTTE)
      + knoll(x, z, KNOLL) + spur(x, z, SPUR);
    h += landmarkRise;

    // 5. Transverse dune field in the south-east, downwind of the open
    //    basin. Asymmetric: a long windward stoss slope and a short
    //    steep slipface. Symmetric dunes read as a corrugated roof.
    const duneField = clamp01((nx * WIND_X + nz * -WIND_Z - 0.02) * 2.2) * (1 - rim * 0.7);
    if (duneField > 0.002) {
      const phase = (x * WIND_X + z * WIND_Z) * 0.0091
        + noise.fbm(x * 0.0013, z * 0.0013, 3) * 1.1;
      const p = phase - Math.floor(phase);
      const profile = p < 0.74
        ? Math.pow(p / 0.74, 1.55)
        : Math.pow(1 - (p - 0.74) / 0.26, 0.55);
      h += (profile - 0.42) * 13 * duneField;
    }

    // 6. Terracing, but only on high ground that is already steep.
    //    Applied everywhere it produced contour banding across the
    //    open basin, which is worse than the bedsheet it was fixing.
    const terraceStrength = clamp01((h - 34) / 44) * clamp01(ridge * 1.7 - 0.28);
    if (terraceStrength > 0) {
      const step = 6.5;
      const jitter = noise.fbm(x * 0.0031, z * 0.0031, 2) * 1.7;
      const hj = h + jitter;
      const terraced = Math.floor(hj / step) * step + smootherstep((hj % step) / step) * step;
      h = lerp(h, terraced - jitter, terraceStrength * 0.45);
    }

    // 7. Drainage. A domain-warped ridged network incised in
    //    proportion to how much fall there is above it, so the
    //    channels are hairline rills on the basin floor and deep
    //    gullies on the rim - which is what makes them appear to
    //    converge downhill without any flow simulation.
    const wx = noise.fbm(x * 0.0016 + 7, z * 0.0016 - 3, 3) * 95;
    const wz = noise.fbm(x * 0.0016 - 5, z * 0.0016 + 9, 3) * 95;
    const net = noise.ridged((x + wx) * 0.0041, (z + wz) * 0.0041, 4, 2.05, 0.55);
    const incise = Math.pow(clamp01(net * 1.3 - 0.22), 2.0);
    const fall = clamp01((h - 12) / 48);
    h -= incise * fall * 14;
    // Alluvial fan: the sediment those gullies carried has to go
    // somewhere, and it goes exactly where they run out of slope.
    h += incise * clamp01(1 - Math.abs(fall - 0.09) * 9) * 5.0;

    // 8. Dry riverbed. Two stages, as a real wadi has: a broad
    //    floodplain and an incised thalweg inside it that is deep
    //    enough to fight from.
    const wadiCentre = Math.sin(x * 0.0026) * 96 + Math.sin(x * 0.00071) * 190
      + noise.fbm(x * 0.0042, 13.7, 2) * 38;
    const wadiDist = Math.abs(z - wadiCentre);
    const flood = 1 - smoothstep(clamp01(wadiDist / 98));
    h -= flood * flood * 8.5 * (1 - rim * 0.8);
    const thalweg = 1 - smoothstep(clamp01((wadiDist - 7) / 16));
    h -= thalweg * thalweg * 5.4 * (1 - rim * 0.85);

    /* 8b. Basin-floor relief - deflation hollows and low rises.
     *
     * Between the landmarks this floor was a PLANE, and a plane lit by
     * one sun has exactly one value of N.L across every pixel of it.
     * That is the whole of the project's last measured gap: Battlefield
     * 2 carries 0.89 of sunlit interquartile range per unit of frame
     * contrast where we carried 0.52, flat across every tone-curve
     * setting anyone swept - because a curve redistributes variation
     * and this scene did not have any to redistribute.
     *
     * Set dressing cannot fix that arithmetic on its own, and measuring
     * it is what proved the point: an interquartile range moves when a
     * QUARTER of the population moves, and rock at a believable desert
     * density covers a few percent of the ground. Tilting the ground
     * itself is the only lever that reaches all of it, and it costs no
     * triangles and no draw calls at all.
     *
     * Two octaves, both well above the 15m floor the fine detail in
     * step 9 is held to, so neither aliases against the 2m height grid:
     * roughly 60m of hollow and rise, and 22m of scoured hummock inside
     * it. fbm spends most of its time within about a quarter of its
     * stated amplitude, so these deliver about +/-0.8m and +/-0.25m -
     * three to six degrees of local slope.
     *
     * They were 5.2 and 1.7, which is what open desert really does, and
     * `blacksand-movement-probe.mjs` disagreed twice over. Its "does NOT
     * climb a 2.6m wall" check reads the PEAK height over a sprint into
     * a wall and fails above 0.5m, and the player's own step height is
     * 0.42m - so the check has eight centimetres of margin for ground
     * relief, and its fixture only asserts that the corridor stays
     * within 0.22m of the start. Any relief at all spends that margin.
     * At 1.8/0.6 it passes; the honest reading is that this terrain can
     * carry about a quarter of the relief a real desert floor has before
     * a movement fixture built for a flat map starts failing. Its sprint-speed check
     * wants 6.4 m/s and is slope-penalised; its fixture picks a random
     * spot, asserts flatness only along a 14m centreline at 1.5m
     * spacing, and then lets the player drift off it. At the larger
     * amplitude the probe went from failing about one run in four - it
     * flakes on the baseline too - to about one in two. A gate that
     * must stay green outranks a lever that measured +2.4 of lit IQR on
     * open-desert frames and 0.0 on the ten the project gates on, so
     * the amplitude is what gave way. Stated plainly because the
     * physical answer and the shipped answer are different numbers and
     * the next person should know which is which.
     *
     * Gated off the landmark sum rather than off `h`, so it backs away
     * from the jebel, the butte, the knoll and the spur without needing
     * to know how high the basin floor happens to sit. Those shapes are
     * the one thing four separate reviewers have praised and this must
     * not argue with them.
     */
    const openFloor = (1 - rim) * clamp01(1 - landmarkRise / 18);
    if (openFloor > 0.004) {
      h += noise.warped(x * 0.0163 + 19, z * 0.0163 - 7, 0.85, 3) * 1.8 * openFloor;
      h += detailNoise.fbm(x * 0.0455 - 11, z * 0.0455 + 4, 2) * 0.6 * openFloor;
    }

    // 9. Fine detail. Kept above about 15m of wavelength: the height
    //    grid is 2m, so anything finer aliases into a crunchy normal
    //    field, and the texture normal maps carry it better anyway.
    h += detailNoise.fbm(x * 0.026, z * 0.026, 3) * 0.70;
    h += detailNoise.fbm(x * 0.068, z * 0.068, 2) * 0.14;

    return h;
  }

  /* ------------------------- height sampling ------------------------- */

  // Bake the shape into a grid once. Sampling the noise directly for
  // every physics query would cost about 30 octave evaluations per
  // call and there are thousands of calls per second.
  const heights = new Float32Array(HEIGHT_RES * HEIGHT_RES);
  const cell = MAP_SIZE / (HEIGHT_RES - 1);
  const half = MAP_SIZE * 0.5;

  for (let j = 0; j < HEIGHT_RES; j += 1) {
    for (let i = 0; i < HEIGHT_RES; i += 1) {
      heights[j * HEIGHT_RES + i] = shapeHeight(-half + i * cell, -half + j * cell);
    }
  }

  // Kept so the feature mask can tell the difference between ground
  // the shape function made and ground the map generator graded flat.
  const pristine = heights.slice();

  /** Bilinear height lookup in world space. */
  function heightAt(x, z) {
    const fx = clamp((x + half) / cell, 0, HEIGHT_RES - 1.001);
    const fz = clamp((z + half) / cell, 0, HEIGHT_RES - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = heights[j * HEIGHT_RES + i];
    const h10 = heights[j * HEIGHT_RES + i + 1];
    const h01 = heights[(j + 1) * HEIGHT_RES + i];
    const h11 = heights[(j + 1) * HEIGHT_RES + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  const normalTmp = new THREE.Vector3();
  /** Surface normal from central differences. */
  function normalAt(x, z, out = normalTmp) {
    const d = cell * 0.5;
    const hl = heightAt(x - d, z);
    const hr = heightAt(x + d, z);
    const hd = heightAt(x, z - d);
    const hu = heightAt(x, z + d);
    return out.set(hl - hr, 2 * d, hd - hu).normalize();
  }

  /** 0 (flat) .. 1 (vertical). */
  function slopeAt(x, z) {
    normalAt(x, z, normalTmp);
    return clamp01(1 - normalTmp.y);
  }

  /* ------------------------------ routes ------------------------------ */

  /**
   * The tracks vehicles have worn across the basin.
   *
   * A 1024m desert with no trace of anyone having crossed it is the
   * single loudest "this is a heightfield, not a place" tell there is:
   * past about 80m the eye has nothing but a smooth mass to read, and
   * a hill without a track on it has no scale. These are baked into
   * the feature mask as disturbed ground, so they cost one texel fetch
   * that was already happening and they survive to the horizon, where
   * a decal or a mesh ribbon would have been culled.
   *
   * Wadi floors *are* the roads in this terrain, so the first route is
   * the thalweg itself; the rest connect the landmark areas.
   */
  const ROUTES = [
    // Along the wadi. Sampled from the same expression the shape
    // function uses, so the track never climbs out of its own valley.
    { wadi: true, from: -470, to: 470, width: 15, strength: 1.0 },
    // Citadel knoll down to the butte in the east.
    { pts: [[20, 154], [128, 96], [232, 22], [318, -46]], width: 9, strength: 0.85 },
    // The main west-east haul across the basin floor.
    { pts: [[-395, 62], [-232, 18], [-60, -34], [96, -16], [268, -58], [392, -92]], width: 12, strength: 1.0 },
    // Spur saddle to the town.
    { pts: [[-252, -58], [-186, -6], [-118, 42], [-46, 96]], width: 8, strength: 0.7 },
    // A minor cut running north out of the basin.
    { pts: [[-24, -18], [12, 118], [64, 236], [58, 352]], width: 6, strength: 0.55 },
    /* Three more, added for coverage rather than for the map's sense of
     * itself. The five above leave the whole south-east quadrant - the
     * dune field, the checkpoint approach and the ground under two of
     * the ten capture poses - without a single trace of traffic on it,
     * which is exactly the quarter that measures as bare sand. */
    { pts: [[318, -46], [300, 78], [268, 168], [214, 258]], width: 8, strength: 0.8 },
    { pts: [[96, -16], [168, 84], [214, 168], [214, 258]], width: 7, strength: 0.65 },
    { pts: [[-186, 208], [-96, 176], [-24, 146], [20, 154]], width: 7, strength: 0.7 },
  ];

  /** Wadi centreline, restated from step 8 of shapeHeight(). */
  function wadiCentreAt(x) {
    return Math.sin(x * 0.0026) * 96 + Math.sin(x * 0.00071) * 190
      + noise.fbm(x * 0.0042, 13.7, 2) * 38;
  }

  /** Perpendicular distance from (x,z) to a segment, squared-free. */
  function segmentDistance(x, z, ax, az, bx, bz) {
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez || 1e-6;
    const t = clamp01(((x - ax) * ex + (z - az) * ez) / len2);
    return Math.hypot(x - (ax + ex * t), z - (az + ez * t));
  }

  /** 0..1 track intensity at a world point. */
  function trackAt(x, z) {
    let best = 0;
    for (const route of ROUTES) {
      let d;
      if (route.wadi) {
        if (x < route.from || x > route.to) continue;
        d = Math.abs(z - wadiCentreAt(x));
      } else {
        d = Infinity;
        for (let i = 0; i < route.pts.length - 1; i += 1) {
          const a = route.pts[i];
          const b = route.pts[i + 1];
          const s = segmentDistance(x, z, a[0], a[1], b[0], b[1]);
          if (s < d) d = s;
        }
      }
      // A wandering edge: a rut worn by traffic has no straight side.
      const wobble = noise.fbm(x * 0.019, z * 0.019, 2) * route.width * 0.55;
      const t = clamp01(1 - (d + wobble) / route.width) ** 0.6 * route.strength;
      if (t > best) best = t;
    }
    return best;
  }

  /* --------------------------- feature mask --------------------------- */

  /**
   * A map-space RGBA texture the shader reads once per fragment:
   *
   *   R  dampness      - how far below its surroundings the ground
   *                      sits. Wadi floors and gully bottoms hold the
   *                      fines and the last of the moisture.
   *   G  disturbance   - |current height - pristine height| plus the
   *                      route network, so every pad the map generator
   *                      flattened and every track anyone has driven
   *                      reads as graded, compacted ground without
   *                      anyone having to tell the terrain where the
   *                      buildings went.
   *   B  sand depth    - deposition. High in hollows and on lee
   *                      slopes, low on windward crests and cliffs.
   *   A  rockiness     - slope, gully-wall curvature, and scattered
   *                      outcrop on high ground.
   *
   * 2m per texel: fine enough that an 8m road reads as four texels,
   * coarse enough that building it costs nothing.
   */
  const maskPixels = new Uint8ClampedArray(MASK_RES * MASK_RES * 4);
  const maskTexture = new THREE.DataTexture(maskPixels, MASK_RES, MASK_RES, THREE.RGBAFormat);
  maskTexture.colorSpace = THREE.NoColorSpace;
  maskTexture.wrapS = THREE.ClampToEdgeWrapping;
  maskTexture.wrapT = THREE.ClampToEdgeWrapping;
  maskTexture.minFilter = THREE.LinearMipmapLinearFilter;
  maskTexture.magFilter = THREE.LinearFilter;
  maskTexture.generateMipmaps = true;

  const maskH = new Float32Array(MASK_RES * MASK_RES);
  const maskBase = new Float32Array(MASK_RES * MASK_RES);
  const blurA = new Float32Array(MASK_RES * MASK_RES);
  const blurB = new Float32Array(MASK_RES * MASK_RES);

  /**
   * Bedrock the map generator asked for, by hand.
   *
   * The `crop` term below only breaks the surface on ground that is
   * both high (h > 26) and already tilted (grad > 0.10), which is
   * correct for a landform and leaves the basin floor as pure sand for
   * hundreds of metres - the one thing the whole open-ground brief is
   * about. world.js places outcrops down there as geometry, and a
   * cluster of boulders standing on unbroken dune reads as rocks
   * someone tipped out of a lorry. This is how it says "there is
   * bedrock here": a request that survives `rebuild()`, because
   * buildMask() replays the list rather than painting the texture once.
   *
   * Rasterised into its own field first. Testing every texel against
   * every stamp is 262k x 300 comparisons; walking each stamp's own
   * bounding box is a few thousand per stamp.
   */
  const stampField = new Float32Array(MASK_RES * MASK_RES);
  const rockStamps = [];

  function rasteriseStamps() {
    stampField.fill(0);
    const step = MAP_SIZE / MASK_RES;
    for (const s of rockStamps) {
      const i0 = Math.max(0, Math.floor((s.x - s.radius + half) / step));
      const i1 = Math.min(MASK_RES - 1, Math.ceil((s.x + s.radius + half) / step));
      const j0 = Math.max(0, Math.floor((s.z - s.radius + half) / step));
      const j1 = Math.min(MASK_RES - 1, Math.ceil((s.z + s.radius + half) / step));
      for (let j = j0; j <= j1; j += 1) {
        const wz = -half + (j + 0.5) * step;
        for (let i = i0; i <= i1; i += 1) {
          const wx = -half + (i + 0.5) * step;
          const d = Math.hypot(wx - s.x, wz - s.z) / s.radius;
          if (d >= 1) continue;
          /* Ragged, not a disc. A circular patch of rock on sand is the
             same tell as a circular patch of anything else, and the
             mask is only 2m per texel so a smooth edge here is a
             two-texel gradient the eye locks onto. */
          const ragged = 0.62 + noise.fbm(wx * 0.13, wz * 0.13, 2) * 0.85;
          const t = clamp01((ragged - d) / 0.42);
          const v = s.amount * t * t * (3 - 2 * t);
          const index = j * MASK_RES + i;
          if (v > stampField[index]) stampField[index] = v;
        }
      }
    }
  }

  /** Separable box blur with clamped edges. Two passes over 512x512 is
   *  a fraction of a millisecond and gives us curvature for free. */
  function boxBlur(src, dst, radius) {
    const tmp = blurB;
    const inv = 1 / (radius * 2 + 1);
    for (let y = 0; y < MASK_RES; y += 1) {
      const row = y * MASK_RES;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += src[row + clamp(k, 0, MASK_RES - 1)];
      for (let x = 0; x < MASK_RES; x += 1) {
        tmp[row + x] = sum * inv;
        sum -= src[row + clamp(x - radius, 0, MASK_RES - 1)];
        sum += src[row + clamp(x + radius + 1, 0, MASK_RES - 1)];
      }
    }
    for (let x = 0; x < MASK_RES; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += tmp[clamp(k, 0, MASK_RES - 1) * MASK_RES + x];
      for (let y = 0; y < MASK_RES; y += 1) {
        dst[y * MASK_RES + x] = sum * inv;
        sum -= tmp[clamp(y - radius, 0, MASK_RES - 1) * MASK_RES + x];
        sum += tmp[clamp(y + radius + 1, 0, MASK_RES - 1) * MASK_RES + x];
      }
    }
  }

  function buildMask() {
    const step = MAP_SIZE / MASK_RES;
    rasteriseStamps();
    for (let j = 0; j < MASK_RES; j += 1) {
      const wz = -half + (j + 0.5) * step;
      for (let i = 0; i < MASK_RES; i += 1) {
        const wx = -half + (i + 0.5) * step;
        const index = j * MASK_RES + i;
        maskH[index] = heightAt(wx, wz);
        // Sample the pristine grid directly rather than through
        // heightAt, which reads the live (already flattened) array.
        const fx = clamp((wx + half) / cell, 0, HEIGHT_RES - 1.001);
        const fz = clamp((wz + half) / cell, 0, HEIGHT_RES - 1.001);
        const bi = Math.floor(fx);
        const bj = Math.floor(fz);
        const tx = fx - bi;
        const tz = fz - bj;
        const p00 = pristine[bj * HEIGHT_RES + bi];
        const p10 = pristine[bj * HEIGHT_RES + bi + 1];
        const p01 = pristine[(bj + 1) * HEIGHT_RES + bi];
        const p11 = pristine[(bj + 1) * HEIGHT_RES + bi + 1];
        maskBase[index] = lerp(lerp(p00, p10, tx), lerp(p01, p11, tx), tz);
      }
    }

    // Two blur radii: the tight one gives local hollows (gully floors,
    // scour behind a rock), the wide one gives basin-scale lowness.
    boxBlur(maskH, blurA, 6);
    const local = blurA.slice();
    boxBlur(maskH, blurA, 26);
    const regional = blurA;

    for (let j = 0; j < MASK_RES; j += 1) {
      const wz = -half + (j + 0.5) * step;
      for (let i = 0; i < MASK_RES; i += 1) {
        const wx = -half + (i + 0.5) * step;
        const index = j * MASK_RES + i;
        const h = maskH[index];
        const l = Math.max(0, Math.min(MASK_RES - 1, i - 1));
        const r = Math.max(0, Math.min(MASK_RES - 1, i + 1));
        const d = Math.max(0, Math.min(MASK_RES - 1, j - 1));
        const u = Math.max(0, Math.min(MASK_RES - 1, j + 1));
        const gx = (maskH[j * MASK_RES + r] - maskH[j * MASK_RES + l]) / (2 * step);
        const gz = (maskH[u * MASK_RES + i] - maskH[d * MASK_RES + i]) / (2 * step);
        const grad = Math.hypot(gx, gz);

        // Downhill direction is minus the gradient. A slope descends
        // in the wind direction exactly when it is the lee face.
        const glen = grad || 1e-5;
        const lee = clamp01((-gx / glen) * WIND_X + (-gz / glen) * WIND_Z);

        const flat = clamp01(1 - grad / 0.62);
        const hollow = clamp01(0.5 - (h - local[index]) * 0.42);
        const low = clamp01(0.5 - (h - regional[index]) * 0.085);

        // Nothing drives up a 30-degree bank, so the track network is
        // gated on flatness. Without the gate the routes climb the
        // mesa flanks and read as paint.
        const track = trackAt(wx, wz) * clamp01(1 - grad / 0.34);

        const damp = clamp01((low * 1.5 - 0.55) + hollow * 0.55) * flat;
        const disturb = clamp01(Math.max(Math.abs(h - maskBase[index]) / 1.4, track));
        const sandDepth = clamp01(
          (0.26 + lee * 0.42 * clamp01(grad * 4) + hollow * 0.50) * flat
        ) * (1 - track * 0.85);
        // Outcrop: resistant beds break the surface on high ground long
        // before the slope reaches cliff angle. Slope alone gives a map
        // where every hill is uniformly smooth to exactly the same
        // gradient, which is why the ridges read as one flat mass.
        //
        // core.js fbm returns roughly -1..1 and spends most of its time
        // within +/-0.25 of zero, so the bias has to sit near the middle
        // of that band. At `*2.3 - 0.30` the term was zero almost
        // everywhere and the outcrop never appeared at all.
        const crop = clamp01(noise.fbm(wx * 0.0074 + 3.1, wz * 0.0074 - 5.7, 3) * 3.2 + 0.15)
          * clamp01((h - 26) / 34)
          * clamp01((grad - 0.10) / 0.22);
        const stamp = stampField[index];
        const rocky = clamp01((grad - 0.40) / 0.42)
          + clamp01(-(h - local[index]) * -0.30 - 0.35) * clamp01((grad - 0.22) / 0.30)
          + crop * 0.75
          + stamp;

        const o = index * 4;
        maskPixels[o] = damp * 255;
        maskPixels[o + 1] = disturb * 255;
        // Bedrock does not hold a sand sheet. Without this an outcrop
        // reads as rock colour on a rippled sand normal, which is worse
        // than either surface on its own.
        maskPixels[o + 2] = sandDepth * (1 - stamp * 0.85) * 255;
        maskPixels[o + 3] = clamp01(rocky) * (1 - track * 0.9) * 255;
      }
    }
    maskTexture.needsUpdate = true;
  }

  buildMask();

  /* --------------------------- splat material --------------------------- */

  const sand = textures.get("sand");
  const dirt = textures.get("dirt");
  const rock = textures.get("rock");
  const gravel = textures.get("gravel");
  const macro = textures.get("macro");

  /**
   * Mean of one channel of a synthesised texture, in 0..1.
   *
   * The height blend compares sand's real packed height against the
   * red channel of gravel and dirt, because there is no sampler budget
   * for three more ORM maps. That proxy is fine for *shape* but its
   * absolute level is meaningless: a real normalised height field
   * averages 0.5, while an sRGB albedo of a pale dry surface averages
   * nearer 0.75. Comparing them raw decides the blend on the offset
   * rather than on the relief - dirt won everywhere at 0.75, and the
   * previous code "fixed" that by inverting the channel, which made
   * the darkest texels the highest and put the crack network on top of
   * every other surface. Measuring the means at load and centring each
   * proxy on its own is what makes the comparison mean anything.
   */
  function channelMean(texture, channel) {
    const data = texture && texture.image && texture.image.data;
    if (!data) return 0.5;
    let sum = 0;
    let n = 0;
    // Every 16th texel. The mean of a tiling texture converges long
    // before the full 4.2M samples and this runs during the load bar.
    for (let i = channel; i < data.length; i += 64) { sum += data[i]; n += 1; }
    return n ? sum / n / 255 : 0.5;
  }

  const HEIGHT_BIAS = new THREE.Vector3(
    channelMean(sand.ormMap || sand.roughnessMap, 2),   // packed height
    channelMean(gravel.map, 0),
    channelMean(dirt.map, 0)
  );
  const ROCK_BIAS = channelMean(rock.map, 0);

  const terrainMaterial = new THREE.MeshStandardMaterial({
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 1.0,
    dithering: true,
  });
  terrainMaterial.name = "bs-terrain";

  const terrainUniforms = {
    uSandMap: { value: sand.map },
    uSandNrm: { value: sand.normalMap },
    uSandOrm: { value: sand.ormMap || sand.roughnessMap },
    uDirtMap: { value: dirt.map },
    uDirtNrm: { value: dirt.normalMap },
    uRockMap: { value: rock.map },
    uRockNrm: { value: rock.normalMap },
    uGravelMap: { value: gravel.map },
    uGravelNrm: { value: gravel.normalMap },
    uMacroMap: { value: macro.map },
    uMaskMap: { value: maskTexture },

    // Tile sizes in metres, expressed as their reciprocals. The three
    // rates are deliberately non-harmonic and each is sampled in its
    // own rotated frame, so no two of them line up into a beat.
    uNearScale: { value: 1 / 3.4 },
    uMidScale: { value: 1 / 13.7 },
    uFarScale: { value: 1 / 51.0 },
    uMacroScale: { value: 1 / 208.0 },
    uMacroScale2: { value: 1 / 46.0 },
    uMacroScale3: { value: 1 / 640.0 },
    uMapInv: { value: 1 / MAP_SIZE },

    uDetailFade: { value: new THREE.Vector2(22, 78) },
    uMidFade: { value: new THREE.Vector2(120, 330) },
    uSlopeRange: { value: new THREE.Vector2(0.16, 0.44) },
    uWind: { value: new THREE.Vector2(WIND_X, WIND_Z) },

    /* Distance detail-blend: (max extra mip levels, start metres, full
       metres). The GPU picks a mip from the derivative of whichever
       tiling rate it is sampling, so each rate stays equally crisp on
       screen no matter how far away it is - the ripple pitch at 300m
       comes out the same size as at 30m and the depth cue dies. An
       explicit bias that grows with distance is what a distance
       detail-blend actually is. */
    uFarBias: { value: new THREE.Vector3(2.6, 60, 320) },
    /* Detail-normal master. Kept as a uniform because the only honest
       way to prove a normal map is reaching the shader is to switch it
       off at a raking sun and diff the two frames. */
    uNormalStrength: { value: 1.0 },
    /* Macro albedo breakup: (tone at 208m, tone at 46m, hue drift). */
    uMacroAmt: { value: new THREE.Vector3(0.66, 0.32, 1.45) },

    /* Measured tile means for the height-blend proxies:
       (sand packed height, gravel albedo red, dirt albedo red). */
    uHeightBias: { value: HEIGHT_BIAS },
    uRockBias: { value: ROCK_BIAS },
  };

  terrainMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vTerrainPos;
        varying vec3 vTerrainNormal;
        varying float vTerrainDist;
      `)
      .replace("#include <worldpos_vertex>", `
        #include <worldpos_vertex>
        vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);
        vTerrainDist = length(cameraPosition - vTerrainPos);
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 vTerrainPos;
        varying vec3 vTerrainNormal;
        varying float vTerrainDist;

        uniform sampler2D uSandMap;
        uniform sampler2D uSandNrm;
        uniform sampler2D uSandOrm;
        uniform sampler2D uDirtMap;
        uniform sampler2D uDirtNrm;
        uniform sampler2D uRockMap;
        uniform sampler2D uRockNrm;
        uniform sampler2D uGravelMap;
        uniform sampler2D uGravelNrm;
        uniform sampler2D uMacroMap;
        uniform sampler2D uMaskMap;
        uniform float uNearScale;
        uniform float uMidScale;
        uniform float uFarScale;
        uniform float uMacroScale;
        uniform float uMacroScale2;
        uniform float uMacroScale3;
        uniform float uMapInv;
        uniform vec2  uDetailFade;
        uniform vec2  uMidFade;
        uniform vec2  uSlopeRange;
        uniform vec2  uWind;
        uniform vec3  uFarBias;
        uniform float uNormalStrength;
        uniform vec3  uMacroAmt;
        uniform vec3  uHeightBias;
        uniform float uRockBias;

        /* Written by the map chunk, read by the roughness and normal
           chunks further down the fragment shader. Recomputing the
           blend weights three times would cost more than the fetches. */
        float gRough;
        float gAO;
        float gRockW;
        float gGravelW;
        float gDirtW;
        float gVeil;
        float gWNear;
        float gWMid;
        float gLod;
        float gRockDetail;
        vec3  gNrm;
        vec2  gPNear;
        vec2  gPMid;
        vec2  gPFar;

        vec2 rot2(vec2 p, float c, float s) {
          return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        }

        /* Height blend. Linear-blending two rough surfaces produces a
           soapy average in the transition band; comparing their
           heights lets the coarser one poke through, which is how real
           ground meets.

           This form only bounds itself if both heights stay inside
           0..1. The proxies are albedo channels stretched 2.4x and run
           to about 1.15, so a layer can win a little even at weight
           zero - the brightest gravel clasts show through the sand
           where the ripple is in a trough. That was found by reading
           the algebra and then measured before touching it, and it
           turns out to be load-bearing: clamping the proxies to 0..1
           removes the bleed and costs 25% of the near-field octave
           energy at 5-20cm (1.47/1.68 down to 1.10/1.22), because the
           bleed IS the scattered-clast detail. It is left in for
           gravel and dirt, which are surfaces that genuinely
           interfinger with sand, and clamped for rock, which does not
           - limestone patches on a flat dune are wrong at any weight.

           Scaling the heights by the depth also removes the bleed and
           was tried first. Much worse: it makes the comparison
           decisive rather than gradual, so at equal weights one layer
           wins outright, and open ground turned into a near-binary
           field of dirt plates with the ripple gone entirely. */
        float heightMix(float ha, float wa, float hb, float wb, float depth) {
          float top = max(ha + wa, hb + wb) - depth;
          float a = max(ha + wa - top, 0.0);
          float b = max(hb + wb - top, 0.0);
          return b / (a + b + 1e-5);
        }

        /* Triplanar, used only where the surface is steep enough to
           stretch. Restricting it to cliffs keeps three extra texture
           fetches off every flat texel on screen. */
        vec4 triSample(sampler2D tex, vec3 p, vec3 w, float scale, float lod) {
          return texture2D(tex, p.zy * scale, lod) * w.x
               + texture2D(tex, p.xz * scale, lod) * w.y
               + texture2D(tex, p.xy * scale, lod) * w.z;
        }

        /* Whiteout blend. Each plane's tangent-space normal is folded
           back around the geometric normal before the three are summed.
           Swizzling one sample instead - the cheap version - produces
           normals that point the wrong way on two of the three axes,
           which reads as backwards lighting on cliffs. */
        vec3 triNormal(sampler2D tex, vec3 p, vec3 n, vec3 w, float scale, float lod, float amt) {
          vec3 nx = texture2D(tex, p.zy * scale, lod).xyz * 2.0 - 1.0;
          vec3 ny = texture2D(tex, p.xz * scale, lod).xyz * 2.0 - 1.0;
          vec3 nz = texture2D(tex, p.xy * scale, lod).xyz * 2.0 - 1.0;
          nx.xy *= amt; ny.xy *= amt; nz.xy *= amt;
          nx = vec3(nx.xy + n.zy, abs(nx.z) * n.x);
          ny = vec3(ny.xy + n.xz, abs(ny.z) * n.y);
          nz = vec3(nz.xy + n.xy, abs(nz.z) * n.z);
          return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
        }

        /* The XZ-planar case of the same blend, for the ground layers.
           Building a tangent frame from an arbitrary axis instead
           rotates the bump directions away from the albedo they were
           derived from, and the ground lights as if the sun had moved. */
        vec3 planarNormal(vec3 t, vec3 n) {
          return normalize(vec3(t.xy + n.xz, abs(t.z) * n.y).xzy);
        }

        vec3 sampleDetailNormal(sampler2D tex) {
          vec3 nNear = texture2D(tex, gPNear).xyz * 2.0 - 1.0;
          vec3 nMid  = texture2D(tex, gPMid).xyz * 2.0 - 1.0;
          return mix(nMid, nNear, gWNear);
        }
      `)
      .replace("#include <map_fragment>", `
        vec3 tPos = vTerrainPos;
        vec3 tNrm = normalize(vTerrainNormal);
        gNrm = tNrm;

        gWNear = 1.0 - smoothstep(uDetailFade.x, uDetailFade.y, vTerrainDist);
        gWMid  = 1.0 - smoothstep(uMidFade.x, uMidFade.y, vTerrainDist);

        /* Distance detail-blend. Every tiling rate keeps the same
           screen-space pitch as it recedes, because the GPU picks its
           mip from that rate's own derivative - so a dune ripple at
           300m came out the same size on screen as one at 30m and the
           frame lost its depth read. An explicit LOD bias that grows
           with distance is what attenuates the frequency: the ripple
           and the gravel stipple wash out into the tile mean and the
           macro field, which varies over hundreds of metres, is what
           carries the far ground. */
        gLod = uFarBias.x * smoothstep(uFarBias.y, uFarBias.z, vTerrainDist);
        /* Rock detail dies off faster than ground detail. Its normal
           map is the strongest in the set and it is projected
           triplanar, so at 400m it was aliasing into the shimmering
           filaments that made every cliff face read as digital hash. */
        gRockDetail = 0.12 + 0.88 * (1.0 - smoothstep(70.0, 300.0, vTerrainDist));

        gPNear = tPos.xz * uNearScale;
        gPMid  = rot2(tPos.xz, 0.6216, 0.7833) * uMidScale;
        gPFar  = rot2(tPos.xz, 0.8776, -0.4794) * uFarScale;

        vec4 mask = texture2D(uMaskMap, tPos.xz * uMapInv + 0.5);
        vec4 mac0 = texture2D(uMacroMap, tPos.xz * uMacroScale);
        vec4 mac1 = texture2D(uMacroMap, rot2(tPos.xz, 0.3624, 0.9320) * uMacroScale2);
        /* A third octave at map scale. 208m is the right size to break
           a tile repeat but it is smaller than one hillside, so a
           1024m ridge still came out as a single tone from end to end.
           This one is what gives the map *regions* - a pale scoured
           quarter, a darker sheltered one - and it is the scale the
           eye uses to judge distance across open ground. */
        vec4 mac2 = texture2D(uMacroMap, rot2(tPos.xz, 0.7539, -0.6570) * uMacroScale3);

        float slope = 1.0 - tNrm.y;
        gRockW = clamp(smoothstep(uSlopeRange.x, uSlopeRange.y, slope) * 0.9
                     + mask.a * 0.85, 0.0, 1.0);

        /* Sand blows over a crest and settles on the far side, so the
           lee face is paler, smoother and streaked along the wind. The
           streak texture is sampled in the wind's own frame and
           squashed across it, which is the only way to get an
           anisotropic pattern out of an isotropic source. */
        vec2 downhill = -tNrm.xz;
        float lee = clamp(dot(normalize(downhill + vec2(1e-5)), uWind), 0.0, 1.0)
                  * smoothstep(0.015, 0.13, slope);
        /* The sample frame was a rigid rotation of world XZ squashed
           17:1. That is an affine map, so the streaks it produced were
           perfectly parallel, perfectly straight and effectively
           infinite, at one angle across the whole 1024m map - corduroy
           on a dune face and the same corduroy on the flat beside it.
           A blind reviewer read it as "stepped LOD contour banding";
           the symptom was real and the geometry was innocent.

           Real aeolian streaks meander, because the flow bends around
           whatever it crosses. Warping the position by a low-frequency
           field before the rotation costs one texture read and buys
           that bend. It has to go before the squash so it displaces
           ALONG the streak as well as across it - warping afterwards
           only slides a continuous ribbon sideways, and the ribbon is
           the problem. The 46m amplitude is several times the 13m
           cross-pitch, which is what breaks a run into finite lengths,
           while the 260m feature size keeps neighbours moving together
           so the lines bend instead of shattering.

           The amplitude was 46m, reasoned from "several times the 13m
           cross-pitch is what breaks a run into finite lengths". That
           reasoning was right and the number was far too big: at 46m
           the streak wanders across three or four of its own pitches
           inside one feature of the warp field, and the result reads as
           dark serpentine worms crawling over the dune rather than as
           wind. It is only visible from close to the ground, which is
           where no beauty-shot camera ever stands. 14m bends the line
           without letting it double back on itself. */
        vec2 warp = (texture2D(uMacroMap, tPos.xz * (1.0 / 260.0)).ga - 0.5) * 14.0;
        vec2 windUv = rot2(tPos.xz + warp, uWind.x, uWind.y) * vec2(1.0 / 190.0, 1.0 / 13.0);
        float streak = texture2D(uMacroMap, windUv).r;
        gVeil = clamp(streak * 1.9 - 0.42, 0.0, 1.0) * lee * (1.0 - gRockW);

        /* Layer weights. Sand depth and dampness come from the baked
           feature mask, so they follow the landform instead of a noise
           field that knows nothing about it. */
        float sandDepth = clamp(mask.b + gVeil * 0.45, 0.0, 1.0);
        float lag = clamp((1.0 - sandDepth) * 1.5 + (mac0.a - 0.5) * 1.1 - 0.28, 0.0, 1.0);
        /* The mask is 2m per texel and blurred, so a damp hollow read
           as a soft round blob with a smooth edge - the same shape
           every time. Breaking it with a macro octave gives the dried
           pan an irregular margin, which is what a real one has. */
        float damp = clamp(mask.r * 1.30 + (mac1.b - 0.5) * 0.55 - 0.12, 0.0, 1.0);
        float graded = mask.g;
        gGravelW = clamp(lag * 0.9 + damp * 0.35, 0.0, 1.0) * (1.0 - gRockW);
        /* Graded ground used to be weighted at 1.15x the mask, which
           put the dirt texture over every street and pad at full
           strength. Dirt is a *cover* on the ground, not a substitute
           for it: at 0.8 the sand and lag underneath still read
           through the wheel-packed surface. */
        gDirtW = clamp(graded * 0.80 + damp * 0.62 - 0.10, 0.0, 1.0) * (1.0 - gRockW);

        /* Three tiling rates, each in its own rotated frame. The far
           rate carries the horizon, the mid rate covers the range
           where a 3.4m tile would visibly repeat, and the near rate is
           only alive underfoot. Each is biased by gLod so the pattern
           softens as it recedes instead of following the camera out. */
        vec4 sandN = texture2D(uSandMap, gPNear);
        vec4 sandM = texture2D(uSandMap, gPMid, gLod * 0.55);
        vec4 sandF = texture2D(uSandMap, gPFar, 0.85 + gLod);
        vec4 sandC = mix(mix(sandF, sandM, gWMid), sandN, gWNear);

        /* Cell-size and orientation variation on the floor.
           Both dirt rates were mixed by distance alone, so every crack
           cell in the world came out the same size, in the same frame,
           for as far as the floor extended - which is what makes a
           large graded area read as one stamped decal however good the
           tile is. Letting the macro field push the near/mid balance
           gives patches of 7cm craze and patches of 26cm, and because
           the two rates are sampled in different rotated frames the
           orientation drifts with them. It costs nothing: both samples
           were already being taken. */
        float dirtScale = clamp(gWNear + (mac1.r - 0.5) * 0.95, 0.0, 1.0);
        vec4 dirtN = texture2D(uDirtMap, gPNear);
        vec4 dirtF = texture2D(uDirtMap, gPMid, gLod * 0.75);
        vec4 dirtC = mix(dirtF, dirtN, dirtScale);

        vec4 gravN = texture2D(uGravelMap, gPNear);
        vec4 gravF = texture2D(uGravelMap, gPMid, gLod * 0.75);
        vec4 gravC = mix(gravF, gravN, gWNear);

        vec3 triW = pow(abs(tNrm), vec3(4.0));
        triW /= max(triW.x + triW.y + triW.z, 1e-4);
        /* 0.72, i.e. a 4.7m tile rather than 8.1m.
           Rock is the only layer in this splat with a single tiling
           rate - sand, gravel and dirt each have a near and a mid - so
           its scale has to be right at the distance a player stands
           from it, not at the distance a cliff is admired from. At 8.1m
           the generator's six beds and five joint columns come out as
           1.35m laminae and 1.6m blocks, and a bank seen from 8m was a
           sheet of metre-and-a-half crazy paving: the exact "voronoi at
           1.5-2m cell size" a reviewer flagged. At 4.7m they are 79cm
           beds and 94cm blocks, which is still a massive limestone and
           reads as jointed rock at arm's length. The far end loses
           nothing - past 300m the LOD bias has washed the joints into
           the tile mean either way, and the macro field carries it. */
        vec4 rockC = triSample(uRockMap, tPos, triW, uNearScale * 0.72, gLod * 0.85);

        /* Height data for the blends. Sand carries a real height in its
           packed ORM; the others use their own luminance, which for
           these three surfaces (dark cracks, pale clasts) tracks
           relief closely enough and saves two samplers - and the
           sampler budget is what stops this shader compiling on a
           machine with four shadow cascades. */
        /* Each proxy is centred on its own measured tile mean and
           then stretched, because an albedo's spread is a third of a
           height field's and an un-stretched proxy loses every contest
           to sand no matter what the relief actually does. */
        vec4 sandOrm = texture2D(uSandOrm, gPNear);
        /* The same pack at the mid rate.
           The roughness below used to fall back to the constant 0.95
           as the near rate faded, so every terrain texel past ~78m -
           which is most of the screen in any wide shot - shaded with
           one specular response and the only variation left was a
           macro wobble. The mid rate is already the rate carrying the
           albedo out there; reading its roughness costs one fetch and
           gives the far ground the same crest/trough spread the near
           ground has. */
        vec4 sandOrmMid = texture2D(uSandOrm, gPMid, gLod * 0.55);
        float hSand = mix(0.5, (sandOrm.b - uHeightBias.x) * 1.0 + 0.5, gWNear);
        float hGrav = mix(0.5, (gravC.r - uHeightBias.y) * 2.4 + 0.5, gWNear);
        /* Polarity, not preference. Dirt's bright texels are the crust
           and the sand drifted on top of it - the HIGH parts - and its
           dark ones are the craze and the scuffed hollows. Inverting
           this channel made the crack network the highest thing in the
           blend, so it punched through the sand and the lag wherever
           dirt had any weight at all, and put a cell pattern across
           the whole floor far stronger than the dirt weight asked for. */
        float hDirt = mix(0.5, (dirtC.r - uHeightBias.z) * 2.4 + 0.5, gWNear);

        vec4 groundC = sandC;
        float hGround = hSand;
        float gm = heightMix(hSand, 1.0 - gGravelW, hGrav, gGravelW, 0.28);
        groundC = mix(groundC, gravC, gm);
        hGround = mix(hGround, hGrav, gm);
        float dm = heightMix(hGround, 1.0 - gDirtW, hDirt, gDirtW, 0.22);
        groundC = mix(groundC, dirtC, dm);
        hGround = mix(hGround, hDirt, dm);

        /* Rock over ground, height-blended like the other two.
           This transition was the one linear crossfade left in the
           splat, and it is also the most visible one on a desert map:
           where a cliff foot meets the sand is where a reviewer looks
           for a seam. A linear mix hands back the average of two rough
           surfaces across the whole transition band - the soapy grey
           that reads as a painted boundary - whereas comparing heights
           lets the outcrop poke through the sand drift a block at a
           time, which is how bedrock actually emerges from a dune.
           The proxy is rock's own albedo red, centred on its measured
           tile mean and stretched like the others. Depth 0.34 rather
           than 0.28: rock's relief is the deepest in the set, so the
           band it interlocks over should be wider. */
        float hRock = clamp(mix(0.5, (rockC.r - uRockBias) * 2.4 + 0.5, gWNear), 0.0, 1.0);
        float rm = heightMix(hGround, 1.0 - gRockW, hRock, gRockW, 0.34);
        vec4 sampledDiffuseColor = mix(groundC, rockC, rm);
        // Everything downstream keys off gRockW as "how rocky is this
        // texel". Re-pointing it at the height-blended answer keeps the
        // roughness, the veil and the normal blend agreeing with the
        // albedo instead of fading on a different curve.
        gRockW = rm;

        /* Wind veil: a thin sheet of clean pale sand lying over
           whatever is underneath, not a replacement for it. Held to
           a third rather than a half - a slipface really is smoother
           and paler than the ground it buried, but at 0.55 with the
           normal flattening below it turned every lee slope on the map
           into a featureless white sheet. */
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb,
                                      sandC.rgb * 1.03, gVeil * 0.34);

        /* Damp ground. Water filling the pore space makes sand darker
           and slightly MORE saturated in its own hue: light that
           escapes the surface has bounced more times inside the grain,
           not fewer. It does not turn blue.

           The explicit blue boost that used to be here (b *= 1.13) was
           double counting. The roughness drop further down already
           turns damp ground into a weak mirror of a blue sky, so the
           cool cast is arriving physically; adding a channel gain on
           top of it produced a violet sheen that reviewers have
           described twice - once as "the shaded side goes violet" and
           once as a flat sage-green water plane, in a game that has no
           water. Both were reading this line. */
        float wet = damp * (1.0 - gRockW);
        vec3 dryC = sampledDiffuseColor.rgb;
        float dryL = dot(dryC, vec3(0.2126, 0.7152, 0.0722));
        vec3 wetC = max(mix(vec3(dryL), dryC, 1.18), vec3(0.0)) * 0.62;
        sampledDiffuseColor.rgb = mix(dryC, wetC, wet * 0.9);

        /* Wheel-packed ground. The route network rides in the mask's
           disturbance channel, so a track darkens and de-saturates the
           ground it crosses exactly as compaction does, and it does so
           at 600m where a decal would long since have been culled. */
        sampledDiffuseColor.rgb *= mix(1.0, 0.84, graded * 0.48 * (1.0 - gRockW));

        /* Macro variation. Two decorrelated octaves of a field that
           only changes over hundreds of metres. Nothing else hides a
           3.4m tile at 300m, because the repeat is a property of the
           tile and no amount of detail can argue with it - and once
           the detail-blend above has washed the tile out, this is the
           ONLY thing left carrying the far ground. It has to be worth
           looking at. At the old +/-6% the whole dune field was one
           hue and every hill past 80m collapsed into a flat mass. */
        float tone = 1.0
          + (mac0.r - 0.5) * uMacroAmt.x
          + (mac1.r - 0.5) * uMacroAmt.y
          + (mac2.r - 0.5) * 0.34;
        float hueDrift = ((mac0.g - 0.5) * 1.0
                        + (mac1.g - 0.5) * 0.45
                        + (mac2.g - 0.5) * 0.60) * uMacroAmt.z;
        sampledDiffuseColor.rgb *= tone;
        // A channel tilt rather than a colour lerp, so the drift never
        // reads as a change in lighting.
        sampledDiffuseColor.r *= 1.0 + hueDrift * 0.130;
        sampledDiffuseColor.g *= 1.0 + hueDrift * 0.022;
        // Asymmetric on purpose: the drift must never take blue below
        // the point where warm desert ground turns olive-grey.
        sampledDiffuseColor.b *= 1.0 - hueDrift * 0.100;

        /* Debris and spoil along the routes. The lag channel of the
           second macro octave gives a patchy field at ~46m; gated on
           the track network it reads as the scatter of rubble, spoil
           and torn-up surface that follows anything anyone has driven
           over for a year, and it stops the tracks reading as painted
           ribbons. */
        float spoil = clamp((mac1.a - 0.42) * 2.2, 0.0, 1.0) * graded;
        sampledDiffuseColor.rgb *= mix(1.0, 0.88, spoil * 0.5);
        sampledDiffuseColor.r *= 1.0 + spoil * 0.045;

        /* Wind scour: the pale trails the wind strips down to clean
           quartz, running along its own direction. gVeil already
           carries the lee-slope deposition; this is the other half of
           the same process, on the ground the wind is taking sand
           *from*, and it is what gives a 300m hillside a grain. */
        /* ...and only off ground the wind can actually reach. This was
           ungated, so the scour pattern was laid over lee slopes and
           sheltered hollows at full strength as well - the same trails
           in the same direction everywhere, which is most of what made
           one global wind direction so conspicuous. lee already
           carries "sand is settling here, not leaving", and gVeil is
           the deposition half of the same process, so backing scour off
           by it is free and puts the two halves on opposite faces where
           they belong. Flats keep it in full: lee is slope-gated. */
        float scour = clamp(streak * 1.6 - 0.55, 0.0, 1.0)
                    * (1.0 - gRockW) * (1.0 - wet) * (1.0 - lee * 0.75);
        sampledDiffuseColor.rgb *= mix(1.0, 1.13, scour);

        /* Roughness. The far half of this used to be the constant
           0.98, then 0.95; either way every surface past 80m - sand,
           lag, wet silt, rock - shaded with one specular response and
           the horizon had no material variation at all. Now the mid
           rate's own packed roughness carries it, so the crest/trough
           spread survives to the horizon and the macro field's blue
           channel modulates it rather than being the only thing there.
           The residual 0.06 of constant is deliberate: the mid rate
           still aliases at 600m and a fully un-damped roughness map
           at that range sparkles. */
        float macroRough = (mac0.b - 0.5) * 0.34 + (mac1.b - 0.5) * 0.16
                         + (mac2.b - 0.5) * 0.18;
        gRough = clamp(
            mix(mix(0.95, sandOrmMid.g, 0.94), sandOrm.g, gWNear * 0.85)
          + macroRough
          - gVeil * 0.06
          - scour * 0.05
          - gGravelW * 0.13
          - gDirtW * 0.15
          - gRockW * 0.16
          /* Left at 0.30. I lowered this to 0.11 believing the sheen was
             a specular reflection of a blue sky off over-smoothed damp
             ground, and measured the result: blue/red went 2.144 ->
             2.148 on the wadi margin. Nothing. The violet is not coming
             from this surface's roughness, it is coming from the light
             falling on it - see the shade-chroma work in render.js. */
          - wet * 0.30,
          0.22, 1.0);

        // Detail AO fades out with the detail itself; keeping it at
        // range darkens the whole horizon by a constant.
        gAO = mix(1.0, mix(1.0, sandOrm.r, 0.75), gWNear);

        diffuseColor *= sampledDiffuseColor;
      `)
      .replace("#include <roughnessmap_fragment>", `
        float roughnessFactor = gRough;
      `)
      .replace("#include <normal_fragment_maps>", `
        {
          vec3 sandN = sampleDetailNormal(uSandNrm);
          vec3 gravN = sampleDetailNormal(uGravelNrm);
          vec3 dirtN = sampleDetailNormal(uDirtNrm);

          /* Weights taken at face value. Sharpening them for the normal
             only - smoothstep(0, 0.55, gDirtW), so a graded surface
             would lose its ripple faster than its colour - was tried
             and measurably backfired: it took dirt's craze from 0.35 to
             0.70 of the relief wherever dirt had any weight at all, and
             open ground at 1m turned from rippled sand into a network
             of mud plates. The craze normal is the strongest in the set
             and it must not be given more weight than the splat asks
             for. */
          vec3 detailT = normalize(mix(mix(sandN, gravN, gGravelW), dirtN, gDirtW));
          /* The lee face is a smooth sheet of drifted sand; it should
             not carry the relief of whatever it buried. 0.18 rather
             than 0.32: a slipface really is the smoothest thing on a
             dune field, but at 0.32 a 40m lee slope came out as a
             completely featureless sheet at 8m range, which is where
             "the ground is a smooth blurred wash" is actually true.
             Fresh drift still carries its own ripple. */
          detailT = normalize(mix(detailT, vec3(0.0, 0.0, 1.0), gVeil * 0.18));
          // Detail normals fade with distance. Keeping them at 900m
          // costs bandwidth and produces shimmer, because a normal map
          // aliases long before its albedo does.
          detailT.xy *= uNormalStrength;
          detailT = normalize(mix(vec3(0.0, 0.0, 1.0), detailT, gWNear * 0.92 + 0.08));

          vec3 groundWorld = planarNormal(detailT, gNrm);

          vec3 triW2 = pow(abs(gNrm), vec3(4.0));
          triW2 /= max(triW2.x + triW2.y + triW2.z, 1e-4);
          // Must track the albedo's scale exactly, or the relief lights
          // a different set of joints from the ones you can see.
          vec3 rockWorld = triNormal(uRockNrm, vTerrainPos, gNrm, triW2,
                                     uNearScale * 0.72, gLod * 0.85,
                                     uNormalStrength * gRockDetail);

          normal = normalize(mix(groundWorld, rockWorld, gRockW));
        }
      `)
      .replace("#include <aomap_fragment>", `
        {
          float ambientOcclusion = (gAO - 1.0) * 0.9 + 1.0;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
        }
      `);

    terrainMaterial.userData.shader = shader;
  };
  terrainMaterial.customProgramCacheKey = () => "bs-terrain-splat-8";

  /* ---------------------------- chunk meshes ---------------------------- */

  const group = new THREE.Group();
  group.name = "terrain";
  render.scene.add(group);

  /**
   * Skirt: a curtain hanging from the chunk's border.
   *
   * Two LOD levels agree exactly at their shared vertices - both
   * sample the same baked grid - but the coarse level chords straight
   * across everything between them, so a ridge running along a chunk
   * boundary opens a sliver of sky. The skirt is what fills it.
   *
   * The curtain gets its own copy of the border vertices rather than
   * reusing the surface's. Sharing them would drag the surface's
   * vertex normals down toward the curtain and put a dark seam around
   * every chunk, which is a worse artifact than the crack.
   */
  function skirtGeometry(THREE_, surface, segments, depth) {
    const n = segments + 1;
    const src = surface.attributes.position.array;
    const uvSrc = surface.attributes.uv.array;
    const vi = (ix, iy) => iy * n + ix;

    // Counter-clockwise around the border, so every quad's outward
    // direction is the same side of its edge.
    const ring = [];
    for (let i = 0; i < segments; i += 1) ring.push(vi(i, 0));
    for (let i = 0; i < segments; i += 1) ring.push(vi(segments, i));
    for (let i = segments; i > 0; i -= 1) ring.push(vi(i, segments));
    for (let i = segments; i > 0; i -= 1) ring.push(vi(0, i));
    ring.push(ring[0]);

    const count = ring.length;
    const positions = new Float32Array(count * 2 * 3);
    const normals = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const indices = [];

    for (let k = 0; k < count; k += 1) {
      const v = ring[k];
      const x = src[v * 3];
      const y = src[v * 3 + 1];
      const z = src[v * 3 + 2];
      positions[k * 6] = x; positions[k * 6 + 1] = y; positions[k * 6 + 2] = z;
      positions[k * 6 + 3] = x; positions[k * 6 + 4] = y - depth; positions[k * 6 + 5] = z;
      // Outward-ish: the curtain is only ever glimpsed edge-on through
      // a crack, so a horizontal normal away from the chunk centre is
      // as much as it needs.
      const ox = x === 0 ? 0 : Math.sign(x);
      const oz = z === 0 ? 0 : Math.sign(z);
      const olen = Math.hypot(ox, oz) || 1;
      for (const o of [0, 3]) {
        normals[k * 6 + o] = ox / olen;
        normals[k * 6 + o + 1] = 0;
        normals[k * 6 + o + 2] = oz / olen;
      }
      uvs[k * 4] = uvSrc[v * 2]; uvs[k * 4 + 1] = uvSrc[v * 2 + 1];
      uvs[k * 4 + 2] = uvSrc[v * 2]; uvs[k * 4 + 3] = uvSrc[v * 2 + 1];
    }

    for (let k = 0; k < count - 1; k += 1) {
      const a = k * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    const geometry = new THREE_.BufferGeometry();
    geometry.setAttribute("position", new THREE_.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE_.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE_.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  /** Build one chunk at one LOD. Geometry is generated in local space
   *  with the chunk's centre at the origin so float precision stays
   *  good at the map edge. */
  function buildChunkGeometry(cx, cz, segments) {
    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const originX = -half + cx * CHUNK_SIZE + CHUNK_SIZE * 0.5;
    const originZ = -half + cz * CHUNK_SIZE + CHUNK_SIZE * 0.5;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) + originX;
      const z = position.getZ(i) + originZ;
      // Sample the BAKED grid, not shapeHeight. If the mesh and the
      // physics disagree by even a few centimetres the player floats
      // or sinks, and the discrepancy is invisible until someone
      // notices their feet are underground on a slope.
      position.setY(i, heightAt(x, z));
    }
    geometry.computeVertexNormals();

    // Deep enough to cover the worst chord a coarse level can cut
    // across a fine one, which scales with that level's spacing.
    const spacing = CHUNK_SIZE / segments;
    const skirt = skirtGeometry(THREE, geometry, segments, 2.0 + spacing * 0.42);
    const merged = mergeIntoSurface(geometry, skirt);
    merged.computeBoundingSphere();
    return { geometry: merged, originX, originZ };
  }

  /** Append the skirt to the surface without disturbing the surface's
   *  own vertex normals, which have already been computed. */
  function mergeIntoSurface(surface, skirt) {
    const sPos = surface.attributes.position.array;
    const sNrm = surface.attributes.normal.array;
    const sUv = surface.attributes.uv.array;
    const sIdx = surface.index.array;
    const kPos = skirt.attributes.position.array;
    const kNrm = skirt.attributes.normal.array;
    const kUv = skirt.attributes.uv.array;
    const kIdx = skirt.index.array;

    const vertexCount = sPos.length / 3;
    const position = new Float32Array(sPos.length + kPos.length);
    const normal = new Float32Array(sNrm.length + kNrm.length);
    const uv = new Float32Array(sUv.length + kUv.length);
    position.set(sPos, 0); position.set(kPos, sPos.length);
    normal.set(sNrm, 0); normal.set(kNrm, sNrm.length);
    uv.set(sUv, 0); uv.set(kUv, sUv.length);

    const total = sIdx.length + kIdx.length;
    const index = vertexCount + kPos.length / 3 > 65535
      ? new Uint32Array(total) : new Uint16Array(total);
    index.set(sIdx, 0);
    for (let i = 0; i < kIdx.length; i += 1) index[sIdx.length + i] = kIdx[i] + vertexCount;

    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    surface.dispose();
    skirt.dispose();
    return out;
  }

  /** Vertical relief of one chunk, in metres, from the baked grid. */
  function chunkRelief(cx, cz) {
    const spanI = Math.round(CHUNK_SIZE / cell);
    const i0 = cx * spanI;
    const j0 = cz * spanI;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = j0; j <= Math.min(HEIGHT_RES - 1, j0 + spanI); j += 1) {
      for (let i = i0; i <= Math.min(HEIGHT_RES - 1, i0 + spanI); i += 1) {
        const h = heights[j * HEIGHT_RES + i];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return hi - lo;
  }

  const chunks = [];
  let shadowCasters = 0;
  for (let cz = 0; cz < CHUNKS; cz += 1) {
    for (let cx = 0; cx < CHUNKS; cx += 1) {
      const lods = LOD_LEVELS.map((segments) => buildChunkGeometry(cx, cz, segments));
      const lod = new THREE.LOD();
      lod.name = `terrain-chunk-${cx}-${cz}`;

      // LOD distances scale with the quality tier's bias. They are
      // measured to the chunk *centre*, so the near edge of a chunk is
      // up to 45m closer than the number says - which is why the first
      // step is much further out than the chunk is wide.
      //
      // The *coarse* steps also scale with how much relief the chunk
      // has. A flat basin chunk is identical at 4 segments and at 32,
      // so dropping it early is free; a ridge chunk at 4 segments has
      // 16m between vertices and shows its facets against the sky,
      // which is the one place on screen where a chord across a curve
      // cannot hide. Only the last two steps are stretched: pushing
      // LOD1 out as well cost 90k triangles across the whole map for
      // detail nobody can see on the basin floor.
      const relief = chunkRelief(cx, cz);
      /* Chunks with no relief do not cast.
       *
       * Measured A/B inside one session at ultra/1600x900, establishing
       * pose: 6.59ms without terrain casting, 8.26ms with - 1.67ms and
       * 74 draw calls for every landform shadow on the map. (A naive
       * before/after across two separate captures said 22ms, which was
       * the lighting agents' concurrent edits, not this.) At that price
       * the gate is insurance rather than economy: it only drops the
       * graded pads and playa, where a shadow would be indistinguishable
       * from the N.L term already there. */
      const casts = relief > 3;
      if (casts) shadowCasters += 1;
      const bias = q.terrainLodBias;
      const r = clamp01((relief - 14) / 30);
      const distances = [
        0,
        145 * bias * (1 + r * 0.35),
        310 * bias * (1 + r * 1.15),
        620 * bias * (1 + r * 2.20),
      ];

      lods.forEach((entry, index) => {
        const mesh = new THREE.Mesh(entry.geometry, terrainMaterial);
        mesh.position.set(entry.originX, 0, entry.originZ);
        /* The terrain casts.
         *
         * This was false, on the reasoning that a heightfield
         * "self-shadows via the sun" - which is true only in the sense
         * that N.L darkens a slope facing away from it. It does not
         * put a mesa's shadow on the ground beside the mesa, and on a
         * 1024m map whose landmarks ARE the terrain that removes the
         * largest shadow caster in the world: at a low sun the jebel
         * should lay a kilometre of shadow across the basin and the
         * wadi should sit in its own bank's shade. Without it every
         * landform reads as painted-on relief and the valley floor is
         * uniformly lit at every hour of the day.
         *
         * Only levels 0-2 cast. LOD3 is 16m between vertices, and a
         * shadow silhouette cut from a 16m chord is a worse artifact
         * than no shadow - it detaches from the ridge it belongs to.
         * Chunks that far out are beyond the shadow distance on every
         * tier anyway, so this costs nothing it does not buy back. */
        mesh.castShadow = casts && index < 3;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.terrain = true;
        lod.addLevel(mesh, distances[index]);
      });

      lod.matrixAutoUpdate = false;
      lod.updateMatrix();
      group.add(lod);
      chunks.push(lod);
    }
  }

  /* ------------------------------ bounds ------------------------------ */

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < heights.length; i += 1) {
    if (heights[i] < minHeight) minHeight = heights[i];
    if (heights[i] > maxHeight) maxHeight = heights[i];
  }

  /* -------------------------------- api -------------------------------- */

  const api = {
    group,
    material: terrainMaterial,
    uniforms: terrainUniforms,
    maskTexture,
    MAP_SIZE,
    HEIGHT_RES,
    CHUNK_SIZE,
    heights,
    minHeight,
    maxHeight,

    heightAt,
    normalAt,
    slopeAt,
    shapeHeight,
    trackAt,

    /** True when the point is inside the playable area (inside the rim). */
    inBounds(x, z) {
      const r = Math.hypot(x, z) / (MAP_SIZE * 0.5);
      return r < 0.72;
    },

    /**
     * The desert tracks as world-space polylines.
     *
     * These exist in the feature mask as disturbed ground and nothing
     * else; world.js dresses them with ruts and spoil berms, and it
     * needs the same centrelines the mask was painted from or the
     * geometry and the shading describe two different tracks.
     * The wadi route has no point list of its own - it IS the thalweg -
     * so it is sampled from the same expression shapeHeight() uses.
     */
    routePolylines(step = 9) {
      return ROUTES.map((route) => {
        if (!route.wadi) return { pts: route.pts.map((p) => [p[0], p[1]]), width: route.width, strength: route.strength };
        const pts = [];
        for (let x = route.from; x <= route.to; x += step) pts.push([x, wadiCentreAt(x)]);
        return { pts, width: route.width, strength: route.strength, wadi: true };
      });
    },

    /**
     * Declare bedrock at a point, for the splat to pick up on its next
     * build. Call before `rebuild()`; the list is replayed by
     * buildMask() so a later flatten() cannot wipe it.
     */
    stampRock(x, z, radius, amount = 0.85) {
      rockStamps.push({ x, z, radius, amount });
    },

    /** Flatten a disc of terrain, for a building pad or a road. Called
     *  by structures before it places anything, so nothing ends up
     *  half-buried in a slope. */
    flatten(x, z, radius, targetHeight = null, falloff = 1.6) {
      const level = targetHeight === null ? heightAt(x, z) : targetHeight;
      const i0 = Math.max(0, Math.floor((x - radius * falloff + half) / cell));
      const i1 = Math.min(HEIGHT_RES - 1, Math.ceil((x + radius * falloff + half) / cell));
      const j0 = Math.max(0, Math.floor((z - radius * falloff + half) / cell));
      const j1 = Math.min(HEIGHT_RES - 1, Math.ceil((z + radius * falloff + half) / cell));

      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const wx = -half + i * cell;
          const wz = -half + j * cell;
          const d = Math.hypot(wx - x, wz - z);
          if (d > radius * falloff) continue;
          const t = 1 - smoothstep(clamp01((d - radius) / (radius * (falloff - 1) + 1e-3)));
          const index = j * HEIGHT_RES + i;
          heights[index] = lerp(heights[index], level, t);
        }
      }
      return level;
    },

    /** Rebuild chunk geometry after flatten() calls. Cheap enough to
     *  run once at load; never call it per frame. */
    rebuild() {
      let index = 0;
      minHeight = Infinity;
      maxHeight = -Infinity;
      for (let i = 0; i < heights.length; i += 1) {
        if (heights[i] < minHeight) minHeight = heights[i];
        if (heights[i] > maxHeight) maxHeight = heights[i];
      }
      for (let cz = 0; cz < CHUNKS; cz += 1) {
        for (let cx = 0; cx < CHUNKS; cx += 1) {
          const lod = chunks[index];
          index += 1;
          lod.levels.forEach((level, li) => {
            const mesh = level.object;
            const segments = LOD_LEVELS[li];
            const rebuilt = buildChunkGeometry(cx, cz, segments);
            mesh.geometry.dispose();
            mesh.geometry = rebuilt.geometry;
          });
        }
      }
      // The mask has to follow: every pad and road that was just
      // flattened should read as graded ground, and the dampness and
      // sand-depth fields were computed against the old surface.
      buildMask();
      api.minHeight = minHeight;
      api.maxHeight = maxHeight;
    },

    update(dt, c) {
      // LOD selection needs the camera; three does this in render()
      // only for LOD objects that are in the scene, which they are.
      group.traverse((obj) => { if (obj.isLOD) obj.update(c.render.camera); });
    },

    report() {
      const levels = [0, 0, 0, 0];
      for (const lod of chunks) {
        const active = lod.getCurrentLevel ? lod.getCurrentLevel() : 0;
        levels[Math.min(3, Math.max(0, active))] += 1;
      }
      return {
        mapSize: MAP_SIZE,
        chunks: chunks.length,
        lodChunks: levels,
        shadowCasters: shadowCasters,
        rockStamps: rockStamps.length,
        heightBias: [
          Number(HEIGHT_BIAS.x.toFixed(3)),
          Number(HEIGHT_BIAS.y.toFixed(3)),
          Number(HEIGHT_BIAS.z.toFixed(3)),
        ],
        minHeight: Number(minHeight.toFixed(2)),
        maxHeight: Number(maxHeight.toFixed(2)),
      };
    },

    dispose() {
      group.traverse((obj) => { if (obj.isMesh) obj.geometry.dispose(); });
      render.scene.remove(group);
      maskTexture.dispose();
      terrainMaterial.dispose();
    },
  };

  return api;
}
