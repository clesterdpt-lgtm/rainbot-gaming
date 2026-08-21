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

   Sized by SUBTENDED ANGLE and bounded by the FAR PLANE, per the
   cirrus note: `camera.far` is 11000 and the camera roams to
   +/-1010, so nothing may sit past ~9700 from the origin. The
   top and bottom sheets run to 8600.

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
   elevation profile. It cannot ask: summit-main builds the sky at
   step 5 and the terrain at step 6 (contract 2.1), so ctx.terrain
   does not exist yet.

   This is therefore a SECOND COPY of the layout's radial table,
   and copies drift. Three things make this one safe:
     - it is the AUTHORED table from saintfall-summit-layout.md
       section 1, which is the same source summit-terrain reads,
       not a fit to summit-terrain's output;
     - it is used for ONE thing, the radius at which each sheet
       laps out, and that shoreline is alpha-feathered over 150m,
       so an error of tens of metres is invisible;
     - it deliberately ignores ridge noise, spurs and station
       pads. A cloud shoreline that followed every gully would be
       a worse shoreline. Real ones do not.

   If the layout's table ever changes, this changes with it.

   CROSS-CHECKED AGAINST THE REAL FIELD, and the result is worth
   recording because it is not clean. Bisecting
   summit-terrain's `makeSummitField(...).heightAt` over 48
   bearings for the altitude each sheet sits at:

     sheet y=120  table 606   field median 621   (agrees)
     sheet y=100  table 625   field median 660   (agrees)
     sheet y= 78  table 655   field median 1023
     sheet y= 56  table 759   field never crosses
     sheet y= 34  table 797   field never crosses
     sheet y= 10  table 937   field never crosses

   The cause is visible in a straight radial sample: the field
   PLATEAUS from r = 700 out to r = 937 at [12, 96, 241] metres
   (min, median, max over bearings) and is still at [11, 68, 162]
   at the map edge, where the layout's table says 0 to 18. Those
   three numbers are the basecamp pad (12m), the glacier pad
   (96m) and the Bell Terrace pad (241m): the station pads are
   flooding the outer ring far past the layout's 40m rim feather.

   Nothing here is designed around that, deliberately. The layout
   is the fixed authority on numbers and this file is authored to
   it; a shoreline fitted to the current field would have to be
   refitted when the pad feathers are bounded. What it means in
   the meantime is concrete and checkable, so it is written down
   rather than discovered from a screenshot: the low sheets are
   buried, and with terrain standing at up to 162m at r = 1024 a
   deck whose top is at 120m cannot hide the map edge on the
   western bearings. That is a summit-terrain question, not a sky
   one - see the note handed back with this module.
   ============================================================ */
const PROFILE_ROWS = [
  [0, 452], [74, 448], [190, 392], [460, 236], [700, 70], [860, 18], [1024, 0],
];

/** Smootherstep, matching the layout's blend between rows. */
const smoother = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

function layoutHeight(r) {
  if (r <= 0) return PROFILE_ROWS[0][1];
  if (r >= 1024) return 0;
  for (let i = 0; i < PROFILE_ROWS.length - 1; i += 1) {
    const [r0, y0] = PROFILE_ROWS[i];
    const [r1, y1] = PROFILE_ROWS[i + 1];
    if (r <= r1) return lerp(y0, y1, smoother((r - r0) / (r1 - r0)));
  }
  return 0;
}

/** The radius at which the mountain drops through altitude `y`.
 *  Bisection rather than a closed form: the profile is monotonic
 *  in r, twenty-eight steps resolve it to under a metre, and it
 *  runs six times in the whole build. */
function shoreRadiusFor(y) {
  let lo = 0;
  let hi = 1024;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) * 0.5;
    if (layoutHeight(mid) > y) lo = mid; else hi = mid;
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
              case: eye at (0, 828, 14), the terrain mesh ends
              196m south at r = 1024, and a 1.7m eye on flat
              ground puts that edge at -0.4 degrees - just under
              the eyeline, i.e. exactly where a hard cut is most
              visible. A sheet at 10m starting at r = 938 (109m
              south of the eye) presents its near edge at -2.1
              degrees, so everything from -2.1 degrees up to the
              horizon is its top surface receding to infinity, and
              the mesh boundary at -0.4 degrees is behind it. The
              four sheets between do not reach: their shorelines
              are inside the basecamp and their altitudes are
              above the eye.

   The middle four are the body of the deck. They are small in
   radius on purpose - a sheet 38m above your head covers
   everything down to 1 degree of elevation by radius 2200, so
   paying for 8600 of it is paying for geometry the top sheet and
   the horizon already own. Area goes as r squared and this is a
   fill-bound frame.
   ============================================================ */
const DECK_LAYERS = [
  { y: 120, r: 8600, seg: 192, rings: 15, bill: 11.0, swell: 8.5, alpha: 0.88, tone: 1.00 },
  { y: 100, r: 3800, seg: 128, rings: 10, bill: 5.5, swell: 5.0, alpha: 0.52, tone: 0.76 },
  { y: 78, r: 3200, seg: 128, rings: 10, bill: 4.0, swell: 4.0, alpha: 0.46, tone: 0.56 },
  { y: 56, r: 2800, seg: 112, rings: 9, bill: 3.2, swell: 3.2, alpha: 0.42, tone: 0.38 },
  { y: 34, r: 2600, seg: 112, rings: 9, bill: 2.4, swell: 2.4, alpha: 0.38, tone: 0.20 },
  { y: 10, r: 8600, seg: 144, rings: 13, bill: 1.4, swell: 1.4, alpha: 0.46, tone: 0.05 },
];

/** How far out from its shoreline a sheet takes to reach full
 *  alpha. Long, because the whole read of an inversion is that
 *  the mountain does not have a waterline - it fades into one. */
const SHORE_FEATHER = 150;

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
const HALO_FADE = 0.85;

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
  const shadowHalf = 420;
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
    const base = layerShore[index];
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
      const shore = shoreAt(base, theta);
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

     Two numbers change. The distance multiplier is 3.0 rather
     than 4.0 because this geometry is world-anchored (it shares
     the mesh with the deck, which cannot follow the camera), so
     the far-plane budget has to absorb the camera roaming 1010m
     off the origin: worst case here is centre 6653 + half a
     4178m band = 8742, plus 1010 = 9752 against a far plane of
     11000. And 26 bands rather than 30, because the deck below is
     new load on the same transparent pass.
     ============================================================ */
  function buildCirrusBand(rng) {
    const alt = rng.range(2600, 4200);
    const ground = 1500 * Math.pow(3.0, rng());
    const az = rng() * TAU;
    const dist = Math.hypot(ground, alt);
    const sinEl = Math.max(0.20, alt / dist);
    const centre = new THREE.Vector3(Math.cos(az) * ground, alt, Math.sin(az) * ground);

    const pos = [];
    const idx = [];
    const nrm = [];
    const alpha = [];
    const filaments = rng.int(4, 9);
    const bandLen = (12 + rng() * 24) * Math.PI / 180 * dist;
    /* Half-width in DEGREES of subtended angle. A filament ends
       up at roughly 0.2x the band half-width once its own
       fraction and its taper apply, so 1 degree draws a 3-pixel
       thread at 1600x900; 3 to 7 puts it at 25-60 pixels, which
       is a cloud. */
    const bandHW = (3.0 + rng() * 4.0) * Math.PI / 180 * dist / sinEl;
    const bandAlpha = rng.range(0.34, 0.62);
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

    g.applyMatrix4(new THREE.Matrix4().compose(
      centre,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * TAU, 0)),
      new THREE.Vector3(1, 1, 1)
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
    for (let i = 0; i < 26; i += 1) {
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
       just cloud. */
    haloGain = sstep(-0.5, 5.0, elev)
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
      const shore = shoreAt(layerShore[i], theta);
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
      layers: () => DECK_LAYERS.map((l, i) => ({ y: l.y, shore: layerShore[i], radius: l.r })),
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
        },
        inversion: {
          top: INVERSION_TOP,
          base: INVERSION_BASE,
          layers: DECK_LAYERS.length,
          triangles: cloudTris,
          overcast: Number(overcast.toFixed(4)),
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
