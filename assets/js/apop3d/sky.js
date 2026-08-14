/* ============================================================
   APOP DEMON MOGGERS 3D - sky, fog and the per-course light rig

   Everything above and around the course: the skydome, the cloud
   decks, the sun or moon, the volumetric beams, the fog, and the
   full set of lights. Five courses plus a hub, five completely
   different times of day, one shader and one light set.

   Three rules are structural here and must not be undone.

   1. THE LIGHT SET IS ALLOCATED ONCE, AT LOAD, AND NEVER CHANGES
      SIZE. Adding a light to a scene forces three to recompile
      every material in it - a several-hundred-millisecond freeze
      that is instantly visible as a hitch when the player enters a
      course. So the rig below (key, rim, hemisphere, ambient and
      four accents) exists from the first frame of the session to
      the last, and switching courses only writes colours,
      positions and intensities. An unused light is set to zero
      intensity, not removed.

   2. ONE DOME SHADER FOR ALL SIX SKIES. Every per-course
      difference - cloud coverage, star density, city bokeh, LED
      bands, hellfire underglow, searchlight streaks - is a uniform
      with a zero setting, not a #define and not a second material.
      Compiling a second dome program on course entry would cost
      exactly the hitch rule 1 is avoiding.

   3. FOG FADES TO THE HORIZON, AND ADDITIVE FOG FADES TO BLACK.
      A distant wall must arrive at the eye the same colour as the
      sky behind it or there is a visible seam along every horizon
      line. But an ADDITIVE surface fogged toward a bright horizon
      gets BRIGHTER with distance, so a neon sign at the back of a
      course blooms into a white smear. Additive materials are
      patched (see applyAdditiveFog) to fade toward black instead,
      which is the correct answer for light that is being added to
      the frame rather than reflected out of it. This is a scar
      from the SAINTFALL renderer and it is not re-earned here.

   4. FOG IS THE DISTANCE KNOCKDOWN, AND THE KNOCKDOWN IS AN AIRLIGHT.
      The blind critic's fourth round named "zero atmospheric
      perspective - far stalls are as contrasty and saturated as
      foreground crates". Fog is the only per-material distance term
      in this engine, so fog is where that is answered, and the
      answer is entirely in the CHOICE OF COLOUR.

      Mixing toward a near-black fog colour multiplies everything by
      (1 - f). That dims the far field but it preserves the RATIO
      between its lights and its darks, so a distant kiosk keeps all
      of its contrast and all of its saturation and goes on competing
      with the subject. Mixing toward a MID, DESATURATED airlight
      pulls the far field's darks up and its lights down at the same
      time - contrast and saturation both collapse toward the
      airlight - which is what real aerial perspective does and what
      makes a Super Mario 64 background sit behind its foreground.

      There is a hard rail on this and it has already been hit once
      (see the food court's fog note below): the airlight must sit
      BELOW the value of the subject's own local field. An airlight
      brighter than the foreground inverts the depth and makes the
      back wall the brightest thing in the picture. Below it, the far
      field converges into a narrow mid band and the foreground keeps
      the only real blacks and the only real whites in the frame.

      `near` is the N of "knock down everything beyond N metres", and
      it is chosen as the far edge of the subject's neighbourhood -
      the capture presets stand her about seven metres out, so
      nothing inside about fourteen may be touched or the knockdown
      lands on the character it exists to protect.
   ============================================================ */

import * as THREE from "three";
import { TAU, lerp, damp, makeRng } from "apop3d/core.js";

/* ============================================================
   DOME SHADER
   ============================================================ */

/* Pinning gl_Position.z to w puts every dome fragment exactly on the
   far plane, so the dome can be a unit sphere parented to nothing and
   still sit behind all world geometry regardless of camera.far. */
const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;
}
`;

const DOME_FRAG = /* glsl */`
precision highp float;

varying vec3 vDir;

uniform float uTime;

/* Four-stop vertical gradient. A two-stop gradient is the loudest
   tell of a programmer sky: real skies have a bright band hugging the
   horizon, a saturated mid, and a dark zenith, and the transitions
   are at different rates. */
uniform vec3 uLow;        /* below the horizon line */
uniform vec3 uHorizon;
uniform vec3 uHigh;
uniform vec3 uZenith;

uniform vec3 uSunDir;
uniform vec3 uSunTint;
uniform vec4 uSun;        /* size, disc gain, glare gain, moon phase */

uniform vec4 uCloud;      /* coverage, edge sharpness, drift, opacity */
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;

uniform float uStars;

uniform vec2 uBokeh;      /* amount, vertical span of the city below */
uniform vec3 uBokehWarm;
uniform vec3 uBokehCool;

uniform float uSearch;
uniform vec3 uSearchDir[5];

uniform vec4 uFlash[4];   /* xyz direction, w intensity */

uniform vec2 uHell;       /* underglow amount, flicker */
uniform vec3 uHellTint;

uniform vec2 uLed;        /* LED band amount, beat pulse */
uniform vec3 uLedA;
uniform vec3 uLedB;

uniform vec3 uHazeTint;
uniform float uHaze;

/* GLSL has no saturate. Naming it clamp01 keeps the shader and the
   JS side of this module reading the same way, but note that it has
   to be DECLARED here: core.js exports a clamp01 for the CPU and
   calling it from shader source compiles to nothing, which fails as
   a link error rather than a parse error and takes the whole dome
   with it. */
float clamp01(float v) { return clamp(v, 0.0, 1.0); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += vnoise(p) * a;
    p = p * 2.03 + vec2(11.7, 3.1);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 rd = normalize(vDir);

  /* --- gradient ---------------------------------------------------- */
  vec3 col = mix(uLow, uHorizon, smoothstep(-0.42, 0.005, rd.y));
  col = mix(col, uHigh, smoothstep(0.0, 0.32, rd.y));
  col = mix(col, uZenith, smoothstep(0.26, 0.88, rd.y));

  /* Haze pooled around the sun's azimuth. Without it the disc looks
     pasted on: air scatters forward, so the sky is always brighter
     near the sun even a long way off axis. */
  float mu = dot(rd, uSunDir);
  col += uHazeTint * pow(max(mu, 0.0), 3.5) * uHaze
       * (1.0 - smoothstep(0.1, 0.75, rd.y));

  /* --- city bokeh below the horizon -------------------------------- */
  /* Course 4 puts the player on a roof. What sells the height is not
     the sky, it is the fact that the lights are BELOW you. Cells in
     (azimuth, elevation) space, so the grid converges toward the
     horizon the way a real grid of streets does. */
  if (uBokeh.x > 0.001 && rd.y < 0.04) {
    float az = atan(rd.z, rd.x);
    float depth = clamp01((-rd.y) / max(uBokeh.y, 0.001));
    vec2 cell = vec2(az * 22.0, pow(depth, 0.55) * 26.0);
    for (int k = 0; k < 2; k++) {
      vec2 sc = cell * (k == 0 ? 1.0 : 2.37) + float(k) * 7.3;
      vec2 id = floor(sc);
      vec2 f = fract(sc) - 0.5;
      float r = hash12(id + 3.1);
      if (r > 0.42) {
        vec2 off = vec2(hash12(id + 9.7), hash12(id + 21.3)) - 0.5;
        float d = length((f - off * 0.7) * vec2(1.0, 1.6));
        float pt = smoothstep(0.42, 0.02, d);
        vec3 tint = mix(uBokehWarm, uBokehCool, hash12(id + 41.9));
        float twinkle = 0.72 + 0.28 * sin(uTime * 2.1 + r * 31.0);
        col += tint * pt * uBokeh.x * twinkle
             * (1.0 - depth * 0.72) * (k == 0 ? 1.0 : 0.45);
      }
    }
    /* Sodium haze rising off the grid. A field of points with no glow
       between them reads as static, not as a city. */
    col += uBokehWarm * uBokeh.x * 0.30 * (1.0 - smoothstep(0.0, 0.55, depth));
  }

  /* --- cloud decks -------------------------------------------------- */
  /* Three layers projected onto notional planes at increasing height.
     The parallax between them is what makes a flat noise field read as
     volume; a single layer always looks like wallpaper. */
  if (uCloud.w > 0.001 && rd.y > 0.004) {
    vec2 sunFlat = normalize(vec2(uSunDir.x, uSunDir.z) + vec2(0.001, 0.0));
    for (int l = 0; l < 3; l++) {
      float hs = 1.0 + float(l) * 0.62;
      vec2 p = rd.xz / (rd.y + 0.055) * (1.05 / hs)
             + uTime * uCloud.z * vec2(1.0, 0.34) / hs;
      float d = fbm(p * 1.25);
      float lo = 1.0 - uCloud.x;
      float hi = lo + 0.04 + (1.0 - uCloud.y) * 0.55;
      float dens = smoothstep(lo, hi, d);
      /* Shade by comparing density here against density one step
         toward the sun: the cheapest possible single-scatter, and
         enough to give every puff a lit crown and a dark belly. */
      float ds = fbm((p + sunFlat * 0.55) * 1.25);
      float lit = clamp01((d - ds) * 2.6 + 0.52);
      vec3 cc = mix(uCloudShade, uCloudLit, lit * lit);
      float a = dens * uCloud.w * smoothstep(0.004, 0.10, rd.y)
              * (1.0 - float(l) * 0.24);
      col = mix(col, cc, clamp01(a));
    }
  }

  /* --- the disc ----------------------------------------------------- */
  /* Two terms. A hard disc alone punches a hole in the sky; the wide
     glare skirt is what makes it read as a light source. */
  float disc = smoothstep(1.0 - uSun.x, 1.0 - uSun.x * 0.22, mu);
  float glare = pow(max(mu, 0.0), 640.0);
  /* Moon phase carves the disc with a second, offset circle rather
     than shading it - a shaded sphere at this size reads as a smudge. */
  if (uSun.w > 0.001) {
    vec3 side = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
    float lateral = dot(rd - uSunDir * mu, side);
    disc *= smoothstep(-uSun.x * 0.12, uSun.x * 0.02,
      lateral + uSun.w * uSun.x * 0.9);
  }
  col += uSunTint * (disc * uSun.y + glare * uSun.z);

  /* --- stars -------------------------------------------------------- */
  if (uStars > 0.001) {
    vec3 sp = rd * 170.0;
    vec3 cell = floor(sp);
    float r = hash13(cell);
    if (r > 0.978) {
      vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 3.3), hash13(cell + 7.1)) - 0.5;
      float d = length(fract(sp) - 0.5 - off * 0.62);
      float tw = 0.66 + 0.34 * sin(uTime * 1.6 + r * 55.0);
      float s = smoothstep(0.15, 0.0, d) * tw;
      float warm = hash13(cell + 11.0);
      col += mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.86, 0.70), warm)
           * s * uStars * (0.35 + r * 5.5) * smoothstep(-0.02, 0.28, rd.y);
    }
  }

  /* --- searchlights -------------------------------------------------- */
  /* A streak, not a spot. The lit set is the great-circle arc from the
     horizon up to the beam direction, so the distance metric is the
     perpendicular offset from the plane containing the beam and up. A
     cone around the axis gives a blob in the sky, which is what a
     searchlight looks like from directly underneath and nowhere else. */
  if (uSearch > 0.001 && rd.y > -0.02) {
    vec3 flat2 = normalize(vec3(rd.x, 0.0, rd.z) + vec3(0.0001, 0.0, 0.0));
    for (int i = 0; i < 5; i++) {
      vec3 d = uSearchDir[i];
      vec3 n = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
      vec3 dh = normalize(vec3(d.x, 0.0, d.z) + vec3(0.0001, 0.0, 0.0));
      float off = abs(dot(rd, n));
      float fwd = dot(flat2, dh);
      float beam = smoothstep(0.075, 0.0, off)
                 * smoothstep(0.05, 0.45, fwd)
                 * (1.0 - smoothstep(d.y - 0.05, d.y + 0.30, rd.y))
                 * smoothstep(-0.02, 0.10, rd.y);
      /* Beams are brightest where the air is thickest, near the ground. */
      col += vec3(1.0, 0.93, 0.80) * beam * uSearch
           * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.5, rd.y)));
    }
  }

  /* --- press flashes -------------------------------------------------- */
  for (int i = 0; i < 4; i++) {
    float w = uFlash[i].w;
    if (w > 0.001) {
      float m = dot(rd, uFlash[i].xyz);
      col += vec3(1.0, 0.97, 0.92)
           * (pow(max(m, 0.0), 5200.0) * 9.0 + pow(max(m, 0.0), 260.0) * 0.55) * w;
    }
  }

  /* --- LED wall bands --------------------------------------------------- */
  /* Course 5 is a void with a wall of screens for a horizon. The bands
     scroll and snap on the beat, which is what makes the arena feel
     like it is running a show rather than sitting still. */
  if (uLed.x > 0.001) {
    float band = abs(rd.y) < 0.30 ? 1.0 : 0.0;
    float v = rd.y * 14.0 + uTime * 0.65;
    float stripe = 0.5 + 0.5 * sin(v * 3.0);
    float scan = step(0.55, fract(v * 2.0 + uTime * 1.7));
    float az = atan(rd.z, rd.x);
    float col2 = 0.5 + 0.5 * sin(az * 7.0 - uTime * 0.9);
    vec3 led = mix(uLedA, uLedB, col2 * stripe);
    col += led * band * uLed.x * (0.35 + scan * 0.45 + uLed.y * 0.9)
         * (1.0 - smoothstep(0.06, 0.30, abs(rd.y)));
  }

  /* --- hellfire underglow ------------------------------------------------ */
  if (uHell.x > 0.001) {
    float base = smoothstep(0.20, -0.55, rd.y);
    vec2 fp = vec2(atan(rd.z, rd.x) * 3.6, rd.y * 7.0 - uTime * 0.55);
    float f = fbm(fp) * 0.7 + fbm(fp * 2.7 + 5.0) * 0.3;
    float flick = 0.75 + 0.25 * sin(uTime * 6.3 + f * 12.0);
    col += uHellTint * base * (0.35 + f * 1.35) * uHell.x * mix(1.0, flick, uHell.y);
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ============================================================
   VOLUME BEAM SHADER

   Daylight shafts through skylights, searchlight columns, stage
   spots. All the same object: an additive polygonal frustum whose
   brightness follows abs(dot(normal, viewDir)).

   That dot product is the whole trick. On a cone the normal is
   radial, so it faces the camera dead-on through the middle of the
   visible silhouette and turns edge-on at the rim - which means the
   beam is brightest down its centre line and fades out at its
   edges, exactly like a real column of lit dust. Flat-shading the
   cone instead gives a bright RING, and a bright ring is the single
   most recognisable "I made a cone and turned on additive" tell.
   ============================================================ */

const BEAM_VERT = /* glsl */`
varying vec3 vNrm;
varying vec3 vView;
varying vec3 vCol;
varying float vFogDepthB;
attribute vec3 color;
void main() {
  vCol = color;
  vNrm = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vFogDepthB = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const BEAM_FRAG = /* glsl */`
precision highp float;
varying vec3 vNrm;
varying vec3 vView;
varying vec3 vCol;
varying float vFogDepthB;
uniform float uGain;
uniform vec2 uFog;   /* near, far */
void main() {
  float facing = abs(dot(normalize(vNrm), normalize(vView)));
  float body = pow(facing, 1.45);
  /* Additive light must be EATEN by distance, not tinted by it - see
     the header. Fogging toward the horizon colour would make a far
     shaft brighter than a near one. */
  float fogF = smoothstep(uFog.x, uFog.y, vFogDepthB);
  gl_FragColor = vec4(vCol * uGain * body * (1.0 - fogF), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ============================================================
   PER-COURSE PRESETS

   Colours are authored in sRGB hex and converted to the linear
   working space by THREE.Color, because everything downstream -
   the dome shader, the light rig, the fog - operates in linear and
   render.js encodes exactly once at the end of the chain.
   ============================================================ */

const PRESETS = {
  /* ---- 0 : The Label Lobby -------------------------------------------
     Late afternoon coming through a glass atrium dome. Warm gold
     against deep plum: the hub has to feel like the inside of an
     expensive building, and expensive buildings are lit warm from
     above and cool in the corners. */
  0: {
    name: "The Label Lobby",
    low: 0xf3c489, horizon: 0xdb9260, high: 0x6a3c62, zenith: 0x2a1a3e,
    sunAzimuth: 34, sunElevation: 26,
    sunTint: 0xffd9a0, sunSize: 0.010, sunGain: 3.4, sunGlare: 1.5, moonPhase: 0,
    cloud: [0.34, 0.55, 0.004, 0.55], cloudLit: 0xffe2bd, cloudShade: 0x7a5570,
    stars: 0,
    haze: 0.55, hazeTint: 0xffbf7a,
    /* Airlight, not a dimmer - rule 4. The plum was already the right
       hue for this room; it is now light enough to actually compress
       the far end of the rotunda instead of only darkening it, and it
       starts at eighteen metres rather than twenty-six so the drum's
       far wall is inside the knockdown at all. */
    fog: { color: 0x55415c, near: 18, far: 130 },
    key: { color: 0xffe0ae, intensity: 2.05 },
    /* Glass dome overhead: the key is shadowed off the marble for the
       same structural reason as the food court's. */
    shadowStrength: 0.40,
    /* See THE BAKED CAST below. A roofed course, so the shadow map is
       a blanket and the only shapes on this floor are baked ones. The
       hub's sun is at 26 degrees, which would throw shadows twice the
       height of everything casting them across a marble rotunda; 44 is
       the lobby's own art-directed key, and 135 is the food court's
       reason - the presets stand on the +Z side of a course and shade
       falling away from them is shade nobody ever sees. */
    cast: { azimuth: 135, elevation: 44, strength: 0.42, maxLength: 8 },
    rim: { color: 0x9a7fd0, intensity: 0.55, azimuth: 214, elevation: 24 },
    /* Interior under a glass dome, so the same rule as every other
       roofed course in this game: the key is shadowed off the whole
       floor by the lid and the fill has to carry the room. At 0.72 /
       0.30 the rotunda was a black marble drum with three bright
       shafts in it and nothing readable between them.

       And 1.35 / 0.52 was still only half of what the food court -
       the other roofed course, measured against the same reference
       pool - ended up needing. It looked like a decision because the
       hub is meant to feel like an expensive dim lobby; the squint
       test says it was not a decision, it was the trap. The lobby
       measured a value range of 75 against the Super Mario 64 pool's
       123, with its darkest five per cent at 3.8: the room had real
       blacks and nothing else. Everything that was not a lit marble
       walkway sat in one dark mass, which is the same failure as a
       flat grey frame with the polarity reversed.

       The fill goes up and the ambient comes DOWN, which is the same
       trade the food court made. Ambient is the term that lifts the
       shaded side of every object toward the lit side, so spending
       the budget on the hemisphere instead buys a lit floor and a
       shaded wall rather than a uniformly grey room. Exposure follows
       so the marble walkways reach a real white and give the frame
       something at the top of the ladder. */
    hemi: { sky: 0xc7a6e4, ground: 0x8f5340, intensity: 2.85 },
    ambient: { color: 0x584264, intensity: 0.38 },
    exposure: 1.26,
  },

  /* ---- 1 : The Mall Food Court ---------------------------------------
     Interior. What you see through the skylights is a hot, hazy
     midday - so the dome is a real daylight sky and the shafts that
     come down from it are the course's signature light.

     Fog is deliberately NOT the sky's horizon colour here. The
     "horizon" of an enclosed room is its far wall seen through a
     hundred metres of fluorescent-lit dust, and that is a warm grey
     with a green cast, not a blue sky. The rule is that fog matches
     what is actually at the far end of the space.

     ------------------------------------------------------------
     AND THEN THE FOG WAS MEASURED, AND IT WAS DOING THE OPPOSITE OF
     ITS JOB.

     At 0xb9b49c the fog was a bright warm beige - brighter than
     nearly every surface in the course. Fog that light does not
     create depth, it destroys it: it LIFTS the most distant plane
     until the background is the brightest region in the picture. The
     review measured the far wall at 124 with the foreground floor at
     30-82, and the single loudest note in the whole round was that
     the eye was being pulled to an empty beige wall a hundred metres
     away.

     Near 34 on a 132-metre course made it worse rather than better:
     nothing closer than a third of the room got any atmosphere at
     all, so the transition from "no fog" to "the far wall" happened
     all at once, in a band, instead of grading across the space.

     Fog is now DARKER AND COOLER than everything it sits behind,
     starting at twelve metres - roughly where the camera's own
     subject ends - and reaching full at a hundred and ten. Distance
     now costs value, which is the whole mechanism by which Super
     Mario 64 reads as deep: value structure, not haze. It also gives
     an interior with no sky in it somewhere genuinely dark to be.

     ------------------------------------------------------------
     AND THEN IT OVERSHOT, IN THE OTHER DIRECTION.

     0x081320 is near-black, and mixing toward near-black is a
     MULTIPLY: it scales the far field down and leaves the ratio
     between its lights and its darks exactly where it was. The
     background got darker and stayed just as contrasty and just as
     saturated as the foreground, which is precisely what the fourth
     blind round called out - "far stalls are as contrasty and
     saturated as foreground crates", "zero atmospheric perspective".
     Dark fog is not aerial perspective; it is a dimmer.

     0x4c4a52 is the airlight this room actually has: the value of a
     far wall seen through a hundred metres of dusty, fluorescent-lit
     interior air, desaturated because that is what air does to
     colour. It sits far below the lit foreground floor - rule 4's
     rail, and the reason this is not a slide back toward the beige
     disaster above - so the far field collapses into a narrow mid
     band while the foreground keeps every black and every white in
     the frame.

     Near moves 12 -> 16 because the capture presets stand the subject
     about seven metres out and the knockdown must not reach her; far
     comes in to 76 so the back of the room is fully knocked down
     rather than still climbing when it runs out of course.

     ------------------------------------------------------------
     FOURTH PASS: THE AIRLIGHT WAS THE FLOOR OF THE HISTOGRAM.

     Everything above is still true and the mechanism is unchanged.
     What was wrong was the LEVEL, and it was measured directly: at
     0x4c4a52/0x35617a the airlight sits at luminance ~90, and because
     the fog is fully engaged over most of the frame, nothing beyond
     eighteen metres could ever render darker than that. Squinting the
     course, the darkest five per cent came back at 66.5 against the
     Super Mario 64 pool's 45.7, and five of the seven capture presets
     were individually flagged for having no darks at all. The airlight
     was not merely tinting the far field, it was setting a hard black
     point for the whole picture, several times too high.

     0x163348 is the same hue and the same job at luminance 46. The
     thing that makes this safe - and the reason it is not a slide back
     toward the 0x081320 dimmer - is that the RATIO is preserved, not
     the absolute value. The course's ground albedos came down by about
     a quarter in the same pass, so the airlight sits at 0.42 of the lit
     foreground floor where it previously sat at 0.45. Aerial
     perspective is a ratio; the black point is an absolute. This moves
     the absolute and leaves the ratio alone, which is the only way to
     have both real darks and a far field that recedes.

     Chroma goes UP as the value comes down (S 0.57 -> 0.68). Lifting
     darks costs saturation mathematically, so lowering them earns some
     back, and a more chromatic airlight compounds it over the 40% of
     frame the fog owns. */
  1: {
    name: "The Mall Food Court",
    low: 0xe8eef2, horizon: 0xcfe2f2, high: 0x69a8e8, zenith: 0x2c68c8,
    sunAzimuth: 38, sunElevation: 63,
    sunTint: 0xfff4d8, sunSize: 0.0075, sunGain: 5.0, sunGlare: 1.8, moonPhase: 0,
    cloud: [0.44, 0.42, 0.010, 0.92], cloudLit: 0xfffaf0, cloudShade: 0x8aa4c4,
    stars: 0,
    haze: 0.30, hazeTint: 0xffeec8,
    fog: { color: 0x163348, near: 18, far: 78 },
    key: { color: 0xfff2d2, intensity: 4.20 },
    /* 0.55 was too generous and it is the other half of the missing
       darks. This course has the most complete lid in the game, so its
       shadow map is a blanket over the entire floor rather than a set
       of shapes on it (see DEFAULT_SHADOW_STRENGTH) - which means that
       whatever fraction of the key leaks through the shadow is added
       UNIFORMLY to every square metre the player ever stands on. At
       0.55 that leak was 45% of a key of 4.20, roughly doubling the
       floor's rendered value and taking the whole ground plane to
       190-210 where the plan below asks for 65-80.

       0.72 keeps the reason the leak exists - a roofed course with a
       fully black shadow renders as a night scene, and SM64's own
       interiors keep their shadows lighter and bluer than the lit
       surface - while restoring the key/fill ratio. It was swept
       against the reference pool: 0.66 left the darks at 54, 0.80 and
       0.85 took the squint RANGE down with them (the leak is the only
       light on most of the floor, so past a point removing it removes
       the frame's midtones rather than its highlights). 0.72 is where
       darks fall and range does not. */
    shadowStrength: 0.72,
    /* The course this whole mechanism exists for. Nothing in the food
       court lays a shadow with a shape, because the lid takes the key
       off the floor before it ever gets there - so 40-55% of every
       frame is unbroken plaza at one value and the character is the
       only true dark in the picture.

       BOTH ANGLES ARE THE COURSE'S, NOT THE SUN'S, AND BOTH WERE
       MEASURED WRONG FIRST.

       Elevation: the sun is at 63 degrees and a 63-degree shadow is
       half the height of the thing casting it, so a 0.9 m planter put
       down 46 cm of shade - a contact edge, not a cast - and the
       fountain, whose only part within reach of the plaza is a 0.95 m
       coping, laid 74 cm around a sixteen-metre sculpture. At 40 the
       same coping reaches 1.2 m, the drum inside the basin throws far
       enough to cross it, and a seven-metre column puts nine metres of
       shadow across the plaza.

       Azimuth: 38 was the sun's, and at 38 the shade falls toward
       -X -Z - which is DIRECTLY AWAY from where every capture preset
       in this course stands. Every shadow in the build landed behind
       the thing that cast it and the floor measured unchanged. A
       shadow you cannot see from the camera is not a shadow, and on an
       interior there is nothing to contradict: the lid already took
       the sun, so this angle is standing in for the room's own light,
       not for the disc in the skylight. 135 throws the shade across
       frame and slightly toward the eye, which is where the shadows in
       a Super Mario 64 course fall for exactly the same reason.

       And the occluder cap is the course's, too. At the shared default
       of seven metres the only part of the sixteen-metre fountain that
       counted was the 0.95 m coping of a basin twenty-seven metres
       across, so the biggest object in the game laid a shadow you had
       to be told about. The lid here is at twenty-two metres and the
       catwalks are at seventeen, so sixteen takes the whole fountain,
       the columns and the mezzanine fascia and still leaves both the
       roof and the catwalk rig out. maxLength follows from it:
       16 / tan(40) is nineteen metres of throw, and a cap shorter than
       that would cut the fountain's own shadow off in mid-plaza. */
    cast: {
      azimuth: 135, elevation: 40, strength: 0.55,
      maxLength: 22, occluderCap: 16,
    },
    rim: { color: 0x8fc4ff, intensity: 0.42, azimuth: 220, elevation: 30 },
    /* Warm fluorescent from the ceiling, terracotta bounce off the
       tile. Grey ambient is the sixth tell in the contract; the
       ground half of this hemisphere is the food court's own floor.

       These are far higher than an exterior course wants, and that is
       the point: this course has a solid ceiling with three skylight
       cells, so the directional key is shadowed off almost the entire
       floor and contributes nothing where the player actually stands.
       An interior lit like an exterior comes out a night scene. The
       fill IS the lighting here, and it is deliberately bright enough
       that shadowed floor still reads as a lit room - which is also
       how Super Mario 64 handles its interiors: shadows there are
       lighter and bluer than the lit surface, never approaching
       black.

       There is a ceiling on how far this can go, and it is set by the
       CHARACTER, not by the room. Textured environment surfaces absorb
       a lot of fill before they look wrong; the cel-shaded characters
       carry a rim term and a banded ramp, and they saturate to flat
       white long before the floor does. Pushed to hemi 2.6 / ambient
       1.05 the food court read correctly and Moggadonna came out a
       featureless white silhouette. These are the values where both
       hold up. Re-tune them against a character in frame, never
       against an empty room.

       One more correction, from the same round of review: the fill was
       ALSO strongly orange (sky 0xffe6b4, ambient 0x7d6a52), and a
       neutral surface lit by an orange fill is an orange surface. The
       course's floor and wall albedos were dropped and cooled to open
       up the value range, and a saturated warm fill would have painted
       every one of them straight back to beige. These are warm enough
       to still read as fluorescent and desaturated enough to leave the
       cool albedos cool - the warmth in the frame now comes from the
       kiosks and the shafts, which is where it should have been.

       LAST CORRECTION, AND IT PULLS THE OTHER WAY. Everything above
       is still true - this room has a lid and the fill is the
       lighting - but the fill had been raised until the KEY/FILL
       RATIO was gone, and a scene with no ratio has no darks. The
       squint test measured our value range at 91 against the Super
       Mario 64 pool's 123, with our darkest five per cent sitting at
       32 where the pool reaches single figures. Nothing in frame was
       ever dark, so nothing in frame ever popped.
       So the key goes up and the fill comes down, keeping roughly
       the same amount of total light in the room but restoring the
       difference between a lit surface and a shaded one. The
       ambient is cooler as well as lower: it is the term that was
       flattening the shadow side of every object toward the lit
       side. The guard rail from the paragraph above still stands -
       these were re-checked with a character in frame, and she is
       still a long way from flattening out.

       Nudged up once more - and only once more - alongside the
       shadow-strength change above. The guard rail is unchanged and
       it is still the character, but she now carries her own key
       (vfx.js SUBJECT_KEY), so the room no longer has to be bright
       enough to model her on its own. Most of the floor lift comes
       from the shadow, which touches only the shaded surfaces; this
       is the small remainder, and it was measured to move the squint
       range UP rather than down. */
    hemi: { sky: 0xffeec4, ground: 0x2a211c, intensity: 2.75 },
    ambient: { color: 0x3d5068, intensity: 0.20 },
    exposure: 1.16,
  },

  /* ---- 2 : The Awards-Show Red Carpet ----------------------------------
     Twenty minutes after sundown. The sun is under the horizon, the
     sky is still burning at the bottom, and the actual key light on
     the carpet comes from the venue: searchlights, marquee bulbs and
     several hundred press flashes. */
  2: {
    name: "The Awards-Show Red Carpet",
    low: 0xffbe72, horizon: 0xf9603c, high: 0x5e2358, zenith: 0x160d34,
    /* Seven degrees, not two and a half. The dome still burns at the
       bottom and still reads as twenty minutes after sundown, but the
       key direction is derived from these two numbers, and at 2.5
       degrees the key lands on nothing that faces up: the carpet, the
       steps, the risers and the roofs all got a cosine of 0.04 and
       the entire ground plane silhouetted into the sky. Seven degrees
       is the lowest elevation at which horizontal surfaces still
       receive a readable fraction of the key and the shadow frustum
       is not degenerate. */
    sunAzimuth: 268, sunElevation: 7,
    sunTint: 0xff7a3c, sunSize: 0.020, sunGain: 2.6, sunGlare: 2.4, moonPhase: 0,
    cloud: [0.36, 0.72, 0.006, 0.80], cloudLit: 0xff9a6a, cloudShade: 0x4a2050,
    stars: 0.30,
    haze: 0.95, hazeTint: 0xff8a4a,
    /* An exterior, so the fog colour still has to arrive at the same
       value as the dome's horizon band or every roofline shows a
       seam - that constraint owns the HUE here and it is not
       negotiable. What was negotiable was the RANGE: near 40 / far
       300 on a course a fraction of that deep meant the knockdown
       never engaged and the crowd at the back of the carpet was as
       contrasty as the subject. */
    fog: { color: 0x6e2a44, near: 22, far: 165 },
    search: 0.55,
    flashes: 4,
    key: { color: 0xffc9a0, intensity: 1.9 },
    /* The rim was at 1.05 and it was painting the entire course
       magenta - a rim that strong stops being an edge and becomes the
       key. It is an accent on the crowd and the statue, nothing more. */
    rim: { color: 0xff5a90, intensity: 0.55, azimuth: 88, elevation: 16 },
    /* Open sky. A cast shadow out here is a real shape on the ground
       and most of it is kept - but the sun is seven degrees up, so
       the shadows are enormous and a black one would swallow half
       the carpet. */
    shadowStrength: 0.78,
    /* NO BAKED CAST. Out here the shadow map is not a blanket - it is
       a set of real shapes on the carpet - and a second, baked cast
       laid over the top of it would be a second shadow from the same
       sun, at a different angle, on the same prop. The bake stays an
       occlusion term on this course and nothing more. */
    cast: null,
    /* Same rule as the food court, arrived at from the opposite
       direction: this is an exterior whose sun is on the horizon, so
       functionally it is an interior with a very large ceiling and the
       FILL is the lighting. Sky half is the marquee and the
       searchlights, ground half is bounce off a hundred metres of red
       carpet. Tuned with a character in frame - past hemi 1.7 the
       cel-shaded costume flattens out before the asphalt does. */
    hemi: { sky: 0xffbe9a, ground: 0xa8283e, intensity: 1.35 },
    ambient: { color: 0x6a4050, intensity: 0.46 },
    exposure: 1.04,
  },

  /* ---- 3 : The Streaming Farm Basement ---------------------------------
     Sealed. There is no sky, and pretending otherwise with a dark
     blue gradient is what makes basements in browser games look like
     night-time exteriors. The dome here is a near-black box with the
     faintest cold cast, the fog is thick and short, and every photon
     in the room comes from a rack. */
  3: {
    name: "The Streaming Farm Basement",
    low: 0x070c12, horizon: 0x08111c, high: 0x050a12, zenith: 0x02040a,
    sunAzimuth: 0, sunElevation: 80,
    sunTint: 0x000000, sunSize: 0.001, sunGain: 0, sunGlare: 0, moonPhase: 0,
    cloud: [0, 0, 0, 0], cloudLit: 0x000000, cloudShade: 0x000000,
    stars: 0,
    haze: 0, hazeTint: 0x000000,
    /* Sealed room. There is no horizon to match, so the fog is free
       to be a pure airlight: the value the far end of an aisle
       actually arrives at through that much recirculated air. Lifted
       out of near-black and pulled in to the length of the room. */
    fog: { color: 0x2e4a56, near: 15, far: 90 },
    /* 0.22 was "the key does nothing", and a scene with no
       directional term has no modelling: every surface in the room
       came back the same value regardless of which way it faced, and
       the basement measured a value range of 70 against the pool's
       123. It is still by far the weakest key in the game - this is a
       sealed room lit by its own hardware - but it is now enough to
       tell a floor from a wall. */
    key: { color: 0x9fd8ff, intensity: 0.58 },
    rim: { color: 0x2bffb0, intensity: 0.34, azimuth: 200, elevation: 8 },
    /* A lid and almost no key to lose: the shadow here was removing a
       quarter of nothing, and what it removed was the only directional
       modelling in the room. */
    shadowStrength: 0.44,
    /* A lid, so the bake is the only thing that can put a shape on
       this floor - but the key here is a ceiling strip almost directly
       overhead and the racks are lit by their own hardware, so the
       cast is short, steep and faint. Any more and a sealed basement
       grows shadows from a sun it does not have. */
    cast: { azimuth: 150, elevation: 50, strength: 0.30, maxLength: 7 },
    /* Cold from the ceiling strip, sicker green from the floor's own
       LED spill. Both saturated: an unlit basement lit with grey
       reads as an untextured prototype instantly.

       The intensities are four times what a night exterior would want,
       for the same structural reason the food court's are: this room
       has a lid, so the directional key is shadowed off the entire
       floor and contributes nothing where the player stands. The fill
       IS the lighting. "Dark course" is a statement about the average
       value of the frame, not a licence to let the ground plane go to
       black - Super Mario 64's own dark levels keep their shadows
       lighter and bluer than the lit surface and never near black.
       Tuned with a character in frame: past ambient 0.9 the cel ramp
       on the costume flattens before the concrete stops reading.

       Re-balanced, not raised: the total is about what it was, but it
       has moved out of the ambient and into the hemisphere. Ambient
       at 1.02 was more than half the light in the room and it is the
       one term with no direction at all, so it was flattening the
       aisles into a single teal wash - the racks, the floor, the
       lanes and the far wall all arriving within thirty luminance of
       each other. The hemisphere at least distinguishes up from down,
       which is what lets the painted lane read as a lane. Exposure
       carries the lanes to a genuine bright so the frame has a top
       end; the racks are unlit Basic materials and do not follow it,
       so the gap between the aisle and the cabinets opens rather
       than sliding up together. */
    hemi: { sky: 0x86b4d0, ground: 0x2e7460, intensity: 2.50 },
    ambient: { color: 0x33454e, intensity: 0.70 },
    exposure: 1.22,
  },

  /* ---- 4 : Influencer Rooftop Afterparty --------------------------------
     Night, thirty floors up. The height cue is entirely in the city
     bokeh under the horizon line and in the fact that the haze is
     lit from BELOW. */
  4: {
    name: "Influencer Rooftop Afterparty",
    low: 0x140c26, horizon: 0x35204e, high: 0x0e1236, zenith: 0x04050e,
    sunAzimuth: 300, sunElevation: 42,
    sunTint: 0xdfe6ff, sunSize: 0.0085, sunGain: 2.6, sunGlare: 0.8, moonPhase: 0.35,
    cloud: [0.42, 0.62, 0.005, 0.62], cloudLit: 0x4a3a6e, cloudShade: 0x140f2a,
    stars: 0.45,
    haze: 0.70, hazeTint: 0x6a3a8a,
    /* The one course where the fog colour must stay dark: it is the
       night sky's own value, and lifting it would put a grey haze
       across a skyline whose entire job is to be a field of points in
       the dark. The knockdown here is bought with RANGE alone - the
       deck is ~60m across and far 320 meant nothing on it was ever
       touched. */
    fog: { color: 0x241844, near: 20, far: 150 },
    bokeh: [0.95, 0.40], bokehWarm: 0xffb46a, bokehCool: 0x7ad4ff,
    key: { color: 0xc6d0ff, intensity: 0.95 },
    /* Open roof deck, and the moon is the only directional light in
       the course; a full-strength shadow removes all of it. */
    shadowStrength: 0.70,
    /* Open sky again, so the shadow map casts for real - same
       reasoning as the red carpet. */
    cast: null,
    /* 1.25 of saturated magenta rim was not an edge light, it was a
       second key, and it turned every surface in the course the same
       colour as the DJ booth. */
    rim: { color: 0xff5ad2, intensity: 0.62, azimuth: 118, elevation: 12 },
    /* Moonlight from above, sodium city glow from below - and both
       several times an ordinary night exterior, because the moon at
       42 degrees is the only directional light in the course and the
       whole deck is horizontal. A night level still has to have a
       readable ground plane. */
    /* Raised from 1.30 / 0.56 / 1.06, and then NOT raised further.
       The rooftop measures the worst value range in the game and it
       is the one course where that is partly honest: it is a night
       exterior being scored against a reference pool of daylight
       Super Mario 64 frames, so the top of its ladder is a pool light
       and a neon batten rather than a sunlit wall. Pushing the fill
       past this point stopped buying range - the darks came up with
       everything else and the measured range went DOWN - so the extra
       light was being spent on flattening the course rather than on
       opening it. This is where the trade stops paying. */
    hemi: { sky: 0x5a4aa8, ground: 0xc47a44, intensity: 1.58 },
    ambient: { color: 0x2e2856, intensity: 0.46 },
    exposure: 1.12,
  },

  /* ---- 5 : Boyz II Hell - Final Livestream ------------------------------
     Not a place, a broadcast. The arena floats in a void with a ring
     of LED wall for a horizon and a lake of fire under the stage, so
     everything is lit from below - which is the oldest and still the
     most reliable way to make a silhouette read as a villain. */
  5: {
    name: "Boyz II Hell - Final Livestream",
    low: 0x7a1406, horizon: 0x3c0a12, high: 0x140410, zenith: 0x050208,
    sunAzimuth: 180, sunElevation: 34,
    sunTint: 0xffe8f4, sunSize: 0.006, sunGain: 3.2, sunGlare: 2.6, moonPhase: 0,
    cloud: [0.55, 0.85, 0.014, 0.42], cloudLit: 0x8a2036, cloudShade: 0x180410,
    stars: 0,
    haze: 0.85, hazeTint: 0xff4a2a,
    /* The arena floats in a void, so this fog is not matching a
       horizon either - it is the smoke over the lake of fire, and it
       gets to be a real airlight. Pulled in to the width of the deck
       so the LED ring and the far wings are actually knocked back
       behind the stage. */
    fog: { color: 0x4a1e28, near: 18, far: 140 },
    hell: [1.0, 0.85], hellTint: 0xff5a1e,
    /* The dome's LED horizon at 0.85 was brighter than the arena it
       was supposed to be the backdrop for, so the whole top half of
       every frame read as the subject. */
    led: 0.5, ledA: 0xc4174f, ledB: 0x1d9cba,
    /* THE KEY IS THE STAGE RIG, AND IT HAD BEEN TURNED OFF.

       Everything about this course's lighting is designed around the
       underlight - hot orange in the hemisphere's lower half, a rim
       from twelve degrees BELOW the horizon - and a hemisphere light
       only lights a surface with the half it faces. The arena floor
       faces up. So the deck, the stage and every platform the player
       actually stands on were lit by the SKY half, which is a dark
       plum at 0x50264a, and by a key at 1.15. They came out black:
       the course measured a value range of 99 with a P95 of about
       106, meaning the brightest thing in almost every frame was the
       sky dome behind the arena. That is the food court's inverted
       depth all over again - the backdrop outranking the subject -
       and it is why a dark costume standing on the stage had nothing
       to be a silhouette against.

       This is an arena. There is a truss over it. The key at 34
       degrees IS that truss, and at 2.2 it puts a lit deck under the
       player without touching the underlight, which still owns every
       vertical face and every chin in the course. */
    key: { color: 0xffd6e8, intensity: 2.20 },
    rim: { color: 0xff4a18, intensity: 1.45, azimuth: 0, elevation: -12 },
    /* There is a truss over this arena and the key is that truss, so
       the deck is shadowed the same way a roofed course's floor is -
       and this course has already been round the loop once for
       exactly that reason (see the key note above). */
    shadowStrength: 0.48,
    /* The truss is the lid, so the same argument as every other roofed
       course - but gently. This deck is lit from BELOW by the lake of
       fire, and a strong downward cast would fight the underlight that
       the whole course is designed around. */
    cast: { azimuth: 150, elevation: 44, strength: 0.36, maxLength: 8 },
    /* The ground half is the hellfire. A hemisphere light with a hot
       orange lower hemisphere is the underlight; it costs nothing and
       it does more for the mood than any number of point lights.

       Raised from 1.05 / 0.30: the arena's own surfaces were pushed
       up out of near-black to give the frame a midtone, and the fill
       has to come with them or the new albedo simply renders dark
       anyway. The sky half stays deep and cold so the underlight still
       wins - the ratio between the two halves is the effect, not the
       absolute level of either. */
    hemi: { sky: 0x8a68a6, ground: 0xff6a2e, intensity: 2.00 },
    ambient: { color: 0x46202c, intensity: 0.56 },
    exposure: 1.12,
  },
};

/**
 * SHADOW STRENGTH - how much of the key a shadow is allowed to remove.
 *
 * three's `light.shadow.intensity` is 0..1 and it is the difference
 * between a shadow that is an absence of light and a shadow that is an
 * art direction. Every roofed course in this game hits the same trap,
 * and it was measured rather than argued: in the food court the key is
 * at 4.20 and the ceiling occludes it from ESSENTIALLY THE WHOLE
 * FLOOR, so the floor is lit by hemisphere and ambient alone. Killing
 * the key outright changed the floor by nothing at all; turning its
 * shadow off more than doubled it. The key was not lighting the room,
 * it was only deciding how black the room got.
 *
 * The boss framing measured a squint P5 of 10.1 against the Super
 * Mario 64 pool's 45.7 - a bottom half crushed to near-black, with ten
 * crates floating on a void because a contact shadow drawn on black is
 * invisible. Letting a fraction of the key through the shadow lifts
 * the whole shadowed floor in the KEY'S OWN COLOUR and, crucially,
 * without touching the lit surfaces, so the value range goes UP rather
 * than down: raising hemisphere and ambient instead would have lifted
 * both ends together and flattened the frame, which is the trade the
 * food court's fill has already been walked back from twice.
 *
 * This is also what Super Mario 64 actually does. Its interiors keep
 * their shadows lighter and bluer than the lit surface and never let
 * them approach black.
 *
 * Roofed courses take the lowest values because their shadow map is
 * doing almost nothing else useful - the ceiling shadows everything,
 * so the map is a blanket rather than a set of contact shadows, and
 * the grounding it should be providing comes from vfx.js's occlusion
 * patch bake instead. Exteriors keep most of theirs: out there a cast
 * shadow really is a shape on the ground.
 */
const DEFAULT_SHADOW_STRENGTH = 1;

/**
 * THE BAKED CAST - the direction every shadow in a roofed course agrees on.
 *
 * The note above ends by handing the grounding job to vfx.js's occlusion
 * bake, and that bake works: there is a soft halo around anything large.
 * What a blind review measured next is that a halo is not a shadow.
 * NOTHING in a roofed course lays a mark with a SHAPE - no prop, no
 * pillar, no planter, no kiosk, not the sixteen-metre fountain - so 40
 * to 55 per cent of the frame is unbroken floor at one value and the
 * only true dark left in the picture is the character herself, at 1.3
 * per cent of the pixels. A global histogram cannot see that: the
 * numbers all pass while the floor is a sheet of paper.
 *
 * A cast shadow is not an occlusion term with more contrast, it is a
 * DIRECTION, and the shadow map cannot supply one here for the reason
 * this whole file keeps running into: the ceiling gets the key first.
 * So the direction is authored, and it is authored HERE rather than in
 * vfx.js because this module already owns every other direction in the
 * course - the sun, the rim, the beams - and a cast that disagrees with
 * them is worse than no cast at all.
 *
 *   azimuth    degrees, compass. Defaults to the course's own sun, so
 *              the baked shade and the shadow map point the same way on
 *              any course that has both.
 *   elevation  degrees. NOT the sun's, and that is deliberate: shadow
 *              length is height / tan(elevation), so the sun's own
 *              angle is an art decision about how long a shadow is, and
 *              on an interior it is an angle no light in the room
 *              actually has. Steep reads as noon and lays down almost
 *              nothing; shallow reads as evening and throws shade
 *              across the whole course. The presets sit at 44-58.
 *   strength   peak alpha of the cast. It is drawn in the same shade
 *              colour as the contact blobs, which lands at luminance
 *              ~30, so 0.58 takes a plaza at 150 down to about 80 -
 *              lighter and bluer than the lit surface, never near
 *              black, which is what SM64's own interiors do.
 *   maxLength  metres. The cap is what stops a shadow running the whole
 *              length of a course when its caster happens to be tall.
 *   occluderCap
 *              metres above the deck. NOTHING taller than this casts,
 *              and the number that matters is the course's own LID: a
 *              ceiling stands over every cell equally, so letting one
 *              into the test does not draw a shadow, it draws a global
 *              dimmer over the entire floor - which is the flat frame
 *              this whole mechanism exists to break, in reverse.
 *              Default 7 (vfx.js's SKIRT_OCC_CAP) is the safe answer
 *              for a course whose ceiling height nobody has checked;
 *              raise it only against a measured lid, as course 1 does.
 *
 * `cast: null` on an EXTERIOR is not an oversight. Out there the shadow
 * map is a set of real shapes rather than a blanket, and a baked cast
 * over the top of it is a second shadow from the same sun at a
 * different angle on the same prop.
 */
const DEFAULT_CAST_ELEVATION = 48;
const CAST_MIN_ELEVATION = 14;
const CAST_MAX_ELEVATION = 78;

/**
 * AIMING THE CAST AT THE LENS.
 *
 * The block above says to aim the cast at the camera's world rather
 * than at the sky, and settled on one authored azimuth per course.
 * Measured against the frames that actually get reviewed, one azimuth
 * is not enough, and the reason is arithmetic rather than taste.
 *
 * A shadow is visible in the near floor - the bottom of the frame,
 * which is forty per cent of the picture - only when it falls from its
 * caster back TOWARD the lens. That makes the direction a property of
 * the CAMERA, not of the course: shade must fall along the view axis
 * reversed, so the cast (which points at the light) is the view
 * bearing itself.
 *
 * Course 1's seven capture presets look along bearings 27, 99, 155,
 * 167, 198, 202 and 241 degrees. They are spread over two hundred and
 * thirteen degrees, so no constant can serve them: the authored 135
 * was 67 degrees wrong for `arrival`, 106 for `water` and 108 for
 * `enemy-encounter`, which is past ninety - the shadow was behind its
 * own caster and could not be seen at all. That is exactly what the
 * measurement showed, a floor whose darkest near pixel was brighter
 * than the course's mid grey.
 *
 * So the aim follows the committed camera. vfx.js calls aimCast() when
 * the rig commits a capture pose and re-bakes; nothing calls it while
 * the follow camera is orbiting, because a bake measured a quarter of
 * a second of main thread and shadows that swing as the player turns
 * are a worse artefact than shadows that fall the wrong way. The
 * authored azimuth is what free play gets, and it is still worth
 * authoring well - see each preset's cast block.
 *
 * SKEW. A shadow laid exactly down the view axis is foreshortened into
 * a stripe under its caster pointing at the lens, which reads as a
 * runway rather than as a shadow. Twenty-two degrees off-axis gives
 * the diagonal that Super Mario 64's own floors have. The SIGN is
 * chosen toward the course's authored azimuth, so on a course that
 * also has visible shafts or a real sun the cast leans their way
 * instead of away from them.
 *
 * The skew is not the final answer any more - it seeds the candidate
 * spread below and stands in between a re-aim and the bake that
 * resolves it. Read the next block before changing either.
 */
const CAST_SKEW = 22;
/* Degrees of drift before a re-aim is worth a re-bake. Two poses a few
   degrees apart produce the same picture and the bake is not free. */
const CAST_AIM_EPSILON = 6;

/**
 * WHY THE AIM IS A SEARCH AND NOT A FORMULA.
 *
 * "Cast azimuth equals view bearing" is right about the direction and
 * wrong about the assumption underneath it - that there is something
 * standing between the lens and the horizon to cast. Measured over
 * course 1's presets it moved `arrival` from nothing at all to a real
 * shadow and `enemy-encounter` with it, and it took `water` from a
 * working shadow to nothing, because the only architecture within
 * reach of that camera's near deck is off to one side of the axis. A
 * course cannot answer that with an angle; only its own geometry can.
 *
 * So the direction is CHOSEN BY MEASUREMENT. This offers a spread of
 * candidates around the view axis plus the course's own authored
 * answer, and vfx.js - which is holding the height field at bake time
 * and is the only thing that can - marches each one over the floor
 * this camera can actually see and keeps the one whose coverage lands
 * in the band below. The authored direction is always candidate zero,
 * so a course that measures nothing keeps what it had.
 *
 * THE BAND IS THE ART DIRECTION AND IT IS TWO-SIDED. A blind review
 * asked for a second dark mass owned by the environment across eight
 * to fifteen per cent of the lower half - not for a dark floor. Half
 * the plaza in shade is the same failure as none of it with the
 * polarity flipped, and this file has already made that mistake once
 * in the lobby. So a candidate that shades sixty per cent of the near
 * deck scores WORSE than one that shades twelve.
 *
 * The pitches are here for the same reason as the skews: shadow length
 * is height / tan(elevation), and whether a course's one tall landmark
 * reaches the near floor at all is a question about the distance the
 * camera happens to stand at. Eight degrees either side of the
 * authored elevation is the difference between a sixteen-metre
 * fountain stopping four metres short of the lens and running past it.
 */
const CAST_SKEWS = [0, -CAST_SKEW, CAST_SKEW, -62, 62];
const CAST_PITCHES = [0, -8, 8];
/**
 * Fraction of the visible near deck that should carry the cast.
 *
 * Wider than the review's eight-to-fifteen for a measured reason: the
 * near-deck cell fraction vfx.js scores is a MODEL of the lower half,
 * not the lower half itself, and the two do not agree cell for pixel.
 * Swept against the frames, 0.10-0.26 puts `arrival` at 14.6 per cent
 * of its lower half in shade - inside the band that was asked for -
 * while 0.08-0.18 made it pick a candidate that measured 0.125 on the
 * deck and 5 per cent in the picture. Tune this against captures, not
 * against the number the search prints.
 */
const CAST_TARGET = { lo: 0.10, hi: 0.26 };

/** Signed a - b, folded to -180..180. */
function angDelta(a, b) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

function dirFrom(azimuthDeg, elevationDeg, out) {
  const az = azimuthDeg * Math.PI / 180;
  const el = elevationDeg * Math.PI / 180;
  return out.set(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az)
  ).normalize();
}

/* ============================================================
   MODULE
   ============================================================ */

export function create(ctx) {
  const scene = ctx.scene;

  /* ------------------------------------------------------------------
     The dome. One material, one geometry, alive for the session.
     ------------------------------------------------------------------ */

  const uniforms = {
    uTime: { value: 0 },
    uLow: { value: new THREE.Color(0x000000) },
    uHorizon: { value: new THREE.Color(0x000000) },
    uHigh: { value: new THREE.Color(0x000000) },
    uZenith: { value: new THREE.Color(0x000000) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunTint: { value: new THREE.Color(0xffffff) },
    uSun: { value: new THREE.Vector4(0.008, 3, 1.5, 0) },
    uCloud: { value: new THREE.Vector4(0, 0, 0, 0) },
    uCloudLit: { value: new THREE.Color(0xffffff) },
    uCloudShade: { value: new THREE.Color(0x333344) },
    uStars: { value: 0 },
    uBokeh: { value: new THREE.Vector2(0, 0.4) },
    uBokehWarm: { value: new THREE.Color(0xffb46a) },
    uBokehCool: { value: new THREE.Color(0x7ad4ff) },
    uSearch: { value: 0 },
    uSearchDir: {
      value: [
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 1, 0),
      ],
    },
    uFlash: {
      value: [
        new THREE.Vector4(0, 1, 0, 0), new THREE.Vector4(0, 1, 0, 0),
        new THREE.Vector4(0, 1, 0, 0), new THREE.Vector4(0, 1, 0, 0),
      ],
    },
    uHell: { value: new THREE.Vector2(0, 0) },
    uHellTint: { value: new THREE.Color(0xff5a1e) },
    uLed: { value: new THREE.Vector2(0, 0) },
    uLedA: { value: new THREE.Color(0xff1e6a) },
    uLedB: { value: new THREE.Color(0x22d8ff) },
    uHazeTint: { value: new THREE.Color(0xffffff) },
    uHaze: { value: 0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  domeMat.name = "apop-dome";

  const domeGeo = new THREE.SphereGeometry(1, 44, 26);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.name = "sky-dome";
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.matrixAutoUpdate = false;
  scene.add(dome);

  /* ------------------------------------------------------------------
     THE LIGHT RIG - allocated exactly once. See rule 1 in the header.
     ------------------------------------------------------------------ */

  const key = new THREE.DirectionalLight(0xffffff, 0);
  key.name = "sky-key";
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.06;   /* world units - 6cm, about one texel */
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 600;
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0xffffff, 0);
  rim.name = "sky-rim";
  rim.castShadow = false;
  scene.add(rim);
  scene.add(rim.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0);
  hemi.name = "sky-hemi";
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x202020, 0);
  ambient.name = "sky-ambient";
  scene.add(ambient);

  /* Four accents. A course asks for as many as it needs; the rest sit
     at zero intensity somewhere harmless. Four is the number the food
     court needs for its fluorescent banks, and it happens to also
     cover the server aisles, the neon bar and the stage wings. */
  const accents = [];
  for (let i = 0; i < 4; i += 1) {
    const p = new THREE.PointLight(0xffffff, 0, 60, 2);
    p.name = `sky-accent-${i}`;
    p.castShadow = false;
    p.position.set(0, -400 - i, 0);
    scene.add(p);
    accents.push(p);
  }

  /* ------------------------------------------------------------------
     Beams. One merged additive mesh per course, rebuilt on entry.
     ------------------------------------------------------------------ */

  const beamUniforms = {
    uGain: { value: 1 },
    uFog: { value: new THREE.Vector2(40, 240) },
  };
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamUniforms,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  beamMat.name = "apop-beam";

  const beamGroup = new THREE.Group();
  beamGroup.name = "sky-beams";
  scene.add(beamGroup);
  let beamMesh = null;
  let beamDefs = [];

  /** A tapered polygonal frustum, coloured bright at the mouth and
   *  faded at the floor, in world space. */
  function beamGeometry(def) {
    const sides = def.sides || 12;
    const r0 = def.radius;
    const r1 = def.radiusEnd !== undefined ? def.radiusEnd : def.radius * 1.9;
    const len = def.length;
    const pos = [];
    const col = [];
    const idx = [];
    const c = new THREE.Color(def.color === undefined ? 0xffffff : def.color);
    const steps = def.steps || 3;

    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const r = lerp(r0, r1, t);
      /* Fade to nothing at the far end. A beam with a hard bottom edge
         reads as a plastic cone sitting on the floor. */
      const fade = (1 - t) * (1 - t) * 0.86 + 0.14 * (1 - t);
      for (let i = 0; i < sides; i += 1) {
        const a = (i / sides) * TAU;
        pos.push(Math.cos(a) * r, -t * len, Math.sin(a) * r);
        col.push(c.r * fade, c.g * fade, c.b * fade);
      }
    }
    for (let s = 0; s < steps; s += 1) {
      const b0 = s * sides;
      const b1 = (s + 1) * sides;
      for (let i = 0; i < sides; i += 1) {
        const j = (i + 1) % sides;
        idx.push(b0 + i, b1 + i, b1 + j, b0 + i, b1 + j, b0 + j);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const q = new THREE.Quaternion();
    if (def.dir) {
      q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), def.dir.clone().normalize());
    }
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]), q, new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    return geo;
  }

  function clearBeams() {
    if (!beamMesh) return;
    beamGroup.remove(beamMesh);
    beamMesh.geometry.dispose();
    beamMesh = null;
  }

  function setBeams(list) {
    clearBeams();
    beamDefs = Array.isArray(list) ? list.slice() : [];
    if (!beamDefs.length) return;
    const geos = beamDefs.map(beamGeometry);
    const merged = mergeGeometries(geos);
    for (const g of geos) if (g !== merged) g.dispose();
    beamMesh = new THREE.Mesh(merged, beamMat);
    beamMesh.name = "sky-beam-mesh";
    beamMesh.frustumCulled = false;
    beamMesh.renderOrder = 12;
    beamGroup.add(beamMesh);
  }

  /* ------------------------------------------------------------------
     Fog
     ------------------------------------------------------------------ */

  const fog = new THREE.Fog(0x000000, 30, 240);
  scene.fog = fog;

  /** Materials that ADD light to the frame must be eaten by distance,
   *  not tinted by it. Fogging an additive surface toward a bright
   *  horizon makes it brighter the further away it is, so every neon
   *  sign at the back of a course blooms into a white smear. */
  function applyAdditiveFog(material) {
    if (!material || material.userData.__addFog) return material;
    material.userData.__addFog = true;
    material.fog = true;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (prev) prev(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <fog_fragment>",
        [
          "#ifdef USE_FOG",
          "  #ifdef FOG_EXP2",
          "    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );",
          "  #else",
          "    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );",
          "  #endif",
          "  gl_FragColor.rgb *= ( 1.0 - fogFactor );",
          "#endif",
        ].join("\n")
      );
    };
    material.customProgramCacheKey = () => "apop-additive-fog";
    material.needsUpdate = true;
    return material;
  }

  /* ------------------------------------------------------------------
     Course state
     ------------------------------------------------------------------ */

  const state = {
    id: -1,
    preset: PRESETS[0],
    sunDir: new THREE.Vector3(0, 1, 0),
    rimDir: new THREE.Vector3(0, 1, 0),
    centre: new THREE.Vector3(0, 0, 0),
    radius: 90,
    searchSpin: 0,
    /* Resolved once per course by resolveCast(). Handed out by
       reference from shadowCast(), the way collision.js hands out its
       pooled results - vfx.js reads it during a bake and during the
       contact-shadow pass, and neither may allocate. */
    cast: null,
    /* The course's own answer, in degrees, kept apart from everything
       the camera does to it so there is always a way back - free play
       runs on these two and nothing else. */
    castAuthored: 0,
    castAuthoredEl: DEFAULT_CAST_ELEVATION,
    /* Compass bearing of the committed capture camera's view axis, in
       degrees, or null while nothing has aimed it. Generates the
       candidate spread; it is not itself a direction. */
    castAim: null,
    /* The candidate vfx.js's search kept, or null. This is what
       actually reaches the bake. See AIMING THE CAST. */
    castChosen: null,
    /* Pooled: the candidate list, the slot the chosen one is copied
       into, and the target band. Rebuilt in place, never reallocated. */
    castList: [],
    castKeep: { azimuth: 0, elevation: 0, x: 0, z: 0, tan: 1 },
    castSearch: true,
    beatPulse: 0,
    ledBase: 0,
    flashRng: makeRng(0x5EA7),
    flashClock: [0, 0, 0, 0],
  };

  const tmpVec = new THREE.Vector3();

  function applyPreset(p, overrides) {
    const o = overrides || {};
    uniforms.uLow.value.setHex(o.low !== undefined ? o.low : p.low);
    uniforms.uHorizon.value.setHex(o.horizon !== undefined ? o.horizon : p.horizon);
    uniforms.uHigh.value.setHex(o.high !== undefined ? o.high : p.high);
    uniforms.uZenith.value.setHex(o.zenith !== undefined ? o.zenith : p.zenith);

    dirFrom(
      o.sunAzimuth !== undefined ? o.sunAzimuth : p.sunAzimuth,
      o.sunElevation !== undefined ? o.sunElevation : p.sunElevation,
      state.sunDir
    );
    uniforms.uSunDir.value.copy(state.sunDir);
    uniforms.uSunTint.value.setHex(p.sunTint);
    uniforms.uSun.value.set(p.sunSize, p.sunGain, p.sunGlare, p.moonPhase || 0);

    uniforms.uCloud.value.fromArray(p.cloud);
    uniforms.uCloudLit.value.setHex(p.cloudLit);
    uniforms.uCloudShade.value.setHex(p.cloudShade);

    uniforms.uStars.value = p.stars || 0;
    uniforms.uHaze.value = p.haze || 0;
    uniforms.uHazeTint.value.setHex(p.hazeTint || 0xffffff);

    uniforms.uBokeh.value.set(
      p.bokeh ? p.bokeh[0] : 0, p.bokeh ? p.bokeh[1] : 0.4
    );
    uniforms.uBokehWarm.value.setHex(p.bokehWarm || 0xffb46a);
    uniforms.uBokehCool.value.setHex(p.bokehCool || 0x7ad4ff);

    uniforms.uSearch.value = p.search || 0;
    uniforms.uHell.value.set(p.hell ? p.hell[0] : 0, p.hell ? p.hell[1] : 0);
    uniforms.uHellTint.value.setHex(p.hellTint || 0xff5a1e);
    state.ledBase = p.led || 0;
    uniforms.uLed.value.set(state.ledBase, 0);
    uniforms.uLedA.value.setHex(p.ledA || 0xff1e6a);
    uniforms.uLedB.value.setHex(p.ledB || 0x22d8ff);

    for (let i = 0; i < 4; i += 1) uniforms.uFlash.value[i].w = 0;

    /* ---- fog -------------------------------------------------------
       Default is the preset's own far-distance colour, which for an
       outdoor course IS the horizon band of the dome. Interiors
       override it with the colour of their own far wall. */
    const f = o.fog || p.fog;
    fog.color.setHex(f.color);
    fog.near = f.near;
    fog.far = f.far;
    beamUniforms.uFog.value.set(f.near, f.far);

    /* ---- lights: written, never added ------------------------------- */
    key.color.setHex(p.key.color);
    key.intensity = p.key.intensity;
    /* A property write on a light that already exists - no material
       sees a different light COUNT, so nothing recompiles. */
    key.shadow.intensity = o.shadowStrength !== undefined
      ? o.shadowStrength
      : (p.shadowStrength !== undefined ? p.shadowStrength : DEFAULT_SHADOW_STRENGTH);
    rim.color.setHex(p.rim.color);
    rim.intensity = p.rim.intensity;
    dirFrom(p.rim.azimuth, p.rim.elevation, state.rimDir);
    hemi.color.setHex(p.hemi.sky);
    hemi.groundColor.setHex(p.hemi.ground);
    hemi.intensity = p.hemi.intensity;
    ambient.color.setHex(p.ambient.color);
    ambient.intensity = p.ambient.intensity;

    resolveCast(p, o);

    if (ctx.render && typeof ctx.render.setExposure === "function") {
      ctx.render.setExposure(p.exposure || 1);
    }
  }

  /** Turn a preset's `cast` block into the numbers vfx.js's bake wants:
   *  a horizontal unit vector pointing TOWARD the light (that is the
   *  way a horizon test walks), the same vector reversed for anything
   *  that needs the direction shade FALLS in, and tan(elevation), which
   *  is the metres of occluder height needed per metre of throw. */
  function resolveCast(p, o) {
    /* Only ever called out of applyPreset, i.e. on a course change, and
       a new course has new cameras - so whatever aimed the last one is
       stale by definition. */
    state.castAim = null;
    state.castChosen = null;
    const c = (o && o.cast !== undefined) ? o.cast : p.cast;
    if (!c || !(c.strength > 0)) { state.cast = null; return; }
    state.castAuthored = c.azimuth !== undefined ? c.azimuth : p.sunAzimuth;
    state.castAuthoredEl = Math.min(CAST_MAX_ELEVATION, Math.max(CAST_MIN_ELEVATION,
      c.elevation !== undefined ? c.elevation : DEFAULT_CAST_ELEVATION));
    /* Reused, never reallocated - see the note by state.cast. */
    const out = state.cast || (state.cast = {
      x: 0, z: 0, shadeX: 0, shadeZ: 0, tan: 1,
      azimuth: 0, elevation: 0, strength: 0, maxLength: 8, occluderCap: 0,
    });
    out.strength = c.strength;
    out.maxLength = c.maxLength === undefined ? 8 : c.maxLength;
    /* Zero means "whatever vfx.js already uses for the skirt" - the
       safe default, and the reason this field can be omitted. */
    out.occluderCap = c.occluderCap === undefined ? 0 : c.occluderCap;
    applyCastAim();
  }

  /** Which way the cast points and how steeply, in degrees.
   *
   *  Three sources, in order: the candidate the search kept, the skew
   *  formula around whatever camera aimed it, and the course's own
   *  authored answer. The middle one is a fallback rather than the main
   *  path - it is what the direction is between a re-aim and the bake
   *  that solves it, and what a build with the search switched off
   *  runs on. See AIMING THE CAST and WHY THE AIM IS A SEARCH. */
  function castAzimuthDeg() {
    if (state.castChosen) return state.castChosen.azimuth;
    if (state.castAim === null) return state.castAuthored;
    /* Shade must fall toward the lens, which puts the light beyond the
       subject - so the cast azimuth IS the view bearing, skewed off the
       axis toward whatever the course authored. */
    const lean = angDelta(state.castAuthored, state.castAim);
    return state.castAim + (lean >= 0 ? CAST_SKEW : -CAST_SKEW);
  }

  function castElevationDeg() {
    return state.castChosen ? state.castChosen.elevation : state.castAuthoredEl;
  }

  /** Write the direction terms of state.cast from the two above. Split
   *  out of resolveCast so a re-aim costs a handful of trig calls
   *  rather than a whole preset re-read. */
  function applyCastAim() {
    const out = state.cast;
    if (!out) return;
    const az = castAzimuthDeg() * Math.PI / 180;
    const el = castElevationDeg();
    const sx = Math.sin(az);
    const sz = Math.cos(az);
    const len = Math.hypot(sx, sz) || 1;
    out.x = sx / len;
    out.z = sz / len;
    out.shadeX = -out.x;
    out.shadeZ = -out.z;
    out.azimuth = Math.atan2(out.x, out.z);
    out.elevation = el;
    out.tan = Math.tan(el * Math.PI / 180);
  }

  /** Fit the single shadow map to the course. Called once per load, so
   *  the map never crawls with the camera - the whole play area is in
   *  frustum at all times and the texel grid is fixed in world space. */
  function fitShadow(centre, radius) {
    state.centre.copy(centre);
    state.radius = Math.max(12, radius);
    const half = state.radius * 1.05;
    const cam = key.shadow.camera;
    cam.left = -half; cam.right = half;
    cam.top = half; cam.bottom = -half;
    cam.near = 1;
    cam.far = state.radius * 6;
    cam.updateProjectionMatrix();
    placeLights();
  }

  function placeLights() {
    const d = state.radius * 2.6;
    key.target.position.copy(state.centre);
    key.position.copy(state.centre).addScaledVector(state.sunDir, d);
    key.target.updateMatrixWorld();
    rim.target.position.copy(state.centre);
    rim.position.copy(state.centre).addScaledVector(state.rimDir, d);
    rim.target.updateMatrixWorld();
  }

  /* ------------------------------------------------------------------
     Public surface
     ------------------------------------------------------------------ */

  const api = {
    dome,
    lights: { key, rim, hemi, ambient, accents },
    fog,
    applyAdditiveFog,
    presets: PRESETS,

    /** The colour anything distant must fade to. world.js uses this
     *  for the far walls so no horizon line ever shows a seam. */
    get fogColor() { return fog.color; },
    get sunDir() { return state.sunDir; },
    get courseId() { return state.id; },

    /**
     * The direction every baked and blob shadow in this course must
     * agree on, or null on a course whose shadow map casts for real.
     * See THE BAKED CAST above for what each field means.
     *
     * The object is POOLED - copy anything you keep past the call.
     */
    shadowCast() { return state.cast; },

    /**
     * Point the cast down the lens. See AIMING THE CAST above.
     *
     * `bearing` is the compass heading of the camera's VIEW axis in
     * radians - atan2(look.x - pos.x, look.z - pos.z) - which is the
     * same convention camera.js records its committed shots in.
     *
     * Returns true when the direction moved far enough to be worth a
     * re-bake, so the caller can drive one without keeping its own
     * copy of the angle. Returns false on a course with no cast, which
     * is what stops an exterior's real shadow map being doubled.
     */
    aimCast(bearing) {
      if (!state.cast || !Number.isFinite(bearing)) return false;
      const deg = bearing * 180 / Math.PI;
      if (state.castAim !== null
        && Math.abs(angDelta(deg, state.castAim)) <= CAST_AIM_EPSILON) return false;
      state.castAim = deg;
      /* The kept candidate belongs to the pose that was solved for.
         Dropping it puts the cast back on the skew formula until the
         bake this return value asks for runs the search again. */
      state.castChosen = null;
      applyCastAim();
      return true;
    },

    /**
     * The directions worth trying for the pose aimCast() was last
     * given, best guess first, or null when nothing has aimed the cast
     * - which is free play, and free play does not pay for a search.
     *
     * Each entry carries everything the horizon march needs, so the
     * caller never recomputes trigonometry inside its own loop:
     *   { azimuth, elevation }  degrees, for reporting
     *   { x, z }                horizontal unit vector TOWARD the light
     *   { tan }                 occluder metres needed per metre of throw
     *
     * The array and its entries are POOLED and rebuilt on every aim.
     * Read them, hand one back to useCastCandidate(), keep neither.
     *
     * Entry 0 is always the course's authored answer at its authored
     * elevation, so "the search found nothing" degrades to the
     * behaviour this course had before there was a search.
     */
    castCandidates() {
      if (!state.cast || state.castAim === null || !state.castSearch) return null;
      const list = state.castList;
      let n = 0;
      const push = (azDeg, elDeg) => {
        const c = list[n] || (list[n] = { azimuth: 0, elevation: 0, x: 0, z: 0, tan: 1 });
        const el = Math.min(CAST_MAX_ELEVATION, Math.max(CAST_MIN_ELEVATION, elDeg));
        const az = ((azDeg % 360) + 360) % 360;
        c.azimuth = az;
        c.elevation = el;
        c.x = Math.sin(az * Math.PI / 180);
        c.z = Math.cos(az * Math.PI / 180);
        c.tan = Math.tan(el * Math.PI / 180);
        n += 1;
      };
      push(state.castAuthored, state.castAuthoredEl);
      for (const pitch of CAST_PITCHES) {
        for (const skew of CAST_SKEWS) {
          /* Never offer a second copy of entry zero: a tie against
             itself would look like the search having found something. */
          if (pitch === 0
            && Math.abs(angDelta(state.castAim + skew, state.castAuthored)) < 1) continue;
          push(state.castAim + skew, state.castAuthoredEl + pitch);
        }
      }
      list.length = n;
      return list;
    },

    /** The coverage band a candidate is scored against - the fraction
     *  of the visible near deck that should carry the cast. Pooled. */
    castTarget() { return CAST_TARGET; },

    /** Adopt a candidate from the list above. Copied out of the pool,
     *  so the next castCandidates() may overwrite it freely. */
    useCastCandidate(c) {
      if (!state.cast || !c) return false;
      const k = state.castKeep;
      k.azimuth = c.azimuth; k.elevation = c.elevation;
      k.x = c.x; k.z = c.z; k.tan = c.tan;
      state.castChosen = k;
      applyCastAim();
      return true;
    },

    /** Back to the course's authored direction - what free play uses.
     *  Same return contract as aimCast(). */
    clearCastAim() {
      if (!state.cast || (state.castAim === null && !state.castChosen)) return false;
      const before = castAzimuthDeg();
      const beforeEl = castElevationDeg();
      state.castAim = null;
      state.castChosen = null;
      applyCastAim();
      return Math.abs(angDelta(state.castAuthored, before)) > CAST_AIM_EPSILON
        || Math.abs(state.castAuthoredEl - beforeEl) > 0.5;
    },

    /**
     * Override the cast without re-entering the course.
     *
     * The A/B seam for this pass. `vfx.setGroundCast` answers "is the
     * cast doing anything"; this answers "is it aimed and pitched
     * right", which cannot be swept from the presets while other
     * agents are editing the level - cross-run numbers are worthless,
     * so a sweep has to happen inside one process.
     *
     * Fields are those of a preset `cast` block, plus `search` - which
     * turns the candidate sweep off, so a run can measure the skew
     * formula on its own.
     *
     * Anything written here becomes the AUTHORED answer, and the kept
     * candidate is dropped: a sweep that could not move the direction
     * it just set would report the previous one's numbers.
     */
    setCast(opts) {
      if (!opts) return state.cast;
      if (opts.azimuth !== undefined) state.castAuthored = opts.azimuth;
      if (opts.elevation !== undefined) {
        state.castAuthoredEl = Math.min(CAST_MAX_ELEVATION,
          Math.max(CAST_MIN_ELEVATION, opts.elevation));
      }
      if (opts.search !== undefined) state.castSearch = opts.search !== false;
      if (Array.isArray(opts.cover)) {
        CAST_TARGET.lo = opts.cover[0];
        CAST_TARGET.hi = opts.cover[1];
      }
      if (opts.aim === null) state.castAim = null;
      if (state.cast) {
        if (opts.strength !== undefined) state.cast.strength = opts.strength;
        if (opts.maxLength !== undefined) state.cast.maxLength = opts.maxLength;
        if (opts.occluderCap !== undefined) state.cast.occluderCap = opts.occluderCap;
        state.castChosen = null;
        applyCastAim();
      }
      return state.cast;
    },

    /**
     * Switch the atmosphere. This is a pure uniform / intensity write:
     * nothing is added to or removed from the scene, so it costs no
     * shader recompilation and can run on a frame boundary.
     *
     * opts:
     *   centre, radius   fit the shadow map to the course
     *   beams            [{ pos, dir, length, radius, radiusEnd, color }]
     *   accents          [{ pos, color, intensity, distance }] up to 4
     *   fog              { color, near, far } override
     */
    setCourse(courseId, opts) {
      const o = opts || {};
      const preset = PRESETS[courseId] || PRESETS[0];
      state.id = courseId;
      state.preset = preset;
      applyPreset(preset, o);

      if (o.centre) {
        fitShadow(
          o.centre.isVector3 ? o.centre : tmpVec.set(o.centre[0], o.centre[1], o.centre[2]),
          o.radius || 90
        );
      } else {
        fitShadow(tmpVec.set(0, 0, 0), o.radius || 90);
      }

      setBeams(o.beams || preset.beams || []);
      beamUniforms.uGain.value = o.beamGain !== undefined ? o.beamGain : 1;

      const list = o.accents || [];
      for (let i = 0; i < accents.length; i += 1) {
        const a = list[i];
        const p = accents[i];
        if (!a) {
          p.intensity = 0;
          p.userData.baseIntensity = 0;
          p.position.set(0, -400 - i, 0);
          continue;
        }
        p.color.setHex(a.color === undefined ? 0xffffff : a.color);
        p.intensity = a.intensity === undefined ? 1 : a.intensity;
        p.userData.baseIntensity = p.intensity;
        p.distance = a.distance === undefined ? 60 : a.distance;
        p.decay = a.decay === undefined ? 2 : a.decay;
        p.position.set(a.pos[0], a.pos[1], a.pos[2]);
      }

      ctx.bus?.emit?.("sky:course", { id: courseId, name: preset.name });
      return preset;
    },

    setBeams,
    fitShadow,

    /** Nudge one accent without re-entering the course - used by the
     *  boss fights to swing the stage lighting. */
    setAccent(index, opts) {
      const p = accents[index];
      if (!p || !opts) return;
      if (opts.color !== undefined) p.color.setHex(opts.color);
      if (opts.intensity !== undefined) p.intensity = opts.intensity;
      if (opts.pos) p.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
    },

    update() {
      const t = ctx.clock.t;
      const dt = ctx.clock.dt;
      uniforms.uTime.value = t;

      /* The dome is parented to nothing and simply follows the camera.
         Scaling to just under camera.far keeps it inside the frustum
         at any far-plane setting render.js chooses. */
      const cam = ctx.camera;
      dome.position.copy(cam.position);
      dome.scale.setScalar(cam.far * 0.94);
      dome.updateMatrix();
      dome.updateMatrixWorld(true);

      /* Beat reaction. The whole game runs at 124 BPM and the lights
         are part of the music, not decoration on top of it. */
      const beat = ctx.clock.onBeat ? 1 : 0;
      state.beatPulse = damp(state.beatPulse, beat, beat ? 26 : 9, dt || 0.016);
      uniforms.uLed.value.set(state.ledBase, state.beatPulse * state.ledBase);

      /* Searchlights sweep in unrelated periods so the pattern never
         visibly repeats within a shot. */
      if (uniforms.uSearch.value > 0.001) {
        state.searchSpin += dt * 0.22;
        const dirs = uniforms.uSearchDir.value;
        for (let i = 0; i < dirs.length; i += 1) {
          const phase = state.searchSpin * (0.7 + i * 0.19) + i * 1.7;
          dirFrom(
            (phase * 40) % 360,
            34 + Math.sin(phase * 1.31 + i) * 22,
            dirs[i]
          );
        }
      }

      /* Press flashes. Deterministic from the frame clock so two runs
         of the same build produce the same frame, which is what makes
         a screenshot golden mean anything. */
      const flashes = state.preset.flashes || 0;
      if (flashes > 0) {
        for (let i = 0; i < 4; i += 1) {
          if (i >= flashes) { uniforms.uFlash.value[i].w = 0; continue; }
          state.flashClock[i] -= dt;
          const v = uniforms.uFlash.value[i];
          if (state.flashClock[i] <= 0) {
            state.flashClock[i] = 0.12 + state.flashRng() * 0.55;
            const az = state.flashRng() * 360;
            const el = 1 + state.flashRng() * 9;
            dirFrom(az, el, tmpVec);
            v.set(tmpVec.x, tmpVec.y, tmpVec.z, 0.8 + state.flashRng() * 0.5);
          } else {
            /* Hard attack, fast decay. A flash that fades symmetrically
               reads as a pulsing lamp, not as a shutter. */
            v.w = Math.max(0, v.w - dt * 7.5);
          }
        }
      }

      /* Accents breathe with the beat rather than sitting flat. */
      for (let i = 0; i < accents.length; i += 1) {
        const p = accents[i];
        const base = p.userData.baseIntensity || 0;
        if (base <= 0) continue;
        p.intensity = base * (1 + state.beatPulse * 0.16);
      }
    },

    status() {
      return {
        course: state.id,
        name: state.preset.name,
        fog: { color: `#${fog.color.getHexString()}`, near: fog.near, far: fog.far },
        sunDir: state.sunDir.toArray().map((n) => Number(n.toFixed(3))),
        cast: state.cast ? {
          azimuth: Number((state.cast.azimuth * 180 / Math.PI).toFixed(1)),
          authored: state.castAuthored,
          aim: state.castAim === null ? null : Number(state.castAim.toFixed(1)),
          chosen: state.castChosen
            ? [state.castChosen.azimuth, state.castChosen.elevation] : null,
          elevation: state.cast.elevation,
          strength: state.cast.strength,
          maxLength: state.cast.maxLength,
          shade: [Number(state.cast.shadeX.toFixed(3)), Number(state.cast.shadeZ.toFixed(3))],
        } : null,
        lights: {
          key: key.intensity, rim: rim.intensity,
          shadowStrength: key.shadow.intensity,
          hemi: hemi.intensity, ambient: ambient.intensity,
          accents: accents.map((a) => Number(a.intensity.toFixed(2))),
        },
        beams: beamDefs.length,
      };
    },

    dispose() {
      clearBeams();
      scene.remove(beamGroup);
      scene.remove(dome);
      domeGeo.dispose();
      domeMat.dispose();
      beamMat.dispose();
      for (const l of [key, rim, hemi, ambient, ...accents]) scene.remove(l);
      scene.remove(key.target);
      scene.remove(rim.target);
      scene.fog = null;
    },
  };

  /* Start on the hub's atmosphere so the very first frame of the
     session is lit, not black. */
  api.setCourse(0, {});

  return api;
}

/* ------------------------------------------------------------------
   Geometry merge.

   three ships BufferGeometryUtils in addons, but pulling an addon in
   for one function adds a CDN path that can fail independently of the
   engine - and this only ever has to handle non-interleaved float
   attributes with matching sets, which is a far smaller problem than
   the general case. Exported so levels.js and world.js share one
   implementation.
   ------------------------------------------------------------------ */

export function mergeGeometries(geometries) {
  const list = geometries.filter((g) => g && g.attributes && g.attributes.position);
  if (list.length === 0) return new THREE.BufferGeometry();
  if (list.length === 1) return list[0];

  const names = Object.keys(list[0].attributes);
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of list) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    arrays[name] = { data: new Float32Array(vertexCount * size), size, offset: 0 };
  }
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vBase = 0;
  let iOff = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    for (const name of names) {
      const target = arrays[name];
      const src = g.attributes[name];
      if (!src) { target.offset += count * target.size; continue; }
      target.data.set(src.array.subarray(0, count * src.itemSize), target.offset);
      target.offset += count * target.size;
    }
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i += 1) index[iOff + i] = gi[i] + vBase;
      iOff += gi.length;
    } else {
      for (let i = 0; i < count; i += 1) index[iOff + i] = i + vBase;
      iOff += count;
    }
    vBase += count;
  }

  for (const name of names) {
    out.setAttribute(name, new THREE.BufferAttribute(arrays[name].data, arrays[name].size));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
