/* ============================================================
   SAINTFALL - Kenosis weather

   Blowing snow, in three fields, and the whole point of the module
   is that a mountain has to look like it has WEATHER rather than
   paint. Vesper's dust field is ambient; this is directional, and
   at range it is the only thing that says the wind is real.

   ------------------------------------------------------------
   THE MOTE MODEL IS COPIED, NOT REINVENTED

   vfx.js's `buildPoints` is not exported, so its model is
   reproduced here - and it is reproduced EXACTLY, because every
   detail of it is a bug that has already been paid for once:

     - a mote sits at a FIXED WORLD POSITION and is folded into the
       box around the camera by whole box-widths. The obvious
       version - position measured from the viewer - slides, and
       the obvious fix for the slide - snapping the anchor to 8m -
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
       finds it, and the frame fills with bokeh.

   ------------------------------------------------------------
   THE MEASUREMENT THIS PASS WAS BUILT AGAINST

   The first draft of this module measured as almost nothing.
   Hiding each field in turn on the arrival frame and re-capturing
   at the SAME sim time (a still, not a stepped frame - otherwise
   every mote that merely moved counts as a pixel the field
   changed):

     field       d(sigma)   d(luma)   pixels touched
     blizzard      -0.41      0.31        3.3%
     fall          -0.10      0.08        5.0%
     spindrift     +0.02     -0.01        5.6%
     all three     -0.49      0.42        2.9%

   Three permanently-drawn, frustum-culling-disabled point fields,
   and switching all of them off moved the frame's standard
   deviation by half a grey level. That is fill spent on nothing.

   The diagnosis, per field:

     spindrift - the arithmetic. A mote drew at
                 `aSize * uPixelScale / d` pixels, and at
                 aSize <= 26 with uPixelScale 120 that is a mote
                 1.9 m across: a plume made of 34 of them, spread
                 over a 62 m cone, is 34 dots covering 0.6% of the
                 area they are spread over. At 800 m the whole
                 plume subtends 120 px and contains six visible
                 pixels. It was never a plume, it was a sparse
                 line of dots.
     fall      - the opposite failure. Small COUNT, large SIZE:
                 700 motes inside a 40 m box, every one of them
                 slammed into the 26 px clamp, which is a 26 px
                 disc at ANY distance inside the box. Falling snow
                 at distance is a fine texture; discs are a
                 screensaver, and they were the only weather in
                 the arrival frame anyone could actually see.
     blizzard  - it was under the ground. The box is anchored to
                 `camera.position` and is 5.5 m half-height, so at
                 a 1.7 m eye height nearly half the field sat below
                 the terrain and was depth-rejected, and the half
                 that survived lived inside a 46 m bubble - which
                 is not "sheets crossing the Avalanche Bowl", it is
                 a haze you carry with you.

   The same measurement after this pass, same method:

     frame            field       d(sigma)   d(luma)
     arrival          spindrift    +1.89      +2.33
     inversion        spindrift    +2.44      +1.96
     via-sacra        spindrift    +0.06      +2.46
     bowl-scale       blizzard     -0.27      +0.42
     sastrugi-graze   blizzard     -0.09      +0.30

   Signs are worth reading rather than skipping. A plume drawn
   against a shadowed flank RAISES sigma, because it is the
   brightest thing in a dark half of the frame; blowing snow over a
   sunlit flat LOWERS it, because it is a pale veil laid over the
   most contrasted surface in the level. A field that only ever
   raised sigma would be a field that was always brighter than what
   is behind it, which is not what snow does.

   The cost, interleaved on/off with a readPixels sync so the GPU
   has actually finished, medians of 120 samples: 0.1 to 0.9 ms of a
   7.6 to 9.3 ms frame at 1600x900 high, per-field attribution
   inside the timer's own 0.1 ms quantisation. 28,300 motes against
   the first draft's 9,080, and most of that growth is in the
   blizzard's thin streaked sprites, which cost a quarter of a round
   mote of the same point size.

   ------------------------------------------------------------
   THE THREE FIELDS, AND WHY THERE ARE ONLY THREE

   Every field is `frustumCulled = false` with a 1e6 bounding
   sphere, so it is a PERMANENT fill cost on a frame that is
   already fill-bound. Three is the budget. A fourth needs a
   measurement, not an opinion.

     spindrift - snow smoking off the ridgelines. CREST-ANCHORED,
                 not camera-anchored: the emission lines are
                 sampled from the terrain at build time by
                 curvature, exposure and upwind snow supply, so the
                 plumes come off the crests they belong to and are
                 visible from across the map. This is the field
                 that does the work.
     blizzard  - a wide, ground-anchored slab for the ground-
                 blizzard sheets that cross open flats.
     fall      - light snowfall, low drift, faded out above the
                 inversion deck because above it there is no
                 weather, which is the entire reason the summit is
                 worth climbing to.
   ============================================================ */

import { clamp01, lerp, makeRng, hexToRgb } from "saintfall/core.js";
import { srgbTransfer as srgb } from "saintfall/art.js";
import { SUMMIT_WIND, SUMMIT_PALETTE } from "saintfall/summit-art.js";
import { MAP_HALF, STATIONS } from "saintfall/summit-terrain.js";
import { INVERSION_TOP } from "saintfall/summit-sky.js";

const K = SUMMIT_PALETTE;

/* ------------------------------------------------------------
   HOW BIG IS A MOTE, IN METRES

   Every size number below is authored as a world diameter and
   converted here, because `aSize` on its own is meaningless and
   authoring it directly is how the spindrift ended up 1.9 m wide.

   `gl_PointSize = aSize * uPixelScale / d`, and a perspective
   camera puts `(width / 2) / (d * tan(fov / 2))` pixels on a
   metre at distance d. Eliminating d:

     worldDiameter = aSize * uPixelScale / PIX_PER_M_AT_1M

   PIX_PER_M_AT_1M is the harness's own framing: 1600 px wide at
   the 52-56 degree fovs the beauty poses use, so
   (1600 / 2) / tan(27 deg) = 1570. It is a CONSTANT rather than a
   live read of the camera because a mote's world size must not
   change when the player opens the field of view - and because
   the dynamic-resolution controller changes the drawing buffer
   under us, which moves gl_PointSize but must not move the art.
   The number is therefore "at the reference framing", and the
   only thing it has to be is stable and roughly right.
   ------------------------------------------------------------ */

const PIX_PER_M_AT_1M = 1570;

/** aSize for a mote that should read `metres` across. */
function sizeFor(metres, pixelScale) {
  return (metres * PIX_PER_M_AT_1M) / pixelScale;
}

/* ------------------------------------------------------------
   The camera-anchored field. vfx.js's shader, with six additions.
   Four of them are a picture that was missing; two are a bug that
   the other four made reachable:

     uCeil   - fades a field out above a given altitude, which is
               what stops the snowfall from following the player
               up above the weather.
     uHug    - fades a field out above the ANCHOR, in metres. The
               ground blizzard's anchor is the terrain under the
               camera rather than the camera, and this is what
               keeps it lying on the ground instead of standing in
               a slab around the viewer's head.
     uSheet  - travelling density bands. A ground blizzard reads as
               SHEETS, and a sheet is not a mote shape, it is a
               spatial correlation: everything inside one band is
               dense at the same time. Without this the field is a
               uniform fog no matter what the individual motes do.
     uHaze   - aerial perspective. These points are drawn with
               `toneMapped: false` and take no fog, so before this
               a plume 1.5 km away was full-contrast white in front
               of a mountain hazed halfway to the sky colour. The
               sky colour comes in BY REFERENCE from the atmos
               uniforms, so it tracks the time of day for free.
     uClampFade - pays back, in alpha, the light a mote is drawing
               per pixel because the [1, 26] clamp shrank it. See
               the long note at the bottom of PLUME_VERT.
     uFoldY  - folds the vertical band as well as the horizontal
               one, which only the ground-anchored field needs and
               only it can safely have. See the note by the fold.
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
uniform float uFoldY;       // 1 = fold the vertical band too, 0 = ride the anchor
uniform float uWrapY;       // 1 = the band is WORLD-fixed in y and wraps around the camera

varying float vFade;
varying float vSeed;
varying float vHaze;
varying vec2  vStreak;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec2 wind = normalize(uWind.xy);
  float life = (4.0 + h11(aSeed + 1.7) * 8.0) * uLifeScale;
  float t = fract(uTime / life + h11(aSeed + 4.4));

  /* The vertical origin is a fixed world height when uFoldY is on
     and an offset from the anchor when it is not. See the fold
     below for why that distinction exists. */
  vec3 p = vec3(
    (h11(aSeed) * 2.0 - 1.0) * uBox.x,
    mix(uAnchor.y * (1.0 - uFoldY) + (h11(aSeed + 2.3) * 2.0 - 1.0) * uBox.y,
        h11(aSeed + 2.3) * uBox.y * 2.0,
        uWrapY),
    (h11(aSeed + 5.9) * 2.0 - 1.0) * uBox.z
  );

  /* GUSTS. A constant drift reads as a conveyor belt; the whole
     character of blowing snow is that it arrives in sheets. Two
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

  /* THE VERTICAL FOLD, and why only one field has it.

     The ground blizzard's anchor is the TERRAIN under the camera,
     which is the whole point of it - but that makes the anchor's y
     a function of where the player is standing, and without a fold
     every mote's height is measured from it. Walk up a 30 degree
     slope at sprint and the anchor climbs at 3 m/s, so the entire
     field translates upward at 3 m/s in world space: the snow
     appears to be sucked up the hill with you. It is the same class
     of fault as the 8 m anchor snap in the header - a coherent
     motion of the whole field caused by the viewer moving - and it
     has the same fix: the mote lives at a fixed world height and is
     folded into the band by whole band-heights.

     Measured, by re-deriving the field's world positions from the
     same h11 hashes the shader uses at two anchors one 60 Hz frame
     apart while the viewer sprints uphill (20,000 motes, the
     scratch check modelled on ground-fx:162-215):

       slope                     coherent vertical drag of the field
       flat                       0.03 m/s      0.03 m/s
       30 degrees                 3.46 m/s      0.04 m/s
       grade 1.7 (walk limit)    10.18 m/s      0.04 m/s
       cliff, grade 10           59.98 m/s      0.04 m/s
                                 uFoldY 0       uFoldY 1

     Ten metres a second of the whole field moving as one, at a
     slope the player is allowed to walk.

     The fold is only safe where BOTH ends of the band are already
     invisible, because a mote that wraps jumps a full band height
     in one frame. Here they are made so: uHug takes the top out
     well below the upper boundary, and the extra floor fade in
     hugFade below takes the bottom out - the terrain usually
     hides that end, but "usually" is not a guarantee the moment the
     viewer stands at the top of a drop. The snowfall does NOT get
     this - it is anchored to the
     camera, its band is 26 m of clear air with no fade at either
     end, and a flake wrapping 52 m in one frame directly overhead
     would be the visible failure this whole model exists to avoid.
     Its anchor rides the camera, so the artefact this prevents does
     not arise for it in the first place. */
  float relY = p.y - uAnchor.y;
  p.y += ((mod(relY + uBox.y, uBox.y * 2.0) - uBox.y) - relY) * max(uFoldY, uWrapY);

  /* THE SHEETS. Measured on the FOLDED position, so a band is a
     fixed feature of the world that the camera moves through
     rather than a pattern stapled to the viewer. A smoothstep on
     the sine instead of the sine itself, because a sinusoidal
     density is a gradient and a ground blizzard is a hard-edged
     front with clear air behind it. Depth 0 leaves the field
     untouched, which is what the snowfall and the spindrift want. */
  float band = dot(p.xz, wind) * uSheet.x - uTime * uSheet.y;
  float sheet = mix(1.0 - uSheet.z, 1.0, smoothstep(-0.25, 0.8, sin(band)));

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float ceilFade = 1.0 - smoothstep(uCeil.x, uCeil.y, p.y);
  float dy = p.y - uAnchor.y;
  /* uHug fades the TOP of the band. The bottom needs a fade too,
     but only on the folded field: its lower wrap boundary sits
     about a metre under the ground sample, which is buried where
     the viewer stands and in open air the moment he stands at the
     top of a drop - and a mote wrapping there jumps the full band
     height in one frame, in plain sight. The camera-anchored fields
     have no wrap to protect and keep their full depth. */
  float hugFade = (1.0 - smoothstep(uHug.x, uHug.y, dy))
    * mix(1.0, smoothstep(-uBox.y, -uBox.y + 1.0, dy), uFoldY);
  /* A world-fixed band wraps at BOTH ends and neither is hidden by
     terrain, so both get taken out well inside the boundary. Six
     metres of a twenty-metre half-height leaves twenty-eight metres
     of clear air in the middle and means no mote is ever drawn at
     the instant it jumps the full band height. This is the same
     protection uHug gives the ground blizzard's top, and it is the
     precondition for wrapping y at all. */
  float wrapFade = mix(1.0,
    smoothstep(-uBox.y, -uBox.y + 6.0, dy)
      * (1.0 - smoothstep(uBox.y - 6.0, uBox.y, dy)),
    uWrapY);
  vHaze = smoothstep(uHaze.x, uHaze.y, d) * uHaze.z;
  vFade = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.55, 1.0, t))
        * (1.0 - smoothstep(uBox.x * 0.45, uBox.x * 0.95, length(p.xz - uAnchor.xz)))
        * smoothstep(0.6, 4.0, d) * ceilFade * hugFade * wrapFade * sheet
        * (1.0 - vHaze * 0.5);
  /* PER-MOTE DENSITY. Without it every mote is the same stamp at
     the same opacity and a field of them reads as a field of
     identical discs no matter how soft the falloff is - the
     "bubbles" failure. Mean 1.0 by construction, so uOpacity keeps
     meaning "how dense this field is" and the storm curve below
     does not have to be re-derived. */
  vFade *= 0.46 + 1.08 * h11(aSeed + 8.8);
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;

  /* THE STREAK AXIS, in screen space: the LOCAL HORIZON, not the
     velocity.

     The obvious version projects the mote and a point downstream of
     it and takes the difference - the direction the mote is
     travelling on screen. It is right for a plume and wrong here,
     and the way it is wrong is invisible until you look at the one
     shot that matters. Kenosis's wind blows toward ESE and both
     Avalanche Bowl poses look east, so the snow is moving directly
     AWAY from the camera: the screen-space velocity is nearly zero,
     the axis degenerates, and every mote in the level's flattest,
     most exposed arena draws as a round dot.

     A ground blizzard's signature is horizontal whatever angle you
     watch it from - it is snow sheared along a surface, and the
     surface is what sets the axis. So the axis is the horizon
     tangent at the mote: the world-horizontal direction
     perpendicular to the view ray, which is the screen horizontal
     for a level camera and tilts correctly when the camera pitches
     or rolls. It cannot degenerate except looking straight down.

     The y flip is because gl_PointCoord runs top-down and NDC does
     not - without it every tilted streak leans the wrong way. */
  vec3 upV = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec3 tanV = cross(upV, mv.xyz);
  float tl = length(tanV);
  vec4 tip = projectionMatrix * vec4(mv.xyz + (tl > 1.0e-4 ? tanV / tl : vec3(1.0, 0.0, 0.0)) * max(d, 1.0) * 0.02, 1.0);
  vec2 a0 = gl_Position.xy / max(gl_Position.w, 1e-4);
  vec2 a1 = tip.xy / max(tip.w, 1e-4);
  vec2 sdir = a1 - a0;
  sdir.y = -sdir.y;
  float sl = length(sdir);
  vStreak = sl > 1.0e-6 ? (sdir / sl) : vec2(1.0, 0.0);

  /* See the note in PLUME_VERT: a mote the clamp shrank is drawing
     far more light per pixel than it should. The snowfall passes 0
     here (it barely clamps at all, and its one-pixel floor motes
     ARE the fine texture); the ground blizzard passes a fraction,
     which is what stops the motes nearest the camera from reading
     as a wall of identical discs floating at eye height. */
  float want = aSize * uPixelScale / max(d, 0.4);
  vFade *= pow(max(want / 26.0, 1.0), -uClampFade);
  gl_PointSize = clamp(want, 1.0, 26.0);
}
`;

/* ------------------------------------------------------------
   The crest-anchored field. A mote belongs to an EMISSION POINT
   rather than to a box, streams downwind from it, and dies. This
   is what makes a plume look attached to a crest instead of
   drifting past one.

   Three things this shader has that the first draft did not:

     aFlow  - the local wind speed, normalised. `SUMMIT_WIND.speedAt`
              already models the valley-to-summit gradient and
              nothing was reading it; now a crest at 400 m throws
              its plume nearly twice as far as one at 120 m, which
              is most of what makes the peak read as the windiest
              place on the map.
     uBreath- the PULSE. The first draft gusted the reach only, so
              a plume got longer and shorter and never got
              brighter. Real spindrift surges: the crest lets go of
              a load, it smokes, it thins. Density has to move with
              the reach or the plume is a rubber band.
     uFar   - the range gate, moved out. It used to end at 1500 m,
              which is inside this 2 km map: plumes on the far side
              of the peak were being faded out at exactly the
              distance the art direction says they have to survive.
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
uniform float uClampFade;   // exponent for the 26px clamp payback
uniform vec2  uFar;         // range fade start, range fade end
uniform vec3  uHaze;        // haze start (m), haze end (m), strength

varying float vFade;
varying float vSeed;
varying float vHaze;
varying vec2  vStreak;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  vec2 wind = normalize(uWind.xy);
  float life = uLife * (0.7 + h11(aSeed + 2.1) * 0.6);
  float t = fract(uTime / life + h11(aSeed + 7.3));

  /* The gust reaches the whole ridge at once but a ridge 900m long
     is several gusts wide, so the phase carries the along-wind
     position of the ORIGIN - which is what makes a plume pulse in
     sequence down a crest rather than in unison. Two rates whose
     ratio is not a small integer (0.37 / 0.1373 = 2.695), because
     a 2:1 or 3:1 ratio repeats on a visible period and the eye
     finds the loop within about ten seconds. */
  float travel = dot(aOrigin.xz, wind) * 0.010;
  float pulse = sin(uTime * 0.37 - travel) * 0.62
              + sin(uTime * 0.1373 - travel * 0.73) * 0.38;
  float surge = 1.0 + uGust * pulse;
  float breath = mix(1.0 - uBreath, 1.0, pulse * 0.5 + 0.5);

  float reach = uReach * aFlow * surge;
  float rise = uRise * aFlow * surge;

  vec3 p = aOrigin;
  /* Spread perpendicular to the wind and grow it with age: a plume
     is a cone, and a cone is what separates smoking snow from a
     line of dots. */
  vec2 perp = vec2(-wind.y, wind.x);
  float age = t;
  p.xz += wind * age * reach;
  p.xz += perp * (h11(aSeed + 3.3) * 2.0 - 1.0) * (2.5 + age * reach * 0.115);
  /* Rise, then settle. Snow lifted off a crest is ballistic - it
     goes up fast and comes back down, and a plume that only rises
     reads as smoke. */
  p.y += rise * age * (1.0 - age * 0.62) * 4.0;
  p.y += sin(uTime * 0.9 + aSeed * 5.0) * 0.6;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vHaze = smoothstep(uHaze.x, uHaze.y, d) * uHaze.z;
  /* The tail fade used to start at 0.42 of life, which threw away
     more than half the authored reach before it was ever drawn:
     the plume that measured 62 m long was 36 m long on screen.
     0.62 keeps the body and still dissolves the end. */
  vFade = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.62, 1.0, t))
        * aStrength * breath
        * smoothstep(1.0, 14.0, d)
        * (1.0 - smoothstep(uFar.x, uFar.y, d))
        * (1.0 - vHaze * 0.5)
        /* Per-mote density; see FIELD_VERT. Mean 1.0. */
        * (0.46 + 1.08 * h11(aSeed + 8.8));
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;

  /* Streak axis: the analytic velocity of the trajectory above,
     differentiated with respect to age. Costs nothing and keeps
     the mote's long axis on the plume's own line even where the
     plume is still climbing off the crest. */
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

     A plume seen from 900 m is a solid banner and seen from 250 m
     it was a scatter of hard white confetti - the same failure the
     field started with, re-appearing at close range for the
     opposite reason. The cause is the 26 px clamp: at 250 m a
     13.5 m puff wants 85 px and draws 26, so the plume covers four
     times the screen area with a sixteenth of the coverage per
     mote, and the motes stop overlapping.

     The clamp cannot be lifted (see the header - it is what keeps
     the bloom pass from finding a 300 px disc), so the mote is
     dimmed by how much of itself it had to give up. Exponent 1.15
     rather than the 2.0 that would conserve energy exactly:
     2.0 dissolves a plume you are standing next to into nothing,
     and standing in spray on the parvis is a picture worth having.
     Above about 700 m the term is identically 1 and the long shots
     are untouched.

     Only the plumes get this. The two box fields deliberately
     choose mote sizes that sit ON the clamp at every distance
     inside their box, because a ground blizzard's whole job is
     screen coverage; dimming them for it would undo the field. */
  float want = aSize * uPixelScale / max(d, 0.4);
  vFade *= pow(max(want / 26.0, 1.0), -uClampFade);
  gl_PointSize = clamp(want, 1.0, 26.0);
}
`;

const SNOW_FRAG = /* glsl */`
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
void main() {
  if (vFade <= 0.002) discard;
  vec2 c = gl_PointCoord - 0.5;

  /* ANISOTROPY. Rotate the point's own coordinates into the frame
     of the streak axis and SCALE UP THE ACROSS-AXIS, which shrinks
     the mote across the streak and leaves its length alone.

     The direction of that division is the whole trick and it was
     wrong the first time: dividing the ALONG axis instead grows the
     ellipse past the edge of the sprite quad, where gl_PointCoord
     stops at 0.5 and clips it - so the mote came out exactly as
     wide as before with a slightly flatter falloff, which measured
     on the Bowl poses as fat lozenges that never merged. The sprite
     quad is a hard bound and the [1, 26] clamp means length cannot
     be bought by growing the point; the only anisotropy available
     is to give width away. At stretch 4 a 26 px mote draws 26 x 6.5,
     costs a quarter of the fill, and reads as blown snow instead of
     a dot. */
  vec2 q = vec2(dot(c, vStreak), dot(c, vec2(-vStreak.y, vStreak.x)));
  q.y *= uStretch;
  float r = dot(q, q) * 4.0;
  if (r > 1.0) discard;
  /* Softer than sand's 1.6, and softer again than this file's
     first 2.1. A snow crystal at this distance is not a grain with
     an edge, it is a smear, and a hard-edged white dot at 26 px
     reads as a dead pixel - or, at a hundred of them, as a field
     of soap bubbles, which is what 2.1 measured as on the
     inversion frame. */
  float a = pow(1.0 - r, 2.6);
  /* Fade to nothing at the inscribed circle. The stretch keeps the
     ellipse inside the quad now, but the quad's corners are still
     reachable by a diagonal streak, and a mote clipped square is a
     rectangle the eye finds instantly. Costs a hair of the round
     motes' outer edge, where the falloff above is already near 0.1. */
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

export function buildSummitWeather(ctx, world) {
  const { THREE, atmos, scene } = ctx;
  const field = ctx.terrain.field;
  const group = new THREE.Group();
  group.name = "weather";
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
     colourVec below, so the two can be mixed with no transfer in
     between - and because it is a live reference the plumes haze
     toward whatever the sky is doing at that time of day. */
  const skyRef = atmos.uniforms.uSkyHorizon;

  /* ---------------------- camera-anchored ---------------------- */

  function makeField(opts) {
    const count = opts.count;
    const rng = makeRng(opts.seed);
    const pixelScale = opts.pixelScale ?? 90;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    /* Authored in METRES (see sizeFor). The old numbers were raw
       aSize values and nobody could tell from reading them that the
       snowflakes were 70 cm across. */
    const lo = sizeFor(opts.metres[0], pixelScale);
    const hi = sizeFor(opts.metres[1], pixelScale);
    /* SKEWED SMALL. A uniform size distribution gives every mote
       roughly the same footprint and the field reads as one stamp
       repeated; raising the uniform variate to a power > 1 puts most
       of the motes at the fine end and keeps a few large ones for
       body, which is what a real puff of blown snow is made of. */
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
           drives every mote in the level; a copy here would mean
           the wind and the weather could disagree. */
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
        uFoldY: { value: opts.foldY ? 1 : 0 },
        uWrapY: { value: opts.wrapY ? 1 : 0 },
        uStretch: { value: opts.stretch ?? 1 },
        uSky: skyRef,
        uColourA: { value: colourVec(THREE, opts.colourA) },
        uColourB: { value: colourVec(THREE, opts.colourB) },
        uOpacity: { value: opts.opacity },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 9;
    points.name = opts.name;
    group.add(points);
    const entry = {
      name: opts.name, points, mat, base: opts.opacity, count, kind: "box",
      metres: opts.metres, refDist: opts.box[0],
      groundAnchor: !!opts.groundAnchor, yBias: opts.yBias ?? 0,
    };
    fields.push(entry);
    return entry;
  }

  const blizzard = makeField({
    name: "blizzard", seed: 0xb112, count: 12000,

    /* THE BOX: 50 m, after trying 46 and 105.

       46 m was the first draft and it is a bubble you carry: every
       mote inside the near third of the frame, where a grazing
       camera is looking at ground it is standing on. 105 m was the
       over-correction, and it failed for a reason worth writing
       down - the radial fade has to reach zero at the fold, so a
       105 m box is already half-faded at 47 m, and spreading the
       same budget over 4.7x the footprint left a density that
       covered nothing at any distance. 50 m puts the budget where a
       grazing eye-level camera actually looks, and past it the
       mountain and the aerial perspective take over, which is what
       the far field looks like in a photograph of blowing snow
       anyway.

       THE MOTES: 0.54-1.9 m at 12,000, which is the fourth setting
       this field has had.

       A ground blizzard fails by covering nothing, and coverage is
       count x area. The obvious response - make the motes enormous
       so every one of them slams into the 26 px clamp and covers
       530 px2 - was tried at 2-6 m and measured WORSE: sparse 26 px
       discs with gaps between them read as SOAP BUBBLES floating at
       eye height, which is a more expensive failure than an
       invisible field because you cannot ignore it. Coverage is
       bought with count instead, and four other things carry the
       load size was supposed to carry: the travelling sheet bands,
       the per-mote density jitter, uClampFade on the near motes,
       and the 4:1 streak, which is what makes 12,000 of them
       affordable in the first place. */
    box: [50, 2.6, 50], metres: [0.54, 1.9], pixelScale: 110, sizeSkew: 1.4,

    /* 9.4 m/s, not 3.4. SUMMIT_WIND is 14 m/s in the valley; snow
       that crosses a flat at walking pace is fog, not a blizzard. */
    rise: 0.30, drift: 9.4, lifeScale: 0.62, gust: 0.7,

    /* The sheets, at a 22 m wavelength (k = 2*pi/22 = 0.286), so
       two or three fronts are inside the box at once - at 48 m the
       box held one band and the whole field just breathed together.
       The band travel rate is deliberately NOT the drift rate: at
       roughly 13 m/s against the snow's 9.4 the fronts overtake the
       snow, so a mote passes THROUGH bands instead of living in one
       forever, which is what a gust front actually does. */
    sheet: [0.286, 3.70, 0.78],

    /* 4:1. See SNOW_FRAG - this narrows the mote across the streak
       rather than lengthening it along it, so it also costs a
       quarter of the fill a round mote of the same point size
       would. The axis is the local horizon, not the velocity; the
       reason is in FIELD_VERT and it is the single most important
       line in this field. */
    /* 5.4, up from 4.0. This is half of what tells drift from
       snowfall at a glance: drift STREAMS. Long near-horizontal
       dashes on the deck against the snowfall's near-round flakes
       falling through the column above them - two motions, two
       shapes, two places, and the eye separates them without being
       told which is which. */
    stretch: 5.4,

    /* Only a quarter of the clamp payback. The point of the term
       here is to stop the motes closest to the lens reading as a
       row of identical maximum-size dashes, not to hide them: the
       near ground is where a ground blizzard is thickest, and the
       full 0.9 the plumes use measured as a field that receded from
       the viewer as he walked into it. */
    clampFade: 0.25,

    /* Mild, and only so the far edge of the bubble DISSOLVES into
       the distance instead of ending. A hundred metres of clear
       alpine air does not really haze anything; this is a framing
       device, not physics, and it is turned down accordingly. */
    haze: [55, 190, 0.5],

    /* Both ends of the colour pair are LIT snow. The first draft
       mixed toward snowCool, which is the SHADOW colour: pale
       blue-grey wisps over pale blue-grey snow are a smear on the
       lens, not weather. Blown snow at a low sun is the brightest
       thing on the flat; the cool end of the range now arrives from
       the haze mix instead.

       0.86 is set against the DARK case, not the bright one. Over
       sunlit snow this field can never be more than a whisper - it
       is white on white - and calibrating it to be visible THERE is
       what drove an earlier pass to 0.85 with no supply term and
       filled the Glacier Tongue, the darkest surface in the level
       and one that is looked down on from six metres up, with
       television static. The supply term in `update` below is what
       lets the base go back up: the places that were over-dressed
       are now held down by having nothing to lift. Measured supply
       at the fourteen camera stations - 1.00 on the sastrugi flats,
       0.99 at the basecamp, 0.95 on the Tarn, 0.74 in the Bowl,
       0.34 on the Glacier Tongue, 0.24 on the parvis and at the
       Cascade - so this lands as 0.86 over open snow and 0.29 over
       bare ice, which is a spread no flat number can give. */
    colourA: K.snowCrest, colourB: K.snowLit, opacity: 0.86,

    /* GROUND-ANCHORED, and vertically FOLDED. A ground blizzard is
       a ground phenomenon: it is snow picked up off the surface.
       Anchored to the camera it was centred on the viewer's head,
       which put half of it under the terrain (depth-rejected, paid
       for, invisible) and the other half at eye level. Anchored to
       the terrain under the camera it lies where it belongs, and
       from a ledge you look DOWN on the sheets crossing the flat,
       which is the picture the art direction asks for.

       The slab runs from 1.3 m below that ground sample to 3.9 m
       above it and is faded out between +2.2 and +3.7, so the
       visible layer is the first two metres and change. Thin on
       purpose: the first version was 11 m tall. The metre of
       underground margin is deliberate too - the anchor follows one
       height sample and the ground it has to lie on is not flat, so
       without it the sheet floats clear of every hollow it
       crosses. */
    groundAnchor: true, yBias: 1.3, foldY: true,
    hug: [0.9, 2.4],

    /* Faded out above the inversion for the same reason the fall
       is: there is no loose snow to lift up there, and the summit
       has to be above the weather. */
    ceil: [INVERSION_TOP * 0.8, INVERSION_TOP * 1.4],
  });

  const fall = makeField({
    name: "fall", seed: 0xfa11, count: 4600,
    /* 3000 fine flakes instead of 700 coarse ones. The old motes
       were 0.29-0.75 m across, which inside a 40 m box is the
       26 px clamp at every distance - seven hundred hard white
       discs over the level's most important frame. Real falling
       snow at any distance is a TEXTURE: many marks, each of them
       small. At 2-6 cm a flake draws 3-9 px at 10 m and the
       smallest of them reach the 1 px floor past 31 m, which is
       exactly the fine grain wanted - and the whole field costs
       LESS fill than the 700 discs did, because area goes as the
       square and the discs were all at the 26 px ceiling. */
    /* The box grew from 26m to 40m tall, and the count with it, so
       the density per cubic metre is unchanged and every ground-level
       frame looks exactly as it did. What the extra height buys is
       DEPTH when the camera is not on the ground: flying, the useful
       flakes are the ones between you and the surface, and a 26m box
       centred on the camera only ever had 13m of them. */
    box: [52, 40, 52], metres: [0.020, 0.058], pixelScale: 96,

    /* --- THE SNOW HAS TO STAY WHERE THE WORLD PUT IT ---------------

       The xz band already wraps in WORLD space: a mote sits at a
       fixed place on the mountain and the mod() below folds whichever
       copy of it is nearest into the box around the camera. Walk and
       you get parallax, which is what makes it read as weather rather
       than as a screen effect.

       The y band did not. Its origin was uAnchor.y plus a hash, with
       no mod at all, so vertically every flake was welded to the
       camera and moved with it exactly. The module says why, and the
       reasoning was sound at the time: a mote wrapping the full band
       height directly overhead is the visible artefact this whole
       model exists to avoid, and "its anchor rides the camera, so the
       artefact does not arise for it in the first place."

       That held for as long as the only way to move vertically was to
       walk up a hill. Then the jetpack went in and nobody re-measured.
       Welded in y, snow cannot fall past you and you cannot rise
       through it - climb thirty metres and the entire field comes
       with you, rigid, while the ground blizzard correctly stays on
       the ground. Which is exactly what the player reported: the snow
       does not follow you, and it looks like you are flying above it.

       So y wraps in world space too, and the wrap is made safe the
       way the fold's was - by fading both boundaries well inside the
       box, so nothing is ever drawn at the instant it jumps. */
    wrapY: true,
    rise: -1.2, drift: 1.4, lifeScale: 1.5, gust: 0.28,
    /* Small marks need more alpha each to read at all: the mean
       coverage of a point under the fragment falloff is about a
       quarter of its peak, and a 4 px mark has no room to build up.
       The slight stretch puts each flake on its own fall line, which
       is what stops 3000 of them reading as static. */
    /* 1.15, down from 1.6. The other half of the distinction: a
       falling flake is a mark, not a dash. Some stretch stays so
       each one is on its own fall line - at zero, 4600 flakes read
       as static. */
    stretch: 1.15,
    haze: [22, 70, 0.6],
        /* 0.26, down from 0.42. Three thousand fine flakes is the right
       COUNT - a blind reviewer still called them "hard uniform white
       discs", and at 0.42 each mark is opaque enough to read as an
       object rather than as texture. Snow you are looking through
       should sit under the picture, not on it. */
    /* --- A FLAKE IS NOT ALWAYS BRIGHTER THAN THE GROUND ------------

       Both endpoints used to be near-white (f6e7dc and e4e6ee), so
       every mote in the field was white - and these draw with normal
       alpha blending, which means a white mote over sunlit snow
       composites to sunlit snow. It disappears. Measured looking down
       from thirty metres, snow covered 2.4% of the frame against 4.5%
       at head height: the flakes were all still there, they simply
       had nothing to be seen against.

       That is also true of real snow, and real snow solves it by not
       being uniform. A flake is a millimetre of ice mostly turned
       away from the sun, seen against a 0.85-albedo surface in full
       sunlight - against the ground it is DARKER, against the sky it
       is brighter. With one lerp and no framebuffer read the honest
       approximation is to spread the field across both: the bright
       end still reads against the mountain and the sky, and the cool
       mid-grey end is what makes snow visible over a snowfield. */
    colourA: K.snowSunlit, colourB: "#9dabc2", opacity: 0.26,
    /* Seed only. `update` overwrites this every frame from the
       district's own ceiling - see WEATHER_ZONES. It used to be the
       whole story: one inversion-height lid over a 452m mountain, so
       climbing ANYWHERE broke out into clear air and the snow read
       as something that stops above a certain height rather than as
       weather. Breaking out of the deck is still a moment, it just
       belongs to the places that are above it. */
    ceil: [INVERSION_TOP * 0.85, INVERSION_TOP * 1.15],
  });

  /* ------------------------ crest-anchored ------------------------
     The emission lines are SAMPLED FROM THE TERRAIN, once, at
     build. Four terms, and all four matter:

       convexity  - a crest is a place of strongly negative
                    curvature. A concave gully has nothing to
                    launch.
       exposure   - it has to face the wind. A convex lump in a lee
                    bowl is sheltered.
       altitude   - above the inversion deck, because a plume you
                    cannot see is fill you pay for, and because the
                    wind speed model gives the top of the mountain
                    twice the valley's wind.
       supply     - snow depth at a point 55 m UPWIND of the crest.
                    This is the contract's "spindrift density is
                    proportional to available loose snow", read
                    through `snowDepthAt` as the contract requires,
                    but sampled on the FETCH rather than on the
                    crest itself. Sampled at the crest it is
                    self-defeating: `snowDepthAt` strips ridges and
                    windward faces by design, so the very places
                    that smoke measure as the barest ground on the
                    mountain and every plume would be turned off.
                    Snow arrives at a crest by being blown up the
                    windward slope; the slope is where the supply
                    is.

     NOTHING here is a hard reject except the altitude floor and
     the station pads. Everything else is scored and the best
     crests are taken, because `summit-terrain`'s radial profile is
     being re-authored under this file and a threshold tuned to the
     old curvature statistics would silently produce zero emitters
     on the new mountain. A score-and-rank selection cannot: it
     always finds the sharpest crests the mountain has.
     ------------------------------------------------------------ */

  const CREST_TARGET = 78;         // was 220 point emitters
  /* 260, and the number is derived rather than chosen. A plume seen
     from 500 m draws about 140 m long by 60 m wide, which at
     3.1 px/m is 82,000 px2 of screen; a mote at the middle of the
     size range covers about 250 px2. Half coverage is where a
     plume stops being a plume and starts being confetti - measured
     on the `inversion` frame, where 168 motes gave 51% and the
     summit crest read as a dotted line - so the budget is set at
     roughly three quarters, and the plume cone was narrowed at the
     same time (0.26 to 0.115) so the same motes have less volume
     to fill. */
  const PER_CREST = 260;           // was 34 motes each
  const CREST_SEPARATION = 96;     // m between accepted crests
  const CREST_MIN_SCORE = 0.14;    // below this a plume is fill, not a picture
  const CREST_FLOOR = INVERSION_TOP * 0.7;
  const FETCH = 55;                // m upwind, where the supply is
  const SCAN = 24000;

  const stationList = Object.values(STATIONS);
  const nrmTmp = [0, 1, 0];

  function crestScore(x, z) {
    const y = field.heightAt(x, z);
    if (y < CREST_FLOOR) return null;
    /* A station pad is a LEVELLED DISC. Its rim is strongly convex
       because it was flattened, not because the mountain has a
       crest there, and a plume smoking off the edge of the summit
       parvis is an artefact of the flattening advertising itself. */
    for (let i = 0; i < stationList.length; i += 1) {
      const s = stationList[i];
      if (Math.hypot(x - s.x, z - s.z) < s.padR + 8) return null;
    }
    const curv = field.curvatureAt(x, z);
    if (curv >= 0) return null;                       // convex only
    const n = field.normalAt(x, z, nrmTmp);
    const expo = -(n[0] * SUMMIT_WIND.toward[0] + n[2] * SUMMIT_WIND.toward[1]);
    if (expo <= 0) return null;                       // windward only
    const supply = clamp01(
      field.snowDepthAt(x - SUMMIT_WIND.toward[0] * FETCH, z - SUMMIT_WIND.toward[1] * FETCH) / 0.85
    );
    const score = clamp01(-curv * 2.2) * clamp01(expo * 2.6)
      * clamp01((y - CREST_FLOOR) / 190 + 0.25) * (0.35 + supply * 0.65);
    if (score < 0.04) return null;
    return { x, y, z, score, curv, expo, supply, n: [n[0], n[1], n[2]] };
  }

  const crests = [];
  let candidates = 0;
  {
    const rng = makeRng(0x21d6e);
    const found = [];
    for (let i = 0; i < SCAN; i += 1) {
      const x = (rng() * 2 - 1) * (MAP_HALF - 40);
      const z = (rng() * 2 - 1) * (MAP_HALF - 40);
      const c = crestScore(x, z);
      if (c) found.push(c);
    }
    candidates = found.length;
    found.sort((a, b) => b.score - a.score);
    /* Greedy best-first with a separation radius. Taking the top N
       outright clusters every emitter onto the single sharpest arete
       on the map; the separation spends the budget across the
       mountain, which is what "visible from across the map" needs. */
    const sep2 = CREST_SEPARATION * CREST_SEPARATION;
    for (let i = 0; i < found.length && crests.length < CREST_TARGET; i += 1) {
      const c = found[i];
      /* A crest below the accept floor is a plume nobody will ever
         see - aStrength multiplies straight into vFade, so at 0.06
         it draws at about 2% alpha - and it still costs 260 motes
         of rasterisation because the field is frustumCulled = false.
         The first pass accepted down to 0.063 and spent a fifth of
         the budget on plumes that were not there. Cutting the tail
         is worth more than the crests it loses. */
      if (c.score < CREST_MIN_SCORE) break;
      let ok = true;
      for (let j = 0; j < crests.length; j += 1) {
        const dx = crests[j].x - c.x;
        const dz = crests[j].z - c.z;
        if (dx * dx + dz * dz < sep2) { ok = false; break; }
      }
      if (ok) crests.push(c);
    }
  }

  /* ------------------------------------------------------------
     FROM A POINT TO A CREST LINE

     34 motes leaving one point make a cone. Real spindrift leaves
     a RIDGE - it is a banner hanging off a line, and the line is
     what tells you the mountain has an arete there. So each
     accepted crest is walked outward along its own contour and the
     motes are spread over the resulting polyline.

     The ridge runs perpendicular to the horizontal gradient.
     normalAt returns n.x proportional to -dh/dx and n.z to
     -dh/dz (it is a central difference with the sign folded in),
     so the gradient direction is (-n.x, -n.z) and the ridge
     direction is (n.z, -n.x) normalised. The march stops when the
     ground stops being convex or drops away from the seed, which
     is where the arete ends.
     ------------------------------------------------------------ */

  const CREST_STEP = 11;
  const CREST_STEPS = 4;           // each way, so up to 88 m of line

  function crestLine(c) {
    const gx = -c.n[0];
    const gz = -c.n[2];
    const gl = Math.hypot(gx, gz);
    /* A perfectly flat sample has no gradient and therefore no
       ridge direction; fall back to across-wind, which is the
       direction a wind-formed crest runs anyway. */
    const rx = gl > 1e-4 ? -gz / gl : -SUMMIT_WIND.toward[1];
    const rz = gl > 1e-4 ? gx / gl : SUMMIT_WIND.toward[0];
    const nodes = [{ x: c.x, y: c.y, z: c.z, w: 1 }];
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let s = 1; s <= CREST_STEPS; s += 1) {
        const x = c.x + rx * dir * s * CREST_STEP;
        const z = c.z + rz * dir * s * CREST_STEP;
        if (Math.abs(x) > MAP_HALF - 20 || Math.abs(z) > MAP_HALF - 20) break;
        const y = field.heightAt(x, z);
        if (y < CREST_FLOOR || y < c.y - 26) break;
        if (field.curvatureAt(x, z) >= 0) break;
        /* Taper to the ends: a banner is thickest where the arete
           is sharpest and frays off the shoulders. */
        nodes.push({ x, y, z, w: 1 - (s - 1) / (CREST_STEPS + 1) });
      }
    }
    return nodes;
  }

  let spindrift = null;
  let crestNodes = 0;
  if (crests.length) {
    const count = crests.length * PER_CREST;
    const rng = makeRng(0x5919);
    const origin = new Float32Array(count * 3);
    const strength = new Float32Array(count);
    const flow = new Float32Array(count);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    const pos = new Float32Array(count * 3);
    /* 3.4 - 9.0 m puffs, up from 0.66 - 1.9 m. Mote size is the
       single number that made this field invisible: at 800 m a
       1.9 m mote is 3.7 px and 34 of them cover a third of one
       percent of the plume they are supposed to fill.

       The first fix over-corrected to 13.5 m, which reads on the
       long shot and then hits the 26 px clamp at 815 m - so on
       every frame taken from inside the map the largest motes were
       being shrunk by up to 3x while the plume they belong to grew,
       and the plume came apart into dots. 8 m clamps at 483 m
       instead, which puts the whole mid-range inside the honest
       part of the model. */
    const PIXEL_SCALE = 430;
    const sLo = sizeFor(3.4, PIXEL_SCALE);
    const sHi = sizeFor(9.0, PIXEL_SCALE);
    /* Skewed small for the same reason the box fields are: at a
       uniform 3.2-8.0 m every puff was about the same size and a
       plume read as cauliflower - a row of equal lumps with a
       scalloped edge. Most of the motes fine, a few large, and the
       silhouette stops repeating.

       Which is the theory, and on this field it lost to the
       measurement: at a 1.6 m floor and a 1.35 skew the plume
       stopped being smoke and became GLITTER, a spray of
       individually resolvable specks over the summit that measured
       at 0.61 frame sigma against the cohesive version's 1.79. A
       plume has one job at 800 m and it is to hold together, so the
       distribution is left flat and the floor is kept high; the
       silhouette variety has to come from the crest lines and the
       pulse instead. Kept as a named constant because the next
       person will have the same idea. */
    const SIZE_SKEW = 1.0;
    for (let i = 0; i < crests.length; i += 1) {
      const c = crests[i];
      const line = crestLine(c);
      crestNodes += line.length;
      let wSum = 0;
      for (let n = 0; n < line.length; n += 1) wSum += line[n].w;
      for (let k = 0; k < PER_CREST; k += 1) {
        const j = i * PER_CREST + k;
        /* Pick a node by weight, so the taper is a real density
           taper and not just a per-node alpha. */
        let pick = rng() * wSum;
        let node = line[0];
        for (let n = 0; n < line.length; n += 1) {
          pick -= line[n].w;
          if (pick <= 0) { node = line[n]; break; }
        }
        origin[j * 3] = node.x + rng.jit(CREST_STEP * 0.55);
        origin[j * 3 + 1] = node.y + 1.4 + rng.jit(1.6);
        origin[j * 3 + 2] = node.z + rng.jit(CREST_STEP * 0.55);
        strength[j] = c.score;
        /* The wind gradient, finally read by something. 0.45 at the
           valley floor, 1.0 at 452 m: the summit's plumes are more
           than twice as long as the Tarn's. */
        flow[j] = Math.max(0.55, SUMMIT_WIND.speedAt(node.y) / SUMMIT_WIND.summitSpeed);
        seed[j] = rng() * 1000;
        size[j] = sLo + (sHi - sLo) * Math.pow(rng(), SIZE_SKEW);
      }
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
        /* Peak lift is uRise * 1.61 (the maximum of the ballistic
           term), so 16 puts the top of a full-strength plume about
           26 m over its crest. The old 1.0 lifted it 1.6 m, which
           over a 62 m run is a slope of 1 in 39 - the plume lay
           flat along the ridge and read as a smear on the snow. */
        /* 30, up from 16. The plume has to CLEAR THE ROCK, and that
           is a different requirement from being long. A blind
           reviewer looking at the arrival frame called this
           "cotton-wool sprite puffs plastered over the peak's upper
           faces - billboards that erase the mountain's form and
           silhouette", and they were right: at 16 the banner's peak
           lift is 26 m over a 175 m run, which at 800 m of viewing
           distance projects as a band lying ON the face rather than
           streaming off it. Spindrift that touches the mountain is
           read as snow stuck to the mountain. */
        uRise: { value: 30 },
        /* 175 m, not 62. At the summit's 31 m/s and a 5.6 s life
           that is what the air actually carries; after the tail
           fade it DRAWS 142 m of it, which at 800 m is a 280 px
           banner. Something has to be that long before anyone
           across the valley calls it weather. `drawnLength` in
           status() is that number, so the next person to argue the
           plumes are too short has one to argue with. */
        uReach: { value: 175 },
        uLife: { value: 5.6 },
        uPixelScale: { value: PIXEL_SCALE },
        uGust: { value: 0.5 },
        uBreath: { value: 0.55 },
        uClampFade: { value: 1.15 },
        uFar: { value: new THREE.Vector2(1900, 2700) },
        uHaze: { value: new THREE.Vector3(260, 1500, 0.9) },
        /* Round. The ground blizzard is snow SHEARED along a
           surface and wants an axis; a plume's shape comes from the
           emitter line and the cone, and squashing each puff across
           the plume only throws away the coverage that stops it
           coming apart into dots. */
        uStretch: { value: 1.0 },
        uSky: skyRef,
        uColourA: { value: colourVec(THREE, K.snowCrest) },
        uColourB: { value: colourVec(THREE, K.rimeLit) },
        /* 0.24, down from 0.70, and the direction of the correction
           is worth recording because the brief pointed the other
           way. "Legible from across the map" was read as "dense",
           and density is exactly what turns a banner into cotton
           wool: at 0.70 the plumes are opaque enough to occlude the
           ridge they are supposed to be leaving, so the mountain
           lost its silhouette to its own weather. Real spindrift is
           nearly transparent and reads at range through LENGTH and
           MOTION, which this field already has - 142 m of drawn
           banner and a 5.6 s life. */
        uOpacity: { value: 0.15 },
      },
      vertexShader: PLUME_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 8;
    points.name = "spindrift";
    group.add(points);
    spindrift = {
      name: "spindrift", points, mat, base: 0.70, count, kind: "crest",
      metres: [3.4, 9.0], refDist: 800, groundAnchor: false, yBias: 0,
    };
    fields.push(spindrift);
  }

  /* --------------------------- runtime --------------------------- */

  let storm = 0;
  let visible = true;
  const anchor = new THREE.Vector3();
  let groundY = 0;

  /* ------------------------------------------------------------
     LOCAL SNOW SUPPLY

     The ground blizzard is the one field whose density belongs to
     the GROUND rather than to the sky, and it was the last thing
     wrong with it. A constant field is a constant overlay: at a
     density that reads over the sunlit Bowl - where it is white on
     white and can never be more than a whisper - it turned the
     Glacier Tongue, whose blue ice is the darkest surface in the
     level and which is looked down on from six metres up, into
     television static.

     So the field is scaled by what is lying under the camera. Over
     the Bowl's loaded flats it blows; over the Tarn's black ice and
     the Tongue's bare glacier there is nothing to lift and it thins
     to a fifth. This is the same rule the crest selection uses, and
     the contract's fourth reader of `snowDepthAt`.

     Two details that are not optional:
       - the sample is THROTTLED to a 3 m camera move, because
         `snowDepthAt` and `surfaceAt` between them cost about
         twenty `heightAt` lookups and this runs every frame;
       - and then SMOOTHED with a time constant, so that throttle
         can never produce a step. A jump in a field's opacity is
         the same class of bug as the 8 m anchor snap in the header:
         invisible standing still, obvious walking.
     ------------------------------------------------------------ */

  /* The blizzard sheet tops out at hug 2.4m plus a 1.3m yBias, so
     4m is clear of it and 30m is well clear. */
  const FALL_LIFT_FROM = 4;        // m over the surface: handover starts
  const FALL_LIFT_TO = 30;         // m over the surface: fully handed over
  const FALL_LIFT = 1.5;           // multiplier added on top of 1.0

/* ================================================================
   WEATHER IS A PROPERTY OF PLACE, NOT OF THE LEVEL

   The first model had exactly one weather: a ground blizzard that
   hugged the terrain everywhere, and a snowfall with a single global
   ceiling at the inversion. Played, that reads wrong in a way a
   player put precisely - snow does not follow the ground unless it
   is drift, and what you see reads as blizzard snow that stops above
   a certain height. Both halves of that are true of the old model.
   The blizzard IS the level's weather by weight (12000 motes at 0.86
   against the snowfall's 4600 at 0.26) and it is ground-anchored;
   and the snowfall's ceiling was one number for a 452m mountain, so
   climbing anywhere on it broke out into clear air.

   A ground blizzard hugging the surface is not the bug - that is
   exactly what blowing snow does, and it should keep doing it. The
   bug is that it was the ONLY weather, so the ground-hugging
   behaviour got read as the behaviour of snow in general.

   So there are now two weathers and they are meant to look nothing
   alike:

     SNOWFALL is a column. It occupies the whole air from the ground
     to well above the peak, it does not care how high you fly, and
     it is made of near-round flakes falling slowly (stretch 1.15).

     DRIFT is a surface phenomenon. It hugs the terrain in a 2.4m
     sheet, it streams (stretch 5.4) rather than falls, and flying
     out of it is correct - you have left the snow that was being
     lifted off the ground.

   Which one a place gets is authored per district. The wind-scoured
   basins are drift country with hard clear air above them; the
   valley and the windward terraces are in the cloud and snow at
   every height; the summit is above the weather, which is the one
   place the old global ceiling was actually saying something worth
   keeping - it is just a PLACE now rather than an altitude.

   `top` is where the snowfall column fades out. 640 is above the
   452m peak plus the cathedral's 62m spire with margin, so it means
   "no ceiling" while staying a number the smoothing can lerp through
   without passing through anything visible. */
const WEATHER_DEFAULT = { fall: 0.85, drift: 0.80, top: 640 };
const WEATHER_ZONES = Object.freeze({
  /* In the inversion, sheltered, and the arrival: it snows here, and
     it snows all the way up. */
  basecamp: { fall: 1.00, drift: 0.85, top: 640 },
  bell: { fall: 1.00, drift: 0.55, top: 640 },
  cascade: { fall: 0.95, drift: 0.45, top: 640 },
  /* Windward and inside the deck - the wettest air on the mountain,
     which is why it is the one district whose ground grows rime. */
  rime: { fall: 1.15, drift: 0.40, top: 640 },

  /* Drift country. Open, wind-scoured, and the reason the Avalanche
     Bowl is the level's white negative space: the air above it is
     clear and everything moving is on the deck. */
  bowl: { fall: 0.28, drift: 1.25, top: 190 },
  glacier: { fall: 0.24, drift: 1.00, top: 185 },
  tarn: { fall: 0.34, drift: 0.70, top: 185 },
  fumarole: { fall: 0.45, drift: 0.60, top: 205 },

  /* Above the weather. The reward for the climb, and the only place
     the old global ceiling was saying something worth keeping. */
  summit: { fall: 0.14, drift: 0.35, top: 150 },
});

  const SUPPLY_RESAMPLE = 3;       // m of camera travel
  const SUPPLY_TAU = 1.4;          // s
  let supply = 1;
  let supplyTarget = 1;
  let supplyX = Infinity;
  let supplyZ = Infinity;
  let blizzardDensity = blizzard.base;
  let fallDensity = fall.base;
  /* The live zone, smoothed. Seeded from the default so the first
     frame is not a step from zero. */
  const zone = { ...WEATHER_DEFAULT };
  const zoneTarget = { ...WEATHER_DEFAULT };

  function sampleSupply(x, z) {
    /* Two terms, because either one alone gets it wrong.

       `snowDepthAt` is purely geometric - altitude, slope, aspect,
       curvature, drift - and knows nothing about what the ground is
       MADE of, so on its own it reported the Glacier Tongue as
       loaded snow and the ground blizzard over the darkest surface
       in the level stayed at full strength. `surfaceAt` is the
       reader that knows: blue ice, black tarn ice and wind-scoured
       rock have nothing loose lying on them at all.

       0.9 m of depth is a loaded flat. The floor of 0.20 keeps a
       trace of drift everywhere, because a mountain wind does not
       stop at the shore of a frozen lake - it just arrives with
       less to carry. */
    const depth = clamp01(field.snowDepthAt(x, z) / 0.9);
    const surf = field.surfaceAt(x, z);
    const bare = clamp01(surf.blueIce + surf.blackIce + surf.rock);
    /* The district comes back from the same call, so the zone costs
       nothing on top of the supply sample it is already paying for.
       Blended toward the open-mountain default by districtWeight,
       because a station's weather does not stop at its naming
       radius - it thins out of it. */
    const z0 = WEATHER_ZONES[surf.district] || WEATHER_DEFAULT;
    const w = clamp01(surf.districtWeight);
    zoneTarget.fall = lerp(WEATHER_DEFAULT.fall, z0.fall, w);
    zoneTarget.drift = lerp(WEATHER_DEFAULT.drift, z0.drift, w);
    zoneTarget.top = lerp(WEATHER_DEFAULT.top, z0.top, w);
    return 0.20 + 0.80 * depth * (1 - bare * 0.85);
  }

  return {
    group,
    update(dt, camera) {
      if (!visible || !camera) return;
      anchor.copy(camera.position);
      /* One heightAt per frame for the whole level. The ground
         blizzard needs the surface under the viewer, not the
         viewer, and sampling it here rather than per field keeps it
         to a single lookup even if a second ground-anchored field
         is ever added. */
      groundY = field.heightAt(anchor.x, anchor.z);
      if (Math.hypot(anchor.x - supplyX, anchor.z - supplyZ) > SUPPLY_RESAMPLE) {
        supplyX = anchor.x;
        supplyZ = anchor.z;
        supplyTarget = sampleSupply(supplyX, supplyZ);
      }
      const k = dt > 0 ? 1 - Math.exp(-dt / SUPPLY_TAU) : 1;
      supply += (supplyTarget - supply) * k;
      zone.fall += (zoneTarget.fall - zone.fall) * k;
      zone.drift += (zoneTarget.drift - zone.drift) * k;
      zone.top += (zoneTarget.top - zone.top) * k;
      blizzard.mat.uniforms.uOpacity.value = blizzardDensity * supply * zone.drift;
      /* The snowfall's ceiling is now the DISTRICT's, smoothed, so a
         column of snow that reaches over the peak in the valley can
         thin to a 190m lid over the Bowl without either of them
         being a global fact about the level. */
      fall.mat.uniforms.uCeil.value.set(zone.top * 0.85, zone.top * 1.15);

      /* --- THE HANDOVER, and why flying looked wrong ----------------

         The blizzard is the level's weather. 12000 motes at 0.85
         against the fall's 3000 at 0.26 - it is what you actually see
         when you stand in this world, and it is GROUND-ANCHORED,
         hugging the terrain in a 2.4m sheet, because that is what
         blowing snow does. All correct, and all of it measured at
         eye level.

         Then the jetpack went in and nobody re-measured. Climb thirty
         metres and you leave that sheet - properly, it stays on the
         ground where it belongs - and nothing takes its place. The
         fall field IS camera-anchored and does follow you (its anchor
         was verified tracking the camera to 250m), it is simply far
         too thin to carry a storm on its own. Measured at the
         basecamp: the air is thick with snow at +2m and effectively
         empty at +30m. The player's words were that the snow does not
         follow you and it looks like you are flying above it, and
         that is exactly what is happening - you ARE above it.

         So the fall ramps up as the camera leaves the blizzard layer,
         reaching 2.5x by 30m. This is not a cheat: a real storm does
         not stop at head height, the ground-hug sheet is simply an
         ADDITIONAL near-surface concentration, and once you are out
         of it the falling snow is all there is. The ramp is zero for
         the whole layer, so every ground-level frame - and every
         beauty shot this field was tuned against - is untouched.

         It reads `anchor.y - groundY`, not altitude: the mountain
         climbs 452m and a player standing on the summit is still
         standing on the ground. */
      const overGround = anchor.y - groundY;
      const lt = clamp01(
        (overGround - FALL_LIFT_FROM) / (FALL_LIFT_TO - FALL_LIFT_FROM));
      const lift = 1 + FALL_LIFT * lt * lt * (3 - 2 * lt);
      fall.mat.uniforms.uOpacity.value = fallDensity * lift * zone.fall;
      for (const f of fields) {
        if (f.kind !== "box") continue;
        /* UNSNAPPED. See the header - the 8m snap is the bug this
           whole model exists to avoid. The ground anchor is not a
           snap: it is a continuous function of the camera's xz, so
           it slides with the camera instead of stepping. */
        const u = f.mat.uniforms.uAnchor.value;
        u.set(anchor.x, f.groundAnchor ? groundY + f.yBias : anchor.y, anchor.z);
      }
    },
    setStorm(v) {
      storm = clamp01(v);
      /* A whiteout is not "more of the same field". The fall and
         the blizzard multiply hard; the spindrift barely moves,
         because in a whiteout you cannot see the ridge it comes
         off. Scaling all three together is what makes a storm read
         as a global opacity slider. */
      /* Banked, not written. update() owns this uniform now because
         it also carries the altitude handover below. */
      fallDensity = lerp(fall.base, fall.base * 2.6, storm);
      fall.mat.uniforms.uDrift.value = lerp(1.4, 6.5, storm);
      /* The BASE, not the live uniform: `update` multiplies this by
         the local snow supply every frame and would overwrite a
         direct write here on the next tick. */
      blizzardDensity = lerp(blizzard.base, blizzard.base * 1.9, storm);
      blizzard.mat.uniforms.uOpacity.value = blizzardDensity * supply;
      blizzard.mat.uniforms.uDrift.value = lerp(9.4, 17.0, storm);
      blizzard.mat.uniforms.uGust.value = lerp(0.7, 1.0, storm);
      /* The sheets go SHALLOWER in a storm, not deeper: in a real
         whiteout the gaps between the fronts fill in and the
         banding disappears into continuous white. Keeping the
         bands at full depth is what makes a video-game blizzard
         look like a strobing curtain. */
      blizzard.mat.uniforms.uSheet.value.z = lerp(0.78, 0.22, storm);
      if (spindrift) {
        spindrift.mat.uniforms.uOpacity.value = lerp(spindrift.base, spindrift.base * 1.2, storm);
      }
    },
    setVisible(v) { visible = !!v; group.visible = !!v; },
    reset() { storm = 0; this.setStorm(0); },
    status() {
      const sp = spindrift ? spindrift.mat.uniforms : null;
      return {
        storm,
        visible,
        /* Kept under the old name so any harness reading it still
           works; it is now a count of crest LINES, each of which
           carries several emission nodes. */
        ridgeEmitters: crests.length,
        crests: {
          target: CREST_TARGET,
          accepted: crests.length,
          candidates,
          nodes: crestNodes,
          separation: CREST_SEPARATION,
          motesEach: PER_CREST,
          floorY: CREST_FLOOR,
          fetch: FETCH,
          reach: sp ? sp.uReach.value : 0,
          life: sp ? sp.uLife.value : 0,
          peakLift: sp ? sp.uRise.value * 1.61 : 0,
          /* What the reach is worth after the tail fade, which is
             the number to argue about when someone says the plumes
             are too short. */
          drawnLength: sp ? sp.uReach.value * 0.81 : 0,
          strongest: crests.length ? Number(crests[0].score.toFixed(3)) : 0,
          weakest: crests.length ? Number(crests[crests.length - 1].score.toFixed(3)) : 0,
          lowestY: crests.length ? Math.round(Math.min(...crests.map((c) => c.y))) : 0,
          highestY: crests.length ? Math.round(Math.max(...crests.map((c) => c.y))) : 0,
        },
        fields: fields.map((f) => ({
          name: f.name, kind: f.kind, count: f.count,
          opacity: f.mat.uniforms.uOpacity.value,
          /* The number the first draft was missing. A field's motes
             are worth nothing if they are 2 px wide at the distance
             the shot is taken from. */
          moteMetres: f.metres,
          /* Screen diameter of the largest mote at the distance the
             field is actually looked at from - 800 m for the crest
             plumes, the fold radius for a camera-anchored box, at
             the reference framing. This is the number the first
             draft was missing: under about 6 px a field cannot read
             at its own working distance however many motes it has,
             and the spindrift's was 3.7. */
          moteRefM: f.refDist,
          motePx: Number((f.metres[1] * PIX_PER_M_AT_1M / f.refDist).toFixed(1)),
          stretch: f.mat.uniforms.uStretch.value,
          groundAnchor: f.groundAnchor,
        })),
        motes: fields.reduce((n, f) => n + f.count, 0),
        anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
        groundY,
        supply: Number(supply.toFixed(3)),
        zone: {
          fall: Number(zone.fall.toFixed(3)),
          drift: Number(zone.drift.toFixed(3)),
          top: Math.round(zone.top),
        },
        supplyTarget: Number(supplyTarget.toFixed(3)),
        inversionTop: INVERSION_TOP,
      };
    },
  };
}
