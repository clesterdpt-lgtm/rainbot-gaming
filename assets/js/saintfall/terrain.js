/* ============================================================
   SAINTFALL - terrain

   A 2048m square of Vesper-IX, built from one height function and
   drawn as an 8x8 grid of chunks with four LODs each.

   Design notes that matter more than the code:

   - The map is a BASIN. The rim climbs on all four sides, so from
     anywhere inside it you are looking at landscape rather than at
     the edge of a level. Nothing kills a large map faster than
     seeing where it stops.

   - Sand is smooth-shaded. The faceting that makes this read as
     low-poly comes from the rock meshes on top and from
     high-frequency ridge noise in the rocky districts, where the
     terrain genuinely changes direction every few metres. Flat-
     shading silk dunes would throw away the one surface that is
     supposed to be silk.

   - Normals are ANALYTIC, sampled from the height function rather
     than computed from the triangles. Two LODs of the same ground
     therefore light identically, so an LOD swap does not flash.

   - Districts are applied in a fixed order as `lerp(h, local, w)`
     with smooth weights. Later entries carve through earlier ones,
     which is why the roads and the trench come last: they have to
     cut whatever they cross.

   Performance shape, because it is not obvious and it bit once:
   every LOD's sample grid is a STRIDE of the finest one (65 -> 33
   -> 17 -> 9), so a chunk is sampled once and decimated three
   times rather than sampled four times. And the road/trench
   profiles are behind a spatial index - evaluated linearly they
   turned a 300k-vertex build into half a billion segment tests.
   ============================================================ */

import {
  clamp, clamp01, lerp, smoothstep, sstep, makeNoise2D, makeRng,
  sdSegment, hexToRgb, mixRgb, smin,
} from "saintfall/core.js";
import {
  SAND_RAMP, ROCK_RAMP, BASALT_RAMP, BONE_RAMP, ASH_RAMP, GLASS_RAMP, CHITIN_RAMP,
  srgbTransfer as srgb, DISTRICT_TINT,
} from "saintfall/art.js";

export const MAP_SIZE = 2048;
export const MAP_HALF = MAP_SIZE / 2;
export const CHUNKS = 8;
export const CHUNK_SIZE = MAP_SIZE / CHUNKS;          // 256m
export const LOD_CELLS = [64, 32, 16, 8];             // 4m, 8m, 16m, 32m
export const LOD_RANGES = [430, 780, 1350, Infinity];

/* ============================================================
   DISTRICTS
   The level's floor plan. Every other module reads these, so the
   Cathedral's plaza and the Cathedral's terrain can never end up
   in different places.
   ============================================================ */

export const DISTRICTS = {
  threshold: { x: 0, z: 830, r: 340, name: "The Threshold" },
  reach: { x: -600, z: 545, r: 460, name: "The Gilded Reach" },
  saint: { x: 0, z: -20, r: 350, name: "The Fallen Saint" },
  cathedral: { x: -95, z: -725, r: 330, name: "Vault-Cathedral" },
  ossuary: { x: 645, z: -640, r: 340, name: "The Ossuary" },
  scar: { x: 790, z: 95, r: 320, name: "The Glass Scar" },
  censer: { x: 655, z: 700, r: 300, name: "The Censer Works" },
  choir: { x: -820, z: -95, r: 320, name: "The Choir Spires" },
  bloom: { x: -655, z: -655, r: 310, name: "The Bloom" },
};

/* ============================================================
   THE GARNER'S PIT

   A funnel in the Ossuary pan, and it is CARVED INTO THE TERRAIN
   rather than built on top of it.

   That is the whole reason it is declared here, next to the districts,
   instead of inside garner.js with the rest of the encounter. The
   collision grid, the walking plane and the visible ground all come out
   of `heightAt`; nothing added at runtime reaches any of them. A pit
   built as scene geometry is therefore a picture of a hole that the
   player walks straight across - and this creature's entire read is
   that its mouth is BELOW the desert and you have to go down to it.

   Sized against a 4m sample grid. A sharp-edged shaft would alias into
   a lumpy dent at that resolution; a broad, gentle sand funnel is both
   what the resolution can express and what the thing actually is. The
   shaft itself, which does need hard edges, is scene geometry inside
   the mouth where the collar occludes the join.

   `floor` is where the player stands to fight it: real ground, nine
   metres under the pan, with the mouth set into the middle of it.

   AND IT IS NOT ALWAYS THERE. Everything above is about the SHAPE; the
   pit's other half is that the shape has an amplitude, `garnerReveal`,
   which is zero until the player walks into the Ossuary. A funnel
   permanently sunk into the pan announced the encounter from the far
   side of the district and spent the surprise before the player was
   near enough to be in it - the whole read of this animal is that you
   are standing on flat ground and then you are not.

   That works because a height field is CHEAP TO RE-EVALUATE LOCALLY.
   Nothing else in `heightAt` moves, so the pit's samples are the only
   ones that have to be rewritten, and both ends of their travel - the
   unbroken pan and the finished funnel - can be measured once at load
   and lerped between. See `pitPatch` at the bottom of this file. */
export const GARNER_PIT = Object.freeze({
  /* A hundred and eight metres out from the ribcage's spine, square to
     it - see the axis in world.js. Dead centre put a fifty-metre pit
     among rib bases up to 78m tall and 50m across, which blocked every
     shot and swallowed the silhouette. Out here the pan is flat and
     unbroken to 150m and the ribcage is a backdrop instead of a set. */
  x: DISTRICTS.ossuary.x + Math.sin(0.62) * 108,
  z: DISTRICTS.ossuary.z + Math.cos(0.62) * 108,
  depth: 12.0,
  /* A FLAT FLOOR at the bottom, and it is a gameplay surface rather
     than a shape: it is the ring of ground the player stands on to
     fight the mouth, and a floor that kept sloping would slide them
     into it while they were swinging. */
  floorRadius: 13,
  /* Where the funnel meets untouched pan. The slope between is about
     twenty degrees - a walk down, not a fall. */
  rimRadius: 36,
  /* Spoil thrown out of the hole. Low enough to walk over, high enough
     that the pit reads from the far side of the pan as something with
     an edge rather than as a shadow on flat ground. */
  lipHeight: 1.7,

  /* ------------------------------------------------------------
     THE THROAT, and it is the reason the mouth can sit LEVEL with the
     floor instead of standing on it.

     The first build stood the collar five metres proud of the funnel's
     floor, and the arithmetic forced it to: a height field has no hole
     in it at any radius, so sand runs straight across the inside of a
     mouth that is flush with the ground, and the only way to see any
     throat at all was to lift the whole animal above the surface it
     was set into. That is a beak on a plinth. Every note in garner.js
     about "a mouth standing on the desert is a tower" was fighting a
     symptom of this one missing eight metres.

     Now that the pit is re-evaluated anyway, the bore can simply be
     cut - so the collar's lip comes down to `mawStand`, a hand's
     width, and the depth the player looks into is terrain rather than
     a pedestal.

     THREE CONSTRAINTS FIX THESE THREE NUMBERS, and every one of them
     bites.

     DEPTH is bounded below by the black shelf inside the mouth: the
     sand has to stay clear of it at every radius the collar's chewed
     wall reaches, or a plate laid to hide the ground has ground on top
     of it. Five metres leaves about 1.7m of margin at the worst radius
     once the 4m sample grid has smoothed the rim.

     `throatOuter` is bounded above by garner.js's `keepOutScale`: the
     animal holds the player 9.59m from its axis, so the bore has to be
     back at floor grade by then or the fight is conducted on a slope.

     AND THE SPAN IS BOUNDED BELOW BY THE PLAYER'S SLOPE GATE, which is
     the one that is easy to miss. player.js walks anything under a
     sustained 1.7 rise over run and nothing above it, and a smoothstep
     of depth D across a span S peaks at 1.5D/S - so the first pass, 8m
     across 5.3m, had a 2.26 wall. The mouth holds the player out of the
     bore during the fight so nothing noticed; the moment the animal is
     DEAD it stops holding them, and a hole with unclimbable sides that
     the player may now walk into is a softlock in the shape of a boss
     arena. 5m across 6.2m peaks at 1.21, and the steepest pair of
     samples the mesh actually draws comes out at 1.12. */
  throatDepth: 5.0,
  throatInner: 4.2,
  throatOuter: 10.4,

  /* Where the pit's influence ends. Everything outside is untouched
     pan, which is what makes the live patch a small set of samples
     rather than a chunk rebuild. */
  reach: 62,
});

/* HOW MUCH OF THE PIT EXISTS RIGHT NOW. 0 is unbroken pan, 1 is the
   finished funnel with the bore in the middle of it.

   Module state rather than a parameter because `heightAt` is called
   from the mesh builder, the collision grid, the foot IK and half a
   dozen gameplay modules, and none of them should have to learn that
   one district's boss is mid-collapse. garner.js owns the value; see
   `terrain.setGarnerPitReveal`. */
let garnerReveal = 0;

export function garnerPitReveal() { return garnerReveal; }

/**
 * The pit's own displacement at radius `r`, in metres, at full reveal.
 *
 * Exported because garner.js needs two answers this function gives and
 * `heightAt` cannot: where the FINISHED funnel's floor is while the pan
 * is still shut (so the animal can be built against ground that does
 * not exist yet), and the same thing without the throat, which is the
 * surface the player fights from rather than the hole in the middle of
 * it.
 */
export function garnerPitProfile(r, withThroat = true) {
  const g = GARNER_PIT;
  if (r >= g.reach) return 0;
  /* The same bowl-plus-rim shape the Glass Scar uses, at a twentieth
     of the size and run all the way to the middle. */
  const bowl = -g.depth * (1 - sstep(g.floorRadius, g.rimRadius, r));
  const lip = g.lipHeight
    * Math.exp(-((r - (g.rimRadius + 5)) ** 2) / (2 * 8 * 8));
  /* Terraces down the funnel wall - the same trick the Glass Scar uses
     on its own bowl. A cone of sand this smooth reads as a dish however
     deep it is; strata give the eye something to measure the descent
     against, and at 4m sample spacing they are the only surface detail
     the grid can express. */
  const terrace = Math.sin(r * 0.42) * 0.85
    * (1 - sstep(g.floorRadius, g.rimRadius + 6, r))
    * sstep(g.floorRadius - 6, g.floorRadius + 2, r);
  const throat = withThroat
    ? -g.throatDepth * (1 - sstep(g.throatInner, g.throatOuter, r))
    : 0;
  return bowl + lip + terrace + throat;
}

/** The processional causeway, south gate to cathedral steps. */
export const ROAD_PATH = [
  [24, 962], [16, 880], [8, 742], [2, 596], [-4, 448], [-8, 300],
  [-14, 168], [-24, 40], [-38, -96], [-52, -238], [-66, -382],
  [-78, -520], [-88, -640], [-95, -706],
];

/**
 * A point on the Pilgrim's Road at a given northing, and the way the
 * road runs there.
 *
 * Spawn points used to be written as plain coordinates, and both of
 * them missed: the drop stood at x -12 where the causeway is at x
 * +15.7, on the shoulder above it, and the respawn at x 0 where the
 * road is at x +12.2. Derived from ROAD_PATH instead, so they land on
 * the road by construction and stay on it if the road ever moves.
 *
 * `yaw` runs toward the cathedral - decreasing z - which is the way
 * the causeway is walked and the direction the drop should face.
 */
export function roadPointAtZ(z) {
  for (let i = 0; i < ROAD_PATH.length - 1; i += 1) {
    const [ax, az] = ROAD_PATH[i];
    const [bx, bz] = ROAD_PATH[i + 1];
    if ((z <= az && z >= bz) || (z >= az && z <= bz)) {
      const span = bz - az;
      const t = Math.abs(span) < 1e-6 ? 0 : (z - az) / span;
      return { x: ax + (bx - ax) * t, z, yaw: Math.atan2(bx - ax, bz - az) };
    }
  }
  // Beyond either end: hold the terminus rather than extrapolate off
  // the map.
  const head = z > ROAD_PATH[0][1];
  const i = head ? 0 : ROAD_PATH.length - 2;
  const [ax, az] = ROAD_PATH[i];
  const [bx, bz] = ROAD_PATH[i + 1];
  return {
    x: head ? ax : bx,
    z: head ? az : bz,
    yaw: Math.atan2(bx - ax, bz - az),
  };
}

/* One authoritative landfall. The player stands on the causeway while
   the pod sits just off its west shoulder with the hatch facing the
   road. Keeping this derived from ROAD_PATH means the cinematic, the
   static wreck and the playable spawn cannot drift apart again. */
const DROP_ROAD = roadPointAtZ(DISTRICTS.threshold.z + 44);
/* The pod stands further off the causeway than a parked lander
   would, for two reasons that happen to agree: an impact crater
   needs room that does not overlap authored paving, and the walk
   out of the hole and up onto the road is the last beat of the
   cinematic - at 11.5m it was three strides. */
const POD_OFFSET_X = -16.5;
const POD_OFFSET_Z = 2.0;
export const DROP_SITE = Object.freeze({
  x: DROP_ROAD.x,
  z: DROP_ROAD.z,
  yaw: DROP_ROAD.yaw,
  podX: DROP_ROAD.x + POD_OFFSET_X,
  podZ: DROP_ROAD.z + POD_OFFSET_Z,
  /* Aimed at the spawn mark rather than at a cardinal direction.
     The gangway is the path the player actually walks, so the hatch
     has to face the causeway however the road happens to run here -
     a hardcoded -90 degrees put the ramp 8 degrees off the walk and
     the trooper stepped off its edge. */
  podYaw: Math.atan2(-POD_OFFSET_X, -POD_OFFSET_Z),
  /** Metres from the hatch mouth to the playable spawn mark. */
  egressRun: Math.hypot(POD_OFFSET_X, POD_OFFSET_Z),
});

/* ============================================================
   THE IMPACT CRATER

   The lander has no gear and no retros. It arrives at terminal
   velocity and buries its prow, so the hole is not decoration -
   it is where the pod IS, and the player has to walk out of it.

   That makes it TERRAIN, not a prop laid on terrain. Composed into
   `heightAt` below, the terrain mesh, the collision grid, the foot
   IK and `player.spawn` all agree about it for free; built as a
   mesh instead, every one of those four would have had to be told
   about it separately and three of them would have been wrong.

   Two numbers are load-bearing.

   OUTER has to clear the causeway: the road's west edge is 11.9m
   from the pod's axis (half-width 4.6 against a 16.5m offset), and
   terrain raised past that pushes up through authored paving that
   sits only 22cm proud of the sand.

   BOWL has to be wide enough for the terrain MESH to carry it.
   LOD0 cells are 4m, so a 4m-radius dish is a feature smaller than
   one quad: the field dips, the drawn ground does not, and the pod
   sits in an invisible hole on visibly flat sand. A 7m bowl spans
   three or four cells and reads as the faceted funnel this game's
   surface language wants anyway.
   ============================================================ */
export const DROP_CRATER = Object.freeze({
  bowl: 7.0,      // radius at which the dish returns to grade
  depth: 2.45,    // how far the prow drove the floor down
  lip: 0.52,      // ejecta rampart, peak height
  outer: 11.0,    // everything is back to grade here - clear of the road
});

/** Crater displacement at radius `r` from the pod's axis, in metres. */
export function craterProfile(r) {
  const { bowl, depth, lip, outer } = DROP_CRATER;
  if (r >= outer) return 0;
  if (r <= bowl) return -depth * (0.5 + 0.5 * Math.cos(Math.PI * r / bowl));
  return lip * Math.sin(Math.PI * (r - bowl) / (outer - bowl));
}

/** The old war trench, cut across the map's waist. */
export const FOSSE_PATH = [
  [-980, 232], [-772, 286], [-560, 330], [-352, 358], [-150, 392],
  [64, 428], [268, 470], [452, 528], [618, 604], [742, 690], [846, 792],
];

/** A trench spur that dives toward the Scar. */
export const FOSSE_SPUR = [
  [268, 470], [372, 386], [468, 300], [548, 214], [610, 150],
];

/**
 * Where each district's own ground material actually reaches, as
 * fractions of the district radius. Independent of the naming
 * radius on purpose: the Scar's glass belongs inside its crater
 * and nowhere else, while the Censer Works' ash spreads downwind
 * across the whole terrace.
 */
const SURFACE_ZONES = {
  ossuary: { key: "bone", in: 0.42, out: 0.96, w: 0.95 },
  scar: { key: "glass", in: 0.28, out: 0.68, w: 0.97 },
  censer: { key: "ash", in: 0.50, out: 1.05, w: 0.93 },
  bloom: { key: "chitin", in: 0.34, out: 0.92, w: 0.88 },
  choir: { key: "rock", in: 0.38, out: 0.98, w: 0.86 },
  cathedral: { key: "basalt", in: 0.30, out: 0.78, w: 0.66 },
};

/* ============================================================
   HEIGHT FIELD
   ============================================================ */

export function makeHeightField(seed = 0x5a1f7) {
  const nBroad = makeNoise2D(seed + 1);
  const nDune = makeNoise2D(seed + 2);
  const nRock = makeNoise2D(seed + 3);
  const nDetail = makeNoise2D(seed + 4);

  /* Wind axis. Dunes, ribbons and the sand VFX all use this, so the
     whole map reads as having one prevailing wind. */
  const WIND = 128 * Math.PI / 180;
  const cw = Math.cos(WIND);
  const sw = Math.sin(WIND);

  /* ------------------------- dune train ------------------------- */

  /**
   * Barchan-ish dunes: long meandering ridge lines perpendicular to
   * the wind, with a gentle windward slope and a steep slip face.
   * A symmetric sine wave here reads as corrugated cardboard - the
   * asymmetry is the entire difference between "dunes" and
   * "ripples".
   */
  function duneTrain(x, z, spacing, amp, meander, phaseOff = 0) {
    const u = (x * cw + z * sw) / spacing;
    const v = (-x * sw + z * cw) / spacing;
    const wobble = nDune.fbm(v * 0.22, u * 0.06, 3) * meander;
    const phase = u + wobble + phaseOff;
    const t = phase - Math.floor(phase);
    // Windward face 0..0.70 rises gently; the slip face collapses in
    // the remaining 30% at close to the angle of repose. Widening
    // that ratio is what separates "dunes" from "rolling hills".
    const prof = t < 0.70
      ? smoothstep(t / 0.70)
      : 1 - Math.pow(clamp01((t - 0.70) / 0.30), 0.55);
    const mod = 0.42 + 0.58 * clamp01(nDune.fbm(x / 620, z / 620, 3) * 0.5 + 0.62);
    return prof * amp * mod;
  }

  /* ------------------------- base field ------------------------- */

  /** The broad landform with no dune train on it. Districts that
   *  need a legible, authored shape - a vantage point, a plaza
   *  approach - blend toward this so a 22m dune cannot happen to
   *  stand in front of the thing the player is meant to see. */
  function smoothBase(x, z) {
    let h = nBroad.warped(x / 1150, z / 1150, 1.5, 4) * 46;
    h += nBroad.fbm(x / 430, z / 430, 4) * 15;
    return h;
  }

  function baseHeight(x, z) {
    let h = smoothBase(x, z);
    h += duneTrain(x, z, 168, 22.5, 1.35, 0);
    h += duneTrain(x, z, 74, 8.4, 2.1, 0.37);
    h += duneTrain(x, z, 27, 2.1, 3.0, 0.81);
    h += nDetail.fbm(x / 9.5, z / 9.5, 2) * 0.55;
    return h;
  }

  /* --------------------------- the rim --------------------------- */

  /**
   * The bowl. Rises on a rounded-square distance so the playable
   * area stays nearly the full square instead of a circle inscribed
   * in it - a circular playfield inside a square map wastes the
   * corners, and the corners are where the quiet districts live.
   */
  const RIM_P = 6;
  function rimDist(x, z) {
    return Math.pow(
      Math.pow(Math.abs(x) / MAP_HALF, RIM_P) + Math.pow(Math.abs(z) / MAP_HALF, RIM_P),
      1 / RIM_P
    );
  }
  function rimHeight(x, z) {
    const t = sstep(0.845, 1.16, rimDist(x, z));
    if (t <= 0) return 0;
    const crag = nRock.ridged(x / 105, z / 105, 5) * 46
      + nRock.ridged(x / 33, z / 33, 4) * 15;
    return t * t * (168 + crag);
  }

  /* ----------------------- path profiles ----------------------- */

  /**
   * A road that follows the terrain inherits every dune it crosses
   * and rides like a rollercoaster. Sample the raw ground under the
   * path once, smooth that curve hard, and drive the cut from the
   * smoothed version.
   */
  function buildPathProfile(path, samples, smoothPasses) {
    const pts = [];
    for (let i = 0; i < samples; i += 1) {
      const t = i / (samples - 1);
      const seg = t * (path.length - 1);
      const k = Math.min(path.length - 2, Math.floor(seg));
      const f = seg - k;
      pts.push({
        x: lerp(path[k][0], path[k + 1][0], f),
        z: lerp(path[k][1], path[k + 1][1], f),
        y: 0,
      });
    }
    for (const p of pts) p.y = baseHeight(p.x, p.z) + rimHeight(p.x, p.z);
    for (let pass = 0; pass < smoothPasses; pass += 1) {
      const copy = pts.map((p) => p.y);
      for (let i = 1; i < pts.length - 1; i += 1) {
        pts[i].y = (copy[i - 1] + copy[i] * 2 + copy[i + 1]) * 0.25;
      }
    }
    return pts;
  }

  /**
   * Spatial index over a profile's segments. Without this, every
   * one of ~300k terrain vertices tested all 500-odd segments of
   * the three paths - a linear scan that dominated the entire
   * build. Bucketed, a query touches two or three segments.
   */
  function indexProfile(profile, reach) {
    const CELL = 64;
    const buckets = new Map();
    const key = (gx, gz) => gx * 8192 + gz;
    for (let i = 0; i < profile.length - 1; i += 1) {
      const a = profile[i];
      const b = profile[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / CELL);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / CELL);
      const z1 = Math.floor((Math.max(a.z, b.z) + reach) / CELL);
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gz = z0; gz <= z1; gz += 1) {
          const k = key(gx, gz);
          let list = buckets.get(k);
          if (!list) { list = []; buckets.set(k, list); }
          list.push(i);
        }
      }
    }
    return {
      profile,
      reach,
      query(x, z) {
        const list = buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!list) return null;
        let bestD = Infinity;
        let bestY = 0;
        let bestT = 0;
        for (let n = 0; n < list.length; n += 1) {
          const i = list[n];
          const a = profile[i];
          const b = profile[i + 1];
          const d = sdSegment(x, z, a.x, a.z, b.x, b.z);
          if (d < bestD) {
            bestD = d;
            const bax = b.x - a.x;
            const baz = b.z - a.z;
            const hh = clamp01(
              ((x - a.x) * bax + (z - a.z) * baz) / (bax * bax + baz * baz || 1e-6)
            );
            bestY = lerp(a.y, b.y, hh);
            bestT = (i + hh) / (profile.length - 1);
          }
        }
        return bestD > reach ? null : { d: bestD, y: bestY, t: bestT };
      },
    };
  }

  const roadProfile = buildPathProfile(ROAD_PATH, 240, 30);
  const fosseProfile = buildPathProfile(FOSSE_PATH, 220, 20);
  const spurProfile = buildPathProfile(FOSSE_SPUR, 100, 16);
  const roadIndex = indexProfile(roadProfile, 48);
  const fosseIndex = indexProfile(fosseProfile, 46);
  const spurIndex = indexProfile(spurProfile, 36);

  /* ------------------ resolved flattening targets ------------------
     These must be computed once from the raw ground. If the target
     were derived inside heightAt it would move every time heightAt
     was evaluated, and the plaza would never actually be level. */

  const cathedralPlazaY = (() => {
    const d = DISTRICTS.cathedral;
    let sum = 0;
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      sum += baseHeight(d.x + Math.cos(a) * 150, d.z + Math.sin(a) * 150)
        + rimHeight(d.x + Math.cos(a) * 150, d.z + Math.sin(a) * 150) + 52;
    }
    return sum / 24 + 6;
  })();

  const censerUpperY = (() => {
    const d = DISTRICTS.censer;
    return baseHeight(d.x, d.z) + rimHeight(d.x, d.z) + 9;
  })();
  const censerLowerY = censerUpperY - 13.5;

  const thresholdPadY = (() => {
    const d = DISTRICTS.threshold;
    const dz = DROP_SITE.podZ - d.z;
    const ridge = Math.exp(-(dz * dz) / (2 * 132 * 132)) * 52;
    const saddle = Math.exp(-((DROP_SITE.podX + 10) ** 2) / (2 * 96 * 96)) * -11;
    return smoothBase(DROP_SITE.podX, DROP_SITE.podZ)
      + rimHeight(DROP_SITE.podX, DROP_SITE.podZ) + ridge + saddle + 1.5;
  })();

  /* ------------------------ district weight ------------------------ */

  const w = (x, z, d, softness = 0.42) =>
    1 - sstep(1 - softness, 1.0, Math.hypot(x - d.x, z - d.z) / d.r);

  const pad = (h, target, x, z, cx, cz, r, feather) =>
    lerp(h, target, 1 - sstep(r, r + feather, Math.hypot(x - cx, z - cz)));

  const shapeReach = (h, x, z) => {
    const k = w(x, z, DISTRICTS.reach, 0.62);
    if (k <= 0.001) return h;
    const extra = duneTrain(x, z, 205, 26, 1.1, 0.21)
      + duneTrain(x, z, 96, 9.5, 1.7, 0.63);
    // Sand rivers: smooth troughs winding between the dune trains,
    // and the only easy walking line through the whole district.
    const river = Math.abs(nDune.fbm(x / 340, z / 340, 3));
    const carve = (1 - sstep(0.0, 0.10, river)) * 15;
    return lerp(h, h + extra - carve, k);
  };

  // The CONSTANT PENANCE is a rigid 18m wreck, not a cloth prop.
  // Let its weight form a small sand shelf instead of forcing one
  // wheel line to hover six metres above a steep dune while the
  // other disappears underground. The feather keeps the shelf part
  // of the surrounding dune rather than a visible circular pad.
  const crawlerPad = { x: DISTRICTS.reach.x - 210, z: DISTRICTS.reach.z + 148 };
  const crawlerPadY = shapeReach(
    baseHeight(crawlerPad.x, crawlerPad.z) + rimHeight(crawlerPad.x, crawlerPad.z),
    crawlerPad.x, crawlerPad.z
  );

  /* ============================================================
     The composed height. Order is deliberate: bulk landforms, then
     district shaping, then the cuts that must win over everything
     they cross.
     ============================================================ */

  function heightAt(x, z) {
    let h = baseHeight(x, z) + rimHeight(x, z);

    /* --- The Gilded Reach: dunes turned up, nothing else --------- */
    h = shapeReach(h, x, z);
    h = pad(h, crawlerPadY, x, z, crawlerPad.x, crawlerPad.z, 14, 18);

    /* --- The Threshold: the ridge you drop onto -----------------
       The one authored viewpoint on the map, so it is built on the
       SMOOTH landform with only the fine ripple left on top. Run
       over the full dune train, a 22m crest lands wherever the noise
       puts it, and half the time it stands directly between the
       drop pod and the entire rest of the level. A vantage point
       that only works by luck is not a vantage point. */
    {
      const d = DISTRICTS.threshold;
      const k = w(x, z, d, 0.75);
      if (k > 0.001) {
        const dz = z - d.z;
        // A long east-west ridge with a shallow saddle in the middle,
        // so the player crests it rather than walking around it.
        const ridge = Math.exp(-(dz * dz) / (2 * 132 * 132)) * 52;
        const saddle = Math.exp(-((x + 10) ** 2) / (2 * 96 * 96)) * -11;
        const clean = smoothBase(x, z) + rimHeight(x, z)
          + duneTrain(x, z, 74, 3.4, 2.1, 0.37)
          + nDetail.fbm(x / 9.5, z / 9.5, 2) * 0.55
          + ridge + saddle;
        h = lerp(h, clean, k * k);
        h = pad(h, thresholdPadY, x, z,
          DROP_SITE.podX, DROP_SITE.podZ, 20, 31);
      }
    }

    /* --- The Fallen Saint: an impact basin with an ejecta lip ---- */
    {
      const d = DISTRICTS.saint;
      const dist = Math.hypot(x - d.x, z - d.z);
      const k = w(x, z, d, 0.55);
      if (k > 0.001) {
        const bowl = -34 * (1 - sstep(0, 250, dist));
        const lip = 19 * Math.exp(-((dist - 268) ** 2) / (2 * 62 * 62));
        // Radial scour lines from the impact. Subtle, but they point
        // at the centre from every direction - free wayfinding.
        const ang = Math.atan2(z - d.z, x - d.x);
        const scour = Math.sin(ang * 11 + nBroad.fbm(x / 70, z / 70, 2) * 2.4)
          * 2.2 * (1 - sstep(120, 330, dist));
        h = lerp(h, h + bowl + lip + scour, k);
      }
    }

    /* --- Vault-Cathedral: a rock plateau with a level plaza ------ */
    {
      const d = DISTRICTS.cathedral;
      const dist = Math.hypot(x - d.x, z - d.z);
      const k = w(x, z, d, 0.5);
      if (k > 0.001) {
        const mesa = 52 * (1 - sstep(120, 300, dist));
        const crag = nRock.ridged(x / 52, z / 52, 4) * 11 * sstep(140, 260, dist);
        h = lerp(h, h + mesa + crag, k);
        // The plaza is dead level. Gothic architecture on a slope
        // reads as a mistake rather than as drama.
        h = pad(h, cathedralPlazaY, x, z, d.x, d.z, 132, 66);
      }
    }

    /* --- The Ossuary: a bone-white dry pan ---------------------- */
    {
      const d = DISTRICTS.ossuary;
      const dist = Math.hypot(x - d.x, z - d.z);
      const k = w(x, z, d, 0.62);
      if (k > 0.001) {
        // Flat, and flat on purpose: the only large flat surface on
        // the map, so the skeleton reads full length and the eye
        // gets somewhere to rest between dune fields.
        const panY = ossuaryPanY + nBroad.fbm(x / 260, z / 260, 2) * 3.2;
        const t = 1 - sstep(150, 330, dist);
        h = lerp(h, lerp(h, panY, t), k);
        const crackN = Math.abs(nDetail.fbm(x / 21, z / 21, 2));
        h -= (1 - sstep(0.0, 0.055, crackN)) * 0.85 * t * k;

        /* --- and the Garner's funnel sunk into it, as far as it has
               got. The shape is in `garnerPitProfile`; the only thing
               decided here is that it is scaled by how much of the
               collapse has happened, so a sealed pan costs one
               subtraction and a compare. --- */
        if (garnerReveal > 0.0005) {
          const g = GARNER_PIT;
          const gd = Math.hypot(x - g.x, z - g.z);
          if (gd < g.reach) h += garnerPitProfile(gd) * k * garnerReveal;
        }
      }
    }

    /* --- The Glass Scar: an orbital strike crater ---------------- */
    {
      const d = DISTRICTS.scar;
      const dist = Math.hypot(x - d.x, z - d.z);
      const k = w(x, z, d, 0.45);
      if (k > 0.001) {
        const rim = 27 * Math.exp(-((dist - 205) ** 2) / (2 * 52 * 52));
        const bowl = -74 * (1 - sstep(20, 200, dist));
        const terrace = Math.sin(dist * 0.075) * 3.4 * (1 - sstep(60, 205, dist));
        let hh = h + bowl + rim + terrace;
        hh = lerp(hh, scarFloorY, 1 - sstep(38, 74, dist));
        h = lerp(h, hh, k);
      }
    }

    /* --- The Censer Works: a stepped industrial terrace ---------- */
    {
      const d = DISTRICTS.censer;
      const k = w(x, z, d, 0.5);
      if (k > 0.001) {
        const split = (x - d.x) * 0.55 + (z - d.z) * 0.84;
        const terrace = lerp(censerUpperY, censerLowerY, sstep(-26, 26, split));
        const inside = 1 - sstep(150, 290, Math.hypot(x - d.x, z - d.z));
        h = lerp(h, lerp(h, terrace, inside), k);
      }
    }

    /* --- The Choir Spires: broken rocky ground ------------------ */
    {
      const d = DISTRICTS.choir;
      const dist = Math.hypot(x - d.x, z - d.z);
      const k = w(x, z, d, 0.6);
      if (k > 0.001) {
        const base = 26 * (1 - sstep(60, 300, dist));
        // Hard ridge noise at a short wavelength: at a 4m sample the
        // ground genuinely changes direction every cell, so it reads
        // faceted without any shading trick.
        //
        // Modulated by a much larger noise field, because an even
        // carpet of it turned the district floor into an egg box.
        // Erosion is patchy: shattered plates in some places and
        // scoured flats in others, and the flats are what make the
        // broken ground read as broken.
        //
        // The ridge field is DOMAIN WARPED before it is evaluated.
        // Plain ridged noise on a regular grid produces an even
        // lattice of identical cones - an egg box - which is
        // exactly what a district of shattered rock must not look
        // like. Warping the input by a longer-wavelength field
        // stretches and crowds the cells so no two read the same.
        /* NOTHING BELOW ~30m WAVELENGTH GOES IN THE HEIGHT FIELD.
           The domain warp above is doing its job, and the district
           still photographed as a quilted lattice of little faceted
           cones - because the problem was never the pattern, it was
           the SAMPLE RATE. The finest terrain LOD is a 4m cell, so a
           ridge field at 17m wavelength gets four samples per cone
           and comes out as a crude pyramid; four octaves off a 44m
           base reach 5.5m and are pure aliasing. A district of
           shattered rock rendered as crumpled foil.

           Two octaves off 78m is 78m and 39m, both of which the mesh
           can actually carry, plus a low-amplitude 26m roll for
           unevenness. The FINE detail here is the spires - they are
           real geometry with real silhouettes, and they were always
           the thing that was supposed to read. */
        const patch = clamp01(nBroad.fbm(x / 175, z / 175, 3) * 1.5 + 0.55);
        const wx = x + nBroad.fbm(x / 95, z / 95, 2) * 46;
        const wz = z + nBroad.fbm(x / 95 + 3.7, z / 95 + 1.9, 2) * 46;
        const shatter = (nRock.ridged(wx / 78, wz / 78, 2) * 25
          + nRock.ridged(wx / 26, wz / 26, 2) * 2.4) * patch;
        h = lerp(h, h + base + shatter, k);
      }
    }

    /* --- The Bloom: sunken organic pits ------------------------- */
    {
      const d = DISTRICTS.bloom;
      const k = w(x, z, d, 0.55);
      if (k > 0.001) {
        // Three overlapping craters merged with a smooth minimum so
        // they read as one excavation rather than three holes.
        let deepest = 0;
        for (const [ox, oz, rr, depth] of BLOOM_PITS) {
          const dd = Math.hypot(x - d.x - ox, z - d.z - oz);
          deepest = smin(deepest, depth * (1 - sstep(rr * 0.25, rr, dd)), 14);
        }
        const lumps = nDetail.fbm(x / 34, z / 34, 3) * 5.5;
        h = lerp(h, h + deepest + lumps, k);
      }
    }

    /* --- The Fosse: cut late, so it wins over what it crosses ---- */
    {
      const f = fosseIndex.query(x, z);
      if (f) {
        const cut = 1 - sstep(4.5, 9.5, f.d);
        const berm = Math.exp(-((f.d - 13.5) ** 2) / (2 * 4.6 * 4.6)) * 2.4;
        h = lerp(h, f.y - 4.6, cut) + berm * (1 - cut);
      }
      const s = spurIndex.query(x, z);
      if (s) {
        const cut = 1 - sstep(3.6, 8.0, s.d);
        const berm = Math.exp(-((s.d - 11.5) ** 2) / (2 * 4.0 * 4.0)) * 1.9;
        h = lerp(h, s.y - 3.9, cut) + berm * (1 - cut);
      }
    }

    /* --- The Pilgrim's Road: cut last of all --------------------- */
    {
      const r = roadIndex.query(x, z);
      if (r) {
        // Level roadbed, then a long graded shoulder, then a shallow
        // ditch. The profile of a real causeway, and the thing that
        // makes it legible from a kilometre away as a made object
        // rather than as a lighter stripe of sand.
        //
        // The shoulder runs out over 26m, not 3.5m. Narrow, the cut
        // met a 22m dune with a vertical wall and the road read as a
        // canyon; a road that crosses dunes has to have a cutting
        // with sides you could actually walk up.
        const bed = 1 - sstep(9.0, 35.0, r.d);
        const ditch = Math.exp(-((r.d - 40.0) ** 2) / (2 * 5.0 * 5.0)) * -1.5;
        // The profile is sampled from raw ground, before the
        // Cathedral mesa is raised. Letting that raw profile win
        // here carved a 48-60m trench straight through the level
        // plaza and left the nave suspended over a void. Fade the
        // road cut out across the mesa so the existing plateau grade
        // carries the causeway naturally up to the doors.
        const cathedralDist = Math.hypot(x - DISTRICTS.cathedral.x, z - DISTRICTS.cathedral.z);
        const mesaExit = sstep(205, 330, cathedralDist);
        const roadCut = Math.pow(bed, 0.55) * mesaExit;
        h = lerp(h, r.y + 1.35, roadCut) + ditch * (1 - bed) * mesaExit;
      }
    }

    /* --- The impact crater: cut after EVERYTHING --------------------
       Later than the road on purpose, and it is the one feature here
       with a story reason to be: the causeway was built, and then
       something fell on it.

       Mechanically it has to be last as well. The road's graded
       shoulder runs out to 35m and the drop site is 16.5m off the
       centreline, so a crater cut inside the district block was
       immediately lerped 88% of the way back to roadbed grade - an
       authored 2.45m dish arrived on the height field as 39cm, which
       is a dent. Nothing that is supposed to be a hole can be applied
       before something that is supposed to be a slope. */
    h += craterProfile(Math.hypot(x - DROP_SITE.podX, z - DROP_SITE.podZ));

    return h;
  }

  const BLOOM_PITS = [[-40, -50, 126, -32], [92, 64, 96, -25], [-104, 96, 84, -20]];

  const ossuaryPanY = (() => {
    const d = DISTRICTS.ossuary;
    return baseHeight(d.x, d.z) + rimHeight(d.x, d.z) - 10;
  })();

  const scarFloorY = (() => {
    const d = DISTRICTS.scar;
    return baseHeight(d.x, d.z) + rimHeight(d.x, d.z) - 66;
  })();

  /* ---------------------- analytic normal ---------------------- */

  const EPS = 1.6;
  function normalAt(x, z, out) {
    const nx = heightAt(x - EPS, z) - heightAt(x + EPS, z);
    const nz = heightAt(x, z - EPS) - heightAt(x, z + EPS);
    const ny = 2 * EPS;
    const inv = 1 / Math.hypot(nx, ny, nz);
    if (out) { out[0] = nx * inv; out[1] = ny * inv; out[2] = nz * inv; return out; }
    return [nx * inv, ny * inv, nz * inv];
  }

  /* ------------------- surface classification ------------------- */

  /**
   * What the ground is made of here, as blend weights. Drives the
   * vertex colour, footstep audio and where props may spawn - one
   * source of truth, so a bone-white pan cannot end up with sand-
   * coloured debris scattered across it.
   *
   * `slopeHint` lets the caller pass a normal it has already
   * computed. Recomputing one costs four full height evaluations,
   * and this is called once per terrain vertex.
   */
  function surfaceAt(x, z, slopeHint) {
    const out = {
      sand: 1, rock: 0, bone: 0, ash: 0, glass: 0, chitin: 0, basalt: 0,
      district: null, districtWeight: 0,
    };
    let best = 0;
    let bestName = null;
    for (const name in DISTRICTS) {
      const d = DISTRICTS[name];
      const dist = Math.hypot(x - d.x, z - d.z);
      // Naming proximity is a wide, soft field - it is what the HUD
      // and the district tint use.
      const near = 1 - sstep(d.r * 0.55, d.r * 1.05, dist);
      if (near > best) { best = near; bestName = name; }
      // GROUND MATERIAL is a separate, tighter field with its own
      // radii per district. Sharing one radius put the Glass Scar's
      // vitrified teal on 336m of open dune in every direction, and
      // a teal-over-warm-sand mix reads as a green lawn from the
      // far side of the map.
      const zone = SURFACE_ZONES[name];
      if (!zone) continue;
      const t = 1 - sstep(d.r * zone.in, d.r * zone.out, dist);
      if (t <= 0) continue;
      out[zone.key] = Math.max(out[zone.key], t * zone.w);
    }
    out.district = bestName;
    out.districtWeight = best;

    const ny = slopeHint ? slopeHint[1] : normalAt(x, z)[1];
    out.rock = clamp01(out.rock + sstep(0.30, 0.62, 1 - clamp01(ny)) * 0.95);
    out.rock = clamp01(out.rock + sstep(0.87, 1.02, rimDist(x, z)));

    const taken = clamp01(out.rock + out.bone + out.ash + out.glass + out.chitin + out.basalt);
    out.sand = clamp01(1 - taken);
    return out;
  }

  return {
    heightAt,
    normalAt,
    surfaceAt,
    baseHeight,
    rimHeight,
    rimDist,
    duneTrain,
    roadIndex,
    fosseIndex,
    spurIndex,
    roadProfile,
    fosseProfile,
    spurProfile,
    cathedralPlazaY,
    censerUpperY,
    censerLowerY,
    ossuaryPanY,
    scarFloorY,
    thresholdPadY,
    wind: { angle: WIND, x: cw, z: sw },
    noise: { broad: nBroad, dune: nDune, rock: nRock, detail: nDetail },
  };
}

/* ============================================================
   MESH BUILD
   ============================================================ */

const RAMPS = {
  sand: SAND_RAMP, rock: ROCK_RAMP, bone: BONE_RAMP, ash: ASH_RAMP,
  glass: GLASS_RAMP, chitin: CHITIN_RAMP, basalt: BASALT_RAMP,
};
const SURFACE_KEYS = ["sand", "rock", "bone", "ash", "glass", "chitin", "basalt"];

export async function buildTerrain(ctx, onProgress) {
  const { THREE, scene, materials } = ctx;
  const field = ctx.field || makeHeightField(ctx.seed);
  const rng = makeRng((ctx.seed ^ 0x77aa) >>> 0);

  const group = new THREE.Group();
  group.name = "terrain";
  scene.add(group);
  const material = materials.sand;

  /* ============================================================
     COARSE HEIGHT GRID
     Occlusion needs to sample the ground on a wide ring around
     every vertex. Doing that against the real height function was
     forty height evaluations per vertex on top of the five the
     vertex already needed. An 8m grid, built once, is accurate
     enough for occlusion and turns that into a bilinear lookup.
     ============================================================ */
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

  /* ---- baked occlusion ----
     A basin with no darkening reads as a flat plain no matter how
     deep it actually is: a single directional light has nothing to
     say about concavity. This is what makes the Saint's impact
     bowl and the Scar's crater read as holes.

     Sample radii are deliberately SHORT. A first pass included a
     190m ring, and on ground this gently rolling it painted a
     hundred-metre soft blob across the dune field that read as an
     enormous unexplained shadow - occlusion at that scale is not
     occlusion, it is just "somewhere over there is higher". The
     useful range for contact darkening is single-digit to a few
     tens of metres. */
  const aoDirs = [];
  for (const [radius, count] of [[4, 6], [11, 6], [26, 8], [54, 8]]) {
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + radius * 0.37;
      aoDirs.push([Math.cos(a) * radius, Math.sin(a) * radius, radius]);
    }
  }
  const aoNorm = aoDirs.reduce((s, d) => s + 1 / (1 + d[2] * 0.10), 0) * 0.34;

  function occlusionAt(x, z, y) {
    let occ = 0;
    for (let i = 0; i < aoDirs.length; i += 1) {
      const d = aoDirs[i];
      occ += clamp01((coarseHeight(x + d[0], z + d[1]) - y) / d[2]) * (1 / (1 + d[2] * 0.10));
    }
    // Squared, so shallow ambient occlusion stays near zero and only
    // genuine pits and trench floors darken.
    const o = clamp01(occ / aoNorm);
    return o * o;
  }

  /* ---------------------- vertex colour ---------------------- */

  const SHADOW_TINT = [0.30, 0.16, 0.26];
  function colourAt(x, z, y, normal) {
    const surf = field.surfaceAt(x, z, normal);
    const slope = 1 - clamp01(normal[1]);

    /* HOW FAR INSIDE THE GARNER'S PIT THIS VERTEX IS, needed before the
       tonal range is chosen because the pit breaks two of the terms that
       follow. See the pair of corrections at the bottom of this function
       - both of them are consequences of `coarseHeight` being baked
       before this hole exists. */
    let pitIn = 0;
    let pitR = Infinity;
    if (garnerReveal > 0.0005) {
      pitR = Math.hypot(x - GARNER_PIT.x, z - GARNER_PIT.z);
      pitIn = (1 - sstep(GARNER_PIT.rimRadius, GARNER_PIT.rimRadius + 14, pitR))
        * garnerReveal;
    }

    // Where in this surface's tonal range does the vertex sit?
    // Height relative to the local mean, plus how skyward it faces.
    /* `local` IS ALSO MEASURED AGAINST THE COARSE GRID, so a vertex
       twelve metres down a hole the grid does not know about reads as
       the bottom of a canyon and picks the darkest end of the sand ramp.
       Faded out across the pit for the same reason the occlusion is: the
       question it is asking - "is this high ground or low ground for
       around here?" - has no answer the grid can give inside a feature
       that appeared after it was built. */
    const local = (y - coarseHeight(x, z)) * 0.06 * (1 - pitIn)
      + (y - field.baseHeight(x, z)) * 0.012;
    const crest = clamp01(
      0.46 + local + (1 - slope) * 0.20
      + field.noise.broad.fbm(x / 190, z / 190, 3) * 0.22
    );

    let r = 0; let g = 0; let b = 0; let wsum = 0;
    for (let i = 0; i < SURFACE_KEYS.length; i += 1) {
      const key = SURFACE_KEYS[i];
      const wgt = surf[key];
      if (wgt <= 0.002) continue;
      const c = RAMPS[key].at(key === "sand" ? crest : clamp01(crest * 0.85 + 0.12));
      r += c[0] * wgt; g += c[1] * wgt; b += c[2] * wgt; wsum += wgt;
    }
    if (wsum <= 0.0001) {
      const c = SAND_RAMP.at(crest);
      r = c[0]; g = c[1]; b = c[2]; wsum = 1;
    }
    r /= wsum; g /= wsum; b /= wsum;

    // District tint: an area carries a mood without leaving the
    // palette. A level that is one colour everywhere is a level
    // with one idea.
    const tint = DISTRICT_TINT[surf.district];
    if (tint && tint.strength > 0 && surf.districtWeight > 0.01) {
      const k = surf.districtWeight * tint.strength * 0.55;
      const m = mixRgb([r, g, b], hexToRgb(tint.tint), k);
      r = m[0]; g = m[1]; b = m[2];
    }

    // Occlusion, tinted toward the shadow violet rather than toward
    // black. Multiplying to grey is what makes baked AO look dirty.
    /* AND THE GARNER'S PIT IS EXEMPT FROM IT, because inside that pit
       this pass is not measuring occlusion - it is measuring its own
       blind spot.

       `occlusionAt` asks `coarseHeight` how high the ground is on four
       rings out to 54m and counts how much of the sky that leaves. The
       coarse grid is built before the pit is carved, so a vertex on the
       funnel floor is told that the ground FOUR METRES away stands
       twelve above it in every direction - which is a vertical shaft,
       not a twenty-degree sand cone. Every sample saturates, `o*o`
       returns 1, the 0.62 mix crushes the value, and the whole hole
       photographed as a black slot cut in bright sand with no terraces,
       no spoil and no floor to fight on.

       Faded out across the pit and replaced by the radial term at the
       bottom of this function, which is what a circular hole's occlusion
       actually is and which the reveal can scale. */
    const occ = occlusionAt(x, z, y) * (1 - pitIn);
    if (occ > 0.002) {
      const k = occ * 0.62;
      r = lerp(r, r * SHADOW_TINT[0] + 0.055, k);
      g = lerp(g, g * SHADOW_TINT[1] + 0.030, k);
      b = lerp(b, b * SHADOW_TINT[2] + 0.062, k);
    }

    // A pale scour line along every dune crest. This is what gives a
    // dune field its drawn quality at distance, where the geometry
    // is too small to read.
    if (surf.sand > 0.4) {
      const ridge = clamp01((normal[1] - 0.9855) * 92) * clamp01(local * 6 + 0.30);
      if (ridge > 0.002) {
        const m = mixRgb([r, g, b], SAND_RAMP.at(0.99), ridge * 0.5 * surf.sand);
        r = m[0]; g = m[1]; b = m[2];
      }
    }

    /* ------------------------------------------------------------
       THE GARNER'S PIT GETS ITS SHADING WRITTEN BY HAND, because the
       two passes that would have done it are both blind here - see the
       notes on `local` and on `occ` above. Radial functions, which is
       all a circular hole's shading ever was, and scaled by the reveal
       so a sealed pan carries nothing waiting on it.
       ------------------------------------------------------------ */
    if (pitIn > 0.0005) {
      const pit = GARNER_PIT;
      /* THE BOWL. A third of the way to the shadow tint at the floor,
         tapering to nothing at the rim, which is about what a hole nine
         metres deep and thirty-six across actually loses - and unlike
         the saturating version it leaves the terraces and the spoil in
         the picture. */
      const bowl = (1 - sstep(pit.floorRadius * 0.7, pit.rimRadius + 4, pitR))
        * garnerReveal * 0.34;
      if (bowl > 0.002) {
        r = lerp(r, r * SHADOW_TINT[0] + 0.055, bowl);
        g = lerp(g, g * SHADOW_TINT[1] + 0.030, bowl);
        b = lerp(b, b * SHADOW_TINT[2] + 0.062, bowl);
      }
      /* AND THE THROAT IS NOT SAND AT ALL.

         Geometry alone cannot make the bore read as a hole: five metres
         of sand cone under a desert noon comes back as a nicely shaded
         funnel, which is the exact failure the mouth's black shelf and
         unlit bore were built to hide one plane at a time. A near-black
         vertex colour over the same annulus does it for the whole depth,
         and it is free - these vertices are being written anyway.

         HELD INSIDE THE BORE'S OWN SPAN. Reaching past `throatOuter` put
         a black disc on the funnel FLOOR, and the floor is the ring of
         ground the entire fight is conducted from: the mouth read as
         something floating in a void rather than as a rim set in sand,
         which is the opposite of the change this is part of. Near-black
         inside six metres, where the collar stands in front of it
         anyway, and honest sand by anywhere the player can stand. */
      const dark = (1 - sstep(pit.throatInner, pit.throatOuter, pitR))
        * garnerReveal;
      if (dark > 0.002) {
        r = lerp(r, 0.013, dark);
        g = lerp(g, 0.0085, dark);
        b = lerp(b, 0.0075, dark);
      }
    }

    return [r, g, b];
  }

  /* ------------------------ chunk sampling ------------------------ */

  const FINE = LOD_CELLS[0];
  const FINE_SIDE = FINE + 1;

  /** Sample a chunk once at the finest LOD; every coarser LOD is a
   *  stride of this grid, so they agree exactly at shared samples. */
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
        const c = colourAt(x, z, y, nrm);
        ys[p] = y;
        ns[p * 3] = nrm[0]; ns[p * 3 + 1] = nrm[1]; ns[p * 3 + 2] = nrm[2];
        cs[p * 3] = srgb(c[0]); cs[p * 3 + 1] = srgb(c[1]); cs[p * 3 + 2] = srgb(c[2]);
      }
    }
    return { ys, ns, cs, ox, oz, step };
  }

  const SKIRT = 11;

  function geometryFromSamples(s, lod) {
    const cells = LOD_CELLS[lod];
    const stride = FINE / cells;
    const side = cells + 1;
    const vCount = side * side + side * 4;
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    const indices = [];

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
        // Alternate the diagonal, or every quad splits the same way
        // and a dune field grows a visible herringbone at grazing
        // sun angles.
        if (((i + j) & 1) === 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, c, d, a, d, b);
      }
    }

    /* Skirt. Adjacent chunks may sit at different LODs and two LODs
       of the same edge do not agree between shared samples. An 11m
       downward apron hides the gap for four quads per edge, instead
       of a stitching pass that would need to know its neighbours'
       LODs before they have been chosen. */
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
        // Wound both ways. Only one winding is front-facing and the
        // other is simply never drawn - cheaper than deriving the
        // correct orientation for four traversal directions.
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
  let done = 0;
  for (let cz = 0; cz < CHUNKS; cz += 1) {
    for (let cx = 0; cx < CHUNKS; cx += 1) {
      const samples = sampleChunk(cx, cz);
      const lods = [];
      for (let lod = 0; lod < LOD_CELLS.length; lod += 1) {
        const mesh = new THREE.Mesh(geometryFromSamples(samples, lod), material);
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
        /* Retain the 65x65 height plane (about 17KB per chunk) so
           gameplay can stand on the triangles the player actually
           sees. Re-evaluating the analytic field here is not the
           same surface: narrow trenches can change several metres
           between the renderer's 4m vertices. */
        heightSamples: samples.ys,
      });
      done += 1;
      if (onProgress) {
        onProgress(0.12 + 0.88 * (done / total));
        // Yield every fourth chunk, not every chunk. A hidden or
        // backgrounded tab throttles setTimeout to one second, so
        // 64 yields here plus 8 in the coarse pass turned a 2.7s
        // load into 70-odd seconds of watching a progress bar that
        // was not waiting on any actual work.
        if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  /* ============================================================
     THE GARNER'S PIT, LIVE

     The one patch of this terrain that moves after load, and it moves
     because the Ossuary's boss is the ground opening.

     A FULL RESAMPLE IS NOT AVAILABLE. `sampleChunk` costs 4225 height
     evaluations plus a normal (four more each) and a colour (thirty-odd
     coarse lookups each) per chunk, and the pit straddles three of them
     - about a seventh of a second, for a surface that has to move every
     frame for five seconds. So the patch is precomputed instead: the
     pit's displacement is a pure function of radius times one scalar,
     which means every affected sample has exactly TWO states worth
     measuring, and the frame's job is a lerp.

     THE CLOSED END IS READ BACK OUT OF LOD0 rather than recomputed.
     Every sample appears in LOD0 at stride 1, so the mesh already holds
     the pan's own height, normal and encoded colour at this exact
     point - and re-deriving them risks disagreeing by a hair with the
     vertices immediately outside the patch, which is a visible seam
     around a 124m disc.

     Cost per refresh, measured: 783 samples of nine lerps and a
     normalise, writing into about a thousand vertices across the twelve
     buffers of three chunks. It does not appear in the frame budget -
     4.0ms mid-collapse against 3.3 settled.
     ============================================================ */
  const pitPatch = (() => {
    const pit = GARNER_PIT;
    const step = CHUNK_SIZE / FINE;

    /** Every LOD vertex a chunk sample (i,j) writes into. */
    function targetsFor(i, j) {
      const out = [];
      for (let lod = 0; lod < LOD_CELLS.length; lod += 1) {
        const cells = LOD_CELLS[lod];
        const stride = FINE / cells;
        if (i % stride !== 0 || j % stride !== 0) continue;
        const side = cells + 1;
        const gi = i / stride;
        const gj = j / stride;
        out.push(lod, gj * side + gi, 0);
        /* THE SKIRT DUPLICATES EDGE SAMPLES, and forgetting that leaves
           an eleven-metre apron hanging at pan height along every chunk
           seam the pit crosses - which this one crosses twice, being
           124m across on a 256m grid. The duplicates are laid out four
           edges of `side` vertices each, straight after the plane. */
        const base = side * side;
        if (gj === 0) out.push(lod, base + gi, 1);
        if (gj === cells) out.push(lod, base + side + gi, 1);
        if (gi === 0) out.push(lod, base + side * 2 + gj, 1);
        if (gi === cells) out.push(lod, base + side * 3 + gj, 1);
      }
      return out;
    }

    const entries = [];
    const geos = [];
    const attrsOf = new Map();
    const cLo = (v) => Math.max(0, Math.floor((v + MAP_HALF) / CHUNK_SIZE));
    const cHi = (v) => Math.min(CHUNKS - 1, Math.floor((v + MAP_HALF) / CHUNK_SIZE));
    const cxLo = cLo(pit.x - pit.reach);
    const cxHi = cHi(pit.x + pit.reach);
    const czLo = cLo(pit.z - pit.reach);
    const czHi = cHi(pit.z + pit.reach);

    /* Measured with the pit FULLY OPEN, then handed straight back. Any
       consumer that samples the field between these two lines gets a
       finished funnel, which is why nothing may run in here but this. */
    const wasRevealed = garnerReveal;
    garnerReveal = 1;
    const nrm = [0, 0, 0];
    for (let cz = czLo; cz <= czHi; cz += 1) {
      for (let cx = cxLo; cx <= cxHi; cx += 1) {
        const chunk = chunks[cz * CHUNKS + cx];
        const ox = -MAP_HALF + cx * CHUNK_SIZE;
        const oz = -MAP_HALF + cz * CHUNK_SIZE;
        let attrs = null;
        for (let j = 0; j < FINE_SIDE; j += 1) {
          const z = oz + j * step;
          for (let i = 0; i < FINE_SIDE; i += 1) {
            const x = ox + i * step;
            if (Math.hypot(x - pit.x, z - pit.z) >= pit.reach) continue;
            if (!attrs) {
              attrs = chunk.lods.map((mesh) => {
                const a = mesh.geometry.attributes;
                geos.push(mesh.geometry);
                /* THE SPHERES HAVE TO GROW, once, here. They were fitted
                   to a flat pan; a bore that drops twenty metres below
                   it puts vertices outside them, and a chunk whose
                   bounding sphere no longer contains its own geometry is
                   a chunk the frustum culls while the player is standing
                   in the hole. Recomputing per frame is 4225 vertices
                   times twelve buffers for an answer that is knowable in
                   advance. */
                mesh.geometry.boundingSphere.radius += pit.depth + pit.throatDepth;
                return { pos: a.position.array, nrm: a.normal.array, col: a.color.array };
              });
              attrsOf.set(chunk, attrs);
            }
            const p = j * FINE_SIDE + i;
            const l0 = attrs[0];
            const y1 = field.heightAt(x, z);
            field.normalAt(x, z, nrm);
            const c1 = colourAt(x, z, y1, nrm);
            entries.push({
              ys: chunk.heightSamples,
              p,
              attrs,
              targets: targetsFor(i, j),
              y0: l0.pos[p * 3 + 1],
              y1,
              n0: [l0.nrm[p * 3], l0.nrm[p * 3 + 1], l0.nrm[p * 3 + 2]],
              n1: [nrm[0], nrm[1], nrm[2]],
              c0: [l0.col[p * 3], l0.col[p * 3 + 1], l0.col[p * 3 + 2]],
              c1: [srgb(c1[0]), srgb(c1[1]), srgb(c1[2])],
            });
          }
        }
      }
    }
    garnerReveal = wasRevealed;

    let applied = 0;

    /**
     * Open or close the pit. Returns whether anything actually moved.
     *
     * THE FIELD AND THE MESH ARE SET TOGETHER, always, and that is why
     * there is no bare setter for `garnerReveal`. `heightAt` feeds the
     * foot IK and every module that samples the ground analytically;
     * the sample plane feeds `groundHeightAt`, which is what the player
     * walks on and what collision reads. Letting one move without the
     * other is a player standing on a surface that is not drawn.
     */
    function refresh(reveal) {
      const v = clamp01(Number(reveal) || 0);
      garnerReveal = v;
      if (Math.abs(v - applied) < 4e-4) return false;
      applied = v;
      for (let e = 0; e < entries.length; e += 1) {
        const en = entries[e];
        const y = lerp(en.y0, en.y1, v);
        en.ys[en.p] = y;
        let nx = lerp(en.n0[0], en.n1[0], v);
        let ny = lerp(en.n0[1], en.n1[1], v);
        let nz = lerp(en.n0[2], en.n1[2], v);
        const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
        nx *= inv; ny *= inv; nz *= inv;
        const cr = lerp(en.c0[0], en.c1[0], v);
        const cg = lerp(en.c0[1], en.c1[1], v);
        const cb = lerp(en.c0[2], en.c1[2], v);
        const t = en.targets;
        for (let n = 0; n < t.length; n += 3) {
          const a = en.attrs[t[n]];
          const k = t[n + 1] * 3;
          const skirt = t[n + 2];
          a.pos[k + 1] = skirt ? y - SKIRT : y;
          a.nrm[k] = nx; a.nrm[k + 1] = ny; a.nrm[k + 2] = nz;
          a.col[k] = skirt ? cr * 0.80 : cr;
          a.col[k + 1] = skirt ? cg * 0.78 : cg;
          a.col[k + 2] = skirt ? cb * 0.84 : cb;
        }
      }
      for (let n = 0; n < geos.length; n += 1) {
        const a = geos[n].attributes;
        a.position.needsUpdate = true;
        a.normal.needsUpdate = true;
        a.color.needsUpdate = true;
      }
      return true;
    }

    return { refresh, samples: entries.length, chunks: attrsOf.size };
  })();

  /* ------------------------ LOD selection ------------------------ */

  function updateLod(camera) {
    const { x, y, z } = camera.position;
    for (let n = 0; n < chunks.length; n += 1) {
      const chunk = chunks[n];
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

  /** Height of the rendered near-player terrain triangle at (x,z).
   *
   * The player always keeps their own chunk inside the LOD0 range,
   * whose vertices come from the retained 4m sample plane. This
   * reproduces geometryFromSamples' alternating diagonals exactly;
   * using the continuous authoring field instead made feet, collision
   * and the visible floor disagree most severely in the narrow Fosse. */
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

  return {
    group,
    chunks,
    /* Collision can then include any rendered-grid vertex that falls
       inside a capsule footprint. A triangulated height field reaches
       an interior maximum only at one of those vertices; exposing the
       real step avoids duplicating the LOD0 resolution elsewhere. */
    groundSampleStep: CHUNK_SIZE / FINE,
    field,
    rng,
    coarseHeight,
    occlusionAt,
    heightAt: field.heightAt,
    groundHeightAt,
    normalAt: field.normalAt,
    surfaceAt: field.surfaceAt,
    /** How much of the Garner's pit exists. garner.js owns the value;
     *  see the note on `pitPatch`. */
    setGarnerPitReveal: pitPatch.refresh,
    garnerPitStats: () => ({
      samples: pitPatch.samples,
      chunks: pitPatch.chunks,
      reveal: garnerPitReveal(),
    }),
    updateLod,
    stats() {
      let tris = 0;
      let visible = 0;
      for (const chunk of chunks) {
        if (chunk.active < 0) continue;
        visible += 1;
        tris += chunk.lods[chunk.active].geometry.index.count / 3;
      }
      return { chunks: chunks.length, visible, triangles: tris };
    },
  };
}
