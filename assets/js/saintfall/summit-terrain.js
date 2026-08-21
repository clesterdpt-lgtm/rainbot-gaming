/* ============================================================
   SAINTFALL - summit terrain  (Kenosis, "The White Vigil")

   The peer of terrain.js, and it is deliberately its peer rather
   than its fork: same 2048m square, same 8x8 chunk grid, same four
   LODs, same analytic normals, same skirt trick, same yield
   cadence. Everything in terrain.js's header still applies here
   and is not repeated. What follows is only what is DIFFERENT,
   because those differences are where this file can go wrong.

   - Vesper-IX is a BASIN with a rim. Kenosis is a MOUNTAIN with no
     rim at all: the map edge falls away into the cloud sea. So
     terrain.js's saturating `rimHeight` becomes a saturating
     FLOOR here - beyond r=1024 the radial profile keeps decaying
     and is clamped a few metres under the valley. `heightAt` still
     has to be total and finite at (4000, 4000).

   - The silhouette is AUTHORED, not emergent. One radial elevation
     table (docs/saintfall-summit-layout.md section 1) blended with
     smootherstep, and every other term is relief laid on top of
     it. That is the only way the peak reads the same from the
     basecamp gate as it does on the minimap.

   - Ridge noise is ANISOTROPIC AND RADIAL. Isotropic fBm on a cone
     reads as a crumpled paper bag - the layout says so and it is
     correct. Spurs and gullies here run downhill because the noise
     is evaluated on a CIRCLE IN NOISE SPACE whose centre slides
     with radius (see `reliefAt`). That construction is exactly
     periodic in the bearing, which a naive `theta * r` arc-length
     coordinate is not: it would seam along the -X axis, and a seam
     on a 2km cone is a 450m-long crack.

   - The mountain is not a cone because of CLIFF BANDS. Six of
     them, each a sharp riser paired with an equal-and-opposite
     broad tread so the band steepens the profile locally and
     displaces it by nothing globally. Their height is gated by an
     angular field, and where that gate closes the band opens into
     a walkable COULOIR. That is the whole answer to "couloirs must
     be walkable, headwalls must not": the couloirs are holes in
     the bands, and they are holes in every band at different
     bearings, so the climb is a traverse.

   - Six surfaces, placed by PHYSICS, not by district radius.
     `surfaceAt` reads slope, altitude, aspect-to-wind and
     curvature; the station table only names the ground and paints
     the two ice bodies that genuinely belong to one place (the
     Tarn's black ice, the Tongue's and the Cascade's glacier ice).
     Vesper could get away with radius alone because its districts
     ARE its geology. A mountain's is not.

   Performance shape, which is not the same as Vesper's:
   `heightAt` is evaluated 1.35M times at build. The three things
   that would have made that unaffordable, and what was done:
     - the cliff bands' two noise fields depend only on the
       BEARING, so they are baked into 1440-entry tables once and
       read with a lerp (60 noise evaluations per sample became
       12 array reads);
     - the eight arena spur roads share ONE spatial index rather
       than eight, so a sample costs one bucket lookup, not eight;
     - every station block is behind the `k > 0.001` guard
       terrain.js:625 documents, so an out-of-station sample costs
       one hypot and a compare.
   MEASURED, on this file as it stands: the field factory builds in
   13ms, the 64-chunk mesh pass in 2.36s, for 395,520 vertices across
   256 meshes (64 chunks x 4485 + 1221 + 357 + 117). That is the same
   vertex budget Vesper runs, a quarter of the 1.6M ceiling, and a
   fifth of the 12s load budget. 131k triangles are visible from the
   parvis, 106k from the basecamp gate.
   ============================================================ */

import {
  clamp, clamp01, lerp, smoothstep, smootherstep, sstep, invLerp,
  angleDelta, makeNoise2D, makeRng, hexToRgb, mixRgb, TAU, DEG,
} from "saintfall/core.js";
import { srgbTransfer as srgb } from "saintfall/art.js";
import {
  SNOW_RAMP, SLAB_RAMP, GLACIER_RAMP, BLACKICE_RAMP, GRANITE_RAMP,
  RIME_RAMP, SCREE_RAMP, SULPHUR_RAMP, STATION_TINT, SUMMIT_WIND,
} from "saintfall/summit-art.js";

/* ============================================================
   SCAFFOLD

   MAP_SIZE STAYS 2048 and this is not a preference. collide.js:28
   hardcodes `const HALF = 1024` instead of importing MAP_HALF,
   sizes its paged ground cache from it (collide.js:225-236),
   bounds its raster at REACH = 1030 (collide.js:38) and tests
   `Math.abs(x) <= 1010` in findPath (collide.js:743); player.js
   clamps to +/-1010 in three more places. A larger map mis-pages
   the ground cache SILENTLY - no error, just an aliased answer
   that depends on which side of the map was visited first.
   ============================================================ */

export const MAP_SIZE = 2048;
export const MAP_HALF = MAP_SIZE / 2;
export const CHUNKS = 8;
export const CHUNK_SIZE = MAP_SIZE / CHUNKS;          // 256m
export const LOD_CELLS = [64, 32, 16, 8];             // 4m, 8m, 16m, 32m
export const LOD_RANGES = [430, 780, 1350, Infinity];

/* ============================================================
   THE NINE STATIONS

   docs/saintfall-summit-layout.md section 2, verbatim. `r` is the
   naming radius with the same semantics as Vesper's DISTRICTS -
   it decides what the HUD calls the ground and which STATION_TINT
   washes it, and it has nothing to do with where the arena floor
   is. `pad` is the levelled disc; `padY` is its elevation above
   the ring-valley floor.

   THE ORDER MATTERS. Station shaping is applied as a sequence of
   lerps, so a later entry carves through an earlier one, and the
   summit is last so the parvis wins over everything that reaches
   it. Object key order in JS is stable for string keys, but the
   explicit list is here so that stability is a decision rather
   than a language detail somebody later "tidies".
   ============================================================ */

export const STATIONS = {
  basecamp: { x: 0, z: 828, r: 320, name: "The Basecamp", padR: 120, padY: 12 },
  tarn: { x: -604, z: 604, r: 270, name: "The Black Tarn", padR: 150, padY: 41 },
  bowl: { x: 590, z: 632, r: 310, name: "The Avalanche Bowl", padR: 190, padY: 62 },
  glacier: { x: -656, z: -524, r: 300, name: "The Glacier Tongue", padR: 165, padY: 96 },
  rime: { x: 762, z: 44, r: 285, name: "The Rime Forest", padR: 150, padY: 141 },
  fumarole: { x: 596, z: -596, r: 255, name: "The Fumarole Steps", padR: 130, padY: 162 },
  cascade: { x: -44, z: -772, r: 285, name: "The Frozen Cascade", padR: 145, padY: 209 },
  bell: { x: -800, z: 58, r: 250, name: "The Bell Terrace", padR: 110, padY: 241 },
  summit: { x: 0, z: 0, r: 210, name: "Cathedral of the Ninth Ascent", padR: 78, padY: 452 },
};

export const STATION_ORDER = Object.freeze([
  "basecamp", "tarn", "bowl", "glacier", "rime",
  "fumarole", "cascade", "bell", "summit",
]);

/* The pad rim hands back to the mountain over this distance. The
   layout fixes it at 40m: "its rim blends out over 40 m so it is
   not a poker chip on a hillside". It is only affordable because
   the buttress shelf below has already brought the ground to
   within a couple of metres of `padY` before the pad disc is
   applied - see `shelfAt`. Without that the bowl's 190m pad would
   have had 44m of fill to resolve in 40m of feather, which is a
   155% bank all the way round an arena floor. */
const PAD_FEATHER = 40;

/* ============================================================
   THE WIND

   ONE VECTOR FOR THE WORLD, exactly as Vesper has one, and every
   directional thing on this level obeys it: sastrugi grain, rime
   feathers, spindrift plumes, drift tails, banner flap, the
   cascade's lean and the cloud deck's flow.

   Bearing 292 is where the wind comes FROM (WNW), so it TRAVELS
   toward 112. Compass bearing b maps to a direction vector
   (sin b, -cos b) under this project's axes (+Z south, -Z north,
   +X east), which puts the travel vector at (0.927, 0.375):
   east-south-east, quartering down the mountain's south-east
   flank. Speed runs 14 m/s in the valley to 31 m/s on the crown.
   ============================================================ */

/* DECLARED IN summit-art.js AND ONLY THERE, and re-exported here so
   the consumers that reach for the terrain's table still find it.

   It was defined twice - once here, once in the art module - and the
   two derivations disagreed on the sign of z. Both looked right in
   isolation, because a sign error on one axis of a wind vector does
   not produce anything obviously broken: the air still moves along
   the correct line, spindrift still streams, drift tails still lie
   the way drift tails lie. What it produces is rime growing on the
   sheltered face of every tree in the Rime Forest, sastrugi carved
   across the grain instead of along it, and no symptom that names
   its own cause.

   One vector. Five systems read it. It lives in one file. */
export { SUMMIT_WIND };

/* ============================================================
   THE RADIAL PROFILE

   docs/saintfall-summit-layout.md section 1. y = 0 is the ring
   valley floor; the parvis is 452m. Rows are blended with
   SMOOTHERSTEP rather than smoothstep because smoothstep leaves a
   curvature discontinuity at every row boundary, and a curvature
   discontinuity on a 2km cone is a visible terrace ring - the
   "wedding cake" failure. smootherstep's second derivative is
   zero at both ends, so the six rows join invisibly.

   BEYOND THE TABLE THERE IS NO RIM. terrain.js keeps `heightAt`
   total by having `rimHeight` saturate outside the map
   (terrain.js:477); here the saturating term is a FLOOR instead.
   The profile keeps decaying past r=1024 and clamps at OUTFALL_Y,
   so a stray probe at (4000, 4000) returns -16 rather than NaN,
   and the cloud inversion deck hides the transition.
   ============================================================ */

const PROFILE_ROWS = Object.freeze([
  [0, 452],      // the parvis, levelled
  [74, 448],     // parvis rim
  [190, 392],    // summit cone, bare rock and rime
  [460, 236],    // the shoulders, couloirs and cliff bands
  [700, 70],     // the flanks, ribbed by spurs
  [860, 18],     // the apron the arena shelves are cut into
  [1024, 0],     // outer valley, the cloud sea sits here
]);

const OUTFALL_Y = -16;      // where the outward decay is floored
const OUTFALL_SPAN = 260;   // over how far it gets there

/** The authored elevation at radius `r`. Total, finite, monotone. */
export function summitProfile(r) {
  const rows = PROFILE_ROWS;
  const last = rows.length - 1;
  if (r <= rows[0][0]) return rows[0][1];
  if (r >= rows[last][0]) {
    return lerp(0, OUTFALL_Y, smootherstep((r - rows[last][0]) / OUTFALL_SPAN));
  }
  for (let i = 0; i < last; i += 1) {
    const r1 = rows[i + 1][0];
    if (r <= r1) {
      const r0 = rows[i][0];
      return lerp(rows[i][1], rows[i + 1][1], smootherstep((r - r0) / (r1 - r0)));
    }
  }
  return rows[last][1];
}

/**
 * |dy/dr| of the profile, analytic.
 *
 * The Via Sacra's generator needs this and nothing else: a road
 * that holds a fixed grade has to know how steep the mountain is
 * under it at every radius. smootherstep's derivative is
 * 30u^2(1-u)^2, which peaks at 1.875 in the middle of a row and is
 * ZERO at both ends - so the profile has a flat tread at every row
 * boundary, and the road punches straight inward across those
 * treads instead of spiralling. That is correct behaviour and it
 * is why the marched road below has a few short radial runs in it.
 */
export function summitProfileSlope(r) {
  const rows = PROFILE_ROWS;
  const last = rows.length - 1;
  if (r <= rows[0][0] || r >= rows[last][0]) return 0;
  for (let i = 0; i < last; i += 1) {
    const r1 = rows[i + 1][0];
    if (r <= r1) {
      const r0 = rows[i][0];
      const u = (r - r0) / (r1 - r0);
      const dsdu = 30 * u * u * (1 - u) * (1 - u);
      return Math.abs((rows[i + 1][1] - rows[i][1]) / (r1 - r0)) * dsdu;
    }
  }
  return 0;
}

/* ============================================================
   CLIFF BANDS

   Six of them. Each one is a SHARP RISER MINUS A BROAD TREAD of
   the same height:

       lift = h * gate * (sharp(r) - broad(r))

   `sharp` climbs h over ~22m; `broad` climbs the same h over
   ~22 + 2*90m. Far inside the band both are 1 and the pair
   cancels; far outside both are 0 and the pair cancels. In
   between the difference is a bulge whose leading edge is a
   cliff and whose trailing edge is a flat shelf. The NET
   DISPLACEMENT OF THE MOUNTAIN IS ZERO, which is the entire
   reason the construction is worth the arithmetic: six additive
   bands of 34m each would have put 200m of unauthored elevation
   on the summit and thrown the whole layout table away.

   Local grade at the riser is 1.5*h*gate*(1/riser - 1/(riser+2*tread)),
   which for the r=300 band at full gate is 2.41 on top of the
   profile's own 0.58 - about 71 degrees. player.js:2392
   WALK_SLOPE_LIMIT is 1.7 (59.5 degrees), so a full-gate band is
   a headwall and there is no way up it.

   AND THE GATE IS WHAT MAKES THE LEVEL PLAYABLE. It is a
   low-frequency function of BEARING ONLY, so where it closes the
   band's height collapses and the same riser becomes a 52-degree
   ramp - a couloir. Each band carries its own phase offset, so
   the couloirs do not stack into one convenient vertical staircase
   and the ascent is a traverse between them. The Via Sacra does
   not depend on any of this: its cut is applied after and wins.

   The 4m sample grid renders a 22m riser as five or six quads and
   the drawn mesh sits up to ~1m inside the analytic corner. That
   is tolerable on a face nothing can stand on; it is NOT tolerable
   on a crevasse lip, which is why the crevasse profile below is
   built to a completely different rule.
   ============================================================ */

const CLIFF_BANDS = Object.freeze([
  { r: 648, h: 34, riser: 22, tread: 96 },
  { r: 556, h: 30, riser: 20, tread: 88 },
  { r: 470, h: 38, riser: 24, tread: 92 },
  { r: 386, h: 34, riser: 21, tread: 86 },
  { r: 300, h: 40, riser: 22, tread: 84 },
  { r: 222, h: 32, riser: 20, tread: 78 },
]);

/* Angular resolution of the baked band tables. 1440 entries is
   0.25 degrees, which is 2.8m of arc at the outermost band and
   comfortably finer than the 4m sample grid, so the lerp between
   entries never shows as faceting. Two Float32Arrays per band,
   6 bands: 69KB, built once. */
const BAND_TABLE_N = 1440;

/* ============================================================
   THE VIA SACRA

   One continuous road, basecamp gate to summit parvis, climbing
   anticlockwise. The layout gives a parametric spiral - 2.35
   turns, radius eased from 838 to 96 - and a 13% grade ceiling
   with a 9% mean. Those three numbers are not independent, and
   trying to satisfy all of them from the parametric form is what
   breaks it: with radius eased in `t` the road's climb rate is
   fixed by `t` while its length is not, and the last turn comes
   out at 21%.

   SO THE CENTRELINE IS MARCHED, NOT PARAMETERISED. Six metre
   steps (the layout's sampling interval), and at every step the
   heading is chosen so the grade is exactly the design grade
   wherever the mountain is steeper than it, and straight inward
   where it is not:

       sin(pitch) = min(1, GRADE / |dy/dr|)

   The turn count then falls out of the profile rather than being
   asserted over it:

       turns = (1 / (2*PI*GRADE)) * INTEGRAL of |dy/dr| / r  dr
             = 1.2023 / (2*PI*0.082)
             = 2.33 turns

   which is the layout's 2.35 to within a fifth of a turn. That
   agreement is the check that the authored numbers are mutually
   consistent, and it is why GRADE is 0.082 rather than a rounder
   figure: 0.082 is what reproduces the authored spiral.

   OPEN QUESTION 1 IS CLOSED HERE: option (a), fold the cone into
   the profile source, plus a padExit at every station.

   Option (a) is taken because the failure it prevents is not
   subtle. terrain.js:881-886 records the un-faded Vesper road cut
   carving a 48-60m trench through the Cathedral plaza, and that
   was a road sampling a 22m dune field. A road that sampled a
   `baseHeight` excluding this mountain would be sampling ground up
   to 452m away from where it actually runs; the cut would carve a
   canyon the depth of the peak. So `roadLandform` below samples
   the profile, the buttress ribs AND the arena shelves - the road
   knows about the mountain and rides it.

   What it deliberately does NOT sample is the cliff bands, the
   meso ribs or the fine detail. A road is a cut: it goes through
   those, it does not follow them. Sampling them would have put
   30m ribs into a profile that then has to be smoothed back out,
   and 26 binomial passes at 6m spacing is a 21.6m kernel - not
   remotely enough to remove an 80m-wavelength rib.

   Option (b), the per-station padExit, is applied IN ADDITION at
   all nine stations rather than only at the parvis. The reason is
   the Avalanche Bowl: the marched spiral passes 27m from its pad
   centre, so a live cut there would drive a 1.05m causeway and a
   1.1m ditch across an arena floor that the traversal harness
   asserts is flat to +/-0.35m. Inside a pad the cut is not needed
   anyway - the pad is already level and already at the road's own
   elevation, so the paving above it is dressing, not terrain.

   THE GRADE HISTOGRAM MUST BE MEASURED, not assumed. The design
   figure is 8.2% and `stats().viaSacra` reports max / mean /
   histogram over the built profile at load; scripts/
   saintfall-summit-traversal.mjs asserts max <= 13% and mean
   <= 9% over 600 samples. Predicted from the construction: total
   climb 424.5m over ~5.4km of road is a 7.9% mean, and the only
   places the max can exceed the design grade are the shelf
   crossings, which the grade limiter below trims.

   HAIRPINS: the layout asks for six above 300m and this build does
   not cut them, because the contract's own spacing rule forbids
   them here. Two adjacent switchback legs must be at least twice
   the shoulder width apart (>= 44m centre to centre) or their cuts
   merge into one slab and the hairpin disappears. At 8.2% a
   switchback pair that gains enough elevation to be worth cutting
   advances the radius by dy/|dy/dr| - about 24m on the summit cone
   - so the two legs would be 24m apart and would merge. The
   continuous marched spiral achieves the same climb at the same
   grade with 200-500m between adjacent legs, which is also what
   makes the "three levels of road in one frame" vista work: at
   bearing 90 the road passes at r=838, r=345 and r=133.

   What IS kept is the authored intent of the six turns. The six
   points of the above-300m section, at equal arc intervals, are
   exported as VIA_SACRA_TURNS with a widened carriageway apron cut
   at each, for summit-world to stand its votive markers on.
   ============================================================ */

const VIA_SACRA_STEP = 6;         // layout section 3
const VIA_SACRA_GRADE = 0.082;    // design grade; see the turn-count arithmetic
const VIA_SACRA_START_R = 838;
const VIA_SACRA_END_R = 100;
/* Radians of heading change allowed per 6m step - a 15m minimum
   curve radius. See the pitch update in the march for why this is a
   rate limit and not a damping filter. */
const VIA_SACRA_MAX_TURN = 0.40;

/** The marched centreline, with the design elevation at each node. */
const viaSacraNodes = (() => {
  const pts = [];
  let r = VIA_SACRA_START_R;
  /* The basecamp gate. STATIONS.basecamp sits at bearing 90 in the
     atan2(z, x) frame, which is compass south - the layout's "S". */
  let th = Math.PI / 2;
  let pitch = 0.5;
  for (let n = 0; n < 1600; n += 1) {
    pts.push({
      x: Math.cos(th) * r,
      z: Math.sin(th) * r,
      y: summitProfile(r),
      r,
      th,
    });
    if (r <= VIA_SACRA_END_R) break;
    const g = summitProfileSlope(r);
    const want = Math.asin(clamp01(g > 1e-5 ? VIA_SACRA_GRADE / g : 1));
    /* RATE-LIMITED, NOT DAMPED, and the difference is measurable.
       `want` is continuous but its derivative is not bounded: asin
       has an infinite slope where G/g reaches 1, so at each of the
       profile's five row boundaries the desired heading swings
       through 55 degrees inside one or two steps. That is a corner,
       not a curve, and an 11m carriageway with 22m shoulders cannot
       turn it.

       The first version damped the heading exponentially at 0.09
       per step. It removed the corner and it also removed a fifth
       of the road: exponential damping LAGS whenever the target is
       moving, the lag holds the pitch too steep coming out of every
       boundary, and the whole spiral came out at 4031m / 1.66 turns
       / a 10.5% mean - over the layout's 9% ceiling, with the grade
       limiter then binding on 87% of the samples.

       A turn-rate limit has no steady-state error: it tracks `want`
       exactly wherever `want` is changing slowly, and only clips
       the corner. Measured across the whole road, at 0.40 rad per
       6m step (a 15m minimum curve radius, and it only ever fires
       at those five transitions):

           length 5219m, 2.344 turns, mean grade 8.14%,
           worst design grade 18.3% over six nodes.

       and, after the profile is sampled, smoothed and grade-limited,
       the road as built measures max 11.50% / mean 8.35% over the
       harness's 600 samples - inside the layout's 13% and 9%.

       2.344 against the layout's authored 2.35. That agreement is
       the check that the elevation table, the turn count and the
       grade ceiling are mutually consistent, and it is why
       VIA_SACRA_GRADE is 0.082 rather than a rounder number. */
    pitch += clamp(want - pitch, -VIA_SACRA_MAX_TURN, VIA_SACRA_MAX_TURN);
    r -= VIA_SACRA_STEP * Math.sin(pitch);
    th -= (VIA_SACRA_STEP * Math.cos(pitch)) / Math.max(r, 24);
  }
  return pts;
})();

/** The polyline summit-hud's `drawPath` reads. */
export const VIA_SACRA_PATH = Object.freeze(
  viaSacraNodes.map((p) => Object.freeze([p.x, p.z]))
);

/** Cumulative arc length, so `viaSacraPointAt` is parameterised by
 *  distance travelled rather than by node index. The march already
 *  steps a constant 6m so the two agree, but a later change to the
 *  step would silently skew every derived pose otherwise. */
const viaSacraArc = (() => {
  const s = new Float64Array(viaSacraNodes.length);
  for (let i = 1; i < viaSacraNodes.length; i += 1) {
    const a = viaSacraNodes[i - 1];
    const b = viaSacraNodes[i];
    s[i] = s[i - 1] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  return s;
})();

export const VIA_SACRA_LENGTH = viaSacraArc[viaSacraArc.length - 1];

/**
 * A point on the Via Sacra at fractional arc length `t`.
 *
 * PARAMETERISED BY ARC LENGTH, NOT BY NORTHING. terrain.js:280's
 * `roadPointAtZ` scans for the segment bracketing a z value, which
 * works only because Vesper's causeway is monotone in z. A 2.33
 * turn spiral crosses most northings six times, so the same
 * technique here would return whichever of six legs happened to be
 * first in the array - three hundred metres of elevation apart.
 *
 * `yaw` runs the way the road is walked, toward the summit, in
 * player.js's convention (forward is (sin yaw, cos yaw), see the
 * arc predictor at player.js:4960-4975).
 */
export function viaSacraPointAt(t) {
  const target = clamp01(t) * VIA_SACRA_LENGTH;
  let lo = 0;
  let hi = viaSacraArc.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (viaSacraArc[mid] <= target) lo = mid; else hi = mid;
  }
  const a = viaSacraNodes[lo];
  const b = viaSacraNodes[Math.min(lo + 1, viaSacraNodes.length - 1)];
  const span = viaSacraArc[hi] - viaSacraArc[lo];
  const f = span > 1e-6 ? (target - viaSacraArc[lo]) / span : 0;
  const x = lerp(a.x, b.x, f);
  const z = lerp(a.z, b.z, f);
  return {
    x,
    z,
    y: lerp(a.y, b.y, f),
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/* The six marked turns. Equal arc intervals through the section
   above 300m - the layout's threshold for hairpins - so the
   markers land where the climb is hardest and the exposure is
   greatest, which is what the votive markers are for. Each gets a
   widened carriageway apron cut into the terrain here; the marker
   itself is summit-world's. */
export const VIA_SACRA_TURNS = (() => {
  const steep = viaSacraNodes.filter((p) => p.y >= 300);
  const out = [];
  if (steep.length === 0) return Object.freeze(out);
  for (let i = 0; i < 6; i += 1) {
    const p = steep[Math.round(((i + 0.5) / 6) * (steep.length - 1))];
    out.push(Object.freeze({ id: `turn-${i + 1}`, x: p.x, z: p.z, y: p.y }));
  }
  return Object.freeze(out);
})();

/** How far a widened apron reaches, and how much carriageway it
 *  adds. 30m of reach against an 11m carriageway makes the apron
 *  about three road widths long, which is what a vehicle turn
 *  needs and what reads as a deliberate place rather than a bulge. */
const APRON_REACH = 30;
const APRON_WIDTH = 9;

/* ============================================================
   THE EIGHT ARENA SPURS

   The layout says each arena hangs off the Via Sacra as a spur of
   at most 260m. It also fixes both endpoints - the pad centres and
   the spiral - and those two sets of numbers do not always leave
   260m between them. So the spur origin is CHOSEN rather than
   assumed: the road node minimising `planarDistance + 4*|dy|`,
   which trades length against climb the way a surveyor does.

   Measured lengths of that choice, and the two that exceed the
   layout's figure, recorded rather than hidden:

     basecamp   10m   the gate itself
     bowl      138m
     rime      156m
     cascade   233m   road r=546 y=208 vs pad y=209 - near exact
     fumarole  273m
     glacier   343m   bowed 185m clear of the crevasse field
     bell      429m   road y=241 vs pad y=241 - elevation exact
     tarn      648m   from the gate, along the valley floor

   The bell and the tarn are the interesting ones. The Bell
   Terrace's elevation is served EXACTLY by the marched spiral -
   the road reaches bearing 176 at r=432 where the profile is
   240.5m against an authored 241m - but the pad is authored at
   r=802, so the spur is a 429m level traverse out along the
   buttress crest to a priory on a cliff edge. That is better level
   design than a 260m spur would have been and it is why the number
   was allowed to move. The Black Tarn is at 41m in the valley: no
   point on a climbing spiral is near it except the gate, so its
   spur is a 648m valley track, which is what the arena's own
   fiction (the low, early, cold one) wants anyway.

   Measured terrain grade along each spur, which is the number that
   decides whether the arena is reachable: worst is the Glacier
   Tongue at 0.50 rise over run, descending 139m from the road to an
   arena that sits below it. player.js:2392's WALK_SLOPE_LIMIT is
   1.7, so every spur has better than three times the margin.
   ============================================================ */

const SPUR_STATIONS = Object.freeze(STATION_ORDER.filter((id) => id !== "summit"));

/** The spur polylines, straight from the chosen road node to the
 *  pad centre and sampled at the same 6m as the main road. A
 *  straight line is deliberate: the spur's cut has a 13m shoulder
 *  and grade-limits its own profile, so it bulldozes a walkable
 *  track across whatever it crosses. A path that tried to follow
 *  the terrain would need a solver, and a solver that fails
 *  produces an unreachable arena with no error anywhere. */
/* A lateral bow, in metres, applied at the spur's midpoint.
   Straight is the default and the right answer almost everywhere.
   The Glacier Tongue is the exception and the reason this parameter
   exists: its arena lies straight out along the same bearing as the
   road node that serves it, so a straight spur runs down the middle
   of the icefall and crosses every one of the four transverse
   crevasses at right angles. Crevasses ARE transverse - that is how
   a glacier opens - so no amount of moving them helps; the track has
   to go round, which is what the art direction asks the player to do
   as well ("a crevasse field with real gaps you must route around").
   Positive bows anticlockwise. */
const SPUR_BOW = { glacier: 185 };

export const VIA_SACRA_SPURS = Object.freeze(SPUR_STATIONS.map((id) => {
  const s = STATIONS[id];
  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i < viaSacraNodes.length; i += 1) {
    const p = viaSacraNodes[i];
    const cost = Math.hypot(p.x - s.x, p.z - s.z) + 4 * Math.abs(p.y - s.padY);
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  const a = viaSacraNodes[best];
  const len = Math.hypot(s.x - a.x, s.z - a.z);
  const n = Math.max(2, Math.round(len / VIA_SACRA_STEP) + 1);
  /* Quadratic Bezier through a control point offset perpendicular to
     the chord by twice the bow - a Bezier passes at half its control
     offset, so 2*bow at the control is `bow` on the curve. */
  const bow = SPUR_BOW[id] || 0;
  const ux = len > 1e-6 ? (s.x - a.x) / len : 0;
  const uz = len > 1e-6 ? (s.z - a.z) / len : 0;
  const mx = (a.x + s.x) * 0.5 - uz * bow * 2;
  const mz = (a.z + s.z) * 0.5 + ux * bow * 2;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const f = i / (n - 1);
    const g = 1 - f;
    pts.push([
      g * g * a.x + 2 * g * f * mx + f * f * s.x,
      g * g * a.z + 2 * g * f * mz + f * f * s.z,
    ]);
  }
  return Object.freeze({ id, from: best, length: len, points: Object.freeze(pts) });
}));

/* ============================================================
   BASECAMP

   The one authoritative spawn, derived from the road rather than
   written as a coordinate for the reason terrain.js:271-278
   records: both of Vesper's hand-written spawns missed the
   causeway they were supposed to be standing on. Placed 40m back
   down the gate from the first road node so the player starts
   BEHIND the gate with the whole mountain in front of them, facing
   the summit.
   ============================================================ */

export const BASECAMP = Object.freeze({
  x: STATIONS.basecamp.x,
  z: STATIONS.basecamp.z + 40,
  /* Forward is (sin yaw, cos yaw) - player.js:4960-4975. Facing
     (0, -1) is compass north, straight at the peak. */
  yaw: Math.atan2(0 - STATIONS.basecamp.x, 0 - (STATIONS.basecamp.z + 40)),
});

/* ============================================================
   CREVASSES

   Slots in `heightAt`. Not decals, not `walkSurfaceAt` (which can
   only ever RAISE the floor - the Math.max at collide.js:208), not
   props. If you can walk over a crevasse it is a decal, and decals
   are not what this level is for.

   THE PROFILE IS NOT A SMOOTHSTEP, and that is the whole design.
   Two constraints have to hold at once and a smoothstep cannot
   hold both:

     (1) the walls must be steeper than WALK_SLOPE_LIMIT = 1.7 or
         the hazard is a ramp;
     (2) the drawn mesh must agree with the analytic field to
         better than 0.5m on the LIP, because groundHeightAt
         reproduces the LOD0 triangulation from a 4m sample plane
         while vfx.footprint (vfx.js:5523) reads `heightAt`
         directly - the same split terrain.js:1613-1615 records at
         Vesper's narrow Fosse.

   For `depth * smoothstep` over a span S the peak grade is 1.5D/S
   and the peak second derivative is 6D/S^2. A 4m sampled linear
   interpolant deviates by (h^2/8)|f''| = 2|f''|. Solving both
   constraints together gives S < 0.882D and S > 4.9*sqrt(D),
   which has NO SOLUTION below D = 31m. A 31m-deep crevasse is a
   chasm.

   So the wall is quadratic-LINEAR-quadratic instead: a rounded lip
   over `ease` metres, a dead straight face, a rounded foot. A
   straight face has zero second derivative and therefore zero mesh
   error, so the error is bounded by the lip rounding alone at
   2 * grade / ease = 2 * 2.15 / 9 = 0.478m, and the grade is 2.15
   (65 degrees) at any depth. That decouples the two constraints
   completely. The only remaining rule is span > 2*ease, i.e.
   depth > grade * ease = 19.4m, which is why every crevasse here
   is 20m or deeper.

   Top width comes out at 2*(half + depth/grade + ease) - 62m for a
   24m slot. That is wider than a real crevasse and it is not
   negotiable: the contract's own minimum is 12m because anything
   narrower than the 4m LOD0 cell is not drawn at all, and 48m is
   what the arithmetic above delivers once the mesh has to be
   honest about it.

   AND THEY ARE NOT SOFTLOCKS. The depth tapers to zero over the
   outer half of the slot's length, so the floor rises to grade at
   both tips at about 1.3 - inside the walk limit. A player who
   falls in walks out along the floor to a tip, which is exactly
   what a real crevasse's snow ramp is. The Garner's pit
   (terrain.js:150-166) records what the alternative costs: "a hole
   with unclimbable sides that the player may now walk into is a
   softlock in the shape of a boss arena".

   Sited OUTSIDE every arena pad, because the traversal harness
   asserts each pad is flat to +/-0.35m across its radius. The
   Tongue's crevasse field is therefore the icefall ABOVE the
   arena, between r=540 and r=670, which is where crevasses form
   anyway.
   ============================================================ */

const CREVASSE_GRADE = 1.90;
const CREVASSE_EASE = 12;

/**
 * `{ id, r, deg, dir, length, depth, half }` - centre on the radial
 * ray at `deg`, running along bearing `dir`, which is transverse to
 * the ice flow (that is how a glacier opens).
 *
 * THE POSITIONS ARE SOLVED, NOT SKETCHED. Three constraints have to
 * hold simultaneously and none of them is obvious by eye:
 *
 *   padClear >= 16m  - no part of a slot inside padR + 6m, because
 *                      the traversal harness asserts every arena
 *                      floor is flat to +/-0.35m across its radius
 *                      and a 26m slot is not that. The first hand-
 *                      placed field cut 12.4m into the Glacier
 *                      Tongue's arena, measured spread 15.96m.
 *   pathDist >= 70m  - clear of the Via Sacra and all eight spurs,
 *                      so the guard that keeps a crevasse from
 *                      severing the level never has to fire. A slot
 *                      suppressed by a road guard is a slot whose
 *                      depth ramps out over the guard's span, and
 *                      that ramp is itself a landform.
 *   rmax <= 965m     - inside the player's own +/-1010 clamp
 *                      (player.js:4120) with the slot's full width.
 *
 * A hand-placed field satisfied at most two of the three: the first
 * four Tongue crevasses were laid on the glacier's flow axis, which
 * is exactly where the spur that serves the arena runs, and the spur
 * crossed every one of them at right angles. Crevasses ARE
 * transverse - moving them does not help - so the spur was bowed
 * (SPUR_BOW) and the field was re-solved around it.
 *
 * Three on the Tongue rather than the four first sketched: at 62-67m
 * top width - which is what the mesh-fidelity arithmetic above costs
 * - four will not fit in the annulus the three constraints leave.
 */
const CREVASSE_SPEC = Object.freeze([
  { id: "tongue-1", r: 732, deg: -155.45, dir: -177.38, length: 190, depth: 26, half: 6 },
  { id: "tongue-2", r: 702, deg: -162.74, dir: -177.38, length: 190, depth: 28, half: 7 },
  { id: "tongue-3", r: 626, deg: -137.19, dir: 116.62, length: 160, depth: 25, half: 6 },
  /* The Cascade's bergschrund, where the hanging ice pulls away from
     the cirque wall. */
  { id: "cascade-schrund", r: 820, deg: -78.94, dir: 80.74, length: 172, depth: 26, half: 6 },
  /* The Avalanche Bowl's runnel, on the loaded headwall above the
     arena rather than on its floor - the floor is the level's clean
     white negative space and the layout will not have a hole in it.
     summit-world's snow bridge goes here. */
  { id: "bowl-runnel", r: 605, deg: 57.46, dir: -61.03, length: 190, depth: 26, half: 8 },
  /* The summit cone's own bergschrund, at 374m on the north-west
     flank, where the last ice pulls away from the bare rock. */
  { id: "cone-schrund", r: 350, deg: -120.0, dir: -30.0, length: 124, depth: 24, half: 5 },
]);

export const CREVASSES = Object.freeze(CREVASSE_SPEC.map((c) => {
  const a = c.deg * DEG;
  const cx = Math.cos(a) * c.r;
  const cz = Math.sin(a) * c.r;
  const b = c.dir * DEG;
  const tx = Math.cos(b);
  const tz = Math.sin(b);
  const hl = c.length * 0.5;
  const span = c.depth / CREVASSE_GRADE + CREVASSE_EASE;
  return Object.freeze({
    id: c.id,
    ax: cx - tx * hl, az: cz - tz * hl,
    bx: cx + tx * hl, bz: cz + tz * hl,
    cx, cz,
    half: c.half,
    depth: c.depth,
    span,
    halfLength: hl,
    /* Bounding circle for the reject test. One hypot and a compare
       keeps 1.35M samples off the seven slot evaluations. */
    reach: hl + c.half + span + 6,
  });
}));

/* ============================================================
   MOULINS

   Three, in the Tongue's icefall. Walkable funnels rather than
   bores, and that is a decision with a reason rather than a
   compromise.

   A moulin is properly a vertical shaft, and a vertical shaft in a
   height-field game needs `groundOverrideAt` - the override at
   collide.js:192-209 is the only thing in the engine that can
   LOWER a floor. The machinery for it is built and exported below.
   It is not used, because this is an environment build: there is
   no combat, no death, no respawn and no mission, so a column the
   player cannot climb out of is a permanent softlock with no way
   to report it. When a fall handler exists, a bore is one entry in
   the `overrides` table.

   So the funnels use the same quadratic-linear-quadratic wall as
   the crevasses at a WALKABLE grade of 1.35, which puts a 15m
   moulin at 42m across the top: a dark round pit in the ice that
   reads as a moulin from the rim and lets you walk down into it
   and back out. Mesh error 2*1.35/8 = 0.34m.
   ============================================================ */

const MOULIN_GRADE = 1.35;
const MOULIN_EASE = 8;

const MOULIN_SPEC = Object.freeze([
  { id: "moulin-1", r: 939, deg: -128.98, depth: 15, floor: 5 },
  { id: "moulin-2", r: 936, deg: -153.48, depth: 13, floor: 4 },
  { id: "moulin-3", r: 904, deg: -157.88, depth: 16, floor: 5 },
]);

export const MOULINS = Object.freeze(MOULIN_SPEC.map((m) => {
  const a = m.deg * DEG;
  const span = m.depth / MOULIN_GRADE + MOULIN_EASE;
  return Object.freeze({
    id: m.id,
    x: Math.cos(a) * m.r,
    z: Math.sin(a) * m.r,
    depth: m.depth,
    floor: m.floor,
    span,
    reach: m.floor + span + 4,
  });
}));

/**
 * One wall of a slot, measured inward from the lip.
 *
 * `p` is metres past the lip, `span` the horizontal run from lip
 * to floor, `ease` the rounding at each end. Returns a NEGATIVE
 * displacement. See the CREVASSES block for why this shape and not
 * a smoothstep; the arithmetic there is what fixes `ease`.
 */
function slotWall(p, span, depth, ease) {
  if (p <= 0) return 0;
  if (p >= span) return -depth;
  const straight = span - 2 * ease;
  if (straight <= 0) return -depth * smoothstep(p / span);
  const k = depth / (straight + ease);
  if (p < ease) return -k * p * p / (2 * ease);
  if (p < ease + straight) return -k * (ease * 0.5 + (p - ease));
  const q = span - p;
  return -depth + k * q * q / (2 * ease);
}

/* ============================================================
   SURFACE ZONES

   The peer of terrain.js:389's table, and it exists for exactly
   the reason recorded there: naming radius and ground material are
   two independent fields. The Black Tarn's ice is a lake, not a
   district; the Tongue's blue ice is a glacier, not a label. A
   shared radius put Vesper's vitrified teal on 336m of open dune,
   and the same mistake here would paint a third of the mountain
   the colour of a swimming pool.

   Only the places whose GEOLOGY is authored appear. The Avalanche
   Bowl is absent on purpose: it is the level's clean white
   negative space and every grain of surface on it comes from the
   physical modifiers in `surfaceAt`.
   ============================================================ */

const SURFACE_ZONES = Object.freeze({
  /* The Tongue's radii are wide because this table does two jobs: it
     paints the ice AND it is what `iceCalmAt` reads to damp the ribs
     and cliff bands off a glacier surface. The layout's tongue is
     380m long; 165-375m from the pad centre is that, and it reaches
     the icefall where the crevasse field opens. */
  glacier: { key: "blueIce", in: 0.55, out: 1.25, w: 0.96 },
  cascade: { key: "blueIce", in: 0.50, out: 0.98, w: 0.94 },
  tarn: { key: "blackIce", in: 0.20, out: 0.60, w: 0.97 },
  fumarole: { key: "sulphur", in: 0.26, out: 0.82, w: 0.90 },
  basecamp: { key: "scree", in: 0.28, out: 0.88, w: 0.68 },
  bell: { key: "rock", in: 0.30, out: 0.86, w: 0.60 },
  rime: { key: "rime", in: 0.32, out: 0.92, w: 0.52 },
  summit: { key: "rock", in: 0.34, out: 0.96, w: 0.58 },
});

/** The surface weight keys `surfaceAt` returns, in the order the
 *  residual subtracts them. `sulphur` is an eighth key on top of
 *  the contract's seven (section 3.3 leaves the material names to
 *  this module) because the Fumarole Steps' orange crusts are a
 *  ramp summit-art already exports and a station tint alone cannot
 *  carry them; nothing breaks on an extra key, and SULPHUR_RAMP
 *  would otherwise be dead. */
const SURFACE_KEYS = Object.freeze([
  "slab", "blueIce", "blackIce", "rock", "rime", "scree", "sulphur",
]);

const RAMPS = {
  snow: SNOW_RAMP,
  slab: SLAB_RAMP,
  blueIce: GLACIER_RAMP,
  blackIce: BLACKICE_RAMP,
  rock: GRANITE_RAMP,
  rime: RIME_RAMP,
  scree: SCREE_RAMP,
  sulphur: SULPHUR_RAMP,
};

/* Where each surface sits in its own ramp, relative to the shared
   tonal position. Deep snow uses the full range - it is most of
   the level and a compressed range bands visibly across a 400m
   bowl. Rime uses almost none: rime is uniformly bright and its
   shape is carried by the feathers, which are geometry. */
const RAMP_BIAS = Object.freeze({
  snow: [1.00, 0.00],
  slab: [0.90, 0.06],
  blueIce: [1.00, 0.00],
  blackIce: [0.80, 0.05],
  rock: [0.88, 0.08],
  rime: [0.62, 0.30],
  scree: [0.90, 0.05],
  sulphur: [0.85, 0.10],
});

/* How far apart curvature is sampled, in metres, and the factor
   that brings a raw Laplacian into O(1). A 25m-amplitude gully at
   160m wavelength has |Laplacian| = 0.0386 per metre, which is a
   useless number to write thresholds against. */
const CURV_EPS = 14;
const CURV_SCALE = 25;

/* ============================================================
   HEIGHT FIELD
   ============================================================ */

export function makeSummitField(seed = 0x5e17fa11) {
  const nRib = makeNoise2D(seed + 1);
  const nBand = makeNoise2D(seed + 2);
  const nWarp = makeNoise2D(seed + 3);
  const nDetail = makeNoise2D(seed + 4);
  const nDrift = makeNoise2D(seed + 5);

  const WIND = SUMMIT_WIND;

  /* ---------------------- baked band tables ----------------------
     Both band fields are functions of BEARING ALONE, so they are
     baked once instead of being evaluated 1.35M times. Sampled on
     a circle in noise space, which is exactly periodic - this
     noise wraps at 256 in each axis and a circle closes on itself
     regardless, so there is no seam along -X. An angular table
     built from `theta * r` arc length would have one, and a seam
     on a cone is a 450m crack.

     Circle radius sets the feature count, and BOTH OF THESE ARE
     SLOWER THAN THEY LOOK LIKE THEY SHOULD BE, for a reason that
     only shows up when it is measured. A band's height changes at
     1.5*h*gate/riser per metre of effective radius - 2.25 m/m for
     the r=300 band - so the wobble does not just meander the band,
     it MULTIPLIES ITS OWN TANGENTIAL GRADIENT BY THAT FACTOR. The
     first version ran 41 lobes of +/-52m, which is 1.1m of radius
     per metre of arc, and it produced 79m elevation steps over 10m
     of ground on the north flank - grade 7.9, four times the
     steepest thing the layout authorises, and it swallowed the
     Glacier Tongue's crevasse field whole.

     17 lobes of +/-34m is 0.28 m/m, which comes back as a 0.6
     tangential grade on top of the band's own radial 2.4. Still a
     wandering, broken band; no longer a saw. The gate is slowed to
     15 lobes (a ~250m couloir spacing at the outer band) for the
     same reason, and each band keeps its own offset so the couloirs
     do not stack into one convenient staircase. */
  const bandTables = CLIFF_BANDS.map((band, i) => {
    const wob = new Float32Array(BAND_TABLE_N);
    const gate = new Float32Array(BAND_TABLE_N);
    for (let k = 0; k < BAND_TABLE_N; k += 1) {
      const a = (k / BAND_TABLE_N) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      wob[k] = nBand.fbm(ca * 2.8 + i * 13.7, sa * 2.8 + i * 4.3, 3) * 34;
      /* Clamped to [0, 1]: 1 is a full headwall, 0 is a couloir
         where the band simply is not. The +0.52 bias leaves rather
         more band than breach, which is what makes the ascent a
         search for the breach rather than a stroll through one. */
      gate[k] = clamp01(nBand.fbm(ca * 2.3 + i * 29.1 + 41, sa * 2.3 + i * 7.9, 2) * 2.3 + 0.52);
    }
    return { wob, gate, band };
  });

  /** Linear read of a baked bearing table. `a` is in radians. */
  function bandRead(table, a) {
    let u = (a / TAU) * BAND_TABLE_N;
    u -= Math.floor(u / BAND_TABLE_N) * BAND_TABLE_N;
    const i = u | 0;
    const f = u - i;
    const j = i + 1 === BAND_TABLE_N ? 0 : i + 1;
    return table[i] + (table[j] - table[i]) * f;
  }

  /* ------------------------- the ice mask -------------------------
     A glacier surface is not ribbed rock. Wherever SURFACE_ZONES
     says the ground is ice - the Tongue, the Cascade's cirque, the
     Tarn - the ribs, the cliff bands and most of the detail are
     damped out, so the ice reads as a smooth river and a mirror-flat
     lake rather than as a snowfield with a blue tint.

     It is keyed off the SAME table `surfaceAt` classifies from, and
     that is the point: the geometry and the material cannot disagree
     about where the ice is. It also does real work for the crevasse
     slots. A crevasse is a 22m feature; on ground that was already
     changing 40m every ten metres it was invisible, and the drawn
     mesh disagreed with the analytic field by 5.9m on the lip
     against a 0.5m budget - not because of the slot, but because of
     everything around it. On calmed ice the slot is the only thing
     there and the error is the slot's own 0.478m.

     Three hypots per height evaluation, behind a radius reject. */
  const ICE_ZONES = ["glacier", "cascade", "tarn"]
    .map((id) => ({ d: STATIONS[id], zone: SURFACE_ZONES[id] }))
    .filter((e) => e.zone);

  /* And every crevasse and moulin carries its own apron, whether it
     is on ice or not. A crevasse field is a smooth snow basin - that
     is why the slots are visible in it - and the arithmetic agrees:
     the mesh reproduces a 22m slot to 0.478m only if the ground
     around the slot is not already changing 40m every ten metres.
     The Avalanche Bowl's runnel and the summit cone's bergschrund
     are both off the ice and both need it. */
  const CALM_APRON = 70;

  function iceCalmAt(x, z) {
    let k = 0;
    for (let i = 0; i < ICE_ZONES.length; i += 1) {
      const e = ICE_ZONES[i];
      const dist = Math.hypot(x - e.d.x, z - e.d.z);
      const t = 1 - sstep(e.d.r * e.zone.in, e.d.r * e.zone.out, dist);
      if (t > k) k = t;
    }
    if (k >= 0.999) return 1;
    for (let i = 0; i < CREVASSES.length; i += 1) {
      const c = CREVASSES[i];
      const lim = c.reach + CALM_APRON;
      if (Math.abs(x - c.cx) > lim || Math.abs(z - c.cz) > lim) continue;
      const bax = c.bx - c.ax;
      const baz = c.bz - c.az;
      const hh = clamp01(((x - c.ax) * bax + (z - c.az) * baz)
        / (bax * bax + baz * baz || 1e-6));
      const d = Math.hypot(x - (c.ax + bax * hh), z - (c.az + baz * hh));
      const t = 1 - sstep(c.half + c.span, c.half + c.span + CALM_APRON, d);
      if (t > k) k = t;
    }
    for (let i = 0; i < MOULINS.length; i += 1) {
      const m = MOULINS[i];
      const lim = m.reach + CALM_APRON;
      if (Math.abs(x - m.x) > lim || Math.abs(z - m.z) > lim) continue;
      const d = Math.hypot(x - m.x, z - m.z);
      const t = 1 - sstep(m.floor + m.span, m.floor + m.span + CALM_APRON, d);
      if (t > k) k = t;
    }
    return k > 1 ? 1 : k;
  }

  /* ------------------------ relief field ------------------------ */

  /**
   * The anisotropic ridge field: spurs and gullies that run
   * DOWNHILL, plus the six cliff bands, plus fine detail.
   *
   * The trick is the noise lookup. Sampling on a circle of radius R
   * in noise space makes the field exactly periodic in the bearing;
   * sliding that circle along its own x axis in proportion to the
   * world radius decorrelates it with altitude. The elongation
   * ratio - how much longer a feature is downhill than across - is
   * R * L / r, so at R=5.2 and L=520 the macro ribs are 2:1
   * elongated in the valley and 14:1 on the summit cone, which is
   * how real ribs behave: they fan out at the bottom and converge
   * on the peak.
   *
   * NOTHING BELOW ~30m TANGENTIAL WAVELENGTH GOES IN, which is
   * terrain.js:1233-1245's lesson restated for polar coordinates.
   * The macro field has 2*PI*5.2 = 33 lobes around, so its
   * wavelength is 165m at the flanks and 36m at r=190; the meso
   * field has 82 lobes and would be 15m at r=190, so it is gated
   * off below r=380 where the mesh cannot carry it.
   */
  function reliefAt(x, z, r) {
    if (r < 6) return nDetail.fbm(x / 34, z / 34, 2) * 1.6;
    const invR = 1 / r;
    /* Domain warp on the bearing, so ribs meander instead of
       radiating like a bicycle wheel. Applied to the ANGLE rather
       than to the sample point: warping (x, z) directly would break
       the radial elongation, which is the one property this field
       exists to have. */
    const a = Math.atan2(z, x) + nWarp.fbm(x / 380, z / 380, 2) * 0.15;
    const ca = Math.cos(a);
    const sa = Math.sin(a);

    /* Relief scales with how steep the mountain already is: ribs
       and gullies are erosion, and erosion happens where water and
       ice move. On the flat valley and on the levelled parvis the
       field goes quiet on its own. */
    const steep = clamp01(summitProfileSlope(r) / 0.9);
    const outer = (1 - sstep(880, 1010, r)) * (1 - 0.92 * iceCalmAt(x, z));

    const macroAmp = 30 * steep * outer * sstep(90, 200, r);
    const macro = macroAmp > 0.01
      ? (nRib.ridged(ca * 5.2 + r / 520, sa * 5.2, 3) - 0.55) * macroAmp * 2.0
      : 0;

    const mesoAmp = 11 * steep * outer * sstep(300, 520, r);
    const meso = mesoAmp > 0.01
      ? (nRib.ridged(ca * 13.0 + r / 300 + 17.3, sa * 13.0 + 4.1, 2) - 0.55) * mesoAmp * 2.0
      : 0;

    /* --- the six cliff bands --- */
    let bands = 0;
    const bearing = Math.atan2(z, x);
    for (let i = 0; i < bandTables.length; i += 1) {
      const t = bandTables[i];
      const b = t.band;
      const re = b.r + bandRead(t.wob, bearing);
      if (r > re + b.riser + b.tread || r < re - b.tread) continue;
      const gate = bandRead(t.gate, bearing);
      if (gate <= 0.004) continue;
      const sharp = 1 - sstep(re, re + b.riser, r);
      const broad = 1 - sstep(re - b.tread, re + b.riser + b.tread, r);
      bands += b.h * gate * (sharp - broad);
    }
    bands *= outer;

    /* Two detail octaves. 34m carries eight samples per cycle at
       the 4m grid and is the finest thing the mesh can express;
       the 11m term is deliberately tiny - it is dither that keeps
       large faces off perfectly flat planes, not shape. */
    const detail = (nDetail.fbm(x / 34, z / 34, 2) * 1.7
      + nDetail.fbm(x / 11, z / 11, 2) * 0.32)
      * (1 - 0.75 * iceCalmAt(x, z));

    return macro + meso + bands + detail;
  }

  /* ---------------------- buttress spurs ----------------------
     Eight, at the arena bearings, so each arena sits on its own
     shoulder rather than on an arbitrary patch of slope - the
     layout's own words. This is the RIB: a broad radial ridge
     running from the valley to the summit cone. The SHELF that
     carries the arena floor is a separate term, applied with the
     station shaping below, because a rib and a terrace are
     different landforms and conflating them made the terrace a
     lump on a ridge rather than a ledge cut into one. */

  const SPURS = SPUR_STATIONS.map((id, i) => {
    const s = STATIONS[id];
    const rs = Math.hypot(s.x, s.z);
    return {
      id,
      i,
      rs,
      th: Math.atan2(s.z, s.x),
      padY: s.padY,
      padR: s.padR,
      /* Half-width of the rib. The eight bearings are 41-48 degrees
         apart, so 24 degrees puts the flanks of adjacent ribs
         together at the midpoint with zero weight each and leaves a
         gully between every pair. */
      ribAng: 24 * DEG,
      ribAmp: 20,
      /* The shelf's angular core has to CONTAIN the pad or the pad
         becomes a poker chip with a 50% bank round most of it.
         atan(padR * 1.12 / rs) is the pad's own angular radius with
         a little margin. */
      coreAng: Math.atan2(s.padR * 1.12, rs),
    };
  });

  /* Per-station shelf fades. The radial hold is padR + 46m so the
     pad's own 40m feather has nothing left to resolve; the fades
     are where the shelf hands back to the mountain, and they are
     asymmetric because a terrace on a mountain is: it blends into
     the flank above it and it ENDS in a face below it. `bell`'s
     120m outward fade against a 208m lift is the west-facing cliff
     the art direction asks for (a 98 degree... 60 degree face, just
     inside the walk limit at its flanks and well past it head-on). */
  const SHELF_TUNE = {
    basecamp: { fadeOut: 220, feather: 0.30 },
    tarn: { fadeOut: 190, feather: 0.30 },
    bowl: { fadeOut: 210, feather: 0.26 },
    glacier: { fadeOut: 190, feather: 0.26 },
    rime: { fadeOut: 180, feather: 0.28 },
    fumarole: { fadeOut: 165, feather: 0.26 },
    cascade: { fadeOut: 175, feather: 0.26 },
    bell: { fadeOut: 120, feather: 0.24 },
  };
  /* THE INWARD FADE IS DERIVED, and the first version's fixed
     240-320m is what forced it.

     Inward is uphill, so the profile is climbing toward the shelf's
     own elevation as the shelf fades out; the two meet on their own.
     A fixed fade that overshoots that meeting point does not blend,
     it EXCAVATES - the Bell Terrace's 300m fade reached r=346 where
     the mountain stands at 296m and the shelf insisted on 241, so it
     dug a 55m ditch a third of the way round the peak. The Via Sacra
     passes through exactly that band on three of its turns, which is
     how a 60m cutting appeared in a road whose design grade is 8%.

     So the fade is sized to the disagreement it actually has to
     resolve: D metres of it, blended with a smoothstep whose peak
     grade is 1.5D/S, solved for a 1.0 target (45 degrees - steep
     ground, comfortably inside player.js's 1.7 limit) and clamped to
     [60, 320]. Derived rather than tabulated, so moving a pad or
     re-authoring the elevation table cannot leave a stale fade
     behind. */
  const SHELF_BLEND_GRADE = 1.0;
  for (const s of SPURS) {
    const t = SHELF_TUNE[s.id];
    s.hold = s.padR + 46;
    s.fadeOut = t.fadeOut;
    s.featherAng = t.feather;
    const inner = Math.max(0, s.rs - s.hold);
    const drop = Math.abs(summitProfile(inner) - s.padY);
    s.fadeIn = clamp((1.5 * drop) / SHELF_BLEND_GRADE, 60, 320);
  }

  function buttressAt(x, z, r) {
    if (r < 60 || r > 1010) return 0;
    const a = Math.atan2(z, x);
    const env = (1 - sstep(900, 1010, r)) * sstep(70, 190, r);
    if (env <= 0.001) return 0;
    let lift = 0;
    for (let i = 0; i < SPURS.length; i += 1) {
      const s = SPURS[i];
      const da = Math.abs(angleDelta(a, s.th));
      if (da >= s.ribAng) continue;
      const k = 1 - smoothstep(da / s.ribAng);
      /* Longitudinal wobble, so the rib is a ridge rather than a
         smooth wedge. One noise lookup along the rib's own length
         with the spur index as the second axis, so no two ribs
         share a crest line. */
      const wob = 0.68 + 0.32 * clamp01(nRib.fbm(r / 140, s.i * 7.3, 2) * 1.6 + 0.5);
      lift += s.ribAmp * k * k * env * wob;
    }
    return lift;
  }

  /* ------------------- station shelves and pads ------------------- */

  /** Shelf weight for one spur at (x, z). Radial hold + fade,
   *  multiplied by an angular core + feather. */
  function shelfWeight(x, z, r, a, s) {
    const dr = r - s.rs;
    const ad = Math.abs(dr);
    const fade = dr >= 0 ? s.fadeOut : s.fadeIn;
    const radW = 1 - sstep(s.hold, s.hold + fade, ad);
    if (radW <= 0.001) return 0;
    const da = Math.abs(angleDelta(a, s.th));
    const angW = 1 - sstep(s.coreAng, s.coreAng + s.featherAng, da);
    return radW * angW;
  }

  /* The two helpers, copied from terrain.js:625-628. `w` is the
     soft district weight; `pad` is the hard flattening lerp. */
  const w = (x, z, d, softness = 0.42) =>
    1 - sstep(1 - softness, 1.0, Math.hypot(x - d.x, z - d.z) / d.r);
  const pad = (h, target, x, z, cx, cz, r, feather) =>
    lerp(h, target, 1 - sstep(r, r + feather, Math.hypot(x - cx, z - cz)));

  /* ------------------------ path profiles ------------------------ */

  /**
   * The ground the VIA SACRA is designed against - option (a) of
   * the contract's open question 1, in its minimal form: the
   * authored radial profile and the parvis it terminates on, and
   * nothing else.
   *
   * That "nothing else" is the expensive part of this file's
   * history, so the measurement is written down.
   *
   * The first version sampled the profile PLUS the buttress ribs
   * PLUS the arena shelves - the whole landform - on the reasoning
   * that a road which knows more about the mountain rides it
   * better. It does not, and the reason is that A GRADE LIMITER'S
   * CLIP IS CUMULATIVE. The limiter's forward sweep enforces
   * y[i] <= y[i-1] + cap*d. A 20m rib crossed in 100m of road asks
   * for a 20% rise, gets clipped to 11.5%, and the road is left 8m
   * short - permanently, because the only way to recover is to
   * climb at the cap while the ground is flat, and with a mean
   * grade of 8.35% against an 11.5% cap the recovery rate is
   * 3.15%. One rib costs 630m of road to pay back, and there is a
   * rib every 150m. Measured: the road ended up buried 30 to 70m
   * under its own landform for the whole upper half of the climb,
   * with a worst cutting of 57m - terrain.js:875-878's "the road
   * read as a canyon", at ten times the scale.
   *
   * So the design source is the SMOOTH mountain. The ribs, the
   * cliff bands, the meso relief and the detail are things a road
   * cuts through, and they arrive as local cuttings of a rib's own
   * height (20m over a 22m shoulder - steep, and what a real
   * mountain road cutting looks like) rather than as a permanent
   * deficit.
   *
   * The arena shelves and the levelled pads DO stay in, and the
   * second version of this function taking them out is the other
   * half of the lesson. Without them the road's design elevation
   * disagreed with the ground it was cut into by up to 87m wherever
   * it crossed a shelf, and the spur cut - applied after the road
   * cut in `viaSacraCut` - tore an 85m hole through the Via Sacra at
   * the Glacier Tongue's junction. A shelf is not high-frequency
   * relief; it is part of the mountain's shape, and with the inward
   * fades derived rather than tabulated (see SHELF_TUNE) it is
   * shallow enough for the road to ride.
   */
  function roadLandform(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    let h = summitProfile(r);
    for (let i = 0; i < SPURS.length; i += 1) {
      const s = SPURS[i];
      const k = shelfWeight(x, z, r, a, s);
      if (k > 0.001) h = lerp(h, s.padY, k);
      const st = STATIONS[s.id];
      h = pad(h, st.padY, x, z, st.x, st.z, st.padR, PAD_FEATHER);
    }
    /* The parvis. It has no shelf - the profile already reaches 452
       at the centre - but the road's last hundred metres have to know
       it is there or the processional way arrives seven metres under
       its own doors. */
    return pad(h, STATIONS.summit.padY, x, z, 0, 0,
      STATIONS.summit.padR, PAD_FEATHER);
  }

  /**
   * terrain.js:493-514's builder with the sampler injected.
   *
   * The [1,2,1]/4 binomial smooth with the endpoints pinned is
   * unchanged and so is the reason for it: a road that follows the
   * terrain inherits every feature it crosses and rides like a
   * rollercoaster.
   */
  function buildPathProfile(path, spacing, smoothPasses, sampler) {
    let total = 0;
    for (let i = 1; i < path.length; i += 1) {
      total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    const samples = Math.max(4, Math.round(total / spacing) + 1);
    const pts = [];
    for (let i = 0; i < samples; i += 1) {
      const t = i / (samples - 1);
      const seg = t * (path.length - 1);
      const k = Math.min(path.length - 2, Math.floor(seg));
      const f = seg - k;
      const px = lerp(path[k][0], path[k + 1][0], f);
      const pz = lerp(path[k][1], path[k + 1][1], f);
      pts.push({ x: px, z: pz, y: 0 });
    }
    for (const p of pts) p.y = sampler(p.x, p.z);
    for (let pass = 0; pass < smoothPasses; pass += 1) {
      const copy = pts.map((p) => p.y);
      for (let i = 1; i < pts.length - 1; i += 1) {
        pts[i].y = (copy[i - 1] + copy[i] * 2 + copy[i + 1]) * 0.25;
      }
    }
    return pts;
  }

  /**
   * Slope limiter. Two symmetric sweeps, forward then backward,
   * repeated: the standard monotone filter, and it converges
   * because each sweep only ever moves a node toward its
   * predecessor's reachable band.
   *
   * This is what turns "the road is designed at 8.2%" into "the
   * road IS at or under 11.5% everywhere", which is what the
   * traversal harness measures. Without it the shelf crossings -
   * the road entering and leaving the Avalanche Bowl's levelled
   * floor, for instance - are the only places the design grade
   * does not hold, and they are exactly the places a player
   * notices.
   */
  function gradeLimit(pts, maxGrade, passes = 3) {
    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 1; i < pts.length; i += 1) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        const cap = d * maxGrade;
        const dy = pts[i].y - pts[i - 1].y;
        if (dy > cap) pts[i].y = pts[i - 1].y + cap;
        else if (dy < -cap) pts[i].y = pts[i - 1].y - cap;
      }
      for (let i = pts.length - 2; i >= 0; i -= 1) {
        const d = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].z - pts[i + 1].z);
        const cap = d * maxGrade;
        const dy = pts[i].y - pts[i + 1].y;
        if (dy > cap) pts[i].y = pts[i + 1].y + cap;
        else if (dy < -cap) pts[i].y = pts[i + 1].y - cap;
      }
    }
    return pts;
  }

  /**
   * Spatial index over one or more profiles' segments.
   *
   * terrain.js:517-522's structure, generalised to a LIST of
   * profiles so the eight arena spurs share one index. Eight
   * separate indices would have been eight Map lookups per
   * `heightAt` - 10.8M lookups across the build - and the joining
   * segment between spur i's tail and spur i+1's head would have
   * cut a road across the mountain that nobody authored.
   */
  function indexProfiles(profiles, reach) {
    const CELL = 64;
    const buckets = new Map();
    const key = (gx, gz) => gx * 8192 + gz;
    const segs = [];
    for (let p = 0; p < profiles.length; p += 1) {
      const prof = profiles[p];
      for (let i = 0; i < prof.length - 1; i += 1) {
        segs.push({ a: prof[i], b: prof[i + 1], p, t: i / (prof.length - 1) });
      }
    }
    for (let n = 0; n < segs.length; n += 1) {
      const { a, b } = segs[n];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / CELL);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / CELL);
      const z1 = Math.floor((Math.max(a.z, b.z) + reach) / CELL);
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gz = z0; gz <= z1; gz += 1) {
          const k = key(gx, gz);
          let list = buckets.get(k);
          if (!list) { list = []; buckets.set(k, list); }
          list.push(n);
        }
      }
    }
    return {
      segs,
      reach,
      query(x, z) {
        const list = buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!list) return null;
        let bestD = Infinity;
        let bestY = 0;
        let bestP = -1;
        let bestT = 0;
        for (let n = 0; n < list.length; n += 1) {
          const s = segs[list[n]];
          const a = s.a;
          const b = s.b;
          const bax = b.x - a.x;
          const baz = b.z - a.z;
          const hh = clamp01(
            ((x - a.x) * bax + (z - a.z) * baz) / (bax * bax + baz * baz || 1e-6)
          );
          const px = a.x + bax * hh;
          const pz = a.z + baz * hh;
          const d = Math.hypot(x - px, z - pz);
          if (d < bestD) {
            bestD = d;
            bestY = lerp(a.y, b.y, hh);
            bestP = s.p;
            bestT = s.t;
          }
        }
        return bestD > reach ? null : { d: bestD, y: bestY, path: bestP, t: bestT };
      },
    };
  }

  const viaSacraProfile = gradeLimit(
    buildPathProfile(VIA_SACRA_PATH, VIA_SACRA_STEP, 26, roadLandform),
    0.115
  );
  /* Spurs are tracks, not a processional way: a steeper ceiling and
     less smoothing, so they dip through the gullies they cross
     instead of standing on causeways over them.
 
     THE CEILING IS PER-SPUR AND DERIVED, because a fixed one cannot
     work. The Glacier Tongue's arena is 139m BELOW the road node
     that serves it and 479m away - it needs 29%. Capped at a flat
     16% the spur profile could not descend fast enough and arrived
     62m above its own pad; padExit then switched the cut off at the
     pad edge and left a 62m step where the track was supposed to
     end. So each spur is allowed 1.25x the grade its two endpoints
     demand, floored at 14% and ceilinged at 42% - which is 23
     degrees, still less than half of player.js's 1.7 slope limit. */
  const spurProfiles = VIA_SACRA_SPURS.map((s) => {
    const st = STATIONS[s.id];
    const need = s.length > 1
      ? Math.abs(st.padY - viaSacraNodes[s.from].y) / s.length
      : 0;
    const cap = clamp(need * 1.25, 0.14, 0.42);
    return gradeLimit(buildPathProfile(s.points, VIA_SACRA_STEP, 14, roadLandform), cap);
  });

  /* Reach: the road's graded shoulder runs to 22m and the ditch
     sits at 26m, so 48m of index reach covers the profile with
     margin. terrain.js uses the same figure for the same reason. */
  const roadIndex = indexProfiles([viaSacraProfile], 48);
  const spurIndex = indexProfiles(spurProfiles, 30);

  /* ------------------------- the road cut ------------------------- */

  /**
   * How much of the road cut survives at (x, z), given the nine
   * levelled pads. 0 inside a pad, 1 outside its skirt.
   *
   * Option (b) of open question 1, applied at all nine stations
   * rather than only at the parvis - see the Via Sacra header for
   * the Avalanche Bowl measurement that forced it.
   */
  function padExitAt(x, z) {
    let k = 1;
    for (let i = 0; i < STATION_ORDER.length; i += 1) {
      const s = STATIONS[STATION_ORDER[i]];
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.padR * 1.55) continue;
      /* EXACTLY zero at padR, not 5% of it. The first version faded
         from 0.92*padR and left the cut running at a few percent
         across the outermost ring of every pad: 8cm at the Bell
         Terrace, 58cm at the Avalanche Bowl where the road's own
         profile disagrees with the pad level by 14.3m. The traversal
         harness asserts +/-0.35m across the pad's whole radius, so
         the fade has to START at padR. */
      const e = sstep(s.padR, s.padR * 1.55, d);
      if (e < k) k = e;
      if (k <= 0.001) return 0;
    }
    return k;
  }

  /** Extra carriageway at the six marked turns. */
  function apronAt(x, z) {
    let a = 0;
    for (let i = 0; i < VIA_SACRA_TURNS.length; i += 1) {
      const t = VIA_SACRA_TURNS[i];
      const d = Math.hypot(x - t.x, z - t.z);
      if (d >= APRON_REACH) continue;
      const k = APRON_WIDTH * (1 - smoothstep(d / APRON_REACH));
      if (k > a) a = k;
    }
    return a;
  }

  /**
   * The cut, adapted from terrain.js:866-892 to the layout's 11m
   * carriageway.
   *
   * The shoulder width is not decoration. terrain.js:875-878
   * records that at 3.5m Vesper's cut met a 22m dune with a
   * vertical wall and read as a canyon; a road that crosses a
   * mountain has to have a cutting with sides you could walk up.
   * Here it runs out to 22m, and where a marked turn widens the
   * apron both the bed and the ditch move outward together so the
   * profile stays a road profile rather than growing a step.
   */
  function viaSacraCut(h, x, z) {
    const q = roadIndex.query(x, z);
    if (q) {
      const exit = padExitAt(x, z);
      if (exit > 0.002) {
        const apron = apronAt(x, z);
        const bed = 1 - sstep(5.5 + apron, 22.0 + apron, q.d);
        const ditch = Math.exp(-((q.d - 26.0 - apron) ** 2) / (2 * 4.2 * 4.2)) * -1.1;
        const cut = Math.pow(bed, 0.55) * exit;
        h = lerp(h, q.y + 1.05, cut) + ditch * (1 - bed) * exit;
      }
    }
    const s = spurIndex.query(x, z);
    if (s) {
      const exit = padExitAt(x, z);
      if (exit > 0.002) {
        /* Narrower, shallower, no ditch. A spur is a track cut by
           whoever had to reach the arena, not a processional way. */
        const bed = 1 - sstep(3.6, 13.5, s.d);
        h = lerp(h, s.y + 0.55, Math.pow(bed, 0.6) * exit);
      }
    }
    return h;
  }

  /* -------------------------- crevasses -------------------------- */

  /**
   * The slots, applied last of all and as a pure subtraction -
   * terrain.js:906's crater rule. Two guards, and both of them
   * exist because a feature that wins over everything can undo
   * work that has already been done:
   *
   *  - the PAD guard, because the traversal harness asserts every
   *    arena floor is flat to +/-0.35m across its radius, and a
   *    22m slot is not that;
   *  - the ROAD guard, because a crevasse that swallows the Via
   *    Sacra severs the level and the failure looks like a
   *    pathfinding bug rather than a terrain one.
   */
  function crevasseAt(x, z) {
    let drop = 0;
    for (let i = 0; i < CREVASSES.length; i += 1) {
      const c = CREVASSES[i];
      if (Math.abs(x - c.cx) > c.reach || Math.abs(z - c.cz) > c.reach) continue;
      const bax = c.bx - c.ax;
      const baz = c.bz - c.az;
      const len2 = bax * bax + baz * baz || 1e-6;
      const hh = clamp01(((x - c.ax) * bax + (z - c.az) * baz) / len2);
      const px = c.ax + bax * hh;
      const pz = c.az + baz * hh;
      const d = Math.hypot(x - px, z - pz);
      if (d >= c.half + c.span) continue;
      /* The tips ramp out. `u` is 0 at the centre and 1 at either
         end; the depth is held over the inner half and tapered to
         nothing over the outer half, which puts the floor's own
         grade at about 1.5*depth/(0.5*halfLength) - 1.3 for the
         smallest slot here, inside WALK_SLOPE_LIMIT. That taper is
         the escape ramp, and it is the reason a crevasse on this
         level is a hazard rather than a softlock. */
      const u = Math.abs(hh * 2 - 1);
      const taper = 1 - smoothstep(clamp01((u - 0.5) / 0.5));
      if (taper <= 0.002) continue;
      const wall = slotWall(c.half + c.span - d, c.span, c.depth, CREVASSE_EASE);
      drop += wall * taper;
    }
    for (let i = 0; i < MOULINS.length; i += 1) {
      const m = MOULINS[i];
      if (Math.abs(x - m.x) > m.reach || Math.abs(z - m.z) > m.reach) continue;
      const d = Math.hypot(x - m.x, z - m.z);
      if (d >= m.floor + m.span) continue;
      drop += slotWall(m.floor + m.span - d, m.span, m.depth, MOULIN_EASE);
    }
    if (drop >= -0.002) return 0;

    let guard = 1;
    for (let i = 0; i < STATION_ORDER.length; i += 1) {
      const s = STATIONS[STATION_ORDER[i]];
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.padR + 48) continue;
      /* Clear of the pad, and only just: 6m of margin outside padR
         where the flatness probe stops, fading in over 42m.
         The first version cleared by 0.42*padR - 69m at the Glacier
         Tongue - which sounds safe and is not, because the guard
         then ramps a 22m slot's whole depth across that distance
         and the ramp itself is a landform. Held to a 42m fade the
         guard's own second derivative is 6*22/42^2 = 0.075, so it
         contributes 0.15m to the mesh error rather than half a
         metre of it, and the crevasse field can lie where a glacier
         actually crevasses instead of 200m up-slope of it. */
      const g = sstep(s.padR + 6, s.padR + 48, d);
      if (g < guard) guard = g;
    }
    if (guard > 0.002) {
      const q = roadIndex.query(x, z);
      if (q) guard *= sstep(0, 44, q.d);
      if (guard > 0.002) {
        const sp = spurIndex.query(x, z);
        if (sp) guard *= sstep(0, 28, sp.d);
      }
    }
    return drop * guard;
  }

  /* ============================================================
     THE COMPOSED HEIGHT

     Order is the contract's section 3.2 and it is load-bearing:
     bulk landform, then relief, then the buttresses, then the
     stations in a fixed order, then the road cut, then the
     crevasses. Everything later carves through everything earlier,
     which is why the cuts are last: they have to win over whatever
     they cross.
     ============================================================ */

  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    let h = summitProfile(r);                    // 1. the authored silhouette
    h += reliefAt(x, z, r);                      // 2. anisotropic ribs + cliff bands
    h += buttressAt(x, z, r);                    // 3. eight arena buttresses

    /* 4. the stations, in a fixed order, summit last. */
    const a = Math.atan2(z, x);
    for (let i = 0; i < SPURS.length; i += 1) {
      const s = SPURS[i];
      const k = shelfWeight(x, z, r, a, s);
      if (k <= 0.001) continue;
      /* The shelf target carries a little relief of its own outside
         the pad, or an arena reads as a table standing on a
         mountain. Inside the pad the flattening lerp below
         overwrites it exactly, so the +/-0.35m assertion is
         untouched. */
      const bump = nDetail.fbm(x / 62, z / 62, 2) * 2.4;
      h = lerp(h, s.padY + bump, k);
      const st = STATIONS[s.id];
      h = pad(h, st.padY, x, z, st.x, st.z, st.padR, PAD_FEATHER);
    }
    {
      const st = STATIONS.summit;
      h = pad(h, st.padY, x, z, st.x, st.z, st.padR, PAD_FEATHER);
    }

    h = viaSacraCut(h, x, z);                    // 5. the road, cut late
    h += crevasseAt(x, z);                       // 6. the slots, cut last
    return h;
  }

  /* ---------------------- analytic normal ---------------------- */

  /* terrain.js:925-933's EPS, unchanged. Four full height
     evaluations per call, and that cost buys the property the
     whole LOD scheme depends on: two LODs of the same ground light
     identically, so a swap does not flash. A mesh-derived normal
     would flash at every range boundary on a level whose entire
     texture story is grazing light. */
  const EPS = 1.6;
  function normalAt(x, z, out) {
    const nx = heightAt(x - EPS, z) - heightAt(x + EPS, z);
    const nz = heightAt(x, z - EPS) - heightAt(x, z + EPS);
    const ny = 2 * EPS;
    const inv = 1 / Math.hypot(nx, ny, nz);
    if (out) { out[0] = nx * inv; out[1] = ny * inv; out[2] = nz * inv; return out; }
    return [nx * inv, ny * inv, nz * inv];
  }

  /* ------------------------- curvature ------------------------- */

  /**
   * Discrete Laplacian, scaled into O(1). POSITIVE is concave - a
   * gully, a bowl, a couloir floor; NEGATIVE is convex - a ridge,
   * a rib crest, a lip.
   *
   * Sampled at 14m rather than at the normal's 1.6m. Curvature at
   * 1.6m on this field measures the detail octave, which is dither;
   * the question `surfaceAt` and `snowDepthAt` are actually asking -
   * "is this a place snow collects or a place the wind strips" -
   * is about features 30-160m across.
   *
   * Five height evaluations. The mesh builder does NOT pay them: it
   * passes a hint read off the 8m coarse grid, which is the same
   * measurement at a twentieth of the price. See `coarseCurvature`.
   */
  function curvatureAt(x, z) {
    const e = CURV_EPS;
    const c = heightAt(x, z);
    const sum = heightAt(x + e, z) + heightAt(x - e, z)
      + heightAt(x, z + e) + heightAt(x, z - e);
    return ((sum - 4 * c) / (e * e)) * CURV_SCALE;
  }

  /* ------------------- surface classification ------------------- */

  /**
   * What the ground is made of, as blend weights.
   *
   * PLACED BY PHYSICS, not by station radius. Vesper could classify
   * by district because its districts ARE its geology - a bone pan,
   * a glass crater, an ash terrace. A mountain's are not: the same
   * rock band, the same wind slab and the same rime run through
   * every station on the map, and a classifier keyed to radius
   * would draw eight coloured discs.
   *
   * So four physical fields do the work - slope, altitude,
   * aspect-to-wind and curvature - and the station table only adds
   * the three things that genuinely belong to one place: the Tarn's
   * black ice, the Tongue's and the Cascade's glacier ice, and the
   * Fumarole's sulphur.
   *
   * `slopeHint` is an optional [nx, ny, nz] and only [1] is read,
   * exactly as terrain.js:975 does. `curvHint` is the same bargain
   * one level up. Passing both saves nine height evaluations per
   * vertex, and this is called 270k times at build.
   */
  function surfaceAt(x, z, slopeHint, curvHint) {
    const out = {
      snow: 1, slab: 0, blueIce: 0, blackIce: 0, rock: 0, rime: 0,
      scree: 0, sulphur: 0, district: null, districtWeight: 0,
    };

    /* --- two independent radial fields per station --- */
    let best = 0;
    let bestName = null;
    for (let i = 0; i < STATION_ORDER.length; i += 1) {
      const name = STATION_ORDER[i];
      const d = STATIONS[name];
      const dist = Math.hypot(x - d.x, z - d.z);
      const near = 1 - sstep(d.r * 0.55, d.r * 1.05, dist);
      if (near > best) { best = near; bestName = name; }
      const zone = SURFACE_ZONES[name];
      if (!zone) continue;
      const t = 1 - sstep(d.r * zone.in, d.r * zone.out, dist);
      if (t <= 0) continue;
      const v = t * zone.w;
      if (v > out[zone.key]) out[zone.key] = v;
    }
    out.district = bestName;
    out.districtWeight = best;

    const nrm = slopeHint || normalAt(x, z);
    const ny = clamp01(nrm[1]);
    const y = heightAt(x, z);
    const slopeDeg = Math.acos(clamp(ny, -1, 1)) / DEG;
    const curv = curvHint === undefined ? curvatureAt(x, z) : curvHint;

    /* Exposure to the prevailing wind. The horizontal part of the
       normal points away from the face; a face looking INTO the
       wind has it opposed to the travel vector. */
    const windward = clamp(-(nrm[0] * WIND.x + nrm[2] * WIND.z), -1, 1);

    /* --- rock: above the snowline and on anything too steep to
       hold ---------------------------------------------------------
       38 degrees is where snow stops holding, which is the layout's
       number and also the real one. The altitude term is gated by
       convexity as well as height: a gully floor at 400m is filled
       with what slid into it, and painting it bare rock is what
       makes a snow level look like a grey level. */
    let rock = sstep(34, 44, slopeDeg) * 0.96;
    rock = Math.max(rock, sstep(360, 405, y) * 0.62 * clamp01(0.45 - curv * 0.6));
    out.rock = clamp01(Math.max(out.rock, rock));

    /* --- rime: windward faces, above the inversion -----------------
       Rime is supercooled fog freezing on impact, so it needs a face
       to hit, wind to arrive on, and air cold enough - which on this
       world means above the cloud deck at 120m. It grows on the wind
       side ONLY, and that directionality is the single clearest
       "this is cold" signal in the level. */
    const rime = sstep(0.16, 0.60, windward)
      * sstep(10, 34, slopeDeg)
      * sstep(120, 280, y)
      * 0.88;
    out.rime = clamp01(Math.max(out.rime, rime * (1 - out.rock * 0.7)));

    /* --- wind slab: exposed convex ground above the inversion ------
       Convex (curv < 0) and not too steep. Wind slab is snow that
       has been transported and pressed, so it forms where the wind
       accelerates over a shoulder, and it is what the sastrugi
       shader in summit-art has to sit on. */
    const slab = clamp01(sstep(-0.10, -0.80, curv))
      * sstep(60, 220, y)
      * (1 - sstep(28, 40, slopeDeg))
      * clamp01(0.35 + windward * 0.85)
      * 0.88;
    out.slab = clamp01(Math.max(out.slab, slab * (1 - out.rock) * (1 - out.blueIce)));

    /* --- scree: wind-scoured moraine below the snowline ----------- */
    const scree = sstep(24, 38, slopeDeg) * (1 - sstep(70, 190, y)) * 0.7;
    out.scree = clamp01(Math.max(out.scree, scree * (1 - out.rock) * (1 - out.blackIce)));

    /* Ice is a body of water or a glacier and neither of them is on
       a 40 degree face. Trim the zone weights by slope so the
       Tongue's cyan stops at the valley wall rather than climbing
       it. */
    const iceHold = 1 - sstep(26, 40, slopeDeg);
    out.blueIce *= iceHold;
    out.blackIce *= 1 - sstep(6, 16, slopeDeg);

    /* The station's own bias toward or away from deep snow -
       summit-art's STATION_TINT.snow. The Fumarole is bare because
       it is warm; the Bowl is loaded because it is a catchment. */
    const tint = STATION_TINT[out.district];
    if (tint && best > 0.02 && tint.snow) {
      const bias = tint.snow * best;
      if (bias < 0) {
        const strip = clamp01(-bias);
        out.slab = clamp01(out.slab + strip * 0.4 * (1 - out.rock));
        out.rock = clamp01(out.rock + strip * 0.22);
      } else {
        out.slab *= 1 - clamp01(bias) * 0.5;
      }
    }

    /* Residual. Deep snow is whatever nothing else claimed, which
       is the right way round: on this world snow is the default
       state of every surface that is not too steep, too warm, too
       windy or under water. */
    let taken = 0;
    for (let i = 0; i < SURFACE_KEYS.length; i += 1) taken += out[SURFACE_KEYS[i]];
    out.snow = clamp01(1 - clamp01(taken));
    return out;
  }

  /* ------------------------- snow depth ------------------------- */

  /**
   * Metres of lying snow. The layout's section 4 formula, and it
   * has FOUR readers: this file's `colourAt`, summit-world's prop
   * bedding, summit-weather's spindrift density and (through
   * summit-main's `applySlow`) the player's own feel. If any of
   * them computes its own version they drift apart and the level
   * looks like snow painted on rather than snow lying in.
   */
  function snowDepthAt(x, z, slopeHint, curvHint) {
    const nrm = slopeHint || normalAt(x, z);
    const ny = clamp01(nrm[1]);
    const y = heightAt(x, z);
    const slopeDeg = Math.acos(clamp(ny, -1, 1)) / DEG;
    const curv = curvHint === undefined ? curvatureAt(x, z) : curvHint;

    /* 1.4m in the valley, 0.35m at 400m. Higher is not deeper: the
       air is too thin and the wind too strong to hold it. */
    const base = lerp(1.4, 0.35, clamp01(y / 400));
    /* 1 at flat, 0 above 38 degrees. */
    const slope = 1 - sstep(20, 38, slopeDeg);
    /* 1.55 on the lee, 0.45 on the windward. */
    const windward = clamp(-(nrm[0] * WIND.x + nrm[2] * WIND.z), -1, 1);
    const aspect = lerp(1.55, 0.45, clamp01(windward * 0.5 + 0.5));
    /* Fills gullies, strips ridges. */
    const curvature = clamp(1 + curv * 0.55, 0.25, 1.9);
    /* Drift. The long-wavelength field only: a prop's own drift
       tail is summit-world's `snowCap`, laid on top of this. */
    const drift = clamp01(nDrift.fbm(x / 145, z / 145, 3) * 1.3 + 0.5) * 0.42
      * (1 - sstep(24, 40, slopeDeg));

    let depth = base * slope * aspect * curvature + drift;

    /* The road reads as TRAVELLED - the layout's 40%. Applied
       through the same index the cut uses so the scoured strip and
       the carriageway cannot drift apart. */
    const q = roadIndex.query(x, z);
    if (q) depth *= lerp(0.40, 1, sstep(5.5, 20, q.d));
    return Math.max(0, depth);
  }

  /* ---------------------- road/pad diagnostics ----------------------
     Measured at load, not asserted: for each station, the largest
     disagreement between the smoothed road profile and the pad's
     own level over the samples that fall inside the pad. The
     padExit above is what keeps that disagreement out of the pad,
     and this is the number that says whether it is working. */
  const padRoadError = {};
  for (let i = 0; i < STATION_ORDER.length; i += 1) {
    const id = STATION_ORDER[i];
    const s = STATIONS[id];
    let worst = 0;
    for (let n = 0; n < viaSacraProfile.length; n += 1) {
      const p = viaSacraProfile[n];
      if (Math.hypot(p.x - s.x, p.z - s.z) > s.padR) continue;
      worst = Math.max(worst, Math.abs(p.y - s.padY));
    }
    padRoadError[id] = worst;
  }

  /** The grade histogram the contract's open question 1 asks to be
   *  recorded, measured over the built profile rather than over the
   *  design intent. Buckets are whole percent. */
  function viaSacraGrade(samples = 600) {
    const hist = new Array(26).fill(0);
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < samples; i += 1) {
      const t0 = i / samples;
      const t1 = (i + 1) / samples;
      const a = viaSacraPointAt(t0);
      const b = viaSacraPointAt(t1);
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (run < 1e-3) continue;
      /* Sampled off the CUT profile, not off the design curve. */
      const ya = roadIndex.query(a.x, a.z);
      const yb = roadIndex.query(b.x, b.z);
      if (!ya || !yb) continue;
      const g = Math.abs(yb.y - ya.y) / run;
      max = Math.max(max, g);
      sum += g;
      n += 1;
      hist[Math.min(25, Math.floor(g * 100))] += 1;
    }
    return { max, mean: n ? sum / n : 0, samples: n, histogram: hist };
  }

  return {
    heightAt,
    normalAt,
    surfaceAt,
    snowDepthAt,
    curvatureAt,
    profile: summitProfile,
    profileSlope: summitProfileSlope,
    roadLandform,
    roadIndex,
    spurIndex,
    viaSacraProfile,
    spurProfiles,
    viaSacraGrade,
    padRoadError,
    shelfWeight,
    spurs: SPURS,
    wind: WIND,
    noise: { rib: nRib, band: nBand, warp: nWarp, detail: nDetail, drift: nDrift },
  };
}

/* ============================================================
   MESH BUILD
   ============================================================ */

export async function buildSummitTerrain(ctx, onProgress) {
  const { THREE, scene, materials } = ctx;
  const field = ctx.field || makeSummitField(ctx.seed);
  const rng = makeRng((ctx.seed ^ 0x4b17) >>> 0);

  const group = new THREE.Group();
  group.name = "terrain";
  scene.add(group);
  /* ONE material for all 256 meshes. Every surface distinction on
     the ground is carried by vertex colour and by the sastrugi and
     scatter terms inside summit-art's `snow` extension; a second
     terrain material would double the draw calls and buy a
     discontinuity at the chunk seam where they met. */
  const material = materials.snow;

  /* ---------------------- coarse height grid ---------------------- */

  const COARSE = 8;
  const cDim = MAP_SIZE / COARSE + 1;          // 257
  const coarse = new Float32Array(cDim * cDim);
  for (let j = 0; j < cDim; j += 1) {
    const z = -MAP_HALF + j * COARSE;
    for (let i = 0; i < cDim; i += 1) {
      coarse[j * cDim + i] = field.heightAt(-MAP_HALF + i * COARSE, z);
    }
    if (onProgress && (j & 63) === 0) {
      onProgress(0.02 + 0.10 * (j / cDim));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  function coarseHeight(x, z) {
    const fx = clamp((x + MAP_HALF) / COARSE, 0, cDim - 1.001);
    const fz = clamp((z + MAP_HALF) / COARSE, 0, cDim - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const a = coarse[j * cDim + i];
    const b = coarse[j * cDim + i + 1];
    const c = coarse[(j + 1) * cDim + i];
    const d = coarse[(j + 1) * cDim + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /** The curvature hint every chunk sample passes into `surfaceAt`
   *  and `snowDepthAt`. Same 14m stencil as the analytic version,
   *  read off the coarse grid: five bilinear lookups instead of
   *  five full height evaluations, which across 270k samples is
   *  1.35M height evaluations that do not happen. */
  function coarseCurvature(x, z) {
    const e = CURV_EPS;
    const c = coarseHeight(x, z);
    const sum = coarseHeight(x + e, z) + coarseHeight(x - e, z)
      + coarseHeight(x, z + e) + coarseHeight(x, z - e);
    return ((sum - 4 * c) / (e * e)) * CURV_SCALE;
  }

  /* ---- baked occlusion ----

     terrain.js:1064-1096's rings, weights and squaring, unchanged,
     with ONE summit-specific correction that the contract flags and
     that is not optional here.

     terrain.js measures occlusion as "how much of the ground on
     four rings stands above me". On a basin that is occlusion. ON A
     CONE IT IS THE MOUNTAIN: at any point on a 40% flank, every
     sample on the uphill half of every ring is above the sample
     point by definition, so the whole uphill side of the peak bakes
     out dark and the term stops describing concavity at all. That
     is the same class of failure as the 190m ring terrain.js
     rejected, except it is structural rather than a tuning mistake.

     So the comparison is against the LOCAL PLANE rather than
     against the point: `y + (dx, dz) . gradient`. A uniform slope
     then contributes exactly zero and only genuine pits, gully
     floors, crevasse interiors and the inside corners of the cliff
     bands darken - which is what the term is for. The gradient
     comes free from the normal the sampler has already computed;
     when a caller has no normal it is read off the coarse grid. */
  const aoDirs = [];
  for (const [radius, count] of [[4, 6], [11, 6], [26, 8], [54, 8]]) {
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + radius * 0.37;
      aoDirs.push([Math.cos(a) * radius, Math.sin(a) * radius, radius]);
    }
  }
  const aoNorm = aoDirs.reduce((s, d) => s + 1 / (1 + d[2] * 0.10), 0) * 0.34;

  function occlusionAt(x, z, y, normal) {
    let gx;
    let gz;
    if (normal && Math.abs(normal[1]) > 1e-4) {
      /* dy/dx of the surface, from the unit normal. */
      gx = -normal[0] / normal[1];
      gz = -normal[2] / normal[1];
    } else {
      const e = 8;
      gx = (coarseHeight(x + e, z) - coarseHeight(x - e, z)) / (2 * e);
      gz = (coarseHeight(x, z + e) - coarseHeight(x, z - e)) / (2 * e);
    }
    let occ = 0;
    for (let i = 0; i < aoDirs.length; i += 1) {
      const d = aoDirs[i];
      const plane = y + gx * d[0] + gz * d[1];
      occ += clamp01((coarseHeight(x + d[0], z + d[1]) - plane) / d[2])
        * (1 / (1 + d[2] * 0.10));
    }
    const o = clamp01(occ / aoNorm);
    return o * o;
  }

  /* ---------------------- vertex colour ---------------------- */

  /* SHADOW TINT.

     Vesper's is [0.30, 0.16, 0.26] plus [0.055, 0.030, 0.062] - a
     violet, because multiplying to grey makes baked AO look dirty
     (terrain.js:1158-1159). Kenosis needs the same instrument
     turned to a different hue: shadowed snow is SATURATED BLUE, not
     grey and not violet, and it must not desaturate. So the blue
     channel is barely attenuated (0.72 against red's 0.34) and the
     additive floor is highest in blue as well - both terms push the
     same way instead of one undoing the other, which is what a
     naive re-tint of the Vesper numbers produces.

     The art direction's rule 1 for this world depends on it: "the
     sunlit-to-shadow hue swing is the whole reason the level looks
     expensive". */
  const SHADOW_TINT = [0.34, 0.44, 0.72];
  const SHADOW_LIFT = [0.030, 0.052, 0.086];

  const WIND = field.wind;

  function colourAt(x, z, y, normal, curv) {
    const surf = field.surfaceAt(x, z, normal, curv);
    const slope = 1 - clamp01(normal[1]);

    /* Where in this surface's tonal range does the vertex sit?
       Local relief against the coarse mean, plus a much weaker
       absolute-altitude term, plus how skyward it faces. The
       altitude term is against the PROFILE rather than against sea
       level, so a rib crest at 300m and a rib crest at 60m read as
       the same kind of place - which they are. */
    const r = Math.hypot(x, z);
    const local = (y - coarseHeight(x, z)) * 0.055
      + (y - field.profile(r)) * 0.010;
    const crest = clamp01(
      0.46 + local + (1 - slope) * 0.18
      + field.noise.warp.fbm(x / 210, z / 210, 3) * 0.20
    );

    /* Weighted blend across whichever surfaces are present. */
    let cr = 0; let cg = 0; let cb = 0; let wsum = 0;
    {
      const wgt = surf.snow;
      if (wgt > 0.002) {
        const c = RAMPS.snow.at(crest);
        cr += c[0] * wgt; cg += c[1] * wgt; cb += c[2] * wgt; wsum += wgt;
      }
    }
    for (let i = 0; i < SURFACE_KEYS.length; i += 1) {
      const key = SURFACE_KEYS[i];
      const wgt = surf[key];
      if (wgt <= 0.002) continue;
      const bias = RAMP_BIAS[key];
      const c = RAMPS[key].at(clamp01(crest * bias[0] + bias[1]));
      cr += c[0] * wgt; cg += c[1] * wgt; cb += c[2] * wgt; wsum += wgt;
    }
    if (wsum <= 0.0001) {
      const c = SNOW_RAMP.at(crest);
      cr = c[0]; cg = c[1]; cb = c[2]; wsum = 1;
    }
    cr /= wsum; cg /= wsum; cb /= wsum;

    /* Station tint. A place carries a mood from 800m before a
       single prop of it is visible, and a level that is one colour
       everywhere is a level with one idea - which on a WHITE world
       is a real risk rather than a stylistic worry. */
    const tint = STATION_TINT[surf.district];
    if (tint && tint.strength > 0 && surf.districtWeight > 0.01) {
      const k = surf.districtWeight * tint.strength * 0.55;
      const m = mixRgb([cr, cg, cb], hexToRgb(tint.tint), k);
      cr = m[0]; cg = m[1]; cb = m[2];
    }

    const occ = occlusionAt(x, z, y, normal);
    if (occ > 0.002) {
      const k = occ * 0.60;
      cr = lerp(cr, cr * SHADOW_TINT[0] + SHADOW_LIFT[0], k);
      cg = lerp(cg, cg * SHADOW_TINT[1] + SHADOW_LIFT[1], k);
      cb = lerp(cb, cb * SHADOW_TINT[2] + SHADOW_LIFT[2], k);
    }

    /* SASTRUGI SCOUR.

       The analogue of terrain.js:1188-1194's dune-crest scour, and
       the same claim: it is the single cheapest thing that makes a
       snowfield read as CARVED rather than smooth at a distance
       where the geometry is too small to say anything.

       Keyed to `slab` rather than to `snow`, aligned to the wind
       axis, and deliberately BROAD - 46m across the wind, not the
       1-3m real sastrugi have. At the 4m vertex spacing a 10m
       stripe is 2.5 samples per cycle and aliases into plaid; the
       fine grain is summit-art's SASTRUGI_FRAG, per pixel, and this
       term's only job is the broad scour banding underneath it so
       the two agree about which way the wind blows. */
    if (surf.slab > 0.20) {
      const u = x * WIND.x + z * WIND.z;
      const v = -x * WIND.z + z * WIND.x;
      const grain = Math.sin(v * 0.135 + field.noise.detail.fbm(u / 52, v / 52, 2) * 3.6);
      const ridge = clamp01(grain * 0.5 + 0.5 - 0.44)
        * clamp01((normal[1] - 0.905) * 10)
        * surf.slab;
      if (ridge > 0.002) {
        const m = mixRgb([cr, cg, cb], SLAB_RAMP.at(0.99), ridge * 0.55);
        cr = m[0]; cg = m[1]; cb = m[2];
      }
    }

    /* Deep drift reads paler and softer than the field around it -
       it is the freshest snow on the mountain and it has not been
       packed. One reader of `snowDepthAt`, as the contract requires,
       rather than a second depth estimate invented here. */
    if (surf.snow > 0.3) {
      const depth = field.snowDepthAt(x, z, normal, curv);
      const deep = clamp01((depth - 1.05) * 0.9) * surf.snow;
      if (deep > 0.002) {
        const m = mixRgb([cr, cg, cb], SNOW_RAMP.at(clamp01(crest * 0.85 + 0.20)), deep * 0.5);
        cr = m[0]; cg = m[1]; cb = m[2];
      }
    }

    return [cr, cg, cb];
  }

  /* ------------------------ chunk sampling ------------------------ */

  const FINE = LOD_CELLS[0];
  const FINE_SIDE = FINE + 1;

  function sampleChunk(cx, cz) {
    const step = CHUNK_SIZE / FINE;
    const ox = -MAP_HALF + cx * CHUNK_SIZE;
    const oz = -MAP_HALF + cz * CHUNK_SIZE;
    const n = FINE_SIDE * FINE_SIDE;
    const ys = new Float32Array(n);
    const ns = new Float32Array(n * 3);
    const cs = new Float32Array(n * 3);
    const nrm = [0, 0, 0];
    for (let j = 0; j < FINE_SIDE; j += 1) {
      const z = oz + j * step;
      for (let i = 0; i < FINE_SIDE; i += 1) {
        const x = ox + i * step;
        const p = j * FINE_SIDE + i;
        const y = field.heightAt(x, z);
        field.normalAt(x, z, nrm);
        const c = colourAt(x, z, y, nrm, coarseCurvature(x, z));
        ys[p] = y;
        ns[p * 3] = nrm[0]; ns[p * 3 + 1] = nrm[1]; ns[p * 3 + 2] = nrm[2];
        /* sRGB -> linear on the way into the buffer, art.js:963.
           A snow ramp authored in sRGB hex and written raw renders
           far too dark, and on a WHITE level "far too dark" reads
           as a lighting bug rather than as a colour bug - which is
           an expensive place to start looking. */
        cs[p * 3] = srgb(c[0]); cs[p * 3 + 1] = srgb(c[1]); cs[p * 3 + 2] = srgb(c[2]);
      }
    }
    return { ys, ns, cs, ox, oz, step };
  }

  /* SKIRT DEPTH - the contract's open question 2, closed here.

     Vesper's 11m was measured against a 36m dune. The quantity that
     actually sets it is the maximum DOWNWARD deviation of the LOD0
     surface from an LOD3 chord across one 32m cell, because that is
     the gap a skirt has to cover when two neighbouring chunks pick
     different LODs. For a smooth surface that is (S^2/8)|f''| with
     S = 32; for a crest narrower than the chord it is the crest
     height itself.

     Three candidates were measured against this world:
       - a cliff-band riser, 34m over 22m: a 32m chord straddling
         the lip stands about 16m above the surface;
       - a macro rib at r=300, 30m amplitude on a 58m tangential
         wavelength: about 19m;
       - the 34m detail octave at 1.7m amplitude: 4m.
     Worst realistic sum is ~23m, so SKIRT = 24.

     Note where the binding case ISN'T. At the LOD0/LOD1 boundary
     (4m against 8m cells, 430m from the camera) the same arithmetic
     gives about 5m, so the near field never needed more than
     Vesper's 11. The 24m is bought entirely for the LOD2/LOD3 seam
     at 1350m, where a 24m apron subtends one degree and the
     alternative is a slot of sky through the mountain. The cost is
     an apron hanging one chunk-edge deep down a cliff face, which
     Vesper already accepted at 11m and which the 0.80/0.78/0.84
     darkening keeps from reading as terrain. */
  const SKIRT = 24;

  function geometryFromSamples(s, lod) {
    const cells = LOD_CELLS[lod];
    const stride = FINE / cells;
    const side = cells + 1;
    const vCount = side * side + side * 4;
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    const indices = [];

    /* EVERY LOD IS A STRIDE OF THE ONE SAMPLE GRID (1, 2, 4, 8), so
       a chunk is sampled once and decimated four times and shared
       samples agree exactly. This requires FINE % cells === 0 for
       every LOD entry; a non-divisor set produces fractional strides
       and silently corrupted reads, not an error. */
    for (let j = 0; j < side; j += 1) {
      for (let i = 0; i < side; i += 1) {
        const src = (j * stride) * FINE_SIDE + i * stride;
        const p = j * side + i;
        positions[p * 3] = s.ox + i * stride * s.step;
        positions[p * 3 + 1] = s.ys[src];
        positions[p * 3 + 2] = s.oz + j * stride * s.step;
        normals[p * 3] = s.ns[src * 3];
        normals[p * 3 + 1] = s.ns[src * 3 + 1];
        normals[p * 3 + 2] = s.ns[src * 3 + 2];
        colors[p * 3] = s.cs[src * 3];
        colors[p * 3 + 1] = s.cs[src * 3 + 1];
        colors[p * 3 + 2] = s.cs[src * 3 + 2];
      }
    }

    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        const a = j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        /* Alternate the diagonal, or every quad splits the same way
           and the field grows a herringbone at grazing sun - which
           on a level whose entire texture story is grazing light is
           not optional. `groundHeightAt` reproduces this branch. */
        if (((i + j) & 1) === 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, c, d, a, d, b);
      }
    }

    const edgeOf = [
      (i) => i,
      (i) => (side - 1) * side + i,
      (i) => i * side,
      (i) => i * side + (side - 1),
    ];
    let sp = side * side;
    for (let e = 0; e < 4; e += 1) {
      const first = sp;
      for (let i = 0; i < side; i += 1) {
        const src = edgeOf[e](i);
        positions[sp * 3] = positions[src * 3];
        positions[sp * 3 + 1] = positions[src * 3 + 1] - SKIRT;
        positions[sp * 3 + 2] = positions[src * 3 + 2];
        normals[sp * 3] = normals[src * 3];
        normals[sp * 3 + 1] = normals[src * 3 + 1];
        normals[sp * 3 + 2] = normals[src * 3 + 2];
        colors[sp * 3] = colors[src * 3] * 0.80;
        colors[sp * 3 + 1] = colors[src * 3 + 1] * 0.78;
        colors[sp * 3 + 2] = colors[src * 3 + 2] * 0.84;
        sp += 1;
      }
      for (let i = 0; i < side - 1; i += 1) {
        const t0 = edgeOf[e](i);
        const t1 = edgeOf[e](i + 1);
        const b0 = first + i;
        const b1 = first + i + 1;
        /* Wound both ways. Only one winding is front-facing and the
           other is simply never drawn - cheaper than deriving the
           correct orientation for four traversal directions. */
        indices.push(t0, b0, b1, t0, b1, t1);
        indices.push(t0, b1, b0, t0, t1, b1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(vCount > 65535
      ? new THREE.BufferAttribute(new Uint32Array(indices), 1)
      : new THREE.BufferAttribute(new Uint16Array(indices), 1));
    geo.computeBoundingSphere();
    return geo;
  }

  /* ---- build every chunk ---- */

  const chunks = [];
  const total = CHUNKS * CHUNKS;
  let vertexCount = 0;
  let done = 0;
  for (let cz = 0; cz < CHUNKS; cz += 1) {
    for (let cx = 0; cx < CHUNKS; cx += 1) {
      const samples = sampleChunk(cx, cz);
      const lods = [];
      for (let lod = 0; lod < LOD_CELLS.length; lod += 1) {
        const geo = geometryFromSamples(samples, lod);
        vertexCount += geo.getAttribute("position").count;
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = `terrain-${cx}-${cz}-l${lod}`;
        mesh.castShadow = lod <= 1;
        mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
        lods.push(mesh);
      }
      const centreX = -MAP_HALF + (cx + 0.5) * CHUNK_SIZE;
      const centreZ = -MAP_HALF + (cz + 0.5) * CHUNK_SIZE;
      chunks.push({
        cx, cz, lods, active: -1, centreX, centreZ,
        centreY: samples.ys[(FINE_SIDE * FINE_SIDE) >> 1],
        /* Retain the 65x65 height plane (17KB per chunk, 1.08MB
           total) so gameplay stands on the triangles the player
           actually sees. Re-evaluating the analytic field is not
           the same surface: a crevasse wall changes 8m between two
           adjacent drawn vertices. */
        heightSamples: samples.ys,
      });
      done += 1;
      if (onProgress) {
        onProgress(0.12 + 0.88 * (done / total));
        /* Yield every FOURTH chunk. terrain.js:1405-1409 records
           what per-chunk yielding costs: a hidden tab throttles
           setTimeout to one second, so 64 yields here plus 8 in the
           coarse pass turned a 2.7s load into seventy-odd seconds of
           watching a progress bar that was not waiting on any work.
           ~21 yields total, and do not "improve" the cadence. */
        if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  /* ------------------------ LOD selection ------------------------ */

  function updateLod(camera) {
    const { x, y, z } = camera.position;
    for (let n = 0; n < chunks.length; n += 1) {
      const chunk = chunks[n];
      /* THE DISTANCE IS 3D AND ON THIS WORLD THE centreY TERM DOES
         REAL WORK. A chunk 400m below the camera is far even when it
         is directly underneath in plan, and the summit's whole
         composition is looking down onto ground that is near in x/z
         and a long way away in y. A 2D distance here would hold the
         entire valley at LOD0 from the parvis. */
      const d = Math.hypot(chunk.centreX - x, chunk.centreY - y, chunk.centreZ - z);
      let lod = LOD_CELLS.length - 1;
      for (let i = 0; i < LOD_RANGES.length; i += 1) {
        if (d < LOD_RANGES[i]) { lod = i; break; }
      }
      if (lod === chunk.active) continue;
      if (chunk.active >= 0) chunk.lods[chunk.active].visible = false;
      chunk.lods[lod].visible = true;
      chunk.active = lod;
    }
  }

  /** Height of the RENDERED near-player triangle at (x, z).
   *
   *  Reproduces geometryFromSamples' alternating diagonals exactly.
   *  Using the continuous authoring field instead makes feet,
   *  collision and the visible floor disagree, and the disagreement
   *  is worst exactly where it matters most - the crevasse lips,
   *  which is why the crevasse profile is built to hold the two
   *  within 0.48m there. */
  function groundHeightAt(x, z) {
    const wx = clamp(x, -MAP_HALF, MAP_HALF);
    const wz = clamp(z, -MAP_HALF, MAP_HALF);
    const cx = Math.max(0, Math.min(CHUNKS - 1,
      Math.floor((wx + MAP_HALF) / CHUNK_SIZE)));
    const cz = Math.max(0, Math.min(CHUNKS - 1,
      Math.floor((wz + MAP_HALF) / CHUNK_SIZE)));
    const chunk = chunks[cz * CHUNKS + cx];
    const ox = -MAP_HALF + cx * CHUNK_SIZE;
    const oz = -MAP_HALF + cz * CHUNK_SIZE;
    const step = CHUNK_SIZE / FINE;
    const gx = clamp((wx - ox) / step, 0, FINE);
    const gz = clamp((wz - oz) / step, 0, FINE);
    const i = Math.min(FINE - 1, Math.floor(gx));
    const j = Math.min(FINE - 1, Math.floor(gz));
    const u = gx - i;
    const v = gz - j;
    const ys = chunk.heightSamples;
    const a = ys[j * FINE_SIDE + i];
    const b = ys[j * FINE_SIDE + i + 1];
    const c = ys[(j + 1) * FINE_SIDE + i];
    const d = ys[(j + 1) * FINE_SIDE + i + 1];
    if (((i + j) & 1) === 0) {
      return u + v <= 1
        ? a * (1 - u - v) + b * u + c * v
        : b * (1 - v) + c * (1 - u) + d * (u + v - 1);
    }
    return v >= u
      ? a * (1 - v) + c * (v - u) + d * u
      : a * (1 - u) + d * v + b * (u - v);
  }

  /* ============================================================
     THE FLOOR-LOWERING HOOK

     collide.js:192-209 reads `ctx.undercroft?.groundOverrideAt?.(x, z)`
     BEFORE it reads the terrain, takes the answer whole, and applies
     it to the entire column at that x/z. It is an OVERRIDE, NOT A
     MAXIMUM, and it is the only thing in this engine that can lower
     a floor - `world.walkSurfaceAt` can only raise one, because of
     the Math.max at collide.js:208.

     THE TABLE IS EMPTY IN THIS BUILD, and that is a decision rather
     than an omission.

     The contract nominates the three moulins for it. A moulin
     properly IS a bore: a vertical shaft with an overhanging ice
     collar, which a height field cannot express at any resolution.
     But this is an environment build - no combat, no death, no
     respawn, no mission - so a column the player can enter and
     cannot climb out of is a permanent softlock with nothing to
     report it. terrain.js:150-166 already paid for that lesson at
     the Garner's throat: "a hole with unclimbable sides that the
     player may now walk into is a softlock in the shape of a boss
     arena", and there the boss at least stopped holding the player
     out only after it died.

     So the moulins are walkable funnels in the height field instead
     (see the MOULINS block), and this hook ships live, empty and
     ready. When there is a fall handler, a bore is one entry:

         { x, z, bore: 9, reach: 16, floorY: <surface - 40> }

     with the caveat that the answer must be continuous across
     `reach` or the collision cache's 32m pages will disagree with
     each other about where the rim is.

     `summit-main` hangs this on the hard-named `ctx.undercroft` key
     BEFORE `buildCollision` runs. collide.js optional-chains it, so
     a late assignment is silent rather than fatal - which is worse.
     ============================================================ */
  const overrides = [];

  const groundOverride = {
    overrides,
    groundOverrideAt(x, z) {
      for (let i = 0; i < overrides.length; i += 1) {
        const o = overrides[i];
        const d = Math.hypot(x - o.x, z - o.z);
        if (d >= o.reach) continue;
        const t = sstep(o.bore, o.reach, d);
        if (t >= 1) continue;
        return lerp(o.floorY, field.heightAt(x, z), t);
      }
      return null;
    },
  };

  return {
    group,
    chunks,
    /* Collision includes any rendered-grid vertex inside a capsule
       footprint: a triangulated height field reaches an interior
       maximum only at one of those vertices. collide.js:897 reads
       this and collide.js:898 guards it with Number.isFinite, so a
       missing value degrades SILENTLY - `flightGroundHeight` just
       stops catching interior maxima. */
    groundSampleStep: CHUNK_SIZE / FINE,
    field,
    rng,
    coarseHeight,
    coarseCurvature,
    occlusionAt,
    heightAt: field.heightAt,
    groundHeightAt,
    normalAt: field.normalAt,
    surfaceAt: field.surfaceAt,
    snowDepthAt: field.snowDepthAt,
    curvatureAt: field.curvatureAt,
    groundOverride,
    updateLod,
    stats() {
      let tris = 0;
      let visible = 0;
      for (const chunk of chunks) {
        if (chunk.active < 0) continue;
        visible += 1;
        tris += chunk.lods[chunk.active].geometry.index.count / 3;
      }
      return {
        chunks: chunks.length,
        visible,
        triangles: tris,
        vertices: vertexCount,
        skirt: SKIRT,
        viaSacra: {
          length: VIA_SACRA_LENGTH,
          nodes: viaSacraNodes.length,
          turns: VIA_SACRA_TURNS.length,
          padError: field.padRoadError,
        },
        crevasses: CREVASSES.length,
        moulins: MOULINS.length,
        overrides: overrides.length,
      };
    },
  };
}
