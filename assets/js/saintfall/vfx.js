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

import { TAU, clamp, clamp01, lerp, sstep, makeRng, hexToRgb } from "saintfall/core.js";
import {
  srgbTransfer as srgb, patchMaterial, patchBasicMaterial,
} from "saintfall/art.js";
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

  /* World-anchored, then folded into the box around the camera - see
     the long note in POINT_VERT. The fold is computed from the HEAD
     of the strip, which every vertex agrees on, and applied as one
     shared offset: fold each vertex on its own and a ribbon whose
     ends straddle the boundary is stretched right across the field. */
  vec3 origin = vec3(sx * uRange, 0.0, sz * uRange);
  float travel = t * speed * life;
  vec2 head = origin.xz + wind * travel;
  vec2 rel = head - uAnchor.xz;
  vec2 fold = (mod(rel + uRange, uRange * 2.0) - uRange) - rel;

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

  p.xz += fold;

  // Fade at birth, at death, and with distance from the camera.
  float ends = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.62, 1.0, t));
  float d = length(p.xz - uAnchor.xz);
  float near = smoothstep(2.0, 9.0, d);
  float far = 1.0 - smoothstep(uRange * 0.5, uRange * 0.92, d);
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

  /* THE MOTE LIVES IN THE WORLD, NOT ON THE CAMERA.
     Its horizontal position used to be uAnchor + hash * uBox - the
     field measured from the viewer - and uAnchor was SNAPPED to 8m
     to stop that sliding. Which it did, by trading a slide for a
     JUMP: between boundaries the field held still, and every eight
     metres of travel the anchor stepped and all nine hundred motes
     moved eight metres sideways in one frame. Standing still the
     anchor never steps and none of it happens, which is how it
     survived every still review in the project.

     Now the mote has a fixed world position and is folded into the
     box around the camera by whole box-widths. The fold moves
     nothing: it is a multiple of the box, so a mote's drawn position
     only changes when it crosses the boundary - and that is out
     where the distance fade has already taken it to zero. */
  vec3 p = vec3(
    (h11(aSeed) * 2.0 - 1.0) * uBox.x,
    uAnchor.y + (h11(aSeed + 2.3) * 2.0 - 1.0) * uBox.y,
    (h11(aSeed + 5.9) * 2.0 - 1.0) * uBox.z
  );
  p.xz += wind * t * life * uDrift;
  p.y += t * life * uRise;
  // A little wander, so a field of motes does not move as a block.
  p.x += sin(uTime * 0.7 + aSeed * 4.0) * 0.9;
  p.z += cos(uTime * 0.62 + aSeed * 6.0) * 0.9;

  vec2 span = uBox.xz * 2.0;
  vec2 rel = p.xz - uAnchor.xz;
  p.xz += (mod(rel + uBox.xz, span) - uBox.xz) - rel;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  /* Out by 0.95 of the half-box, because that is where the fold is.
     At the old 1.05 a mote was still at 3% opacity when it wrapped,
     and one in every few hundred blinked across the field. */
  vFade = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.55, 1.0, t))
        * (1.0 - smoothstep(uBox.x * 0.45, uBox.x * 0.95, length(p.xz - uAnchor.xz)))
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

   Every shaft in the level is a cone SHELL, and a shell is the
   wrong primitive for a volume. Three things hide that; take any
   one of them away and the shafts stop being light and start being
   drawn polygons hanging in the air.

   1. THE CHORD TERM, in the fragment shader. How bright a volume
      looks at a point is how far the view ray travels inside it,
      which for a point on a cone shell is |dot(radial, view)| -
      full through the middle of the cone, zero at its rim. A shell
      without it is brightest exactly ALONG ITS OWN OUTLINE, because
      that is where the near and far sheets meet and both add. That
      is not a subtlety: it is the whole reason the Choir Spires
      shafts read as pale bars ruled across the sky, with edges
      straight enough to look like a rendering fault.

   2. BOTH ENDS DIE. The old profile started at full brightness at
      t=0, so the top of every cone was a hard lit ring floating in
      open air - a cut end. Light has to arrive from somewhere and
      land on something; the window fades it in under the slot and
      out again into the floor.

   3. IT HAS TO LAND. A shaft that stops in mid-air is a bar. Sun
      shafts get their length from the terrain under where they
      actually fall, so the cone always reaches the sand.

   Sun-tracked shafts also FOLLOW THE SUN. The direction used to be
   baked from `atmos.sunDir` at build time, but the day cycle turns
   the sun through a full circle every eighteen minutes, so within a
   couple of minutes of play every outdoor shaft was pointing
   somewhere the light was not - and they were still there, warm and
   bright, at midnight.
   ============================================================ */

/* 22, not 10. The chord term goes to zero exactly ON the rim, but
   between the rim vertex and the next one round it climbs by
   sin(360/sides) - at ten sides that is 0.59 in a single facet, and
   a shell that goes from nothing to two thirds brightness across one
   triangle has a ruled edge again. The whole point of the term is a
   rim you cannot find, and that needs the ring finely enough divided
   to fade across several triangles. Tessellation is free here: the
   cost of an additive volume is overdraw, and overdraw does not
   change when you cut the same cone into more pieces. */
const SHAFT_SIDES = 22;
const SHAFT_STEPS = 6;
/* A sun shaft takes its BEARING from the sun and only borrows its
   pitch. Dusk puts the sun 2.2 degrees up and golden hour 13.5, and
   a shaft raked to match is not a shaft: it is a hundred metres of
   cone lying across the district like a fallen column. Floored at 44
   degrees, which still leans visibly with the hour between here and
   the 62 of noon. */
const SHAFT_MIN_PITCH = 58 * Math.PI / 180;
/* And a hard stop, because the needles differ by 44m in height. */
const SHAFT_MAX_LEN = 78;

/** Additive glow with the chord term. See (1) above. */
function shaftMaterial(ctx) {
  const { THREE, atmos } = ctx;
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: true,
  });
  m.name = "sf-shaft";
  // Additive, so it fades to black with distance rather than toward
  // the sky - and it gets the near fade that stops a cone the camera
  // has walked inside from painting itself over the whole frame.
  patchBasicMaterial(m, atmos, 1.0, true);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 aRadial;
varying vec3 vShaftRadial;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
  vShaftRadial = aRadial;`)
      /* The radial is authored in world space by the builder, which
         also owns the only transform these ever get (none - the mesh
         sits at the origin), so there is no normal matrix to apply
         and nothing to renormalise. */;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vShaftRadial;`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
{
  vec3 sfView = normalize(cameraPosition - vSFWorld);
  // 1.5, not 1.0. The true chord is linear in |dot|, but a cone shell
  // is a lie about a volume and the lie shows at the edges; leaning
  // on the rim buys a wider, softer boundary for a core that is
  // barely touched.
  gl_FragColor.rgb *= pow(abs(dot(normalize(vShaftRadial), sfView)), 1.5);
}`);
    m.userData.sfShader = shader;
  };
  m.customProgramCacheKey = () => "sf-shaft";
  m.needsUpdate = true;
  return m;
}

/**
 * One mesh for every shaft in the level, rewritten in place when the
 * sun moves. All the cones share a topology, so the buffers are
 * allocated once and `follow` only ever overwrites floats - no
 * allocation, no geometry merge, nothing for the GC to find.
 */
function buildShafts(ctx, specs) {
  const { THREE, terrain, atmos } = ctx;
  if (!specs.length) return null;

  const RING = SHAFT_SIDES * (SHAFT_STEPS + 1);
  const total = specs.length * RING;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const rad = new Float32Array(total * 3);
  const idx = [];
  for (let s = 0; s < specs.length; s += 1) {
    const base = s * RING;
    for (let k = 0; k < SHAFT_STEPS; k += 1) {
      for (let i = 0; i < SHAFT_SIDES; i += 1) {
        const n = (i + 1) % SHAFT_SIDES;
        const a0 = base + k * SHAFT_SIDES + i;
        const a1 = base + k * SHAFT_SIDES + n;
        const b0 = base + (k + 1) * SHAFT_SIDES + i;
        const b1 = base + (k + 1) * SHAFT_SIDES + n;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const radAttr = new THREE.BufferAttribute(rad, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("color", colAttr);
  geo.setAttribute("aRadial", radAttr);
  geo.setIndex(idx);

  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const origin = new THREE.Vector3();

  /* Prepared per shaft so `follow` never touches a string or an
     object literal: the tint in linear space, and the side of the
     needle the light comes past, alternating so a district of them
     is not all lit from the same flank. */
  const prep = specs.map((spec, i) => {
    const c = hexToRgb(spec.colour || "#ffd9a0");
    return {
      spec,
      r: srgb(c[0]), g: srgb(c[1]), b: srgb(c[2]),
      side: i % 2 ? 1 : -1,
    };
  });

  function writeShaft(slot, p) {
    const { spec } = p;
    const sun = spec.sun === true;

    if (sun) {
      // Down-sun in bearing, floored in pitch.
      const flat = Math.hypot(atmos.sunDir.x, atmos.sunDir.z) || 1;
      const pitch = Math.max(SHAFT_MIN_PITCH, Math.atan2(atmos.sunDir.y, flat));
      const c = Math.cos(pitch);
      dir.set(-atmos.sunDir.x / flat * c, -Math.sin(pitch), -atmos.sunDir.z / flat * c);
      /* Offset across the sun, not along it. The shaft is the lit air
         BESIDE the needle's shadow, so as the sun swings round the
         slot swings with it and the light keeps grazing rock instead
         of drifting off into open sky. */
      right.set(-atmos.sunDir.z / flat, 0, atmos.sunDir.x / flat);
      origin.set(spec.x, spec.y, spec.z)
        .addScaledVector(right, (spec.offset || 0) * p.side);
    } else {
      dir.set(...(spec.dir || [0, -1, 0])).normalize();
      origin.set(spec.x, spec.y, spec.z);
    }

    let len = spec.length || 40;
    if (sun) {
      /* Land it. Sampled twice because where the shaft falls is not
         where it starts, and on this terrain those differ by more
         than the shaft is wide. */
      const fall = Math.max(0.2, -dir.y);
      let ground = terrain.heightAt(origin.x, origin.z);
      len = (origin.y - ground) / fall;
      ground = terrain.heightAt(origin.x + dir.x * len, origin.z + dir.z * len);
      len = clamp((origin.y - ground) / fall + 3, 18, SHAFT_MAX_LEN);
    }

    const r0 = (spec.radius || 4) * 0.55;
    const r1 = (spec.radius || 4) * 1.5;
    // A local frame for the cone. Any perpendicular pair will do.
    axis.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.94) axis.set(1, 0, 0);
    right.crossVectors(dir, axis).normalize();
    fwd.crossVectors(right, dir).normalize();

    const gain = (spec.gain ?? 1) * (sun ? clamp01(atmos.daylightFactor ?? 1) : 1);
    let w = slot * RING * 3;
    for (let k = 0; k <= SHAFT_STEPS; k += 1) {
      const t = k / SHAFT_STEPS;
      const rr = lerp(r0, r1, t);
      /* 0.26 peak, not 0.9. A shaft of light is a small amount of
         dust catching a lot of sun; at 0.9 these rendered as solid
         pale wedges visible from the far side of the map. Both ends
         are windowed to nothing - see (2) - and the middle thins as
         the cone spreads, because the same light is being shared
         out over more air. */
      const bright = sstep(0, 0.26, t) * (1 - sstep(0.52, 1, t))
        * (1 - t * 0.55) * 0.26 * gain;
      const cx = origin.x + dir.x * t * len;
      const cy = origin.y + dir.y * t * len;
      const cz = origin.z + dir.z * t * len;
      for (let i = 0; i < SHAFT_SIDES; i += 1) {
        const a = (i / SHAFT_SIDES) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rx = right.x * ca + fwd.x * sa;
        const ry = right.y * ca + fwd.y * sa;
        const rz = right.z * ca + fwd.z * sa;
        pos[w] = cx + rx * rr;
        pos[w + 1] = cy + ry * rr;
        pos[w + 2] = cz + rz * rr;
        rad[w] = rx;
        rad[w + 1] = ry;
        rad[w + 2] = rz;
        col[w] = p.r * bright;
        col[w + 1] = p.g * bright;
        col[w + 2] = p.b * bright;
        w += 3;
      }
    }
  }

  const tracked = specs.some((s) => s.sun === true);
  let sunKey = "";

  /** Rewrite the sun-tracked cones if the sun has actually moved.
   *  Cheap, but not free, and the sun crosses the sky in eighteen
   *  minutes - two decimals on a unit vector is under a degree of
   *  slack, which comes out at a rebuild every couple of seconds. */
  function follow() {
    if (!tracked) return false;
    const s = atmos.sunDir;
    const key = `${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)},`
      + `${(atmos.daylightFactor ?? 1).toFixed(2)}`;
    if (key === sunKey) return false;
    sunKey = key;
    for (let i = 0; i < prep.length; i += 1) {
      if (prep[i].spec.sun === true) writeShaft(i, prep[i]);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    radAttr.needsUpdate = true;
    return true;
  }

  for (let i = 0; i < prep.length; i += 1) writeShaft(i, prep[i]);
  follow();
  geo.computeBoundingSphere();
  /* Pinned, because the sun-tracked cones move every few seconds and
     a bounding sphere recomputed per rewrite is both a cost and a
     source of frustum-cull popping. The basin is 2km across; one
     sphere over the whole thing culls nothing and never lies. */
  geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 1800);

  const mesh = new THREE.Mesh(geo, shaftMaterial(ctx));
  mesh.name = "shafts";
  mesh.renderOrder = 7;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.follow = follow;
  return mesh;
}

/* ============================================================
   GROUND MARKS

   Boot prints and the scar a boosted glide cuts through the sand.
   One pooled quad buffer for both: they differ only in proportion
   and in how hard they bite, and a mark laid on sand is the same
   object either way - a depression that holds shadow, ringed by the
   sand it displaced.

   THE HEIGHT IS THE WHOLE PROBLEM. `heightAt` is the authoring
   field; the terrain MESH samples it on a 4m grid and interpolates,
   and the drawn ground therefore runs up to 12cm above the analytic
   value. A mark laid at `heightAt + epsilon` sinks under its own
   ground about half the time - which reads as marks that appear on
   some steps and not others, for no reason a player could name.
   `terrain.groundHeightAt` reproduces the drawn triangles exactly,
   including their alternating diagonals, and is the only correct
   source here.

   And they lie in the TANGENT PLANE, not flat. A 0.9m skid quad held
   horizontal has each end 25cm out of the ground on a 30-degree
   face, so half of every mark on a dune flank would be buried and
   the other half would hover.
   ============================================================ */

const DECAL_VERT = /* glsl */`
precision highp float;
attribute vec2 aCorner;     // -1..1 across, -1..1 along
attribute vec3 aMeta;       // birth, life, bite

uniform float uTime;

varying vec2  vCorner;
varying float vFade;
varying float vBite;
varying vec3  vWorld;

void main() {
  float age = (uTime - aMeta.x) / max(0.001, aMeta.y);
  /* Cut instantly, fill in slowly. Sand is displaced in the moment
     the boot lands; what takes time is the wind putting it back. */
  vFade = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.35, 1.0, age));
  if (age < 0.0 || age > 1.0) vFade = 0.0;
  vCorner = aCorner;
  vBite = aMeta.z;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const DECAL_FRAG = /* glsl */`
precision highp float;
varying vec2  vCorner;
varying float vFade;
varying float vBite;
varying vec3  vWorld;

uniform vec3  uDark;
uniform vec3  uLight;
uniform float uOpacity;
uniform float uRange;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  if (vFade <= 0.003) discard;

  /* A capsule, not an ellipse: a boot and a skid are both a straight
     run with rounded ends, and an ellipse reads as a stamped decal. */
  float along = max(abs(vCorner.y) - 0.42, 0.0) / 0.58;
  float d = length(vec2(vCorner.x, along));
  /* Broken up on a world-space lattice so no two marks carry the
     same outline and none of them is a clean oval. */
  vec2 cell = floor(vWorld.xz * 6.0);
  d *= 0.90 + 0.20 * h21(cell);
  if (d > 1.0) discard;

  /* The hollow, and the sand pushed out of it. The ridge is kept
     THIN and WEAK on purpose: at equal strength the two terms make a
     closed bright ellipse round a dark middle, and a closed outline
     is the one shape that reads as a decal stamped on the ground
     rather than as a dent in it. */
  float core = 1.0 - smoothstep(0.0, 0.78, d);
  float rim  = smoothstep(0.66, 0.88, d) * (1.0 - smoothstep(0.88, 1.0, d));

  float ink = core * 0.88 + rim * 0.20;
  vec3 col = mix(uDark, uLight, rim / max(rim + core, 1e-3));

  /* Out by 90m. Closer than the terrain LOD switch, because a mark
     is a few pixels by then and a few pixels of high-contrast noise
     crawling over a dune is the one thing worse than no mark. */
  float far = 1.0 - smoothstep(uRange * 0.6, uRange, length(cameraPosition - vWorld));

  gl_FragColor = vec4(col, ink * vFade * vBite * uOpacity * far);
}
`;

function buildDecals(ctx, opts = {}) {
  const { THREE, terrain, atmos } = ctx;
  const MAX = opts.max || 168;
  const pos = new Float32Array(MAX * 4 * 3);
  const corner = new Float32Array(MAX * 4 * 2);
  const meta = new Float32Array(MAX * 4 * 3);
  const idx = [];
  for (let s = 0; s < MAX; s += 1) {
    const b = s * 4;
    corner.set([-1, -1, 1, -1, 1, 1, -1, 1], s * 8);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    // A life of zero divides; park every unused slot far in the past.
    for (let v = 0; v < 4; v += 1) {
      meta[(b + v) * 3] = -1e5;
      meta[(b + v) * 3 + 1] = 1;
    }
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const metaAttr = new THREE.BufferAttribute(meta, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  geo.setAttribute("aMeta", metaAttr);
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const dark = hexToRgb(opts.dark || "#2c1c12");
  const light = hexToRgb(opts.light || "#f0d3a6");
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: atmos.uniforms.uTimeSF,
      uDark: { value: new THREE.Vector3(srgb(dark[0]), srgb(dark[1]), srgb(dark[2])) },
      uLight: { value: new THREE.Vector3(srgb(light[0]), srgb(light[1]), srgb(light[2])) },
      uOpacity: { value: opts.opacity ?? 0.42 },
      uRange: { value: opts.range ?? 90 },
    },
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    /* The corner order (-1,-1),(1,-1),(1,1),(-1,1) about a +Y normal
       winds CLOCKWISE seen from above, so every mark faced the
       ground and was culled: twenty-eight live decals contributing
       exactly zero pixels, with no error anywhere to say so. Winding
       is also not stable here - `wide` and `long` come from callers -
       so this is DoubleSide rather than a flipped index, and the
       backfaces are behind opaque terrain either way. */
    side: THREE.DoubleSide,
    /* Pulled toward the eye on top of the 3cm lift. The lift alone
       handles the sample error; this handles the depth buffer, which
       has no precision to spare for two surfaces 3cm apart at 90m. */
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = "ground-marks";
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  let cursor = 0;

  /** The height the ground is DRAWN at, which is not `heightAt`. */
  const ground = terrain.groundHeightAt
    ? (x, z) => { const y = terrain.groundHeightAt(x, z); return Number.isFinite(y) ? y : null; }
    : (x, z) => { const y = terrain.heightAt(x, z); return Number.isFinite(y) ? y : null; };

  /* Authored floors - the Pilgrim's Road, plazas, the nave - stand
     ABOVE the terrain and are not part of the height field. A mark
     laid from the terrain there is buried under the paving, which
     would read as prints that stop working on the one surface the
     player spends the most time crossing. Nothing is displaced when
     you walk on stone, so nothing is laid. */
  const paved = typeof opts.walkSurfaceAt === "function"
    ? (x, z, g) => opts.walkSurfaceAt(x, z) > g + 0.06
    : () => false;

  /**
   * Lay one mark. `yaw` is the direction of travel; `wide`/`long` are
   * half-extents in metres across and along it.
   */
  const cornerY = [0, 0, 0, 0];
  const cornerX = [0, 0, 0, 0];
  const cornerZ = [0, 0, 0, 0];

  function mark(x, z, yaw, wide, long, bite = 1, life = 5) {
    /* EACH CORNER TAKES ITS OWN GROUND HEIGHT. The obvious build - a
       flat quad in the terrain's tangent plane, lifted clear - cannot
       work: the normal is an average of triangles the quad spans, so
       the plane matches the ground at the centre and diverges from it
       outward. Lifting it far enough that no corner is buried put the
       far corner 14cm in the air.
       Reading the drawn height at each corner makes the quad a patch
       that hugs the mesh instead, and the two triangles it is drawn
       as follow the two the ground is drawn as. */
    const centre = ground(x, z);
    if (centre === null || paved(x, z, centre)) return;

    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    for (let v = 0; v < 4; v += 1) {
      const u = corner[v * 2] * wide;
      const w = corner[v * 2 + 1] * long;
      // Across is (cos, -sin) to yaw's (sin, cos).
      cornerX[v] = x + cy * u + sy * w;
      cornerZ[v] = z - sy * u + cy * w;
      const g = ground(cornerX[v], cornerZ[v]);
      // Off the map, or over something with no ground under it.
      if (g === null) return;
      cornerY[v] = g + 0.03;
    }

    const slot = cursor;
    cursor = (cursor + 1) % MAX;
    const base = slot * 4;
    const birth = atmos.elapsed;
    for (let v = 0; v < 4; v += 1) {
      const o = (base + v) * 3;
      pos[o] = cornerX[v];
      pos[o + 1] = cornerY[v];
      pos[o + 2] = cornerZ[v];
      meta[o] = birth;
      meta[o + 1] = life;
      meta[o + 2] = bite;
    }
    posAttr.needsUpdate = true;
    metaAttr.needsUpdate = true;
  }

  return { mesh, mat, mark };
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

  /* Extra light shafts, authored rather than emitted: the clerestory
     of the nave. The Choir Spires' shafts are emitted instead, from
     world.js, because only the spire loop knows where the spires
     are - and a shaft that is not anchored to one is just a bar.

     The scatter that used to live here is the whole reason this was
     reported as broken. It dropped six cones at a random bearing and
     a random height over a 320m district, which put most of them in
     open sky with no rock within a hundred metres, pointing along a
     sun direction frozen at world-build time. */
  {
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

  const marks = buildDecals(ctx, { max: 168, walkSurfaceAt: world.walkSurfaceAt });
  group.add(marks.mesh);

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
    /* Per-particle lifetime. The pool ran on one hardcoded 0.62s span
       for every emitter in the game, which is right for the dust off a
       bullet and wrong for anything that is supposed to leave an
       AFTERMATH: a capstone's embers died in the same two-thirds of a
       second as a ricochet, so no rite ever had a settling phase. */
    const span = new Float32Array(IMPACT_MAX).fill(0.62);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
    geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
    geo.setAttribute("aSpan", new THREE.BufferAttribute(span, 1));
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
        // The Coulter's venom, and the only green in the game. See the
        // palette note in the Blender kit: green means hazard here and
        // nothing else, so it may not drift toward either the brood's
        // cyan or the Concord's gold.
        uVenomHot: { value: new THREE.Color("#eaff9c") },
        uVenomCold: { value: new THREE.Color("#4f7a12") },
        // Cool, barely-blue vapour. Kept close to neutral so it reads
        // as steam against warm sand rather than as a magic effect.
        uSteam: { value: new THREE.Color("#cfe4ec") },
        // Doctrine cues share this pool, but each Order keeps a hue
        // that survives sand, bloom and distance. Values 6-10 on the
        // style channel are reserved for these five colours.
        uDoctrineCenser: { value: new THREE.Color("#ffbd3e") },
        uDoctrineProcession: { value: new THREE.Color("#ff7045") },
        uDoctrineWing: { value: new THREE.Color("#08d4ff") },
        uDoctrineHalo: { value: new THREE.Color("#6684ff") },
        uDoctrineEdict: { value: new THREE.Color("#20e0a6") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        "attribute vec3 aVel;",
        "attribute float aBirth;",
        "attribute float aSize;",
        "attribute float aTint;",
        "attribute float aSpan;",
        "uniform float uTime;",
        "uniform float uPixel;",
        "varying float vLife;",
        "varying float vTint;",
        "void main() {",
        "  float age = uTime - aBirth;",
        "  float span = max(0.08, aSpan);",
        "  vLife = clamp(1.0 - age / span, 0.0, 1.0);",
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
        /* `aTint` is the pool's style channel as well as its heat, in
           bands: under 1.5 is debris, 1.5-3.5 is a reliquary ion,
           3.5-4.5 is a venom droplet, 4.5-5.5 is venom gas, and
           6-10 are the five Doctrine Orders. Energy, gas and Doctrine
           motes hang; debris and droplets fall, because a thrown
           liquid that floats reads as a spore. */
        "  float doctrine = step(5.5, aTint);",
        "  float venom = step(3.5, aTint) * (1.0 - doctrine);",
        "  float gas = step(4.5, aTint) * (1.0 - doctrine);",
        "  float energy = step(1.5, aTint) * (1.0 - venom) * (1.0 - doctrine);",
        "  float fall = (1.0 - energy) * (1.0 - gas) * (1.0 - doctrine);",
        /* Doctrine motes DECELERATE. Integrating a constant velocity for
           the whole span is what made the Wing feathers read as escaping
           soap bubbles: they left at 8m/s and were still doing 8m/s when
           they faded out past the horizon line. The eye only accepts a
           mote as something the world threw once it watches the throw
           die. Steam keeps its climb - a vent plume rises - so only the
           five Orders get the settle term underneath it. */
        "  float steamV = step(10.5, aTint);",
        "  float rite = doctrine * (1.0 - steamV);",
        "  float drag = 3.0 * doctrine;",
        "  float travel = mix(age, (1.0 - exp(-drag * age)) / max(0.0001, drag),",
        "    doctrine);",
        "  vec3 p = position + aVel * travel",
        "    - vec3(0.0, 9.0, 0.0) * age * age * fall",
        "    - vec3(0.0, 1.15, 0.0) * age * age * rite;",
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
        "uniform vec3 uVenomHot;",
        "uniform vec3 uVenomCold;",
        "uniform vec3 uDoctrineCenser;",
        "uniform vec3 uDoctrineProcession;",
        "uniform vec3 uDoctrineWing;",
        "uniform vec3 uDoctrineHalo;",
        "uniform vec3 uDoctrineEdict;",
        "uniform vec3 uSteam;",
        "varying float vLife;",
        "varying float vTint;",
        "void main() {",
        "  vec2 d = gl_PointCoord - 0.5;",
        "  float r = dot(d, d);",
        "  if (r > 0.25) discard;",
        "  float core = smoothstep(0.25, 0.0, r);",
        "  float doctrine = step(5.5, vTint);",
        "  float venom = step(3.5, vTint) * (1.0 - doctrine);",
        "  float energy = step(1.5, vTint) * (1.0 - venom) * (1.0 - doctrine);",
        "  vec3 sparkColour = mix(uCold, uHot, clamp(vTint * vLife, 0.0, 1.0));",
        "  vec3 ionColour = mix(uEnergyCold, uEnergyHot, 0.30 + vLife * 0.70);",
        /* Kept at the SATURATED end of its own ramp. Mixed toward the
           pale hot colour the way a spark is, venom gas came out as
           white motes - and white is what every other particle in the
           game already is, so the one hazard colour stopped being one. */
        "  vec3 venomColour = mix(uVenomCold, uVenomHot, 0.08 + vLife * 0.30);",
        "  vec3 doctrineColour = uDoctrineCenser;",
        "  doctrineColour = mix(doctrineColour, uDoctrineProcession, step(6.5, vTint));",
        "  doctrineColour = mix(doctrineColour, uDoctrineWing, step(7.5, vTint));",
        "  doctrineColour = mix(doctrineColour, uDoctrineHalo, step(8.5, vTint));",
        "  doctrineColour = mix(doctrineColour, uDoctrineEdict, step(9.5, vTint));",
        // Doctrine particles keep their Order hue through bloom. The
        // old white-core mix made Wing and Edict both read as sparks.
        "  doctrineColour = mix(doctrineColour, vec3(1.0), clamp(core * 0.16 + vLife * 0.05, 0.0, 0.22));",
        "  vec3 c = mix(mix(sparkColour, ionColour, energy), venomColour, venom);",
        "  c = mix(c, doctrineColour, doctrine);",
        /* AN EMBER, NOT A BOKEH DISC. Two things were making every
           rite's motes read as soap bubbles floating past the lens.

           The profile: `core` is a wide smooth falloff, which is right
           for the dust cloud off a wall hit and wrong for a cinder -
           a cinder is a small hot point with a short halo, so the rite
           band squares its falloff into a tighter dot.

           The level: at full life the shared gain reached 1.85, which
           drives a saturated hue past 1.0 one channel at a time and
           lands on white, exactly as the muzzle flash did. Normalising
           by the Order's own peak channel keeps the ratio - so the
           Censer stays gold and the Procession stays vermilion all the
           way into the highlight. */
        "  float riteBand = step(5.5, vTint) * (1.0 - step(10.5, vTint));",
        "  float ritePeak = max(doctrineColour.r,",
        "    max(doctrineColour.g, doctrineColour.b));",
        "  core = mix(core, core * core * (0.55 + 0.45 * core), riteBand);",
        /* STEAM sits above the Doctrine band and is applied last, so
           it wins outright. Every other band in this pool is a HOT
           colour - ember, ion, venom, Order gold - and a weapon vent
           borrowing any of them reads as the gun catching fire, which
           is the exact opposite of what venting does. It is also
           deliberately dimmed rather than mixed toward white: vapour
           scatters light, it does not emit it, and at this pool's
           additive-ish output an undimmed steam plume blows straight
           through the bloom threshold and becomes a flare. */
        "  float steam = step(10.5, vTint);",
        "  vec3 steamColour = uSteam * (0.55 + vLife * 0.45);",
        "  c = mix(c, steamColour, steam);",
        "  float bright = mix(0.35 + vLife * 1.5, 0.18 + vLife * 0.62, steam);",
        "  bright = mix(bright, (0.30 + vLife * 0.92) / max(0.32, ritePeak),",
        "    riteBand);",
        "  gl_FragColor = vec4(c * core * bright, core * vLife * mix(1.0, 0.72, steam));",
        "}",
      ].join("\n"),
    });

    const points = new THREE.Points(geo, mat);
    points.name = "impacts";
    points.frustumCulled = false;
    group.add(points);

    let cursor = 0;
    /** Flag every attribute at once. Five call sites were maintaining
     *  the same list by hand, and adding `aSpan` to four of five is the
     *  kind of omission that shows up as one emitter's particles
     *  inheriting whatever lifetime the ring buffer last held. */
    function flush() {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aVel.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aTint.needsUpdate = true;
      geo.attributes.aSpan.needsUpdate = true;
    }

    function emit(x, y, z, count, spread, scale, tintVal, life = 0.62) {
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
        // Spread the span across the burst so a cloud thins out from
        // its edges instead of switching off on one frame.
        span[k] = life * (0.72 + Math.random() * 0.56);
      }
      flush();
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
      tintVal = 0.85, life = 0.62) {
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
        span[k] = life * (0.72 + Math.random() * 0.56);
      }
      flush();
    }

    function emitDirected(x, y, z, count, dx, dy, dz, speed, scale, tintVal,
      life = 0.62) {
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
        span[k] = life * (0.72 + Math.random() * 0.56);
      }
      flush();
    }

    /**
     * Motes seeded around a ring rather than at a point, each thrown
     * along its own outward bearing and delayed by its angle.
     *
     * A rite that expands as a WAVE cannot be built from a point
     * emitter: everything leaves the centre at once, so the fastest
     * mote is always the leading edge and the shape reads as a
     * fountain. Seeding the circle makes the wave itself the emitter.
     */
    function emitRing(x, y, z, count, radius, speed, rise, scale, tintVal,
      life = 0.62, sweep = 0, phase = 0) {
      for (let i = 0; i < count; i += 1) {
        const k = cursor;
        cursor = (cursor + 1) % IMPACT_MAX;
        const a = phase + (i / count) * TAU + (Math.random() - 0.5) * 0.22;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const r = radius * (0.86 + Math.random() * 0.28);
        pos[k * 3] = x + ca * r;
        pos[k * 3 + 1] = y + Math.random() * 0.18;
        pos[k * 3 + 2] = z + sa * r;
        const s = speed * (0.6 + Math.random() * 0.7);
        vel[k * 3] = ca * s;
        vel[k * 3 + 1] = rise * (0.45 + Math.random() * 1.0);
        vel[k * 3 + 2] = sa * s;
        // A non-zero sweep lets the circle IGNITE around instead of
        // all at once, which is what makes a toll read as rotating.
        birth[k] = atmos.elapsed + sweep * (i / count);
        size[k] = scale * (6 + Math.random() * 9);
        tint[k] = tintVal;
        span[k] = life * (0.72 + Math.random() * 0.56);
      }
      flush();
    }
    return { points, mat, emit, emitDirected, emitTrail, emitRing };
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
  /* Hostile plasma still travels so incoming fire has a direction the
     player can read and evade. The player's censer-lance is hitscan and
     now draws a single, brief tip-to-impact laser instead of borrowing
     this moving-bolt timing. */
  const TRACER_SPEED = 150;
  /* Retained for QA/introspection of legacy slots. Player beams do not
     travel: their full resolved ray appears on the discharge frame. */
  const ENERGY_TRACER_SPEED = 520;
  const TRACER_TAIL = 1.15;
  const HOSTILE_TRACER_TAIL = 7.5;
  /* One distinct streak per 9Hz shot: long enough for three 60Hz frames,
     short enough to be gone well before the next discharge. */
  const RELIQUARY_FADE_TIME = 0.058;
  const HOSTILE_FADE_TIME = 0.050;
  /* Half-width in world metres. The old 0.42m base plus a separate head
     card made a comet-sized orb; this yields a tight white core inside
     a thin gold bloom, like the cover-art streak. */
  const RELIQUARY_BOLT_WIDTH = 0.075;
  const tracers = (() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(TRACER_MAX * 4 * 3);
    const dirs = new Float32Array(TRACER_MAX * 4 * 3);
    const span = new Float32Array(TRACER_MAX * 4);
    const birth = new Float32Array(TRACER_MAX * 4).fill(-999);
    const width = new Float32Array(TRACER_MAX * 4);
    const style = new Float32Array(TRACER_MAX * 4);
    const speed = new Float32Array(TRACER_MAX * 4).fill(TRACER_SPEED);
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
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    geo.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
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
        /* The Apostate's stolen lance keeps hostile travel/readability but
           replaces forge-orange plasma with the Bloom's cyan-violet organs. */
        uBloomCore: { value: new THREE.Color("#efffff") },
        uBloomBody: { value: new THREE.Color("#42e6df") },
        uBloomFringe: { value: new THREE.Color("#9558d8") },
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
        "attribute float aSpeed;",
        "attribute vec2 aCorner;",
        "uniform float uTime;",
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
        "  float travelSpeed = aSpeed;",
        "  float travelled = age * travelSpeed;",
        "  float energyStyle = 1.0 - step(0.5, abs(aStyle - 1.0));",
        "  float tailLength = mix(uHostileTail, uTail, energyStyle);",
        "  float fadeTime = mix(uHostileFade, uEnergyFade, energyStyle);",
        // The head stops at the range the ray reached; the tail keeps
        // running, so the bolt is swallowed by whatever it hit rather
        // than winking out in mid air.
        "  float movingHead = min(travelled, aSpan);",
        // The head stops at impact, but the tail continues forward and
        // collapses into it. Basing this on `head` froze the last 3m.
        "  float movingTail = clamp(travelled - tailLength, 0.0, aSpan);",
        // Hostile fire travels. The player's hitscan laser presents its
        // entire authoritative ray for one short discharge.
        "  float head = mix(movingHead, aSpan, energyStyle);",
        "  float tail = mix(movingTail, 0.0, energyStyle);",
        "  float impactAge = max(age - aSpan / travelSpeed, 0.0);",
        "  float hostileLife = 1.0 - clamp(impactAge / fadeTime, 0.0, 1.0);",
        "  float beamLife = 1.0 - clamp(age / uEnergyFade, 0.0, 1.0);",
        "  vLife = mix(hostileLife, beamLife, energyStyle);",
        "  if (age < 0.0 || vLife <= 0.0) {",
        "    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
        "    vAlong = 0.0; vAcross = 0.0; vSeed = 0.0;",
        "    vStyle = 0.0; vAge = 0.0;",
        "    return;",
        "  }",
        "  float alongDistance = mix(tail, head, aCorner.x);",
        "  vec3 p = position + aDir * alongDistance;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        /* No screen-space bow. The streak is the actual straight ray
           from the final posed needle tip to the resolved hit point. */
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
        // Hostile fire keeps its teardrop; the player beam is a narrow,
        // parallel-sided laser with a white core and gold sheath.
        "  float hostileShape = 0.16 + 1.35 * pow(aCorner.x, 1.6);",
        "  float energyShape = 1.0;",
        "  float w = aWidth * mix(hostileShape, energyShape, energyStyle)",
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
        "uniform vec3 uBloomCore;",
        "uniform vec3 uBloomBody;",
        "uniform vec3 uBloomFringe;",
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
        "  float energyStyle = 1.0 - step(0.5, abs(vStyle - 1.0));",
        "  float bloomStyle = step(1.5, vStyle);",
        "  vec3 hostileColour = mix(uCold, uHot, core);",
        "  vec3 bloomColour = mix(uBloomFringe, uBloomBody, pow(across, 0.55));",
        "  bloomColour = mix(bloomColour, uBloomCore, pow(across, 4.0) * 0.95);",
        "  hostileColour = mix(hostileColour, bloomColour, bloomStyle);",
        /* Singular cover-art laser: constant light from the lance tip,
           tight ivory core, saturated gold halo, and no head bead or
           longitudinal particle-like modulation. */
        "  float energyCore = pow(across, 7.5);",
        "  float energyHalo = pow(across, 1.8);",
        "  float energyBody = (energyCore * 1.05 + energyHalo * 0.44) * cap;",
        "  vec3 energyColour = mix(uEnergyFringe, uEnergyBody, pow(across, 0.55));",
        "  energyColour = mix(energyColour, uEnergyCore, pow(across, 4.0) * 0.95);",
        "  float body = mix(hostileBody, energyBody, energyStyle);",
        "  vec3 c = mix(hostileColour, energyColour, energyStyle);",
        "  float gain = mix(4.6, 8.4, energyStyle);",
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
       bolt a discrete charge at the leading edge. They share all seven
       live attributes with the ribbon, so the extra draw call adds no
       second per-shot upload and never allocates during a firefight. */
    const headGeo = new THREE.BufferGeometry();
    for (const name of ["position", "aDir", "aSpan", "aBirth", "aWidth", "aStyle", "aSpeed"]) {
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
        uEnergyFade: { value: RELIQUARY_FADE_TIME },
        uHostileFade: { value: HOSTILE_FADE_TIME },
        uHot: mat.uniforms.uHot,
        uCold: mat.uniforms.uCold,
        uEnergyCore: mat.uniforms.uEnergyCore,
        uEnergyBody: mat.uniforms.uEnergyBody,
        uEnergyFringe: mat.uniforms.uEnergyFringe,
        uBloomCore: mat.uniforms.uBloomCore,
        uBloomBody: mat.uniforms.uBloomBody,
        uBloomFringe: mat.uniforms.uBloomFringe,
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
        "attribute float aSpeed;",
        "attribute vec2 aCorner;",
        "uniform float uTime;",
        "uniform float uEnergyFade;",
        "uniform float uHostileFade;",
        "varying vec2 vUv;",
        "varying float vLife;",
        "varying float vStyle;",
        "varying float vPulse;",
        "void main() {",
        "  float age = uTime - aBirth;",
        "  float travelSpeed = aSpeed;",
        "  float travelled = age * travelSpeed;",
        "  float head = min(travelled, aSpan);",
        "  float energyStyle = 1.0 - step(0.5, abs(aStyle - 1.0));",
        "  float fadeTime = mix(uHostileFade, uEnergyFade, energyStyle);",
        "  float impactAge = max(age - aSpan / travelSpeed, 0.0);",
        "  vLife = 1.0 - clamp(impactAge / fadeTime, 0.0, 1.0);",
        "  vUv = aCorner;",
        "  vStyle = aStyle;",
        "  float seed = fract(aBirth * 13.71);",
        "  vPulse = mix(0.90 + 0.10 * sin(age * 78.0 + seed * 6.2831), 1.0, energyStyle);",
        // Player fire is one streak, not a streak plus a second orb.
        "  if (age < 0.0 || vLife <= 0.0 || energyStyle > 0.5) {",
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
        "  mv.x += muzzleSide * 0.40 * silhouetteArc * energyStyle;",
        "  float radius = aWidth * mix(0.75, 0.42, energyStyle) * vPulse;",
        // Keep distant player charges readable without inflating hostile
        // fire or making the close profile orb any larger.
        "  radius = max(radius, -mv.z * 0.0042 * energyStyle);",
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
        "uniform vec3 uBloomCore;",
        "uniform vec3 uBloomBody;",
        "uniform vec3 uBloomFringe;",
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
        "  float energyStyle = 1.0 - step(0.5, abs(vStyle - 1.0));",
        "  float bloomStyle = step(1.5, vStyle);",
        "  vec3 hostileColour = mix(uCold, uHot, core);",
        "  vec3 bloomColour = mix(uBloomFringe, uBloomBody,",
        "    pow(clamp(1.0 - r, 0.0, 1.0), 0.55));",
        "  bloomColour = mix(bloomColour, uBloomCore, core);",
        "  hostileColour = mix(hostileColour, bloomColour, bloomStyle);",
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
        "  float body = mix(hostileBody, energyBody, energyStyle);",
        "  vec3 c = mix(hostileColour, energyColour, energyStyle);",
        "  float gain = mix(3.8, 9.5, energyStyle);",
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
    function emit(x, y, z, dx, dy, dz, distance, w, styleVal, speedVal) {
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
        speed[v] = speedVal;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aDir.needsUpdate = true;
      geo.attributes.aSpan.needsUpdate = true;
      geo.attributes.aBirth.needsUpdate = true;
      geo.attributes.aWidth.needsUpdate = true;
      geo.attributes.aStyle.needsUpdate = true;
      geo.attributes.aSpeed.needsUpdate = true;
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
        uVenomHot: { value: new THREE.Color("#eaff9c") },
        uVenomCold: { value: new THREE.Color("#5b8a12") },
        uDoctrineCenser: { value: new THREE.Color("#ffbd3e") },
        uDoctrineProcession: { value: new THREE.Color("#ff7045") },
        uDoctrineWing: { value: new THREE.Color("#08d4ff") },
        uDoctrineHalo: { value: new THREE.Color("#6684ff") },
        uDoctrineEdict: { value: new THREE.Color("#20e0a6") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      // Additive quads are order-independent. A single double-sided
      // pass avoids paying twice for the whole fixed flash buffer.
      forceSinglePass: true,
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
        "uniform vec3 uVenomHot;",
        "uniform vec3 uVenomCold;",
        "uniform vec3 uDoctrineCenser;",
        "uniform vec3 uDoctrineProcession;",
        "uniform vec3 uDoctrineWing;",
        "uniform vec3 uDoctrineHalo;",
        "uniform vec3 uDoctrineEdict;",
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
        "  float doctrine = step(5.5, vTint);",
        "  float venom = step(3.5, vTint) * (1.0 - doctrine);",
        "  float energy = step(1.5, vTint) * (1.0 - venom) * (1.0 - doctrine);",
        // A brief expanding annulus is the discharge field; ballistic
        // flashes keep the original four-spike star.
        "  float ring = smoothstep(0.26, 0.48, r)",
        "    * (1.0 - smoothstep(0.56, 0.88, r));",
        "  float energyBurst = core * 0.82 + ring * (0.45 + (1.0 - vFade) * 0.55)",
        "    + star * 0.20;",
        "  float doctrineBurst = core * 0.76",
        "    + ring * (0.64 + (1.0 - vFade) * 0.52) + star * 0.26;",
        "  float burst = mix(starBurst, energyBurst, energy);",
        "  burst = mix(burst, doctrineBurst, doctrine);",
        // A venom mouth-flash is a soft glow, not a star: it is light
        // coming out of a throat rather than a discharge.
        "  burst = mix(burst, core * 1.15, venom);",
        "  vec3 flashColour = mix(uCold, uHot, clamp(vTint * (0.35 + vFade), 0.0, 1.0));",
        "  vec3 energyColour = mix(uEnergyCold, uEnergyHot, core);",
        "  vec3 venomColour = mix(uVenomCold, uVenomHot, 0.30 + core * 0.60);",
        "  vec3 doctrineColour = uDoctrineCenser;",
        "  doctrineColour = mix(doctrineColour, uDoctrineProcession, step(6.5, vTint));",
        "  doctrineColour = mix(doctrineColour, uDoctrineWing, step(7.5, vTint));",
        "  doctrineColour = mix(doctrineColour, uDoctrineHalo, step(8.5, vTint));",
        "  doctrineColour = mix(doctrineColour, uDoctrineEdict, step(9.5, vTint));",
        // A coloured core still blooms; pushing it more than halfway
        // to white erased the Order hue and produced hot white orbs.
        "  doctrineColour = mix(doctrineColour, vec3(1.0), core * 0.20);",
        "  vec3 c = mix(mix(flashColour, energyColour, energy), venomColour, venom);",
        "  c = mix(c, doctrineColour, doctrine);",
        "  float a = clamp(burst * vFade, 0.0, 1.0);",
        /* GAIN, NORMALISED BY THE ORDER'S OWN PEAK CHANNEL.
           A flat 3.4x drives a saturated hue past 1.0 one channel at a
           time - the strongest first - so every Order climbed to white
           as it got brighter. Halo is the proof: #6684ff has blue
           already at 1.0, so its flash clipped to blue, then to white,
           and the whole periwinkle Order rendered as the same colourless
           blob as a muzzle flare. Dividing the rite gain by the peak
           channel keeps the ratio between channels intact through the
           tonemapper's shoulder, which is what "keeps its hue" means. */
        "  float peak = max(doctrineColour.r,",
        "    max(doctrineColour.g, doctrineColour.b));",
        "  float gain = burst * vFade * 3.4;",
        "  float riteGain = burst * vFade * 1.95 / max(0.30, peak);",
        "  gain = mix(gain, riteGain, doctrine);",
        "  gl_FragColor = vec4(c * gain, a);",
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

  /** The bolt itself, drawn along the path the authoritative shot takes.
   * `energy` is explicit because hostile return fire shares this pool;
   * travelling projectiles pass their gameplay speed so the visible head
   * and swept collision reach every point on the same frame. */
  function tracer(x, y, z, dx, dy, dz, distance,
    width = RELIQUARY_BOLT_WIDTH, energy = true, travelSpeed = null) {
    if (!(distance > 0) || !Number.isFinite(distance)) return;
    const span = Math.min(distance, 900);
    const style = energy === "bloom" ? 2 : energy ? 1 : 0;
    const playerEnergy = style === 1;
    const speed = Number.isFinite(travelSpeed) && travelSpeed > 0
      ? travelSpeed : playerEnergy ? ENERGY_TRACER_SPEED : TRACER_SPEED;
    tracers.emit(x, y, z, dx, dy, dz, span, width, style, speed);
    /* Hostile plasma keeps a wake so incoming fire can be tracked.
       Player fire is deliberately ONE continuous laser with no motes. */
    if (!playerEnergy) {
      const beads = Math.min(14, Math.max(3, Math.round(span * 0.22)));
      impacts.emitTrail(x, y, z, dx, dy, dz, span, speed, beads, 0.55,
        style === 2 ? 8.0 : 0.85);
    }
  }

  /** The bloom at the muzzle, plus the gases leaving it. */
  function muzzle(x, y, z, dx, dy, dz, scale = 1, energy = false) {
    /* The player already has a flare and point light parented to the
       exact needle-tip emitter. Adding world-space cards and seven
       directed particles here was the white puff in front of the
       character. Keep this pool for hostile weapons only. */
    if (energy) return;
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


  /* ============================================================
     THE GLIDE AND THE FALL

     Both verbs needed geometry rather than motes. A boost is read
     from the SHAPE of what is behind the trooper and a slam from the
     ring that leaves the point of impact; neither survives being
     expressed as a puff of particles, because a puff has no
     direction and no radius.

     Everything here is pooled, additive and unlit, driven off one
     clock, and hidden outright when idle so it costs nothing between
     uses.
     ============================================================ */
  const impulse = (() => {
    const mat = new THREE.MeshBasicMaterial({
      name: "sf-impulse", vertexColors: true, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: true,
    });
    patchBasicMaterial(mat, atmos, 1.0, true);

    const tint = (geo, hot, cold, axis = "y", lo = 0, hi = 1) => {
      const pos = geo.attributes.position;
      const colours = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        const v = axis === "y" ? pos.getY(i) : pos.getZ(i);
        const t = clamp01((v - lo) / Math.max(1e-4, hi - lo));
        const f = 1 - t * t;
        colours[i * 3] = hot[0] * f + cold[0] * (1 - f);
        colours[i * 3 + 1] = hot[1] * f + cold[1] * (1 - f);
        colours[i * 3 + 2] = hot[2] * f + cold[2] * (1 - f);
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      return geo;
    };

    const root = new THREE.Group();
    root.name = "impulse-vfx";
    root.frustumCulled = false;
    group.add(root);

    /* THE ROOT NEVER MOVES. All impulse geometry is world-space.
       Ground-boost propulsion belongs exclusively to the reliquary
       pack, so this rig contains only the Penitent's Fall effects. */

    /* ---- the fall ----
       A column above the trooper while the charge builds, then rings
       and a dome on the ground when it lands. */
    /* A THIN shaft, not a pillar. At the original 1.35m flare over
       nine metres this filled a third of the screen with solid white
       and hid the trooper it was supposed to be charging. */
    const columnGeo = new THREE.CylinderGeometry(0.09, 0.44, 5.4, 14, 1, true);
    columnGeo.translate(0, 2.7, 0);
    tint(columnGeo, [0.50, 0.42, 0.22], [0.02, 0.01, 0.0], "y", 0, 5.4);
    const column = new THREE.Mesh(columnGeo, mat);
    column.name = "slam-column";
    column.visible = false;
    root.add(column);

    const spikeGeo = new THREE.ConeGeometry(0.30, 2.6, 10, 1, true);
    spikeGeo.rotateX(Math.PI);
    spikeGeo.translate(0, -1.3, 0);
    tint(spikeGeo, [0.80, 0.66, 0.34], [0.02, 0.01, 0.0], "y", -2.6, 0);
    const spike = new THREE.Mesh(spikeGeo, mat);
    spike.name = "slam-spike";
    spike.visible = false;
    root.add(spike);

    const rings = [];
    for (let i = 0; i < 3; i += 1) {
      const g = new THREE.TorusGeometry(1, 0.05 + i * 0.02, 5, 60);
      g.rotateX(Math.PI / 2);
      tint(g, [1.0, 0.86, 0.46], [0.92, 0.44, 0.10], "y", -0.1, 0.1);
      const ring = new THREE.Mesh(g, mat);
      ring.name = `slam-ring-${i}`;
      ring.visible = false;
      ring.renderOrder = 6;
      rings.push(ring);
      root.add(ring);
    }
    const domeGeo = new THREE.SphereGeometry(1, 22, 8, 0, TAU, 0, Math.PI * 0.5);
    tint(domeGeo, [0.86, 0.68, 0.32], [0.03, 0.01, 0.0], "y", 0, 1);
    const dome = new THREE.Mesh(domeGeo, mat);
    dome.name = "slam-dome";
    dome.visible = false;
    root.add(dome);

    const live = {
      charge: 0, chargeSeen: 0,
      burst: -1, burstRadius: 8, burstX: 0, burstY: 0, burstZ: 0,
    };
    return { root, mat, column, spike, rings, dome, live };
  })();

  /** Something was rammed. */
  function boostImpact(x, y, z, dx, dz, heavy) {
    flashes.emit(x, y, z, heavy ? 1.5 : 1.15, 0.11, 2.0);
    impacts.emitDirected(x, y, z, heavy ? 30 : 22, dx, 0.55, dz,
      heavy ? 11 : 9, heavy ? 1.5 : 1.2, 2.0);
    impacts.emit(x, y, z, 14, 3.0, 1.1, 0.5);
  }

  /** The hang, with the charge building overhead. */
  function slamCharge(x, y, z, charge) {
    const L = impulse.live;
    L.charge = 0.1;
    L.chargeSeen = clamp01(charge);
    /* Based at the SHOULDERS, not the waist. Rooted lower, the hot end
       of the shaft sat over the breastplate and erased the one
       silhouette the wind-up exists to show. */
    impulse.column.position.set(x, y + 1.45, z);
    impulse.spike.position.set(x, y + 0.32, z);
    if (charge > 0.05 && Math.random() < 0.6) {
      const a = Math.random() * TAU;
      const r = 2.6 * (1 - charge) + 0.4;
      impacts.emitDirected(x + Math.cos(a) * r, y + 0.2 + Math.random() * 2.4,
        z + Math.sin(a) * r, 1, -Math.cos(a), 0.9, -Math.sin(a), 5.5, 0.55, 2.0);
    }
  }

  /** The descent streak. */
  function slamTrail(x, y, z) {
    impulse.live.charge = 0.1;
    impulse.live.chargeSeen = 1;
    impulse.column.position.set(x, y + 1.45, z);
    impulse.spike.position.set(x, y + 0.32, z);
    impacts.emitDirected(x, y + 1.2, z, 2, 0, 1, 0, 7.5, 0.6, 2.0);
  }

  /** Landfall. */
  function slamImpact(x, y, z, radius = 8, hits = 0) {
    const L = impulse.live;
    L.burst = 0;
    L.burstRadius = radius;
    L.burstX = x;
    L.burstY = y;
    L.burstZ = z;
    L.charge = 0;
    flashes.emit(x, y + 0.6, z, 2.6, 0.16, 2.0);
    flashes.emit(x, y + 1.6, z, 1.6, 0.22, 1.0);
    impacts.emit(x, y + 0.35, z, 70, radius * 0.34, 3.2, 0.9);
    // A skirt of debris thrown outward along the ground.
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * TAU + Math.random() * 0.2;
      impacts.emitDirected(x + Math.cos(a) * 0.8, y + 0.22, z + Math.sin(a) * 0.8,
        4, Math.cos(a), 0.42, Math.sin(a), 15 + Math.random() * 7, 1.5, 0.55);
    }
    if (hits > 0) flashes.emit(x, y + 0.9, z, 1.9, 0.13, 2.0);
  }

  /** Drives both rigs. Called once a frame from `update`. */
  function updateImpulse(dt) {
    const L = impulse.live;
    const chargeOn = L.charge > 0;
    L.charge = Math.max(0, L.charge - dt);
    const showCharge = chargeOn && L.charge > 0;
    if (impulse.column.visible !== showCharge) {
      impulse.column.visible = showCharge;
      impulse.spike.visible = showCharge;
    }
    if (showCharge) {
      const c = L.chargeSeen;
      impulse.column.scale.set(0.45 + c * 0.75, 0.30 + c * 1.05, 0.45 + c * 0.75);
      impulse.column.rotation.y += dt * 5.5;
      impulse.spike.scale.set(0.5 + c * 0.8, 0.35 + c * 1.3, 0.5 + c * 0.8);
    }

    if (L.burst >= 0) {
      L.burst += dt;
      const life = 0.9;
      const p = clamp01(L.burst / life);
      const alive = p < 1;
      impulse.rings.forEach((ring, i) => {
        const rp = clamp01((L.burst - i * 0.06) / (life * (0.7 + i * 0.22)));
        const on = rp > 0 && rp < 1;
        if (ring.visible !== on) ring.visible = on;
        if (!on) return;
        ring.position.set(L.burstX, L.burstY + 0.18 + i * 0.06, L.burstZ);
        /* Eased OUT, so the ring leaves fast and then coasts. A linear
           expansion reads as a growing circle rather than as something
           that was thrown. */
        const e = 1 - (1 - rp) * (1 - rp);
        ring.scale.setScalar(0.6 + e * L.burstRadius * (1 + i * 0.16));
      });
      const domeOn = p < 0.62;
      if (impulse.dome.visible !== domeOn) impulse.dome.visible = domeOn;
      if (domeOn) {
        const dp = clamp01(p / 0.62);
        impulse.dome.position.set(L.burstX, L.burstY + 0.05, L.burstZ);
        impulse.dome.scale.set(
          0.5 + dp * L.burstRadius * 0.85,
          0.4 + dp * L.burstRadius * 0.42,
          0.5 + dp * L.burstRadius * 0.85);
      }
      if (!alive) {
        L.burst = -1;
        for (const ring of impulse.rings) ring.visible = false;
        impulse.dome.visible = false;
      }
    }
    /* ONE opacity for the whole rig, so a glide that ends mid-slam
       cannot leave the dome at a brightness the glide chose. */
    impulse.mat.opacity = 1;
  }

  /* ============================================================
     ORDNANCE

     What a command actually looks like when it arrives.

     All three used to resolve to `blast()` - a hundred motes and a
     bang - which meant the orbital lance, the cluster salvo and the
     supply drop were the SAME EVENT with different cooldowns. A
     stratagem is the loudest thing the player owns and the payoff for
     a code entered under pressure; it has to be worth the four seconds
     of standing still.

     Every piece here is pooled geometry rather than particles, for the
     reason the glide and the fall already established: a puff has no
     radius and no direction, and both of those are the whole point of
     an area weapon. Particles are still used, but as the DEBRIS on top
     of a shape rather than as the shape.

     One geometry per primitive, greyscale gradients baked into the
     vertices, and the colour set per use from the material - so a beam
     is a beam whether it is the lance's cyan or the rite's gold, and
     the whole rig is four geometries.
     ============================================================ */
  const SCORCH_RINGS_N = 3;
  const SCORCH_SIDES_N = 26;

  const ordnance = (() => {
    const root = new THREE.Group();
    root.name = "ordnance-vfx";
    root.frustumCulled = false;
    group.add(root);

    /* A greyscale ramp along one axis, multiplied by the material's own
       colour at spawn. Baking the colour in would need one geometry per
       stratagem; baking the GRADIENT costs nothing and leaves the hue
       free. */
    const ramp = (geo, axis = "y", lo = 0, hi = 1, floor = 0.04) => {
      const pos = geo.attributes.position;
      const colours = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        const v = axis === "y" ? pos.getY(i) : pos.getZ(i);
        const t = clamp01((v - lo) / Math.max(1e-4, hi - lo));
        const f = floor + (1 - floor) * (1 - t * t);
        colours[i * 3] = f;
        colours[i * 3 + 1] = f;
        colours[i * 3 + 2] = f;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      return geo;
    };

    /* Per-mesh materials, because these fade INDEPENDENTLY - a salvo
       lands eleven times over a second and every pop is at its own
       opacity. They all share one program: `patchBasicMaterial` keys
       its cache on the fade and blend mode, which are identical. */
    const additive = () => {
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, toneMapped: true,
      });
      // Back/front ordering is irrelevant under additive blending.
      // Three's default two-pass transparent DoubleSide path otherwise
      // doubles every active ring, dome and beam render call.
      mat.forceSinglePass = true;
      mat.name = "sf-ordnance";
      patchBasicMaterial(mat, atmos, 1.0, true);
      return mat;
    };

    // A beam from orbit: open cylinder, hot at the base, unit height.
    const beamGeo = new THREE.CylinderGeometry(0.62, 1, 1, 18, 1, true);
    beamGeo.translate(0, 0.5, 0);
    ramp(beamGeo, "y", 0, 1, 0.02);
    // A flat pressure ring, unit radius.
    const ringGeo = new THREE.TorusGeometry(1, 0.030, 6, 64);
    ringGeo.rotateX(Math.PI / 2);
    ramp(ringGeo, "y", -0.06, 0.06, 0.35);
    // The dust hemisphere the ring leaves behind it.
    const domeGeo = new THREE.SphereGeometry(1, 24, 10, 0, TAU, 0, Math.PI * 0.5);
    ramp(domeGeo, "y", 0, 1, 0.05);

    const make = (geo, count, order) => {
      const out = [];
      for (let i = 0; i < count; i += 1) {
        const mesh = new THREE.Mesh(geo, additive());
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = order;
        root.add(mesh);
        out.push({ mesh, life: 0, span: 1, kind: null });
      }
      return out;
    };

    /* THE SCORCH is the only part that is not additive, and it has to
       be: what a lance leaves is a hole that is DARKER than the sand,
       and additive blending cannot subtract. The Glass Scar in the
       north-east is what a big one looks like a century later. */
    const scorches = [];
    for (let i = 0; i < 5; i += 1) {
      const geo = new THREE.BufferGeometry();
      const verts = 1 + SCORCH_RINGS_N * SCORCH_SIDES_N;
      const position = new Float32Array(verts * 3);
      /* FOUR components, not three. This is the one surface here that
         is not additive, and on a normally-blended material a vertex
         colour of zero is BLACK rather than absent - so a ramp that was
         meant to fade the mark out at its rim was painting the rim the
         darkest part of it, which is exactly backwards and reads as a
         drawn ring. Three.js switches to vColor.a the moment the
         attribute has four components, so the falloff belongs there. */
      const colour = new Float32Array(verts * 4);
      const index = [];
      for (let s = 0; s < SCORCH_SIDES_N; s += 1) {
        const n = (s + 1) % SCORCH_SIDES_N;
        index.push(0, 1 + s, 1 + n);
        for (let r = 0; r < SCORCH_RINGS_N - 1; r += 1) {
          const a0 = 1 + r * SCORCH_SIDES_N + s;
          const a1 = 1 + r * SCORCH_SIDES_N + n;
          const b0 = 1 + (r + 1) * SCORCH_SIDES_N + s;
          const b1 = 1 + (r + 1) * SCORCH_SIDES_N + n;
          index.push(a0, b0, b1, a0, b1, a1);
        }
      }
      // Opaque in the middle, gone at the rim, so it has no edge.
      colour[0] = colour[1] = colour[2] = colour[3] = 1;
      for (let r = 0; r < SCORCH_RINGS_N; r += 1) {
        const f = (1 - (r + 1) / SCORCH_RINGS_N) ** 0.8;
        for (let s = 0; s < SCORCH_SIDES_N; s += 1) {
          const k = (1 + r * SCORCH_SIDES_N + s) * 4;
          colour[k] = 1; colour[k + 1] = 1; colour[k + 2] = 1;
          colour[k + 3] = f;
        }
      }
      geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
      geo.setIndex(index);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color("#140a06"),
        vertexColors: true, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
      });
      mat.name = "sf-scorch";
      patchBasicMaterial(mat, atmos, 0.5, false);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 4;
      root.add(mesh);
      scorches.push({ mesh, position, life: 0, span: 1 });
    }

    return {
      root,
      beams: make(beamGeo, 3, 8),
      /* Twelve was not enough once the Orders started tolling. A
         capstone alone spends five, a salvo spends eleven over a
         second, and `takeFx` recycles the stalest LIVE slot when the
         pool is dry - so a rite fired during a breach wave had its
         rings pulled out from under it mid-flight and popped. These
         are 64-segment tori with a shared geometry; the cost of the
         extra dozen is a dozen matrix updates. */
      rings: make(ringGeo, 24, 7),
      domes: make(domeGeo, 4, 6),
      scorches,
      // Deferred work: a salvo is eleven detonations spread over a
      // second, and a lance is four beats over half of one.
      queue: [],
    };
  })();

  /** Oldest-first recycling, exactly like the impact pool: dropping the
   *  stalest effect is invisible, and growing mid-strike is not. */
  function takeFx(pool) {
    let best = pool[0];
    for (const slot of pool) {
      if (slot.life <= 0) return slot;
      if (slot.life / slot.span < best.life / best.span) best = slot;
    }
    return best;
  }

  /** Run `fn` in `seconds`. Driven off the same clock as everything
   *  else here, so a paused frame does not fire a salvo early. */
  function later(seconds, fn) {
    ordnance.queue.push({ at: atmos.elapsed + Math.max(0, seconds), fn });
  }

  function beamFx(x, y, z, radius, height, seconds, colour) {
    const slot = takeFx(ordnance.beams);
    slot.life = seconds;
    slot.span = seconds;
    slot.radius = radius;
    slot.height = height;
    slot.mesh.position.set(x, y, z);
    slot.mesh.material.color.set(colour);
    slot.mesh.visible = true;
    return slot;
  }

  function ringFx(x, y, z, from, to, seconds, colour, thickness = 1) {
    const slot = takeFx(ordnance.rings);
    slot.life = seconds;
    slot.span = seconds;
    slot.from = from;
    slot.to = to;
    slot.thickness = thickness;
    slot.rise = 0;
    slot.mesh.position.set(x, y, z);
    // Wing cues borrow this ring as a vertical loop. Every ordinary
    // spawn resets it so a recycled loop can never tip a later
    // pressure wave onto its side.
    slot.mesh.rotation.set(0, 0, 0);
    slot.mesh.material.color.set(colour);
    slot.mesh.visible = true;
    return slot;
  }

  /**
   * A ring that stands in the AIR around the trooper, tilted off the
   * horizontal and climbing as it opens.
   *
   * This is the fix for the single largest readability problem the
   * Orders had. The chase camera sits about seven metres back and
   * barely two above the sand, pitched down by three or four degrees -
   * so the ground plane is very nearly edge on, and every flat ring in
   * the tree was being foreshortened into a hairline ellipse the eye
   * skims over. Tilting the loop twenty-odd degrees and lifting it to
   * chest height puts the whole circle inside the part of the frame
   * this camera actually looks at, and it costs the same one torus.
   */
  function gyreFx(x, y, z, from, to, seconds, colour, thickness = 1,
    tilt = 0.38, rise = 1.1, spin = 0) {
    const slot = ringFx(x, y, z, from, to, seconds, colour, thickness);
    slot.rise = rise;
    slot.mesh.rotation.set(tilt, spin, tilt * 0.42);
    return slot;
  }

  function domeFx(x, y, z, radius, seconds, colour) {
    const slot = takeFx(ordnance.domes);
    slot.life = seconds;
    slot.span = seconds;
    slot.radius = radius;
    slot.mesh.position.set(x, y, z);
    slot.mesh.material.color.set(colour);
    slot.mesh.visible = true;
    return slot;
  }

  /* ==================================================================
     RITE PRIMITIVES

     The Orders had exactly three shapes between them - a flat torus, a
     dust hemisphere and an open cylinder - and every one of the
     twenty-five talents was a permutation of their radii. Two problems
     followed from that, and neither was fixable by tuning numbers:

       - the cylinder has no radial term at all, so a "beam of light"
         rendered as an opaque hard-edged rectangle standing in the
         sand. Flat colour, flat silhouette, no volume;
       - the hemisphere peaks at 0.15 alpha because it was authored as
         the DUST a blast lifts. Reused as a shield it is a surface
         that is not there, which is the one thing a shield may not be.

     These three replace them. Each is a real surface with a
     view-dependent term, so it turns as the camera moves and can be
     told apart from a decal. They share the pooling, the oldest-first
     recycling and the additive fade of everything above; what they add
     is a fragment shader that knows what it is drawing.
     ================================================================== */
  const RITE_VERT = /* glsl */`
    varying vec2 vUv;
    varying vec3 vNrm;
    varying vec3 vView;
    varying vec3 vLocal;
    void main() {
      vUv = uv;
      vLocal = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // View vector in view space; the camera sits at the origin there,
      // so the direction to it is simply the negated position.
      vView = -mv.xyz;
      vNrm = normalMatrix * normal;
      gl_Position = projectionMatrix * mv;
    }
  `;

  /* A hollow cylinder crossed by the eye is thickest through its
     middle and vanishes at its silhouette - the chord length through a
     circle. `nv` IS that chord, normalised, which is the whole reason
     this reads as a column of lit air rather than as a green plank. */
  const SHAFT_FRAG = /* glsl */`
    uniform vec3 uColour;
    uniform vec3 uAccent;
    uniform float uTime;
    uniform float uSeed;
    uniform float uGain;
    varying vec2 vUv;
    varying vec3 vNrm;
    varying vec3 vView;
    varying vec3 vLocal;
    void main() {
      float nv = abs(dot(normalize(vNrm), normalize(vView)));
      float body = nv * nv * 0.65 + nv * 0.35;
      float rim = pow(1.0 - nv, 5.0) * 0.42;
      float h = clamp(vUv.y, 0.0, 1.0);
      /* Hot at the mouth and always soft at the top. The old column was
         cut off flat by the frustum because nothing faded it out, so it
         looked like a texture that had run out rather than like light
         that had thinned. */
      /* Steep. Additive light over this game's bright daylight sky
         clips to a pale pink almost immediately - a column that is
         still at two-thirds strength a third of the way up stops
         being vermilion, or gold, or emerald, and becomes the same
         white smear whatever Order fired it. Keeping the energy in
         the bottom few metres is what preserves the hue where the
         column is actually read, against the sand. */
      float vert = pow(1.0 - h, 2.35) * smoothstep(1.0, 0.42, h);
      float flow = 0.80 + 0.20 * sin(h * 22.0 - uTime * 5.5 + uSeed * 6.2831);
      float fine = 0.88 + 0.12 * sin(h * 71.0 + uTime * 2.1 - uSeed * 3.3);
      float flick = 0.92 + 0.08 * sin(uTime * 37.0 + uSeed * 11.0);
      vec3 c = mix(uColour, uAccent, pow(1.0 - h, 2.4));
      float a = (body + rim) * vert * flow * fine * flick * uGain;
      gl_FragColor = vec4(c * a, 1.0);
    }
  `;

  /* A shield is read from its RIM and from the lattice that catches the
     light across it, not from a wash of colour over the middle. Both
     terms here are view-dependent, so the shell turns with the camera
     and cannot be mistaken for a sprite. */
  const SHELL_FRAG = /* glsl */`
    uniform vec3 uColour;
    uniform vec3 uAccent;
    uniform float uTime;
    uniform float uSeed;
    uniform float uGain;
    uniform float uWave;
    varying vec3 vNrm;
    varying vec3 vView;
    varying vec3 vLocal;
    void main() {
      float nv = abs(dot(normalize(vNrm), normalize(vView)));
      float fres = pow(1.0 - nv, 2.8);
      vec3 p = normalize(vLocal + vec3(0.0, 1e-5, 0.0));
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float lon = atan(p.z, p.x);
      // Hexagonal cells. A lat/long grid reads as a globe; a hex weave
      // reads as something built to stop an impact.
      /* Finer and thinner than the first pass. Big cells with soft
         borders read as camouflage blotches painted on a bubble; a
         shield wants a tight weave whose LINES catch the light and
         whose interiors stay dark. */
      vec2 hp = vec2(lon * 8.5 + uTime * 0.10, lat * 10.5);
      vec2 hx = vec2(hp.x * 1.1547, hp.y + hp.x * 0.5773);
      vec2 hf = fract(hx) - 0.5;
      float hd = max(abs(hf.x), max(abs(hf.y), abs(hf.x + hf.y)));
      float cells = smoothstep(0.40, 0.50, hd);
      /* THE POLE. Longitude is undefined on the axis, so every cell
         boundary in the weave converges there and the apex rendered as
         a drawn sunburst - the one place on the shell that announced it
         was made of a lat/long parameterisation. The weave is simply
         faded out before it reaches the singularity; the fresnel and
         the forming band carry the apex on their own. */
      cells *= 1.0 - smoothstep(0.72, 0.985, p.y);
      // One band of light climbing the shell as it forms, so the dome
      // is something that CLOSES rather than something that appears.
      float band = 1.0 - smoothstep(0.0, 0.16, abs(p.y - uWave));
      // Where the shell meets the sand it is brightest: that contact
      // line is what tells the eye the dome has a floor.
      float foot = pow(1.0 - clamp(p.y, 0.0, 1.0), 7.0);
      /* The rim is most of what the eye gets of a dome, so pushing it
         all the way to the pale accent bleached the whole shell - the
         Halo's periwinkle came out as frosted glass. The accent is now
         a highlight on the forming band only, and the level is
         normalised by the peak channel so a bright shell saturates
         toward its OWN colour instead of toward white. */
      vec3 c = mix(uColour, uAccent, clamp(fres * 0.30 + band * 0.55, 0.0, 1.0));
      float peak = max(c.r, max(c.g, c.b));
      float a = (fres * 0.52 + cells * fres * 0.92 + cells * 0.05
        + band * 0.48 + foot * 0.34) * uGain / max(0.55, peak);
      gl_FragColor = vec4(c * a, 1.0);
    }
  `;

  /* A seal, drawn rather than stamped. The wipe writes it around the
     circle over the first third of its life, which is the single
     cheapest way to make a static symbol feel authored in the moment
     instead of pasted onto the ground. */
  const SIGIL_FRAG = /* glsl */`
    uniform vec3 uColour;
    uniform vec3 uAccent;
    uniform float uTime;
    uniform float uSeed;
    uniform float uGain;
    uniform float uWipe;
    uniform float uFolds;
    uniform float uSpin;
    varying vec2 vUv;
    float band(float x, float at, float w) {
      return 1.0 - smoothstep(0.0, w, abs(x - at));
    }
    void main() {
      vec2 q = vUv * 2.0 - 1.0;
      float r = length(q);
      if (r > 1.0) discard;
      float a = atan(q.y, q.x);
      float spun = a + uTime * uSpin;
      /* BOLD, because this is the one element of a rite that lies in
         the ground plane. The chase camera is pitched down three or
         four degrees, so a seal is always seen at a grazing angle -
         and at a grazing angle a hairline is sampled at less than one
         pixel and averages to nothing. Every band here is wide enough
         to survive that, and the seal carries a filled glow underneath
         the linework so it still reads as a mark even when the lines
         themselves are compressed to a few rows of pixels. */
      float rings = band(r, 0.965, 0.034) * 1.55
        + band(r, 0.880, 0.020) * 0.80
        + band(r, 0.560, 0.026) * 1.15
        + band(r, 0.300, 0.018) * 0.62;
      // Spokes between the two inner rings, and ticks around the rim.
      float spokes = pow(abs(cos(spun * uFolds * 0.5)), 18.0)
        * step(0.300, r) * (1.0 - step(0.560, r)) * 1.25;
      float ticks = pow(abs(cos(spun * uFolds)), 24.0)
        * band(r, 0.922, 0.052) * 1.2;
      float chords = pow(abs(cos(spun * uFolds * 0.5 + 1.5707)), 48.0)
        * step(0.560, r) * (1.0 - step(0.880, r)) * 0.9;
      // A soft floor under the linework, brightest at the middle and
      // gone by the rim, so the seal has a body as well as an outline.
      float fill = (1.0 - smoothstep(0.0, 0.94, r)) * 0.34
        + (1.0 - smoothstep(0.0, 0.30, r)) * 0.40;
      /* The wipe. uWipe sweeps 0..1; everything behind the sweep is
         lit, and the sweep itself carries a hot leading edge so the eye
         has something to follow around the rim. */
      float turn = fract((a + 3.14159265) / 6.28318530);
      float shown = step(turn, uWipe);
      float edge = (1.0 - smoothstep(0.0, 0.045, abs(turn - uWipe)))
        * step(uWipe, 0.999) * 1.6;
      float ink = (rings + spokes + ticks + chords) * shown + fill * shown;
      float lum = (ink + edge * (rings + 0.45)) * uGain * 1.45;
      vec3 c = mix(uColour, uAccent, clamp(ink * 0.5 + edge, 0.0, 1.0));
      // Same rule as the shell and the motes: normalise by the peak
      // channel so a bright seal saturates toward its Order's hue.
      float peak = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(c * lum / max(0.55, peak), 1.0);
    }
  `;

  const rites = (() => {
    const root = new THREE.Group();
    root.name = "rite-vfx";
    root.frustumCulled = false;
    group.add(root);

    /* Per-mesh materials for the same reason the ordnance pool keeps
       them: two rites overlap constantly and each is at its own point
       in its own envelope. `customProgramCacheKey` is constant per
       family, so all of them still share three programs. */
    const makeMat = (frag, extra = {}) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColour: { value: new THREE.Color("#ffffff") },
          uAccent: { value: new THREE.Color("#ffffff") },
          uTime: { value: 0 },
          uSeed: { value: 0 },
          uGain: { value: 0 },
          ...extra,
        },
        vertexShader: RITE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        // Additive is order-independent, so the default two-pass
        // double-sided path would only double the draw calls.
        forceSinglePass: true,
        toneMapped: true,
      });
      return mat;
    };

    // Unit column, base at the origin, opening very slightly upward.
    const shaftGeo = new THREE.CylinderGeometry(1.18, 1, 1, 26, 1, true);
    shaftGeo.translate(0, 0.5, 0);
    const shellGeo = new THREE.SphereGeometry(1, 44, 22, 0, TAU, 0, Math.PI * 0.5);
    const sigilGeo = new THREE.CircleGeometry(1, 72);
    sigilGeo.rotateX(-Math.PI / 2);

    /* `own` clones the geometry per slot. The sigils need it because
       each one is bent onto the sand underneath ITS OWN centre, and a
       shared buffer would have six seals fighting over one set of
       vertices. The shaft and the shell are rigid and share theirs. */
    const build = (geo, frag, count, order, extra, own = false) => {
      const out = [];
      for (let i = 0; i < count; i += 1) {
        const mesh = new THREE.Mesh(own ? geo.clone() : geo, makeMat(frag, extra));
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = order;
        root.add(mesh);
        out.push({ mesh, life: 0, span: 1, radius: 1, height: 1, kind: null });
      }
      return out;
    };

    return {
      root,
      shafts: build(shaftGeo, SHAFT_FRAG, 4, 9),
      shells: build(shellGeo, SHELL_FRAG, 4, 8, { uWave: { value: 0 } }),
      sigils: build(sigilGeo, SIGIL_FRAG, 6, 5,
        { uWipe: { value: 1 }, uFolds: { value: 6 }, uSpin: { value: 0.25 } },
        true),
    };
  })();

  /**
   * A column of lit air. `hold` is the fraction of the life spent at
   * full height before the collapse, which is what separates a beacon
   * that STANDS from a flash that happens to be tall.
   */
  function shaftFx(x, y, z, radius, height, seconds, colour, accent,
    gain = 1, hold = 0.34) {
    const slot = takeFx(rites.shafts);
    slot.life = seconds;
    slot.span = seconds;
    slot.radius = radius;
    slot.height = height;
    slot.gain = gain;
    slot.hold = clamp01(hold);
    slot.mesh.position.set(x, y, z);
    slot.mesh.material.uniforms.uColour.value.set(colour);
    slot.mesh.material.uniforms.uAccent.value.set(accent);
    slot.mesh.material.uniforms.uSeed.value = Math.random();
    slot.mesh.visible = true;
    return slot;
  }

  /** A shield shell that closes, holds, and breaks. */
  function shellFx(x, y, z, radius, seconds, colour, accent, gain = 1) {
    const slot = takeFx(rites.shells);
    slot.life = seconds;
    slot.span = seconds;
    /* CAPPED, because the chase camera sits about seven metres back.
       A shell authored at a talent's full gameplay radius put the
       camera INSIDE an additive hemisphere, which is not a shield -
       it is a green filter over the whole frame. The gameplay radius
       stays in the ground ring where it belongs; the shell only ever
       has to say "there is a surface here". */
    slot.radius = Math.min(3.7, radius);
    slot.gain = gain;
    slot.mesh.position.set(x, y, z);
    slot.mesh.material.uniforms.uColour.value.set(colour);
    slot.mesh.material.uniforms.uAccent.value.set(accent);
    slot.mesh.material.uniforms.uSeed.value = Math.random();
    slot.mesh.visible = true;
    return slot;
  }

  /**
   * A seal written on the sand. `folds` is the Order's own radial
   * symmetry - the one piece of iconography that lets a player name a
   * rite from its footprint alone.
   */
  function sigilFx(x, z, radius, seconds, colour, accent, folds = 6,
    spin = 0.22, gain = 1) {
    const slot = takeFx(rites.sigils);
    slot.life = seconds;
    slot.span = seconds;
    slot.radius = radius;
    slot.gain = gain;
    const u = slot.mesh.material.uniforms;
    u.uColour.value.set(colour);
    u.uAccent.value.set(accent);
    u.uFolds.value = folds;
    u.uSpin.value = spin;
    u.uWipe.value = 0;
    u.uSeed.value = Math.random();
    /* Every vertex is put on the sand beneath it, exactly like the
       scorch: a flat disc laid across a dune is half buried and half
       floating, and a seal that clips through the ground is the single
       loudest way to say "decal".

       THE DRAPE IS CLAMPED, and it has to be. These dunes reach better
       than fifty degrees - a five-metre seal struck on one measured
       fifteen metres of vertical span, so it stood up on edge and
       rendered as a thin diagonal ribbon rather than as a mark on the
       ground. Past the clamp the seal stops following the sand and
       accepts a little clipping instead, because a buried edge reads
       as a seal and a vertical one does not. */
    const pos = slot.mesh.geometry.attributes.position;
    slot.mesh.position.set(x, 0, z);
    if (!slot.based || slot.basedRadius !== radius
      || Math.abs(slot.basedX - x) > 0.01 || Math.abs(slot.basedZ - z) > 0.01) {
      const invR = 1 / Math.max(0.001, radius);
      const base = terrain.heightAt(x, z);
      // Local units, so this is a fraction of the seal's own radius.
      const limit = 0.26;
      for (let i = 0; i < pos.count; i += 1) {
        const px = pos.getX(i) * radius;
        const pz = pos.getZ(i) * radius;
        const drop = (terrain.heightAt(x + px, z + pz) - base) * invR;
        pos.setY(i, Math.max(-limit, Math.min(limit, drop)) + 0.055 * invR);
      }
      pos.needsUpdate = true;
      slot.based = true;
      slot.basedRadius = radius;
      slot.basedX = x;
      slot.basedZ = z;
    }
    slot.mesh.position.y = terrain.heightAt(x, z);
    slot.mesh.visible = true;
    return slot;
  }

  function updateRites(dt) {
    const now = atmos.elapsed;
    for (const slot of rites.shafts) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; continue; }
      /* Snaps to height, stands, then falls back into the ground
         rather than dimming in place - a column that fades uniformly
         reads as a light being switched off, and one that RETRACTS
         reads as something that was spent. */
      const rise = p < 0.09 ? (p / 0.09) ** 0.55 : 1;
      const fall = p > slot.hold
        ? 1 - ((p - slot.hold) / (1 - slot.hold)) ** 1.6 : 1;
      const width = p < 0.09 ? lerp(0.55, 1, p / 0.09)
        : lerp(1, 0.34, ((p - 0.09) / 0.91) ** 0.9);
      slot.mesh.scale.set(slot.radius * width,
        Math.max(0.001, slot.height * rise * fall), slot.radius * width);
      slot.mesh.material.uniforms.uTime.value = now;
      slot.mesh.material.uniforms.uGain.value = slot.gain
        * (p < 0.06 ? p / 0.06 : (1 - p) ** 1.15);
    }

    for (const slot of rites.shells) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; continue; }
      // Overshoots by a few percent on the way out and settles back:
      // a shell that arrives exactly at its radius reads as a tween.
      const open = p < 0.22 ? (p / 0.22) ** 0.5 * 1.06 : 1.06 - (p - 0.22) * 0.08;
      slot.mesh.scale.set(slot.radius * open, slot.radius * open * 0.96,
        slot.radius * open);
      const u = slot.mesh.material.uniforms;
      u.uTime.value = now;
      // The forming band climbs the shell once, in the first third.
      u.uWave.value = p < 0.34 ? (p / 0.34) : 2;
      u.uGain.value = slot.gain * (p < 0.10 ? p / 0.10 : (1 - p) ** 1.5);
    }

    for (const slot of rites.sigils) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; continue; }
      slot.mesh.scale.setScalar(slot.radius * (0.94 + 0.06 * Math.min(1, p * 6)));
      const u = slot.mesh.material.uniforms;
      u.uTime.value = now;
      u.uWipe.value = Math.min(1, p / 0.30);
      u.uGain.value = slot.gain
        * (p < 0.05 ? p / 0.05 : (1 - p) ** 1.25) * 0.95;
    }
  }

  /** A mark on the ground, with every vertex put on the sand under it.
   *  A flat disc laid across a dune is half buried and half floating. */
  function scorchFx(x, z, radius, seconds, colour, strength = 0.42) {
    let slot = ordnance.scorches[0];
    for (const item of ordnance.scorches) {
      if (item.life <= 0) { slot = item; break; }
      if (item.life / item.span < slot.life / slot.span) slot = item;
    }
    const y = terrain.heightAt(x, z);
    const p = slot.position;
    p[0] = 0; p[1] = 0.06; p[2] = 0;
    for (let r = 0; r < SCORCH_RINGS_N; r += 1) {
      const rr = radius * ((r + 1) / SCORCH_RINGS_N);
      for (let s = 0; s < SCORCH_SIDES_N; s += 1) {
        const a = (s / SCORCH_SIDES_N) * TAU + r * 0.19;
        const wob = 1 - 0.16 * Math.sin(a * 3 + r * 2.1) - 0.08 * Math.cos(a * 5 + r);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * SCORCH_SIDES_N + s) * 3;
        p[i] = px;
        p[i + 1] = terrain.heightAt(x + px, z + pz) - y + 0.06;
        p[i + 2] = pz;
      }
    }
    slot.mesh.position.set(x, y, z);
    slot.mesh.geometry.attributes.position.needsUpdate = true;
    slot.mesh.material.color.set(colour);
    slot.mesh.visible = true;
    slot.life = seconds;
    slot.span = seconds;
    slot.strength = strength;
    return slot;
  }

  function updateOrdnance(dt) {
    const now = atmos.elapsed;
    for (let i = ordnance.queue.length - 1; i >= 0; i -= 1) {
      if (ordnance.queue[i].at > now) continue;
      const [item] = ordnance.queue.splice(i, 1);
      item.fn();
    }

    for (const slot of ordnance.beams) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; slot.mesh.material.opacity = 0; continue; }
      /* Flares open, then collapses to a thread. The collapse is what
         makes it read as something that STRUCK rather than as a light
         that was switched off: the column narrows to nothing while the
         ground effects it caused are still expanding. */
      const width = p < 0.10
        ? lerp(0.42, 1, p / 0.10)
        : lerp(1, 0.06, ((p - 0.10) / 0.90) ** 0.65);
      slot.mesh.scale.set(slot.radius * width, slot.height, slot.radius * width);
      slot.mesh.material.opacity = p < 0.06 ? 1 : (1 - p) ** 1.35;
    }

    for (const slot of ordnance.rings) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; slot.mesh.material.opacity = 0; continue; }
      // Fast out of the gate and decelerating, which is how a pressure
      // wave actually travels and the opposite of a linear tween.
      const eased = 1 - (1 - p) ** 2.2;
      const r = lerp(slot.from, slot.to, eased);
      /* THE TUBE MUST NOT SCALE WITH THE RADIUS. A torus scaled
         uniformly is a ring whose cross-section grows as it expands,
         and at a lance's twenty-four metres that turned a 5cm band into
         a twelve-metre vertical ribbon standing on the sand - which
         reviewed as a translucent wall rather than as a pressure wave.
         The band keeps a near-constant height and only the circle
         travels. */
      slot.mesh.scale.set(r, (0.9 + r * 0.05) * slot.thickness, r);
      // A gyre climbs while it opens, decelerating with the same eased
      // curve, so the loop and its lift stay one movement.
      if (slot.rise) slot.mesh.position.y += slot.rise * (1 - p) ** 1.4 * dt;
      slot.mesh.material.opacity = (1 - p) ** 1.9 * 0.62;
    }

    for (const slot of ordnance.domes) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; slot.mesh.material.opacity = 0; continue; }
      const eased = 1 - (1 - p) ** 2.6;
      slot.mesh.scale.set(slot.radius * eased, slot.radius * eased * 0.55,
        slot.radius * eased);
      /* Barely there. This is the sand a blast lifts, and at half
         opacity it rendered as a smooth glass dome sitting over the
         crater - a hard-edged solid where the whole point is a soft
         one. Dust is read from what it dims, not from its own surface. */
      slot.mesh.material.opacity = (1 - p) ** 2.2 * 0.15;
    }

    for (const slot of ordnance.scorches) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const p = 1 - clamp01(slot.life / slot.span);
      if (slot.life <= 0) { slot.mesh.visible = false; slot.mesh.material.opacity = 0; continue; }
      /* Burned in fast, cooling slowly - sand fills a hole from the rim.
         Deliberately well under half: a near-opaque near-black disc
         reads as a hole cut through the terrain rather than as scorched
         ground, and eleven of them turned a salvo's aftermath into a
         field of ink blots. */
      slot.mesh.material.opacity = (p < 0.05 ? p / 0.05 : (1 - p) ** 0.7)
        * (slot.strength ?? 0.42);
    }
  }

  /* ------------------------------------------------------------------
     THE THREE COMMANDS
     ------------------------------------------------------------------ */

  const LANCE_HOT = "#bfe9ff";
  // What a blast throws up is SAND. Tinting the dome with the
  // weapon's own colour made the lance look like it left a
  // force field behind it.
  const DUST = "#d8a978";
  const LANCE_COLD = "#2f9bd6";
  const CLUSTER_HOT = "#ffd489";
  const RITE_HOT = "#ffd98a";

  /**
   * ORBITAL LANCE. One beam, and everything the beam did.
   *
   * The order is the whole effect: light arrives first, the ground
   * answers a beat later, and the dust it lifted is still spreading
   * when the beam has gone. Fire them simultaneously and it reads as a
   * firework - a thing that happened all at once, in one place.
   */
  function orbitalLance(x, y, z, radius = 26) {
    const ground = terrain.heightAt(x, z);
    // The strike itself: 400m of it, so the top is out of frame from
    // any camera at head height and the player never sees it end.
    beamFx(x, ground - 2, z, 2.6, 400, 0.62, LANCE_HOT);
    beamFx(x, ground - 2, z, 5.4, 320, 0.90, LANCE_COLD);
    flashes.emit(x, ground + 1.6, z, 5.4, 0.24, 1.0);
    impacts.emit(x, ground + 0.4, z, 70, radius * 0.42, 3.2, 0.9);

    later(0.06, () => {
      ringFx(x, ground + 0.35, z, 1.5, radius * 0.92, 0.85, LANCE_HOT, 1.0);
      domeFx(x, ground, z, radius * 0.78, 1.35, DUST);
      impacts.emit(x, ground + 0.3, z, 60, radius * 0.30, 5.6, 0.16);
    });
    // The second wave, wider and slower: an air blast outruns its own
    // debris, and two rings at different speeds are what says so.
    later(0.20, () => {
      ringFx(x, ground + 0.55, z, radius * 0.3, radius * 1.32, 1.25, LANCE_COLD, 0.7);
    });
    later(0.34, () => {
      scorchFx(x, z, radius * 0.55, 9, "#2b1a12", 0.62);
      impacts.emit(x, ground + 0.8, z, 34, radius * 0.5, 2.2, 0.10);
    });
    /* The column of dust that stands afterwards. It is the part a
       player two districts away actually sees, and the reason a lance
       marks the map for ten seconds rather than for one. */
    for (let i = 1; i <= 7; i += 1) {
      later(0.4 + i * 0.34, () => {
        impacts.emitDirected(x + (Math.random() - 0.5) * radius * 0.45, ground + 0.5,
          z + (Math.random() - 0.5) * radius * 0.45, 20, 0, 1, 0,
          3.4, 2.6, 0.30);
      });
    }
  }

  /**
   * CLUSTER SALVO. A canister, and then eleven of them.
   *
   * The name promised submunitions and the effect delivered one large
   * bang, which is the same event as the lance at a different size. The
   * canister now airbursts overhead and the bomblets walk across the
   * radius over about a second - so the salvo is read as an AREA being
   * covered rather than as a point being hit, which is also exactly the
   * difference the player is choosing between when they pick it.
   */
  function clusterSalvo(x, y, z, radius = 17) {
    const ground = terrain.heightAt(x, z);
    const burstY = ground + 17;
    flashes.emit(x, burstY, z, 1.5, 0.16, 0.95);
    impacts.emit(x, burstY, z, 26, 7.5, 1.05, 0.55);
    ringFx(x, burstY, z, 0.6, 7.5, 0.42, CLUSTER_HOT, 1.6);

    const count = 11;
    for (let i = 0; i < count; i += 1) {
      // Square-rooted radius, or every bomblet lands in the middle:
      // uniform r over a disc puts most of the area near the rim.
      const angle = i * 2.3999632297 + Math.random() * 0.4;
      const dist = Math.sqrt((i + 0.35) / count) * radius * 0.94;
      const bx = x + Math.cos(angle) * dist;
      const bz = z + Math.sin(angle) * dist;
      // Rippling outward rather than in a random order, so the carpet
      // has a direction and the player can see where it is going next.
      later(0.22 + (dist / radius) * 0.62 + Math.random() * 0.07, () => {
        const by = terrain.heightAt(bx, bz);
        flashes.emit(bx, by + 0.9, bz, 1.05, 0.13, 0.95);
        impacts.emit(bx, by + 0.35, bz, 22, 4.2, 1.25, 0.75);
        impacts.emit(bx, by + 0.2, bz, 14, 2.6, 2.4, 0.14);
        ringFx(bx, by + 0.28, bz, 0.5, 5.2, 0.46, CLUSTER_HOT, 0.9);
        if (i % 3 === 0) domeFx(bx, by, bz, 5.4, 0.8, DUST);
        if (i % 4 === 0) scorchFx(bx, bz, 3.1, 6, "#33200f", 0.30);
      });
    }
  }

  /**
   * THE GILDING RITE. A consecration, not an explosion.
   *
   * It has to be legible as HELP at a glance - the player calls it
   * while something is chewing on them - so it is the one command with
   * no debris and no scorch: a gold column, a ring that closes INWARD
   * rather than expanding, and a field that stays lit for as long as
   * the blessing lasts.
   */
  function consecration(x, y, z, radius = 7, seconds = 20) {
    const ground = terrain.heightAt(x, z);
    beamFx(x, ground - 1, z, 4.2, 34, 1.5, RITE_HOT);
    beamFx(x, ground - 1, z, 1.5, 26, 1.2, "#fff3d2");
    flashes.emit(x, ground + 2.2, z, 3.2, 0.3, 2.0);
    // Inward, and slowly: everything else in this file expands.
    ringFx(x, ground + 0.4, z, radius * 1.9, radius * 0.55, 1.5, RITE_HOT, 1.2);
    domeFx(x, ground, z, radius, 1.6, RITE_HOT);
    for (let i = 0; i < 5; i += 1) {
      later(i * 0.16, () => {
        impacts.emitDirected(x, ground + 0.4, z, 14, 0, 1, 0, 5.5, 1.1, 2.0);
      });
    }
    const pulses = Math.max(1, Math.round(seconds / 2.4));
    for (let i = 1; i <= pulses; i += 1) {
      later(i * 2.4, () => {
        ringFx(x, terrain.heightAt(x, z) + 0.3, z, radius * 0.4, radius,
          1.1, RITE_HOT, 0.55);
      });
    }
  }

  /** The blessing, on the body. Called every frame it is live, so it
   *  stays cheap: a few gold ions rising off the trooper. */
  function gild(x, y, z, strength = 1) {
    if (Math.random() > 0.45 * clamp01(strength)) return;
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * 0.45;
    impacts.emitDirected(x + Math.cos(a) * r, y + 0.3 + Math.random() * 1.5,
      z + Math.sin(a) * r, 1, 0, 1, 0, 1.4, 0.55, 2.0);
  }

  /* ------------------------------------------------------------------
     DOCTRINE CUES

     Gameplay publishes one small, normalized event when a talent
     actually changes the fight. This dispatcher turns that event into
     an unmistakable Order signature using ONLY the pools already owned
     by this module. It deliberately creates no geometry, materials,
     timers or per-frame objects: a busy shield block and a capstone can
     land in the same frame without turning feedback into a hitch.

     Style-channel reservation:
       6 Censer      gold / furnace column
       7 Procession  vermilion / rhythmic rings
       8 Wing        cyan / lifted wakes
       9 Halo        periwinkle / counter-domes
      10 Edict       emerald / command seals
     ------------------------------------------------------------------ */
  /* `folds` is the Order's radial symmetry and it is the single piece
     of iconography that makes a rite nameable from its footprint
     alone: eight for the censer's star, three for the Procession's
     tolls, two for the Wing, twelve for the Halo's crown, six for the
     Edict's seal. `spin` is signed, so the Orders do not all turn the
     same way - the Halo runs backwards, because it counters. */
  const DOCTRINE_STYLES = Object.freeze(Object.assign(Object.create(null), {
    censer: Object.freeze({
      id: 6, colour: "#ffad2f", accent: "#ffd56a", folds: 8, spin: 0.18,
    }),
    procession: Object.freeze({
      id: 7, colour: "#ff7045", accent: "#ffb25f", folds: 3, spin: 0.42,
    }),
    wing: Object.freeze({
      id: 8, colour: "#08d4ff", accent: "#70efff", folds: 2, spin: 0.30,
    }),
    halo: Object.freeze({
      id: 9, colour: "#6684ff", accent: "#a4b9ff", folds: 12, spin: -0.24,
    }),
    edict: Object.freeze({
      id: 10, colour: "#20e0a6", accent: "#70ffd0", folds: 6, spin: 0.14,
    }),
  }));
  const doctrineReducedQuery = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const doctrineCoarseQuery = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(hover: none) and (pointer: coarse)") : null;
  const doctrineStats = {
    accepted: 0,
    rejected: 0,
    fallbacks: 0,
    reduced: 0,
    capstones: 0,
    censer: 0,
    procession: 0,
    wing: 0,
    halo: 0,
    edict: 0,
    lastOrder: "",
    lastKind: "",
    lastTalentId: "",
    lastSource: "",
    lastStage: "",
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    lastYaw: 0,
    lastRadius: 0,
    lastIntensity: 0,
    lastRank: 1,
    lastCapstone: false,
    lastReduced: false,
    lastFallback: false,
    lastAt: 0,
  };

  function doctrineDefaultRadius(kind, capstone) {
    switch (kind) {
      case "brand": return 2.2;
      case "brand-break": return 3.4;
      case "vent": return 3.8;
      case "heatless": return 2.1;
      case "reprieve": return 2.8;
      case "martyr": return 6;
      case "hook": return 4;
      case "toll": return 6;
      case "expose": return 3.2;
      case "mercy": return 3;
      case "litany": return 5;
      case "conversion": return 3;
      case "feather": return 3.2;
      case "wake": return 3.5;
      case "ram": return 4;
      case "circuit": return capstone ? 6 : 2.8;
      case "parry": return 3.5;
      case "wrath-store": return 2.4;
      case "reversal": return 3;
      case "wrath-release": return 5;
      case "dome": return 8;
      case "seraph": return 8;
      case "siren": return 12;
      case "fuse": return 3.2;
      case "recall": return 6;
      case "chapel": return 8;
      case "sigil": return 9;
      case "fusion": return 9;
      case "capstone": return 7;
      default: return capstone ? 6 : 3;
    }
  }

  function doctrineActive(pool) {
    let active = 0;
    for (const slot of pool) if (slot.life > 0 && slot.mesh.visible) active += 1;
    return active;
  }

  /* ------------------------------------------------------------------
     RITE GESTURES

     Shared movements the signatures below are written in. Each one is
     a SHAPE with a direction and a duration, not a parameter set: the
     dispatcher used to be twenty-nine calls to the same three
     primitives at different radii, which is why every talent in the
     tree looked like every other one.
     ------------------------------------------------------------------ */

  /** Paired fans that sweep OPEN from the shoulders and settle, seeded
   *  along the span so the eye reads a leading edge travelling
   *  outward. Two puffs of dots beside the trooper read as bubbles;
   *  a swept span with a delay along it reads as a wingbeat. */
  function doctrineWingRise(x, y, z, yaw, intensity, scale, style, compact,
    strong = false) {
    const sideX = Math.cos(yaw);
    const sideZ = -Math.sin(yaw);
    const backX = -Math.sin(yaw);
    const backZ = -Math.cos(yaw);
    const ribs = compact ? (strong ? 4 : 3) : (strong ? 7 : 5);
    const reach = (strong ? 2.5 : 1.55) * scale;
    const speed = (strong ? 6.6 : 4.9) * scale;
    const life = strong ? 1.05 : 0.78;
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < ribs; i += 1) {
        const t = ribs > 1 ? i / (ribs - 1) : 0;
        // The span curves back and lifts toward the tip, which is the
        // whole difference between a wing and a pair of arms.
        const span = 0.34 + t * reach;
        const lift = 0.30 + Math.sin(t * Math.PI * 0.72) * (strong ? 1.35 : 0.86);
        const sweep = t * t * (strong ? 0.70 : 0.44);
        const px = x + sideX * s * span + backX * sweep;
        const pz = z + sideZ * s * span + backZ * sweep;
        const motes = Math.max(2, Math.round((strong ? 9 : 6)
          * (compact ? 0.6 : 1) * intensity));
        // Small and many. At the pool's default size a feather came
        // out as a string of pearls hanging in the air beside the
        // trooper; a pinion is made of fine bright barbs.
        impacts.emitTrail(px, y + lift, pz,
          sideX * s * 0.34 + backX * 0.30, 0.52, sideZ * s * 0.34 + backZ * 0.30,
          (strong ? 1.5 : 1.0) * scale, speed, motes,
          (strong ? 0.30 : 0.22) * scale, style, life);
      }
    }
  }

  /** A wave that leaves as a CIRCLE rather than as a fountain, with
   *  the ignition running around the rim so the ring has a beginning. */
  function doctrineWave(x, y, z, radius, count, speed, rise, scale, style,
    compact, life = 0.85, sweep = 0.10) {
    // Same rule as the embers: the wave is made of sparks, and a spark
    // that fills a centimetre of screen is a bubble.
    impacts.emitRing(x, y, z, Math.max(4, Math.round(count * (compact ? 0.5 : 1))),
      radius, speed, rise, scale * 0.52, style, life, sweep, Math.random() * TAU);
  }

  /** Embers that outlive the event. Nothing in the pool used to live
   *  past 0.62s, so no rite had an aftermath: the screen went from
   *  full effect to bare sand inside two-thirds of a second. */
  function doctrineEmbers(x, y, z, radius, count, scale, style, compact,
    life = 1.9) {
    /* MANY SMALL, not few large. A cinder is a couple of pixels with a
       halo; at the pool's default size these came out as centimetre-
       wide discs and read as lens bokeh drifting past the camera.
       Halving the size and raising the count keeps the same amount of
       light in the frame and changes what the light is made of. */
    impacts.emit(x, y + 0.35, z,
      Math.max(4, Math.round(count * 1.5 * (compact ? 0.45 : 1))),
      radius * 0.42, scale * 0.44, style, life);
  }

  /** The two-beat read every landed rite shares: a hot pressure front
   *  across the sand, and a second loop standing in the air above it.
   *  One flat ring alone is a tween the camera can barely see; a front
   *  plus a gyre is an event with a floor and a body. */
  function doctrineGround(x, ringY, z, radius, colour, accent, compact,
    thick = 1, quick = 0.42) {
    ringFx(x, ringY, z, 0.32, radius * 0.78, quick, accent, thick * 1.15);
    gyreFx(x, ringY + 0.85, z, 0.40, radius * 0.62, quick * 1.30, colour,
      thick * 0.92, 0.34, 1.5);
    if (!compact) {
      ringFx(x, ringY + 0.07, z, radius * 0.22, radius * 1.16,
        quick * 1.55, colour, thick * 0.66);
    }
  }

  /**
   * Render one authoritative talent event. Required fields are
   * `{ order, kind, x, z }`; `y`, `yaw`, `radius`, `intensity` (or
   * `strength`), `rank`, `capstone`, `talentId`, `source`, `stage` and
   * `count` are optional. Returns false only for a malformed position
   * or unknown Order. An unknown kind still receives a safe Order pulse.
   */
  function doctrineCue(event) {
    if (!event || typeof event !== "object") {
      doctrineStats.rejected += 1;
      return false;
    }
    const order = typeof event.order === "string" ? event.order : "";
    const palette = DOCTRINE_STYLES[order];
    const x = Number(event.x);
    const z = Number(event.z);
    if (!palette || !Number.isFinite(x) || !Number.isFinite(z)) {
      doctrineStats.rejected += 1;
      return false;
    }

    const rawY = Number(event.y);
    const ground = terrain.heightAt(x, z);
    const y = Number.isFinite(rawY) ? rawY : ground;
    const ringY = ground + 0.22;
    const visualY = Math.max(ground + 0.55, y + 0.45);
    const kind = typeof event.kind === "string" && event.kind
      ? event.kind : typeof event.cue === "string" && event.cue ? event.cue : "pulse";
    const capstone = !!event.capstone;
    const rawRadius = Number(event.radius);
    const radius = Number.isFinite(rawRadius) && rawRadius > 0
      ? Math.min(24, Math.max(0.75, rawRadius))
      : doctrineDefaultRadius(kind, capstone);
    const rawIntensity = Number(event.intensity ?? event.strength);
    const intensity = Number.isFinite(rawIntensity)
      ? Math.min(1.25, Math.max(0.18, rawIntensity)) : 0.7;
    const rawRank = Number(event.rank);
    const rank = Number.isFinite(rawRank)
      ? Math.min(2, Math.max(1, Math.floor(rawRank))) : 1;
    const rawYaw = Number(event.yaw);
    const yaw = Number.isFinite(rawYaw) ? rawYaw : 0;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const stage = typeof event.stage === "string" ? event.stage : "proc";
    const rawCount = Number(event.count);
    const count = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;
    const body = typeof document !== "undefined" ? document.body : null;
    const reduced = typeof event.reducedMotion === "boolean"
      ? event.reducedMotion
      : !!(doctrineReducedQuery?.matches
        || body?.classList?.contains("sf-reduced-motion")
        || body?.classList?.contains("sf-ui-reduced-motion")
        || body?.dataset?.sfMotion === "reduced");
    const compact = reduced || !!doctrineCoarseQuery?.matches;
    const particleScale = compact ? 0.48 : 1;
    const scale = 0.76 + intensity * 0.52 + (rank - 1) * 0.10 + (capstone ? 0.10 : 0);
    const style = palette.id;
    const colour = palette.colour;
    const accent = palette.accent;
    const folds = palette.folds;
    const spin = palette.spin;
    let handled = true;

    // Generic event vocabulary lets a future talent remain visible
    // before it receives a bespoke signature below.
    switch (kind) {
      case "arm":
        sigilFx(x, z, radius * 0.85, reduced ? 0.5 : 0.9, colour, accent,
          folds, spin, 0.62);
        ringFx(x, ringY, z, radius, radius * 0.34, reduced ? 0.32 : 0.54,
          colour, 0.9);
        break;
      case "pulse":
        doctrineGround(x, ringY, z, radius, colour, accent, compact, 0.9);
        flashes.emit(x, visualY, z, 0.50 * scale, 0.14, style);
        break;
      case "release":
        doctrineGround(x, ringY, z, radius, colour, accent, compact, 1.05);
        flashes.emit(x, visualY, z, 0.76 * scale, 0.16, style);
        impacts.emitDirected(x, visualY, z,
          Math.max(4, Math.round(12 * particleScale * intensity)),
          dx * 0.55, 0.48, dz * 0.55, 6.8 * scale, 0.68 * scale, style, 0.9);
        break;
      case "capstone":
        sigilFx(x, z, radius * 0.95, 1.5, colour, accent, folds, spin, 1.05);
        shaftFx(x, ground - 0.3, z, 0.86 * scale, 22, 0.90, colour, accent,
          1.15, 0.30);
        doctrineGround(x, ringY, z, radius, colour, accent, compact, 1.25, 0.52);
        if (!reduced) shellFx(x, ground, z, radius * 0.8, 0.78, colour, accent, 0.8);
        flashes.emit(x, visualY + 0.7, z, 1.35 * scale, 0.22, style);
        doctrineWave(x, ringY, z, radius * 0.30, 26, 6.6, 1.5,
          0.90 * scale, style, compact, 1.5, 0.14);
        break;
      default:
        handled = false;
    }

    if (!handled && order === "censer") {
      handled = true;
      switch (kind) {
        /* A BRAND is a mark burned into a target and left there. It is
           the only Censer rite that is not an explosion, so it may not
           look like a small one: a seal writes itself on the sand and a
           thin heat-haze of embers climbs off it. */
        case "brand":
          sigilFx(x, z, radius * 1.05, reduced ? 0.62 : 1.35, colour, accent,
            folds, spin, 0.78);
          ringFx(x, ringY, z, radius * 1.18, radius * 0.30,
            reduced ? 0.30 : 0.52, accent, 0.78);
          impacts.emitDirected(x, ringY, z,
            Math.max(3, Math.round(8 * particleScale * intensity)),
            0, 1, 0, 3.0, 0.46 * scale, style, 1.25);
          break;
        /* And the BREAK is that mark failing: the seal is already on
           the ground when the furnace comes up through it. The two
           beats are what make this the pay-off of the brand rather than
           a second, larger brand. */
        case "brand-break":
          sigilFx(x, z, radius * 0.92, 0.42, accent, colour, folds,
            spin * 3.2, 1.15);
          doctrineGround(x, ringY, z, radius, colour, accent, compact, 1.15);
          flashes.emit(x, visualY, z, 0.85 * scale, 0.17, style);
          doctrineWave(x, ringY, z, radius * 0.34, 18, 5.4, 2.1,
            0.66 * scale, style, compact, 1.15, 0.06);
          if (!compact) {
            later(0.09, () => shaftFx(x, ground - 0.2, z, 0.50 * scale,
              7.5, 0.46, colour, accent, 0.95, 0.14));
            later(0.20, () => doctrineEmbers(x, ground, z, radius * 0.7,
              10, 0.50 * scale, style, compact, 1.7));
          }
          break;
        /* Venting is a DIRECTED gout out of the weapon, so it keeps the
           cone - but a gout has a mouth. The stubby shaft laid along
           the bearing is that mouth, and it is what stops this reading
           as the same omnidirectional puff as everything else. */
        case "vent":
          ringFx(x, ringY, z, 0.45, radius, 0.52, colour, 1.0);
          flashes.emit(x, visualY, z, 0.72 * scale, 0.16, style);
          impacts.emitDirected(x, ringY + 0.25, z,
            Math.max(5, Math.round(19 * particleScale * intensity)),
            dx * 0.68, 0.42, dz * 0.68, 8.4 * scale, 0.72 * scale, style, 1.05);
          if (!compact) {
            impacts.emitTrail(x + dx * 0.5, visualY, z + dz * 0.5,
              dx, 0.16, dz, 3.4 * scale, 11, 7, 0.50 * scale, style, 1.35);
          }
          break;
        /* Heatless is a REFUSAL of the furnace - the one Censer rite
           that has to read cool. No embers, no shaft: a tight seal that
           closes and a single clean ring. */
        case "heatless": {
          const consumed = stage === "consume";
          sigilFx(x, z, radius * (consumed ? 1.15 : 0.85),
            consumed ? 0.66 : 0.44, accent, colour, folds, spin * -1.4,
            consumed ? 0.85 : 0.5);
          ringFx(x, ringY, z, radius * (consumed ? 1.25 : 0.95),
            radius * 0.24, consumed ? 0.38 : 0.52, accent, consumed ? 1.1 : 0.7);
          flashes.emit(x, visualY, z, (consumed ? 0.72 : 0.42) * scale,
            consumed ? 0.16 : 0.11, style);
          break;
        }
        // A reprieve is warmth arriving, so it BLOOMS inward-out slowly
        // and hangs, rather than snapping.
        case "reprieve":
          ringFx(x, ringY, z, radius * 1.25, radius * 0.38, 0.64, colour, 0.86);
          if (!compact) shellFx(x, ground, z, radius * 0.72, 0.72,
            colour, accent, 0.42);
          flashes.emit(x, visualY, z, 0.58 * scale, 0.17, style);
          doctrineWave(x, ringY, z, radius * 0.9, 14, 1.5, 2.4,
            0.58 * scale, style, compact, 1.6, 0.22);
          break;
        /* MARTYR'S FURNACE. The Censer capstone, and the one moment
           this Order is allowed to be enormous. Four beats: the seal is
           struck, the mouth opens, the furnace breathes out, and the
           embers are still falling half a second later. */
        case "martyr": {
          sigilFx(x, z, radius * 0.95, 1.9, colour, accent, folds,
            spin * 1.6, 1.10);
          flashes.emit(x, visualY + 0.22, z, 1.18 * scale, 0.22, style);
          later(0.07, () => {
            doctrineGround(x, ringY, z, radius, colour, accent, compact,
              1.35, 0.60);
            shaftFx(x, ground - 0.45, z, 1.15 * scale, 15, 1.05,
              colour, accent, 1.25, 0.26);
            doctrineWave(x, ringY, z, radius * 0.28, 30, 8.2, 2.8,
              0.95 * scale, style, compact, 1.5, 0.10);
          });
          if (!compact) {
            later(0.22, () => {
              shellFx(x, ground, z, radius * 0.88, 0.95, colour, accent, 0.72);
              ringFx(x, ringY + 0.12, z, radius * 0.4, radius * 1.42,
                0.86, accent, 0.72);
            });
            later(0.40, () => doctrineEmbers(x, ground, z, radius * 0.85,
              22, 0.78 * scale, style, compact, 2.6));
          }
          scorchFx(x, z, radius * 0.55, 5.5, "#1a0d05", 0.30);
          break;
        }
        default:
          handled = false;
      }
    } else if (!handled && order === "procession") {
      handled = true;
      switch (kind) {
        /* A hook DRAGS. The ring runs inward instead of outward and the
           motes are pulled toward the trooper - the only cue in the
           tree that moves the wrong way on purpose, which is exactly
           why it is legible. */
        case "hook":
          ringFx(x, ringY, z, radius * 1.12, radius * 0.28,
            reduced ? 0.32 : 0.56, colour, 1.0);
          flashes.emit(x, visualY, z, 0.50 * scale, 0.14, style);
          if (!compact) {
            doctrineWave(x, ringY + 0.2, z, radius * 1.05, 12, -3.4, 0.7,
              0.44 * scale, style, compact, 0.62, 0.05);
          }
          break;
        /* THE THIRD TOLL. Three rings, struck one after another rather
           than stacked on the same frame - a bell is a rhythm, and
           three simultaneous circles are just a thick circle. */
        case "toll": {
          const beat = reduced ? 0.05 : 0.085;
          ringFx(x, ringY, z, 0.35, radius * 0.72, 0.38, accent, 1.15);
          gyreFx(x, ringY + 0.95, z, 0.35, radius * 0.52, 0.46, accent,
            1.10, 0.36, 1.3);
          flashes.emit(x, visualY, z, 0.92 * scale, 0.18, style);
          doctrineWave(x, ringY, z, radius * 0.25, 16, 5.6, 1.2,
            0.62 * scale, style, compact, 1.0, 0.05);
          if (!reduced) {
            later(beat, () => {
              ringFx(x, ringY + 0.07, z, 0.45, radius, 0.56, colour, 0.92);
              gyreFx(x, ringY + 1.05, z, 0.40, radius * 0.70, 0.60, colour,
                0.90, -0.30, 1.2);
            });
          }
          if (!compact) {
            later(beat * 2, () => {
              ringFx(x, ringY + 0.14, z, 0.60, radius * 1.20, 0.74, accent, 0.62);
              gyreFx(x, ringY + 1.15, z, 0.45, radius * 0.86, 0.76, accent,
                0.66, 0.42, 1.1);
              flashes.emit(x, visualY, z, 0.48 * scale, 0.13, style);
            });
          }
          break;
        }
        /* Exposure PINS a target. A short shaft standing over the mark
           with a seal under it is a spotlight on the thing that is
           about to die, which is what this talent actually does. */
        case "expose":
          sigilFx(x, z, radius * 1.0, reduced ? 0.62 : 1.15, colour, accent,
            folds, spin, 0.72);
          ringFx(x, ringY, z, radius * 1.12, radius * 0.26, 0.52, colour, 0.88);
          if (!reduced) shaftFx(x, ground - 0.25, z, 0.42 * scale,
            5.6 * scale, 0.62, colour, accent, 0.80, 0.42);
          flashes.emit(x, visualY, z, 0.62 * scale, 0.16, style);
          break;
        case "mercy":
          ringFx(x, ringY, z, radius * 1.2, radius * 0.34, 0.62, accent, 0.82);
          flashes.emit(x, visualY, z, 0.55 * scale, 0.16, style);
          doctrineWave(x, ringY, z, radius * 0.8, 12, 1.2, 2.0,
            0.50 * scale, style, compact, 1.5, 0.18);
          break;
        /* THE ENDLESS LITANY. The capstone is the toll that does not
           stop: five rings on the beat, each wider and dimmer, and a
           column standing through all of them. */
        case "litany": {
          const armed = stage === "arm";
          if (armed) {
            sigilFx(x, z, radius * 0.8, 0.85, colour, accent, folds,
              spin, 0.55);
            ringFx(x, ringY, z, radius, radius * 0.34, 0.58, colour, 0.74);
            flashes.emit(x, visualY, z, 0.55 * scale, 0.14, style);
            break;
          }
          sigilFx(x, z, radius * 0.98, 2.1, colour, accent, folds,
            spin * 1.5, 1.05);
          ringFx(x, ringY, z, 0.45, radius * 0.82, 0.42, colour, 1.28);
          flashes.emit(x, visualY, z, 1.12 * scale, 0.21, style);
          shaftFx(x, ground - 0.35, z, 0.66 * scale, 17, 1.15, colour,
            accent, 1.10, 0.40);
          doctrineWave(x, ringY, z, radius * 0.3, 26, 7.0, 2.2,
            0.82 * scale, style, compact, 1.5, 0.12);
          if (!reduced) {
            const beats = compact ? 2 : 4;
            for (let i = 1; i <= beats; i += 1) {
              const t = i * 0.115;
              const grow = 1 + i * 0.22;
              later(t, () => {
                ringFx(x, ringY + 0.06 * i, z, 0.5, radius * grow,
                  0.52 + i * 0.09, i % 2 ? accent : colour, 1.0 - i * 0.14);
                flashes.emit(x, visualY, z, (0.62 - i * 0.09) * scale, 0.14, style);
              });
            }
            later(0.52, () => doctrineEmbers(x, ground, z, radius * 0.8,
              16, 0.66 * scale, style, compact, 2.4));
          }
          break;
        }
        default:
          handled = false;
      }
    } else if (!handled && order === "wing") {
      handled = true;
      switch (kind) {
        case "conversion":
          ringFx(x, ringY, z, radius * 0.28, radius, 0.48, colour, 0.82);
          // Lift is the whole Order, so the Wing's loop climbs hard.
          gyreFx(x, ringY + 0.7, z, radius * 0.20, radius * 0.72, 0.62,
            accent, 0.92, 0.30, 3.0);
          flashes.emit(x, visualY, z, 0.48 * scale, 0.15, style);
          doctrineWingRise(x, visualY, z, yaw, intensity, scale, style, compact);
          break;
        /* FALLING GOSPEL. The wings open, and one beat later the
           feathers they shed are still in the air. The delay is the
           whole read: shedding and beating on the same frame is a
           single puff, and two beats is a wing. */
        case "feather": {
          const feathers = Math.min(3, Math.max(1, count || 1));
          const spent = stage === "consume";
          if (spent) ringFx(x, ringY, z, 0.35, radius, 0.58, colour, 0.92);
          flashes.emit(x, visualY + 0.35, z, (0.42 + feathers * 0.13) * scale,
            0.16, style);
          doctrineWingRise(x, visualY, z, yaw,
            Math.min(1.25, intensity + feathers * 0.08), scale, style, compact,
            feathers >= 3 || spent);
          if (!compact) {
            later(0.13, () => impacts.emit(x, visualY + 0.7, z,
              Math.max(3, Math.round((3 + feathers * 3) * intensity)),
              1.5, 0.44 * scale, style, 2.1));
          }
          break;
        }
        /* A wake is left BEHIND. It trails off the back and it is the
           one Wing cue with no lift in it, so it cannot be confused
           with the beat that made it. */
        case "wake":
          ringFx(x, ringY, z, 0.38, radius, reduced ? 0.42 : 0.68, colour, 0.62);
          // The wake is a slipstream, so its loop lies back along the
          // travel rather than standing upright over the trooper.
          gyreFx(x - dx * radius * 0.28, ringY + 0.75, z - dz * radius * 0.28,
            0.30, radius * 0.52, 0.72, colour, 0.80, 0.62, 0.7);
          flashes.emit(x, ringY + 0.35, z, 0.42 * scale, 0.13, style);
          impacts.emitTrail(x, ringY + 0.5, z, -dx, 0.05, -dz,
            radius * 0.9, 9, compact ? 9 : 18, 0.24 * scale, style, 1.15);
          break;
        /* The RAM is the only Wing rite that goes forward and down. It
           gets the shell, pushed out along the bearing, so the impact
           has a face rather than a radius. */
        case "ram": {
          const landed = stage === "consume";
          ringFx(x, ringY, z, 0.35, radius, 0.48, accent, 1.0);
          if (landed && !reduced) {
            shellFx(x + dx * radius * 0.30, ground, z + dz * radius * 0.30,
              radius * 0.62, 0.56, colour, accent, 0.82);
          }
          flashes.emit(x, visualY, z, (landed ? 0.92 : 0.68) * scale,
            0.17, style);
          impacts.emitDirected(x, visualY, z,
            Math.max(5, Math.round(17 * particleScale * intensity)),
            dx * 0.82, 0.30, dz * 0.82, 8.0 * scale, 0.66 * scale, style,
            landed ? 1.15 : 0.8);
          if (landed && !compact) {
            later(0.11, () => doctrineWave(x + dx * radius * 0.25, ringY,
              z + dz * radius * 0.25, radius * 0.3, 14, 5.0, 1.4,
              0.60 * scale, style, compact, 1.3, 0.08));
          }
          break;
        }
        case "circuit": {
          // The third segment is followed immediately by one explicit
          // `complete` event. Key only off that stage or the capstone
          // would fire its full VFX twice on the same frame.
          const complete = stage === "complete" || (stage === "proc" && capstone);
          if (complete) {
            /* THE UNBROKEN CIRCUIT closes. The seal lands first, the
               wings throw at full span a beat later, and the ring the
               circuit actually describes is the last thing out - so the
               capstone resolves outward instead of arriving flat. */
            sigilFx(x, z, radius * 0.92, 1.8, colour, accent, folds,
              spin * 1.8, 1.05);
            ringFx(x, ringY, z, 0.40, radius, 0.58, colour, 1.18);
            // The circuit itself: a loop that closes around the trooper
            // and keeps climbing after it has.
            gyreFx(x, ringY + 0.9, z, radius * 0.24, radius * 0.68, 0.72,
              accent, 1.15, 0.32, 2.6);
            doctrineWingRise(x, visualY, z, yaw, intensity, scale, style,
              compact, true);
            if (!compact) {
              later(0.10, () => {
                shellFx(x, ground, z, radius * 0.80, 0.86, colour, accent, 0.78);
                doctrineWave(x, ringY, z, radius * 0.3, 24, 6.4, 2.6,
                  0.80 * scale, style, compact, 1.6, 0.14);
              });
              later(0.24, () => ringFx(x, ringY + 0.10, z, radius * 0.30,
                radius * 1.24, 0.82, accent, 0.65));
              later(0.44, () => doctrineEmbers(x, ground + 0.6, z,
                radius * 0.7, 14, 0.62 * scale, style, compact, 2.5));
            }
          } else {
            const segments = Math.min(3, Math.max(1, count || 1));
            ringFx(x, ringY, z, radius * (0.18 + segments * 0.13), radius,
              0.46 + segments * 0.06, colour, 0.58 + segments * 0.14);
            doctrineWingRise(x, visualY, z, yaw,
              Math.min(0.82, intensity), scale * 0.82, style, compact);
          }
          flashes.emit(x, visualY, z, (complete ? 0.88 : 0.38) * scale,
            complete ? 0.22 : 0.13, style);
          break;
        }
        default:
          handled = false;
      }
    } else if (!handled && order === "halo") {
      handled = true;
      switch (kind) {
        /* A PARRY is a surface refusing an impact, so the shell is the
           cue and everything else is trim. It is deliberately small,
           short and hard: a wide soft dome reads as a buff, and this
           is the single most reactive moment in the Order. */
        case "parry":
          if (!reduced) {
            shellFx(x, ground, z, Math.min(3.4, radius * 0.50), 0.40,
              colour, accent, 1.35);
          }
          ringFx(x, ringY, z, 0.35, radius, 0.38, accent, 1.25);
          // The crown. A parry is the Order's signature moment, so the
          // halo itself snaps shut around the trooper's chest.
          gyreFx(x, ringY + 1.15, z, radius * 0.80, radius * 0.34, 0.34,
            accent, 1.30, 0.30, 0.4);
          flashes.emit(x, visualY, z, 0.66 * scale, 0.15, style);
          // Sparks come OFF the shell, back toward whatever was blocked.
          impacts.emitDirected(x, visualY, z,
            Math.max(4, Math.round(13 * particleScale * intensity)),
            -dx * 0.45, 0.55, -dz * 0.45, 6.6 * scale, 0.58 * scale, style, 0.85);
          break;
        // Storing is quiet on purpose: it INHALES. A tightening ring,
        // motes drawn in, and no flash at all.
        case "wrath-store":
          ringFx(x, ringY, z, radius, radius * 0.38, 0.46, colour, 0.66);
          if (!compact) {
            doctrineWave(x, ringY + 0.4, z, radius * 1.15, 10, -2.8, 0.9,
              0.40 * scale, style, compact, 0.70, 0.04);
          }
          flashes.emit(x, visualY, z, 0.40 * scale, 0.12, style);
          break;
        /* A reversal TURNS. The ring runs one way while it is pending
           and the other way when it is spent, which is the cleanest
           statement of the mechanic the geometry can make. */
        case "reversal": {
          const consumed = stage === "consume";
          ringFx(x, ringY, z, consumed ? 0.35 : radius,
            consumed ? radius : radius * 0.34, consumed ? 0.42 : 0.54,
            consumed ? accent : colour, consumed ? 1.0 : 0.66);
          if (consumed) {
            sigilFx(x, z, radius * 1.05, 0.85, colour, accent, folds,
              spin * 3.0, 0.88);
          }
          flashes.emit(x, visualY, z, (consumed ? 0.76 : 0.42) * scale,
            consumed ? 0.16 : 0.12, style);
          if (consumed) impacts.emitDirected(x, visualY, z,
            Math.max(4, Math.round(12 * particleScale * intensity)),
            -dx * 0.74, 0.38, -dz * 0.74, 7.2 * scale, 0.54 * scale, style, 1.0);
          break;
        }
        /* Release throws the stored block FORWARD. The shell is pushed
           out along the bearing and struck from behind, so it reads as
           the stored wrath leaving rather than as a second guard. */
        case "wrath-release": {
          const cx = x + dx * radius * 0.42;
          const cz = z + dz * radius * 0.42;
          const cy = terrain.heightAt(cx, cz) + 0.24;
          ringFx(cx, cy, cz, 0.35, radius * 0.62, 0.46, accent, 1.15);
          if (!reduced) {
            shellFx(cx, cy - 0.24, cz, Math.min(3.8, radius * 0.42), 0.52,
              colour, accent, 1.05);
          }
          flashes.emit(cx, cy + 0.8, cz, 0.68 * scale, 0.17, style);
          impacts.emitDirected(x, visualY, z,
            Math.max(5, Math.round(18 * particleScale * intensity)),
            dx * 0.90, 0.24, dz * 0.90, 8.6 * scale, 0.68 * scale, style, 1.1);
          break;
        }
        case "mercy":
          ringFx(x, ringY, z, radius * 1.06, radius * 0.48, 0.62, accent, 0.58);
          if (!compact) {
            shellFx(x, ground, z, Math.min(3.6, radius * 0.46), 0.72,
              colour, accent, 0.48);
          }
          flashes.emit(x, visualY, z, 0.32 * scale, 0.12, style);
          break;
        /* THE DOME. The Order's namesake, and the cue that most needed
           a surface rather than a wash: it now closes over the trooper
           on a climbing band of light and stands. The full gameplay
           radius stays in the ground ring - a camera-height hemisphere
           at eight metres fills the frame - but what is inside that
           ring is now unmistakably a shell. */
        case "dome":
          sigilFx(x, z, radius * 0.72, 1.5, colour, accent, folds,
            spin, 0.62);
          ringFx(x, ringY, z, radius * 0.38, radius, 0.48, accent, 0.72);
          // A crown that hangs while the dome stands, not a flash.
          gyreFx(x, ringY + 1.35, z, 0.5, radius * 0.30, 1.10, accent,
            1.05, 0.26, 0.35);
          if (!compact) {
            shellFx(x, ground, z, Math.min(3.6, radius * 0.54), 1.05,
              colour, accent, 1.0);
          }
          flashes.emit(x, visualY, z, 0.38 * scale, 0.13, style);
          break;
        /* THE SERAPH AEGIS. The Halo capstone: the crown lands, the
           shell closes over it, and a column stands in the middle of
           the whole thing. Twelve-fold, turning backwards. */
        case "seraph":
          sigilFx(x, z, radius * 0.9, 2.2, colour, accent, folds,
            spin * 1.4, 1.10);
          ringFx(x, ringY, z, 0.40, radius, 0.58, accent, 1.32);
          // Three crowns, struck apart, widening: the capstone is the
          // parry's single halo answered by a whole rank of them.
          gyreFx(x, ringY + 1.25, z, 0.5, radius * 0.34, 0.62, accent,
            1.25, 0.24, 0.8);
          flashes.emit(x, visualY + 0.42, z, 0.84 * scale, 0.21, style);
          doctrineWave(x, ringY, z, radius * 0.26, 24, 6.0, 2.4,
            0.74 * scale, style, compact, 1.5, 0.12);
          if (!reduced) {
            later(0.12, () => gyreFx(x, ringY + 1.75, z, 0.5, radius * 0.48,
              0.74, colour, 1.0, -0.22, 0.9));
            later(0.26, () => gyreFx(x, ringY + 2.15, z, 0.5, radius * 0.62,
              0.86, accent, 0.80, 0.30, 1.0));
          }
          if (!compact) {
            later(0.08, () => {
              shellFx(x, ground, z, Math.min(3.7, radius * 0.58), 1.15,
                colour, accent, 1.25);
              shaftFx(x, ground - 0.3, z, 0.54 * scale, 13, 1.0,
                colour, accent, 0.95, 0.44);
            });
            later(0.26, () => ringFx(x, ringY + 0.10, z, radius * 0.28,
              radius * 1.20, 0.80, colour, 0.68));
            later(0.46, () => doctrineEmbers(x, ground + 0.5, z, radius * 0.6,
              14, 0.60 * scale, style, compact, 2.4));
          }
          break;
        default:
          handled = false;
      }
    } else if (!handled && order === "edict") {
      handled = true;
      switch (kind) {
        /* A SIREN is a beacon and it is meant to be seen from across
           the valley, so it keeps the full height. What it does not
           keep is the old flat cylinder: this column has a radial
           falloff, so it turns as the camera moves and is a shaft of
           lit air rather than a green plank standing in the sand. */
        case "siren":
          sigilFx(x, z, radius * 0.42, 2.4, colour, accent, folds,
            spin, 0.85);
          shaftFx(x, ground - 0.4, z, 0.46 * scale, 25, 1.60, colour, accent,
            1.05, 0.52);
          ringFx(x, ringY, z, radius, radius * 0.34, 0.72, colour, 0.86);
          flashes.emit(x, visualY + 0.8, z, 0.52 * scale, 0.17, style);
          doctrineWave(x, ringY, z, radius * 0.2, 14, 3.4, 2.6,
            0.58 * scale, style, compact, 1.6, 0.16);
          break;
        // A fuse is a small charge being set. Tight seal, quick tick,
        // no column - the Edict's quietest cue.
        case "fuse":
          sigilFx(x, z, radius * 0.9, 0.95, accent, colour, folds,
            spin * 2.2, 0.72);
          ringFx(x, ringY, z, radius * 0.28, radius, 0.42, accent, 0.92);
          flashes.emit(x, visualY, z, 0.58 * scale, 0.14, style);
          impacts.emitDirected(x, visualY, z,
            Math.max(4, Math.round(12 * particleScale * intensity)),
            0, 1, 0, 5.4, 0.55 * scale, style, 0.95);
          break;
        // Recall PULLS something back to this point: an inward ring
        // and a short column marking where it arrives.
        case "recall":
          shaftFx(x, ground - 0.3, z, 0.40 * scale, 11, 0.78, colour, accent,
            0.88, 0.30);
          ringFx(x, ringY, z, radius * 1.10, radius * 0.26, 0.58, colour, 0.82);
          if (!compact) {
            ringFx(x, ringY + 0.08, z, radius * 0.24, radius * 0.86,
              0.62, accent, 0.58);
            doctrineWave(x, ringY + 0.3, z, radius * 1.0, 12, -3.2, 1.1,
              0.46 * scale, style, compact, 0.85, 0.06);
          }
          flashes.emit(x, visualY, z, 0.54 * scale, 0.16, style);
          break;
        /* A FIELD CHAPEL is a place, not an event. It gets the longest
           life in the Order and the only shell that is meant to be
           STOOD IN: seal, shell, and a low column at the centre. */
        case "chapel":
          sigilFx(x, z, radius * 0.95, 3.0, colour, accent, folds,
            spin * 0.6, 0.92);
          ringFx(x, ringY, z, radius * 1.12, radius * 0.94, 0.78, accent, 0.62);
          if (!reduced) shellFx(x, ground, z, radius * 0.92, 2.4,
            colour, accent, 0.86);
          if (!compact) {
            shaftFx(x, ground - 0.25, z, 0.34 * scale, 12, 1.5, colour,
              accent, 0.72, 0.55);
          }
          flashes.emit(x, visualY, z, 0.58 * scale, 0.17, style);
          break;
        /* THE SEAL itself. This cue is named for the thing it draws, and
           until now it drew two rings. */
        case "sigil":
          sigilFx(x, z, radius, 2.6, colour, accent, folds, spin, 1.0);
          ringFx(x, ringY, z, radius * 0.22, radius, 0.72, colour, 0.86);
          gyreFx(x, ringY + 0.9, z, radius * 0.18, radius * 0.55, 0.80,
            accent, 0.88, 0.34, 1.0);
          flashes.emit(x, ringY + 0.65, z, 0.50 * scale, 0.16, style);
          break;
        /* THE COMBINED LITURGY. Every Edict shape at once, but not on
           one frame: seal, then the column and the pressure front, then
           the sanctuary closing over it, then the fallout. */
        case "fusion":
          sigilFx(x, z, radius * 0.95, 2.8, colour, accent, folds,
            spin * 1.5, 1.15);
          flashes.emit(x, visualY + 0.72, z, 0.98 * scale, 0.22, style);
          later(0.06, () => {
            shaftFx(x, ground - 0.5, z, 0.88 * scale, 28, 1.35, colour,
              accent, 1.30, 0.40);
            doctrineGround(x, ringY, z, radius, colour, accent, compact,
              1.34, 0.64);
            doctrineWave(x, ringY, z, radius * 0.3, 30, 7.8, 2.6,
              0.98 * scale, style, compact, 1.6, 0.12);
          });
          if (!compact) {
            later(0.24, () => {
              shellFx(x, ground, z, radius * 0.86, 1.35, colour, accent, 0.95);
              ringFx(x, ringY + 0.09, z, radius * 0.30, radius * 1.24,
                0.88, accent, 0.72);
            });
            later(0.46, () => doctrineEmbers(x, ground, z, radius * 0.8,
              20, 0.76 * scale, style, compact, 2.6));
          }
          break;
        default:
          handled = false;
      }
    }

    if (!handled) {
      doctrineStats.fallbacks += 1;
      ringFx(x, ringY, z, 0.35, radius, reduced ? 0.34 : 0.56, colour, 0.82);
      flashes.emit(x, visualY, z, 0.58 * scale, 0.15, style);
      impacts.emitDirected(x, ringY, z,
        Math.max(3, Math.round(8 * particleScale * intensity)),
        0, 1, 0, 4.8, 0.48 * scale, style);
    }

    doctrineStats.accepted += 1;
    doctrineStats[order] += 1;
    if (reduced) doctrineStats.reduced += 1;
    if (capstone) doctrineStats.capstones += 1;
    doctrineStats.lastOrder = order;
    doctrineStats.lastKind = kind;
    doctrineStats.lastTalentId = typeof event.talentId === "string" ? event.talentId : "";
    doctrineStats.lastSource = typeof event.source === "string" ? event.source : "";
    doctrineStats.lastStage = stage;
    doctrineStats.lastX = x;
    doctrineStats.lastY = y;
    doctrineStats.lastZ = z;
    doctrineStats.lastYaw = yaw;
    doctrineStats.lastRadius = radius;
    doctrineStats.lastIntensity = intensity;
    doctrineStats.lastRank = rank;
    doctrineStats.lastCapstone = capstone;
    doctrineStats.lastReduced = reduced;
    doctrineStats.lastFallback = !handled;
    doctrineStats.lastAt = atmos.elapsed;
    return true;
  }

  /** Snapshot allocation is diagnostic-only; the live dispatcher and
   * update loop retain fixed storage. */
  function doctrineState() {
    return {
      accepted: doctrineStats.accepted,
      rejected: doctrineStats.rejected,
      fallbacks: doctrineStats.fallbacks,
      reduced: doctrineStats.reduced,
      capstones: doctrineStats.capstones,
      byOrder: {
        censer: doctrineStats.censer,
        procession: doctrineStats.procession,
        wing: doctrineStats.wing,
        halo: doctrineStats.halo,
        edict: doctrineStats.edict,
      },
      last: {
        order: doctrineStats.lastOrder,
        kind: doctrineStats.lastKind,
        talentId: doctrineStats.lastTalentId,
        source: doctrineStats.lastSource,
        stage: doctrineStats.lastStage,
        x: doctrineStats.lastX,
        y: doctrineStats.lastY,
        z: doctrineStats.lastZ,
        yaw: doctrineStats.lastYaw,
        radius: doctrineStats.lastRadius,
        intensity: doctrineStats.lastIntensity,
        rank: doctrineStats.lastRank,
        capstone: doctrineStats.lastCapstone,
        reducedMotion: doctrineStats.lastReduced,
        fallback: doctrineStats.lastFallback,
        at: doctrineStats.lastAt,
      },
      pools: {
        beams: { active: doctrineActive(ordnance.beams), capacity: ordnance.beams.length },
        rings: { active: doctrineActive(ordnance.rings), capacity: ordnance.rings.length },
        domes: { active: doctrineActive(ordnance.domes), capacity: ordnance.domes.length },
        shafts: { active: doctrineActive(rites.shafts), capacity: rites.shafts.length },
        shells: { active: doctrineActive(rites.shells), capacity: rites.shells.length },
        sigils: { active: doctrineActive(rites.sigils), capacity: rites.sigils.length },
        impacts: { capacity: IMPACT_MAX },
        flashes: { capacity: FLASH_MAX },
        deferred: ordnance.queue.length,
      },
    };
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

  /* ------------------------------------------------------------------
     THE COULTER'S THREE EFFECTS

     All three ride the existing impact pool rather than bringing their
     own system, which is the whole reason the pool has a style channel:
     a burrowing boss adds nine hundred particles a second at its worst
     and it does it inside the same 512-slot budget every other impact
     in the game already shares.
     ------------------------------------------------------------------ */

  /** Sand thrown along a heading. The wake's speed, and the only part
   *  of a submerged animal the player can actually read. */
  function sandSpray(x, y, z, scale = 1, dx = 0, dz = 1) {
    const len = Math.hypot(dx, dz) || 1e-6;
    /* MANY SMALL MOTES, not a few big ones. Same total area, completely
       different read: a handful of large sprites on an additive pass is
       a fireball, and a cloud of small ones is dust. The debris tint
       these are emitted at was pushed up the pool's heat ramp for the
       same reason - at the cold end they came out a saturated ember
       orange that read as burning sand. */
    const count = Math.max(4, Math.round(6 + scale * 9));
    // Forward and UP, because sand pushed out of a furrow leaves it at
    // the angle of repose rather than straight ahead - and thrown hard,
    // because this plume is the only part of a submerged animal the
    // player can see and it has to carry further than the ridge making
    // it.
    impacts.emitDirected(x, y, z, count, (dx / len) * 0.55, 0.94, (dz / len) * 0.55,
      5.2 + scale * 4.4, 0.78 * scale, 0.30);
  }

  /* ------------------------- ground marks ------------------------- */

  /**
   * One boot going down. `side` is -1 left / +1 right so the print
   * sits under the foot rather than under the pelvis, and `weight`
   * scales both the mark and the sand it throws with how hard the
   * trooper is travelling.
   *
   * A print is TWO things and needs both: the mark, which is what you
   * see when you turn round, and a puff, which is what you see at the
   * moment it lands. Neither alone reads as a footfall.
   */
  function footprint(x, z, yaw, side = 0, weight = 1) {
    const w = clamp01(weight);
    marks.mark(x, z, yaw, 0.15 + w * 0.03, 0.27 + w * 0.06,
      0.55 + w * 0.45, 4.5 + w * 1.5);
    if (w < 0.12) return;
    /* Sand leaves a boot BACKWARD and low - it is squeezed out behind
       the sole, not kicked forward. Thrown forward it reads as the
       trooper scuffing through a puddle. */
    const y = terrain.heightAt(x, z);
    impacts.emitDirected(x, y + 0.06, z, Math.round(2 + w * 5),
      -Math.sin(yaw) * 0.5 + side * 0.16, 0.82, -Math.cos(yaw) * 0.5,
      1.5 + w * 2.2, 0.34 + w * 0.22, 0.30, 0.5 + w * 0.35);
  }

  /**
   * A metre of boosted glide, cut into the sand. Called with the
   * distance actually travelled since the last one so the scar is
   * continuous at any speed rather than dashed at high ones.
   */
  function skidMark(x, z, yaw, strength = 1, span = 0.5) {
    const s = clamp01(strength);
    /* Each segment is nearly TWICE the step it covers, so consecutive
       ones overlap by half their length. Cut to the step exactly they
       merely abut, and the scar came out a chain of beads - every
       joint showing as a waist because both capsules taper to nothing
       at their ends. Overlapping means the bite has to come down to
       match, or the doubled middle is twice as dark as a footprint. */
    marks.mark(x, z, yaw, 0.22 + s * 0.10, Math.max(0.34, span * 0.95),
      0.30 + s * 0.26, 5);
    if (Math.random() > 0.34 + s * 0.4) return;
    const y = terrain.heightAt(x, z);
    impacts.emitDirected(x, y + 0.10, z, 2 + Math.round(s * 3),
      -Math.sin(yaw) * 0.72, 0.7, -Math.cos(yaw) * 0.72,
      2.6 + s * 3.4, 0.42 + s * 0.3, 0.30, 0.62);
  }

  /** A thrown or landing globule coming apart. Droplets, so they fall. */
  function venomBurst(x, y, z, scale = 1) {
    impacts.emit(x, y, z, Math.round(10 + scale * 9), 2.8 * scale,
      0.85 * scale, 4.0);
    flashes.emit(x, y, z, 0.55 * scale, 0.16, 4.0);
  }

  /** What a pool gives off. Gas, so it rises and hangs. */
  function venomGas(x, y, z, radius = 3, strength = 1) {
    const count = Math.max(1, Math.round(2 + strength * 4));
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      impacts.emit(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1,
        0.85, 1.35 * (0.6 + strength * 0.5), 5.0);
    }
  }

  /* ============================================================
     WEAPON VENT

     Pressing R put the trooper in 1.4 seconds of deliberate
     vulnerability and showed nothing for it but a gauge in the
     corner - which in a firefight is the one place nobody is
     looking. The purge now happens where the player IS looking:
     on the weapon in their hands.

     Emitted as directed jets rather than a puff, because the ports
     are on the sides of the barrel shroud and steam under pressure
     leaves in a direction. Two opposed side jets plus a weaker
     upward bleed reads as machinery relieving itself; a radial
     cloud reads as the gun being on fire, which is the opposite of
     the message (the vent is the thing that PREVENTS that).

     `strength` is the heat that was dumped, so a vent from redline
     is visibly a bigger event than topping off at 30%.
     ============================================================ */
  function weaponVent(x, y, z, yaw = 0, strength = 1) {
    const s = Math.max(0.15, Math.min(1, strength));
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    // Barrel axis is (sy, 0, cy); the ports face along its normal.
    const rx = cy;
    const rz = -sy;
    const count = Math.round(3 + s * 5);
    for (const side of [1, -1]) {
      impacts.emitDirected(
        x + rx * 0.12 * side, y, z + rz * 0.12 * side,
        count,
        rx * side * 0.92 + sy * 0.18, 0.30, rz * side * 0.92 + cy * 0.18,
        2.6 + s * 3.4,
        0.62 + s * 0.5,
        // The pool's STEAM band. Anything under 1.5 is the ember
        // ramp, which is what an earlier pass used by mistake - the
        // vent came out looking like the weapon was on fire.
        11.0
      );
    }
    // A slower bleed straight up, which is what makes it hang and
    // read as vapour rather than as a spray of particles.
    impacts.emitDirected(x, y + 0.05, z, Math.round(2 + s * 3),
      sy * 0.12, 1, cy * 0.12, 1.1 + s * 1.2, 0.9 + s * 0.7, 11.0);
  }

  return {
    group,
    plumes,
    weaponVent,
    banners: bannerMesh,
    shafts,
    marks: marks.mesh,
    footprint,
    skidMark,
    spark,
    meleeArc,
    blast,
    breach,
    sandSpray,
    venomBurst,
    venomGas,
    orbitalLance,
    clusterSalvo,
    consecration,
    gild,
    tracer,
    muzzle,
    boostImpact,
    slamCharge,
    slamTrail,
    slamImpact,
    doctrineCue,
    doctrineState,
    /* Diagnostic only. The rite primitives are normally reachable just
       through a cue, which means a defect in one of them can only be
       observed with the other two drawing over it. */
    riteProbe: {
      sigil(x, z, radius) {
        return sigilFx(x, z, radius, 2.4, "#20e0a6", "#70ffd0", 6, 0.2, 1);
      },
      shell(x, z, radius) {
        const g = terrain.heightAt(x, z);
        return shellFx(x, g, z, radius, 1.6, "#6684ff", "#a4b9ff", 1);
      },
      shaft(x, z, radius) {
        const g = terrain.heightAt(x, z);
        return shaftFx(x, g - 0.3, z, radius, 20, 1.4, "#ffad2f", "#ffd56a", 1, 0.45);
      },
    },
    update(dt, camera) {
      /* NOT SNAPPED. The 8m snap was here to stop the wrapped systems
         sliding with sub-metre camera motion - but that sliding was
         the anchor-relative origin, which is now gone, and the cure
         was worse: every eight metres of travel the anchor jumped,
         and with it the whole dust field, the ground height it is
         hung from, and the radius each mote fades on. */
      anchor.copy(camera.position);
      const ground = terrain.heightAt(anchor.x, anchor.z);
      impacts.mat.uniforms.uTime.value = atmos.elapsed;
      impacts.mat.uniforms.uPixel.value = Math.min(2, window.devicePixelRatio || 1) * 2.2;
      tracers.mat.uniforms.uTime.value = atmos.elapsed;
      flashes.mat.uniforms.uTime.value = atmos.elapsed;
      streamers.mat.uniforms.uAnchor.value.copy(anchor);
      streamers.mat.uniforms.uGround.value = ground;
      dust.mat.uniforms.uAnchor.value.set(anchor.x, ground + 14, anchor.z);
      grit.mat.uniforms.uAnchor.value.set(anchor.x, ground + 2.2, anchor.z);

      // Re-aims the outdoor shafts when the sun has actually moved,
      // and no-ops on every other frame.
      if (shafts) shafts.userData.follow();

      const t = atmos.elapsed;
      const step = Math.max(0, Math.min(0.1, dt));
      updateImpulse(step);
      updateOrdnance(step);
      updateRites(step);

      for (const f of flicker) {
        const spec = f.light.userData.spec;
        if (!spec.flicker) continue;
        const n = Math.sin(t * 11.3 + f.phase) * 0.5 + Math.sin(t * 4.1 + f.phase * 1.7) * 0.5;
        f.light.intensity = f.light.userData.baseIntensity * (1 + n * 0.16 * spec.flicker);
      }
    },
    setStorm(v) {
      streamers.mat.uniforms.uOpacity.value = lerp(0.13, 0.62, v);
      dust.mat.uniforms.uOpacity.value = lerp(0.16, 0.70, v);
      grit.mat.uniforms.uOpacity.value = lerp(0.20, 0.80, v);
    },
    setVisible(v) { group.visible = v; },
  };
}
