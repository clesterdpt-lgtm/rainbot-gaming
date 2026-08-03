/* ============================================================
   Tardigrade Simulator - atmosphere, particles, water, decals, shake

   Owned by the "vfx agent".

   What lives here
   ---------------
   1. Airborne particulate  - two GPU-animated layers (fine dust points +
      tumbling pollen quads) wrapped in a camera-relative volume, so a
      few thousand instances read as "dust everywhere" with zero CPU work.
   2. Particle system       - pooled, data-driven, fully GPU-simulated
      billboard emitters. The CPU only writes a spawn record; the vertex
      shader integrates the trajectory analytically for the whole life.
   3. Effect library        - named presets fired from `ctx.events`
      (impact / player:land / player:jump / prop:destroyed / score ...).
   4. Water                 - meniscus-domed puddle surface with animated
      capillary ripples, reactive ripple rings, shoreline foam, fresnel
      and transmission.
   5. Decals                - pooled, terrain-conforming projected quads
      (wet footprints, soil scuffs, splats) that fade out.
   6. Camera shake          - trauma based (magnitude = trauma^2), driven
      by smooth value noise. player.js owns the camera and consumes the
      offset through `getShakeOffset()`.

   API published on ctx.vfx (see the header of createVfx for details).

   Notes for the other agents
   --------------------------
   * God rays / light shafts are NOT implemented here - engine.js owns
     post processing. The dust shading is tuned so motes flare hard when
     the view vector approaches the sun, which is what makes shafts read.
   * Soft particles: rather than a screen-space depth fade (which would
     require reaching into engine.js's composer and would fight the
     parallel post-processing work), every particle carries the ground
     height at its spawn point and the billboard is treated as a sphere
     in the fragment shader. The result is an analytic, view-independent
     soft intersection against the dominant surface. See SOFT PARTICLES
     below.
   ============================================================ */

import * as THREE from "three";
import { TAU, clamp, clamp01, lerp, makeRng, RollingAverage } from "./core.js";

/* ============================================================
   0. Small helpers
   ============================================================ */

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _v2a = new THREE.Vector2();
const _color = new THREE.Color();

/** hex (sRGB) -> linear working-space triple, matching three's colour management. */
function linRGB(hex, out) {
  _color.setHex(hex);
  out[0] = _color.r;
  out[1] = _color.g;
  out[2] = _color.b;
  return out;
}

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/* ============================================================
   1. Procedural sprite atlases
   ============================================================ */

/**
 * 2x2 atlas of alpha-only particle shapes. RGB stays white; every
 * particle tints through its vertex colour.
 *   0 soft volumetric puff     1 dense grain / droplet
 *   2 angular chip / shard     3 soft ring (shockwaves, splash crowns)
 */
function buildParticleAtlas(rng, cell = 256) {
  const atlas = makeCanvas(cell * 2);
  const g = atlas.getContext("2d");
  g.clearRect(0, 0, atlas.width, atlas.height);

  const tile = makeCanvas(cell);
  const t = tile.getContext("2d");
  const half = cell * 0.5;

  const drawTile = (index, paint) => {
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = "source-over";
    t.filter = "none";
    t.clearRect(0, 0, cell, cell);
    paint();
    g.drawImage(tile, (index % 2) * cell, Math.floor(index / 2) * cell);
  };

  /* --- 0: soft volumetric puff ------------------------------------ */
  drawTile(0, () => {
    for (let i = 0; i < 26; i += 1) {
      const a = rng() * TAU;
      const r = Math.pow(rng(), 0.65) * cell * 0.19;
      const x = half + Math.cos(a) * r;
      const y = half + Math.sin(a) * r;
      const rad = cell * (0.09 + rng() * 0.15);
      const grad = t.createRadialGradient(x, y, 0, x, y, rad);
      const peak = 0.16 + rng() * 0.2;
      grad.addColorStop(0, `rgba(255,255,255,${peak})`);
      grad.addColorStop(0.45, `rgba(255,255,255,${peak * 0.45})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      t.fillStyle = grad;
      t.fillRect(0, 0, cell, cell);
    }
    // Trim to a circle with a very soft edge so nothing ever shows a seam.
    t.globalCompositeOperation = "destination-in";
    const mask = t.createRadialGradient(half, half, cell * 0.06, half, half, half);
    mask.addColorStop(0, "rgba(255,255,255,1)");
    mask.addColorStop(0.62, "rgba(255,255,255,0.92)");
    mask.addColorStop(1, "rgba(255,255,255,0)");
    t.fillStyle = mask;
    t.fillRect(0, 0, cell, cell);
  });

  /* --- 1: dense grain / droplet ----------------------------------- */
  drawTile(1, () => {
    const grad = t.createRadialGradient(half, half, 0, half, half, half * 0.94);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.28, "rgba(255,255,255,0.94)");
    grad.addColorStop(0.62, "rgba(255,255,255,0.34)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    t.fillStyle = grad;
    t.fillRect(0, 0, cell, cell);
  });

  /* --- 2: angular chip -------------------------------------------- */
  drawTile(2, () => {
    t.filter = `blur(${Math.max(1, cell * 0.012)}px)`;
    t.fillStyle = "rgba(255,255,255,1)";
    t.beginPath();
    const points = 6;
    for (let i = 0; i < points; i += 1) {
      const a = (i / points) * TAU + rng() * 0.35;
      const r = half * (0.42 + rng() * 0.44);
      const x = half + Math.cos(a) * r;
      const y = half + Math.sin(a) * r;
      if (i === 0) t.moveTo(x, y);
      else t.lineTo(x, y);
    }
    t.closePath();
    t.fill();
  });

  /* --- 3: soft ring ------------------------------------------------ */
  drawTile(3, () => {
    const grad = t.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.05)");
    grad.addColorStop(0.74, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.88, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    t.fillStyle = grad;
    t.fillRect(0, 0, cell, cell);
  });

  return atlas;
}

/**
 * 2x2 decal atlas.
 *   0 claw footprint   1 scuff streak   2 splat   3 soft wet patch
 */
function buildDecalAtlas(rng, cell = 256) {
  const atlas = makeCanvas(cell * 2);
  const g = atlas.getContext("2d");
  g.clearRect(0, 0, atlas.width, atlas.height);

  const tile = makeCanvas(cell);
  const t = tile.getContext("2d");
  const half = cell * 0.5;

  const drawTile = (index, paint) => {
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = "source-over";
    t.filter = "none";
    t.clearRect(0, 0, cell, cell);
    paint();
    g.drawImage(tile, (index % 2) * cell, Math.floor(index / 2) * cell);
  };

  const blob = (x, y, rx, ry, rot, alpha) => {
    t.save();
    t.translate(x, y);
    t.rotate(rot);
    const grad = t.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.62, `rgba(255,255,255,${alpha * 0.72})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    t.fillStyle = grad;
    t.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    t.beginPath();
    t.arc(0, 0, Math.max(rx, ry), 0, TAU);
    t.fill();
    t.restore();
  };

  /* --- 0: footprint (a tardigrade lobopod pad + four claw dots) ---- */
  drawTile(0, () => {
    blob(half, half * 1.12, cell * 0.19, cell * 0.15, 0, 0.85);
    for (let i = 0; i < 4; i += 1) {
      const a = -Math.PI * 0.5 + (i - 1.5) * 0.42;
      blob(half + Math.cos(a) * cell * 0.2, half * 1.12 + Math.sin(a) * cell * 0.2,
        cell * 0.045, cell * 0.062, a + Math.PI * 0.5, 0.95);
    }
  });

  /* --- 1: scuff streak -------------------------------------------- */
  drawTile(1, () => {
    for (let i = 0; i < 34; i += 1) {
      const p = i / 33;
      const x = cell * (0.1 + p * 0.8);
      const y = half + Math.sin(p * 5.2) * cell * 0.05 + (rng() - 0.5) * cell * 0.07;
      const w = cell * (0.02 + 0.07 * Math.sin(p * Math.PI));
      blob(x, y, w * 1.9, w, 0, 0.5 + rng() * 0.35);
    }
  });

  /* --- 2: splat ---------------------------------------------------- */
  drawTile(2, () => {
    blob(half, half, cell * 0.26, cell * 0.23, rng() * TAU, 0.9);
    for (let i = 0; i < 11; i += 1) {
      const a = rng() * TAU;
      const r = cell * (0.24 + rng() * 0.19);
      blob(half + Math.cos(a) * r, half + Math.sin(a) * r,
        cell * (0.018 + rng() * 0.05), cell * (0.018 + rng() * 0.05), 0, 0.55 + rng() * 0.35);
    }
  });

  /* --- 3: soft wet patch ------------------------------------------ */
  drawTile(3, () => {
    for (let i = 0; i < 9; i += 1) {
      const a = rng() * TAU;
      const r = cell * rng() * 0.13;
      blob(half + Math.cos(a) * r, half + Math.sin(a) * r,
        cell * (0.2 + rng() * 0.14), cell * (0.19 + rng() * 0.13), rng() * TAU, 0.34);
    }
  });

  return atlas;
}

/* ============================================================
   2. Shared GLSL
   ============================================================ */

/** Common lighting + fog + "sphere billboard" maths for every sprite shader. */
const GLSL_COMMON = /* glsl */ `
  uniform vec3 uSunDir;      // unit vector pointing AT the sun
  uniform vec3 uSunColor;    // linear
  uniform vec3 uSkyColor;    // linear ambient
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamToward;   // unit vector pointing from the scene toward the camera
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  float vfxHash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  /* Treat the billboard as a sphere: returns the outward normal and the
     depth of the sphere surface toward the camera (0..1 of the radius). */
  vec3 vfxSphereNormal(vec2 local, out float bulge) {
    float r2 = min(dot(local, local), 1.0);
    bulge = sqrt(max(0.0, 1.0 - r2));
    return normalize(uCamRight * local.x + uCamUp * local.y + uCamToward * bulge);
  }

  /* Cheap two-lobe scattering: direct term + strong forward-scatter
     translucency, which is what makes airborne motes flare when backlit. */
  vec3 vfxScatter(vec3 n, float translucency) {
    float ndl = dot(n, uSunDir);
    vec3 lit = mix(uSkyColor, uSunColor, smoothstep(-0.45, 0.95, ndl));
    float forward = pow(max(0.0, dot(uCamToward, uSunDir)), 5.0);
    lit += uSunColor * forward * translucency;
    return lit;
  }

  float vfxFog(float viewDepth) {
    float f = uFogDensity * viewDepth;
    return 1.0 - exp(-f * f);
  }
`;

/* ============================================================
   3. Trauma-based camera shake
   ============================================================ */

class ShakeRig {
  constructor() {
    this.trauma = 0;
    this.decay = 1.8;
    this.time = 0;
    this.offset = new THREE.Vector3();
    this.euler = new THREE.Euler();
    this.amount = 0;
    this._seed = 17.13;
  }

  /** Smooth 1D value noise in [-1, 1]. */
  _noise(x, channel) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = this._rand(i, channel);
    const b = this._rand(i + 1, channel);
    return lerp(a, b, u) * 2 - 1;
  }

  _rand(i, channel) {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(channel | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  add(intensity, duration) {
    const amount = clamp01(intensity);
    if (amount <= 0) return;
    this.trauma = clamp01(this.trauma + amount);
    const rate = 1 / Math.max(0.06, duration || 0.42);
    // A long shake must not be cut short by a preceding short one.
    this.decay = Math.min(this.decay, rate);
  }

  update(dt) {
    this.time += dt;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.decay * dt);
      if (this.trauma === 0) this.decay = 1.8;
    } else {
      this.decay = 1.8;
    }

    // Magnitude is trauma squared: shakes fall off perceptually, not linearly.
    const shake = this.trauma * this.trauma;
    this.amount = shake;
    if (shake <= 0.0001) {
      this.offset.set(0, 0, 0);
      this.euler.set(0, 0, 0);
      return;
    }

    const t = this.time;
    const fast = t * 21.0;
    const slow = t * 8.5;
    this.offset.set(
      this._noise(fast, 1) * 0.62,
      this._noise(fast + 31.7, 2) * 0.52,
      this._noise(slow + 11.3, 3) * 0.22
    ).multiplyScalar(shake);
    this.euler.set(
      this._noise(fast + 61.1, 4) * 0.030 * shake,
      this._noise(fast + 91.5, 5) * 0.034 * shake,
      this._noise(slow + 7.9, 6) * 0.055 * shake
    );
  }
}

/* ============================================================
   4. GPU particle group (pooled ring buffer + instanced billboards)
   ============================================================ */

/* Per-instance layout, 32 floats:
     0  aPosLife  (x, y, z, lifetime)
     4  aVelDrag  (vx, vy, vz, drag)
     8  aTiming   (birth, gravityScale, seed, atlasCell)
    12  aSize     (size0, size1, rot0, spin)
    16  aColA     (r, g, b, a)      linear
    20  aColB     (r, g, b, a)      linear
    24  aExtra    (groundY, turbAmp, turbFreq, lightMix)
    28  aCurve    (fadeIn, fadeOut, sizePow, windInfluence)                */
const STRIDE = 32;

const PARTICLE_VERT = /* glsl */ `
  attribute vec4 aPosLife;
  attribute vec4 aVelDrag;
  attribute vec4 aTiming;
  attribute vec4 aSize;
  attribute vec4 aColA;
  attribute vec4 aColB;
  attribute vec4 aExtra;
  attribute vec4 aCurve;

  uniform float uTime;
  uniform vec3 uWind;
  uniform float uGravity;
  // Named uAtlasGrid, not uAtlas: the fragment shader binds uAtlas as the
  // sampler2D, and GLSL requires a uniform of the same name to have the same
  // type in both stages or the program fails to link.
  uniform vec2 uAtlasGrid;  // (cell count x, cell count y)
  uniform float uAtlasPad;

  varying vec2 vUv;
  varying vec2 vLocal;
  varying vec4 vColor;
  varying vec3 vWorld;
  varying float vRadius;
  varying float vGroundY;
  varying float vLightMix;
  varying float vViewDepth;

  ${GLSL_COMMON}

  void main() {
    float life = aPosLife.w;
    float age = uTime - aTiming.x;
    float t = age / max(life, 1e-4);

    if (life <= 0.0 || age < 0.0 || t >= 1.0) {
      // Dead slot: collapse to a degenerate point outside the frustum.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vColor = vec4(0.0);
      vUv = vec2(0.0);
      vLocal = vec2(0.0);
      vWorld = vec3(0.0);
      vRadius = 0.0;
      vGroundY = 0.0;
      vLightMix = 0.0;
      vViewDepth = 0.0;
      return;
    }

    /* --- analytic trajectory: dv/dt = g - k(v - w) ------------------ */
    float k = max(aVelDrag.w, 0.03);
    vec3 wind = uWind * aCurve.w;
    vec3 terminal = wind + vec3(0.0, uGravity * aTiming.y, 0.0) / k;
    float decayed = (1.0 - exp(-k * age)) / k;
    vec3 p = aPosLife.xyz + terminal * age + (aVelDrag.xyz - terminal) * decayed;

    /* --- turbulence: keeps clouds from looking like clean ballistics - */
    float phase = aTiming.z * 6.28318;
    float tf = aExtra.z;
    p += aExtra.y * vec3(
      sin(age * tf + phase),
      sin(age * tf * 0.77 + phase * 1.7) * 0.55,
      cos(age * tf * 1.13 + phase * 0.6)
    ) * min(age, life);

    float sizeT = pow(t, max(aCurve.z, 0.05));
    float size = mix(aSize.x, aSize.y, sizeT);
    float radius = size * 0.5;

    // Rest on the ground instead of sinking through it.
    p.y = max(p.y, aExtra.x + radius * 0.22);

    /* --- billboard -------------------------------------------------- */
    float rot = aSize.z + aSize.w * age;
    float cr = cos(rot);
    float sr = sin(rot);
    vec2 corner = position.xy;
    vec2 rotated = vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    mvPosition.xy += rotated * size;
    gl_Position = projectionMatrix * mvPosition;

    vWorld = p + uCamRight * (rotated.x * size) + uCamUp * (rotated.y * size);
    vLocal = corner * 2.0;
    vRadius = radius;
    vGroundY = aExtra.x;
    vLightMix = aExtra.w;
    vViewDepth = -mvPosition.z;

    /* --- atlas cell -------------------------------------------------- */
    float cell = aTiming.w;
    vec2 cellSize = 1.0 / uAtlasGrid;
    vec2 cellOrigin = vec2(mod(cell, uAtlasGrid.x), floor(cell / uAtlasGrid.x)) * cellSize;
    vUv = cellOrigin + (uv * (1.0 - uAtlasPad * 2.0) + uAtlasPad) * cellSize;

    /* --- colour + life envelope -------------------------------------- */
    vec4 col = mix(aColA, aColB, t);
    float env = smoothstep(0.0, max(aCurve.x, 0.004), t) *
                (1.0 - smoothstep(aCurve.y, 1.0, t));
    col.a *= env;
    vColor = col;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec2 vLocal;
  varying vec4 vColor;
  varying vec3 vWorld;
  varying float vRadius;
  varying float vGroundY;
  varying float vLightMix;
  varying float vViewDepth;

  ${GLSL_COMMON}

  void main() {
    vec4 tex = texture2D(uAtlas, vUv);
    float alpha = tex.a * vColor.a * uOpacity;
    if (alpha < 0.004) discard;

    float bulge;
    vec3 n = vfxSphereNormal(vLocal, bulge);

    /* SOFT PARTICLES ------------------------------------------------
       Screen-space depth is not available to us (engine.js owns the
       composer), so instead we fade the sphere against the ground plane
       the particle was born on. The intersection is analytic, correct at
       grazing angles, and costs one smoothstep.                        */
    vec3 spherePoint = vWorld + uCamToward * (bulge * vRadius);
    float above = spherePoint.y - vGroundY;
    alpha *= smoothstep(-vRadius * 0.15, vRadius * 0.85, above);
    if (alpha < 0.004) discard;

    vec3 lit = vfxScatter(n, 0.85);
    vec3 rgb = vColor.rgb * mix(vec3(1.0), lit, vLightMix);

    float fog = vfxFog(vViewDepth);
    #ifdef VFX_ADDITIVE
      rgb *= (1.0 - fog);
      alpha *= (1.0 - fog * 0.6);
    #else
      rgb = mix(rgb, uFogColor, fog);
    #endif

    gl_FragColor = vec4(rgb, alpha);
  }
`;

/** One draw call worth of pooled particles sharing a blend mode. */
class ParticleGroup {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.capacity = Math.max(32, options.capacity | 0);
    this.data = new Float32Array(this.capacity * STRIDE);
    this.deathAt = new Float32Array(this.capacity);
    this.cursor = 0;
    this.spawned = 0;
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const attr = (name, size, offset) => {
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
    };
    attr("aPosLife", 4, 0);
    attr("aVelDrag", 4, 4);
    attr("aTiming", 4, 8);
    attr("aSize", 4, 12);
    attr("aColA", 4, 16);
    attr("aColB", 4, 20);
    attr("aExtra", 4, 24);
    attr("aCurve", 4, 28);
    geometry.instanceCount = this.capacity;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.buffer = buffer;
    this.geometry = ctx.track(geometry);

    const material = new THREE.ShaderMaterial({
      uniforms: options.uniforms,
      defines: options.additive ? { VFX_ADDITIVE: 1 } : {},
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.material = ctx.track(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = options.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder || 12;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Write one particle from a plain scratch descriptor. No allocation. */
  emit(d, now) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.spawned += 1;

    const o = i * STRIDE;
    const a = this.data;
    a[o + 0] = d.px; a[o + 1] = d.py; a[o + 2] = d.pz; a[o + 3] = d.life;
    a[o + 4] = d.vx; a[o + 5] = d.vy; a[o + 6] = d.vz; a[o + 7] = d.drag;
    a[o + 8] = now; a[o + 9] = d.gravity; a[o + 10] = d.seed; a[o + 11] = d.atlas;
    a[o + 12] = d.size0; a[o + 13] = d.size1; a[o + 14] = d.rot0; a[o + 15] = d.spin;
    a[o + 16] = d.cr; a[o + 17] = d.cg; a[o + 18] = d.cb; a[o + 19] = d.ca;
    a[o + 20] = d.dr; a[o + 21] = d.dg; a[o + 22] = d.db; a[o + 23] = d.da;
    a[o + 24] = d.groundY; a[o + 25] = d.turbAmp; a[o + 26] = d.turbFreq; a[o + 27] = d.lightMix;
    a[o + 28] = d.fadeIn; a[o + 29] = d.fadeOut; a[o + 30] = d.sizePow; a[o + 31] = d.windInf;

    this.deathAt[i] = now + d.life;
    if (o < this.dirtyLo) this.dirtyLo = o;
    if (o + STRIDE > this.dirtyHi) this.dirtyHi = o + STRIDE;
  }

  flush() {
    if (this.dirtyHi < 0) return;
    if (this.buffer.addUpdateRange) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(this.dirtyLo, this.dirtyHi - this.dirtyLo);
    }
    this.buffer.needsUpdate = true;
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;
  }

  alive(now) {
    let count = 0;
    for (let i = 0; i < this.capacity; i += 1) if (this.deathAt[i] > now) count += 1;
    return count;
  }
}

/* ============================================================
   5. Airborne particulate - cascaded mote layers

   Why a cascade
   -------------
   A single camera-relative wrap box cannot carry air. Spread N motes
   uniformly through one box and the number that actually lands in the
   frustum is

       count_in_frame = frustumCrossSection * density * (far^3 - near^3) / 3

   which for the previous single 96x62x96 box at 930 points came out at
   ~44 specks in a 1600x900 frame, all of them further than 3.2 units
   away because the near fade explicitly deleted everything closer. Forty
   specks at low contrast is not air, and nothing at all in the near
   field means no parallax, which is the one cue that sells sub-millimetre
   scale. Seven blind reviews scored atmosphere 2/10 and none of them saw
   a single particle.

   So: several nested boxes, each with its own density, sized so that the
   count per unit of SCREEN area stays roughly constant from 20 cm in
   front of the lens out to a couple of hundred body lengths. Near motes
   are huge, soft and fast (parallax); far motes are sub-pixel and dim
   (aerial perspective).

   Why premultiplied alpha, not additive
   -------------------------------------
   Additive dust is invisible against a bright sky, and 30-45% of most
   frames here IS bright sky. A real mote both blocks background light
   and scatters its own, so the correct operator is

       result = inscatter + background * (1 - extinction)

   which is exactly premultiplied source-over. Written that way a mote
   reads bright against dark grass AND reads as a dark speck against a
   blown-out sky, from the same shader, with no per-shot tuning.

   Energy conservation
   -------------------
   Every layer computes the projected size it WANTS, clamps it to a legal
   pixel range, and scales opacity by (wanted / clamped)^2. Motes smaller
   than a pixel therefore get dimmer instead of being inflated to a pixel
   (no far-field shimmer), and near motes that blow past the clamp get
   fainter instead of painting the lens shut (no grey soup, bounded fill
   cost). It is also just what a defocused grain does.
   ============================================================ */

const GLSL_AIR = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform vec3 uBox;
  uniform vec3 uWind;
  uniform vec2 uSizeRange;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  uniform float uOpacity;
  uniform float uPointScale;
  uniform vec2 uPixelRange;
  uniform float uDrift;
  uniform float uSwirl;
  uniform float uEdgeFade;
  uniform float uSunGain;
  uniform float uSkyGain;
  uniform float uTwinkle;

  /* Camera-relative wrap. Position and drift are both continuous in time,
     so the modulo can only pop at the volume boundary - which airEdge
     fades out before it ever gets there. */
  vec3 airWrap(vec3 base, vec3 drift) {
    vec3 origin = uCamPos - uBox * 0.5;
    return mod(base + drift - origin, uBox) + origin;
  }

  vec3 airDrift(vec4 rnd, float ph) {
    vec3 d = uWind * (uTime * (0.18 + rnd.x * 0.95) * uDrift);
    d += vec3(
      sin(uTime * (0.21 + rnd.z * 0.28) + ph),
      sin(uTime * (0.14 + rnd.w * 0.21) + ph * 1.7) * 0.62,
      cos(uTime * (0.18 + rnd.z * 0.24) + ph * 0.6)
    ) * uSwirl * (0.35 + rnd.z * 1.7);
    return d;
  }

  float airEdge(vec3 p) {
    vec3 dn = abs(p - uCamPos) / (uBox * 0.5);
    return 1.0 - smoothstep(uEdgeFade, 1.0, max(max(dn.x, dn.y), dn.z));
  }

  /* Henyey-Greenstein, scaled so the forward lobe is O(1) rather than
     O(1/4pi) - the absolute normalisation is folded into uSunGain. */
  float airPhase(float c, float g) {
    float gg = g * g;
    float den = max(1.0 + gg - 2.0 * g * c, 1e-4);
    return (1.0 - gg) / max(pow(den, 1.5), 1e-4);
  }

  /* Radiance one mote sends back at the camera. viewDir points from the
     camera out toward the mote, so dot(viewDir, uSunDir) is +1 when you
     are staring straight into the sun through it. */
  vec3 airScatter(vec3 viewDir, float rough, float depth) {
    float c = dot(viewDir, uSunDir);
    float lobe = 0.30 + 0.085 * airPhase(c, 0.66) + 0.030 * airPhase(-c, 0.32);
    vec3 L = uSunColor * lobe * uSunGain + uSkyColor * (0.95 + 0.5 * rough) * uSkyGain;
    /* Far motes sit inside the same aerial perspective as the geometry
       behind them, or they punch through it as bright dots. */
    float fog = vfxFog(depth);
    return mix(L, uFogColor * 1.7, min(fog, 0.85));
  }
`;

/* --- points: mid and far cascades ---------------------------------- */

const AIR_POINT_VERT = /* glsl */ `
  attribute vec3 aBase;
  attribute vec4 aRand;

  varying vec4 vCol;

  ${GLSL_COMMON}
  ${GLSL_AIR}

  void main() {
    float ph = aRand.y * 6.28318;
    vec3 p = airWrap(aBase, airDrift(aRand, ph));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(0.02, -mv.z);
    gl_Position = projectionMatrix * mv;

    float world = mix(uSizeRange.x, uSizeRange.y, aRand.w * aRand.w);
    float wanted = world * uPointScale / dist;
    float px = clamp(wanted, uPixelRange.x, uPixelRange.y);
    gl_PointSize = px;
    float energy = clamp((wanted * wanted) / (px * px), 0.0, 1.0);

    vec3 viewDir = normalize(p - uCamPos);
    vec3 L = airScatter(viewDir, aRand.z, dist) * mix(uTintA, uTintB, aRand.x);

    float twinkle = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (1.1 + aRand.x * 4.2) + ph * 3.1));
    float a = clamp(uOpacity * energy * airEdge(p) * twinkle * (0.5 + aRand.w * 1.0), 0.0, 1.0);

    vCol = vec4(L * a, a);
  }
`;

const AIR_POINT_FRAG = /* glsl */ `
  varying vec4 vCol;

  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(d, d);
    if (r2 >= 1.0) discard;
    float shape = pow(1.0 - r2, 1.3);
    if (vCol.a * shape < 0.0015) discard;
    gl_FragColor = vCol * shape;
  }
`;

/* --- quads: near bokeh and sky fluff -------------------------------- */

const AIR_QUAD_VERT = /* glsl */ `
  attribute vec3 aBase;
  attribute vec4 aRand;

  uniform float uTumble;
  uniform float uFlat;

  varying vec2 vLocal;
  varying vec4 vCol;

  ${GLSL_COMMON}
  ${GLSL_AIR}

  void main() {
    float ph = aRand.y * 6.28318;
    vec3 p = airWrap(aBase, airDrift(aRand, ph));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(0.02, -mv.z);

    float world = mix(uSizeRange.x, uSizeRange.y, aRand.w);
    float wanted = world * uPointScale / dist;
    float px = clamp(wanted, uPixelRange.x, uPixelRange.y);
    float size = px * dist / max(uPointScale, 1.0);
    float energy = clamp((wanted * wanted) / (px * px), 0.0, 1.0);

    /* Tumble: squash one axis so a flat grain flickers edge-on as it
       rotates. vLocal stays on the unsquashed quad so the sprite falloff
       becomes an ellipse in screen space instead of a hard-edged slab. */
    float squash = mix(1.0, uFlat + (1.0 - uFlat) * abs(sin(uTime * (0.7 + aRand.x * 1.5) + ph)), uTumble);
    float spin = ph + uTime * (0.3 + aRand.x * 1.5) * (aRand.z > 0.5 ? 1.0 : -1.0);
    float cr = cos(spin);
    float sr = sin(spin);
    vec2 base = position.xy;
    vec2 corner = vec2(base.x, base.y * squash);
    mv.xy += vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr) * size;
    gl_Position = projectionMatrix * mv;

    vec3 viewDir = normalize(p - uCamPos);
    vec3 L = airScatter(viewDir, aRand.z, dist) * mix(uTintA, uTintB, aRand.x);

    float twinkle = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (0.8 + aRand.x * 2.4) + ph * 2.3));
    float a = clamp(uOpacity * energy * airEdge(p) * twinkle * (0.45 + aRand.w * 1.1), 0.0, 1.0);

    vLocal = base * 2.0;
    vCol = vec4(L * a, a);
  }
`;

const AIR_QUAD_FRAG = /* glsl */ `
  uniform float uSoft;
  uniform float uRim;

  varying vec2 vLocal;
  varying vec4 vCol;

  void main() {
    float r2 = dot(vLocal, vLocal);
    if (r2 >= 1.0) discard;
    float e = sqrt(r2);
    /* uSoft near 1 gives a plain soft blob; uSoft small plus uRim gives a
       defocused bokeh disc - flat core, bright edge, fast rolloff. */
    float disc = smoothstep(1.0, 1.0 - uSoft, e);
    float rim = smoothstep(1.0 - uSoft * 2.4, 1.0 - uSoft * 0.85, e);
    float shape = disc * (1.0 + uRim * rim);
    if (vCol.a * shape < 0.0012) discard;
    gl_FragColor = vCol * shape;
  }
`;

/* ============================================================
   7. Water surface
   ============================================================ */

const WATER_PARS = /* glsl */ `
  uniform float uWaterTime;
  uniform sampler2D uWaterDepth;
  uniform vec2 uWaterMin;
  uniform vec2 uWaterSize;
  uniform float uWaterMaxDepth;
  uniform vec4 uRipples[8];
  uniform vec3 uFoamColor;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  varying vec3 vWaterWorld;

  float waterDepthAt(vec2 p) {
    vec2 uv = (p - uWaterMin) / uWaterSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uWaterDepth, uv).r * uWaterMaxDepth;
  }

  /* Height field + analytic gradient. .x = height, .yz = d/dx, d/dz */
  vec3 waterField(vec2 p, float depth) {
    float h = 0.0;
    vec2 grad = vec2(0.0);
    float t = uWaterTime;

    /* Capillary ripples. At 0.5 mm scale surface tension dominates, so
       waves are short, fast, and very shallow - almost a taut skin.     */
    /* THIS is the surface reviewers see - the puddle's visible ripple comes
       from here, not from world.js's water material. (Zeroing that
       material's uRippleAmp changes nothing; three attempts were spent
       editing the wrong file.)

       Four fixed directions on near-harmonic frequencies (0.55 / 0.94 /
       1.61 / 2.44) is an interference LATTICE: it prints a regular grid of
       identical crescents whose period is the same everywhere, so the
       surface reads as corrugated plastic and, because the pattern never
       foreshortens, as a vertical sheet rather than a receding plane.

       Seven waves, directions stepped by the golden angle so no two ever
       align, frequencies scaled by 1.28 so the sum has no common period.
       Keep the top frequency near the original 2.44: eleven octaves at 1.37
       reached 13.5 and the surface turned into glitter. The fix for a
       lattice is non-aligned DIRECTIONS, not more octaves. */
    // Non-aligned directions alone are not enough: a sum of pure sines is
    // still quasi-periodic and reads as hammered metal. A slow domain warp
    // is what actually destroys the regularity - it makes every wave's
    // phase drift across the surface so no two ever settle into a beat.
    vec2 pw = p + vec2(
      sin(p.y * 0.21 + t * 0.35),
      cos(p.x * 0.19 - t * 0.31)) * 2.1;

    // A uniform carpet of small ripples reads as corduroy, not water. Real
    // capillary chop on a puddle this size is sparse and shallow - most of
    // the surface should be near-mirror so the reflection can do the work.
    float amp = 0.016;
    float freq = 0.55;
    float ang = 0.0;
    for (int i = 0; i < 9; i += 1) {
      ang += 2.39996323;
      vec2 k = vec2(cos(ang), sin(ang)) * freq;
      float phase = dot(k, pw) + t * (1.5 + freq * 1.15);
      h += amp * sin(phase);
      grad += k * amp * cos(phase);
      // Amplitude was decaying almost as fast as frequency rose, so nearly
      // all the visible energy sat in waves 1-3 spanning only ~1.6x in
      // wavelength - narrowband, which reads as uniform dimples (bubble wrap)
      // rather than water. Decaying more slowly across more octaves puts a
      // real spread of wave sizes on the surface.
      amp *= 0.88;
      freq *= 1.28;
    }

    /* Reactive ripple rings from impacts. */
    for (int i = 0; i < 8; i += 1) {
      vec4 R = uRipples[i];
      if (R.w <= 0.0) continue;
      float age = uWaterTime - R.z;
      if (age < 0.0 || age > 3.2) continue;
      vec2 delta = p - R.xy;
      float d = length(delta) + 1e-4;
      float front = age * 24.0;
      float x = d - front;
      float band = exp(-x * x * 0.010);
      float envelope = R.w * exp(-age * 1.35) * smoothstep(0.0, 0.08, age);
      float kk = 0.42;
      h += sin(x * kk) * band * envelope * 0.55;
      float dhdd = envelope * 0.55 * (kk * cos(x * kk) * band + sin(x * kk) * band * (-0.020 * x));
      grad += (delta / d) * dhdd;
    }

    /* Flatten everything as the water thins out at the shoreline. */
    float shore = smoothstep(0.0, uWaterMaxDepth * 0.28, depth);
    return vec3(h * shore, grad * shore);
  }
`;

/* ============================================================
   8. Decals
   ============================================================ */

const DECAL_VERT = /* glsl */ `
  attribute vec4 dPosSize;    // x, y, z, size
  attribute vec4 dRotTime;    // rotation, birth, life, atlasCell
  attribute vec4 dColor;
  attribute vec4 dCorners;    // ground offsets at the 4 rotated corners

  uniform float uTime;

  varying vec2 vUv;
  varying vec4 vColor;
  varying float vViewDepth;

  void main() {
    float age = uTime - dRotTime.y;
    float life = dRotTime.z;
    float t = age / max(life, 1e-4);
    if (life <= 0.0 || age < 0.0 || t >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vColor = vec4(0.0);
      vUv = vec2(0.0);
      vViewDepth = 0.0;
      return;
    }

    float rot = dRotTime.x;
    float cr = cos(rot);
    float sr = sin(rot);
    vec2 local = position.xy;                       // [-0.5, 0.5]
    vec2 rotated = vec2(local.x * cr - local.y * sr, local.x * sr + local.y * cr);

    // Bilinear blend of the sampled ground heights conforms to the terrain.
    vec2 f = local + 0.5;
    float h = mix(mix(dCorners.x, dCorners.y, f.x), mix(dCorners.z, dCorners.w, f.x), f.y);

    vec3 world = vec3(
      dPosSize.x + rotated.x * dPosSize.w,
      dPosSize.y + h,
      dPosSize.z + rotated.y * dPosSize.w
    );

    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vViewDepth = -mvPosition.z;

    float cell = dRotTime.w;
    vUv = (vec2(mod(cell, 2.0), floor(cell / 2.0)) + uv * 0.94 + 0.03) * 0.5;

    float env = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.55, 1.0, t));
    vColor = vec4(dColor.rgb, dColor.a * env);
  }
`;

const DECAL_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying vec2 vUv;
  varying vec4 vColor;
  varying float vViewDepth;

  void main() {
    float tex = texture2D(uAtlas, vUv).a;
    float alpha = tex * vColor.a;
    if (alpha < 0.004) discard;
    float f = uFogDensity * vViewDepth;
    float fog = 1.0 - exp(-f * f);
    gl_FragColor = vec4(mix(vColor.rgb, uFogColor, fog), alpha);
  }
`;

/* ============================================================
   9. The system
   ============================================================ */

export async function createVfx(ctx) {
  const THREEJS = ctx.THREE || THREE;
  const q = ctx.settings.quality;
  const density = clamp(q.particles || 1, 0.2, 2);
  const rng = makeRng(0x51d3f7);
  const perf = new RollingAverage(120);

  let clockTime = 0;
  let softDisabled = false;

  /* ---------------- shared uniforms ---------------- */
  const sunDir = new THREEJS.Vector3(0.42, 0.72, 0.55).normalize();
  if (ctx.engine && ctx.engine.sun && ctx.engine.sun.direction) sunDir.copy(ctx.engine.sun.direction);

  const sunColor = new THREEJS.Color(0xfff2dd);
  if (ctx.engine && ctx.engine.sun && ctx.engine.sun.light) {
    sunColor.copy(ctx.engine.sun.light.color).multiplyScalar(clamp(ctx.engine.sun.light.intensity * 0.42, 0.4, 3));
  }
  const skyColor = new THREEJS.Color(0x9dc4e8).multiplyScalar(0.55);
  const fogColor = new THREEJS.Color(0x9fc4de);
  if (ctx.scene.fog && ctx.scene.fog.color) fogColor.copy(ctx.scene.fog.color);

  const shared = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir },
    uSunColor: { value: sunColor },
    uSkyColor: { value: skyColor },
    uCamRight: { value: new THREEJS.Vector3(1, 0, 0) },
    uCamUp: { value: new THREEJS.Vector3(0, 1, 0) },
    uCamToward: { value: new THREEJS.Vector3(0, 0, 1) },
    uCamPos: { value: new THREEJS.Vector3() },
    uFogColor: { value: fogColor },
    uFogDensity: { value: ctx.scene.fog && ctx.scene.fog.density ? ctx.scene.fog.density : 0.00085 },
    uWind: { value: new THREEJS.Vector3(0.9, 0.06, 0.55) },
    // Pixels per world unit at one unit of view depth. Written by
    // syncCamera; every air layer divides it by its own view distance.
    uPointScale: { value: 900 },
  };

  /* ---------------- textures ---------------- */
  const particleTexture = ctx.track(new THREEJS.CanvasTexture(buildParticleAtlas(rng, 256)));
  particleTexture.colorSpace = THREEJS.NoColorSpace;
  particleTexture.wrapS = particleTexture.wrapT = THREEJS.ClampToEdgeWrapping;
  particleTexture.anisotropy = Math.min(4, q.anisotropy || 1);
  particleTexture.generateMipmaps = true;
  particleTexture.minFilter = THREEJS.LinearMipmapLinearFilter;

  const decalTexture = ctx.track(new THREEJS.CanvasTexture(buildDecalAtlas(rng, 256)));
  decalTexture.colorSpace = THREEJS.NoColorSpace;
  decalTexture.wrapS = decalTexture.wrapT = THREEJS.ClampToEdgeWrapping;
  decalTexture.anisotropy = q.anisotropy || 1;

  /* ---------------- root ---------------- */
  const root = new THREEJS.Group();
  root.name = "Vfx";
  root.matrixAutoUpdate = false;
  ctx.scene.add(root);

  /* ============================================================
     Camera uniform sync

     Runs from onBeforeRender so the values are always correct even when
     the QA harness moves the camera and renders without stepping the
     simulation (qa.setPose -> engine.render).
     ============================================================ */
  let camToken = -1;
  const camMatrix = new THREEJS.Matrix4();

  function syncCamera(renderer, camera) {
    const token = camera.id * 1e6 + ctx.time.frame;
    if (token === camToken) return;
    camToken = token;

    camera.updateMatrixWorld();
    camMatrix.copy(camera.matrixWorld);
    const e = camMatrix.elements;
    shared.uCamRight.value.set(e[0], e[1], e[2]).normalize();
    shared.uCamUp.value.set(e[4], e[5], e[6]).normalize();
    shared.uCamToward.value.set(e[8], e[9], e[10]).normalize(); // +Z of the camera faces the scene
    shared.uCamPos.value.setFromMatrixPosition(camMatrix);

    const target = renderer.getRenderTarget();
    let height = target ? target.height : 0;
    if (!height) height = renderer.getDrawingBufferSize(_v2a).y;
    if (camera.isPerspectiveCamera) {
      shared.uPointScale.value = height * 0.5 * camera.projectionMatrix.elements[5];
    }
  }

  /* ============================================================
     Airborne particulate - the cascade

     Counts are chosen for roughly constant SCREEN density, not constant
     volumetric density. For a layer of N motes in a WxHxD box, the number
     that lands in a 46-degree frustum between its near and far radius is

       N / (W*H*D) * 2.51 * (far^3 - near^3) / 3

     which is the number written in each comment below. They sum to a few
     hundred discrete specks per frame spread over three orders of
     magnitude of distance, which is what "air" actually looks like.
     ============================================================ */
  const AIR_TINT_COOL = new THREEJS.Color(0x9fb6cc);  // Color() already converts sRGB -> working space
  const AIR_TINT_WARM = new THREEJS.Color(0xffe9c4);  // Color() already converts sRGB -> working space
  const AIR_TINT_POLLEN = new THREEJS.Color(0xffd98a);  // Color() already converts sRGB -> working space
  const AIR_TINT_FLUFF = new THREEJS.Color(0xfff4e2);  // Color() already converts sRGB -> working space

  /**
   * Layer specs. `box` is the camera-relative wrap volume in world units,
   * `size` the world-unit diameter range, `pixels` the legal projected
   * size (opacity is scaled by the square of whatever the clamp took away).
   */
  const AIR_LAYERS = [
    {
      /* Near bokeh. THE scale cue: at 0.3-3 units from the lens a 0.05-unit
         grain covers 40-200 px, drifts visibly across the frame in a second,
         and cannot be read as anything but sub-millimetre. Nothing in the
         previous build lived closer than 3.2 units, which is why the two
         hero shots read as a normal animal on a dry lakebed.
         ~30 in frame between 0.25 and 3 units. */
      id: "near", kind: "quad", name: "AirMotesNear", count: 210,
      box: [7.0, 5.2, 7.0], size: [0.030, 0.115], pixels: [4, 210],
      opacity: 0.30, drift: 1.0, swirl: 0.16, edgeFade: 0.55,
      tintA: AIR_TINT_COOL, tintB: AIR_TINT_WARM,
      sunGain: 1.0, skyGain: 1.15, twinkle: 0.12,
      soft: 0.34, rim: 0.55, tumble: 0.35, flat: 0.55,
      yBias: 1.0, renderOrder: 14,
    },
    {
      /* Mid dust, the body of the air. Biased low so it thickens down
         among the grass roots where the light is doing the most work.
         ~110 in frame between 1 and 14 units. */
      id: "mid", kind: "point", name: "AirborneDust", count: 900,
      box: [30, 20, 30], size: [0.055, 0.30], pixels: [1.1, 26],
      opacity: 0.52, drift: 0.85, swirl: 0.6, edgeFade: 0.62,
      tintA: AIR_TINT_COOL, tintB: AIR_TINT_WARM,
      sunGain: 1.0, skyGain: 1.0, twinkle: 0.30,
      yBias: 1.35, renderOrder: 12,
    },
    {
      /* Far dust. Sub-pixel for most of its range, so energy conservation
         turns it into a faint luminous grain that brightens toward the sun
         instead of a field of shimmering white dots.
         ~150 in frame between 14 and 62 units. */
      id: "far", kind: "point", name: "AirborneDustFar", count: 1100,
      box: [130, 84, 130], size: [0.16, 0.85], pixels: [1.0, 9],
      opacity: 0.46, drift: 0.55, swirl: 1.6, edgeFade: 0.7,
      tintA: AIR_TINT_COOL, tintB: AIR_TINT_WARM,
      sunGain: 1.05, skyGain: 0.95, twinkle: 0.22,
      yBias: 1.15, renderOrder: 11,
    },
    {
      /* Aerial perspective grain for the wide shots, where everything above
         is already behind the subject. Almost pure inscatter.
         ~130 in frame between 62 and 300 units. */
      id: "deep", kind: "point", name: "AirborneDustDeep", count: 900,
      box: [620, 360, 620], size: [0.9, 4.2], pixels: [1.0, 5],
      opacity: 0.40, drift: 0.3, swirl: 5.0, edgeFade: 0.78,
      tintA: AIR_TINT_COOL, tintB: AIR_TINT_WARM,
      sunGain: 1.15, skyGain: 0.9, twinkle: 0.16,
      yBias: 1.0, renderOrder: 10,
    },
    {
      /* Pollen and seed fluff. Big, slow, warm, tumbling, and biased into
         the upper half of the volume so it is the thing that finally sits
         in the sky. Deliberately sparse - these are punctuation.
         ~18 in frame between 4 and 45 units. */
      id: "pollen", kind: "quad", name: "AirbornePollen", count: 150,
      box: [90, 62, 90], size: [0.30, 1.15], pixels: [2.5, 60],
      opacity: 0.62, drift: 1.25, swirl: 2.4, edgeFade: 0.66,
      tintA: AIR_TINT_POLLEN, tintB: AIR_TINT_FLUFF,
      sunGain: 1.25, skyGain: 1.1, twinkle: 0.34,
      soft: 0.62, rim: 0.18, tumble: 0.85, flat: 0.28,
      yBias: 0.62, renderOrder: 13,
    },
  ];

  const QUAD_CORNERS = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 1];
  const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

  /**
   * Seeds one wrap cell. `yBias` above 1 pushes motes toward the floor of
   * the cell, below 1 toward the ceiling; 1 is uniform.
   */
  function seedVolume(count, box, yBias) {
    const base = new Float32Array(count * 3);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      base[i * 3 + 0] = rng() * box[0];
      base[i * 3 + 1] = Math.pow(rng(), yBias) * box[1];
      base[i * 3 + 2] = rng() * box[2];
      rand[i * 4 + 0] = rng();
      rand[i * 4 + 1] = rng();
      rand[i * 4 + 2] = rng();
      rand[i * 4 + 3] = rng();
    }
    return { base, rand };
  }

  const airLayers = [];

  for (const spec of AIR_LAYERS) {
    const count = Math.max(12, Math.round(spec.count * density));
    const seed = seedVolume(count, spec.box, spec.yBias);

    const uniforms = {
      ...shared,
      uBox: { value: new THREEJS.Vector3(spec.box[0], spec.box[1], spec.box[2]) },
      uSizeRange: { value: new THREEJS.Vector2(spec.size[0], spec.size[1]) },
      uPixelRange: { value: new THREEJS.Vector2(spec.pixels[0], spec.pixels[1]) },
      uTintA: { value: spec.tintA.clone() },
      uTintB: { value: spec.tintB.clone() },
      uOpacity: { value: spec.opacity },
      uDrift: { value: spec.drift },
      uSwirl: { value: spec.swirl },
      uEdgeFade: { value: spec.edgeFade },
      uSunGain: { value: spec.sunGain },
      uSkyGain: { value: spec.skyGain },
      uTwinkle: { value: spec.twinkle },
    };

    let geometry;
    let object;

    if (spec.kind === "quad") {
      uniforms.uSoft = { value: spec.soft };
      uniforms.uRim = { value: spec.rim };
      uniforms.uTumble = { value: spec.tumble };
      uniforms.uFlat = { value: spec.flat };

      geometry = ctx.track(new THREEJS.InstancedBufferGeometry());
      geometry.setAttribute("position", new THREEJS.Float32BufferAttribute(QUAD_CORNERS, 3));
      geometry.setAttribute("uv", new THREEJS.Float32BufferAttribute(QUAD_UVS, 2));
      geometry.setIndex(QUAD_INDEX.slice());
      geometry.setAttribute("aBase", new THREEJS.InstancedBufferAttribute(seed.base, 3));
      geometry.setAttribute("aRand", new THREEJS.InstancedBufferAttribute(seed.rand, 4));
      geometry.instanceCount = count;
    } else {
      geometry = ctx.track(new THREEJS.BufferGeometry());
      geometry.setAttribute("position", new THREEJS.BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute("aBase", new THREEJS.BufferAttribute(seed.base, 3));
      geometry.setAttribute("aRand", new THREEJS.BufferAttribute(seed.rand, 4));
    }
    geometry.boundingSphere = new THREEJS.Sphere(new THREEJS.Vector3(), 1e7);

    /* Premultiplied source-over. See the header of section 5: additive
       particulate cannot be seen against a bright sky, and bright sky is
       a third of most frames in this game. */
    const material = ctx.track(new THREEJS.ShaderMaterial({
      uniforms,
      vertexShader: spec.kind === "quad" ? AIR_QUAD_VERT : AIR_POINT_VERT,
      fragmentShader: spec.kind === "quad" ? AIR_QUAD_FRAG : AIR_POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREEJS.CustomBlending,
      blendEquation: THREEJS.AddEquation,
      blendSrc: THREEJS.OneFactor,
      blendDst: THREEJS.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREEJS.AddEquation,
      blendSrcAlpha: THREEJS.OneFactor,
      blendDstAlpha: THREEJS.OneMinusSrcAlphaFactor,
      side: spec.kind === "quad" ? THREEJS.DoubleSide : THREEJS.FrontSide,
      toneMapped: false,
    }));

    object = spec.kind === "quad"
      ? new THREEJS.Mesh(geometry, material)
      : new THREEJS.Points(geometry, material);
    object.name = spec.name;
    object.frustumCulled = false;
    object.renderOrder = spec.renderOrder;
    object.matrixAutoUpdate = false;
    object.onBeforeRender = syncCamera;
    root.add(object);

    airLayers.push({ spec, count, geometry, material, object, uniforms });
  }

  /* ============================================================
     Particle groups
     ============================================================ */
  const groupUniforms = {
    ...shared,
    uAtlas: { value: particleTexture },
    // buildParticleAtlas lays the four sprites out on a 2x2 grid.
    uAtlasGrid: { value: new THREEJS.Vector2(2, 2) },
    uAtlasPad: { value: 0.012 },
    uGravity: { value: ctx.GRAVITY },
    uOpacity: { value: 1 },
  };

  const groups = {
    alpha: new ParticleGroup(ctx, {
      name: "VfxParticlesAlpha",
      capacity: Math.round(2200 * density),
      additive: false,
      uniforms: groupUniforms,
      renderOrder: 12,
    }),
    additive: new ParticleGroup(ctx, {
      name: "VfxParticlesAdditive",
      capacity: Math.round(900 * density),
      additive: true,
      uniforms: groupUniforms,
      renderOrder: 13,
    }),
  };
  groups.alpha.mesh.onBeforeRender = syncCamera;
  groups.additive.mesh.onBeforeRender = syncCamera;
  root.add(groups.alpha.mesh, groups.additive.mesh);

  /* ---------------- scratch spawn descriptor (never reallocated) ------ */
  const D = {
    px: 0, py: 0, pz: 0, life: 1,
    vx: 0, vy: 0, vz: 0, drag: 1.6,
    gravity: 1, seed: 0, atlas: 0,
    size0: 1, size1: 1, rot0: 0, spin: 0,
    cr: 1, cg: 1, cb: 1, ca: 1,
    dr: 1, dg: 1, db: 1, da: 0,
    groundY: 0, turbAmp: 0, turbFreq: 2, lightMix: 1,
    fadeIn: 0.08, fadeOut: 0.55, sizePow: 1, windInf: 1,
  };

  function groundAt(x, z) {
    if (ctx.world && typeof ctx.world.heightAt === "function") {
      const h = ctx.world.heightAt(x, z);
      return Number.isFinite(h) ? h : 0;
    }
    return 0;
  }

  /* ============================================================
     Effect presets
     ============================================================ */
  const C = {
    dust: linRGB(0xc4ab8a, [0, 0, 0]),
    dustFade: linRGB(0xdfd0b8, [0, 0, 0]),
    soil: linRGB(0x6d543a, [0, 0, 0]),
    soilFade: linRGB(0x8a7050, [0, 0, 0]),
    chip: linRGB(0x8a7455, [0, 0, 0]),
    water: linRGB(0xc4e7f2, [0, 0, 0]),
    waterFade: linRGB(0xe8f7fb, [0, 0, 0]),
    foam: linRGB(0xffffff, [0, 0, 0]),
    pollen: linRGB(0xf2d574, [0, 0, 0]),
    spark: linRGB(0xffe6a8, [0, 0, 0]),
    green: linRGB(0x8fc25a, [0, 0, 0]),
  };

  /**
   * Presets are pure data. Ranges are [min, max] and get sampled with the
   * seeded rng, so screenshots stay reproducible.
   */
  const PRESETS = {
    landPuff: {
      group: "alpha", count: [10, 16], atlas: 0,
      speed: [3.5, 11], cone: 0.92, up: 0.28,
      life: [0.55, 1.15], drag: [2.6, 4.4], gravity: 0.09,
      size: [1.5, 3.2], sizeEnd: [7.5, 13], sizePow: 0.55,
      colorA: C.dust, colorB: C.dustFade, alphaA: 0.5, alphaB: 0,
      spin: [-1.4, 1.4], turb: [0.4, 1.3], turbFreq: [1.4, 3.4],
      lightMix: 1, fadeIn: 0.1, fadeOut: 0.32, wind: 0.7,
    },
    jumpPuff: {
      group: "alpha", count: [5, 8], atlas: 0,
      speed: [2.4, 6.5], cone: 0.8, up: 0.35,
      life: [0.4, 0.8], drag: [3.2, 5], gravity: 0.05,
      size: [1.0, 2.0], sizeEnd: [4.5, 7.5], sizePow: 0.6,
      colorA: C.dust, colorB: C.dustFade, alphaA: 0.34, alphaB: 0,
      spin: [-1.6, 1.6], turb: [0.3, 1.0], turbFreq: [1.6, 3.6],
      lightMix: 1, fadeIn: 0.12, fadeOut: 0.3, wind: 0.7,
    },
    stride: {
      group: "alpha", count: [1, 2], atlas: 0,
      speed: [0.7, 2.6], cone: 0.75, up: 0.5,
      life: [0.4, 0.85], drag: [3.4, 5.2], gravity: 0.06,
      size: [0.5, 1.0], sizeEnd: [2.4, 4.4], sizePow: 0.6,
      colorA: C.dust, colorB: C.dustFade, alphaA: 0.24, alphaB: 0,
      spin: [-1.8, 1.8], turb: [0.2, 0.7], turbFreq: [1.8, 3.8],
      lightMix: 1, fadeIn: 0.14, fadeOut: 0.28, wind: 0.9,
    },
    rollTrail: {
      group: "alpha", count: [2, 3], atlas: 0,
      speed: [1.6, 5.0], cone: 0.7, up: 0.42,
      life: [0.6, 1.25], drag: [2.4, 3.8], gravity: 0.05,
      size: [1.0, 2.0], sizeEnd: [5.5, 9.5], sizePow: 0.55,
      colorA: C.dust, colorB: C.dustFade, alphaA: 0.3, alphaB: 0,
      spin: [-2.0, 2.0], turb: [0.5, 1.4], turbFreq: [1.5, 3.2],
      lightMix: 1, fadeIn: 0.1, fadeOut: 0.3, wind: 0.85,
    },
    chips: {
      group: "alpha", count: [7, 13], atlas: 2,
      speed: [7, 22], cone: 0.55, up: 0.42,
      life: [0.7, 1.5], drag: [0.5, 1.1], gravity: 1,
      size: [0.16, 0.5], sizeEnd: [0.14, 0.42], sizePow: 1,
      colorA: C.chip, colorB: C.soil, alphaA: 1, alphaB: 1,
      spin: [-14, 14], turb: [0, 0.2], turbFreq: [2, 5],
      lightMix: 1, fadeIn: 0.02, fadeOut: 0.82, wind: 0.25,
    },
    soilSpray: {
      group: "alpha", count: [11, 19], atlas: 1,
      speed: [5, 17], cone: 0.6, up: 0.55,
      life: [0.6, 1.25], drag: [0.9, 1.8], gravity: 1,
      size: [0.22, 0.7], sizeEnd: [0.2, 0.6], sizePow: 1,
      colorA: C.soil, colorB: C.soilFade, alphaA: 1, alphaB: 0.85,
      spin: [-8, 8], turb: [0.1, 0.5], turbFreq: [2, 5],
      lightMix: 1, fadeIn: 0.02, fadeOut: 0.72, wind: 0.4,
    },
    splash: {
      group: "alpha", count: [14, 24], atlas: 1,
      speed: [8, 26], cone: 0.42, up: 0.85,
      life: [0.55, 1.1], drag: [0.55, 1.2], gravity: 1,
      size: [0.3, 1.0], sizeEnd: [0.22, 0.7], sizePow: 1,
      colorA: C.water, colorB: C.waterFade, alphaA: 0.95, alphaB: 0.5,
      spin: [-4, 4], turb: [0.05, 0.3], turbFreq: [2, 4],
      lightMix: 1, fadeIn: 0.02, fadeOut: 0.6, wind: 0.35,
    },
    splashGlint: {
      group: "additive", count: [8, 14], atlas: 1,
      speed: [6, 22], cone: 0.45, up: 0.9,
      life: [0.35, 0.8], drag: [0.7, 1.4], gravity: 1,
      size: [0.14, 0.5], sizeEnd: [0.1, 0.35], sizePow: 1,
      colorA: C.foam, colorB: C.water, alphaA: 0.85, alphaB: 0,
      spin: [0, 0], turb: [0, 0.1], turbFreq: [2, 4],
      lightMix: 0, fadeIn: 0.02, fadeOut: 0.35, wind: 0.35,
    },
    mist: {
      group: "alpha", count: [8, 13], atlas: 0,
      speed: [1.5, 6], cone: 0.7, up: 0.7,
      life: [0.9, 1.9], drag: [3.2, 5], gravity: 0.03,
      size: [1.2, 2.6], sizeEnd: [6, 11], sizePow: 0.5,
      colorA: C.waterFade, colorB: C.waterFade, alphaA: 0.28, alphaB: 0,
      spin: [-1, 1], turb: [0.5, 1.6], turbFreq: [1.2, 2.8],
      lightMix: 1, fadeIn: 0.14, fadeOut: 0.3, wind: 1.1,
    },
    pollenBurst: {
      group: "alpha", count: [16, 26], atlas: 0,
      speed: [3, 12], cone: 0.75, up: 0.5,
      life: [1.4, 3.2], drag: [2.2, 4.2], gravity: 0.03,
      size: [0.4, 1.1], sizeEnd: [0.5, 1.4], sizePow: 1,
      colorA: C.pollen, colorB: C.pollen, alphaA: 0.9, alphaB: 0,
      spin: [-3, 3], turb: [0.9, 2.6], turbFreq: [0.9, 2.4],
      lightMix: 1, fadeIn: 0.08, fadeOut: 0.4, wind: 1.4,
    },
    debrisBurst: {
      group: "alpha", count: [16, 26], atlas: 2,
      speed: [9, 30], cone: 0.3, up: 0.55,
      life: [0.9, 1.9], drag: [0.4, 1.0], gravity: 1,
      size: [0.25, 0.85], sizeEnd: [0.22, 0.75], sizePow: 1,
      colorA: C.chip, colorB: C.soil, alphaA: 1, alphaB: 1,
      spin: [-16, 16], turb: [0, 0.3], turbFreq: [2, 5],
      lightMix: 1, fadeIn: 0.02, fadeOut: 0.78, wind: 0.3,
    },
    leafBits: {
      group: "alpha", count: [8, 14], atlas: 2,
      speed: [5, 16], cone: 0.4, up: 0.7,
      life: [1.3, 2.6], drag: [1.6, 3.0], gravity: 0.55,
      size: [0.5, 1.5], sizeEnd: [0.5, 1.5], sizePow: 1,
      colorA: C.green, colorB: C.green, alphaA: 1, alphaB: 0.7,
      spin: [-9, 9], turb: [0.6, 1.8], turbFreq: [1.4, 3.2],
      lightMix: 1, fadeIn: 0.02, fadeOut: 0.62, wind: 1.2,
    },
    shockRing: {
      group: "additive", count: [1, 1], atlas: 3,
      speed: [0, 0], cone: 1, up: 0,
      life: [0.34, 0.4], drag: [4, 4], gravity: 0,
      size: [1.5, 2.0], sizeEnd: [16, 20], sizePow: 0.42,
      colorA: C.foam, colorB: C.dust, alphaA: 0.5, alphaB: 0,
      spin: [-0.3, 0.3], turb: [0, 0], turbFreq: [1, 1],
      lightMix: 0, fadeIn: 0.05, fadeOut: 0.2, wind: 0,
    },
    sparkle: {
      group: "additive", count: [7, 12], atlas: 1,
      speed: [3, 11], cone: 0.85, up: 0.6,
      life: [0.5, 1.1], drag: [1.8, 3.4], gravity: 0.25,
      size: [0.25, 0.75], sizeEnd: [0.02, 0.1], sizePow: 1.6,
      colorA: C.spark, colorB: C.pollen, alphaA: 1, alphaB: 0,
      spin: [0, 0], turb: [0.2, 0.9], turbFreq: [2, 6],
      lightMix: 0, fadeIn: 0.03, fadeOut: 0.25, wind: 0.6,
    },
  };

  const range = (r) => (Array.isArray(r) ? lerp(r[0], r[1], rng()) : r);

  /**
   * Fire a preset. `opts` may override count/scale/speed/colour/normal.
   * Everything is written straight into the ring buffer; nothing allocates.
   */
  function burst(name, x, y, z, opts) {
    const preset = PRESETS[name];
    if (!preset) return 0;
    const group = groups[preset.group] || groups.alpha;

    const scale = (opts && opts.scale) || 1;
    const power = clamp((opts && opts.power) || 1, 0.05, 4);
    const countScale = ((opts && opts.countScale) || 1) * clamp(density, 0.28, 1.45);
    let count = Math.round(range(preset.count) * countScale * power);
    if (count < 1) count = rng() < 0.55 * countScale * power ? 1 : 0;
    if (count <= 0) return 0;
    count = Math.min(count, 64);

    // Direction the burst is thrown along (defaults to straight up).
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (opts && opts.normal) {
      nx = opts.normal.x; ny = opts.normal.y; nz = opts.normal.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
    }

    const ground = opts && opts.groundY !== undefined ? opts.groundY : groundAt(x, z);
    const colorA = (opts && opts.colorA) || preset.colorA;
    const colorB = (opts && opts.colorB) || preset.colorB;
    const spread = (opts && opts.spread) || 0;

    for (let i = 0; i < count; i += 1) {
      // Cone around the burst normal: cone=0 is a laser, 1 is a full sphere.
      const cone = preset.cone;
      const u = rng();
      const cosTheta = lerp(1, -1, u * cone);
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const phi = rng() * TAU;

      // Build an orthonormal basis around the normal.
      _v3a.set(nx, ny, nz);
      _v3b.set(Math.abs(ny) < 0.92 ? 0 : 1, Math.abs(ny) < 0.92 ? 1 : 0, 0).cross(_v3a).normalize();
      _v3c.copy(_v3a).cross(_v3b).normalize();

      const dirX = _v3a.x * cosTheta + _v3b.x * sinTheta * Math.cos(phi) + _v3c.x * sinTheta * Math.sin(phi);
      const dirY = _v3a.y * cosTheta + _v3b.y * sinTheta * Math.cos(phi) + _v3c.y * sinTheta * Math.sin(phi);
      const dirZ = _v3a.z * cosTheta + _v3b.z * sinTheta * Math.cos(phi) + _v3c.z * sinTheta * Math.sin(phi);

      const speed = range(preset.speed) * scale * (0.55 + 0.75 * power);
      D.px = x + (rng() - 0.5) * spread;
      D.py = y + (rng() - 0.5) * spread * 0.4;
      D.pz = z + (rng() - 0.5) * spread;
      D.vx = dirX * speed;
      D.vy = dirY * speed + preset.up * speed;
      D.vz = dirZ * speed;

      D.life = range(preset.life) * ((opts && opts.lifeScale) || 1);
      D.drag = range(preset.drag);
      D.gravity = preset.gravity;
      D.seed = rng();
      D.atlas = preset.atlas;

      D.size0 = range(preset.size) * scale;
      D.size1 = range(preset.sizeEnd) * scale;
      D.rot0 = rng() * TAU;
      D.spin = range(preset.spin);

      D.cr = colorA[0]; D.cg = colorA[1]; D.cb = colorA[2];
      D.ca = preset.alphaA * ((opts && opts.alpha) || 1);
      D.dr = colorB[0]; D.dg = colorB[1]; D.db = colorB[2];
      D.da = preset.alphaB * ((opts && opts.alpha) || 1);

      D.groundY = ground;
      D.turbAmp = range(preset.turb) * scale;
      D.turbFreq = range(preset.turbFreq);
      D.lightMix = preset.lightMix;
      D.fadeIn = preset.fadeIn;
      D.fadeOut = preset.fadeOut;
      D.sizePow = preset.sizePow;
      D.windInf = preset.wind;

      group.emit(D, clockTime);
    }
    return count;
  }

  /* ============================================================
     Continuous emitters (pooled)
     ============================================================ */
  const emitters = [];
  const emitterPool = [];

  function addEmitter(config) {
    const e = emitterPool.pop() || {
      preset: "stride", rate: 6, remaining: 0, accum: 0, active: false,
      follow: null, offset: new THREEJS.Vector3(), opts: { scale: 1, power: 1, countScale: 1 },
      position: new THREEJS.Vector3(),
    };
    e.preset = config.preset;
    e.rate = config.rate || 6;
    e.remaining = config.duration === undefined ? Infinity : config.duration;
    e.accum = 0;
    e.active = true;
    e.follow = config.follow || null;
    e.offset.set(0, 0, 0);
    if (config.offset) e.offset.copy(config.offset);
    if (config.position) e.position.copy(config.position);
    e.opts.scale = config.scale || 1;
    e.opts.power = config.power || 1;
    e.opts.countScale = config.countScale || 1;
    emitters.push(e);
    return {
      stop() { e.active = false; },
      setRate(r) { e.rate = r; },
      setPower(p) { e.opts.power = p; },
    };
  }

  function updateEmitters(dt) {
    for (let i = emitters.length - 1; i >= 0; i -= 1) {
      const e = emitters[i];
      if (!e.active || e.remaining <= 0) {
        emitters.splice(i, 1);
        emitterPool.push(e);
        continue;
      }
      e.remaining -= dt;
      e.accum += e.rate * dt;
      while (e.accum >= 1) {
        e.accum -= 1;
        const p = e.follow ? _v3a.copy(e.follow).add(e.offset) : _v3a.copy(e.position);
        burst(e.preset, p.x, p.y, p.z, e.opts);
      }
    }
  }

  /* ============================================================
     Decals
     ============================================================ */
  const decalCapacity = Math.max(24, Math.round(72 * clamp(density, 0.4, 1.4)));
  const decalData = {
    posSize: new Float32Array(decalCapacity * 4),
    rotTime: new Float32Array(decalCapacity * 4),
    color: new Float32Array(decalCapacity * 4),
    corners: new Float32Array(decalCapacity * 4),
  };
  let decalCursor = 0;

  const decalGeo = ctx.track(new THREEJS.InstancedBufferGeometry());
  {
    const plane = new THREEJS.PlaneGeometry(1, 1, 1, 1);
    decalGeo.setAttribute("position", plane.getAttribute("position"));
    decalGeo.setAttribute("uv", plane.getAttribute("uv"));
    decalGeo.setIndex(plane.getIndex());
    plane.dispose();
  }
  const decalAttrs = {
    posSize: new THREEJS.InstancedBufferAttribute(decalData.posSize, 4),
    rotTime: new THREEJS.InstancedBufferAttribute(decalData.rotTime, 4),
    color: new THREEJS.InstancedBufferAttribute(decalData.color, 4),
    corners: new THREEJS.InstancedBufferAttribute(decalData.corners, 4),
  };
  for (const key of Object.keys(decalAttrs)) decalAttrs[key].setUsage(THREEJS.DynamicDrawUsage);
  decalGeo.setAttribute("dPosSize", decalAttrs.posSize);
  decalGeo.setAttribute("dRotTime", decalAttrs.rotTime);
  decalGeo.setAttribute("dColor", decalAttrs.color);
  decalGeo.setAttribute("dCorners", decalAttrs.corners);
  decalGeo.instanceCount = decalCapacity;
  decalGeo.boundingSphere = new THREEJS.Sphere(new THREEJS.Vector3(), 1e6);

  const decalUniforms = {
    uTime: shared.uTime,
    uAtlas: { value: decalTexture },
    uFogColor: shared.uFogColor,
    uFogDensity: shared.uFogDensity,
  };
  const decalMat = ctx.track(new THREEJS.ShaderMaterial({
    uniforms: decalUniforms,
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREEJS.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    side: THREEJS.DoubleSide,
    toneMapped: false,
  }));
  const decalMesh = new THREEJS.Mesh(decalGeo, decalMat);
  decalMesh.name = "VfxDecals";
  decalMesh.frustumCulled = false;
  decalMesh.renderOrder = 4;
  decalMesh.matrixAutoUpdate = false;
  root.add(decalMesh);

  const DECAL_KINDS = {
    footprint: { cell: 0, color: linRGB(0x3d2f22, [0, 0, 0]), alpha: 0.55, size: [1.1, 1.7], life: 9 },
    wetprint: { cell: 0, color: linRGB(0x241d16, [0, 0, 0]), alpha: 0.62, size: [1.2, 1.9], life: 6 },
    scuff: { cell: 1, color: linRGB(0x4a3928, [0, 0, 0]), alpha: 0.5, size: [3.5, 7], life: 14 },
    splat: { cell: 2, color: linRGB(0x3a2c1e, [0, 0, 0]), alpha: 0.62, size: [4, 9], life: 16 },
    wet: { cell: 3, color: linRGB(0x1c2a30, [0, 0, 0]), alpha: 0.42, size: [5, 12], life: 10 },
  };

  function addDecal(kind, x, y, z, opts) {
    const def = DECAL_KINDS[kind];
    if (!def) return;
    const i = decalCursor;
    decalCursor = (decalCursor + 1) % decalCapacity;

    const size = (opts && opts.size) || range(def.size);
    const rot = opts && opts.rotation !== undefined ? opts.rotation : rng() * TAU;
    const life = (opts && opts.life) || def.life;
    const alpha = def.alpha * ((opts && opts.alpha) || 1);
    const color = (opts && opts.color) || def.color;

    const base = y !== undefined && y !== null ? y : groundAt(x, z);
    const half = size * 0.5;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // Sample the four rotated corners so the quad hugs uneven ground.
    const corner = (sx, sy) => {
      const lx = sx * half;
      const ly = sy * half;
      const wx = x + (lx * c - ly * s);
      const wz = z + (lx * s + ly * c);
      return clamp(groundAt(wx, wz) - base, -half, half);
    };

    const o = i * 4;
    decalData.posSize[o] = x;
    decalData.posSize[o + 1] = base + 0.05;
    decalData.posSize[o + 2] = z;
    decalData.posSize[o + 3] = size;
    decalData.rotTime[o] = rot;
    decalData.rotTime[o + 1] = clockTime;
    decalData.rotTime[o + 2] = life;
    decalData.rotTime[o + 3] = def.cell;
    decalData.color[o] = color[0];
    decalData.color[o + 1] = color[1];
    decalData.color[o + 2] = color[2];
    decalData.color[o + 3] = alpha;
    decalData.corners[o] = corner(-1, -1);
    decalData.corners[o + 1] = corner(1, -1);
    decalData.corners[o + 2] = corner(-1, 1);
    decalData.corners[o + 3] = corner(1, 1);

    for (const key of Object.keys(decalAttrs)) decalAttrs[key].needsUpdate = true;
  }

  /* ============================================================
     Water
     ============================================================ */
  const water = {
    enabled: false,
    fallback: false,
    mesh: null,
    material: null,
    shader: null,
    level: 0,
    min: new THREEJS.Vector2(),
    size: new THREEJS.Vector2(1, 1),
    maxDepth: 1,
    depthTexture: null,
    depthGrid: null,
    gridSize: 96,
    ripples: [],
    rippleCursor: 0,
    heroInside: false,
  };
  for (let i = 0; i < 8; i += 1) water.ripples.push(new THREEJS.Vector4(0, 0, -99, 0));

  function sampleWaterDepth(x, z) {
    if (!water.enabled || !water.depthGrid) return 0;
    const u = (x - water.min.x) / water.size.x;
    const v = (z - water.min.y) / water.size.y;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const n = water.gridSize;
    const gx = clamp(Math.round(u * (n - 1)), 0, n - 1);
    const gz = clamp(Math.round(v * (n - 1)), 0, n - 1);
    return (water.depthGrid[gz * n + gx] / 255) * water.maxDepth;
  }

  /** Build the depth/shoreline field for whatever surface we adopted. */
  function buildDepthField(profileFn) {
    const n = water.gridSize;
    const grid = new Uint8Array(n * n);
    let maxDepth = 0.0001;
    const raw = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = water.min.x + (i / (n - 1)) * water.size.x;
        const z = water.min.y + (j / (n - 1)) * water.size.y;
        const d = Math.max(0, profileFn(x, z));
        raw[j * n + i] = d;
        if (d > maxDepth) maxDepth = d;
      }
    }
    for (let i = 0; i < raw.length; i += 1) grid[i] = clamp(Math.round((raw[i] / maxDepth) * 255), 0, 255);

    water.maxDepth = maxDepth;
    water.depthGrid = grid;
    const texture = new THREEJS.DataTexture(grid, n, n, THREEJS.RedFormat, THREEJS.UnsignedByteType);
    texture.minFilter = THREEJS.LinearFilter;
    texture.magFilter = THREEJS.LinearFilter;
    texture.wrapS = texture.wrapT = THREEJS.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    water.depthTexture = ctx.track(texture);
  }

  function makeWaterMaterial() {
    const material = new THREEJS.MeshPhysicalMaterial({
      color: 0x8fc8dc,
      roughness: 0.045,
      metalness: 0,
      transmission: q.dof ? 0.92 : 0,
      thickness: 6,
      ior: 1.333,
      transparent: true,
      opacity: q.dof ? 1 : 0.86,
      side: THREEJS.FrontSide,
      depthWrite: true,
      envMapIntensity: 1.25,
      clearcoat: 0.45,
      clearcoatRoughness: 0.05,
    });

    const uniforms = {
      uWaterTime: { value: 0 },
      uWaterDepth: { value: water.depthTexture },
      uWaterMin: { value: water.min },
      uWaterSize: { value: water.size },
      uWaterMaxDepth: { value: water.maxDepth },
      uRipples: { value: water.ripples },
      uFoamColor: { value: new THREEJS.Color(0xffffff) },
      uShallowColor: { value: new THREEJS.Color(0xa9dcc9) },
      uDeepColor: { value: new THREEJS.Color(0x2f6f86) },
    };

    // CHAIN, do not assign. world.js installs its own patches on this same
    // material through extendMaterial - the Fresnel sky reflection and sun
    // glint that make the surface read as water. Overwriting onBeforeCompile
    // silently deleted all of them, which is why those edits appeared to do
    // nothing and were repeatedly re-tuned in the wrong file.
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;

    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === "function") prevCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      water.shader = shader;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WATER_PARS}`)
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          #include <begin_vertex>
          vec3 vfxWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float vfxDepth = waterDepthAt(vfxWorld.xz);
          vec3 vfxField = waterField(vfxWorld.xz, vfxDepth);
          transformed.y += vfxField.x;
          vWaterWorld = vfxWorld + vec3(0.0, vfxField.x, 0.0);
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${WATER_PARS}`)
        .replace(
          "#include <normal_fragment_begin>",
          /* glsl */ `
          #include <normal_fragment_begin>
          {
            vec2 wp = vWaterWorld.xz;
            float depth = waterDepthAt(wp);
            vec3 field = waterField(wp, depth);

            /* Meniscus: at this scale surface tension pulls the skin up
               against the shoreline, so tilt the normal along the depth
               gradient wherever the water is thin.                        */
            float e = max(uWaterSize.x, uWaterSize.y) / 96.0;
            float dxp = waterDepthAt(wp + vec2(e, 0.0));
            float dxm = waterDepthAt(wp - vec2(e, 0.0));
            float dzp = waterDepthAt(wp + vec2(0.0, e));
            float dzm = waterDepthAt(wp - vec2(0.0, e));
            vec2 shoreGrad = vec2(dxp - dxm, dzp - dzm) / (2.0 * e);
            float meniscus = 1.0 - smoothstep(0.0, uWaterMaxDepth * 0.34, depth);

            vec2 slope = field.yz * 1.4 + shoreGrad * meniscus * 1.5;
            vec3 wn = normalize(vec3(-slope.x, 1.0, -slope.y));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }
          `
        )
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
          #include <color_fragment>
          {
            vec2 wp = vWaterWorld.xz;
            float depth = waterDepthAt(wp);
            float depthN = clamp(depth / max(uWaterMaxDepth, 0.001), 0.0, 1.0);

            diffuseColor.rgb *= mix(uShallowColor, uDeepColor, smoothstep(0.05, 0.75, depthN));

            /* Bright meniscus line right at the contact edge, plus a wisp
               of foam on the ripple crests.                              */
            float rim = smoothstep(0.30, 0.06, depthN) * smoothstep(0.0, 0.05, depthN);
            vec3 field = waterField(wp, depth);
            float crest = smoothstep(0.045, 0.12, field.x) * 0.35;
            float foam = clamp(rim * 1.15 + crest * depthN, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, uFoamColor, foam * 0.9);

            diffuseColor.a *= smoothstep(0.0, 0.10, depthN);
          }
          `
        )
        .replace(
          "#include <roughnessmap_fragment>",
          /* glsl */ `
          #include <roughnessmap_fragment>
          {
            float depthR = waterDepthAt(vWaterWorld.xz);
            float depthNR = clamp(depthR / max(uWaterMaxDepth, 0.001), 0.0, 1.0);
            roughnessFactor = mix(0.42, roughnessFactor, smoothstep(0.02, 0.35, depthNR));
          }
          `
        );
    };
    // Must include the chained key too, or two materials with different
    // world.js patches would share one compiled program.
    material.customProgramCacheKey = () => {
      const base = typeof prevKey === "function" ? prevKey.call(material) : "";
      return `tsim-water-v2|${base}`;
    };
    return ctx.track(material);
  }

  /** Build a radial disc with rings so a dome profile deforms smoothly. */
  function makeDiscGeometry(radius, rings, segments) {
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    positions.push(0, 0, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    for (let r = 1; r <= rings; r += 1) {
      const rad = (r / rings) * radius;
      for (let s = 0; s < segments; s += 1) {
        const a = (s / segments) * TAU;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        uvs.push(0.5 + (x / radius) * 0.5, 0.5 + (z / radius) * 0.5);
      }
    }
    for (let s = 0; s < segments; s += 1) {
      indices.push(0, 1 + s, 1 + ((s + 1) % segments));
    }
    for (let r = 1; r < rings; r += 1) {
      const a0 = 1 + (r - 1) * segments;
      const b0 = 1 + r * segments;
      for (let s = 0; s < segments; s += 1) {
        const s1 = (s + 1) % segments;
        indices.push(a0 + s, b0 + s, b0 + s1);
        indices.push(a0 + s, b0 + s1, a0 + s1);
      }
    }
    const geo = new THREEJS.BufferGeometry();
    geo.setAttribute("position", new THREEJS.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREEJS.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREEJS.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  function findWorldWater() {
    if (!ctx.world) return null;
    if (ctx.world.water && ctx.world.water.isObject3D) return ctx.world.water;
    if (ctx.world.water && ctx.world.water.mesh) return ctx.world.water.mesh;
    if (!ctx.world.root) return null;

    let waterMaterial = null;
    try { waterMaterial = ctx.materials.get("water"); } catch (error) { waterMaterial = null; }

    let found = null;
    ctx.world.root.traverse((node) => {
      if (found || !node.isMesh) return;
      const name = (node.name || "").toLowerCase();
      if (/water|puddle|pond|pool|droplet/.test(name)) { found = node; return; }
      if (waterMaterial && node.material === waterMaterial) found = node;
    });
    return found;
  }

  function setupWater() {
    const adopted = findWorldWater();
    const box = new THREEJS.Box3();

    if (adopted) {
      adopted.updateWorldMatrix(true, false);
      box.setFromObject(adopted);
      water.mesh = adopted;
      water.level = box.max.y;
      const pad = Math.max(1, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.04);
      water.min.set(box.min.x - pad, box.min.z - pad);
      water.size.set((box.max.x - box.min.x) + pad * 2, (box.max.z - box.min.z) + pad * 2);
      buildDepthField((x, z) => water.level - groundAt(x, z));
      water.material = makeWaterMaterial();
      adopted.material = water.material;
      adopted.renderOrder = 2;
      water.enabled = true;
      water.fallback = false;
      return;
    }

    /* No puddle in the world yet: grow our own water bead so the effect
       is testable, and so the game is never missing its water shot. A
       real 0.5 mm droplet is held into a dome by surface tension, which
       is exactly the silhouette we want anyway. */
    const worldRadius = (ctx.world && ctx.world.bounds && ctx.world.bounds.radius) || 150;
    const radius = clamp(worldRadius * 0.19, 16, 46);
    const cx = worldRadius * 0.24;
    const cz = worldRadius * -0.2;
    const domeHeight = radius * 0.2;
    const baseY = groundAt(cx, cz);

    const profile = (x, z) => {
      const d = Math.hypot(x - cx, z - cz) / radius;
      if (d >= 1) return 0;
      return domeHeight * Math.pow(1 - Math.pow(d, 3.1), 0.52);
    };

    water.level = baseY;
    water.min.set(cx - radius * 1.02, cz - radius * 1.02);
    water.size.set(radius * 2.04, radius * 2.04);
    buildDepthField(profile);

    const geo = ctx.track(makeDiscGeometry(radius * 1.0, 30, 96));
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      pos.setY(i, profile(x, z));
    }
    // Analytic-ish normals from neighbouring profile samples.
    const eps = radius * 0.02;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const dx = (profile(x + eps, z) - profile(x - eps, z)) / (2 * eps);
      const dz = (profile(x, z + eps) - profile(x, z - eps)) / (2 * eps);
      _v3a.set(-dx, 1, -dz).normalize();
      nor.setXYZ(i, _v3a.x, _v3a.y, _v3a.z);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    geo.computeBoundingSphere();

    water.material = makeWaterMaterial();
    const mesh = new THREEJS.Mesh(geo, water.material);
    mesh.name = "VfxWaterBead";
    mesh.position.set(cx, baseY, cz);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = 2;
    root.add(mesh);
    water.mesh = mesh;
    water.enabled = true;
    water.fallback = true;
    water.level = baseY + domeHeight;
  }

  try {
    setupWater();
  } catch (error) {
    console.warn("[vfx] water surface unavailable:", error);
    water.enabled = false;
  }

  function ripple(x, z, strength) {
    if (!water.enabled) return;
    const slot = water.ripples[water.rippleCursor];
    water.rippleCursor = (water.rippleCursor + 1) % water.ripples.length;
    slot.set(x, z, clockTime, clamp(strength, 0.05, 3));
  }

  function isOverWater(x, z) {
    return water.enabled && sampleWaterDepth(x, z) > water.maxDepth * 0.04;
  }

  /* ============================================================
     Wind
     ============================================================ */
  const wind = shared.uWind.value;
  const windBase = new THREEJS.Vector3(0.9, 0.05, 0.55);
  let windPhase = 0;

  /* ============================================================
     Shake
     ============================================================ */
  const shake = new ShakeRig();

  /* ============================================================
     Gameplay event wiring
     ============================================================ */
  let sawRealLandEvent = false;
  const heroState = { curled: false, rolling: false, ragdoll: false };

  function onLand(payload) {
    const p = (payload && payload.position) || (ctx.player && ctx.player.position);
    if (!p) return;
    const speed = Math.abs((payload && payload.impactSpeed) || 6);
    const power = clamp(speed / 14, 0.18, 2.6);
    const ground = groundAt(p.x, p.z);

    if (isOverWater(p.x, p.z)) {
      splashAt(p.x, water.level, p.z, power);
      return;
    }

    burst("landPuff", p.x, ground, p.z, { power, spread: 1.4 + power * 1.6, groundY: ground });
    if (power > 0.55) {
      burst("chips", p.x, ground + 0.2, p.z, { power: power * 0.8, spread: 1.2, groundY: ground });
      burst("shockRing", p.x, ground + 0.12, p.z, { scale: 0.5 + power * 0.9, groundY: ground });
    }
    if (power > 0.85) {
      addDecal("scuff", p.x, ground, p.z, { size: 3 + power * 3.4, alpha: clamp(power * 0.5, 0.2, 0.75) });
      burst("soilSpray", p.x, ground + 0.2, p.z, { power: power * 0.7, spread: 1.2, groundY: ground });
    }
    shake.add(clamp(power * 0.24, 0, 0.5), 0.32 + power * 0.12);
  }

  function onJump(payload) {
    const p = (payload && payload.position) || (ctx.player && ctx.player.position);
    if (!p) return;
    const ground = groundAt(p.x, p.z);
    if (isOverWater(p.x, p.z)) {
      splashAt(p.x, water.level, p.z, 0.5);
      return;
    }
    burst("jumpPuff", p.x, ground, p.z, { spread: 1.2, groundY: ground });
  }

  function onImpact(payload) {
    if (!payload || !payload.position) return;
    const p = payload.position;
    const speed = Math.abs(payload.speed || 8);
    const power = clamp(speed / 16, 0.15, 2.4);
    const ground = groundAt(p.x, p.z);
    const normal = payload.normal || null;

    if (isOverWater(p.x, p.z)) {
      splashAt(p.x, water.level, p.z, power);
      return;
    }

    const kind = String(payload.material || "").toLowerCase();
    if (kind === "soil" || kind === "moss") {
      burst("soilSpray", p.x, p.y, p.z, { power, normal, spread: 0.8, groundY: ground });
      burst("landPuff", p.x, p.y, p.z, { power: power * 0.6, normal, spread: 1.2, groundY: ground });
    } else if (kind === "leaf") {
      burst("leafBits", p.x, p.y, p.z, { power, normal, spread: 0.9, groundY: ground });
    } else {
      burst("chips", p.x, p.y, p.z, { power, normal, spread: 0.7, groundY: ground });
      burst("landPuff", p.x, p.y, p.z, { power: power * 0.45, normal, spread: 1.0, groundY: ground });
      if (power > 0.7) burst("sparkle", p.x, p.y, p.z, { power: power * 0.5, normal, spread: 0.5, groundY: ground });
    }
    if (power > 0.4) burst("shockRing", p.x, ground + 0.12, p.z, { scale: 0.4 + power * 0.7, groundY: ground });
    shake.add(clamp(power * 0.2, 0, 0.45), 0.26);
  }

  function onPropDestroyed(payload) {
    if (!payload || !payload.position) return;
    const p = payload.position;
    const ground = groundAt(p.x, p.z);
    const kind = String(payload.kind || "").toLowerCase();
    burst("debrisBurst", p.x, p.y, p.z, { power: 1.2, spread: 1.6, groundY: ground });
    burst("landPuff", p.x, p.y, p.z, { power: 1.1, spread: 2.4, groundY: ground });
    if (/leaf|petal|flower|moss|grass/.test(kind)) {
      burst("leafBits", p.x, p.y, p.z, { power: 1.1, spread: 1.4, groundY: ground });
      burst("pollenBurst", p.x, p.y, p.z, { power: 1, spread: 1.6, groundY: ground });
    }
    burst("shockRing", p.x, ground + 0.14, p.z, { scale: 1.4, groundY: ground });
    addDecal("splat", p.x, ground, p.z, { size: 5 + rng() * 4 });
    shake.add(0.34, 0.42);
  }

  function splashAt(x, y, z, power) {
    const p = clamp(power, 0.15, 2.6);
    burst("splash", x, y, z, { power: p, spread: 1.2, groundY: y - 0.4 });
    burst("splashGlint", x, y, z, { power: p, spread: 1.0, groundY: y - 0.4 });
    burst("mist", x, y + 0.4, z, { power: p * 0.8, spread: 2.0, groundY: y - 0.2 });
    burst("shockRing", x, y + 0.05, z, { scale: 0.6 + p, groundY: y - 0.1 });
    ripple(x, z, 0.5 + p * 0.9);
    shake.add(clamp(p * 0.16, 0, 0.35), 0.3);
  }

  const unsubscribe = [
    ctx.events.on("player:land", (payload) => { sawRealLandEvent = true; onLand(payload); }),
    ctx.events.on("player:jump", onJump),
    ctx.events.on("impact", onImpact),
    ctx.events.on("prop:destroyed", onPropDestroyed),
    ctx.events.on("player:ragdoll", (payload) => {
      heroState.ragdoll = Boolean(payload && payload.enabled);
      if (heroState.ragdoll) shake.add(0.22, 0.4);
    }),
    ctx.events.on("player:roll", (payload) => {
      heroState.rolling = payload === undefined ? true : Boolean(payload && payload.enabled !== false);
    }),
    ctx.events.on("player:grapple", (payload) => {
      if (!payload || !payload.to) return;
      burst("sparkle", payload.to.x, payload.to.y, payload.to.z, { power: 0.7, spread: 0.6 });
    }),
    ctx.events.on("score", (payload) => {
      if (!payload || !payload.position) return;
      burst("sparkle", payload.position.x, payload.position.y + 1, payload.position.z, {
        power: clamp((payload.amount || 100) / 250, 0.4, 2), spread: 1.2,
      });
    }),
    ctx.events.on("settings:quality", () => applyQuality()),
  ];

  function applyQuality() {
    const nq = ctx.settings.quality;
    const d = clamp(nq.particles || 1, 0.2, 2);
    const ratio = d / density;
    for (const layer of airLayers) {
      const live = clamp(Math.round(layer.count * ratio), 8, layer.count);
      layer.live = live;
      if (layer.spec.kind === "quad") layer.geometry.instanceCount = live;
      else layer.geometry.setDrawRange(0, live);
    }
    if (water.material) {
      water.material.transmission = nq.dof ? 0.92 : 0;
      water.material.opacity = nq.dof ? 1 : 0.86;
      water.material.needsUpdate = true;
    }
  }
  applyQuality();

  /* ============================================================
     Hero-driven ambience (works with or without gameplay events)
     ============================================================ */
  const lastHeroPos = new THREEJS.Vector3();
  let heroInit = false;
  let strideAccum = 0;
  let wasGrounded = true;
  let lastFallSpeed = 0;
  let wetFeet = 0;
  let footAccum = 0;
  let footSide = 1;

  function updateHero(dt) {
    const player = ctx.player;
    if (!player || !player.position) return;
    const p = player.position;
    if (!heroInit) {
      lastHeroPos.copy(p);
      heroInit = true;
      return;
    }

    _v3a.copy(p).sub(lastHeroPos);
    const travelled = _v3a.length();
    const speed = dt > 0 ? travelled / dt : 0;
    const ground = groundAt(p.x, p.z);
    const height = p.y - ground;
    const grounded = height < 0.85;
    const fallSpeed = dt > 0 ? -(p.y - lastHeroPos.y) / dt : 0;

    /* If player.js is not emitting land events yet, synthesise them so
       the world still reacts. Disables itself the moment a real event
       arrives. */
    if (!sawRealLandEvent) {
      if (grounded && !wasGrounded && lastFallSpeed > 2.5) {
        onLand({ position: p, impactSpeed: lastFallSpeed });
      }
      if (!grounded && wasGrounded && p.y > lastHeroPos.y) {
        onJump({ position: p });
      }
    }

    /* Scampering kicks up dust; curled + rolling leaves a proper trail. */
    if (grounded && speed > 2.2) {
      const rolling = heroState.rolling || heroState.curled;
      const rate = rolling ? speed * 0.85 : speed * 0.4;
      strideAccum += rate * dt;
      while (strideAccum >= 1) {
        strideAccum -= 1;
        const bx = p.x - _v3a.x * 0.35;
        const bz = p.z - _v3a.z * 0.35;
        if (isOverWater(bx, bz)) {
          ripple(bx, bz, 0.28);
          burst("splash", bx, water.level, bz, { power: 0.28, spread: 0.7, groundY: water.level - 0.3 });
          wetFeet = 1;
        } else {
          burst(rolling ? "rollTrail" : "stride", bx, ground, bz, {
            power: clamp(speed / 14, 0.25, 1.8), spread: 0.9, groundY: ground,
          });
        }
      }

      /* Wet footprints for a while after leaving the water. */
      if (wetFeet > 0 && !isOverWater(p.x, p.z)) {
        footAccum += speed * dt;
        if (footAccum > 2.6) {
          footAccum = 0;
          footSide = -footSide;
          const yaw = Math.atan2(_v3a.x, _v3a.z);
          addDecal("wetprint",
            p.x + Math.cos(yaw) * 0.5 * footSide,
            ground,
            p.z - Math.sin(yaw) * 0.5 * footSide,
            { rotation: -yaw, alpha: wetFeet, life: 5 + wetFeet * 4 });
          wetFeet = Math.max(0, wetFeet - 0.14);
        }
      }
    }

    if (isOverWater(p.x, p.z) && height < 1.6) {
      wetFeet = 1;
      if (!water.heroInside) {
        water.heroInside = true;
        splashAt(p.x, water.level, p.z, clamp(Math.max(speed, lastFallSpeed) / 12, 0.3, 1.8));
      }
      ripple(p.x, p.z, 0.1 + clamp(speed / 30, 0, 0.3));
    } else if (water.heroInside && !isOverWater(p.x, p.z)) {
      water.heroInside = false;
    }

    wasGrounded = grounded;
    lastFallSpeed = Math.max(0, fallSpeed);
    lastHeroPos.copy(p);
  }

  /* ============================================================
     Frame update
     ============================================================ */
  function refreshEnvironmentUniforms() {
    if (ctx.engine && ctx.engine.sun) {
      if (ctx.engine.sun.direction) sunDir.copy(ctx.engine.sun.direction);
      if (ctx.engine.sun.light) {
        sunColor.copy(ctx.engine.sun.light.color)
          .multiplyScalar(clamp(ctx.engine.sun.light.intensity * 0.42, 0.4, 3));
      }
    }
    if (ctx.scene.fog) {
      if (ctx.scene.fog.color) fogColor.copy(ctx.scene.fog.color);
      if (ctx.scene.fog.density !== undefined) shared.uFogDensity.value = ctx.scene.fog.density;
    } else {
      shared.uFogDensity.value = 0;
    }
  }

  let envTick = 0;

  /* ---------------- underwater particulate ----------------
   * Suspended detritus is the cue that turns a blue screen into a VOLUME:
   * it gives the water something to have depth through, and it parallaxes
   * as you move, which nothing else underwater does.
   *
   * Note this is the one place point motes actually work. Against a bright
   * sky they are invisible (verified at 3x magnification - they draw as
   * faint dark specks and read as dirt), but underwater the background is
   * dark blue-green, so pale motes have something to sit against. */
  const MOTE_COUNT = 460;
  const MOTE_BOX = 26;              // half-extent of the box that follows you
  const motePos = new Float32Array(MOTE_COUNT * 3);
  const moteSeed = new Float32Array(MOTE_COUNT);
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    motePos[i * 3] = (Math.random() * 2 - 1) * MOTE_BOX;
    motePos[i * 3 + 1] = (Math.random() * 2 - 1) * MOTE_BOX;
    motePos[i * 3 + 2] = (Math.random() * 2 - 1) * MOTE_BOX;
    moteSeed[i] = Math.random();
  }
  const moteGeo = new THREEJS.BufferGeometry();
  moteGeo.setAttribute("position", new THREEJS.BufferAttribute(motePos, 3));
  // A soft round sprite. PointsMaterial with no map draws a hard SQUARE,
  // which at any visible size reads as digital confetti rather than silt.
  const moteTex = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const g2d = canvas.getContext("2d");
    const grad = g2d.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g2d.fillStyle = grad;
    g2d.fillRect(0, 0, 32, 32);
    return new THREEJS.CanvasTexture(canvas);
  })();
  const moteMat = new THREEJS.PointsMaterial({
    // 0.26 was invisible - about a pixel at swimming distance. Proved by
    // forcing size 3: the motes were drawing correctly the whole time, they
    // were simply too small to see, which is the same sub-pixel trap the
    // air motes fell into.
    size: 0.78,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    // HDR: this is an UNLIT material, so its colour goes straight through
    // tone mapping. Anything at or below 1.0 is mapped down to roughly the
    // brightness of the water behind it and disappears.
    color: new THREEJS.Color(2.4, 2.7, 2.55),
    map: moteTex,
    // depthWrite MUST be on. With it off, the depth buffer at a mote pixel
    // holds whatever is far behind it, so the underwater pass applies
    // full-distance absorption there and replaces the mote with deep water
    // tint - the particles were being drawn and then erased by the fog that
    // is supposed to sit behind them. alphaTest keeps only the solid centre
    // writing depth, so the soft edges still blend.
    alphaTest: 0.25,
    depthWrite: true,
  });
  const motes = new THREEJS.Points(moteGeo, moteMat);
  motes.name = "UnderwaterMotes";
  motes.frustumCulled = false;
  motes.visible = false;
  root.add(motes);
  let wasSubmerged = false;

  function submergedAt(pos) {
    if (!ctx.world || !ctx.world.waterAt) return false;
    const level = ctx.world.waterAt(pos.x, pos.z);
    return level !== null && level !== undefined && pos.y < level;
  }

  function updateMotes(dt) {
    const cam = ctx.camera;
    if (!cam) return;
    const sub = submergedAt(cam.position);
    motes.visible = sub;
    if (!sub) { wasSubmerged = false; return; }

    const arr = moteGeo.attributes.position.array;
    if (!wasSubmerged) {
      // Re-seed around the camera on entry. Wrapping alone would take many
      // frames to walk the cloud across the map from wherever it last was.
      for (let i = 0; i < MOTE_COUNT; i += 1) {
        arr[i * 3] = cam.position.x + (Math.random() * 2 - 1) * MOTE_BOX;
        arr[i * 3 + 1] = cam.position.y + (Math.random() * 2 - 1) * MOTE_BOX;
        arr[i * 3 + 2] = cam.position.z + (Math.random() * 2 - 1) * MOTE_BOX;
      }
      wasSubmerged = true;
    }

    const t = ctx.time ? ctx.time.elapsed : 0;
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const k = i * 3;
      const seed = moteSeed[i];
      arr[k + 1] += (0.3 + seed * 0.55) * dt;                       // slow rise
      arr[k] += Math.sin(t * 0.5 + seed * 9) * 0.5 * dt;            // sway
      arr[k + 2] += Math.cos(t * 0.43 + seed * 7) * 0.5 * dt;
      // Wrap into the box centred on the camera so a small count still
      // surrounds the viewer wherever they swim.
      const c = [cam.position.x, cam.position.y, cam.position.z];
      for (let a = 0; a < 3; a += 1) {
        const d = arr[k + a] - c[a];
        if (d > MOTE_BOX) arr[k + a] -= MOTE_BOX * 2;
        else if (d < -MOTE_BOX) arr[k + a] += MOTE_BOX * 2;
      }
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  function update(dt) {
    const started = performance.now();
    clockTime += dt;
    shared.uTime.value = clockTime;

    /* Wind: a steady breeze with slow gusts. Everything that drifts
       reads this, which ties the whole frame together. */
    windPhase += dt;
    const gust = 0.55 + 0.45 * Math.sin(windPhase * 0.37) * Math.sin(windPhase * 0.11 + 1.7);
    wind.set(
      windBase.x * gust + Math.sin(windPhase * 0.23) * 0.28,
      windBase.y * gust,
      windBase.z * gust + Math.cos(windPhase * 0.19) * 0.24
    );

    envTick += dt;
    if (envTick > 0.25) { envTick = 0; refreshEnvironmentUniforms(); }

    updateHero(dt);
    updateEmitters(dt);
    updateMotes(dt);
    shake.update(dt);

    if (water.enabled && water.shader && water.shader.uniforms.uWaterTime) {
      water.shader.uniforms.uWaterTime.value = clockTime;
    }

    perf.push(performance.now() - started);
  }

  function lateUpdate() {
    groups.alpha.flush();
    groups.additive.flush();
  }

  /* ============================================================
     Public API
     ============================================================ */
  const api = {
    root,
    wind,
    presets: Object.keys(PRESETS),

    /* --- camera shake ------------------------------------------------
       player.js owns the camera. Call shake() to add trauma, then read
       the offset once per frame after positioning the camera:

         const off = ctx.vfx.getShakeOffset(tmpVec3, tmpEuler);
         camera.position.add(off.applyQuaternion(camera.quaternion));
         camera.rotateX(tmpEuler.x);
         camera.rotateY(tmpEuler.y);
         camera.rotateZ(tmpEuler.z);

       The vector is in CAMERA LOCAL space (units) and the euler is in
       radians. Both are zero while ctx.qa.cameraLocked is true. */
    shake(intensity, duration) { shake.add(intensity, duration); },
    getShakeOffset(outVec3, outEuler) {
      const locked = ctx.qa && ctx.qa.cameraLocked;
      if (outVec3) {
        if (locked) outVec3.set(0, 0, 0);
        else outVec3.copy(shake.offset);
      }
      if (outEuler) {
        if (locked) outEuler.set(0, 0, 0);
        else outEuler.set(shake.euler.x, shake.euler.y, shake.euler.z);
      }
      return outVec3;
    },
    get shakeTrauma() { return shake.trauma; },
    get shakeAmount() { return shake.amount; },

    /* --- particles ---------------------------------------------------- */
    burst,
    spawn(name, position, opts) {
      if (!position) return 0;
      return burst(name, position.x, position.y, position.z, opts);
    },
    addEmitter,

    /* --- decals --------------------------------------------------------- */
    decal: addDecal,

    /* --- water ---------------------------------------------------------- */
    ripple,
    splash: splashAt,
    isOverWater,
    waterDepthAt: sampleWaterDepth,
    get waterLevel() { return water.level; },
    /** world.js may hand us its puddle mesh instead of us guessing. */
    registerWater(mesh) {
      if (!mesh || !mesh.isMesh) return false;
      try {
        if (water.mesh && water.fallback) {
          root.remove(water.mesh);
          water.fallback = false;
        }
        const box = new THREEJS.Box3().setFromObject(mesh);
        water.mesh = mesh;
        water.level = box.max.y;
        const pad = Math.max(1, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.04);
        water.min.set(box.min.x - pad, box.min.z - pad);
        water.size.set((box.max.x - box.min.x) + pad * 2, (box.max.z - box.min.z) + pad * 2);
        buildDepthField((x, z) => water.level - groundAt(x, z));
        water.material = makeWaterMaterial();
        mesh.material = water.material;
        water.enabled = true;
        return true;
      } catch (error) {
        console.warn("[vfx] registerWater failed:", error);
        return false;
      }
    },

    /* --- hero state (player.js may push this instead of emitting) ------- */
    setHeroState(next) { Object.assign(heroState, next || {}); },

    /* --- wind ------------------------------------------------------------ */
    setWind(x, y, z) { windBase.set(x, y, z); },

    /* --- lifecycle -------------------------------------------------------- */
    update,
    lateUpdate,

    resize() { camToken = -1; },

    report() {
      const air = {};
      let airTotal = 0;
      for (const layer of airLayers) {
        const live = layer.live === undefined ? layer.count : layer.live;
        air[layer.spec.id] = live;
        airTotal += live;
      }
      return {
        air,
        airTotal,
        dust: air.mid + air.far + air.deep,
        pollen: air.pollen,
        particleCapacity: groups.alpha.capacity + groups.additive.capacity,
        alive: groups.alpha.alive(clockTime) + groups.additive.alive(clockTime),
        spawned: groups.alpha.spawned + groups.additive.spawned,
        emitters: emitters.length,
        decals: decalCapacity,
        drawCalls: airLayers.length + 3 + (water.enabled ? 1 : 0),
        water: water.enabled
          ? {
            fallback: water.fallback,
            level: Number(water.level.toFixed(2)),
            maxDepth: Number(water.maxDepth.toFixed(2)),
            transmission: water.material ? water.material.transmission : 0,
          }
          : null,
        shakeTrauma: Number(shake.trauma.toFixed(3)),
        softParticles: softDisabled ? "off" : "analytic-ground",
        cpuMs: Number(perf.mean.toFixed(3)),
        cpuMsP90: Number(perf.percentile(0.9).toFixed(3)),
      };
    },

    dispose() {
      for (const off of unsubscribe) { if (typeof off === "function") off(); }
      root.removeFromParent();
    },
  };

  ctx.vfx = api;
  void softDisabled;
  return api;
}
