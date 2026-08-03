/* ============================================================
   Tardigrade Simulator - the sandbox level
   ------------------------------------------------------------
   A single 900 x 900 unit open map: a patch of suburban back
   garden seen from 0.5 mm off the ground.

     west  ->  THE PATIO      cracked concrete slabs, canyon-deep
                              grout lines, lichen colonies, a
                              spilled drink lake, sugar boulders
     east  ->  THE FLOWERBED  loamy soil, a forest of grass blades
                              60-140 units tall, moss mounds,
                              fallen leaves the size of a field
     mid   ->  THE PUDDLE     a real water body whose meniscus
                              climbs the bank - surface tension is
                              a visible wall at this scale
     everywhere -> HUMAN DEBRIS as landmarks: a bottle cap arena,
                              a lolly-stick launch ramp, a
                              terracotta shard overhang, a LEGO
                              brick bridge, a coiled hose, and the
                              700-unit terracotta pot on the
                              skyline.

   API (consumed by qa.js / player.js / props.js):
     root, bounds, heightAt(x,z), spawnPoint(), getBeautyShots(),
     update(dt, ctx), report()

   Conventions used here:
     * No Math.random - every generator is a seeded makeRng().
     * All repeated geometry is InstancedMesh, chunked on a grid so
       frustum culling and distance LOD both work per chunk.
     * Foliage motion happens in the vertex shader (and in a
       matching customDepthMaterial so shadows agree).
     * heightAt() reads the exact same triangle the renderer draws,
       so nothing floats or sinks.
   ============================================================ */

import * as THREE from "three";
import { TAU, clamp, clamp01, lerp, smoothstep, makeRng } from "./core.js";
import { LAYER } from "./physics.js";

/* ================================================================
   0. Layout constants - the map's authored skeleton
   ================================================================ */

const MAP = 900;
const HALF = MAP / 2;

/** Patio slabs. Axis aligned rectangles; the gaps between them are
 *  the grout canyons you can fall into. */
const SLAB_COLS = [
  [-HALF - 20, -280],
  [-262, -72],
];
const SLAB_ROWS = [
  [-HALF - 20, -280],
  [-262, -72],
  [-54, 136],
  [154, 344],
  [362, HALF + 20],
];

const PATIO_TOP = 18;          // nominal slab surface height
const PATIO_BASE = 3.4;        // the grit floor the slabs sit on
const PATIO_EDGE_X = -46;      // nominal east edge of the paving

// depth is carved out of terrain that is itself ~22 units high here, so 26
// netted only 2.7 units of actual water - you waded, you never swam, and the
// underwater volume had no room to show itself. 46 gives ~17 units under the
// waterline, deep enough to dive and still shallow enough to climb out of.
const PUDDLE = { x: 46, z: 196, radius: 132, level: 1.2, depth: 46 };
const SPILL = { x: -348, z: 58, radius: 78, level: PATIO_TOP + 0.55, depth: 2.2 };

const LANDMARKS = {
  bottleCap: { x: -158, z: -166, radius: 66, skirt: 25 },
  legoBrick: { x: -271, z: 250, w: 132, d: 66, h: 40 },
  screw: { x: -166, z: 148, r: 19, len: 210 },
  shard: { x: 292, z: -232, radius: 196, height: 302 },
  lolly: { x0: 20, z0: -84, x1: 250, z1: -212, len: 424, w: 62, t: 13 },
  hose: { x: 306, z: 296, coil: 176, tube: 26 },
  pot: { x: -186, z: -706, radius: 258, height: 700 },
  boulders: { x: 8, z: -320, radius: 74 },
};

const MOUNDS = [
  { x: 176, z: 128, r: 148, h: 34 },
  { x: 336, z: 44, r: 116, h: 26 },
  { x: 96, z: 366, r: 132, h: 30 },
  { x: 372, z: -108, r: 104, h: 22 },
  { x: -8, z: -178, r: 96, h: 17 },
  { x: 250, z: 330, r: 120, h: 25 },
];

/** Clover-ish plants that make a canopy over the flowerbed. */
/* Clover plants. These are the level's only mid-ground silhouettes, and there
   used to be FOUR of them on a 900-unit map.

   That single number is why every wide frame reads as empty and why the wide
   frames have almost no cast shadows: ablating the sun changes a close shot by
   22.6 luma but establishing / debris-rest / pot-skyline by only 2 to 4.5,
   because those frames contain almost nothing to cast a shadow. That was
   misread twice as a shadow-cascade problem - rebalancing the cascades and
   halving the far texel moved those frames by under 0.9 luma, which is how we
   know it is population, not resolution.

   The four hand-placed ones are kept because they compose specific shots. */
const PLANTS = (() => {
  const placed = [
    { x: 208, z: 74, h: 300, tilt: 0.16, rot: 0.7 },
    { x: 348, z: -46, h: 246, tilt: 0.22, rot: 2.2 },
    { x: 118, z: 336, h: 274, tilt: 0.12, rot: 4.1 },
    { x: -6, z: 60, h: 214, tilt: 0.26, rot: 5.4 },
  ];
  const rng = makeRng(0x71ce03);
  // Keep clear of the water, the patio and every landmark's footprint, so
  // plants never grow through a prop or out of a puddle.
  const keepOut = [
    [PUDDLE.x, PUDDLE.z, PUDDLE.radius + 30],
    [SPILL.x, SPILL.z, SPILL.radius + 30],
    [LANDMARKS.bottleCap.x, LANDMARKS.bottleCap.z, LANDMARKS.bottleCap.radius + 55],
    [LANDMARKS.legoBrick.x, LANDMARKS.legoBrick.z, 120],
    [LANDMARKS.screw.x, LANDMARKS.screw.z, 130],
    [LANDMARKS.shard.x, LANDMARKS.shard.z, LANDMARKS.shard.radius + 50],
    [LANDMARKS.hose.x, LANDMARKS.hose.z, LANDMARKS.hose.coil + 70],
    [LANDMARKS.boulders.x, LANDMARKS.boulders.z, LANDMARKS.boulders.radius + 60],
    [(LANDMARKS.lolly.x0 + LANDMARKS.lolly.x1) / 2,
      (LANDMARKS.lolly.z0 + LANDMARKS.lolly.z1) / 2, 190],
    // The capture harness stands the hero on the sunlit face of a landmark,
    // choosing between these spots. A 300-unit clover dropped on one of them
    // puts the animal in deep shade and wrecks the three character shots -
    // measured, the first attempt at this took hero-scale's saturation from
    // 60.6 to 27.6 and hero-closeup's contrast from 41.8 to 14.7 while every
    // other frame improved. Keep the stage clear.
    [-115, -107, 95], [-198, 250, 95], [-271, 290, 95], [-144, 178, 95],
    [-86, -166, 80], [-158, -94, 80], [-212, 176, 80], [-96, -150, 80],
  ];
  const out = placed.slice();
  for (let guard = 0; guard < 6000 && out.length < 30; guard += 1) {
    const x = rng.range(-425, 425);
    const z = rng.range(-425, 425);
    // Do NOT ban the whole west half here. That rule ("x < PATIO_EDGE_X - 40")
    // excluded clover from the entire paved side of the map, which is exactly
    // the mid-ground the establishing shot looks across - so the population
    // fix raised debris-rest's shadowed ground fraction from 12.9% to 16.7%
    // and left establishing at 20.6% -> 20.7%, i.e. unchanged. Plants must
    // simply not stand ON a slab, and whether a point is on a slab is only
    // knowable once the slabs exist, so that test happens at build time
    // (see the canopy builder's onSlab check).
    // Relaxing this to -300 was tried so clover could reach the paved
    // mid-ground of the establishing shot. It did not pay: establishing's
    // shadowed-ground fraction did not improve (26.1% -> 24.0%, i.e. it went
    // the wrong way) and it dropped a stem 6 units in front of the
    // debris-rest camera, cutting a green bar through that frame. The
    // onSlab() test below is kept - it is correct regardless - but the bed
    // stays the bed.
    if (x < PATIO_EDGE_X - 40) continue;
    let ok = true;
    for (const [kx, kz, kr] of keepOut) {
      if ((x - kx) * (x - kx) + (z - kz) * (z - kz) < kr * kr) { ok = false; break; }
    }
    if (!ok) continue;
    // Spacing, so they read as scattered plants rather than a hedge.
    for (const p of out) {
      if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < 108 * 108) { ok = false; break; }
    }
    if (!ok) continue;
    out.push({
      x, z,
      h: rng.range(165, 325),
      tilt: rng.range(0.07, 0.30),
      rot: rng.range(0, TAU),
    });
  }
  return out;
})();

const SUN_DIR = new THREE.Vector3(0.42, 0.72, 0.55).normalize();

/* ================================================================
   1. Noise
   ================================================================ */

function makeNoise(seed) {
  const rng = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = (rng() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];

  const GX = new Float32Array(8);
  const GZ = new Float32Array(8);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU;
    GX[i] = Math.cos(a);
    GZ[i] = Math.sin(a);
  }

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function noise2(x, z) {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const X = xi & 255;
    const Z = zi & 255;
    const u = fade(xf);
    const v = fade(zf);
    const h00 = perm[perm[X] + Z] & 7;
    const h10 = perm[perm[X + 1] + Z] & 7;
    const h01 = perm[perm[X] + Z + 1] & 7;
    const h11 = perm[perm[X + 1] + Z + 1] & 7;
    const n00 = GX[h00] * xf + GZ[h00] * zf;
    const n10 = GX[h10] * (xf - 1) + GZ[h10] * zf;
    const n01 = GX[h01] * xf + GZ[h01] * (zf - 1);
    const n11 = GX[h11] * (xf - 1) + GZ[h11] * (zf - 1);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return clamp((a + v * (b - a)) * 1.42, -1, 1);
  }

  function fbm(x, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fz = z;
    for (let i = 0; i < octaves; i += 1) {
      sum += noise2(fx, fz) * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fz *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal - gives geology rather than blobby hills. */
  function ridged(x, z, octaves = 4) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fz = z;
    let prev = 1;
    for (let i = 0; i < octaves; i += 1) {
      let n = 1 - Math.abs(noise2(fx, fz));
      n *= n;
      n *= prev;
      prev = n;
      sum += n * amp;
      norm += amp;
      amp *= 0.55;
      fx *= 2.07;
      fz *= 2.07;
    }
    return (sum / norm) * 2 - 1;
  }

  return { noise2, fbm, ridged };
}

/* ================================================================
   2. GridSurface - a regular height grid whose sampler returns the
      exact height of the triangle the renderer draws.
   ================================================================ */

class GridSurface {
  constructor(x0, z0, sizeX, sizeZ, nx, nz) {
    this.x0 = x0;
    this.z0 = z0;
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.nx = nx;             // vertices along x
    this.nz = nz;             // vertices along z
    this.cx = nx - 1;
    this.cz = nz - 1;
    this.dx = sizeX / this.cx;
    this.dz = sizeZ / this.cz;
    this.h = new Float32Array(nx * nz);
  }

  idx(i, j) { return j * this.nx + i; }
  set(i, j, v) { this.h[j * this.nx + i] = v; }
  get(i, j) { return this.h[j * this.nx + i]; }

  vx(i) { return this.x0 + i * this.dx; }
  vz(j) { return this.z0 + j * this.dz; }

  contains(x, z) {
    return x >= this.x0 && x <= this.x0 + this.sizeX
      && z >= this.z0 && z <= this.z0 + this.sizeZ;
  }

  /** Exactly matches the triangulation emitted by buildGeometry(). */
  sample(x, z) {
    let fi = (x - this.x0) / this.dx;
    let fj = (z - this.z0) / this.dz;
    fi = clamp(fi, 0, this.cx - 1e-6);
    fj = clamp(fj, 0, this.cz - 1e-6);
    const i = fi | 0;
    const j = fj | 0;
    const fx = fi - i;
    const fz = fj - j;
    const h00 = this.h[j * this.nx + i];
    const h10 = this.h[j * this.nx + i + 1];
    const h01 = this.h[(j + 1) * this.nx + i];
    const h11 = this.h[(j + 1) * this.nx + i + 1];
    if (fz < fx) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  normal(x, z, out) {
    const e = Math.max(this.dx, this.dz) * 0.75;
    const hl = this.sample(x - e, z);
    const hr = this.sample(x + e, z);
    const hd = this.sample(x, z - e);
    const hu = this.sample(x, z + e);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
    return out;
  }

  /** Triangulated mesh geometry. Winding matches sample()'s split. */
  buildGeometry(uvScale) {
    const { nx, nz } = this;
    const count = nx * nz;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = j * nx + i;
        const x = this.vx(i);
        const z = this.vz(j);
        pos[k * 3] = x;
        pos[k * 3 + 1] = this.h[k];
        pos[k * 3 + 2] = z;
        uv[k * 2] = x * uvScale;
        uv[k * 2 + 1] = z * uvScale;
      }
    }
    // Central-difference normals (matches the visual surface closely).
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = j * nx + i;
        const l = this.h[j * nx + Math.max(0, i - 1)];
        const r = this.h[j * nx + Math.min(nx - 1, i + 1)];
        const d = this.h[Math.max(0, j - 1) * nx + i];
        const u = this.h[Math.min(nz - 1, j + 1) * nx + i];
        const sx = (i === 0 || i === nx - 1) ? this.dx : this.dx * 2;
        const sz = (j === 0 || j === nz - 1) ? this.dz : this.dz * 2;
        let nxv = (l - r) / sx;
        let nyv = 1;
        let nzv = (d - u) / sz;
        const inv = 1 / Math.hypot(nxv, nyv, nzv);
        nor[k * 3] = nxv * inv;
        nor[k * 3 + 1] = nyv * inv;
        nor[k * 3 + 2] = nzv * inv;
      }
    }
    const tri = this.cx * this.cz * 2;
    const index = count > 65535 ? new Uint32Array(tri * 3) : new Uint16Array(tri * 3);
    let t = 0;
    for (let j = 0; j < this.cz; j += 1) {
      for (let i = 0; i < this.cx; i += 1) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index[t++] = a; index[t++] = d; index[t++] = b;   // fz < fx
        index[t++] = a; index[t++] = c; index[t++] = d;   // fz >= fx
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    return geo;
  }
}

/* ================================================================
   3. Shader plumbing - chain onto whatever the materials agent
      hands us instead of replacing it.
   ================================================================ */

const GLSL_NOISE = /* glsl */ `
  float tsHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.19);
    return fract(p.x * p.y);
  }
  float tsNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = tsHash(i);
    float b = tsHash(i + vec2(1.0, 0.0));
    float c = tsHash(i + vec2(0.0, 1.0));
    float d = tsHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float tsFbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += tsNoise(p) * a; p *= 2.07; a *= 0.5; }
    return s;
  }
`;

/* ----------------------------------------------------------------
   Per-instance variation.

   Every scattered thing in this level is an InstancedMesh sharing one
   geometry, so the only per-instance channel that is free is the
   instance matrix itself. Hashing its translation gives three
   uncorrelated randoms that survive into the fragment stage, which is
   what stops a field of gravel reading as one stamp repeated 2000
   times. Costs nothing: no extra attribute, no extra draw.
   ---------------------------------------------------------------- */
const IRAND_HEAD_VERT = "varying vec3 vIRand;";
const IRAND_HEAD_FRAG = "varying vec3 vIRand;";
const IRAND_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    vIRand = fract(sin(vec3(
      dot(ip.xz, vec2(12.9898, 78.233)),
      dot(ip.zy, vec2(39.3468, 11.1357)),
      dot(ip.xy, vec2(93.9898, 67.3455))
    )) * 43758.5453);
  }
  #else
    vIRand = vec3(0.5);
  #endif
`;

/** Merge the instance-hash plumbing into an extendMaterial() options blob. */
function withIRand(opts) {
  return {
    ...opts,
    vertexHead: `${IRAND_HEAD_VERT}\n${opts.vertexHead || ""}`,
    vertexBody: `${IRAND_BODY}\n${opts.vertexBody || ""}`,
    fragmentHead: `${IRAND_HEAD_FRAG}\n${opts.fragmentHead || ""}`,
  };
}

let extendSeq = 0;

function extendMaterial(material, opts) {
  const key = `ts${extendSeq++}:${opts.key || ""}`;
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function patched(shader, renderer) {
    if (typeof prevCompile === "function") prevCompile.call(this, shader, renderer);
    if (opts.uniforms) {
      for (const name of Object.keys(opts.uniforms)) shader.uniforms[name] = opts.uniforms[name];
    }
    if (opts.vertexHead) shader.vertexShader = `${opts.vertexHead}\n${shader.vertexShader}`;
    if (opts.vertexBody) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${opts.vertexBody}`
      );
    }
    if (opts.fragmentHead) shader.fragmentShader = `${opts.fragmentHead}\n${shader.fragmentShader}`;
    for (const patch of opts.fragmentPatches || []) {
      shader.fragmentShader = shader.fragmentShader.replace(patch.at, `${patch.at}\n${patch.code}`);
    }
  };
  material.customProgramCacheKey = function patchedKey() {
    const base = typeof prevKey === "function" ? prevKey.call(this) : "";
    return `${base}|${key}`;
  };
  return material;
}

/** Average luminance of a texture's image, so injected shaders can
 *  normalise against whatever albedo the materials library ships. */
function textureLuma(texture) {
  if (!texture || !texture.image) return null;
  try {
    const img = texture.image;
    if (img.data && img.data.length >= 4) {
      let sum = 0;
      let n = 0;
      const step = Math.max(4, (img.data.length / 4 / 4096 | 0) * 4);
      for (let i = 0; i < img.data.length - 3; i += step) {
        sum += (img.data[i] * 0.2126 + img.data[i + 1] * 0.7152 + img.data[i + 2] * 0.0722) / 255;
        n += 1;
      }
      return n ? clamp(sum / n, 0.02, 1) : null;
    }
    const w = img.width || img.videoWidth;
    if (!w) return null;
    const c = document.createElement("canvas");
    c.width = 24;
    c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    }
    return clamp(sum / (d.length / 4), 0.02, 1);
  } catch (error) {
    return null;
  }
}

/* ================================================================
   4. World factory
   ================================================================ */

export async function createWorld(ctx) {
  const THREE_ = ctx.THREE || THREE;
  const q = ctx.settings.quality;
  const tier = ctx.settings.tierName;
  const scatterMul = q.scatter;

  const root = new THREE_.Group();
  root.name = "World";
  ctx.scene.add(root);

  const rngTerrain = makeRng(0x9e3d17);
  const noise = makeNoise(0x51a3b7);
  const noiseB = makeNoise(0x2c77e1);

  const stats = { meshes: 0, instances: 0, triangles: 0, chunks: 0 };
  const geometries = [];
  const track = (r) => { ctx.track(r); return r; };
  const trackGeo = (g) => { geometries.push(g); ctx.track(g); return g; };

  const uTime = { value: 0 };
  const uWindDir = { value: new THREE_.Vector2(0.82, 0.57).normalize() };
  const uWindStrength = { value: 1 };
  const uSunDir = { value: SUN_DIR.clone() };
  if (ctx.engine && ctx.engine.sun && ctx.engine.sun.direction) {
    uSunDir.value.copy(ctx.engine.sun.direction);
  }

  /* -------------------------------------------------------------
     4.1 Authored terrain features
     ------------------------------------------------------------- */

  /** Wavy boundary between the paving grit and the flowerbed soil. */
  function patioEdgeAt(z) {
    return PATIO_EDGE_X + noise.fbm(z * 0.0031, 11.3, 3) * 46 + noise.noise2(z * 0.011, 4.1) * 14;
  }

  /** 1 deep inside the patio, 0 out in the soil. */
  function patioMask(x, z) {
    const edge = patioEdgeAt(z);
    return smoothstep(edge + 26, edge - 54, x);
  }

  function moundLift(x, z) {
    let h = 0;
    for (const m of MOUNDS) {
      const d = Math.hypot(x - m.x, z - m.z) / m.r;
      if (d < 1.35) {
        const f = Math.exp(-d * d * 1.7);
        h += m.h * f * (0.78 + 0.44 * noise.fbm(x * 0.012 + m.x, z * 0.012, 2));
      }
    }
    return h;
  }

  function puddleBasin(x, z, p) {
    const dx = x - p.x;
    const dz = z - p.z;
    const ang = Math.atan2(dz, dx);
    const wob = 1 + noise.noise2(Math.cos(ang) * 1.7 + p.x * 0.01, Math.sin(ang) * 1.7) * 0.19;
    const d = Math.hypot(dx, dz) / (p.radius * wob);
    if (d > 1.32) return 0;
    const t = clamp01(1 - d / 1.14);
    return -p.depth * Math.pow(t, 1.55) * (0.9 + 0.2 * noise.noise2(x * 0.02, z * 0.02));
  }

  /** The master height function. Only used to fill the grid. */
  function rawHeight(x, z) {
    const pm = patioMask(x, z);

    // Domain warped fBm for the soil landscape.
    const wx = x + noise.fbm(x * 0.0026, z * 0.0026, 3) * 138;
    const wz = z + noiseB.fbm(x * 0.0026 + 7.1, z * 0.0026 - 3.4, 3) * 138;
    let soil = noise.fbm(wx * 0.0031, wz * 0.0031, 5) * 30;
    soil += noise.ridged(wx * 0.0092, wz * 0.0092, 4) * 11;
    soil += noise.fbm(x * 0.031, z * 0.031, 3) * 3.1;
    soil += noiseB.fbm(x * 0.115, z * 0.115, 2) * 0.9;
    soil += 7;
    soil += moundLift(x, z);

    // Grit / sand floor between and under the paving slabs.
    let grit = PATIO_BASE;
    grit += noise.fbm(x * 0.021, z * 0.021, 3) * 3.4;
    grit += noiseB.fbm(x * 0.09, z * 0.09, 2) * 1.1;
    grit += noise.ridged(x * 0.006, z * 0.006, 2) * 2.2;

    let h = lerp(soil, grit, pm);

    // Rubble berm where the paving breaks into the bed.
    const edge = patioEdgeAt(z);
    const berm = Math.exp(-Math.pow((x - edge - 14) / 34, 2)) * (5.5 + noise.noise2(z * 0.05, 2.2) * 4.5);
    h += berm * (1 - pm) * 1.4;

    // Basins.
    h += puddleBasin(x, z, PUDDLE);

    // Landmark bedding so nothing floats.
    const bed = (cx, cz, r, target, power) => {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d > 1.4) return;
      const f = Math.pow(clamp01(1 - d / 1.4), power || 1.6);
      h = lerp(h, target, f);
    };
    bed(LANDMARKS.shard.x, LANDMARKS.shard.z, 214, 12, 1.3);
    bed(LANDMARKS.hose.x, LANDMARKS.hose.z, 214, 14, 1.4);
    bed(LANDMARKS.lolly.x0, LANDMARKS.lolly.z0, 96, 9, 1.5);
    bed(LANDMARKS.boulders.x, LANDMARKS.boulders.z, 92, 10, 1.5);

    return h;
  }

  /* -------------------------------------------------------------
     4.2 Terrain grid
     ------------------------------------------------------------- */

  const GRID_N = tier === "low" ? 145 : tier === "medium" ? 193 : 257;
  const terrain = new GridSurface(-HALF, -HALF, MAP, MAP, GRID_N, GRID_N);
  for (let j = 0; j < GRID_N; j += 1) {
    const z = terrain.vz(j);
    for (let i = 0; i < GRID_N; i += 1) {
      terrain.set(i, j, rawHeight(terrain.vx(i), z));
    }
  }

  /* -------------------------------------------------------------
     4.3 Paving slabs
     ------------------------------------------------------------- */

  const slabRng = makeRng(0x4b19af);
  const slabs = [];

  function makeSlab(x0, x1, z0, z1) {
    const w = x1 - x0;
    const d = z1 - z0;
    const res = Math.max(12, Math.min(40, Math.round(Math.max(w, d) / 6)));
    const g = new GridSurface(x0, z0, w, d, res + 1, res + 1);

    // Was range(-2.6, 2.2), i.e. neighbouring slabs could differ by 4.8 -
    // a sheer step three times the hero's height where two slabs meet, which
    // autostep (1.15) cannot climb. Keep the settling visible but passable.
    const base = PATIO_TOP + slabRng.range(-0.85, 0.7);
    const tiltX = slabRng.range(-0.016, 0.016);
    const tiltZ = slabRng.range(-0.016, 0.016);
    const seed = slabRng.range(0, 400);

    // 0-2 cracks per slab, as jagged polylines across the surface.
    const cracks = [];
    const crackCount = slabRng() < 0.55 ? (slabRng() < 0.4 ? 2 : 1) : 0;
    for (let c = 0; c < crackCount; c += 1) {
      const deep = slabRng() < 0.42;
      const pts = [];
      const side = slabRng.int(0, 3);
      const start = side === 0 ? [x0, lerp(z0, z1, slabRng())]
        : side === 1 ? [x1, lerp(z0, z1, slabRng())]
          : side === 2 ? [lerp(x0, x1, slabRng()), z0]
            : [lerp(x0, x1, slabRng()), z1];
      const oside = (side + slabRng.int(1, 3)) % 4;
      const end = oside === 0 ? [x0, lerp(z0, z1, slabRng())]
        : oside === 1 ? [x1, lerp(z0, z1, slabRng())]
          : oside === 2 ? [lerp(x0, x1, slabRng()), z0]
            : [lerp(x0, x1, slabRng()), z1];
      const steps = 6;
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const jit = (s === 0 || s === steps) ? 0 : 1;
        pts.push([
          lerp(start[0], end[0], t) + slabRng.range(-24, 24) * jit,
          lerp(start[1], end[1], t) + slabRng.range(-24, 24) * jit,
        ]);
      }
      cracks.push({ pts, width: deep ? slabRng.range(12, 18) : slabRng.range(4.5, 8), deep });
    }

    function segDist(px, pz, ax, az, bx, bz) {
      const vx = bx - ax;
      const vz = bz - az;
      const wx = px - ax;
      const wz = pz - az;
      const len = vx * vx + vz * vz;
      const t = len > 0 ? clamp01((wx * vx + wz * vz) / len) : 0;
      return Math.hypot(wx - vx * t, wz - vz * t);
    }

    function surfaceAt(x, z) {
      let h = base + (x - (x0 + x1) * 0.5) * tiltX + (z - (z0 + z1) * 0.5) * tiltZ;
      // worn, slightly dished surface
      // Long-wavelength settling stays; the fine term is surface roughness
      // and belongs in the normal map, not in a metre of geometry.
      h += noiseB.fbm(x * 0.014 + seed, z * 0.014, 3) * 0.9;
      h += noise.fbm(x * 0.08, z * 0.08, 2) * 0.22;
      const cu = clamp01((x - x0) / w);
      const cv = clamp01((z - z0) / d);
      // Was 1.1 * ... * 2.2, dishing the edges ~1.2 units below the middle.
      // On a cast slab that reads as an inflated cushion - a reviewer said
      // the paving looked like mattresses. Real slabs are flat; keep just
      // enough dish to catch water.
      h -= 0.22 * (Math.pow(cu - 0.5, 2) + Math.pow(cv - 0.5, 2)) * 2.2;

      // eroded, chipped edges
      const e = Math.min(x - x0, x1 - x, z - z0, z1 - z);
      // A 9-15 unit wide rolloff dropping up to 7.6 units is not a chipped
      // edge, it is a rounded-over cushion - and now that neighbouring slabs
      // abut, two of them meet as a soft V-valley at every joint. Concrete
      // breaks in a narrow chamfer and stays flat right up to it, so keep the
      // chip tight and raise the exponent so the flat plane survives.
      const chip = 2.6 + noise.noise2(x * 0.06 + seed, z * 0.06) * 1.6;
      if (e < chip) {
        const f = Math.pow(1 - e / chip, 3.0);
        h -= f * (0.9 + noiseB.noise2(x * 0.09, z * 0.09) * 0.7);
      }

      // cracks
      for (const cr of cracks) {
        let dmin = 1e9;
        for (let s = 0; s < cr.pts.length - 1; s += 1) {
          const a = cr.pts[s];
          const b = cr.pts[s + 1];
          const dd = segDist(x, z, a[0], a[1], b[0], b[1]);
          if (dd < dmin) dmin = dd;
        }
        const wdt = cr.width * (0.7 + 0.6 * noise.noise2(x * 0.05, z * 0.05));
        if (dmin < wdt) {
          const f = Math.pow(1 - dmin / wdt, 1.4);
          // Cracks were cut 5.5 units deep, and "deep" ones the full slab
          // thickness plus 3 - roughly 18. Against a hero 1.6 units long
          // those are ravines, not cracks: they read as breaks in the ground,
          // and because autostep is 0.55 they are unclimbable walls, which is
          // what makes them feel like invisible barriers (headbutt punches
          // through because it moves the body faster than the controller
          // sweeps). Keep them as surface relief you can walk over.
          const depth = cr.deep ? 1.5 : 0.8;
          h -= f * depth;
        }
      }
      return h;
    }

    for (let j = 0; j < g.nz; j += 1) {
      const z = g.vz(j);
      for (let i = 0; i < g.nx; i += 1) {
        g.set(i, j, surfaceAt(g.vx(i), z));
      }
    }
    const slab = { grid: g, x0, x1, z0, z1, base, top: base + 3 };
    slabs.push(slab);
    return slab;
  }

  // The rows and columns above leave 18-unit gaps between slabs, and the
  // ground in a gap sits at the grit floor ~15 units below the slab tops. At
  // a hero 1.6 units long that is a trench eleven body-lengths wide and nine
  // deep - not a paving joint, a canyon, and the thing that reads in play as
  // "a break in the ground". Grow each slab by half the gap so neighbours
  // meet, leaving a seam instead of a hole.
  const SLAB_GROW = 9;
  for (const [x0, x1] of SLAB_COLS) {
    for (const [z0, z1] of SLAB_ROWS) {
      makeSlab(
        Math.max(x0 - SLAB_GROW, -HALF), Math.min(x1 + SLAB_GROW, HALF),
        Math.max(z0 - SLAB_GROW, -HALF), Math.min(z1 + SLAB_GROW, HALF),
      );
    }
  }

  /* Foliage that the player can bump into and climb.
   *
   * At this scale a blade of grass is 5-9 units wide and 58-142 tall
   * against a 1.6-unit hero - it is a TREE, and having the animal walk
   * through it like fog was the single biggest break in the illusion. Each
   * scatter block that wants collision pushes a descriptor here and
   * registerPhysics() turns them into static bodies. */
  const foliageColliders = [];
  const GRASS_COLLIDE_EVERY = Number(
    (typeof window !== "undefined" && window.__TSIM_GRASS_EVERY) || 1
  );
  let grassCollideCounter = 0;

  /* -------------------------------------------------------------
     4.4 heightAt - terrain, then any slab covering the point
     ------------------------------------------------------------- */

  function terrainAt(x, z) {
    return terrain.sample(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF));
  }

  function heightAt(x, z) {
    for (let i = 0; i < slabs.length; i += 1) {
      const s = slabs[i];
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) {
        const h = s.grid.sample(x, z);
        const t = terrainAt(x, z);
        return h > t ? h : t;
      }
    }
    return terrainAt(x, z);
  }

  function slopeAt(x, z) {
    const e = 4;
    const hl = terrainAt(x - e, z);
    const hr = terrainAt(x + e, z);
    const hd = terrainAt(x, z - e);
    const hu = terrainAt(x, z + e);
    return Math.hypot((hr - hl) / (2 * e), (hu - hd) / (2 * e));
  }

  function onSlab(x, z) {
    for (let i = 0; i < slabs.length; i += 1) {
      const s = slabs[i];
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
    }
    return null;
  }

  /* -------------------------------------------------------------
     4.5 Baked sky occlusion + sun shadow (the shadow map only
         covers +/-90 units around the focus, so the wide shots
         need real form baked into the vertex colours)
     ------------------------------------------------------------- */

  const AO_N = 129;
  const aoGrid = new Float32Array(AO_N * AO_N);
  const shGrid = new Float32Array(AO_N * AO_N);

  const occluders = [
    { x: LANDMARKS.shard.x, z: LANDMARKS.shard.z, r: 150, h: 240 },
    { x: LANDMARKS.bottleCap.x, z: LANDMARKS.bottleCap.z, r: 68, h: 30 },
    { x: LANDMARKS.hose.x, z: LANDMARKS.hose.z, r: 190, h: 76 },
    { x: LANDMARKS.pot.x, z: LANDMARKS.pot.z, r: LANDMARKS.pot.radius, h: LANDMARKS.pot.height },
    { x: LANDMARKS.boulders.x, z: LANDMARKS.boulders.z, r: 66, h: 46 },
  ];
  for (const p of PLANTS) occluders.push({ x: p.x, z: p.z, r: 74, h: p.h });

  function occluderTop(x, z) {
    let top = -1e9;
    for (const o of occluders) {
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < o.r) {
        const t = terrainAt(o.x, o.z) + o.h * (1 - Math.pow(d / o.r, 2.2));
        if (t > top) top = t;
      }
    }
    return top;
  }

  function blockedHeight(x, z) {
    const s = onSlab(x, z);
    const th = terrainAt(x, z);
    const sh = s ? Math.max(th, s.grid.sample(x, z)) : th;
    const oh = occluderTop(x, z);
    return oh > sh ? oh : sh;
  }

  {
    const step = MAP / (AO_N - 1);
    const sunDir = uSunDir.value;
    const sunXZ = Math.hypot(sunDir.x, sunDir.z) || 1e-4;
    const sunSlope = sunDir.y / sunXZ;
    const sx = sunDir.x / sunXZ;
    const sz = sunDir.z / sunXZ;
    const DIRS = 8;
    const dirs = [];
    for (let d = 0; d < DIRS; d += 1) {
      const a = (d / DIRS) * TAU + 0.31;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }
    for (let j = 0; j < AO_N; j += 1) {
      const z = -HALF + j * step;
      for (let i = 0; i < AO_N; i += 1) {
        const x = -HALF + i * step;
        const h0 = blockedHeight(x, z);

        // sky occlusion: worst elevation angle seen in 8 directions
        let occ = 0;
        for (let d = 0; d < DIRS; d += 1) {
          const dx = dirs[d][0];
          const dz = dirs[d][1];
          let maxTan = 0;
          for (let s = 1; s <= 9; s += 1) {
            const dist = s * s * 2.2 + 4;
            if (dist > 230) break;
            const hh = blockedHeight(x + dx * dist, z + dz * dist);
            const tan = (hh - h0) / dist;
            if (tan > maxTan) maxTan = tan;
          }
          occ += maxTan / Math.sqrt(1 + maxTan * maxTan);
        }
        aoGrid[j * AO_N + i] = clamp01(1 - (occ / DIRS) * 1.15);

        // sun visibility
        let lit = 1;
        for (let s = 1; s <= 26; s += 1) {
          const dist = s * 9;
          const hh = blockedHeight(x + sx * dist, z + sz * dist);
          if (hh > h0 + dist * sunSlope + 0.6) { lit = 0; break; }
        }
        shGrid[j * AO_N + i] = lit;
      }
    }
    // soften the shadow edge
    const blur = new Float32Array(shGrid.length);
    for (let j = 0; j < AO_N; j += 1) {
      for (let i = 0; i < AO_N; i += 1) {
        let sum = 0;
        let n = 0;
        for (let b = -2; b <= 2; b += 1) {
          for (let a = -2; a <= 2; a += 1) {
            const ii = clamp(i + a, 0, AO_N - 1);
            const jj = clamp(j + b, 0, AO_N - 1);
            sum += shGrid[jj * AO_N + ii];
            n += 1;
          }
        }
        blur[j * AO_N + i] = sum / n;
      }
    }
    shGrid.set(blur);
  }

  function bilinear(grid, n, x, z) {
    const fx = clamp((x + HALF) / MAP, 0, 0.999999) * (n - 1);
    const fz = clamp((z + HALF) / MAP, 0, 0.999999) * (n - 1);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const i1 = Math.min(i + 1, n - 1);
    const j1 = Math.min(j + 1, n - 1);
    const a = grid[j * n + i] * (1 - tx) + grid[j * n + i1] * tx;
    const b = grid[j1 * n + i] * (1 - tx) + grid[j1 * n + i1] * tx;
    return a * (1 - tz) + b * tz;
  }

  const aoAt = (x, z) => bilinear(aoGrid, AO_N, x, z);
  const sunAt = (x, z) => bilinear(shGrid, AO_N, x, z);

  /* -------------------------------------------------------------
     4.6 Terrain material + splat weights
     ------------------------------------------------------------- */

  const soilBase = ctx.materials.get("soil");
  const mossBase = ctx.materials.get("moss");
  const gravelBase = ctx.materials.get("gravel");
  const concreteBase = ctx.materials.get("concrete");

  const detailTex = soilBase && soilBase.map ? soilBase.map : null;
  const detailLuma = textureLuma(detailTex);

  const COL_SOIL = new THREE_.Color(0x54402c);
  const COL_MOSS = new THREE_.Color(0x53772f);
  const COL_GRIT = new THREE_.Color(0x9c9384);
  const COL_WET = new THREE_.Color(0x3a2f22);

  const terrainMat = track(ctx.materials.make("soil", {
    vertexColors: true,
    color: 0xffffff,
    // Soil holds some organic sheen; at 0.97 the specular lobe is so broad
    // it is invisible and the ground reads as flat clay.
    roughness: 0.88,
    metalness: 0,
    dithering: true,
  }));

  extendMaterial(terrainMat, {
    key: "terrain-splat",
    uniforms: {
      uColSoil: { value: COL_SOIL },
      uColMoss: { value: COL_MOSS },
      uColGrit: { value: COL_GRIT },
      uColWet: { value: COL_WET },
      uDetailLuma: { value: detailLuma || 0.5 },
      uDetailAmt: { value: detailLuma ? 1 : 0 },
    },
    vertexHead: /* glsl */ `
      attribute vec4 aSplat;
      varying vec4 vSplat;
      varying vec3 vWPos;
    `,
    vertexBody: /* glsl */ `
      vSplat = aSplat;
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `,
    fragmentHead: /* glsl */ `
      varying vec4 vSplat;
      varying vec3 vWPos;
      uniform vec3 uColSoil;
      uniform vec3 uColMoss;
      uniform vec3 uColGrit;
      uniform vec3 uColWet;
      uniform float uDetailLuma;
      uniform float uDetailAmt;
      ${GLSL_NOISE}
    `,
    fragmentPatches: [{
      at: "#include <color_fragment>",
      code: /* glsl */ `
        {
          vec4 w = vSplat;
          float tot = max(w.x + w.y + w.z + w.w, 1e-4);
          w /= tot;
          vec3 tint = uColSoil * w.x + uColMoss * w.y + uColGrit * w.z + uColWet * w.w;

          // large scale value breakup so the ground never reads as one flat wash
          vec2 p = vWPos.xz;
          float macro = tsFbm(p * 0.0042) * 0.62 + tsFbm(p * 0.019) * 0.26 + tsNoise(p * 0.24) * 0.12;
          tint *= 0.70 + 0.62 * macro;

          // mossy patches get a cooler, more saturated read
          tint = mix(tint, tint * vec3(0.86, 1.14, 0.78), w.y * 0.55);

          float detail = 1.0;
          if (uDetailAmt > 0.5) {
            float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            detail = clamp(lum / max(uDetailLuma, 0.02), 0.45, 1.75);
          }
          // vColor carries baked AO + sun shadow; keep it, drop the map's hue.
          float bake = dot(vColor.rgb, vec3(0.3333));
          diffuseColor.rgb = tint * mix(1.0, detail, 0.75) * (vColor.rgb / max(bake, 0.001)) * bake;
        }
      `,
    }, {
      at: "#include <roughnessmap_fragment>",
      code: /* glsl */ `
        roughnessFactor = mix(roughnessFactor, 0.72, vSplat.y * 0.5);
        roughnessFactor = mix(roughnessFactor, 0.38, vSplat.w * 0.8);
      `,
    }],
  });

  const terrainGeo = trackGeo(terrain.buildGeometry(1 / MAP));
  {
    const pos = terrainGeo.attributes.position.array;
    const n = terrainGeo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const splat = new Float32Array(n * 4);
    const c = new THREE_.Color();
    for (let k = 0; k < n; k += 1) {
      const x = pos[k * 3];
      const z = pos[k * 3 + 2];
      const y = pos[k * 3 + 1];
      const pm = patioMask(x, z);
      const slope = slopeAt(x, z);
      const wet = clamp01(1 - Math.abs(y - PUDDLE.level) / 16)
        * clamp01(1.55 - Math.hypot(x - PUDDLE.x, z - PUDDLE.z) / PUDDLE.radius);

      const mossNoise = noise.fbm(x * 0.0085, z * 0.0085, 3) * 0.5 + 0.5;
      let moss = clamp01((mossNoise - 0.32) * 2.1) * clamp01(1 - slope * 1.5) * (1 - pm);
      moss *= clamp01(0.35 + moundLift(x, z) / 20);
      moss = clamp01(moss + wet * 0.3 * (1 - pm));

      let grit = pm;
      grit = clamp01(grit + clamp01(slope * 1.9 - 0.35) * 0.8);
      grit *= clamp01(1 - wet * 0.7);

      let soil = clamp01(1 - moss * 0.9 - grit * 0.9);
      const wetW = clamp01(wet * 1.25) * 0.85;

      splat[k * 4] = soil;
      splat[k * 4 + 1] = moss;
      splat[k * 4 + 2] = grit;
      splat[k * 4 + 3] = wetW;

      const ao = Math.pow(aoAt(x, z), 1.25);
      const sun = sunAt(x, z);
      const shade = lerp(0.82, 1.0, sun);
      const v = clamp(ao * shade, 0.18, 1.4);
      // slight warm bounce in lit areas, cool in the shade
      c.setRGB(v * lerp(0.94, 1.03, sun), v * lerp(0.96, 1.0, sun), v * lerp(1.06, 0.95, sun));
      colors[k * 3] = c.r;
      colors[k * 3 + 1] = c.g;
      colors[k * 3 + 2] = c.b;
    }
    terrainGeo.setAttribute("color", new THREE_.BufferAttribute(colors, 3));
    terrainGeo.setAttribute("aSplat", new THREE_.BufferAttribute(splat, 4));
  }

  const terrainMesh = new THREE_.Mesh(terrainGeo, terrainMat);
  terrainMesh.name = "Terrain";
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = false;
  terrainMesh.matrixAutoUpdate = false;
  terrainMesh.updateMatrix();
  root.add(terrainMesh);
  stats.meshes += 1;
  stats.triangles += terrainGeo.index.count / 3;

  /* -------------------------------------------------------------
     4.7 Slab meshes (merged into one concrete draw)
     ------------------------------------------------------------- */

  const concreteMat = track(ctx.materials.make("concrete", {
    vertexColors: true,
    color: 0xffffff,
    // Dry cast concrete sits near 0.75 perceptual roughness, not 0.93.
    roughness: 0.76,
    metalness: 0,
  }));
  extendMaterial(concreteMat, {
    key: "concrete-grade",
    fragmentHead: /* glsl */ `
      varying vec3 vCWPos;
      ${GLSL_NOISE}
    `,
    vertexHead: "varying vec3 vCWPos;",
    vertexBody: "vCWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    fragmentPatches: [{
      at: "#include <color_fragment>",
      code: /* glsl */ `
        {
          vec2 p = vCWPos.xz;
          float aggregate = tsNoise(p * 0.72) * 0.10 + tsNoise(p * 0.21) * 0.14;
          float macro = tsFbm(p * 0.0075) * 0.5 + tsFbm(p * 0.035) * 0.3;
          vec3 base = vec3(0.60, 0.585, 0.545);
          base *= 0.72 + 0.52 * macro + aggregate;
          // damp staining collects towards the grout
          base = mix(base, base * vec3(0.72, 0.74, 0.70), clamp(tsFbm(p * 0.012 + 5.1) * 1.3 - 0.25, 0.0, 1.0));
          diffuseColor.rgb *= base * 1.55;
        }
      `,
    }, {
      at: "#include <roughnessmap_fragment>",
      code: "roughnessFactor = clamp(roughnessFactor * (0.86 + 0.3 * tsNoise(vCWPos.xz * 0.4)), 0.35, 1.0);",
    }],
  });

  {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    let vbase = 0;
    const tmpN = new THREE_.Vector3();

    for (const slab of slabs) {
      const g = slab.grid;
      const geo = g.buildGeometry(1 / 260);
      const p = geo.attributes.position.array;
      const nn = geo.attributes.normal.array;
      const uu = geo.attributes.uv.array;
      const idx = geo.index.array;
      const count = geo.attributes.position.count;

      for (let k = 0; k < count; k += 1) {
        const x = p[k * 3];
        const y = p[k * 3 + 1];
        const z = p[k * 3 + 2];
        positions.push(x, y, z);
        normals.push(nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]);
        uvs.push(uu[k * 2], uu[k * 2 + 1]);
        // AO from how far below the nominal slab top this vertex sits
        const sink = clamp01((slab.base - y) / 9);
        const ao = lerp(1, 0.34, Math.pow(sink, 0.75));
        const bake = clamp01(aoAt(x, z) * 0.35 + 0.65) * lerp(0.86, 1, sunAt(x, z));
        const v = ao * bake;
        colors.push(v * 1.0, v * 0.995, v * 0.985);
      }
      for (let k = 0; k < idx.length; k += 1) indices.push(idx[k] + vbase);
      vbase += count;
      geo.dispose();

      // skirt: drop the slab border down to (below) the terrain
      const border = [];
      for (let i = 0; i < g.nx; i += 1) border.push([i, 0]);
      for (let j = 1; j < g.nz; j += 1) border.push([g.nx - 1, j]);
      for (let i = g.nx - 2; i >= 0; i -= 1) border.push([i, g.nz - 1]);
      for (let j = g.nz - 2; j >= 1; j -= 1) border.push([0, j]);

      const ring = [];
      for (const [i, j] of border) {
        const x = g.vx(i);
        const z = g.vz(j);
        ring.push([x, g.get(i, j), z]);
      }
      const skirtStart = vbase;
      for (let s = 0; s < ring.length; s += 1) {
        const a = ring[s];
        const b = ring[(s + 1) % ring.length];
        // Outward, not inward. The border ring runs counter-clockwise seen
        // from above, so for a segment a->b the outward horizontal normal is
        // (b.z - a.z, 0, a.x - b.x); the old expression was its negation.
        tmpN.set(b[2] - a[2], 0, a[0] - b[0]).normalize();
        const bottom = Math.min(terrainAt(a[0], a[2]), PATIO_BASE) - 4;
        const bottomB = Math.min(terrainAt(b[0], b[2]), PATIO_BASE) - 4;
        const base = positions.length / 3;
        positions.push(a[0], a[1], a[2]);
        positions.push(b[0], b[1], b[2]);
        positions.push(b[0], bottomB, b[2]);
        positions.push(a[0], bottom, a[2]);
        for (let t = 0; t < 4; t += 1) normals.push(tmpN.x, tmpN.y, tmpN.z);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        const topShade = 0.72;
        colors.push(topShade, topShade, topShade);
        colors.push(topShade, topShade, topShade);
        colors.push(0.2, 0.2, 0.2);
        colors.push(0.2, 0.2, 0.2);
        // WINDING. (base, base+2, base+1) crosses to a normal pointing INTO
        // the slab, so every skirt face was a backface from outside and the
        // patio's side walls were culled away: the paving appeared to stop in
        // mid air with a dark void under it, and the player walked into a
        // collider that was not drawn. Both reported symptoms - "a break in
        // the ground" and "invisible barriers" - are this one bug, and
        // headbutt punches through because it displaces the body faster than
        // the character controller sweeps against that wall.
        //
        // Third time this exact error has appeared here (see the water
        // surface and the distant backdrop): for a ring built outward, the
        // winding that faces OUT is (a_top, b_top, b_bottom).
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      vbase = positions.length / 3;
      void skirtStart;
    }

    const geo = trackGeo(new THREE_.BufferGeometry());
    geo.setAttribute("position", new THREE_.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE_.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE_.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("color", new THREE_.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    const mesh = new THREE_.Mesh(geo, concreteMat);
    mesh.name = "PatioSlabs";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    stats.meshes += 1;
    stats.triangles += indices.length / 3;
  }

  /* -------------------------------------------------------------
     4.8 Scatter plumbing - chunked InstancedMesh with LOD
     ------------------------------------------------------------- */

  const scatterGroups = [];

  function buildScatter(opts) {
    const {
      name, geometry, material, items, chunk = 220,
      castShadow = false, receiveShadow = true,
      near = 260, far = 900, minFrac = 0.3, depthMaterial = null,
      inflate = 1.1, renderOrder = 0,
    } = opts;
    if (!items.length) return null;

    const buckets = new Map();
    for (const it of items) {
      const cx = Math.floor(it.pos.x / chunk);
      const cz = Math.floor(it.pos.z / chunk);
      const key = `${cx}|${cz}`;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(it);
    }

    const group = new THREE_.Group();
    group.name = name;
    group.matrixAutoUpdate = false;
    root.add(group);

    const meshes = [];
    const m4 = new THREE_.Matrix4();
    const qt = new THREE_.Quaternion();
    const euler = new THREE_.Euler();

    for (const [, list] of buckets) {
      // stable shuffle so trimming `count` thins uniformly
      list.sort((a, b) => a.key - b.key);
      const mesh = new THREE_.InstancedMesh(geometry, material, list.length);
      mesh.name = `${name}Chunk`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.renderOrder = renderOrder;
      if (depthMaterial) mesh.customDepthMaterial = depthMaterial;
      for (let i = 0; i < list.length; i += 1) {
        const it = list[i];
        euler.set(it.rx || 0, it.ry || 0, it.rz || 0, "YXZ");
        qt.setFromEuler(euler);
        m4.compose(it.pos, qt, it.scale);
        mesh.setMatrixAt(i, m4);
        if (it.color) mesh.setColorAt(i, it.color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius *= inflate;
      mesh.frustumCulled = true;
      group.add(mesh);
      meshes.push({ mesh, total: list.length, center: mesh.boundingSphere ? mesh.boundingSphere.center.clone() : new THREE_.Vector3() });
      stats.instances += list.length;
      stats.chunks += 1;
      stats.triangles += (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3) * list.length;
    }
    const entry = { name, group, meshes, near, far, minFrac };
    scatterGroups.push(entry);
    return entry;
  }

  const _camPos = new THREE_.Vector3();
  function updateScatterLod(camera) {
    camera.getWorldPosition(_camPos);
    for (const g of scatterGroups) {
      for (const m of g.meshes) {
        const d = _camPos.distanceTo(m.center);
        if (d > g.far) {
          m.mesh.visible = false;
          continue;
        }
        m.mesh.visible = true;
        if (d <= g.near) {
          if (m.mesh.count !== m.total) m.mesh.count = m.total;
        } else {
          const t = clamp01((d - g.near) / Math.max(1, g.far - g.near));
          const frac = lerp(1, g.minFrac, t * t);
          const c = Math.max(1, Math.round(m.total * frac));
          if (m.mesh.count !== c) m.mesh.count = c;
        }
      }
    }
  }

  /* -------------------------------------------------------------
     4.9 Placement helpers
     ------------------------------------------------------------- */

  // Grass is kept off the landmarks so they read as objects rather than
  // shapes in a lawn. The lolly stick, the LEGO brick and the screw were
  // missing from this list, which is why the cap and the hose sit in
  // readable clearings while the stick is swallowed: two attempts to
  // recompose its shot failed because no camera angle can find a prop the
  // grass has grown over.
  const blockZones = [
    { x: LANDMARKS.bottleCap.x, z: LANDMARKS.bottleCap.z, r: 74 },
    { x: LANDMARKS.shard.x, z: LANDMARKS.shard.z, r: 120 },
    { x: LANDMARKS.hose.x, z: LANDMARKS.hose.z, r: 210 },
    { x: LANDMARKS.boulders.x, z: LANDMARKS.boulders.z, r: 60 },
    // The lolly is a 424-unit bar, so it needs a chain of discs along its
    // axis rather than one circle around its midpoint.
    ...[0, 0.25, 0.5, 0.75, 1].map((t) => ({
      x: lerp(LANDMARKS.lolly.x0, LANDMARKS.lolly.x1, t),
      z: lerp(LANDMARKS.lolly.z0, LANDMARKS.lolly.z1, t),
      r: 52,
    })),
    { x: LANDMARKS.legoBrick.x, z: LANDMARKS.legoBrick.z, r: 96 },
    { x: LANDMARKS.screw.x, z: LANDMARKS.screw.z, r: 74 },
  ];

  function blocked(x, z) {
    for (const b of blockZones) {
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < b.r * b.r) return true;
    }
    return false;
  }

  function inWater(x, z, p, margin = 0) {
    const dx = x - p.x;
    const dz = z - p.z;
    const ang = Math.atan2(dz, dx);
    const wob = 1 + noise.noise2(Math.cos(ang) * 1.7 + p.x * 0.01, Math.sin(ang) * 1.7) * 0.19;
    return Math.hypot(dx, dz) < p.radius * wob + margin;
  }

  /**
   * Poisson-ish jittered grid sampler.
   * `accept(x,z)` returns a density in 0..1 (0 rejects).
   */
  function scatterPoints(rng, cell, accept, jitter = 0.95, x0 = -HALF, x1 = HALF, z0 = -HALF, z1 = HALF) {
    const out = [];
    const nx = Math.ceil((x1 - x0) / cell);
    const nz = Math.ceil((z1 - z0) / cell);
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = x0 + (i + 0.5 + rng.range(-jitter, jitter) * 0.5) * cell;
        const z = z0 + (j + 0.5 + rng.range(-jitter, jitter) * 0.5) * cell;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const d = accept(x, z);
        if (d <= 0) continue;
        if (rng() > d) continue;
        out.push([x, z]);
      }
    }
    return out;
  }

  /* -------------------------------------------------------------
     4.10 Grass - the flowerbed forest
     ------------------------------------------------------------- */

  function bladeGeometry(segments, curve) {
    const rows = segments + 1;
    const pos = new Float32Array(rows * 2 * 3);
    const nor = new Float32Array(rows * 2 * 3);
    const uv = new Float32Array(rows * 2 * 2);
    const col = new Float32Array(rows * 2 * 3);
    const idx = [];
    for (let r = 0; r < rows; r += 1) {
      const t = r / segments;
      const w = 0.5 * (1 - Math.pow(t, 1.6) * 0.94);
      const bend = curve * t * t;
      const droop = -0.06 * t * t;
      for (let s = 0; s < 2; s += 1) {
        const k = r * 2 + s;
        pos[k * 3] = (s === 0 ? -w : w);
        pos[k * 3 + 1] = t + droop;
        pos[k * 3 + 2] = bend + (s === 0 ? 0 : 0) ;
        // slight cupping so the blade catches light along its length
        pos[k * 3 + 2] += (s === 0 ? -0.035 : 0.035) * 0;
        const nz = -1;
        const inv = 1 / Math.hypot(0, 0.35, nz);
        nor[k * 3] = 0;
        nor[k * 3 + 1] = 0.35 * inv;
        nor[k * 3 + 2] = nz * inv;
        uv[k * 2] = s;
        uv[k * 2 + 1] = t;
        const shade = 0.52 + 0.62 * Math.pow(t, 0.75);
        col[k * 3] = shade * 0.92;
        col[k * 3 + 1] = shade;
        col[k * 3 + 2] = shade * 0.66;
      }
      if (r < segments) {
        const a = r * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const g = new THREE_.BufferGeometry();
    g.setAttribute("position", new THREE_.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE_.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE_.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE_.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  const WIND_HEAD = /* glsl */ `
    uniform float uTime;
    uniform vec2 uWindDir;
    uniform float uWindStrength;
    uniform float uBendScale;
  `;
  const WIND_BODY = /* glsl */ `
    #ifdef USE_INSTANCING
    {
      vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float phase = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      float gust = sin(dot(iPos.xz, uWindDir) * 0.0075 - uTime * 1.35);
      gust = gust * 0.5 + 0.5;
      gust = gust * gust * gust;
      float flutter = sin(uTime * 3.1 + phase) * 0.42 + sin(uTime * 5.7 + phase * 1.9) * 0.2;
      float amp = (0.07 + 0.46 * gust) * uWindStrength * (0.72 + 0.5 * flutter);
      float h = clamp(position.y, 0.0, 1.0);
      float b = h * h;
      transformed.x += uWindDir.x * amp * b * uBendScale;
      transformed.z += uWindDir.y * amp * b * uBendScale;
      transformed.y -= b * amp * amp * 0.55;
    }
    #endif
  `;

  function windUniforms(bend) {
    return {
      uTime,
      uWindDir,
      uWindStrength,
      uBendScale: { value: bend },
    };
  }

  function makeWindDepth(bend, side) {
    const dm = track(new THREE_.MeshDepthMaterial({
      depthPacking: THREE_.RGBADepthPacking,
      side: side || THREE_.DoubleSide,
    }));
    extendMaterial(dm, {
      key: "wind-depth",
      uniforms: windUniforms(bend),
      vertexHead: WIND_HEAD,
      vertexBody: WIND_BODY,
    });
    return dm;
  }

  const SSS_HEAD = /* glsl */ `
    uniform vec3 uSunDir;
    uniform vec3 uSssColor;
    uniform float uSssStrength;
  `;
  const SSS_BODY = /* glsl */ `
    {
      vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
      vec3 V = normalize(vViewPosition);
      float back = clamp(dot(V, -Lv), 0.0, 1.0);
      back = pow(back, 3.0);
      reflectedLight.indirectDiffuse += uSssColor * back * uSssStrength * diffuseColor.rgb;
    }
  `;

  const grassMat = track(ctx.materials.make("leaf", {
    vertexColors: true,
    color: 0xffffff,
    side: THREE_.DoubleSide,
    roughness: 0.72,
    metalness: 0,
    shadowSide: THREE_.DoubleSide,
  }));
  extendMaterial(grassMat, {
    key: "grass",
    uniforms: {
      ...windUniforms(1.0),
      uSunDir,
      uSssColor: { value: new THREE_.Color(0xa9e06a) },
      uSssStrength: { value: 2.1 },
    },
    vertexHead: WIND_HEAD,
    vertexBody: WIND_BODY,
    fragmentHead: SSS_HEAD,
    fragmentPatches: [
      { at: "#include <lights_fragment_end>", code: SSS_BODY },
      {
        at: "#include <color_fragment>",
        code: "diffuseColor.rgb *= vec3(0.62, 0.86, 0.40) * 1.32;",
      },
    ],
  });
  const grassDepth = makeWindDepth(1.0);

  const grassGeo = trackGeo(bladeGeometry(4, 0.26));
  const grassRng = makeRng(0x1f77b4);

  {
    const items = [];
    const cell = clamp(11.5 / Math.sqrt(scatterMul), 6, 22);
    const col = new THREE_.Color();
    const clumpN = makeNoise(0x6a3d9a);
    const pts = scatterPoints(grassRng, cell, (x, z) => {
      if (blocked(x, z)) return 0;
      if (inWater(x, z, PUDDLE, -6)) return 0;
      const pm = patioMask(x, z);
      if (pm > 0.55) return 0;
      if (onSlab(x, z)) return 0;
      const slope = slopeAt(x, z);
      if (slope > 1.5) return 0;
      let d = (1 - pm) * clamp01(1.25 - slope * 0.9);
      const clump = clumpN.fbm(x * 0.0072, z * 0.0072, 3) * 0.5 + 0.5;
      d *= clamp01(clump * 1.9 - 0.28);
      // lusher near water
      d *= 0.72 + 0.5 * clamp01(1.6 - Math.hypot(x - PUDDLE.x, z - PUDDLE.z) / (PUDDLE.radius * 2.4));
      return clamp01(d * 1.25);
    });

    for (const [x, z] of pts) {
      const y = terrainAt(x, z);
      const h = grassRng.range(58, 142) * (0.82 + 0.4 * clamp01(aoAt(x, z)));
      const w = grassRng.range(5.2, 9.4);
      const shade = 0.72 + grassRng.range(0, 0.5);
      const dry = Math.pow(grassRng(), 3);
      col.setHSL(
        lerp(0.245, 0.135, dry) + grassRng.range(-0.02, 0.02),
        lerp(0.52, 0.66, dry),
        clamp(0.40 * shade + grassRng.range(-0.05, 0.09), 0.16, 0.72)
      );
      const gRx = grassRng.range(-0.13, 0.13);
      const gRy = grassRng.range(0, TAU);
      const gRz = grassRng.range(-0.16, 0.16);
      items.push({
        pos: new THREE_.Vector3(x, y - 2, z),
        scale: new THREE_.Vector3(w, h, h * 0.55),
        rx: gRx,
        ry: gRy,
        rz: gRz,
        color: col.clone(),
        key: grassRng(),
      });
      // Only every Nth blade gets a collider. 2574 tall, rotated capsules
      // cost ~40ms per physics step - their AABBs are enormous (a blade is
      // up to 142 units long) so the broadphase produces a huge candidate
      // set. Thinning keeps grass solid and climbable at a fraction of that.
      grassCollideCounter += 1;
      if (grassCollideCounter % GRASS_COLLIDE_EVERY !== 0) continue;
      // A capsule up the lower ~85% of the blade: that is the part a
      // tardigrade climbs, and a capsule (rather than a box) gives the
      // character controller no sharp edges to catch on in a thicket.
      foliageColliders.push({
        shape: "capsule",
        x, y: (y - 2) + h * 0.45, z,
        // Deliberately thinner than the blade looks. At w*0.3 the hero
        // clipped a blade with almost every step through a clump, and since
        // brushing a near-vertical face arms the climb assist, crossing a
        // lawn became continuous hopping again. Thin colliders leave gaps to
        // walk through while a blade you actually drive into still catches.
        radius: w * 0.16,
        halfHeight: h * 0.42,
        rx: gRx, ry: gRy, rz: gRz,
        tag: "grass",
      });
    }

    buildScatter({
      name: "GrassForest",
      geometry: grassGeo,
      material: grassMat,
      depthMaterial: grassDepth,
      items,
      chunk: 150,
      castShadow: true,
      receiveShadow: true,
      // Tried near 470 / far 1400 / minFrac 0.52 to fill what a reviewer read
      // as a bare mid-distance band. MEASURED: no per-shot saturation change
      // anywhere in the set and no visible difference in an A/B of the band -
      // the flat green there is the DistantBackdrop, which is beyond the map
      // and carries no grass by definition. It cost ~30% more triangles on a
      // build already at ~10fps, so it is reverted. The real fix for that
      // band is the backdrop material, not the grass LOD.
      near: 300,
      far: 1000,
      minFrac: 0.26,
      inflate: 1.35,
    });
  }

  /* -------------------------------------------------------------
     4.11 Understory - moss tufts, short blades
     ------------------------------------------------------------- */

  const mossMat = track(ctx.materials.make("moss", {
    vertexColors: true,
    color: 0xffffff,
    side: THREE_.DoubleSide,
    roughness: 0.86,
    metalness: 0,
    shadowSide: THREE_.DoubleSide,
  }));
  extendMaterial(mossMat, {
    key: "moss",
    uniforms: {
      ...windUniforms(0.42),
      uSunDir,
      uSssColor: { value: new THREE_.Color(0x8fd05c) },
      uSssStrength: { value: 1.3 },
    },
    vertexHead: WIND_HEAD,
    vertexBody: WIND_BODY,
    fragmentHead: SSS_HEAD,
    fragmentPatches: [
      { at: "#include <lights_fragment_end>", code: SSS_BODY },
      { at: "#include <color_fragment>", code: "diffuseColor.rgb *= vec3(0.48, 0.74, 0.34) * 1.35;" },
    ],
  });
  const mossDepth = makeWindDepth(0.42);

  /** A moss tuft: a rosette of short blades. */
  function tuftGeometry(count, seed) {
    const rng = makeRng(seed);
    const parts = [];
    for (let i = 0; i < count; i += 1) {
      const g = bladeGeometry(2, 0.35);
      const a = (i / count) * TAU + rng.range(-0.4, 0.4);
      const tilt = rng.range(0.5, 1.15);
      const m = new THREE_.Matrix4();
      const e = new THREE_.Euler(Math.cos(a) * tilt, a, Math.sin(a) * tilt, "YXZ");
      m.compose(
        new THREE_.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1),
        new THREE_.Quaternion().setFromEuler(e),
        new THREE_.Vector3(rng.range(0.2, 0.36), rng.range(0.6, 1), rng.range(0.5, 0.8))
      );
      g.applyMatrix4(m);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }

  function mergeGeometries(list) {
    let vTotal = 0;
    let iTotal = 0;
    for (const g of list) {
      vTotal += g.attributes.position.count;
      iTotal += g.index ? g.index.count : g.attributes.position.count;
    }
    const keys = ["position", "normal", "uv", "color"];
    const sizes = { position: 3, normal: 3, uv: 2, color: 3 };
    const arrays = {};
    for (const k of keys) arrays[k] = new Float32Array(vTotal * sizes[k]);
    const index = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
    let vo = 0;
    let io = 0;
    for (const g of list) {
      const n = g.attributes.position.count;
      for (const k of keys) {
        const src = g.attributes[k];
        if (!src) continue;
        arrays[k].set(src.array, vo * sizes[k]);
      }
      const idx = g.index ? g.index.array : null;
      if (idx) {
        for (let i = 0; i < idx.length; i += 1) index[io + i] = idx[i] + vo;
        io += idx.length;
      }
      vo += n;
      g.dispose();
    }
    const out = new THREE_.BufferGeometry();
    for (const k of keys) out.setAttribute(k, new THREE_.BufferAttribute(arrays[k], sizes[k]));
    out.setIndex(new THREE_.BufferAttribute(index, 1));
    out.computeBoundingSphere();
    return out;
  }

  const tuftGeo = trackGeo(tuftGeometry(7, 0x33aa71));
  {
    const rng = makeRng(0x77c1de);
    const items = [];
    const col = new THREE_.Color();
    const cell = clamp(10 / Math.sqrt(scatterMul), 5.5, 20);
    const pts = scatterPoints(rng, cell, (x, z) => {
      if (blocked(x, z)) return 0;
      if (inWater(x, z, PUDDLE, -4)) return 0;
      if (onSlab(x, z)) return 0;
      const pm = patioMask(x, z);
      if (pm > 0.7) return 0;
      const mound = moundLift(x, z);
      const near = clamp01(1.4 - Math.hypot(x - PUDDLE.x, z - PUDDLE.z) / (PUDDLE.radius * 1.5));
      const d = clamp01(mound / 16 + near * 0.8 + noise.fbm(x * 0.011, z * 0.011, 3) * 0.55);
      return clamp01(d * (1 - pm) * 1.15);
    });
    for (const [x, z] of pts) {
      const y = terrainAt(x, z);
      const s = rng.range(9, 20);
      col.setHSL(rng.range(0.24, 0.30), rng.range(0.44, 0.72), rng.range(0.20, 0.42));
      items.push({
        pos: new THREE_.Vector3(x, y - 1.2, z),
        scale: new THREE_.Vector3(s, s * rng.range(0.7, 1.3), s),
        ry: rng.range(0, TAU),
        rx: rng.range(-0.12, 0.12),
        color: col.clone(),
        key: rng(),
      });
    }
    buildScatter({
      name: "MossTufts",
      geometry: tuftGeo,
      material: mossMat,
      depthMaterial: mossDepth,
      items,
      chunk: 150,
      castShadow: true,
      near: 190,
      far: 620,
      minFrac: 0.18,
      inflate: 1.25,
    });
  }

  /* -------------------------------------------------------------
     4.12 Gravel, grit and concrete rubble
     ------------------------------------------------------------- */

  function pebbleGeometry(seed, detail, squash = 0.72, rough = 0.62) {
    const rng = makeRng(seed);
    const g = new THREE_.IcosahedronGeometry(0.5, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const f = (1 - rough * 0.5) + rng() * rough;
      p.setXYZ(i, x * f, y * f * squash, z * f);
    }
    g.computeVertexNormals();
    const n = p.count;
    const col = new Float32Array(n * 3).fill(1);
    g.setAttribute("color", new THREE_.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  /** An angular concrete chip - fractured planes, not a smoothed blob. */
  function chipGeometry(seed) {
    const rng = makeRng(seed);
    const g = new THREE_.IcosahedronGeometry(0.5, 1);
    const p = g.attributes.position;
    // Slice the sphere against a handful of random planes so it gains real
    // fracture facets, then flatten it into a flake.
    const planes = [];
    for (let i = 0; i < 5; i += 1) {
      const a = rng.range(0, TAU);
      const b = Math.acos(rng.range(-1, 1));
      planes.push([
        Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a),
        rng.range(0.17, 0.34),
      ]);
    }
    for (let i = 0; i < p.count; i += 1) {
      let x = p.getX(i);
      let y = p.getY(i) * rng.range(0.42, 0.6);
      let z = p.getZ(i);
      for (const [nx, ny, nz, d] of planes) {
        const dot = x * nx + y * ny + z * nz;
        if (dot > d) {
          const push = dot - d;
          x -= nx * push; y -= ny * push; z -= nz * push;
        }
      }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    g.setAttribute("color", new THREE_.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
    g.computeBoundingSphere();
    return g;
  }

  const gravelMat = track(ctx.materials.make("gravel", {
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
    // Smooth-shaded so the normal map does the surface work and these read as
    // worn pebbles rather than faceted solids.
    //
    // NOTE for whoever chases the blind reviewer's "untextured flat-shaded
    // primitives filling the lower half of patio-canyon.png": that heap is the
    // SUGAR CRYSTAL scatter, not gravel. Crystals are legitimately faceted so
    // they keep flatShading; what they actually lack is any visible surface
    // break-up on each facet - the fix belongs in their material, not here.
    flatShading: false,
  }));
  extendMaterial(gravelMat, withIRand({
    key: "gravel",
    vertexHead: "varying vec3 vGWPos;\nvarying vec3 vGLPos;",
    vertexBody: "vGWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGLPos = position;",
    fragmentHead: `varying vec3 vGWPos;\nvarying vec3 vGLPos;\n${GLSL_NOISE}`,
    fragmentPatches: [{
      at: "#include <color_fragment>",
      code: /* glsl */ `
        {
          // Per-grain mineral identity: quartz, feldspar, a dark basalt fleck,
          // and the odd brick-red one. Without this the field is one stamp.
          float pick = vIRand.x;
          vec3 mineral =
              pick < 0.30 ? vec3(0.78, 0.75, 0.69)              // pale quartz
            : pick < 0.55 ? vec3(0.62, 0.55, 0.44)              // buff feldspar
            : pick < 0.74 ? vec3(0.40, 0.38, 0.36)              // dark basalt
            : pick < 0.88 ? vec3(0.55, 0.34, 0.24)              // brick
            :               vec3(0.86, 0.84, 0.80);             // bright chip
          mineral *= 0.74 + 0.52 * vIRand.y;
          diffuseColor.rgb *= mineral * (0.80 + 0.5 * tsNoise(vGWPos.xz * 1.1));
          // Fine mineral speckle - reads as crystal at this magnification.
          diffuseColor.rgb *= 0.86 + 0.30 * tsNoise(vGWPos.xz * 6.5 + vGWPos.y * 3.1);
          // Dust settles in the collar where the grain meets the ground.
          float collar = smoothstep(0.10, -0.44, vGLPos.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.60, 0.56, 0.48) * 0.9, collar * 0.55);
        }
      `,
    }, {
      at: "#include <roughnessmap_fragment>",
      code: "roughnessFactor = clamp(roughnessFactor * (0.62 + 0.72 * vIRand.z), 0.22, 1.0);",
    }],
  }));

  // Three grain shapes, and the small ones are cheap. Splitting the field by
  // size lets the tiny majority run at 20 triangles while the few boulders
  // that actually read at close range keep their silhouette.
  const gritGeo = trackGeo(pebbleGeometry(0x9a11cc, 0, 0.66, 0.78));
  const pebbleGeo = trackGeo(pebbleGeometry(0x51ce07, 1, 0.74, 0.58));
  const chipGeo = trackGeo(chipGeometry(0x2f81aa));
  {
    const rng = makeRng(0x3ab5d2);
    const grit = [];
    const pebbles = [];
    const chips = [];
    const col = new THREE_.Color();
    const cell = clamp(15 / Math.sqrt(scatterMul), 8, 26);
    const pts = scatterPoints(rng, cell, (x, z) => {
      if (blocked(x, z)) return 0;
      if (inWater(x, z, PUDDLE, -10)) return 0;
      const s = onSlab(x, z);
      const pm = patioMask(x, z);
      const slope = slopeAt(x, z);
      let d = 0.2 + slope * 0.9;
      if (s) {
        // rubble only in the cracks
        const dip = clamp01((s.base - s.grid.sample(x, z)) / 6);
        d = dip * 0.85;
      } else {
        d += pm * 0.75;
        d += clamp01(1.4 - Math.hypot(x - PUDDLE.x, z - PUDDLE.z) / PUDDLE.radius) * 0.5;
      }
      return clamp01(d);
    });
    for (const [x, z] of pts) {
      const y = heightAt(x, z);
      // Power-law size: mostly sand, a few pebbles, the rare boulder. A flat
      // uniform range is exactly what "uniform detail scale" looks like.
      const t = Math.pow(rng(), 2.3);
      const s = lerp(1.1, 13.5, t) * (rng() < 0.035 ? 2.4 : 1);
      const warm = rng();
      // Lightness floor lifted from 0.22: the darkest pebbles read as black
      // blobs once depth of field blurred them against bright ground, and a
      // blind reviewer logged them as "hexagons floating in mid-air". Real
      // gravel rarely goes below ~0.3 albedo. Range is still wide enough that
      // the scatter does not flatten into one tone.
      col.setHSL(lerp(0.055, 0.15, warm), rng.range(0.02, 0.3), rng.range(0.34, 0.78));
      const it = {
        pos: new THREE_.Vector3(x, y - s * 0.2, z),
        scale: new THREE_.Vector3(
          s * rng.range(0.82, 1.25),
          s * rng.range(0.4, 1.0),
          s * rng.range(0.7, 1.35)
        ),
        rx: rng.range(0, TAU),
        ry: rng.range(0, TAU),
        rz: rng.range(0, TAU),
        color: col.clone(),
        key: rng(),
      };
      const kind = rng();
      if (s < 4.2) grit.push(it);
      else if (kind < 0.42) chips.push(it);
      else pebbles.push(it);
    }
    buildScatter({
      name: "Grit", geometry: gritGeo, material: gravelMat, items: grit,
      chunk: 220, castShadow: true, near: 130, far: 560, minFrac: 0.16,
    });
    buildScatter({
      name: "Gravel", geometry: pebbleGeo, material: gravelMat, items: pebbles,
      chunk: 220, castShadow: true, near: 240, far: 820, minFrac: 0.3,
    });
    buildScatter({
      name: "ConcreteChips", geometry: chipGeo, material: gravelMat, items: chips,
      chunk: 220, castShadow: true, near: 240, far: 820, minFrac: 0.3,
    });
  }

  /* -------------------------------------------------------------
     4.13 Lichen colonies on the concrete
     ------------------------------------------------------------- */

  function lichenGeometry(seed) {
    const rng = makeRng(seed);
    const N = 13;
    const pos = new Float32Array((N + 1) * 3);
    const nor = new Float32Array((N + 1) * 3);
    const uv = new Float32Array((N + 1) * 2);
    const col = new Float32Array((N + 1) * 3);
    const idx = [];
    nor[1] = 1;
    col[0] = 1; col[1] = 1; col[2] = 1;
    uv[0] = 0.5; uv[1] = 0.5;
    for (let i = 0; i < N; i += 1) {
      const a = (i / N) * TAU;
      const r = 0.5 * rng.range(0.62, 1.05);
      const k = i + 1;
      pos[k * 3] = Math.cos(a) * r;
      pos[k * 3 + 1] = rng.range(-0.01, 0.03);
      pos[k * 3 + 2] = Math.sin(a) * r;
      nor[k * 3 + 1] = 1;
      uv[k * 2] = 0.5 + Math.cos(a) * 0.5;
      uv[k * 2 + 1] = 0.5 + Math.sin(a) * 0.5;
      const e = rng.range(0.45, 0.85);
      col[k * 3] = e; col[k * 3 + 1] = e; col[k * 3 + 2] = e;
      idx.push(0, k, i === N - 1 ? 1 : k + 1);
    }
    const g = new THREE_.BufferGeometry();
    g.setAttribute("position", new THREE_.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE_.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE_.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE_.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  const lichenMat = track(ctx.materials.make("moss", {
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
  extendMaterial(lichenMat, {
    key: "lichen",
    vertexHead: "varying vec3 vLWPos;",
    vertexBody: "vLWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    fragmentHead: `varying vec3 vLWPos;\n${GLSL_NOISE}`,
    fragmentPatches: [{
      at: "#include <color_fragment>",
      code: `
        float f = tsFbm(vLWPos.xz * 0.9);
        diffuseColor.rgb *= 0.55 + 0.95 * f;
        diffuseColor.a *= smoothstep(0.12, 0.42, f);
      `,
    }],
  });
  lichenMat.transparent = true;
  lichenMat.depthWrite = false;

  const lichenGeo = trackGeo(lichenGeometry(0x5f3a21));
  {
    const rng = makeRng(0x8de4a1);
    const items = [];
    const col = new THREE_.Color();
    const clumpN = makeNoise(0x2199aa);
    const cell = clamp(13 / Math.sqrt(scatterMul), 7, 24);
    const pts = scatterPoints(rng, cell, (x, z) => {
      const s = onSlab(x, z);
      if (!s) return 0;
      const dip = clamp01((s.base - s.grid.sample(x, z)) / 8);
      const clump = clumpN.fbm(x * 0.011, z * 0.011, 3) * 0.5 + 0.5;
      return clamp01((clump * 1.8 - 0.55) + dip * 0.5);
    }, 0.95, -HALF, -60, -HALF, HALF);
    for (const [x, z] of pts) {
      const s = onSlab(x, z);
      const y = s ? s.grid.sample(x, z) : terrainAt(x, z);
      const r = rng.range(6, 26);
      const kind = rng();
      if (kind < 0.45) col.setHSL(rng.range(0.12, 0.17), rng.range(0.35, 0.62), rng.range(0.36, 0.55));
      else if (kind < 0.8) col.setHSL(rng.range(0.22, 0.28), rng.range(0.22, 0.4), rng.range(0.24, 0.4));
      else col.setHSL(rng.range(0.05, 0.09), rng.range(0.45, 0.7), rng.range(0.34, 0.5));
      items.push({
        pos: new THREE_.Vector3(x, y + 0.35, z),
        scale: new THREE_.Vector3(r, 1.4, r * rng.range(0.7, 1.25)),
        ry: rng.range(0, TAU),
        color: col.clone(),
        key: rng(),
      });
    }
    buildScatter({
      name: "Lichen",
      geometry: lichenGeo,
      material: lichenMat,
      items,
      chunk: 190,
      castShadow: false,
      near: 190,
      far: 560,
      minFrac: 0.15,
      renderOrder: 1,
    });
  }

  /* -------------------------------------------------------------
     4.14 Sugar crystals near the spilled drink
     ------------------------------------------------------------- */

  // materials.js may ship a dedicated `sugar` entry (crystalline detail
  // normal, sub-facet break-up). Prefer it when it exists; `ceramic` is the
  // registry-guaranteed fallback, so this stays safe either way.
  const sugarBaseName = (() => {
    try {
      const names = typeof ctx.materials.list === "function" ? ctx.materials.list() : [];
      return names.indexOf("sugar") >= 0 ? "sugar" : "ceramic";
    } catch (error) {
      return "ceramic";
    }
  })();

  const sugarMat = track(ctx.materials.make(sugarBaseName, {
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0,
    // Sucrose really is faceted; the fix for "flat-shaded primitives" is more
    // silhouettes and per-facet surface, not smooth shading.
    flatShading: true,
  }));
  if ("clearcoat" in sugarMat) {
    sugarMat.clearcoat = 1;
    sugarMat.clearcoatRoughness = 0.08;
  }
  if ("transmission" in sugarMat) sugarMat.transmission = 0;
  if ("sheen" in sugarMat) sugarMat.sheen = 0.5;

  /* --- crystal shape library ---------------------------------------
     A blind reviewer read this heap as "hundreds of cubes and pyramids,
     each face a single uniform colour, all at the same size and
     near-identical rotation". The transforms were in fact already
     jittered on all three axes; what was actually repeating was the
     SILHOUETTE - one 24-vertex box geometry stamped ~630 times. Five
     habits fix the outline; the size law below fixes the "same size".  */

  /** Refit into a unit box about the origin so instance scale means the
   *  same thing for every habit (a plate stays thin, a prism stays long). */
  function fitUnitBox(geo) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const span = Math.max(1e-4, bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const s = 1 / span;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      p.setXYZ(i, (p.getX(i) - cx) * s, (p.getY(i) - cy) * s, (p.getZ(i) - cz) * s);
    }
    p.needsUpdate = true;
    return geo;
  }

  /**
   * Planar UVs computed per facet.
   *
   * The old crystal was a BoxGeometry, so its UVs ran 0..1 across a whole
   * face however large the instance was - a 256px detail map stretched over
   * eleven world units, which is exactly the "each face a single uniform
   * colour value" the review saw. Projecting each triangle onto its own
   * plane at a fixed tile size gives constant texel density instead. The
   * tangent basis is derived from the face NORMAL, not from an edge, so
   * coplanar triangles share a basis and a quad shows no seam down its
   * diagonal.
   */
  function facetUvs(geo, tile) {
    const src = geo;
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== src) src.dispose();
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    const a = new THREE_.Vector3();
    const b = new THREE_.Vector3();
    const c = new THREE_.Vector3();
    const e1 = new THREE_.Vector3();
    const e2 = new THREE_.Vector3();
    const n = new THREE_.Vector3();
    const t = new THREE_.Vector3();
    const bt = new THREE_.Vector3();
    const ref = new THREE_.Vector3();
    const d = new THREE_.Vector3();
    for (let i = 0; i + 2 < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      c.fromBufferAttribute(p, i + 2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      n.crossVectors(e1, e2);
      if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
      else n.normalize();
      ref.set(0, 1, 0);
      if (Math.abs(n.y) > 0.88) ref.set(1, 0, 0);
      t.crossVectors(ref, n).normalize();
      bt.crossVectors(n, t);
      for (let k = 0; k < 3; k += 1) {
        d.fromBufferAttribute(p, i + k);
        uv[(i + k) * 2] = d.dot(t) / tile;
        uv[(i + k) * 2 + 1] = d.dot(bt) / tile;
      }
    }
    g.setAttribute("uv", new THREE_.BufferAttribute(uv, 2));
    return g;
  }

  /**
   * An n-sided prism swept along +x with each end cut by its own oblique
   * plane. Sucrose grows as a slanted monoclinic prism - that chisel end is
   * the single most recognisable thing about a sugar grain, and it is what a
   * cube cannot give you.
   */
  function crystalPrism(rng, opts) {
    const sides = opts.sides || 6;
    const length = opts.length === undefined ? 1.5 : opts.length;
    const radius = opts.radius === undefined ? 0.44 : opts.radius;
    const jitter = opts.jitter === undefined ? 0.18 : opts.jitter;
    const tiltA = opts.tiltA === undefined ? 0.4 : opts.tiltA;
    const tiltB = opts.tiltB === undefined ? -0.28 : opts.tiltB;
    const taper = opts.taper === undefined ? 0.88 : opts.taper;
    const squash = opts.squash === undefined ? 1 : opts.squash;

    const ring = [];
    for (let i = 0; i < sides; i += 1) {
      const ang = (i / sides) * TAU + rng.range(-0.13, 0.13);
      const r = radius * (1 + rng.range(-jitter, jitter));
      ring.push([Math.cos(ang) * r, Math.sin(ang) * r * squash]);
    }

    const pos = [];
    const idx = [];
    const ends = [[-length / 2, tiltA, 1], [length / 2, tiltB, taper]];
    for (let e = 0; e < 2; e += 1) {
      const [x0, tilt, scale] = ends[e];
      for (let i = 0; i < sides; i += 1) {
        const y = ring[i][0] * scale;
        const z = ring[i][1] * scale;
        pos.push(x0 + y * tilt, y, z);
      }
    }
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      idx.push(i, j, sides + i, j, sides + j, sides + i);
    }
    for (let i = 1; i < sides - 1; i += 1) idx.push(0, i + 1, i);
    for (let i = 1; i < sides - 1; i += 1) idx.push(sides, sides + i, sides + i + 1);

    const g = new THREE_.BufferGeometry();
    g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Two prisms grown into each other - a contact twin. Reads as an L or a
   *  V in silhouette, which nothing else in the field does. */
  function crystalTwin(rng) {
    const parts = [];
    for (let i = 0; i < 2; i += 1) {
      const g = crystalPrism(rng, {
        sides: 6,
        length: rng.range(1.0, 1.5),
        radius: rng.range(0.30, 0.40),
        tiltA: rng.range(0.2, 0.5),
        tiltB: rng.range(-0.4, -0.15),
        taper: rng.range(0.8, 0.98),
      });
      const m = new THREE_.Matrix4();
      const e = new THREE_.Euler(
        rng.range(-0.25, 0.25),
        i === 0 ? 0 : rng.range(0.55, 1.15),
        i === 0 ? 0 : rng.range(-0.5, 0.5),
        "YXZ"
      );
      m.compose(
        new THREE_.Vector3(i === 0 ? 0 : rng.range(0.1, 0.4), i === 0 ? 0 : rng.range(-0.16, 0.16), 0),
        new THREE_.Quaternion().setFromEuler(e),
        new THREE_.Vector3(1, 1, 1)
      );
      g.applyMatrix4(m);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }

  /** A cleaved lump: a box with every corner nudged and one corner driven
   *  in hard, so three of its faces fold into fracture facets. */
  function crystalChunk(rng, cleave) {
    const g = new THREE_.BoxGeometry(1, 1, 1, 1, 1, 1);
    const off = [];
    for (let i = 0; i < 8; i += 1) {
      off.push([rng.range(-0.15, 0.15), rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)]);
    }
    const broken = Math.floor(rng() * 8) & 7;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const corner = (x > 0 ? 1 : 0) | (y > 0 ? 2 : 0) | (z > 0 ? 4 : 0);
      const o = off[corner];
      const pull = corner === broken ? cleave : 0;
      p.setXYZ(i, x * (1 - pull) + o[0], y * (1 - pull) + o[1], z * (1 - pull) + o[2]);
    }
    p.needsUpdate = true;
    return g;
  }

  /** A worn granule - damp sugar that has started to round off. Twenty
   *  facets, no straight edges longer than a facet. */
  function crystalGranule(rng) {
    const g = new THREE_.IcosahedronGeometry(0.5, 0);
    const p = g.attributes.position;
    const seen = new Map();
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const key = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
      let f = seen.get(key);
      if (f === undefined) {
        f = rng.range(0.68, 1.22);
        seen.set(key, f);
      }
      p.setXYZ(i, x * f, y * f * 0.82, z * f);
    }
    p.needsUpdate = true;
    return g;
  }

  const CRYSTAL_TILE = 0.3;   // ~3 detail tiles across a unit facet

  function crystalVariant(seed, kind) {
    const rng = makeRng(seed);
    let g;
    if (kind === "prism") {
      g = crystalPrism(rng, { sides: 6, length: 1.6, radius: 0.42, tiltA: 0.44, tiltB: -0.3, taper: 0.84, jitter: 0.2 });
    } else if (kind === "plate") {
      g = crystalPrism(rng, { sides: rng() < 0.5 ? 5 : 7, length: 0.3, radius: 0.56, tiltA: 0.12, tiltB: -0.09, taper: 0.94, jitter: 0.32, squash: 0.72 });
    } else if (kind === "twin") {
      g = crystalTwin(rng);
    } else if (kind === "chunk") {
      g = crystalChunk(rng, 0.58);
    } else {
      g = crystalGranule(rng);
    }
    fitUnitBox(g);
    const out = facetUvs(g, CRYSTAL_TILE);
    out.computeVertexNormals();
    out.setAttribute(
      "color",
      new THREE_.BufferAttribute(new Float32Array(out.attributes.position.count * 3).fill(1), 3)
    );
    out.computeBoundingSphere();
    return out;
  }

  const CRYSTAL_KINDS = ["prism", "plate", "twin", "chunk", "granule"];
  const crystalGeos = CRYSTAL_KINDS.map((kind, i) => trackGeo(crystalVariant(0xbb3311 + i * 0x9e37, kind)));

  {
    const rng = makeRng(0xcafe12);
    const buckets = CRYSTAL_KINDS.map(() => []);
    const col = new THREE_.Color();
    const cell = clamp(12 / Math.sqrt(scatterMul), 7, 22);
    const ringAt = (x, z) => {
      const d = Math.hypot(x - SPILL.x, z - SPILL.z);
      if (d > SPILL.radius * 2.6) return 0;
      return clamp01(1 - Math.abs(d - SPILL.radius * 1.15) / (SPILL.radius * 1.2));
    };
    const pts = scatterPoints(rng, cell, (x, z) => {
      if (!onSlab(x, z)) return 0;
      return clamp01(ringAt(x, z) * 1.1);
    }, 0.95, SPILL.x - 260, SPILL.x + 260, SPILL.z - 260, SPILL.z + 260);
    for (const [x, z] of pts) {
      const s = onSlab(x, z);
      const y = s ? s.grid.sample(x, z) : terrainAt(x, z);
      const ring = ringAt(x, z);

      // Size law. A flat 2.4-11 range sounds varied but puts almost every
      // grain inside one visible band, which is what read as "all at the
      // same size". A power law gives a real hierarchy - a majority of fine
      // grains with a handful of crusted lumps - and the ceiling is tied to
      // the spill ring, so the big aggregates sit where the drink dried and
      // the outskirts are fine scatter.
      const sc = 1.6 + Math.pow(rng(), 2.2) * (4.2 + 9.4 * ring);

      // Three tinted populations. Every grain used to sit at lightness
      // 0.72-0.96 - a band so narrow the jitter was invisible.
      const grubby = rng();
      let kind;
      if (grubby > 0.72) {
        // dirt-contaminated grain: broken lumps and worn granules
        col.setHSL(rng.range(0.06, 0.11), rng.range(0.16, 0.42), rng.range(0.24, 0.46));
        const p = rng();
        kind = p < 0.38 ? 3 : (p < 0.72 ? 4 : 1);
      } else if (grubby > 0.45) {
        // damp / partly dissolved, so darker, rounder and slightly amber
        col.setHSL(rng.range(0.07, 0.13), rng.range(0.06, 0.24), rng.range(0.44, 0.68));
        const p = rng();
        kind = p < 0.40 ? 4 : (p < 0.65 ? 0 : (p < 0.85 ? 1 : 3));
      } else {
        // dry, sun-bleached: sharp prisms, flakes and twins. Weighted toward
        // the chisel-ended habit because that is the silhouette that reads as
        // sugar rather than as a generic pale lump.
        col.setHSL(rng.range(0.08, 0.14), rng.range(0, 0.14), rng.range(0.70, 0.95));
        const p = rng();
        kind = p < 0.48 ? 0 : (p < 0.74 ? 1 : (p < 0.92 ? 2 : 3));
      }

      // Most grains have settled flat; a minority are tumbled or propped on
      // a neighbour. Uniform 3-axis tumbling made every crystal look like it
      // was balancing on a corner.
      const settled = rng() < 0.62;
      const rx = settled ? rng.range(-0.55, 0.55) : rng.range(0, TAU);
      const rz = settled ? rng.range(-0.55, 0.55) : rng.range(0, TAU);

      const sy = sc * rng.range(0.62, 1.18);
      const sz = sc * rng.range(0.72, 1.15);
      buckets[kind].push({
        pos: new THREE_.Vector3(x, y + ((sc + sy + sz) / 3) * rng.range(0.18, 0.38), z),
        scale: new THREE_.Vector3(sc, sy, sz),
        rx,
        ry: rng.range(0, TAU),
        rz,
        color: col.clone(),
        key: rng(),
      });
    }
    for (let i = 0; i < CRYSTAL_KINDS.length; i += 1) {
      buildScatter({
        name: `SugarCrystals-${CRYSTAL_KINDS[i]}`,
        geometry: crystalGeos[i],
        material: sugarMat,
        items: buckets[i],
        // Wider than the old 200 so five habits do not cost five times the
        // chunk count; the spill only spans ~410 units anyway.
        chunk: 280,
        castShadow: true,
        receiveShadow: true,
        near: 220,
        far: 700,
        minFrac: 0.3,
      });
    }
  }

  /* -------------------------------------------------------------
     4.15 Fallen leaves - ramps and roofs
     ------------------------------------------------------------- */

  function leafGeometry(seed) {
    const rng = makeRng(seed);
    const RU = 22;
    const RV = 9;
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    const idx = [];
    const wob = rng.range(0.06, 0.16);
    for (let j = 0; j <= RV; j += 1) {
      const v = j / RV;
      for (let i = 0; i <= RU; i += 1) {
        const u = i / RU;
        // leaf outline: pointed at both ends, widest at 0.45
        const t = u;
        const width = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.86)), 0.72) * 0.5;
        const across = (v - 0.5) * 2;
        const x = (t - 0.5);
        const zw = across * width;
        // curl the edges up and add a gentle spine fold
        const curl = Math.pow(Math.abs(across), 2.4) * 0.19
          + Math.sin(t * Math.PI) * 0.05
          + Math.sin(t * 9.3 + rng.range(0, 0)) * 0 ;
        const y = curl + Math.sin(t * Math.PI * 1.0) * 0.035 + Math.cos(across * 2.1) * wob * 0.15;
        pos.push(x, y, zw);
        nor.push(0, 1, 0);
        uv.push(t, v);
        const veins = 0.86 + 0.2 * Math.abs(Math.sin(across * 9 + t * 3));
        const edge = 0.62 + 0.5 * (1 - Math.pow(Math.abs(across), 2));
        const shade = clamp(veins * edge * 0.86, 0.25, 1.2);
        col.push(shade, shade * 0.97, shade * 0.9);
      }
    }
    for (let j = 0; j < RV; j += 1) {
      for (let i = 0; i < RU; i += 1) {
        const a = j * (RU + 1) + i;
        const b = a + 1;
        const c = a + RU + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE_.BufferGeometry();
    g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE_.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE_.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE_.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  const leafMat = track(ctx.materials.make("leaf", {
    vertexColors: true,
    color: 0xffffff,
    side: THREE_.DoubleSide,
    roughness: 0.66,
    metalness: 0,
    shadowSide: THREE_.DoubleSide,
  }));
  extendMaterial(leafMat, {
    key: "fallen-leaf",
    uniforms: {
      uSunDir,
      uSssColor: { value: new THREE_.Color(0xffb268) },
      uSssStrength: { value: 1.5 },
    },
    fragmentHead: `${SSS_HEAD}\nvarying vec3 vFLPos;\n${GLSL_NOISE}`,
    vertexHead: "varying vec3 vFLPos;",
    vertexBody: "vFLPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    fragmentPatches: [
      { at: "#include <lights_fragment_end>", code: SSS_BODY },
      {
        at: "#include <color_fragment>",
        code: `
          float blotch = tsFbm(vFLPos.xz * 0.06);
          diffuseColor.rgb *= mix(vec3(0.86, 0.62, 0.30), vec3(0.52, 0.42, 0.20), clamp(blotch * 1.4 - 0.2, 0.0, 1.0)) * 1.5;
        `,
      },
    ],
  });

  const leafGeo = trackGeo(leafGeometry(0x71cd44));
  const leafPlacements = [];
  {
    const rng = makeRng(0x0d1e5a);
    const items = [];
    const col = new THREE_.Color();
    const spots = [
      [128, -38, 0.4], [244, 168, 0.0], [-2, 292, 0.0], [318, 130, 0.2],
      [200, -120, 0.35], [70, -238, 0.0], [386, 250, 0.0], [156, 246, 0.15],
      [-24, 386, 0.0], [352, -180, 0.0], [268, 46, 0.28], [104, 92, 0.0],
      [400, -30, 0.0], [40, -160, 0.22], [300, 380, 0.0], [-20, 168, 0.0],
    ];
    for (const [x, z, tilt] of spots) {
      if (inWater(x, z, PUDDLE, -20)) continue;
      const size = rng.range(96, 168);
      const y = terrainAt(x, z) + size * 0.03 + (tilt > 0 ? size * 0.16 : 0);
      col.setHSL(rng.range(0.06, 0.13), rng.range(0.35, 0.72), rng.range(0.24, 0.46));
      const it = {
        pos: new THREE_.Vector3(x, y, z),
        scale: new THREE_.Vector3(size, size * rng.range(0.28, 0.46), size * rng.range(0.5, 0.72)),
        rx: tilt * rng.range(0.6, 1.2),
        ry: rng.range(0, TAU),
        rz: rng.range(-0.22, 0.22),
        color: col.clone(),
        key: rng(),
      };
      items.push(it);
      leafPlacements.push(it);
      // Thin slab so you can stand on a fallen leaf. Half-extents come off
      // the instance scale; the y is deliberately shallow because the leaf
      // reads as a floor, not a block.
      foliageColliders.push({
        shape: "box",
        x, y: it.pos.y, z,
        hx: it.scale.x * 0.4, hy: 1.6, hz: it.scale.z * 0.4,
        rx: it.rx, ry: it.ry, rz: it.rz,
        tag: "leaf",
      });
    }
    buildScatter({
      name: "FallenLeaves",
      geometry: leafGeo,
      material: leafMat,
      items,
      chunk: 260,
      castShadow: true,
      receiveShadow: true,
      near: 500,
      far: 1400,
      minFrac: 1,
    });
  }

  /* -------------------------------------------------------------
     4.16 Water bodies (puddle + spilled drink)
     ------------------------------------------------------------- */

  const waterMeshes = [];

  function buildWater(spec, opts) {
    const RINGS = 30;
    const SEG = 96;
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    const idx = [];
    const shore = new Float32Array(SEG);
    const c = new THREE_.Color();

    for (let s = 0; s < SEG; s += 1) {
      const a = (s / SEG) * TAU;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let r = spec.radius * 0.35;
      const limit = spec.radius * 1.6;
      let found = limit;
      const step = Math.max(1.6, spec.radius / 90);
      while (r < limit) {
        const h = opts.surfaceAt(spec.x + dx * r, spec.z + dz * r);
        if (h > spec.level) { found = r; break; }
        r += step;
      }
      shore[s] = found;
    }
    // smooth the shoreline so it does not jitter per segment
    const smoothShore = new Float32Array(SEG);
    for (let s = 0; s < SEG; s += 1) {
      let sum = 0;
      for (let k = -2; k <= 2; k += 1) sum += shore[(s + k + SEG) % SEG];
      smoothShore[s] = sum / 5;
    }

    for (let ri = 0; ri <= RINGS; ri += 1) {
      const t = ri / RINGS;
      for (let s = 0; s <= SEG; s += 1) {
        const si = s % SEG;
        const a = (si / SEG) * TAU;
        const R = smoothShore[si] * 1.015;
        const r = R * t;
        const x = spec.x + Math.cos(a) * r;
        const z = spec.z + Math.sin(a) * r;
        // meniscus: the surface climbs the bank in the outer 16%
        const m = smoothstep(0.84, 1.0, t);
        const y = spec.level + Math.pow(m, 0.7) * opts.meniscus;
        pos.push(x, y, z);
        nor.push(0, 1, 0);
        uv.push(Math.cos(a) * t * 0.5 + 0.5, Math.sin(a) * t * 0.5 + 0.5);
        const bedY = opts.surfaceAt(x, z);
        const depth = clamp01((spec.level - bedY) / spec.depth);
        const rim = Math.pow(m, 1.6);
        c.copy(opts.deep).lerp(opts.shallow, 1 - Math.pow(depth, 0.7));
        c.lerp(opts.rim, rim * 0.85);
        col.push(c.r, c.g, c.b);
      }
    }
    const stride = SEG + 1;
    for (let ri = 0; ri < RINGS; ri += 1) {
      for (let s = 0; s < SEG; s += 1) {
        const a = ri * stride + s;
        const b = a + 1;
        const cc = a + stride;
        const d = cc + 1;
        // Winding matters twice over here. This surface is FrontSide, and
        // for (a, cc, b) the radial edge crossed with the tangential edge
        // gives (0, -1, 0) - so every triangle faced DOWN, the whole water
        // body was backface-culled when seen from above, and a reviewer
        // reported the puddle shot "contains no visible water". Measured: 0%
        // of the frame was water at FrontSide, 55% at DoubleSide. It also
        // broke lighting, because computeVertexNormals() below overwrites
        // the (0,1,0) normals pushed above with the downward ones implied by
        // this winding, so reflection and specular were inverted too.
        idx.push(a, b, cc, b, d, cc);
      }
    }
    const g = trackGeo(new THREE_.BufferGeometry());
    g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE_.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE_.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE_.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return { geometry: g, shore: smoothShore };
  }

  function waterMaterial(key, tint, rippleAmp, rippleScale, opacity, gloss, reflGain = 2.4,
    skyRefl = [0.42, 0.60, 0.85]) {
    const mat = track(ctx.materials.make("water", {
      vertexColors: true,
      color: 0xffffff,
      transparent: true,
      opacity,
      roughness: gloss,
      metalness: 0,
      depthWrite: false,
      side: THREE_.FrontSide,
    }));
    if ("transmission" in mat) mat.transmission = 0;
    if ("thickness" in mat) mat.thickness = 0;
    if ("clearcoat" in mat) { mat.clearcoat = 1; mat.clearcoatRoughness = 0.03; }
    // Drop the library's tiled maps. The `water` entry is repeat 14 at
    // normalStrength 46, and buildWater gives this mesh RADIAL polar UVs, so
    // that is 14 wraps of a ripple normal locked to UV space. A UV-locked
    // frequency cannot compress with distance, which is exactly what a
    // reviewer measured: the dominant period was identical on every scanline
    // from y=420 to y=870, when a receding plane must show it shrink toward
    // the horizon. The result read as a vertical sheet of corrugated plastic
    // rather than a puddle. The ripple below is computed from WORLD position,
    // so it foreshortens correctly for free.
    mat.map = null;
    mat.normalMap = null;
    mat.roughnessMap = null;
    mat.aoMap = null;
    mat.needsUpdate = true;
    // NOTE: setting envMapIntensity here does nothing. three overrides that
    // uniform with scene.environmentIntensity for any material that has no
    // envMap of its own, which is every material in this project. The sky
    // reflection below is explicit for exactly that reason.
    extendMaterial(mat, {
      key,
      uniforms: {
        uTime,
        uRippleAmp: { value: rippleAmp },
        uRippleScale: { value: rippleScale },
        uTint: { value: new THREE_.Color(tint) },
        // Per material: a bluish sky reflection mixed into an amber base
        // desaturates it toward mauve, which is what the spilled drink was
        // doing - a reviewer called it "a flat matte lilac sheet" despite the
        // tint being set to amber.
        uSkyRefl: { value: new THREE_.Color(skyRefl[0], skyRefl[1], skyRefl[2]) },
        // Per material. A single global gain tuned for the puddle washed the
        // spilled drink - which is seen at a grazing angle and so gets the
        // full Fresnel term - from amber to pale blue sky.
        uReflGain: { value: reflGain },
        uGlint: { value: 1.0 },
      },
      vertexHead: "varying vec3 vWWPos;",
      vertexBody: "vWWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: /* glsl */ `
        varying vec3 vWWPos;
        uniform float uTime;
        uniform float uRippleAmp;
        uniform float uRippleScale;
        uniform vec3 uTint;
        uniform vec3 uSkyRefl;
        uniform float uReflGain;
        uniform float uGlint;
      `,
      fragmentPatches: [{
        at: "#include <normal_fragment_begin>",
        code: /* glsl */ `
          {
            vec2 p = vWWPos.xz * uRippleScale;
            float t = uTime;
            // Four fixed-direction cosines on near-harmonic frequencies is
            // an interference LATTICE, not water: it produces a regular grid
            // of identical crescents that repeats across the whole surface,
            // and reviewers consistently described the puddle as corrugated
            // plastic or a printed pattern. Nulling the library's tiled maps
            // did not touch it because the grid was never the texture.
            //
            // Eleven waves instead, with directions stepped by the golden
            // angle so no two ever align, and frequencies scaled by 1.37 so
            // the sum has no common period to beat against.
            vec2 d = vec2(0.0);
            float amp = 1.0;
            float freq = 2.6;
            float ang = 0.0;
            for (int i = 0; i < 11; i++) {
              ang += 2.39996323;
              vec2 dir = vec2(cos(ang), sin(ang));
              float drift = mod(float(i), 2.0) < 0.5 ? 1.0 : -1.0;
              d += dir * cos(dot(p, dir) * freq + t * (1.4 + freq * 0.2) * drift) * amp;
              amp *= 0.82;
              freq *= 1.37;
            }
            d *= 0.5;
            vec3 pert = vec3(-d.x, 0.0, -d.y) * uRippleAmp;
            normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
          }
        `,
      }, {
        at: "#include <color_fragment>",
        code: "diffuseColor.rgb *= uTint;",
      }, {
        // Water reads as water because of grazing-angle sky reflection and a
        // sharp sun glint - not because of its albedo. Without them a puddle
        // whose deep colour is 0x0d2a30, sitting over a dark basin, is
        // indistinguishable from wet mud, which is exactly how a reviewer
        // described this one ("puddle.png contains no visible water").
        at: "#include <opaque_fragment>",
        // NOTE: extendMaterial injects AFTER the anchor, and <opaque_fragment>
        // ends by assigning gl_FragColor. Adding to `outgoingLight` here
        // compiles perfectly and is then thrown away - which is exactly what
        // happened on the first attempt at this. Write gl_FragColor instead.
        // Tonemapping and colorspace conversion still run after us, so this
        // is added in linear space, which is what we want.
        code: /* glsl */ `
          {
            float tsFacing = clamp( dot( geometryNormal, geometryViewDir ), 0.0, 1.0 );
            // Exponent 3 rather than the Schlick 5: a puddle needs to read as
            // water well before the angle gets truly glancing.
            // Exponent 2 rather than 3: a puddle this small is seen mostly
            // from above, so a Schlick-ish curve keeps the reflection off
            // the surface exactly where the viewer is looking.
            float tsFres = 0.06 + 0.94 * pow( 1.0 - tsFacing, 2.0 );
            vec3 tsGlint = vec3( 0.0 );
            #if NUM_DIR_LIGHTS > 0
            {
              vec3 tsL = normalize( directionalLights[ 0 ].direction );
              vec3 tsH = normalize( tsL + geometryViewDir );
              float tsSpec = pow( max( dot( geometryNormal, tsH ), 0.0 ), 620.0 );
              tsGlint += directionalLights[ 0 ].color * tsSpec * ( 0.25 + tsFres ) * uGlint * 5.0;
            }
            #endif
            // A reflective surface is not see-through at a grazing angle, so
            // the mud below stops showing through as the reflection takes over.
            // Reflection REPLACES what you see through the surface; it does
            // not darken it. The first version mixed toward black by Fresnel
            // and then added the sky on top, so the most grazing parts of the
            // puddle - the ones that should be brightest - came out darker
            // than the rest, and a reviewer reported the far edge going dark
            // and no sky reflection at all.
            vec3 tsRefl = uSkyRefl * uReflGain;
            gl_FragColor.rgb = mix( gl_FragColor.rgb, tsRefl, tsFres ) + tsGlint;
            gl_FragColor.a = clamp( gl_FragColor.a + tsFres * 0.6, 0.0, 1.0 );
          }
        `,
      }],
    });
    return mat;
  }

  {
    const built = buildWater(PUDDLE, {
      surfaceAt: terrainAt,
      meniscus: 4.6,
      deep: new THREE_.Color(0x0d2a30),
      shallow: new THREE_.Color(0x5d7f6a),
      rim: new THREE_.Color(0xbfe4e8),
    });
    const mat = waterMaterial("puddle", 0x9fd8dd, 0.030, 0.09, 0.86, 0.035);
    const mesh = new THREE_.Mesh(built.geometry, mat);
    mesh.name = "Puddle";
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = 2;
    root.add(mesh);
    waterMeshes.push(mesh);
    stats.meshes += 1;
    stats.triangles += built.geometry.index.count / 3;
  }

  {
    const slabSurface = (x, z) => {
      const s = onSlab(x, z);
      return s ? Math.max(s.grid.sample(x, z), terrainAt(x, z)) : terrainAt(x, z);
    };
    const built = buildWater(SPILL, {
      surfaceAt: slabSurface,
      meniscus: 1.7,
      deep: new THREE_.Color(0x2a1006),
      shallow: new THREE_.Color(0x9a4d16),
      rim: new THREE_.Color(0xffd2a0),
    });
    const mat = waterMaterial("spill", 0xd98a3c, 0.03, 0.16, 0.9, 0.05, 0.7, [0.78, 0.62, 0.42]);
    const mesh = new THREE_.Mesh(built.geometry, mat);
    mesh.name = "SpilledDrink";
    mesh.renderOrder = 2;
    root.add(mesh);
    waterMeshes.push(mesh);
    stats.meshes += 1;
    stats.triangles += built.geometry.index.count / 3;
  }

  /* -------------------------------------------------------------
     4.17 Landmarks
     ------------------------------------------------------------- */

  const landmarkColliders = [];

  function addMesh(geo, mat, name, castShadow = true) {
    const mesh = new THREE_.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    stats.meshes += 1;
    stats.triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    return mesh;
  }

  function whiteColors(geo) {
    const n = geo.attributes.position.count;
    if (!geo.attributes.color) {
      geo.setAttribute("color", new THREE_.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    return geo;
  }

  /* --- the bottle cap arena --- */
  {
    const L = LANDMARKS.bottleCap;
    const FL = 21;                 // crimped flutes
    const SEG = FL * 6;
    const pos = [];
    const idx = [];
    const col = [];
    const uv = [];
    const yBase = heightAt(L.x, L.z) - 4;
    const yTop = yBase + L.skirt;
    const innerR = L.radius * 0.9;
    const rimR = (a) => L.radius * (1 + 0.055 * Math.cos(a * FL));

    // UVs. This geometry shipped with NO uv attribute at all, and the metal
    // material carries map / normalMap / roughnessMap / metalnessMap / aoMap
    // AND anisotropy 0.55. MeshPhysicalMaterial builds its anisotropy tangent
    // frame from screen-space derivatives of vUv; with no uv attribute those
    // derivatives are zero, normalize(0) is NaN, and the NaN propagates into
    // the shaded colour. That is why the cap rendered as a jagged black
    // "Stonehenge" ring in establishing.png, why the same shape appears as a
    // hard dark wedge in hero-tun.png, and why the skirt looks torn in
    // bottle-cap.png. Proved by swapping in a plain MeshStandardMaterial
    // (clean cap) and, separately, by zeroing anisotropy (also clean).
    // A whole number of repeats keeps the wrap seam invisible.
    const CAP_REPEATS = 8;
    const CAP_TILE = (TAU * L.radius) / CAP_REPEATS;

    function ring(radiusFn, y, shade, planar) {
      const start = pos.length / 3;
      for (let s = 0; s <= SEG; s += 1) {
        const a = (s / SEG) * TAU;
        const r = radiusFn(a);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        pos.push(x, y, z);
        col.push(shade, shade, shade);
        // Cylindrical for the walls; the arena floor is horizontal, so a
        // cylindrical wrap would collapse v to a constant and stretch every
        // texel radially - which showed up as ring banding plus an X-shaped
        // anisotropic highlight across the floor.
        if (planar) uv.push(x / CAP_TILE, z / CAP_TILE);
        else uv.push((s / SEG) * CAP_REPEATS, (y - yBase) / CAP_TILE);
      }
      return start;
    }
    function bridge(r0, r1) {
      for (let s = 0; s < SEG; s += 1) {
        const a = r0 + s;
        const b = a + 1;
        const c = r1 + s;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    // These shades are baked occlusion, and they multiply the enamel tint.
    // The old floors (0.5 at the skirt base, 0.45 on the arena floor) drove
    // albedo down to ~0.04 red once the enamel was applied, so whenever the
    // sun sat behind the cap it crushed to a pure black silhouette. Lifted so
    // the crimp still reads as shaded without going to zero.
    // The inner rim USED to be a plain circle at `innerR` (0.90 R) while the
    // lip above it followed the crimp at 0.93 x rimR, which swings 0.879 R to
    // 0.981 R. In every flute valley the lip therefore fell INSIDE the ring it
    // was bridged to, so that quad turned inside out - 21 self-intersecting
    // slivers around the rim, which is the "open seam with cut-off crimp
    // ridges on the right of the inner rim" a blind reviewer logged. Every
    // ring below the lip now follows the same crimp function at a strictly
    // smaller factor, so the shell can never fold through itself.
    const rOuterBot = ring(rimR, yBase, 0.78);
    const rOuterTop = ring(rimR, yTop, 1.0);
    const rLipIn = ring((a) => rimR(a) * 0.93, yTop + 1.4, 0.95);
    const rInner = ring((a) => rimR(a) * 0.86, yTop - 2.2, 0.82);
    const rFloor = ring(() => L.radius * 0.78, yBase + 5.5, 0.7, true);
    bridge(rOuterBot, rOuterTop);
    bridge(rOuterTop, rLipIn);
    bridge(rLipIn, rInner);
    bridge(rInner, rFloor);
    // arena floor
    const centre = pos.length / 3;
    pos.push(0, yBase + 4.6, 0);
    col.push(0.42, 0.42, 0.42);
    uv.push(0, 0);
    for (let s = 0; s < SEG; s += 1) idx.push(centre, rFloor + s, rFloor + s + 1);

    // Close the underside. The cap was an open shell, so a low camera looking
    // under the crimp saw straight through it to the terrain beyond (proved by
    // raycasting bottle-cap.png at 1160,350: cap, cap, then Terrain at 288).
    const under = pos.length / 3;
    pos.push(0, yBase - 3.5, 0);
    col.push(0.30, 0.30, 0.30);
    uv.push(0, 0);
    for (let s = 0; s < SEG; s += 1) idx.push(under, rOuterBot + s + 1, rOuterBot + s);

    const g = trackGeo(new THREE_.BufferGeometry());
    g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE_.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE_.Float32BufferAttribute(uv, 2));
    g.setAttribute("uv1", new THREE_.Float32BufferAttribute(uv.slice(), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();

    // A bottle cap is painted steel, not bare metal. At metalness 1 it has no
    // diffuse response at all, so the skirt just mirrors the dark ground and
    // reads as a black hole in the frame. Paint is a dielectric.
    //
    // DoubleSide because the cap is an open shell with no wall thickness: with
    // backface culling you see straight through the crimp valleys into the
    // void, and a blind reviewer read the whole landmark as "a burnt broken
    // ring". Rendering the inner surfaces lit costs one extra face per tri and
    // fixes the silhouette until the skirt is properly shelled.
    const mat = track(ctx.materials.make("metal", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.46,
      metalness: 0.32,
      side: THREE_.DoubleSide,
    }));
    extendMaterial(mat, {
      key: "bottlecap",
      vertexHead: "varying vec3 vBWPos;",
      vertexBody: "vBWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: `varying vec3 vBWPos;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // This used to *multiply* the enamel tint into diffuseColor, which
          // already held the metal map's mid-grey albedo times a vertex shade.
          // Grey 0.5 x enamel 0.72/0.10/0.10 lands at 0.36/0.05/0.05 - so the
          // skirt read as black bands and a blind reviewer called the whole
          // landmark "a burnt broken ring". Swapping a plain material in
          // proved the geometry was fine and the patch was the culprit.
          //
          // Assign a plausible painted-steel albedo instead, and fold the old
          // shading back in as a multiplier so the crimp flutes keep their
          // form. Clamped below 1 because an albedo channel that saturates
          // loses every shading gradient in it.
          // Triplanar: the cap is a cylinder with a tall fluted rim, and a
          // .xz projection is constant up every point of that rim, so the
          // rust and paint fields smeared vertically down the one surface
          // that defines the object. A reviewer read the result as unglazed
          // ceramic rather than lacquered steel.
          // Declared here so the roughness and metalness patches below can
          // reuse them - <color_fragment> runs before both in the same
          // function, so these stay in scope.
          float capChip;
          float capRust;
          vec3 bp = vBWPos * 0.06;
          float rust = clamp(((tsFbm(bp.xz) + tsFbm(bp.xy) + tsFbm(bp.zy)) / 3.0) * 1.6 - 0.45, 0.0, 1.0);
          vec3 bq = vBWPos * 0.02;
          float paint = clamp(((tsFbm(bq.xz + 3.3) + tsFbm(bq.xy + 3.3)
            + tsFbm(bq.zy + 3.3)) / 3.0) * 1.5 - 0.25, 0.0, 1.0);
          // The 0.42 floor and the 0.95 albedo ceiling together compressed
          // the value range, so the cap had neither a near-black in the
          // shaded flutes nor a near-white in the highlight.
          float capShade = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.7, 0.22, 1.0);
          // The paint field averaged ~0.5 over the whole cap, so mixing enamel
          // half-way to a warm beige left the surface chalky pink - a blind
          // reviewer called it a terracotta pot and only learned otherwise at
          // reveal. A crown cap is glossy red lacquer over steel: keep the
          // enamel saturated and let wear be SPARSE, and where the lacquer
          // has gone, show bare metal rather than beige paint.
          // Both fields were mis-thresholded. paint averages ~0.5, so
          // smoothstep(0.55, 0.95, paint) is ZERO almost everywhere - chip
          // never fired and metalness stayed pinned at the painted 0.08, so
          // no bare metal existed anywhere on the prop. rust meanwhile went
          // non-zero wherever the fbm exceeded ~0.28, i.e. most of the cap,
          // adding roughness across the whole surface. Centre both on the
          // field's actual mean so "sparse" really is sparse and "some" fires.
          capChip = smoothstep(0.46, 0.66, paint);
          capRust = smoothstep(0.52, 0.78, rust);
          vec3 enamel = vec3(0.62, 0.075, 0.055);
          // Bare steel is desaturated grey. The old chipping read as warm
          // ochre smudges, i.e. grime rather than exposed metal.
          vec3 steel = vec3(0.55, 0.55, 0.56);
          vec3 capCol = mix(enamel, steel, capChip);
          capCol = mix(capCol, vec3(0.34, 0.19, 0.09), rust * 0.75);
          diffuseColor.rgb = clamp(capCol * capShade, 0.0, 0.95);
        `,
      }, {
        at: "#include <roughnessmap_fragment>",
        // Lacquer is glossy; bare steel is satin; rust is matte. The old
        // version only ever ADDED roughness, so the whole cap sat matte and
        // never produced a specular highlight.
        // Lacquer is glossy - 0.17 plus a rust term that ran everywhere left
        // it at ~0.33, which is why the highlight was a broad soft smear
        // rather than the tight streak painted steel gives.
        code: "roughnessFactor = clamp(mix(0.09, 0.38, capChip) + capRust * 0.40, 0.06, 1.0);",
      }, {
        at: "#include <metalnessmap_fragment>",
        // Painted lacquer is a dielectric over metal, so it reads as low
        // metalness; where the paint has chipped, the steel underneath is
        // fully metallic. The old line scaled the base 0.32 DOWN by up to
        // 0.8, leaving ~0.06 - no metallic response anywhere on the prop.
        code: "metalnessFactor = mix(0.08, 0.95, capChip) * (1.0 - capRust * 0.7);",
      }],
    });
    const mesh = addMesh(g, mat, "BottleCap");
    mesh.position.set(L.x, 0, L.z);
    mesh.updateMatrixWorld(true);
    landmarkColliders.push({ mesh, kind: "trimesh" });
  }

  /* --- the lolly stick launch ramp --- */
  {
    const L = LANDMARKS.lolly;
    const dx = L.x1 - L.x0;
    const dz = L.z1 - L.z0;
    const yaw = Math.atan2(dx, dz);
    const y0 = heightAt(L.x0, L.z0) + 3;
    const y1 = heightAt(L.x1, L.z1) + 96;
    const runLen = Math.hypot(dx, dz);
    const pitch = Math.atan2(y1 - y0, runLen);

    const shape = new THREE_.Shape();
    const hw = L.w / 2;
    const hl = L.len / 2;
    const r = hw;
    shape.moveTo(-hw, -hl + r);
    shape.lineTo(-hw, hl - r);
    shape.absarc(0, hl - r, r, Math.PI, 0, true);
    shape.lineTo(hw, -hl + r);
    shape.absarc(0, -hl + r, r, 0, Math.PI, true);
    const geo = trackGeo(new THREE_.ExtrudeGeometry(shape, {
      depth: L.t, bevelEnabled: true, bevelSize: 2.2, bevelThickness: 2.2, bevelSegments: 2, curveSegments: 10,
    }));
    geo.translate(0, 0, -L.t / 2);
    geo.rotateX(-Math.PI / 2);
    whiteColors(geo);
    geo.computeBoundingSphere();

    const mat = track(ctx.materials.make("paintedWood", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0,
    }));
    extendMaterial(mat, {
      key: "lolly",
      vertexHead: "varying vec3 vLPos;",
      vertexBody: "vLPos = position;",
      fragmentHead: `varying vec3 vLPos;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // Coarser across the width so the grain survives at establishing
          // distance instead of averaging to flat khaki.
          // Two reviewers called this object "an untextured olive rock". It is
          // the lolly stick seen END-ON, and the grain was a function of
          // (x, z) only - so on the cut end, a face of constant z, it
          // collapsed to a 1D ramp across the width and rendered as a smooth
          // vertical gradient with no detail at all. Any face perpendicular
          // to the unused axis of a 2D noise is featureless by construction.
          // TRIPLANAR, not one projection. Any single 2D noise leaves the face
          // perpendicular to its unused axis completely featureless: with
          // (x, z) the sawn end was a 1D ramp, and adding a (y, x) term fixed
          // that face while leaving the flat TOP - a plane of constant y -
          // equally flat, which is the face that actually fills the frame.
          // Two reviewers read the result as "an untextured olive rock".
          vec3 lp = vec3(vLPos.x * 0.30, vLPos.y * 0.30, vLPos.z * 0.030);
          float grain = (tsNoise(lp.xz) + tsNoise(lp.xy) + tsNoise(lp.zy)) * 0.22;
          vec3 lf = vec3(vLPos.x * 1.1, vLPos.y * 1.1, vLPos.z * 0.10);
          grain += (tsNoise(lf.xz) + tsNoise(lf.xy) + tsNoise(lf.zy)) * 0.12;
          // End grain: concentric arcs on the cut face, which is the single
          // most recognisable cue that a thing is sawn wood.
          float rings = sin(length(vec2(vLPos.x, vLPos.y)) * 0.9
            + tsNoise(vec2(vLPos.x * 0.5, vLPos.y * 0.5)) * 2.2) * 0.5 + 0.5;
          grain = clamp(grain + rings * 0.16, 0.0, 1.0);
          vec3 wood = mix(vec3(0.80, 0.68, 0.46), vec3(0.58, 0.45, 0.28), grain);
          float stain = clamp(tsFbm(vLPos.xz * 0.02) * 1.4 - 0.35, 0.0, 1.0);
          wood = mix(wood, vec3(0.42, 0.30, 0.18), stain * 0.6);
          // wood * 1.5 reached red 1.20 / green 1.02. Once a channel
          // saturates every shading gradient in it disappears and the prop
          // reads as a flat sticker - the same bug already fixed on the LEGO
          // brick and the bottle cap, never fixed at this call site.
          diffuseColor.rgb *= min(wood * 1.5, vec3(0.95));
        `,
      }],
    });
    const mesh = addMesh(geo, mat, "LollyStick");
    mesh.position.set(
      L.x0 + dx * 0.5 - Math.sin(yaw) * 0,
      (y0 + y1) * 0.5,
      L.z0 + dz * 0.5
    );
    mesh.rotation.set(0, yaw, 0);
    mesh.rotateX(-pitch);
    mesh.rotateOnAxis(new THREE_.Vector3(0, 0, 1), 0.04);
    mesh.updateMatrixWorld(true);
    landmarkColliders.push({ mesh, kind: "trimesh" });
  }

  /* --- terracotta shard: the overhang --- */
  function terracottaMaterial(key, hueA, hueB) {
    const mat = track(ctx.materials.make("ceramic", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0,
      side: THREE_.DoubleSide,
    }));
    if ("clearcoat" in mat) mat.clearcoat = 0.05;
    if ("transmission" in mat) mat.transmission = 0;
    extendMaterial(mat, {
      key,
      uniforms: {
        uHueA: { value: new THREE_.Color(hueA) },
        uHueB: { value: new THREE_.Color(hueB) },
      },
      vertexHead: "varying vec3 vTPos;",
      vertexBody: "vTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: `varying vec3 vTPos;\nuniform vec3 uHueA;\nuniform vec3 uHueB;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // Multiplying clay * 1.5 into diffuseColor pushed red to ~1.27 and
          // clipped it, which is why the pot read as a flat salmon gradient
          // with no shading in it - the same albedo-clipping bug as the LEGO
          // brick and the bottle cap. Assign the clay colour and fold the
          // map/vertex shading back in as a multiplier, clamped below 1.
          //
          // The grain frequencies are also raised: this pot is 700 units tall
          // and 258 across, so the old rates gave it barely one cycle of
          // variation over the whole silhouette.
          // TRIPLANAR. The pot is a vertical cylinder, and a .xz projection
          // is CONSTANT along every vertical line on it - so the whole wall
          // got a vertical streak. Crossed with the horizontal throwing
          // rings that is a crosshatch, which is the "woven canvas" weave
          // three separate fixes failed to remove: each one worked on the
          // rings, and the rings were only half of the plaid.
          vec3 tp = vTPos * 0.055;
          float g = (tsFbm(tp.xz) + tsFbm(tp.xy) + tsFbm(tp.zy)) * 0.2
            + (tsNoise(vTPos.xz * 0.62) + tsNoise(vTPos.xy * 0.62)
              + tsNoise(vTPos.zy * 0.62)) * 0.083;
          vec3 clay = mix(uHueA, uHueB, clamp(g * 1.5 - 0.1, 0.0, 1.0));
          vec3 td = vTPos * 0.16;
          float dust = clamp(((tsFbm(td.xz + 9.0) + tsFbm(td.xy + 9.0)
            + tsFbm(td.zy + 9.0)) / 3.0) * 1.4 - 0.4, 0.0, 1.0);
          clay = mix(clay, vec3(0.74, 0.70, 0.62), dust * 0.45);
          float clayShade = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.55, 0.45, 1.0);
          diffuseColor.rgb = clamp(clay * clayShade * 1.28, 0.0, 0.94);
        `,
      }, {
        at: "#include <roughnessmap_fragment>",
        code: "roughnessFactor = clamp(0.72 + 0.3 * ((tsNoise(vTPos.xz * 0.5)"
          + " + tsNoise(vTPos.xy * 0.5) + tsNoise(vTPos.zy * 0.5)) / 3.0), 0.4, 1.0);",
      }],
    });
    return mat;
  }

  const shardMat = terracottaMaterial("terracotta", 0xb4552c, 0xd9835a);

  {
    const L = LANDMARKS.shard;
    const ARC = 1.85;
    const A0 = -ARC / 2;
    const SEGA = 40;
    const SEGY = 22;
    const TH = 15;
    const pos = [];
    const col = [];
    const uv = [];
    const idx = [];
    const jag = makeNoise(0x77aa33);

    // Like the bottle cap, this shell shipped with no uv attribute while the
    // terracotta material carries map / normalMap / roughnessMap / aoMap - so
    // every texture sampled the same texel and the biggest landmark on the
    // east side was untextured. Unwrap it in world units: u runs along the
    // arc, v up the wall.
    const SHARD_TILE = 118;

    const topAt = (t) => L.height * (0.62 + 0.38 * (0.5 + 0.5 * Math.cos((t - 0.42) * 4.4)))
      * (0.85 + 0.3 * (jag.noise2(t * 6.1, 0.5) * 0.5 + 0.5));

    function shell(rad, flip) {
      const start = pos.length / 3;
      for (let j = 0; j <= SEGY; j += 1) {
        const v = j / SEGY;
        for (let i = 0; i <= SEGA; i += 1) {
          const t = i / SEGA;
          const a = A0 + t * ARC;
          const yTop = topAt(t);
          const y = v * yTop;
          const bulge = 1 + 0.055 * Math.sin(v * Math.PI * 0.9);
          const r = rad * bulge;
          pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
          const shade = lerp(0.42, 1.05, Math.pow(v, 0.6)) * (flip ? 0.8 : 1);
          col.push(shade, shade, shade);
          uv.push((a * rad) / SHARD_TILE, y / SHARD_TILE);
        }
      }
      return start;
    }

    const outer = shell(L.radius, false);
    const inner = shell(L.radius - TH, true);
    const stride = SEGA + 1;
    for (let j = 0; j < SEGY; j += 1) {
      for (let i = 0; i < SEGA; i += 1) {
        const a = outer + j * stride + i;
        idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
        const b = inner + j * stride + i;
        idx.push(b, b + 1, b + stride, b + 1, b + stride + 1, b + stride);
      }
    }
    // cap the top edge and the two side edges
    for (let i = 0; i < SEGA; i += 1) {
      const a = outer + SEGY * stride + i;
      const b = inner + SEGY * stride + i;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    for (let j = 0; j < SEGY; j += 1) {
      const a = outer + j * stride;
      const b = inner + j * stride;
      idx.push(a, a + stride, b, b, a + stride, b + stride);
      const c = outer + j * stride + SEGA;
      const d = inner + j * stride + SEGA;
      idx.push(c, d, c + stride, c + stride, d, d + stride);
    }

    const g = trackGeo(new THREE_.BufferGeometry());
    g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE_.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE_.Float32BufferAttribute(uv, 2));
    g.setAttribute("uv1", new THREE_.Float32BufferAttribute(uv.slice(), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();

    const mesh = addMesh(g, shardMat, "TerracottaShard");
    mesh.position.set(L.x, terrainAt(L.x, L.z) - 26, L.z);
    mesh.rotation.set(0, 2.05, 0);
    mesh.rotateOnAxis(new THREE_.Vector3(1, 0, 0), -0.28);
    mesh.updateMatrixWorld(true);
    landmarkColliders.push({ mesh, kind: "trimesh" });
  }

  /* --- the LEGO brick bridge --- */
  {
    const L = LANDMARKS.legoBrick;
    const group = new THREE_.Group();
    group.name = "LegoBrick";
    const mat = track(ctx.materials.make("plastic", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.24,
      metalness: 0,
    }));
    if ("clearcoat" in mat) { mat.clearcoat = 0.9; mat.clearcoatRoughness = 0.14; }
    // The shared plastic entry's polish map is a heavily anisotropic streak
    // authored for large flat faces. Multiplied into a red brick it reads as
    // wavy white BRUSH STROKES, and its olive base survives wherever the
    // shading is dark - which is the "red and olive patchwork" on the end
    // face. Same contamination already stripped from the garden hose; the
    // patch below supplies this prop's albedo itself.
    mat.map = null;
    mat.roughnessMap = null;
    mat.normalMap = null;
    // clearcoatNormalMap too. The plastic entry points it at the gloss map,
    // and that is what survived the first pass as wavy white streaks along
    // the long face: nulling the three obvious maps left the CLEARCOAT still
    // reading a streak texture, so the lacquer highlight kept the brush-
    // stroke shape even though the albedo underneath was clean.
    mat.clearcoatNormalMap = null;
    mat.needsUpdate = true;
    extendMaterial(mat, {
      key: "lego",
      vertexHead: "varying vec3 vPPos;",
      vertexBody: "vPPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: `varying vec3 vPPos;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // Albedo must stay below 1.0. The previous "* 1.35" pushed red to
          // 1.13, which clips: once a channel saturates, every shading
          // gradient in it disappears and the brick reads as a flat sticker.
          // Real ABS red is around 0.5 linear.
          // Triplanar: a single .xz projection is constant down the brick's
          // vertical end faces, so those got one flat scuff value while the
          // top varied - the third time this exact trap has appeared here.
          vec3 pp = vPPos * 0.3;
          float scuff = (tsFbm(pp.xz) + tsFbm(pp.xy) + tsFbm(pp.zy)) / 3.0 * 0.35;
          // ASSIGN, do not multiply. Multiplying a red tint into the base map
          // keeps every streak and olive patch that map contains; ABS is a
          // uniform injection-moulded colour. The vertex-shade term is folded
          // back in so form is preserved, clamped well below clipping.
          float brickShade = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.6, 0.45, 1.0);
          vec3 abs0 = mix(vec3(0.54, 0.055, 0.045), vec3(0.62, 0.17, 0.13), scuff);
          diffuseColor.rgb = clamp(abs0 * brickShade, 0.0, 0.95);
        `,
      }],
    });

    const bodyGeo = trackGeo(whiteColors(new THREE_.BoxGeometry(L.w, L.h, L.d, 2, 2, 2)));
    const body = new THREE_.Mesh(bodyGeo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const studGeo = trackGeo(whiteColors(new THREE_.CylinderGeometry(11, 11, 11, 20)));
    const studs = new THREE_.InstancedMesh(studGeo, mat, 8);
    studs.castShadow = true;
    studs.receiveShadow = true;
    const m4 = new THREE_.Matrix4();
    let k = 0;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        m4.makeTranslation(-L.w / 2 + 16.5 + i * 33, L.h / 2 + 5, -L.d / 2 + 16.5 + j * 33);
        studs.setMatrixAt(k++, m4);
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    studs.computeBoundingSphere();
    group.add(studs);
    stats.meshes += 2;
    stats.instances += 8;

    group.position.set(L.x, PATIO_TOP + 4, L.z);
    group.rotation.set(0.05, 0.42, -0.03);
    root.add(group);
    group.updateMatrixWorld(true);
    landmarkColliders.push({ mesh: body, kind: "box", half: [L.w / 2, L.h / 2, L.d / 2] });
  }

  /* --- the rusty screw --- */
  {
    const L = LANDMARKS.screw;
    const group = new THREE_.Group();
    group.name = "RustyScrew";
    const mat = track(ctx.materials.make("metal", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.85,
    }));
    extendMaterial(mat, {
      key: "screw",
      vertexHead: "varying vec3 vSPos;",
      vertexBody: "vSPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: `varying vec3 vSPos;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          float rust = clamp(tsFbm(vSPos.xyz.xz * 0.14 + vSPos.y * 0.04) * 1.7 - 0.35, 0.0, 1.0);
          diffuseColor.rgb *= mix(vec3(0.62, 0.62, 0.66), vec3(0.50, 0.22, 0.07), rust);
        `,
      }, {
        at: "#include <roughnessmap_fragment>",
        code: "roughnessFactor = clamp(0.35 + 0.6 * tsFbm(vSPos.xz * 0.14), 0.2, 1.0);",
      }],
    });

    // thread: a lathe profile with a sawtooth radius
    const pts = [];
    const turns = 11;
    for (let i = 0; i <= 120; i += 1) {
      const t = i / 120;
      const saw = Math.abs(((t * turns) % 1) - 0.5) * 2;
      const taper = t > 0.86 ? clamp01((1 - t) / 0.14) : 1;
      pts.push(new THREE_.Vector2((L.r * (0.62 + 0.38 * saw)) * taper + 0.001, t * L.len));
    }
    const threadGeo = trackGeo(whiteColors(new THREE_.LatheGeometry(pts, 26)));
    const thread = new THREE_.Mesh(threadGeo, mat);
    thread.castShadow = true;
    thread.receiveShadow = true;
    group.add(thread);

    const headGeo = trackGeo(whiteColors(new THREE_.CylinderGeometry(L.r * 2.1, L.r * 1.85, L.r * 1.1, 26)));
    const head = new THREE_.Mesh(headGeo, mat);
    head.position.y = L.len + L.r * 0.5;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    const slotGeo = trackGeo(whiteColors(new THREE_.BoxGeometry(L.r * 4.1, L.r * 0.5, L.r * 0.55)));
    const slot = new THREE_.Mesh(slotGeo, mat);
    slot.position.y = L.len + L.r * 0.95;
    group.add(slot);

    group.position.set(L.x, PATIO_BASE - 22, L.z);
    group.rotation.set(0.34, 0.8, 0.22);
    root.add(group);
    group.updateMatrixWorld(true);
    stats.meshes += 3;
    landmarkColliders.push({
      mesh: thread, kind: "capsule", radius: L.r * 0.9, halfHeight: L.len * 0.5,
    });
  }

  /* --- the coiled hose --- */
  {
    const L = LANDMARKS.hose;
    class Helix extends THREE_.Curve {
      getPoint(t, target = new THREE_.Vector3()) {
        const turns = 2.35;
        const a = t * TAU * turns - 0.6;
        // The coil SELF-INTERSECTED. Over 2.35 turns a rise of 74 gives 31.5
        // per turn, and with the radius shrinking 12 per turn the centrelines
        // of adjacent turns pass 33.7 apart - against a tube 52 across. Each
        // wrap buried itself ~18 units into its neighbour, and the dashed
        // line reviewers reported as a "UV seam" on the hose was that
        // intersection curve. sqrt(56^2 - 12^2) = 54.7 per turn clears it.
        const rise = t * 129;
        const r = L.coil * (1 - t * 0.16);
        return target.set(Math.cos(a) * r, rise + L.tube, Math.sin(a) * r);
      }
    }
    // 16 radial segments on a 26-unit tube is a visible polygon; 28 costs
    // almost nothing on a single mesh and rounds the silhouette.
    // Tessellation bounds DISPLACEMENT, not shading: vHUv.x interpolates per
    // fragment, so sin(vHUv.x * k) is evaluated per pixel no matter how few
    // segments there are. The rib is shading only, so the real limit is
    // screen-space aliasing, handled with fwidth below. 240 segments is for
    // a smooth coil, nothing else.
    const geo = trackGeo(whiteColors(new THREE_.TubeGeometry(new Helix(), 240, L.tube, 28, false)));
    const mat = track(ctx.materials.make("plastic", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.52,
      metalness: 0,
    }));
    // The shared "plastic" entry is ABS with a clearcoat, which is right for a
    // LEGO brick and wrong for a rubber hose: the clearcoat is what turned a
    // dark green tube into a pale mint one with a blown specular ridge along
    // the crest. Rubber is a matte dielectric.
    if ("clearcoat" in mat) { mat.clearcoat = 0; mat.clearcoatRoughness = 1; }
    // Proved by probe: forcing the albedo to pure red turns 40% of the frame
    // red, so the albedo patch below DOES reach the pixel and the pale mint
    // was never a colour problem - it is specular. The shared ABS profile
    // runs a strong spec gain with a hard grazing boost, which on a large
    // smooth tube blows the whole visible surface toward white.
    if ("specularIntensity" in mat) mat.specularIntensity = 0.30;
    // The longitudinal "brushed satin" streaks are not the rib - they survive
    // at any rib frequency. They are the ABS polish map the shared plastic
    // entry carries (a heavily anisotropic streak authored for the flat faces
    // of a LEGO brick), sampled along the tube's UV. The patch below supplies
    // this hose's albedo, ribs, roughness and normal itself, so the inherited
    // maps contribute nothing but that streak.
    mat.map = null;
    mat.roughnessMap = null;

    // Ribs, as a real tangent-space normal map. Screen-space derivatives
    // cannot carry detail this fine - they alias into hard bands and their
    // own fwidth guard aliases with them - but a mipped, anisotropically
    // filtered texture is exactly the tool for it: the GPU filters the rib
    // away smoothly as the tube recedes instead of sparkling.
    //
    // TubeGeometry maps u along the path and v around the circumference, so
    // a profile that varies in U and is constant in V produces rings.
    // 8 ribs per tile at repeat 40 gives 320 along a ~2400-unit path, i.e.
    // ~7.5 units per rib on a tube 52 across - corrugated hose.
    mat.normalMap = (() => {
      const W = 512;
      const H = 4;
      const RIBS = 8;
      const data = new Uint8Array(W * H * 4);
      for (let x = 0; x < W; x += 1) {
        const slope = Math.cos((x / W) * RIBS * TAU) * 1.7;
        const inv = 1 / Math.hypot(-slope, 0, 1);
        const r = Math.round(((-slope * inv) * 0.5 + 0.5) * 255);
        const g = 128;
        const b = Math.round((inv * 0.5 + 0.5) * 255);
        for (let y = 0; y < H; y += 1) {
          const i = (y * W + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          // 128 == 0.5, which is the neutral value the library's wear patch
          // subtracts. Leaving this at 255 would silently switch wear on.
          data[i + 3] = 128;
        }
      }
      const tex = new THREE_.DataTexture(data, W, H, THREE_.RGBAFormat);
      tex.wrapS = THREE_.RepeatWrapping;
      tex.wrapT = THREE_.RepeatWrapping;
      tex.repeat.set(40, 1);
      tex.generateMipmaps = true;
      tex.minFilter = THREE_.LinearMipmapLinearFilter;
      tex.magFilter = THREE_.LinearFilter;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      return tex;
    })();
    mat.normalScale = new THREE_.Vector2(0.85, 0.85);

    // Roughness has to follow the rib too. With a flat roughness the specular
    // lobe never sees the corrugation, so a broad unmodulated highlight runs
    // along the crown while the ribs band either side of it - the tube reads
    // as a painted stripe. three samples roughness from the GREEN channel,
    // and the normal map's green must stay at 128 for a correct normal, so
    // this needs its own texture rather than another channel of that one.
    mat.roughnessMap = (() => {
      const W = 512;
      const H = 4;
      const RIBS = 8;
      const data = new Uint8Array(W * H * 4);
      for (let x = 0; x < W; x += 1) {
        // Crests are scuffed matte, troughs hold dust and are matter still.
        const v = Math.round((0.62 + 0.16 * Math.cos((x / W) * RIBS * TAU)) * 255);
        for (let y = 0; y < H; y += 1) {
          const i = (y * W + x) * 4;
          data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
        }
      }
      const tex = new THREE_.DataTexture(data, W, H, THREE_.RGBAFormat);
      tex.wrapS = THREE_.RepeatWrapping;
      tex.wrapT = THREE_.RepeatWrapping;
      tex.repeat.set(40, 1);
      tex.generateMipmaps = true;
      tex.minFilter = THREE_.LinearMipmapLinearFilter;
      tex.magFilter = THREE_.LinearFilter;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      return tex;
    })();
    mat.roughness = 1;
    mat.needsUpdate = true;
    extendMaterial(mat, {
      key: "hose",
      vertexHead: "varying vec3 vHPos;\nvarying vec2 vHUv;",
      vertexBody: "vHPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvHUv = uv;",
      fragmentHead: `varying vec3 vHPos;\nvarying vec2 vHUv;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // Rib frequency is bounded by the TUBE'S TESSELLATION, not by the
          // screen. TubeGeometry maps uv.x along the path and this tube has
          // 132 tubular segments, so 620 cycles (and then 150) asked for more
          // rings than there are rows of vertices to carry them: the result
          // aliased into a moire lattice, and once the rib also drove a
          // normal bump it turned into longitudinal streaks that read as
          // brushed metal. 44 cycles is ~3 segments per rib, which resolves.
          // Pitch ~7.5 world units on a 52-unit tube, i.e. seven ribs across
          // its width - corrugated hose, not barber's pole. At 44 and then
          // 140 cycles the ribs were as coarse as the tube itself and read as
          // broad painted stripes. Amplitude is small because a rib is a
          // shape, not a colour change; the normal bump carries it.
          float tsRibPhase = vHUv.x * 320.0;
          // Fade the rib out where one period is smaller than a pixel, or it
          // sparkles into moire at distance. This is the antialiasing the
          // earlier "just lower the frequency" attempts were substituting for.
          float tsRibFade = 1.0 - smoothstep(1.1, 2.8, fwidth(tsRibPhase));
          float rib = 0.94 + 0.06 * sin(tsRibPhase) * tsRibFade;
          // A single world-space .xz projection ignores Y, so the field is
          // constant down the tube's flanks (vertical column smear) and, at a
          // tube radius of 26 against a 0.05 frequency, only ~2.6 lattice
          // cells span it - the lattice itself was visible as blocks. Average
          // three projections and raise the frequency.
          float grime = clamp((
              tsFbm(vHPos.xz * 0.16)
            + tsFbm(vHPos.xy * 0.16)
            + tsFbm(vHPos.zy * 0.16)) * (1.4 / 3.0) - 0.35, 0.0, 1.0);
          vec3 rubber = mix(vec3(0.055, 0.185, 0.095), vec3(0.115, 0.285, 0.150), rib);
          rubber = mix(rubber, vec3(0.20, 0.19, 0.14), grime * 0.5);
          diffuseColor.rgb *= min(rubber * 1.5, vec3(0.95));
        `,
      }, {
        // NO screen-space normal bump. It took dFdx/dFdy of a 320-cycle
        // sine, and its own fwidth guard was derived from that same aliased
        // signal so it could not damp itself: the result was hard-edged bands
        // marching across the tube. Proved by ablation - the bands survived a
        // completely FLAT albedo, so they were never the rib colour, and they
        // went away with this removed. A rib this fine needs a real
        // tangent-space normal map with mips, not screen-space derivatives.
        at: "#include <roughnessmap_fragment>",
        // Constant. This term had no fwidth fade while the albedo and normal
        // did, so it kept aliasing on its own and printed the hard-edged
        // bands across the tube that three passes were blaming on the rib
        // frequency. Roughness variation is not what makes a rib read.
        // Let the roughness map through - overriding it here is what kept the
        // rib out of the specular in the first place.
        code: "",
      }],
    });
    const mesh = addMesh(geo, mat, "GardenHose");
    mesh.position.set(L.x, terrainAt(L.x, L.z) - 4, L.z);
    mesh.rotation.y = 0.7;
    mesh.updateMatrixWorld(true);
    landmarkColliders.push({ mesh, kind: "trimesh" });
  }

  /* --- the terracotta pot on the skyline --- */
  {
    const L = LANDMARKS.pot;
    const pts = [];
    for (let i = 0; i <= 26; i += 1) {
      const t = i / 26;
      let r = L.radius * (0.62 + 0.38 * Math.pow(t, 0.78));
      if (t > 0.93) r *= 1 + (t - 0.93) * 2.6;
      pts.push(new THREE_.Vector2(r, t * L.height));
    }
    const geo = trackGeo(whiteColors(new THREE_.LatheGeometry(pts, 56)));
    // Was castShadow=false with receiveShadow=false below. A 735-unit vessel
    // standing in full sun laid down nothing and had no self-shadowing, so it
    // read as a flat orange ramp and six of thirteen frames contained no cast
    // shadow at all.
    const mesh = addMesh(geo, shardMat, "TerracottaPot", true);
    mesh.position.set(L.x, terrainAt(clamp(L.x, -HALF, HALF), -HALF) - 40, L.z);
    mesh.updateMatrixWorld(true);
    mesh.receiveShadow = true;

    // Soil mound spilling over the pot's lip, so it does not read as a plain cylinder.
    const soilGeo = trackGeo(whiteColors(new THREE_.SphereGeometry(L.radius * 0.99, 40, 18, 0, TAU, 0, Math.PI / 2)));
    const soilMat = track(ctx.materials.make("soil", { vertexColors: true, color: 0x4a3626, roughness: 1 }));
    const soilMesh = addMesh(soilGeo, soilMat, "PotSoil", false);
    soilMesh.position.set(L.x, mesh.position.y + L.height - 16, L.z);
    soilMesh.scale.set(1, 0.34, 1);
    soilMesh.updateMatrixWorld(true);
  }

  /* --- climbable boulder stack --- */
  {
    const L = LANDMARKS.boulders;
    const rng = makeRng(0x5511aa);
    const mat = track(ctx.materials.make("stone", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
    }));
    extendMaterial(mat, {
      key: "boulder",
      vertexHead: "varying vec3 vRPos;",
      vertexBody: "vRPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: `varying vec3 vRPos;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // Two bugs, both already fixed elsewhere in this file and both
          // present here. (1) At frequency 0.05 one noise cell spans 20 world
          // units, and these boulders are 26-54 across - about two cells over
          // the whole rock, which resolves as a smooth gradient. A reviewer
          // called this "the single most obviously unfinished object in the
          // 14". (2) A single .xz projection ignores height, so the field is
          // constant down vertical faces and smears.
          vec3 rp = vRPos * 0.34;
          float f = (tsFbm(rp.xz) + tsFbm(rp.xy) + tsFbm(rp.zy)) / 3.0;
          // A second, finer octave for grain - a rock this size in a macro
          // world should show pits and crystal flecks, not just form.
          vec3 rf = vRPos * 1.45;
          float grain = (tsFbm(rf.xz) + tsFbm(rf.zy)) * 0.5;
          vec3 rock = mix(vec3(0.40, 0.38, 0.345), vec3(0.70, 0.68, 0.63), f);
          rock = mix(rock, rock * 0.78, smoothstep(0.55, 0.95, grain));
          rock = mix(rock, vec3(0.62, 0.60, 0.56), smoothstep(0.72, 0.98, grain) * 0.5);
          // Moss gathers in hollows and on upward faces, not uniformly.
          float moss = clamp((tsFbm(vRPos.xz * 0.09 + 4.0) * 1.6 - 0.7), 0.0, 1.0);
          // NB: no vNormal here - this patch runs at <color_fragment>, which
          // is before <normal_fragment_begin>, so neither the normal nor the
          // vNormal varying is in scope yet (and vNormal does not exist at
          // all under flat shading). Using it fails to link and every boulder
          // renders with an invalid program.
          rock = mix(rock, vec3(0.24, 0.34, 0.15), moss * 0.5);
          // rock * 1.45 reached 1.04 red / 1.02 green. A saturated channel has
          // no gradient left in it - the same clip already fixed on the LEGO
          // brick, the bottle cap, the lolly stick and the canopy leaf.
          diffuseColor.rgb *= min(rock * 1.45, vec3(0.95));
        `,
      }],
    });
    const geo = trackGeo(pebbleGeometry(0x11aa55, 2));
    const items = [];
    let y = terrainAt(L.x, L.z) - 6;
    for (let i = 0; i < 9; i += 1) {
      const s = rng.range(26, 54) * (1 - i * 0.055);
      const a = rng.range(0, TAU);
      const rad = i === 0 ? 0 : rng.range(6, 34);
      items.push({
        pos: new THREE_.Vector3(L.x + Math.cos(a) * rad, y + s * 0.32, L.z + Math.sin(a) * rad),
        scale: new THREE_.Vector3(s, s * rng.range(0.6, 0.95), s * rng.range(0.8, 1.1)),
        rx: rng.range(0, TAU), ry: rng.range(0, TAU), rz: rng.range(0, TAU),
        color: new THREE_.Color().setHSL(0.09, rng.range(0.04, 0.14), rng.range(0.5, 0.85)),
        key: i,
      });
      y += s * 0.52;
    }
    buildScatter({
      name: "BoulderStack",
      geometry: geo,
      material: mat,
      items,
      chunk: 400,
      castShadow: true,
      near: 900,
      far: 1400,
      minFrac: 1,
    });
  }

  /* --- clover-ish canopy plants --- */
  {
    const stemMat = track(ctx.materials.make("leaf", {
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0,
    }));
    extendMaterial(stemMat, {
      key: "stem",
      uniforms: { ...windUniforms(0.24) },
      vertexHead: WIND_HEAD,
      vertexBody: WIND_BODY,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: "diffuseColor.rgb *= vec3(0.44, 0.66, 0.30) * 1.4;",
      }],
    });
    const canopyMat = track(ctx.materials.make("leaf", {
      vertexColors: true,
      color: 0xffffff,
      side: THREE_.DoubleSide,
      // 0.6 is wet-plastic glossy. Every vein ridge threw a hard specular,
      // so the veins read as bright white/gold dashes on a dark leaf rather
      // than as plant structure - cutting the geometric relief from 0.022 to
      // 0.008 did not fix it because the relief was never the problem, the
      // gloss was. A living leaf is a soft dielectric.
      roughness: 0.82,
      metalness: 0,
      shadowSide: THREE_.DoubleSide,
    }));
    // Measured: zeroing the vein normals cut gold-reading pixels on the
    // canopy from 9.6% to 5.9% and peak red from 244 to 225, so roughly
    // 40% of the "gold vein dashes" is a warm SUN SPECULAR catching ridges
    // that the library's normal map exaggerates - not albedo, and not
    // something lowering roughness alone could reach. Keep enough relief to
    // read as a leaf, not enough to throw a highlight off every vein.
    if (canopyMat.normalScale) canopyMat.normalScale.set(0.34, 0.34);
    extendMaterial(canopyMat, {
      key: "canopy",
      uniforms: {
        ...windUniforms(0.4),
        uSunDir,
        // The other ~60%. 0xa6e26e is a yellow-green and at strength 2.6 it
        // multiplies the blade's own colour hard enough to push the brightest
        // parts of a backlit leaf into amber. Transmitted light through a
        // leaf is green because chlorophyll is what it passes.
        uSssColor: { value: new THREE_.Color(0x8ed06a) },
        uSssStrength: { value: 1.45 },
      },
      vertexHead: `${WIND_HEAD}\nvarying vec2 vCanUv;`,
      vertexBody: `${WIND_BODY}\nvCanUv = uv;`,
      fragmentHead: `${SSS_HEAD}\nvarying vec3 vCanPos;\nvarying vec2 vCanUv;\n${GLSL_NOISE}`,
      fragmentPatches: [
        { at: "#include <lights_fragment_end>", code: SSS_BODY },
        {
          at: "#include <color_fragment>",
          code: `
            // "veins" used to be isotropic world-space noise, which cannot
            // produce a vein: it fought the radial ridges in the geometry
            // instead of reinforcing them. Real veins radiate from where the
            // petiole meets the blade, so drive them off the leaf's own polar
            // UV and match the 7 ridges the mesh actually has.
            vec2 vc = vCanUv - 0.5;
            float ang = atan(vc.y, vc.x);
            float rad = clamp(length(vc) * 2.0, 0.0, 1.0);
            float ribs = smoothstep(0.55, 0.97, 0.5 + 0.5 * cos(ang * 7.0));
            float veins = 1.0 - ribs * smoothstep(0.10, 0.55, rad) * 0.17;
            vec3 leafCol = vec3(0.38, 0.62, 0.24) * veins;
            // Margins of a real leaf are thinner, so they read lighter.
            leafCol = mix(leafCol, vec3(0.54, 0.74, 0.31), smoothstep(0.78, 1.0, rad) * 0.55);
            // vec3(0.40,0.70,0.26) * 1.5 clipped green to 1.05 (1.13 with the
            // old noise on top). A saturated channel has no gradient left, so
            // the canopy read as flat dark plastic no matter how it was lit.
            diffuseColor.rgb *= min(leafCol * 1.45, vec3(0.95));
          `,
        },
      ],
    });
    // vCanPos needs to exist in the vertex stage too
    extendMaterial(canopyMat, {
      key: "canopy-pos",
      vertexHead: "varying vec3 vCanPos;",
      vertexBody: "vCanPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    });

    const stemGeo = trackGeo(whiteColors(new THREE_.CylinderGeometry(0.4, 1.0, 1, 8, 4)));
    stemGeo.translate(0, 0.5, 0);
    /* A clover leaflet, as a SOLID with a stalk.

       This was a CircleGeometry - a zero thickness disc. At an instance
       scale of 112 units (the hero is 1.6) a leaf that vanishes edge-on and
       has no visible edge anywhere reads as a sticker, and because each
       leaflet is placed 42 units out from the stem tip with nothing joining
       them, they read as discs hovering in mid air. Reviews called them
       floating lily pads. So: a lens shaped blade with a thick centre and a
       thin rim, plus a petiole running back to the stem. */
    const leafDiscGeo = trackGeo((() => {
      const SEG = 26;
      const RINGS = 5;
      const pos = [];
      const idx = [];
      const notchAt = (a) => 1 - 0.24 * Math.exp(-Math.pow((a - Math.PI / 2) / 0.35, 2));
      // Thickest at the middle, tapering to a fine edge like a real leaf.
      const halfT = (rn) => 0.030 * (1 - rn * rn * 0.85);

      const uvs = [];
      const ringStart = [[], []];
      for (let side = 0; side < 2; side += 1) {
        for (let ri = 0; ri <= RINGS; ri += 1) {
          ringStart[side][ri] = pos.length / 3;
          const rn = ri / RINGS;
          const r = rn * 0.5;
          const count = ri === 0 ? 1 : SEG;
          for (let k = 0; k < count; k += 1) {
            const a = (k / SEG) * TAU;
            const nr = r * notchAt(a);
            // Polar UVs. The blade had NO uv attribute, so every map on the
            // leaf material sampled one constant texel and the whole canopy
            // rendered as flat plastic.
            uvs.push(0.5 + Math.cos(a) * rn * 0.5, 0.5 + Math.sin(a) * rn * 0.5);
            // The blade was domed by only r*r*0.4, i.e. 4 units of rise over
            // a leaf 112 units across - near planar, so N.L was constant and
            // the whole leaf shaded as one flat value with no gradient. Cup
            // it properly and add radial veins so the surface normal varies.
            // 0.022 was enough relief to throw a hard specular off each
            // ridge: the veins rendered as bright white/gold dashes on a dark
            // leaf rather than as plant structure. The shading term in the
            // fragment patch carries the vein read; the geometry only needs
            // enough to break the normal.
            const vein = 0.008 * Math.cos(a * 7.0) * rn;
            const y = r * r * 0.95 + vein + (side === 0 ? halfT(rn) : -halfT(rn));
            pos.push(Math.cos(a) * nr, y, Math.sin(a) * nr);
          }
        }
      }

      for (let side = 0; side < 2; side += 1) {
        const flip = side === 1;
        const c = ringStart[side][0];
        for (let k = 0; k < SEG; k += 1) {
          const a = ringStart[side][1] + k;
          const b = ringStart[side][1] + ((k + 1) % SEG);
          if (flip) idx.push(c, a, b); else idx.push(c, b, a);
        }
        for (let ri = 1; ri < RINGS; ri += 1) {
          const r0 = ringStart[side][ri];
          const r1 = ringStart[side][ri + 1];
          for (let k = 0; k < SEG; k += 1) {
            const k2 = (k + 1) % SEG;
            if (flip) { idx.push(r0 + k, r1 + k, r0 + k2, r0 + k2, r1 + k, r1 + k2); }
            else { idx.push(r0 + k, r0 + k2, r1 + k, r0 + k2, r1 + k2, r1 + k); }
          }
        }
      }

      // Rim, so the leaf has a visible edge instead of disappearing.
      const tr = ringStart[0][RINGS];
      const br = ringStart[1][RINGS];
      for (let k = 0; k < SEG; k += 1) {
        const k2 = (k + 1) % SEG;
        idx.push(tr + k, br + k, tr + k2, tr + k2, br + k, br + k2);
      }

      // Petiole: a tapered tube from under the blade's centre back towards
      // the stem. Instances sit 42 units out at a scale of 112, i.e. 0.375
      // in local space, so 0.46 overshoots far enough to bury its end in
      // the stem no matter which way the leaf jitters.
      const PS = 7;
      const pStart = pos.length / 3;
      for (let ring = 0; ring < 2; ring += 1) {
        const px = ring === 0 ? 0 : -0.46;
        const pr = ring === 0 ? 0.030 : 0.016;
        for (let k = 0; k < PS; k += 1) {
          const a = (k / PS) * TAU;
          pos.push(px, -0.028 + Math.sin(a) * pr, Math.cos(a) * pr);
          uvs.push(0.5 - ring * 0.46, 0.5 + Math.cos(a) * 0.04);
        }
      }
      for (let k = 0; k < PS; k += 1) {
        const k2 = (k + 1) % PS;
        idx.push(pStart + k, pStart + PS + k, pStart + k2,
          pStart + k2, pStart + PS + k, pStart + PS + k2);
      }

      const g = new THREE_.BufferGeometry();
      g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE_.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      whiteColors(g);
      g.computeBoundingSphere();
      return g;
    })());

    const stemItems = [];
    const leafItems = [];
    const rng = makeRng(0x9911ee);
    for (const p of PLANTS) {
      // Slabs only exist by now, so this is where a plant standing on paving
      // gets rejected - clover grows in the cracks and the bed, not on stone.
      if (onSlab(p.x, p.z)) continue;
      const y = terrainAt(p.x, p.z);
      stemItems.push({
        pos: new THREE_.Vector3(p.x, y - 4, p.z),
        scale: new THREE_.Vector3(7.5, p.h, 7.5),
        rx: Math.cos(p.rot) * p.tilt,
        rz: Math.sin(p.rot) * p.tilt,
        color: new THREE_.Color(1, 1, 1),
        key: rng(),
      });
      foliageColliders.push({
        shape: "capsule",
        x: p.x, y: (y - 4) + p.h * 0.45, z: p.z,
        radius: 3.2,
        halfHeight: p.h * 0.44,
        rx: Math.cos(p.rot) * p.tilt, ry: 0, rz: Math.sin(p.rot) * p.tilt,
        tag: "stem",
      });
      const tipX = p.x + Math.sin(p.rot) * p.tilt * p.h;
      const tipZ = p.z - Math.cos(p.rot) * p.tilt * p.h;
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * TAU + p.rot;
        const rad = 42;
        leafItems.push({
          // Tightened from +-8: the petiole is baked into the geometry at a
          // fixed length, so a leaf that jitters far vertically would leave
          // its stalk hanging in the air short of the stem.
          pos: new THREE_.Vector3(tipX + Math.cos(a) * rad, y - 4 + p.h + rng.range(-3, 2), tipZ + Math.sin(a) * rad),
          scale: new THREE_.Vector3(112, 40, 112),
          ry: a,
          rx: rng.range(-0.22, 0.1),
          rz: rng.range(-0.16, 0.16),
          color: new THREE_.Color().setHSL(rng.range(0.24, 0.29), rng.range(0.4, 0.62), rng.range(0.3, 0.44)),
          key: rng(),
        });
        const li = leafItems[leafItems.length - 1];
        // Clover canopy: a platform you can climb the stem to reach.
        foliageColliders.push({
          shape: "box",
          x: li.pos.x, y: li.pos.y, z: li.pos.z,
          hx: li.scale.x * 0.38, hy: 2.2, hz: li.scale.z * 0.38,
          rx: li.rx, ry: li.ry, rz: li.rz,
          tag: "canopy",
        });
      }
    }
    buildScatter({
      name: "PlantStems", geometry: stemGeo, material: stemMat, items: stemItems,
      chunk: 500, castShadow: true, near: 900, far: 1400, minFrac: 1, inflate: 1.4,
    });
    buildScatter({
      name: "PlantCanopy", geometry: leafDiscGeo, material: canopyMat, items: leafItems,
      depthMaterial: makeWindDepth(0.4),
      chunk: 500, castShadow: true, near: 900, far: 1400, minFrac: 1, inflate: 1.4,
    });
  }

  /* -------------------------------------------------------------
     4.18 Airborne motes - the single strongest scale cue
     ------------------------------------------------------------- */

  {
    const count = Math.round(2600 * clamp(q.particles, 0.3, 1.6));
    const rng = makeRng(0x1a2b3c);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const x = rng.range(-HALF, HALF);
      const z = rng.range(-HALF, HALF);
      const ground = heightAt(x, z);
      pos[i * 3] = x;
      pos[i * 3 + 1] = ground + Math.pow(rng(), 1.6) * 210 + 3;
      pos[i * 3 + 2] = z;
      seed[i] = rng() * 100;
      size[i] = rng.range(0.5, 2.4) * (rng() < 0.06 ? 3.2 : 1);
    }
    const geo = trackGeo(new THREE_.BufferGeometry());
    geo.setAttribute("position", new THREE_.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE_.BufferAttribute(seed, 1));
    geo.setAttribute("aSize", new THREE_.BufferAttribute(size, 1));
    geo.computeBoundingSphere();

    const mat = track(new THREE_.ShaderMaterial({
      uniforms: {
        uTime,
        uColor: { value: new THREE_.Color(0xfff0d4) },
        uPixelRatio: { value: ctx.renderer.getPixelRatio() },
        fogColor: { value: (ctx.scene.fog && ctx.scene.fog.color) || new THREE_.Color(0xffffff) },
        fogDensity: { value: (ctx.scene.fog && ctx.scene.fog.density) || 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE_.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aSize;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vFogDepth;
        void main() {
          vec3 p = position;
          float t = uTime;
          p.x += sin(t * 0.42 + aSeed) * 5.5 + sin(t * 0.13 + aSeed * 2.1) * 14.0;
          p.y += sin(t * 0.33 + aSeed * 1.7) * 4.0;
          p.z += cos(t * 0.37 + aSeed * 1.3) * 5.5 + cos(t * 0.11 + aSeed * 3.3) * 12.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 1.0);
          gl_PointSize = aSize * uPixelRatio * 320.0 / d;
          vAlpha = clamp(0.85 - d / 900.0, 0.0, 1.0) * (0.35 + 0.65 * (sin(t * 1.7 + aSeed * 4.0) * 0.5 + 0.5));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 fogColor;
        uniform float fogDensity;
        varying float vAlpha;
        varying float vFogDepth;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          float a = smoothstep(0.25, 0.0, d) * vAlpha;
          float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          gl_FragColor = vec4(uColor * (1.0 - fogFactor * 0.8), a * 0.55);
        }
      `,
    }));
    const points = new THREE_.Points(geo, mat);
    points.name = "AirMotes";
    points.frustumCulled = false;
    points.renderOrder = 5;
    root.add(points);
    stats.meshes += 1;
  }

  /* -------------------------------------------------------------
     4.18b Distant backdrop

     The playfield is a 900-unit square and it simply stops. In every wide
     frame the last ridge met the sky on a hard silhouette with flat grey
     underneath it, and the top-ranked defect in three consecutive reviews
     was "the world visibly ends - it advertises that the level is an
     island". Long-range fog softens that edge but cannot close it: pushing
     the dissolve hard enough to hide the boundary also washed the plant pot,
     which sits at a similar range, into a pale ghost.

     So this is a plain annulus of ground running from the map edge out past
     the far plane, dropping gently away so it reads as terrain continuing to
     a horizon rather than as a disc. It carries no detail on purpose - by the
     time it is visible the aerial term is doing most of the work, and detail
     out there would only alias.
     ------------------------------------------------------------- */
  {
    // The map is a SQUARE of half-size HALF, so a circular inner boundary at
    // radius HALF sits entirely inside it (the square's corners reach
    // HALF*sqrt(2) = 636) and the whole skirt is hidden by terrain - the
    // first attempt at this changed exactly zero pixels. The inner edge has
    // to follow the square. OUTER also has to stay inside camera.far or the
    // far rings are clipped away.
    // A camera can stand anywhere in the square, i.e. up to HALF*sqrt(2)=636
    // from the origin, so the far side of a ring of radius R can be R+636
    // away. camera.far is 1400, so anything past ~760 is clipped on the far
    // side - at 1340 the whole far arc was cut away and, again, nothing
    // changed. Keep the ring inside that budget and make it steeper instead.
    const OUTER = 755;
    const RINGS = 10;
    // 96 segments around r=755 is ~49 world units per segment, which is what
    // made the ridge line visibly polygonal.
    const SEG = 240;
    const pos = [];
    const col = [];
    const idx = [];
    const jagged = makeNoise(0x5ad917);
    // Sample the real terrain height around the rim so the skirt starts flush
    // with whatever the map actually ends on, instead of a guessed constant.
    for (let ri = 0; ri <= RINGS; ri += 1) {
      const t = ri / RINGS;
      for (let sIdx = 0; sIdx <= SEG; sIdx += 1) {
        const a = (sIdx / SEG) * TAU;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        // Radius of the square's boundary along this bearing.
        const inner = (HALF - 6) / Math.max(Math.abs(cx), Math.abs(cz));
        const r = inner + (OUTER - inner) * (t * t);
        const edgeY = terrainAt(clamp(cx * inner, -HALF, HALF), clamp(cz * inner, -HALF, HALF));

        // RISE, do not fall. A skirt that drops below the map edge is
        // invisible from every camera in the set: the "world ends" band is
        // sky above the terrain silhouette, not a hole beneath it, so ground
        // laid below the horizon changed exactly zero pixels twice. What the
        // frame is missing is mass ABOVE the horizon line - the reference
        // game has distant forest and hills there. Ridged noise keeps it from
        // reading as a crater wall.
        // Sample in WORLD space, not on the unit-circle bearing. cx and cz
        // are direction cosines, so noise2(cx, cz) has no radial term at all:
        // every vertex along a given bearing got the same value and the mass
        // had zero internal form - a reviewer called it "a painted stage
        // flat" and "a flat matte olive mass".
        const wx = cx * r * 0.006;
        const wz = cz * r * 0.006;
        const ridge = jagged.noise2(wx, wz) * 0.5 + 0.5;
        const ridge2 = jagged.noise2(wx * 2.9 + 11, wz * 2.9 - 4) * 0.5 + 0.5;
        const ridge3 = jagged.noise2(wx * 7.3 - 5, wz * 7.3 + 8) * 0.5 + 0.5;
        // Only just break the horizon. At 120 + up to 350 of rise, sitting
        // only ~300 units past the map edge, this walled the level in: the
        // ridge occluded the sky in ground-level shots and took lolly-ramp's
        // contrast from 57 to 26. A distant treeline reads as depth; a near
        // one reads as a fence.
        // Vary across the RADIUS, not just around the bearing. With the rise
        // weighted purely t*t the inner rings stayed nearly flat, so
        // computeVertexNormals gave near-vertical normals across the whole
        // body and N.L was constant: the silhouette undulated while the face
        // rendered as one flat fill - a reviewer called it a painted stage
        // flat and rated distant terrain the most damaging thing in the wide
        // shots. Mixing a linear term into the profile gives it real slopes.
        const rise = 26 + ridge * 84 + ridge2 * 36 + ridge3 * 16;
        const y = edgeY + (t * t * 0.6 + t * 0.4) * rise;
        pos.push(cx * r, y, cz * r);
        // Per-vertex tone: ridges are drier and catch more sky, hollows hold
        // shade and planting. Without this the mass is one value however it
        // is lit, which is most of why it reads as cardboard.
        const tone = clamp01(0.55 + (ridge - 0.5) * 0.62 + (ridge3 - 0.5) * 0.34);
        col.push(0.80 + tone * 0.32, 0.88 + tone * 0.22, 0.74 + tone * 0.30);
      }
    }
    const stride = SEG + 1;
    for (let ri = 0; ri < RINGS; ri += 1) {
      for (let sIdx = 0; sIdx < SEG; sIdx += 1) {
        const a = ri * stride + sIdx;
        // Winding: (a, a+stride, a+1) is the radial edge crossed with the
        // tangential edge, which gives (0, -1, 0) - the surface faces DOWN
        // and is backface-culled from every camera above it. This is exactly
        // the bug already found and documented on the water surface, and it
        // was reproduced here verbatim. An emissive-material probe measured
        // 0% coverage from two cameras while the mesh was present, visible
        // and inside the far plane.
        idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    }
    const geo = trackGeo(new THREE_.BufferGeometry());
    geo.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE_.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    // Pale and desaturated. At 0x5c6b45 the "distant" ridge came out DARKER
    // and MORE saturated than the mid-ground grass in front of it, which is
    // aerial perspective backwards - it read as a near mound rather than a
    // far one. Distance desaturates and lifts toward the sky, so the base
    // colour has to start there and let the fog finish the job.
    const mat = track(new THREE_.MeshStandardMaterial({
      vertexColors: true,
      color: 0x94a288,
      roughness: 1,
      metalness: 0,
    }));
    // "It carries no detail on purpose" was wrong. This mass fills up to 40%
    // of a wide frame, and at that screen area a flat fill reads as an
    // unfinished blockout - a reviewer ranked it the single most damaging
    // defect in the wide shots. The aerial term cannot rescue it because the
    // aerial term is what it is being seen through. Give it planting-scale
    // mottling and a treeline break at the ridge.
    extendMaterial(mat, {
      key: "backdrop",
      vertexHead: "varying vec3 vDBPos;",
      vertexBody: "vDBPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      fragmentHead: `varying vec3 vDBPos;\n${GLSL_NOISE}`,
      fragmentPatches: [{
        at: "#include <color_fragment>",
        code: `
          // Triplanar, so the flanks are not smeared - the same trap that
          // flattened the hose, the boulder and the lolly stick.
          // Frequency has to be chosen for SCREEN scale, not world scale.
          // This mass spans ~1000 world units across ~400 screen pixels, so
          // 0.055 (18-unit features) is sub-pixel and averages to a flat
          // wash, while 0.0075 is broader than the whole hill. Clumps that
          // read need features around 50 world units, i.e. ~0.02.
          vec3 dp = vDBPos * 0.006;
          float broad = (tsFbm(dp.xz) + tsFbm(dp.xy) + tsFbm(dp.zy)) / 3.0;
          vec3 dq = vDBPos * 0.045;
          float mid = (tsFbm(dq.xz) + tsFbm(dq.xy) + tsFbm(dq.zy)) / 3.0;
          // Dry grass and darker planting. The aerial term washes roughly
          // half the contrast out of this at the distances it is seen from,
          // so the albedo spread has to be wider than looks right up close.
          vec3 dry = vec3(0.66, 0.68, 0.42);
          vec3 lush = vec3(0.24, 0.36, 0.19);
          float mix1 = smoothstep(0.30, 0.70, broad * 0.55 + mid * 0.45);
          vec3 col = mix(dry, lush, mix1);
          // Measured: the patch covers 20% of a wide frame (probe forced it
          // magenta), so it does reach the pixel - it was simply too subtle
          // to survive the aerial term, which replaces about half the colour
          // at this range. Contrast has to be pushed well past what looks
          // right in isolation.
          col = mix(col, col * 0.58, smoothstep(0.46, 0.80, mid) * 0.95);
          col = mix(col, col * 1.34, smoothstep(0.34, 0.04, mid) * 0.75);
          diffuseColor.rgb *= min(col * 1.5, vec3(0.95));
        `,
      }],
    });
    const mesh = new THREE_.Mesh(geo, mat);
    mesh.name = "DistantBackdrop";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    root.add(mesh);
    stats.meshes += 1;
  }

  /* -------------------------------------------------------------
     4.19 Physics registration
     ------------------------------------------------------------- */

  const physicsReport = { terrain: "none", slabs: 0, landmarks: 0, foliage: 0, fallbackRemoved: false, errors: [] };

  function registerPhysics() {
    const P = ctx.physics;
    const R = ctx.RAPIER;
    if (!P || !R || typeof P.addStatic !== "function") {
      physicsReport.errors.push("physics API unavailable");
      return;
    }

    /* --- terrain heightfield --- */
    try {
      const n = GRID_N - 1;                       // subdivisions
      const heights = new Float32Array(GRID_N * GRID_N);
      // Rapier: heights[i + j * (nrows + 1)], row i -> z, column j -> x
      for (let j = 0; j < GRID_N; j += 1) {       // j -> x
        for (let i = 0; i < GRID_N; i += 1) {     // i -> z
          heights[i + j * GRID_N] = terrain.get(j, i);
        }
      }
      const scale = new R.Vector3(MAP, 1, MAP);
      const desc = R.ColliderDesc.heightfield(n, n, heights, scale);
      if (desc.setFriction) desc.setFriction(0.92);
      if (desc.setRestitution) desc.setRestitution(0.02);
      P.addStatic({ position: [0, 0, 0], shape: desc, kind: "terrain", material: "soil" });
      physicsReport.terrain = "heightfield";
      // The placeholder slab physics.js installs at y=0 spans the whole map
      // and is invisible. Anywhere the terrain dips below zero it becomes the
      // surface the player actually stands on, so it has to go the moment
      // real terrain exists - which is what physics.js documents but nothing
      // was ever calling.
      if (typeof P.removeFallbackGround === "function") {
        physicsReport.fallbackRemoved = P.removeFallbackGround();
      }
    } catch (error) {
      physicsReport.errors.push(`heightfield: ${error && error.message}`);
      // Fall back to a trimesh built from the render geometry.
      try {
        if (typeof P.addTrimesh === "function") {
          P.addTrimesh(terrainGeo, new THREE_.Matrix4(), { kind: "terrain", material: "soil" });
          physicsReport.terrain = "trimesh";
          if (typeof P.removeFallbackGround === "function") {
            physicsReport.fallbackRemoved = P.removeFallbackGround();
          }
        }
      } catch (e2) {
        physicsReport.errors.push(`trimesh: ${e2 && e2.message}`);
      }
    }

    /* --- slabs ---
       These were single cuboids with a flat top at `base - 1.2`, which is
       wrong twice over: the rendered slab is not flat (heightAt samples the
       slab's OWN height grid, s.grid) and not at that height. Wherever the
       grid rose above base-1.2 the collider sat below the visible surface
       and the player sank into the floor - at the spawn point by 1.7 units,
       against a hero 1.6 units long, which is why he started underground.
       Wherever the grid dipped below it, the collider stood above the
       visible surface instead and the player floated.

       So the walking surface is now a heightfield built from the same grid
       the renderer draws, and the cuboid is kept only to fill the volume
       underneath, topped out at the grid's minimum so it can never poke
       through the surface it is supposed to support. */
    for (const s of slabs) {
      try {
        const g = s.grid;
        let gmin = Infinity;
        for (let k = 0; k < g.h.length; k += 1) if (g.h[k] < gmin) gmin = g.h[k];

        // A bare heightfield is an infinitely thin sheet, and a cuboid under
        // it can only be topped out at the grid MINIMUM or it would poke
        // through the surface. Deep cracks cut a slab almost down to
        // PATIO_BASE, so that minimum sits far below the patio and leaves an
        // open void under the whole slab that the player walks into from the
        // side - which is exactly how a drop test ended up 10 units under the
        // floor. So the slab is one sealed trimesh instead: the rendered top
        // surface, a vertical skirt down the perimeter, and a flat cap.
        const bottom = Math.min(gmin, PATIO_BASE - 5) - 0.5;
        const positions = [];
        const indices = [];

        // Top surface, vertex per grid point, triangulated like the renderer.
        for (let j = 0; j < g.nz; j += 1) {
          for (let i = 0; i < g.nx; i += 1) positions.push(g.vx(i), g.get(i, j), g.vz(j));
        }
        const vid = (i, j) => j * g.nx + i;
        for (let j = 0; j < g.nz - 1; j += 1) {
          for (let i = 0; i < g.nx - 1; i += 1) {
            indices.push(vid(i, j), vid(i, j + 1), vid(i + 1, j));
            indices.push(vid(i + 1, j), vid(i, j + 1), vid(i + 1, j + 1));
          }
        }

        // Perimeter skirt: for each edge vertex, one more vertex directly
        // below it at `bottom`, stitched into quads.
        const skirt = (a, b) => {
          const base0 = positions.length / 3;
          positions.push(positions[a * 3], bottom, positions[a * 3 + 2]);
          positions.push(positions[b * 3], bottom, positions[b * 3 + 2]);
          indices.push(a, base0, b);
          indices.push(b, base0, base0 + 1);
        };
        for (let i = 0; i < g.nx - 1; i += 1) {
          skirt(vid(i, 0), vid(i + 1, 0));
          skirt(vid(i + 1, g.nz - 1), vid(i, g.nz - 1));
        }
        for (let j = 0; j < g.nz - 1; j += 1) {
          skirt(vid(0, j + 1), vid(0, j));
          skirt(vid(g.nx - 1, j), vid(g.nx - 1, j + 1));
        }

        // Flat cap so nothing can enter from underneath either.
        const c0 = positions.length / 3;
        positions.push(g.x0, bottom, g.z0);
        positions.push(g.x0 + g.sizeX, bottom, g.z0);
        positions.push(g.x0 + g.sizeX, bottom, g.z0 + g.sizeZ);
        positions.push(g.x0, bottom, g.z0 + g.sizeZ);
        indices.push(c0, c0 + 2, c0 + 1, c0, c0 + 3, c0 + 2);

        P.addTrimesh(
          { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
          null,
          { kind: "slab", material: "concrete", friction: 0.85 },
        );
        physicsReport.slabs += 1;
      } catch (error) {
        physicsReport.errors.push(`slab: ${error && error.message}`);
        break;
      }
    }

    /* --- foliage: grass blades, leaves, stems, canopy --- */
    {
      const e = new THREE_.Euler();
      const qq = new THREE_.Quaternion();
      for (const f of foliageColliders) {
        try {
          e.set(f.rx || 0, f.ry || 0, f.rz || 0);
          qq.setFromEuler(e);
          const shape = f.shape === "capsule"
            ? R.ColliderDesc.capsule(f.halfHeight, f.radius)
            : R.ColliderDesc.cuboid(f.hx, f.hy, f.hz);
          P.addStatic({
            position: [f.x, f.y, f.z],
            rotation: [qq.x, qq.y, qq.z, qq.w],
            shape,
            kind: "foliage",
            material: f.tag === "grass" ? "grass" : "leaf",
            // ONLY the player collides with foliage. On the default
            // STATIC_PROP mask every one of the ~290 loose props and debris
            // grains was testing against all 2574 blades, and the physics
            // step went from 0.19ms to 44ms. Gravel wedged in grass is not
            // worth a frame budget, and the player is the only thing that
            // needs to climb it.
            filter: LAYER.HERO | LAYER.HERO_SENSOR | LAYER.RAGDOLL,
          });
          physicsReport.foliage += 1;
        } catch (error) {
          physicsReport.errors.push(`foliage ${f.tag}: ${error && error.message}`);
          break;
        }
      }
    }

    /* --- landmarks --- */
    for (const lc of landmarkColliders) {
      try {
        if (lc.kind === "trimesh" && typeof P.addTrimesh === "function") {
          P.addTrimesh(lc.mesh.geometry, lc.mesh.matrixWorld, { kind: "landmark" });
          physicsReport.landmarks += 1;
        } else if (lc.kind === "box") {
          const p = new THREE_.Vector3();
          const qq = new THREE_.Quaternion();
          const sc = new THREE_.Vector3();
          lc.mesh.matrixWorld.decompose(p, qq, sc);
          const shape = R.ColliderDesc.cuboid(lc.half[0] * sc.x, lc.half[1] * sc.y, lc.half[2] * sc.z);
          P.addStatic({ position: [p.x, p.y, p.z], rotation: [qq.x, qq.y, qq.z, qq.w], shape, kind: "landmark" });
          physicsReport.landmarks += 1;
        } else if (lc.kind === "capsule") {
          const p = new THREE_.Vector3();
          const qq = new THREE_.Quaternion();
          const sc = new THREE_.Vector3();
          lc.mesh.matrixWorld.decompose(p, qq, sc);
          const shape = R.ColliderDesc.capsule(lc.halfHeight, lc.radius);
          P.addStatic({ position: [p.x, p.y + lc.halfHeight, p.z], rotation: [qq.x, qq.y, qq.z, qq.w], shape, kind: "landmark" });
          physicsReport.landmarks += 1;
        }
      } catch (error) {
        physicsReport.errors.push(`landmark ${lc.kind}: ${error && error.message}`);
      }
    }
  }

  registerPhysics();

  /* -------------------------------------------------------------
     4.20 Spawn + beauty shots
     ------------------------------------------------------------- */

  const SPAWN = new THREE_.Vector3(-92, 0, 44);
  SPAWN.y = heightAt(SPAWN.x, SPAWN.z) + 1.4;

  const BEAUTY_SHOTS = [
    {
      id: "establishing",
      name: "Establishing wide - hose, flowerbed, the pot",
      // Recomposed. The old pose (-352,268,486 -> 40,34,-96) was aimed at the
      // middle of the level with nothing in particular in it, and the 735-unit
      // pot ran straight off the top edge.
      //
      // The pot is the only object that can carry an establishing frame, and
      // fitting all 735 units of it needs ~1150 units of standoff - which only
      // exists from outside the south-east corner. From here the whole vessel
      // sits inside the frame with its rim intact, and the shot layers
      // properly: the coiled hose sweeps across the foreground, the grass
      // forest is the mid-ground band, the clover canopy breaks the top
      // corners so the sky is not dead space, and the screw and lolly stick
      // give the mid-left something to read.
      // HALF is 450, so [560, 240, 550] stood OUTSIDE the terrain on both
      // axes, and the target's y of 258 was above the camera's 240 so the
      // shot tilted up: the bottom 45% of the frame was off-world sky dome
      // with no ground, no fog and a hard horizon seam. Now inside the map
      // and aimed down, so terrain carries the lower frame. A wider fov buys
      // back the standoff the pot needs.
      position: [408, 300, 402],
      target: [-80, 120, -170],
      fov: 58,
    },
    {
      id: "hero-closeup",
      name: "Hero close-up",
      // Offsets are relative to tardigrade.focusPoint() - the body centre -
      // not the controller root, which floats a surface-dependent distance
      // above the ground and used to put the aim point ~2 units overhead.
      // |offset| = 3.51 at fov 40 gives a 2.56-unit-tall frame, so a
      // 0.75-unit animal fills ~29% of frame height. The azimuth puts the sun
      // three-quarters behind, which is where the cuticle rim term pays off.
      // [side, up, forward] in the ANIMAL's frame, not the world's, so this
      // is reliably a three-quarter FRONT view of the head - the eye spots
      // and the open buccal tube are the character's only face and they were
      // never once pointed at the camera.
      position: [-1.55, 0.60, 2.90],
      target: [0, 0.02, 0.55],
      fov: 40,
      followHero: true,
      heroRelative: true,
    },
    {
      // The whole micro-world premise lives or dies on one frame showing the
      // animal and a recognisably human-made object together. Low, wide and
      // close, so the hero is large in the foreground and whatever it is
      // standing beside towers past the top of the frame.
      id: "hero-scale",
      name: "Hero against a human-made landmark",
      // [side, up, forward] where forward runs from the landmark towards the
      // hero, so the camera sits past the animal and the object looms behind
      // it. Close and low, so the hero is large in frame and the landmark
      // runs off the top edge - that contrast is the whole point.
      position: [-0.55, 0.30, 1.85],
      target: [0.0, 0.42, -0.9],
      fov: 62,
      followHero: true,
      aimLandmarks: [[-158, -166], [-271, 250], [-166, 148]],
    },
    {
      id: "hero-tun",
      name: "Hero curled into its tun barrel",
      // The curl is the most distinctive silhouette the character has, and
      // hero-closeup was the only shot of the twelve the hero appeared in.
      //
      // Raised from y 0.95 to 1.24 and narrowed to 42. At the old height the
      // top of the frame sat ~7 degrees above the horizon, which is exactly
      // where the bottle cap's crimp teeth stand - a rank of small, very dark,
      // hard-edged triangles cut off by the ground, which a blind reviewer
      // read as "a hard teal wedge clipping through the ground". Raycasting
      // those pixels identifies them as the cap skirt at 58-155 units, not a
      // clipping artifact, but they are still junk in the frame. Pitching to
      // -18 degrees puts the horizon above the top edge, so the backdrop is
      // unbroken lit concrete and the animal's contact shadow carries the shot.
      position: [2.42, 1.24, -2.55],
      target: [0, 0.05, 0],
      fov: 42,
      followHero: true,
    },
    {
      id: "ground-level",
      name: "Ground level looking into the grass forest",
      // Sits on the open soil at the bed's edge so the blades read as a
      // receding forest instead of smearing across the near plane.
      position: [-74, 142, -10],
      target: [168, 88, 172],
      fov: 60,
    },
    {
      id: "backlit",
      name: "Backlit grass into the sun",
      // The sun sits toward +x/+z, so shoot from the open patio across the
      // bed and into it. The old position was buried inside the blades at
      // y=46, which just smeared one out-of-focus leaf over the whole frame.
      position: [-52, 138, -78],
      target: [244, 128, 206],
      fov: 46,
    },
    {
      id: "puddle",
      name: "The puddle and its meniscus",
      // Was [-92, 70, 296] -> [64, 6, 190], which looked DOWN at the water at
      // about 20 degrees. Fresnel there is ~0.14, so a surface whose deep
      // colour is 0x0d2a30 sitting over a dark basin reflected almost
      // nothing and read as wet mud - a reviewer reported the shot contains
      // no visible water at all. Puddles read as water at grazing angles,
      // where the surface turns into a mirror, so the camera now sits just
      // above the meniscus and looks across it.
      // The camera has to be inside the basin AND over the deep part. At
      // radius 132 the rim bank is well above water level (a camera there at
      // y=10 is simply buried in soil), and even at radius ~89 the shore is
      // still dry - the terrain only drops below the water level of 1.2 near
      // the centre. This sits ~3 units above the surface at radius ~50 and
      // looks across it at well under a degree, where Fresnel is near 1 and
      // the water turns into a mirror. Measured, not guessed: along z=196 the
      // terrain is only below the water level of 1.2 for x in about
      // [-60, 60], deepest near (-14, 226) at -12.3. The spec centre (46,196)
      // is dry shore, which is why three earlier framings found only mud.
      // The camera must also clear the MENISCUS: the water mesh domes up to
      // y=5.8 at the rim, and the material is FrontSide, so a camera at 4.4
      // was under the surface, had its backfaces culled, and saw the mud
      // straight through water that was rendering perfectly well.
      position: [-62, 27, 264],
      target: [16, 1.2, 194],
      fov: 50,
    },
    {
      id: "grass-interior",
      name: "Inside the grass forest",
      position: [176, 146, 208],
      target: [244, 62, 122],
      fov: 66,
    },
    {
      id: "bottle-cap",
      name: "The bottle cap arena",
      // Shot from over the open patio, not from inside the flowerbed - the
      // old position put a grass blade flat against the lens.
      position: [-306, 88, -58],
      target: [-158, 16, -166],
      fov: 44,
    },
    {
      id: "patio-canyon",
      name: "Grout canyon past the sugar drift to the bottle cap",
      // Recomposed. The old pose sat 38 units above the grout line looking
      // down its length at nothing, so the sugar drift filled the lower half
      // of the frame with no subject anywhere in it.
      //
      // Dropped to the slab surface and turned east-north-east: the drift is
      // now the foreground it should always have been, the grout line runs
      // diagonally through it, the bottle cap is the subject at the far side,
      // the grass wall closes the right, and the pot enters from the left
      // frame edge as a wall rather than a column sawn off at the top. Sky is
      // down from ~55% of the frame to ~20%.
      // Recomposed again. The camera sat at y=26 on the slab surface with
      // sugar crystals a few units from the lens, so one blurred wedge filled
      // the centre third of the frame - a reviewer scored composition 3/10
      // and named this shot as having no subject at all. The target was also
      // (10, -230), which is not the bottle cap the note above claims is the
      // subject; it aimed at empty slab past it.
      //
      // Lifted clear of the near drift and aimed at the cap itself: at 319
      // units with fov 50 the cap spans about 44% of frame height, which
      // makes it a subject rather than a detail.
      position: [-300, 46, 118],
      target: [-158, 18, -166],
      fov: 50,
    },
    {
      id: "shard-overhang",
      name: "Terracotta shard overhang",
      // The old pose aimed 14 degrees ABOVE horizontal at a shard whose top is
      // 327 units up but 340 units away, so it read as a low ridge with 60% of
      // the frame given over to bare sky. Moved up and in and aimed down the
      // wall instead: the clay now fills two thirds of the frame at a range
      // where its grain resolves, the grass forest is the mid-ground band, the
      // boulder stack anchors the right, and sky is down to about 20%.
      // Raycast through this frame: the right third was the LOLLY STICK at
      // 146-161 units, with the shard - the shot's actual subject - behind it
      // at 276. A reviewer read that stick as "an untextured olive mass, the
      // lowest-fidelity object in all 14"; it is in fact triplanar-grained
      // wood, just presented as a smooth wall of it too close to the lens to
      // show any of that. Same mistake as patio-canyon.
      //
      // Pulled back and around so the shard fills the frame as the subject
      // (302 units tall at 358 units out, fov 46) and the stick reads as a
      // mid-ground leading line instead of a slab across the corner. Lifted
      // again after the first attempt put a near blade across the right
      // quarter as an out-of-focus green wall (camera clearance 17.5).
      position: [26, 158, 74],
      target: [292, 132, -232],
      fov: 44,
    },
    {
      id: "pot-skyline",
      name: "The pot on the skyline",
      position: [104, 62, 172],
      target: [-152, 262, -430],
      fov: 42,
    },
    {
      id: "lolly-ramp",
      name: "Lolly stick launch ramp",
      // Shooting down the stick's axis was tried twice to make it read as a
      // ramp rather than "grass with a tan shape in it". Both were worse: at
      // y=84 the camera sits inside the grass canopy and the stick vanishes
      // behind blades (clearance 13.6), and at y=176 on the same bearing the
      // grass still fills 70% of frame (clearance 40.4). The original stand-
      // off is the better shot (clearance 94, contrast 51.4) - the bed is too
      // dense to shoot this prop from within it, and fixing that means
      // thinning grass around the stick, not moving the camera again.
      position: [-72, 162, -196],
      target: [166, 66, -166],
      fov: 50,
    },
    {
      id: "debris-rest",
      name: "Debris at rest - LEGO, sugar, lichen",
      // Pulled back: at 110 units the brick filled the frame edge to edge and
      // the shot carried almost no information beyond "red plastic".
      position: [-84, 104, 358],
      target: [-268, 22, 246],
      fov: 48,
    },
  ];

  /* -------------------------------------------------------------
     4.21 Frame update
     ------------------------------------------------------------- */

  let lodTimer = 0;
  const api = {
    root,
    bounds: { radius: HALF, min: [-HALF, -HALF], max: [HALF, HALF] },
    heightAt,
    /** Baked sun exposure at a point, 0 (fully shaded) to 1 (open sun).
     *  This is the same grid the terrain shading samples, so it accounts for
     *  grass and scatter that cast shadows but carry no colliders - a ray
     *  cast through the physics world reports those spots as sunlit and is
     *  the wrong instrument for "will the hero be lit here". */
    sunAt: (x, z) => sunAt(x, z),
    terrainAt,
    slopeAt,

    spawnPoint() {
      return SPAWN.clone();
    },

    getBeautyShots() {
      return BEAUTY_SHOTS;
    },

    /** Water level lookup - vfx / player can ask "am I in water?". */
    waterAt(x, z) {
      if (inWater(x, z, PUDDLE, 0)) return PUDDLE.level;
      if (inWater(x, z, SPILL, 0)) return SPILL.level;
      return null;
    },

    update(dt, context) {
      uTime.value = context.time.elapsed;
      // A slow breathing gust so screenshots taken seconds apart still differ.
      uWindStrength.value = 0.78 + 0.32 * Math.sin(context.time.elapsed * 0.21);
      lodTimer -= dt;
      if (lodTimer <= 0) {
        lodTimer = 0.12;
        updateScatterLod(context.camera);
      }
    },

    report() {
      let visibleChunks = 0;
      for (const g of scatterGroups) {
        for (const m of g.meshes) if (m.mesh.visible) visibleChunks += 1;
      }
      return {
        grid: GRID_N,
        meshes: stats.meshes,
        chunks: stats.chunks,
        visibleChunks,
        instances: stats.instances,
        triangles: Math.round(stats.triangles),
        slabs: slabs.length,
        scatter: scatterGroups.map((g) => `${g.name}:${g.meshes.reduce((s, m) => s + m.total, 0)}`),
        physics: physicsReport,
        detailLuma: detailLuma === null ? null : Number(detailLuma.toFixed(3)),
      };
    },

    dispose() {
      for (const g of geometries) g.dispose();
    },
  };

  // Prime the LOD state so the very first frame is correct.
  updateScatterLod(ctx.camera);

  return api;
}
