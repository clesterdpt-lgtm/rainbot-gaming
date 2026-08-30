/* ============================================================
   SAINTFALL - Kenosis sky, the cloud inversion and the ice halo

   The peer of sky.js. Same exported shape, same two lights, same
   dome contract - and three things Vesper-IX has no use for.

   ------------------------------------------------------------
   THE ONE RULE THAT IS COPIED RATHER THAN WRITTEN

   DOME_FRAG's sfSky() below is a BYTE COPY of art.js's, at
   art.js:1068-1083, comment included. sky.js:4-9 records why:
   the world's aerial perspective fades every opaque surface
   toward `sfSky(rd)` (art.js:1126), so if the dome's copy and
   art.js's copy ever drift you get a visible seam along every
   horizon line, and it reads as a bug in the terrain rather than
   in the sky. We reuse `patchMaterial` unchanged, so art.js's
   copy is the fixed point: OURS MATCHES ART.JS, never the other
   way round. Do not reformat it, do not "tidy" the comment, do
   not factor it out - a shared export would be nice and is not
   worth a second module boundary between two shaders that have
   to agree at the byte.

   ------------------------------------------------------------
   1. THE CLOUD INVERSION

   The signature object of the level, and the reason this file
   exists rather than a parameterised sky.js.

   Below about 120m Kenosis has a permanent inversion: a flat
   white sea of stratus lying in the ring valley. It does four
   jobs and only the first is scenery.

     (a) It gives every high shot a horizon that is NOT the map
         edge, which is why this map has no rim.
     (b) It hides the terrain mesh's boundary at r = 1024 from a
         camera standing in the valley - see THE LOW SHEET below,
         which is not decoration and was arrived at by working
         out the sight line.
     (c) It splits the level in two. Four stations (basecamp 12m,
         tarn 41m, bowl 62m, glacier 96m) sit UNDER the lid in
         flat monochrome cloud light; five (rime 141m, fumarole
         162m, cascade 209m, bell 241m, summit 452m) sit above it
         in hard alpenglow. The climb out of the cloud is the
         level's arc, and this module drives the two lights that
         make it true - see `coverAt` and the overcast block in
         `update`.
     (d) It is a place you can stand in.

   It is a STACK OF SHEETS, not a skin, and that is the whole
   design. A shell with a top and a bottom looks right from above
   and is empty from inside; six horizontal sheets between 10m
   and 120m accumulate to opaque white at a grazing angle (which
   is (a) and (b)), read as a solid sea from the summit, and from
   inside put you between two of them with the rest fading off in
   every direction - which is what being in cloud looks like. The
   only artefact a stack has is a sheet passing through your own
   eye level, which is one line of fragment shader below.

   ------------------------------------------------------------
   1b. THE CLEARING - why the deck has a hole in it

   THE DEFECT THIS EXISTS TO FIX, measured on the arrival frame,
   which is the level's most important image. The basecamp eye sits
   at 28 m and the deck's sheets sat at 56, 78, 100 and 120 m with
   their shorelines at the radius where the mountain reaches that
   altitude - 714, 667, 558 and 532 m. The sight line from the gate
   at r = 957 up to the peak crosses those four altitudes at r =
   890, 838, 786 and 738, and every one of those crossings is
   OUTSIDE its sheet's shoreline, so the ray to the peak passed
   through four sheets within 220 m of the camera. The whole
   subject arrived behind a pale wash with the sheet intersections
   drawn as horizontal bands across the flank, and those bands read
   as a rendering fault rather than as weather. Which is exactly
   what standing under cloud looks like, and is the wrong picture.

   THE FIX IS LEVEL DESIGN, NOT AN OPACITY SLIDER. Three cheaper
   answers were considered and rejected in writing:
     - drop the deck's alpha. Buys a thinner veil, still a veil,
       and it costs the level jobs (a) and (b) above - the map edge
       comes back and every high shot loses its horizon.
     - lower INVERSION_BASE / INVERSION_TOP so the deck sits under
       the gate. It cannot: the gate is at 12 m and the four low
       stations sit between 12 and 96 m, so a deck low enough to be
       under the arrival camera is under the level as well.
     - move the gate above the deck. That is the one image the
       layout is built around - you arrive at the mouth of the
       valley with the whole mountain framed by two buttresses -
       and it is authored at 0 m on purpose.

   What a cloud sea in a ring valley actually does is stand OFF the
   massif: air forced up the flank and back down in the lee is dry,
   so the sea has a clear hole over the mountain and laps at a
   shore some way out from its foot. So the deck gains a CLEARING -
   an inner radius that is not the mountain's own contour - with
   three properties, all of them geometric:

     - it is A LOBE POINTING DOWNWIND, not a circle. The axis is
       read from `atmos.windDir`, the same vector that drives the
       deck's own flow, the spindrift, the rime and the sastrugi. A
       clearing that ignored the wind while everything else in the
       level obeyed it is the sort of disagreement that is only
       ever noticed once and then cannot be unseen.
     - it is FEATHERED, by the existing 150 m lap and by four
       integer harmonics of its own.
     - it is a SHAFT, not a funnel - see DECK_LAYERS for the pass
       that got that backwards and what it measured.

   MEASURED. Over 3600 bearings the boundary runs 79 m to 1024 m,
   mean 645; `status().inversion.clearing` publishes base, shear,
   min, max and mean, so a build that quietly lost the lobe reports
   a flat curve rather than looking almost right.

   Against the arrival sight line specifically - the pose stands at
   r = 957, y = 28 and looks at (0, 430, 0), and the clearing at
   that bearing is 983 m:

     sheet y=120   crosses r 738   sheet starts 983   clear by 245
     sheet y=100   crosses r 786   sheet starts 983   clear by 197
     sheet y= 78   crosses r 838   sheet starts 983   clear by 145
     sheet y= 56   crosses r 890   sheet starts 983   clear by  93
     sheet y= 34   crosses r 943   sheet starts 983   clear by  40
     sheet y= 10   behind the camera

   and `coverAt` at that camera is 0.00 against 0.99 before, which
   is also worth 38% of the key light: the overcast block in
   `update` was dimming the sun by that much because the CAMERA was
   under cloud, on the one frame in the level composed around a
   sunlit peak.

   The frame, A/B on the same terrain with the lobe switched off
   (`CLEAR_BASE = CLEAR_SHEAR = 0` reduces `innerAt` to the
   contour, which is exactly the pre-clearing build):

                        veiled        cleared
     mean luma          144.6         119.3
     std dev             47.4          40.2
     saturation          27.9          61.7
     edge density        6.72%        10.98%

   STANDARD DEVIATION WENT DOWN, and reporting it as an improvement
   would be a lie. sigma on this frame was never measuring form: a
   bright veil over a dark unlit mountain is a large global
   light/dark split and it scores well. What actually changed is
   that the subject came back - edge density up 63%, saturation up
   121%, and the summit and its spire visible at all. The
   instruments that see this change are edges and colour; sigma is
   the instrument that saw the ambient-fill defect in round 1 and
   it is the wrong one here.

   WHAT IT COSTS, NAMED. Of the four stations the art direction
   puts under the lid, the Black Tarn keeps it outright (cover
   0.96) and the Basecamp and the Avalanche Bowl lose it (0.00).
   The Bowl is not an accident of the arithmetic: it sits 23
   degrees off downwind, which is where a lee clearing goes. The
   Basecamp losing it is the whole request. The Glacier Tongue is
   a separate matter and NOT this module's doing - its pad is at
   96 m and the mountain reaches 120 m at r = 532 while the pad
   sits at r = 566, so the station is 34 m outside the sea's own
   waterline whatever the clearing does, and measures 0.12. If the
   Tongue is meant to be a cloud-light station it needs to be sited
   lower or further out; the deck is reporting honestly.

   ------------------------------------------------------------
   2. THE 22-DEGREE HALO AND THE SUN DOGS

   Ice-crystal optics, and they are GEOMETRY, not a dome term.
   The contract is explicit and the reason is the fade: a term
   added inside sfSky() is painted on the dome only, and the
   terrain's aerial perspective mixes toward sfSky() as well
   (art.js:1126), so a bright arc drawn in the dome would have no
   counterpart in the haze and would terminate dead at every
   ridge line. Built as additive geometry at 3400m through
   `patchBasicMaterial(mat, atmos, fade, true)` it is faded by
   the same height-dependent fog as everything else: crisp from
   the summit where the air is thin, dissolved into the valley
   haze near the horizon. The arithmetic is under HALO_R.

   ------------------------------------------------------------
   3. HIGH CIRRUS, AT ZERO EXTRA DRAW CALLS

   Straight from the sky-cirrus note and merged into the SAME
   geometry and material as the inversion, which is what makes it
   free. That forces the deck to carry a 4-component vertex
   colour buffer, because a merge cannot mix a vec4 colour buffer
   with a vec3 one (sky.js:1006, sky.js:1031 pads missing
   attributes with zeros rather than erroring). Every geometry
   built in this file for the cloud mesh therefore carries
   exactly {position, normal, color:4, aSwell:1} - the halo, which
   is additive and has no alpha channel to speak of, is a separate
   mesh with a 3-component buffer and never touches the merge.

   ------------------------------------------------------------
   WHAT IS NOT HERE

   No orbital ring. No second sun, no three moons. Kenosis is a
   different planet and the night key is its own moon, drawn at
   `atmos.sunDir` so the visible body and the world's shadows
   agree - which is the one thing sky.js's cathedral moon gets
   right and is worth keeping.
   ============================================================ */

import {
  TAU, clamp01, lerp, smoothstep, sstep, makeRng, makeRamp,
  mixRgb, linearToSrgb,
} from "saintfall/core.js";
import { srgbTransfer as srgb, patchBasicMaterial } from "saintfall/art.js";
import { mergeGeometries } from "saintfall/sky.js";
/* THREE NAMES, and each is here because the alternative is a copy
   that drifts. `summitProfile` is the authored elevation table (see
   THE MOUNTAIN, below); `MAP_HALF` is the edge of the world, which
   the clearing may not open past; `STATIONS` is what the floor
   sheet's screening cap is derived from, because the stations move
   and a number typed in against last week's siting is a number that
   will be wrong without saying so.

   No cycle: summit-terrain imports core, art and summit-art only.
   Its module body does real work at import time (the Via Sacra
   march), and that work already happens - summit-main imports it
   two steps before it builds this. */
import { MAP_HALF, STATIONS, summitProfile } from "saintfall/summit-terrain.js";

/* The top of the inversion, in metres. Exported because it is a
   shared authored number: summit-weather's `fall` field is only
   allowed under the deck, and summit-world beds the cloud-line
   props against it. One number, several readers - if any of them
   writes its own, the level's most important horizontal line
   stops being a line. */
export const INVERSION_TOP = 120;
/** The lowest sheet. Below this there is clear (if murky) air. */
export const INVERSION_BASE = 10;

/* ============================================================
   THE DOME
   ============================================================ */

/* A raw shader so the gradient is evaluated per pixel rather
   than per vertex. Vesper's reasoning holds and gets stronger
   here: this world's zenith-to-horizon swing is the widest in
   either level (navy to peach in one gradient), and a
   vertex-interpolated version of that bands so badly it reads as
   a compression artefact. */
const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // pin to the far plane
}
`;

const DOME_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;

uniform vec3  uSunDir;
uniform vec3  uSunHalo;
uniform vec3  uMoonDir;
uniform vec3  uSkyZenith;
uniform vec3  uSkyHigh;
uniform vec3  uSkyHorizon;
uniform vec3  uSkyLow;
uniform vec4  uFog;        // density, heightFalloff, start, sunScatter
uniform vec4  uCelestial;  // sun disc, moon, unused, cycle phase
uniform float uSunSize;
uniform float uStars;
uniform float uTimeSF;

vec3 sfSky(vec3 rd) {
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c;
  if (h < 0.5) {
    c = mix(uSkyLow, uSkyHorizon, smoothstep(0.0, 1.0, h / 0.5));
  } else if (h < 0.72) {
    c = mix(uSkyHorizon, uSkyHigh, smoothstep(0.0, 1.0, (h - 0.5) / 0.22));
  } else {
    c = mix(uSkyHigh, uSkyZenith, smoothstep(0.0, 1.0, (h - 0.72) / 0.28));
  }
  float mu = max(dot(rd, uSunDir), 0.0);
  // Two lobes: a tight halo around the disc and a broad forward
  // scatter that lifts the whole sunward half of the sky.
  c += uSunHalo * (pow(mu, 26.0) * 0.55 + pow(mu, 3.0) * 0.16) * uFog.w;
  return c;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float sfNoise(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(vec3(cell, seed));
  float b = hash13(vec3(cell + vec2(1.0, 0.0), seed));
  float c = hash13(vec3(cell + vec2(0.0, 1.0), seed));
  float d = hash13(vec3(cell + vec2(1.0, 1.0), seed));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void sfBasis(vec3 dir, out vec3 right, out vec3 up) {
  vec3 pole = abs(dir.y) > 0.94 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  right = normalize(cross(pole, dir));
  up = normalize(cross(dir, right));
}

/* Kenosis's moon. ONE body, procedural, and deliberately drawn
   at the same direction the key light comes from at night - the
   night preset in summit-art drives a 1.9-intensity blue key
   through the sun channel, which IS this moon, so its phase
   terminator and the world's cast shadows agree. Two moons on
   different arcs would look richer for exactly as long as it
   takes someone to notice the shadows only obey one of them. */
vec3 sfMoon(vec3 base, vec3 rd, vec3 dir, float size, vec3 tint, float visibility) {
  if (visibility <= 0.001) return base;
  vec3 right;
  vec3 up;
  sfBasis(dir, right, up);
  float radius = sqrt(size * 2.0);
  vec2 q = vec2(dot(rd, right), dot(rd, up)) / max(radius, 0.0001);
  float r = length(q);
  float disc = 1.0 - smoothstep(0.91, 1.0, r);
  if (disc <= 0.001) return base;
  float sphere = sqrt(max(0.0, 1.0 - r * r));
  /* Nearly full, and lit from the same side as the key. A thin
     crescent is prettier and would make a 1.9-intensity key an
     obvious lie. */
  float phase = smoothstep(-0.95, 0.55, q.x * -0.34 + q.y * 0.10 + sphere * 0.78);
  float cells = sfNoise(q * 16.0 + 3.1, 11.0);
  float broad = sfNoise(q * 5.0 - 1.9, 4.0);
  float crater = 0.46 + cells * 0.30 + broad * 0.28;
  vec3 surface = tint * crater * (0.16 + phase * 0.52);
  surface += tint * pow(max(sphere, 0.0), 0.35) * 0.06;
  return mix(base, surface, disc * visibility);
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 col = sfSky(rd);

  // --- the disc -----------------------------------------------------
  // Soft-edged rather than a hard circle: at this exposure a hard
  // disc aliases into a polygon the moment the camera turns. Two
  // terms - a bright core and a wide glare skirt - because a disc
  // with no skirt reads as a hole punched in the sky.
  float mu = dot(rd, uSunDir);
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.25, mu) * uCelestial.x;
  float glare = pow(max(mu, 0.0), 900.0);
  col += uSunHalo * (disc * 6.5 + glare * 2.2 * uCelestial.x);

  // --- stars --------------------------------------------------------
  /* Denser and steadier than Vesper's. The whole point of this
     world is that there is very little air above you: more stars
     resolve, and they scintillate LESS, because twinkle is
     turbulence in an atmosphere that is mostly below the camera.
     The threshold moves 0.9825 -> 0.9760 (about 3.7x the count)
     and the twinkle depth 0.28 -> 0.12. */
  if (uStars > 0.001) {
    vec3 sp = rd * 190.0;
    vec3 cell = floor(sp);
    float r = hash13(cell);
    if (r > 0.9760) {
      vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 3.3), hash13(cell + 7.1)) - 0.5;
      float d = length(fract(sp) - 0.5 - off * 0.6);
      float tw = 0.88 + 0.12 * sin(uTimeSF * 1.3 + r * 40.0);
      float s = smoothstep(0.14, 0.0, d) * tw;
      float warm = hash13(cell + 11.0);
      col += mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.90, 0.76), warm)
           * s * uStars * (0.4 + r * 6.0) * smoothstep(-0.05, 0.25, rd.y);
    }
  }

  col = sfMoon(col, rd, uMoonDir, 0.0030, vec3(0.72, 0.82, 1.0), uCelestial.y);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ============================================================
   THE CLOUD MATERIAL'S SHADER EXTENSION

   The cloud mesh is an UNPATCHED MeshBasicMaterial, exactly as
   sky.js's shelves are, and the reason is worth stating because
   it looks like an omission: the deck is what the sky fades TO
   at the horizon, so running it through the atmosphere's own
   aerial perspective would mix it toward the sky it is supposed
   to be. `patchBasicMaterial` is right for the halo and wrong
   here.

   That leaves onBeforeCompile free, which is what pays for the
   flow. Three uniforms are taken from `atmos.uniforms` BY
   REFERENCE (uTimeSF, uWind) so one write per frame in
   `atmos.sync()` drives the whole deck, and the wind is whatever
   the level sets it to rather than a second copy that drifts.
   ============================================================ */

const CLOUD_VERT_PARS = /* glsl */`
attribute float aSwell;
uniform float uTimeSF;
uniform vec3  uWind;     // x, z, speed
varying float vCloudY;
`;

/* Flow as VERTEX displacement, not as a fragment noise. These
   sheets cover most of the frame from inside the deck and the
   frame is already fill-bound; a per-pixel noise over that area
   is the most expensive way available to animate something whose
   motion is legible at the scale of hundreds of metres.

   Three trains, wavelengths 1500m / 2030m / 530m, all running on
   ONE heading. Vesper's dune field earned that rule the hard way
   and it is the same failure here: crossed headings on a huge
   flat sheet resolve into a plaid, and a plaid on a cloud deck
   at a grazing angle is the most artificial thing that can
   happen to this level. The drift rate is set so the longest
   train has a phase speed of 0.052 / 0.0042 = 12.4 m/s at wind
   speed 1.0, which is the layout's 14 m/s valley wind less a
   little - a deck that moves at exactly the surface wind reads
   as a conveyor belt.

   `transformed.xz` is world space here because the cloud mesh is
   parented at the origin with no transform. It has to stay that
   way: the deck's shoreline is authored against the mountain, so
   unlike sky.js's shelves it can never follow the camera. */
const CLOUD_VERT = /* glsl */`
{
  vec2 wdir = uWind.xy;
  float wl = length(wdir);
  wdir = wl > 1e-4 ? wdir / wl : vec2(1.0, 0.0);
  float t = uTimeSF * (0.55 + uWind.z * 0.45);
  float s = dot(transformed.xz, wdir);
  float c = dot(transformed.xz, vec2(-wdir.y, wdir.x));
  float swell = sin(s * 0.0042 - t * 0.052) * 0.62
              + sin(c * 0.0031 + s * 0.0013 - t * 0.031) * 0.44
              + sin(s * 0.0119 + c * 0.0074 - t * 0.089) * 0.19;
  transformed.y += swell * aSwell;
  vCloudY = (modelMatrix * vec4(transformed, 1.0)).y;
}
`;

const CLOUD_FRAG_PARS = /* glsl */`
varying float vCloudY;
`;

/* THE EYE-LEVEL DISSOLVE, and it is the only artefact a stack of
   sheets has.

   Descending into the deck, one sheet after another passes
   through the camera. A horizontal plane crossing the eye plane
   presents itself edge-on as a razor-thin line splitting the
   frame in half, and it moves with the head - which reads as a
   rendering fault, not as weather. Fading a sheet out over the
   7m either side of the camera's own altitude removes it exactly
   where it is unreadable and leaves the sheets above and below
   doing all the work, so the descent is: the sea rises, the
   surface passes, you are inside it.

   `cameraPosition` is available in the fragment stage - art.js's
   own ATMOS_FRAG relies on the same declaration. */
const CLOUD_FRAG = /* glsl */`
{
  float dy = abs(vCloudY - cameraPosition.y);
  diffuseColor.a *= smoothstep(1.5, 8.5, dy);
}
`;

/* ============================================================
   THE MOUNTAIN, AS THE SKY NEEDS TO KNOW IT

   The deck's shoreline is where a horizontal plane at the sheet's
   altitude meets the mountain, so the sky has to know the
   elevation profile.

   IT ASKS SUMMIT-TERRAIN. `summitProfile(r)` is a pure module-level
   export - the authored radial table and nothing else, no field, no
   noise, no build - so there is no ordering problem in reading it
   from a builder that runs at contract step 5, one step before the
   terrain mesh exists. `ctx.terrain` is what is unavailable here;
   the profile function is not.

   THIS FILE USED TO KEEP ITS OWN COPY OF THE TABLE, and the copy
   was the right call only for as long as there was no function to
   call. It drifted within one working session: the profile was
   re-authored from a near-uniform slope into a concave-up peak and
   every shoreline moved by 60 to 200 metres - y = 120 from 606 to
   532, y = 10 from 937 to 900 - while the copy went on describing
   the old mountain. A shoreline is alpha-feathered over 150 m, so
   the symptom was not an error anywhere; it was a sea lying in the
   wrong place with every check still green. The copy is gone.

   What the sky deliberately does NOT read is the height FIELD.
   The profile is the smooth authored cone; the field adds ridge
   noise, buttress spurs, station pads and the Via Sacra cut. A
   cloud shoreline that followed every gully and every levelled
   arena would be a worse shoreline than one that ignores them.
   Real ones do not do it either.
   ============================================================ */

/** The radius at which the mountain drops through altitude `y`.
 *  Bisection rather than a closed form: the profile is monotonic
 *  in r, twenty-eight steps resolve it to under a metre, and it
 *  runs six times in the whole build. */
function shoreRadiusFor(y) {
  let lo = 0;
  let hi = MAP_HALF;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) * 0.5;
    if (summitProfile(mid) > y) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/* ============================================================
   THE SHEETS

   `r` is the outer radius, and the two that reach 8600 are the
   ones doing real work rather than filling volume:

     y = 120  the sea surface. Everything above the inversion
              looks down at THIS, so it is the only sheet with a
              sculpted top, a 15-ring radial grid and a far rim
              painted into the horizon.
     y =  10  THE LOW SHEET, and it is what hides the map edge.
              Worked through from the basecamp, which is the worst
              case: the spawn eye stands at (0, 931, 13.7) on a
              12 m pad, the terrain mesh ends 93 m south at
              r = 1024 where the ground is at 0, and that boundary
              therefore sits 8.4 degrees below the eyeline - inside
              the frame of anyone who turns round at the gate. This
              sheet is capped at FLOOR_SHORE_CAP = 951 (see THE
              CLEARING), so it begins 20 m south of the spawn and
              presents its near edge 10.5 degrees down: everything
              from there up to the horizon is its top surface
              receding to infinity, and the mesh boundary at -8.4
              is inside that. The four sheets between do not reach:
              their shorelines are inside the basecamp and their
              altitudes are above the eye.

              THAT CAP IS THE REASON THE CLEARING DOES NOT APPLY
              HERE IN FULL. Every other sheet takes the lobe
              whole; this one is pulled back to the cap wherever
              the lobe would carry it further, because its job is
              geometric and the lobe reaches 1024 downwind.

   The middle four are the body of the deck. They are small in
   radius on purpose - a sheet 38m above your head covers
   everything down to 1 degree of elevation by radius 2200, so
   paying for 8600 of it is paying for geometry the top sheet and
   the horizon already own. Area goes as r squared and this is a
   fill-bound frame.
   ============================================================ */
/* `hole` is how much of THE CLEARING (header 1b) this sheet takes:
   0 pins it to the mountain's own contour exactly as before the
   clearing existed, 1 gives it the whole lobe.

   IT IS A SHAFT, NOT A FUNNEL, and the first pass had it the other
   way round for a reason that sounded right and measured wrong. A
   sea thins from the top, so the clearing was authored widest at
   the surface and tapering toward the floor - 1.00, 1.00, 0.84,
   0.52, 0.22, 0.28 down the stack. That is what a break in a
   stratus deck looks like from ABOVE, and the frame this exists
   for is from BELOW. The arrival camera sits at 28 m, so its sight
   line to the peak crosses the 34 m sheet way out at r = 943 and
   the 120 m sheet at only 738: the LOW sheets are the ones a low
   camera looks through, and tapering them tapered the only ones
   that mattered. Measured on that sight line with the lobe at 983:
   at 0.52 the 56 m sheet's shore came out at 854 against a
   crossing at 890, so it was still veiling the shot on a build
   whose top sheet had retreated 450 m.

   So every sheet takes the whole lobe, and the one exception is a
   JOB rather than a shape: `cap` on the floor sheet, which is the
   map-edge screen. See FLOOR_SHORE_CAP and THE SHEETS. */
/* --- THE SHEETS HAVE TO OVERLAP OR THEY ARE STRIPES -------------

   Six sheets at 120/100/78/56/34/10 with gaps of 20-24m, and a
   `swell` - the vertical displacement in the vertex shader - of 8.5m
   at the top and 1.4m at the bottom. Nothing ever reached its
   neighbour, so from any level camera the deck resolved as six flat
   discs seen edge-on: hard, countable, evenly spaced. Three
   consecutive blind rounds described it independently - "posterised
   horizontal bands", "six hard horizontal terrace bands", "five hard
   fog bands, the band stepping is countable" - and in two of them it
   was the whole picture.

   Swell is now about three quarters of the gap above each sheet, so
   adjacent sheets interpenetrate and the deck integrates vertically
   into one body instead of a stack. Alpha comes down by roughly a
   fifth because overlapping sheets accumulate, and the point of the
   deck is that the mountain has no waterline. */
const DECK_LAYERS = [
  /* Swell now EXCEEDS the gap above each sheet (22-24m), where the
     previous pass only matched three quarters of it. Matching the gap
     still leaves a plane you can see edge-on: a sheet is thin by
     construction, so from inside the stack each one presents its own
     hard horizontal line and six of them read as terraces. A blind
     round called it "quantised terrace bands across an entire slope -
     a shading bug, not art" and lost two frames on it.
     Exceeding the gap means no sheet has a boundary of its own that
     is not already inside its neighbour, and the deck integrates into
     one body. Alpha comes down again to pay for the extra overlap. */
  { y: 120, r: 8600, seg: 192, rings: 15, bill: 11.0, swell: 30.0, alpha: 0.58, tone: 1.00, hole: 1 },
  { y: 100, r: 3800, seg: 128, rings: 10, bill: 5.5, swell: 28.0, alpha: 0.34, tone: 0.76, hole: 1 },
  { y: 78, r: 3200, seg: 128, rings: 10, bill: 4.0, swell: 28.0, alpha: 0.30, tone: 0.56, hole: 1 },
  { y: 56, r: 2800, seg: 112, rings: 9, bill: 3.2, swell: 28.0, alpha: 0.27, tone: 0.38, hole: 1 },
  { y: 34, r: 2600, seg: 112, rings: 9, bill: 2.4, swell: 30.0, alpha: 0.25, tone: 0.20, hole: 1 },
  { y: 10, r: 8600, seg: 144, rings: 13, bill: 1.4, swell: 24.0, alpha: 0.30, tone: 0.05, hole: 1, cap: true },
];

/** How far out from its shoreline a sheet takes to reach full
 *  alpha. Long, because the whole read of an inversion is that
 *  the mountain does not have a waterline - it fades into one. */
const SHORE_FEATHER = 320;   // was 150: a shoreline seen edge-on is a line

/* ============================================================
   THE FAR RANGES - what is beyond the last mountain

   The map ends at r = 1024 and the inversion hides that edge, so
   the level had a horizon but nothing standing on it: past the
   encircling crest the frame went straight to flat haze, and a
   player reported it as emptiness beyond the first range.

   FIVE SILHOUETTE RINGS, each a closed curtain from under the
   deck up to a ridgeline, at 2.4 to 8.2 km. They are the cheapest
   possible object that answers the complaint - unlit, flat,
   vertex-coloured, one merged mesh, no draw call of their own -
   because at these distances a mountain IS its silhouette and its
   haze. Nothing else about it survives twenty degrees of murk.

   THE CRESTS BARELY RISE WITH DISTANCE, and that is the whole
   read. Aerial perspective alone does not make a range look far
   away; what does is that a farther one sits CLOSER TO THE
   HORIZON LINE. From the summit eye at 452 m these five come in
   at -1.1, -0.35, -0.06, +0.07 and +0.14 degrees - converging on
   the eyeline, which is what a receding range does. Give them
   equal angular height instead and they stack up the frame like
   a staircase and read as one jagged wall.

   THE WAVENUMBERS ARE INTEGERS AND THEY SCALE WITH RADIUS. The
   integers are the same closed-loop rule the deck's shoreline
   note sets out: a ring is a function on a circle and a
   fractional wavenumber tears it open at theta = 0. The scaling
   is because a peak is a fixed number of METRES wide, so the
   same physical range twice as far away has to have twice as many
   peaks around its ring or it reads as twice the size.

   The bases sit at y = 20, far under the 120 m sea, so every
   range comes out of the cloud rather than standing on a line. */
const FAR_RANGE_BASE = 20;
/* Half a degree of segment is a visible facet on a ridgeline at
   1080p; 1200 segments is 0.3 degrees, about 8 px at a 55 degree
   field. Cost is 12k triangles across all five - a third of the
   cirrus, and opaque rather than blended. */
const FAR_RANGE_SEG = 1800;
/* CRESTS RISE WITH DISTANCE, RELIEF FALLS, AND EVERY RANGE TOPS
   OUT JUST UNDER THE SUMMIT'S 452 m.

   The rise is what converges them on the eyeline; the falling
   relief is a peak of roughly constant SIZE seen from further
   away. Together they give about 5 degrees of skyline at the Bell
   Terrace falling to 1.4 at the far ring, which is the layering,
   and from the parvis at 452 m the whole backdrop sits at or just
   under the horizon - present, and not competing with the one
   mountain the level is about. */
const FAR_RANGES = [
  { r: 2450, crest: 333, relief: 260, haze: 0.44 },
  { r: 3600, crest: 351, relief: 220, haze: 0.60 },
  { r: 5000, crest: 367, relief: 185, haze: 0.73 },
  { r: 6600, crest: 380, relief: 155, haze: 0.83 },
  { r: 8200, crest: 391, relief: 130, haze: 0.90 },
];
/* RIDGED OCTAVES, AND THE BASE WAVENUMBER IS THE WHOLE READ.

   The first pass used seven harmonics from k=2 with a 1/k^0.85
   falloff, which is a reasonable-looking spectrum and was wrong
   by an order of magnitude: k=2 and k=3 carried nearly all the
   amplitude, so each ring had two or three broad humps around its
   ENTIRE circumference. Across a 55-degree frame that is a flat
   line, and the backdrop photographed as four horizontal grey
   slabs - the exact "quantised terrace band" failure the deck's
   own note records a blind round losing two frames on.

   A ridge has to have peaks at a few degrees of spacing, so the
   base wavenumber is chosen from ANGLE: k=11 is a 33-degree
   period, and five doublings take it to 2 degrees.

   `1 - |sin|` rather than `sin`, because a sum of sines is a
   swell and a mountain is a ridge - the fold puts a crease at
   every zero crossing, which is what a skyline is made of. */
const FAR_RANGE_OCT = 5;
const FAR_RANGE_K0 = 11;
const FAR_RANGE_GAIN = 0.56;

/* THE CLEARING, as two numbers, a direction and two caps.

   THE SHAPE IS A TONGUE POINTING DOWNWIND: a cosine in bearing,
   `CLEAR_BASE + CLEAR_SHEAR * cos(theta - lee)`. The first pass
   modelled it as a circle displaced downwind and solved the ray-
   circle intersection in closed form, which is prettier and is not
   what the level needs. Three station constraints have to hold at
   once and they are 45 degrees of bearing apart; a displaced
   circle has one shape parameter and could satisfy two of them.

   CLEAR_BASE 737 and CLEAR_SHEAR 661 are the solution of exactly
   two of those equations and are not tuned beyond them:
     983 = base + shear * cos(68 deg)   the arrival corridor, which
                                        has to clear a sight line
                                        whose worst crossing is at
                                        r = 943
     600 = base + shear * cos(102 deg)  the `inversion` camera
                                        station at r = 750, which
                                        has to still be IN cloud
   Everything else falls out and was measured rather than aimed at:
   the Black Tarn ends up at 469 against its own r = 745 and holds
   cover 0.96; the Avalanche Bowl at 1024 against r = 703 and holds
   0.00; the boundary runs 79 m to 1024 m with a mean of 645.

   `shear / base` is 0.90, so this curve is close to a cardioid and
   has a real dimple on its upwind side. That is invisible and it
   is worth knowing why: `innerAt` takes the GREATER of the
   clearing and the mountain's own contour, and upwind the contour
   (532 m at the sea surface, further out for every lower sheet) is
   outside the whole lobe. So the sea piles against the windward
   flank exactly as it did before the clearing existed and is
   cleared only in the lee - which is the weather this models,
   arrived at by solving two station constraints rather than by
   being drawn.

   THE OUTER CAP. `MAP_HALF` bounds the boundary, because the
   clearing is a hole in the cloud over the MASSIF: past the
   terrain edge there is no massif and no valley to reveal, only
   sea and dome, so opening further would delete sea from the
   horizon and leave the floor sheet out there on its own - a dark
   `tone: 0.05` plate where the picture wants a bright one. It is
   imported rather than typed because what the number means is "the
   edge of the world", not 1024.

   THE FLOOR CAP. The lowest sheet is the map-edge screen (see THE
   SHEETS), and a screen that begins outside the ground it is
   screening is not one. It is capped 60 m outside the outermost
   station a player can stand on, derived from STATIONS so that
   re-siting the level re-derives it - which is not hypothetical:
   the basecamp moved from r = 828 to r = 891 while this module was
   being written, and the first set of numbers in this comment
   block had to be thrown away because of it. */
const CLEAR_BASE = 737;
const CLEAR_SHEAR = 661;
const OUTERMOST_STATION = Math.max(
  ...Object.values(STATIONS).map((st) => Math.hypot(st.x, st.z))
);
const FLOOR_SHORE_CAP = Math.min(MAP_HALF - 48, OUTERMOST_STATION + 60);

/* FOUR HARMONICS, INTEGER, for the same reason the shoreline's are
   (see SHORE_HARMONICS) - a non-integer wavenumber on a closed
   loop tears the boundary open at theta = 0.

   AUTHORED, NOT DRAWN FROM AN RNG, and the phases are the reason.
   The total amplitude is 0.080, so the boundary can lose 8% of its
   radius at an unlucky bearing - and there is exactly one bearing
   in this level where that is not allowed to happen. The layout
   fixes the Basecamp at x = 0, so the arrival frame always looks
   along theta = pi/2, and the phases below put the harmonic factor
   there at 0.998. A random draw would have been right about
   eleven times in twelve and would have veiled the level's opening
   image the twelfth. */
const CLEAR_HARMONICS = [
  { k: 2, a: 0.030, p: 0.61 },
  { k: 3, a: 0.024, p: 2.44 },
  { k: 5, a: 0.016, p: 4.12 },
  { k: 9, a: 0.010, p: 5.37 },
];

/* The halo's radius. It is CENTRED ON THE CAMERA, so this number
   buys no parallax and sets exactly two things: how much aerial
   perspective the arc collects, and what occludes it.

   Worked through at alpenglow (fogDensity 0.00058, falloff
   0.0165, fade 0.85), with f = 1 - exp(-(d*density)^1.62 * hFac)
   and hFac = exp(-(baseY - 2) * falloff):

     summit camera, y = 452, arc above it   ->  hFac 0.0006,
       f = 0.001. The halo is CRISP where the air is thin.
     basecamp camera, y = 14, arc near the horizon -> hFac 0.85,
       f = 0.92, and times the 0.85 fade the arc keeps 22% of its
       brightness. It dissolves into the valley haze rather than
       ending at a ridge.

   That gradient is the entire argument for building this as
   geometry, and it only works because R is small enough for the
   height term to dominate the distance term. At sky.js's 6200 the
   distance term saturates everywhere and the arc is uniformly
   grey. 3400 also keeps it outside the terrain (map diagonal
   1448) so ridges occlude it honestly, and well inside the far
   plane with the camera 1010 off origin. */
const HALO_R = 3400;
/* THE FADE, RE-CUT AGAINST A MEASUREMENT rather than against the
   arithmetic above it.

   `fade` is `uRim.z`, and on the additive path it multiplies the
   haze fraction: the arc keeps `1 - f * fade` of its brightness
   (art.js's ATMOS_FRAG_ADDITIVE). At 0.85 the numbers worked out
   to 22% surviving at the basecamp, and 22% of a peak vertex that
   is 0.09 linear, added to a horizon sky already sitting near 0.5,
   is 4% - which is not "dissolved into the valley haze", it is
   gone. Photographed at the gate: no ring at all, on a frame whose
   `status().halo.ring` reported 1.0.

   0.62 keeps 47% instead of 22% and leaves the summit end
   untouched (f is 0.001 up there, so any fade multiplies nothing).
   The gradient the geometry exists for - crisp in thin air,
   dissolving toward the valley - is what changes; the direction of
   it does not.

   THE CLEARING IS WHY THIS IS NOW HONEST. Before the deck had a
   hole in it the gate stood under six sheets of stratus, where a
   22-degree halo would be a lie whatever its brightness. It now
   stands in clear air with cirrus overhead, which is exactly the
   condition that makes one. */
const HALO_FADE = 0.62;

/* Inner edge sharp and red, outer edge soft and blue. That is the
   actual dispersion of a 22-degree halo and it is the only thing
   that separates it on sight from a lens artefact - a
   monochrome ring reads as a dirty filter. */
const HALO_RAMP = makeRamp([
  [0.00, "#ff8f4a"],
  [0.22, "#ffbd82"],
  [0.48, "#ffe8cd"],
  [0.74, "#e6eefc"],
  [1.00, "#a9c4f2"],
]);

/* ============================================================ */

export function buildSummitSky(ctx) {
  const { THREE, scene, atmos } = ctx;
  const group = new THREE.Group();
  group.name = "sky";
  group.renderOrder = -1000;
  scene.add(group);

  /* ------------------------------ dome ------------------------------ */

  const domeUniforms = {
    uSunDir: atmos.uniforms.uSunDir,
    uSunHalo: atmos.uniforms.uSunHalo,
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uSkyZenith: atmos.uniforms.uSkyZenith,
    uSkyHigh: atmos.uniforms.uSkyHigh,
    uSkyHorizon: atmos.uniforms.uSkyHorizon,
    uSkyLow: atmos.uniforms.uSkyLow,
    uFog: atmos.uniforms.uFog,
    uTimeSF: atmos.uniforms.uTimeSF,
    uCelestial: { value: new THREE.Vector4(1, 0, 0, 0) },
    /* Smaller than Vesper's 0.0016. Kenosis's primary is further
       out and the thin air does not smear it; a fat disc on a
       navy zenith is what a hazy world looks like. */
    uSunSize: { value: 0.0013 },
    uStars: { value: 0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    uniforms: domeUniforms,
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,   // the composite pass owns tone mapping
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  group.add(dome);

  /* ------------------------------ the two lights ------------------------------ */

  /* EXACTLY TWO, both parented here at build. A light that joins
     the scene later recompiles every lit program in it - a
     measured 198ms freeze, and on this level it would land while
     the player is walking. Anything wanted at runtime has to
     exist from frame zero at intensity 0; nothing here needs
     that, because both of these are always on. */

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.name = "kenosis-key";
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  /* 420 rather than sky.js's 300. The summit is a 452m peak with
     a 62m spire on it and the shadow box has to hold the thing
     casting as well as the ground receiving. summit-main
     overrides this per quality tier immediately after every
     `render.setQuality`, because setQuality re-applies the tier
     default unconditionally (render.js:1863) - this is only the
     value the first four warm-up frames see. */
  /* THE SPAN IS A MOUNTAIN'S, NOT A BASIN'S.

     At 420m - a sensible number, and Vesper's own order of
     magnitude - the shadow camera covers a disc around the player
     and nothing else, so from the basecamp gate the peak 854m away
     casts NOTHING. Measured on the first arrival capture: turning
     the weather and the fog off changed the frame's standard
     deviation by two, because the flatness was never haze. It was a
     452m mountain with no shadow structure on it at all.

     900m is what covers the ascent from any station's own arena,
     and the cost is real and stated: at a 2048 map that is 0.88m
     per texel against 0.41, so contact shadows under a prop soften
     by about a texel. On this level that trade is obviously right -
     the large-scale form of the mountain IS the level, and a
     softened contact under a cairn is not. */
  const shadowHalf = 900;
  sun.shadow.camera.left = -shadowHalf;
  sun.shadow.camera.right = shadowHalf;
  sun.shadow.camera.top = shadowHalf;
  sun.shadow.camera.bottom = -shadowHalf;
  /* `far` and both biases are derived, not authored - see
     `setShadowRadius` and `applyShadowBias`, which run once
     before this builder returns. */
  scene.add(sun);
  scene.add(sun.target);

  /* Dynamic diffuse fill. The sharp/specular part of the sky
     stays on the PMREM baked at boot; this zero-shadow light
     carries the slowly changing sky and ground colours without
     regenerating that texture during play. It matters more here
     than on Vesper: on a snowfield the fill IS most of the light
     on any surface the key is not hitting, and it is the whole of
     the light under the inversion. */
  const skyFill = new THREE.HemisphereLight(0xffffff, 0x2c3f66, 0);
  skyFill.name = "kenosis-cycle-fill";
  scene.add(skyFill);

  /** How far under the world the camera is, 0..1. Owned by
   *  whatever opens a moulin or the cathedral undercroft, and
   *  read once a frame below. A scalar rather than a boolean
   *  because a hard switch on the frame the daylight goes away is
   *  a flash, not a descent. */
  let subterranean = 0;
  const UNDERGROUND_FILL = new THREE.Color(0x1f2c46);
  /** The overcast base colour a camera under the deck is lit by. */
  const OVERCAST_FILL = new THREE.Color(0x93a6c2);
  const OVERCAST_GROUND = new THREE.Color(0x7f92ad);

  /* ============================================================
     THE INVERSION DECK AND THE CIRRUS
     ============================================================ */

  const cloudMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    /* DOUBLE-SIDED AND TRANSPARENT IS TWO DRAW PASSES UNLESS YOU
       SAY OTHERWISE, and that default costs this level more than
       anywhere else in the game.

       Since r151 three renders a double-sided transparent object
       twice - back faces, then front faces - so the depth order
       within one object is right for a volume. Measured on the
       probe build it does exactly that: TWO programs per
       material (flipSided true and false) and two draws of every
       triangle. These sheets are flat, unlit and vertex-coloured,
       so the two passes are pixel-identical and the second one is
       pure overdraw - on the one object in the level that can
       cover the whole frame, on a frame that is already
       fill-bound.

       `forceSinglePass` takes it back to one pass and one
       program. The thing it gives up - correct internal depth
       sorting - this object never had: it is one merged mesh, so
       three sorts it once as a whole and the sheets composite in
       index order regardless. See the ORDER MATTERS note in
       buildClouds. */
    forceSinglePass: true,
  });
  cloudMat.name = "sf-inversion";
  /* No customProgramCacheKey. Material's own default returns
     `onBeforeCompile.toString()`, and this closure is unique in
     the process, so this material cannot collide with another
     unpatched basic material the way two `patchBasicMaterial`
     calls with the same fade would. */
  cloudMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTimeSF = atmos.uniforms.uTimeSF;
    shader.uniforms.uWind = atmos.uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${CLOUD_VERT_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${CLOUD_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CLOUD_FRAG_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${CLOUD_FRAG}`);
  };

  const clouds = new THREE.Group();
  clouds.name = "clouds";
  /* Parented at the origin and left there. See CLOUD_VERT: the
     shoreline is authored against the mountain, so this group
     cannot ride the camera the way sky.js's shelves do. */
  group.add(clouds);

  let cloudMesh = null;
  /* Retained per-vertex build data, because the repaint has to
     reproduce the same tone from a different sun without the
     geometry. `tone` is height in the stack (0 lowest sheet, 1
     cirrus); `sky` is how far a vertex is blended into the
     horizon colour. Both are baked once. */
  let cloudTone = null;
  let cloudSky = null;
  let cloudTris = 0;

  const shoreRng = makeRng(0x5c0a57);
  /* FOUR HARMONICS, AND THEY MUST BE INTEGERS. The shoreline is a
     function on a closed loop; a non-integer wavenumber does not
     come back to where it started and the sea tears open along
     theta = 0 with a radial step tens of metres wide. (The
     opposite rule to a procedural lattice in the plane, where
     irrational ratios are what stop a pattern repeating - it is
     the same argument, applied to a domain that is periodic
     rather than infinite.) */
  const SHORE_HARMONICS = [
    { k: 3, a: 0.052, p: shoreRng() * TAU },
    { k: 5, a: 0.038, p: shoreRng() * TAU },
    { k: 8, a: 0.026, p: shoreRng() * TAU },
    { k: 13, a: 0.016, p: shoreRng() * TAU },
  ];

  /** The shoreline radius of a sheet whose flat shore sits at
   *  `base`, at bearing `theta`. */
  function shoreAt(base, theta) {
    let w = 1;
    for (const h of SHORE_HARMONICS) w += h.a * Math.sin(h.k * theta + h.p);
    return base * w;
  }

  /* Baked once per sheet so the runtime `coverAt` and the build
     agree exactly, and so the bisection does not run per frame. */
  const layerShore = DECK_LAYERS.map((l) => shoreRadiusFor(l.y));

  /* ------------------------------ the clearing ------------------------------ */

  /* THE LEE DIRECTION IS READ FROM THE ATMOSPHERE, not typed in.

     `atmos.windDir` is the direction the air MOVES (summit-art's
     SUMMIT_WIND.toward, applied by `applySummitWind` at summit-main
     step 1, four steps before this builder runs), and it is the
     same Vector2 that `sync()` copies into `uWind` - which is the
     uniform CLOUD_VERT reads to drive the deck's flow. So the
     clearing is displaced along exactly the axis the sheets are
     seen sliding along, by construction rather than by two
     constants agreeing. A second copy of the bearing here would
     drift the day someone re-authors the wind, and the symptom
     would be a hole in the sea that is not in the lee of anything.

     Fallback to the layout's own vector if an atmosphere ever
     arrives without one: a zero-length wind would make `leeX/leeZ`
     NaN and every vertex in the deck would follow. */
  const windLen = Math.hypot(atmos.windDir?.x || 0, atmos.windDir?.y || 0);
  const leeX = windLen > 1e-4 ? atmos.windDir.x / windLen : 0.9272;
  const leeZ = windLen > 1e-4 ? atmos.windDir.y / windLen : 0.3746;

  /** The lee bearing in `atan2(z, x)` terms, which is the same
   *  convention `shoreAt` and `coverAt` use. */
  const leeTheta = Math.atan2(leeZ, leeX);

  /** The clearing's boundary radius at bearing `theta`, in metres.
   *  A cosine lobe about the lee bearing, wobbled by four integer
   *  harmonics, and bounded by the edge of the world - see THE
   *  CLEARING for why each of those three terms is there. */
  function clearingAt(theta) {
    let w = 1;
    for (const h of CLEAR_HARMONICS) w += h.a * Math.sin(h.k * theta + h.p);
    const lobe = CLEAR_BASE + CLEAR_SHEAR * Math.cos(theta - leeTheta);
    /* The `max(0, …)` is not reachable at the authored constants -
       the upwind extreme is 79 m - and it is here because the
       moment `shear` exceeds `base` the lobe goes negative on the
       upwind arc, and a negative inner radius does not fail: it
       silently makes `innerAt` return the contour and the clearing
       stops existing on half the map with nothing to see in any
       log. */
    return Math.min(Math.max(0, lobe * w), MAP_HALF);
  }

  /** Where sheet `index` actually begins at bearing `theta`: its
   *  own contour shore, moved `hole` of the way out to the
   *  clearing. `Math.max` rather than a plain lerp because the
   *  clearing is only ever allowed to PUSH the sea back - upwind,
   *  and anywhere a re-authored profile puts the mountain further
   *  out than the disc, the mountain wins and the sea laps its
   *  flank exactly as it did before. That is also what keeps this
   *  robust to the profile table drifting: the clearing is
   *  authored in map coordinates and owes the elevation table
   *  nothing.
   *
   *  ONE FUNCTION, TWO READERS - `buildDeckLayer` and `coverAt`.
   *  They have to agree to the metre or the lights say you are
   *  under cloud in a frame that plainly shows blue sky. */
  function innerAt(index, theta) {
    const layer = DECK_LAYERS[index];
    const contour = shoreAt(layerShore[index], theta);
    const clearing = clearingAt(theta);
    const inner = contour + Math.max(0, clearing - contour) * layer.hole;
    /* The floor sheet's screening cap. `Math.max(contour, …)` on
       the ceiling as well, so that if a future profile ever puts
       the mountain's own contour outside the cap the sheet is
       pinned to the mountain rather than dragged inside it and
       drawn across the flank. */
    if (layer.cap) return Math.min(inner, Math.max(contour, FLOOR_SHORE_CAP));
    return inner;
  }

  /* Baked once, for `status()`. The audit harness has to be able to
     assert that the deck has a hole in it and how big it is, and a
     status call is made every frame by some probes - sampling a
     transcendental 360 times per read is a cost with no reader. */
  const clearingStats = (() => {
    const SAMPLES = 360;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let s = 0; s < SAMPLES; s += 1) {
      const v = clearingAt((s / SAMPLES) * TAU);
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return {
      min: Number(min.toFixed(1)),
      max: Number(max.toFixed(1)),
      mean: Number((sum / SAMPLES).toFixed(1)),
    };
  })();

  /* The sea's static relief. Three trains with incommensurate
     wavelengths - this one IS a lattice in the plane, so the
     ratios have to be irrational or the swells line up into a
     grid at the scale where the player looks down on it. Decays
     out to nothing by 3400m so the far field is flat and the
     horizon merge below has a clean line to work with. */
  function billowAt(x, z, r) {
    const a = Math.sin(x / 431.7 + z / 613.9)
      + Math.sin(x / 197.3 - z / 271.1) * 0.62
      + Math.sin((x + z) / 89.7) * 0.28;
    return (a / 1.9) * (1 - sstep(1200, 3400, r));
  }

  /* THE FAR SEA IS TEXTURED IN TONE, NOT IN GEOMETRY, and the two
     halves of that sentence are both deliberate.

     The billow above is switched off past 3400m so the deck's far
     rim stays a dead-flat plate: the horizon merge below depends
     on the rim being a clean line, and a swell out there would
     put a wobble on the one edge in the level that has nothing to
     hide behind. But 3400m is a fifth of the deck by radius and a
     twentieth by area, so switching the RELIEF off there as well
     is what the first pass did, and it measured and looked like
     exactly that: a mottled apron in the middle distance and a
     grey plate everywhere else.

     A cloud sea at five kilometres has no resolvable relief and
     plenty of tonal variation - thicker and thinner cloud, not
     hills. So this is a second field folded into the form scalar
     the repaint mixes with, and it fades to a floor of 0.42
     rather than to zero. Costs nothing: it is baked into a
     Float32Array that already exists. */
  function mottleAt(x, z, r) {
    const a = Math.sin(x / 1409.3 + z / 977.1 + 1.7)
      + Math.sin(x / 611.7 - z / 823.9 - 0.9) * 0.70
      + Math.sin((x * 0.6 + z) / 337.1 + 2.3) * 0.38;
    return (a / 2.08) * (0.42 + 0.58 * (1 - sstep(1200, 5200, r)));
  }

  function buildDeckLayer(layer, index) {
    const pos = [];
    const nrm = [];
    const swell = [];
    const alpha = [];
    const tone = [];
    const skyMix = [];
    const idx = [];
    const seg = layer.seg;
    const rings = layer.rings;

    for (let s = 0; s <= seg; s += 1) {
      /* The seam column is DUPLICATED rather than index-wrapped,
         and it is evaluated at theta = 0 EXACTLY rather than at
         TAU, so its positions and its alphas are bit identical
         to column 0 and the ring cannot open a hairline crack at
         one bearing. Its normals are not identical - each of the
         two columns averages only the faces on its own side - but
         on a sheet this flat that is a fraction of a degree, and
         it is the cheap half of the trade. */
      const theta = (s % seg) / seg * TAU;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const shore = innerAt(index, theta);
      for (let i = 0; i < rings; i += 1) {
        const t = i / (rings - 1);
        /* Geometric rather than linear: the shoreline is where
           the detail is and the far field is a flat plate. */
        const r = shore + (layer.r - shore) * Math.pow(t, 2.6);
        const x = ct * r;
        const z = st * r;
        const bill = billowAt(x, z, r) * layer.bill;
        pos.push(x, layer.y + bill, z);
        nrm.push(0, 1, 0);   // replaced by computeVertexNormals below

        /* Alpha. Three terms, all of them load-bearing:
             - the lapping feather off the shore;
             - holes where the sea sinks, so the summit can see
               through the deck to the valley in places, which is
               what stops it reading as a painted plate;
             - the far rim ramping to opaque, which is job (a) and
               (b) in the header. */
        const lap = sstep(0, SHORE_FEATHER, r - shore);
        const sink = clamp01(-bill / Math.max(1e-3, layer.bill) * 1.4);
        let a = layer.alpha * lap * (1 - 0.72 * sink);
        const rim = sstep(2600, 6800, r);
        a = lerp(a, 1, rim);
        alpha.push(a);

        /* Swell amplitude goes to zero at the far rim. A moving
           horizon line is a moving seam with the dome, and that
           seam is invisible only while it is exactly horizontal. */
        swell.push(layer.swell * (1 - rim));
        /* `tone` carries TWO things: where this sheet sits in the
           stack, which is what makes the lower sheets read as
           undersides, and the sea's own large-scale thick/thin
           variation. They are summed rather than kept apart
           because the repaint only ever uses their sum, and a
           third parallel array is a third thing to keep aligned
           through a merge. */
        const mottle = mottleAt(x, z, r) * 0.17 * (0.35 + 0.65 * layer.tone);
        tone.push(clamp01(layer.tone + mottle));
        skyMix.push(rim);
      }
    }

    for (let s = 0; s < seg; s += 1) {
      for (let i = 0; i < rings - 1; i += 1) {
        const a = s * rings + i;
        const b = (s + 1) * rings + i;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("aSwell", new THREE.Float32BufferAttribute(swell, 1));
    g.setIndex(idx);
    /* Real normals from the baked billow. The repaint reads them
       to bake the sun in, so a sea of (0,1,0) would light as one
       flat value and the swells would vanish the moment the sun
       moved off vertical - which on this level it always is. */
    g.computeVertexNormals();

    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 4);
    for (let v = 0; v < count; v += 1) colors[v * 4 + 3] = alpha[v];
    g.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    return { geometry: g, tone, skyMix };
  }

  /* ============================================================
     HIGH CIRRUS

     Lifted from sky.js:640-760 with its findings intact, because
     they are geometric facts rather than Vesper's taste:

       - a deck at ONE altitude with log-uniform horizontal
         distance, not a shell at fixed radius. Elevation then
         falls out of the geometry, which is what a real cirrus
         field does;
       - size each band by the angle it should SUBTEND and divide
         its width by sin(elevation), or a 100m filament at 4km
         draws a hairline;
       - three vertices per cross-section so alpha reaches zero at
         each edge, and an ASYMMETRIC head-and-tail profile. Both
         are structural: a symmetric opaque strip reads as flying
         wreckage, not as a mare's tail;
       - normals forced UPWARD. A thin ice sheet seen from
         underneath is bright, and a geometric downward normal
         bakes at the shadow end of the ramp and hangs there as a
         dark smear.

     THE DEFECT THE SECOND PASS FIXED, and it was not "there is no
     cirrus" - there were 26 bands and they rendered. It was that
     they were all ABOVE THE FRAME. `ground` was drawn log-uniform
     over [1500, 4500] against an altitude of [2600, 4200], which
     puts every band between 30 and 70 degrees of elevation. A
     level-eye or near-level frame - which is every frame in this
     level except the ones looking straight up - sees from about
     -3 to +30 degrees, so the whole field sat off the top of the
     picture. Measured on `summit-parvis`: two wisps clipped by
     the top edge, and an empty gradient everywhere else.

     Three changes, and only the third is a taste call.

     (1) `ground` runs to 7500 rather than 4500, which brings the
         low end of the elevation spread from 30 degrees down to
         16. That is not merely a wider range: for a flat deck with
         log-uniform radius the per-solid-angle band density is
         proportional to dist^3 / (r^2 * A), which is U-shaped with
         its MINIMUM at r = A - so the bands the old range was
         throwing away were the ones nearest the horizon, which is
         precisely where a frame has room for them.

     (2) The far-plane budget is now MEASURED PER BAND rather than
         estimated once in a comment. The old note quoted a worst
         case of 9752 against a far plane of 11000 and that
         arithmetic only held for the old ranges; a band near the
         horizon has its width divided by sin(elevation), so at 19
         degrees it is three times wider than the same band
         overhead and the estimate breaks. So: build the band in
         local coordinates, take its true bounding radius, and if
         `dist + radius` will not fit, scale the geometry AND the
         placement by the same factor. Scaling both leaves every
         subtended angle and the elevation untouched - the band is
         identical on screen and merely nearer - which is the whole
         reason this file sizes by angle in the first place. The
         cost is parallax: a band pulled in to 4 km shifts about
         half a degree over the 452 m climb, against zero for one
         at 8. That is below the resolution of anything in the
         level and it is the price of never clipping. Measured on
         the shipping seed: the worst band took a 0.93 scale, so
         the clamp is engaging and engaging gently.

     (3) 46 bands rather than 26. The count is a fill cost on the
         transparent pass and zero draw calls, and 26 over 4pi
         steradians put roughly two in a 55-degree frame.
     ============================================================ */

  /* How far a cirrus vertex may sit from the ORIGIN. The camera
     roams to 1010 m in plan and 452 m in height, so hypot(1010,
     452) = 1106 m of that budget belongs to the camera; 11000 -
     1106 leaves 9894 and 9450 keeps 444 m of margin under the far
     plane for a band that is a little larger than its bounding
     radius suggests along one diagonal. */
  const CIRRUS_REACH = 9450;
  /* 46 bands. Zero draw calls - they merge into the deck's mesh -
     and about 24k triangles of thin alpha on the transparent pass.
     The ceiling is fill, not geometry, and the frame is fill-bound,
     so a further increase needs the post harness's numbers rather
     than an opinion. */
  const CIRRUS_BANDS = 46;
  /** Worst per-band placement scale the reach clamp applied. 1
   *  means nothing was clamped. Reported through `status()` so a
   *  future widening of the ranges shows up as a number rather
   *  than as bands quietly collapsing toward the camera. */
  let cirrusWorstFit = 1;

  function buildCirrusBand(rng) {
    const alt = rng.range(2200, 4400);
    const ground = 1000 * Math.pow(7.5, rng());
    const az = rng() * TAU;
    const dist = Math.hypot(ground, alt);
    const sinEl = Math.max(0.20, alt / dist);

    const pos = [];
    const idx = [];
    const nrm = [];
    const alpha = [];
    const filaments = rng.int(5, 10);
    const bandLen = (12 + rng() * 24) * Math.PI / 180 * dist;
    /* Half-width in DEGREES of subtended angle. A filament ends
       up at roughly 0.2x the band half-width once its own
       fraction and its taper apply, so 1 degree draws a 3-pixel
       thread at 1600x900; 3 to 7 puts it at 25-60 pixels, which
       is a cloud. */
    const bandHW = (3.0 + rng() * 4.0) * Math.PI / 180 * dist / sinEl;
    /* Raised from [0.34, 0.62]. The old top end was a band you had
       to go looking for; against a navy zenith and a peach horizon
       band a mare's tail at 0.4 is still translucent enough to see
       the gradient through, which is the only thing the ceiling
       here protects. */
    const bandAlpha = rng.range(0.40, 0.70);
    for (let f = 0; f < filaments; f += 1) {
      const segs = rng.int(9, 15);
      const len = bandLen * rng.range(0.55, 1.0);
      const x0 = rng.gauss() * bandLen * 0.16;
      const z0 = rng.gauss() * bandHW * 0.85;
      const shear = rng.range(0.10, 0.34);
      const hw = bandHW * rng.range(0.34, 0.72);
      const base = pos.length / 3;
      for (let s = 0; s <= segs; s += 1) {
        const t = s / segs;
        const head = smoothstep(clamp01(t / 0.16));
        const taper = head * Math.pow(1 - t, 1.5);
        const w = hw * taper * (0.72 + 0.28 * Math.sin(t * 9.1 + f));
        const px = x0 + (t - 0.5) * len;
        const pz = z0 + (t - 0.5) * len * shear
          + Math.sin(t * 2.3 + f * 1.7) * bandHW * 0.35;
        const py = Math.sin(t * 1.9 + f) * 26;
        const tilt = 0.30 * Math.sin(t * 5.3 + f * 2.1);
        const nl = Math.hypot(tilt, 1, tilt * 0.6);
        const nx = tilt / nl; const ny = 1 / nl; const nz = tilt * 0.6 / nl;
        const a = bandAlpha * taper * (0.55 + 0.45 * Math.sin(t * 6.7 + f * 2.9));
        nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        alpha.push(0, a, 0);
        pos.push(px, py, pz - w);
        pos.push(px, py, pz);
        pos.push(px, py, pz + w);
      }
      for (let s = 0; s < segs; s += 1) {
        const b = base + s * 3;
        const n2 = b + 3;
        idx.push(b, b + 1, n2 + 1, b, n2 + 1, n2);
        idx.push(b + 1, b + 2, n2 + 2, b + 1, n2 + 2, n2 + 1);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    const count = g.attributes.position.count;
    /* Cirrus rides the same swell field at a token amplitude.
       Written explicitly rather than left to mergeGeometries'
       zero padding (sky.js:1031) - the padding would give the
       right answer here by accident, and an attribute that only
       works because of what a merge does to a missing name is a
       trap for whoever adds the next band type. */
    const swell = new Float32Array(count).fill(0.8);
    g.setAttribute("aSwell", new THREE.BufferAttribute(swell, 1));
    const colors = new Float32Array(count * 4);
    for (let v = 0; v < count; v += 1) colors[v * 4 + 3] = alpha[v];
    g.setAttribute("color", new THREE.BufferAttribute(colors, 4));

    /* THE REACH CLAMP. `ext` is the band's true bounding radius in
       its own frame, taken from the vertices rather than estimated
       from bandLen and bandHW - the gaussian offsets on x0 and z0
       have no bound worth quoting, and an estimate that is right
       for the current ranges is an estimate that fails silently
       when someone widens them.

       `fit` scales the geometry and the placement TOGETHER, which
       is what leaves the picture alone: a band twice as near and
       half as large subtends the same angle, sits at the same
       elevation and is lit the same way, because nothing in the
       cirrus path is authored in metres. Without it a horizon band
       - width divided by sin(19 degrees) - reaches past the far
       plane and is sliced clean through by it, which is the exact
       failure the sky-cirrus note records as "a band sliced at
       12.5 km". */
    let ext = 0;
    for (let v = 0; v < pos.length; v += 3) {
      const d2 = pos[v] * pos[v] + pos[v + 1] * pos[v + 1] + pos[v + 2] * pos[v + 2];
      if (d2 > ext) ext = d2;
    }
    ext = Math.sqrt(ext);
    const fit = Math.min(1, CIRRUS_REACH / Math.max(1, dist + ext));
    if (fit < cirrusWorstFit) cirrusWorstFit = fit;

    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(az) * ground * fit, alt * fit, Math.sin(az) * ground * fit),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * TAU, 0)),
      new THREE.Vector3(fit, fit, fit)
    ));
    return { geometry: g, count };
  }

  function buildClouds() {
    if (cloudMesh) {
      clouds.remove(cloudMesh);
      cloudMesh.geometry.dispose();
      cloudMesh = null;
    }
    const rng = makeRng(0x1cef05);
    const geoms = [];
    const tones = [];
    const skies = [];

    /* ORDER MATTERS, and only a little - which is the point.
       Everything in one mesh is one transparent object, so
       three sorts it once by its bounding sphere and the sheets
       composite in INDEX order rather than depth order. The
       ordering below (cirrus first, then the deck bottom to top)
       is back-to-front for the shot this level is built around:
       the summit looking down on the sea. From inside the valley
       it is exactly backwards - and it does not matter there,
       because blending N sheets of the SAME colour is
       order-independent, and these sheets are deliberately kept
       within one narrow tonal range for that reason. Give the
       bottom sheet a strongly different hue from the top one and
       this comment becomes a bug report. */
    /* Reset before the loop, not at declaration: `buildClouds` can
       run again, and a worst-fit carried over from a previous
       build would report a clamp that this geometry never took. */
    cirrusWorstFit = 1;
    for (let i = 0; i < CIRRUS_BANDS; i += 1) {
      const band = buildCirrusBand(rng);
      geoms.push(band.geometry);
      const t = new Float32Array(band.count).fill(1);
      tones.push(t);
      skies.push(new Float32Array(band.count));
    }
    for (let i = DECK_LAYERS.length - 1; i >= 0; i -= 1) {
      const built = buildDeckLayer(DECK_LAYERS[i], i);
      geoms.push(built.geometry);
      tones.push(Float32Array.from(built.tone));
      skies.push(Float32Array.from(built.skyMix));
    }

    const merged = mergeGeometries(THREE, geoms);
    let total = 0;
    for (const t of tones) total += t.length;
    cloudTone = new Float32Array(total);
    cloudSky = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < tones.length; i += 1) {
      cloudTone.set(tones[i], off);
      cloudSky.set(skies[i], off);
      off += tones[i].length;
    }

    cloudMesh = new THREE.Mesh(merged, cloudMat);
    cloudMesh.name = "inversion";
    /* Never culled, and the bounding sphere spans 17km, so a
       cull test would only ever be a wasted one. */
    cloudMesh.frustumCulled = false;
    cloudTris = merged.index ? merged.index.count / 3 : 0;
    clouds.add(cloudMesh);
    repaintClouds();
  }

  /* Scratch, so the repaint allocates nothing. */
  const litRgb = [0, 0, 0];
  const shadeRgb = [0, 0, 0];
  const skyRgb = [0, 0, 0];
  const warmRgb = [0, 0, 0];
  const haloTintRgb = [0, 0, 0];
  const tmpRgb = [0, 0, 0];
  const toSrgb = (color, out) => {
    out[0] = linearToSrgb(color.r);
    out[1] = linearToSrgb(color.g);
    out[2] = linearToSrgb(color.b);
    return out;
  };

  /** The geometry never changes with the hour, only the light
   *  across it. Repainting one colour buffer avoids rebuilding a
   *  seventeen-thousand-triangle deck every few seconds as the
   *  sun moves.
   *
   *  Unlike sky.js's, the endpoints are taken FROM THE
   *  ATMOSPHERE rather than from a hand table. Kenosis has five
   *  presets against Vesper's five, and a hand-authored lit/shade
   *  pair per preset is five more numbers to keep in step with
   *  SUMMIT_TIMES - which they would not stay in. The atmosphere
   *  colours are linear; the mix below is done in sRGB and
   *  transferred back on write, matching every other painter in
   *  the project. */
  function repaintClouds() {
    if (!cloudMesh) return;
    const geometry = cloudMesh.geometry;
    const normal = geometry.attributes.normal;
    const colors = geometry.attributes.color;
    if (!normal || !colors || !cloudTone) return;
    const night = clamp01(atmos.nightFactor);
    const storm = clamp01(atmos.storm);

    /* THE TWO ENDS OF THE DECK, and both are derived rather than
       authored - see the note above.

       LIT: the key's own colour, pulled a quarter of the way into
       the horizon band it is sitting in. `sunHalo` was the
       obvious source and is the wrong one: it is a near-white
       (#fff0dc at alpenglow) because its job in sfSky is to be
       ADDED, so a deck painted from it came out a neutral pale
       grey under a peach sky - the level's own rule about lit
       snow being peach, broken on the largest surface in frame.
       `sunColor` plus a bite of `skyHorizon` gives the peach for
       free and gives noon a cool white and blue hour a lilac,
       with no per-preset table to drift.

       SHADE: the high sky, DESATURATED and dragged down. Straight
       sky-high is a saturated blue at alpenglow, and a stratus
       base painted with it reads violet - which is the exact
       inheritance mistake summit-art's grades exist to avoid, one
       surface further out. Cloud is grey; it is the SNOW that
       gets to be saturated blue in shadow. */
    toSrgb(atmos.sunColor, litRgb);
    toSrgb(atmos.skyHorizon, warmRgb);
    toSrgb(atmos.skyHigh, shadeRgb);
    toSrgb(atmos.skyHorizon, skyRgb);
    const shadeLuma = shadeRgb[0] * 0.2126 + shadeRgb[1] * 0.7152 + shadeRgb[2] * 0.0722;
    for (let i = 0; i < 3; i += 1) {
      litRgb[i] = clamp01(lerp(lerp(litRgb[i], warmRgb[i], 0.28), 1, 0.20)
        * lerp(1, 0.32, night));
      shadeRgb[i] = clamp01(lerp(shadeRgb[i], shadeLuma, 0.45)
        * lerp(0.52, 0.30, night));
    }
    /* One nudge back toward blue, and only one. A cloud base is
       grey-BLUE, not grey - but 1.16 put the violet straight back. */
    shadeRgb[2] = clamp01(shadeRgb[2] * 1.08);
    /* In a whiteout there is no top and no underside - see
       SUMMIT_TIMES.storm, which removes the world at 5m. Collapse
       the two ends together rather than special-casing the paint. */
    for (let i = 0; i < 3; i += 1) {
      const flat = lerp(shadeRgb[i], litRgb[i], 0.5);
      litRgb[i] = lerp(litRgb[i], flat, storm * 0.85);
      shadeRgb[i] = lerp(shadeRgb[i], flat, storm * 0.85);
    }

    const sx = atmos.sunDir.x;
    const sy = atmos.sunDir.y;
    const sz = atmos.sunDir.z;
    for (let v = 0; v < normal.count; v += 1) {
      const nl = clamp01(
        (normal.getX(v) * sx + normal.getY(v) * sy + normal.getZ(v) * sz) * 0.5 + 0.5
      );
      const up = clamp01(normal.getY(v) * 0.5 + 0.5);
      /* THE GAIN ON `nl` IS THE WHOLE RELIEF OF THE SEA.

         Every sheet is horizontal, so its normals sit inside a
         few degrees of vertical and a raw n-dot-l spans about
         0.484 to 0.639 across the entire deck at a 7.2 degree
         sun - a fifteen-hundredth of the ramp. Painted straight,
         a cloud sea is one flat value with a faint mottle, which
         is what the first pass measured and looked like. The
         smoothstep remaps exactly that band onto 0.33 to 1.0, so
         the windward face of a swell and its lee read as
         different surfaces.

         `tone` is height in the stack and carries a third of the
         weight: without it every sheet lights identically and the
         deck has no depth from inside, when the lower sheets have
         to be visibly deeper in shadow because they are. */
      const shape = sstep(0.40, 0.62, nl);
      const t = clamp01(0.06 + shape * 0.30 + up * 0.10 + cloudTone[v] * 0.36);
      const c = mixRgb(shadeRgb, litRgb, Math.pow(t, 1.35));
      tmpRgb[0] = c[0]; tmpRgb[1] = c[1]; tmpRgb[2] = c[2];
      /* THE HORIZON MERGE. The far rim is painted to the sky's
         own horizon band, so where the sea ends at about -2.2
         degrees from the summit it meets the dome in the colour
         the dome is already painting there (sfSky at rd.y ~ -0.04
         resolves to 99.5% uSkyHorizon). It is the same trick that
         keeps the terrain's aerial perspective seamless, applied
         to the one edge in the level that cannot be hidden. */
      const m = cloudSky[v];
      if (m > 0) {
        tmpRgb[0] = lerp(tmpRgb[0], skyRgb[0], m);
        tmpRgb[1] = lerp(tmpRgb[1], skyRgb[1], m);
        tmpRgb[2] = lerp(tmpRgb[2], skyRgb[2], m);
      }
      /* setXYZ on a 4-component attribute leaves w alone, so the
         baked alpha survives every repaint. */
      colors.setXYZ(v, srgb(tmpRgb[0]), srgb(tmpRgb[1]), srgb(tmpRgb[2]));
    }
    colors.needsUpdate = true;
  }

  buildClouds();

  /* ------------------------------ the far ranges ------------------------------ */

  const ranges = new THREE.Group();
  ranges.name = "far-ranges";
  /* At the origin, like the deck and for the same reason: these
     stand on the world, so a camera that walks a kilometre across
     the map has to see them shift. That parallax is most of what
     sells them as land rather than as a painted backdrop, and it
     is free. */
  group.add(ranges);

  const rangeMat = new THREE.MeshBasicMaterial({
    vertexColors: true, toneMapped: true, side: THREE.FrontSide,
    /* Opaque, and it may write depth. Nothing in the level is ever
       behind them - the dome is depthTest:false at renderOrder
       -1000 - and the deck's sheets are depthWrite:false, so they
       still veil these correctly on the transparent pass. */
    depthWrite: true, fog: false,
  });
  rangeMat.name = "sf-far-ranges";

  let rangeMesh = null;
  let rangeHaze = null;   // 0 near, 1 lost in the murk
  let rangeUp = null;     // 0 at the base, 1 at the ridge
  let rangeAz = null;     // bearing, for the sun-side lift
  let rangeTris = 0;

  function buildFarRanges() {
    if (rangeMesh) {
      ranges.remove(rangeMesh);
      rangeMesh.geometry.dispose();
      rangeMesh = null;
    }
    const rng = makeRng(0xfa2e17);
    const geoms = [];
    const haze = [];
    const ups = [];
    const azs = [];

    for (let li = 0; li < FAR_RANGES.length; li += 1) {
      const layer = FAR_RANGES[li];
      /* Wavenumbers scale with radius so a PEAK stays the same
         number of metres wide: the same range twice as far away
         needs twice as many summits around its ring, or it reads
         as twice the mountain. Rounded to integers because a ring
         is a function on a circle - the same closed-loop rule the
         deck's shoreline harmonics are held to, and a fractional
         wavenumber tears the skyline open at theta = 0. */
      const kScale = layer.r / FAR_RANGES[0].r;
      const harm = [];
      let amp = 0;
      for (let o = 0; o < FAR_RANGE_OCT; o += 1) {
        const a = Math.pow(FAR_RANGE_GAIN, o);
        harm.push({
          k: Math.max(2, Math.round(FAR_RANGE_K0 * Math.pow(2, o) * kScale)),
          a,
          p: rng() * TAU,
        });
        amp += a;
      }
      const envA = { k: Math.max(2, Math.round(3 * kScale)), p: rng() * TAU };
      const envB = { k: Math.max(2, Math.round(5 * kScale)), p: rng() * TAU };

      const pos = [];
      const idx = [];
      const hz = [];
      const up = [];
      const az = [];
      for (let sgi = 0; sgi <= FAR_RANGE_SEG; sgi += 1) {
        const th = (sgi / FAR_RANGE_SEG) * TAU;
        /* AN ENVELOPE, NOT A MULTIFRACTAL.

           Added flat, the ridged octaves give every summit the same
           height and spacing - a comb of identical teeth across the
           frame, a texture rather than a range. The obvious fix is
           the standard ridged multifractal, weighting each octave
           by the one beneath it; measured, it compounds the
           amplitude away in three octaves and the skyline came back
           as a long low mesa with a stubble on top.

           So the octaves stay additive, and a separate LOW-frequency
           envelope decides where the range is high and where it
           drops to saddles. Two integer wavenumbers, scaled with the
           ring like everything else here, and phases of their own -
           so no two rings put their massifs at the same bearing and
           the near one's saddles are where the far ones show
           through. That is the layering. */
        let w = 0;
        for (const h of harm) w += h.a * (1 - Math.abs(Math.sin(h.k * th + h.p)));
        const e = 0.5 + 0.5 * (Math.sin(envA.k * th + envA.p) * 0.62
          + Math.sin(envB.k * th + envB.p) * 0.38);
        const shaped = clamp01(Math.pow(clamp01(w / amp), 1.25)
          * (0.30 + 0.70 * clamp01(e)));
        const crest = layer.crest + (shaped - 0.5) * layer.relief;
        const cx = Math.cos(th) * layer.r;
        const cz = Math.sin(th) * layer.r;
        pos.push(cx, FAR_RANGE_BASE, cz, cx, crest, cz);
        /* THE BASE HAS TO DISSOLVE, not stop. A curtain hazed
           evenly top to bottom ends on a hard horizontal line
           where it meets the cloud, and a straight edge under a
           jagged one reads as a cut-out. Losing the foot of every
           range in the murk is also just what aerial perspective
           does - the higher a thing is, the less air is in front
           of it. */
        hz.push(clamp01(layer.haze + 0.40), layer.haze);
        up.push(0, 1);
        az.push(th, th);
        if (sgi < FAR_RANGE_SEG) {
          /* WOUND TO FACE INWARD. The camera lives inside every one
             of these rings, so the front face has to point at the
             origin. Wound the other way the whole backdrop is
             back-facing and culls to nothing - the mesh is there,
             12,000 triangles of it, correctly coloured, and the
             frame is byte-identical with it hidden. */
          const b = sgi * 2;
          idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      geoms.push(g);
      haze.push(Float32Array.from(hz));
      ups.push(Float32Array.from(up));
      azs.push(Float32Array.from(az));
    }

    const merged = mergeGeometries(THREE, geoms);
    for (const g of geoms) g.dispose();
    const count = merged.attributes.position.count;
    rangeHaze = new Float32Array(count);
    rangeUp = new Float32Array(count);
    rangeAz = new Float32Array(count);
    let o = 0;
    for (let i = 0; i < haze.length; i += 1) {
      rangeHaze.set(haze[i], o);
      rangeUp.set(ups[i], o);
      rangeAz.set(azs[i], o);
      o += haze[i].length;
    }
    merged.setAttribute("color",
      new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    rangeTris = merged.index ? merged.index.count / 3 : 0;
    rangeMesh = new THREE.Mesh(merged, rangeMat);
    rangeMesh.name = "sf-far-ranges";
    rangeMesh.frustumCulled = false;
    /* Behind everything opaque in the level, so the terrain's own
       aerial perspective is composited over them rather than the
       other way round. */
    rangeMesh.renderOrder = -900;
    ranges.add(rangeMesh);
    repaintFarRanges();
  }

  /* The rock scratch, alongside the deck's. */
  const rockLit = [0, 0, 0];
  const rockShade = [0, 0, 0];

  /** Same contract as `repaintClouds`: the geometry is fixed and
   *  only the light across it changes, so an hour of the day is
   *  one colour buffer rather than a rebuild.
   *
   *  THE ROCK IS DERIVED FROM THE SKY, not tabulated. A hand-picked
   *  slate looks right at one preset and fights the grade at the
   *  other four - which is the mistake summit-art's own note about
   *  inherited colour describes. Taking both ends off `skyHigh` and
   *  `sunColor` gives alpenglow a warm sunward flank against a blue
   *  shadow side, noon a flat grey, and blue hour a lilac, for no
   *  table at all. */
  function repaintFarRanges() {
    if (!rangeMesh) return;
    const colors = rangeMesh.geometry.attributes.color;
    if (!colors || !rangeHaze) return;
    const night = clamp01(atmos.nightFactor);
    const storm = clamp01(atmos.storm);
    toSrgb(atmos.skyHigh, shadeRgb);
    toSrgb(atmos.sunColor, litRgb);
    toSrgb(atmos.skyHorizon, skyRgb);
    for (let i = 0; i < 3; i += 1) {
      rockShade[i] = clamp01(shadeRgb[i] * 0.34 * lerp(1, 0.34, night));
      rockLit[i] = clamp01(lerp(shadeRgb[i], litRgb[i], 0.45) * 0.62
        * lerp(1, 0.34, night));
    }
    /* Azimuth of the key, for the sunward flank. Only the bearing:
       these are silhouettes and have no surface normal worth the
       name, so the one lighting cue available is which side of the
       ring a vertex is on. */
    const sunAz = Math.atan2(atmos.sunDir.z, atmos.sunDir.x);
    for (let v = 0; v < colors.count; v += 1) {
      const lit = 0.5 + 0.5 * Math.cos(rangeAz[v] - sunAz);
      const t = Math.pow(lit, 1.4);
      tmpRgb[0] = lerp(rockShade[0], rockLit[0], t);
      tmpRgb[1] = lerp(rockShade[1], rockLit[1], t);
      tmpRgb[2] = lerp(rockShade[2], rockLit[2], t);
      /* A whiteout takes the far ranges first - see SUMMIT_TIMES.
         storm, which removes the world at 5 m. */
      const m = clamp01(rangeHaze[v] + storm * 0.7);
      tmpRgb[0] = lerp(tmpRgb[0], skyRgb[0], m);
      tmpRgb[1] = lerp(tmpRgb[1], skyRgb[1], m);
      tmpRgb[2] = lerp(tmpRgb[2], skyRgb[2], m);
      colors.setXYZ(v, srgb(tmpRgb[0]), srgb(tmpRgb[1]), srgb(tmpRgb[2]));
    }
    colors.needsUpdate = true;
  }

  buildFarRanges();

  /* ============================================================
     THE 22-DEGREE HALO AND THE SUN DOGS

     Built in a frame with the SUN AT +Z, local +X pointing along
     the horizontal away from the sun and local +Y along the
     sun's own vertical. `update` writes that basis into the
     group's matrix once a frame, which is what puts the dogs on
     the horizontal: they sit at local azimuth 0 and pi, i.e. on
     the +/-X axis, and +X is by construction normalize(cross(up,
     sunDir)) - horizontal for every sun elevation the level
     uses.

     Everything is on a sphere of radius HALO_R, so a vertex's
     local direction is just position/HALO_R and the repaint can
     recover it without a second buffer.
     ============================================================ */

  const HALO_RING_SEG = 180;
  /* alpha (degrees from the sun), brightness, band position for
     the hue ramp. The inner edge is SHARP - there is no light
     inside 22 degrees, which is the single most recognisable
     property of the real thing - and the outer falls away over
     four degrees. */
  const HALO_BAND = [
    { deg: 21.10, w: 0.00, t: 0.00 },
    { deg: 21.70, w: 1.00, t: 0.10 },
    { deg: 22.30, w: 0.86, t: 0.34 },
    { deg: 23.20, w: 0.52, t: 0.60 },
    { deg: 24.60, w: 0.22, t: 0.82 },
    { deg: 27.00, w: 0.00, t: 1.00 },
  ];

  const haloT = [];
  const haloW = [];
  const haloKind = [];   // 0 = ring, 1 = sun dog

  function haloVertex(pos, alphaDeg, phi, w, t, kind) {
    const a = alphaDeg * Math.PI / 180;
    const sa = Math.sin(a);
    pos.push(sa * Math.cos(phi) * HALO_R, sa * Math.sin(phi) * HALO_R,
      Math.cos(a) * HALO_R);
    haloT.push(t);
    haloW.push(w);
    haloKind.push(kind);
  }

  function buildHalo() {
    const halo = new THREE.Group();
    halo.name = "halo";
    const pos = [];
    const idx = [];

    /* --- the ring ------------------------------------------- */
    for (let s = 0; s <= HALO_RING_SEG; s += 1) {
      const phi = (s % HALO_RING_SEG) / HALO_RING_SEG * TAU;
      /* A real 22-degree halo is close to uniform, with the
         upper arc a little stronger. Left almost flat on purpose:
         the temptation is to sculpt brightness around the ring
         for composition, and a ring whose brightness varies by
         more than about 20% stops reading as an optical effect
         and starts reading as a painted arc. */
      const around = 0.86 + 0.14 * Math.sin(phi);
      for (const b of HALO_BAND) haloVertex(pos, b.deg, phi, b.w * around, b.t, 0);
    }
    const bandN = HALO_BAND.length;
    for (let s = 0; s < HALO_RING_SEG; s += 1) {
      for (let i = 0; i < bandN - 1; i += 1) {
        const a = s * bandN + i;
        const b = (s + 1) * bandN + i;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }

    /* --- the sun dogs --------------------------------------- */
    /* Two parhelia at the same 22 degrees, on the horizontal,
       one either side. Each is a bright core with a white tail
       drawn out AWAY from the sun along the horizontal - that
       tail is what makes a sun dog identifiable rather than a
       bright patch of ring, and it is the part that survives when
       the ring itself is too faint to see.

       A real parhelion sits on the parhelic circle, which is a
       circle of constant ELEVATION, so it separates from the 22
       degree ring as the sun climbs. It is drawn on the ring
       here because the level's default sun is at 7.2 degrees,
       where the two coincide to well under a degree - and by the
       elevation where they would visibly part, `dogGain` in the
       repaint has already faded them out. */
    const DOG_PHI = 3.6 * Math.PI / 180;   // half-width, radians
    const DOG_COLS = 11;
    const DOG_ROWS = [
      { deg: 21.00, w: 0.00, t: 0.00 },
      { deg: 21.60, w: 1.00, t: 0.06 },
      { deg: 22.20, w: 0.92, t: 0.26 },
      { deg: 23.20, w: 0.58, t: 0.52 },
      { deg: 25.00, w: 0.30, t: 0.74 },
      { deg: 28.00, w: 0.13, t: 0.90 },
      { deg: 31.50, w: 0.00, t: 1.00 },
    ];
    for (const side of [0, Math.PI]) {
      const start = pos.length / 3;
      for (let c = 0; c < DOG_COLS; c += 1) {
        const u = (c / (DOG_COLS - 1)) * 2 - 1;          // -1 .. 1 across
        const across = 1 - u * u;                         // parabolic, 0 at the edges
        const phi = side + u * DOG_PHI;
        for (const row of DOG_ROWS) haloVertex(pos, row.deg, phi, row.w * across, row.t, 1);
      }
      const rowN = DOG_ROWS.length;
      for (let c = 0; c < DOG_COLS - 1; c += 1) {
        for (let i = 0; i < rowN - 1; i += 1) {
          const a = start + c * rowN + i;
          const b = start + (c + 1) * rowN + i;
          idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.setAttribute("color",
      new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    /* THREE components, not four, and never merged with the
       cloud mesh. This is additive: black IS invisible, so
       brightness lives in the colour and there is no alpha
       channel to carry. Keeping it a separate mesh is also what
       makes the vec3/vec4 merge trap (sky.js:1006) structurally
       impossible here rather than merely avoided. */

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      /* One pass. Same measurement as the deck above, and
         additive blending is commutative anyway, so there is not
         even a theoretical ordering argument for two. */
      forceSinglePass: true,
      toneMapped: true,
    });
    mat.name = "sf-ice-halo";
    /* ADDITIVE = TRUE, and this is the argument art.js:1405-1411
       records: without it the haze block mixes toward the sky
       colour, and on an additive surface that means a
       full-brightness patch of sky ADDED on top of the frame - a
       hazed shaft that "read as a pale wedge stamped over the
       mountains". On a level whose signature image is a hazed
       distance that failure would be in every frame at once. */
    patchBasicMaterial(mat, atmos, HALO_FADE, true);

    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "ice-halo";
    mesh.frustumCulled = false;
    /* collide.js:523 skips anything flagged this way. The sky
       group is not in world.group so the raster never sees it -
       the flag is here because the do-not-break list names this
       ring by name, and because the day someone parents a copy
       of it into the world for a cutscene is the day a 3.4km
       additive cone rasterises into an invisible wall. */
    mesh.userData.noCollide = true;
    halo.add(mesh);
    return { halo, mesh, material: mat, geometry: g };
  }

  const haloBuilt = buildHalo();
  const halo = haloBuilt.halo;
  group.add(halo);

  /* The basis that aims the halo. Rebuilt every frame in
     `update`, and read by the repaint so the horizon fade below
     knows which way is up in world space. */
  const haloRight = new THREE.Vector3(1, 0, 0);
  const haloUp = new THREE.Vector3(0, 1, 0);
  const haloFwd = new THREE.Vector3(0, 0, 1);
  const haloBasis = new THREE.Matrix4();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const fallbackRight = new THREE.Vector3(1, 0, 0);
  let haloGain = 0;
  let dogGain = 0;

  function updateHaloBasis() {
    haloFwd.copy(atmos.sunDir).normalize();
    /* Degenerate only if the sun is within 8 degrees of vertical.
       The level's highest sun is 58 degrees, so this branch never
       runs in play - it exists because a QA hook can set any
       elevation it likes and a NaN basis silently turns the halo
       into a single black triangle. */
    if (Math.abs(haloFwd.y) > 0.99) haloRight.copy(fallbackRight);
    else haloRight.crossVectors(worldUp, haloFwd).normalize();
    haloUp.crossVectors(haloFwd, haloRight).normalize();
    haloBasis.makeBasis(haloRight, haloUp, haloFwd);
    halo.quaternion.setFromRotationMatrix(haloBasis);
  }

  const haloDir = new THREE.Vector3();

  /** Bakes the ring and the dogs. Runs on every atmosphere
   *  change, not every frame: the sun has to move for any of
   *  these to change, and the sun only moves when `atmos.update`
   *  says so. */
  function repaintHalo() {
    const geometry = haloBuilt.geometry;
    const pos = geometry.attributes.position;
    const colors = geometry.attributes.color;
    const elev = Math.asin(Math.max(-1, Math.min(1, atmos.sunDir.y))) * 180 / Math.PI;

    /* WHEN THERE IS A HALO AT ALL. It needs a sun above the
       horizon and a cirrus layer to shine through, and it needs
       there NOT to be a whiteout - inside the cloud there are no
       crystals between you and the sun at 22 degrees, there is
       just cloud.

       BRIGHTEST AT LOW SUN, and both halves of that are authored
       rather than emergent.

       The ramp-in is -1.0 to 3.0 rather than -0.5 to 5.0. The old
       window meant the level's own default sun at 7.2 degrees was
       on the ramp's shoulder, so the one preset the level ships
       pinned to was not seeing a full-strength halo - the effect
       was being faded for a sun that had already risen.

       The taper out is new. A real 22-degree halo does not vanish
       at a high sun, but three things here do argue for dimming
       it: the ring climbs out of the composition entirely (at 58
       degrees its upper arc is at 80 and nothing but a zenith
       shot contains it); the parhelia approximation below stops
       holding; and the whole point of the effect on this level is
       that it says COLD at the hour the level is composed for.
       0.42 at the top, reached over 12 to 55 degrees, so noon
       keeps a ghost of a ring rather than a bright one. */
    haloGain = sstep(-1.0, 3.0, elev)
      * lerp(1, 0.42, sstep(12, 55, elev))
      * clamp01(1 - atmos.nightFactor * 1.2)
      * (1 - clamp01(atmos.storm) * 0.95);
    /* Parhelia are a low-sun phenomenon. Bright at 7 degrees,
       gone by the mid forties - which is also where the
       approximation that puts them on the 22 degree ring stops
       being true, so the two limits are the same limit. */
    dogGain = haloGain * (1 - sstep(14, 44, elev));

    toSrgb(atmos.sunHalo, haloTintRgb);
    for (let v = 0; v < pos.count; v += 1) {
      haloDir.set(pos.getX(v), pos.getY(v), pos.getZ(v))
        .multiplyScalar(1 / HALO_R).applyMatrix4(haloBasis);
      /* The arc dies at the horizon. Below it there is no sky
         path for the light to have come down, and more
         practically the ring at 3.4km passes outside the 1448m
         map diagonal, so its lower half would otherwise draw
         over the cloud sea with nothing between to occlude it. */
      const horizon = sstep(-0.03, 0.10, haloDir.y);
      const gain = (haloKind[v] ? dogGain : haloGain) * haloW[v] * horizon;
      const c = HALO_RAMP.at(haloT[v]);
      /* Tinted by the hour's own halo colour so a blue-hour ring
         is lilac rather than a warm ring pasted on a cold sky.
         Peak vertex value 0.34 in sRGB, which transfers to about
         0.09 linear - a real halo is a subtle brightening of the
         sky, and this one is ADDED to a sky already sitting near
         0.3-0.5 linear. Anything brighter reads as a lens flare. */
      const k = gain * 0.34;
      colors.setXYZ(v,
        srgb(clamp01(lerp(c[0], haloTintRgb[0], 0.35) * k)),
        srgb(clamp01(lerp(c[1], haloTintRgb[1], 0.35) * k)),
        srgb(clamp01(lerp(c[2], haloTintRgb[2], 0.35) * k)));
    }
    colors.needsUpdate = true;
  }

  updateHaloBasis();
  repaintHalo();

  /* ============================================================
     HOW MUCH CLOUD IS OVERHEAD

     One function, two readers: the overcast term that drives the
     two lights, and anything outside this module that wants to
     know whether it is under the lid. It is a plain geometric
     query - for every sheet above `y`, is this point outside that
     sheet's shoreline - and it is deliberately NOT damped. A
     smoothed version would make the lights lag behind a QA
     teleport and put a slow ramp into a golden capture; as a pure
     function of camera position the only time it steps is the
     frame a camera teleports, which is the frame nobody is
     looking at.
     ============================================================ */
  function coverAt(x, y, z) {
    const r = Math.hypot(x, z);
    const theta = Math.atan2(z, x);
    let clear = 1;
    for (let i = 0; i < DECK_LAYERS.length; i += 1) {
      const layer = DECK_LAYERS[i];
      /* Only sheets ABOVE the sample stand between it and the
         sun, and the 9m band matches the shader's eye-level
         dissolve so the light and the picture agree about when a
         sheet has been passed. */
      const above = sstep(-9, 9, layer.y - y);
      if (above <= 0) continue;
      /* THE SAME `innerAt` THE GEOMETRY WAS BUILT FROM. Before the
         clearing this read `shoreAt(layerShore[i], theta)` and that
         was the whole answer; now the sheet begins somewhere else,
         and a `coverAt` still asking the old question would report
         the gate as 99% overcast while the frame shows clear sky
         over the peak - and would drive the key light down by 38%
         in exactly the shot the clearing exists to rescue. */
      const shore = innerAt(i, theta);
      const lap = sstep(0, SHORE_FEATHER, r - shore);
      if (lap <= 0) continue;
      clear *= 1 - clamp01(layer.alpha * lap * above);
    }
    return clamp01(1 - clear);
  }

  /* ------------------------------ update ------------------------------ */

  const sunOffset = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  let shadowSpan = shadowHalf;
  let overcast = 0;

  /* SHADOW BIAS IS MEASURED IN TEXELS, NOT IN METRES.

     Inherited verbatim from sky.js:834-850 and the reasoning is
     unchanged: both knobs exist to move a receiver's sample point
     far enough off its own surface that depth quantisation cannot
     make it shadow itself, the quantisation is one TEXEL wide, and
     the texel changes by a factor of four across the quality
     tiers. Pinned constants are correct for at most one tier, and
     the recorded cost of pinning them was not acne but its
     opposite - a 0.35m normal push under a 13 degree sun moved the
     lookup a metre and a half along the light and the player's own
     cast shadow simply missed itself.

     Alpenglow is a 7.2 degree sun, lower than the frame that
     lesson came from, so this matters MORE here. And the depth
     bias comes out smaller on this level than on Vesper for a
     structural reason: it is expressed as a fraction of the
     shadow camera's depth RANGE, and `setShadowRadius` below
     gives this level a much longer range. `normalBias` is
     carrying essentially all of the load.

     THE OPEN MEASUREMENT, and it is the only number in this file
     that is inherited rather than derived or measured. 1.45
     texels was cut against Vesper's texel and Vesper's sun. This
     level's boxes are bigger, so the texel is coarser, and the
     numbers fall out like this:

       span 250 -> texel 0.244 -> normalBias 0.354m
       span 420 -> texel 0.410 -> normalBias 0.595m
       span 620 -> texel 0.605 -> normalBias 0.878m

     A normal push of n metres moves the shadow lookup n / tan(e)
     along the light, so at alpenglow's 7.2 degrees the 420 case
     moves it 4.7 METRES - and the recorded failure this rule
     exists to prevent happened at 1.5m on a 13 degree sun. The
     trooper's own contact shadow is very likely gone at every
     tier here.

     It is NOT changed on a guess. Contract 5.11 hands this to the
     harness: measure the contact shadow at the parvis and at the
     basecamp on all four tiers, then either drop the multiplier
     or raise mapSize (which halves the texel for four times the
     shadow raster on a fill-bound frame - a trade that needs the
     measurement first). `status().shadowNormalBias` reports it so
     the harness does not have to reach into three. */
  const SHADOW_NORMAL_TEXELS = 1.45;
  function applyShadowBias() {
    const texel = (shadowSpan * 2) / Math.max(1, sun.shadow.mapSize.x);
    sun.shadow.normalBias = Math.max(0.02, texel * SHADOW_NORMAL_TEXELS);
    const range = Math.max(1, sun.shadow.camera.far - sun.shadow.camera.near);
    sun.shadow.bias = -Math.min(0.0008, (texel * 0.9) / range);
  }

  /* THE SHADOW LIGHT HAS TO CLEAR THE MOUNTAIN, and on Vesper it
     always did by accident.

     sky.js places the light at `target + sunDir * shadowSpan *
     2.6`. At the high tier's 250m span and a 7.2 degree sun that
     is 645m out and 81m up. Standing at the basecamp - target
     (0, 828), ground 12m - the light lands at about (240, 93,
     234), which is r = 336 on the mountain, where the ground is
     310m. THE LIGHT IS TWO HUNDRED METRES INSIDE THE ROCK, and
     everything it is supposed to be lighting is behind it.
     Vesper never hit this because its tallest ground is a 36m
     dune.

     The fix is to require the light to sit clear of the summit
     rather than at a fixed multiple of the span: 452m of peak
     plus the cathedral's 62m spire plus margin is 560m, and at a
     sun elevation of e the distance needed is (560 - targetY) /
     sin(e). At 7.2 degrees from the basecamp that is 4384m, well
     outside the map, where the ground is at zero.

     The 0.10 floor caps it at 5600m for a sun on the horizon and
     is what `setShadowRadius` sizes the depth range against. A
     long thin ortho frustum costs nothing in precision - 6230m
     across a 24-bit depth buffer quantises at 0.4mm. */
  const SUN_CLEARANCE = 560;
  const SUN_ELEV_FLOOR = 0.10;

  const api = {
    group,
    sun,
    skyFill,
    /** 0 is open air, 1 is a roof over your head - a moulin, or
     *  the cathedral undercroft. */
    setUnderground(value) {
      const next = clamp01(Number(value) || 0);
      if (next === subterranean) return subterranean;
      subterranean = next;
      return subterranean;
    },
    underground: () => subterranean,
    dome,
    halo,
    clouds,

    /** The inversion, for everyone who has to agree with it.
     *  `coverAt` is the honest question ("how much cloud is
     *  between this point and the sky"); `top`/`base` are the
     *  authored numbers. summit-weather's snowfall field and any
     *  cloud-line dressing read these rather than re-deriving
     *  120 from the layout document. */
    inversion: {
      top: INVERSION_TOP,
      base: INVERSION_BASE,
      coverAt,
      /* `shore` is the mountain's own contour, `inner` is where the
         sheet actually starts once the clearing has pushed it back.
         Both are reported because the difference between them IS
         the clearing, and a reader that only saw one of them could
         not tell a deck with a hole from a deck without one. */
      layers: () => DECK_LAYERS.map((l, i) => ({
        y: l.y, shore: layerShore[i], radius: l.r, hole: l.hole,
      })),
      /** The clearing boundary at bearing `atan2(z, x)`, in metres.
       *  Exposed so a harness can ask the module the question
       *  rather than reimplementing the curve - a test that
       *  reimplements the rule it is testing tests itself. */
      clearingAt,
      /** Where sheet `index` begins at that bearing. */
      innerAt,
    },

    status() {
      const vec = (value) => value.toArray().map((n) => Number(n.toFixed(4)));
      return {
        cycle: atmos.cycleStatus?.() || null,
        sunDisc: Number(domeUniforms.uCelestial.value.x.toFixed(4)),
        moon: Number(domeUniforms.uCelestial.value.y.toFixed(4)),
        stars: Number(domeUniforms.uStars.value.toFixed(4)),
        moonDir: vec(domeUniforms.uMoonDir.value),
        halo: {
          radius: HALO_R,
          ring: Number(haloGain.toFixed(4)),
          dogs: Number(dogGain.toFixed(4)),
          opacity: Number(haloBuilt.material.opacity.toFixed(4)),
          fade: HALO_FADE,
          /* Read back off the material rather than restated, so
             this reports what `patchBasicMaterial` actually did.
             An additive surface patched WITHOUT this flag fades
             toward the sky colour, and adding a full-brightness
             patch of sky is how a hazed additive volume becomes
             "a pale wedge stamped over the mountains"
             (art.js:1405-1411). It is the one property of this
             mesh that fails silently and invisibly at close range,
             so it is asserted rather than trusted. */
          additive: !!haloBuilt.material.userData.sfAdditive,
        },
        inversion: {
          top: INVERSION_TOP,
          base: INVERSION_BASE,
          layers: DECK_LAYERS.length,
          triangles: cloudTris,
          overcast: Number(overcast.toFixed(4)),
          /* THE HOLE OVER THE MASSIF, published so the audit can
             assert on it rather than on a screenshot. `min`/`max`
             are the boundary's extremes over 360 bearings, so a
             build that lost the lobe reports them equal; `leeDeg`
             is the axis it actually resolved from `atmos.windDir`,
             which is the other half that can silently go wrong.
             The per-bearing curve itself is on `api.inversion` as
             `clearingAt` / `innerAt` - a harness that needs to
             assert about one station should ask for that station's
             bearing rather than reimplement a cosine. */
          clearing: {
            base: CLEAR_BASE,
            shear: CLEAR_SHEAR,
            floorCap: Number(FLOOR_SHORE_CAP.toFixed(1)),
            leeDeg: Number(((leeTheta * 180 / Math.PI + 360) % 360).toFixed(1)),
            min: clearingStats.min,
            max: clearingStats.max,
            mean: clearingStats.mean,
          },
        },
        /* The high deck shares the inversion's mesh, so it has no
           triangle count of its own worth reporting - what a
           harness needs is the count and whether the far-plane
           clamp bit. `worstFit` below about 0.4 means the ranges
           have been widened past what the reach can carry and the
           bands are being dragged toward the camera. */
        cirrus: {
          bands: CIRRUS_BANDS,
          reach: CIRRUS_REACH,
          worstFit: Number(cirrusWorstFit.toFixed(3)),
        },
        underground: Number(subterranean.toFixed(4)),
        shadowSpan,
        shadowTexel: Number(((shadowSpan * 2) / Math.max(1, sun.shadow.mapSize.x)).toFixed(4)),
        /* Reported because it is the one number in this file that
           is inherited rather than measured - see applyShadowBias. */
        shadowNormalBias: Number(sun.shadow.normalBias.toFixed(4)),
        shadowBias: Number(sun.shadow.bias.toExponential(3)),
        shadowFar: sun.shadow.camera.far,
      };
    },

    /** Called every frame. The ONE place the sun's transform is
     *  written, and it re-derives the direction from
     *  `atmos.sunDir` rather than from the light's own position -
     *  reading back a value this function wrote last frame is how
     *  a sun ends up integrating camera motion and sliding to a
     *  grazing angle where nothing has a shadow side.
     *
     *  Returns `atmos.update(dt)`'s boolean unchanged. The caller
     *  re-applies the grade, the environment and the summit post
     *  chain on it, so swallowing it freezes the day cycle and
     *  every `setTime` in the QA hook with no error anywhere. */
    update(dt, camera) {
      const atmosphereChanged = atmos.update(dt);

      dome.position.copy(camera.position);
      dome.scale.setScalar(camera.far * 0.92);
      /* `clouds` is NOT moved. See CLOUD_VERT. */
      halo.position.copy(camera.position);
      updateHaloBasis();

      sun.color.copy(atmos.sunColor);
      sun.intensity = atmos.sunIntensity;
      const dynamicFill = Math.max(1 - (atmos.goldenFactor ?? 1), atmos.storm || 0);
      skyFill.color.copy(atmos.skyHigh).lerp(atmos.skyZenith, 0.34);
      skyFill.groundColor.copy(atmos.groundBounce);
      skyFill.intensity = dynamicFill * atmos.envIntensity * 0.72;

      /* ======================================================
         UNDER THE LID, and the compromise in it is deliberate.

         Four of the nine stations sit below 120m, under a cloud
         deck, and the art direction's claim is that down there
         the light goes flat and monochrome while the summit
         stays in hard alpenglow. Half of that is free - the
         deck draws itself, and the height-dependent fog does the
         monochrome - and half of it is this block.

         THE LIE, NAMED: the key is one scene-global
         DirectionalLight. Blocking it because the CAMERA is
         under cloud also unlights the sunlit peak the camera is
         looking AT, which is the exact image the level opens on
         (arrival: the whole mountain framed by the basecamp
         buttresses). So this is not the physical answer, which
         would be a 30% key; it is the largest partial block that
         leaves the peak plainly sunlit from below. Measured
         against the arrival frame, 0.62 is that number.

         The rest of the effect is bought the safe way, by ADDING
         hemisphere rather than subtracting key. Overcast light is
         not less light, it is the same light arriving from every
         direction, so the fill goes up by roughly what the key
         gives away; the near ground loses its shadow contrast
         and the frame does not sink onto the toe of a tone curve
         whose exposure is authored for snow in sun. Adding fill
         also lifts distant shadows a little, which is the one
         side effect that reads as more bounce rather than as a
         mistake.

         It is applied AFTER the three writes above rather than
         folded into them, because those are the sky's contract
         with the atmosphere and have to stay readable as such.
         `status().inversion.overcast` reports it, because
         saintfall-summit-post.mjs measures scene-buffer
         percentiles and this term makes them depend on where the
         camera is standing.
         ====================================================== */
      overcast = coverAt(camera.position.x, camera.position.y, camera.position.z);
      if (overcast > 0) {
        sun.intensity *= lerp(1, 0.62, overcast);
        skyFill.color.lerp(OVERCAST_FILL, overcast * 0.70);
        skyFill.groundColor.lerp(OVERCAST_GROUND, overcast * 0.55);
        skyFill.intensity += overcast * atmos.envIntensity * 0.62;
      }

      /* Under the map. A room with a roof gets a fraction of the
         key and almost none of the hemisphere - but not zero of
         either: a surface lit by nothing is a silhouette. */
      if (subterranean > 0) {
        sun.intensity *= lerp(1, 0.17, subterranean);
        skyFill.intensity *= lerp(1, 0.22, subterranean);
        skyFill.color.lerp(UNDERGROUND_FILL, subterranean * 0.85);
        skyFill.intensity = Math.max(skyFill.intensity,
          subterranean * atmos.envIntensity * 0.10);
      }

      const night = smoothstep(atmos.nightFactor);
      const daylight = clamp01(1 - night);
      domeUniforms.uStars.value = smoothstep(clamp01(night * 1.12));
      domeUniforms.uSunSize.value = lerp(0.0013, 0.011, atmos.storm);
      domeUniforms.uCelestial.value.set(
        daylight, smoothstep(clamp01(night * 1.15)), 0, atmos.cyclePhase
      );
      /* The moon is the night key. Same direction, so its
         terminator and the world's cast shadows agree. */
      domeUniforms.uMoonDir.value.copy(atmos.sunDir);

      /* The halo's global gain rides on the material rather than
         on the vertex buffer: AdditiveBlending is (SrcAlpha,
         One), so `opacity` scales what is added and costs no
         recompile and no buffer upload. The per-vertex bake is
         only redone when the sun has actually moved. */
      haloBuilt.material.opacity = clamp01(Math.max(haloGain, dogGain));
      /* AND IT IS NEVER HIDDEN. Toggling `visible` to skip the
         draw at night looks free and is not: `renderer.compile`
         walks the VISIBLE scene, so a mesh that is invisible
         during `warmShaders` is a mesh whose program is built the
         first frame it appears - the same class of freeze as a
         light joining the scene late, arriving in the middle of
         a climb. 2,600 triangles of thin annulus at opacity 0 is
         the cheaper end of that trade by a wide margin. */

      if (atmosphereChanged) {
        repaintClouds();
        repaintFarRanges();
        repaintHalo();
      }

      /* Shadow frustum rides with the camera, centred AHEAD of
         it along the view direction. Centred on the camera
         itself, half the shadow budget is spent behind the
         viewer and a landmark 250m up the road - which on this
         level is where every landmark is - falls outside the
         frustum and casts nothing. */
      camera.getWorldDirection(viewDir);
      const lead = shadowSpan * 0.42;
      const cx = camera.position.x + viewDir.x * lead;
      const cz = camera.position.z + viewDir.z * lead;
      /* The 3D height of the look-ahead point, not the camera's.
         On a 452m cone the two differ by hundreds of metres and
         it is the ground being shadowed that has to be in the
         box. */
      const cy = ctx.terrain ? ctx.terrain.heightAt(cx, cz) : 0;

      // Snap the centre to shadow-texel increments. Without this
      // the whole map's shadows crawl and shimmer as the camera
      // moves, because every frame re-rasterises them against a
      // grid that has shifted by a fraction of a texel.
      const texel = (shadowSpan * 2) / sun.shadow.mapSize.x;
      sun.target.position.set(
        Math.round(cx / texel) * texel, cy, Math.round(cz / texel) * texel
      );
      const lift = Math.max(0, SUN_CLEARANCE - sun.target.position.y);
      const reach = Math.max(shadowSpan * 2.6,
        lift / Math.max(SUN_ELEV_FLOOR, atmos.sunDir.y));
      sunOffset.copy(atmos.sunDir).multiplyScalar(reach);
      sun.position.copy(sun.target.position).add(sunOffset);
      sun.target.updateMatrixWorld();
      return atmosphereChanged;
    },

    /** Rebuild anything that bakes the atmosphere into geometry. */
    refresh() {
      repaintClouds();
      repaintFarRanges();
      repaintHalo();
    },

    setShadowRadius(half) {
      shadowSpan = half;
      sun.shadow.camera.left = -half;
      sun.shadow.camera.right = half;
      sun.shadow.camera.top = half;
      sun.shadow.camera.bottom = -half;
      sun.shadow.camera.near = 1;
      /* Sized for the worst case the clearance rule above can
         produce - a sun on the horizon, 5600m of reach - plus
         the box itself. sky.js's `half * 6` was correct for a
         light that never had to stand off further than 2.6 spans;
         here a low sun pushes the light kilometres away and
         anything past `far` is silently not a caster. */
      sun.shadow.camera.far = SUN_CLEARANCE / SUN_ELEV_FLOOR + half * 1.5;
      sun.shadow.camera.updateProjectionMatrix();
      applyShadowBias();
    },
    get shadowSpan() { return shadowSpan; },
    get shadowTexel() { return (shadowSpan * 2) / Math.max(1, sun.shadow.mapSize.x); },
    applyShadowBias,
  };

  api.setShadowRadius(shadowHalf);
  return api;
}
