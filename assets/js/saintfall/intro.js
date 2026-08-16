/* ============================================================
   SAINTFALL - THE DROP

   A deterministic, skippable orbital insertion in two halves.

   The ORBITAL half owns an isolated scene: a star field, Vesper-IX
   and its shattered reliquary halo, and the carrier that lets the
   lander go. None of that can exist inside a 2km desert basin, so
   none of it tries to.

   The DESCENT half does not own anything. From the moment the pod
   comes out of the cloud deck it is falling through the REAL level:
   real terrain, real cathedral, real sky, real light. The lander is
   ctx.pod - the same hinged object the level keeps standing at the
   drop site forever after - and the camera is a plain perspective
   camera in ctx.scene that spends its last two seconds easing into
   the player's own chase rig until the two are numerically
   identical. There is no match cut at the end because by then there
   is nothing left to cut between.

   The previous version filmed the landing on a 520m stand-in plane
   with a stand-in cathedral and cut to the level afterwards. That
   is the one thing this file must never do again.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, makeRng, smootherstep, sstep,
} from "saintfall/core.js";
import { mergeGeometries } from "saintfall/structures.js";
import { DROP_SITE, DROP_CRATER } from "saintfall/terrain.js";
import { POD_LANDED_PITCH, POD_LANDED_ROLL, POD_DOOR_REACH } from "saintfall/pod.js";

export const DROP_INTRO_DURATION = 23.6;
export const DROP_INTRO_MARKERS = Object.freeze({
  standby: 0,
  release: 1.5,
  orbit: 3.2,
  entry: 5.0,
  turbulence: 8.6,
  cloudBreak: 11.8,
  terminal: 15.0,
  impact: 17.9,
  hatch: 19.3,
  egress: 21.1,
  handoff: DROP_INTRO_DURATION,
});
const M = DROP_INTRO_MARKERS;

/** When the camera starts becoming the gameplay camera. */
const BLEND_FROM = 22.4;

const PHASES = [
  [0, "restrained", "RELIQUARY SEALED", "Cohort Seven. Hold fast."],
  [M.release, "release", "CRADLE RELEASED", "Vesper-IX has you now."],
  [M.orbit, "orbit", "ORBITAL SEPARATION", "The broken halo clears the keel."],
  [M.entry, "entry", "ATMOSPHERE CONTACT", "Ablative crown taking the fire."],
  [M.turbulence, "turbulence", "HIGH-G TRANSIT", "Spine to the throne. Ride it."],
  [M.cloudBreak, "cloud-break", "CLOUD DECK BREACHED", "Threshold causeway acquired."],
  [M.terminal, "terminal", "TERMINAL VELOCITY", "No burn. No brakes. Brace."],
  [M.impact, "impact", "IMPACT", "Vesper-IX. The Gilded Silence."],
  [M.hatch, "hatch", "HULL BREACHED OPEN", "Bolts blown. The doors are down."],
  [M.egress, "egress", "COHORT SEVEN ASHORE", "The Pilgrim's Road is yours."],
];

const CUES = [
  [0.02, "sealed"], [M.release, "release"], [M.orbit, "separation"],
  [M.entry, "entry"], [6.6, "hull"], [7.9, "hull"], [8.4, "warning"],
  [9.6, "hull"], [10.7, "hull"], [M.cloudBreak, "comms"],
  [M.terminal, "warning"], [15.6, "hull"], [16.3, "hull"], [16.9, "hull"],
  [17.4, "warning"], [17.7, "hull"],
  [M.impact, "impact"], [M.hatch, "vent"], [20.2, "hatch"],
  [M.egress, "comms"], [22.9, "handoff"],
];

/* ------------------------------ shaders ------------------------------ */

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
  /* Deep space is not black-blue, it is very nearly black. The
     colour in an orbital plate comes from the nebula and from the
     limb of the planet; a lifted background just looks like fog. */
  vec3 space = mix(vec3(0.0016, 0.0014, 0.0042), vec3(0.012, 0.008, 0.024), horizon);
  float neb = pow(max(0.0, sin(d.x * 4.1 + d.z * 2.6) * 0.5 + 0.5), 6.0)
    * (0.3 + 0.7 * hash31(floor(d * 22.0)));
  space += vec3(0.052, 0.026, 0.062) * neb;
  float neb2 = pow(max(0.0, sin(d.y * 3.4 - d.x * 2.2 + 1.7) * 0.5 + 0.5), 8.0);
  space += vec3(0.072, 0.052, 0.020) * neb2 * 0.7;

  /* Two star populations. One dense and faint for the field, one
     sparse and bright for the ones the eye actually tracks. */
  vec3 cellA = floor(d * 1180.0);
  float starA = step(0.9962, hash31(cellA));
  vec3 cellB = floor(d * 340.0);
  float starB = step(0.9986, hash31(cellB + 3.0));
  float glint = 0.7 + 0.3 * sin(uTime * 0.9 + hash31(cellA + 7.0) * 6.2831);
  vec3 tint = mix(vec3(0.66, 0.78, 1.0), vec3(1.0, 0.86, 0.62), hash31(cellA + 2.0));
  space += starA * glint * tint * 0.9;
  space += starB * tint * 2.4;

  // Fading INTO atmosphere, the field is replaced by daylit haze.
  vec3 sky = mix(vec3(0.20, 0.10, 0.10), vec3(0.92, 0.52, 0.22), pow(horizon, 0.5));
  sky += vec3(0.26, 0.11, 0.04) * pow(1.0 - horizon, 3.0);
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
  float dune = smoothstep(0.42, 0.78, fbm(N * 21.0 + 4.0));
  float basin = smoothstep(0.62, 0.30, fbm(N * 3.1 + 9.0));

  /* Vesper-IX from orbit is the basin the player is about to land
     in, scaled up: rust and ochre, with pale salt flats where the
     old seas were. It must not read as Mars - the salt is what
     makes it this world. */
  vec3 deep  = vec3(0.085, 0.030, 0.028);
  vec3 ochre = vec3(0.44, 0.19, 0.075);
  vec3 sand  = vec3(0.86, 0.50, 0.22);
  vec3 salt  = vec3(0.80, 0.76, 0.66);
  vec3 albedo = mix(deep, ochre, smoothstep(0.26, 0.66, land));
  albedo = mix(albedo, sand, dune * 0.42);
  albedo = mix(albedo, salt, basin * 0.30);

  // Weather: thin high cloud, curled by the planet's rotation.
  float cloud = smoothstep(0.54, 0.80, fbm(N * 7.2 + vec3(uTime * 0.012, 0.0, 0.0)));
  albedo = mix(albedo, vec3(0.94, 0.90, 0.86), cloud * 0.55);

  float light = max(0.0, dot(N, normalize(uSun)));
  // A real terminator, not a linear falloff - the night side keeps
  // only the faintest ash-light so the lit limb reads as a curve.
  float day = pow(light, 0.72);
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(N, V)), 3.4);
  vec3 c = albedo * (0.014 + day * 1.22);
  c += vec3(0.42, 0.24, 0.14) * rim * light * 0.9;
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
  float fres = pow(1.0 - max(0.0, dot(N, V)), 3.0);
  float sun = max(0.0, dot(N, normalize(uSun)));
  /* Gold on the day limb, cold violet in the shadow, which is what
     an atmosphere seen edge-on actually does and what sells the
     curve as a sphere rather than as a lit disc. */
  vec3 c = mix(vec3(0.10, 0.09, 0.22), vec3(1.0, 0.72, 0.34), pow(sun, 0.6));
  c += vec3(1.0, 0.90, 0.62) * pow(sun, 9.0) * 1.6;
  gl_FragColor = vec4(c * fres * 2.1, fres * (0.28 + sun * 0.52));
}
`;

const PLASMA_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vWorld;
varying float vUp;
uniform float uTime;
uniform float uHeat;
void main() {
  vec3 p = position + normal * sin(position.y * 5.1 + uTime * 9.0) * .07 * uHeat;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vUp = position.y;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PLASMA_FRAG = /* glsl */`
precision highp float;
varying vec3 vN;
varying vec3 vWorld;
varying float vUp;
uniform float uTime;
uniform float uHeat;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 1.7);

  /* The ablative sheath is BRIGHTEST at the stagnation point on the
     leading face and thins to nothing down the wake. A first pass
     modulated it with a plain sine along the axis and the pod flew
     down wearing a barber's pole - a regular stripe is the one thing
     a turbulent shock layer never has. Alpha is carried by the
     standoff term; the noise only breaks its edge. */
  float along = clamp((2.2 - vUp) / 6.4, 0.0, 1.0);
  float lead = pow(along, 2.2);

  float flick = h11(floor(vUp * 6.0) + floor(uTime * 22.0) * 1.7) * 0.35 + 0.65;
  float turb = 0.72 + 0.28 * sin(vUp * 2.3 - uTime * 11.0 + rim * 4.0);

  float a = clamp(uHeat * lead * (rim * 0.78 + 0.16) * flick * turb, 0.0, 0.74);

  /* Cold plasma to incandescent as the heat climbs, with a white
     core on the leading face that survives the tone map. */
  vec3 c = mix(vec3(.44,.76,1.0), vec3(1.0,.28,.05), clamp(uHeat * 1.25 - .12, 0.0, 1.0));
  c = mix(c, vec3(1.0,.94,.72), pow(lead, 2.6) * uHeat);
  gl_FragColor = vec4(c * (1.4 + rim * 1.5 + lead * 1.2), a);
}
`;

const WAKE_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WAKE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uHeat;
float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
void main() {
  // uv.y is 0 at the wide, far end of the trail and 1 at the pod.
  float near = pow(clamp(vUv.y, 0.0, 1.0), 2.4);
  float shed = h11(floor(vUv.y * 26.0) - floor(uTime * 30.0)) * 0.45 + 0.55;
  float body = sin(vUv.x * 6.2831) * 0.0 + 1.0;
  float a = uHeat * near * shed * 0.42 * body;
  vec3 c = mix(vec3(0.55, 0.20, 0.06), vec3(1.0, 0.72, 0.34), near);
  c = mix(c, vec3(1.0, 0.95, 0.80), pow(near, 5.0));
  gl_FragColor = vec4(c * 1.7, clamp(a, 0.0, 0.7));
}
`;

/* ------------------------------ helpers ------------------------------ */

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

function softSprite(THREE, inner = 0.16) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  const glow = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(inner, "rgba(255,255,255,.9)");
  glow.addColorStop(0.5, "rgba(255,255,255,.34)");
  glow.addColorStop(0.8, "rgba(255,255,255,.07)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeTree(root, extraTextures = []) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (Array.isArray(node.material)) node.material.forEach((m) => materials.add(m));
    else if (node.material) materials.add(node.material);
  });
  geometries.forEach((g) => g.dispose?.());
  materials.forEach((m) => m.dispose?.());
  extraTextures.forEach((t) => t.dispose?.());
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

/* ============================================================
   ACT ONE - the isolated orbital scene
   ============================================================ */

function buildOrbitScene(ctx, reducedMotion) {
  const { THREE } = ctx;
  const rng = makeRng((ctx.seed ^ 0xd20f7a11) >>> 0);
  const scene = new THREE.Scene();
  scene.name = "drop-orbit-scene";
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.08, 9000);
  const textures = [];

  const mesh = (geometry, material, name, parent = scene) => {
    const out = new THREE.Mesh(geometry, material);
    out.name = name;
    parent.add(out);
    return out;
  };

  const starUniforms = { uTime: { value: 0 }, uAtmos: { value: 0 } };
  const starMat = new THREE.ShaderMaterial({
    name: "drop-star-dome", uniforms: starUniforms,
    vertexShader: SCENE_VERT, fragmentShader: STAR_FRAG,
    side: THREE.BackSide, depthWrite: false,
  });
  const starDome = mesh(new THREE.SphereGeometry(3200, 40, 20), starMat, "drop-star-dome");
  starDome.frustumCulled = false;

  /* Orbital light is HARD, but not so hard that half a white hull
     goes to black - the shadow side of anything in low orbit is lit
     by the planet under it, and on an ochre desert world that
     bounce is strong and warm. Three lights: sun, planet-shine from
     below, and a cold sky term off the stars. */
  const sunDir = new THREE.Vector3(0.58, 0.30, 0.76).normalize();
  const key = new THREE.DirectionalLight(0xfff2df, 5.2);
  key.position.copy(sunDir).multiplyScalar(400);
  scene.add(key);
  /* The BELLY is what the whole orbital act is shot from - the pod
     hangs under the barge and the camera is under both - so the only
     surface that matters here is the one lit purely by planet-shine.
     At 0xffa768 x2.6 that made five hundred metres of white ceramic
     render solid ORANGE, and the Concord's whole identity is that it
     is the clean white thing in a rust-coloured game. Planetshine is
     still warm, just nowhere near that saturated, and the sky term
     carries the rest. */
  const bounce = new THREE.DirectionalLight(0xffdcc2, 1.30);
  bounce.position.set(-60, -320, -180);
  scene.add(bounce);
  const fill = new THREE.HemisphereLight(0xc4d6ff, 0xb8a693, 1.55);
  scene.add(fill);

  /* ------------------------- Vesper-IX ------------------------- */
  const space = new THREE.Group();
  space.name = "drop-space-environment";
  scene.add(space);

  const planetUniforms = { uSun: { value: sunDir }, uTime: { value: 0 } };
  const planetMat = new THREE.ShaderMaterial({
    name: "drop-vesper-surface", uniforms: planetUniforms,
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
  });
  /* Far enough away that its LIMB is in frame, and on the same axis
     the lander dives along. A first pass parked Vesper-IX 790m under
     the pod, which at any usable field of view is not a planet - it
     is an orange wall behind the subject, with no curve, no
     terminator and no halo. A world only reads as a world when you
     can see it end. */
  const DIVE_AXIS = new THREE.Vector3(0.30, -0.86, -0.41).normalize();
  const planet = mesh(new THREE.IcosahedronGeometry(760, 6), planetMat,
    "drop-vesper-ix", space);
  planet.position.copy(DIVE_AXIS).multiplyScalar(3400);
  const atmosMat = new THREE.ShaderMaterial({
    name: "drop-vesper-atmosphere", uniforms: { uSun: { value: sunDir } },
    vertexShader: PLANET_VERT, fragmentShader: ATMOS_FRAG,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const atmosphere = mesh(new THREE.IcosahedronGeometry(797, 5), atmosMat,
    "drop-vesper-atmosphere", space);
  atmosphere.position.copy(planet.position);

  /* The broken halo: the same shattered orbital reliquary that hangs
     over the playable basin, seen from inside it. */
  const goldMat = new THREE.MeshStandardMaterial({
    name: "drop-halo-gold", color: 0xc9a05a, metalness: 0.38, roughness: 0.28,
  });
  const paleMat = new THREE.MeshStandardMaterial({
    name: "drop-halo-pale", color: 0xd8d2c2, metalness: 0.10, roughness: 0.55,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    name: "drop-halo-dark", color: 0x2b2c33, metalness: 0.42, roughness: 0.62,
  });
  const bayMat = new THREE.MeshBasicMaterial({
    name: "drop-barge-bay-light", color: 0xffd79a, toneMapped: true,
  });
  /* A second, cleaner ceramic for the big uninterrupted surfaces.
     The barge's flanks were one material at roughness 0.55, which at
     this scale is a matte wall - it takes no highlight, so the eye
     gets no sense of a curved surface and five hundred metres of hull
     reads as a flat cutout. A tighter, slightly metallic plate gives
     the shoulder a long specular run down the length, which is most
     of what makes a big ship look MACHINED rather than modelled. */
  const plateMat = new THREE.MeshStandardMaterial({
    name: "drop-barge-plate-clean", color: 0xeae6dc, metalness: 0.22, roughness: 0.34,
  });
  /* The running strakes. Deliberately paler and cooler than the bay
     amber so the two read as different SYSTEMS - habitation light
     versus the ship's own contour lighting - which is the detail that
     separates a lit hull from a hull with windows painted on it. */
  const strakeMat = new THREE.MeshBasicMaterial({
    name: "drop-barge-strake", color: 0xffeecd, toneMapped: true,
  });

  const halo = new THREE.Group();
  halo.name = "drop-broken-halo";
  halo.position.copy(planet.position);
  halo.rotation.set(0.30, 0.1, 0.52);
  space.add(halo);
  for (let i = 0; i < 4; i += 1) {
    const ring = mesh(new THREE.TorusGeometry(1030, 3.6 + i * 0.5, 6, 160, 0.55 + i * 0.19),
      i % 2 ? goldMat : paleMat, `drop-halo-arc-${i}`, halo);
    ring.rotation.z = i * 1.42 + 0.2;
  }
  const dummy = new THREE.Object3D();
  const fragments = new THREE.InstancedMesh(
    new THREE.BoxGeometry(7, 2.4, 18), darkMat, 84);
  fragments.name = "drop-halo-fragments";
  for (let i = 0; i < 84; i += 1) {
    const a = rng.range(0, TAU);
    const rad = rng.range(990, 1080);
    dummy.position.set(Math.cos(a) * rad, Math.sin(a) * rad, rng.jit(20));
    dummy.rotation.set(rng.jit(.5), rng.jit(.5), a + rng.jit(.3));
    dummy.scale.set(rng.range(.35, 1.2), rng.range(.35, 1.1), rng.range(.45, 1.5));
    dummy.updateMatrix();
    fragments.setMatrixAt(i, dummy.matrix);
  }
  halo.add(fragments);

  /* ---------------------------- the carrier ----------------------------
     A Concord reliquary barge: white spine, gold ribs, lit bays. It
     is only ever seen for four seconds and only ever from below, so
     it is built as a silhouette with two details close to the
     cradle the lander leaves from. */
  /* Positioned so the CRADLE lands on the lander, not so the hull
     looks right on its own: the barge is only ever seen holding the
     pod, and 16m of daylight between the clamps and the thing they
     are clamping is the whole shot.

     The spine is offset well to one side and the cradle hangs off an
     outrigger, because every orbital camera looks down the same
     axis: parked directly overhead, the barge sat exactly between
     the lens and the pod and the opening shot was the inside of a
     hull. */
  /* ------------------------------------------------------------
     THE RELIQUARY BARGE

     Five hundred metres of it, and every part of that number is
     carried by REPEATED DETAIL rather than by the number itself.
     The first version was a 74m tube with nine ribs on it, and a
     smooth tube reads as whatever size the thing beside it implies -
     which, with a 6.9m lander clamped to its belly, was "small tug".
     Frames every twenty metres, window rows, bay after bay of other
     landers and a cathedral built along its spine give the eye
     something to count, and counting is how scale is read.

     Built as MERGED geometry, five meshes for several hundred
     pieces. The orbital act has a 140-draw-call budget and a
     220k-triangle one; assembled as individual meshes this would
     have spent the first on its window frames alone.
     ------------------------------------------------------------ */
  const carrier = new THREE.Group();
  carrier.name = "drop-carrier";
  /* The group's ORIGIN is the cradle, so the barge can be canted off
     the world axes - which it must be, or five hundred metres of
     hull runs exactly parallel to the frame edge - without the
     clamps drifting off the lander they are holding. */
  carrier.position.set(0, 3.5, 0);
  carrier.rotation.set(0.06, 0.21, -0.035);
  space.add(carrier);

  const barge = new THREE.Group();
  barge.name = "drop-barge-hull";
  barge.position.set(0, 26, 0);
  carrier.add(barge);

  {
    const pale = [];
    const gold = [];
    const dark = [];
    const lamp = [];
    const plate = [];
    const strake = [];

    const put = (bin, geo, x = 0, y = 0, z = 0) => {
      geo.translate(x, y, z);
      bin.push(geo);
      return geo;
    };
    /** A hull section: a cylinder whose axis runs down the keel. */
    const tube = (r1, r2, len, seg = 16) => {
      const g = new THREE.CylinderGeometry(r1, r2, len, seg, 1);
      g.rotateX(Math.PI / 2);
      return g;
    };
    /* The hull's radius at a given station, so ribs, bays and lamps
       all sit ON it instead of near it. */
    const hullR = (z) => {
      if (z <= -182) return lerp(13.0, 16.5, clamp01((z + 244) / 62));
      if (z <= -62) return lerp(16.5, 17.5, clamp01((z + 182) / 120));
      if (z <= 68) return lerp(17.5, 16.5, clamp01((z + 62) / 130));
      if (z <= 188) return lerp(16.5, 9.5, clamp01((z - 68) / 120));
      return lerp(9.5, 0.4, clamp01((z - 188) / 78));
    };

    /* ---- hull, stern to prow: -244 to +266 ---- */
    put(pale, tube(13.0, 16.5, 62), 0, 0, -213);
    put(pale, tube(16.5, 17.5, 120), 0, 0, -122);
    put(pale, tube(17.5, 16.5, 130), 0, 0, 3);
    put(pale, tube(16.5, 9.5, 120), 0, 0, 128);
    /* THE PROW.
       A single 78m cone read as a traffic bollard: one smooth taper
       with no edges to catch light and nothing to say which way is
       up. A prow is the one part of a ship the eye reads as intent,
       so it is built as three stacked tapers of decreasing radius
       with a hard step between each - the steps are what make it
       look sharpened rather than moulded - and it is faceted to 10
       sides so the facets themselves carry a highlight. */
    const prowA = new THREE.CylinderGeometry(6.4, 9.5, 46, 10, 1);
    prowA.rotateX(Math.PI / 2);
    put(plate, prowA, 0, 0, 211);
    const prowB = new THREE.CylinderGeometry(3.1, 6.4, 40, 10, 1);
    prowB.rotateX(Math.PI / 2);
    put(plate, prowB, 0, 0, 254);
    const prowC = new THREE.CylinderGeometry(0.35, 3.1, 34, 8, 1);
    prowC.rotateX(Math.PI / 2);
    put(plate, prowC, 0, 0, 291);
    // The steps themselves, in gold, so each break is a bright line.
    put(gold, (() => {
      const g = new THREE.TorusGeometry(6.5, 0.62, 5, 12);
      g.rotateX(Math.PI / 2);
      return g;
    })(), 0, 0, 234);
    put(gold, (() => {
      const g = new THREE.TorusGeometry(3.25, 0.45, 5, 10);
      g.rotateX(Math.PI / 2);
      return g;
    })(), 0, 0, 274);
    /* A dorsal blade running out over the prow. This is the piece
       that makes the front read as a BOW rather than as a nose cone:
       it gives the silhouette an asymmetry that says which surface is
       the top of the ship. */
    const blade = new THREE.BoxGeometry(1.5, 7.0, 74);
    put(plate, blade, 0, 5.2, 246);
    put(gold, new THREE.BoxGeometry(0.9, 0.8, 74), 0, 8.7, 246);
    put(strake, new THREE.BoxGeometry(0.5, 0.34, 62), 0, 8.0, 244);
    // A ram, because a Concord barge is a reliquary with an opinion.
    put(gold, tube(0.35, 1.5, 46, 8), 0, 0, 320);

    /* ---- frames every 19m: the main scale cue ---- */
    for (let z = -236; z <= 246; z += 19) {
      const r = hullR(z);
      if (r < 1.2) continue;
      const rib = new THREE.TorusGeometry(r + 0.35, 0.55, 5, 18);
      rib.rotateX(Math.PI / 2);
      put(gold, rib, 0, 0, z);
      // Every third frame carries a heavier collar.
      if ((Math.round((z + 236) / 19)) % 3 === 0) {
        const collar = new THREE.TorusGeometry(r + 0.9, 1.15, 5, 18);
        collar.rotateX(Math.PI / 2);
        put(pale, collar, 0, 0, z);
      }
    }

    /* ---- keel ---- */
    put(dark, new THREE.BoxGeometry(5.5, 4.2, 470), 0, -16.4, 8);
    put(gold, new THREE.BoxGeometry(2.2, 0.7, 470), 0, -18.4, 8);

    /* ---- the nave along the spine ----
       A cathedral welded to the top of a warship. It is what makes
       the silhouette Concord rather than generic, and from the pod
       it is the skyline the barge is read against. */
    /* THE NAVE, in three stepped tiers rather than one slab.
       A single 23x15 box with a row of identical rectangles down it
       is a bus shelter: it has one silhouette edge, one window
       rhythm and no depth, and at broadside it was the flattest
       thing in frame. Real ecclesiastical mass comes from tiers -
       aisle, then triforium, then a narrower clerestory carrying the
       roof - so each step back gives the profile another shadow line
       and the whole structure reads as built rather than extruded. */
    put(plate, new THREE.BoxGeometry(25, 9, 196), 0, 18.5, -22);   // aisle
    put(pale, new THREE.BoxGeometry(19.5, 8, 190), 0, 26, -22);    // triforium
    put(plate, new THREE.BoxGeometry(14.5, 7, 182), 0, 33, -22);   // clerestory
    // The steps themselves, picked out so each tier reads separately.
    put(gold, new THREE.BoxGeometry(25.6, 0.5, 196), 0, 23.1, -22);
    put(gold, new THREE.BoxGeometry(20.1, 0.5, 190), 0, 30.1, -22);
    /* The APSE: the nave now ENDS in something instead of being cut
       off square. A half-drum plus a conical cap, aft, where the
       cathedral meets the spine. */
    const apse = new THREE.CylinderGeometry(9.8, 9.8, 14, 12, 1);
    put(plate, apse, 0, 24, -120);
    const apseCap = new THREE.CylinderGeometry(0.4, 10.4, 11, 12);
    put(pale, apseCap, 0, 36.5, -120);
    put(gold, (() => {
      const g = new THREE.TorusGeometry(9.9, 0.6, 5, 14);
      return g;
    })(), 0, 31, -120);
    for (const side of [-1, 1]) {
      const roof = new THREE.BoxGeometry(10.5, 1.6, 182);
      roof.rotateZ(side * 0.62);
      put(pale, roof, side * 4.3, 38.5, -22);
      /* LANCETS, not letterbox slots. The old clerestory was a 5.2m
         box lying on its side - wider than it was tall, which is the
         one proportion a cathedral window never has. Tall, narrow and
         close-spaced is what makes a wall read as a nave, and it is
         also what carries the light: a thin bright vertical repeated
         forty times is far more legible at this distance than twenty
         fat squares. */
      for (let z = -108; z <= 64; z += 6.2) {
        put(lamp, new THREE.BoxGeometry(0.5, 5.4, 1.7), side * 7.4, 33.6, z);
        put(gold, new THREE.BoxGeometry(0.7, 6.4, 0.55), side * 7.6, 33.4, z - 1.35);
        // Aisle windows below, on the widest tier, at half the rhythm.
        if ((Math.round((z + 108) / 6.2)) % 2 === 0) {
          put(lamp, new THREE.BoxGeometry(0.5, 3.6, 1.5), side * 12.6, 19.2, z);
          put(gold, new THREE.BoxGeometry(0.7, 4.4, 0.5), side * 12.8, 19.0, z - 1.2);
        }
      }
      /* Flying buttresses as straight raking STRUTS. Built from
         partial tori they rendered as thin white worms lying on the
         hull: a 10-segment arc is a smooth curve at cathedral scale
         and a piece of wire at ship scale. */
      for (let z = -104; z <= 60; z += 20.5) {
        const pier = new THREE.BoxGeometry(1.7, 14, 2.4);
        pier.rotateZ(side * 0.42);
        put(pale, pier, side * 17.8, 12, z);
        const rake = new THREE.BoxGeometry(11.5, 1.5, 2.0);
        rake.rotateZ(side * -0.62);
        put(pale, rake, side * 15.4, 22.5, z);
        put(gold, new THREE.BoxGeometry(2.6, 1.0, 2.6), side * 20.4, 6.5, z);
      }
    }
    /* Spires along the ridge, tallest amidships. Slimmer and taller
       than the first pass, and each one now stands on a base rather
       than growing straight out of the roof - a cone rising from a
       flat surface with no plinth is a traffic cone, and nine of
       them in a row was the most toy-like thing on the ship. The
       gold finial is carried on a thin neck so it reads as an object
       the spire holds UP, which is the whole gesture. */
    for (let i = 0; i < 9; i += 1) {
      const z = -104 + i * 20.5;
      const h = 20 + Math.cos((i - 4) * 0.55) * 13;
      put(plate, new THREE.BoxGeometry(4.6, 2.2, 4.6), 0, 40.2, z);
      put(gold, new THREE.BoxGeometry(5.2, 0.45, 5.2), 0, 41.5, z);
      const spire = new THREE.CylinderGeometry(0.08, 1.75, h, 6);
      put(pale, spire, 0, 41.8 + h * 0.5, z);
      // Neck, then finial: two pieces, so the tip is a jewel on a
      // stem instead of the cone simply continuing in gold.
      put(gold, new THREE.CylinderGeometry(0.16, 0.16, 2.4, 5), 0, 41.8 + h + 1.2, z);
      put(gold, new THREE.OctahedronGeometry(0.95, 0), 0, 41.8 + h + 3.0, z);
      put(strake, new THREE.BoxGeometry(0.3, 0.3, 0.3), 0, 41.8 + h + 3.0, z);
    }
    // Rose window over the forward face of the nave.
    const rose = new THREE.CylinderGeometry(6.2, 6.2, 0.6, 20);
    rose.rotateX(Math.PI / 2);
    put(lamp, rose, 0, 24, 73.6);
    const roseRim = new THREE.TorusGeometry(6.5, 0.7, 5, 20);
    put(gold, roseRim, 0, 24, 74);

    /* ---- transepts: two great swept vanes amidships ---- */
    for (const side of [-1, 1]) {
      /* SWEPT BACK and shallow. A 62x34 slab held square to the hull
         is a sail: broadside - which is the only angle the barge is
         ever seen from - it covered a third of the ship's length with
         one flat quad and hid everything behind it. */
      /* VENTRAL fins, swept hard aft and hung below the hull line.
         Held out level at mid-height they projected UPWARD from a
         camera under the keel - which is every camera in this act -
         and drew a diagonal plank straight across the nave. */
      const vane = new THREE.BoxGeometry(40, 2.2, 14);
      vane.rotateY(side * 0.95);
      vane.rotateZ(side * 0.10);
      put(pale, vane, side * 26, -13, -74);
      const edge = new THREE.BoxGeometry(40, 1.1, 2.2);
      edge.rotateY(side * 0.95);
      edge.rotateZ(side * 0.10);
      put(gold, edge, side * 27, -13, -80);
      /* Ribs UNDER the vane, not banners hanging off it. Free-floating
         cloth at this scale rendered as four grey rectangles adrift
         beside the hull with nothing joining them to anything. */
      for (let i = 0; i < 4; i += 1) {
        const strut = new THREE.BoxGeometry(1.3, 3.6, 11);
        strut.rotateY(side * 0.95);
        strut.rotateZ(side * 0.10);
        put(dark, strut, side * (12 + i * 9), -12, -64 - i * 8.5);
      }
    }

    /* ---- drop bays along the belly ----
       Nine of them. The lander the player is in is ONE, which is the
       single most useful thing the barge can say about the operation
       it belongs to. */
    for (let i = -4; i <= 4; i += 1) {
      const z = i * 26;
      const r = hullR(z);
      put(dark, new THREE.BoxGeometry(12, 4.5, 19), 0, -r + 1.6, z);
      put(gold, new THREE.BoxGeometry(13.2, 0.8, 1.3), 0, -r + 3.6, z - 9.6);
      put(gold, new THREE.BoxGeometry(13.2, 0.8, 1.3), 0, -r + 3.6, z + 9.6);
      put(lamp, new THREE.BoxGeometry(9.2, 0.35, 15), 0, -r + 3.3, z);
      // Every bay but the player's is still loaded.
      if (i !== 0) {
        /* A silhouette, not a peg. These are the reason the barge
           reads as an operation rather than as a hull with one pod
           stuck to it, so they have to be recognisable as the same
           object the player is sitting in. */
        put(pale, new THREE.CylinderGeometry(1.7, 2.05, 4.6, 9), 0, -r - 1.1, z);
        const nose = new THREE.CylinderGeometry(0.12, 1.7, 3.0, 9);
        put(pale, nose, 0, -r + 2.7, z);
        put(gold, new THREE.TorusGeometry(2.1, 0.2, 4, 9), 0, -r - 3.3, z);
        put(gold, new THREE.TorusGeometry(1.78, 0.16, 4, 9), 0, -r + 1.1, z);
      }
    }
    // The player's own bay, opened: a deeper recess and a lit throat.
    put(dark, new THREE.BoxGeometry(10, 7.5, 15), 0, -14.5, 0);
    put(lamp, new THREE.BoxGeometry(7.6, 0.3, 12.5), 0, -11.2, 0);
    // The pylon the cradle hangs from.
    put(pale, new THREE.BoxGeometry(3.4, 12, 4.2), 0, -21, 0);
    put(gold, new THREE.BoxGeometry(4.4, 0.8, 5.2), 0, -26.4, 0);

    /* ---- plating, running lights and greebles ----
       The belly is the surface every orbital shot is taken against,
       and five hundred metres of unbroken cylinder has no scale at
       all no matter how long it is. Seams every 5.5m give the eye
       something to count all the way to the stern. */
    for (let z = -238; z <= 258; z += 5.5) {
      const r = hullR(z);
      if (r < 1.5) continue;
      const seam = new THREE.TorusGeometry(r + 0.06, 0.09, 3, 16);
      seam.rotateX(Math.PI / 2);
      put(dark, seam, 0, 0, z);
    }
    for (let z = -226; z <= 176; z += 11) {
      const r = hullR(z);
      for (const side of [-1, 1]) {
        put(lamp, new THREE.BoxGeometry(0.4, 0.4, 2.2), side * (r - 0.6), -6.5, z);
        /* A raised housing with a dark face, not a black rectangle
           painted on the plating. Flat dark boxes flush to a hull
           read as holes cut in it. */
        put(pale, new THREE.BoxGeometry(2.4, 3.2, 6.2), side * (r - 0.9), 6, z + 3);
        put(dark, new THREE.BoxGeometry(0.6, 2.0, 4.6), side * (r + 0.5), 6, z + 3);
        // Lower gun-deck lights, so the flank is not bare below the ribs.
        if ((Math.round((z + 226) / 11)) % 2 === 0) {
          put(lamp, new THREE.BoxGeometry(0.45, 1.5, 1.5), side * (r - 0.5), -2.5, z);
          put(gold, new THREE.BoxGeometry(0.7, 2.3, 2.3), side * (r - 0.7), -2.5, z);
        }
        // Belly plating: shallow raised panels, alternating.
        put(pale, new THREE.BoxGeometry(4.2, 0.5, 7.5),
          side * 5.4, -r + 0.5, z + (side > 0 ? 0 : 5.5));
      }
      put(lamp, new THREE.BoxGeometry(1.8, 0.3, 0.9), 0, -hullR(z) + 0.4, z + 5.5);
    }

    /* ------------------------------------------------------------
       THE SLEEK PASS

       What the hull was missing is not detail - it had plenty - but
       CONTINUITY. Every feature on it was a repeated small object
       (a rib, a window, a housing), and a row of identical small
       objects reads as texture, not as length. Nothing ran the whole
       ship, so the eye had nothing to travel along and five hundred
       metres arrived as "a tube with stuff on it".

       Three continuous elements fix that, and they are the same
       three every believable capital ship uses:

       - a CHINE: one hard raised edge along the widest line of the
         hull, running stem to stern. It is what turns a cylinder
         into something machined, it catches a long unbroken
         specular, and it gives the silhouette a crease instead of
         an outline.
       - STRAKES: two unbroken light lines under the chine. A lit
         line that never stops is the single strongest scale cue
         available - the eye follows it and measures the ship by how
         long the follow takes.
       - a KEEL RAIL in gold, so the belly (the only surface this
         act ever sees) has a spine of its own.

       Built as long boxes following `hullR`, in segments short
       enough to track the taper but long enough that no seam is
       visible from the cinematic's distance.
       ------------------------------------------------------------ */
    {
      const STEP = 16;
      const Z0 = -240;
      const Z1 = 252;
      for (let z = Z0; z < Z1; z += STEP) {
        const zA = z;
        const zB = Math.min(z + STEP, Z1);
        const rA = hullR(zA);
        const rB = hullR(zB);
        if (rA < 2.2 && rB < 2.2) continue;
        const mid = (zA + zB) * 0.5;
        const len = zB - zA;
        const r = (rA + rB) * 0.5;
        // The chine sits just above the widest point, angled out, so
        // it is lit from above and shades the flank beneath it.
        for (const side of [-1, 1]) {
          const chine = new THREE.BoxGeometry(2.6, 1.5, len + 0.6);
          chine.rotateZ(side * 0.34);
          put(plate, chine, side * (r + 0.35), 2.4, mid);
          /* The contour light. Every segment is cut LONGER than its
             station spacing so consecutive pieces overlap: shortened
             to fit, they left a gap at every seam and the result was
             a dashed line, which reads as a row of windows and gives
             back the exact scale cue the run exists to provide. A
             strake is only worth having if it never stops.

             Sized to be seen, not to be accurate. At the distance
             this act is shot from, a metre is under two pixels, so a
             realistic 30cm light strip is invisible and the whole
             pass is wasted. */
          put(strake, new THREE.BoxGeometry(0.9, 0.75, len + 0.6),
            side * (r + 0.62), 0.7, mid);
          // A second, dimmer line low on the flank. Two parallel runs
          // give the hull an implied deck height between them.
          put(strake, new THREE.BoxGeometry(0.62, 0.5, len + 0.6),
            side * (r - 0.35), -7.6, mid);
          // Long shadow groove between the two runs, so the flank is
          // not one flat value from chine to keel.
          put(dark, new THREE.BoxGeometry(0.55, 1.5, len + 0.6),
            side * (r + 0.1), -3.2, mid);
        }
        // Keel rail: gold, dead centre of the belly, full length.
        put(gold, new THREE.BoxGeometry(1.9, 0.6, len + 0.6), 0, -r - 0.12, mid);
        put(strake, new THREE.BoxGeometry(0.95, 0.3, len + 0.6), 0, -r - 0.46, mid);
        // Dorsal rail, which is what the nave sits astride.
        put(plate, new THREE.BoxGeometry(3.2, 0.9, len + 0.6), 0, r - 0.2, mid);
      }
    }

    /* ---- the engines ---- */
    /* The stern is the LAST thing on screen as the pod falls away, so
       the engines are the shape the barge leaves the audience with.
       Five small matching bells read as a rocket; a heavy centre pair
       with lighter outboards reads as a ship whose mass sits on its
       keel. Each bell is now a deep faceted flare with a lit throat
       recessed inside it, so the glow is something the geometry
       CONTAINS rather than a disc stuck on the end. */
    const ENGINES = [
      { x: 0, y: -3.0, s: 1.45 },
      { x: -13.5, y: 1.5, s: 1.0 },
      { x: 13.5, y: 1.5, s: 1.0 },
      { x: -7.6, y: 10.0, s: 0.72 },
      { x: 7.6, y: 10.0, s: 0.72 },
    ];
    for (const e of ENGINES) {
      const s = e.s;
      const housing = new THREE.CylinderGeometry(5.2 * s, 6.6 * s, 20 * s, 10, 1);
      housing.rotateX(Math.PI / 2);
      put(plate, housing, e.x, e.y, -250 - 4 * s);
      // The flare, open so the throat inside it is visible.
      const bell = new THREE.CylinderGeometry(8.4 * s, 5.2 * s, 17 * s, 10, 1, true);
      bell.rotateX(Math.PI / 2);
      put(pale, bell, e.x, e.y, -268 - 6 * s);
      const lip = new THREE.TorusGeometry(8.3 * s, 0.75 * s, 5, 12);
      lip.rotateX(Math.PI / 2);
      put(gold, lip, e.x, e.y, -276 - 6 * s);
      const collar = new THREE.TorusGeometry(6.5 * s, 1.0 * s, 5, 12);
      collar.rotateX(Math.PI / 2);
      put(gold, collar, e.x, e.y, -256 - 4 * s);
      // Recessed throat: sits INSIDE the bell mouth, not flush with it.
      const throat = new THREE.CylinderGeometry(5.0 * s, 5.0 * s, 0.6, 12);
      throat.rotateX(Math.PI / 2);
      put(lamp, throat, e.x, e.y, -270 - 6 * s);
      // Injector spokes across the throat, so it is machinery and not
      // a glowing coin.
      for (let k = 0; k < 4; k += 1) {
        const spoke = new THREE.BoxGeometry(9.4 * s, 0.42 * s, 0.42 * s);
        spoke.rotateZ((k / 4) * Math.PI);
        put(dark, spoke, e.x, e.y, -271 - 6 * s);
      }
    }

    const merged = (bin, material, name) => {
      const m = new THREE.Mesh(mergeGeometries(THREE, bin), material);
      m.name = name;
      barge.add(m);
      return m;
    };
    merged(pale, paleMat, "drop-barge-plate");
    merged(plate, plateMat, "drop-barge-plate-clean");
    merged(gold, goldMat, "drop-barge-trim");
    merged(dark, darkMat, "drop-barge-shadow");
    merged(lamp, bayMat, "drop-barge-lights");
    merged(strake, strakeMat, "drop-barge-strakes");
  }

  /* The cradle the lander is clamped into. It stays with the barge
     when the clamps blow, which is what makes the release read as a
     release rather than as the pod simply moving. */
  const cradle = new THREE.Group();
  cradle.name = "drop-cradle";
  carrier.add(cradle);
  const hanger = mesh(new THREE.CylinderGeometry(0.62, 0.75, 4.2, 8), paleMat,
    "drop-cradle-hanger", cradle);
  hanger.position.set(0, 7.4, 0);
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(0.8, 6.2, 0.8), goldMat,
      `drop-cradle-arm-${side}`, cradle);
    arm.position.set(side * 3.15, 2.6, 0);
    arm.rotation.z = side * 0.16;
  }
  const keel = mesh(new THREE.BoxGeometry(7.4, 0.6, 1.1), paleMat,
    "drop-cradle-keel", cradle);
  keel.position.y = 5.4;
  const clamps = [];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const jaw = mesh(new THREE.BoxGeometry(1.5, 0.7, 0.7), goldMat,
      `drop-cradle-clamp-${i}`, cradle);
    jaw.position.set(Math.sin(a) * 2.5, -1.2 + (i % 2) * 2.4, Math.cos(a) * 2.5);
    jaw.rotation.y = a;
    clamps.push(jaw);
  }

  /* ------------------------- entry effects ------------------------- */
  const plasmaUniforms = { uTime: { value: 0 }, uHeat: { value: 0 } };
  const plasmaMat = new THREE.ShaderMaterial({
    name: "drop-plasma-sheath", uniforms: plasmaUniforms,
    vertexShader: PLASMA_VERT, fragmentShader: PLASMA_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const plasmaRig = new THREE.Group();
  plasmaRig.name = "drop-plasma-rig";
  plasmaRig.visible = false;
  scene.add(plasmaRig);

  /* ONE envelope, lathed to the lander's own silhouette: a detached
     bow shock standing off the ablative skirt, wrapping the hull and
     closing above the nose. Built as a separate sphere plus a
     separate cone it read as an egg balanced on a traffic cone,
     because that is exactly what it was. */
  const sheathProfile = [
    [0.02, -2.55], [1.20, -2.20], [2.05, -1.55], [2.52, -0.75],
    [2.68, 0.10], [2.62, 1.20], [2.52, 2.35], [2.36, 3.50],
    [2.10, 4.65], [1.72, 5.75], [1.20, 6.75], [0.58, 7.45], [0.02, 7.80],
  ].map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y));
  const plasma = mesh(new THREE.LatheGeometry(sheathProfile, 30), plasmaMat,
    "drop-plasma-sheath", plasmaRig);

  /* The wake gets its own material rather than sharing the sheath's.
     The sheath shader keys its alpha off distance from the
     stagnation point, and a 60m trail offset 37m up-track sits
     entirely outside that band - shared, the trail was invisible at
     every heat value. Its own two-uniform shader, driven by the
     cylinder's own UV, is both correct and cheaper. */
  const wakeUniforms = { uTime: { value: 0 }, uHeat: { value: 0 } };
  const wakeMat = new THREE.ShaderMaterial({
    name: "drop-entry-wake", uniforms: wakeUniforms,
    vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wake = mesh(new THREE.CylinderGeometry(0.45, 2.9, 66, 20, 1, true),
    wakeMat, "drop-entry-wake", plasmaRig);
  wake.position.y = 38;

  const sprite = softSprite(THREE);
  textures.push(sprite);
  const emberCount = reducedMotion ? 70 : 260;
  const emberBase = new Float32Array(emberCount * 4);
  const emberPos = new Float32Array(emberCount * 3);
  for (let i = 0; i < emberCount; i += 1) {
    emberBase[i * 4] = rng.range(-3.2, 3.2);
    emberBase[i * 4 + 1] = rng.range(-4, 52);
    emberBase[i * 4 + 2] = rng.range(-3.2, 3.2);
    emberBase[i * 4 + 3] = rng.range(.6, 2.1);
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
  const emberMat = new THREE.PointsMaterial({
    name: "drop-entry-embers", color: 0xffb060, size: .34,
    transparent: true, opacity: .92, depthWrite: false,
    blending: THREE.AdditiveBlending, map: sprite, alphaTest: .02,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.name = "drop-entry-embers";
  embers.visible = false;
  embers.frustumCulled = false;
  scene.add(embers);

  const diagnostics = sceneDiagnostics(scene);
  return {
    scene, camera, textures, diagnostics,
    starUniforms, planetUniforms, plasmaUniforms, wakeUniforms,
    space, planet, atmosphere, halo, carrier, cradle, clamps,
    plasmaRig, plasma, wake,
    embers, emberBase, emberPos,
  };
}

/* ============================================================
   ACT TWO - the rig that films inside the live level
   ============================================================ */

function buildDescentRig(ctx, reducedMotion, site) {
  const { THREE } = ctx;
  const rng = makeRng((ctx.seed ^ 0x51f2ab03) >>> 0);
  const root = new THREE.Group();
  root.name = "drop-descent-rig";
  ctx.scene.add(root);
  const textures = [];

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 11000);
  camera.name = "drop-descent-camera";

  const ground = ctx.terrain.heightAt(site.x, site.z);
  const sprite = softSprite(THREE, 0.30);
  textures.push(sprite);

  /* ---- the cloud deck the pod comes out of ----
     The game's own sky puts its cloud shelves out at the horizon,
     which is right for a level and useless for a descent. This deck
     exists only for the seconds either side of the break: it is
     what the frame is full of at the cut, which is precisely why
     the cut is invisible. */
  const deck = new THREE.Group();
  deck.name = "drop-cloud-deck";
  deck.position.set(site.x, ground, site.z);
  root.add(deck);
  const cloudMat = new THREE.MeshBasicMaterial({
    name: "drop-cloud-slab", map: sprite, color: 0xffd9b4,
    transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.NormalBlending, toneMapped: true,
  });
  /* A CEILING, not a volume. The deck is one thin shelf the pod
     tears through: 300m of stacked billboards put the camera inside
     an opaque beige fog for three seconds and the basin reveal -
     the entire point of the shot - never happened. */
  const slabs = reducedMotion ? 18 : 38;
  for (let i = 0; i < slabs; i += 1) {
    const size = rng.range(300, 660);
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(size, size), cloudMat);
    slab.name = `drop-cloud-slab-${i}`;
    const a = rng.range(0, TAU);
    const r = rng.range(60, 900);
    slab.position.set(Math.cos(a) * r, rng.range(700, 780), Math.sin(a) * r);
    slab.rotation.set(-Math.PI / 2 + rng.jit(0.18), rng.range(0, TAU), rng.jit(0.14));
    slab.renderOrder = 2;
    deck.add(slab);
  }

  /* ---- the lander's wake through the lower atmosphere ----
     Faded per-vertex along its length. A flat-coloured additive cone
     is not a trail, it is a pole: the first pass hung a 220m white
     bar off the nose and the shot read as the pod being lowered on a
     wire. The taper has to happen in the SHADING, not just in the
     silhouette. */
  const trail = new THREE.Group();
  trail.name = "drop-descent-trail";
  trail.visible = false;
  root.add(trail);

  const fadeAlongY = (geo, hot, cold, lo, hi) => {
    const pos = geo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const k = clamp01((pos.getY(i) - lo) / Math.max(1e-4, hi - lo));
      const f = 1 - k * k;
      colours[i * 3] = hot[0] * f + cold[0] * (1 - f);
      colours[i * 3 + 1] = hot[1] * f + cold[1] * (1 - f);
      colours[i * 3 + 2] = hot[2] * f + cold[2] * (1 - f);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    return geo;
  };

  const trailMat = new THREE.MeshBasicMaterial({
    name: "drop-trail", vertexColors: true, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    toneMapped: true,
  });
  const plumeGeo = new THREE.ConeGeometry(3.4, 190, 14, 6, true);
  plumeGeo.rotateZ(Math.PI);
  plumeGeo.translate(0, 95, 0);
  fadeAlongY(plumeGeo, [1.0, 0.82, 0.52], [0.02, 0.01, 0.0], 0, 190);
  const plume = new THREE.Mesh(plumeGeo, trailMat);
  plume.name = "drop-trail-plume";
  trail.add(plume);

  const smokeMat = new THREE.MeshBasicMaterial({
    name: "drop-trail-smoke", map: sprite, vertexColors: true, transparent: true,
    opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
  });
  const smokeGeo = new THREE.CylinderGeometry(6, 30, 380, 12, 6, true);
  smokeGeo.translate(0, 200, 0);
  fadeAlongY(smokeGeo, [0.52, 0.42, 0.36], [0.04, 0.03, 0.03], 10, 380);
  const smokeCol = new THREE.Mesh(smokeGeo, smokeMat);
  smokeCol.name = "drop-trail-smoke";
  trail.add(smokeCol);

  /* ---- landfall ---- */
  const impact = new THREE.Group();
  impact.name = "drop-impact-effects";
  impact.position.set(site.x, ground, site.z);
  impact.visible = false;
  root.add(impact);

  const ringMat = new THREE.MeshBasicMaterial({
    name: "drop-shock-ring", color: 0xffd8a0, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    toneMapped: true,
  });
  const rings = [];
  for (let i = 0; i < 3; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 5, 72), ringMat.clone());
    ring.name = `drop-shock-ring-${i}`;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.22 + i * 0.1;
    ring.visible = false;
    impact.add(ring);
    rings.push(ring);
  }

  const dustMat = new THREE.MeshBasicMaterial({
    name: "drop-impact-wall", map: sprite, color: 0xd9a878, transparent: true,
    opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
  });
  const curtain = new THREE.Group();
  curtain.name = "drop-impact-curtain";
  impact.add(curtain);
  const curtainCount = reducedMotion ? 10 : 22;
  for (let i = 0; i < curtainCount; i += 1) {
    const a = (i / curtainCount) * TAU;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), dustMat);
    card.name = `drop-impact-card-${i}`;
    card.position.set(Math.cos(a) * 9, 5, Math.sin(a) * 9);
    card.rotation.y = -a + Math.PI / 2;
    card.userData.angle = a;
    curtain.add(card);
  }

  const flashMat = new THREE.MeshBasicMaterial({
    name: "drop-impact-flash", map: sprite, color: 0xfff0cc, transparent: true,
    opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: true,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), flashMat);
  flash.name = "drop-impact-flash";
  flash.position.y = 3;
  impact.add(flash);

  /* ---- the light the open reliquary throws on the sand ---- */
  const spillMat = new THREE.MeshBasicMaterial({
    name: "drop-hatch-spill", map: sprite, color: 0xffd694, transparent: true,
    opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: true,
  });
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(11, 15), spillMat);
  spill.name = "drop-hatch-spill";
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(
    site.x + Math.sin(site.yaw) * 5.6, ground + 0.14, site.z + Math.cos(site.yaw) * 5.6);
  spill.rotation.z = -site.yaw;
  spill.renderOrder = 2;
  root.add(spill);

  return {
    root, camera, ground, textures,
    deck, cloudMat, trail, trailMat, smokeMat, plume, smokeCol,
    impact, rings, curtain, dustMat, flash, flashMat, spill, spillMat,
    materials: [cloudMat, trailMat, smokeMat, dustMat, flashMat, spillMat,
      ...rings.map((r) => r.material)],
  };
}

/* ------------------------------- markup ------------------------------- */

function buildMarkup(host) {
  host.innerHTML = `
    <div class="sf-intro__art" aria-hidden="true"></div>
    <div class="sf-intro__letterbox sf-intro__letterbox--top"></div>
    <div class="sf-intro__letterbox sf-intro__letterbox--bottom"></div>
    <div class="sf-intro__scan" aria-hidden="true"></div>
    <div class="sf-intro__heat" aria-hidden="true"></div>
    <div class="sf-intro__flash" aria-hidden="true"></div>
    <div class="sf-intro__telemetry" aria-hidden="true">
      <div class="sf-intro__eyebrow"><span>SANCTUM VII</span><b data-intro-signal>LINK // GREEN</b></div>
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
    <div class="sf-intro__gate" role="dialog" aria-modal="false"
      aria-labelledby="sf-entry-title" aria-describedby="sf-entry-subtitle" data-entry-panel="main">
      <header class="sf-entry__header">
        <div class="sf-intro__crest" aria-hidden="true"><i></i><b></b><em></em></div>
        <span><small>CONCORD RELIQUARY // COHORT VII</small>
          <h2 id="sf-entry-title">SAINTFALL</h2>
          <p id="sf-entry-subtitle">Vesper-IX · Operation The Gilded Silence</p></span>
      </header>
      <div class="sf-entry__archive"><span>FIELD ARCHIVE</span><b data-intro-save-status>SCANNING RECORDS</b></div>
      <div class="sf-entry__actions">
        <button class="sf-entry__continue" type="button" data-intro-continue disabled>
          <span>Continue pilgrimage</span><b data-intro-continue-meta>NO FIELD RECORD</b>
        </button>
        <button class="sf-entry__new" type="button" data-intro-start>
          <span>Begin new operation</span><b>PLAY THE DROP</b>
        </button>
        <div class="sf-entry__secondary">
          <button type="button" data-intro-load-toggle aria-expanded="false">LOAD GAME</button>
          <button type="button" data-intro-options-toggle aria-expanded="false">OPTIONS</button>
        </div>
      </div>
      <section class="sf-entry__panel sf-entry__panel--load" data-intro-panel="load" aria-label="Load game" hidden>
        <header><span>FIELD RECORDS</span><button type="button" data-intro-panel-close aria-label="Close load game">×</button></header>
        <div class="sf-entry__slots">
          <button type="button" data-intro-load-kind="autosave" data-intro-load-index="-1" disabled>
            <span><small>AUTOSAVE</small><strong data-intro-slot-district>EMPTY</strong></span><b data-intro-slot-time>—</b>
          </button>
          <button type="button" data-intro-load-kind="manual" data-intro-load-index="0" disabled>
            <span><small>RELIQUARY I</small><strong data-intro-slot-district>EMPTY</strong></span><b data-intro-slot-time>—</b>
          </button>
          <button type="button" data-intro-load-kind="manual" data-intro-load-index="1" disabled>
            <span><small>RELIQUARY II</small><strong data-intro-slot-district>EMPTY</strong></span><b data-intro-slot-time>—</b>
          </button>
          <button type="button" data-intro-load-kind="manual" data-intro-load-index="2" disabled>
            <span><small>RELIQUARY III</small><strong data-intro-slot-district>EMPTY</strong></span><b data-intro-slot-time>—</b>
          </button>
        </div>
      </section>
      <section class="sf-entry__panel sf-entry__panel--options" data-intro-panel="options" aria-label="Options" hidden>
        <header><span>FIELD CONFIGURATION</span><button type="button" data-intro-panel-close aria-label="Close options">×</button></header>
        <div class="sf-entry__options">
          <button type="button" role="switch" data-intro-setting="sound" aria-checked="true"><span>FIELD AUDIO<small>Music, weapons, and ambience</small></span><b>ON</b></button>
          <button type="button" role="switch" data-intro-setting="reducedMotion" aria-checked="false"><span>REDUCED MOTION<small>Calmer camera and interface movement</small></span><b>OFF</b></button>
          <button type="button" role="switch" data-intro-setting="highContrast" aria-checked="false"><span>HIGH CONTRAST<small>Stronger instrument separation</small></span><b>OFF</b></button>
          <button type="button" role="switch" data-intro-setting="dynamicRes" aria-checked="true"><span>DYNAMIC RESOLUTION<small>Protect frame rate under load</small></span><b>ON</b></button>
          <div class="sf-entry__scale"><span>HUD SCALE</span><div role="group" aria-label="HUD scale"><button type="button" data-intro-hud-scale="standard">STANDARD</button><button type="button" data-intro-hud-scale="large">LARGE</button></div></div>
        </div>
      </section>
      <footer class="sf-entry__footer"><span class="sf-intro__sound">Sound begins after your first command</span><b>AUTOSAVE · 42 SEC + MILESTONES</b></footer>
    </div>
    <button class="sf-intro__skip" type="button" data-intro-skip disabled>Skip descent <span>↗</span></button>
    <div class="sf-intro__pause" aria-live="polite">DESCENT HELD</div>
  `;
}

function entryClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function entrySavedAt(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "NO RECORD";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(Number(timestamp))).toUpperCase();
  } catch (_) { return "RECORDED"; }
}

/* ============================================================
   CONTROLLER
   ============================================================ */

export function buildDropIntro(ctx, options = {}) {
  const enabled = options.enabled !== false;
  const host = options.host;
  if (!enabled || !host) {
    return {
      enabled: false, done: true, scene: null, camera: null,
      isBlocking: () => false, update() {}, resize() {}, skip() {}, seek() {},
      advance() {}, start: async () => false, resumeSaved: async () => false,
      reveal: () => false, dispose() {},
      markers: () => ({ ...DROP_INTRO_MARKERS }),
      status: () => ({ enabled: false, completed: true, phase: "disabled" }),
    };
  }

  const initialSettings = options.settingsState?.() || {};
  const reducedMotion = options.reducedMotion
    ?? initialSettings.reducedMotion
    ?? window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const manualClock = !!options.manualClock;
  /* Reduced motion keeps the authored pacing instead of compressing
     the same camera travel into a faster edit. It removes shake,
     scan/flash animation and most particles; Skip stays available
     from the first frame. */
  const duration = DROP_INTRO_DURATION;
  const timeScale = DROP_INTRO_DURATION / duration;
  const { THREE } = ctx;
  const stage = options.stage;
  const audio = options.audio;
  const render = options.render;
  const pod = options.pod || ctx.pod;
  const cinematicStep = options.cinematicStep || (() => false);
  const onComplete = options.onComplete || (() => {});
  const readSaves = options.readSaves || (() => ({ autosave: null, manuals: [] }));
  const onLoad = options.onLoad || (() => false);
  const settingsState = options.settingsState || (() => ({}));
  const onSetting = options.onSetting || (() => false);

  const site = {
    x: DROP_SITE.podX, z: DROP_SITE.podZ, yaw: DROP_SITE.podYaw,
  };
  /* The trooper's first step is taken at the foot of the gangway,
     measured off the deployed ramp rather than guessed, and the walk
     ends on the level's own spawn mark. Both ends of the egress are
     therefore facts about the level, not numbers in a cutscene. */
  const forward = new THREE.Vector3(Math.sin(site.yaw), 0, Math.cos(site.yaw));
  const egressStart = {
    x: site.x + forward.x * (POD_DOOR_REACH + 0.8),
    z: site.z + forward.z * (POD_DOOR_REACH + 0.8),
  };
  const egressYaw = Math.atan2(DROP_SITE.x - egressStart.x, DROP_SITE.z - egressStart.z);

  let orbit = buildOrbitScene(ctx, !!reducedMotion);
  let rig = buildDescentRig(ctx, !!reducedMotion, site);
  /* What the CINEMATIC costs in the live half. The scene budget must
     not be measured against ctx.scene there: that is the whole game,
     and reporting its census as the intro's would either fail every
     descent marker or force the budget so wide it stops meaning
     anything. Draw calls are covered separately by renderer.info. */
  const rigDiagnostics = (() => {
    const own = sceneDiagnostics(rig.root);
    const p = pod?.diagnostics?.() || { meshes: 0, triangles: 0, materials: 0 };
    return {
      meshes: own.meshes + p.meshes,
      instanced: own.instanced,
      triangles: own.triangles + p.triangles,
      points: own.points,
      geometries: own.geometries,
      materials: own.materials + p.materials,
    };
  })();
  buildMarkup(host);

  const el = (selector) => host.querySelector(selector);
  const startButton = el("[data-intro-start]");
  const continueButton = el("[data-intro-continue]");
  const gate = el(".sf-intro__gate");
  const loadToggle = el("[data-intro-load-toggle]");
  const optionsToggle = el("[data-intro-options-toggle]");
  const saveStatusEl = el("[data-intro-save-status]");
  const continueMetaEl = el("[data-intro-continue-meta]");
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
    shot: "orbit",
    altitude: 120000,
    velocity: 0,
    heat: .04,
    turbulence: 0,
    stress: 0,
    hatch: 0,
    blend: 0,
    handoffCount: 0,
    impactCount: 0,
    cueIndex: 0,
    idle: 0,
    egressArmed: false,
    walking: false,
    entryPanel: "main",
    latestSave: null,
    launchMode: "menu",
  };

  function fieldRecords() {
    let data = {};
    try { data = readSaves() || {}; } catch (_) { data = {}; }
    const records = [
      { kind: "autosave", index: -1, record: data.autosave || null },
      ...Array.from({ length: 3 }, (_, index) => ({
        kind: "manual", index, record: data.manuals?.[index] || null,
      })),
    ];
    return records.filter((entry) => entry.record?.snapshot?.timestamp);
  }

  function setEntryPanel(panel = "main", { focus = true } = {}) {
    const next = panel === "load" || panel === "options" ? panel : "main";
    state.entryPanel = next;
    gate.dataset.entryPanel = next;
    host.querySelectorAll("[data-intro-panel]").forEach((section) => {
      section.hidden = section.dataset.introPanel !== next;
    });
    loadToggle.setAttribute("aria-expanded", next === "load" ? "true" : "false");
    optionsToggle.setAttribute("aria-expanded", next === "options" ? "true" : "false");
    if (focus && next !== "main") {
      requestAnimationFrame(() => host.querySelector(
        `[data-intro-panel="${next}"] button:not([disabled])`)?.focus?.({ preventScroll: true }));
    }
    return next;
  }

  function refreshEntryMenu() {
    if (state.disposed) return null;
    const records = fieldRecords();
    const latest = records.slice().sort((a, b) =>
      Number(b.record.snapshot.timestamp) - Number(a.record.snapshot.timestamp))[0] || null;
    state.latestSave = latest ? { kind: latest.kind, index: latest.index,
      timestamp: latest.record.snapshot.timestamp } : null;
    continueButton.disabled = !latest || state.mode !== "awaiting-gesture";
    saveStatusEl.textContent = records.length
      ? `${records.length} ${records.length === 1 ? "RECORD" : "RECORDS"} VERIFIED`
      : "NO DEPLOYMENT RECORD";
    if (latest) {
      const snapshot = latest.record.snapshot;
      continueMetaEl.textContent = `${snapshot.summary?.district || "VESPER-IX"} · ${entryClock(snapshot.summary?.elapsed)}`;
    } else continueMetaEl.textContent = "NO FIELD RECORD";

    host.querySelectorAll("[data-intro-load-kind]").forEach((button) => {
      const kind = button.dataset.introLoadKind;
      const index = Number(button.dataset.introLoadIndex);
      const entry = records.find((candidate) => candidate.kind === kind && candidate.index === index);
      const snapshot = entry?.record?.snapshot || null;
      button.disabled = !snapshot || state.mode !== "awaiting-gesture";
      button.querySelector("[data-intro-slot-district]").textContent = snapshot
        ? (snapshot.summary?.district || "VESPER-IX") : "EMPTY";
      button.querySelector("[data-intro-slot-time]").textContent = snapshot
        ? `${entrySavedAt(snapshot.timestamp)} · ${entryClock(snapshot.summary?.elapsed)}` : "—";
    });

    const current = settingsState() || {};
    host.querySelectorAll("[data-intro-setting]").forEach((button) => {
      const name = button.dataset.introSetting;
      const enabled = name === "sound" ? current.audioEnabled !== false : !!current[name];
      button.setAttribute("aria-checked", enabled ? "true" : "false");
      button.querySelector("b").textContent = enabled ? "ON" : "OFF";
    });
    host.querySelectorAll("[data-intro-hud-scale]").forEach((button) => {
      const active = button.dataset.introHudScale === (current.hudScale || "standard");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    return state.latestSave;
  }

  function setEntryActionsDisabled(disabled) {
    startButton.disabled = disabled;
    continueButton.disabled = disabled || !state.latestSave;
    loadToggle.disabled = disabled;
    optionsToggle.disabled = disabled;
    host.querySelectorAll("[data-intro-load-kind]").forEach((button) => {
      if (disabled) button.disabled = true;
    });
  }

  /* The lander is BORROWED, not built. Reparenting it into the
     orbital scene and back is what lets one object be both the thing
     in the cinematic and the thing standing in the level. */
  function lendPod(toOrbit) {
    if (!pod) return;
    const target = toOrbit ? orbit.scene : ctx.scene;
    if (pod.root.parent !== target) target.add(pod.root);
  }

  /* The level's own drop-site steam is authored for a lander that is
     already sitting in the hole. Left running, the wide shots have
     two smoke columns rising out of an empty crater for six seconds
     before anything arrives. */
  const sitePlumes = (ctx.vfx?.plumes || []).filter((mesh) =>
    Math.hypot(mesh.position.x - site.x, mesh.position.z - site.z) < 14);
  function setSitePlumes(on) {
    for (const mesh of sitePlumes) mesh.visible = on;
  }

  function hideTrooper() {
    if (!ctx.player) return;
    ctx.player.state.figureOverride = false;
    ctx.player.figure.root.visible = false;
  }
  function showTrooper() {
    if (!ctx.player) return;
    ctx.player.state.figureOverride = null;
    ctx.player.figure.root.visible = true;
  }

  const camTarget = new THREE.Vector3();

  /** Aim a camera, with the authored shake folded in once. */
  function aim(cam, x, y, z, tx, ty, tz, fov, roll = 0) {
    const scale = state.reducedMotion ? .16 : 1;
    const shake = state.turbulence * scale;
    const sx = Math.sin(state.canonical * 31.1) * shake * .055
      + Math.sin(state.canonical * 13.7 + 1.3) * shake * .025;
    const sy = Math.sin(state.canonical * 26.3 + .8) * shake * .045;
    const sz = Math.sin(state.canonical * 19.9 + 2.2) * shake * .035;
    cam.position.set(x + sx, y + sy, z + sz);
    camTarget.set(tx, ty, tz);
    cam.lookAt(camTarget);
    cam.rotateZ(roll * (state.reducedMotion ? .18 : 1)
      + Math.sin(state.canonical * 17.3) * shake * .0025);
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /* ---------------------------- telemetry ---------------------------- */

  function metricsAt(t) {
    let altitude = 120000;
    let velocity = 0;
    let heat = .04;
    if (t < M.release) velocity = lerp(0, 38, ease(t, 0, M.release));
    else if (t < M.entry) {
      altitude = lerp(120000, 96000, ease(t, M.release, M.entry));
      velocity = lerp(110, 7240, ease(t, M.release, M.entry));
      heat = lerp(.04, .20, ease(t, M.orbit, M.entry));
    } else if (t < M.turbulence) {
      altitude = lerp(96000, 31000, ease(t, M.entry, M.turbulence));
      velocity = lerp(7240, 5180, ease(t, M.entry, M.turbulence));
      heat = lerp(.24, .98, Math.sin(range(t, M.entry, M.turbulence) * Math.PI * .74));
    } else if (t < M.cloudBreak) {
      altitude = lerp(31000, 1400, ease(t, M.turbulence, M.cloudBreak));
      velocity = lerp(5180, 940, ease(t, M.turbulence, M.cloudBreak));
      heat = lerp(.96, .46, ease(t, M.turbulence, M.cloudBreak));
    } else if (t < M.terminal) {
      altitude = lerp(1400, 420, ease(t, M.cloudBreak, M.terminal));
      /* It does not slow down. There is no burn to slow it with, and
         a velocity readout that bleeds off on approach is the single
         clearest way to tell an audience something is landing rather
         than arriving. */
      velocity = lerp(940, 1180, ease(t, M.cloudBreak, M.terminal));
      heat = lerp(.44, .58, ease(t, M.cloudBreak, M.terminal));
    } else if (t < M.impact) {
      altitude = lerp(420, 0, range(t, M.terminal, M.impact) ** 1.7);
      velocity = lerp(1180, 1340, ease(t, M.terminal, M.impact - .05));
      heat = lerp(.58, .74, ease(t, M.terminal, M.impact));
    } else {
      altitude = 0;
      velocity = 0;
      heat = lerp(.74, .05, ease(t, M.impact, M.impact + 2.2));
    }
    return { altitude, velocity, heat };
  }

  /** Where the lander is, in WORLD space, at time t. */
  const podPos = new THREE.Vector3(site.x, 0, site.z);
  function podAt(t) {
    const restY = pod ? pod.restY : rig.ground;
    if (t < M.cloudBreak) {
      podPos.set(site.x, restY + 1400, site.z);
      return podPos;
    }
    let altitude;
    if (t < M.impact) {
      /* One curve, ACCELERATING all the way to the ground. There is
         no gear and no retro burn: the altitude has to keep steepening
         until the frame it stops, because a fall that eases out at the
         bottom is a landing, and this is a collision. */
      /* Near-linear, because that is what terminal velocity IS. An
         eased curve spent half the beat at nine tenths of its
         altitude and then covered 340m in the last second, which no
         camera at any distance can frame: the pod was either a dot
         in the sky or off the top of the screen. */
      const p = range(t, M.cloudBreak, M.impact);
      altitude = 920 * Math.pow(1 - p, 1.15);
    } else {
      /* No rebound. It drove in and stayed in - a bounce would give
         back exactly the mass the whole shot is about. What is left is
         a fraction of a second of the hull ringing itself still. */
      const s = range(t, M.impact, M.impact + .5);
      altitude = -Math.sin(s * Math.PI * 3) * (1 - s) * (1 - s) * 0.14;
    }
    /* A shallow lateral converge, so the descent has a direction and
       the pod is not simply an object sliding down the Y axis. */
    const drift = (1 - ease(t, M.cloudBreak, M.impact - .18)) * 46;
    podPos.set(
      site.x - forward.x * drift * 0.55 - forward.z * drift,
      restY + altitude,
      site.z - forward.z * drift * 0.55 + forward.x * drift,
    );
    return podPos;
  }

  /* ------------------------------ the edit ------------------------------ */

  function showMode(mode) {
    if (state.shot === mode) return;
    state.shot = mode;
    const inOrbit = mode === "orbit";
    lendPod(inOrbit);
    orbit.scene.visible = inOrbit;
    rig.root.visible = !inOrbit;
  }

  /* The lander's track through the orbital act: one straight dive
     aimed at Vesper-IX, so "down" in the edit is always the same
     direction and the planet is always what it is falling toward.

     Every orbital camera is then placed along ONE view direction,
     pitched 25 degrees up off that dive. That single constraint is
     what keeps the planet's limb and the halo inside the frame in
     all four beats: aimed by eye, each shot found a different piece
     of empty sky and the world the drop is aimed at was visible in
     precisely none of them. */
  /* The barge's midships and its beam direction, in world space.
     `carrier` is canted, so a station worked out on the world axes
     ends up looking down the bow instead of across the hull. */
  const BARGE_YAW = 0.21;
  const BARGE_MID = new THREE.Vector3(
    Math.sin(BARGE_YAW) * 8, 29.5, Math.cos(BARGE_YAW) * 8);
  const BARGE_BEAM = new THREE.Vector3(
    Math.cos(BARGE_YAW), 0, -Math.sin(BARGE_YAW));

  const DIVE = new THREE.Vector3(0.30, -0.86, -0.41).normalize();
  const VIEW = new THREE.Vector3(0.490, -0.559, -0.669).normalize();
  const divePos = new THREE.Vector3();
  const hubPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  function diveAt(distance) {
    return divePos.copy(DIVE).multiplyScalar(distance);
  }
  /** A camera station `back` metres up the view axis from `at`. */
  function station(at, back, lift = 0, side = 0) {
    camPos.copy(VIEW).multiplyScalar(-back).add(at);
    camPos.y += lift;
    camPos.x += VIEW.z * side;
    camPos.z -= VIEW.x * side;
    return camPos;
  }

  function applyOrbit(t) {
    showMode("orbit");
    const heat = state.heat;
    orbit.starUniforms.uTime.value = t;
    orbit.starUniforms.uAtmos.value = sstep(M.turbulence, M.cloudBreak + .4, t);
    orbit.planetUniforms.uTime.value = t;
    orbit.plasmaUniforms.uTime.value = t;
    orbit.plasmaUniforms.uHeat.value = clamp01(heat * 1.25 - .10);
    orbit.wakeUniforms.uTime.value = t;
    orbit.wakeUniforms.uHeat.value = clamp01(heat * 1.3 - .14);
    orbit.planet.rotation.y = t * .004;
    orbit.halo.rotation.z = .52 + t * .002;

    const inEntry = t >= M.entry;
    orbit.plasmaRig.visible = inEntry;
    orbit.embers.visible = inEntry && !state.reducedMotion;
    orbit.carrier.visible = t < M.entry + .6;

    if (pod) {
      pod.setHeat(t >= M.entry ? clamp01((heat - .12) * 1.16) : 0);
      /* Rings only, never the shaft: a 26m column of god-light
         standing off the nose in hard vacuum is the one effect on
         this pod that belongs strictly to the ground. */
      pod.setHalo(t < M.release ? .34 : lerp(.34, 0, ease(t, M.release, M.entry)));
      pod.setGlow(t < M.entry ? .34 : lerp(.34, .06, ease(t, M.entry, M.turbulence)));
    }

    const hub = hubPos.set(0, 3.4, 0);
    if (t < M.release) {
      /* Clamped in the cradle, shot from UNDERNEATH. Vesper-IX gets
         its own beat two shots from now; what this one has to say is
         only "here is the object, and it is hanging off a warship" -
         and the one camera that can see both the lander's belly and
         the barge's keel is the one looking up between them. */
      /* BROADSIDE, AND A LONG WAY OFF. A five-hundred-metre ship
         framed from forty metres is a wall - you get plating, not a
         vessel. This holds off the beam at a hundred and thirty so
         the nave, the bay row and the drive cluster are all in one
         frame, with the lander hanging off it at three per cent of
         frame height: the whole point of the shot is that ratio.

         Stationed off the hull's OWN axis rather than at fixed world
         coordinates, so the barge can be re-canted without this
         drifting round to a three-quarter view of its bow. */
      const p = ease(t, 0, M.release);
      if (pod) pod.setTransform(0, 0, 0, 0, 0.62, 0);
      const beam = lerp(305, 132, p);
      aim(orbit.camera,
        BARGE_MID.x + BARGE_BEAM.x * beam,
        BARGE_MID.y - 118 + p * 56,
        BARGE_MID.z + BARGE_BEAM.z * beam,
        BARGE_MID.x - BARGE_BEAM.z * 26, BARGE_MID.y + 2.5,
        BARGE_MID.z + BARGE_BEAM.x * 26,
        lerp(52, 57, p), -.02);
    } else if (t < M.orbit) {
      /* The clamps blow and the lander falls straight past the lens.
         The camera stays with the BARGE, so the pod leaves frame
         rather than the frame following it - which is the only way a
         release reads as a release. */
      const p = ease(t, M.release, M.orbit);
      const fall = p * p * 46;
      const q = diveAt(fall);
      if (pod) pod.setTransform(q.x, q.y, q.z, -p * .12, 0.62 + p * .22, p * .06);
      const open = ease(t, M.release, M.release + .5);
      orbit.clamps.forEach((c, i) => {
        const a = (i / 4) * TAU + Math.PI / 4;
        c.position.set(Math.sin(a) * (2.5 + open * 2.6), -1.2 + (i % 2) * 2.4 + open * .7,
          Math.cos(a) * (2.5 + open * 2.6));
        c.rotation.z = open * (i % 2 ? 1.1 : -0.8);
      });
      /* In close for the clamps, and drifting aft as the lander
         drops, so the hull runs across frame and the eye gets the
         length of the thing at the moment the pod leaves it. */
      aim(orbit.camera,
        -40 - p * 10.0, -12.5 + p * 5.0, 32 + p * 14.0,
        DIVE.x * fall * .7, 7.5 + DIVE.y * fall * .7, DIVE.z * fall * .7,
        lerp(51, 60, p), -.02 - p * .05);
    } else if (t < M.entry) {
      /* The long view. The lander is a bright chip on a black field,
         Vesper-IX's lit limb curving underneath it and the shattered
         halo cutting across. Nothing moves fast; this is the beat
         that says how far there is to fall. */
      const p = ease(t, M.orbit, M.entry);
      const q = diveAt(46 + p * 190);
      if (pod) pod.setTransform(q.x, q.y, q.z, -.12 - p * .26, .84 + p * .5, .06 + p * .12);
      const c = station(q, lerp(58, 46, p), lerp(6, 2, p), lerp(6, -4, p));
      aim(orbit.camera, c.x, c.y, c.z, q.x, q.y - 1.5, q.z,
        lerp(31, 27, p), -.05 - p * .03);
    } else {
      /* Entry. The camera rides just off the shoulder while the
         sheath builds around the ablative skirt, then drifts back
         into the wake as the turbulence peaks and the star field is
         replaced by daylit atmosphere. */
      const p = ease(t, M.entry, M.cloudBreak);
      const spin = Math.sin(t * .8) * .10;
      const q = diveAt(236 + p * 1120);
      if (pod) {
        pod.setTransform(q.x, q.y, q.z, -.38 - p * .14, 1.2 + spin, .18 - p * .12);
        orbit.plasmaRig.position.copy(pod.root.position);
        orbit.plasmaRig.rotation.copy(pod.root.rotation);
        orbit.plasmaRig.scale.setScalar(1 + p * .10);
      }
      const swing = Math.sin(p * Math.PI * .9);
      const c = station(q, lerp(17, 30, p), lerp(-1.5, 5.0, p), lerp(7, -9, p) * swing);
      aim(orbit.camera, c.x, c.y, c.z, q.x, q.y + lerp(1.2, -2.0, p), q.z,
        lerp(42, 58, p), -.09 - p * .14);
      updateEmbers(t, q);
    }
  }

  /** Ablative shedding off the skirt, streaming back up the track. */
  function updateEmbers(t, at) {
    const attr = orbit.embers.geometry.attributes.position;
    const base = orbit.emberBase;
    const out = orbit.emberPos;
    for (let i = 0; i < attr.count; i += 1) {
      const k = i * 4;
      const travel = ((base[k + 1] + t * base[k + 3] * 30) % 62);
      const spread = 1 + travel * .045;
      out[i * 3] = at.x + base[k] * spread - DIVE.x * travel;
      out[i * 3 + 1] = at.y + base[k + 2] * spread * .4 - DIVE.y * travel;
      out[i * 3 + 2] = at.z + base[k + 2] * spread - DIVE.z * travel;
    }
    attr.needsUpdate = true;
  }

  function applyDescent(t) {
    showMode(t >= M.egress ? "egress" : (t >= M.impact ? "surface" : "descent"));
    const cam = rig.camera;
    const p = podAt(t);
    const restY = pod ? pod.restY : rig.ground;

    /* ---- the lander ---- */
    if (pod) {
      /* It never stops tumbling on the way in, and it never corrects.
         The attitude it arrives at is the attitude it keeps, easing
         into the level's authored landed tilt over the half second
         after contact - so the last cinematic frame and the pod that
         stands here forever are the same pose. */
      const tumble = 1 - ease(t, M.cloudBreak, M.impact);
      const settle = ease(t, M.impact, M.impact + .5);
      pod.setTransform(
        p.x, p.y, p.z,
        lerp(tumble * (0.30 + Math.sin(t * 3.4) * .12), POD_LANDED_PITCH, settle),
        site.yaw + tumble * Math.sin(t * 1.9) * .20 * (1 - settle),
        lerp(tumble * (Math.cos(t * 2.8) * .14), POD_LANDED_ROLL, settle),
      );
      pod.setHeat(t < M.impact ? clamp01((state.heat - .16) * 1.5) : 0);
      /* Bolts blow half a second after contact and the doors are
         THROWN, not lowered - fast open, then a slow last few degrees
         as they take up on their own weight. */
      pod.setPetals(ease(t, M.hatch, M.hatch + 1.15));
      pod.setGlow(t < M.hatch ? .08 : ease(t, M.hatch, M.hatch + 1.2));
      pod.setHalo(ease(t, M.hatch + .9, M.egress + .6));
      if (t >= M.impact) pod.scorch();
    }

    setSitePlumes(t >= M.impact);

    /* The orbital act's sheath belongs to the orbital scene, and
       nothing in this branch would ever hide it again. Left set, the
       status reported plasma still burning on a lander that had been
       sitting on the sand for four seconds. */
    if (orbit) {
      orbit.plasmaRig.visible = false;
      orbit.embers.visible = false;
    }

    /* ---- the ceiling the lander came through ----
       It stays where it is. Sliding the deck down after the break
       made it chase the camera and wash the basin out again half a
       second after the reveal; a cloud ceiling is a fixed altitude,
       and the pod leaving it behind is the whole read. */
    const breakP = range(t, M.cloudBreak - .55, M.cloudBreak + 1.6);
    rig.cloudMat.opacity = lerp(.62, .30, smootherstep(breakP));
    rig.deck.visible = t < M.terminal + 1.5;

    const falling = t < M.impact;
    rig.trail.visible = falling && t >= M.cloudBreak - .2;
    if (rig.trail.visible) {
      rig.trail.position.set(p.x, p.y, p.z);
      const fade = 1 - ease(t, M.impact - .5, M.impact - .05);
      rig.trailMat.opacity = .46 * fade;
      rig.smokeMat.opacity = .26 * (1 - ease(t, M.impact - .8, M.impact + .6));
      rig.plume.scale.setScalar(lerp(1.25, 1.7, ease(t, M.cloudBreak, M.impact)));
    }

    /* ---- landfall ---- */
    const hit = t >= M.impact;
    rig.impact.visible = hit && t < M.egress + 1.9;
    if (rig.impact.visible) {
      const age = t - M.impact;
      /* Everything here is front-loaded to the first third of a
         second. An impact that blooms over a second and a half is an
         explosion in a film; a body arriving at 1300 m/s throws its
         entire ejecta curtain before the sound reaches you. */
      rig.flashMat.opacity = Math.max(0, 1 - age * 3.4);
      rig.flash.scale.setScalar(1 + age * 9);
      rig.rings.forEach((ring, i) => {
        const rp = ease(t, M.impact + i * .05, M.impact + .85 + i * .3);
        ring.visible = rp > 0 && rp < 1;
        ring.scale.setScalar(2.0 + rp * (44 + i * 16));
        ring.material.opacity = (1 - rp) * (1 - rp) * .3;
      });
      const spread = ease(t, M.impact, M.impact + .55);
      const settleOut = 1 - ease(t, M.impact + 1.7, M.egress + 1.8);
      rig.dustMat.opacity = Math.min(1, spread * 2.4) * settleOut * .82;
      for (const card of rig.curtain.children) {
        const a = card.userData.angle;
        // Thrown OUT and low, then lifting - ejecta, not a mushroom.
        const r = 3 + spread * 26;
        card.position.set(
          Math.cos(a) * r,
          2 + spread * 4 + Math.sin(spread * Math.PI) * 5,
          Math.sin(a) * r);
        card.scale.setScalar(0.75 + spread * 1.9);
      }
    }

    /* ---- the light out of the open reliquary ---- */
    const spillP = ease(t, M.hatch + .7, M.egress);
    rig.spillMat.opacity = spillP * .30 * (1 - ease(t, DROP_INTRO_DURATION - 1.2, DROP_INTRO_DURATION));
    rig.spill.visible = rig.spillMat.opacity > .004;
    rig.spill.scale.setScalar(.5 + spillP * .5);

    /* ---- the camera ---- */
    const groundY = rig.ground;
    if (t < BLEND_FROM) state.blend = 0;
    if (t < M.terminal) {
      /* Out from under the ceiling. The camera flies WITH the pod at
         a close offset, tilted down past it, so the frame holds the
         lander large in the upper third and the whole basin - road,
         gate, Vault-Cathedral - opening up underneath it. A first
         pass orbited a point 90m out and the lander was four pixels
         of white in an empty sky. */
      const q = ease(t, M.cloudBreak, M.terminal);
      const a = site.yaw + lerp(-2.62, -2.24, q);
      const dist = lerp(34, 27, q);
      aim(cam,
        p.x + Math.sin(a) * dist,
        p.y + lerp(11, 5, q),
        p.z + Math.cos(a) * dist,
        p.x + (site.x - p.x) * lerp(.10, .32, q),
        p.y - lerp(15, 10, q),
        p.z + (site.z - p.z) * lerp(.10, .32, q),
        lerp(62, 56, q), -.09 * (1 - q));
    } else if (t < M.impact) {
      /* Terminal. The station eases OFF the falling pod and ONTO the
         drop site through the last second and a half, so the lander
         arrives INTO a locked shot instead of the camera riding it
         all the way down.

         The look-at stays on the POD the whole time. Interpolating
         the target as well as the station pointed the lens at a
         height between the two - which for half a second is neither
         the pod nor the ground, i.e. empty sky with the subject a
         hundred metres above the top of frame. */
      const q = ease(t, M.terminal, M.impact);
      /* Ride it down, then WHIP onto the drop site for the last half
         second. Nothing else works: 150 m/s means the pod is 150m up
         one second out, and from any station close enough to see the
         ground it is eighty degrees overhead. So the shot follows the
         pod while it is high and only becomes a shot of the GROUND
         once the pod is low enough to share the frame with it. */
      const lock = smootherstep(clamp01((t - (M.impact - 0.55)) / 0.55));
      const a = site.yaw + lerp(-2.24, -1.62, q);
      const ride = lerp(30, 24, q);
      aim(cam,
        lerp(p.x + Math.sin(a) * ride, site.x + Math.sin(a) * 46, lock),
        lerp(p.y + 7, groundY + 11, lock),
        lerp(p.z + Math.cos(a) * ride, site.z + Math.cos(a) * 46, lock),
        lerp(p.x, site.x, lock),
        lerp(p.y - 9, restY + 2.4, lock),
        lerp(p.z, site.z, lock),
        lerp(56, 50, q), .03 * q);
    } else if (t < M.hatch) {
      /* The slam. High enough to clear the shoulder of the basin -
         at eye level the drop site sits behind a dune and the whole
         landing happens off-screen - and shaken hard for half a
         second while the dust wall crosses the lens. */
      const q = ease(t, M.impact, M.hatch);
      const kick = Math.sin(q * Math.PI * 3.0) * (1 - q) * .8;
      const a = site.yaw + lerp(-1.62, -1.34, q);
      aim(cam,
        site.x + Math.sin(a) * (23 - q * 2), groundY + 6.6 + kick,
        site.z + Math.cos(a) * (22 + q * 3),
        site.x, restY + 2.4 + kick * .4, site.z,
        lerp(56, 48, q), kick * .02);
    } else if (t < M.egress) {
      /* Round to the front and push in as the petals part, so the
         reliquary opens straight down the lens. The pod faces the
         causeway, so this move also turns the camera to look up the
         road the player is about to walk. */
      const q = ease(t, M.hatch, M.egress);
      /* Down to just above the rampart. The crater only reads as a
         hole when its own rim is between the lens and the pod - from
         seven metres up it is a dark patch of sand with a lander
         standing in the middle of it. */
      const a = lerp(-1.34, -0.16, q);
      const dist = lerp(22, 17, q);
      aim(cam,
        site.x + Math.sin(site.yaw + a) * dist,
        groundY + lerp(4.4, 2.6, q),
        site.z + Math.cos(site.yaw + a) * dist,
        site.x + forward.x * 1.6, restY + lerp(3.4, 3.2, q), site.z + forward.z * 1.6,
        lerp(48, 45, q), 0);
    } else {
      /* Egress. The camera starts AHEAD of the trooper, so the shot
         is a soldier walking out of a lit reliquary and not the back
         of a helmet with the pod behind the lens, then turns a half
         circle around them into the chase position.

         The turn is driven BY the blend, not by its own clock. Both
         end behind the trooper, and behind the trooper - five metres
         from a lander with a six-metre gangway out - is a place a
         camera can only be if something is checking geometry for it.
         The gameplay rig does that check; an independently timed arc
         got there first and spent a second inside the handrail. */
      state.blend = ease(t, BLEND_FROM, DROP_INTRO_DURATION);
      const turn = state.blend;
      const px = ctx.player ? ctx.player.state.x : egressStart.x;
      const pz = ctx.player ? ctx.player.state.z : egressStart.z;
      const py = ctx.player ? ctx.player.state.y : groundY;
      const hold = ease(t, M.egress, BLEND_FROM);
      const swing = egressYaw + turn * Math.PI;
      const dist = lerp(8.6, 6.2, turn) - hold * 0.6;
      aim(cam,
        px + Math.sin(swing) * dist,
        py + lerp(2.55, 2.05, turn),
        pz + Math.cos(swing) * dist,
        px + Math.sin(egressYaw) * turn * 3.4, py + lerp(1.5, 1.5, turn),
        pz + Math.cos(egressYaw) * turn * 3.4,
        lerp(46, render.camera.fov, turn), 0);

      if (state.blend > 0) {
        const live = render.camera;
        cam.position.lerp(live.position, state.blend);
        cam.quaternion.slerp(live.quaternion, state.blend);
        const fov = lerp(cam.fov, live.fov, state.blend);
        if (Math.abs(cam.fov - fov) > 1e-4) {
          cam.fov = fov;
          cam.updateProjectionMatrix();
        }
        if (state.blend >= 0.999) {
          cam.position.copy(live.position);
          cam.quaternion.copy(live.quaternion);
          cam.fov = live.fov;
          cam.updateProjectionMatrix();
        }
      }
    }

    /* Billboards last, once the camera for THIS frame is final.
       Orienting them earlier leaves a flat card edge-on to the lens
       for the one frame that matters most - the flash. */
    if (rig.impact.visible) rig.flash.quaternion.copy(cam.quaternion);
  }

  /* ------------------------- the egress handoff ------------------------- */

  function armEgress() {
    if (state.egressArmed || !ctx.player) return;
    state.egressArmed = true;
    /* Stood at the foot of the gangway, already facing the road.
       `spawn` also unplants the feet, which is what keeps the first
       stride from being taken with the legs folded up inside the
       robe. */
    ctx.player.spawn(egressStart.x, egressStart.z, egressYaw);
    ctx.player.state.camYaw = egressYaw;
    showTrooper();
  }

  function driveWalk() {
    if (!ctx.player) return;
    const s = ctx.player.state;
    const left = Math.hypot(DROP_SITE.x - s.x, DROP_SITE.z - s.z);
    /* Walk to the level's own spawn mark and stop there. Releasing
       on DISTANCE rather than on the clock means the trooper never
       overshoots the road onto the shoulder if a frame runs long.

       Injected at PART throttle. The gangway is five metres from the
       spawn mark and a full-stick 4.4m/s walk crosses that in under
       a second, leaving the trooper standing at attention for the
       rest of the beat. The locomotion already scales speed by input
       magnitude for half-tilted thumbsticks, so the same code gives
       a measured, weighted walk out of the crater for free, easing
       off as the trooper reaches the mark. */
    const walking = left > 0.7;
    const throttle = walking ? clamp(left / 4.0, 0.40, 0.95) : 0;
    if (walking !== state.walking) {
      state.walking = walking;
      if (!walking) {
        ctx.player.input.inject(null);
        ctx.player.input.clearAll?.();
      }
    }
    if (walking) ctx.player.input.inject(0, -throttle);
  }

  /** Where the walk has got to by time `t`, analytically.
   *
   *  Only `seek` uses this. A seek does no simulation, so the walk
   *  has not happened and the chase rig is still anchored wherever
   *  it was snapped - which, seeking into the blend, is inside the
   *  lander. Re-spawning at the analytic position also resets the
   *  camera anchor, so the captured still frames what a played run
   *  would frame instead of the inside of a hull. */
  function seekTrooper(t) {
    if (!ctx.player || !state.egressArmed) return false;
    const run = Math.hypot(DROP_SITE.x - egressStart.x, DROP_SITE.z - egressStart.z);
    /* Seeking BACKWARD has to rewind the walk too. Left one-way, a
       harness that samples the handoff and then samples an earlier
       marker photographs the trooper already standing on the spawn
       mark five seconds before they get out of the pod. */
    const walked = Math.min(run - 0.7, smootherstep(range(t, M.egress, M.egress + 1.85)) * run);
    ctx.player.spawn(
      egressStart.x + Math.sin(egressYaw) * walked,
      egressStart.z + Math.cos(egressYaw) * walked,
      egressYaw);
    ctx.player.state.camYaw = egressYaw;
    return true;
  }

  function releaseTrooper() {
    if (!ctx.player) return;
    state.walking = false;
    ctx.player.input.inject(null);
    ctx.player.input.clearAll?.();
    ctx.player.state.figureOverride = null;
  }

  /* ------------------------------ timeline ------------------------------ */

  function applyTimeline(t, emitAudio = false) {
    const previous = state.canonical;
    state.canonical = clamp(t, 0, DROP_INTRO_DURATION);
    const c = state.canonical;
    const m = metricsAt(c);
    state.altitude = m.altitude;
    state.velocity = m.velocity;
    state.heat = m.heat;
    state.turbulence = state.reducedMotion ? 0
      : Math.max(
        sstep(M.entry + .5, M.turbulence, c) * (1 - sstep(M.cloudBreak - 1.0, M.cloudBreak, c)),
        /* The plunge itself shakes now. Nothing is slowing the thing
           down, so the buffeting climbs all the way to the ground
           instead of being replaced by a braking burn. */
        sstep(M.cloudBreak, M.impact - .05, c) * .72,
        sstep(M.impact - .12, M.impact, c) * (1 - sstep(M.impact + .7, M.impact + 1.5, c)) * 2.1,
      );
    /* No retro burn exists any more; what the last three seconds
       have instead is the hull screaming. Kept as one number so the
       audio bed and the overlay still have a "how bad is it" input. */
    state.stress = sstep(M.cloudBreak, M.impact - .1, c)
      * (1 - sstep(M.impact, M.impact + .8, c));
    state.hatch = ease(c, M.hatch + .15, M.hatch + 1.55);

    const phase = phaseAt(c);
    state.phase = phase[1];
    phaseEl.textContent = phase[2];
    captionEl.textContent = phase[3];
    titleEl.textContent = c >= M.hatch ? "LANDFALL"
      : (c >= M.cloudBreak ? "THRESHOLD" : "THE DROP");
    altitudeEl.textContent = state.altitude >= 1000
      ? `${(state.altitude / 1000).toFixed(state.altitude >= 10000 ? 1 : 2)} KM`
      : `${Math.max(0, Math.round(state.altitude))} M`;
    velocityEl.textContent = `${Math.max(0, Math.round(state.velocity)).toLocaleString()} M/S`;
    heatEl.textContent = `${Math.round(state.heat * 100).toString().padStart(2, "0")}%`;
    heatbarEl.style.transform = `scaleX(${clamp01(state.heat)})`;
    signalEl.textContent = state.heat > .82 ? "ABLATIVE // CRITICAL"
      : state.stress > .55 ? "NO BURN // BRACE"
        : c >= M.hatch ? "RELIQUARY // OPEN"
          : c >= M.impact ? "CONTACT // SECURE" : "LINK // GREEN";

    if (c < M.cloudBreak) {
      applyOrbit(c);
      if (state.egressArmed) hideTrooper();
    } else {
      applyDescent(c);
    }

    host.style.setProperty("--sf-intro-heat", state.heat.toFixed(3));
    host.style.setProperty("--sf-intro-shake",
      (state.turbulence * (state.reducedMotion ? 0 : 1)).toFixed(3));
    host.style.setProperty("--sf-intro-blend", state.blend.toFixed(3));
    host.dataset.phase = state.phase;
    host.dataset.shot = state.shot;

    if (emitAudio && c >= previous) {
      while (state.cueIndex < CUES.length && CUES[state.cueIndex][0] <= c) {
        const [at, cue] = CUES[state.cueIndex];
        if (at > previous + 1e-5 || previous <= .001) {
          audio?.dropCue?.(cue);
          if (cue === "impact") {
            state.impactCount += 1;
            /* Real world particles, thrown by the real arrival, in a
               ring rather than from one point - a single emitter at
               the axis reads as a puff coming out of the pod instead
               of as ground leaving the ground. */
            const g = rig.ground;
            ctx.vfx?.blast?.(site.x, g, site.z, 34);
            ctx.vfx?.blast?.(site.x, g + 1.4, site.z, 20);
            for (let i = 0; i < 6; i += 1) {
              const a = (i / 6) * TAU + 0.4;
              ctx.vfx?.breach?.(
                site.x + Math.cos(a) * DROP_CRATER.bowl,
                g + 0.4,
                site.z + Math.sin(a) * DROP_CRATER.bowl, 11, 2.2);
            }
          }
        }
        state.cueIndex += 1;
      }
    }
    audio?.updateDrop?.({
      heat: state.heat,
      turbulence: state.turbulence,
      // No retro bed: there are no retros to run one.
      retro: 0,
      altitude: clamp01(state.altitude / 120000),
      velocity: clamp01(state.velocity / 7800),
      paused: state.paused,
    });
  }

  /* ------------------------------ rendering ------------------------------ */

  function renderFrame() {
    if (state.disposed || !orbit || !rig) return false;
    if (state.shot === "orbit") render.render(orbit.camera, orbit.scene);
    else render.render(rig.camera, ctx.scene);
    return true;
  }

  /** Advance the live level enough to be PRESENTED, never played.
   *  Takes the time explicitly: `state.canonical` is still last
   *  frame's value here, and the terrain has to page in against the
   *  altitude the camera is about to be at, not the one it left. */
  function presentWorld(dt, t) {
    if (t < M.cloudBreak - 0.6) return false;
    cinematicStep(dt, { camera: rig.camera, figure: t >= M.egress });
    pod?.update(dt);
    return true;
  }

  /* ------------------------------ lifecycle ------------------------------ */

  async function start() {
    if (state.mode !== "awaiting-gesture" || !state.revealed || state.disposed
      || document.hidden || document.body.classList.contains("rb-escape-menu-open")) return false;
    state.mode = "starting";
    state.launchMode = "new";
    const token = ++state.startToken;
    setEntryActionsDisabled(true);
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

  async function resumeSaved(kind, index = -1) {
    if (state.mode !== "awaiting-gesture" || !state.revealed || state.disposed
      || document.hidden || document.body.classList.contains("rb-escape-menu-open")) return false;
    const match = fieldRecords().find((entry) => entry.kind === kind && entry.index === Number(index));
    if (!match) {
      refreshEntryMenu();
      return false;
    }
    state.mode = "starting";
    state.launchMode = "load";
    const token = ++state.startToken;
    setEntryActionsDisabled(true);
    try { await audio?.unlock?.({ ambience: false }); } catch (_) { /* visual path still resumes */ }
    if (token !== state.startToken || state.disposed || state.completed) return false;
    const finished = complete(true, { preserveSpawn: true, source: "load" });
    if (!finished) return false;
    let restored = false;
    try { restored = !!(await Promise.resolve(onLoad(kind, Number(index)))); } catch (_) { restored = false; }
    if (!restored && ctx.player) {
      ctx.player.spawn(DROP_SITE.x, DROP_SITE.z, DROP_SITE.yaw);
      ctx.mission?.announce?.("FIELD RECORD FAILED · NEW OPERATION READY", 3.2);
    }
    return restored;
  }

  function complete(skipped = false, { preserveSpawn = false, source = "cinematic" } = {}) {
    if (state.completed) return false;
    state.completed = true;
    state.skipped = !!skipped;
    state.mode = skipped ? "skipped" : "complete";
    state.paused = false;
    state.startToken += 1;
    pauseTransition += 1;
    state.handoffCount += 1;
    state.hatch = 1;
    state.blend = 1;

    /* Hand everything back exactly where the level expects it. A
       skip jumps this from the middle of the fall, so it has to
       restore the same end state the full run arrives at. */
    lendPod(false);
    pod?.land();
    setSitePlumes(true);
    releaseTrooper();
    state.launchMode = source;
    if (skipped && ctx.player && !preserveSpawn) {
      ctx.player.spawn(DROP_SITE.x, DROP_SITE.z, DROP_SITE.yaw);
    }
    if (rig) {
      rig.root.visible = false;
      rig.trail.visible = false;
      rig.impact.visible = false;
      rig.deck.visible = false;
      rig.spill.visible = false;
    }
    if (orbit) orbit.scene.visible = false;
    state.shot = "handoff";

    audio?.endDrop?.({ handoff: true });
    host.classList.remove("is-running", "is-paused");
    host.classList.add("is-finished");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
    host.dataset.shot = "handoff";
    skipButton.disabled = true;
    stage?.classList.remove("sf-intro-active");
    onComplete({ skipped: state.skipped, handoffCount: state.handoffCount, source });
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
    /* Hold the visual clock until the serialized AudioContext resume
       has actually settled, so the first cue after Resume cannot be
       emitted into a still-suspended context and disappear. */
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
      // A breath of drift on the held frame, so the gate is not a
      // screenshot with a button on it.
      orbit.camera.position.x += Math.sin(state.idle * .42) * .02;
      orbit.camera.position.y += Math.cos(state.idle * .31) * .012;
      renderFrame();
      return true;
    }
    if (state.paused) {
      renderFrame();
      return true;
    }
    const step = Math.min(.1, Math.max(0, dt));
    if (!manualClock) state.elapsed += step;
    const canonical = state.elapsed * timeScale;
    /* Arm and drive the trooper BEFORE the timeline runs, so the
       camera that frames the walk-out is reading this frame's body
       position rather than last frame's. */
    if (canonical >= M.egress) {
      armEgress();
      driveWalk();
    }
    presentWorld(step, canonical);
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
    if (canonical >= M.egress) armEgress();
    seekTrooper(canonical);
    /* Two zero-delta presents, so a seek into the live half pages in
       terrain LOD and enemy culling against the seeked camera before
       the frame is captured. The first one moves the camera, the
       second one culls against where it landed. */
    applyTimeline(canonical, false);
    presentWorld(0, canonical);
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
      const canonical = state.elapsed * timeScale;
      if (canonical >= M.egress) {
        armEgress();
        driveWalk();
      }
      presentWorld(d, canonical);
      applyTimeline(canonical, false);
      left -= d;
    }
    renderFrame();
    if (state.elapsed * timeScale >= DROP_INTRO_DURATION - 1e-4) complete(false);
    return status();
  }

  function resize(width, height) {
    if (state.disposed || !orbit || !rig) return false;
    const aspect = Math.max(1, width) / Math.max(1, height);
    orbit.camera.aspect = aspect;
    orbit.camera.updateProjectionMatrix();
    rig.camera.aspect = aspect;
    rig.camera.updateProjectionMatrix();
    return true;
  }

  let disposedStatus = null;
  function dispose() {
    if (state.disposed) return;
    disposedStatus = status();
    state.disposed = true;
    observer?.disconnect();
    stopSaveSubscription?.();
    startButton.removeEventListener("click", start);
    continueButton.removeEventListener("click", onContinue);
    gate.removeEventListener("click", onGateClick);
    skipButton.removeEventListener("click", skip);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("visibilitychange", onVisibility);
    /* The pod is the level's, not the cinematic's. Send it home
       before anything here is torn down, or disposing the intro
       deletes the landmark it just landed. */
    lendPod(false);
    pod?.land();
    setSitePlumes(true);
    releaseTrooper();
    if (orbit) {
      disposeTree(orbit.scene, orbit.textures);
      orbit.scene.clear();
      orbit = null;
    }
    if (rig) {
      rig.root.parent?.remove(rig.root);
      disposeTree(rig.root, rig.textures);
      rig = null;
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
    const podPose = pod ? pod.pose : { petals: 0, glow: 0 };
    return {
      enabled: true,
      active: !state.completed,
      disposed: false,
      revealed: state.revealed,
      started: state.started,
      completed: state.completed,
      skipped: state.skipped,
      mode: state.mode,
      launchMode: state.launchMode,
      entryPanel: state.entryPanel,
      hasSave: !!state.latestSave,
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
      /** How far the cinematic camera has become the gameplay camera. */
      cameraBlend: Number(state.blend.toFixed(3)),
      pod: {
        position: pod ? pod.root.position.toArray().map((v) => Number(v.toFixed(3))) : [0, 0, 0],
        velocity: Math.round(state.velocity),
        altitude: Math.round(state.altitude),
        hatch: Number(state.hatch.toFixed(3)),
        petals: Number(podPose.petals.toFixed(3)),
        landed: state.canonical >= M.impact,
        /** Metres between the flown pod and the level's landed mark. */
        siteError: pod ? Number(Math.hypot(
          pod.root.position.x - site.x, pod.root.position.z - site.z).toFixed(3)) : 0,
      },
      trooper: ctx.player ? {
        visible: !!ctx.player.figure.root.visible,
        walking: state.walking,
        x: Number(ctx.player.state.x.toFixed(2)),
        z: Number(ctx.player.state.z.toFixed(2)),
        toSpawn: Number(Math.hypot(
          DROP_SITE.x - ctx.player.state.x, DROP_SITE.z - ctx.player.state.z).toFixed(2)),
      } : null,
      effects: {
        plasma: !!orbit?.plasmaRig.visible,
        stress: Number(state.stress.toFixed(3)),
        dust: !!rig?.impact.visible && rig.dustMat.opacity > .004,
        shockwave: !!rig?.rings.some((ring) => ring.visible),
        clouds: !!rig?.deck.visible,
        turbulence: Number(state.turbulence.toFixed(3)),
      },
      impactCount: state.impactCount,
      audio: a.cinematic || { active: false, sources: 0 },
      scene: state.shot === "orbit"
        ? (orbit?.diagnostics || { meshes: 0, triangles: 0, points: 0, materials: 0 })
        : rigDiagnostics,
    };
  }

  function reveal() {
    if (state.revealed || state.disposed || state.completed || !orbit) return false;
    state.revealed = true;
    host.removeAttribute("inert");
    host.classList.add("is-ready");
    host.setAttribute("aria-hidden", "false");
    stage?.classList.add("sf-intro-active");
    refreshEntryMenu();
    applyTimeline(state.canonical, false);
    renderFrame();
    return true;
  }

  function onKeyDown(event) {
    if (state.mode !== "awaiting-gesture"
      || (event.code !== "Enter" && event.code !== "Space")
      || !state.revealed || document.hidden
      || document.body.classList.contains("rb-escape-menu-open")) return;
    /* Do not steal activation from the shared menu, navigation, forms
       or any other focused control. The global shortcut is only for
       an unfocused play surface; the Deploy button handles its own
       keyboard click through native button semantics. */
    const target = event.target;
    if (target?.closest?.("button, a, input, textarea, select, [contenteditable='true'], [role='button']")) return;
    event.preventDefault();
    if (state.latestSave) void resumeSaved(state.latestSave.kind, state.latestSave.index);
    else void start();
  }

  function onGateClick(event) {
    const target = event.target.closest("button");
    if (!target || state.mode !== "awaiting-gesture") return;
    if (target.matches("[data-intro-load-toggle]")) {
      setEntryPanel(state.entryPanel === "load" ? "main" : "load");
      return;
    }
    if (target.matches("[data-intro-options-toggle]")) {
      setEntryPanel(state.entryPanel === "options" ? "main" : "options");
      return;
    }
    if (target.matches("[data-intro-panel-close]")) {
      const previous = state.entryPanel;
      setEntryPanel("main", { focus: false });
      (previous === "load" ? loadToggle : optionsToggle)?.focus?.();
      return;
    }
    if (target.matches("[data-intro-load-kind]")) {
      void resumeSaved(target.dataset.introLoadKind, Number(target.dataset.introLoadIndex));
      return;
    }
    if (target.matches("[data-intro-setting]")) {
      const name = target.dataset.introSetting;
      const current = settingsState() || {};
      const active = name === "sound" ? current.audioEnabled !== false : !!current[name];
      onSetting(name, !active);
      if (name === "reducedMotion") state.reducedMotion = !active;
      refreshEntryMenu();
      return;
    }
    if (target.matches("[data-intro-hud-scale]")) {
      onSetting("hudScale", target.dataset.introHudScale);
      refreshEntryMenu();
    }
  }
  function onContinue() {
    if (state.latestSave) void resumeSaved(state.latestSave.kind, state.latestSave.index);
  }
  function onVisibility() { setPaused(document.hidden, "visibility"); }
  const observer = new MutationObserver(() => {
    setPaused(document.body.classList.contains("rb-escape-menu-open"), "menu");
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const stopSaveSubscription = options.subscribeSaves?.(() => refreshEntryMenu()) || null;
  startButton.addEventListener("click", start);
  continueButton.addEventListener("click", onContinue);
  gate.addEventListener("click", onGateClick);
  skipButton.addEventListener("click", skip);
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("visibilitychange", onVisibility);

  /* The lander starts sealed, unscorched and clamped in the cradle;
     the trooper is inside it and therefore not standing on the road. */
  pod?.seal();
  hideTrooper();
  state.shot = null;
  refreshEntryMenu();
  applyTimeline(0, false);
  if (!options.deferReveal) reveal();

  return {
    enabled: true,
    get scene() { return state.shot === "orbit" ? (orbit?.scene || null) : ctx.scene; },
    get camera() {
      if (state.disposed) return null;
      return state.shot === "orbit" ? (orbit?.camera || null) : (rig?.camera || null);
    },
    get done() { return state.completed; },
    get state() { return state; },
    isBlocking: () => !state.completed,
    reveal,
    start,
    resumeSaved,
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
