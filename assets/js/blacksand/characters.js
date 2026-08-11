/* ============================================================
   BLACKSAND - soldier meshes and animation

   Every bot and every remote player is one of these. There is no
   external model file: the body, the kit and the weapon are assembled
   procedurally onto a real bone hierarchy, so a soldier can be posed,
   varied and hit-boxed exactly, and a squad of forty is forty unique
   figures rather than forty instances of one.

   ---- why one SkinnedMesh instead of a tree of meshes ----
   The obvious build is a Group per bone with a Mesh per body part.
   That is what this file used to do and it cost fifteen draw calls per
   soldier - six hundred for a full round, before shadows. Everything
   here is merged into a single skinned buffer per soldier and drawn
   with one shared material, so a soldier is ONE draw call no matter
   how much webbing is hanging off him. That is the entire reason the
   kit can be this detailed.

   ---- why a texture atlas ----
   Flat colours read as toys. A soldier needs cloth to look woven,
   nylon to look ribbed and a helmet to look moulded. One 512px atlas
   of procedural detail tiles (albedo, normal and roughness) is
   generated at load; every part picks a tile and a sub-rect of it, so
   texel density stays roughly constant from a chin strap to a rucksack
   and no two parts share the same patch of noise.

   ---- model space ----
   FORWARD IS -Z, matching the engine's own convention
   (facing = (-sin(yaw), 0, -cos(yaw)) with root.rotation.y = yaw).
   The previous rig was authored +Z-forward, which rendered every
   soldier in the game facing exactly backwards from the direction they
   were walking and shooting. Signs in `pose` follow from this:
     - positive hip/shoulder rotation.x swings the limb FORWARD
     - knee rotation.x is <= 0, so the shin trails behind the thigh
     - forward lean is NEGATIVE spine rotation.x
   ============================================================ */

import {
  makeRng, makeNoise2D,
  clamp, clamp01, lerp, damp, dampAngle, smoothstep, TAU,
} from "./core.js";

/* Segment lengths. Shared by the rig, the animation and the IK, so a
 * proportion change cannot desync the solver from the mesh. */
const SEG = {
  hipY: 0.99,          // pelvis height when standing, legs slightly bent
  spineY: 0.09,
  chestY: 0.24,
  neckY: 0.18,
  headY: 0.09,
  shoulderX: 0.195,
  shoulderY: 0.145,
  upperArm: 0.28,
  foreArm: 0.26,
  hipX: 0.105,
  hipDrop: 0.07,
  thigh: 0.44,
  shin: 0.42,
  ankleHeight: 0.085,  // ankle joint above the sole
};

const LEG_MAX = SEG.thigh + SEG.shin;

/**
 * Team kit.
 *
 * Team identity at 150m cannot rely on an insignia - a soldier is
 * fifteen pixels tall at that range and a patch is one. It has to be
 * carried by the VALUE of the whole figure, so the coalition is built
 * light (desert tan over pale sand reads as a bright chip) and the
 * insurgency dark (near-black rig over olive reads as a hole). The
 * accent hues only do work inside about 60m.
 */
const TEAM_KIT = {
  1: {
    name: "coalition",
    fatigue: [0xa1926c, 0xb0a077, 0x968a66, 0xaa9b74],
    vest: [0x8a7550, 0x7d6a49, 0x94805c],
    helmet: [0x9c8f69, 0x8e8261],
    pack: [0x84714e, 0x796648],
    boot: [0x6f5637, 0x7d6440],
    glove: [0x4a3f31, 0x5a4c3a],
    // Desaturated against the obvious reading of these hues: the sky
    // probe now arrives at only just over half strength on a soldier,
    // so the sun's own warmth is no longer diluted and a face mixed at
    // full chroma comes out orange plastic.
    skin: [0x9c7c60, 0x866953, 0xab8a6f, 0x674b38],
    accent: 0x2f5f96,
    headgear: ["helmet", "helmet", "helmet", "helmet", "boonie", "helmet"],
    packChance: 0.75,
    kneePadChance: 0.8,
    gogglesChance: 0.55,
    antennaChance: 0.25,
    sleeveChance: 0.35,
  },
  2: {
    name: "insurgency",
    // Lifted a stop from the original values. Holding a soldier off the
    // sky probe made these read as pure silhouette at 15m with no
    // internal detail at all - the team read survived but the figure
    // stopped being a figure.
    fatigue: [0x5d5b46, 0x4f5042, 0x686150, 0x56513b],
    vest: [0x33302a, 0x3b362e, 0x2b2924],
    helmet: [0x484539, 0x3b382f],
    pack: [0x413d35, 0x4c463c],
    boot: [0x342f2a, 0x3d3730],
    glove: [0x37322d, 0x2b2724],
    skin: [0x816251, 0x6d5040, 0x907260, 0x594233],
    accent: 0x93382a,
    headgear: ["wrap", "wrap", "cap", "wrap", "helmet", "wrap"],
    packChance: 0.4,
    kneePadChance: 0.2,
    gogglesChance: 0.12,
    antennaChance: 0.18,
    sleeveChance: 0.7,
  },
};

export async function createCharacters(ctx) {
  const { THREE, render, settings } = ctx;
  const noise = makeNoise2D(ctx.seed ^ 0x7a17ed);

  const group = new THREE.Group();
  group.name = "characters";
  render.scene.add(group);

  /* ================================================================
     texture atlas
     ================================================================ */

  const ATLAS_SIZE = 512;
  const ATLAS_GRID = 4;
  const TILE_PX = ATLAS_SIZE / ATLAS_GRID;
  /* Inset so mip levels 0-2 cannot pull in the neighbouring tile. A
   * soldier is only ever at mip 0-1 inside 20m, and past 60m the bleed
   * is smaller than a pixel. */
  const TILE_INSET = 4 / ATLAS_SIZE;

  /**
   * Tile recipes. `h` is a height field in 0..1 that drives all three
   * maps; keeping one field means the crease in the albedo, the bump in
   * the normal and the sheen in the roughness always agree, which is
   * most of what makes procedural gear look manufactured rather than
   * noisy.
   */
  /* The weave is deliberately finer than the screen can resolve.
   *
   * At 40-90 cycles across a 128px tile that is two or three pixels per
   * thread, so it shimmers slightly inside about 3m. Two ways out were
   * tried and both are worse. Halving the frequency turns the two
   * axis-aligned sines into a visible CHECKERBOARD and the soldiers
   * come out upholstered. Re-summing them on the diagonals as a twill,
   * at a frequency low enough to mip cleanly, gives hard black-and-
   * white corrugation - because a normal-mapped weave you can actually
   * RESOLVE at two metres reads as corrugated iron, not as cloth. A
   * weave wants to sit under the resolution limit and average into a
   * texture; the shimmer is the price and it is the cheaper one. */
  const TILES = {
    cloth: { i: 0, weave: [46, 46, 0.30], grain: [9, 0.34], blotch: [3.2, 0.30], rough: 0.94, bump: 1.0, dark: 0.30 },
    camo: { i: 1, weave: [40, 40, 0.20], grain: [7, 0.26], blotch: [2.1, 0.52], rough: 0.95, bump: 0.9, dark: 0.40 },
    nylon: { i: 2, weave: [64, 22, 0.52], grain: [14, 0.20], blotch: [5.0, 0.14], rough: 0.86, bump: 1.5, dark: 0.34 },
    skin: { i: 3, weave: [0, 0, 0], grain: [26, 0.16], blotch: [4.0, 0.16], rough: 0.72, bump: 0.5, dark: 0.16 },
    leather: { i: 4, weave: [0, 0, 0], grain: [22, 0.42], blotch: [6.0, 0.24], rough: 0.70, bump: 1.3, dark: 0.34 },
    gunmetal: { i: 5, weave: [0, 0, 0], grain: [30, 0.22], blotch: [8.0, 0.30], rough: 0.56, bump: 0.7, dark: 0.30, metal: 0.22 },
    polymer: { i: 6, weave: [90, 90, 0.16], grain: [34, 0.14], blotch: [5.0, 0.12], rough: 0.62, bump: 0.6, dark: 0.20 },
    pouch: { i: 7, weave: [34, 34, 0.40], grain: [8, 0.30], blotch: [2.6, 0.26], rough: 0.93, bump: 1.7, dark: 0.42, seams: true },
    cover: { i: 8, weave: [56, 56, 0.26], grain: [12, 0.24], blotch: [2.8, 0.40], rough: 0.90, bump: 0.8, dark: 0.32 },
    rubber: { i: 9, weave: [0, 0, 0], grain: [40, 0.20], blotch: [9.0, 0.18], rough: 0.98, bump: 0.9, dark: 0.28 },
    metal: { i: 10, weave: [0, 0, 0], grain: [46, 0.14], blotch: [11.0, 0.16], rough: 0.38, bump: 0.4, dark: 0.22, metal: 0.55 },
    wrap: { i: 11, weave: [26, 26, 0.46], grain: [6, 0.34], blotch: [3.6, 0.30], rough: 0.96, bump: 1.4, dark: 0.36 },
    cordura: { i: 12, weave: [50, 26, 0.42], grain: [11, 0.24], blotch: [3.0, 0.24], rough: 0.90, bump: 1.5, dark: 0.36 },
    plain: { i: 13, weave: [0, 0, 0], grain: [18, 0.10], blotch: [7.0, 0.10], rough: 0.88, bump: 0.3, dark: 0.12 },
    grime: { i: 14, weave: [38, 38, 0.26], grain: [5, 0.44], blotch: [1.6, 0.56], rough: 0.97, bump: 1.1, dark: 0.48 },
    glass: { i: 15, weave: [0, 0, 0], grain: [60, 0.06], blotch: [12.0, 0.08], rough: 0.10, bump: 0.2, dark: 0.06, metal: 0.2 },
  };

  function buildAtlas() {
    const albedo = document.createElement("canvas");
    const normal = document.createElement("canvas");
    const rough = document.createElement("canvas");
    for (const c of [albedo, normal, rough]) { c.width = ATLAS_SIZE; c.height = ATLAS_SIZE; }
    const aData = albedo.getContext("2d").createImageData(ATLAS_SIZE, ATLAS_SIZE);
    const nData = normal.getContext("2d").createImageData(ATLAS_SIZE, ATLAS_SIZE);
    const rData = rough.getContext("2d").createImageData(ATLAS_SIZE, ATLAS_SIZE);

    const height = new Float32Array(TILE_PX * TILE_PX);

    for (const spec of Object.values(TILES)) {
      const tx = (spec.i % ATLAS_GRID) * TILE_PX;
      const ty = Math.floor(spec.i / ATLAS_GRID) * TILE_PX;
      const seedOffset = spec.i * 137.7;

      for (let y = 0; y < TILE_PX; y += 1) {
        for (let x = 0; x < TILE_PX; x += 1) {
          const u = x / TILE_PX;
          const v = y / TILE_PX;
          let h = 0.5;
          // Weave: two out-of-phase sine ridges. Tiles seamlessly
          // because the frequencies are whole cycles across the tile.
          if (spec.weave[2] > 0) {
            h += Math.sin(u * TAU * spec.weave[0]) * spec.weave[2] * 0.5;
            h += Math.sin(v * TAU * spec.weave[1]) * spec.weave[2] * 0.5;
          }
          h += noise(u * spec.grain[0] + seedOffset, v * spec.grain[0] - seedOffset) * spec.grain[1];
          const blotch = noise.fbm(u * spec.blotch[0] + seedOffset, v * spec.blotch[0] + seedOffset, 3);
          h += blotch * spec.blotch[1];
          if (spec.seams) {
            // A stitched flap edge. One hard horizontal line with a
            // dotted thread run beside it does more for "this is a
            // pouch" than any amount of extra noise.
            const d = Math.abs(v - 0.30);
            if (d < 0.012) h -= 0.42;
            if (Math.abs(v - 0.345) < 0.02 && (Math.floor(u * 34) % 2 === 0)) h += 0.30;
          }
          height[y * TILE_PX + x] = clamp01(h);
        }
      }

      for (let y = 0; y < TILE_PX; y += 1) {
        for (let x = 0; x < TILE_PX; x += 1) {
          const h = height[y * TILE_PX + x];
          const px = ((ty + y) * ATLAS_SIZE + (tx + x)) * 4;

          // Albedo is a light multiplier: the part's vertex colour is
          // the actual hue, so one tile serves every kit colour.
          const shade = 1 - spec.dark * (1 - h);
          const value = clamp(Math.round(shade * 255), 0, 255);
          aData.data[px] = value; aData.data[px + 1] = value; aData.data[px + 2] = value;
          aData.data[px + 3] = 255;

          // Sobel on the height field, wrapped so tiles stay seamless.
          const xl = height[y * TILE_PX + ((x - 1 + TILE_PX) % TILE_PX)];
          const xr = height[y * TILE_PX + ((x + 1) % TILE_PX)];
          const yd = height[((y - 1 + TILE_PX) % TILE_PX) * TILE_PX + x];
          const yu = height[((y + 1) % TILE_PX) * TILE_PX + x];
          const nx = (xl - xr) * spec.bump * 2.2;
          const ny = (yd - yu) * spec.bump * 2.2;
          const nz = 1;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          nData.data[px] = Math.round((nx / len * 0.5 + 0.5) * 255);
          nData.data[px + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
          nData.data[px + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
          nData.data[px + 3] = 255;

          // Green = roughness, blue = metalness (three's convention for
          // a combined map). Crevices read wetter/darker than peaks.
          const r = clamp01(spec.rough * (0.86 + 0.28 * h));
          rData.data[px] = 255;
          rData.data[px + 1] = Math.round(r * 255);
          rData.data[px + 2] = Math.round((spec.metal || 0) * 255);
          rData.data[px + 3] = 255;
        }
      }
    }

    albedo.getContext("2d").putImageData(aData, 0, 0);
    normal.getContext("2d").putImageData(nData, 0, 0);
    rough.getContext("2d").putImageData(rData, 0, 0);

    const make = (canvas, srgb) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = Math.min(8, settings.q.anisotropy || 4);
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    };

    return { map: make(albedo, true), normalMap: make(normal, false), roughnessMap: make(rough, false) };
  }

  const atlas = buildAtlas();

  /** One material for every soldier on the map. Colour comes from the
   *  vertex stream, physical response from the atlas.
   *
   *  There used to be an `envMapIntensity: 0.55` here, defended at
   *  length: the sky probe supplies most of the light in this world, so
   *  a soldier answering all of it comes out the same value on every
   *  surface - a tan cut-out with no form. Holding him back off the
   *  ambient was supposed to make the sun dominant ON HIM and drop him a
   *  stop below the sand, which is indeed where a figure has to sit.
   *
   *  The reasoning is sound and the knob was **inert**. On Three r180
   *  `envMapIntensity` scales nothing unless the material owns an
   *  `envMap`; inheriting `scene.environment` means only
   *  `scene.environmentIntensity` applies. Removed rather than left as a
   *  comment describing an effect that never happened.
   *
   *  If soldiers do read flat against the sand, the argument above is
   *  still the right one and it needs a live lever: assign
   *  `material.envMap = scene.environment` and own re-assigning it when
   *  sky.js regenerates the probe (viewmodel.js does exactly this), or
   *  darken the atlas. Measure the value gap against the sand first. */
  const bodyMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: atlas.map,
    normalMap: atlas.normalMap,
    roughnessMap: atlas.roughnessMap,
    metalnessMap: atlas.roughnessMap,
    roughness: 1.0,
    metalness: 1.0,
    /* No envMapIntensity. It is inert on a material that only inherits
       scene.environment - see the measured sweep in the agent brief, and
       the longer note in vehicles.js where five of them were removed. */
    dithering: true,
  });
  bodyMaterial.name = "bs-soldier";
  bodyMaterial.normalScale.setScalar(0.9);

  /* Live lighting hints for the soldier shader. Written every frame by
   * update() from the render module's own lights, so the rim tracks the
   * sky through a sunset instead of being a fixed blue. */
  const bodyUniforms = {
    uSkyColour: { value: new THREE.Color(0xbcd4f2) },
    uSunColour: { value: new THREE.Color(0xffe9cc) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uRim: { value: 0.85 },
    uSkyOcclude: { value: 0.62 },
  };

  /**
   * Form, on top of what the standard material gives.
   *
   * Three additions, all of them about VALUE rather than colour:
   *
   *  - sky occlusion. Ambient here is a sky probe, which arrives from
   *    above; a surface pointing at the ground should not receive it in
   *    full. Weighting the indirect diffuse by the world normal's
   *    upness is what puts a gradient down the front of a torso and
   *    darkness under a helmet brim.
   *  - baked occlusion (vertex alpha of the colour stream, see emit).
   *  - a rim from the sky dome. A silhouette that shares an edge value
   *    with the sand behind it reads as a decal; one bright pixel of
   *    sky wrapping the shoulder reads as a body. Deliberately keyed to
   *    the UPPER hemisphere only - a rim all the way round is the tell
   *    of a cheap fresnel.
   */
  bodyMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, bodyUniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        // Occlusion, not brightness: an unbound attribute reads as 0 in
        // WebGL, so this way a geometry that forgot to supply it comes
        // out unoccluded rather than black.
        attribute float aOcclusion;
        varying vec3 vBsWorldNormal;
        varying float vBsAo;
      `)
      .replace("#include <skinnormal_vertex>", `
        #include <skinnormal_vertex>
        // AFTER skinning, so the shoulder's normal is the posed one.
        vBsWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        // Capped: the three occlusion terms can sum to 1 in a deep
        // corner, and a fragment that receives no ambient at all in a
        // scene where ambient is most of the light is a black hole in
        // the middle of a soldier.
        vBsAo = 1.0 - clamp(aOcclusion, 0.0, 1.0) * 0.76;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        uniform vec3  uSkyColour;
        uniform vec3  uSunColour;
        uniform vec3  uSunDir;
        uniform float uRim;
        uniform float uSkyOcclude;
        varying vec3 vBsWorldNormal;
        varying float vBsAo;
      `)
      .replace("#include <lights_fragment_end>", `
        #include <lights_fragment_end>
        {
          vec3 bsWN = normalize(vBsWorldNormal);
          float bsUp = clamp(bsWN.y * 0.5 + 0.5, 0.0, 1.0);
          // Sky-weighted ambient. mix() rather than a multiply so an
          // up-facing surface is allowed to gain a little, which is what
          // stops the whole figure just going darker.
          float bsSky = mix(1.0 - uSkyOcclude, 1.0 + uSkyOcclude * 0.22, bsUp);
          reflectedLight.indirectDiffuse *= bsSky * vBsAo;
          reflectedLight.indirectSpecular *= bsSky;

          // Sky rim. vViewPosition points from the fragment to the eye.
          float bsFres = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float bsRim = pow(bsFres, 3.2) * clamp(bsWN.y * 0.7 + 0.42, 0.0, 1.0);
          // A grazing surface that also faces the sun gets a hotter rim,
          // which is what a backlit soldier actually does.
          float bsBack = clamp(dot(bsWN, -uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          reflectedLight.indirectDiffuse +=
            uRim * bsRim * vBsAo * mix(uSkyColour, uSunColour, bsBack * 0.65)
            * (0.55 + 0.85 * bsBack);
        }
      `);

    bodyMaterial.userData.shader = shader;
  };
  bodyMaterial.customProgramCacheKey = () => "bs-soldier-v2";

  /* ================================================================
     primitives
     ================================================================ */

  const _mat = new THREE.Matrix4();
  const _nrmMat = new THREE.Matrix3();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3(1, 1, 1);
  const _eul = new THREE.Euler();
  const _v = new THREE.Vector3();

  /**
   * A tapered, optionally offset box. Real kit is never a cuboid, and
   * a taper of even 15% is the difference between a soldier and a
   * stack of crates at 40m.
   *
   * `pivot` places the origin: "top" for limbs that hang from a joint,
   * "centre" for everything else.
   */
  function boxGeo(w, h, d, options = {}) {
    const topScale = options.topScale ?? 1;
    const bottomScale = options.bottomScale ?? 1;
    const shear = options.shear ?? 0;           // +z offset of the bottom face
    const pivot = options.pivot || "centre";
    const y0 = pivot === "top" ? -h : pivot === "bottom" ? 0 : -h * 0.5;
    const y1 = y0 + h;

    const tw = w * 0.5 * topScale; const td = d * 0.5 * topScale;
    const bw = w * 0.5 * bottomScale; const bd = d * 0.5 * bottomScale;

    const v = [
      [-tw, y1, -td], [tw, y1, -td], [tw, y1, td], [-tw, y1, td],
      [-bw + 0, y0, -bd + shear], [bw, y0, -bd + shear], [bw, y0, bd + shear], [-bw, y0, bd + shear],
    ];
    const faces = [
      [0, 1, 2, 3], [7, 6, 5, 4],
      [4, 5, 1, 0], [5, 6, 2, 1],
      [6, 7, 3, 2], [7, 4, 0, 3],
    ];
    return quadMesh(v, faces);
  }

  /** Build flat-shaded geometry from a vertex list and quad faces. */
  function quadMesh(v, faces) {
    const positions = []; const normals = []; const uvs = []; const indices = [];
    let index = 0;
    const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const face of faces) {
      a.fromArray(v[face[0]]); b.fromArray(v[face[1]]); c.fromArray(v[face[2]]);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      for (let i = 0; i < 4; i += 1) {
        positions.push(v[face[i]][0], v[face[i]][1], v[face[i]][2]);
        normals.push(n.x, n.y, n.z);
        uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      }
      indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
      index += 4;
    }
    return { positions, normals, uvs, indices };
  }

  /** Half-ellipsoid, smooth shaded. The helmet, the shoulder caps and
   *  the knee pads are all this. */
  function domeGeo(rx, ry, rz, segs = 10, rings = 5, phiEnd = Math.PI * 0.52) {
    const positions = []; const normals = []; const uvs = []; const indices = [];
    for (let r = 0; r <= rings; r += 1) {
      const phi = (r / rings) * phiEnd;
      for (let s = 0; s <= segs; s += 1) {
        const theta = (s / segs) * TAU;
        const sx = Math.sin(phi) * Math.cos(theta);
        const sy = Math.cos(phi);
        const sz = Math.sin(phi) * Math.sin(theta);
        positions.push(sx * rx, sy * ry, sz * rz);
        _v.set(sx / rx, sy / ry, sz / rz).normalize();
        normals.push(_v.x, _v.y, _v.z);
        uvs.push(s / segs, r / rings);
      }
    }
    for (let r = 0; r < rings; r += 1) {
      for (let s = 0; s < segs; s += 1) {
        const i0 = r * (segs + 1) + s;
        const i1 = i0 + segs + 1;
        indices.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
      }
    }
    return { positions, normals, uvs, indices };
  }

  /** Cylinder with optional caps. Barrels, antennas, canteens. */
  function cylGeo(rTop, rBottom, h, segs = 8, options = {}) {
    const positions = []; const normals = []; const uvs = []; const indices = [];
    const pivot = options.pivot || "centre";
    const y1 = pivot === "top" ? 0 : pivot === "bottom" ? h : h * 0.5;
    const y0 = y1 - h;
    for (let s = 0; s <= segs; s += 1) {
      const theta = (s / segs) * TAU;
      const cx = Math.cos(theta); const cz = Math.sin(theta);
      positions.push(cx * rTop, y1, cz * rTop);
      _v.set(cx, (rBottom - rTop) / h, cz).normalize();
      normals.push(_v.x, _v.y, _v.z);
      uvs.push(s / segs, 0);
      positions.push(cx * rBottom, y0, cz * rBottom);
      normals.push(_v.x, _v.y, _v.z);
      uvs.push(s / segs, 1);
    }
    for (let s = 0; s < segs; s += 1) {
      const i0 = s * 2;
      indices.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
    }
    if (options.caps !== false) {
      for (const [y, r, ny] of [[y1, rTop, 1], [y0, rBottom, -1]]) {
        const base = positions.length / 3;
        positions.push(0, y, 0); normals.push(0, ny, 0); uvs.push(0.5, 0.5);
        for (let s = 0; s <= segs; s += 1) {
          const theta = (s / segs) * TAU;
          positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
          normals.push(0, ny, 0);
          uvs.push(0.5 + Math.cos(theta) * 0.5, 0.5 + Math.sin(theta) * 0.5);
        }
        for (let s = 0; s < segs; s += 1) {
          if (ny > 0) indices.push(base, base + 1 + s + 1, base + 1 + s);
          else indices.push(base, base + 1 + s, base + 1 + s + 1);
        }
      }
    }
    return { positions, normals, uvs, indices };
  }

  /* ================================================================
     rig
     ================================================================ */

  const BONE_ORDER = [
    "hips", "spine", "chest", "neck", "head",
    "shoulderL", "elbowL", "handL",
    "shoulderR", "elbowR", "handR",
    "hipL", "kneeL", "ankleL", "toeL",
    "hipR", "kneeR", "ankleR", "toeR",
  ];

  function buildSkeleton() {
    const bones = {};
    const list = [];
    const make = (name, parent, x, y, z) => {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.set(x, y, z);
      if (parent) parent.add(bone);
      bones[name] = bone;
      return bone;
    };

    make("hips", null, 0, SEG.hipY, 0);
    make("spine", bones.hips, 0, SEG.spineY, 0);
    make("chest", bones.spine, 0, SEG.chestY, 0);
    make("neck", bones.chest, 0, SEG.neckY, 0);
    make("head", bones.neck, 0, SEG.headY, 0);

    for (const side of [-1, 1]) {
      const k = side < 0 ? "L" : "R";
      make(`shoulder${k}`, bones.chest, side * SEG.shoulderX, SEG.shoulderY, 0);
      make(`elbow${k}`, bones[`shoulder${k}`], 0, -SEG.upperArm, 0);
      make(`hand${k}`, bones[`elbow${k}`], 0, -SEG.foreArm, 0);
      make(`hip${k}`, bones.hips, side * SEG.hipX, -SEG.hipDrop, 0);
      make(`knee${k}`, bones[`hip${k}`], 0, -SEG.thigh, 0);
      make(`ankle${k}`, bones[`knee${k}`], 0, -SEG.shin, 0);
      make(`toe${k}`, bones[`ankle${k}`], 0, -SEG.ankleHeight, -0.11);
    }

    for (const name of BONE_ORDER) list.push(bones[name]);
    return { bones, list };
  }

  /* ================================================================
     kit assembly
     ================================================================ */

  /** Per-soldier variation, deterministic from a seed so a given bot
   *  looks the same every time the map is generated. */
  function rollVariant(team, seed) {
    const kit = TEAM_KIT[team] || TEAM_KIT[1];
    const r = makeRng((seed ^ 0x9e3779b9) >>> 0);
    const tint = (hex, amount) => {
      const c = new THREE.Color(hex);
      const f = 1 + (r() - 0.5) * amount;
      c.multiplyScalar(f);
      // Small hue drift too, or a squad of eight reads as one colour
      // sampled eight times.
      c.offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * 0.10, 0);
      return c;
    };

    const headgear = r.pick(kit.headgear);
    return {
      kit,
      r,
      fatigue: tint(r.pick(kit.fatigue), 0.22),
      fatigueAlt: tint(r.pick(kit.fatigue), 0.24),
      vest: tint(r.pick(kit.vest), 0.18),
      helmet: tint(r.pick(kit.helmet), 0.16),
      boot: tint(r.pick(kit.boot), 0.20),
      glove: tint(r.pick(kit.glove), 0.16),
      skin: tint(r.pick(kit.skin), 0.14),
      accent: new THREE.Color(kit.accent),
      dark: new THREE.Color(0x322e28),
      steel: new THREE.Color(0x777268),
      headgear,
      pouches: r.int(2, 4),
      pack: r.chance(kit.packChance),
      kneePads: r.chance(kit.kneePadChance),
      goggles: headgear !== "wrap" && r.chance(kit.gogglesChance),
      antenna: r.chance(kit.antennaChance),
      sleeves: r.chance(kit.sleeveChance),      // rolled sleeves -> bare forearms
      holster: r.chance(0.4),
      slungSecondary: r.chance(0.28),
      grenades: r.int(0, 2),
      optic: r.chance(0.45),
      bulk: r.range(0.94, 1.09),                // body mass, so not all one build
      height: r.range(0.96, 1.045),
      packCloth: tint(r.pick(kit.pack), 0.2),
    };
  }

  /**
   * Accumulates every part into flat arrays. Writing straight into
   * arrays and merging once is roughly ten times faster than building
   * forty BufferGeometries and calling a merge utility, which matters
   * because this runs forty times behind a loading bar.
   */
  function makeAccumulator() {
    return {
      position: [], normal: [], uv: [], color: [], occlusion: [],
      skinIndex: [], skinWeight: [], index: [], count: 0,
    };
  }

  /**
   * Baked occlusion, evaluated in the bind pose.
   *
   * Real-time AO is not available here (the SSAO pass runs on the
   * composed frame and is far too coarse to find an armpit), and the
   * engine's direct sun is a small fraction of its total light, so a
   * soldier with no baked term comes out as one flat value from boots
   * to helmet - which is exactly the "unlit cut-out" fault. Three cheap
   * geometric terms put the range back and cost nothing at runtime:
   *
   *   under    a downward-facing face is under something: the helmet
   *            brim, the vest lip, the pack, the boot arch
   *   cavity   a face whose normal points back at the body's own axis
   *            is in an armpit, a crotch or the gap behind a pouch
   *   ground   everything near the boots sits inside the figure's own
   *            occlusion cone, and the sand bounce cannot fill it
   *
   * `parentOcclusion` lets a part declare itself buried regardless of
   * geometry - webbing under a plate carrier, for instance.
   */
  function occlusionAt(px, py, pz, nx, ny, nz, bias) {
    const under = clamp01(-ny);
    const radius = Math.hypot(px, pz);
    const inward = clamp01(-(nx * px + nz * pz) / (radius || 1e-5));
    const cavity = inward * (1 - smoothstep(radius / 0.30));
    const ground = 1 - smoothstep(py / 1.05);
    return clamp01(0.40 * under + 0.34 * cavity + 0.26 * ground + (bias || 0));
  }

  function emit(acc, geo, boneIndex, colour, tileName, uvScale, variantRng, occBias) {
    const tile = TILES[tileName] || TILES.plain;
    const tx = (tile.i % ATLAS_GRID) / ATLAS_GRID;
    const ty = Math.floor(tile.i / ATLAS_GRID) / ATLAS_GRID;
    const span = 1 / ATLAS_GRID - TILE_INSET * 2;
    const sub = clamp(uvScale ?? 1, 0.2, 1);
    // A random sub-rect per part: constant texel density AND no two
    // pieces of webbing showing the same patch of weave.
    const ox = variantRng ? variantRng() * (1 - sub) : 0;
    const oy = variantRng ? variantRng() * (1 - sub) : 0;

    const base = acc.count;
    const n = geo.positions.length / 3;
    for (let i = 0; i < n; i += 1) {
      _v.set(geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]);
      _v.applyMatrix4(_mat);
      const px = _v.x; const py = _v.y; const pz = _v.z;
      acc.position.push(px, py, pz);
      _v.set(geo.normals[i * 3], geo.normals[i * 3 + 1], geo.normals[i * 3 + 2]);
      _v.applyMatrix3(_nrmMat).normalize();
      acc.normal.push(_v.x, _v.y, _v.z);
      acc.occlusion.push(occlusionAt(px, py, pz, _v.x, _v.y, _v.z, occBias));
      acc.uv.push(
        tx + TILE_INSET + (ox + geo.uvs[i * 2] * sub) * span,
        ty + TILE_INSET + (oy + geo.uvs[i * 2 + 1] * sub) * span
      );
      acc.color.push(colour.r, colour.g, colour.b);
      acc.skinIndex.push(boneIndex, 0, 0, 0);
      acc.skinWeight.push(1, 0, 0, 0);
    }
    for (let i = 0; i < geo.indices.length; i += 1) acc.index.push(base + geo.indices[i]);
    acc.count += n;
  }

  /**
   * Build one soldier.
   *
   * `options.seed` drives every variation roll. bots.js passes a hash
   * of the bot id so a given soldier is stable across a reload.
   */
  let buildCounter = 0;
  function build(team, options = {}) {
    const seed = (options.seed ?? (ctx.seed ^ (buildCounter += 0x9e37))) >>> 0;
    const V = rollVariant(team, seed);
    const vr = V.r;

    const { bones, list } = buildSkeleton();
    const root = new THREE.Group();
    root.name = "soldier";
    root.add(bones.hips);
    root.updateMatrixWorld(true);

    const boneIndex = {};
    list.forEach((bone, i) => { boneIndex[bone.name] = i; });

    const acc = makeAccumulator();

    /** Place a primitive in a bone's local space. */
    const part = (boneName, geo, colour, tileName, opts = {}) => {
      const bone = bones[boneName];
      _pos.set(opts.x || 0, opts.y || 0, opts.z || 0);
      _eul.set(opts.rx || 0, opts.ry || 0, opts.rz || 0, "YXZ");
      _quat.setFromEuler(_eul);
      _scl.set(opts.sx || 1, opts.sy || 1, opts.sz || 1);
      _mat.compose(_pos, _quat, _scl);
      _mat.premultiply(bone.matrixWorld);
      _nrmMat.getNormalMatrix(_mat);
      emit(acc, geo, boneIndex[boneName], colour, tileName, opts.uv ?? 1, vr, opts.occ);
    };

    const B = V.bulk;
    const shoulderW = 0.415 * B;

    /* ---------------------------- torso ---------------------------- */

    part("hips", boxGeo(0.315 * B, 0.20, 0.225 * B, { topScale: 1.02, bottomScale: 0.94, pivot: "centre" }),
      V.fatigue, "cloth", { y: -0.02, uv: 0.9 });
    // Belt: a hard dark line at the waist. Reads at 80m as "this thing
    // has a waist", which a single tapered tube never does.
    part("hips", boxGeo(0.325 * B, 0.055, 0.235 * B), V.dark, "nylon", { y: 0.055, uv: 0.5 });
    part("hips", boxGeo(0.075, 0.06, 0.03), V.steel, "metal", { y: 0.055, z: -0.118 * B, uv: 0.3 });

    // The fatigue shell of the torso is almost entirely behind the
    // carrier and the webbing; only the flanks are ever open sky.
    part("spine", boxGeo(0.355 * B, 0.26, 0.235 * B, { topScale: 1.06, bottomScale: 0.93, pivot: "bottom" }),
      V.fatigue, "cloth", { y: -0.02, uv: 1, occ: 0.16 });
    part("chest", boxGeo(shoulderW, 0.30, 0.25 * B, { topScale: 1.0, bottomScale: 0.88, pivot: "bottom" }),
      V.fatigue, "cloth", { y: -0.06, uv: 1, occ: 0.16 });

    // Plate carrier: front and back slabs plus a cummerbund, proud of
    // the torso so the edge catches light and the silhouette thickens.
    part("chest", boxGeo(0.335 * B, 0.36, 0.075, { topScale: 0.92, bottomScale: 0.98 }),
      V.vest, "cordura", { y: 0.02, z: -0.125 * B, uv: 1 });
    part("chest", boxGeo(0.345 * B, 0.40, 0.075, { topScale: 0.92, bottomScale: 0.98 }),
      V.vest, "cordura", { y: 0.0, z: 0.128 * B, uv: 1 });
    part("chest", boxGeo(0.36 * B, 0.13, 0.27 * B, { topScale: 1.0, bottomScale: 0.97 }),
      V.vest, "nylon", { y: -0.16, uv: 0.7 });
    // Shoulder yokes over the traps - the detail that makes a vest read
    // as a vest rather than a printed rectangle.
    for (const side of [-1, 1]) {
      part("chest", boxGeo(0.10, 0.09, 0.20, { topScale: 0.9 }),
        V.vest, "nylon", { x: side * 0.115 * B, y: 0.155, rz: side * 0.16, uv: 0.45 });
    }

    // Front pouches, stacked and offset so the row is not a grid.
    const pouchCount = V.pouches;
    for (let i = 0; i < pouchCount; i += 1) {
      const x = (i - (pouchCount - 1) * 0.5) * 0.105 * B;
      const h = vr.range(0.115, 0.155);
      part("chest", boxGeo(0.092, h, 0.058, { topScale: 0.95, bottomScale: 0.9 }),
        V.vest, "pouch", { x, y: vr.range(-0.05, 0.01), z: -0.168 * B, uv: 0.55 });
    }
    // Admin pouch high on the left, a radio on the right: asymmetry is
    // what stops a squad reading as one model mirrored.
    part("chest", boxGeo(0.115, 0.10, 0.05), V.vest, "pouch",
      { x: -0.115 * B, y: 0.10, z: -0.163 * B, rz: 0.1, uv: 0.5 });
    part("chest", boxGeo(0.075, 0.135, 0.055), V.dark, "polymer",
      { x: 0.125 * B, y: 0.085, z: -0.16 * B, uv: 0.45 });
    part("chest", cylGeo(0.006, 0.008, 0.20, 5, { pivot: "bottom" }), V.dark, "polymer",
      { x: 0.125 * B, y: 0.15, z: -0.15 * B, rx: -0.22, uv: 0.3 });

    for (let i = 0; i < V.grenades; i += 1) {
      part("chest", cylGeo(0.026, 0.030, 0.085, 6), V.dark, "metal",
        { x: (i === 0 ? -0.16 : 0.16) * B, y: -0.10, z: -0.15 * B, uv: 0.3 });
    }

    // Sling across the chest. The rifle is in the hands, so the strap
    // is bound to the torso and simply ends at the shoulder - a sling
    // that actually connected would stretch every time an arm moved.
    part("chest", boxGeo(0.05, 0.42, 0.016), V.dark, "nylon",
      { x: -0.02, y: 0.0, z: -0.145 * B, rz: 0.62, uv: 0.4 });

    // Team accent: shoulder brassard plus a helmet band. Small, but it
    // is what makes a contact at 60m unambiguous before the shooting.
    for (const side of [-1, 1]) {
      part(`shoulder${side < 0 ? "L" : "R"}`, boxGeo(0.125, 0.075, 0.125, { topScale: 1.02 }),
        V.accent, "cloth", { y: -0.115, uv: 0.4 });
    }

    if (V.pack) {
      const packH = vr.range(0.30, 0.42);
      const packD = vr.range(0.13, 0.20);
      part("chest", boxGeo(0.31 * B, packH, packD, { topScale: 0.92, bottomScale: 0.96 }),
        V.packCloth, "cordura", { y: 0.02, z: 0.175 * B + packD * 0.5, uv: 1 });
      part("chest", cylGeo(0.055, 0.055, 0.34, 7), V.packCloth, "cordura",
        { y: 0.02 + packH * 0.5 + 0.04, z: 0.19 * B + packD * 0.5, rz: Math.PI * 0.5, uv: 0.6 });
      part("chest", boxGeo(0.30 * B, 0.03, 0.03), V.dark, "nylon",
        { y: 0.02 + packH * 0.2, z: 0.18 * B + packD, uv: 0.3 });
      if (V.antenna) {
        // Two bent segments. A dead-straight whip looks like a pole.
        part("chest", cylGeo(0.008, 0.011, 0.40, 5, { pivot: "bottom" }), V.dark, "polymer",
          { x: 0.10, y: 0.02 + packH * 0.5, z: 0.20 * B + packD, rx: 0.16, rz: -0.1, uv: 0.3 });
        part("chest", cylGeo(0.004, 0.008, 0.34, 5, { pivot: "bottom" }), V.dark, "polymer",
          { x: 0.062, y: 0.02 + packH * 0.5 + 0.39, z: 0.235 * B + packD, rx: 0.34, rz: -0.22, uv: 0.3 });
      }
    }

    if (V.slungSecondary) {
      // A second weapon across the back. Pure silhouette value.
      part("chest", boxGeo(0.05, 0.62, 0.10, { topScale: 0.8, bottomScale: 0.7 }), V.dark, "polymer",
        { x: 0.02, y: -0.02, z: 0.20 * B + (V.pack ? 0.20 : 0.06), rz: 0.9, rx: 0.12, uv: 0.7 });
      part("chest", cylGeo(0.014, 0.016, 0.30, 6), V.steel, "gunmetal",
        { x: -0.24, y: 0.20, z: 0.20 * B + (V.pack ? 0.20 : 0.06), rz: 0.9, uv: 0.4 });
    }

    /* ---------------------------- head ---------------------------- */

    // The neck lives at the bottom of a collar and under a jaw; it is
    // the darkest skin on a real soldier and the eye uses it to read
    // the head as a separate volume from the shoulders.
    part("neck", cylGeo(0.052, 0.058, 0.10, 7, { caps: false }), V.skin, "skin",
      { y: 0.02, uv: 0.3, occ: 0.5 });
    part("chest", boxGeo(0.20 * B, 0.06, 0.20 * B, { topScale: 0.86 }), V.fatigue, "cloth",
      { y: SEG.neckY - 0.02, uv: 0.4, occ: 0.3 });

    // The whole face sits under a brim. Baking that in is worth more
    // than any amount of extra facial geometry.
    part("head", boxGeo(0.165, 0.215, 0.20, { topScale: 0.92, bottomScale: 0.80, pivot: "bottom" }),
      V.skin, "skin", { y: -0.01, uv: 0.5, occ: 0.24 });
    // Brow and jaw. Two extra boxes turn a cube into a face at 4m.
    part("head", boxGeo(0.155, 0.035, 0.045), V.skin, "skin",
      { y: 0.115, z: -0.095, uv: 0.25, occ: 0.34 });
    part("head", boxGeo(0.115, 0.075, 0.09, { topScale: 1.0, bottomScale: 0.78 }),
      V.skin, "skin", { y: 0.03, z: -0.075, uv: 0.3, occ: 0.20 });

    if (V.headgear === "helmet") {
      // MICH-ish profile: an ellipsoid dome, a low brim ring that
      // flares at the back, and cut-away ears. The rear flare is the
      // single most recognisable part of a modern helmet at distance.
      part("head", domeGeo(0.128, 0.125, 0.138, 12, 5), V.helmet, "cover", { y: 0.075, uv: 1 });
      part("head", boxGeo(0.245, 0.048, 0.275, { topScale: 1.0, bottomScale: 0.92 }),
        V.helmet, "cover", { y: 0.088, z: 0.012, uv: 0.8 });
      part("head", boxGeo(0.20, 0.055, 0.09, { topScale: 1.0, bottomScale: 0.85 }),
        V.helmet, "cover", { y: 0.062, z: 0.115, rx: -0.22, uv: 0.5 });
      for (const side of [-1, 1]) {
        part("head", boxGeo(0.035, 0.085, 0.145, { bottomScale: 0.8 }),
          V.helmet, "cover", { x: side * 0.116, y: 0.055, z: 0.01, rz: side * 0.1, uv: 0.4 });
        // Chin strap: helmet ear to chin, plus the cup.
        part("head", boxGeo(0.016, 0.135, 0.028), V.dark, "nylon",
          { x: side * 0.105, y: -0.015, z: 0.012, rz: side * 0.30, rx: -0.16, uv: 0.25 });
        part("head", boxGeo(0.016, 0.115, 0.026), V.dark, "nylon",
          { x: side * 0.10, y: -0.02, z: -0.03, rz: side * 0.26, rx: 0.28, uv: 0.25 });
      }
      part("head", boxGeo(0.075, 0.05, 0.03), V.dark, "nylon", { y: -0.075, z: -0.055, uv: 0.25 });
      part("head", boxGeo(0.045, 0.035, 0.05), V.dark, "polymer", { y: 0.115, z: -0.125, uv: 0.3 });
      part("head", boxGeo(0.245, 0.022, 0.28), V.accent, "cloth", { y: 0.112, z: 0.012, uv: 0.4 });
    } else if (V.headgear === "wrap") {
      // Shemagh: a bulkier, rounder mass with a tail over one shoulder.
      part("head", domeGeo(0.135, 0.128, 0.142, 10, 4), V.fatigueAlt, "wrap", { y: 0.062, uv: 1 });
      part("head", boxGeo(0.235, 0.10, 0.245, { topScale: 1.0, bottomScale: 0.9 }),
        V.fatigueAlt, "wrap", { y: 0.052, uv: 0.8 });
      part("head", boxGeo(0.20, 0.11, 0.055), V.fatigueAlt, "wrap", { y: -0.035, z: 0.10, rx: 0.3, uv: 0.5 });
      part("chest", boxGeo(0.16, 0.26, 0.05, { topScale: 0.8, bottomScale: 1.2 }),
        V.fatigueAlt, "wrap", { x: -0.12, y: SEG.neckY - 0.10, z: 0.09, rz: 0.18, uv: 0.7 });
      part("head", boxGeo(0.19, 0.09, 0.14), V.accent, "wrap", { y: -0.045, z: -0.045, rx: 0.15, uv: 0.5 });
    } else if (V.headgear === "boonie") {
      part("head", domeGeo(0.115, 0.10, 0.118, 10, 4), V.helmet, "cloth", { y: 0.07, uv: 0.8 });
      part("head", cylGeo(0.235, 0.245, 0.028, 12), V.helmet, "cloth", { y: 0.075, rx: 0.04, uv: 0.9 });
      part("head", boxGeo(0.20, 0.03, 0.21), V.accent, "cloth", { y: 0.09, uv: 0.4 });
    } else {
      part("head", domeGeo(0.115, 0.085, 0.12, 10, 4), V.fatigueAlt, "cloth", { y: 0.075, uv: 0.7 });
      part("head", boxGeo(0.155, 0.022, 0.10), V.fatigueAlt, "cloth", { y: 0.075, z: -0.125, rx: -0.12, uv: 0.4 });
    }

    if (V.goggles) {
      part("head", boxGeo(0.195, 0.055, 0.055, { topScale: 0.95 }), V.dark, "glass",
        { y: V.headgear === "helmet" ? 0.115 : 0.10, z: -0.085, rx: -0.08, uv: 0.5 });
      part("head", boxGeo(0.235, 0.032, 0.235), V.dark, "nylon",
        { y: V.headgear === "helmet" ? 0.112 : 0.098, uv: 0.4 });
    }

    /* ---------------------------- arms ---------------------------- */

    for (const side of [-1, 1]) {
      const k = side < 0 ? "L" : "R";
      part(`shoulder${k}`, domeGeo(0.075, 0.06, 0.078, 8, 3), V.fatigue, "cloth", { y: 0.01, uv: 0.4 });
      part(`shoulder${k}`, boxGeo(0.108 * B, SEG.upperArm, 0.108 * B, { topScale: 1.05, bottomScale: 0.86, pivot: "top" }),
        V.fatigue, "cloth", { uv: 0.7 });

      const bareArm = V.sleeves;
      if (bareArm) {
        part(`elbow${k}`, boxGeo(0.096, 0.035, 0.10), V.fatigue, "cloth", { y: 0.012, uv: 0.3 });
      }
      part(`elbow${k}`, boxGeo(0.094, SEG.foreArm, 0.096, { topScale: 1.02, bottomScale: 0.80, pivot: "top" }),
        bareArm ? V.skin : V.fatigue, bareArm ? "skin" : "cloth", { uv: 0.6 });
      if (!bareArm && V.kneePads) {
        part(`elbow${k}`, domeGeo(0.055, 0.05, 0.065, 7, 3), V.dark, "rubber",
          { y: -0.02, z: -0.045, rx: 1.5, uv: 0.3 });
      }
      // Glove: palm plus a stubby thumb ridge, so the hand is not a die.
      part(`hand${k}`, boxGeo(0.078, 0.115, 0.098, { topScale: 1.0, bottomScale: 0.82, pivot: "top" }),
        V.glove, "leather", { uv: 0.35 });
      part(`hand${k}`, boxGeo(0.03, 0.06, 0.055), V.glove, "leather",
        { x: side * -0.04, y: -0.03, z: -0.035, rz: side * 0.3, uv: 0.25 });
    }

    /* ---------------------------- legs ---------------------------- */

    for (const side of [-1, 1]) {
      const k = side < 0 ? "L" : "R";
      part(`hip${k}`, boxGeo(0.152 * B, SEG.thigh, 0.155 * B, { topScale: 1.06, bottomScale: 0.82, pivot: "top" }),
        V.fatigue, "cloth", { uv: 0.9 });
      // Cargo pocket. A soldier's thigh is not smooth.
      part(`hip${k}`, boxGeo(0.10, 0.13, 0.045), V.fatigue, "pouch",
        { x: side * 0.075 * B, y: -0.20, rz: side * 0.06, uv: 0.5 });
      if (V.holster && side > 0) {
        part(`hip${k}`, boxGeo(0.075, 0.17, 0.09, { bottomScale: 0.8 }), V.dark, "leather",
          { x: 0.085 * B, y: -0.24, rz: 0.08, uv: 0.5 });
        part(`hip${k}`, boxGeo(0.045, 0.10, 0.05), V.dark, "polymer",
          { x: 0.085 * B, y: -0.15, rz: 0.08, uv: 0.3 });
      }

      if (V.kneePads) {
        part(`knee${k}`, domeGeo(0.072, 0.075, 0.085, 8, 3), V.dark, "rubber",
          { y: -0.015, z: -0.06, rx: -1.45, uv: 0.4 });
      }
      part(`knee${k}`, boxGeo(0.125 * B, SEG.shin, 0.135 * B, { topScale: 1.02, bottomScale: 0.84, pivot: "top" }),
        V.fatigue, "cloth", { uv: 0.8 });
      // Boot upper swallows the trouser cuff.
      part(`knee${k}`, boxGeo(0.128, 0.19, 0.145, { topScale: 1.03, bottomScale: 1.0, pivot: "top" }),
        V.boot, "leather", { y: -SEG.shin + 0.19, uv: 0.5 });

      part(`ankle${k}`, boxGeo(0.118, 0.085, 0.255, { topScale: 1.0, bottomScale: 0.95 }),
        V.boot, "leather", { y: -0.035, z: -0.045, uv: 0.6 });
      part(`ankle${k}`, boxGeo(0.125, 0.032, 0.275, { topScale: 1.0, bottomScale: 0.92 }),
        V.dark, "rubber", { y: -0.078, z: -0.048, uv: 0.5 });
      part(`ankle${k}`, boxGeo(0.10, 0.06, 0.075, { topScale: 0.9, bottomScale: 0.8 }),
        V.boot, "leather", { y: -0.04, z: -0.155, rx: 0.18, uv: 0.3 });
    }

    /* --------------------------- weapon --------------------------- */

    // Bound to the right hand so the whole weapon follows the arm. The
    // aim pose then rotates the chest and both arms as one unit, which
    // is what keeps the muzzle and the eyeline agreeing.
    const gunZ = -0.16;
    const gunY = -0.09;
    part("handR", boxGeo(0.052, 0.09, 0.30, { topScale: 1.0, bottomScale: 0.95 }),
      V.dark, "polymer", { y: gunY, z: gunZ, uv: 0.8 });
    part("handR", boxGeo(0.048, 0.075, 0.20, { topScale: 0.92, bottomScale: 0.88 }),
      V.dark, "polymer", { y: gunY + 0.004, z: gunZ - 0.245, uv: 0.6 });
    part("handR", cylGeo(0.011, 0.013, 0.30, 6), V.steel, "gunmetal",
      { y: gunY + 0.012, z: gunZ - 0.44, rx: Math.PI * 0.5, uv: 0.4 });
    part("handR", cylGeo(0.019, 0.016, 0.06, 6), V.steel, "gunmetal",
      { y: gunY + 0.012, z: gunZ - 0.60, rx: Math.PI * 0.5, uv: 0.3 });
    // Magazine, curved forward like a real STANAG.
    part("handR", boxGeo(0.042, 0.21, 0.075, { topScale: 1.0, bottomScale: 0.9, shear: -0.03 }),
      V.dark, "polymer", { y: gunY - 0.13, z: gunZ - 0.055, rx: -0.12, uv: 0.5 });
    // Pistol grip and stock.
    part("handR", boxGeo(0.042, 0.135, 0.06, { bottomScale: 0.85 }),
      V.dark, "polymer", { y: gunY - 0.085, z: gunZ + 0.075, rx: 0.32, uv: 0.4 });
    part("handR", boxGeo(0.05, 0.085, 0.20, { topScale: 0.9, bottomScale: 0.75 }),
      V.dark, "polymer", { y: gunY - 0.005, z: gunZ + 0.245, uv: 0.5 });
    part("handR", boxGeo(0.038, 0.05, 0.075), V.dark, "polymer",
      { y: gunY - 0.045, z: gunZ + 0.32, uv: 0.3 });
    if (V.optic) {
      part("handR", boxGeo(0.038, 0.045, 0.115), V.dark, "gunmetal",
        { y: gunY + 0.075, z: gunZ - 0.10, uv: 0.4 });
      part("handR", cylGeo(0.024, 0.024, 0.10, 7), V.dark, "gunmetal",
        { y: gunY + 0.10, z: gunZ - 0.10, rx: Math.PI * 0.5, uv: 0.3 });
    } else {
      part("handR", boxGeo(0.016, 0.055, 0.02), V.steel, "gunmetal",
        { y: gunY + 0.085, z: gunZ - 0.40, uv: 0.2 });
      part("handR", boxGeo(0.03, 0.05, 0.03), V.steel, "gunmetal",
        { y: gunY + 0.082, z: gunZ + 0.10, uv: 0.2 });
    }

    /* --------------------------- finalise --------------------------- */

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(acc.position, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(acc.normal, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(acc.color, 3));
    geometry.setAttribute("aOcclusion", new THREE.Float32BufferAttribute(acc.occlusion, 1));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(acc.skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(acc.skinWeight, 4));
    geometry.setIndex(acc.index);
    // The bind-pose bounds are wrong once a soldier goes prone or dies,
    // so the sphere is set by hand with room for every pose. A skinned
    // mesh that pops out at the screen edge is worse than the cull it
    // saves.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 1.9);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1.1, -0.2, -1.1), new THREE.Vector3(1.1, 2.0, 1.1)
    );

    const mesh = new THREE.SkinnedMesh(geometry, bodyMaterial);
    mesh.castShadow = Boolean(settings.q.shadows);
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    root.add(mesh);
    root.updateMatrixWorld(true);

    const skeleton = new THREE.Skeleton(list);
    // Explicit identity bind matrix: the rig is authored with the root
    // at the origin, and three recomputes bindMatrixInverse from the
    // live matrixWorld each frame (AttachedBindMode), so this stays
    // correct however the root is moved afterwards.
    mesh.bind(skeleton, new THREE.Matrix4());

    if (V.height !== 1) root.scale.setScalar(V.height);

    return {
      root,
      bones,
      mesh,
      skeleton,
      team,
      variant: V,
      seed,
      /** Live animation state. Owned by `pose`, never by the caller. */
      anim: {
        phase: (seed % 1000) / 1000 * TAU,
        deathT: 0,
        deathVariant: seed % 5,
        recoil: 0,
        recoilVel: 0,
        breathe: (seed % 733) / 733 * TAU,
        lookYaw: 0,
        lookPitch: 0,
        legYaw: 0,
        stanceBlend: 0,
        proneBlend: 0,
        speedSmooth: 0,
        moveAngle: 0,
        lastFiring: 0,
        footY: [0, 0],
        hipBase: SEG.hipY,
        hipOffset: 0,
      },
    };
  }

  /* ================================================================
     animation
     ================================================================ */

  /** A one-sided cosine lobe: 1 at `centre`, 0 beyond `width`. The
   *  shape every gait event (heel strike, toe off, knee flex) is
   *  built from, because it is cheap and has no discontinuity. */
  function lobe(x, centre, width) {
    let d = (x - centre) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    d = Math.abs(d);
    if (d >= width) return 0;
    return Math.cos((d / width) * Math.PI * 0.5);
  }

  /**
   * Two-bone IK, solved in the leg's own sagittal plane.
   *
   * Working in the plane rather than in world space is what keeps this
   * cheap and, more importantly, unambiguous: the knee can only bend
   * one way, so there is no pole vector to get wrong and no chance of
   * the classic inverted-knee pop when the target crosses the hip.
   *
   * `fz`/`fy` are the wanted ankle position relative to the hip joint,
   * -Z forward. Returns [hipPitch, kneeBend] with kneeBend <= 0.
   */
  const _ik = [0, 0];
  function solveLeg(fz, fy) {
    let d = Math.hypot(fz, fy);
    const min = Math.abs(SEG.thigh - SEG.shin) + 0.06;
    const max = LEG_MAX - 0.012;
    if (d < min) d = min;
    if (d > max) d = max;
    const scale = d / (Math.hypot(fz, fy) || 1e-5);
    const zz = fz * scale;
    const yy = fy * scale;

    const cosKnee = clamp(
      (SEG.thigh * SEG.thigh + SEG.shin * SEG.shin - d * d) / (2 * SEG.thigh * SEG.shin), -1, 1
    );
    const knee = -(Math.PI - Math.acos(cosKnee));
    const alpha = Math.atan2(-zz, -yy);
    const cosHip = clamp(
      (SEG.thigh * SEG.thigh + d * d - SEG.shin * SEG.shin) / (2 * SEG.thigh * d), -1, 1
    );
    _ik[0] = alpha + Math.acos(cosHip);
    _ik[1] = knee;
    return _ik;
  }

  /** Forward kinematics for the same chain, so the gait can be
   *  expressed as joint angles and then corrected in cartesian space. */
  function legFk(hipPitch, kneeBend, out) {
    const a = hipPitch;
    const b = hipPitch + kneeBend;
    out[0] = -(SEG.thigh * Math.sin(a) + SEG.shin * Math.sin(b));   // z
    out[1] = -(SEG.thigh * Math.cos(a) + SEG.shin * Math.cos(b));   // y
    return out;
  }

  const _fk = [0, 0];
  const _fkR = [0, 0];

  /* Death poses. Each is a target the collapse springs toward, chosen
   * so the body ends flat on the ground rather than kneeling in the
   * air. The variety matters: four bodies in identical postures reads
   * as a bug, not as a battlefield. */
  const DEATHS = [
    { name: "face", hipY: 0.30, pitch: -1.42, roll: 0.10, spine: -0.25, armL: 1.9, armR: 1.3, legL: 0.15, legR: -0.1, kneeL: -0.35, kneeR: -0.15, headP: 0.30 },
    { name: "back", hipY: 0.28, pitch: 1.45, roll: -0.12, spine: 0.20, armL: -0.9, armR: -1.2, legL: -0.25, legR: 0.1, kneeL: -0.85, kneeR: -0.30, headP: -0.35 },
    { name: "side", hipY: 0.30, pitch: -0.35, roll: 1.36, spine: 0.16, armL: 0.7, armR: -0.5, legL: 0.55, legR: -0.15, kneeL: -1.25, kneeR: -0.55, headP: 0.20 },
    { name: "crumple", hipY: 0.42, pitch: -1.05, roll: -0.55, spine: -0.45, armL: 0.4, armR: 1.1, legL: -0.85, legR: -0.55, kneeL: -1.95, kneeR: -1.75, headP: 0.45 },
    { name: "sprawl", hipY: 0.26, pitch: -1.48, roll: -0.18, spine: 0.10, armL: 2.1, armR: 1.85, legL: 0.30, legR: 0.45, kneeL: -0.25, kneeR: -0.60, headP: 0.10 },
  ];

  /**
   * Pose a soldier.
   *
   * Every field of `s` is optional; the defaults reproduce a soldier
   * standing still and facing forward, so callers that only know about
   * speed and stance (the netcode's remote players) still get a valid
   * pose.
   *
   *   speed      m/s, ground speed
   *   moveAngle  direction of travel relative to the body's facing,
   *              radians. 0 forward, +/-PI/2 strafe, PI backpedal.
   *   aimPitch   radians, + is up
   *   aimYaw     residual aim yaw relative to root.rotation.y
   *   stance     "stand" | "crouch" | "prone"
   *   sprint     0..1
   *   firing     0..1 impulse, rising edge triggers recoil
   *   reload     0..1 progress through a reload
   *   vault      0..1 progress through a vault
   *   lookYaw/lookPitch  where the soldier's attention is, relative to
   *              the body. Drives head tracking independently of aim.
   *   dead       true once killed; the collapse times itself
   */
  function pose(character, s, dt) {
    const { bones, anim } = character;
    const step = clamp(dt || 1 / 60, 0, 0.1);

    if (s.dead) {
      poseDeath(character, step);
      return;
    }
    if (anim.deathT > 0) {
      // Revived (respawn reuses the rig): clear the collapse so the
      // soldier does not stand up already folded in half.
      anim.deathT = 0;
      anim.deathVariant = (anim.deathVariant + 1) % DEATHS.length;
      anim.hipBase = SEG.hipY;
      anim.hipOffset = 0;
      bones.hips.rotation.set(0, 0, 0);
      bones.hips.position.set(0, SEG.hipY, 0);
    }

    const speedRaw = s.speed || 0;
    anim.speedSmooth = damp(anim.speedSmooth, speedRaw, 12, step);
    const speed = anim.speedSmooth;
    const stance = s.stance || "stand";
    const aimPitch = clamp(s.aimPitch || 0, -1.3, 1.3);
    const aimYaw = clamp(s.aimYaw || 0, -1.2, 1.2);
    const sprint = clamp01(s.sprint || 0);
    const reload = clamp01(s.reload || 0);
    const vault = clamp01(s.vault || 0);

    /* ---- locomotion blend ---- */
    const walkW = smoothstep((speed - 0.25) / 1.5);
    const runW = smoothstep((speed - 2.4) / 2.6);
    const sprintW = Math.max(smoothstep((speed - 5.2) / 2.0), sprint);
    const crouchW = damp(anim.stanceBlend, stance === "crouch" ? 1 : 0, 11, step);
    anim.stanceBlend = crouchW;
    const proneW = damp(anim.proneBlend, stance === "prone" ? 1 : 0, 8, step);
    anim.proneBlend = proneW;
    // The upright solve never knows about prone. Prone is a different
    // machine - the pelvis is horizontal, the legs trail behind and the
    // ground-IK target is meaningless - so it is applied afterwards as
    // an overlay rather than smuggled into the standing formulas as a
    // pile of extra terms nobody can reason about.
    const upright = 1;

    /* ---- direction of travel ---- */
    // Backpedalling is a forward gait played in reverse, not a walk
    // rotated 180 degrees, so the backward hemisphere is folded onto
    // the forward one and the stride is negated instead.
    let move = s.moveAngle || 0;
    while (move > Math.PI) move -= TAU;
    while (move < -Math.PI) move += TAU;
    const reverse = Math.cos(move) < 0 ? -1 : 1;
    const foldedYaw = Math.atan2(Math.sin(move), Math.abs(Math.cos(move)));
    anim.moveAngle = dampAngle(anim.moveAngle, foldedYaw, 9, step);
    const lateral = Math.abs(Math.sin(move));
    // Legs turn toward travel; the torso will be counter-rotated back
    // onto the aim below. This split is the single loudest signal that
    // a character is animated rather than dragged.
    const legYawTarget = clamp(anim.moveAngle, -0.72, 0.72) * walkW;
    anim.legYaw = damp(anim.legYaw, legYawTarget, 10, step);

    /* ---- gait phase ---- */
    // Advanced by distance, not by time, so feet never skate. Stride
    // length grows with speed exactly as a real one does.
    const strideLen = lerp(0.68, lerp(1.35, 1.62, sprintW), runW);
    anim.phase += (speed / (2 * strideLen)) * TAU * step * reverse;
    if (speed < 0.2) {
      // Idle sway keeps the figure alive without moving the feet.
      anim.phase += step * 0.6;
    }
    anim.breathe += step * lerp(1.5, 4.4, runW);
    if (anim.phase > TAU * 64) anim.phase -= TAU * 64;
    const phase = anim.phase;
    const phL = phase;
    const phR = phase + Math.PI;

    const breath = Math.sin(anim.breathe) * lerp(0.012, 0.035, runW);

    /* ================= lower body ================= */

    // The pelvis height is damped on its own value, and the bob and IK
    // offset are added on top. Damping the composite instead - which is
    // the obvious way to write it - feeds the bob back into its own
    // target and the whole figure hovers a centimetre high.
    anim.hipBase = damp(anim.hipBase, lerp(SEG.hipY, SEG.hipY - 0.31, crouchW), 14, step);

    // Vertical bob: highest over the support leg when walking,
    // compressed at footfall when running. Blending the sign across
    // speed is what makes the transition from walk to run read.
    const bobSign = lerp(-1, 0.8, runW);
    const bobAmp = lerp(0.012, 0.055, runW) * walkW;
    const bob = bobSign * Math.cos(2 * phase) * bobAmp;

    // Trendelenburg drop: the pelvis dips toward the swinging leg.
    const pelvisRoll = -Math.sin(phase) * 0.055 * walkW * (1 - lateral * 0.5);
    const pelvisYaw = -Math.cos(phase) * lerp(0.06, 0.16, runW) * walkW * (1 - lateral);
    bones.hips.rotation.z = damp(bones.hips.rotation.z, pelvisRoll, 14, step);
    bones.hips.rotation.y = damp(bones.hips.rotation.y, anim.legYaw + pelvisYaw, 14, step);
    bones.hips.rotation.x = damp(bones.hips.rotation.x, lerp(0, -0.12, runW), 10, step);
    bones.hips.position.z = damp(bones.hips.position.z, 0, 8, step);

    /* ---- leg cycle, then IK onto the ground ---- */

    const strideAmp = lerp(0.30, lerp(0.62, 0.80, sprintW), runW) * walkW * reverse;
    const lift = lerp(0.42, lerp(1.05, 1.35, sprintW), runW) * walkW;
    const splay = 0.045 + lateral * 0.10 * walkW;

    // Everything below is in root-LOCAL metres. The root carries a
    // per-soldier height scale, so world heights have to be divided
    // through it or a 4% taller soldier stands 4cm into the sand.
    const scale = character.root.scale.y || 1;
    const invScale = 1 / scale;
    const rootPos = character.root.position;
    const rootYaw = character.root.rotation.y + anim.legYaw;
    const cosY = Math.cos(rootYaw);
    const sinY = Math.sin(rootYaw);
    const terrain = ctx.terrain;
    const hipJointLocalY = anim.hipBase + bob + anim.hipOffset - SEG.hipDrop;

    /* Whether the terrain is the surface this soldier is standing on.
     *
     * A soldier on a roof, a stairwell or a container is metres above
     * heightAt(); sampling it anyway drags the planted foot down toward
     * the sand, stretches the leg through the floor and drops the
     * pelvis by the full IK clamp. `s.groundY` is the authoritative
     * surface when the caller knows it; otherwise the terrain is
     * trusted only while the root is actually near it. */
    const terrainY = terrain ? terrain.heightAt(rootPos.x, rootPos.z) : rootPos.y;
    const surfaceY = s.groundY !== undefined ? s.groundY : rootPos.y;
    const onTerrain = Boolean(terrain) && Math.abs(surfaceY - terrainY) < 0.30;

    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const k = side < 0 ? "L" : "R";
      const lp = i === 0 ? phL : phR;

      // Stance runs from heel strike (phase 0) to toe off (PI).
      const inSwing = ((lp % TAU) + TAU) % TAU > Math.PI ? 1 : 0;

      const hipPitch = Math.cos(lp) * strideAmp + crouchW * 0.55;
      const kneeBend = -(
        0.16 * lift * lobe(lp, 0.75, 1.1)               // loading response
        + 1.05 * lift * lobe(lp, Math.PI * 1.36, 1.5)   // swing flexion
        + 0.06
      ) - crouchW * 1.05;

      const fk = legFk(hipPitch, kneeBend, i === 0 ? _fk : _fkR);
      const fz = fk[0];
      let fy = fk[1];

      /* ---- foot IK ----
         The ground is sampled where the foot actually is, not under the
         body's centre. That is the whole point: on a 25 degree slope
         the two feet are twenty centimetres apart in height, and one
         sample makes a soldier hover on one leg and bury the other. */
      const localX = side * SEG.hipX;
      const worldX = rootPos.x + (localX * cosY + fz * sinY) * scale;
      const worldZ = rootPos.z + (-localX * sinY + fz * cosY) * scale;
      // Clamped to a leg's worth of relief either side of the root: a
      // foot placed over a cliff edge or a wadi bank would otherwise
      // ask the IK for a target it cannot reach and pop the knee.
      const groundY = onTerrain
        ? clamp(terrain.heightAt(worldX, worldZ), rootPos.y - 0.55, rootPos.y + 0.35)
        : surfaceY;
      anim.footY[i] = groundY;

      const groundLocalY = (groundY - rootPos.y) * invScale;
      const soleTarget = groundLocalY + SEG.ankleHeight;
      const fkY = hipJointLocalY + fy;
      // Planted through stance; during swing the foot is only stopped
      // from going through the ground, never pulled down to it.
      const clearance = SEG.ankleHeight + 0.03 + lift * 0.09;
      const wantY = inSwing
        ? Math.max(fkY, groundLocalY + clearance)
        : lerp(fkY, soleTarget, 0.94);
      fy = wantY - hipJointLocalY;

      const solved = solveLeg(fz, fy);
      bones[`hip${k}`].rotation.x = solved[0];
      bones[`knee${k}`].rotation.x = Math.min(0, solved[1]);
      bones[`hip${k}`].rotation.z = side * (splay + Math.sin(lp) * 0.06 * lateral * walkW);
      bones[`hip${k}`].rotation.y = -anim.legYaw * 0.25 + lateral * side * 0.12 * walkW;

      // Ankle: toe up at heel strike, driven down through toe off, and
      // levelled onto the local slope while planted.
      const groundPitch = onTerrain
        ? Math.atan2(
          groundY - terrain.heightAt(worldX - sinY * 0.24, worldZ - cosY * 0.24), 0.24
        ) : 0;
      const ankleGait = 0.26 * lobe(lp, 0.1, 1.0)
        - 0.62 * lobe(lp, Math.PI * 0.95, 0.9) * lift
        + 0.18 * inSwing * walkW;
      const ankleLevel = -(solved[0] + solved[1]) - clamp(groundPitch, -0.45, 0.45) * (1 - inSwing);
      bones[`ankle${k}`].rotation.x = damp(
        bones[`ankle${k}`].rotation.x, ankleLevel + ankleGait, 26, step
      );
      bones[`ankle${k}`].rotation.z = -bones[`hip${k}`].rotation.z * 0.6;
      bones[`toe${k}`].rotation.x = -0.35 * lobe(lp, Math.PI * 0.95, 0.8) * lift * walkW;
    }

    // Straddling a break in the ground: drop the pelvis toward the
    // lower foot so the long leg can reach without the short one
    // punching through. One iteration covers any slope on this map.
    const lowest = Math.min(anim.footY[0], anim.footY[1]);
    const pelvisNeed = clamp((lowest - rootPos.y) * invScale * 0.55, -0.32, 0.10);
    anim.hipOffset = damp(anim.hipOffset, pelvisNeed, 8, step);
    bones.hips.position.y = anim.hipBase + bob + anim.hipOffset;

    /* ================= upper body ================= */

    // Recoil is a spring, not a decay: the kick has to overshoot and
    // settle or it reads as the model being nudged.
    const firing = clamp01(s.firing || 0);
    if (firing > anim.lastFiring + 0.05) anim.recoilVel += 5.4;
    anim.lastFiring = firing;
    anim.recoilVel -= anim.recoil * 190 * step;
    anim.recoilVel -= anim.recoilVel * 14 * step;
    anim.recoil += anim.recoilVel * step;
    const recoil = clamp(anim.recoil, -0.06, 0.35);

    const runLean = -lerp(0.06, lerp(0.30, 0.48, sprintW), runW) * walkW * reverse;
    const crouchLean = -crouchW * 0.30;

    // Torso counter-rotation. The chest cancels the pelvis and then
    // takes the aim on top, so legs can point one way and the weapon
    // another without the spine visibly snapping between them.
    const spineTwist = -anim.legYaw * 0.45 + Math.cos(phase) * 0.07 * walkW;
    const chestTwist = -anim.legYaw * 0.55 + aimYaw * 0.55 - Math.cos(phase) * 0.10 * walkW;

    bones.spine.rotation.x = damp(bones.spine.rotation.x,
      runLean * 0.45 + crouchLean * 0.5 + breath * 0.4 - recoil * 0.35, 13, step);
    bones.spine.rotation.y = damp(bones.spine.rotation.y, spineTwist, 12, step);
    bones.spine.rotation.z = damp(bones.spine.rotation.z,
      Math.sin(phase) * 0.035 * walkW + (s.lean || 0) * 0.22, 12, step);

    const aimSpine = -aimPitch * 0.42;
    bones.chest.rotation.x = damp(bones.chest.rotation.x,
      runLean * 0.55 + crouchLean * 0.5 + aimSpine + breath * 0.6 - recoil * 0.55, 14, step);
    bones.chest.rotation.y = damp(bones.chest.rotation.y, chestTwist, 13, step);
    bones.chest.rotation.z = damp(bones.chest.rotation.z,
      -Math.sin(phase) * 0.05 * walkW + recoil * 0.10, 13, step);

    /* ---- head: tracks attention, not the weapon ---- */
    const lookYaw = clamp(s.lookYaw === undefined ? aimYaw : s.lookYaw, -1.15, 1.15);
    const lookPitch = clamp(s.lookPitch === undefined ? aimPitch : s.lookPitch, -0.9, 0.75);
    anim.lookYaw = dampAngle(anim.lookYaw, lookYaw, 7, step);
    anim.lookPitch = damp(anim.lookPitch, lookPitch, 7, step);
    bones.neck.rotation.x = damp(bones.neck.rotation.x,
      -anim.lookPitch * 0.35 - runLean * 0.45 + recoil * 0.25, 12, step);
    bones.neck.rotation.y = damp(bones.neck.rotation.y, anim.lookYaw * 0.35, 10, step);
    bones.head.rotation.x = damp(bones.head.rotation.x,
      -anim.lookPitch * 0.42 + recoil * 0.35, 12, step);
    bones.head.rotation.y = damp(bones.head.rotation.y, anim.lookYaw * 0.55, 10, step);
    bones.head.rotation.z = damp(bones.head.rotation.z, -anim.lookYaw * 0.10, 10, step);

    /* ---- arms ---- */
    // Both hands stay on the weapon, which is bound to the right hand,
    // so the arms are posed relative to the chest and the aim is
    // carried by the chest rotation. The left arm reaches across to
    // the handguard; its angles are tuned to land there and are not
    // derived, because a two-bone solve for the support hand costs more
    // than it buys at this scale.
    const lowReady = lerp(0, 1, Math.max(sprintW, vault));
    const gunUp = aimPitch * 0.55;

    const armSway = Math.cos(phase) * lerp(0.05, 0.16, runW) * walkW * (1 - lowReady * 0.4);

    const rShoulderX = lerp(1.02 + gunUp + recoil * 0.55, 0.42, lowReady) + armSway * 0.35;
    const rShoulderZ = lerp(-0.30, -0.55, lowReady);
    const rElbow = lerp(-1.16, -1.55, lowReady) - recoil * 0.30;

    bones.shoulderR.rotation.x = damp(bones.shoulderR.rotation.x, rShoulderX, 15, step);
    bones.shoulderR.rotation.z = damp(bones.shoulderR.rotation.z, rShoulderZ, 15, step);
    bones.shoulderR.rotation.y = damp(bones.shoulderR.rotation.y, lerp(-0.24, -0.05, lowReady), 15, step);
    bones.elbowR.rotation.x = damp(bones.elbowR.rotation.x, rElbow, 15, step);
    bones.elbowR.rotation.y = damp(bones.elbowR.rotation.y, 0.18, 12, step);
    bones.handR.rotation.x = damp(bones.handR.rotation.x, -0.18 + recoil * 0.5, 15, step);
    bones.handR.rotation.z = damp(bones.handR.rotation.z, 0.12, 12, step);

    // Reload: the support hand leaves the handguard, drops to the mag
    // well, and comes back. Three timed segments read as a full
    // magazine change without a single keyframe.
    const magDrop = smoothstep(reload / 0.28) * (1 - smoothstep((reload - 0.30) / 0.25));
    const magInsert = smoothstep((reload - 0.42) / 0.28) * (1 - smoothstep((reload - 0.76) / 0.24));
    const reloadReach = clamp01(magDrop + magInsert);

    const lShoulderX = lerp(lerp(1.28 + gunUp, 0.62, lowReady), 0.34, reloadReach) - armSway * 0.35;
    const lShoulderZ = lerp(lerp(0.50, 0.68, lowReady), 0.86, reloadReach);
    const lElbow = lerp(lerp(-1.42, -1.70, lowReady), -2.05, reloadReach);

    bones.shoulderL.rotation.x = damp(bones.shoulderL.rotation.x, lShoulderX, 15, step);
    bones.shoulderL.rotation.z = damp(bones.shoulderL.rotation.z, lShoulderZ, 15, step);
    bones.shoulderL.rotation.y = damp(bones.shoulderL.rotation.y,
      lerp(0.30, 0.72, reloadReach), 14, step);
    bones.elbowL.rotation.x = damp(bones.elbowL.rotation.x, lElbow, 15, step);
    bones.elbowL.rotation.y = damp(bones.elbowL.rotation.y, -0.30, 12, step);
    bones.handL.rotation.x = damp(bones.handL.rotation.x, -0.35, 14, step);

    /* ---- vault ---- */
    if (vault > 0.001) {
      // A vault is a whole-body event: fold at the hips, tuck the lead
      // leg, and drive the trailing leg through.
      const arc = Math.sin(vault * Math.PI);
      bones.hips.position.y += arc * 0.34;
      bones.spine.rotation.x -= arc * 0.75;
      bones.chest.rotation.x -= arc * 0.35;
      bones.hipL.rotation.x = lerp(bones.hipL.rotation.x, 1.45, arc);
      bones.kneeL.rotation.x = lerp(bones.kneeL.rotation.x, -1.85, arc);
      bones.hipR.rotation.x = lerp(bones.hipR.rotation.x, -0.55, arc * 0.8);
      bones.kneeR.rotation.x = lerp(bones.kneeR.rotation.x, -1.10, arc * 0.8);
    }

    if (proneW > 0.002) applyProne(character, proneW, phase, walkW, aimPitch, aimYaw);
  }

  /**
   * Prone, blended over the standing pose.
   *
   * Prone is not a low crouch. The pelvis lies down - it pitches almost
   * ninety degrees - and that single change puts the legs, which hang
   * off it, straight out behind the body for free. Everything else here
   * is putting the head and the weapon back where a shooter's would be
   * once the torso is horizontal.
   */
  function applyProne(character, w, phase, walkW, aimPitch, aimYaw) {
    const { bones } = character;
    const mix = (bone, axis, target) => {
      bone.rotation[axis] = lerp(bone.rotation[axis], target, w);
    };
    // Crawl: the body drags itself along on alternating elbows and
    // knees. Small amplitudes - a prone soldier barely moves.
    const crawl = walkW;
    const c = Math.cos(phase) * crawl;
    const cs = Math.sin(phase) * crawl;

    bones.hips.position.y = lerp(bones.hips.position.y, 0.235, w);
    bones.hips.position.z = lerp(bones.hips.position.z, 0.06, w);
    mix(bones.hips, "x", -1.40 + cs * 0.06);
    mix(bones.hips, "z", c * 0.10);

    mix(bones.spine, "x", 0.16);
    mix(bones.spine, "y", -aimYaw * 0.25);
    mix(bones.spine, "z", -c * 0.08);
    mix(bones.chest, "x", 0.42 - aimPitch * 0.30);
    mix(bones.chest, "y", aimYaw * 0.45);
    mix(bones.chest, "z", c * 0.06);

    // Head up out of the dirt, looking along the barrel.
    mix(bones.neck, "x", 0.72 - aimPitch * 0.30);
    mix(bones.head, "x", 0.42 - aimPitch * 0.25);

    // Elbows planted, weapon supported forward.
    mix(bones.shoulderR, "x", 1.32 + c * 0.10);
    mix(bones.shoulderR, "z", -0.46);
    mix(bones.shoulderR, "y", -0.20);
    mix(bones.elbowR, "x", -1.30);
    mix(bones.shoulderL, "x", 1.44 - c * 0.10);
    mix(bones.shoulderL, "z", 0.60);
    mix(bones.shoulderL, "y", 0.34);
    mix(bones.elbowL, "x", -1.52);

    // Legs trail flat and splayed; a crawl kicks one knee up at a time.
    mix(bones.hipL, "x", -0.06 - Math.max(0, c) * 0.55);
    mix(bones.hipR, "x", -0.06 - Math.max(0, -c) * 0.55);
    mix(bones.hipL, "z", -0.26);
    mix(bones.hipR, "z", 0.26);
    mix(bones.kneeL, "x", -0.18 - Math.max(0, c) * 0.85);
    mix(bones.kneeR, "x", -0.18 - Math.max(0, -c) * 0.85);
    mix(bones.ankleL, "x", 0.55);
    mix(bones.ankleR, "x", 0.55);
    mix(bones.toeL, "x", 0);
    mix(bones.toeR, "x", 0);
  }

  /** Timed collapse. The spring rates differ per joint so the body
   *  folds in an order rather than deflating uniformly, and the last
   *  10% is deliberately slow so a corpse settles instead of snapping. */
  function poseDeath(character, dt) {
    const { bones, anim } = character;
    anim.deathT += dt;
    const t = anim.deathT;
    const spec = DEATHS[anim.deathVariant % DEATHS.length];

    // The gait loop is what normally maintains footY, and it is the
    // contact patch's only source for where the ground is. A body has
    // to keep its shadow.
    const rootY = character.root.position.y;
    anim.footY[0] = rootY;
    anim.footY[1] = rootY;

    // Legs give first, then the torso, then the arms flop. A single
    // rate for everything is the tell of a cheap death animation.
    const legRate = 7.5;
    const torsoRate = t < 0.25 ? 4.0 : 6.5;
    const armRate = 4.2;
    const settle = clamp01(t / 1.4);

    bones.hips.position.y = damp(bones.hips.position.y, spec.hipY, 5.5, dt);
    bones.hips.position.z = damp(bones.hips.position.z, spec.pitch * -0.12, 4, dt);
    bones.hips.rotation.x = damp(bones.hips.rotation.x, spec.pitch, 5.0, dt);
    bones.hips.rotation.z = damp(bones.hips.rotation.z, spec.roll, 4.4, dt);
    bones.hips.rotation.y = damp(bones.hips.rotation.y, spec.roll * 0.4, 4, dt);

    bones.spine.rotation.x = damp(bones.spine.rotation.x, spec.spine, torsoRate, dt);
    bones.spine.rotation.z = damp(bones.spine.rotation.z, spec.roll * 0.35, torsoRate, dt);
    bones.chest.rotation.x = damp(bones.chest.rotation.x, spec.spine * 0.7, torsoRate, dt);
    bones.chest.rotation.y = damp(bones.chest.rotation.y, spec.roll * 0.5, torsoRate, dt);
    bones.chest.rotation.z = damp(bones.chest.rotation.z, -spec.roll * 0.3, torsoRate, dt);

    bones.neck.rotation.x = damp(bones.neck.rotation.x, spec.headP, 5.0, dt);
    bones.head.rotation.x = damp(bones.head.rotation.x, spec.headP * 0.8, 4.5, dt);
    bones.head.rotation.y = damp(bones.head.rotation.y, spec.roll * 0.6, 4, dt);

    bones.shoulderL.rotation.x = damp(bones.shoulderL.rotation.x, spec.armL, armRate, dt);
    bones.shoulderL.rotation.z = damp(bones.shoulderL.rotation.z, 0.55 + spec.roll * 0.2, armRate, dt);
    bones.elbowL.rotation.x = damp(bones.elbowL.rotation.x, -0.45 - settle * 0.35, armRate, dt);
    bones.shoulderR.rotation.x = damp(bones.shoulderR.rotation.x, spec.armR, armRate, dt);
    bones.shoulderR.rotation.z = damp(bones.shoulderR.rotation.z, -0.50 + spec.roll * 0.2, armRate, dt);
    bones.elbowR.rotation.x = damp(bones.elbowR.rotation.x, -0.55 - settle * 0.30, armRate, dt);

    bones.hipL.rotation.x = damp(bones.hipL.rotation.x, spec.legL, legRate, dt);
    bones.hipR.rotation.x = damp(bones.hipR.rotation.x, spec.legR, legRate, dt);
    bones.hipL.rotation.z = damp(bones.hipL.rotation.z, -0.12 + spec.roll * 0.2, legRate, dt);
    bones.hipR.rotation.z = damp(bones.hipR.rotation.z, 0.14 + spec.roll * 0.2, legRate, dt);
    bones.kneeL.rotation.x = damp(bones.kneeL.rotation.x, spec.kneeL, legRate, dt);
    bones.kneeR.rotation.x = damp(bones.kneeR.rotation.x, spec.kneeR, legRate, dt);
    bones.ankleL.rotation.x = damp(bones.ankleL.rotation.x, 0.35, 5, dt);
    bones.ankleR.rotation.x = damp(bones.ankleR.rotation.x, 0.25, 5, dt);
  }

  /* ================================================================
     contact shadows

     A cascaded shadow map cannot be relied on to hold a soldier. It is
     one map over a 460m box; a figure is half a metre wide and its
     shadow is three or four texels, so it survives the depth bias only
     some of the time and vanishes entirely past the cascade. A soldier
     with no darkness under him reads as pasted onto the sand no matter
     how good the rest of the frame is - it was the first thing the art
     director named.

     So every soldier also gets an explicit contact patch: one
     multiply-blended quad on the ground, laid on the terrain normal.
     All of them live in ONE InstancedMesh, so the whole round costs a
     single extra draw call. It is not a substitute for the cast shadow
     - it is the near-field ambient occlusion the shadow map is the
     wrong tool for.
     ================================================================ */

  const CONTACT_CAPACITY = 96;

  function buildContactTexture() {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5) / size * 2 - 1;
        const dy = (y + 0.5) / size * 2 - 1;
        // Elliptical, longer front-to-back: a standing figure occludes
        // a footprint, not a circle.
        const d = Math.hypot(dx * 1.18, dy * 0.86);
        // Squared falloff with a soft core. A linear falloff reads as a
        // painted disc; the eye wants dense under the boots and nothing
        // at all by the time it is a body width away.
        const a = Math.pow(clamp01(1 - d), 2.1);
        const i = (y * size + x) * 4;
        // Multiply blending: RGB is the factor the ground is scaled by.
        // NOT neutral grey - what a body occludes here is the sky, and
        // what is left is bounce off hot sand, so the shadow it leaves
        // is warm. A neutral contact patch on desert sand reads as a
        // smudge of dirt; a warm one reads as shade.
        // The cascade's penumbra is wide enough that a person-sized
        // cast shadow arrives as sampling noise, so this patch is
        // carrying more of the contact read than it was meant to.
        const core = 0.74;
        image.data[i] = Math.round(255 * (1 - a * core * 0.80));
        image.data[i + 1] = Math.round(255 * (1 - a * core * 0.92));
        image.data[i + 2] = Math.round(255 * (1 - a * core * 1.0));
        image.data[i + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  const contactTexture = buildContactTexture();
  const contactMaterial = new THREE.MeshBasicMaterial({
    map: contactTexture,
    blending: THREE.MultiplyBlending,
    // three logs an error every draw call when this pairing is missing
    // and multiply blending without it turns every transparent texel
    // into full-strength black.
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
    // The sand has real ripple relief of a couple of centimetres, so a
    // flat quad laid 3cm above the sampled height dips under the crests
    // and the patch comes back as speckle rather than as shade. The
    // offset is deliberately large; a multiply patch has no silhouette
    // of its own, so lifting it costs nothing visually.
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    fog: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  contactMaterial.name = "bs-soldier-contact";

  const contactGeometry = new THREE.PlaneGeometry(1, 1);
  contactGeometry.rotateX(-Math.PI * 0.5);
  const contactMesh = new THREE.InstancedMesh(contactGeometry, contactMaterial, CONTACT_CAPACITY);
  contactMesh.name = "soldier-contacts";
  contactMesh.frustumCulled = false;
  contactMesh.matrixAutoUpdate = false;
  contactMesh.castShadow = false;
  contactMesh.receiveShadow = false;
  contactMesh.count = 0;
  // The QA clearance probe must not read a shadow patch as geometry
  // pressed against the lens.
  contactMesh.userData.qaOpaque = false;
  contactMesh.renderOrder = 2;
  group.add(contactMesh);

  /** Everything currently in the world, so update() does not have to
   *  re-derive it from the scene graph every frame. */
  const live = [];

  const _cMat = new THREE.Matrix4();
  const _cPos = new THREE.Vector3();
  const _cQuat = new THREE.Quaternion();
  const _cScale = new THREE.Vector3();
  const _cNormal = new THREE.Vector3();
  const _cUp = new THREE.Vector3(0, 1, 0);
  const _cYaw = new THREE.Quaternion();

  function updateContacts() {
    const camera = render.camera;
    const fade = 90;                 // past here the patch is a pixel
    let n = 0;
    for (let i = 0; i < live.length && n < CONTACT_CAPACITY; i += 1) {
      const character = live[i];
      const root = character.root;
      if (!root.visible || !root.parent) continue;
      const dx = root.position.x - camera.position.x;
      const dz = root.position.z - camera.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > fade) continue;

      const anim = character.anim;
      const ground = Math.min(anim.footY[0], anim.footY[1]);
      // A soldier posed before terrain existed (or teleported this
      // frame) has a stale footY; ignore anything absurd rather than
      // drawing a patch on the horizon.
      if (!Number.isFinite(ground) || Math.abs(ground - root.position.y) > 2.5) continue;

      if (ctx.terrain && ctx.terrain.normalAt) ctx.terrain.normalAt(root.position.x, root.position.z, _cNormal);
      else _cNormal.set(0, 1, 0);
      _cQuat.setFromUnitVectors(_cUp, _cNormal);
      _cYaw.setFromAxisAngle(_cUp, root.rotation.y);
      _cQuat.multiply(_cYaw);

      // Prone spreads the contact along the body; crouch tightens and
      // darkens it. `deathT` covers the collapse the same way.
      const prone = Math.max(anim.proneBlend || 0, anim.deathT > 0 ? 1 : 0);
      const crouch = anim.stanceBlend || 0;
      const width = lerp(lerp(1.25, 1.05, crouch), 1.55, prone);
      const length = lerp(lerp(1.55, 1.30, crouch), 2.45, prone);
      _cScale.set(width, 1, length);
      _cPos.set(root.position.x, ground + 0.10, root.position.z);
      _cMat.compose(_cPos, _cQuat, _cScale);
      contactMesh.setMatrixAt(n, _cMat);
      n += 1;
    }
    contactMesh.count = n;
    if (n > 0) contactMesh.instanceMatrix.needsUpdate = true;
  }

  /* ================================================================
     api
     ================================================================ */

  /** Hitboxes in local space relative to the root, standing. The head
   *  is separate so headshots are possible and worth aiming for. */
  const HITBOXES = [
    { name: "head", offset: [0, 1.68, 0], size: [0.26, 0.30, 0.28], multiplier: 3.4 },
    { name: "chest", offset: [0, 1.30, 0], size: [0.48, 0.42, 0.34], multiplier: 1.0 },
    { name: "abdomen", offset: [0, 0.98, 0], size: [0.40, 0.30, 0.28], multiplier: 0.85 },
    { name: "armL", offset: [-0.30, 1.24, 0], size: [0.18, 0.54, 0.20], multiplier: 0.65 },
    { name: "armR", offset: [0.30, 1.24, 0], size: [0.18, 0.54, 0.20], multiplier: 0.65 },
    { name: "legL", offset: [-0.12, 0.46, 0], size: [0.21, 0.92, 0.24], multiplier: 0.72 },
    { name: "legR", offset: [0.12, 0.46, 0], size: [0.21, 0.92, 0.24], multiplier: 0.72 },
  ];

  /* Stance changes the target a shooter is presented with. Crouching
   * really does cut the exposed area, so the boxes have to follow the
   * pose or a crouching soldier is hit in a head that is not there. */
  const STANCE_BOXES = { stand: HITBOXES };
  STANCE_BOXES.crouch = HITBOXES.map((box) => ({
    ...box,
    offset: [box.offset[0], box.offset[1] * 0.70, box.offset[2]],
    size: [box.size[0], box.size[1] * (box.name.startsWith("leg") ? 0.62 : 0.92), box.size[2]],
  }));
  STANCE_BOXES.prone = HITBOXES.map((box) => ({
    ...box,
    offset: [
      box.offset[0],
      0.16 + (box.name === "head" ? 0.10 : 0.04),
      box.offset[2] + (box.name === "head" ? -0.62 : box.name.startsWith("leg") ? 0.68 : 0),
    ],
    size: [
      box.size[0],
      box.name.startsWith("leg") ? 0.26 : 0.32,
      box.name.startsWith("leg") ? 0.90 : box.size[2] * 1.2,
    ],
  }));

  return {
    group,
    build,
    pose,
    HITBOXES,
    STANCE_BOXES,
    SEG,
    material: bodyMaterial,

    /** Hitboxes for a stance. bots.js and the player's weapon both go
     *  through this so the target and the silhouette cannot disagree. */
    hitboxesFor(stance) {
      return STANCE_BOXES[stance] || HITBOXES;
    },

    add(character) {
      group.add(character.root);
      if (!live.includes(character)) live.push(character);
    },
    remove(character) {
      group.remove(character.root);
      const index = live.indexOf(character);
      if (index >= 0) live.splice(index, 1);
      character.mesh.geometry.dispose();
      character.skeleton.dispose?.();
    },

    /**
     * lateUpdate, not update: the contact patch has to sit under the
     * root position bots.js writes in ITS update, and lateUpdate is the
     * only hook guaranteed to run after every module's update.
     */
    lateUpdate() {
      // Track the real lights so the rim is sky at noon and sun at
      // dusk. Read off the render module rather than imported, per the
      // ctx contract.
      const sun = render.sun;
      const hemi = render.hemi;
      if (sun) {
        bodyUniforms.uSunColour.value.copy(sun.color).multiplyScalar(clamp(sun.intensity / 4, 0.25, 1.6));
        bodyUniforms.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
      }
      if (hemi) {
        const ambient = render.scene.environmentIntensity ?? 1;
        bodyUniforms.uSkyColour.value.copy(hemi.color).multiplyScalar(clamp(ambient * 2.4, 0.15, 1.2));
      }
      updateContacts();
    },

    report() {
      let triangles = 0;
      let soldiers = 0;
      for (const child of group.children) {
        const mesh = child.children.find((c) => c.isSkinnedMesh);
        if (!mesh) continue;
        soldiers += 1;
        if (mesh.geometry.index) triangles += mesh.geometry.index.count / 3;
      }
      return {
        soldiers,
        drawCallsPerSoldier: 1,
        contactPatches: contactMesh.count,
        extraDrawCalls: contactMesh.count > 0 ? 1 : 0,
        triangles,
        atlas: `${ATLAS_SIZE}x${ATLAS_SIZE}`,
      };
    },

    dispose() {
      for (const child of group.children.slice()) {
        const mesh = child.children.find((c) => c.isSkinnedMesh);
        if (mesh) mesh.geometry.dispose();
      }
      live.length = 0;
      contactMesh.dispose();
      contactGeometry.dispose();
      contactMaterial.dispose();
      contactTexture.dispose();
      render.scene.remove(group);
      bodyMaterial.dispose();
      atlas.map.dispose(); atlas.normalMap.dispose(); atlas.roughnessMap.dispose();
    },
  };
}
