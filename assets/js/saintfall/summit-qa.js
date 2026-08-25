/* ============================================================
   SAINTFALL - Kenosis review instruments

   Bolted onto `window.__SF` after qa.js has built it. Everything
   here is a MEASUREMENT, and it exists because the ways this level
   fails are not things a screenshot can see:

     a pad that is not flat is a fight arena on a hillside;
     a road over grade is a road you cannot walk up;
     a station the walk solver cannot reach is content that does
       not exist;
     a crevasse you can stroll across is a decal;
     a silhouette that does not match the authored profile is a
       different mountain from the one the level was designed for.

   Two rules the whole file obeys:

   1. EVERY ENTRY IS A METHOD, never construction work. A probe
      that throws at install time takes the level down with it, and
      an instrument that can break the thing it measures is worse
      than no instrument.

   2. NOTHING HERE REIMPLEMENTS THE RULE IT TESTS. `reachability`
      marches the player's own slope rule, read off the constants
      in player.js rather than re-derived - a harness that
      reimplements its subject is a harness that agrees with
      itself. Where a number is copied, the copy says where from
      and what happens if the original moves.
   ============================================================ */

import { clamp, clamp01, lerp, TAU } from "saintfall/core.js";
import {
  STATIONS, STATION_ORDER, VIA_SACRA_PATH, VIA_SACRA_LENGTH,
  VIA_SACRA_TURNS, VIA_SACRA_SPURS, BASECAMP, CREVASSES, MOULINS,
  MAP_HALF, summitProfile, viaSacraPointAt,
} from "saintfall/summit-terrain.js";
import { SUMMIT_TIMES, SUMMIT_WIND } from "saintfall/summit-art.js";
import { INVERSION_TOP, INVERSION_BASE } from "saintfall/summit-sky.js";

/* COPIED FROM player.js:2390-2392, and the copy is deliberate.
   Importing them is impossible - they are function-scoped inside
   `createPlayer` - and re-deriving them would produce a harness
   that measures a slope rule the game does not use. If those
   constants move, `reachability` starts lying, and the only
   defence is this comment plus the assertion in `slopeRule()`
   below that the numbers still look like a walk rule. */
const WALK_SLOPE_LOOK = 1.6;
const WALK_SLOPE_LIMIT = 1.7;
const WALK_MAX_STEP_UP = 1.05;

export function installSummitQa(ctx, api, hook) {
  const target = hook || (typeof window !== "undefined" ? window.__SF : null);
  if (!target) return null;

  const field = () => ctx.terrain && ctx.terrain.field;
  const groundY = (x, z) => {
    // Prefer the collider's answer: it is what the player stands on.
    if (ctx.collide && ctx.collide.groundHeight) return ctx.collide.groundHeight(x, z);
    return field() ? field().heightAt(x, z) : 0;
  };

  /** The player's own walkability test, at one step. */
  function walkable(fromX, fromZ, ux, uz) {
    const here = groundY(fromX, fromZ);
    const near = groundY(fromX + ux * 0.45, fromZ + uz * 0.45) - here;
    if (near > WALK_MAX_STEP_UP) return false;
    const rise = groundY(fromX + ux * WALK_SLOPE_LOOK, fromZ + uz * WALK_SLOPE_LOOK) - here;
    return rise / WALK_SLOPE_LOOK < WALK_SLOPE_LIMIT;
  }

  const summit = {
    /* ------------------------- the table ------------------------- */

    stations() {
      return STATION_ORDER.map((id) => {
        const s = STATIONS[id];
        return {
          id, name: s.name, x: s.x, z: s.z, r: s.r,
          padR: s.padR, padY: s.padY,
          groundY: groundY(s.x, s.z),
          bearingDeg: (Math.atan2(s.x, -s.z) * 180 / Math.PI + 360) % 360,
          radius: Math.hypot(s.x, s.z),
        };
      });
    },

    stationPose(id) {
      const s = STATIONS[id];
      if (!s) return null;
      /* A three-quarter view from downhill at 1.6 station radii,
         raised enough to see the pad. Derived rather than authored
         so a station that moves takes its camera with it. */
      const out = Math.atan2(s.x, s.z);
      const d = s.padR * 1.9 + 60;
      const px = s.x + Math.sin(out) * d;
      const pz = s.z + Math.cos(out) * d;
      return {
        position: [px, groundY(px, pz) + Math.max(14, s.padR * 0.22), pz],
        target: [s.x, s.padY + 8, s.z],
        fov: 52,
      };
    },

    /* ------------------------ the surface ------------------------ */

    altitudeAt: (x, z) => groundY(x, z),
    /* `altitudeAt` is what you STAND on, and since the cathedral's
       podium became a real walk surface that is the chapel floor at
       the summit centre - 6.5 m of masonry above the mountain. Any
       check about the LANDFORM has to read the terrain field. */
    terrainAt: (x, z) => (field() ? field().heightAt(x, z) : 0),
    snowDepthAt: (x, z) => (field() ? field().snowDepthAt(x, z) : 0),
    surfaceAt: (x, z) => (field() ? field().surfaceAt(x, z) : null),

    slopeAt(x, z) {
      const f = field();
      if (!f) return 0;
      const n = f.normalAt(x, z);
      return Math.acos(clamp(n[1], -1, 1)) * 180 / Math.PI;
    },

    /**
     * How flat a pad actually is, sampled over its disc.
     *
     * A RING-AND-SPOKE sample, not a grid: the failure mode a pad
     * has is a BANK - one side higher than the other - and a grid
     * over a disc puts most of its samples near the middle, where a
     * bank is smallest. Rings weight the rim, which is where the
     * error lives.
     */
    padFlatness(id, rings = 6, spokes = 24) {
      const s = STATIONS[id];
      if (!s) return null;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let n = 0;
      for (let r = 0; r <= rings; r += 1) {
        const rad = (r / rings) * s.padR;
        const steps = r === 0 ? 1 : spokes;
        for (let k = 0; k < steps; k += 1) {
          const a = (k / steps) * TAU;
          /* `field.heightAt`, NOT the collider. This asserts that the
             arena FLOOR is level; the collider also carries every
             prop rasterised onto it, so once the stations were
             dressed the gate started reporting a cairn as a bump in
             the ground. A prop standing on a flat floor is not a
             flatness failure. */
          const f = field();
          const y = f
            ? f.heightAt(s.x + Math.cos(a) * rad, s.z + Math.sin(a) * rad)
            : groundY(s.x + Math.cos(a) * rad, s.z + Math.sin(a) * rad);
          min = Math.min(min, y);
          max = Math.max(max, y);
          sum += y;
          n += 1;
        }
      }
      /* THE GRADE, which is the property that decides whether an
         arena is fair. Absolute spread does not: a pad carrying
         0.55m of wind drift over a 64m wavelength has a 3.4% worst
         grade - a twentieth of what the player can walk - and reads
         as a snowfield instead of a sheet of card. Sampled across
         the disc on the wind axis, where the drift's own slope is
         steepest. */
      let maxGrade = 0;
      const f2 = field();
      if (f2) {
        const STEP = 6;
        for (let k = 0; k < spokes; k += 1) {
          const a = (k / spokes) * TAU;
          const ux = Math.cos(a);
          const uz = Math.sin(a);
          let prev = f2.heightAt(s.x - ux * s.padR, s.z - uz * s.padR);
          for (let d = -s.padR + STEP; d <= s.padR; d += STEP) {
            const y2 = f2.heightAt(s.x + ux * d, s.z + uz * d);
            maxGrade = Math.max(maxGrade, Math.abs(y2 - prev) / STEP);
            prev = y2;
          }
        }
      }
      return {
        id, min, max, spread: max - min, mean: sum / n, samples: n,
        target: s.padY, offset: sum / n - s.padY,
        maxGradePct: maxGrade * 100,
      };
    },

    /**
     * The Via Sacra's grade, as a percentage, along its whole run.
     *
     * Measured on the ROAD's own centreline through
     * `viaSacraPointAt`, which is parameterised by ARC LENGTH.
     * Sampling it by index instead would weight the tight upper
     * spiral far more heavily than the long lower one and report a
     * mean that belongs to no part of the road.
     */
    viaSacraGrade(samples = 600) {
      const step = 1 / samples;
      let maxPct = 0;
      let sum = 0;
      let worstAt = null;
      const histogram = new Array(16).fill(0);
      /* MEASURED ON THE GROUND, NOT ON THE DESIGN.

         `viaSacraPointAt(t).y` is the marched centreline's DESIGN
         elevation - `summitProfile(r)` - and it is grade-correct by
         construction, so asserting on it asks the road whether it
         agrees with itself. What decides whether a player can walk
         up is the height of the ground the cut actually left, which
         is what `groundY` returns. The first version measured the
         design, reported 30.6% at a place the ground is fine, and
         went on reporting it through two real fixes to the bed. */
      let prev = viaSacraPointAt(0);
      let prevY = groundY(prev.x, prev.z);
      for (let i = 1; i <= samples; i += 1) {
        const t = i * step;
        const p = viaSacraPointAt(t);
        const y = groundY(p.x, p.z);
        const run = Math.hypot(p.x - prev.x, p.z - prev.z);
        if (run > 1e-6) {
          const pct = Math.abs(y - prevY) / run * 100;
          sum += pct;
          if (pct > maxPct) { maxPct = pct; worstAt = { x: p.x, z: p.z, t }; }
          histogram[clamp(Math.floor(pct), 0, 15)] += 1;
        }
        prev = p;
        prevY = y;
      }
      return {
        maxPct, meanPct: sum / samples, histogram, worstAt,
        length: VIA_SACRA_LENGTH, samples,
      };
    },

    /**
     * Can the walk solver get from the basecamp to a station?
     *
     * A GREEDY MARCH ALONG THE ROAD, not a flood fill. The question
     * is not "is there any path" - on an open mountain there almost
     * always is, round the back, up a couloir, over three hours -
     * it is "does the route the level was designed around work".
     * So the march follows the Via Sacra to the station's spur and
     * then the spur, testing the player's own slope rule at every
     * step, and reports where it first cannot continue.
     */
    reachability(id, stepLen = 2.0) {
      const s = STATIONS[id];
      if (!s) return null;
      if (id === "basecamp") {
        return { id, reachable: true, steps: 0, blockedAt: null, maxSlopeDeg: 0, via: "spawn" };
      }
      /* A spur is `{ id, from, length, points }` - `from` is the
         INDEX of the road node it leaves at, and `points` is the
         already-sampled polyline to the pad. Both are used: the
         road leg runs to that node's arc fraction, then the spur's
         own points are walked verbatim rather than re-straightened,
         because the Glacier Tongue's spur is deliberately BOWED
         185m clear of the crevasse field and a straight
         reconstruction of it would march the probe through four
         transverse crevasses and report the arena unreachable. */
      const spur = VIA_SACRA_SPURS.find((sp) => sp.id === id);
      const route = [];
      const tEnd = spur && VIA_SACRA_PATH.length > 1
        ? clamp01(spur.from / (VIA_SACRA_PATH.length - 1)) : 1;
      const roadSteps = Math.max(2, Math.round((VIA_SACRA_LENGTH * tEnd) / stepLen));
      for (let i = 0; i <= roadSteps; i += 1) {
        const p = viaSacraPointAt((i / roadSteps) * tEnd);
        route.push([p.x, p.z]);
      }
      if (spur && spur.points && spur.points.length > 1) {
        for (const pt of spur.points) route.push([pt[0], pt[1]]);
      } else if (id !== "summit") {
        const from = route[route.length - 1];
        const legs = Math.max(2, Math.round(Math.hypot(from[0] - s.x, from[1] - s.z) / stepLen));
        for (let i = 1; i <= legs; i += 1) {
          const t = i / legs;
          route.push([lerp(from[0], s.x, t), lerp(from[1], s.z, t)]);
        }
      }
      /* THE SUMMIT IS THE ONE STATION WITH NO SPUR, because the Via
         Sacra terminates on its pad rather than branching to it - so
         the straight leg above would run from the road's last node to
         the PAD CENTRE, and the pad centre is the middle of the
         cathedral. It reported the summit unreachable by walking into
         the apse wall. Arriving on the pad is arriving; going inside
         is the great flight and the portal, which have their own
         approach and are tested by walking them. */

      let maxSlope = 0;
      for (let i = 1; i < route.length; i += 1) {
        const [ax, az] = route[i - 1];
        const [bx, bz] = route[i];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const rise = groundY(bx, bz) - groundY(ax, az);
        maxSlope = Math.max(maxSlope, Math.atan2(Math.abs(rise), len) * 180 / Math.PI);
        if (!walkable(ax, az, ux, uz)) {
          return {
            id, reachable: false, steps: i, blockedAt: { x: bx, z: bz },
            maxSlopeDeg: maxSlope, via: spur ? "spur" : "road",
          };
        }
      }
      return {
        id, reachable: true, steps: route.length,
        blockedAt: null, maxSlopeDeg: maxSlope, via: spur ? "spur" : "road",
      };
    },

    /* ------------------------- crevasses ------------------------- */

    /**
     * Is there a hole here, and how wide is it?
     *
     * Walks a transect across the slot and reports the span over
     * which the ground is below the surrounding lip. Measured off
     * `groundHeight` - the surface the player actually stands on -
     * so a crevasse that exists in the height field and not in the
     * collider reads as closed, which is exactly the failure worth
     * catching.
     */
    crevasseProbe(x, z, bearingDeg = null, span = 120) {
      const c = CREVASSES.reduce((best, k) => {
        const d = Math.hypot(k.cx - x, k.cz - z);
        return !best || d < best.d ? { k, d } : best;
      }, null);
      /* ACROSS THE SLOT, not along it. A crevasse's own axis is
         `(bx-ax, bz-az)`; a transect along that axis walks the
         length of the hole and measures a trench 190m wide, which
         passes the width gate for entirely the wrong reason. The
         probe therefore runs PERPENDICULAR to the authored axis
         unless the caller names a bearing. */
      let ux;
      let uz;
      if (bearingDeg !== null) {
        const a = bearingDeg * Math.PI / 180;
        ux = Math.cos(a);
        uz = Math.sin(a);
      } else if (c) {
        const tx = c.k.bx - c.k.ax;
        const tz = c.k.bz - c.k.az;
        const inv = 1 / (Math.hypot(tx, tz) || 1);
        ux = -tz * inv;
        uz = tx * inv;
      } else { ux = 1; uz = 0; }
      const N = 180;
      const ys = [];
      for (let i = 0; i <= N; i += 1) {
        const t = (i / N - 0.5) * span;
        ys.push(groundY(x + ux * t, z + uz * t));
      }
      const lipY = Math.max(ys[0], ys[ys.length - 1]);
      const floorY = Math.min(...ys);
      const depth = lipY - floorY;
      /* "Open" means it is deeper than a step and the walls beat
         the walk limit. A 40cm dip is a dip. */
      const open = depth > 3.0;
      let width = 0;
      if (open) {
        const cut = lipY - depth * 0.25;
        let first = -1;
        let last = -1;
        for (let i = 0; i <= N; i += 1) {
          if (ys[i] < cut) { if (first < 0) first = i; last = i; }
        }
        width = first >= 0 ? ((last - first) / N) * span : 0;
      }
      return { open, lipY, floorY, depth, width, nearest: c ? c.k.id : null };
    },

    /** Every authored crevasse, probed. What the gate asserts on. */
    crevasseSamples() {
      return CREVASSES.map((c) => ({
        id: c.id, authoredDepth: c.depth,
        ...summit.crevasseProbe(c.cx, c.cz, null, c.half * 2 + c.span * 2 + 40),
      }));
    },

    moulins: () => MOULINS.map((m) => ({ ...m, groundY: groundY(m.x, m.z) })),

    /* ------------------------ the mountain ------------------------ */

    /**
     * The elevation profile along a compass bearing, from the peak
     * outward. What proves the built mountain is the authored one.
     */
    profileScan(bearingDeg = 0, samples = 64) {
      const a = (180 - bearingDeg) * Math.PI / 180;
      const ux = Math.sin(a);
      const uz = Math.cos(a);
      const out = [];
      for (let i = 0; i <= samples; i += 1) {
        const r = (i / samples) * (MAP_HALF - 8);
        const x = ux * r;
        const z = uz * r;
        out.push({ r, x, z, y: groundY(x, z), authored: summitProfile(r) });
      }
      return out;
    },

    /** How far the built ground strays from the authored profile. */
    profileError(bearings = [0, 45, 90, 135, 180, 225, 270, 315], samples = 48) {
      let worst = 0;
      let at = null;
      let sum = 0;
      let n = 0;
      for (const b of bearings) {
        for (const p of summit.profileScan(b, samples)) {
          const e = Math.abs(p.y - p.authored);
          sum += e;
          n += 1;
          if (e > worst) { worst = e; at = { bearing: b, r: p.r, y: p.y, authored: p.authored }; }
        }
      }
      return { worst, mean: sum / n, at, samples: n };
    },

    /* ------------------------ the weather ------------------------ */

    /** The encircling range: is it actually a barrier?
     *  Walks a radial transect on `samples` bearings and reports the
     *  lowest crest and the gentlest inner face found - which is the
     *  only pair of numbers that decides whether a player can leave. */
    rimProbe(bearings = 72) {
      let lowestCrest = Infinity;
      let lowestAt = 0;
      let gentlest = Infinity;
      let gentlestAt = 0;
      for (let b = 0; b < bearings; b += 1) {
        const a = (b / bearings) * Math.PI * 2;
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        /* MARCHED IN rimDist, NOT IN RADIUS, and that is the whole
           correctness of this probe. The range is built on a
           rounded-square distance so it uses the map's corners - the
           same trick Vesper uses - which means its crest sits at
           r = 962 on the axes and r = 1214 on the diagonals. A probe
           that sweeps a fixed radius band finds the range on four
           bearings and empty valley on the other sixty-eight, and
           reports the level as wide open when it is sealed. */
        let crest = -Infinity;
        let maxGrade = 0;
        let prev = null;
        let prevR = 0;
        for (let k = 0; k <= 130; k += 1) {
          const target = 0.86 + (k / 130) * 0.30;      // rimDist 0.86 -> 1.16
          /* Radius at which this bearing reaches that rimDist. */
          const unit = Math.pow(
            Math.pow(Math.abs(ux) / 1024, 6) + Math.pow(Math.abs(uz) / 1024, 6), 1 / 6);
          const r = target / unit;
          const y = groundY(ux * r, uz * r);
          if (y > crest) crest = y;
          if (prev !== null && r > prevR) {
            maxGrade = Math.max(maxGrade, (y - prev) / (r - prevR));
          }
          prev = y;
          prevR = r;
        }
        if (crest < lowestCrest) { lowestCrest = crest; lowestAt = a * 180 / Math.PI; }
        if (maxGrade < gentlest) { gentlest = maxGrade; gentlestAt = a * 180 / Math.PI; }
      }
      return {
        lowestCrestM: lowestCrest,
        lowestCrestBearing: lowestAt,
        gentlestFaceGrade: gentlest,
        gentlestFaceBearing: gentlestAt,
        walkLimit: WALK_SLOPE_LIMIT,
        sealed: gentlest > WALK_SLOPE_LIMIT,
      };
    },

    /**
     * EVERY PROP THAT DOES NOT TOUCH THE GROUND.
     *
     * The review reported "gaps that make objects look floating",
     * and that is not a thing you can reliably find by looking: a
     * 30cm gap under a tent is invisible from the air, obvious at
     * eye level, and there are thousands of props. So it is
     * measured.
     *
     * Per merged mesh, the geometry is walked in world space and
     * every vertex is compared against the terrain beneath it. What
     * matters is the MINIMUM gap over the whole mesh - the distance
     * from the ground to the lowest thing above it - because a prop
     * is bedded if ANY part of it is in the ground. A mesh whose
     * closest approach is +0.25m is standing on air by a quarter of
     * a metre, and that is exactly the read the review named.
     *
     * Merged bins are sampled rather than exhaustively walked: a
     * station's granite is one mesh of a hundred thousand vertices
     * and the answer does not change past a few thousand samples.
     */
    floatingProps(gapM = 0.12, stride = 7) {
      const world = api.world;
      const f = field();
      if (!world || !world.meshes || !f) return null;
      const rows = [];
      for (const mesh of world.meshes) {
        const pos = mesh.geometry && mesh.geometry.attributes
          && mesh.geometry.attributes.position;
        if (!pos || !pos.count) continue;
        mesh.updateWorldMatrix(true, false);
        const m = mesh.matrixWorld.elements;
        let minGap = Infinity;
        let atX = 0;
        let atZ = 0;
        let n = 0;
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i);
          const vy = pos.getY(i);
          const vz = pos.getZ(i);
          /* World transform by hand - a Vector3 per vertex over a
             million vertices is the difference between a probe that
             runs and one that times out. */
          const wx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
          const wy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
          const wz = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
          const gap = wy - f.heightAt(wx, wz);
          if (gap < minGap) { minGap = gap; atX = wx; atZ = wz; }
          n += 1;
        }
        if (!n || !Number.isFinite(minGap)) continue;
        if (minGap > gapM) {
          rows.push({
            name: mesh.name, gap: minGap,
            x: atX, z: atZ, samples: n,
            station: mesh.userData && mesh.userData.station,
          });
        }
      }
      rows.sort((a, b) => b.gap - a.gap);
      return { gapM, floating: rows.length, meshes: world.meshes.length, rows: rows.slice(0, 40) };
    },

    inversionProbe() {
      const sky = ctx.sky;
      const deckY = (sky && sky.status && sky.status().inversionY) || INVERSION_TOP;
      return {
        deckY, base: INVERSION_BASE,
        above: STATION_ORDER.filter((id) => STATIONS[id].padY > deckY),
        below: STATION_ORDER.filter((id) => STATIONS[id].padY <= deckY),
        wind: { bearing: SUMMIT_WIND.fromBearing, toward: SUMMIT_WIND.toward },
      };
    },

    /** Distance to the nearest world prop within `r` of (x, z), or
     *  null. The shots harness uses it to prefer standing points that
     *  put something in the near field - composition is the widest
     *  axis gap against Vesper and "no foreground element" is the
     *  most repeated note in the review log. Batched meshes are
     *  measured by their bounding-sphere centres, which is coarse but
     *  is the right granularity for "is there something over there".
     */
    nearestPropWithin(x, z, r = 30) {
      const scene = api.render && api.render.scene;
      if (!scene) return null;
      let best = null;
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const n = o.name || "";
        if (/^terrain|drift-powder|^weather|^sky/.test(n)) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const bs = o.geometry.boundingSphere;
        if (!bs) return;
        const d = Math.hypot(bs.center.x - x, bs.center.z - z) - bs.radius;
        if (d >= 0 && d <= r && (best === null || d < best)) best = d;
      });
      return best;
    },

    weatherState: () => (ctx.weather && ctx.weather.status ? ctx.weather.status() : null),

    /* -------------------------- the shell -------------------------- */

    character: () => ({
      ...(ctx.playerCharacter || {}),
      assetSource: api.player?.figure?.assetSource || "unknown",
      triangles: api.player?.figure?.triangles || 0,
      locomotion: api.player?.locomotionProfile?.() || null,
    }),

    listTimes: () => Object.keys(SUMMIT_TIMES).map((k) => ({
      key: k, label: SUMMIT_TIMES[k].label, grade: SUMMIT_TIMES[k].grade,
    })),

    beautyStations: () => (api.world && api.world.beautyShots
      ? api.world.beautyShots.map((p) => ({ id: p.id, name: p.name })) : []),

    /** The road's own centreline, so a walkability probe can follow
     *  the route the level intends rather than a straight line at the
     *  peak. Without this the only available test was "walk at the
     *  summit", which correctly reports the mountain's foot as
     *  unclimbable and says nothing about whether the PATH works. */
    viaSacraPath: (stride = 1) => VIA_SACRA_PATH
      .filter((_, i) => i % stride === 0)
      .map((n) => [n.x !== undefined ? n.x : n[0], n.z !== undefined ? n.z : n[1]]),

    viaSacra: () => ({
      length: VIA_SACRA_LENGTH,
      nodes: VIA_SACRA_PATH.length,
      turns: VIA_SACRA_TURNS.length,
      spurs: VIA_SACRA_SPURS.map((s) => ({ id: s.id, t: s.t, x: s.x, z: s.z })),
      basecamp: BASECAMP,
    }),

    /** The walk rule this file is testing against, so a probe's
     *  numbers can be checked against the game's. */
    slopeRule: () => ({
      look: WALK_SLOPE_LOOK, limit: WALK_SLOPE_LIMIT, stepUp: WALK_MAX_STEP_UP,
      limitDeg: Math.atan(WALK_SLOPE_LIMIT) * 180 / Math.PI,
      source: "player.js:2390-2392 (copied; function-scoped, cannot be imported)",
    }),

    worldStats: () => (api.world && api.world.stats ? api.world.stats() : null),
    terrainStats: () => (api.terrain && api.terrain.stats ? api.terrain.stats() : null),
  };

  target.summit = summit;
  return summit;
}
