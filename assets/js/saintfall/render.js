/* ============================================================
   SAINTFALL - renderer and post chain

   Scene -> linear HDR target -> bloom -> composite (tone map,
   grade, vignette, sRGB encode) -> canvas.

   Deliberate choices, each of which is a bug this codebase has
   already paid for once:

   - The scene renders to a target whose colour space is LINEAR.
     Tone mapping and the sRGB encode happen exactly once, in the
     composite pass. Encoding twice is what turns mid grey into
     milk, and it presents as "the lighting is wrong" rather than
     as "the pipeline is wrong".

   - Bloom is hand rolled. `UnrealBloomPass` has blanked whole
     frames to black in this project with its own strength at zero,
     and there is no configuration around it. This owns its
     targets, and it guards its input against NaN - one NaN
     anywhere in the frame propagates through the entire blur
     pyramid and takes the picture with it.

   - There is no temporal resolve here, so anything introduced at
     pixel scale is PERMANENT. That rules out film grain and any
     structured pattern meant to be averaged away over frames - it
     would just lay a lattice over every picture, including the sky.

     It does NOT rule out a quantisation dither, and the distinction
     matters: grain adds a signal, a dither removes one. The final
     write is 8-bit and a shadowed dune face or a clear sky can cross
     a code boundary over a hundred pixels, which the eye finds as a
     hard step - a 10x crop of the worst dune in the review was a
     flat wash with horizontal steps in it. Half a code value of
     triangular noise, applied last in sRGB, turns the step into
     something below the display's own resolution. It is spatial, it
     is sub-quantum, and it is the same tool every audio DAC uses.

   - Exposure is fixed per time-of-day preset rather than adapted.
     An eye-adaptation damper makes every captured frame depend on
     what the camera was looking at a moment earlier, which makes
     the review harness measure its own history.
   ============================================================ */

import { clamp, clamp01, lerp, hexToRgb } from "saintfall/core.js";
import { buildSkyEnvironment, srgbTransfer as srgb } from "saintfall/art.js";

/* ------------------------------------------------------------------
   Fullscreen pass plumbing
   ------------------------------------------------------------------ */

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* A NaN check that does not need GLSL ES 3. `!(v >= 0.0)` is true
   for NaN because every comparison against NaN is false. */
const SANITISE = /* glsl */`
float sfOk(float v) { return (v >= 0.0 && v <= 65504.0) ? 1.0 : 0.0; }
vec3 sfSanitise(vec3 c) {
  return vec3(c.r * sfOk(c.r), c.g * sfOk(c.g), c.b * sfOk(c.b));
}
`;

const BRIGHT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec3 uThreshold;   // threshold, knee, -
${SANITISE}
void main() {
  // 4-tap box while downsampling, so the bright pass and the first
  // halving are one pass instead of two.
  vec3 c = sfSanitise(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  c += sfSanitise(texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb);
  c += sfSanitise(texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb);
  c += sfSanitise(texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
  c *= 0.25;

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = uThreshold.y;
  // Soft knee, so a surface drifting past the threshold fades in
  // rather than popping a halo on.
  float soft = clamp(luma - uThreshold.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float contrib = max(soft, luma - uThreshold.x) / max(luma, 1e-5);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

const DOWN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c += texture2D(tSrc, vUv).rgb * 2.0;
  gl_FragColor = vec4(c / 6.0, 1.0);
}
`;

const UP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  // 3x3 tent. Cheap, and it is the filter that stops a bloom
  // pyramid from showing its mip boundaries as square blocks.
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2( uTexel.x, 0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(-uTexel.x, 0.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0,  uTexel.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, -uTexel.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel).rgb;
  c += texture2D(tSrc, vUv - uTexel).rgb;
  c += texture2D(tSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}
`;

/* ------------------------------------------------------------------
   AMBIENT OCCLUSION

   The terrain carries baked occlusion, but nothing standing ON it
   does - so every rock, building, creature and weapon in the level
   sat on the ground without darkening the ground under it, and the
   contacts read as objects pasted over a photograph.

   Depth-only: the view normal is reconstructed from the depth
   buffer's derivatives rather than from a normal buffer. In a
   scene that is flat-shaded end to end that reconstruction is not
   an approximation, it is exact - the facet IS the plane the
   derivatives describe - so it costs one render target instead of
   two.

   The sample rotation is hashed per pixel, and the result is
   blurred before use. This renderer has no temporal resolve, so an
   unblurred AO term would leave its sampling noise in the final
   frame permanently.
   ------------------------------------------------------------------ */

const AO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uNearFar;
uniform mat4 uInvProj;
uniform vec3 uParams;      // world radius (m), intensity, bias
uniform float uProjScale;  // pixels per world unit at unit depth

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float n = uNearFar.x;
  float f = uNearFar.y;
  return -(2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
}

vec3 viewPos(vec2 uv) {
  float z = viewZ(uv);
  vec4 clip = vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec4 eye = uInvProj * clip;
  eye /= eye.w;
  return (eye.xyz / eye.z) * z;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float z = viewZ(vUv);
  if (-z >= uNearFar.y * 0.98) { gl_FragColor = vec4(1.0); return; }

  vec3 p = viewPos(vUv);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (n.z < 0.0) n = -n;

  /* The sample disc is a WORLD radius projected into pixels, not a
     screen radius scaled by a fudge factor.

     Mixing the two is what made the first version inert: the offset
     was screen-space while the range check compared the radius against
     a world-space distance, so at any real depth the samples landed
     several metres away, the range term collapsed, and the whole
     buffer came back white. It was not that the pass failed - it ran
     perfectly and computed almost zero. */
  float radiusPx = clamp(uParams.x * uProjScale / -z, 2.0, 44.0);

  float rot = hash12(gl_FragCoord.xy) * 6.2831853;
  const int SAMPLES = 12;
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float a = fi * 2.39996323 + rot;          // golden-angle spiral
    float r = sqrt((fi + 0.5) / float(SAMPLES));
    vec2 suv = vUv + vec2(cos(a), sin(a)) * r * radiusPx * uTexel;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

    vec3 sp = viewPos(suv);
    vec3 diff = sp - p;
    float dist = length(diff);
    if (dist < 1e-4) continue;
    float ndl = max(0.0, dot(n, diff / dist) - uParams.z);
    // A silhouette far in front of this pixel is not touching it;
    // counting it draws dark haloes around every foreground object.
    float range = clamp(uParams.x / dist, 0.0, 1.0);
    occ += ndl * range * range;
  }
  occ = clamp(1.0 - (occ / float(SAMPLES)) * uParams.y, 0.0, 1.0);
  gl_FragColor = vec4(occ, occ, occ, 1.0);
}
`;

/* Bilateral blur: wide enough to kill the sampling noise, but it
   will not cross a depth discontinuity, so the AO stops at a
   silhouette instead of smearing over it. */
const AO_BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform vec2 uNearFar;

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float n = uNearFar.x;
  float f = uNearFar.y;
  return -(2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
}

void main() {
  float z0 = viewZ(vUv);
  float sum = texture2D(tAo, vUv).r * 0.25;
  float wsum = 0.25;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-fi * fi * 0.16);
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uDir * uTexel * fi * float(s);
      float zi = viewZ(uv);
      float dw = w * exp(-abs(zi - z0) * 1.4);
      sum += texture2D(tAo, uv).r * dw;
      wsum += dw;
    }
  }
  float v = sum / max(wsum, 1e-4);
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

const DEBUG_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uMode;   // 0 = raw texture, 1 = linearised depth
void main() {
  if (uMode > 0.5) {
    float d = texture2D(tDepth, vUv).x;
    float n = uNearFar.x;
    float f = uNearFar.y;
    float z = (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
    float v = clamp(z / 200.0, 0.0, 1.0);
    gl_FragColor = vec4(v, v, v, 1.0);
    return;
  }
  vec3 c = texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tAo;
uniform float uExposure;
uniform float uBloom;
uniform vec2 uAo;          // strength, sky-tint amount
uniform vec3  uLift;
uniform vec3  uGamma;
uniform vec3  uGain;
uniform float uSaturation;
uniform float uContrast;
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uTintAmount;
uniform vec2  uVignette;    // strength, softness
uniform vec3  uHaloTint;
uniform float uHaloAmount;
${SANITISE}

/* Uchimura's GT curve. Chosen over ACES because ACES desaturates
   its highlights hard, and this palette lives or dies on a warm
   sky staying warm as it approaches white. */
float gt(float x, float P, float a, float m, float l, float c, float b) {
  float l0 = ((P - m) * l) / a;
  float S0 = m + l0;
  float S1 = m + a * l0;
  float C2 = (a * P) / (P - S1);
  float CP = -C2 / P;

  float w0 = 1.0 - smoothstep(0.0, m, x);
  float w2 = step(m + l0, x);
  float w1 = 1.0 - w0 - w2;

  float T = m * pow(max(x, 1e-5) / m, c) + b;
  float S = P - (P - S1) * exp(CP * (x - S0));
  float L = m + a * (x - m);
  return T * w0 + L * w1 + S * w2;
}

vec3 tonemap(vec3 x) {
  return vec3(
    gt(x.r, 1.0, 1.06, 0.22, 0.36, 1.24, 0.0),
    gt(x.g, 1.0, 1.06, 0.22, 0.36, 1.24, 0.0),
    gt(x.b, 1.0, 1.06, 0.22, 0.36, 1.24, 0.0)
  );
}

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec3 scene = sfSanitise(texture2D(tScene, vUv).rgb);

  /* Occlusion is applied BEFORE the bloom is added and before the
     tone curve, because it is a change to how much light reaches
     the surface - not a darkening of the picture. Applied after
     tone mapping it crushes contacts to mud and eats the bloom
     around emitters that are sitting in a corner.

     And it is tinted toward the shadow violet rather than pulling
     toward grey. Multiplying to grey is what makes baked occlusion
     look like dirt; the level's own terrain AO does the same thing
     for the same reason. */
  float ao = mix(1.0, texture2D(tAo, vUv).r, uAo.x);
  /* The violet tint scales with the OCCLUSION, not with the pixel.
     Applied flat it multiplied every unoccluded surface in the frame
     by about 0.9 and cooled it - so switching AO on desaturated and
     dimmed the entire image, including the sky, which reads as "the
     grade broke" rather than as "the occlusion term is wrong". At
     ao = 1 this is exactly 1.0 and costs nothing. */
  vec3 aoTint = vec3(ao) * mix(vec3(1.0), vec3(0.86, 0.80, 1.02),
                               (1.0 - ao) * uAo.y);
  scene *= aoTint;

  vec3 bloom = sfSanitise(texture2D(tBloom, vUv).rgb);
  vec3 c = scene + bloom * uBloom;

  c *= uExposure;
  c = tonemap(c);

  // --- grade -------------------------------------------------------
  c = clamp(c, 0.0, 1.0);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Split tone. Warm the highlights, push the shadows toward the
  // violet that the sand's shaded faces already sit in - so the
  // grade agrees with the vertex colours instead of fighting them.
  //
  // The tint is NORMALISED by its own luma before it is applied, so
  // it rotates hue without changing level. Multiplying by a raw
  // tint and doubling it, as a first pass did, moved the result by
  // about 5% and the split tone was effectively inert - the tint
  // amount could be swept over its whole range with no visible
  // change, which is exactly the kind of edit that looks shipped
  // and is not.
  vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.02, 0.62, luma));
  tint /= max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  c = mix(c, c * tint, uTintAmount);

  c = (c - 0.5) * uContrast + 0.5;
  c = uLift + (uGain - uLift) * pow(max(c, vec3(0.0)), uGamma);

  luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);

  // A faint warm bloom of the sky colour toward the frame edges.
  // Reads as lens veiling, and it stops the corners from going dead.
  float r = length(vUv - 0.5) * 1.42;
  c += uHaloTint * pow(r, 2.2) * uHaloAmount;

  // Vignette, applied last and gently. Anything heavier reads as a
  // filter rather than as a lens.
  float vig = 1.0 - uVignette.x * pow(smoothstep(uVignette.y, 1.0, r), 1.6);
  c *= vig;

  c = toSrgb(clamp(c, 0.0, 1.0));

  /* DITHER, applied last, in sRGB, at half a code value.
     Everything upstream of here is float; the canvas is 8-bit. A sky
     gradient or a shadowed dune face can cross a code boundary over
     a hundred-odd pixels, and the eye finds that edge easily - a 10x
     crop of the worst dune face in the review was a flat wash with
     horizontal steps in it and nothing else. A triangular-PDF dither
     (two independent uniforms differenced) turns the step into noise
     the eye integrates away, which is the same trick every video
     codec and audio DAC uses and it costs three instructions. */
  /* Interleaved gradient noise, not a fract-sin-dot hash. That hash
     loses precision at large coordinates and prints its own regular
     pattern at the top of a 1080-line frame - which is the exact
     artefact a dither exists to remove. IGN is well conditioned
     across the whole screen and is two instructions.
     (No backticks in this comment: it is inside a template literal.)

     Remapped from a uniform to a TRIANGULAR distribution, which is
     what makes dithering noise-shaped rather than merely noisy: a
     uniform dither leaves a residual correlation with the signal at
     the quantisation edges, and a triangular one does not. */
  float ign = fract(52.9829189
    * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
  float tri = ign < 0.5
    ? (sqrt(2.0 * ign) - 1.0)
    : (1.0 - sqrt(2.0 - 2.0 * ign));
  c += tri * (1.0 / 255.0);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/* ------------------------------------------------------------------ */

export function createRenderer(ctx, canvas) {
  const { THREE } = ctx;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // MSAA lives on the HDR target instead
    alpha: false,
    powerPreference: "high-performance",
    // The review harness reads the drawing buffer directly rather
    // than going through page.screenshot(), which is compositor
    // throttled and returns stale frames in headless.
    preserveDrawingBuffer: true,
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  // The scene half of the pipeline is linear from end to end. The
  // composite pass does the encode.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 11000);
  camera.position.set(0, 40, 900);

  /* ---------------------------- targets ---------------------------- */

  const maxSamples = renderer.capabilities.maxSamples || 0;
  const opts = {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  };
  /* A depth texture on the scene target, so the AO pass can read
     the depth the scene was already drawn against instead of
     costing a second full-geometry pass. three resolves depth out
     of the multisampled buffer alongside colour, so MSAA survives.
     If it ever stops doing so the AO goes uniformly white rather
     than wrong, which the A/B in saintfall-isolate.mjs will catch. */
  const depthTexture = new THREE.DepthTexture(2, 2);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  let sceneTarget = new THREE.WebGLRenderTarget(2, 2, {
    ...opts, samples: Math.min(4, maxSamples), depthTexture,
  });

  const aoOpts = {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
  };
  const aoTarget = new THREE.WebGLRenderTarget(2, 2, aoOpts);
  const aoBlurTarget = new THREE.WebGLRenderTarget(2, 2, aoOpts);
  // Multisampled targets cannot be sampled as a texture directly on
  // every driver path; three resolves on read, but a dedicated
  // resolve target keeps the bloom chain's input unambiguous.
  const MIPS = 4;
  const bloomTargets = [];
  for (let i = 0; i < MIPS; i += 1) {
    bloomTargets.push(new THREE.WebGLRenderTarget(2, 2, { ...opts, depthBuffer: false, samples: 0 }));
  }
  const bloomUp = [];
  for (let i = 0; i < MIPS; i += 1) {
    bloomUp.push(new THREE.WebGLRenderTarget(2, 2, { ...opts, depthBuffer: false, samples: 0 }));
  }

  /* ----------------------------- passes ----------------------------- */

  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute("position", new THREE.Float32BufferAttribute(
    [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3
  ));
  quadGeo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo, null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const mkPass = (frag, uniforms) => new THREE.ShaderMaterial({
    uniforms, vertexShader: FS_VERT, fragmentShader: frag,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  const brightMat = mkPass(BRIGHT_FRAG, {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: new THREE.Vector3(1.0, 0.62, 0) },
  });
  const downMat = mkPass(DOWN_FRAG, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
  });
  const upMat = mkPass(UP_FRAG, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
  });
  upMat.blending = THREE.AdditiveBlending;

  const aoMat = mkPass(AO_FRAG, {
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    uInvProj: { value: new THREE.Matrix4() },
    uParams: { value: new THREE.Vector3(0.55, 2.0, 0.03) },
    uProjScale: { value: 500 },
  });
  const aoBlurMat = mkPass(AO_BLUR_FRAG, {
    tAo: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uDir: { value: new THREE.Vector2(1, 0) },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
  });

  const debugMat = mkPass(DEBUG_FRAG, {
    tSrc: { value: null },
    tDepth: { value: null },
    uNearFar: { value: new THREE.Vector2(0.4, 11000) },
    uMode: { value: 0 },
  });

  const compMat = mkPass(COMPOSITE_FRAG, {
    tScene: { value: null },
    tBloom: { value: null },
    tAo: { value: null },
    uExposure: { value: 1.0 },
    uBloom: { value: 0.62 },
    uAo: { value: new THREE.Vector2(0.85, 0.7) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uShadowTint: { value: new THREE.Vector3(0.3, 0.2, 0.4) },
    uHighlightTint: { value: new THREE.Vector3(1, 0.9, 0.75) },
    uTintAmount: { value: 0.3 },
    uVignette: { value: new THREE.Vector2(0.30, 0.30) },
    uHaloTint: { value: new THREE.Vector3(0.1, 0.06, 0.03) },
    uHaloAmount: { value: 0.06 },
  });

  function runPass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear(true, false, false);
    renderer.render(quadScene, quadCam);
  }

  /* ----------------------------- sizing ----------------------------- */

  let width = 1280;
  let height = 720;
  let bloomScale = 0.5;

  function resize(w, h) {
    width = Math.max(2, Math.floor(w));
    height = Math.max(2, Math.floor(h));
    const dpr = renderer.getPixelRatio();
    const pw = Math.max(2, Math.floor(width * dpr));
    const ph = Math.max(2, Math.floor(height * dpr));

    renderer.setSize(width, height, false);
    sceneTarget.setSize(pw, ph);
    // Half res. The term is blurred anyway, and at full res it is
    // the most expensive pass in the frame for no visible gain.
    const aw = Math.max(2, pw >> 1);
    const ah = Math.max(2, ph >> 1);
    aoTarget.setSize(aw, ah);
    aoBlurTarget.setSize(aw, ah);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    let bw = Math.max(2, Math.floor(pw * bloomScale));
    let bh = Math.max(2, Math.floor(ph * bloomScale));
    for (let i = 0; i < MIPS; i += 1) {
      bloomTargets[i].setSize(bw, bh);
      bloomUp[i].setSize(bw, bh);
      bw = Math.max(2, bw >> 1);
      bh = Math.max(2, bh >> 1);
    }
  }

  /* ------------------------------ grade ------------------------------ */

  const v3 = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);
  function applyAtmosphere(atmos) {
    const g = atmos.grade;
    compMat.uniforms.uExposure.value = atmos.exposure;
    compMat.uniforms.uLift.value.set(g.lift[0], g.lift[1], g.lift[2]);
    compMat.uniforms.uGamma.value.set(g.gamma[0], g.gamma[1], g.gamma[2]);
    compMat.uniforms.uGain.value.set(g.gain[0], g.gain[1], g.gain[2]);
    compMat.uniforms.uSaturation.value = g.saturation;
    compMat.uniforms.uContrast.value = g.contrast;
    const st = hexToRgb(g.shadowTint);
    const ht = hexToRgb(g.highlightTint);
    compMat.uniforms.uShadowTint.value.set(st[0], st[1], st[2]);
    compMat.uniforms.uHighlightTint.value.set(ht[0], ht[1], ht[2]);
    compMat.uniforms.uTintAmount.value = g.tint;
    const halo = atmos.sunHalo;
    compMat.uniforms.uHaloTint.value.set(halo.r * 0.14, halo.g * 0.11, halo.b * 0.08);
    void v3;
  }

  /* ------------------------------ render ------------------------------ */

  let envTexture = null;
  function refreshEnvironment(atmos) {
    if (envTexture) envTexture.dispose();
    envTexture = buildSkyEnvironment(THREE, renderer, atmos, 64);
    scene.environment = envTexture;
    scene.environmentIntensity = atmos.envIntensity;
    // `material.envMapIntensity` does nothing for inherited IBL - it
    // only scales a material's OWN envMap. Scene-level intensity is
    // the knob that actually moves every shadow side in the world.
  }

  let frame = 0;
  let aoEnabled = true;
  // `renderer.info` auto-resets at the start of every render() call,
  // and the LAST call each frame is the composite quad - so reading
  // it afterwards reports one draw call and one triangle for the
  // whole game. Snapshot it while the scene pass is still the most
  // recent thing that ran.
  const sceneInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };

  function render(cam = camera) {
    frame += 1;
    renderer.setRenderTarget(sceneTarget);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    sceneInfo.calls = renderer.info.render.calls;
    sceneInfo.triangles = renderer.info.render.triangles;
    sceneInfo.points = renderer.info.render.points;
    sceneInfo.lines = renderer.info.render.lines;

    /* --- ambient occlusion --- */
    if (aoEnabled) {
      aoMat.uniforms.tDepth.value = sceneTarget.depthTexture;
      aoMat.uniforms.uTexel.value.set(1 / aoTarget.width, 1 / aoTarget.height);
      aoMat.uniforms.uNearFar.value.set(cam.near, cam.far);
      aoMat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      // Pixels per world unit at one unit of depth: the standard
      // projection scale, taken from the actual matrix rather than
      // from the fov, so it stays correct if either changes.
      aoMat.uniforms.uProjScale.value =
        0.5 * aoTarget.height * cam.projectionMatrix.elements[5];
      runPass(aoMat, aoTarget);

      // Separable, so the blur is 2 x 9 taps rather than 81.
      aoBlurMat.uniforms.tDepth.value = sceneTarget.depthTexture;
      aoBlurMat.uniforms.uNearFar.value.set(cam.near, cam.far);
      aoBlurMat.uniforms.uTexel.value.set(1 / aoTarget.width, 1 / aoTarget.height);
      aoBlurMat.uniforms.tAo.value = aoTarget.texture;
      aoBlurMat.uniforms.uDir.value.set(1, 0);
      runPass(aoBlurMat, aoBlurTarget);
      aoBlurMat.uniforms.tAo.value = aoBlurTarget.texture;
      aoBlurMat.uniforms.uDir.value.set(0, 1);
      runPass(aoBlurMat, aoTarget);
    }

    // --- bloom ---
    const src = sceneTarget.texture;
    brightMat.uniforms.tSrc.value = src;
    brightMat.uniforms.uTexel.value.set(
      1 / sceneTarget.width, 1 / sceneTarget.height
    );
    runPass(brightMat, bloomTargets[0]);

    for (let i = 1; i < MIPS; i += 1) {
      downMat.uniforms.tSrc.value = bloomTargets[i - 1].texture;
      downMat.uniforms.uTexel.value.set(
        1 / bloomTargets[i - 1].width, 1 / bloomTargets[i - 1].height
      );
      runPass(downMat, bloomTargets[i]);
    }

    // Upsample back through the pyramid, accumulating.
    upMat.blending = THREE.NoBlending;
    upMat.uniforms.tSrc.value = bloomTargets[MIPS - 1].texture;
    upMat.uniforms.uTexel.value.set(
      1 / bloomTargets[MIPS - 1].width, 1 / bloomTargets[MIPS - 1].height
    );
    runPass(upMat, bloomUp[MIPS - 1]);

    for (let i = MIPS - 2; i >= 0; i -= 1) {
      // Coarse level first, then add this level's own contribution.
      upMat.blending = THREE.NoBlending;
      upMat.uniforms.tSrc.value = bloomUp[i + 1].texture;
      upMat.uniforms.uTexel.value.set(
        1 / bloomUp[i + 1].width, 1 / bloomUp[i + 1].height
      );
      runPass(upMat, bloomUp[i]);

      upMat.blending = THREE.AdditiveBlending;
      upMat.uniforms.tSrc.value = bloomTargets[i].texture;
      upMat.uniforms.uTexel.value.set(
        1 / bloomTargets[i].width, 1 / bloomTargets[i].height
      );
      quad.material = upMat;
      renderer.setRenderTarget(bloomUp[i]);
      renderer.render(quadScene, quadCam);
    }
    upMat.blending = THREE.NoBlending;

    // --- composite ---
    compMat.uniforms.tScene.value = sceneTarget.texture;
    compMat.uniforms.tBloom.value = bloomUp[0].texture;
    compMat.uniforms.tAo.value = aoTarget.texture;
    quad.material = compMat;
    renderer.setRenderTarget(null);
    renderer.clear(true, true, false);
    renderer.render(quadScene, quadCam);
  }

  /* ----------------------------- quality ----------------------------- */

  /* Shadow radius is generous, because the landmarks on this map
     are 60m to 190m tall and 300m to 900m away. A tight frustum
     buys crisp contact shadows on ground the player is standing on
     and drops every silhouette that gives the frame its depth. */
  const QUALITY = {
    low: { pixelRatio: 0.75, shadow: 1024, bloom: 0.35, shadowRadius: 190, ao: 0 },
    medium: { pixelRatio: 1.0, shadow: 2048, bloom: 0.45, shadowRadius: 260, ao: 0.72 },
    high: { pixelRatio: 1.0, shadow: 4096, bloom: 0.5, shadowRadius: 320, ao: 0.85 },
    ultra: { pixelRatio: 1.0, shadow: 4096, bloom: 0.5, shadowRadius: 420, ao: 0.95 },
  };

  function setQuality(tier, sky) {
    const q = QUALITY[tier] || QUALITY.high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio);
    bloomScale = tier === "low" ? 0.35 : 0.5;
    aoEnabled = q.ao > 0;
    compMat.uniforms.uAo.value.x = q.ao;
    if (sky) {
      sky.sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (sky.sun.shadow.map) {
        sky.sun.shadow.map.dispose();
        sky.sun.shadow.map = null;
      }
      sky.setShadowRadius(q.shadowRadius);
    }
    resize(width, height);
  }

  return {
    renderer,
    scene,
    camera,
    render,
    resize,
    setQuality,
    applyAtmosphere,
    refreshEnvironment,
    get frame() { return frame; },
    /** Blit an intermediate buffer straight to the canvas. The AO
     *  probe reported the pass changing 0% of pixels; a number that
     *  small has several possible causes and looking at the buffer
     *  distinguishes them in one capture. */
    debugBlit(which) {
      debugMat.uniforms.uMode.value = which === "depth" ? 1 : 0;
      debugMat.uniforms.tDepth.value = sceneTarget.depthTexture;
      debugMat.uniforms.uNearFar.value.set(camera.near, camera.far);
      debugMat.uniforms.tSrc.value = which === "ao" ? aoTarget.texture
        : which === "aoraw" ? aoBlurTarget.texture
          : sceneTarget.texture;
      quad.material = debugMat;
      renderer.setRenderTarget(null);
      renderer.clear(true, true, false);
      renderer.render(quadScene, quadCam);
    },
    setBloom(v) { compMat.uniforms.uBloom.value = v; },
    setAo(strength, tint) {
      aoEnabled = strength > 0;
      compMat.uniforms.uAo.value.x = strength;
      if (tint !== undefined) compMat.uniforms.uAo.value.y = tint;
    },
    setAoParams(radius, intensity, bias) {
      aoMat.uniforms.uParams.value.set(radius, intensity, bias);
    },
    get aoStrength() { return compMat.uniforms.uAo.value.x; },
    setExposureScale(v) { compMat.uniforms.uExposure.value = v; },
    uniforms: compMat.uniforms,
    targets: { sceneTarget, bloomTargets, bloomUp, aoTarget, aoBlurTarget },
    captureDataURL() {
      return renderer.domElement.toDataURL("image/png");
    },
    info() {
      const r = sceneInfo;
      return {
        calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      };
    },
  };
}

export { clamp, clamp01, lerp, srgb };
