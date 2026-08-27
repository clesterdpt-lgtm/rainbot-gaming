/* ============================================================
   SAINTFALL - Meridian-IV weather   ("The Green Antiphon")

   Three permanently-drawn point fields and a squall FRONT that
   crosses the level.

   ------------------------------------------------------------
   THE MOTE MODEL IS COPIED, NOT REINVENTED

   vfx.js's `buildPoints` is not exported, and summit-weather.js
   reproduces its model exactly because every detail of it is a bug
   that has already been paid for once. All four of those traps are
   this file's too, so all four are reproduced here with the same
   numbers:

     - a mote sits at a FIXED WORLD POSITION and is folded into the
       box around the camera by whole box-widths. The obvious
       version - position measured from the viewer - SLIDES, and
       the obvious fix for the slide, snapping the anchor to 8 m,
       trades it for a JUMP: nine hundred motes step eight metres
       sideways in one frame every eight metres of travel. It
       survived every still review in the project because standing
       still the anchor never steps.
     - the anchor is `camera.position`, UNSNAPPED. See above.
     - the distance fade ends at `uBox.x * 0.95`, which is where
       the fold is. At 1.05 a mote is still at 3% opacity when it
       wraps and one in a few hundred blinks across the field.
     - `gl_PointSize` is clamped to [1, 26]. Uncapped, a mote three
       metres from the lens draws a 300px disc, the bloom pass
       finds it, and the frame fills with bokeh. This level's bloom
       threshold is 1.62 and its foam is authored to sit at 1.9, so
       it is a pass that is LOOKING for white discs.

   And the fifth trap, which is Kenosis's snowfall failure and is
   worse here than it was there:

     - A NEAR-WHITE MOTE UNDER NormalBlending OVER A BRIGHT SURFACE
       COMPOSITES TO THAT SURFACE AND VANISHES. Kenosis measured
       snow covering 2.4% of the frame looking down at a snowfield
       against 4.5% at head height - the flakes were all still
       there, they simply had nothing to be seen against. On THIS
       level the bright surface is foam and the bright background
       is a marine horizon haze at #cfe4f2, and the field that has
       to be seen against both of them is the spray. So no field
       here is white at both ends of its colour pair; every one of
       them spans a bright end and a genuinely mid end, and the
       mid end is what does the work over foam and over the haze
       band. Measured: see THE MEASUREMENT below.

   ------------------------------------------------------------
   THE MEASUREMENT THIS MODULE WAS BUILT AGAINST

   Round 1 captured thirteen frames with this module a 31-line
   placeholder that drew nothing. The round-1 critique named, among
   others, "there is no foam anywhere in the level, and no reef
   break" - the `crest` camera stands ON the reef crest and there
   was not one pixel of whitewater in the frame. The water module
   owns the FOAM ON THE SURFACE. This module owns the SPRAY IN THE
   AIR, and the division matters: a break rendered flat on the
   water is a white stripe, and a white stripe seen from the
   Landing 1790 m away across the lagoon is a rendering artefact.
   What makes a reef read as a reef at that range is that the white
   has VERTICAL EXTENT - it stands off the water.

   Per-field, hiding each in turn on the same still (a pinned sim
   time, not a stepped frame, or every mote that merely moved
   counts as a pixel the field changed):

     frame     field     d(sigma)  d(luma)  pixels touched
     crest     spray      +2.71     +3.04       17.4%
     arrival   spray      +0.42     +0.31        2.1%
     atoll     spray      +0.66     +0.48        4.9%
     nave      pollen     +0.21     -0.14        3.6%
     crest     rain*      -1.83     +2.20       31.8%
                                    (* at squall pos 0.50)

   The sign on the pollen is worth reading rather than skipping: it
   lowers mean luma because half its colour pair is a dark insect
   against a lit canopy, and it raises sigma because the other half
   is chaff in a light shaft against jungle floor at albedo 0.05.
   A field that only ever raised luma would be a field that was
   always brighter than what is behind it, which is what the
   vanish trap above is about.

   ------------------------------------------------------------
   WHY THERE ARE ONLY THREE FIELDS

   Every field is `frustumCulled = false` with a 1e6 bounding
   sphere, so it is a PERMANENT fill cost on a frame that is
   already fill-bound. Three is the measured budget. A fourth needs
   a measurement, not an opinion.

     spray  - reef-crest-anchored, the Kenosis spindrift model
              exactly. The emission line is sampled from the
              TERRAIN at build time, offset outboard to the break
              line, so the spray comes off the crest it belongs to
              and is legible from across the lagoon. This is the
              field that does the work.
     pollen - jungle-anchored, warm, tiny, slow. Camera-anchored
              with a world-wrapped y, gated by the jungle floor
              under the viewer the way Kenosis gates its ground
              blizzard by snow supply.
     rain   - squall-gated, world-anchored with wrapY so it falls
              PAST you and can be flown through, and gated per-mote
              on the squall band so you watch the wall of it arrive
              across the box rather than watching an opacity slider
              move.

   The rain is HIDDEN, not merely faded, when no squall is near:
   `uOpacity = 0` still rasterises nine thousand points. It shares
   its program with the pollen (same vertex and fragment source, so
   three's program cache hands it the same compiled program), so
   the first frame it becomes visible costs no compile.

   ------------------------------------------------------------
   ONE DISAGREEMENT WITH design/water.md, STATED

   `design/water.md` 8.3 budgets the reef spray as a NEAR-FIELD
   pooled emitter: 1800 sprites with a 340 m spawn gate, on the
   argument that the water's own sheet already covers the reef at
   range and nobody can resolve a 1 m droplet at 800 m. Both halves
   of that are true and the conclusion still does not follow,
   because the thing that has to read at 1790 m is not a droplet,
   it is a BAND of white standing twelve metres off the water - and
   a 340 m gate deletes exactly the part of the ring that appears
   in `arrival`, `atoll` and `rim`, which is three of the level's
   four establishing frames. INTERFACES section 7 asks for the
   spindrift model and section 12 puts INTERFACES above design/*.md
   on any number, so the whole exposed arc emits. The near field is
   not lost by it: uClampFade pays the [1,26] clamp back in alpha
   exactly as the summit's plumes do, so standing in the spray on
   the crest is still a picture.
   ============================================================ */

import { clamp01, lerp, makeRng, hexToRgb } from "saintfall/core.js";
import { srgbTransfer as srgb } from "saintfall/art.js";
import { ATOLL_PALETTE, ATOLL_WIND, atollWindSpeed } from "saintfall/atoll-art.js";
import { SEA_Y } from "saintfall/atoll-terrain.js";

const K = ATOLL_PALETTE;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------
   HOW BIG IS A MOTE, IN METRES

   Every size below is authored as a world diameter and converted
   here, because `aSize` on its own is meaningless and authoring it
   directly is how Kenosis's spindrift ended up 1.9 m wide and
   invisible.

   `gl_PointSize = aSize * uPixelScale / d`, and a perspective
   camera puts `(width / 2) / (d * tan(fov / 2))` pixels on a metre
   at distance d. Eliminating d:

     worldDiameter = aSize * uPixelScale / PIX_PER_M_AT_1M

   PIX_PER_M_AT_1M is the harness's own framing: 1600 px wide at
   the 46-66 degree fovs the beauty poses use, so
   (1600 / 2) / tan(27 deg) = 1570. A CONSTANT rather than a live
   camera read, because a mote's world size must not change when
   the player opens the field of view, and because the dynamic
   resolution controller moves the drawing buffer under us - which
   moves gl_PointSize but must not move the art.

   NOTE that uPixelScale cancels out of the DRAWN size entirely:
   metres * 1570 / d. It only sets the magnitude of the aSize
   attribute, and it is chosen per field so aSize lands near 1.
   ------------------------------------------------------------ */

const PIX_PER_M_AT_1M = 1570;

/** aSize for a mote that should read `metres` across. */
function sizeFor(metres, pixelScale) {
  return (metres * PIX_PER_M_AT_1M) / pixelScale;
}

/** Screen diameter, in px, of an `m`-metre mote at distance `d`,
 *  AFTER the clamp. The number the first draft of any point field
 *  is missing: under about 6 px a field cannot read at its own
 *  working distance however many motes it has. */
function motePx(m, d) {
  return Math.min(26, (m * PIX_PER_M_AT_1M) / Math.max(d, 0.4));
}

/* ------------------------------------------------------------
   THE CAMERA-ANCHORED FIELD

   summit-weather.js's FIELD_VERT, with two additions and one
   change, all three of which are this level's:

     uBand      - the SQUALL BAND, evaluated per mote on its own
                  folded world position. A front is a place, not a
                  global fade: without this the rain arrives by an
                  opacity slider and the leading edge - the whole
                  point of a squall - does not exist. vec4 is
                  (travel dir x, travel dir z, leading edge s,
                  1 / band width); uBandMix 0 disables it and costs
                  two multiplies.
     uStreakAxis- 0 uses the LOCAL HORIZON as the streak axis,
                  1 uses the analytic velocity. Kenosis proved the
                  horizon is right for a ground blizzard - its wind
                  blew away from both Bowl cameras, the screen-space
                  velocity degenerated and every mote drew as a
                  round dot. Rain is the opposite case: it has a
                  large, non-degenerate vertical velocity from
                  every camera except one looking straight down, and
                  rain streaked along the HORIZON reads as a screen
                  wipe. So the axis is a per-field choice, and the
                  degenerate case still falls back to the horizon.
     the fade   - unchanged in form and it must stay so: it ends at
                  uBox.x * 0.95, which is where the fold is.
   ------------------------------------------------------------ */

const FIELD_VERT = /* glsl */`
precision highp float;
attribute float aSeed;
attribute float aSize;

uniform float uTime;
uniform vec3  uWind;
uniform vec3  uAnchor;
uniform vec3  uBox;
uniform float uRise;
uniform float uDrift;
uniform float uLifeScale;
uniform float uPixelScale;
uniform vec2  uCeil;        // fade start, fade end (absolute world y)
uniform vec2  uHug;         // fade start, fade end (metres above the anchor)
uniform vec3  uSheet;       // band wavenumber, band travel rate, band depth
uniform vec3  uHaze;        // haze start (m), haze end (m), strength
uniform float uGust;
uniform float uClampFade;   // exponent for the 26px clamp payback; 0 disables
uniform float uClampCap;    // how far over the clamp the payback may run
uniform float uFoldY;       // 1 = fold the vertical band too, 0 = ride the anchor
uniform float uWrapY;       // 1 = the band is WORLD-fixed in y and wraps
uniform float uStreakAxis;  // 0 = local horizon, 1 = analytic velocity
uniform vec4  uBand;        // squall: dir.x, dir.z, leading edge s, 1/width
uniform float uBandMix;     // 0 = ignore the squall, 1 = fully gated by it
uniform vec4  uBandShape;   // precursor frac, precursor level, edge frac, tail frac
uniform float uBandDecay;   // how much the band weakens from front to back

varying float vFade;
varying float vSeed;
varying float vHaze;
varying vec2  vStreak;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

/* THE BAND PROFILE, and it is the same arithmetic the CPU side
   runs so the two cannot disagree about where the front is.
   u = 0 at the leading edge, 1 at the trailing edge, negative
   ahead of the front. */
float bandAt(float u) {
  float pre = smoothstep(-uBandShape.x, 0.0, u) * uBandShape.y;
  float core = smoothstep(0.0, uBandShape.z, u)
             * (1.0 - smoothstep(1.0, 1.0 + uBandShape.w, u))
             * (1.0 - uBandDecay * clamp(u, 0.0, 1.0));
  return clamp(max(pre, core), 0.0, 1.0);
}

void main() {
  vec2 wind = normalize(uWind.xy);
  float life = (4.0 + h11(aSeed + 1.7) * 8.0) * uLifeScale;
  float t = fract(uTime / life + h11(aSeed + 4.4));

  /* The vertical origin is a fixed world height when uFoldY or
     uWrapY is on, and an offset from the anchor when neither is. */
  vec3 p = vec3(
    (h11(aSeed) * 2.0 - 1.0) * uBox.x,
    mix(uAnchor.y * (1.0 - uFoldY) + (h11(aSeed + 2.3) * 2.0 - 1.0) * uBox.y,
        h11(aSeed + 2.3) * uBox.y * 2.0,
        uWrapY),
    (h11(aSeed + 5.9) * 2.0 - 1.0) * uBox.z
  );

  /* GUSTS. A constant drift reads as a conveyor belt. Two
     incommensurate sinusoids on the drift rate, phase-shifted
     along the wind so a gust TRAVELS rather than pulsing
     everywhere at once. */
  float travel = dot(p.xz, wind) * 0.012;
  float gust = 1.0 + uGust * (sin(uTime * 0.47 - travel) * 0.6
                            + sin(uTime * 0.171 - travel * 0.41) * 0.4);

  p.xz += wind * t * life * uDrift * gust;
  p.y += t * life * uRise;
  p.x += sin(uTime * 0.7 + aSeed * 4.0) * 0.9;
  p.z += cos(uTime * 0.62 + aSeed * 6.0) * 0.9;

  vec2 span = uBox.xz * 2.0;
  vec2 rel = p.xz - uAnchor.xz;
  p.xz += (mod(rel + uBox.xz, span) - uBox.xz) - rel;

  /* THE VERTICAL FOLD / WRAP. A mote lives at a fixed world height
     and is folded into the band by whole band-heights, for exactly
     the reason the xz fold exists: without it the field is welded
     to the camera in y, so a jetpack climb carries the entire
     field with it, rigid, and rain cannot fall past you. Kenosis
     shipped that bug and a player named it precisely - the snow
     does not follow you and it looks like you are flying above it.

     A wrap is only safe where BOTH ends of the band are already
     invisible, because a mote that wraps jumps a full band height
     in one frame in plain sight. wrapFade below is that
     precondition, not a decoration. */
  float relY = p.y - uAnchor.y;
  p.y += ((mod(relY + uBox.y, uBox.y * 2.0) - uBox.y) - relY) * max(uFoldY, uWrapY);

  /* THE SHEETS. Measured on the FOLDED position, so a band is a
     fixed feature of the world the camera moves through rather
     than a pattern stapled to the viewer. A smoothstep on the sine
     instead of the sine itself, because a sinusoidal density is a
     gradient and a rain curtain is a hard-edged front with lighter
     air behind it. Depth 0 leaves the field untouched. */
  float band = dot(p.xz, wind) * uSheet.x - uTime * uSheet.y;
  float sheet = mix(1.0 - uSheet.z, 1.0, smoothstep(-0.25, 0.8, sin(band)));

  /* THE SQUALL, per mote, on the folded world position. */
  float bu = (uBand.z - dot(p.xz, uBand.xy)) * uBand.w;
  float squall = mix(1.0, bandAt(bu), uBandMix);

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float ceilFade = 1.0 - smoothstep(uCeil.x, uCeil.y, p.y);
  float dy = p.y - uAnchor.y;
  float hugFade = (1.0 - smoothstep(uHug.x, uHug.y, dy))
    * mix(1.0, smoothstep(-uBox.y, -uBox.y + 1.0, dy), uFoldY);
  /* A world-fixed band wraps at BOTH ends and neither is hidden by
     terrain, so both are taken out well inside the boundary. Six
     metres of the half-height at each end means no mote is ever
     drawn at the instant it jumps. */
  float wrapFade = mix(1.0,
    smoothstep(-uBox.y, -uBox.y + 6.0, dy)
      * (1.0 - smoothstep(uBox.y - 6.0, uBox.y, dy)),
    uWrapY);
  vHaze = smoothstep(uHaze.x, uHaze.y, d) * uHaze.z;
  vFade = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.55, 1.0, t))
        * (1.0 - smoothstep(uBox.x * 0.45, uBox.x * 0.95, length(p.xz - uAnchor.xz)))
        * smoothstep(0.6, 4.0, d) * ceilFade * hugFade * wrapFade * sheet * squall
        * (1.0 - vHaze * 0.5);
  /* PER-MOTE DENSITY. Without it every mote is the same stamp at
     the same opacity and the field reads as a field of identical
     discs however soft the falloff is. Mean 1.0 by construction,
     so uOpacity keeps meaning "how dense this field is". */
  vFade *= 0.46 + 1.08 * h11(aSeed + 8.8);
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;

  /* THE STREAK AXIS. Two candidates, and which one is right is a
     property of the FIELD, not of the engine.

     The horizon tangent is the world-horizontal direction
     perpendicular to the view ray. It is the screen horizontal for
     a level camera, tilts correctly when the camera pitches or
     rolls, and cannot degenerate except looking straight down. It
     is right for anything sheared along a surface.

     The analytic velocity is right for anything falling. Rain
     streaked along the horizon reads as a screen wipe, and rain is
     the one field whose velocity has a large vertical component
     from every camera in the level, so it cannot degenerate the
     way Kenosis's ground blizzard did looking downwind.

     The y flip is because gl_PointCoord runs top-down and NDC does
     not - without it every tilted streak leans the wrong way. */
  vec3 upV = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec3 tanV = cross(upV, mv.xyz);
  float tl = length(tanV);
  vec4 tipH = projectionMatrix * vec4(mv.xyz + (tl > 1.0e-4 ? tanV / tl : vec3(1.0, 0.0, 0.0)) * max(d, 1.0) * 0.02, 1.0);
  vec3 vel = vec3(wind.x, 0.0, wind.y) * uDrift * gust + vec3(0.0, uRise, 0.0);
  vec4 tipV = projectionMatrix * (viewMatrix * vec4(p + vel * 0.05, 1.0));
  vec2 a0 = gl_Position.xy / max(gl_Position.w, 1e-4);
  vec2 sH = tipH.xy / max(tipH.w, 1e-4) - a0;
  vec2 sV = tipV.xy / max(tipV.w, 1e-4) - a0;
  /* The fallback, and it is a real one: a velocity axis shorter
     than this in NDC is the degenerate case, and it draws a round
     dot in every frame that contains it. */
  vec2 sdir = mix(sH, (length(sV) > 2.0e-4 ? sV : sH), uStreakAxis);
  sdir.y = -sdir.y;
  float sl = length(sdir);
  vStreak = sl > 1.0e-6 ? (sdir / sl) : vec2(1.0, 0.0);

  /* A mote the clamp shrank is drawing far more light per pixel
     than it should; uClampFade pays that back in alpha. See the
     long note at the bottom of PLUME_VERT. */
  float want = aSize * uPixelScale / max(d, 0.4);
  vFade *= pow(clamp(want / 26.0, 1.0, uClampCap), -uClampFade);
  gl_PointSize = clamp(want, 1.0, 26.0);
}
`;

/* ------------------------------------------------------------
   THE CREST-ANCHORED FIELD

   summit-weather.js's PLUME_VERT. A mote belongs to an EMISSION
   POINT rather than to a box, streams downwind from it, and dies -
   which is what makes a plume look ATTACHED to a reef instead of
   drifting past one.

   One addition: uBand, the same squall term the box field carries,
   so the reef under the front smokes and the reef in the sun does
   not. That is the only place in the level where a 1400 m front
   can be read against a fixed reference at a kilometre.
   ------------------------------------------------------------ */

const PLUME_VERT = /* glsl */`
precision highp float;
attribute float aSeed;
attribute float aSize;
attribute vec3  aOrigin;
attribute float aStrength;
attribute float aFlow;

uniform float uTime;
uniform vec3  uWind;
uniform float uRise;
uniform float uReach;
uniform float uLife;
uniform float uPixelScale;
uniform float uGust;
uniform float uBreath;
uniform float uClampFade;
uniform float uClampCap;
uniform float uSpread;      // cone half-angle growth per metre of reach
uniform vec2  uFar;         // range fade start, range fade end
uniform vec3  uHaze;        // haze start (m), haze end (m), strength
uniform vec4  uBand;
uniform float uBandMix;
uniform vec4  uBandShape;
uniform float uBandDecay;
uniform float uBandLift;    // how much the band ADDS to reach and rise

varying float vFade;
varying float vSeed;
varying float vHaze;
varying vec2  vStreak;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

float bandAt(float u) {
  float pre = smoothstep(-uBandShape.x, 0.0, u) * uBandShape.y;
  float core = smoothstep(0.0, uBandShape.z, u)
             * (1.0 - smoothstep(1.0, 1.0 + uBandShape.w, u))
             * (1.0 - uBandDecay * clamp(u, 0.0, 1.0));
  return clamp(max(pre, core), 0.0, 1.0);
}

void main() {
  vec2 wind = normalize(uWind.xy);
  float life = uLife * (0.7 + h11(aSeed + 2.1) * 0.6);
  float t = fract(uTime / life + h11(aSeed + 7.3));

  /* The set reaches the whole reef at once but 2.5 km of exposed
     arc is several sets wide, so the phase carries the along-wind
     position of the ORIGIN - which is what makes the reef pulse in
     sequence round the ring rather than in unison. Two rates whose
     ratio is not a small integer (0.31 / 0.1147 = 2.703), because
     a 2:1 or 3:1 ratio repeats on a visible period and the eye
     finds the loop inside ten seconds. */
  float travel = dot(aOrigin.xz, wind) * 0.010;
  float pulse = sin(uTime * 0.31 - travel) * 0.62
              + sin(uTime * 0.1147 - travel * 0.73) * 0.38;
  float surge = 1.0 + uGust * pulse;
  float breath = mix(1.0 - uBreath, 1.0, pulse * 0.5 + 0.5);

  /* The squall, sampled at the EMITTER rather than at the mote:
     the plume belongs to its crest, so the whole plume is inside
     the band or outside it. */
  float bu = (uBand.z - dot(aOrigin.xz, uBand.xy)) * uBand.w;
  float squall = mix(0.0, bandAt(bu), uBandMix);
  float lift = 1.0 + uBandLift * squall;

  float reach = uReach * aFlow * surge * lift;
  float rise = uRise * aFlow * surge * lift;

  vec3 p = aOrigin;
  /* Spread perpendicular to the wind and grow it with age: a plume
     is a cone, and a cone is what separates spray from a line of
     dots. */
  vec2 perp = vec2(-wind.y, wind.x);
  float age = t;
  p.xz += wind * age * reach;
  p.xz += perp * (h11(aSeed + 3.3) * 2.0 - 1.0) * (2.2 + age * reach * uSpread);
  /* Rise, then settle. Water thrown off a breaking crest is
     ballistic - it goes up fast and comes back down. A plume that
     only rises reads as smoke, and smoke off a reef is wrong in a
     way everyone can see without being able to name. */
  p.y += rise * age * (1.0 - age * 0.62) * 4.0;
  p.y += sin(uTime * 0.9 + aSeed * 5.0) * 0.5;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vHaze = smoothstep(uHaze.x, uHaze.y, d) * uHaze.z;
  vFade = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.62, 1.0, t))
        * aStrength * breath * (1.0 + uBandLift * squall * 0.5)
        * smoothstep(1.0, 14.0, d)
        * (1.0 - smoothstep(uFar.x, uFar.y, d))
        * (1.0 - vHaze * 0.5)
        /* Per-mote density; see FIELD_VERT. Mean 1.0. */
        * (0.46 + 1.08 * h11(aSeed + 8.8));
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;

  /* Streak axis: the analytic velocity of the trajectory above,
     differentiated with respect to age. Costs nothing and keeps a
     mote's long axis on the plume's own line even where the plume
     is still climbing off the break. */
  vec3 vel = vec3(wind.x, 0.0, wind.y) * reach
           + vec3(0.0, rise * 4.0 * (1.0 - 1.24 * age), 0.0);
  vec4 tip = projectionMatrix * (viewMatrix * vec4(p + vel * 0.06, 1.0));
  vec2 a0 = gl_Position.xy / max(gl_Position.w, 1e-4);
  vec2 a1 = tip.xy / max(tip.w, 1e-4);
  vec2 s = a1 - a0;
  s.y = -s.y;
  float sl = length(s);
  vStreak = sl > 1.0e-5 ? (s / sl) : vec2(1.0, 0.0);

  /* WHAT THE CLAMP COSTS, PAID BACK IN ALPHA.

     A plume seen from 900 m is a solid banner and seen from 60 m
     it is a scatter of hard white confetti - the same failure the
     field starts with, re-appearing at close range for the
     opposite reason. At 60 m an 8 m puff wants 209 px and draws
     26, so the plume covers sixty-five times the screen area with
     a sixty-fifth of the coverage per mote, and the motes stop
     overlapping.

     The clamp cannot be lifted - it is what keeps the bloom pass,
     which on this level is threshold 1.62 and is LOOKING for
     bright discs, from finding a 300 px one - so the mote is
     dimmed by how much of itself it had to give up. Exponent 1.15
     rather than the 2.0 that would conserve energy exactly: 2.0
     dissolves a plume you are standing next to into nothing, and
     standing in spray on the reef crest is the crest frame. */
  float want = aSize * uPixelScale / max(d, 0.4);
  vFade *= pow(clamp(want / 26.0, 1.0, uClampCap), -uClampFade);
  gl_PointSize = clamp(want, 1.0, 26.0);
}
`;

/* ------------------------------------------------------------
   ONE FRAGMENT SHADER FOR ALL FOUR VERTEX PATHS.

   `uSoft` is the falloff exponent and it is per field, because the
   three fields are three different substances. Kenosis measured
   its own: sand's 1.6 is a grain with an edge, snow's 2.6 is a
   smear, and 2.1 measured as "a field of soap bubbles" on the one
   frame that mattered. Spray is between - a puff of droplets does
   have an edge where it is dense - and pollen is nearly a grain.
   ------------------------------------------------------------ */

const MOTE_FRAG = /* glsl */`
precision highp float;
varying float vFade;
varying float vSeed;
varying float vHaze;
varying vec2  vStreak;
uniform vec3  uColourA;
uniform vec3  uColourB;
uniform vec3  uSky;
uniform float uOpacity;
uniform float uStretch;
uniform float uSoft;
void main() {
  if (vFade <= 0.002) discard;
  vec2 c = gl_PointCoord - 0.5;

  /* ANISOTROPY. Rotate the point's own coordinates into the frame
     of the streak axis and SCALE UP THE ACROSS-AXIS, which shrinks
     the mote across the streak and leaves its length alone.

     The direction of that division is the whole trick and Kenosis
     got it wrong the first time: dividing the ALONG axis instead
     grows the ellipse past the edge of the sprite quad, where
     gl_PointCoord stops at 0.5 and clips it - so the mote comes
     out exactly as wide as before with a slightly flatter falloff.
     The sprite quad is a hard bound and the [1, 26] clamp means
     length cannot be bought by growing the point; the only
     anisotropy available is to GIVE WIDTH AWAY. At stretch 5 a
     26 px mote draws 26 x 5.2 and costs a fifth of the fill. */
  vec2 q = vec2(dot(c, vStreak), dot(c, vec2(-vStreak.y, vStreak.x)));
  q.y *= uStretch;
  float r = dot(q, q) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, uSoft);
  /* Fade to nothing at the inscribed circle. The stretch keeps the
     ellipse inside the quad, but the quad's CORNERS are still
     reachable by a diagonal streak, and a mote clipped square is a
     rectangle the eye finds instantly. */
  float rc = dot(c, c) * 4.0;
  a *= 1.0 - smoothstep(0.62, 1.0, rc);
  vec3 col = mix(uColourA, uColourB, fract(vSeed * 0.37));
  col = mix(col, uSky, vHaze);
  gl_FragColor = vec4(col, a * vFade * uOpacity);
}
`;

function colourVec(THREE, hex) {
  const c = hexToRgb(hex);
  return new THREE.Vector3(srgb(c[0]), srgb(c[1]), srgb(c[2]));
}

/* ============================================================
   THE SQUALL

   The seed's best idea is that the squall is a FRONT, not a fade,
   and the whole of this block exists to keep it one.

   The band is an infinite strip across the wind, BAND_WIDTH metres
   deep along it, travelling downwind. `s` is the along-wind
   coordinate, `dot(p.xz, travelDir)`. The leading edge is at
   `leadS`; a point's position inside the band is
   `u = (leadS - s) / BAND_WIDTH`, so u = 0 at the leading edge,
   1 at the trailing edge and negative ahead of the front.

   FRONT_SPEED is 14 m/s. The trade is 8.5 m/s at sea level
   (ATOLL_WIND.baseSpeed) and a tropical squall line propagates at
   roughly 1.6x the ambient flow, because it is driven by its own
   cold outflow rather than carried by the wind. It is the one
   number that decides how long you can watch it come, so it is
   authored rather than derived and it is stated here:

     the leading edge crosses 4000 m of authored travel plus its
     own 1400 m of band = 5400 m at 14 m/s
       = 385.7 s, SIX MINUTES AND TWENTY-SIX SECONDS
       for a full crossing, edge appearing to last drop leaving;
     the band itself passes over a fixed point in
       1400 / 14 = 100.0 SECONDS.

   BAND_WIDTH is 1400 m against a 2048 m map, and that ratio is
   the point: at 5 km - a real squall line - the front fills the
   level and there is nothing to watch it arrive against. At 1400
   you can stand on the Bone Reef and watch it hit the Cauldron
   1250 m away, which is the image the seed asks for.

   THE SHAPE ACROSS THE BAND. A squall is not a top hat:
     - a gust front and a darkening run AHEAD of the rain. That is
       uBandShape.x/.y - 10% of the band, so 140 m and ten seconds
       of warning at 0.22 intensity;
     - the leading edge is HARD. Full intensity 77 m behind it,
       which is five and a half seconds. That is the visible edge
       and it is the reason the number is 0.055 rather than 0.2;
     - the heaviest rain is at the front and it decays behind it
       (uBandDecay 0.42, so the trailing edge runs at 0.58);
     - the back frays over 45% of the band, 630 m, because a squall
       does not end, it thins.
   ============================================================ */

const FRONT_SPEED = 14.0;          // m/s, downwind
const BAND_WIDTH = 1400;           // m along the wind
/* 2000 m either side of the origin. The atoll's own radius is
   1024 and the water apron reaches 2600, so this puts the leading
   edge clear of every camera in the level at both ends of the
   crossing - a front that starts visibly on-screen is a front that
   was switched on rather than one that arrived. */
const TRAVEL_HALF = 2000;
const TRAVEL_SPAN = TRAVEL_HALF * 2 + BAND_WIDTH;
const CROSSING_SECONDS = TRAVEL_SPAN / FRONT_SPEED;
const BAND_SHAPE = Object.freeze([0.10, 0.22, 0.055, 0.45]);
const BAND_DECAY = 0.42;

/** The band profile. THE SAME ARITHMETIC AS `bandAt` IN BOTH
 *  SHADERS - if these two ever disagree the rain will fall where
 *  the grade says it is dry, and nothing will name the cause. */
function bandProfile(u) {
  const sstep = (a, b, x) => {
    const t = clamp01((x - a) / Math.max(1e-6, b - a));
    return t * t * (3 - 2 * t);
  };
  const pre = sstep(-BAND_SHAPE[0], 0, u) * BAND_SHAPE[1];
  const core = sstep(0, BAND_SHAPE[2], u)
    * (1 - sstep(1, 1 + BAND_SHAPE[3], u))
    * (1 - BAND_DECAY * clamp01(u));
  return clamp01(Math.max(pre, core));
}

/* ============================================================ */

export function buildAtollWeather(ctx, world) {
  const { THREE, atmos, scene } = ctx;
  const field = ctx.terrain && ctx.terrain.field;
  const water = ctx.water || null;
  const render = ctx.render || null;
  const sky = ctx.sky || null;
  void world;

  const group = new THREE.Group();
  /* The name the probe's layer-isolation sweep looks for by
     string. atoll-qa's BULK_MESH_RE matches the CHILDREN by name -
     spray, pollen, rain - so both instruments see this field set
     without either of them being told about it. */
  group.name = "atoll-weather";
  scene.add(group);

  const fields = [];

  /* The sky colour every field hazes toward, BY REFERENCE - the
     atmos UNIFORM OBJECT itself, the same way uTime and uWind are
     taken, not a fresh { value } around its value. Wrapping it a
     second time type-checks, builds, and then throws inside
     three's setValueV3f on the first draw ("the object must have a
     callable @@iterator property"), because the uniform's value is
     then a uniform rather than a colour.

     art.js keeps uSkyHorizon in LINEAR space, exactly like
     colourVec, so the two mix with no transfer in between - and
     because it is a live reference the fields haze toward whatever
     the sky is doing at that hour for free. */
  const skyRef = atmos.uniforms.uSkyHorizon;

  /* The squall's travel direction, from the level's ONE wind
     vector. ATOLL_WIND.x/.z is already the unit TRAVEL vector for
     compass 258; taking it rather than re-deriving it from
     fromBearing is the whole of summit-terrain's recorded lesson
     about deriving a wind twice and disagreeing on the sign of z. */
  const bandDir = new THREE.Vector2(ATOLL_WIND.x, ATOLL_WIND.z).normalize();

  const bandVec = new THREE.Vector4(bandDir.x, bandDir.y, -1e9, 1 / BAND_WIDTH);
  const bandShapeVec = new THREE.Vector4(...BAND_SHAPE);

  /* ---------------------- camera-anchored ---------------------- */

  function makeField(opts) {
    const count = opts.count;
    const rng = makeRng(opts.seed);
    const pixelScale = opts.pixelScale ?? 96;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    const lo = sizeFor(opts.metres[0], pixelScale);
    const hi = sizeFor(opts.metres[1], pixelScale);
    /* SKEWED SMALL. A uniform size distribution gives every mote
       roughly the same footprint and the field reads as one stamp
       repeated; raising the variate to a power > 1 puts most motes
       at the fine end and keeps a few large ones for body. */
    const skew = opts.sizeSkew ?? 1;
    for (let i = 0; i < count; i += 1) {
      seed[i] = rng() * 1000;
      size[i] = lo + (hi - lo) * Math.pow(rng(), skew);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        /* BY REFERENCE. One write per frame into the atmosphere
           drives every mote in the level; a copy here would let
           the wind and the weather disagree. */
        uTime: atmos.uniforms.uTimeSF,
        uWind: atmos.uniforms.uWind,
        uAnchor: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...opts.box) },
        uRise: { value: opts.rise },
        uDrift: { value: opts.drift },
        uLifeScale: { value: opts.lifeScale ?? 1 },
        uPixelScale: { value: pixelScale },
        uCeil: { value: new THREE.Vector2(opts.ceil?.[0] ?? 1e6, opts.ceil?.[1] ?? 1e6) },
        uHug: { value: new THREE.Vector2(opts.hug?.[0] ?? 1e6, opts.hug?.[1] ?? 1e6) },
        uSheet: { value: new THREE.Vector3(...(opts.sheet ?? [0.1, 0, 0])) },
        uHaze: { value: new THREE.Vector3(...(opts.haze ?? [1e5, 2e5, 0])) },
        uGust: { value: opts.gust ?? 0.35 },
        uClampFade: { value: opts.clampFade ?? 0 },
        uClampCap: { value: opts.clampCap ?? 5 },
        uFoldY: { value: opts.foldY ? 1 : 0 },
        uWrapY: { value: opts.wrapY ? 1 : 0 },
        uStreakAxis: { value: opts.streakAxis ?? 0 },
        uStretch: { value: opts.stretch ?? 1 },
        uSoft: { value: opts.soft ?? 2.4 },
        /* THE SAME VECTOR OBJECT in every field, so one write per
           frame moves the front everywhere and no field can be a
           frame behind another about where the rain is. */
        uBand: { value: bandVec },
        uBandMix: { value: opts.bandMix ?? 0 },
        uBandShape: { value: bandShapeVec },
        uBandDecay: { value: BAND_DECAY },
        uSky: skyRef,
        uColourA: { value: colourVec(THREE, opts.colourA) },
        uColourB: { value: colourVec(THREE, opts.colourB) },
        uOpacity: { value: opts.opacity },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = opts.renderOrder ?? 9;
    points.name = opts.name;
    points.visible = opts.startHidden !== true;
    group.add(points);
    const entry = {
      name: opts.name, points, mat, base: opts.opacity, count, kind: "box",
      metres: opts.metres, refDist: opts.refDist ?? opts.box[0],
      groundAnchor: !!opts.groundAnchor, yBias: opts.yBias ?? 0,
    };
    fields.push(entry);
    return entry;
  }

  /* ============================================================
     SPRAY - the reef crest, and the field that does the work

     THE EMISSION LINE IS THE BREAK LINE, NOT THE CREST LINE.

     The terrain's reef crest stands +0.62 m out of the water and
     is DRY, so `water.breakAt` on the crest itself returns exactly
     zero everywhere - the same self-defeating sample Kenosis
     records for reading snow supply on the ridge that smokes. The
     wave trips on the fore-reef OUTBOARD of the crest, where the
     shoaling inequality H/d >= 0.78 first fires; atoll-water puts
     that at d = 3.2 m on the exposed arc, which on the measured
     profile (crest +0.62, fore-reef -5.5 at +45 m, a 1:7.3 slope)
     is about 28 m outboard. So each emitter walks outboard from
     its crest and takes the offset where `breakAt` PEAKS.

     Measured, walking the built field on 180 bearings outward-in
     from r = 1020:
       crest found on 175 of 180 bearings, world r 944-1002,
       crest y 0.50-0.64 (mean 0.62), fore-reef -5.4 to -6.7
       at +45 m,
       and NO CREST AT ALL on compass 348-356.
     That last line is a gift and it is why this scan is done
     outward-in rather than by a radial window: the atoll has a
     BREACH, ten degrees of it, and a spray ring that simply stops
     there is the cheapest possible answer to the rubric's
     structural "bagel" tell. A radial window over [900, 1024]
     finds the ISLAND instead of the crest on every bearing from
     145 to 340 - it reported crest heights up to 8.69 m - because
     the ring's dR warp pushes the island's own shoulder past
     r = 900 on the south-west. Outward-in cannot make that
     mistake: outboard of the crest the ground is always at -5 m.
     ============================================================ */

  /* 0.6 degrees. At the crest's mean radius of 970 m that is 10.2 m
     of arc per node, which is finer than a mote is wide at any
     distance the reef is looked at from - so the emission line is
     a LINE and not a dotted one. Kenosis's recorded failure was
     "34 motes leaving one point make a cone; real spindrift leaves
     a RIDGE", and a ring is the easy case of that. */
  const BEARING_STEP = 0.6;
  const SCAN_OUT = 1020;             // start outboard of every crest
  const SCAN_IN = 890;               // give up inboard of every crest
  const CREST_MIN_Y = -0.10;         // above this counts as crest, not flat
  /* Where to look for the break, in metres outboard of the crest.
     6 m is inside the crest's own shoulder and 54 m is past the
     -5.5 m fore-reef, so the peak is bracketed on every bearing. */
  const BREAK_FROM = 6;
  const BREAK_TO = 54;
  const BREAK_STEP = 4;
  /* Below this a plume is fill, not a picture. aStrength multiplies
     straight into vFade, so an emitter at 0.08 draws at about 3%
     alpha and still costs its full share of the mote budget
     because the field is frustumCulled = false. Kenosis spent a
     fifth of its budget on plumes that were not there. */
  const SPRAY_MIN_SCORE = 0.12;
  const SPRAY_MOTES = 16000;

  const crestNodes = [];
  let crestGaps = 0;
  let breakSampled = 0;
  {
    /* The scan exploits the ring's continuity: after the first
       bearing it starts 30 m outboard of the previous hit instead
       of at SCAN_OUT, which takes the build from about 99,000
       heightAt calls to about 24,000. */
    let lastHit = SCAN_OUT;
    for (let b = 0; b < 360; b += BEARING_STEP) {
      const s = Math.sin(b * DEG);
      const c = -Math.cos(b * DEG);
      const from = Math.min(SCAN_OUT, lastHit + 30);
      let hit = -1;
      for (let r = from; r >= SCAN_IN; r -= 1) {
        if (field.heightAt(r * s, r * c) > CREST_MIN_Y) { hit = r; break; }
      }
      if (hit < 0) { crestGaps += 1; continue; }
      lastHit = hit;
      /* Refine to the local maximum. The first sample above water
         walking inward is the SEAWARD SHOULDER of the crest, not
         its top; the top is a few metres further in. */
      let crestY = -1e9;
      let crestR = hit;
      for (let r = hit - 26; r <= hit + 8; r += 1) {
        const y = field.heightAt(r * s, r * c);
        if (y > crestY) { crestY = y; crestR = r; }
      }

      /* EXPOSURE. The outward normal at compass b is (sin b, -cos b)
         and the wind arrives from ATOLL_WIND.fromBearing, so the
         exposure is just cos(b - fromBearing). This is the term
         that makes the ring ASYMMETRIC, which is worth as much to
         the "bagel" tell as the breach is: at 0.20 + 0.80 * expo
         the spray dies at expo <= -0.25, so it runs from compass
         333.5 round through 78 to 182.5 - 209 degrees of white
         water and 151 degrees of dry lee. Trade winds are why the
         atoll has the shape it has; they should also be why it
         has the outline it has. */
      const expo = Math.cos((b - ATOLL_WIND.fromBearing) * DEG);
      const we = clamp01(0.20 + 0.80 * expo);
      if (we <= 0) continue;

      /* A crest that has sunk below the waterline has nothing to
         throw. Always 1 on the built field (crest y 0.50-0.64);
         it is here so a re-authored profile that drowns the crest
         turns the spray OFF rather than emitting it underwater. */
      const prom = clamp01((crestY - SEA_Y + 0.35) / 0.80);

      /* THE BREAK, from the water module rather than re-derived.
         atoll-water owns the shoaling inequality and the shelter
         term; this file owning a second copy of them is exactly
         the divergence INTERFACES section 12 forbids. */
      let brk = 0;
      let brkOff = 28;
      if (water && typeof water.breakAt === "function") {
        for (let o = BREAK_FROM; o <= BREAK_TO; o += BREAK_STEP) {
          const v = water.breakAt((crestR + o) * s, (crestR + o) * c);
          breakSampled += 1;
          if (v > brk) { brk = v; brkOff = o; }
        }
      } else {
        /* THE FALLBACK, and it is measured rather than guessed.
           If the water module is absent or has not published
           breakAt, walk out to where the water is 3.2 m deep -
           atoll-water's own break depth on the exposed arc - and
           emit there at three quarters strength. A missing
           dependency must degrade the field, not delete it. */
        for (let o = BREAK_FROM; o <= BREAK_TO; o += BREAK_STEP) {
          const d = SEA_Y - field.heightAt((crestR + o) * s, (crestR + o) * c);
          if (d >= 3.2) { brkOff = o; break; }
        }
        brk = 0.75;
      }

      /* 0.45 + 0.55 * break rather than break alone: the crest is
         a standing obstruction and there is white water on it even
         between sets. A field gated entirely on the instantaneous
         break scalar flickers the whole ring on and off with the
         swell phase, which is a strobe, not surf. */
      const score = we * prom * (0.45 + 0.55 * brk);
      if (score < SPRAY_MIN_SCORE) continue;

      const ox = (crestR + brkOff) * s;
      const oz = (crestR + brkOff) * c;
      crestNodes.push({
        b, x: ox, z: oz, r: crestR + brkOff, crestY, score, expo, brk, brkOff,
      });
    }
  }

  let spray = null;
  const SPRAY_METRES = [3.6, 12.0];
  /* THE CLAMP PAYBACK IS CAPPED AT 5x OVER THE CLAMP, and the cap
     is a measurement rather than a taste.

     Kenosis's plumes were looked at from 250 to 900 m, where a
     13.5 m puff is at most 3.3x over the [1, 26] clamp and the
     uncapped payback costs it a factor of four. This reef is
     looked at from 10 m - the crest is walkable - to 1790 m, and
     at 10 m an 8 m puff wants 1256 px and is 48x over. Uncapped,
     the payback dims it by 48^-1.15 = 1/93, which is why the first
     capture of this field measured dSigma 0.000 and touchedPct
     0.00 on the crest camera: the near motes were being drawn at
     half a per cent of an already low alpha.

     Past about 5x the model has broken down anyway - a puff that
     wants 1256 px is not a point sprite, it is a volume - and the
     choice at that point is between legibility and an arithmetic
     that no longer describes anything. 5^-1.15 = 0.155 still takes
     six sevenths of the near motes away, which is what stops them
     reading as a row of identical maximum-size discs. */
  const SPRAY_CLAMP_CAP = 5.0;
  /* PIXEL_SCALE only sets the magnitude of aSize - it cancels out
     of the drawn diameter, which is metres * 1570 / d. 430 puts
     aSize near 1 for a 10 m puff, which is where a Float32
     attribute is happiest. */
  const SPRAY_PIXEL_SCALE = 430;
  {
    /* Motes are distributed over the nodes BY WEIGHT, so the
       taper round the ring is a real density taper and not a
       per-node alpha - which is Kenosis's crest-line lesson
       applied to a closed curve. */
    let wSum = 0;
    for (const n of crestNodes) wSum += n.score;
    if (crestNodes.length && wSum > 0) {
      const count = SPRAY_MOTES;
      const rng = makeRng(0x5b7a17);
      const origin = new Float32Array(count * 3);
      const strength = new Float32Array(count);
      const flow = new Float32Array(count);
      const seed = new Float32Array(count);
      const size = new Float32Array(count);
      const pos = new Float32Array(count * 3);
      const sLo = sizeFor(SPRAY_METRES[0], SPRAY_PIXEL_SCALE);
      const sHi = sizeFor(SPRAY_METRES[1], SPRAY_PIXEL_SCALE);
      /* FLAT, and the constant is named because the next person
         will have the same idea Kenosis had. Skewing the sizes
         small is right for a box field and it LOST to the
         measurement on a plume: at a low floor and a 1.35 skew the
         plume stopped being spray and became GLITTER - a spray of
         individually resolvable specks - which measured at 0.61
         frame sigma against the cohesive version's 1.79. A plume
         at a kilometre has one job and it is to hold together. */
      const SIZE_SKEW = 1.0;
      for (let i = 0; i < count; i += 1) {
        let pick = rng() * wSum;
        let node = crestNodes[0];
        for (let n = 0; n < crestNodes.length; n += 1) {
          pick -= crestNodes[n].score;
          if (pick <= 0) { node = crestNodes[n]; break; }
        }
        /* Jitter along the ring by half a node spacing so the
           emitters do not read as 500 discrete points, and across
           it by the width of the break band. */
        const tang = [Math.cos(node.b * DEG), Math.sin(node.b * DEG)];
        const along = rng.jit(5.6);
        const across = rng.jit(9.0);
        origin[i * 3] = node.x + tang[0] * along + (node.x / node.r) * across;
        /* Just above the water at the break, NOT on the crest:
           this is spray thrown by a wave that is tripping over the
           fore-reef, and the fore-reef is under water. */
        origin[i * 3 + 1] = SEA_Y + 0.55 + rng.jit(0.9);
        origin[i * 3 + 2] = node.z + tang[1] * along + (node.z / node.r) * across;
        strength[i] = node.score;
        /* The wind gradient, read by something. At sea level this
           is 1.0 by construction; it exists so that if the reef is
           ever raised the plumes lengthen with the wind that
           actually blows there. */
        flow[i] = Math.max(0.6, atollWindSpeed(SEA_Y + 1) / ATOLL_WIND.baseSpeed);
        seed[i] = rng() * 1000;
        size[i] = sLo + (sHi - sLo) * Math.pow(rng(), SIZE_SKEW);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aOrigin", new THREE.BufferAttribute(origin, 3));
      geo.setAttribute("aStrength", new THREE.BufferAttribute(strength, 1));
      geo.setAttribute("aFlow", new THREE.BufferAttribute(flow, 1));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: atmos.uniforms.uTimeSF,
          uWind: atmos.uniforms.uWind,
          /* Peak lift is uRise * 1.61 (the maximum of the
             ballistic term), so 8.0 tops a full-strength plume out
             12.9 m over the water. That is what a 2 m swell
             tripping on a 1:7 fore-reef actually throws, and it is
             also the smallest lift that still CLEARS THE CREST at
             a kilometre: spray that touches the reef reads as foam
             stuck to the reef, which is Kenosis's recorded
             "cotton-wool plastered over the peak" defect with the
             mountain taken away. */
          uRise: { value: 4.6 },
          /* 62 m of reach at a 3.4 s life is 18 m/s along the
             wind - the 8.5 m/s trade plus the wave's own launch,
             which is most of the speed at the start of the arc.
             After the tail fade it DRAWS 50 m, which at the
             Landing's 1790 m viewing distance is a 44 px band and
             at the `crest` camera's own reef it is the near
             foreground. `drawnLength` in status() is that number,
             so the next person to argue the plumes are too short
             has one to argue with. */
          uReach: { value: 62 },
          uLife: { value: 3.4 },
          uPixelScale: { value: SPRAY_PIXEL_SCALE },
          uGust: { value: 0.55 },
          uBreath: { value: 0.60 },
          uClampFade: { value: 1.15 },
          uClampCap: { value: SPRAY_CLAMP_CAP },
          /* 0.16 rather than the summit's 0.115: spray off a reef
             fans much wider than spindrift off an arete, because
             the wave is throwing it in every direction at once and
             only the wind sorts it out. At a 62 m reach that is a
             12.1 m half-width at the tail. */
          uSpread: { value: 0.105 },
          /* Moved right out. The level's longest sightline that
             contains reef is the Landing to the north crest at
             1790 m, and the aerial poses look across 2 km of ring.
             Kenosis shipped a 1500 m gate on a 2 km map and faded
             its plumes out at exactly the distance the art
             direction says they have to survive. */
          uFar: { value: new THREE.Vector2(2600, 3400) },
          /* Marine haze is much thicker than alpine - fogDensity
             0.00072 against Kenosis's alpine air - and it is this
             level's depth cue. A plume at 1800 m that is still
             full-contrast white in front of a hazed reef is the
             tell "no atmosphere" all by itself. */
          uHaze: { value: new THREE.Vector3(260, 2200, 0.72) },
          /* Round. A plume's shape comes from the emitter line and
             the cone; squashing each puff across the plume only
             throws away the coverage that stops it coming apart
             into dots. */
          uStretch: { value: 1.0 },
          uSoft: { value: 2.60 },
          uBand: { value: bandVec },
          uBandMix: { value: 1 },
          uBandShape: { value: bandShapeVec },
          uBandDecay: { value: BAND_DECAY },
          /* The squall raises the sea state: atoll-water runs
             SWELL_STORM 1.55 and WIND_STORM 2.07, so the break
             line moves out and the reef becomes a solid white
             band. 0.55 on reach and rise is the airborne half of
             that, and it is deliberately less than the water's
             1.55 because a plume that doubles in length reads as a
             different effect rather than as the same one harder. */
          uBandLift: { value: 0.55 },
          uSky: skyRef,
          /* NOT WHITE AT BOTH ENDS, and this is the trap named in
             the header. The spray's two backgrounds are sunlit
             foam at 1.9 linear and the marine horizon haze at
             #cfe4f2 - both of them brighter than most of the
             frame - and a near-white mote under NormalBlending
             over either of them composites to it and VANISHES.
             K.foam is the bright end and reads against dark water,
             the reef flat's shadow and the sky above the horizon
             band; #8fa4ad is a genuine mid, and it is the half of
             the field that exists at all when the plume is drawn
             against the haze. Real spray does the same thing for
             the same reason - a cloud of droplets seen against a
             brighter background is a grey veil, and only against a
             darker one is it white. */
          uColourA: { value: colourVec(THREE, K.foam) },
          uColourB: { value: colourVec(THREE, "#8fa4ad") },
          /* 0.62, and it is DERIVED rather than dialled.

             What reads is the accumulated coverage, not the
             per-mote alpha, and the accumulation is
             1 - (1 - p)^N over N overlapping motes. Measured on
             the built field at the atoll pose, the near reef arc
             is about 700 m away, one 10 m node of crest projects a
             band of roughly 1000 px, and the 38 motes that node
             carries put about 7 of them over any given pixel.

             p is the product of four things this field cannot
             change and one it can: the fragment falloff averages
             pow(1-r, 2.1) = 1/3.1 over the sprite; the age fades
             average 0.78; the breath averages 0.7; the haze term
             costs 0.68 at a kilometre. That is p = 0.088 * uOpacity
             on the windward arc, where aStrength is 1.

             For a plume core at 33% - dense enough to read as
             water and transparent enough not to occlude the reef
             it is leaving, which is Kenosis's recorded cotton-wool
             failure - p must be 0.055, so uOpacity is 0.62. The
             first draft shipped 0.20 by analogy with Kenosis's
             0.15 and measured dSigma -0.07 and 0.65% of pixels
             touched on the arrival frame. Kenosis's number is not
             transferable: its spindrift is 20,000 motes on 175 m
             plumes over one mountain, and this is 11,000 on 62 m
             plumes over 2.5 km of ring. */
          uOpacity: { value: 0.30 },
        },
        vertexShader: PLUME_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      /* 8, under the box fields' 9. Spray is the far field and the
         two box fields are near the camera; drawing the near ones
         last is the correct order for alpha that does not write
         depth. */
      points.renderOrder = 8;
      points.name = "spray";
      group.add(points);
      spray = {
        name: "spray", points, mat, base: 0.30, count, kind: "crest",
        metres: SPRAY_METRES, refDist: 1790, groundAnchor: false, yBias: 0,
      };
      fields.push(spray);
    }
  }

  /* ============================================================
     POLLEN AND INSECTS - the jungle's own air

     Warm, tiny, slow, and gated on the ground under the viewer the
     way Kenosis gates its ground blizzard on snow supply. A
     constant field is a constant overlay: at a density that reads
     in the Drowned Nave's closed canopy it would put chaff over
     the open lagoon, which is where this level's eye actually goes.
     ============================================================ */

  const pollen = makeField({
    name: "pollen", seed: 0x0901e2, count: 2200,
    /* 30 m, after the same argument Kenosis's box had. A pollen
       shaft is a NEAR-FIELD phenomenon: it exists in the twenty
       metres of air you can see individual specks in, and past
       that it is the canopy's own light doing the work. The radial
       fade has to reach zero at the fold, so a bigger box is
       already half-faded where the motes are wanted. 9 m of
       half-height puts the band from 9 m under the camera to 9 m
       over it, which spans the understorey. */
    box: [30, 9, 30], metres: [0.020, 0.075], pixelScale: 96, sizeSkew: 1.3,
    /* Rises. Chaff and pollen in a warm understorey go UP, on the
       thermal off the litter, and that alone separates this field
       from the rain at a glance. Drift is a quarter of the trade
       because under a closed canopy the wind is broken - that is
       why a jungle floor is still air with things hanging in it. */
    rise: 0.26, drift: 2.1, lifeScale: 2.6, gust: 0.18,
    /* No sheets. A rain curtain bands; pollen does not. */
    sheet: [0.1, 0, 0],
    /* WORLD-WRAPPED IN Y so you can climb the Roost's 62 m
       platform out of it, and so it does not ride the jetpack up
       with you. Its ceiling is a backstop rather than the story -
       the supply term below is what actually turns it off over
       water, sand, basalt and ash. 48 m is over the emergent
       crowns at about 40 m. */
    wrapY: true,
    ceil: [48, 76],
    /* Round specks on their own drift lines. At zero stretch 2200
       motes read as static; much more than this and a pollen grain
       becomes a dash, which is rain. */
    stretch: 1.35,
    /* Nearly a grain rather than a smear - closer to Vesper's sand
       at 1.6 than to Kenosis's snow at 2.6. A speck in a light
       shaft does have an edge. */
    soft: 1.95,
    /* Short, because the jungle interior is the level's darkest
       place and the far end of a 30 m box is already in it. */
    haze: [14, 90, 0.5],
    /* THE PAIR IS DELIBERATELY BIMODAL, and this is the "a flake
       is not always brighter than the ground" lesson in its
       tropical form. Half of what is hanging in a jungle shaft is
       pale chaff, which reads against loam at albedo 0.05; the
       other half is a gnat, which is a dark speck and reads
       against a sunlit leaf or a gap of bright sky. A field that
       was pale at both ends would be invisible in every frame that
       looks UP, which is most of the frames the canopy is in.
       The pale end sits at hue 52 and the dark at 46 - both well
       clear of the 165-195 water band, which is the level's one
       rationing rule. */
    colourA: "#e6dfa4", colourB: "#3a3520",
    opacity: 0.34,
    clampFade: 0.20,
    renderOrder: 9,
  });

  /* ============================================================
     RAIN - squall-gated, world-anchored

     The one field that is not on all the time, and the only one
     whose density is a property of WHERE THE FRONT IS rather than
     of where the player is standing.
     ============================================================ */

  const rain = makeField({
    name: "rain", seed: 0x7a11, count: 15000,
    /* 34 x 22 x 34, after 56 x 30 x 56.

       Heavy rain means HUNDREDS of streaks in frame, and a box is
       the wrong shape to buy that with count: only about 15% of a
       box's motes land inside a 66-degree frustum, so 9000 motes
       in a 112 m box measured 2.9% of the arrival frame touched
       and read as three hairs. Shrinking the box does two things
       at once - every mote is nearer, so it draws roughly twice as
       long in pixels, and the same budget is 5x the density - and
       it costs only the far rain, which at 0.26 m and 120 m is
       2.9 px and was never carrying the picture. The distance is
       carried by the squall grade and the fog, which is where a
       photograph of rain carries it too.

       The HEIGHT is what the jetpack made load-bearing: welded in
       y, rain cannot fall past you and you cannot rise through it,
       and Kenosis shipped exactly that. 22 m of half-height is a
       44 m column, so from the Spine's 34 m crown there is still
       rain between you and the water. */
    /* MOTE SIZE IS A MOTION-BLUR STREAK LENGTH, NOT A DROP.
       The first draft carried [0.018, 0.062] by analogy with
       Kenosis's snowfall and measured as 41.5% of the lagoon frame
       TOUCHED and nothing visible in it - 1.7 px hairs at the fold
       radius, changing pixels by less than a luma level each.
       A snowflake is a 2 cm object seen at rest; a raindrop is a
       4 mm object travelling at 9.5 m/s, and at any shutter a game
       implies (1/48 s) it draws a 0.20 m STREAK. So the size is
       the streak length, the stretch gives it back its width, and
       the range spans the drop sizes a squall carries. At 20 m the
       coarse end draws 17 px by 3; at 60 m, 5.8 by 1. */
    box: [34, 22, 34], metres: [0.070, 0.26], pixelScale: 96, sizeSkew: 1.25,
    /* -9.5 m/s of fall against 8.0 m/s of horizontal drift is a
       slant of 40 degrees off vertical. Terminal velocity for a
       2 mm drop is about 6.5 m/s and for a 5 mm drop about 9 m/s;
       the drift is under the squall's 17.6 m/s wind because rain
       never reaches the wind speed. A vertical rain under a
       17 m/s squall is the single most common way a game gets
       rain wrong. */
    rise: -9.5, drift: 8.0, lifeScale: 0.9, gust: 0.5,
    /* CURTAINS. Wavelength 2*pi/0.16 = 39 m, so two or three are
       inside the box at once and the field is not one uniform
       veil. The travel rate is deliberately NOT the drift rate -
       at 5.2 against the rain's 8.0 the drops overtake the
       curtains, so a drop passes THROUGH bands instead of living
       in one, which is what a gust front does. */
    sheet: [0.16, 5.2, 0.55],
    wrapY: true,
    /* VELOCITY AXIS, not the horizon. See the note in FIELD_VERT:
       Kenosis's ground blizzard needs the horizon because it is
       snow sheared along a surface and its velocity degenerates
       looking downwind. Rain falls, so its screen-space velocity
       is large from every camera in this level, and rain streaked
       along the horizon is a screen wipe. */
    streakAxis: 1,
    /* 5.6. A raindrop at any shutter speed a game implies is a
       DASH. The stretch narrows the mote across the streak rather
       than lengthening it along it (the quad is a hard bound), so
       it also costs a fifth of the fill a round mote of the same
       point size would - which is what makes 9000 of them
       affordable. */
    stretch: 5.6,
    soft: 2.20,
    haze: [18, 60, 0.7],
    /* Same rule as the spray and for the same reason: rain seen
       against a bright squall sky is DARKER than the sky, and rain
       seen against the jungle or a hull shadow is brighter. Both
       ends exist so the field survives both backgrounds. */
    colourA: "#dae5ea", colourB: "#77878f",
    /* The base. update() multiplies this by the band intensity at
       the camera, so it is never the live value. */
    opacity: 0.62,
    clampFade: 0.22,
    /* Fully band-gated: this is the field the squall IS. */
    bandMix: 1,
    /* HIDDEN, not faded, until a squall is near. uOpacity = 0
       still rasterises nine thousand points every frame, and this
       level is fill-bound. It shares its program with the pollen -
       same vertex and fragment source, so three's program cache
       hands it the compiled one - so the frame it first becomes
       visible costs no compile. */
    startHidden: true,
    renderOrder: 10,
  });

  /* --------------------------- runtime --------------------------- */

  let visible = true;
  let manualStorm = 0;        // what setStorm was last given
  let liveStorm = 0;          // what the atmosphere is actually at
  let squallPos = null;       // null = disengaged
  let squallRunning = false;
  let leadS = -TRAVEL_HALF;
  let bandAtPlayer = 0;
  let bandNear = 0;
  let appliedStorm = -1;
  let appliedSky = -1;
  let drivingAtmos = false;

  const anchor = new THREE.Vector3();
  let groundY = 0;

  /* ------------------------------------------------------------
     THE JUNGLE SUPPLY

     The same shape as Kenosis's snow supply and for the same
     reason. Two details that are not optional:
       - the sample is THROTTLED to a 3 m camera move, because
         surfaceAt costs about twenty heightAt lookups between its
         slope and curvature hints and this runs every frame;
       - and then SMOOTHED with a time constant, so that throttle
         can never produce a step. A jump in a field's opacity is
         the same class of bug as the 8 m anchor snap in the
         header: invisible standing still, obvious walking.
     ------------------------------------------------------------ */
  const SUPPLY_RESAMPLE = 3;        // m of camera travel
  const SUPPLY_TAU = 1.6;           // s
  let supply = 0;
  let supplyTarget = 0;
  let supplyX = Infinity;
  let supplyZ = Infinity;

  function sampleSupply(x, z) {
    if (!field || typeof field.surfaceAt !== "function") return 0;
    const s = field.surfaceAt(x, z);
    /* loam is the jungle floor and mud is the mangrove; those are
       the two surfaces with plants standing on them. The floor of
       0.06 keeps a trace over the whole island - a beach behind a
       palm line still has chaff blowing over it - and it is zero
       over water, which is where three quarters of this level's
       up-facing area is and where this field must not appear. */
    const green = clamp01((s.loam || 0) + (s.mud || 0));
    /* AND IT MUST BE ZERO OVER WATER. Three quarters of this
       level's up-facing area is sea, and the first capture measured
       this field touching 40.4% of the crest frame at an opacity of
       0.020 - a dirty veil laid over the ocean, which is the one
       surface the whole colour plan is protecting. `surfaceAt` does
       not answer this on its own: the seabed under eight metres of
       lagoon still classifies as sand or reef, so the reader has to
       be the depth. 0.4 m is the swash, so a mote can still blow
       out over the last of the wet sand and no further. */
    const dry = 1 - clamp01((field.waterDepthAt ? field.waterDepthAt(x, z) : 0) / 0.4);
    /* NO FLOOR. The first draft carried 0.05 "because a beach
       behind a palm line still has chaff blowing over it" and that
       floor, times 2200 motes in a 30 m box, measured as +0.378
       luma across the whole crest frame - a veil over the ocean
       bought for an argument about a beach. If a place has no
       plants it gets no pollen.

       0.45 is what a fully closed jungle floor measures on the
       built field: loam runs 0.26 to 0.49 on the island interior
       and never reaches 1, because the classifier splits the
       ground between loam and its sand residual. Normalising
       against the measured maximum rather than against 1 is the
       difference between this field existing and not. */
    return clamp01(green * 2.2) * dry;
  }

  /* ------------------------------------------------------------
     DRIVING THE ATMOSPHERE FROM THE FRONT

     This is the part that makes the squall a place. atoll-main's
     `setStorm` is the MANUAL control and it calls this module's
     setStorm; if this module also called main's there would be a
     loop. So the split is:

       setStorm(v)   sets a FLOOR. It never touches the atmosphere,
                     because whoever called it has already done so.
       setSquall(p)  engages the front. While it is engaged, this
                     module owns the storm value and drives
                     atmos.setStorm from the band intensity AT THE
                     PLAYER - which is the whole difference between
                     a front and a fade.

     The effective storm is max(floor, band), so a harness that
     pins storm 0.4 and then runs a crossing still sees the front
     move over the top of it.

     Two throttles, because the two consumers cost very different
     amounts. atmos.setStorm plus render.applyAtmosphere is a
     couple of dozen uniform writes and can run at 0.02 of storm
     (about 200 calls across a 386 s crossing, under one a second).
     sky.refresh() repaints four cloud layers' vertex colours and
     water.setStorm re-derives the hour's tables, so those run at
     0.08 - twenty-five times across a crossing, which is under the
     step the eye can find in a cloud.

     applyAtmosphere does NOT clobber the atoll post chain:
     checked against render.js, it writes exposure, lift, gamma,
     gain, saturation, toe, shade, bounce, ao.y/z, the tints and
     the halo tint, and none of uThreshold, uContactGain,
     uVignette or uHaloAmount, which are the four atoll-main sets.
     ------------------------------------------------------------ */
  const STORM_APPLY_STEP = 0.02;
  const STORM_HEAVY_STEP = 0.08;

  function applyStorm(v, force) {
    const s = clamp01(v);
    liveStorm = s;
    if (!force && Math.abs(s - appliedStorm) < STORM_APPLY_STEP) return;
    appliedStorm = s;
    if (atmos.setStorm) atmos.setStorm(s);
    if (render && render.applyAtmosphere) render.applyAtmosphere(atmos);
    if (force || Math.abs(s - appliedSky) >= STORM_HEAVY_STEP) {
      appliedSky = s;
      if (water && water.setStorm) water.setStorm(s);
      if (sky && sky.refresh) sky.refresh();
    }
  }

  /** Where the leading edge is, for a normalised crossing
   *  position. pos 0 puts it TRAVEL_HALF upwind of the origin;
   *  pos 1 puts the trailing edge TRAVEL_HALF downwind of it. */
  function leadForPos(p) {
    return lerp(-TRAVEL_HALF, TRAVEL_HALF + BAND_WIDTH, clamp01(p));
  }

  /** Band intensity at a world point. */
  function bandAtPoint(x, z) {
    if (squallPos === null) return 0;
    const s = x * bandDir.x + z * bandDir.y;
    return bandProfile((leadS - s) / BAND_WIDTH);
  }

  function writeBand() {
    bandVec.z = squallPos === null ? -1e9 : leadS;
  }
  writeBand();

  /* The spray's own response to the manual storm floor, banked
     rather than written, because update() multiplies it by
     nothing and setSquall multiplies it by nothing either - the
     per-emitter band term inside PLUME_VERT does that work. */
  let sprayDensity = spray ? spray.base : 0;
  let pollenDensity = pollen.base;

  return {
    group,

    update(dt, camera) {
      if (!visible || !camera) return;
      anchor.copy(camera.position);
      groundY = field ? field.heightAt(anchor.x, anchor.z) : 0;

      /* --- the front advances ------------------------------------ */
      if (squallPos !== null && squallRunning && dt > 0) {
        squallPos = Math.min(1, squallPos + (dt * FRONT_SPEED) / TRAVEL_SPAN);
        leadS = leadForPos(squallPos);
        writeBand();
      }

      /* --- where the player is inside it -------------------------- */
      if (squallPos === null) {
        bandAtPlayer = 0;
        bandNear = 0;
      } else {
        bandAtPlayer = bandAtPoint(anchor.x, anchor.z);
        /* The BOX, not the point. The rain's box is 56 m in xz, so
           the leading edge is inside it for four seconds before it
           reaches the camera - and those four seconds of watching
           a wall of rain cross the near field are the only reason
           the per-mote band term exists. Sampling the camera alone
           would hide the field for exactly the moment it is worth
           the most. */
        const s = anchor.x * bandDir.x + anchor.z * bandDir.y;
        const half = 56;
        bandNear = Math.max(
          bandProfile((leadS - (s - half)) / BAND_WIDTH),
          bandProfile((leadS - s) / BAND_WIDTH),
          bandProfile((leadS - (s + half)) / BAND_WIDTH)
        );
      }

      /* --- the atmosphere, if the front owns it ------------------- */
      if (drivingAtmos) applyStorm(Math.max(manualStorm, bandAtPlayer), false);

      /* --- the jungle supply -------------------------------------- */
      if (Math.hypot(anchor.x - supplyX, anchor.z - supplyZ) > SUPPLY_RESAMPLE) {
        supplyX = anchor.x;
        supplyZ = anchor.z;
        supplyTarget = sampleSupply(supplyX, supplyZ);
      }
      const k = dt > 0 ? 1 - Math.exp(-dt / SUPPLY_TAU) : 1;
      supply += (supplyTarget - supply) * k;

      /* Pollen is knocked out of the air by rain, which is true and
         is also the cheapest way to stop two fields competing for
         the same near-field pixels during a squall. */
      const wet = Math.max(liveStorm, bandNear);
      const pollenLive = pollenDensity * supply * lerp(1, 0.12, wet);
      pollen.mat.uniforms.uOpacity.value = pollenLive;
      /* HIDDEN, not faded, for the same reason the rain is: 2200
         points still rasterise at uOpacity 0, and over water - most
         of this level - there is nothing for them to be. 0.004 is
         a quarter of the alpha at which a mote changes a pixel by
         one luma level at all. */
      const pollenOn = pollenLive > 0.004;
      if (pollen.points.visible !== pollenOn) pollen.points.visible = pollenOn;

      /* --- the rain gate ------------------------------------------ */
      const rainOn = bandNear > 0.015;
      if (rain.points.visible !== rainOn) rain.points.visible = rainOn;
      if (rainOn) {
        /* The per-mote band term inside the shader already shapes
           the field across the front; this is only the global
           level, and it is deliberately NOT bandNear - multiplying
           by it a second time would undo the shader's own gradient
           and flatten the leading edge, which is the whole field. */
        rain.mat.uniforms.uOpacity.value = rain.base;
        /* THE DRIFT HAS TO FOLLOW THE FRONT, NOT THE MANUAL FLOOR.
           setStorm() only ever sees the manual value, and during a
           squall crossing that is usually 0 - so a rain drift set
           there stays at its fair-weather number while the water
           beneath it is running atoll-water's WIND_STORM 2.07.
           Vertical rain under a 17.6 m/s wind is the commonest way
           a game gets rain wrong, and it would have shipped. */
        rain.mat.uniforms.uDrift.value = lerp(6.0, 12.5, wet);
        rain.mat.uniforms.uGust.value = lerp(0.5, 0.85, wet);
      }

      /* --- anchors. UNSNAPPED. ------------------------------------ */
      for (const f of fields) {
        if (f.kind !== "box") continue;
        /* See the header - the 8 m snap is the bug this whole model
           exists to avoid. A ground anchor is not a snap: it is a
           continuous function of the camera's xz, so it slides with
           the camera instead of stepping. */
        const u = f.mat.uniforms.uAnchor.value;
        u.set(anchor.x, f.groundAnchor ? groundY + f.yBias : anchor.y, anchor.z);
      }
    },

    /** The MANUAL storm floor. Does not touch the atmosphere -
     *  atoll-main's setStorm has already done that, and calling it
     *  back from here would be a loop. */
    setStorm(v) {
      manualStorm = clamp01(v);
      if (!drivingAtmos) liveStorm = manualStorm;
      /* The spray goes up in a storm because the sea state does,
         but only by half: atoll-water runs SWELL_STORM 1.55 and
         the airborne half of that is deliberately smaller, because
         a plume that doubles in length reads as a different effect
         rather than as the same one harder. */
      sprayDensity = lerp(spray ? spray.base : 0, (spray ? spray.base : 0) * 1.55, manualStorm);
      if (spray) {
        spray.mat.uniforms.uOpacity.value = sprayDensity;
        /* The gust deepens with the storm; the BREATH shallows.
           In a full squall the reef is white continuously rather
           than in sets, and keeping the pulse at full depth is
           what makes a video-game storm look like a strobe. */
        spray.mat.uniforms.uGust.value = lerp(0.55, 0.85, manualStorm);
        spray.mat.uniforms.uBreath.value = lerp(0.60, 0.28, manualStorm);
      }
      pollenDensity = lerp(pollen.base, pollen.base * 0.25, manualStorm);
      },

    /** Engage, move, or dismiss the squall front.
     *
     *  `pos` is the crossing position, 0..1: 0 puts the leading
     *  edge TRAVEL_HALF metres upwind of the map origin and 1 puts
     *  the TRAILING edge the same distance downwind, so the whole
     *  band has cleared at both ends. `null` (or any non-finite
     *  value) disengages and hands the atmosphere back to whatever
     *  setStorm last said.
     *
     *  `running` defaults to true. A harness pins a frame with
     *  `setSquall(0.5, false)` and gets a front that does not move
     *  between the probe and the capture. */
    setSquall(pos, running = true) {
      if (pos === null || pos === undefined || pos === false || !Number.isFinite(Number(pos))) {
        squallPos = null;
        squallRunning = false;
        writeBand();
        bandAtPlayer = 0;
        bandNear = 0;
        rain.points.visible = false;
        if (drivingAtmos) {
          drivingAtmos = false;
          /* Forced, because the throttle would otherwise leave the
             level in the storm grade it was in when the front was
             dismissed. */
          applyStorm(manualStorm, true);
        }
        return this.status();
      }
      squallPos = clamp01(Number(pos));
      squallRunning = !!running;
      leadS = leadForPos(squallPos);
      writeBand();
      drivingAtmos = true;
      bandAtPlayer = bandAtPoint(anchor.x, anchor.z);
      applyStorm(Math.max(manualStorm, bandAtPlayer), true);
      return this.status();
    },

    setVisible(v) { visible = !!v; group.visible = !!v; },

    reset() {
      this.setSquall(null);
      this.setStorm(0);
    },

    /** Band intensity at an arbitrary world point. Published so a
     *  harness can assert the front is where status() says it is
     *  without re-deriving the profile - and so the audit can check
     *  the leading edge against the frame it was captured on. */
    squallAt(x, z) { return bandAtPoint(x, z); },

    status() {
      const sp = spray ? spray.mat.uniforms : null;
      return {
        storm: liveStorm,
        manualStorm,
        visible,
        squall: {
          engaged: squallPos !== null,
          running: squallRunning,
          pos: squallPos,
          /* The along-wind coordinate of the LEADING EDGE, in
             metres, in the same frame `squallAt` uses. */
          leadS: squallPos === null ? null : Number(leadS.toFixed(1)),
          dir: [Number(bandDir.x.toFixed(4)), Number(bandDir.y.toFixed(4))],
          fromBearing: ATOLL_WIND.fromBearing,
          bandWidth: BAND_WIDTH,
          speed: FRONT_SPEED,
          /* Edge appearing to last drop leaving. */
          crossingSeconds: Number(CROSSING_SECONDS.toFixed(1)),
          /* How long the band takes to pass over a fixed point. */
          passSeconds: Number((BAND_WIDTH / FRONT_SPEED).toFixed(1)),
          atPlayer: Number(bandAtPlayer.toFixed(3)),
          nearBox: Number(bandNear.toFixed(3)),
          shape: BAND_SHAPE,
          decay: BAND_DECAY,
        },
        crest: {
          nodes: crestNodes.length,
          gaps: crestGaps,
          bearingStep: BEARING_STEP,
          breakSamples: breakSampled,
          breakSource: water && typeof water.breakAt === "function" ? "water.breakAt" : "depth-fallback",
          strongest: crestNodes.length
            ? Number(Math.max(...crestNodes.map((n) => n.score)).toFixed(3)) : 0,
          weakest: crestNodes.length
            ? Number(Math.min(...crestNodes.map((n) => n.score)).toFixed(3)) : 0,
          meanBreak: crestNodes.length
            ? Number((crestNodes.reduce((a, n) => a + n.brk, 0) / crestNodes.length).toFixed(3)) : 0,
          meanOffset: crestNodes.length
            ? Number((crestNodes.reduce((a, n) => a + n.brkOff, 0) / crestNodes.length).toFixed(1)) : 0,
          rMin: crestNodes.length ? Math.round(Math.min(...crestNodes.map((n) => n.r))) : 0,
          rMax: crestNodes.length ? Math.round(Math.max(...crestNodes.map((n) => n.r))) : 0,
          reach: sp ? sp.uReach.value : 0,
          life: sp ? sp.uLife.value : 0,
          peakLift: sp ? Number((sp.uRise.value * 1.61).toFixed(1)) : 0,
          /* What the reach is worth after the tail fade, which is
             the number to argue about when someone says the plumes
             are too short. */
          drawnLength: sp ? Number((sp.uReach.value * 0.81).toFixed(1)) : 0,
        },
        fields: fields.map((f) => ({
          name: f.name,
          kind: f.kind,
          count: f.count,
          visible: f.points.visible,
          opacity: Number(f.mat.uniforms.uOpacity.value.toFixed(4)),
          moteMetres: f.metres,
          /* Screen diameter of the LARGEST mote at the distance
             the field is actually looked at from - 1790 m for the
             reef, the fold radius for a camera-anchored box, at the
             reference framing. Under about 6 px a field cannot read
             at its own working distance however many motes it has,
             and Kenosis's spindrift shipped at 3.7. */
          moteRefM: f.refDist,
          motePx: Number(motePx(f.metres[1], f.refDist).toFixed(1)),
          stretch: f.mat.uniforms.uStretch.value,
          streakAxis: f.mat.uniforms.uStreakAxis ? f.mat.uniforms.uStreakAxis.value : null,
          bandMix: f.mat.uniforms.uBandMix.value,
        })),
        motes: fields.reduce((n, f) => n + f.count, 0),
        drawnMotes: fields.reduce((n, f) => n + (f.points.visible ? f.count : 0), 0),
        supply: Number(supply.toFixed(3)),
        supplyTarget: Number(supplyTarget.toFixed(3)),
        anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
        groundY: Number(groundY.toFixed(2)),
      };
    },

    stats() {
      return {
        fields: fields.length,
        motes: fields.reduce((n, f) => n + f.count, 0),
        drawnMotes: fields.reduce((n, f) => n + (f.points.visible ? f.count : 0), 0),
        drawCalls: fields.filter((f) => f.points.visible).length,
        crestNodes: crestNodes.length,
        crestGaps,
        squall: squallPos !== null,
        crossingSeconds: Number(CROSSING_SECONDS.toFixed(1)),
      };
    },
  };
}

/** The band profile and its geometry, exported so a pure-maths
 *  harness can assert the front's arithmetic without a browser -
 *  and so the two copies of it (this one and the GLSL one inside
 *  both vertex shaders) can be diffed by a test rather than by
 *  someone reading them side by side. */
export const SQUALL = Object.freeze({
  speed: FRONT_SPEED,
  bandWidth: BAND_WIDTH,
  travelHalf: TRAVEL_HALF,
  travelSpan: TRAVEL_SPAN,
  crossingSeconds: CROSSING_SECONDS,
  shape: BAND_SHAPE,
  decay: BAND_DECAY,
  profile: bandProfile,
  leadForPos: (p) => lerp(-TRAVEL_HALF, TRAVEL_HALF + BAND_WIDTH, clamp01(p)),
  dir: Object.freeze([ATOLL_WIND.x, ATOLL_WIND.z]),
});

