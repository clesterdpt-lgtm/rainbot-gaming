/* ============================================================
   APOP DEMON MOGGERS 3D - character

   Every figure in the game is built here: Moggadonna, the eight
   demon archetypes, and the boss variants. There are no model
   files. A figure is generated geometry - tapered boxes, lathes,
   lofted blades - welded onto a real bone hierarchy and merged
   into ONE SkinnedMesh with ONE material.

   ---- why one merged SkinnedMesh ----
   The obvious build is a Group per bone with a Mesh per body part.
   That costs twenty draw calls per character; a food court with
   fifteen demons in it would spend three hundred draws on enemies
   alone and leave nothing for the level. Everything below writes
   into flat arrays and merges once, so a demon is one draw call no
   matter how much stage costume is hanging off it. That is the
   entire reason the costumes can be this loud.

   ---- the quality bar this file is answering ----
   CONTRACT.md section 2 lists silhouette mush as the third-loudest
   tell. SM64 shapes survive 240p because they are big, rounded and
   separated by VALUE, and because each character owns one shape
   nothing else in the game has. So every figure here is authored
   silhouette-first:

     Moggadonna   hair swoosh + pointed shoulders + flared coat tails
     Auto-Tune Imp  a vocoder head twice the size of its body
     Lip-Sync Lackey  a lollipop head that is nothing but mouth
     Industry Plant   a pot with a fan of leaves over it
     Pay-Pig Demon    a wide barrel with a snout and a sack
     Stan-Account Bat a phone slab between two scalloped wings
     Backup Dancer    narrow top, bell-bottom flare, pointed shoulders
     VIP Bouncer      a wardrobe with a head sunk into it
     Paparazzi Drone  an X of rotors with a lens for a nose

   Render any of them as pure black and the shape still names it.

   ---- model space ----
   FORWARD IS -Z, matching CONTRACT.md section 5. Y is up, the
   figure's feet sit at y = 0 in rig-local space, and the character's
   RIGHT is +X (right = forward x up in a right-handed frame). Signs
   that follow from this and are relied on by anim.js:
     - positive thigh/arm rotation.x swings the limb FORWARD
     - shin rotation.x is <= 0, so the calf trails the thigh
     - forward lean of the torso is NEGATIVE spine rotation.x
     - "outward" for a limb is rotation.z * SIDE, SIDE.L = -1
   ============================================================ */

import * as THREE from "three";
import {
  TAU, clamp, clamp01, lerp, smoothstep,
  makeRng, makeNoise2D, fbm2D, mixHex, shadeHex,
} from "apop3d/core.js";

/* The bone names in CONTRACT.md section 9. anim.js drives any rig
 * that has these; a figure may add MORE bones (hair, coat panels,
 * rotors) but never fewer and never under a different name. */
export const BONE_NAMES = [
  "root", "hips", "spine", "chest", "neck", "head",
  "shoulderL", "armL", "forearmL", "handL",
  "shoulderR", "armR", "forearmR", "handR",
  "thighL", "shinL", "footL",
  "thighR", "shinR", "footR",
];

/* Material zones. Written per-vertex as `aZone` so materials.js can
 * push a different cel ramp down each one without the character
 * splitting into several draw calls: hair wants two hard bands and a
 * glossy kick, skin wants three soft ones, chrome wants a mirror
 * step. The number is an index, not a mask. */
export const ZONES = {
  skin: 0,
  hair: 1,
  cloth: 2,
  trim: 3,
  boot: 4,
  hard: 5,
  glow: 6,
  eye: 7,
};

const SIDE = { L: -1, R: 1 };

/* Detail tiles. CONTRACT.md section 2: a clean untextured plane is
 * the loudest tell in the list, and a character is the thing the
 * camera is closest to. `h` is a height field in 0..1 driving albedo
 * and normal together, so the crease and the bump always agree. */
const ATLAS_SIZE = 512;
const ATLAS_GRID = 4;
const TILE_PX = ATLAS_SIZE / ATLAS_GRID;
const TILE_INSET = 4 / ATLAS_SIZE;

const TILES = {
  skin: { i: 0, weave: [0, 0, 0], grain: [30, 0.13], blotch: [4.0, 0.14], bump: 0.35, dark: 0.14 },
  hair: { i: 1, weave: [3, 96, 0.40], grain: [16, 0.22], blotch: [2.4, 0.26], bump: 1.5, dark: 0.34 },
  satin: { i: 2, weave: [44, 44, 0.18], grain: [10, 0.16], blotch: [2.0, 0.22], bump: 0.6, dark: 0.26 },
  sequin: { i: 3, weave: [0, 0, 0], grain: [58, 0.55], blotch: [7.0, 0.20], bump: 2.0, dark: 0.44, spark: true },
  leather: { i: 4, weave: [0, 0, 0], grain: [24, 0.40], blotch: [6.0, 0.24], bump: 1.3, dark: 0.32 },
  chrome: { i: 5, weave: [0, 0, 0], grain: [44, 0.10], blotch: [10.0, 0.12], bump: 0.3, dark: 0.14 },
  plastic: { i: 6, weave: [80, 80, 0.12], grain: [34, 0.10], blotch: [5.0, 0.10], bump: 0.4, dark: 0.16 },
  fuzz: { i: 7, weave: [0, 0, 0], grain: [52, 0.34], blotch: [3.4, 0.22], bump: 1.1, dark: 0.30 },
  leaf: { i: 8, weave: [2, 30, 0.34], grain: [14, 0.20], blotch: [3.0, 0.28], bump: 1.0, dark: 0.30 },
  denim: { i: 9, weave: [52, 30, 0.34], grain: [12, 0.22], blotch: [2.6, 0.24], bump: 1.1, dark: 0.32 },
  grime: { i: 10, weave: [30, 30, 0.22], grain: [6, 0.40], blotch: [1.7, 0.50], bump: 1.0, dark: 0.42 },
  flat: { i: 11, weave: [0, 0, 0], grain: [20, 0.06], blotch: [8.0, 0.06], bump: 0.15, dark: 0.06 },
};

/* ------------------------------------------------------------------
   runtime handles

   Everything below is a module-level function so the file stays
   readable, but the material and the atlas need a ctx to be built
   against (settings for anisotropy, materials.js for the shared cel
   hybrid). create() fills this in; build() refuses to run before it.
   ------------------------------------------------------------------ */

let RT = null;

const _mat4 = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _nrm3 = new THREE.Matrix3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _eul = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _refA = new THREE.Vector3();
const _refB = new THREE.Vector3();

const _colourCache = new Map();
/** Cached THREE.Color from a hex literal. CONTRACT.md section 5
 *  forbids constructing colours in the frame loop; building a figure
 *  is not the frame loop, but a demon spawner very nearly is. */
function col(hex) {
  let c = _colourCache.get(hex);
  if (!c) { c = new THREE.Color(hex); _colourCache.set(hex, c); }
  return c;
}

/* ------------------------------------------------------------------
   detail atlas
   ------------------------------------------------------------------ */

function buildAtlas(ctx) {
  const noise = makeNoise2D(0x9017);
  const albedo = document.createElement("canvas");
  const normal = document.createElement("canvas");
  const rough = document.createElement("canvas");
  for (const c of [albedo, normal, rough]) { c.width = ATLAS_SIZE; c.height = ATLAS_SIZE; }
  const aCtx = albedo.getContext("2d");
  const nCtx = normal.getContext("2d");
  const rCtx = rough.getContext("2d");
  const aData = aCtx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  const nData = nCtx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  const rData = rCtx.createImageData(ATLAS_SIZE, ATLAS_SIZE);

  /* Prime every texel with the IDENTITY of its map before a tile is
     drawn: white albedo, a flat tangent normal, mid roughness.
     TILES fills twelve of the sixteen cells, and createImageData hands
     back zeroes - so the fourth row was transparent black. Nothing
     addresses those cells directly, but the mip chain does: at the top
     of a 512px chain one texel averages a whole quadrant, so a figure
     seen from across a course was sampling half a tile of pure black
     albedo AND a (0,0,0) texel that decodes to a normal pointing into
     the surface. A detail map has to average to its no-op value in
     every region a mip can reach, not only in the cells we authored. */
  for (let i = 0; i < ATLAS_SIZE * ATLAS_SIZE; i += 1) {
    const px = i * 4;
    aData.data[px] = 255; aData.data[px + 1] = 255; aData.data[px + 2] = 255; aData.data[px + 3] = 255;
    nData.data[px] = 128; nData.data[px + 1] = 128; nData.data[px + 2] = 255; nData.data[px + 3] = 255;
    rData.data[px] = 255; rData.data[px + 1] = 200; rData.data[px + 2] = 0; rData.data[px + 3] = 255;
  }

  const height = new Float32Array(TILE_PX * TILE_PX);
  const spark = new Float32Array(TILE_PX * TILE_PX);

  for (const spec of Object.values(TILES)) {
    const tx = (spec.i % ATLAS_GRID) * TILE_PX;
    const ty = Math.floor(spec.i / ATLAS_GRID) * TILE_PX;
    const seed = spec.i * 91.7 + 13.3;

    for (let y = 0; y < TILE_PX; y += 1) {
      for (let x = 0; x < TILE_PX; x += 1) {
        const u = x / TILE_PX;
        const v = y / TILE_PX;
        let h = 0.5;
        // Whole cycles across the tile, so the tile stays seamless
        // when a part maps a sub-rect of it.
        if (spec.weave[2] > 0) {
          h += Math.sin(u * TAU * spec.weave[0]) * spec.weave[2] * 0.5;
          h += Math.sin(v * TAU * spec.weave[1]) * spec.weave[2] * 0.5;
        }
        h += noise(u * spec.grain[0] + seed, v * spec.grain[0] - seed) * spec.grain[1];
        h += fbm2D(noise, u * spec.blotch[0] + seed, v * spec.blotch[0] + seed, 3) * spec.blotch[1];
        height[y * TILE_PX + x] = clamp01(h);
        // Sequins are not a texture, they are a scatter of tiny
        // mirrors. A hundred hard white dots on a dark field is what
        // makes a stage costume read as a stage costume at any range.
        spark[y * TILE_PX + x] = spec.spark
          ? clamp01((noise(u * 62 + seed, v * 62 - seed) - 0.52) * 14)
          : 0;
      }
    }

    for (let y = 0; y < TILE_PX; y += 1) {
      for (let x = 0; x < TILE_PX; x += 1) {
        const i = y * TILE_PX + x;
        const h = height[i];
        const s = spark[i];
        const px = ((ty + y) * ATLAS_SIZE + (tx + x)) * 4;

        // Albedo is a light multiplier, never a hue: the part's
        // vertex colour carries the actual colour, so one tile
        // serves every costume in the roster.
        const shade = clamp01((1 - spec.dark * (1 - h)) + s * 0.9);
        const value = Math.round(shade * 255);
        aData.data[px] = value; aData.data[px + 1] = value; aData.data[px + 2] = value;
        aData.data[px + 3] = 255;

        const xl = height[y * TILE_PX + ((x - 1 + TILE_PX) % TILE_PX)];
        const xr = height[y * TILE_PX + ((x + 1) % TILE_PX)];
        const yd = height[((y - 1 + TILE_PX) % TILE_PX) * TILE_PX + x];
        const yu = height[((y + 1) % TILE_PX) * TILE_PX + x];
        const nx = (xl - xr) * spec.bump * 2.2;
        const ny = (yd - yu) * spec.bump * 2.2;
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        nData.data[px] = Math.round((nx / len * 0.5 + 0.5) * 255);
        nData.data[px + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
        nData.data[px + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        nData.data[px + 3] = 255;

        // Green is roughness, blue is metalness - three's combined
        // map convention. A sequin is a mirror, a crease is matte.
        const r = clamp01(0.94 - 0.30 * h - s * 0.8);
        rData.data[px] = 255;
        rData.data[px + 1] = Math.round(r * 255);
        rData.data[px + 2] = Math.round(s * 200);
        rData.data[px + 3] = 255;
      }
    }
  }

  aCtx.putImageData(aData, 0, 0);
  nCtx.putImageData(nData, 0, 0);
  rCtx.putImageData(rData, 0, 0);

  const aniso = ctx?.settings?.quality?.anisotropy
    ?? ctx?.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  const make = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    /* flipY OFF, and this line is worth more than it looks.
     *
     * emit() addresses a tile by its grid cell counting from the top
     * left of the CANVAS - `ty = floor(i / ATLAS_GRID) / ATLAS_GRID`.
     * A CanvasTexture defaults to flipY = true, which inverts the V
     * axis against the canvas, so that arithmetic was off by a whole
     * row-order: row 0 of the canvas was being addressed as V 0.75-1.0
     * and vice versa. Every tile in the top canvas row - skin, hair,
     * satin, sequin, which is her FACE, her HAIR and the entire
     * costume - therefore sampled the fourth row, which nothing writes.
     *
     * That reads as a palette failure and it is not one. The albedo
     * came back black, and the normal map came back (0,0,0), which
     * decodes to a tangent normal pointing into the surface and kills
     * the diffuse response outright. Isolated on a neutral card in
     * course 1: p10 1 / p25 2 / p50 4 with the flip, p10 40 / p25 42 /
     * p50 47 without it, against p10 41 / p25 44 / p50 49 for the same
     * figure with no atlas bound at all. Right way up the atlas costs
     * one or two luma - which is exactly what a detail map multiplied
     * over an authored vertex colour is supposed to cost.
     *
     * All three maps flip together or the grain, the bump and the
     * gloss stop describing the same surface. */
    t.flipY = false;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = Math.min(8, aniso);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };

  return {
    map: make(albedo, true),
    normalMap: make(normal, false),
    roughnessMap: make(rough, false),
    dispose() { this.map.dispose(); this.normalMap.dispose(); this.roughnessMap.dispose(); },
  };
}

/* ------------------------------------------------------------------
   material

   materials.js owns the shared cel/PBR hybrid (CONTRACT.md section 9,
   `materials.toon`). When it exists we take it; until it does we
   build an equivalent locally so this module can be looked at on its
   own. Either way character.js layers its OWN patch on top, because
   the three extra vertex attributes below are ours and nobody else
   knows what they mean.
   ------------------------------------------------------------------ */

function toonRamp() {
  // Four hard steps. SM64 characters are lit in bands, and the band
  // edge is what separates a limb from the torso behind it at 240p.
  const steps = [0.34, 0.58, 0.82, 1.0];
  const data = new Uint8Array(steps.length * 4);
  for (let i = 0; i < steps.length; i += 1) {
    const v = Math.round(steps[i] * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Bolt the character attributes onto whatever material we were given.
 *
 * Three of them, all cheap and all load-bearing:
 *
 *   aOcclusion  baked contact darkness, evaluated in the bind pose.
 *               Without it a figure lit mostly by ambient comes out
 *               one flat value from boot to crown, which is exactly
 *               the "unlit cut-out" fault.
 *   aGlow       emissive strength. Mic heads, screens, sigils and
 *               demon eyes all glow, and doing that with a second
 *               material would double every character's draw calls.
 *   aZone       the cel-ramp zone from ZONES. Used here only for the
 *               gloss kick; materials.js is free to do more with it.
 *
 * The patch is CHAINED rather than assigned, so a material that
 * arrives from materials.js keeps whatever it already does.
 */
function patchCharacterMaterial(mat, uniforms) {
  if (!mat || mat.userData.apopCharacter) return mat;
  mat.userData.apopCharacter = true;

  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;

  mat.onBeforeCompile = function apopCharacterPatch(shader, renderer) {
    if (prevCompile) prevCompile.call(mat, shader, renderer);

    // A missing anchor means three restructured its shader chunks.
    // Bail rather than emit half a patch: undeclared varyings fail to
    // link and take the whole scene's materials down with them.
    if (shader.vertexShader.indexOf("#include <begin_vertex>") < 0) return;
    if (shader.fragmentShader.indexOf("#include <lights_fragment_end>") < 0) return;

    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        // Unbound attributes read as 0 in WebGL, so a geometry that
        // forgot one comes out unoccluded and unlit rather than black.
        attribute float aOcclusion;
        attribute float aGlow;
        attribute float aZone;
        varying float vApAo;
        varying float vApGlow;
        varying float vApZone;
        varying vec3 vApWorldNormal;
        varying vec3 vApViewW;
      `)
      .replace("#include <begin_vertex>", `
        // AFTER skinning: objectNormal here is the posed normal, so
        // the rim tracks a shoulder as it swings.
        vApWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        // Capped. Three occlusion terms can sum to 1 in an armpit,
        // and a fragment with no ambient at all in a scene that is
        // mostly ambient is a hole in the middle of a character.
        vApAo = 1.0 - clamp(aOcclusion, 0.0, 1.0) * 0.72;
        vApGlow = aGlow;
        vApZone = aZone;
        #include <begin_vertex>
      `)
      /* The view direction, in WORLD space, carried by our own varying.
       *
       * This exists because the fresnel below used to be built from
       * `dot(normal, normalize(vViewPosition))` and that expression
       * measured as ZERO on every visible pixel of the figure - so
       * `apF` was 1.0 everywhere and every term raised to a power of it
       * was a flat constant rather than an edge. The glossy chip was
       * therefore adding its full 0.14 to the whole surface of the hair
       * instead of a highlight on a curl: measured on the isolated
       * figure, the hair rendered at luma 124 with its authored colour
       * and at 114 with its albedo forced to PURE BLACK. A palette
       * cannot win against a term it is not a factor of, and four
       * rounds of "her hair is a pale mass" were this one line.
       *
       * Injected after <project_vertex> so `transformed` is the final
       * post-skinning position; `cameraPosition` is part of three's own
       * vertex prefix. Both vectors here are ours and are checkable
       * against the model, which is the point. */
      .replace("#include <project_vertex>", `
        #include <project_vertex>
        vApViewW = cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        uniform vec3 uApRimColour;
        uniform vec3 uApBounce;
        uniform float uApRim;
        uniform float uApBeat;
        varying float vApAo;
        varying float vApGlow;
        varying float vApZone;
        varying vec3 vApWorldNormal;
        varying vec3 vApViewW;
      `)
      .replace("#include <lights_fragment_end>", `
        #include <lights_fragment_end>
        {
          vec3 apWN = normalize(vApWorldNormal);
          // The fresnel every edge term below is built from. World
          // space, both vectors ours. See the vertex patch for why it
          // is not the usual dot(normal, vViewPosition).
          float apF = 1.0 - clamp(dot(apWN, normalize(vApViewW)), 0.0, 1.0);
          reflectedLight.indirectDiffuse *= vApAo;
          // CONTRACT.md section 2 item 6: bounce light is coloured.
          // Warm from the lit floor underneath, and only underneath -
          // a tint applied all over is just a hue shift.
          // Multiplied by the albedo, because bounce is REFLECTED
          // light: a near-black costume returns almost none of it.
          // Added unmultiplied it behaved as a second ambient term
          // that lifted every dark zone on the figure to mid-grey,
          // which is what kept the suit reading pale after the rim
          // was tamed.
          reflectedLight.indirectDiffuse +=
            uApBounce * clamp(-apWN.y, 0.0, 1.0) * vApAo * 0.5
            * material.diffuseColor;

          // Rim off the sky. A silhouette that shares an edge value
          // with the backdrop reads as a decal; one bright pixel
          // wrapping the shoulder reads as a body. Upper hemisphere
          // only - a rim all the way round is the tell of a cheap
          // fresnel.
          // pow 4 now, where it used to ask for 7. The exponent was
          // being raised to fight a fresnel that was pinned at 1.0 and
          // therefore ignored it; against a real one, 7 is so tight it
          // is a single pixel of aliasing. This is the number that
          // actually reads as an edge.
          float apRim = pow(apF, 4.0) * clamp(apWN.y * 0.6 + 0.45, 0.0, 1.0);
          reflectedLight.indirectDiffuse += uApRimColour * apRim * uApRim * vApAo;

          // Specular, banded by zone.
          //
          // A dielectric's F0 is 0.04 and that sounds harmless until
          // you count the light in a food court: a 2.55 key plus four
          // point lights at 59. Four percent of that is a broad WHITE
          // lobe over a figure that is supposed to be reading as flat
          // saturated masses, and it lands hardest on whatever faces
          // the ceiling. Measured on the crown of her head: authored
          // (207,15,104), on screen (234,159,182) - the green channel
          // was almost entirely specular, and darkening the albedo
          // moved it by nine. A palette cannot win against a term it
          // is not a factor of.
          //
          // So hardware keeps its lobe and cloth, skin, hair and
          // leather lose almost all of it. That is the cel half of the
          // cel/PBR hybrid doing its job: highlights on this figure
          // are authored through aZone, not inherited from a BRDF.
          float apHard = step(2.5, vApZone) * step(vApZone, 3.5)
                       + step(4.5, vApZone) * step(vApZone, 5.5);
          reflectedLight.directSpecular *= mix(0.10, 1.0, apHard);

          // Zone chip. Hair (1) and shells (5) get one narrow hard
          // highlight on the crest of a curl.
          //
          // It is now weighted by how much light the surface is
          // actually catching, and that is not fussiness. Unweighted
          // it is a constant added to a zone, so it sets a FLOOR under
          // every pixel of that zone: the hair could not render darker
          // than the chip no matter what the palette said, and the
          // head therefore stayed the brightest mass on the figure
          // through four rounds of recolouring. Scaling by the key's
          // own response makes it a highlight on a lit curl and
          // nothing at all in shadow, which is what a highlight is.
          float apGlossy = step(0.5, vApZone) * step(vApZone, 1.5)
                         + step(4.5, vApZone) * step(vApZone, 5.5);
          if (apGlossy > 0.0) {
            vec3 apDD = reflectedLight.directDiffuse;
            float apLit = clamp(max(max(apDD.r, apDD.g), apDD.b) * 2.0, 0.0, 1.0);
            float apSpec = pow(apF, 5.0) * apGlossy * apLit;
            reflectedLight.directSpecular += vec3(apSpec * 0.10);
          }

          // Glow, plus the on-beat pulse materials.js drives. The
          // music is at 124 BPM and every light in the game answers
          // it; a character whose mic does not is the odd one out.
          totalEmissiveRadiance += diffuseColor.rgb * vApGlow * (1.6 + uApBeat * 1.4);
        }
      `);

    mat.userData.apopShader = shader;
  };

  mat.customProgramCacheKey = function apopCharacterKey() {
    return `apop-char-v1|${prevKey ? prevKey.call(mat) : mat.type}`;
  };

  return mat;
}

function makeCharacterMaterial(ctx, atlas, uniforms) {
  let mat = null;
  try {
    mat = ctx?.materials?.toon?.(0xffffff, {
      name: "apop.character",
      vertexColors: true,
      map: atlas.map,
      normalMap: atlas.normalMap,
      roughnessMap: atlas.roughnessMap,

      /* Costume, hair and skin. toon() defaults to 0.62, which is a
         painted-surface roughness and puts a broad white GGX lobe over
         the whole figure under a 2.55-intensity key - the same
         additive-white failure as the rim, arriving through a
         different door. It landed hardest on the hair, which faces the
         key and is the most curved thing on her, and rendered a hot
         magenta head near white. Anything that wants a highlight on
         this figure asks for it explicitly through aZone. */
      roughness: 0.92,
      metalness: 0.02,

      /* Characters take a MUCH tighter rim than a level surface, and
         in the end they want almost none of THIS one.

         toon() defaults to rim 0.85 at power 2.6, which is right for a
         wall: broad, and it separates a big flat plane from the one
         behind it. On a figure it is a disaster. The rim is added to
         indirectSpecular deliberately unmultiplied by albedo, so it
         does not care how dark the costume is - and a stylised figure
         is nearly all curvature, so "the edge" is most of the body.
         Dropping it to 0.20/4.8 got the mean pixel down from
         201,200,210 to 159,144,162 and that was read as fixed. It was
         not. Isolated figure on a neutral card, course 1, one uniform
         toggled and nothing else:

           rim 0.20 / 4.8   median luma 127, p10 109, p25 111
           rim 0            median luma  46, p10   3, p25  12

         The mean was never the tell. The term is additive, so it
         costs a bright pixel a few percent and a black boot everything
         it has: the whole lower half of the value ladder was being
         compressed into a pastel band, which is exactly the "she is
         camouflaged" verdict the blind critic kept returning. A
         palette cannot outrun an additive term - the costume below is
         authored down at luma 8 to 40 and would arrive on screen at
         111 whatever it says.

         So a character asks for none of it. Even at 0.045 this term
         was still worth (16,37,45) on a mid-body pixel - as much as
         the figure's own rim at five times the strength - because it
         is unweighted and it is the whole surface's fresnel, not the
         silhouette's. The edge light is left entirely to uApRim in
         patchCharacterMaterial, which is hemisphere weighted and so
         lights the top of a shoulder rather than all of it. */
      rim: 0,
    }) || null;
  } catch (err) {
    console.warn("[apop3d] materials.toon refused a character material", err);
  }

  if (!mat) {
    // Local equivalent. MeshToonMaterial already owns the banded
    // ramp; everything else a character needs arrives through the
    // patch above.
    mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      map: atlas.map,
      normalMap: atlas.normalMap,
      gradientMap: toonRamp(),
      dithering: true,
    });
    mat.normalScale.setScalar(0.8);
    mat.userData.apopOwnedRamp = true;
  }

  mat.name = "apop.character";
  mat.vertexColors = true;
  return patchCharacterMaterial(mat, uniforms);
}

/* ------------------------------------------------------------------
   geometry primitives

   All of these return plain arrays rather than BufferGeometry.
   Building forty small BufferGeometries and merging them costs about
   ten times what writing straight into the accumulator does, and a
   course load builds well over a thousand parts.
   ------------------------------------------------------------------ */

function quadMesh(v, faces) {
  const positions = []; const normals = []; const uvs = []; const indices = [];
  let index = 0;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const ab = new THREE.Vector3(); const ac = new THREE.Vector3(); const n = new THREE.Vector3();
  for (const face of faces) {
    a.fromArray(v[face[0]]); b.fromArray(v[face[1]]); c.fromArray(v[face[2]]);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac).normalize();
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

/**
 * A tapered, optionally sheared box.
 *
 * Nothing in a costume is a cuboid, and a taper of even 15% is the
 * difference between a torso and a crate at twenty metres. `pivot`
 * places the origin: "top" for anything hanging off a joint.
 */
function boxGeo(w, h, d, options = {}) {
  const ts = options.topScale ?? 1;
  const bs = options.bottomScale ?? 1;
  const tsz = options.topDepth ?? ts;
  const bsz = options.bottomDepth ?? bs;
  const shear = options.shear ?? 0;
  const lean = options.lean ?? 0;
  const pivot = options.pivot || "centre";
  const y0 = pivot === "top" ? -h : pivot === "bottom" ? 0 : -h * 0.5;
  const y1 = y0 + h;

  const tw = w * 0.5 * ts; const td = d * 0.5 * tsz;
  const bw = w * 0.5 * bs; const bd = d * 0.5 * bsz;

  const v = [
    [-tw + lean, y1, -td + shear], [tw + lean, y1, -td + shear],
    [tw + lean, y1, td + shear], [-tw + lean, y1, td + shear],
    [-bw, y0, -bd], [bw, y0, -bd], [bw, y0, bd], [-bw, y0, bd],
  ];
  const faces = [
    [0, 1, 2, 3], [7, 6, 5, 4],
    [4, 5, 1, 0], [5, 6, 2, 1],
    [6, 7, 3, 2], [7, 4, 0, 3],
  ];
  return quadMesh(v, faces);
}

/** Ellipsoid, smooth shaded. Heads, bellies, shoulder caps. */
function ballGeo(rx, ry, rz, segs = 12, rings = 8, options = {}) {
  const phi0 = options.phi0 ?? 0;
  const phi1 = options.phi1 ?? Math.PI;
  const positions = []; const normals = []; const uvs = []; const indices = [];
  for (let r = 0; r <= rings; r += 1) {
    const phi = lerp(phi0, phi1, r / rings);
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

/** Cone/cylinder. Limbs, mic poles, plant stems, boot shafts. */
function tubeGeo(rTop, rBottom, h, segs = 10, options = {}) {
  const positions = []; const normals = []; const uvs = []; const indices = [];
  const pivot = options.pivot || "centre";
  const y1 = pivot === "top" ? 0 : pivot === "bottom" ? h : h * 0.5;
  const y0 = y1 - h;
  const sq = options.squash ?? 1;   // x radius multiplier: oval limbs
  for (let s = 0; s <= segs; s += 1) {
    const theta = (s / segs) * TAU;
    const cx = Math.cos(theta) * sq; const cz = Math.sin(theta);
    positions.push(cx * rTop, y1, cz * rTop);
    _v.set(cx, (rBottom - rTop) / Math.max(h, 1e-4), cz).normalize();
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
      if (r <= 1e-5) continue;
      const base = positions.length / 3;
      positions.push(0, y, 0); normals.push(0, ny, 0); uvs.push(0.5, 0.5);
      for (let s = 0; s <= segs; s += 1) {
        const theta = (s / segs) * TAU;
        positions.push(Math.cos(theta) * r * sq, y, Math.sin(theta) * r);
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

/** Surface of revolution from a [radius, y] profile. Pots, mic
 *  grilles, platform soles, lens barrels. */
function latheGeo(profile, segs = 12) {
  const positions = []; const normals = []; const uvs = []; const indices = [];
  const rows = profile.length;
  for (let r = 0; r < rows; r += 1) {
    const [rad, y] = profile[r];
    const prev = profile[Math.max(0, r - 1)];
    const next = profile[Math.min(rows - 1, r + 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const nl = Math.hypot(dr, dy) || 1;
    const nr = dy / nl; const ny = -dr / nl;
    for (let s = 0; s <= segs; s += 1) {
      const theta = (s / segs) * TAU;
      const cx = Math.cos(theta); const cz = Math.sin(theta);
      positions.push(cx * rad, y, cz * rad);
      normals.push(cx * nr, ny, cz * nr);
      uvs.push(s / segs, r / (rows - 1));
    }
  }
  for (let r = 0; r < rows - 1; r += 1) {
    for (let s = 0; s < segs; s += 1) {
      const i0 = r * (segs + 1) + s;
      const i1 = i0 + segs + 1;
      indices.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * Loft a flattened tube along a curved spine.
 *
 * This is the single most useful primitive in the file: hair chunks,
 * coat tails, horns, bat wings, plant fronds and the bouncer's velvet
 * rope are all one call to it. A hair chunk built from stacked boxes
 * reads as a staircase; a hair chunk built from a lofted spine with a
 * taper reads as hair.
 *
 * `spine` is [x, y, z, halfWidth, halfThick] per ring. `tip` collapses
 * the last ring to a point, which is what stops every hanging thing in
 * the game from ending in a visible flat rectangle.
 */
function bladeGeo(spine, options = {}) {
  const sides = options.sides ?? 6;
  const tip = options.tip !== false;
  const positions = []; const normals = []; const uvs = []; const indices = [];
  const rows = spine.length;
  /* `ref` decides which way the blade is WIDE, and getting it wrong is
   * the one way to misuse this primitive: a coat panel lofted with the
   * default reference comes out wide front-to-back instead of across
   * the hips, which reads as a plank stuck to the character rather
   * than a panel of cloth. Anything hanging that should be wide across
   * the body passes (0,0,1); anything sweeping sideways passes
   * (0,1,0). */
  const ref = options.ref ? _refA.fromArray(options.ref) : _refA.set(1, 0, 0);
  const refAlt = _refB.set(ref.z, ref.x, ref.y);

  for (let r = 0; r < rows; r += 1) {
    const p = spine[r];
    const prev = spine[Math.max(0, r - 1)];
    const next = spine[Math.min(rows - 1, r + 1)];
    _tan.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (_tan.lengthSq() < 1e-10) _tan.set(0, -1, 0);
    _tan.normalize();
    const up = Math.abs(_tan.dot(ref)) > 0.94 ? refAlt : ref;
    _bx.crossVectors(up, _tan).normalize();
    _bz.crossVectors(_tan, _bx).normalize();

    const hw = Math.max(p[3], 1e-4);
    const ht = Math.max(p[4], 1e-4);
    const shrink = tip && r === rows - 1 ? 0 : 1;
    for (let s = 0; s <= sides; s += 1) {
      const theta = (s / sides) * TAU;
      const cx = Math.cos(theta); const cz = Math.sin(theta);
      positions.push(
        p[0] + _bx.x * cx * hw * shrink + _bz.x * cz * ht * shrink,
        p[1] + _bx.y * cx * hw * shrink + _bz.y * cz * ht * shrink,
        p[2] + _bx.z * cx * hw * shrink + _bz.z * cz * ht * shrink
      );
      _v.set(0, 0, 0)
        .addScaledVector(_bx, cx / hw)
        .addScaledVector(_bz, cz / ht)
        .normalize();
      normals.push(_v.x, _v.y, _v.z);
      uvs.push(s / sides, r / (rows - 1));
    }
  }
  for (let r = 0; r < rows - 1; r += 1) {
    for (let s = 0; s < sides; s += 1) {
      const i0 = r * (sides + 1) + s;
      const i1 = i0 + sides + 1;
      indices.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }
  // Cap the root so a swinging chunk never shows an open pipe.
  if (options.cap !== false) {
    const base = positions.length / 3;
    const p = spine[0];
    positions.push(p[0], p[1], p[2]);
    _tan.set(spine[0][0] - spine[1][0], spine[0][1] - spine[1][1], spine[0][2] - spine[1][2]).normalize();
    normals.push(_tan.x, _tan.y, _tan.z); uvs.push(0.5, 0);
    for (let s = 0; s <= sides; s += 1) {
      const idx = s;
      positions.push(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
      normals.push(_tan.x, _tan.y, _tan.z);
      uvs.push(0.5 + Math.cos((s / sides) * TAU) * 0.5, 0.5 + Math.sin((s / sides) * TAU) * 0.5);
    }
    for (let s = 0; s < sides; s += 1) indices.push(base, base + 1 + s, base + 1 + s + 1);
  }
  return { positions, normals, uvs, indices };
}

/** A flat double-sided disc. Eyes, screens, lens glass, rotor blur. */
function discGeo(rx, ry, segs = 14) {
  const positions = []; const normals = []; const uvs = []; const indices = [];
  for (const nz of [1, -1]) {
    const base = positions.length / 3;
    positions.push(0, 0, 0); normals.push(0, 0, nz); uvs.push(0.5, 0.5);
    for (let s = 0; s <= segs; s += 1) {
      const theta = (s / segs) * TAU;
      positions.push(Math.cos(theta) * rx, Math.sin(theta) * ry, 0);
      normals.push(0, 0, nz);
      uvs.push(0.5 + Math.cos(theta) * 0.5, 0.5 + Math.sin(theta) * 0.5);
    }
    for (let s = 0; s < segs; s += 1) {
      if (nz > 0) indices.push(base, base + 1 + s, base + 1 + s + 1);
      else indices.push(base, base + 1 + s + 1, base + 1 + s);
    }
  }
  return { positions, normals, uvs, indices };
}

/** Flat annulus. Hoop earrings, halos, shield rings, rotor guards. */
function ringGeo(rInner, rOuter, segs = 18) {
  const positions = []; const normals = []; const uvs = []; const indices = [];
  for (const nz of [1, -1]) {
    const base = positions.length / 3;
    for (let s = 0; s <= segs; s += 1) {
      const theta = (s / segs) * TAU;
      const c = Math.cos(theta); const sn = Math.sin(theta);
      positions.push(c * rInner, sn * rInner, 0); normals.push(0, 0, nz); uvs.push(s / segs, 0);
      positions.push(c * rOuter, sn * rOuter, 0); normals.push(0, 0, nz); uvs.push(s / segs, 1);
    }
    for (let s = 0; s < segs; s += 1) {
      const i0 = base + s * 2;
      if (nz > 0) indices.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
      else indices.push(i0, i0 + 2, i0 + 1, i0 + 2, i0 + 3, i0 + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

/* ------------------------------------------------------------------
   proportions and skeleton
   ------------------------------------------------------------------ */

/**
 * Segment lengths as fractions of total height.
 *
 * The fractions are HEROIC CARTOON, not human: the head is a sixth of
 * the figure rather than a seventh and a half, the hands are oversized
 * and the feet are wide. That is not a stylistic flourish, it is the
 * SM64 readability rule - at the distance this camera sits, a
 * realistically proportioned head is four pixels and the character
 * stops having a face.
 *
 * `m` scales individual chains so one template covers a 0.75 m bat and
 * a 2.15 m bouncer.
 */
function proportions(height, m = {}) {
  const h = height;
  const leg = m.leg ?? 1;
  const torso = m.torso ?? 1;
  const arm = m.arm ?? 1;
  const wide = m.wide ?? 1;

  const ankle = 0.035 * h;
  const shin = 0.215 * h * leg;
  const thigh = 0.247 * h * leg;
  const hipDrop = 0.032 * h;

  /* `neck` lifts the head off the shoulders WITHOUT moving the collar
     or the shoulder line with it. A figure whose jaw sits on its own
     shoulder pads has no head in a black-silhouette read - it has a
     lump on top of a wedge - and that was the standing verdict on
     Moggadonna. The collar keeps the un-lifted height (`collarY`), so
     raising this opens a genuine pinch in the outline rather than
     dragging the whole costume up with the skull. */
  const neck = m.neck ?? 1;

  const P = {
    height,
    ankle, shin, thigh, hipDrop,
    hipY: ankle + shin + thigh + hipDrop,
    spineY: 0.059 * h * torso,
    chestY: 0.100 * h * torso,
    neckY: 0.118 * h * torso * neck,
    collarY: 0.118 * h * torso,
    headY: 0.047 * h,
    shoulderX: 0.091 * h * wide,
    shoulderY: 0.056 * h * torso,
    upperArm: 0.150 * h * arm,
    foreArm: 0.138 * h * arm,
    hand: 0.068 * h * arm,
    hipX: 0.056 * h * wide,
    headR: 0.075 * h * (m.head ?? 1),
    /* Scales the head BONE, and therefore everything welded to it and
       every bone parented under it - skull, face, horns, crown, all
       four hair chunks and their offsets - as one shape.
       This is deliberately not `m.head`, which only ever fed `crown`:
       the demon forms author their heads in absolute units and several
       of them ask for `head: 1.9`, so folding the two together would
       double an imp's skull. Anything that wants a physically bigger
       head asks for this by name. */
    headScale: m.headScale ?? 1,
    wide,
    limb: (m.limb ?? 1) * (0.5 + 0.5 * wide),
  };
  P.crown = P.hipY + P.spineY + P.chestY + P.neckY + P.headY + P.headR * 1.5;
  return P;
}

/**
 * The bone tree from CONTRACT.md section 9, plus whatever secondary
 * bones the figure asked for.
 *
 * Extra bones are how hair and coat tails get to move at all. The
 * contract fixes the twenty names anim.js drives; it does not forbid
 * more, and a jacket tail that cannot swing is the difference between
 * a character and a mannequin. anim.js finds them through
 * `rig.secondary`, never by guessing names.
 */
function buildSkeleton(P, extras = []) {
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

  make("root", null, 0, 0, 0);
  make("hips", bones.root, 0, P.hipY, 0);
  make("spine", bones.hips, 0, P.spineY, 0);
  make("chest", bones.spine, 0, P.chestY, 0);
  make("neck", bones.chest, 0, P.neckY, 0);
  make("head", bones.neck, 0, P.headY, 0);
  /* Parts are emitted in bone WORLD space and the skeleton is bound
     from these same matrices, so a scale set here bakes into the mesh
     and cancels out of the skinning - the head simply is bigger. It
     also carries the hair bones, which is what we want: a bigger head
     with the same hair on it, not a bigger head with a wig from the
     old one. Nothing in anim.js touches bone scale except the root's
     squash, so this survives the frame. */
  if (P.headScale && P.headScale !== 1) bones.head.scale.setScalar(P.headScale);

  for (const k of ["L", "R"]) {
    const s = SIDE[k];
    make(`shoulder${k}`, bones.chest, s * P.shoulderX, P.shoulderY, 0);
    make(`arm${k}`, bones[`shoulder${k}`], 0, 0, 0);
    make(`forearm${k}`, bones[`arm${k}`], 0, -P.upperArm, 0);
    make(`hand${k}`, bones[`forearm${k}`], 0, -P.foreArm, 0);
    make(`thigh${k}`, bones.hips, s * P.hipX, -P.hipDrop, 0);
    make(`shin${k}`, bones[`thigh${k}`], 0, -P.thigh, 0);
    make(`foot${k}`, bones[`shin${k}`], 0, -P.shin, 0);
  }

  /* shoulder and arm share an origin on purpose. `shoulder` carries
   * the clavicle shrug and the pad, `arm` carries the swing, so a
   * shrug and a swing can be authored on separate layers instead of
   * fighting over one channel. */

  for (const e of extras) {
    make(e.name, bones[e.parent] || bones.root, e.x || 0, e.y || 0, e.z || 0);
  }

  for (const name of BONE_NAMES) list.push(bones[name]);
  for (const e of extras) list.push(bones[e.name]);
  return { bones, list };
}

/* ------------------------------------------------------------------
   accumulation
   ------------------------------------------------------------------ */

function makeAccumulator() {
  return {
    position: [], normal: [], uv: [], color: [],
    occlusion: [], glow: [], zone: [],
    skinIndex: [], skinWeight: [], index: [], count: 0,
  };
}

/**
 * Baked occlusion, evaluated once in the bind pose.
 *
 * Real-time AO cannot find an armpit, and this game's ambient is a
 * large fraction of its total light, so a figure with no baked term
 * comes out as one value from boot to crown. Three geometric terms
 * put the range back at zero runtime cost:
 *
 *   under   a downward-facing face is under something - a jacket lip,
 *           a helmet brim, a belly, a boot arch
 *   cavity  a face whose normal points back at the body's own axis is
 *           in an armpit, a crotch, or behind a coat panel
 *   ground  everything near the feet sits inside the figure's own
 *           occlusion cone and no bounce fills it
 */
function occlusionAt(px, py, pz, nx, ny, nz, height, bias) {
  const under = clamp01(-ny);
  const radius = Math.hypot(px, pz);
  const inward = clamp01(-(nx * px + nz * pz) / (radius || 1e-5));
  const cavity = inward * (1 - smoothstep(radius / (0.22 * height / 1.7)));
  const ground = 1 - smoothstep(py / (0.34 * height));
  return clamp01(0.38 * under + 0.34 * cavity + 0.28 * ground + (bias || 0));
}

/**
 * Write one primitive into the accumulator.
 *
 * `soft` is how joints stop tearing. A limb tube welded 100% to its
 * own bone shows a hard scissor cut at the knee the moment the leg
 * bends; blending the vertices nearest the joint back toward the
 * PARENT bone by a hand-authored falloff is the whole of the skinning
 * work here, and it is enough at this scale. Two blends per part is
 * the most anything has needed.
 */
function emit(acc, geo, ctxEmit) {
  const {
    boneIndex, colour, tile, uvScale, rng, occBias, glow, zone,
    softs, height, localMat, worldMat, normalMat,
  } = ctxEmit;

  const t = TILES[tile] || TILES.flat;
  const tx = (t.i % ATLAS_GRID) / ATLAS_GRID;
  const ty = Math.floor(t.i / ATLAS_GRID) / ATLAS_GRID;
  const span = 1 / ATLAS_GRID - TILE_INSET * 2;
  const sub = clamp(uvScale ?? 1, 0.15, 1);
  // A random sub-rect per part: constant texel density AND no two
  // panels of the same jacket showing the same patch of weave.
  const ox = rng ? rng() * (1 - sub) : 0;
  const oy = rng ? rng() * (1 - sub) : 0;

  const base = acc.count;
  const n = geo.positions.length / 3;
  for (let i = 0; i < n; i += 1) {
    _v.set(geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]);
    // Soft weights are evaluated in BONE space - before the bone's
    // own world matrix - because "how far below the knee is this
    // vertex" is a statement about the bone, not about the world.
    _v2.copy(_v).applyMatrix4(localMat);
    const localY = _v2.y;

    _v.applyMatrix4(worldMat);
    acc.position.push(_v.x, _v.y, _v.z);
    const px = _v.x; const py = _v.y; const pz = _v.z;

    _v.set(geo.normals[i * 3], geo.normals[i * 3 + 1], geo.normals[i * 3 + 2]);
    _v.applyMatrix3(normalMat).normalize();
    acc.normal.push(_v.x, _v.y, _v.z);

    acc.occlusion.push(occlusionAt(px, py, pz, _v.x, _v.y, _v.z, height, occBias));
    acc.glow.push(glow || 0);
    acc.zone.push(zone);
    acc.uv.push(
      tx + TILE_INSET + (ox + geo.uvs[i * 2] * sub) * span,
      ty + TILE_INSET + (oy + geo.uvs[i * 2 + 1] * sub) * span
    );
    acc.color.push(colour.r, colour.g, colour.b);

    let w0 = 1; let i1 = 0; let w1 = 0; let i2 = 0; let w2 = 0;
    if (softs) {
      for (let s = 0; s < softs.length; s += 1) {
        const soft = softs[s];
        const t01 = clamp01((localY - soft.from) / ((soft.to - soft.from) || 1e-6));
        const w = smoothstep(t01) * (soft.max ?? 0.5);
        if (s === 0) { i1 = soft.index; w1 = w; } else { i2 = soft.index; w2 = w; }
      }
      w0 = Math.max(0, 1 - w1 - w2);
      const sum = w0 + w1 + w2;
      if (sum > 1e-5) { w0 /= sum; w1 /= sum; w2 /= sum; }
    }
    acc.skinIndex.push(boneIndex, i1, i2, 0);
    acc.skinWeight.push(w0, w1, w2, 0);
  }
  for (let i = 0; i < geo.indices.length; i += 1) acc.index.push(base + geo.indices[i]);
  acc.count += n;
}

function finishGeometry(acc) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(acc.position, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(acc.normal, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(acc.color, 3));
  geo.setAttribute("aOcclusion", new THREE.Float32BufferAttribute(acc.occlusion, 1));
  geo.setAttribute("aGlow", new THREE.Float32BufferAttribute(acc.glow, 1));
  geo.setAttribute("aZone", new THREE.Float32BufferAttribute(acc.zone, 1));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(acc.skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(acc.skinWeight, 4));
  geo.setIndex(acc.index);
  return geo;
}

/* ------------------------------------------------------------------
   the build API handed to each figure's part list
   ------------------------------------------------------------------ */

function makeBuilder(bones, boneIndex, acc, P, rng, baseOcc = 0) {
  /**
   * Place a primitive in a bone's local space.
   *
   * opts: x y z rx ry rz sx sy sz   placement
   *       tile uv                   which atlas tile and how much of it
   *       zone glow occ             shading channels
   *       soft                      {bone, from, to, max} or an array
   */
  function part(boneName, geo, colour, opts = {}) {
    const bone = bones[boneName];
    if (!bone) return;
    _pos.set(opts.x || 0, opts.y || 0, opts.z || 0);
    _eul.set(opts.rx || 0, opts.ry || 0, opts.rz || 0, "YXZ");
    _quat.setFromEuler(_eul);
    _scl.set(opts.sx || 1, opts.sy || 1, opts.sz || 1);
    _local.compose(_pos, _quat, _scl);
    _mat4.multiplyMatrices(bone.matrixWorld, _local);
    _nrm3.getNormalMatrix(_mat4);

    let softs = null;
    if (opts.soft) {
      const raw = Array.isArray(opts.soft) ? opts.soft : [opts.soft];
      softs = [];
      for (const s of raw) {
        if (boneIndex[s.bone] === undefined) continue;
        softs.push({ index: boneIndex[s.bone], from: s.from, to: s.to, max: s.max ?? 0.5 });
        if (softs.length === 2) break;
      }
      if (!softs.length) softs = null;
    }

    emit(acc, geo, {
      boneIndex: boneIndex[boneName],
      colour: colour instanceof THREE.Color ? colour : col(colour),
      tile: opts.tile || "flat",
      uvScale: opts.uv,
      rng,
      occBias: (opts.occ || 0) + baseOcc,
      glow: opts.glow,
      zone: opts.zone ?? ZONES.cloth,
      softs,
      height: P.height,
      localMat: _local,
      worldMat: _mat4,
      normalMat: _nrm3,
    });
  }

  /** The same part on both sides. `s` is -1 for L, +1 for R, and the
   *  callback returns the opts, so mirrored placement stays explicit
   *  rather than being guessed from a sign convention. */
  function pair(boneStem, geoFn, colour, optsFn) {
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part(`${boneStem}${k}`, geoFn(s, k), colour, optsFn(s, k) || {});
    }
  }

  return { part, pair, P, rng, bones };
}

/* ------------------------------------------------------------------
   Moggadonna

   The single most important asset in the game, so she is the only
   figure with a hand-written part list rather than a form switch.

   The silhouette is three shapes stacked and nothing else:
     a HAIR SWOOSH that is wider than her shoulders and asymmetric,
     POINTED SHOULDER SPIKES with a flared jacket under them,
     CHUNKY PLATFORM BOOTS that anchor the whole figure.
   Rendered as pure black at 20 m those three read, in that order,
   and no other figure in the roster owns any of them.

   The asymmetry is deliberate and it is doing real work. A mirror-
   symmetric character reads as a doll; the fringe sweeping to her
   left, the cyan streak on her right and the single long tail are
   what make a frame of her look posed rather than instanced.
   ------------------------------------------------------------------ */

/* The tails hang off the SIDES of the head and slightly FORWARD of
 * the ear. Rendered as a black silhouette the old placement produced
 * a plain hooded outline, because the tails fell inside the shoulder
 * line and never broke it; carried outboard they are the widest thing
 * on the figure above the waist, which is the read the whole design
 * is built on. Forward of the ear rather than behind it because a
 * tail that falls straight down the back of a shoulder spike welds
 * the head to the shoulders and the head stops being a shape. */
const MOG_HAIR_BONES = [
  { name: "hairFringe", parent: "head", x: 0, y: 0.058, z: -0.058 },
  { name: "hairL", parent: "head", x: -0.112, y: 0.052, z: -0.010 },
  { name: "hairR", parent: "head", x: 0.112, y: 0.052, z: -0.010 },
  { name: "hairBack", parent: "head", x: 0, y: 0.020, z: 0.104 },
];

const MOG_COAT_BONES = [
  { name: "coatFL", parent: "hips", x: -0.102, y: -0.055, z: -0.088 },
  { name: "coatFR", parent: "hips", x: 0.102, y: -0.055, z: -0.088 },
  { name: "coatBL", parent: "hips", x: -0.112, y: -0.035, z: 0.104 },
  { name: "coatBR", parent: "hips", x: 0.112, y: -0.035, z: 0.104 },
];

/* ---- palette ------------------------------------------------------
   Authored as a VALUE LADDER against a named background, with the
   hues fitted to it afterwards. This is the single most consequential
   block in the file and it is worth saying why.

   Four rounds of blind A/B against real Super Mario 64 frames were
   lost on focal clarity, the last of them 0 pairs out of 9, with the
   critic's verdict being that the character "reads legibly in zero"
   frames and is "camouflaged by design". The fault was structural,
   not a shading bug: every SM64 frame contains one red-hatted figure
   at high value contrast against its ground, and Course 1 is a warm
   mall - cream terrazzo, tan wall, orange trim, luma 180-215, hue
   around 30 degrees - while the costume was pale pink and lavender.
   Same value AND same hue family as the entire set.

   So the costume is now COLD and DARK and the accents are hot. The
   level owns warm and light; she owns the other end of both axes.
   Approximate Rec.601 luma of every entry, which is the number that
   was actually designed:

     boot 8 · suit 15 · glove 20 · horn 25      the dark anchor
     jacketDark 17                              the collar behind her head
     jacket 40                                  the big cold mass
     lining 68 · hairDeep 66                    the mid separators
     lapel / lips 88                            the crimson identity flash
     hair 113                                   the one hot accent
     streak 174 · trim 181                      thin bright hardware
     skin 205 · sclera 248                      the face, and only the face

   Every adjacency in the model crosses at least ~25 of that ladder
   and most cross more than 45. The largest masses - jacket, leggings,
   boots, gloves - now sit between 8 and 40 against a ground at 200.

   Identity is preserved where it is legible rather than where it is
   traditional: the hot pink hair is the loudest thing on screen, the
   crimson survives as the lapel V, the coat lining, and her mouth,
   and the gold hardware is untouched. What changed is the body of the
   tailcoat, from crimson to midnight indigo - which is also the one
   hue a food court has none of.
   ------------------------------------------------------------------ */
const MOG_PALETTE = {
  /* The face, and only the face, is allowed above the floor's value.
     Dropped from 0xf3c49b because that arrived with a p75 of 191 on
     the isolated figure - the lit cheek was a brighter mass than the
     terrazzo behind her, on the one part of the model that is supposed
     to draw the eye by being the most DETAILED thing in frame rather
     than the palest. Warmer and deeper reads as stage light on skin
     and still leaves the face the lightest note on the head. */
  skin: 0xdda67c,
  /* THE reserved hue. Nothing else in the game is magenta, and after
     the fresnel fix (see patchCharacterMaterial) this is finally a
     colour rather than a value: the hair used to render at luma 124
     with its albedo forced to pure black, because the zone chip set a
     floor under it. It now tracks what it is authored at.
     Kept deep on purpose. The head reads as the focal point because it
     is the most saturated region on the figure and carries every small
     bright accent - the cyan streak, the gold rings, the eyes - not
     because it is the brightest mass. That is the difference between
     separation and glare, and it is what four blind rounds were
     failing on. */
  /* Value target, measured rather than picked. Isolated against the
     background she actually occludes, her head sat at luma 61 in situ
     while course 1's floor runs p25 96 / p50 116 / p75 161. That is a
     comfortable read against a lit tile and a thin one - under 40 -
     against the darker quarter of the floor, and the brief for this
     figure is a delta of at least 40 with ONE sign everywhere. Ten
     points of albedo, same hue, same saturation, buys it. */
  hair: 0x950b4e,
  hairDeep: 0x5c0530,
  streak: 0x2ee0ff,
  jacket: 0x242159,
  jacketDark: 0x100d2b,
  // The coat's lining, and the lapel V. This is where the crimson
  // lives now: two mid-value red panels flashing out of a near-black
  // costume, which is a louder statement of the brand than a whole
  // crimson jacket that shared a value with the floor.
  lining: 0xb01033,
  lapel: 0xe8143c,
  suit: 0x0f0b23,
  // Elbow-length opera gloves. They exist so the forearms stop
  // vanishing into the jacket every time an arm crosses the chest -
  // same family as the boots, so the figure ends dark at all four
  // limbs and the indigo stays one unbroken mass in between.
  glove: 0x130f2d,
  trim: 0xf7b21a,
  boot: 0x080514,
  lips: 0xe8143c,
  sclera: 0xfdf6ff,
  iris: 0x120720,
  horn: 0x1c1230,
  glow: 0x2ee0ff,
};

function moggadonnaParts(api, spec) {
  const { part, pair, P, bones } = api;
  const C = spec.palette;
  const L = P.limb;
  const variant = spec.variant || "diva";
  const longCoat = variant !== "diva";

  /* ------------------------------ legs ------------------------------
     Read bottom-up, because that is the order the silhouette is built
     in: a heavy boot, a tapering shaft, a narrow thigh. Putting the
     visual weight at the bottom is what stops a stylised figure from
     looking like it is about to fall over. */

  pair("thigh", () => tubeGeo(0.082 * L, 0.064 * L, P.thigh, 10, { pivot: "top", squash: 1.06 }),
    C.suit, () => ({ tile: "satin", zone: ZONES.cloth, uv: 0.7, occ: 0.10,
      soft: { bone: "hips", from: -0.11, to: 0.01, max: 0.6 } }));

  // Thigh-high boots. The shaft starts ABOVE the knee and is skinned
  // back into the thigh, so the boot bends with the leg instead of
  // scissoring open at the joint.
  pair("shin", () => tubeGeo(0.094 * L, 0.070 * L, P.shin + 0.16, 12, { pivot: "top", squash: 1.05 }),
    C.boot, (s, k) => ({ y: 0.16, tile: "leather", zone: ZONES.boot, uv: 0.8,
      soft: { bone: `thigh${k}`, from: -0.04, to: 0.14, max: 0.72 } }));
  pair("shin", (s, k) => latheGeo([
    [0.084 * L, 0.0], [0.110 * L, 0.030], [0.126 * L, 0.052], [0.098 * L, 0.062],
  ], 12), C.trim, (s, k) => ({ y: 0.145, tile: "chrome", zone: ZONES.trim, uv: 0.5,
    soft: { bone: `thigh${k}`, from: 0.02, to: 0.16, max: 0.8 } }));

  // The boot itself is deliberately oversized. Course 1 fills the
  // frame with crates at almost exactly her scale, so the eye has no
  // size reference and she reads as one more box; a figure whose feet
  // are visibly too big for it cannot be mistaken for cargo.
  pair("foot", () => boxGeo(0.180 * L, 0.168, 0.330, {
    pivot: "bottom", topScale: 0.92, bottomScale: 1.0, topDepth: 0.86,
  }), C.boot, () => ({ y: -P.ankle + 0.052, z: -0.062, tile: "leather", zone: ZONES.boot, uv: 0.9 }));
  // Platform sole. Gold and proud of the upper on every side: it is a
  // bright welt under a black mass, which is what makes the feet read
  // as feet from above - the angle this camera spends most of its
  // time at - without becoming a pale block against a pale floor.
  pair("foot", () => boxGeo(0.204 * L, 0.056, 0.372, {
    pivot: "bottom", topScale: 1.0, bottomScale: 0.94, shear: -0.008,
  }), C.trim, () => ({ y: -P.ankle, z: -0.062, tile: "chrome", zone: ZONES.trim, uv: 0.45, occ: 0.3 }));
  pair("foot", () => ballGeo(0.086 * L, 0.072, 0.074, 10, 6), C.boot,
    () => ({ y: -P.ankle + 0.118, z: -0.205, tile: "leather", zone: ZONES.boot, uv: 0.4 }));

  /* ----------------------------- torso ----------------------------- */

  part("hips", boxGeo(0.245 * P.wide, 0.19, 0.185, { topScale: 0.94, bottomScale: 0.80 }),
    C.suit, { y: -0.02, tile: "satin", zone: ZONES.cloth, uv: 0.8, occ: 0.12 });
  part("spine", boxGeo(0.225 * P.wide, P.chestY + 0.03, 0.175, {
    pivot: "bottom", topScale: 1.20, bottomScale: 0.92,
  }), C.suit, { y: -0.02, tile: "satin", zone: ZONES.cloth, uv: 0.9, occ: 0.14 });
  part("chest", boxGeo(0.275 * P.wide, 0.215, 0.195, {
    pivot: "bottom", topScale: 0.92, bottomScale: 1.0,
  }), C.suit, { y: -0.055, tile: "satin", zone: ZONES.cloth, uv: 0.9, occ: 0.16 });
  if (variant === "diva") {
    // Stylised, two soft masses. Anything more anatomical fights the
    // cel ramp and reads as noise at platforming distance.
    part("chest", ballGeo(0.062, 0.055, 0.050, 10, 6), C.suit,
      { x: -0.058, y: 0.048, z: -0.078, tile: "satin", zone: ZONES.cloth, uv: 0.3 });
    part("chest", ballGeo(0.062, 0.055, 0.050, 10, 6), C.suit,
      { x: 0.058, y: 0.048, z: -0.078, tile: "satin", zone: ZONES.cloth, uv: 0.3 });
  }

  /* ---------------------------- jacket ----------------------------
     One flared shell rather than a front and a back. The flare is the
     whole point: a straight jacket makes an hourglass figure read as a
     tube, and the hem is where the coat tails hang from. */

  part("chest", boxGeo(0.285 * P.wide, 0.40, 0.225, {
    pivot: "top", topScale: 1.06, bottomScale: 1.48, topDepth: 1.0, bottomDepth: 1.34,
  }), C.jacket, { y: 0.105, z: 0.012, tile: "satin", zone: ZONES.cloth, uv: 1,
    soft: { bone: "spine", from: 0.06, to: -0.24, max: 0.55 } });
  // Gold hem band. A hard bright line across the bottom of the flare
  // stops the jacket dissolving into the legs at distance.
  part("chest", boxGeo(0.285 * P.wide, 0.050, 0.225, {
    pivot: "top", topScale: 1.48, bottomScale: 1.44, topDepth: 1.34, bottomDepth: 1.30,
  }), C.trim, { y: -0.288, z: 0.012, tile: "chrome", zone: ZONES.trim, uv: 0.4, occ: 0.2,
    soft: { bone: "spine", from: 0.0, to: -0.30, max: 0.55 } });

  // Lapels: a deep pearl V down the front. This is the read that says
  // "the jacket is open" without modelling an opening.
  for (const k of ["L", "R"]) {
    const s = SIDE[k];
    part("chest", bladeGeo([
      [s * 0.105, 0.115, -0.108, 0.052, 0.014],
      [s * 0.082, 0.020, -0.122, 0.056, 0.016],
      [s * 0.040, -0.090, -0.118, 0.048, 0.014],
      [s * 0.016, -0.175, -0.100, 0.026, 0.010],
    ], { ref: [0, 0, 1], sides: 6 }), C.lapel,
    { tile: "satin", zone: ZONES.cloth, uv: 0.5 });
  }

  /* --------------------------- shoulders ---------------------------
     Pointed spikes, and they are more than half of what makes her
     silhouette hers.

     They used to sweep UP as well as out, on the reasoning that a
     horizontal spike is hidden when an arm comes across the chest -
     which the old idle did constantly. The tip therefore finished at
     +0.070 above the shoulder joint, ABOVE the bottom of the skull, and
     the head had nowhere to be: crown, jaw and shoulder pad were one
     continuous black mass from the front.
     The idle no longer tucks the arms (see anim.js), so the spikes are
     free to do the job they are actually for: they now rake slightly
     DOWN and a good deal further OUT, which opens the wedge under the
     head and takes the figure's widest point to 0.88 m on a 1.7 m
     frame. Wide-low against narrow-high is the whole read. */

  pair("shoulder", (s) => bladeGeo([
    [0, -0.032, 0, 0.104, 0.104],
    [s * 0.112, -0.020, 0.004, 0.100, 0.104],
    [s * 0.216, -0.040, 0.010, 0.060, 0.066],
    [s * 0.302, -0.068, 0.014, 0.015, 0.019],
  ], { sides: 6 }), C.jacket, () => ({ tile: "satin", zone: ZONES.cloth, uv: 0.8, occ: 0.06 }));
  pair("shoulder", (s) => bladeGeo([
    [s * 0.036, -0.014, -0.072, 0.030, 0.014],
    [s * 0.146, -0.022, -0.040, 0.026, 0.012],
    [s * 0.248, -0.048, 0.002, 0.016, 0.008],
  ], { sides: 4 }), C.trim, () => ({ tile: "chrome", zone: ZONES.trim, uv: 0.3 }));

  /* ---------------------------- collar ----------------------------
     Popped, and it frames the head from BEHIND. Every stage costume in
     the reference art has one, and it is the darkest panel on the
     costume on purpose - it is the card the magenta hair is read
     against from three quarters of the angles this camera sees.

     It used to be the other half of why she had no head. Anchored to
     P.neckY it rose to 0.38 above the chest bone, which is ABOVE the
     centre of the skull, and at half-width 0.168 it was wider than the
     crown itself - so in a black silhouette the head and the shoulders
     were one uninterrupted mass with the collar filling the join.
     It now sits on `collarY`, which does not follow the neck lift, it
     tops out below the jaw, and it is narrower than the crown so the
     head is the widest thing at the top of the figure. It also rakes
     back harder, which is what keeps it a collar rather than a hood. */
  part("chest", bladeGeo([
    [0, P.collarY - 0.080, 0.058, 0.128, 0.018],
    [0, P.collarY + 0.005, 0.118, 0.132, 0.019],
    [0, P.collarY + 0.078, 0.188, 0.112, 0.016],
    [0, P.collarY + 0.122, 0.240, 0.072, 0.012],
  ], { ref: [0, 0, 1], sides: 6, tip: false }), C.jacketDark,
  { tile: "satin", zone: ZONES.cloth, uv: 0.6, occ: 0.14 });
  part("chest", bladeGeo([
    [0, P.collarY + 0.066, 0.180, 0.114, 0.008],
    [0, P.collarY + 0.126, 0.243, 0.073, 0.007],
  ], { ref: [0, 0, 1], sides: 4, tip: false }), C.trim,
  { tile: "chrome", zone: ZONES.trim, uv: 0.25 });

  /* ----------------------------- arms ----------------------------- */

  pair("arm", () => tubeGeo(0.072 * L, 0.056 * L, P.upperArm + 0.015, 10, { pivot: "top" }),
    C.jacket, (s, k) => ({ tile: "satin", zone: ZONES.cloth, uv: 0.6, occ: 0.10,
      soft: { bone: `shoulder${k}`, from: -0.09, to: 0.01, max: 0.5 } }));
  // Opera glove from the elbow down. The forearm used to be jacket
  // coloured, so every pose that brings a hand across the body - the
  // idle, the beam, the carry - lost the whole arm into the torso.
  // Dark ends on all four limbs is also how a stylised figure gets
  // its gesture back at 1/6 frame height.
  pair("forearm", () => tubeGeo(0.058 * L, 0.046 * L, P.foreArm, 10, { pivot: "top" }),
    C.glove, (s, k) => ({ tile: "leather", zone: ZONES.boot, uv: 0.6,
      soft: { bone: `arm${k}`, from: -0.08, to: 0.01, max: 0.5 } }));
  // Flared cuffs. Wide sleeve ends read as gesture even when the hand
  // itself is only twenty pixels across.
  pair("forearm", () => latheGeo([
    [0.052 * L, 0.0], [0.068 * L, -0.035], [0.106 * L, -0.078], [0.092 * L, -0.090],
  ], 12), C.trim, () => ({ y: -P.foreArm + 0.055, tile: "chrome", zone: ZONES.trim, uv: 0.4, occ: 0.18 }));

  // Oversized hands, per the heroic-cartoon rule. A correctly scaled
  // hand disappears at this camera distance and every gesture with it.
  pair("hand", () => boxGeo(0.080 * L, 0.108, 0.056, {
    pivot: "top", topScale: 1.0, bottomScale: 0.80, topDepth: 1.0, bottomDepth: 0.9,
  }), C.glove, () => ({ y: -0.008, tile: "leather", zone: ZONES.boot, uv: 0.4 }));
  pair("hand", (s) => boxGeo(0.030, 0.062, 0.032, { pivot: "top", bottomScale: 0.8 }),
    C.glove, (s) => ({ x: s * 0.046, y: -0.030, z: -0.014, rz: s * 0.55, rx: -0.25,
      tile: "leather", zone: ZONES.boot, uv: 0.25 }));

  /* ----------------------------- head ----------------------------- */

  /* The neck is a silhouette part, not an anatomy part. It has to
     actually OCCUPY the band between the collar and the jaw, or the
     pinch that separates the head from the shoulders is a hole with
     nothing in it and the head reads as floating. It used to be a
     0.10 stub sitting at +0.02, which after the neck lift was entirely
     inside the skull and contributed nothing. */
  part("neck", tubeGeo(0.052, 0.062, 0.17, 8, { caps: false }), C.skin,
    { y: -0.048, tile: "skin", zone: ZONES.skin, uv: 0.3, occ: 0.5 });

  part("head", ballGeo(0.108, 0.128, 0.112, 14, 10), C.skin,
    { y: 0.016, tile: "skin", zone: ZONES.skin, uv: 0.6, occ: 0.06 });
  part("head", boxGeo(0.120, 0.115, 0.125, {
    pivot: "top", topScale: 1.0, bottomScale: 0.58, topDepth: 1.0, bottomDepth: 0.72,
  }), C.skin, { y: 0.030, z: -0.008, tile: "skin", zone: ZONES.skin, uv: 0.5, occ: 0.10 });

  // Eyes. Big, flat-fronted and dark-ringed, because at platforming
  // distance an eye is one or two pixels of value contrast and a
  // subtle one is no eye at all.
  for (const k of ["L", "R"]) {
    const s = SIDE[k];
    part("head", ballGeo(0.044, 0.054, 0.026, 12, 8), C.sclera,
      { x: s * 0.049, y: 0.030, z: -0.092, tile: "flat", zone: ZONES.eye, uv: 0.4, occ: -0.1 });
    part("head", discGeo(0.027, 0.035, 14), C.iris,
      { x: s * 0.053, y: 0.028, z: -0.113, ry: Math.PI, tile: "flat", zone: ZONES.eye });
    part("head", discGeo(0.010, 0.012, 8), 0xffffff,
      { x: s * 0.046, y: 0.041, z: -0.116, ry: Math.PI, tile: "flat", zone: ZONES.glow, glow: 0.7 });
    // Lashes and brow as one angular slab each: the brow angle is the
    // only facial expression a cel-shaded head this size can hold.
    part("head", boxGeo(0.062, 0.013, 0.020), C.hairDeep,
      { x: s * 0.052, y: 0.070, z: -0.098, rz: s * -0.30, tile: "flat", zone: ZONES.hair, uv: 0.2 });
    part("head", boxGeo(0.056, 0.010, 0.016), C.iris,
      { x: s * 0.050, y: 0.056, z: -0.104, rz: s * -0.22, tile: "flat", zone: ZONES.hair, uv: 0.2 });
    // Hoop earring. Pure silhouette, two triangles wide.
    part("head", ringGeo(0.026, 0.036, 16), C.trim,
      { x: s * 0.104, y: -0.036, z: 0.010, ry: Math.PI * 0.5, tile: "chrome", zone: ZONES.trim });
  }

  part("head", boxGeo(0.050, 0.020, 0.022, { topScale: 0.8 }), C.lips,
    { y: -0.048, z: -0.098, tile: "flat", zone: ZONES.skin, uv: 0.2 });
  part("head", boxGeo(0.036, 0.014, 0.018), C.lips,
    { y: -0.030, z: -0.100, tile: "flat", zone: ZONES.skin, uv: 0.2 });

  // Horns. She is a demon mogger; two swept horns are the cheapest
  // possible statement of that and they widen the head outline.
  for (const k of ["L", "R"]) {
    const s = SIDE[k];
    part("head", bladeGeo([
      [s * 0.078, 0.104, 0.008, 0.030, 0.030],
      [s * 0.124, 0.180, 0.056, 0.024, 0.024],
      [s * 0.146, 0.238, 0.132, 0.016, 0.016],
      [s * 0.140, 0.256, 0.204, 0.005, 0.005],
    ], { sides: 6 }), C.horn, { tile: "chrome", zone: ZONES.hard, uv: 0.3 });
    part("head", latheGeo([[0.028, 0], [0.032, 0.014], [0.026, 0.020]], 10), C.trim,
      { x: s * 0.074, y: 0.094, z: 0.006, rz: s * -0.35, tile: "chrome", zone: ZONES.trim, uv: 0.2 });
  }

  /* ------------------------------ hair ------------------------------
     Five chunks. The crown is welded to the head; the other four hang
     off their own bones so anim.js can spring them. Nothing else in
     this file buys as much perceived production value per triangle. */

  part("head", ballGeo(0.144, 0.132, 0.146, 14, 9), C.hair,
    { y: 0.062, z: 0.014, tile: "hair", zone: ZONES.hair, uv: 0.9 });
  part("head", boxGeo(0.212, 0.168, 0.122, {
    pivot: "top", topScale: 1.0, bottomScale: 0.86, topDepth: 1.0, bottomDepth: 0.8,
  }), C.hair, { y: 0.108, z: 0.092, tile: "hair", zone: ZONES.hair, uv: 0.8, occ: 0.16 });

  // The fringe: one big wave sweeping to her left and curling back.
  // It reaches past the outline of the head on purpose - it is the
  // asymmetry that says which way she is facing in a black-silhouette
  // read, and it is the first thing that separates her from a crate.
  part("hairFringe", bladeGeo([
    [0, 0.000, 0.000, 0.104, 0.056],
    [-0.078, 0.070, -0.034, 0.112, 0.052],
    [-0.172, 0.088, -0.006, 0.086, 0.040],
    [-0.244, 0.036, 0.058, 0.040, 0.022],
  ], { ref: [0, 1, 0], sides: 6 }), C.hair,
  { tile: "hair", zone: ZONES.hair, uv: 0.8 });
  part("hairFringe", bladeGeo([
    [0.020, 0.010, -0.052, 0.044, 0.026],
    [0.078, 0.046, -0.060, 0.038, 0.022],
    [0.118, 0.016, -0.018, 0.016, 0.010],
  ], { ref: [0, 1, 0], sides: 5 }), C.hairDeep,
  { tile: "hair", zone: ZONES.hair, uv: 0.5 });

  /* The side tails.
   *
   * These are the pieces that decide whether she has a head. The
   * previous shape swung out to shoulder width and then fell to
   * 0.61 below the ear - straight down through the one band of the
   * figure, between the jaw and the shoulder pad, where the outline
   * has to come IN if the head is going to read as a separate shape.
   * As a black silhouette that produced a single mass from crown to
   * hip with no neck in it anywhere.
   *
   * They now do their widening at CROWN height, where a wide shape
   * makes the head bigger, and tuck back toward the neck as they fall
   * so that at collar height they are no wider than the collar itself.
   * The figure reads head-wide, neck-narrow, shoulder-wide, which is
   * three shapes instead of one. The long fall of hair is not lost -
   * hairBack still carries it, and being centred it costs the front
   * outline nothing while reading fully in profile and three-quarter.
   */
  part("hairL", bladeGeo([
    [0, 0.030, 0, 0.084, 0.064],
    [-0.086, -0.016, 0.020, 0.096, 0.070],
    [-0.106, -0.094, 0.042, 0.064, 0.050],
    [-0.090, -0.164, 0.038, 0.015, 0.013],
  ], { ref: [0, 0, 1], sides: 6 }), C.hair,
  { tile: "hair", zone: ZONES.hair, uv: 1 });

  // Right tail: shorter, and the cyan streak lives on it. One accent
  // chunk on one side is the whole of the asymmetry budget.
  part("hairR", bladeGeo([
    [0, 0.030, 0, 0.080, 0.060],
    [0.086, -0.014, 0.022, 0.090, 0.066],
    [0.094, -0.086, 0.044, 0.052, 0.040],
    [0.074, -0.140, 0.040, 0.012, 0.011],
  ], { ref: [0, 0, 1], sides: 6 }), C.hair,
  { tile: "hair", zone: ZONES.hair, uv: 1 });
  part("hairR", bladeGeo([
    [0.064, 0.032, -0.040, 0.030, 0.020],
    [0.110, -0.030, -0.014, 0.032, 0.020],
    [0.112, -0.098, 0.020, 0.022, 0.014],
    [0.086, -0.148, 0.030, 0.007, 0.006],
  ], { ref: [0, 0, 1], sides: 5 }), C.streak,
  { tile: "hair", zone: ZONES.hair, uv: 0.8, glow: 0.10 });

  /* The long fall of hair, and the only piece still allowed to reach
     the shoulders - because it is CENTRED. A centred mass costs the
     front outline nothing (it is narrower than the head above it and
     the collar beside it) while reading at full length in profile and
     three-quarter, which is where a pop frontwoman's hair has to be
     seen. It is waisted through the neck band on purpose. */
  part("hairBack", bladeGeo([
    [0, 0.010, 0, 0.124, 0.062],
    [0, -0.136, 0.030, 0.112, 0.064],
    [0, -0.282, 0.046, 0.104, 0.050],
    [0, -0.396, 0.040, 0.050, 0.026],
    [0, -0.458, 0.026, 0.012, 0.008],
  ], { ref: [0, 0, 1], sides: 6 }), C.hairDeep,
  { tile: "hair", zone: ZONES.hair, uv: 1, occ: 0.10 });

  /* --------------------------- coat tails --------------------------
     Four panels off the jacket hem. The back pair is twice as long as
     the front pair, which is what turns a walk cycle into a swagger
     the moment anim.js springs them. */

  const frontLen = longCoat ? 0.42 : 0.30;
  const backLen = longCoat ? 0.74 : 0.60;
  for (const k of ["L", "R"]) {
    const s = SIDE[k];
    // Front panels are the coat's LINING, so the crimson she is known
    // for is the thing hanging in front of a near-black legging - the
    // one warm-red shape on a cold costume, and a value step of about
    // fifty against everything it touches.
    part(`coatF${k}`, bladeGeo([
      [0, 0.010, 0, 0.092, 0.020],
      [s * 0.030, -frontLen * 0.45, -0.020, 0.102, 0.020],
      [s * 0.054, -frontLen * 0.85, -0.046, 0.084, 0.017],
      [s * 0.066, -frontLen, -0.062, 0.046, 0.012],
    ], { ref: [0, 0, 1], sides: 6, tip: false }), C.lining,
    { tile: "satin", zone: ZONES.cloth, uv: 0.9, occ: 0.18 });

    part(`coatB${k}`, bladeGeo([
      [0, 0.010, 0, 0.110, 0.022],
      [s * 0.026, -backLen * 0.35, 0.030, 0.126, 0.024],
      [s * 0.048, -backLen * 0.70, 0.062, 0.102, 0.020],
      [s * 0.062, -backLen * 0.92, 0.078, 0.056, 0.014],
      [s * 0.068, -backLen, 0.082, 0.014, 0.006],
    ], { ref: [0, 0, 1], sides: 6 }), C.jacket,
    { tile: "satin", zone: ZONES.cloth, uv: 1, occ: 0.12 });
    part(`coatB${k}`, bladeGeo([
      [s * 0.088, -backLen * 0.30, 0.028, 0.016, 0.010],
      [s * 0.108, -backLen * 0.72, 0.062, 0.013, 0.008],
      [s * 0.110, -backLen * 0.96, 0.080, 0.006, 0.004],
    ], { ref: [0, 0, 1], sides: 4 }), C.trim,
    { tile: "chrome", zone: ZONES.trim, uv: 0.25 });
  }
}

/** The mic she actually holds. Small, so it does not fight the hair. */
function micParts(api, C) {
  const { part } = api;
  part("prop", tubeGeo(0.016, 0.019, 0.115, 8, { pivot: "top" }), C.suit,
    { tile: "leather", zone: ZONES.boot, uv: 0.3 });
  part("prop", tubeGeo(0.022, 0.020, 0.020, 8), C.trim,
    { y: 0.005, tile: "chrome", zone: ZONES.trim, uv: 0.2 });
  part("prop", ballGeo(0.030, 0.032, 0.030, 10, 7), C.trim,
    { y: 0.038, tile: "sequin", zone: ZONES.hard, uv: 0.6 });
  part("prop", ballGeo(0.020, 0.020, 0.020, 8, 5), C.glow,
    { y: 0.048, z: -0.014, tile: "flat", zone: ZONES.glow, glow: 1.0 });
}

/** The full stand, for the victory pose and the carry state. */
function micStandParts(api, C) {
  const { part } = api;
  part("prop", latheGeo([
    [0.135, 0.0], [0.140, 0.014], [0.105, 0.026], [0.038, 0.034], [0.030, 0.044],
  ], 14), C.suit, { tile: "chrome", zone: ZONES.hard, uv: 0.6, occ: 0.4 });
  part("prop", tubeGeo(0.014, 0.019, 0.62, 8, { pivot: "bottom" }), C.trim,
    { y: 0.040, tile: "chrome", zone: ZONES.hard, uv: 0.5 });
  part("prop", tubeGeo(0.011, 0.014, 0.34, 8, { pivot: "bottom" }), C.trim,
    { y: 0.640, tile: "chrome", zone: ZONES.hard, uv: 0.4 });
  part("prop", tubeGeo(0.024, 0.024, 0.034, 8), C.suit,
    { y: 0.640, tile: "leather", zone: ZONES.boot, uv: 0.2 });
  part("prop", bladeGeo([
    [0, 0.965, 0, 0.012, 0.012],
    [0, 1.010, -0.030, 0.011, 0.011],
    [0, 1.012, -0.078, 0.010, 0.010],
  ], { sides: 6, tip: false }), C.trim, { tile: "chrome", zone: ZONES.hard, uv: 0.3 });
  part("prop", ballGeo(0.034, 0.036, 0.034, 10, 7), C.trim,
    { y: 1.012, z: -0.098, tile: "sequin", zone: ZONES.hard, uv: 0.6 });
  part("prop", ballGeo(0.022, 0.022, 0.022, 8, 5), C.glow,
    { y: 1.014, z: -0.116, tile: "flat", zone: ZONES.glow, glow: 1.0 });
}

/* ------------------------------------------------------------------
   the demon roster

   Eight archetypes, one shared body builder and a bespoke head each.
   The body builder is data-driven because the eight bodies differ by
   PROPORTION rather than by construction - a bouncer is a pig that
   went to the gym - while the heads differ completely, and the head
   is what the player actually reads. Colour is a second-order cue:
   the 2D game's palette is kept exactly so a returning player already
   knows what each colour means before it has finished walking on.
   ------------------------------------------------------------------ */

/** Two eyes and their pupils, on whichever bone the head lives on. */
function demonEyes(api, o) {
  const { part } = api;
  for (const k of ["L", "R"]) {
    const s = SIDE[k];
    part(o.bone || "head", ballGeo(o.r, o.r * 1.2, o.r * 0.55, 10, 6), o.sclera, {
      x: s * o.spread, y: o.y, z: o.z, tile: "flat", zone: ZONES.eye, occ: -0.1,
    });
    part(o.bone || "head", discGeo(o.r * 0.55, o.r * 0.72, 10), o.pupil, {
      x: s * (o.spread + (o.converge || 0) * -s), y: o.y, z: o.z - o.r * 0.5,
      ry: Math.PI, tile: "flat", zone: o.glow ? ZONES.glow : ZONES.eye, glow: o.glow || 0,
    });
  }
}

/**
 * Torso, limbs and feet from numbers.
 *
 * `o.arms` and `o.legs` name a build rather than a length: "noodle"
 * limbs are thin and even, "thick" ones taper hard into a heavy hand,
 * "stub" legs barely clear the body. Reaching for a shared humanoid
 * and scaling it is what makes a bestiary read as one creature in
 * eight costumes.
 */
function demonBase(api, spec, o) {
  const { part, pair, P } = api;
  const C = spec.palette;
  const L = P.limb;
  const armR0 = (o.armR ?? 0.055) * L;
  const legR0 = (o.legR ?? 0.062) * L;

  if (o.torso !== "none") {
    part("hips", boxGeo(0.26 * P.wide, 0.17 * (o.torsoH ?? 1), 0.21 * P.wide, {
      topScale: o.hipTaper ?? 0.95, bottomScale: 0.82,
    }), C.body, { y: -0.01, tile: o.skinTile || "fuzz", zone: ZONES.cloth, uv: 0.8, occ: 0.12 });

    part("spine", boxGeo(0.245 * P.wide, P.chestY + 0.02, 0.20 * P.wide, {
      pivot: "bottom", topScale: o.waistFlare ?? 1.1, bottomScale: 0.9,
    }), C.body, { y: -0.02, tile: o.skinTile || "fuzz", zone: ZONES.cloth, uv: 0.9, occ: 0.16 });

    part("chest", boxGeo(0.30 * P.wide, 0.22, 0.225 * P.wide, {
      pivot: "bottom", topScale: o.shoulderFlare ?? 1.0, bottomScale: 0.95,
    }), C.body, { y: -0.06, tile: o.skinTile || "fuzz", zone: ZONES.cloth, uv: 0.9, occ: 0.18 });
  }

  if (o.arms !== "none") {
    const thick = o.arms === "thick";
    pair("arm", () => tubeGeo(armR0 * (thick ? 1.35 : 1), armR0 * (thick ? 1.0 : 0.82),
      P.upperArm, 8, { pivot: "top" }), C.limb,
    (s, k) => ({ tile: o.limbTile || "fuzz", zone: ZONES.cloth, uv: 0.5,
      soft: { bone: `shoulder${k}`, from: -0.08, to: 0.01, max: 0.5 } }));
    pair("forearm", () => tubeGeo(armR0 * (thick ? 1.05 : 0.84), armR0 * (thick ? 0.9 : 0.7),
      P.foreArm, 8, { pivot: "top" }), C.limb,
    (s, k) => ({ tile: o.limbTile || "fuzz", zone: ZONES.cloth, uv: 0.5,
      soft: { bone: `arm${k}`, from: -0.07, to: 0.01, max: 0.5 } }));
    pair("hand", () => boxGeo(0.072 * L * (thick ? 1.5 : 1), 0.085 * (thick ? 1.4 : 1),
      0.052 * L * (thick ? 1.5 : 1), { pivot: "top", bottomScale: 0.8 }), C.claw,
    () => ({ tile: "leather", zone: ZONES.hard, uv: 0.35 }));
    // Shoulder caps. Without them a tube arm meets a box torso in a
    // visible notch, and the notch is what makes a creature look
    // assembled rather than grown.
    pair("shoulder", () => ballGeo(armR0 * 1.5, armR0 * 1.35, armR0 * 1.5, 10, 6), C.body,
      () => ({ tile: o.skinTile || "fuzz", zone: ZONES.cloth, uv: 0.4, occ: 0.18 }));
  }

  if (o.legs !== "none") {
    const stub = o.legs === "stub";
    pair("thigh", () => tubeGeo(legR0 * (stub ? 1.5 : 1), legR0 * (stub ? 1.3 : 0.85),
      P.thigh, 8, { pivot: "top" }), C.limb,
    () => ({ tile: o.limbTile || "fuzz", zone: ZONES.cloth, uv: 0.5, occ: 0.14,
      soft: { bone: "hips", from: -0.10, to: 0.01, max: 0.55 } }));
    pair("shin", () => tubeGeo(legR0 * (stub ? 1.35 : 0.85), legR0 * (stub ? 1.2 : 0.66),
      P.shin, 8, { pivot: "top" }), C.limb,
    (s, k) => ({ tile: o.limbTile || "fuzz", zone: ZONES.cloth, uv: 0.5,
      soft: { bone: `thigh${k}`, from: -0.09, to: 0.01, max: 0.5 } }));
    // Big flat feet. They are the contact with the ground and the
    // ground shadow sits under them; small feet make a figure hover
    // even when it is standing on the floor.
    pair("foot", () => boxGeo(0.115 * L * (o.footW ?? 1), 0.075, 0.215 * (o.footL ?? 1), {
      pivot: "bottom", topScale: 0.9, bottomScale: 1.0, topDepth: 0.85,
    }), C.claw, () => ({ y: -P.ankle + 0.004, z: -0.04, tile: "leather", zone: ZONES.hard, uv: 0.5 }));
  }
}

/* ---- sprung chunks on the demons ----------------------------------
   Three of the eight carry secondary motion, and the other five are
   left rigid on purpose rather than by omission: an imp is a moulded
   vocoder, a lackey is a lollipop on a stick, a plant is rooted in a
   pot, a pig is one solid barrel and a drone is a machine. Hanging
   cloth on any of those costs the silhouette that names it.

   These bones exist ONLY so the geometry emitted onto them below has
   something the springs can turn. The two halves have to land in the
   same edit, in BOTH directions:

     a bone here with no `sec()` in the spec is a bone nothing drives,
     a `sec()` with no geometry on its bone springs empty air.

   The second failure is silent - anim.js resolves the bone, runs the
   whole spring, writes a quaternion, and skins nothing - which is
   exactly how this arrived: `extras` and `secondary` can be injected
   through build()'s spec object, but the geometry is emitted by
   DEMON_FORMS, which only ever attached parts to the fixed names. */

const DANCER_BONES = [
  /* Knotted at her left hip and falling past the knee. Asymmetric
     because the roster note is choreographed LINES - four of these
     spawn in a row in course 1 - and four mirror-symmetric figures in
     a rank read as one object stamped four times. */
  { name: "sash", parent: "hips", x: -0.108, y: 0.020, z: 0.010 },
  /* Wrist ribbons. They get their gross motion for free off the arm
     swing, the same trick the bell-bottoms already play off the shin;
     the spring is what makes them TRAIL it instead of moving with it. */
  { name: "streamerL", parent: "handL", x: -0.020, y: -0.046, z: 0.008 },
  { name: "streamerR", parent: "handR", x: 0.020, y: -0.046, z: 0.008 },
];

const BOUNCER_BONES = [
  // The suit jacket's back skirt, split at the vent. Heavy panels on a
  // figure whose whole read is mass that does not want to be moved.
  { name: "skirtL", parent: "hips", x: -0.135, y: -0.010, z: 0.145 },
  { name: "skirtR", parent: "hips", x: 0.135, y: -0.010, z: 0.145 },
  // The laminated pass on its lanyard: the one light, fast thing on
  // him, so the dash reads as the coat lagging and the badge snapping.
  { name: "lanyard", parent: "chest", x: -0.150, y: 0.150, z: -0.240 },
];

const BAT_BONES = [
  /* Membrane tips, parented at the outer end of the existing wing so
     the flap channel on the shoulder still drives the whole wing and
     the spring only adds the trailing edge's lag. Rebuilding the wing
     onto these would have broken the flap. */
  { name: "wingTipL", parent: "shoulderL", x: -0.375, y: 0.030, z: 0.100 },
  { name: "wingTipR", parent: "shoulderR", x: 0.375, y: 0.030, z: 0.100 },
  // Phone charm on a strap under the slab. Tiny, but it is the only
  // part of this figure that hangs, so it is the only part that can
  // show a droop in a still frame.
  { name: "strap", parent: "chest", x: 0.052, y: -0.150, z: 0.010 },
];

const DEMON_FORMS = {

  /* --- Auto-Tune Imp -------------------------------------------------
     A vocoder unit that grew limbs. The head is nearly twice the
     volume of the body, which is the entire silhouette: a box with
     antennae on a stick figure. */
  imp(api, spec) {
    const { part, pair, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "noodle", legs: "spindle", armR: 0.038, legR: 0.042,
      skinTile: "plastic", limbTile: "plastic", footW: 0.85, footL: 0.8 });

    part("head", boxGeo(0.30, 0.28, 0.26, {
      pivot: "bottom", topScale: 1.04, bottomScale: 0.88, topDepth: 1.0, bottomDepth: 0.9,
    }), C.body, { y: -0.05, tile: "plastic", zone: ZONES.hard, uv: 1 });
    // Speaker grille: three stacked slots, dark, across the face. A
    // grille is what says "this thing makes the sound" at any range.
    for (let i = 0; i < 3; i += 1) {
      part("head", boxGeo(0.20, 0.020, 0.014), C.dark,
        { y: 0.055 - i * 0.042, z: -0.134, tile: "flat", zone: ZONES.hard, uv: 0.2 });
    }
    // The pitch-correction bar: a hard cyan line that anim.js can
    // pulse. It is the only bright thing on the model and it sits
    // exactly where a mouth would be.
    part("head", boxGeo(0.165, 0.028, 0.012), C.glowCol,
      { y: -0.075, z: -0.136, tile: "flat", zone: ZONES.glow, glow: 1.0 });
    demonEyes(api, { r: 0.036, spread: 0.070, y: 0.128, z: -0.132,
      sclera: col(C.eye), pupil: col(C.dark), glow: 0.0 });
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part("head", bladeGeo([
        [s * 0.085, 0.235, 0.010, 0.010, 0.010],
        [s * 0.125, 0.335, -0.020, 0.008, 0.008],
      ], { sides: 4, tip: false }), C.dark, { tile: "chrome", zone: ZONES.hard, uv: 0.2 });
      part("head", ballGeo(0.030, 0.030, 0.030, 8, 5), C.glowCol,
        { x: s * 0.128, y: 0.345, z: -0.024, tile: "flat", zone: ZONES.glow, glow: 0.9 });
    }
    pair("hand", () => ballGeo(0.042, 0.042, 0.042, 8, 5), C.limb,
      () => ({ y: -0.02, tile: "plastic", zone: ZONES.hard, uv: 0.3 }));
  },

  /* --- Lip-Sync Lackey ----------------------------------------------
     A lollipop head that is nothing but mouth, and a headset boom to
     name the joke. Long arms that hang past the knees keep the body
     from competing with the head. */
  lackey(api, spec) {
    const { part, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "noodle", legs: "spindle", armR: 0.042, legR: 0.046,
      skinTile: "denim", limbTile: "fuzz", waistFlare: 0.95, footL: 1.1 });

    part("head", ballGeo(0.135, 0.155, 0.130, 14, 10), C.body,
      { y: 0.028, tile: "fuzz", zone: ZONES.skin, uv: 0.8 });
    // The mouth wraps the front as a band rather than sitting on it,
    // so the shape survives being seen from three-quarters on.
    part("head", ballGeo(0.118, 0.072, 0.055, 14, 6), C.lips,
      { y: -0.012, z: -0.100, tile: "flat", zone: ZONES.skin, uv: 0.4 });
    part("head", boxGeo(0.170, 0.034, 0.030), C.dark,
      { y: -0.012, z: -0.132, tile: "flat", zone: ZONES.hard, uv: 0.2 });
    for (let i = 0; i < 5; i += 1) {
      part("head", boxGeo(0.024, 0.026, 0.016), 0xfdfbff,
        { x: -0.062 + i * 0.031, y: 0.006, z: -0.140, tile: "flat", zone: ZONES.hard, uv: 0.15 });
    }
    demonEyes(api, { r: 0.020, spread: 0.052, y: 0.098, z: -0.112,
      sclera: col(C.eye), pupil: col(C.dark) });
    // Headset: a band over the crown and a boom arm to the mouth.
    part("head", bladeGeo([
      [-0.132, 0.060, 0.010, 0.016, 0.016],
      [0, 0.176, 0.010, 0.016, 0.016],
      [0.132, 0.060, 0.010, 0.016, 0.016],
    ], { ref: [0, 0, 1], sides: 5, tip: false }), C.dark,
    { tile: "plastic", zone: ZONES.hard, uv: 0.3 });
    part("head", bladeGeo([
      [0.132, 0.052, 0.006, 0.011, 0.011],
      [0.120, 0.006, -0.086, 0.009, 0.009],
      [0.070, -0.020, -0.142, 0.008, 0.008],
    ], { sides: 4, tip: false }), C.dark, { tile: "plastic", zone: ZONES.hard, uv: 0.2 });
    part("head", ballGeo(0.020, 0.020, 0.020, 8, 5), C.glowCol,
      { x: 0.062, y: -0.022, z: -0.150, tile: "flat", zone: ZONES.glow, glow: 0.9 });
  },

  /* --- Industry Plant -------------------------------------------------
     A pot with a fan of leaves over it. Stationary, so the silhouette
     has to work with no motion at all - which is why the leaf crown
     spreads wider than any other enemy in the game. */
  plant(api, spec) {
    const { part, pair, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "noodle", legs: "stub", armR: 0.034, legR: 0.050,
      torso: "none", skinTile: "leaf", limbTile: "leaf", footW: 1.2, footL: 0.7 });

    // The pot is the whole lower body and the legs live inside it.
    // The pot reaches the ground on purpose: it is the figure's
    // contact patch and the shadow sits under it. Sized so the stub
    // feet just peek out of the base, which is what stops it looking
    // like a plant that was placed rather than one that walks.
    part("hips", latheGeo([
      [0.155, -P.hipY], [0.190, -P.hipY + 0.05], [0.225, -0.10], [0.245, 0.04],
      [0.265, 0.09], [0.258, 0.125], [0.222, 0.125],
    ], 16), C.pot, { tile: "grime", zone: ZONES.hard, uv: 1, occ: 0.2 });
    part("hips", latheGeo([[0.222, 0.105], [0.212, 0.145], [0.150, 0.165]], 16), C.soil,
      { tile: "grime", zone: ZONES.cloth, uv: 0.5, occ: 0.5 });

    part("spine", tubeGeo(0.062, 0.090, P.chestY + 0.10, 10, { pivot: "bottom" }), C.body,
      { y: -0.06, tile: "leaf", zone: ZONES.cloth, uv: 0.6, occ: 0.24 });
    part("chest", ballGeo(0.125, 0.145, 0.125, 12, 8), C.body,
      { y: 0.010, tile: "leaf", zone: ZONES.cloth, uv: 0.7 });

    // Seven fronds, alternating length so the fan is not a wheel.
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * TAU + 0.22;
      const long = i % 2 === 0 ? 1 : 0.72;
      const dx = Math.sin(a); const dz = Math.cos(a);
      part("chest", bladeGeo([
        [dx * 0.06, 0.09, dz * 0.06, 0.030, 0.010],
        [dx * 0.24, 0.30 * long + 0.06, dz * 0.24, 0.085, 0.014],
        [dx * 0.40, 0.40 * long + 0.02, dz * 0.40, 0.070, 0.011],
        [dx * 0.50, 0.36 * long - 0.04, dz * 0.50, 0.020, 0.006],
      ], { ref: [0, 1, 0], sides: 5 }), i % 2 === 0 ? C.leaf : C.leafDark,
      { tile: "leaf", zone: ZONES.cloth, uv: 0.9, occ: 0.05 });
    }

    // The head is a trumpet mouth. It is where the projectile leaves
    // from, so it has to be unmistakable and it has to glow.
    part("head", latheGeo([
      [0.030, -0.06], [0.058, 0.00], [0.078, 0.05], [0.125, 0.11], [0.118, 0.125],
    ], 14), C.bud, { rx: -1.15, z: -0.02, tile: "leaf", zone: ZONES.cloth, uv: 0.7 });
    part("head", discGeo(0.096, 0.096, 14), C.glowCol,
      { y: 0.108, z: -0.098, rx: -1.15 + Math.PI * 0.5, tile: "flat", zone: ZONES.glow, glow: 0.8 });
    demonEyes(api, { r: 0.026, spread: 0.050, y: 0.020, z: -0.070,
      sclera: col(C.eye), pupil: col(C.dark) });
    pair("hand", () => bladeGeo([
      [0, 0, 0, 0.028, 0.010], [0, -0.070, -0.020, 0.048, 0.012], [0, -0.120, -0.040, 0.014, 0.005],
    ], { ref: [0, 0, 1], sides: 5 }), C.leaf, () => ({ tile: "leaf", zone: ZONES.cloth, uv: 0.4 }));
  },

  /* --- Pay-Pig Demon --------------------------------------------------
     Wide barrel, snout, sack. The widest figure in the roster below the
     bouncer, and the only one whose outline is round - which is what
     separates it from the bouncer at a glance. */
  pig(api, spec) {
    const { part, pair, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "thick", legs: "stub", armR: 0.052, legR: 0.070,
      skinTile: "fuzz", limbTile: "fuzz", footW: 1.25, footL: 0.75,
      waistFlare: 1.25, shoulderFlare: 0.86 });

    part("spine", ballGeo(0.235 * P.wide, 0.195, 0.205 * P.wide, 14, 9), C.body,
      { y: 0.055, z: -0.020, tile: "fuzz", zone: ZONES.skin, uv: 1 });
    // Coin slot in the belly. One dark rectangle with a gold lip does
    // more for the joke than any amount of extra shape.
    part("spine", boxGeo(0.115, 0.026, 0.020), C.dark,
      { y: 0.075, z: -0.205 * P.wide, tile: "flat", zone: ZONES.hard, uv: 0.2 });
    part("spine", boxGeo(0.135, 0.046, 0.014), C.trim,
      { y: 0.075, z: -0.198 * P.wide, tile: "chrome", zone: ZONES.trim, uv: 0.2, occ: 0.1 });

    part("head", ballGeo(0.125, 0.112, 0.118, 12, 8), C.body,
      { y: 0.010, tile: "fuzz", zone: ZONES.skin, uv: 0.7, occ: 0.14 });
    part("head", latheGeo([
      [0.052, 0], [0.068, 0.030], [0.072, 0.062], [0.062, 0.068],
    ], 12), C.snout, { y: -0.020, z: -0.108, rx: -Math.PI * 0.5, tile: "fuzz", zone: ZONES.skin, uv: 0.4 });
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part("head", discGeo(0.014, 0.018, 8), C.dark,
        { x: s * 0.026, y: -0.020, z: -0.176, ry: Math.PI, tile: "flat", zone: ZONES.hard });
      // Floppy ears: big, and they are the top of the silhouette.
      part("head", bladeGeo([
        [s * 0.088, 0.088, 0.010, 0.052, 0.014],
        [s * 0.138, 0.052, -0.010, 0.062, 0.016],
        [s * 0.150, -0.030, -0.030, 0.044, 0.012],
        [s * 0.140, -0.078, -0.038, 0.014, 0.005],
      ], { ref: [0, 1, 0], sides: 5 }), C.snout,
      { tile: "fuzz", zone: ZONES.skin, uv: 0.6 });
      // Tusks.
      part("head", bladeGeo([
        [s * 0.048, -0.052, -0.098, 0.013, 0.013],
        [s * 0.058, -0.006, -0.126, 0.009, 0.009],
      ], { sides: 5 }), 0xf6f1e4, { tile: "chrome", zone: ZONES.hard, uv: 0.2 });
    }
    demonEyes(api, { r: 0.024, spread: 0.055, y: 0.038, z: -0.098,
      sclera: col(C.eye), pupil: col(C.dark) });

    // The sack, clutched against the belly. Bound to the left hand so
    // it swings with the arm rather than floating in front.
    part("handL", latheGeo([
      [0.020, 0.02], [0.075, -0.03], [0.105, -0.12], [0.088, -0.205], [0.030, -0.235],
    ], 12), C.sack, { x: 0.055, y: -0.03, z: -0.06, tile: "denim", zone: ZONES.cloth, uv: 0.8, occ: 0.2 });
    part("handL", boxGeo(0.075, 0.055, 0.055, { topScale: 0.6 }), C.trim,
      { x: 0.055, y: -0.012, z: -0.06, tile: "chrome", zone: ZONES.trim, uv: 0.3 });
  },

  /* --- Stan-Account Bat -----------------------------------------------
     A phone slab between two scalloped wings. Flyer: the legs exist as
     bones so anim.js does not have to special-case the rig, but they
     carry a pair of tucked claws and nothing else. */
  bat(api, spec) {
    const { part, pair, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "none", legs: "none", torso: "none" });

    part("chest", boxGeo(0.185, 0.320, 0.070, {
      pivot: "bottom", topScale: 0.98, bottomScale: 0.98,
    }), C.shell, { y: -0.150, tile: "plastic", zone: ZONES.hard, uv: 1 });
    // The screen IS the face. One bright rectangle, and everything
    // else on the model is dark, so it reads at any distance.
    part("chest", boxGeo(0.150, 0.268, 0.016), C.screen,
      { y: -0.150, z: -0.040, tile: "flat", zone: ZONES.glow, glow: 0.85 });
    part("chest", discGeo(0.048, 0.048, 12), C.dark,
      { x: -0.030, y: -0.058, z: -0.049, ry: Math.PI, tile: "flat", zone: ZONES.eye });
    part("chest", discGeo(0.048, 0.048, 12), C.dark,
      { x: 0.030, y: -0.058, z: -0.049, ry: Math.PI, tile: "flat", zone: ZONES.eye });
    part("chest", boxGeo(0.070, 0.018, 0.014), C.dark,
      { y: -0.185, z: -0.049, tile: "flat", zone: ZONES.eye });

    // Wings on the shoulder bones so the existing arm channels flap
    // them. Three struts per wing and a scalloped trailing edge: a
    // plain triangle reads as a paper dart.
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part(`shoulder${k}`, bladeGeo([
        [0, 0, 0, 0.030, 0.016],
        [s * 0.150, 0.040, 0.030, 0.024, 0.012],
        [s * 0.300, 0.055, 0.070, 0.016, 0.008],
        [s * 0.400, 0.040, 0.110, 0.006, 0.004],
      ], { sides: 5 }), C.wing, { tile: "leather", zone: ZONES.cloth, uv: 0.6 });
      for (let i = 0; i < 3; i += 1) {
        const t = 0.34 + i * 0.22;
        part(`shoulder${k}`, bladeGeo([
          [s * 0.400 * t, 0.048 * t, 0.090 * t, 0.010, 0.006],
          [s * 0.330 * t + s * 0.05, -0.100 - i * 0.045, 0.130 * t, 0.008, 0.005],
        ], { sides: 4 }), C.wingRib, { tile: "leather", zone: ZONES.hard, uv: 0.2 });
      }
      part(`shoulder${k}`, bladeGeo([
        [s * 0.055, -0.010, 0.030, 0.070, 0.010],
        [s * 0.190, -0.060, 0.070, 0.098, 0.011],
        [s * 0.320, -0.090, 0.108, 0.078, 0.009],
        [s * 0.400, -0.060, 0.126, 0.030, 0.005],
      ], { ref: [0, 1, 0], sides: 5 }), C.wing,
      { tile: "leather", zone: ZONES.cloth, uv: 0.9, occ: 0.1 });
      // Ears: two triangles on top, the only thing above the slab.
      part("head", bladeGeo([
        [s * 0.048, 0.010, 0.010, 0.030, 0.012],
        [s * 0.078, 0.105, -0.010, 0.020, 0.008],
        [s * 0.086, 0.155, -0.020, 0.006, 0.003],
      ], { ref: [0, 0, 1], sides: 4 }), C.shell, { tile: "plastic", zone: ZONES.hard, uv: 0.3 });
      // Tucked claws where the feet would be.
      part(`thigh${k}`, bladeGeo([
        [0, 0, 0, 0.018, 0.014],
        [s * 0.020, -0.070, -0.030, 0.014, 0.011],
        [s * 0.026, -0.110, -0.075, 0.005, 0.004],
      ], { sides: 4 }), C.dark, { tile: "chrome", zone: ZONES.hard, uv: 0.2 });

      /* Sprung membrane tip, hung off the outer end of the wing it
         continues. It carries on outboard AND further back than the
         main blade, so the spring's lag shows up at the widest, last
         part of the outline - a wing whose tip arrives late is the
         whole difference between flying and being carried. */
      part(`wingTip${k}`, bladeGeo([
        [0, 0, 0, 0.026, 0.008],
        [s * 0.082, -0.022, 0.052, 0.038, 0.009],
        [s * 0.132, -0.064, 0.096, 0.029, 0.007],
        [s * 0.148, -0.106, 0.118, 0.008, 0.004],
      ], { ref: [0, 1, 0], sides: 5 }), C.wing,
      { tile: "leather", zone: ZONES.cloth, uv: 0.7, occ: 0.08 });
      part(`wingTip${k}`, bladeGeo([
        [0, 0.004, 0.004, 0.008, 0.005],
        [s * 0.118, -0.046, 0.084, 0.005, 0.003],
      ], { sides: 4 }), C.wingRib, { tile: "leather", zone: ZONES.hard, uv: 0.2 });
    }

    /* Charm on a phone strap. It is two centimetres of geometry and it
       earns its place twice: it is the only thing on this figure that
       HANGS, so it is the only part whose droop survives into a still
       frame, and a lit cyan bead swinging under a dark slab is a small
       moving highlight on a creature that is otherwise one silhouette. */
    part("strap", bladeGeo([
      [0, 0.006, 0, 0.007, 0.005],
      [0.006, -0.062, 0.008, 0.006, 0.004],
      [0.010, -0.112, 0.014, 0.005, 0.004],
    ], { ref: [0, 0, 1], sides: 4, tip: false }), C.dark,
    { tile: "chrome", zone: ZONES.hard, uv: 0.2 });
    part("strap", ballGeo(0.024, 0.028, 0.013, 10, 6), C.screen,
      { x: 0.010, y: -0.138, z: 0.014, tile: "flat", zone: ZONES.glow, glow: 0.65 });
  },

  /* --- Backup Dancer Demon --------------------------------------------
     Narrow on top, bell-bottom flare at the bottom, shoulders that come
     to a point. Reads as an exclamation mark, which is the opposite of
     the bouncer's wardrobe and the pig's barrel. */
  dancer(api, spec) {
    const { part, pair, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "noodle", legs: "spindle", armR: 0.042, legR: 0.048,
      skinTile: "satin", limbTile: "satin", shoulderFlare: 1.05, footL: 1.15 });

    // Bell bottoms. The flare hangs off the shin, so it swings with
    // the leg and the walk cycle gets secondary motion for free.
    pair("shin", (s, k) => bladeGeo([
      [0, -0.030, 0, 0.062, 0.058],
      [0, -P.shin * 0.55, -0.005, 0.082, 0.076],
      [0, -P.shin * 0.95, -0.015, 0.125, 0.112],
      [0, -P.shin - 0.020, -0.018, 0.118, 0.106],
    ], { ref: [0, 0, 1], sides: 8, tip: false }), C.pants,
    (s, k) => ({ tile: "satin", zone: ZONES.cloth, uv: 0.9, occ: 0.12,
      soft: { bone: `thigh${k}`, from: -0.06, to: 0.0, max: 0.4 } }));

    // Cropped jacket with pointed shoulders.
    part("chest", boxGeo(0.30 * P.wide, 0.20, 0.225 * P.wide, {
      pivot: "bottom", topScale: 1.08, bottomScale: 0.92,
    }), C.jacket, { y: -0.020, tile: "sequin", zone: ZONES.cloth, uv: 0.9 });
    pair("shoulder", (s) => bladeGeo([
      [0, 0.005, 0, 0.070, 0.078],
      [s * 0.075, 0.048, 0, 0.060, 0.066],
      [s * 0.145, 0.062, 0, 0.020, 0.024],
    ], { sides: 5 }), C.jacket, () => ({ tile: "sequin", zone: ZONES.cloth, uv: 0.6 }));

    part("head", ballGeo(0.090, 0.104, 0.094, 12, 8), C.body,
      { y: 0.014, tile: "fuzz", zone: ZONES.skin, uv: 0.6 });
    // Visor rather than eyes. A hard dark band across the face is
    // legible at twice the range a pair of eyes is.
    part("head", boxGeo(0.190, 0.050, 0.100, { topScale: 1.0, bottomScale: 0.9 }), C.dark,
      { y: 0.030, z: -0.050, tile: "chrome", zone: ZONES.hard, uv: 0.4 });
    part("head", boxGeo(0.150, 0.024, 0.014), C.glowCol,
      { y: 0.032, z: -0.100, tile: "flat", zone: ZONES.glow, glow: 0.9 });
    // Slicked crest: the top of the exclamation mark.
    part("head", bladeGeo([
      [0, 0.085, 0.070, 0.062, 0.038],
      [0, 0.160, 0.010, 0.058, 0.034],
      [0, 0.180, -0.070, 0.038, 0.020],
      [0, 0.150, -0.120, 0.012, 0.008],
    ], { ref: [0, 0, 1], sides: 6 }), C.hair, { tile: "hair", zone: ZONES.hair, uv: 0.8 });

    /* ---- the sprung cloth ----
       Hot pink on a gold costume, and it is the only place on the
       figure that colour appears apart from the visor bar - so the
       three chunks read as one prop rather than as three accidents,
       and they carry the eye down the exclamation mark instead of
       breaking it. Value-wise the sash is the mid step between the
       near-black legs and the gold jacket, which is what stops the
       figure ending in one unbroken bright mass at the waist. */
    part("sash", bladeGeo([
      [0, 0.015, 0.000, 0.062, 0.018],
      [-0.038, -0.170, -0.012, 0.082, 0.020],
      [-0.062, -0.350, -0.030, 0.070, 0.017],
      [-0.074, -0.470, -0.046, 0.028, 0.010],
    ], { ref: [0, 0, 1], sides: 6 }), C.glowCol,
    { tile: "satin", zone: ZONES.cloth, uv: 1, occ: 0.12 });
    // A pale stripe down the panel. A single flat satin plane is the
    // first tell in CONTRACT section 2 and this is the cheapest answer.
    part("sash", bladeGeo([
      [-0.014, -0.010, -0.030, 0.014, 0.006],
      [-0.048, -0.230, -0.044, 0.013, 0.006],
      [-0.070, -0.400, -0.062, 0.008, 0.004],
    ], { ref: [0, 0, 1], sides: 4 }), C.claw,
    { tile: "satin", zone: ZONES.trim, uv: 0.3 });

    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part(`streamer${k}`, bladeGeo([
        [0, 0.005, 0.000, 0.030, 0.010],
        [s * 0.012, -0.110, 0.014, 0.038, 0.011],
        [s * 0.020, -0.215, 0.036, 0.030, 0.009],
        [s * 0.024, -0.290, 0.056, 0.010, 0.005],
      ], { ref: [0, 0, 1], sides: 5 }), C.glowCol,
      { tile: "satin", zone: ZONES.cloth, uv: 0.8 });
    }

    // The gloves are the base builder's hand blocks, recoloured
    // through C.claw. Emitting a second, smaller glove over them is
    // the obvious move and it z-fights, because the block underneath
    // is wider than the glove that is supposed to hide it.
  },

  /* --- VIP Bouncer Demon ----------------------------------------------
     A wardrobe. Shoulders nearly a metre across, a head sunk between
     them, arms that reach the knees, and legs short enough that the
     mass reads as top-heavy and immovable. */
  bouncer(api, spec) {
    const { part, pair, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "thick", legs: "stub", armR: 0.070, legR: 0.082,
      skinTile: "denim", limbTile: "denim", footW: 1.3, footL: 1.0,
      shoulderFlare: 1.30, waistFlare: 1.15, hipTaper: 1.1 });

    // The trapezoid. Everything above the waist widens; nothing else
    // in the roster does that.
    part("chest", boxGeo(0.42 * P.wide, 0.30, 0.28 * P.wide, {
      pivot: "bottom", topScale: 1.22, bottomScale: 0.86, topDepth: 1.10, bottomDepth: 0.92,
    }), C.suit, { y: -0.080, tile: "denim", zone: ZONES.cloth, uv: 1, occ: 0.1 });
    // Lapels and a tie: a black suit needs two light shapes on it or
    // it is a hole in the middle of the screen.
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part("chest", bladeGeo([
        [s * 0.140, 0.150, -0.150, 0.058, 0.014],
        [s * 0.100, 0.010, -0.166, 0.062, 0.015],
        [s * 0.050, -0.110, -0.150, 0.040, 0.012],
      ], { ref: [0, 0, 1], sides: 5, tip: false }), C.lapel,
      { tile: "satin", zone: ZONES.cloth, uv: 0.5 });
      part(`shoulder${k}`, ballGeo(0.115, 0.100, 0.115, 12, 7), C.suit,
        { y: 0.010, tile: "denim", zone: ZONES.cloth, uv: 0.5, occ: 0.14 });
    }
    part("chest", bladeGeo([
      [0, 0.140, -0.160, 0.026, 0.010],
      [0, 0.030, -0.172, 0.038, 0.011],
      [0, -0.110, -0.156, 0.030, 0.009],
    ], { ref: [0, 0, 1], sides: 5 }), C.tie, { tile: "satin", zone: ZONES.trim, uv: 0.4 });

    part("head", ballGeo(0.098, 0.092, 0.098, 12, 8), C.body,
      { y: -0.010, tile: "fuzz", zone: ZONES.skin, uv: 0.6, occ: 0.24 });
    part("head", boxGeo(0.150, 0.048, 0.056), C.body,
      { y: 0.055, z: -0.072, tile: "fuzz", zone: ZONES.skin, uv: 0.3, occ: 0.3 });
    demonEyes(api, { r: 0.020, spread: 0.044, y: 0.018, z: -0.082,
      sclera: col(C.eye), pupil: col(C.dark), glow: 0.5 });
    // Sunglasses over the eyes, and an earpiece coil down to the
    // collar. Two props, both pure silhouette.
    part("head", boxGeo(0.175, 0.038, 0.030), C.dark,
      { y: 0.020, z: -0.086, tile: "chrome", zone: ZONES.hard, uv: 0.3 });
    part("head", bladeGeo([
      [0.092, 0.006, -0.010, 0.010, 0.010],
      [0.110, -0.070, 0.030, 0.008, 0.008],
      [0.086, -0.150, 0.060, 0.006, 0.006],
    ], { sides: 4 }), C.lapel, { tile: "plastic", zone: ZONES.hard, uv: 0.2 });
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part("head", bladeGeo([
        [s * 0.070, 0.070, 0.036, 0.026, 0.026],
        [s * 0.096, 0.130, 0.070, 0.018, 0.018],
        [s * 0.094, 0.156, 0.114, 0.006, 0.006],
      ], { sides: 5 }), C.horn, { tile: "chrome", zone: ZONES.hard, uv: 0.25 });
    }
    /* ---- the sprung cloth ----
       The jacket's back skirt, split at the vent, reaching the knee on
       legs that are deliberately too short for the body. It is the one
       thing on the roster with real WEIGHT hanging off it, and the
       dash is what it exists for: the mass arrives, the coat does not,
       and the figure stops looking like a box being slid across a
       floor. Lapel-grey strips down the vent edges because this file
       has already learnt that a near-black panel with no light shape
       on it is a hole cut in the middle of the screen. */
    for (const k of ["L", "R"]) {
      const s = SIDE[k];
      part(`skirt${k}`, bladeGeo([
        [0, 0.015, 0.000, 0.135, 0.026],
        [s * 0.020, -0.170, 0.020, 0.150, 0.028],
        [s * 0.038, -0.340, 0.032, 0.128, 0.024],
        [s * 0.048, -0.450, 0.036, 0.070, 0.016],
        [s * 0.052, -0.500, 0.034, 0.016, 0.006],
      ], { ref: [0, 0, 1], sides: 6 }), C.suit,
      { tile: "denim", zone: ZONES.cloth, uv: 1, occ: 0.16 });
      part(`skirt${k}`, bladeGeo([
        [s * 0.010, -0.020, -0.024, 0.012, 0.008],
        [s * 0.026, -0.280, -0.012, 0.011, 0.007],
        [s * 0.038, -0.430, -0.004, 0.006, 0.004],
      ], { ref: [0, 0, 1], sides: 4 }), C.lapel,
      { tile: "satin", zone: ZONES.trim, uv: 0.3 });
    }

    // The pass on its lanyard. Light and quick where everything else
    // about him is slow, which is the whole reason it is here.
    part("lanyard", bladeGeo([
      [0, 0.010, 0.000, 0.012, 0.006],
      [0.014, -0.120, -0.008, 0.011, 0.005],
      [0.026, -0.235, -0.014, 0.010, 0.005],
    ], { ref: [0, 0, 1], sides: 4, tip: false }), C.rope,
    { tile: "fuzz", zone: ZONES.trim, uv: 0.3 });
    part("lanyard", boxGeo(0.086, 0.115, 0.012, { topScale: 1.0, bottomScale: 0.98 }), C.lapel,
      { x: 0.026, y: -0.298, z: -0.014, tile: "plastic", zone: ZONES.hard, uv: 0.7 });
    part("lanyard", boxGeo(0.064, 0.020, 0.006), C.tie,
      { x: 0.026, y: -0.268, z: -0.021, tile: "flat", zone: ZONES.trim, uv: 0.3 });

    // Velvet rope on the belt. The prop that names the job.
    part("hips", bladeGeo([
      [-0.150, 0.040, 0.020, 0.020, 0.020],
      [-0.090, -0.090, -0.090, 0.022, 0.022],
      [0.020, -0.120, -0.120, 0.022, 0.022],
      [0.130, -0.060, -0.070, 0.020, 0.020],
      [0.165, 0.030, 0.020, 0.018, 0.018],
    ], { sides: 6, tip: false }), C.rope, { tile: "fuzz", zone: ZONES.trim, uv: 0.6, occ: 0.24 });
  },

  /* --- Paparazzi Drone -------------------------------------------------
     An X of rotors with a lens for a nose. The only figure in the game
     with radial symmetry, which is exactly why it reads instantly: no
     other outline in the roster has four arms at 45 degrees. */
  drone(api, spec) {
    const { part, P } = api;
    const C = spec.palette;
    demonBase(api, spec, { arms: "none", legs: "none", torso: "none" });

    part("chest", boxGeo(0.230, 0.180, 0.220, {
      topScale: 0.92, bottomScale: 0.86, topDepth: 0.94, bottomDepth: 0.9,
    }), C.shell, { tile: "plastic", zone: ZONES.hard, uv: 1 });
    // Lens barrel. Long enough to be a nose, ringed so it reads as
    // glass rather than as a pipe.
    part("chest", latheGeo([
      [0.062, 0.00], [0.078, -0.05], [0.070, -0.09], [0.086, -0.12],
      [0.082, -0.185], [0.092, -0.200], [0.088, -0.215],
    ], 14), C.barrel, { rx: -Math.PI * 0.5, z: -0.02, tile: "chrome", zone: ZONES.hard, uv: 0.8 });
    part("chest", discGeo(0.074, 0.074, 14), C.lens,
      { z: -0.232, ry: Math.PI, tile: "flat", zone: ZONES.glow, glow: 0.55 });
    part("chest", discGeo(0.030, 0.030, 10), 0xffffff,
      { x: -0.024, y: 0.022, z: -0.236, ry: Math.PI, tile: "flat", zone: ZONES.glow, glow: 1.0 });
    // Flash unit on top: the tell that it is a paparazzo and the thing
    // that pulses on the beat.
    part("chest", boxGeo(0.140, 0.048, 0.070, { topScale: 0.85 }), C.dark,
      { y: 0.115, z: -0.020, tile: "plastic", zone: ZONES.hard, uv: 0.3 });
    part("chest", boxGeo(0.115, 0.020, 0.052), C.glowCol,
      { y: 0.140, z: -0.020, tile: "flat", zone: ZONES.glow, glow: 1.0 });

    // Four arms at 45 degrees, each with a hub and a blur disc. The
    // discs are bound to the rotor bones so anim.js can spin them.
    const arms = [["FL", -1, -1], ["FR", 1, -1], ["BL", -1, 1], ["BR", 1, 1]];
    for (const [tag, sx, sz] of arms) {
      part("chest", bladeGeo([
        [sx * 0.070, 0.020, sz * 0.070, 0.026, 0.020],
        [sx * 0.170, 0.048, sz * 0.170, 0.020, 0.015],
        [sx * 0.225, 0.058, sz * 0.225, 0.024, 0.018],
      ], { sides: 5, tip: false }), C.shell, { tile: "plastic", zone: ZONES.hard, uv: 0.4 });
      part(`rotor${tag}`, tubeGeo(0.024, 0.030, 0.026, 8), C.dark,
        { tile: "chrome", zone: ZONES.hard, uv: 0.2 });
      part(`rotor${tag}`, ringGeo(0.028, 0.115, 18), C.rotor,
        { y: 0.018, rx: -Math.PI * 0.5, tile: "flat", zone: ZONES.hard, uv: 0.4, occ: -0.15 });
      for (let i = 0; i < 2; i += 1) {
        part(`rotor${tag}`, boxGeo(0.026, 0.008, 0.180, { topScale: 0.7 }), C.dark,
          { y: 0.018, ry: i * Math.PI * 0.5, tile: "plastic", zone: ZONES.hard, uv: 0.2 });
      }
    }
  },
};

/* ------------------------------------------------------------------
   specs

   enemies.js and bosses.js ask for these by name. `secondary` is the
   spring authoring for anim.js: the modeller knows how heavy a coat
   tail is relative to a hair chunk, so the numbers live with the
   geometry rather than being guessed by the animation code.
   ------------------------------------------------------------------ */

/**
 * One secondary-motion chunk.
 *
 * The field NAMES are load-bearing: `anim.js applySecondary()` reads
 * this object directly, and a name it does not recognise is not a
 * warning, it is silence. Twice now that has cost the whole feature -
 * first as `k`/`c` for the spring constants, then as a `gain` that
 * character.js never wrote. Measured, all eight chunks were moving
 * within 8% of each other off a two-metre drop and railing against one
 * shared clamp: a head of hair swinging as a single lump, which is the
 * tell this authoring exists to avoid. If a field is added here it has
 * to be read there in the same change.
 *
 *   stiffness  spring constant toward the settled target
 *   damping    velocity bleed; these pairs are chosen not to ring
 *   drive      how hard this chunk answers a CHANGE of motion. Peak
 *              travel goes as drive/sqrt(stiffness), so the two numbers
 *              together are what separate a fringe from a coat tail
 *   swing      how much it trails while simply moving, and how far it
 *              swings sideways through a turn
 *   gravity    a constant droop, in radians. Small, but it is the only
 *              one of these that shows in a STILL frame - and the
 *              capture harness only ever photographs still frames
 *   limit      travel cap, in radians, so nothing passes through a
 *              shoulder on a hard landing
 */
const sec = (bone, stiffness, damping, drive, swing, gravity, limit) =>
  ({ bone, stiffness, damping, drive, swing, gravity, limit });

export const specs = {
  moggadonna: {
    id: "moggadonna", name: "Moggadonna", kind: "hero", variant: "diva",
    height: 1.7, seed: 0x4d09,
    /* headScale 1.22 is a measurement, not a taste call. As a black
       silhouette at eleven metres - the distance the capture presets
       actually frame her from - her head spanned 32 px against a
       200 px shoulder line, a ratio of 0.60. Every readable cartoon
       platformer hero of this class runs 0.8 to 1.1; the head is what
       the eye finds first and at 0.6 it was losing that race to a pair
       of shoulder spikes. The neck lift below keeps the pinch open
       underneath the larger skull so this buys a bigger HEAD rather
       than a bigger lump. */
    mods: { wide: 0.92, head: 1.06, headScale: 1.22, arm: 0.98, neck: 1.42 },
    palette: MOG_PALETTE,
    extras: [...MOG_HAIR_BONES, ...MOG_COAT_BONES],
    props: { mic: micParts, micStand: micStandParts },
    defaultProp: "mic",
    secondary: [
      // The fringe is short and stiff; the tails are long and loose.
      // A single stiffness across all of it makes the whole head of
      // hair move as one lump, which is the tell of cheap secondary.
      sec("hairFringe", 210, 20, 0.55, 0.35, 0.02, 0.34),
      sec("hairL", 96, 12, 1.00, 0.85, 0.10, 0.72),
      sec("hairR", 112, 13, 0.92, 0.80, 0.09, 0.66),
      sec("hairBack", 120, 14, 0.85, 0.60, 0.06, 0.58),
      sec("coatFL", 130, 15, 0.85, 0.55, 0.05, 0.62),
      sec("coatFR", 130, 15, 0.85, 0.55, 0.05, 0.62),
      sec("coatBL", 78, 11, 1.10, 0.95, 0.12, 0.85),
      sec("coatBR", 78, 11, 1.10, 0.95, 0.12, 0.85),
    ],
  },

  imp: {
    id: "imp", name: "Auto-Tune Imp", kind: "demon", form: "imp",
    height: 1.05, seed: 0x1101, tint: 0xa855f7,
    mods: { head: 1.9, leg: 0.85, arm: 0.95, wide: 0.78, limb: 0.72 },
    palette: {
      body: 0xa855f7, limb: 0x7c3aed, claw: 0x4c1d95, dark: 0x1b0b2e,
      eye: 0xfdf6ff, glowCol: 0x2ee0ff,
    },
  },

  lackey: {
    id: "lackey", name: "Lip-Sync Lackey", kind: "demon", form: "lackey",
    height: 1.5, seed: 0x1102, tint: 0xfb923c,
    mods: { arm: 1.28, leg: 1.02, wide: 0.80, limb: 0.74 },
    palette: {
      body: 0xfb923c, limb: 0xe07322, claw: 0x7c3a10, dark: 0x2a1206,
      eye: 0xfff6ea, lips: 0xd6265c, glowCol: 0x22c55e,
    },
  },

  plant: {
    id: "plant", name: "Industry Plant", kind: "demon", form: "plant",
    height: 1.55, seed: 0x1103, tint: 0x22c55e, rooted: true,
    mods: { leg: 0.55, arm: 0.92, wide: 1.0, limb: 0.9 },
    palette: {
      body: 0x22c55e, limb: 0x16a34a, claw: 0x3ddc7a, dark: 0x0d2b18,
      eye: 0xfdfff6, leaf: 0x3ddc7a, leafDark: 0x15803d, bud: 0x86efac,
      pot: 0xb45f2b, soil: 0x3a2416, glowCol: 0xd9f99d,
    },
  },

  pig: {
    id: "pig", name: "Pay-Pig Demon", kind: "demon", form: "pig",
    height: 1.45, seed: 0x1104, tint: 0xf472b6,
    mods: { leg: 0.62, arm: 0.86, wide: 1.42, limb: 1.25 },
    palette: {
      body: 0xf472b6, limb: 0xe25a9f, claw: 0x9d2f66, dark: 0x2c0d1e,
      eye: 0xfff2f8, snout: 0xf9a8d4, sack: 0x6b4c2a, trim: 0xf7d716,
      glowCol: 0xf7d716,
    },
  },

  bat: {
    id: "bat", name: "Stan-Account Bat", kind: "demon", form: "bat",
    height: 0.80, seed: 0x1105, tint: 0x2ee0ff, flyer: true,
    mods: { wide: 0.80, limb: 0.7 },
    palette: {
      body: 0x134b5e, limb: 0x134b5e, claw: 0x061319, dark: 0x061319,
      eye: 0x2ee0ff, shell: 0x0f2a36, screen: 0x2ee0ff,
      wing: 0x1a5c73, wingRib: 0x0a1e28, glowCol: 0x2ee0ff,
    },
    extras: BAT_BONES,
    // Two membranes and a charm, and the charm is deliberately nothing
    // like the membranes: 230 against 88 is the widest stiffness ratio
    // on any figure in the game. A flyer whose every loose part answers
    // a dive at the same rate reads as one rigid kite.
    secondary: [
      sec("wingTipL", 88, 10, 1.30, 0.95, 0.14, 0.80),
      sec("wingTipR", 104, 11, 1.15, 0.85, 0.11, 0.72),
      sec("strap", 230, 18, 0.60, 0.30, 0.22, 0.40),
    ],
  },

  dancer: {
    id: "dancer", name: "Backup Dancer Demon", kind: "demon", form: "dancer",
    height: 1.78, seed: 0x1106, tint: 0xfacc15,
    mods: { leg: 1.08, arm: 1.10, wide: 0.88, limb: 0.80 },
    palette: {
      body: 0x8a5a2a, limb: 0xfacc15, claw: 0xfff0b0, dark: 0x231705,
      eye: 0xfff8e0, jacket: 0xfacc15, pants: 0xf5b400, hair: 0x1b1206,
      glowCol: 0xff5c8a,
    },
    extras: DANCER_BONES,
    /* It dances on the beat and only on the beat, so what has to read
       is the OFF-beat: the ribbons still arriving while the body has
       already hit its mark. The sash is heavy satin and the wrist
       ribbons are almost weightless, three times its stiffness, so the
       hands settle first and the hip settles last. Identical numbers
       across the three would land everything on the same frame, which
       is a figure moving as one lump - and four of these spawn in a
       rank, where one lump becomes four identical lumps. */
    secondary: [
      sec("sash", 62, 9, 1.20, 1.05, 0.15, 0.90),
      sec("streamerL", 165, 15, 0.80, 0.55, 0.05, 0.48),
      sec("streamerR", 194, 16, 0.72, 0.48, 0.04, 0.42),
    ],
  },

  bouncer: {
    id: "bouncer", name: "VIP Bouncer Demon", kind: "demon", form: "bouncer",
    height: 2.15, seed: 0x1107, tint: 0xef4444,
    mods: { leg: 0.78, arm: 1.06, wide: 1.55, limb: 1.5 },
    palette: {
      body: 0x9b2c2c, limb: 0x1a1a20, claw: 0x0f0f14, dark: 0x0a0a0e,
      eye: 0xff8a8a, suit: 0x14141a, lapel: 0x2f2f3a, tie: 0xef4444,
      horn: 0x2a2a32, rope: 0x8b1a1a, glowCol: 0xef4444,
    },
    extras: BOUNCER_BONES,
    /* The lowest stiffness in the game sits on this figure, and that
       is the point of it: 46 is a heavy wool panel that answers a dash
       half a beat late, where Moggadonna's loosest coat tail is 78.
       The badge at 175 is nearly four times stiffer than the coat it
       hangs in front of, so one dash produces two clearly different
       motions on the same body - which is the read that says weight.
       The pair is split 46/54 rather than mirrored exactly; a vent
       whose halves move in perfect lockstep is one panel with a line
       painted down it. */
    secondary: [
      sec("skirtL", 46, 9, 1.15, 0.90, 0.16, 0.72),
      sec("skirtR", 54, 10, 1.05, 0.82, 0.14, 0.66),
      sec("lanyard", 175, 13, 0.95, 0.40, 0.06, 0.55),
    ],
  },

  drone: {
    id: "drone", name: "Paparazzi Drone", kind: "demon", form: "drone",
    height: 0.95, seed: 0x1108, tint: 0x38bdf8, flyer: true,
    mods: { wide: 1.0 },
    rotors: ["rotorFL", "rotorFR", "rotorBL", "rotorBR"],
    extras: [
      { name: "rotorFL", parent: "chest", x: -0.225, y: 0.058, z: -0.225 },
      { name: "rotorFR", parent: "chest", x: 0.225, y: 0.058, z: -0.225 },
      { name: "rotorBL", parent: "chest", x: -0.225, y: 0.058, z: 0.225 },
      { name: "rotorBR", parent: "chest", x: 0.225, y: 0.058, z: 0.225 },
    ],
    palette: {
      body: 0x38bdf8, limb: 0x38bdf8, claw: 0x0b1a24, dark: 0x0b1a24,
      eye: 0xffffff, shell: 0x38bdf8, barrel: 0x1e3a4c, lens: 0x9be8ff,
      rotor: 0x7dd3fc, glowCol: 0xffffff,
    },
  },
};

/**
 * Derive a variant. bosses.js builds the Algorithm Twins from
 * Moggadonna's own spec because the fight IS a mirror match, and a
 * twin that is visibly a different model kills the joke.
 */
export function derive(baseName, overrides = {}) {
  const base = specs[baseName];
  if (!base) throw new Error(`apop3d/character: no spec "${baseName}"`);
  const out = { ...base, ...overrides, id: overrides.id || `${baseName}.variant` };
  out.palette = { ...base.palette, ...(overrides.palette || {}) };
  out.mods = { ...base.mods, ...(overrides.mods || {}) };
  return out;
}

/* The two boss figures that are cheap to state as variants. The
 * Payola Phantom is not here: it is a shielded specter with no legs
 * and its own build, and bosses.js should ask for it explicitly
 * rather than inheriting a walk cycle it never uses. */
specs.twin = derive("moggadonna", {
  id: "twin", name: "Algorithm Twin", seed: 0x7071,
  palette: {
    hair: 0x2ee0ff, hairDeep: 0x0e7490, streak: 0xff4f8f,
    jacket: 0x1d2a44, jacketDark: 0x0f172a, lapel: 0x9fe8ff,
    trim: 0xd8dee9, suit: 0x0b1220, glow: 0xff4f8f,
  },
});
specs.lucifer = derive("moggadonna", {
  id: "lucifer", name: "Lucifer Lipsync", seed: 0x666b, variant: "frontman",
  height: 2.25, mods: { wide: 1.12, head: 0.94, arm: 1.06, leg: 1.04 },
  palette: {
    skin: 0xd9b9a4, hair: 0x1a1020, hairDeep: 0x0d0812, streak: 0xff6a1a,
    jacket: 0x14101c, jacketDark: 0x090610, lapel: 0xf7d716,
    trim: 0xf7d716, suit: 0x0b0810, horn: 0xf7d716, glow: 0xff6a1a,
    lips: 0x7a1030,
  },
});

/* ------------------------------------------------------------------
   contact shadow

   CONTRACT.md section 2 item 2: an object that touches the ground and
   has no shadow under it is the single loudest AAA failure, and it is
   loudest of all on a character because the player is looking at her.
   The directional shadow map is budgeted for the level, not for
   twenty demons, so every figure also carries a blob that anim.js
   plants on the ground it actually sampled for foot IK.
   ------------------------------------------------------------------ */

let _blobGeo = null;
let _blobMat = null;

function blobAssets() {
  if (_blobGeo) return { geo: _blobGeo, mat: _blobMat };
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const c2d = canvas.getContext("2d");
  const img = c2d.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const d = Math.hypot(dx, dy);
      // Squared falloff with a soft core. A linear ramp reads as a
      // grey plate; the core is what makes it read as contact.
      const a = clamp01(1 - d) ** 2 * (1 - smoothstep((d - 0.55) / 0.45) * 0.35);
      const i = (y * size + x) * 4;
      img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  c2d.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  _blobGeo = new THREE.PlaneGeometry(1, 1);
  _blobGeo.rotateX(-Math.PI / 2);
  _blobMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    opacity: 0.55, color: 0x000000, toneMapped: false,
  });
  _blobMat.polygonOffset = true;
  _blobMat.polygonOffsetFactor = -2;
  return { geo: _blobGeo, mat: _blobMat };
}

/* ------------------------------------------------------------------
   build
   ------------------------------------------------------------------ */

function ensureRuntime(ctx) {
  if (RT) return RT;
  const atlas = buildAtlas(ctx);
  const uniforms = {
    uApRimColour: { value: new THREE.Color(0x9fd8ff) },
    uApBounce: { value: new THREE.Color(0x3a1830) },
    /* 0.05, and it is the ONLY edge light on a character.
     *
     * It was 0.10 while the fresnel it is weighted by was pinned at
     * 1.0, so it was not an edge light at all - it was a flat additive
     * lift, and it was worth +38 luma at the MEDIAN of every dark zone
     * on the costume. Measured per material on the isolated figure:
     * boot authored at 8 arrived at 42 and returned to 4 with this
     * uniform zeroed; suit 42 -> 7; glove 49 -> 9; jacket 47 -> 21.
     * With a working fresnel the same 0.10 still costs the darkest
     * zones about 30, because a stylised figure is mostly tubes and
     * boxes seen at grazing angles and a fresnel term therefore covers
     * a lot of it. Halved again, the costume keeps a legible edge and
     * gets its bottom two value bands back: in-course body delta
     * against the floor goes from -32 to about -45.
     *
     * sky.js may raise it per course through setLighting(); a dark
     * interior wants more edge than a lit mall does, and nothing calls
     * that yet - courses 3 and 5 will want it. */
    uApRim: { value: 0.05 },
    uApBeat: { value: 0 },
  };
  RT = {
    ctx: ctx || null,
    atlas,
    uniforms,
    material: makeCharacterMaterial(ctx, atlas, uniforms),
    rigs: new Set(),
  };
  return RT;
}

/**
 * Build one figure.
 *
 * Returns the shape CONTRACT.md section 9 promises plus the extras
 * anim.js needs: `seg` so the IK does not have to rediscover the
 * skeleton, `secondary` so the springs are authored with the model,
 * and `blob` so the figure arrives already grounded.
 */
export function build(spec) {
  const rt = ensureRuntime(RT ? RT.ctx : null);
  const S = typeof spec === "string" ? specs[spec] : spec;
  if (!S) throw new Error(`apop3d/character: unknown spec "${spec}"`);

  const P = proportions(S.height, S.mods || {});
  const extras = S.extras || [];
  const { bones, list } = buildSkeleton(P, extras);

  const root = new THREE.Group();
  root.name = S.id || "figure";
  root.add(bones.root);
  root.updateMatrixWorld(true);

  /* Opt every figure into the grounded contact shadow.
     CONTRACT section 2 calls a floating character the loudest AAA
     failure there is, and one directional shadow map cannot reach
     sixty enemies across a course. vfx.js already owns a blob system
     that scans the scene for `userData.contactShadow` - declaring it
     here is, in that module's words, the whole integration cost, and
     it covers Moggadonna, all eight demons and the bosses at once
     rather than each of them remembering to ask.
     The radius comes off the figure's own hip width so a 1.05m imp
     does not get the same footprint as a three-metre boss. */
  const contactShadowDecl = {
    radius: Math.max(0.28, P.hipX * 2.6),
    strength: S.kind === "hero" ? 0.62 : 0.5,
  };

  const boneIndex = {};
  list.forEach((bone, i) => { boneIndex[bone.name] = i; });

  const rng = makeRng((S.seed ?? 0x2f31) >>> 0);
  const acc = makeAccumulator();
  const api = makeBuilder(bones, boneIndex, acc, P, rng);

  if (S.kind === "hero") moggadonnaParts(api, S);
  else if (DEMON_FORMS[S.form]) DEMON_FORMS[S.form](api, S);
  else throw new Error(`apop3d/character: spec "${S.id}" has no form`);

  const geometry = finishGeometry(acc);
  const skeleton = new THREE.Skeleton(list);
  const mesh = new THREE.SkinnedMesh(geometry, rt.material);
  mesh.userData.contactShadow = contactShadowDecl;
  mesh.name = `${S.id}.mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);

  /* Bounding volumes by hand.
   *
   * SkinnedMesh computes its own from the CURRENT pose the first time
   * the frustum asks, then caches it forever - so a figure that was
   * standing when it was first culled gets clipped the moment it
   * throws an arm out. A generous sphere authored from the spec is
   * both correct and cheaper. */
  const reach = S.height * 0.95;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, S.height * 0.5, 0), reach);
  mesh.boundingBox = new THREE.Box3(
    new THREE.Vector3(-reach, -0.2, -reach),
    new THREE.Vector3(reach, S.height * 1.25, reach)
  );

  // Props ride on the right hand. They are separate meshes because
  // they are toggled per action, and a prop welded into the skinned
  // buffer cannot be hidden without rebuilding it.
  const props = {};
  if (S.props) {
    for (const [name, partsFn] of Object.entries(S.props)) {
      const pAcc = makeAccumulator();
      const fake = { prop: { matrixWorld: new THREE.Matrix4() } };
      // baseOcc -1 cancels the body's ground/cavity terms: a prop is
      // authored around its own origin, so those terms would read the
      // mic grille as being buried in the floor.
      const pApi = makeBuilder(fake, { prop: 0 }, pAcc, P, makeRng(0x51 + name.length), -1);
      partsFn(pApi, S.palette);
      const pMesh = new THREE.Mesh(finishGeometry(pAcc), rt.material);
      pMesh.name = `${S.id}.${name}`;
      pMesh.castShadow = true;
      pMesh.frustumCulled = false;
      pMesh.visible = S.defaultProp === name;
      bones.handR.add(pMesh);
      props[name] = pMesh;
    }
  }

  let blob = null;
  if (S.blob !== false) {
    const { geo, mat } = blobAssets();
    blob = new THREE.Mesh(geo, mat);
    blob.name = `${S.id}.blob`;
    blob.scale.setScalar(S.height * 0.62);
    blob.renderOrder = 2;
    blob.frustumCulled = false;
    root.add(blob);
  }

  const rig = {
    root, mesh, skeleton, bones, props, blob,
    height: S.height,
    spec: S,
    seg: {
      height: S.height,
      hipY: P.hipY, hipX: P.hipX, hipDrop: P.hipDrop,
      thigh: P.thigh, shin: P.shin, ankle: P.ankle,
      shoulderX: P.shoulderX, upperArm: P.upperArm, foreArm: P.foreArm,
      headR: P.headR, neckY: P.neckY,
      footLength: S.height * 0.16,
    },
    secondary: S.secondary || [],
    rotors: (S.rotors || []).map((n) => bones[n]).filter(Boolean),
    flyer: !!S.flyer,
    dispose() {
      rt.rigs.delete(rig);
      geometry.dispose();
      for (const p of Object.values(props)) p.geometry.dispose();
      skeleton.dispose?.();
    },
  };
  rt.rigs.add(rig);
  return rig;
}

/* ------------------------------------------------------------------
   module interface
   ------------------------------------------------------------------ */

export function create(ctx) {
  const rt = ensureRuntime(ctx);
  rt.ctx = ctx;

  return {
    build,
    specs,
    derive,
    ZONES,
    BONE_NAMES,
    material: rt.material,
    atlas: rt.atlas,

    /** Beat reaction for every glowing part in the game at once. The
     *  music runs at 124 BPM and CONTRACT.md makes the beat a first
     *  class clock; a mic head that ignores it is the one thing on
     *  screen out of time. anim.js pushes this each frame. */
    setBeat(strength) {
      rt.uniforms.uApBeat.value = clamp01(strength || 0);
    },

    /** Per-course lighting hints. sky.js knows the palette; the
     *  characters just answer it. */
    setLighting({ rim, rimColour, bounce } = {}) {
      if (rim !== undefined) rt.uniforms.uApRim.value = rim;
      if (rimColour !== undefined) rt.uniforms.uApRimColour.value.set(rimColour);
      if (bounce !== undefined) rt.uniforms.uApBounce.value.set(bounce);
    },

    dispose() {
      for (const rig of Array.from(rt.rigs)) rig.dispose();
      rt.atlas.dispose();
      if (rt.material.userData.apopOwnedRamp) rt.material.gradientMap?.dispose();
      rt.material.dispose();
      if (_blobGeo) { _blobGeo.dispose(); _blobMat.map?.dispose(); _blobMat.dispose(); }
      _blobGeo = null; _blobMat = null;
      RT = null;
    },
  };
}
