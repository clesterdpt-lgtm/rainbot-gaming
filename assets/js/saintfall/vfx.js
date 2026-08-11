/* ============================================================
   SAINTFALL - atmosphere in motion

   A still desert reads as a diorama. Six systems, all of them
   animated on the GPU from a single time uniform so the CPU cost
   is a handful of uniform writes per frame:

     1. Wind streamers - sand lifting off the dune crests and
        running downwind. The single most identifiable thing in the
        reference, and the reason an empty dune field still holds a
        frame.
     2. Airborne dust - fine motes that catch the low sun.
     3. Banners - cloth on a standing wave, from the pylons, the
        nave and every grave marker on the map.
     4. Fire and smoke - braziers, flare stacks, the burning wreck.
     5. Light shafts - the rose window down the nave, and slots of
        light between the Choir Spires.
     6. Spores - the Bloom's own weather.

   Everything shares the wind vector from the atmosphere model, so
   the streamers, the banners and the smoke all lean the same way.
   Getting that wrong is subtle and instantly wrong-looking.
   ============================================================ */

import { TAU, clamp01, lerp, makeRng, hexToRgb } from "saintfall/core.js";
import { srgbTransfer as srgb, patchMaterial } from "saintfall/art.js";
import { mergeGeometries } from "saintfall/structures.js";

/* ============================================================
   WIND STREAMERS
   ============================================================ */

const STREAM_VERT = /* glsl */`
precision highp float;
attribute float aSeed;
attribute float aT;
attribute float aSide;
attribute float aScale;

uniform float uTime;
uniform vec3  uWind;        // x, z, speed
uniform vec3  uAnchor;      // camera position, snapped
uniform float uRange;
uniform float uGround;      // fallback ground height
uniform float uStorm;

varying float vFade;
varying float vT;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec2 wind = normalize(uWind.xy);
  float speed = uWind.z * mix(11.0, 34.0, uStorm);

  // Every strip starts from a scattered origin and runs downwind,
  // wrapping inside a box that follows the camera. Wrapping in the
  // shader means the whole system is one draw call that never
  // touches the CPU.
  float sx = h11(aSeed) * 2.0 - 1.0;
  float sz = h11(aSeed + 11.3) * 2.0 - 1.0;
  float life = 4.5 + h11(aSeed + 3.1) * 5.0;
  float phase = h11(aSeed + 7.7);
  float t = fract(uTime / life + phase);

  vec3 origin = uAnchor + vec3(sx * uRange, 0.0, sz * uRange);
  float travel = t * speed * life;

  vec3 p = origin;
  // Shorter than the first pass by half. Long straight ribbons read
  // as scratches on the lens, not as sand.
  p.xz += wind * (travel + aT * aScale * 4.2);
  // Lift: sand leaves the crest, rises, then settles. The tail of
  // the wisp lags below the head, which is what curves it.
  float rise = sin(t * 3.14159) * (1.2 + h11(aSeed + 2.2) * 2.6);
  p.y = uGround + 0.30 + rise * (0.35 + aT * 0.75)
      + sin(uTime * 2.1 + aSeed * 9.0 + aT * 4.0) * 0.28;
  // Lateral meander, so no two wisps are parallel.
  p.xz += vec2(-wind.y, wind.x) * sin(aT * 2.6 + aSeed * 3.0) * aScale * 0.9;

  // Ribbon width, pinched at both ends so it reads as a wisp.
  vec2 side = vec2(-wind.y, wind.x);
  float w = sin(aT * 3.14159) * 0.10 * aScale * (0.6 + h11(aSeed + 5.5));
  p.xz += side * aSide * w;
  p.y += aSide * w * 0.35;

  // Fade at birth, at death, and with distance from the camera.
  float ends = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.62, 1.0, t));
  float d = length(p.xz - uAnchor.xz);
  float near = smoothstep(2.0, 9.0, d);
  float far = 1.0 - smoothstep(uRange * 0.55, uRange, d);
  vFade = ends * near * far * sin(aT * 3.14159);
  vT = aT;

  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const STREAM_FRAG = /* glsl */`
precision highp float;
varying float vFade;
varying float vT;
uniform vec3 uColour;
uniform float uOpacity;
void main() {
  if (vFade <= 0.002) discard;
  gl_FragColor = vec4(uColour, vFade * uOpacity);
}
`;

function buildStreamers(ctx, opts = {}) {
  const { THREE, atmos } = ctx;
  const count = opts.count || 260;
  const segs = 7;
  const rng = makeRng(opts.seed || 0x57e4);

  const pos = [];
  const seed = [];
  const tArr = [];
  const side = [];
  const scale = [];
  const idx = [];

  for (let i = 0; i < count; i += 1) {
    const s = rng() * 1000;
    const sc = rng.range(0.6, 2.4);
    const base = pos.length / 3;
    for (let k = 0; k <= segs; k += 1) {
      const t = k / segs;
      for (const sd of [-1, 1]) {
        pos.push(0, 0, 0);
        seed.push(s);
        tArr.push(t);
        side.push(sd);
        scale.push(sc);
      }
    }
    for (let k = 0; k < segs; k += 1) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  geo.setAttribute("aT", new THREE.Float32BufferAttribute(tArr, 1));
  geo.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute("aScale", new THREE.Float32BufferAttribute(scale, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: atmos.uniforms.uTimeSF,
      uWind: atmos.uniforms.uWind,
      uStorm: atmos.uniforms.uStorm,
      uAnchor: { value: new THREE.Vector3() },
      uRange: { value: opts.range || 130 },
      uGround: { value: 0 },
      // Explicit, and in linear. Left at the default this is black,
      // and 300 black ribbons over a gold dune field read as damage
      // to the film rather than as blowing sand.
      uColour: { value: new THREE.Color().setRGB(
        srgb(0.96), srgb(0.86), srgb(0.68), THREE.LinearSRGBColorSpace
      ) },
      uOpacity: { value: opts.opacity ?? 0.30 },
    },
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.name = "streamers";
  return { mesh, mat };
}

/* ============================================================
   POINT SYSTEMS
   Dust, spores, embers, smoke. All the same shader with different
   constants - a soft round sprite generated in the fragment
   shader, so there is no texture to load and no atlas to keep in
   sync.
   ============================================================ */

const POINT_VERT = /* glsl */`
precision highp float;
attribute float aSeed;
attribute float aSize;

uniform float uTime;
uniform vec3  uWind;
uniform vec3  uAnchor;
uniform vec3  uBox;         // half extents
uniform float uRise;
uniform float uDrift;
uniform float uLifeScale;
uniform float uPixelScale;

varying float vFade;
varying float vSeed;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec2 wind = normalize(uWind.xy);
  float life = (4.0 + h11(aSeed + 1.7) * 8.0) * uLifeScale;
  float t = fract(uTime / life + h11(aSeed + 4.4));

  vec3 base = uAnchor + vec3(
    (h11(aSeed) * 2.0 - 1.0) * uBox.x,
    (h11(aSeed + 2.3) * 2.0 - 1.0) * uBox.y,
    (h11(aSeed + 5.9) * 2.0 - 1.0) * uBox.z
  );
  vec3 p = base;
  p.xz += wind * t * life * uDrift;
  p.y += t * life * uRise;
  // A little wander, so a field of motes does not move as a block.
  p.x += sin(uTime * 0.7 + aSeed * 4.0) * 0.9;
  p.z += cos(uTime * 0.62 + aSeed * 6.0) * 0.9;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vFade = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.55, 1.0, t))
        * (1.0 - smoothstep(uBox.x * 0.55, uBox.x * 1.05, length(p.xz - uAnchor.xz)))
        * smoothstep(0.6, 4.0, d);
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
  // Capped. Uncapped, a mote three metres from the lens draws a
  // 300px disc, the bloom pass finds it, and the frame fills with
  // bokeh that reads as a dirty lens rather than as airborne sand.
  gl_PointSize = clamp(aSize * uPixelScale / max(d, 0.4), 1.0, 26.0);
}
`;

const POINT_FRAG = /* glsl */`
precision highp float;
varying float vFade;
varying float vSeed;
uniform vec3 uColourA;
uniform vec3 uColourB;
uniform float uOpacity;
void main() {
  if (vFade <= 0.002) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 1.6);
  vec3 col = mix(uColourA, uColourB, fract(vSeed * 0.37));
  gl_FragColor = vec4(col, a * vFade * uOpacity);
}
`;

function buildPoints(ctx, opts = {}) {
  const { THREE, atmos } = ctx;
  const count = opts.count || 700;
  const rng = makeRng(opts.seed || 0xd057);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seed[i] = rng() * 1000;
    size[i] = rng.range(opts.size?.[0] ?? 8, opts.size?.[1] ?? 26);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const ca = hexToRgb(opts.colourA || "#e8c48c");
  const cb = hexToRgb(opts.colourB || "#c98d5a");
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: atmos.uniforms.uTimeSF,
      uWind: atmos.uniforms.uWind,
      uAnchor: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(...(opts.box || [90, 26, 90])) },
      uRise: { value: opts.rise ?? 0.35 },
      uDrift: { value: opts.drift ?? 1.4 },
      uLifeScale: { value: opts.lifeScale ?? 1 },
      uPixelScale: { value: opts.pixelScale ?? 90 },
      uColourA: { value: new THREE.Vector3(srgb(ca[0]), srgb(ca[1]), srgb(ca[2])) },
      uColourB: { value: new THREE.Vector3(srgb(cb[0]), srgb(cb[1]), srgb(cb[2])) },
      uOpacity: { value: opts.opacity ?? 0.5 },
    },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 9;
  points.name = opts.name || "points";
  return { points, mat };
}

/* ============================================================
   FIXED EMITTERS
   Fire, smoke, steam and spore columns that stay where the world
   put them. Same shader family, but anchored rather than camera-
   following.
   ============================================================ */

const PLUME_VERT = /* glsl */`
precision highp float;
attribute float aSeed;
attribute float aSize;
attribute vec3 aOrigin;
attribute float aScale;

uniform float uTime;
uniform vec3  uWind;
uniform float uRise;
uniform float uSpread;
uniform float uLife;
uniform float uPixelScale;
varying float vFade;
varying float vLife;
varying float vSeed;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec2 wind = normalize(uWind.xy);
  float life = uLife * (0.6 + h11(aSeed + 1.1) * 0.8);
  float t = fract(uTime / life + h11(aSeed + 3.3));

  vec3 p = aOrigin;
  float climb = t * uRise * life * aScale;
  p.y += climb;
  // Drift downwind, more the higher it gets.
  p.xz += wind * climb * uSpread * 0.55;
  p.x += sin(uTime * 1.3 + aSeed * 5.0) * climb * 0.10;
  p.z += cos(uTime * 1.1 + aSeed * 7.0) * climb * 0.10;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vFade = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.35, 1.0, t));
  vLife = t;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(
    aSize * aScale * (0.4 + t * 1.9) * uPixelScale / max(d, 0.4), 1.0, 190.0
  );
}
`;

const PLUME_FRAG = /* glsl */`
precision highp float;
varying float vFade;
varying float vLife;
varying float vSeed;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uOpacity;
uniform float uSoft;
void main() {
  if (vFade <= 0.002) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, uSoft);
  vec3 col = mix(uHot, uCool, pow(vLife, 0.65));
  gl_FragColor = vec4(col, a * vFade * uOpacity);
}
`;

function buildPlume(ctx, spec, preset) {
  const { THREE, atmos } = ctx;
  const count = preset.count;
  const rng = makeRng(Math.floor((spec.x * 31 + spec.z * 17 + 1e5)) >>> 0 || 7);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  const origin = new Float32Array(count * 3);
  const scale = new Float32Array(count);
  const s = spec.scale || 1;
  for (let i = 0; i < count; i += 1) {
    seed[i] = rng() * 1000;
    size[i] = rng.range(preset.size[0], preset.size[1]);
    scale[i] = s * rng.range(0.75, 1.25);
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * preset.radius * s;
    origin[i * 3] = spec.x + Math.cos(a) * r;
    origin[i * 3 + 1] = spec.y + rng.range(-0.2, 0.4) * s;
    origin[i * 3 + 2] = spec.z + Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aOrigin", new THREE.BufferAttribute(origin, 3));
  geo.setAttribute("aScale", new THREE.BufferAttribute(scale, 1));
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(spec.x, spec.y + preset.rise * preset.life * s * 0.5, spec.z),
    preset.rise * preset.life * s + 40
  );

  const hot = hexToRgb(preset.hot);
  const cool = hexToRgb(preset.cool);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: atmos.uniforms.uTimeSF,
      uWind: atmos.uniforms.uWind,
      uRise: { value: preset.rise },
      uSpread: { value: preset.spread },
      uLife: { value: preset.life },
      uPixelScale: { value: preset.pixelScale ?? 120 },
      uHot: { value: new THREE.Vector3(srgb(hot[0]) * preset.gain, srgb(hot[1]) * preset.gain, srgb(hot[2]) * preset.gain) },
      uCool: { value: new THREE.Vector3(srgb(cool[0]), srgb(cool[1]), srgb(cool[2])) },
      uOpacity: { value: preset.opacity },
      uSoft: { value: preset.soft ?? 1.6 },
    },
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: preset.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = preset.additive ? 11 : 10;
  return pts;
}

const PLUME_PRESETS = {
  /* Gains are modest because these land in a linear HDR buffer that
     the bloom pass reads next. A brazier authored to "look bright"
     in isolation comes back as a blown white ball once the bloom
     pyramid finds it, and a row of them reads as street lamps. */
  fire: {
    count: 110, size: [7, 17], radius: 0.45, rise: 3.2, spread: 0.35, life: 1.1,
    hot: "#ffcf90", cool: "#b8330c", gain: 1.5, opacity: 0.55, additive: true, soft: 1.5,
  },
  /* A flare is a SHORT bright flame with a long dark plume above
     it, not a white column. The first pass ran a pale hot colour
     up 23m of rise and the stacks looked like they were venting
     steam; fire is orange within a couple of body lengths and
     everything above that is soot. */
  flare: {
    count: 220, size: [11, 26], radius: 1.0, rise: 5.0, spread: 0.4, life: 1.1,
    hot: "#ffdc96", cool: "#c02c04", gain: 2.4, opacity: 0.62, additive: true, soft: 1.4,
  },
  flaresmoke: {
    count: 260, size: [16, 40], radius: 1.6, rise: 7.0, spread: 2.2, life: 7.0,
    hot: "#2a211c", cool: "#7d6c5e", gain: 1.0, opacity: 0.17, additive: false, soft: 2.3,
  },
  /* Smoke and steam use MANY SMALL sprites rather than few large
     ones. A handful of 60px discs overlapping at close range welds
     into one hard-edged grey wedge - which is what a first pass
     produced over the drop pod, and it read as a polygon in the
     sky rather than as a column of smoke. */
  smoke: {
    count: 260, size: [11, 26], radius: 1.2, rise: 3.4, spread: 1.5, life: 6.5,
    hot: "#4a4038", cool: "#9c8b7a", gain: 1.0, opacity: 0.13, additive: false, soft: 2.4,
  },
  steam: {
    count: 200, size: [10, 24], radius: 1.0, rise: 4.2, spread: 1.7, life: 5.0,
    hot: "#d8cfc0", cool: "#e8dccb", gain: 1.0, opacity: 0.10, additive: false, soft: 2.4,
  },
  heat: {
    count: 70, size: [30, 70], radius: 2.4, rise: 5.5, spread: 1.2, life: 4.0,
    hot: "#7a3a1c", cool: "#33222a", gain: 1.2, opacity: 0.16, additive: true, soft: 2.2,
  },
  /* Spores are motes hanging in the air, not a flare. Authored at
     gain 2.0 and opacity 0.55, thirty overlapping emitters welded
     into a solid white-cyan band across the whole district - the
     brightest thing in the level by a wide margin, over a hive
     that is supposed to read as dark and violet. Additive systems
     compound: the per-emitter value has to be set assuming many
     of them will overlap. */
  spore: {
    count: 150, size: [5, 14], radius: 4.0, rise: 1.2, spread: 2.0, life: 11.0,
    hot: "#9a5ce0", cool: "#3fbfae", gain: 0.55, opacity: 0.13, additive: true, soft: 2.0,
  },
};

/* ============================================================
   BANNERS
   Cloth on a standing wave. Driven in the vertex shader off the
   `wave` attribute the kit's banner builder writes, so a hundred
   banners cost one uniform update.
   ============================================================ */

function buildBanners(ctx, specs) {
  const { THREE, atmos, materials } = ctx;
  if (!specs.length) return null;

  // Bake each banner's colours into vertex colours, then merge by
  // colour-independent geometry - one mesh for all of them.
  const geos = [];
  for (const spec of specs) {
    const g = spec.geo;
    const wave = g.attributes.wave;
    const count = g.attributes.position.count;
    const colours = new Float32Array(count * 3);
    const body = hexToRgb(spec.colour);
    const accent = hexToRgb(spec.accent || "#efe6cf");
    const windAttr = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const u = wave.getX(i);
      const v = wave.getY(i);
      // A vertical stripe and a hem band, which is enough heraldry
      // to read at distance without a texture.
      const stripe = Math.abs(u - 0.5) < 0.13 ? 1 : 0;
      const hem = v > 0.88 ? 1 : 0;
      const t = Math.max(stripe, hem);
      // Cloth darkens toward the pole and toward the hem where it
      // is dirty; that gradient is what stops it reading as paper.
      const shade = 0.55 + 0.45 * Math.sin(u * Math.PI) * (1 - v * 0.35);
      const c = t ? accent : body;
      colours[i * 3] = srgb(clamp01(c[0] * shade));
      colours[i * 3 + 1] = srgb(clamp01(c[1] * shade));
      colours[i * 3 + 2] = srgb(clamp01(c[2] * shade));
      windAttr[i] = (spec.wind ?? 1) * v;   // free at the top, loose at the hem
    }
    g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    g.setAttribute("aWind", new THREE.BufferAttribute(windAttr, 1));
    // `wave` carries u,v; keep it, the vertex shader phases on it.
    geos.push(g);
  }

  const merged = mergeGeometries(THREE, geos);
  // Built fresh rather than cloned from `materials.cloth`. A clone
  // carries userData through a JSON round trip in some three
  // builds, and this material's userData holds a compiled shader
  // object with circular references once it has rendered once.
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  mat.name = "sf-banner";

  // The atmosphere patch first, then the wind displacement on top.
  // Order matters: both edits have to land in the same shader, and
  // the atmosphere's world-position varying must see the displaced
  // vertex or the haze will track where the cloth is not.
  patchMaterial(mat, atmos, { rim: 1.5, glitter: 0 });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec2 wave;
attribute float aWind;
uniform float uTimeSF;
uniform vec3  uWind;
uniform float uStorm;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  vec2 w = normalize(uWind.xy);
  float t = uTimeSF * (1.4 + uWind.z * 1.2);
  // Two travelling waves at different rates: one alone is a flag on
  // a screensaver, two beat against each other and read as cloth.
  float a = sin(wave.y * 6.2 - t * 2.3 + wave.x * 3.1);
  float b = sin(wave.y * 11.0 - t * 3.7 + wave.x * 1.7) * 0.45;
  float amp = aWind * (0.16 + uStorm * 0.5) * (0.4 + uWind.z * 0.8);
  transformed.x += w.x * (a + b) * amp;
  transformed.z += w.y * (a + b) * amp;
  transformed.y += (a * 0.4) * amp * 0.5;
  // Lift the hem downwind as the wind rises.
  transformed.xz += w * aWind * aWind * (0.25 + uStorm * 1.4);
}`);
    mat.userData.sfShader = shader;
  };
  mat.customProgramCacheKey = () => "sf-banner";
  mat.needsUpdate = true;

  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = "banners";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/* ============================================================
   LIGHT SHAFTS
   ============================================================ */

function buildShafts(ctx, specs) {
  const { THREE, materials } = ctx;
  if (!specs.length) return null;
  const geos = [];
  for (const spec of specs) {
    const dir = new THREE.Vector3(...(spec.dir || [0, -1, 0])).normalize();
    const len = spec.length || 40;
    const r0 = (spec.radius || 4) * 0.55;
    const r1 = (spec.radius || 4) * 1.5;
    const SIDES = 9;
    const pos = [];
    const col = [];
    const idx = [];
    const c = hexToRgb(spec.colour || "#ffd9a0");
    const push = (v, bright) => {
      pos.push(v.x, v.y, v.z);
      col.push(srgb(c[0]) * bright, srgb(c[1]) * bright, srgb(c[2]) * bright);
    };
    // Build a cone along `dir` with a local frame.
    const up = Math.abs(dir.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, dir).normalize();
    const origin = new THREE.Vector3(spec.x, spec.y, spec.z);
    const STEPS = 4;
    for (let s = 0; s <= STEPS; s += 1) {
      const t = s / STEPS;
      const rr = lerp(r0, r1, t);
      // Additive: black is invisible, so the fade IS the vertex
      // colour. No alpha channel is involved anywhere.
      //
      // 0.22, not 0.9. A shaft of light is a small amount of dust
      // catching a lot of sun; at 0.9 these rendered as solid pale
      // wedges you could see from the far side of the map.
      const bright = (1 - t) * (1 - t) * 0.22 * (spec.gain ?? 1);
      for (let i = 0; i < SIDES; i += 1) {
        const a = (i / SIDES) * TAU;
        const v = origin.clone()
          .addScaledVector(dir, t * len)
          .addScaledVector(right, Math.cos(a) * rr)
          .addScaledVector(fwd, Math.sin(a) * rr);
        /* Azimuthal falloff, deepened from 0.55+0.45 to 0.22+0.78.
           It is the only lever a static additive shell has against
           its own silhouette: the sides of the cone that face across
           the shaft go nearly dark, so the outline reads as a soft
           column of air rather than as a cut-out wedge. */
        push(v, bright * (0.22 + 0.78 * Math.abs(Math.cos(a))));
      }
    }
    for (let s = 0; s < STEPS; s += 1) {
      for (let i = 0; i < SIDES; i += 1) {
        const n = (i + 1) % SIDES;
        const a0 = s * SIDES + i;
        const a1 = s * SIDES + n;
        const b0 = (s + 1) * SIDES + i;
        const b1 = (s + 1) * SIDES + n;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(THREE, geos), materials.glow);
  mesh.name = "shafts";
  mesh.renderOrder = 7;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/* ============================================================
   ASSEMBLY
   ============================================================ */

export function buildVfx(ctx, world) {
  const { THREE, scene, atmos, terrain } = ctx;
  const group = new THREE.Group();
  group.name = "vfx";
  scene.add(group);

  const streamers = buildStreamers(ctx, { count: 220, range: 150, opacity: 0.13, seed: 0x57e4 });
  group.add(streamers.mesh);

  // Kept dim. These sit in a linear HDR buffer that a bloom pass
  // reads afterwards, so a mote authored at "looks about right" in
  // isolation arrives as a glowing ball once the pyramid finds it.
  const dust = buildPoints(ctx, {
    count: 900, box: [110, 34, 110], rise: 0.28, drift: 1.6,
    colourA: "#c8ab84", colourB: "#9c7050", opacity: 0.16,
    size: [5, 15], pixelScale: 55, seed: 0xd057, name: "dust",
  });
  group.add(dust.points);

  // A second, coarser layer close to the ground: this is what makes
  // walking feel like walking on sand rather than on a mesh.
  const grit = buildPoints(ctx, {
    count: 420, box: [42, 5, 42], rise: 0.10, drift: 3.4,
    colourA: "#c39c6c", colourB: "#8a5638", opacity: 0.20,
    size: [3, 9], pixelScale: 50, lifeScale: 0.45, seed: 0x9917, name: "grit",
  });
  group.add(grit.points);

  const plumes = [];
  const shaftSpecs = [];
  for (const spec of world.emitters) {
    if (spec.kind === "shaft") { shaftSpecs.push(spec); continue; }
    const preset = PLUME_PRESETS[spec.kind];
    if (!preset) continue;
    const p = buildPlume(ctx, spec, preset);
    p.name = `plume-${spec.kind}`;
    group.add(p);
    plumes.push(p);
  }

  /* Extra light shafts, authored rather than emitted: slots between
     the Choir Spires, and the clerestory of the nave. These are the
     frames that make those two districts photograph. */
  {
    const rng = makeRng(0x54af7);
    /* Slots of light between the spires. Fewer, narrower and lower
       than they were: at nine of them, up to 9m across and starting
       90m up, most of each cone stood ABOVE the spires against open
       sky, where a light shaft has nothing to be a shaft THROUGH and
       reads as a pale translucent wedge hanging in the air. A shaft
       needs a slot to come through and a floor to land on, and both
       of those are in the bottom 40m of this district. */
    const choir = ctx.districts.choir;
    for (let i = 0; i < 6; i += 1) {
      const a = rng() * TAU;
      const r = rng.range(30, 220);
      const x = choir.x + Math.cos(a) * r;
      const z = choir.z + Math.sin(a) * r;
      shaftSpecs.push({
        x, y: terrain.heightAt(x, z) + rng.range(28, 52), z,
        dir: [atmos.sunDir.x * -1, -0.85, atmos.sunDir.z * -1],
        length: rng.range(34, 58), radius: rng.range(2.4, 5.0),
        colour: "#ffe0ae",
      });
    }
    /* Clerestory shafts, raking down the nave from both sides.
       Higher gain than the outdoor shafts because these are the only
       light in an interior - outside, a shaft competes with a lit
       desert and has to be almost nothing; inside, it IS the
       lighting, and it has to reach the floor.

       But 4.2 was FAR over, and the file already had the lesson
       written in it one function up: "0.22, not 0.9 - at 0.9 these
       rendered as solid pale wedges". A gain of 4.2 on a base of
       0.22 is 0.92, straight back to the number that was rejected.
       The nave review frame came out with a hard-edged white chevron
       spanning corner to corner across the floor, the columns and
       the crossing - it read as a rendering fault rather than as
       light. An additive cone shell is brightest at its SILHOUETTE
       (that is where the ray runs longest through the surface), so
       these can never be pushed hard without their outline turning
       into a drawn shape. */
    const cath = ctx.districts.cathedral;
    const plazaY = terrain.field.cathedralPlazaY;
    for (let i = 0; i < 10; i += 1) {
      const side = i % 2 ? 1 : -1;
      const z = cath.z - 58 + (i / 9) * 112;
      /* THE RAKE IS THE FIX, not the brightness.
         These used to run inward at -0.60 horizontal against -0.80
         vertical, from 20m out on each side. That converges: left
         and right meet on the centreline 33m along, 4.6m above the
         floor, and ten cone shells crossing at one height rendered
         as a single hard-edged white chevron spanning the frame. It
         was read as a rendering fault every time it was reviewed,
         and it was really just ten light shafts all arriving at the
         same point.

         Raked at -0.26 they descend nearly vertically and land in
         two rows on the floor without ever meeting - which is also
         what clerestory light actually does, because the windows are
         high on the wall and the sun is not in the nave. */
      shaftSpecs.push({
        x: cath.x + side * 20, y: plazaY + 31, z,
        dir: [-side * 0.26, -0.965, 0.04], length: 32.5, radius: 3.0,
        colour: i % 3 === 0 ? "#ffb488" : "#ffe4b8",
        gain: 1.35,
      });
    }
    // And the rose window's own shaft, thrown up the nave. Shorter
    // and narrower than it was: at 92m by 12m radius it did not read
    // as a shaft at all, it read as the nave being full of fog.
    shaftSpecs.push({
      x: cath.x, y: plazaY + 38, z: cath.z + 60,
      dir: [0, -0.62, -1], length: 56, radius: 6.5,
      colour: "#ff9a6a", gain: 1.2,
    });
  }

  const shafts = buildShafts(ctx, shaftSpecs);
  if (shafts) group.add(shafts);

  const bannerMesh = buildBanners(ctx, world.banners);
  if (bannerMesh) group.add(bannerMesh);

  /* ------------------------------ update ------------------------------ */

  const anchor = new THREE.Vector3();
  const flicker = [];
  for (const l of world.lights) flicker.push({ light: l, phase: Math.random() * 100 });


  /* ============================================================
     IMPACTS

     One pooled Points buffer for every hit, ricochet and blast in
     the game. A pool rather than allocation-per-hit because a
     firefight produces dozens of impacts a second and the frame
     budget here is 1.4ms - and because a system that allocates is a
     system that stutters exactly when the action starts.

     Slots are recycled oldest-first. Overrunning the pool drops the
     oldest spark, which nobody will ever notice; growing the buffer
     mid-fight would be felt by everyone.
     ============================================================ */
  const IMPACT_MAX = 512;
  const impacts = (() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(IMPACT_MAX * 3);
    const vel = new Float32Array(IMPACT_MAX * 3);
    const birth = new Float32Array(IMPACT_MAX).fill(-999);
    const size = new Float32Array(IMPACT_MAX);
    const tint = new Float32Array(IMPACT_MAX);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
    geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: 1 },
        uHot: { value: new THREE.Color("#ffd9a0") },
        uCold: { value: new THREE.Color("#ff7a3c") },
        // Reliquary ions, gold like everything else the Concord
        // fires. These are the sparks that hang in the bolt's wake,
        // so leaving them cyan would have painted a blue trail
        // behind a gold slug.
        uEnergyHot: { value: new THREE.Color("#fffdf4") },
        uEnergyCold: { value: new THREE.Color("#ff9d22") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        "attribute vec3 aVel;",
        "attribute float aBirth;",
        "attribute float aSize;",
        "attribute float aTint;",
        "uniform float uTime;",
        "uniform float uPixel;",
        "varying float vLife;",
        "varying float vTint;",
        "void main() {",
        "  float age = uTime - aBirth;",
        "  vLife = clamp(1.0 - age / 0.62, 0.0, 1.0);",
        "  vTint = aTint;",
        /* Not yet born. Particles can be scheduled ahead of time so a
           bolt sheds its wake AS IT PASSES rather than laying the
           whole trail down at the muzzle; without this they sit
           visible at their start points from the moment of the shot,
           and run backwards while they wait. */
        "  if (age < 0.0) {",
        "    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
        "    return;",
        "  }",
        // Reliquary ions hang in the wake; ordinary sparks still fall.
        // `aTint > 1` is the pool's explicit energy style channel.
        "  float energy = step(1.5, aTint);",
        "  vec3 p = position + aVel * age",
        "    - vec3(0.0, 9.0, 0.0) * age * age * (1.0 - energy);",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        "  gl_Position = projectionMatrix * mv;",
        "  gl_PointSize = aSize * uPixel * vLife / max(1.0, -mv.z * 0.06);",
        "  if (vLife <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uHot;",
        "uniform vec3 uCold;",
        "uniform vec3 uEnergyHot;",
        "uniform vec3 uEnergyCold;",
        "varying float vLife;",
        "varying float vTint;",
        "void main() {",
        "  vec2 d = gl_PointCoord - 0.5;",
        "  float r = dot(d, d);",
        "  if (r > 0.25) discard;",
        "  float core = smoothstep(0.25, 0.0, r);",
        "  float energy = step(1.5, vTint);",
        "  vec3 sparkColour = mix(uCold, uHot, clamp(vTint * vLife, 0.0, 1.0));",
        "  vec3 ionColour = mix(uEnergyCold, uEnergyHot, 0.30 + vLife * 0.70);",
        "  vec3 c = mix(sparkColour, ionColour, energy);",
        "  gl_FragColor = vec4(c * core * (0.35 + vLife * 1.5), core * vLife);",
        "}",
      ].join("\n"),
    });

    const points = new THREE.Points(geo, mat);
    points.name = "impacts";
    points.frustumCulled = false;
    group.add(points);

    let cursor = 0;
    function emit(x, y, z, count, spread, scale, tintVal) {
      for (let i = 0; i < count; i += 1) {
        const k = cursor;
        cursor = (cursor + 1) % IMPACT_MAX;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const a = Math.random() * Math.PI * 2;
        const e = Math.random();
        vel[k * 3] = Math.cos(a) * spread * (0.3 + e);
        vel[k * 3 + 1] = spread * (0.35 + Math.random() * 0.9);
        vel[k * 3 + 2] = Math.sin(a) * spread * (0.3 + e);
        birth[k] = atmos.elapsed;
        size[k] = scale * (7 + Math.random() * 9);
        tint[k] = tintVal;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aVel.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aTint.needsUpdate = true;
    }

    /**
     * The same pool, thrown along an axis instead of up and outward.
     *
     * Muzzle gas leaves the bore; it does not fountain. `emit`'s
     * radial-plus-up velocity is right for debris kicked off a
     * surface and wrong for anything with a direction, and reusing it
     * for the muzzle put a small puff of sparks around the barrel
     * that read as the weapon smouldering.
     */
    /**
     * Embers shed along a path, each timed to appear as something
     * travelling that path reaches it.
     *
     * `delay` is what makes this a wake rather than a streak of dust
     * laid down all at once at the muzzle.
     */
    function emitTrail(x, y, z, dx, dy, dz, distance, speed, count, scale,
      tintVal = 0.85) {
      for (let i = 0; i < count; i += 1) {
        const k = cursor;
        cursor = (cursor + 1) % IMPACT_MAX;
        const along = (i + 0.35 + Math.random() * 0.3) / count * distance;
        pos[k * 3] = x + dx * along + (Math.random() - 0.5) * 0.10;
        pos[k * 3 + 1] = y + dy * along + (Math.random() - 0.5) * 0.10;
        pos[k * 3 + 2] = z + dz * along + (Math.random() - 0.5) * 0.10;
        // Drifting, not thrown: the bolt is gone by the time these
        // are lit, so they should hang and fall rather than jet.
        vel[k * 3] = (Math.random() - 0.5) * 1.1;
        vel[k * 3 + 1] = 0.35 + Math.random() * 0.8;
        vel[k * 3 + 2] = (Math.random() - 0.5) * 1.1;
        birth[k] = atmos.elapsed + along / speed;
        size[k] = scale * (4 + Math.random() * 6);
        tint[k] = tintVal;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aVel.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aTint.needsUpdate = true;
    }

    function emitDirected(x, y, z, count, dx, dy, dz, speed, scale, tintVal) {
      for (let i = 0; i < count; i += 1) {
        const k = cursor;
        cursor = (cursor + 1) % IMPACT_MAX;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const s = speed * (0.35 + Math.random() * 0.85);
        // A narrow cone about the axis, not a jet: perfectly parallel
        // reads as a solid rod rather than as gas.
        vel[k * 3] = dx * s + (Math.random() - 0.5) * speed * 0.30;
        vel[k * 3 + 1] = dy * s + (Math.random() - 0.5) * speed * 0.30;
        vel[k * 3 + 2] = dz * s + (Math.random() - 0.5) * speed * 0.30;
        birth[k] = atmos.elapsed;
        size[k] = scale * (7 + Math.random() * 9);
        tint[k] = tintVal;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aVel.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aTint.needsUpdate = true;
    }
    return { points, mat, emit, emitDirected, emitTrail };
  })();

  /* ============================================================
     TRACERS

     Fire in this game is HITSCAN: combat resolves a shot to a ray, a
     capsule test and a damage number, all in the frame the trigger is
     pulled. Nothing about that is visible. The shot existed only as a
     handful of sparks at the far end, so the weapon read as a device
     for making distant dust rather than as a gun.

     So the bolt is pure decoration - it carries no damage and no
     collision, it just draws the path the ray already took. It has to
     be launched with the distance the ray actually reached, so it
     stops at the wall the shot stopped at instead of flying through.

     Drawn as a quad stretched along the flight line and turned to
     face the camera, rather than as a point sprite, because a point
     cannot be stretched and an unstretched bolt at 260m/s is a dot
     that teleports. The stretch IS the read.
     ============================================================ */
  const TRACER_MAX = 96;
  /* AN ENERGY BOLT, NOT A BULLET STREAK. A tracer is a hot smear left
     by something already gone; a censer-lance throws a discrete slug
     of light that you watch travel and can lead a target with. That
     is a slower, shorter, fatter thing: 150m/s crosses a 40m firefight
     in a quarter second, which is long enough to read as flight and
     short enough not to feel lobbed. */
  const TRACER_SPEED = 150;
  /* The lance fires LIGHT. At 150 m/s the player's own bolt crawled
     the first ten metres in front of the camera and read as a thrown
     ember; a blast has to clear the near field before the eye can
     track it, and 520 puts a 60m shot on target inside a tenth of a
     second while still leaving something to see. */
  const ENERGY_TRACER_SPEED = 520;
  /* The old 7.5m orange wake was longer and brighter than its head, so
     the eye read a conventional tracer line. The separate head card
     below now owns legibility; this is only its ion afterimage. */
  const TRACER_TAIL = 1.15;      // m of wake behind the player's bolt
  const HOSTILE_TRACER_TAIL = 7.5;
  const RELIQUARY_FADE_TIME = 0.055;
  const HOSTILE_FADE_TIME = 0.050;
  const RELIQUARY_BOLT_WIDTH = 0.42;
  const tracers = (() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(TRACER_MAX * 4 * 3);
    const dirs = new Float32Array(TRACER_MAX * 4 * 3);
    const span = new Float32Array(TRACER_MAX * 4);
    const birth = new Float32Array(TRACER_MAX * 4).fill(-999);
    const width = new Float32Array(TRACER_MAX * 4);
    const style = new Float32Array(TRACER_MAX * 4);
    const corner = new Float32Array(TRACER_MAX * 4 * 2);
    const index = new Uint16Array(TRACER_MAX * 6);
    for (let i = 0; i < TRACER_MAX; i += 1) {
      const v = i * 4;
      // (along, across): along runs tail 0 -> head 1.
      corner[(v + 0) * 2] = 0; corner[(v + 0) * 2 + 1] = -1;
      corner[(v + 1) * 2] = 0; corner[(v + 1) * 2 + 1] = 1;
      corner[(v + 2) * 2] = 1; corner[(v + 2) * 2 + 1] = 1;
      corner[(v + 3) * 2] = 1; corner[(v + 3) * 2 + 1] = -1;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3));
    geo.setAttribute("aSpan", new THREE.BufferAttribute(span, 1));
    geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
    geo.setAttribute("aWidth", new THREE.BufferAttribute(width, 1));
    geo.setAttribute("aStyle", new THREE.BufferAttribute(style, 1));
    geo.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: TRACER_SPEED },
        uEnergySpeed: { value: ENERGY_TRACER_SPEED },
        uTail: { value: TRACER_TAIL },
        uHostileTail: { value: HOSTILE_TRACER_TAIL },
        uEnergyFade: { value: RELIQUARY_FADE_TIME },
        uHostileFade: { value: HOSTILE_FADE_TIME },
        uHot: { value: new THREE.Color("#fffbf0") },
        uCold: { value: new THREE.Color("#ff5a06") },
        /* GOLD, because everything the Concord owns is.
           This was a cyan body (#00f0dc) inside a blue-violet fringe
           (#5b54ff) - the only cool object in a warm game, and the
           exact palette the BLOOM uses for its lit organs, so the
           player's own fire read as belonging to the thing shooting
           back at them. It also read as a toy laser, which cyan on a
           thin quad always will.

           The gradient runs white-hot core -> reliquary amber ->
           forge orange, which is the armour's own ramp and the same
           amber the helm's eye sockets carry. */
        uEnergyCore: { value: new THREE.Color("#fffdf4") },
        uEnergyBody: { value: new THREE.Color("#ffc23c") },
        uEnergyFringe: { value: new THREE.Color("#ff6a12") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // The camera-facing side vector can change handedness as a bolt
      // crosses the view axis; both windings must remain visible.
      side: THREE.DoubleSide,
      vertexShader: [
        "attribute vec3 aDir;",
        "attribute float aSpan;",
        "attribute float aBirth;",
        "attribute float aWidth;",
        "attribute float aStyle;",
        "attribute vec2 aCorner;",
        "uniform float uTime;",
        "uniform float uSpeed;",
        "uniform float uEnergySpeed;",
        "uniform float uTail;",
        "uniform float uHostileTail;",
        "uniform float uEnergyFade;",
        "uniform float uHostileFade;",
        "varying float vAlong;",
        "varying float vAcross;",
        "varying float vLife;",
        "varying float vSeed;",
        "varying float vStyle;",
        "varying float vAge;",
        "void main() {",
        "  float age = uTime - aBirth;",
        "  float speed = mix(uSpeed, uEnergySpeed, aStyle);",
        "  float travelled = age * speed;",
        "  float tailLength = mix(uHostileTail, uTail, aStyle);",
        "  float fadeTime = mix(uHostileFade, uEnergyFade, aStyle);",
        // The head stops at the range the ray reached; the tail keeps
        // running, so the bolt is swallowed by whatever it hit rather
        // than winking out in mid air.
        "  float head = min(travelled, aSpan);",
        // The head stops at impact, but the tail continues forward and
        // collapses into it. Basing this on `head` froze the last 3m.
        "  float tail = clamp(travelled - tailLength, 0.0, aSpan);",
        "  float impactAge = max(age - aSpan / speed, 0.0);",
        "  vLife = 1.0 - clamp(impactAge / fadeTime, 0.0, 1.0);",
        "  if (age < 0.0 || vLife <= 0.0) {",
        "    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
        "    vAlong = 0.0; vAcross = 0.0; vSeed = 0.0;",
        "    vStyle = 0.0; vAge = 0.0;",
        "    return;",
        "  }",
        "  float alongDistance = mix(tail, head, aCorner.x);",
        "  vec3 p = position + aDir * alongDistance;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        /* A chase camera projects the real ray through the trooper's
           silhouette, so the bolt bows a little toward the weapon side
           in MID flight and returns to the real endpoint. Collision,
           damage and the stored ray are unchanged.

           IT MUST NOT BOW NEAR THE MUZZLE. This used to ramp in from
           0.25m and swing 1.25m across, which is most of a body width
           in the first three metres - so however exactly the emitter
           was placed on the needle, the bolt visibly peeled off it and
           the shot read as coming from beside the lance. The arc now
           starts at four metres, by which point the whole weapon is
           out of frame anyway, and is a third of the size. */
        "  vec4 startMv = modelViewMatrix * vec4(position, 1.0);",
        "  float muzzleSide = startMv.x < 0.0 ? -1.0 : 1.0;",
        "  float endpointReturn = smoothstep(0.0, 5.0, aSpan - alongDistance);",
        "  float silhouetteArc = smoothstep(4.0, 12.0, alongDistance)",
        "    * (1.0 - smoothstep(26.0, 52.0, alongDistance)) * endpointReturn;",
        "  mv.x += muzzleSide * 0.40 * silhouetteArc * aStyle;",
        "  vec3 dv = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);",
        "  vec3 toCam = normalize(-mv.xyz);",
        "  vec3 side = cross(dv, toCam);",
        "  float sl = length(side);",
        /* |cross| is the sine of the angle to the view ray, so it
           collapses as the bolt turns end-on - which is exactly the
           case the player sees most, firing away from a chase camera.
           Letting it collapse would hide the bolt in the one view that
           matters, so the width is floored instead: end-on it reads as
           a travelling bead rather than as nothing. */
        "  vec3 sideN = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);",
        // Teardrop: a fat round slug at the head, drawn out into a
        // thin wake. A constant-width bar reads as a laser sight.
        "  float hostileShape = 0.16 + 1.35 * pow(aCorner.x, 1.6);",
        // Nearly parallel-sided, with the head only slightly proud: a
        // laser bolt is a short rod of light. The old 0.045 tail
        // tapered to a hair and turned the shot into a comet.
        "  float energyShape = 0.30 + 0.24 * pow(aCorner.x, 3.0);",
        "  float w = aWidth * mix(hostileShape, energyShape, aStyle)",
        "    * mix(1.7, 1.0, sl);",
        "  mv.xyz += sideN * (aCorner.y * w);",
        "  gl_Position = projectionMatrix * mv;",
        "  vAlong = aCorner.x;",
        "  vAcross = aCorner.y;",
        // Per-bolt, off the launch time, so no two slugs flicker in
        // step. Cheaper than carrying another attribute for it.
        "  vSeed = fract(aBirth * 13.71);",
        "  vStyle = aStyle;",
        "  vAge = age;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uHot;",
        "uniform vec3 uCold;",
        "uniform vec3 uEnergyCore;",
        "uniform vec3 uEnergyBody;",
        "uniform vec3 uEnergyFringe;",
        "varying float vAlong;",
        "varying float vAcross;",
        "varying float vLife;",
        "varying float vSeed;",
        "varying float vStyle;",
        "varying float vAge;",
        "void main() {",
        /* CLAMPED, and it matters. `vAcross` is interpolated from the
           quad's own -1/+1 corners, so it can land a hair outside that
           range at the very edge - and every `pow(across, k)` below
           then has a NEGATIVE base, which GLSL leaves undefined and
           this GPU returns NaN for. The composite sanitises NaN to
           zero, so the artefact was a dashed BLACK outline traced
           exactly around each bolt's quad: the one shape additive
           blending is incapable of drawing, which is what said it had
           to be a NaN rather than a shading mistake. */
        "  float across = clamp(1.0 - abs(vAcross), 0.0, 1.0);",
        "  float along = clamp(vAlong, 0.0, 1.0);",
        /* TWO LOBES. A single falloff gives a hard-edged rod; a tight
           core inside a wide soft halo is what makes something read as
           luminous rather than painted. The halo is also what the
           bloom pass finds, and the bloom is most of the effect. */
        "  float core = pow(across, 7.0);",
        "  float halo = pow(across, 1.7) * 0.46;",
        // Round the tip off, so the quad's flat end is not the shape.
        "  float capR = length(vec2(max(0.0, along - 0.86) / 0.14, vAcross));",
        "  float cap = 1.0 - smoothstep(0.80, 1.05, capR);",
        // Plasma is unstable. A little modulation along the slug stops
        // it reading as extruded geometry.
        "  float flick = 0.84 + 0.16 * sin(along * 31.0 + vSeed * 6.2831);",
        "  float wake = mix(0.06, 1.0, pow(along, 2.2));",
        "  float hostileBody = (core + halo) * wake * cap * flick;",
        // White-hot through the middle, saturated at the edges - the
        // gradient runs ACROSS the bolt, not along it, which is what
        // separates a glowing object from a warm smear.
        "  vec3 hostileColour = mix(uCold, uHot, core);",
        /* A LASER, not a plasma ribbon.

           The wake used to carry two counter-phased ion filaments and
           a 82Hz charge modulation, which is a good description of
           unstable gas and the wrong description of a shot of light:
           it crawled, it writhed, and it read as something leaking
           off the weapon. What is left is a hard white core inside a
           gold sheath, held at nearly constant brightness down the
           rod, with a bead at the head - and the tail cut clean
           instead of trailing off into embers.

           The core is much tighter than the hostile one (11 against
           7). A laser's read is the RATIO between an almost-white
           centre and a saturated edge; widen the core and it turns
           into a glowing bar. */
        "  float energyCore = pow(across, 5.5);",
        "  float energyHalo = pow(across, 1.5);",
        "  float energyWake = mix(0.30, 1.0, pow(along, 1.6));",
        "  float bead = smoothstep(0.72, 1.0, along);",
        /* The halo carries most of the ROD and the core carries the
           white line down its middle. An earlier pass put the core at
           exponent 11 with the halo at a fifth of this weight, which
           meant only the middle 15% of the quad had any alpha at all:
           the bolt rendered as a two-pixel white hair towed behind a
           ball, and every attempt to fix it by widening the quad just
           made the hair longer. Width is not what a rod is made of. */
        "  float energyBody = (energyCore * 0.95 + energyHalo * 0.55",
        "    + bead * energyCore * 0.55) * energyWake * cap;",
        "  vec3 energyColour = mix(uEnergyFringe, uEnergyBody, pow(across, 0.55));",
        "  energyColour = mix(energyColour, uEnergyCore, pow(across, 4.0) * 0.95);",
        "  float body = mix(hostileBody, energyBody, vStyle);",
        "  vec3 c = mix(hostileColour, energyColour, vStyle);",
        "  float gain = mix(4.6, 9.6, vStyle);",
        "  gl_FragColor = vec4(c * body * vLife * gain,",
        "    clamp(body * vLife, 0.0, 1.0));",
        "}",
      ].join("\n"),
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "tracers";
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    group.add(mesh);

    /* A ribbon cannot keep a round silhouette when its flight axis
       points away from the chase camera: perspective crushes the head
       into the tail. These synchronized camera-facing cards give every
       bolt a discrete charge at the leading edge. They share all six
       live attributes with the ribbon, so the extra draw call adds no
       second per-shot upload and never allocates during a firefight. */
    const headGeo = new THREE.BufferGeometry();
    for (const name of ["position", "aDir", "aSpan", "aBirth", "aWidth", "aStyle"]) {
      headGeo.setAttribute(name, geo.getAttribute(name));
    }
    const headCorner = new Float32Array(TRACER_MAX * 4 * 2);
    for (let i = 0; i < TRACER_MAX; i += 1) {
      const v = i * 4;
      headCorner[(v + 0) * 2] = -1; headCorner[(v + 0) * 2 + 1] = -1;
      headCorner[(v + 1) * 2] = -1; headCorner[(v + 1) * 2 + 1] = 1;
      headCorner[(v + 2) * 2] = 1; headCorner[(v + 2) * 2 + 1] = 1;
      headCorner[(v + 3) * 2] = 1; headCorner[(v + 3) * 2 + 1] = -1;
    }
    headGeo.setAttribute("aCorner", new THREE.BufferAttribute(headCorner, 2));
    headGeo.setIndex(geo.index);
    headGeo.boundingSphere = geo.boundingSphere;

    const headMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: mat.uniforms.uTime,
        uSpeed: { value: TRACER_SPEED },
        uEnergySpeed: { value: ENERGY_TRACER_SPEED },
        uEnergyFade: { value: RELIQUARY_FADE_TIME },
        uHostileFade: { value: HOSTILE_FADE_TIME },
        uHot: mat.uniforms.uHot,
        uCold: mat.uniforms.uCold,
        uEnergyCore: mat.uniforms.uEnergyCore,
        uEnergyBody: mat.uniforms.uEnergyBody,
        uEnergyFringe: mat.uniforms.uEnergyFringe,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // The fixed camera-card corner order is clockwise from one side;
      // without DoubleSide the pooled head is valid but back-face culled.
      side: THREE.DoubleSide,
      vertexShader: [
        "attribute vec3 aDir;",
        "attribute float aSpan;",
        "attribute float aBirth;",
        "attribute float aWidth;",
        "attribute float aStyle;",
        "attribute vec2 aCorner;",
        "uniform float uTime;",
        "uniform float uSpeed;",
        "uniform float uEnergySpeed;",
        "uniform float uEnergyFade;",
        "uniform float uHostileFade;",
        "varying vec2 vUv;",
        "varying float vLife;",
        "varying float vStyle;",
        "varying float vPulse;",
        "void main() {",
        "  float age = uTime - aBirth;",
        "  float speed = mix(uSpeed, uEnergySpeed, aStyle);",
        "  float travelled = age * speed;",
        "  float head = min(travelled, aSpan);",
        "  float fadeTime = mix(uHostileFade, uEnergyFade, aStyle);",
        "  float impactAge = max(age - aSpan / speed, 0.0);",
        "  vLife = 1.0 - clamp(impactAge / fadeTime, 0.0, 1.0);",
        "  vUv = aCorner;",
        "  vStyle = aStyle;",
        "  float seed = fract(aBirth * 13.71);",
        "  vPulse = mix(0.90 + 0.10 * sin(age * 78.0 + seed * 6.2831), 1.0, aStyle);",
        "  if (age < 0.0 || vLife <= 0.0) {",
        "    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
        "    return;",
        "  }",
        "  vec3 p = position + aDir * head;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        "  vec4 startMv = modelViewMatrix * vec4(position, 1.0);",
        "  float muzzleSide = startMv.x < 0.0 ? -1.0 : 1.0;",
        "  float endpointReturn = smoothstep(0.0, 5.0, aSpan - head);",
        // Must match the ribbon exactly, or the bead separates from
        // the rod it is supposed to be the front of.
        "  float silhouetteArc = smoothstep(4.0, 12.0, head)",
        "    * (1.0 - smoothstep(26.0, 52.0, head)) * endpointReturn;",
        "  mv.x += muzzleSide * 0.40 * silhouetteArc * aStyle;",
        "  float radius = aWidth * mix(0.75, 0.42, aStyle) * vPulse;",
        // Keep distant player charges readable without inflating hostile
        // fire or making the close profile orb any larger.
        "  radius = max(radius, -mv.z * 0.0042 * aStyle);",
        "  mv.xy += aCorner * radius;",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uHot;",
        "uniform vec3 uCold;",
        "uniform vec3 uEnergyCore;",
        "uniform vec3 uEnergyBody;",
        "uniform vec3 uEnergyFringe;",
        "varying vec2 vUv;",
        "varying float vLife;",
        "varying float vStyle;",
        "varying float vPulse;",
        "void main() {",
        "  float r = length(vUv);",
        "  if (r > 1.0) discard;",
        "  float halo = pow(clamp(1.0 - r, 0.0, 1.0), 1.35);",
        "  float core = 1.0 - smoothstep(0.12, 0.34, r);",
        "  float ring = smoothstep(0.38, 0.55, r)",
        "    * (1.0 - smoothstep(0.60, 0.82, r));",
        "  float ang = atan(vUv.y, vUv.x);",
        "  float corona = pow(abs(cos(ang * 3.0 + vPulse * 5.0)), 10.0)",
        "    * pow(clamp(1.0 - r, 0.0, 1.0), 1.8);",
        "  float hostileBody = halo * 0.72 + core * 1.08;",
        "  vec3 hostileColour = mix(uCold, uHot, core);",
        /* THE HEAD IS A BEAD, NOT A STAR. The ring and the three-lobe
           corona below belong to hostile plasma; on the player's bolt
           they made a 70cm orange ball with a hairline towed behind
           it - a comet, and the single loudest reason the shot did not
           read as a laser. What the head needs is a hot white point
           that the bloom can bleed a little gold around. */
        "  float energyCore = 1.0 - smoothstep(0.0, 0.30, r);",
        "  float energyHalo = pow(clamp(1.0 - r, 0.0, 1.0), 2.6);",
        "  float energyBody = energyCore * 1.60 + energyHalo * 0.55;",
        "  vec3 energyColour = mix(uEnergyFringe, uEnergyBody,",
        "    pow(clamp(1.0 - r, 0.0, 1.0), 0.55));",
        "  energyColour = mix(energyColour, uEnergyCore, energyCore);",
        "  float body = mix(hostileBody, energyBody, vStyle);",
        "  vec3 c = mix(hostileColour, energyColour, vStyle);",
        "  float gain = mix(3.8, 9.5, vStyle);",
        "  gl_FragColor = vec4(c * body * vLife * gain,",
        "    clamp(body * vLife, 0.0, 1.0));",
        "}",
      ].join("\n"),
    });
    const heads = new THREE.Mesh(headGeo, headMat);
    heads.name = "tracer-heads";
    heads.frustumCulled = false;
    heads.renderOrder = 7;
    group.add(heads);

    let cursor = 0;
    function emit(x, y, z, dx, dy, dz, distance, w, styleVal) {
      const i = cursor;
      cursor = (cursor + 1) % TRACER_MAX;
      for (let k = 0; k < 4; k += 1) {
        const v = i * 4 + k;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        dirs[v * 3] = dx; dirs[v * 3 + 1] = dy; dirs[v * 3 + 2] = dz;
        span[v] = distance;
        birth[v] = atmos.elapsed;
        width[v] = w;
        style[v] = styleVal;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aDir.needsUpdate = true;
      geo.attributes.aSpan.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aWidth.needsUpdate = true;
      geo.attributes.aStyle.needsUpdate = true;
    }
    return { mesh, mat, heads, headMat, emit };
  })();

  /* ============================================================
     FLASHES

     Camera-facing cards with a very short life: the muzzle bloom, and
     the hot pop at the point of impact. Separate from the impact
     points because the timings are an order of magnitude apart - a
     muzzle flash lives about 45ms and a spark shower about 600ms, and
     one shader cannot carry both curves without one of them looking
     wrong.

     Deliberately over-bright. These land in the linear HDR buffer
     ahead of the bloom pass, and the flare around the muzzle is the
     bloom finding them - authoring them to "correct" exposure gets a
     grey card with no glow at all.
     ============================================================ */
  const FLASH_MAX = 64;
  const flashes = (() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(FLASH_MAX * 4 * 3);
    const birth = new Float32Array(FLASH_MAX * 4).fill(-999);
    const size = new Float32Array(FLASH_MAX * 4);
    const life = new Float32Array(FLASH_MAX * 4);
    const seed = new Float32Array(FLASH_MAX * 4);
    const tint = new Float32Array(FLASH_MAX * 4);
    const corner = new Float32Array(FLASH_MAX * 4 * 2);
    const index = new Uint16Array(FLASH_MAX * 6);
    for (let i = 0; i < FLASH_MAX; i += 1) {
      const v = i * 4;
      corner[(v + 0) * 2] = -1; corner[(v + 0) * 2 + 1] = -1;
      corner[(v + 1) * 2] = -1; corner[(v + 1) * 2 + 1] = 1;
      corner[(v + 2) * 2] = 1; corner[(v + 2) * 2 + 1] = 1;
      corner[(v + 3) * 2] = 1; corner[(v + 3) * 2 + 1] = -1;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
    geo.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHot: { value: new THREE.Color("#fff6e2") },
        uCold: { value: new THREE.Color("#ff8a20") },
        // The slug's head, matched to the body ramp above - it was
        // cyan too, and a gold bolt with a cyan nose is worse than
        // either on its own.
        uEnergyHot: { value: new THREE.Color("#fffdf4") },
        uEnergyCold: { value: new THREE.Color("#ffab2a") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: [
        "attribute float aBirth;",
        "attribute float aSize;",
        "attribute float aLife;",
        "attribute float aSeed;",
        "attribute float aTint;",
        "attribute vec2 aCorner;",
        "uniform float uTime;",
        "varying vec2 vUv;",
        "varying float vFade;",
        "varying float vSeed;",
        "varying float vTint;",
        "void main() {",
        "  float age = uTime - aBirth;",
        "  vFade = clamp(1.0 - age / aLife, 0.0, 1.0);",
        "  vUv = aCorner;",
        "  vSeed = aSeed;",
        "  vTint = aTint;",
        "  if (age < 0.0 || vFade <= 0.0) {",
        "    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
        "    return;",
        "  }",
        // Punches out fast and shrinks back, so the eye reads an
        // explosion rather than a fading decal.
        "  float grow = 0.55 + 0.45 * sqrt(1.0 - vFade);",
        "  float s = aSize * grow * (0.35 + 0.65 * vFade);",
        "  float a = aSeed * 6.2831;",
        "  vec2 r = vec2(cos(a), sin(a));",
        "  vec2 q = vec2(aCorner.x * r.x - aCorner.y * r.y,",
        "               aCorner.x * r.y + aCorner.y * r.x) * s;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  mv.xy += q;",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uHot;",
        "uniform vec3 uCold;",
        "uniform vec3 uEnergyHot;",
        "uniform vec3 uEnergyCold;",
        "varying vec2 vUv;",
        "varying float vFade;",
        "varying float vSeed;",
        "varying float vTint;",
        "void main() {",
        "  float r = length(vUv);",
        "  if (r > 1.0) discard;",
        "  float core = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);",
        // Four soft spikes on a random roll: enough to read as a
        // star rather than a ball, without looking like a decal.
        "  float ang = atan(vUv.y, vUv.x);",
        "  float star = pow(abs(cos(ang * 2.0 + vSeed * 6.2831)), 6.0);",
        "  float starBurst = core + star * pow(clamp(1.0 - r, 0.0, 1.0), 1.1) * 0.85;",
        "  float energy = step(1.5, vTint);",
        // A brief expanding annulus is the discharge field; ballistic
        // flashes keep the original four-spike star.
        "  float ring = smoothstep(0.26, 0.48, r)",
        "    * (1.0 - smoothstep(0.56, 0.88, r));",
        "  float energyBurst = core * 0.82 + ring * (0.45 + (1.0 - vFade) * 0.55)",
        "    + star * 0.20;",
        "  float burst = mix(starBurst, energyBurst, energy);",
        "  vec3 flashColour = mix(uCold, uHot, clamp(vTint * (0.35 + vFade), 0.0, 1.0));",
        "  vec3 energyColour = mix(uEnergyCold, uEnergyHot, core);",
        "  vec3 c = mix(flashColour, energyColour, energy);",
        "  float a = clamp(burst * vFade, 0.0, 1.0);",
        "  gl_FragColor = vec4(c * burst * vFade * 3.4, a);",
        "}",
      ].join("\n"),
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "flashes";
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    group.add(mesh);

    let cursor = 0;
    function emit(x, y, z, sizeVal, lifeVal, tintVal) {
      const i = cursor;
      cursor = (cursor + 1) % FLASH_MAX;
      const s = Math.random();
      for (let k = 0; k < 4; k += 1) {
        const v = i * 4 + k;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        birth[v] = atmos.elapsed;
        size[v] = sizeVal;
        life[v] = lifeVal;
        seed[v] = s;
        tint[v] = tintVal;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
      geo.attributes.aSeed.needsUpdate = true;
      geo.attributes.aTint.needsUpdate = true;
    }
    return { mesh, mat, emit };
  })();

  /** The bolt itself, drawn along the ray the hitscan already took.
   * `energy` is explicit because hostile return fire shares this pool. */
  function tracer(x, y, z, dx, dy, dz, distance,
    width = RELIQUARY_BOLT_WIDTH, energy = true) {
    if (!(distance > 0) || !Number.isFinite(distance)) return;
    const span = Math.min(distance, 900);
    const style = energy ? 1 : 0;
    tracers.emit(x, y, z, dx, dy, dz, span, width, style);
    /* THE WAKE. The bolt itself is one quad and reads as a clean
       object; against open sky, a clean object is also a small one,
       and there is nothing around it to say how fast or how far it
       went. These embers are lit as the slug reaches them and hang
       behind it, so the shot leaves a path instead of a dot.

       Counted off the distance rather than fixed, so a point-blank
       shot does not get the same trail as one across the basin, and
       capped so sustained fire cannot flush the pool. */
    const beads = Math.min(14, Math.max(3, Math.round(span * 0.22)));
    impacts.emitTrail(x, y, z, dx, dy, dz, span, TRACER_SPEED, beads,
      energy ? 0.62 : 0.55, energy ? 2.0 : 0.85);
  }

  /** The bloom at the muzzle, plus the gases leaving it. */
  function muzzle(x, y, z, dx, dy, dz, scale = 1, energy = false) {
    const tint = energy ? 2.0 : 1.0;
    /* THE BRIGHT ONE GOES ON THE MUZZLE.
       The second puff used to sit 0.34m along the shot, and from a
       third-person camera that is not "slightly in front" - forward
       projects toward the vanishing point, so with the lance head
       0.7m off the aim axis the offset flash landed ~40px toward
       screen centre and became the brightest thing in frame. The
       result was a blob of light hanging in the air ahead of the
       weapon with nothing under it, which is exactly what "the shot
       does not come from the lance" describes. Measured with zero
       simulation steps between emit and render, so this was the
       geometry and not a one-frame lag.

       0.10m still reads as gas leaving the cage and stays on it. */
    flashes.emit(x, y, z, (energy ? 1.06 : 0.85) * scale, 0.062, tint);
    flashes.emit(x + dx * 0.10, y + dy * 0.10, z + dz * 0.10,
      (energy ? 0.46 : 0.46) * scale, 0.085, energy ? 2.0 : 0.6);
    impacts.emitDirected(x + dx * 0.14, y + dy * 0.14, z + dz * 0.14,
      energy ? 7 : 9, dx, dy, dz, energy ? 6.5 : 9.0,
      (energy ? 0.68 : 0.6) * scale, tint);
  }

  /** An impact. `wall` softens it; `energy` keeps melee and debris warm. */
  function spark(x, y, z, scale = 1, wall = false, energy = false) {
    /* Was 9 particles and nothing else, which at the far end of a
       300m shot is a few pixels of dust - the "small impact" in the
       report. A hit now reads at range as a flash first and debris
       second, because the flash is what survives the distance. */
    impacts.emit(x, y, z, wall ? 14 : 26, wall ? 3.2 : 5.2,
      scale * (wall ? 1.0 : 1.5), energy ? 2.0 : (wall ? 0.25 : 0.95));
    flashes.emit(x, y, z, (wall ? 0.5 : 0.78) * scale, wall ? 0.09 : 0.13,
      energy ? 2.0 : (wall ? 0.45 : 1.0));
  }

  /** A warm reliquary crescent that traces the physical sweep. The arc is
   *  made from pooled impact motes rather than a transparent ribbon, so it
   *  stays readable against sand and remains cheap when a pack is struck. */
  function meleeArc(x, y, z, yaw, reach, arc, hits = 0, slam = false) {
    const points = slam ? 7 : 6;
    const radius = reach * (slam ? 0.72 : 0.84);
    const start = yaw - arc * 0.5;
    for (let i = 0; i < points; i += 1) {
      const t = points > 1 ? i / (points - 1) : 0.5;
      const a = start + arc * t;
      const px = x + Math.sin(a) * radius;
      const pz = z + Math.cos(a) * radius;
      const lift = y + 0.58 + Math.sin(t * Math.PI) * (slam ? 0.46 : 0.74);
      impacts.emit(px, lift, pz, hits ? 3 : 2, slam ? 1.8 : 1.35,
        (hits ? 0.30 : 0.16) * (slam ? 1.15 : 1), 1.3);
    }
    const tipYaw = yaw + arc * 0.5;
    flashes.emit(x + Math.sin(tipYaw) * radius, y + (slam ? 0.48 : 1.0),
      z + Math.cos(tipYaw) * radius, hits ? 0.55 : 0.28, 0.075, 1.4);
  }

  /** A stratagem landing. */
  function blast(x, y, z, radius) {
    impacts.emit(x, y + 0.6, z, 64, radius * 0.5, 2.6, 1.0);
    impacts.emit(x, y + 0.2, z, 40, radius * 0.22, 4.2, 0.15);
  }

  /** Sand, stone and a low bio-flash thrown by a creature surfacing. */
  function breach(x, y, z, radius, intensity = 1) {
    const power = Math.max(0.5, intensity);
    impacts.emit(x, y + 0.12, z, Math.round(22 * power), radius * 0.78,
      0.72 * power, 0.12);
    impacts.emit(x, y + 0.28, z, Math.round(12 * power), radius * 0.38,
      1.15 * power, 0.62);
    flashes.emit(x, y + 0.16, z, radius * 0.22, 0.18 + power * 0.025, 0.28);
  }

  return {
    group,
    plumes,
    banners: bannerMesh,
    shafts,
    spark,
    meleeArc,
    blast,
    breach,
    tracer,
    muzzle,
    update(dt, camera) {
      // Snap the anchor so the wrapped systems do not slide with
      // sub-metre camera motion, which reads as the whole dust field
      // sticking to the camera.
      anchor.set(
        Math.round(camera.position.x / 8) * 8,
        camera.position.y,
        Math.round(camera.position.z / 8) * 8
      );
      const ground = terrain.heightAt(anchor.x, anchor.z);
      impacts.mat.uniforms.uTime.value = atmos.elapsed;
      impacts.mat.uniforms.uPixel.value = Math.min(2, window.devicePixelRatio || 1) * 2.2;
      tracers.mat.uniforms.uTime.value = atmos.elapsed;
      flashes.mat.uniforms.uTime.value = atmos.elapsed;
      streamers.mat.uniforms.uAnchor.value.copy(anchor);
      streamers.mat.uniforms.uGround.value = ground;
      dust.mat.uniforms.uAnchor.value.set(anchor.x, ground + 14, anchor.z);
      grit.mat.uniforms.uAnchor.value.set(anchor.x, ground + 2.2, anchor.z);

      const t = atmos.elapsed;
      for (const f of flicker) {
        const spec = f.light.userData.spec;
        if (!spec.flicker) continue;
        const n = Math.sin(t * 11.3 + f.phase) * 0.5 + Math.sin(t * 4.1 + f.phase * 1.7) * 0.5;
        f.light.intensity = f.light.userData.baseIntensity * (1 + n * 0.16 * spec.flicker);
      }
      void dt;
    },
    setStorm(v) {
      streamers.mat.uniforms.uOpacity.value = lerp(0.13, 0.62, v);
      dust.mat.uniforms.uOpacity.value = lerp(0.16, 0.70, v);
      grit.mat.uniforms.uOpacity.value = lerp(0.20, 0.80, v);
    },
    setVisible(v) { group.visible = v; },
  };
}
