/* ============================================================
   SAINTFALL - THE DROP

   A deterministic, skippable orbital-insertion cinematic. It owns a
   separate scene so the live basin, enemies, mission timers and player
   can remain fully constructed but completely frozen until landfall.
   Every mesh, shader, particle and camera impulse here is intro-only
   and is disposed after the handoff.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, makeRng, smootherstep, sstep,
} from "saintfall/core.js";

export const DROP_INTRO_DURATION = 23.6;
export const DROP_INTRO_MARKERS = Object.freeze({
  standby: 0,
  release: 1.9,
  orbit: 3.1,
  entry: 5.2,
  turbulence: 10.4,
  cloudBreak: 13.2,
  retroBurn: 16.2,
  impact: 19.05,
  hatch: 20.45,
  handoff: DROP_INTRO_DURATION,
});

const PHASES = [
  [0, "restrained", "RELIQUARY SEALED", "Cohort Seven, hold fast."],
  [1.9, "release", "DROP CLAMPS RELEASED", "Vesper-IX has you now."],
  [3.1, "orbit", "ORBITAL SEPARATION", "The broken halo clears beneath the keel."],
  [5.2, "entry", "ATMOSPHERE CONTACT", "Ablative crown taking the fire."],
  [10.4, "turbulence", "HIGH-G TRANSIT", "Restraints locked. Spine to the throne."],
  [13.2, "cloud-break", "CLOUD DECK BREACHED", "Threshold causeway acquired."],
  [16.2, "retro-burn", "RETRO-BURN", "Six bells lit. Commit to landfall."],
  [19.05, "impact", "CONTACT", "Vesper-IX. The Gilded Silence."],
  [20.45, "hatch", "PRESSURE EQUALISED", "The Pilgrim's Road is yours."],
];

const CUES = [
  [0.02, "sealed"], [1.9, "release"], [3.1, "separation"],
  [5.2, "entry"], [7.1, "hull"], [8.65, "hull"], [10.15, "warning"],
  [11.4, "hull"], [13.2, "comms"], [16.2, "retro"],
  [17.0, "hull"], [17.75, "hull"], [18.5, "hull"],
  [19.05, "impact"], [20.45, "vent"], [21.35, "hull"], [22.05, "hatch"],
];

const SCENE_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform float uAtmos;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float horizon = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 space = mix(vec3(0.003, 0.002, 0.009), vec3(0.028, 0.010, 0.030), horizon);
  float neb = pow(max(0.0, sin(d.x * 5.3 + d.z * 3.1) * 0.5 + 0.5), 5.0)
    * (0.35 + 0.65 * hash31(floor(d * 28.0)));
  space += vec3(0.055, 0.010, 0.042) * neb;
  vec3 cell = floor(d * 920.0);
  float star = step(0.9945, hash31(cell));
  float glint = 0.72 + 0.28 * sin(uTime * 0.7 + hash31(cell + 7.0) * 6.2831);
  space += star * glint * mix(vec3(0.55, 0.72, 1.0), vec3(1.0, 0.72, 0.40), hash31(cell + 2.0));
  vec3 sky = mix(vec3(0.13, 0.055, 0.060), vec3(0.82, 0.34, 0.12), pow(horizon, 0.55));
  sky += vec3(0.20, 0.08, 0.03) * pow(1.0 - horizon, 3.0);
  gl_FragColor = vec4(mix(space, sky, clamp(uAtmos, 0.0, 1.0)), 1.0);
}
`;

const PLANET_VERT = /* glsl */`
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PLANET_FRAG = /* glsl */`
precision highp float;
varying vec3 vNormalW;
varying vec3 vWorld;
uniform vec3 uSun;
uniform float uTime;

float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x),
                 mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x),
                 mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = .5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += n3(p) * a; p = p * 2.03 + 13.7; a *= .5; }
  return s;
}
void main() {
  vec3 N = normalize(vNormalW);
  float land = fbm(N * 5.4 + vec3(0.0, uTime * 0.001, 0.0));
  float scar = smoothstep(0.50, 0.72, fbm(N * 17.0 + 4.0));
  vec3 low = vec3(0.075, 0.018, 0.022);
  vec3 ochre = vec3(0.48, 0.17, 0.055);
  vec3 sand = vec3(0.93, 0.49, 0.18);
  vec3 albedo = mix(low, ochre, smoothstep(0.28, 0.67, land));
  albedo = mix(albedo, sand, scar * 0.38);
  float light = max(0.0, dot(N, normalize(uSun)));
  float rim = pow(1.0 - abs(dot(N, normalize(cameraPosition - vWorld))), 4.0);
  vec3 c = albedo * (0.035 + light * 1.12);
  c += vec3(0.22, 0.055, 0.025) * rim * 0.34;
  gl_FragColor = vec4(c, 1.0);
}
`;

const ATMOS_FRAG = /* glsl */`
precision highp float;
varying vec3 vNormalW;
varying vec3 vWorld;
uniform vec3 uSun;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(0.0, dot(N, V)), 2.8);
  float sun = pow(max(0.0, dot(N, normalize(uSun))), 5.0);
  vec3 c = mix(vec3(0.16, 0.32, 0.55), vec3(1.0, 0.28, 0.055), sun);
  gl_FragColor = vec4(c * fres * 1.8, fres * 0.58);
}
`;

const WINDOW_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const WINDOW_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uHeat;
uniform float uCloud;
uniform float uGround;
uniform float uOpen;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 p = vUv - 0.5;
  float oct = max(abs(p.x) * 0.72 + abs(p.y) * 0.70, max(abs(p.x), abs(p.y) * 1.32));
  float mask = 1.0 - smoothstep(0.38, 0.405, oct);
  if (mask <= 0.001) discard;
  vec3 space = mix(vec3(0.004,0.003,0.012), vec3(0.11,0.018,0.025), vUv.y);
  float star = step(0.988, hash21(floor(vUv * vec2(150.0, 72.0))));
  space += star * vec3(0.72,0.82,1.0);
  float planet = 1.0 - smoothstep(0.52, 0.56, length(vec2(p.x * .86, p.y + .60)));
  space = mix(space, vec3(0.40,0.12,0.045) + vUv.y * vec3(.35,.15,.05), planet);
  float plasma = sin(vUv.y * 44.0 + sin(vUv.x * 17.0 + uTime * 5.0) * 3.0 - uTime * 9.0);
  plasma = pow(max(0.0, plasma * .5 + .5), 3.0) * uHeat;
  vec3 heat = mix(vec3(1.0,.08,.015), vec3(1.0,.76,.24), plasma);
  vec3 c = mix(space, heat, clamp(plasma * 1.35 + uHeat * .26, 0.0, 1.0));
  float clouds = smoothstep(.34, .72, sin(vUv.x * 16.0 + uTime) * .25 + hash21(floor(vUv * 24.0)));
  c = mix(c, vec3(.78,.58,.45), clouds * uCloud * .75);
  float ground = smoothstep(.57, .44, vUv.y + sin(vUv.x * 12.0) * .035);
  c = mix(c, vec3(.29,.12,.055) + vUv.x * vec3(.12,.05,.015), ground * uGround);
  c = mix(c, vec3(1.0,.70,.28), uOpen * .28);
  float scratch = step(.985, hash21(floor(vUv * vec2(240.0, 90.0)) + 4.0));
  c += scratch * vec3(.14,.09,.04);
  gl_FragColor = vec4(c, mask);
}
`;

const PLASMA_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vWorld;
uniform float uTime;
uniform float uHeat;
void main() {
  vec3 p = position + normal * sin(position.y * 4.2 + uTime * 8.0) * .09 * uHeat;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PLASMA_FRAG = /* glsl */`
precision highp float;
varying vec3 vN;
varying vec3 vWorld;
uniform float uTime;
uniform float uHeat;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  float bands = sin(vWorld.y * 4.8 - uTime * 12.0 + vWorld.x * 2.0) * .5 + .5;
  float a = clamp((rim * .72 + bands * .22) * uHeat, 0.0, .82);
  vec3 c = mix(vec3(.08,.62,1.0), vec3(1.0,.15,.015), clamp(uHeat * 1.25 - .14, 0.0, 1.0));
  c = mix(c, vec3(1.0,.92,.48), pow(bands, 5.0));
  gl_FragColor = vec4(c * (1.3 + rim), a);
}
`;

function phaseAt(t) {
  let out = PHASES[0];
  for (const phase of PHASES) {
    if (t >= phase[0]) out = phase;
    else break;
  }
  return out;
}

function range(t, a, b) { return clamp01((t - a) / Math.max(1e-6, b - a)); }
function ease(t, a, b) { return smootherstep(range(t, a, b)); }

function makeSurfaceTexture(THREE, rng, base, accent, scratches = 52) {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i += 1) {
    const alpha = rng.range(0.015, 0.085);
    const v = rng.int(15, 80);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const s = rng.range(0.4, 2.4);
    g.fillRect(rng() * size, rng() * size, s, s);
  }
  g.strokeStyle = accent;
  for (let i = 0; i < scratches; i += 1) {
    g.globalAlpha = rng.range(0.035, 0.16);
    g.lineWidth = rng.range(0.35, 1.2);
    const x = rng() * size;
    const y = rng() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rng.range(-24, 24), y + rng.range(-2, 2));
    g.stroke();
  }
  g.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.anisotropy = 4;
  return texture;
}

function makeSoftParticleTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  const glow = g.createRadialGradient(64, 61, 2, 64, 64, 62);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(.16, "rgba(255,255,255,.92)");
  glow.addColorStop(.48, "rgba(255,255,255,.36)");
  glow.addColorStop(.78, "rgba(255,255,255,.08)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeMaterials(THREE, rng) {
  const ironMap = makeSurfaceTexture(THREE, rng, "#272a30", "rgba(226,190,124,.55)", 78);
  const boneMap = makeSurfaceTexture(THREE, rng, "#8f8269", "rgba(255,244,210,.42)", 34);
  const leatherMap = makeSurfaceTexture(THREE, rng, "#2a1718", "rgba(143,82,65,.5)", 20);
  const standard = (name, options) => {
    const mat = new THREE.MeshStandardMaterial(options);
    mat.name = `drop-${name}`;
    return mat;
  };
  return {
    textures: [ironMap, boneMap, leatherMap],
    iron: standard("iron", { color: 0x3e424b, map: ironMap, metalness: 0.82, roughness: 0.46 }),
    ironDark: standard("iron-dark", { color: 0x111319, map: ironMap, metalness: 0.74, roughness: 0.62 }),
    bone: standard("bone", { color: 0xb9a77f, map: boneMap, metalness: 0.28, roughness: 0.53 }),
    gold: standard("gold", { color: 0xb88428, metalness: 0.88, roughness: 0.31 }),
    bronze: standard("bronze", { color: 0x6f4c2b, metalness: 0.76, roughness: 0.45 }),
    oxblood: standard("oxblood", { color: 0x57151d, metalness: 0.38, roughness: 0.48 }),
    leather: standard("leather", { color: 0x321c1e, map: leatherMap, metalness: 0.04, roughness: 0.84 }),
    heat: standard("heat-shield", { color: 0x151312, metalness: 0.25, roughness: 0.92 }),
    glass: new THREE.MeshPhysicalMaterial({
      name: "drop-glass", color: 0x5a7a82, roughness: 0.12, metalness: 0.05,
      transmission: 0.16, transparent: true, opacity: 0.38, depthWrite: false,
    }),
    amber: standard("amber-signal", {
      color: 0x4d2608, emissive: 0xff8a20, emissiveIntensity: 5.2, roughness: 0.3,
    }),
    red: standard("red-signal", {
      color: 0x260407, emissive: 0xff1d21, emissiveIntensity: 3.5, roughness: 0.34,
    }),
  };
}

function disposeScene(scene, textures) {
  const geometries = new Set();
  const materials = new Set();
  scene.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (Array.isArray(node.material)) node.material.forEach((m) => materials.add(m));
    else if (node.material) materials.add(node.material);
  });
  geometries.forEach((g) => g.dispose?.());
  materials.forEach((m) => m.dispose?.());
  textures.forEach((t) => t.dispose?.());
}

function sceneDiagnostics(scene) {
  let meshes = 0;
  let instanced = 0;
  let triangles = 0;
  let points = 0;
  const materials = new Set();
  const geometries = new Set();
  scene.traverse((node) => {
    if (node.isMesh || node.isInstancedMesh) {
      meshes += 1;
      if (node.isInstancedMesh) instanced += 1;
      if (node.geometry) {
        geometries.add(node.geometry);
        const count = node.geometry.index
          ? node.geometry.index.count : node.geometry.attributes.position?.count || 0;
        triangles += (count / 3) * (node.isInstancedMesh ? node.count : 1);
      }
      if (Array.isArray(node.material)) node.material.forEach((m) => materials.add(m));
      else if (node.material) materials.add(node.material);
    }
    if (node.isPoints) points += node.geometry?.attributes?.position?.count || 0;
  });
  return {
    meshes, instanced, triangles: Math.round(triangles), points,
    geometries: geometries.size, materials: materials.size,
  };
}

function buildIntroScene(ctx, reducedMotion) {
  const { THREE } = ctx;
  const rng = makeRng((ctx.seed ^ 0xd20f7a11) >>> 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.08, 8000);
  const handoffCamera = new THREE.PerspectiveCamera(62, 16 / 9, 0.4, 11000);
  const mats = makeMaterials(THREE, rng);
  const softParticleMap = makeSoftParticleTexture(THREE);
  mats.textures.push(softParticleMap);

  const mesh = (geometry, material, name, parent = scene) => {
    const out = new THREE.Mesh(geometry, material);
    out.name = name;
    out.castShadow = false;
    out.receiveShadow = false;
    parent.add(out);
    return out;
  };

  const starUniforms = { uTime: { value: 0 }, uAtmos: { value: 0 } };
  const starMat = new THREE.ShaderMaterial({
    name: "drop-star-dome", uniforms: starUniforms,
    vertexShader: SCENE_VERT, fragmentShader: STAR_FRAG,
    side: THREE.BackSide, depthWrite: false,
  });
  const starDome = mesh(new THREE.SphereGeometry(2600, 48, 24), starMat, "drop-star-dome");
  starDome.frustumCulled = false;

  scene.add(new THREE.HemisphereLight(0x9bb6e6, 0x180a08, 0.28));
  const key = new THREE.DirectionalLight(0xffd3a0, 3.4);
  key.position.set(220, 180, 100);
  scene.add(key);
  const coldRim = new THREE.DirectionalLight(0x84b7ff, 2.8);
  coldRim.position.set(-120, 40, 80);
  scene.add(coldRim);

  /* ------------------------- Vesper in orbit ------------------------- */
  const space = new THREE.Group();
  space.name = "drop-space-environment";
  scene.add(space);
  const sunDir = new THREE.Vector3(0.62, 0.36, 0.70).normalize();
  const planetUniforms = { uSun: { value: sunDir }, uTime: { value: 0 } };
  const planetMat = new THREE.ShaderMaterial({
    name: "drop-vesper-surface", uniforms: planetUniforms,
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
  });
  const planet = mesh(new THREE.IcosahedronGeometry(720, 6), planetMat, "drop-vesper-ix", space);
  planet.position.set(0, -735, -790);
  const atmosMat = new THREE.ShaderMaterial({
    name: "drop-vesper-atmosphere", uniforms: { uSun: { value: sunDir } },
    vertexShader: PLANET_VERT, fragmentShader: ATMOS_FRAG,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const atmosphere = mesh(new THREE.IcosahedronGeometry(752, 5), atmosMat,
    "drop-vesper-atmosphere", space);
  atmosphere.position.copy(planet.position);

  const halo = new THREE.Group();
  halo.name = "drop-broken-halo";
  halo.position.copy(planet.position);
  halo.rotation.set(0.33, 0.1, 0.54);
  space.add(halo);
  for (let i = 0; i < 4; i += 1) {
    const arc = 0.58 + i * 0.17;
    const ring = mesh(new THREE.TorusGeometry(1000, 4.2 + i * 0.45, 7, 150, arc),
      i % 2 ? mats.gold : mats.iron, `drop-halo-arc-${i}`, halo);
    ring.rotation.z = i * 1.42 + 0.2;
  }
  const fragmentGeo = new THREE.BoxGeometry(7, 2.4, 18);
  const fragments = new THREE.InstancedMesh(fragmentGeo, mats.ironDark, 72);
  fragments.name = "drop-halo-fragments";
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 72; i += 1) {
    const a = rng.range(0, TAU);
    const rad = rng.range(965, 1045);
    dummy.position.set(Math.cos(a) * rad, Math.sin(a) * rad, rng.jit(18));
    dummy.rotation.set(rng.jit(.5), rng.jit(.5), a + rng.jit(.3));
    dummy.scale.set(rng.range(.35, 1.2), rng.range(.35, 1.1), rng.range(.45, 1.5));
    dummy.updateMatrix();
    fragments.setMatrixAt(i, dummy.matrix);
  }
  halo.add(fragments);

  /* ---------------------------- carrier ---------------------------- */
  const carrier = new THREE.Group();
  carrier.name = "drop-carrier";
  carrier.position.set(0, 18, 38);
  carrier.rotation.x = Math.PI / 2;
  space.add(carrier);
  const carrierHull = mesh(new THREE.CylinderGeometry(4.8, 7.4, 42, 8, 3), mats.ironDark,
    "drop-carrier-hull", carrier);
  carrierHull.position.y = 9;
  for (let i = 0; i < 7; i += 1) {
    const rib = mesh(new THREE.TorusGeometry(5.3 + i * .22, .28, 6, 8), mats.bronze,
      `drop-carrier-rib-${i}`, carrier);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = -5 + i * 5;
  }
  for (const side of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(18, .8, 8), mats.iron,
      `drop-carrier-wing-${side}`, carrier);
    wing.position.set(side * 10, 4, 0);
    wing.rotation.z = side * .11;
  }
  for (let i = 0; i < 6; i += 1) {
    const lamp = mesh(new THREE.BoxGeometry(.22, .22, 3.2), mats.amber,
      `drop-carrier-lamp-${i}`, carrier);
    lamp.position.set((i % 2 ? 1 : -1) * 3.9, -7 + Math.floor(i / 2) * 7, -4.3);
  }

  /* ------------------------- reliquary pod ------------------------- */
  const pod = new THREE.Group();
  pod.name = "drop-pod-cinematic-root";
  scene.add(pod);
  const hull = mesh(new THREE.CylinderGeometry(1.76, 2.20, 6.65, 6, 3, false), mats.iron,
    "drop-pod-hull", pod);
  hull.position.y = 0.05;
  const crown = mesh(new THREE.CylinderGeometry(.58, 1.78, 1.16, 6, 1), mats.bone,
    "drop-pod-crown", pod);
  crown.position.y = 3.94;
  const shield = mesh(new THREE.CylinderGeometry(2.14, 2.34, .82, 12, 1), mats.heat,
    "drop-pod-heat-shield", pod);
  shield.position.y = -3.55;
  const collar = mesh(new THREE.TorusGeometry(2.18, .18, 8, 36), mats.gold,
    "drop-pod-gold-collar", pod);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -3.08;

  const airbrakes = [];
  const legs = [];
  const flares = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    const rib = mesh(new THREE.BoxGeometry(.31, 6.05, .52), i % 2 ? mats.bone : mats.bronze,
      `drop-pod-rib-${i}`, pod);
    rib.position.set(Math.sin(a) * 2.02, .05, Math.cos(a) * 2.02);
    rib.rotation.y = a;

    const panel = mesh(new THREE.BoxGeometry(1.45, 3.65, .12),
      i === 0 ? mats.oxblood : mats.ironDark, `drop-pod-panel-${i}`, pod);
    panel.position.set(Math.sin(a) * 1.91, .30, Math.cos(a) * 1.91);
    panel.rotation.y = a;

    const brakePivot = new THREE.Group();
    brakePivot.name = `drop-pod-airbrake-${i}`;
    brakePivot.position.set(Math.sin(a) * 2.0, 1.55, Math.cos(a) * 2.0);
    brakePivot.rotation.y = a;
    const brake = mesh(new THREE.BoxGeometry(1.22, 2.55, .18), mats.iron,
      `drop-pod-airbrake-panel-${i}`, brakePivot);
    brake.position.z = .58;
    pod.add(brakePivot);
    airbrakes.push(brakePivot);

    const legPivot = new THREE.Group();
    legPivot.name = `drop-pod-leg-${i}`;
    legPivot.position.set(Math.sin(a) * 1.82, -2.45, Math.cos(a) * 1.82);
    legPivot.rotation.y = a;
    const strut = mesh(new THREE.BoxGeometry(.24, 2.2, .24), mats.bronze,
      `drop-pod-strut-${i}`, legPivot);
    strut.position.set(0, -1.0, .45);
    strut.rotation.x = -.35;
    const foot = mesh(new THREE.BoxGeometry(1.15, .22, .85), mats.heat,
      `drop-pod-foot-${i}`, legPivot);
    foot.position.set(0, -2.02, .88);
    legPivot.rotation.x = .72;
    pod.add(legPivot);
    legs.push(legPivot);

    const bell = mesh(new THREE.CylinderGeometry(.26, .46, .74, 10), mats.heat,
      `drop-pod-retro-${i}`, pod);
    bell.position.set(Math.sin(a) * 1.34, 3.35, Math.cos(a) * 1.34);
    const flare = mesh(new THREE.ConeGeometry(.43, 3.0, 10, 1, true), mats.amber,
      `drop-pod-flare-${i}`, pod);
    flare.position.set(Math.sin(a) * 1.34, 5.15, Math.cos(a) * 1.34);
    flare.material = flare.material.clone();
    flare.material.transparent = true;
    flare.material.opacity = .74;
    flare.material.blending = THREE.AdditiveBlending;
    flare.material.depthWrite = false;
    flare.visible = false;
    flares.push(flare);
  }

  const hatchPivot = new THREE.Group();
  hatchPivot.name = "drop-pod-hatch-hinge";
  hatchPivot.position.set(0, 2.25, 2.02);
  pod.add(hatchPivot);
  const hatch = mesh(new THREE.BoxGeometry(2.42, 4.25, .24), mats.bone,
    "drop-pod-hatch", hatchPivot);
  hatch.position.y = -2.18;
  const hatchInset = mesh(new THREE.BoxGeometry(1.84, 3.52, .12), mats.oxblood,
    "drop-pod-hatch-inset", hatchPivot);
  hatchInset.position.set(0, -2.18, .18);
  const sigilV = mesh(new THREE.BoxGeometry(.22, 2.15, .11), mats.gold,
    "drop-pod-sigil-v", hatchPivot);
  sigilV.position.set(0, -2.18, .28);
  const sigilH = mesh(new THREE.BoxGeometry(1.38, .22, .11), mats.gold,
    "drop-pod-sigil-h", hatchPivot);
  sigilH.position.set(0, -1.9, .28);

  const boltGeo = new THREE.CylinderGeometry(.11, .11, .16, 8);
  const bolts = new THREE.InstancedMesh(boltGeo, mats.gold, 24);
  bolts.name = "drop-pod-explosive-bolts";
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * TAU;
    dummy.position.set(Math.sin(a) * 2.08, lerp(-2.55, 2.55, (i % 6) / 5), Math.cos(a) * 2.08);
    dummy.rotation.set(Math.PI / 2, a, 0);
    dummy.scale.setScalar(i % 3 === 0 ? 1.25 : .8);
    dummy.updateMatrix();
    bolts.setMatrixAt(i, dummy.matrix);
  }
  pod.add(bolts);

  const plasmaUniforms = { uTime: { value: 0 }, uHeat: { value: 0 } };
  const plasmaMat = new THREE.ShaderMaterial({
    name: "drop-plasma-sheath", uniforms: plasmaUniforms,
    vertexShader: PLASMA_VERT, fragmentShader: PLASMA_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const plasma = mesh(new THREE.IcosahedronGeometry(2.58, 3), plasmaMat,
    "drop-plasma-sheath", pod);
  plasma.scale.set(1.16, 1.82, 1.16);
  plasma.visible = false;
  const shock = mesh(new THREE.ConeGeometry(3.15, 8.5, 32, 1, true), plasmaMat,
    "drop-shock-cone", pod);
  shock.position.y = -6.1;
  shock.rotation.z = Math.PI;
  shock.visible = false;

  /* ---------------------------- interior ---------------------------- */
  const interior = new THREE.Group();
  interior.name = "drop-pod-interior";
  scene.add(interior);
  const cabinShell = mesh(new THREE.CylinderGeometry(3.2, 3.2, 9.2, 10, 1, true), mats.ironDark,
    "drop-cabin-shell", interior);
  cabinShell.rotation.x = Math.PI / 2;
  cabinShell.material = cabinShell.material.clone();
  cabinShell.material.side = THREE.BackSide;
  cabinShell.position.z = .2;
  for (let z = -3.2, i = 0; z <= 3.2; z += 1.6, i += 1) {
    const frame = new THREE.Group();
    frame.name = `drop-cabin-frame-${i}`;
    frame.position.z = z;
    interior.add(frame);
    for (const side of [-1, 1]) {
      const post = mesh(new THREE.BoxGeometry(.25, 4.65, .34), mats.bronze,
        `drop-cabin-post-${i}-${side}`, frame);
      post.position.x = side * 2.72;
      post.rotation.z = -side * .12;
    }
    const top = mesh(new THREE.BoxGeometry(5.28, .25, .34), mats.bronze,
      `drop-cabin-top-${i}`, frame);
    top.position.y = 2.25;
    const floor = mesh(new THREE.BoxGeometry(5.28, .26, .34), mats.heat,
      `drop-cabin-floor-${i}`, frame);
    floor.position.y = -2.08;
  }

  for (const side of [-1, 1]) {
    const console = mesh(new THREE.BoxGeometry(1.15, 2.1, 4.8), mats.iron,
      `drop-cabin-console-${side}`, interior);
    console.position.set(side * 2.45, -.15, -.15);
    console.rotation.z = -side * .10;
    for (let i = 0; i < 7; i += 1) {
      const light = mesh(new THREE.BoxGeometry(.12, .08, .46), i % 3 === 0 ? mats.red : mats.amber,
        `drop-cabin-indicator-${side}-${i}`, interior);
      light.position.set(side * 1.83, 1.42 - i * .38, -2.65 + (i % 2) * .72);
      light.rotation.y = side * .06;
    }
  }

  const windowUniforms = {
    uTime: { value: 0 }, uHeat: { value: 0 }, uCloud: { value: 0 },
    uGround: { value: 0 }, uOpen: { value: 0 },
  };
  const windowMat = new THREE.ShaderMaterial({
    name: "drop-cabin-window", uniforms: windowUniforms,
    vertexShader: WINDOW_VERT, fragmentShader: WINDOW_FRAG,
    transparent: true, depthWrite: false,
  });
  const interiorHatch = new THREE.Group();
  interiorHatch.name = "drop-cabin-hatch-hinge";
  interiorHatch.position.set(0, 2.25, -4.12);
  interior.add(interiorHatch);
  const hatchPlate = mesh(new THREE.BoxGeometry(5.2, 4.55, .22), mats.iron,
    "drop-cabin-hatch", interiorHatch);
  hatchPlate.position.y = -2.26;
  const viewport = mesh(new THREE.PlaneGeometry(3.55, 1.65), windowMat,
    "drop-cabin-viewport", interiorHatch);
  viewport.position.set(0, -1.62, .13);
  const viewportGlass = mesh(new THREE.PlaneGeometry(3.8, 1.86), mats.glass,
    "drop-cabin-viewport-glass", interiorHatch);
  viewportGlass.position.set(0, -1.62, .16);
  const sill = mesh(new THREE.BoxGeometry(4.15, .2, .35), mats.gold,
    "drop-cabin-window-sill", interiorHatch);
  sill.position.set(0, -2.55, .18);

  const seat = mesh(new THREE.BoxGeometry(1.55, 3.7, .72), mats.leather,
    "drop-crash-throne", interior);
  seat.position.set(0, -.15, 3.75);
  const headrest = mesh(new THREE.BoxGeometry(1.9, 1.2, .95), mats.leather,
    "drop-throne-headrest", interior);
  headrest.position.set(0, 1.35, 3.35);
  const restraints = [];
  for (const side of [-1, 1]) {
    const bar = mesh(new THREE.BoxGeometry(.24, 3.45, .18), mats.gold,
      `drop-restraint-${side}`, interior);
    bar.position.set(side * .68, -.05, 1.8);
    bar.rotation.z = side * .32;
    bar.rotation.x = -.12;
    restraints.push(bar);
  }
  const lap = mesh(new THREE.BoxGeometry(1.75, .26, .22), mats.bronze,
    "drop-lap-restraint", interior);
  lap.position.set(0, -1.12, 1.55);
  restraints.push(lap);

  // The foreground armor is enough to make the seat-mounted viewpoint
  // unmistakably embodied without loading a second 64-draw-call hero.
  const armor = new THREE.Group();
  armor.name = "drop-seated-player-silhouette";
  interior.add(armor);
  for (const side of [-1, 1]) {
    const thigh = mesh(new THREE.CylinderGeometry(.38, .48, 1.85, 8), mats.bone,
      `drop-player-thigh-${side}`, armor);
    thigh.position.set(side * .72, -1.35, 1.15);
    thigh.rotation.x = Math.PI / 2.9;
    thigh.rotation.z = side * .08;
    const knee = mesh(new THREE.SphereGeometry(.52, 8, 6), mats.gold,
      `drop-player-knee-${side}`, armor);
    knee.scale.set(1.0, .76, 1.12);
    knee.position.set(side * .75, -1.68, .20);
    const boot = mesh(new THREE.BoxGeometry(.75, .52, 1.35), mats.ironDark,
      `drop-player-boot-${side}`, armor);
    boot.position.set(side * .78, -1.78, -.78);
    boot.rotation.x = -.14;
  }

  const cabinRed = new THREE.PointLight(0xff2d20, 2.8, 12, 2);
  cabinRed.name = "drop-cabin-red-practical";
  cabinRed.position.set(-1.6, 1.5, 1.2);
  interior.add(cabinRed);
  const cabinAmber = new THREE.PointLight(0xffa52b, 3.5, 14, 2);
  cabinAmber.name = "drop-cabin-amber-practical";
  cabinAmber.position.set(1.2, 1.7, -1.6);
  interior.add(cabinAmber);

  /* -------------------------- atmosphere/ground -------------------------- */
  const groundEnv = new THREE.Group();
  groundEnv.name = "drop-landing-environment";
  groundEnv.visible = false;
  scene.add(groundEnv);
  const groundGeo = new THREE.PlaneGeometry(520, 520, 76, 76);
  const gp = groundGeo.attributes.position;
  const colors = new Float32Array(gp.count * 3);
  const c1 = new THREE.Color(0x5e2815);
  const c2 = new THREE.Color(0xc16a2a);
  for (let i = 0; i < gp.count; i += 1) {
    const x = gp.getX(i);
    const y = gp.getY(i);
    const h = Math.sin(x * .032 + Math.sin(y * .013) * 1.8) * 2.6
      + Math.sin(y * .047) * 1.1 + rng.jit(.18);
    gp.setZ(i, h);
    const cc = c1.clone().lerp(c2, clamp01(.36 + h * .055 + rng.jit(.07)));
    colors[i * 3] = cc.r; colors[i * 3 + 1] = cc.g; colors[i * 3 + 2] = cc.b;
  }
  groundGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({
    name: "drop-vesper-ground", vertexColors: true, roughness: .96, metalness: .02,
  });
  const ground = mesh(groundGeo, groundMat, "drop-threshold-ground", groundEnv);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -4.2;
  const road = mesh(new THREE.PlaneGeometry(18, 420, 1, 16), mats.heat,
    "drop-pilgrims-road", groundEnv);
  road.rotation.x = -Math.PI / 2;
  road.position.set(8, -4.02, -72);
  road.rotation.z = -.035;

  const padMat = new THREE.MeshStandardMaterial({
    name: "drop-landing-pad", color: 0x21191a, metalness: .22, roughness: .88,
  });
  const landingPad = mesh(new THREE.CircleGeometry(13.5, 64), padMat,
    "drop-landing-pad", groundEnv);
  landingPad.rotation.x = -Math.PI / 2;
  landingPad.position.y = -3.98;
  const padRing = mesh(new THREE.TorusGeometry(8.8, .095, 6, 72), mats.gold,
    "drop-landing-pad-ring", groundEnv);
  padRing.rotation.x = Math.PI / 2;
  padRing.position.y = -3.91;

  const roadMarkGeo = new THREE.BoxGeometry(.22, .045, 4.8);
  const roadMarks = new THREE.InstancedMesh(roadMarkGeo, mats.gold, 30);
  roadMarks.name = "drop-road-reliquary-marks";
  for (let i = 0; i < 30; i += 1) {
    dummy.position.set(8, -3.91, 88 - i * 9.8);
    dummy.rotation.set(0, -.035, 0);
    dummy.scale.set(1, 1, i % 5 === 0 ? 1.75 : .62);
    dummy.updateMatrix();
    roadMarks.setMatrixAt(i, dummy.matrix);
  }
  groundEnv.add(roadMarks);
  for (const side of [-1, 1]) {
    const pylon = new THREE.Group();
    pylon.name = `drop-threshold-pylon-${side}`;
    pylon.position.set(side * 24, -3.1, -48);
    groundEnv.add(pylon);
    const base = mesh(new THREE.BoxGeometry(9, 2.2, 9), mats.heat,
      `drop-pylon-base-${side}`, pylon);
    base.position.y = 1.1;
    const shaft = mesh(new THREE.CylinderGeometry(3.3, 4.2, 22, 8), mats.bone,
      `drop-pylon-shaft-${side}`, pylon);
    shaft.position.y = 13;
    const cap = mesh(new THREE.BoxGeometry(8.2, 2.0, 8.2), mats.gold,
      `drop-pylon-cap-${side}`, pylon);
    cap.position.y = 24.4;
  }

  // Threshold's far silhouette gives the open hatch a destination:
  // the Vault-Cathedral and Saintfall's shattered orbital reliquary.
  const cathedral = new THREE.Group();
  cathedral.name = "drop-vault-cathedral-silhouette";
  cathedral.position.set(0, -3.95, -184);
  groundEnv.add(cathedral);
  const nave = mesh(new THREE.BoxGeometry(62, 26, 30), mats.ironDark,
    "drop-cathedral-nave", cathedral);
  nave.position.y = 13;
  const tower = mesh(new THREE.BoxGeometry(20, 58, 23), mats.iron,
    "drop-cathedral-tower", cathedral);
  tower.position.set(0, 29, 2);
  for (const side of [-1, 1]) {
    const transept = mesh(new THREE.BoxGeometry(17, 35, 18), mats.ironDark,
      `drop-cathedral-transept-${side}`, cathedral);
    transept.position.set(side * 28, 18, 0);
    const spire = mesh(new THREE.ConeGeometry(6.5, 29, 6), mats.bone,
      `drop-cathedral-spire-${side}`, cathedral);
    spire.position.set(side * 28, 49, 0);
  }
  const highSpire = mesh(new THREE.ConeGeometry(8.3, 38, 6), mats.bone,
    "drop-cathedral-high-spire", cathedral);
  highSpire.position.set(0, 77, 2);
  const rose = mesh(new THREE.CircleGeometry(4.6, 28), mats.amber,
    "drop-cathedral-rose", cathedral);
  rose.position.set(0, 38, 13.55);

  const groundHalo = new THREE.Group();
  groundHalo.name = "drop-ground-broken-halo";
  groundHalo.position.set(0, 104, -295);
  groundHalo.rotation.z = -.22;
  groundEnv.add(groundHalo);
  for (let i = 0; i < 3; i += 1) {
    const arc = mesh(new THREE.TorusGeometry(102, 1.0 + i * .18, 6, 120, .83 + i * .12),
      i === 1 ? mats.gold : mats.bone, `drop-ground-halo-arc-${i}`, groundHalo);
    arc.rotation.z = i * 1.92 + .25;
  }

  // A deliberately light doorway plate. Rendering the complete
  // landing scene behind the complete cabin doubled draw calls during
  // the hatch beat; this keeps only the road, far architecture and
  // halo needed through the narrow opening. The following match-cut
  // still reveals the real, fully authored basin.
  const hatchBackdrop = new THREE.Group();
  hatchBackdrop.name = "drop-hatch-doorway-backdrop";
  hatchBackdrop.visible = false;
  scene.add(hatchBackdrop);
  const hatchGroundMat = new THREE.MeshStandardMaterial({
    name: "drop-hatch-ground", color: 0x6a2d18, roughness: .97, metalness: .01,
  });
  const hatchGround = mesh(new THREE.PlaneGeometry(180, 260), hatchGroundMat,
    "drop-hatch-ground", hatchBackdrop);
  hatchGround.rotation.x = -Math.PI / 2;
  hatchGround.position.set(0, -2.15, -88);
  const hatchRoad = mesh(new THREE.PlaneGeometry(17, 250), mats.heat,
    "drop-hatch-road", hatchBackdrop);
  hatchRoad.rotation.x = -Math.PI / 2;
  hatchRoad.position.set(0, -2.11, -91);
  const hatchCathedral = cathedral.clone(true);
  hatchCathedral.name = "drop-hatch-cathedral";
  hatchCathedral.position.set(0, -2.1, -173);
  hatchBackdrop.add(hatchCathedral);
  const hatchHalo = groundHalo.clone(true);
  hatchHalo.name = "drop-hatch-halo";
  hatchHalo.position.set(0, 104, -295);
  hatchBackdrop.add(hatchHalo);
  for (let i = 0; i < 26; i += 1) {
    const hill = mesh(new THREE.DodecahedronGeometry(rng.range(7, 18), 0), mats.heat,
      `drop-horizon-rock-${i}`, groundEnv);
    const a = rng.range(0, TAU);
    const r = rng.range(115, 235);
    hill.position.set(Math.cos(a) * r, rng.range(0, 11), Math.sin(a) * r - 55);
    hill.scale.set(rng.range(1.2, 3.2), rng.range(1.0, 4.2), rng.range(1.2, 3.1));
    hill.rotation.set(rng.jit(.3), rng.range(0, TAU), rng.jit(.2));
  }

  const cloudCount = reducedMotion ? 36 : 100;
  const cloudPos = new Float32Array(cloudCount * 3);
  for (let i = 0; i < cloudCount; i += 1) {
    cloudPos[i * 3] = rng.range(-120, 120);
    cloudPos[i * 3 + 1] = rng.range(14, 86);
    cloudPos[i * 3 + 2] = rng.range(-150, 90);
  }
  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute("position", new THREE.BufferAttribute(cloudPos, 3));
  const cloudMat = new THREE.PointsMaterial({
    name: "drop-cloud-wisps", color: 0xe3b6a0, size: reducedMotion ? 11 : 18,
    transparent: true, opacity: .16, depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true, map: softParticleMap, alphaTest: .008,
  });
  const clouds = new THREE.Points(cloudGeo, cloudMat);
  clouds.name = "drop-cloud-deck";
  groundEnv.add(clouds);

  const entryCount = reducedMotion ? 54 : 210;
  const entryBase = new Float32Array(entryCount * 4);
  const entryPos = new Float32Array(entryCount * 3);
  for (let i = 0; i < entryCount; i += 1) {
    entryBase[i * 4] = rng.range(-8, 8);
    entryBase[i * 4 + 1] = rng.range(-18, 18);
    entryBase[i * 4 + 2] = rng.range(-8, 8);
    entryBase[i * 4 + 3] = rng.range(.5, 1.8);
  }
  const entryGeo = new THREE.BufferGeometry();
  entryGeo.setAttribute("position", new THREE.BufferAttribute(entryPos, 3));
  const entryMat = new THREE.PointsMaterial({
    name: "drop-entry-streaks", color: 0xff6b25, size: .17,
    transparent: true, opacity: .86, depthWrite: false, blending: THREE.AdditiveBlending,
    map: softParticleMap, alphaTest: .02,
  });
  const entryStreaks = new THREE.Points(entryGeo, entryMat);
  entryStreaks.name = "drop-entry-streaks";
  entryStreaks.visible = false;
  scene.add(entryStreaks);

  const dustCount = reducedMotion ? 60 : 230;
  const dustBase = new Float32Array(dustCount * 4);
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustBase[i * 4] = rng.range(0, TAU);
    dustBase[i * 4 + 1] = rng.range(3, 58);
    dustBase[i * 4 + 2] = rng.range(.2, 6.2);
    dustBase[i * 4 + 3] = rng.range(.5, 1.5);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    name: "drop-impact-dust", color: 0xe78a43, size: .72,
    transparent: true, opacity: .72, depthWrite: false,
    map: softParticleMap, alphaTest: .008,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = "drop-impact-dust";
  dust.visible = false;
  groundEnv.add(dust);

  const smokeCount = reducedMotion ? 18 : 52;
  const smokeBase = new Float32Array(smokeCount * 4);
  const smokePos = new Float32Array(smokeCount * 3);
  for (let i = 0; i < smokeCount; i += 1) {
    smokeBase[i * 4] = rng.range(0, TAU);
    smokeBase[i * 4 + 1] = rng.range(1.8, 7.5);
    smokeBase[i * 4 + 2] = rng.range(0, 1);
    smokeBase[i * 4 + 3] = rng.range(.65, 1.5);
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
  const smokeMat = new THREE.PointsMaterial({
    name: "drop-impact-smoke", color: 0x8f6556, size: reducedMotion ? 2.4 : 3.7,
    transparent: true, opacity: .32, depthWrite: false, map: softParticleMap,
    alphaTest: .006, blending: THREE.NormalBlending,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.name = "drop-impact-smoke";
  smoke.visible = false;
  groundEnv.add(smoke);
  const shockRings = [];
  for (let i = 0; i < 3; i += 1) {
    const ring = mesh(new THREE.TorusGeometry(1, .09, 6, 72), mats.amber,
      `drop-impact-ring-${i}`, groundEnv);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -2.0 + i * .05;
    ring.visible = false;
    ring.material = ring.material.clone();
    ring.material.transparent = true;
    ring.material.depthWrite = false;
    shockRings.push(ring);
  }

  const diagnostics = sceneDiagnostics(scene);
  return {
    scene, camera, handoffCamera, mats, diagnostics, starUniforms, planetUniforms,
    space, planet, atmosphere, halo, carrier, pod, hull, hatchPivot,
    airbrakes, legs, flares, plasma, shock, plasmaUniforms,
    interior, interiorHatch, viewport, windowUniforms, restraints,
    cabinRed, cabinAmber, groundEnv, hatchBackdrop, ground, road, clouds,
    entryStreaks, entryBase, entryPos, dust, dustBase, dustPos,
    smoke, smokeBase, smokePos, shockRings,
  };
}

function buildMarkup(host) {
  host.innerHTML = `
    <div class="sf-intro__letterbox sf-intro__letterbox--top"></div>
    <div class="sf-intro__letterbox sf-intro__letterbox--bottom"></div>
    <div class="sf-intro__scan" aria-hidden="true"></div>
    <div class="sf-intro__heat" aria-hidden="true"></div>
    <div class="sf-intro__flash" aria-hidden="true"></div>
    <div class="sf-intro__telemetry" aria-hidden="true">
      <div class="sf-intro__eyebrow"><span>DROP-ALTAR VII</span><b data-intro-signal>LINK // GREEN</b></div>
      <div class="sf-intro__rule"></div>
      <div class="sf-intro__numbers">
        <span>ALTITUDE <b data-intro-alt>120.0 KM</b></span>
        <span>VELOCITY <b data-intro-vel>0 M/S</b></span>
        <span>ABLATIVE <b data-intro-heat>04%</b></span>
      </div>
      <div class="sf-intro__heatbar"><i data-intro-heatbar></i></div>
    </div>
    <div class="sf-intro__chapter">
      <small data-intro-phase>ORBITAL INSERTION</small>
      <strong data-intro-title>THE DROP</strong>
      <span data-intro-caption>Operation The Gilded Silence</span>
    </div>
    <div class="sf-intro__gate">
      <div class="sf-intro__crest" aria-hidden="true"><i></i><b></b><em></em></div>
      <small>CONCORD RELIQUARY // COHORT VII</small>
      <h2>THE DROP</h2>
      <p>Vesper-IX · Threshold Causeway · Operation The Gilded Silence</p>
      <button type="button" data-intro-start><span>Commit to landfall</span><b>ENTER / TAP</b></button>
      <span class="sf-intro__sound">Sound begins with deployment</span>
    </div>
    <button class="sf-intro__skip" type="button" data-intro-skip disabled>Skip descent <span>↗</span></button>
    <div class="sf-intro__pause" aria-live="polite">DESCENT HELD</div>
  `;
}

export function buildDropIntro(ctx, options = {}) {
  const enabled = options.enabled !== false;
  const host = options.host;
  if (!enabled || !host) {
    return {
      enabled: false, done: true, scene: null, camera: null,
      isBlocking: () => false, update() {}, resize() {}, skip() {}, seek() {},
      advance() {}, start: async () => false, reveal: () => false, dispose() {},
      markers: () => ({ ...DROP_INTRO_MARKERS }),
      status: () => ({ enabled: false, completed: true, phase: "disabled" }),
    };
  }

  const reducedMotion = options.reducedMotion ?? window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const manualClock = !!options.manualClock;
  /* Reduced motion keeps the authored pacing instead of compressing the
     same camera travel into a faster edit. It removes shake, scan/flash
     animation and most particles below; Skip remains immediately available. */
  const duration = DROP_INTRO_DURATION;
  const timeScale = DROP_INTRO_DURATION / duration;
  let built = buildIntroScene(ctx, !!reducedMotion);
  const { THREE } = ctx;
  const stage = options.stage;
  const audio = options.audio;
  const render = options.render;
  const onComplete = options.onComplete || (() => {});
  buildMarkup(host);

  const el = (selector) => host.querySelector(selector);
  const startButton = el("[data-intro-start]");
  const skipButton = el("[data-intro-skip]");
  const phaseEl = el("[data-intro-phase]");
  const titleEl = el("[data-intro-title]");
  const captionEl = el("[data-intro-caption]");
  const altitudeEl = el("[data-intro-alt]");
  const velocityEl = el("[data-intro-vel]");
  const heatEl = el("[data-intro-heat]");
  const heatbarEl = el("[data-intro-heatbar]");
  const signalEl = el("[data-intro-signal]");

  const state = {
    enabled: true,
    mode: "awaiting-gesture",
    started: false,
    completed: false,
    skipped: false,
    paused: false,
    disposed: false,
    revealed: false,
    startToken: 0,
    elapsed: 0,
    canonical: 0,
    duration,
    reducedMotion: !!reducedMotion,
    manualClock,
    phase: "restrained",
    shot: "cabin",
    altitude: 120000,
    velocity: 0,
    heat: .04,
    turbulence: 0,
    retro: 0,
    hatch: 0,
    handoffCount: 0,
    impactCount: 0,
    cueIndex: 0,
    idle: 0,
  };

  const camTarget = new THREE.Vector3();
  const setCamera = (x, y, z, tx, ty, tz, fov, roll = 0) => {
    const scale = state.reducedMotion ? .16 : 1;
    const shake = state.turbulence * scale;
    const sx = Math.sin(state.canonical * 31.1) * shake * .055
      + Math.sin(state.canonical * 13.7 + 1.3) * shake * .025;
    const sy = Math.sin(state.canonical * 26.3 + .8) * shake * .045;
    const sz = Math.sin(state.canonical * 19.9 + 2.2) * shake * .035;
    built.camera.position.set(x + sx, y + sy, z + sz);
    camTarget.set(tx, ty, tz);
    built.camera.lookAt(camTarget);
    built.camera.rotateZ(roll * (state.reducedMotion ? .18 : 1)
      + Math.sin(state.canonical * 17.3) * shake * .0025);
    if (Math.abs(built.camera.fov - fov) > 1e-4) {
      built.camera.fov = fov;
      built.camera.updateProjectionMatrix();
    }
  };

  function metricsAt(t) {
    let altitude = 120000;
    let velocity = 0;
    let heat = .04;
    if (t < 1.9) velocity = lerp(0, 42, ease(t, 0, 1.9));
    else if (t < 5.2) {
      altitude = lerp(120000, 97000, ease(t, 1.9, 5.2));
      velocity = lerp(120, 7180, ease(t, 1.9, 5.2));
      heat = lerp(.04, .18, ease(t, 3.1, 5.2));
    } else if (t < 10.4) {
      altitude = lerp(97000, 17000, ease(t, 5.2, 10.4));
      velocity = lerp(7180, 4620, ease(t, 5.2, 10.4));
      heat = lerp(.28, .97, Math.sin(range(t, 5.2, 10.4) * Math.PI * .76));
    } else if (t < 13.2) {
      altitude = lerp(17000, 3600, ease(t, 10.4, 13.2));
      velocity = lerp(4620, 1180, ease(t, 10.4, 13.2));
      heat = lerp(.94, .52, ease(t, 10.4, 13.2));
    } else if (t < 16.2) {
      altitude = lerp(3600, 740, ease(t, 13.2, 16.2));
      velocity = lerp(1180, 310, ease(t, 13.2, 16.2));
      heat = lerp(.50, .18, ease(t, 13.2, 16.2));
    } else if (t < 19.05) {
      altitude = lerp(740, 0, ease(t, 16.2, 19.05));
      velocity = lerp(310, 0, ease(t, 16.2, 19.05));
      heat = lerp(.18, .08, ease(t, 16.2, 19.05));
    } else {
      altitude = 0; velocity = 0; heat = lerp(.08, .02, ease(t, 19.05, 23.6));
    }
    return { altitude, velocity, heat };
  }

  function updateEntryParticles(t) {
    const attr = built.entryStreaks.geometry.attributes.position;
    for (let i = 0; i < attr.count; i += 1) {
      const k = i * 4;
      const speed = built.entryBase[k + 3];
      const travel = ((built.entryBase[k + 1] + t * speed * 19 + 36) % 36) - 18;
      built.entryPos[i * 3] = built.pod.position.x + built.entryBase[k] + Math.sin(t * 3 + i) * .28;
      built.entryPos[i * 3 + 1] = built.pod.position.y + travel;
      built.entryPos[i * 3 + 2] = built.pod.position.z + built.entryBase[k + 2];
    }
    attr.needsUpdate = true;
  }

  function updateDust(t) {
    const p = ease(t, 18.78, 20.6);
    const attr = built.dust.geometry.attributes.position;
    for (let i = 0; i < attr.count; i += 1) {
      const k = i * 4;
      const angle = built.dustBase[k];
      const radius = built.dustBase[k + 1] * p;
      const lift = built.dustBase[k + 2] * Math.sin(p * Math.PI) * built.dustBase[k + 3];
      built.dustPos[i * 3] = Math.cos(angle) * radius;
      built.dustPos[i * 3 + 1] = -1.9 + lift;
      built.dustPos[i * 3 + 2] = Math.sin(angle) * radius;
    }
    attr.needsUpdate = true;
    built.dust.material.opacity = (1 - ease(t, 20.15, 22.7)) * .78;
    built.dust.visible = p > .001 && t < 22.9;

    const smokeAge = Math.max(0, t - 19.05);
    const smokeAttr = built.smoke.geometry.attributes.position;
    for (let i = 0; i < smokeAttr.count; i += 1) {
      const k = i * 4;
      const age = (smokeAge * built.smokeBase[k + 3] + built.smokeBase[k + 2] * 1.7) % 4.6;
      const spread = built.smokeBase[k + 1] + age * 1.15;
      const angle = built.smokeBase[k] + age * .11;
      built.smokePos[i * 3] = Math.cos(angle) * spread;
      built.smokePos[i * 3 + 1] = -3.35 + age * 2.45;
      built.smokePos[i * 3 + 2] = Math.sin(angle) * spread;
    }
    smokeAttr.needsUpdate = true;
    built.smoke.visible = t >= 19.05 && t < 23.6;
    built.smoke.material.opacity = (1 - ease(t, 22.35, 23.6)) * .34;

    built.shockRings.forEach((ring, i) => {
      const startsAt = 19.05 + i * .08;
      const rp = ease(t, startsAt, 19.85 + i * .18);
      ring.visible = t >= startsAt && rp < 1;
      ring.scale.setScalar(1 + rp * (18 + i * 7));
      ring.material.opacity = (1 - rp) * .55;
    });
  }

  function showMode(mode) {
    built.interior.visible = mode === "cabin";
    built.pod.visible = mode === "space" || mode === "ground";
    built.space.visible = mode === "space";
    built.groundEnv.visible = mode === "ground";
    built.hatchBackdrop.visible = mode === "cabin" && state.canonical >= 20.45;
    state.shot = mode;
  }

  function applyTimeline(t, emitAudio = false) {
    const previous = state.canonical;
    state.canonical = clamp(t, 0, DROP_INTRO_DURATION);
    const m = metricsAt(state.canonical);
    state.altitude = m.altitude;
    state.velocity = m.velocity;
    state.heat = m.heat;
    state.turbulence = state.reducedMotion ? 0
      : Math.max(sstep(5.8, 7.2, t) * (1 - sstep(12.0, 13.2, t)),
        sstep(18.75, 19.03, t) * (1 - sstep(19.55, 20.1, t)) * 1.35);
    state.retro = sstep(16.2, 16.65, t) * (1 - sstep(19.0, 19.3, t));
    state.hatch = ease(t, 20.9, 22.45);

    const phase = phaseAt(t);
    state.phase = phase[1];
    phaseEl.textContent = phase[2];
    captionEl.textContent = phase[3];
    titleEl.textContent = state.phase === "impact" ? "LANDFALL" : "THE DROP";
    altitudeEl.textContent = state.altitude >= 1000
      ? `${(state.altitude / 1000).toFixed(state.altitude >= 10000 ? 1 : 2)} KM`
      : `${Math.max(0, Math.round(state.altitude))} M`;
    velocityEl.textContent = `${Math.max(0, Math.round(state.velocity)).toLocaleString()} M/S`;
    heatEl.textContent = `${Math.round(state.heat * 100).toString().padStart(2, "0")}%`;
    heatbarEl.style.transform = `scaleX(${clamp01(state.heat)})`;
    signalEl.textContent = state.heat > .82 ? "ABLATIVE // CRITICAL"
      : state.retro > .2 ? "RETROS // SIX GREEN"
        : state.altitude < 1 ? "CONTACT // SECURE" : "LINK // GREEN";

    built.starUniforms.uTime.value = t;
    built.planetUniforms.uTime.value = t;
    built.plasmaUniforms.uTime.value = t;
    built.plasmaUniforms.uHeat.value = clamp01(state.heat * 1.3 - .12);
    built.windowUniforms.uTime.value = t;
    built.windowUniforms.uHeat.value = clamp01(state.heat * 1.25 - .12);
    built.windowUniforms.uCloud.value = sstep(11.7, 13.2, t) * (1 - sstep(14.2, 15.2, t));
    built.windowUniforms.uGround.value = sstep(15.0, 18.4, t);
    built.windowUniforms.uOpen.value = state.hatch;

    const atmosphere = sstep(11.5, 15.5, t);
    built.starUniforms.uAtmos.value = atmosphere;
    built.plasma.visible = t >= 5.2 && t < 13.4;
    built.shock.visible = t >= 6.0 && t < 12.9;
    built.entryStreaks.visible = t >= 5.15 && t < 13.35;
    if (built.entryStreaks.visible) updateEntryParticles(t);
    built.carrier.visible = t < 5.45;
    built.planet.rotation.y = t * .004;
    built.halo.rotation.z = .54 + t * .002;

    if (t < 1.9) {
      showMode("cabin");
      const p = ease(t, 0, 1.9);
      setCamera(.03, .18, 3.86 - p * .16, 0, -.05, -3.9, 48);
      built.cabinAmber.intensity = 2.8 + Math.sin(t * 2.3) * .35;
      built.cabinRed.intensity = .3 + p * 1.1;
      built.restraints.forEach((r, i) => { r.position.z = 1.8 - p * .12 - i * .01; });
    } else if (t < 5.2) {
      showMode("space");
      const p = ease(t, 1.9, 5.2);
      built.pod.position.set(0, -p * 15, -p * 7);
      built.pod.rotation.set(-.08 - p * .13, .14 + p * .22, .04 - p * .08);
      setCamera(11 - p * 4.2, 5.2 + p * 1.4, 16 - p * 2.5,
        0, -5 - p * 7, -4 - p * 5, lerp(48, 43, p), -.03 * p);
    } else if (t < 10.4) {
      showMode("space");
      const p = ease(t, 5.2, 10.4);
      built.pod.position.set(0, -16 - p * 58, -8 - p * 26);
      built.pod.rotation.set(-.24 - p * .35, .36 + Math.sin(t * .4) * .13, -.05 - p * .28);
      setCamera(8.8 - p * 2.4, -7 - p * 44, 10.5 - p * 9,
        0, -18 - p * 52, -10 - p * 25, lerp(51, 67, p), -.18 * p);
    } else if (t < 13.2) {
      showMode("cabin");
      const p = ease(t, 10.4, 13.2);
      setCamera(.02, .12, 3.72 - p * .28, 0, -.08, -4.0, lerp(51, 56, p), -.018);
      built.cabinRed.intensity = 3.8 + Math.sin(t * 12.0) * .65;
      built.cabinAmber.intensity = 1.2;
    } else if (t < 19.05) {
      showMode("ground");
      const p = ease(t, 13.2, 19.05);
      const brake = ease(t, 16.0, 17.1);
      const y = lerp(72, 0, p);
      built.pod.position.set(0, y, 0);
      built.pod.rotation.set(lerp(-.68, 0, ease(t, 13.2, 16.6)),
        lerp(.42, -.12, p), lerp(-.28, 0, p));
      built.airbrakes.forEach((b, i) => {
        b.rotation.x = -brake * (.72 + (i % 2) * .07);
      });
      built.legs.forEach((leg, i) => {
        leg.rotation.x = lerp(.72, .08, ease(t, 16.35 + i * .055, 17.1 + i * .055));
      });
      built.flares.forEach((flare, i) => {
        flare.visible = state.retro > .01;
        flare.scale.set(1, state.retro * (1.1 + .14 * Math.sin(t * 19 + i)), 1);
        flare.material.opacity = .48 + state.retro * .34;
      });
      if (t < 16.2) {
        setCamera(15 - p * 5, 58 - p * 23, 26 - p * 10,
          0, y - 5, -2, lerp(58, 52, p), -.08 * (1 - p));
      } else {
        const lp = ease(t, 16.2, 19.05);
        setCamera(17 - lp * 5, 12 - lp * 6, 24 - lp * 7,
          0, Math.max(1, y), 0, lerp(48, 42, lp), 0);
      }
      built.clouds.position.y = -p * 42;
    } else if (t < 19.55) {
      showMode("ground");
      const p = ease(t, 19.05, 19.55);
      const rebound = Math.sin(p * Math.PI) * (1 - p) * .38;
      built.pod.position.set(0, rebound, 0);
      built.pod.rotation.set(Math.sin(p * Math.PI * 2) * .018, -.12, -.012 * (1 - p));
      built.flares.forEach((flare) => { flare.visible = false; });
      setCamera(12.2, 6.1 - Math.sin(p * Math.PI) * .18, 17.4,
        0, 1.15 + rebound, 0, 42, Math.sin(p * Math.PI * 2) * .006);
    } else if (t < 20.45) {
      showMode("cabin");
      const p = ease(t, 19.55, 20.45);
      setCamera(0, .18 - Math.sin(p * Math.PI) * .23, 3.72,
        0, -.14, -4.05, 52, Math.sin(p * Math.PI * 2) * .012);
      built.cabinRed.intensity = lerp(4.3, .6, p);
      built.cabinAmber.intensity = lerp(1.0, 3.8, p);
    } else {
      showMode("cabin");
      const p = ease(t, 20.45, 23.6);
      built.interiorHatch.rotation.x = -state.hatch * 1.48;
      setCamera(0, lerp(.16, -.25, p), lerp(3.72, -1.12, p),
        0, lerp(-.12, -.62, p), -5.8, lerp(52, 59, p), 0);
      built.cabinRed.intensity = .12;
      built.cabinAmber.intensity = lerp(3.6, 5.8, p);

      if (t >= 22.35) {
        /* Match the already-prewarmed gameplay camera exactly. A
           separately approximated boom was a metre lower than the
           player's real chase rig, so the last cinematic frame and
           first playable frame could never form a true match cut. */
        const liveCamera = render.camera;
        built.handoffCamera.position.copy(liveCamera.position);
        built.handoffCamera.quaternion.copy(liveCamera.quaternion);
        built.handoffCamera.fov = liveCamera.fov;
        built.handoffCamera.near = liveCamera.near;
        built.handoffCamera.far = liveCamera.far;
        built.handoffCamera.aspect = liveCamera.aspect;
        built.handoffCamera.updateProjectionMatrix();
        state.shot = "handoff";
      }
    }

    // The impact pool continues while the edit cuts back inside. It
    // remains deterministic, and the final hatch view finds already
    // settling dust instead of restarting the landing effect.
    updateDust(t);

    host.style.setProperty("--sf-intro-heat", state.heat.toFixed(3));
    host.style.setProperty("--sf-intro-shake", (state.turbulence * (state.reducedMotion ? 0 : 1)).toFixed(3));
    host.dataset.phase = state.phase;
    host.dataset.shot = state.shot;

    if (emitAudio && t >= previous) {
      while (state.cueIndex < CUES.length && CUES[state.cueIndex][0] <= t) {
        const [at, cue] = CUES[state.cueIndex];
        if (at > previous + 1e-5 || previous <= .001) {
          audio?.dropCue?.(cue);
          if (cue === "impact") state.impactCount += 1;
        }
        state.cueIndex += 1;
      }
    }
    audio?.updateDrop?.({
      heat: state.heat,
      turbulence: state.turbulence,
      retro: state.retro,
      altitude: clamp01(state.altitude / 120000),
      velocity: clamp01(state.velocity / 7800),
      paused: state.paused,
    });
  }

  function renderFrame() {
    if (!built || state.disposed) return false;
    if (state.shot === "handoff") {
      ctx.terrain.updateLod?.(built.handoffCamera);
      // Zero-delta presentation updates perform the same distance/LOD
      // culling as gameplay without advancing AI, mission or combat.
      ctx.enemies.update?.(0, built.handoffCamera);
      ctx.sky.update?.(0, built.handoffCamera);
      render.render(built.handoffCamera, ctx.scene);
    } else {
      render.render(built.camera, built.scene);
    }
    return true;
  }

  async function start() {
    if (state.mode !== "awaiting-gesture" || !state.revealed || state.disposed
      || document.hidden || document.body.classList.contains("rb-escape-menu-open")) return false;
    state.mode = "starting";
    const token = ++state.startToken;
    startButton.disabled = true;
    try { await audio?.unlock?.({ ambience: false }); } catch (_) { /* visual path still starts */ }
    if (token !== state.startToken || state.disposed || state.completed) return false;
    try { await audio?.beginDrop?.(); } catch (_) { /* visual path still starts */ }
    if (token !== state.startToken || state.disposed || state.completed) return false;
    state.mode = "running";
    state.started = true;
    if (ctx.runtime) ctx.runtime.phase = "intro";
    state.elapsed = 0;
    state.canonical = 0;
    state.cueIndex = 0;
    host.classList.add("is-running");
    host.setAttribute("aria-hidden", "false");
    skipButton.disabled = false;
    applyTimeline(0, true);
    setPaused(document.hidden, "visibility");
    setPaused(document.body.classList.contains("rb-escape-menu-open"), "menu");
    return true;
  }

  function complete(skipped = false) {
    if (state.completed) return false;
    state.completed = true;
    state.skipped = !!skipped;
    state.mode = skipped ? "skipped" : "complete";
    state.paused = false;
    state.startToken += 1;
    pauseTransition += 1;
    state.handoffCount += 1;
    state.hatch = 1;
    audio?.endDrop?.({ handoff: true });
    host.classList.remove("is-running", "is-paused");
    host.classList.add("is-finished");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
    skipButton.disabled = true;
    stage?.classList.remove("sf-intro-active");
    onComplete({ skipped: state.skipped, handoffCount: state.handoffCount });
    window.setTimeout(() => {
      if (!options.preserveForQa) dispose();
    }, state.reducedMotion ? 80 : 900);
    return true;
  }

  function skip() {
    if (state.completed || state.mode !== "running") return false;
    host.classList.add("is-skipping");
    return complete(true);
  }

  const pauseReasons = {
    manual: false,
    visibility: document.hidden,
    menu: document.body.classList.contains("rb-escape-menu-open"),
  };
  let pauseTransition = 0;

  function setPaused(value, reason = "manual") {
    pauseReasons[reason] = !!value;
    const next = Object.values(pauseReasons).some(Boolean) && state.mode === "running";
    if (next) {
      pauseTransition += 1;
      if (state.paused) return true;
      state.paused = true;
      if (ctx.runtime) ctx.runtime.paused = true;
      host.classList.add("is-paused");
      void audio?.pauseDrop?.(true);
      return true;
    }
    if (!state.paused) return false;
    /* Hold the visual clock until the serialized AudioContext resume has
       actually settled, so the first cue after Resume cannot be emitted
       into a still-suspended context and disappear. */
    const token = ++pauseTransition;
    Promise.resolve(audio?.pauseDrop?.(false)).catch(() => false).then(() => {
      if (token !== pauseTransition || state.mode !== "running"
        || Object.values(pauseReasons).some(Boolean)) return;
      state.paused = false;
      if (ctx.runtime) ctx.runtime.paused = false;
      host.classList.remove("is-paused");
    });
    return state.paused;
  }

  function update(dt) {
    if (state.completed) return false;
    if (state.mode === "awaiting-gesture" || state.mode === "starting") {
      state.idle += Math.min(.05, Math.max(0, dt));
      applyTimeline(0, false);
      built.camera.position.x = Math.sin(state.idle * .42) * .018;
      built.cabinAmber.intensity = 3.1 + Math.sin(state.idle * 1.7) * .25;
      renderFrame();
      return true;
    }
    if (state.paused) {
      renderFrame();
      return true;
    }
    if (!manualClock) state.elapsed += Math.min(.1, Math.max(0, dt));
    const canonical = state.elapsed * timeScale;
    applyTimeline(canonical, !manualClock);
    renderFrame();
    if (canonical >= DROP_INTRO_DURATION - 1e-4) complete(false);
    return true;
  }

  function seek(markerOrSeconds) {
    if (state.completed && !options.preserveForQa) return false;
    let canonical = typeof markerOrSeconds === "string"
      ? DROP_INTRO_MARKERS[markerOrSeconds] : Number(markerOrSeconds);
    if (!Number.isFinite(canonical)) return false;
    if (state.mode === "awaiting-gesture") {
      state.mode = "running";
      state.started = true;
      if (ctx.runtime) ctx.runtime.phase = "intro";
      host.classList.add("is-running");
    }
    canonical = clamp(canonical, 0, DROP_INTRO_DURATION - 1e-4);
    state.elapsed = canonical / timeScale;
    state.cueIndex = CUES.findIndex(([at]) => at > canonical);
    if (state.cueIndex < 0) state.cueIndex = CUES.length;
    applyTimeline(canonical, false);
    renderFrame();
    return status();
  }

  function advance(seconds, dt = 1 / 60) {
    const amount = Math.max(0, Number(seconds) || 0);
    const step = clamp(Number(dt) || 1 / 60, 1 / 600, .1);
    let left = amount;
    while (left > 1e-6 && !state.completed) {
      const d = Math.min(step, left);
      state.elapsed += d;
      applyTimeline(state.elapsed * timeScale, false);
      left -= d;
    }
    renderFrame();
    if (state.elapsed * timeScale >= DROP_INTRO_DURATION - 1e-4) complete(false);
    return status();
  }

  function resize(width, height) {
    if (!built || state.disposed) return false;
    const aspect = Math.max(1, width) / Math.max(1, height);
    built.camera.aspect = aspect;
    built.camera.updateProjectionMatrix();
    built.handoffCamera.aspect = aspect;
    built.handoffCamera.updateProjectionMatrix();
    return true;
  }

  let disposedStatus = null;
  function dispose() {
    if (state.disposed) return;
    disposedStatus = status();
    state.disposed = true;
    observer?.disconnect();
    startButton.removeEventListener("click", start);
    skipButton.removeEventListener("click", skip);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("visibilitychange", onVisibility);
    if (built) {
      disposeScene(built.scene, built.mats.textures);
      built.scene.clear();
      built = null;
    }
    host.classList.remove("is-ready", "is-running", "is-paused", "is-skipping");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
    host.replaceChildren();
    disposedStatus = { ...disposedStatus, active: false, disposed: true, revealed: false };
  }

  function status() {
    if (state.disposed && disposedStatus) return { ...disposedStatus };
    const a = audio?.stats?.() || {};
    return {
      enabled: true,
      active: !state.completed,
      disposed: false,
      revealed: state.revealed,
      started: state.started,
      completed: state.completed,
      skipped: state.skipped,
      mode: state.mode,
      paused: state.paused,
      phase: state.phase,
      shot: state.shot,
      elapsed: Number(state.canonical.toFixed(3)),
      duration: DROP_INTRO_DURATION,
      playbackDuration: duration,
      reducedMotion: state.reducedMotion,
      manualClock: state.manualClock,
      gameplayLocked: !state.completed,
      handoffCount: state.handoffCount,
      pod: {
        position: built.pod.position.toArray().map((v) => Number(v.toFixed(3))),
        velocity: Math.round(state.velocity),
        altitude: Math.round(state.altitude),
        hatch: Number(state.hatch.toFixed(3)),
        landed: state.canonical >= DROP_INTRO_MARKERS.impact,
      },
      effects: {
        plasma: built.plasma.visible,
        thrusters: state.retro > .01,
        dust: built.dust.visible,
        shockwave: built.shockRings.some((ring) => ring.visible),
        turbulence: Number(state.turbulence.toFixed(3)),
      },
      impactCount: state.impactCount,
      audio: a.cinematic || { active: false, sources: 0 },
      scene: built.diagnostics,
    };
  }

  function reveal() {
    if (state.revealed || state.disposed || state.completed || !built) return false;
    state.revealed = true;
    host.removeAttribute("inert");
    host.classList.add("is-ready");
    host.setAttribute("aria-hidden", "false");
    stage?.classList.add("sf-intro-active");
    applyTimeline(state.canonical, false);
    renderFrame();
    return true;
  }

  function onKeyDown(event) {
    if (state.mode !== "awaiting-gesture"
      || (event.code !== "Enter" && event.code !== "Space")
      || !state.revealed || document.hidden
      || document.body.classList.contains("rb-escape-menu-open")) return;
    /* Do not steal activation from the shared menu, navigation, forms, or
       any other focused control. The global shortcut is only for an
       unfocused play surface; the Deploy button handles its own keyboard
       click through native button semantics. */
    const target = event.target;
    if (target?.closest?.("button, a, input, textarea, select, [contenteditable='true'], [role='button']")) return;
    event.preventDefault();
    void start();
  }
  function onVisibility() { setPaused(document.hidden, "visibility"); }
  const observer = new MutationObserver(() => {
    setPaused(document.body.classList.contains("rb-escape-menu-open"), "menu");
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  startButton.addEventListener("click", start);
  skipButton.addEventListener("click", skip);
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("visibilitychange", onVisibility);

  applyTimeline(0, false);
  if (!options.deferReveal) reveal();

  return {
    enabled: true,
    get scene() { return built?.scene || null; },
    get camera() {
      if (!built) return null;
      return state.shot === "handoff" ? built.handoffCamera : built.camera;
    },
    get done() { return state.completed; },
    get state() { return state; },
    isBlocking: () => !state.completed,
    reveal,
    start,
    update,
    resize,
    skip,
    seek,
    advance,
    setPaused,
    dispose,
    render: renderFrame,
    markers: () => ({ ...DROP_INTRO_MARKERS }),
    status,
  };
}
