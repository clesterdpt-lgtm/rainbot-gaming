/* ============================================================
   SAINTFALL - Antiphon review instruments

   Bolted onto `window.__SF` after qa.js has built it. Everything
   here is a MEASUREMENT, and it exists because the ways this
   level fails are not things a screenshot can see:

     a pad that is not flat is a fight arena on a hillside;
     a circuit over grade is a beach you cannot walk along;
     a station the walk solver cannot reach is content that does
       not exist;
     a reef crest that is not proud of the flat is a lagoon with
       no lip, so the surf breaks nowhere;
     and - the one this level has that neither predecessor does -
       THE BAKED SEABED AND THE REAL GROUND CAN DISAGREE. The
       water shader cannot call `heightAt`; it reads a 2 m/texel
       texture. Every foam line, every depth colour and every
       caustic in the level is drawn from that texture, so where
       it is wrong the sea is wrong, and it is wrong in a way that
       looks like art rather than like a bug.

   THE TWO RULES THE WHOLE FILE OBEYS, copied from summit-qa.js
   because they were paid for:

   1. EVERY ENTRY IS A METHOD, never construction work. A probe
      that throws at install time takes the level down with it,
      and an instrument that can break the thing it measures is
      worse than no instrument.

   2. NOTHING HERE REIMPLEMENTS THE RULE IT TESTS. `reachable`
      marches the player's own slope rule, read off the constants
      in player.js rather than re-derived; `waterDepthAt` goes
      through the field's one reader; the circuit's geometry comes
      from `field.circuitPointAt`. A harness that reimplements its
      subject is a harness that agrees with itself.

   ------------------------------------------------------------
   AND A THIRD RULE THIS FILE ADDS, because the level is being
   built by seven modules in parallel:

   3. A MISSING SUBSYSTEM RETURNS null, NEVER THROWS. Every method
      that reaches outside this file for a thing that may not
      exist yet - the water, the seabed bake, the Cauldron road,
      the wreck's decks, the world's beauty shots - guards and
      returns `null` or `{ supported: false, reason }`. The audit
      script turns those into SKIP lines. An acceptance harness
      that cannot be run until the level is finished is an
      acceptance harness that is never run.

   COST. Zero triangles, zero draw calls, zero fill. It is
   methods; nothing is allocated until something calls it.
   ============================================================ */

import { clamp, clamp01, lerp, TAU } from "saintfall/core.js";
import {
  STATIONS, STATION_ORDER, LANDING, MAP_HALF, MAP_SIZE,
  SEA_Y, TIDE, WADE_MAX, WADE_MAX as WADE_CAP,
  atollProfile, atollProfileSlope,
} from "saintfall/atoll-terrain.js";
import { ATOLL_TIMES } from "saintfall/atoll-art.js";

/* COPIED FROM player.js:2390-2392, and the copy is deliberate.
   Importing them is impossible - they are function-scoped inside
   `createPlayer` - and re-deriving them would produce a harness
   that measures a slope rule the game does not use. If those
   constants move, `reachable` starts lying, and the only defence
   is this comment plus `slopeRule()` below, which republishes the
   numbers so an audit can print what it is testing against. */
const WALK_SLOPE_LOOK = 1.6;
const WALK_SLOPE_LIMIT = 1.7;
const WALK_MAX_STEP_UP = 1.05;

/* THE FREE CAMERA'S CEILING, and it is an art-direction cap
   rather than a safety one.

   The seabed decays to -40 m and the sea is drawn to the far
   clip, so the map's boundary is invisible from every point a
   player can stand: from the Cauldron's 214 m crown the ray meets
   the water at 11.8 degrees, where Fresnel reflectance is 0.72
   and what transmits crosses 108 m of water. Lift a QA camera to
   600 m and that argument fails - the boundary appears as a faint
   straight line across the ocean and a reviewer photographs the
   edge of the map. 260 m is the crown plus a fifth, which is as
   high as any authored pose has a reason to be.
   See design/terrain-surfaces.md 1.5. */
const CAMERA_MAX_EYE_M = 260;

/* Where the reef crest and the reef flat are looked for, in
   PROFILE radius - the world radius is `rp + dR` and dR is the
   ring warp, which is why every reef probe below adds it back.
   From the layout: crest at 972, flat 914..950. */
const REEF_CREST_SEARCH = [930, 1020];
const REEF_FLAT_BAND = [914, 950];

/* Bulk meshes `nearestPropWithin` and `floatingProps` must not
   count as props. The summit's regex is /^terrain|drift-powder|
   ^weather|^sky/; this world's bulk is different and a stale
   regex here does not fail, it silently reports the sea as the
   nearest interesting object in every frame. */
const BULK_MESH_RE = /^terrain|^apron|^water|^sea|^foam|^spray|^weather|^sky|^cloud|^canopy-field|^pollen|^rain/;

/* WHAT THE BEDDING GATE IS NOT ALLOWED TO MEASURE, and it is a
   short list on purpose - every name on it is something whose
   bedding reference is NOT the landform, so measuring it against
   the landform manufactures a fault rather than finding one.

     the wreck        a broken hull resting on its own structure.
                      `antiphon-drive-brass-livecoil` reads 82.9 m
                      above the sand and is exactly where it
                      should be.
     on the wreck     the arena furniture that stands on the
                      Antiphon's decks. It goes through the same
                      ground bins as the beach dressing, so it is
                      caught by its STATION token and not by its
                      bin: `atoll-ground-hull-roost-crate` is a
                      crate on the Roost's rib deck 52 m up.
     epiphytes        grow on trunks. That is what an epiphyte is.
     the canopy       `flora-canopy-oct0..7` is the eight-octant
     shell            canopy SHELL - one sheet draped over the
                      treetops so the vegetation reads as a mass
                      from the air. Its lowest point is 2.2 to
                      4.0 m above the ground because that is what
                      a shell over a canopy is.

   The wreck stations are prow / hold / drive / spine / roost;
   the shore stations (landing, strand, lagoon, cauldron,
   weeping, bone) are NOT here and their furniture is measured.
   `hold` is matched as a whole dash-delimited token so it cannot
   catch `hull`. */
const BEDDED_SKIP_RE = /^antiphon-|^road-surface-antiphon-|(^|-)(prow|hold|drive|spine|roost)(-|$)|epiphyte|liana|^flora-canopy-oct/;

/* A plant's canopy, judged through its trunk. See floatingProps. */
const BEDDED_CANOPY_RE = /^flora-.*-leaf-/;

export function installAtollQa(ctx, api, hook) {
  const target = hook || (typeof window !== "undefined" ? window.__SF : null);
  if (!target) return null;

  /* ------------------------------------------------------------
     HELPERS. All of them guard: this file installs before the
     level is finished being built more often than after it.
     ------------------------------------------------------------ */

  const field = () => (ctx.terrain && ctx.terrain.field) || ctx.field || null;

  /** What the player STANDS on. Prefer the collider's answer: the
   *  wreck's deck plates are a real walk surface tens of metres
   *  above the sand, and the Spine crosses eight metres of open
   *  lagoon. Any check about the LANDFORM must use `terrainAt`. */
  const groundY = (x, z) => {
    if (ctx.collide && ctx.collide.groundHeight) return ctx.collide.groundHeight(x, z);
    const f = field();
    return f ? f.heightAt(x, z) : 0;
  };

  /** The player's own walkability test, at one step. */
  function walkable(fromX, fromZ, ux, uz) {
    const here = groundY(fromX, fromZ);
    const near = groundY(fromX + ux * 0.45, fromZ + uz * 0.45) - here;
    if (near > WALK_MAX_STEP_UP) return false;
    const rise = groundY(fromX + ux * WALK_SLOPE_LOOK, fromZ + uz * WALK_SLOPE_LOOK) - here;
    return rise / WALK_SLOPE_LOOK < WALK_SLOPE_LIMIT;
  }

  /** The pad ellipse's own axes.
   *
   *  Pads on this level are ELLIPSES, not discs - `padA` runs
   *  ALONG the shore and `padC` ACROSS it - because the ring is
   *  176 m wide and a circular pad of radius 120 flattens the
   *  island's whole cross-section on its bearing. So every probe
   *  over a pad has to work in the station's own frame, and the
   *  frame is built from the station's bearing, not from world
   *  axes. The Hold sits at the origin where that bearing is
   *  undefined; it gets world axes and a zero-size pad, which is
   *  correct - its "pad" is the lagoon floor and exists only so
   *  the naming field has something to key on. */
  function padBasis(s) {
    const len = Math.hypot(s.x, s.z);
    if (len < 1e-3) return { ux: 1, uz: 0, vx: 0, vz: 1 };
    return { ux: -s.z / len, uz: s.x / len, vx: s.x / len, vz: s.z / len };
  }

  /** The ring-radius warp at a bearing, read straight off the
   *  band the field baked. `field.readBand` interpolates and is
   *  not exported; this is the nearest of 1440 samples, i.e. a
   *  quarter of a degree, which at r = 972 is 4 m of arc and zero
   *  metres of radius error - the band is a function of bearing
   *  alone. */
  function ringWarpAt(bearingRad) {
    const f = field();
    if (!f || !f.bands || !f.bands.ringR) return 0;
    const band = f.bands.ringR;
    const a = ((bearingRad % TAU) + TAU) % TAU;
    const i = Math.round((a / TAU) * band.length) % band.length;
    return band[i] || 0;
  }

  /** compass degrees -> unit (x, z). x = r sin(c), z = -r cos(c).
   *  +Z is SOUTH. This has been got wrong twice in this project
   *  and the symptom is a probe that is right at one bearing and
   *  mirrored at the opposite one. */
  const bearingUnit = (compassDeg) => {
    const a = (compassDeg * Math.PI) / 180;
    return [Math.sin(a), -Math.cos(a)];
  };

  const atollProfileAt = (r) => atollProfile(r);

  /* ------------------------------------------------------------
     THE CIRCUIT. Geometry from the field, heights from the
     ground.
     ------------------------------------------------------------ */

  /** The circuit parameter nearest a world point. Coarse scan
   *  then a local refine: the circuit is 4.8 km long and closes,
   *  so a gradient walk from an arbitrary seed lands in whichever
   *  local minimum it started next to. */
  function circuitTNear(x, z, coarse = 720) {
    const f = field();
    if (!f || !f.circuitPointAt) return null;
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i < coarse; i += 1) {
      const t = i / coarse;
      const p = f.circuitPointAt(t);
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; bestT = t; }
    }
    let span = 1 / coarse;
    for (let k = 0; k < 24; k += 1) {
      const cands = [bestT - span, bestT + span];
      for (const c of cands) {
        const t = ((c % 1) + 1) % 1;
        const p = f.circuitPointAt(t);
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) { bestD = d; bestT = t; }
      }
      span *= 0.6;
    }
    return { t: bestT, distance: Math.sqrt(bestD) };
  }

  /** The shorter way round, as a polyline. The circuit is a LOOP:
   *  marching t from 0.9 to 0.1 the long way is a 4 km walk past
   *  every station on the ring, and it would report a station
   *  unreachable because of ground on the far side of the island
   *  from it. */
  function circuitLeg(t0, t1, stepLen = 2.0) {
    const f = field();
    const out = [];
    if (!f || !f.circuitPointAt) return out;
    let d = t1 - t0;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    const arc = Math.abs(d) * (f.circuitLength || 4800);
    const n = Math.max(2, Math.round(arc / stepLen));
    for (let i = 0; i <= n; i += 1) {
      const t = ((t0 + d * (i / n)) % 1 + 1) % 1;
      const p = f.circuitPointAt(t);
      out.push([p.x, p.z]);
    }
    return out;
  }

  /* ------------------------------------------------------------
     THE SEABED BAKE. The one instrument this level needs that
     neither predecessor has.
     ------------------------------------------------------------ */

  /** Decode the baked seabed at a texel, exactly as the shader
   *  does: `h = (r + g/255) * scale + offset` with r and g the
   *  NORMALISED channel values. */
  function decodeTexel(data, channels, idx, enc) {
    if (channels >= 2) {
      const r = data[idx * channels] / 255;
      const g = data[idx * channels + 1] / 255;
      return (r + g / 255) * enc.scale + enc.offset;
    }
    const r = data.BYTES_PER_ELEMENT === 4 ? data[idx] : data[idx] / 255;
    return r * enc.scale + enc.offset;
  }

  /** The baked seabed's answer at a world point, TWICE.
   *
   *  `filtered` is what the GPU actually gets: LinearFilter
   *  interpolates EACH CHANNEL INDEPENDENTLY and the shader
   *  decodes afterwards. Where the low byte wraps 255 -> 0 across
   *  a texel boundary the interpolated g dips through the whole
   *  range while r steps by one, so the decoded height spikes by
   *  up to scale/255 = 0.376 m. That is a real artefact of a
   *  16-bit pair in an 8-bit texture and it is invisible in the
   *  nearest-texel value, so both are reported and the difference
   *  between them is the wrap risk at that point.
   *
   *  `nearest` is the bake's own accuracy, with the filter taken
   *  out of it. */
  function seabedSample(x, z) {
    const t = ctx.terrain;
    if (!t || !t.seabedTexture || !t.seabedEncode) return null;
    const img = t.seabedTexture.image;
    const data = img && (img.data || img);
    if (!data || !data.length) return null;
    const w = img.width || Math.round(Math.sqrt(data.length / 4));
    const h = img.height || w;
    const channels = Math.max(1, Math.round(data.length / (w * h)));
    const enc = t.seabedEncode;
    /* The bake covers the whole 2048 m map, origin at the centre.
       Row 0 is assumed to be -Z: DataTexture does not flip, and a
       bake written the other way up shows here as an error of
       tens of metres rather than tenths, which is the point of
       measuring it at all rather than asserting it. */
    const u = clamp01((x + MAP_HALF) / MAP_SIZE) * (w - 1);
    const v = clamp01((z + MAP_HALF) / MAP_SIZE) * (h - 1);
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = u - x0;
    const fy = v - y0;
    const at = (px, py) => py * w + px;
    let filtered;
    if (channels >= 2) {
      const ch = (i, c) => data[i * channels + c] / 255;
      const r = lerp(lerp(ch(at(x0, y0), 0), ch(at(x1, y0), 0), fx),
        lerp(ch(at(x0, y1), 0), ch(at(x1, y1), 0), fx), fy);
      const g = lerp(lerp(ch(at(x0, y0), 1), ch(at(x1, y0), 1), fx),
        lerp(ch(at(x0, y1), 1), ch(at(x1, y1), 1), fx), fy);
      filtered = (r + g / 255) * enc.scale + enc.offset;
    } else {
      const d0 = decodeTexel(data, channels, at(x0, y0), enc);
      const d1 = decodeTexel(data, channels, at(x1, y0), enc);
      const d2 = decodeTexel(data, channels, at(x0, y1), enc);
      const d3 = decodeTexel(data, channels, at(x1, y1), enc);
      filtered = lerp(lerp(d0, d1, fx), lerp(d2, d3, fx), fy);
    }
    const nearestIdx = at(fx < 0.5 ? x0 : x1, fy < 0.5 ? y0 : y1);
    const nearest = decodeTexel(data, channels, nearestIdx, enc);
    return {
      filtered, nearest, width: w, height: h, channels,
      metresPerTexel: MAP_SIZE / w,
    };
  }

  /* ------------------------------------------------------------
     THE SURFACE
     ------------------------------------------------------------ */

  const atoll = {

    /* ------------------------- the table ------------------------- */

    stations() {
      return STATION_ORDER.map((id) => {
        const s = STATIONS[id];
        const r = Math.hypot(s.x, s.z);
        return {
          id, name: s.name, x: s.x, z: s.z, r: s.r,
          padA: s.padA, padC: s.padC, padY: s.padY,
          tint: s.tint,
          groundY: groundY(s.x, s.z),
          terrainY: atoll.terrainAt(s.x, s.z),
          /* Compass, not the engine bearing: the layout document,
             the art direction and every conversation about this
             level are in compass degrees. */
          bearingDeg: (Math.atan2(s.x, -s.z) * 180 / Math.PI + 360) % 360,
          radius: r,
          freeboardM: s.padY - SEA_Y,
        };
      });
    },

    /** Alias. `arenas()` is what the arena/boss documents call
     *  these; `stations()` is what the terrain calls them. They
     *  are the same nine records and having two names for them in
     *  two documents is not worth a second table. */
    arenas() { return atoll.stations(); },

    /** What the world module placed at a station, if it has run.
     *  `world.stationSites` is authored by atoll-world.js; this
     *  is a guarded passthrough and nothing more, because the
     *  moment a harness starts deriving a site it has a second
     *  opinion about where the arena is. */
    stationSite(id) {
      const w = api && api.world;
      const sites = w && w.stationSites;
      if (!sites) return null;
      if (Array.isArray(sites)) return sites.find((s) => s && s.id === id) || null;
      return sites[id] || null;
    },

    /** A three-quarter view from OUTBOARD at about two pad widths.
     *  Derived rather than authored so a station that moves takes
     *  its camera with it - and derived from `padC`, the across-
     *  shore axis, because standing off along `padA` puts the
     *  camera on the next station's ground. */
    stationPose(id) {
      const s = STATIONS[id];
      if (!s) return null;
      const b = padBasis(s);
      const d = Math.max(s.padC || 0, 40) * 2.1 + 60;
      const px = s.x + b.vx * d;
      const pz = s.z + b.vz * d;
      const eye = Math.max(16, (s.padC || 40) * 0.30);
      return {
        position: [px, Math.max(groundY(px, pz), SEA_Y) + eye, pz],
        target: [s.x, s.padY + 8, s.z],
        fov: 52,
      };
    },
    arenaPose(id) { return atoll.stationPose(id); },

    /* ------------------------ the surface ------------------------ */

    /** What you STAND on - the collider, which carries the wreck's
     *  decks, the Spine's walkway and every rasterised prop. */
    altitudeAt: (x, z) => groundY(x, z),

    /** The LANDFORM, straight from the field. On this level the
     *  gap between the two is the widest it has ever been: at the
     *  Reliquary Hold `altitudeAt` is a ceramic floor 34 m up and
     *  `terrainAt` is 8.5 m of lagoon floor under it. Every gate
     *  about the ISLAND reads this one; every gate about
     *  TRAVERSAL reads the other. */
    terrainAt(x, z) {
      const f = field();
      return f ? f.heightAt(x, z) : 0;
    },

    /** Through `field.waterDepthAt`, which INTERFACES makes THE
     *  ONE READER of `SEA_Y - heightAt`. A harness with its own
     *  subtraction here is a second definition of depth that can
     *  drift from the water shader's. */
    waterDepthAt(x, z) {
      const f = field();
      return f && f.waterDepthAt ? f.waterDepthAt(x, z) : 0;
    },

    tideBandAt(x, z) {
      const f = field();
      return f && f.tideBandAt ? f.tideBandAt(x, z) : null;
    },

    surfaceAt(x, z) {
      const f = field();
      return f && f.surfaceAt ? f.surfaceAt(x, z) : null;
    },

    curvatureAt(x, z) {
      const f = field();
      return f && f.curvatureAt ? f.curvatureAt(x, z) : 0;
    },

    slopeAt(x, z) {
      const f = field();
      if (!f || !f.normalAt) return 0;
      const n = f.normalAt(x, z);
      return Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI;
    },

    /* -------------------------- the pads -------------------------- */

    /**
     * How flat a pad actually is, sampled over its ELLIPSE.
     *
     * A RING-AND-SPOKE sample, not a grid: the failure mode a pad
     * has is a BANK - one side higher than the other - and a grid
     * over a disc puts most of its samples near the middle, where
     * a bank is smallest. Rings weight the rim, which is where
     * the error lives.
     *
     * Sampled on `field.heightAt`, NOT the collider: this asserts
     * that the arena FLOOR is level, and the collider carries
     * every prop rasterised onto it - once the stations are
     * dressed a coral head standing on a flat floor would read as
     * a bump in the ground, which is not a flatness failure.
     *
     * TWO numbers come back and the audit gates on both, because
     * this level's two documents ask for different ones:
     * `p95DevM` is the layout's (deviation from the authored
     * `padY`, which catches a pad that is flat but at the wrong
     * height) and `maxGradePct` is the arena's (how steep it
     * gets, which is what decides whether a fight on it is fair).
     * Spread alone gates neither: a pad carrying 0.55 m of relief
     * over a 64 m wavelength has a 3.4 % worst grade, a twentieth
     * of what the player can walk.
     */
    padFlatness(id, rings = 6, spokes = 24) {
      const s = STATIONS[id];
      const f = field();
      if (!s || !f) return null;
      const A = s.padA || 0;
      const C = s.padC || 0;
      if (A <= 0 || C <= 0) {
        return {
          id, degenerate: true, samples: 0,
          reason: "station has no levelled pad (its arena is architecture)",
          target: s.padY, min: s.padY, max: s.padY, spread: 0, mean: s.padY,
          p95DevM: 0, maxGradePct: 0, offset: 0,
        };
      }
      const b = padBasis(s);
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let n = 0;
      const dev = [];
      for (let r = 0; r <= rings; r += 1) {
        const q = r / rings;
        const steps = r === 0 ? 1 : spokes;
        for (let k = 0; k < steps; k += 1) {
          const a = (k / steps) * TAU;
          const pu = Math.cos(a) * q * A;
          const pv = Math.sin(a) * q * C;
          const x = s.x + b.ux * pu + b.vx * pv;
          const z = s.z + b.uz * pu + b.vz * pv;
          const y = f.heightAt(x, z);
          min = Math.min(min, y);
          max = Math.max(max, y);
          sum += y;
          n += 1;
          dev.push(Math.abs(y - s.padY));
        }
      }
      dev.sort((p, q) => p - q);
      /* GRADE IN REAL METRES, which on an ellipse means the step
         has to be metric rather than parametric: a fixed step in
         normalised space is 6 m along `padC` and 15 m along
         `padA`, and the grade it reports would then depend on
         which way the pad is pointing. */
      let maxGrade = 0;
      let worstAt = null;
      const STEP = 6;
      for (let k = 0; k < spokes; k += 1) {
        const a = (k / spokes) * Math.PI;   // half turn: a spoke is a diameter
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const R = 1 / Math.sqrt((ca / A) * (ca / A) + (sa / C) * (sa / C));
        const dx = b.ux * ca + b.vx * sa;
        const dz = b.uz * ca + b.vz * sa;
        let prev = f.heightAt(s.x - dx * R, s.z - dz * R);
        for (let d = -R + STEP; d <= R; d += STEP) {
          const y = f.heightAt(s.x + dx * d, s.z + dz * d);
          const g = Math.abs(y - prev) / STEP;
          if (g > maxGrade) {
            maxGrade = g;
            worstAt = { x: s.x + dx * d, z: s.z + dz * d };
          }
          prev = y;
        }
      }
      return {
        id, degenerate: false,
        min, max, spread: max - min, mean: sum / n, samples: n,
        target: s.padY, offset: sum / n - s.padY,
        p95DevM: dev[Math.min(dev.length - 1, Math.floor(dev.length * 0.95))],
        maxDevM: dev[dev.length - 1],
        maxGradePct: maxGrade * 100,
        worstAt,
      };
    },
    arenaFlatness(id, rings, spokes) { return atoll.padFlatness(id, rings, spokes); },

    /* ------------------------ the traverse ------------------------ */

    /**
     * The ring circuit's grade, MEASURED ON THE GROUND.
     *
     * `field.circuitGrade()` measures `circuitPointAt(t).y`,
     * which is the marched centreline's DESIGN elevation and is
     * grade-correct by construction - asking it is asking the
     * road whether it agrees with itself. What decides whether a
     * player can walk it is the height of the ground the cut
     * actually left, which is `groundY`. Kenosis shipped the
     * design version first, reported 30.6 % at a place the ground
     * was fine, and went on reporting it through two real fixes.
     *
     * Parameterised by ARC LENGTH, because `circuitPointAt` is:
     * sampling by node index instead would weight the tight
     * corners far more heavily than the long beaches and report a
     * mean that belongs to no part of the route.
     */
    circuitGrade(samples = 900) {
      const f = field();
      if (!f || !f.circuitPointAt) return null;
      let max = 0;
      let sum = 0;
      let n = 0;
      let worstAt = null;
      const histogram = new Array(26).fill(0);
      let prev = f.circuitPointAt(0);
      let prevY = groundY(prev.x, prev.z);
      for (let i = 1; i <= samples; i += 1) {
        const t = i / samples;
        const p = f.circuitPointAt(t);
        const y = groundY(p.x, p.z);
        const run = Math.hypot(p.x - prev.x, p.z - prev.z);
        if (run > 1e-6) {
          const g = Math.abs(y - prevY) / run;
          sum += g;
          n += 1;
          if (g > max) { max = g; worstAt = { x: p.x, z: p.z, t }; }
          histogram[clamp(Math.floor(g * 100), 0, 25)] += 1;
        }
        prev = p;
        prevY = y;
      }
      const mean = n ? sum / n : 0;
      return {
        max, mean, maxPct: max * 100, meanPct: mean * 100,
        histogram, worstAt, length: f.circuitLength || null,
        samples: n, source: "ground (collide.groundHeight)",
      };
    },
    routeGrade(samples) { return atoll.circuitGrade(samples); },

    /** The field's own answer, for comparison only. If this and
     *  `circuitGrade()` disagree the CUT is wrong, not the route:
     *  the design says one thing and the ground the build left
     *  says another. */
    circuitDesignGrade(samples = 900) {
      const f = field();
      return f && f.circuitGrade ? f.circuitGrade(samples) : null;
    },

    /**
     * The Cauldron's helical shelf - the level's signature climb.
     *
     * 1.5 turns from the Weeping Steps breach at (d ~ 150, y 74)
     * to the rim at (d ~ 90, y 214): 140 m of rise over about
     * 1130 m of path. Measured exactly as the circuit is, on the
     * GROUND and by arc length.
     *
     * Returns null until atoll-terrain publishes `cauldronRoad`
     * (TERRAIN-TODO T2). That is a SKIP in the audit, not a pass:
     * a level whose one peak needs a jetpack has made the jetpack
     * mandatory, and until the shelf exists the gate has nothing
     * to measure rather than something that measures fine.
     */
    cauldronRoadGrade(samples = 600) {
      const f = field();
      const road = f && f.cauldronRoad;
      if (!road) return null;
      const pointAt = road.pointAt
        || (road.points && ((t) => {
          const pts = road.points;
          const u = clamp01(t) * (pts.length - 1);
          const i = Math.min(pts.length - 2, Math.floor(u));
          const k = u - i;
          const a = pts[i];
          const b = pts[i + 1];
          const ax = a.x !== undefined ? a.x : a[0];
          const az = a.z !== undefined ? a.z : a[1];
          const bx = b.x !== undefined ? b.x : b[0];
          const bz = b.z !== undefined ? b.z : b[1];
          return { x: lerp(ax, bx, k), z: lerp(az, bz, k) };
        }));
      if (!pointAt) return null;
      let max = 0;
      let sum = 0;
      let n = 0;
      let worstAt = null;
      let prev = pointAt(0);
      let prevY = groundY(prev.x, prev.z);
      let length = 0;
      for (let i = 1; i <= samples; i += 1) {
        const p = pointAt(i / samples);
        const y = groundY(p.x, p.z);
        const run = Math.hypot(p.x - prev.x, p.z - prev.z);
        length += run;
        if (run > 1e-6) {
          const g = Math.abs(y - prevY) / run;
          sum += g;
          n += 1;
          if (g > max) { max = g; worstAt = { x: p.x, z: p.z }; }
        }
        prev = p;
        prevY = y;
      }
      const mean = n ? sum / n : 0;
      return {
        max, mean, maxPct: max * 100, meanPct: mean * 100,
        worstAt, length: road.length || length, samples: n,
        source: "ground (collide.groundHeight)",
      };
    },

    /** The circuit's own centreline, so anything that wants to
     *  follow the route the level intends can, rather than a
     *  straight line across the lagoon. */
    circuitPath(stride = 12) {
      const f = field();
      if (!f || !f.circuitPointAt) return [];
      const n = Math.max(8, Math.round((f.circuitLength || 4800) / stride));
      const out = [];
      for (let i = 0; i <= n; i += 1) {
        const p = f.circuitPointAt(i / n);
        out.push([p.x, p.z]);
      }
      return out;
    },

    /** The route `reachable` will actually walk, published so a
     *  failure can be read rather than guessed at. */
    routeFor(id, stepLen = 2.0) {
      const s = STATIONS[id];
      const f = field();
      if (!s || !f) return null;
      if (id === "landing") return { id, via: "spawn", points: [[LANDING.x, LANDING.z]] };

      const t0 = circuitTNear(LANDING.x, LANDING.z);
      const t1 = circuitTNear(s.x, s.z);
      if (!t0 || !t1) return null;
      const points = circuitLeg(t0.t, t1.t, stepLen);
      let via = "circuit";

      /* THE TAIL. Four cases, in priority order, and each one
         exists because the straight line is wrong for it:

         1. an authored spur, walked VERBATIM - a spur that is
            deliberately bowed clear of an obstacle would be
            marched straight through it by a reconstruction;
         2. the Cauldron's helical shelf, which is 1130 m of path
            for 64 m of horizontal run and which no straight leg
            can stand in for;
         3. the Spine, for the Hold - the Hold is 700 m out over
            eight metres of lagoon and the only floor is the ship;
         4. otherwise a straight leg, stopping at the PAD EDGE
            rather than the pad centre. Kenosis's version marched
            to the centre and reported its terminal station
            unreachable by walking into the apse wall: arriving
            on the pad is arriving, and going inside a building
            has its own approach. */
      const spur = f.spurs && (Array.isArray(f.spurs)
        ? f.spurs.find((sp) => sp && sp.id === id)
        : f.spurs[id]);
      if (spur && spur.points && spur.points.length > 1) {
        via = "spur";
        for (const pt of spur.points) {
          points.push([pt.x !== undefined ? pt.x : pt[0], pt.z !== undefined ? pt.z : pt[1]]);
        }
      } else if (id === "cauldron" && f.cauldronRoad) {
        via = "cauldron-road";
        const road = f.cauldronRoad;
        const n = Math.max(8, Math.round((road.length || 1130) / stepLen));
        for (let i = 0; i <= n; i += 1) {
          const p = road.pointAt ? road.pointAt(i / n) : null;
          if (p) points.push([p.x, p.z]);
        }
      } else if (id === "hold" && api && api.world && api.world.spinePath) {
        via = "spine";
        for (const pt of api.world.spinePath) {
          points.push([pt.x !== undefined ? pt.x : pt[0], pt.z !== undefined ? pt.z : pt[1]]);
        }
      } else {
        via = "leg-to-pad-edge";
        const from = points[points.length - 1] || [LANDING.x, LANDING.z];
        const dx = s.x - from[0];
        const dz = s.z - from[1];
        const len = Math.hypot(dx, dz) || 1;
        const stop = Math.max(0, len - Math.max(0, Math.min(s.padA || 0, s.padC || 0)) * 0.9);
        const legs = Math.max(2, Math.round(stop / stepLen));
        for (let i = 1; i <= legs; i += 1) {
          const t = (i / legs) * (stop / len);
          points.push([from[0] + dx * t, from[1] + dz * t]);
        }
      }
      return { id, via, points, circuitT: [t0.t, t1.t], offRouteM: t0.distance };
    },

    /**
     * Can the walk solver get from the LANDING to a station?
     *
     * A GREEDY MARCH ALONG THE ROUTE, not a flood fill. The
     * question is not "is there any path" - on an open atoll
     * there almost always is, the long way round the ring, in
     * twenty minutes - it is "does the route the level was
     * designed around work". So it walks the circuit to the
     * station's own tail and tests the PLAYER'S OWN slope rule at
     * every step, and reports where it first cannot continue.
     *
     * The wade rule is applied on top, because on this level the
     * ground being walkable is not sufficient: half the circuit
     * is beach and a step into 1.4 m of water is a step the
     * player cannot take. `WADE_MAX` comes from atoll-terrain,
     * not from a number typed here.
     */
    reachable(id, stepLen = 2.0) {
      const route = atoll.routeFor(id, stepLen);
      if (!route) return null;
      if (route.via === "spawn") {
        return { id, reachable: true, steps: 0, blockedAt: null, maxSlopeDeg: 0, maxDepthM: 0, via: "spawn" };
      }
      const pts = route.points;
      let maxSlope = 0;
      let maxDepth = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const [ax, az] = pts[i - 1];
        const [bx, bz] = pts[i];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const ux = dx / len;
        const uz = dz / len;
        const rise = groundY(bx, bz) - groundY(ax, az);
        maxSlope = Math.max(maxSlope, Math.atan2(Math.abs(rise), len) * 180 / Math.PI);
        const depth = atoll.waterDepthAt(bx, bz);
        maxDepth = Math.max(maxDepth, depth);
        if (depth > WADE_MAX || !walkable(ax, az, ux, uz)) {
          return {
            id, reachable: false, steps: i, blockedAt: { x: bx, z: bz },
            reason: depth > WADE_MAX ? `water ${depth.toFixed(2)}m (wade cap ${WADE_MAX})` : "slope",
            maxSlopeDeg: maxSlope, maxDepthM: maxDepth, via: route.via,
          };
        }
      }
      return {
        id, reachable: true, steps: pts.length, blockedAt: null,
        maxSlopeDeg: maxSlope, maxDepthM: maxDepth, via: route.via,
      };
    },
    reachability(id, stepLen) { return atoll.reachable(id, stepLen); },

    /* -------------------------- the island -------------------------- */

    /**
     * The elevation profile along a compass bearing.
     *
     * `authored` is `atollProfile(r - dR)`, not `atollProfile(r)`:
     * the ring-radius warp means a feature at profile radius `rp`
     * appears at world radius `rp + dR`, and a profile check that
     * forgets it reports up to 34 m of error on a build that is
     * exactly right.
     *
     * THE PROFILE DOES NOT DESCRIBE THE CAULDRON, and every sample
     * inside the plug's base carries `cauldron: true` so a caller
     * can drop it. The plug is a separate feature stacked on top
     * of the radial table - it rises 214 m out of a profile that
     * reads -6 m there - so a profile error computed over it
     * reports 216 m on a build that is exactly right, which is
     * the profile check disqualifying itself.
     */
    profileScan(bearingDeg = 0, samples = 64) {
      const [ux, uz] = bearingUnit(bearingDeg);
      const dR = ringWarpAt(Math.atan2(ux, -uz));
      const f = field();
      const C = f && f.cauldron;
      const out = [];
      for (let i = 0; i <= samples; i += 1) {
        const r = (i / samples) * (MAP_HALF - 8);
        const x = ux * r;
        const z = uz * r;
        out.push({
          r, x, z,
          y: atoll.terrainAt(x, z),
          authored: atollProfileAt(r - dR),
          dR,
          cauldron: !!(C && Math.hypot(x - C.x, z - C.z) < (C.baseR || 262)),
        });
      }
      return out;
    },

    profileError(bearings = [0, 45, 90, 135, 180, 225, 270, 315], samples = 48) {
      let worst = 0;
      let at = null;
      let sum = 0;
      let n = 0;
      let skipped = 0;
      for (const b of bearings) {
        for (const p of atoll.profileScan(b, samples)) {
          if (p.cauldron) { skipped += 1; continue; }
          const e = Math.abs(p.y - p.authored);
          sum += e;
          n += 1;
          if (e > worst) { worst = e; at = { bearing: b, r: p.r, y: p.y, authored: p.authored }; }
        }
      }
      return { worst, mean: n ? sum / n : 0, at, samples: n, skippedInCauldron: skipped };
    },

    /**
     * The reef crest and the reef flat, on every bearing.
     *
     * This is the level's silhouette gate. The crest is what
     * makes the lagoon a lagoon: a ring of ground standing 0.6 m
     * proud of a flat 0.4 m under water is where the surf breaks,
     * where the spray field is anchored and where the turquoise
     * stops. Flatten it and the level is a disc with a colour
     * change on it.
     *
     * Searched in WORLD radius over the band the profile places
     * it in plus that bearing's warp, and the warp is reported so
     * a failure can be told apart from a mis-sited search.
     */
    reefProfile(bearings = 24) {
      const rows = [];
      for (let i = 0; i < bearings; i += 1) {
        const compass = (i / bearings) * 360;
        const [ux, uz] = bearingUnit(compass);
        const dR = ringWarpAt(Math.atan2(ux, -uz));
        let crestY = -Infinity;
        let crestR = 0;
        for (let r = REEF_CREST_SEARCH[0] + dR; r <= REEF_CREST_SEARCH[1] + dR; r += 1) {
          const y = atoll.terrainAt(ux * r, uz * r);
          if (y > crestY) { crestY = y; crestR = r; }
        }
        let sum = 0;
        let n = 0;
        for (let r = REEF_FLAT_BAND[0] + dR; r <= REEF_FLAT_BAND[1] + dR; r += 2) {
          sum += atoll.terrainAt(ux * r, uz * r);
          n += 1;
        }
        rows.push({ compass, dR, crestY, crestR, flatY: n ? sum / n : 0 });
      }
      const crests = rows.map((r) => r.crestY);
      const flats = rows.map((r) => r.flatY);
      return {
        rows,
        crestMin: Math.min(...crests), crestMax: Math.max(...crests),
        flatMin: Math.min(...flats), flatMax: Math.max(...flats),
        bearings,
      };
    },

    /** The ring-radius warp itself. The whole feature set is
     *  placed at `profile radius + dR`, and the reef crest at
     *  1006 fell off the 1024 m chunk grid once already because
     *  the warp summed to 58 m. */
    ringWarp() {
      const f = field();
      if (!f || !f.bands || !f.bands.ringR) return null;
      const band = f.bands.ringR;
      let max = 0;
      let sum = 0;
      let atIdx = 0;
      for (let i = 0; i < band.length; i += 1) {
        const v = Math.abs(band[i]);
        if (v > max) { max = v; atIdx = i; }
        sum += v;
      }
      return {
        maxAbsM: max, meanAbsM: sum / band.length,
        atCompassDeg: (atIdx / band.length) * 360,
        samples: band.length,
      };
    },

    /** The lagoon floor's depth, over a deterministic golden-angle
     *  spiral inside `r`. Deterministic on purpose: a probe seeded
     *  from Math.random reports a different number every run and
     *  a gate that moves is a gate nobody trusts. */
    lagoonDepth(r = 430, samples = 1200) {
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (let i = 0; i < samples; i += 1) {
        const rad = Math.sqrt((i + 0.5) / samples) * r;
        const a = i * GOLDEN;
        const d = atoll.waterDepthAt(Math.cos(a) * rad, Math.sin(a) * rad);
        min = Math.min(min, d);
        max = Math.max(max, d);
        sum += d;
      }
      return { r, samples, minM: min, maxM: max, meanM: sum / samples };
    },

    /** `heightAt` must be TOTAL and FINITE - including well off
     *  the map, where the sky's shoreline solver and the water's
     *  apron both sample it. One NaN out here becomes a NaN
     *  vertex, and one NaN vertex kills the whole bloom pass. */
    finiteProbe(points = [[4000, 4000], [-5000, 120], [0, 0], [1e6, -1e6], [MAP_HALF, MAP_HALF]]) {
      const f = field();
      return points.map(([x, z]) => {
        const y = f ? f.heightAt(x, z) : NaN;
        const d = atoll.waterDepthAt(x, z);
        return { x, z, y, depth: d, finite: Number.isFinite(y) && Number.isFinite(d) };
      });
    },

    /* --------------------------- the sea --------------------------- */

    waterStats() {
      return ctx.water && ctx.water.stats ? ctx.water.stats() : null;
    },
    waterState() { return atoll.waterStats(); },

    /** The baked seabed's answer against the field's, at a point.
     *  `filtered` is the GPU's value (per-channel bilinear, then
     *  decode) and `nearest` is the bake's own accuracy with the
     *  filter taken out - see `seabedSample`. */
    seabedProbe(x, z) {
      const s = seabedSample(x, z);
      if (!s) return null;
      const truth = atoll.terrainAt(x, z);
      return {
        x, z,
        baked: s.filtered,
        bakedNearest: s.nearest,
        field: truth,
        errorM: s.filtered - truth,
        nearestErrorM: s.nearest - truth,
        /* How much of the error is the 16-bit pair's low byte
           wrapping under a linear filter rather than the bake
           being coarse. */
        wrapRiskM: Math.abs(s.filtered - s.nearest),
        metresPerTexel: s.metresPerTexel,
        texture: { width: s.width, height: s.height, channels: s.channels },
      };
    },

    /**
     * WHERE THE FOAM LINE ACTUALLY IS, versus where the ground is.
     *
     * The water shader draws foam where its sampled depth crosses
     * zero. That sample comes from a texture at 2 m per texel, so
     * the drawn waterline sits at a slightly different RADIUS from
     * the real one - and a horizontal error is what the eye sees,
     * not a vertical one: 30 cm of height error on a 1-in-40 reef
     * flat is twelve metres of misplaced foam.
     *
     * So both sides are marched the SAME way, outward along a
     * bearing at 1 m steps, looking for the first crossing of the
     * target height. Only the height source differs, which is what
     * isolates the bake's contribution.
     *
     * ILL-CONDITIONED BEARINGS ARE REPORTED, NOT AVERAGED IN.
     * Where the reef flat lies within a few centimetres of the
     * datum over a long stretch, a 5 cm bake error moves the
     * crossing by a HUNDRED METRES - and that is a true statement
     * about the level rather than a fault in the bake. Measured
     * on the first pass it made the gate read 166 m and blamed
     * the texture. So the local gradient at the crossing is taken
     * too, and a bearing whose ground falls slower than 1 cm per
     * metre is counted separately: the finding there is "the
     * waterline is unstable on this bearing", which is a terrain
     * note, and the bake's own error is reported as a HEIGHT
     * instead, where it is always well defined.
     */
    foamLineError(bearings = 72, depthM = 0, minGrade = 0.01) {
      if (!seabedSample(0, 0)) return null;
      const targetY = SEA_Y - depthM;
      const rows = [];
      const unstable = [];
      /* Bearings where the two readers do not even agree on HOW
         MANY times the ground crosses the datum. Reported as a
         count of its own - see the crossings note below. */
      const topology = [];
      /* MARCHED FROM THE OUTSIDE IN, over the OUTER LIMB only.
         The profile is not monotonic in r - it rises to the berm
         and falls again to the reef - so a bearing has TWO
         waterlines, the lagoon beach and the ocean shore, and an
         outward march from the lagoon finds whichever comes
         first. The first version did exactly that, found the
         inner beach on one reader and the outer shore on the
         other, and reported 166 m of bake error on a bake that
         was accurate to a metre. The surf, the spray field and
         the foam band are all on the OCEAN side, so the
         outermost crossing is the one that matters, and the
         bracket is the same 786..1010 that `shoreRadiusFor` uses
         for the sky's shoreline. */
      /* EVERY crossing, not the first one. The two readers must be
         compared LIKE WITH LIKE, and marching each independently
         to its first crossing does not do that.

         MEASURED, on compass 190, which is the bearing this gate
         reported 21.79 m on for two rounds:

           field crossings   1009.52, 986.74, 937.64
           baked crossings            987.67, 939.06

         Three features against two. The outermost is a sliver of
         ground that breaks the datum at r = 1009.5 and is gone
         again by 1008; a 2 m texel averages it away, and the bake
         simply has no crossing there. The old march then measured
         the field's 1009.52 against the bake's 987.67 and called
         the 21.85 m BETWEEN TWO DIFFERENT FEATURES a bake error.

         It is not one. The bake's height error at that crossing is
         12.7 cm against 11.1-11.7 cm on all 69 other bearings, and
         the local grade there is 0.1531 against 0.1527-0.1536 - so
         height/grade predicts 0.83 m, which is exactly what every
         other bearing reports. Neither a precision problem nor a
         statistic: a topology mismatch, and it is counted as one.

         Compass 185, one step away, has all three crossings in
         both readers (1009.19/986.55/937.43 against
         1009.97/987.48/938.88) and reads 0.84 m. */
      const crossings = (ux, uz, read) => {
        const out = [];
        let prevR = 1010;
        let prevY = read(ux * prevR, uz * prevR);
        for (let r = 1008; r >= 786; r -= 1) {
          const y = read(ux * r, uz * r);
          if ((prevY - targetY) * (y - targetY) <= 0 && prevY !== y) {
            /* Linear crossing inside the metre, so the answer is
               not quantised to the march step - a 1 m quantisation
               against a 1.2 m gate would be most of the budget. */
            const t = (targetY - prevY) / (y - prevY);
            out.push(prevR + t * (r - prevR));
          }
          prevR = r;
          prevY = y;
        }
        return out;
      };
      for (let i = 0; i < bearings; i += 1) {
        const compass = (i / bearings) * 360;
        const [ux, uz] = bearingUnit(compass);
        const csField = crossings(ux, uz, (x, z) => atoll.terrainAt(x, z));
        const csBaked = crossings(ux, uz, (x, z) => {
          const s = seabedSample(x, z);
          return s ? s.filtered : NaN;
        });
        if (!csField.length || !csBaked.length) continue;
        /* The OUTERMOST field crossing is still the one that
           matters - the surf, the spray field and the foam band
           are all on the ocean side - but it is measured against
           the NEAREST baked crossing, so a missing or an extra
           feature shows up as a topology count and not as tens of
           metres of imaginary error. */
        const rField = csField[0];
        let rBaked = csBaked[0];
        for (const c of csBaked) {
          if (Math.abs(c - rField) < Math.abs(rBaked - rField)) rBaked = c;
        }
        if (!Number.isFinite(rBaked)) continue;
        if (csField.length !== csBaked.length) {
          /* AND IT IS EXCLUDED FROM THE METRES, for the same
             reason an ill-conditioned bearing is: there is no
             corresponding feature in the bake to measure a
             distance to, so any number here is the gap to a
             DIFFERENT feature. The count is the finding, and the
             audit gates on the count as well as on the metres -
             one marginal sliver in 72 bearings is a 2 m texel
             doing its job; a fifth of them would be a bake that
             cannot hold the shoreline. */
          topology.push({ compass, field: csField.length, baked: csBaked.length });
          continue;
        }
        /* The height error at the crossing, which is the bake's
           own accuracy and does not depend on the conditioning. */
        const probe = seabedSample(ux * rField, uz * rField);
        const heightErrorM = probe
          ? Math.abs(probe.filtered - atoll.terrainAt(ux * rField, uz * rField)) : 0;
        const grade = Math.abs(
          atoll.terrainAt(ux * (rField + 8), uz * (rField + 8))
          - atoll.terrainAt(ux * (rField - 8), uz * (rField - 8))) / 16;
        const row = {
          compass, rField, rBaked, grade, heightErrorM,
          errorM: Math.abs(rBaked - rField),
        };
        if (grade < minGrade) unstable.push(row); else rows.push(row);
      }
      if (!rows.length && !unstable.length) return null;
      let worst = rows[0] || null;
      let sum = 0;
      for (const r of rows) {
        sum += r.errorM;
        if (r.errorM > worst.errorM) worst = r;
      }
      const heights = rows.concat(unstable).map((r) => r.heightErrorM);
      return {
        bearings: rows.length + unstable.length,
        measured: rows.length,
        illConditioned: unstable.length,
        minGrade, depthM,
        worstM: worst ? worst.errorM : null,
        worstAt: worst ? worst.compass : null,
        meanM: rows.length ? sum / rows.length : null,
        worstHeightErrorM: heights.length ? Math.max(...heights) : null,
        rows: rows.slice().sort((a, b) => b.errorM - a.errorM).slice(0, 8),
        unstableAt: unstable.map((r) => Math.round(r.compass)).slice(0, 12),
        topologyMismatch: topology.length,
        topologyAt: topology.map((r) => `${Math.round(r.compass)}(${r.field}v${r.baked})`).slice(0, 12),
      };
    },

    /**
     * Does `water.surfaceYAt` agree with the surface that is DRAWN?
     *
     * It has to, to about 5 cm, or a floating crate sits in the
     * air and a wading player's waterline is on their knees in one
     * frame and their chest in the next. But the displacement is a
     * vertex shader, and JavaScript cannot run it - so there are
     * only two honest ways to measure this, and the mode is
     * reported so nobody mistakes one for the other:
     *
     *   "mirror"   - atoll-water publishes `shaderSurfaceYAt`, a
     *                CPU mirror of the exact GLSL. This is the
     *                real test, and the water module owes it.
     *   "geometry" - the mesh's own vertices carry the
     *                displacement (a CPU-displaced surface), so
     *                they can be compared directly.
     *
     * A flat plane with a GPU displacement reports
     * `supported: false` with `mode: "gpu-only"`, which is a SKIP
     * rather than a pass: an unmeasurable agreement is not an
     * agreement.
     */
    waterSurfaceAgreement(samples = 240) {
      const w = ctx.water;
      if (!w || !w.surfaceYAt) return { supported: false, reason: "no water module" };
      const t = (ctx.atmos && ctx.atmos.elapsed) || 0;
      const pts = [];
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < samples; i += 1) {
        const rad = Math.sqrt((i + 0.5) / samples) * 900;
        const a = i * GOLDEN;
        pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
      }
      if (w.shaderSurfaceYAt) {
        let worst = 0;
        let sum = 0;
        let at = null;
        for (const [x, z] of pts) {
          const e = Math.abs(w.surfaceYAt(x, z, t) - w.shaderSurfaceYAt(x, z, t));
          sum += e;
          if (e > worst) { worst = e; at = { x, z }; }
        }
        return {
          supported: true, mode: "mirror", samples: pts.length,
          worstM: worst, meanM: sum / pts.length, at,
        };
      }
      const mesh = w.mesh;
      const pos = mesh && mesh.geometry && mesh.geometry.attributes
        && mesh.geometry.attributes.position;
      if (!pos || !pos.count) {
        return { supported: false, mode: "gpu-only", reason: "no shader mirror and no mesh geometry" };
      }
      mesh.updateWorldMatrix(true, false);
      const m = mesh.matrixWorld.elements;
      let worst = 0;
      let sum = 0;
      let n = 0;
      let at = null;
      let flat = true;
      let firstY = null;
      const stride = Math.max(1, Math.floor(pos.count / samples));
      for (let i = 0; i < pos.count; i += stride) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        if (firstY === null) firstY = vy;
        else if (Math.abs(vy - firstY) > 1e-4) flat = false;
        const wx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
        const wy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
        const wz = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
        if (Math.hypot(wx, wz) > 1400) continue;
        const e = Math.abs(wy - w.surfaceYAt(wx, wz, t));
        sum += e;
        n += 1;
        if (e > worst) { worst = e; at = { x: wx, z: wz }; }
      }
      if (flat) {
        return {
          supported: false, mode: "gpu-only",
          reason: "the water mesh is an undisplaced plane - the swell is a vertex shader"
            + " and atoll-water publishes no shaderSurfaceYAt mirror",
        };
      }
      return {
        supported: true, mode: "geometry", samples: n,
        worstM: worst, meanM: n ? sum / n : 0, at,
      };
    },

    /**
     * Is deep water a BOUNDARY or a traversal space?
     *
     * The player may stand in `WADE_MAX` of water and there is no
     * swim state in this engine, so the seabed must not offer a
     * walkable shelf past that depth - and past it the slope has
     * to beat the walk limit, or the player simply strolls out to
     * sea until the square map clamp stops them.
     */
    wadeProfile(bearings = 36) {
      const violations = [];
      let deepest = 0;
      let deepestAt = null;
      for (let i = 0; i < bearings; i += 1) {
        const compass = (i / bearings) * 360;
        const [ux, uz] = bearingUnit(compass);
        /* March OUTWARD from the reef flat, which is where the
           only walkable shallow water on this level is. */
        let prevY = atoll.terrainAt(ux * 900, uz * 900);
        for (let r = 902; r <= 1010; r += 2) {
          const x = ux * r;
          const z = uz * r;
          const y = atoll.terrainAt(x, z);
          const depth = atoll.waterDepthAt(x, z);
          const grade = Math.abs(y - prevY) / 2;
          if (depth > 0.01 && depth <= WADE_CAP && depth > deepest) {
            deepest = depth;
            deepestAt = { compass, r };
          }
          if (depth > WADE_CAP && grade < WALK_SLOPE_LIMIT && depth < WADE_CAP + 0.6) {
            /* Just past the cap AND gentle: this is the shape
               that lets a player wander out. Deeper than that and
               the depth itself stops them. */
            violations.push({ compass, r, depth, grade });
          }
          prevY = y;
        }
      }
      return {
        bearings, capM: WADE_CAP, walkLimit: WALK_SLOPE_LIMIT,
        deepestWalkableM: deepest, at: deepestAt,
        violations: violations.slice(0, 12), violationCount: violations.length,
      };
    },

    /* ------------------------- the dressing ------------------------- */

    /**
     * EVERY PROP THAT DOES NOT TOUCH THE GROUND.
     *
     * A 30 cm gap under a crate is invisible from the air,
     * obvious at eye level, and there are thousands of props, so
     * it is measured rather than looked for. Every copy of every
     * prop is walked in world space and its vertices compared
     * against the terrain beneath them; what matters is the
     * MINIMUM gap over the copy, because a prop is bedded if ANY
     * part of it is in the ground.
     *
     * IT READS instanceMatrix, AND THE VERSION THAT DID NOT WAS
     * WORSE THAN NO GATE AT ALL. Round 3 shipped a frame with
     * dozens of pale ellipses apparently lying on the open ocean
     * while this gate reported a clean sweep, and that is the
     * second time in one session an instrument agreed with itself
     * instead of with the world. The reason: 54 of this level's
     * 164 world meshes are InstancedMesh - every one of the 20000
     * flora copies - and walking `geometry.attributes.position`
     * through `mesh.matrixWorld` measures the PROTOTYPE AT THE
     * ORIGIN, once, for all of them. The whole vegetation layer
     * was invisible to the gate and the three rows it did print
     * were the prototype's own local coordinates, which is why
     * every flora row landed within five metres of (0, 0).
     *
     * ON THIS LEVEL THE SEA IS ALSO A FLOOR: a mooring buoy, a
     * raft of flotsam or a hull plate afloat in the lagoon is
     * correctly floating and is not a fault. But the exemption is
     * now GATED ON THERE BEING SEA UNDER IT - the ground beneath
     * the low point has to be below the waterline - because
     * "anything whose lowest point is near y = 0" exempts most of
     * the dressing on an atoll whose whole ring sits within a
     * metre of the tide, and an exemption that wide is how a gate
     * comes to pass while the defect is on screen.
     *
     * WHAT IT DOES NOT MEASURE, said out loud so nobody reads
     * this gate as covering it:
     *   - the wreck and everything standing on the wreck. The
     *     Antiphon is a broken hull resting on its own structure
     *     and the Roost's crates are bedded on a rib deck fifty
     *     metres up. Their bedding reference is the collider's
     *     solid top, not the landform, and measuring them against
     *     the landform produces an 83 m "fault" that is not one.
     *   - epiphytes, which grow on trunks by definition.
     *   - a plant's CANOPY, when its trunk is a separate mesh.
     *     The gate pairs `-leaf-` with `-wood-` by name and by
     *     instance index and judges the plant by the part that
     *     reaches the ground; a palm crown six metres up is not a
     *     floating prop. A leaf-only species (groundfern,
     *     ipomoea) has no trunk to pair with and is judged on its
     *     own leaves, which is correct - those DO touch.
     * Each of those is counted and returned, so the exclusions
     * cannot hide anything either.
     */
    floatingProps(gapM = 0.12, stride = 7) {
      const world = api && api.world;
      const f = field();
      if (!world || !world.meshes || !f) return null;
      const THREE = ctx.THREE;
      const rows = [];
      let afloat = 0;
      let notLandform = 0;
      let paired = 0;
      let copies = 0;

      /* Per-copy vertex budget. 20000 instances at the merged
         meshes' stride would be nine million heightAt calls and a
         probe that times out; twelve samples per copy over a
         prop that is only ever a few metres across finds a
         floating one every time, because a prop that floats
         floats at every vertex. Merged (non-instanced) meshes
         keep the caller's stride - they are one copy each. */
      const INSTANCE_VERTS = 12;

      const mInst = THREE ? new THREE.Matrix4() : null;
      const mWorld = THREE ? new THREE.Matrix4() : null;

      /** The lowest point of one copy, and the gap under it. */
      const measure = (pos, e, vstride) => {
        let minGap = Infinity;
        let atX = 0; let atZ = 0; let atY = 0; let n = 0;
        for (let i = 0; i < pos.count; i += vstride) {
          const vx = pos.getX(i);
          const vy = pos.getY(i);
          const vz = pos.getZ(i);
          /* World transform by hand - a Vector3 per vertex over a
             million vertices is the difference between a probe
             that runs and one that times out. */
          const wx = e[0] * vx + e[4] * vy + e[8] * vz + e[12];
          const wy = e[1] * vx + e[5] * vy + e[9] * vz + e[13];
          const wz = e[2] * vx + e[6] * vy + e[10] * vz + e[14];
          const gap = wy - f.heightAt(wx, wz);
          if (gap < minGap) { minGap = gap; atX = wx; atZ = wz; atY = wy; }
          n += 1;
        }
        return n && Number.isFinite(minGap) ? { minGap, atX, atZ, atY, n } : null;
      };

      /* The trunk that belongs to a canopy, by name. The bins are
         named flora-SPECIES-MATERIAL-lN-lN[-vK] and the wood and
         leaf meshes of one species and LOD carry the SAME
         instance list in the same order, so instance k of the
         crown is instance k of the trunk. */
      const byName = new Map();
      for (const mesh of world.meshes) byName.set(mesh.name || "", mesh);
      const trunkFor = (name) => (BEDDED_CANOPY_RE.test(name)
        ? byName.get(name.replace("-leaf-", "-wood-")) || null
        : null);

      for (const mesh of world.meshes) {
        const pos = mesh.geometry && mesh.geometry.attributes
          && mesh.geometry.attributes.position;
        if (!pos || !pos.count) continue;
        const name = mesh.name || "";
        if (BULK_MESH_RE.test(name)) continue;
        if (BEDDED_SKIP_RE.test(name)) { notLandform += 1; continue; }
        const trunk = trunkFor(name);
        const trunkPos = trunk && trunk.geometry && trunk.geometry.attributes
          ? trunk.geometry.attributes.position : null;
        if (trunk && trunkPos && trunk.count === mesh.count) { paired += 1; continue; }

        mesh.updateWorldMatrix(true, false);

        /* One pass over the copies. A merged mesh is one copy at
           its own matrix; an InstancedMesh is `count` copies at
           matrixWorld * instanceMatrix[k]. */
        const instanced = !!(mesh.isInstancedMesh && mesh.instanceMatrix && mInst);
        const copyCount = instanced ? mesh.count : 1;
        const vstride = instanced
          ? Math.max(1, Math.ceil(pos.count / INSTANCE_VERTS))
          : stride;
        let worst = null;
        let worstK = -1;
        for (let k = 0; k < copyCount; k += 1) {
          let e;
          if (instanced) {
            mesh.getMatrixAt(k, mInst);
            mWorld.multiplyMatrices(mesh.matrixWorld, mInst);
            e = mWorld.elements;
          } else {
            e = mesh.matrixWorld.elements;
          }
          const r = measure(pos, e, vstride);
          if (!r) continue;
          copies += 1;
          /* AFLOAT ONLY IF THERE IS SEA UNDER IT. The ground at
             the low point is atY - minGap, and it has to be below
             the waterline for "it is floating on the sea" to be
             the explanation. */
          const bedY = r.atY - r.minGap;
          if (bedY < SEA_Y - 0.05 && Math.abs(r.atY - SEA_Y) <= TIDE.range) {
            afloat += 1;
            continue;
          }
          if (r.minGap > gapM && (!worst || r.minGap > worst.minGap)) {
            worst = r;
            worstK = k;
          }
        }
        if (worst) {
          rows.push({
            name, gap: worst.minGap, x: worst.atX, z: worst.atZ,
            samples: worst.n, copies: copyCount,
            instance: instanced ? worstK : undefined,
            station: mesh.userData && mesh.userData.station,
          });
        }
      }
      rows.sort((a, b) => b.gap - a.gap);
      return {
        gapM,
        floating: rows.length,
        afloat,
        notLandform,
        paired,
        copies,
        meshes: world.meshes.length,
        rows: rows.slice(0, 40),
      };
    },

    /**
     * Distance to the nearest world prop within `r` of (x, z), or
     * null. `saintfall-shots.mjs:591` uses it to prefer standing
     * points that put something in the near field - composition is
     * the widest measured axis gap against Vesper and "no
     * foreground element" is the most repeated note in the review
     * log. It is published on the TOP LEVEL of the hook as well as
     * here, because the shots harness reads `T.nearestPropWithin`
     * and the summit only ever published `T.summit.
     * nearestPropWithin`, so the term has been silently zero in
     * every blind round ever run.
     *
     * Batched meshes are measured by their bounding-sphere
     * centres, which is coarse but is the right granularity for
     * "is there something over there".
     */
    nearestPropWithin(x, z, r = 30) {
      const scene = (api && api.render && api.render.scene) || ctx.scene;
      if (!scene) return null;
      let best = null;
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.visible) return;
        if (BULK_MESH_RE.test(o.name || "")) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const bs = o.geometry.boundingSphere;
        if (!bs) return;
        /* CLAMPED AT ZERO, not rejected below it. The summit's
           version discards a sphere the query point is INSIDE,
           which is the case for every batched mesh big enough to
           matter - so standing in the middle of the Bone Reef's
           coral bin, with a foreground element in every direction,
           it reported "no prop within 30 m". A point inside a
           prop's bounds is a prop at zero metres. */
        const d = Math.max(0, Math.hypot(bs.center.x - x, bs.center.z - z) - bs.radius);
        if (d <= r && (best === null || d < best)) best = d;
      });
      return best;
    },

    /**
     * Can the player walk the wreck's interior?
     *
     * The one thing this level has that neither predecessor does:
     * an enterable hull. `cameraClearance` already covers the
     * camera; this covers the FIGURE. Reads
     * `world.wreckDecks` - `[{ id, points: [[x, z], ...],
     * headroom? }]` - and marches each deck polygon with the same
     * walk rule everything else uses, then measures headroom
     * against the collider's solid top.
     *
     * Returns null until atoll-structures publishes its decks.
     */
    wreckInterior(stepLen = 1.5) {
      const w = api && api.world;
      const decks = w && w.wreckDecks;
      if (!decks || !decks.length) return null;
      const rows = [];
      let minHead = Infinity;
      const blocked = [];
      for (const deck of decks) {
        const pts = deck.points || [];
        let ok = true;
        for (let i = 1; i < pts.length; i += 1) {
          const a = pts[i - 1];
          const b = pts[i];
          const ax = a.x !== undefined ? a.x : a[0];
          const az = a.z !== undefined ? a.z : a[1];
          const bx = b.x !== undefined ? b.x : b[0];
          const bz = b.z !== undefined ? b.z : b[1];
          const len = Math.hypot(bx - ax, bz - az);
          const n = Math.max(1, Math.round(len / stepLen));
          for (let k = 1; k <= n; k += 1) {
            const t = k / n;
            const px = lerp(ax, bx, t);
            const pz = lerp(az, bz, t);
            const qx = lerp(ax, bx, (k - 1) / n);
            const qz = lerp(az, bz, (k - 1) / n);
            const dx = px - qx;
            const dz = pz - qz;
            const dl = Math.hypot(dx, dz) || 1;
            if (!walkable(qx, qz, dx / dl, dz / dl)) {
              ok = false;
              blocked.push({ deck: deck.id, x: px, z: pz });
              break;
            }
            const top = ctx.collide && ctx.collide.solidTop
              ? ctx.collide.solidTop(px, pz) : null;
            if (typeof top === "number" && Number.isFinite(top)) {
              const head = top - groundY(px, pz);
              if (head > 0.2 && head < minHead) minHead = head;
            }
          }
          if (!ok) break;
        }
        rows.push({ id: deck.id, walkable: ok });
      }
      return {
        decks: rows.length,
        walkable: rows.filter((r) => r.walkable).length,
        blockedAt: blocked.slice(0, 12),
        minHeadroomM: Number.isFinite(minHead) ? minHead : null,
        rows,
      };
    },

    /* --------------------------- framing --------------------------- */

    beautyStations() {
      const w = api && api.world;
      return w && w.beautyShots
        ? w.beautyShots.map((p) => ({ id: p.id, name: p.name })) : [];
    },

    /** Every authored pose's eye height, against the cap. See
     *  CAMERA_MAX_EYE_M: past it the map's boundary appears as a
     *  straight line across the ocean. */
    cameraCap() {
      return {
        maxEyeM: CAMERA_MAX_EYE_M,
        reason: "above this the map boundary becomes visible across open ocean"
          + " (design/terrain-surfaces.md 1.5)",
      };
    },

    poseAltitudes() {
      const w = api && api.world;
      if (!w || !w.beautyShots) return [];
      return w.beautyShots.map((p) => ({
        id: p.id,
        y: p.position[1],
        aboveGroundM: p.position[1] - groundY(p.position[0], p.position[2]),
        overCap: p.position[1] > CAMERA_MAX_EYE_M,
      }));
    },

    /* -------------------------- the shell -------------------------- */

    /** `__SF.listTimes()` returns VESPER's table on every page -
     *  qa.js statically imports Vesper's art.js and cannot be made
     *  to import a fourth world's. So the world republishes its
     *  own, exactly as summit-qa.js does. */
    listTimes: () => Object.keys(ATOLL_TIMES).map((k) => ({
      key: k, label: ATOLL_TIMES[k].label, grade: ATOLL_TIMES[k].grade || null,
    })),

    /** The walk rule this file is testing against, so a probe's
     *  numbers can be checked against the game's. */
    slopeRule: () => ({
      look: WALK_SLOPE_LOOK, limit: WALK_SLOPE_LIMIT, stepUp: WALK_MAX_STEP_UP,
      limitDeg: Math.atan(WALK_SLOPE_LIMIT) * 180 / Math.PI,
      wadeMax: WADE_MAX,
      source: "player.js:2390-2392 (copied; function-scoped, cannot be imported)",
    }),

    /** The datum and the tide, republished so an audit can print
     *  the constants it is gating against rather than repeating
     *  them in a second file. */
    datum: () => ({
      seaY: SEA_Y, tide: { ...TIDE }, wadeMax: WADE_MAX,
      mapSize: MAP_SIZE, mapHalf: MAP_HALF,
      profileAtCrest: atollProfileAt(972),
      profileSlopeAtCrest: atollProfileSlope(972),
    }),

    weatherState: () => (ctx.weather && ctx.weather.status ? ctx.weather.status() : null),
    skyState: () => (ctx.sky && ctx.sky.status ? ctx.sky.status() : null),

    /** THE CLOUD SHADOWS, on the CPU, so a harness can check that
     *  the map has weather over the lagoon without photographing
     *  it. `coverAt` is the same three steps the water's fragment
     *  shader takes - project up the sun, un-rotate by the deck's
     *  live rotation, sample - so a disagreement between this and
     *  the frame is a shader bug and not a bake bug. */
    cloudShadowState: (samples = 24, radius = 900) => {
      const cs = ctx.sky && ctx.sky.cloudShadow;
      if (!cs) return null;
      let sum = 0; let max = 0; let hit = 0;
      for (let i = 0; i < samples; i += 1) {
        for (let j = 0; j < samples; j += 1) {
          const x = ((i + 0.5) / samples - 0.5) * 2 * radius;
          const z = ((j + 0.5) / samples - 0.5) * 2 * radius;
          const c = cs.coverAt(x, z);
          sum += c;
          if (c > max) max = c;
          if (c > 0.25) hit += 1;
        }
      }
      const n = samples * samples;
      return {
        resolution: cs.resolution,
        halfSpan: cs.halfSpan,
        base: cs.base,
        meanCoverWholeMap: cs.meanCover,
        gain: Number(cs.gain().toFixed(4)),
        sampledRadius: radius,
        meanCover: Number((sum / n).toFixed(4)),
        maxCover: Number(max.toFixed(4)),
        shadedFraction: Number((hit / n).toFixed(4)),
      };
    },
    worldStats: () => (api && api.world && api.world.stats ? api.world.stats() : null),
    terrainStats: () => (api && api.terrain && api.terrain.stats ? api.terrain.stats() : null),
    collideStats: () => (ctx.collide && ctx.collide.stats ? ctx.collide.stats() : null),
    boundaryState: () => (ctx.waterBoundary && ctx.waterBoundary.status
      ? ctx.waterBoundary.status() : null),
  };

  target.atoll = atoll;
  /* TOP LEVEL TOO. saintfall-shots.mjs:591 reads
     `T.nearestPropWithin`, not `T.<world>.nearestPropWithin`, and
     the near-field anchor term of its composition score has been
     zero on every page since it was written. */
  target.nearestPropWithin = atoll.nearestPropWithin;
  return atoll;
}
