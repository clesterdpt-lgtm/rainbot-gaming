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

   - THE BOTTOM OF THE RANGE IS NOT A CONSTANT. Three of the knobs
     in the composite - the tone curve's toe, the grade's black
     floor and the deep-shade hue - used to be either literals in
     this shader or a single lifted number in the grade, and between
     them they put an absolute wall across the bottom of every frame
     the game drew. Measured: eighteen boss captures across three
     animals, six framings and two districts all reported a
     1st-percentile luminance of 27, 28 or 29. Content varied
     completely; the statistic did not move, because it was not
     measuring content. They are grade parameters now (see GRADES in
     art.js), and the parameters are read here with explicit
     fallbacks because an undefined reaching a uniform is a NaN and
     one NaN in this pass is the whole picture.
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

   ONE DISC IS ONE SCALE, AND THIS PASS OWES THE FRAME TWO.

   The radius used to be a single 0.55 m. That number resolves the
   gap between two armour plates and literally nothing else: a
   nine-metre animal standing on sand is two orders of magnitude
   outside it, so every boss in the game had cavity in its creases
   and NOTHING under its feet. The art direction asks for both by
   name - "a contact shadow where it meets the ground" and
   "self-occlusion where plate meets plate" - and they are 20x apart
   in world scale.

   Why this pass rather than the alternatives, on cost:

   - A shadow-map improvement cannot answer it at all. A shadow map
     occludes the SUN. The dark under a creature is missing SKY: at
     golden hour the fill is most of the light on any surface the
     key is not hitting, and no amount of shadow-map work removes
     light the shadow map does not carry.
   - A grounded AO disc per boss is a draw call and a material per
     boss, authored eight times, and it only ever works for the boss
     - not for its legs against its own body, not for a rock, not
     for the player. It also cannot be authored here: the boss
     modules belong to other agents.
   - Extending THIS pass costs zero extra taps. The sample count is
     unchanged at 12; only the radius each sample uses changes, from
     a constant to a geometric ladder spanning near..far. Half the
     ladder lands where the old disc did and does the same work; the
     other half reaches out to creature scale. The measured cost is
     in the report - it is texture-cache locality, not arithmetic.

   The ladder position is jittered per pixel alongside the rotation.
   Without that, every pixel samples the same twelve radii and the
   error is a set of concentric rings that survives the blur as
   banding; jittered, it is noise, which is what the blur is for.

   A LADDER AVERAGED AS ONE DISC DILUTES EVERY SCALE IT COVERS.

   The ladder above was correct about geometry and wrong about
   statistics, and the review that followed it is the proof: with the
   ladder in and running at high tier, the AO buffer over a boss
   fight measured a MEDIAN of 0.99 and a 1st percentile of 0.81.
   Nothing in a frame containing a nine-metre animal standing on sand
   was more than a fifth occluded. The critic's words for that were
   "no occlusion darkening at contact - at any scale".

   The arithmetic says exactly why. Occlusion was one mean over all
   twelve taps, but a contact only occupies a thin ANNULUS of the
   disc: a foot 0.5 m from sand is seen by the two or three taps whose
   radius happens to land near 0.5 m, and averaged against nine taps
   that are metres away in open air and correctly return zero. The
   wider the ladder, the harder it dilutes - so widening the radius
   made the term cover more scales and get WEAKER at every one of
   them. That is not a tuning error, and no intensity multiplier fixes
   it: raising the gain to compensate for the empty taps also
   multiplies the noise from the two that fired.

   So the taps are BANKED. Twelve taps, three banks of four, each bank
   spanning one third of the near..far range in log space and each
   normalised BY ITS OWN FOUR. A crease at 0.2 m is now estimated from
   four taps that can all see it instead of from two-in-twelve; a body
   against the ground at 2 m likewise. Sample count, texture traffic
   and arithmetic are unchanged - only the divisor and the combine.

   The banks combine MULTIPLICATIVELY (visibility, not occlusion),
   because that is what independent occluders at different scales
   actually do to the light reaching a point, and because it is the
   only combine that keeps an open plane at exactly 1.0. A sum would
   have to be divided by three again and would put the dilution back.
   ------------------------------------------------------------------ */

const AO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uNearFar;
uniform mat4 uInvProj;
uniform vec4 uParams;      // near radius (m), intensity, bias, far radius (m)
uniform vec2 uBank;        // far-bank gain, contact power
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

/* A MEASURED NULL RESULT, recorded so the next reader does not spend
   the run this cost.

   The occlusion buffer carries faint horizontal and vertical BANDS at
   fixed screen positions. The obvious suspect is this hash: the
   composite pass's own dither comment says a fract-multiply-dot hash
   loses precision at large screen coordinates and prints a regular
   pattern, and that is exactly the symptom. It was swapped for
   interleaved gradient noise - the same construction the dither uses -
   and the buffer came back byte-for-byte the same character: buffer
   mean 208.81 against 208.82, and the bands in the identical places.

   The pixel-size clamp on the sample radius was the second suspect,
   for the better reason that the clamp is a function of DEPTH and so
   quantises along iso-depth lines. Fading the tap out instead of
   clamping it in is a real improvement and it stayed (see below), but
   it did not move the bands either.

   What the bands are worth, measured on the composited frame rather
   than on the amplified debug blit: 0.78 code values of row-to-row
   ripple across a flat sand wash, peak 3.4. The half-code dither is
   already the same order. That is why this is a note and not a third
   round of shader work - the thing this pass was failing at was
   contact, by a factor of three, and that is what the budget went on. */
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
  float pxPerM = uProjScale / -z;
  // log of the near..far ratio, hoisted so the ladder is one exp2
  // per sample rather than a pow.
  float span = log2(max(uParams.w, uParams.x * 1.001) / uParams.x);

  float rot = hash12(gl_FragCoord.xy) * 6.2831853;
  // Second, decorrelated hash for the ladder offset. Reusing the
  // rotation hash would tie a pixel's radius to its angle and
  // reprint the rings this jitter exists to break.
  // (No backticks in this comment: it is inside a template literal.)
  float lad = hash12(gl_FragCoord.yx + 17.31);
  const int BANKS = 3;
  const int PER_BANK = 4;
  float vis = 1.0;
  for (int b = 0; b < BANKS; b++) {
    float fb = float(b);
    float occ = 0.0;
    float wsum = 0.0;
    for (int j = 0; j < PER_BANK; j++) {
      float fj = float(j);
      float fi = fb * float(PER_BANK) + fj;
      float a = fi * 2.39996323 + rot;          // golden-angle spiral
      /* GEOMETRIC, not sqrt-of-index. sqrt spaces samples uniformly by
         AREA, which puts almost all of them in the outer annulus - fine
         for one scale, useless across twenty. Each step here is a fixed
         RATIO of the last, so the twelve samples cover near..far evenly
         in log space and both ends get the same number of them.

         The position is now built from the BANK and the tap within it,
         so the four taps of a bank stay inside their own third of the
         ladder however the jitter falls. Jittering across the whole
         ladder would let a bank's taps wander into its neighbour's
         range and put the dilution straight back. */
      float t = (fb + (fj + 0.5 + lad) / float(PER_BANK)) / float(BANKS);
      float ri = uParams.x * exp2(span * t);
      /* A TAP IS FADED OUT OF RANGE, NEVER CLAMPED INTO IT.

         This clamped to [1, 72] pixels, and that clamp is what put
         long horizontal and vertical BANDS across every occlusion
         buffer this pass has ever produced. They sat at fixed screen
         positions and did not move when the world did, which sent two
         rounds of diagnosis at the sample hash - swapping it for
         interleaved gradient noise changed the buffer by nothing
         measurable, twice.

         The mechanism is that the clamp is a function of DEPTH.
         radiusPx is ri * pixels-per-metre, so on a ground plane every
         ladder step crosses the one-pixel floor at its own particular
         screen row: below that row the tap measures ri, above it the
         tap measures one texel, and the number of taps on each side of
         the boundary changes by exactly one. That is a step in the
         estimator's value along an iso-depth line - a band, one per
         ladder step, running the width of the frame. The 72-pixel
         ceiling does the same thing in the near field.

         So the weight goes to zero instead. A tap narrower than a
         texel genuinely cannot resolve anything and must not vote;
         the difference is that it stops voting SMOOTHLY, and it stops
         voting for its own scale rather than lying about a different
         one. The wide end fades for the same reason plus a practical
         one - a 200-pixel tap is a texture-cache miss measuring
         something that is not contact at all. */
      float radiusPx = ri * pxPerM;
      float wPx = smoothstep(0.7, 1.7, radiusPx)
        * (1.0 - smoothstep(54.0, 78.0, radiusPx));
      if (wPx < 0.004) continue;
      vec2 suv = vUv + vec2(cos(a), sin(a)) * min(radiusPx, 78.0) * uTexel;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

      vec3 sp = viewPos(suv);
      vec3 diff = sp - p;
      float dist = length(diff);
      if (dist < 1e-4) continue;
      float ndl = max(0.0, dot(n, diff / dist) - uParams.z);
      /* The range term uses the SAMPLE's own radius, not one global
         one. With a single radius that distinction did not exist; with
         a ladder, using the far radius for a near sample would let a
         0.15 m tap accept an occluder three metres away and the whole
         ladder would collapse back into one coarse scale. A silhouette
         far in front of this pixel is still not touching it - that is
         what stops dark haloes round every foreground object. */
      float range = clamp(ri / dist, 0.0, 1.0);
      occ += ndl * range * range * wPx;
      wsum += wPx;
    }
    /* uBank.x fades the gain across the ladder: full strength on the
       near bank, uBank.x on the far one. The far bank is the one that
       reaches creature scale, and at that radius it also starts to see
       the large-scale concavity of the dune field - which terrain.js
       already carries as baked vertex occlusion and would be darkened
       twice. Trimming the far bank keeps the contact and gives the
       double-darkening back. */
    float gain = uParams.y * mix(1.0, uBank.x, fb / float(BANKS - 1));
    /* The divisor is the WEIGHT this bank actually cast, floored at
       three quarters of one tap. Dividing by the raw weight would let
       a bank whose taps are nearly all sub-texel amplify its single
       surviving vote into a full-strength occlusion, which is a bright
       speckle in the one place the pass has the least information.
       The floor biases a half-resolved bank toward OPEN, which is the
       safe direction: a missing contact is invisible, an invented one
       is a hole in the picture. */
    vis *= clamp(1.0 - (occ / max(wsum, 0.75)) * gain, 0.0, 1.0);
  }
  /* A contact curve, applied to VISIBILITY. Values near 1 (the open
     plane, most of the frame) are almost untouched by a power > 1;
     values already down at 0.6 fall further. That is the shape the
     term wants - the complaint is never that a lit dune is too bright,
     it is that the dark under a foot is not dark. */
  float occOut = clamp(pow(vis, uBank.y), 0.0, 1.0);
  gl_FragColor = vec4(occOut, occOut, occOut, 1.0);
}
`;

/* Bilateral blur: wide enough to kill the sampling noise, but it
   will not cross a depth discontinuity, so the AO stops at a
   silhouette instead of smearing over it.

   THE TOLERANCE IS A GRADIENT, NOT A DISTANCE, and the frames that
   forced that are in the review: every dune face in the Choir Spires
   captures had horizontal and vertical STREAKS laid across it, in a
   place where the picture should have been a smooth wash.

   The mechanism is the old absolute tolerance, `exp(-|zi - z0| *
   1.4)`, which is about 0.7 m of slack. Vesper-IX at golden hour is
   almost entirely raking ground: a dune seen at a grazing angle
   changes depth by METRES from one pixel to the next, so every
   off-centre tap scored a weight of essentially zero, the sum
   collapsed to the centre tap alone, and the pass handed the frame
   its own raw twelve-tap sampling noise - along one axis, because the
   blur is separable and each axis failed independently. A blur that
   silently turns itself off is worse than no blur, because the noise
   it was supposed to remove is now the only thing it contributed.

   The fix is to compare each tap against the PLANE the centre pixel
   is on rather than against its depth: measure how fast depth is
   changing per pixel along the blur axis, and allow that much per
   pixel of travel. A grazing plane then blurs fully, and a silhouette
   - where the depth step is far larger than the local gradient
   predicts - still stops the filter dead, which is the whole point of
   a bilateral. */
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
  /* Depth change per pixel ALONG THE BLUR AXIS. The pass is
     separable, so only the gradient in uDir is relevant; taking the
     full gradient magnitude would hand a vertical pass the slack it
     needs for a horizontal slope and let it blur through silhouettes
     it should have stopped at. The floor keeps a face-on surface from
     ending up with a zero tolerance, and the ceiling stops a pixel on
     a silhouette edge - where the derivative is a cliff, not a slope -
     from claiming unlimited slack and smearing over the very
     discontinuity this filter exists to preserve. */
  float gz = clamp(abs(dot(vec2(dFdx(z0), dFdy(z0)), uDir)), 0.02, 1.2);
  float sum = texture2D(tAo, vUv).r * 0.25;
  float wsum = 0.25;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-fi * fi * 0.16);
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uDir * uTexel * fi * float(s);
      float zi = viewZ(uv);
      // Slack scales with how far this tap travelled, because that is
      // how much depth a flat surface is ENTITLED to have changed.
      float dw = w * exp(-abs(zi - z0) / (gz * fi * 2.2 + 0.06));
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
uniform sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uExposure;
uniform float uBloom;
uniform vec3 uAo;          // strength, sky-tint amount, key knee (linear)
uniform vec2 uBounce;      // gain, receiver knee (linear scene luma)
uniform vec3  uLift;
uniform vec3  uGamma;
uniform vec3  uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uToe;        // GT shadow exponent, per grade
uniform vec3  uShadeHue;   // hue deep shade desaturates toward
uniform vec2  uShade;      // amount 0..1, knee (luma the term dies at)
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

/* The toe exponent is a uniform, not the literal 1.24 it used to be.
   It is the one curve parameter that touches ONLY the shadows: the
   toe segment is weighted by 1 - smoothstep(0, m, x), so it has no
   authority at all above the linear midpoint m = 0.22 and cannot
   move the sand, the sky or a highlight. Raising it is how the
   bottom of the range gets its separation back without the frame
   losing a single code value of exposure anywhere else. */
vec3 tonemap(vec3 x) {
  return vec3(
    gt(x.r, 1.0, 1.06, 0.22, 0.36, uToe, 0.0),
    gt(x.g, 1.0, 1.06, 0.22, 0.36, uToe, 0.0),
    gt(x.b, 1.0, 1.06, 0.22, 0.36, uToe, 0.0)
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
  /* OCCLUSION OCCLUDES THE SKY, NOT THE KEY - and that is this pass's
     own argument, made at the top of the AO block: the dark under a
     creature is missing SKY, because at golden hour the fill is most
     of the light on any surface the sun is not hitting. The corollary
     was not being applied. A plate top taking a 13-degree key at full
     strength does not get darker because there is a crease under it;
     the sun either reaches it or it does not, and that is the shadow
     map's job.

     Applying the term flat to the composited scene therefore taxed
     the highlights as hard as the shade, and it is measurable: with
     the banked estimator in and applied flat, the Garner gallery's
     blown fraction fell from 0.039% to 0.0063% and the metric harness
     flagged brightPct LOW - "nothing blows out, no specular hit, no
     rim catching light" - which is one of the five axes the whole
     programme is scored on. Occlusion that eats specular is occlusion
     applied in the wrong place.

     So the term's AUTHORITY falls off as the pixel gets bright in
     linear scene units. Measured on the same frame, the scene buffer
     runs p50 0.165 and 99.2% below 0.78, so a knee at uAo.z with the
     roll finishing at 2.2x it hands back the top two or three percent
     of the picture and leaves every contact in the frame untouched.
     Not to zero: some of a bright pixel is still sky. */
  float keyLuma = dot(scene, vec3(0.2126, 0.7152, 0.0722));
  float keyed = smoothstep(uAo.z, uAo.z * 2.2, keyLuma);
  float ao = mix(1.0, texture2D(tAo, vUv).r, uAo.x * (1.0 - 0.7 * keyed));
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

  /* ---------------------------------------------------------------
     EMISSIVE BOUNCE - a fake-GI term, and the cheapest of the three
     things the review asked for.

     The finding was that every glowing element in the game - joint
     caps, weak points, an acid pool, plasma bolts, strip lights -
     contributes exactly zero illumination to its neighbourhood, so
     "they are all stickers". That was literally true: an emissive
     material writes its own colour and nothing else in the scene ever
     reads it. Bloom does not fix it, because bloom ADDS a veil IN
     FRONT of the neighbouring surface - the same amount whether that
     surface is white marble or black chitin - and a veil that ignores
     what it is landing on is exactly what a sticker looks like.

     Bounced light is MULTIPLICATIVE: a surface returns the incoming
     light times its own reflectance. So the term is scene * gi, not
     scene + gi, and the difference is the whole read. A dark plate beside
     an orange gut picks up a little orange; a pale bone rim beside
     the same gut picks up a lot. That is the relationship the eye
     uses to decide something is being LIT rather than pasted over.

     There is no new pass and no new light. tBloom is already a
     wide, energy-weighted blur of everything bright in the frame -
     which is precisely the irradiance map a one-bounce approximation
     wants - and it is already fetched on the line above, so this
     costs arithmetic and nothing else. A real THREE light per emitter
     would be correct and unaffordable: adding one light recompiles
     every material in the scene, and this project has already eaten a
     198 ms freeze that way.

     Applied AFTER the occlusion, deliberately. A cavity next to a
     glowing weak point is exactly where bounced light goes, and
     relighting it is what stops the new AO from reading as dirt.

     Two gates, and both are load-bearing:

     - DEPTH. The sky is the brightest thing in the frame and it is
       not a surface. Multiplying it by its own bloom would blow the
       horizon and the sun disc, which reads as "the exposure broke".
       The far plane is an exact test and costs one fetch.
     - A LUMA KNEE. An emitter must not bounce off itself, or every
       glow gains a hard bright core and the term becomes a second,
       worse bloom. Above the knee the bounce is gone.
     --------------------------------------------------------------- */
  if (uBounce.x > 0.0) {
    float d = texture2D(tDepth, vUv).x;
    float zc = (2.0 * uNearFar.x * uNearFar.y)
      / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
    float isWorld = step(zc, uNearFar.y * 0.98);
    float sceneLuma = dot(scene, vec3(0.2126, 0.7152, 0.0722));
    float recv = 1.0 - smoothstep(uBounce.y * 0.45, uBounce.y, sceneLuma);
    // Clamped: an HDR emitter can carry hundreds of units and an
    // unbounded multiplier would turn one bolt into a white frame.
    vec3 gi = min(bloom, vec3(6.0));
    scene += scene * gi * (uBounce.x * recv * isWorld);
  }

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

  /* DEEP SHADE IS NOT A DARKER VERSION OF THE KEY.

     SAND_RAMP's header states the rule and paid for it: shadowed
     sand is lit almost entirely by the sky, so it desaturates and
     goes violet; an earlier build that bottomed out at a saturated
     maroon turned the impact basin to mud. That rule used to be
     carried by the vertex ramp plus the grade's blue-biased LIFT -
     and the lift has just been reduced by a factor of six, which
     means the frame now has a real dark end that nothing is
     steering. Left alone, the bottom of the range simply inherits
     the key's orange at low value, and the key's orange at low value
     is that maroon.

     So it is steered here instead, and DELIBERATELY as a hue
     rotation with no level change: the target is normalised by its
     own luma before it is mixed, so this pulls chroma out and turns
     it violet without darkening the picture by a single code value.
     A term that both darkened and desaturated would be impossible to
     tune, because the two effects would alibi each other.

     THE KNEE IS HIGHER THAN IT LOOKS LIKE IT SHOULD BE, and this is
     the measured reason. Binning a frame by luma before and after
     the lift came down: the 60-100 band went from rgb(132,73,40) at
     saturation 0.70 to rgb(137,71,22) at 0.84. The shadows did not
     merely darken, they got MORE saturated - because the old lift's
     blue channel was a pedestal worth a third of a shadow pixel's
     blue, and removing it clipped the blue out of the whole lower
     half of the range. Shade was ending up more chromatic than the
     sunlight, which is backwards, and the direction it was heading
     in is the saturated maroon the sand ramp's header calls mud.
     A knee that only reached the bottom eighth left that band
     untouched and the term measured as inert. */
  if (uShade.x > 0.0) {
    float sl = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float deep = 1.0 - smoothstep(0.0, uShade.y, sl);
    vec3 hue = uShadeHue / max(dot(uShadeHue, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    c = mix(c, mix(vec3(sl), hue * sl, 0.6), deep * uShade.x);
  }

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
    /* The review harness reads the drawing buffer directly rather
       than going through page.screenshot(), which is compositor
       throttled and returns stale frames in headless.

       DO NOT set this false to save the copy. It was tried, and it
       converts every main-thread stall into a BLACK FRAME: with the
       buffer unpreserved the contents are undefined once the
       compositor has taken them, so any frame the page is too late to
       redraw is composited from a cleared buffer. The canvas goes
       black for a frame while the DOM HUD on top of it renders
       perfectly - which reads as "the game flickers", not as "a frame
       was late", and sent this bug hunt looking at the renderer.
       Measured cost of preserving it here: none that showed above
       run-to-run noise. */
    preserveDrawingBuffer: true,
    stencil: false,
    depth: true,
  });
  /* The DEVICE ratio (capped at 2) is one of three factors in the
     real buffer size; the quality tier and the dynamic-resolution
     scale are the others. All three meet in applyPixelRatio(), the
     only caller of setPixelRatio - a second caller is how a quality
     switch silently discards the dynamic scale, or vice versa. */
  const deviceRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  let tierPixelRatio = 1;
  let renderScale = 1;
  function applyPixelRatio() {
    renderer.setPixelRatio(deviceRatio() * tierPixelRatio * renderScale);
  }
  applyPixelRatio();
  renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  /* The sun map is NOT redrawn every frame. The world it contains is
     almost entirely static, the sun of a ninety-hour day moves by
     nothing per frame, and redrawing 4096 texels of it measured 4-7ms
     of every frame at high tier. render() raises needsUpdate on its
     own cadence (every other frame; see shadowEvery), and anything
     that moves the sun in a step - setTime, a storm, a quality change
     - forces the next frame through requestShadowUpdate(). What a
     player can perceive is a moving shadow arriving 16ms late. */
  renderer.shadowMap.autoUpdate = false;
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
    /* near 0.15 m, intensity, bias, far 3.2 m. The near end is the
       old disc's job (plate against plate, a claw against rock); the
       far end is a creature against the ground it is standing on.
       3.2 m is deliberately not larger: past that the samples stop
       being about contact and start shading the large-scale
       concavity of the dune field, which the terrain already carries
       as baked occlusion and would be double-darkened. */
    uParams: { value: new THREE.Vector4(0.15, 2.0, 0.03, 3.2) },
    /* Far-bank gain, then the contact power.
       0.62: the outermost of the three banks is the one that reaches
       creature scale, and it is also the only one that can see the
       dune field's own large-scale concavity, which terrain.js
       already carries baked into its vertex colours. At 1.0 the two
       stack and the basins go muddy; at 0.62 the contact under a boss
       survives and the landscape is left to the bake.
       1.6: applied to visibility, so it is nearly inert above 0.9 and
       roughly doubles the depth of anything already below 0.6. */
    uBank: { value: new THREE.Vector2(0.62, 1.6) },
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
    tDepth: { value: null },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    uExposure: { value: 1.0 },
    uBloom: { value: 0.62 },
    /* Strength, sky-tint amount, and the key knee in LINEAR SCENE
       units - this runs before the exposure multiply, so 0.55 is a
       scene-referred number and not a display one. Measured against
       the scene buffer of a live boss frame: p50 0.165, 99.2% under
       0.78. See the key-exemption comment in the composite. */
    uAo: { value: new THREE.Vector3(0.85, 0.7, 0.55) },
    /* Gain, then the receiver knee in LINEAR SCENE units - this runs
       before the exposure multiply and before the tone curve, so the
       knee is a scene-referred number and not a display one. Both are
       overwritten per time-of-day from the grade; see GRADES.bounce
       in art.js. */
    uBounce: { value: new THREE.Vector2(0.34, 1.6) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uToe: { value: 1.24 },
    uShadeHue: { value: new THREE.Vector3(0.42, 0.37, 0.53) },
    uShade: { value: new THREE.Vector2(0, 0.2) },
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

  /* ------------------------------------------------------------------
     DYNAMIC RESOLUTION

     The frame is fill-bound: at device ratio 2 the scene+post chain
     alone costs the whole 60fps budget on the hardware this was
     measured on, before shadows or AO spend anything. No fixed
     pixel ratio is right for every machine, so the buffer scale is a
     control loop: full size while the frame fits its budget, trimmed
     in steps while it does not, probed back up when there is
     headroom. Everything the frame renders - scene, MSAA, AO, bloom,
     composite - scales together, so the picture keeps exactly its
     look and loses only raw pixel count, and only under load.

     The loop feeds on REAL rAF cadence (tickAutoScale is called from
     the live loop only, never from QA stepping): presented frame
     time is the one number that already includes GPU backpressure.
     Two subtleties, both learned from the literature rather than
     repeated here the hard way:

     - A 60Hz display pins healthy dt at ~16.7ms, so "comfortably
       under budget" is unmeasurable at vsync. Recovery is therefore
       a PROBE: step up, watch for 8s, and if the step was too far,
       step back and lock upward moves for 25s. Without the lock the
       controller ping-pongs across the budget line forever.

     - Every step reallocates the whole target chain, which is itself
       a hitch - so steps are rate-limited, and the dt average is
       reset to neutral after one so the controller resamples instead
       of reacting twice to the same congestion.
     ------------------------------------------------------------------ */

  const SCALE_MIN = 0.62;
  const auto = {
    desired: true,
    qaBlocked: !!ctx.qa,   // deterministic stills unless a probe opts in
    budgetMs: 16.9,
    ema: 0,
    overFor: 0,
    underFor: 0,
    holdUntil: 0,          // no second downscale before this
    lockUntil: 0,          // no upscale before this
    probeUntil: 0,         // a recent upscale is on probation until this
    graceUntil: 0,         // set on the first live tick; see tickAutoScale
  };
  const autoOn = () => auto.desired && !auto.qaBlocked;

  /* A scale change is APPLIED AT THE TOP OF THE NEXT render(), never
     at the moment it is decided.

     `setPixelRatio`/`setSize` resize the canvas, and resizing a canvas
     CLEARS its drawing buffer. The controller runs after the frame has
     been drawn, so applying the change there handed the compositor an
     empty canvas: one hard black frame on every single resolution
     step, with the DOM HUD still painted on top of it. That reads as
     "the game flickers", and it is why this is deferred rather than
     merely rate-limited. Applying it immediately before the draw means
     the freshly-sized buffer is filled in the same frame it is
     created, and no empty buffer is ever presented. */
  let pendingScale = null;

  function setRenderScale(s) {
    const next = clamp(s, SCALE_MIN, 1);
    if (Math.abs(next - renderScale) < 1e-3) {
      pendingScale = null;
      return renderScale;
    }
    pendingScale = next;
    return next;
  }

  /** Realise a deferred scale change. Called only from render(), and
   *  only with the draw for that frame immediately following. */
  function flushPendingScale() {
    if (pendingScale === null) return;
    const next = pendingScale;
    pendingScale = null;
    if (Math.abs(next - renderScale) < 1e-3) return;
    renderScale = next;
    applyPixelRatio();
    resize(width, height);
    // The chain was just reallocated, including the shadow map's
    // consumers; redraw it rather than let an interleave gap sample a
    // target that no longer exists.
    requestShadowUpdate();
  }

  function tickAutoScale(dtMs) {
    if (!autoOn()) return renderScale;
    if (!(dtMs > 0) || dtMs > 250) return renderScale;   // tab switch, clock jump
    /* The first seconds of a session are not a performance signal:
       terrain LOD is still paging, the garrison is still being culled
       for the first time, and any material the warm-up could not
       reach compiles on its first draw. Measured, that noise alone
       walked the scale down two steps inside 1.8s - so the player
       started every session at a reduced resolution that then took
       half a minute to earn back. Watch, do not act, until the
       session has actually settled. */
    if (auto.graceUntil === 0) auto.graceUntil = performance.now() + 3000;
    if (performance.now() < auto.graceUntil) return renderScale;
    auto.ema = auto.ema === 0 ? dtMs : auto.ema + (dtMs - auto.ema) * 0.12;
    const now = performance.now();
    const dt = dtMs / 1000;
    const over = auto.ema > auto.budgetMs * 1.16;
    auto.overFor = over ? auto.overFor + dt : 0;
    auto.underFor = auto.ema < auto.budgetMs * 1.06 ? auto.underFor + dt : 0;
    if (over && auto.overFor > 0.7 && now >= auto.holdUntil && renderScale > SCALE_MIN) {
      if (now < auto.probeUntil) auto.lockUntil = now + 25000;
      setRenderScale(renderScale * 0.85);
      auto.holdUntil = now + 900;
      auto.overFor = 0;
      auto.ema = auto.budgetMs;
    } else if (!over && auto.underFor > 4 && now >= auto.lockUntil && renderScale < 1) {
      const next = renderScale * 1.06;
      setRenderScale(next > 0.97 ? 1 : next);
      auto.probeUntil = now + 8000;
      auto.lockUntil = now + 3000;
      auto.underFor = 0;
      auto.ema = auto.budgetMs;
    }
    return renderScale;
  }

  function setAutoScale(on, { force = false } = {}) {
    auto.desired = !!on;
    if (force) auto.qaBlocked = false;
    if (!autoOn()) setRenderScale(1);
    return autoOn();
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
    /* Defaulted, not assumed. applyAtmosphere is called with grades
       that other code paths assemble (blendGrade, the storm mix, and
       anything a review harness hands in); an undefined here would
       reach the uniform as NaN and one NaN in the composite is the
       entire frame, black. */
    compMat.uniforms.uToe.value = Number.isFinite(g.toe) ? g.toe : 1.24;
    const sd = Array.isArray(g.shade) ? g.shade : [0, 0.2];
    compMat.uniforms.uShade.value.set(
      Number.isFinite(sd[0]) ? sd[0] : 0, Number.isFinite(sd[1]) ? sd[1] : 0.2
    );
    /* Same defaulting rule as `toe` and `shade` above, and for the
       same reason: an undefined reaching a uniform is a NaN, and one
       NaN in this pass is the entire frame. The fallback is the value
       the term shipped with, so a grade object assembled by an older
       code path still renders with the bounce on. */
    const bo = Array.isArray(g.bounce) ? g.bounce : [0.34, 1.6];
    compMat.uniforms.uBounce.value.set(
      Number.isFinite(bo[0]) ? bo[0] : 0.34, Number.isFinite(bo[1]) ? bo[1] : 1.6
    );
    const sh = hexToRgb(g.shadeHue || "#808080");
    compMat.uniforms.uShadeHue.value.set(sh[0], sh[1], sh[2]);
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
  function refreshEnvironment(atmos, size = 64) {
    if (envTexture) envTexture.dispose();
    envTexture = buildSkyEnvironment(THREE, renderer, atmos, size);
    scene.environment = envTexture;
    syncEnvironment(atmos);
    // `material.envMapIntensity` does nothing for inherited IBL - it
    // only scales a material's OWN envMap. Scene-level intensity is
    // the knob that actually moves every shadow side in the world.
  }

  /** Cheap half of an atmosphere update. The boot-time PMREM yields as the
   *  live sky/ground fill takes over, avoiding runtime environment-map bakes. */
  function syncEnvironment(atmos) {
    /* The one convolved environment map is the dawn sky made at boot.
       It stays strong while that palette is current, then yields to
       the live HemisphereLight owned by sky.js. Rebuilding PMREM on a
       timer costs hundreds of milliseconds in software/WebGL fallback
       paths; a slowly changing diffuse sky does not justify that hitch. */
    const dynamic = Math.max(1 - (atmos.goldenFactor ?? 1), atmos.storm || 0);
    scene.environmentIntensity = atmos.envIntensity * lerp(1, 0.18, dynamic);
  }

  let frame = 0;
  let aoEnabled = true;
  /* QA renders stills and compares them to goldens; a shadow map that
     is one frame stale depending on call parity would make every
     capture a coin flip, so harness runs redraw it every frame. */
  let shadowEvery = ctx.qa ? 1 : 2;
  let shadowForce = true;   // the first frame has no map to be stale
  function requestShadowUpdate() { shadowForce = true; }
  // `renderer.info` auto-resets at the start of every render() call,
  // and the LAST call each frame is the composite quad - so reading
  // it afterwards reports one draw call and one triangle for the
  // whole game. Snapshot it while the scene pass is still the most
  // recent thing that ran.
  const sceneInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };

  function render(cam = camera, sourceScene = scene) {
    frame += 1;
    // Before anything is drawn: a resized canvas is a cleared canvas,
    // so the resize and the draw that refills it must be the same frame.
    flushPendingScale();
    /* The flag survives every light-less quad pass below (three's
       shadow renderer returns before consuming it when the scene has
       no lights), so raising it here means exactly one shadow redraw,
       in the scene pass of THIS call. */
    if (shadowForce || shadowEvery <= 1 || frame % shadowEvery === 0) {
      renderer.shadowMap.needsUpdate = true;
      shadowForce = false;
    }
    renderer.setRenderTarget(sceneTarget);
    renderer.clear(true, true, false);
    renderer.render(sourceScene, cam);
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
    /* The bounce gate needs to know what is sky. Taken from the
       CAMERA this call was handed, not from the module's own, because
       the review harness renders stills through a free camera with a
       different fov and the near/far it carries is the one the depth
       buffer was written against. */
    compMat.uniforms.tDepth.value = sceneTarget.depthTexture;
    compMat.uniforms.uNearFar.value.set(cam.near, cam.far);
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
    tierPixelRatio = q.pixelRatio;
    applyPixelRatio();
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
    // The old map was just disposed; without a forced redraw the next
    // interleave gap would present one frame of shadowless world.
    requestShadowUpdate();
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
    syncEnvironment,
    /* Dynamic resolution + shadow cadence. tickAutoScale is fed by
       the LIVE loop only - QA stepping must never move the scale. */
    tickAutoScale,
    setAutoScale,
    setRenderScale,
    get renderScale() { return renderScale; },
    get autoScale() { return autoOn(); },
    requestShadowUpdate,
    setShadowEvery(n) { shadowEvery = Math.max(1, Math.floor(n) || 1); },
    get shadowEvery() { return shadowEvery; },
    /** Compile every material in the graph, INCLUDING hidden ones.
     *
     * A material's program is built the first time it is drawn, and
     * this game builds ~32 objects hidden and reveals them on first
     * use (shield, jetpack plume, slam, the VFX pools, the Coulter).
     * So the first Aegis block of a session compiled four shaders
     * inside one frame: a freeze at the exact moment the player
     * pressed a button to survive something.
     *
     * `compile()` walks with `traverse`, not `traverseVisible`, which
     * is the only reason this works on hidden objects - and the
     * reason a warm-up that just renders a few frames does not. */
    async warmShaders(cam = camera, sourceScene = scene) {
      const before = renderer.info.programs ? renderer.info.programs.length : 0;
      const t0 = performance.now();
      // Parallel compile where the driver offers it; the sync path is
      // correct either way, just slower.
      if (typeof renderer.compileAsync === "function") {
        await renderer.compileAsync(sourceScene, cam);
      } else {
        renderer.compile(sourceScene, cam);
      }
      const after = renderer.info.programs ? renderer.info.programs.length : 0;
      return { added: after - before, total: after,
        ms: Number((performance.now() - t0).toFixed(1)) };
    },
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
    /** The key knee, in linear scene luma. Exposed so a probe can
     *  prove the exemption is doing what its comment claims rather
     *  than the reader having to take it on faith. */
    setAoKeyKnee(v) {
      if (Number.isFinite(v)) compMat.uniforms.uAo.value.z = Math.max(1e-3, v);
    },
    get aoKeyKnee() { return compMat.uniforms.uAo.value.z; },
    /* `far` is optional so the three-argument callers that predate
       the radius ladder keep working; omitting it holds whatever far
       radius is currently set rather than silently zeroing it, which
       would collapse the ladder to a single scale and undo the
       contact term without any error. */
    setAoParams(radius, intensity, bias, far) {
      const v = aoMat.uniforms.uParams.value;
      v.set(radius, intensity, bias, Number.isFinite(far) ? far : v.w);
    },
    /** Far-bank gain and the contact power. Exposed so an A/B probe
     *  can sweep the banked estimator without editing the shader -
     *  the previous ladder shipped with no way to measure it and
     *  measured 0.99 median in the frames that mattered. */
    setAoBank(farGain, power) {
      const v = aoMat.uniforms.uBank.value;
      v.set(Number.isFinite(farGain) ? farGain : v.x,
        Number.isFinite(power) ? power : v.y);
    },
    get aoBank() {
      const v = aoMat.uniforms.uBank.value;
      return [v.x, v.y];
    },
    /** Emissive bounce gain and receiver knee. Setting the gain to 0
     *  removes the term entirely (the shader branches on it), which
     *  is what an isolation probe needs. */
    setBounce(gain, knee) {
      const v = compMat.uniforms.uBounce.value;
      v.set(Number.isFinite(gain) ? gain : v.x, Number.isFinite(knee) ? knee : v.y);
    },
    get bounce() {
      const v = compMat.uniforms.uBounce.value;
      return [v.x, v.y];
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
        renderScale: Number(renderScale.toFixed(3)),
        autoScale: autoOn(),
        shadowEvery,
        pixelRatio: Number(renderer.getPixelRatio().toFixed(3)),
      };
    },
  };
}

export { clamp, clamp01, lerp, srgb };
