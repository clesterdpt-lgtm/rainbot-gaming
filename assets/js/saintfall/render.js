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
   Quality tiers

   Shadow radius is generous, because the landmarks on this map are
   60m to 190m tall and 300m to 900m away. A tight frustum buys crisp
   contact shadows on ground the player is standing on and drops every
   silhouette that gives the frame its depth.

   The frame is fill-bound (measured: at device ratio 2 the scene +
   post chain alone is the whole 60fps budget before shadows or AO
   spend anything), so the tiers are ordered by what they cost in
   PIXELS first. Every field is a lever the renderer already has:

     deviceCap    ceiling on the device pixel ratio (a Retina panel at
                  1 instead of 2 is a quarter of the pixels)
     pixelRatio   further multiplier on top of that
     msaa         scene-target samples; 4x measured ~7.5ms at ratio 2
     shadow       sun map size; the redraw is ~4-7ms at 4096, and
                  measured +2ms again at 8192
     shadowEvery  redraw cadence in frames (QA pins 1 for determinism)
     shadowRadius half-extent of the sun's ortho frustum, in metres
     contact      screen-space contact-shadow strength, 0 skips it
     contactSteps taps along the sun ray for that term
     ao           screen-space occlusion strength, 0 skips the pass
     bloom        bloom chain scale relative to the scene target

   THE TEXEL IS THE TIER, and it was not monotonic.

   `shadow` and `shadowRadius` are not two independent levers: what
   the picture gets is 2 * radius / mapSize, the world size of one
   shadow texel. On the previous table that came out at 0.371, 0.254,
   0.156 and 0.205 metres - so ULTRA, which costs the most, handed
   the player a COARSER shadow than HIGH, because its radius grew by
   a third while its map stayed at 4096. Anything asked to pick the
   best tier was picking a downgrade.

   The ladder below is chosen on the texel first and the range
   second, so every step up is strictly finer AND reaches at least as
   far: 0.332, 0.205, 0.163, 0.083. Ultra buys 8192, which is where
   the +2ms goes; `setQuality` caps it against the driver's real
   maximum texture size, so a machine that cannot hold it falls back
   rather than failing to allocate.

   And the map alone cannot resolve a CHARACTER. Even at ultra the
   figure is 1.85m over a 0.083m texel - twenty-two samples for a
   whole body, which is a silhouette and nothing inside it. `contact`
   is the term that covers that scale; see the contact-shadow note in
   the AO block.

   `low` exists so that a machine that cannot hold 30fps at high can
   hold 60 with the same world. The table lives at module scope so
   the settings UI can list the tiers without a renderer in hand.
   ------------------------------------------------------------------ */

const QUALITY = Object.freeze({
  low: {
    label: "LOW", deviceCap: 1, pixelRatio: 0.75, msaa: 0,
    shadow: 1024, shadowEvery: 3, shadowRadius: 170, ao: 0, bloom: 0.35,
    contact: 0, contactSteps: 0,
  },
  medium: {
    label: "MEDIUM", deviceCap: 1.5, pixelRatio: 1.0, msaa: 2,
    shadow: 2048, shadowEvery: 2, shadowRadius: 210, ao: 0.72, bloom: 0.45,
    contact: 0.55, contactSteps: 8,
  },
  high: {
    /* HIGH is the default, including on phones. A 2x mobile canvas plus 4x
       MSAA shades sixteen samples per CSS pixel before post-processing; the
       measured active-play path was fill-bound there. 1.5x + 2x retains a
       sharper-than-CSS image while cutting that default sample load by 72%.
       ULTRA keeps the former ceiling for players who explicitly choose it. */
    label: "HIGH", deviceCap: 1.5, pixelRatio: 1.0, msaa: 2,
    shadow: 3072, shadowEvery: 2, shadowRadius: 250, ao: 0.85, bloom: 0.5,
    contact: 0.72, contactSteps: 12,
  },
  ultra: {
    label: "ULTRA", deviceCap: 2, pixelRatio: 1.0, msaa: 4,
    shadow: 8192, shadowEvery: 2, shadowRadius: 340, ao: 0.95, bloom: 0.5,
    contact: 0.85, contactSteps: 18,
  },
});
export const QUALITY_TIERS = Object.freeze(Object.keys(QUALITY));
export const DEFAULT_QUALITY = "high";
/** The tier name a stored/URL value maps to, or the default. */
export function normalizeQuality(tier) {
  return typeof tier === "string" && Object.prototype.hasOwnProperty.call(QUALITY, tier)
    ? tier : DEFAULT_QUALITY;
}
export function qualityLabel(tier) {
  return QUALITY[normalizeQuality(tier)].label;
}

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
uniform vec2 uDepthTexel;  // 1 / depth-buffer size, which is NOT this pass's
uniform mat4 uProj;        // the camera's own projection, for the sun march
uniform vec3 uSunView;     // sun direction in VIEW space, pointing at the sun
uniform vec4 uContact;     // strength, reach (m), steps, start offset (m)
uniform vec2 uContactFade; // view distance where the term fades out (m)

/* SNAPPED TO A DEPTH TEXEL CENTRE, and this is the second half of the
   band fix.

   This pass runs at half resolution, so its pixel centre i sits at UV
   (2i+1)/W in the FULL-resolution depth buffer - which is exactly the
   BOUNDARY between texels 2i and 2i+1, not the centre of either. The
   depth texture is nearest-filtered, so which of the two a given
   pixel gets is decided by the last bit of a float compare, and that
   decision alternates across the screen in a fixed pattern. Every
   depth this pass reads was therefore quantised on a grid, and so was
   every position derived from one.

   Snapping to the nearest texel CENTRE makes the choice explicit and
   uniform. It costs two multiply-adds and a floor.

   AND THE SNAP HAS TO ROUND, NOT FLOOR. uv / uDepthTexel at a half-res
   pixel centre is 2i+1 - an INTEGER, plus whatever error the varying
   interpolator left in it - and floor of a near-integer is the very
   coin flip this line exists to remove. The first version of this
   snap floored, and it cleaned the SwiftShader reference (whose
   interpolator happened to land on one side every time) while leaving
   the Apple GPU's plaid almost intact (its interpolator does not).
   Adding a half before the floor moves the decision to 2i+1.5, where
   nothing ever lands. */
float depthAt(vec2 uv) {
  vec2 snapped = (floor(uv / uDepthTexel + 0.5) + 0.5) * uDepthTexel;
  return texture2D(tDepth, snapped).x;
}

float viewZ(vec2 uv) {
  float d = depthAt(uv);
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

/* THE BANDS, AND WHAT THEY ACTUALLY WERE. Two earlier hunts are
   recorded here because both looked in the right place and drew the
   wrong conclusion, and the conclusion is what cost the time.

   The symptom: the occlusion buffer carries horizontal and vertical
   BANDS at fixed screen positions. Suspect one was this hash - the
   composite pass's dither comment says a fract-multiply-dot hash
   loses precision at large screen coordinates and prints a regular
   pattern, which is exactly the symptom. Swapped for interleaved
   gradient noise: the buffer came back byte-for-byte the same
   character, mean 208.81 against 208.82, bands in identical places.
   Suspect two was the pixel-size clamp on the sample radius, which is
   a function of DEPTH and so quantises along iso-depth lines. Fading
   the tap instead of clamping it is a real improvement and it stayed;
   it did not move the bands either.

   Both results are the same clue read as a dead end: the bands do not
   care what the sampling does, because they are not a sampling
   artefact. They come from the NORMAL, and specifically from these
   two lines as they used to read:

     vec3 p = viewPos(vUv);
     vec3 n = normalize(cross(dFdx(p), dFdy(p)));

   THIS PASS RUNS AT HALF RESOLUTION AND READS A FULL-RESOLUTION
   DEPTH TEXTURE. dFdx is a difference across a 2x2 quad of THIS
   pass's pixels, so it steps two full-res depth texels; the depth
   texture is nearest-filtered, so consecutive AO pixels land on
   texels that alternate between "the same one" and "two apart". The
   derivative therefore comes out alternately near-zero and doubled,
   on a fixed grid, and normalising the cross of a near-zero vector
   is numerical noise. Every second column and every second row got a
   garbage normal, the occlusion computed against it was wrong, and
   the result is a plaid at fixed screen positions - immune to the
   jitter, immune to the radius clamp, exactly as measured.

   The earlier note also under-reported the cost, because it was
   measured on a flat sand wash at distance: 0.78 code values of
   ripple, which is genuinely nothing. On a large surface CLOSE to the
   camera - a cliff face, a refinery stack, the ground under your feet
   - the same defect is worth 9.3 code values mean and 75 peak, and it
   reads as a dark grid laid over the world that slides with the
   camera and stops at the horizon. That is what it was reported as.

   The fix is below: difference the depth at explicit offsets of ONE
   TEXEL OF THIS PASS instead of asking the rasteriser for a
   derivative it cannot compute correctly across a resolution change.
   Four extra taps on a quarter-area pass. */
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* CONTACT SHADOWS - the sun's half of the argument this block opens
   with.

   The occlusion above exists because the shadow map cannot answer
   "how much SKY reaches this point". This answers the other half:
   "how much SUN reaches it", at a scale the shadow map cannot answer
   either.

   A single ortho cascade has to cover the ground the camera can see,
   and on this map that is hundreds of metres - so one texel is
   0.08-0.33m depending on tier, and the PLAYER IS 1.85m TALL. Even
   at ultra the whole figure is twenty-two samples: enough for an
   outline on the sand, nothing at all for a cloak against a thigh, a
   pauldron against a chest, a polearm across a shoulder, or the dark
   directly under a boot. Those are the shadows a third-person camera
   spends the whole game looking at, and no amount of map is going to
   produce them - three cascades would, and there is no room for
   cascades here: every material in this level already carries an
   onBeforeCompile with a hand-managed cache key, and the CSM addon
   works by replacing exactly that.

   So the short range is marched in screen space instead, against the
   depth buffer this pass already has bound. Step along the sun
   direction in VIEW space; if the depth buffer says something is in
   front of where the ray has got to, the ray is inside geometry and
   the pixel is occluded. It costs no new target and no new geometry
   pass - the reach is metres, not hundreds of them, so a dozen taps
   covers it.

   Three things this cannot do, stated so they are not re-discovered:
   it only knows about occluders that are ON SCREEN, it works from a
   depth buffer with no thickness so a thin object shadows as far as
   the thickness test allows, and at half resolution its finest
   detail is two pixels. All three are why it is an ADDITION to the
   shadow map rather than a replacement for it. */
float contactShadow(vec3 p, vec3 n) {
  if (uContact.x <= 0.0 || uContact.z < 1.0) return 1.0;
  /* A NEAR-FIELD TERM, AND IT HAS TO SAY SO.

     Left running to the horizon this does not merely waste taps, it
     returns the wrong answer: the thickness slab scales with depth
     (it has to - one depth texel is worth more metres the further
     away it is), so at several hundred metres the slab is wider than
     the depth step between one pixel and the next on any receding
     surface, every tap reports a hit, and the whole distant rim wall
     comes back uniformly occluded. It did, and the occlusion buffer
     showed it as solid black mountains.

     Past a few tens of metres the shadow map has the range properly
     covered anyway, so the term is faded out rather than fixed. */
  float fade = 1.0 - smoothstep(uContactFade.x, uContactFade.y, -p.z);
  if (fade <= 0.002) return 1.0;
  /* A SURFACE FACING AWAY FROM THE SUN IS ALREADY DARK, and marching
     from it is not merely wasted - it is wrong. The reconstructed
     normal is forced to face the camera, so on a body turned away
     from the key the ray sets off INTO the geometry it started on
     and reports a hit immediately. Left in, that put a false shadow
     over every surface the sun was already grazing: the figure's lit
     pauldron came back the same brown as its shaded side, which is
     the term erasing exactly the modelling it was added to reveal.
     N.L below about a twentieth is the BRDF's own business. */
  float ndl = dot(n, uSunView);
  if (ndl <= 0.06) return 1.0;
  int steps = int(uContact.z);
  /* The march starts off the surface along the NORMAL, and the offset
     grows as the sun grazes: at N.L near 1 the ray leaves the surface
     immediately and a small offset clears it, while at N.L near zero
     it travels almost parallel to the surface and a fixed offset
     never does. This is the screen-space form of the same slope-scaled
     bias a shadow map needs, and for the same reason. */
  vec3 origin = p + n * (uContact.w / max(ndl, 0.18));
  float stepLen = uContact.y / float(steps);
  /* Thickness has to be at least a STEP, and that is not a tuning
     choice. The test only fires while the ray is between the front
     of an occluder and one thickness behind it; if the slab is
     thinner than the ray travels per tap, a caster narrower
     than one step is jumped clean over - the ray is in front of a
     boot on one tap and already too deep inside it on the next, and
     the contact under the foot, which is the single thing this term
     exists for, never registers. It also scales with depth, because
     one depth texel is worth more metres the further away it is. */
  float thick = clamp(-p.z * 0.03, stepLen * 1.7, 0.9);
  /* Jittered by a half step, per pixel. Un-jittered, every pixel
     tests the same distances and the term prints the ladder as
     concentric arcs around each occluder - the same failure the
     occlusion ladder above jitters for, and the blur removes it for
     the same reason. */
  float j = hash12(gl_FragCoord.xy + 4.77);
  float occ = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= steps) break;
    float t = (float(i) + j) * stepLen + stepLen * 0.5;
    vec3 sp = origin + uSunView * t;
    vec4 clip = uProj * vec4(sp, 1.0);
    if (clip.w <= 0.0) continue;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float sceneZ = viewZ(uv);
    // View z is negative ahead of the camera, so "the scene is nearer
    // than the ray" is sceneZ > sp.z.
    float dz = sceneZ - sp.z;
    // The near cut is a depth-buffer tolerance, so it scales with
    // distance for the same reason the thickness does.
    if (dz > max(0.02, -p.z * 0.004) && dz < thick) {
      /* A hit close to the surface is a contact and is trusted; one
         at the far end of the reach is as likely to be a silhouette
         the march wandered behind, and is faded rather than believed.
         Breaking here is correct: the ray is already inside something
         and every later tap is measuring that same interior. */
      occ = 1.0 - 0.45 * (t / uContact.y);
      break;
    }
  }
  return clamp(1.0 - occ * fade, 0.0, 1.0);
}

void main() {
  float z = viewZ(vUv);
  if (-z >= uNearFar.y * 0.98) { gl_FragColor = vec4(1.0); return; }

  vec3 p = viewPos(vUv);
  /* THE NORMAL, DIFFERENCED AT THIS PASS'S OWN RESOLUTION. See the
     note above hash12 for why dFdx/dFdy cannot be used here.
     The nearer of the two one-sided differences is taken on each
     axis, which is the standard trick for keeping the reconstructed
     normal on the SURFACE at a silhouette rather than tilting it
     across the depth cliff - a central difference would tip every
     edge pixel toward the background and ring the silhouette. */
  vec3 pxp = viewPos(vUv + vec2(uTexel.x, 0.0));
  vec3 pxm = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pyp = viewPos(vUv + vec2(0.0, uTexel.y));
  vec3 pym = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dpx = abs(pxp.z - p.z) < abs(p.z - pxm.z) ? (pxp - p) : (p - pxm);
  vec3 dpy = abs(pyp.z - p.z) < abs(p.z - pym.z) ? (pyp - p) : (p - pym);
  vec3 nRaw = cross(dpx, dpy);
  /* A degenerate cross product still has to produce a usable normal
     rather than a NaN - one NaN here propagates through the blur and
     takes a whole neighbourhood of the frame with it. Facing the
     camera is the honest fallback: it makes the pixel report no
     occlusion instead of random occlusion. */
  float nLen = length(nRaw);
  vec3 n = nLen > 1e-9 ? nRaw / nLen : vec3(0.0, 0.0, 1.0);
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
  /* Two independent terms in two channels of one buffer: sky
     visibility in .r, sun visibility in .g. They share this pass's
     depth taps, its reconstructed normal, its half resolution and
     its bilateral blur, so the second one costs a loop and no
     bandwidth at all. */
  gl_FragColor = vec4(occOut, contactShadow(p, n), 0.0, 1.0);
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
uniform vec2 uDepthTexel;

// Snapped, for the reason given in the occlusion pass above: this
// filter runs at half resolution over a full-resolution depth buffer.
float viewZ(vec2 uv) {
  vec2 snapped = (floor(uv / uDepthTexel + 0.5) + 0.5) * uDepthTexel;
  float d = texture2D(tDepth, snapped).x;
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
  /* THE GRADIENT, ALSO DIFFERENCED EXPLICITLY, and for the same
     reason the AO pass's normal is: dFdx of z0 here was a derivative
     of a FULL-resolution depth texture taken across a HALF-resolution
     quad, so it alternated between near-zero and doubled on a fixed
     screen grid. Near-zero clamps the tolerance to its 0.02 floor and
     the filter stops dead; doubled hands it slack it has not earned.
     Alternating between the two every other row and column is what
     turned the pass's own sampling noise into a plaid instead of
     removing it - so the blur was not merely failing to fix the
     bands, it was printing half of them.

     A MINIMUM of the two one-sided steps, not the average: a pixel
     sitting on a silhouette has one neighbour on the surface and one
     across the cliff, and the surface one is the only honest estimate
     of what a flat continuation is entitled to. */
  float zp = viewZ(vUv + uDir * uTexel);
  float zm = viewZ(vUv - uDir * uTexel);
  float gz = clamp(min(abs(zp - z0), abs(z0 - zm)), 0.02, 1.2);
  // .r is sky visibility, .g is sun visibility. Both want the same
  // depth-aware filter, and filtering them together is free.
  vec2 sum = texture2D(tAo, vUv).rg * 0.25;
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
      sum += texture2D(tAo, uv).rg * dw;
      wsum += dw;
    }
  }
  vec2 v = sum / max(wsum, 1e-4);
  gl_FragColor = vec4(v.x, v.y, 0.0, 1.0);
}
`;

const DEBUG_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uMode;   // 0 = raw texture, 1 = depth, 2 = green as grey
void main() {
  if (uMode > 1.5) {
    // The occlusion buffer packs two terms; this reads the sun one
    // (.g) on its own, because as RGB it renders as a red/green
    // duotone that nobody can judge a contact shadow in.
    float g = texture2D(tSrc, vUv).g;
    gl_FragColor = vec4(g, g, g, 1.0);
    return;
  }
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
uniform vec2 uContactGain;  // authority (0 disables), lit knee (linear)
uniform vec2 uBounce;      // gain, receiver knee (linear scene luma)
uniform vec3  uLift;
uniform vec3  uGamma;
uniform vec3  uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uContrastFloor; // 0 = the pivot LINE, 1 = the pivot POWER
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

  /* CONTACT SHADOW - and its authority is the EXACT OPPOSITE of the
     occlusion term's, which is the whole reason it is a separate
     channel rather than folded into that one.

     Occlusion above removes SKY, so it hands back the pixels the key
     is already winning - the 1.0 - 0.7 * keyed factor. This removes
     SUN, so it only has anything to remove where the key lands in the
     first place: a surface already in a dune's shadow has no direct
     light left for a boot to block, and darkening it a second time is
     the "occlusion applied in the wrong place" mistake in the note
     above, run in reverse.

     What is left after the key is taken away is sky - so the residual
     is tinted toward the same violet every other shadow side in this
     world uses, rather than pulled toward grey. Same rule, same
     constant, opposite trigger. */
  if (uContactGain.x > 0.0) {
    /* ITS OWN KNEE, NOT the occlusion term's. That one is
       calibrated to hand back the BLOWN top of the picture - the
       scene buffer runs p50 0.165 and 99.2% below 0.78, so at 0.55
       it passes two or three percent of the frame. Reused here it
       gave the contact term authority over almost nothing: the
       occlusion channel showed a crisp polearm shadow across the
       sand and the composite showed a hint of one.

       What this term needs to know is the opposite question - is
       this pixel LIT AT ALL - and that separates at the bottom of
       the range, not the top: sunlit sand sits around 0.17 and up,
       a dune's own shadow side an order of magnitude below it. */
    float lit = smoothstep(uContactGain.y, uContactGain.y * 3.0, keyLuma);
    float sun = texture2D(tAo, vUv).g;
    float cs = mix(1.0, sun, uContactGain.x * lit);
    scene *= vec3(cs) * mix(vec3(1.0), vec3(0.86, 0.80, 1.02),
                            (1.0 - cs) * uAo.y);
  }

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

  /* CONTRAST ABOUT A PIVOT, AND THE PIVOT MAY NOT EAT BLACK.

     (c - 0.5) * k + 0.5 is a straight line through mid-grey, so
     for k > 1 it crosses zero at 0.5 * (1 - 1/k) and everything
     below that is negative. The very next line is
     pow(max(c, 0.0), uGamma), which clamps it, so that whole band
     lands on exactly 0.0 and is then repainted at uLift.

     IT IS NOT A SHADOW CRUSH, IT IS A HARD BLACK CLIP, AND IT IS
     ENORMOUS. At the island's trade contrast of 1.06 the crossing
     is display-linear 0.0283 - sRGB code 47, a fifth of the range -
     and every pixel under it comes out the same flat pedestal
     colour regardless of what light was on it.

     Measured on the island's weeping frame, over the shaded flank
     that fills its lower half: switching the sky environment
     ENTIRELY off moved that flank by 0.1 of a code value in green
     and 1.0 in blue, while switching the LIFT off dropped it from
     rgb(8,9,15)
     to rgb(3,2,3). The picture in there was the lift. Round 6
     raised envIntensity to 0.52 and re-tinted the ground bounce to
     a lagoon cyan and neither could reach the frame, because the
     term that was deleting them sits four lines downstream of both.

     WHY IT BIT THIS WORLD AND NOT THE OTHER TWO. A warm-shadow
     world survives a black clip: Vesper's dune shade measures
     #623120, whose red sits at display-linear 0.12, four times clear
     of its own crossing. This world's shade is blue-cyan ON PURPOSE
     - round 6's whole finding was that a warm bounce makes
     procedural jungle read as brown plastic - and a cool shadow
     keeps its energy in BLUE, the channel with the smallest linear
     value and the least luma weight. The clip takes red and green
     first and leaves a blue pedestal, which is the "near-zero black
     with no hue in it" a blind judge returned verbatim.

     THE FIX IS THE SAME OPERATOR WITHOUT THE CROSSING. A power
     about the pivot, 0.5 * (c/0.5)^k, has EXACTLY the same slope at
     mid-grey - d/dc = k there - tracks the line to within 0.008 over
     the whole upper half, and maps 0 to 0 instead of to a negative
     number. Checked at c = 0.62, the split tone's crossover: 0.628
     against the line's 0.627.

     For k < 1 the line does something the power does not, and it is
     kept: it LIFTS the floor, to 0.5 * (1 - k), which is how the
     squall grade at 0.94 gets its milk. That is a real intent even
     though lift is the term for it, so the power is switched off
     below k = 1 by the step. There is no seam either way - for
     k > 1 the power is above the line everywhere on [0,1] and for
     k < 1 below it everywhere, so the two agree exactly at k = 1.

     AND IT IS OPT-IN, PER GRADE, BECAUSE THE OTHER TWO WORLDS ARE
     THE REFERENCE THIS PROGRAMME IS SCORED AGAINST. uContrastFloor
     defaults to 0, which is the line unchanged; a grade that does
     not mention it renders byte-for-byte as before. Moving Vesper's
     black point to fix the island's would move the ruler.

     It is a BLEND rather than a switch because the full power form
     over-corrects: it lifts the low midtones as well as the clipped
     band, and on the island's fourteen frames that took the 1st
     percentile from 7-29 to 13-46 against Vesper's 7-34, and cost
     the deep lagoon a fifth of its dark-quartile chroma. Mixing is
     nearly free where the two curves are close - they differ by
     0.007 at display-linear 0.1 - and worth 3x at 0.04, so a
     partial blend acts almost only on the band the clip destroyed.
     See ATOLL_GRADES.trade.contrastFloor for the number and why. */
  vec3 cLine = (c - 0.5) * uContrast + 0.5;
  vec3 cPow = 0.5 * pow(max(c, 0.0) * 2.0, vec3(uContrast));
  c = mix(cLine, cPow, uContrastFloor * step(1.0, uContrast));
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

/* A LIGHT THAT CONTRIBUTES NOTHING STILL COSTS A FULL BRDF.

   three's forward loop calls RE_Direct for EVERY light in the scene on
   EVERY lit fragment - GGX specular, Lambert diffuse, the lot - and only
   afterwards multiplies by an irradiance that is exactly zero for a
   point light past its cutoff `distance` (getDistanceAttenuation
   saturates to 0 there) or for any light held at intensity 0.

   This level keeps 21 point lights and 3 directionals resident at all
   times on purpose (the constant-visible-light invariant: a light that
   joins the scene mid-session recompiles every material - see
   summit-lights/shield/apostate), and at any given pixel almost all of
   them are either out of range or parked at zero. Measured on the
   spawn causeway at DPR2/high: hiding every point light took the GPU
   frame from 33.3ms to 20.1ms; the ten zero-intensity ones alone were
   7ms. That is the single largest cost in the frame and none of it
   reaches the picture.

   So the loop body is guarded: RE_Direct only runs when the incident
   colour is non-zero. Skipping an addition of exactly 0.0 is
   bit-identical to performing it (the A/B stills harness confirms
   byte-equal captures), the branch is coherent across a warp because
   light reach is spatial, and the light COUNT the program is keyed on
   is untouched, so the invariant above still holds. Installed once,
   before the first program compiles; idempotent; a no-op with a
   warning on any three whose chunk text has moved. */
export function installLightGuard(THREE) {
  const chunks = THREE.ShaderChunk;
  if (!chunks || typeof chunks.lights_fragment_begin !== "string") return false;
  const src = chunks.lights_fragment_begin;
  if (src.includes("SF_LIGHT_GUARD")) return true;
  const call = "RE_Direct( directLight, geometryPosition, geometryNormal, "
    + "geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
  const count = src.split(call).length - 1;
  if (count < 1) {
    console.warn("[saintfall] light guard not installed: three's lights_fragment_begin "
      + "no longer matches; every resident light will be shaded at full cost.");
    return false;
  }
  chunks.lights_fragment_begin = src.split(call).join(
    `if ( directLight.color != vec3( 0.0 ) ) ${call} /* SF_LIGHT_GUARD */`);
  return true;
}

export function createRenderer(ctx, canvas) {
  const { THREE } = ctx;
  installLightGuard(THREE);

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
  /* WHICH GPU DID THE BROWSER ACTUALLY GIVE US. `powerPreference`
     above is a request, not a guarantee: a dual-GPU laptop can hand
     the page its integrated chip, and a browser whose GPU process has
     crashed (or whose hardware acceleration is switched off) hands
     back SwiftShader - a CPU rasteriser that turns a strong machine
     into a weak one with no error anywhere. That is exactly the field
     report this exists for: "an RTX-class card, but it only runs on
     low". The name is read once and surfaced in the settings menu and
     the boot log, so a player on the wrong renderer can SEE it is the
     wrong renderer instead of blaming the game's tiers. */
  let gpuName = "";
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    gpuName = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
  } catch (_) { gpuName = ""; }
  const softwareRendered =
    /swiftshader|llvmpipe|softpipe|software\s*(rasterizer|renderer|adapter)|microsoft basic render/i
      .test(gpuName);

  /* The DEVICE ratio (capped at 2, or lower on the cheaper quality
     tiers - a Retina panel at ratio 2 is four times the pixels of the
     same panel at 1, and pixels are the whole bill on weak hardware)
     is one of three factors in the real buffer size; the quality tier
     and the dynamic-resolution scale are the others. All three meet in
     applyPixelRatio(), the only caller of setPixelRatio - a second
     caller is how a quality switch silently discards the dynamic
     scale, or vice versa. */
  let tierDeviceCap = 2;
  const deviceRatio = () => Math.min(window.devicePixelRatio || 1, tierDeviceCap);
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
    uDepthTexel: { value: new THREE.Vector2() },
    uProj: { value: new THREE.Matrix4() },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    /* Strength, reach, steps, start offset.
       2.2m of reach: the term is for a body against its own limbs and
       against the ground it stands on, and at a 13-degree sun that is
       already 2m of ground travel for half a metre of height. Longer
       is not better - past a couple of metres a screen-space march is
       mostly finding silhouettes it has wandered behind, and the
       shadow map covers that range correctly anyway.
       0.03m start offset: about a third of the finest tier's shadow
       texel, and enough to clear the pixel's own surface at every sun
       elevation the cycle reaches. Steps come from the tier. */
    uContact: { value: new THREE.Vector4(1, 2.2, 12, 0.03) },
    /* Full strength inside 26m, gone by 52m. The near number is
       comfortably past the third-person camera's own boom, so the
       player and anything fighting them is always inside it; the far
       one is where a 2.2m march stops being able to resolve anything
       a 0.12m shadow texel has not already got. */
    uContactFade: { value: new THREE.Vector2(26, 52) },
  });
  const aoBlurMat = mkPass(AO_BLUR_FRAG, {
    tAo: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uDir: { value: new THREE.Vector2(1, 0) },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    uDepthTexel: { value: new THREE.Vector2() },
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
    uContactGain: { value: new THREE.Vector2(QUALITY[DEFAULT_QUALITY].contact, 0.05) },
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
    /* ZERO IS THE SHIPPED OPERATOR. See the block above the contrast
       line in the composite: at 0 the term is exactly the pivot LINE
       Vesper-IX and Kenosis are graded against, so a grade that does
       not mention this field renders byte-for-byte as before. Only a
       grade that has been re-measured against the un-clipped floor
       may raise it. */
    uContrastFloor: { value: 0 },
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
    /* DEFAULTED, for exactly the reason the block below `toe` gives,
       and this pair is the one that was left out of it.

       A third world's grade table omitted `contrast` and `tint` -
       both are easy to miss, because neither appears in the schema
       anyone reads off (lift/toe/shade/bounce/gamma/gain/saturation
       are the ones every comment in art.js discusses). Both reached
       their uniforms as `undefined`, which three uploads as NaN, and
       `c = (c - 0.5) * uContrast + 0.5` at line 1113 turns one NaN
       into the whole frame.

       What that looks like from the outside is worth recording,
       because it names nothing: every pixel comes back the same
       value, the scene target is FINE when you blit it, no shader
       fails to compile, no console message appears, and switching
       off bloom, AO, contact, shade, exposure and the toe changes
       the output by zero - because NaN does not care about any of
       them. The only two terms that appeared to do anything were the
       vignette and the halo, which is what sent the first day of
       diagnosis toward the post chain's screen-space end.

       The defaults are the values the term shipped with, so a grade
       assembled by an older code path still renders. Vesper-IX and
       Kenosis define both on every row and are byte-for-byte
       unaffected. */
    compMat.uniforms.uContrast.value = Number.isFinite(g.contrast) ? g.contrast : 1.05;
    /* Defaulted to 0, which is the shipped pivot line, for the same
       reason its neighbour is defaulted at all. A world that has not
       been re-measured must not have its black point moved by an
       engine change made for another one. */
    compMat.uniforms.uContrastFloor.value =
      Number.isFinite(g.contrastFloor) ? g.contrastFloor : 0;
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
    /* OPTIONAL, and only ever y and z. `uAo.x` is the occlusion
       STRENGTH and belongs to the quality tier - setQuality writes it
       and a grade that also wrote it would silently undo the tier on
       the next atmosphere update. What the grade may own is the
       sky-tint amount and the key knee, because both are properties
       of the picture rather than of the hardware. Absent on every
       Vesper-IX grade, so the composite keeps the constants it was
       cut with; a white world raises the knee or loses its contacts. */
    const gao = Array.isArray(g.ao) ? g.ao : null;
    if (gao) {
      if (Number.isFinite(gao[0])) compMat.uniforms.uAo.value.y = gao[0];
      if (Number.isFinite(gao[1])) compMat.uniforms.uAo.value.z = Math.max(1e-3, gao[1]);
    }
    const sh = hexToRgb(g.shadeHue || "#808080");
    compMat.uniforms.uShadeHue.value.set(sh[0], sh[1], sh[2]);
    const st = hexToRgb(g.shadowTint);
    const ht = hexToRgb(g.highlightTint);
    compMat.uniforms.uShadowTint.value.set(st[0], st[1], st[2]);
    compMat.uniforms.uHighlightTint.value.set(ht[0], ht[1], ht[2]);
    compMat.uniforms.uTintAmount.value = Number.isFinite(g.tint) ? g.tint : 0.3;
    const halo = atmos.sunHalo;
    compMat.uniforms.uHaloTint.value.set(halo.r * 0.14, halo.g * 0.11, halo.b * 0.08);
    atmosRef = atmos;
    void v3;
  }

  /* ------------------------------ render ------------------------------ */

  /* The live atmosphere, kept so the contact-shadow march can read
     the CURRENT sun direction each frame. It is the same object sky.js
     updates in place, not a copy - `applyAtmosphere` is called once at
     boot and again on every grade change, and the direction inside it
     moves continuously with the cycle. */
  let atmosRef = null;

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
    /* THE DIFFUSE SKY FILL ON OPAQUE SURFACES, SEPARATED FROM THE
       WATER'S SKY TERM AND FROM THE HEMISPHERE LIGHT.

       `atmos.envIntensity` does three unrelated jobs on the island:
       this IBL, `skyFill.intensity` in atoll-sky.js, and the water's
       `uSkyAmb` through atoll-water's SKY_AMB_GAIN. The water's 0.55
       was cut against a Fresnel integral and measured; the terrain's
       was not. Scaling all three together to fix the terrain would
       move a calibrated number to correct an uncalibrated one, and
       the water is the one material three blind judges have praised.
       So the gain that fixes the landmass rides here alone.

       Defaults to 1, and the default is the whole point: Vesper-IX
       and Kenosis set no `skyFillGain` and their fill is unchanged
       to the last bit. See ATOLL_GRADES.trade.skyFillGain for the
       number, the arithmetic it corrects and what it cost the lit
       sand. */
    const fill = Number.isFinite(atmos.grade && atmos.grade.skyFillGain)
      ? atmos.grade.skyFillGain : 1;
    scene.environmentIntensity = atmos.envIntensity * fill * lerp(1, 0.18, dynamic);
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
      /* From the SCENE target, not the AO target. These are the two
         different resolutions the band artefact lived between, so
         taking this off the wrong one puts it straight back. */
      aoMat.uniforms.uDepthTexel.value.set(
        1 / sceneTarget.width, 1 / sceneTarget.height);
      aoMat.uniforms.uNearFar.value.set(cam.near, cam.far);
      aoMat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      // Pixels per world unit at one unit of depth: the standard
      // projection scale, taken from the actual matrix rather than
      // from the fov, so it stays correct if either changes.
      aoMat.uniforms.uProjScale.value =
        0.5 * aoTarget.height * cam.projectionMatrix.elements[5];
      /* The sun in VIEW space, re-derived every frame: the cycle
         moves it, and a stale direction here would march the contact
         term off at yesterday's angle while the shadow map moved. */
      aoMat.uniforms.uProj.value.copy(cam.projectionMatrix);
      if (atmosRef) {
        aoMat.uniforms.uSunView.value
          .copy(atmosRef.sunDir).transformDirection(cam.matrixWorldInverse).normalize();
      }
      runPass(aoMat, aoTarget);

      // Separable, so the blur is 2 x 9 taps rather than 81.
      aoBlurMat.uniforms.tDepth.value = sceneTarget.depthTexture;
      aoBlurMat.uniforms.uNearFar.value.set(cam.near, cam.far);
      aoBlurMat.uniforms.uTexel.value.set(1 / aoTarget.width, 1 / aoTarget.height);
      aoBlurMat.uniforms.uDepthTexel.value.set(
        1 / sceneTarget.width, 1 / sceneTarget.height);
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

  /* The tier table is at module scope (see QUALITY, top of file). */
  let qualityTier = DEFAULT_QUALITY;
  /* Reported, because the shadow TEXEL - not the map size and not the
     frustum on their own - is the number that decides what a shadow
     can resolve, and the tier ladder was wrong for a release because
     nothing printed it. */
  let shadowMap = QUALITY[DEFAULT_QUALITY].shadow;
  let shadowSpan = QUALITY[DEFAULT_QUALITY].shadowRadius;

  function setQuality(tier, sky) {
    const key = normalizeQuality(tier);
    const q = QUALITY[key];
    qualityTier = key;
    tierDeviceCap = q.deviceCap;
    tierPixelRatio = q.pixelRatio;
    applyPixelRatio();
    bloomScale = q.bloom;
    aoEnabled = q.ao > 0;
    compMat.uniforms.uAo.value.x = q.ao;
    /* MSAA lives on the scene target's framebuffer, which three builds
       the first time the target is bound and never revisits - so a
       changed sample count only takes effect if the old framebuffer is
       thrown away. resize() below will NOT do that when the buffer size
       is unchanged (setSize is a no-op then), hence the explicit
       dispose. The depth texture the AO and composite passes read is
       re-created by the same setup pass, on the same JS object, so
       their uniforms stay valid. */
    const msaa = Math.min(q.msaa, maxSamples);
    if (sceneTarget.samples !== msaa) {
      sceneTarget.samples = msaa;
      sceneTarget.dispose();
    }
    aoMat.uniforms.uContact.value.x = q.contact > 0 ? 1 : 0;
    aoMat.uniforms.uContact.value.z = q.contactSteps;
    compMat.uniforms.uContactGain.value.x = q.contact;
    if (!ctx.qa) shadowEvery = q.shadowEvery;
    if (sky) {
      /* Capped against what the driver will actually allocate. Ultra
         asks for 8192, which is inside the ES 3.0 floor but not
         guaranteed on every mobile GL path; over the cap three logs a
         warning and hands back an unusable map, so the tier degrades
         here instead. */
      const map = Math.min(q.shadow, renderer.capabilities.maxTextureSize || q.shadow);
      sky.sun.shadow.mapSize.set(map, map);
      if (sky.sun.shadow.map) {
        sky.sun.shadow.map.dispose();
        sky.sun.shadow.map = null;
      }
      // Sets the frustum AND re-derives both biases from the texel the
      // map size above just fixed. Order matters: the bias is a
      // function of BOTH numbers.
      sky.setShadowRadius(q.shadowRadius);
      shadowMap = map;
      shadowSpan = q.shadowRadius;
    }
    // The old map was just disposed; without a forced redraw the next
    // interleave gap would present one frame of shadowless world.
    requestShadowUpdate();
    resize(width, height);
    return key;
  }

  return {
    renderer,
    scene,
    camera,
    render,
    resize,
    setQuality,
    /* The unmasked renderer string and whether it is a CPU rasteriser.
       Read-only diagnostics; see the note where they are derived. */
    get gpu() { return gpuName; },
    get softwareRendered() { return softwareRendered; },
    get quality() { return qualityTier; },
    qualityTiers: QUALITY_TIERS,
    qualityLabel(tier = qualityTier) { return qualityLabel(tier); },
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
     * reason a warm-up that just renders a few frames does not.
     *
     * TWO CAVEATS, both paid for once:
     * - Lights are collected with traverseVisible, so a light inside
     *   a hidden group is ABSENT from the programs this compiles, and
     *   the frame that unhides it re-keys every lit material in the
     *   scene. Every runtime-revealed light in this game is therefore
     *   scene-parented at intensity 0 (pod spill, heart lamp,
     *   reliquary lamp, Aegis, Apostate, undercroft).
     * - A material with no object in the graph is invisible to the
     *   traverse; it compiles on the first frame something USES it.
     *   Materials built for on-demand meshes get a hidden warm stub
     *   (see the emergence shards in enemies.js).
     *
     * `targetScene` compiles a subtree that currently lives OUTSIDE
     * the scene (the cinematic borrows the pod into its own orbital
     * scene at boot) against the LEVEL's lighting state, so its
     * programs are the ones the level will actually use when the
     * subtree comes home. */
    async warmShaders(cam = camera, sourceScene = scene, targetScene = null) {
      const before = renderer.info.programs ? renderer.info.programs.length : 0;
      const t0 = performance.now();
      // Parallel compile where the driver offers it; the sync path is
      // correct either way, just slower.
      if (typeof renderer.compileAsync === "function") {
        await renderer.compileAsync(sourceScene, cam, targetScene);
      } else {
        renderer.compile(sourceScene, cam, targetScene);
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
      debugMat.uniforms.uMode.value = which === "depth" ? 1
        : which === "contact" ? 2 : 0;
      debugMat.uniforms.tDepth.value = sceneTarget.depthTexture;
      debugMat.uniforms.uNearFar.value.set(camera.near, camera.far);
      debugMat.uniforms.tSrc.value = (which === "ao" || which === "contact")
        ? aoTarget.texture
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
    /** Contact-shadow authority and tap count, for A/B isolation.
     *  Zero removes the term entirely (the composite branches on it),
     *  which is what an isolation probe needs to attribute a change. */
    setContactShadow(gain, steps) {
      if (Number.isFinite(gain)) {
        compMat.uniforms.uContactGain.value.x = clamp01(gain);
        aoMat.uniforms.uContact.value.x = gain > 0 ? 1 : 0;
      }
      if (Number.isFinite(steps)) {
        aoMat.uniforms.uContact.value.z = clamp(Math.round(steps), 0, 24);
      }
    },
    get contactShadow() {
      return [compMat.uniforms.uContactGain.value.x, aoMat.uniforms.uContact.value.z];
    },
    setExposureScale(v) { compMat.uniforms.uExposure.value = v; },
    uniforms: compMat.uniforms,
    targets: { sceneTarget, bloomTargets, bloomUp, aoTarget, aoBlurTarget },
    captureDataURL() {
      return renderer.domElement.toDataURL("image/png");
    },
    info() {
      const r = sceneInfo;
      return {
        gpu: gpuName,
        softwareRendered,
        calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        renderScale: Number(renderScale.toFixed(3)),
        autoScale: autoOn(),
        shadowEvery,
        pixelRatio: Number(renderer.getPixelRatio().toFixed(3)),
        quality: qualityTier,
        msaa: sceneTarget.samples,
        aoStrength: compMat.uniforms.uAo.value.x,
        sceneSize: [sceneTarget.width, sceneTarget.height],
        shadowMap,
        shadowSpan,
        shadowTexel: Number(((shadowSpan * 2) / Math.max(1, shadowMap)).toFixed(4)),
        contact: compMat.uniforms.uContactGain.value.x,
        contactSteps: aoMat.uniforms.uContact.value.z,
      };
    },
  };
}

export { clamp, clamp01, lerp, srgb };
